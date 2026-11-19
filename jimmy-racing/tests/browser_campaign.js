// Campaign flow in the real game: menu -> level 1 race (4 AI) -> finish -> stars/unlock persisted -> level 2 unlocked, level 3 locked.
const { chromium } = require('playwright'); const path = require('path');
let fails = 0; const check = (n, ok, i) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (i != null ? '  [' + i + ']' : '')); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '../dist/jimmy-racing.html') + '#q=low');
  await p.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 240000 });
  await p.evaluate(() => { localStorage.removeItem('jr_levels_v1'); game.onAction('campaign'); });
  await p.waitForFunction(() => game.ui.screen === 'campaign', null, { timeout: 60000 });
  const m = await p.evaluate(() => ({ cards: document.querySelectorAll('.lvl').length, locked: document.querySelectorAll('.lvl.lock').length, play: document.querySelectorAll('.lvl button[data-act=lvl]').length }));
  check('campaign screen lists exactly 10 levels; only level 1 playable', m.cards === 10 && m.locked === 9 && m.play === 1, JSON.stringify(m));
  await p.evaluate(() => game.onAction('lvl', '2')); await p.waitForTimeout(500); check('locked level cannot be started', await p.evaluate(() => game.state !== 'intro' && !game.camp));
  await p.evaluate(() => game.onAction('lvl', '1'));
  await p.waitForFunction(() => game.sim && game.state === 'intro' && game.sim.cars.length === 5, null, { timeout: 120000 });
  const r = await p.evaluate(() => ({ laps: game.sim.laps || game.totalLaps, lvl: game.levelId, scene: game.sceneName, ai: game.sim.cars.filter((c) => !c.isPlayer).length, diff: game.settings.diff }));
  check('level 1 starts with its circuit/scene, 3 laps and 4 AI rivals', r.lvl === 1 && r.ai === 4 && r.laps === 3 && r.scene === 'Ciudad moderna' && r.diff === 'easy', JSON.stringify(r));
  // finish the race instantly through the real result path
  await p.evaluate(() => { const sim = game.sim; game.state = 'race'; sim.state = 'racing'; const me = game.player; sim.cars.forEach((c, i) => { c.race.finished = true; c.race.finishTime = 200 + i * 3; c.race.lap = 4; c.race.bestLap = c === me ? 100 : 105; c.race.totalTime = 200 + i * 3; });
    me.race.finishTime = 203; game.heavyHits = 2; game._showResults(); });
  const rd = await p.evaluate(() => ({ screen: game.ui.screen, camp: game.resultData.camp && { stars: game.resultData.camp.stars, unlocked: game.resultData.camp.unlocked, done: game.resultData.camp.eval.completed }, html: !!document.querySelector('.campres'), next: !!document.querySelector('button[data-act=lvl_next]') }));
  check('results show objectives; level completed and next level unlocked', rd.screen === 'results' && rd.camp && rd.camp.done && rd.camp.unlocked === 2 && rd.html && rd.next, JSON.stringify(rd));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('jr_levels_v1')));
  check('progress is stored (survives reload)', saved.done[1] === true && saved.stars[1] >= 1, JSON.stringify(saved));
  await p.evaluate(() => game.onAction('campaign')); await p.waitForFunction(() => game.ui.screen === 'campaign', null, { timeout: 60000 });
  const m2 = await p.evaluate(() => ({ locked: document.querySelectorAll('.lvl.lock').length, done: document.querySelectorAll('.lvl.done').length }));
  check('after level 1: level 2 open, level 3 locked', m2.locked === 8 && m2.done === 1, JSON.stringify(m2));
  await p.evaluate(() => game.onAction('quit')); await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({ lvl: game.levelId, laps: game.settings.laps, rivals: game.settings.rivals, sc: game.scene.id }));
  check('leaving the campaign restores free-play settings and the classic scenery', back.lvl === 0 && back.sc === 'classic' && back.rivals === 4, JSON.stringify(back));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ')); await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL CAMPAIGN TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
