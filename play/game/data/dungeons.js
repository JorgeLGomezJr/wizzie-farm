// =====================================================================
//  WIZZIE FARM — DUNGEONS (v1.2, WS4: level-designer + world-builder)
//
//  Loaded right after zones.js. A dungeon is an ordinary zone (same schema
//  as zones.js, so every zone tool works on it) plus a dungeon definition in
//  WF.data.dungeons that world.js (W.dungeon) runs as an INSTANCE:
//    * entering always resets it: every group alive, every star door sealed;
//    * groups never respawn inside; leaving, a defeat or reloading the game
//      resets it the next time you come in (no lockout, no cooldown);
//    * a room's star door turns open when the boss before it is beaten
//      (the first one when you walk up to it), with a camera beat;
//    * after the final boss an exit portal and a reward chest appear.
//  Nothing about the instance is saved (only quest progress and loot).
//
//  ROOM GEOMETRY: each room is a floor polygon `poly` ([x, z] points, in
//  order). Every polygon edge is a wall; an edge two rooms share is built
//  once, with the door gap cut out of it. The helper at the bottom turns the
//  walls into props (carved wall sections, cave rock behind the outer walls,
//  pillars at the corners and door frames). world.js also lays an unbroken
//  line of invisible colliders along every wall (W.dungeon), so the rooms are
//  sealed whatever the art looks like, and a door's barrier is removed when
//  it opens. Map: docs/design/levels.md §8.
//
//  Coordinates are [x, z] like zones.js; north (the top of the minimap) is -Z.
// =====================================================================
window.WF = window.WF || { data: {} };
WF.data.zones = WF.data.zones || {};
WF.data.dungeons = WF.data.dungeons || {};

(function (D) {
  'use strict';

  // ------------------------------------------------------------------
  //  THE HOLLOW ORRERY  (level 10, post-game; entrance in the Ashen Ruins)
  //
  //            N (-Z)                                    the Heart of the Orrery (R3)
  //                 . - O - .                            O orrery, A Archon, E exit, C chest
  //              .   C  A   E  .
  //              .      g      .                         g = mob group
  //               ' . _ D3 _ . '
  //            .--------D3--------.                      the Rotunda of the Watch (R2)
  //           /   g      W      g  \                     W Warden Morrow
  //           |      o   x   o     |                     x rune circle, o pillars
  //            \_______ D2 _______/
  //                |    S    |                           the Gallery of Lenses (R1)
  //              t[|   g     |]t                         S Sentinel, t broken telescopes
  //                |___ D1 __|
  //             /      K   @   \                         the Hall of Hours (entry)
  //             \______P______/                          K keeper, @ spawn, P portal out
  //            S (+Z)
  // ------------------------------------------------------------------
  var HALL = [[-8, 33], [8, 33], [11, 36], [11, 50], [8, 53], [-8, 53], [-11, 50], [-11, 36]];
  var R1 = [[-8, 33], [-8, 24], [-12, 24], [-12, 16], [-8, 16], [-8, 7], [8, 7], [8, 19], [12, 19], [12, 27], [8, 27], [8, 33]];
  var R2 = [[-8, 7], [8, 7], [16, -1], [16, -15], [8, -23], [-8, -23], [-16, -15], [-16, -1]];
  var R3 = [[-8, -23], [8, -23], [14, -27], [17, -35], [15.5, -43], [10, -49], [0, -51.5], [-10, -49], [-15.5, -43], [-17, -35], [-14, -27]];

  D.dungeons.hollow_orrery = {
    name: 'The Hollow Orrery',
    zone: 'hollow_orrery',
    level: 10,
    entrance: { zone: 'ashen_ruins', portal: 'to_orrery' },
    requires: { quest: 'm17', level: 10 },
    music: 'ruins',                  // sfx.js has no 'vault' style yet (see the WS4 report)
    spawnFace: Math.PI,              // look north, at the first star door
    rooms: [
      { id: 'hall', name: 'The Hall of Hours', poly: HALL },
      { id: 'r1', name: 'The Gallery of Lenses', poly: R1, door: 'door_gallery', boss: 'orrery_sentinel' },
      { id: 'r2', name: 'The Rotunda of the Watch', poly: R2, door: 'door_rotunda', boss: 'warden_morrow' },
      { id: 'r3', name: 'The Heart of the Orrery', poly: R3, door: 'door_heart', boss: 'starless_archon', final: true }
    ],
    // A door opens 'approach' (the player walks within `radius`) or when `after`
    // (an enemy id) is defeated. `width` = the gap in the wall it seals.
    // Player-facing lines live in lore.js -> dungeonLines.hollow_orrery.
    doors: [
      { id: 'door_gallery', pos: [0, 33],  rot: 0, width: 6, opens: 'approach', radius: 4.5 },
      { id: 'door_rotunda', pos: [0, 7],   rot: 0, width: 6, opens: 'after', after: 'orrery_sentinel' },
      { id: 'door_heart',   pos: [0, -23], rot: 0, width: 6, opens: 'after', after: 'warden_morrow' }
    ],
    // v2.1 D16 (Jorge, Oct 21): optional Heroic mode, picked at the entrance and locked for the run; the
    // same for 1-3 wizards (no party scaling). Every Orrery enemy (summons too) gets enemyHp x health and
    // enemyDmg x damage; the dungeon set drops gearMult x as often and the chest holds bonus items.
    // Tuned with `node tests/dungeon-sim.js --only=heroic`: skilled solo (full T1 + boss spell) 55-65 %.
    heroic: {
      name: 'Heroic', enemyHp: 1.21, enemyDmg: 1.2,
      entry: 'The Orrery\u2019s brass doors stand open. The old wards can be woken, if you dare: the guardians grow stronger, and so does what they guard. Your choice holds until you leave.',
      desc: 'Every guardian has more health and hits harder. For wizards in full Starbound gear (or a party). Better loot: the Starbound set drops 1.5x as often, and the chest holds extra Star Shards.',
      rewards: { gearMult: 1.5, chest: { star_shard: [4, 6] } }
    },
    // After the final boss: a way home and a reward chest.
    exit: { id: 'orrery_exit', pos: [11, -44], to: 'ashen_ruins', arrive: [23.7, 36.4], label: 'Back to the Ashen Ruins', color: '#ffd76a', after: 'starless_archon' },
    chest: { id: 'orrery_chest', pos: [-9.5, -43], rot: 0.9, after: 'starless_archon', prop: 'reward_chest',
             gold: [260, 340], items: { star_shard: [3, 5] } },
    // Point lights that follow the player through the nearest light sources
    // (props with `light`). A fixed small pool keeps shader variants stable.
    lights: { pool: 4, range: 15, intensity: 1.7, swap: 0.35 }
  };

  // ------------------------------------------------------------------
  //  The zone itself (zones.js schema, validated by tests/zones-check.js)
  // ------------------------------------------------------------------
  var Z = {
    name: 'The Hollow Orrery', subtitle: 'The star-vault beneath Dawnhold',
    levelRange: [10, 10], safe: false,
    instance: true, dungeon: 'hollow_orrery',
    size: 55,
    style: 'vault',
    ground: '#3a3150', ground2: '#2c2540', path: '#8a7a52',
    sky: '#2a1e48', skyTop: '#0c0818', fog: '#1e1634', fogNear: 26, fogFar: 78,
    sun: '#b9a8ff', sunIntensity: 0.55, ambient: '#7a6aa8',
    spawn: [0, 39],
    paths: [
      // the critical path: portal -> hall -> gallery -> rotunda -> heart (ends before the Archon)
      [[0, 48], [0, 39], [0, 33], [0, 26], [-1.5, 19], [0, 12], [0, 7], [0, -1], [0, -8], [0, -16], [0, -23], [-1.5, -30], [0, -36]]
    ],
    npcs: [
      { id: 'orrery_keeper', pos: [-6.5, 41], face: 1.75 }
    ],
    groups: [
      // --- R1 the Gallery of Lenses: a hound pack, then the Sentinel before the second door
      { id: 'ho_r1_pack',   enemies: ['shard_hound', 'shard_hound'],   pos: [2.5, 23],  wander: 2,   respawn: 9999 },
      { id: 'ho_r1_boss',   enemies: ['orrery_sentinel'],             pos: [0, 13],    wander: 1,   respawn: 9999 },
      // --- R2 the Rotunda of the Watch: two packs on either side, Warden Morrow at the far door
      { id: 'ho_r2_west',   enemies: ['orrery_seer', 'shard_hound'],  pos: [-9, -4],   wander: 2,   respawn: 9999 },
      { id: 'ho_r2_east',   enemies: ['orrery_seer', 'orrery_seer'],  pos: [9, -11],   wander: 2,   respawn: 9999 },
      { id: 'ho_r2_boss',   enemies: ['warden_morrow'],               pos: [0, -15],   wander: 1,   respawn: 9999 },
      // --- R3 the Heart of the Orrery: the last guard, then the Archon before the great orrery
      { id: 'ho_r3_guard',  enemies: ['shard_hound', 'orrery_seer'],  pos: [-6, -31],  wander: 2,   respawn: 9999 },
      // the Archon calls its two keepers at 50 % (enemies_dungeon.js `summon`); on an engine without
      // summon support world.js uses `fallback`: the keepers stand beside it from the start
      { id: 'ho_r3_boss',   enemies: ['starless_archon'],             pos: [0, -40],   wander: 0.5, respawn: 9999,
        fallback: { unless: 'summon', enemies: ['shard_hound', 'starless_archon', 'orrery_seer'] } }
    ],
    portals: [
      // return portal in the Hall of Hours (always open). Faces north, into the hall.
      { id: 'to_ashen', to: 'ashen_ruins', pos: [0, 50.5], arrive: [23.7, 36.4], label: 'Ashen Ruins', color: '#ffb46a', requires: null }
    ],
    wisps: [[6.5, 44], [-9.8, 21.4], [6, -20], [10, -33]],
    props: [],          // filled below: room features + generated walls
    scatter: {},
    seed: 1009
  };

  // ---- hand-placed features (lights: `light` makes world.js aim a point light there) ----
  var GOLD = '#ffcf6a', VIOLET = '#b48cff', STAR = '#8fd8ff', EMBER = '#ffb060';
  Z.props.push(
    // Hall of Hours: a rune circle under the arrival, braziers in the corners, the door flanked by obelisks
    { type: 'rune_circle',     pos: [0, 43],      rot: 0,    scale: 1.3, color: GOLD },
    { type: 'brazier',         pos: [-8, 36.5],   rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [8, 36.5],    rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [-8.5, 49.5], rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [8.5, 49.5],  rot: 0,    scale: 1,   light: EMBER },
    { type: 'obelisk',         pos: [-5.5, 35],   rot: 0,    scale: 0.9, color: GOLD },
    { type: 'obelisk',         pos: [5.5, 35],    rot: 0,    scale: 0.9, color: GOLD },
    { type: 'crystal_cluster', pos: [9.5, 41.5],  rot: 1.2,  scale: 1,   color: STAR, light: STAR },
    { type: 'telescope_broken', pos: [-8.5, 45.5], rot: 2.2, scale: 1 },
    // Gallery of Lenses: a colonnade, broken telescopes in the two alcoves, braziers by the doors
    { type: 'vault_pillar',    pos: [-6.4, 29.5], rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [6.4, 29.5],  rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [-6.4, 12],   rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [6.4, 12],    rot: 0,    scale: 1 },
    { type: 'telescope_broken', pos: [-10.4, 18.6], rot: 1.57, scale: 1.1 },
    { type: 'crystal_cluster', pos: [-10.8, 16.9], rot: 0.4, scale: 0.8, color: VIOLET, light: VIOLET },
    { type: 'telescope_broken', pos: [10.3, 23.5], rot: -1.4, scale: 1.1 },
    { type: 'crystal_cluster', pos: [10.6, 25.6], rot: 2.0,  scale: 0.8, color: STAR, light: STAR },
    { type: 'brazier',         pos: [-6, 25.5],   rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [6, 17.5],    rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [-6.2, 9.2],  rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [6.2, 9.2],   rot: 0,    scale: 1,   light: EMBER },
    // Rotunda of the Watch: a ring of eight pillars around a rune circle, chained arches over the side packs
    { type: 'rune_circle',     pos: [0, -8],      rot: 0,    scale: 1.6, color: VIOLET },
    { type: 'vault_pillar',    pos: [3.4, -0.3],  rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [-3.4, -0.3], rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [8.3, -4.6],  rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [-8.3, -11.4], rot: 0,   scale: 1 },
    { type: 'vault_pillar',    pos: [3.4, -15.7], rot: 0,    scale: 1 },
    { type: 'vault_pillar',    pos: [-3.4, -15.7], rot: 0,   scale: 1 },
    { type: 'chain_arch',      pos: [-13, -8],    rot: 1.57, scale: 1 },
    { type: 'chain_arch',      pos: [13, -8],     rot: 1.57, scale: 1 },
    { type: 'brazier',         pos: [-11, 2],     rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [11, 2],      rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [-11, -18],   rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [11, -18],    rot: 0,    scale: 1,   light: EMBER },
    { type: 'crystal_cluster', pos: [-14, -14.5], rot: 0.7,  scale: 0.9, color: VIOLET, light: VIOLET },
    { type: 'crystal_cluster', pos: [14, -1.5],   rot: 2.6,  scale: 0.9, color: VIOLET, light: VIOLET },
    // Heart of the Orrery: the great orrery behind the Archon, obelisks and crystals around the ring
    { type: 'orrery',          pos: [0, -48],     rot: 0,    scale: 1,   light: GOLD },
    { type: 'rune_circle',     pos: [0, -40],     rot: 0,    scale: 1.8, color: VIOLET },
    { type: 'obelisk',         pos: [-12.5, -30], rot: 0.5,  scale: 1.1, color: VIOLET },
    { type: 'obelisk',         pos: [12.5, -30],  rot: -0.5, scale: 1.1, color: VIOLET },
    { type: 'obelisk',         pos: [-14, -40],   rot: 0.2,  scale: 1.1, color: VIOLET },
    { type: 'obelisk',         pos: [14.5, -38],  rot: -0.2, scale: 1.1, color: VIOLET },
    { type: 'crystal_cluster', pos: [-7, -48.5],  rot: 0.3,  scale: 1.1, color: STAR, light: STAR },
    { type: 'crystal_cluster', pos: [7, -48.5],   rot: 2.1,  scale: 1.1, color: STAR, light: STAR },
    { type: 'brazier',         pos: [-5, -25.5],  rot: 0,    scale: 1,   light: EMBER },
    { type: 'brazier',         pos: [5, -25.5],   rot: 0,    scale: 1,   light: EMBER },
    { type: 'telescope_broken', pos: [11, -28.5], rot: -2.4, scale: 1 }
  );

  // the star doors (dynamic: world.js animates them and owns their collision)
  D.dungeons.hollow_orrery.doors.forEach(function (d) {
    Z.props.push({ type: 'star_door', pos: d.pos.slice(), rot: d.rot, scale: 1, id: d.id, dynamic: true });
  });

  // ------------------------------------------------------------------
  //  Walls: every room edge, shared edges once, door gaps cut out.
  //  Outer walls get cave rock behind them; corners get pillars.
  // ------------------------------------------------------------------
  function inPoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  }
  function wallsOf(def) {
    var segs = [], key = function (a, b) { return a[0] + ',' + a[1] + '|' + b[0] + ',' + b[1]; }, seen = {};
    def.rooms.forEach(function (room) {
      var P = room.poly;
      for (var i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length];
        if (seen[key(a, b)] || seen[key(b, a)]) continue;
        seen[key(a, b)] = true;
        segs.push([a, b]);
      }
    });
    // cut door gaps out of the segment each door sits on
    var out = [];
    segs.forEach(function (s) {
      var a = s[0], b = s[1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      var cuts = [];
      def.doors.forEach(function (d) {
        var t = (d.pos[0] - a[0]) * ux + (d.pos[1] - a[1]) * uz, off = Math.abs((d.pos[0] - a[0]) * uz - (d.pos[1] - a[1]) * ux);
        if (off < 0.01 && t > 0 && t < L) cuts.push([t - d.width / 2, t + d.width / 2]);
      });
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      var t0 = 0;
      cuts.concat([[L, L]]).forEach(function (c) {
        if (c[0] - t0 > 0.05) out.push([[a[0] + ux * t0, a[1] + uz * t0], [a[0] + ux * c[0], a[1] + uz * c[0]]]);
        t0 = c[1];
      });
    });
    // which side is open floor? (outer = only one side lies in a room)
    return out.map(function (s) {
      var a = s[0], b = s[1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;
      var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      var left = def.rooms.some(function (r) { return inPoly([mid[0] + nx * 0.8, mid[1] + nz * 0.8], r.poly); });
      var right = def.rooms.some(function (r) { return inPoly([mid[0] - nx * 0.8, mid[1] - nz * 0.8], r.poly); });
      return { a: a, b: b, len: L, outer: left !== right, out: left && !right ? [-nx, -nz] : (right && !left ? [nx, nz] : null) };
    });
  }
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var dungeonDef = D.dungeons.hollow_orrery;
  dungeonDef.walls = wallsOf(dungeonDef).map(function (w) { return { a: w.a, b: w.b, outer: w.outer, out: w.out }; });
  var STONE = '#4a4260', ROCK = ['#3d3850', '#454058', '#38344a'], corners = {};
  dungeonDef.walls.forEach(function (w, wi) {
    var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    var rot = r2(Math.atan2(-uz, ux));
    // carved wall sections (ruin_wall is 5 long at scale 1; its colliders reach 2.6 from its centre)
    var n = Math.max(1, Math.round(L / 4.6)), step = L / n, sc = Math.max(0.55, Math.min(1.2, step / 4.6));
    for (var i = 0; i < n; i++) {
      var t = step * (i + 0.5);
      Z.props.push({ type: 'ruin_wall', pos: [r2(w.a[0] + ux * t), r2(w.a[1] + uz * t)], rot: rot, scale: r2(sc), color: STONE });
    }
    // cave rock behind outer walls (keeps the rooms reading as underground)
    if (w.outer && L > 3) {
      var m = Math.max(1, Math.round(L / 6.5)), st2 = L / m;
      for (var k = 0; k < m; k++) {
        var t2 = st2 * (k + 0.5), o = 3.1;
        var px = w.a[0] + ux * t2 + w.out[0] * o, pz = w.a[1] + uz * t2 + w.out[1] * o;
        if (Math.abs(px) > Z.size - 1 || Math.abs(pz) > Z.size - 1) continue;
        Z.props.push({ type: 'rock_big', pos: [r2(px), r2(pz)], rot: r2((wi * 1.7 + k * 2.3) % 6.28), scale: 1.25, color: ROCK[(wi + k) % ROCK.length] });
      }
    }
    // a pillar on every outer corner (once per point)
    [w.a, w.b].forEach(function (p) {
      var k2 = r2(p[0]) + ',' + r2(p[1]);
      if (corners[k2] || !w.outer) return;
      corners[k2] = true;
      Z.props.push({ type: 'vault_pillar', pos: [r2(p[0]), r2(p[1])], rot: 0, scale: 1.1 });
    });
  });
  // door frames: a pillar on each side of every star door
  dungeonDef.doors.forEach(function (d) {
    var c = Math.cos(d.rot), s = Math.sin(d.rot), h = d.width / 2 + 0.75;
    [-1, 1].forEach(function (sd) {
      Z.props.push({ type: 'vault_pillar', pos: [r2(d.pos[0] + c * h * sd), r2(d.pos[1] - s * h * sd)], rot: 0, scale: 1.25 });
    });
  });

  D.zones.hollow_orrery = Z;
})(WF.data);
