import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { createWorld, ARENA_RADIUS, SUN_DIR } from './world.js';
import { Renderer, QUALITY } from './render.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { WEAPONS } from './weapons.js';
import { Ship } from './ship.js';
import { AI } from './ai.js';
import { SHIPS, SHIP_BY_ID } from './ships.js';
import { clamp, damp, makeRng, rand, waveHeight, TAU } from './math.js';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const ZOOMS = [1.35, 2.2, 3.4];

export class Game {
  constructor(canvas, hud, input, audio) {
    this.canvas = canvas;
    this.hud = hud;
    this.input = input;
    this.audio = audio;

    this.gfx = new Renderer(canvas);
    this.renderer = this.gfx.renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 12000);
    this.gfx.attach(this.scene, this.camera);
    this.spectateTarget = null;

    this.worldSeed = 12345;
    const world = createWorld(this.scene, this.worldSeed);
    this.world = world;
    this.islands = world.islands;
    this.sun = world.sun;
    this.clouds = world.clouds;
    this.scene.environment = this.gfx.environmentFrom(world.sky);

    this.ocean = createOcean({
      sunDir: SUN_DIR,
      fogColor: this.scene.fog.color.getHex(),
      fogDensity: this.scene.fog.density,
    });
    this.ocean.setIslands(this.islands);
    this.scene.add(this.ocean.mesh);
    this.effects = new Effects(this.scene);
    this.projectiles = new Projectiles(this.scene, this);

    this.ships = [];
    this.ais = [];
    this.player = null;
    this.mode = 'preview';
    this.time = 0;
    this.score = 0;
    this.wave = 1;
    this.activeWeapon = 0;
    this.camYaw = 0;
    this.camPitch = 0.28;
    this.zoom = 1;
    this.waveTimer = 0;
    this.overTimer = 0;
    this.stats = { kills: 0, damage: 0, intercepts: 0 };
    this.aimWorld = new THREE.Vector3();
    this.leadPoint = null;
    this.aimInfo = { dist: 0, flight: 0, spread: 0, inRange: false };
    this.zoomOptics = false;
    this.baseFov = 62;
    this.shake = 0;

    // multiplayer
    this.net = null;
    this.pvp = false;
    this.byNetId = new Map();
    this.netTimer = 0;
    this.teamNames = ['Blaue Flotte', 'Rote Flotte'];

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.gfx.resize();
    this.ocean.resize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  cycleQuality() {
    const name = this.gfx.setQuality(this.gfx.quality + 1);
    this.ocean.setReflectionEnabled(this.gfx.quality < 2);
    this.hud.notice(`GRAFIK: ${name}`, 1.4);
  }

  /** Keep the shadow frustum on the action and drift the clouds. */
  _updateSky(dt) {
    const focus = this.player ?? this.previewShip;
    if (!focus) return;
    this.sun.target.position.set(focus.pos.x, 0, focus.pos.z);
    this.sun.position.copy(SUN_DIR).multiplyScalar(900).add(this.sun.target.position);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 4600) c.position.x = -4600;
    }
  }

  /** Every client in a room must see identical islands. */
  rebuildWorld(seed) {
    if (seed === this.worldSeed) return;
    this.worldSeed = seed;
    this.scene.remove(this.world.group);
    this.world.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
    const world = createWorld(this.scene, seed);
    this.world = world;
    this.islands = world.islands;
    this.sun = world.sun;
    this.clouds = world.clouds;
    this.ocean.setIslands(this.islands);
  }

  // --------------------------------------------------------------- setup
  clearShips() {
    for (const s of this.ships) s.dispose();
    this.ships.length = 0;
    this.ais.length = 0;
    this.byNetId.clear();
    this.projectiles.clear();
    this.player = null;
  }

  /** Idle showcase of the selected ship behind the menu. */
  showPreview(def) {
    this.clearShips();
    this.mode = 'preview';
    const ship = new Ship(def, 0, this.scene, { x: 0, z: 0, heading: 0.6 });
    ship.throttleInput = 0.35;
    ship.aimPoint.set(600, 4, 900);
    this.ships.push(ship);
    this.previewShip = ship;
    this.camYaw = 2.2;
    this.camPitch = 0.2;
  }

  start(def) {
    this.clearShips();
    this.pvp = false;
    this.net = null;
    this.matchOver = false;
    this.spectateTarget = null;
    this.mode = 'battle';
    this.score = 0;
    this.wave = 1;
    this.activeWeapon = 0;
    this.stats = { kills: 0, damage: 0, intercepts: 0 };

    const player = new Ship(def, 0, this.scene, { isPlayer: true, x: 0, z: -600, heading: 0 });
    this.player = player;
    this.ships.push(player);
    this.camYaw = 0;
    this.camPitch = 0.26;
    this.zoom = 1;

    this.hud.buildWeaponCards(player);
    this.spawnWave();
    this.hud.notice(`WELLE ${this.wave}`, 2.2);
  }

  /**
   * Team battle against other people. Every client builds the identical roster
   * from the room state; each client simulates only its own ship (and, on the
   * host, the bots that fill the teams).
   */
  startPvp({ net, seed, spawns, players, teamSize = 3 }) {
    this.clearShips();
    this.rebuildWorld(seed);
    this.net = net;
    this.pvp = true;
    this.mode = 'battle';
    this.score = 0;
    this.wave = 1;
    this.activeWeapon = 0;
    this.overShown = false;
    this.stats = { kills: 0, damage: 0, intercepts: 0 };

    const isHost = net.room.host === net.id;
    const rng = makeRng(seed);

    for (const p of players) {
      const def = SHIP_BY_ID[p.ship] ?? SHIPS[0];
      const sp = spawns[p.id] ?? { x: 0, z: p.team === 0 ? -1400 : 1400, h: p.team === 0 ? 0 : Math.PI };
      const mine = p.id === net.id;
      const ship = new Ship(def, p.team, this.scene, {
        x: sp.x, z: sp.z, heading: sp.h,
        isPlayer: mine,
        remote: !mine,
        owned: mine,
        netId: p.id,
        name: p.name,
      });
      this.ships.push(ship);
      this.byNetId.set(p.id, ship);
      if (mine) this.player = ship;
    }

    // Bots fill both fleets. Their roster is derived from the seed, so every
    // client creates the same ones; only the host actually steers them.
    const counts = [0, 0];
    for (const p of players) counts[p.team]++;
    const hostId = net.room.host;
    let n = 0;
    for (const team of [0, 1]) {
      for (let i = counts[team]; i < teamSize; i++) {
        const def = SHIPS[rng.int(0, SHIPS.length - 1)];
        const side = team === 0 ? -1 : 1;
        const ship = new Ship(def, team, this.scene, {
          x: (i - 1) * 520 + rng.range(-90, 90),
          z: side * 1150,
          heading: side > 0 ? Math.PI : 0,
          remote: !isHost,
          owned: isHost,
          netId: `${hostId}:b${n}`,
          name: `${def.name} [Bot]`,
        });
        this.ships.push(ship);
        this.byNetId.set(ship.netId, ship);
        if (isHost) this.ais.push(new AI(ship, this, 0.55));
        n++;
      }
    }

    this.hud.buildWeaponCards(this.player);
    this.hud.notice('GEFECHT LAEUFT', 2);
  }

  /** Wire the room socket into the running battle. */
  attachNet(net) {
    this.net = net;
    net.on('state', (m) => {
      const s = this.byNetId.get(m.id);
      if (s && s.remote) s.applyNetState(m.s);
    });
    net.on('bots', (m) => {
      for (const b of m.b) {
        const s = this.byNetId.get(b.id);
        if (s && s.remote) s.applyNetState(b.s);
      }
    });
    net.on('fire', (m) => this._netFire(m.id, m.f));
    net.on('hit', (m) => {
      const s = this.byNetId.get(m.id);
      if (s && s.owned && s.alive) this.damage(s, m.dmg, this.byNetId.get(m.from) ?? null, s.pos);
    });
    net.on('dead', (m) => {
      const s = this.byNetId.get(m.id);
      if (s && s.alive) this.destroy(s, this.byNetId.get(m.by) ?? null, true);
    });
    net.on('left', (m) => {
      const s = this.byNetId.get(m.id);
      if (s) {
        if (s.alive) this.destroy(s, null);
        this.byNetId.delete(m.id);
      }
    });
  }

  _netFire(netId, f) {
    const ship = this.byNetId.get(netId);
    if (!ship) return;
    const def = WEAPONS[f.w];
    if (!def) return;
    const target = f.tgt ? this.byNetId.get(f.tgt) : null;
    this.projectiles.spawn({
      weapon: def,
      pos: new THREE.Vector3(f.x, f.y, f.z),
      dir: new THREE.Vector3(f.dx, f.dy, f.dz),
      owner: ship,
      target: target && target.alive ? target : null,
      vertical: !!f.v,
      damage: def.damage,
      local: false,
    });
    this.onShipFired(ship, def, new THREE.Vector3(f.x, f.y, f.z), null, true);
  }

  _netTick(dt) {
    if (!this.net || !this.net.connected) return;
    this.netTimer -= dt;
    if (this.netTimer > 0) return;
    this.netTimer = 1 / 15;

    if (this.player && this.player.alive) this.net.send({ t: 'state', s: this.player.netState() });

    if (this.net.room && this.net.room.host === this.net.id) {
      const bots = [];
      for (const s of this.ships) {
        if (s.owned && s !== this.player && s.alive && s.netId) bots.push({ id: s.netId, s: s.netState() });
      }
      if (bots.length) this.net.send({ t: 'bots', b: bots });

      // the host calls the match
      const alive = [0, 0];
      for (const s of this.ships) if (s.alive) alive[s.team]++;
      if (!this.matchOver && (alive[0] === 0 || alive[1] === 0)) {
        this.matchOver = true;
        this.net.send({ t: 'over', winner: alive[0] === 0 ? 1 : 0 });
      }
    }
  }

  spawnWave() {
    const skill = clamp(0.26 + (this.wave - 1) * 0.1, 0, 0.95);
    const hpMul = 1 + (this.wave - 1) * 0.16;
    const others = SHIPS.filter((d) => d.id !== this.player.def.id).sort(() => Math.random() - 0.5);
    const enemyCount = Math.min(3 + Math.floor((this.wave - 1) / 1), 5);
    const enemies = others.slice(0, enemyCount);
    const allies = [...others.slice(enemyCount), this.player.def, ...others].slice(0, 2);

    const place = (def, team, i, n, skillOf, hp) => {
      const spread = team === 1 ? TAU : 1.1;
      const centre = team === 1 ? 0 : Math.PI;
      const a = centre + ((i + 0.5) / n - 0.5) * spread + rand(-0.2, 0.2);
      const d = team === 1 ? rand(1250, 1800) : rand(320, 520);
      const x = Math.cos(a) * d + (team === 1 ? 0 : this.player.pos.x);
      const z = Math.sin(a) * d + (team === 1 ? 0 : this.player.pos.z);
      const ship = new Ship(def, team, this.scene, {
        x, z,
        heading: Math.atan2(-x, -z),
        hpMul: hp,
        name: def.name,
      });
      this.ships.push(ship);
      this.ais.push(new AI(ship, this, skillOf));
      return ship;
    };

    enemies.forEach((def, i) => place(def, 1, i, enemies.length, skill, hpMul));
    allies.forEach((def, i) => {
      const s = place(def, 0, i, allies.length, clamp(skill + 0.1, 0, 0.9), 1);
      s.name = `${def.name} (Flotte)`;
    });
  }

  // -------------------------------------------------------------- combat
  damage(ship, amount, source, point) {
    if (!ship.alive || amount <= 0) return;
    if (this.pvp && !ship.owned) {
      // the owning client is authoritative for its own hit points
      if (source && source.owned && ship.netId) {
        this.net?.send({ t: 'hit', id: ship.netId, dmg: Math.round(amount), w: 0 });
        this.stats.damage += amount;
        this.score += amount * 0.5;
        if (source === this.player && this._hitSound !== this.time) {
          this._hitSound = this.time;
          this.audio.hit();
        }
        if (source === this.player) this.hud.hitMarker(Math.round(amount), this.project(point ?? ship.pos, 6));
      }
      return;
    }
    const armor = 1 - (ship.def.armor - 0.5) * 0.4;
    // the player is outnumbered: give them a standing defensive edge
    const dmg = amount * ship.damageMul * armor * (ship.isPlayer ? 0.72 : 1);
    ship.hp -= dmg;
    if (source) ship.lastHitBy = source;

    if (source === this.player && ship !== this.player) {
      this.stats.damage += dmg;
      this.score += dmg * 0.5;
      if (this._hitSound !== this.time) {
        this._hitSound = this.time;
        this.audio.hit();
      }
      this.hud.hitMarker(Math.round(dmg), this.project(point ?? ship.pos, 6));
    }
    if (ship === this.player && dmg > ship.maxHp * 0.02) this.shake = Math.min(1.4, this.shake + dmg / ship.maxHp * 3);
    if (ship === this.player) {
      this.hud.hurt();
      if (dmg > ship.maxHp * 0.04) this.audio.alarm();
    }
    if (ship.hp <= 0) this.destroy(ship, source);
  }

  splashDamage(pos, radius, amount, owner, skip) {
    for (const s of this.ships) {
      if (!s.alive || s === skip || s.team === owner?.team) continue;
      const d = s.pos.distanceTo(pos) - s.def.hull.length * 0.3;
      if (d < radius) this.damage(s, amount * (1 - clamp(d / radius, 0, 1)), owner, pos);
    }
  }

  destroy(ship, source, fromNet = false) {
    if (!ship.alive) return;
    if (this.pvp && ship.owned && !fromNet) {
      this.net?.send({ t: 'dead', id: ship.netId, by: source?.netId ?? null });
    }
    ship.alive = false;
    ship.hp = 0;
    ship.sinkTimer = 0;
    _p.copy(ship.pos);
    _p.y += ship.def.hull.deck;
    this.effects.explosion(_p, 3.4 + ship.def.hull.length / 50);
    this.effects.waterSplash(ship.pos, 3);
    this.audio.explosion(this.player ? ship.pos.distanceTo(this.player.pos) : 0, 1.6);

    const idx = this.ais.findIndex((a) => a.ship === ship);
    if (idx >= 0) this.ais.splice(idx, 1);

    if (ship === this.player) {
      this.hud.addKill(`${ship.name} wurde versenkt`, 'bad');
      if (this.pvp) {
        this.hud.notice('VERSENKT - ZUSCHAUERMODUS', 3);
        this.spectate();
      } else {
        this.mode = 'over';
        this.overTimer = 3;
      }
      return;
    }
    if (ship.team === this.player?.team) {
      this.hud.addKill(`${ship.name} verloren`, 'bad');
    } else if (source === this.player) {
      this.stats.kills++;
      const bonus = 800 + this.wave * 120;
      this.score += bonus;
      this.audio.kill();
      this.hud.addKill(`Du hast ${ship.name} versenkt  +${bonus}`, 'player');
      this.hud.notice('ZIEL VERSENKT', 1.4);
    } else {
      this.hud.addKill(`${ship.name} wurde versenkt`);
    }
    if (this.player && this.player.lockTarget === ship) this.player.lockTarget = null;
  }

  /** Follow a surviving team mate after going down. */
  spectate() {
    const mates = this.ships.filter((s) => s.alive && s.team === this.player.team && s !== this.player);
    this.spectateTarget = mates[0] ?? this.ships.find((s) => s.alive) ?? null;
  }

  onIntercept(owner) {
    if (owner === this.player) {
      this.stats.intercepts++;
      this.score += 25;
    }
  }

  onShipFired(ship, def, pos, dir = null, fromNet = false) {
    if (this.pvp && !fromNet && ship.owned && dir && def.kind !== 'flak') {
      this.net?.send({
        t: 'fire',
        f: {
          w: def.id,
          x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1),
          dx: +dir.x.toFixed(4), dy: +dir.y.toFixed(4), dz: +dir.z.toFixed(4),
          v: !!ship._lastVertical,
          tgt: ship.lockTarget?.netId ?? null,
        },
      });
    }
    if (ship === this.player) {
      const punch = def.kind === 'shell' ? def.damage / 900 : def.kind === 'rail' ? 0.5 : 0.12;
      this.shake = Math.min(1.2, this.shake + punch);
    }
    const d = this.player ? pos.distanceTo(this.player.pos) : 0;
    if (d > 3200) return;
    if (def.kind === 'shell') this.audio.gun(d, def.damage > 250 ? 1.5 : def.damage > 120 ? 1.1 : 0.8);
    else if (def.kind === 'rail') this.audio.rail(d);
    else if (def.kind === 'missile' || def.kind === 'drone') this.audio.missile(d);
    else if (def.kind === 'flak') this.audio.flak(d);
    else if (def.kind === 'torpedo') this.audio.splash(d);
  }

  notify(ship, text) {
    if (ship === this.player) this.hud.notice(text, 1.4);
  }

  // ------------------------------------------------------------- targeting
  cycleTarget() {
    const p = this.player;
    const list = this.ships.filter((s) => s.alive && s.team !== p.team && s.stealth <= 0);
    if (!list.length) {
      p.lockTarget = null;
      return;
    }
    list.sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos));
    const i = list.indexOf(p.lockTarget);
    p.lockTarget = list[(i + 1) % list.length];
    this.hud.notice(`ZIEL: ${p.lockTarget.def.name}`, 1.1);
  }

  autoLock() {
    const p = this.player;
    if (p.lockTarget && p.lockTarget.alive && p.lockTarget.stealth <= 0) return;
    const dir = this.camDir;
    let best = null;
    let bestDot = 0.955;
    for (const s of this.ships) {
      if (!s.alive || s.team === p.team || s.stealth > 0) continue;
      _v.copy(s.pos).sub(this.camera.position).normalize();
      const dot = _v.dot(dir);
      if (dot > bestDot) {
        bestDot = dot;
        best = s;
      }
    }
    if (best) p.lockTarget = best;
  }

  /** Iterative lead: where to shoot so the shell and the ship meet. */
  leadSolution(shooter, target, speed, out) {
    let t = shooter.pos.distanceTo(target.pos) / speed;
    for (let i = 0; i < 3; i++) {
      out.copy(target.pos).addScaledVector(target.velocity, t);
      t = shooter.pos.distanceTo(out) / speed;
    }
    out.y = target.pos.y + target.def.hull.deck * 0.5;
    return out;
  }

  // ----------------------------------------------------------------- input
  handlePlayer(dt) {
    const p = this.player;
    const inp = this.input;
    if (!p.alive) {
      p.throttleInput = 0;
      p.rudderInput = 0;
      return;
    }

    p.throttleInput = (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
    if (p.throttleInput === 0) p.throttleInput = damp(p.throttle, 0, 0.6, dt);
    p.rudderInput = (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0) - (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0);

    if (inp.hit('Digit1')) this.activeWeapon = 0;
    if (inp.hit('Digit2')) this.activeWeapon = 1;
    if (inp.hit('Digit3')) this.activeWeapon = 2;
    if (inp.hit('KeyT')) this.cycleTarget();
    if (inp.hit('KeyR')) this.player.reload(this.activeWeapon);
    if (inp.hit('KeyF') || inp.hit('Space')) p.useSpecial(this);
    if (inp.hit('KeyC')) this.zoom = (this.zoom + 1) % ZOOMS.length;
    if (inp.hit('KeyG')) this.cycleQuality();

    if (inp.mouse.left) p.fire(this.activeWeapon);
    if (inp.down('KeyE')) p.fire(1);
    if (inp.down('KeyQ')) p.fire(2);
    this.zoomOptics = inp.mouse.right || inp.down('ShiftLeft');

    this.autoLock();
  }

  updateAim() {
    const p = this.player;
    const dir = this.camDir;
    const origin = this.camera.position;

    // free aim: where the crosshair meets the sea
    let t = 4000;
    if (dir.y < -0.01) t = clamp(-origin.y / dir.y, 20, 6000);
    this.aimWorld.copy(origin).addScaledVector(dir, t);
    this.aimWorld.y = waveHeight(this.aimWorld.x, this.aimWorld.z, this.time);

    this.leadPoint = null;
    const target = p.lockTarget;
    const w = p.weapons[this.activeWeapon];
    if (target && target.alive) {
      _v.copy(target.pos).sub(origin).normalize();
      if (_v.dot(dir) > 0.93) {
        this.leadSolution(p, target, w.def.speed, this.aimWorld);
        this.leadPoint = this.aimWorld.clone();
      }
    }
    p.aimPoint.copy(this.aimWorld);

    const dist = p.pos.distanceTo(this.aimWorld);
    this.aimInfo.dist = dist;
    this.aimInfo.flight = dist / w.def.speed;
    // dispersion at that range, tightened while the optics are up
    this.aimInfo.spread = dist * w.def.spread * (this.zoomOptics ? 0.55 : 1);
    this.aimInfo.inRange = dist <= w.def.range;
    // a second point one dispersion-radius to the side, so the HUD can size
    // the impact ellipse in pixels
    (this.aimEdge ||= new THREE.Vector3())
      .set(dir.z, 0, -dir.x)
      .normalize()
      .multiplyScalar(this.aimInfo.spread)
      .add(this.aimWorld);
  }

  // ---------------------------------------------------------------- camera
  updateCamera(dt) {
    const inp = this.input;
    const focus = (this.player && this.player.alive ? this.player : this.spectateTarget) ?? this.player ?? this.previewShip;
    if (!focus) return;

    if (this.mode === 'preview') {
      this.camYaw += dt * 0.16;
      this.camPitch = 0.22 + Math.sin(this.time * 0.25) * 0.06;
    } else {
      const sens = 0.0022;
      this.camYaw -= inp.mouse.dx * sens;
      this.camPitch = clamp(this.camPitch + inp.mouse.dy * sens, -0.12, 1.15);
      if (inp.mouse.wheel) this.zoom = clamp(this.zoom + inp.mouse.wheel, 0, ZOOMS.length - 1);
    }

    const preview = this.mode === 'preview';
    const len = focus.def.hull.length;
    const dist = len * (preview ? 1.9 : ZOOMS[this.zoom]);
    const dir = (this.camDir ||= new THREE.Vector3());
    const cp = Math.cos(this.camPitch);
    dir.set(Math.sin(this.camYaw) * cp, -Math.sin(this.camPitch), Math.cos(this.camYaw) * cp).normalize();

    _p.copy(focus.pos);
    _p.y += focus.def.hull.deck + len * (preview ? 0.05 : 0.2);
    this.camera.position.copy(_p).addScaledVector(dir, -dist);
    const minY = waveHeight(this.camera.position.x, this.camera.position.z, this.time) + 4;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    _v.copy(this.camera.position).addScaledVector(dir, dist * 2);
    if (preview) {
      // Push the ship into the empty lower-right corner of the menu.
      const lateral = _p.set(dir.z, 0, -dir.x).normalize();
      _v.addScaledVector(lateral, -len * 0.5);   // ship sits left of centre
      _v.y += len * 0.45;                        // ...and low, clear of the cards
    }
    this.camera.lookAt(_v);
  }

  project(pos, yOffset = 0) {
    _v.copy(pos);
    _v.y += yOffset;
    _v.project(this.camera);
    if (_v.z > 1 || _v.x < -1.3 || _v.x > 1.3 || _v.y < -1.3 || _v.y > 1.3) return null;
    return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight };
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    this.time += dt;

    if (this.mode === 'battle') {
      if (this.player.alive) {
        this.handlePlayer(dt);
        this.updateAim();
      }
      for (const ai of this.ais) ai.update(dt);
    } else if (this.mode === 'preview' && this.previewShip) {
      const s = this.previewShip;
      s.rudderInput = Math.sin(this.time * 0.25) * 0.35;
      s.aimPoint.set(Math.cos(this.time * 0.3) * 800, 6, Math.sin(this.time * 0.3) * 800);
    } else if (this.mode === 'over') {
      this.overTimer -= dt;
      if (this.overTimer <= 0 && !this.overShown) {
        this.overShown = true;
        this.hud.gameOver('VERSENKT', {
          'Erreichte Welle': this.wave,
          Abschuesse: this.stats.kills,
          'Schaden gesamt': Math.round(this.stats.damage).toLocaleString('de-DE'),
          'Abgefangene Raketen': this.stats.intercepts,
          Punkte: Math.floor(this.score).toLocaleString('de-DE'),
        });
      }
    }

    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      s.update(dt, this.time, this);
      if (s.disposed) this.ships.splice(i, 1);
    }

    this.projectiles.update(dt, this.time);
    this.effects.update(dt, this.time);
    this.updateCamera(dt);
    this.ocean.update(this.time, this.camera);
    const focus = this.player ?? this.previewShip;
    this.ocean.setShips(this.ships, focus ? focus.pos : this.camera.position);
    this._updateSky(dt);

    this._netTick(dt);

    if (this.mode === 'battle' && !this.pvp) {
      const enemies = this.ships.filter((s) => s.alive && s.team !== this.player.team).length;
      if (enemies === 0) {
        if (this.waveTimer <= 0) {
          this.waveTimer = 5;
          this.score += 1500 * this.wave;
          this.hud.notice(`WELLE ${this.wave} GESCHAFFT  +${1500 * this.wave}`, 3);
          this.hud.addKill(`Welle ${this.wave} bereinigt - Nachschub laeuft`, 'player');
        } else {
          this.waveTimer -= dt;
          for (let i = this.ships.length - 1; i >= 0; i--) {
            const s = this.ships[i];
            if (s !== this.player && s.team === this.player.team && s.alive) {
              s.dispose();
              this.ships.splice(i, 1);
              const ai = this.ais.findIndex((a) => a.ship === s);
              if (ai >= 0) this.ais.splice(ai, 1);
            }
          }
          if (this.waveTimer <= 0) {
            this.wave++;
            const p = this.player;
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
            for (const w of p.weapons) {
              w.ammo = w.def.mag;
              w.reloading = 0;
            }
            this.spawnWave();
            this.hud.notice(`WELLE ${this.wave}`, 2.2);
          }
        }
      }
    }
  }

  render() {
    this.ocean.renderReflection(this.renderer, this.scene, this.camera);
    this.gfx.updateGrade(this.time, this.camera, SUN_DIR);
    this.gfx.render();
  }
}
