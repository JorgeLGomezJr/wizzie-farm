// =====================================================================
//  WIZZIE FARM — PETS (v2.0 M2, WS-B)          design: docs/design/pets.md
//
//  Everything about pets that a designer tunes lives here; the rules engine
//  is game/js/pets.js (pure logic, unit-tested by tests/pets.test.js) and the
//  economy / power targets are checked by `node tests/pet-sim.js --check`.
//
//  WF.data.pets = {
//    rarity[id]      rankCap (strongest talent rank), cards (pet cards granted),
//                    hatchFee (gold to breed into this rarity), incubate (real minutes),
//                    appraise (gold for Quillby to reveal the whole talent pool)
//    stages[]        Baby -> Teen -> Adult -> Ancient -> Epic -> Mega: cumulative pet XP,
//                    model scale; every stage after Baby teaches ONE talent (pick 1 of 2)
//    breeding        pool size, inheritance weights, mutation, rarity roll-up/down, rest
//    talents[id]     { name, stat, school?, ranks[5], natural? , desc }
//                      stat   gear stat key (hp, mana, dmg, resist, acc, brightPip, pipSurge),
//                             in GEAR units (dmg 10 = +10 %), added to WF.state.stats()
//                      school only counts for a wizard of that school ("correct stats")
//                      natural (hp only): max(rank value, natural HP x natural)  (the level-60
//                             rule: a flat floor for twinking + a level-scaled part later)
//    species[id]     { name, school, desc, look (models_pets.js), pool {talentId: weight},
//                      cards [species card, utility card, signature card] (specs; the
//                      three ranks I/II/III are generated into WF.data.cards below),
//                      starter: price (Common shop pet) }
//    eggTables[id]   { chance per kill, rarity weights } used by enemies' loot.eggs
//    snacks          snack items are ordinary items (type 'reagent', snack: xp) so they
//                    stack, sell, drop and bank like any reagent
//  }
//  Pet cards: source 'pet', level 99 (never learned by levelling), added to the
//  duel deck ON TOP of the deck item's size limit. `cineAs` borrows an existing
//  spell cinematic, `artAs` an existing card picture (new art: see the report).
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.pets = {
  version: 1,
  maxPets: 24,           // pets (and eggs) one wizard can carry
  bankPets: 40,          // pets the shared Vault can hold (all wizards together)
  incubatorSlots: 2,
  breedMinStage: 2,      // parents must be Adult or older
  starterRarity: 'common',

  rarity: {
    common:    { rankCap: 1, cards: 0, hatchFee: 300,  incubate: 30,  appraise: 100 },
    uncommon:  { rankCap: 2, cards: 0, hatchFee: 700,  incubate: 60,  appraise: 200 },
    rare:      { rankCap: 3, cards: 1, hatchFee: 2000, incubate: 120, appraise: 400 },
    epic:      { rankCap: 4, cards: 2, hatchFee: 4500, incubate: 240, appraise: 800 },
    legendary: { rankCap: 5, cards: 3, hatchFee: 7500, incubate: 360, appraise: 1500 }
  },

  // xp = total pet XP needed to REACH the stage. cardRank = rank of the pet's cards at that stage.
  stages: [
    { id: 'baby',    name: 'Hatchling',    xp: 0,    scale: 0.56, cardRank: 1 },
    { id: 'teen',    name: 'Fledgling',    xp: 300,  scale: 0.66, cardRank: 1 },
    { id: 'adult',   name: 'Grown',   xp: 1000, scale: 0.77, cardRank: 2 },
    { id: 'ancient', name: 'Elder', xp: 2400, scale: 0.86, cardRank: 2 },
    { id: 'epic',    name: 'Radiant',    xp: 4800, scale: 0.95, cardRank: 2 },
    { id: 'mega',    name: 'Starborn',    xp: 9000, scale: 1.05, cardRank: 3 }
  ],

  breeding: {
    poolSize: 8,          // hidden talent pool per pet (room to grow to 10)
    sharedWeight: 1.6,    // a talent BOTH parents carry is this much likelier to pass on (~65 %)
    mutation: 0.05,       // per pool slot: a random talent of the baby's species instead
    rollUp: 0.05,         // baby rarity = the LOWER parent's; chance to step up one rarity
    rollUpSame: 0.07,     //   ... when both parents share that rarity (pets.md 5-10 %; tuned by pet-sim)
    rollDown: 0.03,       //   chance to step down one rarity (never below Common)
    restHours: 12,        // a parent rests this long (real time) before it can breed again
    speciesFromA: 0.5     // the baby is parent A's species with this chance, else B's
  },

  // Pet XP: the EQUIPPED pet learns from every won duel; snacks feed any pet.
  duelXp: { perEnemy: 6, perLevel: 1.2, eliteMult: 2.5, bossMult: 5 },
  training: { xp: 150, cooldownMin: 20 },   // Coach Bramble's ring: free XP, once per 20 real minutes

  // Snack drops (per defeated enemy, by kind) - rolled with the duel's loot
  snackDrops: {
    mob:   [{ item: 'snack_moss_muffin', chance: 0.06 }],
    elite: [{ item: 'snack_starberry_tart', chance: 0.25 }, { item: 'snack_moss_muffin', chance: 0.3 }],
    boss:  [{ item: 'snack_glowmelon', chance: 0.3 }, { item: 'snack_comet_cake', chance: 0.06 }]
  },

  // Egg drops. Enemies opt in with loot.eggs = { table, species: [...] } (enemies*.js).
  eggTables: {
    elite:        { chance: 0.005, rarity: { common: 30, uncommon: 50, rare: 18, epic: 2 } },
    zone_boss:    { chance: 0.02,  rarity: { uncommon: 40, rare: 45, epic: 13, legendary: 2 } },
    world_boss:   { chance: 0.025, rarity: { rare: 60, epic: 32, legendary: 8 } },
    dungeon_boss: { chance: 0.03,  rarity: { rare: 60, epic: 32, legendary: 8 } },
    archon:       { chance: 0.04,  rarity: { rare: 55, epic: 35, legendary: 10 } }
  },

  // --------------------------------------------------------------- talents
  // ranks = value at rank 1..5 (rank = the pet's rarity rankCap), at wizard level >= levelRamp.full.
  // v2.0 retune (Jorge, Oct 19 9:19 PM: "at level 10 it can be 2x ... 1.2x stronger at lvl 60"):
  // a perfect pet is ~2x combat power at L1 and at L10 and fades to ~1.2x at L60. The big parts are
  // FLAT (Heart = max health, the school Dealers = damage added to every hit), so they matter hugely
  // at low level and shrink as spells / gear / health grow by x1.03 per level above L10. `ramp` talents
  // grow with the wizard's level from levelRamp.at1 of their value at L1 to the full value at L10
  // (so an L1 twink is ~2x, not 5x). The percent parts (Ward, pips) stay small: percent never fades.
  // tests/pet-sim.js --check measures L1 / L10 and projects L60.
  talents: {
    heart:        { name: 'Glade Heart',     stat: 'hp',        ramp: true, ranks: [180, 360, 540, 720, 900], desc: 'More max health (grows with your level up to 10).' },
    manawell:     { name: 'Mana Well',       stat: 'mana',      ranks: [3, 5, 7, 9, 11], desc: 'More max mana.' },
    pip_giver:    { name: 'Bright Spark',    stat: 'brightPip', ranks: [1, 1, 1, 2, 2], desc: 'Chance each new pip is a Bright Pip.' },
    surger:       { name: 'Pip Surger',      stat: 'pipSurge',  ranks: [1, 1, 1, 1, 1], desc: 'Chance to gain 2 pips in one round.' },
    sharp_eye:    { name: 'Sharp Eye',       stat: 'acc',       ranks: [1, 2, 3, 4, 5], desc: 'Better accuracy for every spell.' },
    gloomguard:   { name: 'Gloomguard',      stat: 'resist',    ranks: [1, 2, 3, 3, 4], desc: 'Resists the Hollow Court a little, whatever your school.' },
    stone_dealer: { name: 'Stone-Dealer',    stat: 'flatDmg', ramp: true, school: 'stoneward',   ranks: [20, 40, 60, 80, 100], desc: 'Adds damage to every hit, for a Stoneward wizard (grows with your level up to 10).' },
    tide_dealer:  { name: 'Tide-Dealer',     stat: 'flatDmg', ramp: true, school: 'tidecaller',  ranks: [21, 42, 63, 84, 105], desc: 'Adds damage to every hit, for a Tidecaller wizard (grows with your level up to 10).' },
    ember_dealer: { name: 'Ember-Dealer',    stat: 'flatDmg', ramp: true, school: 'emberstrike', ranks: [30, 60, 90, 120, 150], desc: 'Adds damage to every hit, for an Emberstrike wizard (grows with your level up to 10).' },
    stone_ward:   { name: 'Stonehide',       stat: 'resist', school: 'stoneward',   ranks: [1, 1, 1, 2, 2], desc: 'More resistance, for a Stoneward wizard.' },
    tide_ward:    { name: 'Tideguard',       stat: 'resist', school: 'tidecaller',  ranks: [1, 1, 1, 2, 2], desc: 'More resistance, for a Tidecaller wizard.' },
    ember_ward:   { name: 'Emberguard',      stat: 'resist', school: 'emberstrike', ranks: [1, 1, 1, 2, 2], desc: 'More resistance, for an Emberstrike wizard.' }
  },
  // ramp talents: at1 = share of the value at wizard level 1, full = the level where the full value is reached
  // (a FIXED anchor like progression.levelScaling.from: never move it when the level cap goes up)
  levelRamp: { at1: 0.40, full: 10 },
  // what a wizard of each school wants on a "perfect" pet (pet-sim, the Stat Board)
  wanted: {
    stoneward:   ['heart', 'stone_dealer', 'stone_ward', 'pip_giver', 'surger'],
    tidecaller:  ['heart', 'tide_dealer', 'tide_ward', 'pip_giver', 'surger'],
    emberstrike: ['heart', 'ember_dealer', 'ember_ward', 'pip_giver', 'surger']
  },

  // --------------------------------------------------------------- species
  // look: models_pets.js body plan. body 'pup' | 'kit' | 'hopper' | 'fawn' | 'moth' | 'drake' | 'owl' | 'mote'
  // card spec: { name, type, pips, acc, min/max | value | dot | hot, affects, drain, cineAs, artAs } at RANK III;
  // ranks I / II are generated at x0.75 / x0.87 (values of charms x0.8 / x0.9).
  species: {
    mossling: {
      name: 'Mossling', school: 'stoneward', starter: 150,
      desc: 'A pocket-sized moss bunny. It naps in boots and wakes up covered in clover.',
      look: { body: 'hopper', fur: '#7fae58', belly: '#e8e2b8', accent: '#4f7a35', eyes: '#3a2a1a', glow: '#b8ff8a', ears: 'leaf', tail: 'puff' },
      pool: { stone_dealer: 4, stone_ward: 4, heart: 3, gloomguard: 3, manawell: 2, sharp_eye: 2, tide_ward: 1, pip_giver: 1, surger: 1, ember_ward: 1 },
      cards: [
        { name: 'Pebble Toss', type: 'damage', pips: 1, acc: 92, min: 105, max: 135, cineAs: 'pebble_golem', artAs: 'pebble_strike' },
        { name: 'Moss Cushion', type: 'absorb', pips: 1, acc: 100, value: 220, artAs: 'bulwark' },
        { name: 'Mossling Stampede', type: 'damage', pips: 3, acc: 92, min: 390, max: 445, cineAs: 'stone_boar', artAs: 'mudslide', signature: true }
      ]
    },
    puddlepup: {
      name: 'Puddlepup', school: 'tidecaller', starter: 150,
      desc: 'A puppy made mostly of rainwater and enthusiasm. Shakes itself dry on you, every time.',
      look: { body: 'pup', fur: '#5fb6e0', belly: '#d8f2ff', accent: '#2f7aa8', eyes: '#1a2a3a', glow: '#9fe8ff', ears: 'floppy', tail: 'wave' },
      pool: { tide_dealer: 4, tide_ward: 4, heart: 3, manawell: 3, sharp_eye: 2, gloomguard: 2, surger: 1, pip_giver: 1, stone_ward: 1, ember_dealer: 1 },
      cards: [
        { name: 'Splash Nip', type: 'damage', pips: 1, acc: 90, min: 100, max: 130, cineAs: 'water_sprite', artAs: 'ripple' },
        { name: 'Puddle Mend', type: 'heal', pips: 1, acc: 100, value: 230, artAs: 'soothing_mist' },
        { name: 'Puddlepup Torrent', type: 'damage', pips: 3, acc: 90, min: 290, max: 335, drain: 0.35, cineAs: 'wave_serpent', artAs: 'wave_serpent', signature: true }
      ]
    },
    cinderkit: {
      name: 'Cinderkit', school: 'emberstrike', starter: 150,
      desc: 'A kitten with a tail like a birthday candle. Do not let it near the curtains.',
      look: { body: 'kit', fur: '#ff8a4a', belly: '#ffe2b8', accent: '#c4441e', eyes: '#2a1a0a', glow: '#ffcf6a', ears: 'pointy', tail: 'flame' },
      pool: { ember_dealer: 4, ember_ward: 3, sharp_eye: 3, heart: 2, surger: 2, pip_giver: 2, gloomguard: 2, manawell: 1, stone_dealer: 1, tide_ward: 1 },
      cards: [
        { name: 'Ember Swat', type: 'damage', pips: 1, acc: 86, min: 105, max: 145, cineAs: 'spark_newt', artAs: 'spark_bolt' },
        { name: 'Kindle', type: 'blade', pips: 0, acc: 100, value: 24, affects: 'emberstrike', artAs: 'flame_blade' },
        { name: 'Cinderkit Pounce', type: 'dot', pips: 3, acc: 86, min: 200, max: 235, dot: { amt: 78, rounds: 3 }, cineAs: 'blaze_fox', artAs: 'wildfire', signature: true }
      ]
    },
    glowmoth: {
      name: 'Glowmoth', school: 'lumen', starter: 150,
      desc: 'A moth that carries its own lantern. The Lumen Order counts them every spring.',
      look: { body: 'moth', fur: '#fff0b8', belly: '#ffe08a', accent: '#c9a2ff', eyes: '#2a2a4a', glow: '#ffe9a0', ears: 'feelers', tail: 'none' },
      pool: { pip_giver: 4, surger: 4, sharp_eye: 3, manawell: 3, heart: 2, gloomguard: 3, stone_ward: 1, tide_ward: 1, ember_ward: 1 },
      cards: [
        { name: 'Glimmer', type: 'damage', pips: 1, acc: 95, min: 90, max: 120, cineAs: 'ember_moth', artAs: 'fire_sprite' },
        { name: 'Moth-Light Ward', type: 'shield', pips: 0, acc: 100, value: 30, affects: 'any', artAs: 'lumen_ward' },
        { name: 'Glowmoth Dawn', type: 'aoe', pips: 3, acc: 95, min: 200, max: 235, cineAs: 'sunburst', artAs: 'sunburst', signature: true }
      ]
    },
    bogglet: {
      name: 'Bogglet', school: 'tidecaller',
      desc: 'A round little bog-toad freed from Grubnak\'s mire. Its croak sounds like a hiccup.',
      look: { body: 'hopper', fur: '#6f9a58', belly: '#e0d89a', accent: '#3f6a3a', eyes: '#ffd23f', glow: '#bfff7a', ears: 'none', tail: 'none', toad: true },
      pool: { heart: 4, tide_dealer: 3, gloomguard: 3, manawell: 3, surger: 2, tide_ward: 2, stone_ward: 2, sharp_eye: 1, pip_giver: 1 },
      cards: [
        { name: 'Bog Burp', type: 'dot', pips: 1, acc: 88, min: 60, max: 80, dot: { amt: 45, rounds: 3 }, cineAs: 'bog_spit', artAs: 'bog_spit' },
        { name: 'Murk Trap', type: 'trap', pips: 0, acc: 100, value: 25, affects: 'any', artAs: 'riptide_trap' },
        { name: 'Bogglet Belly-Flop', type: 'damage', pips: 3, acc: 90, min: 350, max: 400, cineAs: 'bog_belch', artAs: 'undertow', signature: true }
      ]
    },
    thornfawn: {
      name: 'Thornfawn', school: 'stoneward',
      desc: 'A fawn with rose-thorn antlers that bloom when it is happy. Whisperwood grew it back after Thornmaw.',
      look: { body: 'fawn', fur: '#c4905a', belly: '#f4e3c0', accent: '#5a8a3a', eyes: '#2a1a0a', glow: '#ffb3d0', ears: 'pointy', tail: 'puff', antlers: true },
      pool: { heart: 4, stone_ward: 3, ember_ward: 3, pip_giver: 3, stone_dealer: 2, gloomguard: 2, tide_ward: 2, manawell: 1, sharp_eye: 1 },
      cards: [
        { name: 'Bramble Kick', type: 'damage', pips: 1, acc: 92, min: 100, max: 130, cineAs: 'thorn_lash', artAs: 'thorn_lash' },
        { name: 'Thicket Guard', type: 'shield', pips: 0, acc: 100, value: 35, affects: 'any', artAs: 'stone_skin' },
        { name: 'Thornfawn Charge', type: 'damage', pips: 3, acc: 92, min: 360, max: 410, cineAs: 'quake_ram', artAs: 'golem_fist', signature: true }
      ]
    },
    ashwing: {
      name: 'Ashwing', school: 'emberstrike',
      desc: 'A pocket drake hatched from a cooled cinder of the Ashen Ruins. Sneezes sparks.',
      look: { body: 'drake', fur: '#5a4a52', belly: '#ffb36a', accent: '#ff6b3d', eyes: '#ffd23a', glow: '#ff9a4a', ears: 'horns', tail: 'spade' },
      pool: { ember_dealer: 4, surger: 3, pip_giver: 3, ember_ward: 2, heart: 2, sharp_eye: 2, gloomguard: 1, stone_dealer: 1, tide_dealer: 1 },
      cards: [
        { name: 'Ash Puff', type: 'damage', pips: 1, acc: 86, min: 110, max: 150, cineAs: 'fireball', artAs: 'fireball' },
        { name: 'Smolder Blade', type: 'blade', pips: 0, acc: 100, value: 28, affects: 'emberstrike', artAs: 'ember_ward' },
        { name: 'Ashwing Dive', type: 'damage', pips: 3, acc: 86, min: 370, max: 440, cineAs: 'skyrend_drake', artAs: 'thunder_drake', signature: true }
      ]
    },
    duskmote: {
      name: 'Duskmote', school: 'lumen',
      desc: 'A spark of starlight that the Nyx Herald held captive. Freed, it decided to follow you home.',
      look: { body: 'mote', fur: '#b8a8ff', belly: '#fff6ff', accent: '#6a5ad8', eyes: '#2a1a4a', glow: '#d8c8ff', ears: 'none', tail: 'wisp' },
      pool: { surger: 4, pip_giver: 4, heart: 3, sharp_eye: 2, manawell: 2, gloomguard: 2, tide_dealer: 1, stone_dealer: 1, ember_dealer: 1 },
      cards: [
        { name: 'Mote Spark', type: 'damage', pips: 1, acc: 95, min: 95, max: 125, artAs: 'lumen_blade' },
        { name: 'Starlit Mend', type: 'hot', pips: 1, acc: 100, value: 120, hot: { amt: 70, rounds: 3 }, artAs: 'lumen_mend' },
        { name: 'Duskmote Nova', type: 'aoe', pips: 3, acc: 95, min: 205, max: 240, cineAs: 'moon_tide', artAs: 'moon_tide', signature: true }
      ]
    },
    orrery_owlet: {
      name: 'Orrery Owlet', school: 'lumen',
      desc: 'A brass owlet that fell out of the Hollow Orrery\'s gears and kept ticking. Hoots on the hour.',
      look: { body: 'owl', fur: '#c99a3e', belly: '#f4e0b0', accent: '#6a4a8a', eyes: '#7fe8ff', glow: '#ffd76a', ears: 'tufts', tail: 'none', brass: true },
      pool: { pip_giver: 3, surger: 3, heart: 3, sharp_eye: 2, gloomguard: 2, stone_dealer: 1, tide_dealer: 1, ember_dealer: 1, stone_ward: 1, tide_ward: 1, ember_ward: 1 },
      cards: [
        { name: 'Brass Peck', type: 'damage', pips: 1, acc: 94, min: 105, max: 135, cineAs: 'gale_hawk', artAs: 'storm_hawk' },
        { name: 'Clockwork Blade', type: 'blade', pips: 0, acc: 100, value: 20, affects: 'any', artAs: 'granite_blade' },
        { name: 'Owlet Starfall', type: 'aoe', pips: 3, acc: 94, min: 215, max: 250, cineAs: 'sunburst', artAs: 'titans_wrath', signature: true }
      ]
    }
  }
};

// ---------------------------------------------------------------- snacks
// Ordinary items (type 'reagent' + snack: xp): they stack, sell, bank and drop like reagents.
(function (D) {
  'use strict';
  D.items = D.items || {};
  var SN = {
    snack_moss_muffin:    { type: 'reagent', name: 'Moss Muffin',     color: '#a8d878', price: 30,  sell: 6,   snack: 40,  desc: 'A crumbly treat. Pets love it. (+40 pet XP)' },
    snack_starberry_tart: { type: 'reagent', name: 'Starberry Tart',  color: '#ff8ab8', price: 90,  sell: 18,  snack: 110, desc: 'Sticky, sweet and faintly glowing. (+110 pet XP)' },
    snack_glowmelon:      { type: 'reagent', name: 'Glowmelon Slice', color: '#9fffc8', price: 230, sell: 45,  snack: 260, desc: 'Hums when you bite it. (+260 pet XP)' },
    snack_comet_cake:     { type: 'reagent', name: 'Comet Cake',      color: '#c8b8ff', sell: 120, snack: 650, desc: 'Baked in a falling star. Only bosses seem to carry them. (+650 pet XP)' }
  };
  Object.keys(SN).forEach(function (id) { SN[id].id = id; D.items[id] = SN[id]; });

  // ---------------------------------------------------------- pet cards
  // Three ranks per card: <id> (I), <id>_2 (II), <id>_3 (III). Pet stage picks the rank.
  D.cards = D.cards || {};
  var PD = D.pets, RANK = [0.75, 0.87, 1], CHARM = [0.8, 0.9, 1], ROMAN = ['I', 'II', 'III'];
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  Object.keys(PD.species).forEach(function (sid) {
    var sp = PD.species[sid];
    sp.id = sid;
    sp.cardIds = [];
    (sp.cards || []).forEach(function (spec, ci) {
      var base = 'pet_' + slug(spec.name), ids = [];
      for (var r = 0; r < 3; r++) {
        var id = r ? base + '_' + (r + 1) : base, m = RANK[r], cm = CHARM[r];
        var c = { id: id, name: spec.name + (r ? ' ' + ROMAN[r] : ''), school: sp.school, level: 99, source: 'pet', pet: sid, petRank: r + 1, petSlot: ci,
          pips: spec.pips, acc: spec.acc, type: spec.type, copies: 1 };
        if (spec.min != null) { c.min = Math.round(spec.min * m); c.max = Math.round(spec.max * m); }
        if (spec.value != null) c.value = Math.round(spec.value * (['blade', 'trap', 'shield', 'weakness'].indexOf(spec.type) >= 0 ? cm : m));
        if (spec.dot) c.dot = { amt: Math.round(spec.dot.amt * m), rounds: spec.dot.rounds };
        if (spec.hot) c.hot = { amt: Math.round(spec.hot.amt * m), rounds: spec.hot.rounds };
        if (spec.affects) c.affects = spec.affects;
        if (spec.drain) c.drain = spec.drain;
        if (spec.cineAs) c.cineAs = spec.cineAs;
        if (spec.artAs) c.artAs = spec.artAs;
        if (spec.signature) c.signature = true;
        D.cards[id] = c;
        ids.push(id);
      }
      sp.cardIds.push(ids);
    });
  });
  // card flavor text (Spellbook / tooltips) when the lore file is loaded
  if (D.lore) {
    D.lore.cardFlavor = D.lore.cardFlavor || {};
    Object.keys(D.cards).forEach(function (id) {
      var c = D.cards[id];
      if (c.source === 'pet' && !D.lore.cardFlavor[id]) D.lore.cardFlavor[id] = 'A pet card: your ' + PD.species[c.pet].name + ' casts it beside you.' + (c.signature ? ' Signature spell.' : '');
    });
  }
})(WF.data);
