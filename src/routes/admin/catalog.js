// Administración · inventario, tarifas, impuestos y ajustes (solo administración).
import { html, raw } from '../../lib/html.js';
import { AppError, slugify } from '../../lib/util.js';
import * as T from '../../lib/time.js';
import { commerceState } from '../../services/settings.js';
import { quoteProduct } from '../../services/pricing.js';
import { field, postForm, actionButton, empty, eur } from '../../views/admin/ui.js';

const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
const MODE = { instant: 'Reserva inmediata', request: 'Solicitud (confirma FRAME)', quote: 'Solo presupuesto' };
const KINDS = { desk_pool: 'Puestos de coworking', room: 'Sala', booth: 'Cabina', studio: 'Estudio', office: 'Despacho', tour: 'Visitas' };
const UNIT = { day: 'día', pack: 'bono', month: 'mes', hour: 'hora', visit: 'visita', quote: 'presupuesto' };

// «09:00-14:00, 16:00-19:00» → [['09:00','14:00'],['16:00','19:00']]; vacío = cerrado; «24h» = todo el día.
export function parseRanges(text) {
  const s = String(text || '').trim();
  if (!s || /^cerrado$/i.test(s)) return [];
  if (/^24\s*h$/i.test(s)) return [['00:00', '24:00']];
  const out = [];
  for (const part of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})$/);
    if (!m) throw new AppError('INVALID_HOURS', 400, { value: part });
    const [a, b] = [m[1].padStart(5, '0'), m[2].padStart(5, '0')];
    if (!T.isTime(a) || !(T.isTime(b) || b === '24:00') || T.timeToMinutes(a) >= (b === '24:00' ? 1440 : T.timeToMinutes(b))) throw new AppError('INVALID_HOURS', 400, { value: part });
    if (out.length && T.timeToMinutes(a) < (out[out.length - 1][1] === '24:00' ? 1440 : T.timeToMinutes(out[out.length - 1][1]))) throw new AppError('INVALID_HOURS', 400, { value: part });
    out.push([a, b]);
  }
  return out;
}
const fmtRanges = (rs) => (rs && rs.length ? (rs.length === 1 && rs[0][0] === '00:00' && rs[0][1] === '24:00' ? '24h' : rs.map((r) => `${r[0]}-${r[1]}`).join(', ')) : '');
const weekFields = (prefix, hours) => html`<div class="aweekf">${DAYS.map(([k, l]) => field({ label: l, name: `${prefix}_${k}`, value: fmtRanges(hours?.[k]), attrs: { placeholder: 'cerrado', pattern: '[0-9:,; -–ah]*' } }))}</div>`;
const readWeek = (body, prefix) => Object.fromEntries(DAYS.map(([k]) => [k, parseRanges(body[`${prefix}_${k}`])]));
const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30);
const int = (v, min, max, { nullable = false } = {}) => {
  if (nullable && (v === '' || v === undefined || v === null)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError('VALIDATION', 400, { value: v });
  return n;
};
const euros = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Math.round(Number(s) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new AppError('VALIDATION');
  return n;
};

export function catalogRoutes(r, ctx, h) {
  const { db, catalog, bookings, settings } = ctx;
  const today = () => T.todayLocal(ctx.now());

  // --------------------------------------------------------------- recursos
  r.get('/recursos', h.adminOnly, (req, res) => {
    const list = catalog.resources({ all: true });
    h.page(req, res, {
      section: 'resources', title: 'Recursos e inventario',
      actions: html`<a class="abtn abtn--primary" href="/admin/recursos/nuevo">Añadir recurso</a>`,
      body: html`
<p class="muted">Inventario reservable. Los números iniciales son de demostración: ajústalos a la realidad de FRAME. La disponibilidad de la web se calcula siempre con estos datos.</p>
<div class="ascroll"><table class="atable"><thead><tr><th>Recurso</th><th>Tipo</th><th class="num">Capacidad</th><th>Modo</th><th>Franjas</th><th>Estado</th></tr></thead><tbody>
${list.map((x) => html`<tr><td><a href="/admin/recursos/${x.slug}"><strong>${x.name_es}</strong></a>${x.group_slug ? html` <span class="muted">· grupo ${x.group_slug}</span>` : ''}</td><td>${KINDS[x.kind]}</td>
  <td class="num">${x.capacity}${x.kind === 'desk_pool' ? html` puestos <span class="muted">(máx. ${x.max_fixed ?? '—'} fijas)</span>` : ' pers.'}</td><td>${MODE[x.booking_mode]}</td>
  <td class="small">${x.kind === 'desk_pool' || x.kind === 'office' ? 'Por días' : `${x.slot_minutes} min · ${x.min_minutes}–${x.max_minutes} min${x.buffer_minutes ? ` · margen ${x.buffer_minutes} min` : ''}`}</td>
  <td>${x.active ? html`<span class="atag atag--ok">Activo</span>` : html`<span class="atag atag--off">Inactivo</span>`}</td></tr>`)}
</tbody></table></div>`,
    });
  });

  const resourceForm = (x, isNew) => html`
<fieldset class="apanel"><legend>General</legend><div class="agridf">
  ${isNew ? field({ label: 'Tipo', name: 'kind', type: 'select', options: Object.entries(KINDS).filter(([k]) => k !== 'desk_pool' && k !== 'tour'), value: x.kind }) : ''}
  ${isNew ? field({ label: 'Identificador (URL)', name: 'slug', value: x.slug, hint: 'Letras, números y guiones. No se puede cambiar después.', required: true }) : ''}
  ${field({ label: 'Nombre (ES)', name: 'name_es', value: x.name_es, required: true })}
  ${field({ label: 'Nombre (EN)', name: 'name_en', value: x.name_en, required: true })}
  ${field({ label: x.kind === 'desk_pool' ? 'Puestos totales' : 'Capacidad (personas)', name: 'capacity', type: 'number', value: x.capacity, required: true, attrs: { min: 1, max: 500 } })}
  ${x.kind === 'desk_pool' ? field({ label: 'Máximo de mesas fijas', name: 'max_fixed', type: 'number', value: x.max_fixed, hint: 'Cada mesa fija descuenta un puesto todos los días.', attrs: { min: 0, max: 500 } }) : ''}
  ${field({ label: 'Superficie (m²)', name: 'area_m2', type: 'number', value: x.area_m2, attrs: { min: 0, step: '0.1' } })}
  ${field({ label: 'Modo de reserva', name: 'booking_mode', type: 'select', value: x.booking_mode, options: Object.entries(MODE) })}
  ${field({ label: 'Grupo (unidades intercambiables)', name: 'group_slug', value: x.group_slug, hint: 'p. ej. «cabinas»: el cliente reserva cualquiera libre del grupo.' })}
  ${field({ label: 'Activo (reservable)', name: 'active', type: 'checkbox', checked: x.active !== 0 })}
</div></fieldset>
${!['desk_pool', 'office'].includes(x.kind) ? html`<fieldset class="apanel"><legend>Franjas</legend><div class="agridf">
  ${field({ label: 'Paso entre horas de inicio (min)', name: 'slot_minutes', type: 'number', value: x.slot_minutes, attrs: { min: 15, max: 240, step: 15 } })}
  ${field({ label: 'Duración mínima (min)', name: 'min_minutes', type: 'number', value: x.min_minutes, attrs: { min: 15, max: 1440, step: 15 } })}
  ${field({ label: 'Duración máxima (min)', name: 'max_minutes', type: 'number', value: x.max_minutes, attrs: { min: 15, max: 1440, step: 15 } })}
  ${field({ label: 'Margen entre reservas (min)', name: 'buffer_minutes', type: 'number', value: x.buffer_minutes, hint: 'Tiempo de preparación/limpieza tras cada reserva.', attrs: { min: 0, max: 240, step: 15 } })}
</div></fieldset>` : ''}
<fieldset class="apanel"><legend>Horario reservable</legend>
  <p class="small muted">Formato: <code>09:00-14:00, 16:00-19:00</code>. Vacío = cerrado. <code>24h</code> = todo el día. Hora de Madrid (cambios de horario incluidos).</p>
  ${weekFields('h', x.hours)}
</fieldset>
<fieldset class="apanel"><legend>Equipamiento (uno por línea)</legend><div class="agridf">
  ${field({ label: 'Español', name: 'equipment_es', type: 'textarea', rows: 4, value: (x.equipment?.es || []).join('\n') })}
  ${field({ label: 'English', name: 'equipment_en', type: 'textarea', rows: 4, value: (x.equipment?.en || []).join('\n') })}
</div></fieldset>`;

  r.get('/recursos/nuevo', h.adminOnly, (req, res) => h.page(req, res, {
    section: 'resources', title: 'Añadir recurso',
    body: postForm(res, '/admin/recursos/nuevo', html`${resourceForm({ kind: 'booth', capacity: 1, booking_mode: 'request', slot_minutes: 30, min_minutes: 30, max_minutes: 240, buffer_minutes: 0, active: 1, hours: { mon: [['08:00', '20:00']], tue: [['08:00', '20:00']], wed: [['08:00', '20:00']], thu: [['08:00', '20:00']], fri: [['08:00', '20:00']] } }, true)}<div class="abar-actions"><button class="abtn abtn--primary" type="submit">Crear recurso</button></div>`),
  }));

  function readResource(body, kind) {
    const hours = readWeek(body, 'h');
    return {
      name_es: String(body.name_es || '').trim().slice(0, 80), name_en: String(body.name_en || '').trim().slice(0, 80),
      capacity: int(body.capacity, 1, 500), max_fixed: kind === 'desk_pool' ? int(body.max_fixed, 0, 500, { nullable: true }) : null,
      area_m2: body.area_m2 === '' || body.area_m2 === undefined ? null : Math.max(0, Number(body.area_m2) || 0),
      booking_mode: MODE[body.booking_mode] ? body.booking_mode : 'request', group_slug: slugify(body.group_slug || '') || null, active: body.active ? 1 : 0,
      slot_minutes: body.slot_minutes ? int(body.slot_minutes, 15, 240) : 30, min_minutes: body.min_minutes ? int(body.min_minutes, 15, 1440) : 60,
      max_minutes: body.max_minutes ? int(body.max_minutes, 15, 1440) : 480, buffer_minutes: body.buffer_minutes ? int(body.buffer_minutes, 0, 240) : 0,
      hours: JSON.stringify(hours), equipment_es: JSON.stringify(lines(body.equipment_es)), equipment_en: JSON.stringify(lines(body.equipment_en)),
    };
  }

  r.post('/recursos/nuevo', h.adminOnly, h.act((req, res) => {
    const kind = ['room', 'booth', 'studio', 'office'].includes(req.body.kind) ? req.body.kind : null;
    const slug = slugify(req.body.slug);
    if (!kind || !slug) throw new AppError('VALIDATION');
    if (catalog.resource(slug)) throw new AppError('SLUG_EXISTS', 409);
    const v = readResource(req.body, kind);
    if (!v.name_es || !v.name_en) throw new AppError('VALIDATION');
    if (v.min_minutes > v.max_minutes) throw new AppError('VALIDATION');
    const product = { room: 'sala-reuniones', booth: 'cabina', studio: 'estudio', office: 'despacho' }[kind];
    const space = { room: 'salas', booth: 'coworking', studio: 'estudio', office: 'despachos' }[kind];
    const isDays = kind === 'office';
    db.run(`INSERT INTO resources (slug, kind, space_slug, group_slug, product_slug, name_es, name_en, capacity, booking_mode, slot_minutes, min_minutes, max_minutes, buffer_minutes, hours, equipment_es, equipment_en, area_m2, active, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(sort),0)+1 FROM resources))`,
    [slug, kind, space, v.group_slug, product, v.name_es, v.name_en, v.capacity, isDays ? 'quote' : v.booking_mode, isDays ? 1440 : v.slot_minutes, isDays ? 1440 : v.min_minutes, isDays ? 1440 : v.max_minutes, v.buffer_minutes, v.hours, v.equipment_es, v.equipment_en, v.area_m2, v.active]);
    h.audit(req, 'resource.created', 'resource', slug);
    h.done(res, `/admin/recursos/${slug}`, 'created');
  }, { back: '/admin/recursos/nuevo' }));

  r.get('/recursos/:slug', h.adminOnly, (req, res, next) => {
    const x = catalog.resource(req.params.slug);
    if (!x) return next();
    const used = db.get("SELECT COUNT(*) AS n FROM bookings WHERE resource_id = ?", [x.id]).n;
    h.page(req, res, {
      section: 'resources', title: x.name_es,
      body: html`${postForm(res, `/admin/recursos/${x.slug}`, html`${resourceForm(x, false)}<div class="abar-actions"><button class="abtn abtn--primary" type="submit">Guardar</button><a class="abtn abtn--ghost" href="/admin/recursos">Volver</a></div>`)}
${!used && x.kind !== 'desk_pool' && x.kind !== 'tour' ? html`<div class="apanel">${actionButton(res, `/admin/recursos/${x.slug}/borrar`, 'Eliminar recurso', { variant: 'danger', confirm: '¿Eliminar este recurso? No tiene reservas.' })}</div>` : html`<p class="small muted">Este recurso tiene historial de reservas: para retirarlo, desmarca «Activo».</p>`}`,
    });
  });

  r.post('/recursos/:slug', h.adminOnly, h.act((req, res) => {
    const x = catalog.resource(req.params.slug);
    if (!x) throw new AppError('NOT_FOUND', 404);
    const v = readResource(req.body, x.kind);
    if (!v.name_es || !v.name_en || v.min_minutes > v.max_minutes) throw new AppError('VALIDATION');
    db.tx(() => {
      db.run(`UPDATE resources SET name_es = ?, name_en = ?, capacity = ?, max_fixed = ?, area_m2 = ?, booking_mode = ?, group_slug = ?, active = ?,
        slot_minutes = ?, min_minutes = ?, max_minutes = ?, buffer_minutes = ?, hours = ?, equipment_es = ?, equipment_en = ? WHERE id = ?`,
      [v.name_es, v.name_en, v.capacity, v.max_fixed, v.area_m2, x.kind === 'office' ? 'quote' : v.booking_mode, v.group_slug ?? x.group_slug, v.active,
        x.kind === 'desk_pool' || x.kind === 'office' ? x.slot_minutes : v.slot_minutes, x.kind === 'desk_pool' || x.kind === 'office' ? x.min_minutes : v.min_minutes,
        x.kind === 'desk_pool' || x.kind === 'office' ? x.max_minutes : v.max_minutes, v.buffer_minutes, v.hours, v.equipment_es, v.equipment_en, x.id]);
      // Reducir puestos no puede dejar reservas confirmadas sin sitio: se comprueba día a día.
      if (x.kind === 'desk_pool' && v.capacity < x.capacity) {
        const days = db.all("SELECT DISTINCT local_date FROM bookings WHERE resource_id = ? AND kind = 'desk_day' AND local_date >= ? AND status IN ('pending_payment','requested','confirmed')", [x.id, today()]);
        for (const { local_date: dd } of days) if (bookings.deskInfo(dd).raw < 0) throw new AppError('CAPACITY_BELOW_BOOKINGS', 409, { date: dd });
      }
      if (x.kind === 'desk_pool') {
        const fixed = db.get("SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'fixed' AND status IN ('active','past_due','pending_payment')").n;
        if (v.capacity < fixed || (v.max_fixed !== null && v.max_fixed < fixed)) throw new AppError('CAPACITY_BELOW_BOOKINGS', 409, { date: `${fixed} mesas fijas activas` });
        if (v.max_fixed !== null && v.max_fixed > v.capacity) throw new AppError('VALIDATION');
      }
    });
    h.audit(req, 'resource.updated', 'resource', x.slug, { capacity: v.capacity, active: v.active, mode: v.booking_mode });
    h.done(res, `/admin/recursos/${x.slug}`);
  }, { back: (req) => `/admin/recursos/${req.params.slug}` }));

  r.post('/recursos/:slug/borrar', h.adminOnly, h.act((req, res) => {
    const x = catalog.resource(req.params.slug);
    if (!x) throw new AppError('NOT_FOUND', 404);
    if (db.get('SELECT 1 FROM bookings WHERE resource_id = ?', [x.id])) throw new AppError('RESOURCE_IN_USE', 409);
    db.run('DELETE FROM blocks WHERE resource_id = ?', [x.id]);
    db.run('DELETE FROM resources WHERE id = ?', [x.id]);
    h.audit(req, 'resource.deleted', 'resource', x.slug);
    h.done(res, '/admin/recursos', 'deleted');
  }, { back: '/admin/recursos' }));

  // ---------------------------------------------------- tarifas e impuestos
  r.get('/tarifas', h.adminOnly, (req, res) => {
    const c = settings.get('commerce');
    const cs = commerceState(settings, ctx.payments);
    const products = catalog.products({ all: true });
    const pay = ctx.payments;
    h.page(req, res, {
      section: 'pricing', title: 'Tarifas e impuestos',
      body: html`
<section class="apanel">
  <h2>Venta online</h2>
  <p>${cs.canSell ? html`<span class="atag atag--ok">Activa</span> Los clientes pagan online antes de confirmar las reservas con tarifa.`
    : html`<span class="atag atag--warn">Desactivada</span> Las reservas con tarifa se guardan como solicitudes, sin cobro, hasta completar todos los pasos.`}</p>
  <ol class="achecklist">
    <li class="${c.prices_confirmed ? 'done' : ''}">Confirmar que las tarifas son las definitivas</li>
    <li class="${cs.taxReady ? 'done' : ''}">Configurar el tipo de IVA que aplica FRAME</li>
    <li class="${c.conditions_confirmed ? 'done' : ''}">Revisar y aprobar las condiciones (cancelación, cambios y textos legales)</li>
    <li class="${pay.available ? 'done' : ''}">Pasarela de pago: ${pay.provider === 'stripe' ? 'Stripe configurado' : pay.provider === 'test' ? 'pasarela de PRUEBA (no cobra; solo para ensayos)' : 'sin configurar (faltan las claves de Stripe en el servidor)'}</li>
    <li class="${c.sales_enabled ? 'done' : ''}">Activar la venta online</li>
  </ol>
  ${postForm(res, '/admin/tarifas/comercio', html`<div class="agridf">
    ${field({ label: 'Las tarifas están confirmadas', name: 'prices_confirmed', type: 'checkbox', checked: c.prices_confirmed })}
    ${field({ label: 'Las condiciones están aprobadas', name: 'conditions_confirmed', type: 'checkbox', checked: c.conditions_confirmed })}
    ${field({ label: 'Aplicar impuestos', name: 'tax_configured', type: 'checkbox', checked: c.tax_configured, hint: 'Si no se marca, la web muestra importes base sin IVA y no cobra nada.' })}
    ${field({ label: 'Tipo de IVA (%)', name: 'tax_rate', type: 'number', value: c.tax_rate_bp != null ? c.tax_rate_bp / 100 : '', hint: 'Lo decide FRAME con su asesoría (p. ej. 21). La web no lo presupone.', attrs: { min: 0, max: 30, step: '0.01' } })}
    ${field({ label: 'Nombre del impuesto', name: 'tax_label', value: c.tax_label })}
    ${field({ label: 'Activar la venta online', name: 'sales_enabled', type: 'checkbox', checked: c.sales_enabled })}
  </div><button class="abtn abtn--primary" type="submit">Guardar</button>`)}
</section>
<section class="apanel">
  <h2>Tarifas</h2>
  <p class="small muted">Importes base sin impuestos. «Sin tarifa» = se muestra «Solicitar presupuesto». Los cambios solo afectan a operaciones nuevas: cada reserva y pedido guarda el precio aplicado.</p>
  <div class="ascroll"><table class="atable"><thead><tr><th>Producto</th><th>Unidad</th><th class="num">Base</th><th class="num">Precio final</th><th>Estado</th></tr></thead><tbody>
  ${products.map((p) => { const q = quoteProduct(ctx, p, { quantity: 1, minutes: 60 }); return html`<tr>
    <td><a href="/admin/tarifas/${p.slug}"><strong>${p.name_es}</strong></a>${p.featured ? html` <span class="atag atag--info">Destacado</span>` : ''}<br><span class="muted small">${p.summary_es || ''}</span></td>
    <td>${UNIT[p.unit]}</td><td class="num">${p.price_cents === null ? html`<span class="muted">Sin tarifa</span>` : eur(p.price_cents)}</td>
    <td class="num">${q.priced ? (q.price_final ? eur(q.total_cents) : html`<span class="muted">sin IVA configurado</span>`) : '—'}</td>
    <td>${p.active ? html`<span class="atag atag--ok">Visible</span>` : html`<span class="atag atag--off">Oculto</span>`}</td></tr>`; })}
  </tbody></table></div>
</section>`,
    });
  });

  r.post('/tarifas/comercio', h.adminOnly, h.act((req, res) => {
    const b = req.body;
    const taxOn = Boolean(b.tax_configured);
    let bp = null;
    if (String(b.tax_rate ?? '').trim() !== '') {
      const pct = Number(String(b.tax_rate).replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0 || pct > 30) throw new AppError('VALIDATION');
      bp = Math.round(pct * 100);
    }
    if (taxOn && bp === null) throw new AppError('TAX_RATE_REQUIRED', 400);
    const next = settings.set('commerce', {
      ...settings.get('commerce'), prices_confirmed: Boolean(b.prices_confirmed), conditions_confirmed: Boolean(b.conditions_confirmed),
      tax_configured: taxOn, tax_rate_bp: bp, tax_label: String(b.tax_label || 'IVA').trim().slice(0, 20) || 'IVA', sales_enabled: Boolean(b.sales_enabled),
    });
    h.audit(req, 'settings.commerce', 'settings', 'commerce', next);
    h.done(res, '/admin/tarifas');
  }, { back: '/admin/tarifas' }));

  r.get('/tarifas/:slug', h.adminOnly, (req, res, next) => {
    const p = catalog.product(req.params.slug);
    if (!p) return next();
    h.page(req, res, {
      section: 'pricing', title: p.name_es,
      body: postForm(res, `/admin/tarifas/${p.slug}`, html`
<fieldset class="apanel"><legend>Precio</legend><div class="agridf">
  ${field({ label: `Importe base sin impuestos (€ / ${UNIT[p.unit]})`, name: 'price', type: 'number', value: p.price_cents === null ? '' : (p.price_cents / 100).toFixed(2), hint: 'Vacío = sin tarifa publicada (solicitar presupuesto).', attrs: { min: 0, step: '0.01' } })}
  ${p.kind === 'day_pass' ? field({ label: 'Máximo de puestos por reserva', name: 'max_quantity', type: 'number', value: p.max_quantity, attrs: { min: 1, max: 20 } }) : ''}
  ${p.kind === 'bundle' ? field({ label: 'Días incluidos', name: 'credits', type: 'number', value: p.credits, attrs: { min: 1, max: 100 } }) : ''}
  ${p.kind === 'bundle' ? field({ label: 'Validez (días)', name: 'validity_days', type: 'number', value: p.validity_days, attrs: { min: 1, max: 730 } }) : ''}
  ${field({ label: 'Visible en la web', name: 'active', type: 'checkbox', checked: p.active })}
  ${field({ label: 'Destacado', name: 'featured', type: 'checkbox', checked: p.featured })}
</div></fieldset>
<fieldset class="apanel"><legend>Textos</legend><div class="agridf">
  ${field({ label: 'Nombre (ES)', name: 'name_es', value: p.name_es, required: true })}
  ${field({ label: 'Nombre (EN)', name: 'name_en', value: p.name_en, required: true })}
  ${field({ label: 'Resumen (ES)', name: 'summary_es', value: p.summary_es, type: 'textarea', rows: 2 })}
  ${field({ label: 'Resumen (EN)', name: 'summary_en', value: p.summary_en, type: 'textarea', rows: 2 })}
  ${field({ label: 'Incluye (ES, uno por línea)', name: 'includes_es', type: 'textarea', rows: 4, value: (p.includes.es || []).join('\n') })}
  ${field({ label: 'Incluye (EN, uno por línea)', name: 'includes_en', type: 'textarea', rows: 4, value: (p.includes.en || []).join('\n') })}
  ${field({ label: 'Condiciones específicas (ES)', name: 'conditions_es', type: 'textarea', rows: 3, value: p.conditions_es })}
  ${field({ label: 'Condiciones específicas (EN)', name: 'conditions_en', type: 'textarea', rows: 3, value: p.conditions_en })}
</div></fieldset>
<div class="abar-actions"><button class="abtn abtn--primary" type="submit">Guardar</button><a class="abtn abtn--ghost" href="/admin/tarifas">Volver</a></div>`),
    });
  });

  r.post('/tarifas/:slug', h.adminOnly, h.act((req, res) => {
    const p = catalog.product(req.params.slug);
    if (!p) throw new AppError('NOT_FOUND', 404);
    const b = req.body;
    const price = ['visit', 'trial'].includes(p.kind) ? 0 : euros(b.price);
    const nameEs = String(b.name_es || '').trim().slice(0, 80); const nameEn = String(b.name_en || '').trim().slice(0, 80);
    if (!nameEs || !nameEn) throw new AppError('VALIDATION');
    db.run(`UPDATE products SET price_cents = ?, max_quantity = ?, credits = ?, validity_days = ?, active = ?, featured = ?, name_es = ?, name_en = ?,
      summary_es = ?, summary_en = ?, includes_es = ?, includes_en = ?, conditions_es = ?, conditions_en = ?, updated_at = ? WHERE id = ?`,
    [price, p.kind === 'day_pass' ? int(b.max_quantity, 1, 20) : p.max_quantity, p.kind === 'bundle' ? int(b.credits, 1, 100) : p.credits,
      p.kind === 'bundle' ? int(b.validity_days, 1, 730) : p.validity_days, b.active ? 1 : 0, b.featured ? 1 : 0, nameEs, nameEn,
      String(b.summary_es || '').slice(0, 400), String(b.summary_en || '').slice(0, 400), JSON.stringify(lines(b.includes_es)), JSON.stringify(lines(b.includes_en)),
      String(b.conditions_es || '').slice(0, 3000) || null, String(b.conditions_en || '').slice(0, 3000) || null, ctx.now(), p.id]);
    h.audit(req, 'product.updated', 'product', p.slug, { price_cents: price, previous: p.price_cents });
    h.done(res, `/admin/tarifas/${p.slug}`);
  }, { back: (req) => `/admin/tarifas/${req.params.slug}` }));

  // ----------------------------------------------------------------- ajustes
  r.get('/ajustes', h.adminOnly, (req, res) => {
    const s = settings.all();
    const b = s.business; const hr = s.hours; const p = s.policies; const tr = s.trial; const vi = s.visits; const pl = s.plans; const an = s.analytics;
    const sec = (key, title, inner, intro) => html`<section class="apanel" id="${key}"><h2>${title}</h2>${intro ? html`<p class="small muted">${intro}</p>` : ''}${postForm(res, `/admin/ajustes/${key}`, html`${inner}<button class="abtn abtn--primary" type="submit">Guardar</button>`)}</section>`;
    h.page(req, res, {
      section: 'settings', title: 'Ajustes',
      body: html`
<nav class="atoc"><a href="#business">Negocio</a><a href="#hours">Horario</a><a href="#policies">Políticas</a><a href="#trial">Día de prueba</a><a href="#visits">Visitas</a><a href="#plans">Planes</a><a href="#analytics">Analítica</a></nav>
${sec('business', 'Datos del negocio', html`<div class="agridf">
  ${field({ label: 'Marca', name: 'brand', value: b.brand, required: true })}
  ${field({ label: 'Razón social', name: 'legal_name', value: b.legal_name, required: true })}
  ${field({ label: 'NIF', name: 'tax_id', value: b.tax_id, required: true })}
  ${field({ label: 'Dirección', name: 'street', value: b.street, required: true })}
  ${field({ label: 'Código postal', name: 'postal_code', value: b.postal_code, required: true })}
  ${field({ label: 'Ciudad', name: 'city', value: b.city, required: true })}
  ${field({ label: 'Provincia', name: 'province', value: b.province })}
  ${field({ label: 'País', name: 'country', value: b.country })}
  ${field({ label: 'Teléfono', name: 'phone', value: b.phone, required: true })}
  ${field({ label: 'Correo', name: 'email', type: 'email', value: b.email, required: true })}
  ${field({ label: 'Superficie (m²)', name: 'surface_m2', type: 'number', value: b.surface_m2 })}
  ${field({ label: 'Datos registrales (Registro Mercantil)', name: 'registry', value: b.registry, hint: 'Se muestran en el aviso legal. Pendiente de facilitar.' })}
  ${field({ label: 'Instagram (URL)', name: 'instagram', type: 'url', value: b.instagram })}
  ${field({ label: 'LinkedIn (URL)', name: 'linkedin', type: 'url', value: b.linkedin })}
</div>`, 'Datos comerciales y legales que aparecen en la web, los correos y los justificantes. Una sola sede.')}
${sec('hours', 'Horario publicado', html`
  ${field({ label: 'Horario confirmado por FRAME', name: 'confirmed', type: 'checkbox', checked: hr.confirmed, hint: 'Mientras no se confirme, la web lo presenta como orientativo y no lo publica en los datos para buscadores.' })}
  <h3>Recepción</h3>${weekFields('rec', hr.reception)}
  <h3>Coworking</h3>${weekFields('cow', hr.coworking)}
  <p class="small muted">El horario en el que se pueden reservar puestos y salas se edita en cada <a href="/admin/recursos">recurso</a>.</p>
  ${field({ label: 'Acceso 24/7 incluido solo en la mesa fija', name: 'fixed_247', type: 'checkbox', checked: hr.fixed_247 })}`)}
${sec('policies', 'Políticas de reserva', html`<div class="agridf">
  ${field({ label: 'Cancelación gratuita hasta (horas antes)', name: 'cancel_free_hours', type: 'number', value: p.cancel_free_hours, attrs: { min: 0, max: 720 } })}
  ${field({ label: 'Cambios permitidos hasta (horas antes)', name: 'modify_min_hours', type: 'number', value: p.modify_min_hours, attrs: { min: 0, max: 720 } })}
  ${field({ label: 'Antelación mínima para reservar (min)', name: 'min_notice_minutes', type: 'number', value: p.min_notice_minutes, attrs: { min: 0, max: 10080 } })}
  ${field({ label: 'Reserva con antelación máxima (días)', name: 'horizon_days', type: 'number', value: p.horizon_days, attrs: { min: 7, max: 730 } })}
  ${field({ label: 'Tiempo para completar el pago (min)', name: 'payment_hold_minutes', type: 'number', value: p.payment_hold_minutes, attrs: { min: 10, max: 120 } })}
  ${field({ label: 'Retención de una solicitud sin confirmar (h)', name: 'request_hold_hours', type: 'number', value: p.request_hold_hours, attrs: { min: 1, max: 336 } })}
  ${field({ label: 'Preaviso de baja de planes (días)', name: 'plan_cancel_notice_days', type: 'number', value: p.plan_cancel_notice_days, attrs: { min: 0, max: 90 } })}
  ${field({ label: 'Validez de los bonos (días)', name: 'voucher_validity_days', type: 'number', value: p.voucher_validity_days, attrs: { min: 1, max: 730 } })}
  ${field({ label: 'Devolver también fuera de plazo', name: 'late_cancel_refund', type: 'checkbox', checked: p.late_cancel_refund })}
</div>`, 'Se aplican a reservas nuevas y se copian en las condiciones que acepta cada cliente.')}
${sec('trial', 'Día de prueba gratuito', html`<div class="agridf">
  ${field({ label: 'Ofrecer día de prueba', name: 'enabled', type: 'checkbox', checked: tr.enabled })}
  ${field({ label: 'Requiere confirmación de FRAME', name: 'requires_approval', type: 'checkbox', checked: tr.requires_approval })}
  ${field({ label: 'Antelación mínima (horas)', name: 'min_notice_hours', type: 'number', value: tr.min_notice_hours, attrs: { min: 0, max: 720 } })}
  <fieldset class="afield afield--wide"><legend>Días permitidos</legend><div class="achecks">${[[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']].map(([n, l]) => html`<label class="acheck"><input type="checkbox" name="weekdays" value="${n}"${tr.weekdays.includes(n) ? raw(' checked') : ''}> ${l}</label>`)}</div></fieldset>
  ${field({ label: 'Condiciones (ES)', name: 'conditions_es', type: 'textarea', rows: 3, value: tr.conditions_es, wide: true })}
  ${field({ label: 'Condiciones (EN)', name: 'conditions_en', type: 'textarea', rows: 3, value: tr.conditions_en, wide: true })}
</div>`)}
${sec('visits', 'Visitas guiadas', html`<div class="agridf">
  ${field({ label: 'Permitir reservar visitas', name: 'enabled', type: 'checkbox', checked: vi.enabled })}
  ${field({ label: 'Confirmar automáticamente', name: 'auto_confirm', type: 'checkbox', checked: vi.auto_confirm })}
  ${field({ label: 'Máximo de personas por visita', name: 'max_people', type: 'number', value: vi.max_people, attrs: { min: 1, max: 20 } })}
</div>`, 'Las franjas de visita se editan en el recurso «Visitas».')}
${sec('plans', 'Planes mensuales', html`<div class="agridf">
  ${field({ label: 'Máximo de miembros de mesa flexible', name: 'max_flex_members', type: 'number', value: pl.max_flex_members, attrs: { min: 0, max: 1000 } })}
  ${field({ label: 'Permanencia mesa flexible (meses)', name: 'c_flex', type: 'number', value: pl.commitment_months.flex ?? '', hint: '0 = sin permanencia. Vacío = pendiente de definir.', attrs: { min: 0, max: 36 } })}
  ${field({ label: 'Permanencia mesa fija (meses)', name: 'c_fixed', type: 'number', value: pl.commitment_months.fixed ?? '', attrs: { min: 0, max: 36 } })}
  ${field({ label: 'Permanencia oficina virtual (meses)', name: 'c_virtual', type: 'number', value: pl.commitment_months.virtual ?? '', attrs: { min: 0, max: 36 } })}
</div>`)}
${sec('analytics', 'Analítica (solo con consentimiento)', html`<div class="agridf">
  ${field({ label: 'Proveedor', name: 'provider', type: 'select', value: an.provider, options: [['none', 'Ninguno'], ['plausible', 'Plausible'], ['ga4', 'Google Analytics 4']] })}
  ${field({ label: 'Dominio o ID de medición', name: 'site_id', value: an.site_id })}
</div>`, 'El script solo se carga si la persona acepta las cookies de medición en el aviso de cookies.')}`,
    });
  });

  r.post('/ajustes/:key', h.adminOnly, h.act((req, res) => {
    const key = req.params.key;
    const b = req.body;
    const cur = settings.get(key);
    if (!cur) throw new AppError('NOT_FOUND', 404);
    const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
    let next;
    if (key === 'business') {
      for (const f of ['brand', 'legal_name', 'tax_id', 'street', 'postal_code', 'city', 'phone', 'email']) if (!txt(b[f])) throw new AppError('VALIDATION');
      const url = (v) => { const s = txt(v, 300); if (s && !/^https:\/\/[^\s]+$/.test(s)) throw new AppError('VALIDATION'); return s; };
      next = { brand: txt(b.brand, 60), legal_name: txt(b.legal_name, 120), tax_id: txt(b.tax_id, 20), street: txt(b.street), postal_code: txt(b.postal_code, 10), city: txt(b.city, 80),
        province: txt(b.province, 80), country: txt(b.country, 80), phone: txt(b.phone, 40), email: txt(b.email, 160).toLowerCase(), registry: txt(b.registry, 400),
        surface_m2: int(b.surface_m2 || 0, 0, 100000), instagram: url(b.instagram), linkedin: url(b.linkedin) };
    } else if (key === 'hours') {
      next = { confirmed: Boolean(b.confirmed), reception: readWeek(b, 'rec'), coworking: readWeek(b, 'cow'), fixed_247: Boolean(b.fixed_247) };
    } else if (key === 'policies') {
      next = { cancel_free_hours: int(b.cancel_free_hours, 0, 720), modify_min_hours: int(b.modify_min_hours, 0, 720), min_notice_minutes: int(b.min_notice_minutes, 0, 10080),
        horizon_days: int(b.horizon_days, 7, 730), payment_hold_minutes: int(b.payment_hold_minutes, 10, 120), request_hold_hours: int(b.request_hold_hours, 1, 336),
        plan_cancel_notice_days: int(b.plan_cancel_notice_days, 0, 90), voucher_validity_days: int(b.voucher_validity_days, 1, 730), late_cancel_refund: Boolean(b.late_cancel_refund) };
    } else if (key === 'trial') {
      const wd = [].concat(b.weekdays || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      next = { enabled: Boolean(b.enabled), requires_approval: Boolean(b.requires_approval), min_notice_hours: int(b.min_notice_hours, 0, 720), weekdays: [...new Set(wd)],
        conditions_es: txt(b.conditions_es, 2000), conditions_en: txt(b.conditions_en, 2000) };
    } else if (key === 'visits') {
      next = { enabled: Boolean(b.enabled), auto_confirm: Boolean(b.auto_confirm), max_people: int(b.max_people, 1, 20) };
    } else if (key === 'plans') {
      next = { max_flex_members: int(b.max_flex_members, 0, 1000), commitment_months: { flex: int(b.c_flex, 0, 36, { nullable: true }), fixed: int(b.c_fixed, 0, 36, { nullable: true }), virtual: int(b.c_virtual, 0, 36, { nullable: true }) } };
    } else if (key === 'analytics') {
      const provider = ['none', 'plausible', 'ga4'].includes(b.provider) ? b.provider : 'none';
      const site = txt(b.site_id, 120);
      if (site && !/^[A-Za-z0-9.\-_]+$/.test(site)) throw new AppError('VALIDATION');
      next = { provider, site_id: site };
    } else throw new AppError('NOT_FOUND', 404);
    settings.set(key, next);
    h.audit(req, `settings.${key}`, 'settings', key, next);
    h.done(res, `/admin/ajustes#${key}`);
  }, { back: '/admin/ajustes' }));

}
