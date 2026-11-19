/* JIMMY RACING - server/ws.js
 * Minimal WebSocket server implementing RFC 6455 on top of Node's http module (no dependencies).
 * Supports: HTTP Upgrade handshake (Sec-WebSocket-Accept), masked client frames, 7/16/64-bit lengths,
 * fragmented messages (continuation frames), text/binary, ping/pong, close handshake with status codes,
 * payload size limits, protocol-violation closing (1002 / 1007 / 1009).
 */
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConnection extends EventEmitter {
  constructor(socket, opts) {
    super();
    this.socket = socket; this.maxPayload = opts.maxPayload || 4096;
    this.buf = Buffer.alloc(0); this.frag = null; this.fragLen = 0; this.fragOp = 0;
    this.closed = false; this.closeSent = false; this.alive = true; this.ip = socket.remoteAddress;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish(1006));
    socket.on('error', () => this._finish(1006));
    socket.on('end', () => this._finish(1006));
  }
  _fail(code, why) { this.close(code, why); }
  _onData(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    // guard against a client that streams garbage without ever completing a frame
    if (this.buf.length > this.maxPayload * 2 + 16) return this._fail(1009, 'too big');
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const b0 = b[0], b1 = b[1], fin = !!(b0 & 0x80), rsv = b0 & 0x70, op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (rsv) return this._fail(1002, 'rsv');
      if (!masked) return this._fail(1002, 'unmasked');                 // RFC 6455 5.1: client frames MUST be masked
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi !== 0 || lo > this.maxPayload) return this._fail(1009, 'too big');
        len = lo; off = 10;
      }
      const isCtl = op >= 0x8;
      if (isCtl && (!fin || len > 125)) return this._fail(1002, 'bad control frame');
      if (len > this.maxPayload) return this._fail(1009, 'too big');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (!this._frame(fin, op, payload)) return;
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) {                                                    // close
      let code = 1005;
      if (payload.length >= 2) { code = payload.readUInt16BE(0); if (code < 1000 || code === 1004 || code === 1005 || code === 1006 || (code > 1011 && code < 3000) || code >= 5000) { this.close(1002, 'bad close code'); return false; } }
      else if (payload.length === 1) { this.close(1002, 'bad close'); return false; }
      this.close(code === 1005 ? 1000 : code, ''); this._finish(code); return false;
    }
    if (op === 0x9) { this._send(0xA, payload); return true; }          // ping -> pong
    if (op === 0xA) { this.alive = true; this.emit('pong'); return true; }
    if (op === 0x0) {                                                    // continuation
      if (!this.frag) { this._fail(1002, 'unexpected continuation'); return false; }
      this.fragLen += payload.length; if (this.fragLen > this.maxPayload) { this._fail(1009, 'too big'); return false; }
      this.frag.push(payload);
      if (fin) { const full = Buffer.concat(this.frag); const o = this.fragOp; this.frag = null; this.fragLen = 0; return this._deliver(o, full); }
      return true;
    }
    if (op === 0x1 || op === 0x2) {
      if (this.frag) { this._fail(1002, 'expected continuation'); return false; }
      if (!fin) { this.frag = [payload]; this.fragLen = payload.length; this.fragOp = op; return true; }
      return this._deliver(op, payload);
    }
    this._fail(1002, 'bad opcode'); return false;
  }
  _deliver(op, payload) {
    this.alive = true;
    if (op === 0x1) {
      const s = payload.toString('utf8');
      if (Buffer.byteLength(s) !== payload.length || s.indexOf('�') >= 0) { this._fail(1007, 'invalid utf8'); return false; }
      this.emit('message', s);
    } else this.emit('binary', payload);
    return true;
  }
  _send(op, payload) {
    if (this.closed || !this.socket.writable) return false;
    const n = payload.length; let head;
    if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
    else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(n, 6); }
    head[0] = 0x80 | op;
    this.socket.write(Buffer.concat([head, payload]));
    return true;
  }
  send(str) { return this._send(0x1, Buffer.from(str, 'utf8')); }
  ping() { this.alive = false; return this._send(0x9, Buffer.alloc(0)); }
  get buffered() { return this.socket.writableLength; }
  close(code, reason) {
    if (this.closeSent) return; this.closeSent = true;
    const r = Buffer.from(String(reason || '').slice(0, 100)), p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code || 1000, 0); r.copy(p, 2);
    this._send(0x8, p);
    setTimeout(() => { try { this.socket.destroy(); } catch (e) { } this._finish(code || 1000); }, 400).unref();
  }
  _finish(code) { if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e) { } this.emit('close', code); }
}

/* attach(httpServer, {path, maxPayload, verifyOrigin}, onConnection) */
function attach(server, opts, onConnection) {
  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    const bad = (code, msg) => { socket.write('HTTP/1.1 ' + code + ' ' + msg + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); };
    if (url !== (opts.path || '/ws')) return bad(404, 'Not Found');
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !/upgrade/i.test(req.headers.connection || '') || !key) return bad(400, 'Bad Request');
    if (req.headers['sec-websocket-version'] !== '13') { socket.write('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
    if (Buffer.from(key, 'base64').length !== 16) return bad(400, 'Bad Key');
    if (opts.verifyOrigin && !opts.verifyOrigin(req)) return bad(403, 'Forbidden');
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const conn = new WSConnection(socket, opts);
    onConnection(conn, req);
    if (head && head.length) conn._onData(head);
  });
}

module.exports = { attach, WSConnection, GUID };
