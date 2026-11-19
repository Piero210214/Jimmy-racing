/* JIMMY RACING - cars_gfx.js : procedural, detailed car models + per-frame drawing
 * Car model space: +X left, +Y up, +Z forward, origin on the ground under the centre of gravity.
 * Draw order per car: paint (CAR variant with shader damage), trim, lights, interior, wheels (tyre / metal), glass.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var GL = JR.gl, Geo = GL.Geo, P = GL.P, A = GL.A, U = JR.util, clamp = U.clamp;

  function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  function lin(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }

  /* ---------- lofting helpers ---------- */
  /* stations: [z, halfWidth, yBottom, yShoulder, yTop]; produces a closed ring body, oriented outward */
  function ringOf(hw, y0, yS, yT, cr0) {
    var h = yS - y0, c = cr0 || 0, t = yT - yS, half = [
      [0, y0], [hw * 0.72, y0], [hw * 0.965, y0 + h * 0.20], [hw, y0 + h * 0.58], [hw * 0.99, yS - 0.035], [hw * 0.975, yS + 0.005],
      [hw * 0.93, yS + t * 0.28], [hw * 0.80, yT - t * 0.10], [hw * 0.55, yT + 0.004 + c * 0.25], [hw * 0.26, yT + 0.012 + c * 0.8], [0, yT + 0.016 + c]];
    var ring = half.slice(), k;
    for (k = half.length - 2; k >= 1; k--) ring.push([-half[k][0], half[k][1]]);
    return ring;
  }

  /* Catmull-Rom refinement of station tables (all columns) and of the closed cross-section ring */
  function cr(p0, p1, p2, p3, t) { var t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }
  function refineStations(st, sub) {
    var out = [], n = st.length, c = st[0].length;
    for (var i = 0; i < n - 1; i++) {
      var a = st[Math.max(0, i - 1)], b = st[i], d = st[i + 1], e = st[Math.min(n - 1, i + 2)];
      for (var k = 0; k < sub; k++) { var t = k / sub, row = []; for (var j = 0; j < c; j++) row.push(cr(a[j], b[j], d[j], e[j], t)); out.push(row); }
    }
    out.push(st[n - 1].slice()); return out;
  }
  function smoothRing(ring, sub) {
    var n = ring.length, out = [];
    for (var i = 0; i < n; i++) {
      var a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n], d = ring[(i + 2) % n];
      for (var k = 0; k < sub; k++) { var t = k / sub; out.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t)]); }
    }
    return out;
  }
  function loftBody(st, col) {
    st = refineStations(st, 4);
    var g = new Geo(), n = null, rings = [];
    for (var s = 0; s < st.length; s++) {
      var S = st[s], ring = smoothRing(ringOf(S[1], S[2], S[3], S[4], S[5]), 3); n = ring.length; rings.push(ring);
      for (var k = 0; k < n; k++) {
        var ao = clamp(0.5 + (ring[k][1] - S[2]) / Math.max(0.1, S[4] - S[2]) * 0.55, 0.5, 1);
        g.vert(ring[k][0], ring[k][1], S[0], 0, 1, 0, k / n * 3, s * 0.5, col[0], col[1], col[2], ao);
      }
    }
    for (s = 0; s < st.length - 1; s++) for (k = 0; k < n; k++) {
      var a = s * n + k, b = s * n + (k + 1) % n, c = (s + 1) * n + (k + 1) % n, d = (s + 1) * n + k;
      g.quad(a, d, c, b);
    }
    g.computeNormals();
    // orient the sides outward: the top-centre vertex normal must point up
    var mr = rings[Math.floor(st.length / 2)], tb = 0; for (var q = 1; q < n; q++) if (mr[q][1] > mr[tb][1]) tb = q;
    var topIdx = Math.floor(st.length / 2) * n + tb;
    if (g.n[topIdx * 3 + 1] < 0) { for (var i = 0; i < g.idx.length; i += 3) { var t = g.idx[i + 1]; g.idx[i + 1] = g.idx[i + 2]; g.idx[i + 2] = t; } }
    // end caps with their own vertices; winding chosen from the geometry so the face points out along -Z / +Z
    [0, st.length - 1].forEach(function (si) {
      var cy = 0, S = st[si], k2; for (k2 = 0; k2 < n; k2++) cy += rings[si][k2][1]; cy /= n;
      var c0 = g.vert(0, cy, S[0], 0, 0, si ? 1 : -1, 0.5, 0.5, col[0], col[1], col[2], 0.7), base = g.count();
      for (k2 = 0; k2 < n; k2++) g.vert(rings[si][k2][0], rings[si][k2][1], S[0], 0, 0, si ? 1 : -1, 0.5, 0.5, col[0], col[1], col[2], 0.7);
      var r0 = rings[si][0], r1 = rings[si][1], cz = (r0[0] - 0) * (r1[1] - cy) - (r0[1] - cy) * (r1[0] - 0);   // z of (v0-c) x (v1-c)
      var outZ = S[0] > st[si ? 0 : st.length - 1][0] ? 1 : -1;                                                 // outward direction along Z
      var ccw = cz > 0;                                                                                       // true: (c,v0,v1) faces +Z
      for (k2 = 0; k2 < n; k2++) { var v0 = base + k2, v1 = base + (k2 + 1) % n; if (ccw === (outZ > 0)) g.tri(c0, v0, v1); else g.tri(c0, v1, v0); }
    });
    g.computeNormals();
    return g;
  }
  /* cabin/greenhouse: stations [z, halfWidthBase, yBase, heightToRoof] */
  function loftCabin(st, col, roofOnly) {
    st = refineStations(st, 3);
    var g = new Geo(), n = 0, i, k;
    for (var s = 0; s < st.length; s++) {
      var S = st[s], hw = S[1], yb = S[2], h = S[3];
      var ring = [[hw, yb], [hw * 0.90, yb + h * 0.45], [hw * 0.74, yb + h * 0.88], [hw * 0.45, yb + h * 0.995], [0, yb + h + 0.01]];
      var full = ring.slice(); for (k = 3; k >= 0; k--) full.push([-ring[k][0], ring[k][1]]);
      if (roofOnly) { full = [full[2], full[3], full[4], full[5], full[6]]; }
      n = full.length;
      for (k = 0; k < n; k++) g.vert(full[k][0], full[k][1], S[0], 0, 1, 0, k / n * 2, s * 0.5, col[0], col[1], col[2], 1);
    }
    for (s = 0; s < st.length - 1; s++) for (k = 0; k < n - (roofOnly ? 1 : 0); k++) {
      var a = s * n + k, b = s * n + (k + 1) % n, c = (s + 1) * n + (k + 1) % n, d = (s + 1) * n + k;
      g.quad(a, d, c, b);
    }
    g.computeNormals();
    var mid = Math.floor(st.length / 2) * n + (roofOnly ? 2 : 4);
    if (g.n[mid * 3 + 1] < 0) { for (i = 0; i < g.idx.length; i += 3) { var t = g.idx[i + 1]; g.idx[i + 1] = g.idx[i + 2]; g.idx[i + 2] = t; } g.computeNormals(); }
    return g;
  }
  function torus(R0, r, seg, tseg, col) {
    var prof = [], n = tseg;
    for (var i = 0; i <= n; i++) { var a = i / n * Math.PI * 2; prof.push([R0 + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
    return P.lathe(prof, seg, col);
  }
  /* flip triangle winding if a lathe came out inside-out (checked on the first outward vertex) */
  function orient(g, probe) {
    var i = probe * 3, x = g.p[i], y = g.p[i + 1], z = g.p[i + 2];
    var d = g.n[i] * x + g.n[i + 1] * y + g.n[i + 2] * z;
    return g;
  }

  /* ---------- wheel ---------- */
  function buildTyre(R, hw) {
    var rimR = R * 0.60, prof = [
      [rimR, -hw * 0.86, 0, -1], [rimR + 0.04, -hw * 1.0, -0.85, -0.5], [R - 0.07, -hw * 1.02, -0.95, -0.2], [R - 0.02, -hw * 0.84, 0.6, -0.8],
      [R, -hw * 0.62, 1, -0.2], [R - 0.008, -hw * 0.50, 0.2, -0.5], [R - 0.008, -hw * 0.36, 0.2, 0.5], [R, -hw * 0.30, 1, 0],
      [R, hw * 0.30, 1, 0], [R - 0.008, hw * 0.36, 0.2, -0.5], [R - 0.008, hw * 0.50, 0.2, 0.5], [R, hw * 0.62, 1, 0.2],
      [R - 0.02, hw * 0.84, 0.6, 0.8], [R - 0.07, hw * 1.02, -0.95, 0.2], [rimR + 0.04, hw * 1.0, -0.85, 0.5], [rimR, hw * 0.86, 0, 1]];
    var g = P.lathe(prof, 56, [0.05, 0.05, 0.055, 1], 24);
    var tn = 44, tcol = [0.035, 0.035, 0.04, 1];                    // directional tread blocks on both shoulders + centre rib, sipes
    for (var ti = 0; ti < tn; ti++) {
      var ta = ti / tn * Math.PI * 2, tx = Math.cos(ta) * (R + 0.0015), tz = Math.sin(ta) * (R + 0.0015);
      [[-hw * 0.47, 0.5], [hw * 0.47, -0.5]].forEach(function (b) {
        g.append(P.box(0.011, hw * 0.34, 0.05, tcol), A.trs(tx, b[0], tz, -ta, 1, 1, 1, 0, b[1] * 0.0 + (b[0] < 0 ? 0.55 : -0.55)));
      });
    }
    g.append(torus(R - 0.012, 0.0045, 56, 6, [0.06, 0.06, 0.065, 1]), A.trs(0, -hw * 0.02, 0, 0, 1, 1, 1));
    // inside-out check: outermost tread vertex normal must point away from the axis
    var vi = (4 * 57) * 3; if (g.n[vi] * g.p[vi] < 0) for (var i = 0; i < g.idx.length; i += 3) { var t = g.idx[i + 1]; g.idx[i + 1] = g.idx[i + 2]; g.idx[i + 2] = t; }
    return g;
  }
  function buildWheelMetal(R, hw, side, caliperCol, spokes, rimCol) {
    var g = new Geo(), rimR = R * 0.60, x0 = hw * 0.78;
    // barrel + dished face (axis Y; outer face towards +Y)
    var prof = [[rimR * 0.22, hw * 0.55, 0, 1], [rimR * 0.30, hw * 0.50, 0, 1], [rimR * 0.62, hw * 0.60, 0.1, 1], [rimR * 0.97, hw * 0.88, 0.5, 0.8], [rimR, hw * 0.80, 1, 0], [rimR - 0.02, -hw * 0.7, 1, 0]];
    var face = P.lathe(prof, 40, rimCol, 6);
    var vi = 3 * 41 * 3; if (face.n[vi + 1] < 0 && face.p[vi + 1] > 0) { /* outer face faces away: flip */ for (var i = 0; i < face.idx.length; i += 3) { var t = face.idx[i + 1]; face.idx[i + 1] = face.idx[i + 2]; face.idx[i + 2] = t; } }
    g.append(face);
    // spokes
    for (var s = 0; s < spokes; s++) {
      var a = s / spokes * Math.PI * 2, rr = rimR * 0.62;
      var sp = P.box(0.05, 0.035, rimR * 0.86, rimCol.concat ? [rimCol[0] * 1.1, rimCol[1] * 1.1, rimCol[2] * 1.1, 1] : [1, 1, 1, 1]);
      g.append(sp, A.compose(new Float32Array(12), 0, Math.cos(a) * rr, hw * 0.82, Math.sin(a) * rr, -a + Math.PI / 2, 0, 0, 1).map(function (v) { return v; }));
    }
    g.append(P.cylinder(0.055, 0.055, 0.04, 16, [0.2, 0.2, 0.22, 1]), A.trs(0, hw * 0.80, 0, 0, 1, 1, 1));
    g.append(torus(rimR * 0.985, 0.011, 40, 8, [0.78, 0.8, 0.84, 1]), A.trs(0, hw * 0.86, 0, 0, 1, 1, 1));     // polished rim lip
    g.append(P.cylinder(0.026, 0.026, 0.05, 14, [0.82, 0.82, 0.86, 1]), A.trs(0, hw * 0.83, 0, 0, 1, 1, 1));    // centre cap
    // wheel bolts
    for (var bi = 0; bi < 5; bi++) { var ba = bi / 5 * Math.PI * 2 + 0.3; g.append(P.cylinder(0.014, 0.014, 0.03, 8, [0.75, 0.75, 0.78, 1]), A.trs(Math.cos(ba) * rimR * 0.2, hw * 0.83, Math.sin(ba) * rimR * 0.2, 0, 1, 1, 1)); }
    // drilled disc holes (dark dots visible between the spokes) + disc rim shadow
    for (var di = 0; di < 18; di++) { var da = di / 18 * Math.PI * 2; g.append(P.cylinder(0.012, 0.012, 0.004, 6, [0.05, 0.05, 0.05, 1]), A.trs(Math.cos(da) * R * 0.38, hw * 0.0 + 0.0185 - hw * 0.05, Math.sin(da) * R * 0.38, 0, 1, 1, 1)); }
    // brake disc (behind the face, inboard) + caliper
    var disc = P.cylinder(R * 0.47, R * 0.47, 0.034, 32, [0.55, 0.55, 0.58, 1]); g.append(disc, A.trs(0, -hw * 0.05, 0, 0, 1, 1, 1));
    g.append(P.cylinder(R * 0.16, R * 0.16, 0.07, 20, [0.18, 0.18, 0.2, 1]), A.trs(0, -hw * 0.05, 0, 0, 1, 1, 1));
    var cal = P.box(0.11, 0.09, R * 0.46, caliperCol); g.append(cal, A.trs(R * 0.40, hw * 0.12, -R * 0.05, 0.0, 1, 1, 1, 0, 0));
    // rotate axis Y -> X, outer face to +X (side=+1: left wheel) or -X
    var out = new Geo(); out.append(g, A.compose(new Float32Array(12), 0, 0, 0, 0, 0, 0, -side * Math.PI / 2, 1));
    return out;
  }
  function sideTyre(g, side) { var o = new Geo(); o.append(g, A.compose(new Float32Array(12), 0, 0, 0, 0, 0, 0, -side * Math.PI / 2, 1)); return o; }

  /* ---------- shape tables (z, halfWidth, y0, yShoulder, yHood/deck) ---------- */
  var SHAPES = {
    gt: {
      body: [[2.275, 0.66, 0.25, 0.42, 0.50, 0], [2.20, 0.82, 0.19, 0.48, 0.57, 0.01], [2.0, 0.91, 0.16, 0.58, 0.69, 0.015], [1.55, 0.96, 0.15, 0.69, 0.80, 0.025],
        [0.9, 0.96, 0.15, 0.73, 0.87, 0.025], [0.3, 0.95, 0.16, 0.75, 0.90, 0.01], [-0.5, 0.95, 0.16, 0.76, 0.91, 0], [-1.3, 0.99, 0.16, 0.79, 0.95, 0],
        [-1.9, 0.96, 0.19, 0.77, 0.93, 0], [-2.15, 0.89, 0.27, 0.71, 0.84, 0], [-2.275, 0.78, 0.35, 0.64, 0.73, 0]],
      cabin: [[0.62, 0.80, 0.88, 0.0], [0.42, 0.79, 0.88, 0.24], [0.02, 0.75, 0.89, 0.405], [-0.85, 0.75, 0.89, 0.41], [-1.25, 0.74, 0.89, 0.37], [-1.65, 0.78, 0.90, 0.18], [-1.78, 0.80, 0.90, 0.0]],
      wheelZ: [1.38, -1.32], track: 1.60, hlZ: 2.12, hlY: 0.66, tailZ: -2.2, tailY: 0.80, wing: 'duck', scoop: false, seatZ: -0.15, wheelPos: 0.2
    },
    rs: {
      body: [[2.2, 0.66, 0.19, 0.36, 0.45], [2.14, 0.84, 0.12, 0.45, 0.55], [1.95, 0.94, 0.11, 0.60, 0.69], [1.55, 0.99, 0.11, 0.66, 0.78],
        [0.95, 1.0, 0.12, 0.70, 0.82], [0.30, 0.99, 0.13, 0.72, 0.85], [-0.5, 0.99, 0.13, 0.73, 0.86], [-1.2, 0.99, 0.13, 0.74, 0.88],
        [-1.85, 0.97, 0.14, 0.74, 0.90], [-2.1, 0.90, 0.16, 0.72, 0.88], [-2.2, 0.80, 0.30, 0.60, 0.70]],
      cabin: [[0.40, 0.80, 0.86, 0.0], [0.22, 0.79, 0.86, 0.17], [-0.15, 0.74, 0.87, 0.32], [-0.9, 0.73, 0.88, 0.32], [-1.30, 0.74, 0.89, 0.25], [-1.60, 0.82, 0.90, 0.08], [-1.68, 0.84, 0.9, 0.0]],
      wheelZ: [1.30, -1.32], track: 1.66, hlZ: 2.05, hlY: 0.55, tailZ: -2.12, tailY: 0.76, wing: 'big', scoop: false, seatZ: -0.10, wheelPos: 0.2
    },
    muscle: {
      body: [[2.44, 0.70, 0.27, 0.48, 0.58], [2.38, 0.86, 0.22, 0.56, 0.70], [2.2, 0.94, 0.19, 0.70, 0.88], [1.7, 0.98, 0.17, 0.78, 1.02],
        [1.05, 0.98, 0.17, 0.82, 1.06], [0.45, 0.98, 0.18, 0.85, 1.07], [-0.5, 0.98, 0.18, 0.86, 1.08], [-1.4, 0.98, 0.18, 0.88, 1.09],
        [-2.1, 0.97, 0.19, 0.88, 1.08], [-2.35, 0.90, 0.24, 0.84, 1.02], [-2.44, 0.82, 0.36, 0.72, 0.86]],
      cabin: [[0.62, 0.84, 1.07, 0.0], [0.38, 0.83, 1.07, 0.20], [-0.05, 0.80, 1.08, 0.40], [-0.95, 0.80, 1.09, 0.41], [-1.45, 0.80, 1.09, 0.34], [-1.95, 0.86, 1.08, 0.14], [-2.05, 0.88, 1.08, 0.0]],
      wheelZ: [1.52, -1.32], track: 1.60, hlZ: 2.32, hlY: 0.78, tailZ: -2.40, tailY: 0.90, wing: 'lip', scoop: true, seatZ: -0.2, wheelPos: 0.2
    }
  };

  /* ---------- build one model (per car spec, shared by all cars of that model) ---------- */
  function buildModel(R, spec) {
    var sh = SHAPES[spec.shape], eng = R.eng, L = spec.length, Wd = spec.width, wr = spec.wheelRadius;
    var white = [1, 1, 1, 1], M = { spec: spec, sh: sh };
    var a = spec.wheelbase * (1 - spec.frontWeight);                        // cg -> front axle
    var zF = a, zR = -(spec.wheelbase - a);
    // shift station tables so the front axle sits at zF, rear at zR (tables are authored around the centre)
    var cShift = (zF + zR) / 2;
    function shiftSt(st, ci) { return st.map(function (s) { var c = s.slice(); c[0] += cShift; return c; }); }
    var halfW = Wd / 2;
    function widen(st) { return st.map(function (s) { var c = s.slice(); c[1] = c[1] * (halfW / 0.97) > halfW ? halfW : c[1] * (halfW / 0.97); return c; });}
    var bodySt = shiftSt(widen(sh.body)), cabSt = shiftSt(sh.cabin);
    var paint = new Geo(), roof = new Geo(), trim = new Geo(), lightsHead = new Geo(), lightsTail = new Geo(), inter = new Geo(), glass = new Geo(), accent = new Geo(), chrome = new Geo();
    paint.append(loftBody(bodySt, white));
    var cab = loftCabin(cabSt, [0.015, 0.02, 0.03, 1]); glass.append(cab);
    roof.append(loftCabin(cabSt.map(function (s) { return [s[0], s[1], s[2], s[3] + 0.004]; }), white, true));
    var ZF = bodySt[0][0], ZR = bodySt[bodySt.length - 1][0];
    var hwB = bodySt[4][1];
    // pillars (A + C), paint coloured
    function yAt(z) { for (var i = 0; i < bodySt.length - 1; i++) if (z <= bodySt[i][0] && z >= bodySt[i + 1][0] || z >= bodySt[i][0] && z <= bodySt[i + 1][0]) { var t = (z - bodySt[i][0]) / (bodySt[i + 1][0] - bodySt[i][0] || 1); return bodySt[i][4] + (bodySt[i + 1][4] - bodySt[i][4]) * t; } return bodySt[0][4]; }
    // door seams + side skirts + sill (dark trim)
    [1, -1].forEach(function (sd) {
      var sx = sd * (hwB - 0.012);
      trim.append(P.box(0.04, 0.10, (ZF - ZR) * 0.58, [0.03, 0.03, 0.035, 1]), A.trs(sd * (hwB - 0.02), bodySt[4][2] + 0.06, (cabSt[0][0] + cabSt[cabSt.length - 1][0]) / 2, 0, 1, 1, 1));
      trim.append(P.box(0.012, 0.58 * 0.7, 0.012, [0.02, 0.02, 0.02, 1]), A.trs(sx, 0.36 + bodySt[4][2] * 0.4, cabSt[2][0] - 0.15, 0, 1, 1, 1));
      trim.append(P.box(0.012, 0.58 * 0.7, 0.012, [0.02, 0.02, 0.02, 1]), A.trs(sx, 0.36 + bodySt[4][2] * 0.4, cabSt[4][0] + 0.25, 0, 1, 1, 1));
      // door handles
      chrome.append(P.box(0.03, 0.025, 0.15, [0.85, 0.85, 0.88, 1]), A.trs(sd * (hwB + 0.002), bodySt[4][3] - 0.02, cabSt[2][0] - 0.45, 0, 1, 1, 1));
      // mirrors
      var mz = cabSt[1][0] - 0.1, mx = sd * (cabSt[1][1] + 0.12), my = cabSt[1][2] - 0.03;
      paint.append(P.sphere(0.075, 12, 8, white, 1.0), A.trs(mx, my, mz, sd * 0.3, 1.5, 0.85, 1.0));
      trim.append(P.box(0.05, 0.05, 0.08, [0.02, 0.02, 0.02, 1]), A.trs(mx - sd * 0.1, my - 0.08, mz, 0, 1, 1, 1));
      chrome.append(P.box(0.012, 0.09, 0.15, [0.5, 0.55, 0.6, 1]), A.trs(mx - sd * 0.006, my, mz - 0.07, sd * 0.3, 1, 1, 1));
    });
    // front: grille, intakes, splitter
    var gz = ZF - 0.05, gy = bodySt[0][3] - 0.08;
        trim.append(P.box(bodySt[0][1] * 1.5, 0.05, 0.03, [0.02, 0.02, 0.025, 1]), A.trs(0, bodySt[0][2] + 0.06, ZF + 0.002, 0, 1, 1, 1));
        trim.append(P.box(bodySt[0][1] * 2.0, 0.04, 0.26, [0.02, 0.02, 0.025, 1]), A.trs(0, bodySt[0][2] + 0.0, ZF - 0.02, 0, 1, 1, 1));
    trim.append(P.box(Wd * 0.46, 0.105, 0.04, [0.01, 0.01, 0.012, 1]), A.trs(0, bodySt[0][2] + 0.115, ZF - 0.02, 0, 1, 1, 1));
    for (var ib = -4; ib <= 4; ib++) chrome.append(P.box(0.008, 0.095, 0.01, [0.32, 0.33, 0.36, 1]), A.trs(ib * Wd * 0.046, bodySt[0][2] + 0.115, ZF + 0.002, 0, 1, 1, 1));
    // rear: diffuser, exhausts, plate
    trim.append(P.box(bodySt[bodySt.length - 1][1] * 1.8, 0.20, 0.26, [0.02, 0.02, 0.025, 1]), A.trs(0, bodySt[bodySt.length - 1][2] + 0.0, ZR + 0.10, 0, 1, 1, 1, -0.1, 0));
    trim.append(P.box(bodySt[bodySt.length - 1][1] * 1.7, 0.045, 0.05, [0.012, 0.012, 0.015, 1]), A.trs(0, bodySt[bodySt.length - 1][2] + 0.17, ZR + 0.01, 0, 1, 1, 1));
    [-0.5, 0.5, spec.shape === 'muscle' ? -0.72 : 0, spec.shape === 'muscle' ? 0.72 : 0].forEach(function (ex, i) {
      if (ex === 0) return;
      chrome.append(P.cylinder(0.055, 0.055, 0.28, 14, [0.75, 0.75, 0.8, 1]), A.trs(ex * 0.58 * (spec.shape === 'muscle' ? 1.0 : 1), bodySt[bodySt.length - 1][2] + 0.04, ZR - 0.01, 0, 1, 1, 1, Math.PI / 2, 0));
      trim.append(P.cylinder(0.044, 0.044, 0.29, 14, [0.01, 0.01, 0.01, 1]), A.trs(ex * 0.58, bodySt[bodySt.length - 1][2] + 0.04, ZR - 0.012, 0, 1, 1, 1, Math.PI / 2, 0));
    });
    trim.append(P.box(0.5, 0.12, 0.02, [0.9, 0.9, 0.85, 1]), A.trs(0, bodySt[bodySt.length - 1][3] - 0.14, ZR - 0.012, Math.PI, 1, 1, 1));
    // wings
    if (sh.wing === 'big') {
      var wz = ZR + 0.38, wy = bodySt[bodySt.length - 2][4] + 0.40;
      paint.append(P.box(Wd * 0.98, 0.035, 0.46, white), A.trs(0, wy, wz, 0, 1, 1, 1, -0.10, 0));
      trim.append(P.box(0.012, 0.17, 0.30, [0.02, 0.02, 0.02, 1]), A.trs(Wd * 0.49, wy - 0.03, wz, 0, 1, 1, 1));
      trim.append(P.box(0.012, 0.17, 0.30, [0.02, 0.02, 0.02, 1]), A.trs(-Wd * 0.49, wy - 0.03, wz, 0, 1, 1, 1));
      trim.append(P.box(0.04, 0.34, 0.07, [0.04, 0.04, 0.045, 1]), A.trs(0.40, wy - 0.18, wz + 0.04, 0, 1, 1, 1));
      trim.append(P.box(0.04, 0.34, 0.07, [0.04, 0.04, 0.045, 1]), A.trs(-0.40, wy - 0.18, wz + 0.04, 0, 1, 1, 1));
      accent.append(P.box(Wd * 0.98, 0.02, 0.10, white), A.trs(0, wy + 0.018, wz - 0.12, 0, 1, 1, 1, -0.10, 0));
      trim.append(P.box(Wd * 1.0, 0.04, 0.42, [0.02, 0.02, 0.02, 1]), A.trs(0, bodySt[0][2] - 0.01, ZF + 0.02, 0, 1, 1, 1));
      accent.append(P.box(Wd * 1.0, 0.012, 0.10, white), A.trs(0, bodySt[0][2] + 0.016, ZF + 0.08, 0, 1, 1, 1));
    } else if (sh.wing === 'duck') {
      paint.append(P.box(Wd * 0.75, 0.05, 0.30, white), A.trs(0, bodySt[bodySt.length - 3][4] + 0.05, ZR + 0.42, 0, 1, 1, 1, -0.22, 0));
    } else {
      paint.append(P.box(Wd * 0.8, 0.045, 0.22, white), A.trs(0, bodySt[bodySt.length - 3][4] + 0.035, ZR + 0.28, 0, 1, 1, 1, -0.18, 0));
    }
    if (sh.scoop) {
      paint.append(P.box(0.62, 0.12, 0.85, white), A.trs(0, bodySt[3][4] + 0.05, bodySt[3][0] - 0.2, 0, 1, 1, 1, 0.06, 0));
      trim.append(P.box(0.50, 0.06, 0.06, [0.01, 0.01, 0.01, 1]), A.trs(0, bodySt[3][4] + 0.09, bodySt[3][0] + 0.2, 0, 1, 1, 1, 0.06, 0));
    }
    // livery stripes along hood / roof / deck
    var stripeW = spec.shape === 'rs' ? 0.16 : (spec.shape === 'muscle' ? 0.30 : 0.22);
    if (spec.shape !== 'rs') {
      for (var sdx = -1; sdx <= 1; sdx += 2) {
        var off = sdx * stripeW * 0.62;
        for (var i2 = 0; i2 < bodySt.length - 1; i2++) {
          var z0 = bodySt[i2][0], z1 = bodySt[i2 + 1][0], y0 = bodySt[i2][4] + 0.014 + 0.9 * (bodySt[i2][5] || 0), y1 = bodySt[i2 + 1][4] + 0.014 + 0.9 * (bodySt[i2 + 1][5] || 0);
          if (z0 > cabSt[0][0] + 0.02 || z1 < cabSt[cabSt.length - 1][0] - 0.02 || (z1 < cabSt[0][0] && z0 > cabSt[cabSt.length - 1][0])) {
            if (z1 < cabSt[0][0] && z0 > cabSt[cabSt.length - 1][0]) continue;
          }
          var zm = (z0 + z1) / 2, ym = (y0 + y1) / 2 + 0.003, len = Math.abs(z0 - z1), pit = Math.atan2(y0 - y1, len) * 0 + Math.atan2(y1 - y0, z0 - z1) * -1;
          accent.append(P.box(stripeW * 0.7, 0.012, len + 0.01, white), A.trs(off, ym, zm, 0, 1, 1, 1, Math.atan2(y1 - y0, z1 - z0), 0));
        }
      }
    } else {
      // Falcon: side stripe + roof number roundel
      [1, -1].forEach(function (sd) { accent.append(P.box(0.012, 0.06, (ZF - ZR) * 0.65, white), A.trs(sd * (hwB + 0.004), bodySt[4][3] - 0.12, (ZF + ZR) / 2, 0, 1, 1, 1)); });
      accent.append(P.cylinder(0.2, 0.2, 0.008, 28, white), A.trs(0, bodySt[3][4] + 0.03, bodySt[3][0] - 0.1, 0, 1, 1, 1, 0.0, 0));
    }
    // interior: tub, dash, seats, steering column, driver
    var cz = (cabSt[0][0] + cabSt[cabSt.length - 1][0]) / 2, floorY = bodySt[4][2] + 0.18, cabY = cabSt[2][2];
    inter.append(P.box(cabSt[2][1] * 1.7, 0.08, (cabSt[0][0] - cabSt[cabSt.length - 1][0]) * 0.95, [0.07, 0.07, 0.075, 1]), A.trs(0, floorY, cz, 0, 1, 1, 1));
    inter.append(P.box(cabSt[2][1] * 1.7, 0.30, 0.45, [0.05, 0.05, 0.055, 1]), A.trs(0, cabY - 0.17, cabSt[0][0] - 0.28, 0, 1, 1, 1, 0.2, 0));
    inter.append(P.box(0.5, 0.12, 0.05, [0.01, 0.01, 0.015, 1]), A.trs(cabSt[2][1] * 0.45, cabY - 0.04, cabSt[0][0] - 0.50, 0, 1, 1, 1, 0.25, 0));   // instrument binnacle
    inter.append(P.box(0.18, 0.22, 0.7, [0.06, 0.06, 0.065, 1]), A.trs(0, floorY + 0.12, cz + 0.3, 0, 1, 1, 1));                                            // tunnel
    inter.append(P.box(cabSt[2][1] * 1.7, 0.22, 0.08, [0.06, 0.06, 0.065, 1]), A.trs(0, floorY + 0.4, cabSt[cabSt.length - 1][0] + 0.15, 0, 1, 1, 1));
    var seatCol = spec.shape === 'rs' ? [0.05, 0.05, 0.06, 1] : (spec.shape === 'muscle' ? [0.25, 0.04, 0.03, 1] : [0.18, 0.12, 0.08, 1]);
    [1, -1].forEach(function (sd) {
      var sx = sd * cabSt[2][1] * 0.42, sz = cz - 0.05 + (sh.seatZ || 0);
      inter.append(P.box(0.50, 0.12, 0.52, seatCol), A.trs(sx, floorY + 0.18, sz, 0, 1, 1, 1));
      inter.append(P.box(0.48, 0.58, 0.12, seatCol), A.trs(sx, floorY + 0.50, sz - 0.28, 0, 1, 1, 1, -0.22, 0));
      inter.append(P.box(0.24, 0.20, 0.08, seatCol), A.trs(sx, floorY + 0.88, sz - 0.33, 0, 1, 1, 1, -0.22, 0));
    });
    // driver (on the left seat -> +X): helmet, torso, arms
    var dx = cabSt[2][1] * 0.42, dz = cz - 0.05 + (sh.seatZ || 0);
    inter.append(P.sphere(0.135, 14, 10, [0.9, 0.9, 0.92, 1], 1.08), A.trs(dx, floorY + 0.90, dz - 0.18, 0, 1, 1, 1));
    inter.append(P.box(0.15, 0.06, 0.04, [0.02, 0.02, 0.03, 1]), A.trs(dx, floorY + 0.905, dz - 0.05, 0, 1, 1, 1));
    inter.append(P.box(0.38, 0.45, 0.22, [0.12, 0.12, 0.14, 1]), A.trs(dx, floorY + 0.52, dz - 0.22, 0, 1, 1, 1, -0.22, 0));
    [1, -1].forEach(function (sd) { inter.append(P.box(0.08, 0.08, 0.40, [0.12, 0.12, 0.14, 1]), A.trs(dx + sd * 0.22, floorY + 0.60, dz + 0.0 + 0.12, sd * -0.12, 1, 1, 1, 0.55, 0)); });
    var swPos = [cabSt[2][1] * 0.42, cabY - 0.08, cabSt[0][0] - 0.62];
    M.swPos = swPos; M.swRoll = 0;
    var wheelG = torus(0.17, 0.016, 20, 8, [0.05, 0.05, 0.055, 1]);
    wheelG.append(P.box(0.30, 0.012, 0.03, [0.06, 0.06, 0.065, 1]), A.trs(0, 0, 0, 0, 1, 1, 1));
    wheelG.append(P.cylinder(0.04, 0.04, 0.025, 12, [0.15, 0.15, 0.17, 1]), A.trs(0, -0.01, 0, 0, 1, 1, 1));
    wheelG.append(P.box(0.02, 0.012, 0.13, accentTone()), A.trs(0, 0.0, -0.16, 0, 1, 1, 1));
    function accentTone() { return [0.9, 0.1, 0.1, 1]; }

    // ---------- extra realism: arches liners, underbody, projector lamps, vents, trim, wipers, antenna, plates, badges ----------
    var liner = new Geo(), dark = [0.02, 0.02, 0.022, 1], rA = wr + 0.07, xi = (Wd / 2 + 0.1) * 0.62 + 0.01, xo = Wd / 2 + 0.01;
    [[zF, 1], [zF, -1], [zR, 1], [zR, -1]].forEach(function (w) {
      var sd = w[1], shell = P.cylinder(rA, rA, xo - xi, 28, dark, { center: true, capTop: false, capBottom: false });
      liner.append(shell, A.compose(new Float32Array(12), 0, sd * (xo + xi) / 2, wr, w[0], 0, 0, -Math.PI / 2, 1));
      var plate = P.cylinder(rA, rA, 0.02, 28, dark, { center: true });
      liner.append(plate, A.compose(new Float32Array(12), 0, sd * xi, wr, w[0], 0, 0, -Math.PI / 2, 1));
    });
    liner.append(P.box(Wd * 0.84, 0.05, (ZF - ZR) * 0.92, dark), A.trs(0, bodySt[4][2] + 0.03, (ZF + ZR) / 2, 0, 1, 1, 1));
    // headlamps: two projector lenses + DRL strip + amber indicator, all flush on the flat nose face; tail: LED bar + indicator
    var S0 = bodySt[0], SN = bodySt[bodySt.length - 1];
    var hlY = S0[3] - 0.03, tlY = SN[3] - 0.07, sigF = new Geo(), sigR = new Geo(), sigFL = new Geo(), sigFR = new Geo();
    var dk = [0.02, 0.02, 0.022, 1];
    trim.append(P.box(S0[1] * 1.74, 0.17, 0.012, [0.012, 0.012, 0.015, 1]), A.trs(0, hlY - 0.01, ZF + 0.003, 0, 1, 1, 1));   // dark nose lamp bezel band
    [1, -1].forEach(function (sd) {
      [0.36, 0.52].forEach(function (fx, fi) {
        trim.append(P.cylinder(0.062, 0.058, 0.03, 22, dk), A.trs(sd * fx, hlY + 0.012, ZF - 0.004, 0, 1, 1, 1, Math.PI / 2, 0));
        lightsHead.append(P.cylinder(0.044, 0.044, 0.012, 22, [1, 1, 1, 1]), A.trs(sd * fx, hlY + 0.012, ZF + 0.012, 0, 1, 1, 1, Math.PI / 2, 0));
        chrome.append(P.cylinder(0.052, 0.052, 0.006, 22, [0.6, 0.6, 0.64, 1]), A.trs(sd * fx, hlY + 0.012, ZF + 0.004, 0, 1, 1, 1, Math.PI / 2, 0));
      });
      lightsHead.append(P.box(0.30, 0.016, 0.012, [1, 1, 1, 1]), A.trs(sd * 0.44, hlY - 0.065, ZF + 0.011, 0, 1, 1, 1));       // DRL
      (sd > 0 ? sigFL : sigFR).append(P.box(0.075, 0.05, 0.012, [1, 1, 1, 1]), A.trs(sd * 0.635, hlY + 0.012, ZF + 0.011, 0, 1, 1, 1));
      // tail: LED segments, brake bar and amber indicator on the rear face
      lightsTail.append(P.box(0.54, 0.07, 0.014, [1, 1, 1, 1]), A.trs(sd * 0.43, tlY + 0.03, SN[0] - 0.004, 0, 1, 1, 1));
      lightsTail.append(P.box(0.40, 0.035, 0.014, [1, 1, 1, 1]), A.trs(sd * 0.36, tlY - 0.03, SN[0] - 0.004, 0, 1, 1, 1));
      trim.append(P.box(0.62, 0.15, 0.01, [0.02, 0.005, 0.008, 1]), A.trs(sd * 0.43, tlY - 0.005, SN[0] - 0.002, 0, 1, 1, 1));
      (sd > 0 ? sigFL : sigFR).append(P.box(0.07, 0.05, 0.012, [1, 1, 1, 1]), A.trs(sd * 0.70, tlY - 0.03, SN[0] - 0.004, 0, 1, 1, 1));
      // fender gill behind the front wheel, brake duct ahead of it
      for (var gi2 = 0; gi2 < 3; gi2++) trim.append(P.box(0.012, 0.012, 0.16, dark), A.trs(sd * (hwB + 0.004), bodySt[4][3] - 0.17 - gi2 * 0.03, zF - 0.62, 0, 1, 1, 1));
      trim.append(P.box(0.014, 0.08, 0.20, dark), A.trs(sd * (Wd * 0.5 - 0.02), bodySt[4][2] + 0.14, zF + 0.55, 0, 1, 1, 1));
      // side sill + splitter edge in gloss black
      trim.append(P.box(0.08, 0.09, (zF - zR) - 2 * (wr + 0.14), [0.012, 0.012, 0.015, 1]), A.trs(sd * (hwB - 0.035), bodySt[4][2] + 0.115, (zF + zR) / 2, 0, 1, 1, 1, 0, sd * 0.1));   // side skirt
      chrome.append(P.box(0.006, 0.006, (zF - zR) - 2 * (wr + 0.16), [0.55, 0.57, 0.6, 1]), A.trs(sd * (hwB + 0.004), bodySt[4][2] + 0.165, (zF + zR) / 2, 0, 1, 1, 1));
      // rear valance + diffuser fins + front air curtains
      for (var fi3 = -3; fi3 <= 3; fi3++) trim.append(P.box(0.012, 0.10, 0.22, [0.02, 0.02, 0.024, 1]), A.trs(fi3 * 0.115 * (sd > 0 ? 1 : 0), SN[2] + 0.06, ZR + 0.12, fi3 * 0.03, 1, 1, 1, -0.12, 0));
      trim.append(P.box(0.22, 0.13, 0.05, dark), A.trs(sd * (Wd * 0.5 - 0.22), S0[2] + 0.12, ZF - 0.06, sd * 0.35, 1, 1, 1));            // air curtain
      chrome.append(P.box(0.2, 0.012, 0.012, [0.6, 0.62, 0.66, 1]), A.trs(sd * (Wd * 0.5 - 0.22), S0[2] + 0.19, ZF - 0.035, sd * 0.35, 1, 1, 1));
      // front canards / fuel flap
      chrome.append(P.cylinder(0.05, 0.05, 0.008, 14, [0.7, 0.7, 0.74, 1]), A.trs(sd * (hwB + 0.001), bodySt[4][3] - 0.07, zR + 0.55, 0, 1, 1, 1, 0, -sd * Math.PI / 2));
    });
    // windscreen wipers, shark-fin antenna, window beltline trim, mirrors caps
    var wsZ = cabSt[0][0] - 0.02, wsY = cabSt[0][2] + 0.02;
    [-0.25, 0.25].forEach(function (wx) { trim.append(P.box(0.01, 0.01, 0.5, dark), A.trs(wx, wsY + 0.02, wsZ - 0.18, wx * 1.2, 1, 1, 1, 0.35, 0)); });
    paint.append(P.box(0.03, 0.09, 0.2, [1, 1, 1, 1]), A.trs(0, cabSt[3][2] + cabSt[3][3] + 0.04, cabSt[4][0] + 0.15, 0, 1, 1, 1, 0.5, 0));
    [1, -1].forEach(function (sd) {
      chrome.append(P.box(0.012, 0.012, (cabSt[0][0] - cabSt[cabSt.length - 1][0]) * 0.8, [0.8, 0.82, 0.86, 1]), A.trs(sd * (cabSt[2][1] + 0.003), cabSt[2][2] + 0.01, (cabSt[0][0] + cabSt[cabSt.length - 1][0]) / 2 - 0.1, 0, 1, 1, 1));
      // A-pillar + B-pillar + C-pillar dark frames
      [cabSt[0][0] - 0.1, (cabSt[2][0] + cabSt[3][0]) / 2, cabSt[cabSt.length - 2][0] + 0.1].forEach(function (pz, pi) { trim.append(P.box(0.03, cabSt[2][3] * (pi === 1 ? 0.95 : 0.7), 0.05, dark), A.trs(sd * (cabSt[2][1] * (pi === 1 ? 0.9 : 0.86) + 0.0), cabSt[2][2] + cabSt[2][3] * 0.38, pz, 0, 1, 1, 1, 0, sd * 0.35)); });
    });
    // plates, badges, hood vents, rear lip
    trim.append(P.box(0.36, 0.10, 0.012, [0.92, 0.92, 0.88, 1]), A.trs(0, hlY - 0.01, ZF + 0.008, 0, 1, 1, 1));
    chrome.append(P.cylinder(0.045, 0.045, 0.012, 16, [0.8, 0.8, 0.84, 1]), A.trs(0, hlY + 0.085, ZF + 0.008, 0, 1, 1, 1, Math.PI / 2, 0));
    chrome.append(P.cylinder(0.05, 0.05, 0.012, 16, [0.8, 0.8, 0.84, 1]), A.trs(0, bodySt[bodySt.length - 2][3] + 0.1, ZR - 0.012, 0, 1, 1, 1, Math.PI / 2, 0));
    for (var vi2 = 0; vi2 < 4; vi2++) { [1, -1].forEach(function (sd) { trim.append(P.box(0.22, 0.008, 0.02, dark), A.trs(sd * 0.36, bodySt[3][4] + 0.012, bodySt[3][0] - 0.2 + vi2 * 0.07, sd * 0.05, 1, 1, 1)); }); }
    trim.append(P.box(SN[1] * 1.7, 0.02, 0.1, [0.02, 0.02, 0.02, 1]), A.trs(0, bodySt[bodySt.length - 2][4] + 0.005, ZR + 0.06, 0, 1, 1, 1, -0.2, 0));
    // contact blob shadow texture quad (ambient occlusion under the car)
    var blobG = P.quadXY(1, 1, [1, 1, 1, 1]); blobG.p && 0;
    // pack meshes
    M.paint = eng.mesh(paint); M.roof = eng.mesh(roof); M.trim = eng.mesh(trim); M.chrome = eng.mesh(chrome);
    M.head = eng.mesh(lightsHead); M.tail = eng.mesh(lightsTail); M.inter = eng.mesh(inter); M.glass = eng.mesh(glass); M.accent = eng.mesh(accent);
    M.sigL = eng.mesh(sigFL); M.sigR = eng.mesh(sigFR); M.steering = eng.mesh(wheelG); M.liner = eng.mesh(liner);
    var hwT = 0.155, tyre = buildTyre(wr, hwT);
    M.tyre = [eng.mesh(sideTyre(tyre, 1)), eng.mesh(sideTyre(tyre, -1))];
    M.rim = [null, null];
    M.hw = [ZF, ZR]; M.zF = zF; M.zR = zR; M.track = spec.trackWidth; M.wr = wr; M.hwT = hwT;
    M.stations = bodySt; M.cabSt = cabSt; M.ZF = ZF; M.ZR = ZR;
    M.half = [Math.max(Math.abs(ZF), Math.abs(ZR)) + 0.1, Wd / 2 + 0.1];
    M.bs = { r: Math.hypot(L / 2, Wd / 2, 1) + 0.5 };
    M.build = { wr: wr, hwT: hwT, tyre: tyre };
    M.metalCache = {};
    return M;
  }
  function metalFor(R, M, accentHex, shape, black) {
    var key = accentHex + shape + (black ? 'k' : '');
    if (M.metalCache[key]) return M.metalCache[key];
    var ac = lin(rgb(accentHex)); var cal = shape === 'muscle' ? [0.9, 0.7, 0.05, 1] : (shape === 'rs' ? [0.85, 0.08, 0.08, 1] : [0.9, 0.05, 0.05, 1]);
    var rimCol = shape === 'muscle' ? [0.65, 0.65, 0.68, 1] : (shape === 'rs' ? [0.10, 0.10, 0.11, 1] : [0.55, 0.57, 0.6, 1]);
    if (black) rimCol = [0.035, 0.035, 0.04, 1];
    var spokes = shape === 'rs' ? 6 : (shape === 'muscle' ? 5 : 10);
    var b = M.build, out = [R.eng.mesh(buildWheelMetal(b.wr, b.hwT, 1, cal, spokes, rimCol)), R.eng.mesh(buildWheelMetal(b.wr, b.hwT, -1, cal, spokes, rimCol))];
    M.metalCache[key] = out; return out;
  }

  /* ---------- the layer ---------- */
  function CarsGfx(R) {
    this.R = R; this.models = {}; this.cars = []; this.mats = {};
    var self = this;
    this.matTyre = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.88, metal: 0, car: false });
    this.matMetal = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.32, metal: 0.95, spec: 1.2 });
    this.matTrim = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.55, metal: 0.1 });
    this.matChrome = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.12, metal: 1.0 });
    this.matInter = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.8, metal: 0, castShadow: false });
    this.matGlass = R.material({ tex: 'white', base: [0.02, 0.03, 0.04, 0.42], rough: 0.04, metal: 0, spec: 1.8, blend: 'alpha', glass: true, depthWrite: false, castShadow: false, cull: false });
    this.matHeadOff = R.material({ tex: 'white', base: [0.85, 0.88, 0.9, 1], rough: 0.05, metal: 0.2, emis: [0.05, 0.05, 0.05], castShadow: false });
    this.matHeadOn = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.05, emis: [14, 13, 10.5], castShadow: false });
    this.matTailOff = R.material({ tex: 'white', base: [0.55, 0.03, 0.03, 1], rough: 0.2, emis: [1.8, 0.02, 0.0], castShadow: false });
    this.matTailLow = R.material({ tex: 'white', base: [0.5, 0.02, 0.02, 1], rough: 0.2, emis: [2.0, 0.05, 0.03], castShadow: false });
    this.matTailBrake = R.material({ tex: 'white', base: [0.6, 0.02, 0.02, 1], rough: 0.2, emis: [11, 0.2, 0.1], castShadow: false });
    this.matSigOn = R.material({ tex: 'white', base: [1, 0.45, 0.02, 1], rough: 0.2, emis: [9, 3.2, 0.1], castShadow: false });
    this.matSigOff = R.material({ tex: 'white', base: [0.45, 0.16, 0.02, 1], rough: 0.2, emis: [0.12, 0.04, 0.0], castShadow: false });
    this.matLiner = R.material({ tex: 'white', base: [0.03, 0.03, 0.034, 1], rough: 0.9, metal: 0, cull: false, castShadow: false });
    this.blob = null;
    this.layer = {
      drawShadow: function (R2) { self._draw(R2, 'shadow'); },
      drawOpaque: function (R2) { self._draw(R2, 'opaque'); },
      drawTransparent: function (R2) { self._draw(R2, 'glass'); },
      drawRefl: function (R2) { self._draw(R2, 'refl'); }
    };
    R.addLayer(this.layer);
    this.nightLights = false; this.tunnel = false;
  }
  CarsGfx.prototype.model = function (spec) {
    if (!this.models[spec.id]) this.models[spec.id] = buildModel(this.R, spec);
    return this.models[spec.id];
  };
  /* register a sim car for drawing */
  CarsGfx.prototype.add = function (car) {
    var R = this.R, spec = car.spec, M = this.model(spec), c = lin(rgb(car.color)), ac = lin(rgb(car.accentColor != null ? car.accentColor : spec.accent));
    var flake = spec.shape === 'muscle' ? 0.07 : 0.10;
    var e = {
      car: car, M: M,
      paint: R.material({ tex: 'white', base: [c[0], c[1], c[2], 1], rough: 0.28, metal: 0.25, clear: 1.0, flake: flake, car: true, spec: 1.1 }),
      accent: R.material({ tex: 'white', base: [ac[0], ac[1], ac[2], 1], rough: 0.3, metal: 0.1, clear: 1.0, car: true }),
      metal: metalFor(R, M, spec.accent, spec.shape, !!car.blackRims),
      xf: new Float32Array(12), wxf: [new Float32Array(12), new Float32Array(12), new Float32Array(12), new Float32Array(12)],
      sxf: new Float32Array(12), lightsOn: false, dist: 0, steerVis: 0
    };
    this.cars.push(e); return e;
  };
  CarsGfx.prototype.clear = function () { this.cars.length = 0; };
  CarsGfx.prototype.remove = function (car) { for (var i = this.cars.length - 1; i >= 0; i--) if (this.cars[i].car === car) this.cars.splice(i, 1); };
  CarsGfx.prototype.entryOf = function (car) { for (var i = 0; i < this.cars.length; i++) if (this.cars[i].car === car) return this.cars[i]; return null; };

  /* update the matrices for this frame */
  var _tmp = [0, 0, 0], _lt = new Float32Array(12), _w = new Float32Array(12);
  CarsGfx.prototype.update = function (R, dt) {
    var cam = R.camPos; this._aoList = [];
    for (var i = 0; i < this.cars.length; i++) {
      var e = this.cars[i], v = e.car.vehicle, M = e.M, h = v.heading;
      var ground = v.y;
      A.compose(e.xf, 0, v.x, ground + v.heave, v.z, h, v.pitch + v.pitchGround * 0 + (v.airborne ? 0 : 0), v.roll, 1);
      e.dist = Math.hypot(v.x - cam[0], v.z - cam[2]);
      e.steerVis += (v.steerAngle - e.steerVis) * Math.min(1, dt * 20);
      // wheels stay on the ground: hub world position from the body matrix, y forced to ground + radius with travel
      var wz = [M.zF, M.zF, M.zR, M.zR], wx = [M.track / 2, -M.track / 2, M.track / 2, -M.track / 2];
      for (var k = 0; k < 4; k++) {
        A.apply(e.xf, 0, wx[k], M.wr, wz[k], _tmp);
        var travel = clamp((_tmp[1] - (ground + M.wr)) * 0.6, -0.08, 0.08);
        var steer = k < 2 ? v.steerAngle : 0;
        var camberRoll = (k % 2 ? -1 : 1) * (k < 2 ? 0.02 : 0.03) + 0; void camberRoll;
        A.compose(e.wxf[k], 0, _tmp[0], ground + M.wr + travel + v.heave * 0.3, _tmp[2], h + steer, v.wheelAngle[k], v.roll * 0.35 * 0, 1);
      }
      // blob shadow disabled (real shadows); damage uniform
      e.damage = [clamp(e.car.damageZones.front, 0, 1), clamp(e.car.damageZones.rear, 0, 1), clamp(e.car.damageZones.left, 0, 1), clamp(e.car.damageZones.right, 0, 1)];
      // steering wheel matrix: car * T(pos) * Rx(tilt) * Ry(spin)
      var sw = M.swPos;
      A.compose(_lt, 0, sw[0], sw[1], sw[2], 0, -1.15, 0, 1);               // axis Y tilted to point back/up at the driver
      var spin = new Float32Array(12); A.compose(spin, 0, 0, 0, 0, -e.steerVis * 4.2, 0, 0, 1);
      A.mul(_w, 0, _lt, 0, spin, 0); A.mul(e.sxf, 0, e.xf, 0, _w, 0);
    }
    // analytic contact occlusion for the nearest 8 cars (consumed by the lit shader)
    var list = this.cars.filter(function (c) { return c.dist < 140; }).sort(function (a, b) { return a.dist - b.dist; }).slice(0, 8);
    var ao = R.carAO || (R.carAO = { n: 0, a0: new Float32Array(32), a1: new Float32Array(32), a2: new Float32Array(32) });
    ao.n = list.length;
    for (var j = 0; j < list.length; j++) {
      var c2 = list[j], vv = c2.car.vehicle, MM = c2.M, o4 = j * 4;
      ao.a0[o4] = vv.x; ao.a0[o4 + 1] = vv.z; ao.a0[o4 + 2] = Math.sin(vv.heading); ao.a0[o4 + 3] = Math.cos(vv.heading);
      ao.a1[o4] = MM.half[1] * 0.95; ao.a1[o4 + 1] = MM.half[0] * 0.97; ao.a1[o4 + 2] = vv.y; ao.a1[o4 + 3] = 0;
      ao.a2[o4] = MM.track / 2; ao.a2[o4 + 1] = MM.zF; ao.a2[o4 + 2] = MM.zR; ao.a2[o4 + 3] = MM.wr;
    }
  };
  CarsGfx.prototype.worldPoint = function (e, x, y, z, out) { return A.apply(e.xf, 0, x, y, z, out || [0, 0, 0]); };

  CarsGfx.prototype._draw = function (R, stage) {
    var shadow = stage === 'shadow', glassPass = stage === 'glass';
    var anyGlass = false;
    for (var i = 0; i < this.cars.length; i++) {
      var e = this.cars[i], M = e.M, near = e.dist < 70, far = e.dist > 260;
      if (!R.visible({ x: e.car.vehicle.x, y: e.car.vehicle.y + 0.8, z: e.car.vehicle.z, r: M.bs.r })) continue;
      if (shadow && e.dist > 160) continue;
      R.carDamage = e.damage; R.carHalf = M.half;
      var v = e.car.vehicle, braking = v.brake > 0.05 || (e.car.input && e.car.input.brake > 0.05);
      if (glassPass) {
        R.drawMesh(M.glass, e.xf, null, this.matGlass);
        continue;
      }
      R.carArch = [M.zF, M.zR, M.wr, M.wr + 0.075];
      R.drawMesh(M.paint, e.xf, null, e.paint); R.drawMesh(M.roof, e.xf, null, e.paint);
      R.drawMesh(M.accent, e.xf, null, e.accent);
      R.drawMesh(M.trim, e.xf, null, this.matTrim);
      if (!far) R.drawMesh(M.chrome, e.xf, null, this.matChrome);
      if (!shadow) {
        var on = this.nightLights || this.tunnel;
        R.drawMesh(M.head, e.xf, null, on ? this.matHeadOn : this.matHeadOff);
        R.drawMesh(M.tail, e.xf, null, braking ? this.matTailBrake : (on ? this.matTailLow : this.matTailOff));
        var blink = ((performance.now() / 380) | 0) % 2 === 0, st2 = e.steerVis;
        R.drawMesh(M.sigL, e.xf, null, (st2 > 0.10 && blink) ? this.matSigOn : this.matSigOff);
        R.drawMesh(M.sigR, e.xf, null, (st2 < -0.10 && blink) ? this.matSigOn : this.matSigOff);
        R.drawMesh(M.liner, e.xf, null, this.matLiner);
        if (near) { R.drawMesh(M.inter, e.xf, null, this.matInter); R.drawMesh(M.steering, e.sxf, null, this.matInter); }
      } else if (e.dist < 60) { R.drawMesh(M.inter, e.xf, null, this.matInter); }
      for (var k = 0; k < 4; k++) {
        var s = (k % 2 === 0) ? 0 : 1;
        R.drawMesh(M.tyre[s], e.wxf[k], null, this.matTyre);
        if (!far) R.drawMesh(e.metal[s], e.wxf[k], null, this.matMetal);
      }
    }
    R.carDamage = null; R.carArch = null;
  };

  /* headlight cones for the nearest cars (called each frame by the game) */
  CarsGfx.prototype.updateSpots = function (R, on, focusCar) {
    R.spots.length = 0;
    this.nightLights = !!on;
    if (!on && !this.tunnel) return;
    var arr = this.cars.slice().sort(function (a, b) { return a.dist - b.dist; });
    for (var i = 0; i < arr.length && R.spots.length < 8; i++) {
      var e = arr[i]; if (e.dist > 140) break;
      var v = e.car.vehicle, M = e.M, fx = Math.sin(v.heading), fz = Math.cos(v.heading), lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      for (var s = -1; s <= 1; s += 2) {
        if (R.spots.length >= 8) break;
        R.spots.push({ pos: [v.x + fx * (M.ZF - 0.2) + lx * s * 0.62, v.y + 0.62, v.z + fz * (M.ZF - 0.2) + lz * s * 0.62],
          dir: [fx, -0.06, fz], range: e.car === focusCar ? 75 : 45, cosOuter: Math.cos(0.42), cosInner: Math.cos(0.17), color: [1.0, 0.95, 0.8] });
      }
    }
  };

  JR.CarsGfx = CarsGfx; JR._loftBody = loftBody;
  JR.carShapes = SHAPES;
})();
