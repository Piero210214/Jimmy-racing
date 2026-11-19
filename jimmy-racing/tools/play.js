// headless gameplay smoke test: node tools/play.js [quality]
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const q = process.argv[2] || 'low';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  const logs = []; page.on('console', m => { if (m.type() !== 'log' || /error/i.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message + (e.stack ? e.stack.split('\n')[1] : '')));
  await page.goto('file://' + path.resolve(__dirname, '../dist/jimmy-racing.html') + '#q=' + q);
  const t0 = Date.now();
  await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 120000 }).catch(e => logs.push('BOOT TIMEOUT ' + (window.__jrError || '')));
  console.log('boot ms', Date.now() - t0, 'err', await page.evaluate(() => window.__jrError || null));
  const shot = async n => { await page.screenshot({ path: '/tmp/g_' + n + '.png' }); };
  await shot('menu');
  await page.evaluate(() => { game.settings.quali = false; game.settings.rivals = 3; game.settings.laps = 1; game.onAction('setup', 'race'); }); await shot('setup');
  await page.evaluate(() => game.onAction('start', 'race'));
  await page.waitForFunction(() => game.state === 'intro', null, { timeout: 60000 }); await page.waitForTimeout(1500); await shot('intro');
  await page.waitForFunction(() => game.state === 'race', null, { timeout: 90000 });
  await page.waitForFunction(() => game.sim.state === 'racing', null, { timeout: 90000 }); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(6000); await shot('race1');
  const info = await page.evaluate(() => { const v = game.player.vehicle; return { kmh: v.speedKmh, gear: v.gear, place: game.player.race.place, fps: game.fps, t: game.sim.t }; });
  console.log('race', JSON.stringify(info));
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(2500); await shot('race2'); await page.keyboard.up('ArrowLeft');
  console.log('after left', JSON.stringify(await page.evaluate(() => ({ h: game.player.vehicle.heading, kmh: game.player.vehicle.speedKmh }))));
  logs.slice(0, 20).forEach(l => console.log(l)); await browser.close();
})();
