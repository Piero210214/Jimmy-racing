/* JIMMY RACING - physical road obstacles (cones, barrels, tyre stacks, plastic blocks, movable barriers, concrete blocks).
 * Deterministic generation from the track; simulated inside the (server or local) Sim.
 * Every obstacle is one or more circles on the ground (x,z). Movable ones carry mass + velocity and are pushed by the cars'
 * collision circles with an impulse model; static ones (concrete) behave like a wall that stops the car.
 * Layout rule: the road is never blocked - every cluster leaves a clear corridor of >= 6 m.
 */
(function () {
  'use strict';
  var JR = (typeof window !== 'undefined' ? (window.JR = window.JR || {}) : (globalThis.JR = globalThis.JR || {}));
  var U = JR.util, clamp = U.clamp;

  /* kind: radius (collision), mass (kg), friction decel (m/s^2), damage factor to a car, restitution */
  var KINDS = {
    cone:   { r: 0.26, m: 4,    fr: 22.0, dmg: 0.0,  e: 0.3,  label: 'Cono' },
    barrel: { r: 0.36, m: 28,   fr: 14.0, dmg: 0.25, e: 0.35, label: 'Barril' },
    tyres:  { r: 0.52, m: 90,   fr: 14.0, dmg: 0.4,  e: 0.25, label: 'Neumáticos' },
    plastic:{ r: 0.62, m: 55,   fr: 12.0, dmg: 0.3,  e: 0.3,  label: 'Bloque de plástico' },
    barrier:{ r: 0.78, m: 140,  fr: 12.0, dmg: 0.5,  e: 0.25, label: 'Barrera móvil' },
    block:  { r: 0.62, m: 1e9,  fr: 0,   dmg: 1.0,  e: 0.12, label: 'Bloque de hormigón', stat: true }
  };

  function make(kind, x, z, y, ang, extra) {
    var K = KINDS[kind], o = {
      k: kind, x: x, z: z, y: y, ang: ang || 0, r: K.r, m: K.m, stat: !!K.stat,
      vx: 0, vz: 0, ox: x, oz: z, tilt: 0, tiltDir: 0, hitT: 0, moved: false, s: 0, d: 0, color: 0, parts: null
    };
    if (extra) for (var q in extra) o[q] = extra[q];
    return o;
  }

  function generate(track, seed) {
    var rng = U.makeRng(seed || 4242), L = track.length, out = [], i;
    // 1) straights: runs where the curvature stays tiny
    var runs = [], inRun = false, a = 0, STEP = 20;
    for (var s = 0; s < L; s += STEP) {
      var k = Math.abs(track.k[Math.floor(s / track.ds) % track.N]);
      if (k < 0.0007) { if (!inRun) { inRun = true; a = s; } }
      else if (inRun) { inRun = false; runs.push([a, s]); }
    }
    if (inRun) runs.push([a, L]);
    var TUN = track.features && track.features.tunnel;
    function place(kind, s2, d, ang, extra) {
      if (TUN && s2 > TUN.s0 - 150 && s2 < TUN.s1 + 20) return null;      // keep the tunnel and its approach clear
      var p = track.pointAt(s2, d), o = make(kind, p.x, p.z, p.y, ang == null ? p.heading : ang, extra);
      o.s = s2; o.d = d; out.push(o); return o;
    }
    var colors = [0, 1, 2, 3];                                   // plastic blocks: orange / yellow / blue / green
    runs.forEach(function (rn, ri) {
      var s0 = Math.max(rn[0] + 40, 170), s1 = Math.min(rn[1] - 20, L - 260);
      if (s1 - s0 < 260) return;
      var len = s1 - s0, half = track.halfWidthAt(Math.floor(((s0 + s1) / 2) / track.ds)) - 1.6, side = ri % 2 ? 1 : -1, j;
      // zig-zag of cones
      var zs = s0 + len * 0.12;
      for (j = 0; j < 6; j++) place('cone', zs + j * 15, (j % 2 ? 1 : -1) * 3.4);
      // barrel cluster in one lane
      var bs = s0 + len * 0.30, bd = side * (half - 3.2);
      for (j = 0; j < 4; j++) place('barrel', bs + (j % 2) * 1.3, bd + (j < 2 ? -0.55 : 0.55));
      // two coloured plastic blocks in different lanes (corridor left in the middle)
      var ps = s0 + len * 0.45;
      place('plastic', ps, -4.6, null, { color: colors[(ri) % 4] });
      place('plastic', ps + 14, 4.8, null, { color: colors[(ri + 1) % 4] });
      place('plastic', ps + 28, -3.6, null, { color: colors[(ri + 2) % 4] });
      // stacked tyres near the other edge
      var ts = s0 + len * 0.58, td = -side * (half - 2.4);
      place('tyres', ts, td); place('tyres', ts + 1.4, td + 0.5 * side); place('tyres', ts + 40, td);
      // small movable barriers, staggered in two lanes
      var ms = s0 + len * 0.70;
      place('barrier', ms, 4.2, null); place('barrier', ms + 22, -4.2, null);
      // before the corner: braking-zone cones in a lane + concrete blocks on the edge
      var cs = s1 - 130;
      for (j = 0; j < 4; j++) place('cone', cs + j * 9, side * 5.2);
      var bl = s1 - 55;
      place('block', bl, -side * (half - 2.1), null, { parts: [-1.0, 0, 1.0], len: 2.6 });
      place('block', bl + 36, -side * (half - 2.1), null, { parts: [-1.0, 0, 1.0], len: 2.6 });
    });
    // initial locate info
    out.forEach(function (o, n) { o.id = n; });
    return out;
  }

  /* integrate movable obstacles; keep them inside the guard rails */
  function step(sim, dt) {
    var list = sim.obstacles, track = sim.track;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.stat) continue;
      if (o.hitT > 0) o.hitT -= dt;
      var sp2 = o.vx * o.vx + o.vz * o.vz;
      if (sp2 < 1e-4) { o.vx = o.vz = 0; continue; }
      var sp = Math.sqrt(sp2), K = KINDS[o.k], dec = Math.min(sp, K.fr * dt);
      o.vx -= o.vx / sp * dec; o.vz -= o.vz / sp * dec;
      o.x += o.vx * dt; o.z += o.vz * dt; o.moved = true;
      o.ang += (o.spin || 0) * dt; if (o.spin) o.spin *= (1 - Math.min(1, 1.5 * dt));
      var l = track.locate(o.x, o.z, o.hint == null ? -1 : o.hint, o.loc || (o.loc = {}));
      o.hint = l.i; o.y = l.y; o.s = l.s; o.d = l.d;
      var bd = track.barrierDistAt(l.i, l.d) - o.r;
      if (Math.abs(l.d) > bd) {                       // reached the guard rail: stop there
        var sg = l.d > 0 ? 1 : -1, over = Math.abs(l.d) - bd;
        o.x -= l.lx * sg * over; o.z -= l.lz * sg * over; o.vx *= 0.2; o.vz *= 0.2;
      }
    }
  }

  /* resolve every car circle against the obstacles (called from Sim.collide with the sim helpers) */
  function collide(sim, H) {
    var list = sim.obstacles, cars = sim.cars, n = list.length;
    for (var a = 0; a < cars.length; a++) {
      var C = cars[a], v = C.vehicle;
      if (v.locked) continue;
      var cs = H.circleCenters(v);
      for (var i = 0; i < n; i++) {
        var o = list[i], K = KINDS[o.k];
        var ddx = o.x - v.x, ddz = o.z - v.z;
        var near = (o.stat ? 3.5 : 0) + 4.0 + v.spec.length * 0.5;
        if (ddx * ddx + ddz * ddz > near * near) continue;
        var offs = o.parts || [0];
        for (var ci = 0; ci < 3; ci++) {
          for (var pi = 0; pi < offs.length; pi++) {
            var pc = cs[ci], ox = o.x, oz = o.z;
            if (o.parts) { ox += Math.sin(o.ang) * offs[pi] * 1.0; oz += Math.cos(o.ang) * offs[pi] * 1.0; }
            var dx = pc.x - ox, dz = pc.z - oz, dist = Math.sqrt(dx * dx + dz * dz), minD = H.R + o.r;
            if (dist >= minD || dist < 1e-6) continue;
            var nx = dx / dist, nz = dz / dist, pen = minD - dist;
            var mC = v.spec.mass, mO = o.m;
            var wC = o.stat ? 1 : mO / (mC + mO), wO = o.stat ? 0 : mC / (mC + mO);
            v.x += nx * pen * wC; v.z += nz * pen * wC;
            if (!o.stat) { o.x -= nx * pen * wO; o.z -= nz * pen * wO; }
            var w = H.worldVel(v), rx = pc.x - v.x, rz = pc.z - v.z;
            var pvx = w.x + v.r * rz, pvz = w.z - v.r * rx;
            var vn = (pvx - o.vx) * nx + (pvz - o.vz) * nz;
            if (vn >= 0) continue;
            var cr = rz * nx - rx * nz;
            var denom = 1 / mC + (o.stat ? 0 : 1 / mO) + cr * cr / v.Iz;
            var j = -(1 + K.e) * vn / denom;
            // light scraping friction so the car does not spin wildly on soft objects
            var tx = -nz, tz = nx, vt = (pvx - o.vx) * tx + (pvz - o.vz) * tz;
            var jt = clamp(-vt * 0.08 * (o.stat ? mC : Math.min(mC, mO)), -0.2 * j, 0.2 * j);
            var Jx = j * nx + jt * tx, Jz = j * nz + jt * tz;
            H.setBodyVel(v, w.x + Jx / mC, w.z + Jz / mC);
            v.r += (Jx * rz - Jz * rx) / v.Iz;
            if (!o.stat) {
              o.vx -= Jx / mO; o.vz -= Jz / mO;
              var spd = Math.hypot(o.vx, o.vz);
              o.hitT = 1.2; o.moved = true;
              o.spin = (o.spin || 0) + (cr > 0 ? -1 : 1) * Math.min(8, -vn * 0.8) * (o.k === 'cone' || o.k === 'plastic' ? 1 : 0.3);
              if ((o.k === 'cone' && -vn > 2.5) || (o.k === 'barrel' && -vn > 5)) { o.tilt = 1.45; o.tiltDir = Math.atan2(o.vx, o.vz); }
              if (o.k === 'plastic' && -vn > 6) { o.tilt = Math.min(1.2, -vn * 0.1); o.tiltDir = Math.atan2(o.vx, o.vz); }
              if (spd > 0.05) o.hint = o.hint == null ? -1 : o.hint;
            }
            var sev = Math.min(1.5, (-vn) / 12) * K.dmg;
            if (-vn > 1.5) {
              if (sev > 0.02) H.addDamage(C, H.localPoint(v, ox + nx * o.r, oz + nz * o.r), sev);
              sim.events.push({ type: 'hit', car: C, other: null, obst: o.k, soft: K.dmg < 0.3, speed: (K.dmg < 0.3 ? -vn * 0.5 : -vn), x: ox, z: oz, y: v.y + 0.4, lp: H.localPoint(v, ox, oz), wall: false });
            }
          }
        }
      }
    }
  }

  JR.obstacles = { KINDS: KINDS, generate: generate, step: step, collide: collide };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
