// Panel de administración: reservas internas, confirmación, bonos, ajustes, fotos, usuarios y RGPD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, nextWeekday, loginAdmin, noRateLimit } from './helpers.js';

let app; let adm;
before(async () => { app = await startApp(); noRateLimit(app); adm = await loginAdmin(app, app.client()); });
after(async () => { await app.close(); });

const post = (url, form) => adm.req('POST', url, { form: { _csrf: adm.adminCsrf, ...form } });
const loc = (r) => r.headers.get('location') || '';

test('todas las páginas del panel cargan', async () => {
  for (const p of ['/admin', '/admin/calendario', '/admin/reservas', '/admin/reservas/nueva', '/admin/solicitudes', '/admin/bloqueos', '/admin/clientes', '/admin/bonos', '/admin/planes',
    '/admin/recursos', '/admin/tarifas', '/admin/ajustes', '/admin/contenidos', '/admin/espacios', '/admin/preguntas', '/admin/eventos', '/admin/fotos', '/admin/informes', '/admin/pagos',
    '/admin/correos', '/admin/registro', '/admin/usuarios', '/admin/cuenta']) {
    assert.equal((await adm.get(p)).status, 200, p);
  }
});

test('reserva interna, solape rechazado, confirmación y cancelación', async () => {
  const date = nextWeekday(4);
  const a = await post('/admin/reservas/nueva', { tipo: 'timed', recurso: 'sala-salinas', fecha: date, hora: '10:00', duracion: '120', personas: '4', email: 'luis@example.com', idioma: 'es', estado: 'requested', cobro: 'unpaid' });
  assert.match(loc(a), /\/admin\/reservas\/FR-.*ok=created/);
  const ref = loc(a).match(/FR-[A-Z0-9-]+/)[0];
  const clash = await post('/admin/reservas/nueva', { tipo: 'timed', recurso: 'sala-salinas', fecha: date, hora: '11:00', duracion: '60', personas: '2', email: 'x@example.com', estado: 'confirmed', cobro: 'none' });
  assert.match(loc(clash), /err=SLOT_TAKEN/);
  assert.match(loc(await post(`/admin/reservas/${ref}/confirmar`, { cobro: 'unpaid' })), /ok=confirmed/);
  assert.equal(app.ctx.db.get('SELECT status FROM bookings WHERE ref = ?', [ref]).status, 'confirmed');
  assert.ok(app.ctx.db.get("SELECT 1 FROM outbox WHERE related_ref = ? AND subject LIKE '%onfirmad%'", [ref]), 'correo de confirmación generado');
  assert.match(loc(await post(`/admin/reservas/${ref}/cancelar`, { devolucion: 'auto', motivo: 'prueba' })), /ok=cancelled/);
});

test('bono emitido en recepción y ajuste que no puede dejar saldo negativo', async () => {
  const r = await post('/admin/bonos/emitir', { email: 'bono@example.com', nombre: 'Bea' });
  const id = loc(r).match(/bonos\/(\d+)/)[1];
  assert.match(loc(await post(`/admin/bonos/${id}/ajustar`, { delta: '-11', nota: 'no' })), /err=VOUCHER_NEGATIVE/);
  assert.match(loc(await post(`/admin/bonos/${id}/ajustar`, { delta: '2', nota: 'compensación' })), /ok=adjusted/);
  assert.equal(app.ctx.db.get('SELECT SUM(delta) AS s FROM voucher_ledger WHERE voucher_id = ?', [id]).s, 12);
});

test('ajustes validados en el servidor', async () => {
  assert.match(loc(await post('/admin/ajustes/hours', { rec_mon: '9-14' })), /err=INVALID_HOURS/);
  assert.match(loc(await post('/admin/tarifas/comercio', { tax_configured: '1', tax_rate: '' })), /err=TAX_RATE_REQUIRED/);
  assert.match(loc(await post('/admin/tarifas/comercio', { tax_configured: '1', tax_rate: '21', prices_confirmed: '1' })), /ok=saved/);
  assert.equal(app.ctx.settings.get('commerce').tax_rate_bp, 2100);
  assert.match(loc(await post('/admin/tarifas/pase-dia', { price: '16,50', name_es: 'Pase de día', name_en: 'Day pass', active: '1', max_quantity: '4' })), /ok=saved/);
  assert.equal(app.ctx.catalog.product('pase-dia').price_cents, 1650);
  assert.match(loc(await post('/admin/ajustes/business', { brand: 'FRAME' })), /err=VALIDATION/);
});

test('subida de fotos: solo imágenes reales', async () => {
  const send = async (buf, type) => {
    const fd = new FormData();
    fd.set('_csrf', adm.adminCsrf); fd.set('slot', 'space.estudio'); fd.set('alt_es', 'Estudio'); fd.set('alt_en', 'Studio');
    fd.set('file', new Blob([buf], { type }), 'f');
    const r = await fetch(`${app.base}/admin/fotos`, { method: 'POST', body: fd, headers: { cookie: adm.cookieHeader() }, redirect: 'manual' });
    return r.headers.get('location');
  };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000208060000007dd4b3e80000000d4944415478da63f8ffff3f030005fe02fea7d6a4ab0000000049454e44ae426082', 'hex');
  assert.match(await send(png, 'image/png'), /ok=uploaded/);
  assert.match(await send(Buffer.from('<script>alert(1)</script>'), 'image/png'), /err=INVALID_IMAGE/);
  const m = app.ctx.db.get("SELECT * FROM media WHERE builtin = 0 ORDER BY id DESC LIMIT 1");
  assert.equal(m.width, 2);
  assert.match(m.path, /^\/media\/[a-z0-9]+-[A-Za-z0-9]+\.png$/);
});

test('usuarios: contraseña temporal fuera de la URL y cambio obligatorio', async () => {
  const r = await post('/admin/usuarios', { nombre: 'Marta', email: 'marta@frame.test', rol: 'staff' });
  assert.equal(r.status, 200);
  const pwd = r.text.match(/Contraseña temporal: <code class="mono">([^<]+)</)[1];
  const c = app.client();
  const page = await c.get('/admin/entrar');
  const login = await c.req('POST', '/admin/entrar', { form: { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1], email: 'marta@frame.test', password: pwd } });
  assert.equal(loc(login), '/admin/cuenta?forzar=1');
  assert.equal(loc(await c.get('/admin/reservas')), '/admin/cuenta?forzar=1');
});

test('RGPD: exportar y anonimizar un cliente sin reservas futuras', async () => {
  const c = app.ctx.bookings.upsertCustomer({ email: 'olvido@example.com', name: 'Olvido', phone: '600000000' });
  const exp = await adm.get(`/admin/clientes/${c.id}/datos.json`);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.customer.email, 'olvido@example.com');
  assert.match(loc(await post(`/admin/clientes/${c.id}/anonimizar`, {})), /ok=anonymized/);
  const after = app.ctx.db.get('SELECT * FROM customers WHERE id = ?', [c.id]);
  assert.match(after.email, /anonimizado\.invalid$/);
  assert.equal(after.phone, null);
});
