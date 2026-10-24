// =====================================================================
//  WIZZIE FARM — CRAFTING RECIPES  (reagent + gold sink)
//
//  Schema (docs/ARCHITECTURE.md, v0.2 addendum):
//    WF.data.recipes[id] = {
//      name,                 shown in the crafting list
//      npc,                  who crafts it: 'wren' (Whisperwood) | 'pip_quickcoin' (Lanternmere, the hub)
//                            | 'tamsin' (v1.2: Lanternmere by the stables, the Artificer set)
//      makes: { item: id }   an item from items.js (potion / gear)
//           | { tc: cardId } Spell Scrolls (TCs: single-use spells) from cards.js
//      count,                how many you get per craft
//      needs: { reagentId: n },  consumed from the backpack
//      gold,                 crafting fee
//      level                 minimum player level to craft it
//    }
//  Loaded after items.js (game/data/recipes.js).
//
//  ECONOMY INTENT (docs/design/combat-and-progression.md, section 8):
//   * Every zone's reagents feed something, so loot stays meaningful after
//     the collect quests are done.
//   * Wren brews potions (cheaper than Pip's prices, but costs reagents)
//     and inks Spell Scrolls of other schools' spells.
//   * Pip sells late scrolls (L7-8; you pass him between Ashen trips) and
//     forges amulets — the only shop-adjacent source for the amulet
//     slot — and his late recipes are the end-game gold sink
//     (Emberheart Pendant 650 g, Sigil of the Lumen Order 1,200 g).
//   * Rule of thumb for new recipes: gold fee ~= 30-40% of an equivalent
//     shop item, plus reagents worth (sell value) ~= the other 30%.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.recipes = {
  // ------------------------- WREN: potions -------------------------
  wren_minor_health: {
    name: 'Brew Minor Health Potions', npc: 'wren',
    makes: { item: 'minor_health' }, count: 2,
    needs: { moonmoss: 3, toad_slime: 2 }, gold: 10, level: 2
  },
  wren_mana_potion: {
    name: 'Brew Mana Potions', npc: 'wren',
    makes: { item: 'mana_potion' }, count: 2,
    needs: { wisp_essence: 2, imp_horn: 1 }, gold: 15, level: 4
  },
  wren_health_potion: {
    name: 'Brew Health Potions', npc: 'wren',
    makes: { item: 'health_potion' }, count: 2,
    needs: { bark_heart: 2, shadow_fang: 2 }, gold: 30, level: 5
  },

  // ---------------------- WREN: spell scrolls (TCs) ----------------------
  wren_scroll_fireball: {
    name: 'Ink Fireball Scrolls', npc: 'wren',
    makes: { tc: 'fireball' }, count: 2,
    needs: { imp_horn: 2, toad_slime: 2 }, gold: 25, level: 3
  },
  wren_scroll_golem_fist: {
    name: 'Ink a Golem Fist Scroll', npc: 'wren',
    makes: { tc: 'golem_fist' }, count: 1,
    needs: { bark_heart: 2, moonmoss: 3 }, gold: 40, level: 5
  },
  wren_scroll_wave_serpent: {
    name: 'Ink a Wave Serpent Scroll', npc: 'wren',
    makes: { tc: 'wave_serpent' }, count: 1,
    needs: { wisp_essence: 3, toad_slime: 2 }, gold: 40, level: 5
  },
  wren_scroll_gale_hawk: {
    name: 'Ink a Gale Hawk Scroll', npc: 'wren',
    makes: { tc: 'storm_hawk' }, count: 1,
    needs: { shadow_fang: 2, imp_horn: 2 }, gold: 40, level: 5
  },

  // ------------- PIP: late scrolls (he imports them from the Spire) -------------
  pip_scroll_quake: {
    name: 'Commission a Quake Scroll', npc: 'pip_quickcoin',
    makes: { tc: 'quake' }, count: 1,
    needs: { bone_shard: 3, bark_heart: 2 }, gold: 80, level: 7
  },
  pip_scroll_healing_rain: {
    name: 'Commission a Healing Rain Scroll', npc: 'pip_quickcoin',
    makes: { tc: 'healing_rain' }, count: 1,
    needs: { ember_cinder: 2, wisp_essence: 3 }, gold: 80, level: 7
  },
  pip_scroll_skyrend_drake: {
    name: 'Commission a Skyrend Drake Scroll', npc: 'pip_quickcoin',
    makes: { tc: 'thunder_drake' }, count: 1,
    needs: { ember_cinder: 3, hollow_ash: 2 }, gold: 90, level: 8
  },

  // ------------------------- PIP: amulets -------------------------
  pip_moonglow_charm: {
    name: 'Forge a Moonglow Charm', npc: 'pip_quickcoin',
    makes: { item: 'moonglow_charm' }, count: 1,
    needs: { moonmoss: 3, toad_slime: 2, imp_horn: 2 }, gold: 60, level: 3
  },
  pip_wildwood_talisman: {
    name: 'Forge a Wildwood Talisman', npc: 'pip_quickcoin',
    makes: { item: 'wildwood_talisman' }, count: 1,
    needs: { shadow_fang: 3, bark_heart: 2, wisp_essence: 2 }, gold: 220, level: 6
  },
  pip_emberheart_pendant: {
    name: 'Forge an Emberheart Pendant', npc: 'pip_quickcoin',
    makes: { item: 'emberheart_pendant' }, count: 1,
    needs: { ember_cinder: 4, bone_shard: 3, hollow_ash: 3 }, gold: 650, level: 9
  },
  pip_lumen_sigil: {
    name: 'Forge the Sigil of the Lumen Order', npc: 'pip_quickcoin',
    makes: { item: 'lumen_sigil' }, count: 1,
    needs: { hollow_ash: 4, bone_shard: 3, ember_cinder: 3, wisp_essence: 2 }, gold: 1200, level: 10
  },

  // ---- v1.2 WS2: TAMSIN GEARWRIGHT, Master Artificer (Lanternmere, by the stables) ----
  // The Artificer set (items_endgame.js, epic, crafted: true) can ONLY be made
  // here, and only at Tier 1: Tier 2 / 3 are Tamsin's upgrades
  // (WF.data.gearUpgrades). Every piece is school-specific: you get your own
  // school's version unless you pick another school in her panel (to craft
  // for another of your wizards, contract §6.1).
  // Cost design (docs/design/combat-and-progression.md §16.6):
  //   * star_shard: every Hollow Orrery enemy drops 1-3 (+ the reward chest),
  //     ~31 per clear. The set needs 300 = ~9.7 clears, the same as farming a
  //     full own-school T1 Starbound set (~10 clears, random-school drops),
  //     but DETERMINISTIC: every clear brings you closer, no drop luck.
  //   * archon_core (the Archon, ~35 %): only the robe and the wand need one.
  //   * Ashen Ruins reagents (the dungeon entrance is there) + 8,300 gold for
  //     the set: the post-game gold sink (dungeon runs pay ~1,500+ g each).
  tamsin_artificer_hat: {
    name: "Craft an Artificer's Cap", npc: 'tamsin',
    makes: { item: 'artificer_hat' }, count: 1,
    needs: { star_shard: 54, hollow_ash: 6, ember_cinder: 4 }, gold: 1400, level: 10
  },
  tamsin_artificer_robe: {
    name: "Craft an Artificer's Workcoat", npc: 'tamsin',
    makes: { item: 'artificer_robe' }, count: 1,
    needs: { star_shard: 66, archon_core: 1, bone_shard: 6, hollow_ash: 4 }, gold: 1800, level: 10
  },
  tamsin_artificer_boots: {
    name: "Craft Artificer's Brass-Toe Boots", npc: 'tamsin',
    makes: { item: 'artificer_boots' }, count: 1,
    needs: { star_shard: 54, ember_cinder: 6, bone_shard: 4 }, gold: 1500, level: 10
  },
  tamsin_artificer_wand: {
    name: "Craft an Artificer's Wand", npc: 'tamsin',
    makes: { item: 'artificer_wand' }, count: 1,
    needs: { star_shard: 66, archon_core: 1, ember_cinder: 6, wisp_essence: 4 }, gold: 2000, level: 10
  },
  tamsin_artificer_amulet: {
    name: "Craft an Artificer's Clockwork Medallion", npc: 'tamsin',
    makes: { item: 'artificer_amulet' }, count: 1,
    needs: { star_shard: 60, hollow_ash: 6, bone_shard: 4 }, gold: 1600, level: 10
  },
  // The crafted deck (WS3 defines the item `deck_artificer` in decks.js:
  // L10 epic, crafted). Deck items are unique: state.js canCraft refuses a
  // second one. Hidden from the list until the item exists.
  tamsin_deck_artificer: {
    name: "Craft the Artificer's Deck", npc: 'tamsin',
    makes: { item: 'deck_artificer' }, count: 1,
    needs: { star_shard: 30, hollow_ash: 4, wisp_essence: 4 }, gold: 1500, level: 10
  }
};

Object.keys(WF.data.recipes).forEach(function (id) { WF.data.recipes[id].id = id; });
