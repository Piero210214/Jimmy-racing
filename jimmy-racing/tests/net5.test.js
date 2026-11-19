// Private-room rules with real WebSocket clients: max 5 (configurable 2..5), codes validated, ready gating, host start,
// kick, close room, host transfer, circuit/laps selection. Run: node tests/net5.test.js
const { spawn } = require('child_process'); const path = require('path'); const root = path.join(__dirname, '..');
const PORT = 4300 + Math.floor(Math.random() * 400); let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info != null ? '  [' + info + ']' : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = spawn(process.execPath, [path.join(root, 'server/server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' }); await sleep(1200);
  const mk = (i) => new Promise((res) => { const c = { i, room: null, evs: [], snaps: 0, ev: [] }; c.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    c.send = (o) => c.ws.send(JSON.stringify(o));
    c.ws.onopen = () => c.send({ t: 'hello', name: 'P' + i });
    c.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'welcome') { c.pid = m.pid; res(c); } else if (m.t === 'room') c.room = m; else if (m.t === 'grid') { c.grid = m; setTimeout(() => c.send({ t: 'loaded' }), 100); } else if (m.t === 'snap') { c.snaps++; c.last = m; c.evs.push(...m.ev); if (m.st === 'racing') c.send({ t: 'in', s: c.snaps, th: 1, br: 0, st: 0, hb: 0 }); } else if (m.t === 'error') c.err = m; else if (m.t === 'kicked') c.kicked = true; else if (m.t === 'closed') c.closed = true; else if (m.t === 'left') c.left = m; };
  });
  const cl = []; for (let i = 0; i < 7; i++) cl.push(await mk(i));
  const waitFor = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return false; };
  // --- room of 3 (host chooses the limit)
  cl[0].send({ t: 'create', car: 'vortex', laps: 1, priv: true, max: 3, circuit: 4 }); await waitFor(() => cl[0].room);
  const code = cl[0].room.code, R0 = cl[0].room;
  check('host creates a room with a unique code, chosen limit and circuit', /^[A-Z2-9]{5}$/.test(code) && R0.max === 3 && R0.circuit === 4 && R0.host === cl[0].pid, JSON.stringify({ code, max: R0.max, circuit: R0.circuit }));
  cl[1].send({ t: 'join', code: 'ABCDE' }); await waitFor(() => cl[1].err); check('wrong code is rejected by the server', cl[1].err && cl[1].err.code === 'no_room'); cl[1].err = null;
  cl[1].send({ t: 'join', code: code.toLowerCase(), car: 'falcon' }); cl[2].send({ t: 'join', code, car: 'titan' });
  await waitFor(() => cl[0].room.players.length === 3);
  check('two guests joined by code; lobby lists names/cars/connection/ready', cl[0].room.players.length === 3 && cl[0].room.players.every((p) => p.name && p.car && p.connected === true && p.ready === false));
  cl[3].send({ t: 'join', code }); await waitFor(() => cl[3].err); check('4th player rejected when the room limit is 3', cl[3].err && cl[3].err.code === 'room_full'); cl[3].err = null;
  cl[0].send({ t: 'cfg', max: 5, circuit: 7, laps: 2 }); await waitFor(() => cl[0].room.max === 5);
  check('host changes limit, circuit and laps in the lobby', cl[0].room.max === 5 && cl[0].room.circuit === 7 && cl[0].room.laps === 2 && cl[2].room.circuit === 7);
  cl[1].send({ t: 'cfg', circuit: 9 }); await sleep(200); check('a guest cannot change the circuit', cl[0].room.circuit === 7);
  cl[0].send({ t: 'cfg', max: 2 }); await sleep(200); check('limit cannot drop below current players', cl[0].room.max === 5);
  for (const i of [3, 4]) { cl[i].send({ t: 'join', code }); } await waitFor(() => cl[0].room.players.length === 5);
  cl[5].send({ t: 'join', code }); await waitFor(() => cl[5].err); check('maximum 5 players is never exceeded (6th rejected)', cl[0].room.players.length === 5 && cl[5].err.code === 'room_full');
  // --- ready gating
  cl[1].send({ t: 'ready', v: true }); cl[2].send({ t: 'ready', v: true }); cl[3].send({ t: 'ready', v: true }); await sleep(250);
  check('guests can mark ready; list shows it', cl[0].room.players.filter((p) => p.ready).length === 3);
  cl[0].send({ t: 'start' }); await waitFor(() => cl[0].err); check('host cannot start while someone is NOT ready', cl[0].err && cl[0].err.code === 'not_ready' && !cl[0].grid, cl[0].err && cl[0].err.text); cl[0].err = null;
  // --- kick
  cl[4].send({ t: 'kick', pid: cl[3].pid }); await sleep(200); check('a guest cannot kick', cl[0].room.players.length === 5);
  cl[0].send({ t: 'kick', pid: cl[4].pid }); await waitFor(() => cl[4].kicked);
  check('host can kick a player (kicked client is told, room shrinks)', cl[4].kicked && cl[0].room.players.length === 4 && !cl[0].room.players.some((p) => p.pid === cl[4].pid));
  cl[3].send({ t: 'ready', v: false }); await sleep(200);
  cl[0].send({ t: 'start' }); await waitFor(() => cl[0].err); check('un-readying blocks the start again', cl[0].err && cl[0].err.code === 'not_ready'); cl[0].err = null;
  cl[3].send({ t: 'ready', v: true }); await sleep(200);
  // --- start: everyone gets the same grid, circuit and lights
  cl[0].send({ t: 'start' }); await waitFor(() => [0, 1, 2, 3].every((i) => cl[i].grid));
  check('host starts; all 4 humans receive the grid (no bots), same circuit 7', [0, 1, 2, 3].every((i) => cl[i].grid && cl[i].grid.circuit === 7 && cl[i].grid.grid.length === 4 && cl[i].grid.grid.every((g) => !g.bot)));
  await waitFor(() => [0, 1, 2, 3].every((i) => cl[i].evs.some((e) => e.e === 'go')), 20000);
  check('synchronised start: lights + GO reach everybody', [0, 1, 2, 3].every((i) => cl[i].evs.filter((e) => e.e === 'light').length === 5 && cl[i].evs.some((e) => e.e === 'go')));
  await sleep(3000);
  const mv = (c) => c.last.c.map((a) => a[1 + 0]).length; check('snapshots carry exactly the 4 human cars and they move', cl[0].last.c.length === 4 && cl[0].last.c.every((a) => a[1 + 13] > 5), cl[0].last.c.map((a) => a[14]).join(','));
  // --- host leaves mid-race: control transfers, race goes on
  const oldHost = cl[0].pid; cl[0].send({ t: 'leave' }); await waitFor(() => cl[1].room && cl[1].room.host !== oldHost);
  check('host leaving transfers control safely to a connected player', cl[1].room.host !== oldHost && cl[1].room.players.length === 3 && cl[1].room.players.some((p) => p.pid === cl[1].room.host));
  const k0 = cl[1].snaps; await sleep(1000); check('race keeps running for the others', cl[1].snaps > k0 + 10 && cl[1].last.c.length === 3);
  // --- close room (new room)
  cl[5].err = null; cl[5].send({ t: 'create', laps: 1, max: 2 }); await waitFor(() => cl[5].room && cl[5].room.code);
  const code2 = cl[5].room.code; cl[6].send({ t: 'join', code: code2 }); await waitFor(() => cl[5].room.players.length === 2);
  cl[6].send({ t: 'close' }); await sleep(200); check('a guest cannot close the room', !cl[5].closed);
  cl[5].send({ t: 'close' }); await waitFor(() => cl[6].closed);
  check('host closes the room: guests are told and the code stops working', cl[6].closed === true);
  cl[4].err = null; cl[4].send({ t: 'join', code: code2 }); await waitFor(() => cl[4].err); check('closed room code is gone', cl[4].err && cl[4].err.code === 'no_room');
  cl[6].send({ t: 'create', laps: 1, max: 2 }); cl[6].room = null; await sleep(300); const c6 = cl[6].room && cl[6].room.code;
  check('every created room gets a different code', c6 && c6 !== code && c6 !== code2, c6);
  cl.forEach((c) => c.ws.close()); srv.kill(); console.log(fails ? `\n${fails} FAILED` : '\nALL ROOM TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
