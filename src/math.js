// Shared math helpers + the wave model used by BOTH the CPU (ship buoyancy,
// splashes) and the GPU (ocean shader). The GLSL is generated from the same
// WAVES table so the two can never drift apart.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Shortest signed angle from a to b, in [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Directional sine waves: dir (normalized), amplitude, wavelength, speed. */
const RAW_WAVES = [
  { dx: 1.0, dz: 0.28, amp: 0.95, len: 61, speed: 7.0 },
  { dx: -0.55, dz: 1.0, amp: 0.6, len: 37, speed: 5.2 },
  { dx: 0.8, dz: -0.85, amp: 0.3, len: 19, speed: 3.6 },
  { dx: 0.15, dz: 1.0, amp: 0.14, len: 8.5, speed: 2.4 },
];

export const WAVES = RAW_WAVES.map((w) => {
  const l = Math.hypot(w.dx, w.dz);
  const k = TAU / w.len;
  return { dx: w.dx / l, dz: w.dz / l, amp: w.amp, k, w: w.speed * k };
});

/** Water surface height at world (x, z) and time t. */
export function waveHeight(x, z, t) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const wv = WAVES[i];
    h += wv.amp * Math.sin((x * wv.dx + z * wv.dz) * wv.k + t * wv.w);
  }
  return h;
}

/** Surface slope at world (x, z); returns [dH/dx, dH/dz]. */
export function waveSlope(x, z, t, out = [0, 0]) {
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const wv = WAVES[i];
    const c = wv.amp * wv.k * Math.cos((x * wv.dx + z * wv.dz) * wv.k + t * wv.w);
    sx += c * wv.dx;
    sz += c * wv.dz;
  }
  out[0] = sx;
  out[1] = sz;
  return out;
}

const f = (n) => n.toFixed(6);

/** The exact same wave model, as GLSL, for the ocean material. */
export const WAVE_GLSL = /* glsl */ `
float waveHeight(vec2 p, float t) {
  float h = 0.0;
${WAVES.map(
  (w) =>
    `  h += ${f(w.amp)} * sin(dot(p, vec2(${f(w.dx)}, ${f(w.dz)})) * ${f(w.k)} + t * ${f(w.w)});`
).join('\n')}
  return h;
}
vec3 waveNormal(vec2 p, float t) {
  float sx = 0.0;
  float sz = 0.0;
  float c;
${WAVES.map(
  (w) =>
    `  c = ${f(w.amp * w.k)} * cos(dot(p, vec2(${f(w.dx)}, ${f(w.dz)})) * ${f(w.k)} + t * ${f(w.w)});
  sx += c * ${f(w.dx)}; sz += c * ${f(w.dz)};`
).join('\n')}
  return normalize(vec3(-sx, 1.0, -sz));
}
`;
