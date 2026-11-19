/* JIMMY RACING - world.js
 * Builds the 3D circuit from the same track data used by the simulation:
 * terrain (height field with mountains), asphalt / kerbs / gravel ribbons, guard-rails, walls,
 * start line, trees (per-tree LOD + culling), buildings, grandstands, tunnel, footbridge, signage.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var GL = JR.gl, Geo = GL.Geo, P = GL.P, A = GL.A;
  var U = JR.util, clamp = U.clamp, smooth = U.smoothstep;

  var CHUNK = 50;   // road samples per chunk (100 m)

  function World(R, track, opts) {
    this.R = R; this.track = track; this.q = R.q; this.opts = opts || {};
    this.scene = this.opts.scene || JR.levels.SCENES.classic;
    this.rng = U.makeRng(4242);
    this.chunks = [];         // {bs, items:[{mesh, mat, xf, cast}]}
    this.terrainChunks = [];
    this.statics = [];        // misc static items with own bounding sphere
    this.mats = {};
    this.lights = [];         // night lamp positions (for glow sprites)
    this.gantry = null;
    this.tunnel = null;
    this.bridges = [];
    this._tmp = {};
    this._buildMaterials();
    this._buildTerrain();
    this._buildRoad();
    this._buildBarriers();
    this._buildStartLine();
    this._buildFeatures && this._buildFeatures();
  }

  World.prototype._buildMaterials = function () {
    var R = this.R, m = this.mats, T = R.tex;
    m.asphalt = R.material({ tex: 'asphalt', rough: 1, wetAff: 1, nstr: 0.55, spec: 0.9, polyOff: [1, 1], base: [0.78, 0.78, 0.8, 1] });
    m.kerb = R.material({ tex: 'kerb', rough: 1, wetAff: 0.7, nstr: 0.8, polyOff: [1, 1] });
    m.gravel = R.material({ tex: 'gravel', rough: 1, wetAff: 0.4, nstr: 1.0, ts: [1, 1] });
    m.grass = R.material({ tex: 'grass', terrain: 'rock', rough: 1, wetAff: 0.35, nstr: 0.8, ts: [1, 1] });
    m.concrete = R.material({ tex: 'concrete', rough: 1, wetAff: 0.2, nstr: 0.8 });
    m.metal = R.material({ tex: 'white', base: [0.66, 0.68, 0.70, 1], rough: 0.5, metal: 0.9 });
    m.steel = R.material({ tex: 'white', base: [0.30, 0.31, 0.33, 1], rough: 0.4, metal: 0.9 });
    m.paintWhite = R.material({ tex: 'white', base: [0.85, 0.85, 0.85, 1], rough: 0.5, polyOff: [-2, -2], wetAff: 0.8 });
  };

  /* ================================================================= nearest-track lookup (numeric grid) */
  World.prototype._buildNearGrid = function () {
    var tr = this.track, N = tr.N, cs = 30, minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9, i;
    for (i = 0; i < N; i++) { minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]); minZ = Math.min(minZ, tr.z[i]); maxZ = Math.max(maxZ, tr.z[i]); }
    var gx = Math.ceil((maxX - minX) / cs) + 3, gz = Math.ceil((maxZ - minZ) / cs) + 3;
    var head = new Int32Array(gx * gz).fill(-1), next = new Int32Array(N);
    for (i = 0; i < N; i++) {
      var cx = Math.floor((tr.x[i] - minX) / cs) + 1, cz = Math.floor((tr.z[i] - minZ) / cs) + 1, k = cz * gx + cx;
      next[i] = head[k]; head[k] = i;
    }
    this.ng = { cs: cs, minX: minX, minZ: minZ, gx: gx, gz: gz, head: head, next: next };
  };
  /* returns nearest sample index (or -1 if none within maxRing cells) and writes squared distance to this._nd2 */
  World.prototype._nearest = function (px, pz, maxRing) {
    var g = this.ng, tr = this.track, cx = Math.floor((px - g.minX) / g.cs) + 1, cz = Math.floor((pz - g.minZ) / g.cs) + 1;
    var best = 1e18, bi = -1;
    for (var r = 0; r <= maxRing; r++) {
      for (var z = cz - r; z <= cz + r; z++) {
        if (z < 0 || z >= g.gz) continue;
        var edgeRow = (z === cz - r || z === cz + r);
        for (var x = cx - r; x <= cx + r; x += (edgeRow ? 1 : Math.max(1, 2 * r))) {
          if (x < 0 || x >= g.gx) continue;
          for (var i = g.head[z * g.gx + x]; i >= 0; i = g.next[i]) {
            var dx = tr.x[i] - px, dz = tr.z[i] - pz, d2 = dx * dx + dz * dz;
            if (d2 < best) { best = d2; bi = i; }
          }
        }
      }
      if (bi >= 0 && best < (r * g.cs) * (r * g.cs)) break;
    }
    this._nd2 = best;
    return bi;
  };

  /* ================================================================= terrain */
  World.prototype._buildTerrain = function () {
    this._buildNearGrid();
    var track = this.track, q = this.q;
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, i;
    for (i = 0; i < track.N; i += 4) { minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]); minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]); }
    var margin = 1500, cell = 10 * (q.terrainStep || 1);
    var CH = 30;                                       // cells per chunk side
    var nxC = Math.ceil((maxX - minX + margin * 2) / (cell * CH)), nzC = Math.ceil((maxZ - minZ + margin * 2) / (cell * CH));
    var nx = nxC * CH, nz = nzC * CH;
    var x0 = (minX + maxX) / 2 - nx * cell / 2, z0 = (minZ + maxZ) / 2 - nz * cell / 2;
    var W = nx + 1, H = new Float32Array(W * (nz + 1)), SP = new Float32Array(W * (nz + 1)), EDG = new Float32Array(W * (nz + 1)), DST = new Float32Array(W * (nz + 1));
    var flatEnd = 36, blend = 80, tr = track, self = this;
    var t0 = performance.now();
    // coarse distance field (every 4th vertex) for the far terrain, exact search near the road
    var CS = 4, cw = Math.floor(nx / CS) + 2, ch = Math.floor(nz / CS) + 2;
    var cD = new Float32Array(cw * ch), cY = new Float32Array(cw * ch), cI = new Int32Array(cw * ch);
    for (var cj = 0; cj < ch; cj++) for (var ci2 = 0; ci2 < cw; ci2++) {
      var bi = this._nearest(x0 + ci2 * CS * cell, z0 + cj * CS * cell, 26);
      var kk = cj * cw + ci2;
      if (bi < 0) { cD[kk] = 900 + Math.sqrt(0); cY[kk] = 8; cI[kk] = 0; } else { cD[kk] = Math.sqrt(this._nd2); cY[kk] = tr.y[bi]; cI[kk] = bi; }
    }
    for (var j = 0; j <= nz; j++) for (i = 0; i <= nx; i++) {
      var wx = x0 + i * cell, wz = z0 + j * cell, k = j * W + i;
      var fx = i / CS, fz = j / CS, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
      var c00 = iz * cw + ix, c10 = c00 + 1, c01 = c00 + cw, c11 = c01 + 1;
      var cd = (cD[c00] * (1 - tx) + cD[c10] * tx) * (1 - tz) + (cD[c01] * (1 - tx) + cD[c11] * tx) * tz;
      var dist, ry, halfW = 7.2;
      if (Math.min(cD[c00], cD[c10], cD[c01], cD[c11]) < 190) {
        var bi2 = this._nearest(wx, wz, 9);
        if (bi2 < 0) { dist = cd; ry = cY[c00]; } else { dist = Math.sqrt(this._nd2); ry = tr.y[bi2]; halfW = tr.width[bi2] * 0.5; }
      } else { dist = cd; ry = (cY[c00] * (1 - tx) + cY[c10] * tx) * (1 - tz) + (cY[c01] * (1 - tx) + cY[c11] * tx) * tz; }
      var edge = dist - halfW; DST[k] = dist; EDG[k] = edge;
      var far = smooth(120, 800, dist);
      var SCN = self.scene, gentle = ((U.fbm(wx * 0.006, wz * 0.006, 5, 4) - 0.5) * 16 + (U.fbm(wx * 0.025, wz * 0.025, 9, 3) - 0.5) * 3.5) * Math.min(1.4, SCN.amp);
      var mt = U.fbm(wx * 0.0017, wz * 0.0017, 33, 5), ridge = 1 - Math.abs(2 * U.fbm(wx * 0.0032 + 7, wz * 0.0032, 44, 4) - 1);
      var mountains = (far * (30 + 340 * Math.pow(mt, 1.5) * (0.45 + 0.8 * ridge)) + smooth(500, 1500, dist) * 150) * SCN.amp;
      if (SCN.sea) { var sd = smooth(70, 260, edge) * smooth(0, 200, wx - tr.circuit.HX * 0.6); mountains -= sd * 38; }   // the land falls into the sea on the +X side
      var hill = ry + gentle * smooth(8, 90, edge) + mountains;
      var t = smooth(flatEnd, flatEnd + blend, edge);
      var skirt = 0.04 + 0.26 * (1 - smooth(5.5, 9.5, edge));
      H[k] = (ry - skirt) * (1 - t) + hill * t;
      SP[k] = 0;
    }
    // smooth far terrain (not the road corridor) + slope limit
    for (var pass = 0; pass < 2; pass++) {
      var H2 = H.slice();
      for (j = 1; j < nz; j++) for (i = 1; i < nx; i++) {
        k = j * W + i; if (EDG[k] < flatEnd + 6) continue;
        H2[k] = (H[k] * 4 + H[k - 1] + H[k + 1] + H[k - W] + H[k + W]) / 8;
      }
      H.set(H2);
    }
    this.terrain = { x0: x0, z0: z0, cell: cell, nx: nx, nz: nz, W: W, H: H, minX: x0, maxX: x0 + nx * cell, minZ: z0, maxZ: z0 + nz * cell };
    // splat (rock) factor from slope + elevation above the road
    for (j = 1; j < nz; j++) for (i = 1; i < nx; i++) {
      k = j * W + i;
      var sx = (H[k + 1] - H[k - 1]) / (2 * cell), sz = (H[k + W] - H[k - W]) / (2 * cell);
      var slope = Math.sqrt(sx * sx + sz * sz);
      var el = H[k] - 20;
      SP[k] = clamp((smooth(0.42, 0.85, slope) + smooth(90, 200, H[k]) * 0.9 + smooth(0.9, 0.5, 1 - U.fbm(i * 0.07, j * 0.07, 3, 3)) * 0.1) * (this.scene.rock == null ? 1 : this.scene.rock), 0, 1);
    }
    this.terrainSP = SP; this.terrainEdge = EDG;
    // build chunks with 3 LODs and skirts
    var tex = this.mats.grass, self = this;
    for (var cj = 0; cj < nzC; cj++) for (var ci = 0; ci < nxC; ci++) {
      var lods = [], steps = [1, 3, 6];
      for (var li = 0; li < 3; li++) lods.push(self._terrainChunkMesh(ci, cj, CH, steps[li], cell, x0, z0, W, H, SP));
      var cx = x0 + (ci + 0.5) * CH * cell, cz = z0 + (cj + 0.5) * CH * cell, hh = 0, mn = 1e9, mx = -1e9;
      for (var a = 0; a <= CH; a += 5) for (var b = 0; b <= CH; b += 5) { var hv = H[(cj * CH + b) * W + ci * CH + a]; mn = Math.min(mn, hv); mx = Math.max(mx, hv); }
      this.terrainChunks.push({ lods: lods, bs: { x: cx, y: (mn + mx) / 2, z: cz, r: Math.hypot(CH * cell * 0.72, (mx - mn) / 2) + 20, maxDist: 99999 } });
    }
    this.buildMs = { terrain: performance.now() - t0 };
  };

  World.prototype._terrainChunkMesh = function (ci, cj, CH, step, cell, x0, z0, W, H, SP) {
    var g = new Geo(), n = CH / step + 1, i, j, base = [];
    var gi0 = ci * CH, gj0 = cj * CH;
    function hAt(i, j) { return H[j * W + i]; }
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var gi = gi0 + i * step, gj = gj0 + j * step, k = gj * W + gi;
      var h = H[k];
      var hl = H[k - (gi > 0 ? step : 0)], hr = H[k + (gi < W - 1 ? step : 0)], hd = H[k - (gj > 0 ? step : 0) * W], hu = H[k + (gj * W + W < H.length ? step : 0) * W];
      var nxv = (hl - hr), nzv = (hd - hu), ny = 2 * cell * step;
      var l = Math.hypot(nxv, ny, nzv);
      var wx = x0 + gi * cell, wz = z0 + gj * cell;
      var tintN = U.fbm(wx * 0.011, wz * 0.011, 7, 3), tintM = U.fbm(wx * 0.0021, wz * 0.0021, 8, 3), GR = this.scene.ground;
      var r = (0.88 + tintN * 0.3) * GR[0], gcol = (0.86 + tintN * 0.28 + (tintM - 0.5) * 0.25) * GR[1], b = (0.82 + tintN * 0.2) * GR[2];
      var edge = this.terrainEdge[k];
      var shade = 1 - 0.35 * (1 - smooth(0, 10, edge)) * 0;   // reserved
      g.vert(wx, h, wz, nxv / l, ny / l, nzv / l, wx / 8, wz / 8, r * shade, gcol * shade, b * shade, SP[k]);
    }
    for (j = 0; j < n - 1; j++) for (i = 0; i < n - 1; i++) {
      var a = j * n + i, b2 = a + 1, c = a + n, d = c + 1;
      g.tri(a, c, d); g.tri(a, d, b2);
    }
    // skirts (hide cracks between LODs)
    var self = this, depth = 18 + step * 6;
    function skirt(idxs) {
      for (var s = 0; s < idxs.length - 1; s++) {
        var p0 = idxs[s], p1 = idxs[s + 1];
        var a0 = g.vert(g.p[p0 * 3], g.p[p0 * 3 + 1] - depth, g.p[p0 * 3 + 2], g.n[p0 * 3], g.n[p0 * 3 + 1], g.n[p0 * 3 + 2], g.uv[p0 * 2], g.uv[p0 * 2 + 1], g.c[p0 * 4], g.c[p0 * 4 + 1], g.c[p0 * 4 + 2], g.c[p0 * 4 + 3]);
        var a1 = g.vert(g.p[p1 * 3], g.p[p1 * 3 + 1] - depth, g.p[p1 * 3 + 2], g.n[p1 * 3], g.n[p1 * 3 + 1], g.n[p1 * 3 + 2], g.uv[p1 * 2], g.uv[p1 * 2 + 1], g.c[p1 * 4], g.c[p1 * 4 + 1], g.c[p1 * 4 + 2], g.c[p1 * 4 + 3]);
        g.tri(p0, p1, a1); g.tri(p0, a1, a0); g.tri(p0, a1, p1); g.tri(p0, a0, a1);
      }
    }
    var e0 = [], e1 = [], e2 = [], e3 = [];
    for (i = 0; i < n; i++) { e0.push(i); e1.push((n - 1) * n + i); e2.push(i * n); e3.push(i * n + n - 1); }
    skirt(e0); skirt(e1); skirt(e2); skirt(e3);
    return this.R.eng.mesh(g);
  };

  /* bilinear terrain height at world x,z (matches the rendered LOD0 grid) */
  World.prototype.terrainHeight = function (x, z) {
    var t = this.terrain, fx = (x - t.x0) / t.cell, fz = (z - t.z0) / t.cell;
    if (fx < 0 || fz < 0 || fx >= t.nx || fz >= t.nz) return 0;
    var ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, W = t.W, H = t.H;
    var a = H[iz * W + ix], b = H[iz * W + ix + 1], c = H[(iz + 1) * W + ix], d = H[(iz + 1) * W + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /* ================================================================= ribbons along the track */
  /* Generic extruder: for sample range [i0,i1], build a strip following `profile` = [[lat, y, u?, nx, ny]...]
   * where lateral = side * (D(i) + lat). D, y offsets come from callbacks. */
  World.prototype._ribbon = function (i0, i1, o) {
    var tr = this.track, N = tr.N, g = o.geo || new Geo(), pf = o.profile, np = pf.length, s, k;
    var base = g.count();
    for (s = i0; s <= i1; s++) {
      var i = ((s % N) + N) % N;
      var cx = tr.x[i], cz = tr.z[i], lx = tr.tz[i], lz = -tr.tx[i], y = tr.y[i];
      var sArc = s * tr.ds;
      var D = o.D(i);
      var col = o.col ? o.col(i, s) : [1, 1, 1, 1];
      for (k = 0; k < np; k++) {
        var p = pf[k], lat = o.side * (D + p[0]);
        var vv = o.v ? o.v(sArc) : sArc / 10;
        var u = o.u ? o.u(k, np, D + p[0], p) : k / (np - 1);
        var nl = p[3] != null ? p[3] : 0, ny = p[4] != null ? p[4] : 1;
        var nx = lx * nl * o.side, nz = lz * nl * o.side;
        var cc = col;
        if (p[5] != null) cc = [col[0], col[1], col[2], col[3] * p[5]];
        g.vert(cx + lx * lat, y + (o.y ? o.y(i) : 0) + p[1], cz + lz * lat, nx, ny, nz, u, vv, cc[0], cc[1], cc[2], cc[3]);
      }
    }
    var rows = i1 - i0;
    for (var r = 0; r < rows; r++) {
      for (k = 0; k < np - 1; k++) {
        var a = base + r * np + k, b = a + 1, c = a + np, d = c + 1;
        if (o.flip) { g.tri(a, b, d); g.tri(a, d, c); } else { g.tri(a, d, b); g.tri(a, c, d); }
      }
    }
    return g;
  };

  World.prototype._chunkBounds = function (i0, i1, extra) {
    var tr = this.track, N = tr.N, mx = [1e9, 1e9, 1e9], Mx = [-1e9, -1e9, -1e9];
    for (var s = i0; s <= i1; s += 2) {
      var i = s % N;
      mx[0] = Math.min(mx[0], tr.x[i]); Mx[0] = Math.max(Mx[0], tr.x[i]); mx[1] = Math.min(mx[1], tr.y[i]); Mx[1] = Math.max(Mx[1], tr.y[i]);
      mx[2] = Math.min(mx[2], tr.z[i]); Mx[2] = Math.max(Mx[2], tr.z[i]);
    }
    var cx = (mx[0] + Mx[0]) / 2, cy = (mx[1] + Mx[1]) / 2, cz = (mx[2] + Mx[2]) / 2;
    return { x: cx, y: cy, z: cz, r: Math.hypot(Mx[0] - mx[0], Mx[1] - mx[1], Mx[2] - mx[2]) / 2 + (extra || 30) };
  };

  World.prototype._addChunkItem = function (ci, geo, mat, cast, minDist) {
    if (!geo || geo.count() === 0) return;
    var c = this.chunks[ci];
    c.items.push({ mesh: this.R.eng.mesh(geo), mat: mat, cast: cast !== false && mat.castShadow !== false, maxDist: minDist || 0 });
  };

  World.prototype._roadAO = function (i) {          // tunnel darkens, hook for later
    return 1;
  };

  World.prototype._buildRoad = function () {
    var tr = this.track, N = tr.N, nCh = Math.ceil(N / CHUNK), self = this, c;
    for (c = 0; c < nCh; c++) {
      var i0 = c * CHUNK, i1 = Math.min(N, i0 + CHUNK);
      this.chunks.push({ i0: i0, i1: i1, items: [], bs: this._chunkBounds(i0, i1, 40) });
    }
    var rnd = U.makeRng(5);
    var patch = function (i) { var n = U.fbm(tr.x[i] * 0.05, tr.z[i] * 0.05, 91, 3); return 0.86 + n * 0.28; };
    for (c = 0; c < nCh; c++) {
      var i0 = this.chunks[c].i0, i1 = this.chunks[c].i1;
      var ao = function (i) { return self._roadAO ? self._roadAO(i) : 1; };
      // asphalt: u across (left=0 .. right=1), v along every 14.5 m
      var half = function (i) { return tr.width[i] * 0.5; };
      var ga;
      ga = new Geo();
      for (var s = i0; s <= i1; s++) {
        var i = s % N, hw = half(i), lx = tr.tz[i], lz = -tr.tx[i], y = tr.y[i], p = patch(i), a = ao(i), v = s * tr.ds / 14.5;
        ga.vert(tr.x[i] + lx * hw, y, tr.z[i] + lz * hw, 0, 1, 0, 0, v, p, p, p, a);
        ga.vert(tr.x[i] - lx * hw, y, tr.z[i] - lz * hw, 0, 1, 0, 1, v, p, p, p, a);
      }
      for (var r = 0; r < i1 - i0; r++) { var b0 = r * 2; ga.tri(b0, b0 + 1, b0 + 3); ga.tri(b0, b0 + 3, b0 + 2); }
      this._addChunkItem(c, ga, this.mats.asphalt, false);
      // kerbs both sides
      for (var side = -1; side <= 1; side += 2) {
        var gk = this._ribbon(i0, i1, { side: side, D: half, y: function () { return 0; }, profile: [[0, 0.0, 0, 0, 1], [0.12, 0.045, 0, 0.6, 0.8], [tr.kerbW, 0.028, 0, 0, 1]],
          u: function (k, np) { return k / (np - 1); }, v: function (s) { return s / 2.4; }, col: function (i) { return [1, 1, 1, ao(i)]; }, flip: side > 0 });
        this._addChunkItem(c, gk, this.mats.kerb, false);
        var gg = this._ribbon(i0, i1, { side: side, D: function (i) { return half(i) + tr.kerbW; }, profile: [[0, -0.01, 0, 0, 1], [tr.gravelW * 0.5, -0.05, 0, 0, 1], [tr.gravelW, -0.03, 0, 0, 1]],
          u: function (k, np, d) { return d / 2.5; }, v: function (s) { return s / 2.5; }, col: function (i) { return [1, 1, 1, ao(i)]; }, flip: side > 0 });
        this._addChunkItem(c, gg, this.mats.gravel, false);
      }
    }
  };

  /* ================================================================= guard rails & walls */
  World.prototype._buildBarriers = function () {
    var tr = this.track, N = tr.N, nCh = this.chunks.length, self = this, L = tr.length;
    var beam = [[0, 0.50, 0, -1, 0], [0.025, 0.54, 0, -0.2, 0.2], [-0.012, 0.58, 0, -1, 0], [0.025, 0.62, 0, -0.2, 0.2], [-0.012, 0.66, 0, -1, 0], [0.025, 0.70, 0, -0.2, 0.2], [-0.012, 0.74, 0, -1, 0], [0, 0.78, 0, -1, 0.2]];
    var wall = [[-0.30, 0.0, 0, 0, 1, 0.5], [-0.30, 0.92, 0, -1, 0], [0.30, 0.92, 0, 0, 1], [0.30, 0.0, 0, 1, 0]];
    for (var c = 0; c < nCh; c++) {
      var i0 = this.chunks[c].i0, i1 = this.chunks[c].i1;
      for (var side = -1; side <= 1; side += 2) {
        var rail = (function (sd) { return function (i) { return tr.barrierDistAt(i, sd); }; })(side);
        var sMid = (i0 + i1) / 2 * tr.ds;
        var isWall = side < 0 && (sMid > L - 230 || sMid < 560);          // pit-side concrete wall on the main straight
        var g;
        if (isWall) {
          g = this._ribbon(i0, i1, { side: side, D: rail, profile: wall.map(function (p) { return [p[0], p[1], p[2], p[3], p[4], p[5]]; }), u: function (k, np, d) { return k * 0.5; }, v: function (s) { return s / 3; }, flip: side < 0 });
          this._addChunkItem(c, g, this.mats.concrete, true);
        } else {
          g = this._ribbon(i0, i1, { side: side, D: rail, profile: beam, u: function (k) { return k / 7; }, v: function (s) { return s / 4; }, flip: side > 0 });
          this._addChunkItem(c, g, R_metalDouble(this), true);
          // posts every 4 m
          var gp = new Geo(), box = P.box(0.10, 0.80, 0.10, [0.5, 0.52, 0.55, 1]);
          for (var s = i0; s < i1; s += 2) {
            var i = s % N, D = rail(i) + 0.14, lx = tr.tz[i], lz = -tr.tx[i];
            var aff = A.trs(tr.x[i] + lx * side * D, tr.y[i] + 0.4, tr.z[i] + lz * side * D, tr.heading[i], 1, 1, 1);
            gp.append(box, aff);
          }
          this._addChunkItem(c, gp, this.mats.metal, true);
        }
      }
    }
    function R_metalDouble(w) { if (!w.mats.metal2) w.mats.metal2 = w.R.material({ tex: 'white', base: [0.62, 0.64, 0.66, 1], rough: 0.5, metal: 0.85, cull: false }); return w.mats.metal2; }
  };

  /* ================================================================= start / finish line + grid slots */
  World.prototype._buildStartLine = function () {
    var tr = this.track, R = this.R, L = tr.length;
    var cv = JR.textures.CAN.checker(512, 128, 32);
    var t0 = R.eng.canvasTexture(cv, { clamp: true });
    var flat = R.tex.white.t1;
    var mat = R.material({ t0: t0, t1: flat, rough: 0.7, polyOff: [-3, -3], wetAff: 0.6, tintMul: [1, 1, 1, 1] });
    var g = new Geo(), p0 = tr.pointAt(0, 0), hw = tr.width[0] / 2;
    var len = 3.6;
    var a = tr.pointAt(-len / 2, hw), b = tr.pointAt(-len / 2, -hw), c = tr.pointAt(len / 2, -hw), d = tr.pointAt(len / 2, hw);
    var y = 0.018;
    g.vert(a.x, a.y + y, a.z, 0, 1, 0, 0, 0); g.vert(b.x, b.y + y, b.z, 0, 1, 0, 1, 0); g.vert(c.x, c.y + y, c.z, 0, 1, 0, 1, 1); g.vert(d.x, d.y + y, d.z, 0, 1, 0, 0, 1);
    g.tri(0, 1, 2); g.tri(0, 2, 3);
    this.startMesh = { mesh: R.eng.mesh(g), mat: mat };
    // grid slot rectangles (white outlines) behind the line: 2 columns, 6+ rows
    var gs = new Geo();
    function line(sa, da, sb, db) {      // thin painted segment between two (s,d) points
      var A0 = tr.pointAt(sa, da), B0 = tr.pointAt(sb, db), dx = B0.x - A0.x, dz = B0.z - A0.z, l = Math.hypot(dx, dz) || 1;
      var nx = -dz / l * 0.07, nz = dx / l * 0.07;
      var i0 = gs.vert(A0.x + nx, A0.y + 0.02, A0.z + nz, 0, 1, 0, 0, 0), i1 = gs.vert(A0.x - nx, A0.y + 0.02, A0.z - nz, 0, 1, 0, 1, 0), i2 = gs.vert(B0.x - nx, B0.y + 0.02, B0.z - nz, 0, 1, 0, 1, 1), i3 = gs.vert(B0.x + nx, B0.y + 0.02, B0.z + nz, 0, 1, 0, 0, 1);
      gs.tri(i0, i1, i2); gs.tri(i0, i2, i3);
    }
    for (var k = 0; k < 10; k++) {
      var row = Math.floor(k / 2), col = k % 2;
      var sBehind = 12 + row * 11 + (col ? 5.5 : 0), d = col ? -3.3 : 3.3;
      var s0 = L - sBehind - 2.6, s1 = L - sBehind + 2.6;
      line(s0, d - 1.1, s1, d - 1.1); line(s0, d + 1.1, s1, d + 1.1); line(s0, d - 1.1, s0, d + 1.1);
    }
    this.gridMesh = { mesh: R.eng.mesh(gs), mat: this.mats.paintWhite };
  };

  /* ================================================================= draw */
  World.prototype._terrainLod = function (ch, cam) {
    var dx = ch.bs.x - cam[0], dz = ch.bs.z - cam[2], d = Math.sqrt(dx * dx + dz * dz) - ch.bs.r * 0.55;
    var b = this.R.q.lodBias;
    if (d < 650 * b) return 0; if (d < 1500 * b) return 1; return 2;
  };

  World.prototype.drawShadow = function (R, ci) {
    this._drawAll(R, true, false);
  };
  World.prototype.drawOpaque = function (R) { this._drawAll(R, false, false); };
  World.prototype.drawRefl = function (R) { this._drawAll(R, false, true); };

  World.prototype._drawAll = function (R, shadow, refl) {
    var i, j, ch, it;
    var cam = R.camPos;
    // terrain
    var tm = this.mats.grass;
    for (i = 0; i < this.terrainChunks.length; i++) {
      ch = this.terrainChunks[i];
      if (refl) { var ddx = ch.bs.x - cam[0], ddz = ch.bs.z - cam[2]; if (ddx * ddx + ddz * ddz > 1200 * 1200) continue; }
      if (shadow) continue;                                              // terrain never casts (avoids acne/stripes)
      if (!R.visible(ch.bs)) continue;
      R.drawMesh(ch.lods[this._terrainLod(ch, cam)], null, null, tm);
    }
    for (i = 0; i < this.chunks.length; i++) {
      ch = this.chunks[i];
      if (!R.visible(ch.bs)) continue;
      if (refl) { var dx = ch.bs.x - cam[0], dz = ch.bs.z - cam[2]; if (dx * dx + dz * dz > 500 * 500) continue; }
      for (j = 0; j < ch.items.length; j++) {
        it = ch.items[j];
        if (shadow && !it.cast) continue;
        R.drawMesh(it.mesh, null, null, it.mat);
      }
    }
    for (i = 0; i < this.statics.length; i++) {
      it = this.statics[i];
      if (!R.visible(it.bs)) continue;
      if (shadow && !it.cast) continue;
      if (refl && !it.refl) continue;
      R.drawMesh(it.mesh, it.xf || null, it.inst || null, it.mat, it.tint);
    }
    if (!shadow && this.startMesh) { R.drawMesh(this.startMesh.mesh, null, null, this.startMesh.mat); R.drawMesh(this.gridMesh.mesh, null, null, this.gridMesh.mat); }
  };

  JR.World = World;
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
