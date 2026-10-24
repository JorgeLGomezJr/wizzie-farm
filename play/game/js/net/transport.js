// =====================================================================
//  WIZZIE FARM — REALM TRANSPORTS  (WF.net.transport)   v2.0 WS-C
//  One small interface, two implementations (docs/design/realms.md §1):
//
//    T.listen(code, cb(err, server))     server.onConnection(fn(link)), server.close()
//    T.connect(code, cb(err, link))
//    link.send(obj)  link.close()  link.on('message', fn(obj))  link.on('close', fn(reason))
//    link.id  link.open
//
//  * WF.net.transport.loopback(opts) -> an in-memory network for tests and the
//    headless realm simulation. Every message goes through JSON (like the wire)
//    and waits in a queue until net.flush() (or a timer with { auto: true }).
//    net.drop(link) cuts a link (connection loss), net.filter = fn(msg, from, to)
//    may drop/tamper messages (return false = drop).
//  * WF.net.transport.webrtc -> WebRTC DataChannels via the vendored PeerJS
//    (game/lib/peerjs.min.js, MIT). The library is loaded ONLY when you host or
//    join, so single-player never touches the network (works offline).
//  Errors (cb's err): 'offline' | 'timeout' | 'notFound' | 'taken' | 'unsupported' | 'closed'
// =====================================================================
(function (root) {
  'use strict';
  root.WF = root.WF || { data: {} };
  var WF = root.WF;
  WF.net = WF.net || {};
  function cfg() { return (WF.data && WF.data.realms) || {}; }
  var CHUNK = 48000;   // characters per DataChannel message (well under every browser's limit)

  // ---------------------------------------------------------------
  // Link: JSON + chunking + event handlers over a raw string channel
  // ---------------------------------------------------------------
  function makeLink(id, rawSend, rawClose) {
    var h = { message: [], close: [] }, parts = {}, partNo = 0;
    var link = {
      id: id, open: true,
      on: function (ev, fn) { if (h[ev]) h[ev].push(fn); return link; },
      send: function (obj) {
        if (!link.open) return false;
        var s = JSON.stringify(obj);
        try {
          if (s.length <= CHUNK) rawSend(s);
          else {
            var n = Math.ceil(s.length / CHUNK), pid = ++partNo;
            for (var i = 0; i < n; i++) rawSend(JSON.stringify({ t: '~part', p: pid, i: i, n: n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
          }
        } catch (e) { return false; }
        return true;
      },
      close: function (reason) {
        if (!link.open) return;
        try { rawClose(); } catch (e) { /* already gone */ }
        link._closed(reason || 'closed');
      },
      // transport side
      _receive: function (s) {
        if (!link.open) return;
        var m;
        try { m = typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return; }
        if (m && m.t === '~part') {
          var p = parts[m.p] || (parts[m.p] = { n: m.n, got: 0, d: [] });
          if (p.d[m.i] == null) { p.d[m.i] = m.d; p.got++; }
          if (p.got < p.n) return;
          delete parts[m.p];
          try { m = JSON.parse(p.d.join('')); } catch (e2) { return; }
        }
        h.message.slice().forEach(function (fn) { try { fn(m); } catch (err) { report(err); } });
      },
      _closed: function (reason) {
        if (!link.open) return;
        link.open = false;
        h.close.slice().forEach(function (fn) { try { fn(reason || 'closed'); } catch (err) { report(err); } });
      }
    };
    return link;
  }
  function report(err) { if (typeof console !== 'undefined') console.error('[realm]', err); }

  // ---------------------------------------------------------------
  // In-memory loopback network (tests, headless simulation)
  // ---------------------------------------------------------------
  function loopback(opts) {
    opts = opts || {};
    var servers = {}, queue = [], nextId = 1, timer = null;
    var net = { sent: 0, delivered: 0, bytes: 0, filter: null, online: true };
    function schedule() {
      if (!opts.auto || timer) return;
      timer = setTimeout(function () { timer = null; net.flush(); }, opts.delayMs || 0);
    }
    function post(fn) { queue.push(fn); schedule(); }
    // a pair of connected links
    function pair(serverCode) {
      var a, b, aid = 'L' + (nextId++), bid = 'L' + (nextId++);
      function closeBoth() { post(function () { a._closed('closed'); b._closed('closed'); }); }
      a = makeLink(aid, function (s) { net.sent++; net.bytes += s.length; post(function () { deliver(s, a, b); }); }, closeBoth);
      b = makeLink(bid, function (s) { net.sent++; net.bytes += s.length; post(function () { deliver(s, b, a); }); }, closeBoth);
      a.peer = b; b.peer = a; a.code = b.code = serverCode;
      return [a, b];
    }
    // like a reliable channel: what was sent before a close still arrives
    function deliver(s, from, to) {
      if (!to.open) return;
      if (net.filter) {
        var m; try { m = JSON.parse(s); } catch (e) { m = null; }
        var r = net.filter(m, from, to);
        if (r === false) return;
        if (r && typeof r === 'object') s = JSON.stringify(r);
      }
      net.delivered++;
      to._receive(s);
    }
    net.listen = function (code, cb) {
      post(function () {
        if (!net.online) return cb('offline');
        if (servers[code]) return cb('taken');
        var handlers = [];
        var server = {
          code: code,
          onConnection: function (fn) { handlers.push(fn); },
          close: function () { if (servers[code] === server) delete servers[code]; server.closed = true; },
          _accept: function (link) { handlers.forEach(function (fn) { fn(link); }); }
        };
        servers[code] = server;
        cb(null, server);
      });
    };
    net.connect = function (code, cb) {
      post(function () {
        if (!net.online) return cb('offline');
        var srv = servers[code];
        if (!srv) return cb('notFound');
        var p = pair(code);
        srv._accept(p[1]);
        cb(null, p[0]);
      });
    };
    // deliver everything queued (including what that causes), up to a safety cap
    net.flush = function (max) {
      var n = 0; max = max || 100000;
      while (queue.length && n < max) { var fn = queue.shift(); n++; fn(); }
      return n;
    };
    net.pending = function () { return queue.length; };
    // simulate a lost connection (both ends see 'close' with reason 'lost')
    net.drop = function (link) { post(function () { link._closed('lost'); if (link.peer) link.peer._closed('lost'); }); };
    net.available = function () { return true; };
    net.kind = 'loopback';
    return net;
  }

  // ---------------------------------------------------------------
  // WebRTC via PeerJS (lazy-loaded)
  // ---------------------------------------------------------------
  var peerLib = { state: 'none', waiters: [] };
  function libPath() {
    // same folder as this script's game/lib (works from file:// and the desktop app)
    var base = 'game/lib/peerjs.min.js';
    try {
      var s = document.querySelector('script[src*="net/transport.js"]');
      if (s) return s.getAttribute('src').replace(/js\/net\/transport\.js.*$/, 'lib/peerjs.min.js');
    } catch (e) { /* default */ }
    return base;
  }
  function loadPeerJS(cb) {
    if (root.peerjs && root.peerjs.Peer) return cb(null);
    if (peerLib.state === 'error') return cb('unsupported');
    peerLib.waiters.push(cb);
    if (peerLib.state === 'loading') return;
    peerLib.state = 'loading';
    var done = function (err) { peerLib.state = err ? 'error' : 'ok'; var w = peerLib.waiters; peerLib.waiters = []; w.forEach(function (f) { f(err); }); };
    try {
      var tag = document.createElement('script');
      tag.src = libPath();
      tag.onload = function () { done(root.peerjs && root.peerjs.Peer ? null : 'unsupported'); };
      tag.onerror = function () { done('unsupported'); };
      document.head.appendChild(tag);
    } catch (e) { done('unsupported'); }
  }
  function peerOptions() {
    var c = cfg(), o = { debug: 0, config: { iceServers: c.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] } };
    var sg = c.signaling;
    if (sg) for (var k in sg) o[k] = sg[k];
    return o;
  }
  function mapError(e) {
    var t = e && e.type;
    if (t === 'unavailable-id') return 'taken';
    if (t === 'peer-unavailable') return 'notFound';
    if (t === 'browser-incompatible') return 'unsupported';
    return 'offline';     // network, server-error, socket-error, ssl-unavailable, disconnected
  }
  function wrapConn(conn) {
    var link = makeLink(conn.peer + '#' + (conn.connectionId || ''), function (s) { conn.send(s); }, function () { conn.close(); });
    conn.on('data', function (d) { link._receive(d); });
    conn.on('close', function () { link._closed('lost'); });
    conn.on('error', function () { link._closed('lost'); });
    return link;
  }
  var webrtc = {
    kind: 'webrtc',
    available: function () { return typeof root.RTCPeerConnection === 'function' || typeof root.webkitRTCPeerConnection === 'function'; },
    load: loadPeerJS,
    listen: function (code, cb) {
      if (!webrtc.available()) return cb('unsupported');
      loadPeerJS(function (err) {
        if (err) return cb(err);
        var handlers = [], opened = false, peer;
        try { peer = new root.peerjs.Peer(WF.net.protocol.peerId(code), peerOptions()); } catch (e) { return cb('unsupported'); }
        var to = setTimeout(function () { if (!opened) { opened = true; try { peer.destroy(); } catch (e) { /* */ } cb('timeout'); } }, (cfg().connectSeconds || 15) * 1000);
        var server = {
          code: code, peer: peer,
          onConnection: function (fn) { handlers.push(fn); },
          close: function () { server.closed = true; try { peer.destroy(); } catch (e) { /* */ } }
        };
        peer.on('open', function () { if (opened) return; opened = true; clearTimeout(to); cb(null, server); });
        peer.on('error', function (e) { if (!opened) { opened = true; clearTimeout(to); try { peer.destroy(); } catch (x) { /* */ } cb(mapError(e)); } });
        // lost the signaling broker (not the friends): reconnect so new friends can still join
        peer.on('disconnected', function () { if (!server.closed) setTimeout(function () { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* */ } }, 2000); });
        peer.on('connection', function (conn) {
          conn.on('open', function () { var link = wrapConn(conn); handlers.forEach(function (fn) { fn(link); }); });
        });
      });
    },
    connect: function (code, cb) {
      if (!webrtc.available()) return cb('unsupported');
      loadPeerJS(function (err) {
        if (err) return cb(err);
        var done = false, peer;
        function finish(e, link) { if (done) return; done = true; clearTimeout(to); if (e) { try { peer.destroy(); } catch (x) { /* */ } } cb(e, link); }
        try { peer = new root.peerjs.Peer(peerOptions()); } catch (e) { return cb('unsupported'); }
        var to = setTimeout(function () { finish('timeout'); }, (cfg().connectSeconds || 15) * 1000);
        peer.on('error', function (e) { finish(mapError(e)); });
        peer.on('open', function () {
          var conn = peer.connect(WF.net.protocol.peerId(code), { reliable: true, serialization: 'raw' });
          conn.on('open', function () {
            var link = wrapConn(conn);
            link.on('close', function () { setTimeout(function () { try { peer.destroy(); } catch (x) { /* */ } }, 0); });
            finish(null, link);
          });
          conn.on('error', function () { finish('timeout'); });
        });
      });
    }
  };

  WF.net.transport = { loopback: loopback, webrtc: webrtc, makeLink: makeLink, CHUNK: CHUNK };
  if (typeof module !== 'undefined' && module.exports) module.exports = WF.net.transport;
})(typeof window !== 'undefined' ? window : global);
