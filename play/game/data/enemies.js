// =====================================================================
//  WIZZIE FARM — ENEMIES (the Hollow Court)
//
//  Schema: docs/ARCHITECTURE.md -> enemies.js. Numbers are tuned by
//  tests/balance-sim.js (run: node tests/balance-sim.js) — see
//  docs/design/combat-and-progression.md for targets and results.
//
//  Fields:
//    hp            health
//    deck          card ids from cards.js (repeat an id = picked more often)
//    ai            'basic' | 'healer' | 'buffer' | 'boss'  (combat.js)
//    dmg / resist  outgoing bonus / incoming reduction (0.1 = 10%)
//    xp            optional override (default progression.mobXp(level),
//                  x bossMult for bosses)
//    loot.gold     [min, max]
//    loot.drops    reagents / potions  { item, chance }
//    loot.tc       spell scrolls (TCs) { card, chance }  (single-use spells)
//    loot.gear     gear                { item, chance }  (base items with
//                  `variants` are swapped by the engine for the player's school)
//    affinity      { schoolId: f }  every hit of that school x (1 - f):
//                  f > 0 resists (0.2 = -20%), f < 0 weak (-0.25 = +25%)
//    brightChance  chance each new pip is bright (default progression.
//                  brightPipChance(level); bosses 0.3). Enemy spells are all
//                  Hollow, so a bright pip pays 2 for any of them.
//    phases        bosses: [{ at: 0.5, say, cast }] -> at 50% health the boss
//                  says the line and casts `cast` for free (combat.js)
//
//  AFFINITY MAP (each school gets good and bad stretches):
//    Mosslight   : Rot Toad + Grubnak weak to Emberstrike, resist Tidecaller;
//                  Gloom Imp weak to Stoneward, resists Emberstrike
//    Whisperwood : Hollow Wolf weak to Stoneward; Bramble Ghoul, Thorn Sprout,
//                  Thornmaw weak to Emberstrike, resist Stoneward
//    Ashen Ruins : Ash Wraith weak to Tidecaller, resists Emberstrike; Bone
//                  Knight weak to Tidecaller, resists Stoneward; Acolyte weak
//                  to Stoneward; Captain Vex weak to Tidecaller; Nyx neutral
//
//  LOOT: normal mobs carry three Spell Scrolls (TCs) from their level band
//  (one per school, 8-10% each; the engine re-rolls a scroll of the
//  player's own school). Bosses: 30% per TC, signature gear 45% (school variants), a
//  rare version 10%.
//  v1.1 GEAR LOOT (items.js WF.data.lootRules / lootTables):
//    loot.table      loot table id (mosslight | whisperwood | ashen | gloam);
//                    every enemy rolls one rarity-weighted gear piece from it
//                    (mob 30%, elite 75%, boss 100% with rare+ guaranteed)
//    loot.gearChance optional override (thorn_sprout: 0 = minion, no gear)
//    loot.gear       hand-placed extra drops (boss signature items), as before
//    loot.legendary  boss-unique legendary pool for legendary rarity rolls
//    loot.mounts     rare mount drops [{ item, chance }]
//  ELITES (`elite: true`, `base: <normal enemy id>`): tougher named variants
//  in their own camps (long respawn). Gold name tag, better loot; a kill also
//  counts for quests that ask for the `base` enemy. Stat rule of thumb:
//  fight as small bosses (ai boss, bright 0.3) with one minion; xp 2.5x, gold 2.5x.
//
//  ENEMY POWER CURVE (normal mobs), level L:
//    hp  ~= 1.05 * (260 + 40 * (L - 1))  (L1 275 ... L9 ~640; healers/armored a bit less)
//          (the x1.05 pays for bright pips, which make player turns stronger)
//    dmg ~= -0.40 + 0.04 * (L - 1)  (+ bigger Hollow spells in the deck as L rises)
//  The player gains exactly 1 pip per round, so player damage per round
//  grows only through better damage-per-pip spells, blades and gear. That
//  is why enemy HP grows slowly. To add level 11+ enemies, continue these
//  curves (see docs/design/combat-and-progression.md, "Extend to level 20").
//
//  BOSSES: the 'boss' AI casts ONLY its highest-pip attack plus 0-pip
//  charms (blades/traps/shields) while charging; the other attacks in a
//  boss deck are a fallback for when it gets impatient. So a boss's
//  threat = (biggest spell x stacked charms) every (pips of that spell)
//  rounds (bright pips at 0.3 make that ~25% sooner). Rule: biggest
//  fully-buffed hit <= 65% of an at-level Emberstrike's max HP (checked by
//  the balance sim). Enemy burns snapshot their blades/traps too, so keep
//  boss DoT `amt` modest (Rot Bloom 55, Rending Slash 55, Quill Storm 60).
//
//  BOSS HP vs ONE-SHOTS: Vex (1200) and Nyx (1400) open the duel behind an
//  absorb ward (phase `at: 1`) and Nyx keeps Umbral Veil up, so a single
//  blade + nuke rarely ends it; blade + trap + nuke (or two big hits) does.
//  Normal mobs stay one-shot material for a bladed Emberstrike.
//
//  BOSS GROUPS (zones.js `groups`) — what the balance sim is tuned for:
//    Grubnak     : ['grubnak']                                   (solo)
//    Thornmaw    : ['thorn_sprout', 'thornmaw', 'thorn_sprout']
//    Captain Vex : ['hollow_acolyte', 'captain_vex']
//    Nyx         : ['hollow_acolyte', 'nyx_herald']   <- ONE acolyte.
//                  With two acolytes the final boss is ~1-8% winnable.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.enemies = {
  // ============================ MOSSLIGHT PATH (L1-3) ============================
  hollow_sprite: {
    name: 'Hollow Sprite', level: 1, school: 'hollow', hp: 275,
    model: 'sprite', color: '#a879ff', scale: 0.9,
    deck: ['shadow_nip', 'shadow_nip', 'shadow_nip', 'dark_blade'],
    ai: 'basic', dmg: -0.40, resist: 0.0, boss: false,
    intro: 'Hee hee! Your light looks tasty!',
    loot: {
      gold: [5, 10],
      drops: [{ item: 'moonmoss', chance: 0.5 }, { item: 'minor_health', chance: 0.04 }],
      tc:    [{ card: 'pebble_strike', chance: 0.08 }, { card: 'ripple', chance: 0.08 }, { card: 'spark_bolt', chance: 0.08 }],
      table: 'mosslight', gear: []
    }
  },

  rot_toad: {
    name: 'Rot Toad', level: 2, school: 'stoneward', hp: 305,
    model: 'toad', color: '#6f9a3a', scale: 1.0,
    deck: ['shadow_nip', 'shadow_nip', 'bog_spit', 'bog_spit', 'hex_trap'],
    ai: 'basic', dmg: -0.32, resist: 0.0, boss: false,
    affinity: { emberstrike: -0.25, tidecaller: 0.15 },
    intro: 'Croooak... CURSE you... croak.',
    loot: {
      gold: [7, 13],
      drops: [{ item: 'toad_slime', chance: 0.5 }, { item: 'moonmoss', chance: 0.35 }, { item: 'minor_health', chance: 0.04 }],
      tc:    [{ card: 'stone_skin', chance: 0.08 }, { card: 'soothing_mist', chance: 0.08 }, { card: 'fire_sprite', chance: 0.08 }],
      table: 'mosslight', gear: []
    }
  },

  gloom_imp: {
    name: 'Gloom Imp', level: 3, school: 'emberstrike', hp: 515,
    model: 'imp', color: '#c0485a', scale: 1.0,
    deck: ['shadow_nip', 'shadow_nip', 'gloom_bolt', 'gloom_bolt', 'dark_blade', 'hex_trap'],
    ai: 'buffer', dmg: -0.28, resist: 0.0, boss: false,
    affinity: { stoneward: -0.20, emberstrike: 0.20 },
    intro: "The Bog King says you're not allowed here! Nyeh!",
    loot: {
      gold: [10, 17],
      drops: [{ item: 'imp_horn', chance: 0.5 }, { item: 'moonmoss', chance: 0.2 }, { item: 'mana_potion', chance: 0.05 }],
      tc:    [{ card: 'mudslide', chance: 0.09 }, { card: 'undertow', chance: 0.09 }, { card: 'fireball', chance: 0.09 }],
      table: 'mosslight', gear: []
    }
  },

  grubnak: {
    name: 'Grubnak the Bog King', level: 3, school: 'tidecaller', hp: 1000,
    model: 'bogking', color: '#5f8a2e', scale: 1.0,
    deck: ['bog_belch', 'bog_belch', 'bog_belch', 'bog_spit', 'bog_spit', 'shadow_nip', 'royal_croak'],
    ai: 'boss', dmg: 0.12, resist: 0.0, boss: true,   // v2.1 A5: 0.24 -> 0.12 (finite decks: random hands from deeper decks, see CHANGELOG 2.1.0)
    affinity: { emberstrike: -0.10 },
    brightChance: 0.3,
    phases: [{ at: 0.5, say: 'GRUBNAK NOT LOSE! The feather says so!', cast: 'royal_croak' }],
    intro: 'GRUBNAK IS KING! The feather says so! BOW, little wizard!',
    loot: {
      gold: [80, 110],
      drops: [{ item: 'toad_slime', chance: 1.0 }, { item: 'imp_horn', chance: 0.6 }, { item: 'minor_health', chance: 0.5 }],
      tc:    [{ card: 'mudslide', chance: 0.30 }, { card: 'undertow', chance: 0.30 }, { card: 'fireball', chance: 0.30 }],
      table: 'mosslight',
      gear:  [{ item: 'bogking_crown', chance: 0.45 }, { item: 'gilded_bog_crown', chance: 0.10 }, { item: 'mossy_charm', chance: 0.25 }],
      legendary: ['leg_golden_feather_crown', 'leg_bog_throne_sceptre', 'leg_mirelord_cloak'],
      mounts: [{ item: 'mount_mossback', chance: 0.05 }]
    }
  },

  // ============================ WHISPERWOOD (L4-6) ============================
  hollow_wolf: {
    name: 'Hollow Wolf', level: 4, school: 'emberstrike', hp: 470,
    model: 'wolf', color: '#5a5470', scale: 1.0,
    deck: ['shadow_nip', 'shadow_nip', 'gloom_bolt', 'gloom_bolt', 'gloom_bolt', 'dark_blade'],
    ai: 'basic', dmg: -0.20, resist: 0.0, boss: false,
    affinity: { stoneward: -0.20 },
    intro: '*a howl that makes the shadows lean closer*',
    loot: {
      gold: [14, 22],
      drops: [{ item: 'shadow_fang', chance: 0.55 }, { item: 'wisp_essence', chance: 0.10 }, { item: 'minor_health', chance: 0.05 }],
      tc:    [{ card: 'mudslide', chance: 0.09 }, { card: 'wellspring', chance: 0.09 }, { card: 'fireball', chance: 0.09 }],
      table: 'whisperwood', gear: []
    }
  },

  bramble_ghoul: {
    name: 'Bramble Ghoul', level: 5, school: 'stoneward', hp: 555,
    model: 'ghoul', color: '#6b7a4a', scale: 1.1,
    deck: ['gloom_bolt', 'gloom_bolt', 'gloom_bolt', 'shadow_nip', 'bog_spit', 'sap_weakness', 'shadow_shield'],
    ai: 'basic', dmg: -0.14, resist: 0.05, boss: false,
    affinity: { emberstrike: -0.25, stoneward: 0.20 },
    intro: 'Hug... huuug... grey forever...',
    loot: {
      gold: [18, 28],
      drops: [{ item: 'wisp_essence', chance: 0.5 }, { item: 'bark_heart', chance: 0.25 }, { item: 'minor_health', chance: 0.05 }],
      tc:    [{ card: 'golem_fist', chance: 0.09 }, { card: 'wave_serpent', chance: 0.09 }, { card: 'storm_hawk', chance: 0.09 }],
      table: 'whisperwood', gear: []
    }
  },

  thorn_sprout: {
    name: 'Thorn Sprout', level: 5, school: 'stoneward', hp: 120,
    model: 'sprout', color: '#7fae4b', scale: 0.8,
    deck: ['shadow_nip', 'shadow_nip', 'thorn_lash', 'bog_spit'],
    ai: 'basic', dmg: -0.25, resist: 0.0, boss: false,
    affinity: { emberstrike: -0.25 },
    xp: 20,
    intro: 'Sprout! Sprout sprout!',
    loot: {
      gold: [8, 14],
      drops: [{ item: 'bark_heart', chance: 0.4 }, { item: 'wisp_essence', chance: 0.2 }],
      tc:    [],
      gearChance: 0,      // minion: no gear (it is summoned with Thornmaw)
      gear:  []
    }
  },

  thornmaw: {
    name: 'Thornmaw the Rotted Oak', level: 6, school: 'tidecaller', hp: 820,
    model: 'oak', color: '#5a4630', scale: 1.0,
    deck: ['rot_bloom', 'rot_bloom', 'rot_bloom', 'thorn_lash', 'thorn_lash', 'root_snare', 'dark_blade', 'hex_trap'],
    ai: 'boss', dmg: 0.12, resist: 0.0, boss: true,   // v2.1 A5: 0.22 -> 0.12 (finite decks)
    affinity: { emberstrike: 0.10, stoneward: 0.05 },   // v1.1: the hollowed Heartoak now shrugs off fire (was weak; Ember won 95%+ with v1.1 gear)
    brightChance: 0.3,
    phases: [{ at: 0.5, say: 'THE HEARTWOOD... HARDENS...', cast: 'heartwood_bark' }],
    intro: 'THE FOREST... SLEEPS... FOREVER NOW...',
    loot: {
      gold: [150, 200],
      drops: [{ item: 'bark_heart', chance: 1.0 }, { item: 'wisp_essence', chance: 0.6 }, { item: 'health_potion', chance: 0.5 }],
      tc:    [{ card: 'golem_fist', chance: 0.30 }, { card: 'wave_serpent', chance: 0.30 }, { card: 'storm_hawk', chance: 0.30 }],
      table: 'whisperwood',
      gear:  [{ item: 'thornbark_robe', chance: 0.45 }, { item: 'elderheart_robe', chance: 0.10 }, { item: 'heartwood_wand', chance: 0.30 }],
      legendary: ['leg_briar_crown', 'leg_waking_wood_mantle', 'leg_first_oak_bough'],
      mounts: [{ item: 'mount_thornstag', chance: 0.05 }]
    }
  },

  // ============================ ASHEN RUINS (L6-10) ============================
  ash_wraith: {
    name: 'Ash Wraith', level: 7, school: 'emberstrike', hp: 640,
    model: 'wraith', color: '#ff8a3d', scale: 1.1,
    deck: ['gloom_bolt', 'gloom_bolt', 'dread_wave', 'dread_wave', 'shadow_nip', 'hex_trap', 'sap_weakness'],
    ai: 'buffer', dmg: -0.12, resist: 0.0, boss: false,
    affinity: { tidecaller: -0.25, emberstrike: 0.25 },
    intro: 'It burns... it still burns...',
    loot: {
      gold: [20, 30],
      drops: [{ item: 'ember_cinder', chance: 0.5 }, { item: 'hollow_ash', chance: 0.15 }, { item: 'health_potion', chance: 0.04 }],
      tc:    [{ card: 'earthen_mend', chance: 0.10 }, { card: 'healing_rain', chance: 0.10 }, { card: 'wildfire', chance: 0.10 }],
      table: 'ashen', gear: []
    }
  },

  bone_knight: {
    name: 'Bone Knight', level: 8, school: 'stoneward', hp: 600,
    model: 'knight', color: '#e8e2cf', scale: 1.15,
    deck: ['gloom_bolt', 'gloom_bolt', 'dread_wave', 'dread_wave', 'bone_crush', 'shadow_shield', 'dark_blade'],
    ai: 'basic', dmg: -0.10, resist: 0.10, boss: false,
    affinity: { tidecaller: -0.20, stoneward: 0.20 },
    intro: 'The Watch... stands... for the Hollow.',
    loot: {
      gold: [22, 34],
      drops: [{ item: 'bone_shard', chance: 0.55 }, { item: 'ember_cinder', chance: 0.4 }, { item: 'health_potion', chance: 0.04 }],
      tc:    [{ card: 'quake', chance: 0.10 }, { card: 'maelstrom', chance: 0.10 }, { card: 'firestorm', chance: 0.10 }],
      table: 'ashen', gear: []
    }
  },

  hollow_acolyte: {
    name: 'Hollow Acolyte', level: 9, school: 'emberstrike', hp: 495,
    model: 'acolyte', color: '#7a5aa8', scale: 1.0,
    deck: ['gloom_bolt', 'gloom_bolt', 'hollow_drain', 'hollow_drain', 'dark_mend', 'sap_weakness'],
    ai: 'healer', dmg: -0.08, resist: 0.05, boss: false,
    affinity: { stoneward: -0.20 },
    intro: 'The Herald speaks, and the gate shall open!',
    loot: {
      gold: [24, 36],
      drops: [{ item: 'hollow_ash', chance: 0.5 }, { item: 'mana_potion', chance: 0.10 }, { item: 'health_potion', chance: 0.05 }],
      tc:    [{ card: 'fortify', chance: 0.10 }, { card: 'moon_tide', chance: 0.10 }, { card: 'thunder_drake', chance: 0.10 }],
      table: 'gloam', gear: []
    }
  },

  captain_vex: {
    name: 'Captain Vex', level: 9, school: 'tidecaller', hp: 1300,
    model: 'captain', color: '#8a8fa8', scale: 1.05,
    deck: ['captains_cleave', 'captains_cleave', 'rending_slash', 'rending_slash', 'rending_slash', 'dread_wave', 'gloom_bolt', 'war_cry', 'iron_guard'],
    ai: 'boss', dmg: -0.05, resist: 0.08, boss: true,
    affinity: { emberstrike: -0.15, stoneward: -0.10 },   // v2.0 review F8: a Tidecaller boss is weak to Emberstrike (the natural matchup), not to Tide
    brightChance: 0.3,
    phases: [
      { at: 1, say: 'Iron Guard, up. Let us see what Aldric taught you.', cast: 'iron_guard' },
      { at: 0.5, say: 'Enough games. For the Hollow!', cast: 'war_cry' }
    ],
    intro: "Aldric sent a child? He always was soft. I'm not.",
    loot: {
      gold: [170, 210],
      drops: [{ item: 'hollow_ash', chance: 1.0 }, { item: 'bone_shard', chance: 0.6 }, { item: 'health_potion', chance: 0.6 }],
      tc:    [{ card: 'fortify', chance: 0.30 }, { card: 'moon_tide', chance: 0.30 }, { card: 'thunder_drake', chance: 0.30 }],
      table: 'gloam',
      gear:  [{ item: 'vex_boots', chance: 0.45 }, { item: 'gilded_marchboots', chance: 0.10 }, { item: 'oathbreaker_wand', chance: 0.30 }, { item: 'knight_amulet', chance: 0.20 }],
      legendary: ['leg_fallen_captain_helm', 'leg_oathbound_warplate', 'leg_watch_spurs'],
      mounts: [{ item: 'mount_emberhoof', chance: 0.05 }]
    }
  },

  nyx_herald: {
    name: 'Nyx, Herald of the Hollow King', level: 10, school: 'tidecaller', hp: 1450,
    model: 'herald', color: '#3a1d6e', scale: 1.05,
    deck: ['eclipse', 'eclipse', 'hollow_drain', 'hollow_drain', 'quill_storm', 'quill_storm', 'gloom_bolt', 'umbral_veil', 'void_trap'],
    ai: 'boss', dmg: 0.05, resist: 0.08, boss: true,
    affinity: { stoneward: -0.10 },
    brightChance: 0.3,
    phases: [
      { at: 1, say: 'Come closer, little candle. The dark is warm.', cast: 'umbral_aegis' },
      { at: 0.5, say: 'You burn bright. Let me dim you.', cast: 'umbral_veil' },
      { at: 0.25, say: 'I will NOT kneel to a child!', cast: 'void_trap' }
    ],
    intro: 'Little light. Do you know how easily a candle goes out?',
    loot: {
      gold: [400, 500],
      drops: [{ item: 'hollow_ash', chance: 1.0, count: 3 }, { item: 'health_potion', chance: 1.0 }],
      tc:    [{ card: 'titans_wrath', chance: 0.40 }, { card: 'leviathan', chance: 0.40 }, { card: 'phoenix_rage', chance: 0.40 }],
      table: 'gloam',
      gear:  [{ item: 'herald_amulet', chance: 1.0 }, { item: 'eclipse_cowl', chance: 0.45 }, { item: 'starless_crown', chance: 0.10 }],
      // v2.1 (Jorge, Oct 20 8:20 PM): the world-boss set. Each win rolls 2 gear pieces; each is a
      // Duskherald piece (items_endgame.js, your school, random slot) with 10 %, otherwise normal
      // gear. First piece ~5 wins, full 5-piece set ~57 wins (tests/loot-sim.js). The Starwalker
      // Greaves moved to the Hollow Orrery (the Orrery Sentinel), so the dungeon set is complete there.
      setRolls: { set: 'duskherald', count: 2, chance: 0.10 },
      legendary: ['leg_starless_night_crown', 'leg_eclipse_regalia', 'leg_herald_night_quill', 'leg_heart_of_eclipse'],
      mounts: [{ item: 'mount_nightmare', chance: 0.05 }]
    }
  },
  // ============================ ELITES (v1.1) ============================
  // Harder named variants with their own camps (zones.js, respawn 120 s).
  // They fight like small bosses (ai 'boss': charge one signature spell and
  // stack free blades/traps) but can be fled from (boss: false).
  // world.js shows a gold name tag; WF.models.enemy(model, { elite: true })
  // draws the crimson-gold elite look. Tuned in tests/balance-sim.js
  // ("Elites" table): ~85-100% at their level, 5-9 rounds.
  bogmire_brute: {
    name: 'Bogmire Brute', level: 3, school: 'stoneward', hp: 700, elite: true, base: 'rot_toad',
    model: 'toad', color: '#4f7a2a', scale: 1.0,
    deck: ['bog_belch', 'bog_belch', 'bog_belch', 'bog_spit', 'bog_spit', 'shadow_nip', 'royal_croak'],
    ai: 'boss', dmg: 0.15, resist: 0.0, boss: false,
    affinity: { emberstrike: -0.25, tidecaller: 0.15 },
    brightChance: 0.3,
    xp: 58,
    intro: 'CROOOAK. The big one. The VERY big one.',
    loot: {
      gold: [28, 40],
      drops: [{ item: 'toad_slime', chance: 1.0, count: 2 }, { item: 'moonmoss', chance: 0.6 }, { item: 'minor_health', chance: 0.25 }],
      tc:    [{ card: 'mudslide', chance: 0.12 }, { card: 'undertow', chance: 0.12 }, { card: 'fireball', chance: 0.12 }],
      table: 'mosslight', gear: [],
      mounts: [{ item: 'mount_mossback', chance: 0.015 }]
    }
  },

  gloomhorn_ringleader: {
    name: 'Gloomhorn Ringleader', level: 3, school: 'emberstrike', hp: 650, elite: true, base: 'gloom_imp',
    model: 'imp', color: '#8a2a40', scale: 1.0,
    deck: ['dread_wave', 'gloom_bolt', 'gloom_bolt', 'shadow_nip', 'shadow_nip', 'dark_blade', 'sap_weakness'],
    ai: 'boss', dmg: -0.05, resist: 0.0, boss: false,
    affinity: { stoneward: -0.20, emberstrike: 0.20 },
    brightChance: 0.3,
    xp: 58,
    intro: "I'm the boss of the imps! Well. The boss of THESE imps. Nyeh!",
    loot: {
      gold: [30, 42],
      drops: [{ item: 'imp_horn', chance: 1.0, count: 2 }, { item: 'mana_potion', chance: 0.25 }],
      tc:    [{ card: 'mudslide', chance: 0.12 }, { card: 'undertow', chance: 0.12 }, { card: 'fireball', chance: 0.12 }],
      table: 'mosslight', gear: [],
      mounts: [{ item: 'mount_mossback', chance: 0.015 }]
    }
  },

  shadowfang_alpha: {
    name: 'Shadowfang Alpha', level: 5, school: 'emberstrike', hp: 820, elite: true, base: 'hollow_wolf',
    model: 'wolf', color: '#3a3448', scale: 1.0,
    deck: ['dread_wave', 'dread_wave', 'gloom_bolt', 'gloom_bolt', 'shadow_nip', 'dark_blade', 'hex_trap'],
    ai: 'boss', dmg: 0.12, resist: 0.0, boss: false,
    affinity: { stoneward: -0.20 },
    brightChance: 0.3,
    xp: 83,
    intro: '*the pack leader bares teeth like black glass*',
    loot: {
      gold: [40, 55],
      drops: [{ item: 'shadow_fang', chance: 1.0, count: 2 }, { item: 'wisp_essence', chance: 0.4 }, { item: 'health_potion', chance: 0.2 }],
      tc:    [{ card: 'golem_fist', chance: 0.12 }, { card: 'wave_serpent', chance: 0.12 }, { card: 'storm_hawk', chance: 0.12 }],
      table: 'whisperwood', gear: [],
      mounts: [{ item: 'mount_thornstag', chance: 0.015 }]
    }
  },

  elder_bramblehulk: {
    name: 'Elder Bramblehulk', level: 6, school: 'stoneward', hp: 760, elite: true, base: 'bramble_ghoul',
    model: 'ghoul', color: '#4a5a2a', scale: 1.1,
    deck: ['dread_wave', 'dread_wave', 'rot_bloom', 'thorn_lash', 'thorn_lash', 'root_snare', 'shadow_shield'],
    ai: 'boss', dmg: 0.18, resist: 0.08, boss: false,
    affinity: { emberstrike: -0.25, stoneward: 0.20 },
    brightChance: 0.3,
    xp: 95,
    intro: 'Big... hug... BIGGEST hug...',
    loot: {
      gold: [45, 62],
      drops: [{ item: 'bark_heart', chance: 1.0, count: 2 }, { item: 'wisp_essence', chance: 0.6 }, { item: 'health_potion', chance: 0.2 }],
      tc:    [{ card: 'golem_fist', chance: 0.12 }, { card: 'wave_serpent', chance: 0.12 }, { card: 'storm_hawk', chance: 0.12 }],
      table: 'whisperwood', gear: [],
      mounts: [{ item: 'mount_thornstag', chance: 0.015 }]
    }
  },

  cinder_revenant: {
    name: 'Cinder Revenant', level: 8, school: 'emberstrike', hp: 1000, elite: true, base: 'ash_wraith',
    model: 'wraith', color: '#ff5a2a', scale: 1.1,
    deck: ['dread_wave', 'dread_wave', 'hollow_drain', 'gloom_bolt', 'shadow_nip', 'dark_blade', 'hex_trap'],
    ai: 'boss', dmg: 0.08, resist: 0.0, boss: false,
    affinity: { tidecaller: -0.25, emberstrike: 0.25 },
    brightChance: 0.3,
    xp: 120,
    intro: 'The fire... never... went OUT.',
    loot: {
      gold: [50, 70],
      drops: [{ item: 'ember_cinder', chance: 1.0, count: 2 }, { item: 'hollow_ash', chance: 0.4 }, { item: 'health_potion', chance: 0.25 }],
      tc:    [{ card: 'earthen_mend', chance: 0.12 }, { card: 'healing_rain', chance: 0.12 }, { card: 'wildfire', chance: 0.12 }],
      table: 'ashen', gear: [],
      mounts: [{ item: 'mount_emberhoof', chance: 0.02 }]
    }
  },

  dread_knight: {
    name: 'Dread Knight-Commander', level: 9, school: 'stoneward', hp: 880, elite: true, base: 'bone_knight',
    model: 'knight', color: '#c8c0a8', scale: 1.15,
    deck: ['bone_crush', 'bone_crush', 'dread_wave', 'gloom_bolt', 'shadow_shield', 'dark_blade'],
    ai: 'boss', dmg: 0.04, resist: 0.12, boss: false,
    affinity: { tidecaller: -0.20, stoneward: 0.20 },
    brightChance: 0.3,
    xp: 133,
    intro: 'Ranks... FORM. The Watch... answers... to ME.',
    loot: {
      gold: [55, 75],
      drops: [{ item: 'bone_shard', chance: 1.0, count: 2 }, { item: 'ember_cinder', chance: 0.6 }, { item: 'health_potion', chance: 0.25 }],
      tc:    [{ card: 'quake', chance: 0.12 }, { card: 'maelstrom', chance: 0.12 }, { card: 'firestorm', chance: 0.12 }],
      table: 'gloam', gear: [],
      mounts: [{ item: 'mount_emberhoof', chance: 0.02 }]
    }
  },

  hollow_hierophant: {
    name: 'Hollow Hierophant', level: 10, school: 'hollow', hp: 1050, elite: true, base: 'hollow_acolyte',
    model: 'acolyte', color: '#4a2a7a', scale: 1.05,
    deck: ['night_terror', 'night_terror', 'hollow_drain', 'hollow_drain', 'gloom_bolt', 'dark_blade', 'sap_weakness'],
    ai: 'boss', dmg: 0.20, resist: 0.08, boss: false,
    affinity: { stoneward: -0.20 },
    brightChance: 0.3,
    xp: 145,
    intro: 'Kneel, candle. The Herald sees you through my eyes.',
    loot: {
      gold: [60, 80],
      drops: [{ item: 'hollow_ash', chance: 1.0, count: 2 }, { item: 'mana_potion', chance: 0.3 }, { item: 'health_potion', chance: 0.3 }],
      tc:    [{ card: 'fortify', chance: 0.12 }, { card: 'moon_tide', chance: 0.12 }, { card: 'thunder_drake', chance: 0.12 }],
      table: 'gloam', gear: [],
      mounts: [{ item: 'mount_nightmare', chance: 0.01 }]
    }
  }
};

Object.keys(WF.data.enemies).forEach(function (id) { WF.data.enemies[id].id = id; });

// ---- v2.0 WS-B (Pets): pet egg drops — a chase drop, rarer than any gear (docs/design/pets.md).
// Only bosses and elites carry eggs; `table` = WF.data.pets.eggTables (chance + rarity roll),
// `species` = which eggs this enemy can drop (one picked at random). Read by WF.pets.rollEggs.
(function (E) {
  var EGGS = {
    grubnak:              { table: 'zone_boss', species: ['bogglet'] },
    thornmaw:             { table: 'zone_boss', species: ['thornfawn'] },
    captain_vex:          { table: 'zone_boss', species: ['ashwing'] },
    nyx_herald:           { table: 'world_boss', species: ['duskmote'] },
    bogmire_brute:        { table: 'elite', species: ['bogglet', 'mossling'] },
    gloomhorn_ringleader: { table: 'elite', species: ['mossling', 'puddlepup'] },
    shadowfang_alpha:     { table: 'elite', species: ['puddlepup', 'thornfawn'] },
    elder_bramblehulk:    { table: 'elite', species: ['thornfawn', 'mossling'] },
    cinder_revenant:      { table: 'elite', species: ['ashwing', 'cinderkit'] },
    dread_knight:         { table: 'elite', species: ['cinderkit', 'glowmoth'] },
    hollow_hierophant:    { table: 'elite', species: ['duskmote', 'glowmoth'] }
  };
  Object.keys(EGGS).forEach(function (id) { if (E[id]) { E[id].loot = E[id].loot || {}; E[id].loot.eggs = EGGS[id]; } });
})(WF.data.enemies);
