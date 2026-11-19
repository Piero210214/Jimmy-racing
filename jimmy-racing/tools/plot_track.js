// Dumps track data as JSON for plotting / inspection.
require('../src/core/util.js');
const JR = require('../src/core/track.js');
const t0 = Date.now();
const track = JR.JR ? JR.JR.track.build() : JR.track.build();
const ms = Date.now() - t0;
const fs = require('fs');
const out = {
  length: track.length, N: track.N, ms,
  x: Array.from(track.x), z: Array.from(track.z), y: Array.from(track.y),
  k: Array.from(track.k), lx: Array.from(track.line.x), lz: Array.from(track.line.z),
  lk: Array.from(track.line.k), off: Array.from(track.line.off), w: Array.from(track.width),
  controls: track.controls
};
fs.writeFileSync(process.argv[2] || '/tmp/track.json', JSON.stringify(out));
let maxK = 0, minR = 1e9, maxGrade = 0;
for (let i = 0; i < track.N; i++) {
  maxK = Math.max(maxK, Math.abs(track.k[i]));
  maxGrade = Math.max(maxGrade, Math.abs(track.y[(i + 1) % track.N] - track.y[i]) / track.ds);
}
console.log(JSON.stringify({ length: Math.round(track.length), N: track.N, buildMs: ms, minRadius: Math.round(1 / maxK), maxGradePct: +(maxGrade * 100).toFixed(1) }));
