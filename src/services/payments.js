// Pasarelas de pago.
// - Stripe (Checkout + webhooks firmados) si existen STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET.
// - Pasarela de prueba local, claramente identificada, si no hay claves. Nunca cobra:
//   genera notificaciones firmadas con el mismo esquema que Stripe para probar el flujo.
// En ambos casos el pago solo se da por bueno cuando llega un evento verificado.
import crypto from 'node:crypto';
import { AppError, randomToken, safeEqual } from '../lib/util.js';

const TOLERANCE_S = 300;

export function signPayload(secret, payload, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export function verifySignature(secret, payload, header, nowS = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.create(null);
  const v1s = [];
  for (const kv of String(header).split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'v1') v1s.push(v); else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return v1s.some((v) => safeEqual(v, expected));
}

// ------------------------------------------------------------------ Stripe
function stripeProvider(cfg) {
  const api = async (method, path, params) => {
    const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
      body,
    });
    const data = await res.json();
    if (!res.ok) throw new AppError('PAYMENT_PROVIDER_ERROR', 502, { message: data?.error?.message });
    return data;
  };
  return {
    name: 'stripe',
    testMode: cfg.stripe.testMode,
    async createSession({ order, lines, email, lang, successUrl, cancelUrl, expiresAt }) {
      const s = await api('POST', 'checkout/sessions', {
        mode: 'payment',
        customer_email: email,
        client_reference_id: order.ref,
        locale: lang === 'en' ? 'en' : 'es',
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: Math.floor(expiresAt / 1000),
        metadata: { order_ref: order.ref },
        payment_intent_data: { metadata: { order_ref: order.ref } },
        line_items: lines.map((l) => ({
          quantity: 1,
          price_data: { currency: order.currency.toLowerCase(), unit_amount: l.amount_cents, product_data: { name: l.name } },
        })),
      });
      return { sessionId: s.id, url: s.url };
    },
    async refund(order, amount) {
      if (!order.provider_payment_id) throw new AppError('REFUND_NO_PAYMENT', 409);
      await api('POST', 'refunds', { payment_intent: order.provider_payment_id, amount, metadata: { order_ref: order.ref } });
      return { immediate: false };
    },
    verify: (payload, header) => verifySignature(cfg.stripe.webhookSecret, payload, header),
    // Traduce eventos de Stripe a eventos internos.
    normalize(evt) {
      const o = evt.data?.object || {};
      const base = { provider: 'stripe', id: evt.id, raw: evt.type };
      switch (evt.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          if (o.payment_status !== 'paid') return { ...base, type: 'ignored' };
          return { ...base, type: 'payment.succeeded', orderRef: o.metadata?.order_ref || o.client_reference_id, sessionId: o.id, paymentId: o.payment_intent, amount: o.amount_total, currency: String(o.currency || '').toUpperCase() };
        case 'checkout.session.async_payment_failed':
          return { ...base, type: 'payment.failed', orderRef: o.metadata?.order_ref || o.client_reference_id, sessionId: o.id, reason: 'async_payment_failed' };
        case 'checkout.session.expired':
          return { ...base, type: 'checkout.expired', orderRef: o.metadata?.order_ref || o.client_reference_id, sessionId: o.id };
        case 'payment_intent.payment_failed':
          return { ...base, type: 'payment.failed', orderRef: o.metadata?.order_ref, paymentId: o.id, reason: o.last_payment_error?.code || 'payment_failed' };
        case 'charge.refunded':
          return { ...base, type: 'refund.succeeded', orderRef: o.metadata?.order_ref, paymentId: o.payment_intent, amount: o.amount_refunded };
        default:
          return { ...base, type: 'ignored' };
      }
    },
  };
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') flatten(v, key, out); else out[key] = String(v);
  }
  return out;
}

// ------------------------------------------------------ pasarela de prueba
function testProvider(ctx) {
  const secret = `testgw:${ctx.cfg.secret}`;
  return {
    name: 'test',
    testMode: true,
    secret,
    async createSession({ order, expiresAt }) {
      const sessionId = `cs_local_${randomToken(12)}`;
      return { sessionId, url: `${ctx.cfg.baseUrl}/pago-prueba/${sessionId}`, expiresAt };
    },
    async refund() { return { immediate: true }; },
    verify: (payload, header) => verifySignature(secret, payload, header),
    normalize(evt) {
      const base = { provider: 'test', id: evt.id, raw: evt.type };
      const o = evt.data || {};
      switch (evt.type) {
        case 'payment.succeeded': return { ...base, type: 'payment.succeeded', orderRef: o.order_ref, sessionId: o.session_id, paymentId: o.payment_id, amount: o.amount, currency: o.currency };
        case 'payment.failed': return { ...base, type: 'payment.failed', orderRef: o.order_ref, sessionId: o.session_id, reason: o.reason || 'card_declined' };
        case 'checkout.expired': return { ...base, type: 'checkout.expired', orderRef: o.order_ref, sessionId: o.session_id };
        case 'refund.succeeded': return { ...base, type: 'refund.succeeded', orderRef: o.order_ref, amount: o.amount };
        default: return { ...base, type: 'ignored' };
      }
    },
    // Construye y firma una notificación como lo haría la pasarela real.
    buildEvent(type, data, id = `evt_local_${randomToken(10)}`) {
      const payload = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data });
      return { payload, signature: signPayload(secret, payload) };
    },
  };
}

export function createPayments(ctx) {
  const { cfg } = ctx;
  const provider = cfg.stripe ? stripeProvider(cfg) : (cfg.allowTestGateway ? testProvider(ctx) : null);
  return {
    get available() { return Boolean(provider); },
    get provider() { return provider?.name || 'none'; },
    get testMode() { return provider ? provider.testMode : true; },
    impl: provider,
  };
}
