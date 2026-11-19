// Crash visuals in the real renderer: thresholded debris, pilot animation lasting exactly 3.0 s of sim time, auto-clean, rival cars present.
const { chromium } = require('playwright'); const path = require('path');
let fails = 0; const check = (n, ok, i) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (i != null ? '  [' + i + ']' : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } }), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '../dist/jimmy-racing.html') + '#q=low');
  await p.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 240000 });
  await p.evaluate(() => game.startEvent('race')); await p.waitForFunction(() => game.sim && game.state === 'intro', null, { timeout: 120000 });
  await p.waitForFunction(() => game.sim.state === 'racing' && game.sim.t > 2, null, { timeout: 240000 });
  // 1) tiers: replay hit events of increasing severity on the player and count debris
  const tier = (speed, wall, obst) => p.evaluate(([speed, wall, obst]) => { const d = game.debris; d.clear(); const c = game.player, v = c.vehicle; d._now = 100 + Math.random() * 1000;
    game.fx.update(0.001, { cars: game.sim.cars, gfx: game.gfx, env: game.env, track: game.track, events: [{ type: 'hit', car: c, speed, wall, obst, x: v.x + 1, y: v.y + 0.5, z: v.z, lp: { x: 1, y: 0 } }], camPos: game.R.camPos, camFwd: game.R.camFwd, groundY: v.y, world: game.world }); return d.list.length; }, [speed, wall, obst]);
  const t0 = await tier(4, true), t1 = await tier(8, true), t2 = await tier(15, true), t3 = await tier(24, true), t4 = await tier(15, false, 'barrel');
  check('impact thresholds: none < small < medium < severe debris', t0 === 0 && t1 > 0 && t2 > t1 && t3 > t2, [t0, t1, t2, t3].join('<'));
  check('obstacle impacts also produce debris', t4 > 0, t4);
  // 2) real sim ejection: drive the player into the rail at speed, watch debris + pilot through the real event pipeline
  const r = await p.evaluate(() => new Promise((res) => { const g = game, sim = g.sim, c = g.player, tr = g.track; const pt = tr.pointAt(1200, 0); c.vehicle.reset(pt.x, pt.z, pt.heading + 0.42, pt.y); c.vehicle.vx = 62; c.vehicle.hint = -1; c.vehicle.locked = false; g.input.reset();
    const out = { pilotSeen: 0, pilotMax: 0, started: 0, ended: 0, t0: null, t1: null, maxDeb: 0, simT0: null }; const iv = setInterval(() => { const d = g.debris; out.pilotMax = Math.max(out.pilotMax, d.pilots.length); out.maxDeb = Math.max(out.maxDeb, d.list.length); out.started = d.stats.pilotsStarted; out.ended = d.stats.pilotsEnded;
      if (c.ejected && out.simT0 == null) out.simT0 = sim.t; if (out.simT0 != null && !c.ejected && out.t1 == null) { out.t1 = sim.t - out.simT0; }
      if (out.t1 != null && out.ended >= 1) { clearInterval(iv); res(out); } }, 100); setTimeout(() => { clearInterval(iv); res(out); }, 200000); }));
  check('severe crash: pilot animation started exactly once, ended exactly once', r.started === 1 && r.ended === 1 && r.pilotMax === 1, JSON.stringify(r));
  check('car held for 3.0 s of simulation time, then restored', r.t1 != null && Math.abs(r.t1 - 3.0) < 0.05, r.t1);
  check('crash produced debris', r.maxDeb >= 8, r.maxDeb);
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/a7bc035b-2d02-5db6-bb14-96601bd05d5e/scratchpad/crash_after.png' });
  // 3) auto-clean: no debris left after its lifetime; no leaked pilots
  await p.evaluate(() => { game.debris.list.forEach((x) => x.age = 9.9); }); await p.waitForTimeout(3000);
  const left = await p.evaluate(() => ({ deb: game.debris.list.length, pil: game.debris.pilots.length, cars: game.sim.cars.length, ej: game.sim.cars.filter((c) => c.ejected).length }));
  check('temporary debris is cleaned up automatically; no stuck pilot/ejected car', left.deb === 0 && left.pil === 0 && left.ej === 0 && left.cars === 5, JSON.stringify(left));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ')); await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL CRASH VISUAL TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
