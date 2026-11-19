require('../src/core/util.js'); require('../src/core/track.js'); require('../src/core/vehicle.js'); require('../src/core/ai.js'); require('../src/core/sim.js');
const JR = globalThis.JR; const track = JR.track.build();
const spec = JR.vehicle.CARS[process.argv[2] || 'falcon'];
const s0 = +process.argv[3], s1 = +process.argv[4];
const sim = new JR.sim.Sim({ track, laps: 2, mode: 'qualifying' });
const car = sim.addCar(spec, { skill: 0.95, seed: 3, mistakeRate: 0 });
const L = track.length, i0 = Math.round((L - 90) / track.ds), p = track.pointAt(L - 90, track.line.off[i0]);
const v = car.vehicle; v.reset(p.x, p.z, track.line.heading[i0], p.y); v.vx = car.ai.profile[i0] * 0.9; v.gear = 4;
const loc = track.locate(p.x, p.z, -1, v.loc); v.hint = loc.i; car.race.dist = -90; car.race.lastS = loc.s;
sim.state = 'racing'; sim.qualiLapsTarget = 1;
let last = -9;
for (let n = 0; n < 120 * 120; n++) {
  sim.step(null); sim.events.length = 0;
  const l = v.loc;
  if (l.s > s0 && l.s < s1 && n * (1/120) - last > 0.2) { last = n/120;
    console.log(`s=${l.s.toFixed(0)} d=${l.d.toFixed(1)} line=${track.line.off[l.i].toFixed(1)} v=${(v.vx*3.6).toFixed(0)} tgt=${(car.ai.profile[l.i]*3.6).toFixed(0)} k=${(1/Math.abs(track.line.k[l.i]||1e-9)).toFixed(0)}m thr=${car.input.throttle.toFixed(2)} brk=${car.input.brake.toFixed(2)} st=${car.input.steer.toFixed(2)} aF=${v.slipF.toFixed(2)} aR=${v.slipR.toFixed(2)} r=${v.r.toFixed(2)} ay=${v.lateralG.toFixed(2)}g abs=${v.absActive} tc=${v.tcActive}`); }
  if (n > 600 && l_s(v) > s1 + 30) break;
}
function l_s(v) { return v.loc.s; }
