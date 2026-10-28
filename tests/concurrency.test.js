// Concurrencia: peticiones simultáneas por HTTP y varios procesos sobre la misma base de datos.
// Nunca puede haber dos reservas activas en la misma franja ni más puestos que el inventario.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, nextWeekday, person, noRateLimit } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let app;
before(async () => { app = await startApp(); noRateLimit(app); });
after(async () => { await app.close(); });

test('20 peticiones simultáneas a la misma sala: solo una reserva', async () => {
  const date = nextWeekday(14);
  const clients = await Promise.all(Array.from({ length: 20 }, () => app.client().init()));
  const results = await Promise.all(clients.map((c, i) => c.post('/api/bookings', { service: 'room', resource: 'sala-salinas', date, time: '10:00', duration: 60, people: 2, ...person(100 + i) })));
  const ok = results.filter((r) => r.status === 201);
  assert.equal(ok.length, 1, results.map((r) => r.status).join(','));
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
  const n = app.ctx.db.get("SELECT COUNT(*) AS n FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE r.slug = 'sala-salinas' AND b.local_date = ? AND b.status IN ('pending_payment','requested','confirmed')", [date]).n;
  assert.equal(n, 1);
});

test('franjas solapadas simultáneas (10:00-12:00 y 11:00-12:00): solo una', async () => {
  const date = nextWeekday(15);
  const [a, b] = await Promise.all([app.client().init(), app.client().init()]);
  const rs = await Promise.all([
    a.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '10:00', duration: 120, people: 2, ...person(150) }),
    b.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date, time: '11:00', duration: 60, people: 2, ...person(151) }),
  ]);
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.text).join(' | '));
});

test('puestos: 12 peticiones simultáneas con 5 puestos libres → exactamente 5', async () => {
  app.ctx.db.run("UPDATE resources SET capacity = 5 WHERE kind = 'desk_pool'");
  const date = nextWeekday(16);
  const clients = await Promise.all(Array.from({ length: 12 }, () => app.client().init()));
  const results = await Promise.all(clients.map((c, i) => c.post('/api/bookings', { service: 'pass', date, people: 1, ...person(200 + i) })));
  assert.equal(results.filter((r) => r.status === 201).length, 5, results.map((r) => r.status).join(','));
  assert.equal(app.ctx.bookings.deskInfo(date).free, 0);
  assert.ok(app.ctx.bookings.deskInfo(date).raw >= 0, 'nunca por debajo de cero');
  app.ctx.db.run("UPDATE resources SET capacity = 35 WHERE kind = 'desk_pool'");
});

test('varios procesos sobre el mismo archivo de base de datos: solo una reserva', async () => {
  const date = nextWeekday(17);
  const at = Date.now() + 1500;
  const runs = Array.from({ length: 6 }, (_, i) => new Promise((resolve) => {
    execFile(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'fixtures', 'race-worker.mjs'), app.ctx.cfg.dbFile, date, '16:00', String(i)],
      { env: { ...process.env, RACE_AT: String(at) }, timeout: 30_000 }, (err, stdout) => resolve(stdout ? JSON.parse(stdout) : { ok: false, code: String(err) }));
  }));
  const out = await Promise.all(runs);
  assert.equal(out.filter((r) => r.ok).length, 1, JSON.stringify(out));
  assert.ok(out.filter((r) => !r.ok).every((r) => r.code === 'SLOT_TAKEN'), JSON.stringify(out));
});
