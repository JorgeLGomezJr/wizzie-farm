// =====================================================================
//  WIZZIE FARM — models_mounts.js (v1.1, owner: C1 technical-artist/characters)
//  WF.models.mount(kind, opts) -> Group (origin at the hooves, y = 0, facing +Z)
//   kinds: pony, horse, warhorse (barding), nightmare (dark horse, flame mane,
//          glowing eyes), emberhoof (fire horse), mossback (giant mossy toad),
//          thornstag (antlered forest stag)
//   opts:  { coat, mane, saddle, trim, gem, rarity } (all optional)
//   userData.anim(t, state, dt)  state = idle | walk | run (gallop / hop)
//   userData.seat   Object3D at the saddle: add the rider's wizard root as a
//                   child at (0,0,0) and animate the rider with state 'ride'
//   userData.height (top of head/antlers), userData.radius (collision)
//  Built from the models.js primitives (WF.models._k) and packed with skinify
//  into ONE skinned mesh (+ shadow) + one halo batch + 0-2 particle draws.
//  Measured budget: <= 6 draw calls incl. shadow (tests/lab-wizard.html).
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  'use strict';
  var Mo = window.WF.models;
  if (!Mo || !Mo._k || !Mo._c1) return;
  var K = Mo._k, X1 = Mo._c1, T = K.T, PI = K.PI, TAU = K.TAU, C = K.C, sh = K.sh, mix = K.mix, clamp = K.clamp, smooth = K.smooth;
  var G = K.G, Builder = K.Builder, pivot = K.pivot, halo = K.halo, skinify = K.skinify, measureTop = K.measureTop;
  var Poser = X1.Poser, vmesh = X1.vmesh, lerp = X1.lerp, easeIO = X1.easeIO, bell = X1.bell, segK = X1.segK, hash01 = X1.hash01;

  var HORSE = {
    pony:      { s: 0.8, leg: 0.84, stocky: 1.12, coat: '#d9a066', mane: '#f4e3c0', saddle: '#8a4b2a', trim: '#e86a5a', gem: '#ffd76a', fluffy: true },
    horse:     { s: 1.0, leg: 1.0, stocky: 1.0, coat: '#8a5a3a', mane: '#3a2418', saddle: '#6a3a22', trim: '#2a6f9a', gem: '#ffd76a', blaze: true },
    warhorse:  { s: 1.13, leg: 1.0, stocky: 1.1, coat: '#d8d2c8', mane: '#5a4a3a', saddle: '#5a3a22', trim: '#a8321b', gem: '#ffd76a', barding: true, feathers: true },
    nightmare: { s: 1.05, leg: 1.0, stocky: 1.0, coat: '#1e1628', mane: '#b06bff', saddle: '#2a1a24', trim: '#5a2a9a', gem: '#9dff5a', flame: 'shadowfire', eyes: '#9dff5a', hoofGlow: '#b06bff', legCol: '#120c18' },
    emberhoof: { s: 1.05, leg: 1.0, stocky: 1.0, coat: '#b4441e', mane: '#ffb347', saddle: '#4a2418', trim: '#ffcf6a', gem: '#ff6b3d', flame: 'fire', eyes: '#ffd23a', hoofGlow: '#ff8a3a', legCol: '#4a1a0c' },
    thornstag: { s: 1.0, leg: 1.1, stocky: 0.86, coat: '#9a6a42', mane: '#efe3c8', saddle: '#4d6b3c', trim: '#9fe8a8', gem: '#7fffb0', antlers: true, spots: true, slim: true }
  };
  var TOAD = { mossback: { coat: '#5d7a3a', mane: '#7cae4a', saddle: '#6a4a2a', trim: '#c8a26a', gem: '#7fffb0', belly: '#d8cf9a' } };
  var AURA_KIND = { emberhoof: 'embers', nightmare: 'shadow', thornstag: 'leaves', mossback: 'leaves', strider: 'embers' };   // v1.2 WS6: + strider

  function tierOf(o) { return X1.tierOf({ rarity: o.rarity || 'common' }); }
  function gemPart(B, geo, col, tier, o) { if (tier >= 2) B.glow(geo, col, o); else B.add(geo, sh(col, 0.1), o); }
  function addHalo(list, parent, pos, col, size) { var s = halo(col, size, 0.85); s.position.set(pos[0], pos[1], pos[2]); parent.add(s); list.push({ s: s, base: size }); return s; }
  // cylinder from a to b (radii ra -> rb)
  function limb(B, a, b, ra, rb, col, seg, o) {
    var d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
    var g = new T.CylinderGeometry(rb, ra, len, seg || 10, 1, false);
    B.add(g, col, Object.assign({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], dir: [d.x, d.y, d.z] }, o || {}));
  }

  // ------------------------------------------------------------------
  //  Horse family (pony / horse / warhorse / nightmare / emberhoof / thornstag)
  // ------------------------------------------------------------------
  function horseModel(kind, opts) {
    var P = HORSE[kind] || HORSE.horse;
    var coat = C(opts.coat || P.coat), maneC = C(opts.mane || P.mane), sadC = C(opts.saddle || P.saddle), trimC = C(opts.trim || P.trim), gemC = C(opts.gem || P.gem);
    var legC = P.legCol ? C(P.legCol) : (kind === 'warhorse' ? sh(coat, -0.1) : sh(coat, -0.12));
    var tier = tierOf(opts), halos = [], st = P.stocky, LG = P.leg;
    var hoofC = C(kind === 'nightmare' ? '#0a060e' : '#3a2a22');
    var root = new T.Group(); root.name = 'mount_' + kind;
    var scaler = pivot(root); scaler.scale.setScalar(P.s);
    var bodyH = 0.24 + 0.98 * LG;               // torso centre height
    var torso = pivot(scaler, 0, bodyH, 0);
    // ---- barrel / chest / rump (painted: light back, darker belly) ----
    var paint = function (x, y, z, nx, ny, nz, out) { var v = smooth(-0.42, 0.3, y); out.copy(coat).multiplyScalar(0.78 + 0.22 * v); if (P.spots && y > 0.12 && Math.abs(z) < 0.75 && hash01(Math.floor(x * 9) * 7.1 + Math.floor(z * 9) * 3.3 + Math.floor(y * 9)) > 0.86) out.lerp(C('#f4ead8'), 0.85); };
    var barrel = new T.SphereGeometry(1, 22, 14); barrel.scale(0.4 * st, 0.42 * st, 0.82);
    torso.add(vmesh(barrel, paint));
    var b = new Builder();
    b.add(G.sph(1, 16, 12), coat, { p: [0, 0.05, 0.52], s: [0.37 * st, 0.41 * st, 0.38] });
    b.add(G.sph(1, 16, 12), sh(coat, -0.03), { p: [0, 0.06, -0.55], s: [0.41 * st, 0.42 * st, 0.42] });
    // ---- saddle, blanket, girth, stirrups ----
    var blanket = new T.CylinderGeometry(0.44 * st, 0.44 * st, 0.72, 16, 1, true, PI - 1.15, 2.3); blanket.rotateX(PI / 2);
    b.add(blanket, trimC, { p: [0, 0.0, -0.06], s: [1, 1.0, 1] });
    var edge = tier >= 1 ? C(opts.trim ? sh(trimC, 0.35) : '#ffd76a') : sh(trimC, -0.3);
    [[0.36], [-0.36]].forEach(function (zz) {
      var e2 = new T.TorusGeometry(0.445 * st, 0.018, 4, 18, 2.3); e2.rotateZ(PI / 2 - 1.15);
      b.add(e2, edge, { p: [0, 0, -0.06 + zz[0]] });
    });
    b.add(G.sph(1, 14, 10), sadC, { p: [0, 0.43 * st, -0.08], s: [0.27, 0.1, 0.34] });
    b.add(G.sph(0.085, 10, 8), sh(sadC, -0.1), { p: [0, 0.49 * st, 0.2], s: [1, 1.1, 0.9] });
    b.add(G.tor(0.15, 0.04, 6, 14, PI), sh(sadC, -0.15), { p: [0, 0.44 * st, -0.32], r: [0, 0, 0] });
    b.add(G.tor(0.43 * st, 0.03, 5, 22), sh(sadC, -0.35), { p: [0, -0.02, 0.12], r: [0, 0, 0], s: [1, 1.0, 1] });
    [-1, 1].forEach(function (sx) {
      b.add(G.box(0.03, 0.42, 0.05), sh(sadC, -0.3), { p: [sx * 0.43 * st, 0.2 * st, -0.02], r: [0, 0, sx * 0.16] });
      b.add(G.tor(0.06, 0.016, 4, 10), C('#c9c2b0'), { p: [sx * 0.47 * st, -0.03, -0.02], r: [0, PI / 2, 0] });
    });
    if (tier >= 2) gemPart(b, G.oct(0.045), gemC, tier, { p: [0, 0.5 * st, 0.29], s: [1, 1.2, 0.6] });
    if (tier >= 3) {
      var rl = new T.TorusGeometry(0.447 * st, 0.009, 4, 18, 2.3); rl.rotateZ(PI / 2 - 1.15);
      b.glow(rl, gemC, { p: [0, 0, -0.06] });
      [-1, 1].forEach(function (sx) { b.glow(G.oct(0.03), gemC, { p: [sx * 0.43 * st, 0.12, -0.06], s: [0.4, 1.4, 1], r: [0, 0, sx * 0.4] }); });
    }
    if (P.barding) {
      // peytral (chest plate) + caparison skirt + crupper plate
      var metal = C('#c9ced6');
      b.add(new T.SphereGeometry(1, 16, 10, -PI / 2 - 1.1, 2.2, PI * 0.25, PI * 0.45), metal, { p: [0, 0.05, 0.52], s: [0.41 * st, 0.44 * st, 0.42] });
      [-1, 1].forEach(function (sx) {
        // caparison: a cloth panel down each flank with a scalloped gold hem and an emblem
        var a0 = sx > 0 ? 0.35 : PI + 0.35, al = PI - 0.7;
        var cap = new T.CylinderGeometry(0.47 * st, 0.5 * st, 0.4, 10, 1, true, a0, al);
        b.add(cap, trimC, { p: [0, -0.24, -0.02], s: [1, 1, 1.75] });
        for (var sc = 0; sc < 7; sc++) { var aa = a0 + (sc + 0.5) * al / 7; b.add(G.sph(1, 6, 4), C('#ffd76a'), { p: [Math.sin(aa) * 0.5 * st, -0.44, Math.cos(aa) * 0.5 * st * 1.75 - 0.02], s: [0.05, 0.035, 0.09], r: [0, aa, 0] }); }
        b.add(G.box(0.02, 0.17, 0.17), C('#ffd76a'), { p: [sx * 0.505 * st, -0.2, -0.04], r: [PI / 4, 0, 0] });
        gemPart(b, G.oct(0.045), gemC, tier, { p: [sx * 0.52 * st, -0.2, -0.04], s: [0.5, 1, 1] });
      });
    }
    torso.add(b.build());
    if (tier >= 2) addHalo(halos, torso, [0, 0.5 * st, 0.33], gemC, 0.3);
    var seat = pivot(torso, 0, 0.46 * st, -0.17);   // v1.1 polish (B9): a little further back so the neck/head read past the rider
    seat.scale.setScalar(1 / P.s);   // v1.1 review: riders keep their own size on ponies and warhorses

    // ---- neck / head ----
    var neck = pivot(torso, 0, 0.22 * st, 0.6);
    neck.rotation.x = 0;
    var nb = new Builder(), nd = [0, 0.8, 0.58], nl = P.slim ? 0.82 : 0.74;
    var nTip = [nd[0] * nl, nd[1] * nl, nd[2] * nl];
    limb(nb, [0, -0.08, -0.04], nTip, 0.26 * st, 0.15, coat, 14);
    nb.add(G.sph(0.2 * st, 12, 9), coat, { p: [0, 0.02, 0.02] });
    var maneN = 9;
    if (!P.flame) {
      for (var i = 0; i < maneN; i++) {
        var u = i / (maneN - 1), px = [0, lerp(0.12, nTip[1] + 0.1, u), lerp(-0.12, nTip[2] - 0.08, u)];
        nb.add(G.cone(P.fluffy ? 0.11 : 0.08, P.fluffy ? 0.3 : 0.24, 6), i % 2 ? sh(maneC, -0.1) : maneC, { p: [i % 2 ? 0.035 : -0.035, px[1], px[2]], r: [-1.3 + u * 0.35, 0, (i % 2 ? 1 : -1) * 0.25] });
      }
    } else {
      for (var j = 0; j < maneN; j++) {
        var u2 = j / (maneN - 1);
        nb.glow(G.cone(0.075, 0.28 + 0.1 * Math.sin(j * 2.1), 6), j % 2 ? maneC : sh(maneC, 0.35), { p: [j % 2 ? 0.03 : -0.03, lerp(0.14, nTip[1] + 0.1, u2), lerp(-0.12, nTip[2] - 0.08, u2)], r: [-0.8 + u2 * 0.2, 0, (j % 2 ? 1 : -1) * 0.2] });
      }
    }
    if (P.barding) {   // crinet plates down the neck
      for (var c2 = 0; c2 < 3; c2++) { var u3 = (c2 + 0.5) / 3; nb.add(G.sph(1, 10, 6, 0), C('#c9ced6'), { p: [0, lerp(0.05, nTip[1] - 0.05, u3), lerp(0.08, nTip[2] + 0.06, u3)], s: [0.17, 0.12, 0.14], r: [-0.6, 0, 0] }); }
    }
    if (kind === 'thornstag') {   // leafy collar
      for (var lf = 0; lf < 12; lf++) { var la = lf / 12 * TAU; nb.add(G.sph(1, 6, 4), lf % 2 ? C('#6fbf4a') : C('#4f9a3a'), { p: [Math.sin(la) * 0.26, 0.02 + Math.cos(la) * 0.05, Math.cos(la) * 0.22 + 0.02], s: [0.06, 0.02, 0.11], r: [0.5, la, 0.3] }); }
    }
    neck.add(nb.build());
    var head = pivot(neck, nTip[0], nTip[1], nTip[2]);
    var hb = new Builder(), eyeC = P.eyes ? C(P.eyes) : null;
    hb.add(G.sph(0.18, 14, 10), coat, { p: [0, 0.03, 0.0], s: [0.95, 1.0, 1.15] });
    limb(hb, [0, 0.02, 0.05], [0, -0.16, 0.36], 0.14, 0.11, coat, 12);
    hb.add(G.sph(0.115, 12, 9), sh(coat, -0.08), { p: [0, -0.17, 0.37], s: [1, 0.85, 1.05] });
    hb.add(G.sph(0.11, 10, 8), P.blaze ? C('#f4ead8') : sh(coat, -0.18), { p: [0, -0.19, 0.39], s: [0.95, 0.7, 0.95] });
    [-1, 1].forEach(function (sx) {
      hb.add(G.sph(0.022, 6, 5), C('#1a1014'), { p: [sx * 0.05, -0.2, 0.47] });
      if (eyeC) hb.glow(G.sph(0.045, 8, 6), eyeC, { p: [sx * 0.13, 0.06, 0.08], s: [0.6, 0.8, 1] });
      else { hb.add(G.sph(0.045, 8, 6), C('#1a1014'), { p: [sx * 0.135, 0.06, 0.08], s: [0.6, 1, 1] }); hb.add(G.sph(0.014, 5, 4), C('#ffffff'), { p: [sx * 0.155, 0.08, 0.1] }); }
      hb.add(G.cone(0.055, P.slim ? 0.2 : 0.16, 6), coat, { p: [sx * 0.08, 0.2, -0.04], r: [-0.2, 0, -sx * 0.35], s: [1, 1, 0.6] });
      hb.add(G.cone(0.03, 0.1, 5), sh(coat, -0.35), { p: [sx * 0.082, 0.2, -0.02], r: [-0.2, 0, -sx * 0.35], s: [1, 1, 0.4] });
    });
    if (P.blaze) hb.add(G.sph(1, 8, 6), C('#f4ead8'), { p: [0, 0.03, 0.17], s: [0.04, 0.1, 0.03], r: [0.5, 0, 0] });
    // bridle
    hb.add(G.tor(0.13, 0.014, 4, 16), sh(sadC, -0.25), { p: [0, -0.1, 0.25], r: [0.55, 0, 0], s: [1, 1.05, 1] });
    hb.add(G.tor(0.17, 0.014, 4, 16), sh(sadC, -0.25), { p: [0, 0.05, 0.04], r: [-0.25 + PI / 2 * 0, PI / 2, 0], s: [1, 1, 1] });
    gemPart(hb, G.oct(0.035), tier >= 1 ? gemC : sh(sadC, 0.2), tier, { p: [0, 0.12, 0.13], s: [1, 1.3, 0.6], r: [-0.4, 0, 0] });
    if (!P.flame) {
      for (var f = 0; f < (P.fluffy ? 4 : 2); f++) hb.add(G.cone(P.fluffy ? 0.07 : 0.05, P.fluffy ? 0.2 : 0.15, 6), maneC, { p: [(f - 0.5) * 0.04, 0.15, 0.05], r: [0.9 + f * 0.1, 0, (f - 1) * 0.2] });
    } else hb.glow(G.cone(0.06, 0.22, 6), sh(maneC, 0.3), { p: [0, 0.16, 0.04], r: [0.5, 0, 0] });
    if (P.barding) {   // chanfron + plume
      hb.add(G.box(0.12, 0.08, 0.34), C('#c9ced6'), { p: [0, 0.0, 0.18], r: [0.55, 0, 0] });
      hb.add(G.cone(0.03, 0.12, 5), C('#ffd76a'), { p: [0, 0.1, 0.12], r: [0.2, 0, 0] });
      hb.add(G.taper([[0, 0.2, -0.02], [0, 0.4, -0.08], [0, 0.48, -0.25], [0, 0.42, -0.4]], 0.06, 0.015, 12, 6), trimC);
    }
    if (P.antlers) {
      var ant = C('#e8dcc0'), thornC = C('#5a3a22');
      [-1, 1].forEach(function (sx) {
        hb.add(G.taper([[sx * 0.07, 0.18, -0.02], [sx * 0.16, 0.36, -0.06], [sx * 0.24, 0.55, -0.02], [sx * 0.28, 0.72, 0.06]], 0.035, 0.012, 12, 6), ant);
        hb.add(G.taper([[sx * 0.15, 0.34, -0.05], [sx * 0.26, 0.4, 0.06], [sx * 0.32, 0.5, 0.1]], 0.022, 0.008, 8, 5), ant);
        hb.add(G.taper([[sx * 0.23, 0.53, -0.02], [sx * 0.36, 0.6, -0.08], [sx * 0.42, 0.7, -0.06]], 0.02, 0.007, 8, 5), ant);
        hb.add(G.taper([[sx * 0.2, 0.46, -0.04], [sx * 0.2, 0.6, -0.15], [sx * 0.16, 0.7, -0.2]], 0.018, 0.006, 8, 5), ant);
        for (var th = 0; th < 4; th++) hb.add(G.cone(0.012, 0.05, 4), thornC, { p: [sx * (0.12 + th * 0.045), 0.28 + th * 0.12, -0.04], r: [0, 0, -sx * 1.2] });
        if (tier >= 3) { hb.glow(G.oct(0.025), gemC, { p: [sx * 0.28, 0.72, 0.06] }); hb.glow(G.oct(0.02), gemC, { p: [sx * 0.42, 0.7, -0.06] }); }
      });
    }
    head.add(hb.build({ receive: false }));
    if (tier >= 2) addHalo(halos, head, [0, 0.12, 0.17], gemC, 0.26);

    // ---- tail ----
    var tail1 = pivot(torso, 0, 0.24 * st, -0.82);
    var tail2 = pivot(tail1, 0, -0.32, -0.16);
    var tb = new Builder(), tb2 = new Builder(), tailC = P.flame ? null : maneC;
    if (P.antlers) {
      tb.add(G.sph(0.09, 8, 6), C('#f4ead8'), { p: [0, -0.04, -0.04], s: [1, 1.3, 0.8] });
    } else if (tailC) {
      tb.add(G.taper([[0, 0, 0], [0, -0.12, -0.1], [0, -0.32, -0.16]], 0.075, 0.07, 8, 7), tailC);
      tb2.add(G.taper([[0, 0, 0], [0, -0.2, -0.04], [0, -0.42, 0.02]], P.fluffy ? 0.12 : 0.09, 0.03, 10, 8), sh(tailC, -0.05));
      tb2.add(G.taper([[0.03, -0.02, 0], [0.05, -0.22, -0.06], [0.04, -0.38, 0.0]], 0.06, 0.02, 8, 6), sh(tailC, 0.1));
    } else {
      tb.glow(G.taper([[0, 0, 0], [0, -0.12, -0.1], [0, -0.32, -0.16]], 0.07, 0.06, 8, 6), sh(maneC, 0.2));
      tb2.glow(G.taper([[0, 0, 0], [0, -0.2, -0.04], [0, -0.42, 0.02]], 0.09, 0.02, 10, 6), maneC);
    }
    tail1.add(tb.build()); if (!P.antlers) tail2.add(tb2.build());

    // ---- legs ----
    var legs = [];
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (L) {
      var sx = L[0], front = L[1] > 0;
      var up = pivot(torso, sx * 0.2 * st, front ? -0.2 : -0.16, front ? 0.52 : -0.55);
      var upLen = (front ? 0.46 : 0.48) * LG, loLen = 0.4 * LG;
      var ub = new Builder(), thick = (P.slim ? 0.78 : 1) * (kind === 'warhorse' ? 1.15 : 1);
      ub.add(G.sph(1, 12, 9), coat, { p: [0, -0.04, front ? 0.0 : -0.02], s: [0.15 * st, front ? 0.22 : 0.27, front ? 0.17 : 0.22] });
      limb(ub, [0, -0.05, 0], [0, -upLen, front ? 0.0 : -0.04], 0.11 * thick, 0.07 * thick, front ? coat : sh(coat, -0.04), 10);
      up.add(ub.build());
      var lo = pivot(up, 0, -upLen, front ? 0.0 : -0.04);
      var lb = new Builder();
      lb.add(G.sph(0.07 * thick, 8, 6), legC, {});
      limb(lb, [0, 0, 0], [0, -loLen, 0], 0.055 * thick, 0.048 * thick, legC, 9);
      lb.add(G.sph(0.065 * thick, 8, 6), legC, { p: [0, -loLen, 0.01] });
      lo.add(lb.build());
      var hf = pivot(lo, 0, -loLen, 0.01);
      var hfb = new Builder(), hy = -(bodyH + (front ? -0.2 : -0.16) - upLen - loLen);
      if (P.antlers) {
        [-1, 1].forEach(function (s2) { hfb.add(G.cone(0.035, 0.1, 5), hoofC, { p: [s2 * 0.025, hy + 0.05, 0.02], r: [PI, 0, 0] }); });
      } else {
        limb(hfb, [0, 0, 0.0], [0, hy + 0.09, 0.02], 0.05 * thick, 0.058 * thick, legC, 8);
        hfb.add(G.cyl(0.064 * thick, 0.084 * thick, 0.1, 10), hoofC, { p: [0, hy + 0.05, 0.02] });
        if (P.feathers || P.fluffy) hfb.add(G.cone(0.1 * thick, 0.14, 8), P.fluffy ? maneC : C('#f4ead8'), { p: [0, hy + 0.13, 0.0], r: [PI, 0, 0] });
      }
      if (P.hoofGlow) { hfb.glow(G.tor(0.08 * thick, 0.018, 4, 12), C(P.hoofGlow), { p: [0, hy + 0.1, 0.015], r: [PI / 2, 0, 0] }); }
      hf.add(hfb.build());
      legs.push({ up: up, lo: lo, hf: hf, front: front, sx: sx, hy: hy });
    });

    // ---- particles: flame mane (on the neck, follows it) + rarity aura ----
    var parts = [];
    if (P.flame) {
      var fk = 'flame', fcols = P.flame === 'fire' ? ['#ffc02a', '#ff7a1a', '#ff4a10', '#ffe060'] : ['#b47aff', '#8a3aff', '#5a18c0', '#d8b0ff'];
      var fp = X1.auraPoints(fk, 30, fcols, function (i, r) { var u = r(); return [(r() - 0.5) * 0.06, lerp(0.16, nTip[1] + 0.12, u), lerp(-0.12, nTip[2] - 0.06, u)]; }, 77);
      neck.add(fp); parts.push(fp);
    }
    var aura = auraFor(kind, tier, gemC, function (A) { return function (i, r) { var a = r() * TAU, rr = 0.55 + r() * 0.35; return [Math.sin(a) * rr * 0.8, A.mode === 0 || A.mode === 4 ? r() * 0.6 : 0.2 + r() * 1.6, Math.cos(a) * rr * 1.3]; }; });
    if (aura) { scaler.add(aura); parts.push(aura); }
    if (P.hoofGlow) legs.forEach(function (L) { addHalo(halos, L.hf, [0, L.hy + 0.08, 0.02], C(P.hoofGlow), 0.38); });
    if (P.eyes) [-1, 1].forEach(function (sx) { addHalo(halos, head, [sx * 0.14, 0.06, 0.09], C(P.eyes), 0.2); });

    // ---------------- animation ----------------
    var joints = [torso, neck, head, tail1, tail2];
    legs.forEach(function (L) { joints.push(L.up, L.lo, L.hf); });
    var poser = new Poser(joints);
    var spT = new X1.Spring(40, 5), trT = new X1.VelTrack(tail1, root);
    function legCycle(L, p, D, A, F, w) {
      var hip, knee, fl;
      p = p - Math.floor(p);
      if (p < D) { var u = p / D; hip = lerp(-A, A, u); knee = 0.04; fl = -0.05; }
      else { var v = (p - D) / (1 - D), e = easeIO(v), bb = bell(v); hip = lerp(A, -A, e) - 0.12 * bb; knee = (L.front ? 1 : -0.8) * F * bb; fl = (L.front ? 0.9 : 0.6) * F * bb; }
      L.up.rotation.x += hip * w; L.lo.rotation.x += knee * w; L.hf.rotation.x += fl * w;
    }
    // leg order: [LF, RF, LH, RH]
    function idle(t, w) {
      var br = Math.sin(t * 1.6);
      torso.scale.x += br * 0.01 * w; torso.scale.y += br * 0.012 * w;
      neck.rotation.x += (Math.sin(t * 0.9) * 0.04) * w; head.rotation.x += Math.sin(t * 0.9 + 1) * 0.05 * w;
      tail1.rotation.z += Math.sin(t * 2.3) * 0.25 * w; tail1.rotation.x += 0.1 * w;
      torso.rotation.z += Math.sin(t * 0.5) * 0.015 * w;
      // fidgets: head toss / paw the ground / look aside
      var Lc = 8, u = t / Lc, si = Math.floor(u), f = (u - si) * Lc, kindF = Math.floor(hash01(si * 3.7 + 11) * 4);
      var env = smooth(1, 1.4, f) * (1 - smooth(2.6, 3.0, f)) * w;
      if (env > 0) {
        if (kindF === 1) { var s = Math.sin((f - 1) * 9); neck.rotation.x += (-0.25 + s * 0.12) * env; head.rotation.x += s * 0.15 * env; }
        else if (kindF === 2) { var ps = Math.max(0, Math.sin((f - 1) * 6)); legs[0].up.rotation.x += -0.5 * ps * env; legs[0].lo.rotation.x += 1.1 * ps * env; }
        else if (kindF === 3) { neck.rotation.y += 0.45 * env; head.rotation.y += 0.3 * env; head.rotation.z += 0.12 * env; }
      }
    }
    function walk(t, w) {
      var p = t * 1.25;
      var off = [0.25, 0.75, 0.0, 0.5];
      legs.forEach(function (L, i) { legCycle(L, p + off[i], 0.62, 0.36, 0.9, w); });
      var ph = p * TAU * 2;
      torso.position.y += Math.sin(ph) * 0.025 * w; torso.rotation.z += Math.sin(p * TAU) * 0.02 * w;
      neck.rotation.x += (0.05 + Math.sin(ph + 0.6) * 0.06) * w; head.rotation.x += -Math.sin(ph + 0.6) * 0.04 * w;
      tail1.rotation.z += Math.sin(p * TAU) * 0.15 * w;
    }
    function run(t, w) {
      var p = t * 2.3, off = [0.5, 0.62, 0.0, 0.12];
      legs.forEach(function (L, i) { legCycle(L, p + off[i], 0.38, 0.62, 1.5, w); });
      var ph = p * TAU;
      torso.position.y += (0.06 + Math.sin(ph - 0.9) * 0.08) * w;
      torso.rotation.x += Math.sin(ph - 0.3) * 0.1 * w;
      neck.rotation.x += (0.28 - Math.sin(ph + 0.4) * 0.14) * w; head.rotation.x += (-0.22 + Math.sin(ph + 0.4) * 0.12) * w;
      tail1.rotation.x += -0.9 * w; tail2.rotation.x += -0.4 * w; tail1.rotation.z += Math.sin(ph) * 0.1 * w;
    }
    var POSE = { idle: idle, walk: walk, run: run };
    root.userData.anim = function (t, state, dt) {
      t = t || 0; dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
      if (!POSE[state]) state = 'idle';
      var k = poser.begin(t, state, 0.25);
      poser.reset();
      POSE[state](t, 1);
      poser.finish(t);
      var v = trT.update(dt);
      tail2.rotation.x += spT.step(clamp(v.z * 0.03, -0.3, 0.6), dt);
      for (var i = 0; i < halos.length; i++) { var h = halos[i], s2 = h.base * (1 + 0.08 * Math.sin(t * 5 + i) + (tier >= 4 ? 0.2 * Math.sin(t * 4 + i) : 0)); h.s.scale.set(s2, s2, 1); }
      for (var j = 0; j < parts.length; j++) parts[j].userData.t = t;
    };
    root.userData.seat = seat;
    root.userData.parts = { torso: torso, neck: neck, head: head, tail: tail1, legs: legs, seat: seat };
    root.userData.radius = 0.95 * P.s;
    root.userData.height = measureTop(root);
    root.userData.seatHeight = (bodyH + 0.47 * st) * P.s;
    return root;
  }

  // ------------------------------------------------------------------
  //  Mossback: a giant mossy toad you ride (crawl walk, hopping run)
  // ------------------------------------------------------------------
  function toadModel(kind, opts) {
    var P = TOAD.mossback;
    var coat = C(opts.coat || P.coat), moss = C(opts.mane || P.mane), sadC = C(opts.saddle || P.saddle), trimC = C(opts.trim || P.trim), gemC = C(opts.gem || P.gem), belly = C(P.belly);
    var tier = tierOf(opts), halos = [];
    var root = new T.Group(); root.name = 'mount_mossback';
    var scaler = pivot(root);
    var torso = pivot(scaler, 0, 0.8, 0);
    var paint = function (x, y, z, nx, ny, nz, out) {
      out.copy(coat).multiplyScalar(0.8 + 0.25 * smooth(-0.4, 0.4, y));
      if (y < -0.18) out.lerp(belly, smooth(-0.18, -0.4, y));
      if (y > 0.1 && hash01(Math.floor(x * 7) * 5.3 + Math.floor(z * 7) * 2.1) > 0.8) out.lerp(sh(coat, -0.3), 0.6);
    };
    var bod = new T.SphereGeometry(1, 24, 16); bod.scale(0.78, 0.52, 0.86);
    torso.add(vmesh(bod, paint));
    var b = new Builder(), r = K.seeded(5);
    // moss clumps + warts + mushrooms on the back (keeps the saddle area clear)
    for (var i = 0; i < 26; i++) {
      var a = r() * TAU, el = 0.25 + r() * 0.9, px = Math.cos(a) * Math.cos(el) * 0.76, pz = Math.sin(a) * Math.cos(el) * 0.84, py = Math.sin(el) * 0.5;
      if (Math.abs(px) < 0.3 && pz > -0.45 && pz < 0.3 && py > 0.3) continue;
      if (pz > 0.55) continue;
      b.add(G.sph(0.07 + r() * 0.07, 7, 5), r() > 0.4 ? moss : sh(moss, -0.25), { p: [px, py, pz], s: [1, 0.55, 1] });
    }
    [[0.48, 0.26, -0.45], [-0.52, 0.24, -0.3], [0.3, 0.38, -0.62]].forEach(function (m, k) {
      b.add(G.cyl(0.03, 0.04, 0.12, 6), C('#efe6cf'), { p: [m[0], m[1] + 0.06, m[2]] });
      b.add(G.hemi(0.09 - k * 0.012, 10, 5), C(k === 1 ? '#c9a24a' : '#d8452a'), { p: [m[0], m[1] + 0.11, m[2]], s: [1, 0.7, 1] });
      if (k !== 1) b.add(G.sph(0.016, 5, 4), C('#ffffff'), { p: [m[0] + 0.03, m[1] + 0.17, m[2] + 0.03] });
    });
    // saddle on the back
    var sy = 0.5;
    b.add(G.sph(1, 16, 8), trimC, { p: [0, sy - 0.04, -0.08], s: [0.42, 0.06, 0.46] });
    b.add(G.tor(1, 0.022, 4, 28), tier >= 1 ? C('#e8c25a') : sh(trimC, -0.3), { p: [0, sy - 0.02, -0.08], r: [PI / 2, 0, 0], s: [0.42, 0.46, 1] });
    b.add(G.sph(1, 14, 10), sadC, { p: [0, sy + 0.04, -0.08], s: [0.26, 0.1, 0.32] });
    b.add(G.sph(0.08, 8, 6), sh(sadC, -0.1), { p: [0, sy + 0.1, 0.18] });
    b.add(G.tor(0.15, 0.04, 6, 14, PI), sh(sadC, -0.15), { p: [0, sy + 0.05, -0.34] });
    [-1, 1].forEach(function (sx) {
      b.add(G.box(0.03, 0.4, 0.05), sh(sadC, -0.3), { p: [sx * 0.46, sy - 0.2, -0.06], r: [0, 0, sx * 0.55] });
      b.add(G.tor(0.06, 0.016, 4, 10), C('#c9c2b0'), { p: [sx * 0.6, sy - 0.42, -0.06], r: [0, PI / 2, 0] });
    });
    if (tier >= 2) gemPart(b, G.oct(0.045), gemC, tier, { p: [0, sy + 0.12, 0.26], s: [1, 1.2, 0.6] });
    if (tier >= 3) b.glow(G.tor(1, 0.01, 4, 28), gemC, { p: [0, sy + 0.0, -0.08], r: [PI / 2, 0, 0], s: [0.45, 0.49, 1] });
    torso.add(b.build());
    if (tier >= 2) addHalo(halos, torso, [0, sy + 0.12, 0.3], gemC, 0.3);
    var seat = pivot(torso, 0, sy + 0.06, -0.08);
    // head (wide, eye bumps on top) + throat pouch
    var head = pivot(torso, 0, 0.04, 0.6);
    var hb = new Builder();
    var hg = new T.SphereGeometry(1, 20, 12); hg.scale(0.6, 0.34, 0.46);
    head.add(vmesh(hg, paint, { p: [0, 0.02, 0.06] }));
    hb.add(G.tor(0.48, 0.02, 4, 24, PI * 0.9), C('#2a1a14'), { p: [0, -0.06, 0.1], r: [PI / 2, 0, PI * 0.05], s: [1, 0.85, 1] });
    var eyeGlow = tier >= 2 ? gemC : null;
    [-1, 1].forEach(function (sx) {
      hb.add(G.sph(0.14, 12, 9), coat, { p: [sx * 0.3, 0.26, 0.12] });
      hb.add(G.tor(0.11, 0.025, 5, 14), sh(coat, -0.2), { p: [sx * 0.3, 0.28, 0.2], r: [0.2, 0, 0] });
      if (eyeGlow) hb.glow(G.sph(0.085, 10, 8), C('#ffd23a'), { p: [sx * 0.3, 0.28, 0.21] });
      else hb.add(G.sph(0.085, 10, 8), C('#e8c84a'), { p: [sx * 0.3, 0.28, 0.21] });
      hb.add(G.sph(0.05, 8, 6), C('#1a1014'), { p: [sx * 0.3, 0.28, 0.27], s: [1.3, 0.55, 0.6] });
      hb.add(G.sph(0.016, 5, 4), C('#ffffff'), { p: [sx * 0.28, 0.31, 0.29] });
      hb.add(G.sph(0.02, 5, 4), C('#2a1a14'), { p: [sx * 0.09, 0.1, 0.5] });
    });
    // reins / bridle: a band behind the eyes
    hb.add(G.tor(0.47, 0.02, 4, 24, PI), sh(sadC, -0.2), { p: [0, 0.12, -0.05], r: [0, 0, 0], s: [1.05, 0.62, 1] });
    head.add(hb.build({ receive: false }));
    var throat = pivot(head, 0, -0.2, 0.2);
    var thb = new Builder(); thb.add(G.sph(1, 12, 8), belly, { s: [0.3, 0.16, 0.24] }); throat.add(thb.build());
    // legs: short front arms, big folded hind legs
    var legs = [];
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (L) {
      var sx = L[0], front = L[1] > 0, ub = new Builder(), lb = new Builder(), fb = new Builder();
      var up = pivot(torso, sx * (front ? 0.48 : 0.52), front ? -0.22 : -0.12, front ? 0.42 : -0.45);
      var lo, ft;
      if (front) {
        limb(ub, [0, 0, 0], [sx * 0.12, -0.3, 0.06], 0.13, 0.1, coat, 10);
        up.add(ub.build());
        lo = pivot(up, sx * 0.12, -0.3, 0.06);
        limb(lb, [0, 0, 0], [0, -0.26, 0.02], 0.09, 0.08, coat, 10);
        lo.add(lb.build());
        ft = pivot(lo, 0, -0.27, 0.02);
        fb.add(G.sph(1, 10, 6), sh(coat, 0.05), { p: [0, -0.0, 0.06], s: [0.13, 0.05, 0.13] });
        for (var tt = -1; tt <= 1; tt++) fb.add(G.sph(0.035, 6, 5), belly, { p: [tt * 0.07, -0.01, 0.18], s: [1, 0.8, 1.2] });
      } else {
        ub.add(G.sph(1, 14, 10), coat, { p: [sx * 0.06, -0.02, 0.06], s: [0.24, 0.24, 0.34], r: [0.4, 0, 0] });
        up.add(ub.build());
        lo = pivot(up, sx * 0.1, -0.14, 0.28);
        limb(lb, [0, 0, 0], [0, -0.42, -0.26], 0.11, 0.08, sh(coat, -0.05), 10);
        lo.add(lb.build());
        ft = pivot(lo, 0, -0.42, -0.26);
        fb.add(G.sph(1, 10, 6), sh(coat, 0.05), { p: [0, -0.0, 0.14], s: [0.15, 0.05, 0.24] });
        for (var t2 = -1; t2 <= 1; t2++) fb.add(G.sph(0.04, 6, 5), belly, { p: [t2 * 0.08, -0.01, 0.36], s: [1, 0.8, 1.2] });
      }
      ft.add(fb.build());
      legs.push({ up: up, lo: lo, hf: ft, front: front, sx: sx });
    });
    var parts = [];
    var aura = auraFor(kind, tier, gemC, function (A) { return function (i, r) { var a = r() * TAU, rr = 0.8 + r() * 0.3; return [Math.sin(a) * rr, A.mode === 0 || A.mode === 4 ? r() * 0.5 : 0.2 + r() * 1.4, Math.cos(a) * rr]; }; });
    if (aura) { scaler.add(aura); parts.push(aura); }

    var joints = [torso, head, throat];
    legs.forEach(function (L) { joints.push(L.up, L.lo, L.hf); });
    var poser = new Poser(joints);
    function idle(t, w) {
      var br = Math.sin(t * 1.3);
      torso.scale.y += br * 0.015 * w; torso.scale.x += br * 0.01 * w;
      head.rotation.x += Math.sin(t * 0.8) * 0.03 * w;
      var croak = Math.max(0, Math.sin(t * 2.4)) * (Math.sin(t * 0.37) > 0.3 ? 1 : 0);
      throat.scale.x += croak * 0.5 * w; throat.scale.y += croak * 0.8 * w; throat.scale.z += croak * 0.4 * w;
      var f = (t % 9) / 9, blink = f > 0.97 ? 1 : 0;
      head.rotation.y += Math.sin(t * 0.3) * 0.08 * w;
      torso.position.y += blink * 0;
    }
    function walk(t, w) {
      var p = t * 1.6, s = Math.sin(p * TAU);
      legs.forEach(function (L, i) {
        var ph = (i === 0 || i === 3) ? 0 : 0.5, q = p + ph, sw = Math.sin(q * TAU), lift = Math.max(0, Math.cos(q * TAU));
        L.up.rotation.x += -sw * (L.front ? 0.35 : 0.25) * w; L.up.rotation.z += L.sx * lift * 0.25 * w;
        L.lo.rotation.x += (L.front ? 0.3 : -0.2) * lift * w;
      });
      torso.rotation.z += s * 0.06 * w; torso.rotation.y += s * 0.05 * w; torso.position.y += Math.abs(s) * 0.03 * w;
      head.rotation.y += -s * 0.06 * w;
    }
    function run(t, w) {
      var p = (t * 1.5) % 1;
      var crouch = bell(segK(p, 0.0, 0.22)) * (p < 0.22 ? 1 : 0), air = bell(segK(p, 0.18, 0.82)), land = bell(segK(p, 0.8, 1.0));
      var up = air;
      torso.position.y += (-0.12 * crouch + 0.55 * up - 0.1 * land) * w;
      torso.rotation.x += (-0.25 * Math.sin(segK(p, 0.18, 0.82) * PI * 2) * up * 0.8 + 0.1 * crouch) * w;
      torso.scale.y += (-0.1 * crouch + 0.06 * up - 0.12 * land) * w;
      legs.forEach(function (L) {
        if (L.front) { L.up.rotation.x += (-0.7 * up + 0.2 * crouch) * w; L.lo.rotation.x += (0.2 * up) * w; }
        else { L.up.rotation.x += (0.9 * up - 0.2 * crouch) * w; L.lo.rotation.x += (-0.7 * up) * w; L.hf.rotation.x += 0.6 * up * w; }
      });
      head.rotation.x += -0.15 * up * w; throat.scale.y += 0.3 * up * w;
    }
    var POSE = { idle: idle, walk: walk, run: run };
    root.userData.anim = function (t, state, dt) {
      t = t || 0;
      if (!POSE[state]) state = 'idle';
      poser.begin(t, state, 0.25); poser.reset(); POSE[state](t, 1); poser.finish(t);
      for (var i = 0; i < halos.length; i++) { var h = halos[i], s2 = h.base * (1 + 0.08 * Math.sin(t * 5 + i)); h.s.scale.set(s2, s2, 1); }
      for (var j = 0; j < parts.length; j++) parts[j].userData.t = t;
    };
    root.userData.seat = seat;
    root.userData.parts = { torso: torso, head: head, throat: throat, legs: legs, seat: seat };
    root.userData.radius = 1.05;
    root.userData.height = measureTop(root);
    root.userData.seatHeight = 0.8 + sy + 0.06;
    return root;
  }

  // ------------------------------------------------------------------
  // ---- v1.2 WS6: kind 'strider' — the Orrery Strider (mount_orrery_strider), a brass mechanical stag.
  //  Riveted brass plates, a caged star-core in the chest, turning cogs on the flanks, piston legs with
  //  steel shins and cloven brass hooves, a segmented neck with fin plates, an angular brass head with
  //  glowing eyes and branching brass antlers tipped with crystals. opts: coat = brass, mane = fins,
  //  saddle, trim = blanket, gem = core / eyes / crystals, rarity. Same rig, gaits and seat as the horses.
  // ------------------------------------------------------------------
  function striderModel(opts) {
    var brass = C(opts.coat || '#c99a3e'), fin = C(opts.mane || '#9a6a2c'), sadC = C(opts.saddle || '#5a3420'), trimC = C(opts.trim || '#2a3a6e'), gemC = C(opts.gem || '#8feaff');
    var steel = C('#4a4858'), steelL = C('#8a8e9c'), brassD = sh(brass, -0.34), brassL = sh(brass, 0.16), tier = tierOf(opts), halos = [], spins = [];
    var cog = X1.cogParts, star4 = X1.star4, rbox = X1.rbox, LG = 1.1, st = 0.92;
    var root = new T.Group(); root.name = 'mount_strider';
    var scaler = pivot(root); scaler.scale.setScalar(1.02);
    var bodyH = 0.24 + 0.98 * LG, torso = pivot(scaler, 0, bodyH, 0), i, a;
    // ---- plated barrel (seams every 0.2 along the body), chest, haunch, riveted bands
    var paint = function (x, y, z, nx, ny, nz, out) { var v = smooth(-0.42, 0.3, y); out.copy(brass).multiplyScalar(0.7 + 0.32 * v); var sz = Math.abs(((z + 2) * 5) % 1 - 0.5); if (sz < 0.07) out.multiplyScalar(0.68); };
    var barrel = new T.SphereGeometry(1, 26, 14); barrel.scale(0.35 * st, 0.37 * st, 0.8);
    torso.add(vmesh(barrel, paint));
    var b = new Builder();
    b.add(G.sph(1, 16, 12), brass, { p: [0, 0.05, 0.5], s: [0.34 * st, 0.38 * st, 0.36] });
    b.add(G.sph(1, 16, 12), brassD, { p: [0, 0.06, -0.55], s: [0.38 * st, 0.38 * st, 0.4] });
    [0.32, -0.04, -0.36].forEach(function (z) {
      var rr = Math.sqrt(Math.max(0.05, 1 - (z / 0.8) * (z / 0.8)));
      b.add(G.tor(1, 0.022, 4, 30), brassD, { p: [0, 0, z], s: [0.355 * st * rr, 0.375 * st * rr, 1] });
      for (var rv = 0; rv < 10; rv++) { var ra = rv * TAU / 10; b.add(G.sph(0.016, 5, 4), brassL, { p: [Math.cos(ra) * 0.37 * st * rr, Math.sin(ra) * 0.39 * st * rr, z] }); }
    });
    // chest: a caged star-core
    b.add(G.tor(0.15, 0.03, 5, 18), brassD, { p: [0, 0.02, 0.84] });
    for (i = 0; i < 4; i++) b.add(G.box(0.018, 0.26, 0.03), brassL, { p: [(i - 1.5) * 0.06, 0.02, 0.86] });
    X1.gemPart(b, G.sph(0.12, 14, 10), gemC, Math.max(2, tier), { p: [0, 0.02, 0.79] });
    // back vents + saddle, blanket, girth, stirrups
    [-1, 1].forEach(function (sx) { b.add(G.cyl(0.05, 0.06, 0.16, 10), brassD, { p: [sx * 0.12, 0.34 * st, -0.5], r: [-0.4, 0, 0] }); b.add(G.cyl(0.035, 0.035, 0.02, 10), '#1a1418', { p: [sx * 0.12, 0.42 * st, -0.54], r: [-0.4, 0, 0] }); });
    var blanket = new T.CylinderGeometry(0.42 * st, 0.42 * st, 0.68, 16, 1, true, PI - 1.15, 2.3); blanket.rotateX(PI / 2);
    b.add(blanket, trimC, { p: [0, 0.0, -0.06] });
    var edge = tier >= 1 ? C(opts.trim ? sh(trimC, 0.35) : '#ffd76a') : sh(trimC, -0.3);
    [0.34, -0.34].forEach(function (zz) { var e2 = new T.TorusGeometry(0.425 * st, 0.018, 4, 18, 2.3); e2.rotateZ(PI / 2 - 1.15); b.add(e2, edge, { p: [0, 0, -0.06 + zz] }); });
    b.add(G.sph(1, 14, 10), sadC, { p: [0, 0.41 * st, -0.08], s: [0.27, 0.1, 0.34] });
    b.add(G.sph(0.085, 10, 8), sh(sadC, -0.1), { p: [0, 0.47 * st, 0.2], s: [1, 1.1, 0.9] });
    b.add(G.tor(0.15, 0.04, 6, 14, PI), sh(sadC, -0.15), { p: [0, 0.42 * st, -0.32] });
    [-1, 1].forEach(function (sx) {
      b.add(G.box(0.03, 0.4, 0.05), sh(sadC, -0.3), { p: [sx * 0.41 * st, 0.19 * st, -0.02], r: [0, 0, sx * 0.16] });
      b.add(G.tor(0.06, 0.016, 4, 10), brassL, { p: [sx * 0.45 * st, -0.03, -0.02], r: [0, PI / 2, 0] });
    });
    if (tier >= 3) { var rl = new T.TorusGeometry(0.427 * st, 0.008, 4, 18, 2.3); rl.rotateZ(PI / 2 - 1.15); b.glow(rl, gemC, { p: [0, 0, -0.06] }); }
    torso.add(b.build());
    addHalo(halos, torso, [0, 0.02, 0.92], gemC, 0.45);
    // flank cogs (turn faster with the gait)
    [-1, 1].forEach(function (sx) {
      var cp = pivot(torso, sx * 0.335 * st, 0.02, -0.08); cp.rotation.y = sx * PI / 2;
      var cs = pivot(cp), cb = new Builder();
      cog(cb, 0.17, 12, 0.03, brassL, brassD, tier >= 3 ? gemC : null);
      X1.gemPart(cb, G.sph(0.03, 8, 6), gemC, tier, { p: [0, 0, 0.025] });
      cs.add(cb.build()); spins.push({ o: cs, d: sx });
      var cs2 = pivot(cp, 0.2, 0.13, -0.005), cb2 = new Builder(); cog(cb2, 0.08, 8, 0.025, brass, brassD, null, { spokes: 2 }); cs2.add(cb2.build()); spins.push({ o: cs2, d: -sx * 2.1 });
    });
    var seat = pivot(torso, 0, 0.44 * st, -0.17);
    seat.scale.setScalar(1 / 1.02);
    // ---- neck: stacked brass rings on a steel spine, fin plates along the top
    var neck = pivot(torso, 0, 0.22 * st, 0.6);
    var nb = new Builder(), nd = [0, 0.8, 0.58], nl = 0.82, nTip = [0, nd[1] * nl, nd[2] * nl];
    limb(nb, [0, -0.06, -0.04], nTip, 0.08, 0.06, steel, 10);
    for (i = 0; i < 5; i++) {
      var u = (i + 0.4) / 5, pr = [0, lerp(-0.02, nTip[1], u), lerp(-0.02, nTip[2], u)], rad = lerp(0.2, 0.12, u);
      nb.add(G.cyl(rad, rad * 1.06, 0.1, 14), i % 2 ? brass : brassL, { p: pr, dir: [0, 0.8, 0.58] });
      nb.add(G.tor(rad * 1.05, 0.012, 4, 14).rotateX(PI / 2), brassD, { p: pr, dir: [0, 0.8, 0.58] });
    }
    nb.add(G.sph(0.21, 12, 9), brass, { p: [0, 0.0, 0.0] });
    for (i = 0; i < 6; i++) { var fu = (i + 0.3) / 6; nb.add(rbox(0.022, 0.13 - i * 0.01, 0.085, 0.008), i % 2 ? fin : sh(fin, 0.15), { p: [0, lerp(0.15, nTip[1] + 0.05, fu), lerp(-0.13, nTip[2] - 0.12, fu)], r: [-0.9 + fu * 0.4, 0, 0] }); }
    neck.add(nb.build());
    // ---- head: angular brass mask, glowing eyes, ears, branching antlers with crystal tips
    var head = pivot(neck, nTip[0], nTip[1], nTip[2]);
    var hb = new Builder();
    hb.add(rbox(0.24, 0.22, 0.3, 0.05), brass, { p: [0, 0.03, 0.02] });
    hb.add(rbox(0.16, 0.13, 0.32, 0.04), brassL, { p: [0, -0.1, 0.26], r: [0.45, 0, 0] });
    hb.add(rbox(0.13, 0.05, 0.26, 0.02), brassD, { p: [0, -0.02, 0.24], r: [0.45, 0, 0] });
    hb.add(G.box(0.12, 0.03, 0.06), '#1a1418', { p: [0, -0.19, 0.39], r: [0.45, 0, 0] });
    [-1, 1].forEach(function (sx) {
      hb.glow(G.sph(0.04, 10, 8), gemC, { p: [sx * 0.12, 0.06, 0.12], s: [0.6, 0.75, 1] });
      hb.add(G.tor(0.045, 0.012, 4, 12), brassD, { p: [sx * 0.122, 0.06, 0.12], r: [0, sx * PI / 2, 0] });
      hb.add(G.cone(0.05, 0.2, 4), brassD, { p: [sx * 0.1, 0.2, -0.08], r: [-0.3, 0, -sx * 0.6], s: [1, 1, 0.4] });
      // antlers
      var ant = tier >= 1 ? brassL : brass;
      hb.add(G.cyl(0.04, 0.04, 0.05, 10), brassD, { p: [sx * 0.07, 0.17, -0.02] });
      hb.add(G.taper([[sx * 0.07, 0.18, -0.02], [sx * 0.16, 0.36, -0.07], [sx * 0.24, 0.55, -0.03], [sx * 0.28, 0.74, 0.06]], 0.03, 0.012, 12, 6), ant);
      hb.add(G.taper([[sx * 0.15, 0.34, -0.06], [sx * 0.27, 0.41, 0.06], [sx * 0.33, 0.51, 0.1]], 0.02, 0.008, 8, 5), ant);
      hb.add(G.taper([[sx * 0.23, 0.53, -0.03], [sx * 0.37, 0.6, -0.09], [sx * 0.43, 0.7, -0.07]], 0.018, 0.007, 8, 5), ant);
      hb.add(G.taper([[sx * 0.2, 0.46, -0.05], [sx * 0.2, 0.6, -0.16], [sx * 0.16, 0.7, -0.21]], 0.016, 0.006, 8, 5), ant);
      [[sx * 0.28, 0.74, 0.06], [sx * 0.33, 0.51, 0.1], [sx * 0.43, 0.7, -0.07], [sx * 0.16, 0.7, -0.21]].forEach(function (tp) { X1.gemPart(hb, G.oct(0.028), gemC, tier, { p: tp, s: [1, 1.5, 1] }); });
      cog(hb, 0.035, 7, 0.016, brassL, null, null, { p: [sx * 0.15, 0.33, -0.06], r: [0, sx * PI / 2, 0], spokes: 2 });
    });
    star4(hb, [0, 0.12, 0.172], [0, 0.3, 1], 0.05, tier >= 2 ? gemC : brassL, tier >= 2);
    head.add(hb.build({ receive: false }));
    [-1, 1].forEach(function (sx) { addHalo(halos, head, [sx * 0.13, 0.06, 0.14], gemC, 0.2); });
    // ---- tail: a little fan of brass blades
    var tail1 = pivot(torso, 0, 0.26 * st, -0.8), tail2 = pivot(tail1, 0, -0.06, -0.06), tb = new Builder();
    for (i = 0; i < 3; i++) tb.add(rbox(0.035, 0.2, 0.07, 0.012), i === 1 ? fin : sh(fin, 0.12), { p: [(i - 1) * 0.05, 0.06, -0.06], r: [-0.6, 0, (i - 1) * 0.35] });
    tail2.add(tb.build());
    // ---- piston legs
    var legs = [];
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (L) {
      var sx = L[0], front = L[1] > 0;
      var up = pivot(torso, sx * 0.2 * st, front ? -0.18 : -0.15, front ? 0.5 : -0.55);
      var upLen = (front ? 0.46 : 0.48) * LG, loLen = 0.4 * LG;
      var ub = new Builder();
      ub.add(G.sph(1, 12, 9), front ? brass : brassD, { p: [0, -0.04, 0], s: [0.14 * st, front ? 0.2 : 0.25, front ? 0.16 : 0.21] });
      limb(ub, [0, -0.05, 0], [0, -upLen, front ? 0.0 : -0.04], 0.085, 0.06, brass, 10);
      limb(ub, [sx * 0.07, -0.08, 0.04], [sx * 0.06, -upLen + 0.06, 0.03], 0.016, 0.016, steelL, 6);
      ub.add(G.cyl(0.028, 0.028, 0.14, 8), brassD, { p: [sx * 0.07, -0.16, 0.04] });
      up.add(ub.build());
      var lo = pivot(up, 0, -upLen, front ? 0.0 : -0.04), lb = new Builder();
      lb.add(G.sph(0.065, 10, 8), steel, {});
      limb(lb, [0, 0, 0], [0, -loLen, 0], 0.035, 0.032, steelL, 8);
      lb.add(G.cyl(0.05, 0.05, 0.12, 10), brassD, { p: [0, -loLen * 0.45, 0] });
      lb.add(G.sph(0.05, 8, 6), steel, { p: [0, -loLen, 0.01] });
      lo.add(lb.build());
      var hf = pivot(lo, 0, -loLen, 0.01), hfb = new Builder(), hy = -(bodyH + (front ? -0.18 : -0.15) - upLen - loLen);
      limb(hfb, [0, 0, 0.0], [0, hy + 0.1, 0.02], 0.032, 0.04, steel, 8);
      [-1, 1].forEach(function (s2) { hfb.add(G.cone(0.045, 0.12, 6), brassL, { p: [s2 * 0.03, hy + 0.06, 0.03], r: [PI, 0, 0] }); });
      hfb.add(G.tor(0.055, 0.012, 4, 12), brassD, { p: [0, hy + 0.12, 0.02], r: [PI / 2, 0, 0] });
      if (tier >= 3) hfb.glow(G.tor(0.058, 0.007, 4, 12), gemC, { p: [0, hy + 0.135, 0.02], r: [PI / 2, 0, 0] });
      hf.add(hfb.build());
      legs.push({ up: up, lo: lo, hf: hf, front: front, sx: sx, hy: hy });
    });
    // ---- rarity aura (legendary: forge sparks)
    var parts = [];
    var aura = auraFor('strider', tier, gemC, function (A) { return function (i2, r) { var a2 = r() * TAU, rr2 = 0.55 + r() * 0.35; return [Math.sin(a2) * rr2 * 0.8, A.mode === 0 || A.mode === 4 ? r() * 0.6 : 0.2 + r() * 1.6, Math.cos(a2) * rr2 * 1.3]; }; });
    if (aura) { scaler.add(aura); parts.push(aura); }
    // ---------------- animation (the horse gaits, a mechanical head tick, cogs that turn with the pace) ----------------
    var joints = [torso, neck, head, tail1, tail2];
    legs.forEach(function (L) { joints.push(L.up, L.lo, L.hf); });
    var poser = new Poser(joints), spinA = 0;
    function legCycle(L, p, D, A2, F, w) {
      var hip, knee, fl;
      p = p - Math.floor(p);
      if (p < D) { var u2 = p / D; hip = lerp(-A2, A2, u2); knee = 0.04; fl = -0.05; }
      else { var v2 = (p - D) / (1 - D), e = easeIO(v2), bb = bell(v2); hip = lerp(A2, -A2, e) - 0.12 * bb; knee = (L.front ? 1 : -0.8) * F * bb; fl = (L.front ? 0.9 : 0.6) * F * bb; }
      L.up.rotation.x += hip * w; L.lo.rotation.x += knee * w; L.hf.rotation.x += fl * w;
    }
    function idle(t, w) {
      var br = Math.sin(t * 1.4);
      torso.scale.y += br * 0.006 * w;
      // clockwork glances: the head snaps between set angles (quick ease, then holds)
      var LOOK = [0, 0.38, 0.1, -0.32, 0, -0.12], u = t * 0.45, si = Math.floor(u), tk = smooth(0, 0.12, u - si);
      var ya = lerp(LOOK[(si + 5) % 6], LOOK[si % 6], tk);
      neck.rotation.y += ya * 0.4 * w; head.rotation.y += ya * 0.6 * w; head.rotation.z += -ya * 0.12 * w;
      neck.rotation.x += Math.sin(t * 0.9) * 0.04 * w; head.rotation.x += Math.sin(t * 2.2) * 0.02 * w;
      tail1.rotation.z += Math.sin(t * 2.6) * 0.2 * w;
      // now and then it paws the ground with a front hoof
      var Lc = 9, uu = t / Lc, sj = Math.floor(uu), f = (uu - sj) * Lc;
      if (hash01(sj * 5.3 + 7) > 0.5) { var env = smooth(1, 1.3, f) * (1 - smooth(2.4, 2.8, f)) * w, ps = Math.max(0, Math.sin((f - 1) * 7)); legs[0].up.rotation.x += -0.5 * ps * env; legs[0].lo.rotation.x += 1.1 * ps * env; }
    }
    function walk(t, w) {
      var p = t * 1.25, off = [0.25, 0.75, 0.0, 0.5];
      legs.forEach(function (L, n) { legCycle(L, p + off[n], 0.62, 0.36, 0.9, w); });
      var ph = p * TAU * 2;
      torso.position.y += Math.sin(ph) * 0.022 * w; neck.rotation.x += (0.04 + Math.sin(ph + 0.6) * 0.05) * w; head.rotation.x += -Math.sin(ph + 0.6) * 0.04 * w;
      tail1.rotation.z += Math.sin(p * TAU) * 0.15 * w;
    }
    function run(t, w) {
      var p = t * 2.3, off = [0.5, 0.62, 0.0, 0.12];
      legs.forEach(function (L, n) { legCycle(L, p + off[n], 0.38, 0.62, 1.5, w); });
      var ph = p * TAU;
      torso.position.y += (0.06 + Math.sin(ph - 0.9) * 0.08) * w; torso.rotation.x += Math.sin(ph - 0.3) * 0.09 * w;
      neck.rotation.x += (0.26 - Math.sin(ph + 0.4) * 0.12) * w; head.rotation.x += (-0.2 + Math.sin(ph + 0.4) * 0.1) * w;
      tail1.rotation.x += -0.7 * w;
    }
    var POSE = { idle: idle, walk: walk, run: run }, lastT = null;
    root.userData.anim = function (t, state, dt) {
      t = t || 0; dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
      if (!POSE[state]) state = 'idle';
      poser.begin(t, state, 0.25); poser.reset(); POSE[state](t, 1); poser.finish(t);
      spinA += dt * (state === 'run' ? 6 : state === 'walk' ? 2.6 : 0.7);
      for (var q = 0; q < spins.length; q++) spins[q].o.rotation.z = spinA * spins[q].d;
      for (var h = 0; h < halos.length; h++) { var hh = halos[h], s2 = hh.base * (1 + 0.08 * Math.sin(t * 5 + h) + (tier >= 4 ? 0.2 * Math.sin(t * 4 + h) : 0)); hh.s.scale.set(s2, s2, 1); }
      for (var j = 0; j < parts.length; j++) parts[j].userData.t = t;
    };
    root.userData.seat = seat;
    root.userData.parts = { torso: torso, neck: neck, head: head, tail: tail1, legs: legs, seat: seat };
    root.userData.radius = 0.95;
    root.userData.height = measureTop(root);
    root.userData.seatHeight = (bodyH + 0.45 * st) * 1.02;
    return root;
  }

  // rarity aura: epic = sparkle motes, legendary = kind flavour; null below epic
  function auraFor(kind, tier, gemC, anchorFor) {
    if (tier < 3) return null;
    var fk = tier >= 4 ? (AURA_KIND[kind] || X1.fxOf({ gem: '#' + gemC.getHexString() })) : 'sparkle';
    var A = X1.AURA[fk];
    var n = tier >= 4 ? Math.min(A.n, 36) : 12;
    return X1.auraPoints(fk, n, tier >= 4 ? X1.auraColors(fk, gemC) : [gemC, C('#ffffff')], anchorFor(A), 313 + n);
  }

  Mo.MOUNT_KINDS = ['pony', 'horse', 'warhorse', 'nightmare', 'emberhoof', 'mossback', 'thornstag', 'strider'];   // v1.2 WS6: + strider
  Mo.mount = function (kind, opts) {
    Mo.init();
    opts = opts || {};
    var t0 = window.performance ? performance.now() : 0;
    var root = kind === 'strider' ? striderModel(opts) : TOAD[kind] ? toadModel(kind, opts) : horseModel(HORSE[kind] ? kind : 'horse', opts);   // v1.2 WS6: strider
    skinify(root);
    var sk = root.userData.skinned;
    if (sk && sk.geometry.boundingSphere) sk.geometry.boundingSphere.radius = Math.max(sk.geometry.boundingSphere.radius, 2.4);
    root.userData.kind = kind === 'strider' || TOAD[kind] || HORSE[kind] ? kind : 'horse';
    root.userData.buildMs = (window.performance ? performance.now() : 0) - t0;
    return root;
  };
})();
