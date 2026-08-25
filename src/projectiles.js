import * as THREE from 'three';
import { GRAVITY } from './weapons.js';
import { clamp, rand, waveHeight } from './math.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const C_MISSILE = new THREE.Color(0xff9a3c).multiplyScalar(2.4);
const C_RAIL = new THREE.Color(0x7fe6ff).multiplyScalar(3.0);

function glow(color, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.1,
  });
}

function makeMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'shell') {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.5, 4, 8), glow(0xffd39b, 2.2));
    m.rotation.x = Math.PI / 2;
    g.add(m);
  } else if (kind === 'rail') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 6), glow(0x8ff0ff, 3.2));
    m.rotation.x = Math.PI / 2;
    g.add(m);
  } else if (kind === 'flak') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), glow(0xfff0b0, 2.6)));
  } else if (kind === 'missile') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 4.4, 8), new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: 0.6 }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x2f3438 }));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 2.7;
    g.add(nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.9), new THREE.MeshStandardMaterial({ color: 0x9aa2a8 }));
      fin.position.z = -1.9;
      fin.rotation.z = (i * Math.PI) / 2;
      fin.position.y = 0.5;
      fin.applyMatrix4(new THREE.Matrix4().makeRotationZ(0));
      const holder = new THREE.Group();
      holder.rotation.z = (i * Math.PI) / 2;
      holder.add(fin);
      g.add(holder);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.2, 7), glow(0xffb257, 3));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -3.2;
    g.add(flame);
    g.userData.flame = flame;
  } else if (kind === 'torpedo') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.6, metalness: 0.4 }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 8, 6), new THREE.MeshStandardMaterial({ color: 0x9b3225 }));
    head.position.z = 2.6;
    g.add(head);
  } else if (kind === 'drone') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 6.5, 7), new THREE.MeshStandardMaterial({ color: 0x6a7278, metalness: 0.4, roughness: 0.6 }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 7), new THREE.MeshStandardMaterial({ color: 0x555c62 }));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 4.0;
    g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.16, 2.0), new THREE.MeshStandardMaterial({ color: 0x5f666e }));
    wing.position.z = -0.4;
    g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 1.3), new THREE.MeshStandardMaterial({ color: 0x8d959b }));
    tail.position.set(0, 0.7, -2.9);
    g.add(tail);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 6), glow(0x9fd8ff, 2));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -3.6;
    g.add(flame);
  }
  return g;
}

export class Projectiles {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.list = [];
    this.pool = {};
    this._localHit = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  _acquire(kind) {
    const pool = (this.pool[kind] ||= []);
    const mesh = pool.pop() ?? makeMesh(kind);
    mesh.visible = true;
    this.scene.add(mesh);
    return mesh;
  }

  _release(p) {
    this.scene.remove(p.mesh);
    (this.pool[p.kind] ||= []).push(p.mesh);
  }

  /**
   * @param {object} o {kind, weapon, pos, dir, speed, owner, target, damage}
   */
  spawn(o) {
    const w = o.weapon;
    const p = {
      kind: w.kind,
      weapon: w,
      owner: o.owner,
      team: o.owner.team,
      target: o.target ?? null,
      pos: o.pos.clone(),
      vel: o.dir.clone().normalize().multiplyScalar(o.speed ?? w.speed),
      life: w.lifetime ?? 14,
      age: 0,
      damage: o.damage ?? w.damage,
      pierced: 0,
      local: o.local !== false,   // ghost rounds from other clients do no damage
      phase: o.vertical ? 'boost' : 'run',
      boost: o.vertical ? 0.55 : 0,
      trailTimer: 0,
      mesh: this._acquire(w.kind),
      alive: true,
    };
    p.mesh.position.copy(p.pos);
    this.list.push(p);
    return p;
  }

  /** Ship-space box test - much fairer than a sphere on a 150 m carrier. */
  _hitShip(p, ship, dt) {
    if (!ship.alive || ship.team === p.team) return false;
    if (ship.submerged && (p.kind === 'shell' || p.kind === 'flak' || p.kind === 'rail')) return false;
    _a.copy(p.pos).sub(ship.pos);
    const c = Math.cos(ship.heading);
    const s = Math.sin(ship.heading);
    const x = _a.x * c - _a.z * s;
    const z = _a.x * s + _a.z * c;
    const hull = ship.def.hull;
    const marginZ = Math.abs(p.vel.z) * dt * 0.5 + 2;
    if (Math.abs(x) > hull.beam * 0.62 + 1.5) return false;
    if (Math.abs(z) > hull.length * 0.52 + marginZ) return false;
    const dy = p.pos.y - ship.pos.y;
    if (dy > hull.deck + 12 || dy < -hull.draft - 3) return false;
    this._localHit.set(x, dy, z);
    return true;
  }

  update(dt, time) {
    const game = this.game;
    const fx = game.effects;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      p.life -= dt;

      if (p.kind === 'missile' || p.kind === 'drone') this._guide(p, dt);
      else if (p.kind === 'torpedo') this._guideTorpedo(p, dt, time);
      else if (p.kind === 'shell') p.vel.y -= GRAVITY * dt;

      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      const speed = p.vel.length();
      if (speed > 0.001) {
        _a.copy(p.vel).divideScalar(speed);
        p.mesh.quaternion.setFromUnitVectors(FORWARD, _a);
      }

      // trails
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        if (p.kind === 'missile') {
          p.trailTimer = 0.02;
          fx.smokeTrail(p.pos, undefined, 1.6, 1.3, 0.42);
          fx.emberTrail(p.pos, C_MISSILE);
        } else if (p.kind === 'drone') {
          p.trailTimer = 0.06;
          fx.smokeTrail(p.pos, undefined, 1.2, 0.9, 0.22);
        } else if (p.kind === 'torpedo') {
          p.trailTimer = 0.05;
          _b.set(p.pos.x, waveHeight(p.pos.x, p.pos.z, time) + 0.2, p.pos.z);
          fx.bubbles(_b);
        } else if (p.kind === 'rail') {
          p.trailTimer = 0.01;
          fx.emberTrail(p.pos, C_RAIL);
        } else if (p.kind === 'shell') {
          p.trailTimer = 0.05;
          fx.emberTrail(p.pos, C_MISSILE);
        }
      }

      let done = false;

      // ship hits
      for (const ship of game.ships) {
        if (this._hitShip(p, ship, dt)) {
          if (p.local) {
            game.damage(ship, p.damage, p.owner, p.pos);
            if (p.weapon.splashDamage) game.splashDamage(p.pos, p.weapon.splash, p.weapon.splashDamage, p.owner, ship);
          }
          // impact dressing depends on what hit what and at which angle
          const back = this._normal.copy(p.vel).normalize().negate();
          if (p.kind === 'flak') {
            fx.addFlash(p.pos, 1.0, 0.06, 0xfff1b8);
            fx.ricochet(p.pos, back, 0.4);
          } else if (p.kind === 'torpedo') {
            fx.explosion(p.pos, 2.4);
            fx.waterColumn(p.pos, 3.0);
            ship.onHit(p.pos, 2.2, this._localHit);
          } else if (p.kind === 'missile' || p.kind === 'drone') {
            fx.explosion(p.pos, 1.5);
            fx.impact(p.pos, back, 1.6, 'missile');
            ship.onHit(p.pos, 1.6, this._localHit);
          } else {
            // shallow angle on the ship's side plating deflects the round
            const side = Math.sign(this._localHit.x) || 1;
            const c = Math.cos(ship.heading);
            const sn = Math.sin(ship.heading);
            const nx = c * side;
            const nz = -sn * side;
            const graze = Math.abs(back.x * nx + back.z * nz);
            const scale = p.kind === 'rail' ? 1.5 : 0.55 + p.damage / 420;
            if (graze < 0.28 && Math.abs(this._localHit.y) < ship.def.hull.deck) {
              fx.ricochet(p.pos, back, scale);
              fx.impact(p.pos, back, scale * 0.5, p.kind);
            } else {
              fx.impact(p.pos, back, scale, p.kind);
              ship.onHit(p.pos, scale, this._localHit);
            }
          }
          game.onImpact(ship, p, this._localHit);
          if (p.weapon.pierce && p.pierced < 1) {
            p.pierced++;
            p.damage *= 0.55;
          } else {
            done = true;
          }
          break;
        }
      }

      // CIWS intercept: flak kills missiles, drones and torpedoes
      if (!done && p.weapon.intercepts) {
        for (const q of this.list) {
          if (q === p || !q.alive || q.team === p.team) continue;
          if (q.kind !== 'missile' && q.kind !== 'drone') continue;   // torpedoes run too deep
          if (p.pos.distanceToSquared(q.pos) < 20) {
            done = true;
            if (Math.random() < 0.45) {          // not every burst connects
              q.alive = false;
              fx.explosion(q.pos, 0.7, { ring: false });
              game.onIntercept(p.owner);
            }
            break;
          }
        }
      }

      // terrain / water
      if (!done) {
        if (p.kind !== 'torpedo' && p.pos.y < waveHeight(p.pos.x, p.pos.z, time)) {
          if (p.kind === 'flak') {
            done = true;
          } else {
            if (p.kind === 'shell' || p.kind === 'rail') fx.waterColumn(p.pos, p.weapon.damage > 250 ? 1.5 : 1.0);
            else fx.waterSplash(p.pos, 2.0);
            if (p.local && p.weapon.splashDamage) game.splashDamage(p.pos, p.weapon.splash * 0.7, p.weapon.splashDamage * 0.5, p.owner);
            done = true;
          }
        } else {
          for (const isl of game.islands) {
            if (p.pos.y < 60 && Math.hypot(p.pos.x - isl.x, p.pos.z - isl.z) < isl.radius) {
              fx.explosion(p.pos, 1.2);
              done = true;
              break;
            }
          }
        }
      }

      if (!p.alive || done || p.life <= 0 || Math.abs(p.pos.x) > 6000 || Math.abs(p.pos.z) > 6000) {
        if (p.life <= 0 && p.alive && !done && (p.kind === 'missile' || p.kind === 'drone')) {
          fx.explosion(p.pos, 1.2);
        }
        p.alive = false;
        this._release(p);
        this.list.splice(i, 1);
      }
    }
  }

  _guide(p, dt) {
    const w = p.weapon;
    const speed = p.vel.length();
    const maxSpeed = w.speed;
    const target = p.target && p.target.alive ? p.target : null;

    if (p.phase === 'boost') {
      p.boost -= dt;
      p.vel.y += 26 * dt;
      if (p.boost <= 0) p.phase = 'run';
    }

    if (target) {
      const dist = p.pos.distanceTo(target.pos);
      const lead = Math.min(dist / Math.max(speed, 1), 3);
      _b.copy(target.pos).addScaledVector(target.velocity, lead);
      const terminal = dist < (p.kind === 'drone' ? 260 : 170);
      if (!terminal) _b.y = Math.max(target.pos.y + 6, w.cruiseHeight ?? 40);
      else _b.y = target.pos.y + target.def.hull.deck * 0.5;

      _c.copy(_b).sub(p.pos);
      const len = _c.length();
      if (len > 0.001) {
        _c.divideScalar(len);
        _a.copy(p.vel).normalize();
        const turn = (w.turnRate ?? 2) * dt * (p.phase === 'boost' ? 0.35 : 1);
        _a.lerp(_c, clamp(turn, 0, 1)).normalize();
        p.vel.copy(_a).multiplyScalar(speed);
      }
    } else if (p.phase !== 'boost') {
      // no lock: keep flying straight and level
      p.vel.y += (p.pos.y < (w.cruiseHeight ?? 40) ? 8 : -8) * dt;
    }

    if (speed < maxSpeed) p.vel.setLength(Math.min(maxSpeed, speed + (w.accel ?? 80) * dt));
  }

  _guideTorpedo(p, dt, time) {
    const w = p.weapon;
    const target = p.target && p.target.alive ? p.target : null;
    p.pos.y = waveHeight(p.pos.x, p.pos.z, time) - 1.1;
    p.vel.y = 0;
    if (target) {
      const dist = p.pos.distanceTo(target.pos);
      if (dist < 700) {
        _b.copy(target.pos).addScaledVector(target.velocity, dist / Math.max(p.vel.length(), 1));
        _b.y = p.pos.y;
        _c.copy(_b).sub(p.pos).normalize();
        _a.copy(p.vel).normalize();
        _a.lerp(_c, clamp(w.turnRate * dt, 0, 1)).normalize();
        _a.y = 0;
        p.vel.copy(_a.normalize()).multiplyScalar(w.speed);
      }
    }
  }

  clear() {
    for (const p of this.list) this._release(p);
    this.list.length = 0;
  }
}
