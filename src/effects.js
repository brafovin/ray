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
const C_FIRE = new THREE.Color(0xffb14a).multiplyScalar(2.6);
const C_HOT = new THREE.Color(0xfff2c4).multiplyScalar(4.2);
const C_SMOKE = new THREE.Color(0x2b2b2e);
const C_FOAM = new THREE.Color(0xdff0f5);
const C_SPARK = new THREE.Color(0xffd98a).multiplyScalar(3.4);
const C_BRASS = new THREE.Color(0xd9a441).multiplyScalar(2.0);
const C_DEBRIS = new THREE.Color(0x3a3f44);
const FORWARD = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.fire = new ParticlePool(scene, 3000, THREE.AdditiveBlending);
    this.soft = new ParticlePool(scene, 3000, THREE.NormalBlending);
    this.flashes = [];
    this.rings = [];

    // A small pool of dynamic lights: muzzle blasts and explosions actually
    // light up the sea and the hulls around them.
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb257, 0, 320, 2);
      l.visible = true;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    this.lightCursor = 0;

    // pooled meshes for blasts, shock rings and water columns
    this.sprites = [];
    // apex at the origin, opening out along +Z - the shape a muzzle blast has
    this._coneGeo = new THREE.ConeGeometry(1, 1, 14, 1, true);
    this._coneGeo.translate(0, -0.5, 0);
    this._coneGeo.rotateX(-Math.PI / 2);
    this._ringGeo2 = new THREE.TorusGeometry(1, 0.07, 6, 26);
    this._colGeo = new THREE.CylinderGeometry(1, 0.55, 1, 14, 1, true);
    this._colGeo.translate(0, 0.5, 0);
    this._sphereGeo = new THREE.SphereGeometry(1, 12, 9);
    this._ringGeo = new THREE.RingGeometry(0.6, 1, 28);
    this._ringGeo.rotateX(-Math.PI / 2);
  }

  /** Flash the sea with a short-lived point light. */
  addLight(pos, color, intensity, life) {
    const slot = this.lights.reduce((a, b) => (a.life <= b.life ? a : b));
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.peak = intensity;
    slot.life = life;
    slot.max = life;
    slot.light.intensity = intensity;
    return slot;
  }

  /** A shape that grows and fades: cone, ring, column or ball. */
  addSprite(kind, pos, opts) {
    const geo =
      kind === 'cone' ? this._coneGeo :
      kind === 'ring' ? this._ringGeo2 :
      kind === 'column' ? this._colGeo : this._sphereGeo;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(opts.color ?? 0xffd9a0).multiplyScalar(opts.intensity ?? 1),
        transparent: true,
        opacity: opts.opacity ?? 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: opts.blending ?? THREE.AdditiveBlending,
      })
    );
    mesh.position.copy(pos);
    if (opts.dir) mesh.quaternion.setFromUnitVectors(FORWARD, opts.dir);
    if (opts.rotation) mesh.rotation.copy(opts.rotation);
    mesh.scale.copy(opts.from);
    this.scene.add(mesh);
    this.sprites.push({
      mesh,
      life: opts.life,
      maxLife: opts.life,
      from: opts.from.clone(),
      to: opts.to.clone(),
      spin: opts.spin ?? 0,
      fade: opts.fade ?? 1,
      opacity: opts.opacity ?? 0.9,
    });
    return mesh;
  }

  /** Gun blast: a pressure cone, a shock ring and the smoke that follows. */
  muzzleBlast(pos, dir, scale = 1) {
    this.addSprite('cone', pos, {
      dir,
      color: 0xfff0c0,
      intensity: 3.0,
      life: 0.12,
      from: new THREE.Vector3(1.6 * scale, 1.6 * scale, 5 * scale),
      to: new THREE.Vector3(5.0 * scale, 5.0 * scale, 17 * scale),
      opacity: 0.95,
    });
    this.addSprite('ring', _p.copy(pos).addScaledVector(dir, 1.5 * scale), {
      dir,
      color: 0xffe6b0,
      intensity: 2.0,
      life: 0.24,
      from: new THREE.Vector3(1.0 * scale, 1.0 * scale, 1.0 * scale),
      to: new THREE.Vector3(11 * scale, 11 * scale, 11 * scale),
      opacity: 0.42,
      fade: 1.5,
    });
    for (let i = 0; i < Math.round(5 * scale); i++) {
      _v.copy(dir).multiplyScalar(rand(4, 16) * scale);
      _v.x += rand(-5, 5);
      _v.y += rand(-2, 5);
      _v.z += rand(-5, 5);
      this.soft.spawn(pos, _v, C_SMOKE, rand(3, 6) * scale, rand(1.0, 2.2), {
        drag: 1.1,
        gravity: 2.4,
        grow: 9 * scale,
        alpha: 0.45,
      });
    }
  }

  /** Missile leaving its cell: exhaust jet, deck wash and a bright flash. */
  launchPlume(pos, dir, scale = 1) {
    this.addLight(pos, 0xffb257, 500 * scale, 0.3);
    this.addSprite('cone', pos, {
      dir: _v.copy(dir).negate().normalize().clone(),
      color: 0xffd08a,
      intensity: 2.6,
      life: 0.35,
      from: new THREE.Vector3(1.4 * scale, 1.4 * scale, 3 * scale),
      to: new THREE.Vector3(3.2 * scale, 3.2 * scale, 14 * scale),
      opacity: 0.85,
      fade: 1.4,
    });
    for (let i = 0; i < Math.round(16 * scale); i++) {
      _v.copy(dir).multiplyScalar(-rand(6, 26) * scale);
      _v.x += rand(-9, 9);
      _v.y += rand(-3, 4);
      _v.z += rand(-9, 9);
      this.soft.spawn(pos, _v, C_SMOKE, rand(3, 7) * scale, rand(1.6, 3.2), {
        drag: 0.9,
        gravity: 2.0,
        grow: 11 * scale,
        alpha: 0.6,
      });
      if (i % 2 === 0) this.fire.spawn(pos, _v, C_FIRE, rand(1.6, 3.4) * scale, rand(0.2, 0.5), { drag: 2.6, grow: 5 });
    }
  }

  /** Brass tumbling out of an autocannon. */
  casings(pos, dir, count = 2) {
    for (let i = 0; i < count; i++) {
      _v.set(dir.z, 0, -dir.x).multiplyScalar(rand(4, 9));
      _v.y += rand(3, 7);
      this.fire.spawn(pos, _v, C_BRASS, rand(0.35, 0.6), rand(0.7, 1.3), { drag: 0.3, gravity: -26 });
    }
  }

  /** Shell splash: a tall column of water that collapses back into foam. */
  waterColumn(pos, scale = 1) {
    this.addSprite('column', pos, {
      color: 0xdff2f8,
      blending: THREE.NormalBlending,
      life: 1.15 + scale * 0.2,
      from: new THREE.Vector3(2.4 * scale, 4 * scale, 2.4 * scale),
      to: new THREE.Vector3(6.0 * scale, 46 * scale, 6.0 * scale),
      opacity: 0.72,
      fade: 2.0,
    });
    for (let i = 0; i < Math.round(30 * scale); i++) {
      _v.set(rand(-1, 1), rand(3, 9), rand(-1, 1)).normalize().multiplyScalar(rand(16, 46) * scale);
      this.soft.spawn(pos, _v, C_FOAM, rand(3, 8) * scale, rand(1.1, 2.4), {
        drag: 0.6,
        gravity: -26,
        grow: 3.5,
        alpha: 0.95,
      });
    }
    this.addRing(pos, 3 * scale, 26 * scale, 0.7, 0xcfeaf3);
  }

  /**
   * Something solid was hit: white-hot flash, sparks, torn plating and smoke.
   * `normal` points back along the incoming round.
   */
  impact(pos, normal, scale = 1, kind = 'shell') {
    const heavy = kind === 'torpedo' || kind === 'missile';
    this.addLight(pos, heavy ? 0xff8a3c : 0xffc880, 700 * scale, 0.28);
    this.addSprite('ball', pos, {
      color: heavy ? 0xffb060 : 0xfff0d0,
      intensity: 3.6,
      life: 0.22,
      from: new THREE.Vector3(1.8 * scale, 1.8 * scale, 1.8 * scale),
      to: new THREE.Vector3(9 * scale, 9 * scale, 9 * scale),
      opacity: 1,
      fade: 1.6,
    });
    this.addSprite('ring', pos, {
      dir: normal.clone().normalize(),
      color: 0xffd0a0,
      intensity: 2.2,
      life: 0.32,
      from: new THREE.Vector3(1 * scale, 1 * scale, 1 * scale),
      to: new THREE.Vector3(14 * scale, 14 * scale, 14 * scale),
      opacity: 0.45,
      fade: 1.6,
    });
    // sparks spray back along the impact normal
    for (let i = 0; i < Math.round(34 * scale); i++) {
      _v.copy(normal).multiplyScalar(rand(10, 46) * scale);
      _v.x += rand(-22, 22);
      _v.y += rand(-6, 32);
      _v.z += rand(-22, 22);
      this.fire.spawn(pos, _v, i % 3 ? C_SPARK : C_HOT, rand(0.8, 2.2), rand(0.4, 1.1), {
        drag: 0.5,
        gravity: -26,
      });
    }
    // fireball
    for (let i = 0; i < Math.round(14 * scale); i++) {
      _v.set(rand(-1, 1), rand(-0.1, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(6, 24) * scale);
      this.fire.spawn(pos, _v, i % 3 === 0 ? C_HOT : C_FIRE, rand(3, 7) * scale, rand(0.35, 0.8), {
        drag: 2.2,
        gravity: 5,
        grow: 9 * scale,
      });
    }
    // torn plating
    for (let i = 0; i < Math.round(6 * scale); i++) {
      _v.copy(normal).multiplyScalar(rand(3, 12));
      _v.y += rand(2, 12);
      _v.x += rand(-8, 8);
      _v.z += rand(-8, 8);
      this.soft.spawn(pos, _v, C_DEBRIS, rand(0.8, 1.8) * scale, rand(0.9, 1.8), {
        drag: 0.5,
        gravity: -24,
        alpha: 0.95,
      });
    }
    for (let i = 0; i < Math.round(12 * scale); i++) {
      _v.set(rand(-1, 1), rand(0.4, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(4, 16) * scale);
      this.soft.spawn(pos, _v, C_SMOKE, rand(4, 9) * scale, rand(1.6, 3.4), {
        drag: 1.0,
        gravity: 2.8,
        grow: 10 * scale,
        alpha: 0.62,
      });
    }
    for (let i = 0; i < Math.round(8 * scale); i++) {
      _v.set(rand(-1, 1), rand(0, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(5, 18) * scale);
      this.fire.spawn(pos, _v, C_FIRE, rand(2, 5) * scale, rand(0.3, 0.7), { drag: 2.4, grow: 5 });
    }
  }

  /** Glancing blow: a shower of sparks skidding off the armour. */
  ricochet(pos, dir, scale = 1) {
    for (let i = 0; i < Math.round(14 * scale); i++) {
      _v.copy(dir).multiplyScalar(rand(14, 42));
      _v.x += rand(-10, 10);
      _v.y += rand(0, 16);
      _v.z += rand(-10, 10);
      this.fire.spawn(pos, _v, C_SPARK, rand(0.5, 1.1), rand(0.4, 0.9), { drag: 0.5, gravity: -24 });
    }
    this.addSprite('ball', pos, {
      color: 0xffe0a0,
      intensity: 3.0,
      life: 0.1,
      from: new THREE.Vector3(0.8, 0.8, 0.8),
      to: new THREE.Vector3(2.4, 2.4, 2.4),
      opacity: 0.9,
    });
  }

  /** A fire burning on a hull: called every frame while it lasts. */
  flame(pos, strength = 1) {
    _v.set(rand(-1.5, 1.5), rand(3, 8) * strength, rand(-1.5, 1.5));
    this.fire.spawn(pos, _v, Math.random() < 0.5 ? C_FIRE : C_HOT, rand(1.6, 3.6) * strength, rand(0.3, 0.7), {
      drag: 1.6,
      gravity: 8,
      grow: 3,
    });
    if (Math.random() < 0.4) {
      _v.set(rand(-1, 1), rand(4, 9), rand(-1, 1));
      this.soft.spawn(pos, _v, C_SMOKE, rand(3, 6) * strength, rand(1.4, 2.6), {
        drag: 1.0,
        gravity: 3.4,
        grow: 6,
        alpha: 0.5,
      });
    }
  }

  explosion(pos, scale = 1, opts = {}) {
    this.addLight(pos, opts.light ?? 0xffa845, 900 * scale, 0.5 + scale * 0.25);
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
    this.addLight(pos, 0xffc070, 520 * scale, 0.16);
    this.muzzleBlast(pos, dir, scale);
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

  spray(pos, vel, power = 1) {
    this.soft.spawn(pos, vel, C_FOAM, rand(1.4, 3.4) * power, rand(0.5, 1.1), {
      drag: 0.8,
      gravity: -24,
      grow: 2.2,
      alpha: 0.75,
    });
  }

  bubbles(pos) {
    _v.set(rand(-1, 1), rand(2, 5), rand(-1, 1));
    this.soft.spawn(pos, _v, C_FOAM, rand(0.8, 2.0), rand(0.6, 1.4), { drag: 1.6, gravity: 4, alpha: 0.5 });
  }

  addFlash(pos, radius, life, color) {
    const mesh = new THREE.Mesh(
      this._sphereGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2.6),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(radius);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life, maxLife: life, radius });
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

    for (const s of this.lights) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const t = Math.max(s.life, 0) / s.max;
      s.light.intensity = s.peak * t * t;
    }

    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      const t = Math.max(s.life, 0) / s.maxLife;
      if (t <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.sprites.splice(i, 1);
        continue;
      }
      const k = 1 - t;
      s.mesh.scale.set(
        s.from.x + (s.to.x - s.from.x) * k,
        s.from.y + (s.to.y - s.from.y) * k,
        s.from.z + (s.to.z - s.from.z) * k
      );
      s.mesh.material.opacity = s.opacity * Math.pow(t, s.fade);
      if (s.spin) s.mesh.rotation.z += s.spin * dt;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const t = f.life / f.maxLife;
      if (t <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.mesh.material.opacity = t;
      f.mesh.scale.setScalar(f.radius * (1 + (1 - t) * 1.6));
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
