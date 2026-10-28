// Recorrido de punta a punta en un navegador real (Chromium + Playwright):
// reserva de sala → confirmación en el panel → activación de la venta con IVA → pase de día pagado en la
// pasarela de prueba → justificante → acceso a Mi cuenta con enlace → páginas en móvil y en inglés.
//
// Uso (con el servidor arrancado en modo prueba y una base de datos recién creada):
//   npm run reset && npm start        (en otra terminal)
//   npm run test:e2e                  (capturas en ./e2e-capturas)
// Ojo: el recorrido ACTIVA la venta online con IVA 21 % en esa base de datos de pruebas.
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Falta Playwright. Instálalo con:  npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}
const OUT = process.argv[2] || path.join(process.cwd(), 'e2e-capturas');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
let failed = 0;
const log = (ok, msg) => { if (!ok) failed++; console.log(ok ? 'OK  ' : 'FAIL', msg); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${p.url()} :: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${p.url()} :: ${m.text()}`); });
    return p;
  };

  // 1) Reserva de una sala sin venta online (queda como solicitud, sin cobro)
  const p = await newPage();
  await p.goto(`${BASE}/reservar`);
  await p.click('[data-cookie-banner] button:has-text("Rechazar")').catch(() => {});
  await p.waitForSelector('[data-service="room"]');
  await p.click('[data-service="room"]');
  await p.waitForSelector('[data-panel="when"] [data-date]:not([disabled])');
  await p.locator('[data-panel="when"] [data-date]:not([disabled])').nth(2).click();
  await p.waitForSelector('[data-time]:not([disabled])');
  await p.locator('[data-time]:not([disabled])').first().click();
  await p.screenshot({ path: `${OUT}/e2e-1-when.png` });
  await p.click('[data-panel="when"] [data-next]');
  await p.fill('#d-name', 'Clara Prueba');
  await p.fill('#d-email', 'clara@example.com');
  await p.click('[data-details] button[type=submit]');
  await p.waitForSelector('[data-confirm] input[name=accept]');
  await p.screenshot({ path: `${OUT}/e2e-2-review.png`, fullPage: false });
  await p.check('[data-confirm] input[name=accept]');
  await Promise.all([p.waitForNavigation(), p.click('[data-confirm] button[type=submit]')]);
  const manageUrl = p.url();
  const t1 = await p.textContent('main');
  log(/\/reserva\/FR-/.test(manageUrl) && /Solicitud/i.test(t1), `reserva de sala registrada como solicitud → ${manageUrl.replace(BASE, '').slice(0, 40)}…`);
  await p.screenshot({ path: `${OUT}/e2e-3-manage.png`, fullPage: true });

  // 2) Panel: activar venta con pasarela de prueba e IVA 21 %
  const a = await newPage();
  await a.goto(`${BASE}/admin/entrar`);
  await a.fill('input[name=email]', 'admin@frame.test');
  await a.fill('input[name=password]', 'frame-admin-demo');
  await Promise.all([a.waitForNavigation(), a.click('button[type=submit]')]);
  await a.goto(`${BASE}/admin/tarifas`);
  for (const n of ['prices_confirmed', 'conditions_confirmed', 'tax_configured', 'sales_enabled']) await a.check(`input[name=${n}]`);
  await a.fill('input[name=tax_rate]', '21');
  await Promise.all([a.waitForNavigation(), a.click('form[action="/admin/tarifas/comercio"] button[type=submit]')]);
  log(/Activa/.test(await a.textContent('main')), 'venta online activada en el panel (IVA 21 % configurado por la administración)');
  // Confirmar la solicitud de sala desde Solicitudes
  await a.goto(`${BASE}/admin/solicitudes`);
  const ref = manageUrl.match(/FR-[A-Z0-9-]+/)[0];
  await Promise.all([a.waitForNavigation(), a.click(`form[action="/admin/reservas/${ref}/confirmar"] button`)]);
  log(/confirmada/i.test(await a.textContent('main')), `solicitud ${ref} confirmada por recepción`);

  // 3) Pase de día con pago en la pasarela de prueba
  const q = await newPage();
  await q.goto(`${BASE}/reservar?servicio=pass`);
  await q.click('[data-cookie-banner] button:has-text("Aceptar")').catch(() => {});
  await q.waitForSelector('[data-panel="when"] .cal__nav');
  await q.locator('[data-panel="when"] .cal__nav').nth(1).click();
  await q.waitForSelector('[data-panel="when"] [data-date]:not([disabled])');
  await q.locator('[data-panel="when"] [data-date]:not([disabled])').nth(3).click();
  await q.waitForSelector('[data-day-info] .is-ok');
  await q.click('[data-panel="when"] [data-next]');
  await q.fill('#d-name', 'Pablo Pago');
  await q.fill('#d-email', 'pablo@example.com');
  await q.click('[data-details] button[type=submit]');
  await q.waitForSelector('[data-confirm] [data-pay]');
  const reviewText = await q.textContent('[data-panel="review"]');
  log(/18,15/.test(reviewText), 'precio final con IVA mostrado antes de pagar (15 € + 21 % = 18,15 €)');
  await q.screenshot({ path: `${OUT}/e2e-4-review-pay.png` });
  await q.check('[data-confirm] input[name=accept]');
  await Promise.all([q.waitForNavigation(), q.click('[data-confirm] button[type=submit]')]);
  log(/\/pago-prueba\/cs_local_/.test(q.url()), 'redirige a la pasarela de prueba');
  await q.screenshot({ path: `${OUT}/e2e-5-gateway.png`, fullPage: true });
  await Promise.all([q.waitForNavigation(), q.click('form[action$="/pagar"] button')]);
  await q.waitForTimeout(800);
  const t2 = await q.textContent('main');
  log(/Confirmada|Confirmed/.test(t2) && /Pagad|Paid/.test(t2), 'pago correcto → reserva confirmada y pagada');
  await q.screenshot({ path: `${OUT}/e2e-6-paid.png`, fullPage: true });
  const recLink = q.locator('a[href*="/justificante/"]').first();
  if (await recLink.count()) { await recLink.click(); await q.waitForLoadState(); log(/no es una factura|not an invoice/i.test(await q.textContent('main')), 'justificante disponible (no es factura)'); await q.screenshot({ path: `${OUT}/e2e-7-receipt.png`, fullPage: true }); }
  else log(false, 'enlace al justificante');

  // 4) Mi cuenta con enlace mágico (bandeja de pruebas)
  await q.goto(`${BASE}/cuenta`);
  await q.fill('form[data-login] input[name=email], input[name=email]', 'pablo@example.com');
  await q.click('form button[type=submit]');
  await q.waitForTimeout(800);
  await q.goto(`${BASE}/correo-prueba`);
  await q.waitForTimeout(500);
  let loginLink = null;
  for (const f of q.frames()) { const a = await f.$('a[href*="/cuenta/entrar?token="]'); if (a) { loginLink = await a.getAttribute('href'); break; } }
  await q.screenshot({ path: `${OUT}/e2e-mailbox.png` });
  log(Boolean(loginLink), 'correo con enlace de acceso visible en la bandeja de pruebas');
  if (loginLink) {
    await q.goto(loginLink.startsWith('http') ? loginLink : BASE + loginLink);
    await q.waitForLoadState();
    const t3 = await q.textContent('main');
    log(/Próximas reservas/.test(t3), 'Mi cuenta abierta con el enlace');
    await q.screenshot({ path: `${OUT}/e2e-8-account.png`, fullPage: true });
  }

  // 5) Móvil e inglés
  const m = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const [path, name] of [['/en', 'en-home'], ['/en/book', 'en-book'], ['/reservar', 'm-book'], ['/espacios/estudio-podcast-video', 'm-studio'], ['/tarifas', 'm-pricing']]) {
    const r = await m.goto(BASE + path);
    log(r.status() === 200, `${path} (${r.status()})`);
    await m.waitForTimeout(400);
    await m.screenshot({ path: `${OUT}/e2e-${name}.png` });
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log(overflow <= 1, `${path} sin desbordamiento horizontal en móvil (${overflow}px)`);
  }
  console.log('Errores de consola:', errors.length ? errors.slice(0, 10) : 'ninguno');
  await browser.close();
  console.log(`Capturas en ${OUT}`);
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
