/* JIMMY RACING - audio.js : fully synthesised audio (WebAudio, no external assets)
 * RPM-driven engines (player + nearby rivals with doppler/pan/distance), gear shifts & backfires, brake squeal, tyre skid,
 * kerb/gravel rumble, collisions, wind, rain, crowd, tunnel reverb, countdown beeps and procedural menu music.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util, clamp = U.clamp;

  var ENGINE = {      // fundamental = rpm/60 * cyl/2
    vortex: { cyl: 6, grit: 0.55, whistle: 0, bass: 0.75, bright: 1.0 },
    falcon: { cyl: 4, grit: 0.45, whistle: 0.6, bass: 0.45, bright: 1.35 },
    titan: { cyl: 8, grit: 0.9, whistle: 0, bass: 1.2, bright: 0.7 }
  };

  function Audio() {
    this.ctx = null; this.ok = false; this.vol = { master: 0.8, engine: 0.9, music: 0.55, sfx: 0.9 };
    this.voices = []; this.musicOn = false; this.raceOn = false; this.lastGear = {}; this.tun = 0;
    this.nextNote = 0; this.step = 0; this.timer = null; this.muted = false;
  }

  Audio.prototype.unlock = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ok; }
    var AC = G.AudioContext || G.webkitAudioContext; if (!AC) return false;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    var c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    // buses
    this.busEngine = c.createGain(); this.busSfx = c.createGain(); this.busAmb = c.createGain(); this.busMusic = c.createGain();
    // tunnel / exterior filter on the world buses
    this.world = c.createGain(); this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.busEngine.connect(this.world); this.busSfx.connect(this.world); this.busAmb.connect(this.world);
    this.world.connect(this.lp); this.lp.connect(this.master);
    this.reverb = c.createConvolver(); this.reverb.buffer = this._impulse(2.4, 2.6); this.revSend = c.createGain(); this.revSend.gain.value = 0.06;
    this.world.connect(this.revSend); this.revSend.connect(this.reverb); this.reverb.connect(this.master);
    this.busMusic.connect(this.master);
    // noise source
    var nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0), b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < d.length; i++) { var w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.noiseBuf = nb;
    var wb = c.createBuffer(1, c.sampleRate * 1, c.sampleRate), wd = wb.getChannelData(0); for (i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1; this.whiteBuf = wb;
    this._ambient();
    this.ok = true; this.applyVolumes();
    if (c.state === 'suspended') c.resume();
    return true;
  };
  Audio.prototype._impulse = function (sec, decay) {
    var c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  };
  Audio.prototype._noise = function (buf, loop) { var s = this.ctx.createBufferSource(); s.buffer = buf || this.noiseBuf; s.loop = loop !== false; s.start(0, Math.random() * 0.8); return s; };
  Audio.prototype.setVolumes = function (v) { for (var k in v) this.vol[k] = v[k]; this.applyVolumes(); };
  Audio.prototype.applyVolumes = function () {
    if (!this.ok) return;
    var t = this.ctx.currentTime, m = this.muted ? 0 : this.vol.master;
    this.master.gain.setTargetAtTime(m, t, 0.03);
    this.busEngine.gain.setTargetAtTime(this.vol.engine, t, 0.03); this.busSfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
    this.busAmb.gain.setTargetAtTime(this.vol.sfx, t, 0.03); this.busMusic.gain.setTargetAtTime(this.vol.music * (this.raceOn ? 0 : 1), t, 0.2);
  };

  /* ---------------------------------------------------------------- ambient loops (wind, rain, crowd, rumble, skid, brakes) */
  Audio.prototype._ambient = function () {
    var c = this.ctx, self = this, A = this.amb = {};
    function loop(type, f, q, g) {
      var n = self._noise(), flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q || 0.7;
      var gn = c.createGain(); gn.gain.value = 0; n.connect(flt); flt.connect(gn); gn.connect(self.busAmb); return { flt: flt, gain: gn, src: n };
    }
    A.wind = loop('lowpass', 500, 0.5); A.rain = loop('highpass', 2800, 0.5); A.crowd = loop('bandpass', 700, 0.6);
    A.kerb = loop('lowpass', 160, 1.2); A.gravel = loop('bandpass', 1900, 0.8);
    A.skid = loop('bandpass', 1100, 3.0); A.squeal = loop('bandpass', 2300, 9.0); A.rainRoof = loop('bandpass', 1200, 0.4);
    A.skid.gain.connect(this.busSfx); A.squeal.gain.connect(this.busSfx);
  };

  /* ---------------------------------------------------------------- engine voices */
  Audio.prototype._wave = function (grit) {
    var c = this.ctx, n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (var k = 1; k < n; k++) { im[k] = (1 / Math.pow(k, 0.85)) * (k % 2 === 0 ? 0.65 + grit * 0.5 : 1) * (k > 18 ? 0.5 : 1); re[k] = (k % 3 === 0 ? 0.2 : 0) * grit / k; }
    return c.createPeriodicWave(re, im);
  };
  Audio.prototype._curve = function (amt) {
    var n = 512, cv = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * (1 + amt * 4)) / Math.tanh(1 + amt * 4); } return cv;
  };
  Audio.prototype.makeVoice = function (car, isPlayer) {
    var c = this.ctx, prof = ENGINE[car.spec.id] || ENGINE.vortex, v = { car: car, prof: prof, player: isPlayer };
    v.o1 = c.createOscillator(); v.o1.setPeriodicWave(this._wave(prof.grit));
    v.o2 = c.createOscillator(); v.o2.setPeriodicWave(this._wave(prof.grit * 0.5));
    v.o3 = c.createOscillator(); v.o3.type = 'sine';
    v.g1 = c.createGain(); v.g2 = c.createGain(); v.g3 = c.createGain(); v.g1.gain.value = 0.5; v.g2.gain.value = 0.28; v.g3.gain.value = 0.3 * prof.bass;
    v.noise = this._noise(); v.nf = c.createBiquadFilter(); v.nf.type = 'bandpass'; v.nf.Q.value = 1.2; v.ng = c.createGain(); v.ng.gain.value = 0;
    v.lp = c.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.Q.value = 1.4;
    v.shaper = c.createWaveShaper(); v.shaper.curve = this._curve(prof.grit); v.shaper.oversample = '2x';
    v.out = c.createGain(); v.out.gain.value = 0; v.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    v.o1.connect(v.g1); v.o2.connect(v.g2); v.o3.connect(v.g3); v.noise.connect(v.nf); v.nf.connect(v.ng);
    v.g1.connect(v.lp); v.g2.connect(v.lp); v.g3.connect(v.lp); v.ng.connect(v.lp);
    v.lp.connect(v.shaper); v.shaper.connect(v.out);
    if (v.pan) { v.out.connect(v.pan); v.pan.connect(this.busEngine); } else v.out.connect(this.busEngine);
    if (prof.whistle) { v.o4 = c.createOscillator(); v.o4.type = 'sine'; v.g4 = c.createGain(); v.g4.gain.value = 0; v.o4.connect(v.g4); v.g4.connect(v.out); v.o4.start(); }
    v.o1.start(); v.o2.start(); v.o3.start();
    return v;
  };
  Audio.prototype.killVoice = function (v) {
    var t = this.ctx.currentTime;
    try { v.out.gain.setTargetAtTime(0, t, 0.05); var s = v; setTimeout(function () { try { s.o1.stop(); s.o2.stop(); s.o3.stop(); if (s.o4) s.o4.stop(); s.noise.stop(); } catch (e) { } }, 400); } catch (e) { }
  };
  Audio.prototype.beginRace = function (cars, player) {
    if (!this.ok) return; this.endRace();
    this.raceOn = true; this.player = player;
    for (var i = 0; i < cars.length; i++) this.voices.push(this.makeVoice(cars[i], cars[i] === player));
    this.applyVolumes();
  };
  Audio.prototype.endRace = function () {
    if (!this.ok) return;
    for (var i = 0; i < this.voices.length; i++) this.killVoice(this.voices[i]);
    this.voices.length = 0; this.raceOn = false; this.applyVolumes();
    var t = this.ctx.currentTime; for (var k in this.amb) this.amb[k].gain.gain.setTargetAtTime(0, t, 0.1);
  };

  /* ---------------------------------------------------------------- per-frame */
  Audio.prototype.update = function (dt, S) {
    if (!this.ok || !this.raceOn) return;
    var c = this.ctx, t = c.currentTime, A = this.amb, env = S.env, p = S.player, pv = p.vehicle, self = this;
    var paused = S.paused, cam = S.camPos, kmh = Math.abs(pv.speedKmh), spd = kmh / 3.6;
    var tun = S.tunnel ? 1 : 0; this.tun += (tun - this.tun) * Math.min(1, dt * 4);
    // tunnel: booming reverb + slightly muffled exterior
    this.revSend.gain.setTargetAtTime(0.06 + this.tun * 0.55, t, 0.15);
    this.lp.frequency.setTargetAtTime(paused ? 700 : 20000, t, 0.1);
    // engines
    var vs = this.voices, cs = cam;
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], car = v.car, veh = car.vehicle, prof = v.prof, rpm = veh.rpm;
      var dx = veh.x - cs[0], dz = veh.z - cs[2], dist = Math.hypot(dx, dz);
      var load = clamp(veh.throttle != null ? veh.throttle : (car.input ? car.input.throttle : 0), 0, 1);
      var f0 = rpm / 60 * prof.cyl / 2;
      var dop = 1;
      if (!v.player) { var rvx = (veh.worldVx || 0) - (pv.worldVx || 0), rvz = (veh.worldVz || 0) - (pv.worldVz || 0); var rad = (rvx * dx + rvz * dz) / Math.max(dist, 1); dop = 1 / (1 + clamp(rad, -60, 60) / 343); }
      var fr = f0 * dop;
      v.o1.frequency.setTargetAtTime(fr, t, 0.025); v.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.025); v.o3.frequency.setTargetAtTime(fr * 0.5, t, 0.025);
      var rn = clamp((rpm - veh.spec.rpmIdle) / (veh.spec.rpmRedline - veh.spec.rpmIdle), 0, 1);
      var cut = (260 + rn * 1500 + load * 2300) * prof.bright;
      v.lp.frequency.setTargetAtTime(v.player ? cut * 1.2 : cut * (dist > 60 ? 0.5 : 0.8), t, 0.04);
      var cabin = 1;
      var att = v.player ? 1 : clamp(1 / (1 + Math.pow(dist / 22, 1.7)), 0, 1);
      var vol = (0.18 + 0.82 * (0.28 + 0.72 * load)) * (0.55 + rn * 0.45) * att * (v.player ? 0.85 : 1.3);
      if (veh.locked && !v.player) vol *= 0.7;
      v.out.gain.setTargetAtTime(paused ? 0 : vol * 0.55, t, 0.04);
      if (v.pan) { var ang = Math.atan2(dx * S.camRight[0] + dz * S.camRight[2], dx * S.camFwd[0] + dz * S.camFwd[2]); v.pan.pan.setTargetAtTime(v.player ? 0 : clamp(Math.sin(ang) * 0.9, -1, 1), t, 0.05); }
      v.nf.frequency.setTargetAtTime(500 + rn * 2500, t, 0.05); v.ng.gain.setTargetAtTime(0.05 + load * 0.28 * prof.grit, t, 0.05);
      if (v.o4) { v.o4.frequency.setTargetAtTime(1500 + rn * 3600, t, 0.05); v.g4.gain.setTargetAtTime(load * rn * 0.05 * prof.whistle, t, 0.1); }
      // gear shifts: pop / blip
      var lg = this.lastGear[car.id]; if (lg != null && lg !== veh.gear && v.player && !paused) this.shift(veh.gear > lg, prof, load);
      this.lastGear[car.id] = veh.gear;
    }
    // ambient layers (player-centred)
    var surf = pv.surfaceNow ? pv.surfaceNow.id : 0, g = function (n, val, tc) { A[n].gain.gain.setTargetAtTime(paused ? 0 : val, t, tc || 0.08); };
    g('wind', clamp(Math.pow(spd / 90, 1.4), 0, 1) * 0.45 * (1 - this.tun * 0.4) + 0.03);
    A.wind.flt.frequency.setTargetAtTime(300 + spd * 7, t, 0.1);
    g('rain', env.rain * 0.16 * (1 - this.tun * 0.95)); g('rainRoof', env.rain * 0.12 * (1 - this.tun * 0.95));
    var crowd = clamp(S.crowdNear, 0, 1); g('crowd', crowd * 0.2 * (env.rain ? 0.6 : 1));
    var skid = Math.max(pv.skidF, pv.skidR) * (surf <= 1 && !pv.airborne ? 1 : 0), ds = clamp((skid - 0.25) * 1.6, 0, 1) * clamp(spd / 14, 0, 1);
    g('skid', ds * 0.55); A.skid.flt.frequency.setTargetAtTime(900 + spd * 8, t, 0.1);
    var brk = clamp(pv.brake || 0, 0, 1) * clamp((kmh - 25) / 90, 0, 1);
    g('squeal', Math.max(brk * brk * 0.12 * (pv.absActive ? 1.5 : 0.7), ds * 0.1)); A.squeal.flt.frequency.setTargetAtTime(2100 + Math.min(spd, 80) * 18 + (pv.absActive ? 400 : 0), t, 0.08);
    g('kerb', surf === 1 ? clamp(spd / 40, 0, 1) * 0.65 : 0, 0.04);
    g('gravel', (surf === 2 || surf === 3) ? clamp(spd / 30, 0, 1) * 0.5 : 0, 0.06); A.gravel.flt.frequency.setTargetAtTime(surf === 3 ? 700 : 1900, t, 0.1);
  };
  Audio.prototype.shift = function (up, prof, load) {
    var c = this.ctx, t = c.currentTime;
    var n = this._noise(this.whiteBuf, false), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = up ? 1800 : 900; f.Q.value = 1.4; g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f); f.connect(g); g.connect(this.busSfx); n.stop(t + 0.12);
    if (up && load > 0.6 && prof.grit >= 0.45) this._pop(0.22 * prof.grit);
  };
  Audio.prototype._pop = function (a) {
    var c = this.ctx, t = c.currentTime + 0.03, o = c.createOscillator(), g = c.createGain(), n = this._noise(this.whiteBuf, false), f = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.1); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    f.type = 'bandpass'; f.frequency.value = 900; var ng = c.createGain(); ng.gain.setValueAtTime(a * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(this.busSfx); n.connect(f); f.connect(ng); ng.connect(this.busSfx); o.start(t); o.stop(t + 0.15); n.stop(t + 0.1);
  };

  /* ---------------------------------------------------------------- one-shot effects */
  Audio.prototype.hit = function (speed, wall, dist) {
    if (!this.ok) return;
    var c = this.ctx, t = c.currentTime, a = clamp(speed / 18, 0.15, 1) * (dist == null ? 1 : clamp(1 / (1 + dist / 35), 0.1, 1));
    var o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    g.gain.setValueAtTime(0.9 * a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(g); g.connect(this.busSfx); o.start(t); o.stop(t + 0.45);
    var n = this._noise(this.whiteBuf, false), f = c.createBiquadFilter(), ng = c.createGain(); f.type = wall ? 'bandpass' : 'lowpass'; f.frequency.value = wall ? 1400 : 2600; f.Q.value = 0.6;
    ng.gain.setValueAtTime(0.7 * a, t); ng.gain.exponentialRampToValueAtTime(0.001, t + (wall ? 0.5 : 0.28)); n.connect(f); f.connect(ng); ng.connect(this.busSfx); n.stop(t + 0.6);
    if (wall) { var m = c.createOscillator(), mg = c.createGain(); m.type = 'square'; m.frequency.setValueAtTime(420, t); m.frequency.exponentialRampToValueAtTime(170, t + 0.25); mg.gain.setValueAtTime(0.12 * a, t); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.3); m.connect(mg); mg.connect(this.busSfx); m.start(t); m.stop(t + 0.35); }
  };
  Audio.prototype.scrape = function (dist) {
    if (!this.ok) return; var c = this.ctx, t = c.currentTime, n = this._noise(this.whiteBuf, false), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 2500; g.gain.setValueAtTime(0.16 * clamp(1 / (1 + (dist || 0) / 30), 0.1, 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); n.connect(f); f.connect(g); g.connect(this.busSfx); n.stop(t + 0.2);
  };
  Audio.prototype.beep = function (hi) {
    if (!this.ok) return; var c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = hi ? 1320 : 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.setValueAtTime(0.18, t + (hi ? 0.5 : 0.28)); g.gain.exponentialRampToValueAtTime(0.0001, t + (hi ? 0.62 : 0.34));
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.7);
  };
  Audio.prototype.chime = function (kind) {
    if (!this.ok) return; var c = this.ctx, t = c.currentTime, notes = kind === 'best' ? [880, 1108, 1318, 1760] : (kind === 'win' ? [523, 659, 784, 1046, 1318] : (kind === 'lose' ? [392, 349, 311, 262] : [988, 1318]));
    notes.forEach(function (fr, i) {
      var o = c.createOscillator(), g = c.createGain(); o.type = kind === 'lose' ? 'sawtooth' : 'triangle'; o.frequency.value = fr; var s = t + i * (kind === 'win' ? 0.16 : 0.1);
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.14, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + (kind === 'win' ? 0.7 : 0.35));
      var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'lose' ? 900 : 5000; o.connect(f); f.connect(g); g.connect(this.master); o.start(s); o.stop(s + 0.8);
    }, this);
  };
  Audio.prototype.click = function (kind) {
    if (!this.ok) return; var c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(kind === 'back' ? 520 : 780, t); o.frequency.exponentialRampToValueAtTime(kind === 'back' ? 330 : 1200, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.12);
  };
  /* sim events routed here by the game loop */
  Audio.prototype.event = function (e, camPos) {
    if (!this.ok || !this.raceOn) return;
    if (e.type === 'light') this.beep(false); else if (e.type === 'go') this.beep(true);
    else if (e.type === 'hit') { var d = camPos ? Math.hypot(e.x - camPos[0], e.z - camPos[2]) : 0; if (!e.quiet) this.hit(e.speed, !!e.wall, d); }
    else if (e.type === 'scrape') { this.scrape(camPos ? Math.hypot(e.x - camPos[0], e.z - camPos[2]) : 0); }
    else if (e.type === 'lap' && e.car === this.player) this.chime(e.best ? 'best' : 'lap');
  };

  /* ---------------------------------------------------------------- menu music (generative synthwave) */
  var ROOTS = [57, 53, 60, 55];                       // Am F C G (bass roots, MIDI)
  var CHORD = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
  function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  Audio.prototype.startMusic = function () {
    if (!this.ok || this.musicOn) return; this.musicOn = true; this.step = 0; this.nextNote = this.ctx.currentTime + 0.1; var self = this;
    if (!this.delay) {
      var c = this.ctx; this.delay = c.createDelay(1); this.delay.delayTime.value = 60 / 112 * 0.75; this.fb = c.createGain(); this.fb.gain.value = 0.38; var df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 2400;
      this.delay.connect(df); df.connect(this.fb); this.fb.connect(this.delay); df.connect(this.busMusic);
    }
    this.timer = setInterval(function () { self._sched(); }, 60);
    this.applyVolumes();
  };
  Audio.prototype.stopMusic = function () { this.musicOn = false; if (this.timer) { clearInterval(this.timer); this.timer = null; } };
  Audio.prototype._sched = function () {
    if (!this.ok || !this.musicOn) return; var c = this.ctx, spb = 60 / 112 / 4;       // 16th notes @ 112 bpm
    while (this.nextNote < c.currentTime + 0.25) { this._step(this.step, this.nextNote); this.nextNote += spb; this.step++; }
  };
  Audio.prototype._env = function (g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  Audio.prototype._step = function (s, t) {
    var c = this.ctx, bar = Math.floor(s / 16) % 4, st = s % 16, root = ROOTS[bar], ch = CHORD[bar], i;
    // kick on beats, snare on 2/4, hats on 8ths with open hat offbeat
    if (st % 4 === 0) { var o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); this._env(g, t, 0.003, 0.2, 0.9); o.connect(g); g.connect(this.busMusic); o.start(t); o.stop(t + 0.25); }
    if (st === 4 || st === 12) { var n = this._noise(this.whiteBuf, false), f = c.createBiquadFilter(), g2 = c.createGain(); f.type = 'bandpass'; f.frequency.value = 1800; this._env(g2, t, 0.002, 0.16, 0.5); n.connect(f); f.connect(g2); g2.connect(this.busMusic); n.stop(t + 0.2);
      var o2 = c.createOscillator(), g3 = c.createGain(); o2.type = 'triangle'; o2.frequency.setValueAtTime(240, t); o2.frequency.exponentialRampToValueAtTime(130, t + 0.1); this._env(g3, t, 0.002, 0.1, 0.35); o2.connect(g3); g3.connect(this.busMusic); o2.start(t); o2.stop(t + 0.15); }
    if (st % 2 === 0) { var h = this._noise(this.whiteBuf, false), hf = c.createBiquadFilter(), hg = c.createGain(); hf.type = 'highpass'; hf.frequency.value = 7500; this._env(hg, t, 0.001, st % 4 === 2 ? 0.1 : 0.03, st % 4 === 2 ? 0.18 : 0.12); h.connect(hf); hf.connect(hg); hg.connect(this.busMusic); h.stop(t + 0.14); }
    // bass: driving 8ths with octave jumps
    if (st % 2 === 0) {
      var note = root - 12 + ((st === 6 || st === 14) ? 12 : 0), bo = c.createOscillator(), bf = c.createBiquadFilter(), bg = c.createGain();
      bo.type = 'sawtooth'; bo.frequency.value = mtof(note); bf.type = 'lowpass'; bf.frequency.setValueAtTime(900, t); bf.frequency.exponentialRampToValueAtTime(260, t + 0.18); bf.Q.value = 5;
      this._env(bg, t, 0.005, 0.2, 0.34); bo.connect(bf); bf.connect(bg); bg.connect(this.busMusic); bo.start(t); bo.stop(t + 0.26);
    }
    // arp (pulse-ish) through the delay
    var pat = [0, 1, 2, 1, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2, 1], an = root + 12 + ch[pat[st]] + (st % 8 === 7 ? 12 : 0);
    var ao = c.createOscillator(), ag = c.createGain(), af = c.createBiquadFilter(); ao.type = 'square'; ao.frequency.value = mtof(an); af.type = 'lowpass'; af.frequency.value = 1500 + Math.sin(s * 0.05) * 700;
    this._env(ag, t, 0.004, 0.13, 0.085); ao.connect(af); af.connect(ag); ag.connect(this.busMusic); ag.connect(this.delay); ao.start(t); ao.stop(t + 0.18);
    // pad on the bar start
    if (st === 0) for (i = 0; i < 3; i++) {
      var po = c.createOscillator(), po2 = c.createOscillator(), pg = c.createGain(), pf = c.createBiquadFilter(); po.type = 'sawtooth'; po2.type = 'sawtooth'; var pn = root + 12 + ch[i];
      po.frequency.value = mtof(pn) * 0.997; po2.frequency.value = mtof(pn) * 1.003; pf.type = 'lowpass'; pf.frequency.value = 1100;
      pg.gain.setValueAtTime(0.0001, t); pg.gain.exponentialRampToValueAtTime(0.05, t + 0.5); pg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      po.connect(pf); po2.connect(pf); pf.connect(pg); pg.connect(this.busMusic); po.start(t); po2.start(t); po.stop(t + 2.5); po2.stop(t + 2.5);
    }
  };
  Audio.prototype.setPaused = function (p) { if (!this.ok) return; this.lp.frequency.setTargetAtTime(p ? 700 : 20000, this.ctx.currentTime, 0.05); };
  Audio.prototype.mute = function (m) { this.muted = m; this.applyVolumes(); };

  JR.Audio = Audio;
})();
