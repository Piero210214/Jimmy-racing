/* JIMMY RACING - track.js
 * Circuit "Sierra Verde GP": closed spline, uniform arc-length samples, lateral queries,
 * surface classification, racing line (used by the AI) and layout of scenery features.
 * No rendering code here, so the exact same data drives physics, AI, HUD and meshes.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;
  var clamp = U.clamp, wrapAngle = U.wrapAngle;

  /* [x, z, y(height)] control points, driven in order, closed loop. Start/finish line is at
   * s = 0, which is the first control point region (long main straight heading +Z). */
  /* Rounded-rectangle circuit generator: four long straights joined by four 90-degree corners (radius CR).
   * p = { HX, HZ (half sides), CR, hgt:[4 side heights], bump:[4 lateral sway amplitudes (m)] }.
   * Counter-clockwise (heading increases = left turns). The line is the middle of the first straight (heading +Z). */
  var DEFAULT_CIRCUIT = { HX: 640, HZ: 640, CR: 170, hgt: [0, 2.5, 4, 2.5], bump: [0, 0, 0, 0] };
  function makeControls(p) {
    p = p || DEFAULT_CIRCUIT;
    var HX = p.HX, HZ = p.HZ, CR = p.CR, hgt = p.hgt || DEFAULT_CIRCUIT.hgt, bump = p.bump || [0, 0, 0, 0], pts = [];
    var C = [[-HX + CR, HZ - CR], [HX - CR, HZ - CR], [HX - CR, -HZ + CR], [-HX + CR, -HZ + CR]];
    function y(k, f) { return hgt[k] + (hgt[(k + 1) % 4] - hgt[k]) * f; }
    pts.push([-HX, 0, hgt[0]]);
    for (var k = 0; k < 4; k++) {
      var c = C[k];
      var base = (k === 0) ? Math.PI : (k === 1) ? Math.PI / 2 : (k === 2) ? 0 : -Math.PI / 2;
      var sx = c[0] + CR * Math.cos(base), sz = c[1] + CR * Math.sin(base);
      var px = pts[pts.length - 1];
      // heading of side k: +Z, +X, -Z, -X ; its left normal: (cos h, -sin h)
      var hd = k * Math.PI / 2 + (k === 0 ? 0 : 0), nxk = Math.cos(hd), nzk = -Math.sin(hd);
      for (var q = 1; q <= 3; q++) {
        var f = q / 4, X = px[0] + (sx - px[0]) * f, Z = px[1] + (sz - px[1]) * f;
        var sw = k === 0 ? 0 : bump[k] * Math.sin(Math.PI * f);               // side 0 stays straight (start/finish)
        pts.push([X + nxk * sw, Z + nzk * sw, y(k, 0.4 + 0.2 * f)]);
      }
      pts.push([sx, sz, y(k, 0.65)]);
      for (var j = 1; j <= 4; j++) { var ang = base - j * Math.PI / 8; pts.push([c[0] + CR * Math.cos(ang), c[1] + CR * Math.sin(ang), y(k, 0.7 + 0.05 * j)]); }
    }
    var last = pts[pts.length - 1], tx = -HX, tz = 0;
    for (var q2 = 1; q2 <= 2; q2++) { var f2 = q2 / 3; pts.push([last[0] + (tx - last[0]) * f2, last[1] + (tz - last[1]) * f2, last[2] * (1 - f2)]); }
    return pts;
  }
  var CONTROLS = makeControls(DEFAULT_CIRCUIT);

  var DS = 2.0;                 // arc-length step between samples (m)
  var BARRIER_OFFSET = 14.0;    // base distance from the asphalt edge to the guardrail on straights (m)
  var ESCAPE_OUT = 24.0;        // extra run-off on the OUTSIDE of a corner at full curvature (m)
  var TUNNEL_CLEAR = 1.0;       // tunnel wall distance from the asphalt edge (m)
  var ESCAPE_IN = 7.0;          // extra run-off on the inside (m)
  var KERB_W = 1.4;
  var GRAVEL_W = 3.6;

  /* Centripetal Catmull-Rom point on segment p1->p2 */
  function crPoint(p0, p1, p2, p3, t) {
    function tj(ti, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      return ti + Math.pow(Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6, 0.5);
    }
    var t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    var tt = t1 + (t2 - t1) * t;
    var out = [0, 0, 0];
    for (var k = 0; k < 3; k++) {
      var A1 = ((t1 - tt) * p0[k] + (tt - t0) * p1[k]) / (t1 - t0);
      var A2 = ((t2 - tt) * p1[k] + (tt - t1) * p2[k]) / (t2 - t1);
      var A3 = ((t3 - tt) * p2[k] + (tt - t2) * p3[k]) / (t3 - t2);
      var B1 = ((t2 - tt) * A1 + (tt - t0) * A2) / (t2 - t0);
      var B2 = ((t3 - tt) * A2 + (tt - t1) * A3) / (t3 - t1);
      out[k] = ((t2 - tt) * B1 + (tt - t1) * B2) / (t2 - t1);
    }
    return out;
  }

  function build(opts) {
    opts = opts || {};
    var circ = opts.circuit || DEFAULT_CIRCUIT, ctrl = opts.controls || (opts.circuit ? makeControls(circ) : CONTROLS);
    var n = ctrl.length;
    // 1) dense spline
    var dense = [];
    var SUB = 48;
    for (var i = 0; i < n; i++) {
      var p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (var j = 0; j < SUB; j++) dense.push(crPoint(p0, p1, p2, p3, j / SUB));
    }
    var m = dense.length;
    var cum = new Float64Array(m + 1);
    for (var a = 0; a < m; a++) {
      var A = dense[a], B = dense[(a + 1) % m];
      // dense points are [x, z, y]; arc length s is measured horizontally
      var dx = B[0] - A[0], dz = B[1] - A[1];
      cum[a + 1] = cum[a] + Math.sqrt(dx * dx + dz * dz);
    }
    var total = cum[m];
    var N = Math.round(total / DS);
    var ds = total / N;

    // 2) uniform resample
    var X = new Float32Array(N), Z = new Float32Array(N), Y = new Float32Array(N);
    var seg = 0;
    for (var s = 0; s < N; s++) {
      var target = s * ds;
      while (seg < m - 1 && cum[seg + 1] < target) seg++;
      var A2 = dense[seg], B2 = dense[(seg + 1) % m];
      var span = cum[seg + 1] - cum[seg];
      var f = span > 1e-9 ? (target - cum[seg]) / span : 0;
      X[s] = A2[0] + (B2[0] - A2[0]) * f;
      Z[s] = A2[1] + (B2[1] - A2[1]) * f;
      Y[s] = A2[2] + (B2[2] - A2[2]) * f;
    }
    // smooth heights slightly (removes spline wobble) - circular box filter
    var Ys = new Float32Array(N);
    for (var pass = 0; pass < 3; pass++) {
      for (var q = 0; q < N; q++) {
        var acc = 0;
        for (var w = -6; w <= 6; w++) acc += Y[(q + w + N) % N];
        Ys[q] = acc / 13;
      }
      Y.set(Ys);
    }

    // 3) tangents, headings, curvature
    var TX = new Float32Array(N), TZ = new Float32Array(N), HEAD = new Float32Array(N), K = new Float32Array(N);
    for (var t = 0; t < N; t++) {
      var pn = (t + 1) % N, pp = (t - 1 + N) % N;
      var tx = X[pn] - X[pp], tz = Z[pn] - Z[pp];
      var l = Math.sqrt(tx * tx + tz * tz);
      TX[t] = tx / l; TZ[t] = tz / l;
      HEAD[t] = Math.atan2(TX[t], TZ[t]);
    }
    for (var c = 0; c < N; c++) {
      var h1 = HEAD[(c + 3) % N], h0 = HEAD[(c - 3 + N) % N];
      K[c] = wrapAngle(h1 - h0) / (6 * ds);
    }
    // smooth curvature a little
    var Ks = new Float32Array(N);
    for (var ps = 0; ps < 2; ps++) {
      for (var u = 0; u < N; u++) {
        Ks[u] = (K[(u - 2 + N) % N] + 2 * K[(u - 1 + N) % N] + 3 * K[u] + 2 * K[(u + 1) % N] + K[(u + 2) % N]) / 9;
      }
      K.set(Ks);
    }

    // 4) width profile: wide on the main straight and at corner entries, narrower in the hairpin
    var W = new Float32Array(N);
    // main-straight widening: 16 m from the corner exit before the line to the T1 braking zone
    for (var wj = 0; wj < N; wj++) {
      var sj = wj * ds;
      var widen = sj < 520 ? 1 - U.smoothstep(400, 520, sj) : (sj > total - 200 ? U.smoothstep(total - 200, total - 110, sj) : 0);
      W[wj] = 18 + 4 * widen;
    }

    // 4b) guard-rail distance per side: uniform on straights, widening smoothly into corners (escape zones).
    //     d > 0 is the LEFT side; heading increases when turning left (k > 0 => left corner, outer side = d < 0).
    var BL = new Float32Array(N), BR = new Float32Array(N), fo = new Float32Array(N), fi = new Float32Array(N);
    function cf(k) { return U.smoothstep(1 / 1200, 1 / 190, Math.abs(k)); }   // 0 on straights/fast bends, 1 in tight corners
    var sgn = new Float32Array(N);
    for (var bi0 = 0; bi0 < N; bi0++) sgn[bi0] = K[bi0];
    var HOLD = Math.round(80 / ds), BLUR = Math.round(110 / ds);
    var fL = new Float32Array(N), fR = new Float32Array(N);    // factor for left-outer (right turns) / right-outer (left turns)
    for (var bi1 = 0; bi1 < N; bi1++) { fL[bi1] = sgn[bi1] < 0 ? cf(sgn[bi1]) : 0; fR[bi1] = sgn[bi1] > 0 ? cf(sgn[bi1]) : 0; }
    function holdBlur(a) {
      var m = new Float32Array(N), o = new Float32Array(N), q, j;
      for (q = 0; q < N; q++) { var mx = 0; for (j = -HOLD; j <= HOLD; j += 2) mx = Math.max(mx, a[(q + j + N) % N]); m[q] = mx; }
      for (q = 0; q < N; q++) { var sm = 0, cn = 0; for (j = -BLUR; j <= BLUR; j++) { var wgt = 1 - Math.abs(j) / (BLUR + 1); sm += m[(q + j + N) % N] * wgt; cn += wgt; } o[q] = sm / cn; }
      return o;
    }
    var gL = holdBlur(fL), gR = holdBlur(fR);                  // outer-side factors (left side / right side)
    for (var bi2 = 0; bi2 < N; bi2++) {
      // the inner side of a corner is the outer side of the opposite factor
      BL[bi2] = BARRIER_OFFSET + ESCAPE_OUT * gL[bi2] + ESCAPE_IN * gR[bi2];
      BR[bi2] = BARRIER_OFFSET + ESCAPE_OUT * gR[bi2] + ESCAPE_IN * gL[bi2];
      // never let the inside rail fold over itself: keep a margin from the corner's centre of curvature
      var Rk = 1 / Math.max(1e-6, Math.abs(K[bi2])), cap = Rk * 0.78 - W[bi2] * 0.5;
      if (K[bi2] > 0) BL[bi2] = Math.min(BL[bi2], Math.max(BARRIER_OFFSET * 0.6, cap)); else BR[bi2] = Math.min(BR[bi2], Math.max(BARRIER_OFFSET * 0.6, cap));
    }
    // 5) spatial hash for nearest-sample queries (used by terrain generation)
    var CELL = 40;
    var hash = {};
    for (var hi = 0; hi < N; hi += 2) {
      var key = Math.floor(X[hi] / CELL) + ',' + Math.floor(Z[hi] / CELL);
      (hash[key] || (hash[key] = [])).push(hi);
    }

    var track = {
      name: 'Sierra Verde GP',
      N: N, ds: ds, length: total,
      x: X, z: Z, y: Y, tx: TX, tz: TZ, heading: HEAD, k: K, width: W,
      barrierOffset: BARRIER_OFFSET, kerbW: KERB_W, gravelW: GRAVEL_W,
      cell: CELL, hash: hash,
      controls: ctrl
    };

    /* ---- queries ---- */
    function seg2(i) { return ((i % N) + N) % N; }

    /* Locate a world point relative to the track. Returns lateral offset d (LEFT positive). */
    track.locate = function (px, pz, hint, out) {
      var best = 1e18, bi = 0, bf = 0;
      var searchAll = (hint === undefined || hint < 0);
      var lo, hi2;
      if (!searchAll) { lo = -70; hi2 = 70; } else { lo = 0; hi2 = N - 1; }
      for (var o = lo; o <= hi2; o++) {
        var i0 = searchAll ? o : seg2(hint + o);
        var i1 = seg2(i0 + 1);
        var ax = X[i0], az = Z[i0];
        var bx = X[i1] - ax, bz = Z[i1] - az;
        var L2 = bx * bx + bz * bz;
        var f2 = ((px - ax) * bx + (pz - az) * bz) / L2;
        if (f2 < 0) f2 = 0; else if (f2 > 1) f2 = 1;
        var qx = ax + bx * f2 - px, qz = az + bz * f2 - pz;
        var dd = qx * qx + qz * qz;
        if (dd < best) { best = dd; bi = i0; bf = f2; }
      }
      if (!searchAll && best > 45 * 45) return track.locate(px, pz, -1, out); // lost: global search
      var i1b = seg2(bi + 1);
      var cx = X[bi] + (X[i1b] - X[bi]) * bf, cz = Z[bi] + (Z[i1b] - Z[bi]) * bf;
      var tx2 = TX[bi] + (TX[i1b] - TX[bi]) * bf, tz2 = TZ[bi] + (TZ[i1b] - TZ[bi]) * bf;
      var tl = Math.sqrt(tx2 * tx2 + tz2 * tz2); tx2 /= tl; tz2 /= tl;
      var lx = tz2, lz = -tx2; // left normal
      var r = out || {};
      r.i = bi; r.f = bf; r.s = (bi + bf) * ds;
      r.d = (px - cx) * lx + (pz - cz) * lz;
      r.cx = cx; r.cz = cz;
      r.y = Y[bi] + (Y[i1b] - Y[bi]) * bf;
      r.tx = tx2; r.tz = tz2; r.lx = lx; r.lz = lz;
      r.heading = Math.atan2(tx2, tz2);
      r.k = K[bi] + (K[i1b] - K[bi]) * bf;
      r.w = W[bi] + (W[i1b] - W[bi]) * bf;
      r.slope = (Y[i1b] - Y[bi]) / ds;
      return r;
    };

    /* World pose on the track at arc length s and lateral offset d. */
    track.pointAt = function (s, d, out) {
      var u = ((s % total) + total) % total / ds;
      var i0 = Math.floor(u) % N, i1 = (i0 + 1) % N, f = u - Math.floor(u);
      var cx = X[i0] + (X[i1] - X[i0]) * f, cz = Z[i0] + (Z[i1] - Z[i0]) * f;
      var tx2 = TX[i0] + (TX[i1] - TX[i0]) * f, tz2 = TZ[i0] + (TZ[i1] - TZ[i0]) * f;
      var tl = Math.sqrt(tx2 * tx2 + tz2 * tz2); tx2 /= tl; tz2 /= tl;
      var lx = tz2, lz = -tx2;
      var r = out || {};
      r.x = cx + lx * d; r.z = cz + lz * d;
      r.y = Y[i0] + (Y[i1] - Y[i0]) * f;
      r.heading = Math.atan2(tx2, tz2);
      r.lx = lx; r.lz = lz; r.tx = tx2; r.tz = tz2;
      r.k = K[i0] + (K[i1] - K[i0]) * f;
      r.w = W[i0] + (W[i1] - W[i0]) * f;
      return r;
    };

    track.halfWidthAt = function (i) { return W[((i % N) + N) % N] * 0.5; };

    /* Surface classification from lateral offset (any sign) and index. */
    track.SURFACES = {
      asphalt: { id: 0, mu: 1.00, roll: 0.012, name: 'asphalt' },
      kerb:    { id: 1, mu: 0.90, roll: 0.020, name: 'kerb' },
      gravel:  { id: 2, mu: 0.42, roll: 0.090, name: 'gravel' },
      grass:   { id: 3, mu: 0.55, roll: 0.055, name: 'grass' }
    };
    track.surfaceAt = function (d, i) {
      var half = W[((i % N) + N) % N] * 0.5, a = Math.abs(d);
      if (a <= half) return track.SURFACES.asphalt;
      if (a <= half + KERB_W) return track.SURFACES.kerb;
      if (a <= half + KERB_W + GRAVEL_W) return track.SURFACES.gravel;
      return track.SURFACES.grass;
    };
    // lateral distance from the centre line to the guard rail; side > 0 = left, < 0 = right, omitted = the wider one
    track.barrierDistAt = function (i, side) {
      var q = ((Math.floor(i) % N) + N) % N, o = side > 0 ? BL[q] : side < 0 ? BR[q] : Math.max(BL[q], BR[q]);
      var d = W[q] * 0.5 + o, T = track.features && track.features.tunnel;
      if (T) {                                              // tunnel: solid walls hug the road; the guard rails funnel into the portals
        var s = q * track.ds, TAPER = 70, k = 0;
        if (s >= T.s0 && s <= T.s1) k = 1;
        else if (s < T.s0 && s > T.s0 - TAPER) k = (s - (T.s0 - TAPER)) / TAPER;
        else if (s > T.s1 && s < T.s1 + TAPER) k = 1 - (s - T.s1) / TAPER;
        if (k > 0) { k = k * k * (3 - 2 * k); d = d + (W[q] * 0.5 + TUNNEL_CLEAR - d) * k; }
      }
      return d;
    };

    /* Nearest centre-line sample from the spatial hash (unsigned distance). For terrain/scenery. */
    track.nearestFast = function (px, pz, out) {
      var cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      var best = 1e18, bi = -1;
      for (var rad = 1; rad <= 12 && bi < 0; rad++) {
        for (var gx = cx - rad; gx <= cx + rad; gx++) {
          for (var gz = cz - rad; gz <= cz + rad; gz++) {
            if (rad > 1 && Math.abs(gx - cx) !== rad && Math.abs(gz - cz) !== rad) continue;
            var arr = hash[gx + ',' + gz];
            if (!arr) continue;
            for (var q = 0; q < arr.length; q++) {
              var ii = arr[q];
              var dx = X[ii] - px, dz = Z[ii] - pz;
              var d2 = dx * dx + dz * dz;
              if (d2 < best) { best = d2; bi = ii; }
            }
          }
        }
      }
      var r = out || {};
      if (bi < 0) { r.i = 0; r.dist = 1e9; r.y = 0; r.halfW = 7; return r; }
      r.i = bi; r.dist = Math.sqrt(best); r.y = Y[bi]; r.halfW = W[bi] * 0.5;
      return r;
    };

    computeRacingLine(track);
    track.circuit = circ; layoutFeatures(track, circ);
    return track;
  }

  /* Shortest-path relaxation constrained to the road (SOR). Result: lateral offset per sample. */
  function computeRacingLine(track) {
    var N = track.N, ds = track.ds;
    var STEP = 4;
    var M = Math.floor(N / STEP);
    var cx = new Float64Array(M), cz = new Float64Array(M), lx = new Float64Array(M), lz = new Float64Array(M);
    var lim = new Float64Array(M), off = new Float64Array(M);
    for (var i = 0; i < M; i++) {
      var si = i * STEP;
      cx[i] = track.x[si]; cz[i] = track.z[si];
      lx[i] = track.tz[si]; lz[i] = -track.tx[si];
      lim[i] = track.width[si] * 0.5 - 2.4;
    }
    var omega = 1.85;
    for (var it = 0; it < 2600; it++) {
      for (var a = 0; a < M; a++) {
        var pa = (a - 1 + M) % M, pb = (a + 1) % M;
        var mx = 0.5 * ((cx[pa] + lx[pa] * off[pa]) + (cx[pb] + lx[pb] * off[pb]));
        var mz = 0.5 * ((cz[pa] + lz[pa] * off[pa]) + (cz[pb] + lz[pb] * off[pb]));
        var target = (mx - cx[a]) * lx[a] + (mz - cz[a]) * lz[a];
        var nv = off[a] + omega * (target - off[a]);
        off[a] = clamp(nv, -lim[a], lim[a]);
      }
    }
    // upsample to full resolution (periodic linear) and smooth
    var full = new Float32Array(N);
    for (var s = 0; s < N; s++) {
      var u = s / STEP, i0 = Math.floor(u) % M, i1 = (i0 + 1) % M, f = u - Math.floor(u);
      full[s] = off[i0] + (off[i1] - off[i0]) * f;
    }
    var tmp = new Float32Array(N);
    for (var p = 0; p < 6; p++) {
      for (var q = 0; q < N; q++) {
        var acc = 0;
        for (var w = -5; w <= 5; w++) acc += full[(q + w + N) % N];
        tmp[q] = acc / 11;
      }
      full.set(tmp);
    }
    // line geometry and curvature
    var LX = new Float32Array(N), LZ = new Float32Array(N), LK = new Float32Array(N);
    for (var k = 0; k < N; k++) {
      LX[k] = track.x[k] + track.tz[k] * full[k];
      LZ[k] = track.z[k] - track.tx[k] * full[k];
    }
    var LH = new Float32Array(N), LD = new Float32Array(N);
    for (var h = 0; h < N; h++) {
      var n1 = (h + 1) % N, p1 = (h - 1 + N) % N;
      LH[h] = Math.atan2(LX[n1] - LX[p1], LZ[n1] - LZ[p1]);
      var ddx = LX[n1] - LX[h], ddz = LZ[n1] - LZ[h];
      LD[h] = Math.sqrt(ddx * ddx + ddz * ddz);
    }
    for (var c = 0; c < N; c++) {
      var a3 = (c + 3) % N, b3 = (c - 3 + N) % N;
      var len = LD[c] + LD[(c + 1) % N] + LD[(c + 2) % N] + LD[(c - 1 + N) % N] + LD[(c - 2 + N) % N] + LD[(c - 3 + N) % N];
      LK[c] = wrapAngle(LH[a3] - LH[b3]) / len;
    }
    var LKs = new Float32Array(N);
    for (var ps = 0; ps < 3; ps++) {
      for (var u2 = 0; u2 < N; u2++) {
        LKs[u2] = (LK[(u2 - 2 + N) % N] + 2 * LK[(u2 - 1 + N) % N] + 3 * LK[u2] + 2 * LK[(u2 + 1) % N] + LK[(u2 + 2) % N]) / 9;
      }
      LK.set(LKs);
    }
    track.line = { off: full, x: LX, z: LZ, k: LK, heading: LH, step: LD };
  }

  /* Where scenery goes. Positions are defined in world space where it matters and converted
   * to arc length with a global search, so reshaping the circuit never breaks the layout. */
  function layoutFeatures(track, c) {
    var L = track.length;
    var tmp = {};
    function sAt(x, z) { return track.locate(x, z, -1, tmp).s; }
    var HX = c.HX, HZ = c.HZ, tunnelC = sAt(HX * 1.0, HZ * 0.1);
    track.features = {
      start: { s: 0 },
      grandstands: [
        { s0: 30, s1: 215, side: 1 },     // main stand on the pit side (right-hand side of travel)
        { s0: 60, s1: 190, side: -1 },
        { s0: sAt(0, HZ) - 40, s1: sAt(0, HZ) + 70, side: 1 }  // T1 stand
      ],
      footbridge: { s: 330 },
      tunnel: { s0: tunnelC - 95, s1: tunnelC + 95 },
      village: { x: HX * 1.42, z: HZ * 1.34, radius: 85 },
      checkpoints: 8
    };
  }

  JR.track = { build: build, makeControls: makeControls, DEFAULT_CIRCUIT: DEFAULT_CIRCUIT, CONTROLS: CONTROLS, DS: DS, BARRIER_OFFSET: BARRIER_OFFSET, KERB_W: KERB_W, GRAVEL_W: GRAVEL_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
