// Units: AU, solar mass, day. Newtonian gravity, not scripted orbits.
export const G = 0.0002959122082855911;
export const STEP = 0.025;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function randomGenerator(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6D2B79F5;
    let t = Math.imul(x ^ x >>> 15, 1 | x);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
export function center(bodies, field = 'p') {
  const m = bodies.reduce((s, b) => s + b.mass, 0);
  return [0, 1, 2].map(k => bodies.reduce((s, b) => s + b[field][k] * b.mass, 0) / m);
}
// Hot path: allocation-free scratch buffers keep adaptive substeps cheap.
const _a1 = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _a2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
export function accelerations(bodies, out = _a1) {
  const a = out, n = bodies.length;
  for (let i = 0; i < n; i++) { a[i][0] = 0; a[i][1] = 0; a[i][2] = 0; }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = bodies[i].p, pj = bodies[j].p;
      const dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
      const r2 = dx * dx + dy * dy + dz * dz + 1e-10;
      const f = G / (r2 * Math.sqrt(r2));
      const fi = f * bodies[i].mass, fj = f * bodies[j].mass;
      a[i][0] += fj * dx; a[i][1] += fj * dy; a[i][2] += fj * dz;
      a[j][0] -= fi * dx; a[j][1] -= fi * dy; a[j][2] -= fi * dz;
    }
  }
  return a;
}
export function verlet(bodies, dt) {
  const a = accelerations(bodies, _a1);
  for (let i = 0; i < bodies.length; i++) {
    const p = bodies[i].p, v = bodies[i].v, ai = a[i];
    for (let k = 0; k < 3; k++) p[k] += v[k] * dt + 0.5 * ai[k] * dt * dt;
  }
  const next = accelerations(bodies, _a2);
  for (let i = 0; i < bodies.length; i++) {
    const v = bodies[i].v, ai = a[i], ni = next[i];
    for (let k = 0; k < 3; k++) v[k] += 0.5 * (ai[k] + ni[k]) * dt;
  }
}
export function energy(bodies) {
  let e = bodies.reduce((s, b) => s + 0.5 * b.mass * b.v.reduce((q, v) => q + v * v, 0), 0);
  bodies.forEach((b, i) => bodies.slice(i + 1).forEach(c => {
    e -= G * b.mass * c.mass / Math.sqrt(distance(b.p, c.p) ** 2 + 1e-10);
  }));
  return e;
}
export function environment(bodies) {
  const distances = bodies.slice(0, 3).map(s => distance(s.p, bodies[3].p));
  const flux = bodies.slice(0, 3).reduce((f, s, i) => f + s.luminosity / Math.max(distances[i] ** 2, 1e-10), 0);
  return { distances, flux, equilibrium: 278.3 * Math.pow(flux * 0.7, 0.25) + 33 };
}
export function createSystem(seed = (Math.random() * 4294967296) >>> 0) {
  const rng = randomGenerator(seed);
  // Stars are placed uniformly on spherical shells in full 3D (no shared plane)
  // with rejection sampling for pairwise separation, and velocities are random
  // 3D tangential directions -- the configuration is genuinely volumetric.
  const pointOnShell = (lo, hi) => {
    const u = rng() * 2 - 1, phi = rng() * Math.PI * 2;
    const radius = lo + rng() * (hi - lo), s = Math.sqrt(1 - u * u);
    return [radius * s * Math.cos(phi), radius * u, radius * s * Math.sin(phi)];
  };
  const tangential = (p, speed) => {
    let w = [rng() - .5, rng() - .5, rng() - .5];
    const wl = Math.hypot(...w) || 1;
    w = w.map(c => c / wl);
    const pl = Math.hypot(...p), dot = w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
    return w.map((c, k) => (c - dot * p[k] / pl) * speed);
  };
  const masses = [0, 1, 2].map(() => 0.65 + rng() * 0.65);
  const totalMass = masses.reduce((s, m) => s + m, 0);
  // Velocities are scaled to the LOCAL circular speed sqrt(GM/r) rather than a
  // fixed absolute value, so every world starts genuinely orbital: stars swing
  // through the system instead of crawling (0.55x-1.05x circular).
  const orbital = (p, fraction) => tangential(p, Math.sqrt(G * totalMass / Math.max(.2, Math.hypot(...p))) * fraction);
  let positions = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    positions = [0, 1, 2].map(() => pointOnShell(0.55, 1.15));
    const ok = positions.every((a, i) => positions.slice(i + 1).every(b => distance(a, b) > 0.55));
    if (ok) break;
  }
  const bodies = [0, 1, 2].map(i => {
    const mass = masses[i];
    return { name: ['α 曦光', 'β 赤焰', 'γ 霜白'][i], mass,
      radius: 0.00465 * Math.pow(mass, 0.8), luminosity: Math.pow(mass, 3.5),
      color: ['#ffd6a1', '#ffa778', '#d0e4ff'][i],
      p: positions[i], v: orbital(positions[i], 0.55 + rng() * 0.5) };
  });
  const r = Math.sqrt(bodies.reduce((s, b) => s + b.luminosity, 0)) * (1.05 + rng() * 0.25) + 0.35;
  const earthP = pointOnShell(r * .97, r * 1.03);
  bodies.push({ name: '地球', mass: 3.003e-6, radius: 0.0000426, luminosity: 0, color: '#78e4cc',
    p: earthP, v: orbital(earthP, 0.75 + rng() * 0.4) });
  const c = center(bodies), v = center(bodies, 'v');
  bodies.forEach(b => b.p.forEach((_, k) => { b.p[k] -= c[k]; b.v[k] -= v[k]; }));
  return { seed, bodies, days: 0, temperature: 288.15, hotDays: 0, coldDays: 0, death: null,
    env: environment(bodies), initialEnergy: energy(bodies) };
}
// 恒纪元 / 乱纪元: the novel's eras describe a PERIOD, not a single moment -- a
// stable era needs a habitable, steady climate lit by one dominant sun. Three
// comparable suns (三日凌空) or a wildly swinging climate is the chaotic era.
// Pure function so the rule can be unit-tested without a DOM.
export function classifyEra(samples) {
  if (samples.length < 8) return null;
  if (samples[samples.length - 1].days - samples[0].days < 2) return null;
  const temps = samples.map(s => s.temperature);
  const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
  const swing = Math.max(...temps) - Math.min(...temps);
  const dominance = samples.reduce((a, s) => a + s.dominance, 0) / samples.length;
  const flux = samples.reduce((a, s) => a + s.flux, 0) / samples.length;
  return (avg > 253.15 && avg < 323.15 && swing < 40 && dominance > .8 && flux > .15) ? '恒纪元' : '乱纪元';
}
export function destruction(state) {
  const { bodies, env } = state;
  // Titles and wording follow the novel's vocabulary (三日凌空 / 大撕裂 / 乱纪元 /
  // 脱水), because this is a dramatised reading of the three-body problem.
  for (let i = 0; i < 3; i++) {
    if (env.distances[i] <= bodies[i].radius + bodies[3].radius) {
      return { type: 'collision', title: '坠入太阳', detail: '行星坠入 ' + bodies[i].name + ' 的表面，大地在数分钟内化作等离子体。' };
    }
    const roche = bodies[3].radius * Math.cbrt(2 * bodies[i].mass / bodies[3].mass);
    if (env.distances[i] < roche) {
      return { type: 'tidal', title: '大撕裂', detail: bodies[i].name + ' 的潮汐力超过行星自身引力，地壳被一层层剥开——原著称这一末日为「大撕裂」。' };
    }
  }
  if (state.hotDays >= 8) return { type: 'heat', title: '乱纪元 · 三日凌空', detail: '三日凌空，海洋蒸发、大地焦裂；连续 8 个模拟日均温超过 120°C，末代文明的脱水者没能等到浸泡。' };
  if (state.coldDays >= 30) return { type: 'cold', title: '乱纪元 · 长夜', detail: '太阳远去，行星陷入连续 30 个模拟日的永夜与严寒（低于 −100°C）：海洋封冻，文明终止于冰层之下；行星本身仍然存在。' };
  const stars = bodies.slice(0, 3), c = center(stars), cv = center(stars, 'v');
  const r = distance(bodies[3].p, c), mass = stars.reduce((s, b) => s + b.mass, 0);
  const rv = bodies[3].v.map((v, k) => v - cv[k]);
  const radial = rv.reduce((s, v, k) => s + v * (bodies[3].p[k] - c[k]), 0);
  if (r > 30 && radial > 0 && rv.reduce((s, v) => s + v * v, 0) / 2 > G * mass / r) {
    return { type: 'escape', title: '被抛出三体世界', detail: '行星被抛离恒星系质心 30 AU 以外并继续远离，远场近似下比轨道能量为正：它成了不再有日升日落的流浪行星。' };
  }
  // Stellar collision invalidates the point-mass model; do not invent Earth's destruction.
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    if (distance(bodies[i].p, bodies[j].p) < bodies[i].radius + bodies[j].radius) {
      return { type: 'model', title: '恒星相撞 · 观测终止', detail: '两颗恒星表面相交，已超出点质量引力模型范围。本轮重启，但不计作行星毁灭。' };
    }
  }
  return null;
}
export function advance(state, dt = STEP) {
  if (state.death || dt <= 0 || !Number.isFinite(dt)) return;
  state.env = environment(state.bodies);
  state.death = destruction(state);
  if (state.death) return;
  let remaining = dt;
  while (remaining > 1e-10 && !state.death) {
    let h = Math.min(remaining, STEP);
    for (let i = 0; i < state.bodies.length; i++) for (let j = i + 1; j < state.bodies.length; j++) {
      const pi = state.bodies[i].p, pj = state.bodies[j].p;
      const d = Math.hypot(pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2]);
      h = Math.min(h, Math.max(1e-5, 0.025 * Math.sqrt(d * d * d / (G * (state.bodies[i].mass + state.bodies[j].mass)))));
    }
    verlet(state.bodies, h);
    state.days += h;
    state.env = environment(state.bodies);
    // ponytail: one-zone heat lag, not a scientific climate solver.
    state.temperature += (state.env.equilibrium - state.temperature) * (1 - Math.exp(-h / 14));
    state.hotDays = state.temperature > 393.15 ? state.hotDays + h : 0;
    state.coldDays = state.temperature < 173.15 ? state.coldDays + h : 0;
    state.death = destruction(state);
    remaining -= h;
  }
}
// Fixed ground observer: latitude 25 degrees, sidereal spin, tilted axis.
// `days` lets the view layer decouple its clock from the simulation clock.
export function observerFrame(state, phase = 0, days = state.days) {
  const spin = days * Math.PI * 2 / 0.99727 + phase;
  const lat = 25 * Math.PI / 180, tilt = 23.44 * Math.PI / 180;
  const rotate = ([x, y, z]) => [x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
  const up = rotate([Math.cos(lat) * Math.cos(spin), Math.sin(lat), Math.cos(lat) * Math.sin(spin)]);
  const east = rotate([-Math.sin(spin), 0, Math.cos(spin)]);
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  return { up, east, north };
}
export function localSunDirections(state, phase = 0, days = state.days) {
  const frame = observerFrame(state, phase, days);
  const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
  return state.bodies.slice(0, 3).map(b => {
    const d = b.p.map((v, k) => v - state.bodies[3].p[k]);
    const r = Math.hypot(...d);
    return [dot(d, frame.east) / r, dot(d, frame.up) / r, -dot(d, frame.north) / r];
  });
}
