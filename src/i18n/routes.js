// Rutas públicas por idioma. Español en la raíz, inglés bajo /en.
export const ROUTES = {
  home: { es: '/', en: '/en' },
  spaces: { es: '/espacios', en: '/en/spaces' },
  'space.coworking': { es: '/espacios/coworking', en: '/en/spaces/coworking' },
  'space.salas': { es: '/espacios/salas-de-reuniones', en: '/en/spaces/meeting-rooms' },
  'space.despachos': { es: '/espacios/despachos-privados', en: '/en/spaces/private-offices' },
  'space.estudio': { es: '/espacios/estudio-podcast-video', en: '/en/spaces/podcast-video-studio' },
  pricing: { es: '/tarifas', en: '/en/pricing' },
  book: { es: '/reservar', en: '/en/book' },
  community: { es: '/comunidad', en: '/en/community' },
  contact: { es: '/contacto', en: '/en/contact' },
  account: { es: '/cuenta', en: '/en/account' },
  manage: { es: '/reserva', en: '/en/booking' },
  plan: { es: '/plan', en: '/en/plan' },
  receipt: { es: '/justificante', en: '/en/receipt' },
  'legal.notice': { es: '/legal/aviso-legal', en: '/en/legal/legal-notice' },
  'legal.privacy': { es: '/legal/privacidad', en: '/en/legal/privacy' },
  'legal.cookies': { es: '/legal/cookies', en: '/en/legal/cookies' },
  'legal.terms': { es: '/legal/condiciones', en: '/en/legal/terms' },
};

export const SPACE_ROUTE = { coworking: 'space.coworking', salas: 'space.salas', despachos: 'space.despachos', estudio: 'space.estudio' };

export function path(id, lang = 'es', suffix = '') {
  const r = ROUTES[id];
  if (!r) throw new Error(`Ruta desconocida: ${id}`);
  const base = r[lang] || r.es;
  if (!suffix) return base;
  return `${base === '/' ? '' : base}${suffix.startsWith('/') || suffix.startsWith('?') || suffix.startsWith('#') ? suffix : `/${suffix}`}`;
}

// Busca la ruta equivalente en el otro idioma para el selector de idioma y hreflang.
export function findRoute(pathname) {
  for (const [id, langs] of Object.entries(ROUTES)) {
    for (const [lang, p] of Object.entries(langs)) {
      if (p === pathname) return { id, lang };
    }
  }
  return null;
}
