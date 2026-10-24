// =====================================================================
//  WIZZIE FARM — THE HOLLOW ORRERY: dungeon enemies (v1.2, WS4)
//
//  Loaded right after enemies.js (same schema, see the header there).
//  The level-10 post-game dungeon behind the star-vault door in the Ashen
//  Ruins (game/data/dungeons.js). Everything here is level 10.
//
//    shard_hound      mob     crystal-backed hound, fast bites + a bleed
//    orrery_seer      mob     floating astronomer-cultist, heals its pack
//    orrery_sentinel  boss    room 1: brass-and-obsidian guardian construct
//    warden_morrow    boss    room 2: the vault's last Lumen warden, hollowed
//    starless_archon  boss    room 3: the Hollow Court lord in the Orrery's heart
//
//  Bosses use the `boss` AI (charge the biggest spell, stack free charms),
//  bright chance 0.3, an opening and a 50 % phase like the story bosses.
//  THE ARCHON'S ADDS: its 50 % phase calls two keepers (a Shard Hound and an
//  Orrery Seer) via `phases[].summon` (enemy ids; a v1.2 data field). That
//  needs summon support in combat.js (WS2) and staging in combatView.js (WS1),
//  flagged as WF.Battle.features.summon + WF.combatView.features.summon. Until
//  both exist, world.js (W.dungeon) uses the room's `fallback` group from
//  dungeons.js instead: the keepers stand beside the Archon from the start, the
//  way Thornmaw's sprouts do. tests/dungeon-sim.js tunes BOTH to the contract
//  targets. A summon never brings a duel above 3 enemies.
//
//  LOOT v2.1 (Jorge, Oct 20, docs/V2.1-BACKLOG.md §B 4; replaces the v1.2 §6.1/§6.3 plan):
//    * every enemy drops 1-3 star_shard (WS2 reagent)
//    * each boss drops SPECIFIC slots of the dungeon set (shown in-game:
//      WF.state.bossDropHints -> the boss nameplate tooltip + the Orrery keeper):
//        Orrery Sentinel -> amulet + boots (Starwalker Greaves, moved here from Nyx)
//        Warden Morrow   -> wand
//        Starless Archon -> hat + robe (+ archon_core ~35 %, a rare mount)
//    * ONLY YOUR OWN SCHOOL drops (items_endgame.js `ownSchool`, state.js dropVariant)
//    * per slot and kill: T1 SET_RATE[1], T2 SET_RATE[2], T3 SET_RATE[3] (independent
//      rolls). Five slots -> ~50 % chance per full run of at least one set piece
//      ("50 % chance of an epic piece per run") and ~5 % of a T3 piece ("pure random
//      chance, no guarantee/pity: approx 5 % per run"). Tamsin's shard upgrades
//      (T1 -> T2 -> T3, items_endgame.js WF.data.gearUpgrades) add to that: the first
//      T3 piece arrives after ~15-20 runs on average, the full T3 set is a long chase.
//      Measured with the real roller: node tests/loot-sim.js (--check).
//    * the bosses' random gear piece (lootRules: one per boss) is NORMAL gear from the
//      L9-10 table; its legendary rarity picks from the Hollow Court legendaries below,
//      never a set piece (so the set rates above are exact).
//  The ids above are defined by WS2 (items_endgame.js) and WS3 (decks.js),
//  which load BEFORE this file. A reference to an item that is not defined
//  (yet) is left out at load time so the game can never drop a missing item;
//  tests/dungeon-check.js fails if a defining file exists without the id.
//  The full plan stays in WF.data.dungeonLootPlan for the checks and the sim.
// =====================================================================
window.WF = window.WF || { data: {} };
WF.data.enemies = WF.data.enemies || {};

(function (D) {
  'use strict';
  var ITEMS = D.items || {};
  function have(id) { return !!ITEMS[id]; }

  // 1-3 star shards (avg 2): one sure, two coin flips
  var SHARDS = [{ item: 'star_shard', chance: 1.0 }, { item: 'star_shard', chance: 0.5 }, { item: 'star_shard', chance: 0.5 }];
  // v2.1: chance per slot and kill of each tier of the dungeon set (see the header)
  var SET_RATE = D.dungeonSetRates = { 1: 0.11, 2: 0.010, 3: 0.009 };
  function setDrops(bases) {
    var out = [];
    bases.forEach(function (b) { [1, 2, 3].forEach(function (t) { out.push({ item: t === 1 ? b : b + '_t' + t, chance: SET_RATE[t] }); }); });
    return out;
  }

  // The intended loot, before missing items are filtered out.
  var PLAN = D.dungeonLootPlan = {
    shard_hound: {
      drops: SHARDS.concat([{ item: 'health_potion', chance: 0.05 }])
    },
    orrery_seer: {
      drops: SHARDS.concat([{ item: 'mana_potion', chance: 0.10 }, { item: 'health_potion', chance: 0.04 }])
    },
    orrery_sentinel: {
      drops: SHARDS.concat([{ item: 'deck_orrery', chance: 0.15 }, { item: 'health_potion', chance: 0.5 }]),
      gear: setDrops(['starbound_amulet', 'starwalker_boots'])
    },
    warden_morrow: {
      drops: SHARDS.concat([{ item: 'health_potion', chance: 0.5 }, { item: 'mana_potion', chance: 0.4 }]),
      gear: setDrops(['starbound_wand'])
    },
    starless_archon: {
      drops: SHARDS.concat([{ item: 'star_shard', chance: 1.0 }, { item: 'archon_core', chance: 0.35 }, { item: 'health_potion', chance: 1.0 }]),
      gear: setDrops(['starbound_hat', 'starbound_robe']),
      mounts: [{ item: 'mount_orrery_strider', chance: 0.03 }]
    }
  };
  // the bosses' legendary pool (every boss needs one: tests/data-check.js): the Hollow Court
  // legendaries (normal gear, not the dungeon set; v2.1)
  var FALLBACK_LEGENDARY = ['leg_heart_of_eclipse', 'leg_herald_night_quill', 'leg_starless_night_crown', 'leg_eclipse_regalia'].filter(have);

  function loot(id, gold, tc, extra) {
    var p = PLAN[id], L = { gold: gold, table: 'gloam', tc: tc };
    L.drops = (p.drops || []).filter(function (d) { return have(d.item); });
    L.gear = (p.gear || []).filter(function (d) { return have(d.item); });
    if (p.legendary || p.gear) {
      L.legendary = (p.legendary || []).filter(have);
      if (!L.legendary.length) L.legendary = FALLBACK_LEGENDARY.slice();
    }
    if (p.mounts) L.mounts = p.mounts.filter(function (d) { return have(d.item); });
    Object.keys(extra || {}).forEach(function (k) { L[k] = extra[k]; });
    return L;
  }

  var NEW = {
    // ------------------------------------------------------------ mobs
    shard_hound: {
      name: 'Shard Hound', level: 10, school: 'tidecaller', hp: 500,
      model: 'shardhound', color: '#8a6cff', scale: 1.0,
      deck: ['prism_fang', 'prism_fang', 'prism_fang', 'splinter_rake', 'splinter_rake', 'gloom_bolt', 'dark_blade'],
      ai: 'basic', dmg: 0.0, resist: 0.05, boss: false,
      affinity: { stoneward: -0.20, tidecaller: 0.10 },
      intro: '*crystal hackles rise along its back with a sound like breaking ice*',
      loot: loot('shard_hound', [30, 44], [{ card: 'thunder_drake', chance: 0.08 }, { card: 'moon_tide', chance: 0.08 }, { card: 'fortify', chance: 0.08 }])
    },

    orrery_seer: {
      name: 'Orrery Seer', level: 10, school: 'stoneward', hp: 420,
      model: 'seer', color: '#5a3a9a', scale: 1.0,
      deck: ['lens_flare', 'lens_flare', 'hollow_drain', 'ill_omen', 'starlit_mend'],
      ai: 'healer', dmg: -0.04, resist: 0.05, boss: false,
      affinity: { emberstrike: -0.20, stoneward: 0.10 },
      intro: 'The stars have been counted, wizard. You were not among them.',
      loot: loot('orrery_seer', [32, 46], [{ card: 'titans_wrath', chance: 0.06 }, { card: 'leviathan', chance: 0.06 }, { card: 'phoenix_rage', chance: 0.06 }])
    },

    // ------------------------------------------------------------ bosses
    orrery_sentinel: {
      name: 'Orrery Sentinel', level: 10, school: 'emberstrike', hp: 1750,
      model: 'sentinel', color: '#b8893a', scale: 1.0,
      deck: ['orbit_crush', 'orbit_crush', 'stone_volley', 'stone_volley', 'lodestone_snare', 'overclock'],
      ai: 'boss', dmg: 0.15, resist: 0.10, boss: true,   // v2.1 A5: 0.28 -> 0.20 (finite decks); v2.1 B4: 0.15 (full-run targets)
      affinity: { tidecaller: -0.15, stoneward: 0.10 },
      brightChance: 0.3,
      phases: [
        { at: 1, say: 'INTRUDER. ORBIT WARD: ENGAGED.', cast: 'orbit_ward' },
        { at: 0.5, say: 'DAMAGE AT HALF. GOVERNOR... REMOVED. OVERCLOCKING.', cast: 'overclock' }
      ],
      intro: 'HALT. THE ORRERY IS CLOSED TO VISITORS. THE ORRERY HAS BEEN CLOSED FOR THREE HUNDRED YEARS.',
      loot: loot('orrery_sentinel', [180, 230], [{ card: 'titans_wrath', chance: 0.30 }, { card: 'leviathan', chance: 0.30 }, { card: 'phoenix_rage', chance: 0.30 }])
    },

    warden_morrow: {
      name: 'Warden Morrow', level: 10, school: 'tidecaller', hp: 1850,
      model: 'warden', color: '#d8c48a', scale: 1.05,
      deck: ['dusk_lantern', 'dusk_lantern', 'broken_oath', 'grave_vigil', 'grave_vigil', 'wardens_vow', 'dimming_snare'],
      ai: 'boss', dmg: 0.18, resist: 0.08, boss: true,   // v2.1 A5: 0.30 -> 0.25 (finite decks); v2.1 B4: 0.18 (full-run targets)
      affinity: { emberstrike: -0.05, stoneward: -0.05 },   // v2.1 B4: was ember -0.10 / stone +0.10 (Stoneward's wall: solo runs 18 % vs Emberstrike 52 %)
      brightChance: 0.3,
      phases: [
        { at: 1, say: 'I swore no one would touch the Orrery. I keep my oaths. I keep EVERYTHING.', cast: 'wardens_vow' },
        { at: 0.5, say: 'My lantern is going out... no. NO. I will keep this last light!', cast: 'last_lantern' }
      ],
      intro: 'Another thief of starlight. Turn back, or I will keep your light too.',
      loot: loot('warden_morrow', [220, 270], [{ card: 'titans_wrath', chance: 0.30 }, { card: 'leviathan', chance: 0.30 }, { card: 'phoenix_rage', chance: 0.30 }])
    },

    starless_archon: {
      name: 'The Starless Archon', level: 10, school: 'hollow', hp: 1200,
      model: 'archon', color: '#2a1a4e', scale: 1.0,
      deck: ['starless_collapse', 'starless_collapse', 'black_planet', 'black_planet', 'gloom_bolt', 'nadir_mantle'],
      ai: 'boss', dmg: -0.05, resist: 0.10, boss: true,   // v2.1 B4: 0 -> -0.05 (full-run targets, tests/dungeon-sim.js)
      affinity: { emberstrike: -0.20, stoneward: 0.15 },
      brightChance: 0.3,
      phases: [
        { at: 1, say: 'Another lamp wanders into my sky. I will add you to the collection.', cast: 'starless_veil' },
        { at: 0.5, say: 'Orrery, TURN! Bring me my keepers!', cast: 'void_constellation', summon: ['shard_hound', 'orrery_seer'] },
        { at: 0.25, say: 'Every star goes out. I only make it sooner.', cast: 'nadir_mantle' }
      ],
      intro: 'Kneel, candle. The stars are mine to keep, and so are you.',
      loot: loot('starless_archon', [420, 520], [{ card: 'titans_wrath', chance: 0.40 }, { card: 'leviathan', chance: 0.40 }, { card: 'phoenix_rage', chance: 0.40 }])
    }
  };

  Object.keys(NEW).forEach(function (id) { NEW[id].id = id; D.enemies[id] = NEW[id]; });
})(WF.data);

// ---- v2.0 WS-B (Pets): egg drops of the Hollow Orrery bosses (WF.data.pets.eggTables)
(function (E) {
  var EGGS = {
    orrery_sentinel: { table: 'dungeon_boss', species: ['orrery_owlet', 'duskmote'] },
    warden_morrow:   { table: 'dungeon_boss', species: ['orrery_owlet', 'glowmoth'] },
    starless_archon: { table: 'archon', species: ['orrery_owlet', 'duskmote'] }
  };
  Object.keys(EGGS).forEach(function (id) { if (E[id] && E[id].boss) { E[id].loot = E[id].loot || {}; E[id].loot.eggs = EGGS[id]; } });
})(WF.data.enemies);
