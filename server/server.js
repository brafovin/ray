// Game server: static files + a dependency-free WebSocket implementation with
// rooms. The server never simulates the battle - it routes messages, keeps the
// roster and decides who owns what. That keeps it small and cheap to run.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------------------------------------------------------------- websocket

class Socket {
  constructor(raw) {
    this.raw = raw;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.fragOp = 0;
    this.open = true;
    this.onMessage = () => {};
    this.onClose = () => {};

    raw.on('data', (chunk) => this._data(chunk));
    raw.on('close', () => this._close());
    raw.on('error', () => this._close());
  }

  _close() {
    if (!this.open) return;
    this.open = false;
    this.onClose();
  }

  _data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const frame = this._frame();
      if (!frame) return;
      const { opcode, payload, fin } = frame;

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this._send(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;

      if (opcode === 0x0) this.frag.push(payload);
      else {
        this.frag = [payload];
        this.fragOp = opcode;
      }
      if (!fin) continue;

      const body = Buffer.concat(this.frag);
      this.frag = [];
      if (this.fragOp === 0x1) {
        try {
          this.onMessage(JSON.parse(body.toString('utf8')));
        } catch {
          /* ignore malformed input */
        }
      }
    }
  }

  /** Pull one frame out of the buffer, or null if it is not complete yet. */
  _frame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;

    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off);
      if (big > 8n * 1024n * 1024n) {
        this.close();
        return null;
      }
      len = Number(big);
      off += 8;
    }

    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4);
      off += 4;
    }
    if (b.length < off + len) return null;

    const payload = Buffer.from(b.subarray(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  _send(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.raw.write(Buffer.concat([header, payload]));
    } catch {
      this._close();
    }
  }

  send(obj) {
    this._send(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  close() {
    if (!this.open) return;
    this._send(0x8, Buffer.alloc(0));
    this.raw.end();
    this._close();
  }
}

// -------------------------------------------------------------------- rooms

const rooms = new Map();
let nextId = 1;

const newCode = () => {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
};

const roster = (room) => ({
  code: room.code,
  phase: room.phase,
  host: room.host,
  players: [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    ship: p.ship,
    team: p.team,
    ready: p.ready,
    alive: p.alive,
  })),
});

function broadcast(room, msg, exceptId = null) {
  for (const p of room.players.values()) {
    if (p.id !== exceptId) p.socket.send(msg);
  }
}

function sendRoster(room) {
  broadcast(room, { t: 'room', room: roster(room) });
}

function leave(player) {
  const room = rooms.get(player.room);
  if (!room) return;
  room.players.delete(player.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.host === player.id) room.host = room.players.keys().next().value;
  broadcast(room, { t: 'left', id: player.id });
  sendRoster(room);
}

/** Spawn slots: the two fleets start on opposite sides, bows facing centre. */
function spawnPoints(room) {
  const spawns = {};
  const counts = { 0: 0, 1: 0 };
  const total = { 0: 0, 1: 0 };
  for (const p of room.players.values()) total[p.team]++;
  for (const p of room.players.values()) {
    const n = Math.max(total[p.team], 1);
    const i = counts[p.team]++;
    const side = p.team === 0 ? -1 : 1;
    const spread = 520;
    const off = (i - (n - 1) / 2) * spread;
    spawns[p.id] = { x: off, z: side * 1050, h: side > 0 ? Math.PI : 0 };
  }
  return spawns;
}

function handle(player, msg) {
  const room = rooms.get(player.room);
  if (!room) return;

  switch (msg.t) {
    case 'ship':
      player.ship = String(msg.ship || '').slice(0, 32);
      sendRoster(room);
      break;

    case 'team':
      player.team = msg.team === 1 ? 1 : 0;
      sendRoster(room);
      break;

    case 'ready':
      player.ready = !!msg.ready;
      sendRoster(room);
      break;

    case 'start': {
      if (room.host !== player.id || room.phase === 'battle') break;
      room.phase = 'battle';
      room.seed = randomInt(1, 2 ** 30);
      for (const p of room.players.values()) p.alive = true;
      broadcast(room, { t: 'start', seed: room.seed, spawns: spawnPoints(room), room: roster(room) });
      break;
    }

    case 'state':
      broadcast(room, { t: 'state', id: player.id, s: msg.s }, player.id);
      break;

    case 'bots':
      if (room.host === player.id) broadcast(room, { t: 'bots', b: msg.b }, player.id);
      break;

    case 'fire':
      broadcast(room, { t: 'fire', id: player.id, f: msg.f }, player.id);
      break;

    case 'hit': {
      // route damage to whoever owns the target (a player or one of the host's bots)
      const ownerId = String(msg.id || '').split(':')[0];
      const owner = room.players.get(ownerId);
      if (owner) owner.socket.send({ t: 'hit', id: msg.id, from: player.id, dmg: msg.dmg, w: msg.w });
      break;
    }

    case 'dead':
      player.alive = false;
      broadcast(room, { t: 'dead', id: msg.id ?? player.id, by: msg.by ?? null });
      sendRoster(room);
      break;

    case 'over':
      if (room.host !== player.id) break;
      room.phase = 'lobby';
      for (const p of room.players.values()) {
        p.ready = false;
        p.alive = true;
      }
      broadcast(room, { t: 'over', winner: msg.winner });
      sendRoster(room);
      break;

    case 'chat':
      broadcast(room, { t: 'chat', id: player.id, name: player.name, text: String(msg.text || '').slice(0, 200) });
      break;

    default:
      break;
  }
}

function join(socket, msg) {
  const name = (String(msg.name || '').trim() || 'Kapitaen').slice(0, 18);
  let room;

  if (msg.room) {
    room = rooms.get(String(msg.room).toUpperCase().trim());
    if (!room) {
      socket.send({ t: 'err', msg: 'Raum nicht gefunden.' });
      return null;
    }
    if (room.players.size >= 12) {
      socket.send({ t: 'err', msg: 'Raum ist voll.' });
      return null;
    }
  } else {
    const code = newCode();
    room = { code, players: new Map(), host: null, phase: 'lobby', seed: 0 };
    rooms.set(code, room);
  }

  const teams = [0, 0];
  for (const p of room.players.values()) teams[p.team]++;
  const player = {
    id: `p${nextId++}`,
    name,
    ship: msg.ship || 'sentinel',
    team: teams[0] <= teams[1] ? 0 : 1,
    ready: false,
    alive: true,
    room: room.code,
    socket,
  };
  room.players.set(player.id, player);
  if (!room.host) room.host = player.id;

  socket.send({ t: 'welcome', id: player.id, room: roster(room) });
  sendRoster(room);
  return player;
}

// --------------------------------------------------------------- http + ws

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = decodeURIComponent(url.pathname);
  if (file === '/') file = '/index.html';
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, raw) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    raw.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  raw.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  raw.setNoDelay(true);

  const socket = new Socket(raw);
  let player = null;
  socket.onMessage = (msg) => {
    if (!player) {
      if (msg.t === 'hello') player = join(socket, msg);
      return;
    }
    handle(player, msg);
  };
  socket.onClose = () => {
    if (player) leave(player);
  };
});

server.listen(PORT, () => {
  console.log(`Modern Warships 3D laeuft auf http://localhost:${PORT}`);
  console.log('Mehrspieler: Raum erstellen, Code teilen, gemeinsam auslaufen.');
});
