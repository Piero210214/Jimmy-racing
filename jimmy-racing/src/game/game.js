/* JIMMY RACING - game.js : application state machine, input, main loop.
 * States: loading -> menu -> setup -> [quali -> qualiSummary] -> grid(intro) -> countdown -> race -> results -> podium
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util, clamp = U.clamp, GL = JR.gl, P = GL.P, A = GL.A, Geo = GL.Geo;
  var CARS = JR.vehicle.CARS;
  var DEFAULTS = { quality: 'high', scale: 1, fps: 60, dyn: true, showFps: false, vol: { master: 0.8, music: 0.55, engine: 0.9, sfx: 0.9 }, carId: 'vortex', paint: 0xf5a300,
    time: 'noon', weather: 'clear', laps: 3, rivals: 4, diff: 'normal', assists: 'full', quali: false, obstacles: true, items: true, ver: 5 };
  var DIFF = { easy: { lo: 0.84, hi: 0.89, mist: 1.6 }, normal: { lo: 0.91, hi: 0.95, mist: 1.0 }, hard: { lo: 0.95, hi: 0.98, mist: 0.6 }, pro: { lo: 0.98, hi: 1.0, mist: 0.3 } };
  var ASSIST = { full: { abs: true, tc: true, stability: 0.7 }, mid: { abs: true, tc: true, stability: 0 }, none: { abs: false, tc: false, stability: 0 } };

  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } return null; }

  /* ---------------------------------------------------------------- input */
  function Input() {
    var self = this; this.keys = {}; this.t = 0; this.b = 0; this.s = 0; this.hand = 0; this.pad = null; this.pressed = {};
    G.addEventListener('keydown', function (e) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      if (!self.keys[e.code]) self.pressed[e.code] = true; self.keys[e.code] = true;
    });
    G.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    G.addEventListener('blur', function () { self.keys = {}; });
  }
  Input.prototype.consume = function (code) { var p = this.pressed[code]; this.pressed[code] = false; return !!p; };
  Input.prototype.read = function (dt, kmh) {
    var k = this.keys, pads = navigator.getGamepads ? navigator.getGamepads() : [], pad = null, i;
    for (i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    var tT = (k.ArrowUp || k.KeyW) ? 1 : 0, bT = (k.ArrowDown || k.KeyS) ? 1 : 0, sT = ((k.ArrowLeft || k.KeyA) ? 1 : 0) - ((k.ArrowRight || k.KeyD) ? 1 : 0), hT = k.Space ? 1 : 0;
    var analog = false;
    if (pad) {
      var ax = pad.axes[0] || 0; if (Math.abs(ax) < 0.08) ax = 0; else ax = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.35);
      var rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (Math.abs(ax) > 0 || rt > 0.02 || lt > 0.02) { analog = true; tT = Math.max(tT, rt); bT = Math.max(bT, lt); sT = sT || -ax; if (!sT) sT = -ax; }
      if (pad.buttons[0] && pad.buttons[0].pressed) hT = 1;
      if (pad.buttons[3] && pad.buttons[3].pressed && !this._yDown) this.pressed.KeyR = true; this._yDown = pad.buttons[3] && pad.buttons[3].pressed;
      if (pad.buttons[2] && pad.buttons[2].pressed && !this._xDown) this.pressed.KeyE = true; this._xDown = pad.buttons[2] && pad.buttons[2].pressed;
      if (pad.buttons[9] && pad.buttons[9].pressed && !this._sDown) this.pressed.Escape = true; this._sDown = pad.buttons[9] && pad.buttons[9].pressed;
      if (ax) { this.s += (-ax - this.s) * Math.min(1, dt * 18); sT = null; }
    }
    // throttle/brake ramps (keyboard); steering: progressive, self-centring, reduced authority at speed
    this.t += (tT - this.t) * Math.min(1, dt * (tT > this.t ? 7 : 12));
    this.b += (bT - this.b) * Math.min(1, dt * (bT > this.b ? 9 : 14));
    if (sT !== null) {
      var lim = 1 - 0.5 * clamp((kmh - 40) / 200, 0, 1), rate = (sT !== 0 ? (Math.sign(sT) === Math.sign(this.s) || this.s === 0 ? 2.6 : 5.5) : 5.0) * (1 - 0.35 * clamp(kmh / 250, 0, 1));
      var target = sT * lim, d = target - this.s, m = rate * dt; this.s += Math.abs(d) < m ? d : Math.sign(d) * m;
    }
    this.hand += (hT - this.hand) * Math.min(1, dt * 20);
    return { throttle: clamp(this.t, 0, 1), brake: clamp(this.b, 0, 1), steer: clamp(this.s, -1, 1), handbrake: this.hand };
  };
  Input.prototype.reset = function () { this.t = this.b = this.s = this.hand = 0; };

  /* ---------------------------------------------------------------- game */
  function Game() {
    this.settings = JSON.parse(JSON.stringify(DEFAULTS)); var sv = store('jr_settings');
    if (sv && sv.ver !== 5) { delete sv.rivals; delete sv.quali; }   // older saves: apply the new defaults (4 AI rivals on track from the start)
    if (sv) for (var k in sv) { if (k === 'vol') for (var q in sv.vol) this.settings.vol[q] = sv.vol[q]; else this.settings[k] = sv[k]; }
    var h = (G.location && G.location.hash) || ''; var m = /q=(ultra|high|medium|low)/.exec(h); if (m) this.settings.quality = m[1];
    this.best = store('jr_best'); this.state = 'loading'; this.paused = false; this.time = 0; this.fps = 60; this.frames = 0; this.fpsT = 0; this.acc = 0; this.last = 0;
    this.audio = new JR.Audio(); this.input = new Input(); this.hudOn = false; this.sim = null; this.cur = { input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 } };
  }
  Game.prototype.save = function () { store('jr_settings', this.settings); };

  Game.prototype.boot = function () {
    var self = this, canvas = document.getElementById('c');
    this.canvas = canvas; this.ui = new JR.UI(this); this.ui.show('loading', 'Generando circuito…');
    setTimeout(function () {
      try {
        self.track = JR.track.build(); self.ui.progress(0.2, 'Iniciando motor gráfico…');
        setTimeout(function () {
          try {
            self.R = new JR.Renderer(canvas, self.settings.quality, {}); self.R.setScale(self.settings.scale);
            self.ui.progress(0.45, 'Construyendo mundo (terreno, vegetación, edificios)…');
            setTimeout(function () { try { self._boot2(); } catch (e) { self.fatal(e); } }, 30);
          } catch (e) { self.fatal(e); }
        }, 30);
      } catch (e) { self.fatal(e); }
    }, 30);
  };
  Game.prototype.fatal = function (e) {
    console.error(e); var t = document.getElementById('loadtxt'); var msg = 'Error al iniciar: ' + (e && e.message ? e.message : e) + ' — se necesita un navegador con WebGL2.';
    if (t) t.textContent = msg; else this.ui.root.innerHTML = '<div class="center"><p>' + msg + '</p></div>'; G.__jrError = String(e && e.stack || e);
  };
  Game.prototype._boot2 = function () {
    var R = this.R, self = this;
    this.env = JR.env.make(this.settings.time, this.settings.weather); R.env = this.env;
    this.scene = JR.levels.SCENES.classic; this.levelId = 0;
    this.world = new JR.World(R, this.track, { scene: this.scene }); R.addLayer(this.world); this.world.updateEnv(this.env);
    this.gfx = new JR.CarsGfx(R); this.obst = new JR.ObstaclesGfx(R); this.itemsGfx = new JR.ItemsGfx(R); this.fx = new JR.Fx(R); this.debris = this.fx.debris = new JR.DebrisGfx(R); this.cam = new JR.ChaseCamera(R, this.world, this.track);
    this.ui._buildMini(this.track); this._buildPodium();
    this.ui.progress(0.95, 'Listo');
    G.addEventListener('resize', function () { self.resize(); }); this.resize();
    G.addEventListener('pointerdown', function () { self.audio.unlock(); }, { once: false }); G.addEventListener('keydown', function (e) { self.audio.unlock(); self.onKey(e); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && self.isRacing() && !self.paused && !(self.online && self.online.active)) self.pause(true); });
    this.last = performance.now(); var loop = function (now) { requestAnimationFrame(loop); self.frame(now); }; requestAnimationFrame(loop);
    this.enterMenu();
  };
  Game.prototype.resize = function () {
    var w = G.innerWidth, h = G.innerHeight, dpr = Math.min(G.devicePixelRatio || 1, 2);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.R.setViewport(w, h, dpr); this.ui.resize(w, h, dpr);
  };
  Game.prototype.isRacing = function () { return this.state === 'quali' || this.state === 'race' || this.state === 'intro' || this.state === 'tt' || this.state === 'prestart'; };

  /* ------------------------------------------------------------ menu scenes */
  /* campaign / online circuit: rebuild track + world + camera + minimap for level id (1..10); id 0/null = the classic scenery */
  Game.prototype.loadLevel = function (id, keepEnv) {
    id = id || 0; if (this.levelId === id && this.world) return false;
    var R = this.R, LV = JR.levels, L = id ? LV.byId(id) : null, sc = L ? LV.SCENES[L.scene] : LV.SCENES.classic, old = this.world, at = R.layers.indexOf(old), at2 = R.layers.indexOf(old && old.treeLayer);
    this.track = JR.track.build(L ? { circuit: L.circuitDef } : {});
    this.scene = sc; this.levelId = id; this.sceneName = sc.name;
    var w = new JR.World(R, this.track, { scene: sc });
    R.layers = R.layers.filter(function (l) { return l !== w && l !== w.treeLayer; });
    var nl = R.layers.indexOf(old); if (nl < 0) nl = 0;
    R.layers.splice(nl, 0, w, w.treeLayer);
    if (old) { R.layers = R.layers.filter(function (l) { return l !== old && l !== old.treeLayer; }); old.dispose && old.dispose(); }
    this.world = w; this.cam = new JR.ChaseCamera(R, w, this.track); this.ui._buildMini(this.track); this._buildPodium();
    if (!keepEnv) this._applyEnv(); else this.world.updateEnv(this.env);
    if (this.fx && this.fx.reset) this.fx.reset();
    return true;
  };
  Game.prototype._applyEnv = function () {
    var sc = this.scene || JR.levels.SCENES.classic, se = this.levelCampaign ? sc.env : null, time = this.settings.time, weather = this.settings.weather;
    if (se && se.time) time = se.time; if (se && se.weather) weather = se.weather;
    this.env = JR.env.applyScene(JR.env.make(time, weather), this.scene); this.R.env = this.env; this.env.weatherName = weather; this.world.updateEnv(this.env);
    this.R.exposureMul = 1;
  };
  Game.prototype._showcase = function () {
    var s = this.settings, spec = CARS[s.carId], tr = this.track, L = tr.length;
    this.gfx.clear(); this.fx.reset();
    var sim = this.sim = new JR.sim.Sim({ track: tr, laps: 1, mode: 'race', grip: 1 });
    var car = sim.addCar(spec, { name: 'TÚ', isPlayer: true, color: s.paint, assists: ASSIST.full }); this.player = car;
    var p = tr.pointAt(L - 52, -2.5); car.vehicle.reset(p.x, p.z, p.heading + 0.0, p.y); car.vehicle.locked = true;
    this.gfx.add(car); this.showPos = p; this.hudOn = false;
  };
  /* ------------------------------------------------------------ campaign (10 levels) */
  Game.prototype._campProgress = function () { if (!this._cstore) this._cstore = JR.levels.store(); return this._cstore.load(); };
  Game.prototype._applyCampaign = function (id) {                  // race rules of the level (temporary: restored when leaving the campaign)
    var L = JR.levels.byId(id), s = this.settings;
    if (!this._base) this._base = { laps: s.laps, rivals: s.rivals, diff: s.diff, quali: s.quali };
    s.laps = L.laps; s.rivals = L.rivals; s.diff = L.diff; s.quali = false; this.camp = { id: id }; this.levelCampaign = true; this.heavyHits = 0;
  };
  Game.prototype._leaveCampaign = function () {
    if (this._base) { var s = this.settings, b = this._base; s.laps = b.laps; s.rivals = b.rivals; s.diff = b.diff; s.quali = b.quali; this._base = null; }
    this.camp = null; this.levelCampaign = false; if (this.levelId) this.loadLevel(0);
  };
  Game.prototype._campaignMenu = function () {
    var self = this; this.state = 'menu'; this.paused = false; this.audio.endRace(); if (this.podium) this.podium.on = false; this.hudOn = false;
    this.camp = null; if (this._base) { var s = this.settings, b = this._base; s.laps = b.laps; s.rivals = b.rivals; s.diff = b.diff; s.quali = b.quali; this._base = null; }
    this.ui.show('loading', 'Cargando campaña…');
    setTimeout(function () { try { self._showcase(); self.cam.initialised = false; self.cam.cinTime = 0; self.cam.mode = 'orbit'; self.cam.blend = 1; self.R.fade = 1; self.ui.show('campaign', { prog: self._campProgress() }); } catch (e) { self.fatal(e); } }, 30);
  };
  Game.prototype.startLevel = function (id) {
    var self = this, prog = this._campProgress(); if (!JR.levels.isUnlocked(prog, id)) return;
    this.audio.stopMusic(); this.ui.show('loading', 'Cargando nivel ' + id + ': ' + JR.levels.byId(id).name + '…'); this.state = 'loading'; this.hudOn = false;
    setTimeout(function () {
      try { self._applyCampaign(id); self.loadLevel(id); self.startEvent('race'); } catch (e) { self.fatal(e); }
    }, 40);
  };
  Game.prototype._campaignResult = function (me, r) {
    var L = JR.levels.byId(this.camp.id), prog = this._campProgress(), rec = JR.levels.record(prog, L, { finished: !!r.finished, place: me.place, bestLap: r.bestLap || null, heavyHits: this.heavyHits || 0 });
    this._cstore.save(prog); rec.level = L; rec.heavy = this.heavyHits || 0; rec.bestLap = r.bestLap || null; rec.place = me.place; rec.champion = !!(rec.newlyDone && L.id === JR.levels.COUNT); return rec;
  };
  Game.prototype.enterMenu = function () {
    if (this.camp || this.levelId) this._leaveCampaign();
    if (this.online && this.online.active) this._onlineTeardown(true);
    this.state = 'menu'; this.paused = false; this.audio.endRace(); this._applyEnv(); this._showcase(); this.cam.initialised = false; this.cam.cinTime = 0; this.cam.mode = 'orbit'; this.cam.blend = 1;
    this.ui.show('main'); this.audio.unlock(); this.audio.startMusic(); this.R.fade = 1; this.podium && (this.podium.on = false);
  };
  Game.prototype.onAction = function (act, val, el) {
    var s = this.settings, self = this;
    if (act.indexOf('o_') === 0 || act === 'o_open') return this.onlineAction(act, val, el);
    switch (act) {
      case 'campaign': this._campaignMenu(); break;
      case 'lvl': this.startLevel(+val); break;
      case 'lvl_next': this.startLevel(this.camp ? this.camp.id + 1 : 1); break;
      case 'setup': this.state = 'setup'; this.mode = val; this.ui.show('setup', val); break;
      case 'settings': this.prevScreen = this.ui.screen; this.state = this.state === 'menu' ? 'settings' : this.state; this.ui.show('settings'); break;
      case 'settings_p': this.prevScreen = 'pause'; this.ui.show('settings'); break;
      case 'controls': this.state = 'settings'; this.prevScreen = 'main'; this.ui.show('controls'); break;
      case 'back':
        if (this.prevScreen === 'pause') { this.prevScreen = null; this.ui.show(this.online && this.online.active ? 'pauseO' : 'pause'); }
        else if (this.state === 'setup' && this.ui.screen === 'setup') this.enterMenu();
        else this.enterMenu();
        break;
      case 'car': s.carId = val; this.save(); this._showcase(); this.ui.show('setup', this.mode); break;
      case 'paint': s.paint = ASSIST_PAINT(val); this.save(); this._showcase(); this.ui.show('setup', this.mode); break;
      case 'start': this.startEvent(val); break;
      case 'fullscreen': try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { } break;
      case 'resume': this.pause(false); break;
      case 'restart': if (this.camp) this._applyCampaign(this.camp.id); this.startEvent(this.mode === 'tt' ? 'tt' : 'race', true); break;
      case 'quit': this.enterMenu(); break;
      case 'toGrid': this.startRace(); break;
      case 'retryQuali': this.startEvent('race', true); break;
      case 'podium': this.showPodium(); break;
      case 'results_back': this.state = 'results'; this.podium.on = false; this.ui.show('results', this.resultData); this.cam.chase(); break;
    }
  };
  function ASSIST_PAINT(i) { return JR.UI.PAINTS[+i]; }
  Game.prototype.onSetting = function (k, v) {
    if (k.indexOf('o_') === 0) return this.onlineSetting(k, v);
    var s = this.settings, R = this.R;
    if (k === 'time' || k === 'weather') { s[k] = v; this._applyEnv(); }
    else if (k === 'laps' || k === 'rivals') s[k] = +v;
    else if (k === 'obstacles') s.obstacles = +v === 1;
    else if (k === 'items') s.items = +v === 1;
    else if (k === 'quali') { s.quali = +v === 1; this.ui.show('setup', this.mode); }
    else if (k === 'diff' || k === 'assists') s[k] = v;
    else if (k === 'quality') { s.quality = v; R.setQuality(v); R.setScale(s.scale); this.resize(); }
    else if (k === 'scale') { s.scale = +v; R.setScale(s.scale); }
    else if (k === 'fps') s.fps = +v; else if (k === 'dyn') { s.dyn = !!v; if (!v) R.setAutoScale(1); } else if (k === 'showFps') s.showFps = !!v;
    else if (k.indexOf('vol_') === 0) { s.vol[k.slice(4)] = +v; this.audio.setVolumes(s.vol); }
    this.save();
  };

  /* ------------------------------------------------------------ event setup */
  Game.prototype._makeRivals = function () {
    var s = this.settings, rng = U.makeRng((Date.now() & 0xffff) + 7), ids = Object.keys(CARS), d = DIFF[s.diff], list = [], used = [s.paint];
    var names = JR.UI.NAMES.slice(); for (var i = names.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = names[i]; names[i] = names[j]; names[j] = t; }
    var paints = JR.UI.PAINTS.filter(function (c) { return c !== s.paint && c !== 0xc8102e && c !== 0x1b6dff; });
    // BOT 1 = metallic red, BOT 2 = metallic blue (both with black rims / black sport details); extra rivals use the other paints
    var BOT_PAINT = [0xd0101e, 0x1250e0];
    for (i = 0; i < s.rivals; i++) list.push({ spec: CARS[ids[(i + Math.floor(rng() * 3)) % ids.length]], name: names[i % names.length], color: i < 2 ? BOT_PAINT[i] : paints[i % paints.length], black: true, skill: d.lo + (d.hi - d.lo) * rng(), seed: 300 + i * 13, mist: d.mist });
    return list;
  };
  Game.prototype.startEvent = function (kind, retry) {
    var s = this.settings, self = this; this.mode = kind === 'tt' ? 'tt' : 'race'; this.audio.stopMusic(); this.audio.unlock();
    this._applyEnv(); this.ui.show('loading', 'Preparando evento…'); this.state = 'loading'; this.hudOn = false;
    this.rivals = kind === 'tt' ? [] : this._makeRivals(); this.aiQuali = null; this.qualiRows = null; this.ttLaps = null;
    setTimeout(function () {
      if (kind === 'tt') self._beginSession('tt');
      else if (s.quali) self._beginSession('quali');
      else { self.gridOrder = null; self.startRace(); }
    }, 40);
  };
  Game.prototype._newSim = function (mode, laps) {
    var s = this.settings, sim = new JR.sim.Sim({ track: this.track, laps: laps, mode: mode, seed: 11 + (Date.now() & 255), grip: this.env.grip, obstacles: s.obstacles !== false && mode !== 'tt' && this.mode !== 'tt', items: s.items !== false && mode === 'race' });
    sim.qualiLapsTarget = mode === 'qualifying' ? laps : sim.qualiLapsTarget; return sim;
  };
  Game.prototype._beginSession = function (kind) {            // 'quali' | 'tt'
    var s = this.settings, laps = kind === 'tt' ? s.laps + 1 : 2, sim = this.sim = this._newSim('qualifying', laps);
    sim.qualiLapsTarget = laps; this.gfx.clear(); this.fx.reset();
    var car = this.player = sim.addCar(CARS[s.carId], { name: 'TÚ', isPlayer: true, color: s.paint, assists: ASSIST[s.assists] });
    sim.setupGrid([car]); this.gfx.add(car); this.cur = { input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 } };
    this.state = 'prestart'; this.preT = 0; this.totalLaps = laps; this._startRaceCommon(kind);
    this.cam.initialised = false; this.cam.chase(); this.cam.snapTo(car); this.R.fade = 0;
    this.ui.message(kind === 'tt' ? 'CONTRARRELOJ' : 'CLASIFICACIÓN', 'big', 2.2);
  };
  Game.prototype.startRace = function () {
    var s = this.settings, tr = this.track, sim = this.sim = this._newSim('race', s.laps);
    this.gfx.clear(); this.fx.reset(); this.totalLaps = s.laps;
    var player = sim.addCar(CARS[s.carId], { name: 'TÚ', isPlayer: true, color: s.paint, assists: ASSIST[s.assists] }), cars = [player];
    this.rivals.forEach(function (r) { var rc = sim.addCar(r.spec, { name: r.name, isPlayer: false, color: r.color, skill: r.skill, seed: r.seed, mistakeRate: r.mist }); rc.blackRims = !!r.black; rc.accentColor = 0x0a0a0c; cars.push(rc); });
    // grid order from qualifying (or random draw)
    var order;
    if (this.gridTimes) { order = cars.slice().sort(function (a, b) { return (a.qt == null ? 1e9 : a.qt) - (b.qt == null ? 1e9 : b.qt); }); }
    else order = cars.slice();
    if (this.gridTimes) { var gt = this.gridTimes; cars.forEach(function (c, i) { c.qt = gt[i]; }); order = cars.slice().sort(function (a, b) { return (a.qt == null ? 1e9 : a.qt) - (b.qt == null ? 1e9 : b.qt); }); }
    else { order = cars.slice(); for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; } }
    sim.setupGrid(order); this.player = player; cars.forEach(function (c) { this.gfx.add(c); }, this);
    this.gridTimes = null; this.heavyHits = 0; this.state = 'intro'; this.introT = 0; this._startRaceCommon('race');
    this.ui.hide(); this.R.fade = 0;
  };
  Game.prototype._startRaceCommon = function (kind) {
    this.sessionKind = kind; this.hudOn = true; this.paused = false; this.input.reset(); this.finishT = 0; this.shown = false; this.lapCp = []; this.bestCp = null; this.cpHold = 0;
    this.audio.beginRace(this.sim.cars, this.player); this.audio.setVolumes(this.settings.vol); this.ui.hide(); this.ui.msgs.length = 0; this.fx.reset();
    this.world.lightsLit = 0; this.world.greenOn = false;
  };

  /* ------------------------------------------------------------ pause / keys */
  Game.prototype.pause = function (on) {
    if (this.online && this.online.active) return this._onlinePause(on);
    if (!this.isRacing() && !(this.state === 'results')) return; if (this.state === 'results') return;
    this.paused = on; this.audio.setPaused(on); if (on) this.ui.show('pause'); else this.ui.hide(); this.input.reset();
  };
  Game.prototype.onKey = function (e) {
    if (e.code === 'KeyM') { this.audio.mute(!this.audio.muted); }
    if ((e.code === 'Escape' || e.code === 'KeyP') && this.isRacing()) { if (this.paused && this.prevScreen === 'pause') { this.prevScreen = null; this.ui.show('pause'); } else this.pause(!this.paused); }
  };

  /* ------------------------------------------------------------ podium */
  Game.prototype._buildPodium = function () {
    var R = this.R, eng = R.eng, tr = this.track, mk = function (n) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 128; var c = cv.getContext('2d'); c.fillStyle = '#1b1e26'; c.fillRect(0, 0, 128, 128); c.fillStyle = n === 1 ? '#ffd23f' : (n === 2 ? '#d5d9e0' : '#d58a4a');
      c.font = 'italic 900 100px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(n, 64, 70); return eng.canvasTexture(cv, { clamp: true });
    };
    var p0 = tr.pointAt(70, 0), self = this; this.podium = { on: false, pos: p0, blocks: [], slots: [] };
    var hs = [1.5, 1.05, 0.7], lat = [0, 4.6, -4.6];
    for (var i = 0; i < 3; i++) {
      var g = new Geo(); g.append(P.box(4.2, hs[i], 4.2, [1, 1, 1, 1]), A.trs(0, hs[i] / 2, 0, 0, 1, 1, 1));
      var q = tr.pointAt(70, lat[i]);
      this.podium.blocks.push({ mesh: eng.mesh(g), mat: R.material({ t0: mk(i + 1), t1: R.tex.white.t1, rough: 0.6, metal: 0.1 }), xf: A.trs(q.x, q.y, q.z, q.heading, 1, 1, 1), y: q.y + hs[i], x: q.x, z: q.z, heading: q.heading });
    }
    if (!this._podiumLayer) { this._podiumLayer = true; R.addLayer({ drawShadow: function (R2) { self._drawPodium(R2); }, drawOpaque: function (R2) { self._drawPodium(R2); } }); }
  };
  Game.prototype._drawPodium = function (R) { if (!this.podium || !this.podium.on) return; this.podium.blocks.forEach(function (b) { R.drawMesh(b.mesh, b.xf, null, b.mat); }); };
  Game.prototype.showPodium = function () {
    var res = this.resultData.rows, pd = this.podium, order = [0, 1, 2], idx = [0, 1, 2];
    pd.on = true; this.state = 'podium'; this.ui.show('podium'); this.podiumT = 0;
    var slots = [pd.blocks[0], pd.blocks[1], pd.blocks[2]];
    for (var i = 0; i < 3 && i < res.length; i++) {
      var car = res[i].car, v = car.vehicle, b = slots[i];
      v.reset(b.x, b.z, b.heading + Math.PI, b.y); v.y = b.y; v.groundY = b.y; v.locked = true; v.heave = 0; v.pitch = 0; v.roll = 0;
    }
    for (; i < res.length; i++) { var c2 = res[i].car; c2.vehicle.y = -500; c2.vehicle.x = 5000; }
    this.audio.chime(this.resultData.place === 1 ? 'win' : (this.resultData.place <= 3 ? 'best' : 'lose'));
  };

  /* ------------------------------------------------------------ frame */
  Game.prototype.frame = function (now) {
    var cap = this.settings.fps, dtRaw = (now - this.last) / 1000;
    if (cap > 0 && dtRaw < 1 / cap - 0.0015) return;
    this.last = now; var dt = Math.min(dtRaw, 0.1); this.time += dt;
    // fps + dynamic resolution
    this.frames++; this.fpsT += dtRaw;
    if (this.fpsT >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0;
      if (this.settings.dyn) { var tgt = cap > 0 ? Math.min(cap, 60) : 60, a = this.R.autoScale; if (this.fps < tgt * 0.82 && a > 0.55) this.R.setAutoScale(Math.max(0.55, a - 0.08)); else if (this.fps >= tgt * 0.97 && a < 1) this.R.setAutoScale(Math.min(1, a + 0.04)); }
    }
    this.update(dt);
    if (this.obst) this.obst.set(this.sim && this.sim.obstacles && !(this.online && this.online.active) ? this.sim.obstacles : []);
    if (this.itemsGfx) this.itemsGfx.set(this.sim && !(this.online && this.online.active) ? this.sim : null, dt);
    this.R.render(dt);
    this.ui.update(dt);
    this.ui.draw(this._hudState());
  };

  Game.prototype.update = function (dt) {
    var R = this.R, sim = this.sim, cam = this.cam, car = this.player, st = this.state, i;
    if (R.fade < 1) R.fade = Math.min(1, R.fade + dt * 1.2);
    if (this.online && this.online.active) return this._updateOnline(dt);
    if (st === 'menu' || st === 'setup' || st === 'settings' || st === 'online' || st === 'lobby') {
      cam.orbit(dt, this.showPos.x, this.showPos.y, this.showPos.z, st === 'lobby' ? (this.lobbyR || 12) : 7.4, st === 'lobby' ? 2.6 : 1.5, 0.22, 36, st === 'menu' ? 2.6 : 3.4);
      this.gfx.update(R, dt); this.gfx.updateSpots(R, this.env.night > 0.5, car); this._fx(dt, [], false);
      return;
    }
    if (st === 'podium') {
      this.podiumT += dt; var pd = this.podium; cam.orbit(dt, pd.pos.x, pd.pos.y + 1.2, pd.pos.z, 15, 3.2, 0.16, 40);
      this.gfx.update(R, dt); this.gfx.updateSpots(R, this.env.night > 0.5, null);
      // confetti
      for (i = 0; i < 4; i++) { var a = Math.random() * 6.283, rr = Math.random() * 9, c = [[1, 0.2, 0.2], [0.2, 0.6, 1], [1, 0.85, 0.2], [0.3, 1, 0.4], [1, 1, 1]][Math.floor(Math.random() * 5)]; this.fx.spawn(3, pd.pos.x + Math.cos(a) * rr, pd.pos.y + 9 + Math.random() * 3, pd.pos.z + Math.sin(a) * rr, (Math.random() - 0.5) * 1.5, -1.5, (Math.random() - 0.5) * 1.5, 5, 0.09, 0, c[0], c[1], c[2], 1, 0.3, 0.2); }
      this._fx(dt, [], false); return;
    }
    if (!sim || !car) return;
    var kmh = Math.abs(car.vehicle.speedKmh), inp = this.input.read(dt, kmh);
    if (this.input.consume('KeyR') && !this.paused && (st === 'quali' || st === 'race' || st === 'tt')) { if (sim.state === 'racing') { sim.respawn(car, 'manual'); if (sim.mode === 'race') { car.race.penalty += 3; this.ui.message('+3 s PENALIZACIÓN', 'bad', 2); } cam.snapTo(car); } }
    this.input.consume('Escape');
    if (this.input.consume('KeyE') && !this.paused && sim.itemsOn && sim.state === 'racing' && car.item) sim.useItem(car);
    var events = [];
    if (!this.paused) {
      var play = inp;
      if (st === 'intro') {
        this.introT += dt; var tr = this.track, g = this.sim.ordered, p0 = car.vehicle;
        var t = this.introT, k = clamp(t / 5.2, 0, 1), s0 = tr.length - 8 - 55 * (1 - k * k * (3 - 2 * k)), pp = tr.pointAt(s0, 12 - 8 * k), look = tr.pointAt(tr.length - 18 - 10 * k, 0);
        cam.fixed(dt, [pp.x, pp.y + 2.6 - 0.8 * k, pp.z], [look.x, look.y + 0.9, look.z], 52 - 8 * k);
        play = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
        if (t > 5.2) { this.state = 'race'; cam.chase(); cam.snapTo(car); sim.beginCountdown(); this.ui.message('PREPARADOS', 'big', 1.6); }
      } else if (st === 'prestart') {
        this.preT += dt; play = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }; var cd = 3 - this.preT;
        if (this.preT > 0.6 && this.preT < 0.75 || (this.preT > 1.5 && this.preT < 1.6) || (this.preT > 2.5 && this.preT < 2.6)) { }
        if (this.preT >= 3.0) { this.state = this.sessionKind === 'tt' ? 'tt' : 'quali'; sim.beginQualifying(); this.ui.message('¡YA!', 'big', 1.2); this.audio.beep(true); }
        else this.ui.msgs.length || this.ui.message(String(Math.ceil(cd)), 'big', 0.95);
        cam.chase();
      } else cam.chase();
      sim.advance(dt, play); this.cur.input = play;
      events = sim.events.splice(0, sim.events.length);
      this._handle(events);
      if (sim.itemsOn) this._itemFx(dt);
    }
    if (st !== 'intro') cam.update(this.paused ? 0.0001 : dt, car, this.cur.input.brake > 0.3);
    this.gfx.update(R, dt);
    var s = car.vehicle.loc ? car.vehicle.loc.s : 0, tun = this.world.inTunnel(s); this.gfx.tunnel = tun;
    this.gfx.updateSpots(R, this.env.night > 0.5 || (this.env.rain > 0 && this.env.time !== 'noon'), car);
    this.world.lightsLit = sim.state === 'countdown' ? sim.lights : 0; this.world.greenOn = sim.state === 'racing' && sim.t < 1.8 && sim.mode === 'race';
    this._near(); this._fx(this.paused ? 0 : dt, events, tun);
    this.audio.update(dt, { player: car, env: this.env, camPos: R.camPos, camFwd: R.camFwd, camRight: R.camRight, tunnel: tun, paused: this.paused, crowdNear: this._crowd(s) });
    // finish handling
    if (sim.state === 'finished' && !this.shown) {
      this.finishT += dt;
      if (this.sessionKind === 'race' && this.finishT > 3.2) this._showResults();
      else if (this.sessionKind !== 'race' && this.finishT > 1.8) this._showSessionEnd();
    }
    if (sim.state === 'finished' && this.sessionKind === 'race') this.input.reset();
  };
  /* turbo flames, missile trails and the like (per frame, visual only) */
  Game.prototype._itemFx = function (dt) {
    var sim = this.sim, fx = this.fx, rng = Math.random, i, c, v, h, fx0, fz0, k;
    for (i = 0; i < sim.cars.length; i++) {
      c = sim.cars[i]; v = c.vehicle;
      if (c.boostT > 0) {
        h = v.heading; fx0 = Math.sin(h); fz0 = Math.cos(h); var back = v.spec.length * 0.5 + 0.2;
        for (k = -1; k <= 1; k += 2) {
          var bx = v.x - fx0 * back + fz0 * k * 0.55, bz = v.z - fz0 * back - fx0 * k * 0.55;
          fx.spawn(4, bx, v.y + 0.38, bz, -fx0 * (6 + rng() * 6) + v.vx * fx0 * 0.4, rng() * 0.6, -fz0 * (6 + rng() * 6) + v.vx * fz0 * 0.4, 0.22 + rng() * 0.2, 0.28 + rng() * 0.18, -0.5, 1.0, 0.45 + rng() * 0.3, 0.12, 0.9, 1.5, 0);
        }
        if (c === this.player) this.R.boostFov = Math.min(1, (this.R.boostFov || 0) + dt * 4);
      }
    }
    if (this.player && !(this.player.boostT > 0)) this.R.boostFov = Math.max(0, (this.R.boostFov || 0) - dt * 2.5);
    for (i = 0; i < sim.projectiles.length; i++) { var m = sim.projectiles[i]; fx.spawn(4, m.x, m.y, m.z, 0, 0.2, 0, 0.3, 0.55, -0.9, 1.0, 0.55, 0.15, 0.85, 1, 0); fx.spawn(0, m.x, m.y, m.z, 0, 0.5, 0, 0.9, 0.35, 1.2, 0.7, 0.7, 0.7, 0.35, 1.5, 0); }
  };
  Game.prototype._crowd = function (s) { var L = this.track.length, d = Math.min(Math.abs(s - 120), Math.abs(s - (L - 90)), Math.abs(s - 230)); return clamp(1 - d / 260, 0, 1); };
  Game.prototype._fx = function (dt, events, tun) {
    var sim = this.sim, R = this.R; if (!sim) return;
    this.fx.update(dt, { cars: sim.cars, gfx: this.gfx, env: this.env, track: this.track, events: events, camPos: R.camPos, camFwd: R.camFwd, tunnel: tun, tunnelNear: tun, groundY: this.player ? this.player.vehicle.y : 0, world: this.world, paused: this.paused });
    R.rainLens = (this.env.rain > 0 && !tun) ? 0.6 : 0;
  };
  Game.prototype._near = function () {
    var sim = this.sim, me = this.player; this.nearInfo = null; if (!sim || sim.mode !== 'race' || !sim.standings) return;
    var st = sim.standings, i = st.indexOf(me), res = { ahead: null, behind: null }, L = this.track.length;
    function t(a, b) { var d = Math.abs(a.race.dist - b.race.dist); return d / Math.max(20, (Math.abs(a.vehicle.speedKmh) + Math.abs(b.vehicle.speedKmh)) / 7.2); }
    if (i > 0 && !st[i - 1].race.finished) res.ahead = { car: st[i - 1], t: t(st[i - 1], me) };
    if (i < st.length - 1 && !me.race.finished && sim.state === 'racing') res.behind = { car: st[i + 1], t: t(st[i + 1], me) };
    this.nearInfo = res;
  };
  Game.prototype._handle = function (events) {
    var ui = this.ui, me = this.player, sim = this.sim, i, e;
    for (i = 0; i < events.length; i++) {
      e = events[i]; this.audio.event(e, this.R.camPos);
      if (e.type === 'light') { if (this.world) this.world.lightsLit = e.n; }
      else if (e.type === 'go') { if (sim.mode === 'race') { ui.goT = 1.2; ui.message('¡YA!', 'big', 1.2); } }
      else if (e.type === 'eject' && e.car === me) { ui.message('CHOQUE FUERTE · piloto fuera 3 s', 'bad', 2.8); this.cam.bump(1.5); }
      else if (e.type === 'ejectEnd' && e.car === me) ui.message('¡DE VUELTA EN CARRERA!', 'good', 1.4);
      else if (e.type === 'hit' && e.car === me) { this.cam.bump(clamp(e.speed / 12, 0.3, 1.5)); ui.flash = clamp(e.speed / 25, 0.15, 0.5); if (e.speed > 9 && !e.quiet) this.heavyHits = (this.heavyHits || 0) + 1; if (e.speed > 6) ui.message(e.wall ? 'IMPACTO CONTRA LA BARRERA' : 'COLISIÓN', 'bad', 1.4); }
      else if (e.type === 'checkpoint' && e.car === me) {
        var lt = e.t - me.race.lapStartT; this.lapCp.push(lt);
        if (this.bestCp && this.bestCp[e.index - 1] != null) ui.checkpointDelta(lt - this.bestCp[e.index - 1]);
      } else if (e.type === 'lap' && e.car === me) {
        if (e.best) { this.bestCp = this.lapCp.slice(); }
        this.lapCp = [];
        var done = me.race.lapsDone, tot = this.totalLaps;
        if (sim.mode === 'race' && done < tot) ui.message(done === tot - 1 ? 'ÚLTIMA VUELTA' : 'VUELTA ' + done + ' · ' + U.fmtTime(e.time), e.best ? 'good' : 'info', 2.6);
        else if (sim.mode !== 'race' && done < tot) ui.message((e.best ? 'MEJOR VUELTA ' : 'VUELTA ') + U.fmtTime(e.time), e.best ? 'good' : 'info', 2.6);
      } else if (e.type === 'finish' && e.car === me) { ui.message('¡META!', 'big', 2.4); this.audio.chime('win'); }
      else if (e.type === 'itemGet' && e.car === me) { ui.message('OBJETO: ' + JR.items.NAMES[e.item], 'good', 1.8); this.audio.chime('win'); }
      else if (e.type === 'itemUse') { if (e.car === me) ui.message('¡' + JR.items.NAMES[e.item] + '!', 'big', 1.2); else if (e.item === 'missile' || e.item === 'trap') ui.message(e.car.name + ' usa ' + JR.items.NAMES[e.item], 'info', 1.6); this.audio.beep(true); if (e.item === 'missile') this.audio.beep(false); }
      else if (e.type === 'itemHit') { if (e.car === me) { ui.message(e.kind === 'missile' ? 'TE ALCANZÓ UN PROYECTIL' : 'PISASTE UNA TRAMPA', 'bad', 2); this.cam.bump(0.9); ui.flash = 0.35; } else if (e.by === me) ui.message('¡IMPACTO EN ' + e.car.name + '!', 'good', 1.6); this.fx.sparks(e.x, e.y, e.z, 0, 0, 22, 1.6); }
      else if (e.type === 'shieldBlock') { if (e.car === me) ui.message('ESCUDO ACTIVADO: ATAQUE BLOQUEADO', 'good', 1.8); else if (e.by === me) ui.message(e.car.name + ' bloqueó tu ataque', 'info', 1.5); this.fx.sparks(e.car.vehicle.x, e.car.vehicle.y + 0.7, e.car.vehicle.z, 0, 0, 30, 1.2); }
      else if (e.type === 'boom') { this.fx.sparks(e.x, e.y, e.z, 0, 0, 14, 1.2); }
      else if (e.type === 'respawn' && e.car === me && e.reason === 'stuck') ui.message('REPOSICIONADO', 'info', 1.5);
    }
  };

  /* ------------------------------------------------------------ session ends */
  Game.prototype._showSessionEnd = function () {
    this.shown = true; var sim = this.sim, r = this.player.race, self = this, s = this.settings;
    this.paused = true; this.state = 'summary'; this.audio.endRace();
    if (this.sessionKind === 'tt') {
      var fl = r.lapTimes.slice(1), best = Math.min.apply(null, fl.length ? fl : r.lapTimes), rec = !this.best || best < this.best; if (rec) { this.best = best; store('jr_best', best); }
      this.ui.show('ttSummary', { laps: r.lapTimes, best: best, record: rec }); return;
    }
    // qualifying: simulate the rivals' flying laps
    this.ui.show('loading', 'Calculando tiempos de los rivales…');
    setTimeout(function () {
      var rows = [], pt = r.qualifyBest;
      rows.push({ name: 'TÚ', model: CARS[s.carId].name, time: pt, isPlayer: true });
      self.rivals.forEach(function (rv) { rows.push({ name: rv.name, model: rv.spec.name, time: JR.sim.simulateFlyingLap(self.track, rv.spec, rv.skill, rv.seed) || 999, isPlayer: false }); });
      var sorted = rows.slice().sort(function (a, b) { return a.time - b.time; });
      self.gridTimes = [pt].concat(rows.slice(1).map(function (x) { return x.time; }));
      self.state = 'summary'; self.ui.show('qualiSummary', { rows: sorted, playerPos: sorted.findIndex(function (x) { return x.isPlayer; }) + 1 });
    }, 30);
  };
  Game.prototype._showResults = function () {
    this.shown = true; var sim = this.sim, res = sim.results(), me = res.find(function (r) { return r.isPlayer; }), r = this.player.race;
    if (r.bestLap && (!this.best || r.bestLap < this.best)) { this.best = r.bestLap; store('jr_best', this.best); }
    this.resultData = { rows: res, place: me.place, camp: this.camp ? this._campaignResult(me, r) : null }; this.state = 'results'; this.ui.show('results', this.resultData); this.audio.chime(me.place === 1 ? 'win' : (me.place <= 3 ? 'best' : 'lose'));
    this.hudOn = false;
  };

  /* ------------------------------------------------------------ HUD state */
  Game.prototype._hudState = function () {
    var fps = this.settings.showFps ? this.fps + ' FPS · ' + this.R.W + '×' + this.R.H : null;
    if (!this.hudOn || !this.sim || !this.player || this.paused && false) return { hud: false, fps: fps };
    var sim = this.sim, on = this.online && this.online.active; return { tags: on ? this._tags() : null, netInfo: on ? { status: this.net.status, ping: this.net.rtt, players: sim.cars.length } : null, hud: true, sim: sim, player: this.player, env: this.env, input: this.cur.input, totalLaps: this.totalLaps, standings: sim.standings, trackLen: this.track.length, near: this.nearInfo, time: this.time, fps: fps, ttBest: this.best };
  };

  G.JRGame = Game;
  JR.Game = Game; JR.DIFF = DIFF;
})();
