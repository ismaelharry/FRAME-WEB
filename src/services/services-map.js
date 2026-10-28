// Servicios que se pueden reservar o contratar desde la web, con la información que
// necesita el formulario de reserva. Todo se deriva del catálogo administrable.
import { priceLabel, quoteProduct } from './pricing.js';
import { commerceState } from './settings.js';

function durations(r) {
  const out = [];
  const step = r.kind === 'studio' ? 60 : 30;
  for (let m = r.min_minutes; m <= r.max_minutes; m += step) out.push(m);
  return out;
}

export function bookingServices(ctx, lang = 'es', { customer = null } = {}) {
  const { catalog, settings } = ctx;
  const es = lang !== 'en';
  const P = (slug) => catalog.product(slug);
  const name = (x) => x?.[`name_${lang}`] || x?.name_es;
  const summary = (x) => x?.[`summary_${lang}`] || x?.summary_es;
  const pool = catalog.deskPool();
  const list = [];
  const pass = P('pase-dia');
  if (pass?.active && pool?.active) list.push({ id: 'pass', group: 'day', type: 'desk', zone: 'coworking', title: name(pass), summary: summary(pass), price: priceLabel(ctx, pass, lang), maxPeople: pass.max_quantity, product: pass.slug });
  const trial = P('dia-prueba');
  if (trial?.active && settings.get('trial').enabled && pool?.active) list.push({ id: 'trial', group: 'day', type: 'desk', zone: 'coworking', title: name(trial), summary: summary(trial), price: es ? 'Gratis' : 'Free', maxPeople: 1, product: trial.slug, weekdays: settings.get('trial').weekdays });
  if (pool?.active) {
    list.push({ id: 'voucher', group: 'day', type: 'desk', zone: 'coworking', title: es ? 'Usar mi bono' : 'Use my pass', summary: es ? 'Reserva un día con el saldo de tu bono de 10 días.' : 'Book a day using your 10-day pass balance.', price: es ? 'Incluido en el bono' : 'Included in your pass', maxPeople: 4, requiresLogin: true });
    list.push({ id: 'flex', group: 'day', type: 'desk', zone: 'coworking', title: es ? 'Mi día de mesa flexible' : 'My flexible desk day', summary: es ? 'Si tienes mesa flexible, asegura tu puesto para un día concreto.' : 'With a flexible desk plan, secure your desk for a specific day.', price: es ? 'Incluido en tu plan' : 'Included in your plan', maxPeople: 1, requiresLogin: true });
  }
  const rooms = catalog.resourcesForProduct('sala-reuniones').filter((r) => r.kind === 'room');
  const room = P('sala-reuniones');
  if (room?.active && rooms.length) list.push({ id: 'room', group: 'hour', type: 'timed', zone: 'salas', title: name(room), summary: summary(room), price: priceLabel(ctx, room, lang), product: room.slug,
    resources: rooms.map((r) => ({ slug: r.slug, name: name(r), capacity: r.capacity, equipment: r.equipment[lang] })), durations: durations(rooms[0]), maxPeople: Math.max(...rooms.map((r) => r.capacity)), mode: rooms[0].booking_mode });
  const booths = catalog.resourcesByGroup('cabinas');
  const booth = P('cabina');
  if (booth?.active && booths.length) list.push({ id: 'booth', group: 'hour', type: 'timed', zone: 'cabinas', title: name(booth), summary: summary(booth), price: priceLabel(ctx, booth, lang), product: booth.slug,
    groupSlug: 'cabinas', units: booths.length, durations: durations(booths[0]), maxPeople: 1, mode: booths[0].booking_mode });
  const studioR = catalog.resource('estudio');
  const studio = P('estudio');
  if (studio?.active && studioR?.active) list.push({ id: 'studio', group: 'hour', type: 'timed', zone: 'estudio', title: name(studio), summary: summary(studio), price: priceLabel(ctx, studio, lang), product: studio.slug,
    resources: [{ slug: studioR.slug, name: name(studioR), capacity: studioR.capacity }], durations: durations(studioR), maxPeople: studioR.capacity, mode: studioR.booking_mode });
  const tour = catalog.tourResource();
  const visit = P('visita');
  if (visit?.active && tour && settings.get('visits').enabled) list.push({ id: 'visit', group: 'visit', type: 'timed', zone: 'recepcion', title: name(visit), summary: summary(visit), price: es ? 'Gratis' : 'Free', product: visit.slug,
    resources: [{ slug: tour.slug, name: name(tour), capacity: tour.capacity }], durations: [tour.min_minutes], maxPeople: Math.min(tour.capacity, settings.get('visits').max_people), mode: 'instant' });
  const bundle = P('bono-10');
  if (bundle?.active) list.push({ id: 'bundle', group: 'buy', type: 'purchase', zone: 'coworking', title: name(bundle), summary: summary(bundle), price: priceLabel(ctx, bundle, lang), product: bundle.slug });
  for (const [id, slug] of [['plan-flex', 'mesa-flexible'], ['plan-fixed', 'mesa-fija'], ['plan-virtual', 'oficina-virtual']]) {
    const p = P(slug);
    if (p?.active) list.push({ id, group: 'plan', type: 'plan', zone: slug === 'oficina-virtual' ? 'recepcion' : 'coworking', title: name(p), summary: summary(p), price: priceLabel(ctx, p, lang), product: slug, featured: Boolean(p.featured) });
  }
  const office = P('despacho');
  if (office?.active) list.push({ id: 'office', group: 'quote', type: 'quote', zone: 'despachos', title: name(office), summary: summary(office), price: es ? 'Solicitar presupuesto' : 'Request a quote', product: office.slug });
  return list.map((s) => ({ ...s, available: !s.requiresLogin || Boolean(customer) }));
}

export function commercePublic(ctx) {
  const c = commerceState(ctx.settings, ctx.payments);
  return { canSell: c.canSell, taxReady: c.taxReady, provider: c.provider, testMode: c.testMode };
}

export { quoteProduct };
