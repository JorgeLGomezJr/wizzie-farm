// =====================================================================
//  WIZZIE FARM — 3D WORLD
//  Renderer, camera, zones, player movement, NPCs, enemy camps,
//  portals, wisps, interactable props, minimap.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.world = (function () {
  'use strict';
  var U = WF.util;
  var W = {
    mode: 'title',          // 'title' | 'explore' | 'dialog' | 'menu' | 'combat' | 'loading'
    zoneId: null, zone: null,
    renderer: null, scene: null, camera: null,
    player: null,            // { mesh, x, z, rot, moving, tag }
    npcs: [], groups: [], portals: [], wisps: [], colliders: [], fx: [], interactables: [], props: [], batches: [],
    cam: { yaw: Math.PI, pitch: 0.42, dist: 11, targetDist: 11 },
    keys: {}, time: 0,
    quality: 'high'
  };

  var zoneRoot = null;                      // everything that belongs to the current zone
  var pendingDispose = null;                // old zone, freed after the next render so shared shader programs stay alive
  var hemi, sun;
  var raycaster = new THREE.Raycaster();
  var mouse = { down: false, button: 0, buttons: 0, x: 0, y: 0, moved: 0 };
  var portalCooldown = 0, msgCooldown = 0;
  var PLAYER_SPEED = 7, PLAYER_RADIUS = 0.6;
  // Mount / rider state (v1.1). rider.mesh = WF.models.mount() root (null when
  // the art module is missing: the speed bonus still applies, on foot).
  var rider = { mesh: null, itemId: null, riding: false, suspended: false, hoofT: 0, camLift: 0, camBack: 0, camFwd: 0, camSide: 0 };
  var frameNo = 0, disposeQueue = [];      // meshes freed a frame later (shader programs stay warm)
  // reusable temporaries (avoid per-frame allocations)
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

  function prog() { return WF.data.progression; }
  function dispose(o) { if (o && WF.models.dispose) { try { WF.models.dispose(o); } catch (e) { /* ignore */ } } }
  function disposeLater(o) { if (o) disposeQueue.push({ o: o, f: frameNo }); }

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------
  W.init = function (container) {
    // v1.1 (R): the renderer only draws the frame; WF.gfx owns pixel ratio, shadows,
    // the HDR target + bloom + colour grade and the quality tiers (W.setQuality).
    var r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    W.renderer = r;

    W.scene = new THREE.Scene();
    W.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);

    hemi = new THREE.HemisphereLight(0xbfd8ff, 0x557744, 0.75);
    W.scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1d0, 0.66);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    W.scene.add(sun);
    W.scene.add(sun.target);
    W.sun = sun; W.hemi = hemi;
    if (WF.gfx) { WF.gfx.quality = W.quality; WF.gfx.init(r, { sun: sun }); }

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', function (e) {
      if (WF.util.isTyping(e.target)) return;
      W.keys[e.code] = true;
      // Act on the key event itself so a quick tap is never missed between frames
      if (e.code === 'KeyE' && !e.repeat && W.mode === 'explore' && W.player && !(WF.ui.blocking && WF.ui.blocking())) {
        e.preventDefault();
        W.interact();
      }
      // v2.0 (Jorge): Space = jump, on foot and mounted. Never in duels or while a window is open.
      if (e.code === 'Space' && !e.repeat && W.mode === 'explore' && W.player && !(WF.ui.blocking && WF.ui.blocking())) {
        e.preventDefault();
        W.jump();
      }
      if (e.code === 'KeyR' && !e.repeat && W.mode === 'explore' && W.player && !(WF.ui.blocking && WF.ui.blocking())) {
        e.preventDefault();
        W.toggleMount();
      }
    });
    // Gear changes rebuild the wizard; mount changes re-seat the rider
    WF.state.on(function (type) {
      if (type === 'equip') W.rebuildPlayer();
      else if (type === 'mount') syncMount(true);
    });
    // Duels always start on foot (also when started from the debug console)
    if (WF.combatView && WF.combatView.start && !WF.combatView.start.wfDismount) {
      var cvStart = WF.combatView.start;
      WF.combatView.start = function () { if (!WF.combatView.active) { if (W.player) { W.player.jumpY = 0; W.player.jumpV = 0; } suspendMount(); } return cvStart.apply(this, arguments); };
      WF.combatView.start.wfDismount = true;
    }
    window.addEventListener('keyup', function (e) { W.keys[e.code] = false; });
    window.addEventListener('blur', function () { W.keys = {}; mouse.down = false; });

    var el = r.domElement;
    el.addEventListener('mousedown', function (e) {
      mouse.down = true; mouse.button = e.button; mouse.buttons = e.buttons; mouse.x = e.clientX; mouse.y = e.clientY; mouse.moved = 0;
    });
    window.addEventListener('mouseup', function (e) {
      if (mouse.down && mouse.moved < 6 && e.target === el) onClick(e);
      mouse.down = false; mouse.buttons = e.buttons;
    });
    window.addEventListener('mousemove', function (e) {
      if (!mouse.down) return;
      mouse.buttons = e.buttons;
      if (!e.buttons) { mouse.down = false; return; }
      var dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.moved += Math.abs(dx) + Math.abs(dy);
      if (W.mode === 'explore') {
        W.cam.yaw -= dx * 0.006;
        W.cam.pitch = U.clamp(W.cam.pitch + dy * 0.004, 0.08, 1.25);
      }
    });
    el.addEventListener('wheel', function (e) {
      if (W.mode !== 'explore') return;
      W.cam.targetDist = U.clamp(W.cam.targetDist + Math.sign(e.deltaY) * 1.2, 4.5, 22);
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  function onResize() {
    W.camera.aspect = window.innerWidth / window.innerHeight;
    W.camera.updateProjectionMatrix();
    W.renderer.setSize(window.innerWidth, window.innerHeight);
    if (WF.gfx && WF.gfx.ready) WF.gfx.resize(window.innerWidth, window.innerHeight);
  }

  // Graphics tiers (v1.1): delegated to WF.gfx — 'ultra' | 'high' | 'medium' | 'low'
  // (see gfx.js TIERS: pixel ratio, MSAA, bloom/grade post, shadow map, grass/particle density).
  W.setQuality = function (q) {
    var Q = WF.gfx ? WF.gfx.qualities : ['high', 'medium', 'low'];
    if (Q.indexOf(q) < 0) q = 'high';
    W.quality = q;
    if (WF.gfx && WF.gfx.ready) WF.gfx.setQuality(q);
    else {
      var R = W.renderer, shadows = q !== 'low';
      R.shadowMap.enabled = shadows; sun.castShadow = shadows;
      R.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.25));
    }
    var dens = WF.models.envDensity;
    W.scene.traverse(function (o) {
      if (o.userData.applyDensity) o.userData.applyDensity(dens);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; });
    });
  };

  // ------------------------------------------------------------------
  // Zone look (with "restored" overrides after story milestones)
  // ------------------------------------------------------------------
  // v1.2 WS6: defaults for zone style 'vault' (the Hollow Orrery); a zone's own fields always win
  var VAULT_LOOK = { ground: '#302a44', ground2: '#241f36', path: '#c99a3e', sky: '#3a2c5c', skyTop: '#0d0a1c', fog: '#2c2446', fogNear: 28, fogFar: 96,
    sun: '#ffe2b8', sunIntensity: 1.05, ambient: '#a898d8', borderType: 'crystal_cluster', borderAlt: 'crystal_cluster' };
  W.zoneLook = function (Z) {
    var look = Object.assign({}, Z);
    if (look.style === 'vault') Object.keys(VAULT_LOOK).forEach(function (k) { if (look[k] == null) look[k] = VAULT_LOOK[k]; });
    look.restoredFlags = {};
    if (!WF.state.player) return look;
    (Z.restored || []).forEach(function (r) {
      if (!r.quest || !WF.state.player.quests.done[r.quest]) return;
      Object.keys(r).forEach(function (k) {
        if (k === 'quest') return;
        if (k === 'pools' || k === 'lanterns') look.restoredFlags[k] = r[k];
        else look[k] = r[k];
      });
    });
    return look;
  };

  // ------------------------------------------------------------------
  // Zone loading
  // ------------------------------------------------------------------
  W.loadZone = function (zoneId, arrive) {
    var Zraw = WF.data.zones[zoneId];
    if (!Zraw) { console.error('Unknown zone', zoneId); return; }
    if (zoneRoot) {
      W.scene.remove(zoneRoot);
      if (pendingDispose) dispose(pendingDispose);
      pendingDispose = zoneRoot;
    }
    W.fx.forEach(function (f) { if (f.parent) f.parent.remove(f); if (!f.userData.persistent) dispose(f); });
    W.fx = [];
    zoneRoot = new THREE.Group();
    zoneRoot.name = 'zone:' + zoneId;
    W.scene.add(zoneRoot);
    var Z = W.zoneLook(Zraw);
    // v1.2 WS4: dungeon instances reset on every entry (W.dungeon below)
    Z = W.dungeon.prepare(zoneId, Z);
    arrive = W.dungeon.arrival(zoneId, arrive);
    W.zoneId = zoneId;
    W.zone = Z;
    W.npcs = []; W.groups = []; W.portals = []; W.wisps = []; W.colliders = []; W.interactables = []; W.props = []; W.batches = [];

    // Atmosphere & lighting (values tuned by the technical artist for toon materials)
    W.scene.fog = new THREE.Fog(U.hexToInt(Z.fog || '#bfe3ff'), Z.fogNear || 35, Z.fogFar || 120);
    W.scene.background = new THREE.Color(Z.fog || '#bfe3ff');
    hemi.color.set(Z.ambient || '#bfd8ff');
    hemi.groundColor.set(Z.ground || '#557744').multiplyScalar(0.65);
    hemi.intensity = 0.75;
    sun.color.set(Z.sun || '#fff1d0');
    sun.intensity = 0.6 * (Z.sunIntensity != null ? Z.sunIntensity : 1.1);
    if (WF.gfx && WF.gfx.ready) WF.gfx.setGrade(Z);

    zoneRoot.add(WF.models.sky(Z));
    var ground = WF.models.ground(Z);
    zoneRoot.add(ground);
    if (WF.models.ambient) zoneRoot.add(WF.models.ambient(Z));     // pollen / fireflies / leaves / embers / ash

    var rng = U.seeded(Z.seed || 1234);
    var clear = [];     // keep-clear circles for scatter
    function keep(x, z, r) { clear.push([x, z, r]); }
    keep(Z.spawn[0], Z.spawn[1], 6);

    // NPCs
    (Z.npcs || []).forEach(function (n) {
      var d = WF.data.npcs[n.id];
      if (!d) { console.warn('Missing npc', n.id); return; }
      var m = WF.models.wizard(WF.models.npcLook ? WF.models.npcLook(n.id) : (d.look || {}));   // v2.1: round-2 NPC builds
      m.position.set(n.pos[0], 0, n.pos[1]);
      m.rotation.y = n.face || 0;
      zoneRoot.add(m);
      var h = m.userData.height || 2.1;
      var tag = WF.models.textSprite(d.name, { color: '#fff6c8', size: 0.85, bold: true });
      tag.position.set(0, h + 0.38, 0);
      m.add(tag);
      var tags = [tag];
      if (d.title) {
        var t2 = WF.models.textSprite(d.title, { color: '#cfe6ff', size: 0.6 });
        t2.position.set(0, h + 0.1, 0);
        m.add(t2); tags.push(t2);
      }
      W.npcs.push({ id: n.id, data: d, mesh: m, tags: tags, x: n.pos[0], z: n.pos[1], face: n.face || 0, marker: null, markerKind: null });
      W.colliders.push({ x: n.pos[0], z: n.pos[1], r: 0.7 });
      keep(n.pos[0], n.pos[1], 4);
    });

    // Portals
    (Z.portals || []).forEach(function (p) {
      var dest = WF.data.zones[p.to];
      var m = WF.models.portal(p.color || '#7fd8ff');
      m.position.set(p.pos[0], 0, p.pos[1]);
      m.rotation.y = Math.atan2(-p.pos[0], -p.pos[1]);   // face the zone centre
      zoneRoot.add(m);
      var label = WF.models.textSprite(p.label || (dest ? dest.name : p.to), { color: '#e6fbff', size: 0.9, bold: true });
      label.position.set(0, 5.2, 0);
      m.add(label);
      var lock = null;
      if (p.requires) {
        lock = WF.models.textSprite('🔒 Sealed', { color: '#ffb0b0', size: 0.65 });
        lock.position.set(0, 4.6, 0);
        m.add(lock);
      }
      W.portals.push({ def: p, mesh: m, lock: lock, tags: [label].concat(lock ? [lock] : []) });
      keep(p.pos[0], p.pos[1], 5);
    });

    // Wisps
    (Z.wisps || []).forEach(function (w) {
      var m = WF.models.wisp();
      m.position.set(w[0], 1.1, w[1]);
      zoneRoot.add(m);
      W.wisps.push({ x: w[0], z: w[1], mesh: m, respawnAt: 0 });
      keep(w[0], w[1], 2.5);
    });

    // Decorative mounts at the stables (v1.1; needs WF.models.mount)
    (Z.mountDisplays || []).forEach(function (md) {
      if (!WF.models.mount) return;
      var mm;
      try { mm = WF.models.mount(md.kind, { coat: md.coat, mane: md.mane, saddle: md.saddle, trim: md.trim, gem: md.gem }); }
      catch (e) { console.warn('mount display failed', md.kind, e); return; }
      if (!mm) return;
      mm.position.set(md.pos[0], 0, md.pos[1]);
      mm.rotation.y = md.face || 0;
      zoneRoot.add(mm);
      W.colliders.push({ x: md.pos[0], z: md.pos[1], r: Math.min(1.2, mm.userData.radius || 0.9) });
      keep(md.pos[0], md.pos[1], 2.5);
      if (mm.userData.anim) {
        var off = md.pos[0] * 0.37;
        var o = new THREE.Object3D();
        o.userData.persistent = true;
        o.userData.update = function (dt) { if (!mm.parent) return false; mm.userData.anim(W.time + off, 'idle', dt); return true; };
        W.fx.push(o);
      }
    });

    // Enemy camps
    (Z.groups || []).forEach(function (g) {
      var grp = { def: g, home: [g.pos[0], g.pos[1]], x: g.pos[0], z: g.pos[1], tx: g.pos[0], tz: g.pos[1],
        models: [], tags: [], state: 'alive', respawnAt: 0, cooldown: 0, wait: rng() * 3, rot: rng() * Math.PI * 2,
        boss: g.enemies.some(function (e) { return WF.data.enemies[e] && WF.data.enemies[e].boss; }),
        elite: g.enemies.some(function (e) { return WF.data.enemies[e] && WF.data.enemies[e].elite; }) };
      var n = g.enemies.length;
      g.enemies.forEach(function (eid, i) {
        var e = WF.data.enemies[eid];
        if (!e) { console.warn('Missing enemy', eid); return; }
        var m = WF.models.enemy(e.model, { color: e.color, scale: e.scale || 1, elite: !!e.elite });
        var ox = n > 1 ? (i - (n - 1) / 2) * 1.9 : 0;
        m.userData.offset = [ox, n > 1 ? -Math.abs(ox) * 0.4 : 0];
        zoneRoot.add(m);
        // name plates: bosses orange, elites gold with a star + "Elite" line, mobs pink
        var tag = WF.models.textSprite((e.elite ? '★ ' : '') + e.name + '  Lv ' + e.level,
          { color: e.boss ? '#ffb347' : (e.elite ? '#ffd23f' : '#ffd0d0'), size: e.boss ? 0.85 : (e.elite ? 0.8 : 0.7), bold: !!(e.boss || e.elite) });
        tag.position.set(0, (m.userData.height || 2) + 0.3, 0);
        m.add(tag);
        if (e.elite) {
          var etag = WF.models.textSprite('Elite', { color: '#ffe9a0', size: 0.55, bold: true });
          etag.position.set(0, (m.userData.height || 2) + 0.02, 0);
          m.add(etag);
          grp.tags.push(etag);
        }
        m.userData.enemyId = eid;
        m.userData.tag = tag;
        grp.models.push(m); grp.tags.push(tag);
      });
      W.groups.push(grp);
      keep(g.pos[0], g.pos[1], (g.wander != null ? g.wander : 3) + 3);
    });

    // Pools (bogs, ponds): flat walkable discs; color may change once restored
    (Z.pools || []).forEach(function (pl) {
      var color = (W.zone.restoredFlags.pools && W.zone.restoredFlags.pools.color) || pl.color || '#3d5a3a';
      var disc = WF.models.pool ? WF.models.pool(pl.r, color) : new THREE.Mesh(new THREE.CircleGeometry(pl.r, 40), WF.models.toon(color));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(pl.pos[0], 0.035, pl.pos[1]);
      disc.receiveShadow = !WF.models.pool;
      zoneRoot.add(disc);
      keep(pl.pos[0], pl.pos[1], pl.r + 0.5);
    });

    // Hand-placed props (some are interactable, e.g. lanterns to relight)
    (Z.props || []).forEach(function (p, idx) {
      var color = p.color;
      var lit = false;
      var doneHere = false;
      if (p.interact) {
        doneHere = !!(WF.state.player && WF.state.isInteracted(zoneId, p.id || ('p' + idx)));
        lit = doneHere || W.zone.restoredFlags.lanterns === 'lit';
        if (lit && p.interact === 'relight') color = undefined;      // relit lantern glows normally
      } else if (p.type === 'lantern' && W.zone.restoredFlags.lanterns === 'lit' && isDark(p.color)) {
        color = undefined;
      }
      var m = addProp(p.type, p.pos[0], p.pos[1], p.rot || 0, p.scale || 1, color, rng, !!p.dynamic, p.label);
      if (m && p.dynamic) { m.userData.noBatch = true; m.userData.propId = p.id; }   // v1.2 WS4: animated by W.dungeon (star doors), which owns their collision
      if (m && p.interact) {
        W.interactables.push({ id: p.id || ('p' + idx), kind: p.interact, def: p, mesh: m, x: p.pos[0], z: p.pos[1], done: doneHere, lit: lit });
      }
      var r = m ? Math.max(m.userData.radius || 0, (m.userData.colliders || []).reduce(function (a, c) { return Math.max(a, Math.hypot(c.x, c.z) + c.r); }, 0)) * (p.scale || 1) : 1;
      keep(p.pos[0], p.pos[1], Math.max(1.5, r + 1));
    });

    // Scattered props (seeded so the zone looks the same every visit)
    var size = Z.size || 45;
    var paths = Z.paths || [];
    function blocked(x, z, r) {
      for (var i = 0; i < clear.length; i++) {
        if (Math.hypot(x - clear[i][0], z - clear[i][1]) < clear[i][2] + r) return true;
      }
      for (var p = 0; p < paths.length; p++) {
        var pl = paths[p];
        for (var s = 0; s < pl.length - 1; s++) {
          if (U.distToSegment(x, z, pl[s][0], pl[s][1], pl[s + 1][0], pl[s + 1][1]) < 2.8 + r) return true;
        }
      }
      for (var c = 0; c < W.colliders.length; c++) {
        var k = W.colliders[c];
        if (Math.hypot(x - k.x, z - k.z) < k.r + r + 0.4) return true;
      }
      return false;
    }
    var scatter = Z.scatter || {};
    Object.keys(scatter).forEach(function (type) {
      var count = scatter[type], tries = 0, placed = 0;
      while (placed < count && tries < count * 25) {
        tries++;
        var x = (rng() * 2 - 1) * (size + 6), z = (rng() * 2 - 1) * (size + 6);
        var big = /tree|rock_big/.test(type);
        if (blocked(x, z, big ? 1.4 : 0.6)) continue;
        addProp(type, x, z, rng() * Math.PI * 2, 0.8 + rng() * 0.45, null, rng);
        placed++;
      }
    });
    // Border of trees/rocks just outside the playable area (visual wall)
    var borderType = Z.borderType || (Z.style === 'ruins' ? 'tree_dead' : (Z.style === 'forest' ? 'tree_pine' : 'tree_round'));   // v1.2 WS6: zone.borderType (vault: crystal_cluster)
    for (var b = -size - 4; b <= size + 4; b += 4.5) {
      [[b, -size - 4], [b, size + 4], [-size - 4, b], [size + 4, b]].forEach(function (pt) {
        var nearPortal = W.portals.some(function (p) { return Math.hypot(pt[0] - p.def.pos[0], pt[1] - p.def.pos[1]) < 6; });
        if (nearPortal) return;
        addProp(rng() < 0.75 ? borderType : (Z.borderAlt || 'rock_big'), pt[0] + (rng() - 0.5) * 2, pt[1] + (rng() - 0.5) * 2, rng() * 6, 1 + rng() * 0.5, null, rng, true);
      });
    }

    // Fewer draw calls: merge static scenery that shares a material, per 24-unit cell
    try { mergeStaticProps(); } catch (e) { console.warn('prop merge skipped', e); }

    // Title-screen backdrop: no player yet
    if (!WF.state.player) { W.player = null; buildTagBlocks(); if (W.mode === 'title') W.setTagsVisible(false); return; }

    // Player avatar (built once per session; rebuilt when gear changes)
    if (!W.player) {
      dropMountMesh();
      W.player = { mesh: WF.models.wizard(WF.state.appearance()), x: 0, z: 0, rot: 0, moving: false };
      var ptag = WF.models.textSprite(WF.state.player.name, { color: '#ffffff', size: 0.62, bold: true });
      ptag.position.set(0, (W.player.mesh.userData.height || 2.1) + 0.38, 0);
      W.player.mesh.add(ptag);
      W.player.tag = ptag;
    }
    var pm = W.player.mesh;
    pm.scale.setScalar(1); pm.visible = true; pm.position.y = 0;
    if (pm.parent !== W.scene) { if (pm.parent) pm.parent.remove(pm); W.scene.add(pm); }
    rider.riding = false; rider.suspended = false;
    if (rider.mesh && rider.mesh.parent) rider.mesh.parent.remove(rider.mesh);
    var at = arrive || WF.state.player.pos || Z.spawn;
    W.player.x = at[0]; W.player.z = at[1];
    // never start inside a wall / outside the zone
    moveWithCollision(W.player, 0, 0);
    W.player.rot = arrive ? Math.atan2(-at[0], -at[1]) : (WF.state.player.rot || 0);
    pm.position.set(W.player.x, 0, W.player.z);
    pm.rotation.y = W.player.rot;
    W.cam.yaw = W.player.rot + Math.PI;
    portalCooldown = 1.5;

    WF.state.player.zone = zoneId;
    WF.state.player.pos = [W.player.x, W.player.z];
    syncMount(false);
    W.dungeon.setup(zoneId);           // v1.2 WS4: doors, walls, lights of a dungeon instance
    W.refreshMarkers();
    W.refreshPortals();
    buildTagBlocks();
    if (W.mode === 'title') W.setTagsVisible(false);
    snapCamera();
  };

  function isDark(hex) {
    if (!hex) return false;
    var c = new THREE.Color(hex);
    return (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) < 0.3;
  }

  function addProp(type, x, z, rot, scale, color, rng, noCollide, label) {
    var m;
    // v1.1: scenery outside the playable square (the tree/rock border ring) uses the lighter LOD build
    var half = (W.zone && W.zone.size) || 45, far = Math.abs(x) > half + 1 || Math.abs(z) > half + 1;
    try { m = WF.models.prop(type, { color: color, rng: rng, label: label, lod: far ? 1 : 0 }); }
    catch (e) { console.warn('prop failed', type, e); return null; }
    if (!m) return null;
    m.userData.type = type;
    // models.js does not scale props; the engine scales the root and the colliders
    var sc = scale || 1;
    m.scale.setScalar(sc);
    m.position.set(x, 0, z);
    m.rotation.y = rot;
    zoneRoot.add(m);
    m.userData.isProp = true;
    W.props.push(m);
    if (!noCollide) {
      var cr = Math.cos(rot), sr = Math.sin(rot);
      var cols = (m.userData.colliders && m.userData.colliders.length) ? m.userData.colliders
        : (m.userData.radius > 0 ? [{ x: 0, z: 0, r: m.userData.radius }] : []);
      cols.forEach(function (c) {
        var lx = c.x * sc, lz = c.z * sc;
        // local -> world for rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos
        W.colliders.push({ x: x + lx * cr + lz * sr, z: z - lx * sr + lz * cr, r: c.r * sc });
      });
    }
    if (m.userData.anim) W.fx.push(wrapAnim(m));
    return m;
  }
  // ------------------------------------------------------------------
  // Static prop batching (performance): props are built from shared geometry
  // with position/normal/color attributes; identical materials in the same
  // 24-unit cell are merged into one mesh. Duels can "explode" a batch so
  // individual props can be hidden from the camera, then restore it.
  // ------------------------------------------------------------------
  var CELL = 24, NO_SHADOW = { flower: 1, mushroom: 1, bones: 1 };
  // v1.1: the merge itself lives in models.js (WF.models.mergeMeshes / batchStatic) so the
  // props lab measures exactly what the game builds. Animated props (lanterns, fountain,
  // tower, banners, campfires...) now also fold their static meshes into the cell batch.
  function mergeMeshes(list) { return WF.models.mergeMeshes(list, null); }
  function mergeStaticProps() {
    zoneRoot.updateMatrixWorld(true);
    var skip = new Set(W.interactables.map(function (it) { return it.mesh; }));
    W.props.forEach(function (m) { if (m.userData.noBatch) skip.add(m); });   // v1.2 WS4: dungeon doors move
    WF.models.batchStatic(W.props, { cell: CELL, noShadow: NO_SHADOW, skip: skip, parent: zoneRoot })
      .forEach(function (mesh) { W.batches.push(mesh); });
  }
  // Duels: a batch that contains a hidden (occluding) prop is swapped for a re-merged copy of its
  // remaining members (one draw call instead of one per member); restore drops the copy.
  W.explodeBatches = function (hidden) {
    var h = new Set(hidden);
    W.batches.forEach(function (b) {
      var U = b.userData;
      if (!U.props.some(function (p) { return h.has(p); })) return;
      if (U.exploded) {
        // already split (duel start): rebuild only if this call hides MORE of its props (cinematic shots)
        var prev = U.hiddenSet || new Set(), grew = U.props.some(function (p) { return h.has(p) && !prev.has(p); });
        if (!grew || !WF.models.rebatch) return;
        prev.forEach(function (p) { h.add(p); });
        if (U.part) { if (U.part.parent) U.part.parent.remove(U.part); U.part.geometry.dispose(); U.part = null; }
      }
      b.visible = false; U.exploded = true;
      U.hiddenSet = new Set(U.props.filter(function (p) { return h.has(p); }));
      var part = null;
      try { part = WF.models.rebatch ? WF.models.rebatch(b, h, zoneRoot) : null; } catch (e) { part = null; }
      if (part) U.part = part;
      else if (!WF.models.rebatch) U.members.forEach(function (m) { m.visible = true; });
    });
  };
  W.restoreBatches = function () {
    W.batches.forEach(function (b) {
      if (!b.userData.exploded) return;
      if (b.userData.part) { if (b.userData.part.parent) b.userData.part.parent.remove(b.userData.part); b.userData.part.geometry.dispose(); b.userData.part = null; }
      else b.userData.members.forEach(function (m) { m.visible = false; });
      b.visible = true; b.userData.exploded = false; b.userData.hiddenSet = null;
    });
  };

  // props with idle animation (lanterns, crystals, campfires...)
  function wrapAnim(m) {
    var o = new THREE.Object3D();
    o.userData.update = function () { if (m.parent) m.userData.anim(W.time); return !!m.parent; };
    o.userData.persistent = true;
    return o;
  }

  // ------------------------------------------------------------------
  // Interaction (E): talk to the nearest NPC, or use an interactable prop
  // ------------------------------------------------------------------
  W.nearestInteractable = function (maxDist) {
    if (!WF.state.player) return null;
    var best = null, bd = maxDist;
    W.interactables.forEach(function (it) {
      if (it.done || !WF.state.wantsInteract(W.zoneId, it.kind)) return;
      var d = Math.hypot(W.player.x - it.x, W.player.z - it.z);
      if (d < bd) { bd = d; best = it; }
    });
    return best;
  };

  W.interact = function () {
    var npc = W.nearestNpc(3.6), obj = W.nearestInteractable(3.2);
    if (obj && (!npc || Math.hypot(W.player.x - obj.x, W.player.z - obj.z) < Math.hypot(W.player.x - npc.x, W.player.z - npc.z))) {
      useInteractable(obj); return;
    }
    if (npc) WF.ui.talkTo(npc.id);
  };

  function useInteractable(it) {
    var ups = WF.state.onInteract(W.zoneId, it.id, it.kind);
    it.done = true;
    if (it.kind === 'relight' && !it.lit) {
      // swap the snuffed lantern for a glowing one
      var old = it.mesh, p = it.def;
      var m = addProp(p.type, p.pos[0], p.pos[1], p.rot || 0, p.scale || 1, undefined, U.seeded(7), true, p.label);
      if (m) { it.mesh = m; if (old.parent) old.parent.remove(old); var oi = W.props.indexOf(old); if (oi >= 0) W.props.splice(oi, 1); dispose(old); }
      WF.sfx.play('wisp');
      var b = WF.models.burst('#ffd76a', 'buff');
      b.position.set(it.x, 0, it.z);
      W.addFx(b);
    }
    ups.forEach(function (u) { WF.ui.toast('<b>' + U.esc(WF.data.quests[u.qid].name) + '</b>: ' + U.esc(u.text), 'quest'); });
    W.refreshMarkers();
    WF.ui.refresh();
    WF.state.save();
  }

  // ------------------------------------------------------------------
  // Quest markers above NPCs, portal lock labels, name tags
  // ------------------------------------------------------------------
  W.refreshMarkers = function () {
    if (!WF.state.player) return;
    var S = WF.state, trainer = S.trainerId();
    W.npcs.forEach(function (n) {
      var kind = null;
      if (S.turnInsAt(n.id).length || S.talkTargetsAt(n.id).length) kind = '?';
      else if (S.offersAt(n.id).length) kind = '!';
      else if (n.id === trainer && S.player.pendingSpells.length) kind = '!';
      else if (S.pendingAt(n.id).length) kind = '?grey';
      if (kind === n.markerKind) return;
      if (n.marker) { n.mesh.remove(n.marker); dispose(n.marker); n.marker = null; }
      n.markerKind = kind;
      if (kind) {
        n.marker = WF.models.questMarker(kind);
        n.marker.position.set(0, (n.mesh.userData.height || 2.1) + 1.25, 0);
        n.mesh.add(n.marker);
      }
    });
  };

  W.refreshPortals = function () {
    W.portals.forEach(function (p) {
      if (p.lock) { p.lock.userData.off = WF.state.meets(p.def.requires); p.lock.visible = !p.lock.userData.off; }
    });
  };

  // Hide/show every world name tag (used during duels so they don't clutter the view)
  W.setTagsVisible = function (on) {
    tagsSnap = true;
    W.npcs.forEach(function (n) { n.tags.forEach(function (t) { t.visible = on; }); if (n.marker) n.marker.visible = on; });
    W.groups.forEach(function (g) { g.tags.forEach(function (t) { t.visible = on; }); });
    W.portals.forEach(function (p) { p.tags.forEach(function (t) { t.visible = on; }); });
    if (W.player && W.player.tag) W.player.tag.visible = on;
    if (on) W.refreshPortals();
  };

  // ------------------------------------------------------------------
  // Name plates (v1.1 polish B7/B8/B16). One pass per frame decides which world
  // text sprites (depthTest off, so they draw over everything) are shown:
  //  - all hidden while a panel / shop / backpack / dialogue / modal is open;
  //  - the player's own plate is hidden while exploring;
  //  - plates that would sit under a HUD panel (player frame, minimap, quest
  //    tracker, buttons, zone banner) are hidden;
  //  - far plates fade out; overlapping plates are decluttered, most important
  //    (quest NPCs > bosses > NPCs > elites > mobs > portals) and nearest first.
  // Plates fade through their own SpriteMaterial opacity.
  // ------------------------------------------------------------------
  var tagBlocks = [], tagsSnap = true, hudRects = [], hudT = 0;
  var _tw = new THREE.Vector3(), _ts = new THREE.Vector3(), _tv = new THREE.Vector3();
  function buildTagBlocks() {
    tagBlocks = [];
    W.npcs.forEach(function (n) { tagBlocks.push({ tags: n.tags, owner: n.mesh, npc: n, pri: 3 }); });
    W.groups.forEach(function (g) {
      g.models.forEach(function (m) {
        var ts = g.tags.filter(function (t) { return t.parent === m; });
        var e = WF.data.enemies[m.userData.enemyId] || {};
        if (ts.length) tagBlocks.push({ tags: ts, owner: m, group: g, pri: e.boss ? 3.5 : e.elite ? 2 : 1 });
      });
    });
    W.portals.forEach(function (p) { tagBlocks.push({ tags: p.tags, owner: p.mesh, pri: 0.5 }); });
    if (W.player && W.player.tag) tagBlocks.push({ tags: [W.player.tag], owner: null, player: true, pri: 0 });
    tagsSnap = true;
  }
  function refreshHudRects() {
    hudRects = [];
    var hud = document.getElementById('hud');
    if (!hud || hud.classList.contains('hidden')) return;
    function add(e, pad) {
      if (!e) return;
      var r = e.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) hudRects.push([r.left - pad, r.top - pad, r.right + pad, r.bottom + pad]);
    }
    ['hud-player', 'hud-map', 'hud-buttons', 'hud-potions'].forEach(function (id) { add(document.getElementById(id), 6); });
    var tr = document.getElementById('tracker');
    if (tr) for (var i = 0; i < tr.children.length; i++) add(tr.children[i], 8);
    var zb = document.getElementById('zone-banner');
    if (zb && zb.classList.contains('show') && parseFloat(getComputedStyle(zb).opacity) > 0.05) {
      var r = zb.getBoundingClientRect(), cx = (r.left + r.right) / 2;
      hudRects.push([cx - Math.min(360, r.width * 0.32), r.top - 6, cx + Math.min(360, r.width * 0.32), r.bottom + 6]);
    }
  }
  function overlapFrac(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])));
  }
  function ownerShown(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
  function updateTags(dt) {
    if (!tagBlocks.length) return;
    var ui = WF.ui, hideAll = W.mode !== 'explore' || !!(ui.blocking && ui.blocking());
    hudT -= dt;
    if (hudT <= 0 && !hideAll) { hudT = 0.2; refreshHudRects(); }
    var cam = W.camera, Hs = window.innerHeight, Ws = window.innerWidth;
    var fpx = Hs / (2 * Math.tan(cam.fov * Math.PI / 360));
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    var cands = [], i, j, b;
    for (i = 0; i < tagBlocks.length; i++) {
      b = tagBlocks[i];
      var want = !hideAll && !b.player && (!b.owner || ownerShown(b.owner)), rect = null, alpha = 1, dist = 0;
      if (want) {
        for (j = 0; j < b.tags.length; j++) {
          var t = b.tags[j];
          if (t.userData.off || !t.parent) continue;
          t.getWorldPosition(_tw); t.getWorldScale(_ts);
          var vz = -_tv.copy(_tw).applyMatrix4(cam.matrixWorldInverse).z;
          if (vz < 0.5) continue;
          _tw.project(cam);
          var sx = (_tw.x + 1) / 2 * Ws, sy = (-_tw.y + 1) / 2 * Hs;
          var hp = _ts.y * fpx / vz, wp = _ts.x * fpx / vz;
          var r = [sx - wp * 0.42, sy - hp * 0.8, sx + wp * 0.42, sy - hp * 0.2];   // the lettering, not the padded canvas
          rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r;
          dist = Math.max(dist, vz);
        }
        if (!rect || rect[2] < 0 || rect[0] > Ws || rect[3] < 0 || rect[1] > Hs) want = false;
        else {
          alpha = 1 - U.clamp((dist - 30) / 9, 0, 1);
          if (alpha <= 0.01) want = false;
          for (j = 0; want && j < hudRects.length; j++) if (overlapFrac(rect, hudRects[j]) > 0.02) want = false;
        }
      }
      cands.push({ b: b, want: want, rect: rect, alpha: alpha, dist: dist, pri: b.pri + (b.npc && b.npc.marker ? 1 : 0) });
    }
    if (!hideAll) {
      var order = cands.filter(function (c) { return c.want; }).sort(function (a, c) { return (c.pri - a.pri) || (a.dist - c.dist); });
      var placed = [];
      order.forEach(function (c) {
        for (var k = 0; k < placed.length; k++) if (overlapFrac(c.rect, placed[k]) > 0.18) { c.want = false; return; }
        placed.push(c.rect);
      });
    }
    var rate = Math.min(1, dt * 9);
    for (i = 0; i < cands.length; i++) {
      var c = cands[i], target = c.want ? c.alpha : 0;
      for (j = 0; j < c.b.tags.length; j++) {
        var tg = c.b.tags[j], m = tg.material;
        if (tg.userData.off) { tg.visible = false; continue; }
        var o = (hideAll || tagsSnap) ? target : m.opacity + (target - m.opacity) * rate;
        if (Math.abs(target - o) < 0.01) o = target;
        m.opacity = o;
        tg.visible = o > 0.02;
      }
    }
    tagsSnap = false;
  }

  // ------------------------------------------------------------------
  // Per-frame update
  // ------------------------------------------------------------------
  W.update = function (dt) {
    W.time += dt;
    frameNo++;
    for (var di = disposeQueue.length - 1; di >= 0; di--) {
      if (frameNo - disposeQueue[di].f > 1) { dispose(disposeQueue[di].o); disposeQueue.splice(di, 1); }
    }
    if (!W.player || !W.zone) return;
    if (W.mode !== 'combat') updateTags(dt);
    var P = W.player;
    var talkingTo = W.mode === 'dialog' && WF.ui.dialogNpc ? WF.ui.dialogNpc() : null;

    // NPC idle + markers
    for (var ni = 0; ni < W.npcs.length; ni++) {
      var n = W.npcs[ni];
      if (n.mesh.userData.anim) n.mesh.userData.anim(W.time + n.x, (talkingTo && talkingTo === n.id) ? 'talk' : 'idle', dt);
      if (n.marker && n.marker.userData.anim) n.marker.userData.anim(W.time);
      if (W.mode !== 'combat') {
        var dn = Math.hypot(P.x - n.x, P.z - n.z);
        var targetRot = dn < 6 ? Math.atan2(P.x - n.x, P.z - n.z) : n.face;
        n.mesh.rotation.y += U.angleDiff(n.mesh.rotation.y, targetRot) * Math.min(1, dt * 4);
      }
    }
    for (var pi = 0; pi < W.portals.length; pi++) { var po = W.portals[pi]; if (po.mesh.userData.anim) po.mesh.userData.anim(W.time); }

    // Effects (bursts, projectiles, animated props)
    for (var i = W.fx.length - 1; i >= 0; i--) {
      var f = W.fx[i], alive = true;
      try { alive = f.userData.update ? f.userData.update(dt) !== false : false; } catch (e) { alive = false; }
      if (!alive) { if (f.parent) f.parent.remove(f); if (!f.userData.persistent) dispose(f); W.fx.splice(i, 1); }
    }
    if (W.dungeon.active) W.dungeon.update(dt);     // v1.2 WS4: doors, light pool, reward chest

    if (W.mode === 'combat') return;  // combatView drives the camera & actors
    if (W._rebuildPending) W.rebuildPlayer();
    // back from a duel: climb back into the saddle
    if (rider.suspended && !(WF.combatView && WF.combatView.active)) { rider.suspended = false; syncMount(false); }

    // Player movement (frozen while a modal overlay like Level Up is showing)
    var moving = false, backing = false;
    var riding = isRiding();
    var modal = WF.ui.blocking && WF.ui.blocking();
    if (W.mode === 'explore' && !modal) {
      var k = W.keys, fwd = 0, side = 0;
      if (k.KeyW || k.ArrowUp) fwd += 1;
      if (k.KeyS || k.ArrowDown) fwd -= 1;
      // A/D (or arrows) turn, like Wizard101. Q/Z strafe.
      if (k.KeyA || k.ArrowLeft) W.cam.yaw += dt * 2.4;
      if (k.KeyD || k.ArrowRight) W.cam.yaw -= dt * 2.4;
      if (k.KeyQ) side -= 1;
      if (k.KeyZ) side += 1;
      if (mouse.down && mouse.buttons === 3) fwd = 1;   // both mouse buttons = run forward
      if (fwd || side) {
        moving = true;
        backing = fwd < 0 && !side;
        var yaw = W.cam.yaw + Math.PI;           // camera looks toward yaw+PI
        var fx = Math.sin(yaw), fz = Math.cos(yaw);
        var rx = Math.sin(yaw - Math.PI / 2), rz = Math.cos(yaw - Math.PI / 2);
        var mx = fx * fwd + rx * side, mz = fz * fwd + rz * side;
        var len = Math.hypot(mx, mz); mx /= len; mz /= len;
        // mounted speed = walk speed x (1 + mount speed) (contract §4.5); Shift runs faster
        var sp = PLAYER_SPEED * (1 + (riding ? WF.state.mountSpeed() : 0)) * (k.ShiftLeft || k.ShiftRight ? 1.35 : 1) * (backing ? 0.7 : 1) * dt;
        moveWithCollision(P, mx * sp, mz * sp);
        var want = Math.atan2(mx, mz);
        P.rot += U.angleDiff(P.rot, want) * Math.min(1, dt * 12);
      }
    }
    P.moving = moving;
    // ---- v2.0: jump (Space). Ground is y = 0 in every zone; the mesh is lifted, collisions are unchanged.
    var jy = 0, jtilt = 0;
    if (P.jumpV || P.jumpY) {
      P.jumpV = (P.jumpV || 0) - JUMP_GRAVITY * dt;
      P.jumpY = (P.jumpY || 0) + P.jumpV * dt;
      if (P.jumpY <= 0) {
        P.jumpY = 0; P.jumpV = 0;
        try { WF.sfx.play(riding ? 'hoof_step' : 'thud'); } catch (e) { /* silent */ }
        if (riding) hoofDust(P);
      }
      jy = P.jumpY;
      // mounts pitch nose-up on the way up and nose-down coming down
      if (riding) jtilt = Math.max(-0.28, Math.min(0.28, -(P.jumpV || 0) * 0.035));
    }
    // anim states (contract §4.3): run = normal movement, walk = backing up
    var gait = moving ? (backing ? 'walk' : 'run') : 'idle';
    if (riding && rider.mesh && P.mesh.parent !== W.scene) {
      rider.mesh.position.set(P.x, jy, P.z);
      rider.mesh.rotation.y = P.rot;
      rider.mesh.rotation.x = jtilt;
      if (P.mesh.rotation.y !== 0) P.mesh.rotation.y = 0;   // v2.1 A6: the rider always faces where the mount faces
      if (rider.mesh.userData.anim) rider.mesh.userData.anim(W.time, gait, dt);
      if (P.mesh.userData.anim) P.mesh.userData.anim(W.time, 'ride', dt);
    } else {
      P.mesh.position.set(P.x, jy, P.z);
      P.mesh.rotation.y = P.rot;
      if (P.mesh.userData.anim) P.mesh.userData.anim(W.time, gait, dt);
    }
    if (riding && moving) {
      rider.hoofT -= dt;
      if (rider.hoofT <= 0) { WF.sfx.play('hoof_step'); rider.hoofT = backing ? 0.46 : 0.27; if (!backing) hoofDust(P); }
    } else rider.hoofT = 0;
    var sp2 = WF.state.player.pos;
    if (sp2) { sp2[0] = P.x; sp2[1] = P.z; } else WF.state.player.pos = [P.x, P.z];
    WF.state.player.rot = P.rot;

    // Enemy camps
    var now = performance.now();
    for (var gi = 0; gi < W.groups.length; gi++) updateGroup(W.groups[gi], dt, now);
    if (W.mode === 'combat') return;   // a camp just started a duel

    // Wisps
    var pr = prog();
    for (var wi = 0; wi < W.wisps.length; wi++) {
      var w = W.wisps[wi];
      if (w.respawnAt) {
        if (now > w.respawnAt) { w.respawnAt = 0; w.mesh.visible = true; }
        continue;
      }
      if (w.mesh.userData.anim) w.mesh.userData.anim(W.time + w.x);
      if (W.mode === 'explore' && Math.hypot(P.x - w.x, P.z - w.z) < 1.6) {
        var s = WF.state.stats(), pl = WF.state.player, frac = pr.wispRestore != null ? pr.wispRestore : 0.3;
        pl.hp = Math.min(s.maxHp, pl.hp + Math.round(s.maxHp * frac));
        pl.mana = Math.min(s.maxMana, pl.mana + Math.max(3, Math.round(s.maxMana * frac)));
        w.mesh.visible = false; w.respawnAt = now + (pr.wispRespawn || 45) * 1000;
        WF.sfx.play('wisp');
        WF.ui.floatText('+Health +Mana', _v1.set(P.x, 2.6, P.z), '#9ff7ff');
      }
    }

    // Portals
    portalCooldown -= dt; msgCooldown -= dt;
    if (W.dungeon.portalTick) W.dungeon.portalTick(P.x, P.z);
    if (W.mode === 'explore' && portalCooldown <= 0 && !modal) {
      for (var qi = 0; qi < W.portals.length; qi++) {
        var p = W.portals[qi];
        if (Math.hypot(P.x - p.def.pos[0], P.z - p.def.pos[1]) >= 2.2) continue;
        if (WF.state.meets(p.def.requires)) {
          portalCooldown = 3;
          if (W.dungeon.offerModes(p.def)) break;               // v2.1 D16: Normal or Heroic, picked here, locked for the run
          WF.main.travel(p.def.to, p.def.arrive);
          break;
        } else if (msgCooldown <= 0) {
          msgCooldown = 3;
          WF.ui.toast(W.portalLockReason(p.def), 'warn');      // v1.2 WS4: names every missing requirement (quest, level; v2.1: dungeon)
          WF.sfx.play('error');
        }
      }
    }

    // Out-of-combat regeneration
    if (W.mode === 'explore' || W.mode === 'dialog' || W.mode === 'menu') {
      var st = WF.state.stats(), pl2 = WF.state.player;
      var mult = W.zone.safe ? pr.safeZoneRegenMult : 1;
      pl2.hp = Math.min(st.maxHp, pl2.hp + st.maxHp * pr.regenHP * mult * dt);
      pl2.mana = Math.min(st.maxMana, pl2.mana + st.maxMana * pr.regenMana * mult * dt);
    }

    // Interaction prompt
    if (W.mode === 'explore') {
      var near = W.nearestNpc(3.6), obj = W.nearestInteractable(3.2);
      if (obj && (!near || Math.hypot(P.x - obj.x, P.z - obj.z) < Math.hypot(P.x - near.x, P.z - near.z))) {
        WF.ui.prompt('Press <b>E</b> to ' + (obj.kind === 'relight' ? 'relight the lantern' : 'use'));
      } else WF.ui.prompt(near ? 'Press <b>E</b> to talk to ' + U.esc(near.data.name) : null);
    } else WF.ui.prompt(null);

    updateCamera(dt);
    updateDust(dt);
    sun.position.set(P.x + 22, 40, P.z + 14);
    sun.target.position.set(P.x, 0, P.z);
  };

  function moveWithCollision(P, dx, dz) {
    // a horse is wider than a wizard on foot (capped so narrow paths stay passable)
    var rad = (P === W.player && isRiding() && rider.mesh) ? Math.max(PLAYER_RADIUS, Math.min(0.9, (rider.mesh.userData.radius || 0.6) * 0.75)) : PLAYER_RADIUS;
    var size = (W.zone.size || 45) - 1;
    var nx = U.clamp(P.x + dx, -size, size), nz = U.clamp(P.z + dz, -size, size);
    for (var iter = 0; iter < 3; iter++) {
      for (var i = 0; i < W.colliders.length; i++) {
        var c = W.colliders[i];
        var ddx = nx - c.x, ddz = nz - c.z;
        var d = Math.hypot(ddx, ddz), min = c.r + rad;
        if (d < min) {
          if (d < 0.0001) { ddx = 1; ddz = 0; d = 1; }
          nx = c.x + ddx / d * min; nz = c.z + ddz / d * min;
        }
      }
    }
    P.x = U.clamp(nx, -size, size); P.z = U.clamp(nz, -size, size);
  }
  // Move the player respecting walls and bounds (used after duels/flee)
  W.nudgePlayer = function (dx, dz) { if (W.player && W.zone) moveWithCollision(W.player, dx || 0, dz || 0); };

  function updateGroup(g, dt, now) {
    if (g.state === 'dead') {
      if (now > g.respawnAt) {
        g.state = 'alive'; g.x = g.home[0]; g.z = g.home[1]; g.cooldown = now + 2000; g.culled = false;
        g.models.forEach(function (m) { m.visible = true; m.scale.setScalar(1); m.position.y = 0; });
      } else return;
    }
    if (g.state !== 'alive') return;
    var P = W.player;
    var dp = Math.hypot(P.x - g.x, P.z - g.z);
    // Far camps: hide the rig (saves ~15 draw calls each) with hysteresis and skip animating it
    // cull distance follows the zone's fog: thick fog (forests) hides camps sooner
    var cullD = W.zone.cullDistance || U.clamp((W.zone.fogNear || 30) + 0.45 * ((W.zone.fogFar || 110) - (W.zone.fogNear || 30)), 38, 56);
    var far = g.culled ? dp > cullD - 4 : dp > cullD;
    if (far !== !!g.culled) { g.culled = far; for (var ci = 0; ci < g.models.length; ci++) g.models[ci].visible = !far; }
    if (far) return;
    var showTag = dp < 30 && W.mode !== 'combat';
    for (var ti = 0; ti < g.tags.length; ti++) g.tags[ti].visible = showTag;
    var moving = false;
    if (W.mode === 'explore' || W.mode === 'dialog' || W.mode === 'menu') {
      g.wait -= dt;
      var dx = g.tx - g.x, dz = g.tz - g.z, d = Math.hypot(dx, dz);
      if (d > 0.3) {
        var sp = 1.6 * dt;
        g.x += dx / d * Math.min(sp, d); g.z += dz / d * Math.min(sp, d);
        g.rot += U.angleDiff(g.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 5);
        moving = true;
      } else if (g.wait <= 0) {
        var wr = g.def.wander != null ? g.def.wander : 3;
        var a = Math.random() * Math.PI * 2, r = Math.random() * wr;
        g.tx = g.home[0] + Math.cos(a) * r; g.tz = g.home[1] + Math.sin(a) * r;
        g.wait = 2 + Math.random() * 4;
      }
      if (dp < 8) g.rot += U.angleDiff(g.rot, Math.atan2(P.x - g.x, P.z - g.z)) * Math.min(1, dt * 6);
    }
    var cos = Math.cos(g.rot), sin = Math.sin(g.rot);
    for (var i = 0; i < g.models.length; i++) {
      var m = g.models[i], o = m.userData.offset || [0, 0];
      m.position.set(g.x + o[0] * cos + o[1] * sin, 0, g.z - o[0] * sin + o[1] * cos);
      m.rotation.y = g.rot;
      if (m.userData.anim) m.userData.anim(W.time + i * 0.7 + g.home[0], moving ? 'walk' : 'idle', dt);
    }
    // Aggro -> duel (only while exploring: never during dialogue, menus or travel)
    var pr = prog();
    var radius = g.boss ? (pr.bossAggroRadius || 4.6) : (pr.aggroRadius || 3.4);
    if (W.mode === 'explore' && now > g.cooldown && dp < radius && !(WF.ui.blocking && WF.ui.blocking())) {
      suspendMount();
      WF.combatView.start(g);
    }
  }

  // ------------------------------------------------------------------
  // Wizard rebuild on equip (contract §4.2) and mounts (contract §4.5)
  // ------------------------------------------------------------------
  W.rebuildPlayer = function () {
    if (!W.player || !WF.state.player) return;
    // the duel owns the avatar: rebuild as soon as the duel is over (e.g. "Equip" on the results screen)
    if (W.mode === 'combat' || (WF.combatView && WF.combatView.active)) { W._rebuildPending = true; return; }
    W._rebuildPending = false;
    var old = W.player.mesh, parent = old.parent, tag = W.player.tag, m;
    try { m = WF.models.wizard(WF.state.appearance()); } catch (e) { console.error('wizard rebuild failed', e); return; }
    if (tag) { old.remove(tag); m.add(tag); tag.position.set(0, (m.userData.height || 2.1) + 0.38, 0); }
    m.position.copy(old.position); m.rotation.copy(old.rotation); m.scale.copy(old.scale); m.visible = old.visible;
    if (parent) { parent.add(m); parent.remove(old); }
    W.player.mesh = m;
    disposeLater(old);
  };

  // Hoof dust (B9): a few soft puffs kicked up behind the mount while galloping. One Points
  // draw call reused for the whole session; tinted by the zone's path colour.
  var dust = null, DUST_N = 36;
  function dustTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c); return t;
  }
  function ensureDust() {
    if (dust) { if (dust.points.parent !== W.scene) W.scene.add(dust.points); return dust; }
    var geo = new THREE.BufferGeometry(), pos = new Float32Array(DUST_N * 3), al = new Float32Array(DUST_N), sz = new Float32Array(DUST_N);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(al, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: dustTex() }, color: { value: new THREE.Color('#c9b48a') }, scale: { value: 300 } },
      vertexShader: 'attribute float alpha; attribute float size; varying float vA; uniform float scale;\n' +
        'void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D tex; uniform vec3 color; varying float vA;\n' +
        'void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA); if (gl_FragColor.a < 0.01) discard; }',
      transparent: true, depthWrite: false
    });
    var pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'hoofDust';
    pts.userData.persistent = true; pts.userData.cached = true;
    dust = { points: pts, p: [], next: 0 };
    for (var i = 0; i < DUST_N; i++) dust.p.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, t: 1, life: 1, s: 0 });
    W.scene.add(pts);
    return dust;
  }
  function hoofDust(P) {
    if (W.zone && /forest|ruins/.test(W.zone.style || '') && Math.random() < 0.3) return;   // damp floors kick up less
    var d = ensureDust();
    d.points.material.uniforms.color.value.set((W.zone && W.zone.path) || '#c9b48a').lerp(new THREE.Color('#e8e0d0'), 0.35);
    var bx = -Math.sin(P.rot), bz = -Math.cos(P.rot);
    for (var k = 0; k < 3; k++) {
      var q = d.p[d.next]; d.next = (d.next + 1) % DUST_N;
      var side = (Math.random() - 0.5) * 0.9;
      q.x = P.x + bx * (0.6 + Math.random() * 0.5) + bz * side; q.z = P.z + bz * (0.6 + Math.random() * 0.5) - bx * side; q.y = 0.12;
      q.vx = bx * (0.6 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5; q.vz = bz * (0.6 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5; q.vy = 0.5 + Math.random() * 0.5;
      q.t = 0; q.life = 0.7 + Math.random() * 0.5; q.s = 0.35 + Math.random() * 0.25;
    }
  }
  function updateDust(dt) {
    if (!dust) return;
    var a = dust.points.geometry.attributes, pos = a.position.array, al = a.alpha.array, sz = a.size.array, live = false;
    for (var i = 0; i < DUST_N; i++) {
      var q = dust.p[i];
      if (q.t >= q.life) { al[i] = 0; continue; }
      live = true; q.t += dt;
      var k = Math.min(1, q.t / q.life);
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vx *= 0.94; q.vz *= 0.94; q.vy *= 0.9;
      pos[i * 3] = q.x; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z;
      al[i] = 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
      sz[i] = q.s * (1 + k * 1.8);
    }
    a.position.needsUpdate = true; a.alpha.needsUpdate = true; a.size.needsUpdate = true;
    dust.points.visible = live && W.mode !== 'combat';
    dust.points.material.uniforms.scale.value = window.innerHeight * 0.5;
  }

  // ---- v2.0: jump. On foot ~1.0 unit high, mounted ~1.6 (a proper horse leap). No double jumps.
  var JUMP_GRAVITY = 26, JUMP_V_FOOT = 7.2, JUMP_V_MOUNT = 9.0;
  W.jump = function () {
    var P = W.player;
    if (!P || W.mode !== 'explore' || P.jumpY > 0 || P.jumpV) return false;
    var mounted = isRiding();
    P.jumpV = mounted ? JUMP_V_MOUNT : JUMP_V_FOOT; P.jumpY = 0.0001;
    try { WF.sfx.play('whoosh'); if (mounted && Math.random() < 0.25) WF.sfx.play('whinny'); } catch (e) { /* silent */ }
    return true;
  };
  W.isAirborne = function () { var P = W.player; return !!(P && (P.jumpY > 0 || P.jumpV)); };
  function isRiding() { var p = WF.state.player; return !!(p && p.mounted && p.equipped.mount && !rider.suspended); }
  function seatOf(mesh) { return (mesh && mesh.userData.seat) || mesh; }
  function dropMountMesh() {
    if (!rider.mesh) return;
    var wiz = W.player && W.player.mesh;
    if (wiz && wiz.parent && wiz.parent !== W.scene && seatOf(rider.mesh) === wiz.parent) { wiz.parent.remove(wiz); W.scene.add(wiz); }
    if (rider.mesh.parent) rider.mesh.parent.remove(rider.mesh);
    disposeLater(rider.mesh);
    rider.mesh = null; rider.itemId = null;
  }
  function buildMount(itemId) {
    var it = WF.data.items[itemId];
    if (!it || !WF.models.mount) return null;
    var o = Object.assign({ rarity: it.rarity || 'common' }, it.mount || {});
    try { return WF.models.mount((it.mount && it.mount.kind) || 'horse', o); }
    catch (e) { console.warn('mount build failed', itemId, e); return null; }
  }
  function mountPuff(on) {
    if (!W.player) return;
    var it = WF.data.items[WF.state.player.equipped.mount || rider.itemId] || {};
    var col = (it.mount && (it.mount.gem || it.mount.mane)) || '#ffe9a0';
    try { var b = WF.models.burst(col, 'buff'); b.position.set(W.player.x, 0.2, W.player.z); W.addFx(b); } catch (e) { /* ignore */ }
    WF.sfx.play(on ? 'mount_summon' : 'mount_dismiss');
    if (on && it.mount && /horse|pony|nightmare|emberhoof/.test(it.mount.kind)) setTimeout(function () { WF.sfx.play('whinny'); }, 380);
  }
  // Make the scene match player.mounted / equipped.mount
  function syncMount(fx) {
    if (!W.player || !WF.state.player) return;
    var p = WF.state.player, wiz = W.player.mesh;
    var want = isRiding() && W.mode !== 'combat';
    if (rider.mesh && rider.itemId !== p.equipped.mount) dropMountMesh();
    var was = rider.riding;
    if (want) {
      if (!rider.mesh && WF.models.mount) { rider.mesh = buildMount(p.equipped.mount); rider.itemId = rider.mesh ? p.equipped.mount : null; }
      if (rider.mesh) {
        var seat = seatOf(rider.mesh);
        if (wiz.parent !== seat) { if (wiz.parent) wiz.parent.remove(wiz); seat.add(wiz); }
        wiz.position.set(0, 0, 0); wiz.rotation.set(0, 0, 0);
        if (rider.mesh.parent !== W.scene) W.scene.add(rider.mesh);
        rider.mesh.position.set(W.player.x, 0, W.player.z); rider.mesh.rotation.y = W.player.rot;
        rider.mesh.visible = true;
      }
      rider.riding = true;
    } else {
      if (wiz.parent !== W.scene) { if (wiz.parent) wiz.parent.remove(wiz); W.scene.add(wiz); }
      wiz.position.set(W.player.x, 0, W.player.z); wiz.rotation.set(0, W.player.rot, 0);
      if (rider.mesh && rider.mesh.parent) rider.mesh.parent.remove(rider.mesh);
      rider.riding = false;
    }
    if (fx && was !== rider.riding) mountPuff(rider.riding);
  }
  W.syncMount = syncMount;
  // Duels start on foot; W.update remounts once the duel is over
  function suspendMount() {
    if (!W.player || !isRiding()) return;
    rider.suspended = true;
    syncMount(false);
  }
  W.isRiding = function () { return rider.riding; };
  W.mountMesh = function () { return rider.mesh; };
  // R key / HUD button
  W.toggleMount = function () {
    var S = WF.state, p = S.player;
    if (!p || !W.player || (W.mode !== 'explore' && W.mode !== 'menu')) return false;
    if (!p.equipped.mount) {
      var own = S.ownedMounts().filter(function (id) { return S.canEquipMount(id); })
        .sort(function (a, b) { return (WF.data.items[b].speed || 0) - (WF.data.items[a].speed || 0); });
      if (!own.length) {
        WF.ui.toast(((WF.data.lore || {}).ui || {}).noMount || 'You have no mount yet.', 'warn');
        WF.sfx.play('error');
        return false;
      }
      S.equipMount(own[0]);
    }
    S.toggleMount();
    S.save();
    if (WF.ui.refresh) WF.ui.refresh();
    return p.mounted;
  };

  W.killGroup = function (g) {
    g.state = 'dead';
    g.respawnAt = performance.now() + (g.def.respawn || 30) * 1000;
    g.models.forEach(function (m) { m.visible = false; });
    if (W.dungeon.active) W.dungeon.onGroupDefeated(g);    // v1.2 WS4: no respawn inside; opens doors
  };

  W.nearestNpc = function (maxDist) {
    var best = null, bd = maxDist;
    W.npcs.forEach(function (n) {
      var d = Math.hypot(W.player.x - n.x, W.player.z - n.z);
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  };

  // ------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------
  // Follow camera. Mounted (B9): the camera rises and pulls back and aims a little ahead of
  // the rider so the horse's head and neck read past the wizard. Dialogue (B17): a 3/4
  // close-up on the NPC (over the player's shoulder); the follow camera eases back after.
  var camLook = new THREE.Vector3(), camLookInit = false, dlgK = 0, _dc = new THREE.Vector3(), _dl = new THREE.Vector3();
  function followSpot(outPos, outLook) {
    var c = W.cam, P = W.player, dist = c.dist + rider.camBack, pitch = c.pitch + rider.camLift * 0.05;
    var fx = Math.sin(P.rot) * rider.camFwd, fz = Math.cos(P.rot) * rider.camFwd;
    // mounted: view from a 3/4 angle behind (visual only; movement still follows c.yaw) so the
    // mount's head and neck show beside the rider instead of hiding behind the robe
    var yaw = c.yaw + rider.camSide;
    outLook.set(P.x + fx, 1.7 + rider.camLift, P.z + fz);
    outPos.set(outLook.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.max(0.6, outLook.y + Math.sin(pitch) * dist),
      outLook.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  }
  // 3/4 close-up: camera beside the player, a little behind his shoulder, framing the NPC's
  // head in the upper half of the screen (the dialogue box covers the lower third).
  function dialogSpot(n, outPos, outLook) {
    var P = W.player, h = n.mesh.userData.height || 2.1;
    var dx = P.x - n.x, dz = P.z - n.z, d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    var side = (dx * Math.cos(W.cam.yaw) - dz * Math.sin(W.cam.yaw)) >= 0 ? 1 : -1;   // stay on the camera's current side
    var a = 0.8 * side, ca = Math.cos(a), sa = Math.sin(a);
    var ox = dx * ca - dz * sa, oz = dx * sa + dz * ca;
    var back = Math.max(5.2, d + 3.0);
    // aim low so the NPC's face sits around 38 % of screen height, clear of the dialogue box
    outLook.set(n.x + dx * 0.5, h * 0.34, n.z + dz * 0.5);
    outPos.set(n.x + ox * back, h * 0.9 + 0.2, n.z + oz * back);
  }
  function placeCamera(t) {
    var talking = W.mode === 'dialog' && WF.ui.dialogNpc ? WF.ui.dialogNpc() : null, npc = null;
    if (talking) for (var i = 0; i < W.npcs.length; i++) if (W.npcs[i].id === talking) npc = W.npcs[i];
    var reduce = WF.state.player && WF.state.player.settings && WF.state.player.settings.reduceMotion;
    dlgK += ((npc ? 1 : 0) - dlgK) * Math.min(1, t * 0.6);
    if (t >= 1) dlgK = npc ? 1 : 0;
    followSpot(_v1, _v2);
    if (npc && dlgK > 0.001) {
      dialogSpot(npc, _dc, _dl);
      var k = reduce ? (npc ? 1 : 0) : dlgK * dlgK * (3 - 2 * dlgK);
      _v1.lerp(_dc, k); _v2.lerp(_dl, k);
    }
    if (!camLookInit || t >= 1) { camLook.copy(_v2); camLookInit = true; } else camLook.lerp(_v2, t);
    W.camera.position.lerp(_v1, t);
    W.camera.lookAt(camLook);
  }
  function snapCamera() { W.cam.dist = W.cam.targetDist; placeCamera(1); }
  function updateCamera(dt) {
    W.cam.dist += (W.cam.targetDist - W.cam.dist) * Math.min(1, dt * 6);
    var on = rider.riding && rider.mesh, ke = Math.min(1, dt * 4);
    rider.camLift += ((on ? 0.9 : 0) - rider.camLift) * ke;
    rider.camBack += ((on ? 1.5 : 0) - rider.camBack) * ke;
    rider.camFwd += ((on ? 0.9 : 0) - rider.camFwd) * ke;
    rider.camSide += ((on ? 0.55 : 0) - rider.camSide) * ke;
    if (W.dungeon.camera(dt, camLook)) { updateSeeThrough(); return; }   // v1.2 WS4: door-opening camera beat
    if (WF.story && WF.story.camera(dt, camLook)) { updateSeeThrough(); return; }   // v2.0 WS-E: story vignette beat (B3)
    placeCamera(Math.min(1, dt * 10));
    updateSeeThrough();
  }
  // Explore see-through (B8): tell the painted prop shader where the player is on screen so
  // trees / walls / rocks between the camera and the player stipple away (models.js seeThrough).
  var _st = new THREE.Vector3();
  function updateSeeThrough() {
    var u = WF.models.seeThrough; if (!u) return;
    if (!W.player || W.mode === 'combat' || W.mode === 'title') { u.value.w = 0; return; }
    var cam = W.camera, riding = rider.riding && rider.mesh;
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _st.set(W.player.x, riding ? 1.7 : 1.05, W.player.z).applyMatrix4(cam.matrixWorldInverse);
    var depth = -_st.z;
    if (depth < 0.5) { u.value.w = 0; return; }
    _st.set(W.player.x, riding ? 1.7 : 1.05, W.player.z).project(cam);
    var tanH = Math.tan(cam.fov * Math.PI / 360);
    u.value.set(_st.x * cam.aspect, _st.y, (riding ? 2.1 : 1.45) / (depth * tanH), depth);
  }
  W.snapCamera = function () { if (W.player) { W.cam.yaw = W.player.rot + Math.PI; snapCamera(); } };

  // ------------------------------------------------------------------
  // Clicking NPCs
  // ------------------------------------------------------------------
  function onClick(e) {
    if (W.mode !== 'explore') return;
    var rect = W.renderer.domElement.getBoundingClientRect();
    var v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(v, W.camera);
    var hits = raycaster.intersectObjects(W.npcs.map(function (n) { return n.mesh; }), true);
    if (!hits.length) return;
    var obj = hits[0].object;
    var npc = W.npcs.find(function (n) { var o = obj; while (o) { if (o === n.mesh) return true; o = o.parent; } return false; });
    if (!npc) return;
    if (Math.hypot(W.player.x - npc.x, W.player.z - npc.z) < 7) WF.ui.talkTo(npc.id);
    else WF.ui.toast('Walk closer to talk to ' + U.esc(npc.data.name) + '.');
  }

  // ------------------------------------------------------------------
  // Helpers for UI / combat
  // ------------------------------------------------------------------
  var _sp = { x: 0, y: 0, visible: false };
  W.toScreen = function (v3, out) {
    out = out || _sp;
    _v3.copy(v3).project(W.camera);
    out.x = (_v3.x + 1) / 2 * window.innerWidth;
    out.y = (-_v3.y + 1) / 2 * window.innerHeight;
    out.visible = _v3.z < 1 && _v3.z > -1;
    return out;
  };

  W.addFx = function (obj) { W.scene.add(obj); W.fx.push(obj); return obj; };

  W.render = function () {
    if (WF.gfx && WF.gfx.ready) WF.gfx.render(W.scene, W.camera);
    else W.renderer.render(W.scene, W.camera);
    if (pendingDispose) { dispose(pendingDispose); pendingDispose = null; }
  };

  // Minimap: north-up relative to the camera (forward = up)
  W.drawMinimap = function (canvas) {
    if (!W.zone || !W.player) return;
    var ctx = canvas.getContext('2d'), Wd = canvas.width, H = canvas.height;
    var size = W.zone.size || 45, range = 34;
    var s = Wd / (range * 2);
    ctx.clearRect(0, 0, Wd, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(Wd / 2, H / 2, Wd / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = W.zone.ground || '#5c8a4a'; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, Wd, H); ctx.globalAlpha = 1;
    ctx.translate(Wd / 2, H / 2);
    // Camera forward is -(sin yaw, cos yaw); rotating by yaw maps it to screen-up
    ctx.rotate(W.cam.yaw);
    function px(x) { return (x - W.player.x) * s; }
    function pz(z) { return (z - W.player.z) * s; }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(px(-size), pz(-size), size * 2 * s, size * 2 * s);
    if (W.dungeon.active) W.dungeon.drawMinimap(ctx, px, pz, s);     // v1.2 WS4: rooms, walls, star doors
    ctx.strokeStyle = W.zone.path || '#c9b48a'; ctx.lineWidth = 3.2 * s; ctx.lineCap = 'round';
    (W.zone.paths || []).forEach(function (pl) {
      ctx.beginPath();
      pl.forEach(function (pt, i) { if (i) ctx.lineTo(px(pt[0]), pz(pt[1])); else ctx.moveTo(px(pt[0]), pz(pt[1])); });
      ctx.stroke();
    });
    function dot(x, z, r, col, stroke) {
      ctx.beginPath(); ctx.arc(px(x), pz(z), r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    W.portals.forEach(function (p) { dot(p.def.pos[0], p.def.pos[1], 5, WF.state.meets(p.def.requires) ? '#6fe0ff' : '#777', '#fff'); });
    W.wisps.forEach(function (w) { if (!w.respawnAt) dot(w.x, w.z, 2.5, '#c9fbff'); });
    W.interactables.forEach(function (it) { if (!it.done && WF.state.wantsInteract(W.zoneId, it.kind)) dot(it.x, it.z, 3.5, '#ffd76a', '#5a3d00'); });
    // monsters you still need for a quest get a gold ring
    var need = {};
    WF.state.activeQuestIds().forEach(function (qid) {
      WF.data.quests[qid].objectives.forEach(function (o, i) {
        if (o.type === 'kill' && !WF.state.objectiveProgress(qid, i).done) need[o.enemy] = 1;
      });
    });
    W.groups.forEach(function (g) {
      if (g.state !== 'alive') return;
      var q = g.def.enemies.some(function (e) { return need[e]; });
      dot(g.x, g.z, g.boss ? 5 : (g.elite ? 4.4 : (q ? 4 : 3.2)), g.boss ? '#ff8c1a' : (g.elite ? '#ffcc33' : '#e23b3b'), q ? '#ffd23f' : (g.elite ? '#5a2a00' : '#300'));
    });
    W.npcs.forEach(function (n) {
      if (n.markerKind === '?') {            // turn-in: gold ring
        ctx.beginPath(); ctx.arc(px(n.x), pz(n.z), 4.6, 0, Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
        return;
      }
      var c = n.markerKind === '!' ? '#ffd23f' : '#ffffff';
      dot(n.x, n.z, n.markerKind === '!' ? 4.2 : 3, c, '#333');
    });
    ctx.restore();
    // Player arrow (centre). Facing in screen space = player rot relative to camera.
    ctx.save();
    ctx.translate(Wd / 2, H / 2);
    ctx.rotate(W.cam.yaw - W.player.rot + Math.PI);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  };

  // ---- v1.2 WS4: portal lock reasons -----------------------------------------------------
  // Names every requirement still missing (quest AND level), plus the portal's own lockText.
  W.portalLockReason = function (def) {
    var req = (def && def.requires) || {}, p = WF.state.player, ui = (WF.data.lore || {}).ui || {};
    var parts = [def.lockText || 'The way is sealed by Lumen magic.'];
    var q = req.quest && WF.data.quests[req.quest];
    if (q && p && !p.quests.done[req.quest]) parts.push((ui.portalNeedsQuest || 'Complete "{quest}" first.').replace('{quest}', q.name));
    if (req.level && p && p.level < req.level) parts.push((ui.portalNeedsLevel || 'Reach level {level} first.').replace('{level}', req.level));
    // v2.1: the world-exit gate (requires.dungeon): every dungeon still to be cleared once
    if (req.dungeon && p && WF.state.missingDungeons) WF.state.missingDungeons(req).forEach(function (id) {
      var dg = (WF.data.dungeons || {})[id];
      parts.push((ui.portalNeedsDungeon || 'Clear {dungeon} once first.').replace('{dungeon}', dg ? dg.name : id));
    });
    return U.esc(U.fillText(parts.join(' ')));
  };

  // =====================================================================
  // ---- v1.2 WS4: dungeon instances (W.dungeon) -------------------------------------------
  // A zone with `dungeon: '<id>'` (game/data/dungeons.js, e.g. The Hollow Orrery) runs as an
  // INSTANCE. Hooks: loadZone (prepare/arrival at the top, setup at the end), W.update
  // (update), updateCamera (camera), W.killGroup (onGroupDefeated), drawMinimap.
  //  * every entry resets it: all groups alive, every star door sealed, you start in the
  //    entry hall (also when a save is resumed inside). Nothing about it is saved.
  //  * groups never respawn inside. A room boss queues its door; the final boss queues the
  //    exit portal and the reward chest. Each runs as a short camera beat (W.mode
  //    'cutscene', ~3 s) once the duel and its results screen are gone.
  //  * an unbroken line of invisible colliders follows every wall (def.walls), and each
  //    sealed door has its own barrier, so the rooms hold whatever the art looks like.
  //  * a small pool of point lights follows the player through the nearest light sources
  //    (zone props with `light`). A fixed pool keeps the shader variants stable.
  //  * a boss group may name a `fallback` composition for engines without summon support
  //    (the Archon's keepers stand beside it from the start instead of arriving at 50 %).
  // =====================================================================
  W.dungeon = (function () {
    var DG = { active: false, id: null, def: null, zoneId: null };
    var st = null;                                    // this visit's instance state
    var LIGHT_Y = { brazier: 1.9, crystal_cluster: 1.4, orrery: 4.6 };
    var _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

    function defOf(zoneId) {
      var z = WF.data.zones[zoneId], D = WF.data.dungeons || {};
      return z && z.dungeon && D[z.dungeon] ? D[z.dungeon] : null;
    }
    function lines() { var L = (WF.data.lore || {}).dungeonLines || {}; return (DG.id && L[DG.id]) || {}; }
    function say(text, type) { if (text) WF.ui.toast('<i>' + U.esc(U.fillText(text)) + '</i>', type || 'lore'); }
    function ease(k) { k = U.clamp(k, 0, 1); return k * k * (3 - 2 * k); }
    function reduceMotion() { var p = WF.state.player; return !!(p && p.settings && p.settings.reduceMotion); }
    // circles every `step` along a..b (pushed into W.colliders; returned so a door can drop them)
    function lineColliders(a, b, r, step, tag) {
      var L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)), out = [];
      for (var i = 0; i <= n; i++) {
        var c = { x: a[0] + (b[0] - a[0]) * i / n, z: a[1] + (b[1] - a[1]) * i / n, r: r };
        if (tag) Object.keys(tag).forEach(function (k) { c[k] = tag[k]; });
        W.colliders.push(c); out.push(c);
      }
      return out;
    }

    DG.isDungeon = function (zoneId) { return !!defOf(zoneId); };
    // Summons need the rules engine (WS2) AND the duel view (WS1) to support them.
    DG.supportsSummon = function () {
      return !!(WF.Battle && WF.Battle.features && WF.Battle.features.summon &&
        WF.combatView && WF.combatView.features && WF.combatView.features.summon);
    };

    // top of loadZone: forget the old instance; pick this engine's boss groups
    DG.prepare = function (zoneId, Z) {
      DG.leave();
      if (!defOf(zoneId)) return Z;
      var summon = DG.supportsSummon();
      Z.groups = (Z.groups || []).map(function (g) {
        if (g.fallback && g.fallback.unless === 'summon' && !summon) return Object.assign({}, g, { enemies: g.fallback.enemies.slice() });
        return g;
      });
      return Z;
    };
    // every visit starts in the entry hall, even when a save is resumed inside
    DG.arrival = function (zoneId, arrive) {
      if (!defOf(zoneId) || arrive) return arrive;
      return WF.data.zones[zoneId].spawn.slice();
    };

    // ---- v2.1 D16 Heroic (dungeons.js <id>.heroic). Chosen at the entrance portal, locked for the run:
    //  DG.pendingMode is consumed when the dungeon loads (DG.setup); DG.mode() is the run's mode or null.
    //  In a realm the HOST's mode is used for party duels (realmUI passes it with startDuel).
    DG.pendingMode = null;
    function dungeonOfZone(zoneId) { var ds = WF.data.dungeons || {}; for (var k in ds) if (ds[k].zone === zoneId) return ds[k]; return null; }
    function modeOf(dg) {
      var H = dg && dg.heroic;
      if (!H) return null;
      var r = H.rewards || {};
      return { id: 'heroic', name: H.name || 'Heroic', enemyMods: { hp: H.enemyHp || 1, dmg: H.enemyDmg || 1 }, gearMult: r.gearMult || 1, chest: r.chest || {} };
    }
    DG.modeFor = function (dungeonId) { return modeOf((WF.data.dungeons || {})[dungeonId]); };
    DG.mode = function () {
      // a realm guest in the host's dungeon plays the HOST's run mode (party duels, solo fights, chest)
      var hm = WF.net && WF.net.hostRunMode ? WF.net.hostRunMode(DG.zoneId) : undefined;
      if (hm !== undefined) return hm ? DG.modeFor(DG.id) : null;
      return st && st.mode ? st.mode : null;
    };
    var offerAt = null;   // the portal whose choice box was closed without a choice: not again until you step off it
    DG.offerModes = function (portalDef) {
      var dg = dungeonOfZone(portalDef.to), H = dg && dg.heroic;
      if (!H || !WF.ui || !WF.ui.choice) return false;
      if (offerAt && offerAt.id === portalDef.id && offerAt.to === portalDef.to) return true;            // closed with Esc: step off the portal to be asked again
      if (WF.net && WF.net.hostRunMode && WF.net.hostRunMode(portalDef.to) !== undefined) return false;   // a realm guest follows the host's mode
      var chosen = false;
      var go = function (heroic) { chosen = true; offerAt = null; DG.pendingMode = heroic ? 'heroic' : null; portalCooldown = 3; WF.main.travel(portalDef.to, portalDef.arrive); };
      WF.ui.onChoiceClosed = function () { WF.ui.onChoiceClosed = null; if (!chosen) offerAt = portalDef; };
      return WF.ui.choice({
        name: dg.name || 'Dungeon', title: 'Choose your challenge', text: H.entry || '',
        extraHTML: '<div class="dlg-mode"><b>Normal</b>: the Orrery as it is.<br><b>' + U.esc(H.name || 'Heroic') + '</b>: ' + U.esc(H.desc || '') + '</div>',
        buttons: [{ label: 'Enter (Normal)', primary: true, action: function () { go(false); } },
                  { label: 'Enter ' + (H.name || 'Heroic'), action: function () { go(true); } }]
      });
    };

    // called every frame by the portal loop: once you step off a declined portal it may ask again
    DG.portalTick = function (px, pz) { if (offerAt && Math.hypot(px - offerAt.pos[0], pz - offerAt.pos[1]) >= 2.6) offerAt = null; };
    DG.leave = function () {
      if (st && st.beat && W.mode === 'cutscene') W.mode = 'explore';
      st = null;
      DG.active = false; DG.id = null; DG.def = null; DG.zoneId = null;
    };

    // end of loadZone (player placed): seal the doors, wall colliders, lights
    DG.setup = function (zoneId) {
      var def = defOf(zoneId);
      if (!def || !W.player) { DG.pendingMode = null; DG.leave(); return; }   // review m2: a choice never waits for a later entry
      var Z = W.zone;
      DG.active = true; DG.id = Z.dungeon; DG.def = def; DG.zoneId = zoneId;
      st = { doors: [], queue: [], beat: null, cleared: false, exit: null, chest: null, lights: [], sources: [], want: [],
        lightT: 0, lastMode: null, sayAt: W.time + 2.6, defeated: {}, exitKills: exitKills(def),
        mode: DG.pendingMode === 'heroic' ? modeOf(def) : null };
      DG.pendingMode = null;
      if (st.mode && WF.ui) WF.ui.toast('<b>' + U.esc(st.mode.name) + '</b>: the guardians are stronger, and so is their loot.', 'warn', 4200);
      W.groups.forEach(function (g) { g.instance = true; });
      (def.walls || []).forEach(function (w) { lineColliders(w.a, w.b, 0.55, 0.7, { wall: true }); });
      (def.doors || []).forEach(function (d) {
        var mesh = null;
        W.props.forEach(function (m) { if (m.userData.propId === d.id) mesh = m; });
        if (mesh && mesh.userData.setOpen) { try { mesh.userData.setOpen(false, true); } catch (e) { /* art optional */ } }
        var c = Math.cos(d.rot || 0), s = Math.sin(d.rot || 0), h = (d.width || 6) / 2 + 0.3;
        var cols = lineColliders([d.pos[0] - c * h, d.pos[1] + s * h], [d.pos[0] + c * h, d.pos[1] - s * h], 0.6, 0.6, { door: d.id });
        // the door art's own colliders (WS6 star_door: side pillars + `doorColliders` for the leaf).
        // Dynamic props get none from addProp, so add them here: the pillars stay, the leaf
        // colliders join the barrier and leave with it when the door opens (re-entry rebuilds all).
        if (mesh && mesh.userData.colliders && mesh.userData.colliders.length) {
          var leaf = mesh.userData.doorColliders || [], sc = mesh.scale.x || 1, cr = Math.cos(mesh.rotation.y), sr = Math.sin(mesh.rotation.y);
          mesh.userData.colliders.forEach(function (lc) {
            var lx = lc.x * sc, lz = lc.z * sc;
            var wc = { x: mesh.position.x + lx * cr + lz * sr, z: mesh.position.z - lx * sr + lz * cr, r: lc.r * sc, door: d.id };
            W.colliders.push(wc);
            if (leaf.indexOf(lc) >= 0) cols.push(wc); else wc.doorFrame = true;
          });
        }
        st.doors.push({ def: d, mesh: mesh, open: false, queued: false, cols: cols, sink: null });
      });
      // point-light pool (2 on the low tier)
      var LD = def.lights || {}, n = LD.pool || 4;
      if (W.quality === 'low') n = Math.min(n, 2);
      (Z.props || []).forEach(function (p) {
        if (p.light) st.sources.push({ x: p.pos[0], z: p.pos[1], y: LIGHT_Y[p.type] || 1.8, color: new THREE.Color(p.light),
          flicker: p.type === 'brazier', big: p.type === 'orrery', ph: p.pos[0] * 1.37 + p.pos[1] * 0.71 });
      });
      for (var i = 0; i < n && st.sources.length; i++) {
        var L = new THREE.PointLight(0xffffff, 0, LD.range || 15, 2);
        L.castShadow = false; L.position.set(0, -50, 0); L.name = 'dungeonLight';
        zoneRoot.add(L);
        st.lights.push({ light: L, src: null, k: 0 });
      }
      if (def.spawnFace != null && W.player && Math.hypot(W.player.x - Z.spawn[0], W.player.z - Z.spawn[1]) < 0.5) {
        // v2.1 A6: set the FACING only. A mounted wizard sits on the saddle (a child of the mount), so
        // rotating its mesh here turned the rider 180 deg on the mount (Jorge: entering the Orrery from
        // the Ashen Ruins). The mount / the wizard on foot take W.player.rot every frame.
        W.player.rot = def.spawnFace; W.cam.yaw = def.spawnFace + Math.PI;
        if (W.player.mesh.parent === W.scene) W.player.mesh.rotation.y = def.spawnFace;
        if (rider.mesh && rider.riding) rider.mesh.rotation.y = def.spawnFace;
      }
    };

    // ------------------------------------------------------------------ events
    function exitKills(def) {
      var p = WF.state.player, ex = def && def.exit;
      return ex && p && p.stats && p.stats.kills ? (p.stats.kills[ex.after] || 0) : 0;
    }
    DG.onGroupDefeated = function (g) {
      if (!st) return;
      g.respawnAt = Infinity;                          // instances never respawn
      var ids = g.def.enemies || [];
      ids.forEach(function (id) { st.defeated[id] = true; });
      st.doors.forEach(function (d) {
        if (!d.open && !d.queued && d.def.opens === 'after' && ids.indexOf(d.def.after) >= 0) { d.queued = true; st.queue.push({ kind: 'door', door: d, pos: d.def.pos }); }
      });
      var ex = DG.def.exit;
      if (!st.cleared && ex && ids.indexOf(ex.after) >= 0) {
        st.cleared = true; st.queue.push({ kind: 'clear', pos: ex.pos });
        // v2.1: the final boss fell -> a full clear for this wizard (the progression gate, requires.dungeon),
        // but only if THIS wizard won that duel (its kill count rose since entering; both win paths count the
        // kill before killGroup). A realm guest who sat the fight out, or came in after the host won, gets none.
        if (exitKills(DG.def) > st.exitKills) {
          try { var n = WF.state.recordDungeonClear(DG.id); st.clears = n; WF.state.save(); } catch (e) { console.warn(e); }
        }
      }
    };

    function openDoor(d) {
      if (d.open) return;
      d.open = true;
      var gone = new Set(d.cols);
      W.colliders = W.colliders.filter(function (c) { return !gone.has(c); });
      var m = d.mesh;
      if (m && m.userData.setOpen) { try { m.userData.setOpen(true); } catch (e) { d.sink = { t: 0 }; } }
      else if (m) d.sink = { t: 0 };                   // no door art yet: sink the stand-in into the floor
      WF.sfx.play('rumble_big');
      setTimeout(function () { WF.sfx.play('chime_moon'); }, 420);
      if (WF.gfx && WF.gfx.shake && !reduceMotion()) WF.gfx.shake(0.18, 0.7);
      try { var b = WF.models.burst('#ffd76a', 'buff'); b.position.set(d.def.pos[0], 0.2, d.def.pos[1]); W.addFx(b); } catch (e) { /* cosmetic */ }
      say((lines().doors || {})[d.def.id]);
    }

    function clearInstance() {
      var ex = DG.def.exit, ch = DG.def.chest;
      if (ex) {
        var pm = WF.models.portal(ex.color || '#ffd76a');
        pm.position.set(ex.pos[0], 0, ex.pos[1]);
        pm.rotation.y = Math.atan2(-ex.pos[0], -ex.pos[1]);
        pm.scale.setScalar(0.01);
        zoneRoot.add(pm);
        var label = WF.models.textSprite(ex.label || 'Exit', { color: '#e6fbff', size: 0.9, bold: true });
        label.position.set(0, 5.2, 0); pm.add(label);
        var pdef = { id: ex.id, to: ex.to, pos: ex.pos, arrive: ex.arrive, label: ex.label, color: ex.color, requires: null };
        W.portals.push({ def: pdef, mesh: pm, lock: null, tags: [label] });
        st.exit = { mesh: pm, t: 0 };
        buildTagBlocks();
      }
      if (ch) {
        var type = ch.prop || 'reward_chest', cm = null;
        try { cm = WF.models.prop(type, { color: '#ffd76a' }); } catch (e) { cm = null; }
        if (!cm || cm.userData.type !== type) {          // no chest art yet: a gold star-crystal stands in
          if (cm) dispose(cm);
          cm = WF.models.prop('crystal', { color: '#ffd76a' }); cm.scale.setScalar(1.3); cm.userData.fallback = true;
        }
        cm.position.set(ch.pos[0], 0, ch.pos[1]); cm.rotation.y = ch.rot || 0;
        zoneRoot.add(cm);
        if (cm.userData.setOpen) { try { cm.userData.setOpen(false, true); } catch (e) { /* art optional */ } }
        if (cm.userData.anim) W.fx.push(wrapAnim(cm));
        var col = { x: ch.pos[0], z: ch.pos[1], r: 0.7, chest: true };
        W.colliders.push(col);
        st.chest = { def: ch, mesh: cm, opened: false, col: col };
        try { var b2 = WF.models.burst('#ffd76a', 'heal'); b2.position.set(ch.pos[0], 0.2, ch.pos[1]); W.addFx(b2); } catch (e) { /* cosmetic */ }
      }
      WF.sfx.play('portal');
      setTimeout(function () { WF.sfx.play('quest_complete'); }, 500);
      say(lines().cleared, 'quest');
    }

    function openChest() {
      var c = st.chest, S = WF.state;
      c.opened = true;
      if (c.mesh.userData.setOpen) { try { c.mesh.userData.setOpen(true); } catch (e) { /* art optional */ } }
      else if (c.mesh.userData.fallback) c.mesh.visible = false;
      var g = c.def.gold || [0, 0], gold = g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1)), got = [];
      if (gold > 0) { S.addGold(gold); got.push(U.fmt ? U.fmt(gold) + ' gold' : gold + ' gold'); }
      Object.keys(c.def.items || {}).forEach(function (id) {
        var r = c.def.items[id], n = Array.isArray(r) ? r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)) : r;
        var it = WF.data.items[id];
        if (it && n > 0) { S.addItem(id, n); got.push(n + ' × ' + it.name); }
      });
      var hb = st.mode && st.mode.chest ? st.mode.chest : {};          // v2.1 D16: Heroic bonus
      Object.keys(hb).forEach(function (id) {
        var r = hb[id], n = Array.isArray(r) ? r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)) : r, it = WF.data.items[id];
        if (it && n > 0) { S.addItem(id, n); got.push(n + ' × ' + it.name + ' (' + st.mode.name + ')'); }
      });
      WF.sfx.play('gold');
      setTimeout(function () { WF.sfx.play('loot'); }, 260);
      try { var b = WF.models.burst('#ffd76a', 'buff'); b.position.set(c.def.pos[0], 0.4, c.def.pos[1]); W.addFx(b); } catch (e) { /* cosmetic */ }
      WF.ui.floatText('+' + gold + ' gold', _a.set(c.def.pos[0], 2.4, c.def.pos[1]), '#ffd76a', 1.2);
      WF.ui.toast('<b>' + U.esc((lines().chest || 'The reward chest opens.')) + '</b><br>' + U.esc(got.join(', ')), 'quest', 6000);
      S.save();
      WF.ui.refresh();
    }

    // ------------------------------------------------------------------ camera beats
    function startBeat(item) {
      var fx = item.pos[0], fz = item.pos[1], nx, nz;
      if (item.kind === 'door') {
        var r = item.door.def.rot || 0; nx = Math.sin(r); nz = Math.cos(r);
        if ((W.player.x - fx) * nx + (W.player.z - fz) * nz < 0) { nx = -nx; nz = -nz; }   // shoot from the player's side
      } else {
        var dx = W.player.x - fx, dz = W.player.z - fz, dl = Math.hypot(dx, dz) || 1; nx = dx / dl; nz = dz / dl;
      }
      var back = item.kind === 'door' ? 9.5 : 11, side = 2.6;
      st.beat = {
        item: item, t: 0, dur: item.kind === 'door' ? 3.3 : 3.8, fireAt: item.kind === 'door' ? 0.85 : 0.7, fired: false,
        fromPos: W.camera.position.clone(), fromLook: camLook.clone(),
        shotPos: new THREE.Vector3(fx + nx * back - nz * side, item.kind === 'door' ? 4.4 : 5.2, fz + nz * back + nx * side),
        shotLook: new THREE.Vector3(fx, item.kind === 'door' ? 2.3 : 2.6, fz)
      };
      if (W.mode === 'explore') W.mode = 'cutscene';
      WF.ui.prompt(null);
    }
    function runBeat(dt) {
      var b = st.beat;
      b.t += dt;
      if (!b.fired && b.t >= b.fireAt) {
        b.fired = true;
        if (b.item.kind === 'door') openDoor(b.item.door); else clearInstance();
      }
      if (b.t >= b.dur) {
        st.beat = null;
        if (W.mode === 'cutscene') W.mode = 'explore';
      }
    }
    // updateCamera hook: true = the beat drives the camera this frame
    DG.camera = function () {
      if (!st || !st.beat || reduceMotion()) return false;
      var b = st.beat, inT = 0.8, outT = 0.65, k;
      followSpot(_c, _d);                              // where the follow camera wants to be
      if (b.t < inT) { k = ease(b.t / inT); _a.copy(b.fromPos).lerp(b.shotPos, k); _b.copy(b.fromLook).lerp(b.shotLook, k); }
      else if (b.t < b.dur - outT) { _a.copy(b.shotPos); _b.copy(b.shotLook); }
      else { k = ease((b.t - (b.dur - outT)) / outT); _a.copy(b.shotPos).lerp(_c, k); _b.copy(b.shotLook).lerp(_d, k); }
      W.camera.position.copy(_a);
      camLook.copy(_b);
      W.camera.lookAt(camLook);
      return true;
    };

    // ------------------------------------------------------------------ light pool
    function updateLights(dt) {
      if (!st.lights.length) return;
      var px = W.player.x, pz = W.player.z;
      st.lightT -= dt;
      if (st.lightT <= 0) {
        st.lightT = 0.25;
        st.want = st.sources.slice().sort(function (a, b) {
          return Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz);
        }).slice(0, st.lights.length);
        st.want.forEach(function (src) {
          if (st.lights.some(function (s) { return s.src === src; })) return;
          var free = null;
          st.lights.forEach(function (s) { if (!free && (!s.src || (st.want.indexOf(s.src) < 0 && s.k < 0.02))) free = s; });
          if (free) { free.src = src; free.k = 0; free.light.color.copy(src.color); free.light.position.set(src.x, src.y, src.z); }
        });
      }
      var LD = DG.def.lights || {}, base = LD.intensity || 1.6, rate = dt / (LD.swap || 0.35);
      st.lights.forEach(function (s) {
        var on = !!s.src && st.want.indexOf(s.src) >= 0;
        s.k = U.clamp(s.k + (on ? rate : -rate), 0, 1);
        if (!s.src) { s.light.intensity = 0; return; }
        var f = s.src.flicker ? 0.87 + 0.08 * Math.sin(W.time * 9.3 + s.src.ph) + 0.05 * Math.sin(W.time * 23.1 + s.src.ph * 2) : 1;
        s.light.intensity = base * (s.src.big ? 1.6 : 1) * s.k * f;
      });
    }

    // ------------------------------------------------------------------ per frame
    DG.update = function (dt) {
      if (!st || !W.player) return;
      updateLights(dt);
      st.doors.forEach(function (d) {                  // stand-in doors sink into the floor
        if (!d.sink || !d.mesh) return;
        d.sink.t += dt;
        var k = ease(d.sink.t / 1.5);
        d.mesh.position.y = -k * 6.5 * (d.mesh.scale.y || 1);
        d.mesh.rotation.y = (d.def.rot || 0) + k * 0.35;
        if (k >= 1) { d.mesh.visible = false; d.sink = null; }
      });
      if (st.exit && st.exit.t < 1) { st.exit.t = Math.min(1, st.exit.t + dt / 1.2); st.exit.mesh.scale.setScalar(Math.max(0.01, ease(st.exit.t))); }
      var mode = W.mode;
      // the dungeon's music (sfx.js has no 'vault' style yet; travel and duels ask for zone.style)
      if (mode === 'explore' && (st.lastMode === null || st.lastMode === 'loading' || st.lastMode === 'combat') && DG.def.music) WF.sfx.music(DG.def.music);
      st.lastMode = mode;
      if (st.sayAt && W.time > st.sayAt && mode === 'explore') { st.sayAt = 0; say(lines().enter, 'info'); }
      if (st.beat) runBeat(dt);
      if (mode !== 'explore') return;
      var free = !(WF.combatView && WF.combatView.active) && !(WF.ui.blocking && WF.ui.blocking());
      st.doors.forEach(function (d) {
        if (d.open || d.queued || d.def.opens !== 'approach') return;
        if (Math.hypot(W.player.x - d.def.pos[0], W.player.z - d.def.pos[1]) < (d.def.radius || 5)) { d.queued = true; st.queue.push({ kind: 'door', door: d, pos: d.def.pos }); }
      });
      if (st.chest && !st.chest.opened && free && Math.hypot(W.player.x - st.chest.def.pos[0], W.player.z - st.chest.def.pos[1]) < 2.1) openChest();
      if (!st.beat && st.queue.length && free) {
        var item = st.queue.shift();
        if (reduceMotion()) { if (item.kind === 'door') openDoor(item.door); else clearInstance(); }
        else startBeat(item);
      }
    };

    // ------------------------------------------------------------------ minimap: rooms, walls, doors
    DG.drawMinimap = function (ctx, px, pz, s) {
      if (!st) return;
      ctx.save();
      ctx.fillStyle = 'rgba(205, 190, 255, 0.17)';
      (DG.def.rooms || []).forEach(function (r) {
        ctx.beginPath();
        r.poly.forEach(function (p, i) { if (i) ctx.lineTo(px(p[0]), pz(p[1])); else ctx.moveTo(px(p[0]), pz(p[1])); });
        ctx.closePath(); ctx.fill();
      });
      ctx.strokeStyle = 'rgba(16, 10, 30, 0.95)'; ctx.lineWidth = Math.max(2, 1.2 * s); ctx.lineCap = 'round';
      (DG.def.walls || []).forEach(function (w) { ctx.beginPath(); ctx.moveTo(px(w.a[0]), pz(w.a[1])); ctx.lineTo(px(w.b[0]), pz(w.b[1])); ctx.stroke(); });
      st.doors.forEach(function (d) {
        var c = Math.cos(d.def.rot || 0), sn = Math.sin(d.def.rot || 0), h = (d.def.width || 6) / 2;
        ctx.strokeStyle = d.open ? '#ffd76a' : '#b48cff'; ctx.lineWidth = Math.max(2.5, 1.4 * s);
        ctx.beginPath(); ctx.moveTo(px(d.def.pos[0] - c * h), pz(d.def.pos[1] + sn * h)); ctx.lineTo(px(d.def.pos[0] + c * h), pz(d.def.pos[1] - sn * h)); ctx.stroke();
      });
      if (st.chest && !st.chest.opened) {
        ctx.fillStyle = '#ffd76a'; ctx.strokeStyle = '#5a3d00'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(px(st.chest.def.pos[0]) - 3.5, pz(st.chest.def.pos[1]) - 3.5, 7, 7); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    };

    // ------------------------------------------------------------------ contract helpers (§2.6)
    // enter(id): travel into a dungeon (always a fresh instance); reset(): re-enter the current
    // one; onBossDefeated(enemyId): what killGroup does for a boss (queue its door / the exit);
    // openDoor(doorId): open one star door now (no beat); exit(): leave by the dungeon's exit.
    DG.enter = function (dungeonId) {
      var d = (WF.data.dungeons || {})[dungeonId || DG.id];
      return d && WF.main && WF.main.travel ? WF.main.travel(d.zone, null) : null;
    };
    DG.reset = function () { if (DG.active && st && st.mode) DG.pendingMode = st.mode.id; return DG.active ? DG.enter(DG.id) : null; };
    DG.onBossDefeated = function (enemyId) {
      if (!st) return;
      var g = W.groups.find(function (x) { return x.state !== 'dead' && (x.def.enemies || []).indexOf(enemyId) >= 0; });
      if (g) W.killGroup(g); else DG.onGroupDefeated({ def: { enemies: [enemyId] } });
    };
    DG.openDoor = function (doorId) {
      var d = st && st.doors.find(function (x) { return x.def.id === doorId; });
      if (d) { d.queued = true; st.queue = st.queue.filter(function (q) { return q.door !== d; }); openDoor(d); }
      return !!d;
    };
    DG.exit = function () {
      var ex = DG.def && DG.def.exit;
      return ex && WF.main && WF.main.travel ? WF.main.travel(ex.to, ex.arrive || null) : null;
    };

    // test / debug view of the instance
    DG.info = function () {
      if (!st) return { active: false };
      return {
        active: true, id: DG.id, zone: DG.zoneId, summon: DG.supportsSummon(), beat: st.beat ? st.beat.item.kind : null, beatT: st.beat ? st.beat.t : 0, queued: st.queue.length,
        doors: st.doors.map(function (d) { return { id: d.def.id, open: d.open, barrier: d.cols.some(function (c) { return W.colliders.indexOf(c) >= 0; }),
          frame: W.colliders.filter(function (c) { return c.doorFrame && c.door === d.def.id; }).length }; }),
        groups: W.groups.map(function (g) { return { id: g.def.id, enemies: g.def.enemies.slice(), state: g.state }; }),
        mode: st.mode ? st.mode.id : 'normal', cleared: st.cleared, clears: WF.state.dungeonClears ? WF.state.dungeonClears(DG.id) : 0, exit: !!st.exit, chest: st.chest ? (st.chest.opened ? 'opened' : 'closed') : null,
        lights: st.lights.length, sources: st.sources.length,
        walls: W.colliders.filter(function (c) { return c.wall; }).length
      };
    };
    return DG;
  })();

  return W;
})();
