// Pagos: webhooks verificados (Stripe y pasarela de prueba), páginas de la pasarela de prueba,
// estado de pedidos y enlaces de pago de renovaciones.
import { AppError } from '../lib/util.js';
import { verifyCsrf } from '../lib/security.js';
import { path } from '../i18n/routes.js';
import { renderTestGateway, renderOrder } from '../views/pages/pay.js';
import { renderError } from '../views/pages/errors.js';

export function payRoutes(app, ctx) {
  const { db, commerce } = ctx;

  // Webhook de Stripe: se verifica la firma con el cuerpo sin procesar.
  app.post('/webhooks/stripe', (req, res) => {
    const impl = ctx.payments.impl;
    if (!impl || ctx.payments.provider !== 'stripe') return res.status(404).json({ error: 'NOT_FOUND' });
    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!impl.verify(payload, req.get('stripe-signature'))) return res.status(400).json({ error: 'INVALID_SIGNATURE' });
    let evt;
    try { evt = JSON.parse(payload); } catch { return res.status(400).json({ error: 'INVALID_JSON' }); }
    const out = commerce.handleEvent(impl.normalize(evt));
    res.json({ received: true, duplicate: Boolean(out.duplicate) });
  });

  // Webhook de la pasarela de prueba: mismo esquema de firma que Stripe.
  app.post('/webhooks/test', (req, res) => {
    const impl = ctx.payments.impl;
    if (!impl || ctx.payments.provider !== 'test') return res.status(404).json({ error: 'NOT_FOUND' });
    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!impl.verify(payload, req.get('x-frame-signature'))) return res.status(400).json({ error: 'INVALID_SIGNATURE' });
    let evt;
    try { evt = JSON.parse(payload); } catch { return res.status(400).json({ error: 'INVALID_JSON' }); }
    const out = commerce.handleEvent(impl.normalize(evt));
    res.json({ received: true, duplicate: Boolean(out.duplicate), result: out.result?.status || out.result || null });
  });

  // ---------------------------------------------------- pasarela de prueba
  function testOrder(req) {
    if (ctx.payments.provider !== 'test') return null;
    const sid = String(req.params.sid || '');
    if (!/^cs_local_[A-Za-z0-9_-]{8,40}$/.test(sid)) return null;
    return db.get('SELECT * FROM orders WHERE provider_session_id = ?', [sid]);
  }
  function returnUrls(order) {
    const b = db.get('SELECT * FROM bookings WHERE order_id = ?', [order.id]) || db.get("SELECT * FROM bookings WHERE ref = ?", [JSON.parse(order.items)[0]?.booking_ref || '']);
    if (b) {
      const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
      const u = `${path('manage', b.lang, `/${b.ref}`)}?t=${ctx.bookings.manageToken(b.ref, c)}`;
      return { ok: `${u}&pago=ok`, cancel: `${u}&pago=cancelado` };
    }
    const u = `/pedido/${order.ref}?t=${commerce.orderToken(order.ref)}`;
    return { ok: `${u}&pago=ok`, cancel: `${u}&pago=cancelado` };
  }

  app.get('/pago-prueba/:sid', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const order = testOrder(req);
    if (!order) return res.status(404).send(renderError(ctx, req, res, 404));
    const last = db.get("SELECT * FROM payment_events WHERE order_ref = ? AND provider = 'test' ORDER BY id DESC LIMIT 1", [order.ref]);
    res.send(renderTestGateway(ctx, req, res, { order, last, flash: req.query.msg }));
  });

  app.post('/pago-prueba/:sid/:action', (req, res) => {
    if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
    const order = testOrder(req);
    if (!order) throw new AppError('NOT_FOUND', 404);
    const impl = ctx.payments.impl;
    const urls = returnUrls(order);
    const deliver = (type, data, id) => {
      const evt = impl.buildEvent(type, { order_ref: order.ref, session_id: order.provider_session_id, ...data }, id);
      // Se procesa exactamente igual que una notificación externa: verificar firma y aplicar.
      if (!impl.verify(evt.payload, evt.signature)) throw new AppError('INVALID_SIGNATURE', 400);
      return commerce.handleEvent(impl.normalize(JSON.parse(evt.payload)));
    };
    switch (req.params.action) {
      case 'pagar': {
        if (order.status !== 'pending') return res.redirect(303, `/pago-prueba/${order.provider_session_id}?msg=not_pending`);
        if (order.expires_at && order.expires_at < ctx.now()) return res.redirect(303, `/pago-prueba/${order.provider_session_id}?msg=expired`);
        deliver('payment.succeeded', { amount: order.total_cents, currency: order.currency, payment_id: `pi_local_${order.ref}` });
        return res.redirect(303, urls.ok);
      }
      case 'rechazar':
        deliver('payment.failed', { reason: 'card_declined' });
        return res.redirect(303, urls.cancel);
      case 'caducar':
        deliver('checkout.expired', {});
        return res.redirect(303, urls.cancel);
      case 'volver':
        return res.redirect(303, urls.cancel);
      case 'repetir': {
        // Reenvía la última notificación con el mismo identificador para comprobar la idempotencia.
        const last = db.get("SELECT * FROM payment_events WHERE order_ref = ? AND provider = 'test' ORDER BY id DESC LIMIT 1", [order.ref]);
        if (!last) return res.redirect(303, `/pago-prueba/${order.provider_session_id}?msg=no_event`);
        const original = JSON.parse(last.payload);
        const out = deliver(original.type, { amount: original.amount, currency: original.currency, payment_id: original.paymentId, reason: original.reason }, original.id);
        return res.redirect(303, `/pago-prueba/${order.provider_session_id}?msg=${out.duplicate ? 'duplicate_ignored' : 'processed'}`);
      }
      default: throw new AppError('NOT_FOUND', 404);
    }
  });

  // ------------------------------------------------- estado de un pedido
  app.get('/pedido/:ref', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ref = String(req.params.ref).toUpperCase();
    if (!commerce.verifyOrderToken(ref, String(req.query.t || ''))) return res.status(404).send(renderError(ctx, req, res, 404));
    const order = db.get('SELECT * FROM orders WHERE ref = ?', [ref]);
    if (!order) return res.status(404).send(renderError(ctx, req, res, 404));
    res.send(renderOrder(ctx, req, res, { order, token: String(req.query.t), payment: req.query.pago }));
  });

  app.get('/api/orders/:ref/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ref = String(req.params.ref).toUpperCase();
    if (!commerce.verifyOrderToken(ref, String(req.query.t || ''))) throw new AppError('NOT_FOUND', 404);
    const o = db.get('SELECT status FROM orders WHERE ref = ?', [ref]);
    res.json(o || {});
  });

  // Enlace de pago de una renovación (enviado por correo).
  app.get('/pagar/:ref', async (req, res) => {
    const ref = String(req.params.ref).toUpperCase();
    if (!commerce.verifyOrderToken(ref, String(req.query.t || ''))) return res.status(404).send(renderError(ctx, req, res, 404));
    const order = db.get('SELECT * FROM orders WHERE ref = ?', [ref]);
    if (!order || order.status !== 'pending') return res.redirect(303, `/pedido/${ref}?t=${req.query.t}`);
    const c = db.get('SELECT * FROM customers WHERE id = ?', [order.customer_id]);
    const back = `${ctx.cfg.baseUrl}/pedido/${ref}?t=${req.query.t}`;
    const url = await commerce.startCheckout(order, { lines: commerce.orderLinesFromItems(order), email: c.email, lang: c.lang, successUrl: `${back}&pago=ok`, cancelUrl: `${back}&pago=cancelado` });
    res.redirect(303, url);
  });
}
