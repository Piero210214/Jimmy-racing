/* JIMMY RACING - sim.js
 * Race simulation: grid, start lights, fixed-step stepping of every car, car-car and barrier
 * collisions (impulse based, with yaw), checkpoints, laps, lap/race timing, positions, results.
 * Also headless solo-lap simulation used to set qualifying times for the AI.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;
  var clamp = U.clamp;
  var Vehicle = JR.vehicle.Vehicle;

  var STEP = 1 / 120;
  var CIRCLE_R = 0.97;

  function Sim(opts) {
    this.track = opts.track;
    this.totalLaps = opts.laps || 3;
    this.mode = opts.mode || 'race';       // 'race' | 'qualifying'
    this.grip = opts.grip == null ? 1 : opts.grip;
    this.cars = [];
    this.events = [];
    this.state = 'grid';                    // grid -> countdown -> racing -> finished
    this.t = 0;                             // race clock (starts at lights out)
    this.countT = 0; this.lights = 0; this.holdTime = 1.0;
    this.rng = U.makeRng(opts.seed || 777);
    this.accum = 0;
    this.finishTimer = 0;
    this.cpCount = this.track.features ? this.track.features.checkpoints : 8;
    this.ordered = [];
    this.player = null;
    this.qualiLapsTarget = opts.qualiLaps || 2;
    this.obstacles = opts.obstacles && JR.obstacles ? JR.obstacles.generate(this.track, opts.seed) : [];
    this.itemsOn = !!(opts.items && JR.items); this.itemBoxes = []; this.projectiles = []; this.traps = [];
    if (this.itemsOn) JR.items.init(this, opts.seed);
  }

  /* spec: entry of JR.vehicle.CARS; opts: {name, isPlayer, color, skill, seed, assists} */
  Sim.prototype.addCar = function (spec, opts) {
    opts = opts || {};
    var veh = new Vehicle(spec, { assists: opts.assists });
    var car = {
      id: this.cars.length, human: !!opts.human, name: opts.name || spec.name, spec: spec, vehicle: veh,
      isPlayer: !!opts.isPlayer, color: opts.color == null ? spec.color : opts.color,
      ai: null, input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
      race: {
        dist: 0, lapsDone: 0, lapStartT: 0, lapTimes: [], bestLap: null, finished: false, finishTime: null,
        penalty: 0, nextCp: 1, cpTimes: [], place: 0, grid: 0, wrongWay: 0, hold: false, started: false, lastS: 0,
        qualifyBest: null
      },
      damageZones: { front: 0, rear: 0, left: 0, right: 0 }
    };
    if (!car.isPlayer && !car.human) car.ai = new JR.ai.AIDriver(car, this.track, { skill: opts.skill, seed: opts.seed, mistakeRate: opts.mistakeRate });
    if (car.ai) { car.ai.obstacles = this.obstacles; car.ai.itemStyle = ['aggressive', 'defensive', 'balanced'][this.cars.length % 3]; car.ai.boxes = this.itemBoxes; }
    if (JR.items) JR.items.resetCar(car);
    if (car.isPlayer) this.player = car;
    this.cars.push(car);
    return car;
  };

  /* order: array of cars, first = pole. Staggered 2-wide grid behind the line. */
  Sim.prototype.setupGrid = function (order) {
    var track = this.track, L = track.length;
    this.ordered = order.slice();
    for (var k = 0; k < order.length; k++) {
      var car = order[k];
      var row = Math.floor(k / 2), col = k % 2;
      var sBehind = 12 + row * 11 + (col ? 5.5 : 0);
      var d = col ? -3.3 : 3.3;
      var p = track.pointAt(L - sBehind, d);
      var v = car.vehicle;
      v.reset(p.x, p.z, p.heading, p.y);
      v.locked = (this.mode === 'race');
      var loc = track.locate(p.x, p.z, -1, v.loc); v.hint = loc.i; v.groundY = p.y;
      var r = car.race;
      r.dist = -sBehind; r.lastS = loc.s; r.grid = k + 1; r.place = k + 1; r.nextCp = 1;
      r.lapsDone = 0; r.lapTimes = []; r.bestLap = null; r.finished = false; r.finishTime = null; r.penalty = 0;
      r.cpTimes = []; r.started = false; r.hold = false;
      car.damageZones = { front: 0, rear: 0, left: 0, right: 0 };
      v.damage = 0;
    }
    this.state = 'grid'; this.t = 0; this.events.length = 0;
  };

  /* Qualifying: lone car starts rolling on the straight, timer starts at the line. */
  Sim.prototype.beginQualifying = function () {
    this.state = 'racing'; this.t = 0;
    var car = this.player, v = car.vehicle;
    v.locked = false;
    this.events.push({ type: 'go' });
  };

  Sim.prototype.beginCountdown = function () {
    if (this.state !== 'grid') return;
    this.state = 'countdown'; this.countT = 0; this.lights = 0;
    this.holdTime = 0.7 + this.rng() * 1.3;
  };

  Sim.prototype.useItem = function (car) { return this.itemsOn ? JR.items.use(this, car) : false; };
  /* ---- severe crash: the pilot is thrown out, the car is held still for EJECT_TIME, then everything resumes ---- */
  var EJECT_SPEED = 20, EJECT_TIME = 3.0, EJECT_COOL = 10;
  Sim.prototype._ejectScan = function (from) {
    for (var k = from; k < this.events.length; k++) {
      var e = this.events[k]; if (e.type !== 'hit' || !e.car || e.quiet) continue;
      var c = e.car, lim = e.obst === 'block' ? EJECT_SPEED * 0.85 : EJECT_SPEED;
      if (c.ejected || c.race.finished || this.mode !== 'race' || e.speed < lim || (c.ejectCool || 0) > this.t) continue;
      c.ejected = { t: 0, x: c.vehicle.x, z: c.vehicle.z, speed: e.speed, src: e.wall ? 'wall' : (e.obst ? 'obstacle' : 'car') }; c.ejects = (c.ejects || 0) + 1;
      this.events.push({ type: 'eject', car: c, x: c.vehicle.x, y: c.vehicle.y, z: c.vehicle.z, speed: e.speed, src: c.ejected.src });
    }
  };
  Sim.prototype.step = function (playerInput) {
    var dt = STEP, i, car, ev0 = this.events.length;
    if (this.state === 'countdown') {
      this.countT += dt;
      var lit = Math.min(5, Math.floor(this.countT / 0.9) + 1);
      if (lit !== this.lights) { this.lights = lit; this.events.push({ type: 'light', n: lit }); }
      if (this.countT >= 5 * 0.9 + this.holdTime) {
        this.state = 'racing'; this.lights = 0; this.t = 0;
        for (i = 0; i < this.cars.length; i++) this.cars[i].vehicle.locked = false;
        this.events.push({ type: 'go' });
      }
    }

    var running = this.state === 'racing' || this.state === 'finished';
    for (i = 0; i < this.cars.length; i++) {
      car = this.cars[i];
      var inp;
      if (car.ejected) {                                           // pilot out: no control, the car is brought to rest
        var vv = car.vehicle, dmp = Math.max(0, 1 - 7 * dt); vv.vx *= dmp; vv.vy *= dmp; vv.r *= dmp;
        inp = { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
        car.ejected.t += dt;
        if (car.ejected.t >= EJECT_TIME - 1e-9) {                  // pilot back in the seat: valid state, control restored
          var tt = car.ejected.t; car.ejected = null; car.ejectCool = this.t + EJECT_COOL; vv.vx = 0; vv.vy = 0; vv.r = 0;
          if (vv.loc && Math.abs(vv.loc.d) > this.track.halfWidthAt(vv.loc.i) + 1.0) this.respawn(car, 'eject');
          this.events.push({ type: 'ejectEnd', car: car, t: tt });
        }
      } else if (car.isPlayer) inp = playerInput || car.input;
      else if (car.human) inp = car.input;                       // online: input comes from the network
      else inp = (this.state === 'grid' || this.state === 'countdown')
        ? { throttle: this.state === 'countdown' && this.countT > 3.3 ? 0.9 : 0, brake: 0, steer: 0, handbrake: 0 }
        : car.ai.control(dt, this.cars);
      car.input = inp;
      car.vehicle.step(dt, inp, { track: this.track, grip: this.grip });
    }

    if (running) {
      this.t += dt;
      this.collide();
      if (this.obstacles.length) { JR.obstacles.step(this, dt); JR.obstacles.collide(this, { circleCenters: circleCenters, worldVel: worldVel, setBodyVel: setBodyVel, localPoint: localPoint, addDamage: addDamage, R: CIRCLE_R }); }
      if (this.itemsOn) { JR.items.botStep(this); JR.items.step(this, dt); }
      this._ejectScan(ev0);
      this.updateRace();
      if (this.state === 'finished') this.finishTimer += dt;
    }
  };

  /* ---- collisions ---- */
  function circleCenters(veh) {
    var s = veh.spec, sinH = Math.sin(veh.heading), cosH = Math.cos(veh.heading);
    var off = s.length * 0.5 - CIRCLE_R * 1.05;
    return [
      { lx: off, x: veh.x + sinH * off, z: veh.z + cosH * off },
      { lx: 0, x: veh.x, z: veh.z },
      { lx: -off, x: veh.x - sinH * off, z: veh.z - cosH * off }
    ];
  }
  function worldVel(veh) {
    var sinH = Math.sin(veh.heading), cosH = Math.cos(veh.heading);
    return { x: veh.vx * sinH + veh.vy * cosH, z: veh.vx * cosH - veh.vy * sinH };
  }
  function setBodyVel(veh, wx, wz) {
    var sinH = Math.sin(veh.heading), cosH = Math.cos(veh.heading);
    veh.vx = wx * sinH + wz * cosH;
    veh.vy = wx * cosH - wz * sinH;
  }
  /* local contact info for damage/visual effects (x forward, y left) */
  function localPoint(veh, px, pz) {
    var sinH = Math.sin(veh.heading), cosH = Math.cos(veh.heading);
    var dx = px - veh.x, dz = pz - veh.z;
    return { x: dx * sinH + dz * cosH, y: dx * cosH - dz * sinH };
  }
  function addDamage(car, lp, severity) {
    var z = car.damageZones;
    if (Math.abs(lp.x) > Math.abs(lp.y) * 0.8) { if (lp.x > 0) z.front += severity; else z.rear += severity; }
    else { if (lp.y > 0) z.left += severity; else z.right += severity; }
    car.vehicle.damage += severity;
  }

  Sim.prototype.collide = function () {
    var cars = this.cars, n = cars.length, track = this.track, a, b, ca, cb, ia, ib;
    // car vs car
    for (a = 0; a < n; a++) {
      for (b = a + 1; b < n; b++) {
        var A = cars[a], B = cars[b], va = A.vehicle, vb = B.vehicle;
        var dxc = va.x - vb.x, dzc = va.z - vb.z;
        if (dxc * dxc + dzc * dzc > 36) continue;
        if (va.locked && vb.locked) continue;
        var cA = circleCenters(va), cB = circleCenters(vb);
        for (ia = 0; ia < 3; ia++) for (ib = 0; ib < 3; ib++) {
          var pa = cA[ia], pb = cB[ib];
          var dx = pa.x - pb.x, dz = pa.z - pb.z;
          var dist = Math.sqrt(dx * dx + dz * dz);
          var minD = CIRCLE_R * 2;
          if (dist >= minD || dist < 1e-6) continue;
          var nx = dx / dist, nz = dz / dist;
          var pen = minD - dist;
          var mA = va.spec.mass, mB = vb.spec.mass;
          var wA = mB / (mA + mB), wB = mA / (mA + mB);
          va.x += nx * pen * wA; va.z += nz * pen * wA;
          vb.x -= nx * pen * wB; vb.z -= nz * pen * wB;
          cA = circleCenters(va); cB = circleCenters(vb);
          // contact point & offsets
          var cpx = (pa.x + pb.x) / 2, cpz = (pa.z + pb.z) / 2;
          var rAx = cpx - va.x, rAz = cpz - va.z, rBx = cpx - vb.x, rBz = cpz - vb.z;
          var wa = worldVel(va), wb = worldVel(vb);
          // velocity at contact: v + r * (rz, -rx)
          var vAx = wa.x + va.r * rAz, vAz = wa.z - va.r * rAx;
          var vBx = wb.x + vb.r * rBz, vBz = wb.z - vb.r * rBx;
          var vn = (vAx - vBx) * nx + (vAz - vBz) * nz;
          if (vn >= 0) continue;
          var crA = rAz * nx - rAx * nz, crB = rBz * nx - rBx * nz;
          var e = 0.22;
          var denom = 1 / mA + 1 / mB + crA * crA / va.Iz + crB * crB / vb.Iz;
          var j = -(1 + e) * vn / denom;
          // tangential (paint scraping) friction
          var tx = -nz, tz = nx;
          var vt = (vAx - vBx) * tx + (vAz - vBz) * tz;
          var jt = clamp(-vt * 0.12 * (mA * mB / (mA + mB)), -0.25 * j, 0.25 * j);
          var Jx = j * nx + jt * tx, Jz = j * nz + jt * tz;
          setBodyVel(va, wa.x + Jx / mA, wa.z + Jz / mA);
          setBodyVel(vb, wb.x - Jx / mB, wb.z - Jz / mB);
          va.r += (Jx * rAz - Jz * rAx) / va.Iz;
          vb.r -= (Jx * rBz - Jz * rBx) / vb.Iz;
          var sev = Math.min(1.5, (-vn) / 12);
          var lpA = localPoint(va, cpx, cpz), lpB = localPoint(vb, cpx, cpz);
          if (-vn > 1.2) {
            addDamage(A, lpA, sev); addDamage(B, lpB, sev);
            this.events.push({ type: 'hit', car: A, other: B, speed: -vn, x: cpx, z: cpz, y: va.y + 0.5, lp: lpA });
            this.events.push({ type: 'hit', car: B, other: A, speed: -vn, x: cpx, z: cpz, y: vb.y + 0.5, lp: lpB, quiet: true });
          }
        }
      }
    }
    // car vs barriers
    for (a = 0; a < n; a++) {
      var C = cars[a], vv = C.vehicle;
      if (vv.locked) continue;
      var cs = circleCenters(vv);
      for (ia = 0; ia < 3; ia++) {
        var pc = cs[ia];
        var l = track.locate(pc.x, pc.z, vv.hint);
        var bd = track.barrierDistAt(l.i, l.d);
        var over = Math.abs(l.d) + CIRCLE_R - bd;
        if (over <= 0) continue;
        var side = l.d > 0 ? 1 : -1;
        var nnx = -l.lx * side, nnz = -l.lz * side;          // wall normal pointing inward
        vv.x += nnx * over; vv.z += nnz * over;
        var w = worldVel(vv);
        var rx = pc.x - vv.x, rz = pc.z - vv.z;
        var pvx = w.x + vv.r * rz, pvz = w.z - vv.r * rx;
        var vnW = pvx * nnx + pvz * nnz;
        if (vnW < 0) {
          var cr = rz * nnx - rx * nnz;
          var m = vv.spec.mass;
          var denomW = 1 / m + cr * cr / vv.Iz;
          var eW = 0.18;
          var jW = -(1 + eW) * vnW / denomW;
          var ttx = -nnz, ttz = nnx;
          var vtW = pvx * ttx + pvz * ttz;
          var jtW = clamp(-vtW * m * 0.5, -0.40 * jW, 0.40 * jW);   // scraping friction against the rail
          var JxW = jW * nnx + jtW * ttx, JzW = jW * nnz + jtW * ttz;
          setBodyVel(vv, w.x + JxW / m, w.z + JzW / m);
          vv.r += (JxW * rz - JzW * rx) / vv.Iz;
          var lp = localPoint(vv, pc.x - nnx * CIRCLE_R, pc.z - nnz * CIRCLE_R);
          if (-vnW > 1.0) {
            addDamage(C, lp, Math.min(1.5, (-vnW) / 10));
            this.events.push({ type: 'hit', car: C, other: null, speed: -vnW, x: pc.x - nnx * CIRCLE_R, z: pc.z - nnz * CIRCLE_R, y: vv.y + 0.5, lp: lp, wall: true });
          } else if (vtW * vtW > 4) {
            this.events.push({ type: 'scrape', car: C, x: pc.x - nnx * CIRCLE_R, z: pc.z - nnz * CIRCLE_R, y: vv.y + 0.5 });
          }
        }
      }
    }
  };

  /* ---- race progress ---- */
  Sim.prototype.updateRace = function () {
    var track = this.track, L = track.length, K = this.cpCount, i, car;
    for (i = 0; i < this.cars.length; i++) {
      car = this.cars[i];
      var r = car.race, v = car.vehicle;
      var s = v.loc.s;
      var d = s - r.lastS;
      if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
      r.lastS = s;
      r.dist += d;

      // wrong way detection
      var rel = Math.abs(U.wrapAngle(v.heading - v.loc.heading));
      if (rel > 2.0 && v.speedKmh > 5 || (v.vx < -3)) r.wrongWay += STEP; else r.wrongWay = Math.max(0, r.wrongWay - STEP * 2);

      if (car.ai && !r.finished && (car.ai.stuckT > 4.0 || car.ai.offRoadT > 5.0)) this.respawn(car, 'stuck');
      if (r.finished) continue;
      // start of lap 1
      if (!r.started && r.dist >= 0) {
        r.started = true; r.lapStartT = this.t - (r.dist / Math.max(v.vx, 1));
        this.events.push({ type: 'lapstart', car: car, lap: 1 });
      }
      if (!r.started) continue;
      var lapBase = r.lapsDone * L;
      // checkpoints of the current lap, in order
      while (r.nextCp < K && r.dist >= lapBase + r.nextCp * L / K) {
        r.cpTimes.push(this.t);
        this.events.push({ type: 'checkpoint', car: car, index: r.nextCp, lap: r.lapsDone + 1, t: this.t });
        r.nextCp++;
      }
      // finish line of the current lap
      if (r.nextCp >= K && r.dist >= (r.lapsDone + 1) * L) {
        var tNow = this.t - (r.dist - (r.lapsDone + 1) * L) / Math.max(v.vx, 1);
        var lapT = tNow - r.lapStartT;
        r.lapTimes.push(lapT); r.lapsDone++; r.lapStartT = tNow; r.nextCp = 1;
        var isBest = r.bestLap == null || lapT < r.bestLap;
        if (isBest) r.bestLap = lapT;
        this.events.push({ type: 'lap', car: car, lap: r.lapsDone, time: lapT, best: isBest });
        var target = this.mode === 'qualifying' ? this.qualiLapsTarget : this.totalLaps;
        if (r.lapsDone >= target) {
          r.finished = true; r.finishTime = tNow + r.penalty;
          if (this.mode === 'qualifying') {
            // best *flying* lap: ignore lap 1 (standing start) when more than one lap was driven
            var flying = r.lapTimes.slice(r.lapTimes.length > 1 ? 1 : 0);
            r.qualifyBest = Math.min.apply(null, flying);
            this.state = 'finished';
          }
          this.events.push({ type: 'finish', car: car });
          if (car.ai) car.ai.cruise = true;
          if (car.isPlayer && this.mode === 'race') this.state = 'finished';
        }
      }
    }
    this.rank();
    // once the player has finished, wait a few seconds for rivals then stop updating race clock
    if (this.state === 'finished' && this.mode === 'race' && this.allFinished()) this.finishTimer = Math.max(this.finishTimer, 9999);
  };

  Sim.prototype.allFinished = function () {
    for (var i = 0; i < this.cars.length; i++) if (!this.cars[i].race.finished) return false;
    return true;
  };

  Sim.prototype.rank = function () {
    var sorted = this.cars.slice().sort(function (a, b) {
      var ra = a.race, rb = b.race;
      if (ra.finished && rb.finished) return ra.finishTime - rb.finishTime;
      if (ra.finished) return -1;
      if (rb.finished) return 1;
      return rb.dist - ra.dist;
    });
    for (var i = 0; i < sorted.length; i++) sorted[i].race.place = i + 1;
    this.standings = sorted;
    return sorted;
  };

  /* Final classification for the results screen. */
  Sim.prototype.results = function () {
    var L = this.track.length;
    var st = this.rank();
    var leader = st[0];
    return st.map(function (car, idx) {
      var r = car.race;
      var gapDist = leader.race.dist - r.dist;
      return {
        place: idx + 1, name: car.name, model: car.spec.name, isPlayer: car.isPlayer, car: car,
        finished: r.finished, time: r.finished ? r.finishTime : null, best: r.bestLap, penalty: r.penalty,
        gapTime: r.finished && leader.race.finished ? r.finishTime - leader.race.finishTime : null,
        lapsDown: r.finished ? 0 : Math.max(0, Math.ceil(gapDist / L - 0.001)), distBehind: gapDist
      };
    });
  };

  /* Put a car back on the road at its current position along the lap (facing forward, standing). */
  Sim.prototype.respawn = function (car, reason) {
    var track = this.track, v = car.vehicle, L = track.length;
    var s = v.loc.s, d = 0, tries = 0, p;
    var rl = track.line.off[v.loc.i] * 0.5;
    // find a free slot: step back along the road until no car is within 8 m
    for (;;) {
      p = track.pointAt(s, rl);
      var free = true;
      for (var i = 0; i < this.cars.length; i++) {
        var o = this.cars[i];
        if (o === car) continue;
        var dx = o.vehicle.x - p.x, dz = o.vehicle.z - p.z;
        if (dx * dx + dz * dz < 64) { free = false; break; }
      }
      if (free || tries > 12) break;
      s -= 7; tries++;
    }
    v.reset(p.x, p.z, p.heading, p.y);
    v.vx = 6;                                   // gentle roll so the car is not frozen
    v.gear = 1; v.damage = car.vehicle.damage;
    var loc = track.locate(p.x, p.z, -1, v.loc); v.hint = loc.i; v.groundY = p.y;
    var r = car.race;
    r.lastS = loc.s; r.wrongWay = 0;
    // dist is cumulative progress: keep the same lap progress (reset position can only move back slightly)
    var ds = loc.s - (((r.dist % L) + L) % L); if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    r.dist += ds;
    if (car.ai) { car.ai.stuckT = 0; car.ai.offRoadT = 0; car.ai.shift = 0; car.ai.steerCmd = 0; car.ai.mistake = null; }
    this.events.push({ type: 'respawn', car: car, reason: reason || 'reset' });
  };

  /* Fixed-step driver for the game loop. */
  Sim.prototype.advance = function (frameDt, playerInput) {
    this.accum += Math.min(frameDt, 0.1);
    var steps = 0;
    while (this.accum >= STEP && steps < 12) {
      this.step(playerInput);
      this.accum -= STEP; steps++;
    }
    if (steps === 12) this.accum = 0;
    return this.accum / STEP;   // interpolation alpha (not used for now)
  };

  /* Headless flying-lap for qualifying the AI. Returns lap time in seconds. */
  function simulateFlyingLap(track, spec, skill, seed) {
    var sim = new Sim({ track: track, laps: 2, mode: 'qualifying', seed: seed });
    var car = sim.addCar(spec, { name: 'AI', isPlayer: false, skill: skill, seed: seed, mistakeRate: 0 });
    var L = track.length;
    var s0 = L - 90, i0 = Math.round(s0 / track.ds) % track.N;
    var p = track.pointAt(s0, track.line.off[i0]);
    car.vehicle.reset(p.x, p.z, track.line.heading[i0], p.y);
    car.vehicle.vx = car.ai.profile[i0] * 0.9; car.vehicle.gear = 4;
    var loc = track.locate(p.x, p.z, -1, car.vehicle.loc); car.vehicle.hint = loc.i;
    car.race.dist = -90; car.race.lastS = loc.s;
    sim.state = 'racing'; sim.qualiLapsTarget = 1;
    var guard = 0;
    while (!car.race.finished && guard < 120 * 400) { sim.step(null); guard++; }
    return car.race.finished ? car.race.lapTimes[0] : null;
  }

  JR.sim = { Sim: Sim, EJECT_SPEED: EJECT_SPEED, EJECT_TIME: EJECT_TIME, STEP: STEP, simulateFlyingLap: simulateFlyingLap, CIRCLE_R: CIRCLE_R };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
