/* JIMMY RACING - server/server.js : static file + WebSocket multiplayer server. No dependencies.
 * Run:  node server/server.js        (PORT env var, default 3000)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./ws.js');
const { Hub } = require('./rooms.js');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);   // optional extra origins
const GAME = path.join(ROOT, 'dist', 'jimmy-racing.html');

function loadGame() {
  if (!fs.existsSync(GAME)) { try { require(path.join(ROOT, 'tools', 'build.js')); } catch (e) { console.error('No se pudo construir el juego:', e.message); } }
  return fs.readFileSync(GAME);
}
let page = loadGame();

const hub = new Hub();
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); return res.end(); }
  if (url === '/' || url === '/index.html') {
    if (process.env.NODE_ENV !== 'production') { try { page = fs.readFileSync(GAME); } catch (e) { } }
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, headers));
    return res.end(req.method === 'HEAD' ? undefined : page);
  }
  if (url === '/healthz') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, headers));
    return res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size, players: hub.players.size, tickMs: +(hub.tickMs || 0).toFixed(2), tickMaxMs: +(hub.tickMax || 0).toFixed(2) }));
  }
  res.writeHead(404, headers); res.end('Not found');
});

/* per-connection token bucket + per-IP connection cap */
const perIp = new Map();
attach(server, {
  path: '/ws', maxPayload: 2048,
  verifyOrigin: (req) => {
    const o = req.headers.origin; if (!o) return true;                 // non-browser clients (tests)
    try { const u = new URL(o); if (u.host === req.headers.host) return true; } catch (e) { return false; }
    return ALLOWED_ORIGINS.includes(o);
  }
}, (conn, req) => {
  const ip = (req.headers['x-forwarded-for'] || conn.ip || '').toString().split(',')[0].trim();
  const n = (perIp.get(ip) || 0) + 1;
  if (n > 16) { conn.close(1008, 'too many connections'); return; }
  perIp.set(ip, n);
  let tokens = 160, last = Date.now(), drops = 0, dropT = last;
  conn.on('message', (s) => {
    const now = Date.now(); tokens = Math.min(160, tokens + (now - last) * 0.12); last = now;      // 120 msg/s sustained, burst 160
    if (tokens < 1) { if (now - dropT > 10000) { drops = 0; dropT = now; } if (++drops > 300) conn.close(1008, 'rate limit'); return; }
    tokens -= 1;
    try { hub.onMessage(conn, s); } catch (e) { console.error('handler error', e); }
  });
  conn.on('close', () => { perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); try { hub.disconnected(conn); } catch (e) { console.error(e); } });
  const hb = setInterval(() => { if (!conn.alive) { conn.close(1001, 'timeout'); return; } conn.ping(); }, 15000);
  conn.on('close', () => clearInterval(hb));
  const hello = setTimeout(() => { if (!conn.player) conn.close(1008, 'no hello'); }, 10000);
  conn.on('close', () => clearTimeout(hello));
});

hub.start();
server.listen(PORT, '0.0.0.0', () => console.log('JIMMY RACING online en http://localhost:' + PORT + '  (WebSocket: /ws)'));
process.on('SIGTERM', () => { hub.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
module.exports = { server, hub };
