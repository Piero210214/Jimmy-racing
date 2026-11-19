/* JIMMY RACING - debris_gfx.js : crash debris (body shards, bumper/mirror pieces, rail splinters, obstacle bits) + the
 * non-graphic "pilot thrown out" animation. Purely visual: the physics decision (who is ejected, for how long) lives in sim.js.
 * Thresholds on the impact speed (normal component, m/s):  >= 6 shards + sparks | >= 12 + chunks / mirror / rail bits |
 * >= 20 (EJECT) + big panels, dust and the pilot animation (exactly 3.0 s, then the pilot is back in the car).
 * Everything temporary is removed after ~10 s (the last second it shrinks away) and capped at MAX pieces. */
(function () {
  'use strict';
  var JR = window.JR, U = JR.util, clamp = U.clamp, Geo = JR.gl.Geo, P = JR.gl.P, A = JR.gl.A;
  var MAX = 90, LIFE = 10, EJECT_TIME = 3.0;
  function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1]; }
  function mk(R, g, base, metal, rough) { return { mesh: R.eng.mesh(g), mat: R.material({ tex: 'white', base: base || [1, 1, 1, 1], rough: rough == null ? 0.55 : rough, metal: metal || 0 }) }; }

  function DebrisGfx(R) {
    var self = this; this.R = R; this.list = []; this.pilots = []; this.xf = new Float32Array(12); this.tmp = {}; this.rng = U.makeRng(99);
    this.stats = { spawned: 0, pilotsStarted: 0, pilotsEnded: 0 }; this.cool = new Map();
    var W = [1, 1, 1, 1];
    this.M = {
      shard: mk(R, P.box(0.28, 0.025, 0.17, W), null, 0.35, 0.35), panel: mk(R, P.box(0.62, 0.035, 0.38, W), null, 0.35, 0.35), chunk: mk(R, P.box(0.34, 0.2, 0.26, W), null, 0.2, 0.5),
      mirror: mk(R, P.box(0.2, 0.12, 0.1, W), null, 0.5, 0.3), rail: mk(R, P.box(0.95, 0.1, 0.035, W), [0.62, 0.64, 0.68, 1], 0.9, 0.35), bit: mk(R, P.box(0.14, 0.1, 0.12, W), null, 0, 0.8),
      head: mk(R, P.sphere(0.13, 12, 8, W, 1.0), [0.95, 0.95, 0.97, 1], 0.1, 0.25), torso: mk(R, P.box(0.34, 0.5, 0.2, W), null, 0, 0.8), limb: mk(R, P.box(0.11, 0.42, 0.11, W), null, 0, 0.8), visor: mk(R, P.box(0.2, 0.07, 0.04, W), [0.03, 0.04, 0.06, 1], 0.8, 0.1)
    };
    this.layer = { drawShadow: function (R2) { self._draw(R2, true); }, drawOpaque: function (R2) { self._draw(R2, false); } };
    R.addLayer(this.layer);
  }
  DebrisGfx.prototype.clear = function () { this.list.length = 0; this.pilots.length = 0; this.cool.clear(); };

  DebrisGfx.prototype._piece = function (kind, x, y, z, vx, vy, vz, tint, sc) {
    if (this.list.length >= MAX) this.list.shift();
    var r = this.rng;
    this.list.push({ k: kind, x: x, y: y, z: z, vx: vx, vy: vy, vz: vz, yaw: r() * 6.28, pit: r() * 6.28, rol: r() * 6.28, wy: (r() - 0.5) * 14, wp: (r() - 0.5) * 14, wr: (r() - 0.5) * 14, age: 0, rest: false, tint: tint, sc: sc || 1 });
    this.stats.spawned++;
  };
  /* events: hit / eject / ejectEnd (same objects the sim / net layer produce) */
  DebrisGfx.prototype.events = function (ev, ctx) {
    if (!ev) return;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'hit') this._hit(e, ctx);
      else if (e.type === 'eject') this._startPilot(e);
      else if (e.type === 'ejectEnd') this._endPilot(e.car);
    }
  };
  DebrisGfx.prototype._hit = function (e, ctx) {
    var v = e.speed || 0, car = e.car; if (e.quiet || v < 6 || !car) return;
    var now = this.R.time || 0, last = this.cool.get(car) || -9; if (ctx.nowT - last < 0.18) return; this.cool.set(car, ctx.nowT);
    var r = this.rng, body = rgb(car.color == null ? 0xc8102e : car.color), n, k, sp = clamp(v / 8, 0.8, 3.2), fx = ctx.fx;
    var vv = car.vehicle, away = Math.atan2(vv.x - e.x, vv.z - e.z), ax = Math.sin(away), az = Math.cos(away), gy = e.y - 0.3;
    function spray(kind, cnt, tint, spd, up, sc) { for (var q = 0; q < cnt; q++) { var a = away + (r() - 0.5) * 2.2; this._piece(kind, e.x, e.y, e.z, Math.sin(a) * spd * (0.4 + r()) + (vv.vx || 0) * 0.1, up * (0.5 + r()), Math.cos(a) * spd * (0.4 + r()), tint, sc); } }
    spray = spray.bind(this);
    n = v >= 12 ? 8 : 4; spray('shard', n, body, sp * 3.2, 3.5, 1);                          // tier 1: body shards
    if (e.wall) { var tun = ctx.world && ctx.world.inTunnel && ctx.world.inTunnel(vv.loc ? vv.loc.s : 0); if (tun) spray('bit', 4, [0.55, 0.55, 0.52, 1], sp * 2.5, 3, 1.6); else if (v >= 10) spray('rail', v >= 20 ? 3 : 2, [1, 1, 1, 1], sp * 2.2, 2.5, 1); }
    else if (e.obst) { var oc = { cone: [1, 0.42, 0.05, 1], barrel: [0.9, 0.12, 0.08, 1], tyres: [0.06, 0.06, 0.06, 1], plastic: [0.95, 0.75, 0.05, 1], barrier: [0.9, 0.9, 0.9, 1], block: [0.55, 0.55, 0.52, 1] }[e.obst] || [0.8, 0.8, 0.8, 1]; if (v >= 8) spray('bit', e.obst === 'block' ? 6 : 4, oc, sp * 2.2, 3, 1.2); }
    if (v >= 12) { spray('chunk', 2, [0.07, 0.07, 0.08, 1], sp * 2.6, 3.2, 1); spray('mirror', 1, [0.05, 0.05, 0.06, 1], sp * 3, 3.5, 1); }   // tier 2: bumper chunks + mirror
    if (v >= 20) { spray('panel', 3, body, sp * 2.4, 4, 1.15); if (fx) for (k = 0; k < 7; k++) fx.spawn(0, e.x, e.y, e.z, ax * (1 + r() * 3) + (r() - 0.5) * 3, 0.8 + r() * 1.6, az * (1 + r() * 3) + (r() - 0.5) * 3, 1.2 + r() * 1.2, 0.5 + r() * 0.5, 1.4, 0.5, 0.46, 0.4, 0.5, 1.0, -0.15); }   // tier 3
    else if (v >= 10 && fx) for (k = 0; k < 3; k++) fx.spawn(0, e.x, e.y, e.z, (r() - 0.5) * 2, 0.6 + r(), (r() - 0.5) * 2, 0.8 + r() * 0.6, 0.35, 1.0, 0.55, 0.5, 0.45, 0.4, 1.0, -0.1);
  };
  DebrisGfx.prototype._startPilot = function (e) {
    var c = e.car; if (!c) return; for (var i = 0; i < this.pilots.length; i++) if (this.pilots[i].car === c) return;   // never two pilots for one car
    var v = c.vehicle, side = ((c.id | 0) % 2) ? 1 : -1, sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    this.pilots.push({ car: c, t: 0, side: side, sx: v.x, sy: v.y, sz: v.z, hd: v.heading, color: rgb(c.color == null ? 0xc8102e : c.color),
      lx: v.x + ch * side * 3.1 + sh * 1.2, lz: v.z - sh * side * 3.1 + ch * 1.2 });
    this.stats.pilotsStarted++;
  };
  DebrisGfx.prototype._endPilot = function (c) {
    for (var i = this.pilots.length - 1; i >= 0; i--) if (this.pilots[i].car === c) { this.pilots.splice(i, 1); this.stats.pilotsEnded++; }
  };
  DebrisGfx.prototype.update = function (dt, ctx) {
    ctx.nowT = (this._now = (this._now || 0) + dt);
    this.events(ctx.events, ctx);
    var i, p, world = ctx.world, tr = ctx.track;
    for (i = this.list.length - 1; i >= 0; i--) {
      p = this.list[i]; p.age += dt;
      if (p.age > LIFE) { this.list.splice(i, 1); continue; }
      if (p.rest) continue;
      p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.yaw += p.wy * dt; p.pit += p.wp * dt; p.rol += p.wr * dt;
      var gy = world && world.terrainHeight ? world.terrainHeight(p.x, p.z) : 0; if (tr) { var l = tr.locate(p.x, p.z, -1, this.tmp); if (Math.abs(l.d) < tr.halfWidthAt(l.i) + 1.0) gy = l.y; }
      gy += 0.04;
      if (p.y < gy) { p.y = gy; if (Math.abs(p.vy) < 1.2) { p.vy = 0; } else p.vy *= -0.32; p.vx *= 0.7; p.vz *= 0.7; p.wy *= 0.6; p.wp *= 0.5; p.wr *= 0.5; if (p.vx * p.vx + p.vz * p.vz < 0.2 && p.vy === 0) { p.rest = true; p.pit = 0; p.rol = 0; } }
    }
    for (i = this.pilots.length - 1; i >= 0; i--) { p = this.pilots[i]; p.t += dt; if (p.t > EJECT_TIME + 0.3 || p.car.ejected === null && p.t > 0.2) { this.pilots.splice(i, 1); this.stats.pilotsEnded++; } }
    this.stats.active = this.list.length;
  };
  DebrisGfx.prototype._draw = function (R, shadow) {
    var i, p, cp = R.camPos, M = this.M, xf = this.xf;
    for (i = 0; i < this.list.length; i++) {
      p = this.list[i]; var dx = p.x - cp[0], dz = p.z - cp[2]; if (dx * dx + dz * dz > (shadow ? 70 * 70 : 200 * 200)) continue;
      var fade = p.age > LIFE - 1 ? clamp((LIFE - p.age), 0.02, 1) : 1, m = M[p.k];
      A.compose(xf, 0, p.x, p.y, p.z, p.yaw, p.pit, p.rol, p.sc * fade);
      R.drawMesh(m.mesh, xf, null, m.mat, p.tint);
    }
    for (i = 0; i < this.pilots.length; i++) this._drawPilot(R, this.pilots[i]);
  };
  /* pilot pose over the 3 s timeline: 0-0.9 thrown (tumbling arc) · 0.9-2.2 sits dazed, then waves · 2.2-3.0 walks back to the car */
  DebrisGfx.prototype.pilotPose = function (p) {
    var t = p.t, u, x, y, z, tum = 0, phase, v = p.car.vehicle, sh = Math.sin(p.hd), ch = Math.cos(p.hd);
    var doorX = v.x + ch * p.side * 1.1, doorZ = v.z - sh * p.side * 1.1;
    if (t < 0.9) { u = t / 0.9; phase = 'fly'; x = p.sx + (p.lx - p.sx) * u; z = p.sz + (p.lz - p.sz) * u; y = p.sy + 0.8 + 2.3 * 4 * u * (1 - u) - 0.8 * u; tum = u * 9.4; }
    else if (t < 2.2) { phase = t < 1.5 ? 'sit' : 'wave'; x = p.lx; z = p.lz; y = p.sy; }
    else { u = clamp((t - 2.2) / 0.8, 0, 1); phase = 'walk'; x = p.lx + (doorX - p.lx) * u; z = p.lz + (doorZ - p.lz) * u; y = p.sy + Math.abs(Math.sin(u * 14)) * 0.06; }
    return { x: x, y: y, z: z, tum: tum, phase: phase, face: Math.atan2(v.x - x, v.z - z) };
  };
  DebrisGfx.prototype._drawPilot = function (R, p) {
    var M = this.M, xf = this.xf, q = this.pilotPose(p), c = p.color, y0 = q.y, ph = q.phase, hd = q.face, w = Math.sin(p.t * 6);
    var fwd = [Math.sin(hd), Math.cos(hd)];
    function part(m, ox, oy, oz, pitch, roll, tint) {   // offset in the pilot frame (x right, y up, z forward), rotated by facing
      var cs = Math.cos(hd), sn = Math.sin(hd), wx = q.x + ox * cs + oz * sn, wz = q.z - ox * sn + oz * cs;
      A.compose(xf, 0, wx, y0 + oy, wz, hd, pitch, roll, 1); R.drawMesh(m.mesh, xf, null, m.mat, tint);
    }
    var dark = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 1];
    if (ph === 'fly') {                                   // tumbling rigid body (no limbs flailing): torso + head + limbs on one rotating frame
      var a = q.tum, ca = Math.cos(a), sa = Math.sin(a);
      var P3 = function (m, oy, oz, rot, tint) { var yy = oy * ca - oz * sa, zz = oy * sa + oz * ca; part(m, 0, 0.5 + yy, zz, a + rot, 0, tint); };
      P3(M.torso, 0, 0, 0, c); P3(M.head, 0.42, 0, 0, null); P3(M.limb, -0.45, 0, 0, dark); P3(M.limb, -0.45, 0.14, 0.2, dark); P3(M.limb, 0.05, 0.22, 0.3, dark);
      return;
    }
    var sit = ph === 'sit' || ph === 'wave';
    if (sit) {
      part(M.torso, 0, 0.55, 0, -0.18, 0, c); part(M.head, 0, 0.98, 0.04, 0, 0, null); part(M.visor, 0, 0.99, 0.15, 0, 0, null);
      part(M.limb, -0.09, 0.14, 0.32, 1.45, 0, dark); part(M.limb, 0.09, 0.14, 0.32, 1.45, 0, dark);               // legs stretched forward
      part(M.limb, 0.24, 0.62, 0.05, ph === 'wave' ? 2.6 + Math.sin(p.t * 11) * 0.45 : 0.9, 0, c);               // right arm: rests, then waves
      part(M.limb, -0.24, 0.62, 0.05, 0.4, 0, c);
    } else {                                                                                                     // standing / walking back
      var sw = Math.sin(p.t * 16) * 0.5;
      part(M.torso, 0, 0.95, 0, 0, 0, c); part(M.head, 0, 1.4, 0, 0, 0, null); part(M.visor, 0, 1.41, 0.11, 0, 0, null);
      part(M.limb, -0.09, 0.42, 0, sw, 0, dark); part(M.limb, 0.09, 0.42, 0, -sw, 0, dark); part(M.limb, 0.24, 0.95, 0, -sw, 0, c); part(M.limb, -0.24, 0.95, 0, sw, 0, c);
    }
  };
  JR.DebrisGfx = DebrisGfx; JR.DEBRIS = { MAX: MAX, LIFE: LIFE, EJECT_TIME: EJECT_TIME };
})();
