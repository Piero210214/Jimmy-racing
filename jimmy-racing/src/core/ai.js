/* JIMMY RACING - ai.js
 * Rival drivers. Every AI car drives the same physics as the player through the same inputs.
 *  1. A speed profile is built along the racing line (grip-limited corner speeds, backward braking
 *     pass, forward acceleration pass using the car's real power / traction numbers).
 *  2. A controller steers with pure pursuit (+ yaw-rate feedback) and follows the profile with a
 *     throttle/brake loop, with traction/ABS/stability assists like a real driver aid.
 *  3. Traffic logic: follow, overtake on the side with room, avoid cars alongside.
 *  4. Occasional driving mistakes (late braking, wide lines, snaps of oversteer).
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;
  var clamp = U.clamp, wrapAngle = U.wrapAngle;
  var RHO = 1.225, GRAV = 9.81;

  var profileCache = {};

  /* Speed profile for a (track, car spec, skill) triple. Returns Float32Array of m/s per sample. */
  function buildProfile(track, spec, skill) {
    var key = spec.id + '|' + skill.toFixed(3);
    var cached = profileCache[key];
    if (cached && cached.track === track) return cached.v;
    var N = track.N, line = track.line;
    var m = spec.mass;
    var vmaxCap = 110;
    var v = new Float32Array(N);
    var mu = spec.tyreMu * 0.76 * skill;       // usable fraction of the grip (leaves margin for the stability)
    var Ppeak = spec.torquePeak * spec.rpmPeak * Math.PI / 30 * spec.driveEff * 0.96;

    function gripAcc(vv) { return mu * (GRAV + 0.5 * RHO * spec.clA * vv * vv / m); }
    for (var i = 0; i < N; i++) {
      var kappa = Math.abs(line.k[i]);
      var vv = vmaxCap;
      if (kappa > 1e-5) {
        vv = Math.sqrt(GRAV * mu / kappa);
        for (var it = 0; it < 6; it++) vv = Math.min(vmaxCap, Math.sqrt(gripAcc(vv) / kappa));
      }
      v[i] = vv;
    }
    // share of grip left for longitudinal force when the corner already needs lateral force
    function circle(vv, kappa) {
      var lat = vv * vv * Math.abs(kappa) / Math.max(gripAcc(vv), 1e-3);
      return Math.sqrt(Math.max(0.04, 1 - lat * lat));
    }
    function accel(vv, kappa) {
      var drag = 0.5 * RHO * spec.cdA * vv * vv / m;
      var fromPower = Ppeak / (m * Math.max(vv, 4)) - drag - spec.crr * GRAV;
      var traction = 0.80 * circle(vv, kappa) * gripAcc(vv) * (1 - spec.frontWeight + 0.10) * 1.6 - drag;
      return Math.max(0.2, Math.min(fromPower, traction));
    }
    function brakeDecel(vv, kappa) {
      var drag = 0.5 * RHO * spec.cdA * vv * vv / m;
      return 0.85 * circle(vv, kappa) * gripAcc(vv) + drag;
    }
    for (var lap = 0; lap < 3; lap++) {
      for (var f = 0; f < N; f++) {
        var i0 = f, i1 = (f + 1) % N;
        var d = line.step[i0];
        var vn = Math.sqrt(v[i0] * v[i0] + 2 * accel(v[i0], line.k[i0]) * d);
        if (vn < v[i1]) v[i1] = vn;
      }
      for (var b = N - 1; b >= 0; b--) {
        var j1 = (b + 1) % N, j0 = b;
        var dd = line.step[j0];
        var vb = Math.sqrt(v[j1] * v[j1] + 2 * brakeDecel(v[j1], line.k[j1]) * dd);
        if (vb < v[j0]) v[j0] = vb;
      }
    }
    profileCache[key] = { track: track, v: v };
    return v;
  }

  function AIDriver(car, track, opts) {
    opts = opts || {};
    this.car = car; this.track = track; this.spec = car.spec;
    this.skill = clamp(opts.skill || 0.94, 0.80, 1.0);
    this.rng = U.makeRng(opts.seed || 1234);
    this.profile = buildProfile(track, car.spec, this.skill);
    this.shift = 0;                 // lateral shift applied to the racing line (m, LEFT +)
    this.mistake = null;
    this.nextMistake = this.rng.range(12, 35) / Math.max(0.2, (1 - (this.skill - 0.8) * 2.5) + 0.35);
    this.timer = 0;
    this.steerCmd = 0;
    this.mu = car.spec.tyreMu * 0.92;   // grip the steering logic may ask for
    this.stuckT = 0;
    this.mistakeRate = opts.mistakeRate == null ? 1 : opts.mistakeRate;
    this.cruise = false;            // after finishing: slow down
    car.vehicle.assists = { abs: true, tc: true, stability: 0.55 };
  }

  /* others: array of cars (entities with .vehicle and .loc info). */
  AIDriver.prototype.control = function (dt, others) {
    var car = this.car, veh = car.vehicle, track = this.track, N = track.N, ds = track.ds;
    var line = track.line, spec = this.spec;
    var loc = veh.loc;
    if (!loc || loc.i == null) return { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    var i = loc.i, v = Math.max(veh.vx, 0);
    this.timer += dt;

    /* ---- traffic: find the cars that matter ---- */
    var myS = loc.s, myD = loc.d, L = track.length;
    var wantD = null, slowTo = Infinity, avoidSide = 0;
    var FOLLOW_DECEL = 6.5, MIN_GAP = 4.0;
    for (var k = 0; k < others.length; k++) {
      var o = others[k];
      if (o === car) continue;
      var ol = o.vehicle.loc;
      if (!ol || ol.i == null) continue;
      var sRel = ol.s - myS;
      if (sRel > L / 2) sRel -= L; else if (sRel < -L / 2) sRel += L;
      var dRel = ol.d - myD;
      var vo = Math.max(0, o.vehicle.vx);
      var gap = sRel - spec.length;                       // bumper-to-bumper distance ahead
      var inLane = Math.abs(dRel) < 2.7;
      if (sRel > 0 && sRel < 110 && inLane) {
        // keep a safe stopping distance: v <= vo + sqrt(2 a (gap - minGap))
        var allowed = vo + Math.sqrt(Math.max(0, 2 * FOLLOW_DECEL * (gap - MIN_GAP)));
        if (allowed < v + 4) slowTo = Math.min(slowTo, allowed);
        // look for room to pass if we are catching up
        if (sRel < 14 + Math.max(0, v - vo) * 2.2 + v * 0.35) {
          var half = track.halfWidthAt(i) - 1.8;
          var side = dRel > 0.25 ? -1 : (dRel < -0.25 ? 1 : (myD > 0 ? -1 : 1));
          var target = clamp(ol.d + side * 3.5, -half, half);
          if (Math.abs(target - ol.d) < 2.8) { side = -side; target = clamp(ol.d + side * 3.5, -half, half); }
          wantD = wantD == null ? target : (Math.abs(target - myD) < Math.abs(wantD - myD) ? target : wantD);
        }
      }
      if (Math.abs(sRel) < 6.0 && Math.abs(dRel) < 3.4) {
        avoidSide += dRel > 0 ? -1 : 1;                   // someone alongside: leave them room
      }
    }
    /* ---- road obstacles ahead: steer around them (they are movable/static objects with known s,d) ---- */
    var obs = this.obstacles, obsAvoid = false;
    if (obs && obs.length) {
      var look = 30 + v * 2.1, halfO = track.halfWidthAt(i) - 1.7, bestS = 1e9, tgt = null;
      for (var oi = 0; oi < obs.length; oi++) {
        var ob = obs[oi], sO = ob.s - myS;
        if (sO > L / 2) sO -= L; else if (sO < -L / 2) sO += L;
        if (sO < -2 || sO > look || sO >= bestS) continue;
        var clr = ob.r + (ob.parts ? 1.6 : 0) + 1.35 + (ob.k === 'cone' ? -0.3 : 0.3);        // half car width + margin
        if (Math.abs(ob.d - myD) > clr + 0.4 && Math.abs(ob.d - (line.off[i] + this.shift)) > clr + 0.4) continue;
        // pick the side with more room
        var left = ob.d + clr + 0.2, right = ob.d - clr - 0.2, c1 = Math.abs(left) <= halfO ? left : null, c2 = Math.abs(right) <= halfO ? right : null;
        var pick = c1 == null ? c2 : (c2 == null ? c1 : (Math.abs(c1 - myD) <= Math.abs(c2 - myD) ? c1 : c2));
        if (pick == null) continue;
        bestS = sO; tgt = pick;
      }
      if (tgt != null && wantD == null) { wantD = clamp(tgt, -halfO, halfO); obsAvoid = true; }
    }
    /* ---- item boxes: when empty-handed, drift towards a box row that is reachable ahead ---- */
    var bxs = this.boxes;
    if (bxs && bxs.length && !this.car.item && wantD == null) {
      var lookB = 25 + v * 1.6, bb = null, bbS = 1e9;
      for (var bi = 0; bi < bxs.length; bi++) {
        var bo = bxs[bi]; if (!bo.on) continue;
        var sB = bo.s - myS; if (sB > L / 2) sB -= L; else if (sB < -L / 2) sB += L;
        if (sB < 6 || sB > lookB || sB >= bbS) continue;
        if (Math.abs(bo.d - myD) > 6.5) continue;
        bb = bo; bbS = sB;
      }
      if (bb) wantD = clamp(bb.d, -(track.halfWidthAt(i) - 2.2), track.halfWidthAt(i) - 2.2);
    }
    var lineOff = line.off[i];
    var targetShift = 0;
    if (wantD != null) targetShift = wantD - lineOff;
    else if (avoidSide !== 0) targetShift = avoidSide * 1.6;
    else if (car.race && car.race.dist < 380 && car.race.grid) {
      // standing start: hold the grid slot, then ease onto the racing line (no criss-crossing)
      var gridD = (car.race.grid % 2 === 1) ? 3.3 : -3.3;
      var wBlend = clamp((car.race.dist + 20) / 400, 0, 1);
      targetShift = (1 - wBlend) * (gridD - lineOff);
    }
    var shiftRate = wantD != null ? (obsAvoid ? 4.5 : 3.0) : 1.4;
    this.shift += clamp(targetShift - this.shift, -shiftRate * dt, shiftRate * dt);

    /* ---- look-ahead point on (shifted) racing line ---- */
    var Ld = 8 + 0.36 * v;
    var iL = (i + Math.max(2, Math.round(Ld / ds))) % N;
    var half2 = track.width[iL] * 0.5 - 1.6;
    var offL = clamp(line.off[iL] + this.shift, -half2, half2);
    var tx = track.x[iL] + track.tz[iL] * offL, tz = track.z[iL] - track.tx[iL] * offL;

    var dx = tx - veh.x, dz = tz - veh.z;
    var sinH = Math.sin(veh.heading), cosH = Math.cos(veh.heading);
    var fwd = dx * sinH + dz * cosH;
    var left = dx * cosH - dz * sinH;
    var distSq = Math.max(fwd * fwd + left * left, 1);
    var kappaDes = 2 * left / distSq;
    // never ask for more lateral acceleration than the tyres (plus downforce) can give
    var aMax = this.mu * (GRAV + 0.5 * RHO * spec.clA * v * v / spec.mass);
    var kLim = aMax / Math.max(v * v, 36);
    kappaDes = clamp(kappaDes, -kLim, kLim);

    /* ---- mistakes ---- */
    var penaltySpeed = 1, steerNoise = 0, steerGain = 1;
    var kLook = Math.abs(line.k[(i + Math.round((20 + v * 0.6) / ds)) % N]);
    if (this.mistake) {
      this.mistake.t += dt;
      var mk = this.mistake;
      if (mk.type === 'late') penaltySpeed = 1 + mk.mag * 0.20;             // brakes too late
      else if (mk.type === 'wide') steerGain = 1 - mk.mag * 0.22;            // understeers wide
      else if (mk.type === 'snap') { steerNoise = Math.sin(mk.t * 14) * 0.22 * mk.mag; penaltySpeed = 1.08; }
      if (mk.t > mk.dur) this.mistake = null;
    } else if (this.mistakeRate > 0 && car.race && car.race.dist > 120) {
      this.nextMistake -= dt * this.mistakeRate;
      if (this.nextMistake <= 0 && kLook > 0.004 && v > 25) {
        var types = ['late', 'wide', 'snap'];
        this.mistake = { type: this.rng.pick(types), t: 0, dur: this.rng.range(1.2, 2.4), mag: this.rng.range(0.6, 1.0) };
        this.nextMistake = this.rng.range(30, 80);
      }
    }

    /* ---- steering ---- */
    var delta = Math.atan(spec.wheelbase * kappaDes);
    var rDes = v * kappaDes;
    delta += clamp(3.5 * spec.wheelbase / Math.max(v, 12), 0.08, 0.5) * (rDes - veh.r);   // yaw-rate damping, gain ~ 1/speed
    delta *= steerGain;
    var lockNow = JR.vehicle.steerLock(spec, Math.max(v, 3));
    var steerWanted = clamp(delta / lockNow + steerNoise, -1, 1);
    // human-like steering rate (fast at low speed, slower when quick)
    var maxRate = 6.0 / (1 + v / 28);
    this.steerCmd += clamp(steerWanted - this.steerCmd, -maxRate * dt, maxRate * dt);
    var steer = this.steerCmd;

    /* ---- speed target ---- */
    var iv = (i + Math.round((v * 0.16 + 3) / ds)) % N;
    var vTarget = this.profile[iv];
    vTarget = Math.min(vTarget * penaltySpeed, 105);
    if (slowTo < Infinity) vTarget = Math.min(vTarget, Math.max(slowTo, 1.5));
    if (avoidSide !== 0) vTarget *= 0.975;
    if (this.cruise) vTarget = Math.min(vTarget, 22);
    if (car.race && car.race.hold) vTarget = 0;
    var err = vTarget - v;
    var throttle = 0, brake = 0;
    if (err > 0) throttle = clamp(0.35 + err * 0.5, 0, 1);
    else if (err < -1.0) brake = clamp((-err - 1.0) * 0.20 + 0.15, 0, 1);
    else throttle = 0.12;
    throttle *= 1 - 0.65 * Math.max(0, Math.abs(steer) - 0.45);
    if (veh.airborne) { throttle = 0; brake = 0; }
    if (Math.abs(veh.slipR) > 0.22) throttle *= 0.4;               // lift when the rear steps out
    // trail-braking safety: release the brakes as the rear axle starts to slide
    if (brake > 0) brake *= clamp(1 - (Math.abs(veh.slipR) - 0.09) * 9, 0, 1);
    if (Math.abs(veh.slipR) > 0.45 && v > 12) throttle = 0;

    // stuck detector (read by Sim, which puts the car back on the road)
    if (v < 2.0 && !(car.race && car.race.hold)) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    var offRoad = Math.abs(loc.d) > track.width[i] * 0.5 + track.kerbW + track.gravelW;
    this.offRoadT = offRoad ? (this.offRoadT || 0) + dt : 0;
    if (v < 3 && vTarget > 3) { brake = 0; throttle = Math.max(throttle, 0.6); }

    return { throttle: throttle, brake: brake, steer: steer, handbrake: 0 };
  };

  JR.ai = { AIDriver: AIDriver, buildProfile: buildProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
