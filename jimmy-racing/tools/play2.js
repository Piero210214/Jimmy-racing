// scenario tests: node tools/play2.js
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const logs = []; page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('file://' + path.resolve(__dirname, '../dist/jimmy-racing.html') + '#q=low');
  await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 120000 });
  const shot = async n => { await page.screenshot({ path: '/tmp/h_' + n + '.png' }); };
  await page.waitForTimeout(800); await shot('menu');
  // 1. night + rain, drive in the tunnel via teleport
  await page.evaluate(() => { const s = game.settings; s.time = 'night'; s.weather = 'rain'; s.quali = false; s.rivals = 3; s.laps = 1; game.onAction('start', 'race'); });
  await page.waitForFunction(() => game.state === 'intro', null, { timeout: 120000 }); await page.evaluate(() => { game.introT = 6; }); await page.waitForFunction(() => game.state === 'race', null, { timeout: 120000 }); await page.evaluate(() => { const s = game.sim; s.state = 'racing'; s.lights = 0; s.t = 0; s.cars.forEach(c => c.vehicle.locked = false); });
  await page.waitForTimeout(1200); await shot('night_rain');
  await page.evaluate(() => { const g = game, tr = g.track, t = tr.features.tunnel, c = g.player, p = tr.pointAt(t.s0 + 40, 0), i = Math.round((t.s0 + 40) / tr.ds); c.vehicle.reset(p.x, p.z, tr.line.heading[i], p.y); c.vehicle.vx = 30; c.vehicle.gear = 3; g.cam.snapTo(c); });
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2500); await shot('tunnel');
  await page.keyboard.up('ArrowUp');
  // 2. snow sunset
  await page.evaluate(() => { const s = game.settings; s.time = 'sunset'; s.weather = 'snow'; game.startEvent('race'); });
  await page.waitForFunction(() => game.state === 'intro', null, { timeout: 120000 }); await page.evaluate(() => { game.introT = 6; }); await page.waitForFunction(() => game.state === 'race', null, { timeout: 120000 }); await page.evaluate(() => { const s = game.sim; s.state = 'racing'; s.lights = 0; s.t = 0; s.cars.forEach(c => c.vehicle.locked = false); });
  await page.evaluate(() => { const g = game, tr = g.track, c = g.player, s = 330 - 25, p = tr.pointAt(s, 0), i = Math.round(s / tr.ds); c.vehicle.reset(p.x, p.z, tr.line.heading[i], p.y); c.vehicle.vx = 40; c.vehicle.gear = 4; g.cam.snapTo(c); });
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2500); await shot('snow_bridge'); await page.keyboard.up('ArrowUp');
  // 3. finish quickly: teleport near the line on the last lap
  await page.evaluate(() => { const g = game, tr = g.track, c = g.player, s = tr.length - 40, p = tr.pointAt(s, 0), i = Math.round(s / tr.ds); c.vehicle.reset(p.x, p.z, tr.line.heading[i], p.y); c.vehicle.vx = 50; c.vehicle.gear = 5; c.race.dist = tr.length * 1 - 40; c.race.nextCp = 8; c.race.lastS = s; c.race.cpTimes = [1,2,3,4,5,6,7]; g.sim.respawn && 0; });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => game.state === 'results', null, { timeout: 120000 }).catch(() => logs.push('no results; state=' + 0));
  await page.keyboard.up('ArrowUp'); await page.waitForTimeout(500); await shot('results');
  console.log('state', await page.evaluate(() => game.state + ' place ' + (game.resultData && game.resultData.place)));
  await page.evaluate(() => game.onAction('podium')); await page.waitForTimeout(3000); await shot('podium');
  console.log(logs.slice(0, 10).join('\n') || 'no errors'); await browser.close();
})();
