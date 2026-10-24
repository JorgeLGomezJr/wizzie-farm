// =====================================================================
//  WIZZIE FARM — DECK ITEMS (v1.2, contract docs/V1.2-CONTRACT.md §2.4)
//
//  A deck is an item you OWN. Each deck has its own rules, and you copy
//  spells from your spellbook into it (W101-style). One deck is equipped
//  at a time; duels deal from the equipped deck.
//
//  Fields (type: 'deck'):
//    name, level (level needed to equip), rarity, price (0 = not sold),
//    sell (also what a duplicate turns into: decks are unique), desc,
//    deck: {
//      size       max cards in the deck
//      maxCopies  max copies of any one spell
//      maxOther   max cards from OTHER schools' spells (trained spells).
//                 Lumen spells count as your own school.
//      tcSlots    max Spell Scrolls carried in the deck's sideboard
//    },
//    look: { color (cover), color2 (trim), gem, emblem }   2D art in the
//      spellbook; emblem ∈ star | leaf | rune | sun | orbit | gear.
//
//  v2.1 A5 (Jorge, Oct 20): decks are FINITE (no reshuffle). Every number below (deck size,
//  maxCopies, maxOther, cards.js `copies`, progression deckMax) was TRIPLED so the hand odds stay
//  exactly as in v2.0 (same card ratios) while a deck lasts three times as long (x2 was not enough:
//  balance-sim showed L2 two-enemy camps and story bosses stalling). The text below still gives
//  the v2.0 numbers; multiply them by 3.
//
//  DESIGN (game-designer):
//   * Own spells + Lumen gifts add up to 15 cards at L4, 20 at L6, 23 at L8,
//     26 at L10 (cards.js `copies`), plus ~2 cards per training point.
//     Each shop deck holds everything you learn until the next shop deck:
//       Apprentice 16 (L1-3) -> Journeyman 22 (L4-6) -> Adept 26 (L7-8)
//       -> Luminary 30 (L9-10).
//     Skip an upgrade and new spells stop fitting: the spellbook tells you.
//   * Luminary and both L10 decks hold the full L10 card budget from
//     cards.js (20 own + 6 Lumen + 2 trained spells = 30 cards).
//   * maxOther grows 2 -> 4 -> 6 -> 8: one trained spell per training point.
//     8 = all four trainable spells at their auto-added copies, so every
//     v1.1 deck built by auto-add migrates into the Luminary unchanged.
//   * The L10 decks are side-grades, not just "bigger":
//       Orrery (dungeon drop)   more scrolls (14) and off-school room (12)
//       Artificer (crafted)     the biggest deck (34) and 6 copies per spell
//   * Apprentice allows 4 copies so every school's starting deck reaches
//     progression.deckMin (6 cards) with just its two level-1 spells.
//   * Prices are about one shop gear piece of the same level, so a deck
//     upgrade never stops you from buying gear (balance-sim gold curve).
//
//  Future levels: add a new deck here (e.g. L13, size 36). Nothing in the
//  engine knows these ids except the starter deck (lowest level, price 0).
// =====================================================================
window.WF = window.WF || { data: {} };
WF.data.items = WF.data.items || {};

WF.data.deckItems = {
  deck_apprentice: {
    type: 'deck', name: 'Apprentice Deck', level: 1, rarity: 'common', price: 0, sell: 5,
    desc: 'Scuffed leather and a lucky blue bead. Every Lanternmere student gets one on their first day.',
    deck: { size: 48, maxCopies: 12, maxOther: 6, tcSlots: 3 },
    look: { color: '#7a5232', color2: '#c9a24a', gem: '#8fd0ff', emblem: 'star' }
  },
  deck_journeyman: {
    type: 'deck', name: 'Journeyman Deck', level: 4, rarity: 'uncommon', price: 140, sell: 35,
    desc: 'Oak-green covers stitched for the road, with a pocket for a few Spell Scrolls.',
    deck: { size: 66, maxCopies: 12, maxOther: 12, tcSlots: 5 },
    look: { color: '#2f6a4a', color2: '#e0c98a', gem: '#8fffb0', emblem: 'leaf' }
  },
  deck_adept: {
    type: 'deck', name: 'Adept Deck', level: 7, rarity: 'uncommon', price: 360, sell: 90,
    desc: 'Midnight-blue boards edged in starsilver. The rune on the cover hums when you shuffle.',
    deck: { size: 78, maxCopies: 15, maxOther: 18, tcSlots: 7 },
    look: { color: '#2b3f8f', color2: '#d8e0f0', gem: '#bfe6ff', emblem: 'rune' }
  },
  deck_luminary: {
    type: 'deck', name: 'Luminary Deck', level: 9, rarity: 'rare', price: 720, sell: 180,
    desc: 'Ivory and sun-gold, carried by the Order’s senior wizards. Room for every spell you will know.',
    deck: { size: 90, maxCopies: 15, maxOther: 24, tcSlots: 9 },
    look: { color: '#e9dcb8', color2: '#d9a531', gem: '#ffe48a', emblem: 'sun' }
  },
  deck_orrery: {
    type: 'deck', name: 'Orrery Deck', level: 10, rarity: 'legendary', price: 0, sell: 250,
    desc: 'Found in the Hollow Orrery. Tiny brass planets circle the clasp; its pockets seem deeper inside than out.',
    deck: { size: 96, maxCopies: 15, maxOther: 36, tcSlots: 14 },
    look: { color: '#241a4e', color2: '#ffcf6a', gem: '#c49cff', emblem: 'orbit' }
  },
  deck_artificer: {
    type: 'deck', name: 'Artificer Deck', level: 10, rarity: 'epic', price: 0, sell: 300,
    desc: 'Riveted copper plates and a ticking gear clasp, built by Tamsin Gearwright to hold a whole arsenal.',
    deck: { size: 102, maxCopies: 18, maxOther: 24, tcSlots: 10 },
    look: { color: '#8a4f24', color2: '#ffd76a', gem: '#ff9a4a', emblem: 'gear' }
  },
  // v2.0 save v5 (V1.2 review F-1): never sold, dropped or crafted. The save migration gives it
  // ONLY to a wizard whose old deck (v1.1: up to 30 cards, 6 copies, any school) fits no deck they
  // can use, so the old deck is kept card for card instead of trimmed. Its rules are the v1.1 rules
  // (progression.js deckMax at L1-10 / maxCopies). `legacy: true` = hidden on the deck shelf unless owned.
  deck_legacy: {
    type: 'deck', name: 'Legacy Deck', level: 1, rarity: 'uncommon', price: 0, sell: 0, legacy: true,
    desc: 'A well-thumbed deck from before decks were bound as items, kept exactly as you built it.',
    deck: { size: 90, maxCopies: 18, maxOther: 90, tcSlots: 5 },
    look: { color: '#5b4636', color2: '#c8b48a', gem: '#f0e2b6', emblem: 'star' }
  }
};

// Register the decks as items (WF.data.items[id]) and append the rules to
// each description so shop text never drifts from the numbers above.
(function () {
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  Object.keys(WF.data.deckItems).forEach(function (id) {
    var it = WF.data.deckItems[id], r = it.deck;
    it.id = id;
    it.rules = 'Holds ' + plural(r.size, 'card') + ' · up to ' + plural(r.maxCopies, 'copy', 'copies') + ' of a spell · ' +
      plural(r.maxOther, 'card') + ' from other schools · ' + plural(r.tcSlots, 'Spell Scroll') + '.';
    if (it.desc && it.desc.indexOf(it.rules) < 0) it.desc = it.desc + ' ' + it.rules;
    WF.data.items[id] = it;
  });
})();
