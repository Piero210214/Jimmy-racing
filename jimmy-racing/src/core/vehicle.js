/* JIMMY RACING - vehicle.js
 * Single-vehicle dynamics: planar rigid body with two tyre axles (slip-angle tyre curve with
 * load sensitivity + friction circle), longitudinal/lateral weight transfer, engine torque curve,
 * automatic gearbox, aero drag/downforce, ABS/traction control, handbrake, surface grip,
 * sprung-mass pitch/roll/heave, ground following and take-off over crests.
 *
 * Frame: x = forward, y = LEFT. Yaw rate r > 0 turns left. Steering angle > 0 steers left.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;
  var clamp = U.clamp, damp = U.damp;

  var GRAV = 9.81, RHO = 1.225;

  /* ---------------- car catalogue ---------------- */
  var CARS = {
    vortex: {
      id: 'vortex', name: 'Vortex GT', blurb: 'Coupé GT equilibrado, estable y rápido',
      mass: 1450, wheelbase: 2.70, frontWeight: 0.46, cgHeight: 0.48, trackWidth: 1.62,
      length: 4.55, width: 1.94, wheelRadius: 0.345,
      torquePeak: 560, rpmPeak: 5200, rpmRedline: 7600, rpmIdle: 900,
      gears: [3.35, 2.28, 1.66, 1.28, 1.02, 0.84], finalDrive: 3.86, driveEff: 0.90,
      cdA: 0.62, clA: 0.95, aeroFront: 0.44, crr: 0.012,
      tyreMu: 1.18, tyreB: 10.5, tyreC: 1.45, tyreE: 0.2, loadSens: 0.10,
      brakeForce: 24500, brakeBias: 0.66, rearGrip: 1.07, tcLevel: 0.85,
      rollGrad: 0.0050, pitchGrad: 0.0034, steerMax: 0.56, yawInertiaK: 1.0,
      color: 0xc8102e, accent: 0x111111, shape: 'gt'
    },
    falcon: {
      id: 'falcon', name: 'Falcon RS', blurb: 'Ligero, mucha carga aerodinámica y alto régimen',
      mass: 1260, wheelbase: 2.62, frontWeight: 0.43, cgHeight: 0.42, trackWidth: 1.66,
      length: 4.40, width: 1.98, wheelRadius: 0.335,
      torquePeak: 480, rpmPeak: 6600, rpmRedline: 8800, rpmIdle: 1000,
      gears: [3.10, 2.20, 1.68, 1.35, 1.12, 0.94], finalDrive: 3.88, driveEff: 0.91,
      cdA: 0.58, clA: 1.40, aeroFront: 0.47, crr: 0.011,
      tyreMu: 1.30, tyreB: 11.0, tyreC: 1.40, tyreE: 0.15, loadSens: 0.08,
      brakeForce: 24000, brakeBias: 0.65, rearGrip: 1.10, tcLevel: 0.92,
      rollGrad: 0.0038, pitchGrad: 0.0030, steerMax: 0.52, yawInertiaK: 0.95,
      color: 0x1b6dff, accent: 0xf2f2f2, shape: 'rs'
    },
    titan: {
      id: 'titan', name: 'Titan V8', blurb: 'Muscle car pesado, potente y muy sobrevirador',
      mass: 1720, wheelbase: 2.84, frontWeight: 0.53, cgHeight: 0.56, trackWidth: 1.60,
      length: 4.88, width: 1.96, wheelRadius: 0.355,
      torquePeak: 790, rpmPeak: 4300, rpmRedline: 6600, rpmIdle: 800,
      gears: [3.20, 2.15, 1.55, 1.18, 0.96, 0.80], finalDrive: 3.70, driveEff: 0.89,
      cdA: 0.82, clA: 0.05, aeroFront: 0.50, crr: 0.014,
      tyreMu: 1.08, tyreB: 9.2, tyreC: 1.55, tyreE: 0.25, loadSens: 0.13,
      brakeForce: 24000, brakeBias: 0.66, rearGrip: 1.05, tcLevel: 0.30,
      rollGrad: 0.0070, pitchGrad: 0.0046, steerMax: 0.58, yawInertiaK: 1.12,
      color: 0xf5a300, accent: 0x151515, shape: 'muscle'
    }
  };

  function Vehicle(spec, opts) {
    opts = opts || {};
    this.spec = spec;
    var L = spec.wheelbase;
    this.a = L * (1 - spec.frontWeight);   // CG -> front axle
    this.b = L - this.a;                    // CG -> rear axle
    this.Iz = spec.mass * (spec.length * spec.length + spec.width * spec.width) / 12 * spec.yawInertiaK * 0.9;
    this.assists = { abs: true, tc: true, stability: 0.0 };
    if (opts.assists) for (var k in opts.assists) this.assists[k] = opts.assists[k];
    this.reset(0, 0, 0, 0);
  }

  Vehicle.prototype.reset = function (x, z, heading, y) {
    this.x = x; this.z = z; this.heading = heading; this.y = y || 0;
    this.vx = 0; this.vy = 0; this.r = 0;          // body frame velocities, yaw rate
    this.vyWorld = 0; this.airborne = false; this.airTime = 0;
    this.ax = 0; this.ay = 0; this.axF = 0;         // body accelerations (m/s^2), filtered
    this.steer = 0; this.steerInput = 0; this.steerAngle = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.gear = 1; this.rpm = this.spec.rpmIdle; this.shiftTimer = 0; this.shiftLock = 0; this.reversing = false;
    this.wheelAngle = [0, 0, 0, 0];                 // FL FR RL RR rotation (rad)
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0; this.heave = 0; this.heaveV = 0;
    this.slipF = 0; this.slipR = 0; this.skidF = 0; this.skidR = 0; this.wheelSpin = 0; this.absActive = 0; this.tcActive = 0;
    this.loc = { i: 0 };
    this.hint = -1;
    this.surface = null;
    this.events = [];
    this.groundY = y || 0; this.groundVy = 0;
    this.speedKmh = 0;
    this.pitchGround = 0;
    this.damage = 0;
    this.bump = 0;
    this.lateralG = 0; this.longG = 0;
  };

  /* Torque from the engine at rpm for full throttle (Nm). */
  Vehicle.prototype.engineTorque = function (rpm) {
    var s = this.spec;
    var x = (rpm - s.rpmPeak) / (s.rpmPeak * 0.9);
    var t = x < 0 ? 1 - 0.55 * x * x : 1 - 0.45 * x * x;
    if (rpm < 1500) t *= 0.7 + 0.3 * (rpm / 1500);
    return s.torquePeak * Math.max(0.35, t);
  };

  Vehicle.prototype.gearRatio = function (g) {
    if (g < 0) return -3.2 * this.spec.finalDrive;
    return this.spec.gears[g - 1] * this.spec.finalDrive;
  };

  /* Steering lock (rad) at forward speed v: shared with the AI so both use the same mapping. */
  function steerLock(spec, v) {
    return spec.steerMax / (1 + Math.pow(Math.abs(v) / 21, 1.55)) + 0.035;
  }

  /* Lateral tyre curve (Magic-Formula-like). Returns normalised force -1..1 for slip angle alpha. */
  function tyreCurve(alpha, B, C, E) {
    var Ba = B * alpha;
    return Math.sin(C * Math.atan(Ba - E * (Ba - Math.atan(Ba))));
  }

  /* ctx: { track, grip (weather multiplier), dt } ; input: {throttle, brake, steer, handbrake} */
  Vehicle.prototype.step = function (dt, input, ctx) {
    var s = this.spec, track = ctx.track;
    var m = s.mass, a = this.a, b = this.b, L = s.wheelbase;

    /* ---- track relation, surface, ground ---- */
    var loc = track.locate(this.x, this.z, this.hint, this.loc);
    this.hint = loc.i;
    var surf = track.surfaceAt(loc.d, loc.i);
    this.surface = surf;
    var groundY = loc.y;
    var relHead = U.wrapAngle(this.heading - loc.heading);
    var slopeAlong = loc.slope * Math.cos(relHead);       // dy per metre along the car's heading

    /* ---- parked on the grid: engine can be revved but the car cannot move ---- */
    if (this.locked) {
      this.vx = 0; this.vy = 0; this.r = 0; this.axF = 0; this.ax = 0; this.ay = 0;
      var thrL = clamp(input.throttle || 0, 0, 1);
      this.rpm = damp(this.rpm, s.rpmIdle + thrL * (s.rpmRedline * 0.55 - s.rpmIdle), 12, dt);
      this.throttle = thrL; this.brake = 1; this.handbrake = 1; this.engineLoad = thrL;
      this.steerInput = damp(this.steerInput, clamp(input.steer || 0, -1, 1), 6, dt);
      this.steerAngle = this.steerInput * 0.25;
      this.y = groundY; this.groundY = groundY; this.speedKmh = 0; this.worldVx = 0; this.worldVz = 0;
      this.skidF = 0; this.skidR = 0; this.wheelSpin = 0;
      return;
    }

    /* ---- driver inputs (already 0..1, steer -1..1 left positive) ---- */
    var thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    var hand = clamp(input.handbrake || 0, 0, 1);
    var speedAbs = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    // reverse logic
    if (!this.reversing && brk > 0.1 && thr < 0.05 && this.vx < 1.2) this.reversing = true;
    if (this.reversing && thr > 0.1) this.reversing = false;
    var revThr = 0;
    if (this.reversing) { revThr = brk; brk = 0; }

    // steering: speed-sensitive lock, rate limited, optional stability assist
    var vf = Math.abs(this.vx);
    var lock = steerLock(s, vf);
    var steerTarget = clamp(input.steer || 0, -1, 1);
    var rate = Math.abs(steerTarget) > Math.abs(this.steerInput) ? 4.6 : 7.5;
    this.steerInput = damp(this.steerInput, steerTarget, rate, dt);
    var delta = this.steerInput * lock;
    if (this.assists.stability > 0 && vf > 6) {
      // counter-steer only the part of the body slip beyond normal cornering (dead zone ~6 deg)
      var beta = Math.atan2(this.vy, Math.max(vf, 1.0));
      var excess = Math.max(0, Math.abs(beta) - 0.105) * (beta < 0 ? -1 : 1);
      delta += clamp(this.assists.stability * 1.6 * excess, -0.20, 0.20) * (this.vx >= 0 ? 1 : 0);
    }
    this.steerAngle = delta;
    var cd = Math.cos(delta), sd = Math.sin(delta);

    /* ---- vertical dynamics: grounded vs airborne ---- */
    // (computed after horizontal update; here we only need the airborne flag for forces)
    var air = this.airborne;

    /* ---- normal loads ---- */
    var v2 = this.vx * this.vx;
    var down = 0.5 * RHO * s.clA * v2;
    var axFilt = clamp(this.axF, -14, 12);
    var Fzf = m * GRAV * b / L - m * axFilt * s.cgHeight / L + down * s.aeroFront;
    var Fzr = m * GRAV * a / L + m * axFilt * s.cgHeight / L + down * (1 - s.aeroFront);
    // slope slightly shifts load; keep positive
    Fzf = Math.max(Fzf, m * GRAV * 0.06); Fzr = Math.max(Fzr, m * GRAV * 0.06);
    if (air) { Fzf = 0; Fzr = 0; }
    var Fzstat = m * GRAV * 0.5;
    var gripScale = (surf.mu) * (ctx.grip == null ? 1 : ctx.grip);

    var muF = s.tyreMu * gripScale * (1 - s.loadSens * (Fzf / Fzstat - 1));
    var muR = s.tyreMu * gripScale * (1 - s.loadSens * (Fzr / Fzstat - 1));
    // lateral weight-transfer penalty (inner tyre unloads): less axle grip at high lateral g
    var latG = Math.abs(this.ay) / GRAV;
    var ltPen = 1 - 0.07 * Math.min(latG, 1.6);
    muF *= ltPen; muR *= ltPen * (s.rearGrip || 1);

    /* ---- drivetrain ---- */
    var gearAbs = this.reversing ? -1 : this.gear;
    var ratio = this.gearRatio(gearAbs);
    var wheelRpm = Math.abs(this.vx) / s.wheelRadius * Math.abs(ratio) * 30 / Math.PI;
    var clutchRpm = s.rpmIdle + thr * 3000;
    var rpm = Math.max(s.rpmIdle, wheelRpm);
    if ((this.gear === 1 || this.reversing) && wheelRpm < clutchRpm) rpm = Math.max(rpm, clutchRpm * (thr > 0.02 ? 1 : 0.6));
    rpm = Math.min(rpm, s.rpmRedline * 1.02);
    this.rpm = damp(this.rpm, rpm, 40, dt);

    var throttleEff = this.reversing ? revThr : thr;
    var limiterCut = this.rpm > s.rpmRedline ? 0 : 1;
    var shiftCut = this.shiftTimer > 0 ? 0.0 : 1;
    var engT = this.engineTorque(this.rpm) * throttleEff * limiterCut * shiftCut;
    // engine braking when off throttle
    var engBrake = -(1 - throttleEff) * 0.10 * s.torquePeak * (this.rpm / s.rpmRedline) * (this.shiftTimer > 0 ? 0 : 1);
    var wheelTorque = (engT + engBrake) * Math.abs(ratio) * s.driveEff;
    var FdriveDemand = wheelTorque / s.wheelRadius * (this.reversing ? -1 : 1);
    if (!this.reversing && this.vx < -0.5 && thr > 0.1) FdriveDemand = Math.abs(FdriveDemand) * 0.6; // rolling backwards uphill, go forward

    /* ---- wheel-frame velocities ---- */
    var vyF = this.vy + a * this.r, vyR = this.vy - b * this.r;
    // front wheel (heading delta)
    var vlF = this.vx * cd + vyF * sd;
    var vnF = -this.vx * sd + vyF * cd;
    var vlR = this.vx, vnR = vyR;
    var FLOOR = 2.0;
    var alphaF = Math.atan2(vnF, Math.max(Math.abs(vlF), FLOOR));
    var alphaR = Math.atan2(vnR, Math.max(Math.abs(vlR), FLOOR));
    // reverse: slip angle sign flips with travel direction
    if (vlF < -FLOOR) alphaF = Math.atan2(vnF, Math.abs(vlF));
    this.slipF = alphaF; this.slipR = alphaR;

    /* ---- longitudinal forces (brakes + drive) ---- */
    var brakeDemand = brk * s.brakeForce;
    var bf = brakeDemand * s.brakeBias, br = brakeDemand * (1 - s.brakeBias);
    var capF = muF * Fzf, capR = muR * Fzr;
    var lockF = 1, lockR = 1;
    var absOn = this.assists.abs, tcOn = this.assists.tc;
    var holdF = clamp(vlF / 0.6, -1, 1), holdR = clamp(vlR / 0.6, -1, 1);
    var FxF, FxR;

    // front: brakes only
    var absAct = 0;
    if (absOn) {
      if (bf > capF * 0.96) { bf = capF * 0.96; absAct = 1; }
    } else if (bf > capF) { lockF = 0.35; bf = capF * 0.84; }
    FxF = -holdF * bf;

    // rear: drive + brakes + handbrake
    var handF = hand * s.brakeForce * 0.9;
    var rearBrake = br + handF;
    if (absOn && hand < 0.1) {
      if (rearBrake > capR * 0.96) { rearBrake = capR * 0.96; absAct = 1; }
    } else if (rearBrake > capR) { lockR = hand > 0.1 ? 0.30 : 0.45; rearBrake = capR * 0.84; }
    if (hand > 0.3) lockR = Math.min(lockR, 0.42);
    var Fdrive = FdriveDemand;
    var tcAct = 0;
    // traction control: when the rear axle is already using grip laterally, leave room for it.
    var latUseR = Math.abs(tyreCurve(alphaR, s.tyreB, s.tyreC, s.tyreE));
    var tcK = tcOn ? s.tcLevel * 0.9 : 0;
    var driveCap = capR * 0.97 * Math.sqrt(Math.max(0.05, 1 - (latUseR * tcK) * (latUseR * tcK)));
    if (Fdrive > driveCap) { Fdrive = driveCap; tcAct = tcOn ? 1 : 0; }
    else if (Fdrive < -capR * 0.5) Fdrive = -capR * 0.5;
    var spinning = FdriveDemand > capR * (tcOn ? 1.02 : 0.98);
    this.wheelSpin = spinning ? clamp((FdriveDemand / Math.max(capR, 1) - 0.98) * 0.6, 0.15, 1) : 0;
    FxR = Fdrive - holdR * rearBrake;
    this.absActive = absAct; this.tcActive = tcAct;

    /* ---- lateral forces with friction circle ---- */
    var FxFc = clamp(FxF / Math.max(capF, 1), -1, 1);
    var FxRc = clamp(FxR / Math.max(capR, 1), -1, 1);
    var circF = Math.sqrt(Math.max(0.02, 1 - FxFc * FxFc));
    var circR = Math.sqrt(Math.max(0.02, 1 - FxRc * FxRc));
    var FyF = -tyreCurve(alphaF, s.tyreB, s.tyreC, s.tyreE) * capF * circF * lockF;
    var FyR = -tyreCurve(alphaR, s.tyreB, s.tyreC, s.tyreE) * capR * circR * lockR;
    if (this.vx < 0) { /* keep the same sign convention while reversing */ }

    /* ---- resistances ---- */
    var vSign = this.vx >= 0 ? 1 : -1;
    var drag = 0.5 * RHO * s.cdA * this.vx * Math.abs(this.vx);
    var roll = (s.crr + surf.roll) * m * GRAV * Math.tanh(this.vx / 0.6);
    var grade = m * GRAV * slopeAlong;                      // uphill (positive slope) decelerates
    if (surf === track.SURFACES.gravel && speedAbs > 3) roll += 0.18 * m * GRAV * Math.tanh(this.vx / 1.0);
    var FresX = -drag - roll - grade;
    if (air) { FxF = 0; FxR = 0; FyF = 0; FyR = 0; FresX = -drag * 0.6; }

    /* ---- body-frame forces ---- */
    var FxBody = FxF * cd - FyF * sd + FxR + FresX;
    var FyBody = FyF * cd + FxF * sd + FyR;
    var Mz = a * (FyF * cd + FxF * sd) - b * FyR;
    // light yaw damping (gyro/tyre self-aligning) keeps things stable at tiny speeds
    Mz -= this.r * (60 + 2200 / (1 + speedAbs));

    var dvx = FxBody / m + this.vy * this.r;
    var dvy = FyBody / m - this.vx * this.r;
    var dr = Mz / this.Iz;
    this.vx += dvx * dt; this.vy += dvy * dt; this.r += dr * dt;

    // near-standstill: freeze tiny residual motion when no input
    if (speedAbs < 0.15 && thr < 0.02 && revThr < 0.02) {
      this.vx *= 0.9; this.vy *= 0.5; this.r *= 0.5;
    }

    // accelerations measured in body frame (what the chassis "feels"); low-pass filtered
    var axRaw = (FxBody) / m, ayRaw = (FyBody) / m;
    this.axF = damp(this.axF, axRaw, 18, dt);
    this.ax = this.axF;
    this.ay = damp(this.ay, ayRaw, 18, dt);
    this.lateralG = this.ay / GRAV; this.longG = this.ax / GRAV;

    /* ---- integrate pose ---- */
    var sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    // body (forward, left) -> world: forward=(sinH,cosH), left=(cosH,-sinH)
    var vwx = this.vx * sinH + this.vy * cosH;
    var vwz = this.vx * cosH - this.vy * sinH;
    this.x += vwx * dt; this.z += vwz * dt;
    this.heading = U.wrapAngle(this.heading + this.r * dt);
    this.speedKmh = this.vx * 3.6;
    this.worldVx = vwx; this.worldVz = vwz;

    /* ---- automatic gearbox ---- */
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftLock > 0) this.shiftLock -= dt;
    if (!this.reversing && this.shiftLock <= 0) {
      var up = s.rpmRedline * (0.90 + 0.06 * thr);
      var ratioNow = this.gearRatio(this.gear);
      if (this.gear < 6 && wheelRpm > up && !air) {
        this.gear++; this.shiftTimer = 0.14; this.shiftLock = 0.45;
        this.events.push({ type: 'shift', dir: 1 });
      } else if (this.gear > 1) {
        var lowerRatio = this.gearRatio(this.gear - 1);
        var rpmLower = wheelRpm * lowerRatio / ratioNow;
        var downPoint = s.rpmRedline * (brk > 0.3 ? 0.62 : 0.34);
        if ((wheelRpm < downPoint && rpmLower < s.rpmRedline * 0.92) || (brk > 0.2 && rpmLower < s.rpmRedline * 0.80 && wheelRpm < s.rpmRedline * 0.55)) {
          this.gear--; this.shiftTimer = 0.10; this.shiftLock = 0.30;
          this.events.push({ type: 'shift', dir: -1 });
        }
      }
    }

    /* ---- vertical: ground following / take-off ---- */
    var newLoc = track.locate(this.x, this.z, this.hint, this.loc);
    this.hint = newLoc.i;
    var gNew = newLoc.y;
    var gVy = (gNew - this.groundY) / dt;
    var yBall = this.y + this.vyWorld * dt - 0.5 * GRAV * dt * dt;
    if (!this.airborne) {
      // currently on ground: do we leave it?
      if (yBall > gNew + 0.02 && speedAbs > 15) {
        this.airborne = true; this.airTime = 0;
        this.vyWorld = this.vyWorld;                // inherits ground vertical velocity
        this.y = yBall; this.vyWorld -= GRAV * dt;
      } else {
        this.vyWorld = damp(this.vyWorld, gVy, 60, dt);
        this.y = gNew;
      }
    } else {
      this.airTime += dt;
      this.y += this.vyWorld * dt;
      this.vyWorld -= GRAV * dt;
      if (this.y <= gNew) {
        var impact = Math.max(0, -(this.vyWorld - gVy));
        this.y = gNew; this.vyWorld = gVy; this.airborne = false;
        this.heaveV -= impact * 0.9;
        this.events.push({ type: 'land', impact: impact, airTime: this.airTime });
        this.airTime = 0;
      }
    }
    this.groundY = gNew; this.groundVy = gVy;
    this.surfaceNow = track.surfaceAt(newLoc.d, newLoc.i);

    /* ---- sprung-mass dynamics (visual pitch / roll / heave) ---- */
    var wn = 10.5, zeta = 0.42;
    var rollTarget = this.ay * s.rollGrad;
    var pitchTarget = -this.ax * s.pitchGrad;
    this.rollV += (wn * wn * (rollTarget - this.roll) - 2 * zeta * wn * this.rollV) * dt;
    this.roll += this.rollV * dt;
    this.pitchV += (wn * wn * (pitchTarget - this.pitch) - 2 * zeta * wn * this.pitchV) * dt;
    this.pitch += this.pitchV * dt;
    // heave: kerbs/gravel add vibration, aero squat lowers the car, landing kicks it
    var bumpAmp = 0;
    if (!this.airborne) {
      if (this.surfaceNow.id === 1) bumpAmp = 0.9;
      else if (this.surfaceNow.id === 2) bumpAmp = 0.7;
      else if (this.surfaceNow.id === 3) bumpAmp = 0.5;
    }
    if (bumpAmp > 0 && speedAbs > 4) {
      this.heaveV += (Math.sin(this.x * 9.7 + this.z * 7.3 + this.groundY * 3.1) * 2.2 + (Math.sin(this.x * 31.0 + this.z * 17.0))) * bumpAmp * Math.min(1, speedAbs / 30) * 55 * dt;
    }
    var heaveTarget = -down / (m * 9000) * 4.0;            // dynamic squat from downforce
    this.heaveV += (wn * wn * 1.4 * (heaveTarget - this.heave) - 2 * 0.5 * wn * 1.2 * this.heaveV) * dt;
    this.heave += this.heaveV * dt;
    this.heave = clamp(this.heave, -0.12, 0.08);
    this.bump = bumpAmp;

    // ground pitch (road gradient seen by the chassis)
    this.pitchGround = damp(this.pitchGround, -Math.atan(slopeAlong), 14, dt);

    /* ---- wheels ---- */
    var ws = this.vx / s.wheelRadius;
    var spinBoost = this.wheelSpin > 0.2 ? (1 + this.wheelSpin * 3.5) : 1;
    if (this.vx >= -1) { /* ok */ }
    this.wheelAngle[0] += ws * dt; this.wheelAngle[1] += ws * dt;
    var rearSlip = (hand > 0.5 || lockR < 0.5) ? 0.0 : spinBoost;
    this.wheelAngle[2] += ws * rearSlip * dt; this.wheelAngle[3] += ws * rearSlip * dt;

    /* ---- skid intensity (for marks / smoke / sounds) ---- */
    var peakA = 0.13;
    var skF = Math.max(0, (Math.abs(alphaF) - peakA * 0.95) / 0.12) + (lockF < 1 ? 1 : 0) * (speedAbs > 4 ? 1 : 0) + (absAct && brk > 0.9 ? 0.25 : 0);
    var skR = Math.max(0, (Math.abs(alphaR) - peakA * 0.95) / 0.12) + this.wheelSpin * 1.1 + (lockR < 1 && speedAbs > 4 ? 1 : 0);
    if (air || speedAbs < 3) { skF = 0; skR = 0; }
    this.skidF = clamp(skF, 0, 1.5); this.skidR = clamp(skR, 0, 1.5);

    // hold hand input memory for renderer / audio
    this.throttle = thr; this.brake = brk; this.handbrake = hand;
    this.engineLoad = throttleEff * limiterCut;
  };

  JR.vehicle = { Vehicle: Vehicle, CARS: CARS, GRAV: GRAV, tyreCurve: tyreCurve, steerLock: steerLock };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
