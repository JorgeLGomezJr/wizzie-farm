// =====================================================================
//  WIZZIE FARM — SPELL CARDS
//
//  To add a new spell, add an entry below. Fields:
//    name, school, level (unlock level for that school's wizards; v2.0:
//          school spells only at schools.js spellCadence = L1, 3, 5, 7, 8, 10),
//    pips (cost; also costs that much mana), acc (accuracy %),
//    type:
//      'damage'  min/max            single enemy   (optional drain: 0.5 = heal 50% of dmg)
//      'aoe'     min/max            all enemies
//      'dot'     min/max + dot:{amt,rounds}   instant hit + burn each round
//      'heal'    value              heal self (or lowest ally for enemies)
//      'hot'     value + hot:{amt,rounds}     instant heal + heal each round
//      'blade'   value (+% next damage spell of `affects` school)  on caster
//      'trap'    value (+% next damage taken of `affects` school)  on target
//      'shield'  value (-% next damage taken)                       on caster
//      'weakness'value (-% next damage dealt)                       on target
//      'absorb'  value (soaks this much damage)                     on caster
//    affects: school id or 'any' (for blades / traps / shields / weakness)
//    copies:  how many copies get auto-added to your deck when learned
//    trainable: true -> wizards of OTHER schools may learn it for 1 training
//             point at this school's trainer (progression.trainingPoints)
//    source:  'quest' (Lumen gifts) | 'enemy' (Hollow spells) — these keep
//             `level: 99` so they are never learned by levelling up
//    fx:      optional animation hint 'bolt'|'meteor'|'spike'|'wave'|'beam'|'swarm'
//
//  Blades/traps/shields with DIFFERENT names stack; the same name does not
//  stack on itself (same rule as the classic card-duel games). So a school
//  blade + Lumen Blade + a school trap + Dawn Trap all multiply together.
//  Burns (dot) snapshot those multipliers into every tick.
//
//  BALANCE NOTES (see docs/design/combat-and-progression.md):
//   * Damage per pip rises with cost: ~100/pip at 1 pip, ~110 at 2,
//     ~118 at 3, ~125 at 4, ~135 at 5 (single target). AoE ~80/pip/target.
//   * DECK BUDGET: the deck holds progression.deckMax(level) cards (30 up
//     to L10, +2 per level after). Each school's copies add up to 20, the
//     five Lumen quest cards to 6, and trainable spells have <= 2 copies,
//     so EVERY own spell + all Lumen gifts + two trained spells fit at L10.
//     For levels 11+ deckMax grows by 2 per level: give each new spell
//     copies <= 2. tests/balance-sim.js --check verifies the budget.
// =====================================================================
WF.data.cards = {
  // ---------------- STONEWARD (tank) — accurate, shields/absorbs, slow but sure ----------------
  pebble_strike: { name: 'Pebble Strike', school: 'stoneward', level: 1, pips: 1, acc: 92, type: 'damage', min: 80, max: 120, copies: 9, cine: 'pebble_golem' },
  stone_skin:    { name: 'Stone Skin',    school: 'stoneward', level: 1, pips: 0, acc: 100, type: 'shield', value: 30, affects: 'any', copies: 6, trainable: true },
  bulwark:       { name: 'Bulwark',       school: 'stoneward', level: 1, pips: 1, acc: 100, type: 'absorb', value: 180, copies: 6, trainable: true },
  mudslide:      { name: 'Mudslide',      school: 'stoneward', level: 3, pips: 2, acc: 92, type: 'damage', min: 210, max: 270, copies: 6, cine: 'stone_boar' },
  granite_blade: { name: 'Granite Blade', school: 'stoneward', level: 5, pips: 0, acc: 100, type: 'blade', value: 35, affects: 'stoneward', copies: 6 },
  golem_fist:    { name: 'Golem Fist',    school: 'stoneward', level: 5, pips: 3, acc: 90, type: 'damage', min: 400, max: 480, copies: 6, cine: 'golem_fist' },
  earthen_mend:  { name: 'Earthen Mend',  school: 'stoneward', level: 5, pips: 2, acc: 100, type: 'heal', value: 260, copies: 6 },
  quake:         { name: 'Quake',         school: 'stoneward', level: 7, pips: 4, acc: 88, type: 'aoe', min: 350, max: 430, copies: 3, cine: 'quake_ram' },
  fortify:       { name: 'Fortify',       school: 'stoneward', level: 8, pips: 2, acc: 100, type: 'absorb', value: 420, copies: 3 },
  crag_trap:     { name: 'Crag Trap',     school: 'stoneward', level: 8, pips: 0, acc: 100, type: 'trap', value: 40, affects: 'stoneward', copies: 3 },
  titans_wrath:  { name: "Titan's Wrath", school: 'stoneward', level: 10, pips: 5, acc: 90, type: 'damage', min: 860, max: 980, copies: 6, cine: 'titan' },

  // ---------------- TIDECALLER (balanced) — heals, drains, a bit of everything ----------------
  ripple:        { name: 'Ripple',        school: 'tidecaller', level: 1, pips: 1, acc: 88, type: 'damage', min: 80, max: 120, copies: 12, cine: 'water_sprite' },
  soothing_mist: { name: 'Soothing Mist', school: 'tidecaller', level: 1, pips: 1, acc: 100, type: 'heal', value: 120, copies: 6, trainable: true },
  tide_blade:    { name: 'Tide Blade',    school: 'tidecaller', level: 1, pips: 0, acc: 100, type: 'blade', value: 30, affects: 'tidecaller', copies: 6 },
  mist_veil:     { name: 'Mist Veil',     school: 'tidecaller', level: 3, pips: 0, acc: 100, type: 'shield', value: 30, affects: 'any', copies: 3, trainable: true },
  undertow:      { name: 'Undertow',      school: 'tidecaller', level: 3, pips: 2, acc: 88, type: 'damage', min: 190, max: 250, drain: 0.4, copies: 6, cine: 'undertow' },
  wellspring:    { name: 'Wellspring',    school: 'tidecaller', level: 5, pips: 2, acc: 100, type: 'hot', value: 100, hot: { amt: 60, rounds: 3 }, copies: 3 },
  wave_serpent:  { name: 'Wave Serpent',  school: 'tidecaller', level: 5, pips: 3, acc: 88, type: 'damage', min: 360, max: 440, copies: 6, cine: 'wave_serpent' },
  riptide_trap:  { name: 'Riptide Trap',  school: 'tidecaller', level: 5, pips: 0, acc: 100, type: 'trap', value: 30, affects: 'tidecaller', copies: 3 },
  healing_rain:  { name: 'Healing Rain',  school: 'tidecaller', level: 7, pips: 3, acc: 100, type: 'heal', value: 450, copies: 3, cine: 'heal_rain' },
  maelstrom:     { name: 'Maelstrom',     school: 'tidecaller', level: 8, pips: 4, acc: 86, type: 'aoe', min: 320, max: 400, copies: 3, cine: 'maelstrom' },
  moon_tide:     { name: 'Moon Tide',     school: 'tidecaller', level: 8, pips: 3, acc: 88, type: 'damage', min: 400, max: 480, drain: 0.5, copies: 3, cine: 'moon_tide' },
  leviathan:     { name: 'Leviathan',     school: 'tidecaller', level: 10, pips: 5, acc: 88, type: 'damage', min: 760, max: 880, drain: 0.35, copies: 6, cine: 'leviathan' },

  // ---------------- EMBERSTRIKE (damage) — biggest hits, burns, AoE; no school heals ----------------
  spark_bolt:    { name: 'Spark Bolt',    school: 'emberstrike', level: 1, pips: 1, acc: 82, type: 'damage', min: 75, max: 110, copies: 9, cine: 'spark_newt' },
  fire_sprite:   { name: 'Ember Moth',    school: 'emberstrike', level: 1, pips: 1, acc: 84, type: 'dot', min: 40, max: 50, dot: { amt: 45, rounds: 3 }, copies: 6, trainable: true, fx: 'swarm', cine: 'ember_moth' },
  flame_blade:   { name: 'Flame Blade',   school: 'emberstrike', level: 1, pips: 0, acc: 100, type: 'blade', value: 35, affects: 'emberstrike', copies: 6 },
  ember_ward:    { name: 'Ember Ward',    school: 'emberstrike', level: 3, pips: 1, acc: 100, type: 'absorb', value: 150, copies: 6, trainable: true },
  fireball:      { name: 'Fireball',      school: 'emberstrike', level: 3, pips: 2, acc: 82, type: 'damage', min: 220, max: 290, copies: 6, cine: 'fireball' },
  scorch_trap:   { name: 'Scorch Trap',   school: 'emberstrike', level: 5, pips: 0, acc: 100, type: 'trap', value: 30, affects: 'emberstrike', copies: 3 },
  storm_hawk:    { name: 'Gale Hawk',     school: 'emberstrike', level: 5, pips: 3, acc: 80, type: 'damage', min: 400, max: 500, copies: 6, cine: 'gale_hawk' },
  wildfire:      { name: 'Wildfire',      school: 'emberstrike', level: 5, pips: 3, acc: 82, type: 'dot', min: 170, max: 200, dot: { amt: 130, rounds: 3 }, copies: 3, cine: 'blaze_fox' },
  firestorm:     { name: 'Firestorm',     school: 'emberstrike', level: 7, pips: 4, acc: 80, type: 'aoe', min: 350, max: 430, copies: 3, cine: 'firestorm' },
  inferno_blade: { name: 'Inferno Blade', school: 'emberstrike', level: 8, pips: 1, acc: 100, type: 'blade', value: 50, affects: 'emberstrike', copies: 3 },
  thunder_drake: { name: 'Skyrend Drake', school: 'emberstrike', level: 8, pips: 4, acc: 80, type: 'damage', min: 600, max: 720, copies: 6, cine: 'skyrend_drake' },
  phoenix_rage:  { name: 'Phoenix Rage',  school: 'emberstrike', level: 10, pips: 5, acc: 80, type: 'damage', min: 860, max: 1020, copies: 3, cine: 'phoenix' },

  // ---------------- LUMEN (universal, earned from quests) ----------------
  // Quest rewards: lumen_mend m01, lumen_blade m05, lumen_ward s03, sunburst m10, dawn_trap m14.
  lumen_mend:    { name: 'Lumen Mend',    school: 'lumen', level: 99, source: 'quest', pips: 1, acc: 100, type: 'heal', value: 170, copies: 6 },
  lumen_blade:   { name: 'Lumen Blade',   school: 'lumen', level: 99, source: 'quest', pips: 0, acc: 100, type: 'blade', value: 20, affects: 'any', copies: 3 },
  lumen_ward:    { name: 'Lumen Ward',    school: 'lumen', level: 99, source: 'quest', pips: 0, acc: 100, type: 'shield', value: 35, affects: 'any', copies: 3 },
  sunburst:      { name: 'Sunburst',      school: 'lumen', level: 99, source: 'quest', pips: 2, acc: 95, type: 'aoe', min: 140, max: 180, copies: 3, cine: 'sunburst' },
  dawn_trap:     { name: 'Dawn Trap',     school: 'lumen', level: 99, source: 'quest', pips: 0, acc: 100, type: 'trap', value: 25, affects: 'any', copies: 3 },

  // ---------------- HOLLOW (enemy spells) ----------------
  // Enemies have no mana. Their power per level comes from enemies.js `dmg`.
  shadow_nip:    { name: 'Shadow Nip',    school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 85, type: 'damage', min: 45, max: 75, cine: 'shadow_jaws' },
  gloom_bolt:    { name: 'Gloom Bolt',    school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 85, type: 'damage', min: 110, max: 160, cine: 'gloom_wisp' },
  dark_blade:    { name: 'Dark Blade',    school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'blade', value: 25, affects: 'hollow' },
  hex_trap:      { name: 'Hex Trap',      school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'trap', value: 25, affects: 'hollow' },
  sap_weakness:  { name: 'Sap Weakness',  school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 90, type: 'weakness', value: 25, affects: 'any' },
  shadow_shield: { name: 'Shadow Shield', school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'shield', value: 30, affects: 'any' },
  dark_mend:     { name: 'Dark Mend',     school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 100, type: 'heal', value: 180},
  bog_spit:      { name: 'Bog Spit',      school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 85, type: 'dot', min: 15, max: 25, dot: { amt: 18, rounds: 3 }, cine: 'bog_spit' },
  dread_wave:    { name: 'Dread Wave',    school: 'hollow', level: 99, source: 'enemy', pips: 3, acc: 85, type: 'damage', min: 210, max: 270, cine: 'dread_wave' },
  bone_crush:    { name: 'Bone Crush',    school: 'hollow', level: 99, source: 'enemy', pips: 4, acc: 85, type: 'damage', min: 320, max: 390, cine: 'bone_hand' },
  rot_bloom:     { name: 'Rot Bloom',     school: 'hollow', level: 99, source: 'enemy', pips: 3, acc: 85, type: 'dot', min: 110, max: 140, dot: { amt: 55, rounds: 3 }, cine: 'rot_bloom' },
  hollow_drain:  { name: 'Hollow Drain',  school: 'hollow', level: 99, source: 'enemy', pips: 3, acc: 85, type: 'damage', min: 200, max: 250, drain: 0.5, cine: 'hollow_drain' },
  night_terror:  { name: 'Night Terror',  school: 'hollow', level: 99, source: 'enemy', pips: 5, acc: 88, type: 'damage', min: 440, max: 540, cine: 'night_terror' },
  eclipse:       { name: 'Eclipse',       school: 'hollow', level: 99, source: 'enemy', pips: 6, acc: 90, type: 'damage', min: 520, max: 620, cine: 'eclipse' },

  // ---- Boss signature spells (enemy only) ----
  // Grubnak, the Bog King (L3)
  bog_belch:     { name: 'Bog Belch',     school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 85, type: 'aoe', min: 150, max: 190, cine: 'bog_belch' },
  royal_croak:   { name: 'Royal Croak',   school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'blade', value: 30, affects: 'hollow', cine: 'blade_croak' },
  // Thornmaw, the Rotted Heartoak (L6)
  root_snare:    { name: 'Root Snare',    school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 90, type: 'weakness', value: 30, affects: 'any', cine: 'weak_roots' },
  thorn_lash:    { name: 'Thorn Lash',    school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 88, type: 'damage', min: 140, max: 180, cine: 'thorn_lash' },
  // Captain Vex (L9)
  captains_cleave: { name: "Captain's Cleave", school: 'hollow', level: 99, source: 'enemy', pips: 4, acc: 88, type: 'damage', min: 360, max: 440, cine: 'captains_cleave' },
  rending_slash: { name: 'Rending Slash', school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 88, type: 'dot', min: 80, max: 100, dot: { amt: 55, rounds: 3 }, cine: 'rending_slash' },
  war_cry:       { name: 'War Cry',       school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'blade', value: 30, affects: 'hollow', cine: 'blade_warcry' },
  iron_guard:    { name: 'Iron Guard',    school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 100, type: 'absorb', value: 300 },
  // Nyx, Herald of the Hollow King (L10, final boss)
  umbral_veil:   { name: 'Umbral Veil',   school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'shield', value: 25, affects: 'any' },
  void_trap:     { name: 'Void Trap',     school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'trap', value: 30, affects: 'hollow' },
  // Boss phase spells (cast for free when a phase triggers, see enemies.js `phases`)
  heartwood_bark: { name: 'Heartwood Bark', school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 100, type: 'absorb', value: 250 },
  umbral_aegis:  { name: 'Umbral Aegis',  school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 100, type: 'absorb', value: 250 },
  quill_storm:   { name: 'Quill Storm',   school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 88, type: 'dot', min: 90, max: 120, dot: { amt: 60, rounds: 3 }, cine: 'quill_storm' }
};

// Fill in each card's id field automatically.
Object.keys(WF.data.cards).forEach(function (id) { WF.data.cards[id].id = id; });

// ---- v1.2 WS4: The Hollow Orrery — dungeon enemy spells (enemy only) ----
// Signature spells of the level-10 dungeon (game/data/enemies_dungeon.js).
// `cineAs` borrows an existing cinematic until WS1 builds dedicated ones
// (cine.js: card.cine || cineAs || school default). Every one is Hollow, so a
// bright pip pays 2 for all of them. Numbers are tuned by tests/dungeon-sim.js.
(function (C) {
  var ADD = {
    // Shard Hound (mob)
    prism_fang:         { name: 'Prism Fang',         school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 88, type: 'damage', min: 75, max: 105, cineAs: 'shadow_jaws' },
    splinter_rake:      { name: 'Splinter Rake',      school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 86, type: 'dot', min: 80, max: 100, dot: { amt: 40, rounds: 3 }, cineAs: 'rending_slash' },
    // Orrery Seer (mob, healer)
    lens_flare:         { name: 'Lens Flare',         school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 86, type: 'damage', min: 140, max: 180, cineAs: 'gloom_wisp' },
    ill_omen:           { name: 'Ill Omen',           school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 90, type: 'weakness', value: 25, affects: 'any', cineAs: 'weak_any' },
    starlit_mend:       { name: 'Starlit Mend',       school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 100, type: 'heal', value: 200, cineAs: 'hot_any' },
    // Orrery Sentinel (boss, room 1)
    orbit_crush:        { name: 'Orbit Crush',        school: 'hollow', level: 99, source: 'enemy', pips: 4, acc: 88, type: 'damage', min: 370, max: 450, cineAs: 'golem_fist' },
    stone_volley:       { name: 'Stone Volley',       school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 88, type: 'damage', min: 150, max: 190, cineAs: 'pebble_golem' },
    lodestone_snare:    { name: 'Lodestone Snare',    school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'trap', value: 25, affects: 'hollow', cineAs: 'trap_any' },
    orbit_ward:         { name: 'Orbit Ward',         school: 'hollow', level: 99, source: 'enemy', pips: 1, acc: 100, type: 'absorb', value: 300, cineAs: 'absorb_any' },
    overclock:          { name: 'Overclock',          school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'blade', value: 35, affects: 'hollow', cineAs: 'blade_warcry' },
    // Warden Morrow (boss, room 2)
    dusk_lantern:       { name: 'Dusk Lantern',       school: 'hollow', level: 99, source: 'enemy', pips: 5, acc: 88, type: 'damage', min: 470, max: 570, cineAs: 'sunburst' },
    broken_oath:        { name: 'Broken Oath',        school: 'hollow', level: 99, source: 'enemy', pips: 3, acc: 88, type: 'damage', min: 250, max: 310, cineAs: 'captains_cleave' },
    grave_vigil:        { name: 'Grave Vigil',        school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 88, type: 'dot', min: 90, max: 110, dot: { amt: 50, rounds: 3 }, cineAs: 'rot_bloom' },
    wardens_vow:        { name: "Warden's Vow",       school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'shield', value: 25, affects: 'any', cineAs: 'shield_any' },
    dimming_snare:      { name: 'Dimming Snare',      school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'trap', value: 30, affects: 'hollow', cineAs: 'trap_any' },
    last_lantern:       { name: 'Last Lantern',       school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 100, type: 'absorb', value: 350, cineAs: 'absorb_any' },
    // The Starless Archon (final boss, room 3)
    starless_collapse:  { name: 'Starless Collapse',  school: 'hollow', level: 99, source: 'enemy', pips: 6, acc: 90, type: 'damage', min: 540, max: 640, cineAs: 'eclipse' },
    black_planet:       { name: 'Black Planet',       school: 'hollow', level: 99, source: 'enemy', pips: 3, acc: 88, type: 'dot', min: 140, max: 170, dot: { amt: 60, rounds: 3 }, cineAs: 'night_terror' },
    void_constellation: { name: 'Void Constellation', school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'trap', value: 25, affects: 'hollow', cineAs: 'trap_any' },
    starless_veil:      { name: 'Starless Veil',      school: 'hollow', level: 99, source: 'enemy', pips: 2, acc: 100, type: 'absorb', value: 350, cineAs: 'absorb_any' },
    nadir_mantle:       { name: 'Nadir Mantle',       school: 'hollow', level: 99, source: 'enemy', pips: 0, acc: 100, type: 'shield', value: 25, affects: 'any', cineAs: 'shield_any' }
  };
  Object.keys(ADD).forEach(function (id) { ADD[id].id = id; C[id] = ADD[id]; });
})(WF.data.cards);

// ---- v1.2 WS4: boss-earned spells (V1.2-CONTRACT §8) ----
// Never trained, never learned by levelling (`source: 'boss'`, level 99). The Starless
// Archon's first clear (quest d01, rewards.cardsBySchool) teaches the wizard's school
// spell. A dungeon tier's FIRST boss spells are area attacks (docs/HOW-TO-ADD-LEVELS.md).
// Budget, measured against the best same-pip school AoE (Quake / Maelstrom / Firestorm,
// 4 pips) at 2 targets with accuracy: hit + rider ~ +12-15 % value per pip per target
// (tests/dungeon-sim.js prints it); the hit alone never beats the school's L10 5-pip
// single-target spell on one target. `rider` (combat.js, v1.2 WS4 block) lands after the
// hit: Stoneward absorb on self, Tidecaller heal-over-time on self, Emberstrike a small
// trap on every enemy struck. `upgradePaths: true` = flag only (v1.2.1 spell upgrade paths).
(function (C) {
  var BOSS = {
    orrery_quake_ascendant: { name: 'Ascendant Quake', school: 'stoneward', level: 99, source: 'boss', pips: 4, acc: 90, type: 'aoe', min: 360, max: 430,
      rider: { type: 'absorb', value: 120 }, copies: 6, cineAs: 'quake_ram', upgradePaths: true },
    orrery_tide_ascendant:  { name: 'Ascendant Tide',  school: 'tidecaller', level: 99, source: 'boss', pips: 4, acc: 88, type: 'aoe', min: 330, max: 390,
      rider: { type: 'hot', name: 'Ascendant Tide', hot: { amt: 35, rounds: 3 } }, copies: 6, cineAs: 'maelstrom', upgradePaths: true },
    orrery_flare_ascendant: { name: 'Ascendant Flare', school: 'emberstrike', level: 99, source: 'boss', pips: 4, acc: 82, type: 'aoe', min: 360, max: 440,
      rider: { type: 'trap', name: 'Flare Mark', value: 15, affects: 'emberstrike' }, copies: 6, cineAs: 'firestorm', upgradePaths: true }
  };
  Object.keys(BOSS).forEach(function (id) { BOSS[id].id = id; C[id] = BOSS[id]; });
})(WF.data.cards);

// ---- v2.1 B5: spell card RARITY (the gem in the card's bottom-right corner; epic and
// legendary cards also get the foil shimmer, aura and sparkles). Colours and names come
// from WF.data.rarities (items.js), the same five rarities gear uses.
// A card's rarity, first match wins:
//   1. the card's own `rarity` field (per-card override, e.g. rarity: 'epic')
//   2. bySource[card.source]       boss-earned spells, Lumen quest gifts, enemy spells
//   3. pet cards (source 'pet')    the lowest PET rarity that grants this card slot
//                                  (pets.js rarity[r].cards: rare pets get the species
//                                  card, epic + the utility card, legendary + the
//                                  signature card); `petFallback` if pets.js is absent
//   4. byLevel                     school spells by unlock level (highest `min` <= level)
//   5. `fallback`
// tests/data-check.js checks that every card resolves to a rarity WF.data.rarities knows.
WF.data.cardRarity = {
  bySource: { boss: 'legendary', quest: 'uncommon', enemy: 'common' },
  petFallback: 'rare',
  byLevel: [
    { min: 10, rarity: 'epic' },
    { min: 7, rarity: 'rare' },
    { min: 5, rarity: 'uncommon' },
    { min: 1, rarity: 'common' }
  ],
  fallback: 'common',
  // -> rarity id ('common' .. 'legendary') of a card object or card id
  of: function (card) {
    var D = WF.data, R = D.cardRarity;
    var c = typeof card === 'string' ? (D.cards || {})[card] : card;
    if (!c) return R.fallback;
    if (c.rarity) return c.rarity;
    if (c.source && R.bySource[c.source]) return R.bySource[c.source];
    if (c.source === 'pet') {
      var pr = D.pets && D.pets.rarity, order = D.rarityOrder || Object.keys(pr || {});
      if (pr && c.petSlot != null) for (var i = 0; i < order.length; i++) if (pr[order[i]] && pr[order[i]].cards > c.petSlot) return order[i];
      return R.petFallback;
    }
    if (!c.source) for (var j = 0; j < R.byLevel.length; j++) if ((c.level || 0) >= R.byLevel[j].min) return R.byLevel[j].rarity;
    return R.fallback;
  }
};
