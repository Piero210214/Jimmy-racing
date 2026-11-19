/* JIMMY RACING - env.js : time-of-day x weather presets + quality presets */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var U = JR.util;

  var QUALITY = {
    ultra:  { id: 'ultra',  name: 'Ultra', texRes: 1024, aniso: 16, shadowRes: 4096, cascades: 3, cascR: [26, 105, 420], msaa: 4, bloom: true, dof: true, refl: true, trees: 1.0, drawDist: 2600, treeDist: 900,
              particles: 1.0, scale: 1.0, skid: true, fogQuality: 1, terrainStep: 1, lodBias: 1.0, grass: 1.0 },
    high:   { id: 'high',   name: 'Alta',  texRes: 1024, aniso: 8,  shadowRes: 2048, cascades: 3, cascR: [28, 110, 380], msaa: 4, bloom: true, dof: false, refl: true, trees: 0.7, drawDist: 2200, treeDist: 700,
              particles: 0.8, scale: 1.0, skid: true, fogQuality: 1, terrainStep: 1, lodBias: 0.85, grass: 0.7 },
    medium: { id: 'medium', name: 'Media', texRes: 512,  aniso: 4,  shadowRes: 2048, cascades: 2, cascR: [32, 150], msaa: 2, bloom: true, dof: false, refl: false, trees: 0.4, drawDist: 1700, treeDist: 500,
              particles: 0.55, scale: 1.0, skid: true, fogQuality: 0, terrainStep: 1, lodBias: 0.65, grass: 0.4 },
    low:    { id: 'low',    name: 'Baja',  texRes: 256,  aniso: 1,  shadowRes: 1024, cascades: 1, cascR: [70], msaa: 0, bloom: false, dof: false, refl: false, trees: 0.18, drawDist: 1100, treeDist: 300,
              particles: 0.3, scale: 0.85, skid: false, fogQuality: 0, terrainStep: 2, lodBias: 0.45, grass: 0 }
  };

  function v3(a, b, c) { return [a, b, c]; }
  function mixv(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mulv(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* time: 'noon' | 'sunset' | 'night'; weather: 'clear' | 'rain' | 'snow' */
  function make(time, weather) {
    var e = { time: time, weather: weather };
    var az = 2.2, el;
    if (time === 'noon') el = 54; else if (time === 'sunset') el = 6.5; else el = 38;
    var elr = el * Math.PI / 180;
    var sun = norm([Math.cos(az) * Math.cos(elr), Math.sin(elr), Math.sin(az) * Math.cos(elr)]);
    e.sunDir = sun;
    e.moonDir = norm([-Math.cos(az + 0.8) * Math.cos(0.6), Math.sin(0.6), -Math.sin(az + 0.8) * Math.cos(0.6)]);
    var night = time === 'night' ? 1 : 0;
    e.night = night;
    if (time === 'noon') {
      e.sunCol = mulv([1.0, 0.95, 0.85], 3.7); e.skyZen = [0.10, 0.25, 0.62]; e.skyHor = [0.58, 0.72, 0.92]; e.ground = [0.12, 0.13, 0.09];
      e.skyAmb = [0.34, 0.46, 0.70]; e.amb = 0.62; e.fogCol = [0.62, 0.74, 0.90]; e.fogDen = 0.00022; e.exposure = 0.92; e.cloudCol = [1, 1, 1];
    } else if (time === 'sunset') {
      e.sunCol = mulv([1.0, 0.52, 0.22], 3.4); e.skyZen = [0.10, 0.17, 0.42]; e.skyHor = [1.0, 0.50, 0.24]; e.ground = [0.10, 0.07, 0.05];
      e.skyAmb = [0.40, 0.33, 0.42]; e.amb = 0.55; e.fogCol = [0.95, 0.55, 0.34]; e.fogDen = 0.00042; e.exposure = 1.0; e.cloudCol = [1.0, 0.66, 0.5];
    } else {
      e.sunCol = mulv([0.35, 0.45, 0.80], 0.55); e.skyZen = [0.006, 0.012, 0.04]; e.skyHor = [0.03, 0.05, 0.10]; e.ground = [0.012, 0.014, 0.02];
      e.skyAmb = [0.05, 0.07, 0.14]; e.amb = 0.85; e.fogCol = [0.028, 0.04, 0.075]; e.fogDen = 0.00045; e.exposure = 1.25; e.cloudCol = [0.06, 0.08, 0.14];
      e.sunDir = e.moonDir;
    }
    e.cloud = 0.30; e.wet = 0; e.snow = 0; e.rain = 0; e.grip = 1; e.fogSun = 0.25; e.fogHF = 0.0045; e.fogBase = 0;
    e.bloom = 0.9; e.sat = 1.08; e.tint = [1, 1, 1]; e.contrast = 1.06; e.wind = [1, 0.4]; e.thresh = 1.1; e.name = '';
    if (weather === 'rain') {
      e.cloud = 0.97; e.wet = 1; e.rain = 1; e.grip = 0.72; e.sunCol = mulv(e.sunCol, 0.22); e.fogDen *= 3.4; e.fogSun = 0.04;
      var g = night ? 0.6 : 0.52;
      e.skyZen = mixv(e.skyZen, mulv([0.42, 0.46, 0.52], night ? 0.05 : 0.55), 0.85); e.skyHor = mixv(e.skyHor, mulv([0.58, 0.62, 0.66], night ? 0.06 : g), 0.85);
      e.fogCol = mixv(e.fogCol, mulv([0.55, 0.59, 0.63], night ? 0.06 : 0.5), 0.85); e.skyAmb = mixv(e.skyAmb, mulv([0.42, 0.46, 0.5], night ? 0.12 : 0.6), 0.7);
      e.cloudCol = mulv(e.cloudCol, 0.42); e.sat = 0.85; e.wind = [2.2, 0.8]; e.amb *= 1.05;
    } else if (weather === 'snow') {
      e.cloud = 0.88; e.snow = 1; e.rain = 0; e.grip = 0.55; e.sunCol = mulv(e.sunCol, 0.35); e.fogDen *= 3.0; e.fogSun = 0.08; e.wet = 0.25;
      e.skyZen = mixv(e.skyZen, mulv([0.55, 0.60, 0.68], night ? 0.06 : 0.62), 0.85); e.skyHor = mixv(e.skyHor, mulv([0.72, 0.76, 0.82], night ? 0.08 : 0.72), 0.85);
      e.fogCol = mixv(e.fogCol, mulv([0.72, 0.76, 0.82], night ? 0.07 : 0.68), 0.85); e.skyAmb = mixv(e.skyAmb, mulv([0.6, 0.64, 0.7], night ? 0.15 : 0.8), 0.8);
      e.cloudCol = mulv(e.cloudCol, 0.6); e.sat = 0.78; e.amb *= 1.15; e.wind = [1.2, 0.6];
    }
    if (time === 'sunset' && weather !== 'clear') e.sunCol = mulv(e.sunCol, 0.8);
    e.fogUp = 1;
    return e;
  }

  /* scenario look: colour/fog/exposure overrides on top of the time-of-day + weather model */
  function applyScene(e, sc) {
    var o = sc && sc.env; if (!o) return e;
    if (o.sky) e.skyZen = o.sky.slice(); if (o.hor) { e.skyHor = o.hor.slice(); }
    if (o.fogCol) e.fogCol = o.fogCol.slice(); if (o.fogMul) e.fogDen *= o.fogMul;
    if (o.sat) e.sat *= o.sat; if (o.exposure) e.exposure = o.exposure; if (o.neon) e.bloom *= 1.35;
    e.scene = sc.id; return e;
  }
  JR.env = { QUALITY: QUALITY, make: make, applyScene: applyScene };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
