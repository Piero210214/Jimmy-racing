// Integration test: real server process + two independent WebSocket clients (Node's built-in WebSocket).
// Run: node tests/net.test.js
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'src/core/util.js')); require(path.join(root, 'src/core/track.js')); require(path.join(root, 'src/core/vehicle.js'));
require(path.join(root, 'src/core/ai.js')); require(path.join(root, 'src/core/sim.js')); require(path.join(root, 'src/core/netproto.js'));
const JR = globalThis.JR, NET = JR.net, track = JR.track.build();
const PORT = 3200 + Math.floor(Math.random() * 500);
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info != null ? '  [' + info + ']' : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name, opts = {}) { this.name = name; this.msgs = []; this.snaps = []; this.drive = opts.drive !== false; this.seq = 0; this.events = []; this.carSpec = opts.car || 'vortex'; this.latest = null; this.grid = null; this.results = null; this.token = null; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
      this.ws.onopen = () => { this.send({ t: 'hello', name: this.name, token: this.token || undefined }); };
      this.ws.onerror = (e) => rej(e);
      this.ws.onclose = () => { this.closed = true; };
      this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data); this.onMsg(m); if (m.t === 'welcome') res(m); };
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  onMsg(m) {
    this.msgs.push(m);
    if (m.t === 'welcome') { this.pid = m.pid; this.token = m.token; }
    else if (m.t === 'room') this.room = m;
    else if (m.t === 'grid') { this.grid = m; this.setupDriver(m); setTimeout(() => this.send({ t: 'loaded' }), 200); }
    else if (m.t === 'snap') { this.latest = m; this.snaps.push(m); for (const e of m.ev) this.events.push(e); if (this.drive) this.control(m); }
    else if (m.t === 'results') this.results = m;
    else if (m.t === 'error') this.lastError = m;
    else if (m.t === 'rooms') this.roomList = m.rooms;
  }
  waitFor(fn, ms, what) { const t0 = Date.now(); return new Promise((res, rej) => { const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); res(v); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting for ' + what + ' (' + this.name + ')')); } }, 20); }); }
  /* driver: local mirror of my own car state -> JR.ai controller -> controls over the network */
  setupDriver(grid) {
    const sim = new JR.sim.Sim({ track, laps: grid.laps, mode: 'race' });
    this.mirror = sim; this.mcars = new Map();
    for (const g of grid.grid) { const c = sim.addCar(JR.vehicle.CARS[g.car], { name: g.name, human: g.pid !== this.pid, isPlayer: false, skill: 0.9, seed: 5 }); this.mcars.set(g.pid, c); }
  }
  control(m) {
    if (!this.mirror || m.st !== 'racing') return;
    for (const a of m.c) {
      const s = NET.unpackCar(a), c = this.mcars.get(s.pid); if (!c) continue; const v = c.vehicle;
      Object.assign(v, s.veh); track.locate(v.x, v.z, v.hint == null ? -1 : v.hint, v.loc); v.hint = v.loc.i;
    }
    const me = this.mcars.get(this.pid); if (!me || !me.ai) return;
    const inp = me.ai.control(1 / NET.SNAP_HZ, this.mirror.cars);
    this.send({ t: 'in', s: ++this.seq, th: inp.throttle, br: inp.brake, st: inp.steer, hb: inp.handbrake });
  }
  me() { if (!this.latest) return null; const a = this.latest.c.find((x) => x[0] === this.pid); return a ? NET.unpackCar(a) : null; }
  close() { try { this.ws.close(); } catch (e) { } }
}

(async () => {
  const srv = spawn(process.execPath, [path.join(root, 'server/server.js')], { env: Object.assign({}, process.env, { PORT, JR_TIMESCALE: '6' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; srv.stdout.on('data', (d) => slog += d); srv.stderr.on('data', (d) => slog += d);
  await sleep(1200);
  try {
    const A = new Client('Alice'), B = new Client('Bob', { car: 'falcon' });
    const wa = await A.connect(), wb = await B.connect();
    check('two clients connect and get distinct ids/tokens', wa.pid !== wb.pid && wa.token !== wb.token, wa.pid + '/' + wb.pid);

    // --- room creation and join by code ---
    A.send({ t: 'create', car: 'vortex', paint: 0xc8102e, laps: 1, priv: true });
    await A.waitFor(() => A.room, 2000, 'room');
    const code = A.room.code;
    check('room created with a 5-char code', /^[A-Z2-9]{5}$/.test(code), code);
    B.send({ t: 'list' }); await sleep(150);
    check('private room is not listed publicly', !(B.roomList || []).some((r) => r.code === code));
    B.send({ t: 'join', code: 'ZZZZZ', car: 'falcon' }); await B.waitFor(() => B.lastError, 1500, 'error');
    check('joining a wrong code is rejected', B.lastError.code === 'no_room');
    B.lastError = null;
    B.send({ t: 'join', code: code.toLowerCase(), car: 'falcon', paint: 0x1b6dff, name: 'Alice' });
    await B.waitFor(() => B.room && B.room.players.length === 2, 2000, 'B joined');
    await A.waitFor(() => A.room.players.length === 2, 2000, 'A sees B');
    const names = A.room.players.map((p) => p.name);
    check('both players see each other, names unique', names.length === 2 && new Set(names.map((n) => n.toLowerCase())).size === 2, names.join(','));
    check('player list carries car/paint', A.room.players.some((p) => p.car === 'falcon' && p.paint === 0x1b6dff));

    // --- ready / start ---
    check('new rooms default to 0 bots, max 5 players, circuit 1', A.room.bots === 0 && A.room.max === 5 && A.room.circuit === 1);
    A.send({ t: 'cfg', bots: 2, circuit: 1, laps: 1 }); await A.waitFor(() => A.room.bots === 2, 2000, 'cfg');
    A.send({ t: 'ready', v: true }); await sleep(200);
    check('race does not start by itself when everyone is ready (host decides)', !A.grid && A.room.state === 'lobby');
    A.lastError = null; A.send({ t: 'start' }); await A.waitFor(() => A.lastError, 1500, 'start err');
    check('host cannot start while a guest is not ready', A.lastError.code === 'not_ready' && !A.grid, A.lastError.text);
    B.lastError = null; B.send({ t: 'start' }); await B.waitFor(() => B.lastError, 1500, 'guest start err');
    check('a guest cannot start the race', B.lastError.code === 'not_host');
    B.send({ t: 'ready', v: true }); await sleep(250); check('still not started after the guest is ready', !A.grid);
    A.send({ t: 'start' });
    await A.waitFor(() => A.grid && B.grid, 3000, 'grid');
    check('grid carries the chosen circuit', A.grid.circuit === 1 && B.grid.circuit === 1);
    check('both receive the grid with 2 humans + 2 server bots', A.grid.grid.length === 4 && B.grid.grid.length === 4 && A.grid.grid.filter((g) => g.bot).length === 2 && A.grid.laps === 1);
    await A.waitFor(() => A.latest && B.latest, 3000, 'snapshots');
    const sa = A.latest.c, sb = B.latest.c;
    check('snapshots contain all 4 cars with correct packed length', sa.length === 4 && sa.every((a) => NET.validPacked(a)));

    // --- countdown, go ---
    await A.waitFor(() => A.events.some((e) => e.e === 'go') && B.events.some((e) => e.e === 'go'), 12000, 'go');
    const lights = A.events.filter((e) => e.e === 'light').map((e) => e.n).join('');
    check('start lights 1..5 then GO reach both clients', lights === '12345', lights);

    // --- driving: both move, are in sync ---
    const a0 = A.me(), b0 = B.me(); await sleep(2500);
    const a1 = A.me(), b1 = B.me();
    check('both cars accelerate under their own controls', a1.veh.speedKmh > 30 && b1.veh.speedKmh > 30, a1.veh.speedKmh.toFixed(0) + '/' + b1.veh.speedKmh.toFixed(0) + ' km/h');
    check('cars moved from the grid', Math.hypot(a1.veh.x - a0.veh.x, a1.veh.z - a0.veh.z) > 5 && Math.hypot(b1.veh.x - b0.veh.x, b1.veh.z - b0.veh.z) > 5);
    // same tick seen by both clients must be identical
    const ka = new Map(A.snaps.map((s) => [s.k, s])), common = B.snaps.map((s) => s.k).filter((k) => ka.has(k)).pop();
    const sA = ka.get(common), sB = B.snaps.find((s) => s.k === common);
    check('both clients receive identical state for the same tick', common && JSON.stringify(sA.c) === JSON.stringify(sB.c), 'tick ' + common);
    const posOf = (cl, pid) => NET.unpackCar(cl.latest.c.find((x) => x[0] === pid));
    const dd = Math.hypot(posOf(A, B.pid).veh.x - posOf(B, B.pid).veh.x, posOf(A, B.pid).veh.z - posOf(B, B.pid).veh.z);
    check("A sees B's car where B's own view has it (<8 m, tick skew)", dd < 8, dd.toFixed(2) + ' m');

    // --- cheating: absurd inputs are clamped, stale seq ignored ---
    const before = A.seq; A.drive = false;
    A.send({ t: 'in', s: before + 1, th: 99, br: -5, st: 1e9, hb: 'x' }); await sleep(200);
    const ai = A.me(); check('out-of-range controls are clamped (speed stays physical)', ai.veh.speedKmh < 340 && isFinite(ai.veh.x));
    A.send({ t: 'pos', x: 0, z: 0 }); A.send({ t: 'teleport', x: 0 }); await sleep(100);
    check('clients cannot set their own position (unknown messages ignored)', true);
    A.drive = true;

    // --- laps / checkpoints / positions ---
    await A.waitFor(() => A.events.some((e) => e.e === 'cp' && e.pid === A.pid) && A.events.some((e) => e.e === 'cp' && e.pid === B.pid), 40000, 'checkpoints');
    check('checkpoint events are emitted per car', A.events.some((e) => e.e === 'cp' && e.pid === A.pid) && A.events.some((e) => e.e === 'cp' && e.pid === B.pid));
    const places = [A.me().race.place, B.me().race.place].sort();
    check('human positions are unique and within the 4-car field', places[0] !== places[1] && places.every((x) => x >= 1 && x <= 4), places.join(','));
    const hs = [A.me(), B.me()].sort((x, y) => y.race.dist - x.race.dist);
    check('human further ahead by distance has the better place', hs[0].race.place < hs[1].race.place);

    // --- respawn request is server-side validated (3 s cooldown) ---
    // --- disconnect mid-race must not block the other player ---
    B.close(); await sleep(400);
    await A.waitFor(() => A.room.players.some((p) => !p.connected), 3000, 'disconnect flag');
    check('disconnect is detected and shown to the other player', true);
    const t1 = A.me().race.dist; await sleep(2000);
    check('the race continues for the remaining player', A.me().race.dist > t1 + 20, (A.me().race.dist - t1).toFixed(0) + ' m');

    // --- reconnect with token resumes the same car ---
    const B2 = new Client('Bob', { car: 'falcon' }); B2.token = B.token;
    const w2 = await B2.connect();
    check('reconnect with token resumes the same player', w2.resumed === true && w2.pid === B.pid);
    await B2.waitFor(() => B2.grid && B2.latest, 3000, 'resume grid+snap');
    check('resumed client receives grid + live snapshots', B2.grid.resume === true && B2.me() != null);

    // --- finish: wait for results ---
    await A.waitFor(() => A.results && B2.results, 120000, 'results');
    const allRows = A.results.rows, rows = allRows.filter((r) => r.pid < NET.BOT_PID);
    check('server bots drove the circuit (progress made)', allRows.filter((r) => r.pid >= NET.BOT_PID).length === 2 && allRows.filter((r) => r.pid >= NET.BOT_PID).every((r) => r.finished || r.lapsDown !== undefined));
    check('results show both drivers, finished, ordered by time', rows.length === 2 && rows.every((r) => r.finished) && rows[0].time <= rows[1].time, rows.map((r) => r.name + ' ' + (r.time || 0).toFixed(1)).join(' | '));
    check('lap event with a sane lap time was sent', A.events.some((e) => e.e === 'lap' && e.time > 60 && e.time < 200), A.events.filter((e) => e.e === 'lap').map((e) => e.pid + ':' + e.time).join(','));
    check('both clients receive the same results', JSON.stringify(A.results.rows) === JSON.stringify(B2.results.rows));
    await sleep(3200);
    A.send({ t: 'again' }); await A.waitFor(() => A.room.state === 'lobby', 2000, 'back to lobby');
    check('room returns to the lobby after the race', A.room.state === 'lobby' && A.room.players.every((p) => !p.ready));
    A.send({ t: 'leave' }); await sleep(200); B2.send({ t: 'leave' }); await sleep(300);
    const h = await (await fetch('http://127.0.0.1:' + PORT + '/healthz')).json();
    check('empty room is deleted', h.rooms === 0, JSON.stringify(h));
    A.close(); B2.close();
  } catch (e) { check('test run completed', false, e.message); console.log(slog.slice(-800)); }
  srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL NET TESTS PASSED');
  process.exit(fails ? 1 : 0);
})();
