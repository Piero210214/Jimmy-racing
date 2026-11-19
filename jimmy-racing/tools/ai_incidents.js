require('../src/core/util.js'); require('../src/core/track.js'); require('../src/core/vehicle.js'); require('../src/core/ai.js'); require('../src/core/sim.js');
const JR = globalThis.JR; const track = JR.track.build();
const spec = JR.vehicle.CARS[process.argv[2] || 'falcon'];
const skill = +(process.argv[3] || 0.95);
const sim = new JR.sim.Sim({ track, laps: 2, mode: 'qualifying' });
const car = sim.addCar(spec, { skill, seed: 3, mistakeRate: 0 });
const L = track.length, i0 = Math.round((L - 90) / track.ds), p = track.pointAt(L - 90, track.line.off[i0]);
const v = car.vehicle; v.reset(p.x, p.z, track.line.heading[i0], p.y); v.vx = car.ai.profile[i0] * 0.9; v.gear = 4;
const loc = track.locate(p.x, p.z, -1, v.loc); v.hint = loc.i; car.race.dist = -90; car.race.lastS = loc.s;
sim.state = 'racing'; sim.qualiLapsTarget = 1;
let prof = car.ai.profile, ideal = 0; for (let i = 0; i < track.N; i++) ideal += track.line.step[i] / prof[i];
console.log('profile ideal lap', ideal.toFixed(1), 's');
let inc = false, n = 0, offFrames = 0, incidents = 0;
while (!car.race.finished && n < 120 * 400) {
  sim.step(null); sim.events.length = 0; n++;
  const l = v.loc, off = Math.abs(l.d) > track.width[l.i] / 2 + 0.5 || Math.abs(v.slipR) > 0.35;
  if (off) offFrames++;
  if (off && !inc && n > 600) { inc = true; incidents++; if (incidents <= 8) console.log(`incident @t=${(n/120).toFixed(0)} s=${l.s.toFixed(0)} d=${l.d.toFixed(1)} line=${track.line.off[l.i].toFixed(1)} v=${(v.vx*3.6).toFixed(0)} tgt=${(prof[l.i]*3.6).toFixed(0)} slipF=${v.slipF.toFixed(2)} slipR=${v.slipR.toFixed(2)} thr=${car.input.throttle.toFixed(2)} brk=${car.input.brake.toFixed(2)} kline=${(1/Math.abs(track.line.k[l.i]||1e-9)).toFixed(0)}m`); }
  if (!off) inc = false;
}
console.log('lap', (car.race.lapTimes[0] || NaN).toFixed(1), 'incidents', incidents, 'offFrames', offFrames);
