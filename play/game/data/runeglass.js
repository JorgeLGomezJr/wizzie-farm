// =====================================================================
//  WIZZIE FARM — RUNEGLASS + THE SPELLWRIGHT  (v2.0 M1 "Schools", WS-A)
//
//  Contract: docs/V2.0-CONTRACT.md §2 + §9, docs/V1.2-CONTRACT.md §10.
//  Lore (docs/design/story.md §8): Runeglass are shards of the Hollow
//  Orrery's star-lenses, the great lenses the Lanternwrights used to find
//  and pull down living stars. The Spellwright (npcs.js `spellwright`) is a
//  Lanternwright descendant who grinds the shards into the glass of a spell
//  so it remembers being cast and grows a little brighter.
//
//  * CURRENCY  p.runeglass (a number, never an item: it can't be sold,
//    banked or traded). Bosses drop it (drops below); the FIRST time a
//    wizard frees a boss always pays `first`.
//  * UPGRADES  every school spell (playable school, not Lumen, not enemy)
//    and every boss-earned spell can be raised from rank 1 (base) to
//    rank 5 along ONE of two paths. Picking a path locks the other until a
//    paid reset at the Spellwright (gold; the Runeglass is refunded).
//      path A = raw power (about +3 % per rank)
//      path B = a utility rider that grows per rank (school-flavoured)
//    Saved per wizard: p.spellRanks = { cardId: { path: 'a'|'b', rank: 2..5 } }.
//  * COST CURVE (Runeglass per step): rank 2 ~ one dungeon clear, rank 5 in
//    total ~ 7 clears per spell (a clear pays ~6). A fully upgraded spell is
//    worth ~ +12-15 % on that spell. v2.0: NOT counted in balance-sim's gear-vs-level rule (like pets,
//    decision D7); measured with ranks it would be 1.23-1.34x vs the 1.25x cap (review F1): pending
//    Jorge's decision D12 in docs/handoff/PENDING-DECISIONS.md.
//  * combat.js applies a path with the pure Battle.rankCard(card, info, R)
//    via R.pathFor(card, path, school) -> { id, name, fx }. fx values are
//    PER RANK ABOVE 1 (rank 5 = 4 x the value).
//  Everything here is data: add spells, change costs or paths freely and
//  re-run node tests/combat.test.js and node tests/state.test.js.
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  var R = WF.data.runeglass = {
    name: 'Runeglass', color: '#9fe6ff', glyph: '◈',
    desc: 'A shard of one of the Hollow Orrery\'s great star-lenses. Hold it up and the light bends toward you.',
    npc: 'spellwright',
    maxRank: 5,
    // Runeglass to go FROM rank-1 TO this rank (sum 2..5 = 42 per spell)
    cost: { 2: 4, 3: 8, 4: 12, 5: 18 },
    // reset one spell back to rank 1 (all its Runeglass back): gold per rank above 1
    resetGoldPerRank: 150,

    // ---- drops (state.js rollLoot). first = paid on a wizard's FIRST victory
    //      over that boss; after that `chance` to get n[0]..n[1].
    drops: {
      grubnak:         { first: 4, chance: 0.25, n: [1, 1] },
      thornmaw:        { first: 4, chance: 0.25, n: [1, 1] },
      captain_vex:     { first: 4, chance: 0.30, n: [1, 2] },
      nyx_herald:      { first: 5, chance: 0.50, n: [1, 2] },
      // the Hollow Orrery: its lenses are where Runeglass comes from
      orrery_sentinel: { first: 3, chance: 1, n: [1, 2] },
      warden_morrow:   { first: 3, chance: 1, n: [1, 2] },
      starless_archon: { first: 4, chance: 1, n: [2, 3] }
    },

    // ---- the two paths. Picked by card type (+ the caster's school for B).
    paths: {
      attack: {
        a: { id: 'a', name: 'Empower', color: '#ffcf6a', fx: { dmg: 0.03 }, text: '+{dmg}% damage' },
        b: {
          stoneward:   { id: 'b', name: 'Bedrock',  color: '#d4a25f', fx: { rider: { type: 'absorb', per: 30, name: 'Bedrock' } }, text: 'after the hit, soak {rider} damage' },
          tidecaller:  { id: 'b', name: 'Undertow', color: '#4fc3e8', fx: { drain: 0.04 }, text: 'heal for +{drain}% of the damage' },
          emberstrike: { id: 'b', name: 'Kindling', color: '#ff6b3d', fx: { rider: { type: 'trap', per: 4, name: 'Kindling', affects: 'emberstrike' } }, text: 'leave a +{rider}% Emberstrike trap on each target hit' }
        }
      },
      // boss-earned spells already carry a rider: B makes it bigger
      bossAttack: {
        a: { id: 'a', name: 'Empower', color: '#ffcf6a', fx: { dmg: 0.03 }, text: '+{dmg}% damage' },
        b: { id: 'b', name: 'Ascend', color: '#ff9ef0', fx: { riderMult: 0.15 }, text: 'its bonus effect is +{riderMult}% stronger' }
      },
      heal: {
        a: { id: 'a', name: 'Bloom', color: '#7fffb0', fx: { heal: 0.04 }, text: '+{heal}% healing' },
        b: { id: 'b', name: 'Shelter', color: '#bfe6ff', fx: { rider: { type: 'absorb', per: 25, name: 'Shelter' } }, text: 'also soak the next {rider} damage' }
      },
      charm: {
        a: { id: 'a', name: 'Keen', color: '#ffcf6a', fx: { value: 2 }, text: '+{value} to its percent' },
        b: { id: 'b', name: 'Afterglow', color: '#7fffb0', fx: { rider: { type: 'hot', per: 8, rounds: 3, name: 'Afterglow' } }, text: 'you heal {rider} each round for 3 rounds' }
      },
      absorb: {
        a: { id: 'a', name: 'Bastion', color: '#d4a25f', fx: { valueMult: 0.06 }, text: 'soaks +{valueMult}% more' },
        b: { id: 'b', name: 'Afterglow', color: '#7fffb0', fx: { rider: { type: 'hot', per: 8, rounds: 3, name: 'Afterglow' } }, text: 'you heal {rider} each round for 3 rounds' }
      }
    }
  };

  var ATTACK = { damage: 1, aoe: 1, dot: 1 }, CHARM = { blade: 1, trap: 1, shield: 1, weakness: 1 };
  var PLAYABLE = WF.data.playableSchools || ['stoneward', 'tidecaller', 'emberstrike'];

  // Can this card be upgraded at all? School spells of the playable schools
  // (learned by levelling) and boss-earned spells.
  R.eligible = function (card) {
    if (!card || PLAYABLE.indexOf(card.school) < 0) return false;
    if (card.source && card.source !== 'boss') return false;
    return !!R.category(card);
  };
  R.category = function (card) {
    if (!card) return null;
    if (ATTACK[card.type]) return card.source === 'boss' && card.rider ? 'bossAttack' : 'attack';
    if (card.type === 'heal' || card.type === 'hot') return 'heal';
    if (CHARM[card.type]) return 'charm';
    if (card.type === 'absorb') return 'absorb';
    return null;
  };
  // The path definition { id, name, color, fx, text } for card + path ('a'|'b').
  // A path B that depends on the school uses the CARD's school (a trained
  // Tidecaller spell keeps its Undertow even on a Stoneward).
  R.pathFor = function (card, path, school) {
    var cat = R.category(card), P = cat && R.paths[cat];
    if (!P || (path !== 'a' && path !== 'b')) return null;
    var d = P[path];
    if (d && !d.fx) d = d[card.school] || d[school] || null;
    return d || null;
  };
  // Runeglass for one step to `rank`, and the total spent up to `rank`.
  R.stepCost = function (rank) { return R.cost[rank] || 0; };
  R.spentTo = function (rank) { var n = 0; for (var r = 2; r <= rank; r++) n += R.stepCost(r); return n; };
  // Human text of a path at a rank, e.g. "Empower: +9% damage"
  R.describe = function (card, path, rank, school) {
    var d = R.pathFor(card, path, school);
    if (!d) return '';
    var n = Math.max(0, (rank || 1) - 1), fx = d.fx, t = d.text || '';
    var val = function (k) {
      if (k === 'rider') return fx.rider ? Math.round(n * fx.rider.per) : 0;
      if (k === 'dmg' || k === 'heal' || k === 'valueMult' || k === 'riderMult' || k === 'drain') return Math.round(n * fx[k] * 100);
      return Math.round(n * (fx[k] || 0));
    };
    return d.name + ': ' + t.replace(/\{(\w+)\}/g, function (m, k) { return val(k); });
  };
})();
