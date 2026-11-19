/* JIMMY RACING - item boxes + items (turbo, missile, trap, shield, double turbo). Runs inside the Sim (single player).
 * State per car:  car.item (null | type), car.boostT, car.boostQ (queued double-turbo bursts), car.shieldT, car.slowT, car.slowCap0
 */
(function () {
  'use strict';
  var JR = (typeof window !== 'undefined' ? (window.JR = window.JR || {}) : (globalThis.JR = globalThis.JR || {}));
  var U = JR.util, clamp = U.clamp;

  var TYPES = ['turbo', 'missile', 'trap', 'shield', 'double'];
  var NAMES = { turbo: 'TURBO', missile: 'PROYECTIL', trap: 'TRAMPA', shield: 'ESCUDO', double: 'TURBO DOBLE' };
  var C = {
    BOX_RESPAWN: 7, BOX_R: 2.6,
    TURBO_T: 2.6, TURBO_ACC: 17, TURBO_VMAX: 72,
    DOUBLE_T: 1.25, DOUBLE_GAP: 0.55, DOUBLE_ACC: 21,
    SHIELD_T: 7,
    SLOW_T: 3.0, SLOW_FRAC: 0.5, MISSILE_LIFE: 4.5, MISSILE_R: 2.3,
    TRAP_LIFE: 22, TRAP_R: 2.3
  };

  function generateBoxes(track, seed, obstacles) {
    var L = track.length, out = [], runs = [], inRun = false, a = 0, s;
    for (s = 0; s < L; s += 20) {
      var k = Math.abs(track.k[Math.floor(s / track.ds) % track.N]);
      if (k < 0.0007) { if (!inRun) { inRun = true; a = s; } } else if (inRun) { inRun = false; runs.push([a, s]); }
    }
    if (inRun) runs.push([a, L]);
    var TUN = track.features && track.features.tunnel;
    function clear(s2) { if (TUN && s2 > TUN.s0 - 60 && s2 < TUN.s1 + 20) return false; return !obstacles || obstacles.every(function (o) { var ds = Math.abs(o.s - s2); ds = Math.min(ds, L - ds); return ds > (o.parts ? 6 : 12); }); }
    function row(s2, n) {
      for (var t = 0; t < 40 && !clear(s2); t++) s2 += 6;
      var ds = n === 3 ? [-5.2, 0, 5.2] : [-3.2, 3.2];
      ds.forEach(function (d) { var p = track.pointAt(s2, d); out.push({ id: out.length, x: p.x, z: p.z, y: p.y + 1.35, s: s2, d: d, on: true, t: 0 }); });
    }
    runs.forEach(function (rn) {
      var s0 = Math.max(rn[0] + 40, 170), s1 = Math.min(rn[1] - 20, L - 260);
      if (s1 - s0 < 260) return;
      var len = s1 - s0;
      row(s0 + len * 0.22, 3); row(s0 + len * 0.66, 3); row(s1 - 210, 2);
    });
    // a row right after the start line so the first lap offers items early
    row(300, 3);
    return out;
  }

  function init(sim, seed) {
    sim.itemBoxes = generateBoxes(sim.track, seed, sim.obstacles);
    sim.projectiles = []; sim.traps = []; sim.itemRng = U.makeRng((seed || 7) + 99);
  }
  function resetCar(car) { car.item = null; car.boostT = 0; car.boostQ = 0; car.boostGap = 0; car.boostAcc = C.TURBO_ACC; car.shieldT = 0; car.slowT = 0; car.slowCap0 = 0; car.itemWait = 0; car.itemUsed = 0; car.itemCd = 0; car.itemThink = 0; car.itemHold = 0; }

  function pickType(sim, car) {
    // rubber-banded table: leaders get defensive items, those behind get attacking ones
    var rank = 1, i, L = sim.cars.length;
    for (i = 0; i < L; i++) if (sim.cars[i] !== car && sim.cars[i].race && car.race && sim.cars[i].race.place < car.race.place) rank++;
    var w = rank <= 1 ? { turbo: 2, missile: 1, trap: 3, shield: 3, double: 1 } : (rank >= L ? { turbo: 3, missile: 3, trap: 1, shield: 1, double: 3 } : { turbo: 3, missile: 2, trap: 2, shield: 2, double: 2 });
    var tot = 0; TYPES.forEach(function (t) { tot += w[t]; });
    var r = sim.itemRng() * tot;
    for (i = 0; i < TYPES.length; i++) { r -= w[TYPES[i]]; if (r <= 0) return TYPES[i]; }
    return 'turbo';
  }

  function use(sim, car) {
    var it = car.item; if (!it || car.itemCd > 0) return false;
    var v = car.vehicle, h = v.heading, fx = Math.sin(h), fz = Math.cos(h);
    car.item = null; car.itemCd = 0.4; car.itemUsed++;
    if (it === 'turbo') { car.boostT = C.TURBO_T; car.boostAcc = C.TURBO_ACC; }
    else if (it === 'double') { car.boostT = C.DOUBLE_T; car.boostQ = 1; car.boostAcc = C.DOUBLE_ACC; }
    else if (it === 'shield') car.shieldT = C.SHIELD_T;
    else if (it === 'missile') {
      var l = v.loc;
      sim.projectiles.push({ x: v.x + fx * (v.spec.length * 0.5 + 1.5), z: v.z + fz * (v.spec.length * 0.5 + 1.5), y: v.y + 0.5, s: l.s + v.spec.length * 0.5 + 1.5, d: l.d, owner: car, speed: Math.max(75, v.vx + 38), life: C.MISSILE_LIFE, age: 0, target: null });
    } else if (it === 'trap') {
      var bx = v.x - fx * (v.spec.length * 0.5 + 2.4), bz = v.z - fz * (v.spec.length * 0.5 + 2.4);
      sim.traps.push({ x: bx, z: bz, y: v.y, owner: car, life: C.TRAP_LIFE, arm: 0.9, ang: h });
    }
    sim.events.push({ type: 'itemUse', car: car, item: it });
    return true;
  }

  function hitCar(sim, car, by, kind) {
    var v = car.vehicle;
    if (car.shieldT > 0) { car.shieldT = 0; sim.events.push({ type: 'shieldBlock', car: car, by: by, kind: kind }); return false; }
    car.slowT = C.SLOW_T; car.slowDur = C.SLOW_T; car.slowCap0 = Math.max(14, Math.max(0, v.vx) * C.SLOW_FRAC);
    v.r += (sim.itemRng() < 0.5 ? -1 : 1) * 0.9;             // small yaw kick, easily corrected
    sim.events.push({ type: 'itemHit', car: car, by: by, kind: kind, x: v.x, z: v.z, y: v.y + 0.5 });
    return true;
  }

  function step(sim, dt) {
    var cars = sim.cars, i, j, L = sim.track.length;
    // ---- boxes
    for (i = 0; i < sim.itemBoxes.length; i++) {
      var b = sim.itemBoxes[i];
      if (!b.on) { b.t -= dt; if (b.t <= 0) { b.on = true; sim.events.push({ type: 'boxBack', box: b }); } continue; }
      for (j = 0; j < cars.length; j++) {
        var c = cars[j], v = c.vehicle;
        if (c.item || c.human || v.locked) continue;
        var dx = v.x - b.x, dz = v.z - b.z;
        if (dx * dx + dz * dz < C.BOX_R * C.BOX_R) {
          c.item = pickType(sim, c); b.on = false; b.t = C.BOX_RESPAWN;
          c.itemWait = 1.2 + sim.itemRng() * 3.5;               // bots: think time before using it
          sim.events.push({ type: 'itemGet', car: c, item: c.item, box: b }); break;
        }
      }
    }
    // ---- missiles: follow the road, home in on the car ahead
    for (i = sim.projectiles.length - 1; i >= 0; i--) {
      var m = sim.projectiles[i]; m.age += dt; m.life -= dt;
      var tgt = null, best = 1e9;
      for (j = 0; j < cars.length; j++) {
        var cj = cars[j]; if (cj === m.owner || !cj.vehicle.loc) continue;
        var ds = cj.vehicle.loc.s - m.s; if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
        if (ds > -2 && ds < 150 && ds < best) { best = ds; tgt = cj; }
      }
      if (tgt) { var dd = tgt.vehicle.loc.d - m.d; m.d += clamp(dd, -9 * dt, 9 * dt); }
      m.s += m.speed * dt; var lim = sim.track.halfWidthAt(Math.floor(m.s / sim.track.ds)) - 0.8; m.d = clamp(m.d, -lim, lim);
      var p = sim.track.pointAt(m.s, m.d); m.x = p.x; m.z = p.z; m.y = p.y + 0.55; m.heading = p.heading;
      var hit = null;
      for (j = 0; j < cars.length && !hit; j++) {
        var cc = cars[j]; if (cc === m.owner && m.age < 0.6) continue;
        var cv = cc.vehicle, ex = cv.x - m.x, ez = cv.z - m.z;
        if (ex * ex + ez * ez < (C.MISSILE_R + 0.9) * (C.MISSILE_R + 0.9)) hit = cc;
      }
      if (hit) { hitCar(sim, hit, m.owner, 'missile'); sim.events.push({ type: 'boom', x: m.x, y: m.y, z: m.z }); sim.projectiles.splice(i, 1); }
      else if (m.life <= 0) sim.projectiles.splice(i, 1);
    }
    // ---- traps
    for (i = sim.traps.length - 1; i >= 0; i--) {
      var tp = sim.traps[i]; tp.life -= dt; if (tp.arm > 0) tp.arm -= dt;
      var trig = null;
      if (tp.arm <= 0) for (j = 0; j < cars.length && !trig; j++) {
        var tv = cars[j].vehicle, tx = tv.x - tp.x, tz = tv.z - tp.z;
        if (tx * tx + tz * tz < (C.TRAP_R + 0.7) * (C.TRAP_R + 0.7)) trig = cars[j];
      }
      if (trig) { hitCar(sim, trig, tp.owner, 'trap'); sim.events.push({ type: 'boom', x: tp.x, y: tp.y + 0.3, z: tp.z }); sim.traps.splice(i, 1); }
      else if (tp.life <= 0) sim.traps.splice(i, 1);
    }
    // ---- per-car effects
    for (i = 0; i < cars.length; i++) {
      var car = cars[i], vh = car.vehicle;
      if (car.itemCd > 0) car.itemCd -= dt;
      if (car.itemWait > 0) car.itemWait -= dt;
      if (car.shieldT > 0) car.shieldT -= dt;
      if (car.boostT > 0) {
        car.boostT -= dt;
        if (vh.vx > -2 && vh.vx < C.TURBO_VMAX) vh.vx = Math.min(C.TURBO_VMAX, vh.vx + car.boostAcc * dt);
        if (car.boostT <= 0 && car.boostQ > 0) { car.boostGap = C.DOUBLE_GAP; car.boostQ = 0; }
      } else if (car.boostGap > 0) {
        car.boostGap -= dt;
        if (car.boostGap <= 0) { car.boostT = C.DOUBLE_T; car.boostAcc = C.DOUBLE_ACC; sim.events.push({ type: 'boost2', car: car }); }
      }
      if (car.slowT > 0) {
        car.slowT -= dt;
        var f = clamp(car.slowT / (car.slowDur || C.SLOW_T), 0, 1), cap = car.slowCap0 + (1 - f) * 120;
        if (vh.vx > cap) vh.vx -= Math.min(vh.vx - cap, 30 * dt);
      }
    }
  }

  /* ---------------- bot strategies (different styles, delayed + conditional -> never constant, never unfair) */
  function botDecide(sim, car) {
    if (!car.item || car.human || car.isPlayer || car.itemWait > 0 || car.itemCd > 0) return;
    if (car.itemThink > 0) { car.itemThink -= 1 / 120; return; }
    car.itemThink = 0.45; car.itemHold = (car.itemHold || 0) + 0.45;      // evaluate every ~0.45 s, not every frame
    var v = car.vehicle, l = v.loc; if (!l) return;
    var style = (car.ai && car.ai.itemStyle) || 'balanced', L = sim.track.length, it = car.item, ahead = null, aheadDs = 1e9, behind = null, behindDs = 1e9, j;
    var kk = Math.abs(sim.track.k[l.i]), kF = Math.abs(sim.track.k[(l.i + Math.round((20 + v.vx * 1.2) / sim.track.ds)) % sim.track.N]);
    var straight = kk < 0.0012 && kF < 0.0012;
    for (j = 0; j < sim.cars.length; j++) {
      var o = sim.cars[j]; if (o === car || !o.vehicle.loc) continue;
      var ds = o.vehicle.loc.s - l.s; if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      if (ds > 0 && ds < aheadDs) { aheadDs = ds; ahead = o; }
      if (ds < 0 && -ds < behindDs) { behindDs = -ds; behind = o; }
    }
    var lat = ahead ? Math.abs(ahead.vehicle.loc.d - l.d) : 99, go = false, chance = sim.itemRng();
    if (it === 'turbo' || it === 'double') go = straight && v.vx > 25 && (style === 'aggressive' || chance < 0.5);
    else if (it === 'missile') go = !!ahead && aheadDs > 12 && aheadDs < (style === 'aggressive' ? 110 : 70) && lat < 6 && chance < (style === 'aggressive' ? 0.7 : 0.4);
    else if (it === 'trap') go = !!behind && behindDs < 28 && (style === 'defensive' || chance < 0.45);
    else if (it === 'shield') go = (!!behind && behindDs < 45) || (style === 'defensive' && !!ahead && aheadDs < 30);
    if (!go && car.itemHold > 14) go = it !== 'missile' || !!ahead;       // never hoard forever
    if (go) { car.itemHold = 0; use(sim, car); }
  }
  function botStep(sim) { for (var i = 0; i < sim.cars.length; i++) if (!sim.cars[i].isPlayer && !sim.cars[i].human) botDecide(sim, sim.cars[i]); }

  JR.items = { TYPES: TYPES, NAMES: NAMES, C: C, init: init, resetCar: resetCar, step: step, use: use, botStep: botStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
