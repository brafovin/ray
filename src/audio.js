/** Tiny synthesised sound bank - no assets, everything is generated. */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this._noise(2);
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  _noise(seconds) {
    const n = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(node, gain, attack, decay, when) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  _burst({ gain = 0.4, decay = 0.4, attack = 0.005, filter = 900, q = 1, type = 'lowpass', distance = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const when = this.ctx.currentTime + Math.min(distance / 340, 1.2);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    f.Q.value = q;
    src.connect(f);
    this._env(f, gain, attack, decay, when);
    src.start(when);
    src.stop(when + attack + decay + 0.05);
  }

  _tone({ freq = 120, to = 40, gain = 0.3, decay = 0.5, type = 'sine', distance = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const when = this.ctx.currentTime + Math.min(distance / 340, 1.2);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), when + decay);
    this._env(o, gain, 0.006, decay, when);
    o.start(when);
    o.stop(when + decay + 0.1);
  }

  gun(distance, big = 1) {
    const att = Math.max(0.06, 1 - distance / 2200);
    this._burst({ gain: 0.5 * att * big, decay: 0.35 * big, filter: 700 / big, distance });
    this._tone({ freq: 130 / big, to: 35, gain: 0.35 * att * big, decay: 0.5 * big, distance });
  }

  rail(distance) {
    const att = Math.max(0.06, 1 - distance / 2600);
    this._tone({ freq: 1800, to: 120, gain: 0.28 * att, decay: 0.45, type: 'sawtooth', distance });
    this._burst({ gain: 0.3 * att, decay: 0.3, filter: 3200, type: 'bandpass', q: 2, distance });
  }

  missile(distance) {
    const att = Math.max(0.05, 1 - distance / 2400);
    this._burst({ gain: 0.35 * att, decay: 1.1, filter: 1600, type: 'bandpass', q: 0.8, distance });
    this._tone({ freq: 260, to: 900, gain: 0.12 * att, decay: 0.9, type: 'sawtooth', distance });
  }

  flak(distance) {
    const att = Math.max(0.05, 1 - distance / 900);
    this._burst({ gain: 0.16 * att, decay: 0.08, filter: 2600, type: 'bandpass', q: 1.5, distance });
  }

  splash(distance) {
    const att = Math.max(0.05, 1 - distance / 1600);
    this._burst({ gain: 0.3 * att, decay: 0.5, filter: 1400, type: 'highpass', distance });
  }

  explosion(distance, scale = 1) {
    const att = Math.max(0.05, 1 - distance / 2600);
    this._burst({ gain: 0.6 * att * scale, decay: 0.9 * scale, filter: 480, distance });
    this._tone({ freq: 90, to: 28, gain: 0.5 * att * scale, decay: 1.1 * scale, distance });
  }

  hit() {
    this._tone({ freq: 1200, to: 900, gain: 0.12, decay: 0.08, type: 'square' });
  }

  kill() {
    this._tone({ freq: 660, to: 990, gain: 0.2, decay: 0.35, type: 'triangle' });
  }

  alarm() {
    this._tone({ freq: 880, to: 440, gain: 0.16, decay: 0.35, type: 'square' });
  }
}
