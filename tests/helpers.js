// Utilidades de prueba: arranca la aplicación con una base de datos temporal
// y ofrece un cliente HTTP con cookies (cada cliente simula un navegador distinto).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, createApp } from '../src/app.js';
import * as T from '../src/lib/time.js';

export async function startApp(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-test-'));
  const ctx = createContext({ dbFile: path.join(dir, 'test.db'), uploadsDir: path.join(dir, 'uploads'), baseUrl: 'http://127.0.0.1:0', ...overrides });
  const app = createApp(ctx);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  ctx.cfg.baseUrl = `http://127.0.0.1:${port}`;
  const base = ctx.cfg.baseUrl;
  return {
    ctx, base, port,
    client: () => new Client(base),
    async close() { await new Promise((r) => server.close(r)); ctx.db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export class Client {
  constructor(base) { this.base = base; this.jar = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = decodeURIComponent(pair.slice(i + 1));
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  async req(method, url, { body, form, headers = {}, redirect = 'manual', raw } = {}) {
    const h = { cookie: this.cookieHeader(), ...headers };
    let payload;
    if (raw !== undefined) payload = raw;
    else if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; h.accept = 'application/json'; }
    if (method !== 'GET' && this.csrf && !h['x-csrf-token']) h['x-csrf-token'] = this.csrf;
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect });
    this.store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, body, o = {}) { return this.req('POST', url, { body, ...o }); }
  async init() { const r = await this.get('/api/csrf'); this.csrf = r.json.csrf; return this; }
}

// Próximo día laborable a N días vista (evita fines de semana y festivos sembrados).
export function nextWeekday(days = 3, from = T.todayLocal()) {
  let d = T.addDays(from, days);
  const holidays = new Set(['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06']);
  while ([0, 6].includes(T.weekdayOf(d)) || holidays.has(d)) d = T.addDays(d, 1);
  return d;
}

export const person = (n = 1) => ({ name: `Cliente ${n}`, email: `cliente${n}@example.com`, phone: '+34 600 000 00' + (n % 10), accept: true, lang: 'es' });

// Activa la venta online con IVA configurado (como haría el administrador).
export function enableSales(ctx, rateBp = 2100) {
  ctx.settings.set('commerce', { sales_enabled: true, tax_configured: true, tax_rate_bp: rateBp, prices_confirmed: true, conditions_confirmed: true });
}
