// Páginas legales. Texto base elaborado a partir de la LSSI-CE, el RGPD/LOPDGDD y el
// TRLGDCU (RDL 1/2007). Debe revisarlo la asesoría jurídica de FRAME antes de producción.
import { html, raw } from '../../lib/html.js';
import { layout } from '../layout.js';
import { label, breadcrumbs } from '../components.js';
import { path } from '../../i18n/routes.js';

const UPDATED = { es: '28 de octubre de 2026', en: '28 October 2026' };

function titular(b, es) {
  return html`<p><strong>${b.legal_name}</strong> (${es ? 'marca comercial' : 'trading name'} ${b.brand})<br>
NIF: ${b.tax_id}<br>${es ? 'Domicilio' : 'Address'}: ${b.street}, ${b.postal_code} ${b.city} (${b.province}), ${b.country}<br>
${es ? 'Teléfono' : 'Phone'}: ${b.phone} · Email: <a href="mailto:${b.email}">${b.email}</a>
${b.registry ? html`<br>${b.registry}` : ''}</p>`;
}

function noticeEs(b) {
  return html`
<h2>1. Titular del sitio web</h2>
<p>En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), se informa de los datos del titular:</p>
${titular(b, true)}
<h2>2. Objeto</h2>
<p>Este sitio web informa sobre los servicios de coworking, alquiler de espacios de trabajo y reuniones, y estudio de grabación de pódcast, vídeo y contenido digital que FRAME presta en su única sede de Torrevieja, y permite consultar disponibilidad, reservar y gestionar reservas.</p>
<h2>3. Condiciones de uso</h2>
<p>El acceso es gratuito, salvo el coste de la conexión. Te comprometes a usar el sitio de forma lícita, a facilitar datos veraces y a no realizar acciones que dañen, saturen o impidan su funcionamiento, incluidos los intentos de acceso no autorizado a áreas privadas o a datos de otras personas.</p>
<h2>4. Propiedad intelectual e industrial</h2>
<p>Los textos, el diseño, el logotipo y la marca FRAME, así como el resto de contenidos, pertenecen a ${b.legal_name} o se usan con autorización. Las imágenes identificadas como «render conceptual» son recreaciones del proyecto y no fotografías del local. No se permite su reproducción con fines comerciales sin autorización.</p>
<h2>5. Responsabilidad</h2>
<p>FRAME procura que la información sea exacta y esté actualizada. Las tarifas, horarios e inventario que se indiquen como orientativos o provisionales pueden cambiar hasta su confirmación. Los enlaces a sitios de terceros (por ejemplo, servicios de mapas) se ofrecen por comodidad; FRAME no controla sus contenidos.</p>
<h2>6. Legislación y jurisdicción</h2>
<p>Se aplica la legislación española. Si actúas como consumidor, serán competentes los juzgados de tu domicilio; en otro caso, los de Torrevieja (Alicante), salvo que una norma disponga otra cosa.</p>`;
}

function noticeEn(b) {
  return html`
<p class="note small">This is an English translation for convenience. The Spanish version prevails.</p>
<h2>1. Website owner</h2>
<p>In accordance with article 10 of Spanish Law 34/2002 (LSSI-CE):</p>
${titular(b, false)}
<h2>2. Purpose</h2>
<p>This website provides information about the coworking, workspace and meeting room rental, and podcast, video and digital content studio services that FRAME provides at its only location in Torrevieja, and lets you check availability, book and manage bookings.</p>
<h2>3. Terms of use</h2>
<p>Access is free apart from your connection costs. You agree to use the site lawfully, provide truthful information and not to damage, overload or interfere with it, including attempts to access private areas or other people’s data.</p>
<h2>4. Intellectual property</h2>
<p>Texts, design, the FRAME logo and trademark and other content belong to ${b.legal_name} or are used with permission. Images labelled “concept render” are recreations of the project, not photographs of the venue.</p>
<h2>5. Liability</h2>
<p>FRAME strives to keep information accurate and up to date. Prices, opening hours and inventory marked as indicative or provisional may change until confirmed. Links to third-party sites are provided for convenience.</p>
<h2>6. Law and jurisdiction</h2>
<p>Spanish law applies. If you act as a consumer, the courts of your place of residence have jurisdiction; otherwise those of Torrevieja (Alicante), unless the law provides otherwise.</p>`;
}

function privacyEs(b, pol) {
  return html`
<h2>Responsable del tratamiento</h2>
${titular(b, true)}
<h2>Qué datos tratamos</h2>
<ul>
<li>Identificación y contacto: nombre, correo electrónico y, si lo facilitas, teléfono y empresa.</li>
<li>Datos de tus reservas, compras, bonos y planes, y las condiciones aceptadas.</li>
<li>Datos de facturación opcionales (empresa, NIF/CIF, dirección) si solicitas factura.</li>
<li>Datos del pago: el pago se realiza en la pasarela; FRAME no recibe ni guarda los datos completos de tu tarjeta.</li>
<li>Mensajes que nos envías por los formularios.</li>
<li>Datos técnicos mínimos para la seguridad del sitio (por ejemplo, dirección IP en registros y límites anti abuso).</li>
</ul>
<p>Solo pedimos los datos necesarios para cada gestión. Los campos obligatorios se indican en cada formulario; sin ellos no podemos atender la solicitud.</p>
<h2>Para qué y con qué base jurídica</h2>
<table><thead><tr><th>Finalidad</th><th>Base jurídica</th></tr></thead><tbody>
<tr><td>Gestionar reservas, compras, bonos, planes, visitas y el acceso a Mi cuenta</td><td>Ejecución de un contrato o medidas precontractuales (art. 6.1.b RGPD)</td></tr>
<tr><td>Responder consultas y preparar presupuestos</td><td>Medidas precontractuales a petición tuya (art. 6.1.b RGPD)</td></tr>
<tr><td>Facturación y cumplimiento de obligaciones contables y fiscales</td><td>Obligación legal (art. 6.1.c RGPD)</td></tr>
<tr><td>Enviarte novedades y eventos de FRAME</td><td>Tu consentimiento, separado de la contratación y revocable en cualquier momento (art. 6.1.a RGPD)</td></tr>
<tr><td>Proteger el sitio frente a fraudes y abusos</td><td>Interés legítimo (art. 6.1.f RGPD)</td></tr>
</tbody></table>
<h2>Cuánto tiempo los conservamos</h2>
<p>Mientras dure la relación y, después, durante los plazos legales aplicables (por ejemplo, seis años para la documentación mercantil y los plazos de prescripción tributaria). Las consultas sin contratación se conservan un máximo de un año. Los datos para novedades se conservan hasta que retires tu consentimiento.</p>
<h2>Quién puede acceder a tus datos</h2>
<p>Proveedores que nos prestan servicios como encargados del tratamiento, con contrato conforme al RGPD: alojamiento web, envío de correo, pasarela de pago (Stripe, cuando el pago online esté activo) y el sistema de facturación que utilice FRAME. También la Administración Tributaria y otras autoridades cuando una ley lo exija. Si algún proveedor trata datos fuera del Espacio Económico Europeo, se hará con las garantías previstas en el RGPD (como cláusulas contractuales tipo o decisiones de adecuación).</p>
<h2>Tus derechos</h2>
<p>Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad, y retirar tu consentimiento, escribiendo a <a href="mailto:${b.email}">${b.email}</a>. Puedes actualizar tus datos desde Mi cuenta. Si consideras que no hemos atendido correctamente tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" rel="noopener">www.aepd.es</a>).</p>
<h2>Seguridad</h2>
<p>Aplicamos medidas técnicas y organizativas adecuadas: conexiones cifradas, contraseñas del panel cifradas, enlaces de gestión firmados, acceso restringido por permisos y control de abuso en formularios.</p>`;
}

function privacyEn(b) {
  return html`
<p class="note small">This is an English translation for convenience. The Spanish version prevails.</p>
<h2>Data controller</h2>
${titular(b, false)}
<h2>What data we process</h2>
<ul>
<li>Identification and contact: name, email and, if provided, phone and company.</li>
<li>Your bookings, purchases, passes and plans, and the conditions accepted.</li>
<li>Optional billing data (company, tax ID, address) if you request an invoice.</li>
<li>Payment data: payment is made on the gateway; FRAME does not receive or store full card details.</li>
<li>Messages you send through the forms.</li>
<li>Minimal technical data for site security (for example IP addresses in logs and anti-abuse limits).</li>
</ul>
<h2>Purposes and legal bases</h2>
<table><thead><tr><th>Purpose</th><th>Legal basis</th></tr></thead><tbody>
<tr><td>Managing bookings, purchases, passes, plans, tours and My account</td><td>Performance of a contract or pre-contractual steps (art. 6.1.b GDPR)</td></tr>
<tr><td>Answering enquiries and preparing quotes</td><td>Pre-contractual steps at your request (art. 6.1.b GDPR)</td></tr>
<tr><td>Invoicing and accounting/tax obligations</td><td>Legal obligation (art. 6.1.c GDPR)</td></tr>
<tr><td>Sending FRAME news and events</td><td>Your consent, separate from the purchase and revocable at any time (art. 6.1.a GDPR)</td></tr>
<tr><td>Protecting the site against fraud and abuse</td><td>Legitimate interest (art. 6.1.f GDPR)</td></tr>
</tbody></table>
<h2>Retention</h2>
<p>For the duration of the relationship and then for the applicable legal periods. Enquiries without a purchase are kept for up to one year. Marketing data is kept until you withdraw consent.</p>
<h2>Recipients</h2>
<p>Service providers acting as processors under GDPR-compliant contracts: hosting, email delivery, payment gateway (Stripe, when online payment is active) and FRAME’s invoicing system; and authorities when required by law. Transfers outside the EEA, if any, use GDPR safeguards.</p>
<h2>Your rights</h2>
<p>You can exercise your rights of access, rectification, erasure, objection, restriction and portability, and withdraw consent, by writing to <a href="mailto:${b.email}">${b.email}</a>. You may complain to the Spanish Data Protection Agency (<a href="https://www.aepd.es" rel="noopener">www.aepd.es</a>).</p>`;
}

function cookiesPage(es) {
  const rows = es ? [
    ['frame_csrf', 'Propia · técnica', 'Protege los formularios frente a envíos fraudulentos (CSRF).', '7 días'],
    ['frame_sid', 'Propia · técnica', 'Mantiene tu sesión en Mi cuenta.', '30 días'],
    ['frame_admin', 'Propia · técnica', 'Sesión del panel de administración (solo personal de FRAME).', '12 horas'],
    ['frame_consent', 'Propia · técnica', 'Guarda tu elección sobre cookies.', '6 meses'],
    ['frame_vk', 'Propia · técnica', 'Solo en el entorno de prueba: muestra en este navegador los correos de prueba que no se envían.', '30 días'],
  ] : [
    ['frame_csrf', 'First-party · technical', 'Protects forms against forged submissions (CSRF).', '7 days'],
    ['frame_sid', 'First-party · technical', 'Keeps you signed in to My account.', '30 days'],
    ['frame_admin', 'First-party · technical', 'Admin panel session (FRAME staff only).', '12 hours'],
    ['frame_consent', 'First-party · technical', 'Stores your cookie choice.', '6 months'],
    ['frame_vk', 'First-party · technical', 'Test environment only: shows test emails (not sent) in this browser.', '30 days'],
  ];
  return html`
<h2>${es ? 'Qué son las cookies' : 'What cookies are'}</h2>
<p>${es ? 'Son pequeños archivos que el sitio guarda en tu navegador. Algunas son necesarias para que funcione; otras solo se usan si das tu consentimiento.' : 'Small files the site stores in your browser. Some are necessary for it to work; others are only used if you consent.'}</p>
<h2>${es ? 'Cookies necesarias' : 'Necessary cookies'}</h2>
<p>${es ? 'No requieren consentimiento porque son imprescindibles para prestar el servicio que solicitas.' : 'They do not require consent because they are essential to provide the service you request.'}</p>
<table><thead><tr><th>${es ? 'Nombre' : 'Name'}</th><th>${es ? 'Tipo' : 'Type'}</th><th>${es ? 'Finalidad' : 'Purpose'}</th><th>${es ? 'Duración' : 'Duration'}</th></tr></thead>
<tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table>
<h2>${es ? 'Cookies que requieren consentimiento' : 'Cookies that require consent'}</h2>
<ul>
<li><strong>${es ? 'Mapas de terceros' : 'Third-party maps'}</strong>: ${es ? 'el mapa de Google Maps de la página de contacto puede instalar cookies de Google. No se carga hasta que lo aceptas; mientras tanto ofrecemos enlaces para abrir la dirección en la aplicación de mapas que prefieras.' : 'the Google Maps map on the contact page may set Google cookies. It is not loaded until you accept; meanwhile we offer links to open the address in your preferred maps app.'}</li>
<li><strong>${es ? 'Medición' : 'Measurement'}</strong>: ${es ? 'actualmente no hay ninguna herramienta de analítica activa. Si FRAME la configura, solo se cargará con tu consentimiento y se detallará aquí.' : 'no analytics tool is currently active. If FRAME configures one, it will only load with your consent and will be listed here.'}</li>
</ul>
<h2>${es ? 'Cómo gestionar tu elección' : 'How to manage your choice'}</h2>
<p>${es ? 'Aceptar y rechazar tienen la misma visibilidad en el aviso. Puedes cambiar tu decisión en cualquier momento con el botón «Preferencias de cookies» del pie de página o eliminando las cookies desde tu navegador.' : 'Accept and reject are equally visible in the notice. You can change your decision at any time with the “Cookie preferences” button in the footer or by deleting cookies in your browser.'}</p>
<p><button type="button" class="btn btn--sm btn--plain" data-cookie-settings>${es ? 'Abrir preferencias de cookies' : 'Open cookie preferences'}</button></p>
<p>${es ? 'El pago, cuando está activo, se realiza en la página de la pasarela (Stripe), que aplica su propia política de cookies.' : 'Payment, when active, takes place on the gateway’s page (Stripe), which applies its own cookie policy.'}</p>`;
}

function termsEs(ctx, b) {
  const p = ctx.settings.get('policies');
  const c = ctx.settings.get('commerce');
  const t = ctx.settings.get('trial');
  return html`
<h2>1. Prestador</h2>
${titular(b, true)}
<h2>2. Servicios</h2>
<p>Pase de día, bono de 10 días, mesa flexible, mesa fija con acceso 24/7, oficina virtual, salas de reuniones, cabinas de videollamada, estudio de pódcast y vídeo, despachos privados, visitas guiadas y día de prueba. La descripción, lo que incluye cada servicio y su precio se muestran en la web antes de contratar.</p>
<h2>3. Precios e impuestos</h2>
<p>Los precios se expresan en euros. ${c.tax_configured && Number.isInteger(c.tax_rate_bp) ? `Los precios finales incluyen el ${c.tax_label} (${(c.tax_rate_bp / 100).toLocaleString('es-ES')} %).` : 'Mientras FRAME no confirme el régimen de impuestos, las tarifas publicadas son importes base orientativos sin impuestos y no se realizan cobros online: las operaciones se registran como solicitudes sin cargo.'} Antes de confirmar cualquier compra se muestra el precio final completo, con impuestos y cualquier suplemento. Los servicios sin tarifa publicada se prestan bajo presupuesto aceptado.</p>
<h2>4. Cómo se contrata</h2>
<ol>
<li>Eliges el servicio, la fecha, el horario, la duración y el número de personas cuando corresponda. La disponibilidad se consulta en tiempo real.</li>
<li>Indicas tus datos de contacto. No es necesario crear una cuenta.</li>
<li>Revisas el resumen: espacio, horario, condiciones aplicables y precio final cuando está disponible.</li>
<li>Confirmas con el botón que indica la obligación de pago («Pagar … ahora») o envías una solicitud sin cargo.</li>
<li>Recibes una referencia y un justificante por correo electrónico con el estado de la reserva y un enlace personal para gestionarla.</li>
</ol>
<p>La disponibilidad vuelve a comprobarse al confirmar. Si el último hueco se ocupa mientras completas el proceso, se te informará y no se realizará ningún cargo.</p>
<h2>5. Pago</h2>
<p>El pago se realiza en una pasarela segura (Stripe). FRAME no guarda los datos de tu tarjeta. La reserva solo se considera pagada cuando la pasarela confirma el cobro; mientras tanto el hueco queda retenido ${p.payment_hold_minutes} minutos y, si el pago no se completa, se libera.</p>
<h2>6. Solicitudes y presupuestos</h2>
<p>Cuando un servicio no tiene precio final o requiere confirmación, la operación se registra como solicitud. El hueco queda retenido hasta ${p.request_hold_hours} horas mientras FRAME confirma precio y condiciones. Si no se confirma en ese plazo, se libera sin coste.</p>
<h2>7. Cambios y cancelaciones</h2>
<ul>
<li>Puedes cambiar la fecha u hora hasta ${p.modify_min_hours} horas antes del inicio, sujeto a disponibilidad. En reservas ya pagadas, el cambio mantiene la duración y el número de personas.</li>
<li>Puedes cancelar sin coste hasta ${p.cancel_free_hours} horas antes del inicio: se reembolsa el pago o se devuelve el día al bono.</li>
<li>${p.late_cancel_refund ? 'Las cancelaciones fuera de plazo también se reembolsan.' : 'Las cancelaciones fuera de ese plazo no dan derecho a reembolso.'}</li>
<li>FRAME puede cancelar una reserva por causa justificada (por ejemplo, una avería que impida usar el espacio); en ese caso se reembolsa íntegramente.</li>
</ul>
<h2>8. Bono de 10 días</h2>
<p>Incluye diez días de acceso en horario de coworking y caduca en el plazo indicado en la compra. Cada reserva descuenta un día por persona; el saldo y el historial se consultan en Mi cuenta. Los días no utilizados al caducar no son reembolsables.</p>
<h2>9. Planes mensuales y renovaciones</h2>
<p>La mesa flexible, la mesa fija y la oficina virtual son planes mensuales. La mesa flexible no tiene permanencia. Las condiciones de permanencia de cada plan se indican antes del alta. Antes de cada renovación FRAME envía el enlace de pago de la mensualidad siguiente; si no se paga, el plan finaliza al acabar el periodo. Puedes solicitar la baja desde Mi cuenta antes de la renovación${p.plan_cancel_notice_days ? ` con ${p.plan_cancel_notice_days} días de antelación` : ''}. Los cambios de precio se comunicarán con al menos un mes de antelación y podrás darte de baja antes de que se apliquen. El acceso 24/7 está incluido solo en la mesa fija.</p>
<h2>10. Día de prueba</h2>
<p>${t.conditions_es}</p>
<h2>11. Derecho de desistimiento (consumidores)</h2>
<p>Si contratas como consumidor, dispones de 14 días naturales desde la contratación para desistir sin indicar el motivo, comunicándolo a <a href="mailto:${b.email}">${b.email}</a>. Si solicitas que el servicio se preste durante ese plazo y desistes, abonarás la parte proporcional ya prestada. Una vez prestado el servicio por completo con tu solicitud expresa, no podrás desistir. Si contratas para tu actividad profesional o empresarial, no te aplica este derecho legal, sin perjuicio de las cancelaciones previstas en el apartado 7.</p>
<h2>12. Justificantes y facturas</h2>
<p>El correo de confirmación y el justificante disponible en Mi cuenta acreditan la operación, pero no son facturas. La factura la emite ${b.legal_name} mediante su sistema de facturación; para recibirla a nombre de una empresa, indica su NIF/CIF.</p>
<h2>13. Uso del espacio</h2>
<p>Te pedimos respetar el trabajo de las demás personas, el horario del servicio contratado y el equipamiento. FRAME puede denegar el acceso en caso de uso indebido.</p>
<h2>14. Reclamaciones</h2>
<p>Puedes dirigir cualquier reclamación a <a href="mailto:${b.email}">${b.email}</a> o al ${b.phone}. Tienes a tu disposición hojas oficiales de reclamaciones en el local.</p>
<h2>15. Ley aplicable</h2>
<p>Estas condiciones se rigen por la legislación española, en particular el texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios (Real Decreto Legislativo 1/2007).</p>`;
}

function termsEn(ctx, b) {
  const p = ctx.settings.get('policies');
  const c = ctx.settings.get('commerce');
  return html`
<p class="note small">This is an English translation for convenience. The Spanish version prevails.</p>
<h2>1. Provider</h2>
${titular(b, false)}
<h2>2. Services</h2>
<p>Day pass, 10-day pass, flexible desk, fixed desk with 24/7 access, virtual office, meeting rooms, video-call booths, podcast & video studio, private offices, guided tours and trial day.</p>
<h2>3. Prices and tax</h2>
<p>Prices are in euros. ${c.tax_configured && Number.isInteger(c.tax_rate_bp) ? `Final prices include VAT (${(c.tax_rate_bp / 100).toLocaleString('en-GB')}%).` : 'Until FRAME confirms the tax regime, published rates are indicative base amounts before tax and no online charges are made: operations are saved as requests at no charge.'} The full final price, including tax and any extras, is shown before you confirm any purchase.</p>
<h2>4. How to buy</h2>
<p>Choose the service, date, time, duration and people; enter your contact details (no account needed); review the summary, conditions and final price; confirm with the button stating the obligation to pay or send a request at no charge; you receive a reference and an email receipt with a personal link to manage your booking. Availability is checked again when you confirm.</p>
<h2>5. Payment</h2>
<p>Payment is made on a secure gateway (Stripe). FRAME does not store your card details. A booking is only paid once the gateway confirms it; the slot is held for ${p.payment_hold_minutes} minutes meanwhile.</p>
<h2>6. Changes and cancellations</h2>
<p>Changes up to ${p.modify_min_hours} h before the start, subject to availability. Free cancellation up to ${p.cancel_free_hours} h before the start (refund or day returned to your pass). ${p.late_cancel_refund ? 'Late cancellations are also refunded.' : 'Later cancellations are not refunded.'}</p>
<h2>7. Passes and monthly plans</h2>
<p>The 10-day pass expires after the period stated at purchase. Monthly plans renew via a payment link before each period; the flexible desk has no minimum stay; you can cancel from My account before renewal. Price changes are notified at least one month in advance. 24/7 access is only included in the fixed desk plan.</p>
<h2>8. Right of withdrawal (consumers)</h2>
<p>Consumers have 14 calendar days to withdraw by writing to <a href="mailto:${b.email}">${b.email}</a>. If you request the service to start within that period and then withdraw, you pay for the part already provided; once fully provided at your express request, you can no longer withdraw. This legal right does not apply when you buy for your business.</p>
<h2>9. Receipts and invoices</h2>
<p>Confirmation emails and receipts are not invoices. Invoices are issued by ${b.legal_name} through its invoicing system.</p>
<h2>10. Complaints and law</h2>
<p>Write to <a href="mailto:${b.email}">${b.email}</a> or call ${b.phone}. Official complaint forms are available on site. Spanish law applies.</p>`;
}

export function renderLegal(ctx, req, res, which) {
  const lang = req.lang;
  const es = lang !== 'en';
  const b = ctx.settings.get('business');
  const titles = {
    notice: es ? 'Aviso legal' : 'Legal notice',
    privacy: es ? 'Política de privacidad' : 'Privacy policy',
    cookies: es ? 'Política de cookies' : 'Cookie policy',
    terms: es ? 'Condiciones de contratación' : 'Terms of purchase',
  };
  const content = {
    notice: () => (es ? noticeEs(b) : noticeEn(b)),
    privacy: () => (es ? privacyEs(b, ctx.settings.get('policies')) : privacyEn(b)),
    cookies: () => cookiesPage(es),
    terms: () => (es ? termsEs(ctx, b) : termsEn(ctx, b)),
  }[which]();
  const body = html`
<section class="page-hero wrap">
  ${breadcrumbs([[path('home', lang), 'FRAME'], [path(`legal.${which}`, lang), titles[which]]])}
  ${label('', 'Legal')}
  <h1 class="display-2 mt-2">${titles[which]}</h1>
  <p class="small muted mt-2">${es ? 'Última actualización' : 'Last updated'}: ${UPDATED[lang]}</p>
</section>
<section class="wrap section--tight"><div class="prose">${content}</div></section>`;
  return layout(ctx, req, res, { title: titles[which], description: `${titles[which]} · FRAME S.L. · Torrevieja`, body, routeId: `legal.${which}` });
}

export { raw };
