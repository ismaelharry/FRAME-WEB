// robots.txt y sitemap.xml con versiones en español e inglés (hreflang).
import { ROUTES } from '../i18n/routes.js';

const PUBLIC_IDS = ['home', 'spaces', 'space.coworking', 'space.salas', 'space.despachos', 'space.estudio', 'pricing', 'book', 'community', 'contact',
  'legal.notice', 'legal.privacy', 'legal.cookies', 'legal.terms'];

export function seoRoutes(app, ctx) {
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /api/',
      'Disallow: /cuenta', 'Disallow: /en/account',
      'Disallow: /reserva/', 'Disallow: /en/booking/',
      'Disallow: /pedido/', 'Disallow: /pagar/', 'Disallow: /pago-prueba/', 'Disallow: /justificante/', 'Disallow: /en/receipt/',
      `Sitemap: ${ctx.cfg.baseUrl}/sitemap.xml`, '',
    ].join('\n'));
  });

  app.get('/sitemap.xml', (req, res) => {
    const base = ctx.cfg.baseUrl;
    const priority = (id) => (id === 'home' ? '1.0' : id.startsWith('legal') ? '0.2' : id.startsWith('space') || id === 'pricing' || id === 'book' ? '0.9' : '0.7');
    const urls = PUBLIC_IDS.flatMap((id) => ['es', 'en'].map((lang) => `  <url>
    <loc>${base}${ROUTES[id][lang]}</loc>
    <xhtml:link rel="alternate" hreflang="es" href="${base}${ROUTES[id].es}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${base}${ROUTES[id].en}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${base}${ROUTES[id].es}"/>
    <changefreq>${id.startsWith('legal') ? 'yearly' : 'weekly'}</changefreq>
    <priority>${priority(id)}</priority>
  </url>`));
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`);
  });

  app.get('/healthz', (req, res) => { ctx.db.get('SELECT 1 AS ok'); res.json({ ok: true }); });
}
