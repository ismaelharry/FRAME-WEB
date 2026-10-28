import crypto from 'node:crypto';

// Referencias legibles sin caracteres ambiguos (sin 0/O, 1/I/L).
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function makeRef(prefix = 'FR') {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(String(s)).digest('base64url');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();

// Importes: céntimos -> "1.234,50 €" / "€1,234.50"
export function money(cents, lang = 'es', { decimals } = {}) {
  if (cents === null || cents === undefined) return '';
  const value = cents / 100;
  const d = decimals ?? (Number.isInteger(value) ? 0 : 2);
  return new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(value);
}

// Redondeo bancario no: el IVA se redondea al céntimo (half up) sobre la base.
export const taxOf = (base, bp) => Math.round((base * bp) / 10000);

export function json(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export class AppError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
