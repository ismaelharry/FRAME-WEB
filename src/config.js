// Configuración de entorno. Las claves privadas se leen de variables de entorno
// (o de un archivo .env local que nunca se sube al repositorio).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

// Secreto de la aplicación: firma enlaces de gestión, tokens CSRF y la pasarela de prueba.
// En desarrollo se genera y guarda en data/secret.key para que sobreviva a reinicios.
function appSecret() {
  if (env.APP_SECRET && env.APP_SECRET.length >= 32) return env.APP_SECRET;
  if (isProd) throw new Error('APP_SECRET (mínimo 32 caracteres) es obligatorio en producción.');
  const file = path.join(ROOT, 'data', 'secret.key');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

export function loadConfig(overrides = {}) {
  const cfg = {
    env: isProd ? 'production' : (env.NODE_ENV || 'development'),
    isProd,
    port: Number(env.PORT || 3000),
    baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
    dbFile: env.DATABASE_FILE || path.join(ROOT, 'data', 'frame.db'),
    uploadsDir: env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
    secret: appSecret(),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    // Correo: sin SMTP los mensajes se guardan en la bandeja de pruebas y NO se envían.
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : null,
    mailFrom: env.MAIL_FROM || 'FRAME <frame@gmail.com>',
    notifyTo: env.NOTIFY_TO || 'frame@gmail.com',
    // Stripe: si faltan las claves se usa la pasarela de prueba local (nunca cobra).
    stripe: env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      testMode: env.STRIPE_SECRET_KEY.startsWith('sk_test_'),
    } : null,
    // La pasarela simulada solo existe fuera de producción salvo que se habilite expresamente.
    allowTestGateway: !isProd || env.ALLOW_TEST_GATEWAY === 'true',
    // Bandeja de pruebas visible para el propio navegador (solo fuera de producción).
    demoMailbox: !isProd || env.DEMO_MAILBOX === 'true',
    adminEmail: env.ADMIN_EMAIL || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    seedDemo: env.SEED_DEMO !== 'false',
    ...overrides,
  };
  return cfg;
}
