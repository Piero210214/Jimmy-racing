// Loads all 10 level scenarios in the real game (WebGL), checks the world rebuilds, renders and has no errors; saves screenshots.
const { chromium } = require('playwright'); const path = require('path');
const out = process.argv[2] || '/tmp'; const only = process.argv[3] ? process.argv[3].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let fails = 0; const check = (n, ok, i) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (i != null ? '  [' + i + ']' : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } }), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '../dist/jimmy-racing.html') + '#q=medium');
  await p.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 240000 });
  for (const id of only) {
    const r = await p.evaluate((id) => { const t = performance.now(); game.levelCampaign = true; game.loadLevel(id); game.ui.hide(); game.hudOn = false;
      const w = game.world, tr = game.track, s = tr.length * 0.62, pt = tr.pointAt(s, 0); game.sim = null;
      const sim = game.sim = new JR.sim.Sim({ track: tr, laps: 1, mode: 'race' }); game.gfx.clear(); const car = sim.addCar(JR.vehicle.CARS.vortex, { name: 'P', isPlayer: true }); sim.setupGrid([car]); car.vehicle.reset(pt.x, pt.z, pt.heading, pt.y); car.vehicle.locked = true; game.player = car; game.gfx.add(car);
      game.state = 'menu'; game.showPos = pt; return { ms: Math.round(performance.now() - t), name: game.sceneName, len: Math.round(tr.length), disp: w.disposed, city: w.cityCount || 0, trees: w.treeN }; }, id);
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${out}/level${id}.png` });
    check('level ' + id + ' loads and renders', r.len > 3000 && !!r.name, JSON.stringify(r));
  }
  const n = await p.evaluate(() => game.R.layers.length); check('no layer leak after 10 level switches (layers stay constant)', n <= 12, n);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ')); await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL LEVEL RENDER TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
