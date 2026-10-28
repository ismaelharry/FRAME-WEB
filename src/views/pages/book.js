import { html, raw, jsonForScript } from '../../lib/html.js';
import { layout } from '../layout.js';
import { label, breadcrumbs, button } from '../components.js';
import { path } from '../../i18n/routes.js';
import { layoutFor } from '../../config/layout.js';
import { bookingServices } from '../../services/services-map.js';
import { commerceState } from '../../services/settings.js';

const GROUPS = {
  day: { es: 'Por días', en: 'By the day' },
  hour: { es: 'Por horas', en: 'By the hour' },
  visit: { es: 'Conocer FRAME', en: 'Visit FRAME' },
  buy: { es: 'Bono', en: 'Pass' },
  plan: { es: 'Planes mensuales', en: 'Monthly plans' },
  quote: { es: 'Bajo presupuesto', en: 'On request' },
};

export function renderBook(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const services = bookingServices(ctx, lang, { customer: req.customer });
  const commerce = commerceState(ctx.settings, ctx.payments);
  const L = layoutFor(ctx);
  const prefill = {
    service: String(req.query.servicio || req.query.service || ''),
    date: String(req.query.fecha || req.query.date || ''),
    time: String(req.query.hora || req.query.time || ''),
    resource: String(req.query.recurso || ''),
  };
  const groups = Object.keys(GROUPS).map((g) => ({ g, items: services.filter((s) => s.group === g) })).filter((x) => x.items.length);

  const body = html`
<section class="book-hero">
  <div class="wrap book-hero__head">
    ${breadcrumbs([[path('home', lang), 'FRAME'], [path('book', lang), es ? 'Reservar' : 'Book']])}
    <div class="flex between wrap-row gap-2" style="align-items:end">
      <div>${label('', es ? 'Reservar · disponibilidad en tiempo real' : 'Book · real-time availability')}
        <h1 class="display-2 mt-2 balance">${es ? 'Elige tu sitio en FRAME' : 'Choose your spot at FRAME'}</h1></div>
      <p class="muted" style="max-width:44ch;margin:0">${es ? 'Toca una zona de la maqueta o elige un servicio. Consultar disponibilidad no requiere cuenta.' : 'Tap a zone on the model or choose a service. Checking availability does not require an account.'}</p>
    </div>
  </div>
  <div class="viewer" data-viewer data-layout="${JSON.stringify(L)}" aria-label="${es ? 'Maqueta 3D interactiva del local' : 'Interactive 3D model of the venue'}">
    <img class="viewer__fallback" src="/img/renders/plano.webp" alt="${es ? 'Maqueta conceptual de FRAME con el reparto de superficies del local' : 'Conceptual model of FRAME with the floor-area split'}" width="1800" height="1350" fetchpriority="high">
    <div class="viewer__ui">
      <span class="viewer__hint mono" data-viewer-hint>${es ? 'Arrastra para girar · toca una zona' : 'Drag to rotate · tap a zone'}</span>
      <div class="viewer__actions">
        <button type="button" class="chip" data-360 hidden>${es ? 'Vista 360° de la zona' : '360° view of the zone'}</button>
        <button type="button" class="chip" data-exit360 hidden>${es ? 'Volver a la maqueta' : 'Back to the model'}</button>
      </div>
      <span class="viewer__note mono">${es ? 'Maqueta conceptual · reparto de superficies de FRAME, sin planos definitivos' : 'Conceptual model · FRAME floor-area split, no final plans'}</span>
    </div>
  </div>
</section>

<section class="wrap book" id="reserva" data-book data-lang="${lang}" data-prefill="${JSON.stringify(prefill)}"
  data-account-url="${path('account', lang)}" data-book-url="${path('book', lang)}" data-contact-url="${path('contact', lang)}" data-terms-url="${path('legal.terms', lang)}" data-privacy-url="${path('legal.privacy', lang)}">
  <div class="book__main">
    ${!commerce.canSell ? html`<p class="note note--warn small mb-3">${es ? 'Las compras online aún no están activas: las reservas con precio se guardan como solicitud, sin ningún cargo, hasta que FRAME confirme tarifas e impuestos.' : 'Online purchases are not active yet: priced bookings are saved as requests, with no charge, until FRAME confirms prices and tax.'}</p>`
      : commerce.testMode ? html`<p class="test-banner mb-3">${es ? 'MODO PRUEBA · Los pagos se hacen en una pasarela de prueba y no se cobra nada.' : 'TEST MODE · Payments use a test gateway and nothing is charged.'}</p>` : ''}
    <ol class="steps" data-steps aria-label="${es ? 'Pasos de la reserva' : 'Booking steps'}">
      ${(es ? ['Servicio', 'Fecha y hora', 'Tus datos', 'Revisión'] : ['Service', 'Date & time', 'Your details', 'Review']).map((s, i) => html`<li data-step-ind="${i}"><span class="mono">0${i + 1}</span> ${s}</li>`)}
    </ol>

    <div class="book__panel" data-panel="service">
      <h2 class="display-3" tabindex="-1">${es ? '¿Qué quieres reservar?' : 'What would you like to book?'}</h2>
      ${groups.map(({ g, items }) => html`
        <fieldset class="svc-group"><legend class="label">${GROUPS[g][lang]}</legend>
          <div class="svc-grid">
            ${items.map((s) => html`<button type="button" class="svc${s.featured ? ' svc--featured' : ''}" data-service="${s.id}" data-zone="${s.zone}" aria-pressed="false">
              <span class="svc__title">${s.title}</span>
              <span class="svc__sum">${s.summary}</span>
              <span class="svc__price">${s.price}${s.requiresLogin ? html` · <span class="muted">${es ? 'requiere iniciar sesión' : 'sign-in required'}</span>` : ''}</span>
            </button>`)}
          </div>
        </fieldset>`)}
    </div>
    <div class="book__panel" data-panel="when" hidden></div>
    <div class="book__panel" data-panel="details" hidden></div>
    <div class="book__panel" data-panel="review" hidden></div>
    <div class="book__panel" data-panel="done" hidden></div>
    <noscript><p class="alert alert--error">${es ? 'Para reservar online necesitas activar JavaScript. También puedes llamarnos al ' : 'To book online you need JavaScript enabled. You can also call us on '}${ctx.settings.get('business').phone}.</p></noscript>
  </div>
  <aside class="book__summary" aria-label="${es ? 'Resumen de la reserva' : 'Booking summary'}">
    <div class="panel panel--sticky summary" data-summary aria-live="polite">
      ${label('', es ? 'Resumen' : 'Summary')}
      <p class="muted small mt-2">${es ? 'Elige un servicio para empezar.' : 'Choose a service to start.'}</p>
    </div>
  </aside>
</section>
<script nonce="${res.locals.nonce}" type="importmap">${jsonForScript({ imports: { three: '/vendor/three/three.module.js', 'three/addons/': '/vendor/three-addons/' } })}</script>`;

  return layout(ctx, req, res, {
    title: es ? 'Reservar coworking, sala o estudio en Torrevieja' : 'Book coworking, a room or the studio in Torrevieja',
    description: es ? 'Consulta disponibilidad real y reserva un pase de día, una sala de reuniones, el estudio de pódcast o una visita guiada en FRAME Torrevieja.'
      : 'Check real availability and book a day pass, a meeting room, the podcast studio or a guided tour at FRAME Torrevieja.',
    body, routeId: 'book', bodyClass: 'page-book', hideFab: true,
    scripts: ['/js/book.mjs'],
  });
}
