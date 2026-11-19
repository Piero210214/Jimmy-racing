/* JIMMY RACING - item visuals: rotating item boxes, missiles, traps, shield bubble. Poses come from the Sim. */
(function () {
  'use strict';
  var JR = window.JR = window.JR || {};
  var GL = JR.gl, Geo = GL.Geo, P = GL.P, A = GL.A;

  function boxTextures(eng) {
    var cv = document.createElement('canvas'); cv.width = cv.height = 256; var c = cv.getContext('2d');
    var g = c.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, '#ff4fd8'); g.addColorStop(0.35, '#4f8bff'); g.addColorStop(0.7, '#3dffb0'); g.addColorStop(1, '#ffd93d');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 14; c.strokeRect(10, 10, 236, 236);
    c.fillStyle = '#fff'; c.font = '900 190px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 128, 138);
    var cm = document.createElement('canvas'); cm.width = cm.height = 256; var d = cm.getContext('2d');   // rough in B, emission mask in A (the "?")
    d.clearRect(0, 0, 256, 256); d.fillStyle = 'rgba(0,0,90,0.55)'; d.fillRect(0, 0, 256, 256);
    d.fillStyle = '#fff'; d.font = '900 190px Arial'; d.textAlign = 'center'; d.textBaseline = 'middle'; d.fillText('?', 128, 138);
    return { t0: eng.canvasTexture(cv, { clamp: true }), t1: eng.canvasTexture(cm, { clamp: true }) };
  }
  function missileGeo() {
    var g = new Geo(), W = [0.92, 0.92, 0.9, 1], Rd = [0.85, 0.06, 0.04, 1], K = [0.05, 0.05, 0.06, 1];
    g.append(P.cylinder(0.2, 0.2, 1.2, 18, W), A.trs(0, 0, -0.55, 0, 1, 1, 1, Math.PI / 2, 0));
    g.append(P.cylinder(0.01, 0.2, 0.55, 18, Rd), A.trs(0, 0, 0.62, 0, 1, 1, 1, Math.PI / 2, 0));
    g.append(P.cylinder(0.205, 0.205, 0.12, 18, Rd), A.trs(0, 0, -0.2, 0, 1, 1, 1, Math.PI / 2, 0));
    for (var i = 0; i < 4; i++) g.append(P.box(0.04, 0.34, 0.4, K), A.trs(Math.cos(i * Math.PI / 2) * 0.24, Math.sin(i * Math.PI / 2) * 0.24, -1.0, 0, 1, 1, 1, 0, i * Math.PI / 2));
    return g;
  }
  function trapGeo() {
    var g = new Geo(), i;
    g.append(P.cylinder(1.9, 1.9, 0.05, 28, [0.02, 0.02, 0.025, 1]), A.trs(0, 0.0, 0, 0));
    g.append(P.cylinder(1.5, 1.5, 0.07, 28, [0.9, 0.62, 0.02, 1]), A.trs(0, 0.0, 0, 0));
    g.append(P.cylinder(1.25, 1.25, 0.09, 28, [0.03, 0.03, 0.035, 1]), A.trs(0, 0.0, 0, 0));
    for (i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; g.append(P.cylinder(0.01, 0.17, 0.5, 8, [0.75, 0.78, 0.8, 1]), A.trs(Math.cos(a) * 0.75, 0.05, Math.sin(a) * 0.75, 0)); }
    g.append(P.cylinder(0.01, 0.22, 0.7, 10, [0.95, 0.2, 0.05, 1]), A.trs(0, 0.05, 0, 0));
    return g;
  }

  function ItemsGfx(R) {
    var self = this, eng = R.eng; this.R = R; this.sim = null; this.t = 0;
    var tx = boxTextures(eng);
    this.boxMesh = eng.mesh(P.box(1.25, 1.25, 1.25, [1, 1, 1, 1]));
    this.boxMat = R.material({ t0: tx.t0, t1: tx.t1, rough: 0.4, metal: 0.1, emis: [0.5, 0.5, 0.45], emisMask: true, spec: 1 });
    this.glowMesh = eng.mesh(P.sphere(1.05, 18, 12, [1, 1, 1, 1]));
    this.glowMat = R.material({ tex: 'white', base: [0.55, 0.75, 1.0, 0.07], emis: [0.06, 0.1, 0.18], blend: 'add', depthWrite: false, castShadow: false, cull: false });
    this.misMesh = eng.mesh(missileGeo());
    this.misMat = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.35, metal: 0.4, emis: [0.05, 0.02, 0.0], emisMask: true });
    this.trapMesh = eng.mesh(trapGeo());
    this.trapMat = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.5, metal: 0.3, castShadow: false });
    this.shieldMesh = eng.mesh(P.sphere(1, 28, 18, [1, 1, 1, 1]));
    this.shieldMat = R.material({ tex: 'white', base: [0.25, 0.65, 1.0, 0.22], emis: [0.05, 0.3, 0.7], blend: 'alpha', depthWrite: false, castShadow: false, cull: false });
    this.xf = new Float32Array(12);
    this.layer = {
      drawShadow: function (R2) { self._shadow(R2); },
      drawOpaque: function (R2) { self._opaque(R2); },
      drawTransparent: function (R2) { self._transparent(R2); }
    };
    R.addLayer(this.layer);
  }
  ItemsGfx.prototype.set = function (sim, dt) { this.sim = sim && sim.itemsOn ? sim : null; this.t += dt || 0; };
  ItemsGfx.prototype._shadow = function (R) { /* floating boxes / pickups stay out of the sun shadow maps (cheap, avoids acne) */ };
  ItemsGfx.prototype._opaque = function (R) {
    var sim = this.sim; if (!sim) return;
    var cp = R.camPos, i, b, x, z;
    for (i = 0; i < sim.itemBoxes.length; i++) {
      b = sim.itemBoxes[i]; if (!b.on) continue;
      var dx = cp ? b.x - cp[0] : 0, dz = cp ? b.z - cp[2] : 0; if (dx * dx + dz * dz > 450 * 450) continue;
      if (!R.visible({ x: b.x, y: b.y, z: b.z, r: 1.6 })) continue;
      A.compose(this.xf, 0, b.x, b.y + Math.sin(this.t * 2.2 + b.id) * 0.18, b.z, this.t * 1.6 + b.id, 0.42, 0.35, 1);
      R.drawMesh(this.boxMesh, this.xf, null, this.boxMat);
    }
    for (i = 0; i < sim.projectiles.length; i++) {
      var m = sim.projectiles[i]; A.compose(this.xf, 0, m.x, m.y, m.z, m.heading || 0, 0, 0, 1); R.drawMesh(this.misMesh, this.xf, null, this.misMat);
    }
    for (i = 0; i < sim.traps.length; i++) {
      var t = sim.traps[i], fl = t.life < 3 && Math.floor(t.life * 8) % 2 === 0; if (fl) continue;
      A.compose(this.xf, 0, t.x, t.y + 0.03, t.z, t.ang + this.t * 0.8, 0, 0, 1); R.drawMesh(this.trapMesh, this.xf, null, this.trapMat);
    }
  };
  ItemsGfx.prototype._transparent = function (R) {
    var sim = this.sim; if (!sim) return;
    var i, b;
    for (i = 0; i < sim.itemBoxes.length; i++) {
      b = sim.itemBoxes[i]; if (!b.on) continue;
      if (!R.visible({ x: b.x, y: b.y, z: b.z, r: 1.6 })) continue;
      var pul = 1 + Math.sin(this.t * 3 + b.id) * 0.08;
      A.compose(this.xf, 0, b.x, b.y + Math.sin(this.t * 2.2 + b.id) * 0.18, b.z, 0, 0, 0, pul);
      R.drawMesh(this.glowMesh, this.xf, null, this.glowMat);
    }
    for (i = 0; i < sim.cars.length; i++) {
      var c = sim.cars[i]; if (!(c.shieldT > 0)) continue;
      var v = c.vehicle, fl = c.shieldT < 1.5 && Math.floor(c.shieldT * 8) % 2 === 0; if (fl) continue;
      var pul2 = 1 + Math.sin(this.t * 7 + i) * 0.03, M = A.trs(v.x, v.y + 0.7, v.z, v.heading, 1.35 * pul2, 0.95 * pul2, 2.9 * pul2);
      R.drawMesh(this.shieldMesh, M, null, this.shieldMat);
    }
  };
  JR.ItemsGfx = ItemsGfx;
})();
