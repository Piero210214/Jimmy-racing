/* JIMMY RACING - netproto.js : snapshot packing shared by the server (Node) and the browser client. */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window);
  G.JR = G.JR || {};
  var JR = G.JR;
  var TAU = Math.PI * 2;

  // [field, decimals, kind]  kind: 'a' = angle (interpolate on the circle), undefined = linear
  var VEH = [['x', 3], ['z', 3], ['y', 3], ['heading', 4, 'a'], ['pitch', 3], ['roll', 3], ['heave', 3], ['vx', 2], ['vy', 2], ['r', 3], ['steerAngle', 3], ['throttle', 2], ['brake', 2],
    ['speedKmh', 1], ['rpm', 0], ['skidF', 2], ['skidR', 2], ['wheelSpin', 2], ['damage', 2], ['pitchGround', 3], ['worldVx', 2], ['worldVz', 2], ['groundY', 3], ['slipF', 3], ['slipR', 3]];
  var INTS = [['gear', 0], ['airborne', 1], ['absActive', 2], ['tcActive', 3], ['reversing', 4], ['surf', 5]];       // small ints / flags
  var WHEELS = 4;
  var RACE = [['lapsDone', 0], ['dist', 1], ['place', 0], ['nextCp', 0], ['bestLap', 3], ['finishTime', 3], ['penalty', 1], ['lapStartT', 3]];
  var DZ = ['front', 'rear', 'left', 'right'];
  var NV = VEH.length;

  function rnd(v, d) { if (!isFinite(v)) return 0; var k = Math.pow(10, d); return Math.round(v * k) / k; }

  /* car -> flat array: [pid, veh..., wheel0..3, ints..., finished, race...] */
  function packCar(pid, car) {
    var v = car.vehicle, r = car.race, o = [pid], i;
    for (i = 0; i < NV; i++) o.push(rnd(v[VEH[i][0]] || 0, VEH[i][1]));
    for (i = 0; i < WHEELS; i++) o.push(rnd(((v.wheelAngle[i] % TAU) + TAU) % TAU, 3));
    o.push(v.gear | 0, v.airborne ? 1 : 0, v.absActive ? 1 : 0, v.tcActive ? 1 : 0, v.reversing ? 1 : 0, v.surfaceNow ? v.surfaceNow.id | 0 : 0, r.finished ? 1 : 0);
    for (i = 0; i < RACE.length; i++) { var x = r[RACE[i][0]]; o.push(x == null ? -1 : rnd(x, RACE[i][1])); }
    for (i = 0; i < 4; i++) o.push(rnd(car.damageZones[DZ[i]] || 0, 2));
    return o;
  }
  var OFF_W = 1 + NV, OFF_I = OFF_W + WHEELS, OFF_F = OFF_I + 6, OFF_R = OFF_F + 1, OFF_Z = OFF_R + RACE.length, LEN = OFF_Z + 4;

  /* unpack to a plain state object (no vehicle needed) */
  function unpackCar(a) {
    var s = { pid: a[0], veh: {}, wheels: [a[OFF_W], a[OFF_W + 1], a[OFF_W + 2], a[OFF_W + 3]], gear: a[OFF_I], airborne: a[OFF_I + 1], absActive: a[OFF_I + 2], tcActive: a[OFF_I + 3], reversing: a[OFF_I + 4], surf: a[OFF_I + 5], finished: a[OFF_F] === 1, race: {} }, i;
    for (i = 0; i < NV; i++) s.veh[VEH[i][0]] = a[1 + i];
    for (i = 0; i < RACE.length; i++) { var x = a[OFF_R + i]; s.race[RACE[i][0]] = (x === -1 && (RACE[i][0] === 'bestLap' || RACE[i][0] === 'finishTime')) ? null : x; }
    s.zones = { front: a[OFF_Z], rear: a[OFF_Z + 1], left: a[OFF_Z + 2], right: a[OFF_Z + 3] };
    return s;
  }
  function validPacked(a) { return Array.isArray(a) && a.length === LEN; }
  function angDiff(a, b) { var d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }

  JR.net = { VEH: VEH, NV: NV, LEN: LEN, packCar: packCar, unpackCar: unpackCar, validPacked: validPacked, angDiff: angDiff, TAU: TAU, SNAP_HZ: 24,
    ASSISTS: { full: { abs: true, tc: true, stability: 0.7 }, mid: { abs: true, tc: true, stability: 0 }, none: { abs: false, tc: false, stability: 0 } },
    GRIP: { clear: 1, rain: 0.72, snow: 0.55 }, TIMES: ['noon', 'sunset', 'night'], WEATHERS: ['clear', 'rain', 'snow'], LAPS: [1, 2, 3, 5, 8], MAX_PLAYERS: 5, MAX_ROOM: [2, 3, 4, 5], CIRCUITS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], BOTS: [0, 1, 2, 3], BOT_PID: 1000000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})();
