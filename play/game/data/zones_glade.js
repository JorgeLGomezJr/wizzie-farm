// =====================================================================
//  WIZZIE FARM — HATCHERY GLADE (v2.0 M2, WS-B: level-designer + world-builder + writer)
//
//  A small, safe meadow zone behind ONE portal arch in Lanternmere (north-east of the
//  Spire; the arch is appended at the end of zones.js, V2.0-CONTRACT §0.4: "Lanternmere stays uncluttered"). Everything about pets
//  happens here: the Nestery (two incubator nests), the starter-pet keeper, the snack
//  baker, the training ring and the Pet Stat Board. Same schema as zones.js (every
//  zone tool works on it); loaded after zones.js, npcs.js, lore.js and voices.js.
//
//                     N (-Z)
//              ( Hatchery hut )
//            o nest   Q   nest o            Q  Nell Quillby, Nestery Keeper (breeding, nests,
//                     |                         appraisal)  -> pets: 'hatchery'
//      T [stall]------+------[stall] M      T  Tobin Burrow, starter pets (Common only) -> pets: 'starters'
//                     |                     M  Marla Crumb, snack baker (an ordinary vendor)
//        B  (ring)    |     [board]         B  Coach Bramble, training ring -> pets: 'ring'
//                     @  spawn / arrive     [board] the Pet Stat Board (petBoard; WF.petsUI draws + opens it)
//                     |
//                  ( portal )  -> Lanternmere
//                     S (+Z)
//
//  NPC field `pets` ('hatchery' | 'starters' | 'ring') is read by game/js/petsUI.js, which adds
//  the matching button to the NPC's dialogue. Voice profiles for the four new NPCs are added to
//  WF.data.voices below (new clips: see the WS-B report; until rendered, voice.js falls back to
//  the browser voice described in `web`).
// =====================================================================
window.WF = window.WF || { data: {} };
WF.data.zones = WF.data.zones || {};
WF.data.npcs = WF.data.npcs || {};

(function (D) {
  'use strict';

  // ------------------------------------------------------------------ the zone
  D.zones.hatchery_glade = {
    name: 'Nestling Glade', subtitle: 'Where Lanternmere’s familiars are born',
    levelRange: [1, 10], safe: true,
    size: 28,
    style: 'meadow',
    ground: '#7cc263', ground2: '#69ad52', path: '#d8c79a',
    sky: '#b8e6ff', skyTop: '#5c9cf0', fog: '#e2f4ff', fogNear: 34, fogFar: 95,
    sun: '#fff1d0', sunIntensity: 1.15, ambient: '#d0dcff',
    spawn: [0, 13.5],
    paths: [
      [[0, 25], [0, 13.5], [0, 2], [0, -11]],
      [[0, -1], [-8, -2], [-11.5, -2]],
      [[0, -1], [8, -2], [11.5, -2]],
      [[0, 6], [-5, 8], [-8.6, 8.6]],
      [[0, 6], [5, 8], [8.6, 8.6]]
    ],
    npcs: [
      { id: 'quillby',       pos: [0, -12.6],  face: 0 },
      { id: 'tobin_burrow',  pos: [-12.6, -2], face: 1.42 },
      { id: 'marla_crumb',   pos: [12.6, -2],  face: -1.42 },
      { id: 'coach_bramble', pos: [-9.6, 9.2], face: 2.3 }
    ],
    groups: [],
    portals: [
      { id: 'to_lanternmere', to: 'lumen_commons', pos: [0, 25], arrive: [17.55, -16.2], label: 'Lanternmere', color: '#ffe08a', requires: null }
    ],
    wisps: [],
    // the Pet Stat Board (WF.petsUI builds the board and opens it with E)
    petBoard: { pos: [10.4, 9.6], face: -2.3, label: 'Pet Stat Board' },
    // the two incubator nests (WF.petsUI shows the eggs in them)
    petNests: [{ pos: [-3.6, -15.4] }, { pos: [3.6, -15.4] }],
    // the training ring (WF.petsUI makes your pet spar here while the ring is in use)
    petRing: { pos: [-15.5, 13.5], r: 3.2 },
    props: [
      // --- the Nestery hut, its nests and lanterns
      { type: 'house',     pos: [0, -20.5],   rot: 0,     scale: 1.0, color: '#e8b8d8' },
      { type: 'crystal',   pos: [-3.6, -15.4], rot: 0,    scale: 0.5, color: '#ffd6f0' },
      { type: 'crystal',   pos: [3.6, -15.4],  rot: 0,    scale: 0.5, color: '#ffd6f0' },
      { type: 'lantern',   pos: [-6.5, -12],  rot: 0,     scale: 1 },
      { type: 'lantern',   pos: [6.5, -12],   rot: 0,     scale: 1 },
      { type: 'banner',    pos: [-8.5, -17],  rot: 0.4,   scale: 1, color: '#f4a6d0' },
      { type: 'banner',    pos: [8.5, -17],   rot: -0.4,  scale: 1, color: '#f4a6d0' },
      // --- Tobin's starter-pet stall (west) and Marla's snack stall (east)
      { type: 'stall',     pos: [-16, -2.6],  rot: 1.42,  scale: 1 },
      { type: 'stall',     pos: [16, -2.6],   rot: -1.42, scale: 1 },
      { type: 'signpost',  pos: [-9.6, -5.2], rot: 1.42,  scale: 1, label: 'Starter Pets' },
      { type: 'signpost',  pos: [9.6, -5.2],  rot: -1.42, scale: 1, label: 'Pet Snacks' },
      // --- the training ring (south-west)
      { type: 'rune_circle', pos: [-15.5, 13.5], rot: 0, scale: 1.1 },
      { type: 'lantern',   pos: [-19.6, 10.4], rot: 0,    scale: 1 },
      { type: 'lantern',   pos: [-11.4, 17.6], rot: 0,    scale: 1 },
      { type: 'signpost',  pos: [-12.4, 6.0], rot: 2.3,   scale: 1, label: 'Training Ring' },
      // --- the Pet Stat Board corner (south-east)
      { type: 'signpost',  pos: [13.6, 7.0],  rot: -2.3,  scale: 1, label: 'Pet Stat Board' },
      { type: 'flower',    pos: [12.6, 12.4], rot: 0,     scale: 1.2 },
      // --- the arch home
      { type: 'lantern',   pos: [-3, 21.5],   rot: 0,     scale: 1 },
      { type: 'lantern',   pos: [3, 21.5],    rot: 0,     scale: 1 },
      { type: 'tree_giant', pos: [-20, -18],  rot: 0.3,   scale: 0.9 },
      { type: 'tree_giant', pos: [20, -18],   rot: 2.1,   scale: 0.9 },
      { type: 'mushroom',  pos: [-5.2, 18.2], rot: 0,     scale: 1.3 },
      { type: 'mushroom',  pos: [5.6, 17.4],  rot: 0,     scale: 1.1 }
    ],
    scatter: { tree_round: 12, bush: 12, flower: 34, mushroom: 8 },
    seed: 2042
  };

  // ------------------------------------------------------------------ the people
  // Voices (docs/design/lore.md style): Quillby fusses like a grandmother over every egg;
  // Tobin is a shy, gentle stable-boy type who talks to the animals more than to people;
  // Marla is a loud, cheerful baker; Coach Bramble is an old duellist turned pet coach.
  var NPCS = {
    quillby: {
      name: 'Nell Quillby', title: 'Nestery Keeper', role: 'flavor', pets: 'hatchery',
      look: { robe: '#e8a6c8', hat: '#f4e2c0', trim: '#fff1b8', skin: '#efcfb0', hair: '#f2eef8',
              beard: false, hood: false, staffGem: '#ffd6f0', scale: 0.88 },
      greeting: [
        "Mind the nests, {name}! Every egg in here is somebody's someday.",
        "Bring me two grown pets and a little gold, and I'll tuck a brand-new egg into a nest for you.",
        "A baby takes after both its parents. Mostly. Sometimes it takes after a passing cloud. That's eggs for you.",
        "I can read a pet's hidden gifts, if you like. It costs a little, and a lot of squinting."
      ]
    },
    tobin_burrow: {
      name: 'Tobin Burrow', title: 'Keeper of Starter Pets', role: 'flavor', pets: 'starters',
      look: { robe: '#7a9a5a', hat: '#5a4630', trim: '#e8d8a0', skin: '#e2b896', hair: '#8a5a2e',
              beard: false, hood: true, staffGem: '#b8ff8a', scale: 0.86 },
      greeting: [
        "Oh! Hello. Sorry, I was talking to the Puddlepups. They had a lot to say.",
        "Every wizard deserves a friend that follows them home. These little ones are waiting for theirs.",
        "They're all common, mind you. Common doesn't mean ordinary. Ask any Mossling.",
        "The rare ones? Out there, with the big Hollow brutes. Or here, if you breed them patiently."
      ]
    },
    marla_crumb: {
      name: 'Marla Crumb', title: 'Pet Snack Baker', role: 'vendor',
      look: { robe: '#f2c48a', hat: '#ffffff', trim: '#e86a6a', skin: '#d9a682', hair: '#5a3424',
              beard: false, hood: false, staffGem: '#ff8ab8', scale: 0.95 },
      greeting: [
        "Fresh from the oven! Pets grow up on my muffins, and I won't hear otherwise!",
        "Starberry Tarts! Sticky, sweet and only slightly magical. Well. Moderately magical.",
        "Glowmelon slices hum when you bite them. Your pet will hum too. It's adorable.",
        "Comet Cake? Ha! I wish. Only the big Hollow bosses carry those. Don't ask me where they bake them."
      ],
      vendor: ['snack_moss_muffin', 'snack_starberry_tart', 'snack_glowmelon']
    },
    coach_bramble: {
      name: 'Coach Bramble', title: 'Pet Trainer', role: 'flavor', pets: 'ring',
      look: { robe: '#6a7a4a', hat: '#4a3a24', trim: '#ffb84a', skin: '#c9926a', hair: '#cfcfcf',
              beard: true, hood: false, staffGem: '#ffb84a', scale: 1.04 },
      greeting: [
        "Into the ring with that pet, {name}! Sparring builds character. And biceps. Tiny ones.",
        "A pet learns twice as much from a real duel. But the ring is free, and it never bites back.",
        "Every time your pet grows, it learns one new trick. Pick well. You only get one.",
        "I duelled for forty years. Now I coach Cinderkits. Best job I ever had, and the singed eyebrows grow back."
      ],
      // v2.1 A4: what the coach says when the ring can't be used yet ({pet} = the equipped pet, {time} = mm:ss)
      ringLines: {
        nopet: "No pet, no sparring, champ! Tobin Burrow, the starter-pet keeper here in the Glade, will set you up with your first one.",
        equip: "Your pets are all napping in your pack, champ! Open your Pets with P and equip one, then come back.",
        grown: "{pet} is fully grown! The ring can't teach a champion anything new. Go win some real duels.",
        resting: "Easy, champ! The ring needs a breather. Come back in {time}.",
        ready: "Into the ring with {pet}! Let's see that footwork."
      }
    }
  };
  Object.keys(NPCS).forEach(function (id) { D.npcs[id] = NPCS[id]; });

  // ---------------------------------------------- voice profiles (game/data/voices.js schema)
  if (D.voices) {
    D.voices.quillby = { note: 'Nell Quillby, Nestery Keeper. Fussy, warm grandmother; clucks over every egg. Soft, a little breathless.', address: 'dearie',
      tts: { voice: 'bf_emma*0.6+af_heart*0.4', lang: 'en-gb', speed: 0.98 }, fx: { pitch: 1.2, formant: 'preserved', vibrato: [5, 0.03] },
      web: { lang: 'en-GB', gender: 'female', prefer: ['Libby', 'Hazel', 'Susan', 'Zira'], pitch: 1.15, rate: 0.95 } };
    D.voices.tobin_burrow = { note: 'Tobin Burrow, starter-pet keeper. Shy young man, gentle, trails off; more at ease with animals.', address: 'friend',
      tts: { voice: 'am_liam', lang: 'en-us', speed: 0.96 }, fx: { pitch: 0.6, formant: 'preserved' },
      web: { lang: 'en-US', gender: 'male', prefer: ['Guy', 'Eric', 'David'], pitch: 1.1, rate: 0.95 } };
    D.voices.marla_crumb = { note: 'Marla Crumb, snack baker. Loud, jolly, laughs at her own jokes; a market-stall voice.', address: 'sweetie',
      tts: { voice: 'af_bella*0.6+af_kore*0.4', lang: 'en-us', speed: 1.08 }, fx: { pitch: -0.4, formant: 'preserved' },
      web: { lang: 'en-US', gender: 'female', prefer: ['Jenny', 'Aria', 'Zira'], pitch: 1.0, rate: 1.1 } };
    D.voices.coach_bramble = { note: 'Coach Bramble, retired duellist turned pet coach. Gruff, booming, encouraging, a sports-coach bark.', address: 'champ',
      tts: { voice: 'am_fenrir*0.6+bm_george*0.4', lang: 'en-us', speed: 1.02 }, fx: { pitch: -1.0, reverb: [0.6, 0.04] },
      web: { lang: 'en-US', gender: 'male', prefer: ['Guy', 'David', 'Mark'], pitch: 0.8, rate: 1.0 } };
  }

  // ---------------------------------------------- lore (first-visit card + loading tip)
  if (D.lore && D.lore.zoneIntros) {
    D.lore.zoneIntros.hatchery_glade = "Nestling Glade. A sunny hollow behind the Spire where Lanternmere's familiars hatch, " +
      "eat far too many muffins, and learn to follow their wizards into trouble.";
  }

})(WF.data);
