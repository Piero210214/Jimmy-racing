/* JIMMY RACING - textures.js
 * Procedural, tileable PBR-ish textures generated in typed arrays (no canvas alpha issues).
 * Each material = { t0: albedo RGBA8 (A = cutout alpha), t1: RG normal / B roughness / A emissive mask }.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;

  function lattice(cx, cy, seed) {
    var r = U.makeRng(seed), L = new Float32Array(cx * cy);
    for (var i = 0; i < L.length; i++) L[i] = r();
    return L;
  }
  /* tileable value noise, cx x cy lattice cells across the tile, smooth interpolation */
  function noiseTile(N, cx, cy, seed) {
    var L = lattice(cx, cy, seed), out = new Float32Array(N * N);
    for (var y = 0; y < N; y++) {
      var fy = y / N * cy, iy = Math.floor(fy), ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      var y0 = iy % cy, y1 = (iy + 1) % cy;
      for (var x = 0; x < N; x++) {
        var fx = x / N * cx, ix = Math.floor(fx), tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        var x0 = ix % cx, x1 = (ix + 1) % cx;
        var a = L[y0 * cx + x0], b = L[y0 * cx + x1], c = L[y1 * cx + x0], d = L[y1 * cx + x1];
        out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
    return out;
  }
  function fbmTile(N, base, oct, seed, aspect) {
    aspect = aspect || 1;
    var out = new Float32Array(N * N), amp = 0.5, norm = 0;
    for (var o = 0; o < oct; o++) {
      var c = base * (1 << o);
      var n = noiseTile(N, c, Math.max(1, Math.round(c * aspect)), seed + o * 31);
      for (var i = 0; i < out.length; i++) out[i] += n[i] * amp;
      norm += amp; amp *= 0.5;
    }
    for (var k = 0; k < out.length; k++) out[k] /= norm;
    return out;
  }
  /* tileable voronoi: returns {h (dome height), id (cell hash)} */
  function voronoi(N, cells, seed, jitter) {
    var r = U.makeRng(seed), px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), idv = new Float32Array(cells * cells);
    jitter = jitter == null ? 0.85 : jitter;
    for (var i = 0; i < cells * cells; i++) { px[i] = 0.5 + (r() - 0.5) * jitter; py[i] = 0.5 + (r() - 0.5) * jitter; idv[i] = r(); }
    var h = new Float32Array(N * N), id = new Float32Array(N * N), edge = new Float32Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var fx = x / N * cells, fy = y / N * cells, cx = Math.floor(fx), cy = Math.floor(fy);
      var d1 = 9, d2 = 9, best = 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var gx = cx + ox, gy = cy + oy, wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells, k = wy * cells + wx;
        var dx = gx + px[k] - fx, dy = gy + py[k] - fy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
      }
      h[y * N + x] = Math.max(0, 1 - d1 * 1.5); id[y * N + x] = idv[best]; edge[y * N + x] = d2 - d1;
    }
    return { h: h, id: id, edge: edge };
  }
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0; }

  /* Pack final textures. h: height field (wraps), strength: normal strength, rough: Float32Array or number, emis optional */
  function pack(N, albedo, h, strength, rough, emis, alpha) {
    var t0 = new Uint8Array(N * N * 4), t1 = new Uint8Array(N * N * 4);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, o = i * 4;
      var xm = h[y * N + (x - 1 + N) % N], xp = h[y * N + (x + 1) % N], ym = h[((y - 1 + N) % N) * N + x], yp = h[((y + 1) % N) * N + x];
      var nx = (xm - xp) * strength, ny = (ym - yp) * strength;
      var l = Math.sqrt(nx * nx + ny * ny + 1);
      t1[o] = clamp8((nx / l * 0.5 + 0.5) * 255); t1[o + 1] = clamp8((ny / l * 0.5 + 0.5) * 255);
      t1[o + 2] = clamp8((typeof rough === 'number' ? rough : rough[i]) * 255);
      t1[o + 3] = emis ? clamp8(emis[i] * 255) : 0;
      t0[o] = clamp8(albedo[i * 3] * 255); t0[o + 1] = clamp8(albedo[i * 3 + 1] * 255); t0[o + 2] = clamp8(albedo[i * 3 + 2] * 255);
      t0[o + 3] = alpha ? clamp8(alpha[i] * 255) : 255;
    }
    return { t0: t0, t1: t1, N: N };
  }

  /* ----------------------------------------------------------------- generators */
  var GEN = {};

  GEN.asphalt = function (N) {
    var big = fbmTile(N, 4, 4, 11), fine = noiseTile(N, N / 2, N / 2, 12), mid = noiseTile(N, N / 8, N / 8, 13);
    var crack = fbmTile(N, 5, 3, 14);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N), rough = new Float32Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, u = x / N;
      var base = 0.145 + big[i] * 0.07 + (mid[i] - 0.5) * 0.04;
      var sp = fine[i], speck = sp > 0.86 ? (sp - 0.86) * 3.2 : (sp < 0.12 ? -(0.12 - sp) * 1.2 : 0);
      var v = base + speck * 0.9;
      var cr = Math.abs(crack[i] - 0.5);
      if (cr < 0.012) v *= 0.45 + cr * 40;
      var r = 0.9 - speck * 0.1;
      // rubbered racing bands
      var band = Math.exp(-Math.pow((u - 0.31) / 0.06, 2)) + Math.exp(-Math.pow((u - 0.69) / 0.06, 2));
      v *= 1 - band * 0.16; r -= band * 0.18;
      var rr = v, gg = v * 1.01, bb = v * 1.04, line = 0;
      // edge lines (white, worn)
      var el = Math.max(smooth(0.028, 0.032, u) * (1 - smooth(0.046, 0.050, u)), smooth(0.950, 0.954, u) * (1 - smooth(0.968, 0.972, u)));
      if (el > 0) {
        var wear = 0.55 + 0.45 * fine[(i + 7919) % fine.length] * mid[i] * 2.0; wear = Math.min(1, wear);
        var wv = 0.62 * wear + 0.08;
        rr = rr + (wv - rr) * el; gg = gg + (wv - gg) * el; bb = bb + (wv * 0.98 - bb) * el; r = r + (0.55 - r) * el; line = el;
      }
      alb[i * 3] = rr; alb[i * 3 + 1] = gg; alb[i * 3 + 2] = bb;
      h[i] = fine[i] * 0.8 + mid[i] * 0.5 - line * 0.3;
      rough[i] = Math.min(1, Math.max(0.3, r));
    }
    return pack(N, alb, h, 3.5, rough);
  };
  function smooth(a, b, x) { var t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  GEN.grass = function (N) {
    var low = fbmTile(N, 3, 4, 21), blades = noiseTile(N, N / 4, N / 24, 22), blades2 = noiseTile(N, N / 8, N / 12, 23), dry = fbmTile(N, 2, 3, 24);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      var b = blades[i] * 0.6 + blades2[i] * 0.4;
      var g = 0.20 + low[i] * 0.16 + b * 0.18;
      var dr = smooth(0.55, 0.8, dry[i]);
      alb[i * 3] = (0.075 + b * 0.05) * (1 - dr) + (0.22 + b * 0.05) * dr * 0.7;
      alb[i * 3 + 1] = g * 0.52 * (1 - dr) + g * 0.45 * dr;
      alb[i * 3 + 2] = 0.03 + b * 0.02;
      h[i] = b * 1.1 + low[i] * 0.3;
    }
    return pack(N, alb, h, 2.2, 0.92);
  };

  GEN.gravel = function (N) {
    var v = voronoi(N, 40, 31, 0.9), fine = noiseTile(N, N / 3, N / 3, 32);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      var tone = 0.30 + v.id[i] * 0.34; var warm = v.id[(i * 7) % (N * N)] * 0.1;
      var g = tone * (0.7 + v.h[i] * 0.4) * (0.9 + fine[i] * 0.2);
      var gap = smooth(0.0, 0.14, v.edge[i]);
      alb[i * 3] = (g + warm) * (0.35 + 0.65 * gap); alb[i * 3 + 1] = (g + warm * 0.4) * (0.35 + 0.65 * gap); alb[i * 3 + 2] = g * 0.85 * (0.35 + 0.65 * gap);
      h[i] = (v.h[i] * gap) * 2.2 + fine[i] * 0.2;
    }
    return pack(N, alb, h, 5.5, 0.88);
  };

  GEN.kerb = function (N) {
    var fine = noiseTile(N, N / 3, N / 3, 41), mid = fbmTile(N, 6, 3, 42);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, v = y / N;
      var red = v < 0.5;
      var wear = 0.8 + mid[i] * 0.3 + (fine[i] - 0.5) * 0.15;
      var r = red ? 0.62 : 0.78, g = red ? 0.035 : 0.76, b = red ? 0.03 : 0.74;
      var edge = Math.min(smooth(0, 0.012, v % 0.5), smooth(0, 0.012, 0.5 - (v % 0.5)));
      alb[i * 3] = r * wear * (0.85 + 0.15 * edge); alb[i * 3 + 1] = g * wear * (0.85 + 0.15 * edge); alb[i * 3 + 2] = b * wear * (0.85 + 0.15 * edge);
      h[i] = fine[i] * 0.4 + edge * 0.5;
    }
    return pack(N, alb, h, 2.0, 0.6);
  };

  GEN.concrete = function (N) {
    var big = fbmTile(N, 3, 4, 51), fine = noiseTile(N, N / 2, N / 2, 52), pores = noiseTile(N, N / 3, N / 3, 53);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x;
      var v = 0.50 + big[i] * 0.18 + (fine[i] - 0.5) * 0.06;
      if (pores[i] > 0.93) v *= 0.55;
      var seam = (Math.abs((x % (N / 2)) - 1) < 1.2 || Math.abs((y % (N / 2)) - 1) < 1.2) ? 0.72 : 1;
      v *= seam;
      alb[i * 3] = v; alb[i * 3 + 1] = v * 0.99; alb[i * 3 + 2] = v * 0.96;
      h[i] = fine[i] * 0.5 + big[i] * 0.4 - (seam < 1 ? 0.6 : 0);
    }
    return pack(N, alb, h, 2.6, 0.85);
  };

  GEN.rock = function (N) {
    var big = fbmTile(N, 3, 5, 61), strata = noiseTile(N, 3, N / 6, 62), fine = noiseTile(N, N / 2, N / 2, 63);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      var s = strata[i] * 0.3 + big[i] * 0.7; var v = 0.20 + s * 0.28 + (fine[i] - 0.5) * 0.06;
      alb[i * 3] = v * 1.08; alb[i * 3 + 1] = v * 0.98; alb[i * 3 + 2] = v * 0.88;
      h[i] = big[i] * 2.0 + strata[i] * 0.9 + fine[i] * 0.25;
    }
    return pack(N, alb, h, 3.2, 0.9);
  };

  GEN.bark = function (N) {
    var st = noiseTile(N, N / 16, 4, 71), st2 = noiseTile(N, N / 6, 8, 72), fine = noiseTile(N, N / 2, N / 2, 73);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      var v = 0.22 + st[i] * 0.25 + st2[i] * 0.12;
      alb[i * 3] = v * 0.62 + 0.02; alb[i * 3 + 1] = v * 0.44 + 0.015; alb[i * 3 + 2] = v * 0.30;
      h[i] = st[i] * 1.5 + st2[i] * 0.6 + fine[i] * 0.15;
    }
    return pack(N, alb, h, 3.0, 0.92);
  };

  GEN.foliage = function (N) {
    var a = fbmTile(N, 8, 4, 81), b = noiseTile(N, N / 4, N / 4, 82), c = fbmTile(N, 3, 3, 83);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      var leaf = a[i] * 0.6 + b[i] * 0.4;
      var g = 0.20 + leaf * 0.42;
      alb[i * 3] = (0.06 + leaf * 0.10 + c[i] * 0.05); alb[i * 3 + 1] = g * 0.62; alb[i * 3 + 2] = 0.025 + leaf * 0.03;
      h[i] = leaf * 1.6;
    }
    return pack(N, alb, h, 2.4, 0.8);
  };

  GEN.roof = function (N) {
    var fine = noiseTile(N, N / 3, N / 3, 91), mid = fbmTile(N, 5, 3, 92);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N), rows = 10;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, ry = (y / N * rows) % 1, rx = ((x / N * rows * 1.2) + (Math.floor(y / N * rows) % 2) * 0.5) % 1;
      var shingle = smooth(0, 0.25, ry) * (0.7 + 0.3 * smooth(0, 0.1, Math.min(rx, 1 - rx)));
      var tint = 0.7 + mid[i] * 0.5 + (fine[i] - 0.5) * 0.2;
      alb[i * 3] = 0.43 * tint * (0.5 + 0.5 * shingle); alb[i * 3 + 1] = 0.16 * tint * (0.5 + 0.5 * shingle); alb[i * 3 + 2] = 0.10 * tint * (0.5 + 0.5 * shingle);
      h[i] = shingle * 1.4 + fine[i] * 0.2;
    }
    return pack(N, alb, h, 3.0, 0.8);
  };

  GEN.tread = function (N) {
    var fine = noiseTile(N, N / 2, N / 2, 101);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, v = y / N, u = x / N;
      var inTread = v > 0.22 && v < 0.78;
      var groove = 0;
      if (inTread) {
        var rib = (v - 0.22) / 0.56;
        var lg = Math.abs(((rib * 4) % 1) - 0.5) < 0.07 ? 1 : 0;                       // circumferential grooves
        var diag = Math.abs(((u * 28 + (rib - 0.5) * 3.2 * (rib > 0.5 ? 1 : -1)) % 1) - 0.5) < 0.16 ? 1 : 0; // sipes
        groove = Math.max(lg, diag * (Math.abs(rib - 0.5) > 0.12 ? 1 : 0));
      }
      var g = 0.045 + fine[i] * 0.02;
      alb[i * 3] = g; alb[i * 3 + 1] = g; alb[i * 3 + 2] = g * 1.05;
      h[i] = (inTread ? (1 - groove) : 0.55 + Math.sin(u * 120) * 0.0) * 1.0 + fine[i] * 0.1;
    }
    return pack(N, alb, h, 3.5, 0.78);
  };

  GEN.carbon = function (N) {
    var fine = noiseTile(N, N / 2, N / 2, 111);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N), n = 32;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, cx = Math.floor(x / N * n), cy = Math.floor(y / N * n);
      var tw = ((cx + cy) % 4) < 2;
      var fx = (x / N * n) % 1, fy = (y / N * n) % 1;
      var t = tw ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
      var v = 0.02 + t * 0.03 + (fine[i] - 0.5) * 0.005;
      alb[i * 3] = v; alb[i * 3 + 1] = v; alb[i * 3 + 2] = v * 1.08;
      h[i] = t * 0.9 + (tw ? 0.15 : 0);
    }
    return pack(N, alb, h, 2.0, 0.28);
  };

  /* Facades: style 0 brick, 1 plaster, 2 modern glass, 3 industrial. Tile = 4 window columns x 4 rows. */
  GEN.facade = function (N, style) {
    var fine = noiseTile(N, N / 2, N / 2, 120 + style), mid = fbmTile(N, 6, 3, 130 + style), rnd = U.makeRng(140 + style);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N), rough = new Float32Array(N * N), em = new Float32Array(N * N);
    var cols = 4, rows = 4, lit = [];
    for (var k = 0; k < cols * rows; k++) lit.push(rnd() < 0.42 ? 0.6 + rnd() * 0.4 : 0);
    var wall = [[0.42, 0.20, 0.15], [0.74, 0.70, 0.62], [0.28, 0.32, 0.36], [0.46, 0.47, 0.46]][style];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, fx = x / N * cols, fy = y / N * rows;
      var cx = Math.floor(fx), cy = Math.floor(fy), lx = fx - cx, ly = fy - cy;
      var win = style === 2 ? (lx > 0.06 && lx < 0.94 && ly > 0.12 && ly < 0.88) : (lx > 0.22 && lx < 0.78 && ly > 0.2 && ly < 0.78);
      var r = wall[0], g = wall[1], b = wall[2], hh = 0, ro = 0.85, e = 0;
      var tone = 0.85 + mid[i] * 0.3 + (fine[i] - 0.5) * 0.12;
      if (style === 0) { var brick = ((fy * 9) % 1 < 0.1 || (((fx * 5.2) + (Math.floor(fy * 9) % 2) * 0.5) % 1) < 0.05); tone *= brick ? 0.7 : 1; hh = brick ? -0.4 : 0.2; }
      if (style === 3) { tone *= (Math.abs((fx * 6) % 1 - 0.5) < 0.05) ? 0.75 : 1; hh = 0.1 * Math.sin(fx * 6 * Math.PI * 2); ro = 0.55; }
      r *= tone; g *= tone; b *= tone;
      if (win) {
        var L = lit[cy * cols + cx];
        var sky = 0.5 + 0.5 * (1 - ly);
        r = 0.045 + sky * 0.05; g = 0.07 + sky * 0.07; b = 0.10 + sky * 0.11; ro = 0.08; hh = -0.9;
        if (L > 0) e = L;
        var frame = lx < 0.3 && style !== 2 ? 0 : 0;
        if (style !== 2 && (Math.abs(lx - 0.5) < 0.025 || Math.abs(ly - 0.5) < 0.02)) { r = 0.8; g = 0.8; b = 0.78; ro = 0.6; e = 0; }
      } else if (style !== 2 && ly > 0.78 && ly < 0.84 && lx > 0.18 && lx < 0.82) { r = g = b = 0.7; hh = 0.8; }
      alb[i * 3] = r; alb[i * 3 + 1] = g; alb[i * 3 + 2] = b; h[i] = hh + fine[i] * 0.2; rough[i] = ro; em[i] = e;
    }
    return pack(N, alb, h, 2.4, rough, em);
  };

  GEN.flat = function (N, r, g, b, rough) {
    var t0 = new Uint8Array(N * N * 4), t1 = new Uint8Array(N * N * 4);
    for (var i = 0; i < N * N; i++) {
      t0[i * 4] = clamp8(r * 255); t0[i * 4 + 1] = clamp8(g * 255); t0[i * 4 + 2] = clamp8(b * 255); t0[i * 4 + 3] = 255;
      t1[i * 4] = 128; t1[i * 4 + 1] = 128; t1[i * 4 + 2] = clamp8(rough * 255); t1[i * 4 + 3] = 0;
    }
    return { t0: t0, t1: t1, N: N };
  };

  /* Fine noise used for painted car metal micro-structure (very subtle orange peel normal) */
  GEN.paint = function (N) {
    var fine = noiseTile(N, N / 4, N / 4, 151), mid = fbmTile(N, 8, 3, 152);
    var alb = new Float32Array(N * N * 3), h = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) { alb[i * 3] = alb[i * 3 + 1] = alb[i * 3 + 2] = 1; h[i] = fine[i] * 0.5 + mid[i] * 0.5; }
    return pack(N, alb, h, 0.6, 0.35);
  };

  /* ----------------------------------------------------------------- 2D-canvas textures (opaque, UI-like) */
  function canvasOf(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var CAN = {};
  CAN.banner = function (text, bg, fg, sub, w, h) {
    w = w || 1024; h = h || 256;
    var c = canvasOf(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.10)';
    for (var i = -h; i < w; i += 46) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + 28, h); x.lineTo(i + 28 + h * 0.6, 0); x.lineTo(i + h * 0.6, 0); x.fill(); }
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'italic 900 ' + Math.round(h * 0.46) + 'px "Segoe UI", Arial Black, Arial, sans-serif';
    x.fillText(text, w / 2, h * (sub ? 0.40 : 0.52));
    if (sub) { x.font = '600 ' + Math.round(h * 0.15) + 'px "Segoe UI", Arial, sans-serif'; x.globalAlpha = 0.85; x.fillText(sub, w / 2, h * 0.78); x.globalAlpha = 1; }
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    return c;
  };
  CAN.board = function (label, bg, fg) {      // braking-distance board / signs
    var c = canvasOf(256, 256), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = fg; x.lineWidth = 14; x.strokeRect(10, 10, 236, 236);
    x.fillStyle = fg; x.font = '900 120px "Segoe UI", Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 128, 128);
    return c;
  };
  CAN.chevron = function () {
    var c = canvasOf(256, 256), x = c.getContext('2d');
    x.fillStyle = '#f5c400'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#111'; x.lineWidth = 34; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(70, 40); x.lineTo(190, 128); x.lineTo(70, 216); x.stroke();
    return c;
  };
  CAN.checker = function (w, h, cell) {
    var c = canvasOf(w, h), x = c.getContext('2d');
    for (var j = 0; j < h / cell; j++) for (var i = 0; i < w / cell; i++) { x.fillStyle = (i + j) % 2 ? '#101010' : '#f2f2f2'; x.fillRect(i * cell, j * cell, cell, cell); }
    return c;
  };
  CAN.crowd = function (seed) {
    var N = 256, c = canvasOf(N, N), x = c.getContext('2d'), r = U.makeRng(seed || 9);
    x.fillStyle = '#2b2b30'; x.fillRect(0, 0, N, N);
    var pal = ['#c8102e', '#1b6dff', '#f5a300', '#f2f2f2', '#22a45d', '#7a3ea8', '#e8e8d0', '#111', '#e75480', '#3ac'];
    for (var row = 0; row < 16; row++) {
      for (var col = 0; col < 32; col++) {
        if (r() < 0.12) continue;
        var px = col * 8 + 4, py = row * 16 + 10;
        x.fillStyle = pal[(r() * pal.length) | 0]; x.fillRect(px - 3, py - 1, 6, 7);
        x.fillStyle = ['#d8a88a', '#b5805c', '#7a5238', '#f0c9a8'][(r() * 4) | 0]; x.beginPath(); x.arc(px, py - 4, 2.6, 0, 6.3); x.fill();
      }
    }
    return c;
  };
  CAN.glow = function () {
    var c = canvasOf(64, 64), x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
  };
  /* Tree impostor with real alpha (cut-out): kind 0 = broadleaf, 1 = pine */
  CAN.treeCard = function (kind) {
    var W = 256, H = 512, c = canvasOf(W, H), x = c.getContext('2d'), r = U.makeRng(300 + kind);
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#4a3320'; x.fillRect(W / 2 - 7, H * 0.55, 14, H * 0.45);
    if (kind === 0) {
      for (var i = 0; i < 260; i++) {
        var a = r() * 6.283, rad = Math.sqrt(r()) * 118, cx = W / 2 + Math.cos(a) * rad, cy = H * 0.34 + Math.sin(a) * rad * 1.15;
        var sh = 0.55 + r() * 0.45; x.fillStyle = 'rgb(' + ((26 + 30 * sh) | 0) + ',' + ((70 + 80 * sh) | 0) + ',' + ((16 + 18 * sh) | 0) + ')';
        x.beginPath(); x.arc(cx, cy, 14 + r() * 14, 0, 6.3); x.fill();
      }
    } else {
      for (var t = 0; t < 7; t++) {
        var y0 = H * (0.06 + t * 0.1), wdt = 40 + t * 15;
        for (var q = 0; q < 26; q++) {
          var ax = W / 2 + (r() - 0.5) * wdt * 1.6, ay = y0 + r() * 56; var sh2 = 0.45 + r() * 0.5;
          x.fillStyle = 'rgb(' + ((14 + 22 * sh2) | 0) + ',' + ((50 + 66 * sh2) | 0) + ',' + ((22 + 24 * sh2) | 0) + ')';
          x.beginPath(); x.moveTo(ax, ay - 16); x.lineTo(ax - wdt * 0.38, ay + 26); x.lineTo(ax + wdt * 0.38, ay + 26); x.fill();
        }
      }
    }
    return c;
  };

  /* ----------------------------------------------------------------- build all for the engine */
  function build(eng, quality) {
    var R = quality.texRes || 1024, R2 = Math.max(256, R >> 1), R3 = Math.max(128, R >> 2);
    var out = {}, t0 = performance.now();
    function up(name, d, opt) {
      out[name] = { t0: eng.texture(d.N, d.N, d.t0, opt), t1: eng.texture(d.N, d.N, d.t1, opt) };
    }
    up('asphalt', GEN.asphalt(R), { clamp: false });
    up('grass', GEN.grass(R2));
    up('gravel', GEN.gravel(R2));
    up('kerb', GEN.kerb(R3));
    up('concrete', GEN.concrete(R2));
    up('rock', GEN.rock(R2));
    up('bark', GEN.bark(R3));
    up('foliage', GEN.foliage(R2));
    up('roof', GEN.roof(R3));
    up('tread', GEN.tread(R3));
    up('carbon', GEN.carbon(R3));
    up('paint', GEN.paint(R3));
    for (var s = 0; s < 4; s++) up('facade' + s, GEN.facade(R2, s));
    up('white', GEN.flat(4, 1, 1, 1, 0.6));
    up('black', GEN.flat(4, 0.03, 0.03, 0.035, 0.5));
    out.timeMs = performance.now() - t0;
    return out;
  }

  JR.textures = { build: build, GEN: GEN, CAN: CAN, noiseTile: noiseTile, fbmTile: fbmTile };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
