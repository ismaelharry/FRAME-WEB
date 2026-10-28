import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, media, breadcrumbs } from '../components.js';
import { path } from '../../i18n/routes.js';
import * as T from '../../lib/time.js';

export function renderCommunity(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const note = ctx.content.get('media.concept_note', lang);
  const events = ctx.db.all(`SELECT e.*, (SELECT COUNT(*) FROM event_signups s WHERE s.event_id = e.id) AS signups
    FROM events e WHERE status = 'published' AND end_utc > ? ORDER BY start_utc LIMIT 24`, [ctx.now()]);
  const formats = ctx.content.get('community.formats', lang).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]);
  const csrf = res.locals.csrfPublic;

  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('community', lang), es ? 'Comunidad' : 'Community']])}
  ${label('', es ? 'Comunidad · Community' : 'Community · Comunidad')}
  <h1 class="display-2 mt-2 balance">${es ? 'Trabajar al lado de gente que también está creando algo' : 'Working next to people who are also building something'}</h1>
</section>

<section class="wrap">
  <div class="two-col" style="align-items:start">
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:clamp(20px,3vw,40px)">
      <div lang="es" class="stack"><span class="tag">Español</span><p class="lead" style="font-size:1.15rem">${ctx.content.get('community.intro', 'es')}</p></div>
      <div lang="en" class="stack"><span class="tag">English</span><p class="lead" style="font-size:1.15rem">${ctx.content.get('community.intro', 'en')}</p></div>
    </div>
    <div>${media(ctx.catalog.media('community')[0], lang, { note, ratio: '4 / 3' })}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="sec-head"><div>${label('01', es ? 'Formatos que proponemos' : 'Formats we propose')}<h2 class="display-2 mt-2">${es ? 'Ideas para empezar' : 'Ideas to start with'}</h2></div>
      <p>${es ? 'Son propuestas de actividades, no eventos celebrados. Cuando tengan fecha las publicaremos en la agenda.' : 'These are proposed activities, not past events. When they have a date we will publish them in the calendar.'}</p></div>
    <div class="why">${formats.map(([t, d], i) => html`<div class="why__item"><span class="why__num">0${i + 1}</span><h3>${t}</h3><p>${d || ''}</p></div>`)}</div>
  </div>
</section>

<section class="section section--paper2" id="agenda">
  <div class="wrap">
    <div class="sec-head"><div>${label('02', es ? 'Agenda' : 'Calendar')}<h2 class="display-2 mt-2">${es ? 'Próximas actividades' : 'Upcoming activities'}</h2></div>
      <p>${es ? 'Las actividades se publican desde el panel de FRAME. Las plazas son limitadas cuando se indica.' : 'Activities are published from FRAME’s panel. Places are limited where stated.'}</p></div>
    ${events.length ? html`<div class="faq">${events.map((e) => {
      const left = e.capacity ? Math.max(0, e.capacity - e.signups) : null;
      return html`<details>
        <summary><span><span class="mono muted" style="display:block;margin-bottom:6px">${T.fmtDate(e.start_utc, lang, { weekday: 'long', day: 'numeric', month: 'long' })} · ${T.fmtTime(e.start_utc)}–${T.fmtTime(e.end_utc)}${e.lang_note ? ` · ${e.lang_note}` : ''}</span>${e[`title_${lang}`]}</span><span class="plus" aria-hidden="true"></span></summary>
        <div class="faq__a stack">
          <p style="color:var(--ink)">${e[`summary_${lang}`] || ''}</p>
          <p class="small">${e.location || 'FRAME · Rambla Juan Mateo García, 21'}${left !== null ? ` · ${left} ${es ? 'plazas libres' : 'places left'}` : ''}</p>
          ${left === 0 ? html`<p class="tag">${es ? 'Completo' : 'Full'}</p>` : html`
          <form class="form" data-ajax action="/api/events/${e.slug}/signup" data-ok="${es ? 'Inscripción registrada. Te hemos enviado un correo.' : 'Registration saved. We have sent you an email.'}" novalidate>
            <input type="hidden" name="_csrf" value="${csrf}">
            <div class="form-row">
              <div class="field"><label for="ev-${e.id}-name">${es ? 'Nombre' : 'Name'}</label><input id="ev-${e.id}-name" name="name" autocomplete="name" required></div>
              <div class="field"><label for="ev-${e.id}-email">Email</label><input id="ev-${e.id}-email" name="email" type="email" autocomplete="email" required></div>
            </div>
            <label class="check"><input type="checkbox" name="privacy" required><span>${es ? 'He leído la ' : 'I have read the '}<a href="${path('legal.privacy', lang)}">${es ? 'información de privacidad' : 'privacy information'}</a>.</span></label>
            <div>${button({ type: 'submit', label: es ? 'Apuntarme' : 'Sign me up', size: 'sm' })}</div>
            <p class="alert" data-form-result hidden tabindex="-1"></p>
          </form>`}
        </div>
      </details>`;
    })}</div>` : html`<div class="panel stack"><p class="lead" style="font-size:1.2rem">${es ? 'Todavía no hay actividades publicadas.' : 'No activities have been published yet.'}</p>
      <p class="muted">${es ? '¿Quieres proponer una charla, un taller o un encuentro? Escríbenos.' : 'Would you like to propose a talk, workshop or meetup? Write to us.'}</p>
      <div>${button({ href: `${path('contact', lang)}?asunto=comunidad`, label: es ? 'Proponer una actividad' : 'Propose an activity', variant: 'ghost', size: 'sm' })}</div></div>`}
  </div>
</section>`;

  return layout(ctx, req, res, {
    title: es ? 'Comunidad de coworking en Torrevieja · Actividades y agenda' : 'Coworking community in Torrevieja · Activities and calendar',
    description: es ? 'La comunidad de FRAME en Torrevieja: autónomos, profesionales en remoto y creadores de contenido. Propuesta de actividades en español e inglés y agenda.'
      : 'The FRAME community in Torrevieja: freelancers, remote professionals and content creators. Proposed activities in Spanish and English and calendar.',
    body, routeId: 'community',
    jsonld: events.map((e) => ({
      '@context': 'https://schema.org', '@type': 'Event', name: e[`title_${lang}`], startDate: new Date(e.start_utc).toISOString(), endDate: new Date(e.end_utc).toISOString(),
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: 'FRAME', address: { '@type': 'PostalAddress', streetAddress: 'Rambla Juan Mateo García, 21', postalCode: '03183', addressLocality: 'Torrevieja', addressCountry: 'ES' } },
      organizer: { '@type': 'Organization', name: 'FRAME', url: ctx.cfg.baseUrl },
    })),
  });
}
