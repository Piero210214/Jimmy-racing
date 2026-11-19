'use strict';
['util', 'track', 'vehicle', 'obstacles', 'ai', 'sim'].forEach((f) => require('../src/core/' + f + '.js'));
const JR = globalThis.JR, { CARS } = JR.vehicle, track = JR.track.build();
let fails = 0; const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  [' + d + ']' : '')); if (!ok) fails++; };

// ---- generation
const obs = JR.obstacles.generate(track, 1);
const by = {}; obs.forEach((o) => by[o.k] = (by[o.k] || 0) + 1);
check('all six obstacle kinds are generated', ['cone', 'barrel', 'tyres', 'plastic', 'barrier', 'block'].every((k) => by[k] > 0), JSON.stringify(by));
// the road is never blocked: in every 6 m slice of road, free lateral gap >= 6 m
let worstGap = 99;
for (let s = 0; s < track.length; s += 3) {
  const half = track.halfWidthAt(Math.floor(s / track.ds)) - 0.8, occ = [];
  obs.forEach((o) => { let ds = Math.abs(o.s - s); ds = Math.min(ds, track.length - ds); const ext = o.parts ? 1.6 : o.r; if (ds < 2.2 + ext) occ.push([o.d - o.r - 1.0, o.d + o.r + 1.0]); });
  occ.sort((a, b) => a[0] - b[0]);
  let cur = -half, gap = 0; for (const [a, b] of occ) { gap = Math.max(gap, a - cur); cur = Math.max(cur, b); } gap = Math.max(gap, half - cur);
  worstGap = Math.min(worstGap, gap);
}
check('road never blocked: widest free gap >= 6 m everywhere', worstGap >= 6, worstGap.toFixed(1) + ' m');
check('no obstacles on the start grid / first 160 m', obs.every((o) => o.s >= 160 && o.s <= track.length - 250));

function mk(kind, dOff) {
  const sim = new JR.sim.Sim({ track, laps: 1, mode: 'qualifying', obstacles: true, seed: 3 });
  const c = sim.addCar(CARS.vortex, { isPlayer: true, name: 'P' }); sim.setupGrid([c]); c.vehicle.locked = false; sim.state = 'racing';
  const o = sim.obstacles.find((q) => q.k === kind); const s0 = o.s - 40, p = track.pointAt(s0, o.d + (dOff || 0));
  c.vehicle.reset(p.x, p.z, p.heading, p.y); c.vehicle.vx = 25; c.vehicle.hint = -1; c.vehicle.locked = false;
  return { sim, c, o };
}
// ---- a cone is displaced; heavy block stops the car
{ const { sim, c, o } = mk('cone'); const x0 = o.x, z0 = o.z; let hits = 0;
  for (let i = 0; i < 120 * 3; i++) { sim.step({ throttle: 0.5, brake: 0, steer: 0, handbrake: 0 }); for (const e of sim.events) if (e.type === 'hit' && e.obst === 'cone') hits++; sim.events.length = 0; }
  check('cone is knocked away by the car', Math.hypot(o.x - x0, o.z - z0) > 1.0 && o.tilt > 0, Math.hypot(o.x - x0, o.z - z0).toFixed(1) + ' m, tilt ' + o.tilt.toFixed(2));
  check('car keeps going after a cone (barely slowed)', c.vehicle.speedKmh > 60, c.vehicle.speedKmh.toFixed(0) + ' km/h'); }
{ const { sim, c, o } = mk('barrel'); const x0 = o.x, z0 = o.z; for (let i = 0; i < 120 * 3; i++) { sim.step({ throttle: 0.5, brake: 0, steer: 0, handbrake: 0 }); sim.events.length = 0; }
  check('barrel reacts to the impact (moves)', Math.hypot(o.x - x0, o.z - z0) > 0.8, Math.hypot(o.x - x0, o.z - z0).toFixed(1) + ' m'); }
{ const { sim, c, o } = mk('block'); const x0 = o.x, z0 = o.z; let dmg0 = c.vehicle.damage, maxV = 0;
  for (let i = 0; i < 120 * 4; i++) { sim.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }); sim.events.length = 0; }
  const l = track.locate(c.vehicle.x, c.vehicle.z, -1);
  check('concrete block does not move', Math.hypot(o.x - x0, o.z - z0) < 1e-6);
  check('concrete block stops / deflects the car (not driven through)', l.s < o.s + 3 || Math.abs(l.d - o.d) > 1.4, 's ' + l.s.toFixed(0) + ' vs block ' + o.s.toFixed(0) + ', d ' + l.d.toFixed(1) + ' vs ' + o.d.toFixed(1));
  check('car is damaged by the concrete block', c.vehicle.damage > dmg0 + 0.05, c.vehicle.damage.toFixed(2)); }

// ---- AI race with obstacles: bots avoid them, finish all laps, are not stuck
{ const sim = new JR.sim.Sim({ track, laps: 2, mode: 'race', seed: 5, obstacles: true }); const order = [];
  [CARS.vortex, CARS.falcon, CARS.muscle || CARS.titan].forEach((s, i) => order.push(sim.addCar(s, { name: 'B' + i, skill: 0.85 + 0.05 * i, seed: 100 + i, mistakeRate: 0.3 })));
  sim.setupGrid(order); sim.beginCountdown(); let t = 0, respawns = 0, obstHits = 0, soft = 0; const seen = new Set(), moved0 = sim.obstacles.length;
  while (t < 60 * 11 && !sim.allFinished()) { sim.step(null); t += JR.sim.STEP; for (const e of sim.events) { if (seen.has(e)) continue; seen.add(e); if (e.type === 'respawn') respawns++; if (e.type === 'hit' && e.obst && !e.soft) obstHits++; if (e.type === 'hit' && e.obst && e.soft) soft++; } if (sim.events.length > 500) sim.events.length = 0; }
  check('bots finish 2 laps with obstacles on track', sim.allFinished(), t.toFixed(0) + ' s');
  check('bots avoid most obstacles (few heavy impacts)', obstHits < 25, obstHits + ' heavy, ' + soft + ' soft, ' + respawns + ' respawns');
  check('bots never got stuck (respawns)', respawns <= 3, respawns); }
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL OBSTACLE TESTS PASSED'); process.exit(fails ? 1 : 0);
