// =====================================================================
//  WIZZIE FARM — QUESTS
//
//  Object key order = quest log order. Main chain m01..m17, side s01..s07 (s07 = v1.1 first-mount quest).
//  m17 has `final: true` (the engine shows lore.ending after its turn-in).
//
//  TONE RULE (docs/design/lore.md §2): beings that were once good (toads,
//  wolves, Grubnak, Thornmaw, the Dawn Watch, Vex) are FREED, never killed.
//  Creatures made of Hollow (sprites, ghouls, wraiths, Nyx) may be banished,
//  scattered or laid to rest. The hub's display name is "Lanternmere"
//  (zone id stays lumen_commons). Single-use spells are "Spell Scrolls".
//  Schema: see docs/ARCHITECTURE.md. XP values and objectives are owned by
//  the systems team (progression pacing) — change text freely, numbers carefully.
//
//  Portal gates (zones.js): Whisperwood needs m06 done, Ashen Ruins needs m11.
//
//  Tokens: {name} = player name, {school} = player's school name.
//
//  Optional, non-breaking extra on 'talk' objectives:
//    lines:       ['...']                       what the talk target says when reached
//    schoolLines: { stoneward:[...], ... }      same, per school (used with npc '@trainer')
//  The engine may ignore these; nothing depends on them.
//
//  TO ADD MORE QUESTS (future update): append m18+, s08+ below, with prereq
//  pointing at the last quest of the previous chain (m17).
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.quests = {

  // ================================================== ACT I — MOSSLIGHT PATH (L1–3)

  m01: {
    name: 'A New Wizard',
    giver: 'aurelia', turnIn: 'aurelia',
    level: 1, prereq: [],
    offer: [
      "Ah, {name}! Welcome to the Lumen Spire. Mind the stairs. They rearrange themselves on Tuesdays.",
      "Every new student needs a master. Yours is out in Lanternmere Square, wearing a great deal of {school} colour.",
      "Go and introduce yourself. Then come back, and I'll give you something to keep you alive."
    ],
    progress: ["Your {school} master is somewhere in Lanternmere Square. Look for the robes. And the ego."],
    complete: [
      "Wonderful. You still have both eyebrows, so the meeting went well.",
      "Take this: Lumen Mend. Every wizard of the Order learns it first. Healing is never the wrong spell."
    ],
    objectives: [
      { type: 'talk', npc: '@trainer',
        schoolLines: {
          stoneward: [
            "So. Aurelia sent me another pebble.",
            "Good. Pebbles become mountains. Slowly. Stand firm, {name}, and nothing will move you."
          ],
          tidecaller: [
            "The tide brought you to me, {name}. It usually knows what it's doing.",
            "Breathe in, heal. Breathe out, strike. That's the whole lesson. The rest is practice."
          ],
          emberstrike: [
            "A NEW EMBER! Finally! Can you throw a fireball yet? No? You WILL!",
            "Rule one: hit first. Rule two: hit harder. Rule three: stand well away from the curtains."
          ]
        } }
    ],
    rewards: { xp: 40, gold: 10, cards: ['lumen_mend'] },
    main: true
  },

  m02: {
    name: 'Shadows on Mosslight Path',
    giver: 'aurelia', turnIn: 'fennick',
    level: 1, prereq: ['m01'],
    offer: [
      "Now, a small task. Something has been snuffing out the lanterns on Mosslight Path.",
      "Hollow Sprites. Pests, really. But pests don't usually wander so close to the Spire.",
      "Scatter three of them, then find Old Fennick. He lives on the path. In a mushroom, I believe."
    ],
    progress: ["Three Hollow Sprites, then Old Fennick. Follow the glowing moss and the sound of someone chatting to fungi."],
    complete: [
      "Eh? Who are you? Aurelia sent you? Splendid! I've been expecting you for... how long, Gerald?",
      "Gerald is my mushroom. He says thank you. Those sprites kept nibbling his glow."
    ],
    objectives: [{ type: 'kill', enemy: 'hollow_sprite', count: 3 }],
    rewards: { xp: 80, gold: 20, items: { minor_health: 1, apprentice_robe: 1 } },
    main: true
  },

  m03: {
    name: 'Toads Most Foul',
    giver: 'fennick', turnIn: 'fennick',
    level: 2, prereq: ['m02'],
    offer: [
      "Now then, young sprout. The bog toads used to be lovely. Green. Croaky. A bit dim.",
      "Then the Hollow seeped into the bog, and now they're rotten through and spit curses. Rude!",
      "Shake the Hollow out of four Rot Toads for me, would you? Mind the slime. It never comes out of robes."
    ],
    progress: ["Four Rot Toads, sprout. Gerald is counting. Gerald can't count, but he's trying."],
    complete: [
      "Ha! Four toads back to plain old croaking. You smell terrible, which means you did it properly.",
      "Moss has glowed brighter since you showed up. Probably the fertilizer.",     // v2.0 WS-E (R2, plant A3)
      "Something is pulling the Hollow up out of that bog, though. Something big. I don't like it."
    ],
    objectives: [{ type: 'kill', enemy: 'rot_toad', count: 4 }],
    rewards: { xp: 110, gold: 25, items: { apprentice_boots: 1 } },
    main: true
  },

  s01: {
    name: 'Moonmoss for Gerald',
    giver: 'fennick', turnIn: 'fennick',
    level: 2, prereq: ['m02'],
    offer: [
      "Gerald's feeling peaky. The Hollow got into his roots. Poor fellow's barely glowing.",
      "Bring me five tufts of Moonmoss. The creatures on the path hoard it, the greedy little magpies.",
      "I'll brew him a tonic, and you a potion or two. If there's any left. Which there will be. Probably."
    ],
    progress: ["Five Moonmoss, sprout. Gerald is being very brave about it."],
    complete: [
      "Lovely! Look at him glow! ...Well. Squint a bit. He's glowing on the inside.",
      "Here, two potions for your trouble. Brewed with only a very small amount of mushroom."
    ],
    objectives: [{ type: 'collect', item: 'moonmoss', count: 5 }],
    rewards: { xp: 90, gold: 25, items: { minor_health: 2 } },
    main: false
  },

  s06: {
    name: 'Relight the Path',
    giver: 'fennick', turnIn: 'fennick',
    level: 2, prereq: ['m02'],
    offer: [
      "Those sprites nibbled half the lanterns on the path dark, sprout. Now the toads can't see to sing.",
      "Walk up to each one and give it a bit of light. A little Lumen spark, a kind word. Lanterns like that.",
      "Light four of them and Mosslight will feel like home again. Gerald's scared of the dark. Don't tell him I said."
    ],
    progress: ["Four snuffed lanterns, sprout. Any four. Get close and give each one a little light."],
    complete: [
      "Huh. Usually takes flint.",     // v2.0 WS-E (R2, plant A4): you lit them by touch
      "Look at that! Glowing like a summer evening. Gerald's stopped hiding under his own cap.",
      "Here, potions I brewed by lantern-light. Everything tastes better by lantern-light. Even mushroom."
    ],
    objectives: [{ type: 'interact', kind: 'relight', zone: 'mosslight_path', count: 4 }],
    rewards: { xp: 120, gold: 20, items: { minor_health: 2, mana_potion: 1 } },
    main: false
  },

  m04: {
    name: 'The Imp Problem',
    giver: 'fennick', turnIn: 'fennick',
    level: 3, prereq: ['m03'],
    offer: [
      "Imps! Gloom Imps, on MY path! Cackling at all hours. Stealing my socks.",
      "They're not wild creatures, sprout. Imps take orders. Somebody sent them.",
      "Knock the gloom out of four of them and see if one squeaks about who's in charge."
    ],
    progress: ["Four Gloom Imps. And if you find my left sock, I'd be ever so grateful."],
    complete: [
      "Well? Did they talk? ...'The Bog King rises,' they said? Oh, bother. Oh, bother and blight.",
      "Grubnak. Used to be a harmless old toad king. Ate flies, sang badly. The Hollow's made him something worse."
    ],
    objectives: [{ type: 'kill', enemy: 'gloom_imp', count: 4 }],
    rewards: { xp: 150, gold: 35, items: { apprentice_hat: 1 } },
    main: true
  },

  m05: {
    name: 'Grubnak the Bog King',
    giver: 'fennick', turnIn: 'fennick',
    level: 3, prereq: ['m04'],
    offer: [
      "Grubnak squats on his throne of muck at the far end of the bog, all puffed up on Hollow magic.",
      "He's tougher than anything you've faced, sprout. Bring potions. Bring friends. Well. Bring potions.",
      "Break the Hollow's hold on that old toad, and Mosslight can breathe again."
    ],
    progress: ["Grubnak's at the far end of the bog. Follow the smell. You'll know it when you find it."],
    complete: [
      "You did it! The bog's clearing already. Listen! Frogs singing! Normal, terrible frog songs!",
      "Take this: Lumen Blade. Aurelia gave it to me forty years ago. I've mostly used it to slice cheese.",
      "And something odd. Grubnak was clutching a black feather, cold as midnight. Aurelia must see this."
    ],
    objectives: [{ type: 'kill', enemy: 'grubnak', count: 1 }],
    rewards: { xp: 250, gold: 60, items: { minor_health: 3, mana_potion: 2 }, cards: ['lumen_blade'] },
    main: true
  },

  m06: {
    name: 'Report to the Headmistress',
    giver: 'fennick', turnIn: 'aurelia',
    level: 3, prereq: ['m05'],
    offer: [
      "Take this feather to Aurelia at the Spire. Hurry, but don't run. Running is how you trip over Gerald.",
      "And tell her old Fennick says... hm. Tell her hello. And that I'm nearly out of cheese."
    ],
    progress: ["Aurelia's in Lanternmere, by the Spire. Can't miss her. She glows a bit."],
    complete: [
      "A black feather that drinks the light... a Herald's quill. I had hoped never to see one again.",
      "Someone in the Hollow Court is giving orders, {name}. Grubnak was the puppet, not the hand.",
      "I've opened the portal to Whisperwood. Our ranger there has been sending me worrying letters."
    ],
    objectives: [{ type: 'talk', npc: 'aurelia' }],
    rewards: { xp: 60, gold: 40 },
    main: true
  },

  // v1.1 side quest: your first mount (Lanternmere, right after Grubnak)
  s07: {
    name: 'A Steed of Your Own',
    giver: 'hollis', turnIn: 'hollis',
    level: 3, prereq: ['m05'],
    offer: [
      "You're the one who freed the Bog King? Then you're the one who needs a pony. Heroes walk too slowly. It's embarrassing.",
      "Trouble is, my best little pony, Clover, slipped her halter this morning. Again.",
      "Guard Tomas was on the east gate. Ask him which way she went, then fetch her back, and she's yours to keep."
    ],
    progress: ["No Clover yet? Try Tomas at the east gate, then follow the smell of apples."],
    complete: [
      "There she is! Look at that face. Not a shred of guilt.",
      "Clover's yours now, {name}. Press R to call her, and R again to send her home. Ride well!"
    ],
    objectives: [
      { type: 'talk', npc: 'guard_tomas', lines: [
        "A pony? Small, round, extremely suspicious? She charged the gate at dawn! I held my ground! Bravely! ...She went around me.",
        "Last I saw, she was trotting toward the market. Toward Pip's apples. Hungry criminals always go for the apples."
      ] },
      { type: 'talk', npc: 'pip_quickcoin', lines: [
        "Your pony ate eleven apples, one hat and most of a receipt! Who's paying for the hat?",
        "...Fine, fine. On the house. Just get her away from my stall before she starts on the robes."
      ] }
    ],
    rewards: { xp: 60, items: { mount_pony_clover: 1 } }
  },

  // ================================================== ACT II — WHISPERWOOD (L3–6)
  m07: {
    name: 'Into the Whisperwood',
    giver: 'aurelia', turnIn: 'sela',
    level: 4, prereq: ['m06'],
    offer: [
      "Whisperwood is the oldest forest in the realm. Its trees used to whisper lullabies.",
      "Lately they whisper something else. Ranger Sela will explain. Probably not kindly.",
      "Take the new portal in Lanternmere Square. And {name}? Stay on the path. The trees are listening."
    ],
    progress: ["The Whisperwood portal is open in Lanternmere Square. Find Ranger Sela on the other side."],
    complete: [
      "You're the new {school} wizard? Hm. Taller than the letter said. Shorter than I hoped.",
      "Letter says you freed the Bog King. We banish. You... free. How?",     // v2.0 WS-E (R3, plant A5)
      "I'm Sela. I keep this forest alive. Lately that's a full-time job, plus overtime."
    ],
    objectives: [{ type: 'visit', zone: 'whisperwood' }],
    rewards: { xp: 40, gold: 40 },
    main: true
  },

  m08: {
    name: 'Wolves in the Mist',
    giver: 'sela', turnIn: 'sela',
    level: 4, prereq: ['m07'],
    offer: [
      "Hollow Wolves. Used to be plain grey wolves. Now they're shadow, teeth and bad attitude.",
      "They hunt in packs and they've been circling my camp. I'm out of patience and nearly out of arrows.",
      "Shake the shadow off five of them. Don't let them flank you. Don't let them howl. Don't— just go."
    ],
    progress: ["Five wolves. You're still in one piece, so I'm guessing you haven't found them yet."],
    complete: [
      "Five wolves, plain grey again and bolting for home. Not bad, {name}.",
      "You fight like someone who'd like to keep their face.",
      "Thing is, they weren't running wild. They were herding. Pushing everything toward the heart of the wood."
    ],
    objectives: [{ type: 'kill', enemy: 'hollow_wolf', count: 5 }],
    rewards: { xp: 260, gold: 70 },
    main: true
  },

  s02: {
    name: 'A Fistful of Fangs',
    giver: 'sela', turnIn: 'sela',
    level: 4, prereq: ['m07'],
    offer: [
      "Wolf fangs. Shadow Fangs, technically. The Hollow hardens them into something like black glass.",
      "Bring me six. I make arrowheads out of them. Fight darkness with darkness. Sharpened."
    ],
    progress: ["Six Shadow Fangs. The wolves are still using them. Persuade them otherwise."],
    complete: [
      "Good haul. These'll make arrows that bite back.",
      "I'd say thanks, but you'd only get used to it."
    ],
    objectives: [{ type: 'collect', item: 'shadow_fang', count: 6 }],
    rewards: { xp: 200, gold: 60, items: { minor_health: 2 } },
    main: false
  },

  m09: {
    name: 'The Bramble Dead',
    giver: 'sela', turnIn: 'sela',
    level: 5, prereq: ['m08'],
    offer: [
      "Bramble Ghouls. The Hollow grew them out of dead thorns and old grudges.",
      "Wherever they walk, the forest goes grey. Five of them are creeping up the north trail.",
      "Cut them down before it spreads. And don't let them hug you. They're very huggy. Spiky huggy."
    ],
    progress: ["Five ghouls. If it's thorny, grey and moaning, it counts."],
    complete: [
      "The grey's already fading where they fell. Good work.",
      "I followed their tracks. Every root leads to the same place. The heart of the wood. Thornmaw."
    ],
    objectives: [{ type: 'kill', enemy: 'bramble_ghoul', count: 5 }],
    rewards: { xp: 320, gold: 85 },
    main: true
  },

  s03: {
    name: 'Light in a Jar',
    giver: 'wren', turnIn: 'wren',
    level: 5, prereq: ['m07'],
    offer: [
      "Oh! Hi! You're the wizard! Sela said you'd be grumpy. You're not grumpy. Great!",
      "The Hollow keeps snuffing out the forest wisps, and their light is just... floating around, lost.",
      "Bring me five Wisp Essences and I'll bottle them safe! Science! Also kindness! Mostly science!"
    ],
    progress: ["Five Wisp Essences! Gently, please. They're shy. And very slightly explosive."],
    complete: [
      "Five! Look at them glow! I'm calling this one Sparkles. And this one Sparkles Two.",
      "I bottled a little of their light into a spell for you. Lumen Ward! It's like a hug, but for being hit!"
    ],
    objectives: [{ type: 'collect', item: 'wisp_essence', count: 5 }],
    rewards: { xp: 250, gold: 70, cards: ['lumen_ward'] },
    main: false
  },

  m10: {
    name: 'Thornmaw, Heart of Rot',
    giver: 'sela', turnIn: 'sela',
    level: 6, prereq: ['m09'],
    offer: [
      "Thornmaw was the Heartoak. Oldest tree in Whisperwood. It sang the whole forest to sleep.",
      "Someone planted a Hollow seed in its heart. Now it's rotting the wood from the roots up.",
      "It'll throw sprouts at you. Ignore the small stuff, hit the big stuff. That's all the advice I've got."
    ],
    progress: ["Thornmaw is at the heart of the wood. Follow the grey. Bring potions. Bring more potions."],
    complete: [
      "...Listen. Hear that? The trees. They're whispering again. Actual lullabies.",
      "You saved my forest, {name}. Take this. Sunburst. My mentor's spell. She would've liked you.",
      "Found this in the roots, too. Another black feather. Someone is planting these. Go tell Aurelia."
    ],
    objectives: [{ type: 'kill', enemy: 'thornmaw', count: 1 }],
    rewards: { xp: 450, gold: 140, items: { health_potion: 2, mana_potion: 2 }, cards: ['sunburst'] },
    main: true
  },

  m11: {
    name: 'Feathers and Questions',
    giver: 'sela', turnIn: 'aurelia',
    level: 6, prereq: ['m10'],
    offer: [
      "Two feathers, two corrupted guardians. That's not bad luck. That's a plan.",
      "Take it to Aurelia. And {name}... thanks. Tell anyone I said that and I'll deny it."
    ],
    progress: ["Aurelia. Back in Lanternmere. Go. The forest will keep."],
    complete: [
      "A second Herald's quill. Then it's true. Nyx, Herald of the Hollow King, walks our lands again.",
      "She drains the guardian of each land to feed something in the Ashen Ruins. Our old fortress.",
      "I've opened the way. Sir Aldric keeps watch there. Go carefully, {name}. Nyx does not play fair."
    ],
    objectives: [{ type: 'talk', npc: 'aurelia' }],
    rewards: { xp: 100, gold: 80, items: { health_potion: 1 } },
    main: true
  },

  // ================================================== ACT III — ASHEN RUINS (L6–10)

  m12: {
    name: 'Ashes of Dawnhold',
    giver: 'aurelia', turnIn: 'aldric',
    level: 7, prereq: ['m11'],
    offer: [
      "The Ashen Ruins were once Dawnhold, the shining citadel of the Lumen Order.",
      "Three hundred years ago the Hollow King burned it in a single night. We never rebuilt.",
      "Sir Aldric is the last paladin who still keeps watch there. He'll be... thrilled to meet you."
    ],
    progress: ["The Ashen Ruins portal is open in Lanternmere Square. Find Sir Aldric among the broken towers."],
    complete: [
      "HALT! Who goes— oh. A student. Aurelia's letter said 'promising.' You'll do. You'll have to.",
      "Sir Aldric of the Dawn Watch, at your service. The last of the Watch, technically. Long story. Sad story."
    ],
    objectives: [{ type: 'visit', zone: 'ashen_ruins' }],
    rewards: { xp: 60, gold: 80 },
    main: true
  },

  m13: {
    name: 'The Restless Ash',
    giver: 'aldric', turnIn: 'aldric',
    level: 7, prereq: ['m12'],
    offer: [
      "The fire that burned Dawnhold never truly went out. It lingers here as Ash Wraiths.",
      "They used to simply drift about, moaning. Now Nyx has given them purpose. Purpose is never good.",
      "Six of them, brave {school} wizard. Lay them to rest, so the old stones may sleep."
    ],
    progress: ["Six Ash Wraiths. They hate cold, calm and courage. Bring at least one of those."],
    complete: [
      "Well struck! The air feels lighter already. Less smoky. Slightly less tragic.",
      "I've fought them alone for months. It's... nice to have help. Do not tell anyone a knight said that."
    ],
    objectives: [{ type: 'kill', enemy: 'ash_wraith', count: 6 }],
    rewards: { xp: 420, gold: 150 },
    main: true
  },

  m14: {
    name: 'Knights Without Names',
    giver: 'aldric', turnIn: 'aldric',
    level: 8, prereq: ['m13'],
    offer: [
      "The Bone Knights were once the Dawn Watch. My brothers and sisters in arms.",
      "The Hollow raised them as its soldiers. They still wear our colours. It is... difficult to look at.",
      "Six of them guard the inner gate. Free them, {name}. Please. I can't do it alone. I've tried."
    ],
    progress: ["Six Bone Knights. Strike true. They would want you to."],
    complete: [
      "It is done. Rest well, old friends. Your watch is over.",
      "Take this, {name}. Dawn Trap. The Watch's oldest spell. Our way of saying 'come and try it.'"
    ],
    objectives: [{ type: 'kill', enemy: 'bone_knight', count: 6 }],
    rewards: { xp: 480, gold: 180, cards: ['dawn_trap'] },
    main: true
  },

  s04: {
    name: 'Embers That Remember',
    giver: 'aldric', turnIn: 'aldric',
    level: 8, prereq: ['m13'],
    offer: [
      "The Ember Cinders here never cool. Each one is a spark from the night Dawnhold fell.",
      "Gather eight from the wraiths. I shall light a memorial flame. A proper one. Not a sad one."
    ],
    progress: ["Eight Ember Cinders. Handle with care. And gloves. Mostly gloves."],
    complete: [
      "Behold! A memorial flame for Dawnhold. Warm. Bright. Hardly any wailing at all.",
      "Thank you, {name}. Someone ought to remember the people who lived here."
    ],
    objectives: [{ type: 'collect', item: 'ember_cinder', count: 8 }],
    rewards: { xp: 380, gold: 150, items: { health_potion: 1 } },
    main: false
  },

  s05: {
    name: 'A Scarecrow for the Hollow',
    giver: 'guard_tomas', turnIn: 'guard_tomas',
    level: 8, prereq: ['m13'],
    offer: [
      "Psst! {name}! I heard you've been to the Ashen Ruins. Actually inside. With the wraiths.",
      "I have a plan to protect Lanternmere. A scarecrow! But for the Hollow! A HOLLOWCROW!",
      "I need six handfuls of Hollow Ash to rub on it, so it looks scary. I'd go myself, but someone has to guard."
    ],
    progress: ["Six Hollow Ash! Wraiths and acolytes carry it. For the Hollowcrow! Wear gloves. I would. From here."],
    complete: [
      "Behold! The Hollowcrow! ...The ash just made it look fluffy. Why is it FLUFFY? I wanted terrifying!",
      "Well. Maybe the Hollow hates fluffy. Thanks, {name}. Lanternmere is safer now. Probably."
    ],
    objectives: [{ type: 'collect', item: 'hollow_ash', count: 6 }],
    rewards: { xp: 300, gold: 160, items: { mana_potion: 2 } },
    main: false
  },

  m15: {
    name: 'Whispers of the Court',
    giver: 'aldric', turnIn: 'aldric',
    level: 9, prereq: ['m14'],
    offer: [
      "Hooded figures chant at the inner gate day and night. Hollow Acolytes. Nyx's devoted.",
      "They pour the guardians' stolen light into the old Gloamgate. If it opens fully...",
      "Well. Let us not find out. Five acolytes, {name}. Break their circle."
    ],
    progress: ["Five Hollow Acolytes. Interrupt their chanting. Ideally with spells."],
    complete: [
      "The chanting has stopped and the acolytes have scattered. Glorious silence! Even the crows look relieved.",
      "But I knew the voice giving them orders. Captain Vex. My old squire."
    ],
    objectives: [{ type: 'kill', enemy: 'hollow_acolyte', count: 5 }],
    rewards: { xp: 520, gold: 200 },
    main: true
  },

  m16: {
    name: 'Captain Vex',
    giver: 'aldric', turnIn: 'aldric',
    level: 9, prereq: ['m15'],
    offer: [
      "Vex was my squire. Clever, fierce, always first into battle. Then the Hollow found the anger in him.",
      "He commands Nyx's guard now. He will stand between you and the gate, and he will not step aside.",
      "Defeat him, {name}. And if anything of the old Vex is left in there... tell him I'm sorry."
    ],
    progress: ["Vex waits on the old bridge. He always did love a dramatic entrance."],
    complete: [
      "He's... no, look! The shadow left him. He's sleeping. Only sleeping. Oh, thank the Dawn.",
      "The Watch could only ever banish the Hollow. You set him free. How, friend?",     // v2.0 WS-E (R3, plant A5)
      "I'll carry him to the Spire. Aurelia can mend what the Hollow broke. Take these. You'll need them.",
      "Only one stands before the gate now. Nyx herself. And she knows you are coming."
    ],
    objectives: [{ type: 'kill', enemy: 'captain_vex', count: 1 }],
    rewards: { xp: 650, gold: 300, items: { health_potion: 3, mana_potion: 3 } },
    main: true
  },

  m17: {
    name: 'Herald of the Hollow King',
    giver: 'aldric', turnIn: 'aurelia',
    level: 10, prereq: ['m16'],
    offer: [
      "This is it, {name}. Nyx stands before the Gloamgate, swollen with stolen light.",
      "Every drained guardian, every black feather. All of it was leading here.",
      "Defeat her, then go home to Aurelia. I'll hold the ruins. ...Go on. The Dawn is with you."
    ],
    progress: ["Nyx waits at the Gloamgate, in the heart of the ruins. End this, {name}."],
    complete: [
      "{name}! You're safe! The whole Spire felt the Gloamgate go dark. Nyx is beaten!",
      "But her last words trouble me. 'Lamps are made to be emptied.'",     // v2.0 WS-E (R6): Nyx's new parting line
      "Malgrath is waking, dear one. Rest tonight. Tomorrow we will need every light we have."
    ],
    objectives: [{ type: 'kill', enemy: 'nyx_herald', count: 1 }],
    rewards: { xp: 800, gold: 400, items: { health_potion: 2 } },
    main: true,
    final: true
  }
};

// ---- v1.2 WS4: post-game dungeon quest (d = dungeon). Unlocks after m17. ----
// The dungeon itself is game/data/dungeons.js; its portal (Ashen Ruins) needs
// m17 AND level 10. The Orrery Deck (WS3, decks.js) is guaranteed on the first
// clear; it is left out if decks.js does not define it (tests/dungeon-check.js).
// The quest only exists where the dungeon does: enemies_dungeon.js loads before
// this file (contract load order), so a tool that loads quests.js without the
// dungeon files never sees a quest pointing at a zone it doesn't have.
if (WF.data.enemies && WF.data.enemies.starless_archon) WF.data.quests.d01 = {
  name: 'The Hollow Orrery',
  giver: 'aldric', turnIn: 'aldric',
  level: 10, prereq: ['m17'],
  offer: [
    "By the Dawn, {name}! Since Nyx fell I hear ticking beneath the stones. Gears. Enormous ones. At night. Rude.",
    "Below Dawnhold lies the star-vault, where the Watch kept the great Orrery: a brass map of every light in the sky.",
    "Its door east of my camp has woken. Something Hollow sits in the Orrery's heart, eating the stars. Go and see."
  ],
  progress: ["The star-vault door is east of my camp. Mind the ticking. I'm told that's normal. I'm told many things."],
  complete: [
    "The Archon, banished? The stars burning true again? By the Dawn, I could weep. I won't. The ash gets in my eyes.",
    "The Watch kept this deck in the vault for its finest Star-Wardens. You have earned it twice over.",
    "And the light you carried out of the Orrery? That is a spell, {name}. A star the Archon stole, and it chose you.",
    "The Orrery will keep turning, and its echoes with it. Go back whenever you like. The vault rewards the bold."
  ],
  objectives: [
    { type: 'visit', zone: 'hollow_orrery' },
    { type: 'kill', enemy: 'starless_archon', count: 1 }
  ],
  rewards: (function () {
    // v1.2 WS4 (contract §8): the Archon's first clear teaches the wizard's school a boss spell (cards.js)
    var r = { xp: 600, gold: 500, items: {},
      cardsBySchool: { stoneward: 'orrery_quake_ascendant', tidecaller: 'orrery_tide_ascendant', emberstrike: 'orrery_flare_ascendant' } };
    if (WF.data.items && WF.data.items.deck_orrery) r.items.deck_orrery = 1;
    return r;
  })(),
  main: false
};

// ---- v2.0 M1 (WS-A): Runeglass tutorial (docs/V2.0-CONTRACT.md §2) ----
// Unlocks once Grubnak is freed (m05): his first defeat always drops
// Runeglass (runeglass.js drops.first = 4 = the rank-2 cost). Objective type
// 'upgrade' (state.js): raise `count` spells to `rank` at the Spellwright.
WF.data.quests.s08 = {
  name: 'Glass That Remembers',
  giver: 'spellwright', turnIn: 'spellwright',
  level: 3, prereq: ['m05'],
  offer: [
    "So you're the one who freed the Bog King. He left you something, didn't he? A sliver of glass that hums when you hold it to the light.",
    "That is Runeglass. A shard of the old star-lenses my family ground for the Orrery. Not my proudest inheritance.",
    "Let me show you the one good thing it can do. Choose a spell you trust, and we will teach it to shine a little brighter."
  ],
  progress: ["Open my bench and pick a spell. Raw power, or a little trick of its school. Your choice. Four Runeglass for the first rank."],
  complete: [
    "There. Hear that ring? The spell remembers being cast now, and it will remember better every time.",
    "Every great Hollow beast you free carries more of these shards. Bring them back, and we will go all the way to rank five."
  ],
  objectives: [{ type: 'upgrade', count: 1, rank: 2, label: "Upgrade a spell at the Spellwright's bench" }],
  rewards: { xp: 60, gold: 40, runeglass: 2 },
  main: false
};
