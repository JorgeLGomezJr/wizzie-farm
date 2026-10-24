// =====================================================================
//  WIZZIE FARM — REALMS PROTOCOL  (WF.net.protocol)   v2.0 WS-C
//  Pure helpers shared by host and guests (no DOM, no THREE; runs in Node):
//    * join codes ("lantern sigils"): make / normalize / format / SVG
//    * message envelope { v, t, ... } + version check
//    * the canonical duel view + FNV-1a hash used to detect desyncs
//    * the guest's MIRROR battle: a WF.Battle built from the same setup that
//      never resolves anything itself; the host's display snapshots are
//      copied into it so previews / canCast / nameplates work on guests.
//  Design: docs/design/realms.md §2, §4, §7.
// =====================================================================
(function (root) {
  'use strict';
  root.WF = root.WF || { data: {} };
  var WF = root.WF;
  WF.net = WF.net || {};

  function cfg() { return (WF.data && WF.data.realms) || {}; }
  var DEFAULT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function alphabet() { return cfg().alphabet || DEFAULT_ALPHABET; }
  function codeLen() { return cfg().codeLength || 6; }
  function version() { return cfg().protocol || 1; }

  // ---------------- join codes ----------------
  // rng: optional () => [0,1). Browser default = crypto.getRandomValues.
  function makeCode(rng) {
    var A = alphabet(), n = codeLen(), out = '', i;
    var cr = root.crypto && root.crypto.getRandomValues ? root.crypto : null;
    var buf = !rng && cr ? cr.getRandomValues(new Uint32Array(n)) : null;
    for (i = 0; i < n; i++) {
      var r = buf ? buf[i] / 4294967296 : (rng || Math.random)();
      out += A.charAt(Math.floor(r * A.length) % A.length);
    }
    return out;
  }
  // Forgiving input: case, spaces, dots, dashes, middle dots ignored. null = invalid.
  function normalizeCode(text) {
    if (text == null) return null;
    var s = String(text).toUpperCase().replace(/[\s.\-_·•]/g, '');
    if (s.length !== codeLen()) return null;
    var A = alphabet();
    for (var i = 0; i < s.length; i++) if (A.indexOf(s.charAt(i)) < 0) return null;
    return s;
  }
  // "K7Q4MD" -> "K7Q·4MD"
  function formatCode(code) {
    var c = String(code || ''), h = Math.ceil(c.length / 2);
    return c.slice(0, h) + '·' + c.slice(h);
  }
  function peerId(code) { return (cfg().peerPrefix || 'wizziefarm-r1-') + code; }

  // ---------------- lantern sigil (SVG string, deterministic) ----------------
  // Six runes in a ring around a glowing lantern. Each rune = one symbol: a stem
  // plus up to five strokes chosen by the 5 bits of the symbol's index.
  function runePath(idx, cx, cy, s) {
    var d = 'M' + cx + ' ' + (cy - s) + 'V' + (cy + s);          // stem
    var b = idx + 1;                                             // never an empty rune
    if (b & 1) d += 'M' + cx + ' ' + (cy - s) + 'L' + (cx - s * 0.7) + ' ' + (cy - s * 0.35);
    if (b & 2) d += 'M' + cx + ' ' + (cy - s) + 'L' + (cx + s * 0.7) + ' ' + (cy - s * 0.35);
    if (b & 4) d += 'M' + (cx - s * 0.55) + ' ' + cy + 'H' + (cx + s * 0.55);
    if (b & 8) d += 'M' + cx + ' ' + (cy + s) + 'L' + (cx - s * 0.6) + ' ' + (cy + s * 0.4);
    if (b & 16) d += 'M' + cx + ' ' + (cy + s) + 'L' + (cx + s * 0.6) + ' ' + (cy + s * 0.4);
    if (b & 32) d += 'M' + (cx - s * 0.35) + ' ' + (cy - s * 0.15) + 'L' + (cx + s * 0.35) + ' ' + (cy + s * 0.25);
    return d;
  }
  function sigilSVG(code, size) {
    size = size || 132;
    var A = alphabet(), c = String(code || ''), R = 46, parts = [];
    parts.push('<svg class="rl-sigil" viewBox="0 0 120 120" width="' + size + '" height="' + size + '" role="img" aria-label="Lantern sigil ' + formatCode(c) + '">');
    parts.push('<defs><radialGradient id="rlg"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.45" stop-color="#ffcf5a" stop-opacity="0.9"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>');
    parts.push('<circle cx="60" cy="60" r="56" fill="none" stroke="#e8c87a" stroke-opacity="0.55" stroke-width="1.5"/>');
    parts.push('<circle cx="60" cy="60" r="36" fill="none" stroke="#e8c87a" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 4"/>');
    parts.push('<circle cx="60" cy="60" r="24" fill="url(#rlg)"/>');
    // the lantern: cap, glass, base
    parts.push('<path d="M53 46h14l-2 -5h-10z M52 48h16v22h-16z M50 70h20v4h-20z" fill="#3b2a18" fill-opacity="0.9" stroke="#e8c87a" stroke-width="1.2"/>');
    parts.push('<path d="M55 51h10v16h-10z" fill="#ffe08a"/><path d="M60 54c3 3 3 7 0 10c-3 -3 -3 -7 0 -10z" fill="#fff8e0"/>');
    for (var i = 0; i < c.length; i++) {
      var a = -Math.PI / 2 + i * Math.PI * 2 / c.length;
      var x = Math.round((60 + Math.cos(a) * R) * 10) / 10, y = Math.round((60 + Math.sin(a) * R) * 10) / 10;
      parts.push('<path d="' + runePath(A.indexOf(c.charAt(i)), x, y, 7) + '" fill="none" stroke="#ffe7a8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  // ---------------- message envelope ----------------
  function msg(t, payload) {
    var m = { v: version(), t: t };
    if (payload) for (var k in payload) if (k !== 'v' && k !== 't') m[k] = payload[k];
    return m;
  }
  // ok if it looks like one of ours with our protocol major
  function valid(m) { return !!m && typeof m === 'object' && typeof m.t === 'string' && m.v === version(); }

  // ---------------- canonical duel view + hash (§7) ----------------
  function fx(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var e = list[i];
      out.push([e.name, e.kind || '', e.value != null ? e.value : (e.amt != null ? e.amt : 0), e.affects || '', e.rounds != null ? e.rounds : -1]);
    }
    return out;
  }
  function viewOfState(round, result, comb, hands) {
    var c = [];
    for (var i = 0; i < comb.length; i++) {
      var s = comb[i];
      c.push([s.hp, s.maxHp, s.mana, s.maxMana, s.pips, s.bright || 0, s.alive ? 1 : 0, s.absorb || 0, s.fled ? 1 : 0,
        fx(s.charms), fx(s.wards), fx(s.dots), fx(s.hots)]);
    }
    var h = [];
    for (var k = 0; k < hands.length; k++) h.push((hands[k] || []).map(function (x) { return x.uid + ':' + x.cardId; }));
    return { r: round, res: result || null, c: c, h: h };
  }
  // The view of a live (host) or mirror (guest) WF.Battle.
  function viewOfBattle(b) {
    var hands = [];
    for (var s = 0; s < b.kits.length; s++) hands.push(b.kits[s].hand);
    return viewOfState(b.round, b.result, b.combatants, hands);
  }
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function hashBattle(b) { return fnv1a(JSON.stringify(viewOfBattle(b))); }

  // ---------------- duel setup + mirror battle ----------------
  // The host sends `setup` = { players: [Battle player opts], enemies: [ids] } with the
  // duel's start stream. A guest builds the SAME combatants (no rng is ever used for
  // anything shown: the state is overwritten from the host's snapshots).
  function mirrorBattle(setup) {
    var players = (setup.players || []).map(function (p) {
      var c = {}; for (var k in p) c[k] = p[k];
      c.deck = {}; c.tcs = p.tcs || {};       // decks stay private to the host's battle
      return c;
    });
    var b = new WF.Battle({ players: players, enemies: setup.enemies.slice(), rng: function () { return 0.5; }, snapshots: false,
      enemyMods: setup.mode && setup.mode.enemyMods ? setup.mode.enemyMods : undefined });   // v2.1 D16 Heroic (the host's mode)
    b.started = true; b.mirror = true;
    return b;
  }
  // Copy one display snapshot (an event's `snap`) into the mirror.
  function applySnap(b, snap) {
    if (!snap) return;
    for (var i = 0; i < snap.length && i < b.combatants.length; i++) {
      var s = snap[i], c = b.combatants[i];
      c.hp = s.hp; c.maxHp = s.maxHp; c.mana = s.mana; c.maxMana = s.maxMana;
      c.pips = s.pips; c.bright = s.bright || 0; c.alive = s.alive; c.absorb = s.absorb || 0;
      c.charms = clone(s.charms || []); c.wards = clone(s.wards || []); c.dots = clone(s.dots || []); c.hots = clone(s.hots || []);
      if (s.fled) c.fled = true; else delete c.fled;
    }
  }
  // Apply a host event stream to a mirror: snapshots, rounds, result, then the
  // authoritative hands / scrolls the host sent with it.
  function applyStream(b, events, hands, tcs, left) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.t === 'summon' && b.mirrorSummon) b.mirrorSummon(e);   // v2.1 D15: before its snapshot
      if (e.snap) applySnap(b, e.snap);
      if (e.t === 'round') b.round = e.n;
      if (e.t === 'end') b.result = e.result;
    }
    if (hands) for (var s = 0; s < b.kits.length; s++) b.kits[s].hand = clone(hands[s] || []);
    if (tcs) for (var t = 0; t < b.kits.length; t++) if (tcs[t]) b.kits[t].tcs = clone(tcs[t]);
    if (left) for (var d = 0; d < b.kits.length; d++) if (typeof left[d] === 'number') b.kits[d].leftCount = Math.max(0, Math.floor(left[d]));   // v2.1 A5
  }
  // Full state for a resync / reconnect (host -> guest)
  function fullState(b) {
    return {
      round: b.round, result: b.result,
      comb: b.combatants.map(function (c) {
        return { hp: c.hp, maxHp: c.maxHp, mana: c.mana, maxMana: c.maxMana, pips: c.pips, bright: c.bright || 0, alive: c.alive,
          absorb: c.absorb || 0, fled: !!c.fled, charms: clone(c.charms), wards: clone(c.wards), dots: clone(c.dots), hots: clone(c.hots) };
      }),
      hands: b.kits.map(function (k) { return clone(k.hand); }),
      tcs: b.kits.map(function (k) { return clone(k.tcs); }),
      left: leftOf(b),   // v2.1 A5
      // v2.1 D15: every enemy by seat index, so a guest that (re)syncs after a summon adds the helpers
      foes: b.combatants.filter(function (c) { return !c.isPlayer; }).map(function (c) { return [c.enemyId, c.idx, c.joinRound == null ? null : c.joinRound]; })
    };
  }
  function applyFull(b, st) {
    (st.foes || []).forEach(function (f) {
      if (!Array.isArray(f) || f[1] !== b.combatants.length || !b.mirrorSummon) return;
      b.mirrorSummon({ enemies: [f[0]], idxs: [f[1]] });
      var c = b.combatants[f[1]];
      if (c && c.enemyId === f[0]) { if (typeof f[2] === 'number') c.joinRound = f[2]; else delete c.joinRound; }
    });
    applySnap(b, st.comb);
    b.round = st.round; b.result = st.result || null;
    for (var s = 0; s < b.kits.length; s++) {
      b.kits[s].hand = clone(st.hands[s] || []); b.kits[s].tcs = clone((st.tcs || [])[s] || {});
      if (st.left && typeof st.left[s] === 'number') b.kits[s].leftCount = Math.max(0, Math.floor(st.left[s]));   // v2.1 A5
    }
  }
  // v2.1 A5: cards left in every seat's draw pile (only the count leaves the host, never the cards)
  function leftOf(b) { return b.kits.map(function (k, i) { return b.deckLeft ? b.deckLeft(i) : k.drawPile.length; }); }
  function handsOf(b) { return b.kits.map(function (k) { return k.hand.map(function (h) { return { uid: h.uid, cardId: h.cardId }; }); }); }
  function tcsOf(b) { return b.kits.map(function (k) { return clone(k.tcs); }); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  WF.net.protocol = {
    version: version, makeCode: makeCode, normalizeCode: normalizeCode, formatCode: formatCode, peerId: peerId,
    sigilSVG: sigilSVG, msg: msg, valid: valid,
    viewOfBattle: viewOfBattle, hashBattle: hashBattle, fnv1a: fnv1a,
    mirrorBattle: mirrorBattle, applySnap: applySnap, applyStream: applyStream, leftOf: leftOf,
    fullState: fullState, applyFull: applyFull, handsOf: handsOf, tcsOf: tcsOf, clone: clone
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = WF.net.protocol;
})(typeof window !== 'undefined' ? window : global);
