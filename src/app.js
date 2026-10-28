// Composición de la aplicación: contexto de servicios + Express.
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { loadConfig, ROOT } from './config.js';
import { openDb } from './db/index.js';
import { seed } from './db/seed.js';
import { createSettings } from './services/settings.js';
import { createCatalog } from './services/catalog.js';
import { createContent } from './content/defaults.js';
import { createPayments } from './services/payments.js';
import { createMail } from './services/mail.js';
import { createBookings } from './services/bookings.js';
import { createCommerce } from './services/commerce.js';
import { createNotifier, requestStore } from './services/notify.js';
import { createSessions, createRateLimiter, parseCookies, securityHeaders, csrfMiddleware, cookieOptions } from './lib/security.js';
import { randomToken, AppError } from './lib/util.js';
import { errorMessage } from './i18n/ui.js';
import { apiRoutes } from './routes/api.js';
import { publicRoutes } from './routes/public.js';
import { manageRoutes } from './routes/manage.js';
import { accountRoutes } from './routes/account.js';
import { payRoutes } from './routes/pay.js';
import { seoRoutes } from './routes/seo.js';
import { adminRoutes } from './routes/admin/index.js';
import { renderError } from './views/pages/errors.js';

export const ASSET_VERSION = String(Date.now()).slice(-8);

export function createContext(overrides = {}) {
  const cfg = loadConfig(overrides);
  // En desarrollo, sin BASE_URL, los enlaces usan el origen de la petición (útil en
  // Codespaces o al abrir la web desde otro dispositivo de la red local).
  if (!process.env.BASE_URL && !cfg.isProd && !overrides.baseUrl) {
    const fallback = cfg.baseUrl;
    Object.defineProperty(cfg, 'baseUrl', { get: () => requestStore.getStore()?.origin || fallback, set: () => {}, enumerable: true });
  }
  const db = openDb(cfg.dbFile);
  const seeded = seed(db, { adminEmail: cfg.adminEmail, adminPassword: cfg.adminPassword, isProd: cfg.isProd });
  const ctx = { cfg, db, clockOffset: 0, seeded };
  ctx.now = () => Date.now() + ctx.clockOffset;
  ctx.settings = createSettings(db);
  ctx.catalog = createCatalog(db);
  ctx.content = createContent(db);
  ctx.payments = createPayments(ctx);
  ctx.mail = createMail(ctx);
  ctx.bookings = createBookings(ctx);
  ctx.commerce = createCommerce(ctx);
  ctx.notify = createNotifier(ctx);
  ctx.sessions = createSessions(db, cfg);
  ctx.limiter = createRateLimiter();
  return ctx;
}

export function createApp(ctx) {
  const { cfg } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy ? 1 : false);
  app.locals.ctx = ctx;

  app.use(compression());

  // Recursos estáticos (antes de cookies y sesiones).
  const staticOpts = { maxAge: cfg.isProd ? '7d' : 0, fallthrough: true, index: false };
  app.use(express.static(path.join(ROOT, 'public'), staticOpts));
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build'), staticOpts));
  app.use('/vendor/three-addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm'), staticOpts));
  app.use('/media', express.static(cfg.uploadsDir, { ...staticOpts, maxAge: '30d' }));

  // Webhooks: cuerpo sin procesar para verificar la firma.
  app.use('/webhooks', express.raw({ type: '*/*', limit: '1mb' }));

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    // Clave de visor de la bandeja de pruebas (solo en modo prueba): permite ver
    // los correos que generó este navegador sin enviarlos.
    let viewerKey = null;
    if (cfg.demoMailbox) {
      viewerKey = req.cookies.frame_vk;
      if (!viewerKey || viewerKey.length > 64) {
        viewerKey = randomToken(18);
        res.cookie('frame_vk', viewerKey, cookieOptions(cfg, { maxAge: 30 * 86400_000 }));
      }
    }
    req.viewerKey = viewerKey;
    const host = (cfg.trustProxy || !cfg.isProd) ? (req.get('x-forwarded-host') || req.get('host')) : req.get('host');
    const rawProto = (cfg.trustProxy || !cfg.isProd) ? String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim() : req.protocol;
    const proto = rawProto === 'https' ? 'https' : 'http';
    const origin = host && /^[a-z0-9.:\[\]-]+$/i.test(host) ? `${proto}://${host}` : null;
    requestStore.run({ viewerKey, origin }, next);
  });
  app.use(securityHeaders(cfg, () => ctx.settings.get('analytics')));
  app.use(csrfMiddleware(cfg));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));

  // Idioma, sesión de cliente y estado global para las vistas.
  app.use((req, res, next) => {
    req.lang = req.path === '/en' || req.path.startsWith('/en/') ? 'en' : 'es';
    const s = ctx.sessions.read(req, 'customer');
    req.customer = s ? ctx.db.get('SELECT * FROM customers WHERE id = ?', [s.subject_id]) : null;
    req.customerSession = s;
    res.locals.lang = req.lang;
    res.locals.assetVersion = ASSET_VERSION;
    next();
  });

  // Mantenimiento ligero: libera bloqueos caducados en cada petición dinámica.
  let lastSweep = 0;
  app.use((req, res, next) => {
    if (ctx.now() - lastSweep > 30_000) { lastSweep = ctx.now(); try { ctx.bookings.sweep(); } catch (e) { console.error('[sweep]', e); } }
    next();
  });

  seoRoutes(app, ctx);
  payRoutes(app, ctx);
  apiRoutes(app, ctx);
  adminRoutes(app, ctx);
  accountRoutes(app, ctx);
  manageRoutes(app, ctx);
  publicRoutes(app, ctx);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'NOT_FOUND', message: errorMessage(req.lang, 'NOT_FOUND') });
    res.status(404).send(renderError(ctx, req, res, 404));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const isApp = err instanceof AppError;
    const status = isApp ? err.status : (err.type === 'entity.too.large' ? 413 : (err.status && err.status < 500 ? err.status : 500));
    if (!isApp && status >= 500) console.error('[error]', req.method, req.originalUrl, err);
    const code = isApp ? err.code : (status === 413 ? 'VALIDATION' : (status < 500 ? 'VALIDATION' : 'SERVER_ERROR'));
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/') || req.accepts(['html', 'json']) === 'json') {
      return res.status(status).json({ error: code, message: errorMessage(req.lang || 'es', code, err.details), details: err.details });
    }
    res.status(status).send(renderError(ctx, req, res, status, code, err.details));
  });

  return app;
}

// Tareas periódicas: renovaciones de planes y limpieza de sesiones.
export function startJobs(ctx) {
  const run = () => {
    try { ctx.bookings.sweep(); ctx.commerce.planMaintenance(); ctx.sessions.purgeExpired(); } catch (e) { console.error('[jobs]', e); }
  };
  run();
  return setInterval(run, 10 * 60_000).unref();
}
