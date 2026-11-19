/* JIMMY RACING - fx.js : particles (tyre smoke, dust, sparks, spray), skid marks, rain / snow, light glows */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var GL = JR.gl, Geo = GL.Geo, S = JR.shaders, U = JR.util, clamp = U.clamp;

  var KIND = { smoke: 0, spark: 1, rain: 2, snow: 3, glow: 4 };
  var SEG_CAP = 5000;

  function Fx(R) {
    var gl = R.gl, eng = R.eng, self = this;
    this.R = R; this.rng = U.makeRng(99);
    var q = R.q;
    this.cap = Math.floor(5200 * Math.max(0.35, q.particles));
    // particle state (SoA)
    var n = this.cap;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n); this.size = new Float32Array(n); this.grow = new Float32Array(n);
    this.col = new Float32Array(n * 4); this.kind = new Uint8Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.alive = 0;
    this.add = true;
    // GPU buffers (12 floats per instance), two batches: alpha + additive
    this.bufA = new Float32Array(n * 12); this.bufB = new Float32Array(n * 12);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.bufA.byteLength, gl.DYNAMIC_DRAW);
    this.vboB = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vboB); gl.bufferData(gl.ARRAY_BUFFER, this.bufB.byteLength, gl.DYNAMIC_DRAW);
    this.vaoA = this._vao(this.vbo); this.vaoB = this._vao(this.vboB);
    this.nA = 0; this.nB = 0;
    // ambient weather particles (camera-relative volume), separate pool so they do not eat the effect budget
    this.wN = Math.floor(2600 * Math.max(0.3, q.particles)); this.w = new Float32Array(this.wN * 4); this.wInit = false;
    this.wBuf = new Float32Array(this.wN * 12); this.wVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.wVbo); gl.bufferData(gl.ARRAY_BUFFER, this.wBuf.byteLength, gl.DYNAMIC_DRAW);
    this.wVao = this._vao(this.wVbo); this.wCount = 0;
    // skid marks
    this.skidOn = q.skid;
    this._initSkids();
    this.last = [];            // last skid point per car/wheel
    this.mats = {
      skid: R.material({ tex: 'white', prog: 'decal', blend: 'alpha', castShadow: false, depthWrite: false, polyOff: [-2, -2], cull: false })
    };
    this.glows = [];
    this.layer = {
      drawTransparent: function (R2) { self._draw(R2); }
    };
    R.addLayer(this.layer);
    this.time = 0; this.sparkAcc = 0;
  }
  Fx.prototype._vao = function (vbo) {
    var gl = this.gl || this.R.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (var i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(i, 1); }
    gl.bindVertexArray(null); return vao;
  };

  /* ---------------------------------------------------------------- skid marks */
  Fx.prototype._initSkids = function () {
    var eng = this.R.eng, g = new Geo(), n = SEG_CAP * 4, i;
    for (i = 0; i < n; i++) g.vert(0, -1000, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
    for (i = 0; i < SEG_CAP; i++) { var b = i * 4; g.quad(b, b + 1, b + 2, b + 3); }
    this.skidMesh = eng.mesh(g, { dynamic: true });
    this.skidV = new Float32Array(n * 8); this.skidC = new Uint8Array(n * 4);
    for (i = 0; i < n; i++) { this.skidV[i * 8 + 1] = -1000; this.skidV[i * 8 + 4] = 1; }
    this.skidHead = 0; this.skidDirtyLo = 1e9; this.skidDirtyHi = -1; this.skidCount = 0;
  };
  Fx.prototype._putSkid = function (x0, y0, z0, x1, y1, z1, w, a) {
    var dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 1e-4) return;
    var nx = -dz / l * w * 0.5, nz = dx / l * w * 0.5, s = this.skidHead, o = s * 4, V = this.skidV, C = this.skidC, k;
    var P = [[x0 - nx, y0, z0 - nz, 0, 0], [x0 + nx, y0, z0 + nz, 1, 0], [x1 + nx, y1, z1 + nz, 1, 1], [x1 - nx, y1, z1 - nz, 0, 1]];
    for (k = 0; k < 4; k++) {
      var v = (o + k) * 8; V[v] = P[k][0]; V[v + 1] = P[k][1]; V[v + 2] = P[k][2]; V[v + 3] = 0; V[v + 4] = 1; V[v + 5] = 0; V[v + 6] = P[k][3]; V[v + 7] = P[k][4];
      C[(o + k) * 4] = 255; C[(o + k) * 4 + 1] = 255; C[(o + k) * 4 + 2] = 255; C[(o + k) * 4 + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    this.skidDirtyLo = Math.min(this.skidDirtyLo, s); this.skidDirtyHi = Math.max(this.skidDirtyHi, s);
    this.skidHead = (s + 1) % SEG_CAP; this.skidCount = Math.min(SEG_CAP, this.skidCount + 1);
  };
  Fx.prototype.clearSkids = function () {
    var V = this.skidV; for (var i = 0; i < SEG_CAP * 4; i++) V[i * 8 + 1] = -1000;
    this.skidDirtyLo = 0; this.skidDirtyHi = SEG_CAP - 1; this.skidHead = 0; this.skidCount = 0; this.last.length = 0;
  };
  Fx.prototype._uploadSkids = function () {
    if (this.skidDirtyHi < 0) return;
    var gl = this.R.gl, lo = this.skidDirtyLo, hi = this.skidDirtyHi, m = this.skidMesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferSubData(gl.ARRAY_BUFFER, lo * 4 * 32, this.skidV, lo * 4 * 8, (hi - lo + 1) * 4 * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.cb); gl.bufferSubData(gl.ARRAY_BUFFER, lo * 16, this.skidC, lo * 16, (hi - lo + 1) * 16);
    this.skidDirtyLo = 1e9; this.skidDirtyHi = -1;
  };

  /* ---------------------------------------------------------------- spawn */
  Fx.prototype.spawn = function (kind, x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, drag, grav) {
    if (this.alive >= this.cap) return;
    var i = this.alive++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.kind[i] = kind; this.drag[i] = drag; this.grav[i] = grav;
  };
  Fx.prototype.sparks = function (x, y, z, vx, vz, n, power) {
    var rng = this.rng, q = this.R.q.particles;
    n = Math.ceil(n * Math.max(0.4, q));
    for (var i = 0; i < n; i++) {
      var sp = (2 + rng() * 9) * (power || 1), a = rng() * 6.283;
      this.spawn(KIND.spark, x, y, z, vx * 0.4 + Math.cos(a) * sp, rng() * 4 * (power || 1), vz * 0.4 + Math.sin(a) * sp, 0.25 + rng() * 0.55, 0.05 + rng() * 0.05, -0.04, 1.0, 0.65 + rng() * 0.3, 0.2, 1, 0.4, 9.8);
    }
    this.spawn(KIND.glow, x, y, z, 0, 0, 0, 0.12, 0.8 + (power || 1) * 0.4, 0, 1, 0.7, 0.3, 0.9, 0, 0);
  };

  /* ---------------------------------------------------------------- per-frame update */
  var _wp = [0, 0, 0];
  Fx.prototype.update = function (dt, ctx) {
    // ctx: {cars:[sim cars], gfx: CarsGfx, env, track, events:[...], camPos, speed, tunnel, paused}
    var R = this.R, rng = this.rng, env = ctx.env, i, k, q = R.q;
    this.time += dt;
    if (ctx.paused) dt = 0;
    // 1. integrate
    var A = this.alive;
    for (i = 0; i < this.alive;) {
      var l = this.life[i] - dt;
      if (l <= 0) { var e = --this.alive; if (i !== e) this._move(e, i); continue; }
      this.life[i] = l;
      var dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.size[i] = Math.max(0.001, this.size[i] + this.grow[i] * dt);
      if (this.kind[i] === KIND.spark && this.py[i] < ctx.groundY) { this.py[i] = ctx.groundY; this.vy[i] *= -0.35; }
      i++;
    }
    // 2. cars: smoke, dust, spray, skid marks, glows
    if (dt > 0 && ctx.cars) for (k = 0; k < ctx.cars.length; k++) this._carFx(ctx.cars[k], ctx, dt);
    // 3. events: sparks
    var ev = ctx.events;
    if (ev) for (i = 0; i < ev.length; i++) {
      var E = ev[i];
      if (E.type === 'hit' && !E.quiet) this.sparks(E.x, E.y, E.z, 0, 0, Math.min(60, 10 + E.speed * 2.2), clamp(E.speed / 14, 0.5, 2));
      else if (E.type === 'scrape') {
        this.sparks(E.x, E.y, E.z, 0, 0, 3, 0.7);
      }
    }
    if (this.debris) { ctx.fx = this; this.debris.update(dt, ctx); }
    // 4. weather volume
    this._weather(dt, ctx);
    // 5. pack
    this._pack(ctx);
    this._uploadSkids();
  };
  Fx.prototype._move = function (a, b) {
    this.px[b] = this.px[a]; this.py[b] = this.py[a]; this.pz[b] = this.pz[a]; this.vx[b] = this.vx[a]; this.vy[b] = this.vy[a]; this.vz[b] = this.vz[a];
    this.life[b] = this.life[a]; this.maxLife[b] = this.maxLife[a]; this.size[b] = this.size[a]; this.grow[b] = this.grow[a];
    for (var c = 0; c < 4; c++) this.col[b * 4 + c] = this.col[a * 4 + c];
    this.kind[b] = this.kind[a]; this.drag[b] = this.drag[a]; this.grav[b] = this.grav[a];
  };

  Fx.prototype._carFx = function (car, ctx, dt) {
    var v = car.vehicle, rng = this.rng, e = ctx.gfx ? ctx.gfx.entryOf(car) : null, env = ctx.env, q = this.R.q.particles;
    var cam = ctx.camPos, dx = v.x - cam[0], dz = v.z - cam[2], d2 = dx * dx + dz * dz;
    if (d2 > 160 * 160) return;
    var M = e ? e.M : null, wr = v.speedKmh > 1 ? 1 : 0, wet = env.wet, surf = v.surfaceNow ? v.surfaceNow.id : 0;
    var sp = Math.abs(v.speedKmh) / 3.6;
    var wheels = e ? e.wxf : null;
    for (var w = 0; w < 4; w++) {
      var rear = w >= 2, skid = rear ? v.skidR : v.skidF;
      var wx, wy, wz;
      if (wheels) { wx = wheels[w][3]; wy = wheels[w][7]; wz = wheels[w][11]; } else { wx = v.x; wy = v.y + 0.3; wz = v.z; }
      var gy = wy - (M ? M.wr : 0.34) + 0.02, key = car.id * 4 + w;
      var marking = skid > 0.35 && surf <= 1 && !v.airborne && sp > 4;
      var last = this.last[key];
      if (marking && this.skidOn) {
        if (last) {
          var seg = Math.hypot(wx - last[0], wz - last[1]);
          if (seg > 0.45) {
            if (seg < 4) this._putSkid(last[0], last[2], last[1], wx, gy, wz, 0.27, clamp((skid - 0.3) * 0.9, 0.12, 0.8));
            last[0] = wx; last[1] = wz; last[2] = gy;
          }
        } else this.last[key] = [wx, wz, gy];
      } else if (last) this.last[key] = null;
      // tyre smoke
      if (skid > 0.4 && surf <= 1 && !v.airborne && sp > 3 && rng() < dt * 60 * clamp(skid, 0, 1) * 0.55 * q) {
        var g = 0.82 + rng() * 0.14;
        this.spawn(KIND.smoke, wx + (rng() - 0.5) * 0.2, gy + 0.1, wz + (rng() - 0.5) * 0.2, (v.worldVx||0) * 0.25 + (rng() - 0.5) * 0.8, 0.5 + rng() * 0.9, (v.worldVz||0) * 0.25 + (rng() - 0.5) * 0.8,
          1.0 + rng() * 1.3, 0.35 + rng() * 0.2, 1.1 + rng() * 0.7, g, g, g * 1.02, 0.3 * clamp(skid, 0.3, 1), 1.3, -0.05);
      }
      // dust on gravel / grass
      if (surf >= 2 && !v.airborne && sp > 5 && rng() < dt * 70 * clamp(sp / 30, 0.2, 1) * q) {
        var gc = surf === 2 ? [0.62, 0.55, 0.43] : [0.35, 0.40, 0.22];
        this.spawn(KIND.smoke, wx + (rng() - 0.5) * 0.3, gy + 0.1, wz + (rng() - 0.5) * 0.3, (v.worldVx||0) * 0.3 + (rng() - 0.5) * 1.6, 0.8 + rng() * 1.6, (v.worldVz||0) * 0.3 + (rng() - 0.5) * 1.6,
          0.9 + rng() * 1.3, 0.3, 1.5 + rng(), gc[0], gc[1], gc[2], 0.34, 1.0, -0.2);
      }
      // wet spray
      if (wet > 0.3 && surf <= 1 && sp > 18 && rear && rng() < dt * 60 * clamp(sp / 60, 0.2, 1) * wet * q) {
        this.spawn(KIND.smoke, wx + (rng() - 0.5) * 0.25, gy + 0.15, wz + (rng() - 0.5) * 0.25, (v.worldVx||0) * 0.1 + (rng() - 0.5) * 1.2, 0.9 + rng() * 1.2, (v.worldVz||0) * 0.1 + (rng() - 0.5) * 1.2,
          0.8 + rng() * 0.8, 0.28, 1.2, 0.75, 0.8, 0.85, 0.16, 1.4, -0.3);
      }
    }
    // damaged car: engine smoke
    if (v.damage > 1.6 && rng() < dt * 25 * q) {
      var fwx = Math.sin(v.heading), fwz = Math.cos(v.heading), hx = v.x + fwx * 1.6, hz = v.z + fwz * 1.6;
      var dk = clamp((v.damage - 1.6) / 2, 0, 1);
      this.spawn(KIND.smoke, hx, v.y + 0.9, hz, (v.worldVx||0) * 0.5 + (rng() - 0.5) * 0.5, 1.2, (v.worldVz||0) * 0.5 + (rng() - 0.5) * 0.5, 1.4 + rng(), 0.3, 0.9, 0.25, 0.25, 0.25, 0.3 + dk * 0.25, 1.0, -0.1);
    }
    // exhaust flame on gear shift / lift (backfire) - subtle, only when revving high and lifting
    if (car.isPlayer && v.rpm > v.spec.rpmRedline * 0.93 && v.throttle < 0.2 && rng() < dt * 12) {
      var bx = v.x - Math.sin(v.heading) * 2.2, bz = v.z - Math.cos(v.heading) * 2.2;
      this.spawn(KIND.spark, bx, v.y + 0.3, bz, (rng() - 0.5) * 2, 0.5, (rng() - 0.5) * 2, 0.12, 0.14, 0.2, 1, 0.55, 0.15, 1, 2, 0);
    }
  };

  /* rain streaks / snow flakes in a box around the camera; wind from env */
  Fx.prototype._weather = function (dt, ctx) {
    var env = ctx.env, cam = ctx.camPos, N = this.wN, w = this.w, rng = this.rng;
    var mode = env.rain > 0 ? 1 : (env.snow > 0 ? 2 : 0);
    this.wCount = 0; this.wMode = mode;
    if (!mode || ctx.tunnel) return;
    var BX = 34, BY = 20, BZ = 34;
    var count = Math.floor(N * (mode === 1 ? 1 : 0.8));
    if (!this.wInit) { for (var i = 0; i < N; i++) { w[i * 4] = (rng() - 0.5) * 2 * BX; w[i * 4 + 1] = rng() * BY; w[i * 4 + 2] = (rng() - 0.5) * 2 * BZ; w[i * 4 + 3] = rng(); } this.wInit = true; }
    var fall = mode === 1 ? 17 : 1.7, wx = env.wind[0] * (mode === 1 ? 1.5 : 1.6), wz = env.wind[1] * (mode === 1 ? 1.0 : 1.0);
    var rx = this.lastCamX == null ? cam[0] : this.lastCamX, rz = this.lastCamZ == null ? cam[2] : this.lastCamZ;
    var mx = cam[0] - rx, mz = cam[2] - rz; this.lastCamX = cam[0]; this.lastCamZ = cam[2];
    for (i = 0; i < count; i++) {
      var o = i * 4;
      w[o] += -mx + wx * dt * (mode === 1 ? 1 : 0.6) + (mode === 2 ? Math.sin(this.time * 0.9 + w[o + 3] * 40) * 0.5 * dt : 0);
      w[o + 2] += -mz + wz * dt;
      w[o + 1] -= fall * dt * (0.85 + w[o + 3] * 0.3);
      if (w[o + 1] < 0) { w[o + 1] += BY; w[o] = (rng() - 0.5) * 2 * BX; w[o + 2] = (rng() - 0.5) * 2 * BZ; }
      if (w[o] > BX) w[o] -= BX * 2; else if (w[o] < -BX) w[o] += BX * 2;
      if (w[o + 2] > BZ) w[o + 2] -= BZ * 2; else if (w[o + 2] < -BZ) w[o + 2] += BZ * 2;
    }
    this.wCount = count;
  };

  Fx.prototype._pack = function (ctx) {
    var A = this.bufA, B = this.bufB, a = 0, b = 0, i, k, env = ctx.env, cam = ctx.camPos;
    var sun = env.sunCol, lit = [Math.min(1, 0.5 + sun[0] * 0.18), Math.min(1, 0.5 + sun[1] * 0.18), Math.min(1, 0.5 + sun[2] * 0.18)];
    var night = env.night > 0.5;
    for (i = 0; i < this.alive; i++) {
      var kind = this.kind[i], t = 1 - this.life[i] / this.maxLife[i];
      var add = kind === KIND.spark || kind === KIND.glow, buf = add ? B : A, o = (add ? b : a) * 12;
      var fade = kind === KIND.smoke ? (Math.min(1, t * 8) * (1 - t)) : (kind === KIND.spark ? (1 - t * t) : (1 - t));
      var cr = this.col[i * 4], cg = this.col[i * 4 + 1], cb = this.col[i * 4 + 2];
      if (kind === KIND.smoke) { var lk = night ? 0.12 : 1; cr *= lit[0] * lk + 0.1; cg *= lit[1] * lk + 0.1; cb *= lit[2] * lk + 0.12; }
      buf[o] = this.px[i]; buf[o + 1] = this.py[i]; buf[o + 2] = this.pz[i]; buf[o + 3] = this.size[i];
      buf[o + 4] = cr; buf[o + 5] = cg; buf[o + 6] = cb; buf[o + 7] = this.col[i * 4 + 3] * fade * (kind === KIND.spark ? 1.6 : 1);
      buf[o + 8] = (i * 1.7) % 6.283; buf[o + 9] = kind === KIND.glow ? 4 : kind; buf[o + 10] = 0; buf[o + 11] = 0;
      if (add) b++; else a++;
    }
    // light glows (lamps, headlights, tail lights)
    var lampsOn = ctx.world && ctx.world.lampOn;
    if (ctx.world && lampsOn) {
      var L = ctx.world.lights, nl = L.length, big = night ? 1 : 0.5;
      for (k = 0; k < nl; k++) {
        var P = L[k], dx = P.x - cam[0], dz = P.z - cam[2], d2 = dx * dx + dz * dz;
        if (d2 > 450 * 450 || (P.tunnel && !ctx.tunnelNear)) continue;
        var fwd = dx * (ctx.camFwd ? ctx.camFwd[0] : 0) + dz * (ctx.camFwd ? ctx.camFwd[2] : 0); if (fwd < -4) continue;
        var o2 = b * 12, sz = P.tunnel ? 1.3 : 2.4 + Math.sqrt(d2) * 0.012, c = P.tunnel ? [1, 0.93, 0.78] : [1, 0.82, 0.55];
        B[o2] = P.x; B[o2 + 1] = P.y - 0.2; B[o2 + 2] = P.z; B[o2 + 3] = sz; B[o2 + 4] = c[0]; B[o2 + 5] = c[1]; B[o2 + 6] = c[2]; B[o2 + 7] = (P.tunnel ? 0.55 : 0.5) * big;
        B[o2 + 8] = 0; B[o2 + 9] = 4; B[o2 + 10] = 0; B[o2 + 11] = 0; b++; if (b >= this.cap - 4) break;
      }
    }
    if (ctx.gfx && (night || ctx.tunnelNear || env.wet > 0.5 || env.snow > 0)) {
      var cs = ctx.gfx.cars;
      for (k = 0; k < cs.length; k++) {
        var e = cs[k], v = e.car.vehicle, M = e.M; if (e.dist > 220) continue;
        var fx = Math.sin(v.heading), fz = Math.cos(v.heading), lx = Math.cos(v.heading), lz = -Math.sin(v.heading), br = v.brake > 0.05 || (e.car.input && e.car.input.brake > 0.05);
        for (var s = -1; s <= 1; s += 2) {
          if (b >= this.cap - 4) break;
          var oo = b * 12, kk = e.dist < 25 ? 1 : 0.6;
          B[oo] = v.x + fx * (M.ZF - 0.12) + lx * s * 0.66; B[oo + 1] = v.y + 0.64; B[oo + 2] = v.z + fz * (M.ZF - 0.12) + lz * s * 0.66;
          B[oo + 3] = 0.55 + e.dist * 0.01; B[oo + 4] = 1; B[oo + 5] = 0.95; B[oo + 6] = 0.82; B[oo + 7] = 0.55 * kk * (ctx.gfx.nightLights || ctx.tunnelNear ? 1 : 0.5);
          B[oo + 8] = 0; B[oo + 9] = 4; B[oo + 10] = 0; B[oo + 11] = 0; b++;
          oo = b * 12; B[oo] = v.x + fx * (M.ZR + 0.05) + lx * s * 0.62; B[oo + 1] = v.y + 0.78; B[oo + 2] = v.z + fz * (M.ZR + 0.05) + lz * s * 0.62;
          B[oo + 3] = br ? 0.65 : 0.32; B[oo + 4] = 1; B[oo + 5] = 0.06; B[oo + 6] = 0.04; B[oo + 7] = br ? 0.95 : 0.35; B[oo + 8] = 0; B[oo + 9] = 4; B[oo + 10] = 0; B[oo + 11] = 0; b++;
        }
      }
    }
    this.nA = a; this.nB = b;
    var gl = this.R.gl;
    if (a) { gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, A, 0, a * 12); }
    if (b) { gl.bindBuffer(gl.ARRAY_BUFFER, this.vboB); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B, 0, b * 12); }
    // weather
    var W = this.wBuf, n = this.wCount, w = this.w, mode = this.wMode;
    if (n) {
      var rainCol = night ? [0.5, 0.55, 0.7] : [0.78, 0.82, 0.9], snowCol = night ? [0.6, 0.65, 0.8] : [1, 1, 1];
      var c = mode === 1 ? rainCol : snowCol, alpha = mode === 1 ? (night ? 0.34 : 0.26) : 0.8;
      for (i = 0; i < n; i++) {
        var o3 = i * 12, o4 = i * 4;
        W[o3] = cam[0] + w[o4]; W[o3 + 1] = cam[1] - 8 + w[o4 + 1]; W[o3 + 2] = cam[2] + w[o4 + 2]; W[o3 + 3] = mode === 1 ? 0.011 : 0.028 + w[o4 + 3] * 0.02;
        W[o3 + 4] = c[0]; W[o3 + 5] = c[1]; W[o3 + 6] = c[2]; W[o3 + 7] = alpha * (0.6 + 0.4 * w[o4 + 3]);
        W[o3 + 8] = w[o4 + 3] * 6.28; W[o3 + 9] = mode === 1 ? 2 : 3; W[o3 + 10] = 0; W[o3 + 11] = mode === 1 ? 52 : 0;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wVbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, W, 0, n * 12);
    }
  };

  Fx.prototype._draw = function (R) {
    var gl = R.gl, eng = R.eng;
    // skid marks first (flat on the road)
    if (this.skidOn && this.skidCount > 0) { R.drawMesh(this.skidMesh, null, null, this.mats.skid); }
    if (R.passInfo.pass !== 'main') return;
    var p = eng.compile('part', S.partVS, S.partFS);
    eng.use(p); eng.cur = null;
    gl.uniformMatrix4fv(p.u.uViewProj, false, R.viewProj);
    gl.uniform3fv(p.u.uCamRight, R.camRight); gl.uniform3fv(p.u.uCamUp, R.camUp); gl.uniform3fv(p.u.uCam, R.camPos);
    if (p.u.uExposureAdd != null) gl.uniform1f(p.u.uExposureAdd, 0);
    gl.disable(gl.CULL_FACE); gl.depthMask(false); gl.enable(gl.DEPTH_TEST); gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.nA) { gl.bindVertexArray(this.vaoA); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nA); eng.stats.draws++; }
    if (this.wCount) { gl.bindVertexArray(this.wVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.wCount); eng.stats.draws++; }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    if (this.nB) { gl.bindVertexArray(this.vaoB); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nB); eng.stats.draws++; }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
    eng.cur = null;
  };

  Fx.prototype.reset = function () { if (this.debris) this.debris.clear(); this.alive = 0; this.clearSkids(); this.wInit = false; };
  JR.Fx = Fx;
})();
