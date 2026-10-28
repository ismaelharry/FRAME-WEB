// Panel de administración. Todas las rutas /admin exigen sesión de administración
// (cookie frame_admin, SameSite=strict) y los formularios llevan el token CSRF de esa sesión.
// Los permisos se comprueban en el servidor: «staff» (recepción) y «admin».
import express from 'express';
import { html } from '../../lib/html.js';
import { AppError, normEmail } from '../../lib/util.js';
import { verifyCsrf, clientIp } from '../../lib/security.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { adminLayout, field, postForm } from '../../views/admin/ui.js';
import { operationsRoutes } from './operations.js';
import { peopleRoutes } from './people.js';
import { catalogRoutes } from './catalog.js';
import { webRoutes } from './web.js';
import { systemRoutes } from './system.js';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
let dummyHash = null;

export function adminRoutes(app, ctx) {
  const { db } = ctx;
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const s = ctx.sessions.read(req, 'admin');
    const u = s ? db.get('SELECT * FROM users WHERE id = ? AND active = 1', [s.subject_id]) : null;
    req.admin = u || null;
    req.adminSession = u ? s : null;
    res.locals.adminCsrf = u ? s.csrf : res.locals.csrfPublic;
    next();
  });

  // Ayudantes para los submódulos.
  const h = {
    page: (req, res, opts) => {
      res.locals.navCounts = navCounts();
      return res.send(adminLayout(ctx, req, res, opts));
    },
    // Envuelve una acción POST: comprueba CSRF, captura errores de negocio y vuelve con el mensaje.
    act: (fn, { back } = {}) => async (req, res) => {
      if (!verifyCsrf(req, req.adminSession?.csrf)) throw new AppError('CSRF', 403);
      try {
        await fn(req, res);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        const to = (typeof back === 'function' ? back(req) : back) || req.get('referer') || '/admin';
        const u = new URL(to, 'http://x');
        u.searchParams.delete('ok');
        u.searchParams.set('err', e.code);
        res.redirect(303, `${u.pathname}${u.search}`);
      }
    },
    done: (res, to, ok = 'saved') => {
      const [base, hash] = to.split('#');
      res.redirect(303, `${base}${base.includes('?') ? '&' : '?'}ok=${ok}${hash ? `#${hash}` : ''}`);
    },
    adminOnly: (req, res, next) => (req.admin?.role === 'admin' ? next() : next(new AppError('FORBIDDEN', 403))),
    audit: (req, action, entity, entityId, data) => ctx.bookings.audit(`admin:${req.admin.id}`, action, entity, entityId, data),
  };

  function navCounts() {
    const n = (sql, p = []) => db.get(sql, p)?.n || 0;
    return {
      requests: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'new'") + n("SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'"),
      plans: n("SELECT COUNT(*) AS n FROM plans WHERE status IN ('requested','past_due')"),
      payments: n("SELECT COUNT(*) AS n FROM orders WHERE status = 'refund_pending'"),
    };
  }

  // ------------------------------------------------------------------ acceso
  const loginPage = (req, res, { error, email = '' } = {}) => res.status(error ? 401 : 200).send(adminLayout(ctx, req, res, {
    title: 'Acceso al panel',
    body: html`
<div class="alogin">
  <img src="/brand/frame-logo-dark.svg" alt="FRAME · Estudio de contenido y coworking" width="230" height="56">
  ${error ? html`<div class="aflash aflash--err" role="alert">${error}</div>` : ''}
  <form method="post" action="/admin/entrar" class="apanel">
    <input type="hidden" name="_csrf" value="${res.locals.csrfPublic}">
    ${field({ label: 'Correo', name: 'email', type: 'email', value: email, required: true, attrs: { autocomplete: 'username', autofocus: true } })}
    ${field({ label: 'Contraseña', name: 'password', type: 'password', required: true, attrs: { autocomplete: 'current-password' } })}
    <button class="abtn abtn--primary abtn--block" type="submit">Entrar</button>
  </form>
  ${ctx.cfg.isProd ? '' : html`<p class="small muted">Entorno de pruebas: admin@frame.test / frame-admin-demo · recepcion@frame.test / frame-staff-demo</p>`}
</div>`,
  }));

  router.get('/entrar', (req, res) => (req.admin ? res.redirect(303, '/admin') : loginPage(req, res)));

  router.post('/entrar', (req, res) => {
    if (!verifyCsrf(req, res.locals.csrfPublic)) return loginPage(req, res, { error: 'La sesión del formulario ha caducado. Vuelve a intentarlo.' });
    const ip = clientIp(req);
    if (!ctx.limiter.take(`admin-login:${ip}`, 10, 10 * 60_000)) return loginPage(req, res, { error: 'Demasiados intentos. Espera unos minutos.' });
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const u = db.get('SELECT * FROM users WHERE email = ?', [email]);
    const t = ctx.now();
    if (u && u.locked_until && u.locked_until > t) {
      return loginPage(req, res, { error: 'La cuenta está bloqueada temporalmente por varios intentos fallidos. Prueba de nuevo en 15 minutos.', email });
    }
    // Se verifica siempre una contraseña para no revelar si el correo existe por el tiempo de respuesta.
    if (!dummyHash) dummyHash = hashPassword('frame-dummy-password');
    const ok = verifyPassword(password, u ? u.password_hash : dummyHash) && u && u.active === 1;
    if (!ok) {
      if (u) {
        const fails = (u.failed_logins || 0) + 1;
        db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [fails >= LOCK_AFTER ? 0 : fails, fails >= LOCK_AFTER ? t + LOCK_MS : null, u.id]);
        ctx.bookings.audit(`ip:${ip}`, 'admin.login_failed', 'user', String(u.id));
      }
      return loginPage(req, res, { error: 'Correo o contraseña incorrectos.', email });
    }
    db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [t, u.id]);
    ctx.sessions.create(res, 'admin', u.id);
    ctx.bookings.audit(`admin:${u.id}`, 'admin.login', 'user', String(u.id), { ip });
    res.redirect(303, u.must_change_password ? '/admin/cuenta?forzar=1' : '/admin');
  });

  // Todo lo que sigue exige sesión.
  router.use((req, res, next) => {
    if (!req.admin) {
      if (req.method === 'GET') return res.redirect(303, '/admin/entrar');
      throw new AppError('UNAUTHORIZED', 401);
    }
    if (req.admin.must_change_password && !req.path.startsWith('/cuenta') && req.path !== '/salir') return res.redirect(303, '/admin/cuenta?forzar=1');
    next();
  });

  router.post('/salir', (req, res) => {
    if (!verifyCsrf(req, req.adminSession?.csrf)) throw new AppError('CSRF', 403);
    ctx.sessions.destroy(req, res, 'admin');
    res.redirect(303, '/admin/entrar');
  });

  // ------------------------------------------------------------ mi cuenta
  router.get('/cuenta', (req, res) => h.page(req, res, {
    title: 'Mi cuenta',
    body: html`
${req.query.forzar ? html`<div class="aflash aflash--err" role="alert">Por seguridad, cambia la contraseña inicial antes de continuar.</div>` : ''}
<div class="apanel" style="max-width:560px">
  <p class="muted">${req.admin.name} · ${req.admin.email} · ${req.admin.role === 'admin' ? 'Administración' : 'Recepción'}</p>
  ${postForm(res, '/admin/cuenta/clave', html`
    ${field({ label: 'Contraseña actual', name: 'current', type: 'password', required: true, attrs: { autocomplete: 'current-password' } })}
    ${field({ label: 'Nueva contraseña', name: 'password', type: 'password', required: true, hint: 'Al menos 10 caracteres.', attrs: { autocomplete: 'new-password', minlength: 10 } })}
    ${field({ label: 'Repite la nueva contraseña', name: 'password2', type: 'password', required: true, attrs: { autocomplete: 'new-password', minlength: 10 } })}
    <button class="abtn abtn--primary" type="submit">Cambiar contraseña</button>`)}
</div>`,
  }));

  router.post('/cuenta/clave', h.act((req, res) => {
    const { current, password, password2 } = req.body;
    if (!verifyPassword(String(current || ''), req.admin.password_hash)) throw new AppError('WRONG_PASSWORD', 400);
    if (String(password || '').length < 10 || password !== password2) throw new AppError('WEAK_PASSWORD', 400);
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hashPassword(String(password)), req.admin.id]);
    // Cierra las demás sesiones y abre una nueva.
    ctx.sessions.destroyAllFor('admin', req.admin.id);
    ctx.sessions.create(res, 'admin', req.admin.id);
    h.audit(req, 'admin.password_changed', 'user', String(req.admin.id));
    h.done(res, '/admin/cuenta', 'password');
  }, { back: '/admin/cuenta' }));

  operationsRoutes(router, ctx, h);
  peopleRoutes(router, ctx, h);
  catalogRoutes(router, ctx, h);
  webRoutes(router, ctx, h);
  systemRoutes(router, ctx, h);

  app.use('/admin', router);
}
