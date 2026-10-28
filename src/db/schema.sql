-- Estructura de datos de FRAME (SQLite).
-- Instantes en milisegundos UTC; fechas locales (Europe/Madrid) como 'YYYY-MM-DD'.
-- Importes en céntimos; tipos de IVA en puntos básicos (2100 = 21 %).

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,            -- JSON
  updated_at INTEGER
);

-- Textos editables desde administración (sobrescriben los textos por defecto).
CREATE TABLE IF NOT EXISTS content (
  key        TEXT NOT NULL,
  lang       TEXT NOT NULL CHECK (lang IN ('es','en')),
  value      TEXT NOT NULL,
  updated_at INTEGER,
  PRIMARY KEY (key, lang)
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin','staff')),
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  created_at           INTEGER NOT NULL,
  last_login_at        INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,     -- normalizado en minúsculas
  name                TEXT,
  phone               TEXT,
  company             TEXT,
  tax_id              TEXT,                     -- NIF/CIF opcional para facturación
  billing_address     TEXT,
  lang                TEXT NOT NULL DEFAULT 'es',
  marketing_opt_in    INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in_at INTEGER,
  link_version        INTEGER NOT NULL DEFAULT 1, -- invalida enlaces de gestión antiguos
  admin_notes         TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('admin','customer')),
  subject_id   INTEGER NOT NULL,
  csrf         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_subject ON sessions(kind, subject_id);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  next_path   TEXT
);

-- Fichas públicas de cada espacio (coworking, salas, despachos, estudio).
CREATE TABLE IF NOT EXISTS spaces (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  sort           INTEGER NOT NULL DEFAULT 0,
  visible        INTEGER NOT NULL DEFAULT 1,
  name_es        TEXT NOT NULL, name_en TEXT NOT NULL,
  tagline_es     TEXT, tagline_en TEXT,
  description_es TEXT, description_en TEXT,
  includes_es    TEXT, includes_en TEXT,       -- JSON: lista de servicios incluidos
  equipment_es   TEXT, equipment_en TEXT,      -- JSON: lista de equipamiento
  conditions_es  TEXT, conditions_en TEXT,
  hours_es       TEXT, hours_en TEXT,          -- texto libre de horarios
  area_m2        REAL,
  capacity_text_es TEXT, capacity_text_en TEXT
);

-- Productos y tarifas. price_cents NULL = sin tarifa documentada (solicitar presupuesto).
CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('day_pass','bundle','plan','hourly','visit','trial','quote')),
  plan_type      TEXT CHECK (plan_type IN ('flex','fixed','virtual')),
  space_slug     TEXT,
  name_es        TEXT NOT NULL, name_en TEXT NOT NULL,
  summary_es     TEXT, summary_en TEXT,
  includes_es    TEXT, includes_en TEXT,       -- JSON
  how_es         TEXT, how_en TEXT,            -- cómo se contrata
  conditions_es  TEXT, conditions_en TEXT,
  price_cents    INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  unit           TEXT NOT NULL CHECK (unit IN ('day','pack','month','hour','visit','quote')),
  credits        INTEGER,                      -- días incluidos en un bono
  validity_days  INTEGER,                      -- validez del bono
  max_quantity   INTEGER NOT NULL DEFAULT 1,
  featured       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER
);

-- Recursos físicos reservables (inventario). Los números son de demostración.
CREATE TABLE IF NOT EXISTS resources (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('desk_pool','room','booth','studio','office','tour')),
  space_slug     TEXT,
  group_slug     TEXT,                         -- unidades intercambiables (p. ej. cabinas)
  product_slug   TEXT,
  name_es        TEXT NOT NULL, name_en TEXT NOT NULL,
  capacity       INTEGER NOT NULL CHECK (capacity > 0), -- personas (o puestos en desk_pool)
  booking_mode   TEXT NOT NULL CHECK (booking_mode IN ('instant','request','quote')),
  slot_minutes   INTEGER NOT NULL DEFAULT 30,
  min_minutes    INTEGER NOT NULL DEFAULT 60,
  max_minutes    INTEGER NOT NULL DEFAULT 480,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  hours          TEXT NOT NULL,                -- JSON semanal
  equipment_es   TEXT, equipment_en TEXT,      -- JSON
  area_m2        REAL,
  max_fixed      INTEGER,                      -- desk_pool: máximo de mesas fijas
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY,
  ref                 TEXT NOT NULL UNIQUE,
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  kind                TEXT NOT NULL CHECK (kind IN ('booking','bundle','plan')),
  status              TEXT NOT NULL CHECK (status IN ('pending','paid','failed','expired','cancelled','refunded','refund_pending')),
  provider            TEXT NOT NULL CHECK (provider IN ('stripe','test','manual')),
  provider_session_id TEXT UNIQUE,
  provider_payment_id TEXT,
  subtotal_cents      INTEGER NOT NULL,
  tax_rate_bp         INTEGER NOT NULL,
  tax_cents           INTEGER NOT NULL,
  total_cents         INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  items               TEXT NOT NULL,           -- JSON con precios aplicados
  conditions          TEXT NOT NULL,           -- condiciones aceptadas (texto íntegro)
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER,
  paid_at             INTEGER,
  failed_reason       TEXT,
  refunded_cents      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);

-- Eventos de pasarela ya procesados (idempotencia ante notificaciones repetidas).
CREATE TABLE IF NOT EXISTS payment_events (
  id           INTEGER PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  order_ref    TEXT,
  payload      TEXT NOT NULL,
  received_at  INTEGER NOT NULL,
  result       TEXT,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  product_id       INTEGER REFERENCES products(id),
  resource_id      INTEGER NOT NULL REFERENCES resources(id),
  kind             TEXT NOT NULL CHECK (kind IN ('desk_day','hourly','visit','office')),
  usage            TEXT NOT NULL CHECK (usage IN ('pass','voucher','plan','trial','hourly','visit','office','admin')),
  status           TEXT NOT NULL CHECK (status IN ('pending_payment','requested','confirmed','cancelled','expired','rejected')),
  payment_status   TEXT NOT NULL DEFAULT 'none' CHECK (payment_status IN ('none','unpaid','pending','paid','failed','refunded','refund_pending','offline','included')),
  start_utc        INTEGER NOT NULL,
  end_utc          INTEGER NOT NULL,
  local_date       TEXT NOT NULL,
  end_date         TEXT,                       -- despachos: fecha final (exclusiva)
  people           INTEGER NOT NULL DEFAULT 1 CHECK (people > 0),
  notes            TEXT,
  unit_price_cents INTEGER,
  quantity         REAL,
  subtotal_cents   INTEGER,
  tax_rate_bp      INTEGER,
  tax_cents        INTEGER,
  total_cents      INTEGER,
  price_final      INTEGER NOT NULL DEFAULT 0, -- 1 si el importe incluye impuestos configurados
  conditions       TEXT,
  voucher_id       INTEGER REFERENCES vouchers(id),
  plan_id          INTEGER REFERENCES plans(id),
  order_id         INTEGER REFERENCES orders(id),
  hold_expires_at  INTEGER,
  source           TEXT NOT NULL DEFAULT 'web',
  lang             TEXT NOT NULL DEFAULT 'es',
  admin_notes      TEXT,
  cancel_reason    TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  confirmed_at     INTEGER,
  cancelled_at     INTEGER,
  CHECK (end_utc > start_utc)
);
CREATE INDEX IF NOT EXISTS bookings_resource_time ON bookings(resource_id, start_utc);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(local_date, status);
CREATE INDEX IF NOT EXISTS bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings(status, hold_expires_at);

-- Ocupación exclusiva de recursos por franjas. La clave primaria impide en la
-- propia base de datos que dos reservas activas ocupen el mismo recurso a la vez.
CREATE TABLE IF NOT EXISTS booking_slots (
  resource_id INTEGER NOT NULL,
  slot_start  INTEGER NOT NULL,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, slot_start)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS booking_slots_booking ON booking_slots(booking_id);

CREATE TABLE IF NOT EXISTS vouchers (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  order_id      INTEGER UNIQUE REFERENCES orders(id), -- un bono por pedido: sin créditos duplicados
  credits_total INTEGER NOT NULL CHECK (credits_total > 0),
  status        TEXT NOT NULL CHECK (status IN ('active','expired','cancelled')),
  valid_from    TEXT NOT NULL,
  expires_on    TEXT,
  created_at    INTEGER NOT NULL
);

-- Historial de movimientos del bono. El saldo es la suma de delta y nunca puede ser negativo.
CREATE TABLE IF NOT EXISTS voucher_ledger (
  id          INTEGER PRIMARY KEY,
  voucher_id  INTEGER NOT NULL REFERENCES vouchers(id),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('purchase','use','refund','adjust','expire')),
  booking_id  INTEGER REFERENCES bookings(id),
  note        TEXT,
  actor       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voucher_ledger_once ON voucher_ledger(voucher_id, booking_id, reason) WHERE booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plans (
  id                   INTEGER PRIMARY KEY,
  ref                  TEXT NOT NULL UNIQUE,
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  product_id           INTEGER NOT NULL REFERENCES products(id),
  plan_type            TEXT NOT NULL CHECK (plan_type IN ('flex','fixed','virtual')),
  status               TEXT NOT NULL CHECK (status IN ('requested','pending_payment','active','past_due','ended','cancelled','rejected')),
  start_date           TEXT NOT NULL,
  period_start         TEXT,
  period_end           TEXT,                   -- exclusiva
  desk_label           TEXT,
  auto_renew           INTEGER NOT NULL DEFAULT 1,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  unit_price_cents     INTEGER,
  tax_rate_bp          INTEGER,
  total_cents          INTEGER,
  price_final          INTEGER NOT NULL DEFAULT 0,
  conditions           TEXT,
  order_id             INTEGER REFERENCES orders(id),
  provider_subscription_id TEXT,
  hold_expires_at      INTEGER,
  notes                TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_customer ON plans(customer_id);

-- Bloqueos: mantenimiento, festivos o uso interno. resource_id NULL = todo el centro.
CREATE TABLE IF NOT EXISTS blocks (
  id          INTEGER PRIMARY KEY,
  resource_id INTEGER REFERENCES resources(id),
  start_utc   INTEGER NOT NULL,
  end_utc     INTEGER NOT NULL,
  units       INTEGER,                         -- desk_pool: puestos bloqueados (NULL = todos)
  reason      TEXT NOT NULL CHECK (reason IN ('maintenance','holiday','internal','other')),
  note        TEXT,
  created_by  INTEGER,
  created_at  INTEGER NOT NULL,
  CHECK (end_utc > start_utc)
);

-- Contacto, presupuestos y solicitudes de alta.
CREATE TABLE IF NOT EXISTS requests (
  id               INTEGER PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL CHECK (type IN ('contact','quote')),
  topic            TEXT,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  company          TEXT,
  team_size        INTEGER,
  start_date       TEXT,
  message          TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  lang             TEXT NOT NULL DEFAULT 'es',
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  admin_notes      TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- Primer día de prueba: uno por correo.
CREATE TABLE IF NOT EXISTS trials (
  email      TEXT PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faqs (
  id      INTEGER PRIMARY KEY,
  q_es    TEXT NOT NULL, a_es TEXT NOT NULL,
  q_en    TEXT NOT NULL, a_en TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title_es    TEXT NOT NULL, title_en TEXT NOT NULL,
  summary_es  TEXT, summary_en TEXT,
  lang_note   TEXT,                            -- idioma de la actividad
  start_utc   INTEGER NOT NULL,
  end_utc     INTEGER NOT NULL,
  location    TEXT,
  capacity    INTEGER,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_signups (
  id         INTEGER PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, email)
);

CREATE TABLE IF NOT EXISTS media (
  id         INTEGER PRIMARY KEY,
  slot       TEXT NOT NULL,                    -- p. ej. home.hero, space.coworking
  path       TEXT NOT NULL,                    -- ruta pública
  width      INTEGER, height INTEGER,
  alt_es     TEXT NOT NULL, alt_en TEXT NOT NULL,
  is_concept INTEGER NOT NULL DEFAULT 0,       -- 1 = render/imagen conceptual, no fotografía real
  sort       INTEGER NOT NULL DEFAULT 0,
  builtin    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  body_html   TEXT,
  kind        TEXT NOT NULL,
  related_ref TEXT,
  status      TEXT NOT NULL CHECK (status IN ('queued','sent','not_sent_test_mode','failed')),
  error       TEXT,
  viewer_key  TEXT,                            -- solo modo prueba: navegador que lo generó
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  data       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity, entity_id);

-- El saldo de un bono nunca puede quedar en negativo.
CREATE TRIGGER IF NOT EXISTS voucher_no_negative AFTER INSERT ON voucher_ledger
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_NEGATIVE')
  WHERE (SELECT COALESCE(SUM(delta), 0) FROM voucher_ledger WHERE voucher_id = NEW.voucher_id) < 0;
END;
