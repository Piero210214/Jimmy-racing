// Two real browser windows (separate contexts) play against each other through the real server.
// Run: node tests/browser_online.js
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path');
const root = path.join(__dirname, '..'), PORT = 3800 + Math.floor(Math.random() * 300), URL = 'http://127.0.0.1:' + PORT + '/#q=low';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info != null ? '  [' + info + ']' : '')); if (!ok) fails++; };
(async () => {
  const srv = spawn(process.execPath, [path.join(root, 'server/server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; srv.stdout.on('data', (d) => slog += d); srv.stderr.on('data', (d) => slog += d); await sleep(1200);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } }), page = await ctx.newPage(), logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 180000 });
    return { name, ctx, page, logs };
  };
  try {
    const [A, B] = await Promise.all([mk('Alice'), mk('Bob')]);
    check('both browsers loaded the game from the server', true);
    for (const c of [A, B]) { await c.page.click('[data-act="o_open"]'); await c.page.waitForFunction(() => game.net && game.net.status === 'online', null, { timeout: 30000 }); }
    check('both browsers connected via native WebSocket', true);
    await A.page.fill('[data-set="o_name"]', 'Alice'); await B.page.fill('[data-set="o_name"]', 'Bob');
    await A.page.click('[data-act="o_create"]'); await A.page.waitForSelector('.roomcode', { timeout: 15000 });
    const code = (await A.page.textContent('.roomcode')).trim(); check('A created a room, code shown in lobby', /^[A-Z2-9]{5}$/.test(code), code);
    await B.page.fill('[data-set="o_code"]', code); await B.page.click('[data-act="o_joinCode"]'); await B.page.waitForSelector('.roomcode', { timeout: 15000 });
    await A.page.waitForFunction(() => game.online.room && game.online.room.players.length === 2, null, { timeout: 15000 });
    const rowsA = await A.page.$$eval('.tbl tr', (r) => r.length - 1); check('lobby lists both players in both windows', rowsA === 2 && (await B.page.$$eval('.tbl tr', (r) => r.length - 1)) === 2);
    check('lobby 3D scene has both cars', (await A.page.evaluate(() => game.sim.cars.length)) === 2);
    await A.page.screenshot({ path: '/tmp/o_lobbyA.png' });
    check('lobby: host has Start (disabled until guest ready) + Close + Kick; guest has Ready', (await A.page.$eval('[data-act="o_start"]', (e) => e.disabled)) && !!(await A.page.$('[data-act="o_close"]')) && !!(await A.page.$('[data-act="o_kick"]')) && !!(await B.page.$('[data-act="o_ready"]')) && !(await B.page.$('[data-act="o_start"]')));
    check('rooms default to NO bots (only humans)', (await A.page.evaluate(() => game.online.room.bots)) === 0);
    await A.page.selectOption('[data-set="o_circuit"]', '3'); await A.page.waitForFunction(() => game.levelId === 3 && game.online.room.circuit === 3, null, { timeout: 60000 });
    await B.page.waitForFunction(() => game.levelId === 3, null, { timeout: 60000 });
    check('host picks circuit 3: both clients rebuild the world for it', true);
    await A.page.selectOption('[data-set="o_bots"]', '2'); await A.page.waitForFunction(() => game.online.room.bots === 2, null, { timeout: 15000 });
    await B.page.click('[data-act="o_ready"]'); await A.page.waitForFunction(() => !document.querySelector('[data-act="o_start"]').disabled, null, { timeout: 15000 });
    check('host Start enables once the guest is ready', true);
    await A.page.click('[data-act="o_start"]');
    await Promise.all([A, B].map((c) => c.page.waitForFunction(() => game.online && game.online.active, null, { timeout: 30000 })));
    check('race started in both browsers when the host pressed Start', (await A.page.evaluate(() => game.levelId)) === 3 && (await B.page.evaluate(() => game.levelId)) === 3);
    await Promise.all([A, B].map((c) => c.page.waitForFunction(() => game.sim.state === 'racing', null, { timeout: 90000 })));
    check('countdown finished: racing in both', true);
    await A.page.screenshot({ path: '/tmp/o_raceA0.png' });
    await A.page.keyboard.down('ArrowUp'); await B.page.keyboard.down('ArrowUp'); await sleep(7000);
    const probe = (pg) => pg.evaluate(() => { const o = game.online, out = {}; for (const pid in o.cars) { const c = o.cars[pid]; out[c.name] = { x: c.vehicle.x, z: c.vehicle.z, kmh: c.vehicle.speedKmh, place: c.race.place, dist: c.race.dist }; } return { cars: out, me: game.player.name, tags: game._tags().map((t) => t.name), fps: game.fps, ping: game.net.rtt }; });
    const pa = await probe(A.page), pb = await probe(B.page);
    console.log('A view', JSON.stringify(pa)); console.log('B view', JSON.stringify(pb));
    check('A sees both cars moving at speed', pa.cars.Alice.kmh > 20 && pa.cars.Bob.kmh > 20);
    check('B sees both cars moving at speed', pb.cars.Alice.kmh > 20 && pb.cars.Bob.kmh > 20);
    // exact sync check: the same server tick, as received independently by both windows, must be identical
    const hist = (pg) => pg.evaluate(() => game.net.snaps.map((n) => ({ k: Math.round(n.t * 120), c: JSON.stringify(Object.keys(n.cars).sort().map((p) => [p, n.cars[p].veh.x, n.cars[p].veh.z, n.cars[p].veh.heading])) })));
    const [ha, hb2] = await Promise.all([hist(A.page), hist(B.page)]);
    const mb = new Map(hb2.map((x) => [x.k, x.c])), common = ha.filter((x) => mb.has(x.k));
    check('both windows received identical snapshots for the same ticks', common.length > 0 && common.every((x) => x.c === mb.get(x.k)), common.length + ' common ticks');
    check('name tag of the other driver is projected on screen', pa.tags.includes('Bob') || pb.tags.includes('Alice'), pa.tags + '/' + pb.tags);
    check('4 cars visible (2 humans + 2 bots), places 1..4', Object.values(pa.cars).map((c) => c.place).sort().join() === '1,2,3,4' && Object.keys(pa.cars).filter((n) => /bot/.test(n)).length === 2);
    await A.page.screenshot({ path: '/tmp/o_raceA.png' }); await B.page.screenshot({ path: '/tmp/o_raceB.png' });
    // B abandons through the pause menu while racing: A must keep racing
    await B.page.keyboard.press('Escape'); await B.page.waitForSelector('[data-act="o_leave"]', { timeout: 5000 }); await B.page.click('[data-act="o_leave"]');
    await A.page.waitForFunction(() => Object.keys(game.online.cars).length === 3, null, { timeout: 15000 });
    check('B left mid-race: A removed the car and keeps racing', (await A.page.evaluate(() => game.sim.state)) === 'racing');
    const k0 = await A.page.evaluate(() => game.net.latest().sim); await sleep(3000); const k1 = await A.page.evaluate(() => game.net.latest().sim);
    check('server keeps simulating A after the other player left', k1 > k0 + 1.5, (k1 - k0).toFixed(1) + ' s of race time');
    check('B returned to the online menu', (await B.page.evaluate(() => game.state)) === 'online');
    check('no JS errors in either browser', A.logs.length === 0 && B.logs.length === 0, (A.logs.concat(B.logs)).slice(0, 3).join(' | '));
    // single-player still works in the same build
    const S = await mk('Solo');
    await S.page.evaluate(() => { game.settings.quali = false; game.settings.rivals = 2; game.settings.laps = 1; game.onAction('setup', 'race'); game.onAction('start', 'race'); });
    await S.page.waitForFunction(() => game.state === 'race' && game.sim.state === 'racing', null, { timeout: 280000 }); await S.page.keyboard.down('ArrowUp'); await sleep(9000);
    const sp = await S.page.evaluate(() => ({ kmh: game.player.vehicle.speedKmh, cars: game.sim.cars.length, ai: game.sim.cars.filter((c) => c.ai).length }));
    check('single-player vs AI still works (player drives, AI cars present)', sp.kmh > 5 && sp.cars === 3 && sp.ai === 2, JSON.stringify(sp));
    check('no JS errors in single-player', S.logs.length === 0, S.logs.slice(0, 3).join(' | '));
  } catch (e) { check('test run completed', false, e.message); console.log(slog.slice(-600)); }
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL BROWSER ONLINE TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
