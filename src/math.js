// Shared math helpers + the ocean model used by BOTH the CPU (ship buoyancy,
// splashes) and the GPU (ocean shader). The GLSL is generated from the same
// WAVES table so physics and optics can never drift apart.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Deterministic RNG - the world layout has to match on every client. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  return next;
}

/** Shortest signed angle from a to b, in [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Gerstner wave train. Unlike plain sines these move water particles in
 * circles, which sharpens the crests and flattens the troughs - the shape a
 * real swell has. `q` is the steepness of each component.
 */
const RAW_WAVES = [
  { dx: 1.0, dz: 0.22, len: 92, amp: 1.15, q: 0.72, speed: 9.6 },
  { dx: -0.62, dz: 1.0, len: 54, amp: 0.72, q: 0.78, speed: 7.4 },
  { dx: 0.86, dz: -0.72, len: 29, amp: 0.38, q: 0.85, speed: 5.4 },
  { dx: 0.18, dz: 1.0, len: 15.5, amp: 0.2, q: 0.9, speed: 3.9 },
  { dx: -1.0, dz: -0.32, len: 8.6, amp: 0.1, q: 0.9, speed: 2.9 },
];

export const WAVES = RAW_WAVES.map((w) => {
  const l = Math.hypot(w.dx, w.dz);
  const k = TAU / w.len;
  return {
    dx: w.dx / l,
    dz: w.dz / l,
    amp: w.amp,
    k,
    w: w.speed * k,
    // steepness is normalised so the crests never fold over on themselves
    q: w.q / (k * w.amp * WAVES_COUNT()),
  };
});

function WAVES_COUNT() {
  return RAW_WAVES.length;
}

/**
 * Surface height at a world position. Gerstner waves displace horizontally,
 * so we first solve for the sample point that lands on (x, z), then evaluate.
 */
export function waveHeight(x, z, t) {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < WAVES.length; i++) {
      const wv = WAVES[i];
      const c = Math.cos((px * wv.dx + pz * wv.dz) * wv.k + t * wv.w);
      const a = wv.q * wv.amp * c;
      dx += a * wv.dx;
      dz += a * wv.dz;
    }
    px = x - dx;
    pz = z - dz;
  }
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const wv = WAVES[i];
    h += wv.amp * Math.sin((px * wv.dx + pz * wv.dz) * wv.k + t * wv.w);
  }
  return h;
}

/** Surface slope at a world position; returns [dH/dx, dH/dz]. */
export function waveSlope(x, z, t, out = [0, 0]) {
  const e = 0.75;
  const h0 = waveHeight(x, z, t);
  out[0] = (waveHeight(x + e, z, t) - h0) / e;
  out[1] = (waveHeight(x, z + e, t) - h0) / e;
  return out;
}

const f = (n) => (Number.isFinite(n) ? n.toFixed(6) : '0.0');

/** The exact same wave train, as GLSL (unrolled, so it needs no GLSL3). */
export const WAVE_GLSL = /* glsl */ `
// Displaced position, analytic normal and the crest-folding factor that
// drives the foam. p is the undisplaced world position.
vec3 gerstner(vec2 p, float t, float damping, out vec3 nrm, out float folding) {
  vec3 pos = vec3(p.x, 0.0, p.y);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float phase, s, c, a, wa;
  folding = 0.0;
${WAVES.map(
  (w) => `  a = ${f(w.amp)} * damping;
  phase = dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) * ${f(w.k)} + t * ${f(w.w)};
  s = sin(phase); c = cos(phase); wa = ${f(w.k)} * a;
  pos.x += ${f(w.q)} * a * ${f(w.dx)} * c;
  pos.z += ${f(w.q)} * a * ${f(w.dz)} * c;
  pos.y += a * s;
  n.x -= ${f(w.dx)} * wa * c;
  n.z -= ${f(w.dz)} * wa * c;
  n.y -= ${f(w.q)} * wa * s;
  folding += ${f(w.q)} * wa * s;`
).join('\n')}
  nrm = normalize(n);
  return pos;
}
`;
