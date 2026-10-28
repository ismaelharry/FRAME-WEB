import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label } from '../components.js';
import { path } from '../../i18n/routes.js';
import { money } from '../../lib/util.js';
import * as T from '../../lib/time.js';

export function renderTestGateway(ctx, req, res, { order, last, flash }) {
  const lang = req.lang;
  const es = true;
  const items = JSON.parse(order.items);
  const csrf = res.locals.csrfPublic;
  const sid = order.provider_session_id;
  const msgs = {
    duplicate_ignored: 'Notificación repetida recibida y verificada: se ha ignorado porque ya se había procesado. No se ha duplicado ninguna reserva, cobro ni crédito.',
    processed: 'La notificación se ha procesado.',
    not_pending: 'Este pedido ya no está pendiente de pago.',
    expired: 'La sesión de pago ha caducado y el hueco se ha liberado.',
    no_event: 'Todavía no se ha enviado ninguna notificación para este pedido.',
  };
  const action = (a, text, variant) => html`<form method="post" action="/pago-prueba/${sid}/${a}"><input type="hidden" name="_csrf" value="${csrf}">${button({ type: 'submit', label: text, variant, block: true })}</form>`;
  const body = html`
<section class="page-hero wrap" style="max-width:820px">
  <p class="test-banner">PASARELA DE PRUEBA · No es una pasarela real y no se realiza ningún cargo. Sirve para probar el flujo completo mientras no haya claves de Stripe configuradas.</p>
  ${label('', 'Pago de prueba')}
  <h1 class="display-2 mt-2">${money(order.total_cents, 'es', { decimals: 2 })}</h1>
  <p class="muted">Pedido <span class="mono">${order.ref}</span> · ${order.status === 'pending' ? `pendiente${order.expires_at ? `, caduca a las ${T.fmtTime(order.expires_at)}` : ''}` : order.status}</p>
  ${flash && msgs[flash] ? html`<p class="alert ${flash === 'duplicate_ignored' || flash === 'processed' ? 'alert--ok' : 'alert--error'} mt-3" role="status">${msgs[flash]}</p>` : ''}
  <div class="panel mt-3">
    <ul class="list-dash small">${items.map((i) => html`<li><span style="flex:1">${i.name}</span><span class="tabular">${money(i.total_cents, 'es', { decimals: 2 })}</span></li>`)}</ul>
    <p class="small muted mt-2">Base ${money(order.subtotal_cents, 'es', { decimals: 2 })} · Impuestos ${(order.tax_rate_bp / 100).toLocaleString('es-ES')} % ${money(order.tax_cents, 'es', { decimals: 2 })}</p>
  </div>
  <div class="grid mt-4" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:10px">
    ${order.status === 'pending' ? html`${action('pagar', 'Simular pago correcto', 'rec')}${action('rechazar', 'Simular pago rechazado', '')}${action('caducar', 'Simular sesión caducada', 'ghost')}${action('volver', 'Volver sin pagar', 'ghost')}` : ''}
    ${last ? action('repetir', 'Reenviar la última notificación', 'ghost') : ''}
  </div>
  <p class="small muted mt-3">Cada botón genera una notificación firmada (HMAC-SHA256, mismo formato que los webhooks de Stripe) que el servidor verifica antes de cambiar el estado. El navegador nunca marca nada como pagado por sí mismo.</p>
  ${last ? html`<p class="small muted">Última notificación: <span class="mono">${last.event_id}</span> · ${last.type} · ${last.result || ''}</p>` : ''}
</section>`;
  return layout(ctx, req, res, { title: 'Pasarela de prueba', description: 'Pasarela de prueba', body, noindex: true, hideFab: true, alt: { es: req.path, en: req.path } });
}

export function renderOrder(ctx, req, res, { order, token, payment }) {
  const lang = req.lang;
  const c = ctx.db.get('SELECT * FROM customers WHERE id = ?', [order.customer_id]);
  const l = c.lang || 'es';
  const es = l !== 'en';
  const items = JSON.parse(order.items);
  const voucher = ctx.db.get('SELECT v.*, (SELECT COALESCE(SUM(delta),0) FROM voucher_ledger WHERE voucher_id = v.id) AS balance FROM vouchers v WHERE order_id = ?', [order.id]);
  const plan = items[0]?.plan_ref ? ctx.db.get('SELECT * FROM plans WHERE ref = ?', [items[0].plan_ref]) : null;
  const waiting = order.status === 'pending' && payment === 'ok';
  const statusText = { pending: es ? 'Pendiente de pago' : 'Awaiting payment', paid: es ? 'Pagado' : 'Paid', failed: es ? 'Pago no completado' : 'Payment not completed', expired: es ? 'Caducado (sin cargo)' : 'Expired (no charge)', cancelled: es ? 'Cancelado' : 'Cancelled', refunded: es ? 'Reembolsado' : 'Refunded', refund_pending: es ? 'Reembolso en trámite' : 'Refund pending' }[order.status];
  const body = html`
<section class="page-hero wrap" style="max-width:860px">
  ${label('', `${es ? 'Pedido' : 'Order'} · ${order.ref}`)}
  <h1 class="display-2 mt-2">${statusText}</h1>
  ${waiting ? html`<div class="note note--warn mt-3" data-poll-order="/api/orders/${order.ref}/status?t=${token}" role="status">${es ? 'Esperando la confirmación de la pasarela de pago…' : 'Waiting for the payment gateway confirmation…'}</div>` : ''}
  ${order.status === 'pending' && payment === 'cancelado' ? html`<p class="note mt-3">${es ? 'No se ha completado el pago y no se ha cobrado nada.' : 'The payment was not completed and nothing was charged.'} <a href="/pagar/${order.ref}?t=${token}">${es ? 'Intentarlo de nuevo' : 'Try again'}</a></p>` : ''}
  <div class="panel mt-3">
    <ul class="list-dash small">${items.map((i) => html`<li><span style="flex:1">${i.name}</span><span class="tabular">${money(i.total_cents, l, { decimals: 2 })}</span></li>`)}</ul>
    <div class="total-box"><span>Total</span><strong>${money(order.total_cents, l, { decimals: 2 })}</strong></div>
  </div>
  ${voucher ? html`<div class="panel mt-3"><p class="mb-0">${es ? 'Tu bono' : 'Your pass'} <span class="mono">${voucher.code}</span> ${es ? 'está activo' : 'is active'}: <strong>${voucher.balance}</strong> ${es ? 'días' : 'days'} · ${es ? 'válido hasta' : 'valid until'} ${T.fmtDateStr(voucher.expires_on, l, { day: 'numeric', month: 'long', year: 'numeric' })}.</p></div>` : ''}
  ${plan ? html`<p class="mt-3">${es ? 'Plan' : 'Plan'} <span class="mono">${plan.ref}</span>: ${plan.status === 'active' ? (es ? 'activo' : 'active') : plan.status}${plan.desk_label ? ` · ${es ? 'puesto' : 'desk'} ${plan.desk_label}` : ''}.</p>` : ''}
  <div class="btn-row mt-4">${button({ href: path('account', l), label: es ? 'Ir a Mi cuenta' : 'Go to My account' })}${order.status === 'paid' ? button({ href: `${path('receipt', l, `/${order.ref}`)}?t=${token}`, label: es ? 'Ver justificante' : 'View receipt', variant: 'ghost' }) : ''}</div>
</section>
<script nonce="${res.locals.nonce}">
(() => { const el = document.querySelector('[data-poll-order]'); if (!el) return; let n = 0;
  const tick = async () => { n++; try { const r = await fetch(el.dataset.pollOrder).then((x) => x.json()); if (r.status !== 'pending') { location.href = location.pathname + location.search.replace(/&pago=ok/, ''); return; } } catch {} if (n < 40) setTimeout(tick, 2500); };
  setTimeout(tick, 1500); })();
</script>`;
  return layout(ctx, req, res, { title: `${es ? 'Pedido' : 'Order'} ${order.ref}`, description: statusText, body, noindex: true, alt: { es: req.path, en: req.path } });
}
