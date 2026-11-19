/* JIMMY RACING - camera.js : third-person chase camera (always behind the car) + showcase / podium cameras for menus
 * Features: smooth follow, drift-aware yaw, speed-based distance / FOV, roll from lateral g, shake, collision avoidance
 * (terrain, road, tunnel roof, footbridge, barriers) and smooth blends between modes.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util, clamp = U.clamp, damp = U.damp, wrapAngle = U.wrapAngle;

  function ChaseCamera(R, world, track) {
    this.R = R; this.world = world; this.track = track;
    this.pos = [0, 5, 0]; this.look = [0, 1, 10]; this.yaw = 0; this.fov = 62; this.roll = 0;
    this.mode = 'chase'; this.blend = 1; this.fromPos = null; this.fromLook = null; this.fromFov = 62;
    this.shake = 0; this.shakeT = 0; this.impulse = 0; this.dist = 6.5; this.height = 2.0; this.lat = 0;
    this.rng = U.makeRng(5); this.tmp = {}; this.lastSpeed = 0; this.vLat = 0; this.initialised = false;
    this.cinTime = 0; this.near = 0.15;
  }
  ChaseCamera.prototype.snapTo = function (car) { this.initialised = false; this.blend = 1; this.update(0.0001, car, false); this.initialised = true; };
  ChaseCamera.prototype.bump = function (amount) { this.impulse = Math.min(1.5, this.impulse + amount); };
  ChaseCamera.prototype.setMode = function (m) {
    if (m === this.mode) return;
    this.fromPos = this.pos.slice(); this.fromLook = this.look.slice(); this.fromFov = this.fov; this.blend = 0; this.mode = m; this.cinTime = 0;
  };

  /* keep a point above the ground / inside the playable envelope */
  ChaseCamera.prototype._clamp = function (p, ref) {
    var w = this.world, tr = this.track, loc = tr.locate(p[0], p[2], ref && ref.i != null ? ref.i : -1, this.tmp);
    var road = loc.y, ground = w.terrainHeight ? w.terrainHeight(p[0], p[2]) : road;
    var half = tr.halfWidthAt ? tr.halfWidthAt(loc.i) : tr.width[loc.i] * 0.5;
    var onRoad = Math.abs(loc.d) < half + 4;
    var floor = (onRoad ? Math.max(road, ground) : ground) + 0.45;
    // tunnel: keep below the vault, inside the walls
    if (w.tunnel && loc.s > w.tunnel.s0 - 1 && loc.s < w.tunnel.s1 + 1) {
      var tY = road + w.tunnel.ceil - 0.5; if (p[1] > tY) p[1] = tY;
      var lim = w.tunnel.halfW - 0.8;
      if (Math.abs(loc.d) > lim) { var sg = loc.d > 0 ? 1 : -1, np = tr.pointAt(loc.s, sg * lim); p[0] = np.x; p[2] = np.z; }
    }
    // footbridge deck
    if (w.bridges) for (var i = 0; i < w.bridges.length; i++) {
      var b = w.bridges[i], ds = Math.abs(loc.s - b.s); if (ds > tr.length / 2) ds = tr.length - ds;
      if (ds < b.half + 0.7 && Math.abs(loc.d) < half + 18 && p[1] > b.y - 0.6 && p[1] < b.y + 0.9) p[1] = b.y - 0.6;
    }
    if (p[1] < floor) p[1] = floor;
    return loc;
  };

  /* main per-frame update. car = sim car (vehicle), dt real seconds */
  ChaseCamera.prototype.update = function (dt, car, braking) {
    var v = car.vehicle, spd = Math.abs(v.speedKmh) / 3.6, kmh = Math.abs(v.speedKmh);
    var sf = clamp(kmh / 300, 0, 1);
    // reference direction: heading blended with velocity direction (so drifts look dramatic but readable)
    var vang = v.heading;
    if (spd > 6) {
      var wvx = v.worldVx || 0, wvz = v.worldVz || 0;
      vang = Math.atan2(wvx, wvz);
      if (v.vx < -1) vang = v.heading;             // reversing: look along the car
    }
    var diff = wrapAngle(vang - v.heading), blendV = clamp((spd - 8) / 25, 0, 1) * 0.42;
    var target = v.heading + diff * blendV;
    if (!this.initialised) { this.yaw = target; }
    else this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * (2.6 + (1 - sf) * 1.4)));
    // distance / height / fov from speed
    var distT = 6.0 + sf * 2.4 + (braking ? -0.3 : 0), heightT = 1.85 + sf * 0.55;
    var accel = ((v.speedKmh / 3.6) - this.lastSpeed) / Math.max(dt, 1e-3); this.lastSpeed = v.speedKmh / 3.6;
    var g = clamp(accel / 9, -1, 1) * (this.initialised ? 1 : 0);
    this.dist = damp(this.dist, distT + g * -0.5 * 0 - g * 0.35, 3, dt);
    this.height = damp(this.height, heightT, 3, dt);
    var fovT = 60 + sf * 20 + (v.airborne ? 2 : 0) + clamp(g, 0, 1) * 1.5 + (this.R && this.R.boostFov ? this.R.boostFov * 9 : 0);
    this.fov = damp(this.fov, fovT, 2.5, dt);
    // lateral offset follows the car's slide a little (camera swings outside the drift)
    var latT = clamp(-v.vy * 0.06, -0.9, 0.9) * clamp(spd / 20, 0, 1);
    this.lat = damp(this.lat, latT, 3, dt);
    var fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    // follow point = car position (smoothed vertically to hide suspension jitter)
    var cy = v.y;
    if (!this.initialised) this.cy = cy; this.cy = this.cy == null ? cy : damp(this.cy, cy, 6, dt);
    var want = [v.x - fx * this.dist + lx * this.lat, this.cy + this.height, v.z - fz * this.dist + lz * this.lat];
    var la = 3.0 + sf * 6.0;
    var lookWant = [v.x + fx * la, this.cy + 1.0 + sf * 0.1, v.z + fz * la];
    // smoothing: position follows with spring (frame-rate independent)
    if (!this.initialised || this.mode !== 'chase' && this.blend >= 1) { }
    var kp = 1 - Math.exp(-dt * 14);
    if (!this.initialised) { this.pos = want.slice(); this.look = lookWant.slice(); }
    else {
      for (var i = 0; i < 3; i++) { this.pos[i] += (want[i] - this.pos[i]) * (i === 1 ? 1 - Math.exp(-dt * 7) : kp); this.look[i] += (lookWant[i] - this.look[i]) * (1 - Math.exp(-dt * 12)); }
      // never let the camera end up closer than 3.6 m horizontally (fast stop / spin)
      var hx = this.pos[0] - v.x, hz = this.pos[2] - v.z, hd = Math.hypot(hx, hz);
      if (hd < 3.8) { var k2 = 3.8 / Math.max(hd, 1e-3); this.pos[0] = v.x + hx * k2; this.pos[2] = v.z + hz * k2; }
    }
    var out = this.pos.slice();
    this._clamp(out, null);
    // shake: speed + kerb/gravel + impacts
    var surf = v.surfaceNow ? v.surfaceNow.id : 0;
    this.impulse = damp(this.impulse, 0, 4.5, dt);
    var tgt = sf * sf * 0.012 + (surf === 1 ? 0.012 : surf === 2 ? 0.02 : surf === 3 ? 0.012 : 0) * clamp(spd / 25, 0, 1) + this.impulse * 0.05;
    this.shake = damp(this.shake, tgt, 8, dt);
    this.shakeT += dt * 38;
    var sk = this.shake;
    out[0] += (Math.sin(this.shakeT * 1.13) + Math.sin(this.shakeT * 2.7 + 1.1) * 0.5) * sk;
    out[1] += (Math.sin(this.shakeT * 1.71 + 2.0) + Math.sin(this.shakeT * 3.3) * 0.5) * sk;
    var lk = this.look.slice(); lk[1] += Math.sin(this.shakeT * 1.37 + 0.6) * sk * 0.6;
    // roll from lateral acceleration / yaw rate
    var latG = clamp((v.vx * v.r) / 9.81, -2, 2);
    var rollT = clamp(-latG * 0.018 - v.r * 0.006 * clamp(spd / 40, 0, 1), -0.07, 0.07) + Math.sin(this.shakeT * 0.7) * sk * 0.2;
    this.roll = damp(this.roll, rollT, 4, dt);
    // blend from a previous mode
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.9);
      var t = this.blend * this.blend * (3 - 2 * this.blend);
      for (i = 0; i < 3; i++) { out[i] = this.fromPos[i] + (out[i] - this.fromPos[i]) * t; lk[i] = this.fromLook[i] + (lk[i] - this.fromLook[i]) * t; }
      this.fovOut = this.fromFov + (this.fov - this.fromFov) * t;
    } else this.fovOut = this.fov;
    this.initialised = true;
    this.outPos = out; this.outLook = lk;
    this.apply(this.fovOut);
    // speed effects
    this.R.motion = clamp((kmh - 130) / 260, 0, 1) * 0.55;
    this.R.dofAmt = 0;
  };

  ChaseCamera.prototype.apply = function (fov) {
    var R = this.R;
    R.setCamera(this.outPos, this.outLook, [0, 1, 0], fov, this.roll, 0.12, 4200);
  };

  /* orbit around a point (menu car showcase, podium) */
  ChaseCamera.prototype.orbit = function (dt, cx, cy, cz, radius, height, speed, fov, shift) {
    if (this.mode !== 'orbit') this.setMode('orbit');
    this.cinTime += dt;
    var a = this.cinTime * speed + 0.6;
    var want = [cx + Math.sin(a) * radius, cy + height, cz + Math.cos(a) * radius], lw = [cx, cy + 0.55, cz];
    if (shift) { var dx = lw[0] - want[0], dz = lw[2] - want[2], dl = Math.hypot(dx, dz) || 1, rx = -dz / dl * shift, rz = dx / dl * shift; want[0] -= rx; want[2] -= rz; lw[0] -= rx; lw[2] -= rz; }
    this.pos = want; this.look = lw; this.fov = fov || 38; this.roll = 0;
    var out = want.slice(), lk = lw.slice(), f = this.fov;
    this._clamp(out, null);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.9); var t = this.blend * this.blend * (3 - 2 * this.blend);
      for (var i = 0; i < 3; i++) { out[i] = this.fromPos[i] + (out[i] - this.fromPos[i]) * t; lk[i] = this.fromLook[i] + (lk[i] - this.fromLook[i]) * t; }
      f = this.fromFov + (f - this.fromFov) * t;
    }
    this.outPos = out; this.outLook = lk; this.apply(f);
    this.R.motion = 0; this.initialised = false;
  };
  /* camera for the grid intro: slow flight along the grid, then settle behind the player */
  ChaseCamera.prototype.fixed = function (dt, pos, look, fov) {
    if (this.mode !== 'fixed') this.setMode('fixed');
    var out = pos.slice(), lk = look.slice(), f = fov || 50;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.9); var t = this.blend * this.blend * (3 - 2 * this.blend);
      for (var i = 0; i < 3; i++) { out[i] = this.fromPos[i] + (out[i] - this.fromPos[i]) * t; lk[i] = this.fromLook[i] + (lk[i] - this.fromLook[i]) * t; }
      f = this.fromFov + (f - this.fromFov) * t;
    }
    this.pos = pos.slice(); this.look = look.slice(); this.fov = fov || 50; this.roll = 0;
    this.outPos = out; this.outLook = lk; this.apply(f); this.R.motion = 0; this.initialised = false;
  };
  ChaseCamera.prototype.chase = function () { if (this.mode !== 'chase') { this.setMode('chase'); this.initialised = true; } };

  JR.ChaseCamera = ChaseCamera;
})();
