// Vehicle dynamics sanity tests (no graphics). Run: node tests/vehicle.test.js
require('../src/core/util.js');
require('../src/core/track.js');
require('../src/core/vehicle.js');
const JR = globalThis.JR;
const { Vehicle, CARS } = JR.vehicle;
const track = JR.track.build();
let fails = 0;
function check(name, ok, info) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  [' + info + ']' : ''));
  if (!ok) fails++;
}
const DT = 1 / 120;
function startPose(v, s, d) {
  const p = track.pointAt(s, d || 0);
  v.reset(p.x, p.z, p.heading, p.y);
}
// move a moving car back to a point on the straight without touching its velocities
function teleport(v, s) {
  const p = track.pointAt(s, 0);
  v.x = p.x; v.z = p.z; v.heading = p.heading; v.y = p.y; v.groundY = p.y; v.hint = -1;
}

for (const id of Object.keys(CARS)) {
  const spec = CARS[id];
  // ---- straight-line acceleration ----
  let v = new Vehicle(spec);
  startPose(v, 4890);       // just before the line, main straight
  let t = 0, t100 = null, t200 = null, vmax = 0, finite = true;
  for (let i = 0; i < 120 * 40; i++) {
    v.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, { track, grip: 1 });
    t += DT;
    const kmh = v.vx * 3.6;
    if (t100 == null && kmh >= 100) t100 = t;
    if (t200 == null && kmh >= 200) t200 = t;
    vmax = Math.max(vmax, kmh);
    if (!isFinite(v.x) || !isFinite(v.vx)) { finite = false; break; }
    // stop before the end of straight: reposition on straight to keep accelerating
    const loc = track.locate(v.x, v.z, v.hint);
    if (loc.s > 500 && loc.s < 4000) teleport(v, 4800);
  }
  console.log(`   ${spec.name}: 0-100 ${t100 && t100.toFixed(2)}s, 0-200 ${t200 && t200.toFixed(2)}s, vmax ${vmax.toFixed(0)} km/h gear ${v.gear} rpm ${v.rpm.toFixed(0)}`);
  check(spec.name + ' stays finite', finite);
  check(spec.name + ' 0-100 in 2.8..6.5 s', t100 && t100 > 2.8 && t100 < 6.5, t100 && t100.toFixed(2));
  check(spec.name + ' top speed 240..330 km/h', vmax > 240 && vmax < 330, vmax.toFixed(0));

  // ---- braking from 200 km/h ----
  v = new Vehicle(spec);
  startPose(v, 4890); v.vx = 200 / 3.6; v.gear = 5;
  let dist = 0, tb = 0, x0 = v.x, z0 = v.z;
  while (v.vx > 1 && tb < 15) {
    v.step(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, { track, grip: 1 });
    tb += DT;
  }
  dist = Math.hypot(v.x - x0, v.z - z0);
  console.log(`   ${spec.name}: 200->0 in ${dist.toFixed(0)} m / ${tb.toFixed(1)} s`);
  check(spec.name + ' brakes 200->0 in 90..180 m', dist > 90 && dist < 180, dist.toFixed(0));
  check(spec.name + ' straight braking has no big yaw', Math.abs(v.r) < 0.3 && Math.abs(U_wrap(v.heading - track.pointAt(4890, 0).heading)) < 0.35);

  // ---- steady-state cornering: skidpad-like (hold lock at 60 km/h) ----
  v = new Vehicle(spec);
  startPose(v, 4890); v.vx = 90 / 3.6; v.gear = 3;
  let maxLat = 0;
  for (let i = 0; i < 120 * 6; i++) {
    // proportional speed hold
    const thr = v.vx < 90 / 3.6 ? 0.45 : 0.0;
    v.step(DT, { throttle: thr, brake: 0, steer: 0.55, handbrake: 0 }, { track, grip: 1 });
    maxLat = Math.max(maxLat, Math.abs(v.ay) / 9.81);
    // keep on the straight region for the test: teleport pose but keep dynamics
    const p = track.locate(v.x, v.z, v.hint);
    if (Math.abs(p.d) > 40) { const h = v.heading; teleport(v, 4890); v.heading = h; }
  }
  console.log(`   ${spec.name}: max lateral ${maxLat.toFixed(2)} g (steer 0.55 @90km/h)`);
  check(spec.name + ' lateral grip 0.85..1.9 g', maxLat > 0.85 && maxLat < 1.9, maxLat.toFixed(2));
}

// ---- grip: wet and grass reduce lateral grip ----
{
  function latG(grip) {
    const v = new Vehicle(CARS.vortex);
    startPose(v, 4890); v.vx = 70 / 3.6; v.gear = 3;
    let m = 0;
    for (let i = 0; i < 120 * 4; i++) {
      v.step(DT, { throttle: v.vx < 70 / 3.6 ? 0.4 : 0, brake: 0, steer: 0.6, handbrake: 0 }, { track, grip });
      m = Math.max(m, Math.abs(v.ay) / 9.81);
      const p = track.locate(v.x, v.z, v.hint); if (Math.abs(p.d) > 40) { const h = v.heading; teleport(v, 4890); v.heading = h; }
    }
    return m;
  }
  const dry = latG(1), wet = latG(0.72);
  check('wet grip lowers cornering g', wet < dry * 0.9, `dry ${dry.toFixed(2)} wet ${wet.toFixed(2)}`);
}

// ---- handbrake produces rotation ----
{
  const v = new Vehicle(CARS.vortex);
  startPose(v, 4890); v.vx = 90 / 3.6; v.gear = 4;
  for (let i = 0; i < 60; i++) v.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, { track, grip: 1 });
  let yawMax = 0;
  for (let i = 0; i < 120; i++) {
    v.step(DT, { throttle: 0, brake: 0, steer: 0.6, handbrake: 1 }, { track, grip: 1 });
    yawMax = Math.max(yawMax, Math.abs(v.r));
  }
  check('handbrake + steer induces a drift (yaw rate > 0.8 rad/s)', yawMax > 0.8, yawMax.toFixed(2));
}

// ---- reverse works ----
{
  const v = new Vehicle(CARS.titan);
  startPose(v, 4890);
  for (let i = 0; i < 120 * 3; i++) v.step(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, { track, grip: 1 });
  check('holding brake at standstill engages reverse', v.vx < -1, 'vx ' + v.vx.toFixed(2));
}

function U_wrap(a) { return JR.util.wrapAngle(a); }
console.log(fails ? `\n${fails} FAILED` : '\nALL VEHICLE TESTS PASSED');
process.exit(fails ? 1 : 0);
