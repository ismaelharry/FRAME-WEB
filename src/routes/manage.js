// Gestión de una reserva mediante su enlace firmado (sin cuenta) o con la sesión del cliente.
import { AppError } from '../lib/util.js';
import { V, z, parse } from '../lib/validate.js';
import { verifyCsrf, clientIp } from '../lib/security.js';
import { ROUTES } from '../i18n/routes.js';
import { renderManage } from '../views/pages/manage.js';
import { renderError } from '../views/pages/errors.js';

export function manageRoutes(app, ctx) {
  const { db, bookings, commerce } = ctx;

  // Devuelve la reserva si el visitante tiene derecho a verla: token válido o sesión del propietario.
  function access(req) {
    const ref = String(req.params.ref || '').toUpperCase();
    const token = String(req.query.t || req.body?.t || '');
    const byToken = token ? bookings.findByManageToken(ref, token) : null;
    if (byToken) return { booking: byToken, token };
    const b = db.get('SELECT * FROM bookings WHERE ref = ?', [ref]);
    if (b && req.customer && req.customer.id === b.customer_id) {
      return { booking: b, token: bookings.manageToken(b.ref, req.customer) };
    }
    return null;
  }

  for (const lang of ['es', 'en']) {
    const base = ROUTES.manage[lang];
    const back = (b, token, flash) => `${base}/${b.ref}?t=${token}${flash ? `&ok=${flash}` : ''}`;

    app.get(`${base}/:ref`, (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      const a = access(req);
      if (!a) return res.status(404).send(renderError(ctx, req, res, 404));
      bookings.sweep();
      const fresh = db.get('SELECT * FROM bookings WHERE id = ?', [a.booking.id]);
      res.send(renderManage(ctx, req, res, { booking: fresh, token: a.token, flash: req.query.ok, payment: req.query.pago, error: req.query.error }));
    });

    app.post(`${base}/:ref/cancelar`, async (req, res) => {
      if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
      if (!ctx.limiter.take(`manage:${clientIp(req)}`, 30, 600_000)) throw new AppError('RATE_LIMITED', 429);
      const a = access(req);
      if (!a) throw new AppError('NOT_FOUND', 404);
      try {
        const r = bookings.cancel(a.booking.id, { actor: 'customer', actorId: a.booking.customer_id, reason: 'customer' });
        if (r.refund === 'payment' && r.order) await commerce.refundOrder(db.get('SELECT * FROM orders WHERE id = ?', [r.order.id])).catch((e) => console.error('[refund]', e));
        ctx.notify('booking.cancelled', { bookingId: a.booking.id });
        res.redirect(303, back(a.booking, a.token, 'cancelada'));
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        res.redirect(303, `${back(a.booking, a.token)}&error=${e.code}`);
      }
    });

    app.post(`${base}/:ref/cambiar`, (req, res) => {
      if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
      if (!ctx.limiter.take(`manage:${clientIp(req)}`, 30, 600_000)) throw new AppError('RATE_LIMITED', 429);
      const a = access(req);
      if (!a) throw new AppError('NOT_FOUND', 404);
      const b = parse(z.object({ date: V.date, time: V.time.optional().or(z.literal('')), people: V.int(1, 50).optional() }), req.body);
      try {
        bookings.change(a.booking.id, { date: b.date, time: b.time || undefined, people: b.people }, { actor: 'customer', actorId: a.booking.customer_id });
        ctx.notify('booking.changed', { bookingId: a.booking.id });
        res.redirect(303, back(a.booking, a.token, 'cambiada'));
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        res.redirect(303, `${back(a.booking, a.token)}&error=${e.code}`);
      }
    });

    // Archivo de calendario (.ics) con la hora en UTC.
    app.get(`${base}/:ref/calendario.ics`, (req, res) => {
      const a = access(req);
      if (!a) return res.status(404).send('Not found');
      const b = a.booking;
      const r = ctx.catalog.resourceById(b.resource_id);
      const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const biz = ctx.settings.get('business');
      const escIcs = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
      const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FRAME//Reservas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        `UID:${b.ref}@frame`, `DTSTAMP:${stamp(ctx.now())}`, `DTSTART:${stamp(b.start_utc)}`, `DTEND:${stamp(b.end_utc)}`,
        `SUMMARY:${escIcs(`FRAME · ${r[`name_${lang}`]} (${b.ref})`)}`,
        `LOCATION:${escIcs(`${biz.street}, ${biz.postal_code} ${biz.city}`)}`,
        `DESCRIPTION:${escIcs(`${lang === 'en' ? 'Manage' : 'Gestionar'}: ${ctx.cfg.baseUrl}${base}/${b.ref}?t=${a.token}`)}`,
        'END:VEVENT', 'END:VCALENDAR', '',
      ];
      res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="frame-${b.ref}.ics"`).send(lines.join('\r\n'));
    });

    // Reintentar el pago de una reserva retenida.
    app.post(`${base}/:ref/pagar`, async (req, res) => {
      if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
      const a = access(req);
      if (!a) throw new AppError('NOT_FOUND', 404);
      const b = db.get('SELECT * FROM bookings WHERE id = ?', [a.booking.id]);
      if (b.status !== 'pending_payment' || b.hold_expires_at < ctx.now()) return res.redirect(303, `${back(b, a.token)}&error=CHECKOUT_EXPIRED`);
      const order = commerce.createBookingOrder(b);
      const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
      const abs = `${ctx.cfg.baseUrl}${back(b, a.token)}`;
      const url = await commerce.startCheckout(order, { lines: commerce.orderLinesFromItems(order), email: c.email, lang: b.lang, successUrl: `${abs}&pago=ok`, cancelUrl: `${abs}&pago=cancelado` });
      res.redirect(303, url);
    });
  }

  // Estado en JSON para refrescar la página mientras llega la confirmación de la pasarela.
  app.get('/api/bookings/:ref/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const a = access(req);
    if (!a) throw new AppError('NOT_FOUND', 404);
    const b = db.get('SELECT status, payment_status FROM bookings WHERE id = ?', [a.booking.id]);
    res.json(b);
  });
}
