import { html, raw } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, media, icon, hoursRows, hoursSummary, mapsLinks } from '../components.js';
import { path, SPACE_ROUTE } from '../../i18n/routes.js';
import { priceLabel, taxNote } from '../../services/pricing.js';
import { bookingServices } from '../../services/services-map.js';
import { money } from '../../lib/util.js';
import * as T from '../../lib/time.js';

export function faqLd(faqs, lang) {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f[`q_${lang}`], acceptedAnswer: { '@type': 'Answer', text: f[`a_${lang}`] } })),
  };
}

export function faqList(faqs, lang) {
  return html`<div class="faq">${faqs.map((f) => html`<details><summary>${f[`q_${lang}`]}<span class="plus" aria-hidden="true"></span></summary><div class="faq__a">${f[`a_${lang}`]}</div></details>`)}</div>`;
}

export function priceAmount(ctx, product, lang) {
  if (!product) return '';
  if (product.price_cents === null) return html`<span class="amount" style="font-size:1.6rem">${lang === 'en' ? 'On request' : 'A consultar'}</span>`;
  const l = priceLabel(ctx, product, lang);
  const [amount, unit] = l.split(' / ');
  return html`<span class="amount">${amount}${unit ? html`<small>/ ${unit}</small>` : ''}</span>`;
}

export function renderHome(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const c = (k) => ctx.content.get(k, lang);
  const { catalog, settings } = ctx;
  const b = settings.get('business');
  const hours = settings.get('hours');
  const note = c('media.concept_note');
  const hero = catalog.media('home.hero')[0];
  const spaces = catalog.spaces();
  const pool = catalog.deskPool();
  const P = (s) => catalog.product(s);
  const faqs = catalog.faqs();
  const today = T.todayLocal(ctx.now());
  const services = bookingServices(ctx, lang).filter((s) => ['pass', 'trial', 'room', 'booth', 'studio', 'visit'].includes(s.id));
  const addr = `${b.street}, ${b.postal_code} ${b.city}`;
  const maps = mapsLinks(`${b.street}, ${b.postal_code} ${b.city}, ${b.province}`, lang);
  const spaceSpecs = {
    coworking: [`${pool?.capacity ?? 0} ${es ? 'puestos' : 'desks'}`, `${es ? 'desde' : 'from'} ${priceLabel(ctx, P('pase-dia'), lang)}`],
    salas: [`${catalog.resourcesForProduct('sala-reuniones').length} ${es ? 'salas' : 'rooms'}`, priceLabel(ctx, P('sala-reuniones'), lang)],
    despachos: [`${catalog.resourcesForProduct('despacho').length} ${es ? 'despachos' : 'offices'}`, es ? 'Presupuesto' : 'On request'],
    estudio: [es ? 'Pódcast y vídeo' : 'Podcast & video', es ? 'Presupuesto' : 'On request'],
  };
  const headline = c('home.headline');

  const body = html`
<section class="hero wrap" aria-labelledby="h1">
  <div class="hero__top hero-in">
    ${label('', c('home.eyebrow'))}
    <span class="label hide-sm"><span class="rec-dot rec-dot--live"></span>${es ? 'Coworking · Salas · Despachos · Estudio' : 'Coworking · Rooms · Offices · Studio'}</span>
  </div>
  <h1 id="h1" class="display hero__h1 balance">${heroTitle(c('home.h1'))}</h1>
  <div class="hero__row hero-in">
    <p class="lead balance">${headline}</p>
    <div class="hero__aside">
      <p class="pretty">${c('home.intro')}</p>
      <div class="btn-row">
        ${button({ href: path('book', lang), label: es ? 'Reservar espacio' : 'Book a space' })}
        ${button({ href: '#conocer', label: es ? 'Conocer FRAME' : 'Discover FRAME', variant: 'ghost' })}
      </div>
    </div>
  </div>
  <div class="hero__visual">
    ${media(hero, lang, { eager: true, note, rec: true, sizes: '(max-width: 1440px) 100vw, 1440px' })}
    <div class="dim dim--ticks hero__dims" aria-hidden="true"><span>${b.surface_m2} m² · Torrevieja</span></div>
  </div>
</section>

<section class="finder" data-finder data-book-url="${path('book', lang)}" aria-labelledby="finder-title">
  <h2 id="finder-title" class="sr-only">${es ? 'Buscar disponibilidad' : 'Check availability'}</h2>
  <form novalidate>
    <div class="finder__field">
      <label for="f-service">${es ? 'Servicio' : 'Service'}</label>
      <select id="f-service" name="service">
        ${services.map((s) => html`<option value="${s.id}" data-type="${s.type}" ${raw(s.resources ? `data-resource="${s.resources[0].slug}"` : '')} ${raw(s.groupSlug ? `data-group="${s.groupSlug}"` : '')} data-duration="${s.durations ? (s.id === 'visit' || !s.durations.includes(60) ? s.durations[0] : 60) : ''}">${s.title}</option>`)}
      </select>
    </div>
    <div class="finder__field">
      <label for="f-date">${es ? 'Fecha' : 'Date'}</label>
      <input id="f-date" name="date" type="date" value="${nextOpenDay(ctx, today)}" min="${today}" max="${T.addDays(today, settings.get('policies').horizon_days)}" required>
    </div>
    <div class="finder__field">
      <label for="f-slot">${es ? 'Horario' : 'Time'}</label>
      <select id="f-slot" name="slot">
        <option value="all">${es ? 'Todo el día' : 'All day'}</option>
        <option value="am">${es ? 'Mañana' : 'Morning'}</option>
        <option value="pm">${es ? 'Tarde' : 'Afternoon'}</option>
      </select>
    </div>
    ${button({ type: 'submit', label: es ? 'Ver disponibilidad' : 'Check availability', variant: 'rec' })}
  </form>
  <div class="finder__result" data-finder-result aria-live="polite"></div>
</section>

<div class="ticker mt-5" aria-hidden="true"><div class="ticker__track">
  ${[0, 1].map(() => (es ? ['Coworking', 'Salas de reuniones', 'Despachos privados', 'Estudio de pódcast', 'Comunidad', 'Torrevieja'] : ['Coworking', 'Meeting rooms', 'Private offices', 'Podcast studio', 'Community', 'Torrevieja']).map((t) => html`<span class="ticker__item">${t}</span>`))}
</div></div>

<section class="section" id="conocer" aria-labelledby="spaces-title">
  <div class="wrap">
    <div class="sec-head reveal">
      <div>${label('01', es ? 'Espacios' : 'Spaces')}<h2 id="spaces-title" class="display-2 mt-2 balance">${c('home.spaces.title')}</h2></div>
      <p>${c('home.spaces.text')}</p>
    </div>
    <div class="spaces-grid">
      ${spaces.map((s, i) => {
        const m = catalog.media(`space.${s.slug}`)[0];
        return html`<a class="space-card reveal" href="${path(SPACE_ROUTE[s.slug], lang)}">
          ${media(m, lang, { note, sizes: '(max-width: 800px) 100vw, 60vw' })}
          <div class="space-card__meta"><span class="label"><span class="idx">0${i + 1}</span>/ 0${spaces.length}</span><span class="space-card__specs">${(spaceSpecs[s.slug] || []).map((t) => html`<span class="tag">${t}</span>`)}</span></div>
          <h3>${s[`name_${lang}`]}</h3>
          <p>${s[`tagline_${lang}`]}</p>
        </a>`;
      })}
    </div>
  </div>
</section>

<section class="section section--paper2" aria-labelledby="pricing-title">
  <div class="wrap">
    <div class="sec-head reveal">
      <div>${label('02', es ? 'Planes y tarifas' : 'Plans & pricing')}<h2 id="pricing-title" class="display-2 mt-2 balance">${c('home.pricing.title')}</h2></div>
      <p>${c('home.pricing.text')}</p>
    </div>
    <div class="price-grid reveal">
      ${['pase-dia', 'bono-10', 'mesa-flexible', 'mesa-fija'].map((slug) => {
        const p = P(slug);
        if (!p) return '';
        return html`<div class="price-col${p.featured ? ' price-col--featured' : ''}">
          <div class="flex between center"><h3>${p[`name_${lang}`]}</h3>${p.featured ? html`<span class="tag tag--rec" style="border-color:var(--rec-glow);color:var(--rec-glow)">${es ? 'Plan principal' : 'Main plan'}</span>` : ''}</div>
          ${priceAmount(ctx, p, lang)}
          <p class="small mb-0" style="opacity:.85">${p[`summary_${lang}`]}</p>
          <ul>${(p.includes[lang] || []).slice(0, 3).map((x) => html`<li>${x.replace('{validity}', p.validity_days || '')}</li>`)}</ul>
        </div>`;
      })}
    </div>
    <div class="price-extras reveal">
      ${[['oficina-virtual', 'pricing'], ['sala-reuniones', 'space.salas'], ['despacho', 'space.despachos']].map(([slug, route]) => {
        const p = P(slug);
        return p ? html`<a class="price-extra" href="${path(route, lang)}"><span><strong>${p[`name_${lang}`]}</strong><br><span class="small muted">${slug === 'oficina-virtual' ? (es ? 'Servicio independiente' : 'Separate service') : p[`summary_${lang}`]}</span></span><span class="tabular">${priceLabel(ctx, p, lang)}</span></a>` : '';
      })}
    </div>
    <p class="tax-note"><span class="rec-dot" style="margin-top:.45em;flex:none"></span><span>${taxNote(ctx, lang)} ${settings.get('trial').enabled ? (es ? 'Puedes solicitar un primer día de prueba gratuito.' : 'You can request a free first trial day.') : ''}</span></p>
    <div class="btn-row mt-3">${button({ href: path('pricing', lang), label: es ? 'Comparar planes' : 'Compare plans', variant: 'ghost' })}${settings.get('trial').enabled ? button({ href: `${path('book', lang)}?servicio=trial`, label: es ? 'Pedir día de prueba' : 'Request a trial day' }) : ''}</div>
  </div>
</section>

<section class="section" aria-labelledby="why-title">
  <div class="wrap">
    <div class="sec-head reveal">
      <div>${label('03', es ? 'Ventajas' : 'Why FRAME')}<h2 id="why-title" class="display-2 mt-2 balance">${c('home.why.title')}</h2></div>
    </div>
    <div class="why reveal">
      ${[1, 2, 3, 4].map((n) => html`<div class="why__item"><span class="why__num">0${n}</span><h3>${c(`home.why.${n}.title`)}</h3><p>${c(`home.why.${n}.text`)}</p></div>`)}
    </div>
  </div>
</section>

<section class="section section--dark" aria-labelledby="studio-title">
  <div class="wrap studio">
    <div class="reveal">${media(catalog.media('space.estudio')[0], lang, { note, rec: true, sizes: '(max-width: 860px) 100vw, 50vw' })}</div>
    <div class="reveal stack" style="--stack:1.4rem">
      <span class="onair"><span class="rec-dot rec-dot--live"></span> ON AIR</span>
      <h2 id="studio-title" class="display-2 balance">${es ? html`Graba donde <span class="serif">trabajas</span>` : html`Record where you <span class="serif">work</span>`}</h2>
      <p class="lead" style="color:var(--muted-dark)">${catalog.space('estudio')?.[`tagline_${lang}`]}</p>
      <p style="color:var(--muted-dark);max-width:52ch">${(catalog.space('estudio')?.[`description_${lang}`] || '').split('\n\n')[0]}</p>
      <div class="btn-row">
        ${button({ href: `${path('book', lang)}?servicio=studio`, label: es ? 'Reservar el estudio' : 'Book the studio', variant: 'light' })}
        ${button({ href: path('space.estudio', lang), label: es ? 'Ver el estudio' : 'See the studio', variant: 'ghost' })}
      </div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="loc-title">
  <div class="wrap location">
    <div class="reveal stack" style="--stack:1.5rem">
      ${label('04', es ? 'Ubicación' : 'Location')}
      <h2 id="loc-title" class="display-3">${c('home.location.title')}</h2>
      <address class="address-big">${b.street}<br>${b.postal_code} ${b.city}</address>
      <p class="muted">${c('home.location.text')}</p>
      <dl class="kv">
        <dt>${es ? 'Teléfono' : 'Phone'}</dt><dd><a href="tel:${b.phone.replace(/\s/g, '')}">${b.phone}</a></dd>
        <dt>Email</dt><dd><a href="mailto:${b.email}">${b.email}</a></dd>
        <dt>${es ? 'Recepción' : 'Reception'}</dt><dd>${hoursSummary(hours.reception, lang)}${hours.confirmed ? '' : html` <span class="tag">${es ? 'provisional' : 'provisional'}</span>`}</dd>
        <dt>${es ? 'Acceso' : 'Access'}</dt><dd>${es ? 'Coworking' : 'Coworking'}: ${hoursSummary(hours.coworking, lang)}<br><span class="small muted">${es ? '24/7 solo con mesa fija' : '24/7 only with a fixed desk'}</span></dd>
      </dl>
      <div class="btn-row">
        ${button({ href: maps.google, label: es ? 'Abrir en mapas' : 'Open in maps', variant: 'ghost', attrs: { target: '_blank', rel: 'noopener' } })}
        ${button({ href: `${path('book', lang)}?servicio=visit`, label: es ? 'Reservar visita' : 'Book a tour' })}
      </div>
      <p class="small muted">${es ? 'También en' : 'Also on'} <a href="${maps.apple}" target="_blank" rel="noopener">Apple Maps</a> · <a href="${maps.osm}" target="_blank" rel="noopener">OpenStreetMap</a></p>
    </div>
    <div class="reveal">
      <figure class="media frame frame--ink" style="margin:0;aspect-ratio:4/3;background:var(--paper-2)">
        <span class="frame__c"></span>
        <img src="/img/renders/plano.webp" alt="${es ? 'Maqueta axonométrica conceptual de FRAME con el reparto de superficies del local' : 'Conceptual axonometric model of FRAME with the floor-area split'}" loading="lazy" decoding="async">
        <figcaption class="media__note">${es ? 'Maqueta conceptual · 400 m² según el reparto de FRAME' : 'Conceptual model · 400 m² following FRAME’s split'}</figcaption>
      </figure>
      <div class="dim dim--ticks mt-1" aria-hidden="true"><span>${b.surface_m2} m² · ${es ? 'una sola sede' : 'one location'}</span></div>
    </div>
  </div>
</section>

<section class="section section--paper2" aria-labelledby="faq-title">
  <div class="wrap faq-layout">
    <div class="reveal">${label('05', es ? 'Preguntas frecuentes' : 'FAQ')}<h2 id="faq-title" class="display-2 mt-2">${es ? 'Lo que suelen preguntarnos' : 'What people usually ask'}</h2></div>
    <div class="reveal">${faqList(faqs, lang)}</div>
  </div>
</section>

<section class="section final-cta" aria-labelledby="cta-title">
  <div class="wrap">
    ${label('06', es ? 'Reservar' : 'Book')}
    <h2 id="cta-title" class="display mt-2 reveal">${c('home.cta.title')}</h2>
    <div class="final-cta__row reveal">
      <p class="lead">${c('home.cta.text')}</p>
      <div class="btn-row">
        ${button({ href: path('book', lang), label: es ? 'Reservar espacio' : 'Book a space', variant: 'rec' })}
        ${button({ href: path('contact', lang), label: es ? 'Hablar con FRAME' : 'Talk to FRAME', variant: 'ghost' })}
      </div>
    </div>
  </div>
</section>`;

  return layout(ctx, req, res, {
    title: es ? 'Coworking y estudio de pódcast en Torrevieja · FRAME' : 'Coworking and podcast studio in Torrevieja · FRAME',
    description: es ? 'Coworking en Torrevieja con pase de día, bono y mesa flexible, salas de reuniones por horas, despachos privados y estudio de pódcast y vídeo. Reserva online.'
      : 'Coworking in Torrevieja with day passes, ten-day passes and flexible desks, meeting rooms by the hour, private offices and a podcast & video studio. Book online.',
    body, routeId: 'home', bodyClass: 'page-home has-grain',
    jsonld: [faqLd(faqs, lang)],
  });
}

// El H1 se compone en líneas con una palabra destacada en serif.
function heroTitle(text) {
  const m = text.match(/^(.*?)(estudio de pódcast|podcast studio)(.*)$/i);
  if (!m) return text;
  return html`${m[1]}<span class="serif">${m[2]}</span>${m[3]}`;
}

function nextOpenDay(ctx, today) {
  for (let i = 1; i < 10; i++) {
    const d = T.addDays(today, i);
    if (ctx.bookings.deskInfo(d).open) return d;
  }
  return T.addDays(today, 1);
}
