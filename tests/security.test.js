// Seguridad y robustez: acceso a datos ajenos (IDOR), protección del panel, CSRF, cabeceras,
// formularios, versión en inglés y persistencia de datos tras reiniciar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, nextWeekday, person, loginCustomer, loginAdmin, noRateLimit } from './helpers.js';
import { createContext } from '../src/app.js';

let app;
let A; let B;
before(async () => {
  app = await startApp();
  noRateLimit(app);
  const ca = await app.client().init();
  const cb = await app.client().init();
  const ra = await ca.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date: nextWeekday(5), time: '10:00', duration: 60, people: 2, ...person(401) });
  const rb = await cb.post('/api/bookings', { service: 'room', resource: 'sala-rambla', date: nextWeekday(5), time: '13:00', duration: 60, people: 2, ...person(402) });
  A = { client: ca, ...ra.json, t: new URL(ra.json.manageUrl, app.base).searchParams.get('t') };
  B = { client: cb, ...rb.json, t: new URL(rb.json.manageUrl, app.base).searchParams.get('t') };
});
after(async () => { await app.close(); });

test('IDOR: el enlace de una reserva no abre otra', async () => {
  const c = app.client();
  assert.equal((await c.get(`/reserva/${A.ref}?t=${A.t}`)).status, 200);
  assert.equal((await c.get(`/reserva/${B.ref}?t=${A.t}`)).status, 404);
  assert.equal((await c.get(`/reserva/${A.ref}?t=${A.t.slice(0, -2)}xx`)).status, 404);
  assert.equal((await c.get(`/reserva/${A.ref}`)).status, 404);
  assert.equal((await c.get(`/api/bookings/${A.ref}/status`)).status, 404);
  assert.equal((await c.get(`/api/bookings/${A.ref}/status?t=${B.t}`)).status, 404);
  const cancel = await (await app.client().init()).req('POST', `/reserva/${B.ref}/cancelar?t=${A.t}`, { form: {} });
  assert.equal(cancel.status, 404);
  assert.notEqual(app.ctx.db.get('SELECT status FROM bookings WHERE ref = ?', [B.ref]).status, 'cancelled');
});

test('IDOR: un cliente con sesión no ve reservas, justificantes ni planes de otro', async () => {
  const c = await loginCustomer(app, await app.client().init(), person(401).email);
  assert.equal((await c.get(`/reserva/${A.ref}`)).status, 200, 'su propia reserva');
  assert.equal((await c.get(`/reserva/${B.ref}`)).status, 404, 'la reserva de otra persona');
  assert.equal((await c.get(`/justificante/${B.ref}`)).status, 403);
  const dash = await c.get('/cuenta');
  assert.match(dash.text, new RegExp(A.ref));
  assert.doesNotMatch(dash.text, new RegExp(B.ref));
  const sessionCsrf = dash.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const plan = await c.req('POST', '/cuenta/planes/PL-AAAA-BBBB/baja', { form: {}, headers: { 'x-csrf-token': sessionCsrf } });
  assert.equal(plan.status, 404);
});

test('cambiar el correo invalida los enlaces de gestión anteriores', async () => {
  const c = app.ctx.db.get('SELECT * FROM customers WHERE email = ?', [person(402).email]);
  app.ctx.db.run('UPDATE customers SET link_version = link_version + 1 WHERE id = ?', [c.id]);
  assert.equal((await app.client().get(`/reserva/${B.ref}?t=${B.t}`)).status, 404);
});

test('el enlace de acceso a Mi cuenta es de un solo uso y la respuesta no revela si el correo existe', async () => {
  const c = await app.client().init();
  const known = await c.post('/api/account/login', { email: person(401).email, lang: 'es' });
  const unknown = await c.post('/api/account/login', { email: 'nadie@example.com', lang: 'es' });
  assert.equal(known.json.message, unknown.json.message);
  const mail = app.ctx.db.get("SELECT body_text FROM outbox WHERE kind = 'login.link' ORDER BY id DESC LIMIT 1");
  const token = mail.body_text.match(/token=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await c.get(`/cuenta/entrar?token=${token}`)).status, 303);
  assert.equal((await app.client().get(`/cuenta/entrar?token=${token}`)).status, 400, 'segundo uso rechazado');
});

test('panel: sin sesión no hay acceso y las acciones exigen sesión y CSRF', async () => {
  const anon = app.client();
  const r = await anon.get('/admin/reservas');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/admin/entrar');
  assert.equal((await anon.req('POST', '/admin/bloqueos', { form: { desde: '2030-01-01', hasta: '2030-01-02', motivo: 'other' } })).status, 401);
  assert.equal((await anon.get('/admin/clientes/1/datos.json')).status, 303);
  const adm = await loginAdmin(app, app.client());
  const noCsrf = await adm.req('POST', '/admin/bloqueos', { form: { desde: '2030-01-01', hasta: '2030-01-02', motivo: 'other' } });
  assert.equal(noCsrf.status, 403);
  const ok = await adm.req('POST', '/admin/bloqueos', { form: { _csrf: adm.adminCsrf, recurso: '', desde: nextWeekday(20), hasta: nextWeekday(20), motivo: 'other' } });
  assert.equal(ok.status, 303);
  const page = await adm.get('/admin');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
});

test('panel: recepción no puede tocar tarifas, impuestos, usuarios ni pagos', async () => {
  const staff = await loginAdmin(app, app.client(), 'staff');
  for (const p of ['/admin/tarifas', '/admin/ajustes', '/admin/usuarios', '/admin/pagos', '/admin/registro', '/admin/recursos']) {
    assert.equal((await staff.get(p)).status, 403, p);
  }
  const r = await staff.req('POST', '/admin/tarifas/comercio', { form: { _csrf: staff.adminCsrf, sales_enabled: '1' } });
  assert.equal(r.status, 403);
  assert.equal(app.ctx.settings.get('commerce').sales_enabled, false);
  assert.equal((await staff.get('/admin/calendario')).status, 200);
  assert.equal((await staff.get(`/admin/reservas/${A.ref}`)).status, 200);
});

test('panel: bloqueo temporal tras varios intentos fallidos', async () => {
  const c = app.client();
  for (let i = 0; i < 5; i++) {
    const page = await c.get('/admin/entrar');
    await c.req('POST', '/admin/entrar', { form: { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1], email: 'recepcion@frame.test', password: 'no-es' } });
  }
  const page = await c.get('/admin/entrar');
  const r = await c.req('POST', '/admin/entrar', { form: { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1], email: 'recepcion@frame.test', password: 'frame-staff-demo' } });
  assert.equal(r.status, 401);
  assert.match(r.text, /bloqueada temporalmente/);
  app.ctx.db.run("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'recepcion@frame.test'");
});

test('API: CSRF obligatorio y errores de validación por campo', async () => {
  const c = app.client();
  const noToken = await c.post('/api/bookings', { service: 'pass', date: nextWeekday(5), people: 1, ...person(403) });
  assert.equal(noToken.status, 403);
  const v = await (await app.client().init()).post('/api/bookings', { service: 'pass', date: 'mañana', people: 1, ...person(403), email: 'no-es-correo' });
  assert.equal(v.status, 400);
  assert.equal(v.json.error, 'VALIDATION');
  assert.ok(v.json.details.fields.email && v.json.details.fields.date);
  const terms = await (await app.client().init()).post('/api/bookings', { service: 'pass', date: nextWeekday(5), people: 1, ...person(403), accept: false });
  assert.equal(terms.json.error, 'TERMS_REQUIRED');
});

test('formularios de contacto: validación, consentimiento y campo trampa', async () => {
  const c = await app.client().init();
  const base = { type: 'contact', name: 'Laura', email: 'laura@example.com', message: 'Hola', lang: 'es' };
  const noPrivacy = await c.post('/api/requests', base);
  assert.equal(noPrivacy.json.error, 'TERMS_REQUIRED');
  const before = app.ctx.db.get('SELECT COUNT(*) AS n FROM requests').n;
  const bot = await c.post('/api/requests', { ...base, privacy: true, website: 'http://spam.example' });
  assert.equal(bot.status, 201);
  assert.equal(app.ctx.db.get('SELECT COUNT(*) AS n FROM requests').n, before, 'el spam no se guarda');
  const ok = await c.post('/api/requests', { ...base, privacy: true, marketing: false });
  assert.equal(ok.status, 201, ok.text);
  const row = app.ctx.db.get('SELECT * FROM requests WHERE ref = ?', [ok.json.ref]);
  assert.equal(row.marketing_opt_in, 0, 'las comunicaciones comerciales son opcionales y separadas');
});

test('cabeceras de seguridad y cookies', async () => {
  const r = await app.client().get('/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const cookies = r.headers.getSetCookie().join('\n');
  assert.match(cookies, /HttpOnly/i);
  assert.doesNotMatch(cookies, /_ga|_gid|plausible/, 'sin cookies de analítica antes del consentimiento');
});

test('inglés: páginas, alternativas hreflang y mensajes de la API', async () => {
  const c = app.client();
  for (const p of ['/en', '/en/spaces', '/en/pricing', '/en/book', '/en/community', '/en/contact', '/en/legal/privacy']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /<html lang="en"/, p);
  }
  const home = await c.get('/');
  assert.match(home.text, /hreflang="en"/);
  const err = await (await app.client().init()).post('/api/bookings', { service: 'room', resource: 'sala-rambla', date: nextWeekday(5), time: '10:00', duration: 60, people: 2, ...person(404), lang: 'en' });
  assert.equal(err.status, 409);
  assert.match(err.json.message, /taken|another time/i);
});

test('SEO: sitemap, robots y datos estructurados sin reseñas', async () => {
  const c = app.client();
  const sm = await c.get('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.text, /hreflang/);
  assert.doesNotMatch(sm.text, /\/admin|\/cuenta|\/reserva\//);
  const robots = await c.get('/robots.txt');
  assert.match(robots.text, /Disallow: \/admin/);
  const home = await c.get('/');
  const ld = [...home.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.match(ld, /Rambla Juan Mateo García, 21/);
  assert.doesNotMatch(ld, /aggregateRating|"review"/i);
});

test('persistencia: los datos siguen ahí al reiniciar el servidor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-persist-'));
  const file = path.join(dir, 'p.db');
  let ctx = createContext({ dbFile: file, baseUrl: 'http://127.0.0.1' });
  const date = nextWeekday(9);
  const { booking } = ctx.bookings.createTimed({ usage: 'hourly', resource: 'sala-salinas', date, time: '10:00', duration: 60, people: 2, customer: { email: 'persist@example.com' } });
  ctx.settings.set('policies', { cancel_free_hours: 72 });
  ctx.db.close();
  ctx = createContext({ dbFile: file, baseUrl: 'http://127.0.0.1' });
  assert.equal(ctx.db.get('SELECT ref FROM bookings WHERE ref = ?', [booking.ref]).ref, booking.ref);
  assert.equal(ctx.settings.get('policies').cancel_free_hours, 72);
  assert.throws(() => ctx.bookings.createTimed({ usage: 'hourly', resource: 'sala-salinas', date, time: '10:00', duration: 60, people: 2, customer: { email: 'otro2@example.com' } }), /SLOT_TAKEN/);
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
