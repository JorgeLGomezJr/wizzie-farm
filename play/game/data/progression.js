// =====================================================================
//  WIZZIE FARM — LEVELS & XP
//
//  HOW TO RAISE THE LEVEL CAP (future update):
//    1. Add XP values to `xpToNext` (index = the level you are leaving).
//    2. Set `maxLevel` to the new cap.
//    3. Add spells in cards.js with level 11+, enemies in enemies.js,
//       a new zone in zones.js and quests in quests.js.
//  Nothing in the engine is hard-coded to level 10.
//
//  Pacing target (similar to W101 levels 1-10): about 3.0 - 3.5 hours.
//  Simulated (tests/balance-sim.js, v0.2): 3.0-3.1 h Emberstrike, 3.3 h
//  Tidecaller, 3.4 h Stoneward; level 10 arrives on the m16 turn-in, right
//  before the final boss. About 61% of XP comes from quests, 39% enemies.
//  Full tables + formulas: docs/design/combat-and-progression.md
// =====================================================================
WF.data.progression = {
  maxLevel: 10,

  // XP needed to go from level N to N+1.  Total to reach 10 = 7,400 XP.
  // Levels 11+: xpToNext[L] = round10(xpToNext[L-1] * 1.12 + 120)
  //   -> 10>11: 2020, 11>12: 2380, 12>13: 2790, 13>14: 3240 ... (see design doc)
  xpToNext: [0, /*1*/ 150, /*2*/ 290, /*3*/ 460, /*4*/ 650, /*5*/ 800, /*6*/ 950, /*7*/ 1100, /*8*/ 1300, /*9*/ 1700],

  // XP for defeating one enemy of a given level (bosses get bossMult).
  // L1 13, L5 33, L10 58. Works unchanged for levels 11+.
  mobXp: function (level) { return 8 + 5 * level; },
  bossMult: 4,

  // Combat rules
  maxPips: 7,
  startPips: 1,
  handSize: 7,
  maxCharms: 6,

  // Out-of-combat regeneration (fraction of max per second)
  regenHP: 0.0025,    // 0.25% of max per second in the wild (~15% per minute)
  regenMana: 0.0012,  // ~7% per minute: a long chain of fights needs a wisp or potion
  safeZoneRegenMult: 5,

  // Defeat: sent back to the home zone with this fraction of health / mana
  defeatHP: 0.3,
  defeatMana: 0.3,

  // ---------------- v0.2 fields (docs/ARCHITECTURE.md addendum) ----------------
  // New character
  homeZone: 'lumen_commons',
  startGold: 25,
  startItems: { minor_health: 2, mana_potion: 1 },

  // Deck rules. deckMax: 30 cards up to level 10, then +2 per level
  // (L11 32 ... L20 50) so new spells always have room.
  // Budget at L10: each school's own spells add up to 20 copies, the five
  // Lumen quest cards to 6, which leaves 4 slots = two trained spells
  // (trainable cards have copies <= 2). Checked by tests/balance-sim.js.
  // v2.1 A5: decks are finite (no reshuffle), so every deck number is tripled (90 at L10, +6 per level).
  deckMax: function (level) { return 90 + 6 * Math.max(0, (level || 1) - 10); },
  deckMin: 6,
  maxCopies: 18,

  // World
  aggroRadius: 3.4,        // walk this close to a camp and the duel starts
  bossAggroRadius: 4.6,
  wispRestore: 0.3,        // wisps restore 30% of max health and mana
  wispRespawn: 45,         // seconds

  // Bright pips: each new pip has this chance to be bright (a bright pip
  // pays 2 pips for your own school's spells or Lumen spells, 1 otherwise).
  // L1 0%, L2 3%, L5 12%, L10 27%, capped at 30% (L11+). Bosses use 0.3.
  brightPipChance: function (level) { return Math.min(0.30, 0.03 * Math.max(0, (level || 1) - 1)); },
  bossBrightChance: 0.3,

  // ---- v1.2 WS2: Bright Pip / Pip Surge gear stats (docs/V1.2-CONTRACT.md §2.1) ----
  // Gear stat `brightPip` ("Bright Pip", percent) is ADDED to brightPipChance:
  //   total = brightPipChance(level) + sum(gear brightPip) / 100, capped here.
  //   L10 base 27% + a full endgame set (~+22%) = ~49%, so the cap leaves
  //   headroom for levels 11-20 gear. WF.state.stats().brightPip is the gear
  //   share as a fraction, already cut so base + gear <= the cap.
  brightPipCap: 0.60,
  // Gear stat `pipSurge` ("Pip Surge", percent): chance at the start of every
  //   round from round 2 on to gain ONE extra normal pip (2 pips that round).
  //   Never more than maxPips. Enemies may set `pipSurge` (0..1) in enemies.js.
  pipSurgeCap: 0.35,

  // ---- v1.2 WS2: PROJECTED level scaling for levels 11-60 (contract §6.4) ----
  // Levels 11+ do not exist yet. These numbers are the HARD CONSTRAINT every
  // future level update must follow (spells, gear, enemy HP). Full rules and
  // the measured curve: docs/design/combat-and-progression.md §17 and
  // docs/HOW-TO-ADD-LEVELS.md. Checked by tests/balance-sim.js --check
  // (section "GEAR vs LEVEL") and tests/data-check.js.
  //
  //   THE RULE (Jorge): a level-N wizard in PERFECT gear is at least as strong
  //   as a level-(N+10) wizard in BAD gear, and at most 1.25x as strong (so
  //   perfect gear never trivialises content 10 levels up).
  //   power = damage per round x effective HP (max HP / (1 - resist)),
  //   measured in the real engine vs a standard L15 test dummy. Enforced at
  //   the real cap (L10 in full own-school T3 + set bonuses vs L20 in common
  //   shop gear) and, on this projection, at every future cap N = 20..50.
  //   Natural (no-gear) health at a cap = 45-55 % of health in perfect gear.
  //
  // HOW THE PROJECTION GROWS (gentle, and the same "+10 levels" step at every level):
  //   * FLAT budgets compound by `growth` (3 %) per level: natural health
  //     (`hpGrowth`, Stoneward 3.4 %), spell damage per pip, and the health of
  //     every kind of gear. So ten
  //     levels are always worth x1.34, at L20 and at L50 alike (linear growth
  //     would make +10 levels worth less and less, and perfect gear would end
  //     up trivialising content 10 levels up).
  //   * PERCENT budgets of a full 5-piece set (damage, resist, accuracy) grow
  //     by the SAME number of points per level for bad, typical and good gear
  //     (`setPerLevel`). Gear quality is a fixed head start, not a widening gap.
  //     Total resist is capped (`resistCap`) so a tank is never unkillable.
  //   * Bright Pip / Pip Surge budgets do not grow (their caps are fixed).
  //   * Natural mana: +`manaPerLevel` per level.
  // Levels <= `from` use schools.js (L1-10 health per level stays 54 / 46 /
  // 42); above it WF.state.baseVitals() uses naturalHP / naturalMana below.
  // Level 11 adds +36 / +28 / +25 health, level 20 +49 / +36 / +32.
  levelScaling: {
    from: 10,                 // FIXED anchor (end of the schools.js health line). Never move it when
                              // the cap is raised: levels 11+ must FOLLOW this projection
    to: 60,                   // projection horizon (Jorge's long-term cap)
    growth: 0.03,             // flat budgets: x1.03 per level (compound)
    // natural health per level (compound). Stoneward, the tank, grows a little
    // faster (as in levels 1-10, where it gains the most health per level):
    // its resist-heavy perfect gear needs the bigger "+10 levels" step to keep
    // the rule under 1.25x.
    hpGrowth: { stoneward: 0.034, tidecaller: 0.03, emberstrike: 0.03 },
    manaPerLevel: 1,          // natural mana per level above `from`
    // percentage points per level for a full 5-piece set, any gear quality
    // (mana: points); a single piece gets about a fifth
    setPerLevel: { dmg: 0.7, resist: 0.25, acc: 0.3, mana: 0.5 },
    resistCap: 0.75,          // total resist (school + gear) never above 75 %
    // Summed stats of a full 5-slot set at L10 (school-neutral averages), the
    // anchors of the gear budgets. common = the shop curve (items.js CURVE,
    // hat+robe+boots+wand+amulet, no rarity bonus): what "bad gear" means.
    // typical = best L9 shop + an average L9/L10 boss drop per slot.
    // good = a full own-school T3 endgame set + set bonuses (the best there is).
    // tests/balance-sim.js checks gear(kind, maxLevel) against the real data at the cap (10 %).
    gear10: {
      common:  { hp: 554, dmg: 21, resist: 12.5, acc: 15, mana: 5 },
      typical: { hp: 617, dmg: 31, resist: 14.7, acc: 18, mana: 16 },
      good:    { hp: 1077, dmg: 60, resist: 22, acc: 28, mana: 38, brightPip: 26, pipSurge: 6 }
    },
    // x1.00 at `from`, x(1 + growth)^(L - from) above it
    levelMult: function (L) { var ls = WF.data.progression.levelScaling; return Math.pow(1 + ls.growth, Math.max(0, L - ls.from)); },
    // average damage per pip of the top spells at level L, relative to L10
    spellPerPip: function (L) { return WF.data.progression.levelScaling.levelMult(L); },
    // natural (no-gear) health / mana at level L > from, given the values at `from`
    naturalHP: function (hpAtFrom, L, school) {
      var ls = WF.data.progression.levelScaling, g = (ls.hpGrowth || {})[school] || ls.growth;
      return Math.round(hpAtFrom * Math.pow(1 + g, Math.max(0, L - ls.from)));
    },
    naturalMana: function (manaAtFrom, L) { var ls = WF.data.progression.levelScaling; return manaAtFrom + ls.manaPerLevel * Math.max(0, L - ls.from); },
    // projected summed gear stats of `kind` ('common' | 'typical' | 'good') at level L
    gear: function (kind, L) {
      var ls = WF.data.progression.levelScaling;
      return ls.grow(ls.gear10[kind] || ls.gear10.common, L);
    },
    // grow any L10 gear-stat sum to level L by the rules above
    grow: function (g10, L) {
      var ls = WF.data.progression.levelScaling, n = Math.max(0, L - ls.from), m = ls.levelMult(L), out = {};
      Object.keys(g10).forEach(function (k) {
        out[k] = k === 'hp' ? g10[k] * m : (g10[k] || 0) + (ls.setPerLevel[k] || 0) * n;
      });
      return out;
    },
    commonGear: function (L) { return WF.data.progression.levelScaling.gear('common', L); }
  },

  // Training points (level reached -> points granted). Spend 1 point at
  // another school's trainer to learn one of its `trainable: true` spells.
  trainingPoints: { 2: 1, 4: 1, 6: 1, 8: 1 }   // 4 points = the 4 trainable spells from the other two schools
};
