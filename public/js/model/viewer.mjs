// Visor interactivo de la maqueta de cristal (página de reservas) con vista 360° por zona.
// La maqueta es una mejora visual: las mismas opciones están siempre disponibles como botones.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFrameScene } from './scene.mjs';

export function createViewer(container, layout, { lang = 'es', onSelect, labels = {} } = {}) {
  const es = lang !== 'en';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 760px)').matches;
  const weak = small || (navigator.hardwareConcurrency || 4) <= 4;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, weak ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !weak;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.className = 'viewer__canvas';
  container.prepend(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ------------------------------------------------------------ maqueta de cristal
  const model = new THREE.Scene();
  model.environment = envTex;
  model.environmentIntensity = 0.9;
  const built = createFrameScene(THREE, layout, { style: 'glass', cut: 1.3, transmission: !weak, quality: weak ? 'low' : 'high' });
  model.add(built.root);
  const sun = new THREE.DirectionalLight(0xFFF3E4, 1.6);
  sun.position.set(-10, 22, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  model.add(sun, new THREE.HemisphereLight(0xFFF6EA, 0xE2D7C8, 0.7));
  // Base sobre la que «flota» la maqueta.
  const base = new THREE.Mesh(new THREE.BoxGeometry(layout.width + 1.2, 0.25, layout.depth + 1.2), new THREE.MeshStandardMaterial({ color: 0xE5DED2, roughness: 0.9 }));
  base.position.y = -0.19;
  base.receiveShadow = true;
  model.add(base);

  // Capas de selección sobre el suelo de cada zona reservable.
  const hl = new Map();
  for (const z of built.zones) {
    if (!z.service) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(z.rect.w - 0.16, 0.02, z.rect.d - 0.16), new THREE.MeshStandardMaterial({ color: 0xC8401E, emissive: 0xC8401E, emissiveIntensity: 0.0, transparent: true, opacity: 0, roughness: 0.6 }));
    m.position.set(z.center.x, 0.012, z.center.z);
    m.userData.zone = z;
    model.add(m);
    hl.set(z.id, m);
  }

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const home = { pos: new THREE.Vector3(14, 24, 25), target: new THREE.Vector3(0.5, 0, 0.8) };
  if (small) home.pos.set(9, 30, 28);
  camera.position.copy(home.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(home.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.enablePan = false;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.35;
  controls.update();
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

  // ---------------------------------------------------------------- etiquetas HTML
  const labelLayer = document.createElement('div');
  labelLayer.className = 'viewer__labels';
  container.appendChild(labelLayer);
  const labelEls = new Map();
  for (const z of built.zones) {
    if (!z.service) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'viewer__label';
    b.dataset.zone = z.id;
    b.innerHTML = `<span class="viewer__dot"></span><span></span>`;
    b.lastChild.textContent = labels[z.id] || z.label[lang] || z.label.es;
    b.addEventListener('click', () => onSelect?.(z.service, z));
    b.addEventListener('mouseenter', () => setHover(z.id));
    b.addEventListener('mouseleave', () => setHover(null));
    b.addEventListener('focus', () => setHover(z.id));
    b.addEventListener('blur', () => setHover(null));
    labelLayer.appendChild(b);
    labelEls.set(z.id, b);
  }

  let hover = null;
  let selected = null;
  function setHover(id) { hover = id; }
  function select(zoneId) {
    selected = zoneId;
    for (const [id, el] of labelEls) el.classList.toggle('is-active', id === zoneId);
  }

  // Selección con el puntero sobre la maqueta.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hlMeshes = [...hl.values()];
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (mode !== 'model') return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hlMeshes, false)[0];
    hover = hit ? hit.object.userData.zone.id : null;
    renderer.domElement.style.cursor = hover ? 'pointer' : 'grab';
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || mode !== 'model') return;
    if (hover) { const z = built.zones.find((x) => x.id === hover); onSelect?.(z.service, z); }
  });

  // ------------------------------------------------------------------ vista 360°
  let mode = 'model';
  let interior = null;
  const eye = new THREE.PerspectiveCamera(72, 1, 0.05, 120);
  let eyeControls = null;
  function ensureInterior() {
    if (interior) return interior;
    const scene = new THREE.Scene();
    scene.environment = envTex;
    scene.environmentIntensity = 0.95;
    scene.background = new THREE.Color(0xFFF8EE);
    const b = createFrameScene(THREE, layout, { style: 'interior', quality: weak ? 'low' : 'high' });
    scene.add(b.root);
    const s2 = new THREE.DirectionalLight(0xFFEFD8, 3.2);
    s2.position.set(-12, 18, 26);
    s2.castShadow = !weak;
    s2.shadow.mapSize.set(2048, 2048);
    Object.assign(s2.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 80 });
    s2.shadow.bias = -0.0004;
    scene.add(s2, new THREE.HemisphereLight(0xFFF3E2, 0xE0D2BE, 0.55));
    for (const l of b.lights.filter((x) => x.type === 'point').slice(0, weak ? 0 : 10)) {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance, 2); p.position.set(l.x, l.y, l.z); scene.add(p);
    }
    interior = { scene, built: b };
    return interior;
  }
  function enter360(zoneId) {
    const it = ensureInterior();
    const z = it.built.zones.find((x) => x.id === zoneId);
    if (!z) return;
    mode = '360';
    container.classList.add('is-360');
    eye.position.set(z.center.x, 1.6, z.center.z);
    eyeControls?.dispose();
    eyeControls = new OrbitControls(eye, renderer.domElement);
    eyeControls.target.set(z.center.x + 0.01, 1.58, z.center.z - 0.6 * 0.01);
    eyeControls.enableZoom = false;
    eyeControls.enablePan = false;
    eyeControls.rotateSpeed = -0.35;
    eyeControls.enableDamping = true;
    eyeControls.update();
    controls.enabled = false;
    resize();
  }
  function exit360() {
    mode = 'model';
    container.classList.remove('is-360');
    eyeControls?.dispose();
    eyeControls = null;
    controls.enabled = true;
  }

  // ------------------------------------------------------------- bucle y tamaño
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    eye.aspect = w / h; eye.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const tmp = new THREE.Vector3();
  let running = true;
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
  io.observe(container);
  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!visible) return;
    if (mode === 'model') {
      controls.update();
      for (const [id, m] of hl) {
        const on = id === selected ? 0.42 : id === hover ? 0.22 : 0;
        m.material.opacity += (on - m.material.opacity) * 0.15;
        m.material.emissiveIntensity = m.material.opacity * 1.2;
      }
      renderer.render(model, camera);
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      for (const z of built.zones) {
        const el = labelEls.get(z.id);
        if (!el) continue;
        tmp.copy(z.labelPos).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        el.classList.toggle('is-hover', z.id === hover);
      }
    } else {
      eyeControls?.update();
      renderer.render(interior.scene, eye);
    }
  }
  requestAnimationFrame(frame);

  return {
    select,
    enter360,
    exit360,
    get mode() { return mode; },
    zones: built.zones,
    dispose() { running = false; ro.disconnect(); io.disconnect(); controls.dispose(); renderer.dispose(); },
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}
