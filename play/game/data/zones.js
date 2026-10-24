// =====================================================================
//  WIZZIE FARM — ZONES (world layout)
//
//  One entry per zone. Schema: docs/ARCHITECTURE.md ("zones.js").
//  Design notes + top-down maps: docs/design/levels.md
//  Validate after every edit:   node tests/zones-check.js
//
//  Coordinates are world units (~meters) on the flat ground, written as
//  [x, z].  The playable square is -size..+size on both axes.
//  In every combat zone the entrance is at the +Z edge ("south" on the
//  maps in levels.md) EXCEPT Whisperwood, whose entrance is the +X edge
//  (it sits west of Lanternmere, the hub).  The hub's id stays
//  'lumen_commons' (save files + quests use it); only the display name
//  changed to "Lanternmere" in v0.2.  Difficulty rises with distance from
//  the entrance; the boss is always at the far side.
//  face / rot are radians, 0 = facing +Z.  To face a point: atan2(dx, dz).
//
//  Layout rules (checked by tests/zones-check.js):
//    - camps (groups) at least 9 units apart from each other
//    - camps at least 12 units from NPCs, portals, spawn and arrive points
//    - mobs aggro within ~3.5 units and roam inside `wander`
//    - portal `arrive` = a point in the DESTINATION zone 11.5 units in
//      front of that zone's portal back (validator: 10.5-12).  The chase
//      camera sits 11*cos(0.42) = 10.0 units behind the player: closer
//      than that and the camera is outside the portal looking through
//      the arch (at exactly 10 it sits on the keystone gem).  A combat
//      zone's `spawn` is the same point as the arrive point from the hub.
//    - interactable props (`interact`, `id`) at least 6 units from camps
//      and within 3 units of a path
//    - no prop collider on a path centreline; arches stay walkable
//    - the hub's South Gate slots stay free (RESERVED in the validator)
//    - keep hand props + scatter <= ~250 per zone (laptop performance)
//
//  OPTIONAL EXTRAS (not in the v0.1 contract; safe for the engine to ignore):
//    props[].color   tint passed to WF.models.prop(type, { color })
//    props[].label   text for signposts
//    pools           [{ pos, r, color }] flat murky-water discs drawn just
//                    above the ground (the bogs in Mosslight Path). Visual
//                    only, walkable.
//
//  v0.2 CONTRACT FIELDS (docs/ARCHITECTURE.md, "v0.2 CONTRACT ADDENDUM"):
//    props[].interact 'relight' + props[].id (unique per zone): the snuffed
//                    lanterns of side quest s06. Lit state is saved per id.
//    restored        [{ quest, fog, fogNear, fogFar, ground, ground2, sky,
//                    skyTop, sun, sunIntensity, ambient, pools: {color},
//                    lanterns: 'lit' }] - once `quest` is done these fields
//                    override the zone look ("every zone ends with
//                    something restored").
//
//  ADDING A ZONE FOR LEVELS 11+: see docs/design/levels.md, section
//  "Adding a new zone".  Short version: copy a zone block, give it a new
//  id, put its enemies in enemies.js, then add a portal in Lanternmere's
//  SOUTH GATE plaza (slots S1-S3, see levels.md; replace the sealed arch
//  for S1) with `requires: { quest: '<last main quest>' }` and a portal
//  back in the new zone.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.zones = {

  // ===================================================================
  //  LANTERNMERE (id lumen_commons) — safe hub (all levels)
  //  Spire to the north, fountain plaza in the middle, school corners,
  //  three open gates: east = Mosslight, west = Whisperwood, north = Ashen.
  //  SOUTH GATE plaza = reserved for the next arc's zones (sealed arch).
  // ===================================================================
  lumen_commons: {
    name: 'Lanternmere', subtitle: 'Lantern-lit heart of the Lumen Order',
    levelRange: [1, 10], safe: true,
    size: 45,
    style: 'town',
    ground: '#72b257', ground2: '#5f9d47', path: '#c6b089',
    sky: '#a8dcff', skyTop: '#3f8ae6', fog: '#d2ecff', fogNear: 40, fogFar: 130,
    sun: '#fff3d6', sunIntensity: 1.1, ambient: '#c4d2ff',
    spawn: [0, 12],
    paths: [
      // east road (Mosslight gate) and west road (Whisperwood gate)
      [[12, 2], [28, 2], [42, 2]],
      [[-12, 2], [-28, 2], [-42, 2]],
      // ring around the fountain plaza
      [[-8, 2], [-6, -5], [0, -8], [6, -5], [8, 2], [6, 9], [0, 12], [-6, 9], [-8, 2]],
      // up to the Spire, then around it to the north (Ashen) gate
      [[0, -8], [0, -12]],
      [[0, -12], [-9, -16], [-10, -26], [-6, -33], [0, -37], [0, -42]],
      [[0, -12], [9, -16], [10, -26], [6, -33], [0, -37]],
      // to the Emberstrike corner and the market
      [[-6, 9], [-14, 19]],
      [[6, 9], [15, 19]],
      // south road to the (sealed) South Gate plaza + the plaza crossway.
      // The plaza is kept free of hand props so future portals fit
      // (slots S1 [0,42], S2 [-13,41], S3 [13,41]; see levels.md).
      [[0, 12], [0, 26], [0, 40]],
      [[-13, 41], [-6, 40], [0, 40], [6, 40], [13, 41]],
      // trainer nooks
      [[-12, 2], [-20, -2]],
      [[12, 2], [20, -2]],
      // v1.2 WS9: spur from the west road to the Lanternmere Vault
      [[-16, 2], [-21.4, 8.3]]
    ],
    npcs: [
      { id: 'aurelia',       pos: [0, -9],   face: 0 },
      { id: 'brannoc',       pos: [-20, -2], face: 1.47 },
      { id: 'maris',         pos: [20, -2],  face: -1.47 },
      { id: 'ignis',         pos: [-14, 22], face: 2.57 },
      { id: 'pip_quickcoin', pos: [15, 21],  face: -2.52 },
      { id: 'guard_tomas',   pos: [33, 9],   face: -1.84 },
      { id: 'hollis',        pos: [24, 11],  face: -2.08 },      // v1.1 Brightmane Stables
      { id: 'tamsin',        pos: [22.6, 16.8], face: -2.2 },    // v1.2 WS2: Tamsin Gearwright's workshop, beside the stables
      { id: 'banker',        pos: [-23.5, 9.5], face: 2.095 },   // v1.2 WS9: Orsolya Coffersmith, the Lanternmere Vault (west road)
      { id: 'spellwright',   pos: [-13.4, -23.5], face: 1.2 }    // v2.0 WS-A: Oswin Lenscroft's lens bench, lane west of the Spire
    ],
    groups: [],
    portals: [
      { id: 'to_mosslight',   to: 'mosslight_path', pos: [42, 2],   arrive: [0, 34.5], label: 'Mosslight Path', color: '#7fffb0', requires: null },
      { id: 'to_whisperwood', to: 'whisperwood',    pos: [-42, 2],  arrive: [35.5, 4], label: 'Whisperwood',    color: '#b48cff', requires: { quest: 'm06' } },
      { id: 'to_ashen',       to: 'ashen_ruins',    pos: [0, -42],  arrive: [0, 39.5], label: 'Ashen Ruins',    color: '#ff7a3d', requires: { quest: 'm11' } }
      // future: south gate portals go here (S1 [0,42] arrive-back [0,30.5];
      // S2 [-13,41] arrive-back [-9,30.5]; S3 [13,41] arrive-back [9,30.5])
    ],
    wisps: [],
    props: [
      // --- The Lumen Spire and its forecourt
      { type: 'tower',    pos: [0, -22],   rot: 0,     scale: 1.3 },
      { type: 'statue',   pos: [-7, -12],  rot: 0.5,   scale: 1 },
      { type: 'statue',   pos: [7, -12],   rot: -0.5,  scale: 1 },
      { type: 'banner',   pos: [-3, -15.5], rot: 0,    scale: 1.2, color: '#ffe27a' },
      { type: 'banner',   pos: [3, -15.5], rot: 0,     scale: 1.2, color: '#ffe27a' },
      // v2.0 WS-E (story R8, plant B1): Aurelia's corner of the forecourt — a covered portrait on
      // an easel beside her, and a small locked door in the Spire's base (never opens in Book I)
      { type: 'covered_portrait', pos: [-3.3, -10.5], rot: 0.25, scale: 1.25 },
      { type: 'locked_door',      pos: [-3.68, -18.05], rot: -0.75, scale: 1 },
      // --- Fountain plaza
      { type: 'fountain', pos: [0, 2],     rot: 0,     scale: 1.2 },
      { type: 'lantern',  pos: [-10, 7],   rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [10, 7],    rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [-10, -3],  rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [10, -3],   rot: 0,     scale: 1 },
      // --- Stoneward corner (west) — amber banners, standing stones
      { type: 'banner',   pos: [-23, -5.5], rot: 1.47, scale: 1, color: '#d4a25f' },
      { type: 'banner',   pos: [-23, -0.5], rot: 1.47, scale: 1, color: '#d4a25f' },
      { type: 'rock_big', pos: [-26, -2],  rot: 0.4,   scale: 1 },
      { type: 'rock',     pos: [-24, -9],  rot: 1.1,   scale: 1.2 },
      // --- Tidecaller corner (east) — sea-blue banners and a well
      { type: 'banner',   pos: [23, -5.5], rot: -1.47, scale: 1, color: '#4fc3e8' },
      { type: 'banner',   pos: [23, -0.5], rot: -1.47, scale: 1, color: '#4fc3e8' },
      { type: 'well',     pos: [26, -2],   rot: 0,     scale: 1 },
      // --- Emberstrike corner (south-west) — flame banners, brazier fire
      { type: 'banner',   pos: [-18, 23.5], rot: 2.57, scale: 1, color: '#ff6b3d' },
      { type: 'banner',   pos: [-10, 24.5], rot: 2.57, scale: 1, color: '#ff6b3d' },
      { type: 'campfire', pos: [-14.5, 26.5], rot: 0,  scale: 1.1 },
      // --- Market (south-east): Pip's stall
      { type: 'stall',    pos: [17.2, 24.2], rot: -2.52, scale: 1 },
      { type: 'lantern',  pos: [11.5, 23], rot: 0,     scale: 1 },
      // --- Cottages
      { type: 'house',    pos: [-30, -18], rot: 0.9,   scale: 1 },
      { type: 'house',    pos: [30, -18],  rot: -0.9,  scale: 1 },
      { type: 'house',    pos: [-34, -32], rot: 0.6,   scale: 0.9 },
      { type: 'house',    pos: [34, -32],  rot: -0.6,  scale: 0.9 },
      { type: 'house',    pos: [-30, 32],  rot: 2.4,   scale: 1 },
      { type: 'house',    pos: [31, 33],   rot: -2.4,  scale: 1 },
      { type: 'house',    pos: [-23, 39],  rot: 2.7,   scale: 0.9 },
      { type: 'house',    pos: [23, 40],   rot: -2.7,  scale: 0.9 },
      // --- East gate (Mosslight) with Guard Tomas
      { type: 'fence',    pos: [40, -4],   rot: 1.57,  scale: 1 },
      { type: 'fence',    pos: [40, 8],    rot: 1.57,  scale: 1 },
      { type: 'lantern',  pos: [38, -2],   rot: 0,     scale: 1 },
      { type: 'signpost', pos: [35, -3],   rot: -1.57, scale: 1, label: 'Mosslight Path' },
      { type: 'lantern',  pos: [28, 6],    rot: 0,     scale: 1 },
      // --- West gate (Whisperwood)
      { type: 'fence',    pos: [-40, -4],  rot: 1.57,  scale: 1 },
      { type: 'fence',    pos: [-40, 8],   rot: 1.57,  scale: 1 },
      { type: 'lantern',  pos: [-38, -2],  rot: 0,     scale: 1 },
      { type: 'signpost', pos: [-35, -3],  rot: 1.57,  scale: 1, label: 'Whisperwood' },
      { type: 'lantern',  pos: [-28, 6],   rot: 0,     scale: 1 },
      // --- North gate (Ashen Ruins) behind the Spire — a hint of what waits
      { type: 'fence',    pos: [-5, -41],  rot: 0,     scale: 1 },
      { type: 'fence',    pos: [5, -41],   rot: 0,     scale: 1 },
      { type: 'signpost', pos: [-3.5, -38.5], rot: 3.14, scale: 1, label: 'Ashen Ruins' },
      { type: 'crystal',  pos: [-6, -38],  rot: 0,     scale: 0.6, color: '#ff7a3d' },
      { type: 'lantern',  pos: [-4, -33],  rot: 0,     scale: 1 },
      // --- South Gate plaza (RESERVED for the next arc's zones).
      //     A sealed, ivy-grown arch with a fence across its mouth marks
      //     slot S1; slots S2/S3 on either side stay empty.  To open a new
      //     zone: delete the arch + barrier fence and put a portal at
      //     [0, 42] (or use S2/S3).  Lanterns frame the crossway only.
      { type: 'arch',     pos: [0, 42.5],  rot: 0,     scale: 1.2, color: '#77727f' },
      { type: 'fence',    pos: [0, 42.6],  rot: 0,     scale: 1 },
      { type: 'signpost', pos: [4.5, 38],  rot: 3.14,  scale: 1, label: 'South Gate - sealed' },
      { type: 'lantern',  pos: [-3, 37],   rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [3, 37],    rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [-17, 43],  rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [17, 43],   rot: 0,     scale: 1 },
      // --- Brightmane Stables (v1.1, Stablemaster Hollis): a fenced paddock
      //     east of the plaza with two display mounts (mountDisplays below)
      { type: 'fence',    pos: [29, 18.6], rot: 0,     scale: 1 },
      { type: 'fence',    pos: [32.2, 15.6], rot: 1.57, scale: 1 },
      { type: 'fence',    pos: [32.2, 12.4], rot: 1.57, scale: 1 },
      { type: 'banner',   pos: [26.2, 18.8], rot: -2.08, scale: 1, color: '#e8c87a' },
      { type: 'lantern',  pos: [21.2, 8.4], rot: 0,     scale: 1 },
      { type: 'signpost', pos: [20.4, 5.6], rot: -2.08, scale: 1, label: 'Brightmane Stables' },
      // --- v1.2 WS9: the Lanternmere Vault (Orsolya Coffersmith, the shared account bank):
      //     a stone strongroom front with a round brass vault door, facing the plaza, on the
      //     west road opposite the stables. Orsolya stands 2.9 in front of it.
      { type: 'vault_counter', pos: [-26.0, 10.95], rot: 2.095, scale: 1.2 },
      { type: 'signpost', pos: [-21.2, 4.4], rot: 2.095, scale: 1, label: 'Lanternmere Vault' },
      { type: 'lantern',  pos: [-20.0, 10.6], rot: 0,   scale: 1 },
      { type: 'banner',   pos: [-28.6, 6.9], rot: 2.095, scale: 1, color: '#1f5c58' },
      // --- v2.0 WS-A: the Spellwright's open-air lens bench (no building): a Runeglass crystal on the lane west of the Spire
      { type: 'crystal',  pos: [-15.2, -25.0], rot: 0.3, scale: 0.55, color: '#9fe6ff' },
      { type: 'signpost', pos: [-12.0, -20.6], rot: 1.2, scale: 1, label: 'Spellwright' }
    ],
    // v1.1: decorative mounts (WF.models.mount; skipped when it is missing)
    mountDisplays: [
      { kind: 'horse', pos: [29.2, 14.6], face: -2.4, coat: '#8a4a24', mane: '#3a2010', saddle: '#5a2f00', trim: '#e8c87a' },
      { kind: 'pony',  pos: [27.0, 16.4], face: -2.9, coat: '#b8b8c0', mane: '#4a4a52', saddle: '#3f5a8a', trim: '#c9ced6' }
    ],
    scatter: { tree_round: 24, bush: 18, flower: 40, rock: 6 },
    seed: 1101
  },

  // ===================================================================
  //  MOSSLIGHT PATH — levels 1-3 (golden-hour meadow, glowing moss)
  //  Entrance south. Sprites near Fennick's camp -> Rotwater bog (toads)
  //  -> imp-haunted north fields -> Grubnak in the Great Bog.
  // ===================================================================
  mosslight_path: {
    name: 'Mosslight Path', subtitle: 'Where the moss glows at dusk',
    levelRange: [1, 3], safe: false,
    size: 50,
    style: 'meadow',
    ground: '#76a44e', ground2: '#61903f', path: '#b08c5c',
    // v1.1 polish (B14): lighter, cooler haze (was a heavy yellow wash) + a cooler colour grade
    sky: '#ecdfbe', skyTop: '#5a98d8', fog: '#d4dccb', fogNear: 46, fogFar: 160,
    sun: '#ffdcaa', sunIntensity: 1.0, ambient: '#bfcbb8',
    grade: { exposure: 0.97, saturation: 1.03, contrast: 1.1, warmth: -0.1 },
    spawn: [0, 34.5],
    paths: [
      // critical path: gate -> Fennick -> sprite meadow -> bog edge -> imp fields -> Great Bog
      [[0, 46], [0, 36], [-4, 26], [-6, 14], [-2, 4], [6, -6], [8, -16], [2, -26], [-2, -32], [0, -36]],
      [[0, 36], [6, 33]],                    // Fennick's camp
      [[-2, 4], [-12, -3], [-17, -5]],       // into Rotwater Bog
      [[6, -6], [16, -5]],                   // east meadow
      [[8, -16], [20, -20], [30, -25]]       // east imp field
    ],
    npcs: [
      { id: 'fennick', pos: [7, 33], face: -0.785 }
    ],
    groups: [
      // --- Sprite meadow (L1) — singles only, close to camp
      { id: 'mp_sprite1', enemies: ['hollow_sprite'], pos: [-16, 26], wander: 3,   respawn: 25 },
      { id: 'mp_sprite2', enemies: ['hollow_sprite'], pos: [12, 20],  wander: 3,   respawn: 25 },
      { id: 'mp_sprite3', enemies: ['hollow_sprite'], pos: [-20, 13], wander: 3,   respawn: 25 },
      { id: 'mp_sprite4', enemies: ['hollow_sprite'], pos: [16, 8],   wander: 3,   respawn: 25 },
      { id: 'mp_sprite5', enemies: ['hollow_sprite'], pos: [4, 12],   wander: 2.5, respawn: 25 },
      // --- Rotwater Bog (L2) — toads around the murky pool
      { id: 'mp_toad1', enemies: ['rot_toad'],                  pos: [-12, -2],  wander: 3, respawn: 30 },
      { id: 'mp_toad2', enemies: ['rot_toad', 'rot_toad'],      pos: [-30, 4],   wander: 3, respawn: 35 },
      { id: 'mp_toad3', enemies: ['rot_toad'],                  pos: [-32, -14], wander: 3, respawn: 30 },
      { id: 'mp_toad4', enemies: ['rot_toad', 'hollow_sprite'], pos: [-16, -18], wander: 3, respawn: 35 },
      { id: 'mp_toad5', enemies: ['rot_toad'],                  pos: [18, -4],   wander: 3, respawn: 30 },
      // --- Gloom fields (L3) — imps, the last stretch before the boss
      { id: 'mp_imp1', enemies: ['gloom_imp'],               pos: [22, -18],  wander: 3, respawn: 30 },
      { id: 'mp_imp2', enemies: ['gloom_imp', 'gloom_imp'],  pos: [-12, -30], wander: 3, respawn: 40 },
      { id: 'mp_imp3', enemies: ['gloom_imp', 'rot_toad'],   pos: [18, -32],  wander: 3, respawn: 40 },
      { id: 'mp_imp4', enemies: ['gloom_imp'],               pos: [-28, -28], wander: 3, respawn: 30 },
      { id: 'mp_imp5', enemies: ['gloom_imp'],               pos: [32, -26],  wander: 3, respawn: 30 },
      // --- BOSS: Grubnak the Bog King, alone in the Great Bog
      // --- ELITES (v1.1): off the main trail, long respawn, better loot
      { id: 'mp_elite_brute',   enemies: ['bogmire_brute', 'hollow_sprite'], pos: [-38, -2],  wander: 2.5, respawn: 120 },
      { id: 'mp_elite_gloom',   enemies: ['gloomhorn_ringleader', 'hollow_sprite'], pos: [36, -40],  wander: 2.5, respawn: 120 },
      { id: 'mp_boss_grubnak', enemies: ['grubnak'], pos: [0, -42], wander: 1.5, respawn: 120 }
    ],
    portals: [
      { id: 'to_commons', to: 'lumen_commons', pos: [0, 46], arrive: [30.5, 2], label: 'Lanternmere', color: '#ffe27a', requires: null }
    ],
    wisps: [[-6, 18], [2, -12], [-1, -26]],
    pools: [
      { pos: [-22, -6], r: 6,   color: '#3f5a35' },   // Rotwater Bog
      { pos: [0, -42],  r: 7.5, color: '#36472a' }    // the Great Bog (Grubnak)
    ],
    props: [
      // --- Fennick's camp
      { type: 'tent',     pos: [13, 35],    rot: -1.2,  scale: 1 },
      { type: 'campfire', pos: [10, 30.5],  rot: 0,     scale: 1 },
      { type: 'log',      pos: [12.5, 28.5], rot: 0.3,  scale: 0.8 },
      { type: 'lantern',  pos: [4, 30],     rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [3, 43],     rot: 0,     scale: 1 },
      { type: 'signpost', pos: [-4, 35],    rot: 0.5,   scale: 1, label: 'Rotwater Bog ->' },
      // --- Lantern line along the trail: lit near camp, snuffed (dark tint)
      //     where the Hollow Sprites have eaten the glow.  The six snuffed
      //     ones are side quest s06 "Relight the Path" (Press E to relight;
      //     lit state saved per id).  Each stands 1.5-2 units off the trail
      //     and >= 9 units from every camp, ordered camp -> Great Bog.
      { type: 'lantern',  pos: [-3, 22],    rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [-8, 15.5],  rot: 0,     scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_1' },
      { type: 'lantern',  pos: [-5, 7],     rot: 0,     scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_2' },
      { type: 'lantern',  pos: [3.4, 0.1],  rot: 0,     scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_3' },
      { type: 'lantern',  pos: [9, -11],    rot: 0,     scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_4' },
      { type: 'lantern',  pos: [3.5, -20],  rot: 0,     scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_5' },
      { type: 'lantern',  pos: [1.6, -30.5], rot: 0,    scale: 1, color: '#3b3550', interact: 'relight', id: 'ml_lantern_6' },
      // --- Rotwater Bog (mid-zone)
      { type: 'log',       pos: [-22, -1],  rot: 0.4,   scale: 1 },
      { type: 'log',       pos: [-25, -11], rot: 1.8,   scale: 1 },
      { type: 'tree_dead', pos: [-18, -11], rot: 0.2,   scale: 1 },
      { type: 'tree_dead', pos: [-27, -2],  rot: 2.0,   scale: 0.9 },
      { type: 'mushroom',  pos: [-17, -4],  rot: 0,     scale: 1.3 },
      { type: 'mushroom',  pos: [-21, -13], rot: 0,     scale: 1.1 },
      { type: 'mushroom',  pos: [-26, 1],   rot: 0,     scale: 1.4 },
      { type: 'mushroom',  pos: [-29, -8],  rot: 0,     scale: 1.2 },
      { type: 'mushroom',  pos: [-15, -9],  rot: 0,     scale: 1 },
      { type: 'mushroom',  pos: [-23, 0],   rot: 0,     scale: 0.9 },
      { type: 'rock',      pos: [-16, 1],   rot: 0.7,   scale: 1 },
      // --- Gloom fields: a Hollow taint crystal + remains
      { type: 'crystal',   pos: [-20, -24], rot: 0,     scale: 0.7, color: '#a879ff' },
      { type: 'bones',     pos: [-21, -21], rot: 1.0,   scale: 1 },
      { type: 'bones',     pos: [24, -29],  rot: 2.2,   scale: 1 },
      { type: 'thornvine', pos: [27, -20],  rot: 0.5,   scale: 0.8 },
      { type: 'signpost',  pos: [-5, -31],  rot: 3.14,  scale: 1, label: 'Turn back! - the Bog King' },
      // --- The Great Bog (boss arena)
      { type: 'log',       pos: [-7, -37],  rot: 0.3,   scale: 1.1 },
      { type: 'log',       pos: [7, -47],   rot: 2.0,   scale: 1.1 },
      { type: 'tree_dead', pos: [-9, -46],  rot: 0.8,   scale: 1.2 },
      { type: 'tree_dead', pos: [9, -37],   rot: 2.6,   scale: 1.1 },
      { type: 'tree_dead', pos: [-2, -49.5], rot: 1.4,  scale: 1.3 },
      { type: 'mushroom',  pos: [-8, -41],  rot: 0,     scale: 1.6 },
      { type: 'mushroom',  pos: [8, -43],   rot: 0,     scale: 1.5 },
      { type: 'mushroom',  pos: [-5, -48],  rot: 0,     scale: 1.3 },
      { type: 'mushroom',  pos: [5, -48],   rot: 0,     scale: 1.4 },
      { type: 'bones',     pos: [4, -36],   rot: 0.4,   scale: 1 }
    ],
    scatter: { tree_round: 45, bush: 28, flower: 45, mushroom: 30, rock: 14, rock_big: 4, log: 4 },
    // Grubnak freed (m05): the bogs run clear, every lantern on the trail
    // relights and the golden hour warms up.
    restored: [
      { quest: 'm05', ground: '#80b257', ground2: '#6a9e48', sky: '#f0e2bc', skyTop: '#5ea0e0',
        fog: '#d8e0cc', fogNear: 50, fogFar: 170, sun: '#ffdc9c', sunIntensity: 1.08, ambient: '#cbd3b6',
        pools: { color: '#3f7a6c' }, lanterns: 'lit' }
    ],
    seed: 2202
  },

  // ===================================================================
  //  WHISPERWOOD — levels 3-6 (dusky teal/violet pine forest, fog)
  //  Entrance EAST. Ranger camp + herbalist -> wolf thickets ->
  //  ghoul hollows (west) -> Thornmaw's thorn-ringed clearing.
  // ===================================================================
  whisperwood: {
    name: 'Whisperwood', subtitle: 'The trees remember',
    levelRange: [3, 6], safe: false,
    size: 52,
    style: 'forest',
    ground: '#3d6a5c', ground2: '#2f584e', path: '#8d6b47',   // v1.1 polish (B15): warm earth, not grey asphalt
    sky: '#6476ad', skyTop: '#2a2153', fog: '#58698f', fogNear: 18, fogFar: 85,
    sun: '#cdb8ff', sunIntensity: 0.75, ambient: '#7088ad',
    spawn: [35.5, 4],
    paths: [
      // critical path: gate -> ranger camp -> wolf thickets -> ghoul hollows -> Thornmaw
      [[47, 4], [38, 4], [26, 2], [16, -2], [6, 4], [-4, 0], [-14, -6], [-24, -2], [-32, 0]],
      [[38, 4], [32, -4]],                   // Sela's ranger camp
      [[38, 4], [30, 12]],                   // Wren's herb stall
      [[6, 4], [0, 12], [-12, 16], [-22, 18]],   // northern thicket loop
      [[-4, 0], [0, -14], [6, -24]]          // southern hollow
    ],
    npcs: [
      { id: 'sela', pos: [32, -4], face: 0.84 },
      { id: 'wren', pos: [30, 12], face: 2.2 }
    ],
    groups: [
      // --- Wolf thickets (L4) — packs
      { id: 'ww_wolf1', enemies: ['hollow_wolf'],                pos: [18, 14],  wander: 3.5, respawn: 30 },
      { id: 'ww_wolf2', enemies: ['hollow_wolf', 'hollow_wolf'], pos: [16, -14], wander: 3.5, respawn: 35 },
      { id: 'ww_wolf3', enemies: ['hollow_wolf'],                pos: [4, 18],   wander: 3.5, respawn: 30 },
      { id: 'ww_wolf4', enemies: ['hollow_wolf'],                pos: [2, -12],  wander: 3.5, respawn: 30 },
      { id: 'ww_wolf5', enemies: ['hollow_wolf', 'hollow_wolf'], pos: [-6, 14],  wander: 3.5, respawn: 35 },
      { id: 'ww_wolf6', enemies: ['hollow_wolf'],                pos: [8, -28],  wander: 3.5, respawn: 30 },
      // --- Ghoul hollows (L5) — deeper, toward the clearing
      { id: 'ww_ghoul1', enemies: ['bramble_ghoul'],                pos: [-14, -18], wander: 3, respawn: 30 },
      { id: 'ww_ghoul2', enemies: ['bramble_ghoul', 'hollow_wolf'], pos: [-18, 12],  wander: 3, respawn: 40 },
      { id: 'ww_ghoul3', enemies: ['bramble_ghoul'],                pos: [-26, -24], wander: 3, respawn: 30 },
      { id: 'ww_ghoul4', enemies: ['bramble_ghoul'],                pos: [-28, 22],  wander: 3, respawn: 30 },
      { id: 'ww_ghoul5', enemies: ['bramble_ghoul'],                pos: [-30, -12], wander: 3, respawn: 30 },
      // --- BOSS: Thornmaw (the hollowed Heartoak) + two Thorn Sprouts, in the thorn-ringed Heart of the Wood
      // --- ELITES (v1.1)
      { id: 'ww_elite_alpha',   enemies: ['shadowfang_alpha', 'hollow_wolf'], pos: [24, 32],   wander: 2.5, respawn: 120 },
      { id: 'ww_elite_hulk',    enemies: ['elder_bramblehulk', 'hollow_wolf'], pos: [-10, -40], wander: 2.5, respawn: 120 },
      { id: 'ww_boss_thornmaw', enemies: ['thorn_sprout', 'thornmaw', 'thorn_sprout'], pos: [-39, 2], wander: 1.5, respawn: 150 }
    ],
    portals: [
      { id: 'to_commons', to: 'lumen_commons', pos: [47, 4], arrive: [-30.5, 2], label: 'Lanternmere', color: '#ffe27a', requires: null }
    ],
    wisps: [[24, 4], [-4, -2], [-28, 2]],
    props: [
      // --- Sela's ranger camp
      { type: 'tent',     pos: [36, -9],    rot: -0.6,  scale: 1 },
      { type: 'campfire', pos: [29, -7.5],  rot: 0,     scale: 1 },
      { type: 'log',      pos: [27, -9.5],  rot: 1.2,   scale: 0.8 },
      { type: 'banner',   pos: [36, -2.5],  rot: 0.84,  scale: 1, color: '#7fd88a' },
      { type: 'banner',   pos: [28, -1],    rot: 0.84,  scale: 1, color: '#7fd88a' },
      { type: 'lantern',  pos: [38, 0],     rot: 0,     scale: 1 },
      { type: 'signpost', pos: [41, -1],    rot: -1.57, scale: 1, label: 'Ranger Camp' },
      // --- Wren's herb stall
      { type: 'stall',    pos: [27.5, 15],  rot: 2.2,   scale: 1 },
      { type: 'lantern',  pos: [33, 13],    rot: 0,     scale: 1 },
      { type: 'mushroom', pos: [33, 16],    rot: 0,     scale: 1.2 },
      { type: 'mushroom', pos: [31.5, 17],  rot: 0,     scale: 0.9 },
      { type: 'mushroom', pos: [25.5, 11],  rot: 0,     scale: 1.1 },
      { type: 'flower',   pos: [33, 9.5],   rot: 0,     scale: 1 },
      { type: 'flower',   pos: [27, 9],     rot: 0,     scale: 1 },
      // --- Giant trees: landmarks along the critical path
      { type: 'tree_giant', pos: [12, 8],   rot: 0.3,   scale: 1.3 },
      { type: 'tree_giant', pos: [-8, -10], rot: 1.2,   scale: 1.2 },
      { type: 'tree_giant', pos: [24, -16], rot: 2.0,   scale: 1.1 },
      { type: 'tree_giant', pos: [-20, 26], rot: 0.7,   scale: 1.2 },
      { type: 'rock_big',   pos: [9, -19],  rot: 0.9,   scale: 1 },
      // --- Ghoul hollows: creeping Hollow corruption
      { type: 'thornvine', pos: [-16, 4],   rot: 0.4,   scale: 1 },
      { type: 'thornvine', pos: [-22, -20], rot: 1.9,   scale: 1 },
      { type: 'tree_dead', pos: [-12, -26], rot: 0.5,   scale: 1.1 },
      { type: 'tree_dead', pos: [-30, 16],  rot: 2.2,   scale: 1 },
      { type: 'bones',     pos: [-24, -14], rot: 0.3,   scale: 1 },
      { type: 'bones',     pos: [-20, 18],  rot: 1.6,   scale: 1 },
      // --- Thornmaw's clearing: ring of thornvines (open to the east)
      { type: 'thornvine', pos: [-34.5, 9.8],  rot: 0.0, scale: 1.3 },
      { type: 'thornvine', pos: [-40.6, 10.9], rot: 0.7, scale: 1.4 },
      { type: 'thornvine', pos: [-45.9, 7.8],  rot: 1.4, scale: 1.3 },
      { type: 'thornvine', pos: [-48, 2],      rot: 2.1, scale: 1.4 },
      { type: 'thornvine', pos: [-45.9, -3.8], rot: 2.8, scale: 1.3 },
      { type: 'thornvine', pos: [-40.6, -6.9], rot: 3.5, scale: 1.4 },
      { type: 'thornvine', pos: [-34.5, -5.8], rot: 4.2, scale: 1.3 },
      { type: 'tree_giant', pos: [-46, 16],  rot: 0.2,  scale: 1.3 },
      { type: 'tree_giant', pos: [-46, -12], rot: 1.8,  scale: 1.3 },
      { type: 'bones',      pos: [-35, 3],   rot: 0.9,  scale: 1.2 }
    ],
    scatter: { tree_pine: 70, tree_round: 10, tree_giant: 3, bush: 28, mushroom: 25, rock: 14, flower: 10, thornvine: 6, log: 6 },
    // Thornmaw freed (m10): the Heartoak breathes again - the fog lifts,
    // the moss greens and the dusk shifts from violet toward soft teal.
    restored: [
      { quest: 'm10', ground: '#467a5e', ground2: '#386a51', sky: '#7aa4b8', skyTop: '#2c4a78',
        fog: '#7695a6', fogNear: 30, fogFar: 115, sun: '#d6f0dc', sunIntensity: 0.92, ambient: '#86a9b4' }
    ],
    seed: 3303
  },

  // ===================================================================
  //  ASHEN RUINS — levels 6-10 (ember sky, purple fog, Hollow stronghold)
  //  Entrance south. Lumen outpost -> wraith graveyard -> knight
  //  courtyard (east) / acolyte ritual site (west) -> ruined inner gate
  //  with Captain Vex -> eclipse altar before the Gloamgate, where Nyx,
  //  Herald of the Hollow King, waits.  (The ruins are old Dawnhold.)
  // ===================================================================
  ashen_ruins: {
    name: 'Ashen Ruins', subtitle: 'Where the Hollow Court gathers',
    levelRange: [6, 10], safe: false,
    size: 55,
    style: 'ruins',
    ground: '#4d3b3a', ground2: '#3b2c31', path: '#73604f',
    sky: '#ff8a4a', skyTop: '#3a1642', fog: '#5e3264', fogNear: 20, fogFar: 95,
    sun: '#ff9a5a', sunIntensity: 0.85, ambient: '#8c5c8c',
    spawn: [0, 39.5],
    paths: [
      // critical path: gate -> outpost -> graveyard -> courtyard -> ritual site -> ruined gate -> altar
      [[0, 51], [0, 42], [-4, 30], [-2, 18], [6, 6], [4, -6], [-6, -16], [-2, -24], [0, -30], [0, -38], [0, -45]],
      [[0, 42], [7, 37]],                          // Aldric's outpost
      [[-4, 30], [-14, 24], [-19.5, 22.5]],        // graveyard (ends at the first row of stones)
      [[4, -6], [14, -6], [19, -7.2]],             // old courtyard (ends before the fallen statue)
      [[-6, -16], [-16, -14], [-21.5, -14]]        // ritual site (into the crystal ring, up to the idol)
    ],
    npcs: [
      { id: 'aldric', pos: [8, 37], face: -0.785 }
    ],
    groups: [
      // --- Wraith graveyard (L7)
      { id: 'ar_wraith1', enemies: ['ash_wraith'],               pos: [-16, 30], wander: 3, respawn: 30 },
      { id: 'ar_wraith2', enemies: ['ash_wraith'],               pos: [16, 22],  wander: 3, respawn: 30 },
      { id: 'ar_wraith3', enemies: ['ash_wraith', 'ash_wraith'], pos: [-20, 14], wander: 3, respawn: 35 },
      { id: 'ar_wraith4', enemies: ['ash_wraith'],               pos: [20, 8],   wander: 3, respawn: 30 },
      { id: 'ar_wraith5', enemies: ['ash_wraith'],               pos: [-32, 24], wander: 3, respawn: 30 },
      // --- Old courtyard (L8) — bone knights
      { id: 'ar_knight1', enemies: ['bone_knight'],               pos: [14, -4],  wander: 2.5, respawn: 30 },
      { id: 'ar_knight2', enemies: ['bone_knight', 'ash_wraith'], pos: [28, -2],  wander: 2.5, respawn: 40 },
      { id: 'ar_knight3', enemies: ['bone_knight'],               pos: [22, -16], wander: 2.5, respawn: 30 },
      { id: 'ar_knight4', enemies: ['bone_knight'],               pos: [36, -16], wander: 2.5, respawn: 30 },
      { id: 'ar_knight5', enemies: ['bone_knight'],               pos: [-10, -6], wander: 2.5, respawn: 30 },
      // --- Ritual site (L9) — acolytes among the crystals
      { id: 'ar_acolyte1', enemies: ['hollow_acolyte'],                   pos: [-14, -18], wander: 2.5, respawn: 30 },
      { id: 'ar_acolyte2', enemies: ['hollow_acolyte', 'hollow_acolyte'], pos: [-28, -6],  wander: 2.5, respawn: 40 },
      { id: 'ar_acolyte3', enemies: ['hollow_acolyte', 'bone_knight'],    pos: [-30, -22], wander: 2.5, respawn: 40 },
      { id: 'ar_acolyte4', enemies: ['hollow_acolyte'],                   pos: [-21, -35], wander: 2.5, respawn: 30 },
      { id: 'ar_acolyte5', enemies: ['hollow_acolyte'],                   pos: [16, -28],  wander: 2.5, respawn: 30 },
      // --- BOSS: Captain Vex holds the ruined gate
      // --- ELITES (v1.1)
      { id: 'ar_elite_revenant',   enemies: ['cinder_revenant', 'ash_wraith'], pos: [-42, 38],  wander: 2.5, respawn: 120 },
      { id: 'ar_elite_knight',     enemies: ['dread_knight', 'bone_knight'], pos: [40, -2],   wander: 2.5, respawn: 120 },
      { id: 'ar_elite_hierophant', enemies: ['hollow_hierophant', 'hollow_acolyte'], pos: [-40, -40], wander: 2.5, respawn: 120 },
      { id: 'ar_boss_vex', enemies: ['hollow_acolyte', 'captain_vex'], pos: [0, -27], wander: 1.5, respawn: 180 },
      // --- FINAL BOSS: Nyx, Herald of the Hollow King, at the eclipse altar before the Gloamgate
      { id: 'ar_boss_nyx', enemies: ['hollow_acolyte', 'nyx_herald'], pos: [0, -44], wander: 1, respawn: 300 }
    ],
    portals: [
      { id: 'to_commons', to: 'lumen_commons', pos: [0, 51], arrive: [5, -31.5], label: 'Lanternmere', color: '#ffe27a', requires: null },
      // ---- v1.2 WS4: the star-vault door to the Hollow Orrery (post-game dungeon, game/data/dungeons.js)
      { id: 'to_orrery', to: 'hollow_orrery', pos: [30, 46], arrive: [0, 39], label: 'The Hollow Orrery', color: '#b48cff',
        requires: { quest: 'm17', level: 10 }, lockText: 'The star-vault door is sealed. Sir Aldric may know how to open it.' }
    ],
    wisps: [[-4, 22], [4, -2], [-6, -20]],
    props: [
      // --- Lumen outpost (Aldric)
      { type: 'tent',     pos: [13, 40],   rot: -0.8,  scale: 1 },
      { type: 'campfire', pos: [11.5, 34], rot: 0,     scale: 1 },
      { type: 'banner',   pos: [4, 34],    rot: -0.785, scale: 1.1, color: '#ffe27a' },
      { type: 'banner',   pos: [14, 35],   rot: -0.785, scale: 1.1, color: '#ffe27a' },
      { type: 'crystal',  pos: [4.5, 43],  rot: 0,     scale: 0.9, color: '#ffe27a' },
      { type: 'fence',    pos: [17, 38],   rot: 1.57,  scale: 1 },
      { type: 'fence',    pos: [17, 33],   rot: 1.57,  scale: 1 },
      { type: 'lantern',  pos: [3, 38],    rot: 0,     scale: 1 },
      { type: 'lantern',  pos: [3.5, 50],  rot: 0,     scale: 1 },
      // --- Wraith graveyard
      { type: 'gravestone', pos: [-27, 19], rot: 0.1,  scale: 1 },
      { type: 'gravestone', pos: [-24, 18], rot: -0.2, scale: 1 },
      { type: 'gravestone', pos: [-21, 20], rot: 0.3,  scale: 1 },
      { type: 'gravestone', pos: [-27, 23], rot: -0.1, scale: 1 },
      { type: 'gravestone', pos: [-24, 22], rot: 0.2,  scale: 1.1 },
      { type: 'gravestone', pos: [-21, 24], rot: 0,    scale: 1 },
      { type: 'gravestone', pos: [-27, 27], rot: 0.4,  scale: 0.9 },
      { type: 'gravestone', pos: [-24, 26], rot: -0.3, scale: 1 },
      { type: 'tree_dead',  pos: [-30, 30], rot: 1.1,  scale: 1.3 },
      { type: 'tree_dead',  pos: [-12, 19], rot: 2.5,  scale: 1.1 },
      // --- Old courtyard (bone knights): pillar ring around a fallen statue
      { type: 'statue',   pos: [22, -8],    rot: 0.3,  scale: 1.2 },
      { type: 'pillar',   pos: [28, -8],    rot: 0,    scale: 1 },
      { type: 'pillar',   pos: [16, -9],    rot: 0,    scale: 1 },
      { type: 'pillar_broken', pos: [22, -2],    rot: 0.5, scale: 1 },
      { type: 'pillar_broken', pos: [25.5, -13], rot: 1.3, scale: 1 },
      { type: 'pillar',   pos: [18.5, -13], rot: 0,    scale: 1 },
      { type: 'ruin_wall', pos: [30, -12],  rot: 1.57, scale: 1 },
      { type: 'ruin_wall', pos: [14, -14],  rot: 0.3,  scale: 1 },
      { type: 'bones',    pos: [20, -4],    rot: 0.8,  scale: 1 },
      // --- Ritual site (acolytes): violet crystals around a dark idol,
      //     the ring open to the east where the path walks in
      { type: 'statue',   pos: [-24, -14],  rot: 1.57, scale: 0.9, color: '#3a1a4a' },
      { type: 'crystal',  pos: [-21.2, -11.2], rot: 0,   scale: 1.1, color: '#b06cff' },
      { type: 'crystal',  pos: [-21.2, -16.8], rot: 0.5, scale: 1,   color: '#b06cff' },
      { type: 'crystal',  pos: [-26.8, -16.8], rot: 1.0, scale: 1.2, color: '#b06cff' },
      { type: 'crystal',  pos: [-26.8, -11.2], rot: 1.5, scale: 1,   color: '#b06cff' },
      { type: 'bones',    pos: [-22, -12],  rot: 0.2,  scale: 1 },
      { type: 'bones',    pos: [-26, -16],  rot: 2.0,  scale: 1 },
      // --- The ruined inner gate of Dawnhold (Captain Vex) — walls funnel the path through the arch
      { type: 'arch',      pos: [0, -33],     rot: 0,    scale: 1.4 },
      { type: 'ruin_wall', pos: [-7.2, -33],  rot: 0,    scale: 1 },
      { type: 'ruin_wall', pos: [-14.5, -33.5], rot: 0.1, scale: 1 },
      { type: 'ruin_wall', pos: [7.2, -33],   rot: 0,    scale: 1 },
      { type: 'ruin_wall', pos: [14.5, -33.5], rot: -0.1, scale: 1 },
      { type: 'banner',    pos: [-4.5, -30],  rot: 0,    scale: 1.2, color: '#6a2a8a' },
      { type: 'banner',    pos: [4.5, -30],   rot: 0,    scale: 1.2, color: '#6a2a8a' },
      // --- The eclipse altar before the Gloamgate (Nyx): crystal + pillar
      //     ring open to the south; the Gloamgate itself is a huge dark arch
      //     filled with a black crystal at the north end.
      { type: 'pillar',  pos: [3.75, -38.5],  rot: 0,   scale: 1.2 },
      { type: 'crystal', pos: [6.5, -41.25],  rot: 0.3, scale: 1.3, color: '#7a2aff' },
      { type: 'pillar',  pos: [7.5, -45],     rot: 0,   scale: 1.2 },
      { type: 'crystal', pos: [6.5, -48.75],  rot: 0.9, scale: 1.3, color: '#7a2aff' },
      { type: 'arch',    pos: [0, -52.5],     rot: 0,   scale: 2.2, color: '#3a1a4a' },
      { type: 'crystal', pos: [0, -52.8],     rot: 0,   scale: 1.8, color: '#1e0a2e' },
      { type: 'crystal', pos: [-6.5, -48.75], rot: 1.6, scale: 1.3, color: '#7a2aff' },
      { type: 'pillar',  pos: [-7.5, -45],    rot: 0,   scale: 1.2 },
      { type: 'crystal', pos: [-6.5, -41.25], rot: 2.2, scale: 1.3, color: '#7a2aff' },
      { type: 'pillar',  pos: [-3.75, -38.5], rot: 0,   scale: 1.2 },
      { type: 'bones',   pos: [5, -36],       rot: 1.2, scale: 1 },
      { type: 'bones',   pos: [-5, -36.5],    rot: 2.9, scale: 1 }
    ],
    scatter: { tree_dead: 34, rock: 24, rock_big: 8, pillar_broken: 12, ruin_wall: 6, gravestone: 14, bones: 14, crystal: 8, bush: 8, thornvine: 6 },
    // Nyx defeated (m17): dawn over old Dawnhold - a warm gold sunrise
    // burns off most of the purple Hollow fog.
    restored: [
      { quest: 'm17', ground: '#57463f', ground2: '#463733', sky: '#ffc48a', skyTop: '#5b4a86',
        fog: '#a47e7c', fogNear: 30, fogFar: 115, sun: '#ffd09a', sunIntensity: 1.05, ambient: '#b0949c' }
    ],
    seed: 4404
  }
};

// ---- v2.0 WS-B (Pets): the ONE portal arch to the Nestling Glade (game/data/zones_glade.js).
// North-east of the Spire on a short spur off the Spire ring road, so the plaza and the
// reserved South Gate slots stay clear (V2.0-CONTRACT §0.4 "Lanternmere stays uncluttered").
(function (hub) {
  if (!hub || hub.portals.some(function (p) { return p.to === 'hatchery_glade'; })) return;
  hub.portals.push({ id: 'to_glade', to: 'hatchery_glade', pos: [26, -24], arrive: [0, 13.5], label: 'Nestling Glade', color: '#ffb8e0', requires: null });
  hub.paths.push([[9, -16], [17.55, -16.2], [24.4, -22.5]]);
  hub.props.push({ type: 'signpost', pos: [14.5, -13.6], rot: -2.3, scale: 1, label: 'Nestling Glade' });
})(WF.data.zones.lumen_commons);
