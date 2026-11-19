/* JIMMY RACING - road obstacle visuals (one prebuilt mesh per kind, drawn at each obstacle's simulated pose). */
(function () {
  'use strict';
  var JR = window.JR = window.JR || {};
  var GL = JR.gl, Geo = GL.Geo, P = GL.P, A = GL.A;
  var PLASTIC = [[1.0, 0.30, 0.02, 1], [1.0, 0.72, 0.02, 1], [0.03, 0.18, 0.85, 1], [0.03, 0.55, 0.14, 1]];
  var ORANGE = [1.0, 0.24, 0.015, 1], WHITE = [0.85, 0.85, 0.82, 1], BLACK = [0.02, 0.02, 0.022, 1], RED = [0.78, 0.04, 0.03, 1];

  function cone() {
    var g = new Geo();
    g.append(P.box(0.5, 0.045, 0.5, [0.03, 0.03, 0.03, 1]), A.trs(0, 0.0225, 0, 0));
    g.append(P.cylinder(0.035, 0.2, 0.7, 20, ORANGE), A.trs(0, 0.045, 0, 0));
    function r(y) { return 0.2 - 0.165 / 0.7 * y; }
    g.append(P.cylinder(r(0.4) + 0.004, r(0.3) + 0.004, 0.1, 20, WHITE), A.trs(0, 0.045 + 0.3, 0, 0));
    g.append(P.cylinder(r(0.57) + 0.003, r(0.5) + 0.003, 0.07, 20, WHITE), A.trs(0, 0.045 + 0.5, 0, 0));
    return g;
  }
  function barrel() {
    var g = new Geo();
    g.append(P.cylinder(0.29, 0.3, 0.9, 24, RED), A.trs(0, 0, 0, 0));
    g.append(P.cylinder(0.296, 0.296, 0.12, 24, WHITE), A.trs(0, 0.2, 0, 0));
    g.append(P.cylinder(0.296, 0.296, 0.12, 24, WHITE), A.trs(0, 0.58, 0, 0));
    g.append(P.cylinder(0.31, 0.31, 0.035, 24, [0.5, 0.02, 0.02, 1]), A.trs(0, 0.43, 0, 0));
    return g;
  }
  function tyres() {
    var g = new Geo(), i;
    for (i = 0; i < 3; i++) {
      g.append(P.cylinder(0.43, 0.46, 0.2, 28, i === 1 ? [0.55, 0.55, 0.52, 1] : [0.03, 0.03, 0.035, 1]), A.trs(0, i * 0.2, 0, i * 0.7));
      g.append(P.cylinder(0.25, 0.25, 0.205, 20, [0.01, 0.01, 0.012, 1], { capTop: false, capBottom: false }), A.trs(0, i * 0.2, 0, 0));
    }
    g.append(P.cylinder(0.28, 0.3, 0.02, 24, [0.01, 0.01, 0.012, 1]), A.trs(0, 0.6, 0, 0));
    return g;
  }
  function plastic(c) {
    var g = new Geo(), col = PLASTIC[c % 4];
    g.append(P.box(0.5, 0.78, 1.15, col), A.trs(0, 0.39, 0, 0));
    g.append(P.box(0.52, 0.11, 1.17, WHITE), A.trs(0, 0.44, 0, 0));
    g.append(P.box(0.62, 0.1, 1.25, col), A.trs(0, 0.05, 0, 0));
    g.append(P.cylinder(0.07, 0.07, 0.03, 12, [0.05, 0.05, 0.05, 1]), A.trs(0, 0.78, 0.35, 0));
    return g;
  }
  function barrier() {
    var g = new Geo(), i;
    for (i = 0; i < 6; i++) g.append(P.box(0.2, 0.34, 0.5, i % 2 ? WHITE : RED), A.trs(0, 0.46, -0.6 + i * 0.24, 0));
    for (i = -1; i <= 1; i += 2) { g.append(P.box(0.07, 0.34, 0.07, [0.1, 0.1, 0.1, 1]), A.trs(0, 0.17, i * 0.55, 0)); g.append(P.box(0.45, 0.05, 0.07, [0.1, 0.1, 0.1, 1]), A.trs(0, 0.025, i * 0.55, 0)); }
    g.append(P.box(0.26, 0.05, 1.5, [0.1, 0.1, 0.1, 1]), A.trs(0, 0.29, 0, 0));
    return g;
  }
  function block() {
    var g = new Geo(), conc = [0.52, 0.52, 0.5, 1], i;
    g.append(P.box(0.78, 0.34, 3.4, conc), A.trs(0, 0.17, 0, 0));
    g.append(P.box(0.52, 0.62, 3.4, conc), A.trs(0, 0.65, 0, 0));
    g.append(P.box(0.3, 0.1, 3.4, [0.46, 0.46, 0.44, 1]), A.trs(0, 0.99, 0, 0));
    for (i = 0; i < 6; i++) { var yel = i % 2 === 0; g.append(P.box(0.545, 0.2, 0.3, yel ? [0.95, 0.7, 0.02, 1] : [0.03, 0.03, 0.03, 1]), A.trs(0, 0.72, -1.4 + i * 0.28, 0)); g.append(P.box(0.545, 0.2, 0.3, yel ? [0.95, 0.7, 0.02, 1] : [0.03, 0.03, 0.03, 1]), A.trs(0, 0.72, 1.4 - i * 0.28, 0)); }
    return g;
  }

  function ObstaclesGfx(R) {
    var self = this; this.R = R; this.list = []; this.mesh = {};
    var eng = R.eng;
    this.mesh.cone = eng.mesh(cone()); this.mesh.barrel = eng.mesh(barrel()); this.mesh.tyres = eng.mesh(tyres());
    this.mesh.plastic = [0, 1, 2, 3].map(function (c) { return eng.mesh(plastic(c)); });
    this.mesh.barrier = eng.mesh(barrier()); this.mesh.block = eng.mesh(block());
    this.mat = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.55, metal: 0, spec: 0.6 });
    this.matConc = R.material({ tex: 'white', base: [1, 1, 1, 1], rough: 0.92, metal: 0, spec: 0.25 });
    this.xf = new Float32Array(12);
    this.layer = {
      drawShadow: function (R2) { self._draw(R2, true); },
      drawOpaque: function (R2) { self._draw(R2, false); }
    };
    R.addLayer(this.layer);
  }
  ObstaclesGfx.prototype.set = function (list) { this.list = list || []; };
  ObstaclesGfx.prototype._draw = function (R, shadow) {
    var L = this.list, cp = R.camPos;
    for (var i = 0; i < L.length; i++) {
      var o = L[i], dx = cp ? o.x - cp[0] : 0, dz = cp ? o.z - cp[2] : 0, d2 = dx * dx + dz * dz;
      if (d2 > (shadow ? 150 * 150 : 420 * 420)) continue;
      if (!R.visible({ x: o.x, y: o.y + 0.5, z: o.z, r: o.parts ? 2.2 : 1.0 })) continue;
      var m = o.k === 'plastic' ? this.mesh.plastic[o.color | 0] : this.mesh[o.k];
      var lift = o.tilt ? Math.sin(Math.min(1.5, o.tilt)) * (o.k === 'cone' ? 0.2 : 0.3) : 0;
      A.compose(this.xf, 0, o.x, (o.y || 0) + lift, o.z, o.tilt ? o.tiltDir : o.ang, o.tilt || 0, 0, 1);
      if (o.tilt && o.hitT <= 0 && o.k !== 'cone') { /* settle */ }
      R.drawMesh(m, this.xf, null, o.k === 'block' ? this.matConc : this.mat);
    }
  };
  JR.ObstaclesGfx = ObstaclesGfx;
})();
