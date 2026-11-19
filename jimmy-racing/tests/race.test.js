// Headless race: 6 cars, 3 laps. Run: node tests/race.test.js
require('../src/core/util.js');
require('../src/core/track.js');
require('../src/core/vehicle.js');
require('../src/core/ai.js');
require('../src/core/sim.js');
const JR = globalThis.JR;
const { CARS } = JR.vehicle;
const U = JR.util;
const track = JR.track.build();
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  [' + info + ']' : '')); if (!ok) fails++; };

// ---- qualifying times for the AI (flying lap each) ----
let t0 = Date.now();
const specs = [CARS.vortex, CARS.falcon, CARS.titan];
const qt = specs.map((s, i) => JR.sim.simulateFlyingLap(track, s, 0.95, 10 + i));
console.log('flying laps (skill .95):', specs.map((s, i) => s.name + ' ' + U.fmtTime(qt[i])).join(' | '), `(${Date.now() - t0} ms)`);
check('AI flying laps complete', qt.every(t => t && t > 60 && t < 200), qt.map(t => t && t.toFixed(1)).join(','));

// ---- full race: 5 AI + one "player" driven by an AI controller so the harness is automatic ----
const sim = new JR.sim.Sim({ track, laps: 3, mode: 'race', seed: 5 });
const order = [];
const roster = [CARS.vortex, CARS.falcon, CARS.titan, CARS.vortex, CARS.falcon, CARS.titan];
roster.forEach((s, i) => order.push(sim.addCar(s, { name: 'R' + (i + 1), skill: 0.93 + (i % 3) * 0.02, seed: 100 + i, isPlayer: false })));
sim.setupGrid(order);
sim.beginCountdown();
const evCount = {};
let lightsSeen = [];
let maxSpeed = 0, nanSeen = false, stuckFrames = 0, hits = 0, maxPen = 0;
const lapEvents = [];
let simT = 0;
while (simT < 60 * 12 && !sim.allFinished()) {
  sim.step(null); simT += JR.sim.STEP;
  for (const e of sim.events) {
    evCount[e.type] = (evCount[e.type] || 0) + 1;
    if (e.type === 'light') lightsSeen.push(e.n);
    if (e.type === 'lap') lapEvents.push(e);
    if (e.type === 'hit') hits++;
  }
  sim.events.length = 0;
  for (const c of sim.cars) {
    const v = c.vehicle;
    if (!isFinite(v.x) || !isFinite(v.z) || !isFinite(v.vx) || !isFinite(v.r)) nanSeen = true;
    maxSpeed = Math.max(maxSpeed, v.speedKmh);
  }
}
const res = sim.results();
console.log('race time ' + simT.toFixed(1) + ' s, events', JSON.stringify(evCount));
res.forEach(r => console.log(`  P${r.place} ${r.name} (${r.model}) ${r.finished ? U.fmtTime(r.time) : 'DNF +' + r.lapsDown + 'L'} best ${U.fmtTime(r.best)} laps ${r.car.race.lapTimes.map(t => t.toFixed(1)).join('/')}`));
check('start lights 1..5 then go', lightsSeen.join('') === '12345' && evCount.go === 1, lightsSeen.join(','));
check('no NaN in physics', !nanSeen);
check('all 6 cars finish 3 laps', res.every(r => r.finished), res.filter(r => !r.finished).map(r => r.name + ' L' + r.car.race.lapsDone).join(','));
check('checkpoint events: 7 per lap per car (cps 1..7)', evCount.checkpoint === 6 * 3 * 7, evCount.checkpoint);
check('lap events: 3 per car', evCount.lap === 18, evCount.lap);
check('lap times sane (60..180 s, traffic allowed)', lapEvents.every(e => e.time > 60 && e.time < 180), lapEvents.map(e => e.time.toFixed(0)).join(','));
check('positions are 1..6 unique', new Set(res.map(r => r.place)).size === 6);
check('finish order sorted by time', res.every((r, i) => i === 0 || r.time >= res[i - 1].time));
check('cars never exceed 340 km/h', maxSpeed < 340, maxSpeed.toFixed(0));
console.log('collision events (hits):', hits);

// ---- barrier: drive straight into the wall ----
{
  const s2 = new JR.sim.Sim({ track, laps: 1, mode: 'qualifying' });
  const c = s2.addCar(CARS.vortex, { isPlayer: true, name: 'P' });
  s2.setupGrid([c]); c.vehicle.locked = false; s2.state = 'racing';
  const p = track.pointAt(4000, 0);
  c.vehicle.reset(p.x, p.z, p.heading + 0.5, p.y); c.vehicle.vx = 40; c.vehicle.hint = -1; c.vehicle.locked = false;
  let wallHits = 0, maxD = 0, railD = 0;
  for (let i = 0; i < 120 * 6; i++) {
    s2.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 });
    for (const e of s2.events) if (e.type === 'hit' && e.wall) wallHits++;
    s2.events.length = 0;
    const l = track.locate(c.vehicle.x, c.vehicle.z, c.vehicle.hint);
    const ov = Math.abs(l.d) - track.width[l.i] / 2;
    if (ov > maxD) { maxD = ov; railD = track.barrierDistAt(l.i, l.d) - track.width[l.i] / 2; }
  }
  check('barrier stops the car (stays inside rail + margin)', maxD < railD + 0.5, 'maxOutside ' + maxD.toFixed(2));
  check('barrier hit event emitted and damage recorded', wallHits > 0 && c.vehicle.damage > 0, 'hits ' + wallHits + ' dmg ' + c.vehicle.damage.toFixed(2));
}

// ---- car vs car: head-on-ish contact separates cars ----
{
  const s3 = new JR.sim.Sim({ track, laps: 1, mode: 'qualifying' });
  const a = s3.addCar(CARS.vortex, { isPlayer: true, name: 'A' });
  const b = s3.addCar(CARS.titan, { isPlayer: false, name: 'B', mistakeRate: 0 });
  s3.state = 'racing';
  const pa = track.pointAt(4800, 0), pb = track.pointAt(4806, 0.4);
  a.vehicle.reset(pa.x, pa.z, pa.heading, pa.y); b.vehicle.reset(pb.x, pb.z, pb.heading, pb.y);
  a.vehicle.vx = 30; b.vehicle.vx = 10; a.vehicle.locked = b.vehicle.locked = false; a.vehicle.hint = b.vehicle.hint = -1;
  let hit = 0, minD = 1e9;
  for (let i = 0; i < 120 * 3; i++) {
    s3.step({ throttle: 0.3, brake: 0, steer: 0, handbrake: 0 });
    for (const e of s3.events) if (e.type === 'hit' && !e.wall) hit++;
    s3.events.length = 0;
    minD = Math.min(minD, Math.hypot(a.vehicle.x - b.vehicle.x, a.vehicle.z - b.vehicle.z));
  }
  check('car-car collision detected', hit > 0, 'events ' + hit);
  check('cars never interpenetrate deeply', minD > 2.8, 'min centre distance ' + minD.toFixed(2));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL RACE TESTS PASSED');
process.exit(fails ? 1 : 0);
