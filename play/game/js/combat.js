// =====================================================================
//  WIZZIE FARM — COMBAT RULES ENGINE  (WF.Battle)
//
//  Implements: docs/ARCHITECTURE.md -> "combat.js" and "Rules (combat)".
//
//  This file is PURE LOGIC. It never touches THREE.js or the web page.
//  It only answers "what happens?" and hands back a list of EVENTS that
//  combatView.js turns into animations, sounds and numbers on screen.
//  Because of that it also runs inside Node, which is how the automated
//  tests in tests/combat.test.js check the rules.
//
//  Quick tour of a duel:
//    var b = new WF.Battle({ player: {...}, enemies: ['hollow_sprite'] });
//    b.start();                          -> round 1: pips + draw a hand
//    b.playerTurn({ type: 'cast', uid: b.hand[0].uid, target: 1 });
//         -> the player acts, every living enemy acts, the next round
//            begins (damage/heal over time ticks, +1 pip, refill hand).
//    ...repeat until b.result is 'win', 'lose' or 'flee'.
//
//  All numbers (pips, hand size, charm limits, spell values, enemy
//  stats) come from game/data/*.js. The only numbers in this file are
//  the enemy "personality" defaults in AI_DEFAULTS below, and those can
//  be overridden from data via WF.data.aiProfiles (see notes there).
//
//  v0.2 additions (docs/ARCHITECTURE.md -> "v0.2 CONTRACT ADDENDUM"):
//    * BRIGHT PIPS  every new pip may be "bright" (progression.
//      brightPipChance(level); bosses 0.3 via enemies.js brightChance).
//      A bright pip pays 2 of a spell's pip cost for spells of the
//      caster's own school (or Lumen) and 1 for anything else. Mana
//      cost is always card.pips. Combatants carry `bright` (how many of
//      their `pips` are bright); pip events carry it too.
//    * AFFINITY     enemies.js `affinity: { school: f }` multiplies every
//      hit of that school by (1 - f): f > 0 resists, f < 0 is a weakness.
//    * DOT SNAPSHOT a burn's per-round tick = dot.amt x the same charm /
//      ward / damage / resist / affinity multiplier as its instant hit.
//    * BOSS PHASES  enemies.js `phases: [{ at, say, cast, once }]` emit
//      { t:'phase', who, idx, say } (+ an optional free instant cast).
//    * DISPLAY SNAPSHOTS every event gets `snap` (one entry per
//      combatant, taken right AFTER that event) so the duel view can
//      animate the round step by step; 'draw' events also get `hand`.
//      new WF.Battle({ ..., snapshots: false }) turns this off (the
//      balance simulator does that for speed).
//
//  v1.2 additions (docs/V1.2-CONTRACT.md §2.1):
//    * BRIGHT PIP    player.brightPip (0..1, gear) is ADDED to the bright-
//      pip chance, total capped at progression.brightPipCap (0.60).
//    * PIP SURGE    player.pipSurge / enemies.js `pipSurge` (0..1, capped at
//      progression.pipSurgeCap 0.35): at the start of every round from
//      round 2 on, a chance to gain ONE extra normal pip (2 pips in that
//      round), never above maxPips. The pips event then has surge: true.
//      The roll only happens for combatants with pipSurge > 0, so duels
//      without the stat use exactly the same random numbers as v1.1.
//
//  v2.0 WS-C additions (docs/V2.0-CONTRACT.md §4, docs/design/realms.md §6):
//    * PARTY DUELS  new WF.Battle({ players: [p0, p1, p2], enemies }) = 1-3
//      player wizards (join order) vs the enemies. Players are combatants
//      0..n-1, enemies n.. . `opts.player` alone is the classic duel and
//      behaves EXACTLY as before (same events, same random numbers).
//      Each seat has its own deck/hand/scrolls ("kit"); seat 0's kit is the
//      Battle itself, so b.hand / b.tcs / b.tcsUsed keep working.
//    * PLANNING     b.submit(seat, action) locks a seat's pick (can be
//      changed until resolve), b.waitingFor() lists seats still deciding,
//      b.resolveRound() resolves the round in a FIXED order: players by
//      seat, then enemies. A seat with no plan passes (turn timer, auto).
//    * TARGETING    players may heal / blade / shield / absorb an ALLY
//      (target = that ally's idx; anything else = self, as before).
//      Enemies first pick a foe among living players (tanks draw more
//      attention, wounded wizards attract finishers, a sure kill is always
//      taken), then run the normal AI against that foe.
//    * OUTCOMES     the party wins if any player stands when the last enemy
//      falls (fallen players share the win); b.outcome(seat) gives each
//      seat 'win' | 'lose' | 'flee'. In a party a fleeing player leaves
//      alone ({t:'flee', who}); the duel goes on for the others.
//
//  v2.0 M1 "Schools" (docs/V2.0-CONTRACT.md §2, schools.js header):
//    * SCHOOL STATS player.schoolStats = { dmg: {school: f}, resist: {..},
//      acc: {..} } (fractions) on top of the universal dmg / resist / acc:
//        hit = base x (1 + dmg + dmg[spell school])
//                   x (1 - (resist + resist[hit school]))   (< 0 = weakness)
//                   x charms x wards x affinity
//        accuracy = card.acc + (acc + acc[spell school]) x 100
//      Total resist is capped at progression resistCap (default 0.75).
//    * HIT SCHOOL an enemy's Hollow spell hits as the enemy's own `school`
//      (enemies.js), so per-school resist gear matters against it. Enemy
//      Hollow spells still count as "own school" for bright pips and still
//      match Hollow blades/traps (charms match the CARD's school).
//    * SPELL RANKS player.spellRanks = { cardId: { path: 'a'|'b', rank: 2..5 } }
//      (Runeglass upgrades at the Spellwright, game/data/runeglass.js). A
//      ranked card is a derived copy (Battle.rankCard, pure) used for the
//      cast and every preview; the deck / hand keep plain card ids.
//    Pure helpers for tests and sims: Battle.hitMult(), Battle.rankCard().
//
//  v2.0 Pets retune (docs/design/pets.md "v2.0 retune"):
//    * FLAT DAMAGE player.flatDmg (whole points, from pet talents) joins the
//      base roll of every direct hit: hit = (roll + flatDmg) x the multipliers
//      above. DoT ticks, heals and 0-damage cards are unchanged. Because it is
//      flat, it is a big boost for a low-level wizard and fades as spells grow.
// =====================================================================
(function (root) {
  'use strict';

  // Works in the browser (window) and in Node tests (global).
  root.WF = root.WF || { data: {} };
  var WF = root.WF;

  // Spell types that hurt somebody (used by the AI and previews).
  var ATTACK_TYPES = { damage: true, aoe: true, dot: true };
  var MINUS = '−'; // the proper minus sign "−" for labels

  // -------------------------------------------------------------------
  //  ENEMY PERSONALITIES (ai: 'basic' | 'healer' | 'buffer' | 'boss')
  //
  //  The AI gives every spell it can afford a SCORE measured in
  //  "damage points" (how much it helps, roughly), multiplies it by the
  //  personality weights below, then picks randomly with better spells
  //  being much more likely. That keeps enemies sensible but not robotic.
  //
  //    attack   - weight on damage spells
  //    setup    - weight on blades / traps (buffing its own next hit)
  //    debuff   - weight on weakness (shrinking the player's next hit)
  //    defend   - weight on shields / absorbs
  //    heal     - weight on heals
  //    healAt   - only heal when an ally is below this fraction of HP
  //    maxHeals - most heal spells it will cast in one duel (stops endless
  //               heal stalemates; keeps healers beatable)
  //    defendCooldown - rounds before it will put up another shield/absorb
  //               (so the player always gets windows to hit hard)
  //    saveBias - how willing it is to skip a turn to afford a bigger spell
  //    sharpness- higher = picks the best option more reliably (1 = loose)
  //    minRel   - ignore options scoring below this fraction of the best
  //    finisher - bonus multiplier for a spell that will surely kill you
  //    savesPips- (boss) stores pips for its biggest spell
  //    maxIdle  - (boss) most turns in a row it will just wait
  //
  //  To tune without touching code, add to a data file e.g.
  //    WF.data.aiProfiles = { boss: { maxIdle: 1 } };
  // -------------------------------------------------------------------
  var AI_DEFAULTS = {
    basic:  { attack: 1.0, setup: 0.6, debuff: 0.6, defend: 0.5, heal: 0.8, healAt: 0.30, maxHeals: 1, defendCooldown: 2, saveBias: 0.8,  sharpness: 2, minRel: 0.25, finisher: 3, savesPips: false, maxIdle: 0 },
    healer: { attack: 0.8, setup: 0.5, debuff: 0.7, defend: 0.7, heal: 1.8, healAt: 0.45, maxHeals: 3, defendCooldown: 2, saveBias: 0.6,  sharpness: 2, minRel: 0.25, finisher: 3, savesPips: false, maxIdle: 0 },
    buffer: { attack: 0.9, setup: 1.6, debuff: 1.4, defend: 0.6, heal: 0.8, healAt: 0.30, maxHeals: 1, defendCooldown: 2, saveBias: 0.9,  sharpness: 2, minRel: 0.25, finisher: 3, savesPips: false, maxIdle: 0 },
    boss:   { attack: 1.0, setup: 1.3, debuff: 1.2, defend: 0.8, heal: 1.0, healAt: 0.30, maxHeals: 2, defendCooldown: 2, saveBias: 1.0,  sharpness: 3, minRel: 0.30, finisher: 4, savesPips: true,  maxIdle: 2 }
  };

  // ---- v2.0 WS-C: party duels. Most players in one duel (contract §0.3) and how
  //      enemies choose WHICH player to go after. Override from data with
  //      WF.data.partyAggro = { tank: 1.4, ... }.
  //        tank      - weight multiplier for a Tank-role school (schools.js role)
  //        wounded   - extra weight per missing fraction of health (finishers)
  //        lastHit   - weight multiplier for whoever hit this enemy last
  //        finisher  - weight multiplier when the enemy can surely kill that player
  //        sharpness - higher = enemies agree on the top target more often
  var MAX_PARTY = 3;
  var PARTY_AGGRO_DEFAULTS = { tank: 1.6, wounded: 1.0, lastHit: 1.3, finisher: 4, sharpness: 1.5 };

  // ---------------- small helpers ----------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function pctText(p) { return (p >= 0 ? '+' : MINUS) + Math.abs(p) + '%'; }
  function matches(effect, card) { return effect.affects === 'any' || effect.affects === card.school; }
  function avg(card) { return ((card.min || 0) + (card.max || 0)) / 2; }
  // Events get their own copy so later changes (e.g. rounds ticking down)
  // don't alter what the animation code is reading.
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  // v2.0 M1: a per-school bonus (fraction) from a { school: f } map
  function bonusOf(map, school) { var v = map && school ? map[school] : 0; return +v || 0; }
  function schoolMaps(src) {
    src = src || {};
    return { dmg: copy(src.dmg || {}), resist: copy(src.resist || {}), acc: copy(src.acc || {}) };
  }
  function copyAll(list) { var r = new Array(list.length); for (var i = 0; i < list.length; i++) r[i] = copy(list[i]); return r; }
  function schoolName(id) {
    var s = (WF.data && WF.data.schools && WF.data.schools[id]) || null;
    return (s && s.name) || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '?');
  }

  // ===================================================================
  //  CONSTRUCTOR
  // ===================================================================
  function Battle(opts) {
    opts = opts || {};
    var data = WF.data || {};
    this.cards = data.cards || {};
    this.enemyDefs = data.enemies || {};
    this.prog = data.progression || {};
    this.rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    this.snapshots = opts.snapshots !== false;
    // v2.1 D16 Heroic: { hp, dmg } multipliers for every enemy in this duel (summons too), from the
    // dungeon's data (dungeons.js heroic). Same for 1-3 wizards: it is a mode, not party scaling.
    var em = opts.enemyMods || {};
    this.enemyMods = { hp: em.hp > 0 ? +em.hp : 1, dmg: em.dmg > 0 ? +em.dmg : 1 };

    // Rule values (from progression.js)
    this.maxPips = this.prog.maxPips || 7;
    this.startPips = (this.prog.startPips != null) ? this.prog.startPips : 1;
    this.handSize = this.prog.handSize || 7;
    this.maxCharms = this.prog.maxCharms || 6;
    this.bossBrightChance = (this.prog.bossBrightChance != null) ? this.prog.bossBrightChance : 0.3;
    // v1.2 WS2: caps for the gear stats Bright Pip (brightPip) and Pip Surge
    this.brightPipCap = (this.prog.brightPipCap != null) ? this.prog.brightPipCap : 0.60;
    this.pipSurgeCap = (this.prog.pipSurgeCap != null) ? this.prog.pipSurgeCap : 0.35;
    // v2.0 M1: total resist (universal + school) never above this
    var ls = this.prog.levelScaling || {};
    this.resistCap = (this.prog.resistCap != null) ? this.prog.resistCap : (ls.resistCap != null ? ls.resistCap : 0.75);
    this.runeglass = data.runeglass || null;
    this._rankCache = {};

    // AI personalities = defaults, overridden by WF.data.aiProfiles if present.
    this.aiProfiles = {};
    var over = data.aiProfiles || {};
    for (var k in AI_DEFAULTS) {
      var p = {}, d = AI_DEFAULTS[k], o = over[k] || {};
      for (var f in d) p[f] = (o[f] != null) ? o[f] : d[f];
      this.aiProfiles[k] = p;
    }

    // ---- the player combatants (index 0 = you / the realm host; v2.0 WS-C: 1-3 in join order) ----
    var plist = (opts.players && opts.players.length) ? opts.players.slice(0, MAX_PARTY) : [opts.player || {}];
    var nP = plist.length;
    this.combatants = [];
    for (var s = 0; s < nP; s++) this.combatants.push(this._newPlayer(plist[s] || {}, s));
    var player = this.combatants[0];
    this.player = player;
    this.players = this.combatants.slice(0, nP);
    var pAggro = data.partyAggro || {};
    this.partyAggro = {};
    for (var pk in PARTY_AGGRO_DEFAULTS) this.partyAggro[pk] = (pAggro[pk] != null) ? pAggro[pk] : PARTY_AGGRO_DEFAULTS[pk];

    // ---- enemies (index nP..; 1.. in a classic duel) ----
    var ids = opts.enemies || [];
    for (var i = 0; i < ids.length; i++) this.combatants.push(this._newEnemy(ids[i], i + nP));
    this.enemies = this.combatants.slice(nP);
    // ---- the player's deck / hand (seat 0's "kit" is this Battle itself) ----
    // v2.0 WS-C: every seat has a kit { deckCounts, drawPile, discardPile, hand, tcs, tcsUsed };
    // card uids come from one counter, so they are unique across the party.
    this._uid = 1;
    this.kits = [this];
    this._fillKit(this, plist[0] || {});
    for (s = 1; s < nP; s++) this.kits.push(this._fillKit({}, plist[s] || {}));
    this.plans = {};         // v2.0 WS-C: seat -> planned action (party planning phase)

    this.round = 0;
    this.result = null;
    this.started = false;
    this.lastError = null;   // why the last playerTurn/discard was refused
    this.aiLog = [];         // debugging: every enemy decision with its scores
  }

  // ---- v2.0 WS-C: one player combatant (seat = idx). Seat 0 is built exactly as the
  //      classic single player always was; `seat` is the only new field.
  Battle.prototype._newPlayer = function (pl, idx) {
    var maxHp = pl.maxHp || pl.hp || 1;
    var level = Math.max(1, Math.floor(+pl.level) || 1);   // v2.0 review M4: always a number
    return {
      idx: idx, seat: idx, name: pl.name || 'Wizard', isPlayer: true, enemyId: null,
      school: pl.school, level: level,
      hp: (pl.hp != null) ? pl.hp : maxHp, maxHp: maxHp,
      mana: (pl.mana != null) ? pl.mana : (pl.maxMana || 0), maxMana: pl.maxMana || pl.mana || 0,
      pips: 0, bright: 0, dmg: pl.dmg || 0, resist: pl.resist || 0, acc: pl.acc || 0,
      brightChance: this._withPowerPip((pl.brightChance != null) ? pl.brightChance : this._brightFor(level), pl.brightPip),
      pipSurge: this._surgeChance(pl.pipSurge),
      affinity: pl.affinity || null,
      ss: schoolMaps(pl.schoolStats),                 // v2.0 M1: per-school dmg / resist / acc
      ranks: copy(pl.spellRanks || {}),               // v2.0 M1: Runeglass spell ranks
      flatDmg: Math.max(0, Math.round(+pl.flatDmg || 0)),   // v2.0 pets: flat damage added to every hit's base roll
      charms: [], wards: [], dots: [], hots: [], absorb: 0, alive: true, boss: false
    };
  };
  // ---- v2.0 WS-C: deck + Spell Scrolls of one seat (same steps and shuffle as v1.x for seat 0).
  //      Spell Scrolls (treasure cards, `tcs`): a private copy; state.js subtracts tcsUsed afterwards.
  Battle.prototype._fillKit = function (kit, pl) {
    kit.deckCounts = {}; kit.drawPile = []; kit.discardPile = []; kit.hand = [];
    var deck = pl.deck || {};
    for (var id in deck) {
      if (!this.cards[id]) continue;          // skip unknown cards safely
      kit.deckCounts[id] = deck[id];
      for (var n = 0; n < deck[id]; n++) kit.drawPile.push(id);
    }
    this._shuffle(kit.drawPile);
    kit.tcs = {};
    for (var t in (pl.tcs || {})) kit.tcs[t] = pl.tcs[t];
    kit.tcsUsed = {};
    return kit;
  };
  Battle.prototype._kit = function (seat) { return this.kits[seat || 0] || null; };

  // Bright-pip chance for a level (progression.brightPipChance), 0..1.
  Battle.prototype._brightFor = function (level) {
    var f = this.prog.brightPipChance;
    return typeof f === 'function' ? clamp(+f(level) || 0, 0, 1) : 0;
  };
  // v1.2 WS2: Bright Pip. Gear brightPip (0..1) adds to the base chance; the
  // total is capped at brightPipCap. A base that is already above the cap
  // (tests forcing brightChance 1) is kept as is: the cap only limits gear.
  Battle.prototype._withPowerPip = function (base, bonus) {
    base = clamp(+base || 0, 0, 1);
    bonus = clamp(+bonus || 0, 0, 1);
    if (!bonus) return base;
    return Math.min(base + bonus, Math.max(base, this.brightPipCap));
  };
  // v1.2 WS2: Pip Surge chance (0..1), capped at pipSurgeCap.
  Battle.prototype._surgeChance = function (v) {
    return clamp(+v || 0, 0, this.pipSurgeCap);
  };

  // ===================================================================
  //  EVENTS + DISPLAY SNAPSHOTS
  //  Every list returned by start()/playerTurn() is made here. Its push()
  //  stamps each event with `snap` = the state of every combatant right
  //  AFTER that event (index = combatant idx), and 'draw' events with the
  //  resulting `hand`. combatView.js uses these to show the round step
  //  by step instead of jumping to the end-of-round state.
  // ===================================================================
  Battle.prototype._events = function () {
    var self = this, ev = [];
    Object.defineProperty(ev, 'push', {
      enumerable: false, configurable: true, writable: true,
      value: function () {
        for (var a = 0; a < arguments.length; a++) {
          var e = arguments[a];
          if (self.snapshots) {
            e.snap = self._snap();
            if (e.t === 'draw') e.hand = self._kit(e.who).hand.map(function (h) { return { uid: h.uid, cardId: h.cardId }; });
          }
          Array.prototype.push.call(this, e);
        }
        return this.length;
      }
    });
    return ev;
  };

  Battle.prototype._snap = function () {
    var out = new Array(this.combatants.length);
    for (var i = 0; i < this.combatants.length; i++) {
      var c = this.combatants[i];
      out[i] = {
        hp: c.hp, maxHp: c.maxHp, mana: c.mana, maxMana: c.maxMana,
        pips: c.pips, bright: c.bright, alive: c.alive, absorb: c.absorb,
        charms: copyAll(c.charms), wards: copyAll(c.wards), dots: copyAll(c.dots), hots: copyAll(c.hots)
      };
      if (c.fled) out[i].fled = true;   // v2.0 WS-C: a party member who left the duel
    }
    return out;
  };

  // ===================================================================
  //  PIPS  (normal + bright)
  // ===================================================================
  // Own school (or Lumen) = a bright pip is worth 2 for this card.
  // v2.0 M1: an enemy's Hollow spells stay "own school" whatever school the enemy took on.
  Battle.prototype._isOwn = function (c, card) {
    return card.school === c.school || card.school === 'lumen' || (!c.isPlayer && card.school === 'hollow');
  };
  // How many pips of cost `c` can pay for `card` right now.
  Battle.prototype._pipValue = function (c, card) {
    var normal = c.pips - c.bright;
    return this._isOwn(c, card) ? normal + 2 * c.bright : c.pips;
  };
  Battle.prototype._affordable = function (c, card) {
    return (card.pips || 0) <= this._pipValue(c, card);
  };
  // Pay a card's pip cost. Own-school: bright pips first (2 each, using a
  // normal pip for an odd remainder when possible); other schools: normal
  // pips first, bright pips count 1.
  Battle.prototype._payPips = function (c, card) {
    var cost = card.pips || 0, normal = c.pips - c.bright, useB = 0, useN = 0, rem;
    if (cost <= 0) return;
    if (this._isOwn(c, card)) {
      useB = Math.min(c.bright, Math.floor(cost / 2));
      rem = cost - 2 * useB;
      useN = Math.min(normal, rem);
      rem -= useN;
      if (rem > 0 && c.bright > useB) useB++;          // odd cost, no normal pip: a bright one overpays
    } else {
      useN = Math.min(normal, cost);
      useB = Math.min(c.bright, cost - useN);
    }
    c.pips = Math.max(0, c.pips - useN - useB);
    c.bright = Math.max(0, Math.min(c.pips, c.bright - useB));
  };
  // +1 pip (maybe bright). At the pip cap a bright roll upgrades a normal pip.
  Battle.prototype._gainPip = function (c) {
    var bright = c.brightChance > 0 && this.rng() < c.brightChance;
    if (c.pips < this.maxPips) { c.pips++; if (bright) c.bright++; }
    else if (bright && c.bright < c.pips) c.bright++;
  };
  // v1.2 WS2: Pip Surge. Called right after the round's normal pip (round
  // 2+ only). One extra NORMAL pip with chance c.pipSurge, never above
  // maxPips. No roll at all without the stat or at the pip cap, so the rng
  // sequence of duels without Pip Surge is unchanged. Returns true on a surge.
  Battle.prototype._surgePip = function (c) {
    if (!(c.pipSurge > 0) || c.pips >= this.maxPips) return false;
    if (this.rng() >= c.pipSurge) return false;
    c.pips++;
    return true;
  };

  // ===================================================================
  //  v2.0 M1: SCHOOL MATH (pure; see the header and schools.js)
  // ===================================================================
  // Outgoing damage bonus (fraction) of combatant c for a spell of `school`.
  Battle.prototype.dmgFor = function (c, school) {
    return (+c.dmg || 0) + bonusOf(c.ss && c.ss.dmg, school);
  };
  // v2.0 pets: flat damage (whole points) a combatant adds to the base roll of every direct hit
  // (damage / AoE / the instant part of a DoT; never DoT ticks, heals or 0-damage cards).
  Battle.prototype.flatFor = function (c, card) {
    return (c && c.flatDmg > 0 && card && (card.max || 0) > 0) ? c.flatDmg : 0;
  };
  // Total resist (fraction, may be negative) of c against a hit of `school`,
  // capped at resistCap.
  Battle.prototype.resistFor = function (c, school) {
    return Math.min(this.resistCap, (+c.resist || 0) + bonusOf(c.ss && c.ss.resist, school));
  };
  // Accuracy (0..100) of c casting `card`.
  Battle.prototype.accFor = function (c, card) {
    return Math.min(100, (card.acc || 100) + ((+c.acc || 0) + bonusOf(c.ss && c.ss.acc, card.school)) * 100);
  };
  // The school a hit counts as for resist: an enemy's Hollow spell hits as the enemy's school.
  Battle.prototype.hitSchool = function (caster, card) {
    if (caster && !caster.isPlayer && card.school === 'hollow' && caster.school && caster.school !== 'hollow') return caster.school;
    return card.school;
  };
  // The card as THIS caster casts it (Runeglass rank applied; cached per duel).
  Battle.prototype.rankedCard = function (c, card) {
    if (!card || !c || !c.ranks) return card;
    var r = c.ranks[card.id];
    if (!r || !(r.rank > 1) || !r.path) return card;
    var key = c.idx + '|' + card.id + '|' + r.path + '|' + r.rank;
    if (!this._rankCache[key]) this._rankCache[key] = Battle.rankCard(card, r, this.runeglass, c.school);
    return this._rankCache[key];
  };
  // One enemy combatant from enemies.js (constructor + v2.1 summons).
  Battle.prototype._newEnemy = function (id, idx) {
    var def = this.enemyDefs[id];
    if (!def) throw new Error('WF.Battle: unknown enemy id "' + id + '" (check enemies.js)');
    var lvl = def.level || 1, em = this.enemyMods || { hp: 1, dmg: 1 };
    var hp = em.hp === 1 ? def.hp : Math.round(def.hp * em.hp), dmg = em.dmg === 1 ? (def.dmg || 0) : (1 + (def.dmg || 0)) * em.dmg - 1;
    return {
      idx: idx, name: def.name || id, isPlayer: false, enemyId: id,
      school: def.school || 'hollow', level: lvl,
      hp: hp, maxHp: hp, mana: 0, maxMana: 0,
      pips: 0, bright: 0, dmg: dmg, resist: def.resist || 0, acc: def.acc || 0,
      brightChance: (def.brightChance != null) ? def.brightChance : (def.boss ? this.bossBrightChance : this._brightFor(lvl)),
      pipSurge: this._surgeChance(def.pipSurge),
      affinity: def.affinity || null,
      ss: schoolMaps(def.schoolStats), ranks: {},
      phases: (def.phases || []).slice(), phaseDone: [],
      charms: [], wards: [], dots: [], hots: [], absorb: 0, alive: true, boss: !!def.boss,
      ai: this.aiProfiles[def.ai] ? def.ai : 'basic',
      deck: (def.deck || []).slice(),
      startPips: def.startPips,
      idleStreak: 0,         // boss: turns spent waiting in a row
      healsCast: 0,          // heals used this duel (see maxHeals)
      lastDefendRound: -99   // round it last cast a shield/absorb
    };
  };
  // v2.1 (D15, review F-6): a boss phase may summon helpers (enemies.js phases[].summon). They join at the
  // end of the line (indices never shift), never above 3 enemies, get their starting pips, and act from
  // the next round on. Event { t:'summon', who, idxs, enemies }.
  Battle.MAX_ENEMIES = 3;
  Battle.prototype._summon = function (who, ids, ev) {
    var idxs = [], names = [], self = this;
    (ids || []).forEach(function (id) {
      if (!self.enemyDefs[id] || self.enemies.length >= Battle.MAX_ENEMIES) return;
      var c = self._newEnemy(id, self.combatants.length);
      c.joinRound = self.round;
      var sp = Math.max(0, Math.min(self.maxPips, c.startPips != null ? c.startPips : self.startPips));
      for (var n = 0; n < sp; n++) self._gainPip(c);
      self.combatants.push(c); self.enemies.push(c);
      idxs.push(c.idx); names.push(id);
    });
    if (idxs.length) ev.push({ t: 'summon', who: who.idx, idxs: idxs, enemies: names });
    return idxs;
  };
  // a realm guest's mirror adds the same helpers when the host's stream says so (no rng, no pips:
  // the snapshot that follows carries the real numbers)
  Battle.prototype.mirrorSummon = function (e) {
    var self = this;
    (e.enemies || []).forEach(function (id, k) {
      var idx = e.idxs && e.idxs[k];
      if (idx !== self.combatants.length || !self.enemyDefs[id]) return;
      var c = self._newEnemy(id, idx); c.joinRound = self.round;
      self.combatants.push(c); self.enemies.push(c);
    });
  };
  Battle.features = { summon: true };
  // Pure: damage multiplier of the formula (tests, sims, tooltips).
  //   o = { dmg, schoolDmg, resist, schoolResist, charms (product), resistCap }
  Battle.hitMult = function (o) {
    o = o || {};
    var cap = o.resistCap != null ? o.resistCap : 0.75;
    var res = Math.min(cap, (o.resist || 0) + (o.schoolResist || 0));
    return (1 + (o.dmg || 0) + (o.schoolDmg || 0)) * Math.max(0, 1 - res) * (o.charms != null ? o.charms : 1);
  };
  // Pure: a ranked copy of `card`. info = { path: 'a'|'b', rank: 1..5 }; R = WF.data.runeglass.
  // R.pathFor(card, path, school) returns { fx: { ... per rank above 1 } } (runeglass.js).
  //   fx.dmg      x(1 + n*v) on min / max / dot.amt          fx.heal  x(1 + n*v) on value / hot.amt
  //   fx.value    + n*v on value (charms, shields)            fx.valueMult  x(1 + n*v) on value (absorbs)
  //   fx.acc      + n*v on acc (cap 100)                      fx.drain + n*v on drain
  //   fx.rider    { type: 'absorb'|'hot'|'trap', per: v, ... } a rider that grows n*per
  //   fx.riderMult x(1 + n*v) on an existing rider's value / hot amount
  Battle.rankCard = function (card, info, R, school) {
    var n = Math.max(0, Math.min((R && R.maxRank) || 5, (info && info.rank) || 1) - 1);
    var def = n && R && typeof R.pathFor === 'function' ? R.pathFor(card, info.path, school) : null;
    if (!def || !def.fx) return card;
    var fx = def.fx, out = copy(card);
    out.rank = n + 1; out.rankPath = info.path; out.base = card;
    if (fx.dmg && ATTACK_TYPES[card.type]) {
      var m = 1 + n * fx.dmg;
      out.min = Math.round((card.min || 0) * m); out.max = Math.round((card.max || 0) * m);
      if (card.dot) out.dot = { amt: Math.round(card.dot.amt * m), rounds: card.dot.rounds };
    }
    if (fx.heal && (card.type === 'heal' || card.type === 'hot')) {
      var h = 1 + n * fx.heal;
      out.value = Math.round((card.value || 0) * h);
      if (card.hot) out.hot = { amt: Math.round(card.hot.amt * h), rounds: card.hot.rounds };
    }
    if (fx.value) out.value = (card.value || 0) + n * fx.value;
    if (fx.valueMult) out.value = Math.round((card.value || 0) * (1 + n * fx.valueMult));
    if (fx.acc) out.acc = Math.min(100, (card.acc || 100) + n * fx.acc);
    if (fx.drain) out.drain = Math.round(((card.drain || 0) + n * fx.drain) * 100) / 100;
    if (fx.riderMult && card.rider) {
      var r0 = card.rider, r1 = copy(r0), k = 1 + n * fx.riderMult;
      if (r0.value != null) r1.value = Math.round(r0.value * k);
      if (r0.hot) r1.hot = { amt: Math.round(r0.hot.amt * k), rounds: r0.hot.rounds };
      out.rider = r1;
    } else if (fx.rider && !card.rider) {
      var rd = fx.rider, r2 = { type: rd.type, name: rd.name || card.name };
      if (rd.type === 'hot') r2.hot = { amt: Math.round(n * rd.per), rounds: rd.rounds || 3 };
      else r2.value = Math.round(n * rd.per);
      if (rd.type === 'trap') r2.affects = rd.affects || school || card.school;
      out.rider = r2;
    }
    return out;
  };

  // ===================================================================
  //  PUBLIC API
  // ===================================================================

  // Round 1: everyone gets their starting pips and the player draws a hand.
  Battle.prototype.start = function () {
    if (this.started) return [];
    this.started = true;
    var ev = this._events();
    this.round = 1;
    ev.push({ t: 'round', n: 1 });
    for (var i = 0; i < this.combatants.length; i++) {
      var c = this.combatants[i];
      var sp = clamp((c.startPips != null) ? c.startPips : this.startPips, 0, this.maxPips);
      c.pips = 0; c.bright = 0;
      for (var n = 0; n < sp; n++) this._gainPip(c);
      ev.push({ t: 'pips', who: c.idx, pips: c.pips, bright: c.bright });
    }
    // Opening phases (`at: 1`) fire right away, e.g. a boss that starts
    // the duel behind a ward.
    this._checkPhases(ev);
    if (!this.result) this._drawAll(ev);   // v2.0 WS-C: every seat draws (seat order)
    return ev;
  };

  // Can the player afford this card right now? (pips incl. bright pips, and mana)
  // v2.0 WS-C: optional `seat` (default 0 = you) for party duels.
  Battle.prototype.canCast = function (cardId, seat) {
    var card = this.cards[cardId];
    if (!card) return { ok: false, reason: 'Unknown spell' };
    if (this.result) return { ok: false, reason: 'The duel is over' };
    var p = this.players[seat || 0] || this.player;
    if (!this._affordable(p, card)) return { ok: false, reason: 'Not enough pips' };
    if (p.mana < (card.pips || 0)) return { ok: false, reason: 'Not enough mana' };
    return { ok: true, reason: '' };
  };

  // How many pips the player (or combatant `who`) can put toward this card
  // right now: normal pips + bright pips (x2 for own school / Lumen).
  Battle.prototype.pipValue = function (cardId, who) {
    var card = this.cards[cardId], c = this.combatants[who || 0];
    if (!card || !c) return 0;
    return this._pipValue(c, card);
  };

  // v2.1 D20 (Jorge, Oct 21 5:52 PM: "always allow flee no punishment"): any duel, boss fights included,
  // can be fled at any time. Kept as a method so every caller (UI, realm host, guests) asks one place.
  Battle.prototype.canFlee = function () { return !this.result; };
  // v2.1 A5: cards still in this seat's draw pile. A realm guest's mirror battle has no deck
  // (decks stay private to the host): the host sends the count with every stream (kit.leftCount).
  Battle.prototype.deckLeft = function (seat) {
    var kit = this._kit(seat || 0);
    if (!kit) return 0;
    return typeof kit.leftCount === 'number' ? kit.leftCount : kit.drawPile.length;
  };
  // v2.1 A5: nothing in the hand and nothing left to draw (Spell Scrolls are separate and can still be used)
  Battle.prototype.outOfCards = function (seat) {
    var kit = this._kit(seat || 0);
    return !!kit && kit.hand.length === 0 && this.deckLeft(seat) === 0;
  };
  // Is this seat still in the duel (standing, not fled)? v2.0 WS-C
  Battle.prototype._standing = function (seat) { var c = this.players[seat]; return !!(c && c.alive && !c.fled); };

  // What WOULD happen if the player cast this card at this target?
  // Nothing is consumed. Returns { min, max, heal, acc, mods, dot, ... }.
  Battle.prototype.preview = function (cardId, targetIdx, seat) {
    return this._preview(seat || 0, cardId, targetIdx);
  };

  // Throw a card from the hand away (it is not replaced until next round).
  Battle.prototype.discard = function (uid, seat) {
    if (this.result) return false;
    var kit = this._kit(seat);   // v2.0 WS-C: seat 0 = this (classic)
    if (!kit) return false;
    for (var i = 0; i < kit.hand.length; i++) {
      if (kit.hand[i].uid === uid) {
        kit.discardPile.push(kit.hand[i].cardId);
        kit.hand.splice(i, 1);
        return true;
      }
    }
    this.lastError = 'That card is not in your hand';
    return false;
  };

  // Resolve one WHOLE round, starting with the player's action:
  //   { type: 'cast', uid, target } | { type: 'tc', cardId, target }
  //   { type: 'pass' }              | { type: 'flee' }
  // Returns the ordered list of events. An invalid action (card not in
  // hand, can't afford it, flee vs a boss) returns [] and changes nothing;
  // b.lastError says why.
  Battle.prototype.playerTurn = function (action) {
    if (!this.started || this.result) return [];
    action = action || { type: 'pass' };
    this.lastError = null;
    // v2.0 WS-C: in a party duel this is "seat 0 locks in, then resolve the round"
    // (any seat without a plan passes). Realms use submit() + resolveRound().
    if (this.players.length > 1) {
      if (!this.submit(0, action)) return [];
      return this.resolveRound();
    }
    var err = this._checkAction(0, action);
    if (err) { this.lastError = err; return []; }
    var ev = this._events();

    if (action.type === 'flee') {
      this._end('flee', ev);
      return ev;
    }
    this._playerAct(0, action, ev);
    if (!this.result) this._checkPhases(ev);
    this._enemiesAct(ev);
    if (!this.result) this._beginRound(ev);
    return ev;
  };

  // ---- v2.0 WS-C: validate an action for a seat WITHOUT changing anything.
  //      Returns null (ok) or the reason (same texts and order as v1.x).
  Battle.prototype._checkAction = function (seat, action) {
    var kit = this._kit(seat), i;
    if (!kit || !this.players[seat]) return 'No such wizard in this duel';
    if (action.type === 'flee') {
      return this.canFlee(seat) ? null : 'The duel is over';
    } else if (action.type === 'cast') {
      var hi = -1;
      for (i = 0; i < kit.hand.length; i++) if (kit.hand[i].uid === action.uid) { hi = i; break; }
      if (hi < 0) return 'That card is not in your hand';
      var cc = this.canCast(kit.hand[hi].cardId, seat);
      return cc.ok ? null : cc.reason;
    } else if (action.type === 'tc') {
      if (!kit.tcs[action.cardId] || kit.tcs[action.cardId] <= 0) return 'You have no such spell scroll';
      var ok = this.canCast(action.cardId, seat);
      return ok.ok ? null : ok.reason;
    }
    return null;
  };

  // ---- v2.0 WS-C: carry out one seat's (already validated) action. Seat 0 in a
  //      classic duel runs exactly the v1.x steps.
  Battle.prototype._playerAct = function (seat, action, ev) {
    var kit = this._kit(seat), p = this.players[seat];
    if (action.type === 'cast') {
      var hi = -1;
      for (var i = 0; i < kit.hand.length; i++) if (kit.hand[i].uid === action.uid) { hi = i; break; }
      var cardId = kit.hand[hi].cardId;
      kit.hand.splice(hi, 1);
      kit.discardPile.push(cardId);               // cast or fizzled, it's spent
      this._cast(seat, this.cards[cardId], action.target, ev);
    } else if (action.type === 'tc') {
      var tcId = action.cardId;
      kit.tcs[tcId]--;                             // used up even if it fizzles
      kit.tcsUsed[tcId] = (kit.tcsUsed[tcId] || 0) + 1;
      this._cast(seat, this.cards[tcId], action.target, ev);
    } else if (action.type === 'flee') {
      // party only (a classic flee ends the duel in playerTurn): this wizard leaves alone
      p.fled = true; p.alive = false;
      p.dots = []; p.hots = []; p.charms = []; p.wards = []; p.absorb = 0;
      ev.push({ t: 'flee', who: p.idx });
      this._checkEnd(ev);
    } else {
      var pe = { t: 'pass', who: p.idx };
      if (action.auto) pe.auto = true;             // turn timer ran out
      ev.push(pe);
    }
  };

  // Enemies act in order (dead ones skip; stop as soon as it's decided).
  Battle.prototype._enemiesAct = function (ev) {
    for (var e = this.players.length; e < this.combatants.length && !this.result; e++) {
      if (this.combatants[e].alive && this.combatants[e].joinRound !== this.round) {   // v2.1: a summoned helper waits a round
        this._enemyAct(e, ev);
        if (!this.result) this._checkPhases(ev);
      }
    }
  };

  // ===================================================================
  //  v2.0 WS-C: PARTY PLANNING PHASE (realms, docs/design/realms.md §6)
  //  Every standing seat picks an action at the same time (submit, may be
  //  changed until the round resolves). resolveRound() then runs the round
  //  in a FIXED order: seats 0, 1, 2, then enemies. No plan = pass.
  // ===================================================================
  Battle.prototype.submit = function (seat, action) {
    this.lastError = null;
    if (!this.started || this.result) { this.lastError = 'The duel is over'; return false; }
    if (!this._standing(seat)) { this.lastError = 'That wizard is out of the duel'; return false; }
    action = action || { type: 'pass' };
    var err = this._checkAction(seat, action);
    if (err) { this.lastError = err; return false; }
    var a = { type: action.type };
    if (action.uid != null) a.uid = action.uid;
    if (action.cardId != null) a.cardId = action.cardId;
    if (action.target != null) a.target = action.target;
    if (action.auto) a.auto = true;
    this.plans[seat] = a;
    return true;
  };
  Battle.prototype.planned = function (seat) { return !!this.plans[seat]; };
  // Seats that still have to choose this round.
  Battle.prototype.waitingFor = function () {
    var out = [];
    for (var s = 0; s < this.players.length; s++) if (this._standing(s) && !this.plans[s]) out.push(s);
    return out;
  };
  Battle.prototype.resolveRound = function () {
    if (!this.started || this.result) return [];
    var ev = this._events(), plans = this.plans;
    this.plans = {};
    for (var s = 0; s < this.players.length && !this.result; s++) {
      if (!this._standing(s)) continue;
      var a = plans[s] || { type: 'pass', auto: true };
      // re-check: an earlier seat can't change this seat's pips/hand, but stay safe
      if (this._checkAction(s, a)) a = { type: 'pass', auto: true };
      this._playerAct(s, a, ev);
      if (!this.result) this._checkPhases(ev);
    }
    this._enemiesAct(ev);
    if (!this.result) this._beginRound(ev);
    return ev;
  };
  // Each seat's own outcome once the duel is decided ('win' also for fallen
  // party members when the party wins). null while the duel runs.
  Battle.prototype.outcome = function (seat) {
    if (!this.result) return null;
    var c = this.players[seat || 0];
    if (!c) return null;
    if (c.fled) return 'flee';
    return this.result;
  };

  // ===================================================================
  //  ROUND FLOW
  // ===================================================================
  Battle.prototype._beginRound = function (ev) {
    this.round++;
    ev.push({ t: 'round', n: this.round });
    var i, c;
    // 1) Damage / healing over time ticks.
    for (i = 0; i < this.combatants.length && !this.result; i++) {
      c = this.combatants[i];
      if (!c.alive) continue;
      this._tick(c, ev);
    }
    if (this.result) return;
    this._checkPhases(ev);
    if (this.result) return;
    // 2) Everyone alive gains a pip (which may be bright), plus maybe a
    //    Pip Surge pip (v1.2): the event then carries surge: true.
    for (i = 0; i < this.combatants.length; i++) {
      c = this.combatants[i];
      if (!c.alive) continue;
      this._gainPip(c);
      var pe = { t: 'pips', who: c.idx, pips: c.pips, bright: c.bright };
      if (this._surgePip(c)) { pe.pips = c.pips; pe.surge = true; }
      ev.push(pe);
    }
    // 3) Refill the players' hands (v2.0 WS-C: every standing seat, seat order).
    this._drawAll(ev);
  };

  Battle.prototype._tick = function (c, ev) {
    var k, eff;
    // DoTs: the amount was SNAPSHOT when the burn was applied (blades,
    // traps, shields, damage bonus, resist and affinity of that instant
    // hit are already baked in). Absorb still soaks ticks.
    for (k = 0; k < c.dots.length; k++) {
      eff = c.dots[k];
      var absorbed = Math.min(c.absorb, eff.amt);
      c.absorb -= absorbed;
      var amt = eff.amt - absorbed;
      c.hp = Math.max(0, c.hp - amt);
      eff.rounds--;
      ev.push({ t: 'tick', target: c.idx, kind: 'dot', amount: amt, absorbed: absorbed, name: eff.name });
      if (c.hp <= 0) { this._kill(c, ev); return; }
    }
    c.dots = c.dots.filter(function (d) { return d.rounds > 0; });
    // HoTs: flat healing, capped at max health.
    for (k = 0; k < c.hots.length; k++) {
      eff = c.hots[k];
      var healed = Math.min(eff.amt, c.maxHp - c.hp);
      c.hp += healed;
      eff.rounds--;
      ev.push({ t: 'tick', target: c.idx, kind: 'hot', amount: healed, name: eff.name });
    }
    c.hots = c.hots.filter(function (h) { return h.rounds > 0; });
  };

  // Refill the hand to handSize from the draw pile. v2.1 A5 (Jorge): decks are FINITE: the
  // discard pile never comes back. "If you only equip 5 cards in your deck then all you get is
  // 5 cards; if you run out, then you run out and must flee or wait until they kill you."
  // v2.0 WS-C: per seat; party 'draw' events carry `who` (classic ones stay { t, cards }).
  Battle.prototype._draw = function (ev, seat) {
    var drawn = [], kit = this._kit(seat);
    while (kit.hand.length < this.handSize) {
      if (kit.drawPile.length === 0) break;        // out of cards: Pass, Spell Scrolls or Flee
      var entry = { uid: this._uid++, cardId: kit.drawPile.pop() };
      kit.hand.push(entry);
      drawn.push(entry);
    }
    if (drawn.length) {
      var de = { t: 'draw', cards: drawn, left: kit.drawPile.length };   // v2.1 A5: cards left in the deck
      if (this.players.length > 1) de.who = seat || 0;
      ev.push(de);
    }
  };
  Battle.prototype._drawAll = function (ev) {
    for (var s = 0; s < this.players.length; s++) if (this._standing(s)) this._draw(ev, s);
  };

  Battle.prototype._kill = function (c, ev) {
    c.hp = 0;
    c.alive = false;
    c.dots = []; c.hots = []; c.charms = []; c.wards = []; c.absorb = 0;
    ev.push({ t: 'death', target: c.idx });
    this._checkEnd(ev);
  };

  Battle.prototype._checkEnd = function (ev) {
    if (this.result) return true;
    // v2.0 WS-C: the party is beaten when nobody is left standing (a party where
    // everyone fled = 'flee'). Classic: exactly "the player died".
    var standing = 0, fell = 0, s;
    for (s = 0; s < this.players.length; s++) {
      if (this._standing(s)) standing++;
      else if (!this.players[s].fled) fell++;
    }
    if (!standing) { this._end(fell ? 'lose' : 'flee', ev); return true; }
    for (var i = this.players.length; i < this.combatants.length; i++) if (this.combatants[i].alive) return false;
    this._end('win', ev);
    return true;
  };

  Battle.prototype._end = function (result, ev) {
    if (this.result) return;
    this.result = result;
    ev.push({ t: 'end', result: result });
  };

  // ===================================================================
  //  BOSS PHASES  (enemies.js `phases: [{ at, say, cast, once }]`)
  //  When a living enemy's health falls to `at` x maxHp or below, emit
  //  { t:'phase', who, idx, say } and, if `cast` names a card, cast it
  //  for free (no pips, cannot fizzle). Phases fire once (default); with
  //  `once: false` a phase re-arms when the enemy is healed back above it.
  //  Checked at the start of the duel (so `at: 1` = an opening move),
  //  after the player's action, after each enemy action and after the
  //  round's DoT/HoT ticks.
  // ===================================================================
  Battle.prototype._checkPhases = function (ev) {
    for (var i = this.players.length; i < this.combatants.length && !this.result; i++) {
      var c = this.combatants[i];
      if (!c.alive || !c.phases || !c.phases.length) continue;
      for (var k = 0; k < c.phases.length && !this.result && c.alive; k++) {
        var ph = c.phases[k], frac = c.hp / c.maxHp;
        if (c.phaseDone[k]) {
          if (ph.once === false && frac > ph.at) c.phaseDone[k] = false;
          continue;
        }
        if (frac > ph.at) continue;
        c.phaseDone[k] = true;
        ev.push({ t: 'phase', who: c.idx, idx: k, say: ph.say || '' });
        if (ph.cast && this.cards[ph.cast]) this._phaseCast(c, this.cards[ph.cast], ev);
        if (ph.summon && ph.summon.length && !this.result) this._summon(c, ph.summon, ev);   // v2.1 D15
      }
    }
  };

  Battle.prototype._phaseCast = function (c, card, ev) {
    var t = card.type, target = c.idx;
    if (ATTACK_TYPES[t] || t === 'trap' || t === 'weakness') target = this._chooseFoe(c).idx;   // v2.0 WS-C (classic: 0)
    else if (t === 'heal' || t === 'hot') target = this._lowestAlly(c.idx).idx;
    if (t === 'shield' || t === 'absorb') c.lastDefendRound = this.round;
    this._cast(c.idx, card, target, ev, true);
  };

  // ===================================================================
  //  CASTING (shared by the player, spell scrolls and enemies)
  // ===================================================================

  // Who are the "other side" of this caster?
  Battle.prototype._opponents = function (who) {
    var out = [];
    for (var i = 0; i < this.combatants.length; i++) {
      var c = this.combatants[i];
      if (c.alive && c.isPlayer !== this.combatants[who].isPlayer) out.push(c);
    }
    return out;
  };

  // Pick a valid single target among the caster's opponents.
  Battle.prototype._pickTarget = function (who, targetIdx) {
    var opp = this._opponents(who);
    for (var i = 0; i < opp.length; i++) if (opp[i].idx === targetIdx) return opp[i];
    return opp[0] || null;   // invalid / dead target -> first living opponent
  };

  // ---- v2.0 WS-C: who a support spell lands on. A player may target a standing
  //      ALLY (heal / hot / blade / shield / absorb); anything else = the caster
  //      itself, which is exactly the classic rule. Enemies always self-cast here
  //      (their heals pick the lowest-% ally in _cast as before).
  Battle.prototype._allyTarget = function (caster, targetIdx) {
    if (!caster.isPlayer || targetIdx == null || targetIdx === caster.idx) return caster;
    var t = this.combatants[targetIdx];
    return (t && t.isPlayer && t.alive && !t.fled) ? t : caster;
  };

  // ---- v2.0 WS-C: which player an enemy goes after this turn. One standing player
  //      (every classic duel) = that player, with NO random roll, so single-player
  //      duels keep their exact random sequence. In a party: weighted pick
  //      (tank role, missing health, who hit it last, sure kills; see PARTY_AGGRO).
  Battle.prototype._chooseFoe = function (e) {
    var foes = [], s;
    for (s = 0; s < this.players.length; s++) if (this._standing(s)) foes.push(this.players[s]);
    if (foes.length <= 1) return foes[0] || this.player;
    var A = this.partyAggro, schools = (WF.data && WF.data.schools) || {}, ws = [], total = 0, top = 0;
    for (s = 0; s < foes.length; s++) {
      var f = foes[s], w = 1, sc = schools[f.school];
      if (sc && /tank/i.test(sc.role || '')) w *= A.tank;
      w *= 1 + A.wounded * (1 - f.hp / Math.max(1, f.maxHp));
      if (e.lastHitBy === f.idx) w *= A.lastHit;
      if (this._canSurelyKill(e, f)) w *= A.finisher;
      ws.push(w); if (w > top) top = w;
    }
    for (s = 0; s < ws.length; s++) { ws[s] = Math.pow(ws[s] / top, A.sharpness); total += ws[s]; }
    var r = this.rng() * total;
    for (s = 0; s < foes.length; s++) { r -= ws[s]; if (r <= 0) return foes[s]; }
    return foes[foes.length - 1];
  };
  Battle.prototype._canSurelyKill = function (e, f) {
    for (var i = 0; i < e.deck.length; i++) {
      var c = this.cards[e.deck[i]];
      if (!c || !ATTACK_TYPES[c.type] || !this._affordable(e, c)) continue;
      if (this._preview(e.idx, c.id, f.idx).min >= f.hp + f.absorb) return true;
    }
    return false;
  };
  // The foe the enemy AI is scoring against right now (classic: the player).
  Battle.prototype._aiFoe = function () {
    if (this._aiTarget) return this._aiTarget;
    for (var s = 0; s < this.players.length; s++) if (this._standing(s)) return this.players[s];
    return this.player;
  };

  // Lowest-health-% living member of the caster's own side.
  Battle.prototype._lowestAlly = function (who) {
    var me = this.combatants[who], best = null;
    for (var i = 0; i < this.combatants.length; i++) {
      var c = this.combatants[i];
      if (!c.alive || c.isPlayer !== me.isPlayer) continue;
      if (!best || c.hp / c.maxHp < best.hp / best.maxHp) best = c;
    }
    return best || me;
  };

  // free = true: boss phase cast (no accuracy roll, no pips, no mana).
  Battle.prototype._cast = function (who, card, targetIdx, ev, free) {
    var caster = this.combatants[who];
    var cost = card.pips || 0;

    if (!free) {
      // Accuracy roll. A fizzle wastes the turn but spends no pips or mana.
      var chance = this.accFor(caster, card);
      if (this.rng() * 100 >= chance) {
        ev.push({ t: 'fizzle', who: who, card: card.id });
        return;
      }
      this._payPips(caster, card);
      if (caster.isPlayer) caster.mana = Math.max(0, caster.mana - cost);
    }

    var target, targets;
    switch (card.type) {
      case 'damage':
      case 'dot':
        target = this._pickTarget(who, targetIdx);
        if (!target) return;
        ev.push({ t: 'cast', who: who, card: card.id, targets: [target.idx], free: !!free });
        this._attack(caster, card, [target], ev);
        break;

      case 'aoe':
        targets = this._opponents(who);
        ev.push({ t: 'cast', who: who, card: card.id, targets: targets.map(function (c) { return c.idx; }), free: !!free });
        this._attack(caster, card, targets, ev);
        break;

      case 'heal':
      case 'hot':
        // Player heals self (v2.0 WS-C: or the ally it targets); enemies heal
        // whoever the AI chose (lowest-% ally).
        target = this._allyTarget(caster, targetIdx);
        if (!caster.isPlayer) {
          var t = this.combatants[targetIdx];
          target = (t && t.alive && !t.isPlayer) ? t : this._lowestAlly(who);
        }
        ev.push({ t: 'cast', who: who, card: card.id, targets: [target.idx], free: !!free });
        this._heal(caster, target, card.value || 0, ev);
        if (card.type === 'hot' && card.hot) {
          var h = { name: card.name, amt: card.hot.amt, rounds: card.hot.rounds, school: card.school };
          target.hots.push(h);
          ev.push({ t: 'hot', target: target.idx, effect: copy(h) });
        }
        break;

      case 'blade':     // + on caster's next matching hit
      case 'shield':    // − on caster's next matching hit taken
        target = this._allyTarget(caster, targetIdx);    // v2.0 WS-C: a player may buff an ally
        ev.push({ t: 'cast', who: who, card: card.id, targets: [target.idx], free: !!free });
        this._addEffect(target, card, card.type === 'blade' ? 'charms' : 'wards', ev);
        break;

      case 'trap':      // + on target's next matching hit taken
      case 'weakness':  // − on target's next hit dealt
        target = this._pickTarget(who, targetIdx);
        if (!target) return;
        ev.push({ t: 'cast', who: who, card: card.id, targets: [target.idx], free: !!free });
        this._addEffect(target, card, card.type === 'weakness' ? 'charms' : 'wards', ev);
        break;

      case 'absorb':
        // Absorbs don't add up: a new one replaces a smaller one (stops spam-stacking).
        target = this._allyTarget(caster, targetIdx);    // v2.0 WS-C: a player may ward an ally
        ev.push({ t: 'cast', who: who, card: card.id, targets: [target.idx], free: !!free });
        target.absorb = Math.max(target.absorb, card.value || 0);
        ev.push({ t: 'absorb', target: target.idx, value: target.absorb });
        break;

      default:
        ev.push({ t: 'cast', who: who, card: card.id, targets: [], free: !!free });
    }
  };

  // ---- v1.2 WS4: spell riders (boss-earned spells, V1.2-CONTRACT §8) ----
  // An attack card may carry `rider`, a second effect that lands after the hit:
  //   rider: { type: 'absorb', value }                       caster soaks `value` (absorb rules: the bigger one stays)
  //   rider: { type: 'hot', hot: { amt, rounds }, name? }     heal-over-time on the CASTER
  //   rider: { type: 'trap', value, affects, name? }          a trap on the struck target (if it still stands)
  // The rider needs the cast to land: a fizzle or a free-cast with no target gives nothing, and a
  // duel that the hit just ended gets no rider. It reuses the normal events ('absorb' / 'hot' /
  // 'ward'), so the duel view needs no changes. Wraps _cast so the core switch stays untouched.
  var castWithoutRider = Battle.prototype._cast;
  Battle.prototype._cast = function (who, card, targetIdx, ev, free) {
    var n = ev.length;
    castWithoutRider.call(this, who, card, targetIdx, ev, free);
    if (!card || !card.rider || this.result) return;
    var cast = null;
    for (var i = n; i < ev.length; i++) if (ev[i].t === 'cast' && ev[i].who === who) { cast = ev[i]; break; }
    if (!cast) return;                                   // fizzled (or no target)
    this._rider(this.combatants[who], card, cast.targets || [], ev);
  };
  Battle.prototype._rider = function (caster, card, targetIdxs, ev) {
    var r = card.rider;
    if (!caster.alive) return;
    if (r.type === 'absorb') {
      caster.absorb = Math.max(caster.absorb, r.value || 0);
      ev.push({ t: 'absorb', target: caster.idx, value: caster.absorb, rider: card.id });
    } else if (r.type === 'hot' && r.hot) {
      var h = { name: r.name || card.name, amt: r.hot.amt, rounds: r.hot.rounds, school: card.school };
      caster.hots.push(h);
      ev.push({ t: 'hot', target: caster.idx, effect: copy(h), rider: card.id });
    } else if (r.type === 'trap') {
      var trap = { id: card.id, name: r.name || card.name, type: 'trap', value: r.value || 0, affects: r.affects || card.school, school: card.school };
      for (var i = 0; i < targetIdxs.length; i++) {
        var t = this.combatants[targetIdxs[i]];
        if (t && t.alive && t !== caster) this._addEffect(t, trap, 'wards', ev);
      }
    }
  };

  // ---- v2.0 M1: Runeglass ranks. Every cast (player, scroll, enemy, phase) goes
  // through rankedCard first, so the rider wrapper above and the switch see the
  // ranked values. Only combatants with spellRanks (the player) are affected.
  var castUnranked = Battle.prototype._cast;
  Battle.prototype._cast = function (who, card, targetIdx, ev, free) {
    return castUnranked.call(this, who, this.rankedCard(this.combatants[who], card), targetIdx, ev, free);
  };

  // Put a blade/weakness (charms) or trap/shield (wards) on someone.
  Battle.prototype._addEffect = function (onWho, card, listName, ev) {
    var effect = { name: card.name, kind: card.type, value: card.value || 0, affects: card.affects || 'any', school: card.school, sourceCard: card.id };
    var list = onWho[listName];
    var evType = listName === 'charms' ? 'charm' : 'ward';
    if (list.length >= this.maxCharms) {
      // Full (6 max): the spell goes off but has no room to stick.
      ev.push({ t: evType, target: onWho.idx, effect: copy(effect), blocked: true });
      return;
    }
    list.push(effect);
    ev.push({ t: evType, target: onWho.idx, effect: copy(effect) });
  };

  Battle.prototype._heal = function (caster, target, value, ev) {
    var amount = Math.min(value, target.maxHp - target.hp);
    target.hp += amount;
    ev.push({ t: 'heal', who: caster.idx, target: target.idx, amount: amount });
  };

  // ---------------- the damage pipeline ----------------
  // Which of the caster's charms apply? (blades +, weaknesses −)
  // Same name: only the first counts. Doesn't consume anything.
  Battle.prototype._casterMods = function (caster, card) {
    var dmg = this.dmgFor(caster, card.school), mult = 1 + dmg, mods = [], used = [], seen = {};
    if (dmg) {
      var pct = Math.round(dmg * 100);
      mods.push({ label: (caster.isPlayer ? 'Your damage ' : caster.name + ' damage ') + pctText(pct), pct: pct, source: 'stat' });
    }
    var flat = this.flatFor(caster, card);
    if (flat) mods.push({ label: (caster.isPlayer ? 'Pet strike +' : caster.name + ' strike +') + flat, pct: 0, flat: flat, source: 'stat' });
    for (var i = 0; i < caster.charms.length; i++) {
      var c = caster.charms[i];
      if (!matches(c, card) || seen[c.name]) continue;
      seen[c.name] = true;
      var p = c.kind === 'weakness' ? -c.value : c.value;
      mult *= 1 + p / 100;
      used.push(c);
      mods.push({ label: c.name + ' ' + pctText(p), pct: p, source: c.kind });
    }
    return { mult: mult, mods: mods, used: used, flat: flat };
  };

  // Which of the target's wards apply? (traps +, shields −) plus resist
  // and the target's school affinity.
  Battle.prototype._targetMods = function (target, card, hitSchool) {
    var mult = 1, mods = [], used = [], seen = {};
    for (var i = 0; i < target.wards.length; i++) {
      var w = target.wards[i];
      if (!matches(w, card) || seen[w.name]) continue;
      seen[w.name] = true;
      var p = w.kind === 'shield' ? -w.value : w.value;
      mult *= 1 + p / 100;
      used.push(w);
      mods.push({ label: w.name + ' ' + pctText(p) + (w.kind === 'trap' ? ' (on target)' : ''), pct: p, source: w.kind });
    }
    // v2.0 M1: universal + school resist vs the HIT school (resist < 0 = weakness)
    var hs = hitSchool || card.school, res = this.resistFor(target, hs);
    if (res) {
      var r = Math.round(res * 100), part = bonusOf(target.ss && target.ss.resist, hs);
      mult *= Math.max(0, 1 - res);
      mods.push({ label: (res < 0 ? 'Target weakness ' : 'Target resist ') + pctText(-r) + (part ? ' (' + schoolName(hs) + ')' : ''), pct: -r, source: 'resist', school: part ? hs : undefined });
    }
    var aff = target.affinity && target.affinity[card.school];
    if (aff) {
      var ap = Math.round(aff * 100);
      mult *= Math.max(0, 1 - aff);
      mods.push({
        label: (aff > 0 ? 'Resists ' : 'Weak to ') + schoolName(card.school) + ' ' + pctText(-ap),
        pct: -ap, source: 'affinity'
      });
    }
    return { mult: mult, mods: mods, used: used };
  };

  function removeUsed(list, used) {
    return list.filter(function (x) { return used.indexOf(x) < 0; });
  }

  // Damage / AoE / DoT. Caster charms are consumed ONCE (even for AoE);
  // each target's wards are consumed separately. A DoT's per-round tick is
  // snapshot with the same multiplier as its instant hit on that target.
  Battle.prototype._attack = function (caster, card, targets, ev) {
    var cm = this._casterMods(caster, card);
    if (cm.used.length) {
      caster.charms = removeUsed(caster.charms, cm.used);
      ev.push({ t: 'consume', target: caster.idx, names: cm.used.map(function (x) { return x.name; }) });
    }
    var totalDealt = 0, hs = this.hitSchool(caster, card);
    for (var i = 0; i < targets.length && !this.result; i++) {
      var tgt = targets[i];
      if (!tgt.alive) continue;
      var tm = this._targetMods(tgt, card, hs);
      if (tm.used.length) {
        tgt.wards = removeUsed(tgt.wards, tm.used);
        ev.push({ t: 'consume', target: tgt.idx, names: tm.used.map(function (x) { return x.name; }) });
      }
      var base = this._randInt(card.min || 0, card.max || 0) + (cm.flat || 0);   // v2.0 pets: flat damage joins the base roll
      var raw = Math.round(base * cm.mult * tm.mult);
      var absorbed = Math.min(tgt.absorb, raw);
      tgt.absorb -= absorbed;
      var amount = raw - absorbed;
      tgt.hp = Math.max(0, tgt.hp - amount);
      totalDealt += amount;
      if (caster.isPlayer && !tgt.isPlayer) tgt.lastHitBy = caster.idx;   // v2.0 WS-C: enemy foe choice
      ev.push({ t: 'damage', who: caster.idx, target: tgt.idx, amount: amount, absorbed: absorbed, mods: cm.mods.concat(tm.mods), card: card.id, school: hs });

      if (tgt.hp <= 0) {
        this._kill(tgt, ev);
      } else if (card.type === 'dot' && card.dot) {
        var d = {
          name: card.name, amt: Math.max(0, Math.round(card.dot.amt * cm.mult * tm.mult)),
          base: card.dot.amt, rounds: card.dot.rounds, school: card.school, who: caster.idx
        };
        tgt.dots.push(d);
        ev.push({ t: 'dot', target: tgt.idx, effect: copy(d) });
      }
    }
    // Drain: the caster heals a share of the damage dealt (even on a killing blow).
    if (card.drain && totalDealt > 0 && caster.alive) {
      this._heal(caster, caster, Math.round(totalDealt * card.drain), ev);
    }
  };

  // Shared preview for the player AND the AI (nothing is consumed).
  Battle.prototype._preview = function (who, cardId, targetIdx) {
    var caster = this.combatants[who];
    var card = caster ? this.rankedCard(caster, this.cards[cardId]) : null;
    if (!card || !caster) return { min: 0, max: 0, heal: 0, acc: 0, mods: [] };
    var out = {
      min: 0, max: 0, heal: 0,
      acc: this.accFor(caster, card),
      mods: []
    };
    if (caster.ranks && caster.ranks[card.id]) out.rank = copy(caster.ranks[card.id]);
    if (ATTACK_TYPES[card.type]) {
      var tgt = this._pickTarget(who, targetIdx);
      var cm = this._casterMods(caster, card);
      var tm = tgt ? this._targetMods(tgt, card, this.hitSchool(caster, card)) : { mult: 1, mods: [] };
      var mult = cm.mult * tm.mult;
      out.min = Math.round(((card.min || 0) + (cm.flat || 0)) * mult);
      out.max = Math.round(((card.max || 0) + (cm.flat || 0)) * mult);
      out.mods = cm.mods.concat(tm.mods);
      out.target = tgt ? tgt.idx : null;
      out.absorb = tgt ? tgt.absorb : 0;   // this much will be soaked first
      if (card.type === 'dot' && card.dot) out.dot = { amt: Math.max(0, Math.round(card.dot.amt * mult)), rounds: card.dot.rounds, base: card.dot.amt };
      if (card.drain) out.drain = card.drain;
    } else if (card.type === 'heal' || card.type === 'hot') {
      out.heal = card.value || 0;
      if (card.type === 'hot' && card.hot) out.hot = { amt: card.hot.amt, rounds: card.hot.rounds };
    }
    return out;
  };

  // ---- v1.2 WS4: previews (hand tooltips, the player AI) also report a spell's rider (see _rider) ----
  var previewWithoutRider = Battle.prototype._preview;
  Battle.prototype._preview = function (who, cardId, targetIdx) {
    var c = this.combatants[who], card = c ? this.rankedCard(c, this.cards[cardId]) : this.cards[cardId];
    var out = previewWithoutRider.call(this, who, cardId, targetIdx);
    if (card && card.rider) out.rider = copy(card.rider);
    if (card && (card.type === 'blade' || card.type === 'trap' || card.type === 'shield' || card.type === 'weakness' || card.type === 'absorb')) out.value = card.value || 0;
    return out;
  };

  // ===================================================================
  //  ENEMY AI  (utility scoring + personality weights)
  //  Affordability always goes through _affordable/_pipValue so bright
  //  pips are understood (a bright pip pays 2 for the enemy's own Hollow
  //  spells).
  // ===================================================================
  Battle.prototype._enemyAct = function (idx, ev) {
    var e = this.combatants[idx];
    // v2.0 WS-C: pick WHICH player to go after first (classic: the player, no dice roll);
    // the scoring below then runs against that foe (this._aiFoe()).
    this._aiTarget = this._chooseFoe(e);
    var choice = this._chooseEnemyAction(idx);
    this._aiTarget = null;
    if (!choice) {
      e.idleStreak++;
      ev.push({ t: 'pass', who: idx });
      return;
    }
    e.idleStreak = 0;
    var card = this.cards[choice.cardId];
    if (card.type === 'heal' || card.type === 'hot') e.healsCast++;
    if (card.type === 'shield' || card.type === 'absorb') e.lastDefendRound = this.round;
    this._cast(idx, card, choice.target, ev);
  };

  // How hard can the player hit this enemy soon? (used to value shields/weakness)
  Battle.prototype._playerHitEstimate = function (e) {
    var p = this._aiFoe(), best = 0, any = 0, dc = this._kit(p.idx).deckCounts;
    for (var id in dc) {
      var c = this.cards[id];
      if (!ATTACK_TYPES[c.type]) continue;
      var aff = (e.affinity && e.affinity[c.school]) || 0;
      var v = (avg(c) + this.flatFor(p, c)) * (1 + this.dmgFor(p, c.school)) * (1 - this.resistFor(e, c.school)) * (1 - aff);
      if (v > any) any = v;
      if ((c.pips || 0) <= this._pipValue(p, c) + 1 && v > best) best = v;
    }
    return best || any || 100;
  };

  // Best attack this enemy could cast soon (within `extraPips`) that a
  // charm with these `affects` would boost.
  Battle.prototype._bestOwnAttack = function (e, affects, extraPips) {
    var best = 0;
    for (var i = 0; i < e.deck.length; i++) {
      var c = this.cards[e.deck[i]];
      if (!c || !ATTACK_TYPES[c.type]) continue;
      if ((c.pips || 0) > this._pipValue(e, c) + extraPips) continue;
      if (affects !== 'any' && affects !== c.school) continue;
      var v = avg(c) * (1 + this.dmgFor(e, c.school)) * (1 - this.resistFor(this._aiFoe(), this.hitSchool(e, c)));
      if (v > best) best = v;
    }
    return best;
  };

  function hasName(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return true;
    return false;
  }

  // Score one card for one enemy. Returns { score, target, why }.
  Battle.prototype._scoreCard = function (e, card, prof) {
    var p = this._aiFoe();   // v2.0 WS-C: the player this enemy goes after (classic: the player)
    var t = card.type, pv, exp, score;
    if (ATTACK_TYPES[t]) {
      pv = this._preview(e.idx, card.id, p.idx);
      var hit = pv.acc / 100;
      exp = (pv.min + pv.max) / 2 * hit;
      if (t === 'dot' && pv.dot) exp += pv.dot.amt * pv.dot.rounds * 0.7 * hit;
      if (card.drain) exp += Math.min(card.drain * exp, e.maxHp - e.hp) * 0.5;
      score = exp * prof.attack;
      if (pv.min >= p.hp + p.absorb) score *= prof.finisher;   // sure kill: go for it
      return { score: score, target: p.idx, why: 'attack' };
    }
    var ph = this._playerHitEstimate(e);
    switch (t) {
      case 'blade':
        if (hasName(e.charms, card.name) || e.charms.length >= this.maxCharms) return { score: 0, why: 'already bladed' };
        return { score: card.value / 100 * this._bestOwnAttack(e, card.affects, 2) * 0.8 * prof.setup, target: e.idx, why: 'blade' };
      case 'trap':
        if (hasName(p.wards, card.name) || p.wards.length >= this.maxCharms) return { score: 0, why: 'already trapped' };
        return { score: card.value / 100 * this._bestOwnAttack(e, card.affects, 2) * 0.8 * prof.setup, target: p.idx, why: 'trap' };
      case 'weakness':
        if (hasName(p.charms, card.name) || p.charms.length >= this.maxCharms) return { score: 0, why: 'already weakened' };
        return { score: card.value / 100 * ph * prof.debuff, target: p.idx, why: 'weakness' };
      case 'shield':
        if (this.round - e.lastDefendRound <= prof.defendCooldown) return { score: 0, why: 'defend cooldown' };
        if (hasName(e.wards, card.name) || e.wards.length >= this.maxCharms) return { score: 0, why: 'already shielded' };
        return { score: card.value / 100 * ph * prof.defend, target: e.idx, why: 'shield' };
      case 'absorb':
        if (this.round - e.lastDefendRound <= prof.defendCooldown) return { score: 0, why: 'defend cooldown' };
        if (e.absorb > 0) return { score: 0, why: 'already absorbing' };
        return { score: Math.min(card.value || 0, ph) * 0.7 * prof.defend, target: e.idx, why: 'absorb' };
      case 'heal':
      case 'hot':
        // Heal only when it matters: the weakest ally must be under healAt,
        // and only a limited number of times per duel.
        if (e.healsCast >= prof.maxHeals) return { score: 0, why: 'out of heals' };
        var ally = this._lowestAlly(e.idx);
        var pct = ally.hp / ally.maxHp;
        if (pct >= prof.healAt) return { score: 0, why: 'nobody hurt enough' };
        var amt = card.value || 0;
        if (t === 'hot' && card.hot) amt += card.hot.amt * card.hot.rounds * 0.6;
        return { score: Math.min(amt, ally.maxHp - ally.hp) * (1 + (prof.healAt - pct)) * prof.heal, target: ally.idx, why: 'heal ' + ally.name };
    }
    return { score: 0, why: 'unknown type' };
  };

  // Decide what enemy `idx` does this turn. Returns { cardId, target } or null (pass).
  Battle.prototype._chooseEnemyAction = function (idx) {
    var e = this.combatants[idx];
    var prof = this.aiProfiles[e.ai] || this.aiProfiles.basic;
    var counts = {}, i, id, card;
    for (i = 0; i < e.deck.length; i++) counts[e.deck[i]] = (counts[e.deck[i]] || 0) + 1;

    // 1) Score everything affordable (bright pips included).
    var options = [];
    for (id in counts) {
      card = this.cards[id];
      if (!card || !this._affordable(e, card)) continue;
      var s = this._scoreCard(e, card, prof);
      if (s.score > 0) options.push({ cardId: id, card: card, target: s.target, score: s.score, count: counts[id], why: s.why });
    }

    // Biggest attack in the deck that fits under the pip cap (the "big spell").
    var big = null;
    for (id in counts) {
      card = this.cards[id];
      if (!card || !ATTACK_TYPES[card.type] || (card.pips || 0) > this.maxPips) continue;
      if (!big || card.pips > big.pips || (card.pips === big.pips && avg(card) > avg(big))) big = card;
    }
    var p = this._aiFoe();
    var lethal = options.filter(function (o) { return ATTACK_TYPES[o.card.type] && this._preview(idx, o.cardId, p.idx).min >= p.hp + p.absorb; }, this);
    var mode = 'normal';

    if (lethal.length) {
      // Anyone will take a guaranteed kill.
      options = lethal; mode = 'finish';
    } else if (prof.savesPips && big) {
      // ---- BOSS: save pips for the big spell, buffing while waiting ----
      var isSetup = function (o) { return o.card.type === 'blade' || o.card.type === 'trap' || o.card.type === 'weakness'; };
      if (this._affordable(e, big)) {
        // Can afford it: place free buffs first, then unleash.
        var freeBuffs = options.filter(function (o) { return isSetup(o) && (o.card.pips || 0) === 0; });
        options = freeBuffs.length ? freeBuffs : options.filter(function (o) { return o.cardId === big.id; });
        mode = freeBuffs.length ? 'buff-before-big' : 'unleash';
      } else {
        // Still charging: only free (0-pip) spells, or an urgent heal.
        var allowed = options.filter(function (o) {
          return (o.card.pips || 0) === 0 || o.card.type === 'heal' || o.card.type === 'hot';
        });
        if (allowed.length) { options = allowed; mode = 'charging'; }
        else if (e.idleStreak < prof.maxIdle) { options = []; mode = 'charging-wait'; }
        else mode = 'impatient';   // waited long enough: use whatever it can
      }
    } else {
      // ---- everyone else: maybe skip a turn to afford a much bigger hit ----
      var bestNext = 0;
      if (e.pips + 1 <= this.maxPips) {
        for (id in counts) {
          card = this.cards[id];
          if (card && ATTACK_TYPES[card.type] && card.pips === this._pipValue(e, card) + 1) {
            var pv = this._preview(idx, id, p.idx);
            bestNext = Math.max(bestNext, (pv.min + pv.max) / 2 * pv.acc / 100 * prof.attack);
          }
        }
      }
      // Waiting a round for `bestNext` is worth about half of it per round.
      if (bestNext > 0 && prof.saveBias > 0) {
        options.push({ cardId: null, card: null, target: null, score: bestNext / 2 * prof.saveBias, count: 1, why: 'save pips' });
      }
    }

    // 2) Weighted random pick, strongly favouring the best options.
    var top = 0;
    for (i = 0; i < options.length; i++) top = Math.max(top, options[i].score);
    var pool = options.filter(function (o) { return top > 0 && o.score / top >= prof.minRel; });
    var total = 0;
    pool.forEach(function (o) { o.weight = o.count * Math.pow(o.score / top, prof.sharpness); total += o.weight; });
    var pick = null;
    if (pool.length) {
      var r = this.rng() * total;
      for (i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { pick = pool[i]; break; } }
      if (!pick) pick = pool[pool.length - 1];
    }

    // 3) Debug log (keep the last 200 decisions).
    this.aiLog.push({
      round: this.round, who: idx, name: e.name, ai: e.ai, pips: e.pips, bright: e.bright, mode: mode,
      choice: pick ? (pick.cardId || 'pass(save)') : 'pass',
      options: pool.map(function (o) { return { card: o.cardId || 'pass', score: Math.round(o.score), why: o.why }; })
    });
    if (this.aiLog.length > 200) this.aiLog.shift();

    if (!pick || !pick.cardId) return null;
    return { cardId: pick.cardId, target: pick.target };
  };

  // ---------------- randomness (uses the injectable rng) ----------------
  Battle.prototype._randInt = function (min, max) {
    if (max <= min) return min;
    return min + Math.floor(this.rng() * (max - min + 1));
  };
  Battle.prototype._shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  };

  WF.Battle = Battle;
  if (typeof module !== 'undefined' && module.exports) module.exports = Battle;
})(typeof window !== 'undefined' ? window : global);
