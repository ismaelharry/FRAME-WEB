// Pedidos, pagos confirmados por eventos verificados, bonos y planes mensuales.
import * as T from '../lib/time.js';
import { AppError, makeRef, hmac, safeEqual, taxOf } from '../lib/util.js';
import { isUniqueError } from '../db/index.js';
import { quoteProduct, conditionsFor } from './pricing.js';

const H = 3_600_000;

export function createCommerce(ctx) {
  const { db, catalog, settings, bookings } = ctx;
  const now = () => ctx.now();
  const pol = () => settings.get('policies');
  const payments = () => ctx.payments;

  function insertOrder(o) {
    for (let i = 0; i < 5; i++) {
      const ref = makeRef('PD');
      try {
        const r = db.run(`INSERT INTO orders (ref, customer_id, kind, status, provider, subtotal_cents, tax_rate_bp, tax_cents, total_cents, currency, items, conditions, created_at, expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [ref, o.customer_id, o.kind, o.status || 'pending', o.provider, o.subtotal_cents, o.tax_rate_bp, o.tax_cents, o.total_cents,
          o.currency || 'EUR', JSON.stringify(o.items), o.conditions, now(), o.expires_at ?? null]);
        return db.get('SELECT * FROM orders WHERE id = ?', [r.lastInsertRowid]);
      } catch (e) { if (!(isUniqueError(e) && /orders\.ref/.test(e.message))) throw e; }
    }
    throw new AppError('REF_COLLISION', 500);
  }

  const orderToken = (ref) => hmac(ctx.cfg.secret, `order:${ref}`).slice(0, 32);
  const verifyOrderToken = (ref, t) => safeEqual(orderToken(ref), t);

  // Inicia el pago en la pasarela. Debe llamarse fuera de cualquier transacción.
  async function startCheckout(order, { lines, email, lang, successUrl, cancelUrl }) {
    const p = payments();
    if (!p.available) throw new AppError('PAYMENTS_UNAVAILABLE', 503);
    // Stripe exige entre 30 min y 24 h; la retención del hueco dura algo más que la sesión.
    const expiresAt = now() + 31 * 60_000;
    let session;
    try {
      session = await p.impl.createSession({ order, lines, email, lang, successUrl, cancelUrl, expiresAt });
    } catch (e) {
      db.tx(() => {
        db.run("UPDATE orders SET status = 'failed', failed_reason = 'checkout_error' WHERE id = ? AND status = 'pending'", [order.id]);
        db.run("UPDATE bookings SET status = 'expired', payment_status = 'failed', updated_at = ? WHERE order_id = ? AND status = 'pending_payment'", [now(), order.id]);
        db.run("DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM bookings WHERE order_id = ?)", [order.id]);
        db.run("UPDATE plans SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending_payment'", [now(), order.id]);
      });
      throw e;
    }
    db.run('UPDATE orders SET provider_session_id = ? WHERE id = ?', [session.sessionId, order.id]);
    return session.url;
  }

  function orderLinesFromItems(order) {
    return JSON.parse(order.items).map((i) => ({ name: i.name, amount_cents: i.total_cents }));
  }

  // ------------------------------------------------------- pedido de una reserva
  function createBookingOrder(booking) {
    return db.tx(() => {
      const b = db.get('SELECT * FROM bookings WHERE id = ?', [booking.id]);
      if (b.status !== 'pending_payment') throw new AppError('NOT_PAYABLE', 409);
      if (!b.price_final || !b.total_cents) throw new AppError('NOT_PAYABLE', 409);
      const product = catalog.productById(b.product_id);
      const resource = catalog.resourceById(b.resource_id);
      const name = `${product[`name_${b.lang}`] || product.name_es} · ${resource[`name_${b.lang}`] || resource.name_es} · ${b.local_date}${b.kind === 'hourly' ? ` ${T.fmtTime(b.start_utc)}–${T.fmtTime(b.end_utc)}` : ''}`;
      const order = insertOrder({
        customer_id: b.customer_id, kind: 'booking', provider: payments().provider,
        subtotal_cents: b.subtotal_cents, tax_rate_bp: b.tax_rate_bp, tax_cents: b.tax_cents, total_cents: b.total_cents,
        items: [{ type: 'booking', booking_ref: b.ref, name, unit_price_cents: b.unit_price_cents, quantity: b.quantity, subtotal_cents: b.subtotal_cents, tax_rate_bp: b.tax_rate_bp, tax_cents: b.tax_cents, total_cents: b.total_cents }],
        conditions: b.conditions, expires_at: b.hold_expires_at,
      });
      db.run('UPDATE bookings SET order_id = ?, payment_status = ? WHERE id = ?', [order.id, 'pending', b.id]);
      return order;
    });
  }

  // -------------------------------------------------------------- compra de bono
  function createBundleOrder({ customer, productSlug = 'bono-10', lang = 'es' }) {
    return db.tx(() => {
      const product = catalog.product(productSlug);
      if (!product || product.kind !== 'bundle' || !product.active) throw new AppError('PRODUCT_UNAVAILABLE');
      const q = quoteProduct(ctx, product, { quantity: 1 });
      const mode = q.payable ? 'pay' : 'request';
      const cust = bookings.upsertCustomer({ ...customer, lang });
      const conditions = conditionsFor(ctx, { product, usage: 'bundle_purchase', mode, lang });
      if (mode === 'request') {
        const req = createRequest({ type: 'quote', topic: `Alta: ${product.name_es}`, name: customer.name || cust.name || cust.email, email: cust.email, phone: customer.phone, lang,
          message: `Solicitud de compra de ${product.name_es}. Precio base ${(product.price_cents / 100).toFixed(2)} € sin IVA.`, marketing: customer.marketing });
        return { mode, request: req, customer: cust, quote: q, conditions };
      }
      const name = product[`name_${lang}`] || product.name_es;
      const order = insertOrder({
        customer_id: cust.id, kind: 'bundle', provider: payments().provider,
        subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents,
        items: [{ type: 'bundle', product: product.slug, name, credits: product.credits, validity_days: product.validity_days || pol().voucher_validity_days, unit_price_cents: product.price_cents, quantity: 1, subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents }],
        conditions, expires_at: now() + pol().payment_hold_minutes * 60_000,
      });
      return { mode, order, customer: cust, quote: q, conditions };
    });
  }

  function issueVoucher(order, item, { actor = 'system', validFrom = null } = {}) {
    const product = catalog.product(item.product);
    const from = validFrom || T.todayLocal(now());
    const expires = T.addDays(from, item.validity_days || pol().voucher_validity_days);
    let voucher;
    for (let i = 0; i < 5 && !voucher; i++) {
      try {
        const r = db.run(`INSERT INTO vouchers (code, customer_id, product_id, order_id, credits_total, status, valid_from, expires_on, created_at)
          VALUES (?,?,?,?,?,'active',?,?,?)`, [makeRef('BN'), order.customer_id, product.id, order.id, item.credits, from, expires, now()]);
        voucher = db.get('SELECT * FROM vouchers WHERE id = ?', [r.lastInsertRowid]);
      } catch (e) {
        if (isUniqueError(e) && /order_id/.test(e.message)) return db.get('SELECT * FROM vouchers WHERE order_id = ?', [order.id]);
        if (!(isUniqueError(e) && /code/.test(e.message))) throw e;
      }
    }
    db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, note, actor, created_at) VALUES (?,?,'purchase',?,?,?)",
      [voucher.id, item.credits, `Pedido ${order.ref}`, actor, now()]);
    return voucher;
  }

  // Alta manual de un bono (pago en recepción). Crea un pedido manual para el registro de ingresos.
  function issueManualVoucher({ customerId, productSlug = 'bono-10', amount_cents = null, actorId }) {
    return db.tx(() => {
      const product = catalog.product(productSlug);
      const c = settings.get('commerce');
      const base = product.price_cents;
      const bp = c.tax_configured && Number.isInteger(c.tax_rate_bp) ? c.tax_rate_bp : 0;
      const total = amount_cents ?? (base + taxOf(base, bp));
      const item = { type: 'bundle', product: product.slug, name: product.name_es, credits: product.credits, validity_days: product.validity_days || pol().voucher_validity_days, total_cents: total };
      const order = insertOrder({ customer_id: customerId, kind: 'bundle', provider: 'manual', status: 'paid', subtotal_cents: amount_cents ?? base, tax_rate_bp: amount_cents ? 0 : bp, tax_cents: amount_cents ? 0 : taxOf(base, bp), total_cents: total, items: [item], conditions: conditionsFor(ctx, { product, usage: 'bundle_purchase', mode: 'manual', lang: 'es' }) });
      db.run('UPDATE orders SET paid_at = ? WHERE id = ?', [now(), order.id]);
      const v = issueVoucher(order, item, { actor: `admin:${actorId}` });
      bookings.audit(`admin:${actorId}`, 'voucher.issued', 'voucher', v.code, { order: order.ref });
      return v;
    });
  }

  function adjustVoucher(voucherId, delta, note, actorId) {
    return db.tx(() => {
      try {
        db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, note, actor, created_at) VALUES (?,?,'adjust',?,?,?)", [voucherId, delta, note, `admin:${actorId}`, now()]);
      } catch (e) {
        if (/VOUCHER_NEGATIVE/.test(e.message)) throw new AppError('VOUCHER_NEGATIVE', 409);
        throw e;
      }
      bookings.audit(`admin:${actorId}`, 'voucher.adjusted', 'voucher', String(voucherId), { delta, note });
    });
  }

  // ------------------------------------------------------------------- planes
  function fixedCapacityOk(startDate) {
    const pool = catalog.deskPool();
    const activeFixed = db.get(`SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'fixed' AND status IN ('active','past_due','pending_payment')
      AND ((auto_renew = 1 AND cancel_at_period_end = 0) OR period_end IS NULL OR period_end > ?)`, [startDate]).n;
    if (pool.max_fixed !== null && activeFixed >= pool.max_fixed) return { ok: false, reason: 'FIXED_DESKS_FULL' };
    // El puesto debe estar libre todos los días del primer periodo: no se duplica inventario.
    const end = T.addMonths(startDate, 1);
    for (let d = startDate; d < end; d = T.addDays(d, 1)) {
      const info = bookings.deskInfo(d);
      if (info.open && info.raw < 1) return { ok: false, reason: 'NO_DESK_FOR_PERIOD', date: d };
    }
    return { ok: true };
  }

  function assignDeskLabel() {
    const used = new Set(db.all("SELECT desk_label FROM plans WHERE plan_type = 'fixed' AND status IN ('active','past_due') AND desk_label IS NOT NULL").map((r) => r.desk_label));
    for (let i = 1; i < 1000; i++) { const l = `F-${String(i).padStart(2, '0')}`; if (!used.has(l)) return l; }
    return null;
  }

  function insertPlan(row) {
    for (let i = 0; i < 5; i++) {
      try {
        const r = db.run(`INSERT INTO plans (ref, customer_id, product_id, plan_type, status, start_date, unit_price_cents, tax_rate_bp, total_cents, price_final, conditions, order_id, hold_expires_at, notes, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [makeRef('PL'), row.customer_id, row.product_id, row.plan_type, row.status, row.start_date, row.unit_price_cents ?? null, row.tax_rate_bp ?? null,
          row.total_cents ?? null, row.price_final ? 1 : 0, row.conditions ?? null, row.order_id ?? null, row.hold_expires_at ?? null, row.notes ?? null, now(), now()]);
        return db.get('SELECT * FROM plans WHERE id = ?', [r.lastInsertRowid]);
      } catch (e) { if (!(isUniqueError(e) && /plans\.ref/.test(e.message))) throw e; }
    }
    throw new AppError('REF_COLLISION', 500);
  }

  function requestPlan({ customer, productSlug, startDate, lang = 'es', notes }) {
    bookings.sweep();
    return db.tx(() => {
      const product = catalog.product(productSlug);
      if (!product || product.kind !== 'plan' || !product.active) throw new AppError('PRODUCT_UNAVAILABLE');
      bookings.checkDate(startDate);
      const cust = bookings.upsertCustomer({ ...customer, lang });
      const existing = db.get("SELECT 1 FROM plans WHERE customer_id = ? AND product_id = ? AND status IN ('requested','pending_payment','active','past_due')", [cust.id, product.id]);
      if (existing) throw new AppError('PLAN_ALREADY_ACTIVE', 409);
      if (product.plan_type === 'fixed') {
        const cap = fixedCapacityOk(startDate);
        if (!cap.ok) throw new AppError(cap.reason, 409, { date: cap.date });
      }
      if (product.plan_type === 'flex') {
        const n = db.get("SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'flex' AND status IN ('active','past_due','pending_payment')").n;
        if (n >= settings.get('plans').max_flex_members) throw new AppError('FLEX_FULL', 409);
      }
      const q = quoteProduct(ctx, product, { quantity: 1 });
      const mode = q.payable ? 'pay' : 'request';
      const conditions = conditionsFor(ctx, { product, usage: 'plan_purchase', mode, lang });
      const plan = insertPlan({
        customer_id: cust.id, product_id: product.id, plan_type: product.plan_type, status: mode === 'pay' ? 'pending_payment' : 'requested',
        start_date: startDate, unit_price_cents: product.price_cents, tax_rate_bp: q.tax_rate_bp, total_cents: q.total_cents, price_final: q.price_final,
        conditions, hold_expires_at: mode === 'pay' ? now() + pol().payment_hold_minutes * 60_000 : null, notes,
      });
      let order = null;
      if (mode === 'pay') {
        const name = `${product[`name_${lang}`] || product.name_es} · ${T.fmtDateStr(startDate, lang, { day: 'numeric', month: 'short' })} – ${T.fmtDateStr(T.addMonths(startDate, 1), lang, { day: 'numeric', month: 'short', year: 'numeric' })}`;
        order = insertOrder({
          customer_id: cust.id, kind: 'plan', provider: payments().provider,
          subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents,
          items: [{ type: 'plan', plan_ref: plan.ref, period_start: startDate, period_end: T.addMonths(startDate, 1), name, unit_price_cents: product.price_cents, quantity: 1, subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents }],
          conditions, expires_at: plan.hold_expires_at,
        });
        db.run('UPDATE plans SET order_id = ? WHERE id = ?', [order.id, plan.id]);
      }
      bookings.audit(`customer:${cust.id}`, 'plan.requested', 'plan', plan.ref, { product: product.slug, mode });
      return { plan: db.get('SELECT * FROM plans WHERE id = ?', [plan.id]), order, customer: cust, mode, quote: q, conditions };
    });
  }

  function activatePlan(planId, { periodStart = null, actor = 'system' } = {}) {
    const p = db.get('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!p) throw new AppError('NOT_FOUND', 404);
    if (p.status === 'active') return p;
    if (p.plan_type === 'fixed' && p.status === 'requested') {
      const cap = fixedCapacityOk(p.start_date);
      if (!cap.ok) throw new AppError(cap.reason, 409, { date: cap.date });
    }
    const start = periodStart || (p.start_date < T.todayLocal(now()) && p.status !== 'requested' ? p.start_date : p.start_date);
    const label = p.plan_type === 'fixed' ? (p.desk_label || assignDeskLabel()) : null;
    db.run(`UPDATE plans SET status = 'active', period_start = ?, period_end = ?, desk_label = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ?`,
      [start, T.addMonths(start, 1), label, now(), p.id]);
    bookings.audit(actor, 'plan.activated', 'plan', p.ref);
    return db.get('SELECT * FROM plans WHERE id = ?', [p.id]);
  }

  function renewPlan(planId, { actor = 'system' } = {}) {
    const p = db.get('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!p || !['active', 'past_due'].includes(p.status)) throw new AppError('NOT_RENEWABLE', 409);
    const start = p.period_end;
    db.run("UPDATE plans SET status = 'active', period_start = ?, period_end = ?, updated_at = ? WHERE id = ?", [start, T.addMonths(start, 1), now(), p.id]);
    bookings.audit(actor, 'plan.renewed', 'plan', p.ref, { period_start: start });
    return db.get('SELECT * FROM plans WHERE id = ?', [p.id]);
  }

  function cancelPlan(planId, { actor = 'customer', actorId, immediate = false } = {}) {
    return db.tx(() => {
      const p = db.get('SELECT * FROM plans WHERE id = ?', [planId]);
      if (!p) throw new AppError('NOT_FOUND', 404);
      if (['requested', 'pending_payment'].includes(p.status)) {
        db.run("UPDATE plans SET status = 'cancelled', updated_at = ? WHERE id = ?", [now(), p.id]);
        if (p.order_id) db.run("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [p.order_id]);
      } else if (['active', 'past_due'].includes(p.status)) {
        if (immediate && actor === 'admin') db.run("UPDATE plans SET status = 'ended', cancel_at_period_end = 1, period_end = ?, updated_at = ? WHERE id = ?", [T.todayLocal(now()), now(), p.id]);
        else {
          const notice = pol().plan_cancel_notice_days;
          if (actor !== 'admin' && notice > 0 && T.diffDays(T.todayLocal(now()), p.period_end) < notice) throw new AppError('PLAN_NOTICE', 409, { days: notice });
          db.run('UPDATE plans SET cancel_at_period_end = 1, auto_renew = 0, updated_at = ? WHERE id = ?', [now(), p.id]);
        }
      } else throw new AppError('NOT_CANCELLABLE', 409);
      bookings.audit(`${actor}:${actorId ?? p.customer_id}`, 'plan.cancelled', 'plan', p.ref, { immediate });
      return db.get('SELECT * FROM plans WHERE id = ?', [p.id]);
    });
  }

  // Tarea periódica: renovaciones, fin de planes y avisos de pago.
  function planMaintenance() {
    const today = T.todayLocal(now());
    const due = db.all("SELECT * FROM plans WHERE status IN ('active','past_due') AND period_end IS NOT NULL AND period_end <= ?", [today]);
    const results = [];
    for (const p of due) {
      db.tx(() => {
        if (p.cancel_at_period_end || !p.auto_renew) {
          db.run("UPDATE plans SET status = 'ended', updated_at = ? WHERE id = ?", [now(), p.id]);
          results.push([p.ref, 'ended']);
        } else if (p.status === 'active') {
          db.run("UPDATE plans SET status = 'past_due', updated_at = ? WHERE id = ?", [now(), p.id]);
          results.push([p.ref, 'past_due']);
          ctx.notify?.('plan.past_due', { planId: p.id });
        } else if (T.diffDays(p.period_end, today) > 7) {
          db.run("UPDATE plans SET status = 'ended', notes = COALESCE(notes || ' · ', '') || 'Finalizado por impago', updated_at = ? WHERE id = ?", [now(), p.id]);
          results.push([p.ref, 'ended_unpaid']);
        }
      });
    }
    // Pedidos de renovación con enlace de pago 7 días antes (solo si la venta online está activa).
    if (settingsCanSell()) {
      const soon = db.all(`SELECT * FROM plans WHERE status IN ('active','past_due') AND auto_renew = 1 AND cancel_at_period_end = 0
        AND period_end IS NOT NULL AND period_end <= ?`, [T.addDays(today, 7)]);
      for (const p of soon) {
        const exists = db.get("SELECT 1 FROM orders WHERE kind = 'plan' AND status IN ('pending','paid') AND items LIKE ? AND items LIKE ?", [`%"plan_ref":"${p.ref}"%`, `%"period_start":"${p.period_end}"%`]);
        if (exists) continue;
        const order = createRenewalOrder(p);
        if (order) { results.push([p.ref, 'renewal_order', order.ref]); ctx.notify?.('plan.renewal_due', { planId: p.id, orderId: order.id }); }
      }
    }
    return results;
  }

  function settingsCanSell() {
    const c = settings.get('commerce');
    return c.sales_enabled && c.tax_configured && c.prices_confirmed && c.conditions_confirmed && payments().available;
  }

  function createRenewalOrder(p) {
    const product = catalog.productById(p.product_id);
    const q = quoteProduct(ctx, product, { quantity: 1 });
    if (!q.payable) return null;
    const cust = db.get('SELECT * FROM customers WHERE id = ?', [p.customer_id]);
    const lang = cust.lang || 'es';
    const name = `${product[`name_${lang}`]} · ${p.period_end} – ${T.addMonths(p.period_end, 1)}`;
    return insertOrder({
      customer_id: p.customer_id, kind: 'plan', provider: payments().provider,
      subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents,
      items: [{ type: 'plan', plan_ref: p.ref, renewal: true, period_start: p.period_end, period_end: T.addMonths(p.period_end, 1), name, unit_price_cents: product.price_cents, quantity: 1, subtotal_cents: q.subtotal_cents, tax_rate_bp: q.tax_rate_bp, tax_cents: q.tax_cents, total_cents: q.total_cents }],
      conditions: p.conditions || conditionsFor(ctx, { product, usage: 'plan_purchase', mode: 'pay', lang }),
      expires_at: null,
    });
  }

  // ---------------------------------------------- solicitudes (contacto/presupuesto)
  function createRequest({ type, topic, name, email, phone, company, team_size, start_date, message, lang = 'es', marketing = false }) {
    const t = now();
    for (let i = 0; i < 5; i++) {
      try {
        const r = db.run(`INSERT INTO requests (ref, type, topic, name, email, phone, company, team_size, start_date, message, marketing_opt_in, lang, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [makeRef(type === 'quote' ? 'PR' : 'CT'), type, topic || null, name, String(email).trim().toLowerCase(), phone || null, company || null,
          team_size ?? null, start_date || null, message || null, marketing ? 1 : 0, lang, t, t]);
        const req = db.get('SELECT * FROM requests WHERE id = ?', [r.lastInsertRowid]);
        if (marketing) bookings.upsertCustomer({ email, name, phone, lang, marketing: true });
        return req;
      } catch (e) { if (!(isUniqueError(e) && /requests\.ref/.test(e.message))) throw e; }
    }
    throw new AppError('REF_COLLISION', 500);
  }

  // ------------------------------------------------------------ eventos de pago
  // Idempotente: cada evento se registra una sola vez (UNIQUE provider+event_id) en la
  // misma transacción en la que se aplica. Una notificación repetida no duplica nada.
  function handleEvent(evt) {
    const t = now();
    const out = db.tx(() => {
      try {
        db.run('INSERT INTO payment_events (provider, event_id, type, order_ref, payload, received_at) VALUES (?,?,?,?,?,?)',
          [evt.provider, evt.id, evt.raw || evt.type, evt.orderRef || null, JSON.stringify(evt), t]);
      } catch (e) {
        if (isUniqueError(e)) return { duplicate: true };
        throw e;
      }
      if (evt.type === 'ignored') return { result: 'ignored' };
      const order = evt.orderRef ? db.get('SELECT * FROM orders WHERE ref = ?', [evt.orderRef])
        : (evt.sessionId ? db.get('SELECT * FROM orders WHERE provider_session_id = ?', [evt.sessionId])
          : (evt.paymentId ? db.get('SELECT * FROM orders WHERE provider_payment_id = ?', [evt.paymentId]) : null));
      if (!order) return { result: 'order_not_found' };
      let result;
      switch (evt.type) {
        case 'payment.succeeded': result = onPaid(order, evt); break;
        case 'payment.failed': result = onFailed(order, evt); break;
        case 'checkout.expired': result = onExpired(order); break;
        case 'refund.succeeded': result = onRefunded(order, evt); break;
        default: result = 'ignored';
      }
      db.run('UPDATE payment_events SET result = ? WHERE provider = ? AND event_id = ?', [String(result.status || result), evt.provider, evt.id]);
      return { result, order: db.get('SELECT * FROM orders WHERE id = ?', [order.id]) };
    });
    if (out.result?.notify) for (const [name, payload] of out.result.notify) ctx.notify?.(name, payload);
    return out;
  }

  function onPaid(order, evt) {
    if (order.status === 'paid' || order.status === 'refund_pending' || order.status === 'refunded') return { status: 'already_paid' };
    if (evt.amount !== undefined && evt.amount !== null && Number(evt.amount) !== order.total_cents) {
      bookings.audit('system', 'payment.amount_mismatch', 'order', order.ref, { expected: order.total_cents, got: evt.amount });
      return { status: 'amount_mismatch' };
    }
    const t = now();
    db.run("UPDATE orders SET status = 'paid', paid_at = ?, provider_payment_id = COALESCE(?, provider_payment_id) WHERE id = ?", [t, evt.paymentId || null, order.id]);
    const notify = [];
    const items = JSON.parse(order.items);
    for (const item of items) {
      if (item.type === 'booking') {
        const b = db.get('SELECT * FROM bookings WHERE ref = ?', [item.booking_ref]);
        if (b.status === 'pending_payment') {
          db.run("UPDATE bookings SET status = 'confirmed', payment_status = 'paid', confirmed_at = ?, hold_expires_at = NULL, order_id = ?, updated_at = ? WHERE id = ?", [t, order.id, t, b.id]);
          notify.push(['booking.confirmed', { bookingId: b.id }]);
        } else if (['expired', 'cancelled'].includes(b.status)) {
          // El pago llegó tarde: intentamos recuperar el hueco; si ya no existe, queda pendiente de reembolso.
          const recovered = tryRecover(b);
          if (recovered) {
            db.run("UPDATE bookings SET status = 'confirmed', payment_status = 'paid', confirmed_at = ?, hold_expires_at = NULL, order_id = ?, updated_at = ? WHERE id = ?", [t, order.id, t, b.id]);
            notify.push(['booking.confirmed', { bookingId: b.id }]);
          } else {
            db.run("UPDATE orders SET status = 'refund_pending' WHERE id = ?", [order.id]);
            db.run("UPDATE bookings SET payment_status = 'refund_pending', cancel_reason = 'paid_after_release', updated_at = ? WHERE id = ?", [t, b.id]);
            bookings.audit('system', 'payment.late_conflict', 'order', order.ref);
            notify.push(['admin.alert', { subject: `Pago recibido para una reserva liberada (${b.ref})`, text: `El pedido ${order.ref} se pagó cuando el hueco ya no estaba disponible. Hay que reembolsarlo.` }]);
          }
        } else if (b.status === 'confirmed' && b.payment_status !== 'paid') {
          db.run("UPDATE bookings SET payment_status = 'paid', order_id = ?, updated_at = ? WHERE id = ?", [order.id, t, b.id]);
        }
      } else if (item.type === 'bundle') {
        const v = issueVoucher(order, item);
        notify.push(['voucher.issued', { voucherId: v.id }]);
      } else if (item.type === 'plan') {
        const p = db.get('SELECT * FROM plans WHERE ref = ?', [item.plan_ref]);
        if (item.renewal) {
          if (p.period_end === item.period_start) renewPlan(p.id);
          notify.push(['plan.renewed', { planId: p.id, orderId: order.id }]);
        } else if (['pending_payment', 'cancelled'].includes(p.status)) {
          let ok = true;
          if (p.status === 'cancelled' && p.plan_type === 'fixed') ok = fixedCapacityOk(p.start_date).ok;
          if (ok) {
            activatePlan(p.id, { periodStart: item.period_start });
            notify.push(['plan.activated', { planId: p.id }]);
          } else {
            db.run("UPDATE orders SET status = 'refund_pending' WHERE id = ?", [order.id]);
            notify.push(['admin.alert', { subject: `Pago recibido para un plan sin puesto disponible (${p.ref})`, text: `El pedido ${order.ref} requiere reembolso.` }]);
          }
        }
      }
    }
    bookings.audit('system', 'payment.succeeded', 'order', order.ref, { provider: order.provider });
    return { status: 'paid', notify };
  }

  function tryRecover(b) {
    try {
      return db.tx(() => {
        if (b.kind === 'desk_day') {
          const info = bookings.deskInfo(b.local_date, { excludeBookingId: b.id });
          if (!info.open || info.free < b.people) throw new AppError('NO_AVAILABILITY', 409);
        } else {
          const r = catalog.resourceById(b.resource_id);
          bookings.claimSlots(b.id, r.id, b.start_utc, b.end_utc, r.buffer_minutes);
        }
        return true;
      });
    } catch { return false; }
  }

  function onFailed(order, evt) {
    if (order.status !== 'pending') return { status: `ignored_${order.status}` };
    db.run("UPDATE orders SET status = 'failed', failed_reason = ? WHERE id = ?", [evt.reason || 'failed', order.id]);
    db.run("UPDATE bookings SET payment_status = 'failed', updated_at = ? WHERE order_id = ? AND status = 'pending_payment'", [now(), order.id]);
    bookings.audit('system', 'payment.failed', 'order', order.ref, { reason: evt.reason });
    return { status: 'failed', notify: [['payment.failed', { orderId: order.id }]] };
  }

  function onExpired(order) {
    if (!['pending', 'failed'].includes(order.status)) return { status: `ignored_${order.status}` };
    db.run("UPDATE orders SET status = 'expired' WHERE id = ?", [order.id]);
    const affected = db.all("SELECT id FROM bookings WHERE order_id = ? AND status = 'pending_payment'", [order.id]);
    for (const b of affected) {
      db.run("UPDATE bookings SET status = 'expired', payment_status = 'failed', hold_expires_at = NULL, updated_at = ? WHERE id = ?", [now(), b.id]);
      db.run('DELETE FROM booking_slots WHERE booking_id = ?', [b.id]);
    }
    db.run("UPDATE plans SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending_payment'", [now(), order.id]);
    return { status: 'expired' };
  }

  function onRefunded(order, evt) {
    if (order.status === 'refunded') return { status: 'already_refunded' };
    if (!['paid', 'refund_pending'].includes(order.status)) return { status: `ignored_${order.status}` };
    const amount = Number(evt.amount ?? order.total_cents);
    db.run("UPDATE orders SET status = ?, refunded_cents = ? WHERE id = ?", [amount >= order.total_cents ? 'refunded' : 'paid', amount, order.id]);
    db.run("UPDATE bookings SET payment_status = 'refunded', updated_at = ? WHERE order_id = ? AND payment_status IN ('refund_pending','paid')", [now(), order.id]);
    return { status: 'refunded', notify: [['payment.refunded', { orderId: order.id }]] };
  }

  async function refundOrder(order) {
    const p = payments();
    if (order.provider === 'manual') return { manual: true };
    if (!p.available || p.provider !== order.provider) return { manual: true };
    const amount = order.total_cents - (order.refunded_cents || 0);
    const r = await p.impl.refund(order, amount);
    if (r.immediate) {
      handleEvent({ provider: order.provider, id: `refund_${order.ref}_${order.refunded_cents || 0}`, type: 'refund.succeeded', orderRef: order.ref, amount: order.total_cents });
    }
    return { manual: false };
  }

  return {
    orderToken, verifyOrderToken, startCheckout, orderLinesFromItems,
    createBookingOrder, createBundleOrder, issueVoucher, issueManualVoucher, adjustVoucher,
    requestPlan, activatePlan, renewPlan, cancelPlan, planMaintenance, createRenewalOrder, fixedCapacityOk,
    createRequest, handleEvent, refundOrder, settingsCanSell,
  };
}
