// =====================================================================
//  WIZZIE FARM — WF.story  (v2.0 WS-E: story retrofits, docs/design/story.md §9 R1–R17)
//
//  The small runtime pieces of the Book I story plants. Every word lives in
//  game/data/lore.js (storyAsides, vignettes, storyTriggers, storyFx, endCard);
//  this file only decides WHEN a plant shows and draws its little bit of VFX.
//
//  What a wizard has already seen is kept in the save as p.storyFlags[id] = true
//  (V2.0-CONTRACT §9; state.js creates/repairs it). Every plant plays once.
//
//   asides       S.turnInAside(npc, qid)  -> { line, ids } | null   (ui.js adds the line to the
//                                            quest's complete pages; S.markAside(r) on Complete)
//                S.greetAside(npc)        -> line | null             (marked as soon as it is shown)
//   vignettes    S.vignetteAfter(qid)     -> def | null
//                S.playVignette(def, say) -> Promise  camera beat: npc → the Spire's flame gutters →
//                                            back to npc; then say(npc, lines, done) shows a normal,
//                                            skippable dialogue. Space / Esc / click skips the beat.
//   zone hooks   S.onZone(zoneId)         main.js travel(): rolls the Spire flicker (A7, R5) and arms
//                                            the proximity lines (C1)
//   camera       S.camera(dt, look)       world.js updateCamera hook; true = the story beat owns the camera
//   freed motes  S.freedMotes(from, list) combatView finish(): a gold mote drifts from you into each freed
//                                            boss (R17). Runs alongside the victory pose: no extra duel time.
//   S.rng        replaceable random source (tests)
// =====================================================================
window.WF = window.WF || {};
WF.story = (function () {
  'use strict';
  var S = {};
  S.rng = Math.random;

  function D() { return (WF.data) || {}; }
  function L() { return D().lore || {}; }
  function P() { return WF.state && WF.state.player; }
  function W() { return WF.world; }
  function T() { return window.THREE; }

  // ------------------------------------------------------------------ flags
  S.flags = function (p) {
    p = p || P();
    if (!p) return {};
    if (!p.storyFlags || typeof p.storyFlags !== 'object' || Array.isArray(p.storyFlags)) p.storyFlags = {};
    return p.storyFlags;
  };
  S.seen = function (id, p) { return !!S.flags(p)[id]; };
  S.mark = function (id, p) { if (id) S.flags(p)[id] = true; };

  // ------------------------------------------------------------------ asides (B2, A8, B4, R15)
  // Quest turn-in: the highest pending aside whose level is reached plays; lower ones are marked
  // seen together with it (a wizard who skipped L5's line never hears two at once).
  S.turnInAside = function (npcId, qid, p) {
    p = p || P(); if (!p) return null;
    var q = (D().quests || {})[qid] || {};
    var lvl = Math.max(p.level || 1, q.level || 0);
    var due = (L().storyAsides || []).filter(function (a) {
      return a.on === 'turnIn' && a.npc === npcId && !S.seen(a.id, p) && lvl >= (a.level || 0);
    });
    if (!due.length) return null;
    due.sort(function (a, b) { return (b.level || 0) - (a.level || 0); });
    return { line: due[0].line, ids: due.map(function (a) { return a.id; }) };
  };
  S.markAside = function (r, p) { if (r && r.ids) r.ids.forEach(function (id) { S.mark(id, p); }); };

  // The first plain greeting (no quest business) adds the aside once.
  S.greetAside = function (npcId, p) {
    p = p || P(); if (!p) return null;
    var a = (L().storyAsides || []).filter(function (x) { return x.on === 'greet' && x.npc === npcId && !S.seen(x.id, p); })[0];
    if (!a) return null;
    S.mark(a.id, p);
    return a.line;
  };
  // ui.js helper: greeting lines + the aside (never the same line twice in a row)
  S.withGreetAside = function (npcId, lines) {
    var extra = S.greetAside(npcId);
    if (!extra) return lines;
    var out = (lines || []).filter(function (l) { return l !== extra; });
    out.push(extra);
    return out;
  };

  // ------------------------------------------------------------------ vignettes (B3, R7)
  S.vignetteAfter = function (qid, p) {
    var vs = L().vignettes || {};
    for (var k in vs) {
      var v = vs[k];
      if (v && v.after === qid && !S.seen(v.id, p)) return v;
    }
    return null;
  };

  function reduceMotion() { var p = P(); return !!(p && p.settings && p.settings.reduceMotion); }
  function ease(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }

  // The Spire: the Lanternmere tower prop exposes userData.flameMod (models.js) that its anim reads
  function spire() {
    var w = W(); if (!w || !w.props) return null;
    for (var i = 0; i < w.props.length; i++) {
      var m = w.props[i];
      if (m && m.userData && m.userData.type === 'tower' && m.userData.flameMod) return m;
    }
    return null;
  }
  function flameWorld(out) {
    var s = spire(); if (!s) return null;
    var f = s.userData.flame;
    if (f && f.pivot && f.pivot.getWorldPosition) { f.pivot.updateWorldMatrix(true, false); return f.pivot.getWorldPosition(out); }
    return out.set(s.position.x, 19.4 * (s.scale.x || 1), s.position.z);
  }
  // gutter: one heartbeat of the flame almost going out, then catching again (0 → 1 over `dur`)
  function gutterAt(k) {
    if (k <= 0 || k >= 1) return 0;
    if (k < 0.25) return ease(k / 0.25) * 0.9;            // drops
    if (k < 0.4) return 0.9 - Math.sin((k - 0.25) / 0.15 * Math.PI * 2) * 0.12;   // sputters
    return 0.9 * (1 - ease((k - 0.4) / 0.6));             // catches again
  }
  S._gutterAt = gutterAt;

  var beat = null;        // the running camera beat (vignette)
  var _a, _b, _f;
  function vecs() { if (!_a) { var V = T().Vector3; _a = new V(); _b = new V(); _f = new V(); } }

  S.playVignette = function (def, say) {
    return new Promise(function (resolve) {
      var w = W(), npc = null;
      S.mark(def.id);
      try { WF.state.save(); } catch (e) { /* storage blocked */ }
      if (w && w.npcs) for (var i = 0; i < w.npcs.length; i++) if (w.npcs[i].id === def.npc) npc = w.npcs[i];
      if (!npc || !w || !w.player || !w.camera || (def.zone && WF.state.player.zone !== def.zone)) {
        // not where the beat happens: just the line
        return say(def.npc, def.lines, resolve);
      }
      vecs();
      var V = T().Vector3;
      var h = (npc.mesh.userData && npc.mesh.userData.height) || 2.1;
      var flame = flameWorld(new V()) || new V(npc.x, 22, npc.z - 13);
      var dur = reduceMotion() ? 1.4 : 5.2;
      beat = {
        t: 0, dur: dur, def: def, done: false, reduce: reduceMotion(),
        fromPos: w.camera.position.clone(), fromLook: null,
        npcLook: new V(npc.x, h * 0.8, npc.z), flame: flame,
        gutterFrom: reduceMotion() ? 0.1 : 2.3, gutterDur: 1.1,
        finish: function () {
          if (beat && beat.finished) return;
          beat.finished = true;
          var s = spire(); if (s) s.userData.flameMod.dim = 0;
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('mousedown', onClick, true);
          if (w.mode === 'cutscene') w.mode = 'explore';
          beat = null;
          say(def.npc, def.lines, resolve);
        }
      };
      // shot positions: stand a little behind and above the player, looking at the npc
      var dx = npc.x - w.player.x, dz = npc.z - w.player.z, d = Math.hypot(dx, dz) || 1;
      beat.shotPos = new V(w.player.x - dx / d * 4.2, 2.6, w.player.z - dz / d * 4.2);
      beat.lowPos = new V(w.player.x - dx / d * 2.4, 1.2, w.player.z - dz / d * 2.4);  // looking up the Spire
      function onKey(e) { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); beat && beat.finish(); } }
      function onClick() { if (beat) beat.finish(); }
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onClick, true);
      if (WF.ui && WF.ui.prompt) WF.ui.prompt(null);
      w.mode = 'cutscene';
    });
  };
  S.vignetteActive = function () { return !!beat; };

  // world.js updateCamera hook: true = this frame's camera belongs to the story beat
  S.camera = function (dt, look) {
    var w = W();
    if (!beat || !w) return false;
    var b = beat;
    // wall-clock time (one frame counts at most 0.25 s), so the beat lasts the same on slow machines
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    b.t += b.last ? Math.min(0.25, Math.max(0, (now - b.last) / 1000)) : Math.min(0.25, dt);
    b.last = now;
    if (!b.fromLook) b.fromLook = look.clone();
    // the gutter
    var s = spire();
    if (s) s.userData.flameMod.dim = gutterAt((b.t - b.gutterFrom) / b.gutterDur);
    if (!b.sounded && b.t >= b.gutterFrom) { b.sounded = true; if (WF.sfx && WF.sfx.play) { try { WF.sfx.play('wisp'); } catch (e) { /* optional */ } } }
    if (b.t >= b.dur) { b.finish(); return false; }
    if (b.reduce) return false;            // reduce motion: no camera move, the flame still gutters
    var t = b.t;
    // 0–1.0 settle on the npc · 1.0–2.2 tilt up to the flame · 2.2–3.6 hold (gutter) · 3.6–4.6 back down · 4.6–5.2 hold
    if (t < 1.0) { var k0 = ease(t / 1.0); _a.copy(b.fromPos).lerp(b.shotPos, k0); _b.copy(b.fromLook).lerp(b.npcLook, k0); }
    else if (t < 2.2) { var k1 = ease((t - 1.0) / 1.2); _a.copy(b.shotPos).lerp(b.lowPos, k1); _b.copy(b.npcLook).lerp(b.flame, k1); }
    else if (t < 3.6) { _a.copy(b.lowPos); _b.copy(b.flame); }
    else if (t < 4.6) { var k2 = ease((t - 3.6) / 1.0); _a.copy(b.lowPos).lerp(b.shotPos, k2); _b.copy(b.flame).lerp(b.npcLook, k2); }
    else { _a.copy(b.shotPos); _b.copy(b.npcLook); }
    w.camera.position.copy(_a);
    look.copy(_b);
    w.camera.lookAt(look);
    return true;
  };

  // ------------------------------------------------------------------ A7 (R5): the Spire's flame leans toward you
  var lean = null;    // { t, armed, dir }
  S.rollFlicker = function (zoneId) {
    var fx = (L().storyFx || {}).spireFlicker;
    if (!fx || fx.zone !== zoneId) return false;
    return S.rng() < (fx.chance != null ? fx.chance : 0.2);
  };
  function startLean() {
    var s = spire(), w = W();
    if (!s || !w || !w.player) return false;
    vecs();
    var f = flameWorld(_f);
    // only when the flame is plausibly in view: within 45 of the player, in front of the camera
    var d = Math.hypot(f.x - w.player.x, f.z - w.player.z);
    if (d > 45) return false;
    var v = f.clone().project(w.camera);
    if (!(v.z < 1 && v.z > -1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95)) return false;
    var dx = w.player.x - f.x, dz = w.player.z - f.z, l = Math.hypot(dx, dz) || 1;
    lean = { t: 0, dur: 2.4, dx: dx / l, dz: dz / l, s: s };
    return true;
  }

  // ------------------------------------------------------------------ C1 (R10): proximity lines
  function triggerCheck() {
    var w = W(), p = P();
    if (!w || !w.player || !w.zone || !p || w.mode !== 'explore') return;
    (L().storyTriggers || []).forEach(function (tr) {
      if (S.seen(tr.id) || tr.zone !== p.zone) return;
      if (Math.hypot(w.player.x - tr.near[0], w.player.z - tr.near[1]) > (tr.radius || 8)) return;
      if (tr.unlessDefeated) {
        var alive = (w.groups || []).some(function (g) { return g.state !== 'dead' && g.def && (g.def.enemies || []).indexOf(tr.unlessDefeated) >= 0; });
        if (!alive) return;
      }
      S.mark(tr.id);
      var who = (D().npcs || {})[tr.speaker];
      var esc = WF.util && WF.util.esc ? WF.util.esc : function (x) { return x; };
      if (WF.ui && WF.ui.toast) WF.ui.toast('<b>' + esc(who ? who.name : '') + '</b>' + (tr.via ? ' <i>(' + esc(tr.via) + ')</i>' : '') + ': “' + esc(tr.line) + '”', 'lore', 7000);
      if (WF.voice) { try { WF.voice.say(tr.speaker, tr.line, { delay: 300 }); } catch (e) { /* silent */ } }
    });
  }

  // one small ticker for the ambient pieces (no edits to the main loop)
  var ticker = null, lastTs = 0, pendingFlicker = 0;
  function tick(ts) {
    ticker = window.requestAnimationFrame(tick);
    var dt = Math.min(0.1, ((ts || 0) - lastTs) / 1000 || 0.016); lastTs = ts || 0;
    var w = W();
    if (!w || !w.zone) return;
    // flicker: wait (up to 40 s) for a moment the flame is on screen, then lean once
    if (pendingFlicker > 0 && !lean && w.mode === 'explore') {
      pendingFlicker -= dt;
      if (startLean()) pendingFlicker = 0;
    }
    if (lean) {
      lean.t += dt;
      var k = lean.t / lean.dur, m = lean.s.userData.flameMod;
      var amt = k < 0.35 ? ease(k / 0.35) : 1 - ease((k - 0.35) / 0.65);
      m.lx = lean.dx * 1.1 * amt; m.lz = lean.dz * 1.1 * amt; m.boost = 0.25 * amt;
      if (k >= 1 || !lean.s.parent) { m.lx = m.lz = m.boost = 0; lean = null; }
    }
    triggerCheck._t = (triggerCheck._t || 0) + dt;
    if (triggerCheck._t > 0.25) { triggerCheck._t = 0; triggerCheck(); }
  }

  S.onZone = function (zoneId) {
    lean = null; pendingFlicker = 0;
    if (S.rollFlicker(zoneId)) pendingFlicker = 40;
    if (!ticker && window.requestAnimationFrame) ticker = window.requestAnimationFrame(tick);
    return pendingFlicker > 0;
  };
  S.flickerPending = function () { return pendingFlicker > 0 || !!lean; };
  S.forceFlicker = function () { pendingFlicker = 40; };        // lab / tests

  // ------------------------------------------------------------------ R17: gold motes into freed bosses
  // A boss is "freed" when lore.bossLines[id].freed exists and it is not `banished` (Nyx and the
  // Archon scatter; they get nothing of you).
  S.freedIds = function (ids) {
    var bl = L().bossLines || {};
    return (ids || []).filter(function (id) { return bl[id] && bl[id].freed && !bl[id].banished; });
  };
  S.freedMotes = function (from, targets) {
    var w = W(), THREE = T();
    if (!w || !w.scene || !THREE || !from || !targets || !targets.length) return 0;
    var mk = WF.models && WF.models._k;
    var tex = mk && mk.haloTex ? mk.haloTex() : null;
    var n = 0;
    targets.forEach(function (tg, idx) {
      if (!tg || !tg.pos || S.freedIds([tg.id]).length === 0) return;
      n++;
      var g = new THREE.Group();
      var mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color('#ffd76a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
      mat.toneMapped = false;
      var core = new THREE.Sprite(mat); core.scale.set(0.34, 0.34, 1); g.add(core);
      var glowM = mat.clone(); glowM.opacity = 0;
      var glow = new THREE.Sprite(glowM); glow.scale.set(0.9, 0.9, 1); g.add(glow);
      var trail = [];
      for (var i = 0; i < 6; i++) { var tm = mat.clone(); var ts = new THREE.Sprite(tm); ts.scale.set(0.16, 0.16, 1); trail.push(ts); g.add(ts); }
      var a = new THREE.Vector3(from.x, 1.35, from.z), b = new THREE.Vector3(tg.pos.x, tg.y || 1.1, tg.pos.z);
      var mid = a.clone().lerp(b, 0.5); mid.y += 1.4;
      var hist = [], t = -0.15 * idx, dur = 1.15, pt = new THREE.Vector3();
      function at(k, out) { var u = 1 - k; return out.set(u * u * a.x + 2 * u * k * mid.x + k * k * b.x, u * u * a.y + 2 * u * k * mid.y + k * k * b.y, u * u * a.z + 2 * u * k * mid.z + k * k * b.z); }
      g.userData.update = function (dt) {
        t += dt;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        at(ease(k), pt);
        core.position.copy(pt); glow.position.copy(pt);
        hist.unshift(pt.clone()); if (hist.length > 18) hist.pop();
        trail.forEach(function (s, j) { var hp = hist[Math.min(hist.length - 1, (j + 1) * 3)]; if (hp) s.position.copy(hp); s.material.opacity = 0.55 * (1 - j / 6) * (k < 1 ? 1 : 0); });
        var tw = 0.85 + Math.sin(t * 30) * 0.15;
        mat.opacity = Math.min(1, t * 5) * (k < 1 ? 1 : 0);
        glowM.opacity = Math.min(0.6, t * 3) * tw;
        if (k >= 1) {                        // it sinks in: a soft bloom on the freed being
          var e = (t - dur) / 0.5;
          glow.scale.setScalar(0.9 + e * 2.2);
          glowM.opacity = 0.6 * (1 - e);
          return e < 1;
        }
        return true;
      };
      g.userData.dispose = function () { mat.dispose(); glowM.dispose(); trail.forEach(function (s) { s.material.dispose(); }); };
      if (w.addFx) w.addFx(g); else w.scene.add(g);
    });
    if (n && WF.sfx && WF.sfx.play) { try { WF.sfx.play('wisp'); } catch (e) { /* optional */ } }
    return n;
  };

  return S;
})();
