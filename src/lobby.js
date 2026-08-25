import { SHIPS } from './ships.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);

/** Multiplayer lobby: create or join a room, pick a fleet, launch the battle. */
export class Lobby {
  constructor(game, hud, onLaunch, onBack) {
    this.game = game;
    this.hud = hud;
    this.onLaunch = onLaunch;
    this.onBack = onBack;
    this.net = null;

    this.el = {
      screen: $('lobby'),
      connect: $('lobbyConnect'),
      room: $('lobbyRoom'),
      name: $('pName'),
      code: $('joinCode'),
      error: $('lobbyError'),
      roomCode: $('roomCode'),
      blue: $('teamBlue'),
      red: $('teamRed'),
      blueCount: $('blueCount'),
      redCount: $('redCount'),
      ship: $('lobbyShip'),
      ready: $('readyBtn'),
      launch: $('launchBtn'),
      hint: $('lobbyHint'),
    };

    this.el.ship.innerHTML = SHIPS.map((s) => `<option value="${s.id}">${s.name} — ${s.klass}</option>`).join('');
    this.el.name.value = localStorage.getItem('mw3d.name') || '';

    $('createRoom').onclick = () => this._connect(null);
    $('joinRoom').onclick = () => this._connect(this.el.code.value.trim().toUpperCase());
    $('lobbyBack').onclick = () => {
      this.disconnect();
      onBack();
    };
    $('leaveRoom').onclick = () => {
      this.disconnect();
      this.show(true);
    };
    $('copyCode').onclick = () => navigator.clipboard?.writeText(this.el.roomCode.textContent);
    this.el.ship.onchange = () => this.net?.send({ t: 'ship', ship: this.el.ship.value });
    this.el.ready.onclick = () => {
      this.ready = !this.ready;
      this.net?.send({ t: 'ready', ready: this.ready });
    };
    this.el.launch.onclick = () => this.net?.send({ t: 'start' });
    for (const b of document.querySelectorAll('.join')) {
      b.onclick = () => this.net?.send({ t: 'team', team: Number(b.dataset.team) });
    }
    this.el.code.oninput = () => {
      this.el.code.value = this.el.code.value.toUpperCase();
    };
  }

  show(connectView = true) {
    this.el.screen.classList.remove('hidden');
    this.el.connect.classList.toggle('hidden', !connectView);
    this.el.room.classList.toggle('hidden', connectView);
    this.el.error.textContent = '';
  }

  hide() {
    this.el.screen.classList.add('hidden');
  }

  disconnect() {
    this.net?.close();
    this.net = null;
    this.ready = false;
  }

  async _connect(code) {
    const name = this.el.name.value.trim() || 'Kapitaen';
    localStorage.setItem('mw3d.name', name);
    this.el.error.textContent = 'Verbinde...';
    const net = new Net();
    try {
      await net.connect(name, code, this.el.ship.value);
    } catch (err) {
      this.el.error.textContent = err.message;
      return;
    }
    this.net = net;
    this.ready = false;
    this.el.error.textContent = '';

    net.on('room', () => this._render());
    net.on('err', (m) => {
      this.el.error.textContent = m.msg;
    });
    net.on('closed', () => {
      this.hud.notice('VERBINDUNG GETRENNT', 3);
      this.net = null;
      this.show(true);
    });
    net.on('start', (m) => {
      this.hide();
      this.onLaunch(net, m);
    });
    net.on('over', (m) => {
      this.ready = false;
      this.show(false);
      this._render();
      this.hud.gameOver(m.winner === 0 ? 'BLAUE FLOTTE SIEGT' : 'ROTE FLOTTE SIEGT', {});
    });
    net.on('chat', () => {});

    this.show(false);
    this._render();
  }

  _render() {
    const net = this.net;
    if (!net || !net.room) return;
    const room = net.room;
    this.el.roomCode.textContent = room.code;

    const rows = (team) =>
      room.players
        .filter((p) => p.team === team)
        .map((p) => {
          const def = SHIPS.find((s) => s.id === p.ship);
          return `<li class="${p.id === net.id ? 'me' : ''}">
            <span class="nm">${p.name}</span>
            ${p.id === room.host ? '<span class="host">HOST</span>' : ''}
            <span class="sh">${def ? def.name : '—'}</span>
            <span class="rd ${p.ready ? '' : 'no'}">${p.ready ? 'BEREIT' : 'wartet'}</span>
          </li>`;
        })
        .join('');

    this.el.blue.innerHTML = rows(0);
    this.el.red.innerHTML = rows(1);
    this.el.blueCount.textContent = room.players.filter((p) => p.team === 0).length;
    this.el.redCount.textContent = room.players.filter((p) => p.team === 1).length;

    const me = room.players.find((p) => p.id === net.id);
    if (me && this.el.ship.value !== me.ship) this.el.ship.value = me.ship;
    this.el.ready.classList.toggle('on', !!me?.ready);
    this.el.ready.textContent = me?.ready ? 'BEREIT ✓' : 'BEREIT';
    this.el.launch.classList.toggle('hidden', room.host !== net.id);
    this.el.hint.textContent =
      room.host === net.id
        ? 'Du bist Host: Code teilen, dann AUSLAUFEN druecken. Leere Plaetze werden mit Bots gefuellt (3 Schiffe pro Flotte).'
        : 'Warte auf den Host. Team und Schiff kannst du jederzeit wechseln.';
  }
}
