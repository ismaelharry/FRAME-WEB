// API JSON pública: disponibilidad, presupuestos de la operación y reservas.
// Toda la lógica de precios, capacidad y permisos se resuelve aquí, en el servidor.
import * as T from '../lib/time.js';
import { AppError, money } from '../lib/util.js';
import { V, z, parse } from '../lib/validate.js';
import { verifyCsrf, clientIp } from '../lib/security.js';
import { errorMessage, UI } from '../i18n/ui.js';
import { path } from '../i18n/routes.js';
import { bookingServices, commercePublic } from '../services/services-map.js';
import { quoteProduct, conditionsFor } from '../services/pricing.js';

export function apiRoutes(app, ctx) {
  const { bookings, commerce, catalog, settings, limiter } = ctx;

  const limit = (bucket, max, windowMs) => (req, res, next) => {
    if (!limiter.take(`${bucket}:${clientIp(req)}`, max, windowMs)) throw new AppError('RATE_LIMITED', 429);
    next();
  };
  const csrf = (req, res, next) => {
    if (!verifyCsrf(req, res.locals.csrfPublic)) throw new AppError('CSRF', 403);
    next();
  };
  const langOf = (req) => (req.body?.lang === 'en' || req.query?.lang === 'en' ? 'en' : 'es');

  // Token CSRF para clientes JavaScript del mismo origen (no se expone a otros sitios: sin CORS).
  app.get('/api/csrf', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ csrf: res.locals.csrfPublic });
  });

  // ------------------------------------------------------------------ catálogo
  app.get('/api/catalog', limit('read', 240, 60_000), (req, res) => {
    const lang = langOf(req);
    const pol = settings.get('policies');
    let vouchers = [];
    let flexPlan = null;
    if (req.customer) {
      vouchers = ctx.db.all("SELECT v.*, (SELECT COALESCE(SUM(delta),0) FROM voucher_ledger WHERE voucher_id = v.id) AS balance FROM vouchers v WHERE customer_id = ? AND status = 'active' ORDER BY expires_on", [req.customer.id])
        .filter((v) => v.balance > 0 && (!v.expires_on || v.expires_on >= T.todayLocal(ctx.now())))
        .map((v) => ({ id: v.id, code: v.code, balance: v.balance, expires_on: v.expires_on }));
      flexPlan = bookings.activeFlexPlan(req.customer.id, T.todayLocal(ctx.now())) ? true : false;
    }
    res.json({
      lang,
      today: T.todayLocal(ctx.now()),
      horizonDays: pol.horizon_days,
      services: bookingServices(ctx, lang, { customer: req.customer }),
      commerce: commercePublic(ctx),
      customer: req.customer ? { name: req.customer.name, email: req.customer.email, phone: req.customer.phone, vouchers, flexPlan } : null,
      ui: UI[lang],
    });
  });

  // ----------------------------------------------------------- disponibilidad
  app.get('/api/availability/desks', limit('read', 240, 60_000), (req, res) => {
    const month = String(req.query.month || T.todayLocal(ctx.now()).slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError('INVALID_DATE');
    res.json({ month, days: bookings.deskMonth(month) });
  });

  app.get('/api/availability/desk', limit('read', 240, 60_000), (req, res) => {
    const date = String(req.query.date || '');
    if (!T.isDate(date)) throw new AppError('INVALID_DATE');
    const info = bookings.deskInfo(date);
    res.json({ date, open: info.open, free: info.free, capacity: info.capacity, reason: info.reason, note: info.note });
  });

  app.get('/api/availability/slots', limit('read', 240, 60_000), (req, res) => {
    const q = parse(z.object({
      resource: z.string().max(60).optional(), group: z.string().max(60).optional(),
      date: V.date, duration: V.int(15, 1440), people: V.int(1, 50).default(1),
    }), req.query);
    if (!T.isDate(q.date)) throw new AppError('INVALID_DATE');
    const units = bookings.unitsFor({ resourceSlug: q.resource, group: q.group });
    if (!units.length || ['desk_pool', 'office'].includes(units[0].kind)) throw new AppError('RESOURCE_NOT_FOUND', 404);
    bookings.sweep();
    const today = T.todayLocal(ctx.now());
    const tooFar = T.diffDays(today, q.date) > settings.get('policies').horizon_days;
    const slots = q.date < today || tooFar ? [] : bookings.timedSlots({ units, date: q.date, duration: q.duration, people: q.people });
    res.json({
      date: q.date, duration: q.duration, people: q.people,
      slots: slots.map((s) => ({ time: s.time, end: s.end_time, available: s.available, free: s.free_units })),
      reason: q.date < today ? 'DATE_IN_PAST' : tooFar ? 'DATE_TOO_FAR' : (slots.length ? null : 'CLOSED'),
    });
  });

  // ---------------------------------------------------- resumen previo (revisión)
  const quoteSchema = z.object({
    service: z.enum(['pass', 'trial', 'voucher', 'flex', 'room', 'booth', 'studio', 'visit', 'bundle', 'plan-flex', 'plan-fixed', 'plan-virtual']),
    resource: z.string().max(60).optional(), date: V.date.optional(), time: V.time.optional(),
    duration: V.int(15, 1440).optional(), people: V.int(1, 50).default(1), lang: V.lang,
  });

  app.post('/api/quote', limit('read', 240, 60_000), csrf, (req, res) => {
    const q = parse(quoteSchema, req.body);
    const lang = q.lang;
    const es = lang !== 'en';
    const ui = UI[lang].booking;
    let product; let resource; let usage; let mode; let quote;
    const deskUsage = { pass: 'pass', trial: 'trial', voucher: 'voucher', flex: 'plan' };
    if (deskUsage[q.service]) {
      usage = deskUsage[q.service];
      product = catalog.product(q.service === 'trial' ? 'dia-prueba' : 'pase-dia');
      resource = catalog.deskPool();
      quote = usage === 'pass' ? quoteProduct(ctx, product, { quantity: q.people }) : quoteProduct(ctx, { ...product, price_cents: 0 }, { quantity: q.people });
      mode = usage === 'voucher' || usage === 'plan' ? 'included' : usage === 'trial' ? (settings.get('trial').requires_approval ? 'request' : 'free') : (quote.payable ? 'pay' : 'request');
    } else if (['room', 'booth', 'studio', 'visit'].includes(q.service)) {
      const units = q.service === 'booth' ? catalog.resourcesByGroup('cabinas') : [catalog.resource(q.resource)].filter(Boolean);
      if (!units.length) throw new AppError('RESOURCE_NOT_FOUND', 404);
      resource = units[0];
      product = catalog.product(resource.product_slug);
      usage = q.service === 'visit' ? 'visit' : 'hourly';
      const minutes = q.service === 'visit' ? resource.min_minutes : (q.duration || resource.min_minutes);
      quote = quoteProduct(ctx, product, { minutes });
      mode = usage === 'visit' ? (settings.get('visits').auto_confirm ? 'free' : 'request')
        : (resource.booking_mode !== 'instant' || !quote.priced ? 'request' : quote.payable ? 'pay' : 'request');
    } else if (q.service === 'bundle') {
      product = catalog.product('bono-10'); usage = 'bundle_purchase';
      quote = quoteProduct(ctx, product, { quantity: 1 }); mode = quote.payable ? 'pay' : 'request';
    } else {
      product = catalog.product({ 'plan-flex': 'mesa-flexible', 'plan-fixed': 'mesa-fija', 'plan-virtual': 'oficina-virtual' }[q.service]); usage = 'plan_purchase';
      quote = quoteProduct(ctx, product, { quantity: 1 }); mode = quote.payable ? 'pay' : 'request';
    }
    const lines = [];
    if (quote.priced && quote.unit_price_cents > 0 && !['included'].includes(mode)) {
      lines.push([ui.base, money(quote.subtotal_cents, lang, { decimals: 2 })]);
      if (quote.price_final) lines.push([`${settings.get('commerce').tax_label} ${(quote.tax_rate_bp / 100).toLocaleString(es ? 'es-ES' : 'en-GB')} %`, money(quote.tax_cents, lang, { decimals: 2 })]);
    }
    let totalLabel;
    if (mode === 'included') totalLabel = ui.included;
    else if (!quote.priced) totalLabel = ui.quote;
    else if (quote.unit_price_cents === 0) totalLabel = ui.free_price;
    else if (quote.price_final) totalLabel = money(quote.total_cents, lang, { decimals: 2 });
    else totalLabel = `${money(quote.subtotal_cents, lang, { decimals: 2 })} + ${es ? 'IVA' : 'VAT'}`;
    res.json({
      mode,
      lines,
      total: totalLabel,
      totalNote: mode === 'pay' ? ui.pay_note : (quote.priced && !quote.price_final && quote.unit_price_cents > 0 ? `${ui.indicative}. ${ui.no_charge}` : ui.no_charge),
      button: mode === 'pay' ? ui.pay.replace('{amount}', money(quote.total_cents, lang, { decimals: 2 })) : mode === 'request' ? ui.send_request : ui.confirm_free,
      conditions: conditionsFor(ctx, { product, resource, usage, mode, lang }),
      testMode: mode === 'pay' && ctx.payments.testMode,
    });
  });

  // ------------------------------------------------------------------ reservar
  const personSchema = {
    name: V.name.optional(), email: V.email.optional(), phone: V.phone, company: V.optText(120), tax_id: V.optText(30),
    notes: V.optText(800), accept: V.bool, marketing: V.bool.optional(), lang: V.lang,
  };
  const bookingSchema = z.object({
    service: z.enum(['pass', 'trial', 'voucher', 'flex', 'room', 'booth', 'studio', 'visit']),
    resource: z.string().max(60).optional(), date: V.date, time: V.time.optional(),
    duration: V.int(15, 1440).optional(), people: V.int(1, 50).default(1), voucherId: V.int(1, 1e9).optional(),
    ...personSchema,
  });

  function customerInput(req, b) {
    if (req.customer) return { customerId: req.customer.id };
    if (!b.email || !b.name) throw new AppError('VALIDATION', 400, { fields: { ...(b.email ? {} : { email: 'required' }), ...(b.name ? {} : { name: 'required' }) } });
    return { customer: { name: b.name, email: b.email, phone: b.phone, company: b.company, tax_id: b.tax_id, marketing: b.marketing } };
  }

  function manageUrl(booking, customer) {
    return `${path('manage', booking.lang, `/${booking.ref}`)}?t=${bookings.manageToken(booking.ref, customer)}`;
  }

  app.post('/api/bookings', limit('book', 30, 10 * 60_000), csrf, async (req, res) => {
    const b = parse(bookingSchema, req.body);
    if (!b.accept) throw new AppError('TERMS_REQUIRED');
    const who = customerInput(req, b);
    const base = { date: b.date, people: b.people, notes: b.notes, lang: b.lang, ...who };
    let result;
    switch (b.service) {
      case 'pass': result = bookings.createDeskDay({ ...base, usage: 'pass' }); break;
      case 'trial': result = bookings.createDeskDay({ ...base, usage: 'trial', people: 1 }); break;
      case 'voucher':
        if (!req.customer) throw new AppError('CUSTOMER_REQUIRED', 401);
        result = bookings.createDeskDay({ ...base, usage: 'voucher', voucherId: b.voucherId }); break;
      case 'flex':
        if (!req.customer) throw new AppError('CUSTOMER_REQUIRED', 401);
        result = bookings.createDeskDay({ ...base, usage: 'plan', people: 1 }); break;
      case 'room': case 'studio': case 'visit':
        result = bookings.createTimed({ ...base, usage: b.service === 'visit' ? 'visit' : 'hourly', resource: b.resource, time: b.time, duration: b.duration }); break;
      case 'booth':
        result = bookings.createTimed({ ...base, usage: 'hourly', group: 'cabinas', time: b.time, duration: b.duration }); break;
      default: throw new AppError('VALIDATION');
    }
    const { booking, customer, mode } = result;
    const url = manageUrl(booking, customer);
    if (mode === 'pay') {
      const order = commerce.createBookingOrder(booking);
      const abs = `${ctx.cfg.baseUrl}${url}`;
      const redirect = await commerce.startCheckout(order, {
        lines: commerce.orderLinesFromItems(order), email: customer.email, lang: b.lang,
        successUrl: `${abs}&pago=ok`, cancelUrl: `${abs}&pago=cancelado`,
      });
      return res.status(201).json({ ref: booking.ref, status: booking.status, mode, redirect, manageUrl: url });
    }
    ctx.notify(mode === 'request' ? 'booking.requested' : 'booking.confirmed', { bookingId: booking.id });
    res.status(201).json({ ref: booking.ref, status: booking.status, mode, manageUrl: url, redirect: url });
  });

  // ------------------------------------------------------- compras: bono y planes
  const purchaseSchema = z.object({
    product: z.string().max(40), start_date: V.date.optional(), ...personSchema,
  });

  app.post('/api/purchases', limit('book', 30, 10 * 60_000), csrf, async (req, res) => {
    const b = parse(purchaseSchema, req.body);
    if (!b.accept) throw new AppError('TERMS_REQUIRED');
    const product = catalog.product(b.product);
    if (!product || !['bundle', 'plan'].includes(product.kind)) throw new AppError('PRODUCT_UNAVAILABLE');
    const who = req.customer ? { email: req.customer.email, name: req.customer.name } : customerInput(req, b).customer;
    const customer = { ...who, phone: b.phone, company: b.company, tax_id: b.tax_id, marketing: b.marketing };
    if (product.kind === 'bundle') {
      const r = commerce.createBundleOrder({ customer, productSlug: product.slug, lang: b.lang });
      if (r.mode === 'request') {
        ctx.notify('mail', { to: ctx.cfg.notifyTo, kind: 'admin.request', ref: r.request.ref, content: { subject: `Solicitud de bono ${r.request.ref}`, title: `Solicitud de bono ${r.request.ref}`, intro: `${customer.name || customer.email} quiere comprar ${product.name_es}.`, rows: [['Correo', r.customer.email], ['Teléfono', b.phone || '—']] } });
        ackRequest(r.request, b.lang);
        return res.status(201).json({ mode: 'request', ref: r.request.ref });
      }
      const token = commerce.orderToken(r.order.ref);
      const back = `${ctx.cfg.baseUrl}/pedido/${r.order.ref}?t=${token}`;
      const redirect = await commerce.startCheckout(r.order, { lines: commerce.orderLinesFromItems(r.order), email: r.customer.email, lang: b.lang, successUrl: `${back}&pago=ok`, cancelUrl: `${back}&pago=cancelado` });
      return res.status(201).json({ mode: 'pay', ref: r.order.ref, redirect });
    }
    if (!b.start_date) throw new AppError('VALIDATION', 400, { fields: { start_date: 'required' } });
    const r = commerce.requestPlan({ customer, productSlug: product.slug, startDate: b.start_date, lang: b.lang, notes: b.notes });
    if (r.mode === 'request') {
      ctx.notify('plan.requested', { planId: r.plan.id });
      return res.status(201).json({ mode: 'request', ref: r.plan.ref });
    }
    const token = commerce.orderToken(r.order.ref);
    const back = `${ctx.cfg.baseUrl}/pedido/${r.order.ref}?t=${token}`;
    const redirect = await commerce.startCheckout(r.order, { lines: commerce.orderLinesFromItems(r.order), email: r.customer.email, lang: b.lang, successUrl: `${back}&pago=ok`, cancelUrl: `${back}&pago=cancelado` });
    res.status(201).json({ mode: 'pay', ref: r.order.ref, redirect });
  });

  // ------------------------------------------------- contacto y presupuestos
  const requestSchema = z.object({
    type: z.enum(['contact', 'quote']), topic: V.optText(80), name: V.name, email: V.email, phone: V.phone,
    company: V.optText(120), team_size: z.coerce.number().int().min(1).max(200).optional().or(z.literal('')),
    start_date: V.date.optional().or(z.literal('')), message: V.optText(3000),
    privacy: V.bool, marketing: V.bool.optional(), lang: V.lang,
    website: z.string().max(200).optional(), started: z.coerce.number().optional(),
  });

  function ackRequest(r, lang) {
    const es = lang !== 'en';
    ctx.notify('mail', {
      to: r.email, lang, kind: 'request.ack', ref: r.ref,
      content: {
        subject: es ? `Hemos recibido tu mensaje · ${r.ref}` : `We have received your message · ${r.ref}`,
        title: es ? 'Gracias por escribirnos' : 'Thanks for getting in touch',
        intro: es ? 'Hemos recibido tu mensaje y te responderemos lo antes posible en horario de recepción.' : 'We have received your message and will reply as soon as possible during reception hours.',
        rows: [[es ? 'Referencia' : 'Reference', r.ref], [es ? 'Asunto' : 'Subject', r.topic || '—']],
      },
    });
  }

  app.post('/api/requests', limit('form', 8, 10 * 60_000), csrf, (req, res) => {
    const b = parse(requestSchema, req.body);
    // Protección básica anti-spam: campo trampa y tiempo mínimo de cumplimentación.
    if (b.website) return res.status(201).json({ ok: true, ref: 'OK' });
    if (b.started && ctx.now() - b.started < 2500) throw new AppError('RATE_LIMITED', 429);
    if (!b.privacy) throw new AppError('TERMS_REQUIRED');
    const r = commerce.createRequest({ ...b, team_size: b.team_size || null, start_date: b.start_date || null, marketing: b.marketing });
    ctx.notify('mail', {
      to: ctx.cfg.notifyTo, kind: 'admin.request', ref: r.ref,
      content: {
        subject: `${b.type === 'quote' ? 'Presupuesto' : 'Contacto'} ${r.ref} · ${b.topic || ''}`, title: `${b.type === 'quote' ? 'Solicitud de presupuesto' : 'Mensaje de contacto'} ${r.ref}`,
        intro: `${b.name} (${b.email}) ha escrito desde la web.`,
        rows: [['Teléfono', b.phone || '—'], ['Asunto', b.topic || '—'], ['Equipo', String(b.team_size || '—')], ['Fecha deseada', b.start_date || '—']],
        blocks: [b.message || ''], cta: { label: 'Abrir en el panel', url: `${ctx.cfg.baseUrl}/admin/solicitudes` },
      },
    });
    ackRequest(r, b.lang);
    res.status(201).json({ ok: true, ref: r.ref });
  });

  // ------------------------------------------------------ inscripción a eventos
  app.post('/api/events/:slug/signup', limit('form', 10, 10 * 60_000), csrf, (req, res) => {
    const b = parse(z.object({ name: V.name, email: V.email, privacy: V.bool, lang: V.lang }), req.body);
    if (!b.privacy) throw new AppError('TERMS_REQUIRED');
    const ev = ctx.db.get("SELECT * FROM events WHERE slug = ? AND status = 'published'", [req.params.slug]);
    if (!ev || ev.end_utc < ctx.now()) throw new AppError('NOT_FOUND', 404);
    ctx.db.tx(() => {
      const n = ctx.db.get('SELECT COUNT(*) AS n FROM event_signups WHERE event_id = ?', [ev.id]).n;
      if (ev.capacity && n >= ev.capacity) throw new AppError('NO_AVAILABILITY', 409);
      ctx.db.run('INSERT INTO event_signups (event_id, name, email, created_at) VALUES (?,?,?,?) ON CONFLICT(event_id, email) DO NOTHING', [ev.id, b.name, b.email, ctx.now()]);
    });
    const es = b.lang !== 'en';
    ctx.notify('mail', { to: b.email, lang: b.lang, kind: 'event.signup', ref: ev.slug, content: {
      subject: es ? `Inscripción: ${ev.title_es}` : `Registration: ${ev.title_en}`, title: es ? 'Te esperamos' : 'See you there',
      intro: es ? 'Tu inscripción está registrada.' : 'Your registration is confirmed.',
      rows: [[es ? 'Actividad' : 'Activity', es ? ev.title_es : ev.title_en], [es ? 'Fecha' : 'Date', `${T.fmtDate(ev.start_utc, b.lang)} · ${T.fmtTime(ev.start_utc)}`]],
    } });
    res.status(201).json({ ok: true });
  });

  // Errores de la API siempre localizados.
  app.use('/api', (err, req, res, next) => {
    if (!(err instanceof AppError)) return next(err);
    const lang = langOf(req);
    res.status(err.status).json({ error: err.code, message: errorMessage(lang, err.code, err.details), details: err.details });
  });
}
