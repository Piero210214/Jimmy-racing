// usage: node tools/shot.js out.png '{"s":0,"quality":"high"}' [w] [h]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '/tmp/shot.png';
  const o = JSON.parse(process.argv[3] || '{}');
  const w = +(process.argv[4] || 1280), h = +(process.argv[5] || 720);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + require('path').resolve(__dirname, 'dev.html'));
  const boot = await page.evaluate((o) => { try { return window.boot(o); } catch (e) { return { error: e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n') }; } }, o);
  console.log('boot', JSON.stringify(boot));
  if (!boot.error) {
    const r = await page.evaluate((o) => { try { return window.shot(o); } catch (e) { return { error: e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n') }; } }, o);
    console.log('shot', JSON.stringify(r));
    await page.screenshot({ path: out });
  }
  logs.slice(0, 15).forEach(l => console.log(l));
  await browser.close();
})();
