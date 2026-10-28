// Traduce sucesos del sistema en correos (cliente y equipo de FRAME).
import { AsyncLocalStorage } from 'node:async_hooks';
import * as T from '../lib/time.js';
import { money } from '../lib/util.js';
import { layoutEmail } from './mail.js';
import { UI } from '../i18n/ui.js';
import { path } from '../i18n/routes.js';

export const requestStore = new AsyncLocalStorage();

export function createNotifier(ctx) {
  const { db, cfg, catalog } = ctx;

  const send = (to, lang, kind, ref, content) => {
    const { html, text } = layoutEmail({ lang, ...content });
    return ctx.mail.queue({ to, subject: content.subject, text, html, kind, ref, viewerKey: requestStore.getStore()?.viewerKey });
  };

  function bookingRows(b, lang) {
    const es = lang !== 'en';
    const ui = UI[lang] || UI.es;
    const r = catalog.resourceById(b.resource_id);
    const p = b.product_id ? catalog.productById(b.product_id) : null;
    const rows = [
      [ui.booking.reference, b.ref],
      [es ? 'Servicio' : 'Service', `${p ? p[`name_${lang}`] : ui.usage[b.usage]}${r.kind !== 'desk_pool' ? ` · ${r[`name_${lang}`]}` : ''}`],
      [es ? 'Fecha' : 'Date', b.kind === 'office' ? `${T.fmtDateStr(b.local_date, lang)} → ${T.fmtDateStr(b.end_date, lang)}` : T.fmtDateStr(b.local_date, lang)],
    ];
    if (b.kind === 'hourly' || b.kind === 'visit') rows.push([es ? 'Horario' : 'Time', `${T.fmtTime(b.start_utc)} – ${T.fmtTime(b.end_utc)} (${es ? 'hora de Madrid' : 'Madrid time'})`]);
    else if (b.kind === 'desk_day') rows.push([es ? 'Horario' : 'Hours', es ? 'Horario de coworking' : 'Coworking hours']);
    rows.push([ui.booking.people, String(b.people)]);
    rows.push([es ? 'Estado' : 'Status', ui.status[b.status]]);
    if (b.total_cents !== null && b.price_final) rows.push([es ? 'Importe' : 'Amount', `${money(b.total_cents, lang, { decimals: 2 })} (${ui.payment[b.payment_status]})`]);
    else if (b.subtotal_cents) rows.push([es ? 'Importe orientativo' : 'Indicative amount', `${money(b.subtotal_cents, lang, { decimals: 2 })} ${es ? '+ IVA (pendiente de confirmar)' : '+ VAT (to be confirmed)'}`]);
    else if (b.usage === 'voucher' || b.usage === 'plan') rows.push([es ? 'Importe' : 'Amount', ui.payment.included]);
    return rows;
  }

  function manageUrl(b) {
    const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
    return `${cfg.baseUrl}${path('manage', b.lang, `/${b.ref}`)}?t=${ctx.bookings.manageToken(b.ref, c)}`;
  }

  function bookingMail(bookingId, kind) {
    const b = db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!b) return;
    const c = db.get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
    const lang = b.lang || c.lang || 'es';
    const es = lang !== 'en';
    const T_ = {
      requested: [es ? `Hemos recibido tu solicitud ${b.ref}` : `We have received your request ${b.ref}`, es ? 'Tu solicitud está registrada y el hueco queda reservado mientras la revisamos. No se ha realizado ningún cargo. Te escribiremos para confirmarla.' : 'Your request is registered and the slot is held while we review it. Nothing has been charged. We will write to confirm it.'],
      confirmed: [es ? `Reserva confirmada · ${b.ref}` : `Booking confirmed · ${b.ref}`, es ? 'Tu reserva está confirmada. Te esperamos en FRAME.' : 'Your booking is confirmed. See you at FRAME.'],
      changed: [es ? `Reserva modificada · ${b.ref}` : `Booking changed · ${b.ref}`, es ? 'Hemos actualizado tu reserva con los nuevos datos.' : 'We have updated your booking with the new details.'],
      cancelled: [es ? `Reserva cancelada · ${b.ref}` : `Booking cancelled · ${b.ref}`, es ? 'Tu reserva se ha cancelado y el hueco vuelve a estar disponible.' : 'Your booking has been cancelled and the slot is available again.'],
      rejected: [es ? `No hemos podido confirmar ${b.ref}` : `We could not confirm ${b.ref}`, es ? 'Lo sentimos, no podemos confirmar esta solicitud. No se ha realizado ningún cargo. Responde a este correo si quieres buscar otra fecha.' : 'Sorry, we cannot confirm this request. Nothing has been charged. Reply to this email to find another date.'],
      expired: [es ? `Tu solicitud ${b.ref} ha caducado` : `Your request ${b.ref} has expired`, es ? 'No pudimos confirmar tu solicitud a tiempo y el hueco se ha liberado. No se ha realizado ningún cargo.' : 'We could not confirm your request in time and the slot has been released. Nothing has been charged.'],
    };
    const [subject, intro] = T_[kind];
    const blocks = [];
    if (['requested', 'confirmed', 'changed'].includes(kind) && b.conditions) blocks.push(`${es ? 'Condiciones' : 'Conditions'}:\n${b.conditions}`);
    if (b.kind === 'desk_day' && kind === 'confirmed') blocks.push(es ? 'Preséntate en recepción con tu referencia. El acceso 24/7 es exclusivo del plan de mesa fija.' : 'Show your reference at reception. 24/7 access is only included in the fixed desk plan.');
    const active = ['requested', 'confirmed', 'changed'].includes(kind);
    send(c.email, lang, `booking.${kind}`, b.ref, {
      subject, title: subject, intro, rows: bookingRows(b, lang), blocks,
      cta: active ? { label: es ? 'Gestionar mi reserva' : 'Manage my booking', url: manageUrl(b) } : null,
      footerNote: active ? (es ? 'Desde ese enlace puedes consultar, cambiar o cancelar la reserva según sus condiciones. No lo compartas.' : 'From that link you can view, change or cancel the booking according to its conditions. Do not share it.') : null,
    });
    if (kind === 'requested') {
      const r = catalog.resourceById(b.resource_id);
      send(cfg.notifyTo, 'es', 'admin.request', b.ref, {
        subject: `Nueva solicitud ${b.ref} · ${r.name_es}`, title: `Nueva solicitud ${b.ref}`,
        intro: `${c.name || c.email} ha solicitado ${r.name_es}. Revísala en el panel antes de que caduque la retención.`,
        rows: bookingRows(b, 'es'), cta: { label: 'Abrir en el panel', url: `${cfg.baseUrl}/admin/reservas/${b.ref}` },
      });
    }
  }

  function planMail(planId, kind, extra = {}) {
    const p = db.get('SELECT * FROM plans WHERE id = ?', [planId]);
    const c = db.get('SELECT * FROM customers WHERE id = ?', [p.customer_id]);
    const prod = catalog.productById(p.product_id);
    const lang = c.lang || 'es';
    const es = lang !== 'en';
    const ui = UI[lang];
    const rows = [[es ? 'Referencia' : 'Reference', p.ref], ['Plan', prod[`name_${lang}`]], [es ? 'Inicio' : 'Start', T.fmtDateStr(p.start_date, lang)], [es ? 'Estado' : 'Status', ui.planStatus[p.status]]];
    if (p.period_end) rows.push([es ? 'Periodo actual hasta' : 'Current period until', T.fmtDateStr(T.addDays(p.period_end, -1), lang)]);
    if (p.desk_label) rows.push([es ? 'Puesto asignado' : 'Assigned desk', p.desk_label]);
    if (p.price_final && p.total_cents) rows.push([es ? 'Cuota mensual' : 'Monthly fee', money(p.total_cents, lang, { decimals: 2 })]);
    else if (p.unit_price_cents) rows.push([es ? 'Cuota orientativa' : 'Indicative fee', `${money(p.unit_price_cents, lang)} ${es ? '+ IVA / mes' : '+ VAT / month'}`]);
    const accountUrl = `${cfg.baseUrl}${path('account', lang)}`;
    const subjects = {
      requested: [es ? `Solicitud de alta recibida · ${p.ref}` : `Membership request received · ${p.ref}`, es ? 'Hemos recibido tu solicitud. Te contactaremos para confirmar la fecha de inicio, el precio final y la forma de pago. No se ha realizado ningún cargo.' : 'We have received your request. We will contact you to confirm the start date, final price and payment method. Nothing has been charged.'],
      activated: [es ? `Bienvenida a FRAME · ${prod.name_es}` : `Welcome to FRAME · ${prod.name_en}`, es ? 'Tu plan está activo. Desde Mi cuenta puedes ver tu periodo, tus justificantes y, si tienes mesa flexible, reservar tus días.' : 'Your plan is active. In My account you can see your period, receipts and, with a flexible desk, book your days.'],
      renewal_due: [es ? `Renovación de tu plan · ${p.ref}` : `Your plan renewal · ${p.ref}`, es ? 'Se acerca la renovación de tu plan. Puedes pagar la siguiente mensualidad desde el enlace. Si no quieres renovar, solicita la baja en Mi cuenta.' : 'Your plan renewal is coming up. You can pay the next month from the link. If you do not want to renew, cancel in My account.'],
      renewed: [es ? `Plan renovado · ${p.ref}` : `Plan renewed · ${p.ref}`, es ? 'Hemos recibido el pago y tu plan se ha renovado.' : 'We received your payment and your plan has been renewed.'],
      past_due: [es ? `Pago pendiente de tu plan · ${p.ref}` : `Payment due for your plan · ${p.ref}`, es ? 'Tu periodo ha terminado y no consta el pago de la renovación. Contacta con recepción o paga desde el enlace que te enviamos.' : 'Your period has ended and we have not received the renewal payment. Contact reception or pay from the link we sent you.'],
      cancelled: [es ? `Baja registrada · ${p.ref}` : `Cancellation registered · ${p.ref}`, es ? 'Hemos registrado tu baja. El plan seguirá activo hasta el final del periodo pagado.' : 'We have registered your cancellation. The plan stays active until the end of the paid period.'],
    };
    const [subject, intro] = subjects[kind];
    let cta = { label: es ? 'Ir a Mi cuenta' : 'Go to My account', url: accountUrl };
    if (kind === 'renewal_due' && extra.orderId) {
      const o = db.get('SELECT * FROM orders WHERE id = ?', [extra.orderId]);
      cta = { label: es ? `Pagar ${money(o.total_cents, lang, { decimals: 2 })}` : `Pay ${money(o.total_cents, lang, { decimals: 2 })}`, url: `${cfg.baseUrl}/pagar/${o.ref}?t=${ctx.commerce.orderToken(o.ref)}` };
    }
    send(c.email, lang, `plan.${kind}`, p.ref, { subject, title: subject, intro, rows, blocks: kind === 'requested' || kind === 'activated' ? [p.conditions || ''] : [], cta });
    if (kind === 'requested') {
      send(cfg.notifyTo, 'es', 'admin.request', p.ref, { subject: `Solicitud de alta ${p.ref} · ${prod.name_es}`, title: `Solicitud de alta ${p.ref}`, intro: `${c.name || c.email} quiere darse de alta en ${prod.name_es}.`, rows, cta: { label: 'Abrir en el panel', url: `${cfg.baseUrl}/admin/planes` } });
    }
  }

  function voucherMail(voucherId) {
    const v = db.get('SELECT * FROM vouchers WHERE id = ?', [voucherId]);
    const c = db.get('SELECT * FROM customers WHERE id = ?', [v.customer_id]);
    const lang = c.lang || 'es';
    const es = lang !== 'en';
    const o = v.order_id ? db.get('SELECT * FROM orders WHERE id = ?', [v.order_id]) : null;
    const subject = es ? `Tu bono de ${v.credits_total} días · ${v.code}` : `Your ${v.credits_total}-day pass · ${v.code}`;
    send(c.email, lang, 'voucher.issued', v.code, {
      subject, title: subject,
      intro: es ? 'Tu bono ya está activo. Reserva cada día desde Mi cuenta; cada reserva descuenta un día del saldo.' : 'Your pass is active. Book each day from My account; each booking uses one day of your balance.',
      rows: [[es ? 'Código' : 'Code', v.code], [es ? 'Días' : 'Days', String(v.credits_total)], [es ? 'Válido hasta' : 'Valid until', T.fmtDateStr(v.expires_on, lang)],
        ...(o ? [[es ? 'Pedido' : 'Order', o.ref], [es ? 'Importe pagado' : 'Amount paid', money(o.total_cents, lang, { decimals: 2 })]] : [])],
      cta: { label: es ? 'Reservar un día' : 'Book a day', url: `${cfg.baseUrl}${path('account', lang)}` },
    });
  }

  function orderMail(orderId, kind) {
    const o = db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    const c = db.get('SELECT * FROM customers WHERE id = ?', [o.customer_id]);
    const lang = c.lang || 'es';
    const es = lang !== 'en';
    const subject = kind === 'failed' ? (es ? `El pago no se ha completado · ${o.ref}` : `Payment not completed · ${o.ref}`) : (es ? `Reembolso realizado · ${o.ref}` : `Refund completed · ${o.ref}`);
    const intro = kind === 'failed'
      ? (es ? 'La pasarela nos ha indicado que el pago no se ha completado. No se ha confirmado la operación. Si aún estás a tiempo, puedes reintentarlo desde el enlace de tu reserva.' : 'The gateway reported that the payment was not completed. The operation has not been confirmed. If there is still time, you can retry from your booking link.')
      : (es ? 'Hemos tramitado el reembolso. Puede tardar unos días en aparecer en tu cuenta según tu banco.' : 'We have processed the refund. It may take a few days to appear depending on your bank.');
    send(c.email, lang, `order.${kind}`, o.ref, { subject, title: subject, intro, rows: [[es ? 'Pedido' : 'Order', o.ref], [es ? 'Importe' : 'Amount', money(o.total_cents, lang, { decimals: 2 })]] });
  }

  return function notify(event, payload = {}) {
    try {
      switch (event) {
        case 'booking.requested': return bookingMail(payload.bookingId, 'requested');
        case 'booking.confirmed': return bookingMail(payload.bookingId, 'confirmed');
        case 'booking.changed': return bookingMail(payload.bookingId, 'changed');
        case 'booking.cancelled': return bookingMail(payload.bookingId, 'cancelled');
        case 'booking.rejected': return bookingMail(payload.bookingId, 'rejected');
        case 'booking.expired': return bookingMail(payload.bookingId, 'expired');
        case 'plan.requested': return planMail(payload.planId, 'requested');
        case 'plan.activated': return planMail(payload.planId, 'activated');
        case 'plan.renewal_due': return planMail(payload.planId, 'renewal_due', payload);
        case 'plan.renewed': return planMail(payload.planId, 'renewed');
        case 'plan.past_due': return planMail(payload.planId, 'past_due');
        case 'plan.cancelled': return planMail(payload.planId, 'cancelled');
        case 'voucher.issued': return voucherMail(payload.voucherId);
        case 'payment.failed': return orderMail(payload.orderId, 'failed');
        case 'payment.refunded': return orderMail(payload.orderId, 'refunded');
        case 'admin.alert': return send(cfg.notifyTo, 'es', 'admin.alert', null, { subject: payload.subject, title: payload.subject, intro: payload.text });
        case 'mail': return send(payload.to, payload.lang || 'es', payload.kind || 'generic', payload.ref, payload.content);
        default: return null;
      }
    } catch (e) {
      console.error('[notify]', event, e);
      return null;
    }
  };
}
