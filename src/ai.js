import * as THREE from 'three';
import { angleDelta, clamp, rand, TAU } from './math.js';
import { ARENA_RADIUS } from './world.js';

const _v = new THREE.Vector3();

/** Enemy captain: keeps its distance band, shoots with a human-ish error. */
export class AI {
  constructor(ship, game, skill = 0.5) {
    this.ship = ship;
    this.game = game;
    this.skill = skill;               // 0 = rookie, 1 = veteran
    this.target = null;
    this.retarget = 0;
    this.circleDir = Math.random() < 0.5 ? -1 : 1;
    this.reaction = rand(0.3, 0.9);
    this.aim = new THREE.Vector3();
    this.errorPhase = rand(0, TAU);
    this.fireDelay = ship.weapons.map(() => rand(0.5, 2.5));
  }

  _pickTarget() {
    const s = this.ship;
    let best = null;
    let bestScore = Infinity;
    for (const other of this.game.ships) {
      if (!other.alive || other.team === s.team) continue;
      if (other.stealth > 0) continue;
      let d = other.pos.distanceTo(s.pos);
      if (other.submerged) d *= 2.2;          // hard to find
      if (other.isPlayer) d *= 0.88;          // the player draws fire, but not all of it
      if (d < bestScore) {
        bestScore = d;
        best = other;
      }
    }
    return best;
  }

  update(dt) {
    const s = this.ship;
    if (!s.alive) return;

    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.target = this._pickTarget();
      this.retarget = rand(1.5, 3.0);
    }
    s.lockTarget = this.target;

    if (!this.target) {
      s.throttleInput = 0.4;
      s.rudderInput = Math.sin(this.game.time * 0.2 + this.errorPhase) * 0.4;
      return;
    }

    const t = this.target;
    const toT = _v.copy(t.pos).sub(s.pos);
    const dist = toT.length();
    const bearing = Math.atan2(toT.x, toT.z);

    // --- steering
    const pref = s.def.preferredRange;
    let want;
    if (dist > pref * 1.2) want = bearing;
    else if (dist < pref * 0.65) want = bearing + Math.PI;
    else want = bearing + this.circleDir * 1.35;   // broadside orbit

    // stay inside the arena
    const r = Math.hypot(s.pos.x, s.pos.z);
    if (r > ARENA_RADIUS * 0.86) want = Math.atan2(-s.pos.x, -s.pos.z);

    // island avoidance
    for (const isl of this.game.islands) {
      const ahead = 60 + s.def.hull.length;
      const px = s.pos.x + Math.sin(s.heading) * ahead;
      const pz = s.pos.z + Math.cos(s.heading) * ahead;
      if (Math.hypot(px - isl.x, pz - isl.z) < isl.radius + s.def.hull.beam * 2) {
        const away = Math.atan2(s.pos.x - isl.x, s.pos.z - isl.z);
        want = away;
        break;
      }
    }

    const err = angleDelta(s.heading, want);
    s.rudderInput = clamp(err * 1.8, -1, 1);
    const hurt = s.healthRatio;
    s.throttleInput = Math.abs(err) > 1.5 ? 0.55 : hurt < 0.3 ? 1 : 0.85;

    // --- gunnery
    this.errorPhase += dt * 1.7;
    for (let slot = 0; slot < s.weapons.length; slot++) {
      const w = s.weapons[slot];
      const def = w.def;
      if (def.intercepts) continue;                 // CIWS defends itself
      this.fireDelay[slot] -= dt;
      if (w.ammo <= 0 && w.reloading <= 0) s.reload(slot);
      if (dist > def.range * 0.95) continue;
      if (def.kind === 'torpedo' && dist > def.range * 0.7) continue;
      if (!s.canFire(slot) || this.fireDelay[slot] > 0) continue;

      const speed = def.speed;
      let lead = dist / speed;
      for (let i = 0; i < 2; i++) {
        _v.copy(t.pos).addScaledVector(t.velocity, lead);
        lead = _v.distanceTo(s.pos) / speed;
      }
      const miss = (1 - this.skill) * 46 + Math.sin(this.errorPhase) * 14 * (1 - this.skill);
      this.aim.copy(_v);
      this.aim.x += Math.cos(this.errorPhase * 1.3) * miss;
      this.aim.z += Math.sin(this.errorPhase * 0.9) * miss;
      this.aim.y = t.pos.y + t.def.hull.deck * 0.5;
      s.aimPoint.copy(this.aim);

      if (s.fire(slot)) this.fireDelay[slot] = rand(0.4, 1.6) * (2 - this.skill);
    }

    // keep the turrets tracking even between salvos
    if (s.weapons.every((w) => w.queue === 0)) {
      const speed = s.weapons[0].def.speed;
      let lead = dist / speed;
      _v.copy(t.pos).addScaledVector(t.velocity, lead);
      _v.y = t.pos.y + t.def.hull.deck * 0.5;
      s.aimPoint.lerp(_v, clamp(dt * 3, 0, 1));
    }

    // --- special abilities
    if (s.specialCooldown <= 0) {
      const id = s.special.id;
      const inbound = this.game.projectiles.list.some(
        (p) => p.team !== s.team && (p.kind === 'missile' || p.kind === 'drone') && p.pos.distanceTo(s.pos) < 700
      );
      if (id === 'repair' && hurt < 0.55) s.useSpecial(this.game);
      else if (id === 'stealth' && (hurt < 0.5 || dist < pref * 0.5)) s.useSpecial(this.game);
      else if (id === 'boost' && (hurt < 0.4 || dist > pref * 1.6)) s.useSpecial(this.game);
      else if (id === 'aegis' && inbound) s.useSpecial(this.game);
      else if (id === 'barrage' && dist < s.weapons[0].def.range * 0.8) s.useSpecial(this.game);
      else if (id === 'dive') {
        const wantDive = hurt < 0.7 || dist < pref * 1.2;
        if (wantDive !== s.targetDepth > 0) s.useSpecial(this.game);
      }
    }
  }
}
