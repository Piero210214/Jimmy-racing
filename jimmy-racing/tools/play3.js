const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const logs = []; page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('file://' + path.resolve(__dirname, '../dist/jimmy-racing.html') + '#q=low');
  await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 120000 });
  // real clicks through the UI
  await page.click('[data-val="race"]'); await page.waitForTimeout(300);
  console.log('setup ui', await page.evaluate(() => game.ui.screen));
  await page.click('[data-act="car"][data-val="titan"]'); await page.click('[data-act="paint"][data-val="3"]');
  await page.selectOption('[data-set="weather"]', 'rain'); await page.selectOption('[data-set="laps"]', '1'); await page.selectOption('[data-set="rivals"]', '3');
  console.log('settings', await page.evaluate(() => JSON.stringify([game.settings.carId, game.settings.weather, game.settings.laps, game.settings.rivals, game.env.rain])));
  await page.click('[data-act="start"]');   // quali is on by default
  await page.waitForFunction(() => game.state === 'prestart', null, { timeout: 60000 }); await page.evaluate(() => { game.preT = 3.1; });
  await page.waitForFunction(() => game.state === 'quali', null, { timeout: 60000 }); console.log('quali running', await page.evaluate(() => game.sim.state));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); console.log('pause screen', await page.evaluate(() => game.ui.screen + ' paused=' + game.paused));
  await page.click('[data-act="resume"]'); await page.waitForTimeout(300); console.log('resumed', await page.evaluate(() => game.paused));
  // finish quali by teleport: 2 laps
  await page.evaluate(() => { const g = game, tr = g.track, c = g.player; for (let k = 0; k < 2; k++) { } c.race.lapsDone = 1; c.race.lapTimes = [120.5]; c.race.started = true; const s = tr.length - 30, p = tr.pointAt(s, 0), i = Math.round(s / tr.ds); c.vehicle.reset(p.x, p.z, tr.line.heading[i], p.y); c.vehicle.vx = 55; c.vehicle.gear = 5; c.race.dist = 2 * tr.length - 30; c.race.nextCp = 8; c.race.lastS = s; c.race.lapStartT = g.sim.t - 100; });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => game.ui.screen === 'qualiSummary', null, { timeout: 120000 }); await page.keyboard.up('ArrowUp');
  console.log('quali summary', await page.evaluate(() => document.querySelector('.tbl').innerText.replace(/\n/g, ' | ').slice(0, 200)));
  await page.screenshot({ path: '/tmp/q_summary.png' });
  await page.click('[data-act="toGrid"]'); await page.waitForFunction(() => game.state === 'intro', null, { timeout: 60000 });
  console.log('grid order', await page.evaluate(() => game.sim.ordered.map(c => c.name).join(',')));
  await page.evaluate(() => game.enterMenu());
  // settings: ultra quality live
  await page.click('[data-act="settings"]'); await page.selectOption('[data-set="quality"]', 'ultra'); await page.waitForTimeout(2500);
  console.log('quality', await page.evaluate(() => game.R.q.id + ' ' + game.R.W + 'x' + game.R.H + ' msaa ' + game.R.ms));
  await page.screenshot({ path: '/tmp/q_ultra.png' });
  // time trial
  await page.click('[data-act="back"]'); await page.click('[data-val="tt"]'); await page.click('[data-act="start"]');
  await page.waitForFunction(() => game.state === 'prestart', null, { timeout: 60000 }); console.log('tt ok');
  console.log(logs.slice(0, 10).join('\n') || 'no errors'); await browser.close();
})();
