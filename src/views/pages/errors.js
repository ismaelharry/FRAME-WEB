import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label } from '../components.js';
import { path } from '../../i18n/routes.js';
import { errorMessage } from '../../i18n/ui.js';

export function renderError(ctx, req, res, status, code, details) {
  const lang = req.lang || 'es';
  const es = lang !== 'en';
  const title = status === 404 ? (es ? 'Página no encontrada' : 'Page not found') : status === 403 ? (es ? 'Acceso no permitido' : 'Access denied') : (es ? 'Algo no ha ido bien' : 'Something went wrong');
  const msg = status === 404 ? (es ? 'La dirección no existe o ha cambiado. Puedes volver al inicio o ir directamente a reservar.' : 'The address does not exist or has changed. Go back home or straight to booking.')
    : errorMessage(lang, code || (status >= 500 ? 'SERVER_ERROR' : 'FORBIDDEN'), details);
  try {
    if (!res.locals.csrfPublic) res.locals.csrfPublic = '';
    if (!res.locals.nonce) res.locals.nonce = '';
    return layout(ctx, req, res, {
      title, description: title, noindex: true,
      body: html`<section class="page-hero wrap" style="min-height:60vh">${label(String(status), es ? 'Error' : 'Error')}<h1 class="display-2 mt-2">${title}</h1><p class="lead mt-3">${msg}</p>
        <div class="btn-row mt-4">${button({ href: path('home', lang), label: es ? 'Ir al inicio' : 'Go home', variant: 'ghost' })}${button({ href: path('book', lang), label: es ? 'Reservar' : 'Book' })}</div></section>`,
    });
  } catch {
    return `<!doctype html><title>${status}</title><p>${status}</p>`;
  }
}
