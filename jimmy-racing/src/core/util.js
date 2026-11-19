/* JIMMY RACING - util.js
 * Pure math helpers shared by the simulation (runs in browser and Node).
 * Conventions used everywhere in the project:
 *   - World axes follow Three.js: +Y up, heading 0 = +Z, forward = (sin h, cos h).
 *   - "Left" vector of heading h is (cos h, -sin h). Lateral offsets are LEFT-positive.
 *   - Yaw rate and steering angle are positive when turning LEFT.
 */
(function () {
  var JR = (typeof globalThis !== 'undefined' ? globalThis : window);
  JR.JR = JR.JR || {};
  var NS = JR.JR;

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function wrapAngle(a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    else if (a < -Math.PI) a += TAU;
    return a;
  }
  /* Frame-rate independent exponential smoothing. */
  function damp(cur, target, lambda, dt) {
    return lerp(cur, target, 1 - Math.exp(-lambda * dt));
  }
  function sign(v) { return v < 0 ? -1 : 1; }

  /* Deterministic RNG (mulberry32). */
  function makeRng(seed) {
    var a = seed >>> 0;
    var rng = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.range = function (lo, hi) { return lo + (hi - lo) * rng(); };
    rng.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * rng()); };
    rng.pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    return rng;
  }

  /* Cheap 2D value noise + fBm (used for terrain & textures; deterministic). */
  function hash2(ix, iz, seed) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function valueNoise(x, z, seed) {
    var ix = Math.floor(x), iz = Math.floor(z);
    var fx = x - ix, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
    var c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }
  function fbm(x, z, seed, octaves) {
    var sum = 0, amp = 0.5, f = 1, norm = 0;
    for (var o = 0; o < (octaves || 4); o++) {
      sum += amp * valueNoise(x * f, z * f, (seed || 0) + o * 101);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm; // 0..1
  }

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.---';
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    var whole = Math.floor(s);
    var ms = Math.round((s - whole) * 1000);
    if (ms === 1000) { ms = 0; whole += 1; if (whole === 60) { whole = 0; m += 1; } }
    return (m < 10 ? '0' : '') + m + ':' + (whole < 10 ? '0' : '') + whole + '.' + ('00' + ms).slice(-3);
  }

  NS.util = {
    TAU: TAU, clamp: clamp, lerp: lerp, smoothstep: smoothstep, wrapAngle: wrapAngle,
    damp: damp, sign: sign, makeRng: makeRng, valueNoise: valueNoise, fbm: fbm, fmtTime: fmtTime
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();
