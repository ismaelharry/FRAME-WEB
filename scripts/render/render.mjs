// Renders conceptuales de FRAME a partir de la maqueta 3D (Chromium sin interfaz).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createFrameScene } from '/js/model/scene.mjs';

await document.fonts.load('bold 40px Archivo');
await document.fonts.load('500 20px "Plex Mono"');
await document.fonts.load('italic 40px "Instrument Serif"');
const q = new URLSearchParams(location.search);
const shot = q.get('shot');
const L = await (await fetch('/render/layout.json')).json();
const W = L.width, D = L.depth;
const w2 = (x, y, z) => new THREE.Vector3(x - W / 2, y, z - D / 2);

const SHOTS = {
  hero:            { size: [2400, 1030], fov: 40, pos: w2(7.8, 1.42, 15.2), look: w2(21, 0.82, 10.9), sun: [-0.45, 0.5, 1], env: 0.3, exposure: 1.02 },
  coworking:       { size: [1600, 1200], fov: 56, pos: w2(23.6, 1.55, 7.75), look: w2(12, 0.8, 13.6), sun: [0.35, 0.5, 1], env: 0.36, exposure: 1.08 },
  salas:           { size: [1600, 1200], fov: 62, pos: w2(3.55, 1.5, 7.85), look: w2(1.5, 0.9, 11.6), sun: [-0.3, 0.5, 1], env: 0.32, exposure: 1.04 },
  'salas-rambla':  { size: [1600, 1200], fov: 62, pos: w2(3.0, 1.5, 5.6), look: w2(1.2, 0.95, 0.9), sun: [-0.3, 0.5, 1], env: 0.32, exposure: 1.04 },
  despachos:       { size: [1600, 1200], fov: 64, pos: w2(19.0, 1.55, 5.55), look: w2(17.2, 0.95, 1.1), sun: [-0.3, 0.5, 1], env: 0.32, exposure: 1.04 },
  estudio:         { size: [1600, 2000], fov: 64, pos: w2(10.8, 1.72, 5.7), look: w2(10.5, 1.25, 0.3), sun: [0, 0.6, 1], env: 0.12, exposure: 1.08, studio: true },
  'estudio-set':   { size: [1600, 1200], fov: 60, pos: w2(9.55, 1.42, 4.75), look: w2(11.8, 1.0, 1.6), sun: [0, 0.6, 1], env: 0.12, exposure: 1.08, studio: true },
  comunidad:       { size: [1600, 1200], fov: 60, pos: w2(6.6, 1.5, 15.5), look: w2(0.5, 1.2, 13.9), sun: [-0.5, 0.5, 1], env: 0.3, exposure: 1.02 },
  cocina:          { size: [1600, 1200], fov: 62, pos: w2(6.9, 1.5, 5.7), look: w2(4.8, 1.0, 1.2), sun: [-0.5, 0.5, 1], env: 0.32, exposure: 1.04 },
  plano:           { size: [1800, 1350], ortho: true, style: 'clay', env: 0.55, exposure: 0.92, sun: [-0.55, 0.9, 0.75] },
};
const S = SHOTS[shot];
const scale = Number(q.get('scale')) || 1;
const [cw, ch] = S.size.map((v) => Math.round(v * scale));
const style = S.style || 'interior';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(cw, ch);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Neutral (Khronos PBR Neutral): conserva el color de los materiales y comprime las luces altas sin velo gris.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = S.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = S.env;
scene.background = new THREE.Color(style === 'clay' ? 0xF5F1EA : 0xE9ECEC);

const built = createFrameScene(THREE, L, { style, cut: style === 'clay' ? 1.25 : null });
scene.add(built.root);
await built.ready;

// Luz natural: sol bajo de media tarde que entra por la fachada y cielo difuso desde los ventanales.
// El relleno ambiental es bajo para que haya contraste y sombras suaves (sin velo ni deslumbramiento).
const sun = new THREE.DirectionalLight(0xFFEBD2, style === 'clay' ? 1.7 : 2.4);
sun.position.copy(new THREE.Vector3(...S.sun).normalize().multiplyScalar(30));
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
sun.shadow.blurSamples = 16;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xE6EDF2, 0xCDBBA4, style === 'clay' ? 0.35 : (S.studio ? 0.05 : 0.14)));
if (style === 'interior' && !S.studio) {
  // Cada ventanal actúa como una fuente de luz de cielo, amplia y difusa.
  RectAreaLightUniformsLib.init();
  const wins = [[0.6, L.entrance.x - 0.3], [L.entrance.x, L.entrance.x + L.entrance.w], [L.entrance.x + L.entrance.w + 0.3, 6.7]];
  for (let x = 7.3; x < W - 0.6; x += 3.1) wins.push([x, Math.min(x + 2.7, W - 0.6)]);
  for (const [a, b] of wins) {
    const rl = new THREE.RectAreaLight(0xE4ECF3, 2.1, b - a, 2.5);
    rl.position.copy(w2((a + b) / 2, 1.65, D - 0.25));
    rl.lookAt(w2((a + b) / 2, 1.5, D - 5));
    scene.add(rl);
  }
}

if (style === 'interior') {
  for (const l of built.lights) {
    if (l.type === 'spot') {
      const sp = new THREE.SpotLight(l.color, S.studio ? l.intensity : l.intensity * 0.4, 9, 0.7, 0.7, 1.4);
      sp.position.set(l.x, l.y, l.z);
      sp.target.position.set(l.tx, l.ty, l.tz);
      sp.castShadow = true;
      sp.shadow.mapSize.set(1024, 1024);
      sp.shadow.bias = -0.0005;
      scene.add(sp, sp.target);
    } else {
      const pl = new THREE.PointLight(l.color, l.intensity * (S.studio ? 1.1 : 0.22), l.distance, 2);
      pl.position.set(l.x, l.y, l.z);
      scene.add(pl);
    }
  }
  if (S.studio) {
    const fill = new THREE.PointLight(0xFFD2A0, 1.6, 6, 2);
    fill.position.copy(w2(12.2, 2.5, 3.6));
    scene.add(fill);
  }
}

let camera;
if (S.ortho) {
  const aspect = cw / ch;
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(15, 24, 22);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const inv = camera.matrixWorldInverse;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) for (const y of [0, 1.4]) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const m = 0.6;
  let w = maxX - minX + 2 * m, h = maxY - minY + 2 * m;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  Object.assign(camera, { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 });
  camera.updateProjectionMatrix();
} else {
  camera = new THREE.PerspectiveCamera(S.fov, cw / ch, 0.05, 140);
  camera.position.copy(S.pos);
  camera.lookAt(S.look);
}

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, cw, ch);
ao.blendIntensity = style === 'clay' ? 0.9 : 1.0;
ao.updateGtaoMaterial({ radius: style === 'clay' ? 0.6 : 0.5, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 16 });
ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
composer.addPass(ao);
if (style === 'interior') composer.addPass(new UnrealBloomPass(new THREE.Vector2(cw, ch), S.studio ? 0.1 : 0.03, S.studio ? 0.22 : 0.35, S.studio ? 1.8 : 4.0));
composer.addPass(new OutputPass());
if (style === 'interior') {
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 3.7 }, uVig: { value: S.studio ? 0.4 : 0.22 }, uGrain: { value: 0.02 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; uniform float uGrain; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - uVig * dot(d, d) * 1.6;
        c.rgb *= v; c.rgb += (h(vUv * 1000.0) - 0.5) * uGrain; c.rgb = mix(c.rgb, c.rgb * vec3(1.01, 1.0, 0.985), 0.6); gl_FragColor = c; }`,
  }));
}
composer.setSize(cw, ch);
composer.render();
await new Promise((r) => setTimeout(r, 50));
composer.render();
window.__image = renderer.domElement.toDataURL('image/webp', 0.86);
window.__done = true;
