// Distribución del local (400 m²: 25 m × 16 m) según el reparto de superficies de FRAME:
//   coworking 180 m² (zona abierta 155 + recepción y lounge 25) · despachos 60 (3 × 20) ·
//   aseos y pasillos 50 · salas 40 (2 × 20) · cocina y café 30 · estudio 25 · cabinas 15 (3 × 5).
// Es una maqueta conceptual: no hay planos reales del local. Coordenadas en metros:
// x de oeste a este, z de norte a sur (fachada a la calle en z = 16).
// El número de puestos, salas, cabinas y despachos se toma del inventario configurado.
export const LAYOUT = {
  width: 25,
  depth: 16,
  height: 3.2,
  facade: 'south',
  demo: true,
  // Fondo de la crujía norte (salas, cocina, estudio, despachos y aseos) y del pasillo.
  northDepth: 6,
  corridor: 1.4,
  zones: [
    { id: 'coworking', service: 'pass', x: 7, z: 7.4, w: 18, d: 8.6, label: { es: 'Coworking', en: 'Coworking' }, kind: 'open' },
    { id: 'recepcion', service: 'visit', x: 0, z: 12.4, w: 7, d: 3.6, label: { es: 'Recepción y lounge', en: 'Reception & lounge' }, kind: 'open' },
    { id: 'sala-salinas', service: 'room', resource: 'sala-salinas', x: 0, z: 7.4, w: 4, d: 5, label: { es: 'Sala Salinas', en: 'Salinas Room' }, kind: 'room' },
    { id: 'cabinas', service: 'booth', x: 4, z: 7.4, w: 3, d: 5, label: { es: 'Cabinas', en: 'Booths' }, kind: 'booths' },
    { id: 'sala-rambla', service: 'room', resource: 'sala-rambla', x: 0, z: 0, w: 3.4, d: 6, label: { es: 'Sala Rambla', en: 'Rambla Room' }, kind: 'room' },
    { id: 'office', service: null, x: 3.4, z: 0, w: 5, d: 6, label: { es: 'Cocina y café', en: 'Kitchen & coffee' }, kind: 'kitchen' },
    { id: 'estudio', service: 'studio', resource: 'estudio', x: 8.4, z: 0, w: 4.2, d: 6, label: { es: 'Estudio', en: 'Studio' }, kind: 'studio' },
    { id: 'despachos', service: 'office', x: 12.6, z: 0, w: 10, d: 6, label: { es: 'Despachos', en: 'Offices' }, kind: 'offices' },
    { id: 'aseos', service: null, x: 22.6, z: 0, w: 2.4, d: 6, label: { es: 'Aseos', en: 'Toilets' }, kind: 'service' },
    { id: 'pasillo', service: null, x: 0, z: 6, w: 25, d: 1.4, label: { es: 'Pasillo', en: 'Corridor' }, kind: 'circulation' },
  ],
  entrance: { x: 3.0, z: 16, w: 1.8 },
};

export function layoutFor(ctx) {
  const pool = ctx.catalog.deskPool();
  return {
    ...LAYOUT,
    desks: pool?.active ? pool.capacity : 0,
    booths: ctx.catalog.resourcesByGroup('cabinas').length,
    offices: ctx.catalog.resources().filter((r) => r.kind === 'office').length,
  };
}
