// Genera los renders conceptuales (public/img/renders/*.webp) desde la maqueta 3D.
// Uso: npm run render:images [-- hero salas ...]
// Requiere Chromium con Playwright (instalado en el entorno de desarrollo).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { LAYOUT } from '../src/config/layout.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'img', 'renders');
fs.mkdirSync(OUT, { recursive: true });
const ALL = ['hero', 'coworking', 'salas', 'salas-rambla', 'despachos', 'estudio', 'estudio-set', 'comunidad', 'cocina', 'plano'];
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

const app = express();
app.get('/render/layout.json', (req, res) => res.json({ ...LAYOUT, desks: 35, booths: 3, offices: 3 }));
app.use('/render', express.static(path.join(ROOT, 'scripts', 'render')));
app.use('/js', express.static(path.join(ROOT, 'public', 'js')));
app.use('/brand', express.static(path.join(ROOT, 'public', 'brand')));
app.use('/fonts', express.static(path.join(ROOT, 'public', 'fonts')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));
const server = app.listen(0);
const port = server.address().port;

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const shot of shots) {
  const t0 = Date.now();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`[${shot}]`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${shot}]`, m.text()); });
  await page.goto(`http://127.0.0.1:${port}/render/page.html?shot=${shot}&scale=${Number(process.env.RENDER_SCALE) || 1}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 600_000 });
  const data = await page.evaluate(() => window.__image);
  const buf = Buffer.from(data.split(',')[1], 'base64');
  // RENDER_OUT permite hacer pruebas rápidas sin sobrescribir las imágenes publicadas.
  const dir = process.env.RENDER_OUT || OUT;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${shot}.webp`), buf);
  console.log(`${shot}.webp  ${(buf.length / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.close();
}
await browser.close();
server.close();
