import * as THREE from 'three';
import { buildShipMesh, addTeamMarkings } from './shipMesh.js';
import { WEAPONS, weaponRuntime, GRAVITY } from './weapons.js';
import { angleDelta, clamp, damp, lerp, rand, waveHeight, waveSlope, TAU } from './math.js';
import { ARENA_RADIUS } from './world.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _mp = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const _slope = [0, 0];

let nextId = 1;

export class Ship {
  constructor(def, team, scene, opts = {}) {
    this.id = nextId++;
    this.def = def;
    this.team = team;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name ?? def.name;

    const built = buildShipMesh(def);
    this.group = built.root;
    this.mounts = built.mounts;
    this.radars = built.radars;
    this.funnels = built.funnels;
    scene.add(this.group);
    this.scene = scene;

    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0);
    this.velocity = new THREE.Vector3();
    this.heading = opts.heading ?? 0;
    this.speed = 0;
    this.throttle = 0;
    this.rudder = 0;
    this.throttleInput = 0;
    this.rudderInput = 0;

    this.maxHp = Math.round(def.hp * (opts.hpMul ?? 1));
    this.hp = this.maxHp;
    this.alive = true;
    this.sinkTimer = 0;

    this.weapons = def.weapons.map(weaponRuntime);
    this.ciwsIndex = this.weapons.findIndex((w) => w.def.intercepts);
    this.aimPoint = new THREE.Vector3(0, 0, 0);
    this.lockTarget = null;

    this.special = def.special;
    this.specialCooldown = 0;
    this.specialTimer = 0;
    this.damageMul = 1;
    this.fireRateMul = 1;
    this.speedMul = 1;
    this.stealth = 0;

    this.depth = 0;         // submarines only
    this.targetDepth = 0;
    this.submerged = false;

    this.wakeTimer = 0;
    this.smokeTimer = 0;
    this.outOfBounds = 0;
    this.lastHitBy = null;
    this.kills = 0;

    this.radius = def.hull.length * 0.5;

    // --- networking
    this.netId = opts.netId ?? null;
    this.remote = !!opts.remote;         // driven by another client
    this.owned = opts.owned ?? true;     // this client decides its hit points
    this.netTarget = { x: this.pos.x, z: this.pos.z, h: this.heading };
    this.teamColor = opts.teamColor ?? (team === 0 ? 0x49b6ff : 0xff5340);
    addTeamMarkings(this.group, def, this.teamColor);
  }

  /** Latest snapshot from the owning client. */
  applyNetState(s) {
    this.netTarget.x = s.x;
    this.netTarget.z = s.z;
    this.netTarget.h = s.h;
    this.speed = s.sp;
    if (typeof s.hp === 'number') this.hp = s.hp;
    this.targetDepth = s.d ?? 0;
    if (s.ax !== undefined) this.aimPoint.set(s.ax, s.ay, s.az);
    this.throttle = s.th ?? this.throttle;
    this.rudder = s.ru ?? this.rudder;
  }

  netState() {
    return {
      x: +this.pos.x.toFixed(2),
      z: +this.pos.z.toFixed(2),
      h: +this.heading.toFixed(3),
      sp: +this.speed.toFixed(2),
      hp: Math.round(this.hp),
      d: +this.depth.toFixed(2),
      th: +this.throttle.toFixed(2),
      ru: +this.rudder.toFixed(2),
      ax: +this.aimPoint.x.toFixed(1),
      ay: +this.aimPoint.y.toFixed(1),
      az: +this.aimPoint.z.toFixed(1),
    };
  }

  /** Smooth follow of the networked position, with dead reckoning in between. */
  _netDrive(dt) {
    const t = this.netTarget;
    const k = 1 - Math.exp(-9 * dt);
    this.heading += angleDelta(this.heading, t.h) * k;
    const fwd = this.forward;
    t.x += fwd.x * this.speed * dt;
    t.z += fwd.z * this.speed * dt;
    this.pos.x += (t.x - this.pos.x) * k;
    this.pos.z += (t.z - this.pos.z) * k;
    this.velocity.copy(fwd).multiplyScalar(this.speed);
  }

  get forward() {
    return _v.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get healthRatio() {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  // --- weapons ------------------------------------------------------------

  weaponAt(slot) {
    return this.weapons[slot];
  }

  canFire(slot) {
    const w = this.weapons[slot];
    if (!w || !this.alive) return false;
    if (w.def.surfaceOnly && this.submerged) return false;
    return w.cooldown <= 0 && w.reloading <= 0 && w.ammo > 0 && w.queue === 0;
  }

  /** Begin a salvo. The rounds themselves leave the barrels over time. */
  fire(slot) {
    if (!this.canFire(slot)) return false;
    const w = this.weapons[slot];
    w.queue = Math.min(w.def.salvo, w.ammo);
    w.queueTimer = 0;
    return true;
  }

  reload(slot) {
    const w = this.weapons[slot];
    if (w && w.reloading <= 0 && w.ammo < w.def.mag) {
      w.reloading = w.def.reload;
      w.queue = 0;
    }
  }

  _mountsFor(weaponId) {
    return this.mounts.filter((m) => m.weapon === weaponId);
  }

  /** Barrel elevation that puts a shell on the aim point. */
  _elevation(dist, dy, speed) {
    const v2 = speed * speed;
    const disc = v2 * v2 - GRAVITY * (GRAVITY * dist * dist + 2 * dy * v2);
    if (disc < 0) return 0.62; // out of range: max the elevation
    return Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * dist));
  }

  /**
   * World-space direction that puts a round on `point` from `from`:
   * a ballistic arc for shells, a straight line for everything else.
   */
  _solve(from, point, w, out) {
    out.copy(point).sub(from);
    const dy = out.y;
    out.y = 0;
    const dist = Math.max(out.length(), 1);
    out.divideScalar(dist);
    const elev = w.kind === 'shell' ? this._elevation(dist, dy, w.speed) : Math.atan2(dy, dist);
    out.multiplyScalar(Math.cos(elev)).y = Math.sin(elev);
    return out;
  }

  /**
   * Point one mount at a world position. The solution is computed in world
   * space and then rotated into the hull frame, so the guns stay stabilised
   * while the ship pitches and rolls in the swell.
   */
  _aimMountAt(m, point, dt, slew) {
    const w = WEAPONS[m.weapon];
    m.root.getWorldPosition(_mp);
    this._solve(_mp, point, w, _dir);
    _dir.applyQuaternion(_inv);   // world -> hull local

    const base = m.rear ? Math.PI : 0;
    let wantYaw = Math.atan2(_dir.x, _dir.z) - base;
    wantYaw = Math.atan2(Math.sin(wantYaw), Math.cos(wantYaw));
    const limit = m.type === 'tube' ? 1.15 : 2.62;
    const center = m.type === 'tube' ? Math.sign(m.def.pos[0] || 1) * 0.85 : 0;
    wantYaw = clamp(wantYaw, center - limit, center + limit);
    const wantPitch = -clamp(Math.asin(clamp(_dir.y, -1, 1)), -0.22, 1.05);

    if (!m.initialised) {
      m.initialised = true;
      m.yaw.rotation.y = wantYaw;
      if (m.pitch) m.pitch.rotation.x = wantPitch;
    } else {
      const err = angleDelta(m.yaw.rotation.y, wantYaw);
      const rate = slew * dt;
      m.yaw.rotation.y += clamp(err, -rate, rate);
      if (m.pitch) m.pitch.rotation.x = damp(m.pitch.rotation.x, wantPitch, 9, dt);
    }
    m.aimError = Math.abs(angleDelta(m.yaw.rotation.y, wantYaw));
    m.pitchError = m.pitch ? Math.abs(m.pitch.rotation.x - wantPitch) : 0;
  }

  /** Every mount tracks the ship's aim point unless the CIWS takes over. */
  _aimMounts(dt) {
    _inv.copy(this.group.quaternion).invert();
    for (const m of this.mounts) {
      if (!m.yaw || m.type === 'ciws') continue;
      this._aimMountAt(m, this.aimPoint, dt, m.type === 'tube' ? 1.3 : 1.4);
    }
  }

  _updateWeapons(dt, game) {
    for (let slot = 0; slot < this.weapons.length; slot++) {
      const w = this.weapons[slot];
      const rate = this.fireRateMul;
      if (w.cooldown > 0) w.cooldown -= dt * rate;
      if (w.reloading > 0) {
        w.reloading -= dt * rate;
        if (w.reloading <= 0) w.ammo = w.def.mag;
      }
      if (w.queue > 0) {
        w.queueTimer -= dt;
        if (w.queueTimer <= 0) {
          if (this._fireRound(w, game)) {
            w.queue--;
            w.ammo--;
            w.queueTimer = w.def.salvoDelay;
            w.cooldown = w.def.cooldown;
            if (w.ammo <= 0) {
              w.queue = 0;
              w.reloading = w.def.reload;
            }
          } else {
            w.queueTimer = 0.1; // mount not lined up yet - wait, keep the ammo
            w.holdTime = (w.holdTime ?? 0) + 0.1;
            if (w.holdTime > 2.5) {
              w.queue = 0;
              w.holdTime = 0;
            }
          }
        }
      } else {
        w.holdTime = 0;
      }
    }
  }

  /** Fire a single round from the next ready mount of this weapon. */
  _fireRound(w, game) {
    const def = w.def;
    const mounts = this._mountsFor(w.id);
    if (!mounts.length) return false;

    let mount = null;
    for (let i = 0; i < mounts.length; i++) {
      const m = mounts[(w.mountIndex = ((w.mountIndex ?? -1) + 1) % mounts.length)];
      if (m.vertical || ((m.aimError ?? 9) < 0.1 && (m.pitchError ?? 9) < 0.12)) {
        mount = m;
        break;
      }
    }
    if (!mount) return false;

    const muzzle = mount.muzzles[mount.next % mount.muzzles.length];
    mount.next++;
    muzzle.getWorldPosition(_v);

    let dir;
    if (mount.vertical) {
      dir = new THREE.Vector3(rand(-0.12, 0.12), 1, rand(-0.12, 0.12)).normalize();
    } else if (def.intercepts && this.ciwsTarget) {
      const flight = this.ciwsTarget.pos.distanceTo(_v) / def.speed;
      _lead.copy(this.ciwsTarget.pos).addScaledVector(this.ciwsTarget.vel, flight);
      dir = this._solve(_v, _lead, def, _w.clone());
    } else {
      // fire along the computed solution - the barrel is trained on it anyway
      dir = this._solve(_v, this.aimPoint, def, _w.clone());
    }
    const spread = def.spread ?? 0;
    dir.x += rand(-spread, spread);
    dir.y += rand(-spread, spread) * (mount.vertical ? 0.2 : 1);
    dir.z += rand(-spread, spread);
    dir.normalize();

    const target = def.needsLock || def.kind === 'torpedo' ? this.lockTarget : null;
    game.projectiles.spawn({
      weapon: def,
      pos: _v,
      dir,
      owner: this,
      target: target && target.alive ? target : null,
      vertical: mount.vertical,
      damage: def.damage,
    });

    if (def.kind === 'shell' || def.kind === 'rail') {
      game.effects.muzzleFlash(_v, dir, def.kind === 'rail' ? 1.6 : mount.def.scale ?? 1);
      if (mount.pitch) mount.pitch.position.z -= 0.25; // recoil, sprung back below
      mount.recoil = 0.35;
    } else if (def.kind === 'flak') {
      game.effects.addFlash(_v, 0.7, 0.05, 0xfff3c0);
    } else if (def.kind === 'missile' || def.kind === 'drone') {
      game.effects.explosion(_v, 0.35, { ring: false });
    } else if (def.kind === 'torpedo') {
      game.effects.waterSplash(_v, 1.2);
    }
    this._lastVertical = mount.vertical;
    game.onShipFired(this, def, _v, dir);
    return true;
  }

  /** CIWS fires itself at whatever is inbound. */
  _autoDefense(dt, game) {
    if (this.ciwsIndex < 0) return;
    const w = this.weapons[this.ciwsIndex];
    const range = w.def.range * (this.shieldBoost ? 1.35 : 1);
    let best = null;
    let bestD = range * range;
    for (const p of game.projectiles.list) {
      if (p.team === this.team) continue;
      if (p.kind !== 'missile' && p.kind !== 'drone') continue;   // torpedoes run too deep
      const d = p.pos.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    this.ciwsTarget = best;

    let ready = false;
    for (const m of this.mounts) {
      if (m.type !== 'ciws' || !m.yaw) continue;
      // lead the interceptor onto the incoming round
      if (best) {
        const flight = Math.sqrt(bestD) / w.def.speed;
        _lead.copy(best.pos).addScaledVector(best.vel, flight);
      } else {
        _lead.copy(this.aimPoint);
      }
      this._aimMountAt(m, _lead, dt, 5.0);
      if (m.aimError < 0.05 && m.pitchError < 0.05) ready = true;
    }
    if (best && ready && this.canFire(this.ciwsIndex)) this.fire(this.ciwsIndex);
  }

  // --- specials -----------------------------------------------------------

  useSpecial(game) {
    if (!this.alive || this.specialCooldown > 0) return false;
    const sp = this.special;
    if (sp.id === 'dive') {
      this.targetDepth = this.targetDepth > 0 ? 0 : 9;
      this.specialCooldown = sp.cooldown;
      game.notify(this, this.targetDepth > 0 ? 'TAUCHT AB' : 'AUFTAUCHEN');
      return true;
    }
    this.specialCooldown = sp.cooldown;
    this.specialTimer = sp.duration;
    if (sp.id === 'repair') this.healPerSecond = sp.heal / sp.duration;
    game.notify(this, sp.name.toUpperCase() + ' AKTIV');
    return true;
  }

  _updateSpecial(dt) {
    if (this.specialCooldown > 0) this.specialCooldown -= dt;
    this.damageMul = 1;
    this.fireRateMul = 1;
    this.speedMul = 1;
    this.stealth = 0;
    this.shieldBoost = false;

    if (this.specialTimer > 0) {
      this.specialTimer -= dt;
      const id = this.special.id;
      if (id === 'barrage') this.fireRateMul = 2.1;
      else if (id === 'stealth') this.stealth = 1;
      else if (id === 'boost') this.speedMul = this.special.factor;
      else if (id === 'aegis') {
        this.damageMul = 0.45;
        this.shieldBoost = true;
      } else if (id === 'repair') {
        this.hp = Math.min(this.maxHp, this.hp + this.healPerSecond * dt);
      }
    }
    if (this.stealth > 0) {
      this.group.traverse((o) => {
        if (o.isMesh && o.material && !o.material._noFade) {
          o.material.transparent = true;
          o.material.opacity = 0.28;
        }
      });
      this._faded = true;
    } else if (this._faded) {
      this.group.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material.opacity = 1;
          o.material.transparent = false;
        }
      });
      this._faded = false;
    }
  }

  // --- physics ------------------------------------------------------------

  _drive(dt, game) {
    const def = this.def;
    const maxSpeed = def.maxSpeed * this.speedMul * (this.submerged ? 0.78 : 1);
    this.throttle = damp(this.throttle, clamp(this.throttleInput, -0.45, 1), 2.5, dt);
    this.rudder = damp(this.rudder, clamp(this.rudderInput, -1, 1), 3.2, dt);

    const wanted = maxSpeed * this.throttle;
    const accel = def.accel * (wanted > this.speed ? 1 : 1.6);
    this.speed += clamp(wanted - this.speed, -accel * dt, accel * dt);
    this.speed *= Math.exp(-0.08 * dt);

    const agility = clamp(0.25 + Math.abs(this.speed) / def.maxSpeed, 0, 1.25);
    this.heading += this.rudder * def.turnRate * agility * dt * Math.sign(this.speed || 1);
    this.heading = (this.heading + TAU) % TAU;

    const fwd = this.forward;
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.z * dt;

    // islands
    for (const isl of game.islands) {
      const dx = this.pos.x - isl.x;
      const dz = this.pos.z - isl.z;
      const d = Math.hypot(dx, dz);
      const min = isl.radius + this.def.hull.beam * 0.8;
      if (d < min) {
        const push = (min - d) / Math.max(d, 0.001);
        this.pos.x += dx * push;
        this.pos.z += dz * push;
        if (Math.abs(this.speed) > 4) {
          game.damage(this, Math.abs(this.speed) * 4 * dt * 10, null, this.pos);
          game.effects.waterSplash(this.pos, 1.4);
        }
        this.speed *= 0.85;
      }
    }

    // arena boundary
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS) {
      this.outOfBounds += dt;
      const k = ARENA_RADIUS / r;
      this.pos.x = lerp(this.pos.x, this.pos.x * k, 0.9 * dt * 3);
      this.pos.z = lerp(this.pos.z, this.pos.z * k, 0.9 * dt * 3);
      game.damage(this, this.maxHp * 0.035 * dt, null, this.pos);
    } else {
      this.outOfBounds = 0;
    }
  }

  _float(dt, time) {
    const hull = this.def.hull;
    const fwd = this.forward.clone();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const halfL = hull.length * 0.42;
    const halfB = hull.beam * 0.6;

    const hC = waveHeight(this.pos.x, this.pos.z, time);
    const hF = waveHeight(this.pos.x + fwd.x * halfL, this.pos.z + fwd.z * halfL, time);
    const hA = waveHeight(this.pos.x - fwd.x * halfL, this.pos.z - fwd.z * halfL, time);
    const hR = waveHeight(this.pos.x + right.x * halfB, this.pos.z + right.z * halfB, time);
    const hL = waveHeight(this.pos.x - right.x * halfB, this.pos.z - right.z * halfB, time);

    this.depth = damp(this.depth, this.targetDepth, 1.1, dt);
    this.submerged = this.depth > 3.5;

    const inertia = clamp(this.def.hull.length / 90, 0.35, 1.6);
    const targetY = (hC + (hF + hA) * 0.5) * 0.5 - this.depth;
    this.pos.y = damp(this.pos.y, targetY, 6 / inertia, dt);

    const pitch = Math.atan2(hA - hF, halfL * 2) * 0.9;
    const heel = -this.rudder * clamp(Math.abs(this.speed) / this.def.maxSpeed, 0, 1) * 0.22;
    const roll = Math.atan2(hL - hR, halfB * 2) * 0.75 + heel;

    this.group.position.copy(this.pos);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.heading;
    this.group.rotation.x = damp(this.group.rotation.x, pitch, 4, dt);
    this.group.rotation.z = damp(this.group.rotation.z, roll, 4, dt);
    this.group.updateMatrixWorld(true);
  }

  _cosmetics(dt, time, game) {
    for (const r of this.radars) r.rotation.y += r.userData.spin * dt;
    for (const m of this.mounts) {
      if (m.recoil > 0 && m.pitch) {
        m.recoil -= dt;
        m.pitch.position.z = damp(m.pitch.position.z, m.pitchRest, 8, dt);
      }
    }

    const fx = game.effects;
    const sp = Math.abs(this.speed);
    this.wakeTimer -= dt;
    if (this.wakeTimer <= 0 && sp > 1.5 && !this.submerged) {
      this.wakeTimer = 0.045;
      const fwd = this.forward.clone();
      const strength = clamp(sp / this.def.maxSpeed, 0.2, 1) * clamp(this.def.hull.beam / 12, 0.6, 2);
      _v.copy(this.pos).addScaledVector(fwd, -this.def.hull.length * 0.48);
      _v.y = waveHeight(_v.x, _v.z, time) + 0.4;
      fx.wake(_v, this.velocity, strength * 1.2);
      _v.copy(this.pos).addScaledVector(fwd, this.def.hull.length * 0.45);
      _v.y = waveHeight(_v.x, _v.z, time) + 0.4;
      fx.wake(_v, this.velocity, strength * 0.8);
    }
    if (this.submerged) {
      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.12;
        _v.copy(this.pos);
        _v.y = waveHeight(_v.x, _v.z, time) + 0.2;
        fx.bubbles(_v);
      }
    }

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      const hurt = this.healthRatio;
      if (hurt < 0.55 && !this.submerged) {
        this.smokeTimer = lerp(0.06, 0.3, hurt);
        _v.copy(this.pos);
        _v.x += rand(-1, 1) * this.def.hull.beam * 0.4;
        _v.z += rand(-1, 1) * this.def.hull.length * 0.35;
        _v.y += this.def.hull.deck + 1;
        fx.smokeTrail(_v, undefined, rand(3, 6), rand(1.6, 3), hurt < 0.28 ? 0.7 : 0.45);
        if (hurt < 0.25 && Math.random() < 0.3) fx.emberTrail(_v, new THREE.Color(0xff8a3c));
      } else {
        this.smokeTimer = 0.25;
        if (this.funnels.length && !this.submerged && Math.abs(this.throttle) > 0.05) {
          const f = this.funnels[0];
          _v.copy(f).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading).add(this.pos);
          fx.smokeTrail(_v, undefined, rand(2, 3.4), rand(1.4, 2.4), 0.18);
        }
      }
    }
  }

  update(dt, time, game) {
    if (!this.alive) {
      this._sink(dt, time, game);
      return;
    }
    this._updateSpecial(dt);
    if (this.remote) this._netDrive(dt);
    else this._drive(dt, game);
    this._float(dt, time);
    this._aimMounts(dt);
    this._autoDefense(dt, game);
    this._updateWeapons(dt, game);
    this._cosmetics(dt, time, game);
  }

  _sink(dt, time, game) {
    this.sinkTimer += dt;
    this.pos.y -= dt * 2.2;
    this.group.position.copy(this.pos);
    this.group.rotation.z += dt * 0.22;
    this.group.rotation.x += dt * 0.08;
    this.speed = damp(this.speed, 0, 0.8, dt);
    this.pos.x += this.forward.x * this.speed * dt;
    this.pos.z += this.forward.z * this.speed * dt;
    if (this.sinkTimer < 4 && Math.random() < dt * 6) {
      _v.copy(this.pos);
      _v.x += rand(-1, 1) * this.def.hull.beam;
      _v.z += rand(-1, 1) * this.def.hull.length * 0.4;
      _v.y += this.def.hull.deck;
      game.effects.explosion(_v, rand(0.6, 1.5), { ring: false });
    }
    if (this.sinkTimer > 9) this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
