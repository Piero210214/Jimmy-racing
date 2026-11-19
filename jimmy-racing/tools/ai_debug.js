require('../src/core/util.js'); require('../src/core/track.js'); require('../src/core/vehicle.js'); require('../src/core/ai.js'); require('../src/core/sim.js');
const JR = globalThis.JR; const track = JR.track.build();
const id = process.argv[2] || 'falcon';
const spec = JR.vehicle.CARS[id];
const sim = new JR.sim.Sim({ track, laps: 2, mode: 'qualifying' });
const car = sim.addCar(spec, { skill: 0.95, seed: 3, mistakeRate: 0 });
const L = track.length, i0 = Math.round((L - 90) / track.ds), p = track.pointAt(L - 90, track.line.off[i0]);
const v = car.vehicle; v.reset(p.x, p.z, track.line.heading[i0], p.y); v.vx = car.ai.profile[i0] * 0.9; v.gear = 4;
const loc = track.locate(p.x, p.z, -1, v.loc); v.hint = loc.i; car.race.dist = -90; car.race.lastS = loc.s;
sim.state = 'racing'; sim.qualiLapsTarget = 1;
let t = 0, lastPrint = -99, offTrack = 0, scrape = 0, wall = 0;
const prof = car.ai.profile;
for (let n = 0; n < 120 * (process.argv[4] ? +process.argv[4] : 300) && !car.race.finished; n++) {
  sim.step(null); t += 1 / 120;
  for (const e of sim.events) { if (e.type === 'scrape') scrape++; if (e.type === 'hit') wall++; } sim.events.length = 0;
  const l = v.loc, half = track.width[l.i] / 2;
  if (Math.abs(l.d) > half) offTrack++;
  if (t - lastPrint > (process.argv[3] ? +process.argv[3] : 4)) { lastPrint = t;
    console.log(`t=${t.toFixed(0)} s=${l.s.toFixed(0)} d=${l.d.toFixed(1)} line=${track.line.off[l.i].toFixed(1)} v=${(v.vx*3.6).toFixed(0)} tgt=${(prof[l.i]*3.6).toFixed(0)} g${v.gear} slipR=${v.slipR.toFixed(2)} r=${v.r.toFixed(2)} surf=${v.surface.name}`); }
}
console.log('lap', car.race.lapTimes[0], 'offTrack frames', offTrack, 'scrapes', scrape, 'hits', wall, 'minProfileKmh', (Math.min(...prof)*3.6).toFixed(0), 'maxProfile', (Math.max(...prof)*3.6).toFixed(0));
