/* JIMMY RACING - net.js : browser WebSocket client (native WebSocket), reconnection, clock sync and snapshot interpolation. */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR, NET = JR.net;

  function NetClient(handlers) {
    this.h = handlers; this.ws = null; this.status = 'idle'; this.token = null; this.pid = 0; this.wantOpen = false; this.retry = 0; this.rtt = 0; this.seq = 0; this.pingC = 0; this.pingAt = {};
    this.snaps = []; this.off = null; this.snapHz = NET.SNAP_HZ; this.lastInT = 0; this.name = '';
    try { this.token = sessionStorage.getItem('jr_token'); } catch (e) { }
    var self = this; this.pingTimer = setInterval(function () { self._ping(); }, 2000);
  }
  NetClient.prototype.url = function () {
    var L = G.location; if (!L || (L.protocol !== 'http:' && L.protocol !== 'https:')) return null;
    return (L.protocol === 'https:' ? 'wss://' : 'ws://') + L.host + '/ws';
  };
  NetClient.prototype.connect = function (name) {
    var url = this.url(); this.name = name || this.name;
    if (!url) { this._status('nourl'); return false; }
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return true;
    this.wantOpen = true; this._open(url); return true;
  };
  NetClient.prototype._open = function (url) {
    var self = this, ws; this._status(this.retry ? 'reconnecting' : 'connecting');
    try { ws = new WebSocket(url); } catch (e) { this._status('error'); return; }
    this.ws = ws;
    ws.onopen = function () { if (self.ws !== ws) return; self.retry = 0; self.send({ t: 'hello', name: self.name, token: self.token || undefined }); };
    ws.onmessage = function (ev) {
      if (self.ws !== ws) return; var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { self.pid = m.pid; self.token = m.token; try { sessionStorage.setItem('jr_token', m.token); } catch (e) { } self.snapHz = m.snapHz || NET.SNAP_HZ; self._status('online'); }
      else if (m.t === 'pong') { var t0 = self.pingAt[m.c]; if (t0) { self.rtt = performance.now() - t0; delete self.pingAt[m.c]; } }
      else if (m.t === 'snap') self._snap(m);
      self.h.onMessage(m);
    };
    ws.onclose = function () {
      if (self.ws !== ws) return; self.ws = null; self.snaps.length = 0; self.off = null;
      if (self.wantOpen) { self.retry++; self._status('reconnecting'); var d = Math.min(4000, 400 * Math.pow(1.7, self.retry - 1)); if (self.retry > 25) { self.wantOpen = false; self._status('lost'); self.h.onLost && self.h.onLost(); return; } setTimeout(function () { if (self.wantOpen && !self.ws) self._open(self.url()); }, d); }
      else self._status('idle');
    };
    ws.onerror = function () { };
  };
  NetClient.prototype._status = function (s) { if (this.status !== s) { this.status = s; this.h.onStatus && this.h.onStatus(s); } };
  NetClient.prototype.disconnect = function () { this.wantOpen = false; if (this.ws) { try { this.ws.close(1000); } catch (e) { } } this.ws = null; this.snaps.length = 0; this._status('idle'); };
  NetClient.prototype.send = function (o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; };
  NetClient.prototype._ping = function () { if (this.status !== 'online') return; var c = ++this.pingC; this.pingAt[c] = performance.now(); if (c > 5) delete this.pingAt[c - 5]; this.send({ t: 'ping', c: c, rtt: Math.round(this.rtt) }); };
  NetClient.prototype.sendInput = function (inp, now) {
    if (now - this.lastInT < 1000 / 30 - 2) return; this.lastInT = now;
    this.send({ t: 'in', s: ++this.seq, th: +inp.throttle.toFixed(3), br: +inp.brake.toFixed(3), st: +inp.steer.toFixed(3), hb: +inp.handbrake.toFixed(2) });
  };

  /* ---- snapshots: store with server time; estimate clock offset as the lowest recent transit delay ---- */
  NetClient.prototype._snap = function (m) {
    var now = performance.now() / 1000, ts = m.k / 120, o = now - ts, cars = {}, i;
    for (i = 0; i < m.c.length; i++) { if (!NET.validPacked(m.c[i])) continue; var s = NET.unpackCar(m.c[i]); cars[s.pid] = s; }
    var e = { t: ts, recv: now, cars: cars, st: m.st, sim: m.sim, li: m.li };
    var sn = this.snaps; if (sn.length && ts <= sn[sn.length - 1].t) return;
    sn.push(e); if (sn.length > 40) sn.shift();
    this.owin = this.owin || []; this.owin.push(o); if (this.owin.length > 96) this.owin.shift();
    var mn = Math.min.apply(null, this.owin); this.off = this.off == null ? mn : this.off + (mn - this.off) * 0.08;
  };
  /* render state of car pid at server time ts (interpolated / briefly extrapolated); returns null if unknown */
  NetClient.prototype.sample = function (pid, ts) {
    var sn = this.snaps, n = sn.length, i, a = null, b = null; if (!n) return null;
    for (i = n - 1; i >= 0; i--) if (sn[i].cars[pid]) { if (!b) b = sn[i]; if (sn[i].t <= ts) { a = sn[i]; break; } if (b !== sn[i]) b = sn[i]; }
    // find bracketing pair a (<= ts) and next b (> ts) that both contain pid
    a = null; b = null;
    for (i = 0; i < n; i++) { if (!sn[i].cars[pid]) continue; if (sn[i].t <= ts) a = sn[i]; else { b = sn[i]; break; } }
    if (!a && !b) return null;
    if (a && b) { var f = (ts - a.t) / (b.t - a.t); return mix(a.cars[pid], b.cars[pid], f); }
    var s = (a || b).cars[pid], dt = a ? Math.min(0.25, ts - a.t) : 0;
    return a ? extrap(s, dt) : s;
  };
  function lerp(x, y, f) { return x + (y - x) * f; }
  function mix(A, B, f) {
    var o = { pid: A.pid, veh: {}, wheels: [0, 0, 0, 0], gear: A.gear, airborne: A.airborne, absActive: A.absActive, tcActive: A.tcActive, reversing: A.reversing, surf: A.surf, finished: B.finished, race: B.race, zones: B.zones }, k, i;
    for (k in A.veh) o.veh[k] = lerp(A.veh[k], B.veh[k], f);
    o.veh.heading = A.veh.heading + NET.angDiff(A.veh.heading, B.veh.heading) * f;
    for (i = 0; i < 4; i++) o.wheels[i] = A.wheels[i] + NET.angDiff(A.wheels[i], B.wheels[i]) * f;
    if (f > 0.5) { o.gear = B.gear; o.airborne = B.airborne; o.reversing = B.reversing; o.surf = B.surf; o.absActive = B.absActive; o.tcActive = B.tcActive; }
    return o;
  }
  function extrap(S, dt) {
    if (dt <= 0) return S; var o = { pid: S.pid, veh: {}, wheels: S.wheels.slice(), gear: S.gear, airborne: S.airborne, absActive: S.absActive, tcActive: S.tcActive, reversing: S.reversing, surf: S.surf, finished: S.finished, race: S.race, zones: S.zones }, k;
    for (k in S.veh) o.veh[k] = S.veh[k];
    o.veh.x += S.veh.worldVx * dt; o.veh.z += S.veh.worldVz * dt; o.veh.heading += S.veh.r * dt;
    var spin = S.veh.speedKmh / 3.6 / 0.34 * dt; for (var i = 0; i < 4; i++) o.wheels[i] += S.reversing ? -spin : spin;
    return o;
  }
  /* my own car: newest snapshot extrapolated by its age (no interpolation delay) */
  NetClient.prototype.own = function (pid) { var l = this.latest(); if (!l || !l.cars[pid]) return null; return extrap(l.cars[pid], Math.min(0.15, Math.max(0, performance.now() / 1000 - l.recv))); };
  NetClient.prototype.serverNow = function () { return this.off == null ? null : performance.now() / 1000 - this.off; };
  NetClient.prototype.latest = function () { return this.snaps.length ? this.snaps[this.snaps.length - 1] : null; };
  NetClient.prototype.reset = function () { this.snaps.length = 0; this.owin = []; this.off = null; this.seq = 0; };

  JR.NetClient = NetClient;
})();
