// Panel de administración: plantilla y piezas de interfaz (solo en español).
import { html, raw, attrs } from '../../lib/html.js';
import { money } from '../../lib/util.js';
import * as T from '../../lib/time.js';
import { errorMessage } from '../../i18n/ui.js';

export const NAV = [
  ['Operativa', [
    ['dashboard', '/admin', 'Panel'],
    ['calendar', '/admin/calendario', 'Calendario'],
    ['bookings', '/admin/reservas', 'Reservas'],
    ['requests', '/admin/solicitudes', 'Solicitudes'],
    ['blocks', '/admin/bloqueos', 'Bloqueos'],
  ]],
  ['Clientes', [
    ['customers', '/admin/clientes', 'Clientes'],
    ['vouchers', '/admin/bonos', 'Bonos'],
    ['plans', '/admin/planes', 'Planes'],
  ]],
  ['Catálogo', [
    ['resources', '/admin/recursos', 'Recursos', 'admin'],
    ['pricing', '/admin/tarifas', 'Tarifas e impuestos', 'admin'],
    ['settings', '/admin/ajustes', 'Ajustes', 'admin'],
  ]],
  ['Web', [
    ['content', '/admin/contenidos', 'Textos', 'admin'],
    ['spaces', '/admin/espacios', 'Fichas de espacios', 'admin'],
    ['faqs', '/admin/preguntas', 'Preguntas', 'admin'],
    ['events', '/admin/eventos', 'Eventos'],
    ['media', '/admin/fotos', 'Fotos', 'admin'],
  ]],
  ['Sistema', [
    ['reports', '/admin/informes', 'Informes', 'admin'],
    ['payments', '/admin/pagos', 'Pagos', 'admin'],
    ['outbox', '/admin/correos', 'Correos'],
    ['audit', '/admin/registro', 'Registro', 'admin'],
    ['users', '/admin/usuarios', 'Usuarios', 'admin'],
  ]],
];

export const BOOKING_STATUS = {
  pending_payment: ['Pendiente de pago', 'warn'], requested: ['Solicitud', 'warn'], confirmed: ['Confirmada', 'ok'],
  cancelled: ['Cancelada', 'off'], expired: ['Caducada', 'off'], rejected: ['Rechazada', 'off'],
};
export const PAYMENT_STATUS = {
  none: ['Sin cobro', 'off'], unpaid: ['Por cobrar', 'warn'], pending: ['Pago en curso', 'warn'], paid: ['Pagado', 'ok'],
  failed: ['Pago fallido', 'bad'], refunded: ['Reembolsado', 'off'], refund_pending: ['Reembolso pendiente', 'bad'],
  offline: ['Cobro en recepción', 'ok'], included: ['Incluido', 'ok'],
};
export const ORDER_STATUS = {
  pending: ['Pendiente', 'warn'], paid: ['Pagado', 'ok'], failed: ['Fallido', 'bad'], expired: ['Caducado', 'off'],
  cancelled: ['Cancelado', 'off'], refunded: ['Reembolsado', 'off'], refund_pending: ['Reembolso pendiente', 'bad'],
};
export const PLAN_STATUS = {
  requested: ['Solicitud', 'warn'], pending_payment: ['Pendiente de pago', 'warn'], active: ['Activo', 'ok'],
  past_due: ['Pago pendiente', 'bad'], ended: ['Finalizado', 'off'], cancelled: ['Cancelado', 'off'], rejected: ['Rechazado', 'off'],
};
export const REQUEST_STATUS = { new: ['Nueva', 'warn'], in_progress: ['En curso', 'info'], closed: ['Cerrada', 'off'] };
export const USAGE = { pass: 'Pase de día', voucher: 'Día de bono', plan: 'Mesa flexible', trial: 'Día de prueba', hourly: 'Por horas', visit: 'Visita', office: 'Despacho', admin: 'Interna' };
export const MAIL_STATUS = { queued: ['En cola', 'warn'], sent: ['Enviado', 'ok'], not_sent_test_mode: ['No enviado (modo prueba)', 'info'], failed: ['Error', 'bad'] };

export const tag = (map, key) => { const [l, c] = map[key] || [key, 'off']; return html`<span class="atag atag--${c}">${l}</span>`; };
export const eur = (cents) => (cents === null || cents === undefined ? '—' : money(cents, 'es', { decimals: 2 }));
export const dt = (ms) => (ms ? T.fmtDateTime(ms, 'es') : '—');
export const d = (date) => (date ? T.fmtDateStr(date, 'es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const hm = (ms) => T.fmtTime(ms);

export function bookingWhen(b) {
  if (b.kind === 'desk_day') return html`${d(b.local_date)} <span class="muted">· día completo</span>`;
  if (b.kind === 'office') return html`${d(b.local_date)} → ${d(b.end_date)}`;
  return html`${d(b.local_date)} <span class="muted">· ${hm(b.start_utc)}–${hm(b.end_utc)}</span>`;
}

// Mensajes de resultado tras una acción (?ok=… o ?err=CODE).
const OK = {
  saved: 'Cambios guardados.', created: 'Creado correctamente.', deleted: 'Eliminado.', confirmed: 'Reserva confirmada y cliente avisado.',
  cancelled: 'Reserva cancelada.', changed: 'Reserva modificada.', rejected: 'Solicitud rechazada.', paid: 'Marcado como cobrado.',
  issued: 'Bono emitido.', adjusted: 'Saldo ajustado.', activated: 'Plan activado.', renewed: 'Plan renovado un mes.',
  refunded: 'Reembolso solicitado a la pasarela.', resent: 'Correo generado de nuevo.', password: 'Contraseña actualizada.',
  links: 'Los enlaces de gestión anteriores de este cliente han dejado de funcionar.', anonymized: 'Datos personales anonimizados.',
  uploaded: 'Imagen subida.', reset: 'Texto restaurado al original.',
};
export function flash(req) {
  const ok = OK[req.query.ok];
  const err = req.query.err ? errorMessage('es', String(req.query.err).slice(0, 40)).replace(/\s*\(\{\w+\}\)|\s*\{\w+\}/g, '') : null;
  return html`${ok ? html`<div class="aflash aflash--ok" role="status">${ok}</div>` : ''}${err ? html`<div class="aflash aflash--err" role="alert">${err}</div>` : ''}`;
}

export const csrf = (res) => html`<input type="hidden" name="_csrf" value="${res.locals.adminCsrf}">`;

export function postForm(res, action, inner, { confirm, cls = '', inline = false } = {}) {
  return html`<form method="post" action="${action}" class="${cls}${inline ? ' aform--inline' : ''}"${confirm ? raw(` data-confirm="${String(confirm).replace(/"/g, '&quot;')}"`) : ''}>${csrf(res)}${inner}</form>`;
}
export function actionButton(res, action, label, { variant = '', confirm, hidden = {} } = {}) {
  return postForm(res, action, html`${Object.entries(hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button class="abtn ${variant ? `abtn--${variant}` : ''}" type="submit">${label}</button>`, { confirm, inline: true });
}

let fieldSeq = 0;
export function field({ label, name, value = '', type = 'text', hint, required, options, rows, attrs: extra = {}, wide = false, checked }) {
  const id = `f-${name.replace(/[^a-z0-9_-]/gi, '')}-${++fieldSeq}`;
  let control;
  if (type === 'select') {
    control = html`<select id="${id}" name="${name}"${attrs({ required, ...extra })}>${options.map(([v, l]) => html`<option value="${v}"${String(v) === String(value ?? '') ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  } else if (type === 'textarea') {
    control = html`<textarea id="${id}" name="${name}" rows="${rows || 4}"${attrs({ required, ...extra })}>${value ?? ''}</textarea>`;
  } else if (type === 'checkbox') {
    return html`<label class="acheck${wide ? ' afield--wide' : ''}"><input type="checkbox" name="${name}" value="1"${attrs({ checked: Boolean(checked ?? value), ...extra })}> <span>${label}</span>${hint ? html`<small>${hint}</small>` : ''}</label>`;
  } else {
    control = html`<input id="${id}" type="${type}" name="${name}" value="${value ?? ''}"${attrs({ required, ...extra })}>`;
  }
  return html`<div class="afield${wide ? ' afield--wide' : ''}"><label for="${id}">${label}${required ? html` <span aria-hidden="true">*</span>` : ''}</label>${control}${hint ? html`<small>${hint}</small>` : ''}</div>`;
}

export function pager(req, page, pages) {
  if (pages <= 1) return '';
  const link = (p) => { const q = new URLSearchParams(req.query); q.set('p', p); q.delete('ok'); q.delete('err'); return `${req.path}?${q}`; };
  return html`<nav class="apager" aria-label="Paginación">${page > 1 ? html`<a href="${link(page - 1)}">← Anterior</a>` : html`<span></span>`}<span>Página ${page} de ${pages}</span>${page < pages ? html`<a href="${link(page + 1)}">Siguiente →</a>` : html`<span></span>`}</nav>`;
}

export function empty(text) { return html`<p class="aempty">${text}</p>`; }

export function kpi(label, value, sub, href) {
  const inner = html`<span class="akpi__l">${label}</span><strong class="akpi__v">${value}</strong>${sub ? html`<span class="akpi__s">${sub}</span>` : ''}`;
  return href ? html`<a class="akpi" href="${href}">${inner}</a>` : html`<div class="akpi">${inner}</div>`;
}

export function adminLayout(ctx, req, res, { title, body, section, actions, wide = false }) {
  const u = req.admin;
  const counts = res.locals.navCounts || {};
  const testPay = ctx.payments.testMode;
  const testMail = !ctx.cfg.smtp;
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Administración FRAME</title>
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/site.css?v=${res.locals.assetVersion}">
<link rel="stylesheet" href="/css/admin.css?v=${res.locals.assetVersion}">
</head>
<body class="admin">
<a class="skip-link" href="#amain">Saltar al contenido</a>
${u ? html`
<aside class="aside" id="anav">
  <div class="aside__brand"><a href="/admin" aria-label="Panel de FRAME"><img src="/brand/frame-logo-compact-light.svg" alt="FRAME" width="120" height="26"></a><span>Administración</span></div>
  <nav aria-label="Administración">
    ${NAV.map(([group, items]) => {
      const visible = items.filter((it) => !it[3] || u.role === it[3]);
      if (!visible.length) return '';
      return html`<p class="aside__group">${group}</p><ul>${visible.map(([id, href, l]) => html`<li><a href="${href}"${section === id ? raw(' aria-current="page"') : ''}>${l}${counts[id] ? html`<span class="abadge">${counts[id]}</span>` : ''}</a></li>`)}</ul>`;
    })}
  </nav>
  <div class="aside__me">
    <p><strong>${u.name}</strong><br><span>${u.role === 'admin' ? 'Administración' : 'Recepción'} · ${u.email}</span></p>
    <p><a href="/admin/cuenta">Mi cuenta</a> · <a href="/" target="_blank" rel="noopener">Ver la web</a></p>
    ${postForm(res, '/admin/salir', html`<button class="abtn abtn--ghost abtn--block" type="submit">Cerrar sesión</button>`)}
  </div>
</aside>
<header class="atop"><a href="/admin"><img src="/brand/frame-logo-compact-dark.svg" alt="FRAME" width="110" height="24"></a><button class="abtn abtn--ghost" type="button" data-anav aria-controls="anav" aria-expanded="false">Menú</button></header>` : ''}
<main id="amain" class="amain${wide ? ' amain--wide' : ''}${u ? '' : ' amain--solo'}">
  ${u && (testPay || testMail) ? html`<p class="amode"><span class="rec-dot"></span> Entorno de prueba: ${[testPay ? 'pagos con la pasarela de prueba (no se cobra nada)' : null, testMail ? 'correos sin enviar (se guardan en «Correos»)' : null].filter(Boolean).join(' · ')}</p>` : ''}
  <div class="ahead"><h1>${title}</h1>${actions ? html`<div class="ahead__actions">${actions}</div>` : ''}</div>
  ${flash(req)}
  ${body}
</main>
<script src="/js/admin.js?v=${res.locals.assetVersion}" defer></script>
</body>
</html>`.toString();
}
