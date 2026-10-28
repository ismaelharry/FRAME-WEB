// Cabeceras de seguridad, cookies, sesiones, CSRF y límites de peticiones.
import crypto from 'node:crypto';
import { randomToken, sha256, safeEqual } from './util.js';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function cookieOptions(cfg, extra = {}) {
  return { httpOnly: true, sameSite: 'lax', secure: cfg.isProd || cfg.baseUrl.startsWith('https://'), path: '/', ...extra };
}

export function securityHeaders(cfg, getAnalytics) {
  return (req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;
    const analytics = getAnalytics?.() || {};
    const extraScript = analytics.provider === 'plausible' ? ' https://plausible.io'
      : analytics.provider === 'ga4' ? ' https://www.googletagmanager.com' : '';
    const extraConnect = analytics.provider === 'plausible' ? ' https://plausible.io'
      : analytics.provider === 'ga4' ? ' https://*.google-analytics.com https://www.googletagmanager.com' : '';
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'${extraScript}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${extraConnect}`,
      "frame-src https://www.google.com https://maps.google.com",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (cfg.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// ---------- Sesiones (cookie con identificador aleatorio; en la base solo su hash) ----------
const SESSION_COOKIE = { admin: 'frame_admin', customer: 'frame_sid' };
const SESSION_TTL = { admin: 12 * 3600_000, customer: 30 * 86400_000 };

export function createSessions(db, cfg) {
  return {
    create(res, kind, subjectId) {
      const id = randomToken(32);
      const csrf = randomToken(24);
      const now = Date.now();
      db.run('INSERT INTO sessions (id_hash, kind, subject_id, csrf, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?,?)',
        [sha256(id), kind, subjectId, csrf, now, now + SESSION_TTL[kind], now]);
      res.cookie(SESSION_COOKIE[kind], id, cookieOptions(cfg, { maxAge: SESSION_TTL[kind], sameSite: kind === 'admin' ? 'strict' : 'lax' }));
      return { csrf };
    },
    read(req, kind) {
      const id = req.cookies[SESSION_COOKIE[kind]];
      if (!id || id.length > 100) return null;
      const s = db.get('SELECT * FROM sessions WHERE id_hash = ? AND kind = ?', [sha256(id), kind]);
      if (!s) return null;
      const now = Date.now();
      if (s.expires_at < now) { db.run('DELETE FROM sessions WHERE id_hash = ?', [s.id_hash]); return null; }
      if (now - (s.last_seen_at || 0) > 5 * 60_000) db.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [now, s.id_hash]);
      return s;
    },
    destroy(req, res, kind) {
      const id = req.cookies[SESSION_COOKIE[kind]];
      if (id) db.run('DELETE FROM sessions WHERE id_hash = ?', [sha256(id)]);
      res.clearCookie(SESSION_COOKIE[kind], { path: '/' });
    },
    destroyAllFor(kind, subjectId) {
      db.run('DELETE FROM sessions WHERE kind = ? AND subject_id = ?', [kind, subjectId]);
    },
    purgeExpired() { db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]); },
  };
}

// ---------- CSRF ----------
// Con sesión: token ligado a la sesión. Sin sesión: doble envío con cookie HttpOnly
// cuyo valor se inserta en la página (el atacante no puede leerlo ni fijarlo entre sitios).
export function csrfMiddleware(cfg) {
  return (req, res, next) => {
    let token = req.cookies.frame_csrf;
    if (!token || token.length < 20 || token.length > 64) {
      token = randomToken(24);
      res.cookie('frame_csrf', token, cookieOptions(cfg, { maxAge: 7 * 86400_000 }));
      req.cookies.frame_csrf = token;
    }
    res.locals.csrfPublic = token;
    next();
  };
}

export function csrfToken(req, res) {
  return req.adminSession?.csrf || res.locals.csrfPublic;
}

export function verifyCsrf(req, expected) {
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  return Boolean(expected) && safeEqual(sent, expected);
}

// ---------- Límites de peticiones (memoria del proceso) ----------
export function createRateLimiter() {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();
  return {
    // Devuelve true si se permite; false si se supera el límite.
    take(key, limit, windowMs) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n++;
      return e.n <= limit;
    },
    reset(key) { hits.delete(key); },
    clear() { hits.clear(); },
  };
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
