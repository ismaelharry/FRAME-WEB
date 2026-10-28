import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label, breadcrumbs } from '../components.js';
import { path } from '../../i18n/routes.js';
import { priceLabel, taxNote, conditionsFor } from '../../services/pricing.js';
import { commerceState } from '../../services/settings.js';
import { priceAmount } from './home.js';

export function renderPricing(ctx, req, res) {
  const lang = req.lang;
  const es = lang !== 'en';
  const { catalog, settings } = ctx;
  const P = (s) => catalog.product(s);
  const pol = settings.get('policies');
  const commerce = commerceState(settings, ctx.payments);
  const cols = ['pase-dia', 'bono-10', 'mesa-flexible', 'mesa-fija'].map(P).filter(Boolean);
  const bono = P('bono-10');
  const yes = (t) => ({ cls: 'yes', t });
  const commitments = settings.get('plans').commitment_months || {};
  const commit = (type) => {
    const m = commitments[type];
    if (m === 0) return { cls: 'yes', t: es ? 'Sin permanencia' : 'None' };
    if (m > 0) return { t: es ? `${m} meses` : `${m} months` };
    return { cls: 'no', t: es ? 'A confirmar' : 'To be confirmed' };
  };
  const no = (t) => ({ cls: 'no', t });
  const rows = [
    [es ? 'Puesto' : 'Desk', [yes(es ? 'Cualquier puesto libre' : 'Any free desk'), yes(es ? 'Cualquier puesto libre' : 'Any free desk'), yes(es ? 'Cualquier puesto libre' : 'Any free desk'), yes(es ? 'Puesto asignado' : 'Assigned desk')]],
    [es ? 'Acceso' : 'Access', [no(es ? 'Horario de coworking' : 'Coworking hours'), no(es ? 'Horario de coworking' : 'Coworking hours'), no(es ? 'Horario de coworking' : 'Coworking hours'), yes('24/7')]],
    [es ? 'Duración' : 'Duration', [{ t: es ? '1 día' : '1 day' }, { t: es ? `10 días · validez ${bono?.validity_days || pol.voucher_validity_days} días` : `10 days · valid ${bono?.validity_days || pol.voucher_validity_days} days` }, { t: es ? 'Mensual' : 'Monthly' }, { t: es ? 'Mensual' : 'Monthly' }]],
    [es ? 'Permanencia' : 'Minimum stay', [{ t: '—' }, { t: '—' }, commit('flex'), commit('fixed')]],
    [es ? 'Reserva de días' : 'Booking days', [{ t: es ? 'Al reservar el pase' : 'When booking' }, { t: es ? 'Desde Mi cuenta, 1 día por reserva' : 'From My account, 1 day each' }, { t: es ? 'Desde Mi cuenta, incluido' : 'From My account, included' }, { t: es ? 'No hace falta' : 'Not needed' }]],
    [es ? 'Salas y estudio' : 'Rooms & studio', [no(es ? 'Se reservan aparte' : 'Booked separately'), no(es ? 'Se reservan aparte' : 'Booked separately'), no(es ? 'Se reservan aparte' : 'Booked separately'), no(es ? 'Se reservan aparte' : 'Booked separately')]],
    [es ? 'Cómo se contrata' : 'How to get it', [{ t: es ? 'Reserva online por día' : 'Online booking per day' }, { t: commerce.canSell ? (es ? 'Compra online' : 'Online purchase') : (es ? 'Solicitud online' : 'Online request') }, { t: es ? 'Alta con fecha de inicio' : 'Sign up with a start date' }, { t: es ? 'Alta con fecha de inicio' : 'Sign up with a start date' }]],
  ];
  const ctas = {
    'pase-dia': `${path('book', lang)}?servicio=pass`, 'bono-10': `${path('book', lang)}?servicio=bundle`,
    'mesa-flexible': `${path('book', lang)}?servicio=plan-flex`, 'mesa-fija': `${path('book', lang)}?servicio=plan-fixed`,
  };
  const others = [
    ['sala-reuniones', `${path('book', lang)}?servicio=room`, es ? 'Por horas, mínimo 1 h' : 'By the hour, 1 h minimum'],
    ['cabina', `${path('book', lang)}?servicio=booth`, es ? 'Por franjas de 30 min' : 'In 30-min slots'],
    ['estudio', `${path('book', lang)}?servicio=studio`, es ? 'Sesiones por horas' : 'Hourly sessions'],
    ['despacho', `${path('contact', lang)}?asunto=despacho#presupuesto`, es ? 'Por meses, según equipo' : 'Monthly, by team size'],
    ['visita', `${path('book', lang)}?servicio=visit`, es ? 'Sin compromiso' : 'No obligation'],
    ['dia-prueba', `${path('book', lang)}?servicio=trial`, es ? 'Uno por persona' : 'One per person'],
  ].filter(([s]) => P(s)?.active && (s !== 'dia-prueba' || settings.get('trial').enabled));
  const ov = P('oficina-virtual');

  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path('pricing', lang), es ? 'Planes y tarifas' : 'Plans & pricing']])}
  ${label('', es ? 'Planes y tarifas' : 'Plans & pricing')}
  <h1 class="display-2 mt-2 balance">${es ? 'Tarifas de coworking en Torrevieja' : 'Coworking prices in Torrevieja'}</h1>
  <div class="page-hero__intro"><p>${ctx.content.get('pricing.intro', lang)}</p><p class="small">${taxNote(ctx, lang)}</p></div>
  ${!commerce.canSell ? html`<div class="note note--warn mt-3 small">${es ? 'Las compras online todavía no están activas. Puedes enviar tu solicitud ahora: no se cobra nada y te confirmamos precio final con impuestos, fecha y condiciones antes de contratar.' : 'Online purchases are not active yet. You can send your request now: nothing is charged and we confirm the final price including tax, date and conditions before you sign up.'}</div>` : ''}
</section>

<section class="wrap section--tight">
  <div class="table-scroll" role="region" aria-label="${es ? 'Comparativa de planes' : 'Plan comparison'}" tabindex="0">
    <table class="compare">
      <caption class="sr-only">${es ? 'Comparativa entre pase de día, bono, mesa flexible y mesa fija' : 'Comparison of day pass, 10-day pass, flexible desk and fixed desk'}</caption>
      <thead><tr><td></td>${cols.map((p) => html`<th scope="col" class="${p.featured ? 'is-featured' : ''}">${p.featured ? html`<span class="tag" style="border-color:var(--rec-glow);color:var(--rec-glow);margin-bottom:10px">${es ? 'Plan principal' : 'Main plan'}</span><br>` : ''}${p[`name_${lang}`]}${priceAmount(ctx, p, lang)}</th>`)}</tr></thead>
      <tbody>
        ${rows.map(([name, cells]) => html`<tr><th scope="row">${name}</th>${cells.map((c, i) => html`<td class="${[c.cls, cols[i]?.featured ? 'is-featured' : ''].filter(Boolean).join(' ')}">${c.t}</td>`)}</tr>`)}
        <tr><th scope="row"></th>${cols.map((p) => html`<td class="${p.featured ? 'is-featured' : ''}">${button({ href: ctas[p.slug], label: p.kind === 'plan' ? (es ? 'Solicitar alta' : 'Sign up') : p.kind === 'bundle' ? (commerce.canSell ? (es ? 'Comprar bono' : 'Buy pass') : (es ? 'Solicitar bono' : 'Request pass')) : (es ? 'Reservar día' : 'Book a day'), size: 'sm', variant: p.featured ? 'light' : '' })}</td>`)}</tr>
      </tbody>
    </table>
  </div>
  ${cols.some((p) => p.featured) ? html`<p class="small muted mt-2">${es ? 'La mesa flexible permite utilizar cualquier puesto libre, sin permanencia. Todos los planes comparten el mismo inventario de puestos: nunca vendemos más sitios de los que hay.' : 'The flexible desk lets you use any free desk, with no minimum stay. All plans share the same desk inventory: we never sell more places than there are.'}</p>` : ''}
</section>

<section class="section">
  <div class="wrap two-col">
    <div>
      ${label('', es ? 'Servicio independiente' : 'Separate service')}
      ${ov ? html`<div class="panel mt-2 stack" style="--stack:1rem">
        <div class="flex between center wrap-row gap-1"><h2 class="display-3" style="font-size:1.8rem">${ov[`name_${lang}`]}</h2>${priceAmount(ctx, ov, lang)}</div>
        <p>${ov[`summary_${lang}`]}</p>
        <ul class="list-dash small">${ov.includes[lang].map((x) => html`<li>${x}</li>`)}</ul>
        <p class="small muted">${ov[`how_${lang}`]}</p>
        ${button({ href: `${path('book', lang)}?servicio=plan-virtual`, label: es ? 'Solicitar oficina virtual' : 'Request a virtual office' })}
      </div>` : ''}
    </div>
    <div>
      ${label('', es ? 'Por horas y bajo presupuesto' : 'Hourly and on request')}
      <ul class="list-dash mt-2">${others.map(([slug, href, sub]) => { const p = P(slug); return html`<li><a href="${href}" style="flex:1;display:flex;justify-content:space-between;gap:12px;text-decoration:none"><span><strong style="font-weight:500">${p[`name_${lang}`]}</strong><br><span class="small muted">${sub}</span></span><span class="tabular">${priceLabel(ctx, p, lang)}</span></a></li>`; })}</ul>
    </div>
  </div>
</section>

<section class="section section--paper2">
  <div class="wrap">
    <div class="sec-head"><div>${label('', es ? 'Cómo se contrata' : 'How it works')}<h2 class="display-2 mt-2">${es ? 'En cuatro pasos' : 'In four steps'}</h2></div><p>${es ? 'Siempre ves el resumen y las condiciones antes de confirmar.' : 'You always see the summary and conditions before confirming.'}</p></div>
    <div class="why">
      ${(es ? [['Elige', 'Servicio, fecha, horario y personas. La disponibilidad es real.'], ['Tus datos', 'Nombre, correo y teléfono. Sin crear cuenta.'], ['Revisa', 'Espacio, horario, condiciones y precio final cuando esté disponible.'], ['Confirma', 'Pagas en la pasarela segura o envías la solicitud sin cargo. Recibes una referencia.']]
        : [['Choose', 'Service, date, time and people. Availability is real.'], ['Your details', 'Name, email and phone. No account needed.'], ['Review', 'Space, time, conditions and final price when available.'], ['Confirm', 'Pay on the secure gateway or send the request at no charge. You get a reference.']])
        .map(([t, d], i) => html`<div class="why__item"><span class="why__num">0${i + 1}</span><h3>${t}</h3><p>${d}</p></div>`)}
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap two-col">
    <div>${label('', es ? 'Condiciones' : 'Conditions')}<h2 class="display-3 mt-2">${es ? 'Antes de contratar' : 'Before you buy'}</h2></div>
    <div class="stack" style="--stack:1.4rem">
      ${[[es ? 'Reservas de días y salas' : 'Day and room bookings', conditionsFor(ctx, { product: P('sala-reuniones'), usage: 'hourly', mode: commerce.canSell ? 'pay' : 'request', lang })],
        [es ? 'Bono de 10 días' : '10-day pass', conditionsFor(ctx, { product: bono, usage: 'bundle_purchase', mode: commerce.canSell ? 'pay' : 'request', lang })],
        [es ? 'Planes mensuales y renovaciones' : 'Monthly plans and renewals', conditionsFor(ctx, { product: P('mesa-flexible'), usage: 'plan_purchase', mode: commerce.canSell ? 'pay' : 'request', lang })]]
        .map(([t, txt]) => html`<div class="panel"><h3 style="font-size:1.15rem;font-weight:550;margin-bottom:10px">${t}</h3><ul class="list-dash small">${txt.split('\n').map((l) => html`<li>${l}</li>`)}</ul></div>`)}
      <p class="small">${es ? 'Consulta las ' : 'Read the full '}<a href="${path('legal.terms', lang)}">${es ? 'condiciones de contratación completas' : 'terms of purchase'}</a>.</p>
    </div>
  </div>
</section>`;

  return layout(ctx, req, res, {
    title: es ? 'Tarifas de coworking en Torrevieja: pase de día, bono y mesa flexible' : 'Coworking prices in Torrevieja: day pass, 10-day pass and flexible desk',
    description: es ? 'Compara precios del coworking FRAME en Torrevieja: pase de día, bono de 10 días, mesa flexible sin permanencia, mesa fija 24/7, oficina virtual y salas por horas.'
      : 'Compare FRAME coworking prices in Torrevieja: day pass, 10-day pass, flexible desk with no minimum stay, fixed desk 24/7, virtual office and hourly rooms.',
    body, routeId: 'pricing',
  });
}
