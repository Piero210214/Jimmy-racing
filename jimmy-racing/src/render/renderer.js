/* JIMMY RACING - renderer.js
 * Frame orchestration: cascaded sun shadows, planar wet reflections, HDR MSAA scene pass,
 * bloom, depth of field, radial motion blur, ACES tone-mapping and grading.
 * Scene content is supplied by "layers" (world, trees, cars, fx...) that issue draw calls through
 * renderer.drawMesh(mesh, xf, inst, material, tint).
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var GL = JR.gl, M = GL.M, A = GL.A, S = JR.shaders;
  var U = JR.util;

  function Renderer(canvas, qualityId, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.eng = new GL.Engine(canvas, { preserve: !!opts.preserve });
    this.gl = this.eng.gl;
    this.q = JR.env.QUALITY[qualityId] || JR.env.QUALITY.high;
    this.userScale = 1;           // user resolution scale on top of quality scale
    this.autoScale = 1;           // dynamic resolution
    this.eng.setAniso(this.q.aniso);
    this.tex = JR.textures.build(this.eng, this.q);
    this.layers = [];
    this.frameId = 0;
    this.time = 0;
    this.W = 2; this.H = 2;
    this.view = M.create(); this.proj = M.create(); this.viewProj = M.create(); this.invViewProj = M.create();
    this.camPos = [0, 0, 0]; this.camFwd = [0, 0, -1]; this.camRight = [1, 0, 0]; this.camUp = [0, 1, 0];
    this.planes = new Float32Array(24);
    this.env = JR.env.make('noon', 'clear');
    this.spots = [];
    this.shadow = { on: true, maps: [], vp: [M.create(), M.create(), M.create()], texel: [1, 1, 1], center: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], radius: [10, 10, 10], res: 1024 };
    this.reflOn = false;
    this.exposureMul = 1; this.fade = 1; this.motion = 0; this.dofAmt = 0; this.dofFocus = 12;
    this.passInfo = { pass: 'main' };
    this.clipY = -1e9;
    this.stats = { draws: 0, tris: 0 };
    this._makeShadowMaps();
    this._dummy();
    this.setViewport(canvas.clientWidth || 960, canvas.clientHeight || 540, 1);
  }

  Renderer.prototype._dummy = function () {
    // 1x1 textures so every sampler always has a valid binding
    var gl = this.gl;
    this.blackTex = this.eng.texture(1, 1, new Uint8Array([0, 0, 0, 255]), { mip: false });
    this.whiteTex = this.eng.texture(1, 1, new Uint8Array([255, 255, 255, 255]), { mip: false });
  };

  Renderer.prototype._makeShadowMaps = function () {
    var q = this.q, eng = this.eng;
    for (var i = 0; i < this.shadow.maps.length; i++) eng.freeTarget(this.shadow.maps[i]);
    this.shadow.maps = [];
    var res = q.shadowRes; this.shadow.res = res;
    for (i = 0; i < 3; i++) {
      var r = i < q.cascades ? (i === 0 ? res : (i === 1 ? res : Math.max(1024, res >> 1))) : 16;
      this.shadow.maps.push(eng.target(r, r, { color: false, depth: true, compare: true }));
    }
  };

  Renderer.prototype.setQuality = function (id) {
    this.q = JR.env.QUALITY[id] || this.q;
    this.eng.setAniso(this.q.aniso);
    this._makeShadowMaps();
    this.W = 0;
    this.setViewport(this.cssW, this.cssH, this.dpr);
  };

  Renderer.prototype.setViewport = function (cssW, cssH, dpr) {
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr || 1;
    var sc = this.q.scale * this.userScale * this.autoScale;
    var W = Math.max(64, Math.floor(cssW * this.dpr * sc)), H = Math.max(48, Math.floor(cssH * this.dpr * sc));
    if (W === this.W && H === this.H && this.sceneRT) return;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    this._makeTargets();
  };
  /* user-facing render scale (0.5 .. 2) */
  Renderer.prototype.setScale = function (s) { this.userScale = s; this.setViewport(this.cssW, this.cssH, this.dpr); };
  Renderer.prototype.setAutoScale = function (s) { if (Math.abs(s - this.autoScale) > 0.001) { this.autoScale = s; this.setViewport(this.cssW, this.cssH, this.dpr); } };

  Renderer.prototype._makeTargets = function () {
    var eng = this.eng, W = this.W, H = this.H, i;
    ['sceneMS', 'sceneRT', 'reflRT'].forEach(function (k) { if (this[k]) { eng.freeTarget(this[k]); this[k] = null; } }, this);
    if (this.bloomRT) this.bloomRT.forEach(function (t) { eng.freeTarget(t); });
    var ms = Math.min(this.q.msaa, this.eng.maxSamples);
    this.ms = ms;
    this.sceneRT = eng.target(W, H, { depth: true });
    this.sceneMS = ms > 0 ? eng.target(W, H, { samples: ms }) : null;
    this.bloomRT = [];
    var bw = W >> 1, bh = H >> 1;
    for (i = 0; i < 5; i++) { this.bloomRT.push(eng.target(Math.max(2, bw), Math.max(2, bh), {})); bw >>= 1; bh >>= 1; }
    if (this.q.refl) this.reflRT = eng.target(Math.max(64, W >> 1), Math.max(48, H >> 1), { depthRB: true });
  };

  Renderer.prototype.addLayer = function (layer) { this.layers.push(layer); return layer; };

  /* ---------------------------------------------------------------- materials */
  Renderer.prototype.texSet = function (name) { return this.tex[name] || this.tex.white; };
  Renderer.prototype.material = function (o) {
    var ts = this.texSet(o.tex || 'white');
    var m = {
      defs: (o.defs || []).slice(), t0: o.t0 || ts.t0, t1: o.t1 || ts.t1, t2: null, t3: null,
      base: o.base || [1, 1, 1, 1], rough: o.rough == null ? 1 : o.rough, metal: o.metal || 0, emis: o.emis || [0, 0, 0],
      ts: o.ts || [1, 1], nstr: o.nstr == null ? 1 : o.nstr, clear: o.clear || 0, flake: o.flake || 0, wetAff: o.wetAff || 0,
      cut: o.cut || 0.5, spec: o.spec == null ? 1 : o.spec, tint: o.tintMul || [1, 1, 1, 1],
      blend: o.blend || 'none', cull: o.cull !== false, depthWrite: o.depthWrite !== false, polyOff: o.polyOff || null,
      castShadow: o.castShadow !== false, alphaTest: !!o.alphaTest, noDepth: !!o.noDepth, prog: 'lit'
    };
    if (o.alphaTest && m.defs.indexOf('ALPHATEST') < 0) m.defs.push('ALPHATEST');
    if (o.terrain) { m.defs.push('TERRAIN'); var r = this.texSet(o.terrain); m.t2 = r.t0; m.t3 = r.t1; }
    if (o.emisMask) m.defs.push('EMISMASK');
    if (o.glass) m.defs.push('GLASS');
    if (o.car) m.defs.push('CAR');
    if (o.sway) m.defs.push('SWAY');
    if (o.prog) m.prog = o.prog;
    return m;
  };

  Renderer.prototype._program = function (m, shadow) {
    var defs = m.defs.slice();
    if (shadow) {
      var sd = []; if (m.alphaTest) sd.push('ALPHATEST');
      return this.eng.compile('shadow', S.shadowVS, S.shadowFS, sd);
    }
    if (m.prog === 'lit' && this.reflOn && m.wetAff > 0 && this.passInfo.pass === 'main') defs.push('REFL');
    if (m.prog === 'decal') return this.eng.compile('decal', S.litVS, S.decalFS, defs);
    if (m.prog === 'vol') return this.eng.compile('vol', S.litVS, S.volFS, defs);
    return this.eng.compile('lit', S.litVS, S.litFS, defs);
  };

  /* ---------------------------------------------------------------- per-frame uniforms */
  Renderer.prototype._frameUniforms = function (p) {
    var gl = this.gl, u = p.u, e = this.env, s = this.shadow;
    p.frame = this.frameId; p.fpass = this.passInfo.pass;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform3fv(u.uCam, this.camPos);
    gl.uniform3fv(u.uSunDir, e.sunDir); gl.uniform3fv(u.uSunCol, e.sunCol);
    gl.uniform3fv(u.uSkyZen, e.skyZen); gl.uniform3fv(u.uSkyHor, e.skyHor); gl.uniform3fv(u.uGround, e.ground);
    gl.uniform3fv(u.uSkyAmb, e.skyAmb); gl.uniform1f(u.uAmb, e.amb);
    gl.uniform1f(u.uCloud, e.cloud); gl.uniform1f(u.uNight, e.night); gl.uniform1f(u.uTime, this.time); gl.uniform3fv(u.uMoonDir, e.moonDir);
    gl.uniform3fv(u.uFogCol, e.fogCol); gl.uniform1f(u.uFogDen, e.fogDen); gl.uniform1f(u.uFogHF, e.fogHF); gl.uniform1f(u.uFogBase, e.fogBase); gl.uniform1f(u.uFogSun, e.fogSun);
    gl.uniform1f(u.uWet, e.wet); gl.uniform1f(u.uSnow, e.snow);
    gl.uniform2f(u.uWind, e.wind[0], e.wind[1]);
    var nc = (this.passInfo.pass === 'refl') ? 0 : (s.on ? this.q.cascades : 0);
    gl.uniform1i(u.uNCasc, nc);
    gl.uniform3f(u.uCascTexel, s.texel[0], s.texel[1], s.texel[2]);
    gl.uniformMatrix4fv(u.uLVP0, false, s.vp[0]); gl.uniformMatrix4fv(u.uLVP1, false, s.vp[1]); gl.uniformMatrix4fv(u.uLVP2, false, s.vp[2]);
    for (var i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, s.maps[i].depth);
      if (u['uShadow' + i] != null) gl.uniform1i(u['uShadow' + i], 4 + i);
    }
    var n = Math.min(8, this.spots.length);
    gl.uniform1i(u.uNSpot, n);
    if (n && u.uSpot) {
      var a = new Float32Array(32), b = new Float32Array(32), c = new Float32Array(32);
      for (i = 0; i < n; i++) {
        var sp = this.spots[i];
        a[i * 4] = sp.pos[0]; a[i * 4 + 1] = sp.pos[1]; a[i * 4 + 2] = sp.pos[2]; a[i * 4 + 3] = sp.range;
        b[i * 4] = sp.dir[0]; b[i * 4 + 1] = sp.dir[1]; b[i * 4 + 2] = sp.dir[2]; b[i * 4 + 3] = sp.cosOuter;
        c[i * 4] = sp.color[0]; c[i * 4 + 1] = sp.color[1]; c[i * 4 + 2] = sp.color[2]; c[i * 4 + 3] = sp.cosInner;
      }
      gl.uniform4fv(u.uSpot, a); gl.uniform4fv(u.uSpotD, b); gl.uniform4fv(u.uSpotC, c);
    }
    if (u.uReflTex != null) {
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.reflRT ? this.reflRT.color : this.blackTex);
      gl.uniform1i(u.uReflTex, 7);
      gl.uniform2f(u.uViewport, this.W, this.H); gl.uniform1f(u.uReflOn, this.reflOn ? 1 : 0);
    }
    if (u.uClipY != null) gl.uniform1f(u.uClipY, this.clipY);
    if (u.uCamRight != null) { gl.uniform3fv(u.uCamRight, this.camRight); gl.uniform3fv(u.uCamUp, this.camUp); }
  };

  Renderer.prototype.useMaterial = function (m, shadow) {
    var gl = this.gl, eng = this.eng, p = this._program(m, shadow), u = p.u;
    eng.use(p);
    if (shadow) {
      if (u.uTex0 != null) { eng.bindTex(0, m.t0, u.uTex0); gl.uniform2fv(u.uTexScale, m.ts); gl.uniform1f(u.uAlphaCut, m.cut); }
      return p;
    }
    if (p.frame !== this.frameId || p.fpass !== this.passInfo.pass) this._frameUniforms(p);
    if (u.uTex0 != null) eng.bindTex(0, m.t0, u.uTex0);
    if (u.uTex1 != null) eng.bindTex(1, m.t1, u.uTex1);
    if (u.uTex2 != null) eng.bindTex(2, m.t2 || this.whiteTex, u.uTex2);
    if (u.uTex3 != null) eng.bindTex(3, m.t3 || this.whiteTex, u.uTex3);
    gl.uniform4fv(u.uBase, m.base); gl.uniform1f(u.uRough, m.rough); gl.uniform1f(u.uMetal, m.metal);
    gl.uniform3fv(u.uEmis, m.emis); gl.uniform2fv(u.uTexScale, m.ts); gl.uniform1f(u.uNormStr, m.nstr);
    gl.uniform1f(u.uClear, m.clear); gl.uniform1f(u.uFlake, m.flake); gl.uniform1f(u.uWetAffect, m.wetAff);
    gl.uniform1f(u.uAlphaCut, m.cut); gl.uniform1f(u.uSpec, m.spec); gl.uniform4fv(u.uTintMul, m.tint);
    // render state
    if (m.blend === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    else if (m.blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
    else gl.disable(gl.BLEND);
    if (m.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    gl.depthMask(m.depthWrite && m.blend === 'none' || (m.depthWrite && m.blend !== 'none' && m.depthWriteForce === true));
    if (m.noDepth) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    if (m.polyOff) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(m.polyOff[0], m.polyOff[1]); } else gl.disable(gl.POLYGON_OFFSET_FILL);
    return p;
  };

  /* Issue a draw. In shadow passes only casters are drawn. */
  Renderer.prototype.drawMesh = function (mesh, xf, inst, m, tint) {
    if (this.passInfo.pass === 'shadow') { if (!m.castShadow) return; this.useMaterial(m, true); }
    else this.useMaterial(m, false);
    this.eng.draw(mesh, xf, inst, tint);
  };

  /* ---------------------------------------------------------------- camera / frustum */
  Renderer.prototype.setCamera = function (pos, target, up, fovDeg, roll, near, far) {
    var W = this.W, H = this.H;
    up = up || [0, 1, 0];
    if (roll) { // roll the up vector around the view direction
      var fx = target[0] - pos[0], fy = target[1] - pos[1], fz = target[2] - pos[2], l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
      var c = Math.cos(roll), s = Math.sin(roll);
      var rx = fy * up[2] - fz * up[1], ry = fz * up[0] - fx * up[2], rz = fx * up[1] - fy * up[0];
      up = [up[0] * c + rx * s, up[1] * c + ry * s, up[2] * c + rz * s];
    }
    this.camPos = pos.slice();
    this.fov = fovDeg; this.near = near || 0.35; this.far = far || 6000;
    M.perspective(this.proj, fovDeg * Math.PI / 180, W / H, this.near, this.far);
    M.lookAt(this.view, pos[0], pos[1], pos[2], target[0], target[1], target[2], up[0], up[1], up[2]);
    this._finishCam();
  };
  Renderer.prototype._finishCam = function () {
    var v = this.view;
    M.mul(this.viewProj, this.proj, this.view);
    M.invert(this.invViewProj, this.viewProj);
    this.camRight = [v[0], v[4], v[8]]; this.camUp = [v[1], v[5], v[9]]; this.camFwd = [-v[2], -v[6], -v[10]];
    var m = this.viewProj, p = this.planes, k = 0;
    // Gribb-Hartmann (column-major)
    var rows = [[m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]], [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]], [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]];
    for (var i = 0; i < 6; i++) {
      var r = rows[i], l = Math.hypot(r[0], r[1], r[2]) || 1;
      p[k++] = r[0] / l; p[k++] = r[1] / l; p[k++] = r[2] / l; p[k++] = r[3] / l;
    }
  };
  Renderer.prototype.sphereVisible = function (x, y, z, r) {
    var p = this.planes;
    for (var i = 0; i < 24; i += 4) if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -r) return false;
    return true;
  };
  Renderer.prototype.visible = function (bs) {
    if (this.passInfo.pass === 'shadow') {
      var c = this.passInfo.casc, dx = bs.x - c.cx, dy = bs.y - c.cy, dz = bs.z - c.cz, rr = c.r + bs.r;
      // cylinder-ish test along the sun direction: ignore distance along the light axis
      var sd = this.env.sunDir, along = dx * sd[0] + dy * sd[1] + dz * sd[2];
      var px = dx - sd[0] * along, py = dy - sd[1] * along, pz = dz - sd[2] * along;
      return px * px + py * py + pz * pz < rr * rr;
    }
    var cp = this.camPos, d2 = (bs.x - cp[0]) * (bs.x - cp[0]) + (bs.y - cp[1]) * (bs.y - cp[1]) + (bs.z - cp[2]) * (bs.z - cp[2]);
    var md = (bs.maxDist || this.q.drawDist) + bs.r;
    if (d2 > md * md) return false;
    return this.sphereVisible(bs.x, bs.y, bs.z, bs.r);
  };

  /* ---------------------------------------------------------------- shadow cascades */
  Renderer.prototype._fitCascades = function () {
    var q = this.q, s = this.shadow, sd = this.env.sunDir, cam = this.camPos, f = this.camFwd;
    var nc = q.cascades, i;
    // light basis
    var up = Math.abs(sd[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    for (i = 0; i < nc; i++) {
      var r = q.cascR[i], res = s.maps[i].w;
      var cx = cam[0] + f[0] * r * 0.45, cy = cam[1] + f[1] * r * 0.45, cz = cam[2] + f[2] * r * 0.45;
      var dist = r * 2.0 + 260;
      var eye = [cx + sd[0] * dist, cy + sd[1] * dist, cz + sd[2] * dist];
      var V = M.create(), P = M.create();
      M.lookAt(V, eye[0], eye[1], eye[2], cx, cy, cz, up[0], up[1], up[2]);
      // snap centre to texel grid in light space
      var texel = 2 * r / res;
      var lc = [V[0] * cx + V[4] * cy + V[8] * cz + V[12], V[1] * cx + V[5] * cy + V[9] * cz + V[13]];
      var snx = Math.round(lc[0] / texel) * texel - lc[0], sny = Math.round(lc[1] / texel) * texel - lc[1];
      M.ortho(P, -r + snx, r + snx, -r + sny, r + sny, 1, dist + r * 2 + 260);
      M.mul(s.vp[i], P, V);
      s.texel[i] = texel; s.center[i] = [cx, cy, cz]; s.radius[i] = r;
    }
  };

  Renderer.prototype._shadowPass = function () {
    var gl = this.gl, q = this.q, s = this.shadow, i;
    this._fitCascades();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
    for (i = 0; i < q.cascades; i++) {
      var t = s.maps[i];
      this.eng.bindTarget(t);
      gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      this.passInfo = { pass: 'shadow', casc: { cx: s.center[i][0], cy: s.center[i][1], cz: s.center[i][2], r: s.radius[i], index: i } };
      this.eng.cur = null;
      // per-program uniform
      var self = this;
      this.shadowVP = s.vp[i];
      this._shadowProgs = {};
      this.layers.forEach(function (L) { if (L.drawShadow) L.drawShadow(self, i); });
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.cullFace(gl.BACK);
    this.passInfo = { pass: 'main' };
  };
  // shadow programs need uLVP; set when material program bound
  var _useMat = Renderer.prototype.useMaterial;
  Renderer.prototype.useMaterial = function (m, shadow) {
    var p = _useMat.call(this, m, shadow);
    if (!shadow && p.u.uDamage != null) {
      var dm = this.carDamage || [0, 0, 0, 0], ch = this.carHalf || [2.3, 1];
      this.gl.uniform4f(p.u.uDamage, dm[0], dm[1], dm[2], dm[3]); this.gl.uniform2f(p.u.uCarHalf, ch[0], ch[1]);
    }
    if (!shadow && p.u.uArch != null) { var ar = this.carArch || [0, 0, 0, 0]; this.gl.uniform4f(p.u.uArch, ar[0], ar[1], ar[2], ar[3]); if (p.u.uCarHalf != null && !(p.u.uDamage != null)) this.gl.uniform2f(p.u.uCarHalf, (this.carHalf || [2.3, 1])[0], (this.carHalf || [2.3, 1])[1]); }
    if (!shadow && p.u.uAO0 != null) {
      var ao = this.carAO; this.gl.uniform1i(p.u.uNAO, ao ? ao.n : 0);
      if (ao && ao.n) { this.gl.uniform4fv(p.u.uAO0, ao.a0); this.gl.uniform4fv(p.u.uAO1, ao.a1); this.gl.uniform4fv(p.u.uAO2, ao.a2); }
    }
    if (shadow && p.u.uLVP != null) this.gl.uniformMatrix4fv(p.u.uLVP, false, this.shadowVP);
    return p;
  };

  /* ---------------------------------------------------------------- reflection pass (planar, wet road) */
  Renderer.prototype._reflPass = function (planeY) {
    var gl = this.gl, saved = { view: this.view.slice(), proj: this.proj.slice(), vp: this.viewProj.slice(), cam: this.camPos.slice() };
    // mirror the camera about y = planeY
    var Rm = M.create(); Rm[5] = -1; Rm[13] = 2 * planeY;
    var mv = M.create(); M.mul(mv, this.view, Rm);
    this.view.set(mv);
    this.camPos = [saved.cam[0], 2 * planeY - saved.cam[1], saved.cam[2]];
    var vv = this.view;
    this._finishCam();
    this.camPos = [saved.cam[0], 2 * planeY - saved.cam[1], saved.cam[2]];
    this.eng.bindTarget(this.reflRT);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.frontFace(gl.CW);
    this.passInfo = { pass: 'refl' }; this.clipY = planeY - 0.05;
    this._drawSky(true);
    var self = this;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    this.layers.forEach(function (L) { if (L.drawRefl) L.drawRefl(self); });
    gl.frontFace(gl.CCW);
    this.clipY = -1e9;
    this.passInfo = { pass: 'main' };
    this.view.set(saved.view); this.proj.set(saved.proj); this.camPos = saved.cam;
    this._finishCam();
  };

  /* ---------------------------------------------------------------- sky */
  Renderer.prototype._drawSky = function (mirrored) {
    var gl = this.gl, eng = this.eng, e = this.env;
    var p = eng.compile('sky', S.skyVS, S.skyFS); eng.use(p);
    var u = p.u;
    gl.uniformMatrix4fv(u.uInvVP, false, this.invViewProj); gl.uniform3fv(u.uCam, this.camPos);
    gl.uniform3fv(u.uSunDir, e.sunDir); gl.uniform3fv(u.uSunCol, e.sunCol); gl.uniform3fv(u.uSkyZen, e.skyZen); gl.uniform3fv(u.uSkyHor, e.skyHor);
    gl.uniform3fv(u.uGround, e.ground); gl.uniform1f(u.uCloud, e.cloud); gl.uniform1f(u.uNight, e.night); gl.uniform1f(u.uTime, this.time);
    gl.uniform3fv(u.uMoonDir, e.moonDir); gl.uniform2f(u.uWind, e.wind[0], e.wind[1]); gl.uniform3fv(u.uCloudCol, e.cloudCol);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    eng.fullscreen();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  };

  /* ---------------------------------------------------------------- main frame */
  Renderer.prototype.render = function (dt) {
    var gl = this.gl, eng = this.eng, self = this, e = this.env, q = this.q;
    this.frameId++; this.time += dt;
    eng.stats.draws = 0; eng.stats.tris = 0; eng.cur = null;
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    this.layers.forEach(function (L) { if (L.prepare) L.prepare(self, dt); });
    // 1. shadows
    if (this.shadow.on && q.cascades > 0) this._shadowPass();
    // 2. wet reflections
    this.reflOn = !!(this.reflRT && e.wet > 0.2 && q.refl);
    if (this.reflOn) this._reflPass(this.reflPlaneY == null ? 0 : this.reflPlaneY);
    // 3. main scene
    var target = this.sceneMS || this.sceneRT;
    eng.bindTarget(target);
    gl.clearColor(e.fogCol[0], e.fogCol[1], e.fogCol[2], 1); gl.clearDepth(1);
    gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.passInfo = { pass: 'main' }; eng.cur = null;
    this._drawSky(false);
    gl.depthFunc(gl.LEQUAL);
    ['drawOpaque', 'drawAlpha', 'drawTransparent'].forEach(function (stage) {
      self.layers.forEach(function (L) { if (L[stage]) L[stage](self); });
    });
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.POLYGON_OFFSET_FILL);
    // 4. resolve
    if (this.sceneMS) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneMS.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneRT.fbo);
      gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }
    this._post(dt);
    this.stats.draws = eng.stats.draws; this.stats.tris = eng.stats.tris;
  };

  Renderer.prototype._post = function (dt) {
    var gl = this.gl, eng = this.eng, e = this.env, q = this.q, W = this.W, H = this.H, i;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false); gl.disable(gl.BLEND);
    var bloomOn = q.bloom && this.bloomRT.length;
    if (bloomOn) {
      var pd = eng.compile('bloomDown', S.postVS, S.bloomDownFS), pu = eng.compile('bloomUp', S.postVS, S.bloomUpFS);
      eng.use(pd);
      var src = this.sceneRT.color, sw = W, sh = H;
      for (i = 0; i < this.bloomRT.length; i++) {
        var t = this.bloomRT[i];
        eng.bindTarget(t);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(pd.u.uTex, 0);
        gl.uniform2f(pd.u.uTexel, 1 / sw, 1 / sh); gl.uniform1f(pd.u.uFirst, i === 0 ? 1 : 0); gl.uniform1f(pd.u.uThresh, e.thresh);
        eng.fullscreen();
        src = t.color; sw = t.w; sh = t.h;
      }
      eng.use(pu);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (i = this.bloomRT.length - 1; i > 0; i--) {
        var lo = this.bloomRT[i], hi = this.bloomRT[i - 1];
        eng.bindTarget(hi);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lo.color); gl.uniform1i(pu.u.uTex, 0);
        gl.uniform2f(pu.u.uTexel, 1 / lo.w, 1 / lo.h); gl.uniform1f(pu.u.uRadius, 1.0);
        eng.fullscreen();
      }
      gl.disable(gl.BLEND);
    }
    eng.bindTarget(null, W, H);
    var pc = eng.compile('composite', S.postVS, S.compositeFS); eng.use(pc);
    var u = pc.u;
    eng.bindTex(0, this.sceneRT.color, u.uScene);
    eng.bindTex(1, bloomOn ? this.bloomRT[0].color : this.blackTex, u.uBloom);
    eng.bindTex(2, this.sceneRT.depth, u.uDepth);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.depth); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.uniform1f(u.uExposure, e.exposure * this.exposureMul); gl.uniform1f(u.uBloomAmt, bloomOn ? (e.bloom * (e.night ? 1.2 : 0.8) * 0.5) : 0);
    gl.uniform1f(u.uVig, 0.55); gl.uniform1f(u.uGrain, 0.018); gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uMotion, this.motion); gl.uniform2f(u.uMotionCenter, 0.5, 0.46);
    gl.uniform1f(u.uDof, q.dof ? this.dofAmt : 0); gl.uniform1f(u.uFocus, this.dofFocus); gl.uniform2f(u.uNearFar, this.near, this.far); gl.uniform2f(u.uTexel, 1 / W, 1 / H);
    gl.uniform1f(u.uSat, e.sat); gl.uniform3fv(u.uTint, e.tint); gl.uniform1f(u.uContrast, e.contrast); gl.uniform1f(u.uRainLens, this.rainLens || 0); gl.uniform1f(u.uFade, this.fade);
    gl.uniform1f(u.uAberr, 0.0035);
    eng.fullscreen();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  };

  JR.Renderer = Renderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
