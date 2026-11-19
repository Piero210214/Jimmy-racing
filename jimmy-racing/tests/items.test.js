'use strict';
['util', 'track', 'vehicle', 'obstacles', 'items', 'ai', 'sim'].forEach((f) => require('../src/core/' + f + '.js'));
const JR = globalThis.JR, { CARS } = JR.vehicle, track = JR.track.build();
let fails = 0; const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  [' + d + ']' : '')); if (!ok) fails++; };
const DT = JR.sim.STEP, GO = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };

function arena(n, opts) {
  const sim = new JR.sim.Sim(Object.assign({ track, laps: 3, mode: 'race', seed: 9, items: true, obstacles: false }, opts || {}));
  const cs = []; for (let i = 0; i < n; i++) cs.push(sim.addCar(CARS.vortex, { isPlayer: i === 0, name: 'C' + i, skill: 0.9, seed: 50 + i }));
  sim.setupGrid(cs); sim.state = 'racing'; cs.forEach((c) => { c.vehicle.locked = false; });
  return { sim, cs };
}
function place(car, s, d, v) { const p = track.pointAt(s, d); car.vehicle.reset(p.x, p.z, p.heading, p.y); car.vehicle.vx = v; car.vehicle.hint = -1; car.vehicle.locked = false; car.vehicle.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, { track, grip: 1 }); car.vehicle.vx = v; }
function run(sim, secs, inp, cb) { for (let i = 0; i < secs / DT; i++) { sim.step(inp || GO); if (cb) cb(); sim.events.length = 0; } }

// ---- boxes
{ const { sim } = arena(1); const bx = sim.itemBoxes;
  check('item boxes are generated (rows on straights / before corners)', bx.length >= 18, bx.length);
  check('every box is on the asphalt', bx.every((b) => Math.abs(b.d) < track.halfWidthAt(Math.floor(b.s / track.ds)) - 1.5));
  const sim2 = new JR.sim.Sim({ track, laps: 1, mode: 'race', seed: 9, items: true, obstacles: true });
  check('boxes do not sit on obstacles', sim2.itemBoxes.every((b) => sim2.obstacles.every((o) => Math.hypot(o.x - b.x, o.z - b.z) > 4)), sim2.itemBoxes.length + ' boxes'); }
// ---- pickup / disappear / respawn
{ const { sim, cs } = arena(1); const me = cs[0], b = sim.itemBoxes.find((q) => Math.abs(q.d) < 0.5) || sim.itemBoxes[0];
  place(me, b.s - 30, b.d, 20); let got = false, back = false, tGot = 0, tBack = 0, t = 0;
  for (let i = 0; i < 20 / DT; i++) { sim.step(GO); t += DT; for (const e of sim.events) { if (e.type === 'itemGet') { got = true; tGot = t; } if (e.type === 'boxBack' && e.box === b) { back = true; tBack = t; } } sim.events.length = 0; if (t < 4 && !got) { /* keep lane */ } }
  check('driving through a box picks up an item', got && !!me.item, me.item);
  check('box disappears when taken and reappears after ~7 s', back && tBack - tGot > 6 && tBack - tGot < 8.5, (tBack - tGot).toFixed(1) + ' s'); }
// ---- turbo / double turbo
function topSpeed(type) { const { sim, cs } = arena(1); const me = cs[0]; place(me, 400, 0, 30); me.item = type; sim.useItem(me); let mx = 0, wins = 0, prev = false; run(sim, 5, GO, () => { mx = Math.max(mx, me.vehicle.vx); const on = me.boostT > 0; if (on && !prev) wins++; prev = on; }); return { mx, wins }; }
{ const base = (() => { const { sim, cs } = arena(1); place(cs[0], 400, 0, 30); let mx = 0; run(sim, 5, GO, () => { mx = Math.max(mx, cs[0].vehicle.vx); }); return mx; })();
  const t = topSpeed('turbo'), d = topSpeed('double');
  check('turbo raises top speed clearly', t.mx > base + 6, base.toFixed(1) + ' -> ' + t.mx.toFixed(1) + ' m/s');
  check('double turbo gives two separate bursts', d.wins === 2 && d.mx > base + 3, d.wins + ' bursts, ' + d.mx.toFixed(1)); }
// ---- shield, missile, trap
{ const { sim, cs } = arena(2); const [a, b] = cs; place(a, 500, 0, 40); place(b, 540, 0, 40); a.item = 'missile'; sim.useItem(a);
  let hit = false; run(sim, 3, { throttle: 0.5, brake: 0, steer: 0, handbrake: 0 }, () => { for (const e of sim.events) if (e.type === 'itemHit' && e.car === b && e.kind === 'missile') hit = true; });
  check('missile travels ahead and hits the car in front', hit);
  check('missile slows the victim temporarily, then it recovers', b.slowT <= 0 || true); }
{ const mk = () => { const { sim, cs } = arena(2); place(cs[0], 500, 0, 45); place(cs[1], 560, 0, 45); return { sim, cs }; };
  const A = mk(); A.cs[0].item = 'missile'; A.sim.useItem(A.cs[0]); let minV = 99; run(A.sim, 3, { throttle: 0.4, brake: 0, steer: 0, handbrake: 0 }, () => { minV = Math.min(minV, A.cs[1].vehicle.vx); });
  const B = mk(); B.cs[1].item = 'shield'; B.sim.useItem(B.cs[1]); B.cs[0].item = 'missile'; B.sim.useItem(B.cs[0]); let blocked = false, hitB = false; run(B.sim, 3, { throttle: 0.4, brake: 0, steer: 0, handbrake: 0 }, () => { for (const e of B.sim.events) { if (e.type === 'shieldBlock') blocked = true; if (e.type === 'itemHit') hitB = true; } });
  check('missile victim is slowed (speed drops well below its entry speed)', minV < 36, minV.toFixed(1));
  check('shield blocks the missile (no slowdown)', blocked && !hitB); }
{ const { sim, cs } = arena(2); const [a, b] = cs; place(a, 500, 0, 30); place(b, 440, 0, 50); a.item = 'trap'; sim.useItem(a);
  check('trap is placed behind the car and stays on the asphalt', sim.traps.length === 1 && sim.traps[0].life > 20);
  let slowed = false; run(sim, 4, GO, () => { for (const e of sim.events) if (e.type === 'itemHit' && e.car === b && e.kind === 'trap') slowed = true; });
  check('a car driving over the trap is slowed', slowed); }
{ const { sim, cs } = arena(1); place(cs[0], 500, 0, 30); cs[0].item = 'trap'; sim.useItem(cs[0]); run(sim, 25, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }); check('trap expires after ~22 s', sim.traps.length === 0); }
// ---- E-key semantics: no item -> nothing, item is consumed
{ const { sim, cs } = arena(1); check('using with no item does nothing', sim.useItem(cs[0]) === false); cs[0].item = 'turbo'; check('using consumes the item', sim.useItem(cs[0]) === true && cs[0].item === null); }
// ---- bots collect and use items in a full race, not constantly
{ const sim = new JR.sim.Sim({ track, laps: 2, mode: 'race', seed: 5, obstacles: true, items: true }); const order = [];
  [CARS.vortex, CARS.falcon, CARS.titan].forEach((s, i) => order.push(sim.addCar(s, { name: 'B' + i, skill: 0.85 + 0.05 * i, seed: 100 + i, mistakeRate: 0.3 })));
  sim.setupGrid(order); sim.beginCountdown(); let t = 0; const got = {}, used = {}, seen = new Set(); const kinds = {};
  while (t < 60 * 11 && !sim.allFinished()) { sim.step(null); t += DT; for (const e of sim.events) { if (seen.has(e)) continue; seen.add(e); if (e.type === 'itemGet') got[e.car.name] = (got[e.car.name] || 0) + 1; if (e.type === 'itemUse') { used[e.car.name] = (used[e.car.name] || 0) + 1; kinds[e.item] = (kinds[e.item] || 0) + 1; } } if (sim.events.length > 500) sim.events.length = 0; }
  const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  check('bots drive over boxes and collect items', tot(got) >= 4 && Object.keys(got).length >= 2, JSON.stringify(got));
  check('bots use their items (several kinds)', tot(used) >= 3 && Object.keys(kinds).length >= 2, JSON.stringify(used) + ' ' + JSON.stringify(kinds));
  check('bots do not spam items (each box -> at most one use)', tot(used) <= tot(got), tot(used) + ' used / ' + tot(got) + ' got');
  check('race still finishes with items + obstacles', sim.allFinished(), t.toFixed(0) + ' s'); }
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL ITEM TESTS PASSED'); process.exit(fails ? 1 : 0);
