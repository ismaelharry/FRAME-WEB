// Precios calculados siempre en el servidor. Si el IVA no está configurado no se
// calcula ningún impuesto: se muestra el importe base orientativo y no se cobra.
import { taxOf, money } from '../lib/util.js';
import { commerceState } from './settings.js';

export function quoteProduct(ctx, product, { quantity = 1, minutes = null } = {}) {
  const commerce = commerceState(ctx.settings, ctx.payments);
  if (!product || product.price_cents === null || product.price_cents === undefined) {
    return { priced: false, payable: false, price_final: false, unit_price_cents: null, quantity, subtotal_cents: null, tax_rate_bp: null, tax_cents: null, total_cents: null, commerce };
  }
  const qty = product.unit === 'hour' ? Math.round(((minutes ?? 60) / 60) * 100) / 100 : quantity;
  const subtotal = Math.round(product.price_cents * qty);
  const priceFinal = commerce.taxReady;
  const tax = priceFinal ? taxOf(subtotal, commerce.taxRateBp) : null;
  const total = priceFinal ? subtotal + tax : null;
  return {
    priced: true,
    price_final: priceFinal,
    payable: commerce.canSell && priceFinal && total > 0,
    unit_price_cents: product.price_cents,
    quantity: qty,
    subtotal_cents: subtotal,
    tax_rate_bp: priceFinal ? commerce.taxRateBp : null,
    tax_cents: tax,
    total_cents: total,
    commerce,
  };
}

const UNIT = {
  es: { day: 'día', pack: 'bono', month: 'mes', hour: 'hora', visit: 'visita', quote: '' },
  en: { day: 'day', pack: 'pass', month: 'month', hour: 'hour', visit: 'tour', quote: '' },
};

// Texto corto de precio para mostrar en tarjetas y tablas.
export function priceLabel(ctx, product, lang = 'es') {
  if (!product) return '';
  if (product.price_cents === null) return lang === 'en' ? 'Request a quote' : 'Solicitar presupuesto';
  if (product.price_cents === 0) return lang === 'en' ? 'Free' : 'Gratis';
  const q = quoteProduct(ctx, product, { quantity: 1, minutes: 60 });
  const unit = UNIT[lang][product.unit];
  const per = unit && product.unit !== 'pack' ? ` / ${unit}` : '';
  if (q.price_final) {
    return `${money(q.total_cents, lang)}${per}`;
  }
  return `${money(product.price_cents, lang)}${per}`;
}

export function taxNote(ctx, lang = 'es') {
  const c = commerceState(ctx.settings, ctx.payments);
  if (c.taxReady) {
    const pct = (c.taxRateBp / 100).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES');
    return lang === 'en' ? `Prices include ${pct}% VAT.` : `Precios con ${ctx.settings.get('commerce').tax_label} (${pct} %) incluido.`;
  }
  return lang === 'en'
    ? 'Indicative base prices, before tax. Final prices including tax are shown before any purchase.'
    : 'Tarifas base orientativas, sin IVA. El precio final con impuestos se muestra antes de cualquier compra.';
}

// Condiciones aplicables a una operación, en el idioma de la reserva.
// Es exactamente el texto que se muestra en la revisión y se guarda con la compra.
export function conditionsFor(ctx, { product, resource, usage, mode, lang = 'es' }) {
  const p = ctx.settings.get('policies');
  const es = lang !== 'en';
  const lines = [];
  if (usage === 'plan_purchase') {
    lines.push(es ? 'Plan mensual sin permanencia: se renueva automáticamente cada mes hasta que solicites la baja.'
      : 'Monthly plan with no minimum stay: it renews automatically every month until you cancel.');
    lines.push(p.plan_cancel_notice_days > 0
      ? (es ? `La baja debe solicitarse con ${p.plan_cancel_notice_days} días de antelación a la renovación.` : `Cancellation must be requested ${p.plan_cancel_notice_days} days before renewal.`)
      : (es ? 'Puedes darte de baja en cualquier momento antes de la siguiente renovación; el mes en curso no se reembolsa.' : 'You can cancel at any time before the next renewal; the current month is not refunded.'));
    if (product?.plan_type === 'fixed') lines.push(es ? 'Incluye un puesto asignado y acceso 24/7.' : 'Includes an assigned desk and 24/7 access.');
    if (product?.plan_type === 'flex') lines.push(es ? 'Uso de cualquier puesto libre en horario de coworking, sin acceso 24/7.' : 'Use of any free desk during coworking hours, without 24/7 access.');
    if (product?.plan_type === 'virtual') lines.push(es ? 'No incluye puesto de trabajo.' : 'Does not include a desk.');
  } else if (usage === 'bundle_purchase') {
    lines.push(es ? `El bono incluye ${product.credits} días y caduca ${product.validity_days || p.voucher_validity_days} días después de la compra.`
      : `The pass includes ${product.credits} days and expires ${product.validity_days || p.voucher_validity_days} days after purchase.`);
    lines.push(es ? `Cada reserva descuenta un día por persona. Si cancelas con más de ${p.cancel_free_hours} h de antelación, el día vuelve a tu saldo.`
      : `Each booking uses one day per person. Cancel more than ${p.cancel_free_hours} h ahead and the day returns to your balance.`);
  } else {
    if (usage === 'visit') {
      lines.push(es ? 'Visita gratuita y sin compromiso. Si no puedes venir, cancélala desde el enlace del correo.'
        : 'Free, no-obligation tour. If you cannot come, cancel it from the link in the email.');
    } else if (usage === 'trial') {
      lines.push(ctx.settings.get('trial')[es ? 'conditions_es' : 'conditions_en']);
    } else {
      lines.push(es ? `Cambios gratuitos hasta ${p.modify_min_hours} h antes del inicio y cancelación gratuita hasta ${p.cancel_free_hours} h antes.`
        : `Free changes up to ${p.modify_min_hours} h before the start and free cancellation up to ${p.cancel_free_hours} h before.`);
      if (mode === 'pay') {
        lines.push(p.late_cancel_refund
          ? (es ? 'Las cancelaciones fuera de plazo también se reembolsan.' : 'Late cancellations are also refunded.')
          : (es ? 'Las cancelaciones fuera de ese plazo no se reembolsan.' : 'Cancellations after that are not refunded.'));
      }
    }
    if (usage === 'voucher') lines.push(es ? 'Se descuenta un día del bono por persona.' : 'One day per person is deducted from your pass.');
    if (usage === 'plan') lines.push(es ? 'Incluido en tu plan de mesa flexible.' : 'Included in your flexible desk plan.');
    if (resource?.kind === 'desk_pool') lines.push(es ? 'Acceso en horario de coworking; el acceso 24/7 es exclusivo de la mesa fija.'
      : 'Access during coworking hours; 24/7 access is only included in the fixed desk plan.');
  }
  if (mode === 'request') {
    lines.push(es ? `Es una solicitud: no se realiza ningún cargo. Mantenemos el hueco reservado hasta ${p.request_hold_hours} h mientras te confirmamos precio final y condiciones.`
      : `This is a request: nothing is charged. We hold the slot for up to ${p.request_hold_hours} h while we confirm the final price and conditions.`);
  }
  if (mode === 'pay') {
    lines.push(es ? `El pago se realiza en la pasarela segura. Reservamos el hueco ${p.payment_hold_minutes} minutos mientras completas el pago; si no se completa, se libera.`
      : `Payment is made on the secure gateway. We hold the slot for ${p.payment_hold_minutes} minutes while you pay; otherwise it is released.`);
    lines.push(es ? 'Recibirás un justificante de reserva. La factura la emite FRAME S.L. a través de su sistema de facturación.'
      : 'You will receive a booking receipt. Invoices are issued by FRAME S.L. through its invoicing system.');
  }
  return lines.join('\n');
}
