// Administración · contenidos de la web: textos, fichas de espacios, preguntas, eventos y fotos.
import fs from 'node:fs';
import path from 'node:path';
import Busboy from 'busboy';
import { html, raw } from '../../lib/html.js';
import { AppError, randomToken, slugify } from '../../lib/util.js';
import { verifyCsrf } from '../../lib/security.js';
import * as T from '../../lib/time.js';
import { CONTENT } from '../../content/defaults.js';
import { field, postForm, actionButton, empty, dt } from '../../views/admin/ui.js';

const MAX_UPLOAD = 8 * 1024 * 1024;
const SLOTS = {
  'home.hero': 'Portada · imagen principal', 'home.plan': 'Portada · plano', 'space.coworking': 'Espacio · Coworking', 'space.salas': 'Espacio · Salas',
  'space.despachos': 'Espacio · Despachos', 'space.estudio': 'Espacio · Estudio', community: 'Comunidad',
};
const EVENT_STATUS = { draft: 'Borrador', published: 'Publicado', cancelled: 'Cancelado' };

// Tipo y tamaño de imagen a partir de los primeros bytes (sin confiar en la extensión ni en el tipo declarado).
export function sniffImage(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { ext: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { ext: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { ext: 'webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { ext: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { ext: 'jpg', width: null, height: null };
  }
  return null;
}

export function webRoutes(r, ctx, h) {
  const { db, catalog, content } = ctx;

  // ------------------------------------------------------------------ textos
  r.get('/contenidos', h.adminOnly, (req, res) => {
    const groups = {};
    for (const [key, def] of Object.entries(CONTENT)) (groups[def.group] ||= []).push([key, def]);
    const over = content.overrides();
    const g = groups[req.query.grupo] ? req.query.grupo : Object.keys(groups)[0];
    h.page(req, res, {
      section: 'content', title: 'Textos de la web',
      body: html`
<p class="muted">Cada texto tiene versión en español e inglés. Si dejas un campo vacío se usa el texto original. No incluyas testimonios, valoraciones ni cifras que no sean reales.</p>
<nav class="atabs">${Object.keys(groups).map((k) => html`<a href="?grupo=${encodeURIComponent(k)}"${k === g ? raw(' aria-current="page"') : ''}>${k}</a>`)}</nav>
${postForm(res, `/admin/contenidos?grupo=${encodeURIComponent(g)}`, html`${groups[g].map(([key, def]) => html`<fieldset class="apanel"><legend>${def.label} <code class="muted">${key}</code></legend><div class="agridf">
  ${field({ label: 'Español', name: `${key}|es`, type: 'textarea', rows: def.es.length > 120 ? 4 : 2, value: over.get(`${key}|es`) ?? def.es })}
  ${field({ label: 'English', name: `${key}|en`, type: 'textarea', rows: def.en.length > 120 ? 4 : 2, value: over.get(`${key}|en`) ?? def.en })}
</div></fieldset>`)}<div class="abar-actions"><button class="abtn abtn--primary" type="submit">Guardar textos</button></div>`)}`,
    });
  });

  r.post('/contenidos', h.adminOnly, h.act((req, res) => {
    let n = 0;
    for (const [k, v] of Object.entries(req.body)) {
      const [key, lang] = k.split('|');
      if (!CONTENT[key] || !['es', 'en'].includes(lang)) continue;
      const val = String(v ?? '').trim().slice(0, 4000);
      const def = CONTENT[key][lang];
      if (val === def || val === '') content.remove(key, lang);
      else { content.set(key, lang, val); n++; }
    }
    h.audit(req, 'content.updated', 'content', String(req.query.grupo || ''), { changed: n });
    h.done(res, `/admin/contenidos?grupo=${encodeURIComponent(String(req.query.grupo || ''))}`);
  }, { back: '/admin/contenidos' }));

  // -------------------------------------------------------- fichas de espacios
  r.get('/espacios', h.adminOnly, (req, res) => {
    const spaces = catalog.spaces({ all: true });
    const s = (typeof req.query.s === 'string' && catalog.space(req.query.s)) || spaces[0];
    const L = (f) => [field({ label: `${f[1]} (ES)`, name: `${f[0]}_es`, type: f[2] || 'textarea', rows: f[3] || 3, value: f[4] ? (s[f[0]]?.es || []).join('\n') : s[`${f[0]}_es`] }),
      field({ label: `${f[1]} (EN)`, name: `${f[0]}_en`, type: f[2] || 'textarea', rows: f[3] || 3, value: f[4] ? (s[f[0]]?.en || []).join('\n') : s[`${f[0]}_en`] })];
    h.page(req, res, {
      section: 'spaces', title: 'Fichas de espacios',
      body: html`
<nav class="atabs">${spaces.map((x) => html`<a href="?s=${x.slug}"${x.slug === s.slug ? raw(' aria-current="page"') : ''}>${x.name_es}</a>`)}</nav>
${postForm(res, `/admin/espacios/${s.slug}`, html`<div class="apanel"><div class="agridf">
  ${L(['name', 'Nombre', 'text'])}
  ${L(['tagline', 'Frase corta', 'textarea', 2])}
  ${L(['description', 'Descripción', 'textarea', 6])}
  ${L(['includes', 'Incluye (uno por línea)', 'textarea', 4, true])}
  ${L(['equipment', 'Equipamiento (uno por línea)', 'textarea', 4, true])}
  ${L(['conditions', 'Condiciones', 'textarea', 3])}
  ${L(['capacity_text', 'Capacidad (texto; {desks} = puestos)', 'text'])}
  ${field({ label: 'Superficie aproximada (m²)', name: 'area_m2', type: 'number', value: s.area_m2, attrs: { min: 0, step: '0.1' } })}
  ${field({ label: 'Visible en la web', name: 'visible', type: 'checkbox', checked: s.visible })}
</div><button class="abtn abtn--primary" type="submit">Guardar ficha</button></div>`)}`,
    });
  });

  r.post('/espacios/:slug', h.adminOnly, h.act((req, res) => {
    const s = catalog.space(req.params.slug);
    if (!s) throw new AppError('NOT_FOUND', 404);
    const b = req.body;
    const t = (v, max) => String(v ?? '').trim().slice(0, max);
    const list = (v) => JSON.stringify(String(v || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30));
    if (!t(b.name_es, 80) || !t(b.name_en, 80)) throw new AppError('VALIDATION');
    db.run(`UPDATE spaces SET name_es = ?, name_en = ?, tagline_es = ?, tagline_en = ?, description_es = ?, description_en = ?, includes_es = ?, includes_en = ?,
      equipment_es = ?, equipment_en = ?, conditions_es = ?, conditions_en = ?, capacity_text_es = ?, capacity_text_en = ?, area_m2 = ?, visible = ? WHERE id = ?`,
    [t(b.name_es, 80), t(b.name_en, 80), t(b.tagline_es, 300), t(b.tagline_en, 300), t(b.description_es, 5000), t(b.description_en, 5000), list(b.includes_es), list(b.includes_en),
      list(b.equipment_es), list(b.equipment_en), t(b.conditions_es, 2000), t(b.conditions_en, 2000), t(b.capacity_text_es, 80) || null, t(b.capacity_text_en, 80) || null,
      b.area_m2 === '' ? null : Math.max(0, Number(b.area_m2) || 0), b.visible ? 1 : 0, s.id]);
    h.audit(req, 'space.updated', 'space', s.slug);
    h.done(res, `/admin/espacios?s=${s.slug}`);
  }, { back: (req) => `/admin/espacios?s=${req.params.slug}` }));

  // --------------------------------------------------------------- preguntas
  r.get('/preguntas', h.adminOnly, (req, res) => {
    const faqs = catalog.faqs({ all: true });
    const form = (f = {}) => html`<div class="agridf">
      ${field({ label: 'Pregunta (ES)', name: 'q_es', value: f.q_es, required: true })}
      ${field({ label: 'Question (EN)', name: 'q_en', value: f.q_en, required: true })}
      ${field({ label: 'Respuesta (ES)', name: 'a_es', type: 'textarea', rows: 3, value: f.a_es, required: true })}
      ${field({ label: 'Answer (EN)', name: 'a_en', type: 'textarea', rows: 3, value: f.a_en, required: true })}
      ${field({ label: 'Orden', name: 'sort', type: 'number', value: f.sort ?? (faqs.length + 1) * 10 })}
      ${field({ label: 'Visible', name: 'visible', type: 'checkbox', checked: f.visible ?? 1 })}
    </div>`;
    h.page(req, res, {
      section: 'faqs', title: 'Preguntas frecuentes',
      body: html`
<p class="muted">Se muestran en la portada y en los datos estructurados de Google (FAQPage). Responde solo con información confirmada.</p>
${faqs.map((f) => html`<details class="apanel adetails"><summary><strong>${f.q_es}</strong>${f.visible ? '' : html` <span class="atag atag--off">Oculta</span>`}</summary>
  ${postForm(res, `/admin/preguntas/${f.id}`, html`${form(f)}<div class="aactions"><button class="abtn abtn--primary" type="submit">Guardar</button></div>`)}
  ${actionButton(res, `/admin/preguntas/${f.id}/borrar`, 'Eliminar', { variant: 'danger', confirm: '¿Eliminar esta pregunta?' })}
</details>`)}
<section class="apanel"><h2>Añadir pregunta</h2>${postForm(res, '/admin/preguntas', html`${form()}<button class="abtn abtn--primary" type="submit">Añadir</button>`)}</section>`,
    });
  });

  const readFaq = (b) => {
    const t = (v, max) => String(v ?? '').trim().slice(0, max);
    const v = { q_es: t(b.q_es, 300), q_en: t(b.q_en, 300), a_es: t(b.a_es, 3000), a_en: t(b.a_en, 3000), sort: Number(b.sort) || 0, visible: b.visible ? 1 : 0 };
    if (!v.q_es || !v.q_en || !v.a_es || !v.a_en) throw new AppError('VALIDATION');
    return v;
  };
  r.post('/preguntas', h.adminOnly, h.act((req, res) => {
    const v = readFaq(req.body);
    db.run('INSERT INTO faqs (q_es, a_es, q_en, a_en, sort, visible) VALUES (?,?,?,?,?,?)', [v.q_es, v.a_es, v.q_en, v.a_en, v.sort, v.visible]);
    h.audit(req, 'faq.created', 'faq', null);
    h.done(res, '/admin/preguntas', 'created');
  }, { back: '/admin/preguntas' }));
  r.post('/preguntas/:id', h.adminOnly, h.act((req, res) => {
    const v = readFaq(req.body);
    db.run('UPDATE faqs SET q_es = ?, a_es = ?, q_en = ?, a_en = ?, sort = ?, visible = ? WHERE id = ?', [v.q_es, v.a_es, v.q_en, v.a_en, v.sort, v.visible, Number(req.params.id)]);
    h.audit(req, 'faq.updated', 'faq', String(req.params.id));
    h.done(res, '/admin/preguntas');
  }, { back: '/admin/preguntas' }));
  r.post('/preguntas/:id/borrar', h.adminOnly, h.act((req, res) => {
    db.run('DELETE FROM faqs WHERE id = ?', [Number(req.params.id)]);
    h.audit(req, 'faq.deleted', 'faq', String(req.params.id));
    h.done(res, '/admin/preguntas', 'deleted');
  }, { back: '/admin/preguntas' }));

  // ----------------------------------------------------------------- eventos
  r.get('/eventos', (req, res) => {
    const list = db.all('SELECT e.*, (SELECT COUNT(*) FROM event_signups s WHERE s.event_id = e.id) AS n FROM events e ORDER BY e.start_utc DESC LIMIT 200');
    const isAdmin = req.admin.role === 'admin';
    h.page(req, res, {
      section: 'events', title: 'Eventos y comunidad',
      actions: isAdmin ? html`<a class="abtn abtn--primary" href="/admin/eventos/nuevo">Nuevo evento</a>` : '',
      body: html`
<p class="muted">Solo se publican actividades reales con fecha. La agenda pública muestra los eventos «Publicados» que aún no han terminado.</p>
${list.length ? html`<div class="ascroll"><table class="atable"><thead><tr><th>Evento</th><th>Fecha</th><th>Estado</th><th class="num">Inscritos</th></tr></thead><tbody>
  ${list.map((e) => html`<tr><td><a href="/admin/eventos/${e.id}"><strong>${e.title_es}</strong></a>${e.lang_note ? html` <span class="muted">· ${e.lang_note}</span>` : ''}</td><td>${dt(e.start_utc)}</td><td>${EVENT_STATUS[e.status]}</td><td class="num">${e.n}${e.capacity ? ` / ${e.capacity}` : ''}</td></tr>`)}
</tbody></table></div>` : empty('Aún no hay eventos. Cuando FRAME tenga actividades con fecha, añádelas aquí.')}`,
    });
  });

  const eventForm = (e = {}) => {
    const start = e.start_utc ? T.zonedParts(e.start_utc) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const date = start ? `${start.year}-${pad(start.month)}-${pad(start.day)}` : '';
    return html`<div class="agridf">
      ${field({ label: 'Título (ES)', name: 'title_es', value: e.title_es, required: true })}
      ${field({ label: 'Title (EN)', name: 'title_en', value: e.title_en, required: true })}
      ${field({ label: 'Resumen (ES)', name: 'summary_es', type: 'textarea', rows: 3, value: e.summary_es })}
      ${field({ label: 'Summary (EN)', name: 'summary_en', type: 'textarea', rows: 3, value: e.summary_en })}
      ${field({ label: 'Fecha', name: 'date', type: 'date', value: date, required: true })}
      ${field({ label: 'Hora de inicio', name: 'start', type: 'time', value: e.start_utc ? T.fmtTime(e.start_utc) : '18:30', required: true })}
      ${field({ label: 'Hora de fin', name: 'end', type: 'time', value: e.end_utc ? T.fmtTime(e.end_utc) : '20:00', required: true })}
      ${field({ label: 'Idioma de la actividad', name: 'lang_note', value: e.lang_note, hint: 'p. ej. «Español», «English», «ES/EN».' })}
      ${field({ label: 'Lugar', name: 'location', value: e.location || 'FRAME · Rambla Juan Mateo García, 21' })}
      ${field({ label: 'Plazas (vacío = sin límite)', name: 'capacity', type: 'number', value: e.capacity, attrs: { min: 1, max: 1000 } })}
      ${field({ label: 'Estado', name: 'status', type: 'select', value: e.status || 'draft', options: Object.entries(EVENT_STATUS) })}
    </div>`;
  };
  const readEvent = (b) => {
    const t = (v, max) => String(v ?? '').trim().slice(0, max);
    if (!T.isDate(b.date) || !T.isTime(b.start) || !T.isTime(b.end)) throw new AppError('INVALID_DATE');
    const start = T.localToUtc(b.date, b.start); const end = T.localToUtc(b.date, b.end);
    if (start === null || end === null || end <= start) throw new AppError('INVALID_DATE');
    const v = { title_es: t(b.title_es, 160), title_en: t(b.title_en, 160), summary_es: t(b.summary_es, 2000), summary_en: t(b.summary_en, 2000), lang_note: t(b.lang_note, 40) || null,
      location: t(b.location, 200) || null, capacity: b.capacity ? Math.max(1, Math.min(1000, Number(b.capacity) || 0)) : null, status: EVENT_STATUS[b.status] ? b.status : 'draft', start, end };
    if (!v.title_es || !v.title_en) throw new AppError('VALIDATION');
    return v;
  };

  r.get('/eventos/nuevo', h.adminOnly, (req, res) => h.page(req, res, { section: 'events', title: 'Nuevo evento', body: postForm(res, '/admin/eventos/nuevo', html`<div class="apanel">${eventForm()}<button class="abtn abtn--primary" type="submit">Crear evento</button></div>`) }));
  r.post('/eventos/nuevo', h.adminOnly, h.act((req, res) => {
    const v = readEvent(req.body);
    let slug = slugify(v.title_es).slice(0, 60) || 'evento';
    if (db.get('SELECT 1 FROM events WHERE slug = ?', [slug])) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const ins = db.run(`INSERT INTO events (slug, title_es, title_en, summary_es, summary_en, lang_note, start_utc, end_utc, location, capacity, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [slug, v.title_es, v.title_en, v.summary_es, v.summary_en, v.lang_note, v.start, v.end, v.location, v.capacity, v.status, ctx.now(), ctx.now()]);
    h.audit(req, 'event.created', 'event', slug);
    h.done(res, `/admin/eventos/${ins.lastInsertRowid}`, 'created');
  }, { back: '/admin/eventos/nuevo' }));

  r.get('/eventos/:id', (req, res, next) => {
    const e = db.get('SELECT * FROM events WHERE id = ?', [Number(req.params.id)]);
    if (!e) return next();
    const signups = db.all('SELECT * FROM event_signups WHERE event_id = ? ORDER BY created_at', [e.id]);
    const isAdmin = req.admin.role === 'admin';
    h.page(req, res, {
      section: 'events', title: e.title_es,
      body: html`
${isAdmin ? postForm(res, `/admin/eventos/${e.id}`, html`<div class="apanel">${eventForm(e)}<button class="abtn abtn--primary" type="submit">Guardar</button></div>`) : html`<p>${dt(e.start_utc)} · ${EVENT_STATUS[e.status]}</p>`}
<section class="apanel"><h2>Inscritos (${signups.length}${e.capacity ? ` de ${e.capacity}` : ''})</h2>
  ${signups.length ? html`<table class="atable"><thead><tr><th>Nombre</th><th>Correo</th><th>Fecha</th><th></th></tr></thead><tbody>${signups.map((s) => html`<tr><td>${s.name}</td><td>${s.email}</td><td>${dt(s.created_at)}</td><td>${isAdmin ? actionButton(res, `/admin/eventos/${e.id}/inscritos/${s.id}/borrar`, 'Quitar', { variant: 'ghost', confirm: '¿Quitar esta inscripción?' }) : ''}</td></tr>`)}</tbody></table>`
    : empty('Todavía no hay inscripciones.')}
</section>
${isAdmin ? actionButton(res, `/admin/eventos/${e.id}/borrar`, 'Eliminar evento', { variant: 'danger', confirm: '¿Eliminar el evento y sus inscripciones?' }) : ''}`,
    });
  });

  r.post('/eventos/:id', h.adminOnly, h.act((req, res) => {
    const v = readEvent(req.body);
    db.run(`UPDATE events SET title_es = ?, title_en = ?, summary_es = ?, summary_en = ?, lang_note = ?, start_utc = ?, end_utc = ?, location = ?, capacity = ?, status = ?, updated_at = ? WHERE id = ?`,
      [v.title_es, v.title_en, v.summary_es, v.summary_en, v.lang_note, v.start, v.end, v.location, v.capacity, v.status, ctx.now(), Number(req.params.id)]);
    h.audit(req, 'event.updated', 'event', String(req.params.id), { status: v.status });
    h.done(res, `/admin/eventos/${req.params.id}`);
  }, { back: (req) => `/admin/eventos/${req.params.id}` }));
  r.post('/eventos/:id/borrar', h.adminOnly, h.act((req, res) => {
    db.run('DELETE FROM events WHERE id = ?', [Number(req.params.id)]);
    h.audit(req, 'event.deleted', 'event', String(req.params.id));
    h.done(res, '/admin/eventos', 'deleted');
  }, { back: '/admin/eventos' }));
  r.post('/eventos/:id/inscritos/:sid/borrar', h.adminOnly, h.act((req, res) => {
    db.run('DELETE FROM event_signups WHERE id = ? AND event_id = ?', [Number(req.params.sid), Number(req.params.id)]);
    h.done(res, `/admin/eventos/${req.params.id}`, 'deleted');
  }, { back: (req) => `/admin/eventos/${req.params.id}` }));

  // ------------------------------------------------------------------- fotos
  r.get('/fotos', h.adminOnly, (req, res) => {
    const all = catalog.allMedia();
    h.page(req, res, {
      section: 'media', title: 'Fotos e imágenes',
      body: html`
<p class="muted">Las imágenes de cada apartado se muestran por orden. Las marcadas como «conceptuales» llevan un aviso en la web: no se presentan como fotografías reales del local. Cuando tengas fotos reales, súbelas y desmarca la casilla.</p>
<section class="apanel"><h2>Subir imagen</h2>
  <form method="post" action="/admin/fotos" enctype="multipart/form-data" class="agridf">
    <input type="hidden" name="_csrf" value="${res.locals.adminCsrf}">
    ${field({ label: 'Apartado', name: 'slot', type: 'select', options: Object.entries(SLOTS) })}
    <div class="afield"><label for="f-file">Archivo (JPG, PNG o WebP, máx. 8 MB)</label><input id="f-file" type="file" name="file" accept="image/jpeg,image/png,image/webp" required></div>
    ${field({ label: 'Texto alternativo (ES)', name: 'alt_es', required: true, hint: 'Describe lo que se ve, para personas que no pueden ver la imagen.' })}
    ${field({ label: 'Alternative text (EN)', name: 'alt_en', required: true })}
    ${field({ label: 'Es una imagen conceptual (render), no una foto real', name: 'is_concept', type: 'checkbox' })}
    ${field({ label: 'Orden', name: 'sort', type: 'number', value: 0 })}
    <div class="abar-actions"><button class="abtn abtn--primary" type="submit">Subir</button></div>
  </form>
</section>
${Object.entries(SLOTS).map(([slot, label]) => {
    const items = all.filter((m) => m.slot === slot);
    return html`<section class="apanel"><h2>${label}</h2>${items.length ? html`<div class="amedia">${items.map((m) => html`<figure class="amedia__item">
      <img src="${m.path}" alt="${m.alt_es}" loading="lazy">
      <figcaption>${postForm(res, `/admin/fotos/${m.id}`, html`
        ${field({ label: 'Alt (ES)', name: 'alt_es', value: m.alt_es })}${field({ label: 'Alt (EN)', name: 'alt_en', value: m.alt_en })}
        <div class="agridf">${field({ label: 'Orden', name: 'sort', type: 'number', value: m.sort })}${field({ label: 'Conceptual', name: 'is_concept', type: 'checkbox', checked: m.is_concept })}</div>
        <button class="abtn" type="submit">Guardar</button>`)}
        ${m.builtin ? html`<p class="small muted">Imagen incluida con la web.</p>` : actionButton(res, `/admin/fotos/${m.id}/borrar`, 'Eliminar', { variant: 'danger', confirm: '¿Eliminar esta imagen?' })}
      </figcaption></figure>`)}</div>` : empty('Sin imágenes.')}</section>`;
  })}`,
    });
  });

  r.post('/fotos', h.adminOnly, (req, res, next) => {
    if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data')) return next(new AppError('VALIDATION'));
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 1, fields: 20, fieldSize: 4000 } }); } catch { return next(new AppError('VALIDATION')); }
    const fields = {}; const chunks = []; let truncated = false; let gotFile = false;
    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (name, stream) => {
      if (name !== 'file') { stream.resume(); return; }
      gotFile = true;
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => { truncated = true; });
    });
    bb.on('error', () => next(new AppError('VALIDATION')));
    bb.on('close', () => {
      const fail = (code) => res.redirect(303, `/admin/fotos?err=${code}`);
      if (!verifyCsrf({ get: () => null, body: fields }, req.adminSession?.csrf)) return fail('CSRF');
      if (!gotFile || truncated) return fail(truncated ? 'FILE_TOO_LARGE' : 'VALIDATION');
      const buf = Buffer.concat(chunks);
      const img = sniffImage(buf);
      if (!img) return fail('INVALID_IMAGE');
      const slot = SLOTS[fields.slot] ? fields.slot : null;
      const altEs = String(fields.alt_es || '').trim().slice(0, 300); const altEn = String(fields.alt_en || '').trim().slice(0, 300);
      if (!slot || !altEs || !altEn) return fail('VALIDATION');
      fs.mkdirSync(ctx.cfg.uploadsDir, { recursive: true });
      const name = `${Date.now().toString(36)}-${randomToken(9).replace(/[^A-Za-z0-9]/g, '')}.${img.ext}`;
      fs.writeFileSync(path.join(ctx.cfg.uploadsDir, name), buf, { mode: 0o644 });
      db.run('INSERT INTO media (slot, path, width, height, alt_es, alt_en, is_concept, sort, builtin, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)',
        [slot, `/media/${name}`, img.width, img.height, altEs, altEn, fields.is_concept ? 1 : 0, Number(fields.sort) || 0, ctx.now()]);
      h.audit(req, 'media.uploaded', 'media', name, { slot, bytes: buf.length });
      res.redirect(303, '/admin/fotos?ok=uploaded');
    });
    req.pipe(bb);
  });

  r.post('/fotos/:id', h.adminOnly, h.act((req, res) => {
    const altEs = String(req.body.alt_es || '').trim().slice(0, 300); const altEn = String(req.body.alt_en || '').trim().slice(0, 300);
    if (!altEs || !altEn) throw new AppError('VALIDATION');
    db.run('UPDATE media SET alt_es = ?, alt_en = ?, sort = ?, is_concept = ? WHERE id = ?', [altEs, altEn, Number(req.body.sort) || 0, req.body.is_concept ? 1 : 0, Number(req.params.id)]);
    h.done(res, '/admin/fotos');
  }, { back: '/admin/fotos' }));

  r.post('/fotos/:id/borrar', h.adminOnly, h.act((req, res) => {
    const m = db.get('SELECT * FROM media WHERE id = ? AND builtin = 0', [Number(req.params.id)]);
    if (!m) throw new AppError('NOT_FOUND', 404);
    db.run('DELETE FROM media WHERE id = ?', [m.id]);
    const file = path.join(ctx.cfg.uploadsDir, path.basename(m.path));
    if (m.path.startsWith('/media/') && fs.existsSync(file)) fs.unlinkSync(file);
    h.audit(req, 'media.deleted', 'media', String(m.id));
    h.done(res, '/admin/fotos', 'deleted');
  }, { back: '/admin/fotos' }));
}
