// Maqueta 3D de FRAME construida a partir de la distribución configurable.
// Modos de uso:
//   'interior' → escenas detalladas para renders conceptuales y vista 360°
//   'glass'    → maqueta de cristal interactiva de la página de reservas
//   'clay'     → maqueta blanca axonométrica (plano 3D)
// Coordenadas: x este, z sur, y arriba. El centro del local es el origen.
// Toda la geometría es procedural y propia; las imágenes de la marca se leen de /brand.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SYMBOL_RECTS, SYMBOL_SIZE, LOGO_ASPECT } from './brand-symbol.mjs';

export function createFrameScene(_three, L, opts = {}) {
  const style = opts.style || 'interior';
  const rich = style === 'interior';
  const simple = style === 'glass';
  const lite = opts.quality === 'low';
  const cut = opts.cut ?? (rich ? null : 1.15);
  const H = L.height || 3.2;
  const W = L.width;
  const D = L.depth;
  const wallH = cut ?? H;
  const P = (x, z) => [x - W / 2, z - D / 2];
  const pending = [];
  const T = textureKit(pending, rich && !lite);
  const M = makeMaterials(style, T, opts);
  const root = new THREE.Group();
  root.name = 'frame';
  const zones = [];
  const lights = [];

  // ----------------------------------------------------------------- utilidades
  function add(mesh, parent = root, { cast = true, receive = true } = {}) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  }
  function box(w, h, d, mat, x, y, z, parent, o) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m, parent, o);
  }
  function rbox(w, h, d, r, mat, x, y, z, parent, o) {
    if (lite || simple) return box(w, h, d, mat, x, y, z, parent, o);
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
    m.position.set(x, y, z);
    return add(m, parent, o);
  }
  function cyl(rt, rb, h, mat, x, y, z, parent, seg = 20, o) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    return add(m, parent, o);
  }
  function sph(r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1, o) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return add(m, parent, o);
  }
  // Barra cilíndrica entre dos puntos.
  const _up = new THREE.Vector3(0, 1, 0);
  function rod(a, b, r, mat, parent, o) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(_up, vb.clone().sub(va).normalize());
    return add(m, parent, o);
  }
  function plane(w, h, mat, x, y, z, ry = 0, parent = root, o = { cast: false, receive: false }) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    return add(m, parent, o);
  }
  // Símbolo de FRAME en volumen (letras corpóreas o neón), a partir de la geometría oficial.
  function brandSymbol(size, mat, x, y, z, ry, parent = root, depth = 0.02) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
    const k = size / SYMBOL_SIZE;
    for (const [a, b, c, d] of SYMBOL_RECTS) {
      box((c - a) * k, (d - b) * k, depth, mat, ((a + c) / 2) * k - size / 2, size / 2 - ((b + d) / 2) * k, depth / 2, g, { cast: true, receive: false });
    }
    return g;
  }
  // Logotipo horizontal: lámina impresa + símbolo en relieve encima, para que proyecte sombra.
  function brandLockup(width, variant, x, y, z, ry, parent = root, { relief = true } = {}) {
    const h = width / LOGO_ASPECT.horizontal;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
    plane(width, h, T.logoMaterial(variant), 0, 0, 0.002, 0, g);
    if (relief) brandSymbol(h, variant === 'light' ? M.brandLight : M.brandDark, -width / 2 + h / 2, 0, 0.003, 0, g, 0.018);
    return g;
  }
  // Grupo posicionado en coordenadas del plano, rotado sobre Y.
  function at(lx, lz, rot = 0, parent = root) {
    const g = new THREE.Group();
    const [x, z] = P(lx, lz);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    parent.add(g);
    return g;
  }
  const RIGHT = Math.PI / 2;  // el frente (+z local) mira hacia +x
  const LEFT = -Math.PI / 2;  // el frente mira hacia -x
  
  // ---------------------------------------------------------------------- suelo
  const floorKinds = { open: 'floor', room: 'floorWood', booths: 'floor', kitchen: 'floorTile', studio: 'floorStudio', offices: 'floorWood', service: 'floorTile', circulation: 'floor' };
  for (const z of L.zones) {
    const [cx, cz] = P(z.x + z.w / 2, z.z + z.d / 2);
    const base = M[floorKinds[z.kind] || 'floor'];
    const mat = rich ? T.tiledMaterial(base, z.w, z.d) : base;
    const g = new THREE.Mesh(new THREE.BoxGeometry(z.w, 0.06, z.d), mat);
    g.position.set(cx, -0.03, cz);
    g.receiveShadow = true;
    g.name = `floor:${z.id}`;
    root.add(g);
    const group = new THREE.Group();
    group.name = `zone:${z.id}`;
    root.add(group);
    zones.push({ id: z.id, service: z.service, resource: z.resource || null, label: z.label, kind: z.kind, center: new THREE.Vector3(cx, 0, cz), floor: g, rect: z, group });
  }
  const zone = (id) => zones.find((z) => z.id === id);

  // ---------------------------------------------------------------------- techo
  if (rich) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.2, D + 0.6), M.ceiling);
    c.position.set(0, H + 0.1, 0);
    c.castShadow = true;
    c.receiveShadow = true;
    root.add(c);
  }

  // ---------------------------------------------------------------------- muros
  function wall(x1, z1, x2, z2, { h = wallH, t = 0.12, mat = M.wall, openings = [], parent = root, frosted = false } = {}) {
    const alongX = Math.abs(z2 - z1) < 1e-6;
    const len = alongX ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    const start = alongX ? Math.min(x1, x2) : Math.min(z1, z2);
    const fixed = alongX ? z1 : x1;
    const ops = openings.map((o) => ({ ...o, bottom: o.bottom ?? 0, top: Math.min(o.top ?? 2.2, h) })).sort((a, b) => a.from - b.from);
    const seg = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const c = start + (a + b) / 2;
      const [px, pz] = alongX ? P(c, fixed) : P(fixed, c);
      box(alongX ? b - a : t, y1 - y0, alongX ? t : b - a, mat, px, (y0 + y1) / 2, pz, parent);
    };
    let cursor = 0;
    for (const o of ops) {
      seg(cursor, o.from, 0, h);
      seg(o.from, o.to, 0, o.bottom);
      seg(o.from, o.to, o.top, h);
      if (o.glass) glassPane(alongX, start, fixed, o.from, o.to, o.bottom, o.top, o.mullion ?? 1.5, parent, o.frosted ?? frosted);
      if (o.door && rich) door(alongX, start, fixed, o.from, o.to, o.top, parent, o.door);
      cursor = o.to;
    }
    seg(cursor, len, 0, h);
  }
  function glassPane(alongX, start, fixed, a, b, y0, y1, mullion, parent, frosted) {
    if (y1 - y0 < 0.05) return;
    const c = start + (a + b) / 2;
    const [px, pz] = alongX ? P(c, fixed) : P(fixed, c);
    const g = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b - a : 0.02, y1 - y0, alongX ? 0.02 : b - a), M.glass);
    g.position.set(px, (y0 + y1) / 2, pz);
    g.userData.glass = true;
    parent.add(g);
    if (simple) return;
    const fw = 0.045;
    const frame = (fa, fb, fy0, fy1) => {
      const cc = start + (fa + fb) / 2;
      const [qx, qz] = alongX ? P(cc, fixed) : P(fixed, cc);
      box(alongX ? Math.max(fb - fa, fw) : fw, fy1 - fy0, alongX ? fw : Math.max(fb - fa, fw), M.black, qx, (fy0 + fy1) / 2, qz, parent, { cast: true, receive: false });
    };
    frame(a, a + fw, y0, y1); frame(b - fw, b, y0, y1);
    frame(a, b, y0, y0 + fw); frame(a, b, y1 - fw, y1);
    const n = Math.max(1, Math.round((b - a) / mullion));
    for (let i = 1; i < n; i++) { const m = a + ((b - a) * i) / n; frame(m - fw / 2, m + fw / 2, y0, y1); }
    // Vinilo esmerilado con la marca a la altura de la vista.
    if (frosted && rich && y1 - y0 > 1.4) {
      const fy = Math.min(y0 + 1.45, y1 - 0.2);
      const band = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b - a - 0.1 : 0.022, 0.12, alongX ? 0.022 : b - a - 0.1), M.frost);
      band.position.set(px, fy, pz);
      parent.add(band);
    }
  }
  function door(alongX, start, fixed, a, b, top, parent, kind) {
    if (kind === 'open') return;
    const c = start + (a + b) / 2;
    const [px, pz] = alongX ? P(c, fixed) : P(fixed, c);
    const w = b - a - 0.04;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.045, top - 0.02, alongX ? 0.045 : w), kind === 'glass' ? M.glass : M.doorWood);
    leaf.position.set(px, (top - 0.02) / 2, pz);
    add(leaf, parent);
    const hx = alongX ? px + w / 2 - 0.1 : px;
    const hz = alongX ? pz : pz + w / 2 - 0.1;
    box(0.025, 0.3, 0.025, M.black, hx + (alongX ? 0 : 0.05), 1.05, hz + (alongX ? 0.05 : 0), parent);
  }

  const ext = { t: 0.3, mat: M.wallExt };
  wall(0, 0, W, 0, ext);
  wall(0, 0, 0, D, ext);
  wall(W, 0, W, D, ext);
  const e = L.entrance;
  const facadeOps = [];
  const winBottom = 0.35;
  const winTop = Math.min(2.95, wallH);
  if (wallH > winBottom + 0.1) {
    facadeOps.push({ from: 0.6, to: e.x - 0.3, bottom: winBottom, top: winTop, glass: true, mullion: 1.4 });
    facadeOps.push({ from: e.x, to: e.x + e.w, bottom: 0, top: Math.min(2.6, wallH), glass: true, mullion: 0.9 });
    facadeOps.push({ from: e.x + e.w + 0.3, to: 6.7, bottom: winBottom, top: winTop, glass: true, mullion: 1.4 });
    for (let x = 7.3; x < W - 0.6; x += 3.1) facadeOps.push({ from: x, to: Math.min(x + 2.7, W - 0.6), bottom: winBottom, top: winTop, glass: true, mullion: 1.35 });
  }
  wall(0, D, W, D, { ...ext, openings: facadeOps });

  const doorTop = Math.min(2.2, wallH);
  const Z = (id) => L.zones.find((z) => z.id === id);
  const rowA = L.northDepth ?? 6;           // muro norte del pasillo
  const rowB = rowA + (L.corridor ?? 1.4);   // muro sur del pasillo
  const zRam = Z('sala-rambla'); const zOff = Z('office'); const zSt = Z('estudio'); const zDes = Z('despachos'); const zWc = Z('aseos');
  const zSal = Z('sala-salinas'); const zCab = Z('cabinas');
  const officeN = Math.max(1, L.offices || 3);
  const offW = zDes.w / officeN;
  const officeFronts = [];
  for (let i = 0; i < officeN; i++) officeFronts.push({ from: zDes.x + i * offW + 0.15, to: zDes.x + (i + 1) * offW - 0.15, bottom: 0, top: Math.min(2.6, wallH), glass: true, mullion: offW / 2, frosted: true });
  const studioDoor = { from: zSt.x + 1.6, to: zSt.x + 2.6 };
  const wcSplitX = zWc.x + 1.5;              // aseo adaptado (1,5 m libres) + paso al segundo aseo
  const wcSplitZ = 3.0;
  wall(0, rowA, W, rowA, {
    openings: [
      { from: zRam.x + 0.3, to: zRam.x + zRam.w - 1.3, bottom: 0.9, top: Math.min(2.3, wallH), glass: true, frosted: true },
      { from: zRam.x + zRam.w - 1.1, to: zRam.x + zRam.w - 0.2, top: doorTop, door: 'glass' },
      { from: zOff.x + 1.5, to: zOff.x + 3.3, top: doorTop, door: 'open' },
      { ...studioDoor, top: doorTop, door: 'wood' },
      ...officeFronts,
      { from: zWc.x + 0.3, to: zWc.x + 1.2, top: doorTop, door: 'wood' },
      { from: wcSplitX + 0.05, to: zWc.x + zWc.w - 0.05, top: doorTop, door: 'wood' },
    ],
  });
  for (const x of [zOff.x, zSt.x, zDes.x, zWc.x]) wall(x, 0, x, rowA, { t: 0.14 });
  for (let i = 1; i < officeN; i++) wall(zDes.x + i * offW, 0, zDes.x + i * offW, rowA, { t: 0.1 });
  // Aseos: adaptado junto al pasillo y segundo aseo al fondo, con paso propio.
  wall(zWc.x, wcSplitZ, wcSplitX, wcSplitZ, { t: 0.1 });
  wall(wcSplitX, wcSplitZ, wcSplitX, rowA, { t: 0.1 });
  wall(wcSplitX, wcSplitZ, W, wcSplitZ, { t: 0.1, openings: [{ from: 0.05, to: W - wcSplitX - 0.05, top: doorTop, door: 'wood' }] });
  // Sala Salinas: frente esmerilado al pasillo, muro ciego a la recepción.
  wall(zSal.x, rowB, zSal.x + zSal.w, rowB, { openings: [{ from: 0.3, to: zSal.w - 1.25, bottom: 0, top: Math.min(2.6, wallH), glass: true, mullion: 1.1, frosted: true }, { from: zSal.w - 1.1, to: zSal.w - 0.2, top: doorTop, door: 'glass' }] });
  wall(zCab.x, rowB, zCab.x, rowB + zSal.d);
  wall(zSal.x, rowB + zSal.d, zSal.x + zSal.w, rowB + zSal.d);
  // Cabinas: tres cubículos tapizados con frente de vidrio hacia el coworking.
  const boothN = Math.max(1, L.booths || 3);
  const bd = zCab.d / boothN;
  const cabX1 = zCab.x + zCab.w;
  const boothH = Math.min(2.4, wallH);
  for (let i = 0; i < boothN; i++) {
    const z0 = zCab.z + i * bd;
    if (i > 0) wall(zCab.x, z0, cabX1, z0, { t: 0.08, h: boothH, mat: M.wallFelt });
    wall(cabX1, z0, cabX1, z0 + bd, { t: 0.06, h: boothH, mat: M.wallFelt, openings: [{ from: 0.12, to: bd - 0.12, bottom: 0, top: Math.min(2.25, wallH), glass: true, mullion: bd / 2 }] });
  }
  wall(zCab.x, zCab.z + zCab.d, cabX1, zCab.z + zCab.d, { t: 0.08, h: boothH, mat: M.wallFelt });
  wall(zCab.x, zCab.z, cabX1, zCab.z, { t: 0.08, h: boothH, mat: M.wallFelt });
  if (rich) { // techo de las cabinas
    const [bx, bz] = P(zCab.x + zCab.w / 2, zCab.z + zCab.d / 2);
    box(zCab.w + 0.05, 0.06, zCab.d + 0.05, M.wallFelt, bx, boothH + 0.03, bz);
  }

  // --------------------------------------------------------------- mobiliario
  const furn = new THREE.Group();
  furn.name = 'furniture';
  root.add(furn);

  function taskChair(g, mat = M.fabric) {
    rbox(0.5, 0.08, 0.48, 0.035, mat, 0, 0.47, 0.02, g);
    const back = rbox(0.46, 0.52, 0.06, 0.03, mat, 0, 0.82, -0.22, g);
    back.rotation.x = -0.12;
    if (simple) { cyl(0.03, 0.12, 0.44, M.black, 0, 0.22, 0, g, 8); return g; }
    box(0.05, 0.22, 0.03, M.black, 0, 0.58, -0.21, g, { cast: false });
    cyl(0.022, 0.022, 0.3, M.chrome, 0, 0.29, 0, g, 10);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = box(0.28, 0.025, 0.035, M.black, Math.cos(a) * 0.13, 0.08, -Math.sin(a) * 0.13, g, { cast: false });
      leg.rotation.y = a;
      sph(0.025, M.black, Math.cos(a) * 0.27, 0.026, -Math.sin(a) * 0.27, g, 1, 1, 1, { cast: false });
    }
    for (const sx of [-1, 1]) { rbox(0.04, 0.03, 0.26, 0.01, M.black, sx * 0.27, 0.66, 0.02, g, { cast: false }); box(0.02, 0.18, 0.02, M.black, sx * 0.27, 0.57, 0.02, g, { cast: false }); }
    return g;
  }
  function shellChair(g, mat = M.shellWhite, legs = M.wood) {
    // Silla de carcasa (asiento y respaldo curvo) con patas de madera.
    rbox(0.46, 0.035, 0.42, 0.016, mat, 0, 0.45, 0.02, g);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.215, 0.3, 28, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat);
    back.position.set(0, 0.64, 0.02);
    back.rotation.x = -0.08;
    add(back, g);
    if (simple) { cyl(0.03, 0.03, 0.44, M.black, 0, 0.22, 0, g, 8); return g; }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod([sx * 0.16, 0.44, sz * 0.15], [sx * 0.21, 0.0, sz * 0.2], 0.013, legs, g);
    rod([-0.18, 0.2, -0.17], [0.18, 0.2, 0.17], 0.004, M.black, g, { cast: false });
    rod([0.18, 0.2, -0.17], [-0.18, 0.2, 0.17], 0.004, M.black, g, { cast: false });
    return g;
  }
  function stool(g, top = M.wood) {
    cyl(0.18, 0.18, 0.045, top, 0, 0.72, 0, g, 24);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      rod([Math.cos(a) * 0.1, 0.7, Math.sin(a) * 0.1], [Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17], 0.013, M.black, g);
    }
    if (!simple) cyl(0.15, 0.15, 0.012, M.black, 0, 0.28, 0, g, 20, { cast: false }).scale.set(1, 1, 1);
    return g;
  }
  function loungeChair(g, mat = M.fabricWarm, legs = M.woodDark) {
    rbox(0.78, 0.18, 0.72, 0.08, mat, 0, 0.36, 0.02, g);
    rbox(0.78, 0.5, 0.16, 0.07, mat, 0, 0.68, -0.3, g).rotation.x = -0.15;
    rbox(0.13, 0.26, 0.7, 0.05, mat, -0.38, 0.52, 0, g);
    rbox(0.13, 0.26, 0.7, 0.05, mat, 0.38, 0.52, 0, g);
    if (!simple) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod([sx * 0.32, 0.28, sz * 0.27], [sx * 0.34, 0, sz * 0.3], 0.016, legs, g);
    return g;
  }
  function sofa(g, len = 2.2, mat = M.linen) {
    rbox(len, 0.24, 0.92, 0.06, mat, 0, 0.26, 0, g);
    const seats = Math.max(2, Math.round(len / 0.75));
    const sw = (len - 0.32) / seats;
    for (let i = 0; i < seats; i++) {
      rbox(sw - 0.02, 0.14, 0.68, 0.06, mat, -len / 2 + 0.16 + sw * (i + 0.5), 0.44, 0.06, g);
      rbox(sw - 0.02, 0.42, 0.18, 0.08, mat, -len / 2 + 0.16 + sw * (i + 0.5), 0.68, -0.32, g).rotation.x = -0.12;
    }
    rbox(0.16, 0.42, 0.92, 0.06, mat, -len / 2 + 0.08, 0.45, 0, g);
    rbox(0.16, 0.42, 0.92, 0.06, mat, len / 2 - 0.08, 0.45, 0, g);
    if (!simple) {
      rbox(0.42, 0.36, 0.14, 0.07, M.fabricWarm, -len / 2 + 0.45, 0.66, -0.16, g).rotation.set(-0.3, 0.2, 0.1);
      rbox(0.4, 0.34, 0.14, 0.07, M.fabricOat, len / 2 - 0.45, 0.66, -0.16, g).rotation.set(-0.3, -0.25, -0.08);
      for (const sx of [-1, 1]) box(0.05, 0.12, 0.05, M.black, sx * (len / 2 - 0.12), 0.06, 0.32, g);
    }
    return g;
  }
  function table(g, w, d, { h = 0.74, top = M.wood, legs = M.black, sled = false, round = false } = {}) {
    if (round) {
      cyl(w / 2, w / 2, 0.04, top, 0, h, 0, g, 48);
      if (simple) return g;
      cyl(0.05, 0.05, h - 0.06, legs, 0, (h - 0.04) / 2, 0, g, 12);
      cyl(0.28, 0.32, 0.03, legs, 0, 0.015, 0, g, 32);
      return g;
    }
    rbox(w, 0.035, d, 0.012, top, 0, h, 0, g);
    if (simple) { box(w * 0.9, h - 0.05, 0.04, legs, 0, (h - 0.03) / 2, 0, g); return g; }
    if (sled) {
      const n = Math.max(2, Math.round(w / 2.8) + 1);
      for (let i = 0; i < n; i++) {
        const lx = -w / 2 + 0.08 + ((w - 0.16) * i) / (n - 1);
        box(0.04, h - 0.02, 0.04, legs, lx, h / 2 - 0.01, -d / 2 + 0.12, g);
        box(0.04, h - 0.02, 0.04, legs, lx, h / 2 - 0.01, d / 2 - 0.12, g);
        box(0.04, 0.04, d - 0.2, legs, lx, h - 0.06, 0, g, { cast: false });
        box(0.05, 0.02, d - 0.2, legs, lx, 0.01, 0, g, { cast: false });
      }
      return g;
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.04, h, 0.04, legs, sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06), g);
    return g;
  }
  function monitor(g, x, z, rot = 0, screen = M.screen) {
    const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = rot; g.add(m);
    rbox(0.6, 0.36, 0.025, 0.008, M.black, 0, 1.08, 0, m);
    plane(0.57, 0.33, screen, 0, 1.08, 0.0135, 0, m);
    box(0.04, 0.26, 0.03, M.chrome, 0, 0.88, -0.035, m);
    rbox(0.22, 0.012, 0.17, 0.005, M.chrome, 0, 0.765, -0.03, m);
    return m;
  }
  function laptop(g, x, z, rot = 0) {
    const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = rot; g.add(m);
    rbox(0.32, 0.014, 0.22, 0.006, M.alu, 0, 0.766, 0, m);
    const lid = new THREE.Group(); lid.position.set(0, 0.772, -0.11); lid.rotation.x = -0.32; m.add(lid);
    rbox(0.32, 0.22, 0.008, 0.006, M.alu, 0, 0.11, 0, lid);
    plane(0.29, 0.19, M.screenGlow, 0, 0.11, 0.0045, 0, lid);
    return m;
  }
  function mug(g, x, y, z, mat = M.ceramic) { cyl(0.04, 0.035, 0.09, mat, x, y + 0.045, z, g, 16); }
  function notebook(g, x, y, z, rot = 0, mat = M.paperBook) { const b = rbox(0.21, 0.015, 0.15, 0.004, mat, x, y + 0.008, z, g); b.rotation.y = rot; }
  function deskLamp(g, x, z, rot = 0) {
    const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = rot; g.add(m);
    cyl(0.07, 0.08, 0.02, M.black, 0, 0.77, 0, m, 20);
    rod([0, 0.77, 0], [0.04, 1.1, -0.08], 0.008, M.black, m);
    rod([0.04, 1.1, -0.08], [0.0, 1.17, 0.16], 0.008, M.black, m);
    const sh = cyl(0.025, 0.07, 0.1, M.black, 0, 1.13, 0.2, m, 20);
    sh.rotation.x = 0.5;
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), M.bulb);
    b.position.set(0, 1.085, 0.225); b.rotation.x = Math.PI / 2 + 0.5; m.add(b);
  }
  function pot(g, r, h, mat = M.pot) { return cyl(r, r * 0.8, h, mat, 0, h / 2, 0, g, 28); }
  function leaves(g, n, cy, spread, size, seed = 1) {
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + seed;
      const r = spread * (0.3 + ((i * 7 + seed) % 10) / 13);
      const y = cy + (((i * 13 + seed) % 11) / 11) * size * 2.4 - size * 0.4;
      const leaf = new THREE.Mesh(T.leafGeo, i % 3 ? M.leaf : M.leaf2);
      leaf.scale.setScalar(size / 0.12);
      leaf.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      leaf.rotation.set(((i * 5) % 7) * 0.12 - 0.35, -a + Math.PI / 2, ((i * 3) % 5) * 0.1 - 0.2);
      add(leaf, g, { cast: true, receive: false });
    }
  }
  function plant(g, s = 1, kind = 'bush', potMat = M.pot) {
    if (simple || lite) { pot(g, 0.18 * s, 0.38 * s, potMat); sph(0.3 * s, M.leaf, 0, 0.7 * s, 0, g); return g; }
    if (kind === 'tree') {
      pot(g, 0.25 * s, 0.48 * s, potMat);
      cyl(0.02, 0.03, 1.35 * s, M.trunk, 0, 1.1 * s, 0, g, 8);
      leaves(g, 52, 1.5 * s, 0.42 * s, 0.15 * s, 3);
    } else if (kind === 'snake') {
      pot(g, 0.17 * s, 0.34 * s, potMat);
      for (let i = 0; i < 11; i++) {
        const a = i * 2.39996;
        const h = (0.45 + (i % 4) * 0.12) * s;
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045 * s, h, 4), M.leaf);
        blade.scale.z = 0.25;
        blade.position.set(Math.cos(a) * 0.06 * s, 0.34 * s + h / 2, Math.sin(a) * 0.06 * s);
        blade.rotation.set(Math.sin(a) * 0.18, a, Math.cos(a) * 0.18);
        add(blade, g);
      }
    } else {
      pot(g, 0.19 * s, 0.38 * s, potMat);
      cyl(0.01, 0.01, 0.4 * s, M.trunk, 0, 0.55 * s, 0, g, 6);
      leaves(g, 24, 0.72 * s, 0.24 * s, 0.13 * s, 7);
    }
    return g;
  }
  function smallPlant(g, x, y, z) {
    const m = new THREE.Group(); m.position.set(x, y, z); g.add(m);
    cyl(0.06, 0.05, 0.09, M.ceramic, 0, 0.045, 0, m, 16);
    if (simple || lite) return;
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      const lf = new THREE.Mesh(T.leafGeo, M.leaf2);
      lf.scale.setScalar(0.45);
      lf.position.set(Math.cos(a) * 0.04, 0.12 + (i % 3) * 0.02, Math.sin(a) * 0.04);
      lf.rotation.set(-0.4, -a + Math.PI / 2, 0.2);
      add(lf, m);
    }
  }
  function art(g, x, y, z, w, h, idx, ry = 0) {
    if (simple) return;
    const m = new THREE.Group(); m.position.set(x, y, z); m.rotation.y = ry; g.add(m);
    rbox(w + 0.06, h + 0.06, 0.03, 0.004, M.woodDark, 0, 0, 0, m, { cast: true, receive: true });
    plane(w, h, T.artMaterial(idx), 0, 0, 0.016, 0, m);
  }
  function shelfUnit(g, w, h, depth = 0.35, levels = 4, seed = 1) {
    // Estantería con libros, plantas y objetos.
    for (let i = 0; i <= levels; i++) rbox(w, 0.025, depth, 0.004, M.woodDark, 0, 0.1 + (i * (h - 0.15)) / levels, 0, g);
    for (const sx of [-1, 1]) box(0.025, h, depth, M.woodDark, sx * (w / 2 - 0.0125), h / 2, 0, g);
    if (simple) return g;
    const bookMats = [M.book1, M.book2, M.book3, M.book4];
    for (let i = 0; i < levels; i++) {
      const y = 0.1 + (i * (h - 0.15)) / levels + 0.0125;
      let x = -w / 2 + 0.06;
      let k = seed * 7 + i * 3;
      while (x < w / 2 - 0.12) {
        k++;
        const kind = k % 7;
        if (kind === 3 && x < w / 2 - 0.3) { smallPlant(g, x + 0.08, y, 0); x += 0.22; continue; }
        if (kind === 5 && x < w / 2 - 0.3) { cyl(0.05, 0.06, 0.16, M.ceramic, x + 0.07, y + 0.08, 0, g, 16); x += 0.2; continue; }
        const n = 4 + (k % 5);
        for (let b = 0; b < n && x < w / 2 - 0.08; b++) {
          const bw = 0.025 + ((k + b) % 3) * 0.012;
          const bh = 0.18 + ((k * 3 + b) % 5) * 0.025;
          box(bw, bh, depth * 0.7, bookMats[(k + b) % 4], x + bw / 2, y + bh / 2, 0, g, { cast: false });
          x += bw + 0.003;
        }
        x += 0.08;
      }
    }
    return g;
  }
  function domePendant(g, x, z, y = 1.95, mat = M.black) {
    if (!rich) return;
    cyl(0.004, 0.004, H - y, M.black, x, (H + y) / 2, z, g, 4, { cast: false });
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.21, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    d.material.side = THREE.DoubleSide;
    d.position.set(x, y, z);
    add(d, g, { cast: false });
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), M.lamp);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(x, y + 0.002, z);
    g.add(bulb);
    lights.push({ type: 'point', x, y: y - 0.1, z, intensity: 0.7, distance: 4.5, color: 0xFFD7A8 });
  }
  function linearPendant(g, x, z, len = 2.4) {
    if (!rich) return;
    for (const dx of [-len / 2 + 0.2, len / 2 - 0.2]) cyl(0.003, 0.003, H - 2.15, M.black, x + dx, (H + 2.15) / 2, z, g, 4, { cast: false });
    rbox(len, 0.05, 0.09, 0.01, M.black, x, 2.13, z, g, { cast: false });
    plane(len - 0.04, 0.06, M.lamp, x, 2.104, z, 0, g).rotation.x = Math.PI / 2;
    lights.push({ type: 'point', x, y: 2.0, z, intensity: 0.8, distance: 5, color: 0xFFE2C0 });
  }
  function floorLamp(g, x, z) {
    if (simple) return;
    cyl(0.14, 0.15, 0.025, M.black, x, 0.012, z, g, 24);
    cyl(0.012, 0.012, 1.45, M.black, x, 0.74, z, g, 8);
    cyl(0.12, 0.2, 0.26, M.lampShade, x, 1.52, z, g, 28);
    lights.push({ type: 'point', x, y: 1.4, z, intensity: 0.6, distance: 3.5, color: 0xFFD3A0 });
  }
  function rug(g, w, d, mat = M.rug) { rbox(w, 0.014, d, 0.006, rich ? T.tiledMaterial(mat, w, d, Math.max(w, d)) : mat, 0, 0.007, 0, g, { cast: false }); }
  function screenTV(g, x, y, z, w, ry, label) {
    const m = new THREE.Group(); m.position.set(x, y, z); m.rotation.y = ry; g.add(m);
    rbox(w, w * 0.5625 + 0.02, 0.04, 0.008, M.black, 0, 0, 0, m);
    plane(w - 0.02, w * 0.5625, rich ? T.screenMaterial(label) : M.screen, 0, 0, 0.021, 0, m);
    return m;
  }

  // ----------------------------------------------------------------- coworking
  const deskPositions = [];
  {
    const r = zone('coworking').rect;
    const desks = Math.max(0, L.desks ?? 35);
    const perSide = 5;
    const deskW = 1.4;
    const benchL = perSide * deskW;
    const cols = 2;
    const aisle = r.w - 1.6 - cols * benchL;
    let placed = 0;
    for (let row = 0; row < 2 && placed < desks; row++) {
      for (let col = 0; col < cols && placed < desks; col++) {
        const here = Math.min(perSide * 2, desks - placed);
        const used = Math.ceil(here / 2);
        const len = used * deskW;
        const bx = r.x + 0.8 + col * (benchL + aisle) + len / 2;
        const bz = r.z + 2.1 + row * 3.3;
        const bench = at(bx, bz, 0, furn);
        table(bench, len, 1.6, { sled: true, top: M.oak });
        if (!simple) rbox(len - 0.1, 0.3, 0.035, 0.012, M.feltLight, 0, 0.9, 0, bench);
        for (let i = 0; i < here; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const k = Math.floor(i / 2);
          const dx = -len / 2 + deskW * (k + 0.5);
          const dz = side * 0.42;
          const [wx, wz] = P(bx + dx, bz + dz);
          deskPositions.push(new THREE.Vector3(wx, 0, wz));
          const c = new THREE.Group();
          c.position.set(dx + (k % 2 ? 0.08 : -0.06), 0, side * (1.02 + (k % 3) * 0.05));
          c.rotation.y = (side < 0 ? 0 : Math.PI) + ((k * 7 + i) % 5 - 2) * 0.06;
          bench.add(c);
          taskChair(c, [M.fabric, M.fabricOat, M.fabricWarm, M.fabricOat, M.fabric][(k + row * 2 + col + (side > 0 ? 1 : 0)) % 5]);
          if (simple) continue;
          const face = side < 0 ? 0 : Math.PI;
          const v = (i + row * 3 + col) % 4;
          if (v === 0 || v === 2) monitor(bench, dx, side * 0.2, face + Math.PI, M.screenOn);
          if (v !== 3) laptop(bench, dx + 0.22, side * 0.52, face + Math.PI);
          if (v === 1) { mug(bench, dx - 0.35, 0.757, dz - side * 0.1, M.ceramicRec); notebook(bench, dx - 0.12, 0.757, dz - side * 0.12, 0.3); }
          if (v === 3) { notebook(bench, dx, 0.757, dz - side * 0.1, -0.2); mug(bench, dx + 0.3, 0.757, dz, M.ceramic); }
          if ((i + col) % 5 === 2) smallPlant(bench, dx - 0.45, 0.757, dz + side * 0.15);
          if ((i + row) % 6 === 4) deskLamp(bench, dx - 0.5, dz + side * 0.2, face + Math.PI);
        }
        for (let k = 0; k < used; k += 2) { const [lx, lz] = P(bx - len / 2 + deskW * (k + 1), bz); linearPendant(furn, lx, lz, 2.4); }
        placed += here;
      }
    }
    plant(at(r.x + 0.55, r.z + 1.6, 0, furn), 1.2, 'tree');
    plant(at(r.x + r.w - 0.7, r.z + r.d - 0.7, 0, furn), 1.15, 'tree');
    plant(at(r.x + r.w / 2 - 0.2, r.z + r.d - 0.55, 0, furn), 1, 'snake');
    plant(at(r.x + 4.4, r.z + r.d - 0.55, 0, furn), 0.95, 'bush');
    if (!simple) {
      // Barra junto a la ventana
      const bar = at(r.x + r.w / 2 + 3.6, r.z + r.d - 0.55, 0, furn);
      rbox(3.4, 0.04, 0.45, 0.01, M.oak, 0, 1.02, 0, bar);
      for (const sx of [-1.6, 1.6]) box(0.05, 1.0, 0.4, M.black, sx, 0.5, 0, bar);
      for (let i = 0; i < 4; i++) stool(at(r.x + r.w / 2 + 3.6 - 1.2 + i * 0.8, r.z + r.d - 1.05, 0, furn));
      laptop(bar, -0.6, 0.02, Math.PI); mug(bar, 0.5, 1.04, 0.05, M.ceramicRec);
      // Taquillas en el muro este
      const lk = at(r.x + r.w - 0.33, r.z + 1.9, LEFT, furn);
      for (let cx = 0; cx < 6; cx++) for (let cy = 0; cy < 4; cy++) {
        rbox(0.48, 0.46, 0.4, 0.01, (cx + cy) % 5 === 2 ? M.lockerRec : M.locker, -1.25 + cx * 0.5, 0.28 + cy * 0.48, 0, lk);
        box(0.012, 0.08, 0.02, M.black, -1.25 + cx * 0.5 + 0.17, 0.28 + cy * 0.48, 0.21, lk, { cast: false });
      }
      art(furn, ...P(r.x + r.w - 0.17, r.z + 5.0).flatMap((v, i) => (i === 0 ? [v, 1.65] : [v])), 0.9, 1.2, 1, LEFT);
      art(furn, ...P(r.x + r.w - 0.17, r.z + 6.4).flatMap((v, i) => (i === 0 ? [v, 1.65] : [v])), 0.9, 1.2, 2, LEFT);
      // Impresora y papelera junto al pasillo
      const pr = at(r.x + 9.0, r.z + 0.4, 0, furn);
      rbox(0.9, 0.7, 0.5, 0.01, M.cabinet, 0, 0.35, 0, pr);
      rbox(0.5, 0.32, 0.42, 0.02, M.printer, -0.1, 0.86, 0, pr);
      box(0.3, 0.01, 0.2, M.paper, -0.1, 1.03, 0.02, pr);
      // Perchero junto a la entrada al coworking
      const ck = at(r.x + 0.4, r.z + r.d - 1.2, 0, furn);
      cyl(0.18, 0.2, 0.02, M.black, 0, 0.01, 0, ck, 20);
      cyl(0.015, 0.015, 1.75, M.black, 0, 0.88, 0, ck, 8);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; rod([0, 1.65, 0], [Math.cos(a) * 0.16, 1.72, Math.sin(a) * 0.16], 0.008, M.black, ck); }
      rbox(0.36, 0.55, 0.12, 0.05, M.fabricRust, 0.1, 1.38, 0.08, ck);
    }
  }

  // ----------------------------------------------------- recepción y lounge
  {
    const r = zone('recepcion').rect; // x 0–7, z 12.4–16; entrada en la fachada (x 3,0–4,8)
    const dX = r.x + 5.55; const dZ = r.z + 1.25;
    const desk = at(dX, dZ, 0, furn);
    rbox(2.2, 1.02, 0.62, 0.02, M.oak, 0, 0.51, 0, desk);
    rbox(2.3, 0.04, 0.72, 0.01, M.stone, 0, 1.04, 0, desk);
    rbox(0.8, 0.04, 0.5, 0.01, M.stone, 0.85, 0.74, -0.55, desk);
    if (rich) brandLockup(1.4, 'dark', 0, 0.6, 0.311, 0, desk, { relief: false });
    if (!simple) {
      monitor(desk, -0.4, -0.12, Math.PI, M.screenOn);
      smallPlant(desk, 0.75, 1.06, 0.1);
      const c = new THREE.Group(); c.position.set(-0.25, 0, -0.75); desk.add(c); taskChair(c, M.fabric);
      mug(desk, 0.35, 1.06, 0.12, M.ceramic);
    }
    for (const dx of [-0.6, 0.6]) { const [px, pz] = P(dX + dx, dZ); domePendant(furn, px, pz, 2.05, M.brass); }
    // Lounge bajo el logotipo
    const s = at(r.x + 0.6, r.z + 1.75, RIGHT, furn);
    sofa(s, 2.2, M.linen);
    if (rich) {
      const [lx, lz] = P(r.x + 0.155, r.z + 1.75);
      brandLockup(2.3, 'dark', lx, 1.9, lz, Math.PI / 2);
    }
    loungeChair(at(r.x + 2.35, r.z + 1.0, LEFT + 0.55, furn), M.fabricWarm);
    const tb = at(r.x + 1.5, r.z + 1.75, 0, furn);
    rug(tb, 2.3, 2.2, M.rug);
    cyl(0.4, 0.4, 0.035, M.oak, 0, 0.42, 0, tb, 40);
    if (!simple) {
      cyl(0.03, 0.03, 0.4, M.black, 0, 0.2, 0, tb, 8);
      cyl(0.22, 0.25, 0.015, M.black, 0, 0.008, 0, tb, 24);
      notebook(tb, -0.12, 0.44, 0.05, 0.4, M.book3); notebook(tb, -0.1, 0.455, 0.06, 0.2, M.book1);
      mug(tb, 0.2, 0.44, -0.1, M.ceramic);
      smallPlant(tb, 0.15, 0.44, 0.18);
    }
    floorLamp(furn, ...P(r.x + 0.5, r.z + 0.45));
    plant(at(r.x + 0.5, r.z + r.d - 0.45, 0, furn), 1.05, 'tree');
    plant(at(r.x + r.w - 0.45, r.z + r.d - 0.45, 0, furn), 0.9, 'snake');
  }

  // ------------------------------------------------------- salas de reuniones
  function meetingRoom(id, seats, name, artIdx) {
    const zr = zone(id);
    if (!zr) return;
    const r = zr.rect;
    const long = seats > 4;
    const tw = long ? 2.6 : 1.8;
    const td = long ? 1.1 : 1.0;
    // Sala grande: mesa larga de norte a sur y pantalla en el muro del fondo. Sala pequeña: mesa junto a la pantalla.
    const tcx = r.x + r.w / 2 + (long ? 0 : 0.15);
    const tcz = long ? r.z + r.d / 2 - 0.25 : r.z + 2.3;
    const tg = at(tcx, tcz, long ? RIGHT : 0, furn);
    table(tg, tw, td, { top: M.oak, legs: M.black });
    const per = Math.ceil(seats / 2);
    for (let i = 0; i < seats; i++) {
      const side = i < per ? -1 : 1;
      const k = i % per;
      const c = new THREE.Group();
      c.position.set(-tw / 2 + (tw / per) * (k + 0.5), 0, side * (td / 2 + 0.3));
      c.rotation.y = (side < 0 ? 0 : Math.PI) + ((i * 5) % 3 - 1) * 0.08;
      tg.add(c);
      shellChair(c, i % 3 === 1 ? M.shellRec : M.shellWhite, M.oak);
    }
    if (!simple) {
      laptop(tg, -tw / 4, -0.2, 0); notebook(tg, tw / 4, 0.757, 0.2, 0.2); mug(tg, tw / 4 + 0.25, 0.757, -0.15, M.ceramicRec);
      for (let i = 0; i < seats; i += 2) cyl(0.035, 0.03, 0.12, M.glassCup, -tw / 2 + (tw / per) * ((i / 2) + 0.5), 0.82, 0.25, tg, 12);
    }
    if (long) {
      const [tx, tz] = P(tcx, r.z + r.d - 0.19);
      screenTV(furn, tx, 1.45, tz, 1.4, Math.PI, name);
      art(furn, ...[P(r.x + 0.17, tcz)[0], 1.6, P(r.x + 0.17, tcz)[1]], 1.1, 0.8, artIdx, Math.PI / 2);
      if (!simple) {
        const cr = at(r.x + r.w - 0.3, r.z + r.d - 0.9, LEFT, furn);
        rbox(1.0, 0.62, 0.4, 0.01, M.oak, 0, 0.31, 0, cr);
        smallPlant(cr, -0.25, 0.62, 0); for (let i = 0; i < 5; i++) box(0.03, 0.22, 0.2, [M.book1, M.book3, M.book2][i % 3], 0.15 + i * 0.035, 0.73, 0, cr);
      }
      plant(at(r.x + 0.45, r.z + r.d - 0.45, 0, furn), 0.85, 'snake');
    } else {
      const [tx, tz] = P(tcx, r.z + 0.19);
      screenTV(furn, tx, 1.45, tz, 1.25, 0, name);
      art(furn, ...[P(r.x + 0.17, r.z + 4.2)[0], 1.55, P(r.x + 0.17, r.z + 4.2)[1]], 0.75, 1.0, artIdx, Math.PI / 2);
      if (!simple) {
        const wb = at(r.x + r.w - 0.3, r.z + 1.0, LEFT, furn);
        rbox(1.2, 0.85, 0.03, 0.01, rich ? T.whiteboardMaterial() : M.whiteboard, 0, 1.35, 0, wb);
        for (const sx of [-0.58, 0.58]) { box(0.03, 1.8, 0.03, M.chrome, sx, 0.9, -0.02, wb); box(0.03, 0.03, 0.45, M.chrome, sx, 0.03, -0.02, wb); }
      }
      loungeChair(at(r.x + 0.75, r.z + 5.0, RIGHT - 0.5, furn), M.fabricOat);
      plant(at(r.x + 0.45, r.z + 0.5, 0, furn), 0.85, 'snake');
    }
    const [cx, cz] = P(tcx, tcz);
    if (long) { domePendant(furn, cx, cz - 0.7, 1.95); domePendant(furn, cx, cz + 0.7, 1.95); }
    else { domePendant(furn, cx - 0.4, cz, 1.95); domePendant(furn, cx + 0.4, cz, 1.95); }
  }
  meetingRoom('sala-salinas', 8, 'Sala Salinas', 3);
  meetingRoom('sala-rambla', 4, 'Sala Rambla', 4);

  // -------------------------------------------------------------------- cabinas
  {
    const r = zone('cabinas').rect; // cada cabina: 3 m × 1,67 m, frente de vidrio al coworking (este)
    for (let i = 0; i < boothN; i++) {
      const zc = r.z + bd * (i + 0.5);
      const g = at(r.x + 0.55, zc, 0, furn);
      rbox(0.55, 0.03, Math.min(1.2, bd - 0.35), 0.008, M.oak, -0.2, 0.74, 0, g);
      box(0.04, 0.72, 0.04, M.black, -0.2, 0.37, 0, g);
      const c = new THREE.Group(); c.position.set(0.45, 0, 0); c.rotation.y = LEFT; g.add(c);
      taskChair(c, i % 2 ? M.fabricWarm : M.fabric);
      if (!simple) {
        laptop(g, -0.25, 0, Math.PI / 2);
        // Panel acústico en el fondo, butaca junto al vidrio y lámpara de techo
        rbox(0.04, 1.0, Math.min(1.3, bd - 0.3), 0.02, i % 2 ? M.feltRec : M.feltOat, -0.5, 1.45, 0, g);
        loungeChair(at(r.x + r.w - 0.75, zc, LEFT, furn), i % 2 ? M.fabricOat : M.leather);
        const lamp = cyl(0.12, 0.12, 0.03, M.lamp, 0.9, boothH - 0.03, 0, g, 24, { cast: false });
        lamp.position.y = boothH - 0.03;
        if (i === 1) smallPlant(g, -0.25, 0.757, -0.4);
      }
    }
  }

  // ----------------------------------------------------------- office (cocina)
  {
    const r = zone('office').rect;
    const k = at(r.x + r.w / 2 - 0.35, r.z + 0.47, 0, furn);
    const runW = r.w - 1.0;
    rbox(runW, 0.86, 0.6, 0.008, M.cabinet, 0, 0.45, 0, k);
    box(runW, 0.08, 0.5, M.black, 0, 0.04, 0.02, k);
    rbox(runW + 0.04, 0.035, 0.64, 0.006, M.stone, 0, 0.9, 0.01, k);
    if (!simple) {
      for (let i = 0; i < Math.floor(runW / 0.6); i++) box(0.006, 0.7, 0.005, M.groove, -runW / 2 + 0.6 * (i + 1), 0.48, 0.302, k, { cast: false });
      box(0.5, 0.02, 0.38, M.sink, -0.9, 0.912, 0.02, k, { cast: false });
      rod([-0.9, 0.92, -0.22], [-0.9, 1.25, -0.22], 0.012, M.chrome, k); rod([-0.9, 1.25, -0.22], [-0.9, 1.22, -0.05], 0.01, M.chrome, k);
      // Cafetera espresso, molinillo y hervidor
      const ex = new THREE.Group(); ex.position.set(0.55, 0.92, -0.05); k.add(ex);
      rbox(0.42, 0.38, 0.36, 0.02, M.chrome, 0, 0.19, 0, ex);
      rbox(0.42, 0.06, 0.36, 0.02, M.black, 0, 0.41, 0, ex);
      cyl(0.035, 0.035, 0.05, M.black, -0.08, 0.13, 0.2, ex, 12).rotation.x = Math.PI / 2;
      mug(ex, -0.08, 0.02, 0.18, M.ceramicRec); mug(ex, 0.08, 0.02, 0.18, M.ceramic);
      cyl(0.06, 0.07, 0.3, M.black, 0.95, 1.07, -0.08, k, 16);
      cyl(0.08, 0.09, 0.2, M.chrome, -0.25, 1.02, -0.05, k, 20);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.ceramic);
      bowl.position.set(-0.3, 1.07, -0.05); bowl.material.side = THREE.DoubleSide; add(bowl, k);
      for (let i = 0; i < 5; i++) sph(0.04, i % 2 ? M.fruitA : M.fruitB, -0.33 + (i % 3) * 0.05, 1.0 + Math.floor(i / 3) * 0.04, -0.06 + (i % 2) * 0.05, k);
      // Estantes abiertos con tazas y botes
      for (const y of [1.55, 1.95]) {
        rbox(runW - 0.6, 0.03, 0.26, 0.005, M.oak, 0.1, y, -0.2, k);
        for (let i = 0; i < 9; i++) {
          if (i % 3 === 2) cyl(0.05, 0.05, 0.16, M.glassCup, -runW / 2 + 0.6 + i * 0.32, y + 0.095, -0.2, k, 14);
          else mug(k, -runW / 2 + 0.6 + i * 0.32, y + 0.015, -0.2, i % 2 ? M.ceramic : M.ceramicDark);
        }
      }
      // Frigorífico
      const fr = at(r.x + r.w - 0.5, r.z + 0.47, 0, furn);
      rbox(0.72, 2.05, 0.66, 0.01, M.cabinet, 0, 1.025, 0, fr);
      box(0.02, 0.4, 0.03, M.chrome, -0.3, 1.25, 0.34, fr);
      box(0.006, 2.0, 0.005, M.groove, 0, 1.03, 0.332, fr);
    }
    const tbl = at(r.x + r.w / 2 - 0.2, r.z + 2.95, 0, furn);
    table(tbl, 2.3, 0.95, { top: M.oak });
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
      const c = new THREE.Group(); c.position.set(-0.78 + i * 0.78, 0, side * 0.68); c.rotation.y = side < 0 ? 0 : Math.PI; tbl.add(c);
      shellChair(c, (i + side) % 3 === 0 ? M.shellRec : M.shellWhite, M.oak);
    }
    if (!simple) { mug(tbl, -0.4, 0.757, 0.1, M.ceramic); mug(tbl, 0.5, 0.757, -0.15, M.ceramicRec); laptop(tbl, 0.15, 0.15, Math.PI); smallPlant(tbl, -0.9, 0.757, 0); }
    const [tx, tz] = P(r.x + r.w / 2 - 0.2, r.z + 2.95);
    domePendant(furn, tx - 0.6, tz, 1.95, M.brass); domePendant(furn, tx + 0.6, tz, 1.95, M.brass);
    art(furn, ...[P(r.x + 0.17, r.z + 3.0)[0], 1.6, P(r.x + 0.17, r.z + 3.0)[1]], 0.8, 1.0, 5, Math.PI / 2);
    plant(at(r.x + 0.45, r.z + r.d - 0.5, 0, furn), 0.85, 'bush');
    if (!simple) {
      // Barra alta de café junto al muro este
      const hb = at(r.x + r.w - 0.45, r.z + 4.3, RIGHT, furn);
      rbox(1.6, 0.04, 0.5, 0.01, M.oak, 0, 1.04, 0, hb);
      for (const sx of [-0.72, 0.72]) box(0.05, 1.02, 0.44, M.black, sx, 0.51, 0, hb);
      mug(hb, -0.3, 1.06, 0.05, M.ceramicRec); mug(hb, 0.25, 1.06, -0.05, M.ceramic);
      for (let i = 0; i < 3; i++) stool(at(r.x + r.w - 1.0, r.z + 3.75 + i * 0.55, 0, furn));
    }
  }

  // ------------------------------------------------- estudio de pódcast y vídeo
  {
    const r = zone('estudio').rect; // 4,2 m × 6 m (25 m²), puerta al pasillo en el muro sur
    const sg = new THREE.Group(); sg.name = 'studio'; furn.add(sg);
    const wallZ = r.z + 0.16; // cara interior del muro norte
    const wallTop = Math.min(2.8, wallH);
    // Pared de listones de madera con el símbolo de FRAME en neón
    {
      const [bx, bz] = P(r.x + r.w / 2, wallZ + 0.02);
      box(r.w - 0.4, wallTop - 0.1, 0.03, M.slatBack, bx, (wallTop + 0.1) / 2, bz, sg);
      if (!simple) {
        const slatH = wallTop - 0.15;
        const n = Math.floor((r.w - 0.5) / 0.085);
        const geo = new THREE.BoxGeometry(0.042, slatH, 0.035);
        const inst = new THREE.InstancedMesh(geo, M.slat, n);
        const m4 = new THREE.Matrix4();
        const x0 = r.x + (r.w - n * 0.085) / 2;
        for (let i = 0; i < n; i++) {
          const [sx, sz] = P(x0 + 0.0425 + i * 0.085, wallZ + 0.055);
          m4.makeTranslation(sx, slatH / 2 + 0.1, sz);
          inst.setMatrixAt(i, m4);
        }
        inst.castShadow = true; inst.receiveShadow = true;
        sg.add(inst);
      }
      if (rich) {
        // Tira LED cálida en la parte superior e inferior del revestimiento
        for (const y of [0.09, wallTop - 0.02]) plane(r.w - 0.5, 0.025, M.ledStrip, bx, y, bz + 0.06, 0, sg).rotation.x = y < 1 ? -Math.PI / 2 : Math.PI / 2;
        const ls = 1.0;
        const [lx, lz] = P(r.x + r.w / 2, wallZ + 0.1);
        rbox(ls + 0.24, ls + 0.24, 0.035, 0.012, M.black, lx, 1.66, lz, sg);
        brandSymbol(ls, M.neon, lx, 1.66, lz + 0.018, 0, sg, 0.014);
        lights.push({ type: 'point', x: lx, y: 1.66, z: lz + 0.45, intensity: 0.7, distance: 2.8, color: 0xFFD9A8 });
        // Rótulo ON AIR
        rbox(0.78, 0.24, 0.07, 0.02, M.black, lx, 2.42, lz, sg);
        plane(0.72, 0.19, T.onAirMaterial(), lx, 2.42, lz + 0.036, 0, sg);
        lights.push({ type: 'point', x: lx, y: 2.42, z: lz + 0.3, intensity: 0.9, distance: 2.2, color: 0xFF3A12 });
      }
    }
    // Techo oscuro y revestimiento textil en los muros del estudio
    if (rich) {
      const [cx0, cz0] = P(r.x + r.w / 2, r.z + r.d / 2);
      box(r.w - 0.14, 0.02, r.d - 0.14, M.slatBack, cx0, H - 0.01, cz0, sg, { cast: false });
      for (const side of [0, 1]) {
        const [wx, wz] = P(side ? r.x + r.w - 0.085 : r.x + 0.085, r.z + r.d / 2);
        box(0.02, H - 0.05, r.d - 0.3, M.studioLining, wx, H / 2, wz, sg, { cast: false });
      }
      for (const [a, b] of [[r.x + 0.15, studioDoor.from - 0.05], [studioDoor.to + 0.05, r.x + r.w - 0.15]]) {
        const [sx0, sz0] = P((a + b) / 2, r.z + r.d - 0.085);
        box(b - a, H - 0.05, 0.02, M.studioLining, sx0, H / 2, sz0, sg, { cast: false });
      }
    }
    // Paneles acústicos hexagonales en los muros oeste y este, y trampa de graves
    if (!simple) {
      const hex = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 6);
      const mats = [M.felt, M.feltRec, M.feltOat, M.felt];
      const rowsP = cut ? Math.max(0, Math.floor((cut - 0.9) / 0.45)) : 4;
      for (let i = 0; i < 6; i++) for (let j = 0; j < rowsP; j++) {
        const m = new THREE.Mesh(hex, mats[(i * 3 + j * 2) % 4]);
        const [hx, hz] = P(r.x + 0.1, r.z + 1.0 + i * 0.47 + (j % 2) * 0.235);
        m.position.set(hx, 1.0 + j * 0.42, hz);
        m.rotation.set(0, 0, Math.PI / 2);
        add(m, sg);
      }
      for (let i = 0; i < 4; i++) for (let j = 0; j < Math.min(3, rowsP); j++) {
        const m = new THREE.Mesh(hex, mats[(i + j * 3 + 1) % 4]);
        const [hx, hz] = P(r.x + r.w - 0.1, r.z + 1.3 + i * 0.47 + (j % 2) * 0.235);
        m.position.set(hx, 1.25 + j * 0.42, hz);
        m.rotation.set(0, 0, Math.PI / 2);
        add(m, sg);
      }
      const bt = rbox(0.4, Math.min(2.4, wallH - 0.05), 0.4, 0.03, M.felt, ...[P(r.x + 0.3, r.z + 0.45)[0], Math.min(2.4, wallH - 0.05) / 2, P(r.x + 0.3, r.z + 0.45)[1]], sg);
      bt.rotation.y = Math.PI / 4;
    }
    // Mesa de pódcast redonda con cuatro puestos completos
    const tcx = r.x + r.w / 2;
    const tcz = r.z + 2.35;
    const tg = at(tcx, tcz, 0, sg);
    rug(at(tcx, tcz, 0, sg), 3.2, 3.0, M.rugStudio);
    table(tg, 1.55, 1.55, { round: true, top: M.walnut, legs: M.black });
    if (!simple) cyl(0.775, 0.775, 0.012, M.black, 0, 0.716, 0, tg, 48, { cast: false });
    const seatsA = [0.26, 1.83, 3.4, -1.31];
    seatsA.forEach((a, i) => {
      const c = new THREE.Group();
      c.position.set(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15);
      c.rotation.y = -a - Math.PI / 2;
      tg.add(c);
      taskChair(c, i % 2 ? M.leather : M.fabric);
      if (simple) return;
      // Brazo articulado con micrófono dinámico
      const ca = Math.cos(a); const sa = Math.sin(a);
      const base = [ca * 0.74, 0.76, sa * 0.74];
      const j1 = [ca * 0.74, 0.86, sa * 0.74];
      const j2 = [ca * 0.68 + -sa * 0.12, 1.32, sa * 0.68 + ca * 0.12];
      const micP = [ca * 0.47, 1.08, sa * 0.47];
      box(0.05, 0.06, 0.06, M.black, base[0], 0.73, base[2], tg).rotation.y = -a;
      rod(base, j1, 0.012, M.black, tg);
      rod(j1, j2, 0.01, M.black, tg);
      rod([j1[0], j1[1] + 0.06, j1[2]], [j2[0], j2[1] - 0.05, j2[2]], 0.006, M.black, tg);
      rod(j2, [micP[0], micP[1] + 0.07, micP[2]], 0.01, M.black, tg);
      const mic = new THREE.Group(); mic.position.set(...micP); tg.add(mic);
      mic.rotation.set(0.28, Math.atan2(ca, sa), 0, 'YXZ');
      const body = cyl(0.034, 0.03, 0.18, M.micBody, 0, 0, 0, mic, 20); body.rotation.x = Math.PI / 2;
      const cap = sph(0.042, M.foam, 0, 0, 0.1, mic, 1, 1, 1.2);
      cap.material = M.foam;
      // Auriculares sobre la mesa
      const hp = new THREE.Group(); hp.position.set(ca * 0.5, 0.78, sa * 0.5); hp.rotation.y = -a; tg.add(hp);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24, Math.PI), M.black);
      band.rotation.x = -Math.PI / 2; add(band, hp);
      for (const sx of [-1, 1]) cyl(0.045, 0.045, 0.035, M.black, sx * 0.085, 0.018, 0, hp, 20);
      if (i === 1) laptop(tg, Math.cos(a) * 0.35 - Math.sin(a) * 0.25, Math.sin(a) * 0.35 + Math.cos(a) * 0.25, -a + Math.PI / 2);
      if (i !== 1) { cyl(0.035, 0.03, 0.11, M.glassCup, ca * 0.55 - sa * 0.2, 0.81, sa * 0.55 + ca * 0.2, tg, 14); }
      if (i === 2) mug(tg, ca * 0.55 + sa * 0.2, 0.757, sa * 0.55 - ca * 0.2, M.ceramicRec);
      if (i === 3) notebook(tg, ca * 0.4 + sa * 0.2, 0.757, sa * 0.4 - ca * 0.2, a);
    });
    if (!simple) {
      // Mesa de mezclas en el centro
      const mx = new THREE.Group(); mx.position.set(0, 0.76, 0); mx.rotation.y = 0.3; tg.add(mx);
      rbox(0.42, 0.05, 0.28, 0.01, M.mixer, 0, 0.025, 0, mx);
      for (let i = 0; i < 6; i++) { box(0.012, 0.012, 0.09, M.black, -0.15 + i * 0.06, 0.055, 0.05, mx, { cast: false }); box(0.02, 0.016, 0.02, M.faderCap, -0.15 + i * 0.06, 0.062, 0.03 + (i % 3) * 0.02, mx, { cast: false }); }
      for (let i = 0; i < 4; i++) cyl(0.022, 0.022, 0.02, i === 0 ? M.buttonRec : M.black, -0.12 + i * 0.08, 0.06, -0.08, mx, 14, { cast: false });
      plane(0.12, 0.06, M.screenOn, 0.13, 0.052, -0.07, 0, mx).rotation.x = -Math.PI / 2;
      // Nube acústica sobre la mesa
      if (rich) { const [nx, nz] = P(tcx, tcz); rbox(1.6, 0.05, 1.6, 0.02, M.felt, nx, 2.9, nz, sg, { cast: true }); for (const [ax, az] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) cyl(0.002, 0.002, H - 2.92, M.black, nx + ax, (H + 2.92) / 2, nz + az, sg, 4, { cast: false }); }
    }
    // Iluminación de estudio: softboxes octogonales
    function softbox(lx, lz, aim, h = 1.95) {
      if (simple) return;
      const g = at(lx, lz, 0, sg);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; rod([0, 0.75, 0], [Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], 0.01, M.black, g); }
      cyl(0.014, 0.014, h - 0.6, M.black, 0, 0.75 + (h - 0.75) / 2, 0, g, 8);
      const head = new THREE.Group(); head.position.set(0, h, 0); g.add(head);
      const [wx, wz] = P(aim[0], aim[1]);
      head.lookAt(wx, aim[2], wz);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.14, 0.38, 8, 1, true), M.black);
      body.material.side = THREE.DoubleSide;
      body.rotation.x = -Math.PI / 2;
      add(body, head);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.41, 8), M.softbox);
      face.position.z = 0.19; add(face, head, { cast: false });
      lights.push({ type: 'spot', x: g.position.x, y: h, z: g.position.z, tx: wx, ty: aim[2], tz: wz, intensity: 16, color: 0xFFF1E0 });
    }
    softbox(r.x + 0.55, r.z + 4.35, [tcx, tcz, 1.0]);
    softbox(r.x + r.w - 0.5, r.z + 0.75, [tcx, tcz, 1.0], 2.05);
    // Cámaras en trípode apuntando a la mesa
    function cameraRig(lx, lz, aim, h = 1.42) {
      if (simple) return;
      const g = at(lx, lz, 0, sg);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.3; rod([0, h - 0.12, 0], [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], 0.011, M.black, g); }
      const head = new THREE.Group(); head.position.set(0, h, 0); g.add(head);
      const [wx, wz] = P(aim[0], aim[1]);
      head.lookAt(wx, aim[2], wz);
      rbox(0.13, 0.1, 0.16, 0.015, M.black, 0, 0, -0.02, head);
      const lens = cyl(0.04, 0.045, 0.14, M.black, 0, 0, 0.11, head, 20); lens.rotation.x = Math.PI / 2;
      const glassL = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), M.lens); glassL.position.z = 0.181; head.add(glassL);
      rbox(0.12, 0.08, 0.01, 0.005, M.black, 0.1, 0.06, -0.08, head);
      plane(0.11, 0.07, M.screenOn, 0.1, 0.06, -0.086, Math.PI, head);
      sph(0.01, M.buttonRec, -0.05, 0.055, 0.0, head);
    }
    cameraRig(r.x + 0.6, r.z + 3.55, [tcx + 0.2, tcz - 0.2, 1.05]);
    cameraRig(r.x + r.w - 0.5, r.z + 3.45, [tcx - 0.1, tcz, 1.05]);
    if (!simple) {
      // Aro de luz junto a la cámara oeste
      const rl = at(r.x + 0.55, r.z + 2.6, 0, sg);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; rod([0, 0.6, 0], [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25], 0.009, M.black, rl); }
      cyl(0.012, 0.012, 1.0, M.black, 0, 1.0, 0, rl, 8);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 10, 40), M.ringLight);
      ring.position.set(0, 1.55, 0); ring.rotation.y = Math.PI / 2; rl.add(ring);
      // Estantería junto a la puerta: libros, lámpara y plantas (como en la referencia del estudio)
      const sh = at(r.x + 0.85, r.z + r.d - 0.33, Math.PI, sg);
      shelfUnit(sh, 1.3, 1.9, 0.32, 4, 7);
      const [lpx, lpz] = P(r.x + 0.5, r.z + r.d - 0.33);
      cyl(0.07, 0.09, 0.14, M.lampShade, lpx, 1.5, lpz, sg, 20);
      lights.push({ type: 'point', x: lpx, y: 1.45, z: lpz - 0.1, intensity: 0.35, distance: 2.0, color: 0xFFC890 });
      smallPlant(sh, 0.35, 1.875, 0.02);
    }
    // Puesto de control en el muro este, junto a la puerta
    if (!simple) {
      const cd = at(r.x + r.w - 0.42, r.z + 4.65, Math.PI, sg);
      rbox(0.65, 0.035, 1.5, 0.01, M.walnut, 0, 0.74, 0, cd);
      for (const dz of [-0.7, 0.7]) box(0.6, 0.72, 0.035, M.black, 0, 0.36, dz, cd);
      monitor(cd, -0.08, -0.32, RIGHT, M.screenWave);
      monitor(cd, -0.08, 0.32, RIGHT, M.screenOn);
      for (const dz of [-0.66, 0.66]) { rbox(0.18, 0.28, 0.2, 0.01, M.black, -0.12, 0.9, dz, cd); const woof = cyl(0.06, 0.06, 0.01, M.speakerCone, -0.02, 0.86, dz, cd, 20); woof.rotation.z = Math.PI / 2; }
      rbox(0.16, 0.012, 0.42, 0.004, M.black, 0.12, 0.765, 0, cd);
      rbox(0.24, 0.06, 0.16, 0.01, M.mixer, 0.15, 0.79, 0.42, cd);
      const c = new THREE.Group(); c.position.set(0.72, 0, 0); c.rotation.y = LEFT; cd.add(c); taskChair(c, M.fabric);
      // Luz de grabación sobre la puerta (lado del pasillo)
      const [ox2, oz2] = P((studioDoor.from + studioDoor.to) / 2, rowA + 0.08);
      if (rich) { rbox(0.5, 0.16, 0.05, 0.01, M.black, ox2, 2.42, oz2, root); plane(0.46, 0.12, T.onAirMaterial(), ox2, 2.42, oz2 + 0.026, 0, root); }
    }
    // Focos de carril en el techo
    if (rich) {
      for (let i = 0; i < 4; i++) {
        const [fx, fz] = P(r.x + 0.6 + i * 1.0, r.z + 1.0);
        cyl(0.04, 0.04, 0.12, M.black, fx, H - 0.1, fz, sg, 16, { cast: false });
        const head = cyl(0.045, 0.05, 0.14, M.black, fx, H - 0.24, fz, sg, 16, { cast: false });
        head.rotation.x = 0.4;
      }
      const [rx1, rz1] = P(r.x + 0.6, r.z + 1.0); const [rx2] = P(r.x + 3.6, 0);
      box(rx2 - rx1 + 0.2, 0.03, 0.04, M.black, (rx1 + rx2) / 2, H - 0.02, rz1, sg, { cast: false });
    }
  }

  // ----------------------------------------------------------------- despachos
  {
    const r = zone('despachos').rect;
    for (let i = 0; i < officeN; i++) {
      const ocx = r.x + offW * (i + 0.5);
      const seats = Math.min(3, i + 1);
      const dg = at(ocx, r.z + 1.35, 0, furn);
      table(dg, Math.min(offW - 0.4, 2.0), 0.8, { top: M.oak });
      for (let s = 0; s < seats; s++) {
        const c = new THREE.Group(); c.position.set(-0.55 + s * (1.1 / Math.max(1, seats - 1 || 1)) * (seats > 1 ? 1 : 0) + (seats === 1 ? 0.55 : 0), 0, 0.72); c.rotation.y = Math.PI; dg.add(c);
        taskChair(c, s % 2 ? M.fabricOat : M.fabric);
      }
      if (!simple) {
        monitor(dg, -0.4, -0.18, 0, M.screenOn); laptop(dg, 0.35, 0.08, 0);
        deskLamp(dg, 0.75, -0.2, 0); mug(dg, -0.05, 0.757, 0.15, M.ceramicRec); notebook(dg, 0.1, 0.757, 0.1, -0.3);
        const sh = at(r.x + offW * i + 0.3, r.z + 3.6, Math.PI / 2, furn);
        shelfUnit(sh, 1.6, 1.9, 0.32, 4, i + 2);
        art(furn, ...[P(ocx, r.z + 0.17)[0], 1.65, P(ocx, r.z + 0.17)[1]], 0.7, 0.9, 6 + i, 0);
        plant(at(r.x + offW * (i + 1) - 0.4, r.z + r.d - 0.55, 0, furn), 0.8, i % 2 ? 'snake' : 'bush');
        // Rincón de lectura en cada despacho
        loungeChair(at(ocx - 0.95, r.z + 5.05, 2.36, furn), [M.fabricOat, M.leather, M.fabricWarm][i % 3]);
      }
      const [px, pz] = P(ocx, r.z + 1.35);
      domePendant(furn, px, pz, 2.0);
    }
  }

  // ------------------------------------------------- pasillo: obra gráfica
  if (!simple && rich) {
    for (let i = 0; i < 3; i++) art(furn, ...[P(zOff.x + 3.75 + i * 0.85, rowA + 0.08)[0], 1.6, P(zOff.x + 3.75 + i * 0.85, rowA + 0.08)[1]], 0.6, 0.8, 8 + i, 0);
  }

  // ---------------------------------------------------------------------- aseos
  if (!simple) {
    const r = zone('aseos').rect;
    const wc = (lx, lz, rot) => {
      const g = at(lx, lz, rot, furn);
      rbox(0.38, 0.4, 0.55, 0.12, M.ceramic, 0, 0.2, 0.05, g);
      rbox(0.36, 0.35, 0.16, 0.03, M.ceramic, 0, 0.62, -0.2, g);
      return g;
    };
    const sink = (lx, lz, rot) => {
      const g = at(lx, lz, rot, furn);
      rbox(0.55, 0.12, 0.42, 0.04, M.ceramic, 0, 0.82, 0, g);
      rod([0, 0.88, -0.17], [0, 1.0, -0.17], 0.01, M.chrome, g);
      rbox(0.5, 0.7, 0.02, 0.01, M.mirror || M.glass, 0, 1.45, -0.2, g, { cast: false });
      return g;
    };
    // Aseo adaptado (pasillo) y segundo aseo al fondo
    wc(r.x + 0.4, r.z + 3.55, RIGHT); sink(r.x + 0.9, r.z + 3.25, 0);
    { const [gx, gz] = P(r.x + 0.12, r.z + 3.55); box(0.03, 0.03, 0.7, M.chrome, gx, 0.75, gz, furn, { cast: false }); } // barra de apoyo
    wc(r.x + 1.2, r.z + 0.4, 0); sink(r.x + r.w - 0.45, r.z + 1.4, LEFT);
  }

  // ----------------------------------------------------- exterior (solo renders)
  if (rich && !opts.noExterior) {
    const ex = new THREE.Group(); ex.name = 'exterior'; root.add(ex);
    const [sx, sz] = P(W / 2, D + 2.2);
    box(W + 40, 0.1, 4.4, T.tiledMaterial(M.sidewalk, W + 40, 4.4, 1.2), sx, -0.1, sz, ex);
    const [rx, rz] = P(W / 2, D + 7.9);
    box(W + 40, 0.1, 7, M.asphalt, rx, -0.15, rz, ex);
    for (let i = 0; i < 9; i++) { const [mx] = P(-8 + i * 5.5, 0); box(2.2, 0.02, 0.12, M.paintLine, mx, -0.09, rz, ex, { cast: false }); }
    const [s2x, s2z] = P(W / 2, D + 13.4);
    box(W + 40, 0.1, 4, M.sidewalk, s2x, -0.1, s2z, ex);
    // Fachadas de enfrente
    const [fx, fz] = P(W / 2, D + 15.6);
    const fac = new THREE.Mesh(new THREE.BoxGeometry(W + 40, 14, 0.5), T.facadeMaterial(W + 40, 14));
    fac.position.set(fx, 7, fz);
    ex.add(fac);
    // Palmeras de la rambla
    for (let i = 0; i < 6; i++) palm(ex, ...P(-1 + i * 5.6, D + 4.0), 6.5 + (i % 3) * 0.8, i);
    for (let i = 0; i < 6; i++) palm(ex, ...P(2 + i * 5.6, D + 11.6), 6 + (i % 2) * 1.2, i + 3);
    // Farolas
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = P(1.5 + i * 7.5, D + 4.7);
      cyl(0.05, 0.07, 4.2, M.black, lx, 2.1, lz, ex, 10);
      box(0.6, 0.08, 0.2, M.black, lx + 0.25, 4.2, lz, ex);
    }
  }
  function palm(parent, x, z, h, seed) {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
    const lean = ((seed * 37) % 10 - 5) / 40;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * h * 0.3, h * 0.4, 0), new THREE.Vector3(lean * h, h, lean * h * 0.3)]);
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.2, 10, false), M.palmTrunk), g);
    const top = curve.getPoint(1);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + seed;
      const geo = new THREE.PlaneGeometry(2.6, 0.38, 10, 1);
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const u = (p.getX(k) + 1.3) / 2.6;
        p.setXYZ(k, u * 2.6, p.getY(k) * (1 - u * 0.8) - u * u * 1.4, 0);
      }
      geo.computeVertexNormals();
      const f = new THREE.Mesh(geo, M.palmLeaf);
      f.position.copy(top);
      f.rotation.set(0.25 * ((i % 3) - 1), -a, 0.35 - (i % 2) * 0.25);
      add(f, g, { cast: true, receive: false });
    }
  }

  // En las maquetas seccionadas se ocultan los objetos que quedan por encima del corte (cuadros, pantallas).
  if (cut) {
    const bb = new THREE.Box3();
    root.updateMatrixWorld(true);
    furn.traverse((o) => { if (o.isMesh && bb.setFromObject(o).min.y > cut + 0.02) o.visible = false; });
  }
  for (const z of zones) z.labelPos = z.center.clone().setY(wallH + 0.5);
  const ready = Promise.all(pending);
  return { root, zones, M, deskPositions, lights, ready, P, bounds: { W, D, H, wallH } };
}

// ------------------------------------------------------------------ texturas
function textureKit(pending, enabled) {
  const hasDOM = typeof document !== 'undefined';
  const canvasTex = (w, h, draw, { srgb = true, repeat = [1, 1] } = {}) => {
    if (!hasDOM) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  const kit = { leafGeo: leafGeometry() };
  if (!enabled || !hasDOM) {
    Object.assign(kit, { tiledMaterial: (m) => m, logoMaterial: () => new THREE.MeshStandardMaterial({ color: 0x222222 }), screenMaterial: () => new THREE.MeshStandardMaterial({ color: 0x111111 }), onAirMaterial: () => new THREE.MeshStandardMaterial({ color: 0xC8401E }), artMaterial: () => new THREE.MeshStandardMaterial({ color: 0xE9E3D8 }), whiteboardMaterial: () => new THREE.MeshStandardMaterial({ color: 0xFAFAF7 }), facadeMaterial: () => new THREE.MeshStandardMaterial({ color: 0xE8E1D5 }) });
    return kit;
  }
  kit.cement = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(190,182,170,${0.035 + rnd() * 0.05})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 60 + rnd() * 200, 40 + rnd() * 140, rnd() * 3, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 26000; i++) { const v = 205 + Math.floor(rnd() * 50); g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.25)`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
  });
  kit.oak = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) { const v = 236 + Math.sin(y * 0.05 + Math.sin(y * 0.011) * 5) * 9 + rnd() * 5; g.fillStyle = `rgb(${v},${v - 7},${v - 16})`; g.fillRect(0, y, w, 1); }
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(140,98,60,${0.04 + rnd() * 0.08})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); const y0 = rnd() * h; g.moveTo(0, y0); for (let x = 0; x <= w; x += 12) g.lineTo(x, y0 + Math.sin(x * 0.012 + i) * 8 + Math.sin(x * 0.05) * 2); g.stroke(); }
  });
  kit.planks = canvasTex(1024, 1024, (g, w, h) => {
    const ph = h / 8;
    for (let p = 0; p < 8; p++) {
      const tone = 228 + Math.floor(rnd() * 22);
      for (let y = 0; y < ph; y++) { const v = tone + Math.sin((p * ph + y) * 0.21) * 4 + rnd() * 4; g.fillStyle = `rgb(${v},${v - 9},${v - 22})`; g.fillRect(0, p * ph + y, w, 1); }
      g.fillStyle = 'rgba(120,90,60,0.35)'; g.fillRect(0, p * ph, w, 2);
      const off = rnd() * w; g.fillRect(off, p * ph, 2, ph);
    }
  });
  kit.tile = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { const v = 228 + Math.floor(rnd() * 27); g.fillStyle = `rgba(${v},${v},${v - 4},0.4)`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.strokeStyle = 'rgba(170,160,148,0.7)'; g.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke(); }
  });
  kit.weave = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const v = 110 + ((x / 4 + y / 4) % 2) * 40 + rnd() * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 2); }
  }, { srgb: false, repeat: [6, 6] });
  kit.plaster = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 100 + Math.floor(rnd() * 60); g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3); }
  }, { srgb: false, repeat: [3, 3] });
  kit.rugTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30000; i++) { const v = 215 + Math.floor(rnd() * 40); g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.5)`; g.fillRect(rnd() * w, rnd() * h, 1, 3); }
    g.strokeStyle = 'rgba(120,100,80,0.25)'; g.lineWidth = 10; g.strokeRect(30, 30, w - 60, h - 60);
  });

  kit.tiledMaterial = (base, sw, sd, scale = 2.5) => {
    if (!base.map) return base;
    const m = base.clone();
    m.map = base.map.clone();
    m.map.repeat.set(Math.max(1, sw / scale), Math.max(1, sd / scale));
    m.map.needsUpdate = true;
    return m;
  };

  const logoCache = {};
  kit.logoMaterial = (variant, { emissive = 0 } = {}) => {
    const key = `${variant}:${emissive}`;
    if (logoCache[key]) return logoCache[key];
    const CW = 2048; const CH = Math.round(CW / LOGO_ASPECT.horizontal);
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const ctx = c.getContext('2d');
    // El logotipo se dibuja centrado y sin deformar, sea cual sea su proporción.
    pending.push(loadImage(`/brand/frame-logo-${variant}.svg`).then((img) => {
      const ar = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || LOGO_ASPECT.horizontal;
      let w = CW; let h = w / ar;
      if (h > CH) { h = CH; w = h * ar; }
      ctx.clearRect(0, 0, CW, CH);
      ctx.drawImage(img, (CW - w) / 2, (CH - h) / 2, w, h);
      t.needsUpdate = true;
    }).catch(() => {}));
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5, ...(emissive ? { emissive: 0xFFF1DE, emissiveMap: t, emissiveIntensity: emissive } : {}) });
    logoCache[key] = m;
    return m;
  };
  kit.screenMaterial = (label) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1280, 720); grd.addColorStop(0, '#1C1A18'); grd.addColorStop(1, '#0F0E0D');
    g.fillStyle = grd; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#F3EFE7'; g.font = '500 30px "Plex Mono", monospace'; g.fillText((label || '').toUpperCase(), 80, 640);
    g.fillStyle = '#F0643A'; g.beginPath(); g.arc(1180, 628, 9, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    pending.push(loadImage('/brand/frame-logo-light.svg').then((img) => {
      const ar = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || LOGO_ASPECT.horizontal;
      const w = 620; const h = w / ar;
      g.drawImage(img, (1280 - w) / 2, 320 - h / 2, w, h); t.needsUpdate = true;
    }).catch(() => {}));
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.25 });
  };
  kit.onAirMaterial = () => {
    const t = canvasTex(512, 136, (g, w, h) => {
      g.fillStyle = '#2A0B05'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#FF4A1C'; g.font = 'bold 92px "Archivo", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ON AIR', w / 2, h / 2 + 4);
    });
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 2.2 });
  };
  kit.artMaterial = (idx) => {
    const t = canvasTex(600, 800, (g, w, h) => drawArt(g, w, h, idx));
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  };
  kit.whiteboardMaterial = () => {
    const t = canvasTex(1024, 720, (g, w, h) => {
      g.fillStyle = '#FBFAF7'; g.fillRect(0, 0, w, h);
      g.lineWidth = 5; g.lineCap = 'round';
      g.strokeStyle = '#2B3A55'; g.beginPath(); g.moveTo(90, 520); g.bezierCurveTo(260, 300, 420, 470, 620, 220); g.lineTo(880, 160); g.stroke();
      g.strokeStyle = '#C8401E'; for (let i = 0; i < 4; i++) { g.strokeRect(120 + i * 200, 580, 130, 70); }
      g.fillStyle = '#2B3A55'; g.font = 'italic 54px "Instrument Serif", serif'; g.fillText('Q1 · lanzamiento', 110, 120);
      g.font = '40px sans-serif'; g.fillText('→ estudio + comunidad', 130, 200);
    });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.22 });
  };
  kit.facadeMaterial = (w, h) => {
    const t = canvasTex(2048, 512, (g, cw, ch) => {
      g.fillStyle = '#EDE5D8'; g.fillRect(0, 0, cw, ch);
      const cols = 46; const rows = 4;
      for (let r2 = 0; r2 < rows; r2++) for (let c2 = 0; c2 < cols; c2++) {
        const x = 12 + c2 * (cw / cols); const y = 30 + r2 * (ch / rows);
        g.fillStyle = (c2 * 7 + r2 * 3) % 5 === 0 ? '#B9C4C9' : '#A6B3BA'; g.fillRect(x, y, cw / cols - 18, ch / rows - 50);
        g.fillStyle = 'rgba(80,70,60,0.35)'; g.fillRect(x - 4, y + ch / rows - 52, cw / cols - 10, 6);
      }
      g.fillStyle = '#D9CDBB'; g.fillRect(0, ch - 60, cw, 60);
    });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  };
  return kit;
}

function leafGeometry() {
  // Hoja lanceolada ligeramente curvada (longitud 0.24 en el eje x).
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.06, 0.05, 0.16, 0.06, 0.24, 0);
  shape.bezierCurveTo(0.16, -0.06, 0.06, -0.05, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, -x * x * 1.6 + Math.abs(p.getY(i)) * 0.4); }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function drawArt(g, w, h, idx) {
  const paper = '#EFE9DF';
  const ink = '#1E1C1A';
  const rec = '#C8401E';
  const sand = '#CDBFA8';
  g.fillStyle = paper; g.fillRect(0, 0, w, h);
  g.save();
  switch (idx % 6) {
    case 0: // sol sobre el horizonte (salinas)
      g.fillStyle = '#E7C9B9'; g.fillRect(60, 420, w - 120, 260);
      g.fillStyle = rec; g.beginPath(); g.arc(w / 2, 420, 150, Math.PI, 0); g.fill();
      g.strokeStyle = ink; g.lineWidth = 2; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(60, 450 + i * 28); g.lineTo(w - 60, 450 + i * 28); g.stroke(); }
      break;
    case 1: // planta arquitectónica
      g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(80, 120, w - 160, h - 280);
      g.lineWidth = 1.5; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(80 + i * (w - 160) / 5, 120); g.lineTo(80 + i * (w - 160) / 5, 300); g.stroke(); }
      g.fillStyle = rec; g.fillRect(80 + (w - 160) * 0.6, 420, 120, 120);
      g.beginPath(); g.arc(200, 520, 60, 0, Math.PI / 2); g.stroke();
      break;
    case 2: // composición de bloques
      g.fillStyle = sand; g.fillRect(80, 100, 260, 380);
      g.fillStyle = ink; g.fillRect(240, 300, 280, 300);
      g.fillStyle = rec; g.beginPath(); g.arc(170, 600, 70, 0, Math.PI * 2); g.fill();
      break;
    case 3: // ondas de sonido
      g.strokeStyle = ink; g.lineWidth = 3;
      for (let i = 0; i < 22; i++) { const x = 90 + i * 20; const a = 40 + Math.abs(Math.sin(i * 0.7)) * 220; g.beginPath(); g.moveTo(x, h / 2 - a); g.lineTo(x, h / 2 + a); g.stroke(); }
      g.fillStyle = rec; g.beginPath(); g.arc(w / 2, 140, 16, 0, Math.PI * 2); g.fill();
      break;
    case 4: // palmera minimal
      g.strokeStyle = ink; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, h - 120); g.quadraticCurveTo(w / 2 + 40, 400, w / 2 + 10, 260); g.stroke();
      g.lineWidth = 3; for (let i = 0; i < 9; i++) { const a = -Math.PI + (i / 8) * Math.PI; g.beginPath(); g.moveTo(w / 2 + 10, 260); g.quadraticCurveTo(w / 2 + 10 + Math.cos(a) * 120, 260 + Math.sin(a) * 120 - 40, w / 2 + 10 + Math.cos(a) * 200, 300 + Math.sin(a) * 60); g.stroke(); }
      g.fillStyle = rec; g.beginPath(); g.arc(160, 160, 50, 0, Math.PI * 2); g.fill();
      break;
    default: // retícula
      for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { g.fillStyle = (x + y) % 5 === 0 ? rec : (x * y) % 3 === 0 ? ink : sand; g.beginPath(); g.arc(100 + x * 80, 120 + y * 75, 18, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
  g.fillStyle = ink; g.font = '14px monospace'; g.fillText(`FRAME · ${String(idx + 1).padStart(2, '0')}`, 60, h - 50);
}

// ------------------------------------------------------------------ materiales
function makeMaterials(style, T, opts) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  if (style === 'clay' || style === 'glass') {
    const base = style === 'glass' ? 0xEFEBE4 : 0xF2EEE7;
    const c = (hex, r = 0.9) => S({ color: hex, roughness: r });
    const glass = style === 'glass'
      ? new THREE.MeshPhysicalMaterial({ color: 0xF6F3EE, roughness: 0.12, metalness: 0, transmission: opts.transmission === false ? 0 : 0.92, thickness: 0.35, ior: 1.45, transparent: true, opacity: opts.transmission === false ? 0.28 : 1, envMapIntensity: 1.2, side: THREE.DoubleSide })
      : new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, roughness: 0.05, transmission: 0.95, thickness: 0.02, transparent: true });
    const wallGlass = style === 'glass'
      ? new THREE.MeshPhysicalMaterial({ color: 0xF4F1EB, roughness: 0.18, transmission: opts.transmission === false ? 0 : 0.9, thickness: 0.6, ior: 1.5, transparent: true, opacity: opts.transmission === false ? 0.42 : 1, envMapIntensity: 1.3 })
      : null;
    const w = wallGlass || c(base, 0.95);
    const rec = S({ color: 0xC8401E, roughness: 0.9 });
    const m = {
      floor: c(0xE7E2D9, 0.95), floorWood: c(0xE2DBCF, 0.9), floorTile: c(0xE9E5DD, 0.9), floorStudio: c(0xDCD5CA, 0.9),
      wall: w, wallExt: wallGlass || c(0xE9E4DB, 0.95), wallFelt: w, ceiling: c(base), slatBack: c(0xD8D0C4), slat: c(0xE2DACD),
      oak: c(0xE4DDD1, 0.8), wood: c(0xE4DDD1, 0.8), walnut: c(0xD8D0C2, 0.85), woodDark: c(0xD8D0C2, 0.85), doorWood: c(0xE4DDD1), black: c(0x6E6A64, 0.7), chrome: c(0x8D8984, 0.5), alu: c(0xD6D1C8, 0.6), brass: c(0xD6CDBE, 0.6),
      fabric: c(0xD9D2C6, 1), fabricOat: c(0xE6DFD3, 1), fabricWarm: rec, fabricRust: rec, leather: c(0xD5CBBD, 0.8), linen: c(0xE8E2D8, 1),
      felt: c(0xDCD5C9, 1), feltRec: rec, feltOat: c(0xE6DFD3, 1), feltLight: c(0xE4DED3, 1),
      shellWhite: c(0xF0ECE5, 0.6), shellRec: rec,
      leaf: c(0xCFD5C6, 0.9), leaf2: c(0xC5CCBB, 0.9), trunk: c(0xB8B0A3, 0.9), pot: c(0xE3DCD0, 0.9), screen: c(0x77736C, 0.4), stone: c(0xEAE5DC, 0.6),
      rug: c(0xE1D9CB, 1), rugStudio: c(0xD3CABC, 1), cabinet: c(0xEDE8E0, 0.85), whiteboard: c(0xFAF8F4, 0.4), micBody: c(0x5E5A55, 0.5), foam: c(0x5E5A55, 1),
      softbox: c(0xFFFFFF, 0.5), lamp: S({ color: 0xFFFFFF, emissive: 0xFFE2B8, emissiveIntensity: 1 }), lens: c(0x444444, 0.2),
      book1: c(0xD8D0C3), book2: c(0xC9C1B3), book3: c(0xE2DBD0), book4: c(0xD0C7B8),
      glass,
    };
    const fallback = c(0xE4DED3, 0.9);
    return new Proxy(m, { get: (t, k) => (k in t ? t[k] : fallback) });
  }
  const tex = T;
  const fab = (color, r = 1) => S({ color, roughness: r, bumpMap: tex.weave || null, bumpScale: 0.6 });
  return {
    floor: S({ color: 0xC8C1B5, roughness: 0.5, map: tex.cement || null }),
    floorWood: S({ color: 0xD2B694, roughness: 0.48, map: tex.planks || null }),
    floorTile: S({ color: 0xDCD6CC, roughness: 0.42, map: tex.tile || null }),
    floorStudio: S({ color: 0x45403B, roughness: 0.75, map: tex.cement || null }),
    wall: S({ color: 0xEAE4DA, roughness: 0.92, bumpMap: tex.plaster || null, bumpScale: 0.25 }),
    wallExt: S({ color: 0xEFE9E0, roughness: 0.95, bumpMap: tex.plaster || null, bumpScale: 0.25 }),
    wallFelt: S({ color: 0x4A4541, roughness: 1, bumpMap: tex.weave || null, bumpScale: 0.6 }),
    ceiling: S({ color: 0xE6E1D8, roughness: 0.96 }),
    slatBack: S({ color: 0x1C1A18, roughness: 1, bumpMap: tex.weave || null, bumpScale: 0.6 }),
    studioLining: S({ color: 0x34302C, roughness: 1, bumpMap: tex.weave || null, bumpScale: 0.6 }),
    slat: S({ color: 0x9A6B43, roughness: 0.55, map: tex.oak || null }),
    oak: S({ color: 0xD6B48C, roughness: 0.5, map: tex.oak || null }),
    wood: S({ color: 0xC69B6D, roughness: 0.5, map: tex.oak || null }),
    walnut: S({ color: 0x6E4A30, roughness: 0.45, map: tex.oak || null }),
    woodDark: S({ color: 0x5E4330, roughness: 0.55, map: tex.oak || null }),
    doorWood: S({ color: 0xCFAE86, roughness: 0.55, map: tex.oak || null }),
    black: S({ color: 0x1C1B1A, roughness: 0.42, metalness: 0.35 }),
    chrome: S({ color: 0xC9C6C1, roughness: 0.22, metalness: 0.9 }),
    alu: S({ color: 0xBDBAB5, roughness: 0.32, metalness: 0.85 }),
    brass: S({ color: 0xB08A52, roughness: 0.32, metalness: 0.9 }),
    fabric: fab(0x3B3733),
    fabricOat: fab(0xCBBFAD),
    fabricWarm: fab(0xB0532F, 0.95),
    fabricRust: fab(0x8E3F24, 0.95),
    leather: S({ color: 0x7D4F31, roughness: 0.48 }),
    linen: fab(0xDCD1C0),
    felt: fab(0x3E3935),
    feltRec: fab(0xA8421F),
    feltOat: fab(0xBFB29F),
    feltLight: fab(0xC2B8AA),
    shellWhite: S({ color: 0xEDE7DD, roughness: 0.4, side: THREE.DoubleSide }),
    shellRec: S({ color: 0xB9471F, roughness: 0.42, side: THREE.DoubleSide }),
    leaf: S({ color: 0x3F6237, roughness: 0.55, side: THREE.DoubleSide }),
    leaf2: S({ color: 0x5E8247, roughness: 0.55, side: THREE.DoubleSide }),
    trunk: S({ color: 0x5A4634, roughness: 0.9 }),
    pot: S({ color: 0xB98E6E, roughness: 0.85 }),
    ceramic: S({ color: 0xF2EEE8, roughness: 0.3 }),
    ceramicDark: S({ color: 0x2C2A28, roughness: 0.3 }),
    ceramicRec: S({ color: 0xC24A23, roughness: 0.32 }),
    glassCup: new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, roughness: 0.05, transmission: 0.9, thickness: 0.05, transparent: true }),
    paperBook: S({ color: 0x2E2B28, roughness: 0.7 }),
    paper: S({ color: 0xFAFAF8, roughness: 0.8 }),
    screen: S({ color: 0x0E0E10, roughness: 0.18, metalness: 0.2 }),
    screenOn: S({ color: 0x14161A, emissive: 0x2A3442, emissiveIntensity: 0.9, roughness: 0.2 }),
    screenGlow: S({ color: 0x15171B, emissive: 0x3A4555, emissiveIntensity: 0.7, roughness: 0.2 }),
    screenWave: S({ color: 0x14161A, emissive: 0x7A2C14, emissiveIntensity: 0.8, roughness: 0.2 }),
    stone: S({ color: 0xE9E4DB, roughness: 0.28 }),
    rug: S({ color: 0xCBBDA8, roughness: 1, map: tex.rugTex || null }),
    rugStudio: S({ color: 0x3F302A, roughness: 1, map: tex.rugTex || null }),
    cabinet: S({ color: 0xE9E4DA, roughness: 0.55 }),
    groove: S({ color: 0x8C857C, roughness: 0.8 }),
    sink: S({ color: 0x8E8B86, roughness: 0.25, metalness: 0.8 }),
    whiteboard: S({ color: 0xFAFAF7, roughness: 0.25 }),
    locker: S({ color: 0xDDD5C8, roughness: 0.55 }),
    lockerRec: S({ color: 0xB5502C, roughness: 0.55 }),
    printer: S({ color: 0x2E2D2C, roughness: 0.5 }),
    micBody: S({ color: 0x232325, roughness: 0.35, metalness: 0.6 }),
    foam: S({ color: 0x1A1A1B, roughness: 1, bumpMap: tex.weave || null, bumpScale: 1 }),
    mixer: S({ color: 0x1F1F21, roughness: 0.5 }),
    faderCap: S({ color: 0xE8E4DE, roughness: 0.5 }),
    buttonRec: S({ color: 0xFF3B12, emissive: 0xFF3B12, emissiveIntensity: 1.6 }),
    speakerCone: S({ color: 0x3A3836, roughness: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.4, clearcoat: 1 }),
    softbox: S({ color: 0xFFFFFF, emissive: 0xFFF2DD, emissiveIntensity: 0.55 }),
    ringLight: S({ color: 0xFFFFFF, emissive: 0xFFF6EA, emissiveIntensity: 0.9 }),
    lamp: S({ color: 0xFFFFFF, emissive: 0xFFD9A6, emissiveIntensity: 1.2 }),
    bulb: S({ color: 0xFFFFFF, emissive: 0xFFE2B8, emissiveIntensity: 3 }),
    lampShade: S({ color: 0xEDE3D2, emissive: 0xFFD8A8, emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }),
    ledStrip: S({ color: 0xFFFFFF, emissive: 0xFFC890, emissiveIntensity: 1.8 }),
    neon: S({ color: 0xFFE9CC, emissive: 0xFFC98A, emissiveIntensity: 1.15, roughness: 0.4 }),
    brandDark: S({ color: 0x141312, roughness: 0.45, metalness: 0.2 }),
    brandLight: S({ color: 0xF3EFE7, roughness: 0.5 }),
    paperRoll: S({ color: 0xD9CCBA, roughness: 0.95 }),
    frost: S({ color: 0xFFFFFF, roughness: 0.6, transparent: true, opacity: 0.55 }),
    book1: S({ color: 0x8E8473, roughness: 0.8 }), book2: S({ color: 0x3E3A35, roughness: 0.8 }), book3: S({ color: 0xB25534, roughness: 0.8 }), book4: S({ color: 0xD8CCB8, roughness: 0.8 }),
    fruitA: S({ color: 0xE8862E, roughness: 0.5 }), fruitB: S({ color: 0x9DB04A, roughness: 0.5 }),
    sidewalk: S({ color: 0xDCD3C4, roughness: 0.85, map: tex.tile || null }),
    asphalt: S({ color: 0x55524E, roughness: 0.95 }),
    paintLine: S({ color: 0xF2EFE8, roughness: 0.8 }),
    palmTrunk: S({ color: 0x8C7457, roughness: 0.95, bumpMap: tex.weave || null, bumpScale: 2 }),
    palmLeaf: S({ color: 0x4E6B3A, roughness: 0.6, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.02, ior: 1.5, transparent: true }),
  };
}

// Cámara a la altura de los ojos en el centro de una zona (vista 360°).
export function eyeCamera(zone, aspect = 1.6) {
  const cam = new THREE.PerspectiveCamera(70, aspect, 0.05, 120);
  cam.position.set(zone.center.x, 1.55, zone.center.z);
  return cam;
}
