/** Thin WebSocket client for the room server. */
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.handlers = new Map();
    this.connected = false;
  }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }

  _emit(msg) {
    const fn = this.handlers.get(msg.t);
    if (fn) fn(msg);
  }

  connect(name, roomCode, ship) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        this.connected = true;
        this.send({ t: 'hello', name, room: roomCode || undefined, ship });
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.id = msg.id;
          this.room = msg.room;
          if (!settled) {
            settled = true;
            resolve(msg);
          }
        }
        if (msg.t === 'err' && !settled) {
          settled = true;
          reject(new Error(msg.msg));
          ws.close();
          return;
        }
        if (msg.t === 'room') this.room = msg.room;
        this._emit(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Keine Verbindung zum Server. Laeuft "npm start"?'));
        }
      };
      ws.onclose = () => {
        this.connected = false;
        this._emit({ t: 'closed' });
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.connected = false;
  }

  get isHost() {
    return this.room && this.room.host === this.id;
  }

  get me() {
    return this.room ? this.room.players.find((p) => p.id === this.id) : null;
  }
}
