import { html, raw, paragraphs } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, media, breadcrumbs, hoursSummary } from '../components.js';
import { path, SPACE_ROUTE } from '../../i18n/routes.js';
import { priceLabel, taxNote } from '../../services/pricing.js';
import { commerceState } from '../../services/settings.js';
import * as T from '../../lib/time.js';

const SEO = {
  coworking: {
    es: ['Coworking en Torrevieja · Pase de día, bono y mesa flexible', 'Coworking en Torrevieja con pase de día, bono de 10 días, mesa flexible sin permanencia y mesa fija con acceso 24/7. Consulta disponibilidad y reserva.'],
    en: ['Coworking in Torrevieja · Day pass, 10-day pass and flexible desk', 'Coworking in Torrevieja with day passes, a 10-day pass, flexible desks with no minimum stay and fixed desks with 24/7 access. Check availability and book.'],
    h1: { es: 'Coworking en Torrevieja', en: 'Coworking in Torrevieja' },
  },
  salas: {
    es: ['Sala de reuniones en Torrevieja por horas', 'Alquiler de salas de reuniones por horas en Torrevieja, con pantalla y disponibilidad en tiempo real. Reserva online sin ser miembro.'],
    en: ['Meeting room in Torrevieja by the hour', 'Meeting rooms for hire by the hour in Torrevieja, with a screen and real-time availability. Book online without being a member.'],
    h1: { es: 'Salas de reuniones en Torrevieja', en: 'Meeting rooms in Torrevieja' },
  },
  despachos: {
    es: ['Despachos privados en Torrevieja · Oficinas para equipos', 'Despachos privados para equipos pequeños en Torrevieja con acceso a zonas comunes y salas. Solicita presupuesto.'],
    en: ['Private offices in Torrevieja · Team offices', 'Private offices for small teams in Torrevieja with access to common areas and meeting rooms. Request a quote.'],
    h1: { es: 'Despachos privados en Torrevieja', en: 'Private offices in Torrevieja' },
  },
  estudio: {
    es: ['Estudio de pódcast en Torrevieja · Grabación de vídeo y contenido', 'Estudio de pódcast y vídeo en Torrevieja para grabar entrevistas, pódcast y contenido digital. Elige franja y te enviamos presupuesto.'],
    en: ['Podcast studio in Torrevieja · Video and content recording', 'Podcast and video studio in Torrevieja to record interviews, podcasts and digital content. Pick a slot and we send you a quote.'],
    h1: { es: 'Estudio de pódcast y vídeo en Torrevieja', en: 'Podcast & video studio in Torrevieja' },
  },
};

export function renderSpacesIndex(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const note = ctx.content.get('media.concept_note', lang);
  const spaces = ctx.catalog.spaces();
  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('spaces', lang), es ? 'Espacios' : 'Spaces']])}
  ${label('', es ? `${ctx.settings.get('business').surface_m2} m² en Torrevieja` : `${ctx.settings.get('business').surface_m2} m² in Torrevieja`)}
  <h1 class="display-2 mt-2 balance">${es ? 'Espacios para trabajar, reunirte y grabar' : 'Spaces to work, meet and record'}</h1>
  <div class="page-hero__intro"><p>${es ? 'Cuatro tipos de espacio en una sola sede. Cada ficha detalla capacidad, equipamiento, horarios y condiciones, y te lleva directamente a la reserva o al presupuesto.' : 'Four kinds of space in one location. Each page details capacity, equipment, hours and conditions, and takes you straight to booking or a quote.'}</p></div>
</section>
<section class="section--tight wrap">
  <div class="spaces-grid">
    ${spaces.map((s, i) => html`<a class="space-card reveal" href="${path(SPACE_ROUTE[s.slug], lang)}">
      ${media(ctx.catalog.media(`space.${s.slug}`)[0], lang, { note })}
      <div class="space-card__meta"><span class="label"><span class="idx">0${i + 1}</span>/ 0${spaces.length}</span><span class="tag">${s.area_m2 ? `≈ ${s.area_m2} m²` : ''}</span></div>
      <h2 class="display-3" style="font-size:clamp(1.5rem,2.4vw,2.2rem)">${s[`name_${lang}`]}</h2>
      <p>${s[`tagline_${lang}`]}</p>
    </a>`)}
  </div>
  <div class="note mt-4 small">${es ? 'La distribución, el número de puestos y las superficies son de demostración hasta que FRAME confirme el plano definitivo.' : 'The layout, number of desks and areas are demo values until FRAME confirms the final floor plan.'}</div>
</section>`;
  return layout(ctx, req, res, {
    title: es ? 'Espacios: coworking, salas, despachos y estudio en Torrevieja' : 'Spaces: coworking, rooms, offices and studio in Torrevieja',
    description: es ? 'Conoce los espacios de FRAME en Torrevieja: coworking, salas de reuniones, despachos privados y estudio de pódcast y vídeo.' : 'Discover FRAME’s spaces in Torrevieja: coworking, meeting rooms, private offices and a podcast & video studio.',
    body, routeId: 'spaces',
  });
}

export function renderSpace(ctx, req, res, slug) {
  const lang = req.lang;
  const es = lang !== 'en';
  const { catalog, settings } = ctx;
  const s = catalog.space(slug);
  if (!s) return null;
  const note = ctx.content.get('media.concept_note', lang);
  const seo = SEO[slug];
  const pol = settings.get('policies');
  const hours = settings.get('hours');
  const commerce = commerceState(settings, ctx.payments);
  const gallery = catalog.media(`space.${slug}`);
  const resources = catalog.resources().filter((r) => r.space_slug === slug);
  const pool = catalog.deskPool();
  const products = catalog.products().filter((p) => p.space_slug === slug);
  const fill = (t) => String(t || '').replace('{cancel_hours}', pol.cancel_free_hours).replace('{desks}', pool?.capacity ?? '');
  const isQuote = slug === 'despachos';
  const bookHref = slug === 'coworking' ? `${path('book', lang)}?servicio=pass` : slug === 'salas' ? `${path('book', lang)}?servicio=room` : slug === 'estudio' ? `${path('book', lang)}?servicio=studio` : `${path('contact', lang)}?asunto=despacho#presupuesto`;
  const bookLabel = isQuote ? (es ? 'Solicitar presupuesto' : 'Request a quote') : slug === 'estudio' ? (es ? 'Solicitar sesión' : 'Request a session') : (es ? 'Reservar' : 'Book');
  const capacity = slug === 'coworking' ? `${pool?.capacity ?? 0} ${es ? 'puestos' : 'desks'} + ${catalog.resourcesByGroup('cabinas').length} ${es ? 'cabinas' : 'booths'}`
    : slug === 'salas' ? resources.map((r) => `${r.capacity} p.`).join(' · ')
      : slug === 'despachos' ? resources.map((r) => `${r.capacity} p.`).join(' · ')
        : `${resources[0]?.capacity ?? ''} ${es ? 'personas' : 'people'}`;
  const hoursText = slug === 'coworking' ? `${hoursSummary(hours.coworking, lang)}` : resources[0] ? hoursSummary(resources[0].hours, lang) : '';
  const priceMain = slug === 'coworking' ? `${es ? 'Desde' : 'From'} ${priceLabel(ctx, catalog.product('pase-dia'), lang)}`
    : slug === 'salas' ? priceLabel(ctx, catalog.product('sala-reuniones'), lang)
      : (es ? 'Bajo presupuesto' : 'On request');

  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('spaces', lang), es ? 'Espacios' : 'Spaces'], [path(SPACE_ROUTE[slug], lang), s[`name_${lang}`]]])}
  ${label(`0${s.sort}`, s[`name_${lang}`])}
  <h1 class="display-2 mt-2 balance">${seo.h1[lang]}</h1>
  <div class="page-hero__intro">
    <p class="lead" style="color:var(--ink)">${s[`tagline_${lang}`]}</p>
    <div class="btn-row" style="justify-content:flex-end">${button({ href: bookHref, label: bookLabel, variant: isQuote ? '' : 'rec' })}</div>
  </div>
  <dl class="specs">
    <div><dt>${es ? 'Capacidad' : 'Capacity'}</dt><dd>${capacity}</dd></div>
    <div><dt>${es ? 'Superficie' : 'Area'}</dt><dd>${s.area_m2 ? `≈ ${s.area_m2} m²` : '—'}</dd></div>
    <div><dt>${es ? 'Horario de reserva' : 'Booking hours'}</dt><dd class="small" style="font-size:15px">${hoursText}</dd></div>
    <div><dt>${es ? 'Precio' : 'Price'}</dt><dd>${priceMain}</dd></div>
  </dl>
</section>

<section class="wrap">
  <div class="gallery">${gallery.length ? gallery.map((m, i) => media(m, lang, { note, eager: i === 0, rec: slug === 'estudio' && i === 0 })) : media(null, lang)}</div>
</section>

<section class="section">
  <div class="wrap two-col">
    <div class="stack" style="--stack:2.4rem">
      <div class="prose">${paragraphs(s[`description_${lang}`])}</div>
      <div><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Incluye' : 'Included'}</h2><ul class="list-dash">${s.includes[lang].map((x) => html`<li>${x}</li>`)}</ul></div>
      <div><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Equipamiento' : 'Equipment'}</h2><ul class="list-dash">${s.equipment[lang].map((x) => html`<li>${x}</li>`)}</ul><p class="small muted mt-1">${ctx.content.get('spaces.equipment_note', lang)}</p></div>
      ${resources.length && slug !== 'coworking' ? html`<div><h2 class="display-3 mb-2" style="font-size:1.6rem">${slug === 'salas' ? (es ? 'Salas' : 'Rooms') : slug === 'despachos' ? (es ? 'Despachos' : 'Offices') : (es ? 'Recurso' : 'Resource')}</h2>
        <div class="table-scroll"><table class="compare" style="min-width:0"><thead><tr><th>${es ? 'Nombre' : 'Name'}</th><th>${es ? 'Capacidad' : 'Capacity'}</th><th>${es ? 'Superficie' : 'Area'}</th><th>${es ? 'Equipamiento' : 'Equipment'}</th></tr></thead>
        <tbody>${resources.map((r) => html`<tr><td>${r[`name_${lang}`]}</td><td>${r.capacity} ${es ? 'personas' : 'people'}</td><td>${r.area_m2 ? `≈ ${r.area_m2} m²` : '—'}</td><td class="small">${(r.equipment[lang] || []).join(', ') || '—'}</td></tr>`)}</tbody></table></div></div>` : ''}
      <div><h2 class="display-3 mb-2" style="font-size:1.6rem">${es ? 'Condiciones' : 'Conditions'}</h2><p>${fill(s[`conditions_${lang}`])}</p>
        ${slug === 'coworking' ? html`<p class="small muted">${es ? `Horario de recepción: ${hoursSummary(hours.reception, lang)}. Acceso de miembros con mesa fija: 24/7.` : `Reception hours: ${hoursSummary(hours.reception, lang)}. Fixed desk members: 24/7 access.`}</p>` : ''}
        <p class="small muted">${taxNote(ctx, lang)}</p></div>
    </div>
    <aside>
      <div class="panel panel--sticky stack" style="--stack:1rem">
        ${label('', es ? 'Disponibilidad' : 'Availability')}
        ${isQuote ? html`<p>${es ? 'Los despachos se asignan por meses según el tamaño del equipo. Cuéntanos qué necesitas y te enviamos un presupuesto.' : 'Offices are assigned monthly based on team size. Tell us what you need and we will send a quote.'}</p>
          <ul class="list-dash small">${resources.map((r) => html`<li>${r[`name_${lang}`]} · ${r.capacity} ${es ? 'pers.' : 'ppl.'} · ${officeStatus(ctx, r, lang)}</li>`)}</ul>`
          : html`<div data-avail="${slug}" data-lang="${lang}" data-book="${bookHref}" data-resource="${slug === 'salas' ? resources[0]?.slug : slug === 'estudio' ? resources[0]?.slug : ''}" aria-live="polite">
            <p class="small muted">${es ? 'Próximos días' : 'Next days'}</p>
            <div class="avail-days" data-avail-days></div>
          </div>`}
        ${products.length ? html`<ul class="list-dash small">${products.map((p) => html`<li><span style="flex:1">${p[`name_${lang}`]}</span><strong class="tabular">${priceLabel(ctx, p, lang)}</strong></li>`)}</ul>` : ''}
        ${!commerce.canSell && !isQuote ? html`<p class="small muted">${es ? 'Las compras online aún no están activas: guardamos tu reserva como solicitud, sin cargo, y te confirmamos el precio final.' : 'Online purchases are not active yet: we save your booking as a request, at no charge, and confirm the final price.'}</p>` : ''}
        ${button({ href: bookHref, label: bookLabel, block: true, variant: isQuote ? '' : 'rec' })}
        ${slug === 'coworking' ? button({ href: path('pricing', lang), label: es ? 'Comparar planes' : 'Compare plans', block: true, variant: 'ghost' }) : ''}
      </div>
    </aside>
  </div>
</section>
<section class="section section--paper2">
  <div class="wrap">
    <div class="sec-head"><div>${label('', es ? 'Otros espacios' : 'Other spaces')}<h2 class="display-3 mt-2">${es ? 'Todo en el mismo lugar' : 'All in one place'}</h2></div></div>
    <div class="price-extras">
      ${catalog.spaces().filter((x) => x.slug !== slug).map((x) => html`<a class="price-extra" href="${path(SPACE_ROUTE[x.slug], lang)}"><span><strong>${x[`name_${lang}`]}</strong><br><span class="small muted">${x[`tagline_${lang}`]}</span></span><span aria-hidden="true">→</span></a>`)}
    </div>
  </div>
</section>`;

  return layout(ctx, req, res, {
    title: seo[lang][0], description: seo[lang][1], body, routeId: SPACE_ROUTE[slug], scripts: ['/js/space.js'],
    ogImage: gallery[0]?.path,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'FRAME', item: `${ctx.cfg.baseUrl}${path('home', lang)}` },
        { '@type': 'ListItem', position: 2, name: es ? 'Espacios' : 'Spaces', item: `${ctx.cfg.baseUrl}${path('spaces', lang)}` },
        { '@type': 'ListItem', position: 3, name: s[`name_${lang}`], item: `${ctx.cfg.baseUrl}${path(SPACE_ROUTE[slug], lang)}` },
      ],
    }],
  });
}

function officeStatus(ctx, r, lang) {
  const today = T.todayLocal(ctx.now());
  const [start] = T.dayBoundsUtc(today);
  const busy = ctx.db.get(`SELECT end_date FROM bookings WHERE resource_id = ? AND kind = 'office' AND status IN ('confirmed','requested') AND end_utc > ? ORDER BY start_utc LIMIT 1`, [r.id, start]);
  if (!busy) return lang === 'en' ? 'available' : 'disponible';
  return lang === 'en' ? `occupied until ${T.fmtDateStr(busy.end_date, lang, { day: 'numeric', month: 'short' })}` : `ocupado hasta el ${T.fmtDateStr(busy.end_date, lang, { day: 'numeric', month: 'short' })}`;
}
