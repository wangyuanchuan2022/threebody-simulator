import * as THREE from 'three';
import { createSystem, advance, STEP, clamp, center, localSunDirections, observerFrame, energy, classifyEra, environment } from './physics.mjs';
import { vertexShader, fragmentShader } from './shaders.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const wallpaperHost = params.has('wallpaper') || window.__THREEBODY_WALLPAPER__ === true;
$('auto-pan').checked = wallpaperHost;
let manualViewUntil = 0, panTime = 0;
function holdAutoPan() { manualViewUntil = performance.now() + 15000; }
const world = $('world');
const renderer = new THREE.WebGLRenderer({ canvas: world, antialias: false, powerPreference: 'high-performance' });
// Sky writes display-ready sRGB itself; standard materials get the sRGB encode.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.Camera();
// Quality ladder drives shader LOD defines and the pixel-ratio cap: the heavy
// atmosphere march scales down with it. Smooth is the default so the page stays
// fluid on laptops; raise it when the GPU has headroom.
const LOD = {
  low: { defines: { MARCH_STEPS: 6, SHADOW_STEPS: 2, OCTAVES: 3 }, ratio: 1 },
  mid: { defines: { MARCH_STEPS: 8, SHADOW_STEPS: 3, OCTAVES: 4 }, ratio: 1 },
  high: { defines: { MARCH_STEPS: 10, SHADOW_STEPS: 3, OCTAVES: 5 }, ratio: 1.25 },
  ultra: { defines: { MARCH_STEPS: 12, SHADOW_STEPS: 4, OCTAVES: 5 }, ratio: 1.5 }
};
const lodFor = () => LOD[$('quality').value] || LOD.mid;
// Adaptive resolution: when the GPU is not the bottleneck the frame rate stalls
// for other reasons, so instead of guessing we measure and trade pixels for
// frames inside a dead band (down under 50 fps, up above 58 fps).
const RENDER = { scale: 1, min: .6 };
const effectiveRatio = () => Math.min(devicePixelRatio, lodFor().ratio) * ($('autoRes').checked ? RENDER.scale : 1);
const uniforms = {
  resolution: { value: new THREE.Vector2() },
  suns: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
  sunColors: { value: [new THREE.Vector3(1, .94, .83), new THREE.Vector3(1, .78, .58), new THREE.Vector3(.88, .94, 1)] },
  powers: { value: [1, 1, 1] }, radii: { value: [.005, .005, .005] },
  clock: { value: 0 }, weatherClock: { value: 0 }, yaw: { value: 0 }, pitch: { value: .08 }, fov: { value: 65 * Math.PI / 180 },
  proceduralStars: { value: 1 },
  exposure: { value: 1 }, cloudCover: { value: .42 }, temperature: { value: 288.15 }, quality: { value: 1 },
  terrainMesh: { value: 0 },
  distantMountains: { value: null }, distantMountainsReady: { value: 0 }
};
// Embedded alpha panorama: rotates with the world, below the real terrain pass.
// Keep the fallback sky while the image decodes (also works from file://).
if (window.DISTANT_MOUNTAINS_URL) {
  new THREE.TextureLoader().load(window.DISTANT_MOUNTAINS_URL, texture => {
    texture.colorSpace = THREE.NoColorSpace; // shader converts source sRGB explicitly
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    uniforms.distantMountains.value = texture;
    uniforms.distantMountainsReady.value = 1;
  }, undefined, () => console.warn('Distant mountain texture unavailable; using terrain only.'));
}
const skyMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines: { ...LOD.low.defines }, depthTest: false, depthWrite: false });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial));

// World scene: real-perspective pass that hosts terrain meshes. Its camera is
// slaved to the sky shader's view angles so both passes share one gaze.
const worldScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(65, 1, .5, 90000);
viewCamera.position.set(0, 18, 0); // same eye height the atmosphere assumes
worldScene.fog = new THREE.Fog(0xb9c3c9, 2500, 26000);
const sunLights = [0, 1, 2].map(() => { const l = new THREE.DirectionalLight(0xffffff, 1); worldScene.add(l); return l; });
worldScene.add(new THREE.AmbientLight(0x2e3f49, .8));
const TERRAIN = { span: 14000, waterline: 0 }; // placement knobs, meters-ish
// Real stars (catalogue built by tools/make-starfield.py): one point sprite per
// star, placed on the celestial sphere, sized to a couple of pixels and re-oriented
// every frame so the whole sky turns with the planet's spin.
function starColor(bv) {
  const t = clamp((bv + .4) / 2.4, 0, 1);
  return [1 - .35 * t, .86 - .14 * t, 1 - .45 * t];   // blue-white -> warm orange
}
let starPoints = null;
const STAR_RADIUS = 20000;
if (window.STARFIELD_CATALOG && window.STARFIELD_CATALOG.stars) {
  const stars = window.STARFIELD_CATALOG.stars;
  const position = new Float32Array(stars.length * 3);
  const color = new Float32Array(stars.length * 3);
  const size = new Float32Array(stars.length);
  stars.forEach(([ra, dec, mag, bv], i) => {
    const r = ra * Math.PI / 180, d = dec * Math.PI / 180;
    position[i * 3] = Math.cos(d) * Math.cos(r) * STAR_RADIUS;
    position[i * 3 + 1] = Math.sin(d) * STAR_RADIUS;
    position[i * 3 + 2] = Math.cos(d) * Math.sin(r) * STAR_RADIUS;
    const c = starColor(bv);
    color[i * 3] = c[0]; color[i * 3 + 1] = c[1]; color[i * 3 + 2] = c[2];
    size[i] = clamp(1.05 + (4.0 - mag) * .5, 1, 3.4);   // light points, never discs
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('starColor', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: { nightSky: { value: 1 }, pixelRatio: { value: 1 }, distantMountains: uniforms.distantMountains, distantMountainsReady: uniforms.distantMountainsReady },
    vertexShader: 'attribute float size;attribute vec3 starColor;varying vec3 vColor;varying vec3 localDirection;uniform float pixelRatio;'
      + 'void main(){vColor=starColor;vec4 mv=modelViewMatrix*vec4(position,1.0);'
      + 'localDirection=(modelMatrix*vec4(position,0.0)).xyz;'
      + 'gl_PointSize=max(1.0,size*pixelRatio);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vColor;varying vec3 localDirection;uniform float nightSky;uniform sampler2D distantMountains;uniform float distantMountainsReady;'
      + 'void main(){vec2 d=gl_PointCoord-vec2(0.5);float r2=dot(d,d);if(r2>0.25)discard;'
      + 'float elevation=atan(localDirection.y,length(localDirection.xz));float cover=0.0;'
      + 'if(distantMountainsReady>.5 && elevation>-.025 && elevation<.30){float angle=atan(localDirection.z,localDirection.x);'
      + 'float u=1.0-abs(2.0*fract(angle/3.14159265359+.5)-1.0);cover=texture2D(distantMountains,vec2(u,(elevation+.025)/.325)).a*smoothstep(-.025,.006,elevation);}'
      + 'float a=exp(-r2*14.0);gl_FragColor=vec4(vColor*a*nightSky*(1.0-cover),1.0);}',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
  starPoints = new THREE.Points(geometry, starMaterial);
  starPoints.frustumCulled = false;
  starPoints.matrixAutoUpdate = false;
  worldScene.add(starPoints);
  uniforms.proceduralStars.value = 0;      // real catalogue wins over the fallback
}
let terrainReady = false;
// Elevation/slope palette: STL terrains carry no material, so colour the mesh.
function colorizeTerrain(geometry) {
  const pos = geometry.attributes.position, nrm = geometry.attributes.normal;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const h0 = bb.min.y, span = Math.max(1e-6, bb.max.y - h0);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), low = new THREE.Color('#41503a'), rock = new THREE.Color('#6f6862');
  const snow = new THREE.Color('#e9eff3'), wet = new THREE.Color('#2b3a35');
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - h0) / span;
    const slope = 1 - Math.max(0, nrm ? nrm.getY(i) : 1);
    c.copy(low).lerp(rock, clamp(t * 1.7 - .15, 0, 1));
    c.lerp(snow, clamp((t - .6) * 3.4, 0, 1) * (1 - slope * .5));
    c.lerp(rock, clamp(slope * 1.3, 0, .85));
    c.lerp(wet, clamp(1 - t * 7, 0, 1) * .75);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
function installTerrain(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.scale.setScalar(TERRAIN.span / Math.max(size.x, size.z, 1));
  // PBR is wasted on matte terrain and costs real frame time: keep the map, drop
  // the BRDF. Vertex colours (STL) and textures (GLB) both survive.
  root.traverse(node => {
    if (!node.isMesh) return;
    const src = node.material;
    node.material = new THREE.MeshLambertMaterial({
      map: src && src.map ? src.map : null,
      color: src && src.color ? src.color.clone() : new THREE.Color(0xffffff),
      vertexColors: !!(src && src.vertexColors) || !!node.geometry.attributes.color,
      side: THREE.FrontSide
    });
    if (src && src.map) node.material.map.colorSpace = THREE.SRGBColorSpace;
  });
  const box2 = new THREE.Box3().setFromObject(root);
  const c2 = box2.getCenter(new THREE.Vector3());
  root.position.set(-c2.x, TERRAIN.waterline - box2.min.y, -c2.z);
  root.updateMatrixWorld(true);
  // Stand the observer on the ground: shift so the surface under the camera sits
  // at the waterline, letting the sea (sky pass) meet the terrain naturally.
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1e6, 0), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(root, true);
  if (hits.length) root.position.y += TERRAIN.waterline - hits[0].point.y;
  worldScene.add(root);
  terrainReady = true;
  uniforms.terrainMesh.value = 1;
}
if (window.THREE_LOADERS && window.TERRAIN_MODEL_B64) {
  try {
    const bytes = Uint8Array.from(atob(window.TERRAIN_MODEL_B64), c => c.charCodeAt(0));
    if (window.TERRAIN_MODEL_KIND === 'stl') {
      const geometry = new window.THREE_LOADERS.STLLoader().parse(bytes.buffer);
      geometry.rotateX(-Math.PI / 2); // Terrain2STL exports Z-up solids
      geometry.computeVertexNormals();
      colorizeTerrain(geometry);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 });
      installTerrain(new THREE.Mesh(geometry, material));
    } else {
      new window.THREE_LOADERS.GLTFLoader().parse(bytes.buffer, '', gltf => installTerrain(gltf.scene), err => console.error('terrain', err));
    }
  } catch (err) { console.error('terrain', err); }
}

const mapRenderer = new THREE.WebGLRenderer({ canvas: $('map'), antialias: true, alpha: true, powerPreference: 'high-performance' });
mapRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const mapScene = new THREE.Scene();
const mapCamera = new THREE.PerspectiveCamera(42, 274 / 219, .01, 1000);
const grid = new THREE.GridHelper(12, 12, 0x3a514e, 0x243635);
grid.material.transparent = true; grid.material.opacity = .35;
mapScene.add(grid);
const meshes = [], trails = [], histories = Array.from({ length: 4 }, () => []);
const colors = ['#ffd6a1', '#ffa778', '#d0e4ff', '#78e4cc'];
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: colors[i] }));
  mapScene.add(mesh); meshes.push(mesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
  geometry.setDrawRange(0, 0);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colors[i], transparent: true, opacity: .55 }));
  line.frustumCulled = false; mapScene.add(line); trails.push(line);
}
const observerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#78e4cc', transparent: true, opacity: .8 }));
mapScene.add(observerLine);

let state, generation = 0, paused = false, accumulator = 0, deathRemaining = null, phase = 0, lastTrail = -1;
let mapYaw = .7, mapPitch = .62, mapZoom = 1, lastTime = performance.now(), visualTime = 0, viewDays = 0, prevDays = 0;
let fpsAccum = 0, fpsFrames = 0, lastFps = 0, mapPhase = 0, lastMapDays = -1, currentStep = STEP;
const speeds = [.01, .05, .5, 5, 30];
// Sky clock policy. Default: the sky (suns AND clouds) runs exactly on the
// simulation clock, so raising the time speed visibly speeds up the whole sky.
// Optional "smooth sky" mode caps the sky rate to avoid the rapid day/night
// strobing that fast rates necessarily produce; the sky then lags the reported
// simulation day until the speed drops back under the cap.
const VIEW_RATE_CAP = 1.5;
// Weather clock: cloud drift is measured in simulated days, so it speeds up and
// slows down with the time setting (20 shader units per simulated day keeps the
// default 0.05 d/s look identical to the old wall-clock behaviour).
const WEATHER_RATE = 20;
const records = [];
// Era tracking: samples of the environment over a trailing window (sim days),
// classified into 恒纪元 / 乱纪元 with hysteresis so the label states a period
// instead of flipping with every sunrise.
const ERA = { window: 30, samples: [], label: '观测中', candidate: null, candidateSince: 0 };
function sampleEra() {
  const d = state.days;
  if (ERA.samples.length && d - ERA.samples[ERA.samples.length - 1].days < .25) return;
  const fluxes = state.bodies.slice(0, 3).map((b, i) => b.luminosity / Math.max(state.env.distances[i] ** 2, 1e-10));
  const total = fluxes.reduce((a, b) => a + b, 0);
  ERA.samples.push({ days: d, temperature: state.temperature, flux: total, dominance: total > 0 ? Math.max(...fluxes) / total : 0 });
  while (ERA.samples.length && ERA.samples[0].days < d - ERA.window) ERA.samples.shift();
}
function updateEra() {
  sampleEra();
  const proposed = classifyEra(ERA.samples);
  if (!proposed) return ERA.label;
  if (proposed === ERA.label) { ERA.candidate = null; return ERA.label; }
  if (ERA.candidate !== proposed) { ERA.candidate = proposed; ERA.candidateSince = state.days; return ERA.label; }
  if (state.days - ERA.candidateSince >= 2) { ERA.label = proposed; ERA.candidate = null; }
  return ERA.label;
}
const prevP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
function snapshotPrev() {
  for (let i = 0; i < state.bodies.length; i++) {
    const p = state.bodies[i].p, q = prevP[i];
    q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
  }
}
// Fixed-step physics + interpolated rendering: at the slowest speed a step lands
// only every ~0.5 s, so without interpolation the whole sky would judder between
// steps. `accumulator` is the time already simulated but not yet committed.
function viewState() {
  if (state.death) return state;
  const alpha = clamp(accumulator / Math.max(1e-9, currentStep), 0, 1);
  const bodies = state.bodies.map((b, i) => {
    const q = prevP[i];
    return { ...b, p: [q[0] + (b.p[0] - q[0]) * alpha, q[1] + (b.p[1] - q[1]) * alpha, q[2] + (b.p[2] - q[2]) * alpha] };
  });
  return { ...state, bodies };
}
// Deleted stars retain stable slots for the three-light renderer.
let gmEnabled = false, gmSelected = 0, cheatKeys = [], seedRecorded = false;
const cheat = ['ArrowUp','ArrowDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyA','KeyB'];
let savedSeeds = [];
try { savedSeeds = JSON.parse(localStorage.getItem('threebody-seeds') || '[]').filter(r => Number.isInteger(r.seed) && r.days >= 365); } catch {}
let syncingSeeds = false;
async function syncSeeds() {
  if (!$('seed-service').checked || syncingSeeds || !savedSeeds.length) return;
  syncingSeeds = true;
  try {
    const response = await fetch('http://127.0.0.1:18765/seeds', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(savedSeeds), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    $('seed-status').textContent = '已同步到 seeds.txt（' + savedSeeds.length + ' 条）';
  } catch { $('seed-status').textContent = '本地服务未连接；种子已缓存，可导出。'; }
  finally { syncingSeeds = false; }
}
function recordSeed() {
  if (seedRecorded || state.days < 365) return;
  seedRecorded = true;
  // Edited scenarios cannot be reproduced from the random seed alone.
  if (state.edited) return;
  if (!savedSeeds.some(r => r.seed === state.seed)) savedSeeds.push({seed:state.seed, days:state.days});
  try { localStorage.setItem('threebody-seeds', JSON.stringify(savedSeeds)); $('seed-status').textContent = '已收藏 ' + savedSeeds.length + ' 个种子'; }
  catch { $('seed-status').textContent = '存储不可用，请在关闭前导出种子。'; }
  syncSeeds();
}
$('seed-export').onclick = () => {
  const url = URL.createObjectURL(new Blob([savedSeeds.map(r => 'seed: ' + r.seed + ' days: ' + r.days.toFixed(3)).join('\n') + '\n'], {type:'text/plain;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'seeds.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('seed-service').onchange = syncSeeds;
setInterval(syncSeeds, 15000);
function renderGM() {
  $('gm').hidden = !gmEnabled;
  $('gm-body').replaceChildren(...state.bodies.map((b, i) => { const o = document.createElement('option'); o.value = i; o.textContent = b.name + (b.deleted ? '（已删除）' : ''); o.disabled = !!b.deleted; return o; }));
  $('gm-body').value = gmSelected;
  const b = state.bodies[gmSelected];
  $('gm-values').textContent = '位置 AU: ' + b.p.map(n => n.toFixed(3)).join(', ') + ' ｜速度 AU/天: ' + b.v.map(n => n.toFixed(4)).join(', ');
}
function editBody(action) {
  if (state.death) return;
  const b = state.bodies[gmSelected];
  if (b.deleted) return;
  if (!paused) togglePause();
  state.edited = true;
  if (action === 'Delete') {
    if (gmSelected === 3) state.death = {type:'gm', title:'GM · 地球已删除', detail:'观测点随地球消失，本轮场景结束。'};
    else { b.deleted = true; b.mass = 0; b.radius = 0; b.luminosity = 0; gmSelected = 3; }
  } else {
    const axis = $('gm-plane').value === 'xy' ? 1 : 2;
    const moves = {ArrowLeft:['p',0,-.05],ArrowRight:['p',0,.05],ArrowUp:['p',axis,.05],ArrowDown:['p',axis,-.05],KeyA:['v',0,-.001],KeyD:['v',0,.001],KeyW:['v',axis,.001],KeyS:['v',axis,-.001]};
    const [field,k,delta] = moves[action]; b[field][k] += delta;
  }
  state.env = environment(state.bodies); state.initialEnergy = energy(state.bodies);
  histories.forEach(h => h.length = 0); trails.forEach(t => t.geometry.setDrawRange(0,0)); lastTrail = -1;
  ERA.samples.length = 0; ERA.label = '观测中'; ERA.candidate = null;
  snapshotPrev(); accumulator = 0; renderGM(); updateUI();
}
function handleGMKey(e) {
  if (e.target.matches('input,select,textarea,[contenteditable=true]') || ! $('death').hidden) return false;
  if (!e.repeat) {
    cheatKeys.push(e.code); cheatKeys = cheatKeys.slice(-cheat.length);
    if (cheat.every((key,i) => cheatKeys[i] === key)) { gmEnabled = !gmEnabled; if (gmEnabled && !paused) togglePause(); renderGM(); cheatKeys = []; e.preventDefault(); return true; }
  }
  if (!gmEnabled) return false;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD','Delete'].includes(e.code)) { e.preventDefault(); editBody(e.code); return true; }
  return false;
}
$('gm-body').onchange = () => { gmSelected = Number($('gm-body').value); renderGM(); $('world').focus(); };
$('gm-close').onclick = () => { gmEnabled = false; renderGM(); };
document.querySelectorAll('[data-gm]').forEach(b => b.onclick = () => editBody(b.dataset.gm));
function reset(seed) {
  state = createSystem(seed);
  seedRecorded = false;
  if (gmEnabled) renderGM();
  generation++;
  accumulator = 0; deathRemaining = null; lastTrail = -1; viewDays = state.days; prevDays = state.days;
  ERA.samples.length = 0; ERA.label = '观测中'; ERA.candidate = null; ERA.candidateSince = 0;
  snapshotPrev();
  histories.forEach(a => a.length = 0);
  trails.forEach(t => t.geometry.setDrawRange(0, 0));
  $('death').hidden = true;
  $('generation').textContent = String(generation).padStart(3, '0');
  $('seed').textContent = state.seed;
  // Choose a morning-facing starting longitude only. Subsequent sky motion is physical.
  let best = Infinity;
  for (let i = 0; i < 360; i++) {
    const p = i * Math.PI / 180;
    const dirs = localSunDirections(state, p);
    const avg = dirs.reduce((s, d) => s + d[1], 0) / 3;
    const score = Math.abs(avg - .14) + Math.max(0, -.02 - Math.min(...dirs.map(d => d[1]))) * .3;
    if (score < best) { best = score; phase = p; }
  }
  const dirs = localSunDirections(state, phase);
  const mean = dirs.reduce((s, d) => s.add(new THREE.Vector3(...d)), new THREE.Vector3()).normalize();
  uniforms.yaw.value = Math.atan2(-mean.x, -mean.z) - .16;
  uniforms.pitch.value = .055;
  updateUI();
}
function updateUI() {
  const temp = state.temperature - 273.15;
  const dirs = localSunDirections(state, phase, viewDays);
  const powers = state.bodies.slice(0, 3).map((b, i) => b.luminosity / Math.max(state.env.distances[i] ** 2, 1e-10));
  const up = i => !state.bodies[i].deleted && dirs[i][1] > 0;
  const strong = [0, 1, 2].filter(i => up(i) && powers[i] > .12).length;
  const flying = [0, 1, 2].filter(i => up(i) && powers[i] <= .12).length;
  $('days').textContent = state.days.toFixed(1);
  $('temperature').textContent = temp.toFixed(1);
  $('flux').textContent = state.env.flux.toFixed(2);
  $('distance').textContent = (state.bodies.slice(0,3).some(b => !b.deleted) ? Math.min(...state.env.distances.filter((_,i) => !state.bodies[i].deleted)).toFixed(3) : '—');
  $('temp-marker').style.left = clamp((temp + 150) / 300 * 100, 0, 100) + '%';
  // 恒纪元 / 乱纪元 describe the recent PERIOD (see updateEra), while the hero
  // line describes the sky right now -- the two are deliberately different axes.
  const extreme = temp > 80 || temp < -70;
  const era = updateEra();
  $('state-label').textContent = extreme ? '文明警报' : era;
  $('state-label').style.color = extreme ? '#ffa778' : era === '恒纪元' ? '#a1c9ad' : era === '乱纪元' ? '#e2c98d' : '#8f9d99';
  $('era').textContent = state.death ? state.death.title :
    temp > 80 ? '乱纪元 · 烈焰' : temp < -70 ? '乱纪元 · 长夜' :
    strong === 3 ? '三日凌空' :
    strong === 2 ? (flying ? '双日凌空，飞星在天' : '双日凌空') :
    strong === 1 ? (flying === 2 ? '孤日与双飞星' : flying === 1 ? '孤日与飞星' : '烈日当空') :
    flying === 3 ? '三颗飞星' : flying === 2 ? '两颗飞星' : flying === 1 ? '一颗飞星' : '长夜降临';
  $('subtitle').textContent = state.death ? '这一轮的天空，已经写进了文明的记录。' :
    strong ? '此刻的宁静，并不预示下一次日出。' :
    flying ? '远方的太阳，暂时只是一颗飞星。' : '太阳沉在地平线下，引力从未停歇。';
  $('sun-readings').replaceChildren(...state.bodies.slice(0, 3).map((b, i) => {
    const div = document.createElement('div');
    div.textContent = b.name;
    const value = document.createElement('b');
    const status = b.deleted ? '已删除' : dirs[i][1] <= 0 ? '地平线下' : powers[i] > .12 ? '太阳' : '飞星';
    value.textContent = (Math.asin(clamp(dirs[i][1], -1, 1)) * 180 / Math.PI).toFixed(1) + '° ' + status;
    div.append(value); return div;
  }));
  const degrees = ((-uniforms.yaw.value * 180 / Math.PI) % 360 + 360) % 360;
  $('heading').textContent = '方位 ' + degrees.toFixed(0).padStart(3, '0') + '°';
}
function endWorld() {
  if (deathRemaining !== null) return;
  const victory = state.death.type === 'victory';
  deathRemaining = victory ? 3 : 8;
  $('death').hidden = false;
  $('death-title').textContent = victory ? '恒纪元的梦，在第 ' + generation + ' 号文明终于成为了现实！' : state.death.title;
  $('death-detail').textContent = state.death.detail;
  $('death-stats').textContent = '第 ' + generation + ' 号文明 · 存续 ' + state.days.toFixed(1) + ' 天 · 种子 ' + state.seed;
  records.unshift({ title: state.death.title, days: state.days, generation, seed: state.seed });
  records.splice(30);
  $('records').replaceChildren(...records.map(r => {
    const li = document.createElement('li');
    const title = document.createElement('b'); title.textContent = '第 ' + r.generation + ' 号文明 · ' + r.title;
    li.append(title, document.createElement('br'), '存续 ' + r.days.toFixed(1) + ' 天 · 种子 ' + r.seed);
    return li;
  }));
  $('next-world').focus();
}
function applyQuality() {
  const lod = lodFor();
  for (const [k, v] of Object.entries(lod.defines)) skyMaterial.defines[k] = v;
  skyMaterial.needsUpdate = true;
  resize();
}
function resize() {
  const ratio = effectiveRatio();
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  uniforms.resolution.value.set(innerWidth * ratio, innerHeight * ratio);
  viewCamera.aspect = innerWidth / innerHeight;
  viewCamera.fov = uniforms.fov.value * 180 / Math.PI;
  viewCamera.updateProjectionMatrix();
  mapRenderer.setSize(274, 219, false);
}
function updateMap() {
  // The orbital inset does not need display rate: half rate keeps its cost down
  // and only re-renders when the camera or the system actually moved.
  mapPhase = 1 - mapPhase;
  if (mapPhase && state.days - lastMapDays < .02) return;
  lastMapDays = state.days;
  const c = new THREE.Vector3(...center(state.bodies));
  const radius = Math.max(2, ...state.bodies.filter(b => !b.deleted).map(b => new THREE.Vector3(...b.p).distanceTo(c)));
  meshes.forEach((m, i) => { m.visible = !state.bodies[i].deleted; trails[i].visible = m.visible; m.position.fromArray(state.bodies[i].p); m.scale.setScalar(radius * (i === 3 ? .018 : .025)); });
  if (state.days - lastTrail >= .2 || lastTrail < 0) {
    state.bodies.forEach((b, i) => {
      histories[i].push([...b.p]); if (histories[i].length > 600) histories[i].shift();
      const attr = trails[i].geometry.attributes.position;
      histories[i].forEach((p, k) => attr.setXYZ(k, ...p));
      attr.needsUpdate = true; trails[i].geometry.setDrawRange(0, histories[i].length);
    }); lastTrail = state.days;
  }
  const mapDistance = radius * 3.1 * mapZoom;
  mapCamera.position.set(c.x + Math.cos(mapYaw) * Math.cos(mapPitch) * mapDistance, c.y + Math.sin(mapPitch) * mapDistance, c.z + Math.sin(mapYaw) * Math.cos(mapPitch) * mapDistance);
  mapCamera.far = Math.max(100, mapDistance * 4); mapCamera.updateProjectionMatrix(); mapCamera.lookAt(c);
  grid.position.copy(c); grid.scale.setScalar(radius / 4);
  const attr = observerLine.geometry.attributes.position;
  attr.setXYZ(0, ...state.bodies[3].p); attr.setXYZ(1, ...state.bodies[0].p); attr.needsUpdate = true;
  mapRenderer.render(mapScene, mapCamera);
}
function tick(now) {
  const rawElapsed = (now - lastTime) / 1000;
  // Physics/physics-driven animation uses the clamped delta; the death countdown
  // is wall-clock, so it stays ~8 real seconds even when frames are slow.
  const elapsed = Math.min(rawElapsed, .1); lastTime = now;
  if (!document.hidden) {
    if (!paused && !state.death) {
      visualTime += elapsed;
      const rateNow = speeds[Number($('speed').value)];
      accumulator += elapsed * rateNow;
      // Fixed 0.025-day steps land only every ~0.5 s at 0.05 days/s, which reads
      // as judder; shrink the step so each frame still advances several steps,
      // and keep the 0.025-day cap at high rates so the work stays bounded.
      const step = clamp(rateNow * elapsed / 4, .00002, STEP);
      currentStep = step;
      let n = 0;
      while (accumulator >= step && n < 200 && !state.death) { snapshotPrev(); advance(state, step); recordSeed(); accumulator -= step; n++; }
      accumulator = Math.min(accumulator, 3);
      const simDelta = state.days - prevDays;
      prevDays = state.days;
      if (!$('smooth').checked || simDelta <= VIEW_RATE_CAP * elapsed) {
        // Truthful mode (default), or the sim is already slower than the cap:
        // the sky clock IS the simulation clock, so any speed change shows at once.
        viewDays = state.days;
      } else {
        viewDays = Math.min(viewDays + VIEW_RATE_CAP * elapsed, state.days);
      }
    }
    if (state.death) {
      endWorld();
      if ((state.death.type === 'victory' || $('auto').checked) && (!paused || state.death.type === 'victory')) deathRemaining -= Math.min(rawElapsed, .5);
      $('countdown').textContent = (state.death.type === 'victory' || $('auto').checked) ? (paused && state.death.type !== 'victory' ? '已暂停倒计时' : Math.max(0, Math.ceil(deathRemaining)) + ' 秒后，第 ' + (generation + 1) + ' 号文明开始') : '自动重启已关闭';
      if (deathRemaining <= 0 && (state.death.type === 'victory' || ($('auto').checked && !paused))) { if (paused) togglePause(); reset(); }
    }
    // Real-time panoramic sweep, independent of simulation speed. Keep manual
    // framing for 15 seconds; pausing and GM editing also stop the camera.
    if ($('auto-pan').checked && !paused && !gmEnabled && !state.death && now >= manualViewUntil) {
      panTime += elapsed;
      uniforms.yaw.value += elapsed * .006;
      const targetPitch = .24 + .06 * Math.sin(panTime * .021);
      uniforms.pitch.value += (targetPitch - uniforms.pitch.value) * (1 - Math.exp(-elapsed * .5));
    }
    const view = viewState();
    // Orient the star sphere: celestial -> local view frame (rows east, up, -north),
    // the same basis the sun directions use, so the stars rise and set with them.
    const frame = observerFrame(view, phase, viewDays);
    if (starPoints) {
      starPoints.matrix.set(
        frame.east[0], frame.up[0], -frame.north[0], 0,
        frame.east[1], frame.up[1], -frame.north[1], 0,
        frame.east[2], frame.up[2], -frame.north[2], 0,
        0, 0, 0, 1);
      starPoints.matrixWorldNeedsUpdate = true;
    }
    const dirs = localSunDirections(view, phase, viewDays);
    const viewEnv = environment(view.bodies);
    const powers = view.bodies.slice(0, 3).map((b, i) => b.luminosity / Math.max(viewEnv.distances[i] ** 2, 1e-10));
    dirs.forEach((d, i) => {
      uniforms.suns.value[i].fromArray(d);
      uniforms.powers.value[i] = powers[i];
      uniforms.radii.value[i] = Math.asin(clamp(view.bodies[i].radius / Math.max(viewEnv.distances[i], 1e-10), 0, .99));
      const light = sunLights[i];
      light.position.set(d[0], d[1], d[2]).multiplyScalar(30000);
      light.color.set(state.bodies[i].color);
      light.intensity = clamp(powers[i] * 2.2, .02, 2.6);
      light.visible = !state.bodies[i].deleted && d[1] > -.05;
    });
    const daylight = dirs.reduce((s, d, i) => s + Math.max(0, d[1] + .09) * powers[i], 0);
    const night = Math.exp(-daylight * 9.0);
    if (starPoints) {
      starPoints.material.uniforms.nightSky.value = night;
      starPoints.material.uniforms.pixelRatio.value = effectiveRatio();
    }
    const dayT = clamp(daylight / 1.2, 0, 1);
    worldScene.fog.color.setRGB(.04 + .68 * dayT, .05 + .71 * dayT, .07 + .74 * dayT);
    const cy = Math.cos(uniforms.yaw.value), sy = Math.sin(uniforms.yaw.value);
    const cp = Math.cos(uniforms.pitch.value), sp = Math.sin(uniforms.pitch.value);
    // Mirror the sky shader's view direction exactly: it rotates the base ray
    // (0,0,-1) by pitch then yaw, giving (-sin(yaw)cos(pitch), sin(pitch),
    // -cos(yaw)cos(pitch)). Any sign slip here turns the ground against the sky.
    viewCamera.lookAt(-1000 * sy * cp, 18 + 1000 * sp, -1000 * cy * cp);
    uniforms.clock.value = visualTime; uniforms.weatherClock.value = viewDays * WEATHER_RATE; uniforms.temperature.value = state.temperature;
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(worldScene, viewCamera);
    // The orbital inset and the telemetry both cost a second WebGL pass plus DOM
    // writes; skip them only when the wallpaper is running without readouts.
    updateMap(view);
    fpsAccum += rawElapsed; fpsFrames++;
    if (fpsAccum >= .5) {
      lastFps = fpsFrames / fpsAccum;
      if ($('autoRes').checked) {
        if (lastFps < 50 && RENDER.scale > RENDER.min) { RENDER.scale = Math.max(RENDER.min, RENDER.scale * .85); resize(); }
        else if (lastFps > 58 && RENDER.scale < 1) { RENDER.scale = Math.min(1, RENDER.scale * 1.06); resize(); }
      }
      $('fps').textContent = lastFps.toFixed(0) + ' fps' + ($('autoRes').checked && RENDER.scale < .995 ? ' · ' + RENDER.scale.toFixed(2) + '×' : '');
      fpsAccum = 0; fpsFrames = 0;
    }
    if (Math.floor(now / 150) !== Math.floor((now - elapsed * 1000) / 150)) updateUI();
  }
  requestAnimationFrame(tick);
}
function togglePause() {
  paused = !paused;
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').setAttribute('aria-label', paused ? '继续模拟' : '暂停模拟');
}
$('pause').onclick = togglePause;
$('restart').onclick = () => reset();
$('next-world').onclick = () => { reset(); $('restart').focus(); };
$('replay').onclick = () => reset(state.seed);
$('speed').oninput = () => { $('speed-value').textContent = speeds[Number($('speed').value)] + ' 天/秒'; };
$('quality').onchange = applyQuality;
$('exposure').oninput = () => { uniforms.exposure.value = Number($('exposure').value); };
$('clouds').oninput = () => { uniforms.cloudCover.value = Number($('clouds').value); };
for (const name of ['settings', 'history']) {
  $(name + '-button').onclick = () => {
    const other = name === 'settings' ? 'history' : 'settings';
    $(other).hidden = true; $(other + '-button').setAttribute('aria-expanded', 'false');
    $(name).hidden = !$(name).hidden;
    $(name + '-button').setAttribute('aria-expanded', String(!$(name).hidden));
  };
}
document.querySelectorAll('.orbital, .readings').forEach(panel => {
  panel.querySelector('.panel-title').addEventListener('click', () => panel.classList.toggle('folded'));
});
function drag(canvas, move) {
  let last = null;
  canvas.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!last) return; move(e.clientX - last[0], e.clientY - last[1]); last = [e.clientX, e.clientY]; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { last = null; });
}
// Browser and Wallpaper Engine use the same input handlers.
{
  world.addEventListener('pointerdown', holdAutoPan);
  drag(world, (dx, dy) => { holdAutoPan(); uniforms.yaw.value -= dx * .003; uniforms.pitch.value = clamp(uniforms.pitch.value + dy * .003, -.9, 1.4); });
  drag($('map'), (dx, dy) => { mapYaw -= dx * .008; mapPitch = clamp(mapPitch + dy * .008, -.1, 1.5); });
  world.addEventListener('wheel', e => {
    e.preventDefault();
    holdAutoPan();
    uniforms.fov.value = clamp(uniforms.fov.value + e.deltaY * .0005, .35, 1.65);
    viewCamera.fov = uniforms.fov.value * 180 / Math.PI;
    viewCamera.updateProjectionMatrix();
  }, { passive: false });
  $('map').addEventListener('wheel', e => { e.preventDefault(); mapZoom = clamp(mapZoom * Math.exp(e.deltaY * .001), .5, 3); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (handleGMKey(e)) return;
    if (e.target.matches('input,select,button') || ! $('death').hidden) return;
    if (e.code.startsWith('Arrow')) holdAutoPan();
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'ArrowLeft') uniforms.yaw.value -= .08;
    if (e.code === 'ArrowRight') uniforms.yaw.value += .08;
    if (e.code === 'ArrowUp') uniforms.pitch.value = clamp(uniforms.pitch.value + .06, -.9, 1.4);
    if (e.code === 'ArrowDown') uniforms.pitch.value = clamp(uniforms.pitch.value - .06, -.9, 1.4);
  });
}
$('death').addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); $('next-world').focus(); } });
let contextNotice = 0;
world.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  // Debounced: transient driver resets restore silently; only persistent loss is shown.
  clearTimeout(contextNotice);
  contextNotice = setTimeout(() => {
    $('loading').hidden = false; $('loading').textContent = '图形上下文丢失，正在尝试恢复…';
  }, 2000);
});
world.addEventListener('webglcontextrestored', () => {
  // Three.js rebuilds GPU resources itself; physics never stopped.
  clearTimeout(contextNotice);
  $('loading').hidden = true;
});
window.addEventListener('resize', resize);
// Wallpaper tuning without a rebuild: ?speed=0..4 picks the time rate (0 is the
// calmest at 0.01 days/s, 4 the fastest at 30), ?seed=N pins the starting world.
if (params.has('speed')) {
  $('speed').value = String(clamp(Number(params.get('speed')) | 0, 0, speeds.length - 1));
  $('speed-value').textContent = speeds[Number($('speed').value)] + ' 天/秒';
}
reset(params.has('seed') ? Number(params.get('seed')) >>> 0 : undefined);
applyQuality();
renderer.compile(scene, camera);
renderer.compile(worldScene, viewCamera);
$('loading').hidden = true;
requestAnimationFrame(tick);
// Read-only instrumentation plus explicit test mode; never enabled on a normal page.
window.observatory = { snapshot: () => ({ seed: state.seed, days: state.days, generation, paused, death: state.death, bodies: structuredClone(state.bodies), energyError: Math.abs((energy(state.bodies) - state.initialEnergy) / state.initialEnergy) }) };
if (new URLSearchParams(location.search).has('test')) {
  window.observatory.test = { state: () => state, reset, advance: days => { advance(state, days); recordSeed(); updateUI(); }, setPause: value => { if (paused !== value) togglePause(); }, terrainReady: () => terrainReady, weather: () => uniforms.weatherClock.value, fps: () => lastFps, stepDays: () => currentStep, placeStar: (index, local, distance) => { const frame = observerFrame(state, phase, viewDays); const dir = [0, 1, 2].map(k => local[0] * frame.east[k] + local[1] * frame.up[k] - local[2] * frame.north[k]); state.bodies[index].p = state.bodies[3].p.map((value, k) => value + dir[k] * distance); prevP[index][0] = state.bodies[index].p[0]; prevP[index][1] = state.bodies[index].p[1]; prevP[index][2] = state.bodies[index].p[2]; accumulator = 0; updateUI(); }, era: () => ({ label: ERA.label, samples: ERA.samples.length, dominance: ERA.samples.length ? ERA.samples[ERA.samples.length - 1].dominance : 0 }), setView: (yawValue, pitchValue) => { uniforms.yaw.value = yawValue; uniforms.pitch.value = pitchValue; }, viewDirection: () => { const v = new THREE.Vector3(); viewCamera.getWorldDirection(v); return [v.x, v.y, v.z]; }, terrainInfo: () => { let mesh = null; worldScene.traverse(child => { if (!mesh && child.isMesh) mesh = child; }); if (!mesh) return null; const geometry = mesh.geometry; return { vertices: geometry.attributes.position.count, triangles: Math.round((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3), colored: !!geometry.attributes.color }; }, syncView: () => { viewDays = state.days; prevDays = state.days; updateUI(); } };
}
