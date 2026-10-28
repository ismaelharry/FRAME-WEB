// Ciclo de vida: cambios y cancelaciones con su política, bonos con historial y pagos
// (correcto, rechazado, caducado, repetido, importe alterado, pago tardío y firma inválida).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, nextWeekday, person, enableSales, loginCustomer, gatewayEvent, noRateLimit } from './helpers.js';
import * as T from '../src/lib/time.js';

let app;
before(async () => { app = await startApp(); noRateLimit(app); });
after(async () => { await app.close(); });
afterEach(() => { app.ctx.clockOffset = 0; app.ctx.settings.set('commerce', { sales_enabled: false }); });

const booking = (ref) => app.ctx.db.get('SELECT * FROM bookings WHERE ref = ?', [ref]);
const orderOf = (b) => app.ctx.db.get('SELECT * FROM orders WHERE id = ?', [b.order_id]);
const balance = (id) => app.ctx.db.get('SELECT COALESCE(SUM(delta),0) AS s FROM voucher_ledger WHERE voucher_id = ?', [id]).s;

test('cambio y cancelación con el enlace de gestión, dentro de plazo', async () => {
  const c = await app.client().init();
  const date = nextWeekday(6);
  const r = await c.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '10:00', duration: 60, people: 2, ...person(301) });
  assert.equal(r.status, 201, r.text);
  const m = r.json.manageUrl;
  const t = new URL(m, app.base).searchParams.get('t');
  const page = await c.get(m);
  assert.equal(page.status, 200);
  const ch = await c.req('POST', `/reserva/${r.json.ref}/cambiar?t=${t}`, { form: { date, time: '12:00', people: '3' } });
  assert.equal(ch.status, 303);
  assert.match(ch.headers.get('location'), /ok=cambiada/);
  const b = booking(r.json.ref);
  assert.equal(T.fmtTime(b.start_utc), '12:00');
  assert.equal(b.people, 3);
  // El hueco antiguo queda libre y el nuevo ocupado.
  const slots = (await c.get(`/api/availability/slots?resource=sala-rambla&date=${date}&duration=60`)).json.slots;
  assert.equal(slots.find((s) => s.time === '10:00').available, true);
  assert.equal(slots.find((s) => s.time === '12:00').available, false);
  const cancel = await c.req('POST', `/reserva/${r.json.ref}/cancelar?t=${t}`, { form: {} });
  assert.match(cancel.headers.get('location'), /ok=cancelada/);
  assert.equal(booking(r.json.ref).status, 'cancelled');
  assert.equal(app.ctx.db.get('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?', [b.id]).n, 0);
});

test('fuera de plazo no se puede cambiar y la cancelación tardía no reembolsa', async () => {
  enableSales(app.ctx);
  const c = await app.client().init();
  const date = nextWeekday(6);
  const r = await c.post('/api/bookings', { service: 'room', resource: 'sala-salinas', date, time: '17:00', duration: 60, people: 2, ...person(302) });
  assert.equal(r.json.mode, 'pay');
  const b0 = booking(r.json.ref);
  await gatewayEvent(app, orderOf(b0), 'payment.succeeded', { amount: orderOf(b0).total_cents, currency: 'EUR', payment_id: 'pi_late_1' });
  assert.equal(booking(r.json.ref).payment_status, 'paid');
  // Avanzamos el reloj hasta 2 h antes del inicio.
  app.ctx.clockOffset = b0.start_utc - 2 * 3600_000 - Date.now();
  const t = new URL(r.json.manageUrl, app.base).searchParams.get('t');
  const ch = await c.req('POST', `/reserva/${r.json.ref}/cambiar?t=${t}`, { form: { date, time: '18:00' } });
  assert.match(ch.headers.get('location'), /error=CHANGE_WINDOW_CLOSED/);
  const cancel = await c.req('POST', `/reserva/${r.json.ref}/cancelar?t=${t}`, { form: {} });
  assert.match(cancel.headers.get('location'), /ok=cancelada/);
  const b = booking(r.json.ref);
  assert.equal(b.status, 'cancelled');
  assert.equal(b.payment_status, 'paid', 'fuera de plazo: sin reembolso');
  assert.equal(orderOf(b).status, 'paid');
});

test('bono: compra, uso, devolución al cancelar, sin saldo negativo', async () => {
  enableSales(app.ctx);
  const c = await app.client().init();
  const buy = await c.post('/api/purchases', { product: 'bono-10', ...person(303) });
  assert.equal(buy.status, 201, buy.text);
  assert.equal(buy.json.mode, 'pay');
  const order = app.ctx.db.get('SELECT * FROM orders WHERE ref = ?', [buy.json.ref]);
  assert.equal(order.total_cents, 14520, '120 € + 21 %');
  await gatewayEvent(app, order, 'payment.succeeded', { amount: order.total_cents, currency: 'EUR', payment_id: 'pi_bono_1' }, 'evt_bono_1');
  // Notificación repetida: no duplica créditos.
  const dup = await gatewayEvent(app, order, 'payment.succeeded', { amount: order.total_cents, currency: 'EUR', payment_id: 'pi_bono_1' }, 'evt_bono_1');
  assert.equal(dup.json.duplicate, true);
  const v = app.ctx.db.get('SELECT * FROM vouchers WHERE order_id = ?', [order.id]);
  assert.equal(balance(v.id), 10);
  assert.equal(app.ctx.db.get('SELECT COUNT(*) AS n FROM vouchers WHERE customer_id = ?', [order.customer_id]).n, 1);

  await loginCustomer(app, c, person(303).email);
  const date = nextWeekday(7);
  const use = await c.post('/api/bookings', { service: 'voucher', voucherId: v.id, date, people: 2, accept: true, lang: 'es' });
  assert.equal(use.status, 201, use.text);
  assert.equal(balance(v.id), 8);
  const tooMany = await c.post('/api/bookings', { service: 'voucher', voucherId: v.id, date: nextWeekday(8), people: 9, accept: true, lang: 'es' });
  assert.ok([400, 409].includes(tooMany.status));
  const t = new URL(use.json.manageUrl, app.base).searchParams.get('t');
  await c.req('POST', `/reserva/${use.json.ref}/cancelar?t=${t}`, { form: {} });
  assert.equal(balance(v.id), 10, 'los días vuelven al bono');
  const ledger = app.ctx.db.all('SELECT reason, delta FROM voucher_ledger WHERE voucher_id = ? ORDER BY id', [v.id]).map((l) => `${l.reason}:${l.delta}`);
  assert.deepEqual(ledger, ['purchase:10', 'use:-2', 'refund:2']);
  assert.throws(() => app.ctx.db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, created_at) VALUES (?, -11, 'adjust', ?)", [v.id, Date.now()]), /VOUCHER_NEGATIVE/);
  // Otro cliente no puede usar este bono.
  const other = await app.client().init();
  await loginCustomer(app, other, (await (async () => { app.ctx.bookings.upsertCustomer({ email: 'otro@example.com' }); return 'otro@example.com'; })()));
  const steal = await other.post('/api/bookings', { service: 'voucher', voucherId: v.id, date, people: 1, accept: true, lang: 'es' });
  assert.equal(steal.status, 404);
  assert.equal(steal.json.error, 'VOUCHER_NOT_FOUND');
});

test('pago rechazado mantiene el hueco hasta caducar; sesión caducada lo libera', async () => {
  enableSales(app.ctx);
  const c = await app.client().init();
  const date = nextWeekday(9);
  const r = await c.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '09:00', duration: 60, people: 2, ...person(304) });
  const b0 = booking(r.json.ref);
  assert.equal(b0.status, 'pending_payment');
  const failed = await gatewayEvent(app, orderOf(b0), 'payment.failed', { reason: 'card_declined' });
  assert.equal(failed.status, 200);
  assert.equal(orderOf(booking(r.json.ref)).status, 'failed');
  assert.equal(booking(r.json.ref).status, 'pending_payment', 'se puede reintentar mientras dure la retención');
  await gatewayEvent(app, orderOf(b0), 'checkout.expired', {});
  const b = booking(r.json.ref);
  assert.equal(b.status, 'expired');
  const again = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '09:00', duration: 60, people: 2, ...person(305) });
  assert.equal(again.status, 201, 'el hueco vuelve a estar libre');
});

test('pago abandonado: la retención caduca sola y libera el hueco', async () => {
  enableSales(app.ctx);
  const date = nextWeekday(10);
  const r = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-salinas', date, time: '11:00', duration: 60, people: 2, ...person(306) });
  assert.equal(booking(r.json.ref).status, 'pending_payment');
  app.ctx.clockOffset = 40 * 60_000;
  app.ctx.bookings.sweep();
  assert.equal(booking(r.json.ref).status, 'expired');
  assert.equal(orderOf(booking(r.json.ref)).status, 'expired');
});

test('importe alterado: no se confirma', async () => {
  enableSales(app.ctx);
  const r = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-salinas', date: nextWeekday(11), time: '12:00', duration: 60, people: 2, ...person(307) });
  const b = booking(r.json.ref);
  const out = await gatewayEvent(app, orderOf(b), 'payment.succeeded', { amount: 1, currency: 'EUR', payment_id: 'pi_bad' });
  assert.equal(out.json.result, 'amount_mismatch');
  assert.equal(booking(r.json.ref).status, 'pending_payment');
  assert.equal(orderOf(b).status, 'pending');
});

test('pago tardío de un hueco ya ocupado: queda pendiente de reembolso', async () => {
  enableSales(app.ctx);
  const date = nextWeekday(12);
  const r = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '15:00', duration: 60, people: 2, ...person(308) });
  const b0 = booking(r.json.ref);
  app.ctx.clockOffset = 40 * 60_000;
  app.ctx.bookings.sweep();
  const other = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '15:00', duration: 60, people: 2, ...person(309) });
  assert.equal(other.status, 201);
  await gatewayEvent(app, app.ctx.db.get('SELECT * FROM orders WHERE id = ?', [b0.order_id]), 'payment.succeeded', { amount: orderOf(b0).total_cents, currency: 'EUR', payment_id: 'pi_tarde' });
  assert.equal(orderOf(b0).status, 'refund_pending');
  assert.equal(booking(r.json.ref).status, 'expired', 'no se duplica la reserva');
  assert.equal(booking(r.json.ref).payment_status, 'refund_pending');
});

test('notificación con firma no válida o caducada: rechazada', async () => {
  const gw = app.ctx.payments.impl;
  const evt = gw.buildEvent('payment.succeeded', { order_ref: 'PD-XXXX-XXXX', amount: 100 });
  const bad = await fetch(`${app.base}/webhooks/test`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-frame-signature': evt.signature.replace(/v1=./, 'v1=0') }, body: evt.payload });
  assert.equal(bad.status, 400);
  const tampered = await fetch(`${app.base}/webhooks/test`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-frame-signature': evt.signature }, body: evt.payload.replace('100', '1') });
  assert.equal(tampered.status, 400);
  const old = `t=${Math.floor(Date.now() / 1000) - 3600},${evt.signature.split(',')[1]}`;
  const stale = await fetch(`${app.base}/webhooks/test`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-frame-signature': old }, body: evt.payload });
  assert.equal(stale.status, 400);
  const stripe = await fetch(`${app.base}/webhooks/stripe`, { method: 'POST', body: '{}' });
  assert.equal(stripe.status, 404, 'sin claves de Stripe el webhook no existe');
});

test('sin IVA configurado no se cobra nada y se muestra como orientativo', async () => {
  const q = await (await app.client().init()).post('/api/quote', { service: 'pass', date: nextWeekday(13), people: 2, lang: 'es' });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.mode, 'request');
  assert.doesNotMatch(JSON.stringify(q.json), /IVA 21/);
});
