// Administración · informes, pagos, correos, registro de actividad y usuarios.
import { html, raw } from '../../lib/html.js';
import { AppError, normEmail, randomToken } from '../../lib/util.js';
import { hashPassword } from '../../lib/password.js';
import * as T from '../../lib/time.js';
import { tag, eur, dt, field, postForm, actionButton, pager, empty, kpi, ORDER_STATUS, MAIL_STATUS } from '../../views/admin/ui.js';

export function systemRoutes(r, ctx, h) {
  const { db, catalog, bookings, commerce } = ctx;
  const today = () => T.todayLocal(ctx.now());

  // ---------------------------------------------------------------- informes
  r.get('/informes', h.adminOnly, (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : today().slice(0, 7);
    const first = `${month}-01`;
    const next = T.addMonths(first, 1);
    const [ms] = T.dayBoundsUtc(first); const [me] = T.dayBoundsUtc(next);
    const days = T.datesBetween(first, next);
    const pool = catalog.deskPool();
    // Ocupación de puestos: (reservas + mesas fijas + bloqueados) / capacidad, solo en días abiertos.
    let seatDays = 0; let usedDays = 0;
    const daily = days.map((dd) => {
      const i = bookings.deskInfo(dd);
      const occ = i.open ? i.used + i.fixed + i.blockedUnits : 0;
      if (i.open) { seatDays += i.capacity; usedDays += Math.min(i.capacity, occ); }
      return { date: dd, open: i.open, occ, cap: i.capacity };
    });
    // Ocupación de recursos por horas: minutos reservados / minutos abiertos.
    const timed = db.all("SELECT * FROM resources WHERE kind IN ('room','booth','studio') ORDER BY sort, id").map((x) => {
      let open = 0;
      for (const dd of days) for (const rg of T.rangesFor(JSON.parse(x.hours), dd)) { const [a, b] = T.rangeMinutes(rg); open += b - a; }
      const booked = db.get("SELECT COALESCE(SUM(MIN(end_utc, ?) - MAX(start_utc, ?)),0) AS ms FROM bookings WHERE resource_id = ? AND status = 'confirmed' AND start_utc < ? AND end_utc > ?", [me, ms, x.id, me, ms]).ms / 60_000;
      return { name: x.name_es, open, booked, pct: open ? Math.round((booked / open) * 100) : 0 };
    });
    const orders = db.all("SELECT * FROM orders WHERE status IN ('paid','refunded','refund_pending') AND paid_at >= ? AND paid_at < ?", [ms, me]);
    const byKind = { booking: 0, bundle: 0, plan: 0 };
    let gross = 0; let tax = 0; let refunded = 0; let manual = 0;
    for (const o of orders) { gross += o.total_cents; tax += o.tax_cents; refunded += o.refunded_cents || 0; byKind[o.kind] += o.total_cents; if (o.provider === 'manual') manual += o.total_cents; }
    const offline = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS s FROM bookings WHERE payment_status = 'offline' AND local_date >= ? AND local_date < ?", [first, next]);
    const plans = db.all("SELECT plan_type, COUNT(*) AS n FROM plans WHERE status IN ('active','past_due') GROUP BY plan_type");
    const counts = db.all("SELECT usage, COUNT(*) AS n, SUM(people) AS p FROM bookings WHERE status = 'confirmed' AND local_date >= ? AND local_date < ? GROUP BY usage", [first, next]);
    const max = Math.max(1, ...daily.map((x) => x.cap));
    h.page(req, res, {
      section: 'reports', title: 'Informes',
      actions: html`<a class="abtn" href="/admin/informes.csv?mes=${month}">Exportar CSV del mes</a>`,
      body: html`
<form class="afilters" method="get"><a class="abtn" href="?mes=${T.addMonths(first, -1).slice(0, 7)}">←</a><input type="month" name="mes" value="${month}" aria-label="Mes"><a class="abtn" href="?mes=${next.slice(0, 7)}">→</a><button class="abtn" type="submit">Ver</button>
  <strong class="afilters__title">${T.fmtDateStr(first, 'es', { month: 'long', year: 'numeric' })}</strong></form>
<div class="akpis">
  ${kpi('Ocupación de puestos', seatDays ? `${Math.round((usedDays / seatDays) * 100)} %` : '—', `${usedDays} de ${seatDays} puestos-día (${pool?.capacity ?? 0} puestos)`)}
  ${kpi('Cobrado online y en recepción', eur(gross - refunded), `${orders.length} pedido(s) · impuestos incluidos ${eur(tax)} · devuelto ${eur(refunded)}`)}
  ${kpi('Reservas cobradas en recepción', eur(offline.s), `${offline.n} reserva(s) marcadas como cobradas`)}
  ${kpi('Planes vigentes', plans.reduce((a, p) => a + p.n, 0), plans.map((p) => `${p.n} ${{ flex: 'flexibles', fixed: 'fijas', virtual: 'virtuales' }[p.plan_type]}`).join(' · ') || 'ninguno')}
</div>
<div class="agrid2">
  <section class="apanel"><h2>Ingresos por tipo</h2><table class="atable"><tbody>
    <tr><td>Reservas</td><td class="num">${eur(byKind.booking)}</td></tr><tr><td>Bonos</td><td class="num">${eur(byKind.bundle)}</td></tr><tr><td>Planes</td><td class="num">${eur(byKind.plan)}</td></tr>
    <tr><td>De ellos, registrados en recepción</td><td class="num">${eur(manual)}</td></tr>
  </tbody></table><p class="small muted">Importes según el pedido (con los impuestos configurados en el momento de la compra). Esto no es contabilidad ni sustituye a las facturas.</p></section>
  <section class="apanel"><h2>Salas, cabinas y estudio</h2><table class="atable"><thead><tr><th>Espacio</th><th class="num">Horas reservadas</th><th class="num">Ocupación</th></tr></thead><tbody>
    ${timed.map((t) => html`<tr><td>${t.name}</td><td class="num">${(t.booked / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h de ${Math.round(t.open / 60)} h</td><td class="num">${t.pct} %</td></tr>`)}
  </tbody></table></section>
</div>
<section class="apanel"><h2>Puestos ocupados por día</h2>
  <div class="achart" role="img" aria-label="Ocupación diaria de puestos">${daily.map((x) => html`<span title="${x.date}: ${x.open ? `${x.occ}/${x.cap}` : 'cerrado'}" style="height:${x.open ? Math.max(2, (x.occ / max) * 100) : 0}%"${x.open ? '' : raw(' class="off"')}></span>`)}</div>
  <p class="small muted">Cada barra es un día del mes. Los días cerrados aparecen vacíos.</p>
</section>
<section class="apanel"><h2>Reservas confirmadas por uso</h2>${counts.length ? html`<table class="atable"><tbody>${counts.map((c) => html`<tr><td>${{ pass: 'Pase de día', voucher: 'Día de bono', plan: 'Mesa flexible', trial: 'Día de prueba', hourly: 'Por horas', visit: 'Visitas', office: 'Despachos', admin: 'Internas' }[c.usage]}</td><td class="num">${c.n} reservas · ${c.p} pers.</td></tr>`)}</tbody></table>` : empty('Sin reservas confirmadas este mes.')}</section>`,
    });
  });

  r.get('/informes.csv', h.adminOnly, (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : today().slice(0, 7);
    const first = `${month}-01`; const next = T.addMonths(first, 1);
    const lines = ['fecha;abierto;puestos_ocupados;capacidad;reservas_confirmadas'];
    for (const dd of T.datesBetween(first, next)) {
      const i = bookings.deskInfo(dd);
      const n = db.get("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND local_date = ?", [dd]).n;
      lines.push([dd, i.open ? 'si' : 'no', i.open ? i.used + i.fixed + i.blockedUnits : 0, i.capacity, n].join(';'));
    }
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="ocupacion-${month}.csv"`).send(`﻿${lines.join('\r\n')}`);
  });

  // ------------------------------------------------------------------- pagos
  r.get('/pagos', h.adminOnly, (req, res) => {
    const st = ORDER_STATUS[req.query.estado] ? req.query.estado : null;
    const q = String(req.query.q || '').trim();
    const where = []; const p = [];
    if (st) { where.push('o.status = ?'); p.push(st); }
    if (q) { where.push('(o.ref LIKE ? OR c.email LIKE ? OR o.provider_session_id LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.get(`SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id ${sql}`, p).n;
    const per = 50; const pages = Math.max(1, Math.ceil(total / per)); const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    const rows = db.all(`SELECT o.*, c.name AS c_name, c.email AS c_email FROM orders o JOIN customers c ON c.id = o.customer_id ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...p, per, (page - 1) * per]);
    const events = db.all('SELECT * FROM payment_events ORDER BY id DESC LIMIT 30');
    const pay = ctx.payments;
    h.page(req, res, {
      section: 'payments', title: 'Pagos',
      body: html`
<p class="muted">Pasarela: <strong>${pay.provider === 'stripe' ? `Stripe${pay.testMode ? ' (modo prueba)' : ''}` : pay.provider === 'test' ? 'pasarela de PRUEBA (no cobra)' : 'sin configurar'}</strong>. Un pedido solo pasa a «Pagado» cuando llega la notificación firmada de la pasarela; las notificaciones repetidas se ignoran.</p>
<form class="afilters" method="get"><input type="search" name="q" value="${q}" placeholder="Pedido, correo o sesión" aria-label="Buscar pedidos">
  <select name="estado" aria-label="Estado"><option value="">Todos</option>${Object.entries(ORDER_STATUS).map(([k, [l]]) => html`<option value="${k}"${st === k ? raw(' selected') : ''}>${l}</option>`)}</select><button class="abtn" type="submit">Filtrar</button></form>
${rows.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Concepto</th><th>Estado</th><th class="num">Total</th><th></th></tr></thead><tbody>
  ${rows.map((o) => html`<tr><td class="mono">${o.ref}<br><span class="muted small">${o.provider === 'manual' ? 'recepción' : o.provider}</span></td><td>${dt(o.created_at)}${o.paid_at ? html`<br><span class="muted small">pagado ${dt(o.paid_at)}</span>` : ''}</td>
    <td><a href="/admin/clientes/${o.customer_id}">${o.c_name || o.c_email}</a></td><td class="small">${JSON.parse(o.items).map((i) => i.name).join(', ')}${o.failed_reason ? html`<br><span class="muted">${o.failed_reason}</span>` : ''}</td>
    <td>${tag(ORDER_STATUS, o.status)}</td><td class="num">${eur(o.total_cents)}${o.refunded_cents ? html`<br><span class="muted small">devuelto ${eur(o.refunded_cents)}</span>` : ''}</td>
    <td>${o.status === 'refund_pending' ? html`${o.provider !== 'manual' && pay.available ? actionButton(res, `/admin/pagos/${o.ref}/reembolsar`, 'Reintentar reembolso', { confirm: '¿Solicitar el reembolso a la pasarela?' }) : ''}${actionButton(res, `/admin/pagos/${o.ref}/reembolsado`, 'Marcar como devuelto', { variant: 'ghost', confirm: '¿Confirmas que el importe se ha devuelto por otro medio?' })}` : ''}</td></tr>`)}
</tbody></table></div>${pager(req, page, pages)}` : empty('No hay pedidos.')}
<section class="apanel"><h2>Últimas notificaciones de la pasarela</h2>
  ${events.length ? html`<div class="ascroll"><table class="atable atable--compact"><thead><tr><th>Recibida</th><th>Tipo</th><th>Pedido</th><th>Resultado</th><th>Id. del evento</th></tr></thead><tbody>
    ${events.map((e) => html`<tr><td>${dt(e.received_at)}</td><td>${e.type}</td><td class="mono">${e.order_ref || ''}</td><td>${e.result || ''}</td><td class="mono small">${e.provider}:${e.event_id}</td></tr>`)}
  </tbody></table></div>` : empty('Todavía no se ha recibido ninguna notificación.')}
</section>`,
    });
  });

  const mustOrder = (req) => { const o = db.get('SELECT * FROM orders WHERE ref = ?', [String(req.params.ref).toUpperCase()]); if (!o) throw new AppError('NOT_FOUND', 404); return o; };
  r.post('/pagos/:ref/reembolsar', h.adminOnly, h.act(async (req, res) => {
    const o = mustOrder(req);
    if (o.status !== 'refund_pending') throw new AppError('NOT_REFUNDABLE', 409);
    try { await commerce.refundOrder(o); } catch (e) { console.error('[refund]', e); throw new AppError('PAYMENT_PROVIDER_ERROR', 502); }
    h.audit(req, 'order.refund_requested', 'order', o.ref);
    h.done(res, '/admin/pagos?estado=refund_pending', 'refunded');
  }, { back: '/admin/pagos' }));
  r.post('/pagos/:ref/reembolsado', h.adminOnly, h.act((req, res) => {
    const o = mustOrder(req);
    if (o.status !== 'refund_pending') throw new AppError('NOT_REFUNDABLE', 409);
    db.tx(() => {
      db.run("UPDATE orders SET status = 'refunded', refunded_cents = total_cents WHERE id = ?", [o.id]);
      db.run("UPDATE bookings SET payment_status = 'refunded' WHERE order_id = ? AND payment_status = 'refund_pending'", [o.id]);
    });
    h.audit(req, 'order.refunded_manually', 'order', o.ref);
    h.done(res, '/admin/pagos', 'saved');
  }, { back: '/admin/pagos' }));

  // ----------------------------------------------------------------- correos
  r.get('/correos', (req, res) => {
    const total = db.get('SELECT COUNT(*) AS n FROM outbox').n;
    const per = 50; const pages = Math.max(1, Math.ceil(total / per)); const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    const rows = db.all('SELECT id, to_email, subject, kind, related_ref, status, error, created_at FROM outbox ORDER BY id DESC LIMIT ? OFFSET ?', [per, (page - 1) * per]);
    h.page(req, res, {
      section: 'outbox', title: 'Correos',
      body: html`
<p class="muted">${ctx.cfg.smtp ? 'Los correos se envían por el servidor SMTP configurado.' : 'Modo prueba: no hay servidor de correo configurado, así que los correos NO se envían. Se guardan aquí para revisarlos.'}</p>
${rows.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Ref.</th><th>Estado</th></tr></thead><tbody>
  ${rows.map((m) => html`<tr><td>${dt(m.created_at)}</td><td>${m.to_email}</td><td><a href="/admin/correos/${m.id}">${m.subject}</a></td><td class="mono small">${m.related_ref || ''}</td><td>${tag(MAIL_STATUS, m.status)}${m.error ? html`<br><span class="muted small">${m.error}</span>` : ''}</td></tr>`)}
</tbody></table></div>${pager(req, page, pages)}` : empty('Aún no se ha generado ningún correo.')}`,
    });
  });

  r.get('/correos/:id', (req, res, next) => {
    const m = db.get('SELECT * FROM outbox WHERE id = ?', [Number(req.params.id)]);
    if (!m) return next();
    // La vista previa HTML se carga en un iframe aislado (sandbox, sin scripts).
    res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("frame-src ", "frame-src 'self' "));
    h.page(req, res, {
      section: 'outbox', title: m.subject,
      body: html`<p><strong>Para:</strong> ${m.to_email} · ${dt(m.created_at)} · ${tag(MAIL_STATUS, m.status)}</p>
${m.body_html ? html`<iframe class="amail" src="/admin/correos/${m.id}/html" sandbox title="Vista previa del correo"></iframe>` : ''}
<details class="apanel"><summary>Versión de texto</summary><pre class="apre">${m.body_text}</pre></details>
<p><a class="abtn abtn--ghost" href="/admin/correos">Volver</a></p>`,
    });
  });

  r.get('/correos/:id/html', (req, res, next) => {
    const m = db.get('SELECT body_html FROM outbox WHERE id = ?', [Number(req.params.id)]);
    if (!m?.body_html) return next();
    res.set('Content-Security-Policy', "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.type('html').send(m.body_html);
  });

  // ---------------------------------------------------------------- registro
  r.get('/registro', h.adminOnly, (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE action LIKE ? OR entity_id LIKE ? OR actor LIKE ?' : '';
    const p = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const total = db.get(`SELECT COUNT(*) AS n FROM audit_log ${where}`, p).n;
    const per = 100; const pages = Math.max(1, Math.ceil(total / per)); const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    const rows = db.all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, per, (page - 1) * per]);
    const users = new Map(db.all('SELECT id, name FROM users').map((u) => [`admin:${u.id}`, u.name]));
    h.page(req, res, {
      section: 'audit', title: 'Registro de actividad',
      body: html`
<form class="afilters" method="get"><input type="search" name="q" value="${q}" placeholder="Acción, referencia o autor" aria-label="Buscar en el registro"><button class="abtn" type="submit">Buscar</button></form>
${rows.length ? html`<div class="ascroll"><table class="atable atable--compact"><thead><tr><th>Fecha</th><th>Autor</th><th>Acción</th><th>Elemento</th><th>Datos</th></tr></thead><tbody>
  ${rows.map((l) => html`<tr><td class="mono small">${dt(l.created_at)}</td><td>${users.get(l.actor) || l.actor}</td><td>${l.action}</td><td class="mono small">${l.entity || ''} ${l.entity_id || ''}</td><td class="small muted">${l.data ? String(l.data).slice(0, 160) : ''}</td></tr>`)}
</tbody></table></div>${pager(req, page, pages)}` : empty('Sin actividad registrada.')}`,
    });
  });

  // ---------------------------------------------------------------- usuarios
  // La contraseña temporal se muestra una sola vez en la respuesta del formulario (nunca en la URL).
  function usersPage(req, res, temp = null) {
    const users = db.all('SELECT * FROM users ORDER BY active DESC, role, name');
    h.page(req, res, {
      section: 'users', title: 'Usuarios del panel',
      body: html`
${temp ? html`<div class="aflash aflash--ok" role="status">Contraseña temporal: <code class="mono">${temp}</code> — cópiala ahora y entrégala por un canal seguro. Se pedirá cambiarla al entrar. No se volverá a mostrar.</div>` : ''}
<p class="muted">«Recepción» gestiona reservas, solicitudes, clientes y bloqueos. «Administración» además gestiona tarifas, impuestos, ajustes, contenidos, pagos y usuarios.</p>
<div class="ascroll"><table class="atable"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead><tbody>
${users.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role === 'admin' ? 'Administración' : 'Recepción'}</td><td>${dt(u.last_login_at)}</td>
  <td>${u.active ? html`<span class="atag atag--ok">Activo</span>` : html`<span class="atag atag--off">Desactivado</span>`}${u.locked_until && u.locked_until > ctx.now() ? html` <span class="atag atag--bad">Bloqueado</span>` : ''}</td>
  <td class="aactions">${u.id === req.admin.id ? html`<span class="muted small">Tú</span>` : html`
    ${actionButton(res, `/admin/usuarios/${u.id}/clave`, 'Nueva contraseña temporal', { variant: 'ghost', confirm: '¿Generar una contraseña temporal para este usuario? Se cerrarán sus sesiones.' })}
    ${actionButton(res, `/admin/usuarios/${u.id}/estado`, u.active ? 'Desactivar' : 'Activar', { variant: u.active ? 'danger' : '', confirm: u.active ? '¿Desactivar este usuario? Se cerrarán sus sesiones.' : undefined })}`}</td></tr>`)}
</tbody></table></div>
<section class="apanel"><h2>Añadir usuario</h2>
  ${postForm(res, '/admin/usuarios', html`<div class="agridf">
    ${field({ label: 'Nombre', name: 'nombre', required: true })}
    ${field({ label: 'Correo', name: 'email', type: 'email', required: true })}
    ${field({ label: 'Rol', name: 'rol', type: 'select', options: [['staff', 'Recepción'], ['admin', 'Administración']] })}
  </div><button class="abtn abtn--primary" type="submit">Crear con contraseña temporal</button>`)}
</section>`,
    });
  }
  r.get('/usuarios', h.adminOnly, (req, res) => usersPage(req, res));

  const tempPassword = () => randomToken(12).replace(/[^A-Za-z0-9]/g, 'x');

  r.post('/usuarios', h.adminOnly, h.act((req, res) => {
    const email = normEmail(req.body.email);
    const name = String(req.body.nombre || '').trim().slice(0, 80);
    const role = req.body.rol === 'admin' ? 'admin' : 'staff';
    if (!email.includes('@') || name.length < 2) throw new AppError('VALIDATION');
    if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new AppError('EMAIL_EXISTS', 409);
    const pwd = tempPassword();
    const ins = db.run('INSERT INTO users (email, name, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,1,?)', [email, name, hashPassword(pwd), role, ctx.now()]);
    h.audit(req, 'user.created', 'user', String(ins.lastInsertRowid), { role });
    req.query.ok = 'created';
    usersPage(req, res, pwd);
  }, { back: '/admin/usuarios' }));

  r.post('/usuarios/:id/clave', h.adminOnly, h.act((req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!u || u.id === req.admin.id) throw new AppError('NOT_FOUND', 404);
    const pwd = tempPassword();
    db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?', [hashPassword(pwd), u.id]);
    ctx.sessions.destroyAllFor('admin', u.id);
    h.audit(req, 'user.password_reset', 'user', String(u.id));
    req.query.ok = 'password';
    usersPage(req, res, pwd);
  }, { back: '/admin/usuarios' }));

  r.post('/usuarios/:id/estado', h.adminOnly, h.act((req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!u || u.id === req.admin.id) throw new AppError('NOT_FOUND', 404);
    if (u.active && u.role === 'admin' && db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n <= 1) throw new AppError('LAST_ADMIN', 409);
    db.run('UPDATE users SET active = ? WHERE id = ?', [u.active ? 0 : 1, u.id]);
    if (u.active) ctx.sessions.destroyAllFor('admin', u.id);
    h.audit(req, u.active ? 'user.deactivated' : 'user.activated', 'user', String(u.id));
    h.done(res, '/admin/usuarios');
  }, { back: '/admin/usuarios' }));
}
