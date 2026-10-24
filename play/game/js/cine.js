// =====================================================================
//  WIZZIE FARM — SPELL CINEMATICS  (WF.cine)        v1.1, agent F
//  Owner: technical-artist (VFX) + gameplay-programmer (duel camera).
//  Contract: docs/V1.1-CONTRACT.md §4.7.
//
//  Every spell is a little W101-style "mini movie":
//    caster wand-twirl -> the spell card floats up over the caster ->
//    school sigil flares under them -> camera cuts to a dramatic angle ->
//    a summoned creature / elemental performs the attack -> big impact
//    (particles, WF.gfx shake / flash / bloomPulse) -> camera returns.
//
//  API
//    var h = WF.cine.play(spec)   -> { impact: Promise, done: Promise, skip(),
//                                      impactFor(targetId) : Promise, abort(), id, length }
//    WF.cine.update(dt)           call every frame (combatView / labs do this)
//    WF.cine.ownsCamera()         true while a cinematic drives the camera
//    WF.cine.skip()               skip every running cinematic to its impact
//    WF.cine.resolve(card)        cinematic id used for a card (card.cine or default)
//    WF.cine.length(card, mode)   { dur, impact } in seconds (full | quick, speed 1)
//    WF.cine.list()               every registered cinematic id
//    WF.cine.shakeOffset(out)     camera offset of the fallback shake (no WF.gfx)
//    WF.cine.stats()              { running, particles (capacity), draws (meshes) }
//
//  spec = {
//    card: id | card object,                    (required)
//    scene, camera,                             (required)
//    caster: Object3D, casterPos: Vector3,      caster root + feet position
//    casterHeight, isEnemy,
//    targets: [{ id, obj, pos, height }],       feet positions (AoE = several)
//    home(outPos, outLook),                     the duel camera to return to
//    look0: Vector3,                            where the camera looks right now
//    center: Vector3,                           duel ring centre (self casts face it)
//    mode: 'full' | 'quick',                    default: player setting (full)
//    speed: 1,                                  <1 = faster (v1.2: combatView always passes 1)
//    retime: true,                              v1.2: false = the v1.1 timing ("Fast combat animations")
//    reduceMotion: false,                       no camera cuts, no shake
//    setState(obj, state, seconds),             animation hook (combatView actors)
//    states(obj) -> array | null,               which anim states a model knows
//    fizzle: false,                             the card cracks and fizzles instead
//    onShots(poses[])                           camera spots (to hide blocking props)
//  }
//  Per-instance GPU resources are created through the stage (own / fade /
//  ownGeo / ownTex / parts) and ALL freed when the cinematic ends or aborts.
//  Shared geometry is tagged (userData.sharedGeometry) like the rest of models.js.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.cine = (function () {
  'use strict';
  var T = window.THREE, PI = Math.PI, TAU = PI * 2;
  var CI = {};
  var X = null;
  function fx() { if (!X) { if (WF.models.init) WF.models.init(); X = WF.models._fx; } return X; }

  var DEFS = {};
  var running = [];
  var camOwner = null;
  var lastReal = 0, watchdog = null, uid = 0;
  var PART_CAP = 300;            // live-particle budget per cinematic (art bible §8)
  // v1.2 WS1: real (wall) clock of the cinematic being advanced. Wobbles, flaps, spins and
  // flicker read this so they keep their natural speed while the choreography is retimed.
  var curWT = 0;
  function wt() { return curWT; }

  // ------------------------------------------------------------------
  //  small math helpers
  // ------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function seg(a, t0, t1) { return clamp((a - t0) / (t1 - t0), 0, 1); }
  function eOut(k) { return 1 - Math.pow(1 - k, 3); }
  function eIn(k) { return k * k; }
  function eIn3(k) { return k * k * k; }
  function eInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function eBack(k) { var c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function bell(a, t0, t1) { var k = seg(a, t0, t1); return Math.sin(k * PI); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function V(x, y, z) { return new T.Vector3(x || 0, y || 0, z || 0); }
  function toV(v) {
    if (!v) return new T.Vector3();
    if (v.isVector3) return v.clone();
    if (Array.isArray(v)) return new T.Vector3(v[0] || 0, v[1] || 0, v[2] || 0);
    return new T.Vector3(v.x || 0, v.y || 0, v.z || 0);
  }
  function bez(p0, p1, p2, p3, t, out) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return out.set(p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
  }
  function qbez(p0, p1, p2, t, out) {
    var u = 1 - t;
    return out.set(p0.x * u * u + 2 * p1.x * u * t + p2.x * t * t, p0.y * u * u + 2 * p1.y * u * t + p2.y * t * t, p0.z * u * u + 2 * p1.z * u * t + p2.z * t * t);
  }
  var UPV = new T.Vector3(0, 1, 0), ZERO = new T.Vector3();
  var _m4 = new T.Matrix4(), _fd = new T.Vector3(), _u2 = new T.Vector3(), _va = new T.Vector3(), _vb = new T.Vector3(), _vc = new T.Vector3();
  function faceDir(obj, dir) {
    if (dir.lengthSq() < 1e-8) return;
    _fd.copy(dir).normalize();
    _m4.lookAt(_fd, ZERO, Math.abs(_fd.y) > 0.995 ? _u2.set(0, 0, 1) : UPV);
    obj.quaternion.setFromRotationMatrix(_m4);
  }
  function faceFlat(obj, dir) { obj.rotation.set(0, Math.atan2(dir.x, dir.z), 0); }
  function rgb(c) { var k = new T.Color(c); return [k.r, k.g, k.b]; }
  function col(c) { return c instanceof T.Color ? c.clone() : new T.Color(c); }
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------------
  //  settings + platform hooks (all guarded)
  // ------------------------------------------------------------------
  function settings() { var p = WF.state && WF.state.player; return (p && p.settings) || {}; }
  CI.modeSetting = function () { return 'full'; };   // v2.0: fixed timing, no quick mode

  // ------------------------------------------------------------------
  // ---- v1.2 WS1: RETIME (Jorge: "cast animations should take about 50% longer")
  //  Every full-mode cinematic is authored in v1.1 "story" seconds. A per-cinematic
  //  time warp maps real seconds -> story seconds so the beats that read as drama
  //  get longer, NOT the whole movie in slow motion:
  //    anticipation (wand twirl, card held over the head, sigil build-up)   weight 1.0
  //    creature presence + travel toward the target                         weight 0.6
  //    the strike itself (just before -> just after the impact)             weight 0   (stays snappy)
  //    impact hold + camera hold before the camera returns home              weight 0.8
  //  Slope in a phase = 1 + lambda * weight, lambda solved so the total is RETIME x
  //  the v1.1 length. Slopes blend over +-0.05 s so motion never jerks between phases.
  //  Particles, physics, emission, flashes, shakes and every wobble / flap / spin run on
  //  the REAL clock (ticks get real dt + Q.wt()), so nothing looks slowed down.
  //  "Fast combat animations" = exactly the v1.1 timing (no warp). Quick mode never warps.
  //  A definition may override the phases: retime: [[storyEnd, weight], ...], a function
  //  (dur, impact, impactEnd) -> phases, or false (never retimed).
  // ------------------------------------------------------------------
  var RETIME = 1.5, WARP_H = 1 / 240, WARP_RAMP = 0.05;
  CI.RETIME = RETIME;
  // v2.1 A3 (Jorge): every caster winds the wand up for exactly this long before the spell
  // cinematic (or the FIZZLE) starts. Fixed, never sped up or skipped (realm timing).
  CI.WINDUP_S = 1.5;
  function warpPhases(def, dur, TI, TE) {
    if (Array.isArray(def.retime)) return def.retime;
    if (typeof def.retime === 'function') return def.retime(dur, TI, TE);
    var Ta = def.cardOut != null ? def.cardOut : Math.min(0.8, TI * 0.5);
    Ta = clamp(Ta, Math.min(0.2, TI * 0.5), TI * 0.7);
    var Tb = Math.max(Ta, TI - 0.08), Tc = Math.min(dur, Math.max(Tb, TE) + 0.12);
    return [[Ta, 1.0], [Tb, 0.6], [Tc, 0], [dur, 0.8]];
  }
  // Warp(def, dur, TI, TE, factor): r(a) story->real and a(r) real->story (piecewise linear tables)
  function Warp(def, dur, TI, TE, factor) {
    var ph = warpPhases(def, dur, TI, TE);
    function w0(a) { for (var i = 0; i < ph.length; i++) if (a < ph[i][0]) return ph[i][1]; return ph[ph.length - 1][1]; }
    // weight with linear blends across phase boundaries (area-preserving)
    function wgt(a) {
      for (var i = 0; i < ph.length - 1; i++) {
        var b = ph[i][0];
        if (Math.abs(a - b) < WARP_RAMP && b > WARP_RAMP && b < dur - WARP_RAMP) { var k = (a - (b - WARP_RAMP)) / (2 * WARP_RAMP); return lerp(ph[i][1], ph[i + 1][1], k); }
      }
      return w0(a);
    }
    var n = Math.max(2, Math.ceil(dur / WARP_H) + 1), A = new Float64Array(n), Wt = new Float64Array(n), E = 0;
    for (var i = 0; i < n; i++) { A[i] = Math.min(dur, i * WARP_H); Wt[i] = wgt(A[i]); if (i) E += (Wt[i] + Wt[i - 1]) * 0.5 * (A[i] - A[i - 1]); }
    var lam = E > 1e-6 ? (factor - 1) * dur / E : 0, R = new Float64Array(n);
    if (!lam) { for (var j0 = 0; j0 < n; j0++) R[j0] = A[j0] * factor; }
    else for (var j = 1; j < n; j++) R[j] = R[j - 1] + (A[j] - A[j - 1]) * (1 + lam * (Wt[j] + Wt[j - 1]) * 0.5);
    var me = { factor: factor, lambda: lam, phases: ph, dur: R[n - 1] };
    me.r = function (a) {            // story -> real
      if (a <= 0) return a * (1 + lam * Wt[0]);
      if (a >= dur) return R[n - 1] + (a - dur) * (1 + lam * Wt[n - 1]);
      var f = a / WARP_H, i = Math.min(n - 2, Math.floor(f)), d = A[i + 1] - A[i];
      return R[i] + (R[i + 1] - R[i]) * (d > 0 ? (a - A[i]) / d : 0);
    };
    me.a = function (r) {            // real -> story
      if (r <= 0) return 0;
      if (r >= R[n - 1]) return dur + (r - R[n - 1]) / (1 + lam * Wt[n - 1]);
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (R[mid] <= r) lo = mid; else hi = mid; }
      var dr = R[hi] - R[lo];
      return A[lo] + (A[hi] - A[lo]) * (dr > 0 ? (r - R[lo]) / dr : 0);
    };
    me.slopeAt = function (a) { return 1 + lam * wgt(clamp(a, 0, dur)); };
    return me;
  }
  CI.Warp = Warp;
  function storyLen(d, F, card) { return typeof d.len === 'function' ? d.len(F, card) : { dur: d.dur, impact: d.impact, impactEnd: d.impactEnd }; }
  // does this def get the v1.2 retime in this mode?  (opts.classic / fastCombat -> v1.1 timing)
  function retimes(d, mode, classic) { return mode === 'full' && d.retime !== false && !classic; }
  function gfxCall(name, a, b, c) {
    var g = WF.gfx;
    if (g && typeof g[name] === 'function') { try { g[name](a, b, c); return true; } catch (e) { /* never break a duel */ } }
    return false;
  }
  function sfx(name) { try { if (WF.sfx && WF.sfx.play) WF.sfx.play(name); } catch (e) { /* silent */ } }

  // Fallback camera shake (used only when WF.gfx has no shake): a decaying offset.
  var shk = { t: 0, dur: 0, amp: 0, seed: 1 };
  // amp is 0..1 in cine units; WF.gfx.shake moves the camera ~0.9 world units at 1, so it gets
  // a scaled value that matches the fallback offset below (boss hits stay readable, not nauseating)
  function shake(amp, dur) {
    if (gfxCall('shake', amp * 0.42, dur)) return;
    if (amp * Math.max(0, 1 - shk.t / (shk.dur || 1)) > shk.amp * Math.max(0, 1 - shk.t / (shk.dur || 1)) || shk.t >= shk.dur) { shk.amp = amp; shk.dur = dur; shk.t = 0; }
  }
  CI.shakeOffset = function (out) {
    out = out || new T.Vector3();
    if (shk.t >= shk.dur || !shk.amp) return out.set(0, 0, 0);
    var k = 1 - shk.t / shk.dur, a = shk.amp * k * k * 0.22, t = shk.t * 60;
    return out.set(Math.sin(t * 1.7 + 1.3) * a, Math.sin(t * 2.3 + 0.4) * a * 0.8, Math.sin(t * 1.9 + 2.1) * a);
  };
  // intensity 0..1 in cine units; both paths cap it so the screen tints instead of whiting out
  // v1.1 polish (B12): an impact TINTS the screen (<= 0.34 alpha) so the target stays readable
  var FLASH_CAP = 0.34;
  function flash(color, intensity, dur) {
    if (gfxCall('flash', color, Math.min(FLASH_CAP, intensity * 0.42), dur)) return;
    // CSS overlay fallback (cine.css #cine-flash)
    try {
      var d = document.getElementById('cine-flash');
      if (!d) { d = document.createElement('div'); d.id = 'cine-flash'; document.body.appendChild(d); }
      d.style.background = color; d.style.transition = 'none'; d.style.opacity = String(Math.min(FLASH_CAP, intensity * 0.42));
      void d.offsetWidth;
      d.style.transition = 'opacity ' + Math.max(0.08, dur) + 's ease-out'; d.style.opacity = '0';
    } catch (e) { /* no DOM */ }
  }
  function bloomPulse(amount, dur) { gfxCall('bloomPulse', amount, dur); }
  // full-screen dim (CSS overlay under the duel UI); level 0..1
  var dimLevel = 0;
  function dim(level) {
    level = clamp(level || 0, 0, 1);
    if (Math.abs(level - dimLevel) < 0.01) return;
    dimLevel = level;
    try {
      var d = document.getElementById('cine-dim');
      if (!d) { if (!level) return; d = document.createElement('div'); d.id = 'cine-dim'; document.body.appendChild(d); }
      d.style.opacity = String(level);
    } catch (e) { /* no DOM */ }
  }
  CI.dim = dim;

  // Which animation states a model supports. Models may advertise userData.states; v1.1 models
  // (agents C1/C2) keep userData.defeatDone up to date in anim(), v1.0 models never set it.
  var WIZ_STATES = ['idle', 'walk', 'run', 'windup', 'cast', 'cast_big', 'hit', 'victory', 'defeat', 'ride', 'talk', 'duel_idle'];
  var ENEMY_STATES = ['idle', 'walk', 'windup', 'cast', 'hit', 'taunt', 'duel_idle', 'defeat'];
  CI.statesOf = function (obj) {
    var ud = obj && obj.userData; if (!ud) return null;
    if (ud.states) return ud.states;
    if ('defeatDone' in ud) return ud.wandTip ? WIZ_STATES : ENEMY_STATES;
    return null;
  };

  // ------------------------------------------------------------------
  //  Duel frame: positions + axes for one cast
  //    C caster feet, T primary target feet, Tc centroid of all targets,
  //    f unit caster->target (flat), s unit side pointing to the home camera,
  //    ch/th caster/target height, D distance, M midpoint, from = staff tip.
  // ------------------------------------------------------------------
  function Frame(spec) {
    var F = {};
    var cobj = spec.caster;
    F.C = toV(spec.casterPos || (cobj && cobj.position)); F.C.y = 0;
    F.ch = spec.casterHeight || (cobj && cobj.userData && cobj.userData.height) || 2.1;
    var tg = (spec.targets || []).filter(Boolean);
    F.targets = tg.map(function (t) {
      var p = toV(t.pos || (t.obj && t.obj.position)); p.y = 0;
      return { id: t.id, obj: t.obj || null, pos: p, h: t.height || (t.obj && t.obj.userData && t.obj.userData.height) || 2 };
    });
    var cen = spec.center ? toV(spec.center) : null;
    var self = !F.targets.length || (F.targets.length === 1 && F.targets[0].pos.distanceTo(F.C) < 0.3);
    F.self = self;
    if (!F.targets.length) F.targets = [{ id: null, obj: cobj || null, pos: F.C.clone(), h: F.ch }];
    F.T = F.targets[0].pos.clone(); F.th = F.targets[0].h;
    F.Tc = new T.Vector3(); F.targets.forEach(function (t) { F.Tc.add(t.pos); }); F.Tc.multiplyScalar(1 / F.targets.length);
    F.thMax = F.targets.reduce(function (m, t) { return Math.max(m, t.h); }, 0);
    var dir = new T.Vector3();
    if (self) dir.copy(cen || F.C.clone().add(V(0, 0, -1))).sub(F.C);
    else dir.copy(F.Tc).sub(F.C);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    F.D = self ? 9 : Math.max(2, F.Tc.distanceTo(F.C));
    F.f = dir.normalize();
    F.s = new T.Vector3(F.f.z, 0, -F.f.x);
    // the side the home camera is on (so cuts never jump across the line of action)
    var hp = new T.Vector3(), hl = new T.Vector3();
    if (spec.home) { try { spec.home(hp, hl); } catch (e) { hp.set(0, 0, 0); } }
    var mid = F.C.clone().addScaledVector(F.f, F.D * 0.5);
    if (spec.home && hp.clone().sub(mid).dot(F.s) < 0) F.s.negate();
    F.M = mid;
    if (self) { F.T = F.C.clone(); F.th = F.ch; }
    // where the spell leaves the caster: staff tip (wizards) or chest (creatures)
    var wiz = !spec.isEnemy || F.ch < 2.5;
    F.from = F.C.clone().addScaledVector(F.f, wiz ? 0.45 : 0.7).addScaledVector(F.s, wiz ? 0.25 : 0).setY(wiz ? Math.min(1.95, F.ch * 0.88) : F.ch * 0.6);
    var tip = cobj && cobj.userData && cobj.userData.wandTip;      // C1 wizards expose the wand gem
    if (tip && tip.getWorldPosition) {
      try { cobj.updateMatrixWorld(true); var wp = tip.getWorldPosition(new T.Vector3()); if (isFinite(wp.x) && wp.distanceTo(F.C) < 4) F.from.copy(wp); } catch (e) { /* keep estimate */ }
    }
    F.hit = function (i) { var t = F.targets[i || 0] || F.targets[0]; return t.pos.clone().setY(Math.max(0.5, t.h * 0.55)); };
    // the target's FRONT surface (toward the caster) so impact particles aren't buried inside the model
    F.front = function (i) { var t = F.targets[i || 0] || F.targets[0]; var d = F.C.clone().sub(t.pos).setY(0); if (d.lengthSq() < 1e-6) d.copy(F.f).negate(); d.normalize(); return t.pos.clone().addScaledVector(d, clamp(t.h * 0.22, 0.3, 1.1)).setY(Math.max(0.5, t.h * 0.5)); };
    F.feet = function (i) { var t = F.targets[i || 0] || F.targets[0]; return t.pos.clone(); };
    F.hs = function (i) { var t = F.targets[i || 0] || F.targets[0]; return clamp(t.h / 2, 0.7, 2.4); };   // size factor of a target
    return F;
  }

  // ------------------------------------------------------------------
  //  Camera shots. Each writes a position P and look-at point L.
  //  o: { push: 0..1 (dolly toward L over the segment), orbit: radians, rise,
  //       dp: [fwd, up, side] position offset, dl: [fwd, up, side] look offset, fov }
  // ------------------------------------------------------------------
  function at(F, base, fw, up, sd, out) { return out.copy(base).addScaledVector(F.f, fw).addScaledVector(F.s, sd).setY(base.y + up); }
  var SHOTS = {
    // low 3/4 front of the caster: face + the card floating above the hat
    caster: function (F, P, L) { var h = F.ch, big = Math.max(0, h - 2.4); at(F, F.C, 3.3 + h * 0.35 + big * 1.1, 1.1 + h * 0.25, 2.0 + h * 0.2 + big * 0.5, P); at(F, F.C, 0.2, Math.min(h * 0.92 + 0.45, h * 0.6 + 1.2), 0, L); },
    // wider front view of the caster with room above / behind for a summon
    casterWide: function (F, P, L) { var h = F.ch; at(F, F.C, 5.2 + h * 0.4, 1.3 + h * 0.35, 3.2, P); at(F, F.C, -0.3, h + 0.9, 0.1, L); },
    // behind the caster, over the shoulder toward the target
    shoulder: function (F, P, L) { at(F, F.C, -2.5 - F.ch * 0.2, F.ch + 0.55, 1.35, P); at(F, F.Tc, 0, F.th * 0.5 + 0.2, 0, L); },
    // the whole line of action from the side
    side: function (F, P, L) { at(F, F.M, 0, 2.2 + F.D * 0.12, F.D * 0.78 + 2.2, P); at(F, F.M, 0, 1.3, 0, L); },
    // close on the (primary) target, from the caster's side
    target: function (F, P, L) { var h = F.th, d = 2.6 + h * 0.55; at(F, F.T, -d, 0.9 + h * 0.3, d * 0.62, P); at(F, F.T, 0, h * 0.55, 0, L); },
    // close on the centre of all targets (AoE)
    targets: function (F, P, L) { var h = F.thMax, sp = spread(F), d = 3.2 + h * 0.5 + sp * 0.7; at(F, F.Tc, -d, 1.4 + h * 0.3, d * 0.55, P); at(F, F.Tc, 0, h * 0.45, 0, L); },
    // low angle on the target looking UP (something big above / behind it)
    targetLow: function (F, P, L) { var h = F.thMax, d = 3.6 + h * 0.6 + spread(F) * 0.5; at(F, F.Tc, -d, 0.55, d * 0.42, P); at(F, F.Tc, 0.9, h * 0.6 + 1.9, 0, L); },
    // looking up into the sky above the target
    sky: function (F, P, L) { var d = 6 + F.thMax * 0.5; at(F, F.Tc, -d, 1.3, d * 0.5, P); at(F, F.Tc, 0.8, 6.2 + F.thMax * 0.4, 0, L); },
    // far, high establishing shot of the arena
    wide: function (F, P, L) { at(F, F.M, -1.2, 5.6 + F.D * 0.18, F.D * 1.05 + 4.5, P); at(F, F.M, 0, 1.2, 0, L); },
    // from the side of the targets, slightly in front, looking at something just behind them
    flank: function (F, P, L) { var h = F.thMax, d = 5.6 + h * 0.7 + spread(F); at(F, F.Tc, -1.6, 1.3 + h * 0.2, d, P); at(F, F.Tc, 1.6, h * 0.7 + 1.0, 0, L); },
    // behind the targets looking back at the caster (enemy POV)
    reverse: function (F, P, L) { var d = 2.6 + F.thMax * 0.35; at(F, F.Tc, d, F.thMax * 0.6 + 1.0, 1.6, P); at(F, F.C, 0, F.ch * 0.6, 0, L); },
    // around the caster's feet (sigils, portals, heals): high-ish 3/4
    casterTop: function (F, P, L) { var h = F.ch; at(F, F.C, 3.4 + h * 0.3, 2.8 + h * 0.5, 2.4, P); at(F, F.C, 0, h * 0.5, 0, L); }
  };
  // shot that tracks a moving object: P = fixed point or function(F,u,out); look = object (+ dy) blended toward look2 by u
  function follow(getObj, posFn, o) {
    o = o || {};
    return function (F, P, L, u) {
      var obj = getObj(), wp = _vc, has = !!(obj && obj.parent);
      if (has) obj.getWorldPosition(wp);
      posFn(F, u, P, has ? wp : null);
      if (has) { L.copy(wp); L.y += o.dy || 0; }
      else if (o.fallback) o.fallback(F, L); else L.copy(F.Tc).setY(1.2);
      if (o.look2) { var k = o.lookEase ? o.lookEase(u) : smooth(o.l0 || 0.5, o.l1 || 1, u); o.look2(F, _vb); L.lerp(_vb, k); }
    };
  }
  CI.follow = follow;
  // chase camera: sits at (fwd, up, side) from the object (in the duel frame) and looks at it
  CI.chase = function (getObj, fw, up, sd, o) {
    o = o || {};
    return follow(getObj, function (F, u, P, wp) {
      if (wp) P.copy(wp).addScaledVector(F.f, fw).addScaledVector(F.s, sd).setY(Math.max(0.4, wp.y + up));
      else P.copy(F.M).setY(3);
    }, o);
  };
  function spread(F) { var m = 0; F.targets.forEach(function (t) { m = Math.max(m, t.pos.distanceTo(F.Tc)); }); return m; }

  function Track(F, keys, spec, dur) {
    this.F = F; this.spec = spec; this.dur = dur;
    this.keys = keys.map(function (k) { return Array.isArray(k) ? { t: k[0], shot: k[1], o: k[2] || {} } : k; });
    this.keys.sort(function (a, b) { return a.t - b.t; });
    this.cur = { P: new T.Vector3(), L: new T.Vector3(), fov: 55 };
    this._a = { P: new T.Vector3(), L: new T.Vector3(), fov: 55 };
    this._b = { P: new T.Vector3(), L: new T.Vector3(), fov: 55 };
    this.start = { P: new T.Vector3(), L: new T.Vector3(), fov: 55 };
    this.homeFov = 55;
  }
  Track.prototype.pose = function (i, t, out) {
    var k = this.keys[i], F = this.F, o = k.o;
    var t1 = i + 1 < this.keys.length ? this.keys[i + 1].t : this.dur;
    var u = clamp((t - k.t) / Math.max(0.05, t1 - k.t), 0, 1.25);
    out.fov = o.fov || this.homeFov;
    if (k.shot === 'home') {
      if (this.spec.home) this.spec.home(out.P, out.L); else { out.P.copy(this.start.P); out.L.copy(this.start.L); }
      out.fov = this.homeFov;
      return out;
    }
    if (k.shot === 'cur') { out.P.copy(this.start.P); out.L.copy(this.start.L); out.fov = this.start.fov; }
    else if (typeof k.shot === 'function') k.shot(F, out.P, out.L, u);
    else (SHOTS[k.shot] || SHOTS.side)(F, out.P, out.L);
    if (o.dp) { out.P.addScaledVector(F.f, o.dp[0]); out.P.y += o.dp[1]; out.P.addScaledVector(F.s, o.dp[2]); }
    if (o.dl) { out.L.addScaledVector(F.f, o.dl[0]); out.L.y += o.dl[1]; out.L.addScaledVector(F.s, o.dl[2]); }
    var ue = o.lin ? Math.min(u, 1) : eInOut(Math.min(u, 1));
    if (o.orbit) {
      var ang = o.orbit * ue, dx = out.P.x - out.L.x, dz = out.P.z - out.L.z, c = Math.cos(ang), s = Math.sin(ang);
      out.P.x = out.L.x + dx * c - dz * s; out.P.z = out.L.z + dx * s + dz * c;
    }
    if (o.push) out.P.lerp(out.L, o.push * ue);
    if (o.pull) out.P.addScaledVector(_va.subVectors(out.P, out.L).normalize(), o.pull * ue);
    if (o.rise) out.P.y += o.rise * ue;
    if (o.lookRise) out.L.y += o.lookRise * ue;
    if (o.fov2) out.fov = lerp(out.fov, o.fov2, ue);
    if (out.P.y < 0.25) out.P.y = 0.25;
    return out;
  };
  Track.prototype.eval = function (t) {
    var i = 0;
    for (var k = 0; k < this.keys.length; k++) if (this.keys[k].t <= t) i = k;
    var key = this.keys[i], out = this.cur;
    this.pose(i, t, this._b);
    var bl = key.o.blend || 0;
    if (i > 0 && bl > 0 && t - key.t < bl) {
      this.pose(i - 1, t, this._a);
      var e = eInOut(clamp((t - key.t) / bl, 0, 1));
      out.P.lerpVectors(this._a.P, this._b.P, e); out.L.lerpVectors(this._a.L, this._b.L, e); out.fov = lerp(this._a.fov, this._b.fov, e);
    } else { out.P.copy(this._b.P); out.L.copy(this._b.L); out.fov = this._b.fov; }
    return out;
  };
  Track.prototype.samples = function () {
    var res = [], tmp = { P: new T.Vector3(), L: new T.Vector3(), fov: 55 };
    for (var i = 0; i < this.keys.length; i++) {
      if (this.keys[i].shot === 'home' || this.keys[i].shot === 'cur') continue;
      var t0 = this.keys[i].t, t1 = i + 1 < this.keys.length ? this.keys[i + 1].t : this.dur;
      [0, 0.5, 1].forEach(function (u) { var p = this.pose(i, t0 + (t1 - t0) * u, tmp); res.push({ pos: p.P.clone(), look: p.L.clone() }); }, this);
    }
    return res;
  };

  // ------------------------------------------------------------------
  //  Spell card glyph (canvas -> sprite). Per-instance texture, freed by the stage.
  // ------------------------------------------------------------------
  function rr(x, X0, Y0, w, h, r) { x.beginPath(); x.moveTo(X0 + r, Y0); x.arcTo(X0 + w, Y0, X0 + w, Y0 + h, r); x.arcTo(X0 + w, Y0 + h, X0, Y0 + h, r); x.arcTo(X0, Y0 + h, X0, Y0, r); x.arcTo(X0, Y0, X0 + w, Y0, r); x.closePath(); }
  function star(x, cx, cy, n, r0, r1, rot) { x.beginPath(); for (var i = 0; i <= n * 2; i++) { var a = rot + i * PI / n, r = i % 2 ? r0 : r1; if (!i) x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.closePath(); }
  function typeIcon(x, type, cx, cy, s) {
    x.save(); x.translate(cx, cy); x.fillStyle = '#ffffff'; x.strokeStyle = '#ffffff'; x.lineJoin = 'round'; x.lineCap = 'round';
    switch (type) {
      case 'damage': star(x, 0, 0, 8, s * 0.32, s, -PI / 2); x.fill(); break;
      case 'aoe': star(x, 0, 0, 12, s * 0.55, s, -PI / 2); x.fill(); x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.arc(0, 0, s * 0.32, 0, TAU); x.fill(); break;
      case 'dot': x.beginPath(); x.moveTo(0, -s); x.bezierCurveTo(s * 0.9, -s * 0.2, s * 0.75, s * 0.9, 0, s * 0.9); x.bezierCurveTo(-s * 0.75, s * 0.9, -s * 0.9, -s * 0.2, 0, -s); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.moveTo(0, -s * 0.1); x.bezierCurveTo(s * 0.4, s * 0.25, s * 0.35, s * 0.75, 0, s * 0.75); x.bezierCurveTo(-s * 0.35, s * 0.75, -s * 0.4, s * 0.25, 0, -s * 0.1); x.fill(); break;
      case 'heal': case 'hot': var w = s * 0.36; x.fillRect(-w, -s, w * 2, s * 2); x.fillRect(-s, -w, s * 2, w * 2); if (type === 'hot') { x.lineWidth = s * 0.12; x.beginPath(); x.arc(0, 0, s * 1.15, -PI * 0.2, PI * 1.3); x.stroke(); } break;
      case 'blade': x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.2, -s * 0.7); x.lineTo(s * 0.16, s * 0.42); x.lineTo(-s * 0.16, s * 0.42); x.lineTo(-s * 0.2, -s * 0.7); x.closePath(); x.fill();
        x.fillRect(-s * 0.5, s * 0.42, s, s * 0.14); x.fillRect(-s * 0.08, s * 0.56, s * 0.16, s * 0.34); x.beginPath(); x.arc(0, s * 0.96, s * 0.11, 0, TAU); x.fill(); break;
      case 'trap': x.lineWidth = s * 0.22; x.beginPath(); for (var i = 0; i <= 6; i++) { var a = i * TAU / 6 + PI / 6; if (!i) x.moveTo(Math.cos(a) * s, Math.sin(a) * s); else x.lineTo(Math.cos(a) * s, Math.sin(a) * s); } x.stroke(); x.beginPath(); x.arc(0, 0, s * 0.25, 0, TAU); x.fill(); break;
      case 'shield': x.beginPath(); x.moveTo(0, -s); x.quadraticCurveTo(s * 0.5, -s * 0.75, s * 0.9, -s * 0.8); x.quadraticCurveTo(s * 0.95, s * 0.35, 0, s); x.quadraticCurveTo(-s * 0.95, s * 0.35, -s * 0.9, -s * 0.8); x.quadraticCurveTo(-s * 0.5, -s * 0.75, 0, -s); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(-s * 0.08, -s * 0.7, s * 0.16, s * 1.4); break;
      case 'weakness': x.beginPath(); x.moveTo(-s * 0.9, -s * 0.1); x.lineTo(0, s); x.lineTo(s * 0.9, -s * 0.1); x.lineTo(s * 0.35, -s * 0.1); x.lineTo(s * 0.35, -s); x.lineTo(-s * 0.35, -s); x.lineTo(-s * 0.35, -s * 0.1); x.closePath(); x.fill(); break;
      case 'absorb': x.lineWidth = s * 0.16; x.beginPath(); x.arc(0, 0, s * 0.9, 0, TAU); x.stroke(); x.globalAlpha = 0.45; x.beginPath(); x.arc(0, 0, s * 0.75, 0, TAU); x.fill(); x.globalAlpha = 1; x.beginPath(); x.arc(-s * 0.3, -s * 0.32, s * 0.16, 0, TAU); x.fill(); break;
      default: star(x, 0, 0, 5, s * 0.4, s, -PI / 2); x.fill();
    }
    x.restore();
  }
  function cardCanvas(card) {
    var S = (WF.data && WF.data.schools) || {}, sc = S[card.school] || { color: '#d8d8d8', dark: '#333333' };
    var W = 256, H = 352, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    // glow behind the card
    var g0 = x.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 190);
    g0.addColorStop(0, 'rgba(255,255,255,0.0)'); g0.addColorStop(1, 'rgba(255,255,255,0)');
    // card body
    rr(x, 10, 10, W - 20, H - 20, 22);
    var g = x.createLinearGradient(0, 10, 0, H - 10);
    g.addColorStop(0, sc.color); g.addColorStop(0.55, sc.dark || '#222'); g.addColorStop(1, '#120c24');
    x.fillStyle = g; x.fill();
    x.lineWidth = 10; x.strokeStyle = '#f6d67a'; x.stroke();
    rr(x, 22, 22, W - 44, H - 44, 14); x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,0.55)'; x.stroke();
    // pips
    var p = card.pips || 0, n = Math.min(p, 7);
    for (var i = 0; i < n; i++) {
      var px = W / 2 + (i - (n - 1) / 2) * 26, py = 44;
      var pg = x.createRadialGradient(px - 3, py - 3, 1, px, py, 10);
      pg.addColorStop(0, '#fffbe0'); pg.addColorStop(0.55, '#ffd36b'); pg.addColorStop(1, '#a87418');
      x.fillStyle = pg; x.beginPath(); x.arc(px, py, 10, 0, TAU); x.fill();
    }
    // art window
    var ax = 34, ay = 66, aw = W - 68, ah = 170;
    rr(x, ax, ay, aw, ah, 16);
    var ag = x.createRadialGradient(W / 2, ay + ah * 0.55, 8, W / 2, ay + ah * 0.55, 150);
    ag.addColorStop(0, '#ffffff'); ag.addColorStop(0.18, sc.color); ag.addColorStop(1, sc.dark || '#222');
    x.fillStyle = ag; x.fill(); x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.45)'; x.stroke();
    // rays
    x.save(); rr(x, ax, ay, aw, ah, 16); x.clip();
    x.globalAlpha = 0.18; x.fillStyle = '#ffffff';
    for (var r = 0; r < 12; r++) { var a0 = r * TAU / 12; x.beginPath(); x.moveTo(W / 2, ay + ah * 0.55); x.arc(W / 2, ay + ah * 0.55, 200, a0, a0 + 0.13); x.closePath(); x.fill(); }
    x.restore(); x.globalAlpha = 1;
    x.shadowColor = 'rgba(255,255,255,0.95)'; x.shadowBlur = 18;
    typeIcon(x, card.type, W / 2, ay + ah * 0.55, 54);
    x.shadowBlur = 0;
    // name
    var name = card.name || '';
    var fs = name.length > 13 ? 26 : name.length > 10 ? 30 : 34;
    x.font = '800 ' + fs + 'px Cinzel, Georgia, "Times New Roman", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = '#1a0f2e'; x.strokeText(name, W / 2, 272);
    x.fillStyle = '#fff6dc'; x.fillText(name, W / 2, 272);
    // school band
    x.fillStyle = sc.color; x.globalAlpha = 0.85; rr(x, 70, 300, W - 140, 22, 10); x.fill(); x.globalAlpha = 1;
    x.font = '800 15px Nunito, Arial, sans-serif'; x.fillStyle = '#1a0f2e';
    x.fillText(((S[card.school] && S[card.school].name) || '').toUpperCase(), W / 2, 312);
    return c;
  }

  // ------------------------------------------------------------------
  //  STAGE: everything one cinematic creates. Freed in one go.
  // ------------------------------------------------------------------
  function Stage(cine) {
    var K = fx(), spec = cine.spec, card = cine.card;
    var school = cine.school;
    this.cine = cine; this.spec = spec; this.F = cine.F; this.card = card; this.school = school;
    this.pal = K.fxPalette(school, cine.color);
    this.r = seeded(cine.seed);
    this.isEnemy = !!spec.isEnemy;
    this.pips = Math.max(0, card.pips || 0);
    this.root = new T.Group(); this.root.name = 'cine_' + cine.def.id;
    this.root.frustumCulled = false;
    spec.scene.add(this.root);
    this.res = { mats: [], geos: [], texs: [], subs: [], inst: [] };
    this.capLeft = PART_CAP;
    this.systems = [];
    var self = this;
    // ctx compatible with models.js FX helpers (Impact, emitTrail, emitBurst, Winged, Lightning, stoneArm...)
    this.ctx = {
      q: { kind: 'cine', school: school in K.FXPAL ? school : null, pal: this.pal, S: 0.8, r: this.r, n: 1, pips: this.pips },
      root: this.root, pal: this.pal, S: 1, r: this.r,
      fade: function (m) { return self.fade(m); },
      own: function (m) { return self.own(m); },
      parts: function (n, tex, add) { return self.parts(n, tex, add); },
      mesh: function (geo, mat, parent) { return self.mesh(geo, mat, parent); }
    };
  }
  Stage.prototype.own = function (m) { this.res.mats.push(m); return m; };
  Stage.prototype.ownGeo = function (g) { this.res.geos.push(g); return g; };
  Stage.prototype.ownTex = function (t) { this.res.texs.push(t); return t; };
  Stage.prototype.fade = function (base, op) { var m = base.clone(); m.userData = {}; m.transparent = true; m.depthWrite = false; if (op !== undefined) m.opacity = op; this.res.mats.push(m); return m; };
  Stage.prototype.mesh = function (geo, mat, parent) { var m = new T.Mesh(geo, mat); m.userData.sharedGeometry = true; m.frustumCulled = false; (parent || this.root).add(m); return m; };
  Stage.prototype.group = function (parent) { var g = new T.Group(); (parent || this.root).add(g); return g; };
  // instanced primitive (one draw call for many copies): set(i, matrix) then commit(count)
  var _im = new T.Matrix4(), _iq = new T.Quaternion(), _is = new T.Vector3();
  Stage.prototype.inst = function (geo, mat, n, parent) {
    var m = new T.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.userData.sharedGeometry = true; m.count = 0;
    (parent || this.root).add(m); this.res.inst.push(m);
    var used = 0;
    return {
      mesh: m,
      begin: function () { used = 0; },
      push: function (mat4) { if (used < n) m.setMatrixAt(used++, mat4); },
      pushTRS: function (pos, quat, sx, sy, sz) { if (used >= n) return; _im.compose(pos, quat || _iq.identity(), _is.set(sx, sy == null ? sx : sy, sz == null ? sx : sz)); m.setMatrixAt(used++, _im); },
      end: function () { m.count = used; m.instanceMatrix.needsUpdate = true; m.visible = used > 0; }
    };
  };
  // Halo sprites get a stage-owned material copy (cinematics animate opacity; the
  // cached halo material is shared by every model and must never be mutated).
  Stage.prototype.halo = function (color, size, op, parent) {
    var h = fx().halo(color, size, op), src = h.material, m = src.clone();
    m.onBeforeCompile = src.onBeforeCompile; m.userData = {};
    h.material = this.own(m);
    (parent || this.root).add(h); return h;
  };
  // particle system; capacity comes out of the per-cinematic budget (PART_CAP)
  Stage.prototype.parts = function (n, tex, additive) {
    n = Math.max(8, Math.min(Math.round(n), this.capLeft)); this.capLeft -= n;
    var p = fx().Parts(n, tex || 'soft', additive !== false);
    this.res.geos.push(p.geo); this.root.add(p.obj); this.systems.push(p);
    return p;
  };
  // the standard trio: coloured puffs (normal), additive sparks, smoke/dust (normal)
  Stage.prototype.std = function (n) {
    if (this.pc) return this.ctx;
    n = Math.min(n || PART_CAP, this.capLeft);
    var sc = this.school, smoky = sc === 'stoneward' || sc === 'hollow';
    var star = sc === 'lumen';
    this.pc = this.ctx.pc = this.parts(n * (smoky ? 0.42 : 0.55), star ? 'star' : 'puff', false);
    this.pa = this.ctx.pa = this.parts(n * (smoky ? 0.33 : 0.45), star ? 'star' : 'soft', true);
    this.pn = this.ctx.pn = smoky ? this.parts(n * 0.25, 'smoke', false) : null;
    if (!this.pn) this.ctx.pn = this.pc;
    return this.ctx;
  };
  Stage.prototype.trail = function (x, y, z) { this.std(); fx().emitTrail(this.ctx, x, y, z); };
  Stage.prototype.burst = function (p, count, power) { this.std(); fx().emitBurst(this.ctx, p.x, p.y, p.z, count, power || 1); };
  Stage.prototype.impactFx = function (o) { this.std(); return Boom(this, o); };
  Stage.prototype.dim = function (level) { this.cine.usedDim = true; dim(this.cine.reduceMotion ? level * 0.5 : level); };
  Stage.prototype.shake = function (amp, dur) { if (!this.cine.reduceMotion && !this.cine.muted) shake(Math.min(1, amp), dur); };
  Stage.prototype.flash = function (color, i, dur) { if (!this.cine.muted) flash(color, i * (this.cine.reduceMotion ? 0.4 : 1), dur); };
  Stage.prototype.sound = function (name, always) { if (!this.cine.muted || always) sfx(name); };
  Stage.prototype.at = function (t, fn) { this.cine.events.push({ t: t, fn: fn, done: false }); };
  Stage.prototype.land = function (i) { this.cine.land(i); };
  Stage.prototype.landAll = function () { for (var i = 0; i < this.F.targets.length; i++) this.cine.land(i); };
  Stage.prototype.state = function (s, dur) { this.cine.setState(this.spec.caster, s, dur); };
  Stage.prototype.targetState = function (i, s, dur) { var t = this.F.targets[i]; if (t && t.obj) this.cine.setState(t.obj, s, dur); };
  Stage.prototype.sub = function (obj, update) { this.root.add(obj); this.res.subs.push({ obj: obj, update: update || obj.userData.update, alive: true }); return obj; };
  // impact with every bell and whistle: particles + flash + shake + bloom + sound
  Stage.prototype.boom = function (imp, p, size, o) {
    o = o || {};
    if (imp) imp.go(p, size, o.parts);
    var big = clamp(o.power != null ? o.power : size / 2.2, 0.15, 1.6);
    if (!this.cine.reduceMotion) shake(Math.min(1, o.shake != null ? o.shake : big * 0.7), 0.25 + big * 0.35);
    if (o.flash !== false) flash(o.flashColor || ('#' + this.pal.hot.getHexString()), (o.flashI != null ? o.flashI : 0.25 + big * 0.35) * (this.cine.reduceMotion ? 0.4 : 1), 0.18 + big * 0.12);
    bloomPulse(0.08 + big * 0.18, 0.3 + big * 0.2);   // on top of the zone grade's bloom (0.75..1.1); kept low so the target never blows out
    if (o.sound !== false) this.sound(o.sound || ('impact_' + (this.school || 'hollow')), true);
    if (big > 0.75 && o.boomSound !== false) this.sound('boom', true);
  };
  Stage.prototype.tick = function (dt) {
    for (var i = 0; i < this.systems.length; i++) this.systems[i].update(dt);
    for (var j = 0; j < this.res.subs.length; j++) {
      var s = this.res.subs[j];
      if (!s.alive || !s.update) continue;
      var ok = true; try { ok = s.update(dt) !== false; } catch (e) { ok = false; }
      if (!ok) { s.alive = false; s.obj.visible = false; }
    }
  };
  Stage.prototype.free = function () {
    if (this.freed) return; this.freed = true;
    this.res.subs.forEach(function (s) { try { if (WF.models.dispose) WF.models.dispose(s.obj); } catch (e) { /* ignore */ } });
    if (this.root.parent) this.root.parent.remove(this.root);
    this.res.mats.forEach(function (m) { m.dispose(); });
    this.res.geos.forEach(function (g) { g.dispose(); });
    this.res.texs.forEach(function (t) { t.dispose(); });
    this.res.inst.forEach(function (m) { try { m.dispose(); } catch (e) { /* r149 */ } });
    this.res = { mats: [], geos: [], texs: [], subs: [], inst: [] };
    this.systems = [];
  };
  Stage.prototype.liveParticles = function () {
    var n = 0;
    this.systems.forEach(function (p) { var a = p.geo.attributes.aColor.array; for (var i = 3; i < a.length; i += 4) if (a[i] > 0.004) n++; });
    return n;
  };

  // ------------------------------------------------------------------
  //  Shared stage props: card glyph, school sigil, summon portal, shock ring
  // ------------------------------------------------------------------
  function CardGlyph(S, t0, t1, opts) {
    opts = opts || {};
    var K = fx(), F = S.F, card = S.card;
    var tex = S.ownTex(new T.CanvasTexture(cardCanvas(card)));
    var mat = S.own(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true }));
    mat.toneMapped = false;
    var spr = new T.Sprite(mat); spr.renderOrder = 30; S.root.add(spr);
    var glow = S.halo(S.pal.a, 2.6, 0.5); glow.renderOrder = 29;
    var h = F.ch, top = h + 0.55 + Math.min(0.6, h * 0.12);
    var W = clamp(0.8 + h * 0.16, 0.9, 1.4), HH = W * 1.375;
    var base = F.C.clone().addScaledVector(F.f, 0.15);
    var burstDone = false;
    return function (a, dt) {
      var vis = a >= t0 && a < t1 + 0.16;
      spr.visible = glow.visible = vis;
      if (!vis) { if (a >= t1 && !burstDone) { burstDone = true; } return; }
      var kin = eBack(seg(a, t0, t0 + 0.35)), kout = seg(a, t1, t1 + 0.16);
      var flip = Math.abs(Math.cos(seg(a, t0, t0 + 0.45) * PI * 2));     // two flips as it rises
      var y = lerp(h * 0.55, top, eOut(seg(a, t0, t0 + 0.45))) + Math.sin(wt() * 3) * 0.04 + kout * 0.5;
      spr.position.copy(base).setY(y);
      var sc = Math.max(0.01, kin) * (1 + 0.25 * kout);
      spr.scale.set(W * sc * Math.max(0.08, flip), HH * sc, 1);
      mat.opacity = 1 - kout;
      glow.position.copy(spr.position);
      var gs = 2.6 * W * sc * (1 + 0.15 * Math.sin(wt() * 9)); glow.scale.set(gs, gs, 1);
      glow.material.opacity = 0.5;
      if (kout > 0 && !burstDone) {
        burstDone = true;
        S.std();
        for (var i = 0; i < 26; i++) {
          var th = S.r() * TAU, el = (S.r() - 0.3) * 1.6, sp = 1.5 + S.r() * 2.5;
          S.pa.emit(spr.position.x + (S.r() - 0.5) * W, spr.position.y + (S.r() - 0.5) * HH, spr.position.z + (S.r() - 0.5) * 0.2,
            Math.cos(th) * sp, Math.sin(el) * sp + 0.5, Math.sin(th) * sp, 0.6, 0.28, 0.02, S.pal.Co, S.pal.A, 1, -1, 2);
        }
        if (!opts.quiet) S.sound('card_flip');
      }
    };
  }

  // flat school sigil on the ground (two layers: coloured normal + additive glow) + a light column
  function Sigil(S, at, R, t0, t1, opts) {
    opts = opts || {};
    var K = fx(), sc = opts.school || S.school, pal = opts.pal || S.pal;
    var tex = K.sigilTex(sc in K.FXPAL ? sc : null);
    var m1 = S.own(new T.MeshBasicMaterial({ map: tex, color: pal.a, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    var m2 = S.own(new T.MeshBasicMaterial({ map: tex, color: pal.b, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    m1.toneMapped = m2.toneMapped = false;
    var d1 = S.mesh(K.UG.plane(), m1), d2 = S.mesh(K.UG.plane(), m2);
    d1.renderOrder = 5; d2.renderOrder = 6;
    var colM = opts.column === false ? null : S.own(K.gradMat(pal.a, false));
    var colm = colM ? S.mesh(K.UG.cyl(), colM) : null;
    var p = at.clone();
    d1.position.set(p.x, 0.09, p.z); d2.position.set(p.x, 0.1, p.z); if (colm) colm.position.set(p.x, 0, p.z);
    var em = 0;
    return function (a, dt) {
      var vis = a >= t0 && a < t1;
      d1.visible = d2.visible = vis; if (colm) colm.visible = vis;
      if (!vis) return;
      var kin = eBack(seg(a, t0, t0 + 0.28)), kout = seg(a, t1 - 0.3, t1);
      var s = 2 * R * Math.max(0.01, kin) * (1 + 0.08 * kout);
      d1.scale.set(s, 1, s); d2.scale.set(s, 1, s);
      d1.rotation.y = d2.rotation.y = (opts.spin || 1.4) * wt();
      m1.opacity = 0.95 * (1 - kout); m2.opacity = (0.5 + 0.3 * Math.sin(wt() * 22)) * (1 - kout);
      if (colm) {
        var ch = opts.colH || 1.6;
        colm.scale.set(R * 0.75 * (0.6 + 0.4 * kin), ch * eOut(seg(a, t0 + 0.05, t0 + 0.35)) * (1 - kout * 0.6), R * 0.75 * (0.6 + 0.4 * kin));
        colM.opacity = 0.18 * (1 - kout) * (opts.colOp || 1);
      }
      if (dt > 0 && a < t1 - 0.2) {
        S.std(); em += dt * (opts.rate || 55);
        while (em >= 1) {
          em -= 1;
          var th = S.r() * TAU, r = R * (0.55 + S.r() * 0.45);
          if (S.r() < 0.6) S.pc.emit(p.x + Math.cos(th) * r, 0.12, p.z + Math.sin(th) * r, 0, 1.1 + S.r() * 1.8, 0, 0.6, 0.2, 0.04, pal.A, pal.D, 0.9, 0, 0.5);
          else S.pa.emit(p.x + Math.cos(th) * r, 0.12, p.z + Math.sin(th) * r, 0, 1.3 + S.r() * 1.8, 0, 0.5, 0.2, 0.02, pal.Co, pal.A, 1, 0, 0.5);
        }
      }
    };
  }

  function swirlTex() {
    var K = fx();
    return K.ctex('cine_swirl', function () {
      var N = 256, c = K.canvas(N, N), x = c.getContext('2d'), m = N / 2;
      var g = x.createRadialGradient(m, m, 0, m, m, m);
      g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.55, 'rgba(255,255,255,0.35)'); g.addColorStop(0.92, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(m, m, m, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineCap = 'round';
      for (var k = 0; k < 7; k++) {
        x.lineWidth = 5 + (k % 3) * 3; x.beginPath();
        for (var i = 0; i <= 40; i++) { var u = i / 40, a = k * TAU / 7 + u * 2.6, r = m * (0.12 + u * 0.82); if (!i) x.moveTo(m + Math.cos(a) * r, m + Math.sin(a) * r); else x.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); }
        x.stroke();
      }
      return new T.CanvasTexture(c);
    });
  }
  // summon portal: dark swirling disc + bright rim + rising sparks (+ optional spout column)
  function Portal(S, at, R, t0, t1, opts) {
    opts = opts || {};
    var K = fx(), pal = opts.pal || S.pal;
    var tex = swirlTex();
    var dark = S.own(new T.MeshBasicMaterial({ color: pal.deep.clone().multiplyScalar(0.55), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    var sw = S.own(new T.MeshBasicMaterial({ map: tex, color: pal.a, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    var swA = S.own(new T.MeshBasicMaterial({ map: tex, color: pal.b, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    var rim = S.fade(K.bodyMat(pal.b, 0.95));
    var md = S.mesh(K.UG.disc(), dark), m1 = S.mesh(K.UG.plane(), sw), m2 = S.mesh(K.UG.plane(), swA), mr = S.mesh(K.UG.ring(), rim);
    md.renderOrder = 4; m1.renderOrder = 5; m2.renderOrder = 6; mr.renderOrder = 6;
    var p = at.clone(), y = opts.y || 0;
    md.position.set(p.x, y + 0.07, p.z); m1.position.set(p.x, y + 0.08, p.z); m2.position.set(p.x, y + 0.09, p.z); mr.position.set(p.x, y + 0.1, p.z);
    var spout = null, spM = null;
    if (opts.spout) { spM = S.own(K.gradMat(pal.a, false)); spout = S.mesh(K.UG.cylT(), spM); spout.position.set(p.x, y, p.z); }
    var em = 0;
    var o = {
      pos: p,
      tick: function (a, dt) {
        var vis = a >= t0 && a < t1;
        md.visible = m1.visible = m2.visible = mr.visible = vis; if (spout) spout.visible = vis;
        if (!vis) return;
        var kin = eBack(seg(a, t0, t0 + 0.3)), kout = seg(a, t1 - 0.35, t1);
        var s = R * Math.max(0.01, kin) * (1 - 0.6 * eIn(kout));
        md.scale.setScalar(s * 0.95); m1.scale.set(s * 2, 1, s * 2); m2.scale.set(s * 2.05, 1, s * 2.05); mr.scale.setScalar(s * 1.02);
        m1.rotation.y = -wt() * (opts.spin || 3); m2.rotation.y = -wt() * (opts.spin || 3) * 1.3;
        dark.opacity = 0.85 * (1 - kout); sw.opacity = 0.9 * (1 - kout); swA.opacity = (0.5 + 0.25 * Math.sin(wt() * 17)) * (1 - kout); rim.opacity = 0.9 * (1 - kout);
        if (spout) {
          var sh = (opts.spout || 2) * eOut(seg(a, t0 + 0.1, t0 + 0.45)) * (1 - kout);
          spout.scale.set(s * 0.75, Math.max(0.01, sh), s * 0.75); spM.opacity = 0.55 * (1 - kout); spout.rotation.y = wt() * 4;
        }
        if (dt > 0 && a < t1 - 0.2) {
          S.std(); em += dt * (opts.rate || 70);
          while (em >= 1) {
            em -= 1;
            var th = S.r() * TAU, r = s * (0.3 + S.r() * 0.7), tx = -Math.sin(th) * 2, tz = Math.cos(th) * 2;
            if (S.r() < 0.55) S.pc.emit(p.x + Math.cos(th) * r, y + 0.15, p.z + Math.sin(th) * r, tx, 1.5 + S.r() * 2.5, tz, 0.65, 0.26, 0.05, pal.Bc, pal.D, 0.95, 0, 1);
            else S.pa.emit(p.x + Math.cos(th) * r, y + 0.15, p.z + Math.sin(th) * r, tx, 2 + S.r() * 2.5, tz, 0.55, 0.22, 0.02, pal.Co, pal.A, 1, 0, 1);
          }
        }
      }
    };
    return o;
  }

  // expanding ground shock ring (normal-blended so it reads on bright grass)
  function Shock(S, color, op) {
    var K = fx(), m = S.fade(K.bodyMat(color || S.pal.b, op || 0.9));
    var r = S.mesh(K.UG.ring(), m); r.visible = false; r.renderOrder = 4;
    var t = -1, R = 3, at = new T.Vector3(), life = 0.6;
    return {
      go: function (p, radius, lf) { at.copy(p); R = radius || 3; life = lf || 0.6; t = 0; r.visible = true; r.position.set(at.x, 0.1, at.z); },
      tick: function (dt) { if (t < 0) return; t += dt; var k = t / life; if (k >= 1) { r.visible = false; t = -1; return; } r.scale.setScalar(0.3 + R * eOut(k)); m.opacity = (op || 0.9) * (1 - k); }
    };
  }

  // the impact "pow": white-hot flash + star glint + radial impact streaks + ground shock
  // + school particle burst (+ debris for stone). No translucent dome (art bible §6.1).
  function Boom(S, o) {
    o = o || {};
    var K = fx(), pal = S.pal;
    var fm = S.own(new T.SpriteMaterial({ map: K.haloTex(), color: pal.hot, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    fm.depthTest = false;
    var flashS = new T.Sprite(fm); flashS.visible = false; flashS.renderOrder = 40; S.root.add(flashS);
    var sm = S.own(new T.SpriteMaterial({ map: K.starTex(), color: pal.core, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    sm.depthTest = false;
    var starS = new T.Sprite(sm); starS.visible = false; starS.renderOrder = 41; S.root.add(starS);
    var rayM = S.fade(K.bodyMat(o.rayColor || pal.b, 0.95)), rays = [];
    var nr = o.rays != null ? o.rays : 9;
    for (var i = 0; i < nr; i++) { var m = S.mesh(K.UG.cone(), rayM); m.visible = false; m.renderOrder = 8; rays.push({ m: m, d: new T.Vector3() }); }
    var shock = Shock(S, o.ringColor || pal.b), shock2 = Shock(S, pal.a, 0.75);
    var debris = (S.school === 'stoneward' || o.debris) ? K.Debris(S.std(), o.debrisN || 8) : null;
    var t = -1, sz = 1, szV = 1, at = new T.Vector3();
    fm.color.lerp(pal.a, 0.35);
    return {
      go: function (p, size, nParts, ground) {
        t = 0; sz = size || 1; at.copy(p);
        szV = Math.min(sz, 1.7);           // visual size of the flash / star / rays is capped: big spells hit harder, not whiter
        flashS.visible = starS.visible = true;
        flashS.position.copy(p); starS.position.copy(p);
        rays.forEach(function (r) {
          var th = S.r() * TAU, el = (S.r() - 0.25) * 1.4;
          r.d.set(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el));
          r.m.visible = true;
        });
        S.burst(p, nParts != null ? nParts : Math.round(30 + 18 * sz), Math.sqrt(sz));
        var g = ground || new T.Vector3(p.x, 0, p.z);
        shock.go(g, 1.6 + sz * 1.4, 0.55); shock2.go(g, 1.0 + sz * 0.9, 0.4);
        if (debris) debris.launch(_vb.set(p.x, Math.max(0.3, p.y * 0.5), p.z), Math.sqrt(sz));
      },
      tick: function (dt) {
        shock.tick(dt); shock2.tick(dt);
        if (debris) debris.update(dt);
        if (t < 0) return;
        t += dt;
        var kf = t / 0.24, ks = t / 0.2, kr = t / 0.3;
        flashS.visible = kf < 1; starS.visible = ks < 1;
        if (kf < 1) { var fs = 0.6 + szV * (0.45 + 0.85 * eOut(Math.min(1, kf * 3))); flashS.scale.set(fs, fs, 1); fm.opacity = 0.5 * (1 - kf * kf); }
        if (ks < 1) { var ss = (0.8 + szV * 1.0) * (1 - ks * 0.6); starS.scale.set(ss, ss, 1); sm.rotation = 0.6 + ks * 0.5; sm.opacity = 0.75 * (1 - ks); }
        rays.forEach(function (r) {
          r.m.visible = kr < 1;
          if (kr >= 1) return;
          var d0 = szV * (0.45 + 1.25 * eOut(kr)), len = szV * (0.85 * Math.sin(Math.min(1, kr * 1.3) * PI) + 0.05);
          r.m.position.copy(at).addScaledVector(r.d, d0);
          r.m.quaternion.setFromUnitVectors(UPV, r.d);
          r.m.scale.set(0.05 * szV * (1 - kr), Math.max(0.01, len), 0.05 * szV * (1 - kr));
        });
        rayM.opacity = 0.8 * (1 - kr);
        if (kf >= 1 && ks >= 1 && kr >= 1) t = -1;
      }
    };
  }

  // ------------------------------------------------------------------
  //  The running cinematic
  // ------------------------------------------------------------------
  function Cine(spec, def, card) {
    var self = this;
    this.id = ++uid;
    this.spec = spec; this.def = def; this.card = card;
    this.school = def.school || card.school || 'hollow';
    var S0 = (WF.data && WF.data.schools) || {};
    this.color = (S0[card.school] && S0[card.school].color) || '#a879ff';
    if (def.color) this.color = def.color;
    this.seed = spec.seed != null ? spec.seed : (Math.random() * 1e9) | 0;
    this.F = Frame(spec);
    this.reduceMotion = !!spec.reduceMotion;
    this.speed = spec.speed > 0 ? spec.speed : 1;
    this.t = 0; this.rate = 1; this.stopT = 0;
    this.rt = 0;                  // v1.2 WS1: real seconds since the start (this.t = story seconds)
    this.events = [];
    this.muted = false; this.finished = false; this.skipped = false;
    var len = storyLen(def, this.F, card);
    // story (v1.1-authored) times drive the choreography; dur / TI / TIend are REAL seconds
    this.sDur = len.dur; this.sTI = len.impact; this.sTIend = len.impactEnd || len.impact;
    this.warp = spec.retime !== false && retimes(def, spec.mode, false) ? Warp(def, this.sDur, this.sTI, this.sTIend, RETIME) : null;
    var w = this.warp;
    this.dur = w ? w.dur : this.sDur; this.TI = w ? w.r(this.sTI) : this.sTI; this.TIend = w ? w.r(this.sTIend) : this.sTIend;
    this.landed = {}; this.landCount = 0;
    this.resolvers = {}; this.promises = {};
    this.F.targets.forEach(function (t, i) { self.promises[i] = new Promise(function (r) { self.resolvers[i] = r; }); });
    this.impact = Promise.race(this.F.targets.map(function (t, i) { return self.promises[i]; }));
    this.done = new Promise(function (r) { self._done = r; });
    this.states = {};
    this.refs = {};
    this.stage = new Stage(this);
    CI._building = this;   // lets CI.play free a half-built stage if setup throws
    // stage setup (before the camera so shots can follow creatures in this.refs)
    var S = this.stage, ticks = [];
    this.ticks = ticks;
    if (!def.bare) {
      if (def.card !== false) ticks.push(CardGlyph(S, 0.04, def.cardOut != null ? def.cardOut : Math.min(0.8, this.sTI * 0.5)));
      if (def.sigil !== false) ticks.push(Sigil(S, this.F.C, clamp(0.95 + this.F.ch * 0.18, 1.1, 1.8), 0.0, def.sigilOut != null ? def.sigilOut : Math.min(1.25, this.sTI * 0.85 + 0.2)));
    }
    var main = def.build ? def.build(S, this.F, this) : null;
    if (main) ticks.push(main);
    // camera
    this.ownCam = !!(spec.camera && def.cam && !this.reduceMotion && spec.mode !== 'quick' && !def.noCam);
    if (this.ownCam) {
      var keys = def.cam(this.F, this);
      if (keys && keys.length) {
        this.track = new Track(this.F, keys, spec, this.sDur);
        var cam = spec.camera;
        this.track.homeFov = cam.fov;
        this.track.start.P.copy(cam.position);
        if (spec.look0) this.track.start.L.copy(spec.look0);
        else { cam.getWorldDirection(_va); this.track.start.L.copy(cam.position).addScaledVector(_va, 10); }
        this.track.start.fov = cam.fov;
        if (spec.onShots) { try { spec.onShots(this.track.samples()); } catch (e) { /* ignore */ } }
      } else this.ownCam = false;
    }
    // caster wind-up (W101 wand twirl); 'cast_big' only on models that advertise it
    if (def.windup !== false) {
      var st = this.pickState(spec.caster, def.bigCast ? ['cast_big', 'cast'] : ['cast']);
      // the wand twirl / summon pose is held for the (retimed) anticipation
      var wu = def.windupDur || Math.min(1.4, Math.max(0.9, this.sTI * 0.7));
      this.setState(spec.caster, st, w ? w.r(wu) : wu);
    }
    if (def.castSound !== false) S.sound(def.castSound || ('cast_' + (card.school || 'hollow')));
    if (def.summonSound) S.at(def.summonSound[0], function () { S.sound(def.summonSound[1] || 'summon'); });
    this.advance(0);
  }
  Cine.prototype.pickState = function (obj, list) {
    var known = null;
    try { known = this.spec.states ? this.spec.states(obj) : CI.statesOf(obj); } catch (e) { known = null; }
    if (!known) return list[list.length - 1];
    for (var i = 0; i < list.length; i++) if (known.indexOf(list[i]) >= 0) return list[i];
    return list[list.length - 1];
  };
  Cine.prototype.setState = function (obj, s, dur) {
    if (!obj || !this.spec.setState) return;
    try { this.spec.setState(obj, s, dur); } catch (e) { /* ignore */ }
  };
  Cine.prototype.land = function (i) {
    if (this.landed[i] || !this.resolvers[i]) return;
    this.landed[i] = true; this.landCount++;
    if (!this.firstLand) { this.firstLand = true; this.stopT = this.skipped ? 0 : 0.08; }
    try { this.resolvers[i](); } catch (e) { /* ignore */ }
  };
  // dt = REAL seconds. Choreography (ticks' `a`, events, camera, landing) runs on story time
  // a = warp(rt); ticks get the real dt (emission / physics / timers) and Q.wt() = rt.
  Cine.prototype.advance = function (dt) {
    if (this.finished) return;
    var r = this.rate;
    if (this.stopT > 0) { this.stopT -= dt; r *= 0.22; }          // tiny hit-stop at the first impact
    var d = dt * r;
    this.rt += d;
    var a = this.t = this.warp ? this.warp.a(this.rt) : this.rt;
    var prevWT = curWT; curWT = this.rt;
    try {
      for (var i = 0; i < this.ticks.length; i++) this.ticks[i](a, d);
    } catch (e) { if (window.console) console.error('cine tick failed', this.def.id, e); this.t = a = Math.max(this.t, this.sDur); this.rt = Math.max(this.rt, this.dur); }
    for (var k = 0; k < this.events.length; k++) { var ev = this.events[k]; if (!ev.done && a >= ev.t) { ev.done = true; try { ev.fn(); } catch (e2) { /* ignore */ } } }
    this.stage.tick(d);
    curWT = prevWT;
    if (a >= this.sTIend) for (var j = 0; j < this.F.targets.length; j++) this.land(j);
    if (this.ownCam && this.spec.camera) {
      var p = this.track.eval(Math.min(a, this.sDur)), cam = this.spec.camera;
      cam.position.copy(p.P).add(CI.shakeOffset(_vb));
      cam.lookAt(p.L);
      if (Math.abs(cam.fov - p.fov) > 0.01) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
      this.lastLook = p.L;
    }
    if (a >= this.sDur) this.finish();
  };
  Cine.prototype.skip = function () {
    if (this.finished || this.skipped) return;
    this.skipped = true;
    // fast-forward the simulation (no rendering) to the last impact, sounds muted
    var target = this.sTIend + 0.001, guard = 0;
    this.muted = true;
    while (this.t < target && !this.finished && guard++ < 900) this.advance(1 / 30);
    this.muted = false;
    this.rate = 1.8;
  };
  Cine.prototype.finish = function () {
    if (this.finished) return;
    this.finished = true;
    for (var j = 0; j < this.F.targets.length; j++) this.land(j);
    if (this.ownCam && this.spec.camera) {
      var cam = this.spec.camera, hp = new T.Vector3(), hl = new T.Vector3();
      if (this.spec.home) { this.spec.home(hp, hl); cam.position.copy(hp); cam.lookAt(hl); this.lastLook = hl; }
      if (Math.abs(cam.fov - this.track.homeFov) > 0.01) { cam.fov = this.track.homeFov; cam.updateProjectionMatrix(); }
    }
    this.stage.free();
    if (this.usedDim) dim(0);
    var i = running.indexOf(this); if (i >= 0) running.splice(i, 1);
    if (camOwner === this) camOwner = null;
    try { this._done(); } catch (e) { /* ignore */ }
  };

  // ------------------------------------------------------------------
  //  Public
  // ------------------------------------------------------------------
  function def(id, d) { d.id = id; DEFS[id] = d; return d; }
  CI.def = def;
  CI.defs = DEFS;
  CI.list = function () { return Object.keys(DEFS); };

  function cardOf(c) { if (!c) return null; if (typeof c === 'string') return (WF.data.cards || {})[c] || null; return c; }

  // default cinematic per card when card.cine is absent (keeps future spells animated)
  CI.resolve = function (c, mode, _depth) {
    var card = cardOf(c); if (!card) return 'q_generic';
    if (mode === 'quick') return 'q_' + (['damage', 'aoe', 'dot'].indexOf(card.type) >= 0 ? 'attack' : 'mini');
    if (card.cine && DEFS[card.cine]) return card.cine;
    // ---- v1.2 WS1: `cineAs` borrows an existing cinematic (V1.2-CONTRACT §2.6/§3):
    //   cineAs: '<cine id>'  -> that cinematic;  cineAs: '<card id>' -> whatever that card plays
    if (card.cineAs) {
      if (DEFS[card.cineAs]) return card.cineAs;
      var other = (WF.data.cards || {})[card.cineAs];
      if (other && other !== card && (_depth || 0) < 4) return CI.resolve(other, mode, (_depth || 0) + 1);
    }
    var sc = card.school, p = card.pips || 0, t = card.type;
    var byType = { heal: 'heal_', hot: 'hot_', blade: 'blade_', trap: 'trap_', shield: 'shield_', absorb: 'absorb_', weakness: 'weak_' }[t];
    if (byType) { var k = byType + sc; return DEFS[k] ? k : (DEFS[byType + 'any'] ? byType + 'any' : 'q_mini'); }
    var tbl = {
      emberstrike: { 1: 'spark_newt', 2: 'fireball', 3: 'gale_hawk', 4: 'skyrend_drake', 5: 'phoenix' },
      stoneward: { 1: 'pebble_golem', 2: 'stone_boar', 3: 'golem_fist', 4: 'quake_ram', 5: 'titan' },
      tidecaller: { 1: 'water_sprite', 2: 'undertow', 3: 'wave_serpent', 4: 'maelstrom', 5: 'leviathan' },
      lumen: { 1: 'sunburst', 2: 'sunburst', 3: 'sunburst', 4: 'sunburst', 5: 'sunburst' },
      hollow: { 1: 'shadow_jaws', 2: 'gloom_wisp', 3: 'dread_wave', 4: 'bone_hand', 5: 'night_terror', 6: 'eclipse' }
    }[sc];
    if (t === 'aoe') { var aoe = { emberstrike: 'firestorm', stoneward: 'quake_ram', tidecaller: 'maelstrom', lumen: 'sunburst', hollow: 'bog_belch' }[sc]; if (aoe && DEFS[aoe]) return aoe; }
    if (t === 'dot') { var dt = { emberstrike: p >= 3 ? 'wildfire' : 'ember_moth', hollow: p >= 3 ? 'rot_bloom' : 'bog_spit' }[sc]; if (dt && DEFS[dt]) return dt; }
    if (tbl) { var id = tbl[Math.min(p >= 6 ? 6 : Math.max(1, p), sc === 'hollow' ? 6 : 5)] || tbl[5]; if (id && DEFS[id]) return id; }
    return 'q_attack';
  };
  // length(card, mode, { classic }) -> { dur, impact } REAL seconds at speed 1.
  // mode defaults to 'full'; classic: true gives the v1.1 timing (what "Fast combat animations" plays).
  CI.length = function (c, mode, opts) {
    var card = cardOf(c); if (!card) return { dur: 0, impact: 0 };
    mode = mode || 'full';
    var d = DEFS[CI.resolve(card, mode)] || DEFS.q_attack;
    var l = storyLen(d, null, card);
    if (!retimes(d, mode, opts && opts.classic)) return { dur: l.dur, impact: l.impact };
    var w = Warp(d, l.dur, l.impact, l.impactEnd || l.impact, RETIME);
    return { dur: w.dur, impact: w.r(l.impact), classicDur: l.dur, classicImpact: l.impact };
  };

  CI.play = function (spec) {
    var card = cardOf(spec.card);
    var noop = { impact: Promise.resolve(), done: Promise.resolve(), skip: function () {}, abort: function () {}, impactFor: function () { return Promise.resolve(); }, id: 0, length: 0 };
    if (!card || !spec.scene) return noop;
    var mode = spec.mode || CI.modeSetting();
    spec.mode = mode;
    // v1.2 WS1: retime unless the caller (combatView) or the "Fast combat animations" setting says v1.1 timing
    if (spec.retime == null) spec.retime = true;   // v2.0: always the v1.2 timing
    var id = spec.fizzle ? 'fizzle' : (spec.cine && DEFS[spec.cine] ? spec.cine : CI.resolve(card, mode));
    var d = DEFS[id] || DEFS.q_attack;
    var c;
    try { c = new Cine(spec, d, card); }
    catch (e) {
      if (window.console) console.error('cinematic failed to start', id, e);
      if (CI._building) { try { CI._building.finished = true; CI._building.stage.free(); } catch (e2) { /* ignore */ } }
      CI._building = null;
      return noop;
    }
    CI._building = null;
    if (c.finished) return { id: c.id, cine: d.id, length: c.dur, impactTime: c.TI, impact: c.impact, done: c.done, impactFor: function () { return c.impact; }, skip: function () {}, abort: function () {}, _c: c };
    running.push(c);
    if (c.ownCam) { if (camOwner && camOwner !== c) camOwner.ownCam = false; camOwner = c; }
    lastReal = performance.now();
    startWatchdog();
    var targetIds = c.F.targets.map(function (t) { return t.id; });
    return {
      id: c.id, cine: d.id, length: c.dur, impactTime: c.TI,
      impact: c.impact, done: c.done,
      impactFor: function (tid) { var i = targetIds.indexOf(tid); return i >= 0 ? c.promises[i] : c.impact; },
      skip: function () { c.skip(); },
      abort: function () { c.finish(); },
      _c: c
    };
  };

  CI.update = function (dt) {
    lastReal = performance.now();
    if (shk.t < shk.dur) shk.t += dt;
    if (!running.length) return;
    var list = running.slice();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      try { c.advance(dt / c.speed); } catch (e) { if (window.console) console.error(e); c.finish(); }
    }
  };
  CI.skip = function () { running.slice().forEach(function (c) { c.skip(); }); };
  CI.abortAll = function () { running.slice().forEach(function (c) { c.finish(); }); };
  CI.active = function () { return running.length > 0; };
  CI.ownsCamera = function () { return !!(camOwner && !camOwner.finished && camOwner.ownCam); };
  CI.lastLook = function (out) { if (camOwner && camOwner.lastLook && out) out.copy(camOwner.lastLook); return out; };
  CI.stats = function () {
    var parts = 0, live = 0, meshes = 0;
    running.forEach(function (c) {
      parts += PART_CAP - c.stage.capLeft; live += c.stage.liveParticles();
      c.stage.root.traverse(function (o) { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible) meshes++; });
    });
    return { running: running.length, particleCapacity: parts, liveParticles: live, objects: meshes };
  };

  // If frames stop (hidden tab / stalled loop) keep cinematics moving so duels never hang.
  var watchdogOn = true;
  CI.setWatchdog = function (on) { watchdogOn = on !== false; };   // labs doing deterministic frame-stepping turn it off
  function startWatchdog() {
    if (watchdog || !watchdogOn) return;
    watchdog = setInterval(function () {
      if (!running.length || !watchdogOn) { clearInterval(watchdog); watchdog = null; return; }
      var now = performance.now(), gap = now - lastReal;
      if (gap > 1200) { lastReal = now; CI.update(Math.min(0.5, gap / 1000)); }
    }, 250);
  }

  // expose building blocks to the definitions below (and to labs)
  CI._k = {
    swirlTex: swirlTex, fx: fx, Stage: Stage, Frame: Frame, Track: Track, SHOTS: SHOTS, CardGlyph: CardGlyph, Sigil: Sigil, Portal: Portal, Shock: Shock, Boom: Boom, follow: follow,
    clamp: clamp, seg: seg, eOut: eOut, eIn: eIn, eIn3: eIn3, eInOut: eInOut, eBack: eBack, smooth: smooth, bell: bell, lerp: lerp,
    V: V, toV: toV, bez: bez, qbez: qbez, faceDir: faceDir, faceFlat: faceFlat, rgb: rgb, col: col, seeded: seeded,
    shake: shake, flash: flash, bloomPulse: bloomPulse, sfx: sfx, cardCanvas: cardCanvas, PART_CAP: PART_CAP,
    wt: wt, Warp: Warp      // v1.2 WS1
  };
  return CI;
})();

// =====================================================================
//  CINEMATIC DEFINITIONS
//  def(id, { school?, dur, impact, impactEnd?, cam(F) -> keys, build(S, F, cine) -> tick(a, dt),
//            card?, sigil?, cardOut?, sigilOut?, windup?, bigCast?, castSound?, summonSound? })
//  Camera keys: [time, shot, { blend, push, pull, orbit, rise, dp, dl, fov, fov2, lookRise }]
//  Shots: caster casterWide casterTop shoulder side target targets targetLow sky wide reverse home cur
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, T = window.THREE, PI = Math.PI, TAU = PI * 2;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var def = CI.def;
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3();
  function K() { return Q.fx(); }

  // ---------------- creature-building kit ----------------
  // glow creature part: merged unlit vertex-colour mesh (+ additive inverted-hull rim)
  function dblGlow() { return K().cmat('cine_vcglow_dbl', function () { var m = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }); return m; }); }
  function glowPart(S, key, build, parent, rim, o) {
    var k = K(), geos = k.cachedGeos('cine_' + key, build), g = geos.g;
    var root = S.group(parent);
    if (g) {
      var m = S.mesh(g, o && o.dbl ? dblGlow() : k.vcGlowMat(), root);
      if (rim && !geos.f) S.mesh(k.SG('cine_rim_' + key, function () { return k.inflate(g, rim[0]); }), k.rimMat(rim[1], rim[2] || 0.8), m);
    }
    if (geos.s) { var ms = S.mesh(geos.s, k.vcMat(false), root); ms.castShadow = true; }
    if (geos.f) { var mf = S.mesh(geos.f, k.vcMat(true), root); mf.castShadow = true; if (rim) S.mesh(k.SG('cine_rimf_' + key, function () { return k.inflate(geos.f, rim[0]); }), k.rimMat(rim[1], rim[2] || 0.6), mf); }
    return root;
  }
  function G() { return K().G; }
  function C3(F, base, fw, up, sd) { return base.clone().addScaledVector(F.f, fw).addScaledVector(F.s, sd).setY(base.y + up); }
  // point in the caster frame (fwd toward target, up, side toward the home camera)
  function cp(F, fw, up, sd) { return C3(F, F.C, fw, up, sd); }
  function tp(F, i, fw, up, sd) { return C3(F, F.feet(i), fw, up, sd); }
  function emitN(S, n, fn) { for (var i = 0; i < n; i++) fn(i); }
  function rate(r) { var acc = 0; return function (dt, fn) { acc += r * dt; var n = Math.floor(acc); acc -= n; for (var i = 0; i < n; i++) fn(i); }; }

  // a flying "head" along a curve with trail particles; returns { obj, update(k01, dt) }
  function Flyer(S, obj, curve, trailRate, trailFn) {
    var cur = new T.Vector3(), nx = new T.Vector3(), prev = null, em = rate(trailRate || 120);
    return {
      obj: obj, pos: cur,
      update: function (k, dt, noFace) {
        curve(clamp(k, 0, 1), cur); curve(clamp(k + 0.02, 0, 1.02), nx).sub(cur);
        obj.position.copy(cur); if (!noFace && nx.lengthSq() > 1e-8) faceDir(obj, nx);
        if (dt > 0 && obj.visible) {
          var p0 = prev || cur.clone();
          em(dt, function () { var u = S.r(); _a.lerpVectors(p0, cur, u); if (trailFn) trailFn(_a); else S.trail(_a.x, _a.y, _a.z); });
        }
        prev = (prev || new T.Vector3()).copy(cur);
      }
    };
  }

  // ===================================================================
  //  QUICK MODE (v1.0-style effects, no camera) + generic fallbacks
  // ===================================================================
  function quickKind(card) {
    if (card.fx) return card.fx;
    if (WF.models.spellFxKind) return WF.models.spellFxKind(card.school, card.pips || 1, card.type, card.id);
    return 'bolt';
  }
  def('q_attack', {
    len: function (F, card) {
      var lead = 0.32, imp = 0.55, tail = 0.6;
      var kind = quickKind(card);
      imp = { bolt: 0.5, meteor: 0.85, spike: 0.4, wave: 0.65, beam: kind === 'beam' && card.school === 'tidecaller' ? 0.62 : 0.26, swarm: 0.62, big: 1.3 }[kind] || 0.5;
      var aoe = card.type === 'aoe' ? 0.24 : 0;
      return { dur: lead + imp + tail + aoe, impact: lead + imp, impactEnd: lead + imp + aoe };
    },
    noCam: true, card: true, cardOut: 0.4, sigil: false, windupDur: 0.9,
    // v1.2 WS1: its v1.0 spellFx run on their own real-time clock (fired at `lead`, impact fixed), so only the
    // wind-up before the fire and the hold after the last hit stretch; the flight itself stays real-time.
    // (Quick mode never retimes: this only applies when a full-mode card falls back to q_attack.)
    retime: function (dur, TI, TE) { return [[0.27, 1.0], [Math.min(dur - 0.06, TE + 0.06), 0], [dur, 0.8]]; },
    build: function (S, F, c) {
      var card = S.card, kind = quickKind(card), col = c.color, lead = 0.32, fired = false, list = [];
      var sg = WF.models.castSigil(col, { school: S.school in K().FXPAL ? S.school : null }); sg.position.set(F.C.x, 0.04, F.C.z); S.sub(sg);
      return function (a) {
        if (!fired && a >= lead) {
          fired = true;
          F.targets.forEach(function (t, i) {
            var o = WF.models.spellFx(kind, col, F.from, F.hit(i), { pips: card.pips || 1, school: S.school, aoe: F.targets.length > 1, delay: i * 0.08, targetHeight: t.h, seed: c.seed + i });
            S.sub(o); list.push({ i: i, at: lead + (o.userData.impact || 0.5) });
          });
        }
        list.forEach(function (l) { if (!l.done && a >= l.at) { l.done = true; S.land(l.i); } });
      };
    }
  });
  def('q_mini', {
    dur: 0.95, impact: 0.42, noCam: true, cardOut: 0.38, sigil: false, windupDur: 0.8,
    retime: [[0.33, 1.0], [0.48, 0], [0.95, 0.8]],     // v1.2 WS1: full-mode fallback only (quick never retimes)
    build: function (S, F, c) {
      var card = S.card, kind = card.type === 'heal' || card.type === 'hot' ? 'heal' : 'buff', done = false;
      var sg = WF.models.castSigil(c.color, { school: S.school in K().FXPAL ? S.school : null }); sg.position.set(F.C.x, 0.04, F.C.z); S.sub(sg);
      return function (a) {
        if (!done && a >= 0.38) {
          done = true;
          F.targets.forEach(function (t, i) {
            var colr = card.type === 'shield' ? '#7fd6ff' : card.type === 'absorb' ? '#cfe8ff' : card.type === 'weakness' ? '#9a9a9a' : (kind === 'heal' ? '#6fff9a' : c.color);
            var b = WF.models.burst(colr, kind); b.position.set(t.pos.x, 0, t.pos.z); S.sub(b);
          });
        }
      };
    }
  });
  def('q_generic', { dur: 0.6, impact: 0.3, noCam: true, retime: false, card: false, sigil: false, build: function () { return function () {}; } });

  // ===================================================================
  //  FIZZLE: the card rises, cracks and puffs into grey smoke
  // ===================================================================
  def('fizzle', {
    dur: 1.25, impact: 0.85, card: false, sigil: false, windupDur: 0.7, castSound: false,
    cam: function (F) { return [[0, 'caster', { push: 0.12, blend: 0.3 }], [0.95, 'home', { blend: 0.3 }]]; },
    build: function (S, F) {
      var k = K(), card = Q.CardGlyph(S, 0.04, 0.72, { quiet: true });
      var smoke = S.std(220), puffed = false;
      var top = F.C.clone().setY(F.ch + 0.9);
      return function (a, dt) {
        card(a, dt);
        if (a > 0.45 && a < 0.72 && dt > 0 && S.r() < 0.5) S.pa.emit(top.x + (S.r() - 0.5) * 0.6, top.y + (S.r() - 0.5) * 0.8, top.z, (S.r() - 0.5), 0.5, (S.r() - 0.5), 0.3, 0.12, 0.02, [1, 1, 1], [0.6, 0.6, 0.6], 1, -2, 1);
        if (!puffed && a >= 0.72) {
          puffed = true; S.sound('fizzle', true);
          for (var i = 0; i < 26; i++) {
            var th = S.r() * TAU, sp = 0.4 + S.r() * 1.2;
            (S.pn || S.pc).emit(top.x + Math.cos(th) * 0.2, top.y, top.z + Math.sin(th) * 0.2, Math.cos(th) * sp, 0.3 + S.r() * 0.8, Math.sin(th) * sp, 0.9 + S.r() * 0.5, 0.45, 1.3, [0.62, 0.6, 0.66], [0.4, 0.38, 0.44], 0.85, 0.3, 2.5);
          }
        }
      };
    }
  });

  // flat polygon (triangle fan from pts[0]) for wing membranes / fins; pts = [[x,y,z],...]
  function fanGeo(pts) {
    var pos = [];
    for (var i = 1; i < pts.length - 1; i++) pos.push(pts[0][0], pts[0][1], pts[0][2], pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }
  // teardrop flame tongue (base at y=0, tip at y=1), cached
  function flameGeo() {
    return K().SG('cine_flame', function () {
      return new T.LatheGeometry([[0, 0], [0.42, 0.07], [0.56, 0.24], [0.47, 0.46], [0.28, 0.7], [0.11, 0.9], [0, 1]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 10);
    });
  }
  CI._kit = { swirl: Q.swirlTex, glowPart: glowPart, dblGlow: dblGlow, fanGeo: fanGeo, flameGeo: flameGeo, cp: cp, tp: tp, C3: C3, Flyer: Flyer, rate: rate, emitN: emitN, quickKind: quickKind, K: K };
})();

// =====================================================================
//  EMBERSTRIKE — fire & storm creatures
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eIn3 = Q.eIn3, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, cp = KT.cp, tp = KT.tp, C3 = KT.C3, Flyer = KT.Flyer, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3();

  // fire orb with streaming flame tongues (used by Spark Newt, Fireball, meteors)
  function fireOrb(S, size, parent) {
    var k = K(), pal = S.pal, g = S.group(parent), spin = S.group(g), tongues = [];
    var core = S.mesh(k.UG.sph(), k.glow ? k.glow(pal.hot) : WF.models.glow(pal.hot), spin); core.scale.setScalar(0.55 * size);
    var shell = S.mesh(k.UG.sph(), k.bodyMat(pal.a, 0.85), spin); shell.scale.setScalar(0.85 * size);
    S.mesh(k.SG('rim_sph', function () { return k.inflate(k.UG.sph(), 0.18); }), k.rimMat(pal.hot, 0.7), shell);
    for (var f = 0; f < 5; f++) {
      var tg = S.mesh(k.UG.cone(), k.bodyMat(f === 0 ? pal.b : f >= 3 ? pal.deep : pal.a, 0.85), g);
      tg.rotation.x = -PI / 2; tg.position.set(Math.cos(f * 2.4) * 0.28 * size, Math.sin(f * 2.4) * 0.28 * size, 0.1 * size);
      tg.userData.L = (2.1 - f * 0.22) * size; tg.userData.w = (0.62 - f * 0.05) * size; tongues.push(tg);
    }
    var h = S.halo(pal.a, 3.2 * size, 0.55, g);
    return {
      g: g, core: core,
      anim: function (a, stretch) {
        spin.rotation.set(wt() * 6, wt() * 4, 0);
        tongues.forEach(function (tg, i) { var L = tg.userData.L * (stretch == null ? 1 : stretch) * (1 + Math.sin(wt() * 38 + i * 2) * 0.2); tg.scale.set(tg.userData.w, Math.max(0.01, L), tg.userData.w); });
        var hs = 3.2 * size * (1 + Math.sin(wt() * 30) * 0.08); h.scale.set(hs, hs, 1);
      }
    };
  }
  CI._kit.fireOrb = fireOrb;

  // flames licking up from the ground in a disc (after-burn)
  function groundFire(S, at, R, n) {
    for (var i = 0; i < n; i++) {
      var th = S.r() * TAU, rr = Math.sqrt(S.r()) * R, p = S.pal;
      S.pc.emit(at.x + Math.cos(th) * rr, 0.1, at.z + Math.sin(th) * rr, (S.r() - 0.5) * 0.4, 1.2 + S.r() * 2.2, (S.r() - 0.5) * 0.4, 0.45 + S.r() * 0.35, 0.42 + S.r() * 0.3, 0.08, p.Bc, p.D, 0.95, 1.5, 1.5);
    }
  }
  CI._kit.groundFire = groundFire;

  // ---------------------------------------------------------------
  //  SPARK NEWT (Spark Bolt, 1 pip): a little fire salamander pops out
  //  of a fire portal beside the caster, rears up and spits a crackling bolt.
  // ---------------------------------------------------------------
  function newtGeo(B) {
    var G = K().G, mix = K().mix;
    B.glow(G.sph(1, 14, 10), '#ff6a1f', { p: [0, 0.2, 0], s: [0.21, 0.16, 0.42] });
    B.glow(G.sph(1, 12, 8), '#ffcf4a', { p: [0, 0.14, 0.05], s: [0.16, 0.1, 0.34] });
    B.glow(G.sph(1, 14, 10), '#ff7d2a', { p: [0, 0.27, 0.43], s: [0.19, 0.15, 0.2] });
    B.glow(G.sph(1, 12, 8), '#ff9a3a', { p: [0, 0.235, 0.6], s: [0.13, 0.085, 0.12] });
    B.glow(G.sph(1, 10, 6), '#7a1500', { p: [0, 0.2, 0.62], s: [0.1, 0.02, 0.09] });           // mouth line
    [-1, 1].forEach(function (s) {
      B.glow(G.sph(0.078, 10, 8), '#fff6c8', { p: [s * 0.11, 0.36, 0.5] });
      B.glow(G.sph(0.038, 8, 6), '#2a0800', { p: [s * 0.125, 0.372, 0.565] });
      B.glow(G.sph(0.014, 6, 4), '#ffffff', { p: [s * 0.11, 0.39, 0.58] });
      B.glow(G.cyl(0.035, 0.05, 0.22, 6), '#d8461a', { p: [s * 0.2, 0.1, 0.22], r: [0.3, 0, s * 0.7] });
      B.glow(G.cyl(0.035, 0.05, 0.22, 6), '#d8461a', { p: [s * 0.2, 0.1, -0.2], r: [-0.3, 0, s * 0.7] });
      B.glow(G.sph(0.06, 6, 5), '#ffb03a', { p: [s * 0.28, 0.02, 0.26], s: [1.3, 0.45, 1.5] });
      B.glow(G.sph(0.06, 6, 5), '#ffb03a', { p: [s * 0.28, 0.02, -0.24], s: [1.3, 0.45, 1.5] });
    });
    for (var i = 0; i < 6; i++) B.glow(G.cone(0.07, 0.2 + (i > 0 && i < 4 ? 0.1 : 0), 6), mix('#ffe04a', '#ff3a0a', i / 5), { p: [0, 0.33 - i * 0.012, 0.42 - i * 0.15], r: [-0.45, 0, 0] });
  }
  function newtTailGeo(B) {
    var G = K().G;
    B.glow(G.taper([[0, 0, 0], [0, 0.02, -0.3], [0.13, 0.1, -0.58], [0.07, 0.3, -0.74]], 0.11, 0.025, 12, 6), '#ff5a14');
    B.glow(G.cone(0.07, 0.3, 6), '#ffd23a', { p: [0.06, 0.42, -0.74], r: [0.2, 0, 0] });
  }
  def('spark_newt', {
    dur: 1.9, impact: 1.22, summonSound: [0.3, 'summon_small'],
    cam: function (F) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.52, function (F2, P, L, u) { P.copy(cp(F2, -2.9, 1.15, 3.3)); L.copy(F2.hit(0)); L.y = Math.max(0.9, L.y * 0.8); }, { push: 0.18 }],
        [1.08, 'target', { push: 0.2 }], [1.5, 'home', { blend: 0.4 }]];
    },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.35, 0, 0.75);
      var portal = Q.Portal(S, at, 0.75, 0.24, 1.8, { rate: 50 });
      var root = S.group(), body = S.group(root);
      body.position.z = -0.2;
      var bodyIn = S.group(body); bodyIn.position.z = 0.2;
      var SC = 1.55;
      glowPart(S, 'newt', newtGeo, bodyIn, [0.035, '#ffd23a', 0.8]);
      var tail = glowPart(S, 'newtTail', newtTailGeo, bodyIn, [0.03, '#ffd23a', 0.8]); tail.position.set(0, 0.2, -0.38);
      var h = S.halo(pal.a, 1.6, 0.4, bodyIn); h.position.y = 0.3;
      root.scale.setScalar(SC);
      root.position.copy(at); faceFlat(root, _a.subVectors(F.T, at));
      var orb = fireOrb(S, 0.24);
      orb.g.visible = false;
      var arcs = [k.Lightning(S.ctx, 5, 0.055, WF.models.glow('#fffbe8'), k.bodyMat(pal.b, 0.75)), k.Lightning(S.ctx, 4, 0.05, WF.models.glow('#fffbe8'), k.bodyMat(pal.b, 0.75))];
      var mouth = new T.Vector3(), hit = F.front(0), P0 = new T.Vector3(), P1 = new T.Vector3();
      var imp = S.impactFx(), fired = false, landed = false, jit = 0;
      var trail = rate(70);
      return function (a, dt) {
        portal.tick(a, dt);
        var up = eBack(seg(a, 0.32, 0.62)), sink = eIn(seg(a, 1.55, 1.85));
        root.position.y = lerp(-0.75 * SC, 0, up) - sink * 0.8 * SC + 0.32 * SC * bell(a, 1.28, 1.52);
        root.visible = a > 0.3 && sink < 1;
        body.rotation.x = -0.55 * smooth(0.62, 0.8, a) * (1 - smooth(0.9, 1.05, a)) + 0.12 * bell(a, 0.86, 1.0);
        tail.rotation.y = Math.sin(wt() * 11) * 0.45; tail.rotation.x = Math.sin(wt() * 7) * 0.12;
        bodyIn.rotation.z = Math.sin(wt() * 14) * 0.05 * (a < 0.62 ? 1 : 0.4);
        root.updateMatrixWorld(true);
        mouth.set(0, 0.24, 0.72); bodyIn.localToWorld(mouth);
        // charge in the mouth, then spit
        if (a < 0.86) {
          orb.g.visible = a > 0.62;
          orb.g.position.copy(mouth); orb.g.scale.setScalar(Math.max(0.01, smooth(0.62, 0.86, a)) * 0.8);
          orb.anim(a, 0.2);
          P0.copy(mouth);
        } else if (!landed) {
          if (!fired) { fired = true; S.sound('zap'); }
          var kk = seg(a, 0.86, 1.22);
          P1.lerpVectors(P0, hit, 0.5).setY(Math.max(P0.y, hit.y) + 0.7);
          qbez(P0, P1, hit, eInOut(kk) * 0.35 + kk * 0.65, _a);
          orb.g.visible = true; orb.g.position.copy(_a); orb.g.scale.setScalar(1);
          qbez(P0, P1, hit, Math.min(1, kk + 0.03), _b).sub(_a); if (_b.lengthSq() > 1e-8) faceDir(orb.g, _b);
          orb.anim(a, 1.0);
          if (dt > 0) trail(dt, function () { S.trail(_a.x, _a.y, _a.z); });
          jit -= dt;
          if (jit <= 0) { jit = 0.04; arcs.forEach(function (L, i) { _c.copy(_a).add(_d.set((S.r() - 0.5) * 1.2, (S.r() - 0.5) * 0.9, (S.r() - 0.5) * 1.2)); L.set(_a, _c, 0.2, S.r, 1); }); }
          arcs.forEach(function (L) { L.vis(true); });
          if (kk >= 1) {
            landed = true; orb.g.visible = false; arcs.forEach(function (L) { L.vis(false); });
            S.boom(imp, hit, 1.0, { power: 0.5 }); S.land(0);
          }
        }
        if (a < 0.86 || landed) arcs.forEach(function (L) { L.vis(false); });
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  FIREBALL (2 pips): a fireball swells above the staff, fed by a
  //  spiral of embers, then is hurled in a high arc and explodes.
  // ---------------------------------------------------------------
  def('fireball', {
    dur: 2.45, impact: 1.66, cardOut: 0.5,
    cam: function (F) {
      return [[0, 'caster', { push: 0.08, blend: 0.2 }], [0.5, 'casterWide', { push: 0.3, lookRise: 0.2 }], [1.0, 'shoulder', { push: 0.3 }], [1.47, 'target', { push: 0.25 }], [1.98, 'home', { blend: 0.42 }]];
    },
    build: function (S, F) {
      var pal = S.pal; S.std();
      var orb = fireOrb(S, 0.42);
      var form = F.from.clone().setY(F.from.y + 0.85).addScaledVector(F.f, 0.15);
      var hit = F.front(0), ctl = new T.Vector3().lerpVectors(form, hit, 0.5); ctl.y = Math.max(form.y, hit.y) + 1.9;
      var imp = S.impactFx();
      var feed = rate(110), trail = rate(170), landed = false, launched = false;
      var petals = [];
      for (var i = 0; i < 7; i++) { var pm = S.mesh(K().UG.cone(), S.fade(K().bodyMat(i % 2 ? pal.a : pal.b, 0.9))); pm.visible = false; petals.push(pm); }
      return function (a, dt) {
        if (a < 1.0) {
          var g = eOut(seg(a, 0.42, 0.97));
          orb.g.visible = a > 0.42;
          orb.g.position.copy(form).setY(form.y + Math.sin(wt() * 5) * 0.05);
          orb.g.scale.setScalar(Math.max(0.01, g) * (1 + 0.07 * Math.sin(wt() * 26)));
          orb.g.rotation.set(PI / 2, 0, 0);               // tongues point up while it forms
          orb.anim(a, 0.55);
          if (dt > 0 && a < 0.92 && a > 0.38) feed(dt, function () {
            var th = S.r() * TAU, r = 1.2 + S.r() * 0.6, y = (S.r() - 0.3) * 1.2;
            var ox = Math.cos(th) * r, oz = Math.sin(th) * r;
            S.pc.emit(form.x + ox, form.y + y, form.z + oz, -ox * 2.2 - oz * 1.6, -y * 2.2, -oz * 2.2 + ox * 1.6, 0.45, 0.32, 0.12, pal.Bc, pal.A, 0.95, 0, 0);
          });
        } else if (!landed) {
          if (!launched) { launched = true; S.sound('whoosh'); }
          var kk = seg(a, 1.0, 1.66), u = eIn(kk) * 0.55 + kk * 0.45;
          qbez(form, ctl, hit, u, _a); qbez(form, ctl, hit, Math.min(1, u + 0.02), _b).sub(_a);
          orb.g.position.copy(_a); orb.g.scale.setScalar(1.05); if (_b.lengthSq() > 1e-8) faceDir(orb.g, _b);
          orb.anim(a, 1.25);
          if (dt > 0) trail(dt, function () { S.trail(_a.x + (S.r() - 0.5) * 0.3, _a.y, _a.z + (S.r() - 0.5) * 0.3); });
          if (kk >= 1) {
            landed = true; orb.g.visible = false;
            S.boom(imp, hit, 1.5, { power: 0.8, parts: 50 }); S.land(0);
            petals.forEach(function (pm, i) { pm.visible = true; pm.userData.a = i * TAU / 7 + S.r() * 0.3; });
          }
        }
        if (landed) {
          var ke = seg(a, 1.66, 2.05);
          petals.forEach(function (pm) {
            var an = pm.userData.a, rr = 0.25 + 1.1 * eOut(ke);
            pm.position.set(F.T.x + Math.cos(an) * rr * 0.4, 0.05, F.T.z + Math.sin(an) * rr * 0.4);
            pm.rotation.set(Math.sin(an) * 1.0, 0, -Math.cos(an) * 1.0);
            pm.scale.set(0.35 * (1 - ke * 0.5), Math.max(0.01, 2.2 * Math.sin(Math.min(1, ke * 1.4) * PI)), 0.35 * (1 - ke * 0.5));
            pm.material.opacity = 0.9 * (1 - ke);
            pm.visible = ke < 1;
          });
          if (dt > 0 && a < 2.1 && S.r() < 0.6) groundFire(S, F.T, 1.4 * F.hs(0), 2);
        }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  PHOENIX (Phoenix Rage, 5 pips): a great firebird rises from a
  //  blazing portal behind the caster, screeches, climbs and dives.
  // ---------------------------------------------------------------
  def('phoenix', {
    dur: 4.15, impact: 2.98, bigCast: true, summonSound: [0.35, 'summon_big'],
    cam: function (F, c) {
      var bird = function () { return c.refs.bird; };
      return [
        [0, 'caster', { push: 0.1, blend: 0.2 }],
        [0.55, CI.follow(bird, function (F2, u, P) { P.copy(cp(F2, 5.6, 1.1, 4.4)); }, { dy: 0.4, fallback: function (F2, L) { L.copy(cp(F2, -1.8, 1.5, -2.1)); } })],
        [1.6, CI.follow(bird, function (F2, u, P) { P.copy(cp(F2, F2.D * 0.5, 1.2, F2.D * 0.55 + 4.5)); }, { dy: -0.6 }), { blend: 0.25 }],
        [2.3, CI.follow(bird, function (F2, u, P) { P.copy(tp(F2, 0, -5.5 - F2.thMax * 0.5, 1.0, 3.2)); }, { look2: function (F2, o) { o.copy(F2.Tc).setY(F2.thMax * 0.5); }, l0: 0.45, l1: 0.95 })],
        [2.98, 'targets', { pull: 1.6 }],
        [3.5, 'home', { blend: 0.6 }]
      ];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var P0 = cp(F, -1.8, 0, -2.1);
      var portal = Q.Portal(S, P0, 1.7, 0.3, 1.8, { spout: 2.6, rate: 90, spin: 4 });
      var bird = k.Winged(S.ctx, 'phoenix', 1.25), BS = 1.25;
      bird.root.visible = false; c.refs.bird = bird.root;
      var hover = cp(F, -0.9, 4.7, -1.4), apex = cp(F, F.D * 0.35, 6.2, -0.6);
      var hit = F.front(0), last = F.targets.length > 1 ? F.Tc.clone().setY(0.8) : hit;
      var imp = S.impactFx({ rays: 12 });
      var em = rate(150), cur = new T.Vector3(), nx = new T.Vector3(), cried = false, landed = false;
      var pillarM = S.own(k.gradMat(pal.a, false)), pillar = S.mesh(k.UG.cyl(), pillarM); pillar.visible = false;
      var pillarI = S.mesh(k.UG.cyl(), S.fade(WF.models.glow(pal.hot), 0.9)); pillarI.visible = false;
      function pathAt(a, out) {
        if (a < 1.55) { var u = eOut(seg(a, 0.55, 1.55)); return out.copy(P0).setY(-0.6).lerp(hover, u); }
        if (a < 2.2) { var u2 = eInOut(seg(a, 1.55, 2.2)); return qbez(hover, _c.copy(hover).setY(hover.y + 1.6), apex, u2, out); }
        var u3 = eIn(seg(a, 2.2, 2.98));
        return qbez(apex, _d.copy(apex).lerp(last, 0.35).setY(apex.y + 0.6), last, u3, out);
      }
      return function (a, dt) {
        portal.tick(a, dt);
        bird.root.visible = a > 0.55 && a < 2.98;
        if (bird.root.visible) {
          pathAt(a, cur); pathAt(Math.min(2.98, a + 0.03), nx).sub(cur);
          bird.root.position.copy(cur);
          if (a < 1.55) { nx.copy(F.f); nx.y = 0.15; }
          else if (a < 2.2) nx.y *= 0.4;
          if (nx.lengthSq() > 1e-8) faceDir(bird.root, nx);
          var grow = eBack(seg(a, 0.55, 1.1));
          bird.inner.scale.setScalar(BS * Math.max(0.02, grow));
          var dive = seg(a, 2.25, 2.55), wide = bell(a, 1.45, 2.0);
          var flapA = a < 2.25 ? (0.2 + 0.85 * Math.sin(wt() * (a < 1.5 ? 7 : 9))) * (1 - wide * 0.6) + wide * 0.35 : 0;
          bird.flap(flapA * (1 - dive) - 0.2 * dive, 0.1 + dive * 1.0);
          var gs = 5 * BS * (1 + 0.12 * Math.sin(wt() * 20)); bird.glow.scale.set(gs, gs, 1);
          if (!cried && a > 1.5) { cried = true; S.sound('cry_phoenix'); }
          if (dt > 0) em(dt, function () {
            _a.set((S.r() - 0.5) * 2.8, (S.r() - 0.5) * 0.4, -0.6 - S.r() * 3).multiplyScalar(BS).applyQuaternion(bird.root.quaternion).add(cur);
            S.trail(_a.x, _a.y, _a.z);
          });
        }
        if (!landed && a >= 2.98) {
          landed = true;
          S.boom(imp, last, 2.6, { power: 1.5, parts: 80 }); S.landAll();
          pillar.visible = pillarI.visible = true;
        }
        if (landed) {
          var kp = seg(a, 2.98, 3.55), hh = 10 * eOut(seg(a, 2.98, 3.15)), w = (1 - kp);
          pillar.position.set(F.Tc.x, 0, F.Tc.z); pillar.scale.set(1.5 * w + 0.01, hh, 1.5 * w + 0.01); pillarM.opacity = 0.6 * w; pillar.rotation.y = wt() * 3;
          pillarI.position.set(F.Tc.x, 0, F.Tc.z); pillarI.scale.set(0.5 * w + 0.01, hh * 0.85, 0.5 * w + 0.01); pillarI.material.opacity = 0.9 * w;
          pillar.visible = pillarI.visible = kp < 1;
          if (dt > 0 && a < 3.6) groundFire(S, F.Tc, 2.6 + F.targets.length * 0.6, 3);
        }
        imp.tick(dt);
      };
    }
  });
})();

// =====================================================================
//  EMBERSTRIKE (2): Ember Moth, Gale Hawk, Blaze Fox, Firestorm, Skyrend Drake
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eIn3 = Q.eIn3, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, fanGeo = KT.fanGeo, cp = KT.cp, tp = KT.tp, C3 = KT.C3, rate = KT.rate, K = KT.K, fireOrb = KT.fireOrb, groundFire = KT.groundFire;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3(), _e = new T.Vector3();
  function G() { return K().G; }
  function mix(a, b, t) { return K().mix(a, b, t); }
  function follow(obj, posFn, o) { return CI.follow(obj, posFn, o); }

  // ---------------------------------------------------------------
  //  EMBER MOTH (1 pip burn): the card bursts into a glowing moth that
  //  flutters to the target, circles it and sets it alight.
  // ---------------------------------------------------------------
  function mothBodyGeo(B) {
    var g = G();
    B.glow(g.sph(1, 12, 8), '#ff8a2a', { s: [0.1, 0.1, 0.24] });
    B.glow(g.sph(1, 10, 8), '#ffb04a', { p: [0, -0.01, -0.25], s: [0.085, 0.085, 0.2] });
    B.glow(g.sph(1, 8, 6), '#ffd25a', { p: [0, -0.02, -0.25], s: [0.05, 0.05, 0.18] });
    B.glow(g.sph(0.085, 10, 8), '#ffcf6a', { p: [0, 0.02, 0.26] });
    [-1, 1].forEach(function (s) {
      B.glow(g.sph(0.04, 8, 6), '#2a0a00', { p: [s * 0.055, 0.05, 0.31] });
      B.glow(g.sph(0.014, 6, 4), '#ffffff', { p: [s * 0.05, 0.07, 0.34] });
      B.glow(g.taper([[s * 0.03, 0.07, 0.3], [s * 0.1, 0.2, 0.42], [s * 0.19, 0.25, 0.46]], 0.014, 0.007, 8, 4), '#ffd23a');
      B.glow(g.sph(0.03, 6, 5), '#fff3b0', { p: [s * 0.19, 0.25, 0.46] });
    });
  }
  function mothWingGeo(B) {        // right wings (fore + hind), extend +X from the root
    var g = G();
    function disc(p, sx, sz, yaw, color, y) { B.glow(g.disc(1, 22), color, { p: [p[0], y || 0, p[1]], r: [-PI / 2, yaw, 0], s: [sx, sz, 1], order: 'YXZ' }); }
    disc([0.46, 0.14], 0.5, 0.28, 0.32, '#ffc83a', 0);
    disc([0.42, 0.13], 0.38, 0.2, 0.32, '#ff8a2a', 0.004);
    disc([0.32, 0.1], 0.2, 0.12, 0.32, '#e8401a', 0.008);
    disc([0.62, 0.2], 0.09, 0.09, 0, '#5a0f00', 0.012);
    disc([0.63, 0.21], 0.035, 0.035, 0, '#fff6c8', 0.016);
    disc([0.28, -0.16], 0.3, 0.2, -0.5, '#ff9a2a', -0.004);
    disc([0.26, -0.15], 0.18, 0.12, -0.5, '#d8361a', 0.0);
  }
  def('ember_moth', {
    dur: 1.95, impact: 1.25, cardOut: 0.42,
    cam: function (F, c) {
      var moth = function () { return c.refs.moth; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.6, CI.chase(moth, -3.6, 0.8, 2.8, { dy: -0.1 }), { blend: 0.2 }],
        [1.05, 'target', { push: 0.25 }], [1.5, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var pal = S.pal; S.std();
      var moth = S.group(), inner = S.group(moth);
      glowPart(S, 'mothBody', mothBodyGeo, inner, [0.025, '#ffd23a', 0.8]);
      var wR = glowPart(S, 'mothWing', mothWingGeo, inner, null, { dbl: true }), wL = glowPart(S, 'mothWing', mothWingGeo, inner, null, { dbl: true });
      wL.scale.x = -1;
      S.halo(pal.a, 1.8, 0.45, inner);
      inner.scale.setScalar(1.8);
      moth.visible = false; c.refs.moth = moth;
      var start = F.C.clone().addScaledVector(F.f, 0.15).setY(F.ch + 0.9), hit = F.front(0), Tc = F.feet(0), R = 1.1 + F.th * 0.25;
      var c1 = cp(F, F.D * 0.25, F.ch + 1.6, 1.8), c2 = tp(F, 0, -2.2, F.th + 1.0, -1.6);
      var circleY = Math.max(1.0, F.th * 0.75);
      var imp = S.impactFx({ rays: 7 }), landed = false, em = rate(60), cur = new T.Vector3(), nx = new T.Vector3();
      function path(a, out) {
        if (a < 0.98) return bez(start, c1, c2, _e.copy(Tc).addScaledVector(F.f, -R).setY(circleY), eInOut(seg(a, 0.5, 0.98)), out);
        var u = seg(a, 0.98, 1.25), ang = -PI / 2 + u * PI * 1.25, rr = R * (1 - u * 0.75);
        _d.copy(F.f).negate();
        var bx = Math.atan2(_d.x, _d.z) + u * PI * 1.25;
        return out.set(Tc.x + Math.sin(bx) * rr, lerp(circleY, hit.y, u), Tc.z + Math.cos(bx) * rr);
      }
      return function (a, dt) {
        moth.visible = a >= 0.5 && !landed;
        if (moth.visible) {
          path(a, cur); path(Math.min(1.25, a + 0.02), nx).sub(cur);
          moth.position.copy(cur); moth.position.y += Math.sin(wt() * 16) * 0.08;
          if (nx.lengthSq() > 1e-8) faceDir(moth, nx);
          inner.scale.setScalar(1.8 * Math.max(0.05, eBack(seg(a, 0.5, 0.7))));
          var fl = Math.sin(wt() * 30) * 0.9;
          wR.rotation.z = fl; wL.rotation.z = -fl;
          if (dt > 0) em(dt, function () {
            S.pa.emit(cur.x + (S.r() - 0.5) * 0.4, cur.y, cur.z + (S.r() - 0.5) * 0.4, (S.r() - 0.5) * 0.6, -0.4 - S.r() * 0.6, (S.r() - 0.5) * 0.6, 0.6, 0.18, 0.02, pal.H, pal.A, 1, -1, 1);
            if (S.r() < 0.4) S.pc.emit(cur.x, cur.y, cur.z, 0, -0.2, 0, 0.45, 0.22, 0.06, pal.Bc, pal.D, 0.9, 0.6, 1);
          });
        }
        if (!landed && a >= 1.25) { landed = true; S.boom(imp, hit, 0.9, { power: 0.45 }); S.land(0); S.sound('ignite'); }
        if (landed && dt > 0 && a < 1.85) {
          groundFire(S, Tc, 0.6 + F.hs(0) * 0.35, S.r() < 0.6 ? 2 : 1);
          if (S.r() < 0.5) { var th = S.r() * TAU, h2 = S.r() * F.th * 0.9; S.pc.emit(Tc.x + Math.cos(th) * 0.35 * F.hs(0), h2, Tc.z + Math.sin(th) * 0.35 * F.hs(0), 0, 1.2, 0, 0.45, 0.35, 0.08, pal.Bc, pal.D, 0.95, 1.2, 1.5); }
        }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  GALE HAWK (3 pips): a storm cloud boils up over the caster, a
  //  thunderclap, and a hawk of fire and lightning dives through the target.
  // ---------------------------------------------------------------
  function hawkBodyGeo(B) {
    var g = G();
    B.glow(g.sph(1, 14, 10), '#ff7a1f', { s: [0.26, 0.25, 0.58] });
    B.glow(g.sph(1, 12, 8), '#ffd25a', { p: [0, -0.06, 0.16], s: [0.2, 0.19, 0.4] });
    B.glow(g.sph(0.23, 12, 10), '#ff8a2a', { p: [0, 0.16, 0.56] });
    B.glow(g.cone(0.075, 0.26, 6), '#fff1a0', { p: [0, 0.1, 0.84], r: [PI / 2 + 0.45, 0, 0] });
    B.glow(g.cone(0.06, 0.12, 6), '#e8c060', { p: [0, 0.03, 0.79], r: [PI / 2 + 1.0, 0, 0] });
    [-1, 1].forEach(function (s) {
      B.glow(g.sph(0.06, 10, 8), '#e8fbff', { p: [s * 0.12, 0.23, 0.68] });
      B.glow(g.sph(0.028, 6, 5), '#1a5fb0', { p: [s * 0.14, 0.24, 0.72] });
      B.glow(g.box(0.14, 0.03, 0.05), '#7a1500', { p: [s * 0.1, 0.31, 0.68], r: [0, 0, s * -0.4] });      // angry brow
    });
    for (var i = 0; i < 3; i++) B.glow(g.cone(0.06, 0.34 - i * 0.06, 5), mix('#ffd23a', '#ff3a0a', i / 2), { p: [0, 0.34 - i * 0.04, 0.48 - i * 0.14], r: [-1.25, 0, 0] });
    for (var t = 0; t < 5; t++) {
      var a = (t - 2) * 0.22;
      B.glow(g.cone(0.1, 0.8 - Math.abs(t - 2) * 0.08, 4), mix('#ff6a1a', '#c81e08', Math.abs(t - 2) / 2), { p: [Math.sin(a) * 0.3, 0.02, -0.75 - Math.cos(a) * 0.15], r: [-PI / 2, 0, 0], s: [1, 1, 0.25] });
      B.glow(g.cone(0.05, 0.22, 4), '#9fe8ff', { p: [Math.sin(a) * 0.52, 0.02, -1.15 - Math.cos(a) * 0.15], r: [-PI / 2, 0, 0], s: [1, 1, 0.3] });
    }
  }
  function hawkWingGeo(B) {        // right wing along +X
    var g = G();
    B.glow(g.taper([[0, 0, 0], [0.5, 0.06, -0.02], [1.05, 0.03, -0.12], [1.55, -0.02, -0.25]], 0.1, 0.035, 10, 5), '#ff7a1f');
    for (var i = 0; i < 8; i++) {
      var u = i / 7, x = 0.25 + u * 1.35, len = 0.55 + u * 0.6, yaw = -0.15 - u * 0.75;
      B.glow(g.cone(0.13, len, 3), mix('#ffb03a', '#d8281a', u), { p: [x + Math.sin(-yaw) * len * 0.0, 0, -0.05 - len * 0.45], r: [-PI / 2, yaw * 0.6, 0], s: [1, 1, 0.22], order: 'YXZ' });
      B.glow(g.cone(0.06, 0.2, 3), '#a8ecff', { p: [x - yaw * 0.25, 0.01, -0.1 - len * 0.95], r: [-PI / 2, yaw * 0.6, 0], s: [1, 1, 0.3], order: 'YXZ' });
    }
    for (var c = 0; c < 4; c++) B.glow(g.sph(1, 8, 5), mix('#ffd25a', '#ff8a2a', c / 3), { p: [0.25 + c * 0.32, 0.03, -0.12], s: [0.2, 0.05, 0.16] });
  }
  function StormCloud(S, at, R) {
    var k = K(), pal = S.pal, g = S.group(), puffs = [];
    var dm = S.fade(k.bodyMat('#3a3446', 0.92)), lm = S.fade(k.bodyMat('#5a5268', 0.9));
    for (var i = 0; i < 9; i++) {
      var m = S.mesh(k.UG.sphLo(), i % 3 ? dm : lm, g), a = i * TAU / 9;
      m.userData.o = new T.Vector3(Math.cos(a) * R * (0.45 + (i % 2) * 0.35), (i % 3 - 1) * 0.25 * R, Math.sin(a) * R * (0.4 + (i % 2) * 0.3));
      m.userData.s = R * (0.42 + (i % 3) * 0.12); puffs.push(m);
    }
    var glowU = S.halo('#8fd8ff', R * 3, 0.0, g);
    var bolt = k.Lightning(S.ctx, 8, 0.07, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.8));
    bolt.vis(false);
    g.position.copy(at);
    return {
      g: g,
      tick: function (a, t0, t1, flick) {
        var kin = eOut(seg(a, t0, t0 + 0.45)), kout = seg(a, t1 - 0.4, t1);
        g.visible = a > t0 && kout < 1;
        g.rotation.y = wt() * 0.6;
        puffs.forEach(function (m, i) {
          m.position.copy(m.userData.o).multiplyScalar(0.6 + 0.4 * kin);
          m.scale.setScalar(Math.max(0.01, m.userData.s * kin * (1 - kout * 0.7) * (1 + 0.08 * Math.sin(wt() * 3 + i))));
        });
        dm.opacity = 0.92 * (1 - kout); lm.opacity = 0.9 * (1 - kout);
        glowU.material.opacity = 0;
        var fl = flick && a > t0 + 0.3 && kout < 0.5 && Math.sin(wt() * 37) > 0.55;
        glowU.visible = fl; if (fl) { var hs = R * (2.5 + S.r()); glowU.scale.set(hs, hs, 1); glowU.material.opacity = 0.6; }
      },
      strike: function (A, B2, on) { bolt.vis(on); if (on) bolt.set(A, B2, 0.6, S.r, 1); }
    };
  }
  CI._kit.StormCloud = StormCloud;
  def('gale_hawk', {
    dur: 2.75, impact: 1.92, summonSound: [0.92, 'thunder'],
    cam: function (F, c) {
      var hawk = function () { return c.refs.hawk; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, function (F2, P, L, u) { P.copy(cp(F2, 4.8, 1.0, 3.6)); L.copy(cp(F2, -0.6, 2.4 + u * 2.2, -0.4)); }],
        [1.0, follow(hawk, function (F2, u, P) { P.copy(cp(F2, F2.D * 0.5, 1.5, F2.D * 0.6 + 3.6)); }, { dy: 0 })],
        [1.58, 'target', { pull: 0.6 }], [2.2, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var cloudAt = cp(F, -0.9, F.ch + 2.9, -0.6), cloud = StormCloud(S, cloudAt, 1.3);
      var hawk = S.group(), inner = S.group(hawk);
      glowPart(S, 'hawkBody', hawkBodyGeo, inner, [0.035, '#ffe08a', 0.85]);
      var wR = S.group(inner), wL = S.group(inner);
      wR.position.set(0.18, 0.08, 0.12); wL.position.set(-0.18, 0.08, 0.12);
      glowPart(S, 'hawkWing', hawkWingGeo, wR, [0.03, '#ffe08a', 0.75], { dbl: true });
      glowPart(S, 'hawkWing', hawkWingGeo, wL, [0.03, '#ffe08a', 0.75], { dbl: true }).scale.x = -1;
      var hh = S.halo(pal.a, 3.2, 0.5, inner);
      var HS = 1.05;
      hawk.visible = false; c.refs.hawk = hawk;
      var arcs = [k.Lightning(S.ctx, 5, 0.065, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.8)), k.Lightning(S.ctx, 5, 0.065, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.8))];
      var hit = F.front(0), exitP = tp(F, 0, 4.5, 3.4, 0.5);
      var p1 = cloudAt.clone(), p2 = cp(F, F.D * 0.3, F.ch + 4.2, 2.6), p3 = tp(F, 0, -3.2, F.th * 0.9 + 1.4, 1.6);
      var imp = S.impactFx({ rays: 10, rayColor: '#9fe8ff' }), landed = false, em = rate(130), jit = 0, cried = false;
      var bursts = [k.Lightning(S.ctx, 6, 0.08, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.85)), k.Lightning(S.ctx, 6, 0.08, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.85)), k.Lightning(S.ctx, 6, 0.08, WF.models.glow('#f4fbff'), k.bodyMat('#8fd8ff', 0.85))];
      bursts.forEach(function (b) { b.vis(false); });
      var cur = new T.Vector3(), nx = new T.Vector3();
      function path(a, out) {
        if (a < 1.5) return bez(p1, p2, _e.copy(p3).setY(p3.y + 2.2), p3, eInOut(seg(a, 0.95, 1.5)), out);
        if (a < 1.92) return out.lerpVectors(p3, hit, eIn(seg(a, 1.5, 1.92)));
        return out.lerpVectors(hit, exitP, eOut(seg(a, 1.92, 2.35)));
      }
      return function (a, dt) {
        cloud.tick(a, 0.25, 1.6, true);
        var strikeOn = a > 0.9 && a < 1.02;
        cloud.strike(cloudAt, cp(F, 0.6, 0, -1.4), strikeOn && Math.sin(wt() * 120) > -0.3);
        if (a > 0.9 && a < 0.96) S.flash('#cfefff', 0.35, 0.15);
        hawk.visible = a > 0.95 && a < 2.35;
        if (hawk.visible) {
          path(a, cur); path(Math.min(2.4, a + 0.02), nx).sub(cur);
          hawk.position.copy(cur); if (nx.lengthSq() > 1e-8) faceDir(hawk, nx);
          inner.scale.setScalar(HS * Math.max(0.05, eBack(seg(a, 0.95, 1.2))) * (1 - seg(a, 2.15, 2.35)));
          var dive = smooth(1.45, 1.6, a) * (1 - smooth(1.95, 2.1, a));
          var fl = (0.25 + Math.sin(wt() * 13) * 0.75) * (1 - dive);
          wR.rotation.set(0, dive * 0.9, fl - dive * 0.15); wL.rotation.set(0, -dive * 0.9, -fl + dive * 0.15);
          hh.scale.setScalar(3.2 * (1 + 0.1 * Math.sin(wt() * 25)));
          if (!cried && a > 1.0) { cried = true; S.sound('cry_hawk'); }
          if (dt > 0) em(dt, function () { _a.set((S.r() - 0.5) * 1.6, (S.r() - 0.5) * 0.3, -0.6 - S.r() * 1.2).applyQuaternion(hawk.quaternion).add(cur); S.trail(_a.x, _a.y, _a.z); });
          jit -= dt;
          if (jit <= 0) { jit = 0.05; arcs.forEach(function (L) { _c.copy(cur).add(_d.set((S.r() - 0.5) * 2.2, (S.r() - 0.5) * 1.2, (S.r() - 0.5) * 2.2)); L.set(cur, _c, 0.25, S.r, 1); }); }
          arcs.forEach(function (L) { L.vis(true); });
        } else arcs.forEach(function (L) { L.vis(false); });
        if (!landed && a >= 1.92) { landed = true; S.boom(imp, hit, 1.6, { power: 0.9, flashColor: '#cfefff' }); S.land(0); S.sound('thunder', true); }
        var on = landed && a < 2.25 && Math.sin(wt() * 70) > -0.4;
        bursts.forEach(function (b, i) {
          b.vis(on);
          if (on && (S.r() < 0.5 || dt === 0)) { var th = S.r() * TAU; b.set(hit, _c.copy(hit).add(_d.set(Math.cos(th) * 2.2, (S.r() - 0.2) * 1.8, Math.sin(th) * 2.2)), 0.5, S.r, 1); }
        });
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  BLAZE FOX (Wildfire, 3 pips burn): a three-tailed fox of flame
  //  bounds out of a fire portal, circles the target laying a ring of
  //  fire, leaps over it and the ring erupts.
  // ---------------------------------------------------------------
  function foxBodyGeo(B) {
    var g = G();
    B.glow(g.sph(1, 14, 10), '#ff6a1f', { p: [0, 0.55, 0], s: [0.24, 0.24, 0.5] });
    B.glow(g.sph(1, 12, 8), '#ffd25a', { p: [0, 0.48, 0.22], s: [0.17, 0.2, 0.26] });
    B.glow(g.sph(0.22, 12, 10), '#ff7d2a', { p: [0, 0.82, 0.5] });
    B.glow(g.sph(1, 10, 8), '#ffd25a', { p: [0, 0.76, 0.66], s: [0.13, 0.11, 0.12] });
    B.glow(g.cone(0.09, 0.3, 8), '#ff8a3a', { p: [0, 0.78, 0.78], r: [PI / 2, 0, 0] });
    B.glow(g.sph(0.035, 6, 5), '#3a0a00', { p: [0, 0.79, 0.94] });
    [-1, 1].forEach(function (s) {
      B.glow(g.cone(0.09, 0.32, 4), '#ff5a14', { p: [s * 0.12, 1.08, 0.44], r: [0, 0, s * -0.25] });
      B.glow(g.cone(0.045, 0.2, 4), '#ffe08a', { p: [s * 0.12, 1.06, 0.47], r: [0, 0, s * -0.25] });
      B.glow(g.sph(0.055, 8, 6), '#fff6c8', { p: [s * 0.1, 0.88, 0.67], s: [1, 0.8, 1] });
      B.glow(g.sph(0.026, 6, 5), '#2a0800', { p: [s * 0.105, 0.885, 0.715] });
    });
  }
  function foxLegGeo(B) { var g = G(); B.glow(g.cyl(0.05, 0.035, 0.42, 6), '#d8461a', { p: [0, -0.21, 0] }); B.glow(g.sph(0.055, 6, 5), '#ffd25a', { p: [0, -0.42, 0.02], s: [1, 0.6, 1.3] }); }
  function foxTailGeo(B) {
    var g = G();
    B.glow(g.taper([[0, 0, 0], [0, 0.18, -0.3], [0, 0.45, -0.55], [0, 0.75, -0.62]], 0.12, 0.03, 12, 6), '#ff6a1f');
    B.glow(g.cone(0.1, 0.36, 6), '#ffd23a', { p: [0, 0.78, -0.62], r: [-0.2, 0, 0] });
  }
  def('blaze_fox', {
    dur: 2.85, impact: 1.98, summonSound: [0.42, 'summon_small'],
    cam: function (F, c) {
      var fox = function () { return c.refs.fox; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.5, 'side', { push: 0.12 }],
        [1.05, follow(fox, function (F2, u, P) { P.copy(tp(F2, 0, -4.6 - F2.th * 0.4, 2.0 + F2.th * 0.2, 3.4)); }, { dy: 0.2, look2: function (F2, o) { o.copy(F2.feet(0)).setY(F2.th * 0.45); }, l0: 0.5, l1: 1 })],
        [1.88, 'target', { pull: 1.0 }], [2.35, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.2, 0, 1.1);
      var portal = Q.Portal(S, at, 0.85, 0.32, 1.0, { rate: 60 });
      var fox = S.group(), inner = S.group(fox);
      glowPart(S, 'foxBody', foxBodyGeo, inner, [0.03, '#ffe08a', 0.8]);
      var legs = [[0.15, 0.48, 0.3], [-0.15, 0.48, 0.3], [0.15, 0.48, -0.32], [-0.15, 0.48, -0.32]].map(function (p) { var l = glowPart(S, 'foxLeg', foxLegGeo, inner); l.position.set(p[0], p[1], p[2]); return l; });
      var tails = [-0.45, 0, 0.45].map(function (yaw) { var t = glowPart(S, 'foxTail', foxTailGeo, inner, [0.025, '#ffe08a', 0.8]); t.position.set(0, 0.6, -0.42); t.rotation.y = yaw; t.userData.yaw = yaw; return t; });
      S.halo(pal.a, 2.2, 0.4, inner).position.y = 0.7;
      inner.scale.setScalar(1.25);
      fox.visible = false; c.refs.fox = fox;
      var Tc = F.feet(0), R = 1.5 + F.hs(0) * 0.7, hit = F.front(0);
      _d.copy(F.f).negate(); var a0 = Math.atan2(_d.x, _d.z);
      var ringPts = [];
      var cur = new T.Vector3(), nx = new T.Vector3(), lastRing = 0;
      var imp = S.impactFx({ rays: 10 }), landed = false;
      var flames = [];
      var fA = S.fade(k.bodyMat(pal.a, 0.88)), fD = S.fade(k.bodyMat(pal.deep, 0.88)), fI = S.fade(WF.models.glow(pal.hot, 0.95));
      for (var i = 0; i < 14; i++) { var fm = S.mesh(KT.flameGeo(), i % 3 ? fA : fD); fm.visible = false; flames.push(fm); }
      var inners = [];
      for (var j = 0; j < 7; j++) { var im = S.mesh(KT.flameGeo(), fI); im.visible = false; im.renderOrder = 6; inners.push(im); }
      function path(a, out) {
        if (a < 1.05) { var u = eInOut(seg(a, 0.55, 1.05)); var e0 = _e.set(Tc.x + Math.sin(a0) * R, 0, Tc.z + Math.cos(a0) * R); return out.lerpVectors(at, e0, u); }
        if (a < 1.75) { var ang = a0 + seg(a, 1.05, 1.75) * TAU; return out.set(Tc.x + Math.sin(ang) * R, 0, Tc.z + Math.cos(ang) * R); }
        var u2 = seg(a, 1.75, 1.98), e1 = _e.set(Tc.x + Math.sin(a0) * R, 0, Tc.z + Math.cos(a0) * R), e2 = _c.set(Tc.x - Math.sin(a0) * R * 0.9, 0, Tc.z - Math.cos(a0) * R * 0.9);
        out.lerpVectors(e1, e2, u2); out.y = Math.sin(u2 * PI) * (F.th + 1.2); return out;
      }
      return function (a, dt) {
        portal.tick(a, dt);
        fox.visible = a > 0.5 && a < 2.05;
        if (fox.visible) {
          path(Math.min(a, 1.98), cur); path(Math.min(1.99, a + 0.02), nx).sub(cur);
          fox.position.copy(cur);
          if (a < 0.62) fox.position.y = lerp(-1.2, 0, eBack(seg(a, 0.5, 0.62)));
          nx.y = a > 1.75 ? nx.y : 0; if (nx.lengthSq() > 1e-8) faceDir(fox, nx);
          var run = wt() * 16;
          if (a < 1.75) fox.position.y += Math.abs(Math.sin(run)) * 0.22;
          inner.rotation.x = a < 1.75 ? Math.sin(run) * 0.12 : -0.25;
          legs.forEach(function (l, i) { l.rotation.x = Math.sin(run + (i < 2 ? 0 : PI)) * 0.8 * (a < 1.75 ? 1 : 0.3) + (a >= 1.75 ? (i < 2 ? -0.8 : 0.8) : 0); });
          tails.forEach(function (t, i) { t.rotation.y = t.userData.yaw + Math.sin(wt() * 9 + i) * 0.25; t.rotation.x = -0.3 + Math.sin(wt() * 7 + i * 2) * 0.15; });
          inner.scale.setScalar(1.25 * (1 - seg(a, 1.96, 2.05)));
          if (dt > 0 && a > 1.05 && a < 1.78 && a - lastRing > 0.045) { lastRing = a; ringPts.push({ p: cur.clone().setY(0), t: a }); }
          if (dt > 0) { S.trail(cur.x, cur.y + 0.6, cur.z); }
        }
        ringPts.forEach(function (r) {
          if (dt > 0 && S.r() < 0.35 && a < 2.5) { var p = pal; S.pc.emit(r.p.x + (S.r() - 0.5) * 0.3, 0.1, r.p.z + (S.r() - 0.5) * 0.3, 0, 1 + S.r() * 1.5, 0, 0.4, 0.35, 0.06, p.Bc, p.D, 0.9, 1.4, 1.5); }
        });
        if (!landed && a >= 1.98) { landed = true; S.boom(imp, hit, 1.5, { power: 0.85 }); S.land(0); S.sound('ignite', true); }
        var ke = seg(a, 1.98, 2.7);
        flames.forEach(function (fm, i) {
          fm.visible = landed && ke < 1;
          if (!fm.visible) return;
          var ang = i * TAU / flames.length + wt() * 0.8, rr = R * (0.85 + 0.1 * Math.sin(i * 3));
          fm.position.set(Tc.x + Math.sin(ang) * rr, 0, Tc.z + Math.cos(ang) * rr);
          var h = (1.5 + F.th * 0.5 + (i % 3) * 0.3) * Math.sin(Math.min(1, ke * 3) * PI * 0.5) * (1 - eIn(ke)) * (1 + 0.25 * Math.sin(wt() * 30 + i));
          fm.scale.set(0.55, Math.max(0.01, h), 0.55); fm.rotation.set(Math.sin(wt() * 9 + i) * 0.12, 0, Math.cos(wt() * 8 + i * 2) * 0.12);
        });
        inners.forEach(function (im, i) {
          im.visible = landed && ke < 1;
          if (!im.visible) return;
          var ang = i * TAU / inners.length + 0.3 + wt() * 0.8, rr = R * 0.85;
          im.position.set(Tc.x + Math.sin(ang) * rr, 0, Tc.z + Math.cos(ang) * rr);
          var h = (1.0 + F.th * 0.3) * Math.sin(Math.min(1, ke * 3) * PI * 0.5) * (1 - eIn(ke));
          im.scale.set(0.3, Math.max(0.01, h), 0.3);
        });
        fA.opacity = fD.opacity = 0.88 * (1 - ke * ke); fI.opacity = 0.95 * (1 - ke);
        if (landed && dt > 0 && a < 2.6) groundFire(S, Tc, 0.5 + F.hs(0) * 0.3, 1);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  FIRESTORM (4 pips, all enemies): a burning vortex opens in the sky
  //  and meteors rain down on every enemy.
  // ---------------------------------------------------------------
  // a dark roiling cloud ring with a burning swirl underneath (Firestorm; also reused tinted)
  function Vortex(S, at, R, colA, colB, o) {
    o = o || {};
    var k = K(), g = S.group(), puffs = [], pal = S.pal;
    var dm = S.fade(k.bodyMat(o.dark || '#2e2030', 0.95)), lm = S.fade(k.bodyMat(o.light || '#4e3040', 0.92));
    for (var i = 0; i < 14; i++) {
      var m = S.mesh(k.UG.sphLo(), i % 3 ? dm : lm, g), a = i * TAU / 14 + (i % 2) * 0.2;
      m.userData.a = a; m.userData.r = R * (0.72 + (i % 3) * 0.12); m.userData.y = (i % 2 ? 0.25 : -0.1) * R * 0.4; m.userData.s = R * (0.3 + (i % 4) * 0.06);
      puffs.push(m);
    }
    var cap = S.mesh(k.UG.sphLo(), dm, g); cap.userData.cap = true;
    var tex = KT.swirl ? KT.swirl() : null;
    var swM = S.own(new T.MeshBasicMaterial({ map: tex, color: colA, transparent: true, depthWrite: false, side: T.DoubleSide }));
    var swA = S.own(new T.MeshBasicMaterial({ map: tex, color: colB, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    var sw1 = S.mesh(k.UG.plane(), swM, g), sw2 = S.mesh(k.UG.plane(), swA, g);
    sw1.position.y = -0.15 * R; sw2.position.y = -0.17 * R; sw1.renderOrder = 7; sw2.renderOrder = 8;
    var under = S.halo(colB, R * 2.6, 0.5, g); under.position.y = -0.5 * R;
    g.position.copy(at);
    var em = 0;
    return {
      g: g, under: under,
      tick: function (a, t0, t1, dt) {
        var kin = eOut(seg(a, t0, t0 + 0.55)), kout = seg(a, t1 - 0.45, t1);
        g.visible = a > t0 && kout < 1;
        if (!g.visible) return;
        puffs.forEach(function (m, i) {
          var ang = m.userData.a + wt() * 0.5;
          m.position.set(Math.cos(ang) * m.userData.r * (0.5 + 0.5 * kin), m.userData.y + Math.sin(wt() * 2 + i) * 0.08 * R, Math.sin(ang) * m.userData.r * (0.5 + 0.5 * kin));
          m.scale.set(m.userData.s * 1.4 * kin * (1 - kout * 0.6), m.userData.s * kin * (1 - kout * 0.6), m.userData.s * 1.2 * kin * (1 - kout * 0.6));
          m.scale.x = Math.max(0.01, m.scale.x); m.scale.y = Math.max(0.01, m.scale.y); m.scale.z = Math.max(0.01, m.scale.z);
        });
        cap.scale.set(Math.max(0.01, R * 0.75 * kin), Math.max(0.01, R * 0.22 * kin), Math.max(0.01, R * 0.75 * kin)); cap.position.y = R * 0.12;
        var ss = 2 * R * 0.95 * kin; sw1.scale.set(Math.max(0.01, ss), 1, Math.max(0.01, ss)); sw2.scale.copy(sw1.scale);
        sw1.rotation.y = wt() * 2.2; sw2.rotation.y = wt() * 2.9;
        dm.opacity = 0.95 * (1 - kout); lm.opacity = 0.92 * (1 - kout); swM.opacity = 0.9 * (1 - kout); swA.opacity = (0.55 + 0.25 * Math.sin(wt() * 13)) * (1 - kout);
        var hs = R * 2.6 * kin * (1 + 0.1 * Math.sin(wt() * 9)); under.scale.set(hs, hs, 1);
        if (dt > 0 && kout < 0.5 && o.drip !== false) {
          em += dt * 40;
          while (em >= 1) { em -= 1; var th = S.r() * TAU, rr = S.r() * R * 0.8; S.pa.emit(at.x + Math.cos(th) * rr, at.y - 0.2 * R, at.z + Math.sin(th) * rr, 0, -2 - S.r() * 2, 0, 0.8, 0.22, 0.02, pal.H, pal.A, 1, -3, 0.5); }
        }
      }
    };
  }
  CI._kit.Vortex = Vortex;
  def('firestorm', {
    len: function (F, card) { return { dur: 3.3, impact: 1.9, impactEnd: 2.42 }; },
    cam: function (F) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }], [0.5, 'sky', { push: 0.1 }], [1.55, 'targets', { pull: 1.5, dp: [0, 0.8, 0] }], [2.75, 'home', { blend: 0.5 }]];
    },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var skyAt = F.Tc.clone().addScaledVector(F.f, 1.2).setY(7.2 + F.thMax * 0.3);
      var vort = Vortex(S, skyAt, 3.6, pal.a, pal.hot);
      var n = F.targets.length, rocks = [];
      var extra = Math.max(0, 4 - n);
      for (var i = 0; i < n + extra; i++) {
        var real = i < n, tg = real ? i : -1;
        var land = real ? F.front(i).setY(Math.max(0.4, F.targets[i].h * 0.35)) : F.Tc.clone().addScaledVector(F.s, (S.r() - 0.5) * 7).addScaledVector(F.f, (S.r() - 0.2) * 3).setY(0.2);
        var orb = fireOrb(S, real ? 0.5 : 0.36); orb.g.visible = false;
        var rk = S.mesh(k.UG.dod(), WF.models.toon('#5a2a1a', { flat: true, emissive: '#7a1a00', emissiveIntensity: 0.8 }), orb.g); rk.scale.setScalar(real ? 0.42 : 0.3);
        var t0 = 1.35 + (real ? i * 0.21 : 0.12 + (i - n) * 0.24), t1 = t0 + 0.55 + (real ? 0 : 0.05);
        var from = skyAt.clone().add(_a.set((S.r() - 0.5) * 2.4, -0.3, (S.r() - 0.5) * 2.4));
        var tele = S.mesh(k.UG.ring(), S.fade(k.bodyMat(pal.b, 0.9))); tele.visible = false; tele.renderOrder = 4;
        var imp = real ? S.impactFx({ rays: 8 }) : null;
        rocks.push({ orb: orb, rk: rk, real: real, idx: tg, from: from, land: land, t0: t0, t1: t1, tele: tele, imp: imp, done: false });
      }
      var lastT = rocks.reduce(function (m, r) { return r.real ? Math.max(m, r.t1) : m; }, 0);
      return function (a, dt) {
        vort.tick(a, 0.35, 2.95, dt);
        rocks.forEach(function (r) {
          var k2 = seg(a, r.t0, r.t1);
          r.tele.visible = a > r.t0 - 0.35 && !r.done; r.tele.position.set(r.land.x, 0.09, r.land.z);
          r.tele.scale.setScalar(0.4 + 1.1 * eOut(seg(a, r.t0 - 0.35, r.t1))); r.tele.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(wt() * 16));
          r.orb.g.visible = a >= r.t0 && !r.done;
          if (r.orb.g.visible) {
            _a.lerpVectors(r.from, r.land, eIn(k2)); r.orb.g.position.copy(_a);
            _b.subVectors(r.land, r.from); faceDir(r.orb.g, _b);
            r.orb.anim(a, 1.4); r.rk.rotation.set(wt() * 5, wt() * 3, 0);
            if (dt > 0 && S.r() < 0.8) S.trail(_a.x, _a.y, _a.z);
          }
          if (!r.done && k2 >= 1) {
            r.done = true; r.orb.g.visible = false; r.tele.visible = false;
            if (r.real) { S.boom(r.imp, r.land, 1.35, { power: 0.75, boomSound: r.idx === 0 }); S.land(r.idx); }
            else { S.burst(r.land, 18, 0.8); S.sound('impact_emberstrike'); }
          }
          if (r.imp) r.imp.tick(dt);
        });
        if (dt > 0 && a > 1.9 && a < 3.0 && S.r() < 0.7) groundFire(S, F.Tc, 2.4 + spreadOf(F), 2);
      };
    }
  });
  function spreadOf(F) { var m = 0; F.targets.forEach(function (t) { m = Math.max(m, t.pos.distanceTo(F.Tc)); }); return m; }

  // ---------------------------------------------------------------
  //  SKYREND DRAKE (4 pips): a storm-red drake sweeps in over the
  //  caster, hovers, rears back and breathes fire laced with lightning.
  // ---------------------------------------------------------------
  function drakeBodyGeo(B) {
    var g = G(), red = '#c42a18', red2 = '#a01e10', gold = '#ffb54a', bolt = '#8fe4ff';
    B.glow(g.sph(1, 16, 12), red, { s: [0.55, 0.5, 1.05] });
    B.glow(g.sph(1, 14, 10), gold, { p: [0, -0.2, 0.1], s: [0.4, 0.34, 0.85] });
    for (var i = 0; i < 4; i++) B.glow(g.box(0.5 - i * 0.05, 0.04, 0.14), '#ffd27a', { p: [0, -0.5 + i * 0.01, 0.55 - i * 0.3], r: [0.15, 0, 0] });
    B.glow(g.taper([[0, 0.2, 0.75], [0, 0.6, 1.25], [0, 0.95, 1.58], [0, 1.1, 1.75]], 0.36, 0.22, 12, 8), red);
    B.glow(g.taper([[0, 0.05, 0.8], [0, 0.45, 1.3], [0, 0.8, 1.66]], 0.22, 0.14, 10, 6), gold);
    for (var s = 0; s < 7; s++) {
      var z = 1.45 - s * 0.38, y = s < 2 ? 0.95 - s * 0.3 : 0.48 - (s - 2) * 0.02;
      B.glow(g.cone(0.1, 0.32 - s * 0.02, 4), s % 2 ? '#ffcf4a' : '#ffe58a', { p: [0, y + 0.1, z], r: [-0.5, 0, 0] });
      B.glow(g.cone(0.04, 0.12, 4), bolt, { p: [0, y + 0.3, z - 0.1], r: [-0.5, 0, 0] });
    }
    B.glow(g.taper([[0, 0, -0.85], [0, 0.1, -1.65], [0.25, 0.3, -2.4], [0.05, 0.55, -3.0]], 0.36, 0.06, 14, 8), red);
    B.glow(g.cone(0.3, 0.55, 4), '#ffcf4a', { p: [0.05, 0.6, -3.15], r: [-1.9, 0, 0], s: [1, 1, 0.35] });
    [-1, 1].forEach(function (s2) {
      B.glow(g.cyl(0.1, 0.07, 0.5, 6), red2, { p: [s2 * 0.32, -0.5, 0.5], r: [0.6, 0, 0] });
      B.glow(g.cyl(0.13, 0.08, 0.55, 6), red2, { p: [s2 * 0.36, -0.48, -0.42], r: [0.9, 0, 0] });
      for (var c = 0; c < 3; c++) B.glow(g.cone(0.03, 0.12, 4), '#fff1c8', { p: [s2 * 0.32 + (c - 1) * 0.05, -0.74, 0.7], r: [PI * 0.75, 0, 0] });
    });
    for (var r = 0; r < 3; r++) B.glow(g.box(0.04, 0.03, 0.5), bolt, { p: [0.32, 0.25 - r * 0.15, 0.2 - r * 0.25], r: [0, 0.1, 0.4] });
    for (var r2 = 0; r2 < 3; r2++) B.glow(g.box(0.04, 0.03, 0.5), bolt, { p: [-0.32, 0.25 - r2 * 0.15, 0.2 - r2 * 0.25], r: [0, -0.1, -0.4] });
  }
  function drakeHeadGeo(B) {       // head pivot at the top of the neck, facing +Z
    var g = G(), red = '#c42a18';
    B.glow(g.sph(1, 14, 10), red, { s: [0.3, 0.27, 0.36] });
    B.glow(g.sph(1, 12, 8), '#d8361e', { p: [0, -0.02, 0.36], s: [0.22, 0.16, 0.34] });
    B.glow(g.box(0.3, 0.06, 0.26), '#ffb54a', { p: [0, -0.15, 0.36] });
    [-1, 1].forEach(function (s) {
      B.glow(g.taper([[s * 0.14, 0.15, -0.05], [s * 0.3, 0.32, -0.35], [s * 0.34, 0.5, -0.7]], 0.07, 0.015, 8, 5), '#ffe7a0');
      B.glow(g.taper([[s * 0.22, 0.02, -0.08], [s * 0.38, 0.05, -0.32]], 0.04, 0.01, 6, 4), '#ffcf4a');
      B.glow(g.sph(0.07, 8, 6), '#e8fbff', { p: [s * 0.17, 0.12, 0.22], s: [1, 0.7, 1] });
      B.glow(g.sph(0.035, 6, 5), '#1a5fb0', { p: [s * 0.19, 0.12, 0.26] });
      B.glow(g.box(0.16, 0.035, 0.06), '#6a0f00', { p: [s * 0.15, 0.2, 0.22], r: [0.2, 0, s * -0.35] });
      B.glow(g.sph(0.03, 6, 4), '#3a0800', { p: [s * 0.08, 0.06, 0.68] });
    });
    for (var t = 0; t < 4; t++) B.glow(g.cone(0.03, 0.1, 4), '#fff6e0', { p: [(t - 1.5) * 0.08, -0.12, 0.56], r: [PI, 0, 0] });
  }
  function drakeJawGeo(B) {
    var g = G();
    B.glow(g.sph(1, 10, 8), '#a01e10', { p: [0, -0.04, 0.3], s: [0.19, 0.07, 0.32] });
    B.glow(g.sph(1, 10, 6), '#ff8a3a', { p: [0, 0.0, 0.3], s: [0.15, 0.03, 0.27] });
    for (var t = 0; t < 4; t++) B.glow(g.cone(0.025, 0.08, 4), '#fff6e0', { p: [(t - 1.5) * 0.08, 0.04, 0.5] });
  }
  function drakeWingGeo(B) {       // right wing, shoulder at origin, extends +X
    var g = G(), bone = '#8a1a10', mem = '#ff6a2a', mem2 = '#e83a1a';
    var el = [1.2, 0.35, -0.15], tips = [[2.6, 0.55, 0.15], [2.75, 0.3, -0.75], [2.3, 0.05, -1.45], [1.45, -0.05, -1.7]];
    B.glow(g.taper([[0, 0, 0], [0.6, 0.25, -0.05], el], 0.1, 0.07, 8, 5), bone);
    tips.forEach(function (tp2) { B.glow(g.taper([el, [(el[0] + tp2[0]) / 2, (el[1] + tp2[1]) / 2 + 0.08, (el[2] + tp2[2]) / 2], tp2], 0.06, 0.02, 8, 4), bone); });
    B.glow(g.cone(0.06, 0.25, 4), '#ffe7a0', { p: [el[0], el[1] + 0.15, el[2]] });
    var pts = [[0.05, 0, -0.1], el, tips[0], [2.5, 0.32, -0.3], tips[1], [2.2, 0.15, -1.05], tips[2], [1.7, 0.02, -1.35], tips[3], [0.4, -0.05, -0.75]];
    B.glow(KT.fanGeo([el, tips[0], [2.5, 0.32, -0.3], tips[1]]), mem, {});
    B.glow(KT.fanGeo([el, tips[1], [2.2, 0.15, -1.05], tips[2]]), mem2, {});
    B.glow(KT.fanGeo([el, tips[2], [1.7, 0.02, -1.35], tips[3]]), mem, {});
    B.glow(KT.fanGeo([[0.05, 0, -0.1], el, tips[3], [0.4, -0.05, -0.75]]), mem2, {});
    B.glow(KT.fanGeo([[0.05, 0, 0.12], [0.6, 0.2, 0.1], el, [0.05, 0, -0.1]]), mem, {});
  }
  def('skyrend_drake', {
    dur: 3.35, impact: 2.3, impactEnd: 2.42, bigCast: true, summonSound: [0.4, 'whoosh_big'],
    cam: function (F, c) {
      var dr = function () { return c.refs.drake; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, follow(dr, function (F2, u, P) { P.copy(cp(F2, 3.6, 0.9, 4.8)); }, { dy: 0.2 })],
        [1.45, function (F2, P, L, u) { var h = c.refs.hover; P.copy(cp(F2, F2.D * 0.42, 1.6, F2.D * 0.55 + 4.6)); L.copy(h).lerp(F2.feet(0).setY(F2.th * 0.5), 0.3); }, { push: 0.15 }],
        [1.9, function (F2, P, L, u) { var h = c.refs.hover; P.copy(h).addScaledVector(F2.f, -2.6).addScaledVector(F2.s, 1.6); P.y += 1.0; L.copy(F2.feet(0)).setY(F2.th * 0.5); }, { push: 0.2 }],
        [2.32, 'target', { pull: 0.9 }], [2.85, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var drake = S.group(), inner = S.group(drake);
      glowPart(S, 'drakeBody', drakeBodyGeo, inner, [0.04, '#ffd27a', 0.7]);
      var headP = S.group(inner); headP.position.set(0, 1.1, 1.78);
      glowPart(S, 'drakeHead', drakeHeadGeo, headP, [0.03, '#ffd27a', 0.7]);
      var jaw = S.group(headP); jaw.position.set(0, -0.12, 0.05);
      glowPart(S, 'drakeJaw', drakeJawGeo, jaw);
      var wR = S.group(inner), wL = S.group(inner);
      wR.position.set(0.42, 0.38, 0.35); wL.position.set(-0.42, 0.38, 0.35);
      glowPart(S, 'drakeWing', drakeWingGeo, wR, null, { dbl: true }).scale.setScalar(1.3);
      glowPart(S, 'drakeWing', drakeWingGeo, wL, null, { dbl: true }).scale.set(-1.3, 1.3, 1.3);
      var aura = S.halo(pal.a, 6, 0.35, inner);
      var DS = 1.0;
      drake.visible = false; c.refs.drake = drake;
      var hover = cp(F, F.D * 0.32, 2.7 + F.th * 0.2, -2.3); c.refs.hover = hover;
      var start = cp(F, -7, 7.5, -3.5), mid = cp(F, -1.5, 4.8, 1.5);
      var hit = F.front(0), mouth = new T.Vector3();
      // breath: flame cone (normal) + hot inner cone (additive) + 2 lightning strands
      var bG = S.group(); bG.visible = false;
      var cone = S.mesh(k.UG.cone(), S.fade(k.bodyMat(pal.a, 0.75)), bG); cone.rotation.x = PI;
      var coneI = S.mesh(k.UG.cone(), S.fade(k.addMat(pal.hot, 0.8)), bG); coneI.rotation.x = PI;
      var bolts = [k.Lightning(S.ctx, 9, 0.05, WF.models.glow('#f4fbff'), k.bodyMat('#8fe4ff', 0.85)), k.Lightning(S.ctx, 9, 0.04, WF.models.glow('#f4fbff'), k.bodyMat('#8fe4ff', 0.85))];
      bolts.forEach(function (b) { b.vis(false); });
      var imp = S.impactFx({ rays: 11, rayColor: '#ffd27a' }), landed = false, roared = false, em = rate(160), jit = 0;
      var cur = new T.Vector3(), nx = new T.Vector3();
      function path(a, out) {
        if (a < 1.45) return qbez(start, mid, hover, eOut(seg(a, 0.42, 1.45)), out);
        if (a < 2.65) return out.copy(hover).setY(hover.y + Math.sin(wt() * 4) * 0.15);
        return out.copy(hover).add(_e.set(0, eIn(seg(a, 2.65, 3.2)) * 7, 0)).addScaledVector(F.s, -eIn(seg(a, 2.65, 3.2)) * 3);
      }
      return function (a, dt) {
        drake.visible = a > 0.42 && a < 3.2;
        if (!drake.visible) { bG.visible = false; bolts.forEach(function (b) { b.vis(false); }); imp.tick(dt); return; }
        path(a, cur); drake.position.copy(cur);
        if (a < 1.45) { path(Math.min(1.45, a + 0.03), nx).sub(cur); if (nx.lengthSq() > 1e-8) faceDir(drake, nx); }
        else {
          _a.subVectors(F.feet(0).setY(cur.y * 0.4), cur); faceDir(drake, _a);
        }
        inner.scale.setScalar(DS * Math.max(0.05, eBack(seg(a, 0.42, 0.75))));
        var flapRate = a < 1.45 ? 7 : 9.5, flap = Math.sin(wt() * flapRate) * (a < 1.45 ? 0.7 : 0.55) + 0.1;
        wR.rotation.set(0, 0.1, flap); wL.rotation.set(0, -0.1, -flap);
        var rear = smooth(1.5, 1.9, a) * (1 - smooth(1.95, 2.05, a)), breathe = smooth(1.9, 2.0, a) * (1 - smooth(2.55, 2.7, a));
        inner.rotation.x = -0.35 * rear + 0.12 * breathe;
        headP.rotation.x = -0.5 * rear + 0.35 * breathe;
        jaw.rotation.x = 0.15 * rear + 0.6 * breathe;
        if (!roared && a > 1.55) { roared = true; S.sound('roar_drake'); }
        drake.updateMatrixWorld(true);
        mouth.set(0, -0.05, 0.75); headP.localToWorld(mouth);
        // chest glow while inhaling: sparks sucked into the mouth
        if (dt > 0 && rear > 0.2) for (var q = 0; q < 2; q++) { var th = S.r() * TAU, rr = 1.5; S.pa.emit(mouth.x + Math.cos(th) * rr, mouth.y + (S.r() - 0.5) * rr, mouth.z + Math.sin(th) * rr, -Math.cos(th) * rr * 3, 0, -Math.sin(th) * rr * 3, 0.32, 0.25, 0.04, pal.H, pal.A, 1, 0, 0); }
        bG.visible = breathe > 0.01;
        if (bG.visible) {
          var reach = clamp((a - 1.9) / 0.4, 0, 1);
          _b.subVectors(hit, mouth); var L = _b.length() * eOut(reach) + 0.3;
          bG.position.copy(mouth); bG.quaternion.setFromUnitVectors(_c.set(0, 1, 0), _b.normalize());
          var w = (0.35 + 0.9 * reach) * breathe;
          cone.scale.set(w * 1.1, L, w * 1.1); cone.position.y = L;
          coneI.scale.set(w * 0.5, L, w * 0.5); coneI.position.y = L;
          cone.material.opacity = 0.75 * breathe; coneI.material.opacity = 0.8 * breathe;
          if (dt > 0) em(dt, function () {
            var u = S.r(); _a.copy(mouth).addScaledVector(_b, L * u);
            S.pc.emit(_a.x + (S.r() - 0.5) * w * u, _a.y + (S.r() - 0.5) * w * u, _a.z + (S.r() - 0.5) * w * u, _b.x * 6, _b.y * 6, _b.z * 6, 0.3, 0.3 + 0.5 * u, 0.12, pal.Bc, pal.D, 0.95, 1, 2);
          });
          jit -= dt;
          if (jit <= 0) { jit = 0.045; bolts.forEach(function (bb) { bb.set(mouth, _e.copy(mouth).addScaledVector(_b, L), 0.4, S.r, 1); }); }
          bolts.forEach(function (bb) { bb.vis(reach > 0.1); });
        } else bolts.forEach(function (bb) { bb.vis(false); });
        if (!landed && a >= 2.3) { landed = true; S.boom(imp, hit, 1.9, { power: 1.1 }); S.land(0); }
        if (landed && dt > 0 && a < 2.7) { groundFire(S, F.feet(0), 0.8 + F.hs(0) * 0.4, 2); if (S.r() < 0.5) S.burst(hit, 3, 0.7); }
        var gs = 6 * (1 + 0.2 * rear); aura.scale.set(gs, gs, 1);
        imp.tick(dt);
      };
    }
  });
})();

// =====================================================================
//  STONEWARD — earth & stone creatures
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eIn3 = Q.eIn3, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, cp = KT.cp, tp = KT.tp, C3 = KT.C3, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3(), _e = new T.Vector3();
  function G() { return K().G; }
  function mix(a, b, t) { return K().mix(a, b, t); }
  var ST = '#9a8a70', ST2 = '#7f705a', ST3 = '#b9a37e', MOSS = '#6a8a4a', RUNE = '#ffb347';

  // ground crack: dark disc + amber ring + dust; returns tick(a)
  function Crack(S, at, R, t0, t1) {
    var k = K(), pal = S.pal;
    var dark = S.fade(k.bodyMat('#2a2018', 0.85)), ring = S.fade(k.bodyMat(RUNE, 0.9));
    var d = S.mesh(k.UG.disc(), dark), r = S.mesh(k.UG.ring(), ring);
    d.renderOrder = 3; r.renderOrder = 4;
    d.position.set(at.x, 0.06, at.z); r.position.set(at.x, 0.08, at.z);
    var em = 0;
    return function (a, dt) {
      var vis = a >= t0 && a < t1; d.visible = r.visible = vis; if (!vis) return;
      var kin = eOut(seg(a, t0, t0 + 0.25)), kout = seg(a, t1 - 0.35, t1);
      d.scale.setScalar(Math.max(0.01, R * kin)); r.scale.setScalar(Math.max(0.01, R * 1.05 * kin));
      dark.opacity = 0.85 * (1 - kout); ring.opacity = (0.6 + 0.35 * Math.sin(wt() * 25)) * (1 - kout);
      if (dt > 0 && a < t1 - 0.3) {
        em += dt * 45;
        while (em >= 1) { em -= 1; var th = S.r() * TAU, rr = R * (0.6 + S.r() * 0.5); S.trail(at.x + Math.cos(th) * rr, 0.15, at.z + Math.sin(th) * rr); }
      }
    };
  }
  CI._kit.Crack = Crack;

  // ---------------------------------------------------------------
  //  PEBBLE GOLEM (Pebble Strike, 1 pip): a little rock buddy bursts out
  //  of the ground, hefts a boulder overhead and hurls it.
  // ---------------------------------------------------------------
  function golemBodyGeo(B) {
    var g = G();
    B.add(g.dod(0.36, 0), ST, { p: [0, 0.55, 0], s: [1.15, 1.0, 0.9], flat: true });
    B.add(g.dod(0.22, 0), ST3, { p: [0, 0.5, 0.2], s: [1.2, 0.9, 0.5], flat: true });
    B.add(g.dod(0.24, 0), ST3, { p: [0, 1.02, 0.02], s: [1.05, 0.95, 1.0], flat: true });
    B.add(g.box(0.38, 0.08, 0.14), ST2, { p: [0, 1.12, 0.2], r: [0.2, 0, 0], flat: true });
    B.add(g.ico(0.16, 0), MOSS, { p: [0.08, 1.22, -0.04], s: [1.2, 0.5, 1.1], flat: true });
    B.add(g.box(0.14, 0.28, 0.16), ST2, { p: [0.15, 0.18, 0], flat: true });
    B.add(g.box(0.14, 0.28, 0.16), ST2, { p: [-0.15, 0.18, 0], flat: true });
    B.add(g.box(0.18, 0.08, 0.24), ST3, { p: [0.15, 0.04, 0.04], flat: true });
    B.add(g.box(0.18, 0.08, 0.24), ST3, { p: [-0.15, 0.04, 0.04], flat: true });
    B.glow(g.sph(0.055, 8, 6), RUNE, { p: [0.09, 1.04, 0.22] });
    B.glow(g.sph(0.055, 8, 6), RUNE, { p: [-0.09, 1.04, 0.22] });
    B.glow(g.box(0.12, 0.025, 0.03), '#5a3a10', { p: [0, 0.93, 0.24] });
    B.glow(g.box(0.04, 0.2, 0.02), RUNE, { p: [0, 0.6, 0.31] });
    B.glow(g.box(0.16, 0.035, 0.02), RUNE, { p: [0, 0.62, 0.31] });
  }
  function golemArmGeo(B) {        // pivot at the shoulder, hangs down -Y
    var g = G();
    B.add(g.dod(0.13, 0), ST3, { p: [0, -0.12, 0], flat: true });
    B.add(g.dod(0.17, 0), ST, { p: [0, -0.36, 0.02], flat: true });
  }
  def('pebble_golem', {
    dur: 1.95, impact: 1.25, summonSound: [0.28, 'rumble'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.5, function (F2, P, L) { P.copy(cp(F2, 2.4, 1.3, 3.2)); L.copy(c.refs.gpos).setY(1.1).lerp(F2.hit(0), 0.12); }, { push: 0.15 }],
        [1.06, 'target', { push: 0.2 }], [1.5, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.25, 0, -1.25); c.refs.gpos = at;
      var crack = Crack(S, at, 0.75, 0.22, 1.9);
      var root = S.group(), body = S.group(root);
      glowPart(S, 'pgolem', golemBodyGeo, body, [0.03, RUNE, 0.45]);
      var aR = glowPart(S, 'pgolemArm', golemArmGeo, body), aL = glowPart(S, 'pgolemArm', golemArmGeo, body);
      aR.position.set(0.4, 0.78, 0); aL.position.set(-0.4, 0.78, 0);
      var GS = 1.25; root.scale.setScalar(GS);
      root.position.copy(at); faceFlat(root, _a.subVectors(F.T, at));
      var rock = S.mesh(k.UG.dod(), WF.models.toon(pal.rock2, { flat: true })); rock.castShadow = true;
      S.mesh(k.SG('rim_dod', function () { return k.inflate(k.UG.dod(), 0.12); }), k.rimMat(pal.hot, 0.55), rock);
      rock.visible = false;
      var hit = F.front(0), P0 = new T.Vector3(), ctl = new T.Vector3(), launched = false, landed = false;
      var imp = S.impactFx({ rays: 8 }), trail = rate(50), popped = false;
      return function (a, dt) {
        crack(a, dt);
        var up = eBack(seg(a, 0.3, 0.55)), sink = eIn(seg(a, 1.55, 1.9));
        root.position.y = lerp(-1.5 * GS, 0, up) - sink * 1.6 * GS + 0.2 * GS * bell(a, 1.3, 1.5);
        root.visible = a > 0.28 && sink < 1;
        if (!popped && a > 0.32) { popped = true; S.burst(_a.copy(at).setY(0.4), 14, 0.8); }
        body.rotation.z = Math.sin(wt() * 18) * 0.06 * (1 - smooth(0.6, 0.7, a)) + 0.04 * Math.sin(wt() * 9);
        // arms: raise both (0.55-0.85), throw with the right (0.85-0.95), cheer (1.3)
        var raise = smooth(0.55, 0.8, a) * (1 - smooth(0.85, 0.95, a)), thr = bell(a, 0.85, 1.05), cheer = bell(a, 1.28, 1.55);
        aR.rotation.set(-PI * 0.95 * raise + 1.2 * thr - PI * 0.8 * cheer, 0, -0.2 * raise);
        aL.rotation.set(-PI * 0.95 * raise - PI * 0.8 * cheer, 0, 0.2 * raise);
        body.rotation.x = 0.25 * thr - 0.12 * raise;
        root.updateMatrixWorld(true);
        if (a < 0.88) {
          rock.visible = a > 0.55;
          _b.set(0, 1.65, 0.05); body.localToWorld(_b);
          rock.position.copy(_b); rock.scale.setScalar(0.34 * GS * eOut(seg(a, 0.55, 0.75)));
          rock.rotation.set(wt() * 2, wt() * 3, 0);
          P0.copy(_b);
        } else if (!landed) {
          if (!launched) { launched = true; S.sound('whoosh'); ctl.lerpVectors(P0, hit, 0.5); ctl.y = Math.max(P0.y, hit.y) + 1.6; }
          var kk = seg(a, 0.88, 1.25);
          qbez(P0, ctl, hit, kk, rock.position); rock.rotation.set(wt() * 11, wt() * 8, 0); rock.scale.setScalar(0.34 * GS);
          if (dt > 0) trail(dt, function () { S.trail(rock.position.x, rock.position.y, rock.position.z); });
          if (kk >= 1) { landed = true; rock.visible = false; S.boom(imp, hit, 1.1, { power: 0.55 }); S.land(0); }
        }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  STONE BOAR (Mudslide, 2 pips): a tusked boulder-boar bursts out of
  //  the ground, paws the earth and charges, shoving a wave of mud.
  // ---------------------------------------------------------------
  function boarBodyGeo(B) {
    var g = G();
    B.add(g.dod(1, 0), '#8f7c63', { p: [0, 0.62, -0.05], s: [0.55, 0.5, 0.78], flat: true });
    B.add(g.dod(1, 0), '#a8936f', { p: [0, 0.82, -0.2], s: [0.42, 0.34, 0.55], flat: true });
    B.add(g.dod(0.4, 0), '#a8936f', { p: [0, 0.62, 0.65], s: [1, 0.95, 1.05], flat: true });
    B.add(g.cyl(0.17, 0.2, 0.28, 6), '#7f705a', { p: [0, 0.52, 1.0], r: [PI / 2, 0, 0], flat: true });
    B.add(g.cyl(0.12, 0.12, 0.04, 6), '#5a4a38', { p: [0, 0.52, 1.15], r: [PI / 2, 0, 0], flat: true });
    for (var i = 0; i < 5; i++) B.add(g.ico(0.16, 0), i % 2 ? MOSS : '#7a9a5a', { p: [0, 1.08 - i * 0.015, 0.35 - i * 0.22], s: [1, 0.55, 1.1], flat: true });
    [-1, 1].forEach(function (s) {
      B.add(g.taper([[s * 0.16, 0.45, 1.02], [s * 0.3, 0.55, 1.16], [s * 0.3, 0.82, 1.18]], 0.06, 0.015, 8, 5), '#f2e6c8');
      B.add(g.cone(0.1, 0.22, 4), '#7f705a', { p: [s * 0.24, 0.98, 0.58], r: [-0.4, 0, s * -0.5], flat: true });
      B.glow(g.sph(0.06, 8, 6), RUNE, { p: [s * 0.2, 0.74, 0.92] });
      B.glow(g.box(0.16, 0.035, 0.04), '#3a2810', { p: [s * 0.19, 0.83, 0.92], r: [0, 0, s * 0.45] });
    });
    B.glow(g.box(0.05, 0.3, 0.04), RUNE, { p: [0.4, 0.66, 0.1], r: [0, 0.2, 0.3] });
    B.glow(g.box(0.05, 0.3, 0.04), RUNE, { p: [-0.4, 0.66, 0.1], r: [0, -0.2, -0.3] });
  }
  function boarLegGeo(B) { var g = G(); B.add(g.cyl(0.1, 0.08, 0.36, 6), '#7f705a', { p: [0, -0.18, 0], flat: true }); B.add(g.box(0.16, 0.08, 0.18), '#5a4a38', { p: [0, -0.36, 0.02], flat: true }); }
  def('stone_boar', {
    dur: 2.45, impact: 1.62, summonSound: [0.32, 'rumble'],
    cam: function (F, c) {
      var boar = function () { return c.refs.boar; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.48, function (F2, P, L) { P.copy(cp(F2, 4.6, 1.2, 0.4)); L.copy(c.refs.at).setY(0.8); }, { push: 0.15 }],
        [0.86, CI.chase(boar, 1.2, 1.3, 6.0, { dy: 0.6 })],
        [1.5, 'target', { pull: 0.6 }], [1.98, 'home', { blend: 0.45 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.3, 0, -1.6); c.refs.at = at;
      var crack = Crack(S, at, 1.0, 0.3, 1.2);
      var boar = S.group(), inner = S.group(boar);
      glowPart(S, 'boar', boarBodyGeo, inner, [0.035, RUNE, 0.4]);
      var legs = [[0.28, 0.4, 0.45], [-0.28, 0.4, 0.45], [0.3, 0.4, -0.45], [-0.3, 0.4, -0.45]].map(function (p) { var l = glowPart(S, 'boarLeg', boarLegGeo, inner); l.position.set(p[0], p[1], p[2]); return l; });
      var BS = 1.15; inner.scale.setScalar(BS);
      boar.visible = false; c.refs.boar = boar;
      // mud wave pushed ahead (stone-coloured curl)
      var curl = S.mesh(WF.models._fx.curlGeo(), WF.models.toon('#6e5a40', { flat: true, side: T.DoubleSide })); curl.castShadow = true; curl.visible = false;
      var curl2 = S.mesh(WF.models._fx.curlGeo(), S.fade(K().bodyMat('#8a7050', 0.8))); curl2.visible = false;
      var Tc = F.feet(0), hit = F.front(0);
      var stop = Tc.clone().addScaledVector(_a.copy(Tc).sub(at).setY(0).normalize(), -(0.6 + F.hs(0) * 0.6));
      var imp = S.impactFx({ rays: 9, debrisN: 10 }), landed = false, em = rate(90), snorted = false;
      return function (a, dt) {
        crack(a, dt);
        boar.visible = a > 0.4 && a < 1.95;
        if (!boar.visible) { curl.visible = curl2.visible = false; imp.tick(dt); return; }
        var kc = eIn(seg(a, 0.82, 1.62));
        boar.position.lerpVectors(at, stop, kc);
        boar.position.y = lerp(-1.4, 0, eBack(seg(a, 0.4, 0.62))) + (a > 0.82 && a < 1.62 ? Math.abs(Math.sin(wt() * 22)) * 0.12 : 0);
        faceFlat(boar, _a.subVectors(stop, at));
        var paw = bell(a, 0.6, 0.8);
        inner.rotation.x = -0.15 * paw + (a > 0.82 ? 0.12 : 0);
        legs.forEach(function (l, i) {
          if (a < 0.82) l.rotation.x = i === 0 ? -0.9 * Math.abs(Math.sin(wt() * 20)) * paw : 0;
          else l.rotation.x = Math.sin(wt() * 22 + (i % 2 ? PI : 0) + (i < 2 ? 0 : PI / 2)) * 0.9;
        });
        if (!snorted && a > 0.65) { snorted = true; S.sound('snort'); for (var q = 0; q < 8; q++) { _b.set(0, 0.55, 1.2).applyQuaternion(boar.quaternion).multiplyScalar(BS).add(boar.position); S.trail(_b.x + (S.r() - 0.5) * 0.3, _b.y, _b.z + (S.r() - 0.5) * 0.3); } }
        inner.scale.setScalar(BS * (1 - seg(a, 1.75, 1.95)));
        var wave = smooth(0.85, 1.05, a) * (1 - smooth(1.6, 1.85, a));
        curl.visible = curl2.visible = wave > 0.01;
        if (curl.visible) {
          _b.set(0, 0, 1.5 * BS).applyQuaternion(boar.quaternion).add(boar.position).setY(0);
          curl.position.copy(_b); curl2.position.copy(_b); curl.quaternion.copy(boar.quaternion); curl2.quaternion.copy(boar.quaternion);
          var W = 1.8 + F.hs(0) * 0.6, H = 0.8 * wave;
          curl.scale.set(W, Math.max(0.01, H), 1.2); curl2.scale.set(W * 1.03, Math.max(0.01, H * 1.05), 1.25);
          curl2.material.opacity = 0.8 * wave;
          if (dt > 0) em(dt, function () { var x = (S.r() - 0.5) * W; _c.set(x, H * (0.4 + S.r() * 0.6), 0.2).applyQuaternion(boar.quaternion).add(_b); S.trail(_c.x, _c.y, _c.z); });
        }
        if (!landed && a >= 1.62) { landed = true; S.boom(imp, hit, 1.5, { power: 0.8 }); S.land(0); S.sound('crash', true); }
        if (a > 1.75 && a < 1.8 && dt > 0) S.burst(_a.copy(boar.position).setY(0.6), 16, 0.7);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  shared stone giant torso (Golem Fist / Titan). Origin at the waist,
  //  faces +Z. Arms are models.js stone arms on shoulder pivots.
  // ---------------------------------------------------------------
  function giantTorsoGeo(B) {
    var g = G();
    B.add(g.box(2.6, 1.9, 1.5), ST, { p: [0, 0.95, 0], flat: true });
    B.add(g.dod(1.05, 0), ST2, { p: [0, 0.2, -0.05], s: [1.25, 0.6, 0.85], flat: true });
    B.add(g.box(1.15, 0.9, 0.35), ST3, { p: [-0.62, 1.35, 0.68], r: [0.08, 0.1, 0.05], flat: true });
    B.add(g.box(1.15, 0.9, 0.35), ST3, { p: [0.62, 1.35, 0.68], r: [0.08, -0.1, -0.05], flat: true });
    B.add(g.box(1.6, 0.55, 0.3), ST2, { p: [0, 0.55, 0.72], flat: true });
    [-1, 1].forEach(function (s) {
      B.add(g.dod(0.78, 0), ST3, { p: [s * 1.55, 1.75, 0], s: [1.05, 0.85, 1], flat: true });
      B.add(g.ico(0.55, 0), MOSS, { p: [s * 1.6, 2.25, -0.05], s: [1.2, 0.45, 1.1], flat: true });
      for (var sp = 0; sp < 3; sp++) B.add(g.cone(0.16, 0.55 - sp * 0.1, 5), ST3, { p: [s * (1.35 + sp * 0.28), 2.35 - sp * 0.08, -0.25], r: [-0.3, 0, s * -0.4], flat: true });
    });
    // head
    B.add(g.dod(0.62, 0), ST3, { p: [0, 2.45, 0.25], s: [1, 1.1, 0.95], flat: true });
    B.add(g.box(0.95, 0.28, 0.4), ST2, { p: [0, 2.72, 0.62], r: [0.25, 0, 0], flat: true });
    B.add(g.box(0.7, 0.35, 0.5), ST2, { p: [0, 2.05, 0.55], flat: true });
    for (var c = 0; c < 5; c++) B.add(g.cone(0.13, 0.42 + (c === 2 ? 0.2 : 0), 5), ST3, { p: [(c - 2) * 0.22, 3.05 - Math.abs(c - 2) * 0.06, 0.1], flat: true });
    B.add(g.ico(0.3, 0), MOSS, { p: [-0.3, 3.0, -0.1], s: [1.3, 0.4, 1.2], flat: true });
    B.glow(g.sph(0.13, 8, 6), RUNE, { p: [0.24, 2.5, 0.82], s: [1.2, 0.8, 0.6] });
    B.glow(g.sph(0.13, 8, 6), RUNE, { p: [-0.24, 2.5, 0.82], s: [1.2, 0.8, 0.6] });
    B.glow(g.box(0.5, 0.05, 0.05), '#ff8a1a', { p: [0, 2.12, 0.81] });
    // chest rune: a diamond + spokes
    B.glow(g.box(0.08, 0.95, 0.06), RUNE, { p: [0, 1.25, 0.88] });
    B.glow(g.box(0.8, 0.08, 0.06), RUNE, { p: [0, 1.25, 0.88] });
    [[0.27, 1.52, 0.78], [-0.27, 1.52, -0.78], [0.27, 0.98, -0.78], [-0.27, 0.98, 0.78]].forEach(function (d) { B.glow(g.box(0.07, 0.5, 0.06), RUNE, { p: [d[0], d[1], 0.89], r: [0, 0, d[2]] }); });
  }
  function Giant(S, scale, parent) {
    var k = K(), root = S.group(parent), body = S.group(root);
    glowPart(S, 'giantTorso', giantTorsoGeo, body, [0.06, RUNE, 0.4]);
    var eyes = [S.halo(RUNE, 0.9, 0.7, body), S.halo(RUNE, 0.9, 0.7, body)];
    eyes[0].position.set(0.24, 2.5, 0.85); eyes[1].position.set(-0.24, 2.5, 0.85);
    var sR = S.group(body), sL = S.group(body);
    sR.position.set(1.55, 1.6, 0.1); sL.position.set(-1.55, 1.6, 0.1);
    var armR = WF.models._fx.stoneArm(S.ctx, 2.0, sR), armL = WF.models._fx.stoneArm(S.ctx, 2.0, sL);
    root.scale.setScalar(scale);
    return { root: root, body: body, sR: sR, sL: sL, armR: armR, armL: armL, eyes: eyes, reach: (2.0 + 0.85) };
  }
  CI._kit.Giant = Giant;

  // ---------------------------------------------------------------
  //  GOLEM FIST (3 pips): a stone golem heaves itself out of the ground
  //  behind the target, roars and brings its fist down.
  // ---------------------------------------------------------------
  def('golem_fist', {
    dur: 2.8, impact: 1.98, summonSound: [0.35, 'rumble'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, function (F2, P, L) { P.copy(tp(F2, 0, -1.4, 1.5, 6.4 + F2.th * 0.5)); L.copy(c.refs.gat).setY(2.0 * c.refs.GS).lerp(F2.feet(0).setY(F2.th * 0.5), 0.35); }, { push: 0.12 }],
        [1.2, function (F2, P, L) { P.copy(tp(F2, 0, -3.9 - F2.th * 0.4, 0.8, 2.8)); L.copy(c.refs.gat).setY(3.3 * c.refs.GS); }, { push: 0.1 }],
        [1.78, 'target', { pull: 1.0 }], [2.3, 'home', { blend: 0.48 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var GS = clamp(0.9 + F.th * 0.12, 1.0, 1.4); c.refs.GS = GS;
      var gt = Giant(S, GS);
      // stand behind the target so the fist lands on it
      var reach = gt.reach * GS, shoulderH = 1.6 * GS, hT = Math.max(0.6, F.th * 0.45);
      var th = Math.acos(clamp((hT - shoulderH) / reach, -0.95, 0.95)), dBack = reach * Math.sin(th);
      var want = F.feet(0).addScaledVector(F.f, dBack + 0.2);
      gt.root.position.copy(want); faceFlat(gt.root, _a.copy(F.f).negate());
      gt.root.updateMatrixWorld(true); gt.sR.getWorldPosition(_b);
      gt.root.position.x += want.x - _b.x; gt.root.position.z += want.z - _b.z;      // right shoulder lines up with the target
      var at = gt.root.position.clone().setY(0); c.refs.gat = at;
      var crack = Crack(S, at, 2.4 * GS, 0.3, 2.7);
      var hit = F.front(0).addScaledVector(F.f, 0.2), imp = S.impactFx({ rays: 11, debrisN: 10 }), landed = false, roared = false;
      gt.sR.rotation.set(PI * 0.85, 0, 0.2); gt.sL.rotation.set(PI * 0.9, 0, -0.25);
      return function (a, dt) {
        crack(a, dt);
        var rise = eOut(seg(a, 0.4, 1.15)), sink = eIn(seg(a, 2.15, 2.7));
        gt.root.visible = a > 0.38 && sink < 1;
        gt.root.position.y = lerp(-3.4 * GS, -0.15 * GS, rise) - sink * 3.6 * GS + Math.sin(wt() * 30) * 0.03 * (1 - rise);
        var lift = smooth(1.1, 1.5, a), slam = eIn(seg(a, 1.62, 1.98)), rec = smooth(2.05, 2.3, a);
        gt.sR.rotation.x = lerp(PI * 0.85, -0.25, lift) + (th + 0.25) * slam - 0.3 * rec;
        gt.sR.rotation.z = 0.2 + 0.1 * lift;
        gt.body.rotation.x = -0.12 * lift + 0.3 * slam - 0.2 * rec;
        gt.body.rotation.y = 0.25 * lift - 0.25 * slam;
        gt.sL.rotation.x = PI * 0.9 - 0.4 * lift;
        var es = 0.9 * (1 + 0.6 * bell(a, 1.15, 1.6)); gt.eyes.forEach(function (e) { e.scale.set(es, es, 1); });
        if (!roared && a > 1.18) { roared = true; S.sound('roar_stone'); }
        if (dt > 0 && a > 0.4 && a < 1.1) for (var q = 0; q < 2; q++) { var an = S.r() * TAU, rr = (1.2 + S.r() * 1.4) * GS; S.trail(at.x + Math.cos(an) * rr, 0.2, at.z + Math.sin(an) * rr); }
        if (!landed && a >= 1.98) { landed = true; S.boom(imp, hit, 1.9, { power: 1.0 }); S.land(0); S.sound('crash', true); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  QUAKE RAM (Quake, 4 pips, all enemies): a great stone ram with
  //  glowing curled horns charges out, leaps high over the enemies and
  //  stamps down - the ground erupts in stone spikes under each of them.
  // ---------------------------------------------------------------
  function ramBodyGeo(B) {
    var g = G();
    B.add(g.dod(1, 0), '#9a8a70', { p: [0, 0.95, 0], s: [0.6, 0.55, 0.95], flat: true });
    B.add(g.dod(1, 0), '#d8c8a8', { p: [0, 1.1, -0.05], s: [0.62, 0.45, 0.85], flat: true });       // woolly stone fleece
    for (var w = 0; w < 7; w++) B.add(g.ico(0.22, 0), '#e2d4b4', { p: [Math.sin(w * 2.1) * 0.38, 1.38 + (w % 2) * 0.05, 0.5 - w * 0.17], flat: true });
    B.add(g.dod(0.36, 0), '#a8936f', { p: [0, 1.25, 0.95], s: [0.9, 1.0, 1.15], flat: true });
    B.add(g.box(0.36, 0.3, 0.42), '#8f7c63', { p: [0, 1.12, 1.25], flat: true });
    [-1, 1].forEach(function (s) {
      B.add(g.taper([[s * 0.2, 1.48, 0.92], [s * 0.6, 1.7, 0.7], [s * 0.78, 1.45, 0.4], [s * 0.62, 1.12, 0.55], [s * 0.6, 1.0, 0.92]], 0.15, 0.05, 16, 7), '#c8b48a');
      B.glow(g.taper([[s * 0.26, 1.58, 0.86], [s * 0.64, 1.78, 0.66], [s * 0.86, 1.5, 0.36]], 0.035, 0.02, 10, 4), RUNE);
      B.glow(g.sph(0.06, 8, 6), RUNE, { p: [s * 0.2, 1.32, 1.2] });
      B.glow(g.box(0.16, 0.035, 0.04), '#3a2810', { p: [s * 0.19, 1.41, 1.19], r: [0, 0, s * 0.4] });
    });
    B.glow(g.box(0.05, 0.4, 0.04), RUNE, { p: [0.55, 0.95, 0.1], r: [0, 0.2, 0.25] });
    B.glow(g.box(0.05, 0.4, 0.04), RUNE, { p: [-0.55, 0.95, 0.1], r: [0, -0.2, -0.25] });
  }
  function ramLegGeo(B) { var g = G(); B.add(g.cyl(0.12, 0.09, 0.62, 6), '#7f705a', { p: [0, -0.31, 0], flat: true }); B.add(g.box(0.2, 0.12, 0.24), '#4a3a2a', { p: [0, -0.62, 0.02], flat: true }); }
  def('quake_ram', {
    len: function () { return { dur: 3.3, impact: 1.95, impactEnd: 2.45 }; },
    summonSound: [0.38, 'rumble'],
    cam: function (F, c) {
      var ram = function () { return c.refs.ram; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, CI.chase(ram, 2.8, 1.4, 4.0, { dy: 0.9 })],
        [1.05, CI.follow(ram, function (F2, u, P) { P.copy(F2.Tc).addScaledVector(F2.f, -2.0).addScaledVector(F2.s, 7.5 + spreadOf(F2)).setY(2.0); }, { dy: 0.8 })],
        [1.72, 'targets', { pull: 2.6, dp: [0, 1.4, 0] }], [2.75, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.1, 0, -1.9);
      var crack = Crack(S, at, 1.2, 0.3, 1.2);
      var ram = S.group(), inner = S.group(ram);
      glowPart(S, 'ram', ramBodyGeo, inner, [0.04, RUNE, 0.45]);
      var legs = [[0.3, 0.7, 0.55], [-0.3, 0.7, 0.55], [0.32, 0.7, -0.5], [-0.32, 0.7, -0.5]].map(function (p) { var l = glowPart(S, 'ramLeg', ramLegGeo, inner); l.position.set(p[0], p[1], p[2]); return l; });
      var RS = 1.25; inner.scale.setScalar(RS);
      ram.visible = false; c.refs.ram = ram;
      var land = F.Tc.clone().addScaledVector(F.f, 2.6 + F.thMax * 0.25);
      var apex = F.Tc.clone().addScaledVector(F.f, -0.5).setY(5.2 + F.thMax * 0.9);
      var n = F.targets.length, spikes = [], imps = [];
      var stoneM = WF.models.toon(pal.rock2, { flat: true }), stoneM2 = WF.models.toon(pal.rock, { flat: true });
      F.targets.forEach(function (t, i) {
        var list = [];
        for (var j = 0; j < 6; j++) {
          var m = S.mesh(k.UG.cone5(), j % 2 ? stoneM : stoneM2); m.castShadow = j === 0; m.visible = false;
          var a0 = j * TAU / 5 + S.r() * 0.5, rad = j === 0 ? 0 : (0.55 + S.r() * 0.35) * F.hs(i);
          m.userData = { off: new T.Vector3(Math.cos(a0) * rad, 0, Math.sin(a0) * rad), h: (j === 0 ? 1.6 : 0.8 + S.r() * 0.6) * (0.8 + F.hs(i) * 0.35), w: (j === 0 ? 0.42 : 0.26) * (0.8 + F.hs(i) * 0.3), tilt: [Math.sin(a0) * (j ? 0.4 : 0.05), -Math.cos(a0) * (j ? 0.4 : 0.05)], sharedGeometry: true };
          list.push(m);
        }
        spikes.push({ list: list, t: 1.98 + i * 0.2, done: false, pos: t.pos.clone() });
        imps.push(S.impactFx({ rays: 6, debrisN: 3 }));
      });
      var stomp = S.impactFx({ rays: 10, debrisN: 5 }), stomped = false, bleated = false;
      var shockBig = Q.Shock(S, RUNE, 0.85);
      return function (a, dt) {
        crack(a, dt);
        ram.visible = a > 0.4 && a < 2.3;
        if (ram.visible) {
          var p = ram.position;
          if (a < 0.95) { var kr = seg(a, 0.6, 0.95); p.lerpVectors(at, _a.lerpVectors(at, land, 0.18), kr); p.y = lerp(-1.6, 0, eBack(seg(a, 0.4, 0.6))) + Math.abs(Math.sin(wt() * 20)) * 0.1 * kr; }
          else if (a < 1.75) { var kj = seg(a, 0.95, 1.75); qbez(_a.lerpVectors(at, land, 0.18), apex, land, kj, p); }
          if (a >= 0.95) faceFlat(ram, _b.subVectors(land, at)); 
          else p.copy(land);
          faceFlat(ram, _b.subVectors(land, at));
          var air = a > 0.95 && a < 1.75;
          inner.rotation.x = air ? lerp(-0.45, 0.4, seg(a, 0.95, 1.75)) : (a < 0.95 ? 0.08 : -0.1 * bell(a, 1.75, 1.95));
          legs.forEach(function (l, i) { l.rotation.x = air ? (i < 2 ? -0.9 : 0.9) : (a < 0.95 ? Math.sin(wt() * 20 + (i % 2) * PI) * 0.7 : 0); });
          inner.scale.setScalar(RS * (1 - seg(a, 2.1, 2.3)));
          if (!bleated && a > 0.62) { bleated = true; S.sound('bleat_stone'); }
          if (dt > 0 && air) S.trail(p.x, p.y + 0.8, p.z);
        }
        if (!stomped && a >= 1.75) { stomped = true; S.boom(stomp, _a.copy(land).setY(0.4), 1.4, { power: 1.0, sound: 'crash' }); shockBig.go(land, 6 + spreadOf(F) * 1.5, 0.7); }
        shockBig.tick(dt);
        spikes.forEach(function (sp, i) {
          if (!sp.done && a >= sp.t) { sp.done = true; S.boom(imps[i], F.front(i), 1.2, { power: 0.6, boomSound: false }); S.land(i); }
          var k2 = seg(a, sp.t - 0.05, sp.t + 0.1), kr2 = seg(a, sp.t + 0.6, sp.t + 0.95);
          sp.list.forEach(function (m) {
            var y = eBack(k2) * (1 - eIn(kr2));
            m.visible = y > 0.003;
            m.position.copy(sp.pos).add(m.userData.off); m.position.y = -kr2 * m.userData.h * 0.3;
            m.rotation.set(m.userData.tilt[0], 0, m.userData.tilt[1]);
            m.scale.set(m.userData.w, Math.max(0.001, m.userData.h * y), m.userData.w);
          });
        });
        stomp.tick(dt); imps.forEach(function (im) { im.tick(dt); });
      };
    }
  });
  function spreadOf(F) { var m = 0; F.targets.forEach(function (t) { m = Math.max(m, t.pos.distanceTo(F.Tc)); }); return m; }
  var spreadOf2 = spreadOf;

  // ---------------------------------------------------------------
  //  STONE TITAN (Titan's Wrath, 5 pips): the arena splits open and a
  //  colossal titan rises behind the enemies, lifts both fists and
  //  brings them down together.
  // ---------------------------------------------------------------
  def('titan', {
    dur: 4.3, impact: 3.1, bigCast: true, summonSound: [0.35, 'rumble_big'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, 'wide', { push: 0.15 }],
        [1.0, function (F2, P, L, u) { P.copy(F2.Tc).addScaledVector(F2.f, -1.0).addScaledVector(F2.s, 9 + spreadOf2(F2)).setY(1.4); L.copy(c.refs.tat).setY((1.2 + 1.6 * u) * c.refs.TS); }],
        [1.95, function (F2, P, L, u) { P.copy(cp(F2, -3.2, 1.2, 2.2)); L.copy(c.refs.tat).setY(3.2 * c.refs.TS + 1); }, { push: 0.12 }],
        [2.62, function (F2, P, L, u) { P.copy(F2.Tc).addScaledVector(F2.f, -3.5).addScaledVector(F2.s, 6.5 + spreadOf2(F2)).setY(1.0); L.copy(c.refs.tat).addScaledVector(F2.f, -1.5).setY(3.0 * c.refs.TS); }],
        [3.1, 'targets', { pull: 2.4, dp: [0, 0.8, 0] }],
        [3.65, 'home', { blend: 0.6 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var TS = clamp(1.25 + F.thMax * 0.12, 1.4, 1.95); c.refs.TS = TS;
      var gt = Giant(S, TS);
      var reach = gt.reach * TS, shoulderH = 1.6 * TS + 0.0, hT = Math.max(0.6, F.thMax * 0.4);
      var th = Math.acos(clamp((hT - shoulderH) / reach, -0.95, 0.95)), dBack = reach * Math.sin(th);
      var at = F.Tc.clone().addScaledVector(F.f, dBack + 0.3); c.refs.tat = at;
      gt.root.position.copy(at); faceFlat(gt.root, _a.copy(F.f).negate());
      var crack = Crack(S, at, 3.6 * TS * 0.75, 0.3, 4.1);
      var pillars = [];
      for (var i = 0; i < 7; i++) {
        var pm = S.mesh(k.UG.cone5(), WF.models.toon(i % 2 ? pal.rock : pal.rock2, { flat: true })); pm.castShadow = true;
        var an = Math.atan2(F.f.x, F.f.z) + (i - 3) * 0.42; pm.position.set(at.x + Math.sin(an) * 2.8 * TS, 0, at.z + Math.cos(an) * 2.8 * TS);
        pm.rotation.set(Math.cos(an) * 0.45, 0, -Math.sin(an) * 0.45); pm.userData.h = (1.2 + S.r() * 1.0) * TS; pm.visible = false; pillars.push(pm);
      }
      gt.sR.rotation.set(PI * 0.92, 0, 0.15); gt.sL.rotation.set(PI * 0.92, 0, -0.15);
      var imp = S.impactFx({ rays: 14, debrisN: 12 }), landed = false, roared = false;
      var hit = F.targets.length > 1 ? F.Tc.clone().setY(0.6) : F.front(0);
      return function (a, dt) {
        crack(a, dt);
        var rise = eOut(seg(a, 0.85, 1.95)), sink = eIn(seg(a, 3.55, 4.2));
        gt.root.visible = a > 0.8 && sink < 1;
        gt.root.position.y = lerp(-3.6 * TS, -0.35 * TS, rise) - sink * 3.8 * TS + Math.sin(wt() * 26) * 0.04 * (1 - rise) * TS;
        var up = smooth(1.95, 2.55, a), slam = eIn(seg(a, 2.72, 3.1)), rec = smooth(3.2, 3.5, a);
        var ang = lerp(PI * 0.92, -0.35, up) + (th + 0.35) * slam - 0.25 * rec;
        gt.sR.rotation.set(ang, 0, 0.15 + 0.45 * up * (1 - slam) - 0.1 * slam); gt.sL.rotation.set(ang, 0, -0.15 - 0.45 * up * (1 - slam) + 0.1 * slam);
        gt.body.rotation.x = -0.18 * up + 0.42 * slam - 0.25 * rec;
        var es = 1.1 * (1 + 0.7 * bell(a, 1.6, 2.3)); gt.eyes.forEach(function (e) { e.scale.set(es, es, 1); });
        if (!roared && a > 1.7) { roared = true; S.sound('roar_stone'); S.shake(0.4, 0.8); }
        pillars.forEach(function (pm, i) { var kk = eBack(seg(a, 0.75 + i * 0.04, 1.0 + i * 0.04)) * (1 - seg(a, 3.6, 4.1)); pm.visible = kk > 0.002; pm.scale.set(0.5 * TS, Math.max(0.001, pm.userData.h * kk), 0.5 * TS); });
        if (dt > 0 && a > 0.8 && a < 1.9) for (var q = 0; q < 3; q++) { var an2 = S.r() * TAU, rr = (1.8 + S.r() * 2.0) * TS; S.trail(at.x + Math.cos(an2) * rr, 0.2, at.z + Math.sin(an2) * rr); }
        if (dt > 0 && a > 0.8 && a < 1.9 && S.r() < 0.3) S.shake(0.15, 0.2);
        if (!landed && a >= 3.1) { landed = true; S.boom(imp, hit, 2.6, { power: 1.6, sound: 'crash' }); S.landAll(); }
        if (landed && dt > 0 && a < 3.5) for (var q2 = 0; q2 < 3; q2++) { var an3 = S.r() * TAU, rr2 = (0.5 + S.r() * 3.2); S.trail(F.Tc.x + Math.cos(an3) * rr2, 0.25, F.Tc.z + Math.sin(an3) * rr2); }
        imp.tick(dt);
      };
    }
  });
})();

// =====================================================================
//  TIDECALLER — water & moon creatures
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eIn3 = Q.eIn3, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, cp = KT.cp, tp = KT.tp, C3 = KT.C3, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3(), _e = new T.Vector3();
  function G() { return K().G; }
  function mix(a, b, t) { return K().mix(a, b, t); }
  function spreadOf(F) { var m = 0; F.targets.forEach(function (t) { m = Math.max(m, t.pos.distanceTo(F.Tc)); }); return m; }

  // glowing motes that stream from the target(s) back to the caster (drain spells)
  function Drain(S, F, t0, t1, o) {
    o = o || {};
    var k = K(), pal = S.pal, orbs = [], n = o.n || 6;
    var mat = WF.models.glow(o.color || pal.b);
    for (var i = 0; i < n; i++) {
      var g = S.group(), m = S.mesh(k.UG.sph(), mat, g); m.scale.setScalar(0.13);
      S.halo(o.color || pal.a, 0.9, 0.7, g);
      var ti = i % F.targets.length, from = F.hit(ti), to = F.C.clone().setY(F.ch * 0.6);
      var ctl = new T.Vector3().lerpVectors(from, to, 0.5).addScaledVector(F.s, (S.r() - 0.5) * 3).setY(Math.max(from.y, to.y) + 1.2 + S.r() * 1.5);
      g.visible = false;
      orbs.push({ g: g, from: from, to: to, ctl: ctl, d: (i / n) * (t1 - t0) * 0.45 });
    }
    var ring = Q.Shock(S, o.color || pal.b, 0.85), arrived = 0;
    return function (a, dt) {
      orbs.forEach(function (ob) {
        var k2 = seg(a, t0 + ob.d, t0 + ob.d + (t1 - t0) * 0.55);
        ob.g.visible = k2 > 0 && k2 < 1;
        if (!ob.g.visible) { if (k2 >= 1 && !ob.done) { ob.done = true; arrived++; S.burst(ob.to, 5, 0.5); if (arrived === 1) { ring.go(F.C, 1.6, 0.6); S.sound('drain'); } } return; }
        qbez(ob.from, ob.ctl, ob.to, eInOut(k2), ob.g.position);
        if (dt > 0 && S.r() < 0.6) S.pa.emit(ob.g.position.x, ob.g.position.y, ob.g.position.z, 0, 0, 0, 0.35, 0.22, 0.02, pal.Co, pal.A, 0.9, 0, 0);
      });
      ring.tick(dt);
    };
  }
  CI._kit.Drain = Drain;

  // rising water column (spout / geyser) at a point
  function Spout(S, at, R, H) {
    var k = K(), pal = S.pal;
    var m1 = S.fade(k.bodyMat(pal.a, 0.78)), m2 = S.fade(k.bodyMat(pal.core, 0.7));
    var c1 = S.mesh(k.UG.cylT(), m1), c2 = S.mesh(k.UG.cylT(), m2); c1.visible = c2.visible = false;
    var foam = Q.Shock(S, '#f0fcff', 0.9), em = 0;
    return {
      tick: function (a, t0, t1, dt) {
        var on = a >= t0 && a < t1; c1.visible = c2.visible = on;
        foam.tick(dt);
        if (!on) return;
        var kin = eOut(seg(a, t0, t0 + 0.18)), kout = seg(a, t1 - 0.3, t1);
        var h = H * kin * (1 - 0.6 * eIn(kout));
        c1.position.set(at.x, 0, at.z); c2.position.set(at.x, 0, at.z);
        c1.scale.set(R * (1 + 0.08 * Math.sin(wt() * 30)), Math.max(0.01, h), R * (1 + 0.08 * Math.sin(wt() * 30))); c2.scale.set(R * 0.45, Math.max(0.01, h * 1.08), R * 0.45);
        c1.rotation.y = wt() * 6; m1.opacity = 0.78 * (1 - kout); m2.opacity = 0.7 * (1 - kout);
        if (dt > 0) { em += dt * 60; while (em >= 1) { em -= 1; var th = S.r() * TAU; S.pc.emit(at.x + Math.cos(th) * R * 0.4, h, at.z + Math.sin(th) * R * 0.4, Math.cos(th) * (1 + S.r() * 2), 1 + S.r() * 3, Math.sin(th) * (1 + S.r() * 2), 0.6, 0.3, 0.12, pal.Bc, pal.D, 1, -10, 0.3); } }
      },
      foam: function (r) { foam.go(at, r || R * 2.5, 0.6); }
    };
  }
  CI._kit.Spout = Spout;

  // ---------------------------------------------------------------
  //  WATER SPRITE (Ripple, 1 pip): a droplet sprite splashes out of a
  //  puddle, spins up a water orb and flings it.
  // ---------------------------------------------------------------
  function spriteGeo(B) {
    var g = G();
    B.glow(g.sph(1, 16, 12), '#5cc8f0', { p: [0, 0, 0], s: [0.3, 0.3, 0.3] });
    B.glow(g.cone(0.21, 0.42, 14), '#5cc8f0', { p: [0, 0.31, 0], r: [0, 0, 0] });
    B.glow(g.sph(1, 12, 10), '#bdf0ff', { p: [0, -0.05, 0.12], s: [0.2, 0.2, 0.2] });
    B.glow(g.taper([[0, 0.5, 0], [0.04, 0.62, -0.06], [0.12, 0.66, 0.0], [0.1, 0.6, 0.06]], 0.035, 0.012, 10, 5), '#8fe4ff');
    [-1, 1].forEach(function (s) {
      B.glow(g.sph(0.085, 10, 8), '#ffffff', { p: [s * 0.11, 0.05, 0.25], s: [1, 1.2, 0.7] });
      B.glow(g.sph(0.05, 8, 6), '#0a2a5a', { p: [s * 0.115, 0.04, 0.3] });
      B.glow(g.sph(0.018, 6, 4), '#ffffff', { p: [s * 0.1, 0.07, 0.34] });
      B.glow(g.sph(0.03, 6, 4), '#ff9ab8', { p: [s * 0.2, -0.04, 0.24] });
    });
    B.glow(g.tor(0.05, 0.012, 4, 10, PI), '#0a2a5a', { p: [0, -0.06, 0.29], r: [0, 0, PI] });
  }
  function finGeo(B) { var g = G(); B.glow(g.disc(1, 14), '#8fe4ff', { p: [0.22, 0, 0], r: [-PI / 2, 0.3, 0], s: [0.24, 0.12, 1], order: 'YXZ' }); B.glow(g.disc(1, 12), '#d8f8ff', { p: [0.2, 0.003, 0], r: [-PI / 2, 0.3, 0], s: [0.14, 0.06, 1], order: 'YXZ' }); }
  def('water_sprite', {
    dur: 1.95, impact: 1.24, summonSound: [0.3, 'splash_small'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.5, function (F2, P, L) { P.copy(cp(F2, 4.0, 1.5, 1.4)); L.copy(c.refs.spos).setY(1.5).lerp(F2.hit(0), 0.15); }, { push: 0.15 }],
        [1.08, 'target', { push: 0.2 }], [1.5, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var at = cp(F, 1.3, 0, -1.2); c.refs.spos = at;
      var portal = Q.Portal(S, at, 0.6, 0.24, 1.85, { rate: 40, spin: 4 });
      var spr = S.group(), inner = S.group(spr);
      glowPart(S, 'wsprite', spriteGeo, inner, [0.03, '#e8fbff', 0.85]);
      var fR = glowPart(S, 'wfin', finGeo, inner, null, { dbl: true }), fL = glowPart(S, 'wfin', finGeo, inner, null, { dbl: true });
      fR.position.set(0.18, 0.12, -0.08); fL.position.set(-0.18, 0.12, -0.08); fL.scale.x = -1;
      S.halo(pal.a, 1.4, 0.45, inner);
      var SS = 1.5; inner.scale.setScalar(SS);
      spr.position.copy(at); faceFlat(spr, _a.subVectors(F.T, at));
      var orb = S.group(), oc = S.mesh(k.UG.sph(), WF.models.glow(pal.core), orb); oc.scale.setScalar(0.14);
      var os = S.mesh(k.UG.sph(), k.bodyMat(pal.a, 0.75), orb); os.scale.setScalar(0.26);
      var r1 = S.mesh(k.UG.tor(), k.bodyMat(pal.b, 0.95), orb), r2 = S.mesh(k.UG.tor(), k.bodyMat(pal.deep, 0.9), orb);
      S.halo(pal.a, 1.3, 0.5, orb); orb.visible = false;
      var hit = F.front(0), P0 = new T.Vector3(), ctl = new T.Vector3(), launched = false, landed = false, popped = false, trail = rate(90);
      var imp = S.impactFx({ rays: 8, rayColor: '#d8f8ff' }), sp = Spout(S, F.feet(0), 0.45 * F.hs(0), 1.2 + F.th * 0.4);
      return function (a, dt) {
        portal.tick(a, dt);
        var up = eBack(seg(a, 0.32, 0.56)), pop = seg(a, 1.62, 1.8);
        spr.visible = a > 0.3 && pop < 1;
        spr.position.y = lerp(-0.4, 1.2, up) + Math.sin(wt() * 6) * 0.08;
        inner.rotation.y = a < 0.86 ? (a > 0.55 ? (a - 0.55) * 14 : 0) : -0.3 * bell(a, 0.86, 1.05);
        inner.scale.set(SS * (1 + 0.3 * pop), SS * (1 - 0.5 * pop), SS * (1 + 0.3 * pop));
        var fl = Math.sin(wt() * 24) * 0.6; fR.rotation.z = fl; fL.rotation.z = -fl;
        if (!popped && pop > 0) { popped = true; S.burst(_a.copy(spr.position), 14, 0.6); S.sound('splash_small'); }
        spr.updateMatrixWorld(true);
        if (a < 0.88) {
          orb.visible = a > 0.58;
          _b.set(0, 0.95, 0); inner.localToWorld(_b); orb.position.copy(_b);
          orb.scale.setScalar(Math.max(0.01, eOut(seg(a, 0.58, 0.85))) * 1.1);
          P0.copy(_b);
        } else if (!landed) {
          if (!launched) { launched = true; S.sound('whoosh'); ctl.lerpVectors(P0, hit, 0.5); ctl.y = Math.max(P0.y, hit.y) + 1.1; }
          var kk = seg(a, 0.88, 1.24);
          qbez(P0, ctl, hit, eInOut(kk) * 0.3 + kk * 0.7, orb.position);
          if (dt > 0) trail(dt, function () { S.trail(orb.position.x, orb.position.y, orb.position.z); });
          if (kk >= 1) { landed = true; orb.visible = false; S.boom(imp, hit, 1.0, { power: 0.5, sound: 'splash' }); S.land(0); sp.foam(); }
        }
        r1.rotation.set(wt() * 7, 0, wt() * 3); r2.rotation.set(0, wt() * 5, wt() * 9); r1.scale.setScalar(0.34); r2.scale.setScalar(0.28);
        sp.tick(a, 1.24, 1.62, dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  UNDERTOW (2 pips, drain): a whirlpool opens under the target, water
  //  tentacles coil around it and squeeze; its strength flows back.
  // ---------------------------------------------------------------
  function Tentacles(S, count, n, r0) {
    var k = K(), pal = S.pal;
    var A = S.inst(k.UG.sph(), k.bodyMat(pal.a, 0.88), count * n), B = S.inst(k.UG.sphLo(), WF.models.glow(pal.b, 0.75), count * n);
    var p = new T.Vector3(), p2 = new T.Vector3();
    return {
      // paths: array of pathFn(u, out); heads: progress per tentacle
      set: function (paths, head, vis) {
        A.begin(); B.begin();
        if (vis) paths.forEach(function (pathFn) {
          for (var i = 0; i < n; i++) {
            var u = Math.min(1, head) * (1 - i / n); if (u <= 0) continue;
            pathFn(u, p); var r = r0 * (0.45 + 0.55 * i / n) * (i === 0 ? 0.8 : 1);
            A.pushTRS(p, null, r); p2.copy(p); p2.y += r * 0.3; B.pushTRS(p2, null, r * 0.6);
          }
        });
        A.end(); B.end();
      }
    };
  }
  def('undertow', {
    dur: 2.5, impact: 1.62, summonSound: [0.32, 'water_swirl'],
    cam: function (F) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }], [0.45, 'target', { pull: 0.6, dp: [0, 0.8, 0] }], [1.1, function (F2, P, L, u) { var h = F2.th; P.copy(tp(F2, 0, -2.2 - h * 0.5, 0.6, 1.8 + h * 0.4)); L.copy(F2.feet(0)).setY(h * 0.6); }, { orbit: 0.5 }],
        [1.68, 'side', { push: 0.1 }], [2.05, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var Tc = F.feet(0), R = 0.9 + F.hs(0) * 0.6;
      var pool = Q.Portal(S, Tc, R * 1.4, 0.35, 2.0, { rate: 60, spin: 6 });
      var tents = Tentacles(S, 3, 12, 0.24 * F.hs(0));
      var hgt = F.th * 1.0 + 0.4;
      function helix(j) {
        return function (u, out) {
          var ang = j * TAU / 3 + u * PI * 3.2, rr = R * (1.2 - 0.55 * u) + 0.1;
          return out.set(Tc.x + Math.cos(ang) * rr, u * hgt, Tc.z + Math.sin(ang) * rr);
        };
      }
      var paths = [helix(0), helix(1), helix(2)];
      var imp = S.impactFx({ rays: 8, rayColor: '#d8f8ff' }), landed = false;
      var drain = Drain(S, F, 1.75, 2.35, { n: 6 });
      return function (a, dt) {
        pool.tick(a, dt);
        var grow = eOut(seg(a, 0.6, 1.45)), squeeze = bell(a, 1.45, 1.75), retreat = seg(a, 1.75, 2.1);
        tents.set(paths, grow * (1 - retreat), a > 0.6 && retreat < 1);
        if (dt > 0 && a > 0.6 && a < 1.7 && S.r() < 0.8) { var th = S.r() * TAU; S.trail(Tc.x + Math.cos(th) * R, 0.2 + S.r() * hgt * grow, Tc.z + Math.sin(th) * R); }
        if (!landed && a >= 1.62) { landed = true; S.boom(imp, F.front(0), 1.2, { power: 0.6, sound: 'splash' }); S.land(0); }
        drain(a, dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  WAVE SERPENT (3 pips): a sea serpent bursts from a pool beside the
  //  caster, rears up with a roar and dives through the target.
  // ---------------------------------------------------------------
  function Serpent(S, nSeg, headScale, segR) {
    var k = K(), pal = S.pal;
    var rimS = k.SG('rim_sph', function () { return k.inflate(k.UG.sph(), 0.18); });
    var IS = S.inst(k.UG.sph(), k.bodyMat('#2f9fd8', 0.95), nSeg), II = S.inst(k.UG.sphLo(), WF.models.glow('#1a5fb0', 0.9), nSeg);
    var IR = S.inst(rimS, k.rimMat(pal.b, 0.3), nSeg), IF = S.inst(k.UG.cone(), k.bodyMat(pal.b, 0.92), nSeg);
    var mIn = new T.Matrix4().compose(new T.Vector3(0, -0.32, 0), new T.Quaternion(), new T.Vector3(0.7, 0.55, 0.85));
    var mFin = new T.Matrix4().compose(new T.Vector3(0, 0.55, 0), new T.Quaternion(), new T.Vector3(0.2, 0.95, 0.65));
    var head = S.group(), hm = S.mesh(WF.models._fx.levHeadGeos().g, k.vcGlowMat(), head); hm.scale.setScalar(headScale);
    S.mesh(k.SG('rim_lev', function () { return k.inflate(WF.models._fx.levHeadGeos().g, 0.07); }), k.rimMat(pal.b, 0.7), hm);
    S.halo(pal.a, headScale * 3, 0.4, head);
    head.visible = false;
    var cur = new T.Vector3(), nx = new T.Vector3(), sp = new T.Vector3(), tmp = new T.Object3D(), mSeg = new T.Matrix4(), mOut = new T.Matrix4();
    return {
      head: head, hm: hm,
      // pathFn(u, out); uHead = progress of the head along the path; spacing between segments
      set: function (pathFn, uHead, spacing, vis, scale) {
        head.visible = vis && uHead >= 0 && uHead <= 1;
        if (head.visible) {
          pathFn(clamp(uHead, 0, 1), cur); pathFn(clamp(uHead + 0.01, 0, 1.01), nx).sub(cur);
          head.position.copy(cur); if (nx.lengthSq() > 1e-9) faceDir(head, nx);
          head.scale.setScalar(scale == null ? 1 : scale);
        }
        IS.begin(); II.begin(); IR.begin(); IF.begin();
        for (var i = 0; i < nSeg && vis; i++) {
          var su = uHead - (i + 1) * spacing;
          if (su <= 0 || su >= 1) continue;
          pathFn(su, sp);
          var r = Math.max(0.02, segR * (1 - i / nSeg * 0.7) * (scale == null ? 1 : scale));
          pathFn(Math.min(1, su + 0.01), nx).sub(sp);
          tmp.position.copy(sp); tmp.quaternion.identity(); if (nx.lengthSq() > 1e-9) faceDir(tmp, nx);
          mSeg.compose(sp, tmp.quaternion, _is.set(r, r, r));
          IS.push(mSeg); II.push(mOut.multiplyMatrices(mSeg, mIn));
          if (i < nSeg * 0.6) IR.push(mSeg);
          if (i % 2 === 0) IF.push(mOut.multiplyMatrices(mSeg, mFin));
        }
        IS.end(); II.end(); IR.end(); IF.end();
      }
    };
  }
  var _is = new T.Vector3();
  CI._kit.Serpent = Serpent;
  def('wave_serpent', {
    dur: 2.8, impact: 1.95, summonSound: [0.38, 'splash'],
    cam: function (F, c) {
      var hd = function () { return c.refs.head; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.5, CI.follow(hd, function (F2, u, P) { P.copy(cp(F2, 5.6, 1.6, 2.8)); }, { dy: -0.6, fallback: function (F2, L) { L.copy(c.refs.pool).setY(1.0); } })],
        [1.42, CI.follow(hd, function (F2, u, P) { P.copy(F2.M).addScaledVector(F2.s, F2.D * 0.75 + 3.5).setY(2.4); }, { dy: -0.3 })],
        [1.85, 'target', { pull: 0.7 }], [2.32, 'home', { blend: 0.45 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var pool = cp(F, 1.4, 0, -1.6); c.refs.pool = pool;
      var portal = Q.Portal(S, pool, 1.0, 0.32, 2.3, { spout: 1.6, rate: 60, spin: 5 });
      var sp = Serpent(S, 14, 0.62, 0.42); c.refs.head = sp.head;
      var hit = F.front(0);
      // path: rise from the pool into a high loop, then dive through the target and out
      var p0 = pool.clone().setY(-0.8), p1 = pool.clone().setY(4.2), p2 = tp(F, 0, -2.5, 4.4 + F.th * 0.3, -0.8), p3 = hit.clone(), p4 = tp(F, 0, 1.8, -1.0, 0.3);
      function path(u, out) {
        if (u < 0.55) return bez(p0, p1, _e.copy(p1).addScaledVector(F.f, 1.6).setY(5.0), _d.lerpVectors(p1, p2, 0.6).setY(4.6), u / 0.55, out);
        var v = (u - 0.55) / 0.45;
        return bez(_d.lerpVectors(p1, p2, 0.6).setY(4.6), p2, _e.copy(p3).setY(p3.y + 0.5), p4, v, out);
      }
      var imp = S.impactFx({ rays: 10, rayColor: '#d8f8ff' }), landed = false, roared = false;
      var spout = Spout(S, F.feet(0), 0.55 * F.hs(0), 1.6 + F.th * 0.5);
      return function (a, dt) {
        portal.tick(a, dt);
        var uH;
        if (a < 1.1) uH = 0.45 * eOut(seg(a, 0.42, 1.1));
        else if (a < 1.45) uH = 0.45 + 0.05 * seg(a, 1.1, 1.45);
        else uH = 0.5 + 0.38 * eIn(seg(a, 1.45, 1.95)) + 0.35 * seg(a, 1.95, 2.4);
        sp.set(path, uH, 0.045, a > 0.42 && a < 2.45, Math.max(0.05, eBack(seg(a, 0.42, 0.7))));
        if (a > 1.1 && a < 1.45) { sp.hm.rotation.x = -0.35 * bell(a, 1.1, 1.45); }
        if (!roared && a > 1.12) { roared = true; S.sound('roar_serpent'); }
        if (dt > 0 && sp.head.visible) { S.trail(sp.head.position.x, sp.head.position.y, sp.head.position.z); }
        if (!landed && a >= 1.95) { landed = true; S.boom(imp, hit, 1.6, { power: 0.9, sound: 'splash' }); S.land(0); spout.foam(3.2 * F.hs(0)); }
        spout.tick(a, 1.95, 2.45, dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  MAELSTROM (4 pips, all enemies): a vast whirlpool opens beneath the
  //  enemies, a water funnel spins up and geysers burst under each one.
  // ---------------------------------------------------------------
  def('maelstrom', {
    len: function () { return { dur: 3.25, impact: 1.9, impactEnd: 2.4 }; },
    summonSound: [0.35, 'water_swirl'],
    cam: function (F) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }], [0.45, 'targets', { pull: 3.2, dp: [0, 3.2, 0] }],
        [1.2, 'flank', { push: 0.1 }], [1.95, 'targets', { pull: 2.0, dp: [0, 1.0, 0] }], [2.72, 'home', { blend: 0.5 }]];
    },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var R = 2.6 + spreadOf(F) * 1.05, cen = F.Tc.clone();
      var pool = Q.Portal(S, cen, R, 0.35, 3.0, { rate: 90, spin: 2.6 });
      var funnel = S.mesh(k.UG.cylT(), S.fade(k.bodyMat(pal.a, 0.55))), fun2 = S.mesh(k.UG.cylT(), S.fade(k.bodyMat(pal.core, 0.45)));
      funnel.visible = fun2.visible = false;
      var spouts = F.targets.map(function (t, i) { return { sp: Spout(S, t.pos, 0.55 * F.hs(i), 2.2 + t.h * 0.7), t: 1.9 + i * 0.2, i: i, imp: S.impactFx({ rays: 7, rayColor: '#d8f8ff' }), done: false }; });
      var walls = [];
      for (var w = 0; w < 10; w++) { var wm = S.mesh(k.UG.cone(), S.fade(k.bodyMat(w % 2 ? pal.b : pal.a, 0.75))); wm.visible = false; walls.push(wm); }
      return function (a, dt) {
        pool.tick(a, dt);
        var kf = eOut(seg(a, 0.8, 1.5)) * (1 - seg(a, 2.5, 3.0));
        funnel.visible = fun2.visible = kf > 0.01;
        funnel.position.set(cen.x, 0, cen.z); fun2.position.set(cen.x, 0, cen.z);
        funnel.scale.set(R * 0.42 * kf, Math.max(0.01, (3.4 + F.thMax * 0.4) * kf), R * 0.42 * kf); funnel.rotation.y = wt() * 5;
        fun2.scale.set(R * 0.2 * kf, Math.max(0.01, (3.8 + F.thMax * 0.4) * kf), R * 0.2 * kf); fun2.rotation.y = -wt() * 7;
        walls.forEach(function (wm, i) {
          var ang = i * TAU / walls.length + wt() * 2.2, kk = eOut(seg(a, 0.6, 1.0)) * (1 - seg(a, 2.6, 3.0));
          wm.visible = kk > 0.01;
          wm.position.set(cen.x + Math.cos(ang) * R * 0.92, 0, cen.z + Math.sin(ang) * R * 0.92);
          wm.rotation.set(0, -ang, 0.35);
          wm.scale.set(0.5, Math.max(0.01, (1.1 + 0.4 * Math.sin(wt() * 6 + i)) * kk), 0.18);
        });
        if (dt > 0 && kf > 0.1) for (var q = 0; q < 2; q++) { var th = S.r() * TAU, h = S.r() * 3.4 * kf; S.trail(cen.x + Math.cos(th) * R * 0.25 * (1 - h / 4), h, cen.z + Math.sin(th) * R * 0.25 * (1 - h / 4)); }
        spouts.forEach(function (o) {
          o.sp.tick(a, o.t - 0.12, o.t + 0.55, dt);
          if (!o.done && a >= o.t) { o.done = true; S.boom(o.imp, F.front(o.i), 1.3, { power: 0.7, sound: 'splash', boomSound: o.i === 0 }); S.land(o.i); o.sp.foam(); }
          o.imp.tick(dt);
        });
      };
    }
  });

  // ---------------------------------------------------------------
  //  MOON TIDE (3 pips, drain): a crescent moon rises behind the target,
  //  its pull lifts a silver tidal wave that crashes down; moonlight
  //  flows back to the caster.
  // ---------------------------------------------------------------
  function moonGeo(B) {
    var sh = new T.Shape();
    sh.absarc(0, 0, 1, 1.072, TAU - 1.072, false);
    sh.absarc(0.42, 0, 0.88, -1.504, 1.504, true);
    B.glow(new T.ShapeGeometry(sh, 24), '#fff2c0');
    var g = G();
    [[-0.62, 0.3, 0.12], [-0.5, -0.42, 0.1], [-0.78, -0.1, 0.07]].forEach(function (c2) { B.glow(g.disc(c2[2], 10), '#c8daf0', { p: [c2[0], c2[1], 0.01] }); });
  }
  def('moon_tide', {
    dur: 3.0, impact: 2.02, summonSound: [0.3, 'chime_moon'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, function (F2, P, L, u) { P.copy(tp(F2, 0, -5.5, 1.0, 2.6)); L.copy(c.refs.moon).lerp(F2.feet(0).setY(F2.th), 0.25 + 0.2 * u); }],
        [1.2, 'flank', { push: 0.12, lookRise: 0.5 }], [1.95, 'target', { pull: 0.8 }], [2.25, 'side', { push: 0.1 }], [2.55, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var moonAt = F.feet(0).addScaledVector(F.f, 4.5).addScaledVector(F.s, -1.2).setY(5.8 + F.th * 0.3); c.refs.moon = moonAt;
      var moon = S.group(); glowPart(S, 'moon', moonGeo, moon, [0.06, '#7fc8ff', 0.9], { dbl: true });
      var mh = S.halo('#cfe4ff', 5, 0.28, moon), mh2 = S.halo(pal.a, 9, 0.12, moon);
      moon.position.copy(moonAt); faceDir(moon, _a.copy(F.f).negate());
      var beamM = S.own(k.gradMat('#dff0ff', false)), beam = S.mesh(k.UG.cyl(), beamM); beam.visible = false;
      var curl = S.mesh(WF.models._fx.curlGeo(), S.own(new T.MeshBasicMaterial({ color: mix(pal.a, pal.deep, 0.3), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide })));
      var curl2 = S.mesh(WF.models._fx.curlGeo(), S.own(new T.MeshBasicMaterial({ color: '#cfe8ff', vertexColors: true, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })));
      curl.visible = curl2.visible = false;
      var Tc = F.feet(0), hit = F.front(0), back = Tc.clone().addScaledVector(F.f, 2.8), W = 3.2 + F.hs(0), H0 = 2.2 + F.th * 0.5;
      var imp = S.impactFx({ rays: 10, rayColor: '#eef6ff' }), landed = false;
      var drain = Drain(S, F, 2.1, 2.7, { n: 6, color: '#dff0ff' });
      return function (a, dt) {
        var kin = eOut(seg(a, 0.3, 1.0)), kout = seg(a, 2.4, 2.95);
        moon.visible = a > 0.3 && kout < 1;
        moon.position.copy(moonAt); moon.position.y = moonAt.y - 2.5 * (1 - kin);
        moon.scale.setScalar(Math.max(0.01, 1.9 * kin * (1 - kout)));
        moon.rotation.z = 0.3 + wt() * 0.1;
        var hs = 5 * (1 + 0.1 * Math.sin(wt() * 5)); mh.scale.set(hs, hs, 1);
        beam.visible = a > 0.7 && a < 2.2;
        if (beam.visible) {
          var kb = eOut(seg(a, 0.7, 1.0)) * (1 - seg(a, 1.9, 2.2));
          Q.fx().placeBeam(beam, Tc, moonAt, 0.7 * kb + 0.01); beamM.opacity = 0.35 * kb;
        }
        // tide: rises behind the target, rolls forward, crashes onto it
        var rise = eOut(seg(a, 0.95, 1.6)), roll = eIn(seg(a, 1.6, 2.02)), fall = seg(a, 2.0, 2.18);
        curl.visible = curl2.visible = a > 0.95 && fall < 1;
        if (curl.visible) {
          _b.lerpVectors(back, Tc.clone().addScaledVector(F.f, -0.8), roll);
          curl.position.copy(_b); curl2.position.copy(_b);
          faceDir(curl, _c.copy(F.f).negate()); curl2.quaternion.copy(curl.quaternion);
          var hy = H0 * rise * (1 - 0.7 * fall) * (1 + 0.25 * roll);
          curl.scale.set(W, Math.max(0.01, hy), H0 * 0.9); curl2.scale.set(W * 1.02, Math.max(0.01, hy * 1.04), H0 * 0.95);
          curl.material.opacity = 0.95 * (1 - fall); curl2.material.opacity = 0.4 * (1 - fall);
          if (dt > 0) for (var q = 0; q < 2; q++) { _c.copy(_b).addScaledVector(F.s, (S.r() - 0.5) * W).setY(hy * (0.6 + S.r() * 0.4)); S.trail(_c.x, _c.y, _c.z); }
        }
        if (!landed && a >= 2.02) { landed = true; S.boom(imp, hit, 1.6, { power: 0.9, sound: 'splash', flashColor: '#e8f6ff' }); S.land(0); }
        drain(a, dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  LEVIATHAN (5 pips, drain): a colossal sea serpent towers out of a
  //  whirlpool behind the enemies, roars, and crashes down on them.
  // ---------------------------------------------------------------
  def('leviathan', {
    dur: 4.3, impact: 3.05, bigCast: true, summonSound: [0.35, 'water_swirl'],
    cam: function (F, c) {
      var hd = function () { return c.refs.head; };
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, 'wide', { push: 0.12 }],
        [1.0, CI.follow(hd, function (F2, u, P) { P.copy(F2.Tc).addScaledVector(F2.f, -1.5).addScaledVector(F2.s, 9.5 + spreadOf(F2)).setY(1.4); }, { dy: -1.0, fallback: function (F2, L) { L.copy(c.refs.pool).setY(2); } })],
        [1.9, function (F2, P, L, u) { P.copy(cp(F2, -3.4, 1.2, 2.4)); L.copy(c.refs.pool).setY(5.5); }, { push: 0.1 }],
        [2.5, CI.follow(hd, function (F2, u, P) { P.copy(F2.Tc).addScaledVector(F2.f, -5.5).addScaledVector(F2.s, 4.5).setY(1.0); }, { look2: function (F2, o) { o.copy(F2.Tc).setY(F2.thMax * 0.5); }, l0: 0.4, l1: 0.95 })],
        [3.05, 'targets', { pull: 2.6, dp: [0, 1.0, 0] }], [3.65, 'home', { blend: 0.6 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var LS = clamp(1.0 + F.thMax * 0.08, 1.05, 1.45);
      var pool = F.Tc.clone().addScaledVector(F.f, 4.2 + spreadOf(F) * 0.3).addScaledVector(F.s, -1.2); c.refs.pool = pool;
      var portal = Q.Portal(S, pool, 2.4 * LS, 0.35, 3.6, { spout: 3.0, rate: 80, spin: 4 });
      var sp = Serpent(S, 16, 1.25 * LS, 0.9 * LS); c.refs.head = sp.head;
      var hit = F.targets.length > 1 ? F.Tc.clone().setY(0.7) : F.front(0);
      var p0 = pool.clone().setY(-2), p1 = pool.clone().setY(9 * LS), p2 = F.Tc.clone().addScaledVector(F.f, 1.0).setY(9.5 * LS), p3 = hit.clone();
      function path(u, out) { return bez(p0, p1, p2, p3, u, out); }
      var imp = S.impactFx({ rays: 14, rayColor: '#d8f8ff' }), landed = false, roared = false;
      var spouts = F.targets.map(function (t, i) { return Spout(S, t.pos, 0.6 * F.hs(i), 2.4 + t.h * 0.6); });
      var drain = Drain(S, F, 3.3, 3.95, { n: 7 });
      return function (a, dt) {
        portal.tick(a, dt);
        var uH;
        if (a < 1.9) uH = 0.55 * eOut(seg(a, 0.9, 1.9));
        else if (a < 2.5) uH = 0.55 + 0.04 * seg(a, 1.9, 2.5);
        else uH = 0.59 + 0.41 * eIn(seg(a, 2.5, 3.05)) + 0.4 * seg(a, 3.05, 3.6);
        sp.set(path, uH, 0.042, a > 0.9 && a < 3.7, LS * Math.max(0.05, eBack(seg(a, 0.9, 1.3))));
        if (a > 1.9 && a < 2.5) sp.hm.rotation.x = -0.4 * bell(a, 1.9, 2.5);
        if (!roared && a > 1.95) { roared = true; S.sound('roar_serpent'); S.shake(0.35, 0.7); }
        if (dt > 0 && sp.head.visible) for (var q = 0; q < 2; q++) S.trail(sp.head.position.x + (S.r() - 0.5) * LS, sp.head.position.y + (S.r() - 0.5) * LS, sp.head.position.z + (S.r() - 0.5) * LS);
        if (!landed && a >= 3.05) { landed = true; S.boom(imp, hit, 2.5, { power: 1.5, sound: 'splash' }); S.landAll(); spouts.forEach(function (o) { o.foam(4); }); }
        spouts.forEach(function (o) { o.tick(a, 3.05, 3.6, dt); });
        drain(a, dt);
        imp.tick(dt);
      };
    }
  });
})();

// =====================================================================
//  LUMEN — the Order's universal light
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var qbez = Q.qbez, faceDir = Q.faceDir, glowPart = KT.glowPart, cp = KT.cp, tp = KT.tp, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3();
  function G() { return K().G; }

  // a little dawn spirit: a radiant sun with a serene face
  function sunFaceGeo(B) {
    var g = G();
    B.glow(g.sph(0.62, 18, 14), '#ffe27a');
    B.glow(g.sph(0.5, 16, 12), '#fff3b0', { p: [0, 0.02, 0.16] });
    [-1, 1].forEach(function (s) {
      B.glow(g.tor(0.09, 0.022, 4, 10, PI), '#b8700a', { p: [s * 0.2, 0.12, 0.6], r: [0, 0, 0] });        // closed, happy eyes
      B.glow(g.sph(0.07, 8, 6), '#ffb08a', { p: [s * 0.32, -0.06, 0.52] });
    });
    B.glow(g.tor(0.12, 0.022, 4, 12, PI), '#b8700a', { p: [0, -0.12, 0.6], r: [0, 0, PI] });
  }
  def('sunburst', {
    len: function () { return { dur: 2.65, impact: 1.62, impactEnd: 1.86 }; },
    summonSound: [0.42, 'chime_sun'], cardOut: 0.42,
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.18 }],
        [0.45, function (F2, P, L, u) { P.copy(cp(F2, 4.6, 1.2, 3.0)); L.copy(c.refs.sun).lerp(F2.C.clone().setY(1.6), 0.25); }, { push: 0.12 }],
        [1.25, 'side', { pull: 1.5, dp: [0, 0.8, 0] }], [2.08, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var sunAt = cp(F, 0.8, F.ch + 2.2, 0.2); c.refs.sun = sunAt;
      var sun = S.group();
      glowPart(S, 'sunFace', sunFaceGeo, sun, [0.05, '#ffd04a', 0.85]);
      var sp1 = S.mesh(WF.models._fx.sunSpikeGeos().g, k.vcGlowMat(), sun); sp1.scale.setScalar(0.62);
      var sp2 = S.mesh(WF.models._fx.sunSpikeGeos().g, k.vcGlowMat(), sun); sp2.scale.setScalar(0.45); sp2.rotation.set(0.6, 0.4, 0.2);
      var h1 = S.halo(pal.a, 4, 0.55, sun), h2 = S.halo('#fff3b0', 2.2, 0.8, sun);
      sun.visible = false;
      var beams = F.targets.map(function (t, i) {
        var bm = S.mesh(k.UG.cyl(), S.fade(k.bodyMat(pal.a, 0.9))), bi = S.mesh(k.UG.cyl(), S.fade(WF.models.glow('#fffdf0', 0.95)));
        bm.visible = bi.visible = false;
        return { bm: bm, bi: bi, t: 1.42 + i * 0.12, i: i, imp: S.impactFx({ rays: 8, rayColor: '#fff3b0' }), done: false };
      });
      var em = rate(70);
      return function (a, dt) {
        sun.visible = a > 0.42 && a < 2.45;
        var rise = eBack(seg(a, 0.42, 0.85)), flare = bell(a, 1.2, 1.5), fade = seg(a, 2.0, 2.45);
        sun.position.copy(sunAt).setY(sunAt.y - 1.2 * (1 - eOut(seg(a, 0.42, 0.95))) + Math.sin(wt() * 3) * 0.08);
        sun.scale.setScalar(Math.max(0.01, rise * (1 + 0.35 * flare) * (1 - fade)));
        faceDir(sun, _a.copy(F.C).sub(sun.position).setY(0).lerp(F.f, 0.2));
        sp1.rotation.z = wt() * 1.2; sp2.rotation.z = -wt() * 1.8;
        var hs = 4 * (1 + 0.6 * flare); h1.scale.set(hs, hs, 1);
        if (dt > 0 && sun.visible && a < 2.0) em(dt, function () { var th = S.r() * TAU, el = (S.r() - 0.5) * PI; _a.set(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el)).multiplyScalar(0.9); S.pc.emit(sun.position.x + _a.x, sun.position.y + _a.y, sun.position.z + _a.z, _a.x * 2, _a.y * 2, _a.z * 2, 0.6, 0.3, 0.03, pal.A, pal.D, 1, 0, 1.5); });
        beams.forEach(function (b) {
          var kb = seg(a, b.t - 0.12, b.t), ko = seg(a, b.t + 0.15, b.t + 0.45);
          b.bm.visible = b.bi.visible = kb > 0 && ko < 1;
          if (b.bm.visible) {
            var to = F.front(b.i);
            _b.lerpVectors(sun.position, to, eOut(kb));
            Q.fx().placeBeam(b.bm, sun.position, _b, 0.26 * (1 - ko) + 0.01); Q.fx().placeBeam(b.bi, sun.position, _b, 0.1 * (1 - ko) + 0.005);
            b.bm.material.opacity = 0.9 * (1 - ko); b.bi.material.opacity = 0.95 * (1 - ko);
          }
          if (!b.done && a >= b.t) { b.done = true; S.boom(b.imp, F.front(b.i), 1.2, { power: 0.6, boomSound: b.i === 0, sound: 'impact_lumen' }); S.land(b.i); }
          b.imp.tick(dt);
        });
      };
    }
  });
})();

// =====================================================================
//  HOLLOW — the enemy's shadow magic (incl. boss signature spells)
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eIn3 = Q.eIn3, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var V = Q.V, bez = Q.bez, qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, fanGeo = KT.fanGeo, cp = KT.cp, tp = KT.tp, C3 = KT.C3, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3(), _e = new T.Vector3();
  function G() { return K().G; }
  function mix(a, b, t) { return K().mix(a, b, t); }
  var DK = '#1e0f33', DK2 = '#2a1640', DK3 = '#3d2266', VIO = '#a879ff', VIO2 = '#d0b0ff', EYE = '#9dff5a';

  // dark smoke puff burst at a point (normal-blended)
  function smokeAt(S, p, n, spd, size) {
    var pal = S.pal, pn = S.pn || S.pc;
    for (var i = 0; i < n; i++) {
      var th = S.r() * TAU, el = (S.r() - 0.3) * 1.4, sp = (spd || 1) * (0.5 + S.r());
      pn.emit(p.x, p.y, p.z, Math.cos(th) * Math.cos(el) * sp, Math.sin(el) * sp + 0.3, Math.sin(th) * Math.cos(el) * sp, 0.8 + S.r() * 0.5, (size || 0.5), (size || 0.5) * 2.6, rgb(pal.smoke2), rgb(pal.smoke), 0.85, 0.2, 2.5);
    }
  }
  CI._kit.smokeAt = smokeAt;
  function eyesGlow(S, parent, pts, size) { return pts.map(function (p) { var h = S.halo(EYE, size || 0.5, 0.9, parent); h.position.set(p[0], p[1], p[2]); return h; }); }

  // ---------------------------------------------------------------
  //  SHADOW JAWS (Shadow Nip, 1 pip): smoke gathers before the target
  //  into a pair of spectral jaws that open wide and snap shut.
  // ---------------------------------------------------------------
  // one half of a shadow maw: a curved gum ridge (half ring in the XY plane, hinge along X at y=0) with fangs pointing inward (-Y..center)
  function mawGeo(B) {
    var g = G();
    B.glow(g.tor(1.0, 0.16, 6, 20, PI), DK2, { r: [0, 0, 0], s: [1, 1, 1.4] });
    B.glow(g.tor(1.0, 0.08, 4, 20, PI), '#6a2a8a', { p: [0, 0, 0.12], s: [1, 1, 1] });
    for (var i = 0; i < 9; i++) {
      var a = 0.18 + i * (PI - 0.36) / 8, L = 0.3 + (i === 2 || i === 6 ? 0.18 : 0) + (i === 4 ? 0.08 : 0);
      B.glow(g.cone(0.07, L, 5), '#f0e6ff', { p: [Math.cos(a) * (1 - L * 0.45), Math.sin(a) * (1 - L * 0.45), 0.05], r: [0, 0, a + PI / 2] });
    }
  }
  def('shadow_jaws', {
    dur: 1.8, impact: 1.12, summonSound: [0.3, 'shadow_whoosh'],
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.5, function (F2, P, L) { var h = F2.th; P.copy(F2.feet(0)).addScaledVector(F2.f, -2.2 - h * 0.5).addScaledVector(F2.s, 3.2 + h * 0.4).setY(1.5 + h * 0.2); L.copy(F2.feet(0)).setY(h * 0.5); }, { push: 0.12 }], [1.38, 'home', { blend: 0.4 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var Tc = F.feet(0), hs = F.hs(0), JS = 0.75 + hs * 0.55;
      var root = S.group(); root.position.copy(Tc); faceFlat(root, F.f);
      // two halves hinged on the ground either side of the target (local +-X), opening outward
      var hA = S.group(root), hB = S.group(root);
      var mA = glowPart(S, 'maw', mawGeo, hA, [0.05, VIO, 0.95]), mB = glowPart(S, 'maw', mawGeo, hB, [0.05, VIO, 0.95]);
      mA.rotation.y = PI / 2; mB.rotation.y = -PI / 2;
      hA.position.x = 0.0; hB.position.x = 0.0;
      var eyes = eyesGlow(S, root, [[0.35, 0.05, 1.1], [-0.35, 0.05, 1.1]], 0.7);
      var pool = Q.Portal(S, Tc, 1.3 * JS, 0.28, 1.6, { rate: 60, spin: 3 });
      root.scale.setScalar(JS); root.visible = false;
      var imp = S.impactFx({ rays: 8 }), landed = false;
      return function (a, dt) {
        pool.tick(a, dt);
        var rise = eOut(seg(a, 0.38, 0.62)), gone = seg(a, 1.3, 1.6);
        root.visible = a > 0.38 && gone < 1;
        root.position.y = lerp(-1.2 * JS, 0, rise) - gone * 1.2 * JS;
        var open = smooth(0.55, 0.85, a) * (1 - smooth(0.95, 1.12, a));
        // closed = both halves vertical (meeting over the target); open = splayed outward
        hA.rotation.z = -1.1 * open - 0.05; hB.rotation.z = 1.1 * open + 0.05;
        hA.position.x = 0.95 * (1 - 0.15 * open); hB.position.x = -0.95 * (1 - 0.15 * open);
        mA.position.x = -0.95; mB.position.x = 0.95;
        eyes.forEach(function (e) { var es = 0.7 * (1 + 0.6 * open); e.scale.set(es, es, 1); });
        if (!landed && a >= 1.12) { landed = true; S.boom(imp, F.front(0), 1.0, { power: 0.55, sound: 'chomp' }); S.land(0); smokeAt(S, F.hit(0), 10, 1.0, 0.45); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  GLOOM WISP (Gloom Bolt, 2 pips): a shrieking ghost-skull wisp forms
  //  in the caster's hands and weaves through the air into the target.
  // ---------------------------------------------------------------
  function wispGeo(B) {
    var g = G();
    B.glow(g.sph(1, 14, 10), DK2, { s: [0.38, 0.42, 0.4] });
    B.glow(g.sph(1, 12, 8), DK, { p: [0, 0.06, -0.08], s: [0.42, 0.44, 0.42] });
    B.glow(g.sph(1, 10, 8), '#0d0716', { p: [0, -0.02, 0.28], s: [0.26, 0.28, 0.12] });
    B.glow(g.sph(0.075, 8, 6), EYE, { p: [0.11, 0.06, 0.36] }); B.glow(g.sph(0.075, 8, 6), EYE, { p: [-0.11, 0.06, 0.36] });
    B.glow(g.sph(1, 8, 6), '#2a0f3a', { p: [0, -0.15, 0.36], s: [0.08, 0.1, 0.04] });
    B.glow(g.taper([[0, 0, -0.3], [0.1, -0.05, -0.8], [-0.12, 0.05, -1.3], [0.05, 0, -1.8]], 0.3, 0.02, 14, 7), DK3);
    B.glow(g.taper([[0.2, -0.1, -0.2], [0.35, -0.2, -0.7], [0.3, -0.1, -1.1]], 0.12, 0.01, 8, 5), DK2);
    B.glow(g.taper([[-0.2, -0.1, -0.2], [-0.35, -0.2, -0.7], [-0.3, -0.1, -1.1]], 0.12, 0.01, 8, 5), DK2);
  }
  def('gloom_wisp', {
    dur: 2.15, impact: 1.42, summonSound: [0.55, 'shriek'],
    cam: function (F, c) {
      var w = function () { return c.refs.wisp; };
      return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.62, CI.chase(w, 1.8, 0.6, 2.8, { dy: 0 }), { blend: 0.15 }], [1.22, 'target', { pull: 0.3 }], [1.68, 'home', { blend: 0.42 }]];
    },
    build: function (S, F, c) {
      var pal = S.pal; S.std();
      var wisp = S.group(), inner = S.group(wisp);
      glowPart(S, 'wisp', wispGeo, inner, [0.04, VIO, 0.95]);
      eyesGlow(S, inner, [[0.11, 0.06, 0.38], [-0.11, 0.06, 0.38]], 0.45);
      S.halo(VIO, 2.0, 0.35, inner);
      var WS = 1.2 + F.ch * 0.08; wisp.visible = false; c.refs.wisp = wisp;
      var start = F.from.clone().addScaledVector(F.f, 0.5), hit = F.front(0);
      var c1 = cp(F, F.D * 0.3, F.ch * 0.4 + 1.8, 2.2), c2 = tp(F, 0, -F.D * 0.3, F.th + 1.4, -2.0);
      var imp = S.impactFx({ rays: 9 }), landed = false, em = rate(110), cur = new T.Vector3(), nx = new T.Vector3();
      return function (a, dt) {
        wisp.visible = a > 0.45 && !landed;
        if (wisp.visible) {
          var form = eBack(seg(a, 0.45, 0.7)), k = eInOut(seg(a, 0.72, 1.42)) * 0.75 + seg(a, 0.72, 1.42) * 0.25;
          if (a < 0.72) cur.copy(start).setY(start.y + 0.3 * form);
          else { bez(start, c1, c2, hit, k, cur); cur.addScaledVector(F.s, Math.sin(wt() * 9) * 0.35 * (1 - k)); }
          bez(start, c1, c2, hit, Math.min(1, k + 0.03), nx).sub(cur);
          wisp.position.copy(cur); if (a > 0.72 && nx.lengthSq() > 1e-8) faceDir(wisp, nx); else faceFlat(wisp, F.f);
          inner.scale.set(WS * form, WS * form * (1 + 0.12 * Math.sin(wt() * 22)), WS * form);
          inner.rotation.z = Math.sin(wt() * 7) * 0.3;
          if (dt > 0) em(dt, function () { _a.set((S.r() - 0.5) * 0.5, (S.r() - 0.5) * 0.5, -0.8 - S.r()).multiplyScalar(WS).applyQuaternion(wisp.quaternion).add(cur); S.trail(_a.x, _a.y, _a.z); });
        }
        if (!landed && a >= 1.42) { landed = true; S.boom(imp, hit, 1.25, { power: 0.65 }); S.land(0); smokeAt(S, hit, 12, 1.4, 0.5); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  BOG SPIT (1 pip, burn): a bubbling green glob gathers, is spat in a
  //  high arc and splats; poison bubbles and fumes cling to the target.
  // ---------------------------------------------------------------
  def('bog_spit', {
    dur: 1.85, impact: 1.18, color: '#7fd23a', summonSound: [0.55, 'gulp'],
    cam: function (F) { return [[0, 'caster', { push: 0.12, blend: 0.2 }], [0.75, 'side', { push: 0.12 }], [1.12, 'target', { pull: 0.3 }], [1.45, 'home', { blend: 0.4 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var glob = S.group(), g1 = S.mesh(k.UG.sph(), k.bodyMat('#6fae2a', 0.95), glob), g2 = S.mesh(k.UG.sphLo(), WF.models.glow('#c8ff6a', 0.9), glob);
      g2.scale.setScalar(0.45); g2.position.set(0.25, 0.3, 0.3);
      var bubs = []; for (var i = 0; i < 4; i++) { var b = S.mesh(k.UG.sphLo(), k.bodyMat('#9add4a', 0.9), glob); b.userData.p = new T.Vector3((S.r() - 0.5) * 1.4, (S.r() - 0.5) * 1.4, (S.r() - 0.5) * 1.4); bubs.push(b); }
      S.mesh(k.SG('rim_sph', function () { return k.inflate(k.UG.sph(), 0.18); }), k.rimMat('#c8ff6a', 0.6), g1);
      glob.visible = false;
      var mouth = F.from.clone().addScaledVector(F.f, 0.4), hit = F.front(0), ctl = new T.Vector3().lerpVectors(mouth, hit, 0.5); ctl.y = Math.max(mouth.y, hit.y) + 2.2;
      var imp = S.impactFx({ rays: 7, rayColor: '#c8ff6a' }), landed = false, em = rate(70);
      var puddle = S.mesh(k.UG.disc(), S.fade(k.bodyMat('#4f8a1a', 0.85))); puddle.visible = false; puddle.renderOrder = 3;
      return function (a, dt) {
        glob.visible = a > 0.45 && !landed;
        var GS = 0.35 * eOut(seg(a, 0.45, 0.8));
        if (a < 0.82) glob.position.copy(mouth);
        else qbez(mouth, ctl, hit, eInOut(seg(a, 0.82, 1.18)) * 0.4 + seg(a, 0.82, 1.18) * 0.6, glob.position);
        glob.scale.set(GS * (1 + 0.15 * Math.sin(wt() * 20)), GS * (1 + 0.15 * Math.cos(wt() * 17)), GS);
        bubs.forEach(function (b, i) { b.position.copy(b.userData.p).multiplyScalar(0.7 + 0.2 * Math.sin(wt() * 9 + i)); b.scale.setScalar(0.25 + 0.1 * Math.sin(wt() * 13 + i * 2)); });
        if (dt > 0 && glob.visible && a > 0.82) em(dt, function () { S.pc.emit(glob.position.x, glob.position.y, glob.position.z, 0, -0.5, 0, 0.5, 0.2, 0.08, rgb('#9add4a'), rgb('#3f6a12'), 0.95, -6, 0.5); });
        if (!landed && a >= 1.18) { landed = true; S.boom(imp, hit, 0.9, { power: 0.45, sound: 'splat' }); S.land(0); puddle.visible = true; }
        if (landed) {
          var kp = seg(a, 1.18, 1.35), ko = seg(a, 1.5, 1.85);
          puddle.position.set(F.T.x, 0.07, F.T.z); puddle.scale.setScalar(Math.max(0.01, (0.9 + F.hs(0) * 0.5) * eOut(kp))); puddle.material.opacity = 0.85 * (1 - ko);
          if (dt > 0 && a < 1.8 && S.r() < 0.7) { var th = S.r() * TAU, rr = S.r() * F.hs(0) * 0.8; S.pc.emit(F.T.x + Math.cos(th) * rr, 0.15, F.T.z + Math.sin(th) * rr, 0, 0.8 + S.r(), 0, 0.6, 0.18, 0.3, rgb('#b8f060'), rgb('#4f8a1a'), 0.9, 0.5, 1); }
        }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  DREAD WAVE (3 pips): a black tide crested with wailing ghost faces
  //  rises behind the caster and rolls over the target.
  // ---------------------------------------------------------------
  function ghostFaceGeo(B) {
    var g = G();
    B.glow(g.sph(1, 12, 8), '#b8a4e8', { s: [0.22, 0.28, 0.08] });
    B.glow(g.sph(0.06, 8, 6), '#1e0f33', { p: [0.08, 0.06, 0.07], s: [1, 1.4, 0.6] });
    B.glow(g.sph(0.06, 8, 6), '#1e0f33', { p: [-0.08, 0.06, 0.07], s: [1, 1.4, 0.6] });
    B.glow(g.sph(0.07, 8, 6), '#1e0f33', { p: [0, -0.12, 0.07], s: [0.8, 1.4, 0.6] });
  }
  def('dread_wave', {
    dur: 2.65, impact: 1.82, summonSound: [0.4, 'wail'],
    cam: function (F, c) {
      var w = function () { return c.refs.wave; };
      return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.55, 'side', { push: 0.15 }], [1.3, CI.chase(w, 1.2, 1.6, 6.5, { dy: 0.8 })], [1.72, 'target', { pull: 0.9 }], [2.15, 'home', { blend: 0.45 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var wave = S.group(); c.refs.wave = wave;
      var curl = S.mesh(WF.models._fx.curlGeo(), S.own(new T.MeshBasicMaterial({ color: mix(pal.smoke, pal.smoke2, 0.6), vertexColors: true, transparent: true, opacity: 0.97, depthWrite: false, side: T.DoubleSide })), wave);
      var curl2 = S.mesh(WF.models._fx.curlGeo(), S.own(new T.MeshBasicMaterial({ color: pal.deep, vertexColors: true, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })), wave);
      var faces = [];
      for (var i = 0; i < 5; i++) { var f = glowPart(S, 'ghostFace', ghostFaceGeo, wave); f.userData.x = (i / 4 - 0.5) * 0.8; f.userData.ph = S.r() * 6; faces.push(f); }
      var start = cp(F, -0.6, 0, 0), stop = F.feet(0).addScaledVector(F.f, 0.6);
      var W = 3.0 + F.hs(0), H = 2.0 + F.th * 0.3;
      var imp = S.impactFx({ rays: 10 }), landed = false;
      return function (a, dt) {
        var rise = eOut(seg(a, 0.45, 1.05)), go = eIn(seg(a, 1.05, 1.82)) * 0.7 + seg(a, 1.05, 1.82) * 0.3, fall = seg(a, 1.82, 2.3);
        wave.visible = a > 0.45 && fall < 1;
        wave.position.lerpVectors(start, stop, go); faceFlat(wave, F.f);
        var hy = H * rise * (1 - 0.75 * fall);
        curl.scale.set(W, Math.max(0.01, hy), H * 0.9); curl2.scale.set(W * 1.02, Math.max(0.01, hy * 1.04), H * 0.95);
        curl.material.opacity = 0.96 * (1 - fall); curl2.material.opacity = 0.45 * (1 - fall);
        faces.forEach(function (f, i) {
          f.position.set(f.userData.x * W, hy * (0.85 + 0.08 * Math.sin(wt() * 5 + f.userData.ph)), H * 0.35);
          f.scale.setScalar(Math.max(0.01, (1.3 + 0.2 * Math.sin(wt() * 8 + i)) * rise * (1 - fall)));
          f.rotation.z = Math.sin(wt() * 4 + f.userData.ph) * 0.25;
        });
        if (dt > 0 && wave.visible) for (var q = 0; q < 2; q++) { _a.copy(wave.position).addScaledVector(F.s, (S.r() - 0.5) * W).setY(hy * (0.4 + S.r() * 0.6)); S.trail(_a.x, _a.y, _a.z); }
        if (!landed && a >= 1.82) { landed = true; S.boom(imp, F.front(0), 1.5, { power: 0.85 }); S.land(0); smokeAt(S, F.hit(0), 14, 1.6, 0.6); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  BONE HAND (Bone Crush, 4 pips): green-lit cracks split the ground,
  //  a giant skeletal hand bursts up beneath the target and crushes it.
  // ---------------------------------------------------------------
  var BONE = '#e8e0c8', BONE2 = '#cfc4a4';
  function palmGeo(B) {
    var g = G();
    B.add(g.box(1.1, 0.95, 0.32), BONE, { p: [0, 0.48, 0], flat: true });
    B.add(g.box(0.9, 0.3, 0.36), BONE2, { p: [0, 0.05, 0], flat: true });
    for (var i = 0; i < 4; i++) B.add(g.sph(0.1, 6, 5), BONE2, { p: [-0.4 + i * 0.27, 0.95, 0.02], flat: true });
    B.add(g.cyl(0.22, 0.28, 0.9, 7), BONE2, { p: [0, -0.4, 0], flat: true });
    B.glow(g.box(0.06, 0.5, 0.04), EYE, { p: [0.1, 0.5, 0.18], r: [0, 0, 0.3] });
    B.glow(g.box(0.06, 0.35, 0.04), EYE, { p: [-0.2, 0.45, 0.18], r: [0, 0, -0.4] });
  }
  function fingerGeo(B) { var g = G(); B.add(g.cyl(0.085, 0.1, 0.5, 6), BONE, { p: [0, 0.25, 0], flat: true }); B.add(g.sph(0.1, 6, 5), BONE2, { p: [0, 0.5, 0], flat: true }); }
  function tipGeo(B) { var g = G(); B.add(g.cyl(0.07, 0.085, 0.38, 6), BONE, { p: [0, 0.19, 0], flat: true }); B.add(g.cone(0.07, 0.2, 5), '#f6f0dc', { p: [0, 0.48, 0], flat: true }); }
  def('bone_hand', {
    dur: 3.0, impact: 2.15, summonSound: [0.4, 'rumble'],
    cam: function (F) {
      return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.55, 'target', { pull: 1.0, dp: [0, 0.6, 0] }],
        [1.25, function (F2, P, L, u) { var h = F2.th; P.copy(F2.feet(0)).addScaledVector(F2.f, -1.5).addScaledVector(F2.s, 6.0 + h * 0.5).setY(1.3); L.copy(F2.feet(0)).addScaledVector(F2.f, 0.6).setY(h * 0.6 + 1.2); }, { push: 0.12 }],
        [2.15, 'target', { pull: 1.6 }], [2.5, 'home', { blend: 0.45 }]];
    },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var Tc = F.feet(0), HS = clamp(1.3 + F.th * 0.3, 1.8, 2.6);
      var crack = KT.Crack ? null : null;
      var dark = S.fade(k.bodyMat('#0d0716', 0.85)), glowR = S.fade(k.bodyMat(EYE, 0.9));
      var d = S.mesh(k.UG.disc(), dark), r = S.mesh(k.UG.ring(), glowR); d.renderOrder = 3; r.renderOrder = 4;
      d.position.set(Tc.x, 0.06, Tc.z); r.position.set(Tc.x, 0.08, Tc.z);
      var hand = S.group(), wrist = S.group(hand);
      glowPart(S, 'bonePalm', palmGeo, wrist, [0.04, VIO, 0.5]);
      var fingers = [];
      for (var i = 0; i < 4; i++) {
        var f1 = S.group(wrist); f1.position.set(-0.4 + i * 0.27, 1.0, 0); glowPart(S, 'boneFinger', fingerGeo, f1);
        var f2 = S.group(f1); f2.position.y = 0.52; glowPart(S, 'boneTip', tipGeo, f2);
        f1.scale.setScalar(i === 1 || i === 2 ? 1.1 : 0.95); fingers.push([f1, f2]);
      }
      var th1 = S.group(wrist); th1.position.set(0.6, 0.35, 0.05); th1.rotation.z = -0.9; glowPart(S, 'boneFinger', fingerGeo, th1);
      var th2 = S.group(th1); th2.position.y = 0.52; glowPart(S, 'boneTip', tipGeo, th2);
      hand.scale.setScalar(HS);
      hand.position.copy(Tc).addScaledVector(F.f, 0.55 * HS); faceFlat(hand, _a.copy(F.f).negate());
      var imp = S.impactFx({ rays: 11, debris: true, debrisN: 8 }), landed = false;
      return function (a, dt) {
        var kc = eOut(seg(a, 0.35, 0.6)), ko = seg(a, 2.5, 2.95);
        d.visible = r.visible = a > 0.35 && ko < 1;
        d.scale.setScalar(Math.max(0.01, (1.4 + F.hs(0)) * kc)); r.scale.setScalar(Math.max(0.01, (1.5 + F.hs(0)) * kc));
        dark.opacity = 0.85 * (1 - ko); glowR.opacity = (0.6 + 0.3 * Math.sin(wt() * 22)) * (1 - ko);
        var rise = eBack(seg(a, 0.85, 1.35)), sink = eIn(seg(a, 2.35, 2.9));
        hand.visible = a > 0.85 && sink < 1;
        hand.position.y = lerp(-3.2 * HS, -0.25 * HS, rise) - sink * 3.4 * HS;
        var grip = eIn(seg(a, 1.75, 2.12)), spread = smooth(1.2, 1.6, a) * (1 - grip);
        fingers.forEach(function (f, i) { f[0].rotation.set(-0.15 * spread + 1.25 * grip, 0, (i - 1.5) * 0.18 * spread); f[1].rotation.x = 1.1 * grip; });
        th1.rotation.set(0, 0, -0.9 - 0.3 * spread + 1.2 * grip); th2.rotation.z = 0.6 * grip;
        wrist.rotation.x = 0.25 * grip - 0.1 * spread;
        if (dt > 0 && a > 0.85 && a < 1.4) for (var q = 0; q < 2; q++) { var an = S.r() * TAU, rr = (0.8 + S.r()) * HS; S.trail(Tc.x + Math.cos(an) * rr, 0.2, Tc.z + Math.sin(an) * rr); }
        if (a > 0.9 && a < 0.95) S.shake(0.3, 0.4);
        if (!landed && a >= 2.15) { landed = true; S.boom(imp, F.front(0), 1.8, { power: 1.0, sound: 'bone_crack' }); S.land(0); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  ROT BLOOM (3 pips, burn): a corrupted flower bursts up under the
  //  target, blooms open and sprays choking spores.
  // ---------------------------------------------------------------
  function petalGeo(B) { var g = G(); B.glow(g.sph(1, 10, 8), '#7a2a9a', { p: [0, 0.55, 0], s: [0.32, 0.6, 0.1] }); B.glow(g.sph(1, 8, 6), '#b04ad8', { p: [0, 0.6, 0.03], s: [0.2, 0.45, 0.08] }); B.glow(g.box(0.03, 0.8, 0.02), EYE, { p: [0, 0.55, 0.09] }); }
  function stalkGeo(B) {
    var g = G();
    B.glow(g.taper([[0, 0, 0], [0.15, 0.5, 0], [-0.1, 1.0, 0.05], [0, 1.4, 0]], 0.2, 0.12, 12, 6), '#3a5a1a');
    for (var i = 0; i < 4; i++) B.glow(g.cone(0.05, 0.22, 4), '#6a8a2a', { p: [Math.sin(i * 2) * 0.17, 0.25 + i * 0.28, Math.cos(i * 2) * 0.17], r: [Math.cos(i * 2) * 1.2, 0, -Math.sin(i * 2) * 1.2] });
    B.glow(g.sph(0.22, 10, 8), '#2a1640', { p: [0, 1.45, 0] });
    B.glow(g.sph(0.12, 8, 6), EYE, { p: [0, 1.55, 0] });
  }
  def('rot_bloom', {
    dur: 2.75, impact: 1.9, color: '#b04ad8', summonSound: [0.4, 'creak'],
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.55, 'target', { pull: 1.2, dp: [0, 0.8, 0] }], [1.45, 'side', { push: 0.15 }], [1.85, 'target', { pull: 1.0 }], [2.3, 'home', { blend: 0.45 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var Tc = F.feet(0), FS = clamp(1.0 + F.th * 0.25, 1.3, 2.2);
      var flower = S.group(); flower.position.copy(Tc).addScaledVector(F.f, 0.9 + F.hs(0) * 0.3);
      glowPart(S, 'rotStalk', stalkGeo, flower, [0.03, VIO, 0.6]);
      var petals = [];
      for (var i = 0; i < 6; i++) { var pv = S.group(flower); pv.position.y = 1.45; pv.rotation.y = i * TAU / 6; var inner = S.group(pv); glowPart(S, 'rotPetal', petalGeo, inner, [0.03, VIO, 0.6]); petals.push(inner); }
      var head = S.halo(EYE, 1.2, 0.5, flower); head.position.y = 1.5;
      flower.visible = false;
      var imp = S.impactFx({ rays: 8, rayColor: '#c8ff6a' }), landed = false, em = rate(90);
      return function (a, dt) {
        var rise = eBack(seg(a, 0.5, 0.95)), bloom = eOut(seg(a, 1.0, 1.45)), wilt = seg(a, 2.25, 2.7);
        flower.visible = a > 0.5 && wilt < 1;
        flower.scale.set(FS * rise, FS * rise * (1 - 0.6 * wilt), FS * rise);
        petals.forEach(function (p, i) { p.rotation.x = lerp(-0.15, 1.15, bloom) - 0.5 * wilt + Math.sin(wt() * 4 + i) * 0.05; });
        if (a > 1.4 && a < 2.2 && dt > 0) em(dt, function () {
          var top = _a.copy(flower.position).setY(1.5 * FS), th = S.r() * TAU, sp = 1.5 + S.r() * 2;
          _b.subVectors(F.hit(0), top).normalize();
          S.pc.emit(top.x, top.y, top.z, _b.x * sp * 2 + Math.cos(th) * sp * 0.6, 1.2 + S.r() * 1.5, _b.z * sp * 2 + Math.sin(th) * sp * 0.6, 0.9, 0.3, 0.7, rgb('#b8f060'), rgb('#5a2a7a'), 0.85, -1, 1.2);
        });
        if (!landed && a >= 1.9) { landed = true; S.boom(imp, F.front(0), 1.3, { power: 0.7 }); S.land(0); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  HOLLOW DRAIN (3 pips, drain): shadow tendrils lash out from the
  //  caster, latch onto the target and siphon its light back.
  // ---------------------------------------------------------------
  def('hollow_drain', {
    dur: 2.75, impact: 1.72, summonSound: [0.45, 'shadow_whoosh'],
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.6, 'side', { push: 0.12 }], [1.35, 'target', { pull: 0.6 }], [1.8, 'side', { pull: 0.5 }], [2.3, 'home', { blend: 0.42 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var tend = [], n = 3, NS = 22;
      var IA = S.inst(k.UG.sphLo(), k.bodyMat(DK2, 0.95), n * NS), IB = S.inst(k.UG.sphLo(), WF.models.glow(VIO, 0.8), n * NS);
      for (var t = 0; t < n; t++) {
        var segs = [];
        for (var i = 0; i < NS; i++) segs.push({ position: new T.Vector3(), glow: i % 5 === 2, s: 0 });
        tend.push({ segs: segs, side: (t - 1) * 1.4, up: t === 1 ? 1.0 : 0.3 });
      }
      var from = F.from.clone(), hit = F.front(0);
      var imp = S.impactFx({ rays: 8 }), landed = false;
      var drain = KT.Drain(S, F, 1.85, 2.5, { n: 7, color: '#d0b0ff' });
      var revFrom = F.C.clone().setY(F.ch * 0.6);
      return function (a, dt) {
        var reach = eOut(seg(a, 0.6, 1.3)), retr = seg(a, 2.35, 2.65), vis = a > 0.6 && reach > 0.02 && retr < 1;
        IA.begin(); IB.begin();
        tend.forEach(function (td, j) {
          var c1 = _c.lerpVectors(from, hit, 0.5).addScaledVector(F.s, td.side + Math.sin(wt() * 6 + j) * 0.4); c1.y = Math.max(from.y, hit.y) + td.up + Math.sin(wt() * 5 + j * 2) * 0.3;
          td.segs.forEach(function (m, i) {
            if (!vis) return;
            var u = (i / (td.segs.length - 1)) * reach * (1 - retr);
            qbez(from, c1, hit, u, m.position);
            var pulse = 0.5 + 0.5 * Math.sin(wt() * 18 - i * 0.9);
            var sc = (0.2 - i * 0.006) * (1 + 0.45 * pulse * smooth(1.3, 1.5, a));
            (m.glow ? IB : IA).pushTRS(m.position, null, sc);
          });
        });
        IA.end(); IB.end();
        if (dt > 0 && a > 1.3 && a < 2.3 && S.r() < 0.8) { var tj = tend[(S.r() * n) | 0], mi = tj.segs[(S.r() * tj.segs.length) | 0]; S.trail(mi.position.x, mi.position.y, mi.position.z); }
        if (!landed && a >= 1.72) { landed = true; S.boom(imp, hit, 1.2, { power: 0.65 }); S.land(0); }
        drain(a, dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  NIGHT TERROR (5 pips): shadows pool behind the target and a towering
  //  nightmare specter rises, shrieks, and rakes its claws through it.
  // ---------------------------------------------------------------
  function shroudGeo(B) {
    var g = G(), pts = [], n = 10;
    // ragged hem: lathe with a jagged bottom
    B.glow(g.lathe([[1.35, 0.0], [1.45, 0.25], [1.25, 1.0], [1.0, 2.0], [0.8, 2.8], [0.55, 3.4], [0.02, 3.6]], 14), DK);
    for (var i = 0; i < n; i++) { var a = i * TAU / n; B.glow(g.cone(0.22, 0.9, 4), DK2, { p: [Math.cos(a) * 1.3, -0.2, Math.sin(a) * 1.3], r: [PI, 0, 0] }); }
    B.glow(g.lathe([[0.62, 2.55], [0.78, 2.8], [0.72, 3.3], [0.5, 3.75], [0.02, 3.9]], 12), DK2);           // hood
    B.glow(g.sph(1, 12, 8), '#05020a', { p: [0, 3.25, 0.42], s: [0.45, 0.48, 0.2] });                       // void face
    B.glow(g.sph(0.1, 8, 6), EYE, { p: [0.17, 3.32, 0.6], s: [1.4, 0.8, 0.6] });
    B.glow(g.sph(0.1, 8, 6), EYE, { p: [-0.17, 3.32, 0.6], s: [1.4, 0.8, 0.6] });
    B.glow(g.taper([[0.4, 3.7, 0], [0.85, 4.2, -0.2], [1.1, 4.8, -0.6], [1.0, 5.2, -1.0]], 0.13, 0.02, 10, 6), DK3);
    B.glow(g.taper([[-0.4, 3.7, 0], [-0.85, 4.2, -0.2], [-1.1, 4.8, -0.6], [-1.0, 5.2, -1.0]], 0.13, 0.02, 10, 6), DK3);
    B.glow(g.sph(0.07, 6, 5), VIO2, { p: [1.0, 5.2, -1.0] }); B.glow(g.sph(0.07, 6, 5), VIO2, { p: [-1.0, 5.2, -1.0] });
  }
  function clawArmGeo(B) {            // pivot at the shoulder, arm along +Y? no: hangs along -Y, claws at the end
    var g = G();
    B.glow(g.taper([[0, 0, 0], [0.1, -0.7, 0.2], [0.05, -1.5, 0.35]], 0.22, 0.1, 10, 6), DK2);
    for (var i = 0; i < 4; i++) B.glow(g.taper([[0.05, -1.5, 0.35], [(i - 1.5) * 0.18, -1.95, 0.6], [(i - 1.5) * 0.24, -2.35, 1.0]], 0.07, 0.01, 8, 4), i % 2 ? '#c8b8e8' : '#e6dcff');
  }
  def('night_terror', {
    dur: 3.95, impact: 2.88, bigCast: true, summonSound: [0.35, 'dread_rise'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.2 }],
        [0.5, 'targetLow', { pull: 2.2, lookRise: 1.0 }],
        [1.55, function (F2, P, L, u) { P.copy(F2.feet(0)).addScaledVector(F2.f, -2.4).addScaledVector(F2.s, 2.0).setY(1.0); L.copy(c.refs.spec).setY(3.4 * c.refs.SS); }, { push: 0.15 }],
        [2.35, function (F2, P, L, u) { P.copy(F2.feet(0)).addScaledVector(F2.f, -1.0).addScaledVector(F2.s, 7.5).setY(2.2); L.copy(F2.feet(0)).addScaledVector(F2.f, 1.4).setY(2.4); }],
        [2.9, 'target', { pull: 1.2 }], [3.45, 'home', { blend: 0.5 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var SS = clamp(1.05 + F.th * 0.05, 1.05, 1.3); c.refs.SS = SS;
      var at = F.feet(0).addScaledVector(F.f, 2.6 * SS); c.refs.spec = at;
      var pool = Q.Portal(S, at, 2.2 * SS, 0.3, 3.7, { rate: 70, spin: 2 });
      var spec = S.group(), body = S.group(spec);
      glowPart(S, 'nightShroud', shroudGeo, body, [0.06, VIO, 0.85]);
      eyesGlow(S, body, [[0.17, 3.32, 0.66], [-0.17, 3.32, 0.66]], 0.9);
      var aR = S.group(body), aL = S.group(body);
      aR.position.set(0.95, 2.9, 0.1); aL.position.set(-0.95, 2.9, 0.1);
      glowPart(S, 'nightArm', clawArmGeo, aR, [0.04, VIO, 0.8]);
      var al = glowPart(S, 'nightArm', clawArmGeo, aL, [0.04, VIO, 0.8]); al.scale.x = -1;
      S.halo(VIO, 7, 0.3, body).position.y = 2.5;
      spec.scale.setScalar(SS); spec.position.copy(at); faceFlat(spec, _a.copy(F.f).negate());
      spec.visible = false;
      var imp = S.impactFx({ rays: 14 }), landed = false, shrieked = false;
      var slashes = [];
      for (var i = 0; i < 3; i++) { var sl = S.mesh(K().SG('cine_arc', function () { return new T.RingGeometry(0.9, 1, 40, 1, 0, PI); }), S.fade(K().bodyMat(VIO2, 0.95))); sl.visible = false; slashes.push(sl); }
      return function (a, dt) {
        pool.tick(a, dt);
        S.dim(0.55 * smooth(0.3, 0.9, a) * (1 - smooth(3.2, 3.8, a)));
        var rise = eOut(seg(a, 0.8, 1.7)), gone = seg(a, 3.2, 3.85);
        spec.visible = a > 0.8 && gone < 1;
        spec.position.y = lerp(-4.2 * SS, 0.2 * SS, rise) + Math.sin(wt() * 2.5) * 0.15 * SS;
        body.scale.set(1 + 0.25 * gone, 1 - 0.5 * gone, 1 + 0.25 * gone);
        var scream = bell(a, 1.85, 2.4), raise = smooth(2.1, 2.5, a), rake = eIn(seg(a, 2.55, 2.88)), rec = smooth(3.0, 3.25, a);
        body.rotation.x = -0.25 * scream + 0.5 * rake - 0.3 * rec;
        aR.rotation.set(-2.4 * raise + 2.9 * rake - 0.5 * rec, 0, 0.4 * raise); aL.rotation.set(-2.4 * raise + 2.9 * rake - 0.5 * rec, 0, -0.4 * raise);
        if (!shrieked && a > 1.85) { shrieked = true; S.sound('shriek_big'); S.shake(0.35, 0.6); }
        if (dt > 0 && spec.visible) for (var q = 0; q < 2; q++) { var th = S.r() * TAU; (S.pn || S.pc).emit(at.x + Math.cos(th) * 1.3 * SS, spec.position.y + 0.3, at.z + Math.sin(th) * 1.3 * SS, Math.cos(th) * 0.4, 0.6, Math.sin(th) * 0.4, 0.9, 0.6, 1.6, rgb(pal.smoke2), rgb(pal.smoke), 0.8, 0.4, 1.5); }
        slashes.forEach(function (sl, i) {
          var ks = seg(a, 2.78 + i * 0.05, 3.15 + i * 0.05);
          sl.visible = ks > 0 && ks < 1;
          if (!sl.visible) return;
          sl.position.copy(F.hit(0)).addScaledVector(F.f, -0.4 - i * 0.15).addScaledVector(F.s, (i - 1) * 0.35);
          faceDir(sl, _b.copy(F.f).negate()); sl.rotateZ(-0.9 + i * 0.25 + ks * 1.2);
          sl.scale.setScalar(1.4 + ks * 1.2); sl.material.opacity = 0.95 * (1 - ks);
        });
        if (!landed && a >= 2.88) { landed = true; S.boom(imp, F.front(0), 2.2, { power: 1.4, flashColor: '#c8a0ff' }); S.land(0); smokeAt(S, F.hit(0), 16, 2, 0.7); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  ECLIPSE (6 pips, Nyx's ultimate): the sky darkens, a black sun with
  //  a violet corona rises over the target and a beam of night crushes it.
  // ---------------------------------------------------------------
  def('eclipse', {
    dur: 4.45, impact: 3.22, bigCast: true, summonSound: [0.4, 'dread_rise'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.2 }],
        [0.55, 'sky', { push: 0.1 }],
        [1.6, function (F2, P, L, u) { P.copy(cp(F2, -3.0, 1.6, 2.6)); L.copy(c.refs.sun).lerp(F2.feet(0).setY(1.5), 0.35); }, { push: 0.1 }],
        [2.55, 'targetLow', { pull: 1.5, lookRise: 2.0 }],
        [3.22, 'target', { pull: 2.0, dp: [0, 0.8, 0] }], [3.85, 'home', { blend: 0.55 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var sunAt = F.feet(0).addScaledVector(F.f, 1.0).setY(8.5 + F.th * 0.3); c.refs.sun = sunAt;
      var sun = S.group(); sun.position.copy(sunAt);
      var disc = S.mesh(k.UG.sph(), WF.models.glow('#05020a'), sun); disc.scale.setScalar(1.3);
      var corona = S.mesh(k.UG.tor(), S.fade(k.addMat(VIO, 0.9)), sun), corona2 = S.mesh(k.UG.tor(), S.fade(k.bodyMat(VIO2, 0.9)), sun);
      var rays = [];
      for (var i = 0; i < 12; i++) { var rm = S.mesh(k.UG.cone(), S.fade(k.bodyMat(i % 2 ? VIO : '#6a3ab8', 0.85)), sun); rm.userData.a = i * TAU / 12; rays.push(rm); }
      var h1 = S.halo(VIO, 7, 0.55, sun), h2 = S.halo('#5a2ab8', 14, 0.3, sun);
      faceDir(sun, _a.copy(F.f).negate());
      sun.visible = false;
      var beamO = S.mesh(k.UG.cyl(), S.fade(k.rimMat ? k.addMat(VIO, 0.7) : k.bodyMat(VIO, 0.7))), beamI = S.mesh(k.UG.cyl(), S.fade(WF.models.glow('#0d0716', 0.95)));
      beamO.visible = beamI.visible = false;
      var Tc = F.feet(0), imp = S.impactFx({ rays: 16, rayColor: VIO2 }), landed = false;
      var shock = Q.Shock(S, '#3a1a6a', 0.9), em = rate(120);
      return function (a, dt) {
        S.dim(0.7 * smooth(0.3, 1.2, a) * (1 - smooth(3.6, 4.3, a)));
        var rise = eOut(seg(a, 0.6, 1.6)), charge = seg(a, 1.6, 2.9), gone = seg(a, 3.7, 4.3);
        sun.visible = a > 0.6 && gone < 1;
        sun.position.copy(sunAt).setY(sunAt.y - 3 * (1 - rise));
        sun.scale.setScalar(Math.max(0.01, (0.4 + 0.6 * rise) * (1 + 0.3 * charge) * (1 - gone)));
        corona.scale.set(1.55, 2.4, 1.55); corona.rotation.set(PI / 2, wt() * 0.5, 0);
        corona2.scale.set(1.42, 3.0, 1.42); corona2.rotation.set(PI / 2, -wt() * 0.8, 0);
        corona.material.opacity = 0.6 + 0.3 * Math.sin(wt() * 9);
        rays.forEach(function (rm, i) {
          var an = rm.userData.a + wt() * 0.4, L = (1.4 + 0.6 * Math.sin(wt() * 6 + i) + 1.4 * charge);
          rm.position.set(Math.cos(an) * 1.5, Math.sin(an) * 1.5, 0); rm.rotation.set(0, 0, an - PI / 2); rm.scale.set(0.16, L, 0.05);
        });
        var hs = 7 * (1 + 0.5 * charge); h1.scale.set(hs, hs, 1);
        if (dt > 0 && a > 1.6 && a < 3.1) em(dt, function () {   // darkness drawn up into the black sun
          var th = S.r() * TAU, rr = 6 + S.r() * 3; _b.set(sun.position.x + Math.cos(th) * rr, sun.position.y + (S.r() - 0.5) * 4, sun.position.z + Math.sin(th) * rr);
          _c.subVectors(sun.position, _b).multiplyScalar(1.6);
          S.pa.emit(_b.x, _b.y, _b.z, _c.x, _c.y, _c.z, 0.62, 0.3, 0.05, pal.Bc, pal.A, 1, 0, 0);
        });
        var kb = eIn(seg(a, 2.95, 3.22)), kbo = seg(a, 3.4, 3.9);
        beamO.visible = beamI.visible = a > 2.95 && kbo < 1;
        if (beamO.visible) {
          _b.lerpVectors(sun.position, _d.copy(Tc).setY(F.thMax * 0.85), kb);     // the beam crowns the target; its body stays readable
          Q.fx().placeBeam(beamO, sun.position, _b, (1.2 + 0.3 * Math.sin(wt() * 40)) * (1 - kbo) + 0.01);
          Q.fx().placeBeam(beamI, sun.position, _b, 0.65 * (1 - kbo) + 0.01);
          beamO.material.opacity = 0.75 * (1 - kbo); beamI.material.opacity = 0.95 * (1 - kbo);
        }
        if (!landed && a >= 3.22) { landed = true; S.boom(imp, F.front(0), 2.6, { power: 1.6, flashColor: '#b080ff' }); S.land(0); shock.go(Tc, 7, 0.8); smokeAt(S, F.hit(0), 18, 2.2, 0.8); }
        shock.tick(dt);
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  BOG BELCH (Grubnak, 2 pips): the Bog King swells up and belches a
  //  rolling green cloud of bog gas over his foes.
  // ---------------------------------------------------------------
  def('bog_belch', {
    len: function () { return { dur: 2.7, impact: 1.78, impactEnd: 1.95 }; },
    color: '#7fd23a', summonSound: [0.5, 'gulp'],
    cam: function (F) { return [[0, 'caster', { push: 0.12, blend: 0.2 }], [0.95, 'side', { push: 0.12 }], [1.68, 'targets', { pull: 1.0 }], [2.2, 'home', { blend: 0.45 }]]; },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var cobj = S.spec.caster, baseS = cobj ? cobj.scale.x : 1;
      var mouth = F.C.clone().addScaledVector(F.f, 1.0 + F.ch * 0.15).setY(F.ch * 0.55);
      var front = new T.Vector3(), em = rate(150), landed = [], imps = F.targets.map(function () { return S.impactFx({ rays: 7, rayColor: '#c8ff6a' }); });
      var curl = S.mesh(WF.models._fx.curlGeo(), S.own(new T.MeshBasicMaterial({ color: '#6fae2a', vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, side: T.DoubleSide })));
      curl.visible = false;
      return function (a, dt) {
        var swell = bell(a, 0.4, 1.0);
        if (cobj && !c.finished) cobj.scale.set(baseS * (1 + 0.18 * swell), baseS * (1 + 0.08 * swell), baseS * (1 + 0.18 * swell));
        if (a > 1.0 && cobj) cobj.scale.setScalar(baseS);
        var kg = seg(a, 0.95, 1.9);
        front.copy(mouth).lerp(F.Tc.clone().setY(1.0), eOut(kg));
        curl.visible = a > 1.0 && a < 2.2;
        if (curl.visible) {
          curl.position.copy(front).setY(0); faceFlat(curl, F.f);
          var hh = (1.6 + F.thMax * 0.3) * smooth(1.0, 1.25, a) * (1 - seg(a, 1.9, 2.2));
          curl.scale.set(2.5 + kg * 3, Math.max(0.01, hh), 2.0); curl.material.opacity = 0.62 * (1 - seg(a, 1.9, 2.2));
        }
        if (a > 0.95 && a < 2.0 && dt > 0) em(dt, function () {
          var sp = 4 + S.r() * 3; _b.copy(F.f).multiplyScalar(sp).addScaledVector(F.s, (S.r() - 0.5) * sp * 0.9); _b.y = (S.r() - 0.3) * 1.5;
          S.pc.emit(mouth.x, mouth.y, mouth.z, _b.x, _b.y, _b.z, 0.9 + S.r() * 0.4, 0.5, 1.8, rgb('#9add4a'), rgb('#3f6a12'), 0.9, 0.2, 1.3);
          if (S.r() < 0.3) S.pa.emit(mouth.x, mouth.y, mouth.z, _b.x, _b.y + 1, _b.z, 0.6, 0.2, 0.03, rgb('#e8ff9a'), rgb('#9add4a'), 1, -2, 0.6);
        });
        F.targets.forEach(function (t, i) { if (!landed[i] && a >= 1.78 + i * 0.08) { landed[i] = true; S.boom(imps[i], F.front(i), 1.2, { power: 0.7, sound: 'splat', boomSound: i === 0 }); S.land(i); } imps[i].tick(dt); });
      };
    }
  });

  // ---------------------------------------------------------------
  //  THORN LASH (Thornmaw, 2 pips): huge thorny vines tear out of the
  //  ground around the target and whip down on it.
  // ---------------------------------------------------------------
  def('thorn_lash', {
    dur: 2.45, impact: 1.62, color: '#6a9a2a', summonSound: [0.4, 'creak'],
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.55, 'target', { pull: 1.6, dp: [0, 1.0, 0] }], [1.5, 'target', { pull: 0.5 }], [1.95, 'home', { blend: 0.45 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var Tc = F.feet(0), vines = [], hs = F.hs(0);
      var vm = WF.models.toon('#4a3a22', { flat: true }), vm2 = WF.models.toon('#3a5a1a', { flat: true }), thornM = WF.models.toon('#d8c8a0', { flat: true });
      for (var v = 0; v < 3; v++) {
        var ang = Math.atan2(F.f.x, F.f.z) + PI + (v - 1) * 1.1, base = Tc.clone().add(_a.set(Math.sin(ang) * (1.5 + hs * 0.6), 0, Math.cos(ang) * (1.5 + hs * 0.6)));
        var segs = [];
        for (var i = 0; i < 12; i++) {
          var m = S.mesh(k.UG.cone5(), i % 2 ? vm : vm2); m.castShadow = true; m.visible = false;
          if (i % 2 === 0) { var th = S.mesh(k.UG.cone5(), thornM, m); th.position.set(0.6, 0.5, 0); th.rotation.z = -1.2; th.scale.set(0.35, 0.8, 0.35); }
          segs.push(m);
        }
        vines.push({ base: base, segs: segs, ph: v * 0.12, side: v - 1 });
      }
      var imp = S.impactFx({ rays: 9 }), landed = false;
      return function (a, dt) {
        vines.forEach(function (vn, j) {
          var up = eOut(seg(a, 0.45 + vn.ph, 0.95 + vn.ph)), whip = eIn(seg(a, 1.25 + vn.ph * 0.5, 1.62)), back = smooth(1.0, 1.25, a) * (1 - whip), sink = seg(a, 2.0, 2.4);
          var H = (2.6 + F.th * 0.6) * up * (1 - sink);
          var tip = _b.copy(vn.base).setY(H).addScaledVector(_c.subVectors(vn.base, Tc).setY(0).normalize(), 0.8 * back);
          tip.lerp(F.hit(0), whip * 0.95);
          var ctl = _d.copy(vn.base).setY(H * 0.6);
          vn.segs.forEach(function (m, i) {
            var u = i / (vn.segs.length - 1);
            m.visible = H > 0.05;
            if (!m.visible) return;
            qbez(vn.base, ctl, tip, u, m.position);
            qbez(vn.base, ctl, tip, Math.min(1, u + 0.08), _e).sub(m.position);
            if (_e.lengthSq() > 1e-8) m.quaternion.setFromUnitVectors(_a.set(0, 1, 0), _e.normalize());
            var w = (0.32 - u * 0.24) * (0.9 + hs * 0.2); m.scale.set(w, 0.55 + 0.1 * hs, w);
          });
        });
        if (dt > 0 && a > 0.45 && a < 1.0) for (var q = 0; q < 2; q++) { var vv = vines[(S.r() * 3) | 0]; S.trail(vv.base.x + (S.r() - 0.5), 0.2, vv.base.z + (S.r() - 0.5)); }
        if (!landed && a >= 1.62) { landed = true; S.boom(imp, F.front(0), 1.3, { power: 0.75, sound: 'whip' }); S.land(0); }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  CAPTAIN'S CLEAVE (Vex, 4 pips): a giant spectral greatsword forms
  //  over the captain, rises, and cleaves down on the target.
  // ---------------------------------------------------------------
  function swordGeo(B) {
    var g = G();
    B.glow(g.box(0.85, 4.2, 0.1), '#7cff6a', { p: [0, 2.6, 0] });
    B.glow(g.box(0.3, 4.0, 0.12), '#e8ffd8', { p: [0, 2.55, 0] });
    B.glow(g.cone(0.6, 0.9, 4), '#7cff6a', { p: [0, 5.15, 0], s: [1, 1, 0.18], r: [0, PI / 4, 0] });
    B.glow(g.box(1.5, 0.22, 0.26), '#3d2266', { p: [0, 0.45, 0] });
    for (var s = -1; s <= 1; s += 2) B.glow(g.cone(0.14, 0.45, 4), '#a879ff', { p: [s * 0.85, 0.5, 0], r: [0, 0, -s * 1.2] });
    B.glow(g.cyl(0.09, 0.09, 0.7, 6), '#1e0f33', { p: [0, 0.0, 0] });
    B.glow(g.sph(0.16, 8, 6), EYE, { p: [0, -0.4, 0] });
    B.glow(g.sph(0.12, 8, 6), EYE, { p: [0, 0.45, 0.14] });
  }
  def('captains_cleave', {
    dur: 3.15, impact: 2.22, summonSound: [0.4, 'blade_ring'],
    cam: function (F, c) {
      return [[0, 'caster', { push: 0.1, blend: 0.2 }],
        [0.5, 'casterWide', { lookRise: 1.6, push: 0.1 }],
        [1.4, CI.follow(function () { return c.refs.sword; }, function (F2, u, P) { P.copy(F2.M).addScaledVector(F2.s, F2.D * 0.7 + 5).setY(2.4); }, { dy: 2.0 })],
        [1.85, function (F2, P, L, u) { P.copy(F2.feet(0)).addScaledVector(F2.f, -3.2).addScaledVector(F2.s, 8.0).setY(2.0); L.copy(F2.feet(0)).addScaledVector(F2.f, -2.6).setY(2.6); }],
        [2.24, 'target', { pull: 0.8 }], [2.65, 'home', { blend: 0.48 }]];
    },
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std();
      var sword = S.group(), inner = S.group(sword);
      glowPart(S, 'vexSword', swordGeo, inner, [0.06, VIO, 0.9]);
      S.halo('#7cff6a', 3.5, 0.4, inner).position.y = 2.6;
      var WS = 1.6; inner.scale.setScalar(WS);
      sword.visible = false; c.refs.sword = sword;
      var hover = F.C.clone().addScaledVector(F.f, 0.6).addScaledVector(F.s, -0.8).setY(F.ch + 0.6), Tc = F.feet(0);
      var pivotAt = Tc.clone().addScaledVector(F.f, -0.4).setY(0);
      var imp = S.impactFx({ rays: 12, rayColor: '#c8ffb8' }), landed = false;
      var slash = S.mesh(K().SG('cine_arc', function () { return new T.RingGeometry(0.9, 1, 40, 1, 0, PI); }), S.fade(K().bodyMat('#c8ffb8', 0.9))); slash.visible = false;
      var crackM = S.fade(K().bodyMat('#7cff6a', 0.9)), crack = S.mesh(K().UG.plane(), crackM); crack.visible = false; crack.renderOrder = 4;
      return function (a, dt) {
        var form = eOut(seg(a, 0.4, 1.0)), lift = eInOut(seg(a, 1.0, 1.6)), chop = eIn(seg(a, 1.85, 2.22)), gone = seg(a, 2.55, 2.95);
        sword.visible = a > 0.4 && gone < 1;
        if (sword.visible) {
          if (a < 1.6) {
            sword.position.copy(hover).setY(hover.y + lift * 2.4);
            faceFlat(sword, F.f); inner.rotation.set(0, wt() * 1.5 * (1 - lift), 0);
            inner.scale.set(WS * form, WS * form, WS * form);
          } else {
            // swing: the hilt hangs in the air in front of the target; the blade arcs down over it
            var Lb = 4.6 * WS;
            sword.position.copy(Tc).addScaledVector(F.f, -0.72 * Lb).setY(1.3 + 1.2 * (1 - smooth(1.6, 1.85, a)));
            faceFlat(sword, F.f);
            inner.rotation.set(lerp(-0.35, PI * 0.5, chop), 0, 0);
            inner.scale.setScalar(WS * (1 - 0.6 * gone));
          }
        }
        if (!landed && a >= 2.22) {
          landed = true; S.boom(imp, F.front(0), 2.0, { power: 1.2, sound: 'cleave' }); S.land(0);
          slash.visible = crack.visible = true;
        }
        if (landed) {
          var ks = seg(a, 2.22, 2.6), kc = seg(a, 2.22, 2.95);
          slash.position.copy(F.hit(0)).addScaledVector(F.f, -0.5); faceDir(slash, _b.copy(F.s)); slash.rotateZ(-PI * 0.5 + ks * 0.5);
          slash.scale.setScalar(2.2 + ks * 1.4); slash.material.opacity = 0.9 * (1 - ks); slash.visible = ks < 1;
          crack.position.copy(Tc).setY(0.09); crack.rotation.y = Math.atan2(F.f.x, F.f.z); crack.scale.set(0.25 * (1 - kc) + 0.02, 1, 4.5 * eOut(Math.min(1, ks * 2)));
          crackM.opacity = 0.9 * (1 - kc); crack.visible = kc < 1;
        }
        imp.tick(dt);
      };
    }
  });

  // ---------------------------------------------------------------
  //  RENDING SLASH (Vex, 2 pips, burn): three crescent blades of violet
  //  light rip across the target in quick succession.
  // ---------------------------------------------------------------
  def('rending_slash', {
    dur: 2.2, impact: 1.36, summonSound: [0.5, 'blade_ring'],
    cam: function (F) { return [[0, 'caster', { push: 0.12, blend: 0.2 }], [0.7, 'target', { pull: 0.4 }], [1.72, 'home', { blend: 0.42 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var arcs = [];
      for (var i = 0; i < 3; i++) {
        var g = S.group(), m1 = S.mesh(K().SG('cine_arc3', function () { return new T.RingGeometry(0.78, 1, 40, 1, 0, PI); }), S.fade(k.bodyMat(i === 1 ? '#7cff6a' : VIO2, 0.95)), g);
        var m2 = S.mesh(K().SG('cine_arc2', function () { return new T.RingGeometry(0.7, 1.06, 40, 1, 0, PI); }), S.fade(k.addMat(VIO, 0.7)), g);
        g.visible = false; arcs.push({ g: g, m1: m1, m2: m2, t: 0.95 + i * 0.2, imp: S.impactFx({ rays: 5 }), done: false, rot: [-0.6, 0.7, -0.1][i] });
      }
      var hit = F.front(0);
      return function (a, dt) {
        arcs.forEach(function (ar, i) {
          var k1 = seg(a, ar.t - 0.12, ar.t + 0.25);
          ar.g.visible = k1 > 0 && k1 < 1;
          if (ar.g.visible) {
            ar.g.position.copy(hit).addScaledVector(F.f, -0.3); faceDir(ar.g, _b.copy(F.f).negate());
            ar.g.rotateZ(ar.rot + (k1 - 0.5) * 2.4); ar.g.scale.setScalar(1.2 + F.hs(0) * 0.5);
            ar.m1.material.opacity = 0.95 * (1 - smooth(0.5, 1, k1)); ar.m2.material.opacity = 0.7 * (1 - smooth(0.5, 1, k1));
          }
          if (!ar.done && a >= ar.t) { ar.done = true; S.boom(ar.imp, hit, 0.9, { power: 0.45, sound: 'slash', boomSound: false }); if (i === 2) S.land(0); }
          ar.imp.tick(dt);
        });
      };
    }
  });

  // ---------------------------------------------------------------
  //  QUILL STORM (Thornmaw phase, 2 pips, burn): a burst of thorn quills
  //  flies up from the boss and rains down on the target.
  // ---------------------------------------------------------------
  def('quill_storm', {
    dur: 2.35, impact: 1.5, color: '#8aa83a', summonSound: [0.45, 'whoosh'],
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.2 }], [0.75, 'side', { push: 0.1 }], [1.35, 'target', { pull: 0.8 }], [1.85, 'home', { blend: 0.45 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std();
      var qm = WF.models.toon('#d8c8a0', { flat: true }), qm2 = WF.models.toon('#5a3a22', { flat: true }), quills = [];
      var top = F.C.clone().setY(F.ch * 0.8), Tc = F.feet(0);
      for (var i = 0; i < 16; i++) {
        var m = S.mesh(k.UG.cone5(), i % 3 ? qm : qm2); m.visible = false; m.castShadow = true;
        var land = Tc.clone().add(_a.set((S.r() - 0.5) * 2.2 * F.hs(0), 0, (S.r() - 0.5) * 2.2 * F.hs(0))).setY(0.3 + S.r() * F.th * 0.7);
        var apex = new T.Vector3().lerpVectors(top, land, 0.55).setY(5 + S.r() * 2.5).addScaledVector(F.s, (S.r() - 0.5) * 3);
        quills.push({ m: m, land: land, apex: apex, t0: 0.55 + S.r() * 0.25, t1: 1.25 + S.r() * 0.35 });
      }
      var imp = S.impactFx({ rays: 8 }), landed = false;
      return function (a, dt) {
        quills.forEach(function (q) {
          var kq = seg(a, q.t0, q.t1);
          q.m.visible = kq > 0 && a < 2.05;
          if (!q.m.visible) return;
          if (kq < 1) {
            qbez(top, q.apex, q.land, kq, q.m.position);
            qbez(top, q.apex, q.land, Math.min(1, kq + 0.04), _b).sub(q.m.position);
            if (_b.lengthSq() > 1e-8) q.m.quaternion.setFromUnitVectors(_c.set(0, 1, 0), _b.normalize());
          } else if (!q.hit) { q.hit = true; S.burst(q.land, 3, 0.5); }
          q.m.scale.set(0.07, 0.75, 0.07);
        });
        if (!landed && a >= 1.5) { landed = true; S.boom(imp, F.front(0), 1.1, { power: 0.6, sound: 'thud' }); S.land(0); }
        imp.tick(dt);
      };
    }
  });
})();

// =====================================================================
//  MINI EFFECTS — heals, heal-over-time, blades, traps, shields, absorbs,
//  weaknesses (W101-style little moments, ~1.4-1.9 s)
// =====================================================================
(function () {
  'use strict';
  var CI = WF.cine, Q = CI._k, KT = CI._kit, T = window.THREE, PI = Math.PI, TAU = PI * 2, def = CI.def;
  var wt = Q.wt;   // v1.2 WS1: real clock for wobbles / flaps / spins (choreography stays on `a`)
  var clamp = Q.clamp, seg = Q.seg, eOut = Q.eOut, eIn = Q.eIn, eInOut = Q.eInOut, eBack = Q.eBack, smooth = Q.smooth, bell = Q.bell, lerp = Q.lerp;
  var qbez = Q.qbez, faceDir = Q.faceDir, faceFlat = Q.faceFlat, rgb = Q.rgb;
  var glowPart = KT.glowPart, cp = KT.cp, tp = KT.tp, rate = KT.rate, K = KT.K;
  var _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3();
  function G() { return K().G; }
  function hex(c) { return '#' + c.getHexString(); }

  // camera for self-casts: hold on the caster, then home. For target effects: caster then target.
  function selfCam(dur) { return function (F) { return [[0, 'caster', { push: 0.14, blend: 0.25 }], [dur - 0.42, 'home', { blend: 0.4 }]]; }; }
  function targetCam(dur, t1) { return function (F) { return [[0, 'caster', { push: 0.1, blend: 0.25 }], [t1, 'target', { pull: 0.6, dp: [0, 0.4, 0] }], [dur - 0.4, 'home', { blend: 0.38 }]]; }; }

  // the effect lands on target 0 (the caster for self-casts)
  function onWho(F) { return { pos: F.feet(0), h: F.targets[0].h }; }

  // healing light: a fairy-light sprite circles the target sprinkling sparkles, then a ring of light
  function fairyGeo(B) {
    var g = G();
    B.glow(g.sph(0.12, 10, 8), '#fffbe8');
    B.glow(g.disc(1, 10), '#ffffff', { p: [0.14, 0.04, -0.02], r: [-PI / 2, 0.4, 0.5], s: [0.16, 0.08, 1], order: 'YXZ' });
    B.glow(g.disc(1, 10), '#ffffff', { p: [-0.14, 0.04, -0.02], r: [-PI / 2, -0.4, -0.5], s: [0.16, 0.08, 1], order: 'YXZ' });
  }
  function healBuild(variant) {
    return function (S, F) {
      var k = K(), pal = S.pal; S.std(240);
      var w = onWho(F), H = w.h, P = w.pos;
      var col = variant === 'hollow' ? '#9dff5a' : hex(pal.a);
      var spr = S.group(); glowPart(S, 'fairy', fairyGeo, spr, null, { dbl: true });
      var h1 = S.halo(col, 0.8, 0.6, spr), h2 = S.halo('#ffffff', 0.38, 0.8, spr);   // small: bloom (WF.gfx) widens it
      var crystals = [];
      if (variant === 'stoneward') for (var i = 0; i < 6; i++) { var cm = S.mesh(k.UG.oct(), S.fade(k.bodyMat(i % 2 ? '#ffd27a' : '#ffb347', 0.95))); cm.visible = false; cm.userData.a = i * TAU / 6; crystals.push(cm); }
      var ring = Q.Shock(S, variant === 'hollow' ? '#9dff5a' : '#8affb0', 0.85), ring2 = Q.Shock(S, col, 0.8), done = false;
      var colM = S.own(k.gradMat(variant === 'hollow' ? '#5a2a8a' : '#8affb0', false)), column = S.mesh(k.UG.cyl(), colM); column.visible = false;
      return function (a, dt) {
        var on = a > 0.3 && a < 1.35;
        spr.visible = on && variant !== 'stoneward';
        if (spr.visible) {
          var u = seg(a, 0.3, 1.25), ang = u * TAU * 2.2, rr = (0.9 + H * 0.15) * (1 - 0.35 * u);
          spr.position.set(P.x + Math.cos(ang) * rr, 0.4 + u * (H + 0.4), P.z + Math.sin(ang) * rr);
          spr.scale.setScalar(2.1 * (1 + 0.15 * Math.sin(wt() * 30)));
          if (dt > 0) for (var q = 0; q < 2; q++) S.pa.emit(spr.position.x, spr.position.y, spr.position.z, (S.r() - 0.5) * 0.4, -0.6 - S.r() * 0.8, (S.r() - 0.5) * 0.4, 0.8, 0.22, 0.03, variant === 'hollow' ? rgb('#c8ff8a') : pal.Co, variant === 'hollow' ? rgb('#5a2a8a') : rgb('#8affb0'), 1, -0.5, 0.8);
        }
        crystals.forEach(function (cm, i) {
          var kc = eBack(seg(a, 0.3 + i * 0.05, 0.6 + i * 0.05)), ko = seg(a, 1.25, 1.55);
          cm.visible = kc > 0.01 && ko < 1;
          var an = cm.userData.a + wt() * 0.6, rr2 = 1.0 + H * 0.12;
          cm.position.set(P.x + Math.cos(an) * rr2, 0.35 * kc, P.z + Math.sin(an) * rr2);
          cm.scale.set(0.3 * kc, 0.8 * kc * (1 - ko), 0.3 * kc); cm.rotation.y = wt() * 2;
          if (dt > 0 && a > 0.7 && a < 1.25 && S.r() < 0.3) { _a.copy(cm.position); _b.copy(P).setY(H * 0.6).sub(_a).multiplyScalar(1.6); S.pa.emit(_a.x, _a.y + 0.3, _a.z, _b.x, _b.y + 0.5, _b.z, 0.6, 0.22, 0.04, pal.H, pal.A, 1, 0, 0.5); }
        });
        if (!done && a >= 1.25) {
          done = true; S.land(0); ring.go(P, 1.8 + H * 0.2, 0.6); ring2.go(P, 1.2 + H * 0.15, 0.45); column.visible = true; S.sound('heal_chime', true);
          for (var i2 = 0; i2 < 24; i2++) { var th = S.r() * TAU, r3 = 0.4 + S.r() * 0.6; S.pc.emit(P.x + Math.cos(th) * r3, 0.2 + S.r() * H, P.z + Math.sin(th) * r3, 0, 1.2 + S.r() * 1.5, 0, 0.9, 0.3, 0.04, variant === 'hollow' ? rgb('#9dff5a') : rgb('#8affb0'), variant === 'hollow' ? rgb('#3a1a5a') : pal.A, 1, 0, 1); }
        }
        if (column.visible) { var kk = seg(a, 1.25, 1.75); column.position.copy(P); column.scale.set(0.8 + H * 0.12, (H + 1.5) * eOut(Math.min(1, kk * 3)), 0.8 + H * 0.12); colM.opacity = 0.55 * (1 - kk); column.visible = kk < 1; }
        ring.tick(dt); ring2.tick(dt);
      };
    };
  }
  ['lumen', 'tidecaller', 'stoneward', 'hollow', 'any'].forEach(function (v) {
    def('heal_' + v, { dur: 1.8, impact: 1.25, cam: selfCam(1.8), build: healBuild(v === 'any' ? 'lumen' : v) });
  });

  // HEALING RAIN: a silver raincloud gathers overhead and rains glittering drops
  def('heal_rain', {
    dur: 2.0, impact: 1.45, castSound: 'cast_tidecaller',
    cam: function (F) { return [[0, 'caster', { push: 0.1, blend: 0.25 }], [0.45, 'casterWide', { lookRise: 0.6 }], [1.6, 'home', { blend: 0.4 }]]; },
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std(260);
      var w = onWho(F), P = w.pos, H = w.h;
      var cloud = KT.StormCloud(S, P.clone().setY(H + 2.3), 1.1);
      cloud.g.children.forEach(function (m) { if (m.material && m.material.color && m.isMesh) m.material.color.set('#e6f2ff'); });
      var ring = Q.Shock(S, '#8affb0', 0.85), done = false, em = rate(140);
      return function (a, dt) {
        cloud.tick(a, 0.3, 1.9, false);
        if (dt > 0 && a > 0.65 && a < 1.7) em(dt, function () {
          var th = S.r() * TAU, rr = S.r() * 1.1;
          S.pc.emit(P.x + Math.cos(th) * rr, H + 2.0, P.z + Math.sin(th) * rr, 0, -6, 0, 0.42, 0.16, 0.1, pal.Bc, pal.A, 0.95, -4, 0);
          if (S.r() < 0.4) S.pa.emit(P.x + Math.cos(th) * rr, H + 1.8, P.z + Math.sin(th) * rr, 0, -4, 0, 0.5, 0.2, 0.03, pal.Co, rgb('#8affb0'), 1, -2, 0);
        });
        if (!done && a >= 1.45) { done = true; S.land(0); ring.go(P, 2.2, 0.6); S.sound('heal_chime', true); }
        ring.tick(dt);
      };
    }
  });

  // WELLSPRING (heal over time): a sparkling spring bursts up at the caster's feet
  def('hot_any', {
    dur: 1.9, impact: 1.25, castSound: 'cast_tidecaller',
    cam: selfCam(1.9),
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std(240);
      var w = onWho(F), P = w.pos, H = w.h;
      var pool = Q.Portal(S, P, 1.1, 0.25, 1.8, { rate: 40, spin: 2 });
      var sp = KT.Spout(S, P.clone().addScaledVector(F.f, 0.9).addScaledVector(F.s, -0.6), 0.32, 1.9);
      var ring = Q.Shock(S, '#8affb0', 0.85), done = false;
      return function (a, dt) {
        pool.tick(a, dt);
        sp.tick(a, 0.45, 1.55, dt);
        if (dt > 0 && a > 0.5 && a < 1.5 && S.r() < 0.8) { var th = S.r() * TAU; S.pa.emit(P.x + Math.cos(th) * 0.8, 0.3, P.z + Math.sin(th) * 0.8, 0, 1.5 + S.r() * 1.5, 0, 0.8, 0.24, 0.03, pal.Co, rgb('#8affb0'), 1, 0, 0.8); }
        if (!done && a >= 1.25) { done = true; S.land(0); ring.go(P, 1.9, 0.6); sp.foam(1.4); S.sound('heal_chime', true); }
        ring.tick(dt);
      };
    }
  });

  // BLADE: a glowing school blade forms over the caster, spins and plunges into their aura
  function bladeGeos(colA, colB, key) {
    return function (B) {
      var g = G();
      B.glow(g.cone(0.13, 1.25, 4), colA, { p: [0, 0.95, 0], s: [1, 1, 0.3], r: [0, PI / 4, 0] });
      B.glow(g.cone(0.06, 1.15, 4), '#ffffff', { p: [0, 0.95, 0.02], s: [1, 1, 0.3], r: [0, PI / 4, 0] });
      B.glow(g.box(0.62, 0.09, 0.12), colB, { p: [0, 0.32, 0] });
      B.glow(g.cyl(0.045, 0.045, 0.32, 6), '#3a2a1a', { p: [0, 0.12, 0] });
      B.glow(g.sph(0.07, 8, 6), colB, { p: [0, -0.06, 0] });
    };
  }
  // v1.1 polish (B20): every school's blade has its own material + entrance, not just a tint:
  //   emberstrike = a flaming blade that drops like a meteor, stoneward = a rune-cut stone sword that
  //   bursts up out of the ground, tidecaller = a glassy water blade that spirals up around you,
  //   hollow = a jagged shadow blade that flickers out of smoke, lumen / any = the shining spin-in.
  function stoneBladeGeos(rune) {
    return function (B) {
      var g = G();
      B.add(g.cone(0.17, 1.3, 4), '#9a8a70', { p: [0, 0.95, 0], s: [1, 1, 0.34], r: [0, PI / 4, 0], flat: true });
      B.add(g.box(0.7, 0.13, 0.17), '#6f6250', { p: [0, 0.32, 0], flat: true });
      B.add(g.cyl(0.06, 0.06, 0.32, 6), '#4a3a28', { p: [0, 0.12, 0], flat: true });
      B.add(g.dod ? g.dod(0.1) : g.sph(0.1, 6, 4), '#7f705a', { p: [0, -0.07, 0], flat: true });
      B.glow(g.box(0.035, 0.85, 0.2), rune, { p: [0, 0.95, 0] });
      B.glow(g.box(0.2, 0.035, 0.19), rune, { p: [0, 0.32, 0] });
    };
  }
  function shadowBladeGeos(colA, colB) {
    return function (B) {
      var g = G();
      for (var i = 0; i < 3; i++) B.glow(g.cone(0.16 - i * 0.03, 0.55, 4), i % 2 ? colA : '#1e0f33', { p: [(i % 2 ? 0.05 : -0.04), 0.55 + i * 0.36, 0], s: [1, 1, 0.3], r: [0, PI / 4, (i % 2 ? -0.18 : 0.18)] });
      B.glow(g.cone(0.05, 1.1, 4), colB, { p: [0, 0.95, 0.03], s: [1, 1, 0.3], r: [0, PI / 4, 0] });
      B.glow(g.box(0.66, 0.08, 0.1), '#1e0f33', { p: [0, 0.3, 0], r: [0, 0, 0.12] });
      B.glow(g.oct(0.09), colB, { p: [0, 0.3, 0.06] });
      B.glow(g.cyl(0.045, 0.045, 0.32, 6), '#140a22', { p: [0, 0.12, 0] });
    };
  }
  function bladeBuild(o) {
    o = o || {};
    return function (S, F, c) {
      var k = K(), pal = S.pal; S.std(220);
      var w = onWho(F), P = w.pos, H = w.h, sc = S.school;
      var kind = o.croak || o.roar ? 'any' : ({ emberstrike: 'ember', stoneward: 'stone', tidecaller: 'tide', hollow: 'shadow' })[sc] || 'any';
      var colA = hex(pal.a), colB = hex(pal.hot), blade = S.group(), bladeMat = null;
      if (kind === 'stone') glowPart(S, 'blade_stone_' + colB.slice(1), stoneBladeGeos(colB), blade);
      else if (kind === 'shadow') glowPart(S, 'blade_shadow_' + colA.slice(1), shadowBladeGeos(colA, '#9dff5a'), blade, [0.03, colA, 0.7]);
      else if (kind === 'tide') {
        // glassy water: the shared blade shape drawn as a translucent additive copy + a bright core
        var bg = k.cachedGeos('cine_blade_' + colA.slice(1), bladeGeos(colA, colB)).g;
        if (bg) { bladeMat = S.fade(k.bodyMat(pal.b, 0.8)); S.mesh(bg, bladeMat, blade); var bga = S.mesh(bg, S.fade(k.addMat(pal.hot, 0.35)), blade); bga.scale.setScalar(1.06); }
        var core = S.mesh(k.UG.cone(), S.fade(k.bodyMat('#e8fbff', 0.9)), blade); core.position.y = 0.95; core.scale.set(0.05, 1.05, 0.02);
      } else glowPart(S, 'blade_' + colA.slice(1), bladeGeos(colA, colB), blade, [0.03, colB, 0.85]);
      S.halo(pal.a, kind === 'stone' ? 1.0 : 1.6, kind === 'shadow' ? 0.45 : 0.6, blade).position.y = 0.9;
      blade.visible = false;
      var top = P.clone().setY(H + 1.6), imp = S.impactFx({ rays: 7, debris: kind === 'stone' }), done = false, cobj = S.spec.caster, baseS = cobj ? cobj.scale.x : 1;
      var ring = Q.Shock(S, pal.hot, 0.9), dust = Q.Shock(S, kind === 'stone' ? '#8a7a60' : pal.b, 0.8), dusted = false;
      var bs = H > 2.6 ? 1.4 : 1.1;
      return function (a, dt) {
        if (o.croak && cobj && !c.finished) { var sw = bell(a, 0.3, 0.75); cobj.scale.set(baseS * (1 + 0.15 * sw), baseS * (1 + 0.06 * sw), baseS * (1 + 0.15 * sw)); if (a > 0.75) cobj.scale.setScalar(baseS); }
        if (o.roar && a > 0.35 && a < 0.4 && !c.roared) { c.roared = true; ring.go(P, 4 + H * 0.5, 0.7); S.shake(0.25, 0.4); }
        blade.visible = a > 0.35 && a < 1.15;
        var form = eBack(seg(a, 0.35, 0.6)), spin = seg(a, 0.35, 0.85), stab = eIn(seg(a, 0.85, 1.05)), y;
        var sx = 0, sz = 0, rotY = spin * TAU * 2, sclK = form * (1 + 0.6 * (1 - spin));
        if (kind === 'ember') {
          // falls in from high above, spinning hard, trailing fire
          var fall = eOut(seg(a, 0.35, 0.8));
          y = lerp(H + 4.2, top.y, fall); rotY = spin * TAU * 3.5; sclK = Math.min(1, form * 1.2);
          if (dt > 0 && blade.visible) for (var e = 0; e < 2; e++) S.pc.emit(blade.position.x + (S.r() - 0.5) * 0.3, blade.position.y - 0.4 + S.r() * 0.9, blade.position.z + (S.r() - 0.5) * 0.3, (S.r() - 0.5) * 0.6, 1.2 + S.r(), (S.r() - 0.5) * 0.6, 0.45, 0.28, 0.05, pal.A, pal.D, 0.95, 1.5, 0.6);
        } else if (kind === 'stone') {
          // bursts up out of the ground beside you, then rises over your head
          var rise = eOut(seg(a, 0.35, 0.78));
          y = lerp(-1.4, top.y, rise); rotY = spin * TAU * 0.75; sclK = Math.min(1, 0.5 + rise);
          if (!dusted && a > 0.37) { dusted = true; dust.go(P, 1.8 + H * 0.3, 0.6); S.burst(_a.copy(P).setY(0.3), 18, 0.8); S.shake(0.12, 0.25); }
        } else if (kind === 'tide') {
          // spirals up around you like a rising current
          var sp = eOut(seg(a, 0.35, 0.82)), ang = sp * TAU * 1.5, rr = (1.2 + H * 0.1) * (1 - sp);
          sx = Math.cos(ang) * rr; sz = Math.sin(ang) * rr; y = lerp(0.4, top.y, sp); rotY = -ang * 1.4;
          if (bladeMat) bladeMat.opacity = 0.72 + 0.14 * Math.sin(wt() * 14);
          if (dt > 0 && blade.visible && S.r() < 0.8) S.pc.emit(blade.position.x, blade.position.y + 0.4, blade.position.z, (S.r() - 0.5) * 0.4, -0.2, (S.r() - 0.5) * 0.4, 0.55, 0.14, 0.04, pal.Bc, pal.A, 0.9, -5, 0.2);
        } else if (kind === 'shadow') {
          // flickers into being inside a puff of shadow smoke
          y = top.y; rotY = spin * TAU; sclK = form * (0.85 + 0.25 * (S.r() < 0.25 && a < 0.8 ? 1 : 0));
          if (dt > 0 && blade.visible && a < 0.95 && S.pn) S.pn.emit(blade.position.x + (S.r() - 0.5) * 0.8, blade.position.y - 0.2 + S.r() * 1.2, blade.position.z + (S.r() - 0.5) * 0.8, 0, 0.3, 0, 0.7, 0.5, 0.9, [0.12, 0.06, 0.2], [0.05, 0.02, 0.08], 0.7, 0.4, 0.5);
        } else y = top.y;
        blade.position.set(P.x + sx, lerp(y, H * 0.55, stab) + 0.15 * Math.sin(wt() * 6), P.z + sz);
        blade.rotation.set(PI, rotY, 0);
        blade.scale.setScalar(Math.max(0.01, sclK * bs));
        if (dt > 0 && blade.visible && S.r() < 0.6) S.pa.emit(blade.position.x, blade.position.y, blade.position.z, (S.r() - 0.5), (S.r() - 0.5), (S.r() - 0.5), 0.5, 0.2, 0.02, pal.Co, pal.A, 1, 0, 1);
        if (!done && a >= 1.05) { done = true; S.land(0); imp.go(_a.copy(P).setY(H * 0.55), 0.9, 22); S.sound(kind === 'stone' ? 'impact_stoneward' : 'blade_shing', true); if (kind === 'stone') S.sound('blade_shing'); }
        imp.tick(dt); ring.tick(dt); dust.tick(dt);
      };
    };
  }
  def('blade_any', { dur: 1.5, impact: 1.05, cam: selfCam(1.5), build: bladeBuild() });
  def('blade_croak', { dur: 1.55, impact: 1.05, cam: selfCam(1.55), build: bladeBuild({ croak: true }), castSound: 'croak' });
  def('blade_warcry', { dur: 1.55, impact: 1.05, cam: selfCam(1.55), build: bladeBuild({ roar: true }), castSound: 'war_cry' });

  // TRAP: a hexagonal sigil springs up under the target, flashes, and sinks in
  function trapBuild(o) {
    o = o || {};
    return function (S, F) {
      var k = K(), pal = S.pal; S.std(200);
      var w = onWho(F), P = w.pos, R = 0.9 + F.hs(0) * 0.45;
      var bars = [], bm = S.fade(k.bodyMat(pal.a, 0.95)), bg = S.fade(k.addMat(pal.hot, 0.7));
      for (var i = 0; i < 6; i++) { var b = S.mesh(k.UG.cyl(), bm), b2 = S.mesh(k.UG.cyl(), bg); b.visible = b2.visible = false; bars.push([b, b2, i]); }
      var hexM = S.own(new T.MeshBasicMaterial({ map: K().sigilTex(S.school in K().FXPAL ? S.school : null), color: pal.a, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      var disc = S.mesh(k.UG.plane(), hexM); disc.position.set(P.x, 0.1, P.z); disc.renderOrder = 5; disc.visible = false;
      var done = false, imp = S.impactFx({ rays: 6, debris: S.school === 'stoneward' });
      // v1.1 polish (B20): school flavour on the snare: ember = flame jets at the corners, stone = rock
      // spikes erupt, tide = a ring of water spouts, hollow = shadow tendrils, lumen = light pillars
      var sc = S.school, spikes = [], spM = sc === 'stoneward' ? WF.models.toon('#8a7a60', { flat: true }) : null;
      if (spM) for (var si = 0; si < 6; si++) { var spk = S.mesh(k.UG.cone5 ? k.UG.cone5() : k.UG.cone(), spM); spk.visible = false; spk.castShadow = true; spikes.push(spk); }
      var colM = (sc === 'lumen' || sc === 'tidecaller') ? S.own(k.gradMat(pal.a, false)) : null, cols = [];
      if (colM) for (var ci = 0; ci < 6; ci++) { var cm = S.mesh(k.UG.cyl(), colM); cm.visible = false; cols.push(cm); }
      function corner(i, out) { var an = i * TAU / 6 + PI / 6; return out.set(P.x + Math.cos(an) * R, 0, P.z + Math.sin(an) * R); }
      return function (a, dt) {
        var up = eBack(seg(a, 0.55, 0.85)), sink = eIn(seg(a, 1.05, 1.4));
        var live = up > 0.05 && sink < 1;
        spikes.forEach(function (m, i) {
          m.visible = live; if (!live) return;
          corner(i, m.position); m.position.y = -0.1 - 0.9 * sink;
          var hh = (0.7 + F.hs(0) * 0.35) * up; m.scale.set(0.2, Math.max(0.01, hh), 0.2); m.rotation.set(0, i, (i % 2 ? 0.18 : -0.18));
        });
        cols.forEach(function (m, i) {
          m.visible = live; if (!live) return;
          corner(i, m.position); var ch = (sc === 'lumen' ? 2.6 : 1.4) * up * (1 - sink); m.scale.set(0.18, Math.max(0.01, ch), 0.18);
          colM.opacity = 0.5 * (1 - sink);
        });
        if (dt > 0 && live && sink < 0.6) {
          var ci2 = (S.r() * 6) | 0, cp2 = corner(ci2, _d);
          if (sc === 'emberstrike') S.pc.emit(cp2.x, 0.15, cp2.z, (S.r() - 0.5) * 0.3, 2.6 + S.r() * 1.5, (S.r() - 0.5) * 0.3, 0.45, 0.3, 0.06, pal.A, pal.D, 0.95, 1.5, 0.4);
          else if (sc === 'tidecaller') S.pc.emit(cp2.x, 0.2, cp2.z, (S.r() - 0.5) * 0.8, 3 + S.r(), (S.r() - 0.5) * 0.8, 0.6, 0.16, 0.05, pal.Bc, pal.A, 0.9, -6, 0.1);
          else if (sc === 'hollow' && S.pn) S.pn.emit(cp2.x, 0.2, cp2.z, (P.x - cp2.x) * 0.5, 0.9, (P.z - cp2.z) * 0.5, 0.8, 0.4, 0.8, [0.14, 0.06, 0.24], [0.05, 0.02, 0.08], 0.7, 0.3, 0.6);
        }
        disc.visible = a > 0.5 && sink < 1;
        disc.scale.set(2 * R * 1.2 * Math.max(0.01, up), 1, 2 * R * 1.2 * Math.max(0.01, up)); disc.rotation.y = -wt() * 1.5; hexM.opacity = 0.9 * (1 - sink);
        bars.forEach(function (bb) {
          var i = bb[2], a0 = i * TAU / 6 + PI / 6, a1 = (i + 1) * TAU / 6 + PI / 6;
          var p0 = _a.set(P.x + Math.cos(a0) * R, 0, P.z + Math.sin(a0) * R), p1 = _b.set(P.x + Math.cos(a1) * R, 0, P.z + Math.sin(a1) * R);
          var hgt = (0.9 + F.hs(0) * 0.3) * up * (1 - sink);
          bb[0].visible = bb[1].visible = hgt > 0.01;
          // a glowing wall segment: thin cylinder laid along the hexagon edge, raised by hgt
          var mid = _c.addVectors(p0, p1).multiplyScalar(0.5); mid.y = hgt;
          K().placeBeam(bb[0], _a.copy(p0).setY(hgt), _b.copy(p1).setY(hgt), 0.07);
          K().placeBeam(bb[1], _a.copy(p0).setY(hgt), _b.copy(p1).setY(hgt), 0.13);
        });
        bm.opacity = 0.95 * (1 - sink); bg.opacity = (0.5 + 0.3 * Math.sin(wt() * 20)) * (1 - sink);
        if (dt > 0 && up > 0.5 && sink < 0.5 && S.r() < 0.7) { var th = S.r() * TAU; S.pa.emit(P.x + Math.cos(th) * R, 0.2, P.z + Math.sin(th) * R, 0, 1.5, 0, 0.5, 0.2, 0.02, pal.Co, pal.A, 1, 0, 0.5); }
        if (!done && a >= 1.0) { done = true; S.land(0); imp.go(_a.copy(P).setY(0.5), 0.8, 16); S.sound('trap_snap', true); }
        imp.tick(dt);
      };
    };
  }
  def('trap_any', { dur: 1.5, impact: 1.0, cam: targetCam(1.5, 0.45), build: trapBuild() });

  // SHIELD: a round school shield materializes in front of the caster, spins in and glints
  function shieldGeo(colA, colB) {
    return function (B) {
      var g = G();
      B.glow(g.cyl(0.62, 0.62, 0.08, 24), colA, { r: [PI / 2, 0, 0] });
      B.glow(g.tor(0.62, 0.06, 5, 24), colB, {});
      B.glow(g.tor(0.36, 0.035, 4, 20), colB, { p: [0, 0, 0.05] });
      B.glow(g.sph(0.12, 10, 8), '#ffffff', { p: [0, 0, 0.06] });
      for (var i = 0; i < 4; i++) B.glow(g.box(0.06, 0.24, 0.03), colB, { p: [Math.cos(i * PI / 2) * 0.5, Math.sin(i * PI / 2) * 0.5, 0.05], r: [0, 0, i * PI / 2] });
    };
  }
  // v1.1 polish (B20): stoneward raises a carved stone tower-shield, tidecaller a rippling water mirror,
  // emberstrike a shield ringed with fire, hollow a dark shield in smoke, lumen / any the bright disc
  function stoneShieldGeo(rune) {
    return function (B) {
      var g = G();
      B.add(g.cyl(0.66, 0.6, 0.16, 8), '#8f8068', { r: [PI / 2, PI / 8, 0], flat: true });
      B.add(g.tor(0.64, 0.07, 4, 8), '#6f6250', { r: [0, 0, PI / 8], flat: true });
      B.add(g.dod(0.16), '#7f705a', { p: [0, 0, 0.09], flat: true });
      for (var i = 0; i < 4; i++) B.glow(g.box(0.05, 0.3, 0.03), rune, { p: [Math.cos(i * PI / 2 + PI / 4) * 0.4, Math.sin(i * PI / 2 + PI / 4) * 0.4, 0.09], r: [0, 0, i * PI / 2 + PI / 4] });
      B.glow(g.tor(0.3, 0.025, 4, 16), rune, { p: [0, 0, 0.09] });
    };
  }
  def('shield_any', {
    dur: 1.45, impact: 0.95, cam: selfCam(1.45),
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std(180);
      var w = onWho(F), P = w.pos, H = w.h, sc = S.school;
      var colA = hex(sc === 'hollow' ? pal.deep : pal.b), colB = hex(pal.hot);
      var sh = S.group(), water = null;
      if (sc === 'stoneward') glowPart(S, 'shield_stone_' + colB.slice(1), stoneShieldGeo(colB), sh);
      else if (sc === 'tidecaller') {
        var sg = k.cachedGeos('cine_shield_' + colA.slice(1) + colB.slice(1), shieldGeo(colA, colB)).g;
        if (sg) { water = S.fade(k.bodyMat(pal.b, 0.75)); S.mesh(sg, water, sh); var wa = S.mesh(sg, S.fade(k.addMat(pal.hot, 0.3)), sh); wa.scale.setScalar(1.05); }
      } else glowPart(S, 'shield_' + colA.slice(1) + colB.slice(1), shieldGeo(colA, colB), sh, [0.03, colB, 0.85]);
      var ripple = sc === 'tidecaller' ? Q.Shock(S, pal.b, 0.8) : null, rippled = 0;
      var gl = S.halo(pal.a, sc === 'stoneward' ? 1.3 : 2.2, sc === 'stoneward' ? 0.3 : 0.5, sh);
      sh.visible = false;
      var at = P.clone().addScaledVector(F.f, 0.9 + H * 0.1).addScaledVector(F.s, -0.55).setY(H * 0.6), done = false;
      return function (a, dt) {
        sh.visible = a > 0.35 && a < 1.42;
        var kin = eBack(seg(a, 0.35, 0.75)), ko = seg(a, 1.1, 1.42);
        sh.position.copy(at); faceFlat(sh, F.f);
        sh.rotateY((1 - eOut(seg(a, 0.35, 0.95))) * TAU * 1.5);
        sh.scale.setScalar(Math.max(0.01, kin * (H > 2.6 ? 1.2 : 0.85) * (1 - 0.6 * ko)));
        if (!done && a >= 0.95) { done = true; S.land(0); S.sound(sc === 'stoneward' ? 'impact_stoneward' : 'shield_up', true); if (sc === 'stoneward') S.sound('shield_up'); S.burst(at, 12, 0.6); }
        var gs = (sc === 'stoneward' ? 1.3 : 2.2) * (1 + 0.8 * bell(a, 0.92, 1.15)); gl.scale.set(gs, gs, 1);
        if (water) water.opacity = (0.66 + 0.16 * Math.sin(wt() * 16)) * (1 - seg(a, 1.1, 1.42));
        if (ripple) { if (a > 0.6 + rippled * 0.25 && rippled < 3 && a < 1.2) { rippled++; ripple.go(_a.copy(at).setY(0), 0.8 + rippled * 0.4, 0.5); } ripple.tick(dt); }
        if (dt > 0 && sh.visible && a < 1.2) {
          if (sc === 'emberstrike') for (var fe = 0; fe < 2; fe++) { var fa = S.r() * TAU, fr = 0.62 * sh.scale.x; S.pc.emit(sh.position.x + F.s.x * Math.cos(fa) * fr, sh.position.y + Math.sin(fa) * fr, sh.position.z + F.s.z * Math.cos(fa) * fr, 0, 0.9 + S.r(), 0, 0.4, 0.22, 0.04, pal.A, pal.D, 0.95, 1.2, 0.5); }
          else if (sc === 'hollow' && S.pn && S.r() < 0.7) S.pn.emit(sh.position.x + (S.r() - 0.5) * 1.2, sh.position.y - 0.5 + S.r(), sh.position.z + (S.r() - 0.5) * 1.2, 0, 0.35, 0, 0.8, 0.4, 0.8, [0.14, 0.06, 0.24], [0.05, 0.02, 0.08], 0.7, 0.3, 0.5);
          else if (sc === 'lumen' && S.r() < 0.6) S.pa.emit(sh.position.x, sh.position.y, sh.position.z, (S.r() - 0.5) * 3, (S.r() - 0.5) * 3, (S.r() - 0.5) * 3, 0.5, 0.18, 0.02, pal.Co, pal.A, 1, 0, 1.5);
        }
      };
    }
  });

  // ABSORB: orbiting rings (or stone / iron / bark plates) converge into a shimmering ward
  def('absorb_any', {
    dur: 1.55, impact: 1.05, cam: selfCam(1.55),
    build: function (S, F, c) {
      var k = K(), pal = S.pal; S.std(200);
      var w = onWho(F), P = w.pos, H = w.h, card = S.card;
      var platey = S.school === 'stoneward' || /iron|bark/.test(card.id || '');
      var plateCol = /iron/.test(card.id) ? '#8a8a9a' : /bark/.test(card.id) ? '#6a4a2a' : '#a8936f';
      var items = [];
      if (platey) for (var i = 0; i < 8; i++) { var pm = S.mesh(k.UG.dod(), WF.models.toon(plateCol, { flat: true })); pm.castShadow = true; pm.visible = false; items.push(pm); }
      else for (var j = 0; j < 3; j++) { var rm = S.mesh(k.UG.tor(), S.fade(k.bodyMat(j === 1 ? pal.hot : pal.a, 0.95))); rm.visible = false; items.push(rm); }
      var bub = S.mesh(k.UG.sph(), S.fade(k.addMat(pal.b, 0.2))); bub.visible = false;
      var R0 = 1.1 + H * 0.2, done = false;
      return function (a, dt) {
        var form = eOut(seg(a, 0.35, 0.65)), conv = eIn(seg(a, 0.65, 1.05)), ko = seg(a, 1.15, 1.5);
        items.forEach(function (m, i) {
          m.visible = a > 0.35 && ko < 1;
          if (!m.visible) return;
          if (platey) {
            var an = i * TAU / items.length + wt() * 3, rr = R0 * (1 - 0.55 * conv), y = H * (0.25 + 0.6 * ((i % 3) / 2));
            m.position.set(P.x + Math.cos(an) * rr, y, P.z + Math.sin(an) * rr); m.rotation.set(wt() * 4 + i, wt() * 3, 0);
            m.scale.setScalar(Math.max(0.01, 0.22 * form * (1 - ko) * (1 + 0.3 * conv)));
          } else {
            m.position.copy(P).setY(H * (0.3 + 0.25 * i));
            var rr2 = R0 * (1.3 - 0.4 * conv) * form; m.scale.set(rr2, rr2 * 1.5, rr2);
            m.rotation.set(Math.sin(wt() * 3 + i) * 0.5 + i * 0.6, wt() * (2 + i), Math.cos(wt() * 2 + i) * 0.4);
            m.material.opacity = 0.95 * (1 - ko);
          }
        });
        bub.visible = a > 0.95 && ko < 1;
        if (bub.visible) { bub.position.copy(P).setY(H * 0.5); var bs = (R0 * 0.8 + H * 0.15) * eOut(seg(a, 0.95, 1.15)); bub.scale.set(bs, bs * 1.2, bs); bub.material.opacity = 0.2 * (1 - ko) * (1 - 0.6 * seg(a, 1.05, 1.15)); }
        if (!done && a >= 1.05) { done = true; S.land(0); S.sound('shield_up', true); S.burst(_a.copy(P).setY(H * 0.6), 14, 0.7); }
      };
    }
  });

  // WEAKNESS: dark chains of runes coil around the target and drag down (or roots grab its feet)
  def('weak_any', {
    dur: 1.55, impact: 1.05, cam: targetCam(1.55, 0.45),
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std(200);
      var w = onWho(F), P = w.pos, H = w.h;
      var links = [], lm = S.fade(k.bodyMat('#8a7aa8', 0.95)), lg = S.fade(k.addMat('#c8a0ff', 0.7));
      for (var i = 0; i < 14; i++) { var m = S.mesh(k.UG.tor(), i % 2 ? lm : lg); m.visible = false; links.push(m); }
      var arrow = S.mesh(k.UG.cone(), S.fade(k.bodyMat('#9a8ab8', 0.95))); arrow.visible = false; arrow.rotation.x = PI;
      var done = false;
      return function (a, dt) {
        var wrap = eOut(seg(a, 0.45, 0.95)), ko = seg(a, 1.15, 1.5);
        links.forEach(function (m, i) {
          var u = i / links.length;
          m.visible = u < wrap && ko < 1;
          if (!m.visible) return;
          var ang = u * TAU * 2.4 + wt() * 2, rr = 0.55 + H * 0.12;
          m.position.set(P.x + Math.cos(ang) * rr, H * (0.95 - 0.8 * u) - 0.3 * ko, P.z + Math.sin(ang) * rr);
          m.rotation.set(ang, i % 2 ? PI / 2 : 0, 0); m.scale.set(0.14, 0.4, 0.14);
        });
        arrow.visible = a > 0.5 && ko < 1;
        arrow.position.copy(P).setY(H + 0.9 - 0.35 * eIn(seg(a, 0.8, 1.05))); arrow.scale.set(0.3, 0.55, 0.3) ;
        arrow.material.opacity = 0.95 * (1 - ko);
        if (!done && a >= 1.05) { done = true; S.land(0); S.sound('debuff_chain', true); KT.smokeAt(S, _a.copy(P).setY(H * 0.4), 8, 0.6, 0.4); }
      };
    }
  });

  // ROOT SNARE (Thornmaw): gnarled roots burst up and grab the target's legs
  def('weak_roots', {
    dur: 1.6, impact: 1.05, color: '#6a9a2a', cam: targetCam(1.6, 0.45),
    build: function (S, F) {
      var k = K(), pal = S.pal; S.std(180);
      var w = onWho(F), P = w.pos, H = w.h, roots = [];
      var rm = WF.models.toon('#4a3a22', { flat: true });
      for (var r = 0; r < 5; r++) {
        var segs = []; for (var i = 0; i < 6; i++) { var m = S.mesh(k.UG.cone5(), rm); m.visible = false; m.castShadow = true; segs.push(m); }
        roots.push({ segs: segs, a0: r * TAU / 5 + 0.3 });
      }
      var done = false;
      return function (a, dt) {
        var grow = eOut(seg(a, 0.45, 0.95)), ko = seg(a, 1.2, 1.55);
        roots.forEach(function (rt) {
          rt.segs.forEach(function (m, i) {
            var u = i / (rt.segs.length - 1) * grow;
            m.visible = grow > 0.05 && ko < 1;
            if (!m.visible) return;
            var ang = rt.a0 + u * 2.2, rr = (0.9 + H * 0.1) * (1 - 0.55 * u);
            m.position.set(P.x + Math.cos(ang) * rr, u * H * 0.55 - 0.4 * ko, P.z + Math.sin(ang) * rr);
            m.rotation.set(Math.sin(ang) * 0.6, 0, -Math.cos(ang) * 0.6); m.scale.set(0.12 * (1 - u * 0.6), 0.45, 0.12 * (1 - u * 0.6));
          });
        });
        if (dt > 0 && a > 0.45 && a < 0.9) S.trail(P.x + (S.r() - 0.5) * 1.6, 0.15, P.z + (S.r() - 0.5) * 1.6);
        if (!done && a >= 1.05) { done = true; S.land(0); S.sound('creak', true); }
      };
    }
  });
})();
