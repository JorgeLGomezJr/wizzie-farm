// =====================================================================
//  WIZZIE FARM — REALM SESSIONS  (WF.net.RealmHost / WF.net.RealmGuest)   v2.0 WS-C
//  The host's game is the authority (combat rolls, enemy AI, timers); up to two
//  friends join with a lantern sigil code. Design: docs/design/realms.md.
//
//  Pure logic: no DOM, no THREE. Talks through a transport (WF.net.transport:
//  loopback in tests, webrtc in the game) and a clock { now, setTimeout,
//  clearTimeout } (real timers by default, a fake one in tests/realm-sim.js).
//  The browser glue (game/js/net/realmUI.js) listens to the events below and
//  drives the world / duel screen; the headless simulation does the same with
//  plain functions.
//
//  HOST   var h = new WF.net.RealmHost({ transport, me: { name, school, level, look, game }, rng, clock });
//         h.open(cb(err, code))   h.close()   h.kick(seat)
//         h.sendPresence(p)   h.setZone(zone, arrive)   h.campDefeated(zone, groupId)
//         h.startDuel({ groupId, enemies, seats, player })   h.plan(action)   h.ready(seq)
//  GUEST  var g = new WF.net.RealmGuest({ transport, me, clock });
//         g.join(code, cb(err, welcome))   g.leave()
//         g.sendPresence(p)   g.aggro(groupId)   g.sendLoadout(duelId, playerOpts|null)
//         g.plan(action)   g.ready(seq)
//  BOTH   .on(type, fn)  .members  .seat  .state   .offerPet(toSeat, summary) / .acceptPet(offer, summary)
//  Events: 'roster' {members}, 'joined'/'left'/'away'/'back' {seat, name}, 'presence' {pres},
//          'zone' {zone, arrive}, 'camps' {zone, dead}, 'aggro' {seat, groupId} (host),
//          'duelInvite' {duelId, groupId, enemies} (guest), 'duelEvents' {duelId, seq, events, battle, bseat},
//          'duelTurn' {duelId, round, ms, waiting}, 'duelPlanned' {seats}, 'duelEnd' {...},
//          'duelSync' (guest healed a desync), 'desync' {seq, want, got}, 'state' {state, reason},
//          'petOffer' / 'petAccept' / 'emote'.
// =====================================================================
(function (root) {
  'use strict';
  root.WF = root.WF || { data: {} };
  var WF = root.WF;
  WF.net = WF.net || {};
  function cfg() { return (WF.data && WF.data.realms) || {}; }
  function P() { return WF.net.protocol; }
  function realClock() {
    return {
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (h) { clearTimeout(h); }
    };
  }
  function token() { return P().makeCode() + P().makeCode(); }
  function memberView(m) { return { seat: m.seat, name: m.name, school: m.school, level: m.level, look: m.look || null, away: !!m.away, rtt: m.rtt || null }; }

  // ---- tiny event emitter ----
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (t, fn) { (this._h[t] = this._h[t] || []).push(fn); return this; };
  Emitter.prototype.off = function (t, fn) { var l = this._h[t]; if (l) this._h[t] = l.filter(function (f) { return f !== fn; }); };
  Emitter.prototype.emit = function (t, a) {
    var l = this._h[t]; if (!l) return;
    l.slice().forEach(function (fn) { try { fn(a); } catch (e) { if (typeof console !== 'undefined') console.error('[realm] ' + t + ' handler', e); } });
  };
  function inherit(C) { C.prototype = Object.create(Emitter.prototype); C.prototype.constructor = C; }

  // =================================================================
  //  HOST
  // =================================================================
  function RealmHost(opts) {
    Emitter.call(this);
    opts = opts || {};
    this.T = opts.transport;
    this.clock = opts.clock || realClock();
    this.rng = opts.rng || Math.random;
    this.me = opts.me || {};
    this.code = null;
    this.server = null;
    this.state = 'idle';               // idle | opening | open | closed
    this.seat = 0;
    this.members = [{ seat: 0, name: this.me.name || 'Host', school: this.me.school, level: this.me.level, look: this.me.look || null, link: null, host: true }];
    this.presence = {};                // seat -> last pres
    this.zone = this.me.zone || null;
    this.dead = {};                    // zone -> { groupId: true } camps the party beat (shared with guests)
    this.duel = null;
    this._duelNo = 0;
    this.stats = { desyncReports: 0, syncsSent: 0 };
  }
  inherit(RealmHost);
  WF.net.RealmHost = RealmHost;

  RealmHost.prototype.open = function (cb, tries) {
    var self = this;
    tries = tries || 0;
    var code = (tries === 0 && this.me.code) ? this.me.code : P().makeCode();
    this.state = 'opening';
    this.emit('state', { state: 'opening' });
    this.T.listen(code, function (err, server) {
      if (err === 'taken' && tries < 4) return self.open(cb, tries + 1);   // somebody holds that sigil: roll another
      if (err) { self.state = 'idle'; self.emit('state', { state: 'idle', reason: err }); return cb && cb(err); }
      self.server = server; self.code = code; self.state = 'open';
      server.onConnection(function (link) { self._incoming(link); });
      self.emit('state', { state: 'open', code: code });
      if (cb) cb(null, code);
    });
  };

  RealmHost.prototype.close = function () {
    if (this.state === 'closed' || this.state === 'idle') { this.state = 'closed'; return; }
    var self = this;
    this.state = 'closing';
    this._endDuelTimers();
    this.members.forEach(function (m) {
      if (m.link) { m.bye = true; self._sendAndClose(m.link, P().msg('bye', { reason: 'closed' })); }
      if (m.awayTimer) self.clock.clearTimeout(m.awayTimer);
    });
    if (this.server) this.server.close();
    this.members = this.members.slice(0, 1);
    this.state = 'closed';
    this.duel = null;
    this.emit('state', { state: 'closed' });
  };

  // Send a last message, then close the link a moment later (a WebRTC close can drop
  // whatever is still buffered, so the friend would miss the reason).
  RealmHost.prototype._sendAndClose = function (link, m) {
    link.send(m);
    var clock = this.clock;
    clock.setTimeout(function () { link.close('bye'); }, 400);
  };
  RealmHost.prototype.roster = function () { return this.members.map(memberView); };
  RealmHost.prototype.member = function (seat) { for (var i = 0; i < this.members.length; i++) if (this.members[i].seat === seat) return this.members[i]; return null; };
  RealmHost.prototype._send = function (seat, m) { var mem = this.member(seat); if (mem && mem.link && !mem.away) mem.link.send(m); };
  RealmHost.prototype._broadcast = function (m, exceptSeat) {
    for (var i = 0; i < this.members.length; i++) {
      var mem = this.members[i];
      if (mem.link && !mem.away && mem.seat !== exceptSeat) mem.link.send(m);
    }
  };
  RealmHost.prototype._pushRoster = function () {
    var r = this.roster();
    this._broadcast(P().msg('roster', { members: r }));
    this.emit('roster', { members: r });
  };
  RealmHost.prototype._freeSeat = function () {
    var max = cfg().maxPlayers || 3;
    for (var s = 1; s < max; s++) if (!this.member(s)) return s;
    return -1;
  };

  // A new link: the first message must be hello.
  RealmHost.prototype._incoming = function (link) {
    var self = this, mem = null;
    link.on('message', function (m) {
      if (!mem) {
        if (!m || m.t !== 'hello') return;
        mem = self._hello(link, m);
        return;
      }
      if (mem.link !== link) return;   // an old link of a seat that reconnected
      self._fromGuest(mem, m);
    });
    link.on('close', function (reason) {
      if (self.state !== 'open') return;                 // closing the realm: no per-friend noise
      if (mem && mem.link === link) self._lost(mem, reason);
    });
  };

  // v2.0 review M3/M4: a friend's numbers are clamped before they reach the host's battle or page
  // (a modified game could otherwise send a billion-card deck or HTML in `level`).
  function lvl(v, dflt) { var n = Math.floor(+v); return isFinite(n) && n >= 1 ? Math.min(n, 999) : (dflt || 1); }
  function num(v, lo, hi, dflt) { var n = +v; return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  RealmHost.sanitizeLoadout = function (pl) {
    if (!pl || typeof pl !== 'object') return null;
    var out = {}, k;
    for (k in pl) if (Object.prototype.hasOwnProperty.call(pl, k)) out[k] = pl[k];
    out.name = String(pl.name || 'Wizard').slice(0, 24);
    out.level = lvl(pl.level);
    out.maxHp = Math.round(num(pl.maxHp, 1, 1e5, 1)); out.hp = Math.round(num(pl.hp, 0, out.maxHp, out.maxHp));
    out.maxMana = Math.round(num(pl.maxMana, 0, 1e5, 0)); out.mana = Math.round(num(pl.mana, 0, out.maxMana, out.maxMana));
    ['dmg', 'resist', 'acc', 'brightPip', 'pipSurge'].forEach(function (f) { out[f] = num(pl[f], -5, 5, 0); });
    out.flatDmg = Math.round(num(pl.flatDmg, 0, 1000, 0));
    function counts(o, max, total) {
      var r = {}, n = 0;
      if (!o || typeof o !== 'object') return r;
      Object.keys(o).forEach(function (id) {
        if (id === '__proto__' || id === 'constructor' || id === 'prototype') return;
        var c = Math.floor(+o[id]);
        if (!isFinite(c) || c <= 0 || n >= total) return;
        c = Math.min(c, max, total - n); r[id] = c; n += c;
      });
      return r;
    }
    out.deck = counts(pl.deck, 12, 160);     // deck rules: 6 copies (+ pet cards), well under 160 cards
    out.tcs = counts(pl.tcs, 99, 400);
    return out;
  };
  RealmHost.prototype._hello = function (link, m) {
    var self = this;
    if (!P().valid(m) || m.game !== this.me.game) {
      this._sendAndClose(link, P().msg('reject', { reason: 'version', game: this.me.game }));
      return null;
    }
    if (this.state !== 'open') { this._sendAndClose(link, P().msg('reject', { reason: 'closed' })); return null; }
    // reconnect: a token that matches a seat kept for a friend who dropped
    if (m.token) {
      for (var i = 0; i < this.members.length; i++) {
        var old = this.members[i];
        if (old.token && old.token === m.token) {
          if (old.awayTimer) { this.clock.clearTimeout(old.awayTimer); old.awayTimer = null; }
          // v2.0 review m5: swap the link BEFORE closing the old one, so its close event is not taken as "lost"
          var prev = old.link;
          old.link = link; old.away = false;
          if (prev && prev !== link) prev.close('replaced');
          if (m.who) { old.level = lvl(m.who.level, old.level); old.look = m.who.look || old.look; }
          link.send(P().msg('welcome', { seat: old.seat, token: old.token, roster: this.roster(), zone: this.zone, dead: this._deadList(), resume: true, code: this.code }));
          this._pushRoster();
          this.emit('back', { seat: old.seat, name: old.name });
          // v2.0 review M1: during the loadout phase there is no order yet
          if (this.duel && this.duel.order && this.duel.order.indexOf(old.seat) >= 0) this._sendSync(old.seat);
          // v2.0 review M2: the duel ended while this friend was away: resend its end (the guest ignores repeats)
          else if (this.lastEnd && this.lastEnd[old.seat]) link.send(this.lastEnd[old.seat]);
          return old;
        }
      }
    }
    var seat = this._freeSeat();
    if (seat < 0) { this._sendAndClose(link, P().msg('reject', { reason: 'full' })); return null; }
    var who = m.who || {};
    var mem = { seat: seat, name: String(who.name || 'Wizard').slice(0, 24), school: who.school, level: lvl(who.level), look: who.look || null, link: link, token: token(), away: false };
    this.members.push(mem);
    this.members.sort(function (a, b) { return a.seat - b.seat; });
    link.send(P().msg('welcome', { seat: seat, token: mem.token, roster: this.roster(), zone: this.zone, dead: this._deadList(), resume: false, code: this.code }));
    // everyone already here: where they are
    for (var s in this.presence) link.send(P().msg('pres', { pres: this.presence[s] }));
    this._pushRoster();
    self.emit('joined', { seat: seat, name: mem.name });
    return mem;
  };

  RealmHost.prototype._lost = function (mem, reason) {
    if (mem.bye) { this._remove(mem, 'left'); return; }
    var self = this;
    mem.away = true; mem.link = null;
    this._pushRoster();
    this.emit('away', { seat: mem.seat, name: mem.name });
    this._duelSeatAway(mem.seat);
    mem.awayTimer = this.clock.setTimeout(function () { mem.awayTimer = null; if (mem.away) self._remove(mem, 'timeout'); }, (cfg().reconnectSeconds || 60) * 1000);
  };
  RealmHost.prototype._remove = function (mem, why) {
    if (mem.removed) return;
    mem.removed = true;
    if (mem.awayTimer) { this.clock.clearTimeout(mem.awayTimer); mem.awayTimer = null; }
    this.members = this.members.filter(function (m) { return m !== mem; });
    delete this.presence[mem.seat];
    this._broadcast(P().msg('gone', { seat: mem.seat }));
    this._pushRoster();
    this.emit('left', { seat: mem.seat, name: mem.name, why: why });
    this._duelSeatAway(mem.seat);
  };
  RealmHost.prototype.kick = function (seat) {
    var mem = this.member(seat);
    if (!mem || mem.host) return false;
    if (mem.link) { mem.bye = true; this._sendAndClose(mem.link, P().msg('bye', { reason: 'kicked' })); }
    this._remove(mem, 'kicked');
    return true;
  };

  RealmHost.prototype._fromGuest = function (mem, m) {
    if (!P().valid(m)) return;
    var D = this.duel;
    switch (m.t) {
      case 'pres':
        if (!m.pres) return;
        m.pres.seat = mem.seat;
        this.presence[mem.seat] = m.pres;
        this._broadcast(P().msg('pres', { pres: m.pres }), mem.seat);
        this.emit('presence', { pres: m.pres });
        break;
      case 'look':
        mem.look = m.look || mem.look; mem.level = lvl(m.level, mem.level);
        this._pushRoster();
        break;
      case 'aggro': this.emit('aggro', { seat: mem.seat, groupId: m.groupId }); break;
      case 'duel:loadout': if (D && D.id === m.duelId) this._loadout(mem.seat, m.player); break;
      case 'duel:plan': this._plan(mem.seat, m); break;
      case 'duel:discard':
        if (D && D.id === m.duelId && D.phase === 'plan' && this._bseat(mem.seat) >= 0) D.battle.discard(m.uid, this._bseat(mem.seat));
        break;
      case 'duel:ready': if (D && D.id === m.duelId) this._ready(mem.seat, m.seq); break;
      case 'duel:syncReq': this.stats.desyncReports++; if (D && D.id === m.duelId) this._sendSync(mem.seat); break;
      case 'ping': mem.link.send(P().msg('pong', { ts: m.ts })); break;
      case 'pong': mem.rtt = Math.max(0, this.clock.now() - (m.ts || 0)); break;
      case 'bye': mem.bye = true; this._remove(mem, 'left'); if (mem.link) mem.link.close('bye'); break;
      case 'emote': case 'pet:offer': case 'pet:accept': case 'pet:egg': case 'pet:cancel':
        m.from = mem.seat;
        if (m.to === 0) this._local(m); else if (m.to != null) this._send(m.to, m); else { this._broadcast(m, mem.seat); this._local(m); }
        break;
    }
  };
  RealmHost.prototype._local = function (m) {
    var map = { emote: 'emote', 'pet:offer': 'petOffer', 'pet:accept': 'petAccept', 'pet:egg': 'petEgg', 'pet:cancel': 'petCancel' };
    if (map[m.t]) this.emit(map[m.t], m);
  };

  // ---- world ----
  RealmHost.prototype.sendPresence = function (p) {
    p.seat = 0; this.presence[0] = p;
    if (p.zone) this.zone = p.zone;
    this._broadcast(P().msg('pres', { pres: p }));
  };
  RealmHost.prototype.updateMe = function (who) {
    var m = this.members[0];
    if (who.level) m.level = who.level;
    if (who.look) m.look = who.look;
    this._pushRoster();
  };
  // The party follows the host (V2.0-CONTRACT §4 default).
  RealmHost.prototype.setZone = function (zone, arrive) {
    this.zone = zone;
    this._broadcast(P().msg('zone', { zone: zone, arrive: arrive || null }));
  };
  RealmHost.prototype.campDefeated = function (zone, groupId) {
    var z = this.dead[zone] || (this.dead[zone] = {});
    z[groupId] = true;
    this._broadcast(P().msg('camps', { zone: zone, dead: [groupId] }));
  };
  RealmHost.prototype.campRespawned = function (zone, groupId) { if (this.dead[zone]) delete this.dead[zone][groupId]; };
  RealmHost.prototype._deadList = function () { var z = this.dead[this.zone] || {}; return { zone: this.zone, dead: Object.keys(z) }; };
  RealmHost.prototype.ping = function () { this._broadcast(P().msg('ping', { ts: this.clock.now() })); };
  RealmHost.prototype.emote = function (name) { var m = P().msg('emote', { from: 0, emote: name }); this._broadcast(m); };
  RealmHost.prototype.offerPet = function (to, summary) { var m = P().msg('pet:offer', { from: 0, to: to, offerId: 'h-' + (this._petNo = (this._petNo || 0) + 1), pet: summary }); this._send(to, m); return m.offerId; };
  RealmHost.prototype.acceptPet = function (offer, summary) { this._send(offer.from, P().msg('pet:accept', { from: 0, to: offer.from, offerId: offer.offerId, pet: summary })); };

  // =================================================================
  //  HOST: party duels (docs/design/realms.md §6)
  // =================================================================
  // opts: { groupId, enemies: [ids], seats: [realm seats incl. 0], player: Battle player opts of the host }
  RealmHost.prototype.startDuel = function (opts) {
    if (this.duel) return null;
    var self = this, id = 'd' + (++this._duelNo);
    var D = this.duel = { id: id, groupId: opts.groupId, enemies: opts.enemies.slice(), loadouts: {}, waitLoad: {}, order: null, battle: null,
      seq: 0, phase: 'invite', readyWait: null, timer: null, mode: cleanMode(opts.mode) };   // v2.1 D16: the HOST's dungeon mode (Heroic) for everyone
    D.loadouts[0] = opts.player;
    (opts.seats || []).forEach(function (s) {
      var mem = self.member(s);
      if (s === 0 || !mem || mem.away) return;
      D.waitLoad[s] = true;
      self._send(s, P().msg('duel:invite', { duelId: id, groupId: opts.groupId, enemies: D.enemies, seats: opts.seats }));
    });
    if (!Object.keys(D.waitLoad).length) this._beginDuel();
    else D.timer = this.clock.setTimeout(function () { if (self.duel === D && D.phase === 'invite') self._beginDuel(); }, (cfg().loadoutSeconds || 6) * 1000);
    return id;
  };
  RealmHost.prototype._loadout = function (seat, player) {
    var D = this.duel;
    if (!D || D.phase !== 'invite' || !D.waitLoad[seat]) return;
    delete D.waitLoad[seat];
    if (player) player = RealmHost.sanitizeLoadout(player);
    if (player) D.loadouts[seat] = player;          // null = "busy, sitting this one out"
    if (!Object.keys(D.waitLoad).length) this._beginDuel();
  };
  RealmHost.prototype._beginDuel = function () {
    var D = this.duel;
    if (D.timer) { this.clock.clearTimeout(D.timer); D.timer = null; }
    D.order = Object.keys(D.loadouts).map(Number).sort(function (a, b) { return a - b; });   // join order
    var players = D.order.map(function (s) { return D.loadouts[s]; });
    D.battle = new WF.Battle({ players: players, enemies: D.enemies, rng: this.rng, enemyMods: D.mode ? D.mode.enemyMods : undefined });
    D.setup = { players: players.map(function (p) { var c = P().clone(p); delete c.deck; return c; }), enemies: D.enemies };
    if (D.mode) D.setup.mode = D.mode;
    var ev = D.battle.start();
    this._stream(ev);
  };
  RealmHost.prototype._bseat = function (seat) { return this.duel ? this.duel.order.indexOf(seat) : -1; };
  RealmHost.prototype._stream = function (events) {
    var D = this.duel, b = D.battle, self = this;
    D.seq++;
    D.phase = 'stream';
    var payload = { duelId: D.id, seq: D.seq, round: b.round, result: b.result, events: events,
      hands: P().handsOf(b), tcs: P().tcsOf(b), left: P().leftOf(b), hash: P().hashBattle(b), order: D.order };
    if (D.seq === 1) { payload.setup = D.setup; payload.groupId = D.groupId; }
    var m = P().msg('duel:events', payload);
    D.readyWait = {};
    D.order.forEach(function (s) {
      var mem = self.member(s);
      if (s === 0) { D.readyWait[0] = true; return; }
      if (mem && !mem.away && mem.link) { mem.link.send(m); D.readyWait[s] = true; }
    });
    var seq = D.seq;
    if (b.result) {
      this.emit('duelEvents', { duelId: D.id, seq: seq, events: events, battle: b, bseat: 0, order: D.order });
      this._finishDuel();
      return;
    }
    // timers are armed BEFORE handlers run, so a handler that answers at once can't clobber them
    // The cap only stops a slow/frozen GUEST from stalling the party. The host's own playback is the
    // reference timing (it is the authority; if the host is slow, everyone waits for it).
    D.timer = this.clock.setTimeout(function () {
      if (self.duel !== D || D.phase !== 'stream' || D.seq !== seq || !D.readyWait) return;
      D.readyWait = D.readyWait[0] ? { 0: true } : {};
      self._checkReady();
    }, (cfg().readySeconds || 45) * 1000);
    this.emit('duelEvents', { duelId: D.id, seq: seq, events: events, battle: b, bseat: 0, order: D.order });
    if (this.duel === D && D.phase === 'stream' && D.seq === seq) this._checkReady();
  };
  RealmHost.prototype.ready = function (seq) { this._ready(0, seq); };
  RealmHost.prototype._ready = function (seat, seq) {
    var D = this.duel;
    if (!D || D.phase !== 'stream' || seq !== D.seq || !D.readyWait) return;
    delete D.readyWait[seat];
    this._checkReady();
  };
  RealmHost.prototype._checkReady = function () {
    var D = this.duel;
    if (D && D.phase === 'stream' && D.readyWait && !Object.keys(D.readyWait).length) this._openPlanning();
  };
  // v2.1 D16: a dungeon mode as it travels: { id, enemyMods: { hp, dmg }, gearMult } with sane numbers only
  function cleanMode(m) {
    if (!m || typeof m !== 'object' || !m.enemyMods) return null;
    var n = function (v, lo, hi) { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 1; };
    return { id: String(m.id || 'heroic').slice(0, 20), enemyMods: { hp: n(m.enemyMods.hp, 1, 5), dmg: n(m.enemyMods.dmg, 1, 5) }, gearMult: n(m.gearMult, 1, 5) };
  }
  WF.net.cleanMode = cleanMode;
  function noChoices(b, i) {
    if (!b.outOfCards || !b.outOfCards(i)) return false;
    var t = (b.kits[i] && b.kits[i].tcs) || {};
    return !Object.keys(t).some(function (k) { return t[k] > 0; });
  }
  RealmHost.prototype._openPlanning = function () {
    var D = this.duel, self = this, b = D.battle;
    if (D.timer) { this.clock.clearTimeout(D.timer); D.timer = null; }
    if (D.dryTimer) { this.clock.clearTimeout(D.dryTimer); D.dryTimer = null; }
    D.phase = 'plan';
    // friends who dropped pass automatically
    D.order.forEach(function (s, i) { var mem = self.member(s); if (s !== 0 && (!mem || mem.away) && b._standing(i)) b.submit(i, { type: 'pass', auto: true }); });
    var ms = (cfg().turnSeconds || 30) * 1000, round = b.round;
    D.deadline = this.clock.now() + ms;
    D.timer = this.clock.setTimeout(function () { if (self.duel === D && D.phase === 'plan' && b.round === round) self._resolve(); }, ms);
    // v2.1 A5: a wizard with no cards and no Spell Scrolls can only Pass or Flee; after a short beat
    // (time to click Flee) they pass, so the party isn't held for the whole turn every round
    var dry = [];
    for (var di = 0; di < b.players.length; di++) if (b._standing(di) && !b.planned(di) && noChoices(b, di)) dry.push(di);
    if (dry.length) {
      var dms = Math.min(ms, (cfg().outOfCardsSeconds || 5) * 1000);
      D.dryTimer = this.clock.setTimeout(function () {
        if (self.duel !== D || D.phase !== 'plan' || b.round !== round) return;
        dry.forEach(function (i) { if (b._standing(i) && !b.planned(i) && noChoices(b, i)) b.submit(i, { type: 'pass', auto: true }); });
        if (!b.waitingFor().length) self._resolve();
      }, dms);
    }
    var turn = { duelId: D.id, round: round, ms: ms, waiting: this._waitingSeats() };
    this._duelBroadcast(P().msg('duel:turn', turn));
    this.emit('duelTurn', turn);
    if (this.duel === D && D.phase === 'plan' && b.round === round && !b.waitingFor().length) this._resolve();
  };
  // Boss speeches: the host decides skips for everyone (V2.0-CONTRACT §0.6)
  RealmHost.prototype.skip = function () { if (this.duel) this._duelBroadcast(P().msg('duel:skip', { duelId: this.duel.id })); };
  RealmHost.prototype._waitingSeats = function () { var D = this.duel; return D.battle.waitingFor().map(function (i) { return D.order[i]; }); };
  RealmHost.prototype._duelBroadcast = function (m) {
    var self = this;
    this.duel.order.forEach(function (s) { if (s !== 0) self._send(s, m); });
  };
  RealmHost.prototype.plan = function (action) { return this._plan(0, { duelId: this.duel && this.duel.id, round: this.duel && this.duel.battle && this.duel.battle.round, action: action }); };
  RealmHost.prototype._plan = function (seat, m) {
    var D = this.duel, ack = function (self, ok, reason) { if (seat !== 0) self._send(seat, P().msg('duel:planAck', { duelId: m.duelId, round: m.round, ok: ok, reason: reason || '' })); return ok; };
    if (!D || D.id !== m.duelId || D.phase !== 'plan' || D.battle.round !== m.round) return ack(this, false, 'Not your turn to plan');
    var bs = this._bseat(seat);
    if (bs < 0) return ack(this, false, 'You are not in this duel');
    var a = m.action || { type: 'pass' };
    if (!D.battle.submit(bs, a)) return ack(this, false, D.battle.lastError);
    ack(this, true);
    var planned = D.order.filter(function (s, i) { return D.battle.planned(i); });
    this._duelBroadcast(P().msg('duel:planned', { duelId: D.id, round: D.battle.round, seats: planned }));
    this.emit('duelPlanned', { seats: planned });
    if (this.duel === D && D.phase === 'plan' && !D.battle.waitingFor().length) this._resolve();
    return true;
  };
  RealmHost.prototype._resolve = function () {
    var D = this.duel;
    if (D.timer) { this.clock.clearTimeout(D.timer); D.timer = null; }
    D.phase = 'resolving';
    this._stream(D.battle.resolveRound());
  };
  RealmHost.prototype._duelSeatAway = function (seat) {
    var D = this.duel;
    if (!D || !D.battle) { if (D && D.waitLoad && D.waitLoad[seat]) this._loadout(seat, null); return; }
    var bs = this._bseat(seat);
    if (bs < 0) return;
    if (D.phase === 'stream' && D.readyWait) { delete D.readyWait[seat]; this._checkReady(); }
    else if (D.phase === 'plan' && D.battle._standing(bs) && !D.battle.planned(bs)) {
      D.battle.submit(bs, { type: 'pass', auto: true });
      if (!D.battle.waitingFor().length) this._resolve();
    }
  };
  RealmHost.prototype._sendSync = function (seat) {
    var D = this.duel; if (!D || !D.battle) return;
    this.stats.syncsSent++;
    var st = { duelId: D.id, seq: D.seq, setup: D.setup, order: D.order, groupId: D.groupId, state: P().fullState(D.battle), hash: P().hashBattle(D.battle), phase: D.phase };
    if (D.phase === 'plan') { st.ms = Math.max(0, D.deadline - this.clock.now()); st.round = D.battle.round; st.waiting = this._waitingSeats(); }
    this._send(seat, P().msg('duel:sync', st));
  };
  RealmHost.prototype._finishDuel = function () {
    var D = this.duel, b = D.battle, seats = {};
    D.order.forEach(function (s, i) {
      var c = b.players[i];
      seats[s] = { outcome: b.outcome(i), hp: c.hp, mana: c.mana, tcsUsed: P().clone(b.kits[i].tcsUsed) };
    });
    var end = { duelId: D.id, result: b.result, seats: seats, enemies: D.enemies, groupId: D.groupId, rounds: b.round };
    if (D.mode) end.mode = D.mode;
    var endMsg = P().msg('duel:end', end), self = this;
    this.lastEnd = this.lastEnd || {};
    D.order.forEach(function (s) { self.lastEnd[s] = endMsg; });    // v2.0 review M2: resent to a friend who was away
    this._duelBroadcast(endMsg);
    D.phase = 'done';
    this.duel = null;
    if (b.result === 'win' && this.zone && D.groupId) this.campDefeated(this.zone, D.groupId);
    var mine = seats[0];
    this.emit('duelEnd', { duelId: D.id, result: b.result, outcome: mine.outcome, hp: mine.hp, mana: mine.mana, tcsUsed: mine.tcsUsed, enemies: D.enemies, groupId: D.groupId, seats: seats, rounds: b.round, mode: D.mode || null });
  };
  RealmHost.prototype._endDuelTimers = function () { if (this.duel && this.duel.timer) { this.clock.clearTimeout(this.duel.timer); this.duel.timer = null; } };

  // =================================================================
  //  GUEST
  // =================================================================
  function RealmGuest(opts) {
    Emitter.call(this);
    opts = opts || {};
    this.T = opts.transport;
    this.clock = opts.clock || realClock();
    this.me = opts.me || {};
    this.state = 'idle';               // idle | connecting | joined | reconnecting | left
    this.code = null; this.seat = -1; this.token = null; this.link = null;
    this.members = []; this.presence = {}; this.zone = null; this.dead = {};
    this.duel = null;                  // { id, mirror, order, bseat, lastSeq, round, groupId }
    this.stats = { desyncs: 0, syncs: 0, streams: 0 };
  }
  inherit(RealmGuest);
  WF.net.RealmGuest = RealmGuest;

  RealmGuest.prototype.join = function (code, cb) {
    var c = P().normalizeCode(code);
    if (!c) { if (cb) cb('badCode'); return; }
    this.code = c;
    this._setState('connecting');
    this._connect(false, cb);
  };
  RealmGuest.prototype._setState = function (s, reason) { this.state = s; this.emit('state', { state: s, reason: reason || null }); };
  RealmGuest.prototype._connect = function (resume, cb) {
    var self = this;
    this.T.connect(this.code, function (err, link) {
      if (err) { if (resume) return self._retry(); self._setState('idle', err); return cb && cb(err); }
      self._attach(link, resume, cb);
      link.send(P().msg('hello', { game: self.me.game, token: resume ? self.token : null, who: { name: self.me.name, school: self.me.school, level: self.me.level, look: self.me.look || null } }));
    });
  };
  RealmGuest.prototype._attach = function (link, resume, cb) {
    var self = this, answered = false;
    this.link = link;
    link.on('message', function (m) {
      if (self.link !== link || !P().valid(m)) {
        if (m && m.t === 'reject' && !answered) { answered = true; self._setState('idle', m.reason); if (cb) cb(m.reason); }
        return;
      }
      if (m.t === 'welcome') {
        answered = true;
        self.seat = m.seat; self.token = m.token; self.members = m.roster || []; self.zone = m.zone;
        if (m.dead && m.dead.zone) self.dead[m.dead.zone] = toSet(m.dead.dead);
        self._setState('joined');
        self.emit('roster', { members: self.members });
        if (resume) self.emit('reconnected', m); else if (cb) cb(null, m);
        if (m.zone) self.emit('zone', { zone: m.zone, arrive: null, initial: true });
        return;
      }
      if (m.t === 'reject') { answered = true; self._setState('idle', m.reason); if (cb && !resume) cb(m.reason); else self._gone(m.reason); return; }
      self._fromHost(m);
    });
    link.on('close', function (reason) {
      if (self.link !== link) return;
      self.link = null;
      if (self.state === 'left' || self.state === 'idle') return;
      if (self._bye || reason === 'bye') { self._gone(self._bye || 'closed'); return; }
      if (self.state === 'joined') { self._retryStart = self.clock.now(); self._tries = 0; self._setState('reconnecting'); self._retry(); }
      else if (!answered && cb && !resume) { self._setState('idle', 'timeout'); cb('timeout'); }
    });
  };
  function toSet(list) { var o = {}; (list || []).forEach(function (k) { o[k] = true; }); return o; }
  RealmGuest.prototype._retry = function () {
    var self = this, lim = (cfg().reconnectSeconds || 60) * 1000;
    if (this.state !== 'reconnecting') return;
    if (this.clock.now() - this._retryStart >= lim) { this._gone('closed'); return; }
    var bo = cfg().reconnectBackoff || [1, 2, 4, 8];
    var wait = bo[Math.min(this._tries++, bo.length - 1)] * 1000;
    this.clock.setTimeout(function () { if (self.state === 'reconnecting') self._connect(true); }, wait);
  };
  RealmGuest.prototype._gone = function (reason) {
    if (this.state === 'left') return;
    this.duel = null;
    this.members = []; this.presence = {};
    this._setState('left', reason || 'closed');
    this.emit('left', { seat: this.seat, reason: reason || 'closed', me: true });
  };
  RealmGuest.prototype.leave = function () {
    if (this.link) { this.link.send(P().msg('bye', { reason: 'left' })); var l = this.link; this.link = null; l.close('bye'); }
    this._gone('left');
  };
  RealmGuest.prototype._sendHost = function (m) { if (this.link && this.state === 'joined') { this.link.send(m); return true; } return false; };

  RealmGuest.prototype._fromHost = function (m) {
    switch (m.t) {
      case 'roster': this.members = m.members || []; this.emit('roster', { members: this.members }); break;
      case 'pres': if (m.pres && m.pres.seat !== this.seat) { this.presence[m.pres.seat] = m.pres; this.emit('presence', { pres: m.pres }); } break;
      case 'gone': delete this.presence[m.seat]; this.emit('gone', { seat: m.seat }); break;
      case 'zone': this.zone = m.zone; this.emit('zone', { zone: m.zone, arrive: m.arrive }); break;
      case 'camps': { var z = this.dead[m.zone] || (this.dead[m.zone] = {}); (m.dead || []).forEach(function (g) { z[g] = true; }); this.emit('camps', { zone: m.zone, dead: m.dead }); break; }
      case 'bye': this._bye = m.reason || 'closed'; break;
      case 'ping': this._sendHost(P().msg('pong', { ts: m.ts })); break;
      case 'duel:invite': this.emit('duelInvite', { duelId: m.duelId, groupId: m.groupId, enemies: m.enemies, seats: m.seats }); break;
      case 'duel:events': this._events(m); break;
      case 'duel:sync': this._sync(m); break;
      case 'duel:turn': if (this.duel && this.duel.id === m.duelId) { this.duel.round = m.round; this.duel.planning = true; this.emit('duelTurn', m); } break;
      case 'duel:planned': this.emit('duelPlanned', m); break;
      case 'duel:planAck': this.emit('planAck', m); break;
      case 'duel:skip': if (this.duel && this.duel.id === m.duelId) this.emit('duelSkip', m); break;
      case 'duel:end': this._end(m); break;
      case 'emote': this.emit('emote', m); break;
      case 'pet:offer': this.emit('petOffer', m); break;
      case 'pet:accept': this.emit('petAccept', m); break;
      case 'pet:egg': this.emit('petEgg', m); break;
      case 'pet:cancel': this.emit('petCancel', m); break;
    }
  };

  // ---- world ----
  RealmGuest.prototype.sendPresence = function (p) { p.seat = this.seat; return this._sendHost(P().msg('pres', { pres: p })); };
  RealmGuest.prototype.updateMe = function (who) { return this._sendHost(P().msg('look', { look: who.look, level: who.level })); };
  RealmGuest.prototype.aggro = function (groupId) { return this._sendHost(P().msg('aggro', { groupId: groupId })); };
  RealmGuest.prototype.emote = function (name) { return this._sendHost(P().msg('emote', { emote: name })); };
  RealmGuest.prototype.offerPet = function (to, summary) { var id = 'g' + this.seat + '-' + Date.now(); this._sendHost(P().msg('pet:offer', { to: to, offerId: id, pet: summary })); return id; };
  RealmGuest.prototype.acceptPet = function (offer, summary) { return this._sendHost(P().msg('pet:accept', { to: offer.from, offerId: offer.offerId, pet: summary })); };
  RealmGuest.prototype.isCampDead = function (zone, groupId) { return !!(this.dead[zone] && this.dead[zone][groupId]); };

  // ---- duels: mirror the host's stream ----
  RealmGuest.prototype.sendLoadout = function (duelId, player) { return this._sendHost(P().msg('duel:loadout', { duelId: duelId, player: player || null })); };
  RealmGuest.prototype._mirrorFor = function (m) {
    if (this.duel && this.duel.id === m.duelId) return this.duel;
    if (!m.setup) return null;
    this.duel = { id: m.duelId, mirror: P().mirrorBattle(m.setup), order: m.order, bseat: m.order.indexOf(this.seat), lastSeq: 0, round: 1, groupId: m.groupId, enemies: m.setup.enemies };
    return this.duel;
  };
  RealmGuest.prototype._events = function (m) {
    var D = this._mirrorFor(m);
    if (!D) { this._sendHost(P().msg('duel:syncReq', { duelId: m.duelId })); return; }
    if (m.seq !== D.lastSeq + 1) { this._sendHost(P().msg('duel:syncReq', { duelId: m.duelId })); return; }   // lost a stream
    this.stats.streams++;
    D.planning = false;
    P().applyStream(D.mirror, m.events, m.hands, m.tcs, m.left);
    D.lastSeq = m.seq;
    var got = P().hashBattle(D.mirror);
    if (got !== m.hash) {
      this.stats.desyncs++;
      this.emit('desync', { seq: m.seq, want: m.hash, got: got });
      this._sendHost(P().msg('duel:syncReq', { duelId: m.duelId }));
    }
    this.emit('duelEvents', { duelId: m.duelId, seq: m.seq, events: m.events, battle: D.mirror, bseat: D.bseat, order: D.order });
  };
  RealmGuest.prototype._sync = function (m) {
    if (!this.duel || this.duel.id !== m.duelId) {
      this.duel = { id: m.duelId, mirror: P().mirrorBattle(m.setup), order: m.order, bseat: m.order.indexOf(this.seat), lastSeq: 0, round: 1, groupId: m.groupId, enemies: m.setup.enemies };
    }
    var D = this.duel;
    P().applyFull(D.mirror, m.state);
    D.lastSeq = m.seq;
    this.stats.syncs++;
    var ok = P().hashBattle(D.mirror) === m.hash;
    this.emit('duelSync', { duelId: m.duelId, seq: m.seq, ok: ok, battle: D.mirror, bseat: D.bseat, phase: m.phase });
    if (m.phase === 'plan') { D.round = m.round; D.planning = true; this.emit('duelTurn', { duelId: m.duelId, round: m.round, ms: m.ms, waiting: m.waiting, resumed: true }); }
    else if (m.phase === 'stream') this.ready(m.seq);
  };
  RealmGuest.prototype.discard = function (uid) { if (!this.duel) return false; return this._sendHost(P().msg('duel:discard', { duelId: this.duel.id, uid: uid })); };
  RealmGuest.prototype.ready = function (seq) { if (this.duel) this._sendHost(P().msg('duel:ready', { duelId: this.duel.id, seq: seq })); };
  RealmGuest.prototype.plan = function (action) {
    if (!this.duel) return false;
    return this._sendHost(P().msg('duel:plan', { duelId: this.duel.id, round: this.duel.round, action: action }));
  };
  RealmGuest.prototype._end = function (m) {
    // v2.0 review M2: the host resends a duel's end after a reconnect; settle each duel only once
    this._ended = this._ended || {};
    if (this._ended[m.duelId]) return;
    this._ended[m.duelId] = true;
    var mine = (m.seats || {})[this.seat];
    if (m.result === 'win' && this.zone && m.groupId) { var z = this.dead[this.zone] || (this.dead[this.zone] = {}); z[m.groupId] = true; }
    this.duel = null;
    if (!mine) return;     // sat this duel out
    this.emit('duelEnd', { duelId: m.duelId, result: m.result, outcome: mine.outcome, hp: mine.hp, mana: mine.mana, tcsUsed: mine.tcsUsed, enemies: m.enemies, groupId: m.groupId, seats: m.seats, rounds: m.rounds, mode: cleanMode(m.mode) });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { RealmHost: RealmHost, RealmGuest: RealmGuest };
})(typeof window !== 'undefined' ? window : global);

// =====================================================================
//  Shared helpers (used by the browser glue AND tests/realm-sim.js, so the
//  simulation exercises the very code the game runs):
//    WF.net.realmLoadout(S)        -> Battle player opts of S.player (the active wizard)
//    WF.net.realmSettle(S, end, o) -> apply a finished party duel to S.player's OWN save:
//                                     health/mana, used scrolls, and on a win the player's
//                                     own loot roll + quest kills. Returns { loot, levelUps, quests }.
//  S is WF.state (the browser) or the same module loaded in Node.
// =====================================================================
(function (root) {
  'use strict';
  var WF = root.WF;
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  WF.net.realmLoadout = function (S) {
    var p = S.player, st = S.stats();
    var lo = null;
    try { lo = S.battleLoadout ? S.battleLoadout() : null; } catch (e) { lo = null; }
    if (!lo || !lo.deck) lo = { deck: p.deck, tcs: p.tcs };
    return {
      name: p.name, school: p.school, level: p.level,
      hp: Math.max(1, Math.round(p.hp)), maxHp: st.maxHp, mana: Math.floor(p.mana), maxMana: st.maxMana,
      dmg: st.dmg, resist: st.resist, acc: st.acc, brightPip: st.brightPip, pipSurge: st.pipSurge, flatDmg: st.flatDmg || 0,   // v2.0 pets: flat damage
      schoolStats: clone(st.schoolStats || { dmg: {}, resist: {}, acc: {} }), spellRanks: clone(p.spellRanks || {}),   // v2.0 M1 (WS-A): every seat's school stats + Runeglass ranks
      deck: clone(lo.deck || {}), tcs: clone(lo.tcs || {})
    };
  };
  // end = the 'duelEnd' event; o = { rng } (loot rolls are per player: each client its own rng)
  WF.net.realmSettle = function (S, end, o) {
    o = o || {};
    var p = S.player, out = { loot: null, levelUps: [], quests: [] };
    p.hp = Math.max(0, end.hp); p.mana = Math.max(0, end.mana);
    var used = end.tcsUsed || {};
    if (typeof S.consumeScrolls === 'function') S.consumeScrolls(used);
    else Object.keys(used).forEach(function (cid) { p.tcs[cid] = Math.max(0, (p.tcs[cid] || 0) - used[cid]); if (!p.tcs[cid]) delete p.tcs[cid]; });
    if (end.outcome === 'win') {
      out.loot = S.rollLoot(end.enemies, o.rng, null, end.mode ? { gearMult: end.mode.gearMult } : null);   // v2.1 D16
      out.levelUps = S.applyLoot(out.loot);
      end.enemies.forEach(function (eid) { out.quests = out.quests.concat(S.onKill(eid)); });
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : global);
