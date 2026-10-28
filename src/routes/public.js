// Páginas públicas en español (raíz) e inglés (/en).
import { ROUTES } from '../i18n/routes.js';
import { renderHome } from '../views/pages/home.js';
import { renderSpacesIndex, renderSpace } from '../views/pages/spaces.js';
import { renderPricing } from '../views/pages/pricing.js';
import { renderCommunity } from '../views/pages/community.js';
import { renderContact } from '../views/pages/contact.js';
import { renderLegal } from '../views/pages/legal.js';
import { renderBook } from '../views/pages/book.js';

export function publicRoutes(app, ctx) {
  const page = (id, fn) => {
    for (const p of Object.values(ROUTES[id])) {
      app.get(p, (req, res, next) => {
        const out = fn(req, res);
        if (out === null) return next();
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(out);
      });
    }
  };
  page('home', (req, res) => renderHome(ctx, req, res));
  page('spaces', (req, res) => renderSpacesIndex(ctx, req, res));
  for (const slug of ['coworking', 'salas', 'despachos', 'estudio']) page(`space.${slug}`, (req, res) => renderSpace(ctx, req, res, slug));
  page('pricing', (req, res) => renderPricing(ctx, req, res));
  page('community', (req, res) => renderCommunity(ctx, req, res));
  page('contact', (req, res) => renderContact(ctx, req, res));
  page('book', (req, res) => renderBook(ctx, req, res));
  for (const w of ['notice', 'privacy', 'cookies', 'terms']) page(`legal.${w}`, (req, res) => renderLegal(ctx, req, res, w));
  app.get('/en/', (req, res) => res.redirect(301, '/en'));
}
