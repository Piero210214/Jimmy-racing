/* JIMMY RACING - server/rooms.js
 * Authoritative multiplayer: lobby, rooms, race lifecycle. The physics of every car runs HERE
 * (same JR.sim / JR.vehicle code as the single-player game); clients only send their controls.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
require(path.join('..', 'src', 'core', 'util.js'));
require(path.join('..', 'src', 'core', 'track.js'));
require(path.join('..', 'src', 'core', 'vehicle.js'));
require(path.join('..', 'src', 'core', 'ai.js'));
require(path.join('..', 'src', 'core', 'sim.js'));
require(path.join('..', 'src', 'core', 'netproto.js'));
require(path.join('..', 'src', 'core', 'levels.js'));
const JR = globalThis.JR, NET = JR.net, CARS = JR.vehicle.CARS, STEP = JR.sim.STEP;

const LIMITS = { rooms: 200, nameLen: 16, graceLobby: 20, graceRace: 30, loadWait: 14, finishWait: 45, resultsHold: 3 };
const PAINTS = [0xc8102e, 0x1b6dff, 0xf5a300, 0x22a85a, 0x7b3ff2, 0xf2f2f2, 0x111214, 0xff5a1f];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const track = JR.track.build();            // default circuit (level 1), shared, read-only
const trackCache = new Map([[1, track]]);
function getTrack(id) {                    // one read-only track per circuit (= campaign level 1..10), built lazily
  id = NET.CIRCUITS.includes(id) ? id : 1;
  if (!trackCache.has(id)) trackCache.set(id, JR.track.build({ circuit: JR.levels.byId(id).circuitDef }));
  return trackCache.get(id);
}

function cleanName(n) {
  n = String(n == null ? '' : n).normalize('NFKC').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.nameLen);
  return n || 'Piloto' + Math.floor(100 + Math.random() * 900);
}
const isInt = (v) => Number.isInteger(v);
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;

class Hub {
  constructor() {
    this.players = new Map();          // token -> player
    this.rooms = new Map();            // code -> room
    this.nextPid = 1;
    this.last = process.hrtime.bigint();
    this.timer = null; this.timeScale = Math.max(1, Math.min(10, parseFloat(process.env.JR_TIMESCALE || '1') || 1));   // >1 only for automated tests
  }
  start() { if (!this.timer) { this.last = process.hrtime.bigint(); this.timer = setInterval(() => this.tick(), 4); } }
  stop() { clearInterval(this.timer); this.timer = null; }

  /* ---------------- connections ---------------- */
  hello(conn, msg) {
    let p = typeof msg.token === 'string' ? this.players.get(msg.token) : null, resumed = false;
    if (p) {
      resumed = true;
      if (p.conn && p.conn !== conn) { p.conn.detached = true; p.conn.close(4000, 'replaced'); }
      p.conn = conn; p.disc = null;
    } else {
      p = { pid: this.nextPid++, token: crypto.randomBytes(16).toString('hex'), name: cleanName(msg.name), car: 'vortex', paint: PAINTS[0], assists: 'full', ready: false, conn, room: null, disc: null, loaded: false, lastRespawn: 0, input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, inSeq: 0, rtt: 0, simCar: null };
      this.players.set(p.token, p);
    }
    conn.player = p;
    this.send(p, { t: 'welcome', pid: p.pid, token: p.token, resumed, name: p.name, snapHz: NET.SNAP_HZ });
    if (p.room) { this.sendRoom(p.room); if (p.room.state === 'grid' || p.room.state === 'racing') this.sendGrid(p.room, p, true); }
    return p;
  }
  disconnected(conn) {
    const p = conn.player; if (!p || p.conn !== conn || conn.detached) return;
    p.conn = null; p.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const room = p.room;
    if (!room) { p.disc = Date.now() + 5000; return; }
    p.disc = Date.now() + (room.state === 'racing' || room.state === 'grid' ? LIMITS.graceRace : LIMITS.graceLobby) * 1000;
    p.ready = false; this.sendRoom(room);
  }
  send(p, obj) { if (p.conn) try { p.conn.send(JSON.stringify(obj)); } catch (e) { } }
  bcast(room, obj, except) { const s = JSON.stringify(obj); for (const p of room.players.values()) if (p.conn && p !== except) try { p.conn.send(s); } catch (e) { } }
  err(p, code, text) { this.send(p, { t: 'error', code, text }); }

  /* ---------------- message dispatch (every field validated) ---------------- */
  onMessage(conn, str) {
    let m; try { m = JSON.parse(str); } catch (e) { return conn.close(1003, 'bad json'); }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t === 'hello') { if (!conn.player) this.hello(conn, m); return; }
    const p = conn.player; if (!p) return;
    switch (m.t) {
      case 'ping': this.send(p, { t: 'pong', c: isInt(m.c) ? m.c : 0 }); if (typeof m.rtt === 'number') p.rtt = Math.max(0, Math.min(2000, m.rtt)); break;
      case 'list': this.send(p, { t: 'rooms', rooms: this.publicRooms() }); break;
      case 'create': this.create(p, m); break;
      case 'join': this.join(p, m); break;
      case 'leave': this.leave(p); break;
      case 'prefs': this.prefs(p, m); break;
      case 'cfg': this.cfg(p, m); break;
      case 'ready': this.setReady(p, m.v === true); break;
      case 'start': this.hostStart(p); break;
      case 'kick': this.kick(p, m); break;
      case 'close': this.closeRoom(p); break;
      case 'loaded': p.loaded = true; break;
      case 'in': this.input(p, m); break;
      case 'respawn': this.respawnReq(p); break;
      case 'again': if (p.room && p.room.state === 'results') this.toLobby(p.room, p); break;
    }
  }

  publicRooms() {
    const out = [];
    for (const r of this.rooms.values()) if (!r.priv && r.state === 'lobby' && r.players.size < r.max) out.push({ code: r.code, host: r.players.get(r.host).name, n: r.players.size, max: r.max, laps: r.laps, circuit: r.circuit });
    return out.slice(0, 30);
  }
  roomState(r) {
    return { t: 'room', code: r.code, host: r.host, state: r.state, laps: r.laps, time: r.time, weather: r.weather, priv: r.priv, bots: r.bots, max: r.max, circuit: r.circuit,
      players: [...r.players.values()].map((p) => ({ pid: p.pid, name: p.name, car: p.car, paint: p.paint, ready: p.ready, connected: !!p.conn, rtt: Math.round(p.rtt) })) };
  }
  sendRoom(r) { this.bcast(r, this.roomState(r)); }

  applyPrefs(p, m) {
    if (typeof m.name === 'string') p.name = cleanName(m.name);
    if (typeof m.car === 'string' && CARS[m.car]) p.car = m.car;
    if (isInt(m.paint) && PAINTS.includes(m.paint)) p.paint = m.paint;
    if (typeof m.assists === 'string' && NET.ASSISTS[m.assists]) p.assists = m.assists;
  }
  uniqueName(room, p) {
    let base = p.name, n = 2; const taken = () => [...room.players.values()].some((q) => q !== p && q.name.toLowerCase() === p.name.toLowerCase());
    while (taken()) { p.name = (base.slice(0, LIMITS.nameLen - 2) + ' ' + n++).slice(0, LIMITS.nameLen); }
  }
  newCode() { for (let k = 0; k < 50; k++) { let c = ''; const b = crypto.randomBytes(5); for (let i = 0; i < 5; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length]; if (!this.rooms.has(c)) return c; } return null; }

  create(p, m) {
    if (p.room) return this.err(p, 'in_room', 'Ya estás en una sala');
    if (this.rooms.size >= LIMITS.rooms) return this.err(p, 'full', 'Servidor lleno, inténtalo más tarde');
    this.applyPrefs(p, m);
    const code = this.newCode(); if (!code) return this.err(p, 'full', 'No se pudo crear la sala');
    const r = { code, host: p.pid, players: new Map(), state: 'lobby', laps: NET.LAPS.includes(m.laps) ? m.laps : 3, time: NET.TIMES.includes(m.time) ? m.time : 'noon', weather: NET.WEATHERS.includes(m.weather) ? m.weather : 'clear', priv: m.priv !== false, bots: 0, max: NET.MAX_ROOM.includes(m.max) ? m.max : NET.MAX_PLAYERS, circuit: NET.CIRCUITS.includes(m.circuit) ? m.circuit : 1, sim: null, pidByCar: new Map(), results: null, created: Date.now() };
    r.players.set(p.pid, p); p.room = r; p.ready = false; this.rooms.set(code, r);
    this.sendRoom(r);
  }
  join(p, m) {
    if (p.room) return this.err(p, 'in_room', 'Ya estás en una sala');
    const code = typeof m.code === 'string' ? m.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
    const r = this.rooms.get(code);
    if (!r) return this.err(p, 'no_room', 'No existe ninguna sala con ese código');
    if (r.state !== 'lobby') return this.err(p, 'started', 'La carrera de esa sala ya ha empezado');
    if (r.players.size >= r.max) return this.err(p, 'room_full', 'La sala está llena (' + r.max + ')');
    this.applyPrefs(p, m); this.uniqueName(r, p);
    r.players.set(p.pid, p); p.room = r; p.ready = false; p.loaded = false;
    this.sendRoom(r);
  }
  leave(p) {
    const r = p.room; if (!r) return;
    this.removePlayer(r, p, 'left');
  }
  removePlayer(r, p, why) {
    if (r.sim && p.simCar) {                                  // mid-race: take the car off the track
      const idx = r.sim.cars.indexOf(p.simCar);
      if (!p.simCar.race.finished && r.results && r.state !== 'results') r.results.dnf.push(p.name);
      if (idx >= 0) r.sim.cars.splice(idx, 1);
      r.sim.rank(); r.pidByCar.delete(p.simCar); p.simCar = null;
      r.leftEv = (r.leftEv || []); r.leftEv.push({ e: 'left', pid: p.pid });
    }
    r.players.delete(p.pid); p.room = null; p.ready = false; p.simCar = null;
    this.send(p, { t: 'left', why });
    if (!r.players.size) { this.rooms.delete(r.code); return; }
    if (r.host === p.pid) r.host = [...r.players.values()].find((q) => q.conn) ? [...r.players.values()].find((q) => q.conn).pid : r.players.values().next().value.pid;
    this.sendRoom(r);
    this.checkProgress(r);
  }
  prefs(p, m) {
    const r = p.room; if (r && r.state !== 'lobby') return;
    this.applyPrefs(p, m); if (r) { this.uniqueName(r, p); p.ready = false; this.sendRoom(r); }
  }
  cfg(p, m) {
    const r = p.room; if (!r || r.state !== 'lobby' || r.host !== p.pid) return;
    if (NET.LAPS.includes(m.laps)) r.laps = m.laps; if (NET.TIMES.includes(m.time)) r.time = m.time; if (NET.WEATHERS.includes(m.weather)) r.weather = m.weather;
    if (typeof m.priv === 'boolean') r.priv = m.priv;
    if (NET.BOTS.includes(m.bots)) r.bots = m.bots;
    if (NET.CIRCUITS.includes(m.circuit)) r.circuit = m.circuit;
    if (NET.MAX_ROOM.includes(m.max) && m.max >= r.players.size) r.max = m.max;
    r.bots = Math.min(r.bots, Math.max(0, r.max - r.players.size));
    for (const q of r.players.values()) q.ready = false;
    this.sendRoom(r);
  }
  /* host: start the race. Every OTHER connected player must be ready; needs >= 2 humans */
  hostStart(p) {
    const r = p.room; if (!r || r.state !== 'lobby') return;
    if (r.host !== p.pid) return this.err(p, 'not_host', 'Solo el anfitrión puede iniciar la carrera');
    const conn = [...r.players.values()].filter((q) => q.conn);
    if (conn.length < 2) return this.err(p, 'few', 'Hacen falta al menos 2 jugadores conectados');
    const waiting = conn.filter((q) => q !== p && !q.ready);
    if (waiting.length || conn.length < r.players.size) return this.err(p, 'not_ready', waiting.length ? 'Faltan por estar listos: ' + waiting.map((q) => q.name).join(', ') : 'Hay jugadores desconectados; espera a que vuelvan o expúlsalos');
    this.startGrid(r);
  }
  kick(p, m) {
    const r = p.room; if (!r || r.state !== 'lobby' || r.host !== p.pid) return;
    const q = r.players.get(m.pid); if (!q || q === p) return;
    this.send(q, { t: 'kicked' }); this.removePlayer(r, q, 'kicked');
  }
  closeRoom(p) {
    const r = p.room; if (!r || r.host !== p.pid) return;
    for (const q of [...r.players.values()]) { this.send(q, { t: 'closed' }); q.room = null; q.ready = false; q.simCar = null; }
    r.players.clear(); this.rooms.delete(r.code); r.state = 'closed';
  }
  setReady(p, v) {
    const r = p.room; if (!r || r.state !== 'lobby') return;
    p.ready = v; this.sendRoom(r);
  }
  /* the race is started explicitly by the host (start()); here only the race-finish bookkeeping */
  checkProgress(r) { if (r.state === 'racing') this.checkFinish(r); }

  /* ---------------- race lifecycle ---------------- */
  startGrid(r) {
    const ps = [...r.players.values()].filter((q) => q.conn);
    for (const q of [...r.players.values()]) if (!q.conn) { r.players.delete(q.pid); q.room = null; }
    const grip = NET.GRIP[r.weather] || 1;
    const sim = r.sim = new JR.sim.Sim({ track: getTrack(r.circuit), laps: r.laps, mode: 'race', seed: (Math.random() * 1e6) | 0, grip });
    const order = ps.slice(); for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    r.pidByCar = new Map(); r.results = { dnf: [] };
    const cars = new Map();
    for (const q of ps) {
      const c = sim.addCar(CARS[q.car], { name: q.name, human: true, color: q.paint, assists: NET.ASSISTS[q.assists] });
      q.simCar = c; q.loaded = false; q.ready = false; q.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; r.pidByCar.set(c, q.pid); cars.set(q.pid, c);
    }
    // AI bots driven by the server (never counted as humans for readiness / finish)
    const nb = Math.max(0, Math.min(r.bots | 0, r.max - ps.length)), BN = ['Marco Vega', 'Lena Frost', 'Rex Doran', 'Kai Ito', 'Nora Blaze'], BC = ['vortex', 'falcon', 'titan'], BP = ['#f2c200', '#18a058', '#9b59b6', '#ff7a1a', '#e8e8e8'];
    const keys = Object.keys(CARS), bots = [];
    for (let i = 0; i < nb; i++) {
      const spec = CARS[keys[(i + 1) % keys.length]];
      const c = sim.addCar(spec, { name: BN[i % BN.length] + ' (bot)', color: BP[i % BP.length], skill: 0.55 + Math.random() * 0.3, seed: 300 + i * 13, mistakeRate: 0.5 });
      const b = { pid: NET.BOT_PID + i, name: c.name, car: keys[(i + 1) % keys.length], paint: BP[i % BP.length], simCar: c, bot: true };
      r.pidByCar.set(c, b.pid); bots.push(b); order.push(b);
    }
    for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    sim.setupGrid(order.map((q) => q.simCar));
    sim.rank();
    r.state = 'grid'; r.gridT = 0; r.acc = 0; r.snapN = 0; r.evBuf = []; r.finishT = null; r.tick = 0;
    r.gridInfo = { circuit: r.circuit, laps: r.laps, time: r.time, weather: r.weather, grid: order.map((q, i) => ({ bot: !!q.bot, pid: q.pid, name: q.name, car: q.car, paint: q.paint, slot: i + 1 })) };
    this.sendRoom(r);
    for (const q of ps) this.sendGrid(r, q, false);
  }
  sendGrid(r, p, resume) { this.send(p, Object.assign({ t: 'grid', resume: !!resume, code: r.code }, r.gridInfo)); }

  input(p, m) {
    const r = p.room; if (!r || !p.simCar || (r.state !== 'racing' && r.state !== 'grid')) return;
    if (!isInt(m.s) || m.s <= p.inSeq) return;                 // drop stale / replayed packets
    p.inSeq = m.s;
    p.input = { throttle: num(m.th, 0, 1, 0), brake: num(m.br, 0, 1, 0), steer: num(m.st, -1, 1, 0), handbrake: num(m.hb, 0, 1, 0) };
  }
  respawnReq(p) {
    const r = p.room; if (!r || r.state !== 'racing' || !p.simCar || p.simCar.race.finished) return;
    const now = Date.now(); if (now - p.lastRespawn < 3000) return; p.lastRespawn = now;
    r.sim.respawn(p.simCar, 'manual'); p.simCar.race.penalty += 3;
  }
  checkFinish(r) {
    const active = [...r.players.values()].filter((q) => q.simCar);
    if (!active.length) { this.endRace(r); return; }
    const done = active.filter((q) => q.simCar.race.finished);
    if (done.length === active.length) { this.endRace(r); return; }
    if (done.length && r.finishT == null) { r.finishT = r.sim.t; }
  }
  endRace(r) {
    if (r.state === 'results') return;
    r.state = 'results'; r.resultsAt = Date.now();
    const sim = r.sim, rows = sim.results().map((x) => ({ place: x.place, pid: r.pidByCar.get(x.car) || 0, name: x.name, model: x.model, finished: x.finished, time: x.time, best: x.best, gapTime: x.gapTime, lapsDown: x.lapsDown, penalty: x.penalty }));
    for (const n of r.results.dnf) rows.push({ place: rows.length + 1, pid: 0, name: n, model: '-', finished: false, time: null, best: null, gapTime: null, lapsDown: 99, penalty: 0, left: true });
    r.results.rows = rows;
    this.bcast(r, { t: 'results', rows });
    this.sendRoom(r);
  }
  toLobby(r, p, force) {
    // everyone returns to the lobby once somebody asks (results screen "volver a la sala")
    if (r.state !== 'results' || (!force && Date.now() - r.resultsAt < LIMITS.resultsHold * 1000)) return;
    r.state = 'lobby'; r.sim = null; r.gridInfo = null;
    for (const q of r.players.values()) { q.simCar = null; q.ready = false; q.loaded = false; }
    this.bcast(r, { t: 'lobby' }); this.sendRoom(r);
  }

  /* ---------------- main loop ---------------- */
  tick() {
    const now = process.hrtime.bigint(), dt = Math.min(Number(now - this.last) / 1e9, 0.25) * this.timeScale; this.last = now;
    const wall = Date.now(), t0 = process.hrtime.bigint();
    for (const p of [...this.players.values()]) {            // expire disconnected players
      if (!p.conn && p.disc && wall > p.disc) {
        this.players.delete(p.token);
        if (p.room) this.removePlayer(p.room, p, 'timeout');
      }
    }
    for (const r of [...this.rooms.values()]) {
      if (r.state === 'grid' || r.state === 'racing') this.stepRoom(r, dt);
      if (r.state === 'results' && wall - r.resultsAt > 120000) this.toLobby(r, null, true);
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6; this.tickMs = (this.tickMs || 0) * 0.98 + ms * 0.02; this.tickMax = Math.max(ms, (this.tickMax || 0) * 0.999);
  }
  stepRoom(r, dt) {
    const sim = r.sim;
    if (r.state === 'grid') {
      r.gridT += dt;
      const connected = [...r.players.values()].filter((q) => q.conn);
      if (sim.state === 'grid' && (r.gridT > LIMITS.loadWait || (r.gridT > 6 && connected.every((q) => q.loaded)))) { sim.beginCountdown(); }
      if (sim.state === 'countdown' || sim.state === 'racing') r.state = 'racing';
    }
    r.acc += dt; let n = 0;
    while (r.acc >= STEP && n < 12) {
      for (const q of r.players.values()) if (q.simCar) q.simCar.input = q.simCar.race.finished ? { throttle: 0, brake: 0.3, steer: 0, handbrake: 0 } : q.conn ? q.input : { throttle: 0, brake: sim.state === 'racing' ? 0.35 : 0, steer: 0, handbrake: 0 };
      sim.step(null); r.acc -= STEP; n++; r.tick++;
      for (const e of sim.events) this.collectEvent(r, e);
      sim.events.length = 0;
      if (r.tick % Math.round(120 / NET.SNAP_HZ) === 0) this.snapshot(r);
    }
    if (n === 12) r.acc = 0;
    if (r.state === 'racing') {
      if (r.finishT != null && sim.t - r.finishT > LIMITS.finishWait) this.endRace(r);
      else if (r.tick % 60 === 0) this.checkFinish(r);
    }
  }
  collectEvent(r, e) {
    const pid = (c) => (c && r.pidByCar.get(c)) || 0;
    switch (e.type) {
      case 'light': r.evBuf.push({ e: 'light', n: e.n }); break;
      case 'go': r.evBuf.push({ e: 'go' }); break;
      case 'checkpoint': r.evBuf.push({ e: 'cp', pid: pid(e.car), i: e.index, t: +e.t.toFixed(3) }); break;
      case 'lap': r.evBuf.push({ e: 'lap', pid: pid(e.car), lap: e.lap, time: +e.time.toFixed(3), best: e.best ? 1 : 0 }); break;
      case 'finish': r.evBuf.push({ e: 'fin', pid: pid(e.car) }); this.checkFinish(r); break;
      case 'hit': r.evBuf.push({ e: 'hit', q: e.quiet ? 1 : 0, pid: pid(e.car), o: pid(e.other), sp: +e.speed.toFixed(1), x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), w: e.wall ? 1 : 0 }); break;
      case 'scrape': r.evBuf.push({ e: 'scr', pid: pid(e.car), x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2) }); break;
      case 'eject': r.evBuf.push({ e: 'ej', pid: pid(e.car), sp: +e.speed.toFixed(1) }); break;
      case 'ejectEnd': r.evBuf.push({ e: 'ejend', pid: pid(e.car) }); break;
      case 'respawn': r.evBuf.push({ e: 'resp', pid: pid(e.car), r: e.reason }); break;
    }
  }
  snapshot(r) {
    const sim = r.sim, cars = [];
    for (const c of sim.cars) { const pid = r.pidByCar.get(c); if (pid) cars.push(NET.packCar(pid, c)); }
    const ev = r.evBuf; r.evBuf = []; if (r.leftEv) { for (const x of r.leftEv) ev.push(x); r.leftEv = null; }
    this.bcast(r, { t: 'snap', k: r.tick, st: sim.state, sim: +sim.t.toFixed(3), li: sim.lights, c: cars, ev });
  }
}

module.exports = { Hub, LIMITS, PAINTS, track, getTrack, cleanName };
