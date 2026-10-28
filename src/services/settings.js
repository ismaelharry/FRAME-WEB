// Ajustes editables desde administración. Los valores marcados como pendientes
// son de demostración hasta que FRAME los confirme.

const wk = (r) => ({ mon: r, tue: r, wed: r, thu: r, fri: r, sat: [], sun: [] });

export const DEFAULT_SETTINGS = {
  business: {
    brand: 'FRAME',
    legal_name: 'FRAME S.L.',
    tax_id: 'B56756767',
    street: 'Rambla Juan Mateo García, 21',
    postal_code: '03183',
    city: 'Torrevieja',
    province: 'Alicante',
    country: 'España',
    phone: '+34 676 676 767',
    email: 'frame@gmail.com',
    registry: '',               // datos del Registro Mercantil: pendientes
    surface_m2: 400,
    instagram: '',
    linkedin: '',
  },
  hours: {
    confirmed: false,           // false = horario de demostración, no se publica en datos estructurados
    reception: wk([['09:00', '14:00'], ['16:00', '19:00']]),
    coworking: wk([['08:00', '20:00']]),
    fixed_247: true,            // acceso 24/7 solo para mesa fija
  },
  commerce: {
    sales_enabled: false,       // compras online desactivadas hasta confirmar todo lo siguiente
    tax_configured: false,
    tax_rate_bp: null,          // p. ej. 2100 = 21 %; null = no configurado
    tax_label: 'IVA',
    prices_confirmed: false,
    conditions_confirmed: false,
    currency: 'EUR',
  },
  policies: {
    cancel_free_hours: 24,      // cancelación gratuita hasta X h antes
    modify_min_hours: 24,       // cambios permitidos hasta X h antes
    min_notice_minutes: 60,     // antelación mínima para reservar
    horizon_days: 90,           // reserva máxima con antelación
    payment_hold_minutes: 35,   // bloqueo temporal mientras se paga
    request_hold_hours: 48,     // bloqueo de una solicitud pendiente de confirmar
    late_cancel_refund: false,  // reembolso fuera de plazo
    plan_cancel_notice_days: 0, // preaviso de baja de planes (sin permanencia)
    voucher_validity_days: 180,
  },
  trial: {
    enabled: true,
    requires_approval: true,
    min_notice_hours: 24,
    weekdays: [1, 2, 3, 4, 5],
    conditions_es: 'Un único día de prueba por persona, sujeto a disponibilidad y a confirmación por parte de FRAME. Incluye un puesto en la zona de coworking, wifi y café durante el horario del coworking. No incluye salas, cabinas ni estudio.',
    conditions_en: 'One trial day per person, subject to availability and confirmation by FRAME. Includes a desk in the coworking area, wifi and coffee during coworking hours. Meeting rooms, booths and the studio are not included.',
  },
  visits: {
    enabled: true,
    auto_confirm: true,
    max_people: 4,
  },
  plans: {
    max_flex_members: 40,       // límite de altas de mesa flexible (el uso diario se controla aparte)
    // Permanencia mínima en meses. 0 = sin permanencia (documentado para la mesa flexible).
    // null = pendiente de confirmar por FRAME.
    commitment_months: { flex: 0, fixed: 0, virtual: 0 }, // «sin permanencia» en todos los planes
  },
  analytics: {
    provider: 'none',           // 'plausible' | 'ga4' | 'none' (solo se carga con consentimiento)
    site_id: '',
  },
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]))
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

export function createSettings(db) {
  let cache = null;
  function load() {
    const rows = db.all('SELECT key, value FROM settings');
    const stored = {};
    for (const r of rows) { try { stored[r.key] = JSON.parse(r.value); } catch { /* ignorar */ } }
    cache = deepMerge(DEFAULT_SETTINGS, stored);
    return cache;
  }
  return {
    all: () => cache || load(),
    get: (key) => (cache || load())[key],
    set(key, value) {
      const merged = deepMerge(DEFAULT_SETTINGS[key] ?? {}, value);
      db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [key, JSON.stringify(merged), Date.now()]);
      cache = null;
      return merged;
    },
    invalidate: () => { cache = null; },
  };
}

// ¿Se pueden cobrar compras online? Solo si el administrador ha confirmado
// tarifas, impuestos y condiciones y ha activado la venta.
export function commerceState(settings, payments) {
  const c = settings.get('commerce');
  const taxReady = c.tax_configured && Number.isInteger(c.tax_rate_bp) && c.tax_rate_bp >= 0;
  const missing = [];
  if (!c.prices_confirmed) missing.push('prices');
  if (!taxReady) missing.push('tax');
  if (!c.conditions_confirmed) missing.push('conditions');
  if (!c.sales_enabled) missing.push('sales');
  if (!payments.available) missing.push('gateway');
  return {
    taxReady,
    taxRateBp: taxReady ? c.tax_rate_bp : null,
    canSell: missing.length === 0,
    missing,
    provider: payments.provider,
    testMode: payments.testMode,
  };
}
