// Datos iniciales de FRAME. Las tarifas proceden del estudio de mercado (base sin IVA,
// orientativas). El inventario y los horarios son de demostración y se editan desde /admin.
import crypto from 'node:crypto';
import { hashPassword } from '../lib/password.js';
import { dayBoundsUtc } from '../lib/time.js';

const J = (v) => JSON.stringify(v);
const wk = (r, sat = [], sun = []) => ({ mon: r, tue: r, wed: r, thu: r, fri: r, sat, sun });
const ALL_DAY = [['00:00', '24:00']];

export const SEED_VERSION = 1;

const SPACES = [
  {
    slug: 'coworking', sort: 1, area_m2: 165,
    name_es: 'Coworking', name_en: 'Coworking',
    tagline_es: 'Un puesto cómodo, buena luz y gente con la que hablar cuando te apetezca.',
    tagline_en: 'A comfortable desk, good light and people to talk to when you feel like it.',
    description_es: 'La zona abierta de FRAME reúne los puestos de trabajo en un espacio amplio y tranquilo. Puedes venir un día suelto, usar un bono de diez días o hacerte miembro.\n\nCon la mesa flexible utilizas cualquier puesto libre, sin permanencia. Con la mesa fija tienes tu propio puesto reservado y acceso 24/7. Junto a la zona abierta hay cabinas para videollamadas que se reservan por horas.',
    description_en: 'FRAME’s open area brings the workstations together in a large, calm space. Come for a single day, use a ten-day pass or become a member.\n\nWith a flexible desk you use any free desk, with no minimum stay. With a fixed desk you get your own reserved desk and 24/7 access. Next to the open area there are video-call booths you can book by the hour.',
    includes_es: J(['Puesto de trabajo en la zona compartida', 'Wifi', 'Café, té y agua', 'Office y zona de descanso', 'Acceso a la agenda de comunidad']),
    includes_en: J(['A desk in the shared area', 'Wifi', 'Coffee, tea and water', 'Kitchenette and break area', 'Access to the community calendar']),
    equipment_es: J(['Mesas amplias y sillas ergonómicas', 'Enchufes en cada puesto', 'Cabinas de videollamada (reserva por horas)']),
    equipment_en: J(['Large desks and ergonomic chairs', 'Power at every desk', 'Video-call booths (bookable by the hour)']),
    conditions_es: 'El pase de día y el bono dan acceso en horario de coworking. El acceso 24/7 está vinculado únicamente al plan de mesa fija.',
    conditions_en: 'Day passes and the ten-day pass give access during coworking hours. 24/7 access is only included in the fixed desk plan.',
    capacity_text_es: '{desks} puestos', capacity_text_en: '{desks} desks',
  },
  {
    slug: 'salas', sort: 2, area_m2: 45,
    name_es: 'Salas de reuniones', name_en: 'Meeting rooms',
    tagline_es: 'Para reunirte con clientes, presentar una propuesta o pensar en equipo.',
    tagline_en: 'To meet clients, pitch a proposal or think as a team.',
    description_es: 'Dos salas cerradas, con mesa de trabajo y pantalla, para reuniones presenciales o híbridas. Se reservan por horas y la sala queda bloqueada para ti en cuanto se registra tu reserva.\n\nNo hace falta ser miembro: cualquier profesional puede reservarlas.',
    description_en: 'Two closed rooms with a meeting table and a screen, for in-person or hybrid meetings. They are booked by the hour and the room is held for you as soon as your booking is registered.\n\nYou don’t need to be a member: any professional can book them.',
    includes_es: J(['Sala privada durante el tiempo reservado', 'Wifi', 'Agua para los asistentes', 'Recepción de tus invitados en horario de recepción']),
    includes_en: J(['A private room for the time booked', 'Wifi', 'Water for attendees', 'Guests welcomed during reception hours']),
    equipment_es: J(['Pantalla para presentar', 'Pizarra', 'Mesa de reuniones']),
    equipment_en: J(['Presentation screen', 'Whiteboard', 'Meeting table']),
    conditions_es: 'Reserva mínima de una hora. Puedes cambiar o cancelar sin coste hasta {cancel_hours} h antes del inicio.',
    conditions_en: 'Minimum booking of one hour. Free changes and cancellations up to {cancel_hours} h before the start.',
  },
  {
    slug: 'despachos', sort: 3, area_m2: 45,
    name_es: 'Despachos privados', name_en: 'Private offices',
    tagline_es: 'Un espacio cerrado para tu equipo, con todo lo de una comunidad alrededor.',
    tagline_en: 'A closed space for your team, with a whole community around it.',
    description_es: 'Tres despachos cerrados para equipos pequeños que necesitan concentración y privacidad, con acceso a las zonas comunes, las salas y la agenda de FRAME.\n\nCada equipo tiene necesidades distintas, así que preparamos un presupuesto según el tamaño, la fecha de entrada y la duración.',
    description_en: 'Three closed offices for small teams who need focus and privacy, with access to the common areas, meeting rooms and FRAME’s calendar.\n\nEvery team is different, so we prepare a quote based on size, start date and length of stay.',
    includes_es: J(['Despacho cerrado de uso exclusivo', 'Acceso a zonas comunes y office', 'Wifi', 'Café, té y agua']),
    includes_en: J(['A closed office for your exclusive use', 'Access to common areas and kitchenette', 'Wifi', 'Coffee, tea and water']),
    equipment_es: J(['Mesas y sillas para el equipo', 'Almacenamiento con llave']),
    equipment_en: J(['Desks and chairs for the team', 'Lockable storage']),
    conditions_es: 'Precio bajo presupuesto. Indícanos el número de personas y la fecha en la que te gustaría entrar.',
    conditions_en: 'Price on request. Tell us the team size and when you would like to move in.',
  },
  {
    slug: 'estudio', sort: 4, area_m2: 35,
    name_es: 'Estudio de pódcast y vídeo', name_en: 'Podcast & video studio',
    tagline_es: 'Graba tu pódcast, una entrevista o contenido para redes sin montar nada en casa.',
    tagline_en: 'Record your podcast, an interview or social content without setting anything up at home.',
    description_es: 'Un estudio pensado para grabar pódcast, entrevistas, vídeo y contenido digital, dentro del mismo espacio en el que trabajas.\n\nEliges fecha y franja, comprobamos disponibilidad al momento y te enviamos el presupuesto según la sesión que necesites.',
    description_en: 'A studio designed for recording podcasts, interviews, video and digital content, inside the same space where you work.\n\nPick a date and time slot, we check availability instantly and send you a quote for the session you need.',
    includes_es: J(['Uso del estudio en la franja reservada', 'Zona de espera para invitados', 'Wifi']),
    includes_en: J(['Use of the studio for the booked slot', 'Waiting area for guests', 'Wifi']),
    equipment_es: J(['Tratamiento acústico', 'Mesa de grabación para varias personas', 'Iluminación continua', 'Fondo neutro']),
    equipment_en: J(['Acoustic treatment', 'Recording table for several people', 'Continuous lighting', 'Neutral backdrop']),
    conditions_es: 'Sin tarifa publicada: tu franja queda reservada como solicitud y te confirmamos precio y condiciones antes de la sesión.',
    conditions_en: 'No published rate: your slot is held as a request and we confirm price and conditions before the session.',
  },
];

const PRODUCTS = [
  {
    slug: 'pase-dia', kind: 'day_pass', space_slug: 'coworking', unit: 'day', price_cents: 1500, max_quantity: 4, sort: 1,
    name_es: 'Pase de día', name_en: 'Day pass',
    summary_es: 'Un día de trabajo en la zona de coworking, sin compromiso.',
    summary_en: 'A working day in the coworking area, no commitment.',
    includes_es: J(['Un puesto libre durante el horario de coworking', 'Wifi, café y office', 'Reserva para hasta 4 personas']),
    includes_en: J(['A free desk during coworking hours', 'Wifi, coffee and kitchenette', 'Book for up to 4 people']),
    how_es: 'Elige el día en Reservar. El sistema comprueba los puestos libres y te da una referencia.',
    how_en: 'Pick the day in Book. The system checks free desks and gives you a reference.',
  },
  {
    slug: 'bono-10', kind: 'bundle', space_slug: 'coworking', unit: 'pack', price_cents: 12000, credits: 10, validity_days: 180, sort: 2,
    name_es: 'Bono de 10 días', name_en: '10-day pass',
    summary_es: 'Diez días de coworking para usar cuando los necesites.',
    summary_en: 'Ten coworking days to use whenever you need them.',
    includes_es: J(['10 días de acceso en horario de coworking', 'Saldo e historial en Mi cuenta', 'Validez de {validity} días desde la compra']),
    includes_en: J(['10 days of access during coworking hours', 'Balance and history in My account', 'Valid for {validity} days from purchase']),
    how_es: 'Compras el bono y reservas cada día desde Mi cuenta. Cada reserva descuenta un día; si cancelas a tiempo, el día vuelve a tu saldo.',
    how_en: 'Buy the pass and book each day from My account. Each booking uses one day; cancel in time and the day returns to your balance.',
  },
  {
    slug: 'mesa-flexible', kind: 'plan', plan_type: 'flex', space_slug: 'coworking', unit: 'month', price_cents: 16000, featured: 1, sort: 3,
    name_es: 'Mesa flexible', name_en: 'Flexible desk',
    summary_es: 'Trabaja en cualquier puesto libre todos los días laborables. Sin permanencia.',
    summary_en: 'Work at any free desk every working day. No minimum stay.',
    includes_es: J(['Cualquier puesto libre en horario de coworking', 'Sin permanencia', 'Reserva de tu día desde Mi cuenta', 'Agenda y comunidad FRAME']),
    includes_en: J(['Any free desk during coworking hours', 'No minimum stay', 'Book your day from My account', 'FRAME calendar and community']),
    how_es: 'Solicitas el alta, eliges la fecha de inicio y se renueva cada mes hasta que te des de baja.',
    how_en: 'Request your membership, choose a start date and it renews monthly until you cancel.',
  },
  {
    slug: 'mesa-fija', kind: 'plan', plan_type: 'fixed', space_slug: 'coworking', unit: 'month', price_cents: 19000, sort: 4,
    name_es: 'Mesa fija 24/7', name_en: 'Fixed desk 24/7',
    summary_es: 'Tu propio puesto, siempre preparado, con acceso 24/7.',
    summary_en: 'Your own desk, always ready, with 24/7 access.',
    includes_es: J(['Puesto asignado solo para ti', 'Acceso 24/7 (exclusivo de este plan)', 'Deja tu equipo en tu mesa', 'Agenda y comunidad FRAME']),
    includes_en: J(['A desk assigned only to you', '24/7 access (only in this plan)', 'Leave your equipment at your desk', 'FRAME calendar and community']),
    how_es: 'Solicitas el alta con fecha de inicio. Te asignamos un puesto del inventario y se renueva cada mes.',
    how_en: 'Request membership with a start date. We assign a desk from the inventory and it renews monthly.',
  },
  {
    slug: 'oficina-virtual', kind: 'plan', plan_type: 'virtual', space_slug: null, unit: 'month', price_cents: 2000, sort: 5,
    name_es: 'Oficina virtual', name_en: 'Virtual office',
    summary_es: 'Una dirección profesional en Torrevieja para tu actividad, sin puesto de trabajo.',
    summary_en: 'A professional address in Torrevieja for your business, without a desk.',
    includes_es: J(['Dirección profesional en Rambla Juan Mateo García, 21', 'Recepción de correspondencia en horario de recepción', 'No incluye puesto de trabajo']),
    includes_en: J(['Professional address at Rambla Juan Mateo García, 21', 'Mail handling during reception hours', 'Does not include a desk']),
    how_es: 'Servicio mensual independiente. Solicitas el alta y te confirmamos la documentación necesaria.',
    how_en: 'A separate monthly service. Request it and we will confirm the documents needed.',
  },
  {
    slug: 'sala-reuniones', kind: 'hourly', space_slug: 'salas', unit: 'hour', price_cents: 2000, sort: 6,
    name_es: 'Sala de reuniones', name_en: 'Meeting room',
    summary_es: 'Sala privada por horas para reuniones y presentaciones.',
    summary_en: 'A private room by the hour for meetings and presentations.',
    includes_es: J(['Pantalla y pizarra', 'Wifi', 'Disponibilidad en tiempo real']),
    includes_en: J(['Screen and whiteboard', 'Wifi', 'Real-time availability']),
    how_es: 'Elige sala, día, hora y duración. La disponibilidad se comprueba de nuevo al confirmar.',
    how_en: 'Choose room, day, time and duration. Availability is checked again when you confirm.',
  },
  {
    slug: 'cabina', kind: 'hourly', space_slug: 'coworking', unit: 'hour', price_cents: null, sort: 7,
    name_es: 'Cabina de videollamada', name_en: 'Video-call booth',
    summary_es: 'Una cabina individual para llamadas y videollamadas sin molestar.',
    summary_en: 'A private booth for calls and video calls without disturbing anyone.',
    includes_es: J(['Cabina individual', 'Wifi']), includes_en: J(['Single booth', 'Wifi']),
    how_es: 'Elige día y franja. Sin tarifa publicada: queda como solicitud y te confirmamos el precio.',
    how_en: 'Choose a day and slot. No published rate: it is held as a request and we confirm the price.',
  },
  {
    slug: 'estudio', kind: 'hourly', space_slug: 'estudio', unit: 'hour', price_cents: null, sort: 8,
    name_es: 'Estudio de pódcast y vídeo', name_en: 'Podcast & video studio',
    summary_es: 'Sesiones de grabación por horas.', summary_en: 'Recording sessions by the hour.',
    includes_es: J(['Estudio en exclusiva durante la sesión']), includes_en: J(['Exclusive use of the studio during the session']),
    how_es: 'Elige día y franja. Te enviamos presupuesto antes de confirmar.',
    how_en: 'Choose a day and slot. We send you a quote before confirming.',
  },
  {
    slug: 'despacho', kind: 'quote', space_slug: 'despachos', unit: 'quote', price_cents: null, sort: 9,
    name_es: 'Despacho privado', name_en: 'Private office',
    summary_es: 'Despachos cerrados para equipos pequeños. Precio bajo presupuesto.',
    summary_en: 'Closed offices for small teams. Price on request.',
    how_es: 'Cuéntanos tu equipo y la fecha de entrada y te enviamos un presupuesto.',
    how_en: 'Tell us about your team and start date and we will send you a quote.',
  },
  {
    slug: 'visita', kind: 'visit', unit: 'visit', price_cents: 0, sort: 10,
    name_es: 'Visita guiada', name_en: 'Guided tour',
    summary_es: 'Conoce FRAME en persona antes de decidir.', summary_en: 'See FRAME in person before you decide.',
    how_es: 'Elige día y hora en el calendario de visitas.', how_en: 'Choose a day and time in the tours calendar.',
  },
  {
    slug: 'dia-prueba', kind: 'trial', space_slug: 'coworking', unit: 'day', price_cents: 0, sort: 11,
    name_es: 'Día de prueba gratuito', name_en: 'Free trial day',
    summary_es: 'Tu primer día en FRAME, gratis y sujeto a disponibilidad.', summary_en: 'Your first day at FRAME, free and subject to availability.',
    how_es: 'Solicítalo para un día laborable. Te confirmamos por correo.', how_en: 'Request it for a weekday. We confirm by email.',
  },
];

const RESOURCES = [
  { slug: 'puestos', kind: 'desk_pool', space_slug: 'coworking', product_slug: 'pase-dia', name_es: 'Puestos de coworking', name_en: 'Coworking desks', capacity: 35, max_fixed: 10, booking_mode: 'instant', slot_minutes: 1440, min_minutes: 1440, max_minutes: 1440, hours: wk([['08:00', '20:00']]), area_m2: 165, sort: 1 },
  { slug: 'sala-salinas', kind: 'room', space_slug: 'salas', product_slug: 'sala-reuniones', name_es: 'Sala Salinas', name_en: 'Salinas Room', capacity: 8, booking_mode: 'instant', slot_minutes: 30, min_minutes: 60, max_minutes: 480, buffer_minutes: 0, hours: wk([['08:00', '20:00']]), area_m2: 25, sort: 2,
    equipment_es: J(['Mesa para 8 personas', 'Pantalla de 65"', 'Pizarra']), equipment_en: J(['Table for 8', '65" screen', 'Whiteboard']) },
  { slug: 'sala-rambla', kind: 'room', space_slug: 'salas', product_slug: 'sala-reuniones', name_es: 'Sala Rambla', name_en: 'Rambla Room', capacity: 4, booking_mode: 'instant', slot_minutes: 30, min_minutes: 60, max_minutes: 480, buffer_minutes: 0, hours: wk([['08:00', '20:00']]), area_m2: 16, sort: 3,
    equipment_es: J(['Mesa para 4 personas', 'Pantalla de 50"']), equipment_en: J(['Table for 4', '50" screen']) },
  { slug: 'cabina-1', kind: 'booth', space_slug: 'coworking', group_slug: 'cabinas', product_slug: 'cabina', name_es: 'Cabina 1', name_en: 'Booth 1', capacity: 1, booking_mode: 'request', slot_minutes: 30, min_minutes: 30, max_minutes: 240, hours: wk([['08:00', '20:00']]), area_m2: 2.5, sort: 4 },
  { slug: 'cabina-2', kind: 'booth', space_slug: 'coworking', group_slug: 'cabinas', product_slug: 'cabina', name_es: 'Cabina 2', name_en: 'Booth 2', capacity: 1, booking_mode: 'request', slot_minutes: 30, min_minutes: 30, max_minutes: 240, hours: wk([['08:00', '20:00']]), area_m2: 2.5, sort: 5 },
  { slug: 'cabina-3', kind: 'booth', space_slug: 'coworking', group_slug: 'cabinas', product_slug: 'cabina', name_es: 'Cabina 3', name_en: 'Booth 3', capacity: 1, booking_mode: 'request', slot_minutes: 30, min_minutes: 30, max_minutes: 240, hours: wk([['08:00', '20:00']]), area_m2: 2.5, sort: 6 },
  { slug: 'estudio', kind: 'studio', space_slug: 'estudio', product_slug: 'estudio', name_es: 'Estudio de pódcast y vídeo', name_en: 'Podcast & video studio', capacity: 4, booking_mode: 'request', slot_minutes: 60, min_minutes: 60, max_minutes: 480, buffer_minutes: 30, hours: wk([['09:00', '20:00']]), area_m2: 35, sort: 7 },
  { slug: 'despacho-1', kind: 'office', space_slug: 'despachos', product_slug: 'despacho', name_es: 'Despacho 1', name_en: 'Office 1', capacity: 2, booking_mode: 'quote', slot_minutes: 1440, min_minutes: 1440, max_minutes: 1440, hours: wk(ALL_DAY, ALL_DAY, ALL_DAY), area_m2: 12, sort: 8 },
  { slug: 'despacho-2', kind: 'office', space_slug: 'despachos', product_slug: 'despacho', name_es: 'Despacho 2', name_en: 'Office 2', capacity: 4, booking_mode: 'quote', slot_minutes: 1440, min_minutes: 1440, max_minutes: 1440, hours: wk(ALL_DAY, ALL_DAY, ALL_DAY), area_m2: 15, sort: 9 },
  { slug: 'despacho-3', kind: 'office', space_slug: 'despachos', product_slug: 'despacho', name_es: 'Despacho 3', name_en: 'Office 3', capacity: 6, booking_mode: 'quote', slot_minutes: 1440, min_minutes: 1440, max_minutes: 1440, hours: wk(ALL_DAY, ALL_DAY, ALL_DAY), area_m2: 18, sort: 10 },
  { slug: 'visitas', kind: 'tour', space_slug: null, product_slug: 'visita', name_es: 'Visitas guiadas', name_en: 'Guided tours', capacity: 4, booking_mode: 'instant', slot_minutes: 30, min_minutes: 30, max_minutes: 30, hours: wk([['10:00', '13:30'], ['16:30', '18:30']]), sort: 11 },
];

const FAQS = [
  ['¿Tengo que ser miembro para venir un día?', 'No. Puedes reservar un pase de día o solicitar tu primer día de prueba gratuito. La membresía solo tiene sentido si vienes a menudo.',
    'Do I need to be a member to come for a day?', 'No. You can book a day pass or request your free trial day. Membership only makes sense if you come often.'],
  ['¿Qué diferencia hay entre la mesa flexible y la mesa fija?', 'Con la mesa flexible usas cualquier puesto libre en horario de coworking, sin permanencia. Con la mesa fija tienes un puesto asignado solo para ti y acceso 24/7. Ambos planes comparten los mismos puestos físicos, así que nunca vendemos más sitios de los que hay.',
    'What is the difference between a flexible and a fixed desk?', 'With a flexible desk you use any free desk during coworking hours, with no minimum stay. With a fixed desk you get a desk assigned only to you and 24/7 access. Both plans share the same physical desks, so we never sell more places than there are.'],
  ['¿Los precios incluyen IVA?', 'Las tarifas publicadas son importes base sin impuestos. Antes de confirmar cualquier compra verás el precio final con impuestos y cualquier suplemento. Si un servicio aún no tiene precio final, guardamos tu solicitud sin cobrar nada.',
    'Do prices include VAT?', 'Published rates are base amounts before tax. Before you confirm any purchase you will see the final price including tax and any extras. If a service has no final price yet, we save your request without charging anything.'],
  ['¿Cuál es el horario?', 'Distinguimos el horario de recepción, cuando hay alguien del equipo para atenderte, del horario de acceso. El pase de día, el bono y la mesa flexible dan acceso en horario de coworking. Solo la mesa fija incluye acceso 24/7.',
    'What are the opening hours?', 'We distinguish reception hours, when someone from the team is there to help, from access hours. Day passes, the ten-day pass and the flexible desk give access during coworking hours. Only the fixed desk includes 24/7 access.'],
  ['¿Puedo probar FRAME antes de decidir?', 'Sí. Puedes reservar una visita guiada o solicitar un primer día de prueba gratuito, sujeto a disponibilidad y a sus condiciones.',
    'Can I try FRAME before deciding?', 'Yes. You can book a guided tour or request a free first trial day, subject to availability and its conditions.'],
  ['¿Puedo usar el estudio si no trabajo en FRAME?', 'Sí. El estudio de pódcast y vídeo está abierto a cualquier creador o empresa. Eliges la franja, la reservamos como solicitud y te enviamos el presupuesto.',
    'Can I use the studio if I don’t work at FRAME?', 'Yes. The podcast and video studio is open to any creator or business. Choose a slot, we hold it as a request and send you a quote.'],
  ['¿Cómo cambio o cancelo una reserva?', 'Desde el enlace que recibes en el correo de confirmación o desde Mi cuenta. Los cambios y cancelaciones gratuitos se permiten hasta 24 horas antes, salvo que se indique otra condición al reservar.',
    'How do I change or cancel a booking?', 'From the link in your confirmation email or from My account. Free changes and cancellations are allowed up to 24 hours before, unless other conditions were shown when booking.'],
  ['¿Dónde está FRAME?', 'En Rambla Juan Mateo García, 21, 03183 Torrevieja (Alicante). Es nuestra única ubicación.',
    'Where is FRAME?', 'At Rambla Juan Mateo García, 21, 03183 Torrevieja (Alicante, Spain). It is our only location.'],
];

const MEDIA = [
  ['home.hero', '/img/renders/hero.webp', 'Render conceptual de la zona de coworking de FRAME con luz natural', 'Concept render of FRAME’s coworking area in natural light'],
  ['space.coworking', '/img/renders/coworking.webp', 'Render conceptual de la zona abierta de coworking', 'Concept render of the open coworking area'],
  ['space.salas', '/img/renders/salas.webp', 'Render conceptual de una sala de reuniones', 'Concept render of a meeting room'],
  ['space.despachos', '/img/renders/despachos.webp', 'Render conceptual de un despacho privado', 'Concept render of a private office'],
  ['space.estudio', '/img/renders/estudio.webp', 'Render conceptual del estudio de pódcast y vídeo', 'Concept render of the podcast and video studio'],
  ['home.plan', '/img/renders/plano.webp', 'Maqueta axonométrica de la distribución de demostración de FRAME', 'Axonometric model of FRAME’s demo layout'],
  ['community', '/img/renders/comunidad.webp', 'Render conceptual de la zona común y office', 'Concept render of the common area and kitchenette'],
];

export function seed(db, { adminEmail, adminPassword, isProd } = {}) {
  const now = Date.now();
  const done = db.get("SELECT value FROM settings WHERE key = '_seed'");
  if (done) return { seeded: false };
  const result = { seeded: true, credentials: [] };
  db.tx(() => {
    for (const s of SPACES) {
      db.run(`INSERT INTO spaces (slug, sort, name_es, name_en, tagline_es, tagline_en, description_es, description_en,
        includes_es, includes_en, equipment_es, equipment_en, conditions_es, conditions_en, area_m2, capacity_text_es, capacity_text_en)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.slug, s.sort, s.name_es, s.name_en, s.tagline_es, s.tagline_en, s.description_es, s.description_en,
        s.includes_es, s.includes_en, s.equipment_es, s.equipment_en, s.conditions_es, s.conditions_en, s.area_m2,
        s.capacity_text_es ?? null, s.capacity_text_en ?? null]);
    }
    for (const p of PRODUCTS) {
      db.run(`INSERT INTO products (slug, kind, plan_type, space_slug, name_es, name_en, summary_es, summary_en, includes_es, includes_en,
        how_es, how_en, price_cents, unit, credits, validity_days, max_quantity, featured, sort, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.slug, p.kind, p.plan_type ?? null, p.space_slug ?? null, p.name_es, p.name_en, p.summary_es, p.summary_en,
        p.includes_es ?? null, p.includes_en ?? null, p.how_es ?? null, p.how_en ?? null, p.price_cents, p.unit,
        p.credits ?? null, p.validity_days ?? null, p.max_quantity ?? 1, p.featured ?? 0, p.sort, now]);
    }
    for (const r of RESOURCES) {
      db.run(`INSERT INTO resources (slug, kind, space_slug, group_slug, product_slug, name_es, name_en, capacity, booking_mode,
        slot_minutes, min_minutes, max_minutes, buffer_minutes, hours, equipment_es, equipment_en, area_m2, max_fixed, sort)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.slug, r.kind, r.space_slug ?? null, r.group_slug ?? null, r.product_slug, r.name_es, r.name_en, r.capacity, r.booking_mode,
        r.slot_minutes, r.min_minutes, r.max_minutes, r.buffer_minutes ?? 0, J(r.hours), r.equipment_es ?? null, r.equipment_en ?? null,
        r.area_m2 ?? null, r.max_fixed ?? null, r.sort]);
    }
    FAQS.forEach(([qe, ae, qn, an], i) => db.run('INSERT INTO faqs (q_es, a_es, q_en, a_en, sort) VALUES (?,?,?,?,?)', [qe, ae, qn, an, i + 1]));
    MEDIA.forEach(([slot, p, ae, an], i) => db.run('INSERT INTO media (slot, path, alt_es, alt_en, is_concept, sort, builtin, created_at) VALUES (?,?,?,?,1,?,1,?)', [slot, p, ae, an, i, now]));

    // Festivos nacionales próximos (revisar con el calendario laboral local de Torrevieja).
    for (const [d, note] of [['2026-12-08', 'Inmaculada Concepción'], ['2026-12-25', 'Navidad'], ['2027-01-01', 'Año Nuevo'], ['2027-01-06', 'Epifanía del Señor']]) {
      const [start, end] = dayBoundsUtc(d);
      db.run(`INSERT INTO blocks (resource_id, start_utc, end_utc, reason, note, created_at)
        VALUES (NULL, ?, ?, 'holiday', ?, ?)`, [start, end, `Festivo nacional: ${note}`, now]);
    }

    // Usuarios del panel.
    const users = [];
    if (adminEmail && adminPassword) users.push([adminEmail, 'Administración', adminPassword, 'admin']);
    else if (!isProd) {
      users.push(['admin@frame.test', 'Administración (demo)', 'frame-admin-demo', 'admin']);
      users.push(['recepcion@frame.test', 'Recepción (demo)', 'frame-staff-demo', 'staff']);
    } else {
      const pwd = crypto.randomBytes(12).toString('base64url');
      users.push(['admin@frame.local', 'Administración', pwd, 'admin']);
    }
    for (const [email, name, pwd, role] of users) {
      db.run('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)', [email.toLowerCase(), name, hashPassword(pwd), role, now]);
      result.credentials.push({ email, password: pwd, role });
    }
    db.run("INSERT INTO settings (key, value, updated_at) VALUES ('_seed', ?, ?)", [String(SEED_VERSION), now]);
  });
  return result;
}
