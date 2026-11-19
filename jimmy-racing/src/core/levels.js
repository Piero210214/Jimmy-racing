/* JIMMY RACING - levels.js : the 10-level campaign (shared by the browser and the Node server).
 * Each level = its own circuit (geometry), scenario (visual theme), race rules, three objectives (one star each),
 * unlock rule and reward. There are EXACTLY 10 levels; progress is stored under one localStorage key.
 *
 * Objectives (evaluated from the finished race by JR.levels.evaluate):
 *   place : finish in position <= n                    (star 1, also the condition to complete the level and unlock the next)
 *   lap   : set a best lap <= target seconds           (star 2)
 *   clean | items : <= n heavy impacts   |  >= n item boxes collected    (star 3)
 * Reward: championship points (stars x 10 + completion bonus) shown in the menu; every completed level unlocks the next one.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {}; var JR = G.JR;

  /* scene = visual theme consumed by render/world.js + env (colours are linear multipliers / rgb 0..1) */
  var SCENES = {
    classic:   { id: 'classic',   name: 'Clásico (original)',   env: {}, ground: [1, 1, 1], amp: 1, rock: 1, trees: { density: 1, pine: 0.35 }, buildings: 'village' },
    city:      { id: 'city',      name: 'Ciudad moderna',       env: { time: 'noon' },   ground: [0.62, 0.70, 0.55], amp: 0.25, trees: { density: 0.35, pine: 0.15 }, buildings: 'city', cityDensity: 0.8 },
    tropical:  { id: 'tropical',  name: 'Ciudad tropical',      env: { time: 'noon', sky: [0.05, 0.34, 0.75], hor: [0.62, 0.86, 0.95], fogCol: [0.7, 0.88, 0.92], sat: 1.28 }, ground: [0.42, 1.05, 0.40], amp: 0.35, trees: { density: 1.4, pine: 0.0 }, treeTint: [0.8, 1.2, 0.7], buildings: 'city', cityDensity: 0.45 },
    desert:    { id: 'desert',    name: 'Desierto',             env: { time: 'noon', hor: [0.95, 0.80, 0.58], fogCol: [0.92, 0.78, 0.6], fogMul: 1.2, exposure: 1.0, sat: 1.1 }, ground: [2.7, 1.35, 2.1], amp: 0.55, rock: 0.8, trees: { density: 0.12, pine: 0 }, treeTint: [1.45, 1.1, 0.5], buildings: 'none' },
    forest:    { id: 'forest',    name: 'Bosque',               env: { time: 'noon', hor: [0.55, 0.70, 0.66], fogCol: [0.55, 0.68, 0.62], fogMul: 1.6, sat: 1.1 }, ground: [0.50, 0.85, 0.42], amp: 0.5, trees: { density: 3.2, pine: 0.55 }, buildings: 'village' },
    coast:     { id: 'coast',     name: 'Costa junto al mar',   env: { time: 'sunset' }, ground: [0.95, 0.95, 0.65], amp: 0.2, sea: true, trees: { density: 0.5, pine: 0.0 }, treeTint: [0.95, 1.1, 0.7], buildings: 'village' },
    night:     { id: 'night',     name: 'Ciudad nocturna',      env: { time: 'night', neon: true, sat: 1.25 }, ground: [0.45, 0.5, 0.5], amp: 0.2, trees: { density: 0.25, pine: 0.1 }, buildings: 'city', cityDensity: 1.0, neon: true },
    mountains: { id: 'mountains', name: 'Montañas',             env: { time: 'noon', hor: [0.62, 0.74, 0.92], fogMul: 0.8 }, ground: [0.62, 0.72, 0.58], amp: 1.6, rock: 1.0, trees: { density: 1.1, pine: 0.9 }, buildings: 'none' },
    snow:      { id: 'snow',      name: 'Circuito nevado',      env: { time: 'noon', weather: 'snow' }, ground: [1.6, 1.65, 1.8], amp: 0.7, snowGround: true, trees: { density: 1.3, pine: 1.0 }, treeTint: [1.7, 1.8, 1.95], buildings: 'village' },
    future:    { id: 'future',    name: 'Metrópolis futurista', env: { time: 'sunset', sky: [0.12, 0.05, 0.38], hor: [0.95, 0.35, 0.65], fogCol: [0.5, 0.25, 0.55], sat: 1.35, neon: true }, ground: [0.3, 0.32, 0.4], amp: 0.1, trees: { density: 0.0, pine: 0 }, buildings: 'towers', cityDensity: 1.3, neon: true },
    champ:     { id: 'champ',     name: 'Circuito internacional', env: { time: 'noon' }, ground: [0.8, 1.0, 0.7], amp: 0.4, trees: { density: 0.9, pine: 0.3 }, buildings: 'village' }
  };

  /* circuits: rounded rectangles with different proportions, corner radius, elevation and lateral sway */
  var CIRCUITS = {
    c1:  { HX: 640, HZ: 640, CR: 170, hgt: [0, 2.5, 4, 2.5],   bump: [0, 0, 0, 0] },        // the original square circuit
    c2:  { HX: 700, HZ: 560, CR: 150, hgt: [0, 2, 3, 1],       bump: [0, 30, -30, 25] },
    c3:  { HX: 760, HZ: 620, CR: 200, hgt: [0, 1, 2, 1],       bump: [0, 40, -40, 30] },
    c4:  { HX: 600, HZ: 600, CR: 140, hgt: [0, 8, 14, 6],      bump: [0, 35, -35, 30] },
    c5:  { HX: 800, HZ: 500, CR: 180, hgt: [0, 3, 5, 2],       bump: [0, 30, -30, 20] },
    c6:  { HX: 560, HZ: 560, CR: 130, hgt: [0, 2, 3, 1.5],     bump: [0, 20, -20, 25] },
    c7:  { HX: 680, HZ: 680, CR: 160, hgt: [0, 12, 22, 10],    bump: [0, 45, -45, 35] },
    c8:  { HX: 620, HZ: 620, CR: 150, hgt: [0, 6, 10, 4],      bump: [0, 25, -35, 30] },
    c9:  { HX: 820, HZ: 640, CR: 210, hgt: [0, 3, 6, 3],       bump: [0, 0, 0, 0] },
    c10: { HX: 900, HZ: 700, CR: 190, hgt: [0, 4, 6, 3],       bump: [0, 20, -20, 15] }
  };

  /* lapT = target best-lap time (s) for star 2; = AI flying lap of the circuit (0.97 skill, Vortex) + a margin that shrinks from 14 s (level 1) to 2 s (level 10); see tests/levels.test.js */
  var LEVELS = [
    { id: 1,  name: 'Debut urbano',        scene: 'city',      circuit: 'c1',  laps: 3, rivals: 4, diff: 'easy',   place: 4, lapT: 109, clean: 6,  items: 2 },
    { id: 2,  name: 'Fiebre tropical',     scene: 'tropical',  circuit: 'c2',  laps: 3, rivals: 4, diff: 'easy',   place: 3, lapT: 109, clean: 6,  items: 2 },
    { id: 3,  name: 'Espejismo',           scene: 'desert',    circuit: 'c3',  laps: 3, rivals: 4, diff: 'normal', place: 3, lapT: 110, clean: 6,  items: 2 },
    { id: 4,  name: 'Sendero del bosque',  scene: 'forest',    circuit: 'c4',  laps: 3, rivals: 4, diff: 'normal', place: 3, lapT: 105, clean: 5,  items: 3 },
    { id: 5,  name: 'Rumbo al mar',        scene: 'coast',     circuit: 'c5',  laps: 3, rivals: 4, diff: 'normal', place: 3, lapT: 105, clean: 5,  items: 3 },
    { id: 6,  name: 'Neón nocturno',       scene: 'night',     circuit: 'c6',  laps: 4, rivals: 4, diff: 'hard',   place: 3, lapT: 99, clean: 5,  items: 3 },
    { id: 7,  name: 'Cumbre',              scene: 'mountains', circuit: 'c7',  laps: 4, rivals: 4, diff: 'hard',   place: 2, lapT: 109, clean: 4,  items: 3 },
    { id: 8,  name: 'Hielo y nieve',       scene: 'snow',      circuit: 'c8',  laps: 4, rivals: 4, diff: 'hard',   place: 2, lapT: 101, clean: 4,  items: 4 },
    { id: 9,  name: 'Metrópolis 2099',     scene: 'future',    circuit: 'c9',  laps: 4, rivals: 4, diff: 'pro',    place: 2, lapT: 105, clean: 4,  items: 4 },
    { id: 10, name: 'Gran Premio Mundial', scene: 'champ',     circuit: 'c10', laps: 5, rivals: 4, diff: 'pro',    place: 1, lapT: 113, clean: 3,  items: 4 }
  ];
  LEVELS.forEach(function (L) {
    L.circuitDef = CIRCUITS[L.circuit];
    L.objectives = [
      { id: 'place', text: 'Terminar entre los ' + L.place + ' primeros' + (L.place === 1 ? ' (ganar)' : ''), n: L.place },
      { id: 'lap', text: 'Vuelta rápida de ' + L.lapT + ' s o menos', n: L.lapT },
      { id: 'clean', text: 'Como máximo ' + L.clean + ' choques fuertes', n: L.clean }
    ];
    L.unlock = L.id === 1 ? 'Disponible desde el inicio' : 'Completa el nivel ' + (L.id - 1);
    L.reward = '+' + (50 + L.id * 10) + ' pts al completarlo, +10 pts por estrella' + (L.id === 10 ? ' · Título de Campeón' : ' · Desbloquea el nivel ' + (L.id + 1));
  });

  var KEY = 'jr_levels_v1';
  function emptyProgress() { return { v: 1, stars: {}, done: {}, best: {} }; }
  function store(backend) {
    var st = backend || (function () { try { return localStorage; } catch (e) { return null; } })();
    return {
      load: function () { try { var o = JSON.parse(st.getItem(KEY)); if (o && o.v === 1 && o.stars && o.done) return o; } catch (e) { } return emptyProgress(); },
      save: function (p) { try { st.setItem(KEY, JSON.stringify(p)); } catch (e) { } }
    };
  }
  function isUnlocked(p, id) { return id >= 1 && id <= LEVELS.length && (id === 1 || !!p.done[id - 1]); }
  function totalStars(p) { var n = 0; for (var k in p.stars) n += p.stars[k] || 0; return n; }
  function points(p) { var t = 0; LEVELS.forEach(function (L) { if (p.done[L.id]) t += 50 + L.id * 10 + 10 * (p.stars[L.id] || 0); }); return t; }

  /* result = { place, bestLap, heavyHits, finished } -> { stars:[bool,bool,bool], completed } */
  function evaluate(level, r) {
    var ok = !!r.finished, res = [
      ok && r.place <= level.place,
      ok && r.bestLap != null && r.bestLap <= level.lapT,
      ok && r.heavyHits <= level.clean
    ];
    return { stars: res, completed: res[0] };
  }
  /* records a finished race; returns { newlyDone, unlocked: id|null, stars, points } */
  function record(p, level, r) {
    var ev = evaluate(level, r), n = ev.stars.filter(Boolean).length, was = !!p.done[level.id], unlocked = null;
    if (ev.completed) {
      p.done[level.id] = true;
      if (!was && level.id < LEVELS.length) unlocked = level.id + 1;
    }
    p.stars[level.id] = Math.max(p.stars[level.id] || 0, n);
    if (r.bestLap != null) p.best[level.id] = Math.min(p.best[level.id] || 1e9, r.bestLap);
    return { eval: ev, stars: n, newlyDone: ev.completed && !was, unlocked: unlocked, points: points(p) };
  }

  JR.levels = { LEVELS: LEVELS, SCENES: SCENES, CIRCUITS: CIRCUITS, COUNT: LEVELS.length, store: store, emptyProgress: emptyProgress, isUnlocked: isUnlocked,
    totalStars: totalStars, points: points, evaluate: evaluate, record: record, byId: function (id) { return LEVELS[id - 1] || null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
