'use strict';
['util', 'track', 'vehicle', 'obstacles', 'items', 'ai', 'sim'].forEach((f) => require('../src/core/' + f + '.js'));
const JR = globalThis.JR, { CARS } = JR.vehicle, track = JR.track.build(); let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  [' + d + ']' : '')); if (!ok) fails++; };
const STEP = JR.sim.STEP, T = track.features.tunnel;
function setup(s, speed, yaw, laps, ai) {
  const sim = new JR.sim.Sim({ track, laps: laps || 3, mode: 'race', obstacles: false, items: false, seed: 3 });
  const c = sim.addCar(CARS.vortex, ai ? { isPlayer: false, name: 'AI', skill: 0.9, seed: 4 } : { isPlayer: true, name: 'P' }); sim.setupGrid([c]); c.vehicle.locked = false; sim.state = 'racing';
  const p = track.pointAt(s, 0); c.vehicle.reset(p.x, p.z, p.heading + yaw, p.y); c.vehicle.vx = speed; c.vehicle.hint = -1; return { sim, c };
}
const full = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
// 1) severe head-on into the guard rail
let { sim, c } = setup(1200, 62, 0.42), ejAt = null, endAt = null, ejects = 0, ends = 0, speeds = [], t0 = null;
for (let i = 0; i < 120 * 9; i++) {
  sim.step(full);
  for (const e of sim.events) { if (e.type === 'eject') { ejects++; ejAt = sim.t; } if (e.type === 'ejectEnd') { ends++; endAt = sim.t; } }
  sim.events.length = 0; if (c.ejected && c.ejected.t > 1.0) speeds.push(Math.hypot(c.vehicle.vx, c.vehicle.vy));
}
check('severe impact ejects the pilot exactly once (no duplicates)', ejects === 1 && ends === 1, ejects + '/' + ends);
check('the pilot returns exactly 3.0 s after the impact', ejAt != null && endAt != null && Math.abs((endAt - ejAt) - 3.0) < 0.02, (endAt - ejAt).toFixed(3));
check('the car is stopped while the pilot is out', speeds.length > 100 && Math.max(...speeds) < 0.5, Math.max(...speeds).toFixed(3));
check('state restored: not ejected, valid position near the road', !c.ejected && Math.abs(c.vehicle.loc.d) < track.halfWidthAt(c.vehicle.loc.i) + 1.5, c.vehicle.loc.d.toFixed(2));
// 2) race continues: the car accelerates again and does not get stuck
const x0 = c.vehicle.x, z0 = c.vehicle.z; for (let i = 0; i < 120 * 5; i++) { sim.step({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -c.vehicle.loc.d * 0.1)), handbrake: 0 }); sim.events.length = 0; }
check('the car drives away again after the pilot is back', Math.hypot(c.vehicle.vx, c.vehicle.vy) > 8 && Math.hypot(c.vehicle.x - x0, c.vehicle.z - z0) > 15, Math.hypot(c.vehicle.vx, c.vehicle.vy).toFixed(1) + ' m/s');
// 3) cool-down: a second hard hit right after does not eject again
({ sim, c } = setup(1200, 62, 0.42)); ejects = 0; c.ejectCool = 0; let first = false;
for (let i = 0; i < 120 * 3.2; i++) { sim.step(full); for (const e of sim.events) if (e.type === 'eject') ejects++; sim.events.length = 0; }
const p = track.pointAt(1500, 0); c.vehicle.reset(p.x, p.z, p.heading + 0.42, p.y); c.vehicle.vx = 62; c.vehicle.hint = -1;
for (let i = 0; i < 120 * 4; i++) { sim.step(full); for (const e of sim.events) if (e.type === 'eject') ejects++; sim.events.length = 0; }
check('cool-down: no second ejection for 10 s', ejects === 1, ejects);
// 4) tunnel wall impact counts too; soft hits never eject
({ sim, c } = setup(T.s0 + 15, 60, 0.45)); ejects = 0; for (let i = 0; i < 120 * 4; i++) { sim.step(full); for (const e of sim.events) if (e.type === 'eject') ejects++; sim.events.length = 0; }
check('hard tunnel-wall impact ejects the pilot', ejects === 1, ejects);
({ sim, c } = setup(1200, 30, 0.1)); ejects = 0; for (let i = 0; i < 120 * 4; i++) { sim.step(full); for (const e of sim.events) if (e.type === 'eject') ejects++; sim.events.length = 0; }
check('glancing / low-speed impact does not eject', ejects === 0, ejects);
// 5) AI cars recover too (no human input needed)
({ sim, c } = setup(1200, 62, 0.42, 3, true)); ejects = 0; ends = 0;
for (let i = 0; i < 120 * 9; i++) { sim.step(null); for (const e of sim.events) { if (e.type === 'eject') ejects++; if (e.type === 'ejectEnd') ends++; } sim.events.length = 0; }
check('AI cars are also ejected and recovered automatically', ejects <= 1 && ends === ejects && !c.ejected, ejects + '/' + ends);
console.log(fails ? fails + ' FAILED' : 'ALL CRASH TESTS PASSED'); process.exit(fails ? 1 : 0);
