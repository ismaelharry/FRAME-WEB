// Motor de reservas.
// - Disponibilidad calculada en el servidor (zona horaria Europe/Madrid).
// - Cada creación o cambio vuelve a comprobar la disponibilidad dentro de una
//   transacción BEGIN IMMEDIATE; además, la tabla booking_slots impide por clave
//   primaria que dos reservas ocupen el mismo recurso en la misma franja.
// - Los puestos de coworking son un inventario único compartido por pases, bonos,
//   días de prueba, mesa flexible y mesa fija.
import * as T from '../lib/time.js';
import { AppError, makeRef, normEmail, hmac, safeEqual } from '../lib/util.js';
import { isUniqueError } from '../db/index.js';
import { quoteProduct, conditionsFor } from './pricing.js';

export const ACTIVE = ['pending_payment', 'requested', 'confirmed'];
const ACTIVE_SQL = "('pending_payment','requested','confirmed')";
export const SLOT_MS = 15 * 60_000;
const H = 3_600_000;

export function createBookings(ctx) {
  const { db, catalog, settings } = ctx;
  const now = () => ctx.now();
  const pol = () => settings.get('policies');

  // ---------------------------------------------------------------- clientes
  function upsertCustomer({ email, name, phone, company, tax_id, lang, marketing }) {
    const e = normEmail(email);
    if (!e) throw new AppError('EMAIL_REQUIRED');
    const t = now();
    let c = db.get('SELECT * FROM customers WHERE email = ?', [e]);
    if (!c) {
      const r = db.run(`INSERT INTO customers (email, name, phone, company, tax_id, lang, marketing_opt_in, marketing_opt_in_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [e, name || null, phone || null, company || null, tax_id || null, lang || 'es', marketing ? 1 : 0, marketing ? t : null, t, t]);
      return db.get('SELECT * FROM customers WHERE id = ?', [r.lastInsertRowid]);
    }
    // Un formulario sin sesión solo completa datos vacíos: nunca sobrescribe los de otra persona.
    db.run(`UPDATE customers SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), company = COALESCE(company, ?),
      tax_id = COALESCE(tax_id, ?), marketing_opt_in = MAX(marketing_opt_in, ?),
      marketing_opt_in_at = CASE WHEN marketing_opt_in = 0 AND ? = 1 THEN ? ELSE marketing_opt_in_at END, updated_at = ? WHERE id = ?`,
    [name || null, phone || null, company || null, tax_id || null, marketing ? 1 : 0, marketing ? 1 : 0, t, t, c.id]);
    return db.get('SELECT * FROM customers WHERE id = ?', [c.id]);
  }

  // ------------------------------------------------------- enlaces de gestión
  function manageToken(ref, customer) {
    return hmac(ctx.cfg.secret, `booking:${ref}:${customer.link_version}`).slice(0, 32);
  }
  function findByManageToken(ref, token) {
    const b = db.get('SELECT * FROM bookings WHERE ref = ?', [String(ref || '').toUpperCase()]);
    if (!b) return null;
    const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
    return safeEqual(manageToken(b.ref, c), token) ? b : null;
  }

  // ------------------------------------------------- liberar bloqueos caducados
  function sweep() {
    const t = now();
    const expired = db.all(`SELECT * FROM bookings WHERE status IN ('pending_payment','requested')
      AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`, [t]);
    const expiredPlans = db.all(`SELECT * FROM plans WHERE status IN ('pending_payment')
      AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`, [t]);
    if (!expired.length && !expiredPlans.length) return [];
    db.tx(() => {
      for (const b of expired) {
        db.run("UPDATE bookings SET status = 'expired', payment_status = CASE WHEN payment_status = 'pending' THEN 'failed' ELSE payment_status END, updated_at = ? WHERE id = ?", [t, b.id]);
        db.run('DELETE FROM booking_slots WHERE booking_id = ?', [b.id]);
        if (b.usage === 'trial') db.run('DELETE FROM trials WHERE booking_id = ?', [b.id]);
        if (b.order_id) db.run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", [b.order_id]);
        audit('system', 'booking.expired', 'booking', b.ref);
      }
      for (const p of expiredPlans) {
        db.run("UPDATE plans SET status = 'cancelled', notes = COALESCE(notes || ' · ', '') || 'Pago no completado a tiempo', updated_at = ? WHERE id = ?", [t, p.id]);
        if (p.order_id) db.run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", [p.order_id]);
      }
    });
    for (const b of expired) if (b.status === 'requested') ctx.notify?.('booking.expired', { bookingId: b.id });
    return expired;
  }

  function audit(actor, action, entity, entityId, data) {
    db.run('INSERT INTO audit_log (actor, action, entity, entity_id, data, created_at) VALUES (?,?,?,?,?,?)',
      [actor, action, entity, entityId ?? null, data ? JSON.stringify(data) : null, now()]);
  }

  // ------------------------------------------------------------ validaciones
  function checkDate(date, { admin = false } = {}) {
    if (!T.isDate(date)) throw new AppError('INVALID_DATE');
    const today = T.todayLocal(now());
    if (date < today) throw new AppError('DATE_IN_PAST');
    if (!admin && T.diffDays(today, date) > pol().horizon_days) throw new AppError('DATE_TOO_FAR', 400, { days: pol().horizon_days });
  }

  // ---------------------------------------------------------- puestos (días)
  function fixedOnDate(date) {
    return db.get(`SELECT COUNT(*) AS n FROM plans WHERE plan_type = 'fixed' AND status IN ('active','past_due','pending_payment')
      AND start_date <= ? AND ((auto_renew = 1 AND cancel_at_period_end = 0) OR period_end IS NULL OR ? < period_end)`, [date, date]).n;
  }

  function deskInfo(date, { excludeBookingId = null } = {}) {
    const pool = catalog.deskPool();
    if (!pool || !pool.active) return { date, open: false, reason: 'closed', capacity: 0, free: 0 };
    const ranges = T.rangesFor(pool.hours, date);
    const [dayStart, dayEnd] = T.dayBoundsUtc(date);
    let open = ranges.length > 0;
    let reason = open ? null : 'closed_day';
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const openStart = open ? T.localToUtc(date, first[0]) : dayStart;
    const openEnd = open ? (last[1] === '24:00' ? dayEnd : T.localToUtc(date, last[1])) : dayEnd;
    const blocks = db.all('SELECT * FROM blocks WHERE (resource_id IS NULL OR resource_id = ?) AND start_utc < ? AND end_utc > ?', [pool.id, openEnd, openStart]);
    let blockedUnits = 0;
    let blockNote = null;
    for (const b of blocks) {
      if (b.resource_id === null || b.units === null) { open = false; reason = b.reason === 'holiday' ? 'holiday' : 'blocked'; blockNote = b.note; } else blockedUnits += b.units;
    }
    const fixed = fixedOnDate(date);
    const used = db.get(`SELECT COALESCE(SUM(people), 0) AS n FROM bookings WHERE resource_id = ? AND kind = 'desk_day'
      AND local_date = ? AND status IN ${ACTIVE_SQL} AND id <> ?`, [pool.id, date, excludeBookingId ?? -1]).n;
    const raw = pool.capacity - fixed - blockedUnits - used;
    let free = open ? Math.max(0, raw) : 0;
    // Hoy: solo si aún queda margen antes del cierre.
    if (open && date === T.todayLocal(now()) && now() + pol().min_notice_minutes * 60_000 > openEnd) { free = 0; reason = 'too_late'; }
    return { date, open, reason, note: blockNote, capacity: pool.capacity, fixed, blockedUnits, used, free, raw, hours: ranges, poolId: pool.id, openStart, openEnd };
  }

  function deskMonth(month) {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = T.todayLocal(now());
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = T.addDays(first, i);
      if (d < today || T.diffDays(today, d) > pol().horizon_days) { out.push({ date: d, open: false, free: 0, reason: 'out_of_range' }); continue; }
      const info = deskInfo(d);
      out.push({ date: d, open: info.open, free: info.free, capacity: info.capacity, reason: info.reason });
    }
    return out;
  }

  // ------------------------------------------------------ recursos por horas
  function unitsFor({ resourceSlug, group }) {
    if (group) return catalog.resourcesByGroup(group);
    const r = catalog.resource(resourceSlug);
    return r && r.active ? [r] : [];
  }

  function timedSlots({ units, date, duration, people = 1, excludeBookingId = null, admin = false }) {
    const t = now();
    const byTime = new Map();
    for (const r of units) {
      if (people > r.capacity) continue;
      const [ds, de] = T.dayBoundsUtc(date);
      const occ = new Set(db.all('SELECT slot_start FROM booking_slots WHERE resource_id = ? AND slot_start >= ? AND slot_start < ? AND booking_id <> ?',
        [r.id, ds - 6 * H, de + 30 * H, excludeBookingId ?? -1]).map((x) => x.slot_start));
      const blocks = db.all('SELECT start_utc, end_utc FROM blocks WHERE (resource_id IS NULL OR resource_id = ?) AND start_utc < ? AND end_utc > ?',
        [r.id, de + 30 * H, ds - 6 * H]);
      const buffer = (r.buffer_minutes || 0) * 60_000;
      for (const range of T.rangesFor(r.hours, date)) {
        const [o, c] = T.rangeMinutes(range);
        const closeUtc = c === 1440 ? de : T.localToUtc(date, T.minutesToTime(c));
        const step = Math.max(15, r.slot_minutes || 30);
        for (let m = o; m + duration <= c; m += step) {
          const time = T.minutesToTime(m);
          const start = T.localToUtc(date, time);
          if (start === null) continue;
          const end = start + duration * 60_000;
          if (end > closeUtc) continue;
          let entry = byTime.get(time);
          if (!entry) { entry = { time, start, end, units: [] }; byTime.set(time, entry); }
          let ok = admin ? start > t : start >= t + pol().min_notice_minutes * 60_000;
          if (ok) ok = !blocks.some((b) => b.start_utc < end && b.end_utc > start);
          if (ok) for (let s = start; s < end + buffer; s += SLOT_MS) if (occ.has(s)) { ok = false; break; }
          if (ok) entry.units.push(r.id);
        }
      }
    }
    return [...byTime.values()].sort((a, b) => a.start - b.start)
      .map((e) => ({ time: e.time, end_time: T.fmtTime(e.end), start: e.start, end: e.end, available: e.units.length > 0, free_units: e.units.length, units: e.units }));
  }

  function validateDuration(r, duration) {
    if (!Number.isInteger(duration) || duration % 15 !== 0) throw new AppError('INVALID_DURATION');
    if (duration < r.min_minutes || duration > r.max_minutes) throw new AppError('DURATION_OUT_OF_RANGE', 400, { min: r.min_minutes, max: r.max_minutes });
  }

  function claimSlots(bookingId, resourceId, start, end, bufferMin = 0) {
    try {
      for (let s = start; s < end + bufferMin * 60_000; s += SLOT_MS) {
        db.run('INSERT INTO booking_slots (resource_id, slot_start, booking_id) VALUES (?,?,?)', [resourceId, s, bookingId]);
      }
    } catch (e) {
      if (isUniqueError(e)) throw new AppError('SLOT_TAKEN', 409);
      throw e;
    }
  }

  function claimDays(bookingId, resourceId, fromDate, toDateExcl) {
    try {
      for (let d = fromDate; d < toDateExcl; d = T.addDays(d, 1)) {
        db.run('INSERT INTO booking_slots (resource_id, slot_start, booking_id) VALUES (?,?,?)', [resourceId, T.dayBoundsUtc(d)[0], bookingId]);
      }
    } catch (e) {
      if (isUniqueError(e)) throw new AppError('SLOT_TAKEN', 409);
      throw e;
    }
  }

  // ---------------------------------------------------------- modo de la operación
  function decideMode({ usage, resource, quote }) {
    if (usage === 'voucher' || usage === 'plan') return 'included';
    if (usage === 'trial') return settings.get('trial').requires_approval ? 'request' : 'free';
    if (usage === 'visit') return settings.get('visits').auto_confirm ? 'free' : 'request';
    if (usage === 'admin') return 'admin';
    if (resource.booking_mode !== 'instant' || !quote.priced) return 'request';
    if (quote.priced && quote.unit_price_cents === 0) return 'free';
    return quote.payable ? 'pay' : 'request';
  }

  function statusForMode(mode, start) {
    const t = now();
    switch (mode) {
      case 'pay': return { status: 'pending_payment', payment_status: 'pending', hold: t + pol().payment_hold_minutes * 60_000 };
      case 'request': return { status: 'requested', payment_status: 'none', hold: Math.min(start, t + pol().request_hold_hours * H) };
      case 'included': return { status: 'confirmed', payment_status: 'included', hold: null };
      default: return { status: 'confirmed', payment_status: 'none', hold: null };
    }
  }

  function insertBooking(row) {
    const t = now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const ref = makeRef('FR');
      try {
        const r = db.run(`INSERT INTO bookings (ref, customer_id, product_id, resource_id, kind, usage, status, payment_status, start_utc, end_utc,
          local_date, end_date, people, notes, unit_price_cents, quantity, subtotal_cents, tax_rate_bp, tax_cents, total_cents, price_final, conditions,
          voucher_id, plan_id, order_id, hold_expires_at, source, lang, admin_notes, created_at, updated_at, confirmed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ref, row.customer_id, row.product_id ?? null, row.resource_id, row.kind, row.usage, row.status, row.payment_status,
          row.start_utc, row.end_utc, row.local_date, row.end_date ?? null, row.people, row.notes ?? null,
          row.unit_price_cents ?? null, row.quantity ?? null, row.subtotal_cents ?? null, row.tax_rate_bp ?? null, row.tax_cents ?? null, row.total_cents ?? null,
          row.price_final ? 1 : 0, row.conditions ?? null, row.voucher_id ?? null, row.plan_id ?? null, row.order_id ?? null, row.hold_expires_at ?? null,
          row.source || 'web', row.lang || 'es', row.admin_notes ?? null, t, t, row.status === 'confirmed' ? t : null]);
        return db.get('SELECT * FROM bookings WHERE id = ?', [r.lastInsertRowid]);
      } catch (e) {
        if (isUniqueError(e) && /bookings\.ref/.test(e.message)) continue;
        throw e;
      }
    }
    throw new AppError('REF_COLLISION', 500);
  }

  function voucherBalance(voucherId) {
    return db.get('SELECT COALESCE(SUM(delta), 0) AS n FROM voucher_ledger WHERE voucher_id = ?', [voucherId]).n;
  }

  function activeFlexPlan(customerId, date) {
    return db.get(`SELECT * FROM plans WHERE customer_id = ? AND plan_type = 'flex' AND status IN ('active') AND start_date <= ?
      AND ((auto_renew = 1 AND cancel_at_period_end = 0) OR ? < period_end) ORDER BY id DESC LIMIT 1`, [customerId, date, date]);
  }

  // ---------------------------------------------------------------- crear (día)
  // usage: pass | voucher | plan | trial | admin
  function createDeskDay(input) {
    const { usage, date, lang = 'es' } = input;
    const people = Number(input.people || 1);
    const admin = usage === 'admin';
    sweep();
    return db.tx(() => {
      checkDate(date, { admin });
      const pool = catalog.deskPool();
      const productSlug = usage === 'trial' ? 'dia-prueba' : 'pase-dia';
      const product = catalog.product(productSlug);
      if (!product || (!product.active && !admin)) throw new AppError('PRODUCT_UNAVAILABLE');
      if (!Number.isInteger(people) || people < 1) throw new AppError('INVALID_PEOPLE');
      const maxPeople = usage === 'pass' ? product.max_quantity : (usage === 'voucher' ? 4 : (admin ? pool.capacity : 1));
      if (people > maxPeople) throw new AppError('TOO_MANY_PEOPLE', 400, { max: maxPeople });

      const customer = input.customerId ? db.get('SELECT * FROM customers WHERE id = ?', [input.customerId]) : upsertCustomer({ ...input.customer, lang });
      if (!customer) throw new AppError('CUSTOMER_REQUIRED', 401);

      let voucher = null; let plan = null;
      if (usage === 'voucher') {
        voucher = db.get('SELECT * FROM vouchers WHERE id = ? AND customer_id = ?', [input.voucherId, customer.id]);
        if (!voucher || voucher.status !== 'active') throw new AppError('VOUCHER_NOT_FOUND', 404);
        if (voucher.expires_on && date > voucher.expires_on) throw new AppError('VOUCHER_EXPIRED_FOR_DATE', 400, { expires: voucher.expires_on });
        if (voucherBalance(voucher.id) < people) throw new AppError('VOUCHER_NO_BALANCE', 409);
      }
      if (usage === 'plan') {
        plan = activeFlexPlan(customer.id, date);
        if (!plan) throw new AppError('NO_ACTIVE_PLAN', 403);
        const dup = db.get(`SELECT id FROM bookings WHERE plan_id = ? AND local_date = ? AND status IN ${ACTIVE_SQL}`, [plan.id, date]);
        if (dup) throw new AppError('ALREADY_BOOKED_DAY', 409);
      }
      if (usage === 'trial') {
        const tr = settings.get('trial');
        if (!tr.enabled) throw new AppError('TRIAL_DISABLED');
        if (!tr.weekdays.includes(T.weekdayOf(date))) throw new AppError('TRIAL_DAY_NOT_ALLOWED');
        if (T.localToUtc(date, '00:00') - now() < tr.min_notice_hours * H) throw new AppError('TRIAL_NOTICE', 400, { hours: tr.min_notice_hours });
        const prior = db.get('SELECT 1 FROM trials WHERE email = ?', [customer.email]);
        const member = db.get("SELECT 1 FROM bookings WHERE customer_id = ? AND status = 'confirmed' AND usage IN ('pass','voucher','plan') LIMIT 1", [customer.id]);
        if (prior || member) throw new AppError('TRIAL_ALREADY_USED', 409);
      }

      const info = deskInfo(date);
      if (!info.open) throw new AppError(info.reason === 'holiday' ? 'CLOSED_HOLIDAY' : 'CLOSED', 409);
      if (info.free < people) throw new AppError(info.free === 0 ? 'NO_AVAILABILITY' : 'NOT_ENOUGH_DESKS', 409, { free: info.free });

      const quote = usage === 'pass' ? quoteProduct(ctx, product, { quantity: people }) : quoteProduct(ctx, { ...product, price_cents: 0 }, { quantity: people });
      const mode = admin ? 'admin' : decideMode({ usage, resource: pool, quote });
      const st = admin ? { status: input.status || 'confirmed', payment_status: input.payment_status || 'none', hold: input.status === 'requested' ? info.openStart : null }
        : statusForMode(mode, info.openStart);
      if (mode === 'request' && quote.priced && quote.unit_price_cents > 0) st.payment_status = 'unpaid';
      const [start, end] = T.dayBoundsUtc(date);
      const booking = insertBooking({
        customer_id: customer.id, product_id: product.id, resource_id: pool.id, kind: 'desk_day', usage, people,
        status: st.status, payment_status: st.payment_status, hold_expires_at: st.hold,
        start_utc: start, end_utc: end, local_date: date, notes: input.notes, lang, source: admin ? 'admin' : 'web',
        voucher_id: voucher?.id, plan_id: plan?.id, admin_notes: input.adminNotes,
        unit_price_cents: quote.unit_price_cents, quantity: people, subtotal_cents: quote.subtotal_cents,
        tax_rate_bp: quote.tax_rate_bp, tax_cents: quote.tax_cents, total_cents: quote.total_cents, price_final: quote.price_final,
        conditions: conditionsFor(ctx, { product, resource: pool, usage, mode, lang }),
      });
      if (voucher) {
        db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, booking_id, actor, created_at) VALUES (?,?,'use',?,?,?)",
          [voucher.id, -people, booking.id, `customer:${customer.id}`, now()]);
      }
      if (usage === 'trial') {
        try { db.run('INSERT INTO trials (email, booking_id, created_at) VALUES (?,?,?)', [customer.email, booking.id, now()]); } catch (e) {
          if (isUniqueError(e)) throw new AppError('TRIAL_ALREADY_USED', 409);
          throw e;
        }
      }
      // Comprobación final dentro de la misma transacción: nunca más puestos que el inventario.
      if (deskInfo(date).raw < 0) throw new AppError('NO_AVAILABILITY', 409);
      audit(admin ? `admin:${input.actorId}` : `customer:${customer.id}`, 'booking.created', 'booking', booking.ref, { usage, date, people, status: booking.status });
      return { booking, customer, mode, quote };
    });
  }

  // -------------------------------------------------------- crear (por horas)
  // usage: hourly | visit | admin
  function createTimed(input) {
    const { usage, date, time, lang = 'es' } = input;
    const people = Number(input.people || 1);
    const admin = usage === 'admin';
    sweep();
    return db.tx(() => {
      checkDate(date, { admin });
      if (!T.isTime(time)) throw new AppError('INVALID_TIME');
      let units = unitsFor({ resourceSlug: input.resource, group: input.group });
      if (!units.length) throw new AppError('RESOURCE_NOT_FOUND', 404);
      if (units[0].kind === 'desk_pool' || units[0].kind === 'office') throw new AppError('WRONG_RESOURCE');
      if (usage === 'visit' && units[0].kind !== 'tour') throw new AppError('WRONG_RESOURCE');
      if (usage === 'hourly' && units[0].kind === 'tour') throw new AppError('WRONG_RESOURCE');
      const product = catalog.product(units[0].product_slug);
      if (!admin && (!product || !product.active)) throw new AppError('PRODUCT_UNAVAILABLE');
      if (!admin && units[0].booking_mode === 'quote') throw new AppError('QUOTE_ONLY');
      const duration = usage === 'visit' ? units[0].min_minutes : Number(input.duration);
      validateDuration(units[0], duration);
      if (!Number.isInteger(people) || people < 1) throw new AppError('INVALID_PEOPLE');
      const maxCap = Math.max(...units.map((u) => u.capacity));
      const maxPeople = usage === 'visit' ? Math.min(maxCap, settings.get('visits').max_people) : maxCap;
      if (people > maxPeople) throw new AppError('TOO_MANY_PEOPLE', 400, { max: maxPeople });
      if (usage === 'visit' && !settings.get('visits').enabled) throw new AppError('VISITS_DISABLED');

      const slot = timedSlots({ units, date, duration, people, admin }).find((s) => s.time === time);
      if (!slot) throw new AppError('TIME_NOT_ENABLED', 400);
      if (!slot.available) throw new AppError('SLOT_TAKEN', 409);
      const unit = units.find((u) => u.id === slot.units[0]);

      const customer = input.customerId ? db.get('SELECT * FROM customers WHERE id = ?', [input.customerId]) : upsertCustomer({ ...input.customer, lang });
      if (!customer) throw new AppError('CUSTOMER_REQUIRED', 401);

      const quote = quoteProduct(ctx, product, { minutes: duration });
      const mode = admin ? 'admin' : decideMode({ usage, resource: unit, quote });
      const st = admin ? { status: input.status || 'confirmed', payment_status: input.payment_status || 'none', hold: input.status === 'requested' ? slot.start : null }
        : statusForMode(mode, slot.start);
      const booking = insertBooking({
        customer_id: customer.id, product_id: product?.id, resource_id: unit.id, kind: usage === 'visit' || unit.kind === 'tour' ? 'visit' : 'hourly',
        usage: admin ? 'admin' : usage, people, status: st.status, payment_status: mode === 'request' && quote.priced && quote.unit_price_cents > 0 ? 'unpaid' : st.payment_status,
        hold_expires_at: st.hold, start_utc: slot.start, end_utc: slot.end, local_date: date, notes: input.notes, lang,
        source: admin ? 'admin' : 'web', admin_notes: input.adminNotes,
        unit_price_cents: quote.unit_price_cents, quantity: quote.quantity, subtotal_cents: quote.subtotal_cents,
        tax_rate_bp: quote.tax_rate_bp, tax_cents: quote.tax_cents, total_cents: quote.total_cents, price_final: quote.price_final,
        conditions: conditionsFor(ctx, { product, resource: unit, usage, mode, lang }),
      });
      claimSlots(booking.id, unit.id, slot.start, slot.end, unit.buffer_minutes);
      audit(admin ? `admin:${input.actorId}` : `customer:${customer.id}`, 'booking.created', 'booking', booking.ref, { resource: unit.slug, date, time, duration, status: booking.status });
      return { booking, customer, mode, quote, resource: unit };
    });
  }

  // ------------------------------------------------- despachos (administración)
  function createOfficeLease(input) {
    sweep();
    return db.tx(() => {
      const r = catalog.resource(input.resource);
      if (!r || r.kind !== 'office') throw new AppError('RESOURCE_NOT_FOUND', 404);
      if (!T.isDate(input.from) || !T.isDate(input.to) || input.to <= input.from) throw new AppError('INVALID_DATE');
      const customer = input.customerId ? db.get('SELECT * FROM customers WHERE id = ?', [input.customerId]) : upsertCustomer(input.customer);
      const [start] = T.dayBoundsUtc(input.from);
      const [end] = T.dayBoundsUtc(input.to);
      const booking = insertBooking({
        customer_id: customer.id, product_id: catalog.product('despacho')?.id, resource_id: r.id, kind: 'office', usage: 'office',
        people: Number(input.people || 1), status: input.status || 'confirmed', payment_status: input.payment_status || 'offline',
        start_utc: start, end_utc: end, local_date: input.from, end_date: input.to, notes: input.notes, source: 'admin', lang: customer.lang,
        admin_notes: input.adminNotes, total_cents: input.total_cents ?? null, price_final: input.total_cents != null,
      });
      claimDays(booking.id, r.id, input.from, input.to);
      audit(`admin:${input.actorId}`, 'booking.created', 'booking', booking.ref, { office: r.slug, from: input.from, to: input.to });
      return { booking, customer, resource: r };
    });
  }

  // ------------------------------------------------------------------ cambiar
  function change(bookingId, input, { actor = 'customer', actorId } = {}) {
    sweep();
    return db.tx(() => {
      const b = db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!b) throw new AppError('NOT_FOUND', 404);
      if (!['requested', 'confirmed'].includes(b.status)) throw new AppError('NOT_CHANGEABLE', 409);
      const isAdmin = actor === 'admin';
      if (!isAdmin && b.start_utc - now() < pol().modify_min_hours * H) throw new AppError('CHANGE_WINDOW_CLOSED', 409, { hours: pol().modify_min_hours });
      const paid = ['paid', 'refund_pending'].includes(b.payment_status);
      const date = input.date || b.local_date;
      checkDate(date, { admin: isAdmin });
      const people = Number(input.people || b.people);
      if ((paid || b.usage === 'voucher') && people !== b.people && !isAdmin) throw new AppError('PRICE_CHANGE_NOT_ALLOWED', 409);
      const t = now();

      if (b.kind === 'desk_day') {
        const info = deskInfo(date, { excludeBookingId: b.id });
        if (!info.open) throw new AppError('CLOSED', 409);
        if (info.free < people) throw new AppError('NO_AVAILABILITY', 409, { free: info.free });
        if (b.usage === 'voucher' && people !== b.people) {
          const diff = people - b.people;
          db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, note, actor, created_at) VALUES (?,?,'adjust',?,?,?)", [b.voucher_id, -diff, `Cambio de personas en ${b.ref}`, `${actor}:${actorId ?? ''}`, t]);
        }
        const [start, end] = T.dayBoundsUtc(date);
        const product = catalog.productById(b.product_id);
        const q = !paid && b.usage === 'pass' ? quoteProduct(ctx, product, { quantity: people }) : null;
        db.run(`UPDATE bookings SET local_date = ?, start_utc = ?, end_utc = ?, people = ?, updated_at = ?,
          hold_expires_at = CASE WHEN status = 'requested' THEN ? ELSE hold_expires_at END
          ${q ? ', quantity = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?' : ''} WHERE id = ?`,
        q ? [date, start, end, people, t, Math.min(start, t + pol().request_hold_hours * H), q.quantity, q.subtotal_cents, q.tax_cents, q.total_cents, b.id]
          : [date, start, end, people, t, Math.min(start, t + pol().request_hold_hours * H), b.id]);
      } else if (b.kind === 'hourly' || b.kind === 'visit') {
        const r = catalog.resourceById(b.resource_id);
        const duration = input.duration ? Number(input.duration) : Math.round((b.end_utc - b.start_utc) / 60_000);
        if (paid && !isAdmin && duration !== Math.round((b.end_utc - b.start_utc) / 60_000)) throw new AppError('PRICE_CHANGE_NOT_ALLOWED', 409);
        validateDuration(r, duration);
        if (people > r.capacity) throw new AppError('TOO_MANY_PEOPLE', 400, { max: r.capacity });
        const time = input.time || T.fmtTime(b.start_utc);
        // Puede cambiar a otra unidad del mismo grupo (p. ej. otra cabina).
        const units = r.group_slug ? catalog.resourcesByGroup(r.group_slug) : [r];
        const slot = timedSlots({ units, date, duration, people, excludeBookingId: b.id, admin: isAdmin }).find((s) => s.time === time);
        if (!slot) throw new AppError('TIME_NOT_ENABLED');
        if (!slot.available) throw new AppError('SLOT_TAKEN', 409);
        const unitId = slot.units.includes(r.id) ? r.id : slot.units[0];
        const unit = units.find((u) => u.id === unitId);
        db.run('DELETE FROM booking_slots WHERE booking_id = ?', [b.id]);
        claimSlots(b.id, unit.id, slot.start, slot.end, unit.buffer_minutes);
        const product = catalog.productById(b.product_id);
        const q = !paid ? quoteProduct(ctx, product, { minutes: duration }) : null;
        db.run(`UPDATE bookings SET resource_id = ?, local_date = ?, start_utc = ?, end_utc = ?, people = ?, updated_at = ?,
          hold_expires_at = CASE WHEN status = 'requested' THEN ? ELSE hold_expires_at END
          ${q && q.priced ? ', quantity = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?' : ''} WHERE id = ?`,
        q && q.priced ? [unit.id, date, slot.start, slot.end, people, t, Math.min(slot.start, t + pol().request_hold_hours * H), q.quantity, q.subtotal_cents, q.tax_cents, q.total_cents, b.id]
          : [unit.id, date, slot.start, slot.end, people, t, Math.min(slot.start, t + pol().request_hold_hours * H), b.id]);
      } else {
        throw new AppError('NOT_CHANGEABLE', 409);
      }
      audit(`${actor}:${actorId ?? b.customer_id}`, 'booking.changed', 'booking', b.ref, { from: { date: b.local_date, start: b.start_utc }, to: input });
      return db.get('SELECT * FROM bookings WHERE id = ?', [b.id]);
    });
  }

  // ----------------------------------------------------------------- cancelar
  // Devuelve { booking, refund: 'none'|'credit'|'payment', order }
  function cancel(bookingId, { actor = 'customer', actorId, reason = null, forceRefund = null } = {}) {
    sweep();
    return db.tx(() => {
      const b = db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!b) throw new AppError('NOT_FOUND', 404);
      if (!ACTIVE.includes(b.status)) throw new AppError('NOT_CANCELLABLE', 409);
      const isAdmin = actor === 'admin';
      const t = now();
      if (!isAdmin && b.end_utc <= t) throw new AppError('ALREADY_STARTED', 409);
      if (!isAdmin && b.start_utc <= t && b.kind !== 'desk_day') throw new AppError('ALREADY_STARTED', 409);
      const inWindow = b.start_utc - t >= pol().cancel_free_hours * H;
      const refundable = forceRefund ?? (inWindow || pol().late_cancel_refund);
      let refund = 'none';
      db.run('UPDATE bookings SET status = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ?, hold_expires_at = NULL WHERE id = ?',
        [isAdmin && reason === 'rejected' ? 'rejected' : 'cancelled', t, reason, t, b.id]);
      db.run('DELETE FROM booking_slots WHERE booking_id = ?', [b.id]);
      if (b.usage === 'trial') db.run('DELETE FROM trials WHERE booking_id = ?', [b.id]);
      if (b.usage === 'voucher' && b.voucher_id && refundable) {
        db.run("INSERT INTO voucher_ledger (voucher_id, delta, reason, booking_id, actor, created_at) VALUES (?,?,'refund',?,?,?)",
          [b.voucher_id, b.people, b.id, `${actor}:${actorId ?? b.customer_id}`, t]);
        refund = 'credit';
      }
      let order = null;
      if (b.order_id) {
        order = db.get('SELECT * FROM orders WHERE id = ?', [b.order_id]);
        if (order.status === 'pending') {
          db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
          db.run("UPDATE bookings SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'", [b.id]);
        } else if (order.status === 'paid' && refundable) {
          db.run("UPDATE orders SET status = 'refund_pending' WHERE id = ?", [order.id]);
          db.run("UPDATE bookings SET payment_status = 'refund_pending' WHERE id = ?", [b.id]);
          refund = 'payment';
        }
      }
      audit(`${actor}:${actorId ?? b.customer_id}`, 'booking.cancelled', 'booking', b.ref, { reason, refund });
      return { booking: db.get('SELECT * FROM bookings WHERE id = ?', [b.id]), refund, order };
    });
  }

  // --------------------------------------------------- confirmar (administración)
  function confirm(bookingId, { actorId, payment_status } = {}) {
    sweep();
    return db.tx(() => {
      const b = db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!b) throw new AppError('NOT_FOUND', 404);
      if (b.status !== 'requested') throw new AppError('NOT_CONFIRMABLE', 409);
      const t = now();
      db.run(`UPDATE bookings SET status = 'confirmed', confirmed_at = ?, hold_expires_at = NULL, updated_at = ?,
        payment_status = COALESCE(?, payment_status) WHERE id = ?`, [t, t, payment_status ?? null, b.id]);
      audit(`admin:${actorId}`, 'booking.confirmed', 'booking', b.ref);
      return db.get('SELECT * FROM bookings WHERE id = ?', [b.id]);
    });
  }

  return {
    upsertCustomer, manageToken, findByManageToken, sweep, audit,
    deskInfo, deskMonth, timedSlots, unitsFor, fixedOnDate, voucherBalance, activeFlexPlan,
    createDeskDay, createTimed, createOfficeLease, change, cancel, confirm, claimSlots, checkDate,
  };
}
