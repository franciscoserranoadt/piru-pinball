/* =========================================================
   PIRU PINBALL 3D — PIRU_PINBALL_GAME
   Pinball retro con gráficos modernos: Three.js + física propia.
   ========================================================= */
'use strict';

/* ---------- Guardado (Android o navegador) ---------- */
const Store = {
  get(k, d) {
    try {
      let v = null;
      if (window.Android && Android.load) v = Android.load(k);
      else v = localStorage.getItem(k);
      return (v === null || v === undefined || v === '') ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  set(k, v) {
    try {
      const s = JSON.stringify(v);
      if (window.Android && Android.save) Android.save(k, s); else localStorage.setItem(k, s);
    } catch (e) {}
  }
};
const DEFAULTS = { music: true, sfx: true, vib: true, q: 1, cam: 1, high: [], games: 0 };
const save = Object.assign({}, DEFAULTS, Store.get('pirupinball', {}));
function persist() { Store.set('pirupinball', save); }
function vibrate(ms) {
  if (!save.vib) return;
  try { if (window.Android && Android.vibrate) Android.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}
function gameVersion() { try { return (window.Android && Android.gameVersion) ? Android.gameVersion() : 1; } catch (e) { return 1; } }

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
function fmt(n) { n = Math.floor(n); const s = String(n); let o = ''; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) o += '.'; o += s[i]; } return o; }

/* =========================================================
   SONIDO (sintetizado con WebAudio)
   ========================================================= */
const Snd = {
  c: null, master: null, sfx: null, mus: null, noiseBuf: null, roll: null, rollG: null,
  musStep: 0, musNext: 0,
  init() {
    if (this.c) { if (this.c.state === 'suspended') this.c.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.c = new AC();
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(c.destination);
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.connect(this.master);
    // eco para la música
    const dl = c.createDelay(1); dl.delayTime.value = 0.375; const fb = c.createGain(); fb.gain.value = 0.32;
    const wet = c.createGain(); wet.gain.value = 0.3; this.musIn = c.createGain();
    this.musIn.connect(this.mus); this.musIn.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.mus);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // ruido de rodadura de la bola
    const rs = c.createBufferSource(); rs.buffer = nb; rs.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 380; rf.Q.value = 0.7;
    this.rollG = c.createGain(); this.rollG.gain.value = 0;
    rs.connect(rf); rf.connect(this.rollG); this.rollG.connect(this.sfx); rs.start();
    this.rollF = rf;
    this.musNext = c.currentTime + 0.1;
    this.apply();
  },
  apply() {
    if (!this.c) return;
    this.sfx.gain.value = save.sfx ? 1 : 0;
    this.mus.gain.value = save.music ? 0.32 : 0;
  },
  tone(f, dur, type, vol, f2, delay) {
    const c = this.c; if (!c || !save.sfx) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, q, type, delay) {
    const c = this.c; if (!c || !save.sfx) return;
    const t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq || 1500; f.Q.value = q || 1;
    const g = c.createGain(); g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },
  flipper() { this.noise(0.06, 0.5, 2400, 1.2); this.tone(110, 0.08, 'sine', 0.35, 60); },
  flipDown() { this.noise(0.04, 0.18, 1200, 1); },
  bumper(i) { const f = [520, 620, 740][i % 3]; this.tone(f, 0.12, 'square', 0.18, f * 0.45); this.noise(0.08, 0.35, 3000, 0.8); this.tone(70, 0.12, 'sine', 0.4, 40); },
  sling() { this.noise(0.07, 0.45, 1800, 2); this.tone(260, 0.07, 'sawtooth', 0.12, 140); },
  wall(v) { this.noise(0.03, Math.min(0.25, v * 0.012), 900, 1.5); },
  drop() { this.tone(180, 0.15, 'triangle', 0.35, 70); this.noise(0.08, 0.3, 700, 1); },
  target() { this.tone(900, 0.08, 'square', 0.12, 1300); this.noise(0.05, 0.25, 2600, 1); },
  roll() { this.tone(1400, 0.05, 'square', 0.08, 1900); this.tone(2100, 0.06, 'square', 0.06, 2600, 0.05); },
  saucer() { this.tone(90, 0.3, 'sine', 0.5, 45); this.tone(300, 0.4, 'sawtooth', 0.08, 900, 0.1); },
  eject() { this.noise(0.12, 0.5, 900, 1); this.tone(120, 0.12, 'sine', 0.45, 60); },
  launch(p) { this.noise(0.25, 0.4, 600 + p * 900, 0.8, 'lowpass'); this.tone(80, 0.2, 'sine', 0.4, 40); },
  charge(p) { this.tone(200 + p * 500, 0.04, 'triangle', 0.05); },
  drain() { [440, 370, 311, 220].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.22, f * 0.97, i * 0.17)); this.tone(60, 0.9, 'sine', 0.4, 30, 0.5); },
  save() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'square', 0.12, f, i * 0.08)); },
  bonus() { this.tone(880, 0.05, 'square', 0.08); },
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => { this.tone(f, 0.18, 'square', 0.13, f, i * 0.09); this.tone(f / 2, 0.18, 'sawtooth', 0.08, f / 2, i * 0.09); }); this.noise(1.2, 0.3, 6000, 0.5, 'highpass', 0.1); },
  jackpot() { this.fanfare(); [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.15, f, 0.7 + i * 0.12)); this.tone(55, 1.2, 'sawtooth', 0.25, 110); },
  kick() { this.tone(70, 0.25, 'sawtooth', 0.35, 300); this.noise(0.2, 0.5, 1200, 0.7); },
  start() { [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'square', 0.12, f, i * 0.07)); },
  setRoll(v) { if (!this.c) return; const t = this.c.currentTime; this.rollG.gain.setTargetAtTime(save.sfx ? Math.min(0.22, v * 0.008) : 0, t, 0.05); this.rollF.frequency.setTargetAtTime(220 + v * 18, t, 0.05); },
  // Música synthwave sencilla
  music(intense) {
    const c = this.c; if (!c || !save.music) { if (c) this.musNext = c.currentTime + 0.1; return; }
    const bpm = intense ? 132 : 112; const st = 60 / bpm / 4;
    const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    while (this.musNext < c.currentTime + 0.25) {
      const t = this.musNext, s = this.musStep, bar = Math.floor(s / 16) % 4, ch = prog[bar], k = s % 16;
      const mf = n => 440 * Math.pow(2, (n - 69) / 12);
      // bajo
      if (k % 2 === 0) this.note(mf(ch[0] - 24 + (k % 8 === 6 ? 12 : 0)), st * 1.6, 'sawtooth', 0.16, t, 500);
      // arpegio
      const an = ch[(k % 3)] + (k % 6 >= 3 ? 12 : 0);
      this.note(mf(an), st * 0.9, 'square', 0.05, t, 2600);
      // bombo y caja
      if (k % 4 === 0) this.kickAt(t);
      if (k % 8 === 4) this.snareAt(t);
      if (intense && k % 2 === 1) this.hatAt(t);
      this.musNext += st; this.musStep++;
    }
  },
  note(f, d, type, v, t, lp) {
    const c = this.c; const o = c.createOscillator(); const g = c.createGain(); const fl = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = lp;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl); fl.connect(g); g.connect(this.musIn); o.start(t); o.stop(t + d + 0.05);
  },
  kickAt(t) { const c = this.c; const o = c.createOscillator(); const g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25); },
  snareAt(t) { const c = this.c; const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; const g = c.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); s.connect(f); f.connect(g); g.connect(this.musIn); s.start(t, Math.random()); s.stop(t + 0.2); },
  hatAt(t) { const c = this.c; const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = c.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); s.connect(f); f.connect(g); g.connect(this.mus); s.start(t, Math.random()); s.stop(t + 0.06); }
};

/* =========================================================
   MESA: geometría física (x a la derecha, y hacia el jugador)
   ========================================================= */
const BR = 0.27;            // radio de la bola
const GRAV = 21;            // gravedad a lo largo de la mesa
const VMAX = 48;
const CX = -0.3;            // centro de la zona de juego
const mx = x => 2 * CX - x; // espejo izquierda/derecha
const ARC = { x: 0.1, y: -17, r: 4.7 };
const TOP_Y = ARC.y - ARC.r;   // punto más alto de la mesa
const LANE_X = 4.4, PLUNGER_Y = 9.8 - 0.08 - BR;
const DRAIN_Y = 10.9;

const segs = [], circles = [], sensors = [];
function seg(ax, ay, bx, by, o) {
  o = o || {};
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  const s = { ax, ay, bx, by, len: L, dx: dx / L, dy: dy / L, nx: -dy / L, ny: dx / L,
    r: o.r !== undefined ? o.r : 0.08, e: o.e !== undefined ? o.e : 0.45, f: o.f !== undefined ? o.f : 0.02,
    kick: o.kick || 0, kind: o.kind || 'wall', oneway: !!o.oneway, on: true, hit: o.hit || null,
    color: o.color || null, h: o.h !== undefined ? o.h : 0.55, vis: o.vis !== false, id: o.id };
  segs.push(s); return s;
}
function circ(x, y, r, o) {
  o = o || {};
  const c = { x, y, r, e: o.e !== undefined ? o.e : 0.6, kick: o.kick || 0, kind: o.kind || 'post', hit: o.hit || null, on: true, id: o.id, color: o.color };
  circles.push(c); return c;
}
function sensor(x, y, r, fn, o) { const s = Object.assign({ x, y, r, fn, last: new Map() }, o || {}); sensors.push(s); return s; }

const NEON = { cyan: [0.2, 2.2, 3.0], pink: [3.0, 0.3, 1.8], purple: [1.4, 0.4, 3.0], yellow: [3.0, 2.0, 0.3], orange: [3.0, 0.9, 0.15], green: [0.4, 3.0, 0.8], white: [2.6, 2.6, 2.8], red: [3.2, 0.25, 0.25] };

// Paredes exteriores
seg(-4.6, -17, -4.6, DRAIN_Y + 0.4, { color: NEON.cyan });
{
  const N = 44; let px = ARC.x - ARC.r, py = ARC.y;
  for (let i = 1; i <= N; i++) {
    const a = Math.PI + Math.PI * i / N; const x = ARC.x + Math.cos(a) * ARC.r, y = ARC.y + Math.sin(a) * ARC.r;
    const hue = i / N; seg(px, py, x, y, { color: [lerp(0.2, 3.0, hue), lerp(2.2, 0.3, hue), lerp(3.0, 1.8, hue)], f: 0.01 });
    px = x; py = y;
  }
}
seg(4.8, -17, 4.8, DRAIN_Y + 0.4, { color: NEON.pink });
seg(4.0, -15.5, 4.0, DRAIN_Y + 0.4, { color: NEON.pink });
circ(4.0, -15.5, 0.1, { e: 0.4 });
seg(4.0, 9.8, 4.8, 9.8, { e: 0.05, kind: 'plunger', vis: false });
const gate = seg(4.8, -16.15, 4.1, -15.55, { oneway: true, kind: 'gate', vis: false, e: 0.3 });

// Pasillos superiores (rollovers P-I-R)
const LANE_POSTS = [-2.1, -0.9, 0.3, 1.5];
LANE_POSTS.forEach(x => { seg(x, -20.0, x, -18.9, { r: 0.1, e: 0.55, h: 0.45, color: NEON.yellow }); });
// Muros de las órbitas
seg(-3.3, -18.0, -3.3, -15.6, { r: 0.1, e: 0.5, color: NEON.purple });
circ(-3.3, -15.6, 0.16, { e: 0.7, kind: 'rubber' });
seg(2.9, -18.3, 2.9, -15.9, { r: 0.1, e: 0.5, color: NEON.purple });
circ(2.9, -15.9, 0.16, { e: 0.7, kind: 'rubber' });

// ----- Zona central nueva (obstáculos) -----
// Banco de dianas T-U-R-B-O
const TURBO_X = [-2.1, -1.2, -0.3, 0.6, 1.5];
const TURBO = TURBO_X.map((x, i) => seg(x - 0.25, -13.3, x + 0.25, -13.3, { r: 0.1, e: 0.4, kind: 'turbo', id: i, hit: hitTurbo, vis: false }));
// Campo de postes de goma
[[-2.0, -11.6], [-0.3, -11.6], [1.4, -11.6], [-3.0, -10.3], [-1.15, -10.3], [0.55, -10.3], [2.3, -10.3]].forEach(p => circ(p[0], p[1], 0.17, { e: 0.65, kind: 'rubber' }));
// Pasillo del spinner
seg(-1.15, -8.8, -1.15, -7.4, { r: 0.1, e: 0.55, color: NEON.green, h: 0.45 });
seg(0.55, -8.8, 0.55, -7.4, { r: 0.1, e: 0.55, color: NEON.green, h: 0.45 });
circ(-1.15, -8.8, 0.14, { kind: 'rubber' }); circ(0.55, -8.8, 0.14, { kind: 'rubber' });
circ(-1.15, -7.4, 0.14, { kind: 'rubber' }); circ(0.55, -7.4, 0.14, { kind: 'rubber' });
const SPINNER = { x: -0.3, y: -8.1 };
// Desviadores de goma laterales
seg(-4.6, -6.2, -3.95, -5.0, { r: 0.1, e: 0.6, kick: 5, kind: 'rubber', color: NEON.cyan });
circ(-3.95, -5.0, 0.14, { kind: 'rubber' });

// Zona inferior: separadores de outlane, guías de inlane y slingshots
function lowerSide(side) {
  const X = side < 0 ? (x => x) : mx;
  const col = side < 0 ? NEON.cyan : NEON.pink;
  seg(X(-3.85), 5.4, X(-3.85), 6.3, { r: 0.09, color: col });
  circ(X(-3.85), 5.4, 0.13, { e: 0.6, kind: 'rubber' });
  seg(X(-3.85), 6.3, X(-2.25), 8.0, { color: col, e: 0.35 });
  const A = [X(-2.65), 5.0], B = [X(-2.65), 6.25], C = [X(-1.85), 7.05];
  seg(A[0], A[1], B[0], B[1], { r: 0.1, e: 0.6, kind: 'rubber', color: col });
  seg(B[0], B[1], C[0], C[1], { r: 0.1, e: 0.6, kind: 'rubber', color: col });
  const k = seg(C[0], C[1], A[0], A[1], { r: 0.12, e: 0.5, kick: 9, kind: 'sling', id: side, color: NEON.white, hit: hitSling });
  k.B = B;
  circ(A[0], A[1], 0.14, { kind: 'rubber' }); circ(B[0], B[1], 0.14, { kind: 'rubber' }); circ(C[0], C[1], 0.14, { kind: 'rubber' });
  return k;
}
const slingL = lowerSide(-1), slingR = lowerSide(1);

// Bumpers
const BUMPERS = [[-1.75, -16.9, 0.5], [1.15, -16.9, 0.5], [-0.3, -15.15, 0.5], [-2.55, -5.6, 0.38], [1.95, -6.4, 0.38]].map((p, i) => circ(p[0], p[1], p[2], { e: 0.3, kick: i < 3 ? 11 : 9, kind: 'bumper', id: i, hit: hitBumper }));

// Dianas abatibles (izquierda) y fijas (derecha)
const DROPS = [2.4, 3.1, 3.8].map((y, i) => seg(-4.36, y - 0.29, -4.36, y + 0.29, { r: 0.1, e: 0.35, kind: 'drop', id: i, hit: hitDrop, vis: false }));
const STANDS = [0.6, 1.3, 2.0].map((y, i) => seg(3.78, y - 0.24, 3.78, y + 0.24, { r: 0.1, e: 0.4, kind: 'stand', id: i, hit: hitStand, vis: false }));

// Agujero (saucer)
const SAUCER = { x: 2.3, y: -1.4, r: 0.42 };

// Flippers
const flippers = [
  { px: -2.3, py: 8.25, rest: 0.52, up: -0.44, ang: 0.52, w: 0, pressed: false, side: -1, L: 1.72, r1: 0.3, r2: 0.13 },
  { px: 1.7, py: 8.25, rest: Math.PI - 0.52, up: Math.PI + 0.44, ang: Math.PI - 0.52, w: 0, pressed: false, side: 1, L: 1.72, r1: 0.3, r2: 0.13 },
  // mini flipper superior derecho
  { px: 3.25, py: -9.0, rest: Math.PI - 0.5, up: Math.PI + 0.45, ang: Math.PI - 0.5, w: 0, pressed: false, side: 1, L: 1.25, r1: 0.22, r2: 0.1 }
];
const FLIP_UP = 27, FLIP_DN = 15;

/* =========================================================
   ESTADO DE LA PARTIDA
   ========================================================= */
let STATE = 'title';         // title | play | pause | over
let G = null;
let balls = [];
let clock = 0;               // tiempo de juego (s)
let plunger = { charging: false, pull: 0, auto: 0 };
let pendingReload = false;
const msgQ = [];             // mensajes del DMD
let dmdMsg = null;
let hintT = 0;
let timeScale = 1, slowUntil = 0;

function newGame() {
  G = { score: 0, ball: 1, lanes: [0, 0, 0], skill: -1, drops: [0, 0, 0], dropReset: 0, stands: [0, 0, 0],
    mult: 1, lockLit: false, locks: 0, multiball: false, jackpot: 50000, kickback: true, saveUntil: 0, saveArmed: true,
    bumperHits: 0, superUntil: 0, turbo: [0, 0, 0, 0, 0], turboDone: false, spins: 0, bonus: 0, orbitT: -9, orbitCombo: 0, endBall: 0, overT: 0, extraBalls: 0, ejectQ: [], lastPts: 0, newHigh: false, tiltWarn: 0 };
  balls = []; msgQ.length = 0; dmdMsg = null; plunger.charging = false; plunger.pull = 0;
  STATE = 'play'; clock = 0; hintT = save.games < 3 ? 7 : 3;
  save.games++; persist();
  serveBall(false);
  Snd.start();
  showMsg(['BOLA 1', 'A JUGAR!'], 1.6, 'zoom');
  FX.flashAll(1.0);
}
function makeBall(x, y) {
  const b = { x, y, vx: 0, vy: 0, r: BR, held: 0, heldT: 0, inPlunger: false, stillT: 0, eject: 0, id: Math.random(), mesh: null, h: BR, lockGhost: false };
  balls.push(b); Scene3D.addBall(b); return b;
}
function serveBall(auto) {
  const b = makeBall(LANE_X, PLUNGER_Y);
  b.inPlunger = true;
  G.skill = Math.floor(Math.random() * 3);
  if (auto) plunger.auto = 0.6;
  return b;
}
function ballInPlunger() { for (const b of balls) if (b.inPlunger && !b.held) return b; return null; }
function activeBalls() { let n = 0; for (const b of balls) if (!b.dead) n++; return n; }

function addScore(p, x, y, label, color) {
  if (!G) return;
  if (G.multiball) p *= 2;
  G.score += p; G.lastPts = p;
  if (x !== undefined) FX.popup(x, y, (label ? label + ' ' : '') + fmt(p), color || '#fff');
}
function showMsg(lines, dur, fx, prio) {
  const m = { lines, dur: dur || 1.5, fx: fx || '', t: 0 };
  if (prio) { dmdMsg = m; return; }
  if (!dmdMsg) dmdMsg = m; else if (msgQ.length < 4) msgQ.push(m);
}

/* ---------- Reglas ---------- */
function hitBumper(c, b, v) {
  const sup = clock < G.superUntil;
  addScore((sup ? 1000 : 250) * (c.id > 2 ? 2 : 1), c.x, c.y, '', sup ? '#ff4' : '#6ff');
  G.bonus += 25; G.bumperHits++;
  if (G.bumperHits % 40 === 0) { G.superUntil = clock + 20; showMsg(['SUPER', 'BUMPERS'], 1.8, 'blink'); Snd.fanfare(); }
  Snd.bumper(c.id); vibrate(14);
  FX.bumperHit(c.id, b);
  breakSkill();
}
function hitSling(s, b, v) {
  if (v < 1.5) return;
  addScore(110, b.x, b.y);
  Snd.sling(); vibrate(12);
  FX.slingHit(s.id, b);
}
function hitDrop(s, b, v) {
  if (v < 1.2 || !s.on) return;
  s.on = false; G.drops[s.id] = 1;
  addScore(750, s.ax + 0.4, (s.ay + s.by) / 2, '', '#fb4');
  G.bonus += 300; Snd.drop(); vibrate(18);
  FX.dropHit(s.id);
  breakSkill();
  if (G.drops.every(d => d)) {
    addScore(5000, -3.5, 3.1, 'DIANAS', '#fd4');
    if (!G.lockLit) { G.lockLit = true; showMsg(['LOCK', 'ENCENDIDO'], 1.8, 'blink'); }
    else showMsg(['DIANAS', 'COMPLETAS'], 1.4);
    Snd.fanfare(); FX.flashAll(0.6);
    G.dropReset = clock + (G.lockLit ? 9999 : 2.5);
  }
}
function resetDrops() { G.drops = [0, 0, 0]; DROPS.forEach(d => d.on = true); G.dropReset = 0; FX.dropsUp(); }
function hitStand(s, b, v) {
  if (v < 1.2) return;
  const i = s.id; if (!G.stands[i]) { G.stands[i] = 1; addScore(500, s.ax - 0.4, (s.ay + s.by) / 2); } else addScore(100, s.ax - 0.4, (s.ay + s.by) / 2);
  G.bonus += 150; Snd.target(); vibrate(10); FX.standHit(i); breakSkill();
  if (G.stands.every(x => x)) {
    G.stands = [0, 0, 0];
    if (!G.kickback) { G.kickback = true; showMsg(['KICKBACK', 'ACTIVO'], 1.6, 'blink'); }
    else { addScore(10000, 3.0, 1.3, 'DIANAS'); showMsg(['DIANAS', '10.000'], 1.4); }
    Snd.fanfare();
  }
}
function hitTurbo(s, b, v) {
  if (v < 1.2) return;
  const i = s.id;
  if (!G.turbo[i]) { G.turbo[i] = 1; addScore(1000, TURBO_X[i], -12.8, '', '#4ef'); } else addScore(200, TURBO_X[i], -12.8);
  G.bonus += 200; Snd.target(); vibrate(10); FX.turboHit(i); breakSkill();
  if (G.turbo.every(x => x)) {
    G.turbo = [0, 0, 0, 0, 0];
    addScore(25000, -0.3, -12.5, 'TURBO', '#4ef');
    if (!G.turboDone) { G.turboDone = true; G.extraBalls++; showMsg(['TURBO!', 'BOLA EXTRA'], 2.2, 'jackpot', true); Snd.jackpot(); FX.bigFlash(-0.3, -13, NEON.cyan); slowMo(0.6); }
    else { showMsg(['TURBO!', '25.000'], 1.6, 'zoom'); Snd.fanfare(); FX.flashAll(0.8); }
  }
}
function breakSkill() { if (G) G.skill = -1; }
function rotateLanes(dir) {
  if (!G) return;
  const l = G.lanes;
  if (dir < 0) l.push(l.shift()); else l.unshift(l.pop());
}
function laneHit(i, b) {
  if (G.skill === i) {
    G.skill = -1; addScore(25000, LANE_POSTS[i] + 0.6, -19.4, 'SKILL', '#ff4');
    showMsg(['SKILL SHOT!', '25.000'], 2, 'zoom', true); Snd.jackpot(); FX.bigFlash(LANE_POSTS[i] + 0.6, -19.4, NEON.yellow); slowMo(0.6);
  } else { G.skill = -1; addScore(G.lanes[i] ? 100 : 500, LANE_POSTS[i] + 0.6, -19.4); }
  G.lanes[i] = 1; G.bonus += 100; Snd.roll();
  if (G.lanes.every(x => x)) {
    G.lanes = [0, 0, 0];
    if (G.mult < 5) { G.mult++; showMsg(['BONUS', 'X' + G.mult], 1.6, 'zoom'); }
    else { addScore(20000, -0.3, -19.4); showMsg(['PIR', 'COMPLETO'], 1.4); }
    Snd.fanfare(); FX.flashAll(0.7);
  }
}
function saucerCapture(b) {
  b.held = 1; b.heldT = 0; b.vx = b.vy = 0; b.x = SAUCER.x; b.y = SAUCER.y;
  Snd.saucer(); vibrate(30); breakSkill();
  FX.saucerHit();
  if (G.multiball) {
    const jp = G.jackpot; addScore(jp, SAUCER.x, SAUCER.y - 0.6, 'JACKPOT', '#ff4'); G.jackpot += 25000;
    showMsg(['JACKPOT!', fmt(jp * 2)], 2.5, 'jackpot', true); Snd.jackpot(); vibrate(120);
    FX.bigFlash(SAUCER.x, SAUCER.y, NEON.yellow); slowMo(0.9); FX.shake(0.5);
    b.holdFor = 1.3;
  } else if (G.lockLit) {
    G.lockLit = false; G.locks++;
    addScore(5000, SAUCER.x, SAUCER.y - 0.6, 'LOCK');
    if (G.locks >= 2) { startMultiball(b); }
    else {
      showMsg(['BOLA 1', 'BLOQUEADA'], 2, 'blink', true); Snd.fanfare();
      b.lockGhost = true; b.holdFor = 0.8;
      setTimeout(() => { if (STATE === 'play' || STATE === 'pause') resetDrops(); }, 900);
    }
  } else {
    addScore(3000, SAUCER.x, SAUCER.y - 0.6);
    b.holdFor = 1.0;
  }
}
function startMultiball(b) {
  G.multiball = true; G.locks = 0; G.jackpot = Math.max(G.jackpot, 50000);
  showMsg(['MULTIBOLA!', 'JACKPOT EN EL AGUJERO'], 3, 'multiball', true);
  Snd.jackpot(); vibrate(200); FX.bigFlash(SAUCER.x, SAUCER.y, NEON.pink); FX.flashAll(2); slowMo(1.0); FX.shake(0.6);
  b.holdFor = 1.6;
  G.ejectQ.push(clock + 2.4);            // segunda bola (la bloqueada) sale del agujero
  G.saveUntil = clock + 15;
  setTimeout(() => { if (G && G.multiball && STATE !== 'title') serveBall(true); }, 1200);
  setTimeout(() => { if (STATE === 'play' || STATE === 'pause') resetDrops(); }, 1500);
}
function ejectFromSaucer(b) {
  b.held = 0; b.x = SAUCER.x - 0.05; b.y = SAUCER.y + 0.05;
  b.vx = rnd(-8.5, -6.5); b.vy = rnd(5, 7); b.eject = 0.5; b.h = BR;
  Snd.eject(); FX.shock(SAUCER.x, SAUCER.y, NEON.orange, 1.5); FX.sparks(SAUCER.x, SAUCER.y, 0.3, 18, NEON.orange, 6);
}
function drainBall(b) {
  b.dead = true; Scene3D.removeBall(b);
  balls = balls.filter(x => x !== b);
  if (STATE !== 'play' && STATE !== 'pause') return;
  const left = balls.filter(x => !x.dead && !x.lockGhost).length;
  if (clock < G.saveUntil) {
    showMsg(['BOLA', 'SALVADA'], 1.5, 'blink', true); Snd.save();
    setTimeout(() => { if (G && STATE !== 'title' && STATE !== 'over') serveBall(true); }, 600);
    return;
  }
  if (G.multiball) {
    if (left <= 1) { G.multiball = false; showMsg(['FIN DE', 'MULTIBOLA'], 1.6); }
    if (left >= 1) return;
  }
  if (left >= 1) return;
  Snd.drain(); vibrate(120); FX.drainFx();
  endOfBall();
}
function endOfBall() {
  const bonus = G.bonus * G.mult;
  G.endBall = clock;
  showMsg(['BONUS ' + fmt(G.bonus), 'X' + G.mult + ' = ' + fmt(bonus)], 2.4, 'count', true);
  G.score += bonus;
  setTimeout(() => {
    if (!G || STATE === 'title') return;
    G.bonus = 0; G.mult = 1; G.lanes = [0, 0, 0]; G.superUntil = 0; G.saveArmed = true; G.endBall = 0;
    if (G.extraBalls > 0) { G.extraBalls--; showMsg(['BOLA', 'EXTRA'], 1.5, 'blink'); serveBall(false); return; }
    G.ball++;
    if (G.ball > 3) { gameOver(); return; }
    showMsg(['BOLA ' + G.ball, ''], 1.4, 'zoom');
    serveBall(false);
  }, 2600);
}
function gameOver() {
  STATE = 'over'; G.overT = 0;
  balls.forEach(b => Scene3D.removeBall(b)); balls = [];
  const h = save.high; h.push(G.score); h.sort((a, b) => b - a); save.high = h.slice(0, 5); persist();
  G.newHigh = save.high[0] === G.score && G.score > 0;
  showMsg(G.newHigh ? ['NUEVO RECORD!', fmt(G.score)] : ['FIN DE PARTIDA', fmt(G.score)], 99, G.newHigh ? 'jackpot' : 'blink', true);
  if (G.newHigh) { Snd.jackpot(); FX.flashAll(2); } else Snd.drain();
}
function slowMo(d) { slowUntil = performance.now() / 1000 + d; }

/* =========================================================
   FÍSICA
   ========================================================= */
function collideSeg(b, s) {
  if (!s.on) return;
  const px = b.x - s.ax, py = b.y - s.ay;
  let t = px * s.dx + py * s.dy; t = t < 0 ? 0 : (t > s.len ? s.len : t);
  const cx = s.ax + s.dx * t, cy = s.ay + s.dy * t;
  let dx = b.x - cx, dy = b.y - cy; const R = s.r + b.r; const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  if (s.oneway && (px * s.nx + py * s.ny) < 0) return;
  let d = Math.sqrt(d2), nx, ny;
  if (d < 1e-6) { nx = s.nx; ny = s.ny; d = 0; } else { nx = dx / d; ny = dy / d; }
  b.x += nx * (R - d); b.y += ny * (R - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    const e = -vn < 0.9 ? 0 : s.e;
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
    if (-vn > 1.5) { const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty; b.vx -= vt * s.f * tx; b.vy -= vt * s.f * ty; }
    if (s.kick && -vn > 1.5) { b.vx += nx * s.kick; b.vy += ny * s.kick; }
    if (s.hit) s.hit(s, b, -vn, cx, cy);
    else if (-vn > 3 && s.kind !== 'plunger') { Snd.wall(-vn); if (-vn > 12) FX.sparks(cx, cy, 0.3, 4, s.color || NEON.white, 3); }
    if (s.kind === 'gate') FX.gateSwing();
  }
}
function collideCirc(b, c) {
  const dx = b.x - c.x, dy = b.y - c.y, R = c.r + b.r, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
  b.x = c.x + nx * R; b.y = c.y + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (c.kind === 'bumper') {
    if (vn < c.kick) {
      const add = c.kick - vn; b.vx += nx * add; b.vy += ny * add;
      if (c.hit) c.hit(c, b, -vn);
    }
    return;
  }
  if (vn < 0) {
    const e = -vn < 0.9 ? 0 : c.e;
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
    if (-vn > 3) Snd.wall(-vn * 0.7);
  }
}
function collideFlipper(b, f) {
  const dirx = Math.cos(f.ang), diry = Math.sin(f.ang);
  const px = b.x - f.px, py = b.y - f.py;
  let t = (px * dirx + py * diry) / f.L; t = clamp(t, 0, 1);
  const cx = f.px + dirx * f.L * t, cy = f.py + diry * f.L * t;
  const rr = f.r1 + (f.r2 - f.r1) * t;
  const dx = b.x - cx, dy = b.y - cy, R = rr + b.r, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
  b.x = cx + nx * R; b.y = cy + ny * R;
  const sx = cx + nx * rr - f.px, sy = cy + ny * rr - f.py;
  const ux = -f.w * sy, uy = f.w * sx;            // velocidad de la superficie del flipper
  let rvx = b.vx - ux, rvy = b.vy - uy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const e = -vn < 1.2 ? 0 : 0.32;
    rvx -= (1 + e) * vn * nx; rvy -= (1 + e) * vn * ny;
    if (-vn > 1.5) { const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty; rvx -= vt * 0.03 * tx; rvy -= vt * 0.03 * ty; }
    b.vx = rvx + ux; b.vy = rvy + uy;
    if (-vn > 9 && Math.abs(f.w) > 1) { FX.sparks(b.x, b.y, 0.2, 8, NEON.cyan, 5); FX.shake(0.08); }
  }
}
function collideBalls() {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]; if (a.held || a.dead) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]; if (b.held || b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, R = a.r + b.r, d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 < 1e-9) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, p = (R - d) / 2;
      a.x -= nx * p; a.y -= ny * p; b.x += nx * p; b.y += ny * p;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { const j2 = -rv * 0.95; a.vx -= nx * j2; a.vy -= ny * j2; b.vx += nx * j2; b.vy += ny * j2; if (j2 > 3) Snd.wall(j2); }
    }
  }
}
function updateFlippers(dt) {
  for (const f of flippers) {
    const tgt = f.pressed ? f.up : f.rest; const diff = tgt - f.ang;
    const sp = (f.pressed ? FLIP_UP : FLIP_DN) * dt;
    if (Math.abs(diff) <= sp) { f.w = diff / dt; f.ang = tgt; } else { f.w = Math.sign(diff) * sp / dt; f.ang += Math.sign(diff) * sp; }
  }
}
function physStep(dt) {
  updateFlippers(dt);
  for (const b of balls) {
    if (b.dead || b.held) continue;
    if (b.inPlunger) {
      b.x = LANE_X; b.vx = 0;
      if (plunger.charging || plunger.auto > 0 || plunger.pull > 0) { b.y = PLUNGER_Y + plunger.pull * 0.55; b.vy = 0; continue; }
    }
    b.vy += GRAV * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; }
    const damp = 1 - 0.05 * dt; b.vx *= damp; b.vy *= damp;
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      // descarte rápido por caja
      const minx = Math.min(s.ax, s.bx) - 0.6, maxx = Math.max(s.ax, s.bx) + 0.6;
      if (b.x < minx || b.x > maxx) continue;
      const miny = Math.min(s.ay, s.by) - 0.6, maxy = Math.max(s.ay, s.by) + 0.6;
      if (b.y < miny || b.y > maxy) continue;
      collideSeg(b, s);
    }
    for (let i = 0; i < circles.length; i++) collideCirc(b, circles[i]);
    for (const f of flippers) collideFlipper(b, f);
    if (b.eject > 0) b.eject -= dt;
  }
  collideBalls();
}
function gameLogic(dt) {
  // sensores, agujero, drenaje
  for (const b of balls.slice()) {
    if (b.dead) continue;
    if (b.held) {
      b.heldT += dt;
      b.x = lerp(b.x, SAUCER.x, 0.2); b.y = lerp(b.y, SAUCER.y, 0.2);
      if (b.lockGhost && b.heldT > (b.holdFor || 1)) {
        // la bola bloqueada desaparece "dentro" y sale una nueva al lanzador
        Scene3D.removeBall(b); b.dead = true; balls = balls.filter(x => x !== b);
        serveBall(false);
        continue;
      }
      if (!b.lockGhost && b.heldT > (b.holdFor || 1)) ejectFromSaucer(b);
      continue;
    }
    if (b.inPlunger && b.y < 8.4) { b.inPlunger = false; }
    // agujero
    if (b.eject <= 0) {
      const dx = b.x - SAUCER.x, dy = b.y - SAUCER.y;
      if (dx * dx + dy * dy < SAUCER.r * SAUCER.r && Math.hypot(b.vx, b.vy) < 17) { saucerCapture(b); continue; }
    }
    for (const s of sensors) {
      const dx = b.x - s.x, dy = b.y - s.y;
      if (dx * dx + dy * dy < s.r * s.r) {
        const l = s.last.get(b.id) || -9;
        if (clock - l > (s.cool || 0.6)) s.fn(b, s);
        s.last.set(b.id, clock);
      }
    }
    // atasco: si la bola se queda quieta mucho tiempo, se le da un empujón
    const sp = Math.hypot(b.vx, b.vy);
    if (!b.inPlunger && sp < 0.35) { b.stillT += dt; if (b.stillT > 4) { b.vx = rnd(-5, 5); b.vy = -rnd(6, 10); b.stillT = 0; } } else b.stillT = 0;
    if (b.y > DRAIN_Y || b.x < -5.5 || b.x > 5.6 || b.y < TOP_Y - 1) { drainBall(b); }
  }
  // cola de expulsión del agujero en multibola
  if (G.ejectQ.length && clock > G.ejectQ[0]) {
    G.ejectQ.shift();
    const nb = makeBall(SAUCER.x, SAUCER.y); nb.held = 1; nb.heldT = 0; nb.holdFor = 0.4; nb.h = 0.05;
  }
  if (G.dropReset && clock > G.dropReset && !G.lockLit) resetDrops();
  // lanzador
  const pb = ballInPlunger();
  if (pb) {
    if (plunger.auto > 0) {
      plunger.pull = Math.min(plunger.auto, plunger.pull + dt * 1.6);
      if (plunger.pull >= plunger.auto) { launch(pb, plunger.pull); plunger.auto = 0; }
    } else if (plunger.charging) {
      const prev = plunger.pull; plunger.pull = Math.min(1, plunger.pull + dt * 1.1);
      if (Math.floor(prev * 10) !== Math.floor(plunger.pull * 10)) Snd.charge(plunger.pull);
    }
  } else if (!plunger.charging) plunger.pull = Math.max(0, plunger.pull - dt * 6);
  Snd.setRoll(balls.reduce((m, b) => b.held || b.inPlunger ? m : Math.max(m, Math.hypot(b.vx, b.vy)), 0));
}
function launch(b, p) {
  b.vy = -(35 + 12 * p); b.vx = 0; plunger.pull = 0; plunger.charging = false;
  if (G.saveArmed) { G.saveUntil = clock + 10; G.saveArmed = false; }
  Snd.launch(p); vibrate(25); FX.launchFx(p);
}
function releasePlunger() {
  const b = ballInPlunger();
  if (b && plunger.charging) launch(b, Math.max(0.05, plunger.pull));
  plunger.charging = false;
}

// Sensores
const LANE_SENS = [0, 1, 2].map(i => sensor(LANE_POSTS[i] + 0.6, -19.45, 0.45, b => laneHit(i, b)));
sensor(SPINNER.x, SPINNER.y, 0.65, b => {
  const n = Math.round(clamp(Math.abs(b.vy) * 0.7, 2, 28)); G.spins = (G.spins || 0) + n;
  addScore(100 * n, SPINNER.x, SPINNER.y - 0.6, 'SPINNER', '#6f9'); G.bonus += 20 * n;
  FX.spin(n, b.vy);
  if (G.spins >= 100) { G.spins -= 100; addScore(15000, SPINNER.x, SPINNER.y - 1.2, 'SUPER SPINNER', '#6f9'); showMsg(['SUPER', 'SPINNER'], 1.5, 'zoom'); Snd.fanfare(); }
}, { cool: 0.5 });
sensor(-3.95, -16.6, 0.6, b => { if (b.vy < 0) G.orbitT = clock; }, { cool: 0.4 });
sensor(3.45, -16.8, 0.55, b => {
  if (b.vy > 0 && clock - G.orbitT < 2.2) {
    G.orbitCombo = clock - G.orbitT < 2.2 ? G.orbitCombo + 1 : 1; G.orbitT = -9;
    const p = 5000 * Math.min(4, G.orbitCombo); addScore(p, 3.2, -17.5, 'ORBITA', '#f6f');
    showMsg(['ORBITA', 'x' + Math.min(4, G.orbitCombo) + '  ' + fmt(p)], 1.4, 'zoom'); Snd.fanfare(); FX.orbitFx(); G.bonus += 500;
  }
}, { cool: 0.4 });
sensor(-3.35, 6.55, 0.4, b => { addScore(1000, -3.35, 6.55); Snd.roll(); FX.inlane(0); G.bonus += 100; });
sensor(mx(-3.35), 6.55, 0.4, b => { addScore(1000, mx(-3.35), 6.55); Snd.roll(); FX.inlane(1); G.bonus += 100; });
sensor(-4.22, 8.6, 0.45, b => {
  if (G.kickback) {
    G.kickback = false; b.vy = -34; b.vx = 0.5; b.x = -4.22; addScore(2000, -4.2, 8.4, 'KICKBACK', '#f84');
    showMsg(['KICKBACK!', ''], 1.2, 'blink'); Snd.kick(); vibrate(60); FX.shock(-4.22, 8.6, NEON.orange, 2); FX.shake(0.3);
  } else { addScore(2000, -4.2, 8.4); Snd.roll(); }
}, { cool: 1 });
sensor(mx(-4.22), 8.6, 0.45, b => { addScore(2000, mx(-4.2), 8.4); Snd.roll(); }, { cool: 1 });

/* =========================================================
   GRÁFICOS 3D
   ========================================================= */
const glCanvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const hx = hud.getContext('2d');
let W = 0, H = 0, DPR = 1, DMD_H = 0, DMD_Y = 0;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance', alpha: false });
} catch (e) { renderer = null; }

const Scene3D = (() => {
  if (!renderer) return { addBall() {}, removeBall() {}, update() {}, render() {}, resize() {} };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030c);
  scene.fog = new THREE.Fog(0x05030c, 55, 110);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const isGL2 = renderer.capabilities.isWebGL2;
  const floatOK = isGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  const camera = new THREE.PerspectiveCamera(40, 0.5, 0.1, 160);
  const P = (x, y, h) => new THREE.Vector3(x, h || 0, y);

  /* ---------- Mapa de entorno (reflejos cromados) ---------- */
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.01, 0.05), side: THREE.BackSide })));
  const panel = (w, h, col, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col[0], col[1], col[2]), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry || 0; m.rotation.x = rx || 0; envScene.add(m); };
  panel(16, 3, [3, 2.8, 3.2], 0, 9.5, 0, 0, Math.PI / 2);
  panel(3, 18, [3, 0.25, 1.8], -19.5, 0, 0, Math.PI / 2);
  panel(3, 18, [0.2, 2, 3], 19.5, 0, 0, -Math.PI / 2);
  panel(20, 2, [3, 1.6, 0.3], 0, 2, -19.5);
  panel(20, 1.2, [1.2, 0.3, 3], 0, -3, 19.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(envScene, 0.03).texture;

  /* ---------- Luces ---------- */
  scene.add(new THREE.HemisphereLight(0x8a7cff, 0x1a0a28, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 1.3); dir.position.set(-3, 14, 10); scene.add(dir);
  const pL = new THREE.PointLight(0xff2aa0, 4, 16, 1.4); pL.position.set(-3.5, 4.5, -4); scene.add(pL);
  const pU = new THREE.PointLight(0x9a5cff, 4, 16, 1.4); pU.position.set(0.5, 4.5, -15); scene.add(pU);
  const pR = new THREE.PointLight(0x20d0ff, 4, 16, 1.4); pR.position.set(3.5, 4.5, 3); scene.add(pR);
  const flashL = new THREE.PointLight(0xffffff, 0, 9, 1.8); flashL.position.set(0, 1.5, 0); scene.add(flashL);
  let flashI = 0;

  /* ---------- Tablero (textura dibujada) ---------- */
  const X0 = -4.75, X1 = 4.95, Y0 = TOP_Y - 0.3, Y1 = 11.0, TW = X1 - X0, TL = Y1 - Y0;
  const TEXH = 4080, TEXW = Math.round(TEXH * TW / TL);
  const tc = document.createElement('canvas'); tc.width = TEXW; tc.height = TEXH;
  const t = tc.getContext('2d');
  const cx = x => (x - X0) / TW * TEXW, cy = y => (y - Y0) / TL * TEXH, cs = v => v / TW * TEXW;
  {
    let g = t.createLinearGradient(0, 0, 0, TEXH);
    g.addColorStop(0, '#05041a'); g.addColorStop(0.3, '#0d0830'); g.addColorStop(0.62, '#170a3c'); g.addColorStop(0.85, '#2a0b3e'); g.addColorStop(1, '#12051c');
    t.fillStyle = g; t.fillRect(0, 0, TEXW, TEXH);
    // estrellas
    for (let i = 0; i < 420; i++) { t.fillStyle = `rgba(255,255,255,${rnd(0.15, 0.8)})`; const s = rnd(1, 3.2); t.fillRect(rnd(0, TEXW), rnd(0, cy(0)), s, s); }
    // planeta con anillo (zona central)
    {
      const px = cx(CX), py = cy(-9.6), pr = cs(1.7);
      let pg = t.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#b78cff'); pg.addColorStop(0.6, '#5a2bb0'); pg.addColorStop(1, '#1c0b45');
      t.save(); t.shadowColor = '#8a5cff'; t.shadowBlur = 50; t.fillStyle = pg; t.beginPath(); t.arc(px, py, pr, 0, 7); t.fill(); t.restore();
      t.save(); t.translate(px, py); t.rotate(-0.35); t.scale(1, 0.28); t.strokeStyle = 'rgba(0,229,255,0.75)'; t.lineWidth = 10; t.beginPath(); t.arc(0, 0, pr * 1.75, 0, 7); t.stroke(); t.strokeStyle = 'rgba(255,47,168,0.5)'; t.lineWidth = 5; t.beginPath(); t.arc(0, 0, pr * 2.05, 0, 7); t.stroke(); t.restore();
      // líneas de velocidad "turbo"
      t.strokeStyle = 'rgba(0,229,255,0.35)'; t.lineWidth = 4;
      for (let i = 0; i < 9; i++) { const yy = cy(-14.2 + i * 0.12); t.beginPath(); t.moveTo(cx(-3.0 + i * 0.1), yy); t.lineTo(cx(2.4 - i * 0.1), yy); t.stroke(); }
    }
    // sol synthwave
    const sx = cx(CX), sy = cy(1.7), sr = cs(2.3);
    g = t.createLinearGradient(0, sy - sr, 0, sy + sr); g.addColorStop(0, '#ffe25a'); g.addColorStop(0.5, '#ff6a3d'); g.addColorStop(1, '#ff1f8e');
    t.save(); t.shadowColor = '#ff3d8b'; t.shadowBlur = 60; t.fillStyle = g; t.beginPath(); t.arc(sx, sy, sr, 0, Math.PI * 2); t.fill(); t.restore();
    t.fillStyle = '#1d0a3c';
    for (let i = 0; i < 7; i++) { const yy = sy + sr * (0.05 + i * 0.14); t.fillRect(sx - sr, yy, sr * 2, 3 + i * 2.2); }
    // rejilla synthwave
    const hy = cy(3.9); t.strokeStyle = 'rgba(255,60,200,0.55)'; t.lineWidth = 3;
    t.fillStyle = '#16052a'; t.fillRect(0, hy, TEXW, cy(8.6) - hy);
    for (let i = 0; i < 12; i++) { const yy = hy + Math.pow(i / 11, 1.8) * (cy(8.6) - hy); t.globalAlpha = 0.3 + i / 18; t.beginPath(); t.moveTo(0, yy); t.lineTo(TEXW, yy); t.stroke(); }
    t.globalAlpha = 0.6;
    for (let i = -12; i <= 12; i++) { t.beginPath(); t.moveTo(cx(CX) + i * 16, hy); t.lineTo(cx(CX) + i * 150, cy(8.6)); t.stroke(); }
    t.globalAlpha = 1;
    // título
    t.save(); t.textAlign = 'center'; t.textBaseline = 'middle';
    t.font = `900 ${cs(1.05)}px Arial Black, Impact, sans-serif`;
    t.shadowColor = '#00e5ff'; t.shadowBlur = 30; t.lineWidth = 8; t.strokeStyle = '#00e5ff'; t.strokeText('PIRU', cx(CX), cy(4.55));
    t.fillStyle = '#ffffff'; t.fillText('PIRU', cx(CX), cy(4.55));
    t.font = `900 ${cs(0.55)}px Arial Black, Impact, sans-serif`; t.shadowColor = '#ff2fa8'; t.strokeStyle = '#ff2fa8'; t.lineWidth = 5;
    t.strokeText('P I N B A L L', cx(CX), cy(5.4)); t.fillStyle = '#ffe6f6'; t.fillText('P I N B A L L', cx(CX), cy(5.4));
    t.restore();
    // halos de bumpers
    BUMPERS.forEach(b => { const rg = t.createRadialGradient(cx(b.x), cy(b.y), cs(0.4), cx(b.x), cy(b.y), cs(1.1)); rg.addColorStop(0, 'rgba(0,229,255,0.45)'); rg.addColorStop(1, 'rgba(0,229,255,0)'); t.fillStyle = rg; t.beginPath(); t.arc(cx(b.x), cy(b.y), cs(1.1), 0, 7); t.fill(); });
    // carril del lanzador
    t.fillStyle = '#0a0618'; t.fillRect(cx(4.0), cy(-16), cx(4.8) - cx(4.0), cy(10.5) - cy(-16));
    t.strokeStyle = 'rgba(255,60,200,0.7)'; t.lineWidth = 4;
    for (let y = 8; y > -14; y -= 1.4) { t.beginPath(); t.moveTo(cx(4.15), cy(y)); t.lineTo(cx(4.4), cy(y - 0.5)); t.lineTo(cx(4.65), cy(y)); t.stroke(); }
    // etiquetas
    const label = (txt, x, y, size, col, rot) => { t.save(); t.translate(cx(x), cy(y)); if (rot) t.rotate(rot); t.font = `bold ${cs(size)}px Arial, sans-serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = col; t.shadowColor = col; t.shadowBlur = 12; t.fillText(txt, 0, 0); t.restore(); };
    ['P', 'I', 'R'].forEach((L, i) => label(L, LANE_POSTS[i] + 0.6, -18.55, 0.42, '#ffe066'));
    ['T', 'U', 'R', 'B', 'O'].forEach((L, i) => label(L, TURBO_X[i], -12.35, 0.3, '#7ff4ff'));
    label('SPINNER', SPINNER.x, -6.75, 0.24, '#7dffa8');
    ['2X', '3X', '4X', '5X'].forEach((L, i) => label(L, CX - 1.35 + i * 0.9, 7.25, 0.22, '#ffffff'));
    label('LOCK', 1.55, -0.65, 0.26, '#ff7ad9', -0.9);
    label('JACKPOT', 2.95, -0.65, 0.22, '#ffe066', 0.9);
    label('KICKBACK', -4.22, 7.6, 0.16, '#ff9c40', -Math.PI / 2);
    label('OTRA BOLA', CX, 8.85, 0.2, '#ff5050');
    label('ORBITA', -3.95, -14.6, 0.2, '#c08cff', -Math.PI / 2);
    label('ORBITA', 3.45, -14.9, 0.2, '#c08cff', Math.PI / 2);
    // zona de fuera del arco en negro
    t.fillStyle = '#000'; t.beginPath(); t.moveTo(0, 0); t.lineTo(TEXW, 0); t.lineTo(TEXW, cy(ARC.y));
    for (let i = 0; i <= 60; i++) { const a = Math.PI * 2 - Math.PI * i / 60; t.lineTo(cx(ARC.x + Math.cos(a) * (ARC.r + 0.1)), cy(ARC.y + Math.sin(a) * (ARC.r + 0.1))); }
    t.lineTo(0, cy(ARC.y)); t.closePath(); t.fill();
  }
  const pfTex = new THREE.CanvasTexture(tc); pfTex.colorSpace = THREE.SRGBColorSpace; pfTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(TW, TL), new THREE.MeshStandardMaterial({ map: pfTex, roughness: 0.38, metalness: 0.1, envMap: envTex, envMapIntensity: 0.55 }));
  pf.rotation.x = -Math.PI / 2; pf.position.set((X0 + X1) / 2, 0, (Y0 + Y1) / 2); scene.add(pf);

  /* ---------- Paredes (instanciadas) ---------- */
  const wallSegs = segs.filter(s => s.vis && s.kind !== 'sling');
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1533, metalness: 0.7, roughness: 0.3, envMap: envTex, envMapIntensity: 1 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ff, metalness: 0, roughness: 0.55, emissive: 0x221133 });
  const wallsI = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, wallSegs.length);
  const neonI = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), wallSegs.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  wallSegs.forEach((s, i) => {
    const ang = -Math.atan2(s.by - s.ay, s.bx - s.ax);
    q.setFromAxisAngle(up, ang);
    const h = s.kind === 'rubber' ? 0.4 : s.h;
    pos.set((s.ax + s.bx) / 2, h / 2, (s.ay + s.by) / 2); sc.set(s.len + 0.02, h, s.r * 2);
    m4.compose(pos, q, sc); wallsI.setMatrixAt(i, m4);
    pos.y = h + 0.03; sc.set(s.len + 0.02, 0.06, s.r * 1.1); m4.compose(pos, q, sc); neonI.setMatrixAt(i, m4);
    const c = s.color || NEON.white; col.setRGB(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55); neonI.setColorAt(i, col);
  });
  scene.add(wallsI); scene.add(neonI);
  // postes de goma
  const postGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
  circles.filter(c => c.kind === 'rubber' || c.kind === 'post').forEach(c => {
    const m = new THREE.Mesh(postGeo, rubberMat); m.scale.set(c.r, 0.45, c.r); m.position.set(c.x, 0.225, c.y); scene.add(m);
    const cap = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.9, roughness: 0.2, envMap: envTex })); cap.scale.set(c.r * 0.55, 0.12, c.r * 0.55); cap.position.set(c.x, 0.5, c.y); scene.add(cap);
  });

  /* ---------- Slingshots ---------- */
  const slings = [slingL, slingR].map(k => {
    const A = [k.bx, k.by], C = [k.ax, k.ay];
    const B = k.B;
    const sh = new THREE.Shape(); sh.moveTo(A[0], -A[1]); sh.lineTo(B[0], -B[1]); sh.lineTo(C[0], -C[1]); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x220a33, emissive: new THREE.Color(1.2, 0.1, 0.8), emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.92 });
    const m = new THREE.Mesh(g, mat); scene.add(m);
    // banda de goma del lado que golpea
    const len = k.len, ang = -Math.atan2(k.by - k.ay, k.bx - k.ax);
    const band = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.8) }));
    band.position.set((k.ax + k.bx) / 2, 0.2, (k.ay + k.by) / 2); band.rotation.y = ang; scene.add(band);
    return { mat, band, flash: 0, nx: k.nx, ny: k.ny, base: band.position.clone() };
  });

  /* ---------- Bumpers ---------- */
  const bumpers = BUMPERS.map((b, i) => {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.y);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.18, 32), new THREE.MeshStandardMaterial({ color: 0x111122, metalness: 0.8, roughness: 0.25, envMap: envTex })); base.position.y = 0.09; g.add(base);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2, 3) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 10, 40), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.28; g.add(ring);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.38, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.12, envMap: envTex, envMapIntensity: 1.3 })); body.position.y = 0.37; g.add(body);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x101020, emissive: new THREE.Color([2.5, 0.2, 1.5][0], [0.2, 2.2, 0.2][i] || 0.4, 2.5), emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.95 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.48, 0.14, 32), capMat); cap.position.y = 0.62; g.add(cap);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.22, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1) })); star.rotation.x = -Math.PI / 2; star.position.y = 0.70; g.add(star);
    const k = b.r / 0.5; g.scale.set(k, 1, k);
    scene.add(g);
    return { g, ringMat, capMat, star, flash: 0, ring, cap };
  });

  /* ---------- Dianas ---------- */
  const dropMeshes = DROPS.map((d, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.56), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(3, 1.2, 0.1), emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }));
    m.position.set(d.ax, 0.25, (d.ay + d.by) / 2); scene.add(m); return { m, y: 0.25, flash: 0 };
  });
  const standMeshes = STANDS.map((s, i) => {
    const g = new THREE.Group(); g.position.set(s.ax, 0, (s.ay + s.by) / 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.46), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0.2, 3, 0.8), emissiveIntensity: 0.5 }));
    m.position.y = 0.3; g.add(m);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), wallMat); post.position.set(0.08, 0.15, 0); g.add(post);
    scene.add(g); return { m, g, flash: 0 };
  });

  const turboMeshes = TURBO.map((t2, i) => {
    const g = new THREE.Group(); g.position.set((t2.ax + t2.bx) / 2, 0, t2.ay);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0.2, 1.6, 2.2), emissiveIntensity: 0.4 }));
    m.position.y = 0.28; g.add(m);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), wallMat); post.position.set(0, 0.12, -0.08); g.add(post);
    scene.add(g); return { m, g, flash: 0 };
  });
  const spinG = new THREE.Group(); spinG.position.set(SPINNER.x, 0.62, SPINNER.y);
  const spinBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.75, 8), wallMat); spinBar.rotation.z = Math.PI / 2; spinG.add(spinBar);
  const spinPlate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0xd8d8e8, metalness: 1, roughness: 0.15, envMap: envTex, emissive: new THREE.Color(0.1, 0.6, 0.25), emissiveIntensity: 0.4 }));
  spinPlate.position.y = -0.25; const spinPiv = new THREE.Group(); spinPiv.add(spinPlate); spinG.add(spinPiv); scene.add(spinG);
  let spinW = 0;

  /* ---------- Agujero ---------- */
  const sauc = new THREE.Group(); sauc.position.set(SAUCER.x, 0.002, SAUCER.y);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.rotation.x = -Math.PI / 2; sauc.add(hole);
  const sRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.1) });
  const sRing = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 40), sRingMat); sRing.rotation.x = Math.PI / 2; sRing.position.y = 0.03; sauc.add(sRing);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.08), wallMat); kick.position.set(0.25, 0.17, -0.35); kick.rotation.y = 0.5; sauc.add(kick);
  scene.add(sauc);

  /* ---------- Luces del tablero (inserts) ---------- */
  const inserts = {};
  const addInsert = (name, x, y, shape, color, size, rot) => {
    let g;
    if (shape === 'arrow') { const s = new THREE.Shape(); s.moveTo(0, size); s.lineTo(size * 0.7, -size * 0.6); s.lineTo(0, -size * 0.25); s.lineTo(-size * 0.7, -size * 0.6); s.closePath(); g = new THREE.ShapeGeometry(s); }
    else if (shape === 'tri') { const s = new THREE.Shape(); s.moveTo(0, size); s.lineTo(size * 0.8, -size * 0.6); s.lineTo(-size * 0.8, -size * 0.6); s.closePath(); g = new THREE.ShapeGeometry(s); }
    else g = new THREE.CircleGeometry(size, 28);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.rotation.z = rot || 0; m.position.set(x, 0.01, y); scene.add(m);
    const ins = { m, mat, c: color, state: 0, flash: 0, lvl: 0 };
    inserts[name] = ins; return ins;
  };
  ['P', 'I', 'R'].forEach((L, i) => addInsert('lane' + i, LANE_POSTS[i] + 0.6, -19.1, 'circle', NEON.yellow, 0.2));
  TURBO_X.forEach((x, i) => addInsert('turbo' + i, x, -12.85, 'circle', NEON.cyan, 0.17));
  addInsert('spin', SPINNER.x, -7.05, 'arrow', NEON.green, 0.3, 0);
  [0, 1, 2, 3].forEach(i => addInsert('mult' + i, CX - 1.35 + i * 0.9, 6.85, 'circle', NEON.white, 0.24));
  DROPS.forEach((d, i) => addInsert('drop' + i, -3.7, (d.ay + d.by) / 2, 'tri', NEON.orange, 0.2, Math.PI / 2));
  STANDS.forEach((s, i) => addInsert('stand' + i, 3.15, (s.ay + s.by) / 2, 'tri', NEON.green, 0.18, -Math.PI / 2));
  addInsert('lock', 1.55, -1.05, 'arrow', NEON.pink, 0.32, -0.75);
  addInsert('jack', 2.95, -1.05, 'arrow', NEON.yellow, 0.3, 0.75);
  addInsert('kick', -4.22, 8.35, 'circle', NEON.orange, 0.17);
  addInsert('save', CX, 8.45, 'circle', NEON.red, 0.28);
  addInsert('orbL', -3.95, -15.6, 'arrow', NEON.purple, 0.3, 0);
  addInsert('orbR', 3.45, -15.8, 'arrow', NEON.purple, 0.3, Math.PI);
  addInsert('inL', -3.3, 5.75, 'circle', NEON.cyan, 0.14);
  addInsert('inR', mx(-3.3), 5.75, 'circle', NEON.cyan, 0.14);
  addInsert('skill', 4.4, 3.5, 'arrow', NEON.yellow, 0.25, 0);
  addInsert('sun', CX, 1.7, 'circle', [2.2, 0.6, 0.35], 2.05);
  inserts.sun.m.position.y = 0.004;

  /* ---------- Flippers ---------- */
  const flipGeo = f => {
    const s = new THREE.Shape(), N = 12;
    for (let i = 0; i <= N; i++) { const a = Math.PI / 2 + Math.PI * i / N; s.lineTo(Math.cos(a) * f.r1, Math.sin(a) * f.r1); }
    for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + Math.PI * i / N; s.lineTo(f.L + Math.cos(a) * f.r2, Math.sin(a) * f.r2); }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2); return g;
  };
  const flipMeshes = flippers.map((f, i) => {
    const g = new THREE.Group(); g.position.set(f.px, 0.03, f.py);
    const m = new THREE.Mesh(flipGeo(f), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.35, emissive: 0x1a1030 }));
    g.add(m);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(f.L * 0.85, 0.03, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(i ? 1.8 : 0.15, i ? 0.2 : 1.3, i ? 1.1 : 1.8) }));
    stripe.position.set(f.L * 0.47, 0.4, 0); g.add(stripe);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 1, roughness: 0.2, envMap: envTex })); pin.position.y = 0.42; g.add(pin);
    scene.add(g); return { g, stripe };
  });

  /* ---------- Lanzador, compuerta, apron, mueble ---------- */
  const plungerG = new THREE.Group(); plungerG.position.set(LANE_X, 0.2, 9.9);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2, envMap: envTex })); rod.rotation.x = Math.PI / 2; rod.position.z = 0.35; plungerG.add(rod);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0xff2fa8, emissive: 0x660033, roughness: 0.4 })); tip.rotation.x = Math.PI / 2; plungerG.add(tip);
  scene.add(plungerG);
  const gateM = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, 0.04), new THREE.MeshStandardMaterial({ color: 0xc0c0d0, metalness: 1, roughness: 0.2, envMap: envTex }));
  const gateG = new THREE.Group(); gateG.position.set((gate.ax + gate.bx) / 2, 0.45, (gate.ay + gate.by) / 2); gateG.rotation.y = -Math.atan2(gate.by - gate.ay, gate.bx - gate.ax);
  gateM.position.y = -0.16; gateG.add(gateM); scene.add(gateG);
  let gateSwing = 0;

  // apron
  {
    const sh = new THREE.Shape();
    sh.moveTo(-4.6, -9.25); sh.lineTo(-2.55, -8.3); sh.lineTo(-2.0, -9.6); sh.lineTo(1.4, -9.6); sh.lineTo(1.95, -8.3); sh.lineTo(4.0, -9.25); sh.lineTo(4.0, -11.2); sh.lineTo(-4.6, -11.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const apron = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x24123f, metalness: 0.6, roughness: 0.35, envMap: envTex })); apron.position.y = 0.0; scene.add(apron);
    const ac = document.createElement('canvas'); ac.width = 512; ac.height = 96; const a = ac.getContext('2d');
    a.fillStyle = 'rgba(0,0,0,0)'; a.fillRect(0, 0, 512, 96); a.font = '900 54px Arial Black, Impact, sans-serif'; a.textAlign = 'center'; a.textBaseline = 'middle';
    a.shadowColor = '#ff2fa8'; a.shadowBlur = 18; a.fillStyle = '#ffd6f0'; a.fillText('LA PIRULETA', 256, 50);
    const at = new THREE.CanvasTexture(ac); at.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), new THREE.MeshBasicMaterial({ map: at, transparent: true })); lab.rotation.x = -Math.PI / 2; lab.position.set(CX, 0.27, 10.25); scene.add(lab);
  }
  // mueble lateral con tiras LED animadas
  const ledMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uBoost: { value: 0 }, uHue: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec2 vU; uniform float uT; uniform float uBoost; uniform float uHue;
      vec3 hsv(float h){ vec3 k=abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.; return clamp(k,0.,1.); }
      void main(){ float h=fract(vU.x*1.5-uT*0.25+uHue); vec3 c=hsv(h);
        float pulse=0.55+0.45*sin(vU.x*60.0-uT*8.0);
        float dots=smoothstep(0.35,0.0,abs(fract(vU.x*90.0)-0.5));
        gl_FragColor=vec4(c*(1.3+uBoost*2.5)*mix(0.6,1.0,pulse)*(0.5+0.5*dots),1.0); }`
  });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x0c0818, metalness: 0.8, roughness: 0.35, envMap: envTex });
  [[-5.0, 0.8], [5.2, 0.8]].forEach(([x, w]) => {
    const RL = 12 - TOP_Y, RZ = (12 + TOP_Y) / 2;
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, RL), railMat); r.position.set(x + (x < 0 ? -w / 2 + 0.4 : w / 2 - 0.4), 0.5, RZ); scene.add(r);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(RL, 0.12), ledMat); led.rotation.set(-Math.PI / 2, 0, Math.PI / 2); led.position.set(x + (x < 0 ? 0.32 : -0.32), 1.01, RZ); scene.add(led);
  });
  const backW = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.0, 0.8), railMat); backW.position.set(0.1, 0.5, TOP_Y - 0.7); scene.add(backW);
  const ledB = new THREE.Mesh(new THREE.PlaneGeometry(10.3, 0.12), ledMat); ledB.rotation.x = -Math.PI / 2; ledB.position.set(0.1, 1.01, TOP_Y - 0.4); scene.add(ledB);
  const front = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.1, 0.9), railMat); front.position.set(0.1, 0.55, 11.4); scene.add(front);
  // backbox lejano (fondo)
  {
    const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 512; const b = bc.getContext('2d');
    let g = b.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#05010f'); g.addColorStop(0.6, '#2a0640'); g.addColorStop(1, '#ff2f8e'); b.fillStyle = g; b.fillRect(0, 0, 1024, 512);
    b.fillStyle = '#ffcf4a'; b.shadowColor = '#ff5a3d'; b.shadowBlur = 40; b.beginPath(); b.arc(512, 400, 170, Math.PI, 0); b.fill(); b.shadowBlur = 0;
    b.fillStyle = '#2a0640'; for (let i = 0; i < 6; i++) b.fillRect(330, 300 + i * 18, 370, 4 + i * 1.5);
    b.strokeStyle = 'rgba(0,230,255,0.8)'; b.lineWidth = 3; for (let i = 0; i < 9; i++) { b.beginPath(); b.moveTo(0, 412 + i * i * 1.3); b.lineTo(1024, 412 + i * i * 1.3); b.stroke(); }
    const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: bt, color: new THREE.Color(0.9, 0.9, 0.9), fog: false })); bb.position.set(0.1, 4.5, TOP_Y - 8); scene.add(bb);
  }

  /* ---------- Bolas ---------- */
  const ballGeo = new THREE.SphereGeometry(BR, 32, 20);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.06, envMap: envTex, envMapIntensity: 1.6 });
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
  const shGeo = new THREE.PlaneGeometry(BR * 3.2, BR * 3.2);
  function addBall(b) {
    const m = new THREE.Mesh(ballGeo, ballMat); scene.add(m);
    const s = new THREE.Mesh(shGeo, shMat); s.rotation.x = -Math.PI / 2; scene.add(s);
    const glow = new THREE.PointLight(0xffffff, 0, 2.2, 2); scene.add(glow);
    b.mesh = m; b.shadow = s; b.glow = glow; b.rot = new THREE.Quaternion(); b.prevX = b.x; b.prevY = b.y;
  }
  function removeBall(b) { if (b.mesh) { scene.remove(b.mesh); scene.remove(b.shadow); scene.remove(b.glow); b.mesh = null; } }

  /* ---------- Partículas ---------- */
  const PN = 900;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN);
  const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pS0 = new Float32Array(PN);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 4));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: 'attribute float size; attribute vec4 pcolor; varying vec4 vC; uniform float uScale; void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/-mv.z; gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); a*=a; gl_FragColor=vec4(vC.rgb*a*vC.a,1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let pIdx = 0;
  function emit(x, h, y, vx, vh, vy, life, size, c) {
    const i = pIdx; pIdx = (pIdx + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = h; pPos[i * 3 + 2] = y;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vh; pVel[i * 3 + 2] = vy;
    pLife[i] = life; pMax[i] = life; pS0[i] = size;
    pCol[i * 4] = c[0]; pCol[i * 4 + 1] = c[1]; pCol[i * 4 + 2] = c[2]; pCol[i * 4 + 3] = 1;
  }
  function updateParticles(dt) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) { pSize[i] = 0; continue; }
      pLife[i] -= dt; const k = Math.max(0, pLife[i] / pMax[i]);
      pVel[i * 3 + 1] -= 9 * dt;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pPos[i * 3 + 1] < 0.02) { pPos[i * 3 + 1] = 0.02; pVel[i * 3 + 1] *= -0.4; pVel[i * 3] *= 0.7; pVel[i * 3 + 2] *= 0.7; }
      pCol[i * 4 + 3] = k; pSize[i] = pS0[i] * (0.4 + 0.6 * k);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.pcolor.needsUpdate = true; pGeo.attributes.size.needsUpdate = true;
  }

  /* ---------- Ondas expansivas ---------- */
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.88, 1.0, 48);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); rings.push({ m, t: 1, d: 0.5, s: 1 });
  }
  let ringIdx = 0;
  function shock(x, y, c, size) {
    const r = rings[ringIdx]; ringIdx = (ringIdx + 1) % rings.length;
    r.m.visible = true; r.t = 0; r.d = 0.45; r.s = size || 1.2; r.m.position.set(x, 0.06, y);
    r.c = c;
  }

  /* ---------- Post-proceso: bloom HDR + aberración + viñeta + scanlines ---------- */
  const RT_OPTS = { type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  let rtScene = null, mips = [];
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uTh: { value: 1.0 } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTh; varying vec2 vUv;
      void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float l=max(c.r,max(c.g,c.b)); float k=smoothstep(uTh,uTh+0.8,l); gl_FragColor=vec4(c*k,1.0); }`, depthTest: false });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
      void main(){ vec3 s=texture2D(tDiffuse,vUv).rgb*0.227027;
        s+=texture2D(tDiffuse,vUv+uDir*1.3846).rgb*0.3162162; s+=texture2D(tDiffuse,vUv-uDir*1.3846).rgb*0.3162162;
        s+=texture2D(tDiffuse,vUv+uDir*3.2308).rgb*0.0702703; s+=texture2D(tDiffuse,vUv-uDir*3.2308).rgb*0.0702703;
        gl_FragColor=vec4(s,1.0); }`, depthTest: false });
  const compMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null },
      uBloom: { value: 1.0 }, uAb: { value: 0 }, uT: { value: 0 }, uFlash: { value: 0 }, uExp: { value: 1.0 }, uRes: { value: new THREE.Vector2(1, 1) }, uScan: { value: 0.0 }, uFlashCol: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tScene,tB0,tB1,tB2,tB3; uniform float uBloom,uAb,uT,uFlash,uExp,uScan; uniform vec2 uRes; uniform vec3 uFlashCol; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 d=(vUv-0.5); float r2=dot(d,d);
        vec2 off=d*uAb*(0.4+r2*2.0);
        vec3 c; c.r=texture2D(tScene,vUv+off).r; c.g=texture2D(tScene,vUv).g; c.b=texture2D(tScene,vUv-off).b;
        vec3 b=texture2D(tB0,vUv).rgb*0.7+texture2D(tB1,vUv).rgb*0.55+texture2D(tB2,vUv).rgb*0.3+texture2D(tB3,vUv).rgb*0.15;
        c+=b*uBloom;
        c+=uFlashCol*uFlash;
        c=aces(c*uExp);
        c*=1.0-smoothstep(0.25,0.8,r2)*0.35;
        float sl=sin(vUv.y*uRes.y*3.14159*0.5)*0.5+0.5; c*=1.0-uScan*sl;
        
        c=pow(c,vec3(1.0/2.2));
        gl_FragColor=vec4(c,1.0); }`, depthTest: false });

  function makeRT(w, h, samples) { const o = Object.assign({}, RT_OPTS); if (samples && isGL2) o.samples = samples; if (samples) o.depthBuffer = true; return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), o); }
  function resize(w, h, dpr) {
    const pr = save.q ? Math.min(dpr, 2.75) : Math.min(dpr, 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    const pw = Math.floor(w * pr), ph = Math.floor(h * pr);
    if (rtScene) rtScene.dispose(); mips.forEach(m => { m[0].dispose(); m[1].dispose(); });
    rtScene = makeRT(pw, ph, save.q ? 4 : 0);
    mips = [];
    let mw = pw >> 1, mh = ph >> 1;
    for (let i = 0; i < 4; i++) { mips.push([makeRT(mw, mh), makeRT(mw, mh), mw, mh]); mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); }
    camera.aspect = w / h; camera.updateProjectionMatrix();
    pMat.uniforms.uScale.value = ph / (2 * Math.tan(camera.fov * Math.PI / 360));
    compMat.uniforms.uRes.value.set(pw, ph);
  }
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }

  /* ---------- Cámara ---------- */
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let shakeA = 0, followZ = 1.2, camT = 0;

  /* ---------- Bucle de dibujado ---------- */
  function update(dt, rt) {
    camT += rt;
    const T = clock;
    const play = STATE === 'play' || STATE === 'pause' || STATE === 'over';
    // inserts: estado
    const lvl = (name, st) => { const i = inserts[name]; if (i) i.state = st; };
    if (G && play) {
      for (let i = 0; i < 3; i++) lvl('lane' + i, G.skill === i ? 2 : (G.lanes[i] ? 1 : 0));
      for (let i = 0; i < 4; i++) lvl('mult' + i, G.mult >= i + 2 ? 1 : (G.mult === i + 1 ? 2 : 0));
      for (let i = 0; i < 3; i++) lvl('drop' + i, G.drops[i] ? 1 : 2);
      for (let i = 0; i < 3; i++) lvl('stand' + i, G.stands[i] ? 1 : 2);
      lvl('lock', G.lockLit ? 2 : (G.locks ? 1 : 0));
      lvl('jack', G.multiball ? 2 : 0);
      lvl('kick', G.kickback ? 1 : 0);
      lvl('save', clock < G.saveUntil ? (G.saveUntil - clock < 3 ? 2 : 1) : 0);
      lvl('orbL', clock - G.orbitT < 2.2 ? 2 : 1); lvl('orbR', clock - G.orbitT < 2.2 ? 2 : 1);
      lvl('skill', ballInPlunger() ? 2 : 0);
      for (let i = 0; i < 5; i++) lvl('turbo' + i, G.turbo[i] ? 1 : 2);
      lvl('spin', 1);
      lvl('sun', 1);
    } else {
      // modo demostración: persecución de luces
      const names = Object.keys(inserts); names.forEach((n, k) => { inserts[n].state = (Math.floor(camT * 6) + k) % 5 === 0 ? 1 : 0; });
      inserts.sun.state = 1;
    }
    const blinkOn = Math.floor(camT * 6) % 2 === 0;
    for (const n in inserts) {
      const i = inserts[n];
      let target = i.state === 1 ? 0.75 : (i.state === 2 ? (blinkOn ? 0.75 : 0.1) : 0.06);
      if (n === 'sun') target = 0.05 + 0.03 * Math.sin(camT * 2) + FX.allFlash * 0.3;
      i.lvl = lerp(i.lvl, target, Math.min(1, rt * 18)) ;
      const k = Math.min(3, i.lvl + i.flash + FX.allFlash * 0.8); i.flash = Math.max(0, i.flash - rt * 3);
      i.mat.color.setRGB(i.c[0] * k, i.c[1] * k, i.c[2] * k);
    }
    // bumpers
    bumpers.forEach((b, i) => {
      b.flash = Math.max(0, b.flash - rt * 5);
      const sup = G && clock < G.superUntil;
      const k = 0.35 + b.flash * 2.2 + FX.allFlash * 0.7 + (sup ? 0.5 + 0.3 * Math.sin(camT * 20) : 0);
      b.capMat.emissiveIntensity = k;
      const rc = sup ? [3, 2.2, 0.3] : [0.3, 2, 3];
      b.ringMat.color.setRGB(rc[0] * (0.4 + b.flash * 1.6), rc[1] * (0.4 + b.flash * 1.6), rc[2] * (0.4 + b.flash * 1.6));
      const s = 1 + b.flash * 0.12; b.cap.scale.set(s, 1, s);
      b.ring.position.y = 0.28 - b.flash * 0.12;
      b.star.rotation.z += rt * (1 + b.flash * 20);
    });
    slings.forEach(s => {
      s.flash = Math.max(0, s.flash - rt * 6);
      s.mat.emissiveIntensity = 0.6 + s.flash * 4 + FX.allFlash;
      s.band.position.set(s.base.x + s.nx * s.flash * 0.12, s.base.y, s.base.z + s.ny * s.flash * 0.12);
      s.band.material.color.setRGB(1.6 + s.flash * 3, 1.6 + s.flash * 2, 1.8 + s.flash * 3);
    });
    dropMeshes.forEach((d, i) => {
      const down = !DROPS[i].on; const ty = down ? -0.3 : 0.25; d.y = lerp(d.y, ty, Math.min(1, rt * 14)); d.m.position.y = d.y;
      d.flash = Math.max(0, d.flash - rt * 3); d.m.material.emissiveIntensity = 0.5 + d.flash * 4 + FX.allFlash;
    });
    turboMeshes.forEach((tm, i) => { tm.flash = Math.max(0, tm.flash - rt * 4); tm.m.material.emissiveIntensity = (G && G.turbo[i] ? 1.0 : 0.25) + tm.flash * 3 + FX.allFlash * 0.6; tm.g.position.z = TURBO[i].ay - tm.flash * 0.05; });
    spinW *= Math.pow(0.35, rt); spinPiv.rotation.x += spinW * rt; spinPlate.material.emissiveIntensity = 0.3 + Math.min(2, Math.abs(spinW) * 0.08);
    standMeshes.forEach((s, i) => { s.flash = Math.max(0, s.flash - rt * 4); s.m.material.emissiveIntensity = (G && G.stands[i] ? 1.5 : 0.35) + s.flash * 4 + FX.allFlash; s.g.position.x = STANDS[i].ax + s.flash * 0.05; });
    FX.saucerGlow = Math.max(0, FX.saucerGlow - rt * 2);
    const sk = 0.6 + FX.saucerGlow * 3 + (G && (G.lockLit || G.multiball) ? 0.6 + 0.6 * Math.sin(camT * 10) : 0);
    sRingMat.color.setRGB(3 * sk, 0.8 * sk, 0.1 * sk);
    // flippers
    flippers.forEach((f, i) => { flipMeshes[i].g.rotation.y = -f.ang; const k = f.pressed ? 1.5 : 1; flipMeshes[i].stripe.material.color.setRGB((i ? 1.8 : 0.15) * k, (i ? 0.2 : 1.3) * k, (i ? 1.1 : 1.8) * k); });
    plungerG.position.z = 9.9 + plunger.pull * 0.55;
    gateSwing = Math.max(0, gateSwing - rt * 3); gateG.rotation.x = -Math.sin(Math.min(1, gateSwing) * 1.3) * 1.0;
    // leds
    ledMat.uniforms.uT.value = camT * (G && G.multiball ? 3 : 1);
    ledMat.uniforms.uBoost.value = FX.allFlash;
    // bolas
    for (const b of balls) {
      if (!b.mesh) continue;
      let h = BR;
      if (b.held) { b.h = lerp(b.h, 0.02, Math.min(1, rt * 8)); h = b.h; } else if (b.h < BR) { b.h = Math.min(BR, b.h + rt * 3); h = b.h; }
      b.mesh.position.set(b.x, h, b.y);
      // rodadura
      const dx = b.x - b.prevX, dy = b.y - b.prevY, dist = Math.hypot(dx, dy);
      if (dist > 1e-5 && dist < 2) { const axis = new THREE.Vector3(dy, 0, -dx).normalize(); const qq = new THREE.Quaternion().setFromAxisAngle(axis, -dist / BR); b.mesh.quaternion.premultiply(qq); }
      b.prevX = b.x; b.prevY = b.y;
      b.shadow.position.set(b.x + 0.12, 0.012, b.y + 0.08); b.shadow.visible = !b.held;
      const sp = Math.hypot(b.vx, b.vy);
      b.glow.position.set(b.x, h + 0.3, b.y); b.glow.intensity = Math.min(3, sp * 0.06);
      // estela
      if (sp > 14 && !b.held && rt > 0) {
        const n = sp > 28 ? 2 : 1;
        for (let k = 0; k < n; k++) emit(b.x - b.vx * 0.004 * k + rnd(-0.05, 0.05), h, b.y - b.vy * 0.004 * k + rnd(-0.05, 0.05), 0, 0.2, 0, 0.22, 0.42, G && G.multiball ? [2.5, 0.4, 1.6] : [0.4, 1.6, 2.6]);
      }
    }
    updateParticles(rt);
    rings.forEach(r => { if (!r.m.visible) return; r.t += rt; const k = r.t / r.d; if (k >= 1) { r.m.visible = false; return; } const s = 0.3 + k * r.s; r.m.scale.set(s, s, s); const a = (1 - k) * 2.2; r.m.material.color.setRGB(r.c[0] * a, r.c[1] * a, r.c[2] * a); });
    // luz de destello
    flashI = Math.max(0, flashI - rt * 40); flashL.intensity = flashI;
    // cámara
    shakeA = Math.max(0, shakeA - rt * 2.2);
    const aspect = W / Math.max(1, H);
    const fit = clamp(0.5 / aspect, 0.85, 1.5);   // pantallas más estrechas -> cámara más atrás
    // la mesa es larga: la cámara sigue a la bola (o enseña la mesa entera en modo fija)
    let focus = 1.2;
    if (STATE === 'title') focus = -5.2 + Math.sin(camT * 0.16) * 6.4;
    else if (balls.length) {
      let by = -99; for (const b of balls) if (!b.held || balls.length === 1) by = Math.max(by, b.y + clamp(b.vy * 0.1, -2.5, 1.5));
      if (by > -99) focus = clamp(by + 2.6, -11.6, 1.2);
    }
    followZ = lerp(followZ, focus, Math.min(1, rt * (STATE === 'title' ? 10 : 3.2)));
    const whole = !save.cam && STATE !== 'title';
    const tx = 0.12, ty = 0, tz = whole ? -5.3 : followZ;
    const px = 0.12, py = (whole ? 41 : 29.5) * fit, pz = tz + (whole ? 22 : 16.2) * fit;
    camPos.set(px + rnd(-1, 1) * shakeA * 0.4, py + rnd(-1, 1) * shakeA * 0.3, pz + rnd(-1, 1) * shakeA * 0.4);
    camera.position.copy(camPos);
    camLook.set(tx, ty, tz); camera.lookAt(camLook);
    // cámara desplazada hacia abajo para dejar sitio al marcador
    camera.setViewOffset(W, H + DMD_H * 0.9, 0, 0, W, H);
    compMat.uniforms.uT.value = camT;
  }
  function render() {
    renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
    brightMat.uniforms.tDiffuse.value = rtScene.texture; brightMat.uniforms.uTh.value = floatOK ? 1.45 : 0.85;
    pass(brightMat, mips[0][0]);
    for (let i = 0; i < mips.length; i++) {
      const [a, b, w, h] = mips[i];
      if (i > 0) { blurMat.uniforms.tDiffuse.value = mips[i - 1][0].texture; blurMat.uniforms.uDir.value.set(1 / w, 0); pass(blurMat, b); blurMat.uniforms.tDiffuse.value = b.texture; blurMat.uniforms.uDir.value.set(0, 1 / h); pass(blurMat, a); }
      blurMat.uniforms.tDiffuse.value = a.texture; blurMat.uniforms.uDir.value.set(1 / w, 0); pass(blurMat, b);
      blurMat.uniforms.tDiffuse.value = b.texture; blurMat.uniforms.uDir.value.set(0, 1 / h); pass(blurMat, a);
    }
    const u = compMat.uniforms;
    u.tScene.value = rtScene.texture; u.tB0.value = mips[0][0].texture; u.tB1.value = mips[1][0].texture; u.tB2.value = mips[2][0].texture; u.tB3.value = mips[3][0].texture;
    u.uBloom.value = 0.42 + FX.allFlash * 0.4; u.uAb.value = FX.aberr; u.uFlash.value = FX.screenFlash; u.uExp.value = 1.05;
    u.uFlashCol.value.set(FX.flashCol[0], FX.flashCol[1], FX.flashCol[2]);
    pass(compMat, null);
  }

  return {
    addBall, removeBall, update, render, resize, emit, shock,
    flash(x, y, c, k) { flashL.position.set(x, 1.4, y); flashL.color.setRGB(c[0] / 3, c[1] / 3, c[2] / 3); flashI = Math.max(flashI, k); },
    bump(i) { bumpers[i].flash = 1; }, sling(i) { slings[i < 0 ? 0 : 1].flash = 1; },
    drop(i) { dropMeshes[i].flash = 1; }, stand(i) { standMeshes[i].flash = 1; }, turbo(i) { turboMeshes[i].flash = 1; }, spin(w) { spinW = w; },
    insertFlash(n, k) { if (inserts[n]) inserts[n].flash = k; },
    gate() { gateSwing = 1; },
    shake(a) { shakeA = Math.max(shakeA, a); },
    project(x, y, h) { const v = new THREE.Vector3(x, h || 0.5, y).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z]; }
  };
})();

/* =========================================================
   EFECTOS
   ========================================================= */
const FX = {
  allFlash: 0, aberr: 0, screenFlash: 0, flashCol: [1, 1, 1], saucerGlow: 0, popups: [],
  sparks(x, y, h, n, c, sp) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(0.3, 1) * (sp || 4); Scene3D.emit(x, h || 0.3, y, Math.cos(a) * v, rnd(1, 4), Math.sin(a) * v, rnd(0.25, 0.6), rnd(0.08, 0.18), c); } },
  shock(x, y, c, s) { Scene3D.shock(x, y, c, s); },
  shake(a) { Scene3D.shake(a); },
  popup(x, y, txt, color) { this.popups.push({ x, y, txt, color, t: 0 }); if (this.popups.length > 14) this.popups.shift(); },
  bumperHit(i, b) {
    Scene3D.bump(i); const c = BUMPERS[i];
    this.sparks(b.x, b.y, 0.35, 22, [0.6, 2.4, 3], 7); this.shock(c.x, c.y, [0.4, 2, 3], 1.4); Scene3D.flash(c.x, c.y, [1, 2.5, 3], 26); this.shake(0.12); this.aberr = Math.max(this.aberr, 0.004);
  },
  slingHit(side, b) { Scene3D.sling(side); this.sparks(b.x, b.y, 0.3, 14, [3, 0.5, 2], 5); Scene3D.flash(b.x, b.y, [3, 0.6, 2], 18); this.shake(0.08); },
  dropHit(i) { Scene3D.drop(i); Scene3D.insertFlash('drop' + i, 2); const d = DROPS[i]; this.sparks(d.ax + 0.2, (d.ay + d.by) / 2, 0.3, 20, NEON.orange, 5); this.shock(d.ax + 0.3, (d.ay + d.by) / 2, NEON.orange, 1); Scene3D.flash(d.ax + 0.5, (d.ay + d.by) / 2, NEON.orange, 22); this.shake(0.12); },
  dropsUp() { DROPS.forEach((d, i) => { Scene3D.drop(i); this.sparks(d.ax + 0.2, (d.ay + d.by) / 2, 0.3, 6, NEON.orange, 2); }); },
  standHit(i) { Scene3D.stand(i); Scene3D.insertFlash('stand' + i, 2); const s = STANDS[i]; this.sparks(s.ax - 0.15, (s.ay + s.by) / 2, 0.3, 14, NEON.green, 4); Scene3D.flash(s.ax - 0.4, (s.ay + s.by) / 2, NEON.green, 16); },
  turboHit(i) { Scene3D.turbo(i); Scene3D.insertFlash('turbo' + i, 2); this.sparks(TURBO_X[i], -13.1, 0.3, 14, NEON.cyan, 4); Scene3D.flash(TURBO_X[i], -12.8, NEON.cyan, 14); },
  spin(n, vy) { Scene3D.spin((vy < 0 ? -1 : 1) * Math.min(60, n * 3)); Scene3D.insertFlash('spin', 2); for (let k = 0; k < Math.min(8, n); k++) Snd.tone(1800 + k * 60, 0.03, 'square', 0.05, 1800, k * 0.05); this.sparks(SPINNER.x, SPINNER.y, 0.5, 10, NEON.green, 3); },
  saucerHit() { this.saucerGlow = 1; this.shock(SAUCER.x, SAUCER.y, NEON.orange, 1.8); this.sparks(SAUCER.x, SAUCER.y, 0.2, 26, NEON.yellow, 5); Scene3D.flash(SAUCER.x, SAUCER.y, NEON.yellow, 30); this.shake(0.2); },
  bigFlash(x, y, c) {
    this.screenFlash = 0.5; this.flashCol = [c[0] / 3, c[1] / 3, c[2] / 3]; this.aberr = 0.02; this.allFlash = 1.4;
    for (let i = 0; i < 4; i++) setTimeout(() => this.shock(x, y, c, 2.5 + i * 1.5), i * 110);
    this.sparks(x, y, 0.4, 90, c, 10); Scene3D.flash(x, y, c, 60);
  },
  flashAll(k) { this.allFlash = Math.max(this.allFlash, k); },
  inlane(side) { Scene3D.insertFlash(side ? 'inR' : 'inL', 3); },
  orbitFx() { Scene3D.insertFlash('orbL', 3); Scene3D.insertFlash('orbR', 3); this.flashAll(0.5); this.sparks(3.45, -4.8, 0.4, 30, NEON.purple, 6); this.aberr = 0.008; },
  launchFx(p) { this.sparks(LANE_X, 9.0, 0.3, 10 + p * 20, NEON.pink, 3 + p * 4); this.shake(0.05 + p * 0.15); this.shock(LANE_X, 9.2, NEON.pink, 0.8); },
  drainFx() { this.screenFlash = 0.35; this.flashCol = [1, 0.05, 0.1]; this.aberr = 0.03; this.shake(0.4); },
  gateSwing() { Scene3D.gate(); },
  update(dt) {
    this.allFlash = Math.max(0, this.allFlash - dt * 1.6);
    this.aberr = Math.max(0, this.aberr - dt * 0.05);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.4);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < 1.1);
  }
};

/* =========================================================
   MARCADOR DMD (matriz de puntos naranja) Y MENÚS
   ========================================================= */
const DW = 128, DH = 32;
const dmd = document.createElement('canvas'); dmd.width = DW; dmd.height = DH;
const dx = dmd.getContext('2d', { willReadFrequently: true });
let dmdMask = null;
function buildMask(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-out';
  const cw = w / DW, ch = h / DH, r = Math.min(cw, ch) * 0.42;
  for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) { x.beginPath(); x.arc((i + 0.5) * cw, (j + 0.5) * ch, r, 0, 7); x.fill(); }
  return c;
}
function dmdText(txt, y, size, align) {
  dx.font = `bold ${size}px "Courier New", monospace`; dx.textBaseline = 'middle'; dx.textAlign = align || 'center';
  let s = size; while (dx.measureText(txt).width > DW - 4 && s > 7) { s--; dx.font = `bold ${s}px "Courier New", monospace`; }
  dx.fillText(txt, align === 'left' ? 2 : (align === 'right' ? DW - 2 : DW / 2), y);
}
function drawDMD(dt) {
  dx.fillStyle = '#000'; dx.fillRect(0, 0, DW, DH);
  dx.fillStyle = '#fff';
  const T = performance.now() / 1000;
  if (dmdMsg) {
    dmdMsg.t += dt;
    const m = dmdMsg, k = m.t / m.dur;
    if (m.fx === 'multiball' || m.fx === 'jackpot') {
      // fondo animado
      dx.strokeStyle = '#888'; for (let i = 0; i < 6; i++) { const s = ((T * 40 + i * 22) % 130); dx.strokeRect(DW / 2 - s, DH / 2 - s / 4, s * 2, s / 2); }
      if (m.fx === 'jackpot' && Math.floor(T * 8) % 2) { dx.fillStyle = '#fff'; dx.fillRect(0, 0, DW, DH); dx.fillStyle = '#000'; }
    }
    let sc = 1;
    if (m.fx === 'zoom') sc = Math.min(1, 0.3 + m.t * 4);
    const vis = m.fx === 'blink' ? Math.floor(m.t * 8) % 2 === 0 || m.t > 0.8 : true;
    if (vis) {
      dx.save(); dx.translate(DW / 2, DH / 2); dx.scale(sc, sc); dx.translate(-DW / 2, -DH / 2);
      if (m.lines[1]) { dmdText(m.lines[0], 10, 15); dmdText(m.lines[1], 25, 11); } else dmdText(m.lines[0], 16, 17);
      dx.restore();
    }
    if (m.t > m.dur) dmdMsg = msgQ.shift() || null;
  } else if (STATE === 'title') {
    const ph = Math.floor(T / 3) % 3;
    if (ph === 0) { dmdText('PIRU PINBALL', 11, 16); dmdText('- 3 D -', 26, 10); }
    else if (ph === 1) { dmdText('RECORD', 9, 11); dmdText(fmt(save.high[0] || 0), 23, 15); }
    else { if (Math.floor(T * 2) % 2) dmdText('PULSA JUGAR', 16, 13); }
  } else if (G) {
    dmdText(fmt(G.score), 13, 19);
    dx.font = 'bold 8px "Courier New", monospace'; dx.textBaseline = 'middle';
    dx.textAlign = 'left'; dx.fillText('BOLA ' + G.ball, 2, 28);
    dx.textAlign = 'center'; dx.fillText(G.multiball ? 'MULTIBOLA' : (G.lockLit ? 'LOCK!' : (G.locks ? 'LOCK ' + G.locks + '/2' : '')), DW / 2, 28);
    dx.textAlign = 'right'; dx.fillText('X' + G.mult, DW - 2, 28);
  }
  // binarizar a 3 niveles para el aspecto de matriz
  const id = dx.getImageData(0, 0, DW, DH), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i];
    const v = l > 170 ? 1 : (l > 90 ? 0.55 : (l > 40 ? 0.25 : 0.06));
    d[i] = 255 * v; d[i + 1] = 120 * v; d[i + 2] = 20 * v; d[i + 3] = 255;
  }
  dx.putImageData(id, 0, 0);
}

let buttons = [];
function btn(id, x, y, w, h, label, style) { buttons.push({ id, x, y, w, h, label, style }); }
function drawButton(b, t) {
  const g = hx;
  g.save();
  const pulse = b.style === 'main' ? 0.5 + 0.5 * Math.sin(t * 4) : 0;
  g.shadowColor = b.style === 'main' ? '#ff2fa8' : '#00e5ff'; g.shadowBlur = (14 + pulse * 14) * DPR;
  g.fillStyle = 'rgba(10,4,30,0.78)'; g.strokeStyle = b.style === 'main' ? '#ff5fc0' : '#3ef0ff'; g.lineWidth = 3 * DPR;
  roundRect(g, b.x, b.y, b.w, b.h, 14 * DPR); g.fill(); g.stroke();
  g.shadowBlur = 0; g.fillStyle = '#fff'; g.font = `bold ${Math.round(b.h * 0.38)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  g.restore();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

let menuPanel = null; // null | 'settings' | 'records'
function drawHUD(dt) {
  const g = hx, w = hud.width, h = hud.height, t = performance.now() / 1000;
  g.clearRect(0, 0, w, h);
  buttons = [];
  // DMD
  drawDMD(dt);
  const pad = 8 * DPR, dw = w - pad * 2, dh = DMD_H * DPR - pad * 1.2, dyy = DMD_Y * DPR + pad * 0.6;
  g.fillStyle = '#050208'; g.strokeStyle = '#3a2a55'; g.lineWidth = 2 * DPR; roundRect(g, pad - 3 * DPR, dyy - 3 * DPR, dw + 6 * DPR, dh + 6 * DPR, 8 * DPR); g.fill(); g.stroke();
  const ratio = DW / DH; let iw = dw, ih = dw / ratio; if (ih > dh) { ih = dh; iw = dh * ratio; }
  const ix = (w - iw) / 2, iy = dyy + (dh - ih) / 2;
  if (!dmdMask || dmdMask.width !== Math.round(iw)) dmdMask = buildMask(Math.round(iw), Math.round(ih));
  g.imageSmoothingEnabled = true; g.globalAlpha = 0.55; g.globalCompositeOperation = 'lighter';
  g.drawImage(dmd, ix - 4 * DPR, iy - 4 * DPR, iw + 8 * DPR, ih + 8 * DPR);   // brillo difuso
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false; g.drawImage(dmd, ix, iy, iw, ih); g.drawImage(dmdMask, ix, iy, iw, ih);
  g.imageSmoothingEnabled = true;

  // marcadores flotantes de puntos
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const p of FX.popups) {
    const [sx, sy, z] = Scene3D.project(p.x, p.y, 0.8); if (z > 1) continue;
    const k = p.t / 1.1; g.globalAlpha = 1 - k * k;
    g.font = `bold ${Math.round((15 + (1 - k) * 6) * DPR)}px Arial, sans-serif`;
    g.lineWidth = 4 * DPR; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(p.txt, sx * DPR, (sy - k * 50) * DPR);
    g.fillStyle = p.color; g.fillText(p.txt, sx * DPR, (sy - k * 50) * DPR);
  }
  g.globalAlpha = 1;

  if (STATE === 'play') {
    // botón pausa
    const r = 20 * DPR, bx = w - r - 10 * DPR, by = (DMD_Y + DMD_H) * DPR + r + 8 * DPR;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(bx, by, r, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillRect(bx - 7 * DPR, by - 8 * DPR, 5 * DPR, 16 * DPR); g.fillRect(bx + 2 * DPR, by - 8 * DPR, 5 * DPR, 16 * DPR);
    buttons.push({ id: 'pause', x: bx - r * 1.3, y: by - r * 1.3, w: r * 2.6, h: r * 2.6, hidden: true });
    // ayuda de controles
    if (hintT > 0) {
      g.globalAlpha = Math.min(1, hintT); g.font = `bold ${Math.round(15 * DPR)}px Arial, sans-serif`;
      g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 6 * DPR; g.fillText('◀ FLIPPER IZQ.', w * 0.25, h * 0.93); g.fillText('FLIPPER DER. ▶', w * 0.75, h * 0.93);
      if (ballInPlunger()) g.fillText('Mantén aquí y suelta para lanzar', w * 0.62, h * 0.62);
      g.globalAlpha = 1; g.shadowBlur = 0;
    }
    if (ballInPlunger() && plunger.pull > 0) {
      const bw = 14 * DPR, bh = h * 0.22, bx2 = w - bw - 12 * DPR, by2 = h * 0.7;
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(bx2, by2, bw, bh);
      const gr = g.createLinearGradient(0, by2 + bh, 0, by2); gr.addColorStop(0, '#3ef0ff'); gr.addColorStop(1, '#ff2fa8');
      g.fillStyle = gr; g.fillRect(bx2, by2 + bh * (1 - plunger.pull), bw, bh * plunger.pull);
    }
  }
  const cxw = w / 2, bw = Math.min(w * 0.72, 330 * DPR), bh = 58 * DPR;
  if (STATE === 'title' && !menuPanel) {
    g.save(); g.textAlign = 'center';
    const ty = (DMD_Y + DMD_H) * DPR + h * 0.1;
    g.font = `900 ${Math.round(46 * DPR)}px Arial Black, Impact, sans-serif`; g.shadowColor = '#00e5ff'; g.shadowBlur = 25 * DPR;
    g.fillStyle = '#fff'; g.fillText('PIRU', cxw, ty);
    g.font = `900 ${Math.round(26 * DPR)}px Arial Black, Impact, sans-serif`; g.shadowColor = '#ff2fa8';
    g.fillStyle = '#ffd6f0'; g.fillText('PINBALL 3D', cxw, ty + 40 * DPR); g.restore();
    const by = h * 0.6;
    btn('play', cxw - bw / 2, by, bw, bh * 1.15, 'JUGAR', 'main');
    btn('records', cxw - bw / 2, by + bh * 1.45, bw, bh, 'RÉCORDS');
    btn('settings', cxw - bw / 2, by + bh * 2.6, bw, bh, 'AJUSTES');
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = `${Math.round(12 * DPR)}px Arial`; g.textAlign = 'left'; g.fillText('v' + gameVersion(), 10 * DPR, h - 12 * DPR);
  }
  if (STATE === 'pause' && !menuPanel) {
    g.fillStyle = 'rgba(5,2,15,0.6)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `900 ${Math.round(34 * DPR)}px Arial Black, Impact, sans-serif`; g.textAlign = 'center'; g.fillText('PAUSA', cxw, h * 0.36);
    btn('resume', cxw - bw / 2, h * 0.45, bw, bh, 'CONTINUAR', 'main');
    btn('settings', cxw - bw / 2, h * 0.45 + bh * 1.3, bw, bh, 'AJUSTES');
    btn('quit', cxw - bw / 2, h * 0.45 + bh * 2.6, bw, bh, 'SALIR AL MENÚ');
  }
  if (STATE === 'over' && G && G.overT > 2.5) {
    btn('again', cxw - bw / 2, h * 0.62, bw, bh, 'OTRA PARTIDA', 'main');
    btn('quit', cxw - bw / 2, h * 0.62 + bh * 1.3, bw, bh, 'MENÚ');
  }
  if (menuPanel) {
    g.fillStyle = 'rgba(5,2,15,0.8)'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `900 ${Math.round(28 * DPR)}px Arial Black, Impact, sans-serif`;
    if (menuPanel === 'settings') {
      g.fillText('AJUSTES', cxw, h * 0.28);
      const opts = [['music', 'Música', save.music ? 'SÍ' : 'NO'], ['sfx', 'Sonido', save.sfx ? 'SÍ' : 'NO'], ['vib', 'Vibración', save.vib ? 'SÍ' : 'NO'],
        ['q', 'Gráficos', save.q ? 'ALTOS' : 'RÁPIDOS'], ['cam', 'Cámara', save.cam ? 'SIGUE LA BOLA' : 'MESA ENTERA']];
      opts.forEach((o, i) => btn('opt_' + o[0], cxw - bw / 2, h * 0.34 + i * bh * 1.18, bw, bh, o[1] + ': ' + o[2]));
      btn('back', cxw - bw / 2, h * 0.34 + 5 * bh * 1.18 + bh * 0.3, bw, bh, 'VOLVER', 'main');
    } else {
      g.fillText('RÉCORDS', cxw, h * 0.3);
      g.font = `bold ${Math.round(22 * DPR)}px "Courier New", monospace`;
      for (let i = 0; i < 5; i++) { g.fillStyle = i ? '#ffd6f0' : '#ffe066'; g.fillText((i + 1) + '.  ' + (save.high[i] ? fmt(save.high[i]) : '---'), cxw, h * 0.38 + i * 40 * DPR); }
      btn('back', cxw - bw / 2, h * 0.72, bw, bh, 'VOLVER', 'main');
    }
  }
  for (const b of buttons) if (!b.hidden) drawButton(b, t);
}
function onButton(id) {
  Snd.init(); Snd.bonus();
  if (id === 'play' || id === 'again') { menuPanel = null; newGame(); }
  else if (id === 'records') menuPanel = 'records';
  else if (id === 'settings') menuPanel = 'settings';
  else if (id === 'back') { menuPanel = null; }
  else if (id === 'pause') { pauseGame(); }
  else if (id === 'resume') { STATE = 'play'; }
  else if (id === 'quit') { toTitle(); }
  else if (id.startsWith('opt_')) {
    const k = id.slice(4);
    if (k === 'q' || k === 'cam') save[k] = save[k] ? 0 : 1; else save[k] = !save[k];
    persist(); Snd.apply(); if (k === 'q') resize();
  }
}
function pauseGame() { if (STATE === 'play') { STATE = 'pause'; flippers.forEach(f => f.pressed = false); plunger.charging = false; } }
function toTitle() {
  STATE = 'title'; menuPanel = null; balls.forEach(b => Scene3D.removeBall(b)); balls = []; dmdMsg = null; msgQ.length = 0;
  if (pendingReload && window.Android && Android.reload) Android.reload();
}

/* =========================================================
   CONTROLES
   ========================================================= */
const touches = new Map();
function flip(side, on) {
  const f = flippers[side < 0 ? 0 : 1];
  if (f.pressed === on) return;
  for (const g of flippers) if (g.side === side) g.pressed = on;
  if (on) { Snd.flipper(); vibrate(8); rotateLanes(side); if (hintT > 1.2 && STATE === 'play') hintT = 1.2; }
  else Snd.flipDown();
}
function anyTouch(kind) { for (const v of touches.values()) if (v === kind) return true; return false; }
hud.addEventListener('pointerdown', e => {
  e.preventDefault(); Snd.init();
  const x = e.clientX * DPR, y = e.clientY * DPR;
  for (const b of buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { onButton(b.id); return; }
  if (STATE !== 'play') return;
  if (ballInPlunger() && e.clientX > W * 0.5 && e.clientY > H * 0.5 && !plunger.auto) { touches.set(e.pointerId, 'P'); plunger.charging = true; return; }
  const side = e.clientX < W / 2 ? -1 : 1; touches.set(e.pointerId, side < 0 ? 'L' : 'R'); flip(side, true);
}, { passive: false });
function endTouch(e) {
  const k = touches.get(e.pointerId); if (!k) return; touches.delete(e.pointerId);
  if (k === 'P') { if (!anyTouch('P')) releasePlunger(); }
  else if (k === 'L' && !anyTouch('L')) flip(-1, false);
  else if (k === 'R' && !anyTouch('R')) flip(1, false);
}
hud.addEventListener('pointerup', endTouch); hud.addEventListener('pointercancel', endTouch);
hud.addEventListener('contextmenu', e => e.preventDefault());
const keys = {};
window.addEventListener('keydown', e => {
  if (keys[e.code]) return; keys[e.code] = true; Snd.init();
  if (STATE !== 'play') { if ((e.code === 'Enter' || e.code === 'Space') && STATE === 'title' && !menuPanel) onButton('play'); if (e.code === 'Escape' && STATE === 'pause') STATE = 'play'; return; }
  if (['ArrowLeft', 'KeyZ', 'ShiftLeft', 'KeyA'].includes(e.code)) flip(-1, true);
  if (['ArrowRight', 'KeyM', 'ShiftRight', 'KeyL'].includes(e.code)) flip(1, true);
  if (['Space', 'Enter', 'ArrowDown'].includes(e.code) && ballInPlunger()) plunger.charging = true;
  if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (['ArrowLeft', 'KeyZ', 'ShiftLeft', 'KeyA'].includes(e.code)) flip(-1, false);
  if (['ArrowRight', 'KeyM', 'ShiftRight', 'KeyL'].includes(e.code)) flip(1, false);
  if (['Space', 'Enter', 'ArrowDown'].includes(e.code)) releasePlunger();
});
window.onBack = () => { if (menuPanel) menuPanel = null; else if (STATE === 'play') pauseGame(); else if (STATE === 'pause') STATE = 'play'; else if (STATE === 'over') toTitle(); else if (window.Android && Android.exit) Android.exit(); };
window.onAppPause = () => { pauseGame(); if (Snd.c) Snd.c.suspend(); };
window.onAppResume = () => { if (Snd.c) Snd.c.resume(); };
window.onUpdateReady = v => { pendingReload = true; if (STATE === 'title' && window.Android && Android.reload) Android.reload(); };

/* =========================================================
   BUCLE PRINCIPAL
   ========================================================= */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  hud.width = Math.round(W * DPR); hud.height = Math.round(H * DPR);
  DMD_Y = 6; DMD_H = Math.round(Math.min(W * 0.3, H * 0.14));
  dmdMask = null;
  Scene3D.resize(W, H, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
const STEP = 1 / 720;
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let rt = Math.min(0.05, (now - last) / 1000); last = now;
  const nowS = now / 1000;
  const targetScale = nowS < slowUntil ? 0.3 : 1;
  timeScale = lerp(timeScale, targetScale, Math.min(1, rt * 10));
  const dt = rt * timeScale;
  if (STATE === 'play' && G) {
    clock += dt; acc += dt;
    let n = 0;
    while (acc >= STEP && n < 60) { physStep(STEP); acc -= STEP; n++; }
    if (n >= 60) acc = 0;
    gameLogic(dt);
    hintT = Math.max(0, hintT - rt * 0.25);
    if (Snd.c) Snd.music(G.multiball);
  } else {
    if (STATE === 'over' && G) G.overT += rt;
    if (Snd.c && STATE === 'title') Snd.music(false);
    if (Snd.c && STATE !== 'title' && STATE !== 'play') Snd.musNext = Math.max(Snd.musNext, Snd.c.currentTime);
    // en el menú los flippers bajan
    if (STATE !== 'pause') { flippers.forEach(f => { if (STATE !== 'play') f.pressed = false; }); updateFlippers(rt); }
  }
  FX.update(rt);
  Scene3D.update(dt, rt);
  Scene3D.render();
  drawHUD(rt);
}
requestAnimationFrame(frame);

// Para pruebas automáticas
window.__pin = {
  dbg() { return JSON.stringify({ plunger, balls: balls.map(b => ({ x: b.x, y: b.y, P: b.inPlunger, h: b.held, g: b.lockGhost, d: b.dead })), G: { ball: G.ball, endBall: G.endBall, mb: G.multiball, locks: G.locks } }); },
  sim(sec, bot) {
    const st = { drains: 0, nan: 0, out: 0, steps: 0, minY: 99, events: {} };
    const t0 = G.ball;
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) {
      if (bot) {
        const pb = ballInPlunger(); if (pb && !plunger.auto && !plunger.charging) { launch(pb, Math.random()); }
        for (const f of flippers) { if (f.pressed) { f.bt = (f.bt || 0) + STEP; if (f.bt > 0.18) { f.pressed = false; f.bt = -0.25; } } else f.bt = Math.min(0, (f.bt || 0) + STEP); }
        for (const b of balls) if (!b.held && b.y > 7.4 && b.y < 9.2 && b.vy > -2) { const f = b.x < CX ? flippers[0] : (b.x < 4.0 ? flippers[1] : null); if (f && !f.pressed && (f.bt || 0) >= 0) { f.pressed = true; f.bt = 0; } }
      }
      physStep(STEP); clock += STEP; st.steps++;
      if (i % 12 === 0) gameLogic(STEP * 12);
      for (const b of balls) { if (!isFinite(b.x) || !isFinite(b.y)) st.nan++; if (b.x < -4.6 || (b.x > 4.0 && b.x < 4.2 && b.y > -15) || b.x > 4.8) st.out++; st.minY = Math.min(st.minY, b.y); }
      if (STATE !== 'play') break;
    }
    st.pos = balls.map(b => [b.x.toFixed(2), b.y.toFixed(2), b.vx.toFixed(1), b.vy.toFixed(1), b.inPlunger ? 'P' : '', b.held ? 'H' : '']); st.score = G.score; st.ball = G.ball; st.mult = G.mult; st.locks = G.locks; st.multiball = G.multiball; st.state = STATE; st.drops = G.drops.join(''); st.bumps = G.bumperHits;
    return st;
  }, get G() { return G; }, get balls() { return balls; }, newGame, flip, launch: p => { const b = ballInPlunger(); if (b) launch(b, p); }, get state() { return STATE; }, flippers, onButton };
