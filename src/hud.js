import { WEAPONS } from './weapons.js';
import { clamp } from './math.js';

const $ = (id) => document.getElementById(id);

const dps = (id) => {
  const w = WEAPONS[id];
  const cycle = w.mag * w.cooldown + w.reload;
  return (w.damage + (w.splashDamage ?? 0) * 0.4) * w.mag / cycle;
};

const shipStats = (def) => ({
  Panzerung: clamp(def.hp / 7400, 0.08, 1),
  Tempo: clamp(def.maxSpeed / 32, 0.08, 1),
  Wendigkeit: clamp(def.turnRate / 0.92, 0.08, 1),
  Feuerkraft: clamp(def.weapons.reduce((a, w) => a + dps(w), 0) / 260, 0.08, 1),
  Reichweite: clamp(Math.max(...def.weapons.map((w) => WEAPONS[w].range)) / 2600, 0.08, 1),
});

export class HUD {
  constructor() {
    this.el = {
      menu: $('menu'), list: $('shipList'), detail: $('shipDetail'), start: $('startBtn'),
      hud: $('hud'), wave: $('waveNum'), enemies: $('enemyNum'), score: $('score'),
      myShip: $('myShip'), myClass: $('myClass'), hpFill: $('hpFill'), hpText: $('hpText'),
      speed: $('speedText'), throttle: $('throttleText'), heading: $('headingText'),
      spFill: $('spFill'), spText: $('spText'), spBar: document.querySelector('.bar.special'),
      weapons: $('weapons'), radar: $('radar'), radarRange: $('radarRange'),
      markers: $('markers'), killfeed: $('killfeed'), notice: $('notice'), fps: $('fps'),
      vignette: $('vignette'), crosshair: $('crosshair'),
      dispersion: $('dispersion'), hitmarks: $('hitmarks'), optics: $('optics'),
      rangeinfo: $('rangeinfo'), rangeText: $('rangeText'), flightText: $('flightText'),
      lockinfo: $('lockinfo'), lockName: $('lockName'), lockHp: $('lockHp'), lockDist: $('lockDist'),
      pause: $('pause'), gameover: $('gameover'), goTitle: $('goTitle'), goStats: $('goStats'),
    };
    this.ctx = this.el.radar.getContext('2d');
    this.markerPool = new Map();
    this.noticeTimer = 0;
    this.hurtTimer = 0;
    this.selected = null;
  }

  // ------------------------------------------------------------- ship menu
  buildMenu(ships, onSelect, onStart) {
    this.el.list.innerHTML = '';
    ships.forEach((def) => {
      const card = document.createElement('div');
      card.className = 'ship-card';
      card.dataset.id = def.id;
      const stats = shipStats(def);
      card.innerHTML = `
        <div class="klass">${def.klass}</div>
        <div class="nm">${def.name}</div>
        <div class="role">${def.role}</div>
        <div class="mini">${Object.values(stats)
          .map((v) => `<i class="${v > 0.45 ? 'on' : ''}"></i>`)
          .join('')}</div>`;
      card.addEventListener('click', () => {
        this.selectShip(def);
        onSelect(def);
      });
      this.el.list.appendChild(card);
    });
    this.el.start.onclick = () => onStart(this.selected);
  }

  selectShip(def) {
    this.selected = def;
    for (const c of this.el.list.children) c.classList.toggle('active', c.dataset.id === def.id);
    const stats = shipStats(def);
    this.el.detail.innerHTML = `
      <div class="klass">${def.klass}</div>
      <h2>${def.name}</h2>
      <p class="desc">${def.desc}</p>
      ${Object.entries(stats)
        .map(
          ([k, v]) => `<div class="stat-row"><span>${k.toUpperCase()}</span>
            <span class="track"><i style="width:${(v * 100).toFixed(0)}%"></i></span>
            <b>${Math.round(v * 100)}</b></div>`
        )
        .join('')}
      <div class="wlist">
        ${def.weapons
          .map((id) => {
            const w = WEAPONS[id];
            return `<div class="wrow"><span class="ic">${w.icon}</span>
              <span class="nm">${w.name}</span>
              <span class="dm">${w.damage} DMG &middot; ${(w.range / 1000).toFixed(1)} km</span></div>`;
          })
          .join('')}
      </div>
      <div class="special-row">SPEZIAL &middot; ${def.special.name} (Taste F)</div>`;
  }

  showMenu(show) {
    this.el.menu.classList.toggle('hidden', !show);
    this.el.hud.classList.toggle('hidden', show);
  }

  // ------------------------------------------------------------ battle HUD
  buildWeaponCards(ship) {
    this.el.weapons.innerHTML = '';
    this.cards = ship.weapons.map((w, i) => {
      const el = document.createElement('div');
      el.className = 'wcard';
      el.innerHTML = `
        <div class="head"><span class="key">${i + 1}</span><span class="ic">${w.def.icon}</span>
          <span class="nm">${w.def.short}</span></div>
        <div class="rng">${(w.def.range / 1000).toFixed(1)}km</div>
        <div class="ammo"><b>0</b><small>/${w.def.mag}</small></div>
        <div class="cd"><i></i></div>`;
      this.el.weapons.appendChild(el);
      return { el, ammo: el.querySelector('.ammo b'), cd: el.querySelector('.cd i') };
    });
    this.el.myShip.textContent = ship.def.name;
    this.el.myClass.textContent = ship.def.klass;
  }

  update(game, dt) {
    const p = game.player;
    if (!p) return;

    const hp = p.healthRatio;
    this.el.hpFill.style.width = `${hp * 100}%`;
    this.el.hpFill.className = hp < 0.3 ? 'crit' : hp < 0.6 ? 'warn' : '';
    this.el.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.el.speed.textContent = Math.round(Math.abs(p.speed) * 1.94);
    this.el.throttle.textContent = Math.round(p.throttle * 100);
    this.el.heading.textContent = String(Math.round((p.heading * 180) / Math.PI)).padStart(3, '0');

    const spReady = p.specialCooldown <= 0;
    const spRatio = spReady ? 1 : 1 - p.specialCooldown / p.special.cooldown;
    this.el.spFill.style.width = `${spRatio * 100}%`;
    this.el.spBar.classList.toggle('ready', spReady);
    this.el.spText.textContent = spReady
      ? `${p.special.name.toUpperCase()} [F]`
      : `${p.special.name.toUpperCase()} ${p.specialCooldown.toFixed(1)}s`;

    this.cards.forEach((c, i) => {
      const w = p.weapons[i];
      c.ammo.textContent = w.ammo;
      c.el.classList.toggle('active', i === game.activeWeapon);
      c.el.classList.toggle('empty', w.ammo <= 0);
      if (w.reloading > 0) {
        c.cd.className = 'reload';
        c.cd.style.width = `${(1 - w.reloading / w.def.reload) * 100}%`;
      } else {
        c.cd.className = '';
        c.cd.style.width = `${clamp(1 - w.cooldown / w.def.cooldown, 0, 1) * 100}%`;
      }
    });

    if (game.pvp) {
      const mine = game.ships.filter((s) => s.alive && s.team === p.team).length;
      const foes = game.ships.filter((s) => s.alive && s.team !== p.team).length;
      this.el.wave.textContent = mine;
      this.el.enemies.textContent = foes;
      if (!this._pvpLabels) {
        this._pvpLabels = true;
        this.el.wave.previousElementSibling.textContent = 'EIGENE';
        this.el.enemies.previousElementSibling.textContent = 'GEGNER';
      }
    } else {
      this.el.wave.textContent = game.wave;
      this.el.enemies.textContent = game.ships.filter((s) => s.alive && s.team !== p.team).length;
    }
    this.el.score.textContent = Math.floor(game.score).toLocaleString('de-DE');

    this.fpsAcc = (this.fpsAcc ?? 0) + dt;
    this.fpsFrames = (this.fpsFrames ?? 0) + 1;
    if (this.fpsAcc > 0.5) {
      this.el.fps.textContent = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this._markers(game);
    this._gunnery(game);
    this._radar(game);

    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) this.el.notice.classList.remove('show');
    }
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.el.vignette.classList.remove('hurt');
    }
  }

  /** Impact ellipse, range and time of flight - the shooting aids. */
  _gunnery(game) {
    const p = game.player;
    const info = game.aimInfo;
    const centre = game.project(game.aimWorld, 0);
    const edge = game.aimEdge ? game.project(game.aimEdge, 0) : null;

    if (centre && edge && p.alive) {
      const r = Math.max(9, Math.hypot(edge.x - centre.x, edge.y - centre.y));
      const d = this.el.dispersion;
      d.style.display = 'block';
      d.style.left = `${centre.x}px`;
      d.style.top = `${centre.y}px`;
      d.style.width = `${r * 2}px`;
      d.style.height = `${r * 0.85}px`;
      d.classList.toggle('out', !info.inRange);
    } else {
      this.el.dispersion.style.display = 'none';
    }

    this.el.rangeText.textContent = `${Math.round(info.dist)} m`;
    this.el.flightText.textContent = info.inRange
      ? `FLUGZEIT ${info.flight.toFixed(1)} s`
      : 'AUSSER REICHWEITE';
    this.el.rangeinfo.classList.toggle('out', !info.inRange);
    this.el.optics.classList.toggle('hidden', !game.zoomOptics);

    if (this.hitFlash > 0) {
      this.hitFlash -= 1 / 60;
      if (this.hitFlash <= 0) this.el.crosshair.classList.remove('hit');
    }
  }

  /** Floating damage number plus a crosshair punch. */
  hitMarker(damage, screenPos) {
    this.el.crosshair.classList.remove('hit');
    void this.el.crosshair.offsetWidth;
    this.el.crosshair.classList.add('hit');
    this.hitFlash = 0.18;
    if (!screenPos) return;
    const el = document.createElement('div');
    el.className = 'hitmark';
    el.textContent = `-${damage}`;
    el.style.left = `${screenPos.x}px`;
    el.style.top = `${screenPos.y}px`;
    this.el.hitmarks.appendChild(el);
    setTimeout(() => el.remove(), 950);
    while (this.el.hitmarks.children.length > 24) this.el.hitmarks.firstChild.remove();
  }

  _markers(game) {
    const seen = new Set();
    const p = game.player;
    for (const s of game.ships) {
      if (!s.alive || s === p || s.stealth > 0) continue;
      const sp = game.project(s.pos, s.def.hull.deck + 8);
      if (!sp) continue;
      seen.add(s.id);
      let m = this.markerPool.get(s.id);
      if (!m) {
        m = document.createElement('div');
        m.className = 'marker';
        m.innerHTML = '<div class="box"></div><div class="lbl"></div>';
        this.el.markers.appendChild(m);
        this.markerPool.set(s.id, m);
      }
      const dist = s.pos.distanceTo(p.pos);
      const scale = clamp(1200 / dist, 0.35, 1.4);
      m.style.left = `${sp.x}px`;
      m.style.top = `${sp.y}px`;
      m.firstChild.style.width = `${46 * scale}px`;
      m.firstChild.style.height = `${46 * scale}px`;
      m.classList.toggle('locked', p.lockTarget === s);
      m.classList.toggle('ally', s.team === p.team);
      m.lastChild.style.fontSize = `${(9 + scale * 2).toFixed(1)}px`;
      m.lastChild.textContent = dist > 2600
        ? ''
        : `${s.name} · ${Math.round(dist)}m · ${Math.round(s.healthRatio * 100)}%`;
    }
    for (const [id, el] of this.markerPool) {
      if (!seen.has(id)) {
        el.remove();
        this.markerPool.delete(id);
      }
    }

    // lead marker: where the guns are actually aiming
    if (game.leadPoint) {
      const lp = game.project(game.leadPoint, 0);
      if (lp) {
        if (!this.leadEl) {
          this.leadEl = document.createElement('div');
          this.leadEl.className = 'marker lead locked';
          this.leadEl.innerHTML = '<div class="box"></div>';
          this.el.markers.appendChild(this.leadEl);
        }
        this.leadEl.style.display = '';
        this.leadEl.style.left = `${lp.x}px`;
        this.leadEl.style.top = `${lp.y}px`;
      } else if (this.leadEl) {
        this.leadEl.style.display = 'none';
      }
    } else if (this.leadEl) {
      this.leadEl.style.display = 'none';
    }

    const t = p.lockTarget;
    if (t && t.alive) {
      this.el.lockinfo.classList.remove('hidden');
      this.el.lockName.textContent = `${t.def.name} — ${t.def.klass}`;
      this.el.lockHp.style.width = `${t.healthRatio * 100}%`;
      this.el.lockDist.textContent = Math.round(t.pos.distanceTo(p.pos));
      this.el.crosshair.classList.add('locked');
    } else {
      this.el.lockinfo.classList.add('hidden');
      this.el.crosshair.classList.remove('locked');
    }
  }

  _radar(game) {
    const ctx = this.ctx;
    const R = 115;
    const range = 3000;
    this.el.radarRange.textContent = (range / 1000).toFixed(1);
    ctx.clearRect(0, 0, 230, 230);
    ctx.save();
    ctx.translate(R, R);

    ctx.strokeStyle = 'rgba(111,227,255,0.22)';
    ctx.lineWidth = 1;
    for (const r of [R / 3, (R / 3) * 2, R - 1]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R);
    ctx.stroke();

    const p = game.player;
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    const map = (pos) => {
      const dx = pos.x - p.pos.x;
      const dz = pos.z - p.pos.z;
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      return [(rx / range) * R, (-rz / range) * R];
    };

    ctx.fillStyle = 'rgba(120,130,110,0.55)';
    for (const isl of game.islands) {
      const [x, y] = map(isl);
      if (Math.hypot(x, y) > R + 20) continue;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, (isl.radius / range) * R), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffb648';
    for (const pr of game.projectiles.list) {
      if (pr.kind === 'flak' || pr.kind === 'shell') continue;
      const [x, y] = map(pr.pos);
      if (Math.hypot(x, y) > R) continue;
      ctx.fillRect(x - 1, y - 1, 2.5, 2.5);
    }

    for (const sh of game.ships) {
      if (!sh.alive || sh === p) continue;
      if (sh.stealth > 0) continue;
      const [x, y] = map(sh.pos);
      if (Math.hypot(x, y) > R - 2) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sh.heading - p.heading);
      const friend = sh.team === p.team;
      ctx.fillStyle = friend
        ? (sh.submerged ? 'rgba(99,210,122,0.45)' : '#63d27a')
        : (sh.submerged ? 'rgba(255,91,71,0.45)' : '#ff5b47');
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(3.6, 5); ctx.lineTo(-3.6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = '#6fe3ff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(4.6, 6); ctx.lineTo(-4.6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  addKill(text, cls = '') {
    const el = document.createElement('div');
    el.className = `kf ${cls}`;
    el.textContent = text;
    this.el.killfeed.prepend(el);
    setTimeout(() => el.remove(), 6000);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
  }

  notice(text, time = 2) {
    this.el.notice.textContent = text;
    this.el.notice.classList.add('show');
    this.noticeTimer = time;
  }

  hurt() {
    this.el.vignette.classList.add('hurt');
    this.hurtTimer = 0.35;
  }

  showPause(show) {
    this.el.pause.classList.toggle('hidden', !show);
  }

  gameOver(title, stats) {
    this.el.goTitle.textContent = title;
    this.el.goStats.innerHTML = Object.entries(stats)
      .map(([k, v]) => `<span>${k}</span><b>${v}</b>`)
      .join('');
    this.el.gameover.classList.remove('hidden');
  }

  hideGameOver() {
    this.el.gameover.classList.add('hidden');
  }
}
