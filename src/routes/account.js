// Área de cliente: acceso por enlace mágico (sin contraseña), reservas, bonos, planes,
// justificantes y datos personales. Cada consulta se filtra por el cliente de la sesión.
import { AppError, randomToken, sha256, normEmail } from '../lib/util.js';
import { V, z, parse } from '../lib/validate.js';
import { verifyCsrf, clientIp } from '../lib/security.js';
import { path, ROUTES } from '../i18n/routes.js';
import { renderLogin, renderDashboard, renderReceipt, renderMailbox } from '../views/pages/account.js';
import { renderError } from '../views/pages/errors.js';

const TOKEN_TTL = 20 * 60_000;

export function accountRoutes(app, ctx) {
  const { db, limiter, sessions } = ctx;

  // Solicitud del enlace de acceso. La respuesta es la misma exista o no el correo.
  app.post('/api/account/login', (req, res) => {
    if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
    const b = parse(z.object({ email: V.email, next: z.string().max(300).optional(), lang: V.lang }), req.body);
    const ip = clientIp(req);
    if (!limiter.take(`login-ip:${ip}`, 20, 3600_000) || !limiter.take(`login-email:${b.email}`, 5, 3600_000)) throw new AppError('RATE_LIMITED', 429);
    const es = b.lang !== 'en';
    const c = db.get('SELECT * FROM customers WHERE email = ?', [normEmail(b.email)]);
    if (c) {
      const token = randomToken(32);
      const next = b.next && b.next.startsWith('/') && !b.next.startsWith('//') ? b.next : null;
      db.run('INSERT INTO login_tokens (token_hash, customer_id, created_at, expires_at, next_path) VALUES (?,?,?,?,?)', [sha256(token), c.id, ctx.now(), ctx.now() + TOKEN_TTL, next]);
      const url = `${ctx.cfg.baseUrl}${path('account', b.lang)}/entrar?token=${token}`;
      ctx.notify('mail', {
        to: c.email, lang: b.lang, kind: 'login.link', content: {
          subject: es ? 'Tu enlace para entrar en FRAME' : 'Your FRAME sign-in link',
          title: es ? 'Entra en tu cuenta' : 'Sign in to your account',
          intro: es ? 'Pulsa el botón para acceder a tus reservas, bonos y planes. El enlace caduca en 20 minutos y solo funciona una vez.' : 'Press the button to access your bookings, passes and plans. The link expires in 20 minutes and works only once.',
          cta: { label: es ? 'Entrar en Mi cuenta' : 'Go to My account', url },
          footerNote: es ? 'Si no lo has pedido tú, ignora este correo.' : 'If you did not request it, ignore this email.',
        },
      });
    }
    res.json({
      ok: true,
      message: es ? 'Si ese correo tiene reservas o compras en FRAME, recibirás un enlace de acceso en unos minutos.' : 'If that email has bookings or purchases at FRAME, you will receive a sign-in link in a few minutes.',
      mailbox: ctx.cfg.demoMailbox && !ctx.mail.configured ? '/correo-prueba' : undefined,
    });
  });

  for (const lang of ['es', 'en']) {
    const base = ROUTES.account[lang];

    app.get(`${base}/entrar`, (req, res) => {
      const token = String(req.query.token || '');
      const row = token.length > 20 ? db.get('SELECT * FROM login_tokens WHERE token_hash = ?', [sha256(token)]) : null;
      if (!row || row.used_at || row.expires_at < ctx.now()) {
        return res.status(400).send(renderLogin(ctx, req, res, { error: lang === 'en' ? 'The link is not valid or has expired. Request a new one.' : 'El enlace no es válido o ha caducado. Solicita uno nuevo.' }));
      }
      db.run('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?', [ctx.now(), row.token_hash]);
      sessions.destroy(req, res, 'customer');
      sessions.create(res, 'customer', row.customer_id);
      res.redirect(303, row.next_path || base);
    });

    app.get(base, (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!req.customer) return res.send(renderLogin(ctx, req, res, {}));
      res.send(renderDashboard(ctx, req, res, { flash: req.query.ok ? String(req.query.ok) : null }));
    });

    app.post(`${base}/salir`, (req, res) => {
      if (req.customerSession && verifyCsrf(req, req.customerSession.csrf)) sessions.destroy(req, res, 'customer');
      res.redirect(303, base);
    });

    app.post(`${base}/datos`, (req, res) => {
      if (!req.customer) throw new AppError('UNAUTHORIZED', 401);
      if (!verifyCsrf(req, req.customerSession.csrf)) throw new AppError('CSRF', 403);
      const b = parse(z.object({
        name: V.name, phone: V.phone, company: V.optText(120), tax_id: V.optText(30), billing_address: V.optText(300),
        marketing: V.bool.optional(), lang: V.lang,
      }), req.body);
      const t = ctx.now();
      const c = req.customer;
      db.run(`UPDATE customers SET name = ?, phone = ?, company = ?, tax_id = ?, billing_address = ?, lang = ?,
        marketing_opt_in = ?, marketing_opt_in_at = CASE WHEN ? = 1 AND marketing_opt_in = 0 THEN ? WHEN ? = 0 THEN NULL ELSE marketing_opt_in_at END, updated_at = ? WHERE id = ?`,
      [b.name, b.phone || null, b.company || null, b.tax_id || null, b.billing_address || null, b.lang, b.marketing ? 1 : 0, b.marketing ? 1 : 0, t, b.marketing ? 1 : 0, t, c.id]);
      ctx.bookings.audit(`customer:${c.id}`, 'customer.updated', 'customer', String(c.id));
      res.redirect(303, `${base}?ok=datos#datos`);
    });

    app.post(`${base}/planes/:ref/baja`, (req, res) => {
      if (!req.customer) throw new AppError('UNAUTHORIZED', 401);
      if (!verifyCsrf(req, req.customerSession.csrf)) throw new AppError('CSRF', 403);
      const p = db.get('SELECT * FROM plans WHERE ref = ? AND customer_id = ?', [req.params.ref, req.customer.id]);
      if (!p) throw new AppError('NOT_FOUND', 404);
      ctx.commerce.cancelPlan(p.id, { actor: 'customer', actorId: req.customer.id });
      ctx.notify('plan.cancelled', { planId: p.id });
      res.redirect(303, `${base}?ok=baja#planes`);
    });

    // Justificante: propietario con sesión o enlace de gestión firmado.
    app.get(`${ROUTES.receipt[lang]}/:ref`, (req, res) => {
      res.set('Cache-Control', 'no-store');
      const ref = String(req.params.ref).toUpperCase();
      let booking = db.get('SELECT * FROM bookings WHERE ref = ?', [ref]);
      let order = booking ? (booking.order_id ? db.get('SELECT * FROM orders WHERE id = ?', [booking.order_id]) : null) : db.get('SELECT * FROM orders WHERE ref = ?', [ref]);
      if (!booking && !order) return res.status(404).send(renderError(ctx, req, res, 404));
      const ownerId = booking ? booking.customer_id : order.customer_id;
      const tokenOk = booking ? Boolean(ctx.bookings.findByManageToken(ref, String(req.query.t || ''))) : ctx.commerce.verifyOrderToken(ref, String(req.query.t || ''));
      if (!(req.customer && req.customer.id === ownerId) && !tokenOk) return res.status(403).send(renderError(ctx, req, res, 403, 'FORBIDDEN'));
      res.send(renderReceipt(ctx, req, res, { booking, order }));
    });
  }

  // Bandeja de pruebas: muestra solo los correos generados desde este navegador.
  app.get('/correo-prueba', (req, res) => {
    if (!ctx.cfg.demoMailbox || !req.viewerKey) return res.status(404).send(renderError(ctx, req, res, 404));
    res.set('Cache-Control', 'no-store');
    const mails = db.all('SELECT * FROM outbox WHERE viewer_key = ? ORDER BY id DESC LIMIT 30', [req.viewerKey]);
    res.send(renderMailbox(ctx, req, res, mails));
  });
}
