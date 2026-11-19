/* JIMMY RACING - gl.js
 * Tiny WebGL2 engine core: math (vec3 / mat4 / affine), program cache, geometry builder,
 * GPU meshes (static + instanced), textures, render targets.
 * World convention: +Y up. Car/model space: +X = left, +Y = up, +Z = forward. Heading h rotates +Z
 * to (sin h, 0, cos h).
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;

  /* ------------------------------------------------------------------ math */
  var M = {};
  M.create = function () { var o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; };
  M.identity = function (o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; };
  M.copy = function (o, a) { o.set(a); return o; };
  M.mul = function (o, a, b) {                     // o = a * b (column-major)
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (var i = 0; i < 4; i++) {
      var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  };
  M.perspective = function (o, fovy, aspect, n, f) {
    var t = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  };
  M.ortho = function (o, l, r, b, t, n, f) {
    o.fill(0);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  };
  M.lookAt = function (o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    var zx = ex - cx, zy = ey - cy, zz = ez - cz;
    var l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1;
    return o;
  };
  M.invert = function (o, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  };

  /* Affine 3x4 as three row-vec4s (what the instancing attributes carry) --------------------- */
  var A = {};
  /* Rotation = Ry(yaw) * Rx(pitch) * Rz(roll); uniform scale s; translation (x,y,z). Writes 12 floats at o[off..]. */
  A.compose = function (o, off, x, y, z, yaw, pitch, roll, s) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    s = s == null ? 1 : s;
    // Rx(p)*Rz(r)
    var m00 = cr, m01 = -sr, m02 = 0;
    var m10 = cp * sr, m11 = cp * cr, m12 = -sp;
    var m20 = sp * sr, m21 = sp * cr, m22 = cp;
    // Ry(y) * (above)
    var r00 = cy * m00 + sy * m20, r01 = cy * m01 + sy * m21, r02 = cy * m02 + sy * m22;
    var r10 = m10, r11 = m11, r12 = m12;
    var r20 = -sy * m00 + cy * m20, r21 = -sy * m01 + cy * m21, r22 = -sy * m02 + cy * m22;
    o[off] = r00 * s; o[off + 1] = r01 * s; o[off + 2] = r02 * s; o[off + 3] = x;
    o[off + 4] = r10 * s; o[off + 5] = r11 * s; o[off + 6] = r12 * s; o[off + 7] = y;
    o[off + 8] = r20 * s; o[off + 9] = r21 * s; o[off + 10] = r22 * s; o[off + 11] = z;
    return o;
  };
  A.identity = function (o, off) { o.fill(0, off, off + 12); o[off] = o[off + 5] = o[off + 10] = 1; return o; };
  /* o = a * b  (apply b first, then a) for 3x4 affines stored row-major */
  A.mul = function (o, oo, a, ao, b, bo) {
    var r = [];
    for (var i = 0; i < 3; i++) {
      var a0 = a[ao + i * 4], a1 = a[ao + i * 4 + 1], a2 = a[ao + i * 4 + 2], a3 = a[ao + i * 4 + 3];
      r.push(a0 * b[bo] + a1 * b[bo + 4] + a2 * b[bo + 8],
             a0 * b[bo + 1] + a1 * b[bo + 5] + a2 * b[bo + 9],
             a0 * b[bo + 2] + a1 * b[bo + 6] + a2 * b[bo + 10],
             a0 * b[bo + 3] + a1 * b[bo + 7] + a2 * b[bo + 11] + a3);
    }
    for (var k = 0; k < 12; k++) o[oo + k] = r[k];
    return o;
  };
  A.apply = function (a, ao, x, y, z, out) {
    out = out || [0, 0, 0];
    out[0] = a[ao] * x + a[ao + 1] * y + a[ao + 2] * z + a[ao + 3];
    out[1] = a[ao + 4] * x + a[ao + 5] * y + a[ao + 6] * z + a[ao + 7];
    out[2] = a[ao + 8] * x + a[ao + 9] * y + a[ao + 10] * z + a[ao + 11];
    return out;
  };
  /* Convenience: build an affine from translate / rotate-Y / scale (non-uniform allowed). */
  A.trs = function (tx, ty, tz, ry, sx, sy, sz, rx, rz) {
    var o = new Float32Array(12);
    A.compose(o, 0, tx || 0, ty || 0, tz || 0, ry || 0, rx || 0, rz || 0, 1);
    sx = sx == null ? 1 : sx; sy = sy == null ? sx : sy; sz = sz == null ? sx : sz;
    for (var r = 0; r < 3; r++) { o[r * 4] *= sx; o[r * 4 + 1] *= sy; o[r * 4 + 2] *= sz; }
    return o;
  };

  /* ------------------------------------------------------------------ geometry builder */
  function Geo() {
    this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = [];
  }
  Geo.prototype.vert = function (x, y, z, nx, ny, nz, u, v, r, g, b, a) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
    this.c.push(r == null ? 1 : r, g == null ? 1 : g, b == null ? 1 : b, a == null ? 1 : a);
    return this.p.length / 3 - 1;
  };
  Geo.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
  Geo.prototype.quad = function (a, b, c, d) { this.idx.push(a, b, c, a, c, d); };
  Geo.prototype.count = function () { return this.p.length / 3; };
  Geo.prototype.computeNormals = function () {
    var p = this.p, n = this.n, idx = this.idx, i;
    for (i = 0; i < n.length; i++) n[i] = 0;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      var vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (i = 0; i < n.length; i += 3) {
      var l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return this;
  };
  /* Append another geometry transformed by a 3x4 affine (uniform scale + rotation assumed for normals). */
  Geo.prototype.append = function (g, aff, tint) {
    var base = this.p.length / 3, i, t = [0, 0, 0];
    aff = aff || A.identity(new Float32Array(12), 0);
    for (i = 0; i < g.p.length; i += 3) {
      A.apply(aff, 0, g.p[i], g.p[i + 1], g.p[i + 2], t);
      this.p.push(t[0], t[1], t[2]);
      var nx = g.n[i], ny = g.n[i + 1], nz = g.n[i + 2];
      var X = aff[0] * nx + aff[1] * ny + aff[2] * nz, Y = aff[4] * nx + aff[5] * ny + aff[6] * nz, Z = aff[8] * nx + aff[9] * ny + aff[10] * nz;
      var l = Math.hypot(X, Y, Z) || 1;
      this.n.push(X / l, Y / l, Z / l);
    }
    for (i = 0; i < g.uv.length; i++) this.uv.push(g.uv[i]);
    for (i = 0; i < g.c.length; i += 4) {
      this.c.push(g.c[i] * (tint ? tint[0] : 1), g.c[i + 1] * (tint ? tint[1] : 1), g.c[i + 2] * (tint ? tint[2] : 1), g.c[i + 3]);
    }
    for (i = 0; i < g.idx.length; i++) this.idx.push(g.idx[i] + base);
    return this;
  };
  Geo.prototype.bounds = function () {
    var p = this.p, mn = [1e18, 1e18, 1e18], mx = [-1e18, -1e18, -1e18];
    for (var i = 0; i < p.length; i += 3) for (var k = 0; k < 3; k++) { if (p[i + k] < mn[k]) mn[k] = p[i + k]; if (p[i + k] > mx[k]) mx[k] = p[i + k]; }
    var cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
    var r = 0;
    for (i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 1] - cy, p[i + 2] - cz));
    return { min: mn, max: mx, cx: cx, cy: cy, cz: cz, r: r };
  };

  /* ---- primitives (each returns a new Geo; colour arrays are rgba 0..1) ---- */
  var P = {};
  P.box = function (w, h, d, col, opt) {      // centered; per-face flat normals; uv per face scaled by size
    var g = new Geo(), hx = w / 2, hy = h / 2, hz = d / 2; col = col || [1, 1, 1, 1];
    var uvs = (opt && opt.uvScale) || 1;
    function face(nx, ny, nz, ux, uy, uz, vx, vy, vz, su, sv, ao) {
      var cx = nx * (nx ? (nx > 0 ? hx : -hx) : 0), cy = ny * (ny ? (ny > 0 ? hy : -hy) : 0), cz = nz * (nz ? (nz > 0 ? hz : -hz) : 0);
      var hu = su / 2, hv = sv / 2;
      var pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      var ids = [];
      for (var i = 0; i < 4; i++) {
        var a = pts[i][0], b = pts[i][1];
        ids.push(g.vert(cx + ux * a * hu + vx * b * hv, cy + uy * a * hu + vy * b * hv, cz + uz * a * hu + vz * b * hv, nx, ny, nz,
          (a + 1) / 2 * su * uvs, (b + 1) / 2 * sv * uvs, col[0], col[1], col[2], col[3] * (ao == null ? 1 : ao)));
      }
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    face(1, 0, 0, 0, 0, -1, 0, 1, 0, d, h);
    face(-1, 0, 0, 0, 0, 1, 0, 1, 0, d, h);
    face(0, 1, 0, 1, 0, 0, 0, 0, -1, w, d);
    face(0, -1, 0, 1, 0, 0, 0, 0, 1, w, d, 0.6);
    face(0, 0, 1, 1, 0, 0, 0, 1, 0, w, h);
    face(0, 0, -1, -1, 0, 0, 0, 1, 0, w, h);
    return g;
  };
  /* Cylinder along Y, base at y=0 (or centered if opt.center). rTop/rBot, optional caps. */
  P.cylinder = function (rTop, rBot, h, seg, col, opt) {
    opt = opt || {}; col = col || [1, 1, 1, 1];
    var g = new Geo(), y0 = opt.center ? -h / 2 : 0, y1 = y0 + h, i;
    var slope = (rBot - rTop) / h;
    for (i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      var nl = Math.hypot(1, slope), nx = ca / nl, ny = slope / nl, nz = sa / nl;
      g.vert(ca * rBot, y0, sa * rBot, nx, ny, nz, i / seg * (opt.uRep || 1), 0, col[0], col[1], col[2], col[3]);
      g.vert(ca * rTop, y1, sa * rTop, nx, ny, nz, i / seg * (opt.uRep || 1), 1 * (opt.vRep || 1), col[0], col[1], col[2], col[3]);
    }
    for (i = 0; i < seg; i++) { var k = i * 2; g.quad(k, k + 2, k + 3, k + 1); }
    function cap(y, r, ny) {
      var c = g.vert(0, y, 0, 0, ny, 0, 0.5, 0.5, col[0], col[1], col[2], col[3]);
      var s0 = g.count();
      for (var j = 0; j <= seg; j++) { var b = j / seg * Math.PI * 2; g.vert(Math.cos(b) * r, y, Math.sin(b) * r, 0, ny, 0, 0.5 + Math.cos(b) * 0.5, 0.5 + Math.sin(b) * 0.5, col[0], col[1], col[2], col[3]); }
      for (var q = 0; q < seg; q++) { if (ny > 0) g.tri(c, s0 + q + 1, s0 + q); else g.tri(c, s0 + q, s0 + q + 1); }
    }
    if (opt.capTop !== false && rTop > 0) cap(y1, rTop, 1);
    if (opt.capBottom !== false && rBot > 0) cap(y0, rBot, -1);
    return g;
  };
  P.sphere = function (r, wseg, hseg, col, sy) {
    var g = new Geo(); col = col || [1, 1, 1, 1]; sy = sy == null ? 1 : sy;
    for (var j = 0; j <= hseg; j++) {
      var v = j / hseg, th = v * Math.PI;
      for (var i = 0; i <= wseg; i++) {
        var u = i / wseg, ph = u * Math.PI * 2;
        var nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        var l = Math.hypot(nx, ny / sy, nz);
        g.vert(nx * r, ny * r * sy, nz * r, nx, ny / sy / l, nz, u, v, col[0], col[1], col[2], col[3]);
      }
    }
    for (j = 0; j < hseg; j++) for (i = 0; i < wseg; i++) {
      var a = j * (wseg + 1) + i, b = a + wseg + 1;
      g.quad(a, a + 1, b + 1, b);
    }
    return g;
  };
  /* Surface of revolution about Y: profile = [[radius, y, nx, ny], ...] */
  P.lathe = function (profile, seg, col, uRep) {
    var g = new Geo(); col = col || [1, 1, 1, 1]; uRep = uRep || 1;
    var n = profile.length, i, j;
    for (j = 0; j < n; j++) {
      var pr = profile[j];
      for (i = 0; i <= seg; i++) {
        var a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        var nl = Math.hypot(pr[2], pr[3]) || 1;
        g.vert(ca * pr[0], pr[1], sa * pr[0], ca * pr[2] / nl, pr[3] / nl, sa * pr[2] / nl, i / seg * uRep, j / (n - 1), col[0], col[1], col[2], col[3]);
      }
    }
    for (j = 0; j < n - 1; j++) for (i = 0; i < seg; i++) {
      var a0 = j * (seg + 1) + i, b0 = a0 + seg + 1;
      g.quad(a0, b0, b0 + 1, a0 + 1);
    }
    return g;
  };
  P.plane = function (w, d, su, sv, col) {      // XZ plane facing +Y, centered
    var g = new Geo(); col = col || [1, 1, 1, 1];
    g.vert(-w / 2, 0, -d / 2, 0, 1, 0, 0, 0, col[0], col[1], col[2], col[3]);
    g.vert(w / 2, 0, -d / 2, 0, 1, 0, su, 0, col[0], col[1], col[2], col[3]);
    g.vert(w / 2, 0, d / 2, 0, 1, 0, su, sv, col[0], col[1], col[2], col[3]);
    g.vert(-w / 2, 0, d / 2, 0, 1, 0, 0, sv, col[0], col[1], col[2], col[3]);
    g.quad(0, 3, 2, 1);
    return g;
  };
  P.quadXY = function (w, h, col, flipU) {       // vertical quad facing +Z, centered on x, base at y=0
    var g = new Geo(); col = col || [1, 1, 1, 1];
    g.vert(-w / 2, 0, 0, 0, 0, 1, flipU ? 1 : 0, 0, col[0], col[1], col[2], col[3]);
    g.vert(w / 2, 0, 0, 0, 0, 1, flipU ? 0 : 1, 0, col[0], col[1], col[2], col[3]);
    g.vert(w / 2, h, 0, 0, 0, 1, flipU ? 0 : 1, 1, col[0], col[1], col[2], col[3]);
    g.vert(-w / 2, h, 0, 0, 0, 1, flipU ? 1 : 0, 1, col[0], col[1], col[2], col[3]);
    g.quad(0, 1, 2, 3);
    return g;
  };

  /* ------------------------------------------------------------------ renderer core */
  function Engine(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve, desynchronized: false });
    if (!gl) throw new Error('WebGL2 no disponible en este navegador / GPU');
    this.gl = gl; this.canvas = canvas;
    this.ext = {
      cbf: gl.getExtension('EXT_color_buffer_float'),
      cbhf: gl.getExtension('EXT_color_buffer_half_float'),
      flin: gl.getExtension('OES_texture_float_linear'),
      aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
      parallel: gl.getExtension('KHR_parallel_shader_compile')
    };
    this.maxAniso = this.ext.aniso ? gl.getParameter(this.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    this.hdr = !!(this.ext.cbf || this.ext.cbhf);
    this.progs = {};
    this.stats = { draws: 0, tris: 0 };
    var info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'GPU';
    // fullscreen triangle
    this.fsVAO = gl.createVertexArray();
    // dummy VAO for attribute-less draws
    this.nullVAO = gl.createVertexArray();
  }

  Engine.prototype.compile = function (name, vs, fs, defines) {
    var gl = this.gl;
    var key = name + '|' + (defines || []).join(',');
    if (this.progs[key]) return this.progs[key];
    var head = '#version 300 es\n' + (defines || []).map(function (d) { return '#define ' + d + '\n'; }).join('');
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, head + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(s);
        var lines = (head + src).split('\n'), msg = '';
        var m = /ERROR: \d+:(\d+)/.exec(log);
        if (m) { var ln = +m[1]; msg = '\n>> ' + lines.slice(Math.max(0, ln - 3), ln + 1).join('\n>> '); }
        throw new Error('Shader ' + name + (type === gl.VERTEX_SHADER ? ' VS' : ' FS') + ': ' + log + msg);
      }
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 2, 'aUV'); gl.bindAttribLocation(p, 3, 'aCol');
    gl.bindAttribLocation(p, 0, 'aI0'); gl.bindAttribLocation(p, 1, 'aI1'); gl.bindAttribLocation(p, 2, 'aI2'); gl.bindAttribLocation(p, 3, 'aI3');
    gl.bindAttribLocation(p, 4, 'aM0'); gl.bindAttribLocation(p, 5, 'aM1'); gl.bindAttribLocation(p, 6, 'aM2'); gl.bindAttribLocation(p, 7, 'aTint');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link ' + name + ': ' + gl.getProgramInfoLog(p));
    var prog = { p: p, u: {}, name: name };
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var nm = info.name.replace(/\[0\]$/, '');
      prog.u[nm] = gl.getUniformLocation(p, info.name);
    }
    this.progs[key] = prog;
    return prog;
  };
  Engine.prototype.use = function (prog) {
    if (this.cur !== prog) { this.gl.useProgram(prog.p); this.cur = prog; }
    return prog;
  };

  /* ---- GPU mesh ---- */
  function GPUMesh(eng, geo, opt) {
    opt = opt || {};
    var gl = eng.gl;
    this.eng = eng;
    this.count = geo.idx.length;
    this.verts = geo.p.length / 3;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    var interleaved = new Float32Array(this.verts * 8);
    var col = new Uint8Array(this.verts * 4);
    for (var i = 0; i < this.verts; i++) {
      interleaved[i * 8] = geo.p[i * 3]; interleaved[i * 8 + 1] = geo.p[i * 3 + 1]; interleaved[i * 8 + 2] = geo.p[i * 3 + 2];
      interleaved[i * 8 + 3] = geo.n[i * 3]; interleaved[i * 8 + 4] = geo.n[i * 3 + 1]; interleaved[i * 8 + 5] = geo.n[i * 3 + 2];
      interleaved[i * 8 + 6] = geo.uv[i * 2]; interleaved[i * 8 + 7] = geo.uv[i * 2 + 1];
      for (var k = 0; k < 4; k++) col[i * 4 + k] = Math.max(0, Math.min(255, Math.round(geo.c[i * 4 + k] * 255)));
    }
    this.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.bufferData(gl.ARRAY_BUFFER, interleaved, opt.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    this.cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cb); gl.bufferData(gl.ARRAY_BUFFER, col, opt.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    var big = this.verts > 65535;
    this.indexType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(geo.idx) : new Uint16Array(geo.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.bounds = geo.bounds();
  }
  GPUMesh.prototype.dispose = function () {
    var gl = this.eng.gl; gl.deleteBuffer(this.vb); gl.deleteBuffer(this.cb); gl.deleteBuffer(this.ib); gl.deleteVertexArray(this.vao);
  };
  Engine.prototype.mesh = function (geo, opt) { return new GPUMesh(this, geo, opt); };

  /* Instance buffer: 16 floats per instance = affine rows (12) + tint rgba (4). */
  function InstanceBuffer(eng, capacity) {
    this.eng = eng; this.cap = capacity; this.n = 0;
    this.data = new Float32Array(capacity * 16);
    this.buf = eng.gl.createBuffer();
    eng.gl.bindBuffer(eng.gl.ARRAY_BUFFER, this.buf);
    eng.gl.bufferData(eng.gl.ARRAY_BUFFER, this.data.byteLength, eng.gl.DYNAMIC_DRAW);
  }
  InstanceBuffer.prototype.push = function (aff, ao, tint) {
    if (this.n >= this.cap) return false;
    var o = this.n * 16, d = this.data;
    for (var i = 0; i < 12; i++) d[o + i] = aff[ao + i];
    d[o + 12] = tint ? tint[0] : 1; d[o + 13] = tint ? tint[1] : 1; d[o + 14] = tint ? tint[2] : 1; d[o + 15] = tint ? tint[3] : 1;
    this.n++; return true;
  };
  InstanceBuffer.prototype.upload = function () {
    var gl = this.eng.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 16);
  };
  Engine.prototype.instances = function (cap) { return new InstanceBuffer(this, cap); };

  /* Draw a mesh. xf: Float32Array(12 or 16 tint at +12) used as constant attributes, or inst: InstanceBuffer. */
  var IDENT12 = A.identity(new Float32Array(12), 0);
  Engine.prototype.draw = function (mesh, xf, inst, tint, mode) {
    var gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    var count = (inst ? inst.n : 1);
    if (inst && inst.n === 0) return;
    if (inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst.buf);
      for (var i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(4 + i);
        gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(4 + i, 1);
      }
      gl.drawElementsInstanced(mode || gl.TRIANGLES, mesh.count, mesh.indexType, 0, inst.n);
      for (i = 0; i < 4; i++) { gl.vertexAttribDivisor(4 + i, 0); gl.disableVertexAttribArray(4 + i); }
    } else {
      xf = xf || IDENT12;
      gl.disableVertexAttribArray(4); gl.disableVertexAttribArray(5); gl.disableVertexAttribArray(6); gl.disableVertexAttribArray(7);
      gl.vertexAttrib4f(4, xf[0], xf[1], xf[2], xf[3]);
      gl.vertexAttrib4f(5, xf[4], xf[5], xf[6], xf[7]);
      gl.vertexAttrib4f(6, xf[8], xf[9], xf[10], xf[11]);
      gl.vertexAttrib4f(7, tint ? tint[0] : 1, tint ? tint[1] : 1, tint ? tint[2] : 1, tint ? tint[3] : 1);
      gl.drawElements(mode || gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    }
    this.stats.draws++; this.stats.tris += (mesh.count / 3) * count;
  };

  /* ---- textures ---- */
  Engine.prototype.texture = function (w, h, data, opt) {
    opt = opt || {};
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, opt.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (opt.mip !== false) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opt.mip === false ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var wrap = opt.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.ext.aniso && opt.mip !== false) gl.texParameterf(gl.TEXTURE_2D, this.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(this.maxAniso, opt.aniso || this.aniso || 8));
    t.w = w; t.h = h;
    return t;
  };
  Engine.prototype.setAniso = function (n) { this.aniso = n; };
  Engine.prototype.canvasTexture = function (cv, opt) {
    var gl = this.gl, t = gl.createTexture();
    opt = opt || {};
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    if (opt.mip !== false) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opt.mip === false ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var wrap = opt.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.ext.aniso && opt.mip !== false) gl.texParameterf(gl.TEXTURE_2D, this.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(this.maxAniso, 8));
    t.w = cv.width; t.h = cv.height;
    return t;
  };
  Engine.prototype.bindTex = function (unit, tex, loc) {
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc != null) gl.uniform1i(loc, unit);
  };

  /* ---- render targets ---- */
  /* kind: 'color' (RGBA16F/8 texture), 'depth' (depth texture w/ compare), 'colordepth' */
  Engine.prototype.target = function (w, h, o) {
    o = o || {};
    var gl = this.gl, t = { w: w, h: h, fbo: gl.createFramebuffer(), color: null, depth: null, samples: o.samples || 0 };
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    var intFmt = o.float === false ? gl.RGBA8 : (this.hdr ? gl.RGBA16F : gl.RGBA8);
    var type = o.float === false ? gl.UNSIGNED_BYTE : (this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE);
    if (o.samples > 0) {
      t.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, o.samples, intFmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.rb);
      t.drb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.drb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, o.samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.drb);
    } else {
      if (o.color !== false) {
        t.color = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t.color);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, w, h, 0, gl.RGBA, type, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.nearest ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.nearest ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.color, 0);
      } else {
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      }
      if (o.depth) {
        t.depth = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t.depth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.compare ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.compare ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (o.compare) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
      } else if (o.depthRB) {
        t.drb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, t.drb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.drb);
      }
    }
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incompleto (' + st + ') ' + w + 'x' + h + ' samples=' + (o.samples || 0));
    return t;
  };
  Engine.prototype.freeTarget = function (t) {
    if (!t) return;
    var gl = this.gl;
    if (t.color) gl.deleteTexture(t.color);
    if (t.depth) gl.deleteTexture(t.depth);
    if (t.rb) gl.deleteRenderbuffer(t.rb);
    if (t.drb) gl.deleteRenderbuffer(t.drb);
    gl.deleteFramebuffer(t.fbo);
  };
  Engine.prototype.bindTarget = function (t, w, h) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : w, t ? t.h : h);
  };
  Engine.prototype.fullscreen = function () {
    var gl = this.gl;
    gl.bindVertexArray(this.nullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.draws++;
  };

  JR.gl = { M: M, A: A, Geo: Geo, P: P, Engine: Engine, IDENT12: IDENT12 };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
