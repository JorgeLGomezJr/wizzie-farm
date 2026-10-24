// =====================================================================
//  WIZZIE FARM — ITEMS (reagents, potions, gear, mounts) + RARITY + LOOT
//
//  type: 'reagent' | 'potion' | 'gear' | 'mount'
//  Gear slots: hat, robe, boots, wand, amulet   (WF.data.gearSlots)
//  Gear stats: hp, mana (flat)  |  dmg, resist, acc (percent, 5 = +5%)
//  level  = level required to equip.  price = shop price (0 = not sold).
//  sell   = gold you get when selling.
//  rarity = 'common' (default) | 'uncommon' | 'rare' | 'epic' | 'legendary'
//           (WF.data.rarities: colour, statMult, sellMult)
//  school = optional: gear made for one school (only that school can wear it)
//  variants = { stoneward: id, tidecaller: id, emberstrike: id } on a BASE
//           drop: the engine swaps the drop for the player's school version.
//           The base item stays valid (fallback / old saves).
//  look   = how the piece changes the wizard (docs/V1.1-CONTRACT.md §4.2):
//           { style, color, color2, gem, fx }  — every gear item has one.
//           Omitted colours fall back to the wearer's school colours.
//  table  = generated drop gear belongs to a loot table (see LOOT below).
//
//  v1.1 "Gear & Glory": a generated catalogue of zone-tier sets (4 tiers ×
//  4 rarities × 5 slots, school variants on every epic hat and wand) plus
//  unique legendary boss drops, rarity-weighted loot tables, and mounts.
//  Design + drop-rate math: docs/design/combat-and-progression.md §9.4–9.6.
// =====================================================================
window.WF = window.WF || { data: {} };

// ---------------------------------------------------------------- RARITY
// statMult scales the generated stat budget, sellMult the generated sell
// price.  Ordered (object key order = order); `order` is also explicit.
WF.data.rarities = {
  common:    { id: 'common',    name: 'Common',    color: '#d8d8d8', order: 0, statMult: 1.00, sellMult: 1.0 },
  uncommon:  { id: 'uncommon',  name: 'Uncommon',  color: '#5fd35f', order: 1, statMult: 1.12, sellMult: 1.6 },
  rare:      { id: 'rare',      name: 'Rare',      color: '#4aa3ff', order: 2, statMult: 1.25, sellMult: 2.6 },
  epic:      { id: 'epic',      name: 'Epic',      color: '#b45cff', order: 3, statMult: 1.40, sellMult: 4.2 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ff9a1f', order: 4, statMult: 1.60, sellMult: 6.5 }
};
WF.data.rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Allowed look styles per slot (first = default). C1 renders every one.
// ---- v1.2 WS6: Artificer (artisan / forged / gearwork) + Starbound (starbound / starwalker) looks appended
// (index 0 of every list stays the slot default; see docs/V1.2-CONTRACT.md §2.5)
WF.data.gearStyles = {
  hat:    ['pointed', 'wide', 'tall', 'crown', 'circlet', 'hood', 'helm', 'cowl', 'horned', 'feathered', 'artisan', 'starbound'],
  robe:   ['bell', 'layered', 'long', 'armored', 'mantle', 'battle', 'artisan', 'starbound'],
  boots:  ['slippers', 'boots', 'greaves', 'curled', 'artisan', 'starwalker'],
  wand:   ['staff', 'wand', 'scepter', 'crook', 'blade', 'orb', 'branch', 'forged', 'starbound'],
  amulet: ['pendant', 'medallion', 'talisman', 'gearwork', 'starbound']
};
WF.data.gearFx = ['glow', 'sparkle', 'embers', 'frost', 'shadow', 'radiant', 'leaves'];

WF.data.items = {
  // ---------- Reagents (dropped by enemies; used for quests, sold for gold) ----------
  moonmoss:     { type: 'reagent', name: 'Moonmoss',     color: '#9fe8a8', sell: 3,  desc: 'Glowing moss from Mosslight Path.' },
  toad_slime:   { type: 'reagent', name: 'Toad Slime',   color: '#7fae4b', sell: 3,  desc: 'Sticky. Smells awful.' },
  imp_horn:     { type: 'reagent', name: 'Imp Horn',     color: '#c0485a', sell: 5,  desc: 'Still warm.' },
  shadow_fang:  { type: 'reagent', name: 'Shadow Fang',  color: '#5a5470', sell: 7,  desc: 'Fang of a Hollow Wolf.' },
  wisp_essence: { type: 'reagent', name: 'Wisp Essence', color: '#bff3ff', sell: 8,  desc: 'Captured light of a lost wisp.' },
  bark_heart:   { type: 'reagent', name: 'Bark Heart',   color: '#8b5a2b', sell: 10, desc: 'A knot of living wood.' },
  ember_cinder: { type: 'reagent', name: 'Ember Cinder', color: '#ff8a3d', sell: 10, desc: 'Never stops smoldering.' },
  bone_shard:   { type: 'reagent', name: 'Bone Shard',   color: '#e8e2cf', sell: 11, desc: 'From a fallen Bone Knight.' },
  hollow_ash:   { type: 'reagent', name: 'Hollow Ash',   color: '#7a5aa8', sell: 14, desc: 'Ash touched by the Hollow King.' },

  // ---------- Potions (press H for health, J for mana out of combat) ----------
  minor_health:  { type: 'potion', name: 'Minor Health Potion', color: '#ff5a6a', heal: 300, price: 40,  sell: 10, desc: 'Restores 300 health.' },
  health_potion: { type: 'potion', name: 'Health Potion',       color: '#ff2a4a', heal: 650, price: 110, sell: 25, desc: 'Restores 650 health.' },
  mana_potion:   { type: 'potion', name: 'Mana Potion',         color: '#5aa8ff', mana: 15, price: 45,  sell: 10, desc: 'Restores 15 mana.' },

  // ---------- Gear: Shop tiers (Pip Quickcoin) ----------
  // Looks: no `color` = the wearer's school colours, so shop gear always
  // matches your school; the style changes per tier.
  apprentice_hat:   { type: 'gear', slot: 'hat',   name: 'Lanternbearer Hat',   level: 1, price: 40,  sell: 10, stats: { hp: 25, dmg: 1 },  look: { style: 'pointed' } },
  apprentice_robe:  { type: 'gear', slot: 'robe',  name: 'Lanternbearer Robe',  level: 1, price: 55,  sell: 14, stats: { hp: 35, resist: 2 }, look: { style: 'bell' } },
  apprentice_boots: { type: 'gear', slot: 'boots', name: 'Lanternbearer Boots', level: 1, price: 35,  sell: 9,  stats: { hp: 20, acc: 2 },  look: { style: 'slippers', color: '#6a4a2a' } },
  willow_wand:      { type: 'gear', slot: 'wand',  name: 'Willow Wand',         level: 1, price: 45,  sell: 11, stats: { dmg: 3 },          look: { style: 'staff', color: '#a58a5a' } },

  journeyman_hat:   { type: 'gear', slot: 'hat',   name: 'Wayfarer Hat',   level: 4, price: 160, sell: 40, stats: { hp: 55, dmg: 3 },  look: { style: 'wide', color2: '#c9a24a' } },
  journeyman_robe:  { type: 'gear', slot: 'robe',  name: 'Wayfarer Robe',  level: 4, price: 190, sell: 47, stats: { hp: 75, resist: 4 }, look: { style: 'layered', color2: '#c9a24a' } },
  journeyman_boots: { type: 'gear', slot: 'boots', name: 'Wayfarer Boots', level: 4, price: 150, sell: 37, stats: { hp: 45, acc: 4, mana: 2 }, look: { style: 'boots', color: '#5a3e24', color2: '#c9a24a' } },
  oak_wand:         { type: 'gear', slot: 'wand',  name: 'Oak Wand',       level: 4, price: 180, sell: 45, stats: { dmg: 6, acc: 2 },  look: { style: 'staff', color: '#7a5232', color2: '#c9a24a' } },

  adept_hat:        { type: 'gear', slot: 'hat',   name: 'Spirewarden Hat',   level: 7, price: 400, sell: 100, stats: { hp: 95, dmg: 5 },  look: { style: 'tall', color2: '#ffd76a' } },
  adept_robe:       { type: 'gear', slot: 'robe',  name: 'Spirewarden Robe',  level: 7, price: 460, sell: 115, stats: { hp: 130, resist: 7 }, look: { style: 'long', color2: '#ffd76a' } },
  adept_boots:      { type: 'gear', slot: 'boots', name: 'Spirewarden Boots', level: 7, price: 380, sell: 95,  stats: { hp: 75, acc: 6, mana: 4 }, look: { style: 'boots', color: '#3a2e4e', color2: '#ffd76a' } },
  starsilver_wand:  { type: 'gear', slot: 'wand',  name: 'Starsilver Wand',   level: 7, price: 440, sell: 110, stats: { dmg: 10, acc: 3 }, look: { style: 'wand', color: '#d8e0f0', color2: '#ffffff', gem: '#bfe6ff' } },

  // Level 9 tier (gold sink for the Ashen Ruins chapter)
  luminary_hat:     { type: 'gear', slot: 'hat',   name: 'Luminary Hat',     level: 9, rarity: 'uncommon', price: 820, sell: 205, stats: { hp: 125, dmg: 7 },  look: { style: 'feathered', color2: '#fff1b8', gem: '#fff6c8' } },
  luminary_robe:    { type: 'gear', slot: 'robe',  name: 'Luminary Robe',    level: 9, rarity: 'uncommon', price: 950, sell: 237, stats: { hp: 170, resist: 9 }, look: { style: 'mantle', color2: '#fff1b8' } },
  luminary_boots:   { type: 'gear', slot: 'boots', name: 'Luminary Boots',   level: 9, rarity: 'uncommon', price: 760, sell: 190, stats: { hp: 100, acc: 7, mana: 5 }, look: { style: 'curled', color2: '#fff1b8' } },
  dawnfire_wand:    { type: 'gear', slot: 'wand',  name: 'Dawnfire Wand',    level: 9, rarity: 'uncommon', price: 880, sell: 220, stats: { dmg: 12, acc: 4 }, look: { style: 'orb', color: '#e8c87a', color2: '#fff1b8', gem: '#ffcf6a' } },

  // ---------- Gear: hand-made drops (also in the loot tables below) ----------
  mossy_charm:      { type: 'gear', slot: 'amulet', name: 'Mossy Charm',        level: 2, rarity: 'uncommon', price: 0, stats: { hp: 30, acc: 2 },     look: { style: 'pendant', color: '#7a8a5a', gem: '#9fe8a8' } },
  wolfhide_boots:   { type: 'gear', slot: 'boots',  name: 'Wolfhide Boots',     level: 4, rarity: 'uncommon', price: 0, stats: { hp: 60, acc: 5 },     look: { style: 'boots', color: '#5a5470', color2: '#d8d0e8' } },
  ashen_wand:       { type: 'gear', slot: 'wand',   name: 'Ashen Wand',         level: 7, rarity: 'rare',     price: 0, stats: { dmg: 11, acc: 4 },    look: { style: 'wand', color: '#2a2224', color2: '#ff8a3d', gem: '#ff8a3d', fx: 'embers' } },
  knight_amulet:    { type: 'gear', slot: 'amulet', name: 'Fallen Knight Seal', level: 8, rarity: 'rare',     price: 0, stats: { hp: 90, resist: 4 },  look: { style: 'medallion', color: '#e8e2cf', color2: '#ffd76a', gem: '#fff6c8' } },

  // ---------- Boss signature drops ----------
  // A base item with `variants` drops as the player's school version.
  // Grubnak (L3)
  bogking_crown:    { type: 'gear', slot: 'hat', name: "Bog King's Crown", level: 3, rarity: 'rare', price: 0, stats: { hp: 50, dmg: 3, mana: 3 },
                      look: { style: 'crown', color: '#c9a23a', color2: '#5f8a2e', gem: '#9dff5a' },
                      variants: { stoneward: 'bogking_crown_stoneward', tidecaller: 'bogking_crown_tidecaller', emberstrike: 'bogking_crown_emberstrike' } },
  bogking_crown_stoneward:   { type: 'gear', slot: 'hat', school: 'stoneward',   name: "Bog King's Mudstone Crown",  level: 3, rarity: 'rare', price: 0, stats: { hp: 70, resist: 3, mana: 2 }, look: { style: 'crown', color: '#8a6a3b', color2: '#5f8a2e', gem: '#d4a25f' } },
  bogking_crown_tidecaller:  { type: 'gear', slot: 'hat', school: 'tidecaller',  name: "Bog King's Marsh Crown",     level: 3, rarity: 'rare', price: 0, stats: { hp: 55, dmg: 2, mana: 5 }, look: { style: 'crown', color: '#4f8fa0', color2: '#9fe8a8', gem: '#4fc3e8' } },
  bogking_crown_emberstrike: { type: 'gear', slot: 'hat', school: 'emberstrike', name: "Bog King's Swampfire Crown", level: 3, rarity: 'rare', price: 0, stats: { hp: 40, dmg: 5, acc: 2 }, look: { style: 'crown', color: '#c9a23a', color2: '#a8321b', gem: '#ff6b3d' } },
  gilded_bog_crown: { type: 'gear', slot: 'hat', name: 'Gilded Bog Crown', level: 3, rarity: 'epic', price: 0, stats: { hp: 75, dmg: 4, mana: 4, acc: 3 },
                      look: { style: 'feathered', color: '#ffcf3a', color2: '#7fae4b', gem: '#9dff5a', fx: 'sparkle' },
                      desc: "Grubnak's own crown, gilded and given freely. The feather still bobs when you nod." },
  // Thornmaw (L6)
  thornbark_robe:   { type: 'gear', slot: 'robe', name: 'Thornbark Robe',  level: 6, rarity: 'rare', price: 0, stats: { hp: 115, resist: 6, mana: 3 }, look: { style: 'layered', color: '#5a4630', color2: '#7fae4b', gem: '#9dff5a' } },
  elderheart_robe:  { type: 'gear', slot: 'robe', name: 'Elderheart Robe', level: 6, rarity: 'epic', price: 0, stats: { hp: 150, resist: 7, mana: 4, dmg: 2 },
                      look: { style: 'mantle', color: '#4a6a3a', color2: '#e8c87a', gem: '#ffcf6a', fx: 'leaves' },
                      desc: 'Woven from the one branch the rot never reached.' },
  heartwood_wand:   { type: 'gear', slot: 'wand', name: 'Heartwood Wand',  level: 5, rarity: 'rare', price: 0, stats: { dmg: 8, acc: 3 }, look: { style: 'branch', color: '#6a4a2a', color2: '#7fd88a', gem: '#9dff5a' },
                      variants: { stoneward: 'heartwood_wand_stoneward', tidecaller: 'heartwood_wand_tidecaller', emberstrike: 'heartwood_wand_emberstrike' } },
  heartwood_wand_stoneward:   { type: 'gear', slot: 'wand', school: 'stoneward',   name: 'Heartwood Root-Staff',    level: 5, rarity: 'rare', price: 0, stats: { dmg: 6, acc: 4, hp: 40 }, look: { style: 'branch', color: '#5a3e24', color2: '#d4a25f', gem: '#d4a25f' } },
  heartwood_wand_tidecaller:  { type: 'gear', slot: 'wand', school: 'tidecaller',  name: 'Heartwood Dew-Wand',      level: 5, rarity: 'rare', price: 0, stats: { dmg: 7, acc: 3, mana: 3 }, look: { style: 'branch', color: '#6a5a3a', color2: '#bdefff', gem: '#4fc3e8' } },
  heartwood_wand_emberstrike: { type: 'gear', slot: 'wand', school: 'emberstrike', name: 'Heartwood Kindling Wand', level: 5, rarity: 'rare', price: 0, stats: { dmg: 10, acc: 3 }, look: { style: 'branch', color: '#4a2e1c', color2: '#ffcf6a', gem: '#ff6b3d', fx: 'embers' } },
  // Captain Vex (L9)
  vex_boots:        { type: 'gear', slot: 'boots', name: "Captain Vex's Boots", level: 9, rarity: 'rare', price: 0, stats: { hp: 110, acc: 6, dmg: 4 }, look: { style: 'greaves', color: '#4a4f68', color2: '#8a8fa8', gem: '#c78bff' } },
  gilded_marchboots:{ type: 'gear', slot: 'boots', name: 'Gilded Marchboots',   level: 9, rarity: 'epic', price: 0, stats: { hp: 140, acc: 7, dmg: 5, mana: 3 },
                      look: { style: 'greaves', color: '#e8c87a', color2: '#ffffff', gem: '#fff6c8', fx: 'radiant' },
                      desc: 'Parade boots of the old Dawn Watch, polished one last time.' },
  oathbreaker_wand: { type: 'gear', slot: 'wand', name: 'Oathbreaker Wand', level: 9, rarity: 'rare', price: 0, stats: { dmg: 12, acc: 4 }, look: { style: 'blade', color: '#8a8fa8', color2: '#3a2a4a', gem: '#c78bff' },
                      variants: { stoneward: 'oathbreaker_wand_stoneward', tidecaller: 'oathbreaker_wand_tidecaller', emberstrike: 'oathbreaker_wand_emberstrike' } },
  oathbreaker_wand_stoneward:   { type: 'gear', slot: 'wand', school: 'stoneward',   name: 'Oathbreaker Mace-Wand', level: 9, rarity: 'rare', price: 0, stats: { dmg: 10, acc: 5, hp: 60 }, look: { style: 'scepter', color: '#7a6a5a', color2: '#d4a25f', gem: '#d4a25f' } },
  oathbreaker_wand_tidecaller:  { type: 'gear', slot: 'wand', school: 'tidecaller',  name: 'Oathbreaker Tide-Wand', level: 9, rarity: 'rare', price: 0, stats: { dmg: 11, acc: 4, mana: 4 }, look: { style: 'blade', color: '#8aa8c0', color2: '#bdefff', gem: '#4fc3e8' } },
  oathbreaker_wand_emberstrike: { type: 'gear', slot: 'wand', school: 'emberstrike', name: 'Oathbreaker Brand',     level: 9, rarity: 'rare', price: 0, stats: { dmg: 14, acc: 4 }, look: { style: 'blade', color: '#5a2a1a', color2: '#ffcf6a', gem: '#ff6b3d', fx: 'embers' } },
  // Nyx (L10, final boss; can be fought again after the ending)
  herald_amulet:    { type: 'gear', slot: 'amulet', name: "Herald's Eclipse", level: 10, rarity: 'epic', price: 0, stats: { hp: 150, dmg: 8, resist: 5 }, look: { style: 'talisman', color: '#2a1d4e', color2: '#ffd76a', gem: '#b06cff', fx: 'shadow' } },
  eclipse_cowl:     { type: 'gear', slot: 'hat', name: 'Eclipse Cowl', level: 10, rarity: 'rare', price: 0, stats: { hp: 140, dmg: 8 }, look: { style: 'cowl', color: '#2a1d4e', color2: '#7a5aa8', gem: '#b06cff' },
                      variants: { stoneward: 'eclipse_cowl_stoneward', tidecaller: 'eclipse_cowl_tidecaller', emberstrike: 'eclipse_cowl_emberstrike' } },
  eclipse_cowl_stoneward:   { type: 'gear', slot: 'hat', school: 'stoneward',   name: 'Eclipse Helm',      level: 10, rarity: 'rare', price: 0, stats: { hp: 180, dmg: 5, resist: 4 }, look: { style: 'helm', color: '#3a2e44', color2: '#d4a25f', gem: '#b06cff' } },
  eclipse_cowl_tidecaller:  { type: 'gear', slot: 'hat', school: 'tidecaller',  name: 'Eclipse Hood',      level: 10, rarity: 'rare', price: 0, stats: { hp: 150, dmg: 7, mana: 5 }, look: { style: 'hood', color: '#1e2a4e', color2: '#bdefff', gem: '#4fc3e8' } },
  eclipse_cowl_emberstrike: { type: 'gear', slot: 'hat', school: 'emberstrike', name: 'Eclipse Flamecowl', level: 10, rarity: 'rare', price: 0, stats: { hp: 120, dmg: 11, acc: 2 }, look: { style: 'cowl', color: '#3a1424', color2: '#ffcf6a', gem: '#ff6b3d', fx: 'embers' } },
  starless_crown:   { type: 'gear', slot: 'hat', name: 'Starless Crown', level: 10, rarity: 'epic', price: 0, stats: { hp: 170, dmg: 10, resist: 3, mana: 4 },
                      look: { style: 'crown', color: '#1a1030', color2: '#b8a0d8', gem: '#e8e0ff', fx: 'shadow' },
                      desc: 'It drinks the light around it. Wear it anyway; you have earned that.' },

  // ---------- Crafted amulets (Pip Quickcoin, recipes.js) ----------
  moonglow_charm:   { type: 'gear', slot: 'amulet', name: 'Moonglow Charm',     level: 3,  rarity: 'uncommon', price: 0, stats: { hp: 45, mana: 2, acc: 1 }, look: { style: 'pendant', color: '#d8e0f0', gem: '#9fe8a8' } },
  wildwood_talisman:{ type: 'gear', slot: 'amulet', name: 'Wildwood Talisman',  level: 6,  rarity: 'uncommon', price: 0, stats: { hp: 80, acc: 3, mana: 3 }, look: { style: 'talisman', color: '#6a4a2a', color2: '#5a5470', gem: '#bff3ff' } },
  emberheart_pendant:{ type: 'gear', slot: 'amulet', name: 'Emberheart Pendant', level: 9, rarity: 'rare', price: 0, stats: { hp: 120, dmg: 4, resist: 3, mana: 2 }, look: { style: 'pendant', color: '#e8e2cf', gem: '#ff8a3d', fx: 'embers' } },
  lumen_sigil:      { type: 'gear', slot: 'amulet', name: 'Sigil of the Lumen Order', level: 10, rarity: 'epic', price: 0, stats: { hp: 160, dmg: 6, resist: 4, acc: 3, mana: 4 },
                      look: { style: 'medallion', color: '#ffe9a0', color2: '#ffffff', gem: '#fff6c8', fx: 'radiant' },
                      desc: 'Pip swears he made it himself. Aurelia swears he did not.' },

  // ---------- Mounts (Stablemaster Hollis in Lanternmere; rare ones drop) ----------
  // speed: +0.4 = 40% faster than walking (the classic standard horse).
  // mount: model options for WF.models.mount(kind, opts) (C1, contract §4.5).
  mount_pony_clover:     { type: 'mount', name: 'Clover the Pony',     rarity: 'common',   level: 1, speed: 0.25, price: 0,    sell: 15,
                           mount: { kind: 'pony', coat: '#b07a48', mane: '#f2e2c0', saddle: '#7a3b2a', trim: '#ffd76a' },
                           desc: "A round little pony who loves glowing moss and hates hurrying. She'll hurry for you, though." },
  mount_pony_dapple:     { type: 'mount', name: 'Dapplegrey Pony',     rarity: 'common',   level: 1, speed: 0.25, price: 150,  sell: 35,
                           mount: { kind: 'pony', coat: '#b8b8c0', mane: '#4a4a52', saddle: '#3f5a8a', trim: '#c9ced6' },
                           desc: 'Steady, patient and stubborn about apples.' },
  mount_horse_chestnut:  { type: 'mount', name: 'Chestnut Horse',      rarity: 'uncommon', level: 3, speed: 0.40, price: 500,  sell: 120,
                           mount: { kind: 'horse', coat: '#8a4a24', mane: '#3a2010', saddle: '#5a2f00', trim: '#e8c87a' },
                           desc: 'A proper riding horse from the Lanternmere stables. Forty percent faster than your own two feet.' },
  mount_horse_moonwhite: { type: 'mount', name: 'Moonwhite Horse',     rarity: 'uncommon', level: 4, speed: 0.40, price: 650,  sell: 155,
                           mount: { kind: 'horse', coat: '#ecebf2', mane: '#cfd8ff', saddle: '#4a3a8a', trim: '#ffd76a', gem: '#bfe6ff' },
                           desc: 'Its coat shines faintly under the moon. Aurelia rode one, once, very badly.' },
  mount_horse_midnight:  { type: 'mount', name: 'Midnight Courser',    rarity: 'rare',     level: 5, speed: 0.45, price: 1000, sell: 240,
                           mount: { kind: 'horse', coat: '#1e1a2a', mane: '#6a5aa8', saddle: '#2a1d4e', trim: '#c9ced6', gem: '#b48cff' },
                           desc: 'Bred from the swift night mares of the old Dawn Watch.' },
  mount_warhorse:        { type: 'mount', name: 'Lumen Warhorse',      rarity: 'epic',     level: 7, speed: 0.50, price: 1900, sell: 420,
                           mount: { kind: 'warhorse', coat: '#d8d0c0', mane: '#fff1b8', saddle: '#7a2a1a', trim: '#ffd76a', gem: '#fff6c8' },
                           desc: 'Barded in Spire gold. Hollis only sells these to wizards he trusts not to scratch them.' },
  mount_mossback:        { type: 'mount', name: 'Mossback',            rarity: 'rare',     level: 3, speed: 0.45, price: 0,    sell: 200,
                           mount: { kind: 'mossback', coat: '#5f8a2e', mane: '#9fe8a8', saddle: '#6a4a2a', trim: '#c9a23a', gem: '#9dff5a' },
                           desc: "A giant, very polite bog toad. Grubnak's royal steed, freed and grateful. Hops are bigger than they look." },
  mount_thornstag:       { type: 'mount', name: 'Thornstag',           rarity: 'epic',     level: 5, speed: 0.55, price: 0,    sell: 320,
                           mount: { kind: 'thornstag', coat: '#6a4a2a', mane: '#7fd88a', saddle: '#2f4024', trim: '#c8a26a', gem: '#7fffb0' },
                           desc: 'A forest stag with antlers of living briar. It only lets those who freed the Heartoak ride it.' },
  mount_emberhoof:       { type: 'mount', name: 'Emberhoof',           rarity: 'epic',     level: 7, speed: 0.55, price: 0,    sell: 360,
                           mount: { kind: 'emberhoof', coat: '#5a1a0c', mane: '#ff8a3d', saddle: '#2a1a14', trim: '#ffcf6a', gem: '#ffb347' },
                           desc: 'Born in the night Dawnhold burned. Its hooves leave little smouldering prints.' },
  mount_nightmare:       { type: 'mount', name: 'Nightmare of the Gloam', rarity: 'legendary', level: 9, speed: 0.60, price: 0, sell: 520,
                           mount: { kind: 'nightmare', coat: '#120c1e', mane: '#b06cff', saddle: '#2a1d4e', trim: '#ffd76a', gem: '#e8e0ff' },
                           desc: "Nyx's own steed, left behind at the Gloamgate. Its mane burns violet and it is terribly fond of you." }
};

// =====================================================================
//  GENERATED DROP CATALOGUE
//  Compact set table (still data): each row is one named set of 5 pieces
//  for one zone tier + rarity. Stats come from slot curves × tier level ×
//  rarity statMult (× school bias for school variants). Every piece has a
//  look: [name, style, color, color2, gem, fx].
//
//  Common stat budget for gear level L (before rarity), DROP_BASE = 0.92 of
//  the shop curve so a common drop is a little worse than the same-level
//  shop piece and an uncommon drop a little better:
//    hat    hp 14 + 12L,  dmg 0.75L
//    robe   hp 18 + 17L,  resist 0.95L
//    boots  hp 10 + 10L,  acc 0.75L, mana 0.5L
//    wand   dmg 2 + 1.15L, acc 0.45L
//    amulet hp 12 + 11L,  resist 0.3L, acc 0.3L
//  Uncommon+ add a secondary stat, epic+ a third (EXTRA below).
//  sell = round((4 + 3L) × rarity.sellMult)
// =====================================================================
(function () {
  var I = WF.data.items, R = WF.data.rarities, SLOTS = ['hat', 'robe', 'boots', 'wand', 'amulet'];
  var DROP_BASE = 0.92;
  var RAW_CURVE = {
    hat:    function (L) { return { hp: 14 + 12 * L, dmg: 0.75 * L }; },
    robe:   function (L) { return { hp: 18 + 17 * L, resist: 0.95 * L }; },
    boots:  function (L) { return { hp: 10 + 10 * L, acc: 0.75 * L, mana: 0.5 * L }; },
    wand:   function (L) { return { dmg: 2 + 1.15 * L, acc: 0.45 * L }; },
    amulet: function (L) { return { hp: 12 + 11 * L, resist: 0.3 * L, acc: 0.3 * L }; }
  };
  // ---- v1.2 WS2: above progression.levelScaling.from (L10) the curves follow
  // the PROJECTED level scaling (contract §6.4, docs/design/combat-and-
  // progression.md §17), a hard constraint for future levels: health x1.03 per
  // level; damage / resist / accuracy / mana grow like the projected common
  // set (the same points per level). The linear L1-10 lines would grow ~3x
  // faster and break "perfect gear at N >= bad gear at N+10". Levels 1-10
  // are unchanged.
  function lvlScale(st, L) {
    var LS = (WF.data.progression || {}).levelScaling;
    if (!LS || L <= LS.from) return st;
    var c10 = LS.gear('common', LS.from), cL = LS.gear('common', L), out = {};
    Object.keys(st).forEach(function (k) {
      out[k] = k === 'hp' ? st[k] * LS.levelMult(L) : c10[k] ? st[k] * cL[k] / c10[k] : st[k];
    });
    return out;
  }
  function capL(L) { var LS = (WF.data.progression || {}).levelScaling; return LS ? Math.min(L, LS.from) : L; }
  var CURVE = {};
  SLOTS.forEach(function (sl) { CURVE[sl] = function (L) { return lvlScale(RAW_CURVE[sl](capL(L)), L); }; });
  var EXTRA = {   // [stat, amount per level] — 1st from uncommon, 2nd from epic
    hat:    [['mana', 0.5], ['acc', 0.4]],
    robe:   [['mana', 0.45], ['dmg', 0.35]],
    boots:  [['dmg', 0.35], ['resist', 0.3]],
    wand:   [['hp', 3], ['mana', 0.4]],
    amulet: [['dmg', 0.45], ['mana', 0.45]]
  };
  var SCHOOL_BIAS = {
    stoneward:   { hp: 1.1, resist: 1.0, dmg: 1.0, mana: 1, acc: 1 },   // v2.0 M1: was hp 1.2 / resist 1.35 / dmg 0.7 (Stoneward won 98-100 % of boss duels)
    tidecaller:  { hp: 1.0, resist: 1, dmg: 0.95, mana: 1.6, acc: 1.3 },
    emberstrike: { hp: 0.85, resist: 0.6, dmg: 1.22, mana: 1, acc: 1 }
  };
  function genStats(slot, L, rarity, school) {
    var r = R[rarity], ord = r.order, base = RAW_CURVE[slot](capL(L)), out = {};
    EXTRA[slot].forEach(function (e, i) { if (ord >= (i === 0 ? 1 : 3)) base[e[0]] = (base[e[0]] || 0) + e[1] * capL(L); });
    base = lvlScale(base, L);              // v1.2 WS2: projected growth above L10 (identity up to L10)
    var bias = school ? SCHOOL_BIAS[school] : null;
    Object.keys(base).forEach(function (k) {
      var v = base[k] * DROP_BASE * r.statMult * (bias && bias[k] ? bias[k] : 1);
      v = Math.round(v);
      if (v < 1 && base[k] > 0) v = 1;
      if (v > 0) out[k] = v;
    });
    if (school === 'tidecaller' && !out.mana) out.mana = Math.max(1, Math.round(L * 0.4));
    return out;
  }
  function genSell(L, rarity) { return Math.round((4 + 3 * L) * R[rarity].sellMult); }
  function look(a) {
    var o = { style: a[1] };
    if (a[2]) o.color = a[2];
    if (a[3]) o.color2 = a[3];
    if (a[4]) o.gem = a[4];
    if (a[5]) o.fx = a[5];
    return o;
  }
  function add(id, slot, row, a, school) {
    var it = { type: 'gear', slot: slot, name: a[0], level: row.level, rarity: row.rarity, price: 0,
      sell: genSell(row.level, row.rarity), stats: genStats(slot, row.level, row.rarity, school), look: look(a),
      table: row.table, set: row.id };
    if (school) it.school = school;
    if (row.flavor) it.desc = row.flavor;
    I[id] = it;
    return it;
  }

  // Tier tables: mosslight (L1-3), whisperwood (L4-6), ashen (L7-8), gloam (L9-10)
  var SETS = [
    // ------------------------------------------------ MOSSLIGHT (L1-3)
    { id: 'bogwalker', table: 'mosslight', rarity: 'common', level: 1, flavor: 'Sensible bog-proof clothes. Smells faintly of toad.',
      p: { hat: ['Bogwalker Brim', 'wide', '#6f8a3a', '#d8c08a', '#9fe8a8'], robe: ['Bogwalker Robe', 'bell', '#6f8a3a', '#d8c08a'],
           boots: ['Bogwalker Boots', 'boots', '#5a4a2a', '#d8c08a'], wand: ['Reedwhistle Wand', 'branch', '#8a7040', '#d8c08a', '#9fe8a8'],
           amulet: ['Pebble Pendant', 'pendant', '#9a9080', null, '#9fe8a8'] } },
    { id: 'glowmoss', table: 'mosslight', rarity: 'uncommon', level: 2, flavor: 'Threaded with Moonmoss that glows when nobody is looking.',
      p: { hat: ['Glowmoss Cap', 'pointed', '#3f7a4a', '#b8f0a0', '#9fffb0'], robe: ['Glowmoss Shawl-Robe', 'layered', '#3f7a4a', '#b8f0a0', '#9fffb0'],
           boots: ['Glowmoss Slippers', 'curled', '#2f5a3a', '#b8f0a0'], wand: ['Mosslamp Wand', 'wand', '#5a4a2a', '#b8f0a0', '#9fffb0'],
           amulet: ['Glowmoss Locket', 'pendant', '#c9d8b0', '#7fae4b', '#9fffb0'] } },
    { id: 'fenwarden', table: 'mosslight', rarity: 'rare', level: 2, flavor: "Worn by Fennick's old order of bog wardens. Gerald approves.",
      p: { hat: ['Fenwarden Hood', 'hood', '#2f6f6a', '#e0c060', '#7fffd4'], robe: ['Fenwarden Mantle', 'mantle', '#2f6f6a', '#e0c060', '#7fffd4'],
           boots: ['Fenwarden Treads', 'boots', '#3a3a2a', '#e0c060', '#7fffd4'], wand: ['Fenwarden Crook', 'crook', '#6a5a3a', '#e0c060', '#7fffd4'],
           amulet: ['Fenwarden Medallion', 'medallion', '#e0c060', '#2f6f6a', '#7fffd4'] } },
    { id: 'moonpetal', table: 'mosslight', rarity: 'epic', level: 3, flavor: 'Petals of the moon-lily, pressed into cloth under a full moon.',
      p: { hat: ['Moonpetal Circlet', 'circlet', '#e8e0ff', '#8a7aff', '#c8b8ff', 'sparkle'], robe: ['Moonpetal Gown', 'long', '#d8d0ff', '#8a7aff', '#c8b8ff', 'sparkle'],
           boots: ['Moonpetal Steps', 'slippers', '#c8c0f0', '#8a7aff', '#c8b8ff'], wand: ['Moonpetal Scepter', 'scepter', '#e8e0ff', '#8a7aff', '#c8b8ff', 'sparkle'],
           amulet: ['Moonpetal Talisman', 'talisman', '#e8e0ff', '#8a7aff', '#c8b8ff', 'sparkle'] },
      v: { hat: { stoneward: ['Moonpetal Geode Helm', 'helm', '#a89070', '#e8e0ff', '#d4a25f', 'sparkle'],
                  tidecaller: ['Moonpetal Tide Hood', 'hood', '#5a8ac0', '#e8e0ff', '#4fc3e8', 'frost'],
                  emberstrike: ['Moonpetal Flame Circlet', 'circlet', '#e8c0a0', '#ff8a3d', '#ff6b3d', 'embers'] },
           wand: { stoneward: ['Moonpetal Geode Scepter', 'scepter', '#a89070', '#e8e0ff', '#d4a25f', 'sparkle'],
                   tidecaller: ['Moonpetal Tide Orb', 'orb', '#8ab8e0', '#e8e0ff', '#4fc3e8', 'frost'],
                   emberstrike: ['Moonpetal Flame Brand', 'blade', '#e8c0a0', '#ff8a3d', '#ff6b3d', 'embers'] } } },
    // ------------------------------------------------ WHISPERWOOD (L4-6)
    { id: 'thicketwalk', table: 'whisperwood', rarity: 'common', level: 4, flavor: 'Ranger cloth, dyed the colour of dusk under pines.',
      p: { hat: ['Thicketwalk Hat', 'pointed', '#3d6a5c', '#c8a26a', '#7fffb0'], robe: ['Thicketwalk Robe', 'bell', '#3d6a5c', '#c8a26a'],
           boots: ['Thicketwalk Boots', 'boots', '#4a3a2a', '#c8a26a'], wand: ['Pinecone Wand', 'wand', '#6a4a2a', '#c8a26a', '#7fffb0'],
           amulet: ['Acorn Charm', 'pendant', '#8a5a2b', '#c8a26a', '#7fffb0'] } },
    { id: 'duskthorn', table: 'whisperwood', rarity: 'uncommon', level: 4, flavor: 'Thorns on the outside, soft lining inside. Like Sela.',
      p: { hat: ['Duskthorn Cowl', 'cowl', '#4a3a6a', '#9fd88a', '#b48cff'], robe: ['Duskthorn Robe', 'battle', '#4a3a6a', '#9fd88a', '#b48cff'],
           boots: ['Duskthorn Greaves', 'greaves', '#3a2e4e', '#9fd88a'], wand: ['Duskthorn Branch', 'branch', '#4a3a2a', '#9fd88a', '#b48cff'],
           amulet: ['Duskthorn Seal', 'medallion', '#9fd88a', '#4a3a6a', '#b48cff'] } },
    { id: 'wolfsong', table: 'whisperwood', rarity: 'rare', level: 5, flavor: 'Woven to the rhythm of a wolf howl, the old, gentle kind.',
      p: { hat: ['Wolfsong Plumed Hat', 'feathered', '#5a5470', '#d8d0e8', '#9fd8ff', 'frost'], robe: ['Wolfsong Mantle', 'mantle', '#5a5470', '#d8d0e8', '#9fd8ff'],
           boots: ['Wolfsong Boots', 'boots', '#3a3448', '#d8d0e8', '#9fd8ff'], wand: ['Wolfsong Staff', 'staff', '#6a6080', '#d8d0e8', '#9fd8ff', 'frost'],
           amulet: ['Wolfsong Fang', 'talisman', '#e8e2cf', '#5a5470', '#9fd8ff'] } },
    { id: 'heartoak', table: 'whisperwood', rarity: 'epic', level: 5, flavor: 'Grown, not sewn: the Heartoak still sends out new leaves for those it trusts.',
      p: { hat: ['Heartoak Antler Crown', 'horned', '#6a4a2a', '#7fd88a', '#ffcf6a', 'leaves'], robe: ['Heartoak Raiment', 'layered', '#5a6a3a', '#7fd88a', '#ffcf6a', 'leaves'],
           boots: ['Heartoak Rootboots', 'greaves', '#5a3e24', '#7fd88a', '#ffcf6a'], wand: ['Heartoak Living Staff', 'branch', '#6a4a2a', '#7fd88a', '#ffcf6a', 'leaves'],
           amulet: ['Heartoak Amber', 'talisman', '#c98a2a', '#7fd88a', '#ffcf6a', 'leaves'] },
      v: { hat: { stoneward: ['Heartoak Stonebark Helm', 'helm', '#7a6a4a', '#7fd88a', '#d4a25f', 'leaves'],
                  tidecaller: ['Heartoak Dewleaf Hood', 'hood', '#3a6a6a', '#bdefff', '#4fc3e8', 'leaves'],
                  emberstrike: ['Heartoak Firebrand Antlers', 'horned', '#5a2e1c', '#ffcf6a', '#ff6b3d', 'embers'] },
           wand: { stoneward: ['Heartoak Bastion Root', 'scepter', '#5a3e24', '#d4a25f', '#d4a25f', 'leaves'],
                   tidecaller: ['Heartoak Dewdrop Staff', 'orb', '#6a5a3a', '#bdefff', '#4fc3e8', 'frost'],
                   emberstrike: ['Heartoak Kindlebough', 'branch', '#4a2a1a', '#ffcf6a', '#ff6b3d', 'embers'] } } },
    // ------------------------------------------------ ASHEN RUINS, OUTER (L7-8)
    { id: 'cinderwalk', table: 'ashen', rarity: 'common', level: 7, flavor: 'Ash-grey travelling clothes. The soot never quite washes out.',
      p: { hat: ['Cinderwalk Hat', 'pointed', '#6a4a44', '#d8a070', '#ff8a3d'], robe: ['Cinderwalk Robe', 'long', '#6a4a44', '#d8a070'],
           boots: ['Cinderwalk Boots', 'boots', '#3a2a24', '#d8a070'], wand: ['Charwood Wand', 'wand', '#2a2224', '#d8a070', '#ff8a3d'],
           amulet: ['Ember Bead', 'pendant', '#5a3a2a', null, '#ff8a3d'] } },
    { id: 'gravewatch', table: 'ashen', rarity: 'uncommon', level: 7, flavor: 'Old Dawn Watch kit, cleaned of Hollow ash and given back to the living.',
      p: { hat: ['Gravewatch Helm', 'helm', '#8a8fa8', '#e8e2cf', '#c8d0ff'], robe: ['Gravewatch Robe', 'armored', '#5a5f78', '#e8e2cf', '#c8d0ff'],
           boots: ['Gravewatch Greaves', 'greaves', '#8a8fa8', '#e8e2cf'], wand: ['Gravewatch Mace-Wand', 'scepter', '#8a8fa8', '#e8e2cf', '#c8d0ff'],
           amulet: ['Gravewatch Medal', 'medallion', '#c9ced6', '#5a5f78', '#c8d0ff'] } },
    { id: 'duskfire', table: 'ashen', rarity: 'rare', level: 7, flavor: 'Embroidered with sunset thread from the last evening before Dawnhold fell.',
      p: { hat: ['Duskfire Wide-Brim', 'wide', '#7a2a3a', '#ffb347', '#ff6b3d', 'embers'], robe: ['Duskfire Robe', 'layered', '#7a2a3a', '#ffb347', '#ff6b3d'],
           boots: ['Duskfire Slippers', 'curled', '#4a1a24', '#ffb347', '#ff6b3d'], wand: ['Duskfire Orbstaff', 'orb', '#3a1a1a', '#ffb347', '#ff6b3d', 'embers'],
           amulet: ['Duskfire Talisman', 'talisman', '#ffb347', '#7a2a3a', '#ff6b3d', 'embers'] } },
    { id: 'dawnhold', table: 'ashen', rarity: 'epic', level: 8, flavor: 'Paladin regalia of the Dawn Watch. Sir Aldric salutes whenever he sees it.',
      p: { hat: ['Dawnhold Paladin Helm', 'helm', '#f2f2f2', '#ffd76a', '#fff6c8', 'radiant'], robe: ['Dawnhold Plate-Robe', 'armored', '#f2f2f2', '#ffd76a', '#fff6c8', 'radiant'],
           boots: ['Dawnhold Greaves', 'greaves', '#e8e8e8', '#ffd76a', '#fff6c8'], wand: ['Dawnhold Blade-Wand', 'blade', '#f2f2f2', '#ffd76a', '#fff6c8', 'radiant'],
           amulet: ['Dawnhold Oath Medallion', 'medallion', '#ffd76a', '#f2f2f2', '#fff6c8', 'radiant'] },
      v: { hat: { stoneward: ['Dawnhold Bulwark Helm', 'helm', '#d8d0c0', '#d4a25f', '#d4a25f', 'radiant'],
                  tidecaller: ['Dawnhold Seawatch Hood', 'hood', '#d8e8f2', '#4fc3e8', '#bdefff', 'frost'],
                  emberstrike: ['Dawnhold Sunflare Crown', 'crown', '#ffe0b0', '#ff8a3d', '#ff6b3d', 'embers'] },
           wand: { stoneward: ['Dawnhold Bastion Mace', 'scepter', '#d8d0c0', '#d4a25f', '#d4a25f', 'radiant'],
                   tidecaller: ['Dawnhold Tideblade', 'blade', '#d8e8f2', '#4fc3e8', '#bdefff', 'frost'],
                   emberstrike: ['Dawnhold Sunbrand', 'blade', '#ffe0b0', '#ff8a3d', '#ff6b3d', 'embers'] } } },
    // ------------------------------------------------ ASHEN RUINS, GLOAMGATE (L9-10)
    { id: 'gloamguard', table: 'gloam', rarity: 'common', level: 9, flavor: 'Plain violet robes from the outpost stores. Warm, at least.',
      p: { hat: ['Gloamguard Hat', 'pointed', '#4a3a5a', '#b8a0d8', '#b06cff'], robe: ['Gloamguard Robe', 'bell', '#4a3a5a', '#b8a0d8'],
           boots: ['Gloamguard Boots', 'boots', '#2e2438', '#b8a0d8'], wand: ['Gloamguard Staff', 'staff', '#3a2e44', '#b8a0d8', '#b06cff'],
           amulet: ['Gloamguard Charm', 'pendant', '#b8a0d8', null, '#b06cff'] } },
    { id: 'ashveil', table: 'gloam', rarity: 'uncommon', level: 9, flavor: 'A veil against the ash wind. Hollow Acolytes used to wear these. Now you do.',
      p: { hat: ['Ashveil Cowl', 'cowl', '#3a2a3a', '#ff9a5a', '#ff7a3d'], robe: ['Ashveil Robe', 'long', '#3a2a3a', '#ff9a5a', '#ff7a3d'],
           boots: ['Ashveil Treads', 'boots', '#2a1e2a', '#ff9a5a'], wand: ['Ashveil Crook', 'crook', '#3a2a2a', '#ff9a5a', '#ff7a3d'],
           amulet: ['Ashveil Seal', 'medallion', '#ff9a5a', '#3a2a3a', '#ff7a3d'] } },
    { id: 'starfall', table: 'gloam', rarity: 'rare', level: 9, flavor: 'Stitched with real starlight, caught falling over the Gloamgate.',
      p: { hat: ['Starfall Tall Hat', 'tall', '#1e2a5a', '#ffe9a0', '#9fd8ff', 'sparkle'], robe: ['Starfall Robe', 'layered', '#1e2a5a', '#ffe9a0', '#9fd8ff', 'sparkle'],
           boots: ['Starfall Slippers', 'curled', '#141c40', '#ffe9a0', '#9fd8ff'], wand: ['Starfall Orb', 'orb', '#1e2a5a', '#ffe9a0', '#9fd8ff', 'sparkle'],
           amulet: ['Starfall Pendant', 'pendant', '#ffe9a0', '#1e2a5a', '#9fd8ff', 'sparkle'] } },
    { id: 'eclipsebane', table: 'gloam', rarity: 'epic', level: 10, flavor: 'Forged by the Lumen Order for one purpose: to stand in front of the dark and not blink.',
      p: { hat: ['Eclipsebane Crown', 'crown', '#2a1d4e', '#ffd76a', '#ffb347', 'radiant'], robe: ['Eclipsebane Mantle', 'mantle', '#2a1d4e', '#ffd76a', '#ffb347', 'radiant'],
           boots: ['Eclipsebane Greaves', 'greaves', '#1e1438', '#ffd76a', '#ffb347'], wand: ['Eclipsebane Scepter', 'scepter', '#2a1d4e', '#ffd76a', '#ffb347', 'radiant'],
           amulet: ['Eclipsebane Talisman', 'talisman', '#ffd76a', '#2a1d4e', '#ffb347', 'radiant'] },
      v: { hat: { stoneward: ['Eclipsebane Bastion Helm', 'helm', '#3a2e44', '#d4a25f', '#d4a25f', 'radiant'],
                  tidecaller: ['Eclipsebane Moontide Hood', 'hood', '#1e2a4e', '#bdefff', '#4fc3e8', 'frost'],
                  emberstrike: ['Eclipsebane Pyre Crown', 'horned', '#3a1424', '#ffcf6a', '#ff6b3d', 'embers'] },
           wand: { stoneward: ['Eclipsebane Bastion Scepter', 'scepter', '#3a2e44', '#d4a25f', '#d4a25f', 'radiant'],
                   tidecaller: ['Eclipsebane Moontide Orb', 'orb', '#1e2a4e', '#bdefff', '#4fc3e8', 'frost'],
                   emberstrike: ['Eclipsebane Pyre Blade', 'blade', '#3a1424', '#ffcf6a', '#ff6b3d', 'embers'] } } }
  ];

  // Unique legendaries (boss drops; very rarely from that tier's elites).
  // [id, slot, name, level, table, look, desc, statsOverride?]
  var LEGENDS = [
    // Grubnak (Mosslight)
    ['leg_golden_feather_crown', 'hat',  'Crown of the Golden Feather', 3, 'mosslight', ['', 'feathered', '#ffcf3a', '#7fae4b', '#9dff5a', 'radiant'], "The feather that told Grubnak he was king. It tells you that you're wonderful, which is nicer."],
    ['leg_bog_throne_sceptre',   'wand', 'Sceptre of the Bog Throne',   3, 'mosslight', ['', 'scepter', '#c9a23a', '#5f8a2e', '#9dff5a', 'leaves'], 'Topped with a frog-shaped emerald. It croaks, very quietly, when you cast.'],
    ['leg_mirelord_cloak',       'robe', "Mirelord's Cloak",            3, 'mosslight', ['', 'mantle', '#3f5a35', '#c9a23a', '#9dff5a', 'leaves'], 'Royal bog-silk. Water runs off it like it is embarrassed to be there.'],
    // Thornmaw (Whisperwood)
    ['leg_briar_crown',          'hat',  "Thornmaw's Briar Crown",      6, 'whisperwood', ['', 'horned', '#5a4630', '#9dff5a', '#ffcf6a', 'leaves'], 'Antlers of briar that bloom in spring. The Heartoak grew it while it slept, dreaming of you.'],
    ['leg_waking_wood_mantle',   'robe', 'Mantle of the Waking Wood',   6, 'whisperwood', ['', 'mantle', '#4a6a3a', '#ffcf6a', '#9dff5a', 'leaves'], 'Leaves drift from its hem as you walk and turn to light before they land.'],
    ['leg_first_oak_bough',      'wand', 'Bough of the First Oak',      6, 'whisperwood', ['', 'branch', '#5a3e24', '#9dff5a', '#ffcf6a', 'leaves'], 'Older than Lanternmere. It still grows a new leaf every time you win.'],
    // Captain Vex (Ashen, Gloamgate approach)
    ['leg_fallen_captain_helm',  'hat',   'Helm of the Fallen Captain',  9, 'gloam', ['', 'helm', '#4a4f68', '#ffd76a', '#c78bff', 'shadow'], "Vex's helm, scrubbed of the Hollow. Aldric says the plume is new. He sewed it on himself."],
    ['leg_oathbound_warplate',   'robe',  'Oathbound Warplate',          9, 'gloam', ['', 'armored', '#5a5f78', '#ffd76a', '#c78bff', 'radiant'], 'The plate of a captain who broke his oath, reforged for one who keeps theirs.'],
    ['leg_watch_spurs',          'boots', 'Gilded Spurs of the Watch',   9, 'gloam', ['', 'greaves', '#e8c87a', '#ffffff', '#fff6c8', 'radiant'], 'They jingle. The Hollow hates the jingle.'],
    // Nyx (Ashen, the Gloamgate)
    ['leg_starless_night_crown', 'hat',    'Crown of the Starless Night', 10, 'gloam', ['', 'horned', '#120c1e', '#b06cff', '#e8e0ff', 'shadow'], 'Darkness that has decided to be on your side. Try not to make it change its mind.'],
    ['leg_eclipse_regalia',      'robe',   'Eclipse Regalia',             10, 'gloam', ['', 'mantle', '#1a1030', '#ffd76a', '#b06cff', 'shadow'], "Nyx's court robes. When you stand in the sun the eclipse on the back slowly turns to dawn."],
    ['leg_herald_night_quill',   'wand',   "Herald's Night-Quill",        10, 'gloam', ['', 'wand', '#120c1e', '#b06cff', '#e8e0ff', 'shadow'], 'Nyx wrote her decrees with it. It writes far nicer things for you.'],
    ['leg_heart_of_eclipse',     'amulet', 'Heart of the Eclipse',        10, 'gloam', ['', 'talisman', '#2a1d4e', '#ffd76a', '#ffffff', 'radiant'], 'A sliver of the eclipse, caught at the exact moment the light came back.']
  ];

  var TABLES = WF.data.lootTables = {
    // levels: the enemy levels that roll on this table (enemy loot.table overrides).
    mosslight:   { name: 'Mosslight Path', levels: [1, 3],  items: [], legendary: [] },
    whisperwood: { name: 'Whisperwood',    levels: [4, 6],  items: [], legendary: [] },
    ashen:       { name: 'Ashen Ruins',    levels: [7, 8],  items: [], legendary: [] },
    gloam:       { name: 'The Gloamgate',  levels: [9, 10], items: [], legendary: [] }
  };

  SETS.forEach(function (row) {
    SLOTS.forEach(function (slot) {
      var id = row.id + '_' + slot, a = row.p[slot];
      var base = add(id, slot, row, a);
      TABLES[row.table].items.push(id);
      var vs = row.v && row.v[slot];
      if (vs) {
        base.variants = {};
        Object.keys(vs).forEach(function (sch) {
          var vid = id + '_' + sch;
          add(vid, slot, row, vs[sch], sch);
          base.variants[sch] = vid;
        });
      }
    });
  });
  LEGENDS.forEach(function (l) {
    var it = add(l[0], l[1], { level: l[3], rarity: 'legendary', table: l[4] }, l[5]);
    it.name = l[2]; it.desc = l[6]; it.unique = true;
    TABLES[l[4]].legendary.push(l[0]);
  });
  // Hand-made drops join their tier's pool too
  TABLES.mosslight.items.push('mossy_charm');
  TABLES.whisperwood.items.push('wolfhide_boots');
  TABLES.ashen.items.push('ashen_wand', 'knight_amulet');

  // Sell prices of every non-shop gear piece follow the same formula, so
  // loot gold is predictable (economy: docs/design/combat-and-progression.md §9).
  Object.keys(I).forEach(function (id) {
    var it = I[id];
    if (it.type === 'gear' && !(it.price > 0)) it.sell = genSell(it.level || 1, it.rarity || 'common');
  });
  WF.data.gearGen = { genStats: genStats, genSell: genSell, CURVE: CURVE, DROP_BASE: DROP_BASE };
})();

// =====================================================================
//  LOOT RULES (used by WF.state.rollLoot; tuned with tests/balance-sim.js)
//
//  Each defeated enemy rolls ONE gear chance (bosses: one guaranteed piece):
//    kind   = boss | elite | mob   (enemy `boss` / `elite` flags)
//    chance = gearChance[kind]  (enemy loot.gearChance overrides; minions 0)
//    rarity = weighted pick from rarityWeights(kind, enemyLevel), never
//             below minRarity[kind]
//    item   = random slot, then a random item of that rarity from the
//             enemy's table (loot.table, else the table whose `levels`
//             contain the enemy level). Legendary picks come from the
//             boss's loot.legendary list (else the table's legendaries);
//             if a pool is empty the rarity steps down one tier.
//    school variants swap to the player's school.
//  Bosses also keep their hand-placed signature drops (enemies.js loot.gear)
//  and rare mount drops (loot.mounts).
// =====================================================================
WF.data.lootRules = {
  gearChance: { mob: 0.30, elite: 0.75, boss: 1.0 },
  minRarity: { boss: 'rare' },
  // Weights at enemy level L (normalised; sums are ~100 for mobs).
  //   mob   : common 62-2L, uncommon 27+L, rare 9+0.7L, epic 2+0.3L, legendary 0
  //   elite : common 18,    uncommon 38,   rare 30+L,   epic 9+0.8L,  legendary 1+0.15L
  //   boss  : rare 60-1.5L, epic 30+L, legendary 10+0.5L     (common/uncommon 0)
  rarityWeights: function (kind, L) {
    L = Math.max(1, L || 1);
    if (kind === 'boss') return { common: 0, uncommon: 0, rare: Math.max(20, 60 - 1.5 * L), epic: 30 + L, legendary: 10 + 0.5 * L };
    if (kind === 'elite') return { common: 18, uncommon: 38, rare: 30 + L, epic: 9 + 0.8 * L, legendary: 1 + 0.15 * L };
    return { common: Math.max(10, 62 - 2 * L), uncommon: 27 + L, rare: 9 + 0.7 * L, epic: 2 + 0.3 * L, legendary: 0 };
  }
};

Object.keys(WF.data.items).forEach(function (id) { WF.data.items[id].id = id; });

WF.data.gearSlots = ['hat', 'robe', 'boots', 'wand', 'amulet'];
