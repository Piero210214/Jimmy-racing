'use strict';
['util', 'track', 'vehicle', 'obstacles', 'ai', 'sim'].forEach((f) => require('../src/core/' + f + '.js'));
const JR = globalThis.JR, { CARS } = JR.vehicle, track = JR.track.build();
let fails = 0; const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  [' + d + ']' : '')); if (!ok) fails++; };
const T = track.features && track.features.tunnel;
check('tunnel exists', !!T, T && (T.s0.toFixed(0) + '-' + T.s1.toFixed(0)));
const mid = Math.floor(((T.s0 + T.s1) / 2) / track.ds);
check('tunnel wall hugs the road (<= 2 m from asphalt edge)', track.barrierDistAt(mid, 1) - track.width[mid] * 0.5 <= 2.0, (track.barrierDistAt(mid, 1) - track.width[mid] * 0.5).toFixed(2));
for (const side of [1, -1]) {
  const sim = new JR.sim.Sim({ track, laps: 1, mode: 'qualifying', obstacles: false, items: false, seed: 3 });
  const c = sim.addCar(CARS.vortex, { isPlayer: true, name: 'P' }); sim.setupGrid([c]); c.vehicle.locked = false; sim.state = 'racing';
  const p = track.pointAt(T.s0 + 20, 0); c.vehicle.reset(p.x, p.z, p.heading + side * 0.12, p.y); c.vehicle.vx = 40; c.vehicle.hint = -1;
  let maxD = 0, hit = false;
  for (let i = 0; i < 120 * 5; i++) { sim.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 });
    for (const e of sim.events) if (e.type === 'hit') hit = true; sim.events.length = 0;
    const l = track.locate(c.vehicle.x, c.vehicle.z, -1); if (l.s > T.s0 && l.s < T.s1) maxD = Math.max(maxD, Math.abs(l.d)); }
  const lim = track.barrierDistAt(mid, side) + 0.3;
  check('car cannot pass the tunnel wall (side ' + side + ')', maxD <= lim && hit, 'max |d| ' + maxD.toFixed(2) + ' <= ' + lim.toFixed(2) + ', hit ' + hit);
}
console.log(fails ? fails + ' FAILED' : 'ALL TUNNEL TESTS PASSED'); process.exit(fails ? 1 : 0);
