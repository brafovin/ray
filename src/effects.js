import * as THREE from 'three';
import { rand, waveHeight } from './math.js';

// One additive pool (fire, sparks, tracers) and one alpha pool (smoke, foam).
// Both are a single draw call each.

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = vAlpha * smoothstep(0.25, 0.02, r);
    gl_FragColor = vec4(vColor, a);
  }`;

class ParticlePool {
  constructor(scene, count, blending) {
    this.count = count;
    this.head = 0;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.grow = new Float32Array(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, count);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, color, size, life, opts = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x;
    this.vel[i3 + 1] = v.y;
    this.vel[i3 + 2] = v.z;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.size[i] = size;
    this.alpha[i] = opts.alpha ?? 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = opts.drag ?? 1.4;
    this.grav[i] = opts.gravity ?? 0;
    this.grow[i] = opts.grow ?? 0;
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, size } = this;
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) {
        if (alpha[i] !== 0) alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      vel[i3] *= k;
      vel[i3 + 1] = vel[i3 + 1] * k + this.grav[i] * dt;
      vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      size[i] += this.grow[i] * dt;
      const t = Math.max(life[i], 0) / maxLife[i];
      alpha[i] = t * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
const C_FIRE = new THREE.Color(0xffb14a);
const C_HOT = new THREE.Color(0xfff2c4);
const C_SMOKE = new THREE.Color(0x2b2b2e);
const C_FOAM = new THREE.Color(0xdff0f5);
const C_SPARK = new THREE.Color(0xffd98a);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.fire = new ParticlePool(scene, 3000, THREE.AdditiveBlending);
    this.soft = new ParticlePool(scene, 3000, THREE.NormalBlending);
    this.flashes = [];
    this.rings = [];
    this._ringGeo = new THREE.RingGeometry(0.6, 1, 28);
    this._ringGeo.rotateX(-Math.PI / 2);
  }

  explosion(pos, scale = 1, opts = {}) {
    const fireCount = Math.round(18 * scale);
    for (let i = 0; i < fireCount; i++) {
      _v.set(rand(-1, 1), rand(-0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(4, 22) * scale);
      this.fire.spawn(pos, _v, i % 3 === 0 ? C_HOT : C_FIRE, rand(2.5, 6) * scale, rand(0.4, 0.95), {
        drag: 2.2,
        gravity: 6,
        grow: 6 * scale,
      });
    }
    for (let i = 0; i < Math.round(10 * scale); i++) {
      _v.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 9) * scale);
      this.soft.spawn(pos, _v, C_SMOKE, rand(5, 11) * scale, rand(1.4, 2.8), {
        drag: 1.0,
        gravity: 2.2,
        grow: 9 * scale,
        alpha: 0.55,
      });
    }
    for (let i = 0; i < Math.round(12 * scale); i++) {
      _v.set(rand(-1, 1), rand(-0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(18, 55) * scale);
      this.fire.spawn(pos, _v, C_SPARK, rand(0.7, 1.6), rand(0.5, 1.2), { drag: 0.7, gravity: -22 });
    }
    this.addFlash(pos, 3.2 * scale, 0.16, opts.color ?? 0xffc46b);
    if (opts.ring !== false) this.addRing(pos, 4 * scale, 34 * scale, 0.45);
  }

  waterSplash(pos, scale = 1) {
    for (let i = 0; i < Math.round(14 * scale); i++) {
      _v.set(rand(-1, 1), rand(1.2, 3.2), rand(-1, 1)).normalize().multiplyScalar(rand(6, 20) * scale);
      this.soft.spawn(pos, _v, C_FOAM, rand(2, 5) * scale, rand(0.7, 1.5), {
        drag: 0.9,
        gravity: -26,
        grow: 2.5,
        alpha: 0.9,
      });
    }
    this.addRing(pos, 2 * scale, 13 * scale, 0.45, 0xbfe8f2);
  }

  muzzleFlash(pos, dir, scale = 1) {
    for (let i = 0; i < Math.round(8 * scale); i++) {
      _v.copy(dir).multiplyScalar(rand(10, 45) * scale);
      _v.x += rand(-6, 6);
      _v.y += rand(-3, 6);
      _v.z += rand(-6, 6);
      this.fire.spawn(pos, _v, i % 2 ? C_HOT : C_FIRE, rand(1.6, 3.4) * scale, rand(0.1, 0.28), { drag: 4, grow: 8 });
    }
    for (let i = 0; i < 3; i++) {
      _v.copy(dir).multiplyScalar(rand(3, 12));
      this.soft.spawn(pos, _v, C_SMOKE, rand(3, 6) * scale, rand(0.8, 1.6), { drag: 1.4, gravity: 3, grow: 7, alpha: 0.4 });
    }
    this.addFlash(pos, 2.2 * scale, 0.07, 0xffd08a);
  }

  smokeTrail(pos, color = C_SMOKE, size = 2.2, life = 1.1, alpha = 0.5) {
    _v.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1));
    this.soft.spawn(pos, _v, color, size, life, { drag: 1.2, gravity: 1.5, grow: 3.5, alpha });
  }

  emberTrail(pos, color) {
    _v.set(rand(-2, 2), rand(-1, 3), rand(-2, 2));
    this.fire.spawn(pos, _v, color, rand(1.0, 2.0), rand(0.15, 0.4), { drag: 3 });
  }

  wake(pos, vel, strength = 1) {
    _v.set(rand(-2, 2) - vel.x * 0.12, rand(0.3, 1.6), rand(-2, 2) - vel.z * 0.12);
    this.soft.spawn(pos, _v, C_FOAM, rand(2.5, 5.5) * strength, rand(1.4, 3.0), {
      drag: 1.1,
      gravity: -3,
      grow: 4.5 * strength,
      alpha: 0.55,
    });
  }

  bubbles(pos) {
    _v.set(rand(-1, 1), rand(2, 5), rand(-1, 1));
    this.soft.spawn(pos, _v, C_FOAM, rand(0.8, 2.0), rand(0.6, 1.4), { drag: 1.6, gravity: 4, alpha: 0.5 });
  }

  addFlash(pos, radius, life, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life, maxLife: life, grow: radius * 8 });
  }

  addRing(pos, r0, r1, life, color = 0xffd9a8) {
    const mesh = new THREE.Mesh(
      this._ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    mesh.position.set(pos.x, 0.6, pos.z);
    mesh.scale.setScalar(r0);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, r0, r1 });
  }

  update(dt, time) {
    this.fire.update(dt);
    this.soft.update(dt);

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const t = f.life / f.maxLife;
      if (t <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.mesh.material.opacity = t;
      f.mesh.scale.setScalar(1 + (1 - t) * 1.6);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = r.life / r.maxLife;
      if (t <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.material.opacity = 0.45 * t;
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - t));
      r.mesh.position.y = waveHeight(r.mesh.position.x, r.mesh.position.z, time) + 0.5;
    }
  }
}
