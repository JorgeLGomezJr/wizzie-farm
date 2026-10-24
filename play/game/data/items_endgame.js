// =====================================================================
//  WIZZIE FARM — ENDGAME GEAR (v1.2 "Deck & Dungeon", workstream WS2)
//
//  Contract: docs/V1.2-CONTRACT.md §2.1-2.3, §2.5 (looks), §6.1 (school-
//  specific gear, random-school drops), §6.3 (tiers T1/T2/T3, upgrades,
//  salvage, set bonuses), §6.4 (gear-vs-level rule).
//  Design + the stat budget tables: docs/design/combat-and-progression.md §16.
//  Proof: node tests/balance-sim.js --only=endgame (part of --check).
//  Loaded right after items.js (it adds to WF.data.items).
//
//  THE LEVEL 10 POWER SPIKE (a W101-style ladder):
//    * STARBOUND (legendary): hat, robe, wand, amulet. Hollow Orrery bosses
//      (enemies_dungeon.js): Sentinel -> amulet (+ the boots), Warden Morrow ->
//      wand, Starless Archon -> hat + robe.
//    * STARWALKER GREAVES (legendary): the best boots. v2.1: they drop in the
//      dungeon too (Orrery Sentinel), no longer from Nyx, so the whole dungeon
//      set comes from the dungeon. They count toward the Starbound set bonus.
//    * v2.1 DUSKHERALD (epic, the world-boss set, Nyx): see the end of this
//      file, with WF.data.gearLadder (the power budget per world/track/tier).
//    * ARTIFICER (epic, crafted: true): all five slots, ONLY from Tamsin
//      Gearwright in Lanternmere (recipes.js). 90-97 % of the same-tier
//      Starbound budget with a different mix (more Pip Surge, less Bright Pip).
//    Every piece exists for every school (role-shaped stats: Stoneward =
//    health/resist, Tidecaller = mana/accuracy, Emberstrike = damage/Bright Pip)
//    and in three tiers:
//      T1 <base>        Starbound / Starwalker / Artificer's        (drop / craft)
//      T2 <base>_t2     Radiant Starbound ... / Master Artificer's  (rare drop or upgrade)
//      T3 <base>_t3     Ascendant Starbound ... / Grand Artificer's (upgrade; v2.1: Starbound also a ~1 % drop)
//    School versions are <id>_<school>; the school-less <id> is the DROP id
//    with `variants`. v2.1 (Jorge): `ownSchool: true` pieces (Starbound,
//    Starwalker, Duskherald) drop ONLY in the looter's own school (state.js
//    dropVariant); other `variants` drops still roll the school 1/3 each.
//    `next` = the id the piece upgrades into at Tamsin (WF.data.gearUpgrades).
//
//  New gear stats (percent, like dmg): brightPip ("Bright Pip": chance each
//  new pip is bright) and pipSurge ("Pip Surge": chance to gain 2 pips in a
//  round). Caps in progression.js (brightPipCap 0.60, pipSurgeCap 0.35).
//
//  HOW THE NUMBERS ARE MADE: the tables below hold the T3 stats of each
//  school version (hand-tuned with tests/balance-sim.js). T1 and T2 are
//  T3 x TIER_SCALE (rounded; a stat never rounds away to 0). The school-less
//  base piece takes the lowest value of each stat across the three schools
//  (so every school version is at least as good as its base).
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  var I = WF.data.items;
  var gen = WF.data.gearGen;
  var SCHOOLS = ['stoneward', 'tidecaller', 'emberstrike'];
  var STATS = ['hp', 'mana', 'dmg', 'resist', 'acc', 'brightPip', 'pipSurge'];

  // ---------------------------------------------------------------- tiers
  // Share of the T3 stats a lower tier keeps: `off` for the offensive stats
  // (damage, Bright Pip, Pip Surge), `def` for the rest (health, resist,
  // accuracy, mana). The set bonuses count ANY tier, so a T1 set already
  // gets them: that is why the offensive share of T1 is the lower one.
  // Tuned with tests/balance-sim.js so a full Starbound+Starwalker set (with
  // its set bonuses) gives, vs typical L10 gear (contract §6.3):
  //   T1 ~ +15-20 % damage output / +12 % max health
  //   T2 ~ +25-30 % / +20 %
  //   T3 ~ +35-45 % / +30 %
  // ARTIFICER lower tiers stay inside the contract's 90-97 % band of the
  // same-tier Starbound piece (keepShare below trims or pads health only
  // when rounding pushed a piece out of it).
  var TIER_SCALE = {
    1: { off: 0.61, def: 0.75 },
    2: { off: 0.78, def: 0.86 },
    3: { off: 1, def: 1 }
  };
  var OFF = { dmg: 1, brightPip: 1, pipSurge: 1 };
  // Sell price multiplier per tier (on top of the normal L10 rarity price).
  var TIER_SELL = { 1: 1, 2: 1.5, 3: 2 };
  WF.data.gearTiers = {
    1: { name: 'Tier 1', short: 'T1' },
    2: { name: 'Tier 2', short: 'T2' },
    3: { name: 'Tier 3', short: 'T3' },
    scale: TIER_SCALE
  };

  // ---------------------------------------------------------------- set bonuses (§6.3)
  // Count = equipped pieces of the set (any tier) that the wearer's school
  // can wear. maxCount 4 for Starbound implements "Starwalker counts as
  // Starbound only if you wear <= 3 other Starbound pieces": the four
  // Starbound pieces + Starwalker can never count as more than 4.
  // `school` adds extra stats for one school (`schoolText` = its label then).
  WF.data.gearSets = {
    starbound: {
      name: 'Starbound', maxCount: 4,
      bonuses: [
        { count: 2, stats: { brightPip: 3 }, text: '+3% Bright Pip' },
        { count: 4, stats: { dmg: 5 }, school: { stoneward: { resist: 4 } }, text: '+5% Damage', schoolText: { stoneward: '+5% Damage, +4% Resist' } }
      ]
    },
    // v2.1 (Jorge, Oct 20 8:15 PM): the world final boss's own set (Nyx's "boss set", see below)
    duskherald: {
      name: 'Duskherald', maxCount: 5,
      bonuses: [
        { count: 3, stats: { pipSurge: 3 }, text: '+3% Pip Surge' },
        { count: 5, stats: { dmg: 4 }, text: '+4% Damage' }
      ]
    },
    artificer: {
      name: 'Artificer', maxCount: 5,
      bonuses: [
        { count: 2, stats: { pipSurge: 3 }, text: '+3% Pip Surge' },
        { count: 4, stats: { hp: 60, acc: 2 }, text: '+60 Health, +2% Accuracy' },
        { count: 5, stats: { pipSurge: 2 }, text: '+2% Pip Surge' }
      ]
    }
  };

  // ---------------------------------------------------------------- upgrades + salvage (§6.3)
  // Tamsin (npc) upgrades a piece one tier: T1 -> T2 (`t2`), T2 -> T3 (`t3`),
  // same school and slot; the old piece is consumed. Salvage turns an
  // unwanted endgame piece into Starlight Essence (t1 / t2 / t3 per piece).
  // tests/dungeon-sim.js (WS4) reads WF.data.gearUpgrades.starbound.
  // Farming math: docs/design/combat-and-progression.md §16.8.
  WF.data.gearUpgrades = {
    npc: 'tamsin',
    // v2.0 M1 (WS-A, review F-5): T1 -> T2 was 220 Star Shards (~7 clears per piece, ~28 for a set);
    // 95 = ~3 clears per piece, ~12 clears of shard income for all four (target 10-14)
    // v2.1 (Jorge: first T3 piece ~15-20 runs, drop or upgrade; full T3 a long chase): Starbound
    // T2 -> T3 10 -> 18 Starlight Essence, Starwalker 1 -> 2 Archon Cores and 15 -> 18 Essence
    // (with own-school drops there are fewer pieces to salvage). Measured: tests/loot-sim.js.
    starbound:  { t2: { star_shard: 340, gold: 2500 }, t3: { archon_core: 3, starlight_essence: 18, gold: 5000 }, salvage: { t1: 1, t2: 3, t3: 6 } },
    starwalker: { t2: { star_shard: 340, gold: 2500 }, t3: { archon_core: 2, starlight_essence: 18, gold: 5000 }, salvage: { t1: 1, t2: 3, t3: 6 } },
    artificer:  { t2: { star_shard: 340, gold: 2500 }, t3: { archon_core: 3, starlight_essence: 10, gold: 5000 }, salvage: { t1: 1, t2: 3, t3: 6 } }
  };

  // ---------------------------------------------------------------- reagents
  var REAGENTS = {
    star_shard:   { type: 'reagent', name: 'Star Shard',   color: '#cfe0ff', sell: 12,
                    desc: 'A sliver of a star that fell into the Hollow Orrery. Every creature down there carries a few. Tamsin wants all of them.' },
    archon_core:  { type: 'reagent', name: 'Archon Core',  color: '#7a4ad8', sell: 45,
                    desc: 'The still-turning heart of the Starless Archon. Warm, heavy, and humming in a key nobody has named yet.' },
    starlight_essence: { type: 'reagent', name: 'Starlight Essence', color: '#fff3c4', sell: 20,
                    desc: "What is left when Tamsin takes a piece of star-gear apart: one bright drop of the sky. Ascendant gear can't be made without it." }
  };

  // ---------------------------------------------------------------- the sets
  // Per slot: base id, noun, style, look per school (+ 'base'), T3 stats per
  // school, flavour text per school (+ 'base').
  // look rows: [color, color2, gem, fx]
  var SB_LOOK = { base: ['#141a3a', '#ffe9a0', '#bfe6ff', 'sparkle'], stoneward: ['#2a2238', '#e8c070', '#ffcf6a', 'sparkle'],
                  tidecaller: ['#0e1e44', '#cfe8ff', '#7fe0ff', 'frost'], emberstrike: ['#2a0e24', '#ffcf6a', '#ff8a4a', 'embers'] };
  var SW_LOOK = { base: ['#1a1030', '#e8e0ff', '#b06cff', 'shadow'], stoneward: ['#2a2238', '#e8c070', '#ffcf6a', 'shadow'],
                  tidecaller: ['#0e1e44', '#cfe8ff', '#7fe0ff', 'frost'], emberstrike: ['#2a0e24', '#ffcf6a', '#ff8a4a', 'embers'] };
  var AF_LOOK = { base: ['#6a4a2e', '#d8a84a', '#7fe0ff', 'glow'], stoneward: ['#5a4a3a', '#c9a24a', '#d4a25f', 'glow'],
                  tidecaller: ['#3a4a5a', '#d8b860', '#4fc3e8', 'frost'], emberstrike: ['#5a2a1a', '#e0a040', '#ff6b3d', 'embers'] };
  var AF_BRASS = { base: ['#b08a3a', '#6a4a2e', '#7fe0ff', 'glow'], stoneward: ['#8a7a5a', '#5a4a3a', '#d4a25f', 'glow'],
                   tidecaller: ['#a8b8c8', '#3a4a5a', '#4fc3e8', 'frost'], emberstrike: ['#c08a3a', '#5a2a1a', '#ff6b3d', 'embers'] };
  var SB_WORD = { stoneward: 'Bastion', tidecaller: 'Moontide', emberstrike: 'Flare' };
  var AF_WORD = { stoneward: 'Ironbound', tidecaller: 'Tidegauge', emberstrike: 'Furnace' };

  var SETS = [
    { set: 'starbound', cost: 'starbound', rarity: 'legendary', unique: true, ownSchool: true, words: SB_WORD,
      prefix: { 1: 'Starbound', 2: 'Radiant Starbound', 3: 'Ascendant Starbound' },
      tierFlavor: { 2: 'Tamsin threaded it with starlight; the trim glows now.', 3: 'Ascended: it carries a little piece of the sky wherever you go.' },
      pieces: [
        { slot: 'hat', id: 'starbound_hat', noun: 'Circlet', style: 'starbound', looks: SB_LOOK,
          t3: { stoneward:  { hp: 235, dmg: 10, resist: 2, mana: 6, brightPip: 5, pipSurge: 1 },
                tidecaller: { hp: 220, dmg: 10, acc: 7, mana: 10, brightPip: 5, pipSurge: 1 },
                emberstrike:{ hp: 200, dmg: 12, acc: 5, mana: 6, brightPip: 5, pipSurge: 1 } },
          desc: { base: 'A halo of seven tiny stars that circle your hood. They were there when the Orrery was built, and they remember the tune.',
                  stoneward: 'Its stars move slowly and never stray. Stone likes stars like that.',
                  tidecaller: 'The stars rise and fall around your head like a tide that forgot which way is down.',
                  emberstrike: 'Seven little suns, all of them showing off.' } },
        { slot: 'robe', id: 'starbound_robe', noun: 'Mantle', style: 'starbound', looks: SB_LOOK,
          t3: { stoneward:  { hp: 370, resist: 11, dmg: 5, mana: 7, brightPip: 4, pipSurge: 1 },
                tidecaller: { hp: 345, resist: 14, dmg: 5, mana: 11, brightPip: 4, pipSurge: 1 },
                emberstrike:{ hp: 335, resist: 12, dmg: 7, acc: 2, mana: 8, brightPip: 4, pipSurge: 1 } },
          desc: { base: 'A mantle cut from the night sky over the Orrery. Its shoulder plates float a finger-width from the cloth and hum when you cast.',
                  stoneward: 'Heavy as a mountain at night and twice as patient.',
                  tidecaller: 'Starlight pools in its folds like water. It never quite spills.',
                  emberstrike: 'Every star on it is a tiny ember that refuses to go out.' } },
        { slot: 'wand', id: 'starbound_wand', noun: 'Staff', style: 'starbound', looks: SB_LOOK,
          t3: { stoneward:  { dmg: 20, acc: 8, hp: 70, resist: 1, mana: 6, brightPip: 5 },
                tidecaller: { dmg: 19, acc: 10, hp: 60, mana: 9, brightPip: 5 },
                emberstrike:{ dmg: 21, acc: 8, hp: 50, mana: 6, brightPip: 5 } },
          desc: { base: 'A staff crowned with a working orrery the size of an apple. The planets line up just before your biggest spells.',
                  stoneward: 'Its little planets are carved from river stones. They orbit very, very steadily.',
                  tidecaller: 'The orrery on top has a moon that pulls at your mana like a tide.',
                  emberstrike: 'Every planet on this orrery is on fire. That is not how orreries work. Nobody has told it.' } },
        { slot: 'amulet', id: 'starbound_amulet', noun: 'Crescent', style: 'starbound',
          looks: { base: ['#1a1e3a', '#ffe9a0', '#ffffff', 'radiant'], stoneward: ['#2a2238', '#e8c070', '#ffcf6a', 'radiant'],
                   tidecaller: ['#0e1e44', '#cfe8ff', '#7fe0ff', 'frost'], emberstrike: ['#2a0e24', '#ffcf6a', '#ff8a4a', 'embers'] },
          t3: { stoneward:  { hp: 250, dmg: 10, resist: 3, acc: 4, mana: 6, brightPip: 5, pipSurge: 1 },
                tidecaller: { hp: 240, dmg: 10, resist: 5, acc: 6, mana: 9, brightPip: 5, pipSurge: 1 },
                emberstrike:{ hp: 225, dmg: 12, resist: 4, acc: 4, mana: 6, brightPip: 6, pipSurge: 1 } },
          desc: { base: 'A silver crescent holding one bright star. The Orrery Sentinel guarded it for a thousand years and never once looked at it.',
                  stoneward: 'The crescent is set in granite. The star in it never flickers.',
                  tidecaller: 'The crescent waxes and wanes with your mana. Full moon: full pips.',
                  emberstrike: 'The star in this crescent is very clearly trying to explode. Politely.' } }
      ] },
    { set: 'starbound', cost: 'starwalker', rarity: 'legendary', unique: true, ownSchool: true, words: SB_WORD,
      prefix: { 1: 'Starwalker', 2: 'Radiant Starwalker', 3: 'Ascendant Starwalker' },
      tierFlavor: { 2: 'Tamsin re-forged the soles with starlight. The motes they leave stay a little longer.', 3: 'Ascended: every step leaves a small, permanent star.' },
      pieces: [
        { slot: 'boots', id: 'starwalker_boots', noun: 'Greaves', style: 'starwalker', looks: SW_LOOK,
          t3: { stoneward:  { hp: 225, dmg: 8, acc: 9, resist: 3, mana: 7, brightPip: 3, pipSurge: 3 },
                tidecaller: { hp: 210, dmg: 8, acc: 11, resist: 4, mana: 10, brightPip: 3, pipSurge: 3 },
                emberstrike:{ hp: 195, dmg: 8, acc: 9, resist: 3, mana: 7, brightPip: 4, pipSurge: 3 } },
          desc: { base: 'Nyx walked between the stars in these, until the Orrery Sentinel took them from her and kept them. Now they leave faint star motes wherever you step, and the dark politely gets out of the way.',
                  stoneward: 'Heavy greaves of night-iron. The star motes they leave behind are very slow and very sure.',
                  tidecaller: 'Every step leaves a ripple of starlight, like walking on a calm sea at night.',
                  emberstrike: 'The star motes these leave behind are, regrettably, on fire.' } }
      ] },
    { set: 'artificer', cost: 'artificer', rarity: 'epic', crafted: true, words: AF_WORD,
      prefix: { 1: "Artificer's", 2: "Master Artificer's", 3: "Grand Artificer's" },
      tierFlavor: { 2: 'Master work: Tamsin re-cut every gear by hand and signed the inside.', 3: 'Grand work: the gears turn on their own now. Tamsin cried a little.' },
      pieces: [
        { slot: 'hat', id: 'artificer_hat', noun: 'Cap', style: 'artisan', looks: AF_LOOK,
          t3: { stoneward:  { hp: 255, dmg: 7, resist: 2, mana: 7, brightPip: 2, pipSurge: 4 },
                tidecaller: { hp: 230, dmg: 8, acc: 5, mana: 10, brightPip: 2, pipSurge: 4 },
                emberstrike:{ hp: 200, dmg: 11, acc: 2, mana: 6, brightPip: 2, pipSurge: 4 } },
          desc: { base: "Brass goggles, a leather cap and eleven tiny screwdrivers. Tamsin says the goggles are for 'seeing the pips coming'.",
                  stoneward: 'Riveted plates over thick leather. The goggles have a little wiper for dust.',
                  tidecaller: 'One lens of the goggles is a tide gauge. It is always right about the weather.',
                  emberstrike: 'Smoked-glass goggles for looking straight into a forge. Or a fireball. Mostly a fireball.' } },
        { slot: 'robe', id: 'artificer_robe', noun: 'Workcoat', style: 'artisan', looks: AF_LOOK,
          t3: { stoneward:  { hp: 375, resist: 11, dmg: 2, mana: 6, brightPip: 2, pipSurge: 4 },
                tidecaller: { hp: 340, resist: 14, dmg: 3, mana: 9, brightPip: 2, pipSurge: 4 },
                emberstrike:{ hp: 330, resist: 12, dmg: 6, acc: 1, mana: 5, brightPip: 2, pipSurge: 4 } },
          desc: { base: 'A layered coat with a tool belt, nine pouches and brass buckles. One pouch is just for snacks. Tamsin insisted.',
                  stoneward: 'The pouches are lined with slate. You could fall off the Spire in this and only your pride would bruise.',
                  tidecaller: 'Waxed against spray, with a little brass compass that always points at the nearest friend.',
                  emberstrike: 'Scorch marks on the sleeves are a feature. Tamsin calls them "proof of testing".' } },
        { slot: 'boots', id: 'artificer_boots', noun: 'Boots', style: 'artisan',
          looks: { base: ['#5a3e24', '#d8a84a', '#7fe0ff', 'glow'], stoneward: ['#4a3e2e', '#c9a24a', '#d4a25f', 'glow'],
                   tidecaller: ['#2e3e4a', '#d8b860', '#4fc3e8', 'frost'], emberstrike: ['#4a2418', '#e0a040', '#ff6b3d', 'embers'] },
          t3: { stoneward:  { hp: 255, dmg: 5, acc: 9, resist: 5, mana: 6, brightPip: 1, pipSurge: 5 },
                tidecaller: { hp: 240, dmg: 6, acc: 12, resist: 4, mana: 9, brightPip: 1, pipSurge: 5 },
                emberstrike:{ hp: 200, dmg: 8, acc: 10, resist: 3, mana: 6, brightPip: 2, pipSurge: 5 } },
          desc: { base: 'Buckled work boots with brass toe-caps and springs in the heels. You will walk into the duel circle a little taller.',
                  stoneward: 'Iron toe-caps and hobnails. You can hear a Stoneward artificer coming from three streets away.',
                  tidecaller: 'Cork soles with brass buckles. They float, which Tamsin says is "a safety feature".',
                  emberstrike: 'Heat-proof soles. Tamsin tested them by walking through a bonfire. Twice.' } },
        { slot: 'wand', id: 'artificer_wand', noun: 'Wand', style: 'forged', looks: AF_BRASS,
          t3: { stoneward:  { dmg: 15, acc: 8, hp: 95, resist: 2, mana: 6, brightPip: 2, pipSurge: 4 },
                tidecaller: { dmg: 17, acc: 9, hp: 55, mana: 9, brightPip: 2, pipSurge: 4 },
                emberstrike:{ dmg: 19, acc: 8, hp: 40, mana: 5, brightPip: 2, pipSurge: 4 } },
          desc: { base: 'Brass rings turn around a core of star crystal. Each ring clicks into place as your pips arrive.',
                  stoneward: 'Iron rings, a granite core. It ticks like a very slow, very determined clock.',
                  tidecaller: 'The crystal core is full of seawater. The rings turn with the tide.',
                  emberstrike: 'The rings spin so fast they glow. Hold it by the handle. Only the handle.' } },
        { slot: 'amulet', id: 'artificer_amulet', noun: 'Medallion', style: 'gearwork', looks: AF_BRASS,
          t3: { stoneward:  { hp: 290, dmg: 7, resist: 4, acc: 3, mana: 5, brightPip: 2, pipSurge: 4 },
                tidecaller: { hp: 255, dmg: 8, resist: 5, acc: 6, mana: 8, brightPip: 2, pipSurge: 4 },
                emberstrike:{ hp: 225, dmg: 10, resist: 4, acc: 4, mana: 5, brightPip: 3, pipSurge: 4 } },
          desc: { base: 'A brass medallion with one gear that turns on its own. It speeds up just before a lucky round.',
                  stoneward: 'A heavy iron medallion. Its gear turns once a minute, exactly, forever.',
                  tidecaller: 'The gear inside turns with the moon. Tamsin swears she did not plan that.',
                  emberstrike: 'The gear spins so fast it whistles. It is very pleased with itself.' } }
      ] }
  ];

  function sell(rarity, tier) {
    var b = gen && gen.genSell ? gen.genSell(10, rarity) : (rarity === 'legendary' ? 221 : 143);
    return Math.round(b * (TIER_SELL[tier] || 1));
  }
  function scaled(t3, tier) {
    var out = {}, sc = TIER_SCALE[tier];
    STATS.forEach(function (k) {
      if (!t3[k]) return;
      // health in steps of 5; Bright Pip / Pip Surge round down unless within 0.25 of the next point
      var f = OFF[k] ? sc.off : sc.def, x = t3[k] * f;
      var v = k === 'hp' ? Math.round(x / 5) * 5 : (k === 'brightPip' || k === 'pipSurge') ? Math.floor(x + 0.25) : Math.round(x);
      out[k] = Math.max(1, v);
    });
    return out;
  }
  // gear score, same weights as state.js gearScore / tests/data-check.js
  var SCORE_W = { hp: 1 / 8, dmg: 4, resist: 4, acc: 1.5, mana: 2, brightPip: 4, pipSurge: 4 };
  function score(st) { return Object.keys(SCORE_W).reduce(function (n, k) { return n + (st[k] || 0) * SCORE_W[k]; }, 0); }
  // Artificer T1/T2: rounding of small stats (a 2 % Bright Pip, a 1 % resist)
  // can push a scaled piece out of the contract's 90-97 % band of the
  // same-tier Starbound budget (boots: 93-103 % of Starwalker). Only then
  // its health is moved (in steps of 5) to just inside the band, never above
  // the health of the tier above. Pieces already inside keep their scaled
  // health, so health still rises T1 -> T2 -> T3.
  var SHARE_BAND = { def: [0.91, 0.96], boots: [0.94, 1.02] };
  function keepShare(af, sbT, slot, cap) {
    var band = SHARE_BAND[slot] || SHARE_BAND.def, r = score(af) / score(sbT);
    if (r >= band[0] && r <= band[1]) return af;
    var want = (r < band[0] ? band[0] : band[1]) * score(sbT), hp = (af.hp || 0) + (want - score(af)) / SCORE_W.hp;
    af.hp = Math.min(cap || Infinity, Math.max(5, (r < band[0] ? Math.ceil(hp / 5) : Math.floor(hp / 5)) * 5));
    return af;
  }
  function minStats(byS) {
    var out = {};
    STATS.forEach(function (k) {
      var v = Math.min.apply(null, SCHOOLS.map(function (s) { return byS[s][k] || 0; }));
      if (v > 0) out[k] = v;
    });
    return out;
  }
  function tierId(id, tier) { return tier === 1 ? id : id + '_t' + tier; }
  function look(row, style, tier) {
    var l = { style: style, color: row[0], color2: row[1], gem: row[2], fx: row[3], tier: tier };
    // T2+ accent colour comes from the set's own palette in the renderer (WS6); no shared accent here          // §6.3: T2+ second accent colour (glowing trim); T3 also gets the set aura (WS6 reads `tier`)
    return l;
  }

  var E = {};
  Object.keys(REAGENTS).forEach(function (id) { E[id] = REAGENTS[id]; });
  // the best-in-slot (Starbound / Starwalker) piece of each slot, for keepShare
  var BIS = {};
  SETS.forEach(function (S) { if (S.set === 'starbound') S.pieces.forEach(function (pc) { BIS[pc.slot] = pc; }); });
  SETS.forEach(function (S) {
    S.pieces.forEach(function (pc) {
      [3, 2, 1].forEach(function (tier) {          // T3 first: a lower tier never gets more health than the tier above
        var byS = {}, bis = S.set !== 'starbound' && tier < 3 && BIS[pc.slot];
        SCHOOLS.forEach(function (s) {
          byS[s] = scaled(pc.t3[s], tier);
          if (bis) keepShare(byS[s], scaled(bis.t3[s], tier), pc.slot, E[tierId(pc.id, tier + 1) + '_' + s].stats.hp);
        });
        var base = tierId(pc.id, tier), next = tier < 3 ? tierId(pc.id, tier + 1) : null;
        function make(id, school) {
          var it = {
            type: 'gear', slot: pc.slot, level: 10, rarity: S.rarity, set: S.set, tier: tier, upgradeCost: S.cost,
            name: S.prefix[tier] + (school ? ' ' + S.words[school] : '') + ' ' + pc.noun,
            stats: school ? byS[school] : minStats(byS),
            look: look(pc.looks[school || 'base'], pc.style, tier),
            desc: pc.desc[school || 'base'] + (S.tierFlavor[tier] ? ' ' + S.tierFlavor[tier] : ''),
            price: 0, sell: sell(S.rarity, tier)
          };
          if (school) it.school = school;
          if (next) it.next = school ? next + '_' + school : next;
          if (S.unique) it.unique = true;
          if (S.crafted) it.crafted = true;
          if (S.ownSchool) it.ownSchool = true;      // v2.1: drops only in the looter's school (state.js dropVariant)
          E[id] = it;
          return it;
        }
        var b = make(base, null);
        b.variants = {};
        SCHOOLS.forEach(function (s) { make(base + '_' + s, s); b.variants[s] = base + '_' + s; });
      });
    });
  });

  // ---------------------------------------------------------------- mount (rare Archon drop; WS4 wires it)
  E.mount_orrery_strider = {
    type: 'mount', name: 'Orrery Strider', rarity: 'legendary', level: 10, speed: 0.60, price: 0, sell: 560,
    mount: { kind: 'strider', coat: '#b08a3a', mane: '#7fe0ff', saddle: '#2a1d4e', trim: '#ffd76a', gem: '#bfe6ff' },
    desc: 'A brass mechanical stag that walked out of the Hollow Orrery after the Archon fell. Its antlers are a tiny working sky.'
  };

  // ---------------------------------------------------------------- v2.1: the WORLD-BOSS set ("boss set")
  // Jorge (Oct 20, 8:15 PM, docs/V2.1-BACKLOG.md §B 4b): "people that don't want the max gear are still
  // able to get good gear, just not perfect". Every world's final boss drops its OWN set: about as
  // strong as that world's dungeon T1 (gear score within +-5 %, tests/balance-sim.js --check: GEAR
  // LADDER), never as strong as the dungeon T2/T3. One tier only: no upgrades at Tamsin.
  // DUSKHERALD (Nyx, Herald of the Hollow King, L10): the T1 Starbound budget with a different mix:
  // no Bright Pip; Pip Surge, health and a little resist instead. Own school only (like the dungeon
  // set). Drops: enemies.js nyx_herald `setRolls` (each win rolls 2 gear pieces, each 10 % a
  // Duskherald piece, otherwise normal gear). Stats are per school (pre-conversion keys: dmg / acc
  // become the school's own dmg_/acc_ below, like every school piece).
  var DH_WORD = { stoneward: 'Basalt', tidecaller: 'Nighttide', emberstrike: 'Cinder' };
  var DH_LOOK = { base: ['#221a3e', '#ffd76a', '#b06cff', 'shadow'], stoneward: ['#2e2638', '#c9a24a', '#d4a25f', 'shadow'],
                  tidecaller: ['#16203e', '#bdefff', '#4fc3e8', 'shadow'], emberstrike: ['#2e1226', '#ffb46a', '#ff6b3d', 'shadow'] };
  var DUSK = [
    { slot: 'hat', id: 'duskherald_hat', noun: 'Quillcrown', style: 'feathered',
      stats: { stoneward: { hp: 205, mana: 5, dmg: 6, resist: 3, pipSurge: 2 }, tidecaller: { hp: 195, mana: 8, dmg: 6, acc: 5, resist: 1, pipSurge: 2 },
               emberstrike: { hp: 180, mana: 5, dmg: 7, acc: 4, resist: 1, pipSurge: 2 } },
      desc: { base: 'A crown of black quills that Nyx shed in the Gloamgate. They still bristle when the dark comes near.',
              stoneward: 'Each quill is tipped with basalt. They clatter like a tiny landslide when you nod.',
              tidecaller: 'The quills drip starlit water that never quite reaches your collar.',
              emberstrike: 'The quill tips smoulder. Keep your hair tied back.' } },
    { slot: 'robe', id: 'duskherald_robe', noun: 'Wingmantle', style: 'mantle',
      stats: { stoneward: { hp: 280, mana: 5, dmg: 3, resist: 9, pipSurge: 2 }, tidecaller: { hp: 260, mana: 8, dmg: 3, resist: 12, pipSurge: 2 },
               emberstrike: { hp: 250, mana: 6, dmg: 4, resist: 10, acc: 2, pipSurge: 2 } },
      desc: { base: "A mantle cut like folded black wings. When you cast, it opens a little, the way Nyx's wings did.",
              stoneward: 'The wing-folds are stiff as slate. Very little gets through them.',
              tidecaller: 'The folds ripple like night water. Spells slide off them like rain.',
              emberstrike: 'Every feather has a red edge, like a cooling coal.' } },
    { slot: 'boots', id: 'duskherald_boots', noun: 'Treads', style: 'greaves',
      stats: { stoneward: { hp: 170, mana: 5, dmg: 5, resist: 3, acc: 7, pipSurge: 3 }, tidecaller: { hp: 160, mana: 8, dmg: 5, resist: 4, acc: 8, pipSurge: 3 },
               emberstrike: { hp: 145, mana: 5, dmg: 5, resist: 3, acc: 7, pipSurge: 3 } },
      desc: { base: 'Soft-soled treads that walked the Gloamgate wall at night. Your steps make no sound at all.',
              stoneward: 'Basalt-plated, yet silent. Nobody knows how. Nyx did not leave notes.',
              tidecaller: 'You leave damp, dark footprints that fade like a tide going out.',
              emberstrike: 'Each silent step leaves one tiny ember behind.' } },
    { slot: 'wand', id: 'duskherald_wand', noun: 'Scepter', style: 'scepter',
      stats: { stoneward: { hp: 120, mana: 5, dmg: 12, resist: 1, acc: 6, pipSurge: 1 }, tidecaller: { hp: 110, mana: 7, dmg: 12, acc: 8, pipSurge: 1 },
               emberstrike: { hp: 105, mana: 5, dmg: 13, acc: 6, pipSurge: 1 } },
      desc: { base: "The Herald's black scepter, topped with an eclipse: a dark disc with a thin gold ring around it.",
              stoneward: 'The eclipse on top is a polished basalt disc. It hums very low.',
              tidecaller: 'The eclipse is a disc of still, dark water. It never spills.',
              emberstrike: 'The gold ring around the eclipse burns. Only the ring.' } },
    { slot: 'amulet', id: 'duskherald_amulet', noun: 'Sigil', style: 'medallion',
      stats: { stoneward: { hp: 220, mana: 5, dmg: 6, resist: 3, acc: 3, pipSurge: 2 }, tidecaller: { hp: 210, mana: 7, dmg: 6, resist: 5, acc: 5, pipSurge: 2 },
               emberstrike: { hp: 200, mana: 5, dmg: 7, resist: 4, acc: 3, pipSurge: 2 } },
      desc: { base: "The Hollow King's sigil, which Nyx carried as his herald. Freed of him, it is just a very good charm.",
              stoneward: 'Set in a ring of basalt. It is heavy, and it does not care.',
              tidecaller: 'The sigil is cut from dark sea-glass and cool to the touch.',
              emberstrike: 'The sigil glows red at the edges when your pips arrive.' } }
  ];
  DUSK.forEach(function (pc) {
    function make(id, school) {
      var it = {
        type: 'gear', slot: pc.slot, level: 10, rarity: 'epic', set: 'duskherald', track: 'boss', tier: 1, ownSchool: true,
        name: 'Duskherald' + (school ? ' ' + DH_WORD[school] : '') + ' ' + pc.noun,
        stats: school ? Object.assign({}, pc.stats[school]) : minStats(pc.stats),
        look: look(DH_LOOK[school || 'base'], pc.style, 1),
        desc: pc.desc[school || 'base'], price: 0, sell: sell('epic', 1)
      };
      if (school) it.school = school;
      E[id] = it;
      return it;
    }
    var b = make(pc.id, null);
    b.variants = {};
    SCHOOLS.forEach(function (s) { make(pc.id + '_' + s, s); b.variants[s] = pc.id + '_' + s; });
  });

  Object.keys(E).forEach(function (id) { E[id].id = id; I[id] = E[id]; });

  // ---------------------------------------------------------------- v2.1: the GEAR LADDER (power budget)
  // Two gear tracks per world (Jorge, Oct 20 8:15 PM): the world boss's set and the dungeon set
  // (T1 < T2 < T3). Budget = gear score (state.js gearScore) of a full own-school set of the 5 slots
  // INCLUDING its set bonuses, mean of the three schools. tests/balance-sim.js --check (GEAR LADDER)
  // measures the real items against these numbers (+-tolerance) and enforces the strength ladder
  //   world N boss set ~ world N dungeon T1 < world N dungeon T2 < T3
  //   world N+10 boss set ~ world N dungeon T3 (catch-up) < world N+10 dungeon T1
  // `built: false` rows are TARGETS for future content (Book II): no L20 items exist yet.
  // L20 numbers: the boss set = the L10 dungeon T3 budget; the L20 dungeon T1 = 5 % above it (the
  // rule "still weaker"); its T2/T3 keep the L10 tier steps (T2 = T1 x 1.18, T3 = T1 x 1.42).
  WF.data.gearLadder = {
    tolerance: 0.05,                 // a built budget may drift +-5 % from the real items
    bossVsDungeonT1: [0.95, 1.05],   // world boss set vs the same world's dungeon T1
    nextBossVsPrevT3: [0.95, 1.05],  // catch-up: next world's boss set vs this world's dungeon T3
    worlds: [
      { level: 10, built: true, boss: { set: 'duskherald', enemy: 'nyx_herald', budget: 488 },
        dungeon: { set: 'starbound', dungeon: 'hollow_orrery', budget: { 1: 498, 2: 585, 3: 707 } } },
      { level: 20, built: false, boss: { budget: 707 },
        dungeon: { budget: { 1: 742, 2: 872, 3: 1053 } } }
    ]
  };
})();

// =====================================================================
//  v2.0 M1 "Schools" (WS-A): GEAR STAT CONVERSION
//  (docs/V2.0-CONTRACT.md §2; stat keys in schools.js WF.data.schoolStatKeys)
//
//  Runs once, after every gear file has added its pieces, so one table
//  converts ALL gear (shop, hand-made drops, generated sets, legendaries,
//  boss drops, Starbound / Starwalker / Artificer T1-T3):
//
//  1. SCHOOL GEAR (`school` set: variants, school versions of sets, endgame
//     school pieces) gets SCHOOL stats: dmg -> dmg_<school>, acc ->
//     acc_<school>. They now power that school's spells only, not Lumen or
//     trained off-school spells. The amounts are kept (x SCHOOL_KEEP).
//  2. WARDED GEAR: any-school drops of a zone carry part of their resist as
//     resist against the school its enemies hit with (WARD below):
//       resist R -> resist ceil(R x WARD_UNIVERSAL) + resist_<ward> round(R x WARD_SCHOOL)
//     so the pieces you find in a zone guard you against that zone.
//  3. Shop gear (Pip Quickcoin) and Hollow-themed pieces stay universal: the
//     safe, school-neutral choice. Base items with `variants` stay universal
//     too (they only show up as a fallback).
//  Bright Pip (brightPip) and Pip Surge are unchanged: one stat each, never
//  doubled (state.js pipStats caps them).
//  Re-tune with: node tests/balance-sim.js --check, node tests/dungeon-sim.js --check
// =====================================================================
(function () {
  var I = WF.data.items, D = WF.data;
  var SCHOOL_KEEP = { dmg: 1.0, acc: 1.0 };
  var WARD_UNIVERSAL = 0.6, WARD_SCHOOL = 0.8;
  // generated drop sets (items.js SETS `id`) and single pieces -> the school they guard against
  var WARD_SETS = {
    bogwalker: 'stoneward', glowmoss: 'emberstrike', fenwarden: 'emberstrike', moonpetal: 'emberstrike',        // Mosslight: toads / imps
    thicketwalk: 'stoneward', duskthorn: 'tidecaller', wolfsong: 'emberstrike', heartoak: 'stoneward',         // Whisperwood: ghouls / wolves
    cinderwalk: 'emberstrike', gravewatch: 'stoneward', duskfire: 'emberstrike', dawnhold: 'stoneward',         // Ashen Ruins: wraiths / knights
    gloamguard: 'tidecaller', ashveil: 'emberstrike', starfall: 'tidecaller', eclipsebane: 'tidecaller'         // Gloamgate: acolytes / Vex / Nyx
  };
  var WARD_ITEMS = {
    knight_amulet: 'stoneward', thornbark_robe: 'tidecaller', elderheart_robe: 'tidecaller',                   // Thornmaw's drops guard against Thornmaw
    leg_mirelord_cloak: 'tidecaller', leg_waking_wood_mantle: 'tidecaller', leg_oathbound_warplate: 'tidecaller', leg_watch_spurs: 'tidecaller'   // boss legendaries: their boss's school
  };
  WF.data.gearConversion = { schoolKeep: SCHOOL_KEEP, wardUniversal: WARD_UNIVERSAL, wardSchool: WARD_SCHOOL, wardSets: WARD_SETS, wardItems: WARD_ITEMS };

  Object.keys(I).forEach(function (id) {
    var it = I[id];
    if (!it || it.type !== 'gear' || !it.stats || it.schoolConverted) return;
    var s = it.stats, out = {};
    if (it.school && D.schools[it.school] && D.schools[it.school].playable) {
      Object.keys(s).forEach(function (k) {
        if (SCHOOL_KEEP[k] != null) { var v = Math.round(s[k] * SCHOOL_KEEP[k]); if (v) out[k + '_' + it.school] = (out[k + '_' + it.school] || 0) + v; }
        else out[k] = s[k];
      });
    } else {
      var ward = WARD_ITEMS[id] || (it.set && WARD_SETS[it.set]) || null;
      Object.keys(s).forEach(function (k) { out[k] = s[k]; });
      if (ward && s.resist > 0) {
        out.resist = Math.ceil(s.resist * WARD_UNIVERSAL);
        out['resist_' + ward] = Math.max(1, Math.round(s.resist * WARD_SCHOOL));
      }
    }
    it.stats = out;
    it.schoolConverted = true;
  });
})();
