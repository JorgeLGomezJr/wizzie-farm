// =====================================================================
//  WIZZIE FARM — SCHOOLS
//  Three playable schools + the universal "Lumen" (good) school and the
//  enemy "Hollow" (evil) school.
//
//  Stats per school:
//    baseHP / hpPerLevel     -> max health
//    baseMana / manaPerLevel -> max mana (each pip costs 1 mana to cast)
//    dmg    -> outgoing damage bonus   (0.15 = +15%)
//    resist -> incoming damage reduction (0.10 = -10%)
//    acc    -> accuracy bonus added to every card (0.05 = +5%)
//    schoolResist (v2.0) -> natural resist vs hits of one school; negative =
//              a weakness. The cycle: Tidecaller > Stoneward > Emberstrike >
//              Tidecaller (water wears down stone, earth smothers fire,
//              storm-fire boils the tide). Enemies hit as their own school
//              (enemies.js `school`), so the camp you fight matters and
//              school resist gear can cover your weak side.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.schools = {
  stoneward: {
    id: 'stoneward', name: 'Stoneward', role: 'Tank', playable: true,
    color: '#d4a25f', dark: '#6b4a22', glyph: '◆',
    tagline: 'Unbreakable earth magic. Outlast anything.',
    desc: 'Stoneward wizards draw power from the mountains. Highest health and resistance, damage shields that soak hits, and steady accurate spells. Slower to kill, almost impossible to kill.',
    baseHP: 540, hpPerLevel: 47, baseMana: 20, manaPerLevel: 2,
    dmg: -0.05, resist: 0.05, acc: 0.0,
    schoolResist: { tidecaller: -0.10, emberstrike: 0.05 },   // v2.0: water wears down stone; the tank shrugs off fire
    bars: { health: 5, damage: 2, defense: 5, accuracy: 4 },
    robe: '#8a6a3b', hat: '#5c4320', trim: '#f0c27a'
  },
  tidecaller: {
    id: 'tidecaller', name: 'Tidecaller', role: 'Balanced', playable: true,
    color: '#4fc3e8', dark: '#1d5a73', glyph: '≈',
    tagline: 'The tide gives and takes. Heal, drain, endure.',
    desc: 'Tidecaller wizards command the moon and the sea. Solid health, the best healing in the game, and draining spells that hurt enemies while restoring you. Good at everything.',
    baseHP: 510, hpPerLevel: 46, baseMana: 24, manaPerLevel: 2,
    dmg: 0.05, resist: 0.05, acc: 0.0,
    schoolResist: { emberstrike: -0.08 },  // v2.0: storm-fire boils the tide
    bars: { health: 4, damage: 3, defense: 3, accuracy: 3 },
    robe: '#2a6f9a', hat: '#174a68', trim: '#bdefff'
  },
  emberstrike: {
    id: 'emberstrike', name: 'Emberstrike', role: 'Damage', playable: true,
    color: '#ff6b3d', dark: '#7a2410', glyph: '✹',
    tagline: 'Fire and lightning. End fights fast.',
    desc: 'Emberstrike wizards channel wildfire and storm. The biggest hits, burning damage-over-time and area spells - but the lowest health and accuracy. Kill them before they kill you.',
    baseHP: 450, hpPerLevel: 42, baseMana: 22, manaPerLevel: 2,
    dmg: 0.35, resist: 0.0, acc: 0.0,
    schoolResist: { stoneward: -0.12 },    // v2.0: earth smothers fire
    bars: { health: 2, damage: 5, defense: 1, accuracy: 2 },
    robe: '#a8321b', hat: '#6e1c0c', trim: '#ffcf6a'
  },
  // Universal "good" magic of the Lumen Order (earned through quests).
  lumen: {
    id: 'lumen', name: 'Lumen', role: 'Universal', playable: false,
    color: '#ffd76a', dark: '#7a5f14', glyph: '☀'
  },
  // Enemy magic of the Hollow Court (the force of evil).
  hollow: {
    id: 'hollow', name: 'Hollow', role: 'Evil', playable: false,
    color: '#a879ff', dark: '#3a1d6e', glyph: '☽'
  }
};

// Order shown on the school-select screen.
WF.data.playableSchools = ['stoneward', 'tidecaller', 'emberstrike'];

// =====================================================================
//  v2.0 M1 "Schools" (docs/V2.0-CONTRACT.md §2): SCHOOL STATS
//
//  Gear stats (percent, like v1.x `dmg`):
//    universal   dmg, resist, acc            every spell / every hit
//    per school  dmg_<school>, resist_<school>, acc_<school>
//                e.g. dmg_emberstrike = +% damage of Emberstrike spells,
//                resist_tidecaller = -% damage taken from Tidecaller hits,
//                acc_stoneward = +% accuracy of Stoneward spells
//    Bright Pip   brightPip  (v1.2, unchanged: + chance each new pip is bright)
//    Pip Surge   pipSurge   (v1.2, unchanged)
//  The school's own base dmg / resist / acc above stay universal.
//
//  THE FORMULA (combat.js, pure):
//    hit = base x (1 + dmg + dmg_<spell school>)
//               x (1 - (resist + resist_<hit school>))      resist < 0 = weakness
//               x blades/weaknesses x traps/shields x enemy affinity
//    accuracy = card.acc + (acc + acc_<spell school>) x 100   (cap 100)
//  The HIT SCHOOL of an enemy's Hollow spell is the enemy's own `school`
//  ("the Hollow takes on the school of the light it devours", story.md §8),
//  so per-school resist gear matters against that enemy. Pure Hollow
//  beings (school 'hollow') are only stopped by universal resist.
//  Total resist is capped at progression.levelScaling.resistCap (75 %).
// =====================================================================
WF.data.schoolStatKinds = ['dmg', 'resist', 'acc'];
WF.data.schoolStatNames = { dmg: 'Damage', resist: 'Resist', acc: 'Accuracy' };
// every per-school gear stat key, in display order: dmg_stoneward, dmg_tidecaller, ...
WF.data.schoolStatKeys = (function () {
  var out = [];
  WF.data.schoolStatKinds.forEach(function (k) { WF.data.playableSchools.forEach(function (s) { out.push(k + '_' + s); }); });
  return out;
})();
// 'dmg_emberstrike' -> { kind: 'dmg', school: 'emberstrike' }  (null for any other key)
WF.data.splitSchoolStat = function (key) {
  var m = /^(dmg|resist|acc)_([a-z]+)$/.exec(key || '');
  return m && WF.data.schools[m[2]] ? { kind: m[1], school: m[2] } : null;
};

// ---- v2.0 M1: ENEMY SCHOOLS (enemies*.js `school`, shown on the duel nameplate) ----
//   Mosslight   Hollow Sprite (Hollow), Rot Toad + Bogmire Brute (Stoneward),
//               Gloom Imp + Gloomhorn (Emberstrike), GRUBNAK (Tidecaller)
//   Whisperwood Hollow Wolf + Shadowfang (Emberstrike), Bramble Ghoul, Thorn
//               Sprout, Elder Bramblehulk (Stoneward), THORNMAW (Tidecaller)
//   Ashen Ruins Ash Wraith, Cinder Revenant, Hollow Acolyte (Emberstrike), Bone
//               Knight, Dread Knight (Stoneward), Hierophant (Hollow),
//               CAPTAIN VEX + NYX (Tidecaller)
//   Orrery      Shard Hound + Warden Morrow (Tidecaller), Seer (Stoneward),
//               Sentinel (Emberstrike), Starless Archon (Hollow)
//   Lore (story.md §8): the great Hollow beasts all gorged on tide-light, the
//   moon-and-sea light the Lanternwrights caged first, so every story boss
//   hits as Tidecaller: Stoneward's natural weakness (schoolResist above) is
//   what keeps the tank at 60-90 % against them (tests/balance-sim.js).
//   Mixed-school camps: every zone from Whisperwood on (tests/data-check.js).

// ---- v2.0 M1: spell pacing (W101 cadence, docs/V1.2-CONTRACT.md §7) ----
// A school's own spells unlock ONLY at these levels (the trainer teaches
// them). Levels in between give health, mana, training points and gear.
// Future levels (11+): roughly one new spell every 2-3 levels.
// tests/data-check.js warns when a school spell sits outside the list.
WF.data.spellCadence = [1, 3, 5, 7, 8, 10];

// ---- v2.0 M1: summed gear stats (percent) -> battle input player.schoolStats
//   { dmg: { emberstrike: 0.12 }, resist: { tidecaller: 0.05 }, acc: {} } (fractions)
// Pure; used by state.js stats(), tests/balance-sim.js and tests/dungeon-sim.js.
WF.data.schoolStatsFromGear = function (g, school) {
  var out = { dmg: {}, resist: {}, acc: {} };
  // the wearer's natural school resists / weaknesses (schoolResist above) come first
  var nat = school && WF.data.schools[school] && WF.data.schools[school].schoolResist;
  Object.keys(nat || {}).forEach(function (s) { out.resist[s] = (out.resist[s] || 0) + nat[s]; });
  Object.keys(g || {}).forEach(function (k) {
    var sp = WF.data.splitSchoolStat(k);
    if (sp && g[k]) out[sp.kind][sp.school] = (out[sp.kind][sp.school] || 0) + g[k] / 100;
  });
  return out;
};
