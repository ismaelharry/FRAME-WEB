// Administración · operativa diaria: panel, calendario, reservas, solicitudes y bloqueos.
import { html, raw } from '../../lib/html.js';
import { AppError, normEmail } from '../../lib/util.js';
import { V, z, parse } from '../../lib/validate.js';
import * as T from '../../lib/time.js';
import { commerceState } from '../../services/settings.js';
import { path } from '../../i18n/routes.js';
import {
  tag, eur, dt, d, hm, bookingWhen, field, postForm, actionButton, pager, empty, kpi,
  BOOKING_STATUS, PAYMENT_STATUS, REQUEST_STATUS, USAGE, ORDER_STATUS,
} from '../../views/admin/ui.js';

const ACTIVE = "('pending_payment','requested','confirmed')";
const KIND = { desk_day: 'Puesto (día)', hourly: 'Por horas', visit: 'Visita', office: 'Despacho' };
const MISSING = {
  prices: 'Confirmar las tarifas', tax: 'Configurar el IVA', conditions: 'Confirmar las condiciones de contratación',
  sales: 'Activar la venta online', gateway: 'Configurar la pasarela de pago (Stripe)',
};
const BLOCK_REASON = { maintenance: 'Mantenimiento', holiday: 'Festivo / cierre', internal: 'Uso interno', other: 'Otro' };

export function operationsRoutes(r, ctx, h) {
  const { db, catalog, bookings, commerce } = ctx;
  const today = () => T.todayLocal(ctx.now());

  const bookingSelect = `SELECT b.*, c.name AS c_name, c.email AS c_email, c.phone AS c_phone, res.name_es AS r_name, res.kind AS r_kind, res.slug AS r_slug
    FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN resources res ON res.id = b.resource_id`;
  const getBooking = (ref) => db.get(`${bookingSelect} WHERE b.ref = ?`, [String(ref).toUpperCase()]);
  const who = (b) => html`<a href="/admin/clientes/${b.customer_id}">${b.c_name || b.c_email}</a>`;
  const service = (b) => (b.r_kind === 'desk_pool' ? html`${USAGE[b.usage]}${b.people > 1 ? ` · ${b.people} puestos` : ''}` : html`${b.r_name}${b.people > 1 ? html` <span class="muted">· ${b.people} pers.</span>` : ''}`);

  // ---------------------------------------------------------------- panel
  r.get('/', (req, res) => {
    const t = today();
    const desk = bookings.deskInfo(t);
    const todayList = db.all(`${bookingSelect} WHERE b.status IN ${ACTIVE} AND b.local_date <= ? AND COALESCE(b.end_date, b.local_date) >= ? ORDER BY b.start_utc`, [t, t]);
    const n = (sql, p = []) => db.get(sql, p).n;
    const pendingConf = n("SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'");
    const newReq = n("SELECT COUNT(*) AS n FROM requests WHERE status = 'new'");
    const month = t.slice(0, 7);
    const [ms] = T.dayBoundsUtc(`${month}-01`);
    const [me] = T.dayBoundsUtc(T.addMonths(`${month}-01`, 1));
    const rev = db.get("SELECT COALESCE(SUM(total_cents - refunded_cents),0) AS s, COUNT(*) AS n FROM orders WHERE status IN ('paid','refunded','refund_pending') AND paid_at >= ? AND paid_at < ?", [ms, me]);
    const plansActive = n("SELECT COUNT(*) AS n FROM plans WHERE status IN ('active','past_due')");
    const cs = commerceState(ctx.settings, ctx.payments);
    const alerts = [];
    if (!cs.canSell) alerts.push(html`La venta online está desactivada. Para activarla falta: ${cs.missing.map((m) => MISSING[m]).join(' · ')}. Mientras tanto, las reservas de pago se guardan como solicitudes sin cobro. <a href="/admin/tarifas">Tarifas e impuestos</a>`);
    if (!ctx.settings.get('hours').confirmed) alerts.push(html`El horario publicado es de demostración. <a href="/admin/ajustes">Confírmalo en Ajustes</a> para que aparezca en los datos estructurados de Google.`);
    const refunds = n("SELECT COUNT(*) AS n FROM orders WHERE status = 'refund_pending'");
    if (refunds) alerts.push(html`${refunds} reembolso(s) pendiente(s). <a href="/admin/pagos?estado=refund_pending">Revisar pagos</a>`);
    const pastDue = n("SELECT COUNT(*) AS n FROM plans WHERE status = 'past_due'");
    if (pastDue) alerts.push(html`${pastDue} plan(es) con el pago de la renovación pendiente. <a href="/admin/planes?estado=past_due">Ver planes</a>`);
    const week = Array.from({ length: 7 }, (_, i) => bookings.deskInfo(T.addDays(t, i)));

    h.page(req, res, {
      section: 'dashboard', title: `Hoy, ${T.fmtDateStr(t, 'es', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      actions: html`<a class="abtn abtn--primary" href="/admin/reservas/nueva">Nueva reserva</a>`,
      body: html`
${alerts.length ? html`<ul class="aalerts">${alerts.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
<div class="akpis">
  ${kpi('Puestos ocupados hoy', desk.open ? `${desk.used + desk.fixed} / ${desk.capacity}` : 'Cerrado', desk.open ? `${desk.fixed} fijos · ${desk.free} libres` : (desk.reason === 'holiday' ? 'Festivo' : 'Sin horario'), `/admin/calendario?fecha=${t}`)}
  ${kpi('Reservas de hoy', todayList.length, 'puestos, salas, cabinas, estudio y visitas', `/admin/reservas?desde=${t}&hasta=${t}`)}
  ${kpi('Por confirmar', pendingConf + newReq, `${pendingConf} reservas · ${newReq} mensajes`, '/admin/solicitudes')}
  ${req.admin.role === 'admin' ? kpi('Cobrado este mes', eur(rev.s), `${rev.n} pedido(s) · importes con los impuestos aplicados en cada pedido`, '/admin/informes') : kpi('Planes activos', plansActive, 'mesa flexible, fija y oficina virtual', '/admin/planes')}
</div>
<div class="agrid2">
  <section class="apanel">
    <h2>Agenda de hoy</h2>
    ${todayList.length ? html`<table class="atable"><thead><tr><th>Hora</th><th>Servicio</th><th>Cliente</th><th>Estado</th></tr></thead><tbody>
      ${todayList.map((b) => html`<tr><td class="mono">${b.kind === 'hourly' || b.kind === 'visit' ? `${hm(b.start_utc)}–${hm(b.end_utc)}` : 'Día'}</td><td><a href="/admin/reservas/${b.ref}">${service(b)}</a></td><td>${who(b)}</td><td>${tag(BOOKING_STATUS, b.status)}</td></tr>`)}
    </tbody></table>` : empty('No hay reservas para hoy.')}
  </section>
  <section class="apanel">
    <h2>Puestos de coworking · próximos 7 días</h2>
    <ul class="abars">${week.map((w) => {
      const occ = w.open ? w.used + w.fixed + w.blockedUnits : 0;
      const pct = w.capacity ? Math.round((occ / w.capacity) * 100) : 0;
      return html`<li><a href="/admin/calendario?fecha=${w.date}"><span>${T.fmtDateStr(w.date, 'es', { weekday: 'short', day: 'numeric' })}</span><span class="abar"><span style="width:${pct}%"></span></span><span class="mono">${w.open ? `${occ}/${w.capacity}` : 'cerrado'}</span></a></li>`;
    })}</ul>
    <p class="small muted">Incluye mesas fijas activas, reservas del día y puestos bloqueados.</p>
  </section>
</div>`,
    });
  });

  // ------------------------------------------------------------ calendario
  r.get('/calendario', (req, res) => {
    const date = T.isDate(req.query.fecha) ? req.query.fecha : today();
    const timed = db.all("SELECT * FROM resources WHERE kind IN ('room','booth','studio','tour') AND active = 1 ORDER BY sort, id");
    const offices = db.all("SELECT * FROM resources WHERE kind = 'office' AND active = 1 ORDER BY sort, id");
    const [ds, de] = T.dayBoundsUtc(date);
    const dayBookings = db.all(`${bookingSelect} WHERE b.status IN ${ACTIVE} AND b.start_utc < ? AND b.end_utc > ?`, [de, ds]);
    const blocks = db.all('SELECT * FROM blocks WHERE start_utc < ? AND end_utc > ?', [de, ds]);
    const H0 = 7 * 60; const H1 = 22 * 60;
    const pos = (ms) => {
      const p = T.zonedParts(ms);
      const mins = ms <= ds ? H0 : (ms >= de ? H1 : p.hour * 60 + p.minute);
      return Math.max(0, Math.min(100, ((mins - H0) / (H1 - H0)) * 100));
    };
    const desk = bookings.deskInfo(date);
    const deskList = dayBookings.filter((b) => b.kind === 'desk_day');
    const hours = []; for (let m = H0; m <= H1; m += 60) hours.push(m);
    const week = Array.from({ length: 7 }, (_, i) => T.addDays(date, i - 3));

    const row = (res0) => {
      const own = dayBookings.filter((b) => b.resource_id === res0.id);
      const blk = blocks.filter((b) => b.resource_id === null || b.resource_id === res0.id);
      const open = T.rangesFor(JSON.parse(res0.hours), date);
      return html`<div class="cal__row"><div class="cal__label"><strong>${res0.name_es}</strong><span>${res0.capacity} pers.</span></div>
        <div class="cal__track">
          ${open.map((rg) => { const [a, b] = T.rangeMinutes(rg); return html`<span class="cal__open" style="left:${((a - H0) / (H1 - H0)) * 100}%;width:${((b - a) / (H1 - H0)) * 100}%"></span>`; })}
          ${blk.map((b) => html`<span class="cal__block" style="left:${pos(b.start_utc)}%;width:${pos(b.end_utc) - pos(b.start_utc)}%" title="Bloqueo: ${BLOCK_REASON[b.reason]}${b.note ? ` · ${b.note}` : ''}"></span>`)}
          ${own.map((b) => html`<a class="cal__ev cal__ev--${b.status}" href="/admin/reservas/${b.ref}" style="left:${pos(b.start_utc)}%;width:${Math.max(2, pos(b.end_utc) - pos(b.start_utc))}%" title="${b.ref} · ${hm(b.start_utc)}–${hm(b.end_utc)} · ${b.c_name || b.c_email}"><span>${hm(b.start_utc)} ${b.c_name || b.c_email}</span></a>`)}
        </div></div>`;
    };

    h.page(req, res, {
      section: 'calendar', title: 'Calendario', wide: true,
      actions: html`<a class="abtn abtn--primary" href="/admin/reservas/nueva?fecha=${date}">Nueva reserva</a>`,
      body: html`
<form class="afilters" method="get">
  <a class="abtn" href="?fecha=${T.addDays(date, -1)}" aria-label="Día anterior">←</a>
  <input type="date" name="fecha" value="${date}" aria-label="Fecha">
  <a class="abtn" href="?fecha=${T.addDays(date, 1)}" aria-label="Día siguiente">→</a>
  <button class="abtn" type="submit">Ir</button>
  <a class="abtn abtn--ghost" href="?fecha=${today()}">Hoy</a>
  <strong class="afilters__title">${T.fmtDateStr(date, 'es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
</form>
<ul class="aweek">${week.map((w) => { const i = bookings.deskInfo(w); return html`<li><a href="?fecha=${w}"${w === date ? raw(' aria-current="date"') : ''}><span>${T.fmtDateStr(w, 'es', { weekday: 'short', day: 'numeric' })}</span><strong>${i.open ? `${i.used + i.fixed}/${i.capacity}` : '—'}</strong></a></li>`; })}</ul>
<section class="apanel">
  <h2>Puestos de coworking</h2>
  ${desk.open ? html`<p><strong>${desk.used + desk.fixed} de ${desk.capacity}</strong> puestos ocupados (${desk.fixed} mesas fijas, ${desk.used} reservas${desk.blockedUnits ? `, ${desk.blockedUnits} bloqueados` : ''}) · <strong>${desk.free}</strong> libres.</p>`
    : html`<p>Cerrado ${desk.reason === 'holiday' ? '(festivo)' : ''}${desk.note ? ` · ${desk.note}` : ''}.</p>`}
  ${deskList.length ? html`<table class="atable atable--compact"><tbody>${deskList.map((b) => html`<tr><td><a href="/admin/reservas/${b.ref}" class="mono">${b.ref}</a></td><td>${USAGE[b.usage]}</td><td>${b.people} puesto(s)</td><td>${who(b)}</td><td>${tag(BOOKING_STATUS, b.status)}</td></tr>`)}</tbody></table>` : ''}
</section>
<section class="apanel">
  <h2>Salas, cabinas, estudio y visitas</h2>
  <div class="cal" role="group" aria-label="Ocupación por horas">
    <div class="cal__row cal__row--head"><div class="cal__label"></div><div class="cal__track">${hours.map((m) => html`<span class="cal__hour" style="left:${((m - H0) / (H1 - H0)) * 100}%">${String(m / 60).padStart(2, '0')}</span>`)}</div></div>
    ${timed.map(row)}
  </div>
  <p class="small muted cal__legend"><span class="cal__key cal__key--open"></span> horario de reserva <span class="cal__key cal__key--confirmed"></span> confirmada <span class="cal__key cal__key--requested"></span> solicitud o pago pendiente <span class="cal__key cal__key--block"></span> bloqueo</p>
</section>
<section class="apanel">
  <h2>Despachos</h2>
  <table class="atable atable--compact"><tbody>${offices.map((o) => {
    const b = dayBookings.find((x) => x.resource_id === o.id);
    return html`<tr><td><strong>${o.name_es}</strong></td><td>${b ? html`<a href="/admin/reservas/${b.ref}">${b.c_name || b.c_email}</a> · ${d(b.local_date)} → ${d(b.end_date)}` : html`<span class="muted">Libre</span>`}</td></tr>`;
  })}</tbody></table>
</section>`,
    });
  });

  // -------------------------------------------------------------- reservas
  function bookingFilters(q) {
    const where = []; const p = [];
    if (q.q) { where.push('(b.ref LIKE ? OR c.email LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); const s = `%${String(q.q).trim()}%`; p.push(s, s, s, s); }
    if (q.estado === 'activas') where.push(`b.status IN ${ACTIVE}`);
    else if (BOOKING_STATUS[q.estado]) { where.push('b.status = ?'); p.push(q.estado); }
    if (KIND[q.tipo]) { where.push('b.kind = ?'); p.push(q.tipo); }
    if (q.recurso) { where.push('res.slug = ?'); p.push(String(q.recurso)); }
    if (T.isDate(q.desde)) { where.push('COALESCE(b.end_date, b.local_date) >= ?'); p.push(q.desde); }
    if (T.isDate(q.hasta)) { where.push('b.local_date <= ?'); p.push(q.hasta); }
    if (q.pago && PAYMENT_STATUS[q.pago]) { where.push('b.payment_status = ?'); p.push(q.pago); }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
  }

  r.get('/reservas', (req, res) => {
    const q = { estado: 'activas', desde: today(), ...req.query };
    if (req.query.todas) { q.estado = ''; q.desde = ''; }
    const f = bookingFilters(q);
    const total = db.get(`SELECT COUNT(*) AS n FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN resources res ON res.id = b.resource_id ${f.sql}`, f.p).n;
    const per = 50; const pages = Math.max(1, Math.ceil(total / per)); const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    const rows = db.all(`${bookingSelect} ${f.sql} ORDER BY b.start_utc ${q.desde ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`, [...f.p, per, (page - 1) * per]);
    const resources = catalog.resources({ all: true });
    const csv = new URLSearchParams({ ...q, p: '' }); csv.delete('p');
    h.page(req, res, {
      section: 'bookings', title: 'Reservas',
      actions: html`<a class="abtn" href="/admin/reservas.csv?${csv}">Exportar CSV</a><a class="abtn abtn--primary" href="/admin/reservas/nueva">Nueva reserva</a>`,
      body: html`
<form class="afilters" method="get">
  <input type="search" name="q" value="${q.q || ''}" placeholder="Referencia, nombre, correo o teléfono" aria-label="Buscar">
  <select name="estado" aria-label="Estado"><option value="">Todos los estados</option><option value="activas"${q.estado === 'activas' ? raw(' selected') : ''}>Activas</option>${Object.entries(BOOKING_STATUS).map(([k, [l]]) => html`<option value="${k}"${q.estado === k ? raw(' selected') : ''}>${l}</option>`)}</select>
  <select name="tipo" aria-label="Tipo"><option value="">Todos los tipos</option>${Object.entries(KIND).map(([k, l]) => html`<option value="${k}"${q.tipo === k ? raw(' selected') : ''}>${l}</option>`)}</select>
  <select name="recurso" aria-label="Espacio"><option value="">Todos los espacios</option>${resources.map((x) => html`<option value="${x.slug}"${q.recurso === x.slug ? raw(' selected') : ''}>${x.name_es}</option>`)}</select>
  <label>Desde <input type="date" name="desde" value="${q.desde || ''}"></label>
  <label>Hasta <input type="date" name="hasta" value="${q.hasta || ''}"></label>
  <button class="abtn" type="submit">Filtrar</button>
  <a class="abtn abtn--ghost" href="/admin/reservas?todas=1">Ver todas</a>
</form>
<p class="small muted">${total} reserva(s)</p>
${rows.length ? html`<div class="ascroll"><table class="atable">
  <thead><tr><th>Ref.</th><th>Fecha</th><th>Servicio</th><th>Cliente</th><th>Estado</th><th>Cobro</th><th class="num">Importe</th></tr></thead>
  <tbody>${rows.map((b) => html`<tr>
    <td><a class="mono" href="/admin/reservas/${b.ref}">${b.ref}</a></td><td>${bookingWhen(b)}</td><td>${service(b)}</td><td>${who(b)}</td>
    <td>${tag(BOOKING_STATUS, b.status)}</td><td>${tag(PAYMENT_STATUS, b.payment_status)}</td><td class="num">${b.total_cents ? eur(b.total_cents) : '—'}</td></tr>`)}</tbody>
</table></div>${pager(req, page, pages)}` : empty('No hay reservas con estos filtros.')}`,
    });
  });

  r.get('/reservas.csv', (req, res) => {
    const f = bookingFilters({ estado: '', ...req.query });
    const rows = db.all(`${bookingSelect} ${f.sql} ORDER BY b.start_utc LIMIT 20000`, f.p);
    const cell = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
    const lines = [['referencia', 'fecha', 'inicio', 'fin', 'tipo', 'uso', 'espacio', 'personas', 'cliente', 'correo', 'telefono', 'estado', 'cobro', 'importe_eur', 'origen'].join(';')];
    for (const b of rows) {
      lines.push([b.ref, b.local_date, b.kind === 'desk_day' || b.kind === 'office' ? '' : hm(b.start_utc), b.kind === 'office' ? b.end_date : (b.kind === 'desk_day' ? '' : hm(b.end_utc)),
        KIND[b.kind], USAGE[b.usage], b.r_name, b.people, b.c_name, b.c_email, b.c_phone, BOOKING_STATUS[b.status]?.[0], PAYMENT_STATUS[b.payment_status]?.[0],
        b.total_cents != null ? (b.total_cents / 100).toFixed(2).replace('.', ',') : '', b.source].map(cell).join(';'));
    }
    h.audit(req, 'export.bookings', 'bookings', null, { count: rows.length });
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="reservas-${today()}.csv"`).send(`﻿${lines.join('\r\n')}`);
  });

  // Nueva reserva (recepción)
  r.get('/reservas/nueva', (req, res) => {
    const resources = catalog.resources().filter((x) => ['room', 'booth', 'studio', 'tour'].includes(x.kind));
    const offices = catalog.resources().filter((x) => x.kind === 'office');
    const pre = req.query;
    const cust = pre.cliente ? db.get('SELECT * FROM customers WHERE id = ?', [Number(pre.cliente)]) : null;
    h.page(req, res, {
      section: 'bookings', title: 'Nueva reserva',
      body: html`
<p class="muted">Las reservas internas respetan la disponibilidad real: no se pueden solapar con otras reservas ni superar el inventario de puestos.</p>
${postForm(res, '/admin/reservas/nueva', html`
<fieldset class="apanel"><legend>Qué se reserva</legend><div class="agridf">
  ${field({ label: 'Tipo', name: 'tipo', type: 'select', value: pre.tipo || (pre.recurso ? 'timed' : 'desk_day'), options: [['desk_day', 'Puesto de coworking (día)'], ['timed', 'Sala, cabina, estudio o visita (por horas)'], ['office', 'Despacho (por fechas)']], attrs: { 'data-kind-switch': '' } })}
  ${field({ label: 'Espacio (por horas)', name: 'recurso', type: 'select', value: pre.recurso || '', options: resources.map((x) => [x.slug, x.name_es]), attrs: { 'data-for': 'timed' } })}
  ${field({ label: 'Despacho', name: 'despacho', type: 'select', options: offices.map((x) => [x.slug, x.name_es]), attrs: { 'data-for': 'office' } })}
  ${field({ label: 'Fecha', name: 'fecha', type: 'date', value: pre.fecha || today(), required: true })}
  ${field({ label: 'Hora de inicio', name: 'hora', type: 'time', value: pre.hora || '10:00', attrs: { step: 900, 'data-for': 'timed' } })}
  ${field({ label: 'Duración (minutos)', name: 'duracion', type: 'number', value: 60, attrs: { min: 15, step: 15, 'data-for': 'timed' } })}
  ${field({ label: 'Fecha de salida (despacho, no incluida)', name: 'hasta', type: 'date', attrs: { 'data-for': 'office' } })}
  ${field({ label: 'Personas / puestos', name: 'personas', type: 'number', value: 1, attrs: { min: 1, max: 50 } })}
</div></fieldset>
<fieldset class="apanel"><legend>Cliente</legend><div class="agridf">
  ${field({ label: 'Correo', name: 'email', type: 'email', value: cust?.email || '', required: true })}
  ${field({ label: 'Nombre', name: 'nombre', value: cust?.name || '' })}
  ${field({ label: 'Teléfono', name: 'telefono', value: cust?.phone || '' })}
  ${field({ label: 'Empresa', name: 'empresa', value: cust?.company || '' })}
  ${field({ label: 'Idioma de los correos', name: 'idioma', type: 'select', value: cust?.lang || 'es', options: [['es', 'Español'], ['en', 'English']] })}
</div></fieldset>
<fieldset class="apanel"><legend>Estado y cobro</legend><div class="agridf">
  ${field({ label: 'Estado', name: 'estado', type: 'select', options: [['confirmed', 'Confirmada'], ['requested', 'Solicitud (bloquea el hueco 48 h)']] })}
  ${field({ label: 'Cobro', name: 'cobro', type: 'select', options: [['none', 'Sin cobro'], ['unpaid', 'Pendiente de cobrar'], ['offline', 'Cobrado en recepción'], ['included', 'Incluido en su plan']] })}
  ${field({ label: 'Importe total (€, solo despachos)', name: 'importe', type: 'number', attrs: { min: 0, step: '0.01', 'data-for': 'office' } })}
  ${field({ label: 'Notas visibles para el cliente', name: 'notas', type: 'textarea', rows: 2, wide: true })}
  ${field({ label: 'Notas internas', name: 'internas', type: 'textarea', rows: 2, wide: true })}
  ${field({ label: 'Enviar correo de confirmación al cliente', name: 'avisar', type: 'checkbox', checked: true, wide: true })}
</div></fieldset>
<div class="abar-actions"><button class="abtn abtn--primary" type="submit">Crear reserva</button><a class="abtn abtn--ghost" href="/admin/reservas">Cancelar</a></div>`)}`,
    });
  });

  r.post('/reservas/nueva', h.act((req, res) => {
    const b = parse(z.object({
      tipo: z.enum(['desk_day', 'timed', 'office']), recurso: V.optText(60), despacho: V.optText(60), fecha: V.date, hora: V.optText(5), duracion: V.optText(5), hasta: V.optText(10),
      personas: V.int(1, 50), email: V.email, nombre: V.optText(120), telefono: V.optText(40), empresa: V.optText(120), idioma: V.lang,
      estado: z.enum(['confirmed', 'requested']), cobro: z.enum(['none', 'unpaid', 'offline', 'included']), importe: V.optText(12),
      notas: V.optText(1000), internas: V.optText(2000), avisar: V.bool.optional(),
    }), req.body);
    const customer = { email: b.email, name: b.nombre, phone: b.telefono, company: b.empresa, lang: b.idioma };
    const common = { usage: 'admin', date: b.fecha, people: b.personas, customer, lang: b.idioma, status: b.estado, payment_status: b.cobro, notes: b.notas || null, adminNotes: b.internas || null, actorId: req.admin.id };
    let out;
    if (b.tipo === 'desk_day') out = bookings.createDeskDay(common);
    else if (b.tipo === 'timed') out = bookings.createTimed({ ...common, resource: b.recurso, time: b.hora, duration: Number(b.duracion) });
    else {
      if (!T.isDate(b.hasta)) throw new AppError('INVALID_DATE');
      const cents = b.importe ? Math.round(Number(String(b.importe).replace(',', '.')) * 100) : null;
      if (cents !== null && (!Number.isFinite(cents) || cents < 0)) throw new AppError('VALIDATION');
      out = bookings.createOfficeLease({ resource: b.despacho, from: b.fecha, to: b.hasta, people: b.personas, customer, status: b.estado, payment_status: b.cobro, notes: b.notas, adminNotes: b.internas, total_cents: cents, actorId: req.admin.id });
    }
    if (b.avisar) ctx.notify(b.estado === 'confirmed' ? 'booking.confirmed' : 'booking.requested', { bookingId: out.booking.id });
    h.done(res, `/admin/reservas/${out.booking.ref}`, 'created');
  }, { back: '/admin/reservas/nueva' }));

  // Ficha de una reserva
  r.get('/reservas/:ref', (req, res, next) => {
    const b = getBooking(req.params.ref);
    if (!b) return next();
    const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
    const order = b.order_id ? db.get('SELECT * FROM orders WHERE id = ?', [b.order_id]) : null;
    const voucher = b.voucher_id ? db.get('SELECT * FROM vouchers WHERE id = ?', [b.voucher_id]) : null;
    const plan = b.plan_id ? db.get('SELECT * FROM plans WHERE id = ?', [b.plan_id]) : null;
    const log = db.all("SELECT * FROM audit_log WHERE entity = 'booking' AND entity_id = ? ORDER BY id DESC LIMIT 50", [b.ref]);
    const mails = db.all('SELECT id, subject, status, created_at FROM outbox WHERE related_ref = ? ORDER BY id DESC LIMIT 20', [b.ref]);
    const active = ['pending_payment', 'requested', 'confirmed'].includes(b.status);
    const manageUrl = `${ctx.cfg.baseUrl}${path('manage', b.lang, `/${b.ref}`)}?t=${bookings.manageToken(b.ref, c)}`;
    const isAdmin = req.admin.role === 'admin';
    const dur = Math.round((b.end_utc - b.start_utc) / 60_000);
    h.page(req, res, {
      section: 'bookings', title: `Reserva ${b.ref}`,
      actions: html`${tag(BOOKING_STATUS, b.status)} ${tag(PAYMENT_STATUS, b.payment_status)}`,
      body: html`
<div class="agrid2">
  <section class="apanel">
    <h2>Detalle</h2>
    <dl class="adl">
      <dt>Servicio</dt><dd>${KIND[b.kind]} · ${USAGE[b.usage]} · ${b.r_name}</dd>
      <dt>Fecha</dt><dd>${bookingWhen(b)}</dd>
      <dt>Personas</dt><dd>${b.people}</dd>
      <dt>Cliente</dt><dd>${who(b)} · <a href="mailto:${b.c_email}">${b.c_email}</a>${b.c_phone ? html` · <a href="tel:${b.c_phone}">${b.c_phone}</a>` : ''}</dd>
      <dt>Origen</dt><dd>${b.source === 'admin' ? 'Panel' : 'Web'} · creada ${dt(b.created_at)}${b.confirmed_at ? ` · confirmada ${dt(b.confirmed_at)}` : ''}${b.cancelled_at ? ` · cancelada ${dt(b.cancelled_at)}` : ''}</dd>
      ${b.hold_expires_at && active && b.status !== 'confirmed' ? html`<dt>Hueco retenido hasta</dt><dd>${dt(b.hold_expires_at)}</dd>` : ''}
      ${b.notes ? html`<dt>Notas del cliente</dt><dd>${b.notes}</dd>` : ''}
      ${b.cancel_reason ? html`<dt>Motivo</dt><dd>${b.cancel_reason}</dd>` : ''}
      ${voucher ? html`<dt>Bono</dt><dd><a href="/admin/bonos/${voucher.id}" class="mono">${voucher.code}</a></dd>` : ''}
      ${plan ? html`<dt>Plan</dt><dd><a href="/admin/planes?q=${plan.ref}" class="mono">${plan.ref}</a></dd>` : ''}
    </dl>
    <h3>Importe guardado al reservar</h3>
    ${b.total_cents != null || b.unit_price_cents != null ? html`<dl class="adl">
      <dt>Precio unitario</dt><dd>${eur(b.unit_price_cents)} × ${b.quantity ?? 1}</dd>
      <dt>Base</dt><dd>${eur(b.subtotal_cents)}</dd>
      <dt>Impuestos</dt><dd>${b.tax_rate_bp != null ? `${(b.tax_rate_bp / 100).toLocaleString('es-ES')} % · ${eur(b.tax_cents)}` : 'No configurados'}</dd>
      <dt>Total</dt><dd><strong>${eur(b.total_cents)}</strong>${b.price_final ? '' : html` <span class="muted">(sin impuestos configurados: importe orientativo)</span>`}</dd>
    </dl>` : html`<p class="muted">Sin importe (reserva sin tarifa publicada o interna).</p>`}
    ${order ? html`<p>Pedido <a class="mono" href="/admin/pagos?q=${order.ref}">${order.ref}</a> · ${tag(ORDER_STATUS, order.status)} · ${eur(order.total_cents)}</p>` : ''}
    ${b.conditions ? html`<details><summary>Condiciones aceptadas</summary><pre class="apre">${b.conditions}</pre></details>` : ''}
  </section>
  <section class="apanel">
    <h2>Acciones</h2>
    ${b.status === 'requested' ? html`<div class="aactions">
      ${postForm(res, `/admin/reservas/${b.ref}/confirmar`, html`<label>Cobro <select name="cobro"><option value="">Sin cambios</option><option value="unpaid">Pendiente de cobrar</option><option value="offline">Cobrado en recepción</option><option value="none">Sin cobro</option></select></label> <button class="abtn abtn--primary" type="submit">Confirmar y avisar</button>`, { inline: true })}
      ${postForm(res, `/admin/reservas/${b.ref}/rechazar`, html`<input name="motivo" placeholder="Motivo (opcional)" aria-label="Motivo del rechazo"> <button class="abtn abtn--danger" type="submit">Rechazar</button>`, { inline: true, confirm: '¿Rechazar esta solicitud? Se liberará el hueco y se avisará al cliente.' })}
    </div>` : ''}
    ${active && b.kind !== 'office' ? html`<details class="adetails"${req.query.cambiar ? raw(' open') : ''}><summary>Cambiar fecha u hora</summary>
      ${postForm(res, `/admin/reservas/${b.ref}/cambiar`, html`<div class="agridf">
        ${field({ label: 'Fecha', name: 'fecha', type: 'date', value: b.local_date, required: true })}
        ${b.kind !== 'desk_day' ? field({ label: 'Hora', name: 'hora', type: 'time', value: hm(b.start_utc), attrs: { step: 900 } }) : ''}
        ${b.kind !== 'desk_day' ? field({ label: 'Duración (min)', name: 'duracion', type: 'number', value: dur, attrs: { min: 15, step: 15 } }) : ''}
        ${field({ label: 'Personas', name: 'personas', type: 'number', value: b.people, attrs: { min: 1, max: 50 } })}
        ${field({ label: 'Avisar al cliente', name: 'avisar', type: 'checkbox', checked: true })}
      </div><button class="abtn" type="submit">Guardar cambio</button>`)}
    </details>` : ''}
    ${active ? html`<details class="adetails"><summary>Cancelar reserva</summary>
      ${postForm(res, `/admin/reservas/${b.ref}/cancelar`, html`<div class="agridf">
        ${field({ label: 'Devolución', name: 'devolucion', type: 'select', options: [['auto', 'Según la política de cancelación'], ['si', 'Devolver (días de bono o importe pagado)'], ['no', 'No devolver']] })}
        ${field({ label: 'Motivo', name: 'motivo', value: '' })}
        ${field({ label: 'Avisar al cliente', name: 'avisar', type: 'checkbox', checked: true })}
      </div><button class="abtn abtn--danger" type="submit">Cancelar reserva</button>`, { confirm: '¿Cancelar esta reserva? El hueco quedará libre.' })}
    </details>` : ''}
    ${isAdmin && active && ['unpaid', 'none', 'failed'].includes(b.payment_status) && !(order && order.status === 'paid') ? actionButton(res, `/admin/reservas/${b.ref}/cobrado`, 'Marcar como cobrado en recepción', { confirm: '¿Confirmas que se ha cobrado en recepción?' }) : ''}
    ${active ? actionButton(res, `/admin/reservas/${b.ref}/reenviar`, 'Reenviar correo al cliente', { variant: 'ghost' }) : ''}
    <h3>Notas internas</h3>
    ${postForm(res, `/admin/reservas/${b.ref}/notas`, html`<textarea name="internas" rows="3" aria-label="Notas internas">${b.admin_notes || ''}</textarea><button class="abtn" type="submit">Guardar notas</button>`)}
    <h3>Enlace de gestión del cliente</h3>
    <p class="small muted">Permite ver, cambiar o cancelar esta reserva sin cuenta. Compártelo solo con el titular.</p>
    <div class="acopy"><input readonly value="${manageUrl}" aria-label="Enlace de gestión"><button class="abtn abtn--ghost" type="button" data-copy>Copiar</button></div>
  </section>
</div>
<div class="agrid2">
  <section class="apanel"><h2>Historial</h2>${log.length ? html`<ul class="alog">${log.map((l) => html`<li><span class="mono">${dt(l.created_at)}</span> ${l.action} <span class="muted">· ${l.actor}</span></li>`)}</ul>` : empty('Sin movimientos.')}</section>
  <section class="apanel"><h2>Correos</h2>${mails.length ? html`<ul class="alog">${mails.map((m) => html`<li><span class="mono">${dt(m.created_at)}</span> <a href="/admin/correos/${m.id}">${m.subject}</a> <span class="muted">· ${m.status === 'sent' ? 'enviado' : m.status === 'not_sent_test_mode' ? 'modo prueba' : m.status}</span></li>`)}</ul>` : empty('Sin correos.')}</section>
</div>`,
    });
  });

  const back = (req) => `/admin/reservas/${String(req.params.ref).toUpperCase()}`;
  const mustBooking = (req) => { const b = getBooking(req.params.ref); if (!b) throw new AppError('NOT_FOUND', 404); return b; };

  r.post('/reservas/:ref/confirmar', h.act((req, res) => {
    const b = mustBooking(req);
    const ps = ['unpaid', 'offline', 'none'].includes(req.body.cobro) ? req.body.cobro : undefined;
    if (ps === 'offline' && req.admin.role !== 'admin') throw new AppError('FORBIDDEN', 403);
    bookings.confirm(b.id, { actorId: req.admin.id, payment_status: ps });
    ctx.notify('booking.confirmed', { bookingId: b.id });
    h.done(res, back(req), 'confirmed');
  }, { back }));

  r.post('/reservas/:ref/rechazar', h.act((req, res) => {
    const b = mustBooking(req);
    if (b.status !== 'requested') throw new AppError('NOT_CONFIRMABLE', 409);
    bookings.cancel(b.id, { actor: 'admin', actorId: req.admin.id, reason: 'rejected', forceRefund: true });
    if (req.body.motivo) db.run('UPDATE bookings SET admin_notes = TRIM(COALESCE(admin_notes, \'\') || ?) WHERE id = ?', [`\nRechazo: ${String(req.body.motivo).slice(0, 300)}`, b.id]);
    ctx.notify('booking.rejected', { bookingId: b.id });
    h.done(res, back(req), 'rejected');
  }, { back }));

  r.post('/reservas/:ref/cambiar', h.act((req, res) => {
    const b = mustBooking(req);
    const v = parse(z.object({ fecha: V.date, hora: V.optText(5), duracion: V.optText(5), personas: V.int(1, 50), avisar: V.bool.optional() }), req.body);
    bookings.change(b.id, { date: v.fecha, time: v.hora || undefined, duration: v.duracion ? Number(v.duracion) : undefined, people: v.personas }, { actor: 'admin', actorId: req.admin.id });
    if (v.avisar) ctx.notify('booking.changed', { bookingId: b.id });
    h.done(res, back(req), 'changed');
  }, { back }));

  r.post('/reservas/:ref/cancelar', h.act(async (req, res) => {
    const b = mustBooking(req);
    const mode = req.body.devolucion;
    if (mode === 'si' && req.admin.role !== 'admin' && b.payment_status === 'paid') throw new AppError('FORBIDDEN', 403);
    const out = bookings.cancel(b.id, { actor: 'admin', actorId: req.admin.id, reason: String(req.body.motivo || '').slice(0, 300) || 'admin', forceRefund: mode === 'si' ? true : (mode === 'no' ? false : null) });
    if (out.refund === 'payment' && out.order) await commerce.refundOrder(db.get('SELECT * FROM orders WHERE id = ?', [out.order.id])).catch((e) => console.error('[refund]', e));
    if (req.body.avisar) ctx.notify('booking.cancelled', { bookingId: b.id });
    h.done(res, back(req), 'cancelled');
  }, { back }));

  r.post('/reservas/:ref/cobrado', h.adminOnly, h.act((req, res) => {
    const b = mustBooking(req);
    db.run("UPDATE bookings SET payment_status = 'offline', updated_at = ? WHERE id = ?", [ctx.now(), b.id]);
    h.audit(req, 'booking.paid_offline', 'booking', b.ref);
    h.done(res, back(req), 'paid');
  }, { back }));

  r.post('/reservas/:ref/reenviar', h.act((req, res) => {
    const b = mustBooking(req);
    ctx.notify(b.status === 'confirmed' ? 'booking.confirmed' : 'booking.requested', { bookingId: b.id });
    h.done(res, back(req), 'resent');
  }, { back }));

  r.post('/reservas/:ref/notas', h.act((req, res) => {
    const b = mustBooking(req);
    db.run('UPDATE bookings SET admin_notes = ?, updated_at = ? WHERE id = ?', [String(req.body.internas || '').slice(0, 4000), ctx.now(), b.id]);
    h.done(res, back(req));
  }, { back }));

  // ----------------------------------------------------------- solicitudes
  r.get('/solicitudes', (req, res) => {
    const pend = db.all(`${bookingSelect} WHERE b.status = 'requested' ORDER BY b.start_utc`);
    const plans = db.all("SELECT p.*, c.name AS c_name, c.email AS c_email, pr.name_es AS p_name FROM plans p JOIN customers c ON c.id = p.customer_id JOIN products pr ON pr.id = p.product_id WHERE p.status = 'requested' ORDER BY p.created_at");
    const st = REQUEST_STATUS[req.query.estado] ? req.query.estado : (req.query.estado === 'todas' ? null : 'open');
    const reqs = db.all(`SELECT * FROM requests ${st === 'open' ? "WHERE status IN ('new','in_progress')" : st ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 200`, st && st !== 'open' ? [st] : []);
    h.page(req, res, {
      section: 'requests', title: 'Solicitudes',
      body: html`
<section class="apanel">
  <h2>Reservas pendientes de confirmar <span class="abadge">${pend.length}</span></h2>
  ${pend.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Ref.</th><th>Fecha</th><th>Servicio</th><th>Cliente</th><th>Retenida hasta</th><th></th></tr></thead><tbody>
    ${pend.map((b) => html`<tr><td><a class="mono" href="/admin/reservas/${b.ref}">${b.ref}</a></td><td>${bookingWhen(b)}</td><td>${service(b)}</td><td>${who(b)}</td><td>${dt(b.hold_expires_at)}</td>
      <td class="aactions">${actionButton(res, `/admin/reservas/${b.ref}/confirmar`, 'Confirmar', { variant: 'primary' })}<a class="abtn abtn--ghost" href="/admin/reservas/${b.ref}">Abrir</a></td></tr>`)}
  </tbody></table></div>` : empty('No hay reservas pendientes de confirmar.')}
</section>
<section class="apanel">
  <h2>Altas de planes solicitadas <span class="abadge">${plans.length}</span></h2>
  ${plans.length ? html`<table class="atable"><tbody>${plans.map((p) => html`<tr><td class="mono">${p.ref}</td><td>${p.p_name}</td><td><a href="/admin/clientes/${p.customer_id}">${p.c_name || p.c_email}</a></td><td>Desde ${d(p.start_date)}</td><td><a class="abtn abtn--ghost" href="/admin/planes?q=${p.ref}">Gestionar</a></td></tr>`)}</tbody></table>` : empty('No hay altas pendientes.')}
</section>
<section class="apanel">
  <h2>Mensajes y presupuestos</h2>
  <form class="afilters" method="get"><select name="estado" aria-label="Estado"><option value="">Abiertas</option>${Object.entries(REQUEST_STATUS).map(([k, [l]]) => html`<option value="${k}"${req.query.estado === k ? raw(' selected') : ''}>${l}</option>`)}<option value="todas"${req.query.estado === 'todas' ? raw(' selected') : ''}>Todas</option></select><button class="abtn" type="submit">Filtrar</button></form>
  ${reqs.length ? html`<div class="areqs">${reqs.map((q) => html`<article class="areq">
    <header><span class="mono">${q.ref}</span> ${tag(REQUEST_STATUS, q.status)} <strong>${q.type === 'quote' ? 'Presupuesto' : 'Contacto'}${q.topic ? ` · ${q.topic}` : ''}</strong><span class="muted">${dt(q.created_at)}</span></header>
    <p><strong>${q.name}</strong> · <a href="mailto:${q.email}">${q.email}</a>${q.phone ? html` · <a href="tel:${q.phone}">${q.phone}</a>` : ''}${q.company ? ` · ${q.company}` : ''}${q.team_size ? ` · ${q.team_size} personas` : ''}${q.start_date ? ` · desde ${d(q.start_date)}` : ''}${q.lang === 'en' ? ' · inglés' : ''}${q.marketing_opt_in ? ' · acepta comunicaciones' : ''}</p>
    ${q.message ? html`<p class="apre">${q.message}</p>` : ''}
    ${postForm(res, `/admin/solicitudes/${q.ref}`, html`<select name="estado" aria-label="Estado">${Object.entries(REQUEST_STATUS).map(([k, [l]]) => html`<option value="${k}"${q.status === k ? raw(' selected') : ''}>${l}</option>`)}</select>
      <input name="notas" value="${q.admin_notes || ''}" placeholder="Notas internas" aria-label="Notas internas"><button class="abtn" type="submit">Guardar</button>`, { inline: true })}
  </article>`)}</div>` : empty('No hay mensajes con este filtro.')}
</section>`,
    });
  });

  r.post('/solicitudes/:ref', h.act((req, res) => {
    const q = db.get('SELECT * FROM requests WHERE ref = ?', [String(req.params.ref).toUpperCase()]);
    if (!q) throw new AppError('NOT_FOUND', 404);
    const st = REQUEST_STATUS[req.body.estado] ? req.body.estado : q.status;
    db.run('UPDATE requests SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?', [st, String(req.body.notas || '').slice(0, 2000), ctx.now(), q.id]);
    h.audit(req, 'request.updated', 'request', q.ref, { status: st });
    h.done(res, '/admin/solicitudes');
  }, { back: '/admin/solicitudes' }));

  // -------------------------------------------------------------- bloqueos
  r.get('/bloqueos', (req, res) => {
    const resources = catalog.resources({ all: true });
    const list = db.all('SELECT bl.*, r.name_es AS r_name, r.kind AS r_kind, u.name AS u_name FROM blocks bl LEFT JOIN resources r ON r.id = bl.resource_id LEFT JOIN users u ON u.id = bl.created_by WHERE bl.end_utc > ? ORDER BY bl.start_utc LIMIT 300', [ctx.now() - 86400_000]);
    const conflicts = req.query.conflictos ? db.all(`${bookingSelect} WHERE b.ref IN (${String(req.query.conflictos).split(',').slice(0, 50).map(() => '?').join(',')})`, String(req.query.conflictos).split(',').slice(0, 50)) : [];
    h.page(req, res, {
      section: 'blocks', title: 'Bloqueos y cierres',
      body: html`
${conflicts.length ? html`<div class="aflash aflash--err" role="alert">El bloqueo se ha guardado, pero coincide con ${conflicts.length} reserva(s) activa(s) que no se han cancelado automáticamente. Revísalas:
  <ul>${conflicts.map((b) => html`<li><a href="/admin/reservas/${b.ref}">${b.ref}</a> · ${b.r_name} · ${bookingWhen(b)} · ${b.c_name || b.c_email}</li>`)}</ul></div>` : ''}
<section class="apanel">
  <h2>Nuevo bloqueo</h2>
  <p class="muted">Impide reservar un espacio (o todo el centro) en un intervalo: mantenimiento, festivos o uso interno. Las reservas existentes no se cancelan solas.</p>
  ${postForm(res, '/admin/bloqueos', html`<div class="agridf">
    ${field({ label: 'Espacio', name: 'recurso', type: 'select', options: [['', 'Todo el centro'], ...resources.map((x) => [x.slug, x.name_es])] })}
    ${field({ label: 'Desde (fecha)', name: 'desde', type: 'date', value: today(), required: true })}
    ${field({ label: 'Desde (hora)', name: 'hdesde', type: 'time', value: '00:00' })}
    ${field({ label: 'Hasta (fecha)', name: 'hasta', type: 'date', value: today(), required: true })}
    ${field({ label: 'Hasta (hora)', name: 'hhasta', type: 'time', value: '23:59', hint: '23:59 = hasta el final del día.' })}
    ${field({ label: 'Puestos bloqueados (solo coworking)', name: 'unidades', type: 'number', hint: 'Vacío = todos los puestos.', attrs: { min: 1, max: 200 } })}
    ${field({ label: 'Motivo', name: 'motivo', type: 'select', options: Object.entries(BLOCK_REASON) })}
    ${field({ label: 'Nota', name: 'nota' })}
  </div><button class="abtn abtn--primary" type="submit">Crear bloqueo</button>`)}
</section>
<section class="apanel">
  <h2>Bloqueos actuales y futuros</h2>
  ${list.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Espacio</th><th>Desde</th><th>Hasta</th><th>Motivo</th><th>Nota</th><th></th></tr></thead><tbody>
    ${list.map((b) => html`<tr><td>${b.r_name || html`<strong>Todo el centro</strong>`}${b.units ? html` <span class="muted">· ${b.units} puestos</span>` : ''}</td><td>${dt(b.start_utc)}</td><td>${dt(b.end_utc)}</td><td>${BLOCK_REASON[b.reason]}</td><td>${b.note || ''}</td>
      <td>${actionButton(res, `/admin/bloqueos/${b.id}/borrar`, 'Quitar', { variant: 'ghost', confirm: '¿Quitar este bloqueo?' })}</td></tr>`)}
  </tbody></table></div>` : empty('No hay bloqueos.')}
</section>`,
    });
  });

  r.post('/bloqueos', h.act((req, res) => {
    const v = parse(z.object({ recurso: V.optText(60), desde: V.date, hdesde: V.optText(5), hasta: V.date, hhasta: V.optText(5), unidades: V.optText(4), motivo: z.enum(['maintenance', 'holiday', 'internal', 'other']), nota: V.optText(300) }), req.body);
    const resource = v.recurso ? catalog.resource(v.recurso) : null;
    if (v.recurso && !resource) throw new AppError('RESOURCE_NOT_FOUND', 404);
    const start = T.localToUtc(v.desde, T.isTime(v.hdesde) ? v.hdesde : '00:00');
    const end = v.hhasta === '23:59' || !T.isTime(v.hhasta) ? T.dayBoundsUtc(v.hasta)[1] : T.localToUtc(v.hasta, v.hhasta);
    if (start === null || end === null || end <= start) throw new AppError('INVALID_DATE');
    const units = resource?.kind === 'desk_pool' && v.unidades ? Number(v.unidades) : null;
    if (units !== null && (!Number.isInteger(units) || units < 1)) throw new AppError('VALIDATION');
    const ins = db.run('INSERT INTO blocks (resource_id, start_utc, end_utc, units, reason, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [resource?.id ?? null, start, end, units, v.motivo, v.nota || null, req.admin.id, ctx.now()]);
    h.audit(req, 'block.created', 'block', String(ins.lastInsertRowid), { resource: resource?.slug || 'all', start, end, units });
    const clash = db.all(`SELECT ref FROM bookings WHERE status IN ${ACTIVE} AND start_utc < ? AND end_utc > ? ${resource ? 'AND resource_id = ?' : ''} LIMIT 50`, resource ? [end, start, resource.id] : [end, start]);
    if (clash.length && units === null) return res.redirect(303, `/admin/bloqueos?ok=created&conflictos=${clash.map((x) => x.ref).join(',')}`);
    h.done(res, '/admin/bloqueos', 'created');
  }, { back: '/admin/bloqueos' }));

  r.post('/bloqueos/:id/borrar', h.act((req, res) => {
    db.run('DELETE FROM blocks WHERE id = ?', [Number(req.params.id)]);
    h.audit(req, 'block.deleted', 'block', String(req.params.id));
    h.done(res, '/admin/bloqueos', 'deleted');
  }, { back: '/admin/bloqueos' }));

  // Normaliza el correo en las búsquedas rápidas desde el panel.
  r.get('/buscar', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (/^FR-/i.test(q)) return res.redirect(303, `/admin/reservas/${q.toUpperCase()}`);
    const c = q.includes('@') ? db.get('SELECT id FROM customers WHERE email = ?', [normEmail(q)]) : null;
    if (c) return res.redirect(303, `/admin/clientes/${c.id}`);
    res.redirect(303, `/admin/clientes?q=${encodeURIComponent(q)}`);
  });
}
