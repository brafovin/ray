import * as THREE from 'three';
import { WAVE_GLSL } from './math.js';

const MAX_SHIPS = 8;
const MAX_ISLANDS = 10;

/**
 * Tileable ripple normal map + a foam noise channel, generated once into a
 * canvas so the game still needs no external assets.
 */
function makeRippleTexture(size = 256) {
  const rnd = (() => {
    let s = 1337;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();

  // value noise on a wrapping lattice, several octaves
  const octave = (cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x, y) => {
      const fx = x * cells;
      const fy = y * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (a, b) => g[(((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
      const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      return a * (1 - sy) + b * sy;
    };
  };

  const o = [octave(4), octave(8), octave(16), octave(32)];
  const amp = [0.5, 0.27, 0.15, 0.08];
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0;
      for (let i = 0; i < o.length; i++) h += o[i](x / size, y / size) * amp[i];
      height[y * size + x] = h;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len) * 255;
      data[i + 3] = at(x, y) * 255;          // foam breakup noise
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Real-time planar reflection: the scene is rendered a second time from the
 * camera mirrored through the water plane, with an oblique near plane so
 * nothing below the surface leaks in.
 */
class PlanarReflection {
  constructor(size = 1024) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.textureMatrix = new THREE.Matrix4();
    this.camera = new THREE.PerspectiveCamera();
    this._normal = new THREE.Vector3(0, 1, 0);
    this._plane = new THREE.Plane();
    this._rot = new THREE.Matrix4();
    this._look = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  setSize(w, h) {
    this.target.setSize(w, h);
  }

  render(renderer, scene, camera, oceanMesh) {
    const normal = this._normal;
    const cam = this.camera;

    this._view.copy(camera.position);
    this._view.y = -this._view.y;                 // mirror through y = 0
    cam.position.copy(this._view);

    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camera.position);
    this._target.set(this._look.x, -this._look.y, this._look.z);

    cam.up.set(0, 1, 0).applyMatrix4(this._rot);
    cam.up.reflect(normal);
    cam.lookAt(this._target);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.aspect = camera.aspect;
    cam.fov = camera.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // texture projection matrix (NDC -> [0,1])
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix);
    this.textureMatrix.multiply(cam.matrixWorldInverse);

    // oblique near plane on the water surface
    this._plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, 0, 0));
    this._plane.applyMatrix4(cam.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const p = cam.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + p.elements[8]) / p.elements[0];
    q.y = (Math.sign(clip.y) + p.elements[9]) / p.elements[5];
    q.z = -1;
    q.w = (1 + p.elements[10]) / p.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    p.elements[2] = clip.x;
    p.elements[6] = clip.y;
    p.elements[10] = clip.z + 1 - 0.004;
    p.elements[14] = clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevXR = renderer.xr.enabled;
    oceanMesh.visible = false;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXR;
    oceanMesh.visible = true;
  }
}

/**
 * Radial mesh: fine rings close to the camera where the swell is readable,
 * geometrically growing rings out to the horizon.
 */
function oceanGeometry(nearRings = 62, farRings = 92, segments = 256, nearStep = 1.6, growth = 1.056) {
  const radii = [0];
  for (let i = 1; i <= nearRings; i++) radii.push(i * nearStep);
  let r = radii[radii.length - 1];
  for (let i = 0; i < farRings; i++) {
    r *= growth;
    radii.push(r);
  }

  const rings = radii.length;
  const verts = new Float32Array(rings * segments * 3);
  let v = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      verts[v++] = Math.cos(a) * radii[i];
      verts[v++] = 0;
      verts[v++] = Math.sin(a) * radii[i];
    }
  }

  const idx = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      const a = i * segments + j;
      const b = i * segments + j2;
      const c = (i + 1) * segments + j;
      const d = (i + 1) * segments + j2;
      idx.push(a, b, c, b, d, c);   // wound so the surface faces up
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radii[rings - 1]);
  return geo;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uOffset;
uniform mat4 uTextureMatrix;
varying vec3 vWorld;
varying vec3 vWaveNormal;
varying float vFolding;
varying float vViewDist;
varying vec4 vReflectUV;

${WAVE_GLSL}

void main() {
  vec2 p = position.xz + uOffset;
  vec3 nrm;
  float folding;
  vec3 pos = gerstner(p, uTime, 1.0, nrm, folding);

  vWorld = pos;
  vWaveNormal = nrm;
  vFolding = folding;

  vec4 mv = viewMatrix * vec4(pos, 1.0);
  vViewDist = -mv.z;
  vReflectUV = uTextureMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoamColor;
uniform vec3 uSkyLow;
uniform vec3 uSkyHigh;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uRipples;
uniform sampler2D uReflection;
uniform float uHasReflection;
uniform vec4 uShipA[${MAX_SHIPS}];
uniform vec4 uShipB[${MAX_SHIPS}];
uniform int uShipCount;
uniform vec4 uIslands[${MAX_ISLANDS}];
uniform int uIslandCount;

varying vec3 vWorld;
varying vec3 vWaveNormal;
varying float vFolding;
varying float vViewDist;
varying vec4 vReflectUV;

vec3 skyColor(vec3 dir) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 0.45, h));
  float d = max(dot(normalize(dir), uSunDir), 0.0);
  c += uSunColor * pow(d, 90.0) * 0.9;
  c += uSunColor * pow(d, 6.0) * 0.09;
  return c;
}

// Hull collar plus the turbulent stern trail and Kelvin arms behind a ship.
float shipFoam(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${MAX_SHIPS}; i++) {
    if (i >= uShipCount) break;
    vec2 d = p - uShipA[i].xy;
    float sh = uShipA[i].z;
    float ch = uShipA[i].w;
    float lx = d.x * ch - d.y * sh;
    float lz = d.x * sh + d.y * ch;
    float halfL = uShipB[i].x;
    float halfB = uShipB[i].y;
    float str = uShipB[i].z;
    float wake = uShipB[i].w;

    float e = length(vec2(lx / (halfB * 1.7), lz / (halfL * 1.06)));
    f += (1.0 - smoothstep(0.72, 1.3, e)) * 0.5;

    if (lz < 0.0 && wake > 1.0) {
      float t = -lz;
      float fade = (1.0 - smoothstep(0.0, wake, t)) * str;
      float trail = 1.0 - smoothstep(halfB * 0.45, halfB * 1.5 + t * 0.05, abs(lx));
      float arm = 1.0 - smoothstep(0.0, halfB * 0.8, abs(abs(lx) - t * 0.33));
      f += (trail * 0.55 + arm * 0.5) * fade;
    }
  }
  return f;
}

// Surf breaking on the beaches.
float shoreFoam(vec2 p, out float shallow) {
  float f = 0.0;
  shallow = 0.0;
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
    if (i >= uIslandCount) break;
    float d = distance(p, uIslands[i].xy) - uIslands[i].z;
    float band = 1.0 - smoothstep(0.0, 30.0, abs(d - 4.0));
    f += band * (0.65 + 0.35 * sin(uTime * 1.6 + d * 0.25));
    shallow = max(shallow, 1.0 - smoothstep(0.0, 170.0, max(d, 0.0)));
  }
  return f;
}

void main() {
  vec3 V = normalize(uCameraPos - vWorld);
  float detailFade = clamp(1.0 - vViewDist / 1400.0, 0.0, 1.0);

  vec2 uv1 = vWorld.xz * 0.055 + uTime * vec2(0.010, 0.007);
  vec2 uv2 = vWorld.xz * 0.021 - uTime * vec2(0.006, 0.009);
  vec2 uv3 = vWorld.xz * 0.145 + uTime * vec2(-0.02, 0.014);
  vec3 r1 = texture2D(uRipples, uv1).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipples, uv2).xyz * 2.0 - 1.0;
  vec3 r3 = texture2D(uRipples, uv3).xyz * 2.0 - 1.0;

  vec3 N = normalize(vWaveNormal + vec3(
    (r1.x * 0.55 + r2.x * 0.75 + r3.x * 0.3) * detailFade,
    0.0,
    (r1.y * 0.55 + r2.y * 0.75 + r3.y * 0.3) * detailFade));

  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);

  vec3 skyRefl = skyColor(reflect(-V, N));
  vec3 refl = skyRefl;
  if (uHasReflection > 0.5) {
    vec2 uv = vReflectUV.xy / max(vReflectUV.w, 0.0001);
    uv += N.xz * clamp(26.0 / max(vViewDist, 1.0), 0.004, 0.09);
    vec3 planar = texture2D(uReflection, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
    float valid = step(0.002, uv.x) * step(uv.x, 0.998) * step(0.002, uv.y) * step(uv.y, 0.998);
    refl = mix(skyRefl, planar, valid * (1.0 - smoothstep(900.0, 2400.0, vViewDist)));
  }

  float shallow;
  float shore = shoreFoam(vWorld.xz, shallow);
  vec3 body = mix(uDeep, uShallow, shallow);

  // light scattering through the crests, seen against the sun
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 4.0);
  sss *= clamp(vWorld.y * 0.55 + 0.25, 0.0, 1.0);
  body += vec3(0.06, 0.30, 0.26) * sss * 0.9;
  body *= 0.72 + 0.28 * max(N.y, 0.0);

  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 420.0) * 7.0 + pow(max(dot(N, H), 0.0), 26.0) * 0.16;

  vec3 color = mix(body, refl, fres) + uSunColor * spec;

  float noise = texture2D(uRipples, vWorld.xz * 0.05 + uTime * 0.012).a;
  float foam = smoothstep(0.52, 0.95, vFolding) * 1.1 + shipFoam(vWorld.xz) + shore;
  foam = clamp(foam * (0.55 + 0.75 * noise), 0.0, 1.0);
  color = mix(color, uFoamColor, foam * 0.92);

  float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
  color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

/** Build the ocean: geometry, material, reflection probe and per-frame update. */
export function createOcean(opts) {
  const uniforms = {
    uTime: { value: 0 },
    uOffset: { value: new THREE.Vector2() },
    uTextureMatrix: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: opts.sunDir.clone() },
    uSunColor: { value: new THREE.Color(0xfff1d8) },
    uDeep: { value: new THREE.Color(0x05283e) },
    uShallow: { value: new THREE.Color(0x2ba6b4) },
    uFoamColor: { value: new THREE.Color(0xe8f6fa) },
    uSkyLow: { value: new THREE.Color(0xb9d4e2) },
    uSkyHigh: { value: new THREE.Color(0x3b7fb5) },
    uFogColor: { value: new THREE.Color(opts.fogColor) },
    uFogDensity: { value: opts.fogDensity },
    uRipples: { value: makeRippleTexture(256) },
    uReflection: { value: null },
    uHasReflection: { value: 0 },
    uShipA: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4()) },
    uShipB: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4()) },
    uShipCount: { value: 0 },
    uIslands: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4()) },
    uIslandCount: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(oceanGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.matrixAutoUpdate = false;      // the shader offsets in world space instead

  const reflection = new PlanarReflection(1024);
  let reflectionEnabled = true;

  return {
    mesh,
    material,

    setIslands(islands) {
      const n = Math.min(islands.length, MAX_ISLANDS);
      for (let i = 0; i < n; i++) {
        uniforms.uIslands.value[i].set(islands[i].x, islands[i].z, islands[i].radius, 0);
      }
      uniforms.uIslandCount.value = n;
    },

    /** Hull collars and wakes are drawn onto the water itself. */
    setShips(ships, playerPos) {
      const near = ships
        .filter((s) => !s.disposed && !s.submerged)
        .sort((a, b) => a.pos.distanceToSquared(playerPos) - b.pos.distanceToSquared(playerPos))
        .slice(0, MAX_SHIPS);
      near.forEach((s, i) => {
        const hull = s.def.hull;
        const speed = Math.min(Math.abs(s.speed) / s.def.maxSpeed, 1);
        uniforms.uShipA.value[i].set(s.pos.x, s.pos.z, Math.sin(s.heading), Math.cos(s.heading));
        uniforms.uShipB.value[i].set(
          hull.length * 0.5,
          hull.beam * 0.5,
          s.alive ? 0.35 + speed * 0.65 : 0,
          s.alive ? hull.length * (1.2 + speed * 5.5) : 0
        );
      });
      uniforms.uShipCount.value = near.length;
    },

    setReflectionEnabled(on) {
      reflectionEnabled = on;
      if (!on) uniforms.uHasReflection.value = 0;
    },

    resize(w, h) {
      reflection.setSize(Math.min(1024, Math.floor(w * 0.5)), Math.min(1024, Math.floor(h * 0.5)));
    },

    /** Called before the main render so the mirror pass is up to date. */
    renderReflection(renderer, scene, camera) {
      if (!reflectionEnabled) return;
      reflection.render(renderer, scene, camera, mesh);
      uniforms.uReflection.value = reflection.target.texture;
      uniforms.uTextureMatrix.value.copy(reflection.textureMatrix);
      uniforms.uHasReflection.value = 1;
    },

    update(time, camera) {
      uniforms.uTime.value = time;
      uniforms.uOffset.value.set(camera.position.x, camera.position.z);
      uniforms.uCameraPos.value.copy(camera.position);
    },
  };
}
