// =====================================================================
//  WIZZIE FARM — LORE TEXT (player-facing flavor)
//
//  intro         lines shown on a new game (after school select is fine)
//  ending        narrator lines shown after the `final: true` quest (m17)
//  endingTitle   heading for the ending screen
//  schoolIntros  one paragraph per playable school (school select / trainer)
//  zoneIntros    shown on first arrival in a zone (keyed by zone id)
//  cardFlavor    one line per card in cards.js (spellbook tooltip, italic)
//  itemFlavor    one line per item in items.js (backpack/vendor tooltip)
//  enemyLines    { enemyId: { bestiary } } — bestiary text only. Duel shouts
//                live ONLY in enemies.js `intro` (single source).
//  bossLines     { enemyId: { intro: [..], phase: '..', freed: '..' } }
//                intro = 2–3 short lines during the duel-start camera push-in,
//                phase = one line at 50% HP, freed = one line on the victory
//                screen (freed beings sound relieved; Nyx, truly Hollow, threatens).
//  trainerLines  { npcId: { learn, train, nothing } } — learn: teaching your own
//                school's new spells; train: selling a trainable spell to another
//                school's student; nothing: no new spells yet. Token: {name}.
//  ui            small UI strings: welcome, controlsHint, noPotions, defeat,
//                trainerReminder ({trainer} is replaced by the engine).
//
//  NAMES: the hub zone (id lumen_commons) is "Lanternmere" in all text;
//  single-use spells are "Spell Scrolls".
//  TONE: beings once good are FREED, never killed; pure Hollow creatures
//  (sprites, ghouls, wraiths, Nyx) may be banished, scattered or laid to rest.
//
//  The full world bible is docs/design/lore.md. When you add a card or
//  item, add its flavor line here too (missing lines are simply not shown).
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.lore = {
  intro: [
    "Long ago, the first dawn fell to earth as a single crystal: the Lumenheart.",
    "Wizards gathered around its glow and built the Lumen Spire, and they called themselves the Lumen Order.",
    "But one of them grew afraid that every light must one day go out. His name was Malgrath.",
    "He tried to keep all the light for himself, and it hollowed him out instead. He became the Hollow King.",
    // v2.0 (Jorge, D4 "yes 300"): the Order's official history, not the truth (canon: 16 years; story.md §2, the L30 reveal)
    "The histories say that three hundred years ago, the Order sealed him away beyond the Gloamgate. The realm has been peaceful since.",
    "Mostly.",
    "Now the lanterns on Mosslight Path are going dark, and black feathers are turning up where they shouldn't.",
    // v2.0 WS-E story plants (docs/design/story.md §4 A2, A1; retrofit R1)
    "Old Fennick swears a star fell over Mosslight. Nobody believes Fennick.",
    "You remember nothing before the night you woke in the moss, warm as a coal.",
    "Welcome to the Lumen Spire, young wizard. Your story starts today."
  ],

  endingTitle: "Chapter One Complete: The Herald Falls",

  ending: [
    "That night, every lantern in Lanternmere burned a little brighter, and nobody could quite say why.",
    "In the bog, Grubnak sang. In the wood, the Heartoak hummed. In a quiet room of the Spire, Captain Vex slept.",
    "But deep beneath the Ashen Ruins, the Gloamgate was not quite shut. A sliver of grey, no wider than a feather.",
    // v2.0 WS-E (R16): the Book I end card (story.md §6). ui.js shows the line equal to
    // `endCard` (below) as the chapter's closing card.
    "Far away, the Hollow King turned his gaze toward the student who frees what he hollows.",
    "So ends Chapter One. The tale of the Hollow King will continue in a chapter yet to come."
  ],

  schoolIntros: {
    stoneward: "Stoneward wizards learn from the mountains: stand firm, wait, and outlast the storm. " +
      "Their founder, Hulda Granitemere, held the Gloamgate shut with her bare magic while it was sealed. " +
      "Stonewards are slow to anger, slower to fall, and they will remind you of this. At length.",
    tidecaller: "Tidecallers follow the moon and the sea: everything that is taken must be given back. " +
      "Their founder, Saro Moonwell, wove the seal on the Gloamgate and kept the other two founders alive while doing it. " +
      "Tidecallers heal, drain and endure, and quietly believe they are the only sensible school.",
    emberstrike: "Emberstrike wizards burn bright and strike first: wildfire, lightning, and absolutely no waiting. " +
      "Their founder, Cassian Brand, blasted the Hollow King back through the Gloamgate so it could be sealed at all. " +
      "Emberstrikes win fights quickly or lose them spectacularly. Either way, everyone hears about it."
  },

  zoneIntros: {
    lumen_commons: "Lanternmere. Under the golden glow of the Lumen Spire, wizards trade gossip, potions and mildly cursed hats. " +
      "No Hollow creature has ever set foot here. Guard Tomas would like you to know he is personally responsible.",
    mosslight_path: "Mosslight Path. A lantern-lit trail through soft green bog, where the moss glows like spilled moonlight. " +
      "The lanterns are going out one by one, and the toads have started saying unkind things.",
    whisperwood: "Whisperwood. The oldest forest in the realm, where the trees once hummed lullabies to anyone who would listen. " +
      "Now patches of the forest have gone grey and silent, and something big is breathing at its heart.",
    // v2.0 WS-E (R14): the official history is unreliable (story.md §2)
    ashen_ruins: "The Ashen Ruins. Cindralis, burned in the Ashfall. The histories blame the Hollow. " +
      "Dawnhold's broken towers still smoulder here, and somewhere among them the old Gloamgate is waking up."
  },

  cardFlavor: {
    mist_veil:     "A curtain of sea-fog. Things that swing at you tend to miss the important bits.",
    ember_ward:    "A ring of banked coals around you. Hot to the touch, hotter to punch.",
    rending_slash: "A cut that keeps on cutting. Bone Knights never learned to stop.",
    // Stoneward
    pebble_strike: "Small, hard and well aimed. Every mountain starts somewhere.",
    stone_skin:    "Your skin turns to granite. Itchy, but worth it.",
    granite_blade: "Sharpen your will on the bones of the earth.",
    mudslide:      "The hill decided to come to them.",
    bulwark:       "A wall of earth that politely refuses to let anything through.",
    golem_fist:    "The golem doesn't hold grudges. It holds fists.",
    earthen_mend:  "The earth remembers how you were shaped, and puts you back that way.",
    quake:         "Brannoc calls it 'a firm suggestion to the ground.'",
    fortify:       "Stand firm. Then stand firmer.",
    crag_trap:     "A crack in the ground, waiting patiently. Stonewards are good at waiting.",
    titans_wrath:  "The mountain stops being patient.",

    // Tidecaller
    ripple:        "Even the smallest wave wears down the cliff, eventually.",
    soothing_mist: "Cool sea air that smells faintly of salt and second chances.",
    tide_blade:    "Gather the tide before it breaks.",
    undertow:      "The sea takes, and the sea gives back. Mostly to you.",
    wellspring:    "A spring that keeps on giving, long after the spell is cast.",
    wave_serpent:  "Sister Maris insists it's friendly. It is not friendly.",
    riptide_trap:  "Calm on the surface. Hungry underneath.",
    healing_rain:  "A storm cloud with only good intentions.",
    maelstrom:     "Everyone gets a turn in the whirlpool.",
    moon_tide:     "The moon pulls the sea, and the sea pulls the life right out of them.",
    leviathan:     "Something very old and very large is answering your call.",

    // Emberstrike
    spark_bolt:    "A little zap with a big attitude.",
    fire_sprite:   "A fluttery little moth made of flame. It loves lanterns. Keep it well away from curtains.",
    flame_blade:   "Ignis says you should always warm up before a fight.",
    fireball:      "The classic. Ask any Emberstrike, then step back.",
    scorch_trap:   "Hot coals, hidden right where they'll step.",
    storm_hawk:    "The Gale Hawk rides the storm wind in, and hits like a falling sky.",
    wildfire:      "It keeps burning long after you've stopped watching.",
    firestorm:     "Weather report: one hundred percent chance of fire.",
    inferno_blade: "When warm isn't enough, try inferno.",
    thunder_drake: "The Skyrend Drake tears the clouds open, and the lightning falls through.",
    phoenix_rage:  "From the ashes it rises. Then it makes more ashes.",

    // Lumen (quest rewards)
    lumen_mend:    "The first spell every wizard of the Order learns. Healing is never the wrong spell.",
    lumen_blade:   "Fennick used it to slice cheese for forty years. It's still very sharp.",
    lumen_ward:    "Bottled wisp light from Wren. Like a hug, but for being hit.",
    sunburst:      "Sela's mentor watched over Whisperwood with this light for fifty years.",
    dawn_trap:     "The Dawn Watch's oldest spell. Their way of saying 'come and try it.'",

    // Hollow (enemy)
    shadow_nip:    "A small bite of nothing. It still hurts.",
    gloom_bolt:    "A bolt of pure gloom. Smells like a rainy Monday.",
    dark_blade:    "The Hollow sharpens itself on fear.",
    hex_trap:      "A curse with your name on it.",
    sap_weakness:  "Your magic feels heavy and sleepy, like the end of a long day.",
    shadow_shield: "Darkness thick enough to hide behind.",
    dark_mend:     "Stolen light, stitched into a wound.",
    bog_spit:      "Grubnak's favourite. Do not ask what it's made of.",
    dread_wave:    "A wave of every bad feeling you've ever had, all at once.",
    bone_crush:    "The Bone Knights never forgot how to swing.",
    rot_bloom:     "A grey flower that blooms wherever the light has been drained away.",
    hollow_drain:  "The Hollow is always hungry. Today, it's hungry for you.",
    night_terror:  "The thing under the bed, finally out from under the bed.",
    eclipse:       "Nyx's masterpiece. For a moment, there is no light anywhere.",

    // Hollow boss spells
    bog_belch:       "Grubnak's royal announcement. Everyone in range hears it. And smells it.",
    royal_croak:     "One croak from the Bog King and his whole court gets braver.",
    root_snare:      "Thornmaw's roots wrap your wand arm and squeeze the magic out.",
    thorn_lash:      "A whip of black thorns, swung by a tree that used to sing.",
    captains_cleave: "Vex learned this swing from Aldric. He just swings it angrier.",
    war_cry:         "Vex's bellow. The Hollow answers it every time.",
    iron_guard:      "Dawn Watch steel, turned to the wrong side.",
    umbral_veil:     "Nyx folds her black wings, and the shadows take the hit for her.",
    void_trap:       "A little patch of the Gloaming, waiting under your feet.",
    quill_storm:     "A flurry of Herald's quills. Each one leaves a cold, dark sting.",
    heartwood_bark:  "Thornmaw pulls its oldest bark tight. Even hollowed, the Heartoak remembers how to protect.",
    umbral_aegis:    "Nyx wraps herself in a slice of the Gloaming. Hitting it feels like shouting down a well."
  },

  itemFlavor: {
    luminary_hat:   "Stitched with thread spun from Spire lamplight.",
    luminary_robe:  "Worn by the Order's wardens on the night the Gloamgate was sealed.",
    luminary_boots: "They leave faint glowing footprints. Useful in the dark.",
    dawnfire_wand:  "Carved from a branch that grew toward the first sunrise.",
    // Reagents
    moonmoss:     "Glows brightest when nobody is looking. Gerald's favourite snack.",
    toad_slime:   "Fennick swears it's good for warts. Fennick swears a lot of things.",
    imp_horn:     "Gloom Imps file their horns to look scarier. It doesn't work.",
    shadow_fang:  "Hard as black glass and cold to the touch. Sela makes arrows from these.",
    wisp_essence: "A lost little light. It hums when you hold it close.",
    bark_heart:   "Still beats, very slowly, like a sleepy drum.",
    ember_cinder: "A spark from the night Dawnhold burned. It has never gone out.",
    bone_shard:   "From an old Dawn Watch knight. Treat it with respect.",
    hollow_ash:   "Grey dust that steals the warmth from your fingers. The Hollow King's touch.",

    // Potions
    minor_health:  "Tastes like strawberries and determination.",
    health_potion: "Tastes like strawberries, determination, and a second wind.",
    mana_potion:   "Fizzy, blue, and buzzing with spare magic. Do not shake.",

    // Shop gear (tiers: Lanternbearer L1, Wayfarer L4, Spirewarden L7, Luminary L9)
    apprentice_hat:   "Every Lanternbearer starts with a hat like this. Most of them lose it in a bog.",
    apprentice_robe:  "Standard Spire issue. Comes with one free scorch mark.",
    apprentice_boots: "Comfortable, sensible, and mostly waterproof.",
    willow_wand:      "Bendy, light and eager to please.",
    journeyman_hat:   "Taller than a Lanternbearer hat. Taller means wiser. Everyone knows that.",
    journeyman_robe:  "Cut for wizards who walk far, with reinforced stitching for the ones who keep getting hit.",
    journeyman_boots: "Pip swears they were made by elves. Pip swears a lot of things.",
    oak_wand:         "Sturdy oak with a steady aim. Brannoc approves.",
    adept_hat:        "Worn by the wardens of the Spire's stairs. Gold thread, and a brim wide enough to shelter a wisp.",
    adept_robe:       "Woven on the Spire's own looms. The hem hums when danger is near.",
    adept_boots:      "Every step leaves a faint shimmer of light behind you.",
    starsilver_wand:  "Forged from a fallen star. It still remembers how to shine.",

    // Drop gear (boss gear is a GIFT from the freed, or left behind by Nyx)
    mossy_charm:      "A pebble wrapped in Moonmoss. It smells like rain and good luck.",
    bogking_crown:    "Grubnak insisted you take it, 'for services to the bog.' It itched.",
    wolfhide_boots:   "Light as a wolf's step and twice as quiet.",
    heartwood_wand:   "The Heartoak dropped this branch at your feet, on purpose. It hums a lullaby when you hold it.",
    thornbark_robe:   "The freed Heartoak shed this bark for you, the gentle way trees give gifts. Prickly to foes, soft to you.",
    ashen_wand:       "Charred black and still warm. It remembers Dawnhold.",
    knight_amulet:    "The seal of the Dawn Watch. Sir Aldric would salute it.",
    vex_boots:        "Aldric says Vex would want them used. Vex was not asked.",
    herald_amulet:    "Nyx left it behind as she fled into the Gloaming. Aurelia cleansed it, and frowned the whole time.",

    // Boss school variants and rare drops
    bogking_crown_stoneward:   "Grubnak packed it with his best bog mud, 'for sturdiness.' It itched. Sturdily.",
    bogking_crown_tidecaller:  "Grubnak rinsed it in the clearest pool in the bog, just for you. It still itched, but damply.",
    bogking_crown_emberstrike: "Grubnak polished it with marsh-glow until it sparked. It itched, warmly.",
    gilded_bog_crown:          "Grubnak's party crown, lost in the muck for a hundred years. Pull that feather out before he sees it.",
    elderheart_robe:           "The Heartoak hummed all night to grow this for you. It still hums, very softly, when you're sad.",
    heartwood_wand_stoneward:  "A root the Heartoak pulled up just for you. It knows how to hold on, and so will you.",
    heartwood_wand_tidecaller: "Wet with fresh dew every morning. The Heartoak's way of saying 'look after yourself.'",
    heartwood_wand_emberstrike:"The Heartoak gave you its driest branch, with a slightly worried rustle.",
    gilded_marchboots:         "Vex's boots for the knighting he never got. Aldric polished them himself and won't talk about it.",
    oathbreaker_wand:          "Vex broke his squire's oath over this wand. Aldric says a wand can always swear a new one.",
    oathbreaker_wand_stoneward:  "Heavy, blunt and honest. Aldric says it suits a wizard who keeps their word.",
    oathbreaker_wand_tidecaller: "Vex's anger, washed out of it like salt from a shell. What's left is calm and cool.",
    oathbreaker_wand_emberstrike:"Still hot from Vex's temper. Aldric says it's better aimed at the Hollow than at anyone else.",
    eclipse_cowl:              "A scrap of Nyx's shadow, snagged on the Gloamgate as she fled. Aurelia made it wearable, under protest.",
    eclipse_cowl_stoneward:    "Nyx's shadow, pressed hard as slate. Darkness makes a fine wall when it's on your side.",
    eclipse_cowl_tidecaller:   "Nyx's shadow, soft as the night tide. It pulls a little light back from every blow.",
    eclipse_cowl_emberstrike:  "Nyx's shadow, set on fire by an overexcited Ignis. He calls it 'an improvement.'",
    starless_crown:            "Nyx's own crown, dropped at the Gloamgate. Aurelia glances at it when she thinks you aren't looking.",

    // Crafted amulets (Pip Quickcoin)
    moonglow_charm:     "Pip pressed Moonmoss into silver and called it 'artisanal.' It does glow very nicely.",
    wildwood_talisman:  "Shadow Fang, Bark Heart and wisp light, knotted together. Pip says it's lucky. Wren says it's science.",
    emberheart_pendant: "A Dawnhold cinder in a cage of old Watch bone. Warm against your chest, like a promise kept.",
    lumen_sigil:        "The Order's sun glyph, set in Hollow Ash made bright again. Even the Hollow's leavings can learn to shine."
  },

  enemyLines: {
    hollow_sprite:  { bestiary: "Tiny Hollow pests that nibble the glow out of lanterns, moss and anything else that shines." },
    rot_toad:       { bestiary: "Once cheerful bog toads, soured by Hollow magic seeping up from the mud. They spit curses and worse." },
    gloom_imp:      { bestiary: "Cackling sock thieves who take orders from anyone scarier than they are. Which is almost everyone." },
    grubnak:        { bestiary: "A harmless old toad king, puffed up into a tyrant by a Herald's quill. He really just wants to sing." },
    hollow_wolf:    { bestiary: "Grey wolves turned to shadow and hunger. They hunt in packs and herd prey toward the heart of the wood." },
    bramble_ghoul:  { bestiary: "Dead thorns and old grudges, grown into walking shapes. Where they step, the forest loses its colour." },
    thorn_sprout:   { bestiary: "Thornmaw's angry seedlings. Small, loud and pointy." },
    thornmaw:       { bestiary: "Once the Heartoak, who sang Whisperwood to sleep. A Hollow seed planted in its heart turned the song to rot." },
    ash_wraith:     { bestiary: "The fire that destroyed Dawnhold, still drifting through the ruins. Nyx has given them a purpose." },
    bone_knight:    { bestiary: "The fallen Dawn Watch, raised by the Hollow. They still wear the old gold, faded to grey." },
    hollow_acolyte: { bestiary: "Hooded devotees of the Hollow Court who chant stolen light into the Gloamgate." },
    captain_vex:    { bestiary: "Once Sir Aldric's squire, now captain of Nyx's guard. The Hollow fed on his anger until it was all he had left." },
    nyx_herald:     { bestiary: "Herald of the Hollow King. She slips through the cracks of the Gloamgate on black wings, planting quills of shadow." }
  },

  bossLines: {
    grubnak: {
      intro: [
        "*BRRROAK!* Who dares squelch into the royal bog?",
        "The feather says Grubnak is king of EVERYTHING now. The feather is very persuasive.",
        "Kneel, little wizard! Or Grubnak will sit on you!"
      ],
      phase: "The feather is so COLD... Grubnak doesn't like this song anymore!",
      freed: "Oh... my head. Was Grubnak shouting? So sorry. Would you like a song instead? It's a good one."
    },
    thornmaw: {
      intro: [
        "*the ground shudders as ancient roots tear free of the earth*",
        "SMALL... BRIGHT... THING...",
        "SLEEP. SLEEP AND GO GREY, LIKE ALL THE REST."
      ],
      phase: "THE SEED... BURNS... SO HUNGRY... SO COLD...",
      freed: "...Ahh. The cold is gone. Thank you, little one. Now let me sing my forest back to sleep."
    },
    captain_vex: {
      intro: [
        "So you're the one tramping through my ruins.",
        "Aldric taught me everything. Then he taught me to wait. I'm done waiting.",
        "Draw your wand. I'll make this quick."
      ],
      phase: "Why won't you FALL? I was meant to be a knight! I was meant to be enough!",
      // v2.0 WS-E (R11): Vex kept what Aurelia sent him to dig for (story.md Ripening Rule 3)
      freed: "...Sir Aldric? Tell him I'm sorry. Tell Aurelia I found what she sent me for. Then tell her I'm keeping it."
    },
    nyx_herald: {
      intro: [
        "So. The little light who keeps pulling out my feathers.",
        "A toad, a tree, an angry boy. I gave them purpose. You gave them back their small lives.",
        "Let me show you what waits in the Gloaming."
      ],
      phase: "You burn brighter than I expected. No matter. Every candle gutters in the end.",
      // v2.0 WS-E (R6): Nyx's parting line. She is banished, never freed (no gold mote, R17).
      freed: "Shine while you can, little lamp. Lamps are made to be emptied.",
      banished: true
    }
  },

  trainerLines: {
    brannoc: {
      learn:   "Hm. You've grown, {name}. Time for heavier rocks. Learn these slowly. Then never forget them.",
      train:   "Not a Stoneward, but you want to stand firm? Good. The mountain doesn't care who stands on it.",
      nothing: "Nothing new today, {name}. Come back when you've grown. Mountains don't rush."
    },
    maris: {
      learn:   "The tide has risen in you, {name}. Here are new spells to carry it. Use them kindly.",
      train:   "Another school, come to drink from the sea? Wise. Everyone needs water eventually.",
      nothing: "Nothing new yet, {name}. Let the tide come in on its own. It always does."
    },
    ignis: {
      learn:   "{name}! LOOK AT YOU! New spells! BIGGER spells! Try not to set the Spire on fire! ...Much!",
      train:   "Another school wants to learn FIRE? YES! Finally, someone with taste! Stand back!",
      nothing: "Nothing new yet! I KNOW! Tragic! Go out, grow stronger, then come back and we'll explode things!"
    }
  },

  ui: {
    welcome:         "Welcome to Lanternmere, {name}! Talk to Headmistress Aurelia by the Spire. Look for the gold \"!\" above her head.",
    controlsHint:    "WASD to move. Drag the mouse to look around. Press E to talk to people nearby.",
    noPotions:       "No potions left! Pip Quickcoin sells them in Lanternmere, and Wren sells them in Whisperwood.",
    defeat:          "You were defeated! The Spire's healers carried you home to Lanternmere. Dust off your hat and try again.",
    trainerReminder: "{trainer} has new spells for you!",
    // v1.1 mounts
    noMount:         "You have no mount yet. Visit <b>Hollis Brightmane</b> at the stables in Lanternmere.",
    noMountTitle:    "No mount yet: visit Hollis at the Brightmane Stables (Lanternmere)",
    stableEmpty:     "<p><b>Your stable is empty.</b></p><p class=\"dim\">Visit <b>Hollis Brightmane</b> at the Brightmane Stables in Lanternmere (east of the fountain). He sells ponies and horses, and has a little job for a hero who has freed the Bog King.</p><p class=\"dim\">Rare mounts sometimes drop from bosses and elites.</p>"
  }
};

// ---- v1.2 WS4: The Hollow Orrery (post-game dungeon) ----
// World bible: docs/design/lore.md §12. The Orrery of Dawnhold is the Dawn
// Watch's great brass model of the sky. When Nyx cracked the Gloamgate, the
// Hollow seeped down into the star-vault and a lord of the Hollow Court, the
// Starless Archon, made a throne of the Orrery, putting its stars out one by
// one. The Orrery remembers that night and replays it every time it turns,
// which is why its guardians (echoes) return on every visit.
(function (L) {
  L.zoneIntros.hollow_orrery = "The Hollow Orrery. Beneath burned Dawnhold, the Watch's great brass map of the sky still turns in the dark. " +
    "Every star on it has gone out, and something enormous sits at its heart, keeping them.";

  L.enemyLines.shard_hound = { bestiary: "Hollow beasts grown from shattered star-glass. They hunt anything that shines, and they can smell a lantern a mile off." };
  L.enemyLines.orrery_seer = { bestiary: "Astronomers of the Hollow Court. They read the stars only to count how many are left to take." };
  L.enemyLines.orrery_sentinel = { bestiary: "A brass-and-obsidian guardian the Watch built to keep the Orrery safe. The Hollow taught it that visitors are thieves." };
  L.enemyLines.warden_morrow = { bestiary: "The last Star-Warden of the Dawn Watch, who sealed himself in with the Orrery on the Night of Ash and never came out." };
  L.enemyLines.starless_archon = { bestiary: "A lord of the Hollow Court who collects starlight the way misers collect coins. It wears a cracked mask and calls the dark 'safe'." };

  L.bossLines.orrery_sentinel = {
    intro: [
      "*brass rings grind awake, and a ring of black stones begins to orbit the Sentinel's head*",
      "VISITOR LOG: ONE WIZARD. PURPOSE: THEFT. RESPONSE: REMOVAL.",
      "PLEASE STAND STILL. THIS WILL BE TIDIER FOR EVERYONE."
    ],
    phase: "WARNING. WARNING. THE HOLLOW... IS NOT... IN MY INSTRUCTIONS...",
    freed: "SYSTEMS... CLEAR. GOOD MORNING, VISITOR. THE GALLERY IS OPEN. PLEASE MIND THE LENSES."
  };
  L.bossLines.warden_morrow = {
    intro: [
      "Three hundred years I have kept this door. Three hundred years, and not one star stolen on my watch.",
      "The dark told me I could keep them all. Every last one. Safe.",
      "You will not take them from me."
    ],
    phase: "Why is it so cold? A Warden's lantern should be warm... why is mine so cold?",
    // v2.0 WS-E (R12, plant B5)
    freed: "Is it dawn? ...It is. Thank you, Star-Warden. The Order told us to guard the lenses. Not what they were for."
  };
  L.bossLines.starless_archon = {
    intro: [
      "Ah. A little lamp, wandering loose in my sky.",     // v2.0 WS-E (R4): was "little star" (states the L30 reveal)
      "Do you know what happens to stars, candle? They fall. They burn out. Unless someone keeps them.",
      "I keep them all. Let me keep you. The first one is still hungry."     // v2.0 WS-E (R13, plant C2)
    ],
    phase: "You shine too brightly. Orrery, TURN! Show this one how dark the sky can be!",
    freed: "Turn the Orrery again, candle. I will be waiting in the dark between the turnings.",
    banished: true          // v2.0 WS-E: a lord of the Hollow Court scatters; it is not freed (no gold mote)
  };

  var F = {
    prism_fang:         "A bite like a cracked lens: it bends the light right out of you.",
    splinter_rake:      "Star-glass shards that keep working their way in long after the claws are gone.",
    lens_flare:         "The Seer tilts its lens and the light comes back wrong, hot and sharp and violet.",
    ill_omen:           "A bad star, read aloud. Your next spell can't stop thinking about it.",
    starlit_mend:       "Stolen starlight, poured into the wrong hands. It still heals. It just doesn't feel nice about it.",
    orbit_crush:        "Every stone in the Sentinel's orbit, brought down at once. The floor tiles have stopped complaining.",
    stone_volley:       "A few orbiting stones let go of their orbit, all in your direction.",
    lodestone_snare:    "A lodestone set under your feet. The next Hollow blow is pulled straight to you.",
    orbit_ward:         "The black stones spin close and fast, a ring that swallows blows.",
    overclock:          "Someone removed the governor. The Sentinel is very, very pleased about it.",
    dusk_lantern:       "A Warden's lantern, turned inside out. It shines darkness, and the darkness has weight.",
    broken_oath:        "A blow struck with the full weight of a promise kept far too long.",
    grave_vigil:        "The lantern-light lingers on you like a vigil that never ends.",
    wardens_vow:        "'Not one star stolen on my watch.' He means it. He means it far too much.",
    dimming_snare:      "The lantern dims around you, and the dark leans closer to listen.",
    last_lantern:       "Morrow cups the last light of his lantern in both hands and hides behind it.",
    starless_collapse:  "The Archon folds a patch of sky in on itself and drops it on you.",
    black_planet:       "A small dark world, set orbiting you. It gets heavier every round.",
    void_constellation: "New stars appear around you, in the shape of a target.",
    starless_veil:      "A curtain of starless night. Spells sink into it and don't come out.",
    nadir_mantle:       "The Archon wraps itself in the lowest point of the sky.",
    // boss-earned spells (quest d01): the stars the Archon stole, choosing a new keeper
    orrery_quake_ascendant: "A fallen star lands on every foe at once, and its brass shell stays to guard you.",
    orrery_tide_ascendant:  "Starlit water crashes over every foe, then flows back to mend you for three rounds.",
    orrery_flare_ascendant: "A star bursts over every foe and leaves a mark that the next Emberstrike blow will find."
  };
  Object.keys(F).forEach(function (k) { L.cardFlavor[k] = F[k]; });

  // Lines the dungeon flow shows (world.js W.dungeon). Door keys = door ids in dungeons.js.
  L.dungeonLines = L.dungeonLines || {};
  L.dungeonLines.hollow_orrery = {
    enter:   "The Orrery winds itself back with a long brass sigh. Every star door is sealed again.",
    doors: {
      door_gallery: "The first star door turns. Somewhere below, gears the size of houses begin to move.",
      door_rotunda: "The Sentinel winds down, and the next star door rolls open.",
      door_heart:   "Morrow sets down his lantern. The last door opens on the Heart of the Orrery."
    },
    cleared: "The Archon scatters into the dark between the stars. A way home shimmers open beside the great Orrery.",
    chest:   "The Orrery's star-chest clicks open: the vault rewards the bold.",
    locked:  "The star door is sealed. Free the guardian of this room to open it.",
    // v2.1 drop hints (game/js/dropHints.js, the Orrery keeper's "What do the guardians carry?"): UI text, not voiced
    dropHints: {
      button: 'What do the guardians carry?',
      intro: 'Each guardian keeps its own pieces of the Starbound regalia, and the Orrery only ever gives you pieces cut for your own school. Here is what each one carries for a {school}:',
      tiers: 'T1 Starbound, T2 Radiant (rarer), T3 Ascendant (very rare). Tamsin Gearwright in Lanternmere can raise a piece one tier with Star Shards, Archon Cores and Starlight Essence.',
      back: 'Back'
    }
  };
  L.ui.portalNeedsQuest = 'Complete "{quest}" first.';
  L.ui.portalNeedsLevel = 'Reach level {level} first.';
  L.ui.portalNeedsDungeon = 'Clear {dungeon} once first.';     // v2.1: the world-exit gate (requires.dungeon)
})(WF.data.lore);

// ---- v2.0 WS-E: story retrofits (docs/design/story.md §9 R1-R17; docs/design/story-retrofits-v2.0.md) ----
// Read by game/js/story.js (WF.story). Every line here is spoken (tools/voice-lines.js finds them).
// "Seen" state lives in the wizard's save as p.storyFlags[id] (V2.0-CONTRACT §9).
//
//  endCard        the ending line ui.js shows as the chapter's closing card (R16)
//  storyAsides    one extra line an NPC adds to a conversation, once per wizard:
//                   on: 'turnIn'  appended after a quest's complete lines when you turn a quest in to `npc`
//                                 and max(your level, the quest's level) >= `level`. Only the highest pending
//                                 aside plays; lower ones are marked seen with it (B2, R7).
//                   on: 'greet'   appended to the first plain greeting (no quest business) from `npc` (A8, B4, R15).
//                 Ids are flag names: never rename one (the save remembers it). Next milestone = one more entry.
//  vignettes      a short in-world beat after a quest's turn-in, before anything else that quest shows
//                 (the chapter ending): camera on `npc`, tilt up to the Spire's flame, the flame gutters
//                 once, back to `npc`, who says `lines` (a normal, skippable dialogue). Plays once (B3, R7).
//  storyTriggers  a line heard once when you walk within `radius` of `near` in `zone` while `unlessDefeated`
//                 still stands: shown as a toast, voiced by `speaker` (C1, R10).
//  storyFx        A7 (R5): the chance per Lanternmere visit that the Spire's flame leans toward you once.
(function (L) {
  L.endCard = "Far away, the Hollow King turned his gaze toward the student who frees what he hollows.";

  L.storyAsides = [
    { id: 'b2_l5',     npc: 'aurelia',       on: 'turnIn', level: 5,  line: "You're coming along beautifully." },
    { id: 'b2_l10',    npc: 'aurelia',       on: 'turnIn', level: 10, line: "Brighter every day." },
    { id: 'a8_keeper', npc: 'orrery_keeper', on: 'greet',             line: "You remind me of someone. Several someones." },
    { id: 'b4_vault',  npc: 'banker',        on: 'greet',             line: "The deep vault is sealed by the Headmistress. Not even I hold that key." },
    { id: 'r15_tomas', npc: 'guard_tomas',   on: 'greet',             line: "Night shift in Mosslight again. Don't ask." }
  ];

  L.vignettes = {
    not_yet: { id: 'vig_not_yet', after: 'm17', zone: 'lumen_commons', npc: 'aurelia', gutter: true, lines: ["Not yet."] }
  };

  L.storyTriggers = [
    { id: 'c1_dais', zone: 'hollow_orrery', near: [0, -40], radius: 11, unlessDefeated: 'starless_archon',
      speaker: 'orrery_keeper', via: 'his voice drifts down from the Hall of Hours',
      line: "It was the first of us. Be kind to it, if you can." }
  ];

  L.storyFx = { spireFlicker: { zone: 'lumen_commons', chance: 0.2 } };
})(WF.data.lore);
