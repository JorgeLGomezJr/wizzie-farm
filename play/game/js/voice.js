// =====================================================================
//  WIZZIE FARM — NPC VOICES  (v1.2 WS7, audio-director / ui-programmer)
//
//  WF.voice reads dialogue out loud. Every known line is pre-rendered
//  offline with a neural TTS (tools/gen-voices.py → game/audio/voice/
//  <speaker>/<hash>.ogg, listed in game/audio/voice/manifest.js as
//  WF.data.voiceClips). A line with no clip (new content not rendered
//  yet) falls back to the browser's speech synthesis, shaped by the
//  speaker's `web` profile in game/data/voices.js.
//
//  API
//    say(speaker, text, opts)   stop whatever is playing, then speak `text`
//                               as `speaker` (npc/enemy id or 'narrator').
//                               `text` may be raw ({name}/{school} tokens) or
//                               already filled in. Returns { clip, dur } or null.
//                               opts: { delay: ms (default 120), queue: bool,
//                                       noFallback: bool, onend: fn }
//    sayLines(speaker, lines)   speak several lines one after another
//    sayAny(text)               speak a line whose speaker is unknown (duel
//                               speech bubbles): matched against every clip
//    stop()                     stop speaking and clear the queue
//    isSpeaking()
//    enabled() / setEnabled(b)  p.settings.voice        (default ON)
//    volume()  / setVolume(v)   p.settings.voiceVolume  (default 0.9; scaled by master)
//    lineMs(text, speaker?)     v2.1: clip length in ms from the manifest (0 = no clip): duels wait for it
//    duration(speaker, text)    clip length in seconds (or an estimate) — lets
//                               other code wait for a line to finish
//    lookup(speaker, text)      { key, src, dur } | null   (tests / tools)
//    normalize(text), key(speaker, text), profile(speaker, kind)  shared with
//                               tools/voice-lines.js and tests/voice-check.js
//
//  Never throws: with no Audio / speechSynthesis every call is a silent no-op.
//  Loads in Node (no DOM access at load time) so the tools reuse key().
// =====================================================================
window.WF = window.WF || { data: {} };

WF.voice = (function () {
  'use strict';
  var V = {};
  var DEFAULT_ON = true, DEFAULT_VOLUME = 0.9;
  var DUCK_LEVEL = 0.4;           // music level while someone talks
  var GAP_MS = 380;               // pause between queued lines

  // Where the clips live, relative to the page. Derived from this script's own
  // URL so test pages in tests/ work too; override with WF.voice.root = '...'.
  V.root = 'game/audio/voice/';
  try {
    var cs = typeof document !== 'undefined' && document.currentScript;
    if (cs && cs.src && /js\/voice\.js(\?.*)?$/.test(cs.src)) V.root = cs.src.replace(/js\/voice\.js(\?.*)?$/, 'audio/voice/');
  } catch (e) { /* keep default */ }

  // ------------------------------------------------------------------
  // Text normalisation + stable keys (the SAME code runs in the tools)
  // ------------------------------------------------------------------
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", mdash: '—', hellip: '…', middot: '·' };
  function decode(s) {
    return s.replace(/&(#?[a-z0-9]+);/gi, function (m, n) {
      if (ENT[n.toLowerCase()] != null) return ENT[n.toLowerCase()];
      if (n.charAt(0) === '#') { var c = n.charAt(1).toLowerCase() === 'x' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10); if (c > 0) return String.fromCharCode(c); }
      return m;
    });
  }
  // Strip markup, decode entities, unify quotes/whitespace. Tokens stay as they are.
  V.normalize = function (text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
    s = decode(s);
    s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  // FNV-1a 32-bit over UTF-16 code units → 8 hex digits
  V.hash = function (s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  };
  V.key = function (speaker, text) { return V.hash(String(speaker) + '|' + V.normalize(text)); };

  // ------------------------------------------------------------------
  // Profiles (game/data/voices.js): base inheritance + variants
  // ------------------------------------------------------------------
  function mergeSection(a, b) {
    var o = {}, k;
    for (k in a || {}) o[k] = a[k];
    for (k in b || {}) { if (b[k] === null) delete o[k]; else o[k] = b[k]; }
    return o;
  }
  function mergeProfile(a, b) {
    var o = {}, k;
    for (k in a || {}) o[k] = a[k];
    for (k in b || {}) {
      if (k === 'tts' || k === 'fx' || k === 'web') o[k] = mergeSection(o[k], b[k]);
      else if (k !== 'base' && k !== 'variants') o[k] = b[k];
    }
    if (b && b.variants) o.variants = b.variants;
    return o;
  }
  function voicesData() { return (WF.data && WF.data.voices) || {}; }
  V.hasProfile = function (speaker) { return !!voicesData()[speaker]; };
  // Resolved profile for a speaker (and optional line kind such as 'freed')
  V.profile = function (speaker, kind) {
    var all = voicesData(), chain = [], id = speaker, guard = 0;
    while (id && all[id] && guard++ < 8) { chain.unshift(all[id]); id = all[id].base; }
    var p = mergeProfile({}, all._default || {});
    chain.forEach(function (pr) { p = mergeProfile(p, pr); });
    var variants = p.variants || {};
    if (kind && variants[kind]) p = mergeProfile(p, variants[kind]);
    delete p.variants;
    return p;
  };

  // ------------------------------------------------------------------
  // Settings (stored per wizard in p.settings; defaults applied here)
  // ------------------------------------------------------------------
  function settings() {
    var p = WF.state && WF.state.player;
    if (!p) return null;
    var st = p.settings || (p.settings = {});
    if (typeof st.voice !== 'boolean') st.voice = DEFAULT_ON;
    if (typeof st.voiceVolume !== 'number' || !(st.voiceVolume >= 0 && st.voiceVolume <= 1)) st.voiceVolume = DEFAULT_VOLUME;
    return st;
  }
  V.enabled = function () { var st = settings(); return st ? st.voice : DEFAULT_ON; };
  V.volume = function () { var st = settings(); return st ? st.voiceVolume : DEFAULT_VOLUME; };
  V.setEnabled = function (on) {
    try { var st = settings(); if (st) st.voice = !!on; if (!on) V.stop(); } catch (e) { /* silent */ }
  };
  V.setVolume = function (v) {
    try {
      var st = settings(); v = Math.max(0, Math.min(1, +v || 0));
      if (st) st.voiceVolume = v;
      if (cur && cur.audio) cur.audio.volume = outVolume();
    } catch (e) { /* silent */ }
  };
  function outVolume() {
    var st = settings(), master = st && typeof st.master === 'number' ? st.master : 0.8;
    return Math.max(0, Math.min(1, V.volume() * master));
  }

  // ------------------------------------------------------------------
  // Clip lookup
  // ------------------------------------------------------------------
  function clips() { return (WF.data && WF.data.voiceClips) || {}; }
  function schoolName() {
    var p = WF.state && WF.state.player, sc = p && WF.data.schools && WF.data.schools[p.school];
    return sc ? sc.name : '';
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Candidate key texts: as given (school filled), then with the player's name → {name}
  function candidates(text) {
    var s = String(text == null ? '' : text), out = [];
    if (s.indexOf('{school}') >= 0) s = s.replace(/\{school\}/g, schoolName());
    out.push(s);
    var p = WF.state && WF.state.player, nm = p && p.name;
    if (nm && s.indexOf(nm) >= 0) {
      var re = new RegExp('(^|[^A-Za-z0-9])' + escRe(nm) + '(?=$|[^A-Za-z0-9])', 'g');
      var t = s.replace(re, function (m, pre) { return pre + '{name}'; });
      if (t !== s) out.push(t);
    }
    return out;
  }
  V.lookup = function (speaker, text) {
    var table = clips()[speaker];
    if (!table) return null;
    var c = candidates(text);
    for (var i = 0; i < c.length; i++) {
      var k = V.key(speaker, c[i]), e = table[k];
      if (e) return { key: k, src: V.root + speaker + '/' + k + '.ogg', dur: e[0] || 0, silent: !(e[0] > 0) };
    }
    return null;
  };
  // Fill tokens for the speech-synthesis fallback (it can say the real name)
  function filled(text) {
    var s = String(text == null ? '' : text);
    try { if (WF.util && WF.util.fillText) s = WF.util.fillText(s); } catch (e) { /* keep */ }
    return V.normalize(s.replace(/\*([^*]+)\*/g, function (m, inner) { return /^[a-z]/.test(inner) ? ' ' : inner; }));
  }
  V.duration = function (speaker, text) {
    var c = V.lookup(speaker, text);
    if (c) return c.dur;
    var pr = V.profile(speaker), rate = (pr.web && pr.web.rate) || 1;
    return filled(text).length / 14 / rate;
  };

  // ------------------------------------------------------------------
  // Playback
  // ------------------------------------------------------------------
  var cur = null;          // { audio | utter, speaker, text, done }
  var queue = [];
  var startTimer = null, gapTimer = null;
  var ducked = false;

  // Music ducking through the public WF.sfx.setVolume (sfx.js is untouched).
  // The player's own music setting (p.settings.music) stays the source of
  // truth, so moving the slider mid-line is respected when the duck ends.
  var duckAmt = 1, duckTimer = null;
  function musicSetting() {
    var st = settings();
    if (st && typeof st.music === 'number') return st.music;
    try { return WF.sfx.getVolume().music; } catch (e) { return 0.6; }
  }
  function masterSetting() {
    var st = settings();
    if (st && typeof st.master === 'number') return st.master;
    try { return WF.sfx.getVolume().master; } catch (e) { return 0.8; }
  }
  function duck(on) {
    if (on === ducked) return;
    ducked = on;
    var from = duckAmt, to = on ? DUCK_LEVEL : 1, steps = on ? 6 : 12, n = 0;   // ~0.15 s down, ~0.6 s back up
    clearInterval(duckTimer);
    duckTimer = setInterval(function () {
      n++;
      duckAmt = from + (to - from) * Math.min(1, n / steps);
      // Pass the real master level too (never null), so ducking can't touch anything but music.
      try { if (WF.sfx && WF.sfx.setVolume) WF.sfx.setVolume(masterSetting(), musicSetting() * duckAmt); } catch (e) { /* silent */ }
      if (n >= steps) { clearInterval(duckTimer); duckTimer = null; }
    }, 50);
  }
  V.musicDuck = function () { return duckAmt; };   // test hook
  function finish(entry) {
    if (!entry || entry.done) return;
    entry.done = true;
    if (cur === entry) cur = null;
    if (!cur && !queue.length) duck(false);      // stay ducked between queued lines
    try { if (entry.onend) entry.onend(); } catch (e) { /* silent */ }
    if (queue.length && !cur) {
      clearTimeout(gapTimer);
      gapTimer = setTimeout(function () { var n = queue.shift(); if (n) start(n); }, GAP_MS);
    }
  }

  // Test hook: what is playing right now (tests/voice-browser.js)
  V.debugState = function () {
    var c = cur;
    return {
      speaking: V.isSpeaking(), queued: queue.length, duck: duckAmt, source: V.lastSource || null,
      speaker: c ? c.speaker : null, text: c ? String(c.text) : null,
      src: c && c.audio ? c.audio.currentSrc || c.audio.src : null,
      time: c && c.audio ? c.audio.currentTime : null, paused: c && c.audio ? c.audio.paused : null,
      volume: c && c.audio ? c.audio.volume : null, error: c && c.audio && c.audio.error ? c.audio.error.code : null
    };
  };

  V.isSpeaking = function () { return !!(cur && !cur.done) || startTimer != null; };

  V.stop = function () {
    queue = [];
    clearTimeout(startTimer); startTimer = null;
    clearTimeout(gapTimer); gapTimer = null;
    var c = cur; cur = null;
    if (c) {
      c.done = true;
      try { if (c.audio) { c.audio.pause(); c.audio.removeAttribute('src'); c.audio.load(); } } catch (e) { /* silent */ }
      try { if (c.utter && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* silent */ }
    }
    duck(false);
  };

  function start(item) {
    var entry = { speaker: item.speaker, text: item.text, onend: item.onend, done: false };
    var clip = V.lookup(item.speaker, item.text);
    if (clip && clip.silent && !item.forceWeb) { finish(entry); return { clip: true, dur: 0 }; }
    if (clip && !item.forceWeb && typeof Audio !== 'undefined') {
      try {
        var a = new Audio();
        a.preload = 'auto';
        a.volume = outVolume();
        entry.audio = a;
        cur = entry;
        a.addEventListener('playing', function () { if (cur === entry) duck(true); });
        a.addEventListener('ended', function () { finish(entry); });
        a.addEventListener('error', function () {
          // File missing or undecodable: fall back to speech synthesis once
          if (entry.done || cur !== entry) return;
          if (item.noFallback) { finish(entry); return; }
          entry.done = true; cur = null;
          start({ speaker: item.speaker, text: item.text, onend: item.onend, kind: item.kind, forceWeb: true });
        });
        a.src = clip.src;
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function (err) {
          // Autoplay blocked (no user gesture yet) or interrupted by stop(): give up quietly
          if (err && err.name === 'AbortError') return;
          if (cur === entry) finish(entry);
        });
        V.lastSource = 'clip';
        return { clip: true, dur: clip.dur };
      } catch (e) { cur = null; }
    }
    if (item.noFallback && !item.forceWeb) { finish(entry); return null; }
    return speakWeb(entry, item) ? { clip: false, dur: V.duration(item.speaker, item.text) } : null;
  }

  // ---- Web Speech fallback ------------------------------------------
  var FEMALE = /zira|hazel|susan|aria|jenny|libby|sonia|samantha|karen|moira|tessa|fiona|victoria|michelle|ana\b|emma|serena|female|woman/i;
  var MALE = /david|mark|george|ryan|guy|daniel|alex\b|fred|thomas|christopher|eric|roger|james|male|man\b/i;
  function pickVoice(web) {
    var list = speechSynthesis.getVoices() || [];
    if (!list.length) return null;
    var lang = String(web.lang || 'en-US').toLowerCase();
    var en = list.filter(function (v) { return /^en/i.test(v.lang); });
    if (!en.length) en = list;
    // Prefer voices that work offline (desktop app, no internet)
    var local = en.filter(function (v) { return v.localService; });
    var pool = local.length ? local : en;
    function score(v) {
      var s = 0, name = v.name || '';
      (web.prefer || []).forEach(function (p, i) { if (name.toLowerCase().indexOf(String(p).toLowerCase()) >= 0) s = Math.max(s, 100 - i * 5); });
      if (String(v.lang).toLowerCase().replace('_', '-') === lang) s += 20;
      else if (String(v.lang).slice(0, 2).toLowerCase() === lang.slice(0, 2)) s += 5;
      if (web.gender === 'female' && FEMALE.test(name)) s += 30;
      if (web.gender === 'male' && MALE.test(name)) s += 30;
      if (web.gender === 'female' && MALE.test(name) && !FEMALE.test(name)) s -= 30;
      if (web.gender === 'male' && FEMALE.test(name) && !MALE.test(name)) s -= 30;
      return s;
    }
    var best = null, bs = -1e9;
    pool.forEach(function (v) { var s = score(v); if (s > bs) { bs = s; best = v; } });
    return best;
  }
  function speakWeb(entry, item) {
    try {
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') { finish(entry); return false; }
      var text = filled(item.text);
      if (!text) { finish(entry); return false; }
      var web = V.profile(item.speaker, item.kind).web || {};
      var u = new SpeechSynthesisUtterance(text);
      var v = pickVoice(web);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = web.lang || 'en-US';
      u.pitch = Math.max(0, Math.min(2, web.pitch == null ? 1 : web.pitch));
      u.rate = Math.max(0.5, Math.min(2, web.rate == null ? 1 : web.rate));
      u.volume = outVolume();
      u.onstart = function () { if (cur === entry) duck(true); };
      u.onend = u.onerror = function () { finish(entry); };
      entry.utter = u;
      cur = entry;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      V.lastSource = 'web';
      return true;
    } catch (e) { cur = null; finish(entry); return false; }
  }
  try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices(); } catch (e) { /* warm the voice list */ }

  // ---- public speaking calls ------------------------------------------
  V.say = function (speaker, text, opts) {
    try {
      opts = opts || {};
      if (!opts.queue) V.stop();
      if (!V.enabled() || !speaker || text == null || !String(text).trim()) return null;
      var item = { speaker: speaker, text: text, onend: opts.onend, noFallback: !!opts.noFallback, kind: opts.kind };
      if (opts.queue && (cur || startTimer != null || queue.length)) { queue.push(item); return { queued: true }; }
      var delay = opts.delay == null ? 120 : opts.delay;
      var clip = V.lookup(speaker, text);
      var canClip = clip && typeof Audio !== 'undefined';
      var canWeb = !opts.noFallback && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
      if (!canClip && !canWeb && !(clip && clip.silent)) return null;   // nothing can play this line
      if (delay > 0) {
        startTimer = setTimeout(function () { startTimer = null; start(item); }, delay);
        return clip ? { clip: true, dur: clip.dur } : { clip: false, dur: V.duration(speaker, text) };
      }
      return start(item);
    } catch (e) { return null; }
  };
  V.sayLines = function (speaker, lines) {
    try {
      V.stop();
      (lines || []).forEach(function (l, i) { V.say(speaker, l, { queue: i > 0, delay: i ? 0 : 150 }); });
    } catch (e) { /* silent */ }
  };
  // items: [{ speaker, text }]
  V.sayAll = function (items) {
    try {
      V.stop();
      (items || []).forEach(function (it, i) { V.say(it.speaker, it.text, { queue: i > 0, delay: i ? 0 : 150, kind: it.kind }); });
    } catch (e) { /* silent */ }
  };
  // Duel speech bubbles don't say who is talking: find the speaker that owns the clip.
  V.speakerOf = function (text) {
    var all = clips();
    for (var sp in all) if (V.lookup(sp, text)) return sp;
    return null;
  };
  // v2.1 A2: clip length in ms of a duel line (0 = no clip, nothing is spoken). Read from the
  // manifest, so every machine in a realm gets the same number whether or not its voice is on.
  V.lineMs = function (text, speaker) {
    try {
      var sp = speaker && V.lookup(speaker, text) ? speaker : V.speakerOf(text);
      var c = sp ? V.lookup(sp, text) : null;
      return c && c.dur > 0 ? Math.round(c.dur * 1000) : 0;
    } catch (e) { return 0; }
  };
  // v2.1 A2: how long a duel waits after an enemy line: the reading time (minMs x pace) or the
  // clip plus a short tail, whichever is longer. Pure (tests/v21-fixes.test.js).
  V.SPEECH_TAIL_MS = 350;
  V.speechWaitMs = function (text, minMs, pace) {
    var read = Math.round((minMs || 0) * (pace || 1)), clip = V.lineMs(text);
    return Math.max(read, clip ? clip + V.SPEECH_TAIL_MS : 0);
  };
  V.sayAny = function (text, opts) {
    try {
      var sp = V.speakerOf(text);
      if (!sp) return null;                       // unknown line: stay quiet (no robot monsters)
      return V.say(sp, text, opts || { delay: 0 });
    } catch (e) { return null; }
  };

  // Stop talking when the window is hidden (alt-tab) so lines don't pile up
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () { if (document.hidden) V.stop(); });
    }
  } catch (e) { /* silent */ }

  return V;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WF.voice;
