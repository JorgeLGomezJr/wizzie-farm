// =====================================================================
//  WIZZIE FARM — small shared helpers
// =====================================================================
window.WF = window.WF || { data: {} };

WF.util = (function () {
  'use strict';

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Deterministic random generator (same seed => same world layout every visit).
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shortest signed angle difference (radians)
  function angleDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Distance from point p to segment ab (2D, arrays [x,z])
  function distToSegment(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var len2 = dx * dx + dz * dz;
    var t = len2 ? clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) : 0;
    var cx = ax + t * dx, cz = az + t * dz;
    return Math.hypot(px - cx, pz - cz);
  }

  // Safe storage wrappers (never throw). v1.2: they go through WF.storage (below), which
  // writes to the desktop app's save files when it runs there, otherwise to localStorage.
  function store(key, val) { return WF.storage.store(key, val); }
  function load(key) { return WF.storage.load(key); }
  function remove(key) { WF.storage.remove(key); }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  // Replace {name} / {school} tokens in dialogue
  function fillText(s) {
    var p = WF.state && WF.state.player;
    if (!p) return s;
    var school = WF.data.schools[p.school];
    // function replacements so "$&" etc. in a player's name are taken literally
    return String(s).replace(/\{name\}/g, function () { return p.name; })
      .replace(/\{school\}/g, function () { return school ? school.name : ''; });
  }

  // True only for text-entry fields (checkboxes, sliders and selects must not swallow game keys)
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
    if (t.tagName !== 'INPUT') return false;
    var ty = (t.type || 'text').toLowerCase();
    return ['text', 'search', 'number', 'email', 'password', 'url', 'tel'].indexOf(ty) >= 0;
  }

  function hexToInt(hex) { return parseInt(String(hex).replace('#', ''), 16); }

  return {
    rand: rand, randi: randi, clamp: clamp, lerp: lerp, pick: pick, seeded: seeded,
    angleDiff: angleDiff, esc: esc, fmt: fmt, sleep: sleep, distToSegment: distToSegment,
    store: store, load: load, remove: remove, deepClone: deepClone, fillText: fillText,
    hexToInt: hexToInt, isTyping: isTyping
  };
})();

// ---- v1.2 WS5: storage adapter (V1.2-CONTRACT §4)
// WF.storage = { load(key), store(key, val), remove(key), raw(key), kind() }
//  - Desktop app: window.wfNative.storage (getItem/setItem/removeItem of JSON TEXT, synchronous;
//    the app keeps each key in a JSON file with rotating backups).
//  - Browser: localStorage.
// Values are JSON. load() returns null for a missing key OR unreadable text; raw() returns the
// stored text itself (the account layer uses it to keep a copy of damaged saves).
// Nothing here ever throws.
WF.storage = (function () {
  'use strict';
  function native() {
    try { var n = window.wfNative; return (n && n.storage && typeof n.storage.getItem === 'function') ? n.storage : null; }
    catch (e) { return null; }
  }
  function backend() {
    var n = native();
    if (n) return n;
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) { /* blocked */ }
    return null;
  }
  function raw(key) {
    var b = backend();
    if (!b) return null;
    try { var s = b.getItem(key); return (s === undefined || s === null) ? null : String(s); } catch (e) { return null; }
  }
  function load(key) {
    var s = raw(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function storeRaw(key, text) {
    var b = backend();
    if (!b) return false;
    try { var r = b.setItem(key, String(text)); return r !== false; } catch (e) { return false; }
  }
  function store(key, val) {
    var text;
    try { text = JSON.stringify(val); } catch (e) { return false; }
    if (text === undefined) return false;
    return storeRaw(key, text);
  }
  function remove(key) {
    var b = backend();
    if (!b) return;
    try { b.removeItem(key); } catch (e) { /* ignore */ }
  }
  function kind() { return native() ? 'desktop' : (backend() ? 'browser' : 'none'); }
  return { load: load, store: store, remove: remove, raw: raw, storeRaw: storeRaw, kind: kind };
})();
