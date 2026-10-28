// Piezas reutilizables de interfaz.
import { html, raw, attrs } from '../lib/html.js';
import * as T from '../lib/time.js';

export const icon = {
  arrow: raw('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" stroke-width="1.6"/></svg>'),
  user: raw('<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="7" r="3.4" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 17c1.2-3 3.6-4.4 6.5-4.4s5.3 1.4 6.5 4.4" stroke="currentColor" stroke-width="1.5"/></svg>'),
  menu: raw('<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 7h14M3 13h14" stroke="currentColor" stroke-width="1.6"/></svg>'),
  close: raw('<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="18" height="18"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6"/></svg>'),
  pin: raw('<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="18" height="18"><path d="M10 18s6-5.2 6-10A6 6 0 0 0 4 8c0 4.8 6 10 6 10Z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5"/></svg>'),
  check: raw('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="14" height="14"><path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" stroke-width="1.8"/></svg>'),
};

// Botón con animación de texto y círculo con flecha.
export function button({ href, label, variant = '', type, attrs: extra = {}, size = '', block = false, iconName = 'arrow', cls: extraCls = '' }) {
  const cls = ['btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', extraCls].filter(Boolean).join(' ');
  const inner = html`<span class="btn__roll"><span>${label}</span><span aria-hidden="true">${label}</span></span><span class="btn__icon">${icon[iconName]}</span>`;
  if (href) return html`<a class="${cls}" href="${href}"${attrs(extra)}>${inner}</a>`;
  return html`<button class="${cls}" type="${type || 'button'}"${attrs(extra)}>${inner}</button>`;
}

export function label(idx, text) {
  return html`<span class="label">${idx ? html`<span class="idx">${idx}</span>` : ''}<span>${text}</span></span>`;
}

// Imagen con marcas de encuadre y aviso de imagen conceptual.
export function media(m, lang, { cls = '', ratio, eager = false, note, sizes = '100vw', rec = false } = {}) {
  if (!m) return html`<div class="media frame ${cls}"${ratio ? raw(` style="aspect-ratio:${ratio}"`) : ''}><span class="frame__c"></span></div>`;
  const alt = m[`alt_${lang}`] || m.alt_es;
  return html`<figure class="media frame ${cls}" style="margin:0${ratio ? `;aspect-ratio:${ratio}` : ''}">
    <span class="frame__c"></span>
    <img src="${m.path}" alt="${alt}" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')} decoding="async" sizes="${sizes}"${m.width ? raw(` width="${m.width}" height="${m.height}"`) : ''}>
    ${rec ? html`<span class="media__rec" aria-hidden="true"><span class="rec-dot rec-dot--live"></span> REC</span>` : ''}
    ${m.is_concept ? html`<figcaption class="media__note">${note}</figcaption>` : ''}
  </figure>`;
}

export function hoursRows(hours, lang, todayWd) {
  const names = lang === 'en'
    ? { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
    : { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };
  return T.WEEK_ORDER.map((wd) => {
    const k = T.WEEKDAY_KEYS[wd];
    const ranges = hours[k] || [];
    const txt = ranges.length ? ranges.map((r) => `${r[0]}–${r[1]}`).join(' · ') : (lang === 'en' ? 'Closed' : 'Cerrado');
    return html`<tr class="${wd === todayWd ? 'is-today' : ''}"><th scope="row">${names[k]}</th><td>${txt}</td></tr>`;
  });
}

// Resumen compacto de un horario semanal: "L–V 09:00–14:00 · 16:00–19:00"
export function hoursSummary(hours, lang) {
  const groups = [];
  for (const wd of T.WEEK_ORDER) {
    const k = T.WEEKDAY_KEYS[wd];
    const txt = (hours[k] || []).map((r) => `${r[0]}–${r[1]}`).join(' · ');
    const last = groups[groups.length - 1];
    if (last && last.txt === txt) last.to = k; else groups.push({ from: k, to: k, txt });
  }
  const ab = lang === 'en' ? { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } : { mon: 'L', tue: 'M', wed: 'X', thu: 'J', fri: 'V', sat: 'S', sun: 'D' };
  return groups.filter((g) => g.txt).map((g) => `${ab[g.from]}${g.from !== g.to ? `–${ab[g.to]}` : ''} ${g.txt}`).join(' / ');
}

export function breadcrumbs(items) {
  return html`<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items.map(([href, text], i) => html`<li>${i < items.length - 1 ? html`<a href="${href}">${text}</a>` : html`<span aria-current="page">${text}</span>`}</li>`)}</ol></nav>`;
}

export function mapsLinks(address, lang) {
  const q = encodeURIComponent(address);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    apple: `https://maps.apple.com/?q=${q}`,
    osm: `https://www.openstreetmap.org/search?query=${q}`,
  };
}
