// Plantilla común de las páginas públicas.
import { html, raw, jsonForScript } from '../lib/html.js';
import { path, findRoute, ROUTES } from '../i18n/routes.js';
import { icon, button } from './components.js';
import * as T from '../lib/time.js';

const NAV = [
  ['spaces', { es: 'Espacios', en: 'Spaces' }],
  ['pricing', { es: 'Tarifas', en: 'Pricing' }],
  ['community', { es: 'Comunidad', en: 'Community' }],
  ['contact', { es: 'Contacto', en: 'Contact' }],
];

export function localBusinessLd(ctx, lang) {
  const b = ctx.settings.get('business');
  const hours = ctx.settings.get('hours');
  const base = ctx.cfg.baseUrl;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${base}/#frame`,
    name: b.brand,
    legalName: b.legal_name,
    description: lang === 'en' ? 'Coworking, meeting rooms, private offices and a podcast & video studio in Torrevieja.' : 'Coworking, salas de reuniones, despachos privados y estudio de pódcast y vídeo en Torrevieja.',
    url: `${base}${path('home', lang)}`,
    telephone: b.phone,
    email: b.email,
    image: `${base}/img/renders/hero.webp`,
    logo: `${base}/brand/frame-logo-dark.svg`,
    address: { '@type': 'PostalAddress', streetAddress: b.street, postalCode: b.postal_code, addressLocality: b.city, addressRegion: b.province, addressCountry: 'ES' },
    areaServed: { '@type': 'City', name: 'Torrevieja' },
  };
  // Solo se publican horarios confirmados por FRAME.
  if (hours.confirmed) {
    const map = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    ld.openingHoursSpecification = Object.entries(hours.reception).flatMap(([k, ranges]) => ranges.map((r) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: map[k], opens: r[0], closes: r[1] })));
  }
  const links = [b.instagram, b.linkedin].filter(Boolean);
  if (links.length) ld.sameAs = links;
  return ld;
}

export function layout(ctx, req, res, opts) {
  const { title, description, body, routeId, bodyClass = '', noindex = false, jsonld = [], scripts = [], alt, ogImage, hideFab = false } = opts;
  const lang = req.lang || 'es';
  const es = lang !== 'en';
  const base = ctx.cfg.baseUrl;
  const v = res.locals.assetVersion;
  const b = ctx.settings.get('business');
  const hours = ctx.settings.get('hours');
  const route = routeId ? { id: routeId } : findRoute(req.path);
  const alternates = alt || (route && ROUTES[route.id] ? { es: ROUTES[route.id].es, en: ROUTES[route.id].en } : null);
  const canonical = `${base}${alternates ? alternates[lang] : req.path}`;
  const fullTitle = title.includes('FRAME') ? title : `${title} · FRAME`;
  const navActive = (id) => route && (route.id === id || route.id.startsWith(`${id === 'spaces' ? 'space' : id}.`) || (id === 'spaces' && route.id.startsWith('space.')));
  const nowParts = T.zonedParts(ctx.now());
  const consent = req.cookies.frame_consent;
  const analytics = ctx.settings.get('analytics');
  const testMode = ctx.payments.testMode || !ctx.mail.configured;

  return '<!doctype html>' + html`
<html lang="${lang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<link rel="canonical" href="${canonical}">
${alternates ? html`<link rel="alternate" hreflang="es" href="${base}${alternates.es}"><link rel="alternate" hreflang="en" href="${base}${alternates.en}"><link rel="alternate" hreflang="x-default" href="${base}${alternates.es}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="FRAME">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${base}${ogImage || '/img/renders/hero.webp'}">
<meta property="og:locale" content="${es ? 'es_ES' : 'en_GB'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F3EFE7">
<meta name="csrf-token" content="${res.locals.csrfPublic}">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/archivo-wdth.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=${v}">
<script nonce="${res.locals.nonce}">document.documentElement.classList.replace('no-js','js');</script>
<script type="application/ld+json">${jsonForScript(localBusinessLd(ctx, lang))}</script>
${jsonld.map((j) => html`<script type="application/ld+json">${jsonForScript(j)}</script>`)}
</head>
<body class="${bodyClass}" data-lang="${lang}" data-hours="${JSON.stringify(hours.reception)}" data-analytics="${analytics.provider !== 'none' && analytics.site_id ? JSON.stringify(analytics) : ''}">
<a class="skip-link" href="#main">${es ? 'Saltar al contenido' : 'Skip to content'}</a>
<header class="site-header">
  <div class="nav" role="navigation" aria-label="${es ? 'Principal' : 'Main'}">
    <a class="nav__logo" href="${path('home', lang)}" aria-label="FRAME — ${es ? 'inicio' : 'home'}"><img src="/brand/frame-logo-compact-dark.svg" alt="FRAME" width="120" height="26"></a>
    <ul class="nav__links">
      ${NAV.map(([id, l]) => html`<li><a href="${path(id, lang)}"${navActive(id) ? raw(' aria-current="page"') : ''}>${l[lang]}</a></li>`)}
    </ul>
    <div class="nav__meta">
      <span class="nav__status" data-status aria-live="polite"><span class="rec-dot"></span><span data-status-text>${es ? 'Torrevieja' : 'Torrevieja'} ${nowParts.time}</span></span>
      <a class="nav__lang" href="${alternates ? alternates[es ? 'en' : 'es'] : path('home', es ? 'en' : 'es')}" hreflang="${es ? 'en' : 'es'}" lang="${es ? 'en' : 'es'}">${es ? 'EN' : 'ES'}</a>
      <a class="nav__account" href="${path('account', lang)}" aria-label="${es ? 'Mi cuenta' : 'My account'}">${icon.user}</a>
      ${button({ href: path('book', lang), label: es ? 'Reservar' : 'Book', size: 'sm' })}
      <button class="nav__menu-btn" type="button" aria-expanded="false" aria-controls="mobile-menu" data-menu-open>${icon.menu}<span>${es ? 'Menú' : 'Menu'}</span></button>
    </div>
  </div>
</header>

<div class="mobile-menu" id="mobile-menu" aria-hidden="true">
  <div class="mobile-menu__backdrop" data-menu-close></div>
  <div class="mobile-menu__sheet" role="dialog" aria-modal="true" aria-label="${es ? 'Menú' : 'Menu'}">
    <div class="mobile-menu__top">
      <span class="label"><span class="rec-dot"></span><span data-status-text>Torrevieja ${nowParts.time}</span></span>
      <button class="mobile-menu__close" type="button" data-menu-close aria-label="${es ? 'Cerrar menú' : 'Close menu'}">${icon.close}</button>
    </div>
    <nav aria-label="${es ? 'Menú móvil' : 'Mobile menu'}"><ul>
      ${[...NAV, ['account', { es: 'Mi cuenta', en: 'My account' }]].map(([id, l], i) => html`<li><a href="${path(id, lang)}">${l[lang]}<span class="mono">0${i + 1}</span></a></li>`)}
    </ul></nav>
    <div class="mobile-menu__foot">
      ${button({ href: path('book', lang), label: es ? 'Reservar espacio' : 'Book a space', block: true })}
      <div class="flex between center"><a href="tel:${b.phone.replace(/\s/g, '')}" class="small">${b.phone}</a><a class="nav__lang" style="display:inline-block" href="${alternates ? alternates[es ? 'en' : 'es'] : path('home', es ? 'en' : 'es')}" hreflang="${es ? 'en' : 'es'}">${es ? 'English' : 'Español'}</a></div>
    </div>
  </div>
</div>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <img src="/brand/frame-logo-light.svg" alt="FRAME · Estudio de contenido y coworking" width="229" height="56" loading="lazy">
        <address>
          ${b.legal_name}<br>${b.street}<br>${b.postal_code} ${b.city} (${b.province}), ${b.country}<br>
          <a href="tel:${b.phone.replace(/\s/g, '')}">${b.phone}</a> · <a href="mailto:${b.email}">${b.email}</a>
        </address>
      </div>
      <div><h2>FRAME</h2><ul>
        <li><a href="${path('spaces', lang)}">${es ? 'Espacios' : 'Spaces'}</a></li>
        <li><a href="${path('pricing', lang)}">${es ? 'Planes y tarifas' : 'Plans & pricing'}</a></li>
        <li><a href="${path('community', lang)}">${es ? 'Comunidad' : 'Community'}</a></li>
        <li><a href="${path('contact', lang)}">${es ? 'Ubicación y contacto' : 'Location & contact'}</a></li>
      </ul></div>
      <div><h2>${es ? 'Reservas' : 'Bookings'}</h2><ul>
        <li><a href="${path('book', lang)}">${es ? 'Reservar espacio' : 'Book a space'}</a></li>
        <li><a href="${path('book', lang)}?servicio=visit">${es ? 'Reservar visita' : 'Book a tour'}</a></li>
        <li><a href="${path('book', lang)}?servicio=trial">${es ? 'Día de prueba' : 'Trial day'}</a></li>
        <li><a href="${path('account', lang)}">${es ? 'Mi cuenta' : 'My account'}</a></li>
      </ul></div>
      <div><h2>Legal</h2><ul>
        <li><a href="${path('legal.notice', lang)}">${es ? 'Aviso legal' : 'Legal notice'}</a></li>
        <li><a href="${path('legal.privacy', lang)}">${es ? 'Privacidad' : 'Privacy'}</a></li>
        <li><a href="${path('legal.cookies', lang)}">Cookies</a></li>
        <li><a href="${path('legal.terms', lang)}">${es ? 'Condiciones de contratación' : 'Terms of purchase'}</a></li>
      </ul></div>
    </div>
    <div class="footer-word" aria-hidden="true">FRAME</div>
    <div class="footer-bottom">
      <span>© ${nowParts.year} ${b.legal_name} · NIF ${b.tax_id}</span>
      <ul>
        <li><button type="button" data-cookie-settings>${es ? 'Preferencias de cookies' : 'Cookie preferences'}</button></li>
        <li><a href="${alternates ? alternates[es ? 'en' : 'es'] : path('home', es ? 'en' : 'es')}" hreflang="${es ? 'en' : 'es'}">${es ? 'English' : 'Español'}</a></li>
        ${testMode ? html`<li><span class="tag" style="border-color:#5B544B;color:#B7AFA3">${es ? 'Entorno de prueba' : 'Test environment'}</span></li>` : ''}
      </ul>
    </div>
  </div>
</footer>

${hideFab ? '' : button({ href: path('book', lang), label: es ? 'Reservar' : 'Book', variant: 'rec', cls: 'book-fab', attrs: { 'data-fab': true } })}

${cookieBanner(lang, consent)}
<script nonce="${res.locals.nonce}" src="/js/site.js?v=${v}" defer></script>
${scripts.map((s) => html`<script nonce="${res.locals.nonce}" src="${s}?v=${v}" ${raw(s.endsWith('.mjs') ? 'type="module"' : 'defer')}></script>`)}
</body>
</html>`;
}

function cookieBanner(lang, consent) {
  const es = lang !== 'en';
  return html`
<section class="cookie-banner${consent ? '' : ' is-visible'}" data-cookie-banner aria-labelledby="cookie-title" role="region">
  <h2 id="cookie-title">${es ? 'Tu privacidad' : 'Your privacy'}</h2>
  <p>${es ? 'Usamos cookies técnicas necesarias para que la web funcione (sesión, seguridad e idioma). Con tu permiso, también podríamos usar cookies de medición y cargar el mapa de Google, que instala cookies de terceros. Puedes cambiar tu elección cuando quieras.' : 'We use necessary technical cookies so the site works (session, security and language). With your permission, we may also use measurement cookies and load the Google map, which sets third-party cookies. You can change your choice at any time.'}
  <a href="${path('legal.cookies', lang)}">${es ? 'Más información' : 'More information'}</a>.</p>
  <div class="cookie-actions">
    <button type="button" class="equal" data-cookie="reject">${es ? 'Rechazar' : 'Reject'}</button>
    <button type="button" class="equal" data-cookie="accept">${es ? 'Aceptar' : 'Accept'}</button>
    <button type="button" class="cfg" data-cookie-settings>${es ? 'Configurar' : 'Settings'}</button>
  </div>
</section>
<dialog class="cookie-dialog" data-cookie-dialog aria-labelledby="cookie-dlg-title">
  <form method="dialog">
    <h2 id="cookie-dlg-title" class="display-3" style="font-size:1.6rem">${es ? 'Preferencias de cookies' : 'Cookie preferences'}</h2>
    <div class="cookie-cat"><label>${es ? 'Necesarias' : 'Necessary'} <input class="switch" type="checkbox" checked disabled></label><p>${es ? 'Sesión, seguridad de formularios, idioma y tu elección de cookies. Siempre activas.' : 'Session, form security, language and your cookie choice. Always on.'}</p></div>
    <div class="cookie-cat"><label for="ck-analytics">${es ? 'Medición' : 'Measurement'} <input class="switch" id="ck-analytics" type="checkbox" name="analytics"></label><p>${es ? 'Estadísticas de uso para mejorar la web. Solo se cargan si las activas.' : 'Usage statistics to improve the site. Only loaded if you enable them.'}</p></div>
    <div class="cookie-cat"><label for="ck-maps">${es ? 'Mapas de terceros' : 'Third-party maps'} <input class="switch" id="ck-maps" type="checkbox" name="maps"></label><p>${es ? 'Mapa interactivo de Google Maps en la página de contacto.' : 'Interactive Google Maps map on the contact page.'}</p></div>
    <div class="cookie-actions" style="grid-template-columns:1fr 1fr">
      <button type="button" class="equal" data-cookie="reject" style="border-color:var(--ink);background:var(--ink);color:var(--paper)">${es ? 'Rechazar todas' : 'Reject all'}</button>
      <button type="button" class="equal" data-cookie="save" style="border-color:var(--ink);background:var(--ink);color:var(--paper)">${es ? 'Guardar selección' : 'Save selection'}</button>
    </div>
  </form>
</dialog>`;
}
