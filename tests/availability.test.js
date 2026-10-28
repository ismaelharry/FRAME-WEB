// Disponibilidad real: inventario compartido de puestos, días cerrados, festivos, bloqueos,
// antelación, horizonte y zona horaria Europe/Madrid (cambios de hora).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, nextWeekday, person } from './helpers.js';
import * as T from '../src/lib/time.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const setDesks = (n) => app.ctx.db.run("UPDATE resources SET capacity = ? WHERE kind = 'desk_pool'", [n]);

test('puestos: el inventario es compartido y no se puede superar', async () => {
  setDesks(3);
  const date = nextWeekday(8);
  for (let i = 0; i < 3; i++) {
    const r = await (await app.client().init()).post('/api/bookings', { service: 'pass', date, people: 1, ...person(10 + i) });
    assert.equal(r.status, 201, r.text);
  }
  const extra = await (await app.client().init()).post('/api/bookings', { service: 'pass', date, people: 1, ...person(20) });
  assert.equal(extra.status, 409);
  assert.equal(extra.json.error, 'NO_AVAILABILITY');
  const day = await app.client().get(`/api/availability/desk?date=${date}`);
  assert.equal(day.json.free, 0);
  setDesks(35);
});

test('puestos: pedir más puestos de los libres devuelve cuántos quedan', async () => {
  setDesks(2);
  const date = nextWeekday(9);
  const r = await (await app.client().init()).post('/api/bookings', { service: 'pass', date, people: 3, ...person(21) });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'NOT_ENOUGH_DESKS');
  assert.equal(r.json.details.free, 2);
  setDesks(35);
});

test('las mesas fijas activas descuentan puestos todos los días', async () => {
  setDesks(4);
  const date = nextWeekday(10);
  const before = (await app.client().get(`/api/availability/desk?date=${date}`)).json.free;
  const c = app.ctx.bookings.upsertCustomer({ email: 'fija@example.com', name: 'Fija' });
  const { plan } = app.ctx.commerce.requestPlan({ customer: { email: c.email }, productSlug: 'mesa-fija', startDate: T.addDays(T.todayLocal(app.ctx.now()), 1) });
  app.ctx.commerce.activatePlan(plan.id);
  const afterFree = (await app.client().get(`/api/availability/desk?date=${date}`)).json.free;
  assert.equal(afterFree, before - 1);
  setDesks(35);
});

test('fin de semana y festivos cerrados; fechas pasadas y demasiado lejanas rechazadas', async () => {
  const c = await app.client().init();
  let sat = T.addDays(T.todayLocal(app.ctx.now()), 2);
  while (T.weekdayOf(sat) !== 6) sat = T.addDays(sat, 1);
  const r1 = await c.post('/api/bookings', { service: 'pass', date: sat, people: 1, ...person(30) });
  assert.equal(r1.status, 409);
  assert.equal(r1.json.error, 'CLOSED');
  const r2 = await c.post('/api/bookings', { service: 'pass', date: '2026-12-25', people: 1, ...person(30) });
  assert.ok(['CLOSED_HOLIDAY', 'DATE_IN_PAST', 'DATE_TOO_FAR'].includes(r2.json.error), r2.text);
  const r3 = await c.post('/api/bookings', { service: 'pass', date: T.addDays(T.todayLocal(app.ctx.now()), -1), people: 1, ...person(30) });
  assert.equal(r3.json.error, 'DATE_IN_PAST');
  const r4 = await c.post('/api/bookings', { service: 'pass', date: T.addDays(T.todayLocal(app.ctx.now()), 400), people: 1, ...person(30) });
  assert.equal(r4.json.error, 'DATE_TOO_FAR');
});

test('un bloqueo impide reservar la franja afectada', async () => {
  const date = nextWeekday(11);
  const room = app.ctx.catalog.resource('sala-salinas');
  app.ctx.db.run("INSERT INTO blocks (resource_id, start_utc, end_utc, reason, created_at) VALUES (?,?,?,'maintenance',?)",
    [room.id, T.localToUtc(date, '12:00'), T.localToUtc(date, '14:00'), app.ctx.now()]);
  const slots = (await app.client().get(`/api/availability/slots?resource=sala-salinas&date=${date}&duration=60`)).json.slots;
  assert.equal(slots.find((s) => s.time === '12:00').available, false);
  assert.equal(slots.find((s) => s.time === '13:30').available, false);
  assert.equal(slots.find((s) => s.time === '14:00').available, true);
  assert.equal(slots.find((s) => s.time === '11:00').available, true);
  const r = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-salinas', date, time: '11:30', duration: 60, people: 2, ...person(31) });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'SLOT_TAKEN');
});

test('el margen de limpieza del estudio separa dos sesiones', async () => {
  const date = nextWeekday(12);
  const c = await app.client().init();
  const a = await c.post('/api/bookings', { service: 'studio', resource: 'estudio', date, time: '10:00', duration: 60, people: 2, ...person(32) });
  assert.equal(a.status, 201, a.text);
  const slots = (await app.client().get(`/api/availability/slots?resource=estudio&date=${date}&duration=60`)).json.slots;
  assert.equal(slots.find((s) => s.time === '11:00').available, false, 'el margen de 30 min bloquea las 11:00');
  assert.equal(slots.find((s) => s.time === '12:00').available, true);
});

test('cabinas: se asigna cualquier cabina libre del grupo', async () => {
  const date = nextWeekday(13);
  const refs = [];
  for (let i = 0; i < 3; i++) {
    const r = await (await app.client().init()).post('/api/bookings', { service: 'booth', date, time: '09:00', duration: 60, people: 1, ...person(40 + i) });
    assert.equal(r.status, 201, r.text);
    refs.push(r.json.ref);
  }
  const units = new Set(refs.map((ref) => app.ctx.db.get('SELECT resource_id FROM bookings WHERE ref = ?', [ref]).resource_id));
  assert.equal(units.size, 3, 'tres cabinas distintas');
  const fourth = await (await app.client().init()).post('/api/bookings', { service: 'booth', date, time: '09:00', duration: 60, people: 1, ...person(44) });
  assert.equal(fourth.status, 409);
});

test('zona horaria de Madrid: días de 23 y 25 horas y horas inexistentes', () => {
  const [s1, e1] = T.dayBoundsUtc('2027-03-28');
  assert.equal((e1 - s1) / 3600_000, 23, 'cambio a horario de verano');
  const [s2, e2] = T.dayBoundsUtc('2026-10-25');
  assert.equal((e2 - s2) / 3600_000, 25, 'cambio a horario de invierno');
  assert.equal(new Date(T.localToUtc('2026-07-01', '10:00')).toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(new Date(T.localToUtc('2026-12-01', '10:00')).toISOString(), '2026-12-01T09:00:00.000Z');
  const gap = T.localToUtc('2027-03-28', '02:30');
  assert.ok(gap === null || T.fmtTime(gap) !== '02:30', 'las 02:30 no existen el día del cambio');
  assert.equal(T.fmtTime(T.localToUtc('2026-10-25', '10:00')), '10:00');
});

test('franjas en el día del cambio de hora respetan la hora local', () => {
  const date = '2026-10-25';
  const units = [app.ctx.catalog.resource('sala-rambla')];
  const hours = { ...units[0].hours, sun: [['08:00', '12:00']] };
  const slots = app.ctx.bookings.timedSlots({ units: [{ ...units[0], hours }], date, duration: 60, admin: true });
  // El día ya pasó respecto al reloj real, pero la generación de franjas en hora local debe ser correcta.
  assert.deepEqual(slots.map((s) => s.time), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00']);
  assert.equal((slots[0].end - slots[0].start) / 60_000, 60);
});
