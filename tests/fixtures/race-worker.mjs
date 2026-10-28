// Proceso independiente que abre la MISMA base de datos e intenta reservar la misma franja.
// Simula varias instancias del servidor compitiendo (p. ej. dos réplicas o dos procesos).
import { createContext } from '../../src/app.js';

const [dbFile, date, time, n] = process.argv.slice(2);
const ctx = createContext({ dbFile, baseUrl: 'http://127.0.0.1' });
// Todos los procesos esperan a la misma marca de tiempo para disparar a la vez.
const go = Number(process.env.RACE_AT);
while (Date.now() < go) { /* espera activa breve */ }
try {
  const r = ctx.bookings.createTimed({ usage: 'hourly', resource: 'sala-rambla', date, time, duration: 60, people: 2, customer: { email: `proc${n}@example.com`, name: `Proceso ${n}` } });
  process.stdout.write(JSON.stringify({ ok: true, ref: r.booking.ref }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code || e.message }));
} finally {
  ctx.db.close();
}
