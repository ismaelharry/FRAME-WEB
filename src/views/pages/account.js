import { html, raw } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, breadcrumbs } from '../components.js';
import { path } from '../../i18n/routes.js';
import { UI } from '../../i18n/ui.js';
import { money } from '../../lib/util.js';
import * as T from '../../lib/time.js';

export function statusTag(b, lang) {
  const ui = UI[lang];
  const cls = { confirmed: 'tag--ok', requested: 'tag--warn', pending_payment: 'tag--rec' }[b.status] || '';
  return html`<span class="tag ${cls}">${ui.status[b.status]}</span>`;
}

export function bookingWhen(b, lang) {
  if (b.kind === 'office') return `${T.fmtDateStr(b.local_date, lang, { day: 'numeric', month: 'short', year: 'numeric' })} → ${T.fmtDateStr(b.end_date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const d = T.fmtDate(b.start_utc, lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return b.kind === 'desk_day' ? d : `${d} · ${T.fmtTime(b.start_utc)}–${T.fmtTime(b.end_utc)}`;
}

export function renderLogin(ctx, req, res, { error } = {}) {
  const lang = req.lang;
  const es = lang !== 'en';
  const body = html`
<section class="page-hero wrap" style="min-height:70vh">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('account', lang), es ? 'Mi cuenta' : 'My account']])}
  ${label('', es ? 'Mi cuenta' : 'My account')}
  <h1 class="display-2 mt-2">${es ? 'Accede a tus reservas' : 'Access your bookings'}</h1>
  <div class="two-col mt-4">
    <div class="stack">
      <p class="lead">${es ? 'Sin contraseñas: escribe el correo con el que reservaste y te enviamos un enlace de acceso seguro.' : 'No passwords: enter the email you booked with and we will send you a secure sign-in link.'}</p>
      <p class="muted">${es ? 'Desde Mi cuenta puedes ver tus próximas reservas y el historial, cambiar o cancelar según las condiciones, consultar el saldo de tu bono, tus planes y tus justificantes, y actualizar tus datos.' : 'In My account you can see upcoming bookings and history, change or cancel according to the conditions, check your pass balance, plans and receipts, and update your details.'}</p>
      <p class="small muted">${es ? '¿Solo quieres gestionar una reserva? Usa el enlace del correo de confirmación.' : 'Just want to manage one booking? Use the link in your confirmation email.'}</p>
    </div>
    <form class="form panel" data-login-form novalidate>
      ${error ? html`<p class="alert alert--error">${error}</p>` : ''}
      <div class="field"><label for="acc-email">${es ? 'Correo electrónico' : 'Email'}</label><input id="acc-email" name="email" type="email" autocomplete="email" required></div>
      <div>${button({ type: 'submit', label: es ? 'Enviarme el enlace' : 'Send me the link' })}</div>
      <div data-form-result aria-live="polite"></div>
    </form>
  </div>
</section>
<script nonce="${res.locals.nonce}">
document.querySelector('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, out = f.querySelector('[data-form-result]');
  out.className = 'small muted'; out.textContent = '…';
  try {
    const r = await window.FRAME.postJSON('/api/account/login', { email: f.email.value, lang: '${lang}' });
    out.className = r.ok ? 'alert alert--ok' : 'alert alert--error';
    out.textContent = r.json.message || '';
    if (r.ok && r.json.mailbox) { const a = document.createElement('a'); a.href = r.json.mailbox; a.textContent = '${es ? 'Abrir la bandeja de pruebas (modo prueba: el correo no se envía)' : 'Open the test mailbox (test mode: email is not sent)'}'; a.target = '_blank'; const p = document.createElement('p'); p.className = 'small mt-1'; p.appendChild(a); out.after(p); }
  } catch { out.className = 'alert alert--error'; out.textContent = '${es ? 'No hay conexión.' : 'No connection.'}'; }
});
</script>`;
  return layout(ctx, req, res, { title: es ? 'Mi cuenta' : 'My account', description: es ? 'Accede a tus reservas, bonos y planes de FRAME.' : 'Access your FRAME bookings, passes and plans.', body, routeId: 'account', noindex: true });
}

export function renderDashboard(ctx, req, res, { flash } = {}) {
  const lang = req.lang;
  const es = lang !== 'en';
  const ui = UI[lang];
  const { db, catalog } = ctx;
  const c = req.customer;
  const now = ctx.now();
  const all = db.all('SELECT * FROM bookings WHERE customer_id = ? ORDER BY start_utc DESC', [c.id]);
  const upcoming = all.filter((b) => ['confirmed', 'requested', 'pending_payment'].includes(b.status) && b.end_utc > now).reverse();
  const history = all.filter((b) => !upcoming.includes(b)).slice(0, 40);
  const vouchers = db.all(`SELECT v.*, (SELECT COALESCE(SUM(delta),0) FROM voucher_ledger WHERE voucher_id = v.id) AS balance FROM vouchers v WHERE customer_id = ? ORDER BY created_at DESC`, [c.id]);
  const plans = db.all('SELECT p.*, pr.name_es, pr.name_en FROM plans p JOIN products pr ON pr.id = p.product_id WHERE p.customer_id = ? ORDER BY p.created_at DESC', [c.id]);
  const orders = db.all("SELECT * FROM orders WHERE customer_id = ? AND status IN ('paid','refunded','refund_pending') ORDER BY paid_at DESC", [c.id]);
  const renewals = db.all("SELECT * FROM orders WHERE customer_id = ? AND kind = 'plan' AND status = 'pending' AND expires_at IS NULL ORDER BY created_at DESC", [c.id]);
  const csrf = req.customerSession.csrf;
  const manage = (b) => `${path('manage', b.lang || lang, `/${b.ref}`)}?t=${ctx.bookings.manageToken(b.ref, c)}`;
  const resName = (b) => { const r = catalog.resourceById(b.resource_id); const p = b.product_id ? catalog.productById(b.product_id) : null; return r.kind === 'desk_pool' ? (p ? p[`name_${lang}`] : ui.usage[b.usage]) : r[`name_${lang}`]; };
  const flashText = { datos: es ? 'Datos actualizados.' : 'Details updated.', baja: es ? 'Baja registrada: el plan seguirá activo hasta el final del periodo.' : 'Cancellation registered: the plan stays active until the end of the period.' }[flash];

  const bookingRow = (b, actions = true) => html`<li class="acc-row">
    <div><strong>${resName(b)}</strong> <span class="muted small">· ${ui.usage[b.usage] || ''}</span><br><span class="small">${bookingWhen(b, lang)} · ${b.people} ${es ? 'pers.' : 'ppl.'}</span><br><span class="mono small muted">${b.ref}</span></div>
    <div class="acc-row__side">${statusTag(b, lang)}<span class="small muted">${ui.payment[b.payment_status]}</span>
      ${actions ? html`<a class="link-arrow small" href="${manage(b)}">${es ? 'Gestionar' : 'Manage'}</a>` : ''}
      ${['paid', 'refunded', 'refund_pending', 'included', 'offline'].includes(b.payment_status) || b.status === 'confirmed' ? html`<a class="small" href="${path('receipt', lang, `/${b.ref}`)}">${es ? 'Justificante' : 'Receipt'}</a>` : ''}</div>
  </li>`;

  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('account', lang), es ? 'Mi cuenta' : 'My account']])}
  <div class="flex between wrap-row gap-2" style="align-items:end">
    <div>${label('', es ? 'Mi cuenta' : 'My account')}<h1 class="display-2 mt-2">${es ? 'Hola' : 'Hello'}${c.name ? `, ${c.name.split(' ')[0]}` : ''}</h1><p class="muted mt-1">${c.email}</p></div>
    <form method="post" action="${path('account', lang)}/salir"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn--ghost btn--sm" type="submit"><span class="btn__roll"><span>${es ? 'Cerrar sesión' : 'Sign out'}</span><span aria-hidden="true">${es ? 'Cerrar sesión' : 'Sign out'}</span></span><span class="btn__icon">→</span></button></form>
  </div>
  ${flashText ? html`<p class="alert alert--ok mt-3" role="status">${flashText}</p>` : ''}
  <div class="btn-row mt-3">
    ${button({ href: path('book', lang), label: es ? 'Nueva reserva' : 'New booking', size: 'sm' })}
    ${vouchers.some((v) => v.balance > 0 && v.status === 'active') ? button({ href: `${path('book', lang)}?servicio=voucher`, label: es ? 'Reservar con mi bono' : 'Book with my pass', size: 'sm', variant: 'rec' }) : ''}
    ${plans.some((p) => p.plan_type === 'flex' && p.status === 'active') ? button({ href: `${path('book', lang)}?servicio=flex`, label: es ? 'Reservar mi día (mesa flexible)' : 'Book my day (flexible desk)', size: 'sm', variant: 'rec' }) : ''}
  </div>
</section>

<section class="wrap acc-grid">
  <div class="stack" style="--stack:2.6rem">
    <div id="proximas"><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Próximas reservas' : 'Upcoming bookings'}</h2>
      ${upcoming.length ? html`<ul class="acc-list">${upcoming.map((b) => bookingRow(b))}</ul>` : html`<p class="muted">${es ? 'No tienes reservas próximas.' : 'You have no upcoming bookings.'}</p>`}</div>

    <div id="bonos"><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Bonos' : 'Passes'}</h2>
      ${vouchers.length ? vouchers.map((v) => {
        const ledger = db.all('SELECT l.*, b.ref AS booking_ref, b.local_date FROM voucher_ledger l LEFT JOIN bookings b ON b.id = l.booking_id WHERE l.voucher_id = ? ORDER BY l.id DESC', [v.id]);
        const expired = v.expires_on && v.expires_on < T.todayLocal(now);
        return html`<div class="panel mb-2">
          <div class="flex between wrap-row gap-1"><div><span class="mono small muted">${v.code}</span><p class="mb-0" style="font-size:1.4rem;font-stretch:108%"><strong>${v.balance}</strong> / ${v.credits_total} ${es ? 'días disponibles' : 'days left'}</p></div>
          <div class="small ${expired ? '' : 'muted'}">${expired ? (es ? 'Caducado el ' : 'Expired on ') : (es ? 'Válido hasta el ' : 'Valid until ')}${T.fmtDateStr(v.expires_on, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
          <div class="meter mt-2" role="img" aria-label="${v.balance} / ${v.credits_total}"><span style="width:${Math.round((v.balance / v.credits_total) * 100)}%"></span></div>
          <details class="mt-2"><summary class="small">${es ? 'Historial de movimientos' : 'Movement history'}</summary>
            <table class="mini-table mt-1"><thead><tr><th>${es ? 'Fecha' : 'Date'}</th><th>${es ? 'Movimiento' : 'Movement'}</th><th>${es ? 'Reserva' : 'Booking'}</th><th class="num">${es ? 'Días' : 'Days'}</th></tr></thead>
            <tbody>${ledger.map((l) => html`<tr><td>${T.fmtDate(l.created_at, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${{ purchase: es ? 'Compra' : 'Purchase', use: es ? 'Uso' : 'Use', refund: es ? 'Devolución' : 'Refund', adjust: es ? 'Ajuste' : 'Adjustment', expire: es ? 'Caducidad' : 'Expiry' }[l.reason]}${l.note ? html` <span class="muted">· ${l.note}</span>` : ''}</td><td class="mono">${l.booking_ref ? `${l.booking_ref} · ${l.local_date}` : '—'}</td><td class="num">${l.delta > 0 ? `+${l.delta}` : l.delta}</td></tr>`)}</tbody></table>
          </details>
        </div>`;
      }) : html`<p class="muted">${es ? 'No tienes bonos.' : 'You have no passes.'} <a href="${path('book', lang)}?servicio=bundle">${es ? 'Ver el bono de 10 días' : 'See the 10-day pass'}</a></p>`}</div>

    <div id="planes"><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Planes' : 'Plans'}</h2>
      ${plans.length ? html`<ul class="acc-list">${plans.map((p) => html`<li class="acc-row"><div><strong>${p[`name_${lang}`]}</strong><br>
        <span class="small">${es ? 'Inicio' : 'Start'}: ${T.fmtDateStr(p.start_date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}${p.period_end ? ` · ${es ? 'periodo hasta' : 'period until'} ${T.fmtDateStr(T.addDays(p.period_end, -1), lang, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${p.desk_label ? ` · ${es ? 'puesto' : 'desk'} ${p.desk_label}` : ''}</span><br>
        <span class="mono small muted">${p.ref}</span>${p.cancel_at_period_end ? html` <span class="tag">${es ? 'baja al final del periodo' : 'ends at period end'}</span>` : ''}</div>
        <div class="acc-row__side"><span class="tag ${p.status === 'active' ? 'tag--ok' : p.status === 'requested' ? 'tag--warn' : ''}">${ui.planStatus[p.status]}</span>
        ${['active', 'past_due'].includes(p.status) && !p.cancel_at_period_end ? html`<form method="post" action="${path('account', lang)}/planes/${p.ref}/baja" data-confirm="${es ? '¿Seguro que quieres darte de baja al final del periodo?' : 'Cancel at the end of the period?'}"><input type="hidden" name="_csrf" value="${csrf}"><button class="textbtn small" type="submit">${es ? 'Solicitar la baja' : 'Cancel plan'}</button></form>` : ''}
        ${['requested', 'pending_payment'].includes(p.status) ? html`<span class="small muted">${es ? 'Te contactaremos' : 'We will contact you'}</span>` : ''}</div></li>`)}</ul>` : html`<p class="muted">${es ? 'No tienes planes.' : 'You have no plans.'} <a href="${path('pricing', lang)}">${es ? 'Ver planes' : 'See plans'}</a></p>`}
      ${renewals.map((o) => html`<p class="note note--warn mt-2 small">${es ? 'Tienes una renovación pendiente de pago' : 'You have a renewal pending payment'} (${o.ref}, ${money(o.total_cents, lang, { decimals: 2 })}). <a href="/pagar/${o.ref}?t=${ctx.commerce.orderToken(o.ref)}">${es ? 'Pagar ahora' : 'Pay now'}</a></p>`)}</div>

    <div id="justificantes"><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Justificantes de pago' : 'Payment receipts'}</h2>
      ${orders.length ? html`<table class="mini-table"><thead><tr><th>${es ? 'Pedido' : 'Order'}</th><th>${es ? 'Fecha' : 'Date'}</th><th>${es ? 'Concepto' : 'Item'}</th><th class="num">${es ? 'Importe' : 'Amount'}</th><th></th></tr></thead>
        <tbody>${orders.map((o) => html`<tr><td class="mono">${o.ref}</td><td>${T.fmtDate(o.paid_at || o.created_at, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${JSON.parse(o.items)[0]?.name || ''}</td><td class="num">${money(o.total_cents, lang, { decimals: 2 })}${o.status !== 'paid' ? html`<br><span class="small muted">${o.status === 'refunded' ? (es ? 'reembolsado' : 'refunded') : (es ? 'reembolso en trámite' : 'refund pending')}</span>` : ''}</td><td><a href="${path('receipt', lang, `/${o.ref}`)}">${es ? 'Ver' : 'View'}</a></td></tr>`)}</tbody></table>
        <p class="small muted mt-1">${es ? 'Los justificantes no son facturas. La factura la emite FRAME S.L. desde su sistema de facturación.' : 'Receipts are not invoices. Invoices are issued by FRAME S.L. through its invoicing system.'}</p>` : html`<p class="muted">${es ? 'Aún no hay pagos registrados.' : 'No payments recorded yet.'}</p>`}</div>

    <div id="historial"><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Historial' : 'History'}</h2>
      ${history.length ? html`<ul class="acc-list">${history.map((b) => bookingRow(b, false))}</ul>` : html`<p class="muted">${es ? 'Sin reservas anteriores.' : 'No past bookings.'}</p>`}</div>
  </div>

  <aside>
    <form class="form panel panel--sticky" id="datos" method="post" action="${path('account', lang)}/datos">
      <h2 class="display-3" style="font-size:1.4rem">${es ? 'Mis datos' : 'My details'}</h2>
      <input type="hidden" name="_csrf" value="${csrf}">
      <div class="field"><label for="a-name">${es ? 'Nombre y apellidos' : 'Full name'}</label><input id="a-name" name="name" required minlength="2" value="${c.name || ''}" autocomplete="name"></div>
      <div class="field"><label for="a-phone">${es ? 'Teléfono' : 'Phone'}</label><input id="a-phone" name="phone" type="tel" value="${c.phone || ''}" autocomplete="tel"></div>
      <div class="field"><label for="a-company">${es ? 'Empresa' : 'Company'}</label><input id="a-company" name="company" value="${c.company || ''}" autocomplete="organization"></div>
      <div class="field"><label for="a-tax">${es ? 'NIF/CIF (facturación)' : 'Tax ID (invoicing)'}</label><input id="a-tax" name="tax_id" value="${c.tax_id || ''}"></div>
      <div class="field"><label for="a-addr">${es ? 'Dirección de facturación' : 'Billing address'}</label><textarea id="a-addr" name="billing_address" rows="2">${c.billing_address || ''}</textarea></div>
      <div class="field"><label for="a-lang">${es ? 'Idioma de los correos' : 'Email language'}</label><select id="a-lang" name="lang"><option value="es" ${raw(c.lang === 'es' ? 'selected' : '')}>Español</option><option value="en" ${raw(c.lang === 'en' ? 'selected' : '')}>English</option></select></div>
      <label class="check"><input type="checkbox" name="marketing" ${raw(c.marketing_opt_in ? 'checked' : '')}><span>${es ? 'Quiero recibir novedades y eventos de FRAME.' : 'I want to receive FRAME news and events.'}</span></label>
      <p class="small muted">${es ? 'El correo electrónico identifica tu cuenta. Para cambiarlo o ejercer tus derechos de protección de datos, escribe a ' : 'Your email identifies your account. To change it or exercise your data rights, write to '}<a href="mailto:${ctx.settings.get('business').email}">${ctx.settings.get('business').email}</a>.</p>
      <div>${button({ type: 'submit', label: es ? 'Guardar' : 'Save', size: 'sm' })}</div>
    </form>
  </aside>
</section>
<script nonce="${res.locals.nonce}">document.querySelectorAll('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));</script>`;
  return layout(ctx, req, res, { title: es ? 'Mi cuenta' : 'My account', description: es ? 'Tus reservas, bonos y planes en FRAME.' : 'Your FRAME bookings, passes and plans.', body, routeId: 'account', noindex: true });
}

export function renderReceipt(ctx, req, res, { booking, order }) {
  const lang = req.lang;
  const es = lang !== 'en';
  const ui = UI[lang];
  const b = ctx.settings.get('business');
  const customer = ctx.db.get('SELECT * FROM customers WHERE id = ?', [booking ? booking.customer_id : order.customer_id]);
  const items = order ? JSON.parse(order.items) : [];
  const ref = booking ? booking.ref : order.ref;
  const body = html`
<section class="page-hero wrap receipt">
  <div class="panel" style="max-width:760px">
    <div class="flex between wrap-row gap-2"><img src="/brand/frame-logo-dark.svg" alt="FRAME · Estudio de contenido y coworking" width="164" height="40"><button type="button" class="textbtn small no-print" data-print>${es ? 'Imprimir o guardar en PDF' : 'Print or save as PDF'}</button></div>
    <h1 class="display-3 mt-3">${es ? 'Justificante' : 'Receipt'} · <span class="mono">${ref}</span></h1>
    <p class="note small mt-2">${es ? 'Este documento acredita la operación y su estado. No es una factura.' : 'This document certifies the operation and its status. It is not an invoice.'}</p>
    <dl class="review mt-3">
      <div><dt>${es ? 'Prestador' : 'Provider'}</dt><dd>${b.legal_name} · NIF ${b.tax_id}<br>${b.street}, ${b.postal_code} ${b.city}</dd></div>
      <div><dt>${es ? 'Cliente' : 'Customer'}</dt><dd>${customer.name || ''} · ${customer.email}${customer.tax_id ? ` · ${customer.tax_id}` : ''}</dd></div>
      ${booking ? html`
        <div><dt>${es ? 'Servicio' : 'Service'}</dt><dd>${ctx.catalog.resourceById(booking.resource_id)[`name_${lang}`]} · ${ui.usage[booking.usage]}</dd></div>
        <div><dt>${es ? 'Fecha y horario' : 'Date and time'}</dt><dd>${bookingWhen(booking, lang)} (${es ? 'hora de Madrid' : 'Madrid time'})</dd></div>
        <div><dt>${es ? 'Personas' : 'People'}</dt><dd>${booking.people}</dd></div>
        <div><dt>${es ? 'Estado' : 'Status'}</dt><dd>${ui.status[booking.status]} · ${ui.payment[booking.payment_status]}</dd></div>
        ${booking.price_final && booking.total_cents !== null ? html`<div><dt>${es ? 'Importe' : 'Amount'}</dt><dd>${money(booking.subtotal_cents, lang, { decimals: 2 })} + ${(booking.tax_rate_bp / 100).toLocaleString(es ? 'es-ES' : 'en-GB')} % = <strong>${money(booking.total_cents, lang, { decimals: 2 })}</strong></dd></div>` : booking.subtotal_cents ? html`<div><dt>${es ? 'Importe' : 'Amount'}</dt><dd>${money(booking.subtotal_cents, lang, { decimals: 2 })} ${es ? 'base orientativa sin impuestos (sin cargo)' : 'indicative base before tax (not charged)'}</dd></div>` : ''}` : ''}
      ${order ? html`
        <div><dt>${es ? 'Pedido' : 'Order'}</dt><dd class="mono">${order.ref}</dd></div>
        ${items.map((i) => html`<div><dt>${es ? 'Concepto' : 'Item'}</dt><dd>${i.name}</dd></div>`)}
        <div><dt>${es ? 'Base' : 'Base'}</dt><dd>${money(order.subtotal_cents, lang, { decimals: 2 })}</dd></div>
        <div><dt>${es ? 'Impuestos' : 'Tax'}</dt><dd>${(order.tax_rate_bp / 100).toLocaleString(es ? 'es-ES' : 'en-GB')} % · ${money(order.tax_cents, lang, { decimals: 2 })}</dd></div>
        <div><dt>${es ? 'Total' : 'Total'}</dt><dd><strong>${money(order.total_cents, lang, { decimals: 2 })}</strong></dd></div>
        <div><dt>${es ? 'Pago' : 'Payment'}</dt><dd>${{ paid: es ? 'Pagado' : 'Paid', pending: es ? 'Pendiente' : 'Pending', failed: es ? 'No completado' : 'Not completed', expired: es ? 'Caducado' : 'Expired', cancelled: es ? 'Cancelado' : 'Cancelled', refunded: es ? 'Reembolsado' : 'Refunded', refund_pending: es ? 'Reembolso en trámite' : 'Refund pending' }[order.status]}${order.paid_at ? ` · ${T.fmtDateTime(order.paid_at, lang)}` : ''} · ${order.provider === 'test' ? (es ? 'pasarela de PRUEBA (sin cargo real)' : 'TEST gateway (no real charge)') : order.provider === 'manual' ? (es ? 'registrado en recepción' : 'recorded at reception') : 'Stripe'}</dd></div>` : ''}
    </dl>
    ${(booking?.conditions || order?.conditions) ? html`<h2 class="label mt-3">${es ? 'Condiciones aceptadas' : 'Accepted conditions'}</h2><ul class="list-dash small mt-1">${(booking?.conditions || order.conditions).split('\n').map((l) => html`<li>${l}</li>`)}</ul>` : ''}
  </div>
</section>
<script nonce="${res.locals.nonce}">document.querySelector('[data-print]')?.addEventListener('click', () => window.print());</script>`;
  return layout(ctx, req, res, { title: `${es ? 'Justificante' : 'Receipt'} ${ref}`, description: es ? 'Justificante de operación' : 'Operation receipt', body, noindex: true, alt: { es: '/cuenta', en: '/en/account' } });
}

export function renderMailbox(ctx, req, res, mails) {
  const lang = req.lang;
  const es = lang !== 'en';
  const body = html`
<section class="page-hero wrap">
  ${label('', es ? 'Modo prueba' : 'Test mode')}
  <h1 class="display-2 mt-2">${es ? 'Bandeja de pruebas' : 'Test mailbox'}</h1>
  <p class="test-banner mt-3">${es ? 'No hay un servidor de correo configurado: estos mensajes NO se han enviado. Solo ves los generados desde este navegador. En producción esta página no existe.' : 'No mail server is configured: these messages have NOT been sent. You only see those generated from this browser. This page does not exist in production.'}</p>
  ${mails.length ? mails.map((m) => html`<article class="panel mt-3">
    <p class="small muted mb-0">${T.fmtDateTime(m.created_at, lang)} · ${es ? 'para' : 'to'} ${m.to_email} · <span class="tag tag--warn">${m.status === 'not_sent_test_mode' ? (es ? 'no enviado (modo prueba)' : 'not sent (test mode)') : m.status}</span></p>
    <h2 style="font-size:1.15rem;font-weight:550;margin:8px 0 12px">${m.subject}</h2>
    <iframe title="${m.subject}" sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${m.body_html || `<pre>${m.body_text}</pre>`}" style="width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>
  </article>`) : html`<p class="mt-3 muted">${es ? 'Todavía no hay correos generados desde este navegador.' : 'No emails generated from this browser yet.'}</p>`}
</section>`;
  return layout(ctx, req, res, { title: es ? 'Bandeja de pruebas' : 'Test mailbox', description: 'Test', body, noindex: true, alt: { es: '/correo-prueba', en: '/correo-prueba' } });
}
