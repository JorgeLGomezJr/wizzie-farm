// =====================================================================
//  WIZZIE FARM — NPCs
//
//  Fields (see docs/ARCHITECTURE.md):
//    name, title, role ('quest' | 'trainer' | 'vendor' | 'flavor'),
//    school   (trainers only),
//    look     { robe, hat, trim, skin, hair, beard, hood, staffGem, scale }
//             (optional extra: armor:true — a hint for models.js; safe to ignore)
//    greeting lines shown when the NPC has no quest business with you
//    vendor   item ids for sale (vendors only)
//
//  Placement in the world lives in zones.js. Voices are documented in
//  docs/design/lore.md ("Characters") — keep new lines in voice.
//  Tokens: {name} = player name, {school} = player's school name.
//  The hub zone (id lumen_commons) is called "Lanternmere" in all text.
//  Trainer lines for learning/training spells live in lore.js → trainerLines.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.npcs = {
  // ------------------------------------------------ LANTERNMERE (zone id: lumen_commons)
  aurelia: {
    name: 'Headmistress Aurelia', title: 'Lumen Order',
    role: 'quest',
    look: { robe: '#f4ead2', hat: '#e8c55a', trim: '#ffd76a', skin: '#f1d3b8', hair: '#e8e6f0',
            beard: false, hood: false, staffGem: '#ffe9a0', scale: 1.05 },
    greeting: [
      "Ah, {name}. The Spire hums a little brighter when you're about.",
      "Tea? No? More for me. The Lumenheart runs on starlight; I run on chamomile.",
      "Every wizard was a beginner once. Even me. Especially me. I set my hat on fire twice.",
      "The light is only kept by those who share it, dear one. Remember that."
    ]
  },

  brannoc: {
    name: 'Master Brannoc', title: 'Stoneward Master',
    role: 'trainer', school: 'stoneward',
    look: { robe: '#8a6a3b', hat: '#5c4320', trim: '#f0c27a', skin: '#c99a6e', hair: '#7a6a5a',
            beard: true, hood: false, staffGem: '#d4a25f', scale: 1.12 },
    greeting: [
      "Hm. You're back. Good. Mountains don't rush. Neither should you.",
      "Patience is a shield, {name}. So is a shield. Carry both.",
      "The Embers say we're slow. The Embers also say 'ow' a lot.",
      "Stand. Breathe. Endure. Then hit them with a rock."
    ]
  },

  maris: {
    name: 'Sister Maris', title: 'Tidecaller Master',
    role: 'trainer', school: 'tidecaller',
    look: { robe: '#2a6f9a', hat: '#174a68', trim: '#bdefff', skin: '#a7785a', hair: '#1e2a44',
            beard: false, hood: true, staffGem: '#4fc3e8', scale: 1.0 },
    greeting: [
      "The tide always comes back, {name}. So do good students. Welcome.",
      "Take a little, give a little. That's the whole secret of the sea.",
      "Brannoc is a rock and Ignis is a bonfire. Someone has to be the water between them.",
      "Heal when you must. Strike when you can. Never panic. Panic is bad for the complexion."
    ]
  },

  ignis: {
    name: 'Ignis Vale', title: 'Emberstrike Master',
    role: 'trainer', school: 'emberstrike',
    look: { robe: '#a8321b', hat: '#6e1c0c', trim: '#ffcf6a', skin: '#e9b48f', hair: '#ff7a2a',
            beard: false, hood: false, staffGem: '#ff6b3d', scale: 1.0 },
    greeting: [
      "{name}! You're not on fire. Disappointing, but we can work on that!",
      "Why defend when you can simply make the problem EXPLODE?",
      "My eyebrows grew back! Third time this month! Personal record!",
      "Strike fast, strike hard, and always know where the nearest bucket is."
    ]
  },

  pip_quickcoin: {
    name: 'Pip Quickcoin', title: 'Merchant',
    role: 'vendor',
    look: { robe: '#6a4c9c', hat: '#3d2a63', trim: '#ffd23f', skin: '#f0c8a0', hair: '#b5651d',
            beard: false, hood: false, staffGem: '#ffd23f', scale: 0.8 },
    greeting: [
      "Potions! Hats! Robes! Wands! Everything a wizard needs, at prices that only sting a little!",
      "{name}, my favourite customer! Don't tell the others. I say that to them too.",
      "All sales final. No refunds for exploding wands. That's a feature.",
      "Gold in, glory out! That's the Quickcoin promise!"
    ],
    vendor: [
      'minor_health', 'health_potion', 'mana_potion',
      'apprentice_hat', 'apprentice_robe', 'apprentice_boots', 'willow_wand',
      'journeyman_hat', 'journeyman_robe', 'journeyman_boots', 'oak_wand',
      'adept_hat', 'adept_robe', 'adept_boots', 'starsilver_wand',
      'luminary_hat', 'luminary_robe', 'luminary_boots', 'dawnfire_wand',
      // v1.2 WS3: deck items (game/data/decks.js)
      'deck_journeyman', 'deck_adept', 'deck_luminary'
    ]
  },

  guard_tomas: {
    name: 'Guard Tomas', title: 'Lanternmere Watch',
    role: 'flavor',
    look: { robe: '#3f5a8a', hat: '#2b3e60', trim: '#c9ced6', skin: '#d9a982', hair: '#4a3220',
            beard: false, hood: false, staffGem: '#c9ced6', scale: 1.05 },
    greeting: [
      "All quiet in Lanternmere! Mostly! I heard a twig snap earlier. Very suspicious twig.",
      "Halt! Who goes— oh, it's you, {name}. Carry on. Bravely. Like me.",
      "I'm not scared of the Hollow. I'm cautiously alert. There's a difference.",
      "If anything spooky comes through those portals, I will absolutely shout for help.",
      "Night shift in Mosslight again. Don't ask."     // v2.0 WS-E (R15; also a once-only aside, lore.storyAsides)
    ]
  },

  // v1.1: the Brightmane Stables (east of the fountain plaza). Sells mounts
  // (items.js type 'mount'); gives side quest s07 "A Steed of Your Own".
  hollis: {
    name: 'Hollis Brightmane', title: 'Stablemaster',
    role: 'vendor',
    look: { robe: '#8a5a2b', hat: '#4a3420', trim: '#e8c87a', skin: '#d9a982', hair: '#c8743a',
            beard: true, hood: false, staffGem: '#ffcf6a', scale: 1.08 },
    greeting: [
      "Whoa there, {name}! Easy. I meant the horse. You're fine.",
      "A good mount is forty percent faster than your feet and a hundred percent better company.",
      "Clover's been eating the Spire's flowerbeds again. Aurelia pretends not to notice. Aurelia notices.",
      "Press R to call your mount, and again to send it home. They always come back. Mostly for the apples.",
      "Pip sells hats. I sell happiness with hooves. You decide which is more important."
    ],
    vendor: ['mount_pony_dapple', 'mount_horse_chestnut', 'mount_horse_moonwhite', 'mount_horse_midnight', 'mount_warhorse']
  },

  // ---- v1.2 WS2: crafter NPC (docs/V1.2-CONTRACT.md §2.3) ----
  // Tamsin's workshop is next to the Brightmane Stables. She crafts the
  // Artificer set (crafted-only epic gear, recipes.js npc 'tamsin') from
  // Hollow Orrery reagents, plus the Artificer's Deck. No shop list: her
  // dialogue offers "Craft". Wears her own Artificer look (artisan /
  // forged / gearwork styles; until those render, the slot defaults).
  // Voice: brisk, cheerful, measures everything, talks to her tools.
  tamsin: {
    name: 'Tamsin Gearwright', title: 'Master Artificer',
    role: 'vendor',
    look: { robe: '#6a4a2e', hat: '#3a2a1a', trim: '#d8a84a', skin: '#c98d6a', hair: '#2a1a12',
            beard: false, hood: false, staffGem: '#7fe0ff', scale: 0.98,
            gear: {
              hat:    { style: 'artisan',  color: '#6a4a2e', color2: '#d8a84a', gem: '#7fe0ff', fx: null, rarity: 'epic' },
              robe:   { style: 'artisan',  color: '#6a4a2e', color2: '#d8a84a', gem: '#7fe0ff', fx: null, rarity: 'epic' },
              boots:  { style: 'artisan',  color: '#5a3e24', color2: '#d8a84a', gem: '#7fe0ff', fx: null, rarity: 'epic' },
              wand:   { style: 'forged',   color: '#b08a3a', color2: '#6a4a2e', gem: '#7fe0ff', fx: null, rarity: 'epic' },
              amulet: { style: 'gearwork', color: '#b08a3a', color2: '#6a4a2e', gem: '#7fe0ff', fx: null, rarity: 'epic' }
            } },
    greeting: [
      "Gearwright's the name, gears are the game! Mind the springs, {name}, they bite.",
      "Star Shards! Bring me Star Shards from the Hollow Orrery and I'll build you something the Spire's tailors only dream about.",
      "Bosses drop what they drop. I make what you ask for. Every shard you bring is a step closer, no luck involved.",
      "This coat has nine pouches. One is for snacks. The other eight are also, technically, for snacks.",
      "An Archon Core still ticks, did you know? Seventy-two beats a minute. Same as a happy wizard.",
      "Hollis keeps asking me to build him a horse that doesn't need apples. I keep telling him that's called a chair."
    ]
  },

  // ---- v1.2 WS9: the Lanternmere Vault (docs/V1.2-CONTRACT.md §6.2) ----
  // role 'banker': talking to her opens the shared account Bank (game/js/bank.js).
  // `vault` names the bank in the UI; a zone that places a banker is a zone where
  // the backpack can send things straight to the Vault. She stands in front of
  // her strongroom (prop 'vault_counter') on the west side of Lanternmere.
  // Voice: precise, unhurried, dry; counts everything twice; believes a vault
  // that only keeps is a Hollow thing, so hers exists to pass things on.
  banker: {
    name: 'Orsolya Coffersmith', title: 'Keeper of the Lanternmere Vault',
    role: 'banker',
    vault: { name: 'Lanternmere Vault', short: 'Vault' },
    look: { robe: '#1f5c58', hat: '#2a2342', trim: '#e2b856', skin: '#e6c2a2', hair: '#cfcad8',
            beard: false, hood: false, staffGem: '#ffd76a', scale: 0.97,
            gear: {
              hat:    { style: 'tall',      color: '#2a2342', color2: '#e2b856', gem: '#ffd76a', fx: null, rarity: 'rare' },
              robe:   { style: 'long',      color: '#1f5c58', color2: '#e2b856', gem: '#ffd76a', fx: null, rarity: 'rare' },
              wand:   { style: 'scepter',   color: '#c99a3e', color2: '#2a2342', gem: '#ffd76a', fx: null, rarity: 'rare' },
              amulet: { style: 'medallion', color: '#e2b856', color2: '#1f5c58', gem: '#ffd76a', fx: null, rarity: 'rare' }
            } },
    greeting: [
      "Welcome to the Lanternmere Vault, {name}. Everything deposited, nothing lost. I counted twice.",
      "A vault that only keeps is a Hollow thing. Mine passes things on. To your other wizards, mostly.",
      "A robe that won't sit right on {school} shoulders? Leave it with me. Another of your wizards will thank you.",
      "One hundred and twenty spaces. A stack of moonmoss is one space. A hat is one hat. I find that restful.",
      "Pip counts coins fast. I count them correctly. We have agreed to disagree about which matters more.",
      "The Order keeps a lantern lit on every road. I keep the ledger lit. Someone has to.",
      "The deep vault is sealed by the Headmistress. Not even I hold that key."     // v2.0 WS-E (R9, plant B4)
    ],
    // shown above the Vault panel the first time each wizard opens it
    vaultIntro: "Everything here is shared by all your wizards. Put it in as one, take it out as another. I keep the ledger."
  },

  // ------------------------------------------------ MOSSLIGHT PATH
  fennick: {
    name: 'Old Fennick', title: 'Hermit of Mosslight',
    role: 'quest',
    look: { robe: '#5d7a3a', hat: '#3e5226', trim: '#9fe8a8', skin: '#e0bfa0', hair: '#dcdcd0',
            beard: true, hood: false, staffGem: '#9fe8a8', scale: 0.92 },
    greeting: [
      "Eh? Oh, it's you, young sprout. Gerald, say hello. ...He says hello.",
      "Lovely evening. Or morning. Whichever one it is, it's lovely.",
      "Never trust a toad who won't look you in the eye. Learned that the hard way.",
      "Moonmoss glows brightest when you're not looking at it. Shy stuff. Like Gerald."
    ]
  },

  // ------------------------------------------------ WHISPERWOOD
  sela: {
    name: 'Ranger Sela', title: 'Warden of Whisperwood',
    role: 'quest',
    look: { robe: '#4d6b3c', hat: '#2f4024', trim: '#c8a26a', skin: '#b58460', hair: '#2a1a10',
            beard: false, hood: true, staffGem: '#7fffb0', scale: 1.02 },
    greeting: [
      "Keep your voice down. The trees are listening. So am I.",
      "Still alive, {name}? Good. Saves me the paperwork.",
      "Stay on the path. If something on the path looks at you funny, stop being on the path.",
      "Wren's nice. Too nice. Somebody here has to be the grumpy one."
    ]
  },

  wren: {
    name: 'Wren', title: 'Herbalist',
    role: 'vendor',
    look: { robe: '#d98c5f', hat: '#7a9e4a', trim: '#fff1b8', skin: '#f3d0b0', hair: '#f2c94c',
            beard: false, hood: false, staffGem: '#bff3ff', scale: 0.9 },
    greeting: [
      "Hi hi hi! Need potions? I made potions! Some of them are even the colour they're meant to be!",
      "{name}! Did you know wisps hum when they're happy? I'm trying to teach one harmony.",
      "Sela says I talk too much. I say Sela talks too little. We average out perfectly!",
      "Don't drink the green one. Or do! For science! Actually, no. Don't."
    ],
    vendor: ['minor_health', 'health_potion', 'mana_potion']
  },

  // ------------------------------------------------ ASHEN RUINS
  aldric: {
    name: 'Sir Aldric', title: 'Paladin of the Dawn Watch',
    role: 'quest',
    look: { robe: '#f2f2f2', hat: '#d9b44a', trim: '#ffd76a', skin: '#e3b896', hair: '#8a5a2b',
            beard: true, hood: false, staffGem: '#fff6c8', scale: 1.15, armor: true },
    greeting: [
      "By the Dawn! {name}, you honour these old stones with your presence.",
      "The Dawn Watch never sleeps! ...Well. I nap. Briefly. With one eye open.",
      "I polish my armour every morning. The ash gets everywhere. EVERYWHERE.",
      "Courage, friend. Even ashes remember the fire that made them."
    ]
  }
};

// ---- v1.2 WS4: the Hollow Orrery (dungeon, game/data/dungeons.js) ----
// A lantern-spirit astronomer who never left the star-vault. Stands in the
// Hall of Hours and explains the doors and the farming loop. Flavor only.
WF.data.npcs.orrery_keeper = {
  name: 'Orrin Tellwhistle', title: 'Last Star-Keeper of Dawnhold',
  role: 'flavor',
  dropHints: 'hollow_orrery',     // v2.1: "What do the guardians carry?" (game/js/dropHints.js, WF.state.bossDropHints)
  look: { robe: '#4f5f9e', hat: '#2a2650', trim: '#ffd76a', skin: '#d6e4ff', hair: '#eef2fa',
          beard: true, hood: false, staffGem: '#8fd8ff', scale: 0.95 },
  greeting: [
    "Oh! A visitor! Mind the brass, {name}. I polished it in... what year is it? Never mind. I'll ask the stars.",
    "The star doors turn one at a time. Free whoever guards a room, and the next door rolls open for you.",
    "Each time you step in, the Orrery winds itself back. Doors sealed, guardians waiting. Come as often as you like.",
    "What you meet in there are echoes. The Orrery remembers the night it was hollowed and plays it again each turning.",
    "Star shards, starbound brass, a deck fit for a Star-Warden... the Orrery gives back what the Archon stole.",
    "If the Archon is too much, there's no shame in it. Go home, mend your deck, come back. The Orrery will wait.",
    "You remind me of someone. Several someones."     // v2.0 WS-E (R10, plant A8)
  ]
};

// ---- v2.0 M1 (WS-A): the Spellwright (docs/V2.0-CONTRACT.md §2) ----
// Oswin Lenscroft, a Lanternwright descendant (story.md §8: Runeglass are
// shards of the Orrery's star-lenses, which his family ground). He works at
// an open-air lens bench on the lane west of the Spire (no new building).
// role 'spellwright' -> the dialogue offers "Upgrade Spells" (game/js/spellwright.js,
// numbers in game/data/runeglass.js). Tutorial quest s08 (quests.js).
// Voice: soft-spoken, precise, a little sad about his family's craft, warm
// with you; hums while he grinds. Never grand.
WF.data.npcs.spellwright = {
  name: 'Oswin Lenscroft', title: 'Spellwright',
  role: 'spellwright',
  look: { robe: '#3e5a7a', hat: '#22344a', trim: '#9fe6ff', skin: '#e0b994', hair: '#c9c4bc',
          beard: true, hood: false, staffGem: '#9fe6ff', scale: 0.97 },
  greeting: [
    "Mind the glass dust, {name}. It gets everywhere, and it remembers where it has been.",
    "Bring me Runeglass, the shards the great Hollow beasts carry. I grind them into your spells, one careful rank at a time.",
    "Every spell can grow two ways. Pick one. A spell that tries to be everything ends up being nothing much.",
    "My family ground the great lenses under the Ruins. I would rather make small, honest things now."
  ]
};
