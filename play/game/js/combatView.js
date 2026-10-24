// =====================================================================
//  WIZZIE FARM — DUEL SCREEN
//  Stages a duel circle in the 3D world, shows the combat UI (hand of
//  cards, pips, health, blades/traps), and animates the events produced
//  by the rules engine (WF.Battle in combat.js) one at a time.
//  v1.1 (agent F): every cast plays a W101-style cinematic (WF.cine), the
//  duel opens with the circle drawing itself while the combatants step to
//  their marks, cards are dealt, enemies taunt, defeat/victory poses.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.combatView = (function () {
  'use strict';
  var U = WF.util, D = function () { return WF.data; };
  var CV = { active: false };
  CV.features = { summon: true };   // v2.1 D15: boss phases can summon helpers mid-duel (world.js DG.supportsSummon)
  var summoned = [];                // meshes made for summoned helpers (disposed at the end of the duel)
  var duelR = 4.6;
  var battle = null, group = null, actors = [], ring = null, center = null, axis = null;
  var busy = false, targeting = null, root = null;
  var camAnim = { t: 0, focus: null, focusT: 0 };
  var statusMeshes = [];     // per combatant { charms: [mesh], wards: [mesh], pips: [mesh], absorb: mesh, aura: obj }
  var speed = 1;             // cinematic playback speed (always 1 since v1.2: fast combat = v1.1 timing, never faster)
  // ---- v1.2 WS1: duel pacing (Jorge: "battle animations are moving too quickly")
  //   pace    = between-turn waits, card dealing, damage numbers, banners  (x1.2)
  //   castMul = the non-cinematic cast path                                 (x1.5, like WF.cine's retime)
  //   "Fast combat animations" restores the exact v1.1 timing (both 1).
  var pace = 1, castMul = 1, classicTiming = false;
  var PACE = 1.2, CAST_MUL = 1.5;
  var disp = null;           // per-combatant display snapshot (what the player has SEEN so far)
  var handView = null; deckView = null;       // hand shown while a round animates
  var deckView = null;       // v2.1 A5: cards left in your deck while a round animates
  var _cam = new THREE.Vector3(), _look = new THREE.Vector3(), _lookCur = new THREE.Vector3();
  var PIP_GEO = null, PIP_MAT = null, BRIGHT_MAT = null;
  var hiddenProps = [];      // scenery hidden so it can't block the duel camera
  var hoverEnemy = null;     // enemy under the mouse (card faces preview against it)
  var skipIntro = false;     // Space / click skips boss intros and phase speeches
  var curCine = null;        // handle of the running spell cinematic (WF.cine.play)
  var entry = null;          // duel-entry animation state
  var camBase = new THREE.Vector3();   // camera position before the fallback shake offset
  var dealt = {};            // card uids already dealt into the hand (deal animation once)
  var _sh = new THREE.Vector3();
  var pSigil = null;         // school sigil under the player's feet (B13)
  var hudHidden = false, hudOffT = 0;   // duel HUD faded out while a cinematic / push-in owns the camera (B1)
  var pHidden = false;       // player mesh hidden because the camera is inside it (B5)
  var resultCam = null;      // 'win' | 'lose': the camera holds a deliberate front 3/4 shot of your wizard until the modal closes (B5)
  var resultShift = 0, resultCut = false;       // 0..1: slides your wizard to the left third once the results modal opens
  // ---- v2.0 WS-C: party duels (Realms). Combatants 0..nP-1 are player wizards (join order), the
  //      enemies follow. mySeat = which of them is YOU. A classic duel has nP = 1, mySeat = 0, so
  //      every party-aware line below reduces to exactly the old single-player behaviour.
  //      net = null (solo) | { mode: 'host' | 'guest', ctl, ... } set by CV.startParty (game/js/net/realmUI.js).
  var nP = 1, mySeat = 0, net = null, partyMeshes = [];
  function isP(i) { return i < nP; }
  function myHand() { return battle.kits ? battle.kits[mySeat].hand : battle.hand; }
  function myDeckLeft() { return deckView != null ? deckView : (battle && battle.deckLeft ? battle.deckLeft(mySeat) : 0); }   // v2.1 A5
  function myTcs() { return (battle.kits ? battle.kits[mySeat].tcs : battle.tcs) || {}; }

  function el(id) { return document.getElementById(id); }
  var ptr = { x: -1, y: -1, rx: -2, ry: -2 };
  window.addEventListener('pointermove', function (e) { ptr.x = e.clientX; ptr.y = e.clientY; }, true);
  // the cursor has not moved since the hand was (re)drawn (pointer coords are fractional, mouse ones whole)
  function atRest(e) { return !!e && Math.abs(e.clientX - ptr.rx) < 1.5 && Math.abs(e.clientY - ptr.ry) < 1.5; }
  function reduceMotion() { var p = WF.state.player; return !!(p && p.settings.reduceMotion); }
  function wait(ms) { return U.sleep(ms * pace); }
  function dispose(o) { if (o && WF.models.dispose) { try { WF.models.dispose(o); } catch (e) { /* ignore */ } } }
  function hasCine() { return !!(WF.cine && WF.cine.play); }
  function statesOf(mesh) { if (WF.cine && WF.cine.statesOf) return WF.cine.statesOf(mesh); return (mesh && mesh.userData && mesh.userData.states) || null; }
  // first state of `list` the model advertises (userData.states); otherwise the last (always-safe) one
  function pickState(mesh, list) { var k = statesOf(mesh); if (k) for (var i = 0; i < list.length; i++) if (k.indexOf(list[i]) >= 0) return list[i]; return list[list.length - 1]; }
  function cineMode() { return 'full'; }   // v2.0: no 'quick' spell animations (fixed timing)
  function lore() { return D().lore || {}; }

  // ------------------------------------------------------------------
  // Start a duel against an enemy camp
  // ------------------------------------------------------------------
  CV.start = function (g) {
    if (CV.active) return;
    // v2.0 WS-C: in a realm the host runs party duels and guests ask the host (game/js/net/realmUI.js)
    if (WF.realm && WF.realm.interceptDuel) { try { if (WF.realm.interceptDuel(g)) return; } catch (eR) { console.error('realm duel', eR); } }
    var W = WF.world, P = W.player, S = WF.state, p = S.player;
    var st = S.stats();
    nP = 1; mySeat = 0; net = null;
    try {
      // ---- v1.2 WS1: stats() carries brightPip / pipSurge (WS2); battleLoadout() = equipped deck + its sideboard (WS3)
      var lo = null;
      try { lo = S.battleLoadout ? S.battleLoadout() : { deck: p.deck, tcs: p.tcs }; } catch (e1) { console.error('battleLoadout failed', e1); lo = null; }
      if (!lo || !lo.deck) lo = { deck: p.deck, tcs: p.tcs };
      battle = new WF.Battle({
        player: { name: p.name, school: p.school, level: p.level, hp: Math.max(1, Math.round(p.hp)), maxHp: st.maxHp,
          mana: Math.floor(p.mana), maxMana: st.maxMana, dmg: st.dmg, resist: st.resist, acc: st.acc,
          brightPip: st.brightPip, pipSurge: st.pipSurge, flatDmg: st.flatDmg || 0,
          schoolStats: st.schoolStats, spellRanks: U.deepClone(p.spellRanks || {}),   // v2.0 M1 (WS-A): school stats + Runeglass ranks
          deck: U.deepClone(lo.deck || {}), tcs: U.deepClone(lo.tcs || {}) },
        enemies: g.def.enemies.slice(),
        enemyMods: runMode() ? runMode().enemyMods : undefined          // v2.1 D16 Heroic dungeon run
      });
    } catch (e) {
      console.error('Could not start duel', e);
      g.cooldown = performance.now() + 5000;
      battle = null;
      return;
    }
    stageDuel(g, null);
    var events = battle.start();
    beginDuel(g, events, null);
  };

  // ---- the duel circle, the duelists stepping onto their marks, the HUD (solo and party) ----
  // party: null (solo) | { meshes: [mesh per player combatant; mySeat = your avatar] }
  function stageDuel(g, party) {
    var W = WF.world, P = W.player, p = WF.state.player;
    CV.active = true; group = g; busy = true; targeting = null; disp = null; handView = null; deckView = null;
    classicTiming = false;   // v2.0 (Jorge): one fixed battle timing for everyone (multiplayer); no fast mode
    speed = 1; pace = classicTiming ? 1 : PACE; castMul = classicTiming ? 1 : CAST_MUL;
    W.mode = 'combat';
    WF.ui.closeAll(true);
    WF.ui.prompt(null);
    WF.ui.clearFloats();
    W.setTagsVisible(false);
    document.body.classList.add('in-combat');
    var zb = el('zone-banner'); if (zb) zb.classList.remove('show');
    Array.prototype.forEach.call(document.querySelectorAll('#toasts .toast.lore'), function (t) { t.remove(); });
    p.stats.fights++;

    // --- Stage the duel circle between the player and the camp ---
    var dx = P.x - g.x, dz = P.z - g.z, d = Math.hypot(dx, dz) || 1;
    axis = { x: dx / d, z: dz / d };
    center = { x: g.x + axis.x * 1.2, z: g.z + axis.z * 1.2 };
    var R = duelR;
    ring = WF.models.duelRing(R + 1.2, g.boss ? '#ff9a3c' : '#ffe08a');
    ring.position.set(center.x, 0.03, center.z);
    W.scene.add(ring);

    actors = [];
    var perp = { x: -axis.z, z: axis.x }, n = g.models.length;
    // v2.0 WS-C: 1-3 player wizards side by side (join order, left to right as the enemies see them)
    for (var pi = 0; pi < nP; pi++) {
      var spr = nP > 1 ? (pi - (nP - 1) / 2) * 2.6 : 0;
      var hx = center.x + axis.x * R + perp.x * spr, hz = center.z + axis.z * R + perp.z * spr, face = Math.atan2(-axis.x, -axis.z);
      var pm = pi === mySeat ? P.mesh : party.meshes[pi];
      var pFrom = new THREE.Vector3(pm.position.x, 0, pm.position.z);
      if (pi !== mySeat && (!pm.parent || pFrom.distanceTo(new THREE.Vector3(hx, 0, hz)) > 12)) pFrom.set(hx + axis.x * 2.5, 0, hz + axis.z * 2.5);
      if (pi !== mySeat && pm.parent !== W.scene) { if (pm.parent) pm.parent.remove(pm); W.scene.add(pm); }
      if (pi === mySeat) { P.x = hx; P.z = hz; P.rot = face; }
      pm.scale.setScalar(1); pm.visible = true; pm.rotation.y = face;
      actors.push({ mesh: pm, home: new THREE.Vector3(hx, 0, hz), from: pFrom, state: 'idle', stateT: 0, kick: 0, face: face });
    }
    g.models.forEach(function (m, i) {
      var spread = n > 1 ? (i - (n - 1) / 2) * 3.0 : 0;
      var ex = center.x - axis.x * R + perp.x * spread, ez = center.z - axis.z * R + perp.z * spread;
      var from = new THREE.Vector3(m.position.x, 0, m.position.z);
      if (from.distanceTo(new THREE.Vector3(ex, 0, ez)) > 9) from.set(ex - axis.x * 2.5, 0, ez - axis.z * 2.5);
      m.rotation.y = Math.atan2(axis.x, axis.z);
      m.visible = true; m.scale.setScalar(1);
      if (m.userData && 'defeatDone' in m.userData) m.userData.defeatDone = false;
      actors.push({ mesh: m, home: new THREE.Vector3(ex, 0, ez), from: from, state: 'idle', stateT: 0, kick: 0, face: m.rotation.y });
    });
    // duel entry: the circle draws itself while everyone steps onto their mark
    var fast = reduceMotion() ? 0.35 : 1;
    entry = { t: 0, dur: 1.45 * pace * fast, done: false, trace: makeRingTrace(R + 1.2, g.boss ? '#ff9a3c' : '#ffe08a') };
    actors.forEach(function (a) { a.mesh.position.copy(a.from); });
    ring.scale.setScalar(0.01);
    statusMeshes = actors.map(function () { return { charms: [], wards: [], pips: [], absorb: null, aura: null }; });
    // your school's sigil glows under your feet (child of the ring: it draws in with the circle)
    if (WF.models.duelSigil) {
      try { var mh = actors[mySeat].home; pSigil = WF.models.duelSigil(p.school, 1.15); pSigil.position.set(mh.x - center.x, 0, mh.z - center.z); ring.add(pSigil); } catch (e) { pSigil = null; }
    }
    hudHidden = false; hudOffT = 0; pHidden = false; resultCam = null; resultShift = 0; resultCut = false;

    dealt = {};
    buildUI();
    root.classList.add('entering');
  }

  // ---- after staging: frame the camera, play the entry + intros + the opening events ----
  // then(): v2.0 WS-C realm duels report "animated" to the host (fixed timing for everyone)
  function beginDuel(g, events, then) {
    var W = WF.world;
    refreshUI();
    // frame the duel for THIS screen + these combatants (needs the HUD laid out), then hide scenery in the way
    solveDuelCam();
    hideOccluders();
    orderFromDuelCam();          // v1.2 WS1: panels in on-screen order from the first frame
    refreshUI();

    camAnim.t = 0; camAnim.focus = null; camAnim.focusT = 0;
    // start on a wide establishing view of the circle, then settle into the duel view
    duelCam(0, _cam, _look);
    entryCam(0, W.camera.position, _lookCur);
    camBase.copy(W.camera.position);
    W.camera.lookAt(_lookCur);
    WF.sfx.music(g.boss ? 'boss' : 'battle');
    WF.sfx.play('duel_start');
    // v2.0 (Jorge): spell animations can no longer be skipped/sped up with Space or a click
    (async function () {
      try {
        await playEntry();
        await playIntros();
        await playEvents(events);
      } catch (e) { console.error(e); }
      disp = null; handView = null; deckView = null;
      if (then) { then(); return; }
      busy = false;
      syncAll();
      refreshUI();
    })();
  }

  // ------------------------------------------------------------------
  // Duel entry: ring trace + combatants walking to their marks + taunts
  // ------------------------------------------------------------------
  function makeRingTrace(radius, color) {
    var segs = 120, geo = new THREE.RingGeometry(radius - 0.07, radius + 0.07, segs, 1);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.2), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mat.toneMapped = false;
    var m = new THREE.Mesh(geo, mat); m.position.set(center.x, 0.09, center.z); m.renderOrder = 6; m.frustumCulled = false;
    geo.setDrawRange(0, 0);
    WF.world.scene.add(m);
    return { mesh: m, geo: geo, mat: mat, total: geo.index ? geo.index.count : segs * 6, radius: radius };
  }
  function freeTrace() {
    if (!entry || !entry.trace) return;
    var tr = entry.trace; entry.trace = null;
    if (tr.mesh.parent) tr.mesh.parent.remove(tr.mesh);
    tr.geo.dispose(); tr.mat.dispose();
  }
  // v2.0 WS-C: where the duel camera is anchored: your wizard, or the middle of the party line
  function pHome() {
    if (nP <= 1) return actors[0].home;
    var x = 0, z = 0; for (var i = 0; i < nP; i++) { x += actors[i].home.x; z += actors[i].home.z; }
    return { x: x / nP, z: z / nP };
  }
  function entryCam(k, outPos, outLook) {
    // orbit in from a high wide angle toward the duel camera
    var cs = camSol, h0 = pHome();
    var ca = Math.atan2(axis.x, axis.z) + cs.side + (1 - k) * 0.9;
    var back = cs.back + (1 - k) * 6, up = cs.up + (1 - k) * 3.5;
    outPos.set(h0.x + Math.sin(ca) * back, up, h0.z + Math.cos(ca) * back);
    outLook.set(center.x + axis.x * cs.lookF * k, cs.lookY * k + 0.6 * (1 - k), center.z + axis.z * cs.lookF * k);
  }
  function updateEntry(dt) {
    if (!entry || entry.done) return;
    entry.t += dt;
    var k = Math.min(1, entry.t / entry.dur), e = k * k * (3 - 2 * k);
    // the circle draws itself (two thirds of the time), then flares
    var kd = Math.min(1, k / 0.66);
    if (entry.trace) {
      var n = Math.floor(entry.trace.total * kd / 6) * 6;
      entry.trace.geo.setDrawRange(0, n);
      entry.trace.mat.opacity = k < 0.66 ? 1 : Math.max(0, 1 - (k - 0.66) / 0.34);
    }
    if (ring) ring.scale.setScalar(Math.max(0.01, k < 0.5 ? 0.01 : Math.min(1, (k - 0.5) / 0.3)));
    // walk to the marks
    actors.forEach(function (a, i) {
      if (!a.from) return;
      var kw = Math.min(1, entry.t / (entry.dur * 0.8));
      var ew = kw * kw * (3 - 2 * kw);
      a.mesh.position.lerpVectors(a.from, a.home, ew);
      var dx = a.home.x - a.from.x, dz = a.home.z - a.from.z;
      if (kw < 1 && dx * dx + dz * dz > 0.04) { a.mesh.rotation.y = Math.atan2(dx, dz); a.state = 'walk'; a.stateT = 0.1; }
      else a.mesh.rotation.y = a.face;
    });
    if (k >= 1) finishEntry();
  }
  function finishEntry() {
    if (!entry || entry.done) return;
    entry.done = true;
    actors.forEach(function (a) { a.mesh.position.copy(a.home); a.mesh.rotation.y = a.face; a.state = 'idle'; a.stateT = 0; a.from = null; });
    if (ring) ring.scale.setScalar(1);
    freeTrace();
    if (root) root.classList.remove('entering');
  }
  async function playEntry() {
    listenSkip(true);
    while (entry && !entry.done && !skipIntro) await U.sleep(40);
    finishEntry();
    listenSkip(false);
    // enemies taunt (roar / flex) as the duel begins
    for (var i = nP; i < actors.length; i++) setState(i, pickState(actors[i].mesh, ['taunt', 'cast']), 1.2);
    WF.sfx.play('taunt');
    await wait(reduceMotion() ? 200 : 650);
  }

  function segDist(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  }
  // ------------------------------------------------------------------
  // Duel camera (B3): instead of one fixed spot, solve a camera per duel so that on THIS
  // screen your wizard stands fully above the card hand and every enemy (bosses included,
  // halo / canopy and all) sits in the band between the enemy panels and the hand.
  // ------------------------------------------------------------------
  var camSol = { back: 9.6, up: 6.9, side: 0.55, lookF: 0.9, lookY: 0.6 };   // v1.1.0 spot (fallback)
  var camSide = 0.55;        // which side of the duel line the camera sits on (QA can flip it: CV._camSide(-0.55))
  var _pc = null, _pv = new THREE.Vector3(), _pq = new THREE.Vector3(), _pl = new THREE.Vector3();
  function scratchCam(fov) {
    var c = WF.world.camera;
    if (!_pc) _pc = new THREE.PerspectiveCamera();
    _pc.fov = fov || c.fov; _pc.aspect = c.aspect || (window.innerWidth / Math.max(1, window.innerHeight)); _pc.near = c.near; _pc.far = c.far;
    _pc.updateProjectionMatrix();
    return _pc;
  }
  function placeCam(cam, P, L) { cam.position.copy(P); cam.lookAt(L); cam.updateMatrixWorld(true); }
  function duelCamWith(cs, sway, outPos, outLook) {
    var ca = Math.atan2(axis.x, axis.z) + cs.side + (sway || 0), h0 = pHome();
    outPos.set(h0.x + Math.sin(ca) * cs.back, cs.up, h0.z + Math.cos(ca) * cs.back);
    outLook.set(center.x + axis.x * cs.lookF, cs.lookY, center.z + axis.z * cs.lookF);
  }
  // The duel camera spot (shared by the camera itself, the occluder check and cinematics' "home")
  function duelCam(sway, outPos, outLook) { duelCamWith(camSol, sway, outPos, outLook); }
  // screen bands (fractions of the viewport height, 0 = top) the HUD leaves free for the 3D duel
  function hudBands() {
    var H = Math.max(1, window.innerHeight), top = 0.2, bot = 0.7;
    var en = el('cb-enemies');
    if (en && en.offsetHeight) top = (en.offsetTop + en.offsetHeight + 6) / H;
    var card = document.querySelector('#cb-hand .card'), ch = card ? card.offsetHeight : 184;
    bot = (H - 14 - ch - 6) / H;
    return { top: top, bot: bot, H: H, topPx: top * H, botPx: bot * H };
  }
  function actorTop(i) { var a = actors[i], h = a.mesh.userData.height || 2; return isP(i) ? h + 0.3 : h * 1.06 + 0.4; }
  function camScore(cs, b, cam) {
    duelCamWith(cs, 0, _cam, _look); placeCam(cam, _cam, _look);
    var pen = 0, size = 0;
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i], h = a.mesh.userData.height || 2;
      _pv.set(a.home.x, actorTop(i), a.home.z).project(cam);
      _pq.set(a.home.x, 0, a.home.z).project(cam);
      if (_pv.z > 1 || _pq.z > 1 || _pv.z < -1 || _pq.z < -1) { pen += 50; continue; }
      var yT = (1 - _pv.y) / 2, yF = (1 - _pq.y) / 2, x = (_pq.x + 1) / 2, hh = Math.max(0.01, yF - yT);
      var half = hh * (isP(i) ? 0.22 : Math.min(0.5, 0.18 + (a.mesh.userData.radius || h * 0.3) / Math.max(1, h) * 0.4)) * (1 / Math.max(0.5, cam.aspect / 1.78));
      if (isP(i)) {
        pen += Math.max(0, yF - (b.bot - 0.012)) * 40;          // feet above the hand
        pen += Math.max(0, b.top + 0.04 - yT) * 40;
        pen += Math.max(0, hh - 0.3) * 3;                         // your wizard frames the shot, it doesn't fill it
        size += Math.min(hh, 0.3) * 0.3;
      } else {
        pen += Math.max(0, b.top + 0.012 + (b.plate || 0) - yT) * 60;   // head (halo, canopy) + its nameplate below the enemy panels
        pen += Math.max(0, yF - Math.min(b.bot - 0.07, 0.64)) * 40;
        size += hh;
      }
      pen += (Math.max(0, 0.05 - (x - half)) + Math.max(0, (x + half) - 0.95)) * 30;
    }
    var hd = Math.hypot(_cam.x - _look.x, _cam.z - _look.z), pitch = Math.atan2(_cam.y - _look.y, hd) * 180 / Math.PI;
    pen += Math.max(0, 26 - pitch) * 0.02 + Math.max(0, pitch - 44) * 0.02;
    return pen * 10 - size;
  }
  function solveDuelCam() {
    camSol = { back: 9.6, up: 6.9, side: camSide, lookF: 0.9, lookY: 0.6 };
    var t0 = performance.now();
    try {
      var b = hudBands(), cam = scratchCam(), best = null, bs = 1e9, cs = { side: camSide };
      // v1.2 WS1: leave room for the nameplate above each enemy (name + health bar)
      var ph = 0; for (var pi = 0; pi < plates.length; pi++) if (plates[pi]) ph = Math.max(ph, plates[pi].node.offsetHeight || 0);
      b.plate = ((ph || 40) + 10) / b.H;
      var tryIt = function (back, up, lf, ly) {
        cs.back = back; cs.up = up; cs.lookF = lf; cs.lookY = ly;
        var sc = camScore(cs, b, cam);
        if (sc < bs) { bs = sc; best = { back: back, up: up, side: cs.side, lookF: lf, lookY: ly }; }
      };
      for (var back = 7; back <= 16; back += 1) for (var up = 3; up <= 11; up += 1)
        for (var lf = -2; lf <= 3; lf += 1) for (var ly = 0; ly <= 2.4; ly += 0.8) tryIt(back, up, lf, ly);
      var c0 = best;
      if (c0) for (var b2 = -0.5; b2 <= 0.5; b2 += 0.25) for (var u2 = -0.5; u2 <= 0.5; u2 += 0.25)
        for (var l2 = -0.5; l2 <= 0.5; l2 += 0.25) for (var y2 = -0.4; y2 <= 0.4; y2 += 0.2)
          tryIt(c0.back + b2, Math.max(2.5, c0.up + u2), c0.lookF + l2, Math.max(0, c0.lookY + y2));
      if (best) camSol = best;
      CV._camScore = bs; CV._camSolveMs = Math.round(performance.now() - t0);
    } catch (e) { console.error('duel camera solve failed', e); }
  }

  // ------------------------------------------------------------------
  // Occluders (B4): hide trees / rocks / ruins inside the circle, on the line from a camera to
  // a duelist, right next to a camera, or covering a duelist on screen (nearer than them).
  // Used for the default duel camera at the start and for every cinematic camera spot.
  // ------------------------------------------------------------------
  var _bb = new THREE.Box3(), _bc = new THREE.Vector3();
  function propBox(m) {
    var ud = m.userData;
    if (!ud._duelBox) {
      var box = null;
      try { m.updateMatrixWorld(true); _bb.setFromObject(m); if (!_bb.isEmpty() && isFinite(_bb.min.x)) box = _bb.clone(); } catch (e) { box = null; }
      if (!box) { var r = (ud.radius || 0.8) * m.scale.x; box = new THREE.Box3(new THREE.Vector3(m.position.x - r, 0, m.position.z - r), new THREE.Vector3(m.position.x + r, (ud.height || r * 2.5), m.position.z + r)); }
      ud._duelBox = box;
    }
    return ud._duelBox;
  }
  // screen rect {x0,y0,x1,y1 (0..1), near (distance), ok} of a world box seen from cam
  var _corner = new THREE.Vector3();
  function boxRect(box, cam, out) {
    out.x0 = out.y0 = 1e9; out.x1 = out.y1 = -1e9; out.near = 1e9; out.ok = false;
    var inFront = 0;
    for (var k = 0; k < 8; k++) {
      _corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
      var d = _corner.distanceTo(cam.position);
      _pl.copy(_corner).applyMatrix4(cam.matrixWorldInverse);
      if (_pl.z > -0.05) continue;                 // behind the camera
      inFront++;
      out.near = Math.min(out.near, d);
      _corner.project(cam);
      var x = (_corner.x + 1) / 2, y = (1 - _corner.y) / 2;
      out.x0 = Math.min(out.x0, x); out.x1 = Math.max(out.x1, x); out.y0 = Math.min(out.y0, y); out.y1 = Math.max(out.y1, y);
    }
    // straddles the camera plane: treat as covering a big part of the view
    if (inFront && inFront < 8) { out.x0 = Math.min(out.x0, 0); out.x1 = Math.max(out.x1, 1); out.y0 = Math.min(out.y0, 0); out.y1 = Math.max(out.y1, 1); }
    out.ok = inFront > 0;
    return out;
  }
  var _rA = {}, _rB = {}, _actorBox = new THREE.Box3();
  function overlapFrac(p, a) {        // share of actor rect a covered by rect p
    var w = Math.min(p.x1, a.x1) - Math.max(p.x0, a.x0), h = Math.min(p.y1, a.y1) - Math.max(p.y0, a.y0);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.max(1e-4, (a.x1 - a.x0) * (a.y1 - a.y0));
  }
  // does prop m spoil the view from (P -> L)?  `who` = actor indices that matter for this shot
  function blocksView(m, P, L, who, cam) {
    var box = propBox(m);
    // the camera is (nearly) inside the prop
    _bc.copy(P).clamp(box.min, box.max);
    if (_bc.distanceTo(P) < 1.4) return true;
    placeCam(cam, P, L);
    var pr = boxRect(box, cam, _rA);
    if (!pr.ok || pr.x1 < 0 || pr.x0 > 1 || pr.y1 < 0 || pr.y0 > 1) return false;
    for (var k = 0; k < who.length; k++) {
      var a = actors[who[k]]; if (!a || !a.mesh.visible) continue;
      var h = actorTop(who[k]), r = Math.max(0.5, (a.mesh.userData.radius || h * 0.3));
      _actorBox.min.set(a.home.x - r, 0, a.home.z - r); _actorBox.max.set(a.home.x + r, h, a.home.z + r);
      var ar = boxRect(_actorBox, cam, _rB);
      if (!ar.ok) continue;
      var dA = cam.position.distanceTo(_bc.set(a.home.x, h * 0.5, a.home.z));
      if (pr.near < dA - 0.6 && overlapFrac(pr, ar) > 0.12) return true;
    }
    // big foreground clutter right in front of the lens (a ruin pillar filling a screen edge)
    var area = (Math.min(1, pr.x1) - Math.max(0, pr.x0)) * (Math.min(1, pr.y1) - Math.max(0, pr.y0));
    if (pr.near < 6 && area > 0.12) return true;
    return false;
  }
  function hideForResult(kind) {
    try {
      var poses = [0, 1].map(function (sh) { var P = new THREE.Vector3(), L = new THREE.Vector3(); resultPose(kind, P, L, sh); return { pos: P, look: L }; });
      hideForShots(poses);
    } catch (e) { /* cosmetic */ }
  }
  function allActors() { var l = []; for (var i = 0; i < actors.length; i++) l.push(i); return l; }
  function hideOccluders() {
    var cam = scratchCam(), P = new THREE.Vector3(), L = new THREE.Vector3();
    var views = [];
    [-0.09, 0, 0.09].forEach(function (sw) { var p2 = new THREE.Vector3(), l2 = new THREE.Vector3(); duelCamWith(camSol, sw, p2, l2); views.push({ P: p2, L: l2 }); });
    duelCam(0, P, L);
    var cx = P.x, cz = P.z, who = allActors();
    function test(m) {
      var r = (m.userData.radius || 0.8) * m.scale.x + 0.6;
      var dC = Math.hypot(m.position.x - center.x, m.position.z - center.z);
      var inRing = dC < 6.2 + r;
      var blocks = actors.some(function (a) { return segDist(m.position.x, m.position.z, cx, cz, a.home.x, a.home.z) < r + 0.8; });
      if (!inRing && !blocks && dC < 30) blocks = views.some(function (v) { return blocksView(m, v.P, v.L, who, cam); });
      return inRing || blocks;
    }
    (WF.world.props || []).forEach(function (m) { if (m.visible && test(m)) { m.visible = false; hiddenProps.push(m); } });
    extraOccluders().forEach(function (m) { if (m.visible && test(m)) hideExtra(m); });
    if (WF.world.explodeBatches) WF.world.explodeBatches(hiddenProps);
  }
  // v1.2 WS1: besides scenery, NPCs, portals and other camps' enemies can stand in front of the duel
  // camera (seen at Ashen Ruins: a portal ring filling the left edge). Hidden for the duel, restored after.
  var hiddenExtra = [];
  function extraOccluders() {
    var W = WF.world, out = [];
    (W.npcs || []).forEach(function (n) { if (n.mesh) out.push(n.mesh); });
    (W.portals || []).forEach(function (p) { if (p.mesh) out.push(p.mesh); });
    (W.groups || []).forEach(function (g) { if (g !== group) (g.models || []).forEach(function (m) { out.push(m); }); });
    out.forEach(function (m) { if (m.userData) m.userData._duelBox = null; });     // they may have moved since the last duel
    return out;
  }
  function hideExtra(m) { hiddenExtra.push({ m: m, vis: m.visible }); m.visible = false; }
  function restoreExtra() { hiddenExtra.forEach(function (h) { h.m.visible = h.vis; }); hiddenExtra = []; }
  // cinematic camera spots: hide props between those cameras and what they look at (kept hidden for the duel)
  function hideForShots(poses) {
    var added = [], cam = scratchCam(), who = allActors();
    function test(m) {
      if (Math.hypot(m.position.x - center.x, m.position.z - center.z) > 22) return false;    // far props never block a duel shot
      var r = (m.userData.radius || 0.8) * m.scale.x + 0.5;
      for (var i = 0; i < poses.length; i++) {
        var P = poses[i].pos, L = poses[i].look;
        if (Math.hypot(m.position.x - P.x, m.position.z - P.z) < r + 1.0 || segDist(m.position.x, m.position.z, P.x, P.z, L.x, L.z) < r + 0.4 || blocksView(m, P, L, who, cam)) return true;
      }
      return false;
    }
    (WF.world.props || []).forEach(function (m) { if (m.visible && test(m)) { m.visible = false; hiddenProps.push(m); added.push(m); } });
    extraOccluders().forEach(function (m) { if (m.visible && test(m)) hideExtra(m); });
    if (added.length && WF.world.explodeBatches) WF.world.explodeBatches(hiddenProps);
  }

  // Waits that the player can cut short (Space / Enter / Esc / click)
  function onSkip(e) {
    if (e.type === 'keydown' && ['Space', 'Enter', 'Escape'].indexOf(e.code) < 0) return;
    if (e.type === 'keydown') e.preventDefault();
    // v2.0 WS-C: in a realm duel the host decides skips for everyone (V2.0-CONTRACT §0.6)
    if (net && net.mode === 'guest') return;
    if (net && net.mode === 'host') { try { net.ctl.skip(); } catch (e2) { /* ignore */ } }
    skipIntro = true;
  }
  function listenSkip(on) {
    if (on) { skipIntro = false; window.addEventListener('keydown', onSkip, true); el('combat').addEventListener('pointerdown', onSkip); el('cb-hint').textContent = (net && net.mode === 'guest') ? 'The realm host can skip this' : 'Space / click to skip'; }
    else { window.removeEventListener('keydown', onSkip, true); var c = el('combat'); if (c) c.removeEventListener('pointerdown', onSkip); }
  }
  // Space / Enter / click skips the running spell cinematic to its impact
  function onCineSkip(e) {
    if (!CV.active || !hasCine() || !WF.cine.active()) return;
    if (e.type === 'keydown') { if (['Space', 'Enter'].indexOf(e.code) < 0) return; e.preventDefault(); }
    else if (e.button != null && e.button !== 0) return;
    WF.cine.skip();
  }
  function listenCineSkip(on) {
    if (on) { window.addEventListener('keydown', onCineSkip, true); window.addEventListener('pointerdown', onCineSkip, true); }
    else { window.removeEventListener('keydown', onCineSkip, true); window.removeEventListener('pointerdown', onCineSkip, true); }
  }
  async function waitSkippable(ms) {
    var end = performance.now() + ms * pace;
    while (!skipIntro && performance.now() < end) await U.sleep(50);
  }
  // v2.1 A2 (Jorge): when an enemy talks, the duel waits until the line is finished before any
  // spell animation. The wait is the longer of the reading time and the voice clip (from the
  // manifest, so it is the same on every machine in a realm, voice on or off) plus a short tail.
  function speechMs(text, minMs) {
    try { if (WF.voice && WF.voice.speechWaitMs) return WF.voice.speechWaitMs(text, minMs, pace); } catch (e) { /* fall through */ }
    return minMs * pace;
  }
  async function waitSpeech(text, minMs) {
    var end = performance.now() + speechMs(text, minMs);
    while (!skipIntro && performance.now() < end) await U.sleep(50);
    if (skipIntro) { try { if (WF.voice) WF.voice.stop(); } catch (e) { /* silent */ } }
  }

  // Boss intros (2-3 lines with a camera push-in) or a short shout the first
  // time you meet a new kind of enemy. Regular mobs stay quiet after that.
  async function playIntros() {
    var p = WF.state.player;
    p.seenEnemies = p.seenEnemies || {};
    for (var i = nP; i < battle.combatants.length; i++) {
      var c = battle.combatants[i], ed = D().enemies[c.enemyId];
      if (!ed) continue;
      var bl = (lore().bossLines || {})[c.enemyId];
      if (ed.boss) {
        var lines = (bl && bl.intro && bl.intro.length) ? bl.intro : (ed.intro ? [ed.intro] : []);
        if (p.seenEnemies[c.enemyId]) lines = lines.slice(0, 1);     // rematches: one line only
        camAnim.focus = reduceMotion() ? null : i; camAnim.focusT = 0;
        banner(ed.name, '#ffb347', 1600);
        listenSkip(true);
        for (var k = 0; k < lines.length; k++) {
          if (skipIntro) break;
          var line = U.fillText(lines[k]);
          speech(i, line);
          await waitSpeech(line, Math.min(3200, 1100 + lines[k].length * 30));
          WF.ui.clearFloats('speech');
        }
        listenSkip(false);
        camAnim.focus = null;
      } else if (ed.intro && !p.seenEnemies[c.enemyId]) {
        var shout = U.fillText(ed.intro);
        speech(i, shout);
        listenSkip(true);
        await waitSpeech(shout, 1500);
        listenSkip(false);
      }
      p.seenEnemies[c.enemyId] = true;
    }
    WF.ui.clearFloats('speech');
  }

  // ------------------------------------------------------------------
  // Per-frame: animate actors, status orbs, camera
  // ------------------------------------------------------------------
  CV.update = function (dt) {
    if (!CV.active) return;
    var W = WF.world, t = W.time;
    if (hasCine()) WF.cine.update(dt);
    updateEntry(dt);
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      a.stateT -= dt;
      if (a.stateT <= 0 && a.state !== 'dead' && a.state !== 'dying' && a.state !== 'pose') a.state = 'idle';
      if (a.state === 'dying' || a.state === 'dead') { updateDying(a, i, t, dt); continue; }
      // knockback from big hits: slide back from the circle centre, then recover
      if (a.kick > 0.001 && (!entry || entry.done)) {
        a.kick *= Math.exp(-dt * 7);
        var kx = a.home.x - center.x, kz = a.home.z - center.z, kl = Math.hypot(kx, kz) || 1;
        a.mesh.position.set(a.home.x + kx / kl * a.kick, 0, a.home.z + kz / kl * a.kick);
      } else if (!entry || entry.done) a.mesh.position.set(a.home.x, 0, a.home.z);
      var st = a.state === 'idle' ? 'duel_idle' : (a.state === 'pose' ? a.pose : a.state);
      if (a.mesh.userData.anim) a.mesh.userData.anim(t + i, st, dt);
      var sm = statusMeshes[i], h = (a.mesh.userData.height || 2) + 0.2;
      for (var k = 0; k < sm.charms.length; k++) {
        var ang = t * 1.6 + k * (Math.PI * 2 / sm.charms.length);
        sm.charms[k].position.set(a.home.x + Math.cos(ang) * 0.9, h + 0.35 + Math.sin(t * 3 + k) * 0.08, a.home.z + Math.sin(ang) * 0.9);
        sm.charms[k].rotation.y = t * 2;
      }
      for (var w = 0; w < sm.wards.length; w++) {
        var ang2 = -t * 1.1 + w * (Math.PI * 2 / sm.wards.length);
        sm.wards[w].position.set(a.home.x + Math.cos(ang2) * 1.25, 0.5 + Math.sin(t * 2 + w) * 0.06, a.home.z + Math.sin(ang2) * 1.25);
        sm.wards[w].rotation.y = -t;
      }
      if (sm.absorb) { sm.absorb.position.set(a.home.x, 1.1, a.home.z); sm.absorb.rotation.y = t * 0.5; }
      if (sm.aura && sm.aura.userData.anim) { sm.aura.position.set(a.home.x, 0, a.home.z); sm.aura.userData.anim(t); }
      for (var pp = 0; pp < sm.pips.length; pp++) if (sm.pips[pp].userData.anim) sm.pips[pp].userData.anim(t);
    }
    if (ring && ring.userData.anim) ring.userData.anim(t);
    if (pSigil && pSigil.userData.anim) pSigil.userData.anim(t);
    updateCam(dt);
    // B1: the duel HUD steps aside while a cinematic (or a boss push-in) owns the camera
    var cineCam = (hasCine() && WF.cine.ownsCamera()) || (camAnim.focus != null && !resultCam) || resultCam === 'win';
    if (cineCam) { hudOffT = 0; if (!hudHidden) setHudHidden(true); }
    else if (hudHidden) { hudOffT += dt; if (hudOffT > 0.3 || !busy) setHudHidden(false); }
    // v1.2 WS1: panels follow the on-screen order (re-sorted if the camera changed side), plates follow the heads
    if (!hudHidden && !resultCam && (!entry || entry.done) && updateOrder(WF.world.camera, false)) reorderPanels();
    layoutPlates(dt, false);
    if (busy) hideTip();
    guardPlayerMesh();
    clampFloats();
  };

  function setHudHidden(on) {
    hudHidden = on;
    if (root) root.classList.toggle('cine', on);
    if (on) { hideTip(); if (pickHover != null) setPickHover(null); if (platesBox) platesBox.classList.add('off'); }
  }
  // v1.2 WS1: a cinematic that takes the camera hides the HUD + nameplates at once (not one frame later)
  function cineStarted() {
    if (hasCine() && WF.cine.ownsCamera() && !hudHidden) { hudOffT = 0; setHudHidden(true); }
  }
  // v1.2 WS1: move the existing panel nodes into screen order (no rebuild: keeps hover state)
  function reorderPanels() {
    var box = el('cb-enemies'); if (!box) return;
    if (targeting) { refreshUI(); return; }          // target numbers change with the order
    enemyOrder().forEach(function (i) { var n = box.querySelector('.cb-enemy[data-idx="' + i + '"]'); if (n) box.appendChild(n); });
    renderPlates();
  }
  // B5: never look out from inside your own wizard (close cinematic shots, the defeat hold)
  function guardPlayerMesh() {
    var a = actors[mySeat]; if (!a) return;
    var cam = WF.world.camera, m = a.mesh, h = m.userData.height || 2;
    var px = m.position.x, pz = m.position.z, cp = cam.position;
    // distance from the camera to the wizard's body (a vertical segment feet -> hat tip)
    var dy = cp.y < 0 ? -cp.y : (cp.y > h + 0.3 ? cp.y - h - 0.3 : 0);
    var d = Math.hypot(Math.hypot(cp.x - px, cp.z - pz), dy);
    var hide = d < 1.25;
    if (hide !== pHidden) { pHidden = hide; m.visible = !hide; }
  }
  // B11: floating combat text never lands on the enemy panels / the hand (CSS `translate`
  // composes with the transform ui.js writes every frame, so this can nudge it from here)
  var _tre = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/;
  function clampFloats() {
    var box = el('floats'); if (!box || !root) return;
    var hud = !hudHidden && !root.classList.contains('results');
    var b = hud ? hudBands() : null;
    for (var n = box.firstChild; n; n = n.nextSibling) {
      if (!hud) { if (n.style.translate) n.style.translate = ''; continue; }
      var m = _tre.exec(n.style.transform || '');
      if (!m) continue;
      var y = +m[2], fs = parseFloat(n.style.fontSize) || 18, half = n.classList.contains('speech') ? Math.max(18, (n.offsetHeight || 40) / 2) : fs * 0.62;
      var dy = 0;
      if (y - half < b.topPx + 4) dy = b.topPx + 4 - (y - half);
      else if (y + half > b.botPx - 4) dy = Math.max(b.topPx + 4 - (y - half), b.botPx - 4 - (y + half));
      var v = dy ? '0 ' + dy.toFixed(1) + 'px' : '';
      if (n.style.translate !== v) n.style.translate = v;
    }
  }

  function updateCam(dt) {
    var W = WF.world;
    // Camera: a running spell cinematic drives it; otherwise the 3/4 duel view
    camAnim.t += dt;
    if (hasCine() && WF.cine.ownsCamera()) {
      WF.cine.lastLook(_lookCur);
      camBase.copy(W.camera.position);
      camOwned = true;
      return;
    }
    // a cinematic just handed the camera back (it parks it on the duel view): continue from there
    if (camOwned) { camOwned = false; camBase.copy(W.camera.position); }
    if (entry && !entry.done) {
      var ke = Math.min(1, entry.t / entry.dur), ee = 1 - Math.pow(1 - ke, 3);
      entryCam(ee, camBase, _lookCur);
      W.camera.position.copy(camBase); W.camera.lookAt(_lookCur);
      return;
    }
    var sway = (reduceMotion() || resultCam) ? 0 : Math.sin(camAnim.t * 0.25) * 0.08;
    if (resultCam) {
      // B5: victory cheer / defeat collapse: a deliberate front 3/4 shot of your wizard, locked until the
      // results modal is closed; once it opens the wizard slides to the left third (clear of the modal)
      resultShot(resultCam, _cam, _look, dt);
      if (!resultCut) { resultCut = true; camBase.copy(_cam); _lookCur.copy(_look); }      // a clean cut (never dolly through the wizard)
      else camBase.lerp(_cam, Math.min(1, dt * 4));
    } else if (camAnim.focus != null && actors[camAnim.focus]) {
      // push in toward a combatant (boss intro / phase change / victory)
      camAnim.focusT += dt;
      var fa = actors[camAnim.focus].home, fh = actors[camAnim.focus].mesh.userData.height || 3;
      var dx = center.x - fa.x, dz = center.z - fa.z, dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;   // toward the centre (in front of them)
      _cam.set(fa.x + dx * (4.2 + fh * 0.6) - dz * 2.2, 1.2 + fh * 0.62, fa.z + dz * (4.2 + fh * 0.6) + dx * 2.2);
      _look.set(fa.x, fh * 0.62, fa.z);
      camBase.lerp(_cam, Math.min(1, dt * 2.2));
    } else {
      duelCam(sway, _cam, _look);
      camBase.lerp(_cam, Math.min(1, dt * 2.5));
    }
    _lookCur.lerp(_look, Math.min(1, dt * 3));
    W.camera.position.copy(camBase);
    if (hasCine() && !(WF.gfx && WF.gfx.shake)) W.camera.position.add(WF.cine.shakeOffset(_sh));
    W.camera.lookAt(_lookCur);
  }
  var _v3a = new THREE.Vector3(), _v3b = new THREE.Vector3(), camOwned = false;
  function resultShot(kind, outP, outL, dt) {
    var open = !!(root && root.classList.contains('results'));
    resultShift += ((open ? 1 : 0) - resultShift) * Math.min(1, dt * 2.5);
    resultPose(kind, outP, outL, resultShift);
  }
  function resultPose(kind, outP, outL, shift) {
    var h0 = actors[mySeat].home, dx = center.x - h0.x, dz = center.z - h0.z, dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    var px = -dz, pz = dx, win = kind === 'win';
    // win: front 3/4 (the cheer reads); lose: from the side, so the collapsed wizard reads as lying down
    var fw = win ? 5.6 : 2.2, sd = win ? 2.2 : 5.2;
    outP.set(h0.x + dx * fw + px * sd, win ? 2.3 : 3.4, h0.z + dz * fw + pz * sd);
    outL.set(h0.x - (win ? 0 : dx * 0.55), win ? 1.15 : 0.35, h0.z - (win ? 0 : dz * 0.55));
    if (shift > 0.001) {
      // camera-right = forward x up; moving the look point right puts the wizard left of centre
      var fx = outL.x - outP.x, fz = outL.z - outP.z, fl = Math.hypot(fx, fz) || 1, rx = -fz / fl, rz = fx / fl;
      var k = shift * Math.hypot(outL.x - outP.x, outL.y - outP.y, outL.z - outP.z) * 0.62;
      outL.x += rx * k; outL.z += rz * k;
    }
  }

  // Defeat: the model's own 'defeat' animation when it has one (it sets userData.defeatDone
  // and holds); older models fall back to the v1.0 shrink-and-sink after a moment.
  function updateDying(a, i, t, dt) {
    var m = a.mesh;
    if (!m.visible) return;
    a.dieT = (a.dieT || 0) + dt;
    var ud = m.userData;
    if (a.state === 'dying') {
      if (ud.anim) ud.anim(t + i, 'defeat', dt);
      var advertised = !!(statesOf(m) && statesOf(m).indexOf('defeat') >= 0);
      if (ud.defeatDone) { a.state = 'dead'; a.native = true; return; }
      if ((!advertised && a.dieT > 0.9) || a.dieT > 3.2) { a.state = 'dead'; a.native = false; }
      return;
    }
    if (a.native) { if (ud.anim) ud.anim(t + i, 'defeat', dt); return; }       // holds its final pose
    m.scale.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    m.position.y -= dt * 0.6;
    if (m.scale.x < 0.05) m.visible = false;
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  function buildUI() {
    root = el('combat');
    root.innerHTML =
      '<div id="cb-enemies"></div>' +
      '<div id="cb-banner"></div>' +
      '<div id="cb-log"></div>' +
      '<div id="cb-bottom">' +
      '  <div id="cb-left"><div id="cb-hint"></div><div id="cb-player"></div></div>' +
      '  <div id="cb-hand-wrap"><div id="cb-hand"></div></div>' +
      '  <div id="cb-actions">' +
      '    <button id="cb-tc" class="btn">Spell Scrolls <span id="cb-tc-n"></span></button>' +
      '    <button id="cb-pass" class="btn">Pass <small>(P)</small></button>' +
      '    <button id="cb-flee" class="btn btn-ghost">Flee</button>' +
      '    <div id="cb-deck" title="Decks do not reshuffle: when your deck and hand are empty you can only Pass or Flee"></div>' +
      '  </div>' +
      '</div>' +
      '<div id="cb-tc-panel" class="hidden"></div>' +
      '<div id="cb-tip" class="hidden"></div>';
    root.classList.remove('hidden');
    el('cb-pass').onclick = function () { if (!busy) act({ type: 'pass' }); };
    el('cb-flee').onclick = function () {
      if (busy) return;
      act({ type: 'flee' });
    };
    el('cb-tc').onclick = function () { if (!busy) toggleTC(); };
    // v1.2 WS1: nameplates over every enemy, click/hover models to target, pacing for CSS animations
    screenOrder = []; pickHover = null; surgeUntil = {}; bandsCache = null; plateSolve = null;
    buildPlates();
    listenPick(true);
    document.body.style.setProperty('--wf-pace', String(pace));
    WF.ui.showHUD(false);
  }

  function hpColor(f) { return f > 0.5 ? '#4ee06a' : (f > 0.25 ? '#ffc93c' : '#ff4b4b'); }
  function schoolColor(s) { var sc = D().schools[s]; return sc ? sc.color : '#cccccc'; }
  function glyphOf(s) { var sc = s && s !== 'any' && D().schools[s]; return sc ? ' ' + sc.glyph : ''; }
  function schoolName(s) { var sc = D().schools[s]; return sc ? sc.name : s; }

  // What to DISPLAY for combatant i (snapshot while animating, live otherwise)
  function view(i) {
    var c = battle.combatants[i];
    if (disp && disp[i]) {
      var s = disp[i];
      return { name: c.name, level: c.level, school: c.school, boss: c.boss, enemyId: c.enemyId, isPlayer: c.isPlayer,
        hp: s.hp, maxHp: s.maxHp != null ? s.maxHp : c.maxHp, mana: s.mana != null ? s.mana : c.mana, maxMana: s.maxMana != null ? s.maxMana : c.maxMana,
        pips: s.pips, bright: s.bright || 0, alive: s.alive, absorb: s.absorb || 0,
        charms: s.charms || [], wards: s.wards || [], dots: s.dots || [], hots: s.hots || [] };
    }
    return c;
  }

  function statusIconsHTML(c) {
    var out = '';
    (c.charms || []).forEach(function (e) {
      var weak = e.kind === 'weakness', col = weak ? '#b0b0b0' : schoolColor(e.school);
      out += '<span class="st" style="--c:' + col + '" title="' + U.esc(e.name + ' ' + (weak ? '-' : '+') + e.value + '% ' + (e.affects === 'any' ? '(any school)' : '(' + schoolName(e.affects) + ')')) + '">' + (weak ? '▼-' : '⚔+') + e.value + glyphOf(e.affects) + '</span>';
    });
    (c.wards || []).forEach(function (e) {
      var sh = e.kind === 'shield', col = sh ? '#7fd6ff' : schoolColor(e.school);
      out += '<span class="st ward" style="--c:' + col + '" title="' + U.esc(e.name + ' ' + (sh ? '-' : '+') + e.value + '% ' + (e.affects === 'any' ? '(any school)' : '(' + schoolName(e.affects) + ')')) + '">' + (sh ? '⛨-' : '⬡+') + e.value + glyphOf(e.affects) + '</span>';
    });
    if (c.absorb > 0) out += '<span class="st" style="--c:#cfe8ff" title="Absorbs the next ' + c.absorb + ' damage">◎' + c.absorb + '</span>';
    (c.dots || []).forEach(function (e) { out += '<span class="st" style="--c:#ff7a3d" title="' + U.esc(e.name) + ': ' + e.amt + ' damage for ' + e.rounds + ' more rounds">♨' + e.amt + '×' + e.rounds + '</span>'; });
    (c.hots || []).forEach(function (e) { out += '<span class="st" style="--c:#6fff9a" title="' + U.esc(e.name) + ': heals ' + e.amt + ' for ' + e.rounds + ' more rounds">✚' + e.amt + '×' + e.rounds + '</span>'; });
    return out;
  }

  function pipsHTML(n, bright) {
    var s = '', max = D().progression.maxPips;
    bright = bright || 0;
    for (var i = 0; i < max; i++) s += '<i class="pip' + (i < n ? (i < bright ? ' on bright' : ' on') : '') + '"' + (i < bright && i < n ? ' title="Bright pip: counts as 2 for your own school and Lumen spells"' : '') + '></i>';
    return s;
  }

  function affinityHTML(enemyId) {
    var e = D().enemies[enemyId];
    if (!e || !e.affinity) return '';
    var weak = [], res = [];
    Object.keys(e.affinity).forEach(function (s) {
      var f = e.affinity[s], sc = D().schools[s];
      if (!sc || !f) return;
      var chip = '<span style="color:' + sc.color + '" title="' + U.esc((f > 0 ? 'Resists ' : 'Weak to ') + sc.name + ' ' + Math.round(Math.abs(f) * 100) + '%') + '">' + sc.glyph + '</span>';
      (f > 0 ? res : weak).push(chip);
    });
    if (!weak.length && !res.length) return '';
    return '<div class="aff">' + (weak.length ? 'Weak ' + weak.join('') : '') + (weak.length && res.length ? ' &middot; ' : '') + (res.length ? 'Resists ' + res.join('') : '') + '</div>';
  }

  // =====================================================================
  // ---- v1.2 WS1: enemy nameplates, screen-ordered panels, click-to-target, pip surge
  //  Jorge: "I would like the name of the enemy to be above the enemy. Currently the name
  //  display is not in the same order in which the bots stand in battle."
  //  * screenOrder: enemy combatant indices sorted by where they stand on screen (left ->
  //    right) from the live camera; re-sorted whenever the camera moves (with a small
  //    dead-band so a gentle sway never shuffles the panels).
  //  * plates: one DOM plate per enemy, anchored to the 3D head of its model every frame,
  //    clamped between the enemy panels and the card hand, pushed apart so plates never
  //    overlap, hidden whenever the duel HUD steps aside (cinematics, push-ins, results).
  //  * the model, its plate and its panel are all the same target (click / hover).
  // =====================================================================
  var screenOrder = [];            // enemy combatant indices, left -> right on screen
  var plates = [];                 // [idx] -> { node, w, h, x, y, tx, ty, placed, html }
  var platesBox = null;
  var pickHover = null;            // enemy under the pointer (model, plate or panel)
  var surgeUntil = {};             // combatant idx -> performance.now() until its pips glow (+2 surge)
  var bandsCache = null, bandsT = 0, plateSolve = null;   // plateSolve: last plate layout { t, sig, at: {idx: offsets} }
  var _op = new THREE.Vector3(), _oq = new THREE.Vector3();
  var PLATE_GAP = 6, ORDER_DEADBAND = 6;

  function enemyOrder() {
    if (!battle) return [];
    var n = battle.combatants.length;
    if (screenOrder.length !== n - nP) { screenOrder = []; for (var i = nP; i < n; i++) screenOrder.push(i); }
    return screenOrder;
  }
  // screen x (px) of where enemy i stands, seen from cam
  function standX(i, cam) {
    var a = actors[i]; if (!a) return 0;
    _op.set(a.home.x, (a.mesh.userData.height || 2) * 0.5, a.home.z).project(cam);
    return (_op.x + 1) / 2 * window.innerWidth;
  }
  // re-sort the enemy panels by screen position; returns true when the order changed
  function updateOrder(cam, force) {
    if (!battle || actors.length < nP + 1) return false;
    cam.updateMatrixWorld();          // project() reads matrixWorldInverse, otherwise refreshed only at render time
    var cur = enemyOrder().slice(), xs = {};
    cur.forEach(function (i) { xs[i] = standX(i, cam); });
    var want = cur.slice().sort(function (p, q) { return xs[p] - xs[q] || p - q; });
    var changed = want.some(function (v, k) { return v !== cur[k]; });
    if (!changed) return false;
    // dead-band: only swap when the pair is clearly crossed (prevents flicker on near-ties)
    if (!force) {
      var clear = false;
      for (var k = 0; k + 1 < cur.length; k++) if (xs[cur[k]] - xs[cur[k + 1]] > ORDER_DEADBAND) clear = true;
      if (!clear) return false;
    }
    screenOrder = want;
    return true;
  }
  function orderFromDuelCam() {
    var cam = scratchCam(), P = new THREE.Vector3(), L = new THREE.Vector3();
    duelCam(0, P, L); placeCam(cam, P, L);
    updateOrder(cam, true);
  }

  // one handler set for a panel or a plate of enemy idx
  function wireTarget(node, idx) {
    node.onclick = function (e) { if (e) e.stopPropagation(); selectTarget(idx); };
    node.onmouseenter = function () { setPickHover(idx); };
    node.onmouseleave = function () { if (pickHover === idx) setPickHover(null); };
  }
  function selectTarget(idx) {
    if (!targeting || busy || !battle) return false;
    if (!battle.combatants[idx] || !battle.combatants[idx].alive) return false;
    if (isP(idx) !== !!targeting.ally) return false;       // v2.0 WS-C: ally spells pick a wizard, attacks an enemy
    var a = targeting; targeting = null; setPickHover(null);
    act(Object.assign({}, a, { target: idx }));
    return true;
  }
  // hover from any of the three (model, plate, panel): highlight all of them + preview
  function setPickHover(idx) {
    if (idx != null && (!battle || !battle.combatants[idx] || !battle.combatants[idx].alive)) idx = null;
    if (idx === pickHover) return;
    pickHover = idx;
    Array.prototype.forEach.call(document.querySelectorAll('.cb-enemy, .cb-plate'), function (n) { n.classList.toggle('hover', +n.getAttribute('data-idx') === idx); });
    var cv = WF.world.renderer && WF.world.renderer.domElement;
    if (cv) cv.style.cursor = (idx != null && targeting && !busy) ? 'pointer' : '';
    if (idx == null) {
      if (targeting) hideTip();
      else if (hoverEnemy != null) { hoverEnemy = null; renderHand(); }
      return;
    }
    if (targeting) { if (!targeting.ally) showPreview(targeting, idx); }
    else if (!busy && !isP(idx) && hoverEnemy !== idx) { hoverEnemy = idx; renderHand(); }
  }
  // which enemy model is under screen point (x, y)? screen-space capsule test, nearest wins
  function pickEnemyAt(x, y) {
    if (!battle || !actors.length) return null;
    var cam = WF.world.camera, best = null, bestD = 1e9;
    cam.updateMatrixWorld();
    var from = (targeting && targeting.ally) ? 0 : nP, to = (targeting && targeting.ally) ? nP : actors.length;   // v2.0 WS-C
    for (var i = from; i < to; i++) {
      var c = battle.combatants[i], a = actors[i];
      if (!c || !c.alive || !a.mesh.visible) continue;
      var h = a.mesh.userData.height || 2, r = Math.max(0.45, a.mesh.userData.radius || h * 0.28);
      _op.set(a.mesh.position.x, 0, a.mesh.position.z).project(cam);
      _oq.set(a.mesh.position.x, h, a.mesh.position.z).project(cam);
      if (_op.z > 1 || _oq.z > 1) continue;
      var fx = (_op.x + 1) / 2 * window.innerWidth, fy = (1 - _op.y) / 2 * window.innerHeight, ty = (1 - _oq.y) / 2 * window.innerHeight;
      // half width: the radius projected at the model's distance
      var dist = cam.position.distanceTo(a.mesh.position);
      var half = Math.max(22, r / (dist * Math.tan(cam.fov * Math.PI / 360)) * window.innerHeight / 2);
      if (x < fx - half || x > fx + half || y < ty - 6 || y > fy + 10) continue;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  }
  function onCanvasMove(e) {
    if (!CV.active || !battle || hudHidden || (entry && !entry.done)) return;
    var i = pickEnemyAt(e.clientX, e.clientY);
    if (i !== pickHover) setPickHover(i);
  }
  function onCanvasClick(e) {
    if (!CV.active || !battle || busy || !targeting || e.button !== 0) return;
    var i = pickEnemyAt(e.clientX, e.clientY);
    if (i != null) { e.preventDefault(); selectTarget(i); }
  }
  function listenPick(on) {
    var cv = WF.world.renderer && WF.world.renderer.domElement; if (!cv) return;
    if (on) { cv.addEventListener('pointermove', onCanvasMove); cv.addEventListener('click', onCanvasClick); }
    else { cv.removeEventListener('pointermove', onCanvasMove); cv.removeEventListener('click', onCanvasClick); cv.style.cursor = ''; }
  }

  // ---------------- plates ----------------
  function buildPlates() {
    platesBox = document.createElement('div'); platesBox.id = 'cb-plates'; platesBox.className = 'off';
    root.insertBefore(platesBox, root.firstChild);        // first child: every menu / tooltip paints over it
    plates = [];
    for (var i = 0; i < actors.length; i++) {
      if (i === mySeat) continue;         // v2.0 WS-C: party members get plates too (not you)
      var n = document.createElement('div');
      n.className = 'cb-plate'; n.setAttribute('data-idx', i);
      platesBox.appendChild(n);
      plates[i] = { node: n, w: 150, h: 44, x: 0, y: 0, tx: 0, ty: 0, placed: false, html: '', cls: '' };
      wireTarget(n, i);
    }
  }
  function plateHTML(i) {
    if (isP(i)) return partyPlateHTML(i);   // v2.0 WS-C
    var c = view(i), ed = D().enemies[c.enemyId] || {}, sc = D().schools[c.school] || {}, elite = !!ed.elite && !c.boss;
    var f = Math.max(0, c.hp) / Math.max(1, c.maxHp);
    var fx = statusIconsHTML(c);
    return '<div class="pl-top">' +
        (targeting && c.alive ? '<span class="pl-key">' + aliveRank(i) + '</span>' : '') +
        (c.boss ? '<span class="pl-crown" title="' + U.esc('Boss' + (dropHintText(c.enemyId) ? ' · ' + dropHintText(c.enemyId) : '')) + '">♛</span>' : '') + (elite ? '<span class="pl-star" title="Elite">★</span>' : '') +
        '<span class="pl-sch" style="--c:' + (sc.color || '#a879ff') + '" title="' + U.esc((sc.name || 'Hollow') + ' school: its spells hit as ' + (sc.name || 'Hollow') + affinityTitle(c.enemyId)) + '">' + (sc.glyph || '☽') + '</span>' +
        '<span class="pl-name"' + (dropHintText(c.enemyId) ? ' title="' + U.esc(dropHintText(c.enemyId)) + '"' : '') + '>' + U.esc(c.name) + '</span><span class="pl-lv">Lv ' + U.esc(String(c.level)) + '</span>' +
        (dropHintText(c.enemyId) ? '<span class="pl-drops" style="margin-left:4px;color:#ffd76a;cursor:help" title="' + U.esc(dropHintText(c.enemyId)) + '">✦</span>' : '') + '</div>' +
      '<div class="pl-bar"><i style="width:' + (f * 100).toFixed(1) + '%;background:' + hpColor(f) + '"></i><b>' + Math.max(0, c.hp) + ' / ' + c.maxHp + '</b></div>' +
      (fx ? '<div class="pl-fx">' + fx + '</div>' : '');
  }
  // v2.1 drop hints (WF.state.bossDropHints): the set slots a boss drops for YOUR school, by tier,
  // e.g. "Drops for you: Boots T1 / T2 / T3, Amulet T1 / T2 / T3". Cached per school + enemy.
  var dropHintCache = {};
  function dropHintText(enemyId) {
    var S = WF.state, sch = S && S.player ? S.player.school : '', k = sch + '|' + enemyId;
    if (k in dropHintCache) return dropHintCache[k];
    var out = '';
    try {
      var h = S && S.bossDropHints ? S.bossDropHints(enemyId) : [], bySlot = {}, order = [];
      h.forEach(function (x) { if (!bySlot[x.slot]) { bySlot[x.slot] = []; order.push(x.slot); } if (x.tiered) bySlot[x.slot].push('T' + x.tier); });
      var set = h.length ? ((D().gearSets || {})[h[0].set] || {}).name : '';
      if (order.length) out = 'Drops for you' + (set ? ' (' + set + ')' : '') + ': ' + order.map(function (sl) { return sl.charAt(0).toUpperCase() + sl.slice(1) + (bySlot[sl].length ? ' ' + bySlot[sl].join(' / ') : ''); }).join(', ');
    } catch (e) { out = ''; }
    dropHintCache[k] = out;
    return out;
  }
  function affinityTitle(enemyId) {
    var e = D().enemies[enemyId]; if (!e || !e.affinity) return '';
    var out = [];
    Object.keys(e.affinity).forEach(function (s) { var f = e.affinity[s], sc = D().schools[s]; if (sc && f) out.push((f > 0 ? 'Resists ' : 'Weak to ') + sc.name + ' ' + Math.round(Math.abs(f) * 100) + '%'); });
    return out.length ? ' · ' + out.join(', ') : '';
  }
  function renderPlates() {
    if (!platesBox || !battle) return;
    for (var i = 0; i < plates.length; i++) {
      var p = plates[i]; if (!p) continue;
      var c = view(i), ed = D().enemies[c.enemyId] || {};
      var cls = 'cb-plate' + (isP(i) ? ' ally' + (netPlanned(i) ? ' planned' : '') : '') + (c.alive ? '' : ' dead') + (c.boss ? ' boss' : '') + (ed.elite && !c.boss ? ' elite' : '') + (targeting && c.alive ? ' targetable' : '') + (pickHover === i ? ' hover' : '');
      if (cls !== p.cls) { p.node.className = cls; p.cls = cls; }
      var html = plateHTML(i);
      if (html !== p.html) { p.node.innerHTML = html; p.html = html; p.w = p.node.offsetWidth || p.w; p.h = p.node.offsetHeight || p.h; }
    }
  }
  // screen bands + fixed HUD rects plates keep out of (combat log, player panel, buttons). Cached: layout reads are not free
  function plateBands() {
    var now = performance.now();
    if (!bandsCache || now - bandsT > 300) {
      bandsCache = hudBands(); bandsT = now;
      var obs = [];
      ['cb-log', 'cb-left', 'cb-actions'].forEach(function (id) {
        var n = el(id); if (!n || (id === 'cb-log' && !n.children.length)) return;
        var r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) obs.push({ x: r.left, y: r.top, w: r.width, h: r.height, fixed: id });
      });
      bandsCache.obstacles = obs;
    }
    return bandsCache;
  }
  function overlaps(a, b, g) { return a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g; }

  // Pure solver (no DOM / THREE, unit-tested by tests/duel-plates.test.js):
  //   items: [{ ax, ay (head anchor, px), w, h, px?, py? (last target, for stability) }]
  //   box:   { W, top, bot, obstacles: [{x,y,w,h}], gap }
  // Plates are taken left -> right (by anchor x). Each may sit straight above its head, slide sideways just
  // past a neighbour / HUD rect, or rise one or two rows. A small branch-and-bound search (<= 4 plates, the
  // few cheapest spots each) picks the cheapest combination where no two plates overlap, none covers the
  // HUD, all stay in the band and their left -> right order matches the models'. Sets it.x / it.y.
  var SOLVE_K = 3;
  function solvePlates(items, box) {
    var gap = box.gap != null ? box.gap : PLATE_GAP, W = box.W, top = box.top, bot = box.bot;
    var fixed = box.obstacles || [];
    var list = items.slice().sort(function (p1, p2) { return p1.ax - p2.ax || p1.ay - p2.ay; }), n = list.length;
    function clampX(x, w) { return Math.max(6, Math.min(W - 6 - w, x)); }
    function clampY(y, h) { return Math.max(top, Math.min(bot - h, y)); }
    // spots for plate k given the plates already placed (cheapest first)
    function spots(k, placed, minX) {
      var it = list[k], w = it.w, h = it.h, x0 = it.ax - w / 2, y0 = clampY(it.ay - h - 8, h), step = h + gap;
      var maxX = W - 6 - w - (n - 1 - k);                              // leave room for the order of the rest
      var ys = [y0, y0 - step, y0 - 2 * step, y0 + step, y0 + 2 * step];
      var xs = [x0];
      for (var q = 0; q < placed.length; q++) xs.push(placed[q].x + placed[q].w + gap);
      for (var f = 0; f < fixed.length; f++) xs.push(fixed[f].x + fixed[f].w + 3, fixed[f].x - w - 3);
      var out = [];
      for (var a = 0; a < ys.length; a++) for (var b = 0; b < xs.length; b++) {
        var x = Math.max(clampX(xs[b], w), minX), y = clampY(ys[a], h);
        if (x > maxX + 0.01) continue;
        var cand = { x: x, y: y, w: w, h: h }, bad = false, j;
        for (j = 0; j < fixed.length && !bad; j++) if (overlaps(cand, fixed[j], 3)) bad = true;
        for (j = 0; j < placed.length && !bad; j++) if (overlaps(cand, placed[j], gap)) bad = true;
        if (bad) continue;
        var dx = x - x0, dy = y - y0;
        cand.c = Math.abs(dx) + (dy < 0 ? -dy * 1.25 : dy * 4);      // sideways or up; dropping onto the body is last
        // stay put (no jitter): every other spot costs 14 more (kept >= 0 so the search bound stays exact)
        if (!(it.px != null && Math.abs(x - it.px) < 3 && Math.abs(y - it.py) < 3)) cand.c += 14;
        out.push(cand);
      }
      out.sort(function (p1, p2) { return p1.c - p2.c; });
      var top3 = [];                                                    // the K cheapest DISTINCT spots
      for (var u = 0; u < out.length && top3.length < SOLVE_K; u++) {
        var dup = false;
        for (var v = 0; v < top3.length && !dup; v++) if (Math.abs(top3[v].x - out[u].x) < 0.5 && Math.abs(top3[v].y - out[u].y) < 0.5) dup = true;
        if (!dup) top3.push(out[u]);
      }
      return top3;
    }
    var best = null, bestC = 1e18, chosen = [];
    // greedy first (cheapest spot per plate): a good bound for the search, and usually already the answer
    (function () {
      var placed = [], minX = -1e9, cost = 0, g = [];
      for (var k = 0; k < n; k++) { var sp = spots(k, placed, minX); if (!sp.length) return; g.push(sp[0]); placed.push(sp[0]); minX = sp[0].x + 1; cost += sp[0].c; }
      best = g; bestC = cost;
    })();
    // admissible bound: what each remaining plate costs at best when the other plates are ignored
    var lb = [], rest = 0;
    for (var r = n - 1; r >= 0; r--) { var s0 = spots(r, [], -1e9); rest += s0.length ? s0[0].c : 0; lb[r] = rest; }
    lb[n] = 0;
    if (best && bestC <= lb[0] + 0.01) list.forEach(function (it, k) { it.x = best[k].x; it.y = best[k].y; });
    else (function dfs(k, placed, minX, cost) {
      if (cost + lb[k] >= bestC - 0.01) return;
      if (k === n) { bestC = cost; best = chosen.slice(); return; }
      var sp = spots(k, placed, minX);
      for (var s = 0; s < sp.length; s++) {
        chosen[k] = sp[s]; placed.push(sp[s]);
        dfs(k + 1, placed, sp[s].x + 1, cost + sp[s].c);
        placed.pop();
      }
    })(0, [], -1e9, 0);
    if (!(best && bestC <= lb[0] + 0.01)) list.forEach(function (it, k) {
      if (best) { it.x = best[k].x; it.y = best[k].y; return; }
      // no free combination (absurdly crowded): straight above the head, clamped (never seen in duels)
      it.x = clampX(it.ax - it.w / 2, it.w); it.y = clampY(it.ay - it.h - 8, it.h);
    });
    return items;
  }
  CV._solvePlates = solvePlates;

  // place every plate above its model's head; returns the list (for QA)
  function layoutPlates(dt, snap) {
    if (!platesBox || !battle) return [];
    var show = !hudHidden && !(entry && !entry.done) && !(root && (root.classList.contains('results') || root.classList.contains('entering')));
    platesBox.classList.toggle('off', !show);
    if (!show) { for (var q = 0; q < plates.length; q++) if (plates[q]) plates[q].placed = false; plateSolve = null; return []; }
    var b = plateBands(), Wd = window.innerWidth, items = [], cam = WF.world.camera;
    cam.updateMatrixWorld();          // this frame's camera (updateCam just moved it; render() hasn't run yet)
    for (var i = 0; i < plates.length; i++) {
      var p = plates[i], a = actors[i]; if (!p || !a) continue;
      var c = battle.combatants[i];
      var gone = (!c.alive && (a.state === 'dead' || !a.mesh.visible));
      // anchor just over the top of the model (userData.height = its real bounds, halos / canopies included)
      _op.set(a.mesh.position.x, (a.mesh.userData.height || 2) * 1.02 + 0.12, a.mesh.position.z).project(cam);
      if (gone || _op.z > 1 || _op.z < -1) { p.node.style.visibility = 'hidden'; p.placed = false; continue; }
      p.node.style.visibility = '';
      var sx = (_op.x + 1) / 2 * Wd, sy = (1 - _op.y) / 2 * b.H;
      items.push({ i: i, p: p, ax: sx, ay: sy, w: p.w, h: p.h, px: p.placed ? p.tx : null, py: p.placed ? p.ty : null });
    }
    // keep inside the free band (below the enemy panels, above the card hand), off the HUD, never on each other.
    // The search runs at most every 0.25 s, or at once when a plate appeared / resized / its head moved > 20 px;
    // in between every plate keeps its offset from its head (the duel camera's gentle sway moves them together).
    var now = performance.now(), sig = items.map(function (it) { return it.i + ':' + it.w + 'x' + it.h; }).join(),
      moved = !plateSolve || plateSolve.sig !== sig || snap || items.some(function (it) { var o = plateSolve.at[it.i]; return !o || Math.abs(o.ax - it.ax) > 20 || Math.abs(o.ay - it.ay) > 20; });
    if (moved || now - plateSolve.t > 250) {
      solvePlates(items, { W: Wd, top: b.topPx + 4, bot: b.botPx - 4, obstacles: b.obstacles, gap: PLATE_GAP });
      plateSolve = { t: now, sig: sig, at: {} };
      items.forEach(function (it) { plateSolve.at[it.i] = { ax: it.ax, ay: it.ay, dx: it.x - it.ax, dy: it.y - it.ay }; });
    } else items.forEach(function (it) {
      var o = plateSolve.at[it.i];
      it.x = Math.max(6, Math.min(Wd - 6 - it.w, it.ax + o.dx));
      it.y = Math.max(b.topPx + 4, Math.min(b.botPx - 4 - it.h, it.ay + o.dy));
    });
    var k2 = Math.min(1, (dt || 0.016) * 14);
    items.forEach(function (it) {
      var p = it.p;
      if (!p.placed || snap) { p.x = it.x; p.y = it.y; p.placed = true; }
      else { p.x += (it.x - p.x) * k2; p.y += (it.y - p.y) * k2; }
      p.tx = it.x; p.ty = it.y; p.ax = it.ax; p.ay = it.ay;
      p.node.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
      // the little pointer under the plate aims at the head even when the plate was pushed aside
      var nx = Math.max(10, Math.min(p.w - 10, it.ax - p.x));
      p.node.style.setProperty('--nx', nx.toFixed(1) + 'px');
      p.node.classList.toggle('lifted', it.ay - (p.y + p.h) > 26);
    });
    return items;
  }

  // ---------------- pip surge (+2 pips in one round) ----------------
  function surging(i) { return (surgeUntil[i] || 0) > performance.now(); }
  function pipSurgeFx(i) {
    var a = actors[i]; if (!a || !center) return;
    surgeUntil[i] = performance.now() + 1600 * pace;
    var toC = new THREE.Vector3(center.x - a.home.x, 0, center.z - a.home.z).normalize();
    var at = new THREE.Vector3(a.home.x + toC.x * 1.6, 0, a.home.z + toC.z * 1.6);
    try { var b1 = WF.models.burst('#ffd36b', 'buff'); b1.position.copy(at); WF.world.addFx(b1); } catch (e) { /* cosmetic */ }
    // the two newest pip orbs pop in with a flare
    var sm = statusMeshes[i];
    if (sm && sm.pips.length) {
      var pops = sm.pips.slice(-2);
      pops.forEach(function (m, k) {
        var o = new THREE.Object3D(), t = -k * 0.12, base = m.scale.x || 1;
        o.userData.update = function (dt) {
          t += dt; if (!m.parent) return false;
          var u = Math.max(0, t) / 0.55;
          if (u >= 1) { m.scale.setScalar(base); return false; }
          m.scale.setScalar(base * (1 + 1.6 * Math.sin(Math.min(1, u) * Math.PI) * (1 - u * 0.4)));
          m.position.y = 0.14 + 0.45 * Math.sin(u * Math.PI);
          return true;
        };
        WF.world.addFx(o);
      });
    }
    WF.ui.floatText('+2 Pips!', new THREE.Vector3(at.x, 0.9, at.z), '#ffe27a', 1.35, 'surge-txt');
    WF.sfx.play('chime_sun');
    log('&nbsp;&nbsp;' + U.esc(battle.combatants[i].name) + ' <b style="color:#ffd36b">Pip Surge!</b> +2 pips this round');
  }

  function refreshUI() {
    if (!battle || !root) return;
    // Enemies (v1.2 WS1: panels left-to-right in the order the enemies stand on screen)
    var eh = '', order = enemyOrder();
    for (var oi = 0; oi < order.length; oi++) {
      var i = order[oi];
      var c = view(i), f = Math.max(0, c.hp) / c.maxHp, ed = D().enemies[c.enemyId] || {}, elite = !!ed.elite && !c.boss;
      eh += '<div class="cb-enemy' + (c.alive ? '' : ' dead') + (targeting ? ' targetable' : '') + (c.boss ? ' boss' : '') + (elite ? ' elite' : '') + (pickHover === i ? ' hover' : '') + '" data-idx="' + i + '">' +
        '<div class="nm">' + (targeting && c.alive ? '<span class="tkey">' + aliveRank(i) + '</span>' : '') + (c.boss ? '<span class="boss-crown" title="Boss">♛</span>' : '') + (elite ? '<span class="elite-star" title="Elite">★</span>' : '') + U.esc(c.name) + ' <small>Lv ' + c.level + '</small></div>' +
        affinityHTML(c.enemyId) +
        '<div class="bar"><div class="fill" style="width:' + (f * 100) + '%;background:' + hpColor(f) + '"></div><span>' + Math.max(0, c.hp) + ' / ' + c.maxHp + '</span></div>' +
        '<div class="pips' + (surging(i) ? ' surge' : '') + '">' + pipsHTML(c.pips, c.bright) + '</div>' +
        '<div class="status">' + statusIconsHTML(c) + '</div>' +
        '</div>';
    }
    el('cb-enemies').innerHTML = eh;
    Array.prototype.forEach.call(document.querySelectorAll('.cb-enemy'), function (node) { wireTarget(node, +node.getAttribute('data-idx')); });
    renderPlates();

    // Player
    var pc = view(mySeat), sc = D().schools[pc.school];
    var pf = Math.max(0, pc.hp) / pc.maxHp, mf = pc.maxMana ? pc.mana / pc.maxMana : 0;
    el('cb-player').innerHTML =
      '<div class="nm" style="color:' + sc.color + '">' + U.esc(pc.name) + ' <small>Lv ' + pc.level + ' ' + sc.name + '</small></div>' +
      '<div class="bar"><div class="fill" style="width:' + (pf * 100) + '%;background:' + hpColor(pf) + '"></div><span>❤ ' + Math.max(0, pc.hp) + ' / ' + pc.maxHp + '</span></div>' +
      '<div class="bar mana"><div class="fill" style="width:' + (mf * 100) + '%"></div><span>✦ ' + pc.mana + ' / ' + pc.maxMana + ' mana</span></div>' +
      '<div class="pips' + (surging(mySeat) ? ' surge' : '') + '">' + pipsHTML(pc.pips, pc.bright) + '<span class="pip-n">' + pc.pips + (pc.bright ? ' (◆' + pc.bright + ' bright)' : '') + '</span></div>' +
      '<div class="status">' + statusIconsHTML(pc) + '</div>' + partyPanelHTML();
    // v2.0 WS-C: while choosing a wizard for a heal / blade / shield, your own panel is you
    var cbp = el('cb-player');
    cbp.classList.toggle('targetable', !!(targeting && targeting.ally));
    cbp.onclick = (targeting && targeting.ally) ? function () { selectTarget(mySeat); } : null;
    // v2.0: the planning timer sits at the top of the action column (in flow), so it can never cover Spell Scrolls
    if (net && !el('cb-timer')) { var tm = document.createElement('div'); tm.id = 'cb-timer'; var acts = el('cb-actions'); if (acts) acts.insertBefore(tm, acts.firstChild); else root.appendChild(tm); }
    if (net && el('cb-timer')) el('cb-timer').classList.toggle('hidden', !!(busy || net.playing));

    renderHand();
    renderHint();
  }

  // Hand of cards (separate so hovering an enemy can re-preview without rebuilding panels)
  function renderHand() {
    if (!battle || !root) return;

    // Hand (the old hand stays visible until the new one is drawn)
    var hand = el('cb-hand');
    hand.innerHTML = '';
    ptr.rx = ptr.x; ptr.ry = ptr.y;      // where the cursor rests while this hand appears
    var cards = handView || myHand();
    var tgt = (hoverEnemy != null && battle.combatants[hoverEnemy] && battle.combatants[hoverEnemy].alive) ? hoverEnemy : firstAliveEnemy();
    cards.forEach(function (hc, idx) {
      var chk = busy ? { ok: false } : battle.canCast(hc.cardId, mySeat);
      // v2.1 A7: no live damage preview on the cards (opts.pv dropped)
      var node = WF.ui.cardEl(hc.cardId, { disabled: !chk.ok || busy, reason: busy ? null : chk.reason, key: idx + 1 });
      node.removeAttribute('title');     // the custom tooltip explains everything
      node.setAttribute('data-uid', hc.uid);
      if (!dealt[hc.uid] && !(entry && !entry.done)) {     // freshly drawn: deal it in (W101-style flip)
        dealt[hc.uid] = true;
        if (!reduceMotion()) { node.classList.add('deal'); node.style.setProperty('--d', (idx * 0.07 * pace).toFixed(3) + 's'); }
        if (idx === 0) WF.sfx.play('card_deal');
      }
      if (targeting && targeting.uid === hc.uid) node.classList.add('selected');
      node.onclick = function () { if (!busy) chooseCard({ type: 'cast', uid: hc.uid, cardId: hc.cardId }); };
      node.oncontextmenu = function (e) {
        e.preventDefault();
        if (busy) return;
        if (battle.discard(hc.uid, mySeat)) { netDiscard(hc.uid); WF.sfx.play('card_draw'); hideTip(); if (targeting && targeting.uid === hc.uid) targeting = null; refreshUI(); }
      };
      // B1: a hand re-rendered under a resting cursor must not pop a tooltip; only real pointer movement does
      var hover = function (e) {
        if (targeting || busy || hudHidden) return;
        if (atRest(e)) return;
        showPreview({ type: 'cast', uid: hc.uid, cardId: hc.cardId }, tgt, node);
      };
      node.onmouseenter = function (e) { if (!atRest(e)) WF.sfx.play('hover'); hover(e); };
      node.onmousemove = function (e) { if (el('cb-tip').classList.contains('hidden')) hover(e); };
      node.onmouseleave = function () { if (!targeting) hideTip(); };
      hand.appendChild(node);
    });
  }

  // v1.2 WS1: target numbers (1, 2, 3...) follow the on-screen order, left to right
  function aliveRank(idx) {
    var l = aliveList(), k = l.indexOf(idx);
    return k >= 0 ? k + 1 : '';
  }
  function aliveList() { return enemyOrder().filter(function (i) { return battle.combatants[i] && battle.combatants[i].alive; }); }

  // Light, W101-style coaching in the hint line during your first duels
  function coachTip() {
    var p = WF.state.player, pc = battle.combatants[mySeat], f = p.stats.fights || 0, r = battle.round || 1;
    p.tips = p.tips || {};
    if (pc.bright && (!p.tips.bright || p.tips.bright === f + ':' + r)) {
      p.tips.bright = f + ':' + r;
      return '<b>Bright pip!</b> ◆ It counts as 2 pips for ' + U.esc(schoolName(pc.school)) + ' and Lumen spells.';
    }
    if (f === 1) {
      if (r === 1) return 'You gain a <b>pip</b> every round. A card’s gold dots are its pip cost — it costs that much <b>mana</b> too.';
      if (r === 2) return 'Stack <b>blades</b> and <b>traps</b> before a big hit, and aim at a foe weak to your school.';
      if (r === 3) return 'Right-click a card you don’t need to <b>discard</b> it (or Shift+1–7). Your deck doesn’t refill: every card you discard is gone for this duel.';
    }
    if (f === 2 && r <= 2) return 'Cast <b>blades ⚔</b> on yourself and <b>traps ⬡</b> on the enemy first, then attack.';
    return '';
  }

  function renderHint() {
    var hint = el('cb-hint');
    if (!hint) return;
    if (busy) hint.textContent = '';
    else if (targeting) hint.innerHTML = 'Choose a target for <b>' + U.esc(D().cards[targeting.cardId].name) + '</b> — ' + (targeting.ally ? 'click a wizard of your party or press its number' : 'click an enemy or press its number') + ' &middot; <a href="#" id="cb-cancel">cancel (Esc)</a>';
    else if (net && net.waiting) hint.innerHTML = netWaitHTML();
    else hint.innerHTML = coachTip() || 'Pick a spell (1–7) &middot; <span class="dim">Right-click / Shift+number: discard &middot; T: Spell Scrolls &middot; P: pass</span>';
    var cancel = el('cb-cancel');
    if (cancel) cancel.onclick = function (e) { e.preventDefault(); targeting = null; hideTip(); refreshUI(); };

    // Spell Scrolls (treasure cards) live on the Battle object
    var tcs = myTcs(), tcn = 0;
    Object.keys(tcs).forEach(function (k) { tcn += tcs[k]; });
    el('cb-tc-n').textContent = '(' + tcn + ')';
    var idle = busy || !!(net && net.waiting);    // v2.0 WS-C: locked in, waiting for the party
    el('cb-pass').disabled = idle;
    el('cb-flee').disabled = idle;
    // v2.1 A5: decks are finite. Cards left in the deck, and a clear "out of cards" state
    var left = myDeckLeft(), dry = !busy && battle.outOfCards && battle.outOfCards(mySeat);
    var dk = el('cb-deck');
    if (dk) {
      dk.innerHTML = '<b>' + left + '</b> card' + (left === 1 ? '' : 's') + ' left in your deck';
      dk.classList.toggle('low', left > 0 && left <= 3);
      dk.classList.toggle('empty', left === 0);
    }
    el('cb-flee').title = 'Leave the duel (no rewards, no penalty)';
    el('cb-flee').classList.toggle('btn-ghost', !dry);
    if (dry && !targeting && !(net && net.waiting)) hint.innerHTML = '<b class="cb-dry">Out of cards!</b> Your deck is empty: <b>Pass</b>' + (tcn ? ', use a <b>Spell Scroll</b>' : '') + ' or <b>Flee</b>.';
    el('cb-tc').disabled = idle || tcn === 0;
    if (!el('cb-tc-panel').classList.contains('hidden')) renderTC();
  }

  function firstAliveEnemy() {
    var l = aliveList();
    return l.length ? l[0] : nP;
  }
  function aliveEnemies() { return battle.combatants.filter(function (c) { return !c.isPlayer && c.alive; }); }
  function needsTarget(card) { return ['damage', 'dot', 'trap', 'weakness'].indexOf(card.type) >= 0; }

  function chooseCard(a) {
    var card = D().cards[a.cardId];
    var chk = battle.canCast(a.cardId, mySeat);
    if (!chk.ok) { WF.ui.toast(U.esc(chk.reason || 'Not enough pips.'), 'warn'); WF.sfx.play('error'); return; }
    if (needsTarget(card) && aliveEnemies().length > 1) {
      targeting = a; WF.sfx.play('click'); hideTip(); refreshUI(); return;
    }
    // v2.0 WS-C: heals, blades, shields and absorbs may go on a party member
    if (allyTargetable(card) && aliveAllies().length > 1) {
      targeting = Object.assign({ ally: true }, a); WF.sfx.play('click'); hideTip(); refreshUI(); return;
    }
    act(Object.assign({}, a, { target: needsTarget(card) ? firstAliveEnemy() : mySeat }));
  }
  // ---- v2.0 WS-C: party helpers ----
  function allyTargetable(card) { return nP > 1 && ['heal', 'hot', 'blade', 'shield', 'absorb'].indexOf(card.type) >= 0; }
  function aliveAllies() { var out = []; for (var i = 0; i < nP; i++) { var c = battle.combatants[i]; if (c.alive && !c.fled) out.push(i); } return out; }
  function netPlanned(i) { return !!(net && net.planned && net.planned[i]); }
  function partyPlateHTML(i) {
    var c = view(i), sc = D().schools[c.school] || {}, f = Math.max(0, c.hp) / Math.max(1, c.maxHp);
    var rank = targeting && targeting.ally && c.alive ? aliveAllies().indexOf(i) + 1 : 0;
    return '<div class="pl-top">' + (rank ? '<span class="pl-key">' + rank + '</span>' : '') +
        '<span class="pl-sch" style="--c:' + (sc.color || '#ffd36b') + '">' + (sc.glyph || '✦') + '</span>' +
        '<span class="pl-name">' + U.esc(c.name) + '</span><span class="pl-lv">Lv ' + U.esc(String(c.level)) + '</span>' +
        (netPlanned(i) ? '<span class="pl-ok" title="Ready">✓</span>' : '') + '</div>' +
      '<div class="pl-bar"><i style="width:' + (f * 100).toFixed(1) + '%;background:' + hpColor(f) + '"></i><b>' + Math.max(0, c.hp) + ' / ' + c.maxHp + '</b></div>';
  }
  function partyPanelHTML() {
    if (nP <= 1) return '';
    var h = '<div class="cb-party">';
    for (var i = 0; i < nP; i++) {
      if (i === mySeat) continue;
      var c = view(i), sc = D().schools[c.school] || {}, f = Math.max(0, c.hp) / Math.max(1, c.maxHp);
      h += '<div class="cbp' + (c.alive ? '' : ' dead') + '"><span class="cbp-nm" style="color:' + (sc.color || '#fff') + '">' + U.esc(c.name) + (netPlanned(i) ? ' <b class="cbp-ok">✓</b>' : '') + '</span>' +
        '<span class="cbp-bar"><i style="width:' + (f * 100).toFixed(1) + '%;background:' + hpColor(f) + '"></i></span><span class="cbp-pips">' + c.pips + (c.bright ? '◆' + c.bright : '') + '</span></div>';
    }
    return h + '</div>';
  }
  function netWaitHTML() {
    var left = Math.max(0, Math.ceil(((net.deadline || 0) - performance.now()) / 1000));
    var names = (net.waitingSeats || []).map(function (i) { return battle.combatants[i] ? battle.combatants[i].name : '?'; });
    return '<b>Ready!</b> ⏳ ' + left + ' s &middot; <span class="dim">' + (names.length ? 'waiting for ' + U.esc(names.join(', ')) : 'the round begins…') + '</span>';
  }
  // discards: on the host they act on the live battle; a guest also tells the host (CV.startParty sets this)
  var netDiscard = function () { };

  function toggleTC() {
    var p = el('cb-tc-panel');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) renderTC();
  }
  function renderTC() {
    var p = el('cb-tc-panel'), tcs = myTcs();
    p.innerHTML = '<div class="tc-title">Spell Scrolls <small>(single use)</small> <a href="#" id="tc-close">close</a></div><div class="tc-list"></div>';
    var list = p.querySelector('.tc-list');
    Object.keys(tcs).forEach(function (cid) {
      if (!tcs[cid]) return;
      var chk = battle.canCast(cid, mySeat);
      var node = WF.ui.cardEl(cid, { disabled: !chk.ok || busy, reason: chk.reason, count: tcs[cid], tc: true });
      node.onclick = function () { if (!busy && chk.ok) { p.classList.add('hidden'); chooseCard({ type: 'tc', cardId: cid }); } };
      node.onmouseenter = function () { showPreview({ type: 'tc', cardId: cid }, firstAliveEnemy(), node); };
      node.onmouseleave = hideTip;
      list.appendChild(node);
    });
    el('tc-close').onclick = function (e) { e.preventDefault(); p.classList.add('hidden'); };
  }

  // Damage/heal preview: exactly how blades, traps, shields and affinities change this spell
  function showPreview(a, targetIdx, anchor) {
    if (busy || hudHidden) { hideTip(); return; }       // never over a cinematic / while a round animates
    var card = D().cards[a.cardId], tip = el('cb-tip');
    // v2.1 A7 (Jorge): no "damage after buffs" preview ("it makes the game a bit too easy"). The tooltip
    // shows the card as you cast it (Runeglass rank included). D19 (Jorge, Oct 21): only the card's
    // PRINTED accuracy, never changed by gear (the real hit chance in combat still uses gear).
    var shown = (WF.state.cardView ? WF.state.cardView(a.cardId).card : null) || card;
    var html = '<div class="tip-name" style="color:' + schoolColor(card.school) + '">' + U.esc(card.name) + '</div>';
    html += '<div class="tip-desc">' + WF.ui.cardDesc(shown) + (WF.ui.riderDesc && WF.ui.riderDesc(shown) ? ' ' + WF.ui.riderDesc(shown) : '') + '</div>';
    if (shown.acc != null) html += '<div class="tip-acc">Accuracy ' + Math.round(shown.acc) + '%</div>';
    var chk = battle.canCast(a.cardId, mySeat);
    if (!chk.ok && chk.reason) html += '<div class="tip-why">' + U.esc(chk.reason) + '</div>';
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - 270, r.left + r.width / 2 - 130)) + 'px';
      tip.style.top = '';
      tip.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    } else {
      tip.style.left = (window.innerWidth / 2 - 130) + 'px';
      tip.style.bottom = '';
      tip.style.top = '170px';
    }
  }
  function hideTip() { var t = el('cb-tip'); if (t) t.classList.add('hidden'); }

  // ------------------------------------------------------------------
  // Resolve a player action and animate the round
  // ------------------------------------------------------------------
  async function act(a) {
    if (busy || !battle || battle.result) return;
    if (net) { netAct(a); return; }        // v2.0 WS-C: a realm duel: lock in a plan, the host resolves the round
    // Snapshot what's on screen now; the round's events will update it step by step
    disp = battle.combatants.map(function (c) {
      return { hp: c.hp, maxHp: c.maxHp, mana: c.mana, maxMana: c.maxMana, pips: c.pips, bright: c.bright || 0, alive: c.alive,
        absorb: c.absorb, charms: c.charms.slice(), wards: c.wards.slice(), dots: c.dots.slice(), hots: c.hots.slice() };
    });
    handView = battle.hand.filter(function (h) { return h.uid !== a.uid; });
    deckView = battle.deckLeft ? battle.deckLeft(mySeat) : null;   // v2.1 A5: count before this round's draw
    if (a.type === 'cast') flyCard(a.uid);
    busy = true; targeting = null; hideTip();
    el('cb-tc-panel').classList.add('hidden');
    refreshUI();
    var events;
    try {
      events = battle.playerTurn(a.type === 'cast' ? { type: 'cast', uid: a.uid, target: a.target } :
        a.type === 'tc' ? { type: 'tc', cardId: a.cardId, target: a.target } : a);
    } catch (e) { console.error(e); events = []; }
    if (!events || !events.length) {
      if (battle.lastError) WF.ui.toast(U.esc(battle.lastError), 'warn');
      busy = false; disp = null; handView = null; deckView = null; refreshUI(); return;
    }
    try { await playEvents(events); } catch (e) { console.error(e); }
    disp = null; handView = null; deckView = null;
    syncAll();
    if (battle.result) { await finish(battle.result); return; }
    busy = false;
    refreshUI();
  }

  // the played card lifts out of the hand and flares away (CSS, cine.css)
  function flyCard(uid) {
    try {
      var node = document.querySelector('#cb-hand .card[data-uid="' + uid + '"]');
      if (!node || reduceMotion()) return;
      var r = node.getBoundingClientRect(), g = node.cloneNode(true);
      g.classList.remove('deal', 'selected'); g.classList.add('cast-fly');
      g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
      document.body.appendChild(g);
      setTimeout(function () { g.remove(); }, 900 * pace);
      WF.sfx.play('card_flip');
    } catch (e) { /* cosmetic only */ }
  }

  function actorPos(i, h) {
    var a = actors[i];
    return new THREE.Vector3(a.home.x, h != null ? h : (a.mesh.userData.height || 2) * 0.6, a.home.z);
  }
  function topOf(i, extra) { return actorPos(i, (actors[i].mesh.userData.height || 2) + (extra || 0.5)); }

  function setState(i, s, dur) { var a = actors[i]; if (!a || a.state === 'dead' || a.state === 'dying' || a.state === 'pose') return; a.state = s; a.stateT = dur; }
  // hold a pose (victory / defeat) until the duel closes
  function holdPose(i, pose) { var a = actors[i]; if (!a || a.state === 'dead') return; a.state = 'pose'; a.pose = pose; a.stateT = 1e9; }

  // v2.1 A3 (Jorge): "a wind-up animation of the wand that takes 1.5 seconds, then it should say
  // fizzle or the card should start the animation". Every caster (players, pets, enemies), every
  // cast and fizzle. Fixed real time (not scaled by pace, never skippable) so a realm stays in step.
  async function windUp(who, card) {
    var a = actors[who];
    var ms = Math.round(((WF.cine && WF.cine.WINDUP_S) || 1.5) * 1000);
    if (a) {
      setState(who, pickState(a.mesh, ['windup', 'taunt', 'cast']), ms / 1000 + 0.25);
      try {
        if (WF.models.castSigil) {
          var sg = WF.models.castSigil(schoolColor(card && card.school), { duration: ms / 1000 + 0.1, radius: 0.95 });
          sg.position.set(a.home.x, 0.04, a.home.z); WF.world.addFx(sg);
        }
      } catch (e) { console.error(e); }
      WF.sfx.play('windup');
    }
    await U.sleep(ms);
  }

  var curCast = null;   // { who, card, targets, cine }
  // wait for the running cinematic to finish (camera back home) before the next beat
  async function settleCine() {
    var h = curCine; curCine = null;
    if (h) { try { await h.done; } catch (e) { /* ignore */ } }
  }

  function cineSpec(who, card, targets, extra) {
    var a = actors[who];
    return {
      card: card.id || card, scene: WF.world.scene, camera: WF.world.camera,
      caster: a.mesh, casterPos: a.home, casterHeight: a.mesh.userData.height, isEnemy: !isP(who),
      targets: targets.map(function (i) { var t = actors[i]; return { id: i, obj: t.mesh, pos: t.home, height: t.mesh.userData.height }; }),
      home: function (P, L) { duelCam(0, P, L); }, look0: _lookCur.clone(), center: new THREE.Vector3(center.x, 0, center.z),
      mode: cineMode(), speed: speed, retime: !classicTiming, reduceMotion: reduceMotion(),
      setState: function (obj, st, dur) { for (var k = 0; k < actors.length; k++) if (actors[k].mesh === obj) { setState(k, st, dur); return; } },
      states: function (obj) { return statesOf(obj); },
      onShots: hideForShots, fizzle: !!(extra && extra.fizzle)
    };
  }
  // the moment a cast's effect lands on target idx (immediately when no cinematic)
  function landed(idx) {
    if (!curCast || !curCast.cine) return Promise.resolve();
    return curCast.cine.impactFor(idx);
  }
  async function playEvents(events) {
    curCast = null;
    for (var k = 0; k < events.length; k++) {
      var ev = events[k];
      try { await playEvent(ev); } catch (e) { console.error('event anim failed', ev, e); }
      if (ev.snap) disp = ev.snap;
      if (ev.t === 'draw' && (ev.who == null || ev.who === mySeat)) handView = ev.hand || null;   // v2.0 WS-C: only YOUR hand
      if (ev.t === 'draw' && (ev.who == null || ev.who === mySeat) && typeof ev.left === 'number') deckView = ev.left;   // v2.1 A5
      if (ev.t === 'pips' && ev.surge) surgeUntil[ev.who] = performance.now() + 1600 * pace;
      refreshUI();
      if (ev.t === 'pips' || ev.t === 'cast' || ev.t === 'death') rebuildPips(ev.who != null ? ev.who : ev.target);
      // v1.2 WS1: Pip Surge (V1.2-CONTRACT §2.1): 2 pips this round -> "+2" flourish on that pip ring
      if (ev.t === 'pips' && ev.surge) { try { pipSurgeFx(ev.who); } catch (e2) { console.error(e2); } await wait(420); }
    }
    await settleCine();
    curCast = null;
  }

  // Which visual to use for a damaging spell (v1.0 effects; used by quick mode / no cine)
  function fxKindFor(card) {
    if (card.fx) return card.fx;
    if (WF.models.spellFxKind) { try { return WF.models.spellFxKind(card.school, card.pips || 1, card.type, card.id); } catch (e) { /* fall through */ } }
    if (card.pips >= 5) return 'big';
    switch (card.school) {
      case 'emberstrike': return card.pips >= 3 ? 'meteor' : (card.type === 'dot' ? 'swarm' : 'bolt');
      case 'stoneward': return card.pips >= 2 ? 'spike' : 'bolt';
      case 'tidecaller': return card.pips >= 2 ? 'wave' : 'bolt';
      case 'hollow': return card.pips >= 3 ? 'beam' : 'bolt';
      case 'lumen': return 'beam';
    }
    return 'bolt';
  }

  function dmgClass(card, amount, onPlayer) {
    return 'dmg' + (amount >= 400 ? ' big' : '') + (onPlayer ? ' on-player' : '') + (card && card.school ? ' sc-' + card.school : '');
  }

  async function playEvent(ev) {
    var C = battle.combatants;
    switch (ev.t) {
      case 'round':
        await settleCine();
        WF.ui.clearFloats('speech');
        log('<span class="dim">— Round ' + ev.n + ' —</span>');
        if (ev.n > 1) banner('Round ' + ev.n, '#ffffff', 650 * pace);
        break;
      case 'pips':
        break;
      case 'draw':
        await settleCine();
        if (ev.who == null || ev.who === mySeat) WF.sfx.play('card_draw');
        break;
      case 'flee': {   // v2.0 WS-C: a party member leaves the duel alone
        await settleCine();
        speech(ev.who, 'Fled!', '#dddddd', true);
        log(U.esc(C[ev.who].name) + ' escapes from the duel.');
        clearStatus(ev.who);
        var fa = actors[ev.who]; if (fa) { fa.state = 'dead'; fa.native = false; }
        await wait(500);
        break;
      }
      case 'cast': {
        await settleCine();
        var card = D().cards[ev.card];
        var who = C[ev.who];
        var tg = (ev.targets && ev.targets.length) ? ev.targets : [ev.who];
        await windUp(ev.who, card);   // v2.1 A3
        curCast = { who: ev.who, card: card, targets: tg, cine: null };
        log('<b style="color:' + schoolColor(who.school) + '">' + U.esc(who.name) + '</b> casts <b style="color:' + schoolColor(card.school) + '">' + U.esc(card.name) + '</b>');
        if (hasCine()) {
          try { curCast.cine = curCine = WF.cine.play(cineSpec(ev.who, card, tg)); cineStarted(); }
          catch (e) { console.error(e); curCast.cine = curCine = null; }
        }
        if (!curCast.cine) {
          // fallback: v1.0 cast presentation (v1.2: anticipation x1.5 like the cinematics)
          setState(ev.who, 'cast', 0.9 * castMul);
          speech(ev.who, card.name + '!', schoolColor(card.school), true);
          WF.sfx.play('cast_' + card.school);
          if (WF.models.castSigil) { var sg = WF.models.castSigil(schoolColor(card.school)); sg.position.set(actors[ev.who].home.x, 0.04, actors[ev.who].home.z); WF.world.addFx(sg); }
          await U.sleep((card.pips >= 5 ? 650 : 480) * castMul);
        }
        break;
      }
      case 'fizzle': {
        await settleCine();
        var fc = D().cards[ev.card];
        await windUp(ev.who, fc);   // v2.1 A3
        log(U.esc(C[ev.who].name) + '’s ' + U.esc(fc.name) + ' <i>fizzled</i>!');
        if (hasCine()) {
          var fh = null;
          try { fh = curCine = WF.cine.play(cineSpec(ev.who, fc, [ev.who], { fizzle: true })); cineStarted(); } catch (e) { console.error(e); }
          if (fh) await fh.impact;
        } else { setState(ev.who, 'cast', 0.6 * castMul); await U.sleep(250 * (castMul - 1) * 2); burst(actorPos(ev.who), '#9a9a9a', 'fizzle'); WF.sfx.play('fizzle'); }
        WF.ui.floatText('Fizzle!', topOf(ev.who, 0.7), '#c8c8c8', 1.3, 'fizzle-txt');
        await wait(curCine ? 250 : 700);
        await settleCine();
        break;
      }
      case 'damage': {
        var dc = D().cards[ev.card] || {}, col = schoolColor(dc.school);
        if (curCast && curCast.cine && curCast.card === dc) await landed(ev.target);
        else if (!curCast || !curCast.cine) {
          if (dc.type === 'aoe' && curCast && curCast.card === dc && curCast.targets.length > 1) {
            if (!curCast.hits) { curCast.hits = {}; curCast.targets.forEach(function (t, i) { curCast.hits[t] = spellHit(ev.who, t, dc, col, { aoe: true, delay: i * 0.08 }); }); }
            await (curCast.hits[ev.target] || spellHit(ev.who, ev.target, dc, col));
          } else await spellHit(ev.who, ev.target, dc, col);
        }
        hitReact(ev.target, ev.amount);
        WF.sfx.play(ev.amount >= 400 ? 'hit_big' : 'hit');
        var onPlayer = ev.target === 0;
        WF.ui.floatText('-' + ev.amount, topOf(ev.target, 0.65), onPlayer ? '#ff6a4a' : '#fff3d0', ev.amount >= 400 ? 2.7 : 2.1, dmgClass(dc, ev.amount, onPlayer));
        if (ev.absorbed) WF.ui.floatText('(' + ev.absorbed + ' absorbed)', actorPos(ev.target, 1.2), '#cfe8ff', 1.0);
        var mods = (ev.mods || []).filter(function (m) { return typeof m === 'string' || (m.source !== 'stat' && m.source !== 'resist'); })
          .map(function (m) { return typeof m === 'string' ? m : m.label; }).filter(Boolean);
        log('&nbsp;&nbsp;→ ' + ev.amount + ' damage to ' + U.esc(C[ev.target].name) + (ev.absorbed ? ' (' + ev.absorbed + ' absorbed)' : '') + (mods.length ? ' <span class="dim">(' + U.esc(mods.join(', ')) + ')</span>' : ''));
        if (ev.snap) disp = ev.snap;
        rebuildStatus(ev.target); rebuildStatus(ev.who);
        await wait(curCast && curCast.cine ? 180 : 360);
        break;
      }
      case 'heal':
        await landed(ev.target);
        if (!curCast || !curCast.cine || curCast.card.type === 'damage' || curCast.card.type === 'aoe') burst(actorPos(ev.target, 1.0), '#6fff9a', 'heal');
        WF.ui.floatText('+' + ev.amount, topOf(ev.target, 0.65), '#6fff9a', 1.9, 'heal-num');
        WF.sfx.play('heal');
        log('&nbsp;&nbsp;→ ' + U.esc(C[ev.target].name) + ' heals ' + ev.amount);
        await wait(curCast && curCast.cine ? 250 : 450);
        break;
      case 'charm':
      case 'ward': {
        var e = ev.effect || {};
        await landed(ev.target);
        if (ev.blocked) {
          WF.ui.floatText('Full (6 max)', topOf(ev.target, 0.9), '#cccccc', 1.0);
          log('&nbsp;&nbsp;→ ' + U.esc(C[ev.target].name) + ' has no room for ' + U.esc(e.name));
          await wait(320);
          break;
        }
        var bad = e.kind === 'weakness' || e.kind === 'trap';
        if (!curCast || !curCast.cine) burst(actorPos(ev.target), e.kind === 'shield' ? '#7fd6ff' : (e.kind === 'weakness' ? '#9a9a9a' : schoolColor(e.school)), 'buff');
        WF.sfx.play(e.kind === 'shield' ? 'shield' : (bad ? 'debuff' : 'buff'));
        if (bad && curCast && ev.target !== curCast.who) setState(ev.target, 'hit', 0.35);
        var sign = (e.kind === 'weakness' || e.kind === 'shield') ? '-' : '+';
        WF.ui.floatText(e.name + ' ' + sign + e.value + '%', topOf(ev.target, 0.9), e.kind === 'shield' ? '#a8e4ff' : (bad ? '#e0a0ff' : '#ffe38a'), 1.15, 'buff-txt');
        log('&nbsp;&nbsp;→ ' + U.esc(C[ev.target].name) + ' gains ' + U.esc(e.name) + ' (' + sign + e.value + '%)');
        if (ev.snap) disp = ev.snap;
        rebuildStatus(ev.target);
        await wait(curCast && curCast.cine ? 220 : 420);
        break;
      }
      case 'absorb':
        await landed(ev.target);
        if (!curCast || !curCast.cine) burst(actorPos(ev.target), '#cfe8ff', 'buff');
        WF.sfx.play('shield');
        WF.ui.floatText('Absorb ' + ev.value, topOf(ev.target, 0.9), '#cfe8ff', 1.15, 'buff-txt');
        if (ev.snap) disp = ev.snap;
        rebuildStatus(ev.target);
        await wait(curCast && curCast.cine ? 200 : 380);
        break;
      case 'consume':
        if (ev.snap) disp = ev.snap;
        rebuildStatus(ev.target);
        break;
      case 'dot':
      case 'hot': {
        var ef = ev.effect || {};
        await landed(ev.target);
        WF.ui.floatText((ev.t === 'dot' ? '♨ ' : '✚ ') + (ef.name || '') + (ef.amt ? ' ' + ef.amt + '/round' : ''), actorPos(ev.target, 1.6), ev.t === 'dot' ? '#ffa060' : '#8affb0', 0.95);
        await wait(250);
        break;
      }
      case 'tick':
        log('&nbsp;&nbsp;' + (ev.kind === 'dot' ? '♨ ' : '✚ ') + U.esc(C[ev.target].name) + (ev.kind === 'dot' ? ' takes ' : ' heals ') + ev.amount + (ev.name ? ' <span class="dim">(' + U.esc(ev.name) + ')</span>' : ''));
        if (ev.kind === 'dot') {
          burst(actorPos(ev.target), '#ff7a3d', 'hit');
          WF.ui.floatText('-' + ev.amount, topOf(ev.target, 0.5), '#ff9a4a', 1.6, 'dmg tick');
          hitReact(ev.target, ev.amount * 0.5);
          WF.sfx.play('hit');
        } else {
          burst(actorPos(ev.target), '#6fff9a', 'heal');
          WF.ui.floatText('+' + ev.amount, topOf(ev.target, 0.5), '#6fff9a', 1.5, 'heal-num');
          WF.sfx.play('heal');
        }
        await wait(380);
        break;
      case 'phase': {
        await settleCine();
        var ed = D().enemies[C[ev.who].enemyId] || {};
        var bl = (lore().bossLines || {})[C[ev.who].enemyId] || {};
        camAnim.focus = reduceMotion() ? null : ev.who; camAnim.focusT = 0;
        banner((ed.name || C[ev.who].name) + ' grows furious!', '#ff9a3c', 1400);
        WF.sfx.play('boss_phase');
        setState(ev.who, pickState(actors[ev.who].mesh, ['taunt', 'cast']), 1.4);
        listenSkip(true);
        var phSay = ev.say ? U.fillText(ev.say) : '', phLine = bl.phase ? U.fillText(bl.phase) : '';
        if (phSay) { speech(ev.who, phSay); if (phLine) { await waitSpeech(phSay, 1700); WF.ui.clearFloats('speech'); } }
        if (phLine && !skipIntro) speech(ev.who, phLine);
        if (WF.models.phaseAura && !statusMeshes[ev.who].aura) {
          var aura = WF.models.phaseAura(ed.color || '#a879ff', { height: (actors[ev.who].mesh.userData.height || 3) * 1.1 });
          WF.world.scene.add(aura);
          statusMeshes[ev.who].aura = aura;
        }
        await waitSpeech(phLine || phSay, 2000);   // v2.1 A2: the free cast waits for the line
        listenSkip(false);
        camAnim.focus = null;
        WF.ui.clearFloats('speech');
        break;
      }
      case 'summon': {   // v2.1 D15: helpers step out of a sigil next to their summoner
        await settleCine();
        for (var si = 0; si < (ev.idxs || []).length; si++) {
          var sIdx = ev.idxs[si];
          if (!C[sIdx]) continue;
          var sd = D().enemies[C[sIdx].enemyId] || {}, sm = stageHelper(sIdx);
          if (!sm) continue;
          burst(actorPos(sIdx), sd.color || '#a879ff', 'buff');
          setState(sIdx, pickState(sm, ['taunt', 'cast']), 1.2);
          log('<b>' + U.esc(C[sIdx].name) + '</b> joins the duel!');
        }
        bandsCache = null; plateSolve = null;
        WF.sfx.play('summon');
        if (ev.snap) disp = ev.snap;
        syncAll();
        await wait(900);
        break;
      }
      case 'death': {
        var a = actors[ev.target];
        a.state = 'dying'; a.dieT = 0; a.stateT = 0;
        clearStatus(ev.target);
        WF.sfx.play(isP(ev.target) ? 'death' : 'enemy_defeat');
        log('<b>' + U.esc(C[ev.target].name) + '</b> is defeated!');
        await wait(650);
        break;
      }
      case 'pass':
        await settleCine();
        speech(ev.who, 'Pass', '#dddddd', true);
        log(U.esc(C[ev.who].name) + (ev.auto ? ' ran out of time and passes.' : ' passes.'));
        await wait(320);
        break;
      case 'end':
        await settleCine();
        break;
      default:
        break;
    }
  }

  // hit reaction: flinch state + a knock-back slide scaled by the damage
  function hitReact(i, amount) {
    var a = actors[i]; if (!a || a.state === 'dying' || a.state === 'dead') return;
    setState(i, 'hit', amount >= 400 ? 0.6 : 0.45);
    if (!reduceMotion()) a.kick = Math.min(0.75, 0.18 + (amount || 0) / 900);
  }

  // ------------------------------------------------------------------
  // VFX helpers
  // ------------------------------------------------------------------
  function burst(pos, color, kind) {
    var b = WF.models.burst(color, kind || 'hit');
    b.position.set(pos.x, 0, pos.z);     // bursts are authored to sit at the combatant's feet
    WF.world.addFx(b);
  }

  // Plays the spell's travel/impact effect; resolves when the hit lands
  function spellHit(from, to, card, color, extra) {
    if (!WF.models.spellFx) return projectile(from, to, color);
    return new Promise(function (resolve) {
      var fx;
      try {
        var o = { pips: card.pips || 1, school: card.school, targetHeight: actors[to].mesh.userData.height || 2 };
        if (extra) { o.aoe = !!extra.aoe; o.delay = extra.delay || 0; }
        fx = WF.models.spellFx(fxKindFor(card), color, actorPos(from, 1.9), actorPos(to), o);
      } catch (e) { console.error(e); resolve(projectile(from, to, color)); return; }
      var impact = (fx.userData.impact != null ? fx.userData.impact : 0.45);
      // v1.2: effects always play at their natural speed (the cast is lengthened by anticipation, not slow motion)
      WF.world.addFx(fx);
      if ((card.pips || 0) >= 5 && !reduceMotion()) { camAnim.focus = to; camAnim.focusT = 0; setTimeout(function () { camAnim.focus = null; }, impact * 1000 + 500 * castMul); }
      setTimeout(resolve, impact * 1000);
    });
  }

  function projectile(from, to, color) {
    return new Promise(function (resolve) {
      var p = WF.models.projectile(color);
      var a = actorPos(from, 1.9), b = actorPos(to);
      p.position.copy(a);
      var t = 0, dur = 0.45, done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      p.userData.update = function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        p.position.lerpVectors(a, b, k);
        p.position.y += Math.sin(k * Math.PI) * 1.2;
        if (k >= 1) { finish(); return false; }
        return true;
      };
      WF.world.addFx(p);
      setTimeout(finish, dur * 1000 + 600);   // safety if the frame loop stalls
    });
  }

  // Make every 3D indicator match the live battle state
  function syncAll() {
    if (!battle) return;
    for (var i = 0; i < battle.combatants.length; i++) {
      if (battle.combatants[i].alive) { rebuildStatus(i); rebuildPips(i); } else clearStatus(i);
    }
  }

  function removeMesh(m) { if (m) { if (m.parent) m.parent.remove(m); dispose(m); } }

  function clearStatus(i) {
    var sm = statusMeshes[i];
    if (!sm) return;
    sm.charms.concat(sm.wards, sm.pips).forEach(function (m) { if (m.parent) m.parent.remove(m); if (!m.userData.shared) dispose(m); });
    removeMesh(sm.absorb); removeMesh(sm.aura);
    sm.charms = []; sm.wards = []; sm.pips = []; sm.absorb = null; sm.aura = null;
  }

  // 3D orbiting icons for blades (above head) and traps/shields (around feet)
  function rebuildStatus(i) {
    var c = view(i), sm = statusMeshes[i], scene = WF.world.scene;
    if (!c || !sm) return;
    sm.charms.concat(sm.wards).forEach(removeMesh);
    removeMesh(sm.absorb);
    sm.charms = (c.charms || []).map(function (e) {
      var m = WF.models.charmIcon(e.kind === 'weakness' ? '#9a9a9a' : schoolColor(e.school), e.kind);
      scene.add(m); return m;
    });
    sm.wards = (c.wards || []).map(function (e) {
      var m = WF.models.charmIcon(e.kind === 'shield' ? '#7fd6ff' : schoolColor(e.school), e.kind);
      scene.add(m); return m;
    });
    sm.absorb = null;
    if (c.absorb > 0) {
      sm.absorb = WF.models.charmIcon('#cfe8ff', 'absorb');
      sm.absorb.scale.setScalar(4.5);
      scene.add(sm.absorb);
    }
  }

  function pipMesh(bright) {
    if (WF.models.pipMesh) { var m = WF.models.pipMesh(bright); m.userData.shared = true; return m; }
    if (!PIP_GEO) {
      PIP_GEO = new THREE.SphereGeometry(0.13, 10, 8);
      PIP_MAT = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
      BRIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
    }
    var mm = new THREE.Mesh(PIP_GEO, bright ? BRIGHT_MAT : PIP_MAT);
    if (bright) mm.scale.setScalar(1.35);
    mm.userData.shared = true;
    return mm;
  }

  // Little glowing pip orbs in front of each duelist
  function rebuildPips(i) {
    var sm = statusMeshes[i];
    if (!sm || !battle) return;
    var c = view(i);
    sm.pips.forEach(function (m) { if (m.parent) m.parent.remove(m); });
    sm.pips = [];
    if (!c || !c.alive) return;
    var a = actors[i];
    var toC = new THREE.Vector3(center.x - a.home.x, 0, center.z - a.home.z).normalize();
    var side = new THREE.Vector3(-toC.z, 0, toC.x);
    var bright = c.bright || 0;
    for (var k = 0; k < c.pips; k++) {
      var g = pipMesh(k < bright);
      var off = (k - (c.pips - 1) / 2) * 0.36;
      g.position.set(a.home.x + toC.x * 1.6 + side.x * off, 0.14, a.home.z + toC.z * 1.6 + side.z * off);
      WF.world.scene.add(g);
      sm.pips.push(g);
    }
  }

  function banner(text, color, ms) {
    var b = el('cb-banner');
    if (!b) return;
    b.textContent = text; b.style.color = color || '#fff';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(function () { b.classList.remove('show'); }, ms || 900);
  }

  function speech(i, text, color, short) {
    var a = actors[i]; if (!a) return;
    WF.ui.floatText(text, new THREE.Vector3(a.home.x, (a.mesh.userData.height || 2) + 1.1, a.home.z), color || '#ffffff', short ? 1.15 : 2.2, short ? 'cast' : 'speech');
  }

  function log(html) {
    var l = el('cb-log'); if (!l) return;
    var d = document.createElement('div'); d.innerHTML = html;
    l.appendChild(d);
    while (l.children.length > 8) l.removeChild(l.firstChild);
  }

  // ------------------------------------------------------------------
  // End of duel
  // ------------------------------------------------------------------
  // v2.0 WS-E (R17): a tiny gold mote drifts from YOUR wizard into each freed boss, during the victory
  // pose. Works for classic and party duels (enemies are actors nP.., you are actors[mySeat]).
  function storyMotes() {
    if (!WF.story || !actors[mySeat]) return;
    try {
      WF.story.freedMotes(actors[mySeat].home, actors.slice(nP).map(function (a, k) {
        var c = battle.combatants[nP + k] || {};
        return { id: c.enemyId, pos: a.mesh.visible ? a.mesh.position : a.home, y: Math.max(0.8, (a.mesh.userData.height || 2) * 0.55) };
      }));
    } catch (e4) { /* cosmetic */ }
  }
  // Solo duels only (you are always combatant 0 here); realm party duels end in finishParty() below,
  // which settles YOUR seat through WF.net.realmSettle (verified in the v2.0 M6 pass).
  async function finish(result) {
    var S = WF.state, p = S.player, pc = battle.combatants[0];
    try {
      await settleCine();
      if (hasCine()) WF.cine.abortAll();
      // W101-style end pose: the winner cheers, a fallen wizard collapses
      if (result === 'win') {
        holdPose(0, 'victory');
        storyMotes();   // v2.0 WS-E (R17)
        camAnim.focus = null; resultCam = 'win'; hideForResult('win');
        listenSkip(true); await waitSkippable(1300); listenSkip(false);
      } else if (result === 'lose') {
        resultCam = 'lose'; camAnim.focus = null; hideForResult('lose');
        holdPose(0, 'defeat');
        for (var ei = nP; ei < actors.length; ei++) if (battle.combatants[ei].alive) holdPose(ei, pickState(actors[ei].mesh, ['taunt', 'cast']));
        listenSkip(true); await waitSkippable(1300); listenSkip(false);
      } else await wait(450);
      // Sync health / mana / used spell scrolls back to the wizard
      p.hp = Math.max(0, pc.hp); p.mana = Math.max(0, pc.mana);
      // v1.2 WS1: used Spell Scrolls leave the inventory AND the equipped deck's sideboard (V1.2-CONTRACT §2.4).
      // WS3 owns that bookkeeping (WF.state.consumeScrolls); before WS3 merges, the v1.1 inventory subtraction.
      var used = battle.tcsUsed || {}, consumed = false;
      if (typeof S.consumeScrolls === 'function') {
        try { S.consumeScrolls(used); consumed = true; } catch (e3) { console.error('consumeScrolls failed', e3); }
      }
      if (!consumed) Object.keys(used).forEach(function (cid) {
        p.tcs[cid] = Math.max(0, (p.tcs[cid] || 0) - used[cid]);
        if (!p.tcs[cid]) delete p.tcs[cid];
      });

      WF.ui.clearFloats();
      hideTip();
      if (root && result !== 'flee') root.classList.add('results');
      if (result === 'win') {
        WF.sfx.music(null);
        WF.sfx.play('victory');
        var enemyIds = group.def.enemies.slice();
        var loot = S.rollLoot(enemyIds, null, null, runMode() ? { gearMult: runMode().gearMult } : null);   // v2.1 D16
        var ups = S.applyLoot(loot);
        var qUpdates = [];
        enemyIds.forEach(function (eid) { qUpdates = qUpdates.concat(S.onKill(eid)); });
        var freed = enemyIds.map(function (eid) { var bl = (lore().bossLines || {})[eid]; return bl && bl.freed ? { id: eid, line: bl.freed } : null; }).filter(Boolean);
        WF.world.killGroup(group);
        S.save();
        await WF.ui.showResults({ result: 'win', loot: loot, levelUps: ups, quests: qUpdates, enemies: enemyIds, freed: freed });
        cleanup();
        ups.forEach(function (u) { WF.ui.levelUp(u); });
      } else if (result === 'lose') {
        WF.sfx.music(null);
        WF.sfx.play('defeat');
        p.stats.deaths++;
        await WF.ui.showResults({ result: 'lose' });
        group.cooldown = performance.now() + 4000;
        cleanup();
        var st = S.stats(), pr = D().progression;
        p.hp = Math.round(st.maxHp * pr.defeatHP);
        p.mana = Math.max(p.mana, Math.round(st.maxMana * (pr.defeatMana != null ? pr.defeatMana : 0.3)));
        S.save();
        WF.main.travel(S.homeZone(), null, true);
        return;
      } else {
        WF.ui.toast('You escaped!', 'info');
        group.cooldown = performance.now() + 6000;
        cleanup();
        WF.world.nudgePlayer(axis.x * 3.5, axis.z * 3.5);
      }
      S.save();
    } catch (e) {
      console.error('finish failed', e);
      if (CV.active) cleanup();
    }
  }

  function cleanup() {
    var W = WF.world;
    if (hasCine()) { try { WF.cine.abortAll(); } catch (e) { /* ignore */ } if (WF.cine.dim) WF.cine.dim(0); }
    curCine = null; curCast = null;
    finishEntry(); entry = null;
    listenCineSkip(false);
    listenPick(false);
    plates = []; platesBox = null; screenOrder = []; pickHover = null; surgeUntil = {}; bandsCache = null; plateSolve = null;
    document.body.style.removeProperty('--wf-pace');
    actors.forEach(function (a, i) { clearStatus(i); });
    // models that played their 'defeat' animation: clear the flag and return them to idle for next time
    actors.forEach(function (a, i) { var ud = a.mesh.userData; if (ud && ud.defeatDone) ud.defeatDone = false; if (ud && ud.anim && a.mesh.visible) { try { ud.anim(W.time + i, 'idle', 0.016); } catch (e) { /* ignore */ } } });
    removeMesh(ring); ring = null; pSigil = null;
    summoned.forEach(function (m) { removeMesh(m); }); summoned = [];   // v2.1 D15
    resultCam = null; resultShift = 0; resultCut = false; hudHidden = false; hudOffT = 0; pHidden = false;
    if (root) root.classList.remove('cine', 'results');
    hiddenProps.forEach(function (m) { m.visible = true; }); hiddenProps = [];
    restoreExtra();
    if (WF.world.restoreBatches) WF.world.restoreBatches();
    if (group) group.culled = false;
    hoverEnemy = null;
    listenSkip(false);
    // The player's avatar may have shrunk/vanished in a defeat animation: restore it
    var pm = W.player.mesh;
    pm.scale.setScalar(1); pm.position.y = 0; pm.visible = true;
    if (group) group.models.forEach(function (m) {
      m.scale.setScalar(1); m.position.y = 0;
      if (group.state !== 'dead') m.visible = true;
    });
    if (root) { root.classList.add('hidden'); root.innerHTML = ''; }
    battle = null; CV.active = false; busy = false; targeting = null; disp = null; handView = null; deckView = null;
    camAnim.focus = null;
    // v2.0 WS-C: party wizards built for this duel go away (the realm shows them in the world again)
    partyMeshes.forEach(function (m) { if (m && m.parent) m.parent.remove(m); if (m && !m.userData.realmAvatar) dispose(m); });
    partyMeshes = [];
    if (net) { clearTimeout(net.tickT); net = null; }
    nP = 1; mySeat = 0;
    if (WF.realm && WF.realm.duelClosed) { try { WF.realm.duelClosed(); } catch (eR) { console.error(eR); } }
    WF.ui.clearFloats();
    W.setTagsVisible(true);
    document.body.classList.remove('in-combat');
    // short grace period so a neighbouring camp can't pull you straight into another duel
    var nowT = performance.now();
    W.groups.forEach(function (g2) { if (Math.hypot(g2.x - W.player.x, g2.z - W.player.z) < 16) g2.cooldown = Math.max(g2.cooldown, nowT + 2000); });
    W.mode = 'explore';
    W.nudgePlayer(0, 0);
    W.snapCamera();
    WF.ui.showHUD(true);
    WF.ui.refresh();
    W.refreshMarkers();
    WF.sfx.music(W.zone ? W.zone.style : null);
  }

  // a resized window re-frames the duel (the HUD bands and the aspect ratio changed)
  var _rsT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(_rsT);
    _rsT = setTimeout(function () { bandsCache = null; if (CV.active && actors.length && root && !resultCam) solveDuelCam(); }, 250);
  });

  // Keyboard: 1-7 cast (or pick a target while targeting), Shift+1-7 discard,
  // P pass, T spell scrolls, Esc cancel / close
  window.addEventListener('keydown', function (e) {
    if (!CV.active || !battle || e.repeat) return;
    if (e.code === 'KeyH' || e.code === 'KeyJ') { WF.ui.toast('Potions can’t be used during a duel. Drink one before you fight.', 'warn'); return; }
    if (busy) return;
    var tcp = el('cb-tc-panel');
    if (e.code === 'Escape') {
      if (tcp && !tcp.classList.contains('hidden')) { tcp.classList.add('hidden'); return; }
      if (targeting) { targeting = null; hideTip(); refreshUI(); }
      return;
    }
    var d = /^(Digit|Numpad)([1-7])$/.exec(e.code), n = d ? +d[2] : 0;
    if (targeting && n) {
      var alive = targeting.ally ? aliveAllies() : aliveList();
      if (alive[n - 1] != null) { var a = targeting; targeting = null; act(Object.assign({}, a, { target: alive[n - 1] })); }
      return;
    }
    if (net && net.waiting) return;      // v2.0 WS-C: locked in for this round
    var hand0 = myHand();
    if (n && hand0[n - 1]) {
      var h = hand0[n - 1];
      if (e.shiftKey) { if (battle.discard(h.uid, mySeat)) { netDiscard(h.uid); WF.sfx.play('card_draw'); hideTip(); refreshUI(); } return; }
      chooseCard({ type: 'cast', uid: h.uid, cardId: h.cardId });
    } else if (e.code === 'KeyP') act({ type: 'pass' });
    else if (e.code === 'KeyT' && !el('cb-tc').disabled) toggleTC();
  });


  // =====================================================================
  // ---- v2.0 WS-C: REALM (party) DUELS. game/js/net/realmUI.js drives these; the rules run on the
  //  realm host (WF.net.RealmHost owns the WF.Battle), guests show a mirror battle. Every client plays
  //  the same event streams with the same fixed timing, then tells the host it is done ('ready');
  //  the host then opens a 30 s planning phase for everyone (docs/design/realms.md §6).
  //    CV.startParty({ mode, battle, mySeat, group, meshes, events, seq, ctl })
  //       ctl = { plan(action) -> bool, ready(seq), discard(uid), skip() }
  //    CV.netStream(events, seq)   CV.netTurn({ ms, waiting })   CV.netPlanned(idxs)
  //    CV.netSync()   CV.netEnd(end)   CV.netSkip()
  // =====================================================================
  CV.startParty = function (o) {
    if (CV.active) return false;
    battle = o.battle; nP = battle.players.length; mySeat = o.mySeat;
    net = { mode: o.mode, ctl: o.ctl, queue: [], playing: true, waiting: false, planned: {}, waitingSeats: [], deadline: 0,
      shown: null, handBefore: null, myPlan: null, end: null, partyMeshes: [] };
    partyMeshes = [];
    for (var i = 0; i < nP; i++) if (i !== mySeat) partyMeshes.push(o.meshes[i]);
    netDiscard = function (uid) { if (net && net.mode === 'guest' && net.ctl.discard) net.ctl.discard(uid); };
    WF.state.player.stats.fights++;
    stageDuel(o.group, { meshes: o.meshes });
    beginDuel(o.group, o.events, function () { netDone(o.seq, o.events); });
    return true;
  };
  function lastSnap(events) { for (var i = events.length - 1; i >= 0; i--) if (events[i].snap) return events[i].snap; return null; }
  // a stream finished animating here
  function netDone(seq, events) {
    if (!net) return;
    net.shown = lastSnap(events) || net.shown;
    disp = null; handView = null; deckView = null;
    net.playing = false;
    if (net.turnOpen) busy = false;          // the planning phase opened while we were still animating
    syncAll(); refreshUI();
    try { net.ctl.ready(seq); } catch (e) { console.error(e); }
    netPump();
  }
  function netPump() {
    if (!net || net.playing) return;
    if (net.queue.length) {
      var q = net.queue.shift();
      net.playing = true; busy = true; net.waiting = false; net.turnOpen = false; targeting = null; hideTip();
      disp = net.shown;                                   // show the round from where we left off
      if (net.handBefore) handView = net.handBefore.filter(function (h) { return !net.myPlan || h.uid !== net.myPlan.uid; });
      if (net.deckBefore != null) deckView = net.deckBefore;   // v2.1 A5
      net.myPlan = null; net.planned = {};
      refreshUI();
      (async function () {
        try { await playEvents(q.events); } catch (e) { console.error(e); }
        netDone(q.seq, q.events);
      })();
      return;
    }
    if (net.end) { var end = net.end; net.end = null; finishParty(end); }
  }
  CV.netStream = function (events, seq) { if (!net) return; net.queue.push({ events: events, seq: seq }); netPump(); };
  CV.netTurn = function (t) {
    if (!net) return;
    net.deadline = performance.now() + (t.ms || 0);
    net.waitingSeats = t.waiting || [];
    net.handBefore = myHand().map(function (h) { return { uid: h.uid, cardId: h.cardId }; });
    net.deckBefore = battle.deckLeft ? battle.deckLeft(mySeat) : null;   // v2.1 A5
    net.waiting = !battle._standing(mySeat);      // fallen / fled: nothing to choose
    net.turnOpen = true;
    if (!net.playing) { busy = false; disp = null; handView = null; deckView = null; refreshUI(); }
    netTick();
  };
  // countdown in the hint line while planning
  function netTick() {
    if (!net || net.playing || !CV.active) return;
    if (net.waiting && !busy) renderHint();
    else if (!busy && !targeting) { var hb = el('cb-hint'); if (hb) { var left = Math.max(0, Math.ceil((net.deadline - performance.now()) / 1000)); hb.setAttribute('data-timer', left); } }
    var tt = el('cb-timer');
    if (tt) { var l2 = Math.max(0, Math.ceil((net.deadline - performance.now()) / 1000)); tt.textContent = l2 + ' s'; tt.classList.toggle('low', l2 <= 5); }
    clearTimeout(net.tickT); net.tickT = setTimeout(netTick, 250);
  }
  CV.netPlanned = function (idxs) {
    if (!net) return;
    net.planned = {}; (idxs || []).forEach(function (i) { net.planned[i] = true; });
    net.waitingSeats = []; for (var i = 0; i < nP; i++) if (battle._standing(i) && !net.planned[i]) net.waitingSeats.push(i);
    if (!busy) { refreshUI(); }
    else renderPlates();
  };
  function netAct(a) {
    if (net.waiting || net.playing) return;
    var action = { type: a.type };
    if (a.uid != null) action.uid = a.uid;
    if (a.cardId != null && a.type === 'tc') action.cardId = a.cardId;
    if (a.target != null) action.target = a.target;
    var ok = false;
    try { ok = net.ctl.plan(action); } catch (e) { console.error(e); }
    if (!ok) { WF.ui.toast(U.esc((battle && battle.lastError) || 'The host did not accept that move.'), 'warn'); WF.sfx.play('error'); return; }
    if (a.type === 'cast') flyCard(a.uid);
    net.myPlan = action; net.waiting = true; net.planned[mySeat] = true;
    targeting = null; hideTip();
    el('cb-tc-panel').classList.add('hidden');
    WF.sfx.play('click');
    refreshUI();
  }
  // the host refused a guest's plan (e.g. the round had already resolved)
  CV.netRefused = function (reason) {
    if (!net || net.playing) return;
    net.waiting = false; net.myPlan = null; delete net.planned[mySeat];
    if (reason) WF.ui.toast(U.esc(reason), 'warn');
    refreshUI();
  };
  // v2.1 D16: the dungeon run's mode (Heroic) or null; only inside a dungeon instance
  function runMode() { var dg = WF.world && WF.world.dungeon; return dg && dg.active && dg.mode ? dg.mode() : null; }
  // v2.1 D15: put a summoned helper (combatant sIdx) on the field: mesh beside the enemy line in a
  // free spot, actor, status meshes and its nameplate. Used by the 'summon' event and by a realm
  // resync that brought in helpers this view never saw. -> the mesh (null if already staged)
  function stageHelper(sIdx) {
    var C = battle.combatants, c0 = C[sIdx];
    if (!c0 || actors[sIdx]) return null;
    if (!axis || !center) return null;
    var perpS = { x: -axis.z, z: axis.x }, used = [];
    for (var ui = nP; ui < actors.length; ui++) if (actors[ui]) used.push(Math.round(((actors[ui].home.x - center.x) * perpS.x + (actors[ui].home.z - center.z) * perpS.z) * 10) / 10);
    var sd = D().enemies[c0.enemyId] || {};
    var spreads = [-3, 3, 0, -6, 6, -9, 9], spr = spreads.filter(function (v) { return used.every(function (u) { return Math.abs(u - v) > 1.4; }); })[0];
    if (spr == null) spr = (used.length + 1) * 3;
    var hx2 = center.x - axis.x * duelR + perpS.x * spr, hz2 = center.z - axis.z * duelR + perpS.z * spr;
    var sm = WF.models.enemy(sd.model || 'sprite', { color: sd.color, scale: sd.scale || 1, elite: !!sd.elite });
    sm.position.set(hx2, 0, hz2); sm.rotation.y = Math.atan2(axis.x, axis.z);
    WF.world.scene.add(sm); summoned.push(sm);
    actors[sIdx] = { mesh: sm, home: new THREE.Vector3(hx2, 0, hz2), from: null, state: 'idle', stateT: 0, kick: 0, face: sm.rotation.y };
    statusMeshes[sIdx] = { charms: [], wards: [], pips: [], absorb: null, aura: null };
    if (platesBox) {
      var pn = document.createElement('div'); pn.className = 'cb-plate'; pn.setAttribute('data-idx', sIdx);
      platesBox.appendChild(pn); plates[sIdx] = { node: pn, w: 150, h: 44, x: 0, y: 0, tx: 0, ty: 0, placed: false, html: '', cls: '' };
      wireTarget(pn, sIdx);
    }
    bandsCache = null; plateSolve = null;
    return sm;
  }
  // a guest's mirror was replaced by the host's full state (desync healed / reconnect)
  CV.netSync = function () {
    if (!net) return;
    if (battle) for (var hi = nP; hi < battle.combatants.length; hi++) if (!actors[hi]) stageHelper(hi);   // v2.1: helpers summoned while we were away
    net.shown = null; disp = null; handView = null; deckView = null;
    if (!net.playing) { syncAll(); refreshUI(); }
  };
  CV.netSkip = function () { skipIntro = true; };
  CV.netEnd = function (end) { if (!net) return; net.end = end; netPump(); };
  CV.party = function () { return net ? { mode: net.mode, nP: nP, mySeat: mySeat, waiting: net.waiting, playing: net.playing } : null; };

  // End of a realm duel: your own result, your own loot (rolled here), your own save.
  async function finishParty(end) {
    var S = WF.state, p = S.player, outcome = end.outcome;
    clearTimeout(net && net.tickT);
    try {
      await settleCine();
      if (hasCine()) WF.cine.abortAll();
      if (outcome === 'win') {
        for (var i = 0; i < nP; i++) if (battle.combatants[i].alive) holdPose(i, 'victory');
        storyMotes();   // v2.0 WS-E (R17) in a realm too: your own wizard frees them in your story
        camAnim.focus = null; resultCam = 'win'; hideForResult('win');
        await wait(1300);
      } else if (outcome === 'lose') {
        resultCam = 'lose'; camAnim.focus = null; hideForResult('lose');
        holdPose(mySeat, 'defeat');
        for (var ei = nP; ei < actors.length; ei++) if (battle.combatants[ei].alive) holdPose(ei, pickState(actors[ei].mesh, ['taunt', 'cast']));
        await wait(1300);
      } else await wait(450);
      var settled = WF.net.realmSettle(S, end);
      WF.ui.clearFloats(); hideTip();
      if (root && outcome !== 'flee') root.classList.add('results');
      var st = S.stats(), pr = D().progression;
      if (outcome === 'win') {
        WF.sfx.music(null); WF.sfx.play('victory');
        // fallen during a party win: back on your feet with the normal defeat health
        if (p.hp <= 0) p.hp = Math.round(st.maxHp * pr.defeatHP);
        var freed = end.enemies.map(function (eid) { var bl = (lore().bossLines || {})[eid]; return bl && bl.freed ? { id: eid, line: bl.freed } : null; }).filter(Boolean);
        if (group && group.state !== 'dead' && WF.world.groups.indexOf(group) >= 0) WF.world.killGroup(group);
        S.save();
        await WF.ui.showResults({ result: 'win', loot: settled.loot, levelUps: settled.levelUps, quests: settled.quests, enemies: end.enemies, freed: freed });
        cleanup();
        settled.levelUps.forEach(function (u) { WF.ui.levelUp(u); });
      } else if (outcome === 'lose') {
        WF.sfx.music(null); WF.sfx.play('defeat');
        p.stats.deaths++;
        await WF.ui.showResults({ result: 'lose' });
        if (group) group.cooldown = performance.now() + 4000;
        cleanup();
        p.hp = Math.round(st.maxHp * pr.defeatHP);
        p.mana = Math.max(p.mana, Math.round(st.maxMana * (pr.defeatMana != null ? pr.defeatMana : 0.3)));
        S.save();
        WF.main.travel(S.homeZone(), null, true);
        return;
      } else {
        WF.ui.toast('You escaped!', 'info');
        if (group) group.cooldown = performance.now() + 6000;
        cleanup();
        WF.world.nudgePlayer(axis.x * 3.5, axis.z * 3.5);
      }
      S.save();
    } catch (e) {
      console.error('party finish failed', e);
      if (CV.active) cleanup();
    }
  }

  // read-only access for QA tools / debugging
  Object.defineProperty(CV, '_battle', { get: function () { return battle; } });
  Object.defineProperty(CV, 'busy', { get: function () { return busy; } });
  // v1.2 WS1 QA hooks: on-screen enemy order, nameplate rects, picking, camera side, timing
  CV._order = function () { return enemyOrder().slice(); };
  CV._panelOrder = function () { return Array.prototype.map.call(document.querySelectorAll('#cb-enemies .cb-enemy'), function (n) { return +n.getAttribute('data-idx'); }); };
  CV._plates = function () {
    var out = [];
    for (var i = 1; i < plates.length; i++) {
      var p = plates[i]; if (!p) continue;
      var r = p.node.getBoundingClientRect();
      out.push({ idx: i, x: r.left, y: r.top, w: r.width, h: r.height, anchorX: p.ax, anchorY: p.ay, visible: p.node.style.visibility !== 'hidden' && !platesBox.classList.contains('off') && getComputedStyle(platesBox).visibility !== 'hidden' && getComputedStyle(p.node).opacity > 0.05, name: battle && battle.combatants[i] ? battle.combatants[i].name : '' });
    }
    return out;
  };
  CV._standX = function () { var cam = WF.world.camera, o = {}; cam.updateMatrixWorld(); for (var i = 1; i < actors.length; i++) o[i] = standX(i, cam); return o; };
  CV._pick = function (x, y) { return pickEnemyAt(x, y); };
  CV._headAt = function (i) { var a = actors[i]; if (!a) return null; var s = WF.world.toScreen(new THREE.Vector3(a.mesh.position.x, (a.mesh.userData.height || 2) * 0.6, a.mesh.position.z), {}); return { x: s.x, y: s.y }; };
  CV._camSide = function (rad) { camSide = rad; if (CV.active) { solveDuelCam(); hideOccluders(); } return camSol; };
  CV._timing = function () { return { pace: pace, castMul: castMul, classic: classicTiming }; };
  CV._bands = function () { return hudBands(); };
  // QA: what (if anything) stands between the live camera and each combatant's body? (ray to mid-height)
  CV._occluders = function () {
    var cam = WF.world.camera, rc = new THREE.Raycaster(), out = [], dir = new THREE.Vector3(), tgt = new THREE.Vector3();
    cam.updateMatrixWorld();
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i]; if (!a.mesh.visible || (battle && battle.combatants[i] && !battle.combatants[i].alive)) continue;
      tgt.set(a.mesh.position.x, (a.mesh.userData.height || 2) * 0.5, a.mesh.position.z);
      dir.copy(tgt).sub(cam.position); var dist = dir.length(); dir.normalize();
      rc.set(cam.position, dir); rc.far = dist - 0.7; rc.camera = cam;          // sprites need the camera
      var hits = [];
      WF.world.scene.traverseVisible(function (o) { if (o.isMesh && !o.isSprite) { try { rc.intersectObject(o, false, hits); } catch (e) { /* odd geometry */ } } });
      hits.sort(function (p1, p2) { return p1.distance - p2.distance; });
      hits = hits.filter(function (h) {
        var o = h.object; if (!o.isMesh || o.isSprite) return false;
        for (var p = o; p; p = p.parent) { if (!p.visible) return false; if (p === a.mesh) return false; }
        var m = Array.isArray(o.material) ? o.material[0] : o.material;
        return !(m && (m.transparent && m.opacity < 0.6 || m.depthWrite === false || m.visible === false));
      });
      if (!hits.length) continue;
      var h0 = hits[0].object, root2 = h0, label = h0.name || h0.type;
      for (var q = h0; q; q = q.parent) { if (q.userData && (q.userData.type || q.userData.isProp || q.userData.enemyId)) { root2 = q; break; } }
      out.push({ idx: i, dist: +hits[0].distance.toFixed(2), of: +dist.toFixed(2), what: (root2.userData && (root2.userData.type || root2.userData.enemyId)) || label, name: h0.name || '', pos: root2.position ? root2.position.toArray().map(function (v) { return +v.toFixed(1); }) : null });
    }
    return out;
  };
  Object.defineProperty(CV, '_actors', { get: function () { return actors.map(function (a) { return { state: a.state, native: !!a.native, visible: a.mesh.visible, defeatDone: !!a.mesh.userData.defeatDone, scale: a.mesh.scale.x }; }); } });

  return CV;
})();
