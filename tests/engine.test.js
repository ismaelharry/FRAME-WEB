import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, nextWeekday, person, enableSales } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

test('pase de día sin IVA configurado se guarda como solicitud sin cargo', async () => {
  const c = await app.client().init();
  const date = nextWeekday(4);
  const r = await c.post('/api/bookings', { service: 'pass', date, people: 1, ...person(1) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'requested');
  assert.equal(r.json.mode, 'request');
  const b = app.ctx.db.get('SELECT * FROM bookings WHERE ref = ?', [r.json.ref]);
  assert.equal(b.payment_status, 'unpaid');
  assert.equal(b.tax_cents, null);
  assert.equal(b.price_final, 0);
});

test('sala: reserva y solapamiento rechazado', async () => {
  const c1 = await app.client().init();
  const c2 = await app.client().init();
  const date = nextWeekday(5);
  const a = await c1.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '10:00', duration: 120, people: 3, ...person(2) });
  assert.equal(a.status, 201, a.text);
  const b = await c2.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '11:00', duration: 60, people: 2, ...person(3) });
  assert.equal(b.status, 409);
  assert.equal(b.json.error, 'SLOT_TAKEN');
  const slots = await c2.get(`/api/availability/slots?resource=sala-rambla&date=${date}&duration=60`);
  const s11 = slots.json.slots.find((s) => s.time === '11:00');
  assert.equal(s11.available, false);
  const s12 = slots.json.slots.find((s) => s.time === '12:00');
  assert.equal(s12.available, true);
});

test('capacidad de personas validada en servidor', async () => {
  const c = await app.client().init();
  const r = await c.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date: nextWeekday(6), time: '16:00', duration: 60, people: 9, ...person(4) });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'TOO_MANY_PEOPLE');
});

test('pago con IVA: pasarela de prueba, éxito y notificación repetida', async () => {
  enableSales(app.ctx);
  const c = await app.client().init();
  const date = nextWeekday(7);
  const r = await c.post('/api/bookings', { service: 'room', resource: 'sala-salinas', date, time: '09:00', duration: 60, people: 4, ...person(5) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.mode, 'pay');
  assert.match(r.json.redirect, /pago-prueba/);
  const b = app.ctx.db.get('SELECT * FROM bookings WHERE ref = ?', [r.json.ref]);
  assert.equal(b.status, 'pending_payment');
  assert.equal(b.total_cents, 2420);
  const order = app.ctx.db.get('SELECT * FROM orders WHERE id = ?', [b.order_id]);
  const gw = app.ctx.payments.impl;
  const evt = gw.buildEvent('payment.succeeded', { order_ref: order.ref, session_id: order.provider_session_id, amount: order.total_cents, currency: 'EUR', payment_id: 'pi_test_1' }, 'evt_dup_1');
  const res1 = app.ctx.commerce.handleEvent(gw.normalize(JSON.parse(evt.payload)));
  assert.equal(res1.result.status, 'paid');
  const res2 = app.ctx.commerce.handleEvent(gw.normalize(JSON.parse(evt.payload)));
  assert.equal(res2.duplicate, true);
  const after = app.ctx.db.get('SELECT * FROM bookings WHERE ref = ?', [r.json.ref]);
  assert.equal(after.status, 'confirmed');
  assert.equal(after.payment_status, 'paid');
  assert.equal(app.ctx.db.get('SELECT COUNT(*) n FROM payment_events').n, 1);
  app.ctx.settings.set('commerce', { sales_enabled: false });
});
