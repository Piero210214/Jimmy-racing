// Single player: 4 AI rivals on the grid in the FIRST race, move at the start signal, and are all still there after "Repetir".
const { chromium } = require('playwright'); const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const check = (n, ok, i) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (i != null ? '  [' + i + ']' : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '../dist/jimmy-racing.html') + '#q=low');
  await p.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 180000 });
  const snap = () => p.evaluate(() => ({ st: game.state, n: game.sim.cars.length, ai: game.sim.cars.filter((c) => !c.isPlayer).length, gfx: game.gfx.cars ? game.gfx.cars.length : null,
    vis: game.sim.cars.map((c) => Math.round(c.vehicle.y)), grid: game.sim.cars.map((c) => c.race.grid), sp: game.sim.cars.filter((c) => !c.isPlayer).map((c) => Math.round(c.vehicle.speedKmh)), t: game.sim.state }));
  for (const round of ['first race', 'after restart']) {
    if (round === 'first race') await p.evaluate(() => game.startEvent('race')); else await p.evaluate(() => game.onAction('restart'));
    await p.waitForFunction(() => game.sim && game.sim.cars.length > 1 && (game.state === 'intro' || game.state === 'countdown'), null, { timeout: 120000 });
    const s0 = await snap(); check(round + ': 5 cars (player + 4 AI) on the grid before the start', s0.n === 5 && s0.ai === 4 && new Set(s0.grid).size === 5, JSON.stringify(s0.grid));
    check(round + ': all cars have a renderable gfx entry', s0.gfx == null || s0.gfx === 5, s0.gfx);
    await p.waitForFunction(() => game.sim.state === 'racing', null, { timeout: 180000 }); await p.waitForFunction(() => game.sim.t > 8, null, { timeout: 240000 });
    const s1 = await snap(); check(round + ': rivals drive at the start signal', s1.sp.every((v) => v > 15), s1.sp.join(','));
  }
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL SINGLE-PLAYER BROWSER TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
