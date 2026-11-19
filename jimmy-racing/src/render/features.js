/* JIMMY RACING - features.js : scenery on top of the base world
 * trees (instanced, per-tree LOD/culling), village, industry, pit building, grandstands, start gantry,
 * footbridge, tunnel mound, hoardings, braking boards, chevrons, light poles.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var GL = JR.gl, Geo = GL.Geo, P = GL.P, A = GL.A;
  var U = JR.util, clamp = U.clamp, smooth = U.smoothstep;
  var World = JR.World;
  var CAN = function () { return JR.textures.CAN; };

  function bsOf(geo, extra) { var b = geo.bounds(); return { x: b.cx, y: b.cy, z: b.cz, r: b.r + (extra || 0) }; }
  function xfAt(x, y, z, ry, s) { return A.trs(x, y, z, ry || 0, s == null ? 1 : s, s == null ? 1 : s, s == null ? 1 : s); }
  function tintC(g, r, gg, b) { for (var i = 0; i < g.c.length; i += 4) { g.c[i] *= r; g.c[i + 1] *= gg; g.c[i + 2] *= b; } return g; }

  World.prototype._buildFeatures = function () {
    var t0 = performance.now(), bm = this.buildMs = this.buildMs || {};
    this._tunnelS = null;
    this._buildTunnel(); bm.tunnel = performance.now() - t0; t0 = performance.now();
    this._buildStands(); bm.stands = performance.now() - t0; t0 = performance.now();
    this._buildGantry(); this._buildBridge();
    this._buildSigns(); bm.signs = performance.now() - t0; t0 = performance.now();
    this._buildBuildings(); bm.buildings = performance.now() - t0; t0 = performance.now();
    this._buildLamps();
    this._buildTrees(); bm.trees = performance.now() - t0;
    this.updateEnv(this.R.env);
  };

  /* ---------------------------------------------------------------- helpers */
  World.prototype._chunkIdx = function (s) { return clamp(Math.floor((s / this.track.ds) / 50), 0, this.chunks.length - 1); };
  World.prototype._addStatic = function (geo, mat, cast, opt) {
    if (!geo || geo.count() === 0) return null;
    var it = { mesh: this.R.eng.mesh(geo), mat: mat, cast: cast !== false, bs: bsOf(geo, 2), xf: null };
    if (opt) for (var k in opt) it[k] = opt[k];
    this.statics.push(it); return it;
  };
  /* world pose at (s, lateral d) with ground height from the road (bridges, stands) */
  World.prototype._at = function (s, d) { return this.track.pointAt(s, d); };
  World.prototype.excluded = function (x, z) {
    var ex = this.exclusions;
    for (var i = 0; i < ex.length; i++) { var e = ex[i]; if ((x - e.x) * (x - e.x) + (z - e.z) * (z - e.z) < e.r * e.r) return true; }
    return false;
  };

  /* ---------------------------------------------------------------- materials (feature set) */
  World.prototype._featureMats = function () {
    if (this.fm) return this.fm;
    var R = this.R, m = this.fm = {};
    for (var s = 0; s < 4; s++) m['facade' + s] = R.material({ tex: 'facade' + s, ts: [1 / 12, 1 / 12], emisMask: true, emis: [0, 0, 0], rough: 1, wetAff: 0, nstr: 0.8 });
    m.roof = R.material({ tex: 'roof', ts: [1 / 5, 1 / 5], rough: 1, nstr: 0.8 });
    m.concrete = this.mats.concrete;
    m.concreteLight = R.material({ tex: 'concrete', base: [1.25, 1.25, 1.2, 1], ts: [0.25, 0.25] });
    m.glass = R.material({ tex: 'white', base: [0.05, 0.09, 0.12, 0.45], rough: 0.05, metal: 0.0, spec: 1.6, blend: 'alpha', glass: true, depthWrite: false, castShadow: false, cull: false });
    m.steelRed = R.material({ tex: 'white', base: [0.65, 0.06, 0.07, 1], rough: 0.45, metal: 0.6 });
    m.steelGrey = R.material({ tex: 'white', base: [0.5, 0.52, 0.55, 1], rough: 0.45, metal: 0.85 });
    m.darkMetal = R.material({ tex: 'white', base: [0.07, 0.07, 0.08, 1], rough: 0.5, metal: 0.8 });
    m.lampHead = R.material({ tex: 'white', base: [1, 1, 1, 1], emis: [0, 0, 0], rough: 0.5 });
    m.cloth = R.material({ tex: 'white', base: [0.9, 0.9, 0.9, 1], rough: 0.9, cull: false });
    m.bark = R.material({ tex: 'bark', ts: [2, 1], rough: 1, nstr: 1 });
    m.foliage = R.material({ tex: 'foliage', ts: [3, 2], rough: 1, nstr: 0.9, sway: true, spec: 0.6 });
    m.foliagePine = R.material({ tex: 'foliage', ts: [4, 3], rough: 1, nstr: 0.9, sway: true, base: [0.62, 0.78, 0.66, 1], spec: 0.6 });
    m.rock = R.material({ tex: 'rock', ts: [1 / 4, 1 / 4], rough: 1, nstr: 1 });
    // banners (fictional sponsors)
    var C = CAN(), defs = [
      ['VORTEX OIL', ['#c8102e', '#7a0a1c'], '#fff', 'ENGINEERED FOR SPEED'], ['NITRO CELL', ['#0b5ed7', '#06357a'], '#fff', 'ENERGY DRINK'],
      ['APEX TYRES', ['#f5a300', '#a86400'], '#111', 'GRIP IS EVERYTHING'], ['TURBOLUX', ['#111', '#333'], '#ffd23f', 'PREMIUM FUELS'],
      ['JIMMY RACING', ['#1a1a1f', '#3b0d12'], '#fff', 'WORLD CHAMPIONSHIP'], ['FALCON AIR', ['#e8e8e8', '#9fb8d6'], '#0b2a5b', 'FLY FASTER']];
    m.banners = defs.map(function (d) {
      var cv = C.banner(d[0], d[1], d[2], d[3]);
      var tex = R.eng.canvasTexture(cv, { clamp: true });
      return R.material({ t0: tex, t1: R.tex.white.t1, rough: 0.7, castShadow: true });
    });
    m.boards = {};
    ['300', '200', '150', '100', '50'].forEach(function (n) {
      m.boards[n] = R.material({ t0: R.eng.canvasTexture(C.board(n, n === '50' ? '#c8102e' : '#f2f2f2', n === '50' ? '#fff' : '#c8102e'), { clamp: true }), t1: R.tex.white.t1, rough: 0.6 });
    });
    m.chevron = R.material({ t0: R.eng.canvasTexture(C.chevron(), { clamp: true }), t1: R.tex.white.t1, rough: 0.6 });
    m.crowd = R.material({ t0: R.eng.canvasTexture(C.crowd(7)), t1: R.tex.white.t1, rough: 0.95, ts: [1 / 8, 1 / 4] });
    m.crowd2 = R.material({ t0: R.eng.canvasTexture(C.crowd(19)), t1: R.tex.white.t1, rough: 0.95, ts: [1 / 8, 1 / 4] });
    return m;
  };

  /* free the GPU meshes of a world that is being replaced (level change) */
  World.prototype.dispose = function () {
    var seen = new Set(), n = 0, skip = { R: 1, track: 1, scene: 1, q: 1, opts: 1, eng: 1, gl: 1 };
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || seen.has(o) || d > 6) return; seen.add(o);
      if (typeof o.dispose === 'function' && o.vao) { try { o.dispose(); n++; } catch (e) { } return; }
      if (ArrayBuffer.isView(o)) return;
      for (var k in o) { if (skip[k]) continue; var v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
    })(this, 0);
    this.disposed = n;
  };

  /* update emissive windows / lamps with the current environment */
  World.prototype.updateEnv = function (env) {
    var m = this._featureMats(), night = env.night > 0.5 || (env.time === 'sunset');
    var k = env.night > 0.5 ? 3.2 : (env.time === 'sunset' ? 0.9 : 0);
    for (var s = 0; s < 4; s++) { var e = m['facade' + s].emis; e[0] = 1.0 * k; e[1] = 0.78 * k; e[2] = 0.42 * k; }
    var l = m.lampHead.emis, lk = env.night > 0.5 ? 14 : (env.time === 'sunset' || env.weather !== 'clear' ? 4 : 0);
    l[0] = 1.0 * lk; l[1] = 0.86 * lk; l[2] = 0.6 * lk;
    this.lampOn = lk > 0; this.nightLevel = env.night;
  };

  /* ---------------------------------------------------------------- tunnel (mound + portals + interior) */
  World.prototype._buildTunnel = function () {
    var tr = this.track, F = tr.features.tunnel, N = tr.N, m = this._featureMats(), self = this;
    var i0 = Math.floor(F.s0 / tr.ds), i1 = Math.floor(F.s1 / tr.ds);
    this.tunnel = { s0: F.s0, s1: F.s1, i0: i0, i1: i1, ceil: 6.8, halfW: tr.width[Math.floor((i0 + i1) / 2) % N] * 0.5 + 1.0 };
    this.exclusions = this.exclusions || [];
    for (var s = F.s0 - 30; s <= F.s1 + 30; s += 40) { var p = tr.pointAt(s, 0); this.exclusions.push({ x: p.x, z: p.z, r: 46 }); }
    // road darkness inside: patched into the road AO hook (set before road gets built is not possible -> tag for lookup)
    var HW = 26, H = 11, pts = [], k;
    for (k = -10; k <= 10; k++) { var d = k / 10 * HW, a = Math.abs(d) / HW; pts.push([d, H * Math.pow(Math.max(0, 1 - Math.pow(a, 2.4)), 0.65)]); }
    // mound outer ribbon (single geometry in 40 m pieces for culling + shadows)
    var piece = 20;
    for (var a0 = i0; a0 < i1; a0 += piece) {
      var a1 = Math.min(i1, a0 + piece), g = new Geo(), rows = a1 - a0;
      for (var q = a0; q <= a1; q++) {
        var i = q % N, lx = tr.tz[i], lz = -tr.tx[i], y = tr.y[i];
        var undul = (U.fbm(tr.x[i] * 0.03, tr.z[i] * 0.03, 12, 3) - 0.5) * 2.5;
        for (k = 0; k < pts.length; k++) {
          var d2 = pts[k][0], hh = pts[k][1] * (1 + undul * 0.06) + (hh_edge(k, pts.length) ? 0 : undul * 0.4);
          var wx = tr.x[i] + lx * d2, wz = tr.z[i] + lz * d2;
          var slopeAmt = Math.abs(d2) / HW;
          g.vert(wx, y + hh - 0.06 * (k === 0 || k === pts.length - 1 ? 1 : 0), wz, 0, 1, 0, wx / 8, wz / 8, 0.95, 1.0, 0.92, clamp(0.15 + slopeAmt * 0.5, 0, 1));
        }
      }
      var np = pts.length;
      for (var r = 0; r < rows; r++) for (k = 0; k < np - 1; k++) { var b = r * np + k; g.tri(b, b + 1, b + np + 1); g.tri(b, b + np + 1, b + np); }
      g.computeNormals();
      this._addStatic(g, this.mats.grass, true, { refl: false });
    }
    function hh_edge(k, n) { return k === 0 || k === n - 1; }
    // portals + interior
    var AW = this.tunnel.halfW, wallH = 3.0, archH = 3.8, nA = 14;
    var arch = []; // interior profile: left wall bottom -> up -> arch -> right wall bottom (lateral, y)
    arch.push([-AW, 0]); arch.push([-AW, wallH]);
    for (k = 1; k < nA; k++) { var ang = Math.PI - k / nA * Math.PI; arch.push([Math.cos(ang) * AW, wallH + Math.sin(ang) * archH]); }
    arch.push([AW, wallH]); arch.push([AW, 0]);
    var gi = new Geo(), lightsG = new Geo();
    for (s = i0; s <= i1; s++) {
      var ii = s % N, lx2 = tr.tz[ii], lz2 = -tr.tx[ii], yy = tr.y[ii];
      for (k = 0; k < arch.length; k++) {
        var dd = arch[k][0], yv = arch[k][1];
        var nxv = -dd / AW * 0.6, nyv = -(yv - wallH) / archH * 0.8 - (yv < wallH ? 0 : 0);
        var nrm = [-(k < 2 ? Math.sign(dd) : 0) * 1, 0, 0];
        var wx2 = tr.x[ii] + lx2 * dd, wz2 = tr.z[ii] + lz2 * dd;
        var u = k / (arch.length - 1) * 4, v = s * tr.ds / 6;
        var nn = [-dd / AW, Math.max(0, -(yv - wallH + 0.01)) * 0 + (yv > wallH ? -(yv - wallH) / archH : 0.0), 0];
        gi.vert(wx2, yy + yv, wz2, lx2 * (-dd / AW) * 0.8, (yv > wallH ? -(yv - wallH) / archH : 0) - 0.0, lz2 * (-dd / AW) * 0.8, u, v, 0.8, 0.8, 0.8, 0.45);
      }
    }
    var npi = arch.length;
    for (var rr = 0; rr < i1 - i0; rr++) for (k = 0; k < npi - 1; k++) { var bb = rr * npi + k; gi.tri(bb, bb + npi + 1, bb + 1); gi.tri(bb, bb + npi, bb + npi + 1); }
    gi.computeNormals();
    // flip: interior viewed from inside; winding above already faces inward (checked visually)
    this.tunnelInterior = this._addStatic(gi, this.R.material({ tex: 'concrete', ts: [0.25, 0.25], base: [0.9, 0.9, 0.88, 1], cull: false, rough: 1, castShadow: false }), false);
    // ceiling light strips
    var strip = P.box(0.35, 0.12, 4.0, [1, 1, 1, 1]);
    for (s = F.s0 + 8; s < F.s1 - 6; s += 12) for (var side = -1; side <= 1; side += 2) {
      var pp = tr.pointAt(s, side * 3.4);
      var top = wallH + archH * Math.sqrt(Math.max(0, 1 - Math.pow(3.4 / AW, 2))) - 0.12;
      lightsG.append(strip, A.trs(pp.x, pp.y + top, pp.z, pp.heading, 1, 1, 1));
      this.lights.push({ x: pp.x, y: pp.y + top, z: pp.z, tunnel: true });
    }
    this.tunnelLights = this._addStatic(lightsG, this.R.material({ tex: 'white', base: [1, 1, 1, 1], emis: [5.5, 5.0, 4.0], castShadow: false }), false);
    // portal faces (cover the mound front/back, with the arch opening)
    var gp = new Geo(), kk;
    function archY(d) { var a = Math.abs(d); if (a >= AW) return 0; if (a <= AW - 0.001) { var t = a / AW; return wallH + archH * Math.sqrt(Math.max(0, 1 - t * t)); } return wallH; }
    [i0, i1].forEach(function (idx, which) {
      var ii2 = idx % N, lx3 = tr.tz[ii2], lz3 = -tr.tx[ii2], y3 = tr.y[ii2], sgn = which === 0 ? -1 : 1;
      var tx = tr.tx[ii2] * sgn * 0.0, tz = 0;
      var base = gp.count();
      for (kk = 0; kk < pts.length; kk++) {
        var d3 = pts[kk][0], top = pts[kk][1];
        var low = Math.abs(d3) < AW ? archY(d3) : 0;
        var wx3 = tr.x[ii2] + lx3 * d3, wz3 = tr.z[ii2] + lz3 * d3, nx = -tr.tx[ii2] * sgn * -1, nz = -tr.tz[ii2] * sgn * -1;
        gp.vert(wx3, y3 + low, wz3, tr.tx[ii2] * -sgn, 0, tr.tz[ii2] * -sgn, d3 / 6, low / 6, 0.85, 0.85, 0.85, 0.9);
        gp.vert(wx3, y3 + top, wz3, tr.tx[ii2] * -sgn, 0, tr.tz[ii2] * -sgn, d3 / 6, top / 6, 0.85, 0.85, 0.85, 0.9);
      }
      for (kk = 0; kk < pts.length - 1; kk++) {
        var q0 = base + kk * 2;
        if (sgn < 0) { gp.tri(q0, q0 + 1, q0 + 3); gp.tri(q0, q0 + 3, q0 + 2); } else { gp.tri(q0, q0 + 3, q0 + 1); gp.tri(q0, q0 + 2, q0 + 3); }
      }
    });
    this._addStatic(gp, this.R.material({ tex: 'concrete', ts: [0.3, 0.3], rough: 1, cull: false }), true);
  };

  World.prototype.inTunnel = function (s) { var t = this.tunnel; return !!t && s > t.s0 + 3 && s < t.s1 - 3; };

  /* ---------------------------------------------------------------- grandstands, pit building */
  World.prototype._buildStands = function () {
    var tr = this.track, m = this._featureMats(), L = tr.length, self = this, N = tr.N;
    function standGeo(s0, s1, side, rows, d0, mat) {
      var prof = [], rise = 0.5, run = 0.9, k;
      for (k = 0; k < rows; k++) {
        var lat = d0 + k * run, y = k * rise;
        prof.push([lat, y, 0, 0, 1]); prof.push([lat + run, y, 0, 0, 1]);
        prof.push([lat + run, y, 0, -1, 0]); prof.push([lat + run, y + rise, 0, -1, 0]);
      }
      var g = self._ribbon(Math.floor(s0 / tr.ds), Math.floor(s1 / tr.ds), { side: side, D: function (i) { return tr.width[i] * 0.5 + tr.barrierOffset + 3; }, profile: prof, u: function (k2, np, d) { return k2 / 4; }, v: function (s) { return s / 8; }, flip: side < 0 });
      return g;
    }
    var list = [
      { s0: 20, s1: 220, side: 1, rows: 14 },
      { s0: L - 150, s1: L - 30, side: -1, rows: 9, pit: true },
      { s0: 150, s1: 330, side: -1, rows: 7 }
    ];
    // T1 stand (outside of the first corner = right side)
    var tmp = {}; var t1 = tr.locate(91, 845, -1, tmp).s;
    list.push({ s0: t1 - 60, s1: t1 + 60, side: -1, rows: 8 });
    list.forEach(function (st, n) {
      var g = standGeo(st.s0, st.s1, st.side, st.rows, st.pit ? 14 : 0, null);
      self._addStatic(g, n % 2 ? m.crowd : m.crowd2, true);
      // roof canopy + posts
      var roofG = new Geo(), post = P.box(0.35, 1, 0.35, [1, 1, 1, 1]);
      var span = st.rows * 0.9 + 3;
      for (var s = st.s0; s <= st.s1; s += 10) {
        var d = (tr.width[Math.floor(s / tr.ds) % N] * 0.5 + tr.barrierOffset + 3) + (st.pit ? 14 : 0) + span * 0.5;
        var p = tr.pointAt(s, st.side * d), hRoof = st.rows * 0.5 + 4.5;
        roofG.append(P.box(0.35, hRoof, 0.35, [1, 1, 1, 1]), A.trs(p.x, p.y + hRoof / 2, p.z, p.heading, 1, 1, 1));
      }
      // roof slab as ribbon
      var slab = self._ribbon(Math.floor(st.s0 / tr.ds), Math.floor(st.s1 / tr.ds), { side: st.side, D: function (i) { return tr.width[i] * 0.5 + tr.barrierOffset + 3 + (st.pit ? 14 : 0); }, y: function () { return st.rows * 0.5 + 4.5; },
        profile: [[0, 0.0, 0, 0, -1], [span * 0.55, 0.9, 0, 0, -1], [span * 0.55, 1.05, 0, 0, 1], [0, 0.15, 0, 0, 1]], u: function (k) { return k * 0.3; }, v: function (s) { return s / 6; }, flip: st.side > 0 });
      roofG.append(slab);
      self._addStatic(roofG, m.steelGrey, true);
      // back wall with banner
      var bk = self._ribbon(Math.floor(st.s0 / tr.ds), Math.floor(st.s1 / tr.ds), { side: st.side, D: function (i) { return tr.width[i] * 0.5 + tr.barrierOffset + 3 + (st.pit ? 14 : 0) + st.rows * 0.9; },
        profile: [[0, 0, 0, 0, 1], [0, st.rows * 0.5 + 4.4, 0, 0, 1]], u: function (k) { return k; }, v: function (s) { return s / 8; }, flip: st.side > 0 });
      self._addStatic(bk, m.concreteLight, true);
      for (var q = 0; q < 2; q++) { /* spot for banner quads */ }
      var bn = new Geo(), sm = (st.s0 + st.s1) / 2;
      // billboards on the back wall
      for (var bs = st.s0 + 12; bs < st.s1 - 22; bs += 26) {
        var bd = tr.width[Math.floor(bs / tr.ds) % N] * 0.5 + tr.barrierOffset + 3 + (st.pit ? 14 : 0) + st.rows * 0.9 - 0.15;
        var bp = tr.pointAt(bs, st.side * bd);
        var quad = P.quadXY(20, 3.5, [1, 1, 1, 1]);
        // face the track: quad normal +Z rotated by heading; flip when side=-1... rotate by pi for side -1
        var ry = bp.heading + (st.side > 0 ? Math.PI / 2 : -Math.PI / 2);
        var mm = m.banners[(Math.floor(bs / 26) + n) % m.banners.length];
        self._addStatic(quad, mm, false, { xf: A.trs(bp.x, bp.y + 1.6, bp.z, ry, 1, 1, 1), bs: { x: bp.x, y: bp.y + 3, z: bp.z, r: 14 } });
      }
    });
    // pit building (right side, behind the pit wall)
    var pitG = new Geo(), pitRoof = new Geo(), pitGlass = new Geo();
    var s0 = L - 205, s1 = 120, len = (s1 + L - s0), mid = s0 + len / 2;
    var seg = 20, nseg = Math.ceil(len / seg);
    for (var n2 = 0; n2 < nseg; n2++) {
      var sc = s0 + n2 * seg + seg / 2, p = tr.pointAt(sc, -(tr.width[Math.floor((sc % L) / tr.ds) % N] * 0.5 + tr.barrierOffset + 14));
      var bw = seg - 0.4, bh = 8, bd2 = 12;
      var blk = P.box(bd2, bh, bw, [1, 1, 1, 1]);
      pitG.append(blk, A.trs(p.x, p.y + bh / 2 - 0.2, p.z, p.heading, 1, 1, 1));
      pitRoof.append(P.box(bd2 + 1.2, 0.5, bw + 0.4, [0.8, 0.8, 0.82, 1]), A.trs(p.x, p.y + bh + 0.05, p.z, p.heading, 1, 1, 1));
      // glass front (track side)
      var gq = P.quadXY(bw - 2, 3.2, [1, 1, 1, 1]);
      var lat = tr.pointAt(sc, -(tr.width[Math.floor((sc % L) / tr.ds) % N] * 0.5 + tr.barrierOffset + 14 - bd2 / 2 - 0.05));
      pitGlass.append(gq, A.trs(lat.x, lat.y + 1.0, lat.z, lat.heading - Math.PI / 2, 1, 1, 1));
      pitGlass.append(gq, A.trs(lat.x, lat.y + 4.6, lat.z, lat.heading - Math.PI / 2, 1, 1, 1));
    }
    this._addStatic(pitG, m.facade2, true);
    this._addStatic(pitRoof, m.steelGrey, true);
    this._addStatic(pitGlass, m.glass, false);
  };

  /* ---------------------------------------------------------------- start gantry */
  World.prototype._buildGantry = function () {
    var tr = this.track, m = this._featureMats(), hw = tr.width[0] / 2, g = new Geo();
    var p0 = tr.pointAt(0, 0), hgt = 9.2, span = hw + 4.0;
    var colBox = P.box(1.1, hgt, 1.1, [1, 1, 1, 1]);
    for (var side = -1; side <= 1; side += 2) { var p = tr.pointAt(0, side * span); g.append(colBox, A.trs(p.x, p.y + hgt / 2, p.z, p.heading, 1, 1, 1)); }
    // truss: top beam + diagonal-ish struts as boxes
    var beam = P.box(span * 2 + 1.2, 1.1, 1.0, [1, 1, 1, 1]);
    g.append(beam, A.trs(p0.x, p0.y + hgt + 0.2, p0.z, p0.heading, 1, 1, 1));
    this._addStatic(g, m.steelRed, true);
    // sponsor banner (both faces) under the beam
    var bq = P.quadXY(span * 2 - 2, 2.3, [1, 1, 1, 1]);
    this._addStatic(bq, m.banners[4], false, { xf: A.trs(p0.x - Math.sin(p0.heading) * 0.55, p0.y + hgt + 0.2 - 0.9 + 0.05, p0.z - Math.cos(p0.heading) * 0.55, p0.heading + Math.PI, 1, 1, 1), bs: { x: p0.x, y: p0.y + hgt, z: p0.z, r: span + 3 } });
    // start-lights panel
    var panel = P.box(11, 1.5, 0.5, [0.04, 0.04, 0.05, 1]);
    var pp = { x: p0.x - Math.sin(p0.heading) * 0.6, y: p0.y + hgt - 1.3, z: p0.z - Math.cos(p0.heading) * 0.6 };
    this._addStatic(panel, m.darkMetal, true, { xf: A.trs(pp.x, pp.y, pp.z, p0.heading, 1, 1, 1), bs: { x: pp.x, y: pp.y, z: pp.z, r: 7 } });
    this.lightDisc = this.R.eng.mesh(P.cylinder(0.38, 0.38, 0.15, 14, [1, 1, 1, 1], { center: true }));
    this.startLights = [];
    var fwdx = -Math.sin(p0.heading), fwdz = -Math.cos(p0.heading);       // towards the approaching cars
    for (var i = 0; i < 5; i++) for (var row = 0; row < 2; row++) {
      var lat = (i - 2) * 1.9, pl = tr.pointAt(0, lat);
      var xf = A.trs(pl.x + fwdx * 0.88, p0.y + hgt - 1.3 + (row ? -0.38 : 0.38), pl.z + fwdz * 0.88, pl.heading, 1, 1, 1, Math.PI / 2, 0);
      this.startLights.push({ n: i + 1, xf: xf, x: pl.x + fwdx * 0.88, y: p0.y + hgt - 1.3 + (row ? -0.38 : 0.38), z: pl.z + fwdz * 0.88 });
    }
    this.lightOn = this.R.material({ tex: 'white', base: [0.3, 0.02, 0.02, 1], emis: [14, 0.7, 0.5], castShadow: false });
    this.lightOff = this.R.material({ tex: 'white', base: [0.12, 0.01, 0.01, 1], emis: [0.1, 0, 0], castShadow: false });
    this.lightGreen = this.R.material({ tex: 'white', base: [0.02, 0.3, 0.04, 1], emis: [0.5, 14, 1.5], castShadow: false });
    this.lightsLit = 0; this.greenOn = false;
    this.gantry = { s: 0, pos: p0 };
    this.exclusions.push({ x: p0.x, z: p0.z, r: 60 });
  };

  /* ---------------------------------------------------------------- footbridge */
  World.prototype._buildBridge = function () {
    var tr = this.track, m = this._featureMats(), F = tr.features.footbridge, s = F.s, p = tr.pointAt(s, 0), N = tr.N;
    var hw = tr.width[Math.floor(s / tr.ds)] / 2, span = hw + tr.barrierOffset + 5, deckY = 6.4, g = new Geo(), gd = new Geo();
    var h = p.heading;
    gd.append(P.box(span * 2 + 6, 0.55, 3.4, [1, 1, 1, 1]), A.trs(p.x, p.y + deckY, p.z, h, 1, 1, 1).map ? null : null);
    var aff = function (lat, y, along, ry) { var q = tr.pointAt(s + (along || 0), lat); return A.trs(q.x, q.y + y, q.z, q.heading + (ry || 0), 1, 1, 1); };
    // deck lies across the road: long axis = lateral, so rotate the box by 90 degrees
    var deck = new Geo(); deck.append(P.box(3.4, 0.55, span * 2 + 8, [1, 1, 1, 1]), aff(0, deckY, 0, Math.PI / 2 + 0));
    // fix orientation: box length is along +Z of its frame, rotate to lateral
    deck = new Geo(); deck.append(P.box(span * 2 + 8, 0.55, 3.4, [1, 1, 1, 1]), aff(0, deckY, 0, 0));
    for (var side = -1; side <= 1; side += 2) {
      // pillars + stair ramps
      g.append(P.box(1.4, deckY, 1.4, [1, 1, 1, 1]), aff(side * span, deckY / 2, 0, 0));
      var rampLen = 14, rampAng = Math.atan2(deckY, rampLen);
      var q = tr.pointAt(s, side * (span + rampLen / 2 + 1));
      var ramp = P.box(rampLen / Math.cos(rampAng), 0.4, 3.0, [1, 1, 1, 1]);
      var ra = A.trs(q.x, q.y + deckY / 2, q.z, q.heading, 1, 1, 1, 0, 0);
      var tmpA = A.trs(0, 0, 0, 0, 1, 1, 1, 0, side * rampAng * 1);        // roll about forward axis tilts the lateral axis
      deck.append(ramp, A.mul(new Float32Array(12), 0, ra, 0, A.trs(0, 0, 0, 0, 1, 1, 1, 0, 0), 0));
      void tmpA;
      // railing posts
    }
    // railings (both sides of the deck)
    for (var rs = -1; rs <= 1; rs += 2) g.append(P.box(span * 2 + 8, 1.1, 0.12, [1, 1, 1, 1]), aff(0, deckY + 0.9, rs * 1.6, 0));
    // roof truss (light)
    g.append(P.box(span * 2 + 8, 0.25, 3.8, [1, 1, 1, 1]), aff(0, deckY + 3.0, 0, 0));
    for (var k = -4; k <= 4; k++) for (var ss = -1; ss <= 1; ss += 2) g.append(P.box(0.18, 3.0, 0.18, [1, 1, 1, 1]), aff(k * span / 4, deckY + 1.5, ss * 1.7, 0));
    this._addStatic(deck, m.concrete, true);
    this._addStatic(g, m.steelGrey, true);
    // banners hanging on both faces
    var bq = P.quadXY(14, 2.2, [1, 1, 1, 1]);
    [[-1, 0], [1, 1]].forEach(function (c) {
      var q = tr.pointAt(s + c[0] * -1.75, 0);
      var xf = A.trs(q.x, q.y + deckY + 1.4, q.z, q.heading + (c[0] < 0 ? Math.PI : 0), 1, 1, 1);
      this._addStatic(bq, m.banners[2 + c[1]], true, { xf: xf, bs: { x: q.x, y: q.y + deckY, z: q.z, r: 16 } });
    }, this);
    this.bridges.push({ s: s, y: p.y + deckY - 0.45, half: 2.4 });
    this.exclusions.push({ x: p.x, z: p.z, r: 45 });
  };

  /* ---------------------------------------------------------------- signs: hoardings, braking boards, chevrons */
  World.prototype._buildSigns = function () {
    var tr = this.track, m = this._featureMats(), N = tr.N, self = this, L = tr.length, k;
    // detect corners from the racing-line curvature
    var corners = [], inC = false, start = 0, peak = 0, thr = 1 / 230;
    for (var i = 0; i < N + 40; i++) {
      var kk = Math.abs(tr.line.k[i % N]);
      if (!inC && kk > thr) { inC = true; start = i; peak = kk; }
      else if (inC) { peak = Math.max(peak, kk); if (kk < thr * 0.6) { inC = false; if (i - start > 12 && start < N) corners.push({ i0: start, i1: i, dir: Math.sign(tr.k[(start + i >> 1) % N]), peak: peak }); } }
    }
    this.corners = corners;
    // hoardings on straights (right+left sides)
    var counter = 0;
    for (var s = 40; s < L - 30; s += 28) {
      var ii = Math.floor(s / tr.ds) % N;
      var curv = 0; for (k = -6; k <= 6; k++) curv = Math.max(curv, Math.abs(tr.k[(ii + k + N) % N]));
      if (curv > 1 / 300) continue;
      if (this.inTunnel && this.tunnel && s > this.tunnel.s0 - 30 && s < this.tunnel.s1 + 30) continue;
      for (var side = -1; side <= 1; side += 2) {
        if (side < 0 && (s > L - 250 || s < 560)) continue;                 // pit wall zone
        if (s > L - 260 && s < 260) { if (side > 0) continue; }
        var D = tr.barrierDistAt(ii, side) + 1.4, p = tr.pointAt(s, side * D);
        var quad = P.quadXY(8, 1.7, [1, 1, 1, 1]);
        var mat = m.banners[counter++ % m.banners.length];
        var ry = p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        var back = new Geo(); back.append(P.box(8.2, 1.9, 0.12, [0.15, 0.15, 0.17, 1]), A.trs(p.x, p.y + 1.2, p.z, ry, 1, 1, 1));
        this._addChunkItem(this._chunkIdx(s), back, m.darkMetal, true);
        // banner face
        var face = new Geo(); face.append(quad, A.trs(p.x + Math.sin(ry) * 0.07, p.y + 0.35, p.z + Math.cos(ry) * 0.07, ry, 1, 1, 1));
        this._addChunkItem(this._chunkIdx(s), face, mat, false);
        // legs
        var legs = new Geo();
        legs.append(P.box(0.14, 1.2, 0.14, [1, 1, 1, 1]), A.trs(p.x + Math.cos(ry) * -3, p.y + 0.6, p.z - Math.sin(ry) * -3, ry, 1, 1, 1));
        legs.append(P.box(0.14, 1.2, 0.14, [1, 1, 1, 1]), A.trs(p.x + Math.cos(ry) * 3, p.y + 0.6, p.z - Math.sin(ry) * 3, ry, 1, 1, 1));
        this._addChunkItem(this._chunkIdx(s), legs, m.steelGrey, false);
      }
    }
    // braking boards + chevrons
    var board = P.box(1.1, 1.1, 0.08, [1, 1, 1, 1]);
    corners.forEach(function (c) {
      var sE = c.i0 * tr.ds;
      var outside = c.dir > 0 ? -1 : 1;           // outer side of the corner relative to its direction (left corner => right side)
      ['300', '200', '150', '100', '50'].forEach(function (lab) {
        var sb = sE - parseInt(lab, 10) - 20; if (sb < 0) sb += L;
        var ii = Math.floor(sb / tr.ds) % N, p = tr.pointAt(sb, -outside * -1 * (tr.barrierDistAt(ii, outside) - 2.5) * 1);
        var side2 = -1;                          // boards on the right side
        var pp = tr.pointAt(sb, side2 * (tr.barrierDistAt(ii, side2) - 2.2));
        var g = new Geo(); g.append(P.quadXY(1.4, 1.4, [1, 1, 1, 1]), A.trs(pp.x, pp.y + 0.9, pp.z, pp.heading + Math.PI, 1, 1, 1));
        self._addChunkItem(self._chunkIdx(sb), g, m.boards[lab], false);
        var post = new Geo(); post.append(P.box(0.08, 1.0, 0.08, [1, 1, 1, 1]), A.trs(pp.x, pp.y + 0.5, pp.z, pp.heading, 1, 1, 1));
        self._addChunkItem(self._chunkIdx(sb), post, m.steelGrey, false);
      });
      // chevrons on the outside of the corner
      var cg = new Geo(), n = 0;
      for (var si = c.i0 + 4; si < c.i1; si += 6) {
        var ii2 = si % N, pos = tr.pointAt(si * tr.ds, outside * (tr.barrierDistAt(ii2, outside) + 1.2));
        var ang = pos.heading + (outside > 0 ? -Math.PI / 2 : Math.PI / 2) + 0;
        var look = c.dir > 0 ? 1 : -1;
        cg.append(P.quadXY(1.9, 1.9, [1, 1, 1, 1], look > 0), A.trs(pos.x, pos.y + 0.7, pos.z, ang, 1, 1, 1));
        n++;
      }
      if (n) self._addChunkItem(self._chunkIdx(((c.i0 + c.i1) >> 1) * tr.ds), cg, m.chevron, false);
    });
  };

  /* ---------------------------------------------------------------- lamp posts */
  World.prototype._buildLamps = function () {
    var tr = this.track, m = this._featureMats(), L = tr.length, N = tr.N, g = new Geo(), heads = new Geo();
    var pole = P.cylinder(0.12, 0.18, 10, 8, [1, 1, 1, 1]), arm = P.box(0.12, 0.12, 2.6, [1, 1, 1, 1]), head = P.box(0.6, 0.16, 1.2, [1, 1, 1, 1]);
    function add(s, side) {
      var ii = Math.floor(((s % L) + L) % L / tr.ds) % N, D = tr.barrierDistAt(ii, side) + 2.2, p = tr.pointAt(s, side * D);
      g.append(pole, A.trs(p.x, p.y, p.z, p.heading, 1, 1, 1));
      var ax = p.x - Math.cos(p.heading) * side * 1.3, az = p.z + Math.sin(p.heading) * side * 1.3;     // towards the track
      var aang = p.heading + side * Math.PI / 2 * 0 + Math.PI / 2;
      g.append(arm, A.trs(ax, p.y + 9.9, az, p.heading + Math.PI / 2, 1, 1, 1));
      var hx = p.x - Math.cos(p.heading) * side * 2.5, hz = p.z + Math.sin(p.heading) * side * 2.5;
      heads.append(head, A.trs(hx, p.y + 9.75, hz, p.heading + Math.PI / 2, 1, 1, 1));
      this.lights.push({ x: hx, y: p.y + 9.6, z: hz });
    }
    for (var s = L - 280; s < L + 620; s += 40) { add.call(this, s, 1); if (s > L - 130 || s < 130) add.call(this, s + 20, 1); add.call(this, s + 20, 1); }
    // corner lamps for the first corners
    this.corners && this.corners.forEach(function (c, ci) { if (ci > 14) return; for (var k = c.i0; k < c.i1; k += 20) add.call(this, k * tr.ds, c.dir > 0 ? -1 : 1); }, this);
    this._addStatic(g, m.steelGrey, true);
    this.lampHeads = this._addStatic(heads, m.lampHead, false);
  };

  /* ---------------------------------------------------------------- buildings */
  function gableRoof(w, d, h, ov, uvs) {
    var g = new Geo(), hw = w / 2 + ov, hd = d / 2 + ov;
    function face(a, b, c, dd, ux) {
      var i0 = g.vert(a[0], a[1], a[2], 0, 1, 0, 0, 0), i1 = g.vert(b[0], b[1], b[2], 0, 1, 0, 1 * ux, 0), i2 = g.vert(c[0], c[1], c[2], 0, 1, 0, 1 * ux, 1), i3 = g.vert(dd[0], dd[1], dd[2], 0, 1, 0, 0, 1);
      g.quad(i0, i1, i2, i3);
    }
    var sl = Math.hypot(hw, h);
    face([-hw, 0, -hd], [-hw, 0, hd], [0, h, hd], [0, h, -hd], hd * 2 / 5);
    face([hw, 0, hd], [hw, 0, -hd], [0, h, -hd], [0, h, hd], hd * 2 / 5);
    // gable ends (triangles)
    var t0 = g.vert(-hw + ov, 0, -hd + ov, 0, 0, -1, 0, 0), t1 = g.vert(hw - ov, 0, -hd + ov, 0, 0, -1, 1, 0), t2 = g.vert(0, h, -hd + ov, 0, 0, -1, 0.5, 1);
    g.tri(t0, t2, t1);
    var u0 = g.vert(hw - ov, 0, hd - ov, 0, 0, 1, 0, 0), u1 = g.vert(-hw + ov, 0, hd - ov, 0, 0, 1, 1, 0), u2 = g.vert(0, h, hd - ov, 0, 0, 1, 0.5, 1);
    g.tri(u0, u2, u1);
    return g.computeNormals();
  }

  World.prototype._placeOK = function (x, z, minEdge) {
    var T = this.terrain, i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell);
    if (i < 1 || j < 1 || i >= T.nx - 1 || j >= T.nz - 1) return false;
    var e = this.terrainEdge[j * T.W + i];
    if (e < minEdge) return false;
    var h = T.H, W = T.W, k = j * W + i;
    var sl = Math.max(Math.abs(h[k + 1] - h[k - 1]), Math.abs(h[k + W] - h[k - W])) / (2 * T.cell);
    return sl < 0.16 && !this.excluded(x, z);
  };

  World.prototype._buildBuildings = function () {
    var m = this._featureMats(), rng = U.makeRng(77), self = this, tr = this.track;
    var perStyle = [new Geo(), new Geo(), new Geo(), new Geo()], roofs = new Geo(), tower = new Geo();
    // village
    var SC = this.scene, vf = tr.features && tr.features.village, vc = vf ? { x: vf.x, z: vf.z } : { x: 910, z: 858 };
    // find a village centre on gentle ground away from the track: scan candidates around the feature hint
    var best = null, bestScore = 1e9, hasVillage = SC.buildings === 'village';
    for (var a = 0; a < (hasVillage ? 120 : 0); a++) {
      var cx = vc.x + (rng() - 0.5) * 700, cz = vc.z + (rng() - 0.5) * 700;
      var i = Math.round((cx - this.terrain.x0) / this.terrain.cell), j = Math.round((cz - this.terrain.z0) / this.terrain.cell);
      if (i < 3 || j < 3) continue;
      var e = this.terrainEdge[j * this.terrain.W + i]; if (e < 50 || e > 170) continue;
      var h0 = this.terrainHeight(cx, cz), sc = 0;
      for (var q = 0; q < 8; q++) { var ang = q * 0.785; sc += Math.abs(this.terrainHeight(cx + Math.cos(ang) * 60, cz + Math.sin(ang) * 60) - h0); }
      if (sc < bestScore) { bestScore = sc; best = { x: cx, z: cz }; }
    }
    if (best) {
      var base = rng() * 3;
      var count = 0;
      for (var n = 0; n < 220 && count < 34; n++) {
        var rr = Math.sqrt(rng()) * 105, th = rng() * 6.283;
        var x = best.x + Math.cos(th) * rr, z = best.z + Math.sin(th) * rr;
        if (!this._placeOK(x, z, 40)) continue;
        // keep houses apart
        var okd = true; for (var k = 0; k < this._houses.length && okd; k++) if (Math.hypot(this._houses[k].x - x, this._houses[k].z - z) < 17) okd = false;
        if (!okd) continue;
        var w = 8 + rng() * 6, d = 9 + rng() * 6, fl = 2 + Math.floor(rng() * 2), hgt = fl * 3, ry = base + Math.round(rng() * 2) * 1.5708 * 0 + (rng() - 0.5) * 0.35;
        var style = rng() < 0.4 ? 0 : 1;
        var gy = Math.min(this.terrainHeight(x, z), this.terrainHeight(x + w / 2, z + d / 2), this.terrainHeight(x - w / 2, z - d / 2)) ;
        var wall = P.box(w, hgt + 2.5, d, [0.95 + rng() * 0.1, 0.95 + rng() * 0.1, 0.95 + rng() * 0.1, 1]);
        perStyle[style].append(wall, A.trs(x, gy + (hgt - 2.5) / 2 + 0.0, z, ry, 1, 1, 1));
        roofs.append(gableRoof(w, d, 2.4 + rng() * 1.2, 0.5), A.trs(x, gy + hgt, z, ry + (rng() < 0.5 ? 0 : 1.5708 * 0), 1, 1, 1));
        this._houses.push({ x: x, z: z });
        this.exclusions.push({ x: x, z: z, r: 11 });
        count++;
      }
      // church tower + nave
      for (n = 0; n < 60; n++) {
        var tx = best.x + (rng() - 0.5) * 70, tz = best.z + (rng() - 0.5) * 70;
        if (!this._placeOK(tx, tz, 45)) continue;
        var ty = this.terrainHeight(tx, tz);
        perStyle[1].append(P.box(14, 11, 26, [1, 1, 1, 1]), A.trs(tx, ty + 3, tz, 0.3, 1, 1, 1));
        roofs.append(gableRoof(14, 26, 5, 0.5), A.trs(tx, ty + 8.5, tz, 0.3, 1, 1, 1));
        perStyle[1].append(P.box(6, 30, 6, [1, 1, 1, 1]), A.trs(tx + Math.sin(0.3) * 15, ty + 12, tz + Math.cos(0.3) * 15, 0.3, 1, 1, 1));
        var spire = P.cylinder(0.0, 3.6, 12, 4, [1, 1, 1, 1], { capBottom: false });
        roofs.append(spire, A.trs(tx + Math.sin(0.3) * 15, ty + 27, tz + Math.cos(0.3) * 15, 0.3 + 0.785, 1, 1, 1));
        this.exclusions.push({ x: tx, z: tz, r: 20 });
        break;
      }
    }
    // industrial zone: scan for a flat area 120-300 m from the road
    var ind = null; bestScore = 1e9;
    for (a = 0; a < (hasVillage ? 200 : 0); a++) {
      var ix = this.terrain.minX + 300 + rng() * (this.terrain.maxX - this.terrain.minX - 600), iz = this.terrain.minZ + 300 + rng() * (this.terrain.maxZ - this.terrain.minZ - 600);
      var ii = Math.round((ix - this.terrain.x0) / this.terrain.cell), jj = Math.round((iz - this.terrain.z0) / this.terrain.cell);
      var ee = this.terrainEdge[jj * this.terrain.W + ii]; if (ee < 90 || ee > 260) continue;
      if (best && Math.hypot(ix - best.x, iz - best.z) < 260) continue;
      var hh = this.terrainHeight(ix, iz), s2 = 0;
      for (q = 0; q < 8; q++) { ang = q * 0.785; s2 += Math.abs(this.terrainHeight(ix + Math.cos(ang) * 70, iz + Math.sin(ang) * 70) - hh); }
      if (s2 < bestScore) { bestScore = s2; ind = { x: ix, z: iz }; }
    }
    var metal = new Geo(), tanks = new Geo();
    if (ind) {
      var yy = this.terrainHeight(ind.x, ind.z), orient = 0.4;
      for (n = 0; n < 4; n++) {
        var wx = ind.x + Math.cos(orient) * (n - 1.5) * 52, wz = ind.z - Math.sin(orient) * (n - 1.5) * 52;
        var gh = this.terrainHeight(wx, wz);
        perStyle[3].append(P.box(36, 14, 22, [1, 1, 1, 1]), A.trs(wx, gh + 4.5, wz, orient, 1, 1, 1));
        roofs.append(P.box(37, 0.4, 23, [0.7, 0.72, 0.74, 1]), A.trs(wx, gh + 11.7, wz, orient, 1, 1, 1));
        this.exclusions.push({ x: wx, z: wz, r: 34 });
      }
      for (n = 0; n < 4; n++) {
        var sx = ind.x + 40 + (n % 2) * 14, sz = ind.z + 50 + Math.floor(n / 2) * 14, sy = this.terrainHeight(sx, sz);
        tanks.append(P.cylinder(5, 5, 24, 18, [0.8, 0.82, 0.84, 1]), A.trs(sx, sy - 1, sz, 0, 1, 1, 1));
        this.exclusions.push({ x: sx, z: sz, r: 9 });
      }
      tanks.append(P.cylinder(1.6, 2.4, 52, 12, [0.65, 0.2, 0.18, 1]), A.trs(ind.x - 36, this.terrainHeight(ind.x - 36, ind.z - 48) - 1, ind.z - 48, 0, 1, 1, 1));
    }
    if (SC.buildings === 'city' || SC.buildings === 'towers') this._buildCity(perStyle, roofs, rng);
    if (SC.sea) this._buildSea();
    perStyle.forEach(function (g, i) { this._addStatic(g, m['facade' + i], true); }, this);
    this._addStatic(roofs, m.roof, true);
    this._addStatic(tanks, m.steelGrey, true);
  };
  /* skyline of towers around the circuit (modern / tropical / night city, futuristic metropolis) with emissive windows + neon */
  World.prototype._buildCity = function (perStyle, roofs, rng) {
    var SC = this.scene, m = this._featureMats(), T = this.terrain, fut = SC.buildings === 'towers', n = 0, tries = 0, target = Math.round(120 * (SC.cityDensity || 1));
    var neon = [new Geo(), new Geo(), new Geo()], placed = [];
    while (n < target && tries < 4000) {
      tries++;
      var x = T.minX + 80 + rng() * (T.maxX - T.minX - 160), z = T.minZ + 80 + rng() * (T.maxZ - T.minZ - 160);
      var i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell), e = this.terrainEdge[j * T.W + i];
      if (e < 42 || e > (fut ? 520 : 420)) continue;
      var w = 14 + rng() * 22, d = 14 + rng() * 22, ok = true;
      for (var k = 0; k < placed.length; k++) if (Math.hypot(placed[k][0] - x, placed[k][1] - z) < (placed[k][2] + w) * 0.75) { ok = false; break; }
      if (!ok || this.excluded(x, z)) continue;
      var core = 1 - Math.min(1, e / 480), hgt = fut ? 70 + rng() * 150 * (0.4 + core) : 22 + rng() * 60 * (0.3 + core);
      var gy = Math.min(this.terrainHeight(x, z), this.terrainHeight(x + w / 2, z + d / 2), this.terrainHeight(x - w / 2, z - d / 2)) - 1.5, ry = (rng() - 0.5) * 0.5, st = Math.floor(rng() * 4);
      perStyle[st].append(P.box(w, hgt, d, [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 1]), A.trs(x, gy + hgt / 2, z, ry, 1, 1, 1));
      roofs.append(P.box(w + 0.6, 0.8, d + 0.6, [0.55, 0.57, 0.6, 1]), A.trs(x, gy + hgt + 0.4, z, ry, 1, 1, 1));
      if (fut) { var ng = neon[n % 3]; ng.append(P.box(w + 0.8, 1.2, d + 0.8, [1, 1, 1, 1]), A.trs(x, gy + hgt * 0.72, z, ry, 1, 1, 1)); ng.append(P.box(w + 0.8, 1.2, d + 0.8, [1, 1, 1, 1]), A.trs(x, gy + hgt + 1.2, z, ry, 1, 1, 1)); }
      else if (SC.neon && rng() < 0.55) neon[n % 3].append(P.box(w + 0.5, 1.0, d + 0.5, [1, 1, 1, 1]), A.trs(x, gy + hgt * (0.55 + rng() * 0.35), z, ry, 1, 1, 1));
      placed.push([x, z, w]); this.exclusions.push({ x: x, z: z, r: w * 0.8 }); n++;
    }
    var cols = [[0.1, 5, 6.5], [6.5, 0.4, 5], [6.2, 3, 0.4]];
    for (var q = 0; q < 3; q++) this._addStatic(neon[q], this.R.material({ tex: 'white', base: [0.02, 0.02, 0.03, 1], emis: cols[q], castShadow: false }), false);
    this.cityCount = n;
  };
  /* sea: a large reflective water sheet below road level (terrain falls away on the +X side) */
  World.prototype._buildSea = function () {
    var T = this.terrain, g = P.plane(T.maxX - T.minX + 4000, T.maxZ - T.minZ + 4000, 1, 1, [1, 1, 1, 1]);
    var mat = this.R.material({ tex: 'white', base: [0.02, 0.22, 0.34, 0.86], rough: 0.04, metal: 0.0, spec: 2.2, blend: 'alpha', depthWrite: false, castShadow: false, glass: true });
    var wg = new Geo(); wg.append(g, A.trs((T.minX + T.maxX) / 2, -11, (T.minZ + T.maxZ) / 2, 0, 1, 1, 1));
    this._addStatic(wg, mat, false);
  };
  World.prototype._houses = [];
  var _origInit = World.prototype._buildBuildings;
  World.prototype._buildBuildings = function () { this._houses = []; return _origInit.call(this); };

  /* ---------------------------------------------------------------- trees */
  function noisyBlob(r, seed, wseg, hseg, col, base, hTotal) {
    var g = P.sphere(r, wseg, hseg, col, 0.82), rng = U.makeRng(seed);
    for (var i = 0; i < g.p.length; i += 3) {
      var x = g.p[i], y = g.p[i + 1], z = g.p[i + 2], l = Math.hypot(x, y, z) || 1;
      var n = 1 + 0.30 * (U.valueNoise(x * 0.9 + seed, z * 0.9, seed) - 0.5) * 2 + 0.2 * (U.valueNoise(y * 1.3 + 7, x * 1.3, seed) - 0.5) * 2;
      g.p[i] = x * n; g.p[i + 1] = y * n; g.p[i + 2] = z * n;
    }
    g.computeNormals();
    for (i = 0; i < g.c.length; i += 4) { var yy = g.p[(i / 4) * 3 + 1]; var t = clamp((yy + r) / (2 * r), 0, 1); g.c[i + 3] = 0.45 + 0.55 * t; var tone = 0.85 + 0.35 * t; g.c[i] *= tone; g.c[i + 1] *= tone; g.c[i + 2] *= tone; }
    return g;
  }
  function treeGeos(kind, lod) {
    var trunk = new Geo(), crown = new Geo(), rng = U.makeRng(kind * 10 + lod + 3);
    if (kind === 0) {                                   // broadleaf
      trunk.append(P.cylinder(0.16, 0.34, 4.6, lod === 0 ? 8 : 5, [1, 1, 1, 1]), A.trs(0, 0, 0, 0, 1, 1, 1));
      var blobs = [[0, 6.4, 0, 3.3], [1.9, 5.4, 0.8, 2.5], [-1.7, 5.7, -1.0, 2.6], [0.3, 8.1, 0.4, 2.3], [-0.6, 5.2, 1.9, 2.2]];
      var nb = lod === 0 ? 5 : 3, ws = lod === 0 ? 10 : 6, hs = lod === 0 ? 7 : 4;
      for (var i = 0; i < nb; i++) { var b = blobs[i]; crown.append(noisyBlob(b[3], 20 + i, ws, hs, [0.95, 1, 0.9, 1]), A.trs(b[0], b[1], b[2], i, 1, 1, 1)); }
    } else {                                            // pine
      trunk.append(P.cylinder(0.14, 0.30, 4.0, lod === 0 ? 8 : 5, [1, 1, 1, 1]), A.trs(0, 0, 0, 0, 1, 1, 1));
      var cones = lod === 0 ? 6 : 3, seg = lod === 0 ? 10 : 6;
      for (i = 0; i < cones; i++) {
        var r = (cones === 6 ? 2.7 : 3.0) * (1 - i / cones * 0.78), hC = cones === 6 ? 3.3 : 5.5, y0 = 1.8 + i * (cones === 6 ? 2.2 : 3.6);
        var cg = P.cylinder(0.0, r, hC, seg, [0.9, 1, 0.9, 1], { capBottom: true });
        for (var q = 0; q < cg.c.length; q += 4) { var py = cg.p[(q / 4) * 3 + 1] / hC; cg.c[q + 3] = 0.4 + 0.6 * py; if (lod === 0) { var j = U.valueNoise(cg.p[(q / 4) * 3] * 2 + i, cg.p[(q / 4) * 3 + 2] * 2, i); cg.c[q] *= 0.8 + j * 0.4; } }
        crown.append(cg, A.trs(0, y0, 0, i * 0.7, 1, 1, 1));
      }
    }
    return { trunk: trunk, crown: crown };
  }

  World.prototype._buildTrees = function () {
    var R = this.R, q = this.q, m = this._featureMats(), T = this.terrain, rng = U.makeRng(2024), self = this;
    var target = 26000;
    var data = new Float32Array(target * 8), n = 0, tries = 0;
    var fm = function (x, z) { return U.fbm(x * 0.0035 + 10, z * 0.0035, 66, 4); };
    while (n < target && tries < target * 6) {
      tries++;
      var x = T.minX + 60 + rng() * (T.maxX - T.minX - 120), z = T.minZ + 60 + rng() * (T.maxZ - T.minZ - 120);
      var i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell), k = j * T.W + i;
      var e = this.terrainEdge[k]; if (e < 40 || e > 1100) continue;
      var h = T.H[k]; if (h > 190) continue;
      var near = 1 - smooth(200, 1000, e), TS = this.scene.trees;
      var forest = fm(x, z), p = (smooth(0.42, 0.58, forest) * (0.35 + 0.65 * near) + 0.05 * near) * (1 - smooth(120, 190, h)) * TS.density;
      if (rng() > p) continue;
      if (this.scene.sea && h < -3) continue;
      var sl = Math.max(Math.abs(T.H[k + 1] - T.H[k - 1]), Math.abs(T.H[k + T.W] - T.H[k - T.W])) / (2 * T.cell);
      if (sl > 0.65) continue;
      if (this.excluded(x, z)) continue;
      var o = n * 8;
      data[o] = x; data[o + 1] = this.terrainHeight(x, z) - 0.15; data[o + 2] = z; data[o + 3] = rng() * 6.283;
      data[o + 4] = (0.7 + rng() * 0.85) * (1 + smooth(200, 500, e) * 0.2); data[o + 5] = this.scene.id === 'classic' ? (h > 28 || forest > 0.62 ? (rng() < 0.7 ? 1 : 0) : (rng() < 0.28 ? 1 : 0)) : (rng() < TS.pine ? 1 : 0); data[o + 6] = rng(); data[o + 7] = rng();
      n++;
    }
    this.treeData = data; this.treeN = n;
    // geometry per kind/LOD
    var eng = R.eng;
    this.treeMeshes = [];
    for (var kind = 0; kind < 2; kind++) {
      var lods = [];
      for (var lod = 0; lod < 2; lod++) { var g = treeGeos(kind, lod); lods.push({ trunk: eng.mesh(g.trunk), crown: eng.mesh(g.crown) }); }
      // LOD2: crossed cards with alpha cut-out
      var cv = JR.textures.CAN.treeCard(kind), tex = eng.canvasTexture(cv, { clamp: true });
      var cw = kind === 0 ? 9.5 : 6.5, ch = kind === 0 ? 11.5 : 15, card = new Geo();
      for (var c = 0; c < 2; c++) card.append(P.quadXY(cw, ch, [1, 1, 1, 1]), A.trs(0, 0, 0, c * Math.PI / 2, 1, 1, 1));
      // double sided cards: add reversed copies
      var rev = new Geo(); for (c = 0; c < 2; c++) rev.append(P.quadXY(cw, ch, [1, 1, 1, 1]), A.trs(0, 0, 0, c * Math.PI / 2 + Math.PI, 1, 1, 1));
      card.append(rev);
      var cardMat = R.material({ t0: tex, t1: R.tex.white.t1, rough: 1, alphaTest: true, cut: 0.5, cull: false, sway: true, spec: 0.5 });
      lods.push({ card: eng.mesh(card), cardMat: cardMat });
      this.treeMeshes.push(lods);
    }
    this.treeInst = [];
    for (kind = 0; kind < 2; kind++) { var arr = []; var caps = [4096, 10000, 20000]; for (var l = 0; l < 3; l++) arr.push(eng.instances(caps[l])); this.treeInst.push(arr); }
    this.treeStats = { total: n };
    this.treeLayer = {
      prepare: function (R2) { self._cullTrees(R2); },
      drawShadow: function (R2, ci) { if (ci < 2) self._drawTrees(R2, true); },
      drawOpaque: function (R2) { self._drawTrees(R2, false); },
      drawAlpha: function (R2) { self._drawTreeCards(R2); },
      drawRefl: function (R2) { self._drawTrees(R2, false, true); }
    };
    R.addLayer(this.treeLayer);
  };

  World.prototype._cullTrees = function (R) {
    var d = this.treeData, n = this.treeN, cam = R.camPos, q = R.q, i, kind;
    for (kind = 0; kind < 2; kind++) for (var l = 0; l < 3; l++) this.treeInst[kind][l].n = 0;
    var far2 = q.treeDist * q.treeDist, l0 = 80 * q.lodBias, l1 = 260 * q.lodBias, l0s = l0 * l0, l1s = l1 * l1;
    var aff = new Float32Array(12), tint = [1, 1, 1, 1];
    var p = R.planes, camx = cam[0], camy = cam[1], camz = cam[2];
    for (i = 0; i < n; i++) {
      var o = i * 8, x = d[o], z = d[o + 2], dx = x - camx, dz = z - camz, d2 = dx * dx + dz * dz;
      if (d2 > far2 || d[o + 7] > q.trees) continue;
      var sc = d[o + 4], y = d[o + 1], rad = sc * 8;
      var vis = true;
      if (d2 > 900) for (var pi = 0; pi < 24; pi += 4) if (p[pi] * x + p[pi + 1] * (y + sc * 5) + p[pi + 2] * z + p[pi + 3] < -rad) { vis = false; break; }
      if (!vis) continue;
      var lod = d2 < l0s ? 0 : (d2 < l1s ? 1 : 2), kind2 = d[o + 5] | 0, tone = d[o + 6];
      A.compose(aff, 0, x, y, d[o + 2 + 1 - 1 + 0] === undefined ? y : y, 0, 0, 0, 1);
      A.compose(aff, 0, x, y, z, d[o + 3], 0, 0, sc);
      if (kind2 === 1) { tint[0] = 0.78 + tone * 0.25; tint[1] = 0.84 + tone * 0.2; tint[2] = 0.78 + tone * 0.22; }
      else { tint[0] = 0.72 + tone * 0.55; tint[1] = 0.82 + tone * 0.3; tint[2] = 0.62 + tone * 0.4; }
      var tt = this.scene.treeTint; if (tt) { tint[0] *= tt[0]; tint[1] *= tt[1]; tint[2] *= tt[2]; }
      this.treeInst[kind2][lod].push(aff, 0, tint);
    }
    for (kind = 0; kind < 2; kind++) for (l = 0; l < 3; l++) this.treeInst[kind][l].upload();
  };

  World.prototype._drawTrees = function (R, shadow, refl) {
    var m = this._featureMats();
    for (var kind = 0; kind < 2; kind++) for (var lod = 0; lod < 2; lod++) {
      var inst = this.treeInst[kind][lod]; if (!inst.n) continue;
      if (refl && lod > 0) continue;
      var tm = this.treeMeshes[kind][lod];
      R.drawMesh(tm.trunk, null, inst, m.bark);
      R.drawMesh(tm.crown, null, inst, kind === 1 ? m.foliagePine : m.foliage);
    }
    if (shadow) {
      // far trees also cast (cheap cards) in the wide cascades
      for (kind = 0; kind < 2; kind++) { var i2 = this.treeInst[kind][2]; if (i2.n) { var lo = this.treeMeshes[kind][2]; R.drawMesh(lo.card, null, i2, lo.cardMat); } }
    }
  };
  World.prototype._drawTreeCards = function (R) {
    for (var kind = 0; kind < 2; kind++) { var inst = this.treeInst[kind][2]; if (!inst.n) continue; var lo = this.treeMeshes[kind][2]; R.drawMesh(lo.card, null, inst, lo.cardMat); }
  };

  /* start lights / lamps dynamic draw (called from the world's own opaque pass) */
  var _drawAll = World.prototype._drawAll;
  World.prototype._drawAll = function (R, shadow, refl) {
    _drawAll.call(this, R, shadow, refl);
    if (shadow || !this.startLights) return;
    var disc = this.lightDisc;
    for (var i = 0; i < this.startLights.length; i++) {
      var L = this.startLights[i];
      var mat = this.greenOn ? this.lightGreen : (this.lightsLit >= L.n ? this.lightOn : this.lightOff);
      R.drawMesh(disc, L.xf, null, mat);
    }
  };

  JR.worldFeatures = true;
})();
