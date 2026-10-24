// =====================================================================
//  WIZZIE FARM — CHARACTERS (v2.1 WS-D: the round-2 look Jorge approved Oct 20, D5)
//
//  "1a, 2 yes, 3 ok, 4 = 4.1, 5 keep, 6 ok":
//   * Body A = 4.1 heads (Aurelia stays 4.5); Body B = (a) broader, pushed to +15 % shoulders/chest
//   * Body B defaults to the smaller, squarer eyes; both eye styles are selectable for both bodies
//   * round-2 eyes ("less doll-like"); hat kept at Aurelia's ratio, tilted back 9 deg
//   * named NPCs: one strong shape hook each (Brannoc broad and square, Fennick short and stooped...)
//  Source renders: docs/review/v2.1-ws-d-round2/ (Blender knobs in art/blender/build_prototype.py).
//
//  The game's wizard is procedural (game/js/models.js, wizardModel): every gear style, rarity tier,
//  animation and mount works on any build below. A wizard's choices are saved as p.look
//  (state.js, save v5 field): { body, face, eyes, nose, mouth, hair, hairColor, skin, eyeColor }.
//  Indexes into the lists below; anything unknown falls back to entry 0.
//
//  Build knobs (models.js applyBuild): the v1.x wizard is the reference (head radius 0.33, waist
//  0.55, shoulders 0.95). headS = head size, legs / torso = vertical stretch below / above the
//  waist, arms = arm length, chest = torso width, shoulders = shoulder width, armThick, scale =
//  overall. Measured with tests/lab-characters.html (heads = height / head height).
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.characters = {
  bodies: {
    a: { label: 'Build A', desc: 'The classic apprentice build.', headS: 0.66, legs: 1.46, torso: 1.3, arms: 1.28, chest: 0.82, shoulders: 0.86, armThick: 0.86, scale: 1, eyes: 0, face: 0, hair: 0 },
    b: { label: 'Build B', desc: 'Broader shoulders and chest (+15 %).', headS: 0.66, legs: 1.46, torso: 1.3, arms: 1.3, chest: 0.94, shoulders: 0.99, armThick: 0.96, scale: 1.04, eyes: 1, face: 3, hair: 1 },
    // NPC builds (npcs.js `build`): one strong shape hook each
    tall:   { headS: 0.6, legs: 1.62, torso: 1.4, arms: 1.36, chest: 0.95, shoulders: 0.95, armThick: 0.95, scale: 1 },     // 4.5 heads: Aurelia, elegant and tall
    broad:  { headS: 0.66, legs: 1.34, torso: 1.3, arms: 1.2, chest: 1.42, shoulders: 1.5, armThick: 1.3, scale: 1 },     // Brannoc: square and wide
    stout:  { headS: 0.7, legs: 1.15, torso: 1.2, arms: 1.12, chest: 1.3, shoulders: 1.2, armThick: 1.2, scale: 1 },      // short and round
    stooped:{ headS: 0.7, legs: 1.2, torso: 1.12, arms: 1.15, chest: 0.95, shoulders: 0.92, armThick: 0.95, scale: 1, stoop: 0.23 },   // Fennick: bent forward 13 deg
    slim:   { headS: 0.64, legs: 1.55, torso: 1.36, arms: 1.34, chest: 0.88, shoulders: 0.9, armThick: 0.88, scale: 1 },     // lanky
    young:  { headS: 0.74, legs: 1.25, torso: 1.15, arms: 1.15, chest: 0.92, shoulders: 0.92, armThick: 0.92, scale: 1 }      // a younger look (bigger head, shorter)
  },
  // ---- character-creation options (labels shown in the creator) ----
  faces: [
    { id: 'round', label: 'Round', sx: 1, sy: 1, jaw: 0, chin: 0 },
    { id: 'oval', label: 'Oval', sx: 0.94, sy: 1.05, jaw: 0, chin: 0.01 },
    { id: 'long', label: 'Long', sx: 0.97, sy: 1.1, jaw: 0, chin: 0.02 },
    { id: 'square', label: 'Broad', sx: 1.08, sy: 0.97, jaw: 0, chin: 0 }
  ],
  eyes: [
    { id: 'bright', label: 'Bright (almond)', w: 0.062, h: 0.052, iris: 0.72, tuck: 0.18, lash: 0.75, square: 0 },   // the round-2 eyes
    { id: 'square', label: 'Keen (smaller, squarer)', w: 0.054, h: 0.046, iris: 0.74, tuck: 0.12, lash: 0.45, square: 1 },
    { id: 'gentle', label: 'Gentle (half-lidded)', w: 0.058, h: 0.044, iris: 0.7, tuck: 0.4, lash: 0.6, square: 0 },
    { id: 'wide', label: 'Wide (round)', w: 0.062, h: 0.062, iris: 0.68, tuck: 0.06, lash: 0.7, square: 0 }
  ],
  eyeColors: ['#5a3a22', '#2f6db8', '#3f8a4a', '#7a5ab8', '#8a8f99', '#c08a2a'],
  noses: [
    { id: 'button', label: 'Button', r: 0.046, sy: 0.9, cone: 0 },
    { id: 'small', label: 'Small', r: 0.034, sy: 0.85, cone: 0 },
    { id: 'round', label: 'Round', r: 0.06, sy: 0.95, cone: 0 },
    { id: 'pointed', label: 'Pointed', r: 0.04, sy: 1, cone: 1 }
  ],
  mouths: [
    { id: 'smile', label: 'Smile', w: 0.05, arc: 0.8, open: 0 },
    { id: 'grin', label: 'Grin', w: 0.064, arc: 0.9, open: 0.4 },
    { id: 'small', label: 'Small', w: 0.034, arc: 0.7, open: 0 },
    { id: 'calm', label: 'Calm', w: 0.046, arc: 0.35, open: 0 }
  ],
  hairs: [
    { id: 'bob', label: 'Bob' },
    { id: 'short', label: 'Short' },
    { id: 'long', label: 'Long' },
    { id: 'ponytail', label: 'Ponytail' },
    { id: 'braids', label: 'Braids' },
    { id: 'curly', label: 'Curly' },
    { id: 'bun', label: 'Bun' },
    { id: 'spiky', label: 'Spiky' }
  ],
  hairColors: ['#4a2f1c', '#1c1410', '#7a4a24', '#b3542a', '#d9b25a', '#f0e2b6', '#8a8f99', '#2f3f7a', '#6a3f8a', '#2f6a4a'],
  skins: ['#f2c9a0', '#f7dcc2', '#e2b48a', '#c9926a', '#a87050', '#8d5a3b', '#6b4029', '#4a2c1c'],
  // ---- named NPCs (v2.1 D5 "6 ok": one strong shape hook each). Merged into npcs.js `look` as
  // look.build by WF.models.npcLook(id). Colours of robes/hats stay in npcs.js; hairColor also
  // colours beards and brows.
  npcs: {
    aurelia:       { body: 'tall', face: 1, eyes: 0, hair: 2, hairColor: '#e9dcb0', mouth: 3 },                       // 4.5 heads: tall, elegant, long silver-gold hair
    brannoc:       { body: 'broad', face: 3, eyes: 1, hair: 1, hairColor: '#6a6a72', beard: 'square', brows: 1.7, nose: 2, mouth: 3 },   // square and wide
    maris:         { body: 'slim', face: 2, eyes: 2, hair: 2, hairColor: '#2f3f7a', mouth: 3 },                     // long and calm, a hooded tide-sister
    ignis:         { body: 'slim', legs: 1.5, face: 1, eyes: 1, hair: 7, hairColor: '#c0392b', mouth: 1, brows: 1.3 },   // spiky flame hair, sharp brows
    pip_quickcoin: { body: 'stout', face: 0, eyes: 3, hair: 5, hairColor: '#d9b25a', mouth: 1, nose: 2 },            // short and round, wide eyes, big grin
    guard_tomas:   { body: 'broad', shoulders: 1.32, chest: 1.2, face: 3, eyes: 1, hair: 1, hairColor: '#4a2f1c', mouth: 3 },   // a wall of a watchman
    hollis:        { body: 'stout', scale: 1.04, face: 0, eyes: 0, hair: 5, hairColor: '#8a5a2e', beard: 'full', nose: 2 },     // barrel-chested horseman
    tamsin:        { body: 'young', face: 0, eyes: 3, hair: 6, hairColor: '#b3542a', mouth: 1, nose: 1 },            // small and quick, a copper bun
    banker:        { body: 'tall', legs: 1.55, face: 2, eyes: 2, hair: 6, hairColor: '#8a8f99', mouth: 3, nose: 3 },  // tall, precise, a neat grey bun
    fennick:       { body: 'stooped', face: 0, eyes: 2, hair: 1, hairColor: '#f0f0ea', beard: 'long', brows: 1.9, nose: 2, mouth: 0 },  // short and stooped
    sela:          { body: 'slim', face: 1, eyes: 1, hair: 4, hairColor: '#7a4a24', mouth: 3 },                       // lean ranger, braids
    wren:          { body: 'young', face: 0, eyes: 0, hair: 5, hairColor: '#2f6a4a', mouth: 0, nose: 1 },             // a sprig of an herbalist, green curls
    aldric:        { body: 'broad', headS: 0.6, legs: 1.55, face: 3, eyes: 1, hair: 1, hairColor: '#d9b25a', beard: 'full', brows: 1.4 },   // the tallest, broadest paladin
    orrery_keeper: { body: 'stout', scale: 0.98, face: 2, eyes: 3, hair: 1, hairColor: '#f0e2b6', beard: 'long', nose: 3 },   // a round star-gazer with a pointed nose
    spellwright:   { body: 'slim', face: 2, eyes: 1, hair: 0, hairColor: '#c9c9cf', beard: 'full', nose: 3, mouth: 3 },  // thin lens-grinder
    quillby:       { body: 'stout', scale: 0.96, face: 0, eyes: 2, hair: 6, hairColor: '#e8e4dc', mouth: 0, nose: 2 }, // a round grandmother, white bun
    tobin_burrow:  { body: 'young', face: 1, eyes: 2, hair: 0, hairColor: '#8a5a2e', mouth: 2, nose: 1 },            // shy, half-lidded, small
    marla_crumb:   { body: 'stout', face: 0, eyes: 0, hair: 3, hairColor: '#b3542a', mouth: 1, nose: 2 },            // round baker with a ponytail
    coach_bramble: { body: 'broad', face: 3, eyes: 0, hair: 1, hairColor: '#cfcfcf', beard: 'full', mouth: 1, brows: 1.5 }   // a sports coach: broad, grinning
  },
  // the creator's default for a new wizard of each body
  defaults: { body: 'a', face: 0, eyes: 0, nose: 0, mouth: 0, hair: 0, hairColor: '#4a2f1c', skin: '#f2c9a0', eyeColor: '#5a3a22' }
};
