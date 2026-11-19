require('../src/core/util.js'); require('../src/core/track.js'); require('../src/core/vehicle.js'); require('../src/core/ai.js'); require('../src/core/sim.js');
const JR = globalThis.JR; const { CARS } = JR.vehicle; const track = JR.track.build();
const sim = new JR.sim.Sim({ track, laps: 3, mode: 'race', seed: 5 });
const roster = [CARS.vortex, CARS.falcon, CARS.titan, CARS.vortex, CARS.falcon, CARS.titan];
const order = roster.map((s, i) => sim.addCar(s, { name: 'R' + (i + 1), skill: 0.93 + (i % 3) * 0.02, seed: 100 + i }));
sim.setupGrid(order); sim.beginCountdown();
let t = 0; const log = [];
const lastLog = {};
while (t < 60) {
  sim.step(null); t += 1 / 120;
  for (const e of sim.events) {
    if (e.type === 'hit') { const sc = e.car.vehicle.loc.s.toFixed(0); log.push(`t=${sim.t.toFixed(1)} ${e.car.name} hit ${e.other ? e.other.name : 'WALL'} @s=${sc} spd=${e.speed.toFixed(1)}`); }
  }
  sim.events.length = 0;
  if (Math.floor(sim.t) % 10 === 0 && sim.t > 0 && lastLog.t !== Math.floor(sim.t)) { lastLog.t = Math.floor(sim.t);
    console.log('t=' + Math.floor(sim.t) + ' ' + sim.cars.map(c => c.name + ':s' + c.vehicle.loc.s.toFixed(0) + '/v' + (c.vehicle.vx * 3.6).toFixed(0) + '/d' + c.vehicle.loc.d.toFixed(1)).join(' ')); }
}
console.log(log.slice(0, 30).join('\n'));
