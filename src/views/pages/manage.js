import { html, raw } from '../../lib/html.js';
import { layout } from '../layout.js';
import { button, label } from '../components.js';
import { path } from '../../i18n/routes.js';
import { UI, errorMessage } from '../../i18n/ui.js';
import { money } from '../../lib/util.js';
import * as T from '../../lib/time.js';
import { statusTag, bookingWhen } from './account.js';

export function renderManage(ctx, req, res, { booking: b, token, flash, payment, error }) {
  const lang = req.lang;
  const es = lang !== 'en';
  const ui = UI[lang];
  const pol = ctx.settings.get('policies');
  const r = ctx.catalog.resourceById(b.resource_id);
  const product = b.product_id ? ctx.catalog.productById(b.product_id) : null;
  const now = ctx.now();
  const active = ['requested', 'confirmed'].includes(b.status);
  const canChange = active && ['desk_day', 'hourly', 'visit'].includes(b.kind) && b.start_utc - now >= pol.modify_min_hours * 3600_000;
  const canCancel = ['requested', 'confirmed', 'pending_payment'].includes(b.status) && (b.kind === 'desk_day' ? b.end_utc > now : b.start_utc > now);
  const inFree = b.start_utc - now >= pol.cancel_free_hours * 3600_000;
  const paid = ['paid'].includes(b.payment_status);
  const base = `${path('manage', lang, `/${b.ref}`)}`;
  const csrf = res.locals.csrfPublic;
  const waiting = b.status === 'pending_payment' && payment === 'ok';
  const holdTime = b.hold_expires_at ? T.fmtTime(b.hold_expires_at) : null;
  const flashText = { cancelada: es ? 'Reserva cancelada.' : 'Booking cancelled.', cambiada: es ? 'Reserva modificada. Te hemos enviado la confirmación.' : 'Booking changed. We have sent you the confirmation.' }[flash];
  const title = b.status === 'confirmed' ? (es ? 'Reserva confirmada' : 'Booking confirmed')
    : b.status === 'requested' ? (es ? 'Solicitud registrada' : 'Request registered')
      : b.status === 'pending_payment' ? (es ? 'Pendiente de pago' : 'Awaiting payment')
        : ui.status[b.status];
  const resName = r.kind === 'desk_pool' ? (product ? product[`name_${lang}`] : ui.usage[b.usage]) : `${product ? `${product[`name_${lang}`]} · ` : ''}${r[`name_${lang}`]}`;

  const body = html`
<section class="page-hero wrap">
  ${label('', `${es ? 'Reserva' : 'Booking'} · ${b.ref}`)}
  <div class="flex between wrap-row gap-2 mt-2" style="align-items:end"><h1 class="display-2">${title}</h1>${statusTag(b, lang)}</div>
  ${flashText ? html`<p class="alert alert--ok mt-3" role="status">${flashText}</p>` : ''}
  ${error ? html`<p class="alert alert--error mt-3" role="alert">${errorMessage(lang, String(error).replace(/[^A-Z_]/g, ''), { hours: pol.modify_min_hours })}</p>` : ''}
  ${waiting ? html`<div class="note note--warn mt-3" data-poll="${`/api/bookings/${b.ref}/status?t=${token}`}" role="status">${es ? 'Estamos esperando la confirmación de la pasarela de pago. Esta página se actualizará sola en unos segundos.' : 'We are waiting for the payment gateway confirmation. This page will refresh automatically in a few seconds.'}</div>` : ''}
  ${b.status === 'pending_payment' && !waiting ? html`<div class="note note--warn mt-3">${payment === 'cancelado' ? (es ? 'Has vuelto sin completar el pago. ' : 'You came back without completing the payment. ') : ''}${b.payment_status === 'failed' ? (es ? 'El último intento de pago no se completó. ' : 'The last payment attempt was not completed. ') : ''}${es ? `El hueco sigue retenido hasta las ${holdTime}. Si no se paga, se libera automáticamente.` : `The slot is held until ${holdTime}. If unpaid, it is released automatically.`}
    <form method="post" action="${base}/pagar" class="mt-2"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="t" value="${token}">${button({ type: 'submit', label: es ? `Pagar ${money(b.total_cents, lang, { decimals: 2 })}` : `Pay ${money(b.total_cents, lang, { decimals: 2 })}`, variant: 'rec', size: 'sm' })}</form></div>` : ''}
  ${b.status === 'expired' ? html`<p class="note mt-3">${es ? 'La reserva no se completó a tiempo y el hueco se ha liberado. No se ha realizado ningún cargo.' : 'The booking was not completed in time and the slot has been released. Nothing was charged.'} <a href="${path('book', lang)}">${es ? 'Hacer una nueva reserva' : 'Make a new booking'}</a></p>` : ''}
  ${b.cancel_reason === 'paid_after_release' ? html`<p class="alert alert--error mt-3">${es ? 'El pago llegó cuando el hueco ya no estaba disponible. FRAME tramitará el reembolso íntegro.' : 'The payment arrived after the slot was released. FRAME will issue a full refund.'}</p>` : ''}
</section>

<section class="wrap two-col" style="padding-bottom:clamp(64px,8vw,120px)">
  <div class="stack" style="--stack:2rem">
    <dl class="review">
      <div><dt>${ui.booking.reference}</dt><dd class="mono">${b.ref}</dd></div>
      <div><dt>${es ? 'Servicio' : 'Service'}</dt><dd>${resName}</dd></div>
      <div><dt>${es ? 'Fecha y horario' : 'Date and time'}</dt><dd>${bookingWhen(b, lang)}${b.kind === 'desk_day' ? (es ? ' · horario de coworking' : ' · coworking hours') : ''} <span class="muted small">(${es ? 'hora de Madrid' : 'Madrid time'})</span></dd></div>
      <div><dt>${ui.booking.people}</dt><dd>${b.people}</dd></div>
      <div><dt>${es ? 'Estado' : 'Status'}</dt><dd>${ui.status[b.status]}</dd></div>
      <div><dt>${es ? 'Pago' : 'Payment'}</dt><dd>${ui.payment[b.payment_status]}</dd></div>
      ${b.price_final && b.total_cents !== null ? html`<div><dt>${es ? 'Importe' : 'Amount'}</dt><dd>${money(b.total_cents, lang, { decimals: 2 })} <span class="muted small">(${es ? 'impuestos incluidos' : 'tax included'})</span></dd></div>`
        : b.subtotal_cents ? html`<div><dt>${es ? 'Importe orientativo' : 'Indicative amount'}</dt><dd>${money(b.subtotal_cents, lang, { decimals: 2 })} + ${es ? 'IVA · sin cargo hasta confirmar' : 'VAT · not charged until confirmed'}</dd></div>` : ''}
    </dl>
    ${b.conditions ? html`<div class="panel"><h2 class="label">${ui.booking.conditions}</h2><ul class="list-dash small mt-1">${b.conditions.split('\n').map((l) => html`<li>${l}</li>`)}</ul></div>` : ''}
    <p class="small"><a href="${path('receipt', lang, `/${b.ref}`)}?t=${token}">${es ? 'Ver justificante' : 'View receipt'}</a> · <a href="${base}/calendario.ics?t=${token}">${es ? 'Añadir al calendario' : 'Add to calendar'}</a></p>
  </div>
  <aside class="stack" style="--stack:1.2rem">
    ${canChange ? html`<form class="form panel" method="post" action="${base}/cambiar" data-change data-kind="${b.kind}" data-resource="${r.group_slug ? '' : r.slug}" data-group="${r.group_slug || ''}" data-duration="${Math.round((b.end_utc - b.start_utc) / 60000)}" data-people="${b.people}" data-lang="${lang}">
      <h2 class="display-3" style="font-size:1.3rem">${es ? 'Cambiar fecha u hora' : 'Change date or time'}</h2>
      <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="t" value="${token}">
      <div class="field"><label for="m-date">${es ? 'Nueva fecha' : 'New date'}</label><input id="m-date" name="date" type="date" required min="${T.todayLocal(now)}" max="${T.addDays(T.todayLocal(now), pol.horizon_days)}" value="${b.local_date}"></div>
      ${b.kind !== 'desk_day' ? html`<div class="field"><label for="m-time">${es ? 'Nueva hora' : 'New time'}</label><select id="m-time" name="time" required><option value="${T.fmtTime(b.start_utc)}">${T.fmtTime(b.start_utc)}</option></select><span class="hint" data-change-hint></span></div>` : ''}
      <p class="small muted">${es ? `Cambios permitidos hasta ${pol.modify_min_hours} h antes. La disponibilidad se comprueba de nuevo al confirmar.` : `Changes allowed up to ${pol.modify_min_hours} h before. Availability is checked again when confirming.`}</p>
      <div>${button({ type: 'submit', label: es ? 'Guardar cambio' : 'Save change', size: 'sm' })}</div>
    </form>` : active ? html`<p class="note small">${es ? `Los cambios se permiten hasta ${pol.modify_min_hours} h antes del inicio.` : `Changes are allowed up to ${pol.modify_min_hours} h before the start.`}</p>` : ''}
    ${canCancel ? html`<form class="form panel" method="post" action="${base}/cancelar" data-cancel="${es ? '¿Seguro que quieres cancelar esta reserva?' : 'Are you sure you want to cancel this booking?'}">
      <h2 class="display-3" style="font-size:1.3rem">${es ? 'Cancelar' : 'Cancel'}</h2>
      <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="t" value="${token}">
      <p class="small">${b.status === 'pending_payment' ? (es ? 'Se liberará el hueco y no se realizará ningún cargo.' : 'The slot will be released and nothing will be charged.')
        : paid ? (inFree || pol.late_cancel_refund ? (es ? 'Se reembolsará el pago íntegro.' : 'The payment will be fully refunded.') : (es ? `Fuera del plazo de ${pol.cancel_free_hours} h: no se reembolsa.` : `Outside the ${pol.cancel_free_hours} h window: not refunded.`))
          : b.usage === 'voucher' ? (inFree ? (es ? 'El día volverá al saldo de tu bono.' : 'The day will return to your pass balance.') : (es ? `Fuera del plazo de ${pol.cancel_free_hours} h: el día no se devuelve al bono.` : `Outside the ${pol.cancel_free_hours} h window: the day is not returned.`))
            : (es ? 'No tiene coste.' : 'Free of charge.')}</p>
      <div>${button({ type: 'submit', label: es ? 'Cancelar reserva' : 'Cancel booking', size: 'sm', variant: 'ghost' })}</div>
    </form>` : ''}
    <div class="panel small"><p class="mb-0">${es ? '¿Dudas? Llámanos al' : 'Questions? Call us on'} <a href="tel:${ctx.settings.get('business').phone.replace(/\s/g, '')}">${ctx.settings.get('business').phone}</a> ${es ? 'o escribe a' : 'or write to'} <a href="mailto:${ctx.settings.get('business').email}">${ctx.settings.get('business').email}</a>.</p></div>
  </aside>
</section>
<script nonce="${res.locals.nonce}" src="/js/manage.js?v=${res.locals.assetVersion}" defer></script>`;
  return layout(ctx, req, res, { title: `${title} · ${b.ref}`, description: title, body, noindex: true, alt: { es: `/reserva/${b.ref}`, en: `/en/booking/${b.ref}` } });
}

export { raw };
