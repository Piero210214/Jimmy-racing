/* JIMMY RACING - online.js : multiplayer integration for Game (menu, lobby, remote cars, HUD hooks).
 * The server is authoritative: this client only sends controls and renders the states it receives.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  var JR = G.JR, U = JR.util, clamp = U.clamp, NET = JR.net, CARS = JR.vehicle.CARS, Game = JR.Game;
  var DELAY = 0.12;                      // interpolation delay for remote cars (s)
  var ZERO = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

  function localPoint(v, px, pz) { var sh = Math.sin(v.heading), ch = Math.cos(v.heading), dx = px - v.x, dz = pz - v.z; return { x: dx * sh + dz * ch, y: dx * ch - dz * sh }; }

  Game.prototype._ensureNet = function () {
    if (this.net) return; var self = this;
    this.net = new JR.NetClient({ onMessage: function (m) { self._onNetMsg(m); }, onStatus: function () { self._onNetStatus(); }, onLost: function () { self._onlineLost(); } });
  };
  Game.prototype._prefs = function () { var s = this.settings; return { name: s.name || '', car: s.carId, paint: s.paint, assists: s.assists }; };
  Game.prototype._onlineRender = function () {
    var o = this.online; if (!o || o.active) return;
    if (this.state === 'online') this.ui.show('online', { status: this.net.status, rtt: this.net.rtt, rooms: o.rooms, err: o.err, name: this.settings.name || '', code: o.code || '' });
    else if (this.state === 'lobby' && o.room) this.ui.show('lobby', { room: o.room, me: this.net.pid, rtt: this.net.rtt, err: o.err });
  };
  Game.prototype._onNetStatus = function () { var o = this.online; if (!o) return; if (this.state === 'online') this._onlineRender(); };

  /* ---------------------------------------------------------------- actions */
  Game.prototype.onlineAction = function (act, val) {
    var s = this.settings, net, o;
    if (act === 'o_open') {
      this._ensureNet(); net = this.net; this.online = { active: false, rooms: [], room: null, err: null, code: '', evq: [], cars: {} };
      this.audio.unlock(); this.state = 'online'; this._showcase(); this._onlineRender(); net.connect(s.name || ''); return;
    }
    net = this.net; o = this.online; if (!net || !o) return; o.err = null;
    switch (act) {
      case 'o_exit': net.disconnect(); this.online = null; this.enterMenu(); return;
      case 'o_list': net.send({ t: 'list' }); break;
      case 'o_quick': o.quick = true; net.send({ t: 'list' }); break;
      case 'o_create': net.send(Object.assign(this._prefs(), { t: 'create', laps: 3, time: s.time, weather: s.weather, priv: true, max: 5, circuit: 1 })); break;
      case 'o_start': net.send({ t: 'start' }); break;
      case 'o_kick': net.send({ t: 'kick', pid: +val }); break;
      case 'o_close': net.send({ t: 'close' }); break;
      case 'o_join': net.send(Object.assign(this._prefs(), { t: 'join', code: val })); break;
      case 'o_joinCode':
        var code = (o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 5) { o.err = 'El código tiene 5 caracteres'; this._onlineRender(); return; }
        net.send(Object.assign(this._prefs(), { t: 'join', code: code })); break;
      case 'o_car': s.carId = val; this.save(); net.send(Object.assign(this._prefs(), { t: 'prefs' })); break;
      case 'o_paint': s.paint = JR.UI.PAINTS[+val]; this.save(); net.send(Object.assign(this._prefs(), { t: 'prefs' })); break;
      case 'o_ready': var me = o.room && o.room.players.find(function (p) { return p.pid === net.pid; }); net.send({ t: 'ready', v: !(me && me.ready) }); break;
      case 'o_leave':
        net.send({ t: 'leave' }); if (o.active) this._onlineTeardown(false); o.room = null; o.err = null;
        this.state = 'online'; this.loadLevel(0, true); this._applyEnv(); this._showcase(); this._onlineRender(); net.send({ t: 'list' }); return;
      case 'o_again': net.send({ t: 'again' }); break;
    }
    this._onlineRender();
  };
  Game.prototype.onlineSetting = function (k, v) {
    var o = this.online, net = this.net, s = this.settings; if (!o || !net) return;
    if (k === 'o_name') { s.name = String(v).replace(/[^\p{L}\p{N} _\-.]/gu, '').slice(0, 16); this.save(); }
    else if (k === 'o_code') o.code = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    else if (k === 'o_assists') { s.assists = v; this.save(); net.send(Object.assign(this._prefs(), { t: 'prefs' })); }
    else if (k === 'o_laps') net.send({ t: 'cfg', laps: +v });
    else if (k === 'o_bots') net.send({ t: 'cfg', bots: +v });
    else if (k === 'o_circuit') net.send({ t: 'cfg', circuit: +v });
    else if (k === 'o_max') net.send({ t: 'cfg', max: +v });
    else if (k === 'o_time') net.send({ t: 'cfg', time: v });
    else if (k === 'o_weather') net.send({ t: 'cfg', weather: v });
    else if (k === 'o_priv') net.send({ t: 'cfg', priv: v === '1' });
  };

  /* ---------------------------------------------------------------- messages */
  Game.prototype._setEnvNow = function (time, weather) {
    if (this.env && this.env.time === time && this.env.weatherName === weather && this.env.scene === this.scene.id) return;
    this.env = JR.env.applyScene(JR.env.make(time, weather), this.scene); this.env.weatherName = weather; this.R.env = this.env; this.world.updateEnv(this.env); this.R.exposureMul = 1;
  };
  Game.prototype._onNetMsg = function (m) {
    var o = this.online, net = this.net, self = this; if (!o) return;
    switch (m.t) {
      case 'welcome': if (this.state === 'online') net.send({ t: 'list' }); this._onlineRender(); break;
      case 'rooms':
        o.rooms = m.rooms;
        if (o.quick) { o.quick = false; if (m.rooms.length) net.send(Object.assign(this._prefs(), { t: 'join', code: m.rooms[0].code })); else net.send(Object.assign(this._prefs(), { t: 'create', laps: 3, time: this.settings.time, weather: this.settings.weather, priv: false })); }
        this._onlineRender(); break;
      case 'room':
        o.room = m; o.err = null;
        if (this.state === 'online') { this.state = 'lobby'; }
        if (this.state === 'lobby') { if (this.loadLevel(m.circuit || 1, true)) o.lobbySig = null; this._setEnvNow(m.time, m.weather); this._lobbyScene(m); this._onlineRender(); }
        break;
      case 'error':
        o.err = m.text; if (o.quick) o.quick = false; this._onlineRender();
        if (m.code === 'started' || m.code === 'no_room') net.send({ t: 'list' }); break;
      case 'closed': m = { t: 'left', why: 'closed' };
      /* falls through */
      case 'left': o.room = null; if (o.active) { this._onlineTeardown(false); } if (this.state === 'lobby' || o.active) { this.state = 'online'; this.loadLevel(0, true); this._applyEnv(); this._showcase(); o.err = m.why === 'timeout' ? 'Se agotó el tiempo de reconexión' : (m.why === 'kicked' ? 'El anfitrión te ha expulsado de la sala' : (m.why === 'closed' ? 'El anfitrión cerró la sala' : null)); this._onlineRender(); net.send({ t: 'list' }); } break;
      case 'grid': this._onlineStart(m); break;
      case 'snap': this._queueEvents(m.ev); break;
      case 'results': o.resultsMsg = m; o.resultsT = (o.fin ? 2.6 : 0.4); break;
      case 'lobby': this._onlineTeardown(false); this.state = 'lobby'; this.hudOn = false; this._setEnvNow(o.room ? o.room.time : 'noon', o.room ? o.room.weather : 'clear'); if (o.room) this._lobbyScene(o.room, true); this._onlineRender(); break;
    }
  };
  Game.prototype._onlineLost = function () {
    var o = this.online; if (!o) return; if (o.active) this._onlineTeardown(false); o.room = null; this.state = 'online'; this.loadLevel(0, true); this._applyEnv(); this._showcase(); o.err = 'Se perdió la conexión con el servidor'; this._onlineRender();
  };

  /* ---------------------------------------------------------------- 3D lobby: every player's car on the grid */
  Game.prototype._lobbyScene = function (room, force) {
    var sig = room.players.map(function (p) { return p.pid + ':' + p.car + ':' + p.paint; }).join('|'), o = this.online;
    if (!force && o.lobbySig === sig && this.sim) return; o.lobbySig = sig;
    var tr = this.track, sim = this.sim = new JR.sim.Sim({ track: tr, laps: 1, mode: 'race' }), cars = [], me = null, self = this;
    this.gfx.clear(); this.fx.reset();
    room.players.forEach(function (p) { var c = sim.addCar(CARS[p.car] || CARS.vortex, { name: p.name, human: true, color: p.paint, isPlayer: p.pid === self.net.pid }); cars.push(c); if (p.pid === self.net.pid) me = c; self.gfx.add(c); });
    sim.setupGrid(cars); this.player = me || cars[0]; var rows = Math.ceil(cars.length / 2), L = tr.length;
    this.showPos = tr.pointAt(L - 12 - (rows - 1) * 5.5 - 2.7, 0); this.lobbyR = 9 + rows * 3.2; this.hudOn = false;
  };

  /* ---------------------------------------------------------------- race start */
  Game.prototype._onlineStart = function (g) {
    var o = this.online, tr = this.track, self = this, net = this.net; if (!o) return;
    this.audio.stopMusic(); this.audio.unlock(); this.loadLevel(g.circuit || 1, true); tr = this.track; this._setEnvNow(g.time, g.weather);
    var sim = this.sim = new JR.sim.Sim({ track: tr, laps: g.laps, mode: 'race', grip: NET.GRIP[g.weather] || 1 });
    this.gfx.clear(); this.fx.reset(); this.totalLaps = g.laps; o.cars = {}; o.evq = []; o.fin = false; o.resultsMsg = null; o.resultsT = 0; o.myPid = net.pid; o.respT = 0;
    var order = [];
    g.grid.slice().sort(function (a, b) { return a.slot - b.slot; }).forEach(function (e) {
      var c = sim.addCar(CARS[e.car] || CARS.vortex, { name: e.name, human: true, isPlayer: e.pid === net.pid, color: e.paint });
      c.pid = e.pid; o.cars[e.pid] = c; order.push(c); self.gfx.add(c); if (e.pid === net.pid) self.player = c;
    });
    sim.setupGrid(order); this.mode = 'race'; this.cur = { input: ZERO };
    o.active = true; o.introStart = 0; this.state = g.resume ? 'race' : 'intro'; this.introT = 0; this._startRaceCommon('race'); this.ui.hide(); this.R.fade = g.resume ? 1 : 0;
    this.input.reset(); o.smooth = null;
    if (g.resume) { this.cam.chase(); this.cam.snapTo(this.player); }
    setTimeout(function () { net.send({ t: 'loaded' }); }, 250);
  };
  Game.prototype._onlineTeardown = function (toMenu) {
    var o = this.online; if (!o) return;
    o.active = false; this.audio.endRace(); this.hudOn = false; this.paused = false; this.ui.msgs.length = 0;
    if (this.sim) { this.gfx.clear(); this.fx.reset(); }
    if (toMenu) { try { this.net.send({ t: 'leave' }); this.net.disconnect(); } catch (e) { } this.online = null; }
    else { o.lobbySig = null; this.net.reset(); }
  };
  Game.prototype._onlinePause = function (on) {
    var open = this.ui.screen === 'pauseO' || this.ui.screen === 'settings'; if (on && open) on = false;
    if (this.state === 'oresults') return;
    if (on) this.ui.show('pauseO'); else { this.ui.hide(); this.prevScreen = null; }
    this.input.reset();
  };

  /* ---------------------------------------------------------------- events from the server */
  Game.prototype._queueEvents = function (evs) {
    var o = this.online; if (!o || !o.active || !evs) return; var C = o.cars, me = this.player, self = this;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], c = C[e.pid], out = null;
      switch (e.e) {
        case 'light': out = { type: 'light', n: e.n }; break;
        case 'go': out = { type: 'go' }; break;
        case 'cp': if (c) out = { type: 'checkpoint', car: c, index: e.i, t: e.t }; break;
        case 'lap': if (c) { c.race.lapTimes.push(e.time); out = { type: 'lap', car: c, lap: e.lap, time: e.time, best: !!e.best }; } break;
        case 'fin': if (c) { out = { type: 'finish', car: c }; if (c === me) o.fin = true; } break;
        case 'ej': if (c) out = { type: 'eject', car: c, speed: e.sp || 20, x: c.vehicle.x, y: c.vehicle.y, z: c.vehicle.z, src: 'net' }; break;
        case 'ejend': if (c) out = { type: 'ejectEnd', car: c }; break;
        case 'hit': if (c) out = { type: 'hit', car: c, other: C[e.o] || null, speed: e.sp, x: e.x, y: e.y, z: e.z, wall: !!e.w, quiet: !!e.q, lp: localPoint(c.vehicle, e.x, e.z) }; break;
        case 'scr': if (c) out = { type: 'scrape', car: c, x: e.x, y: e.y, z: e.z }; break;
        case 'resp': if (c) { out = { type: 'respawn', car: c, reason: e.r }; if (c === me && e.r === 'manual') this.ui.message('+3 s PENALIZACIÓN', 'bad', 2); } break;
        case 'left': if (c) { var sim = this.sim, ix = sim.cars.indexOf(c); if (ix >= 0) sim.cars.splice(ix, 1); this.gfx.remove(c); c.vehicle.y = -500; c.vehicle.x = 5000; delete C[e.pid]; this.ui.message(c.name + ' ha abandonado', 'info', 2.2); } break;
      }
      if (out) o.evq.push(out);
    }
  };

  /* ---------------------------------------------------------------- state application */
  function applyState(game, car, s, own, dt) {
    var v = car.vehicle, V = s.veh, k, i, tr = game.track, o = game.online;
    var keepX = v.x, keepZ = v.z, keepH = v.heading, keepY = v.y, smooth = own && o.smooth && o.smooth.pid === car.pid;
    for (k in V) v[k] = V[k];
    if (smooth) {                                         // damp the 24 Hz stepping of my own car; snap if far off
      var dx = V.x - keepX, dz = V.z - keepZ;
      if (dx * dx + dz * dz < 36) { var a = 1 - Math.exp(-dt * 40); v.x = keepX + dx * a; v.z = keepZ + dz * a; v.y = keepY + (V.y - keepY) * a; v.heading = keepH + NET.angDiff(keepH, V.heading) * a; }
    }
    if (own) o.smooth = { pid: car.pid };
    for (i = 0; i < 4; i++) v.wheelAngle[i] = s.wheels[i];
    v.gear = s.gear; v.airborne = !!s.airborne; v.absActive = s.absActive; v.tcActive = s.tcActive; v.reversing = !!s.reversing; v.surfaceNow = { id: s.surf };
    v.engineLoad = V.throttle; v.steer = V.steerAngle; v.steerInput = V.steerAngle;
    var loc = tr.locate(v.x, v.z, v.hint == null ? -1 : v.hint, v.loc); v.hint = loc.i;
    var st = game.sim.state; v.locked = (st === 'grid' || st === 'countdown');
    var r = car.race, R = s.race; r.lapsDone = R.lapsDone; r.dist = R.dist; r.place = R.place; r.nextCp = R.nextCp; r.bestLap = R.bestLap; r.finishTime = R.finishTime; r.penalty = R.penalty; r.lapStartT = R.lapStartT; r.finished = s.finished; r.started = R.dist >= 0;
    car.damageZones = s.zones; car.input = { throttle: V.throttle, brake: V.brake, steer: 0, handbrake: 0 };
    var rel = Math.abs(U.wrapAngle(v.heading - loc.heading)); if (rel > 2.0 && v.speedKmh > 5) r.wrongWay += dt; else r.wrongWay = Math.max(0, r.wrongWay - dt * 2);
  }
  Game.prototype._onlineApply = function (dt) {
    var o = this.online, net = this.net, sim = this.sim, latest = net.latest(); if (!latest) return false;
    sim.state = latest.st; sim.t = latest.sim; sim.lights = latest.li;
    var ts = net.serverNow(), rt = ts == null ? null : ts - DELAY, pid, me = this.player;
    for (pid in o.cars) {
      var car = o.cars[pid], own = car === me, s = own ? net.own(car.pid) : (rt == null ? null : net.sample(+pid, rt));
      if (!s) s = latest.cars[pid]; if (!s) continue;
      applyState(this, car, s, own, dt);
    }
    sim.rank(); return true;
  };

  /* ---------------------------------------------------------------- per-frame (replaces single-player update while online) */
  Game.prototype._updateOnline = function (dt) {
    var R = this.R, sim = this.sim, cam = this.cam, me = this.player, o = this.online, net = this.net, st = this.state, tr = this.track, i;
    if (R.fade < 1) R.fade = Math.min(1, R.fade + dt * 1.2);
    if (!sim || !me) return;
    var have = this._onlineApply(dt), events = o.evq.splice(0, o.evq.length);
    if (st === 'oresults') {
      cam.orbit(dt, me.vehicle.x, me.vehicle.y + 0.5, me.vehicle.z, 9, 2.2, 0.15, 40, 0); this.gfx.update(R, dt); this.gfx.updateSpots(R, this.env.night > 0.5, me); this._fx(dt, [], false); return;
    }
    var kmh = Math.abs(me.vehicle.speedKmh), inp = this.input.read(dt, kmh), menuOpen = !!(this.ui.screen === 'pauseO' || this.ui.screen === 'settings');
    if (this.input.consume('KeyR') && !menuOpen && sim.state === 'racing' && !me.race.finished && performance.now() - (o.lastResp || 0) > 3000) { o.lastResp = performance.now(); net.send({ t: 'respawn' }); }
    this.input.consume('Escape');
    var play = (menuOpen || me.race.finished) ? ZERO : inp;
    if (st === 'intro') {
      if (!o.introStart) o.introStart = performance.now(); this.introT = (performance.now() - o.introStart) / 1000;   // wall clock: the server countdown does not wait for slow frames
      var g = me.vehicle, t = this.introT, k = clamp(t / 5.2, 0, 1), s0 = tr.length - 8 - 55 * (1 - k * k * (3 - 2 * k)), pp = tr.pointAt(s0, 12 - 8 * k), look = tr.pointAt(tr.length - 18 - 10 * k, 0);
      cam.fixed(dt, [pp.x, pp.y + 2.6 - 0.8 * k, pp.z], [look.x, look.y + 0.9, look.z], 52 - 8 * k);
      play = ZERO;
      if (t > 5.2 || sim.state === 'racing') { this.state = 'race'; cam.chase(); cam.snapTo(me); this.ui.message('PREPARADOS', 'big', 1.6); }
    } else cam.chase();
    net.sendInput(play, performance.now()); this.cur.input = play;
    this._handle(events);
    if (this.state !== 'intro') cam.update(dt, me, play.brake > 0.3);
    this.gfx.update(R, dt);
    var s = me.vehicle.loc ? me.vehicle.loc.s : 0, tun = this.world.inTunnel(s); this.gfx.tunnel = tun;
    this.gfx.updateSpots(R, this.env.night > 0.5 || (this.env.rain > 0 && this.env.time !== 'noon'), me);
    this.world.lightsLit = sim.state === 'countdown' ? sim.lights : 0; this.world.greenOn = sim.state === 'racing' && sim.t < 1.8;
    this._near(); this._fx(dt, events, tun);
    this.audio.update(dt, { player: me, env: this.env, camPos: R.camPos, camFwd: R.camFwd, camRight: R.camRight, tunnel: tun, paused: false, crowdNear: this._crowd(s) });
    if (o.resultsMsg) { o.resultsT -= dt; if (o.resultsT <= 0) this._onlineResults(); }
  };
  Game.prototype._onlineResults = function () {
    var o = this.online, m = o.resultsMsg, me = o.myPid; o.resultsMsg = null; if (!m) return;
    var rows = m.rows.map(function (r) { return { place: r.place, name: r.name, model: r.model, isPlayer: r.pid === me, finished: r.finished, time: r.time, gapTime: r.gapTime, best: r.best, left: !!r.left }; });
    var mine = rows.find(function (r) { return r.isPlayer; });
    this.state = 'oresults'; this.hudOn = false; this.audio.endRace(); this.ui.show('oresults', { rows: rows, place: mine ? mine.place : rows.length });
    this.audio.chime(mine && mine.place === 1 ? 'win' : (mine && mine.place <= 3 ? 'best' : 'lose'));
  };

  /* player name tags, projected with the camera matrix */
  Game.prototype._tags = function () {
    var o = this.online, R = this.R, ui = this.ui, m = R.viewProj, out = [], me = this.player, cp = R.camPos; if (!o || !me || this.state === 'intro') return out;
    for (var pid in o.cars) {
      var c = o.cars[pid]; if (c === me) continue; var v = c.vehicle, X = v.x, Y = v.y + 1.7, Z = v.z;
      var d = Math.hypot(X - cp[0], Y - cp[1], Z - cp[2]); if (d > 170) continue;
      var cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]; if (cw < 0.5) continue;
      var cx = (m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw, cy = (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw; if (Math.abs(cx) > 1.1 || Math.abs(cy) > 1.1) continue;
      out.push({ x: (cx * 0.5 + 0.5) * ui.W, y: (1 - (cy * 0.5 + 0.5)) * ui.H, name: c.name, place: c.race.place, d: Math.hypot(v.x - me.vehicle.x, v.z - me.vehicle.z), ahead: c.race.place < me.race.place });
    }
    return out;
  };
})();
