import * as THREE from 'three';
import { rand, randInt, TAU } from './math.js';

export const ARENA_RADIUS = 2400;
export const SUN_DIR = new THREE.Vector3(0.42, 0.5, -0.76).normalize();
export const SKY_COLOR = new THREE.Color(0x8fb6cf);

function skyDome() {
  const geo = new THREE.SphereGeometry(6000, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x1d5a8f) },
      uMid: { value: new THREE.Color(0x8fb6cf) },
      uBottom: { value: new THREE.Color(0xd9e6ec) },
      uSun: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uBottom, uSun;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(uBottom, uMid, smoothstep(-0.05, 0.18, h));
        c = mix(c, uTop, smoothstep(0.15, 0.75, h));
        float d = max(dot(normalize(vDir), normalize(uSun)), 0.0);
        c += vec3(1.0, 0.92, 0.75) * pow(d, 220.0) * 3.0;      // sun disc
        c += vec3(1.0, 0.88, 0.7) * pow(d, 8.0) * 0.22;        // glow
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function buildIsland(radius) {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: 0x5b5c50, roughness: 0.95, flatShading: true });
  const sand = new THREE.MeshStandardMaterial({ color: 0xbfae7d, roughness: 1.0, flatShading: true });
  const green = new THREE.MeshStandardMaterial({ color: 0x3e5c33, roughness: 1.0, flatShading: true });

  // Shore: a shallow cone so only a rim of sand breaks the surface.
  const beach = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.55, radius * 0.42, 16, 1), sand);
  beach.position.y = radius * 0.21 - radius * 0.2;
  g.add(beach);

  // Surf line where the swell meets the shore.
  const surf = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.12, radius * 1.42, 28),
    new THREE.MeshBasicMaterial({ color: 0xdff2f7, transparent: true, opacity: 0.32, depthWrite: false })
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.6;
  g.add(surf);

  const peaks = randInt(2, 4);
  for (let i = 0; i < peaks; i++) {
    const r = radius * rand(0.45, 0.95);
    const h = radius * rand(0.35, 0.8);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, randInt(6, 9), 2), i % 2 ? green : rock);
    const a = rand(0, TAU);
    const d = i === 0 ? 0 : rand(0, radius * 0.5);
    cone.position.set(Math.cos(a) * d, h * 0.42, Math.sin(a) * d);
    cone.rotation.y = rand(0, TAU);
    cone.scale.set(1, 1, rand(0.75, 1.25));
    g.add(cone);
  }
  return g;
}

/** Soft billboard clouds, cheap but they give the sky real depth. */
function cloudTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const x = 60 + rnd() * 136;
    const y = 96 + rnd() * 70;
    const r = 26 + rnd() * 46;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.42)');
    grd.addColorStop(0.55, 'rgba(240,248,255,0.18)');
    grd.addColorStop(1, 'rgba(230,242,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clouds(scene) {
  const textures = [cloudTexture(3), cloudTexture(17), cloudTexture(42)];
  const group = new THREE.Group();
  for (let i = 0; i < 34; i++) {
    const mat = new THREE.SpriteMaterial({
      map: textures[i % 3],
      transparent: true,
      opacity: rand(0.35, 0.75),
      depthWrite: false,
      fog: false,
    });
    const sp = new THREE.Sprite(mat);
    const a = rand(0, TAU);
    const d = rand(900, 4200);
    sp.position.set(Math.cos(a) * d, rand(420, 1150), Math.sin(a) * d);
    const w = rand(700, 1900);
    sp.scale.set(w, w * rand(0.32, 0.5), 1);
    sp.userData.drift = rand(1.5, 5.5);
    group.add(sp);
  }
  scene.add(group);
  return group;
}

/** Sky, lights, islands and the arena boundary. Returns island colliders. */
export function createWorld(scene) {
  scene.background = SKY_COLOR.clone();
  scene.fog = new THREE.FogExp2(0x9dbdd2, 0.00034);
  const sky = skyDome();
  scene.add(sky);
  const cloudGroup = clouds(scene);

  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  sun.position.copy(SUN_DIR).multiplyScalar(900);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2400;
  const R = 260;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.8;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x1b4a63, 0.5));
  scene.add(new THREE.AmbientLight(0x6a86a0, 0.22));

  const islands = [];
  const placed = [];
  for (let i = 0; i < 9; i++) {
    const radius = rand(55, 145);
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 40; tries++) {
      const a = rand(0, TAU);
      const d = rand(360, ARENA_RADIUS - 320);
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + radius + 420)) break;
    }
    const mesh = buildIsland(radius);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const col = { x, z, radius: radius * 1.35 };
    placed.push(col);
    islands.push(col);
  }

  // Boundary: a translucent ring of light so the arena edge reads clearly.
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 90, 96, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff5a3c,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.position.y = 20;
  scene.add(ring);

  return { islands, sun, sky, clouds: cloudGroup };
}
