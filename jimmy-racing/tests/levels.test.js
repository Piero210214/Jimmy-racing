'use strict';
['util', 'track', 'vehicle', 'obstacles', 'items', 'ai', 'sim', 'levels'].forEach((f) => require('../src/core/' + f + '.js'));
const JR = globalThis.JR, LV = JR.levels; let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  [' + d + ']' : '')); if (!ok) fails++; };
check('exactly 10 levels, ids 1..10, no level 11', LV.LEVELS.length === 10 && LV.LEVELS.every((l, i) => l.id === i + 1) && LV.byId(11) === null && LV.byId(0) === null);
check('10 different scenes', new Set(LV.LEVELS.map((l) => l.scene)).size === 10 && LV.LEVELS.every((l) => LV.SCENES[l.scene]));
check('10 different circuits', new Set(LV.LEVELS.map((l) => JSON.stringify(l.circuitDef))).size === 10);
check('every level has name, 3 objectives, unlock rule and reward', LV.LEVELS.every((l) => l.name && l.objectives.length === 3 && l.unlock && l.reward));
check('level 1 keeps the original circuit', JSON.stringify(LV.CIRCUITS.c1) === JSON.stringify(JR.track.DEFAULT_CIRCUIT));
// every circuit is valid: closed loop, drivable curvature, tunnel on a straight, obstacles never in the tunnel, grid on the straight
for (const L of LV.LEVELS) {
  const t = JR.track.build({ circuit: L.circuitDef }), T = t.features.tunnel; let kt = 0, kmax = 0;
  for (let s = T.s0 - 70; s < T.s1 + 70; s += 2) kt = Math.max(kt, Math.abs(t.k[Math.floor(s / t.ds) % t.N]));
  for (let i = 0; i < t.N; i++) kmax = Math.max(kmax, Math.abs(t.k[i]));
  const gap = Math.hypot(t.x[0] - t.x[t.N - 1], t.z[0] - t.z[t.N - 1]);
  const obs = JR.obstacles.generate(t, 7), inTun = obs.filter((o) => o.s > T.s0 - 150 && o.s < T.s1 + 20).length;
  let startK = 0; for (let s = t.length - 60; s < t.length + 150; s += 5) startK = Math.max(startK, Math.abs(t.k[Math.floor(((s % t.length) + t.length) % t.length / t.ds)]));
  check('level ' + L.id + ' circuit valid', gap < 4 && kt < 0.0012 && kmax < 0.012 && inTun === 0 && startK < 0.0005 && obs.length > 20, 'len ' + t.length.toFixed(0) + ' tunnelK ' + kt.toFixed(5) + ' maxK ' + kmax.toFixed(4) + ' obs ' + obs.length);
  const sim = new JR.sim.Sim({ track: t, laps: 1, mode: 'race', obstacles: true, items: true, seed: 5 }); const c = sim.addCar(JR.vehicle.CARS.vortex, { name: 'P' }); sim.setupGrid([c]); sim.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 });
}
// AI can lap every circuit (drivability) and the star-2 target is achievable for a skilled lap
for (const L of LV.LEVELS) { const t = JR.track.build({ circuit: L.circuitDef }), lap = JR.sim.simulateFlyingLap(t, JR.vehicle.CARS.vortex, 0.97, 5); check('level ' + L.id + ' lap target reachable (AI lap ' + (lap || 0).toFixed(1) + ' s <= target ' + L.lapT + ' s)', lap && lap > 60 && lap <= L.lapT); }
// progression + persistence
const mem = {}, back = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
const S = LV.store(back); let p = S.load();
check('fresh save: only level 1 unlocked', LV.isUnlocked(p, 1) && !LV.isUnlocked(p, 2) && !LV.isUnlocked(p, 11));
let r = LV.record(p, LV.byId(1), { finished: true, place: 5, bestLap: 100, heavyHits: 0 }); check('finishing out of the required place does not complete the level', !r.newlyDone && !LV.isUnlocked(p, 2));
r = LV.record(p, LV.byId(1), { finished: true, place: 2, bestLap: 100, heavyHits: 9 }); check('required place completes level and unlocks level 2', r.newlyDone && r.unlocked === 2 && LV.isUnlocked(p, 2) && !LV.isUnlocked(p, 3));
check('stars are per objective (place + lap, not clean)', r.stars === 2 && JSON.stringify(r.eval.stars) === '[true,true,false]');
S.save(p); const p2 = S.load(); check('progress persists through storage', LV.isUnlocked(p2, 2) && p2.stars[1] === 2 && p2.best[1] === 100);
r = LV.record(p2, LV.byId(1), { finished: true, place: 1, bestLap: 90, heavyHits: 1 }); check('stars only go up; best lap kept', p2.stars[1] === 3 && p2.best[1] === 90 && !r.newlyDone);
for (let i = 2; i <= 10; i++) { LV.record(p2, LV.byId(i), { finished: true, place: 1, bestLap: 50, heavyHits: 0 }); }
check('completing level 10 unlocks nothing beyond (no level 11)', LV.isUnlocked(p2, 10) && !LV.isUnlocked(p2, 11) && Object.keys(p2.done).length === 10 && LV.totalStars(p2) === 30);
check('DNF never completes a level', !LV.record(LV.emptyProgress(), LV.byId(1), { finished: false, place: 1, bestLap: 1, heavyHits: 0 }).newlyDone);
mem['jr_levels_v1'] = '{bad json'; check('corrupt save falls back to a fresh one', LV.isUnlocked(S.load(), 1) && !LV.isUnlocked(S.load(), 2));
console.log(fails ? fails + ' FAILED' : 'ALL LEVEL TESTS PASSED'); process.exit(fails ? 1 : 0);
