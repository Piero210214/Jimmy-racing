// RFC 6455 conformance + abuse tests against server/ws.js using raw TCP sockets. Run: node tests/ws.test.js
const net = require('net'), http = require('http'), crypto = require('crypto');
const { attach } = require('../server/ws.js');
let fails = 0; const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info != null ? '  [' + info + ']' : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((q, s) => s.end('x')); const got = [];
attach(server, { path: '/ws', maxPayload: 1024 }, (c) => { c.on('message', (m) => { got.push(m); c.send('echo:' + m); }); });
function frame(op, payload, o = {}) {
  const p = Buffer.from(payload), n = p.length, fin = o.fin === false ? 0 : 0x80; let h;
  const m = o.mask === false ? 0 : 0x80;
  if (n < 126) h = Buffer.from([fin | op, m | n]); else if (n < 65536) { h = Buffer.alloc(4); h[0] = fin | op; h[1] = m | 126; h.writeUInt16BE(n, 2); } else { h = Buffer.alloc(10); h[0] = fin | op; h[1] = m | 127; h.writeUInt32BE(n, 6); }
  if (!m) return Buffer.concat([h, p]);
  const k = crypto.randomBytes(4), q = Buffer.alloc(n); for (let i = 0; i < n; i++) q[i] = p[i] ^ k[i & 3];
  return Buffer.concat([h, k, q]);
}
function parse(buf) { const out = []; while (buf.length >= 2) { let l = buf[1] & 0x7f, o = 2; if (l === 126) { l = buf.readUInt16BE(2); o = 4; } else if (l === 127) { l = buf.readUInt32BE(6); o = 10; } if (buf.length < o + l) break; out.push({ op: buf[0] & 15, data: buf.subarray(o, o + l) }); buf = buf.subarray(o + l); } return out; }
function open(port, headers = {}) {
  return new Promise((res) => {
    const key = crypto.randomBytes(16).toString('base64'), s = net.connect(port, '127.0.0.1'); let buf = Buffer.alloc(0), hs = null; const frames = [];
    const h = Object.assign({ Host: 'x', Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }, headers);
    s.write('GET /ws HTTP/1.1\r\n' + Object.entries(h).map(([a, b]) => a + ': ' + b).join('\r\n') + '\r\n\r\n');
    s.on('data', (d) => { buf = Buffer.concat([buf, d]); if (!hs) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; hs = buf.subarray(0, i).toString(); buf = buf.subarray(i + 4); res({ s, hs, key, frames }); } for (const f of parse(buf)) frames.push(f); buf = Buffer.alloc(0); });
    s.on('close', () => { s.closedFlag = true; });
  });
}
const closeCode = (c) => { const f = c.frames.find((x) => x.op === 8); return f && f.data.length >= 2 ? f.data.readUInt16BE(0) : null; };
(async () => {
  await new Promise((r) => server.listen(0, r)); const port = server.address().port;
  let c = await open(port);
  const accept = crypto.createHash('sha1').update(c.key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  check('handshake: 101 + correct Sec-WebSocket-Accept', /101/.test(c.hs) && c.hs.includes(accept));
  c.s.write(frame(1, 'hola')); await sleep(80); check('text frame echoed', c.frames.some((f) => f.op === 1 && f.data.toString() === 'echo:hola'));
  c.s.write(frame(1, 'ab', { fin: false })); c.s.write(frame(0, 'cd', { fin: false })); c.s.write(frame(0, 'ef')); await sleep(80);
  check('fragmented message reassembled', got.includes('abcdef'));
  c.s.write(frame(1, 'x'.repeat(300))); await sleep(80); check('16-bit length frame (300 B)', got.includes('x'.repeat(300)));
  c.s.write(frame(9, 'pp')); await sleep(80); check('ping answered with pong carrying payload', c.frames.some((f) => f.op === 10 && f.data.toString() === 'pp'));
  c.s.write(frame(1, 'é ñ 🏎')); await sleep(80); check('UTF-8 text intact', got.includes('é ñ 🏎'));
  c.s.write(frame(8, Buffer.from([0x03, 0xe8]))); await sleep(120); check('client close answered with close 1000', closeCode(c) === 1000);
  c = await open(port); c.s.write(frame(1, 'hi', { mask: false })); await sleep(120); check('unmasked client frame -> close 1002', closeCode(c) === 1002);
  c = await open(port); c.s.write(frame(1, 'y'.repeat(2000))); await sleep(120); check('oversized message -> close 1009', closeCode(c) === 1009);
  c = await open(port); c.s.write(frame(1, Buffer.from([0xff, 0xfe, 0xfd]))); await sleep(120); check('invalid UTF-8 -> close 1007', closeCode(c) === 1007);
  c = await open(port); c.s.write(frame(0, 'orphan')); await sleep(120); check('orphan continuation -> close 1002', closeCode(c) === 1002);
  c = await open(port); c.s.write(frame(9, 'x'.repeat(200))); await sleep(120); check('oversized control frame -> close 1002', closeCode(c) === 1002);
  c = await open(port, { 'Sec-WebSocket-Version': '8' }); check('wrong version -> 426', /426/.test(c.hs));
  c = await open(port, { 'Sec-WebSocket-Key': 'short' }); check('invalid key -> 400', /400/.test(c.hs));
  const r = await new Promise((res) => http.get({ port, path: '/ws' }, (x) => res(x.statusCode)));
  check('plain HTTP GET (no upgrade) is not a websocket', r === 200 || r === 404 || r === 400, r);
  // many tiny frames in one TCP packet
  c = await open(port); const before = got.length; c.s.write(Buffer.concat([frame(1, 'a1'), frame(1, 'a2'), frame(1, 'a3')])); await sleep(100); check('several frames in one TCP chunk', got.length === before + 3);
  // frame split across TCP chunks
  const f = frame(1, 'split-me'); c.s.write(f.subarray(0, 3)); await sleep(30); c.s.write(f.subarray(3)); await sleep(80); check('frame split across TCP chunks', got.includes('split-me'));
  server.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL WS TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
