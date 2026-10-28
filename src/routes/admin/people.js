// Administración · clientes, bonos y planes.
import { html, raw } from '../../lib/html.js';
import { AppError, normEmail } from '../../lib/util.js';
import { V, z, parse } from '../../lib/validate.js';
import * as T from '../../lib/time.js';
import {
  tag, eur, dt, d, bookingWhen, field, postForm, actionButton, pager, empty,
  BOOKING_STATUS, PAYMENT_STATUS, ORDER_STATUS, PLAN_STATUS, USAGE,
} from '../../views/admin/ui.js';

const PLAN_TYPE = { flex: 'Mesa flexible', fixed: 'Mesa fija 24/7', virtual: 'Oficina virtual' };
const LEDGER = { purchase: 'Compra', use: 'Uso', refund: 'Devolución', adjust: 'Ajuste', expire: 'Caducidad' };

export function peopleRoutes(r, ctx, h) {
  const { db, catalog, bookings, commerce } = ctx;
  const today = () => T.todayLocal(ctx.now());
  const balance = (id) => db.get('SELECT COALESCE(SUM(delta),0) AS s FROM voucher_ledger WHERE voucher_id = ?', [id]).s;

  // --------------------------------------------------------------- clientes
  r.get('/clientes', (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE c.email LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR c.company LIKE ?' : '';
    const p = q ? Array(4).fill(`%${q}%`) : [];
    const total = db.get(`SELECT COUNT(*) AS n FROM customers c ${where}`, p).n;
    const per = 50; const pages = Math.max(1, Math.ceil(total / per)); const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    const rows = db.all(`SELECT c.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status = 'confirmed') AS n_book,
        (SELECT GROUP_CONCAT(plan_type) FROM plans pl WHERE pl.customer_id = c.id AND pl.status IN ('active','past_due')) AS plans,
        (SELECT COALESCE(SUM(l.delta),0) FROM vouchers v JOIN voucher_ledger l ON l.voucher_id = v.id WHERE v.customer_id = c.id AND v.status = 'active') AS credits
      FROM customers c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, [...p, per, (page - 1) * per]);
    h.page(req, res, {
      section: 'customers', title: 'Clientes',
      actions: html`${req.admin.role === 'admin' ? html`<a class="abtn" href="/admin/clientes.csv">Exportar contactos con consentimiento</a>` : ''}<a class="abtn abtn--primary" href="/admin/clientes/nuevo">Nuevo cliente</a>`,
      body: html`
<form class="afilters" method="get"><input type="search" name="q" value="${q}" placeholder="Nombre, correo, teléfono o empresa" aria-label="Buscar clientes"><button class="abtn" type="submit">Buscar</button></form>
<p class="small muted">${total} cliente(s)</p>
${rows.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Cliente</th><th>Contacto</th><th>Planes</th><th class="num">Días de bono</th><th class="num">Reservas</th><th>Alta</th></tr></thead><tbody>
  ${rows.map((c) => html`<tr><td><a href="/admin/clientes/${c.id}"><strong>${c.name || '(sin nombre)'}</strong></a>${c.company ? html`<br><span class="muted">${c.company}</span>` : ''}</td>
    <td>${c.email}${c.phone ? html`<br><span class="muted">${c.phone}</span>` : ''}</td>
    <td>${c.plans ? c.plans.split(',').map((t) => PLAN_TYPE[t]).join(', ') : '—'}</td><td class="num">${c.credits || '—'}</td><td class="num">${c.n_book}</td><td>${T.fmtDate(c.created_at, 'es', { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>`)}
</tbody></table></div>${pager(req, page, pages)}` : empty('No hay clientes con esa búsqueda.')}`,
    });
  });

  r.get('/clientes.csv', h.adminOnly, (req, res) => {
    const rows = db.all('SELECT email, name, company, lang, marketing_opt_in_at FROM customers WHERE marketing_opt_in = 1 ORDER BY email');
    const cell = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
    const out = ['correo;nombre;empresa;idioma;consentimiento', ...rows.map((c) => [c.email, c.name, c.company, c.lang, c.marketing_opt_in_at ? new Date(c.marketing_opt_in_at).toISOString() : ''].map(cell).join(';'))];
    h.audit(req, 'export.marketing', 'customers', null, { count: rows.length });
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="contactos-consentimiento-${today()}.csv"`).send(`﻿${out.join('\r\n')}`);
  });

  const customerForm = (c = {}) => html`<div class="agridf">
    ${field({ label: 'Correo', name: 'email', type: 'email', value: c.email, required: true })}
    ${field({ label: 'Nombre', name: 'nombre', value: c.name })}
    ${field({ label: 'Teléfono', name: 'telefono', value: c.phone })}
    ${field({ label: 'Empresa', name: 'empresa', value: c.company })}
    ${field({ label: 'NIF / CIF (facturación)', name: 'nif', value: c.tax_id })}
    ${field({ label: 'Idioma', name: 'idioma', type: 'select', value: c.lang || 'es', options: [['es', 'Español'], ['en', 'English']] })}
    ${field({ label: 'Dirección de facturación', name: 'direccion', type: 'textarea', rows: 2, value: c.billing_address, wide: true })}
    ${field({ label: 'Notas internas', name: 'notas', type: 'textarea', rows: 3, value: c.admin_notes, wide: true })}
  </div>`;
  const customerSchema = z.object({ email: V.email, nombre: V.optText(120), telefono: V.phone, empresa: V.optText(120), nif: V.optText(30), idioma: V.lang, direccion: V.optText(400), notas: V.optText(4000), marketing: V.bool.optional() });

  r.get('/clientes/nuevo', (req, res) => h.page(req, res, {
    section: 'customers', title: 'Nuevo cliente',
    body: html`<div class="apanel">${postForm(res, '/admin/clientes/nuevo', html`${customerForm()}<p class="small muted">El consentimiento para comunicaciones comerciales solo lo puede dar la propia persona desde la web.</p><button class="abtn abtn--primary" type="submit">Crear cliente</button>`)}</div>`,
  }));

  r.post('/clientes/nuevo', h.act((req, res) => {
    const v = parse(customerSchema, req.body);
    if (db.get('SELECT 1 FROM customers WHERE email = ?', [v.email])) throw new AppError('EMAIL_EXISTS', 409);
    const t = ctx.now();
    const ins = db.run('INSERT INTO customers (email, name, phone, company, tax_id, billing_address, lang, admin_notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [v.email, v.nombre || null, v.telefono || null, v.empresa || null, v.nif || null, v.direccion || null, v.idioma, v.notas || null, t, t]);
    h.audit(req, 'customer.created', 'customer', String(ins.lastInsertRowid));
    h.done(res, `/admin/clientes/${ins.lastInsertRowid}`, 'created');
  }, { back: '/admin/clientes/nuevo' }));

  const mustCustomer = (req) => { const c = db.get('SELECT * FROM customers WHERE id = ?', [Number(req.params.id)]); if (!c) throw new AppError('NOT_FOUND', 404); return c; };

  r.get('/clientes/:id', (req, res, next) => {
    const c = db.get('SELECT * FROM customers WHERE id = ?', [Number(req.params.id)]);
    if (!c) return next();
    const bks = db.all('SELECT b.*, r.name_es AS r_name, r.kind AS r_kind FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE b.customer_id = ? ORDER BY b.start_utc DESC LIMIT 60', [c.id]);
    const orders = db.all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 40', [c.id]);
    const vouchers = db.all('SELECT v.*, p.name_es AS p_name FROM vouchers v JOIN products p ON p.id = v.product_id WHERE v.customer_id = ? ORDER BY v.created_at DESC', [c.id]);
    const plans = db.all('SELECT pl.*, p.name_es AS p_name FROM plans pl JOIN products p ON p.id = pl.product_id WHERE pl.customer_id = ? ORDER BY pl.created_at DESC', [c.id]);
    const isAdmin = req.admin.role === 'admin';
    h.page(req, res, {
      section: 'customers', title: c.name || c.email,
      actions: html`<a class="abtn abtn--primary" href="/admin/reservas/nueva?cliente=${c.id}">Nueva reserva</a>`,
      body: html`
<div class="agrid2">
  <section class="apanel">
    <h2>Datos</h2>
    ${postForm(res, `/admin/clientes/${c.id}`, html`${customerForm(c)}
      ${c.marketing_opt_in ? html`<label class="acheck"><input type="checkbox" name="marketing" value="1" checked> <span>Acepta comunicaciones comerciales (desde ${dt(c.marketing_opt_in_at)}). Desmárcalo si pide la baja.</span></label>` : html`<p class="small muted">No ha aceptado comunicaciones comerciales.</p>`}
      <button class="abtn abtn--primary" type="submit">Guardar</button>`)}
    <p class="small muted">Cliente desde ${dt(c.created_at)} · versión de enlaces ${c.link_version}</p>
  </section>
  <section class="apanel">
    <h2>Bonos</h2>
    ${vouchers.length ? html`<table class="atable atable--compact"><tbody>${vouchers.map((v) => html`<tr><td><a class="mono" href="/admin/bonos/${v.id}">${v.code}</a></td><td>${v.p_name}</td><td><strong>${balance(v.id)}</strong> / ${v.credits_total} días</td><td>caduca ${d(v.expires_on)}</td><td>${v.status === 'active' ? '' : html`<span class="atag atag--off">${v.status}</span>`}</td></tr>`)}</tbody></table>` : empty('Sin bonos.')}
    ${isAdmin ? html`<details class="adetails"><summary>Emitir bono (pago en recepción)</summary>
      ${postForm(res, '/admin/bonos/emitir', html`<input type="hidden" name="cliente" value="${c.id}">
        ${field({ label: 'Importe cobrado (€)', name: 'importe', type: 'number', hint: 'Vacío = precio de la tarifa con los impuestos configurados.', attrs: { min: 0, step: '0.01' } })}
        ${field({ label: 'Avisar al cliente por correo', name: 'avisar', type: 'checkbox', checked: true })}
        <button class="abtn" type="submit">Emitir bono de 10 días</button>`, { confirm: '¿Emitir un bono de 10 días para este cliente?' })}
    </details>` : ''}
    <h2>Planes</h2>
    ${plans.length ? html`<table class="atable atable--compact"><tbody>${plans.map((p) => html`<tr><td><a class="mono" href="/admin/planes?q=${p.ref}">${p.ref}</a></td><td>${PLAN_TYPE[p.plan_type]}${p.desk_label ? ` · ${p.desk_label}` : ''}</td><td>${tag(PLAN_STATUS, p.status)}</td><td>${p.period_start ? `${d(p.period_start)} → ${d(p.period_end)}` : `desde ${d(p.start_date)}`}</td></tr>`)}</tbody></table>` : empty('Sin planes.')}
    ${isAdmin ? html`<details class="adetails"><summary>Dar de alta un plan</summary>
      ${postForm(res, '/admin/planes/nuevo', html`<input type="hidden" name="cliente" value="${c.id}">
        ${field({ label: 'Plan', name: 'producto', type: 'select', options: catalog.products({ all: true }).filter((p) => p.kind === 'plan').map((p) => [p.slug, p.name_es]) })}
        ${field({ label: 'Fecha de inicio', name: 'inicio', type: 'date', value: today() })}
        ${field({ label: 'Activar ya (cobro en recepción)', name: 'activar', type: 'checkbox', checked: true })}
        <button class="abtn" type="submit">Dar de alta</button>`)}
    </details>` : ''}
  </section>
</div>
<section class="apanel">
  <h2>Reservas</h2>
  ${bks.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Ref.</th><th>Fecha</th><th>Servicio</th><th>Estado</th><th>Cobro</th><th class="num">Importe</th></tr></thead><tbody>
    ${bks.map((b) => html`<tr><td><a class="mono" href="/admin/reservas/${b.ref}">${b.ref}</a></td><td>${bookingWhen(b)}</td><td>${b.r_kind === 'desk_pool' ? USAGE[b.usage] : b.r_name}</td><td>${tag(BOOKING_STATUS, b.status)}</td><td>${tag(PAYMENT_STATUS, b.payment_status)}</td><td class="num">${b.total_cents ? eur(b.total_cents) : '—'}</td></tr>`)}
  </tbody></table></div>` : empty('Sin reservas.')}
</section>
<section class="apanel">
  <h2>Pedidos</h2>
  ${orders.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Pedido</th><th>Fecha</th><th>Concepto</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
    ${orders.map((o) => html`<tr><td class="mono">${o.ref}</td><td>${dt(o.created_at)}</td><td>${JSON.parse(o.items).map((i) => i.name).join(', ')}</td><td>${tag(ORDER_STATUS, o.status)}${o.provider === 'manual' ? html` <span class="muted">recepción</span>` : ''}</td><td class="num">${eur(o.total_cents)}</td></tr>`)}
  </tbody></table></div>` : empty('Sin pedidos.')}
</section>
<section class="apanel">
  <h2>Privacidad y seguridad</h2>
  <div class="aactions">
    ${actionButton(res, `/admin/clientes/${c.id}/enlaces`, 'Invalidar enlaces de gestión enviados', { variant: 'ghost', confirm: 'Los enlaces de gestión ya enviados dejarán de funcionar. ¿Continuar?' })}
    ${isAdmin ? html`<a class="abtn abtn--ghost" href="/admin/clientes/${c.id}/datos.json">Exportar sus datos (JSON)</a>` : ''}
    ${isAdmin ? actionButton(res, `/admin/clientes/${c.id}/anonimizar`, 'Anonimizar datos personales', { variant: 'danger', confirm: 'Se sustituirán nombre, correo, teléfono y notas. Los pedidos se conservan por obligación legal. Esta acción no se puede deshacer. ¿Continuar?' }) : ''}
  </div>
  <p class="small muted">La anonimización solo es posible si no tiene reservas futuras ni planes activos.</p>
</section>`,
    });
  });

  r.post('/clientes/:id', h.act((req, res) => {
    const c = mustCustomer(req);
    const v = parse(customerSchema, req.body);
    if (v.email !== c.email && db.get('SELECT 1 FROM customers WHERE email = ? AND id <> ?', [v.email, c.id])) throw new AppError('EMAIL_EXISTS', 409);
    const optOut = c.marketing_opt_in && !v.marketing;
    db.run(`UPDATE customers SET email = ?, name = ?, phone = ?, company = ?, tax_id = ?, billing_address = ?, lang = ?, admin_notes = ?,
      marketing_opt_in = CASE WHEN ? THEN 0 ELSE marketing_opt_in END, marketing_opt_in_at = CASE WHEN ? THEN NULL ELSE marketing_opt_in_at END,
      link_version = link_version + CASE WHEN email <> ? THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?`,
    [v.email, v.nombre || null, v.telefono || null, v.empresa || null, v.nif || null, v.direccion || null, v.idioma, v.notas || null, optOut ? 1 : 0, optOut ? 1 : 0, v.email, ctx.now(), c.id]);
    if (v.email !== c.email) ctx.sessions.destroyAllFor('customer', c.id);
    h.audit(req, 'customer.updated', 'customer', String(c.id), { email_changed: v.email !== c.email, marketing_opt_out: Boolean(optOut) });
    h.done(res, `/admin/clientes/${c.id}`);
  }, { back: (req) => `/admin/clientes/${req.params.id}` }));

  r.post('/clientes/:id/enlaces', h.act((req, res) => {
    const c = mustCustomer(req);
    db.run('UPDATE customers SET link_version = link_version + 1, updated_at = ? WHERE id = ?', [ctx.now(), c.id]);
    h.audit(req, 'customer.links_revoked', 'customer', String(c.id));
    h.done(res, `/admin/clientes/${c.id}`, 'links');
  }, { back: (req) => `/admin/clientes/${req.params.id}` }));

  r.get('/clientes/:id/datos.json', h.adminOnly, (req, res) => {
    const c = mustCustomer(req);
    const data = {
      exported_at: new Date(ctx.now()).toISOString(),
      customer: c,
      bookings: db.all('SELECT * FROM bookings WHERE customer_id = ?', [c.id]),
      orders: db.all('SELECT * FROM orders WHERE customer_id = ?', [c.id]),
      vouchers: db.all('SELECT * FROM vouchers WHERE customer_id = ?', [c.id]).map((v) => ({ ...v, ledger: db.all('SELECT * FROM voucher_ledger WHERE voucher_id = ?', [v.id]) })),
      plans: db.all('SELECT * FROM plans WHERE customer_id = ?', [c.id]),
      requests: db.all('SELECT * FROM requests WHERE email = ?', [c.email]),
      event_signups: db.all('SELECT * FROM event_signups WHERE email = ?', [c.email]),
    };
    h.audit(req, 'customer.exported', 'customer', String(c.id));
    res.set('Content-Disposition', `attachment; filename="cliente-${c.id}.json"`).json(data);
  });

  r.post('/clientes/:id/anonimizar', h.adminOnly, h.act((req, res) => {
    const c = mustCustomer(req);
    const busy = db.get("SELECT 1 FROM bookings WHERE customer_id = ? AND status IN ('pending_payment','requested','confirmed') AND end_utc > ?", [c.id, ctx.now()])
      || db.get("SELECT 1 FROM plans WHERE customer_id = ? AND status IN ('requested','pending_payment','active','past_due')", [c.id]);
    if (busy) throw new AppError('CUSTOMER_BUSY', 409);
    db.tx(() => {
      const anon = `anonimo-${c.id}@anonimizado.invalid`;
      db.run('DELETE FROM requests WHERE email = ?', [c.email]);
      db.run('DELETE FROM event_signups WHERE email = ?', [c.email]);
      db.run('DELETE FROM trials WHERE email = ?', [c.email]);
      db.run(`UPDATE customers SET email = ?, name = 'Cliente anonimizado', phone = NULL, company = NULL, billing_address = NULL, admin_notes = NULL,
        marketing_opt_in = 0, marketing_opt_in_at = NULL, link_version = link_version + 1, updated_at = ? WHERE id = ?`, [anon, ctx.now(), c.id]);
      db.run('UPDATE bookings SET notes = NULL, admin_notes = NULL WHERE customer_id = ?', [c.id]);
      db.run('DELETE FROM login_tokens WHERE customer_id = ?', [c.id]);
      ctx.sessions.destroyAllFor('customer', c.id);
    });
    h.audit(req, 'customer.anonymized', 'customer', String(c.id));
    h.done(res, `/admin/clientes/${c.id}`, 'anonymized');
  }, { back: (req) => `/admin/clientes/${req.params.id}` }));

  // ------------------------------------------------------------------ bonos
  r.get('/bonos', (req, res) => {
    const st = ['active', 'expired', 'cancelled'].includes(req.query.estado) ? req.query.estado : 'active';
    const q = String(req.query.q || '').trim();
    const rows = db.all(`SELECT v.*, c.name AS c_name, c.email AS c_email, p.name_es AS p_name, (SELECT COALESCE(SUM(delta),0) FROM voucher_ledger WHERE voucher_id = v.id) AS bal
      FROM vouchers v JOIN customers c ON c.id = v.customer_id JOIN products p ON p.id = v.product_id
      WHERE v.status = ? ${q ? 'AND (v.code LIKE ? OR c.email LIKE ? OR c.name LIKE ?)' : ''} ORDER BY v.created_at DESC LIMIT 300`, q ? [st, `%${q}%`, `%${q}%`, `%${q}%`] : [st]);
    h.page(req, res, {
      section: 'vouchers', title: 'Bonos',
      body: html`
<form class="afilters" method="get"><input type="search" name="q" value="${q}" placeholder="Código, nombre o correo" aria-label="Buscar bonos">
  <select name="estado" aria-label="Estado"><option value="active">Activos</option><option value="expired"${st === 'expired' ? raw(' selected') : ''}>Caducados</option><option value="cancelled"${st === 'cancelled' ? raw(' selected') : ''}>Anulados</option></select><button class="abtn" type="submit">Filtrar</button></form>
${rows.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Código</th><th>Cliente</th><th>Producto</th><th class="num">Saldo</th><th>Válido</th></tr></thead><tbody>
  ${rows.map((v) => html`<tr><td><a class="mono" href="/admin/bonos/${v.id}">${v.code}</a></td><td><a href="/admin/clientes/${v.customer_id}">${v.c_name || v.c_email}</a></td><td>${v.p_name}</td><td class="num"><strong>${v.bal}</strong> / ${v.credits_total}</td><td>${d(v.valid_from)} → ${d(v.expires_on)}</td></tr>`)}
</tbody></table></div>` : empty('No hay bonos con este filtro.')}
${req.admin.role === 'admin' ? html`<section class="apanel"><h2>Emitir bono (pago en recepción)</h2>
  ${postForm(res, '/admin/bonos/emitir', html`<div class="agridf">
    ${field({ label: 'Correo del cliente', name: 'email', type: 'email', required: true })}
    ${field({ label: 'Nombre', name: 'nombre' })}
    ${field({ label: 'Importe cobrado (€)', name: 'importe', type: 'number', hint: 'Vacío = precio de la tarifa con los impuestos configurados.', attrs: { min: 0, step: '0.01' } })}
    ${field({ label: 'Avisar al cliente', name: 'avisar', type: 'checkbox', checked: true })}
  </div><button class="abtn abtn--primary" type="submit">Emitir bono de 10 días</button>`)}
</section>` : ''}`,
    });
  });

  r.post('/bonos/emitir', h.adminOnly, h.act((req, res) => {
    let customerId = Number(req.body.cliente) || null;
    if (!customerId) {
      const v = parse(z.object({ email: V.email, nombre: V.optText(120) }), req.body);
      customerId = bookings.upsertCustomer({ email: v.email, name: v.nombre }).id;
    }
    const amount = req.body.importe ? Math.round(Number(String(req.body.importe).replace(',', '.')) * 100) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new AppError('VALIDATION');
    const v = commerce.issueManualVoucher({ customerId, amount_cents: amount, actorId: req.admin.id });
    if (req.body.avisar) ctx.notify('voucher.issued', { voucherId: v.id });
    h.done(res, `/admin/bonos/${v.id}`, 'issued');
  }, { back: '/admin/bonos' }));

  r.get('/bonos/:id', (req, res, next) => {
    const v = db.get('SELECT v.*, c.name AS c_name, c.email AS c_email, p.name_es AS p_name FROM vouchers v JOIN customers c ON c.id = v.customer_id JOIN products p ON p.id = v.product_id WHERE v.id = ?', [Number(req.params.id)]);
    if (!v) return next();
    const ledger = db.all('SELECT l.*, b.ref AS b_ref FROM voucher_ledger l LEFT JOIN bookings b ON b.id = l.booking_id WHERE l.voucher_id = ? ORDER BY l.id', [v.id]);
    let run = 0;
    h.page(req, res, {
      section: 'vouchers', title: `Bono ${v.code}`,
      body: html`
<div class="agrid2">
  <section class="apanel"><dl class="adl">
    <dt>Cliente</dt><dd><a href="/admin/clientes/${v.customer_id}">${v.c_name || v.c_email}</a></dd>
    <dt>Producto</dt><dd>${v.p_name}</dd>
    <dt>Saldo</dt><dd><strong>${balance(v.id)}</strong> de ${v.credits_total} días</dd>
    <dt>Validez</dt><dd>${d(v.valid_from)} → ${d(v.expires_on)}</dd>
    <dt>Estado</dt><dd>${v.status === 'active' ? 'Activo' : v.status === 'expired' ? 'Caducado' : 'Anulado'}</dd>
  </dl></section>
  ${req.admin.role === 'admin' ? html`<section class="apanel"><h2>Ajustar</h2>
    ${postForm(res, `/admin/bonos/${v.id}/ajustar`, html`<div class="agridf">
      ${field({ label: 'Días (+ añadir / − quitar)', name: 'delta', type: 'number', required: true, attrs: { min: -100, max: 100, step: 1 } })}
      ${field({ label: 'Motivo', name: 'nota', required: true })}
    </div><button class="abtn" type="submit">Aplicar ajuste</button>`)}
    <p class="small muted">El saldo nunca puede quedar en negativo: la base de datos rechaza el movimiento.</p>
    ${postForm(res, `/admin/bonos/${v.id}/caducidad`, html`${field({ label: 'Nueva fecha de caducidad', name: 'fecha', type: 'date', value: v.expires_on })}<button class="abtn" type="submit">Cambiar caducidad</button>`)}
    ${v.status === 'active' ? actionButton(res, `/admin/bonos/${v.id}/anular`, 'Anular bono', { variant: 'danger', confirm: '¿Anular este bono? No se podrán reservar más días con él.' }) : ''}
  </section>` : ''}
</div>
<section class="apanel"><h2>Movimientos</h2>
  <table class="atable"><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Días</th><th class="num">Saldo</th><th>Detalle</th></tr></thead><tbody>
  ${ledger.map((l) => { run += l.delta; return html`<tr><td>${dt(l.created_at)}</td><td>${LEDGER[l.reason]}</td><td class="num">${l.delta > 0 ? `+${l.delta}` : l.delta}</td><td class="num">${run}</td><td>${l.b_ref ? html`<a class="mono" href="/admin/reservas/${l.b_ref}">${l.b_ref}</a> ` : ''}${l.note || ''} <span class="muted">${l.actor || ''}</span></td></tr>`; })}
  </tbody></table>
</section>`,
    });
  });

  r.post('/bonos/:id/ajustar', h.adminOnly, h.act((req, res) => {
    const delta = Number(req.body.delta);
    const note = String(req.body.nota || '').trim().slice(0, 300);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100 || !note) throw new AppError('VALIDATION');
    commerce.adjustVoucher(Number(req.params.id), delta, note, req.admin.id);
    h.done(res, `/admin/bonos/${req.params.id}`, 'adjusted');
  }, { back: (req) => `/admin/bonos/${req.params.id}` }));

  r.post('/bonos/:id/caducidad', h.adminOnly, h.act((req, res) => {
    if (!T.isDate(req.body.fecha)) throw new AppError('INVALID_DATE');
    db.run("UPDATE vouchers SET expires_on = ?, status = CASE WHEN status = 'expired' AND ? >= ? THEN 'active' ELSE status END WHERE id = ?", [req.body.fecha, req.body.fecha, today(), Number(req.params.id)]);
    h.audit(req, 'voucher.expiry_changed', 'voucher', String(req.params.id), { expires_on: req.body.fecha });
    h.done(res, `/admin/bonos/${req.params.id}`);
  }, { back: (req) => `/admin/bonos/${req.params.id}` }));

  r.post('/bonos/:id/anular', h.adminOnly, h.act((req, res) => {
    db.run("UPDATE vouchers SET status = 'cancelled' WHERE id = ?", [Number(req.params.id)]);
    h.audit(req, 'voucher.cancelled', 'voucher', String(req.params.id));
    h.done(res, `/admin/bonos/${req.params.id}`);
  }, { back: (req) => `/admin/bonos/${req.params.id}` }));

  // ------------------------------------------------------------------ planes
  r.get('/planes', (req, res) => {
    const st = PLAN_STATUS[req.query.estado] ? req.query.estado : null;
    const q = String(req.query.q || '').trim();
    const where = []; const p = [];
    if (st) { where.push('pl.status = ?'); p.push(st); } else if (!q) where.push("pl.status IN ('requested','pending_payment','active','past_due')");
    if (q) { where.push('(pl.ref LIKE ? OR c.email LIKE ? OR c.name LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const rows = db.all(`SELECT pl.*, c.name AS c_name, c.email AS c_email, pr.name_es AS p_name FROM plans pl JOIN customers c ON c.id = pl.customer_id JOIN products pr ON pr.id = pl.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE pl.status WHEN 'requested' THEN 0 WHEN 'past_due' THEN 1 WHEN 'pending_payment' THEN 2 ELSE 3 END, pl.created_at DESC LIMIT 300`, p);
    const pool = catalog.deskPool();
    const fixed = db.get("SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'fixed' AND status IN ('active','past_due','pending_payment')").n;
    const flex = db.get("SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'flex' AND status IN ('active','past_due','pending_payment')").n;
    const isAdmin = req.admin.role === 'admin';
    h.page(req, res, {
      section: 'plans', title: 'Planes',
      body: html`
<p class="muted">Mesas fijas: <strong>${fixed}</strong> de ${pool?.max_fixed ?? '—'} · Mesa flexible: <strong>${flex}</strong> de ${ctx.settings.get('plans').max_flex_members} miembros. Las mesas fijas descuentan puestos del inventario compartido todos los días.</p>
<form class="afilters" method="get"><input type="search" name="q" value="${q}" placeholder="Referencia, nombre o correo" aria-label="Buscar planes">
  <select name="estado" aria-label="Estado"><option value="">Vigentes y solicitudes</option>${Object.entries(PLAN_STATUS).map(([k, [l]]) => html`<option value="${k}"${st === k ? raw(' selected') : ''}>${l}</option>`)}</select><button class="abtn" type="submit">Filtrar</button></form>
${rows.length ? html`<div class="areqs">${rows.map((pl) => html`<article class="areq">
  <header><span class="mono">${pl.ref}</span> ${tag(PLAN_STATUS, pl.status)} <strong>${pl.p_name}</strong>${pl.desk_label ? html` <span class="atag atag--info">Puesto ${pl.desk_label}</span>` : ''}<span class="muted">${dt(pl.created_at)}</span></header>
  <p><a href="/admin/clientes/${pl.customer_id}">${pl.c_name || pl.c_email}</a> · inicio ${d(pl.start_date)}${pl.period_start ? html` · periodo ${d(pl.period_start)} → ${d(pl.period_end)}` : ''} · ${pl.total_cents != null ? `${eur(pl.total_cents)}/mes${pl.price_final ? '' : ' (sin impuestos configurados)'}` : 'sin tarifa'}${pl.cancel_at_period_end ? html` · <strong>baja al final del periodo</strong>` : ''}${pl.notes ? html` · <span class="muted">${pl.notes}</span>` : ''}</p>
  ${isAdmin ? html`<div class="aactions">
    ${['requested', 'pending_payment'].includes(pl.status) ? actionButton(res, `/admin/planes/${pl.id}/activar`, 'Activar (cobro en recepción)', { variant: 'primary', confirm: '¿Activar el plan? Se considera cobrado el primer mes en recepción.' }) : ''}
    ${pl.status === 'requested' ? actionButton(res, `/admin/planes/${pl.id}/rechazar`, 'Rechazar', { variant: 'ghost', confirm: '¿Rechazar esta solicitud de alta?' }) : ''}
    ${['active', 'past_due'].includes(pl.status) ? actionButton(res, `/admin/planes/${pl.id}/renovar`, 'Registrar pago de la renovación (+1 mes)', { confirm: '¿Registrar el pago del siguiente mes en recepción?' }) : ''}
    ${['active', 'past_due'].includes(pl.status) && !pl.cancel_at_period_end ? actionButton(res, `/admin/planes/${pl.id}/baja`, 'Baja al final del periodo', { variant: 'ghost', confirm: '¿Programar la baja al final del periodo actual?' }) : ''}
    ${['active', 'past_due'].includes(pl.status) ? actionButton(res, `/admin/planes/${pl.id}/baja`, 'Baja inmediata', { variant: 'danger', hidden: { inmediata: '1' }, confirm: '¿Dar de baja el plan hoy mismo?' }) : ''}
  </div>` : ''}
</article>`)}</div>` : empty('No hay planes con este filtro.')}`,
    });
  });

  const mustPlan = (req) => { const p = db.get('SELECT * FROM plans WHERE id = ?', [Number(req.params.id)]); if (!p) throw new AppError('NOT_FOUND', 404); return p; };
  const planBack = (req) => '/admin/planes';

  r.post('/planes/nuevo', h.adminOnly, h.act((req, res) => {
    const c = db.get('SELECT * FROM customers WHERE id = ?', [Number(req.body.cliente)]);
    if (!c) throw new AppError('NOT_FOUND', 404);
    if (!T.isDate(req.body.inicio)) throw new AppError('INVALID_DATE');
    const out = commerce.requestPlan({ customer: { email: c.email }, productSlug: String(req.body.producto), startDate: req.body.inicio, lang: c.lang });
    if (req.body.activar) {
      db.tx(() => {
        if (out.order) db.run("UPDATE orders SET status = 'cancelled', failed_reason = 'Alta manual: cobro en recepción' WHERE id = ? AND status = 'pending'", [out.order.id]);
        commerce.activatePlan(out.plan.id, { actor: `admin:${req.admin.id}` });
      });
      ctx.notify('plan.activated', { planId: out.plan.id });
    }
    h.done(res, `/admin/clientes/${c.id}`, req.body.activar ? 'activated' : 'created');
  }, { back: (req) => `/admin/clientes/${req.body.cliente}` }));

  r.post('/planes/:id/activar', h.adminOnly, h.act((req, res) => {
    const p = mustPlan(req);
    db.tx(() => {
      if (p.order_id) db.run("UPDATE orders SET status = 'cancelled', failed_reason = 'Activado manualmente: cobro en recepción' WHERE id = ? AND status = 'pending'", [p.order_id]);
      commerce.activatePlan(p.id, { actor: `admin:${req.admin.id}` });
    });
    ctx.notify('plan.activated', { planId: p.id });
    h.done(res, planBack(req), 'activated');
  }, { back: planBack }));

  r.post('/planes/:id/rechazar', h.adminOnly, h.act((req, res) => {
    const p = mustPlan(req);
    if (p.status !== 'requested') throw new AppError('NOT_CONFIRMABLE', 409);
    db.run("UPDATE plans SET status = 'rejected', updated_at = ? WHERE id = ?", [ctx.now(), p.id]);
    h.audit(req, 'plan.rejected', 'plan', p.ref);
    h.done(res, planBack(req), 'rejected');
  }, { back: planBack }));

  r.post('/planes/:id/renovar', h.adminOnly, h.act((req, res) => {
    const p = mustPlan(req);
    commerce.renewPlan(p.id, { actor: `admin:${req.admin.id}` });
    ctx.notify('plan.renewed', { planId: p.id });
    h.done(res, planBack(req), 'renewed');
  }, { back: planBack }));

  r.post('/planes/:id/baja', h.adminOnly, h.act((req, res) => {
    const p = mustPlan(req);
    commerce.cancelPlan(p.id, { actor: 'admin', actorId: req.admin.id, immediate: Boolean(req.body.inmediata) });
    ctx.notify('plan.cancelled', { planId: p.id });
    h.done(res, planBack(req), 'cancelled');
  }, { back: planBack }));

  // Búsqueda de clientes por correo exacto (autocompletar en formularios).
  r.get('/api/clientes', (req, res) => {
    const q = normEmail(req.query.q);
    if (q.length < 3) return res.json([]);
    res.json(db.all('SELECT id, email, name, phone, company, lang FROM customers WHERE email LIKE ? OR name LIKE ? ORDER BY email LIMIT 8', [`%${q}%`, `%${q}%`]));
  });
}
