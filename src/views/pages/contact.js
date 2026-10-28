import { html, raw } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, breadcrumbs, hoursRows, mapsLinks, icon } from '../components.js';
import { path } from '../../i18n/routes.js';
import * as T from '../../lib/time.js';

export function renderContact(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const b = ctx.settings.get('business');
  const hours = ctx.settings.get('hours');
  const full = `${b.street}, ${b.postal_code} ${b.city}, ${b.province}`;
  const maps = mapsLinks(full, lang);
  const wd = T.zonedParts(ctx.now()).weekday;
  const today = T.todayLocal(ctx.now());
  const tour = ctx.catalog.tourResource();
  const asunto = String(req.query.asunto || '');
  const topics = es
    ? [['general', 'Información general'], ['coworking', 'Coworking y planes'], ['salas', 'Salas de reuniones'], ['despacho', 'Despacho privado (presupuesto)'], ['estudio', 'Estudio de pódcast y vídeo (presupuesto)'], ['oficina-virtual', 'Oficina virtual'], ['comunidad', 'Comunidad y actividades'], ['otro', 'Otro']]
    : [['general', 'General information'], ['coworking', 'Coworking and plans'], ['salas', 'Meeting rooms'], ['despacho', 'Private office (quote)'], ['estudio', 'Podcast & video studio (quote)'], ['oficina-virtual', 'Virtual office'], ['comunidad', 'Community and activities'], ['otro', 'Other']];
  const isQuote = ['despacho', 'estudio'].includes(asunto);
  const csrf = res.locals.csrfPublic;

  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('contact', lang), es ? 'Ubicación y contacto' : 'Location & contact']])}
  ${label('', es ? 'Ubicación y contacto' : 'Location & contact')}
  <h1 class="display-2 mt-2 balance">${es ? 'Ven a vernos a Torrevieja' : 'Come and see us in Torrevieja'}</h1>
  <div class="page-hero__intro"><p>${ctx.content.get('contact.intro', lang)}</p></div>
</section>

<section class="wrap location">
  <div class="stack" style="--stack:1.4rem">
    <address class="address-big">${b.street}<br>${b.postal_code} ${b.city}<br><span class="muted" style="font-size:.6em">${b.province}, ${b.country}</span></address>
    <dl class="kv">
      <dt>${es ? 'Teléfono' : 'Phone'}</dt><dd><a href="tel:${b.phone.replace(/\s/g, '')}">${b.phone}</a></dd>
      <dt>Email</dt><dd><a href="mailto:${b.email}">${b.email}</a></dd>
    </dl>
    <div class="btn-row">
      ${button({ href: maps.google, label: 'Google Maps', variant: 'ghost', size: 'sm', attrs: { target: '_blank', rel: 'noopener' } })}
      ${button({ href: maps.apple, label: 'Apple Maps', variant: 'ghost', size: 'sm', attrs: { target: '_blank', rel: 'noopener' } })}
      ${button({ href: maps.osm, label: 'OpenStreetMap', variant: 'ghost', size: 'sm', attrs: { target: '_blank', rel: 'noopener' } })}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:24px">
      <table class="hours-table"><caption>${es ? 'Recepción' : 'Reception'}${hours.confirmed ? '' : (es ? ' · provisional' : ' · provisional')}</caption><tbody>${hoursRows(hours.reception, lang, wd)}</tbody></table>
      <table class="hours-table"><caption>${es ? 'Acceso coworking' : 'Coworking access'}</caption><tbody>${hoursRows(hours.coworking, lang, wd)}</tbody></table>
    </div>
    <p class="small muted">${es ? 'El acceso 24/7 está incluido únicamente en el plan de mesa fija. Fuera del horario de recepción no hay personal en el espacio.' : '24/7 access is only included in the fixed desk plan. Outside reception hours there are no staff on site.'}</p>
  </div>
  <div>
    <div class="map-box" data-map data-map-src="https://maps.google.com/maps?q=${encodeURIComponent(full)}&output=embed" data-map-title="${es ? 'Mapa de FRAME' : 'FRAME map'}">
      <svg class="map-box__plan" viewBox="0 0 400 275" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#D3CBBE" stroke-width=".6"/></pattern></defs><rect width="400" height="275" fill="url(#g)"/><path d="M-10 190 L410 120" stroke="#C9C0B1" stroke-width="16"/><path d="M150 -10 L190 290" stroke="#D9D1C3" stroke-width="10"/><circle cx="172" cy="152" r="9" fill="#C8401E"/><circle cx="172" cy="152" r="20" fill="none" stroke="#C8401E" stroke-width="1"/></svg>
      <div class="map-box__content">
        ${icon.pin}
        <p class="small mb-0">${es ? 'El mapa interactivo lo sirve Google y puede instalar cookies de terceros. Se carga solo si lo aceptas.' : 'The interactive map is served by Google and may set third-party cookies. It only loads if you accept.'}</p>
        <button class="btn btn--sm" type="button" data-map-load><span class="btn__roll"><span>${es ? 'Cargar mapa' : 'Load map'}</span><span aria-hidden="true">${es ? 'Cargar mapa' : 'Load map'}</span></span><span class="btn__icon">${icon.arrow}</span></button>
      </div>
    </div>
    <p class="small muted mt-1">${es ? 'No publicamos información sobre aparcamiento ni accesibilidad hasta verificarla en el local.' : 'We do not publish parking or accessibility information until it has been verified on site.'}</p>
  </div>
</section>

<section class="section" id="visita">
  <div class="wrap two-col">
    <div>${label('01', es ? 'Visita guiada' : 'Guided tour')}<h2 class="display-2 mt-2">${es ? 'Reserva una visita' : 'Book a tour'}</h2>
      <p class="muted mt-2">${es ? `Una visita de ${tour?.min_minutes || 30} minutos para conocer el espacio y resolver dudas. Gratis y sin compromiso.` : `A ${tour?.min_minutes || 30}-minute tour to see the space and ask questions. Free and with no obligation.`}</p></div>
    <div class="panel stack" data-visit data-lang="${lang}" data-resource="${tour?.slug || ''}" data-duration="${tour?.min_minutes || 30}" data-book="${path('book', lang)}">
      <div class="field"><label for="visit-date">${es ? 'Elige un día' : 'Choose a day'}</label><input id="visit-date" type="date" min="${today}" max="${T.addDays(today, ctx.settings.get('policies').horizon_days)}" value="${T.addDays(today, 1)}"></div>
      <div data-visit-slots aria-live="polite" class="chips" style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </div>
  </div>
</section>

<section class="section section--paper2" id="presupuesto">
  <div class="wrap two-col">
    <div>${label('02', es ? 'Escríbenos' : 'Write to us')}<h2 class="display-2 mt-2">${es ? 'Consultas y presupuestos' : 'Questions and quotes'}</h2>
      <p class="muted mt-2">${es ? 'Para despachos, el estudio o cualquier servicio sin tarifa publicada, cuéntanos qué necesitas y te enviamos un presupuesto. Solo pedimos los datos imprescindibles para responderte.' : 'For offices, the studio or any service without a published rate, tell us what you need and we will send you a quote. We only ask for the data we need to reply.'}</p></div>
    <form class="form panel" data-ajax action="/api/requests" novalidate data-ok="${es ? 'Mensaje recibido. Referencia: {ref}. Te hemos enviado un acuse de recibo.' : 'Message received. Reference: {ref}. We have sent you an acknowledgement.'}">
      <input type="hidden" name="_csrf" value="${csrf}">
      <input type="hidden" name="started" value="">
      <div class="hp" aria-hidden="true"><label for="c-website">Web</label><input id="c-website" name="website" tabindex="-1" autocomplete="off"></div>
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="field__label" style="font-size:14px;font-weight:500;margin-bottom:6px">${es ? 'Tipo de mensaje' : 'Message type'}</legend>
        <div class="flex gap-2 wrap-row">
          <label class="check"><input type="radio" name="type" value="contact" ${raw(isQuote ? '' : 'checked')}> ${es ? 'Consulta' : 'Question'}</label>
          <label class="check"><input type="radio" name="type" value="quote" ${raw(isQuote ? 'checked' : '')}> ${es ? 'Presupuesto' : 'Quote'}</label>
        </div>
      </fieldset>
      <div class="field"><label for="c-topic">${es ? 'Asunto' : 'Subject'}</label><select id="c-topic" name="topic">${topics.map(([v, l]) => html`<option value="${v}" ${raw(v === asunto ? 'selected' : '')}>${l}</option>`)}</select></div>
      <div class="form-row">
        <div class="field"><label for="c-name">${es ? 'Nombre' : 'Name'}</label><input id="c-name" name="name" autocomplete="name" required minlength="2"></div>
        <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required></div>
      </div>
      <div class="form-row">
        <div class="field"><label for="c-phone">${es ? 'Teléfono (opcional)' : 'Phone (optional)'}</label><input id="c-phone" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="c-company">${es ? 'Empresa (opcional)' : 'Company (optional)'}</label><input id="c-company" name="company" autocomplete="organization"></div>
      </div>
      <div class="form-row" data-quote-only>
        <div class="field"><label for="c-team">${es ? 'Personas del equipo' : 'Team size'}</label><input id="c-team" name="team_size" type="number" min="1" max="200" inputmode="numeric"></div>
        <div class="field"><label for="c-start">${es ? 'Fecha aproximada de inicio' : 'Approximate start date'}</label><input id="c-start" name="start_date" type="date" min="${today}"></div>
      </div>
      <div class="field"><label for="c-msg">${es ? 'Mensaje' : 'Message'}</label><textarea id="c-msg" name="message" maxlength="3000"></textarea></div>
      <label class="check"><input type="checkbox" name="privacy" required><span>${es ? 'He leído la ' : 'I have read the '}<a href="${path('legal.privacy', lang)}">${es ? 'información de privacidad' : 'privacy information'}</a>. ${es ? 'Usaremos tus datos solo para responder a tu mensaje.' : 'We will only use your data to reply to your message.'}</span></label>
      <label class="check"><input type="checkbox" name="marketing"><span>${es ? 'Además, quiero recibir novedades y eventos de FRAME (opcional).' : 'I would also like to receive FRAME news and events (optional).'}</span></label>
      <div>${button({ type: 'submit', label: es ? 'Enviar mensaje' : 'Send message' })}</div>
      <p class="alert" data-form-result hidden tabindex="-1"></p>
    </form>
  </div>
</section>`;

  return layout(ctx, req, res, {
    title: es ? 'Contacto y ubicación · Coworking FRAME Torrevieja' : 'Contact and location · FRAME coworking Torrevieja',
    description: es ? `FRAME, coworking y estudio de pódcast en ${b.street}, ${b.postal_code} Torrevieja. Teléfono ${b.phone}. Reserva una visita o pide presupuesto.`
      : `FRAME, coworking and podcast studio at ${b.street}, ${b.postal_code} Torrevieja. Phone ${b.phone}. Book a tour or request a quote.`,
    body, routeId: 'contact', scripts: ['/js/contact.js'],
  });
}
