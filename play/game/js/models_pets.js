// =====================================================================
//  WIZZIE FARM — models_pets.js (v2.0 M2, WS-B: technical-artist for pets)
//  Original procedural pet models in the toon style of models.js (big heads, big eyes,
//  chunky silhouettes; never realistic). Own IIFE: shares only WF.models._k primitives.
//
//  WF.models.pet(look, opts) -> Group (origin at the feet, y = 0, facing +Z)
//    look  game/data/pets.js species[].look:
//          { body: pup|kit|hopper|fawn|moth|drake|owl|mote, fur, belly, accent, eyes, glow,
//            ears: leaf|floppy|pointy|feelers|horns|tufts|none, tail: puff|wave|flame|spade|wisp|none,
//            toad, antlers, brass }
//    opts  { rarity, scale }  rarity Rare+ adds a soft aura, Legendary a sparkle crown
//    userData.anim(t, state, dt)  state = idle | walk | run | hop (cheer) | cast
//    userData.height, userData.flying (moths, owls, motes hover)
//  WF.models.petEgg(look, rarity) -> Group: a speckled egg in the species' colours (nests)
//  WF.models.petBoard() -> Group: the Pet Stat Board (a painted notice board on two posts)
//  Budget: <= 4 meshes + 2 sprites per pet (one Builder per moving part).
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  'use strict';
  var Mo = window.WF.models;
  if (!Mo || !Mo._k) return;
  var K = Mo._k, T = K.T, PI = K.PI, TAU = K.TAU, C = K.C, sh = K.sh, G = K.G, Builder = K.Builder, pivot = K.pivot, halo = K.halo, measureTop = K.measureTop;
  var RAR = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  var RCOL = { common: '#d8d8d8', uncommon: '#6fe07a', rare: '#5aa8ff', epic: '#c07aff', legendary: '#ffb43a' };

  function part(parent, x, y, z, fill) {
    var p = pivot(parent, x, y, z), b = new Builder();
    fill(b);
    var m = b.build();
    m.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    p.add(m);
    return p;
  }
  function eyes(b, x, y, z, r, col, gap) {
    [-1, 1].forEach(function (s) {
      b.add(G.sph(r, 12, 10), '#ffffff', { p: [s * gap, y, z], s: [1, 1.1, 0.7] });
      b.add(G.sph(r * 0.72, 12, 10), col, { p: [s * gap, y - r * 0.05, z + r * 0.32], s: [1, 1.1, 0.6] });
      b.glow(G.sph(r * 0.22, 8, 6), '#ffffff', { p: [s * gap + r * 0.25, y + r * 0.3, z + r * 0.62] });
    });
  }
  function ears(b, kind, y, z, fur, accent) {
    [-1, 1].forEach(function (s) {
      if (kind === 'leaf') b.add(G.sph(1, 10, 8), accent, { p: [s * 0.13, y + 0.28, z - 0.02], s: [0.07, 0.26, 0.04], r: [0, 0, s * -0.25] });
      else if (kind === 'floppy') b.add(G.sph(1, 10, 8), sh(C(fur), -0.18), { p: [s * 0.26, y - 0.02, z - 0.02], s: [0.07, 0.2, 0.12], r: [0, 0, s * 0.5] });
      else if (kind === 'pointy') b.add(G.cone(0.1, 0.24, 8), fur, { p: [s * 0.16, y + 0.22, z - 0.03], r: [0, 0, s * -0.3] });
      else if (kind === 'feelers') b.add(G.taper([[0, 0, 0], [s * 0.08, 0.18, 0.06], [s * 0.2, 0.32, 0.02]], 0.02, 0.01, 8, 4), accent, { p: [s * 0.06, y + 0.12, z + 0.08] });
      else if (kind === 'horns') b.add(G.cone(0.05, 0.22, 7), '#f4e8d0', { p: [s * 0.12, y + 0.2, z - 0.08], r: [-0.5, 0, s * -0.3] });
      else if (kind === 'tufts') b.add(G.cone(0.07, 0.18, 6), sh(C(fur), -0.2), { p: [s * 0.17, y + 0.22, z - 0.02], r: [0, 0, s * -0.4] });
    });
  }
  function tail(parent, kind, x, y, z, look, glow) {
    if (!kind || kind === 'none') return null;
    return part(parent, x, y, z, function (b) {
      if (kind === 'puff') b.add(G.sph(0.11, 10, 8), look.belly || '#ffffff', { p: [0, 0, -0.04] });
      else if (kind === 'wave') b.add(G.taper([[0, 0, 0], [0, 0.12, -0.14], [0, 0.26, -0.12]], 0.06, 0.02, 8, 5), look.fur);
      else if (kind === 'flame') { b.add(G.taper([[0, 0, 0], [0, 0.14, -0.14], [0, 0.32, -0.16]], 0.05, 0.03, 8, 5), look.fur); b.glow(G.cone(0.06, 0.16, 7), glow, { p: [0, 0.4, -0.16] }); }
      else if (kind === 'spade') { b.add(G.taper([[0, 0, 0], [0, 0.04, -0.22], [0, 0.1, -0.38]], 0.07, 0.03, 8, 5), look.fur); b.add(G.oct(0.08), look.accent, { p: [0, 0.12, -0.44], s: [1, 0.5, 1.3] }); }
      else if (kind === 'wisp') b.glow(G.taper([[0, 0, 0], [0.04, -0.04, -0.2], [-0.04, 0.02, -0.38]], 0.07, 0.01, 8, 5), glow);
    });
  }

  M_pet.BODIES = ['pup', 'kit', 'hopper', 'fawn', 'moth', 'drake', 'owl', 'mote'];
  function M_pet(look, opts) {
    look = look || {}; opts = opts || {};
    var body = look.body || 'pup', fur = look.fur || '#c8a07a', belly = look.belly || '#f4e8d0', accent = look.accent || sh(C(fur), -0.25), glow = look.glow || '#ffe08a';
    var eyeC = look.eyes || '#2a1a0a', tier = RAR[opts.rarity] || 0;
    var root = new T.Group(); root.name = 'pet_' + body;
    var scaler = pivot(root); scaler.scale.setScalar(opts.scale || 1);
    var flying = body === 'moth' || body === 'mote' || body === 'owl';
    var hover = pivot(scaler, 0, 0, 0);
    var legs = [], wings = [], head, torso, tl = null;
    var quad = body === 'pup' || body === 'kit' || body === 'fawn' || body === 'drake';
    var legH = body === 'fawn' ? 0.38 : (body === 'drake' ? 0.22 : 0.2);

    if (quad) {
      var bodyY = legH + 0.22;
      torso = part(hover, 0, bodyY, 0, function (b) {
        b.add(G.sph(1, 16, 12), fur, { s: [0.27, 0.24, body === 'fawn' ? 0.36 : 0.34] });
        b.add(G.sph(1, 14, 10), belly, { p: [0, -0.08, 0.04], s: [0.2, 0.15, 0.27] });
        if (body === 'drake') for (var i = 0; i < 4; i++) b.add(G.cone(0.04, 0.1, 5), look.accent, { p: [0, 0.24 - i * 0.01, 0.18 - i * 0.13], r: [-0.3, 0, 0] });
        if (body === 'kit') b.add(G.tor(0.15, 0.03, 5, 14), accent, { p: [0, 0.12, 0.26], r: [PI / 2.3, 0, 0] });   // little collar
      });
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (q) {
        legs.push(part(hover, q[0] * 0.14, legH + 0.04, q[1] * 0.19, function (b) {
          b.add(G.cyl(0.055, 0.05, legH, 8), sh(C(fur), -0.06), { p: [0, -legH / 2, 0] });
          b.add(G.sph(0.07, 8, 6), body === 'fawn' ? '#4a3424' : belly, { p: [0, -legH + 0.02, 0.02], s: [1, 0.6, 1.2] });
        }));
      });
      head = part(hover, 0, bodyY + 0.24, 0.3, function (b) {
        b.add(G.sph(0.24, 16, 12), fur, { s: [1.05, 0.95, 0.95] });
        b.add(G.sph(0.12, 12, 10), belly, { p: [0, -0.07, 0.17], s: [1.1, 0.75, 0.9] });
        b.add(G.sph(0.035, 8, 6), '#2a1a1a', { p: [0, -0.02, 0.28] });
        eyes(b, 0, 0.04, 0.17, 0.075, eyeC, 0.11);
        ears(b, look.ears, 0.08, 0, fur, accent);
        if (look.antlers) [-1, 1].forEach(function (s) {
          b.add(G.taper([[0, 0, 0], [s * 0.06, 0.16, -0.02], [s * 0.16, 0.3, 0.02]], 0.03, 0.015, 8, 4), '#8a5a3a', { p: [s * 0.08, 0.18, -0.04] });
          b.add(G.sph(0.045, 8, 6), glow, { p: [s * 0.24, 0.48, -0.02] });
        });
      });
      if (body === 'drake') wings = [-1, 1].map(function (s) {
        return part(torso, s * 0.2, 0.14, 0.02, function (b) {
          b.add(G.taper([[0, 0, 0], [s * 0.2, 0.12, -0.04], [s * 0.38, 0.2, -0.12]], 0.025, 0.012, 8, 4), accent);
          b.add(G.sph(1, 10, 8), sh(C(accent), 0.15), { p: [s * 0.22, 0.08, -0.08], s: [0.18, 0.02, 0.13], r: [0, 0, s * 0.35] });
        });
      });
      tl = tail(hover, look.tail, 0, bodyY + 0.04, -0.32, look, glow);
    } else if (body === 'hopper') {
      torso = part(hover, 0, 0.22, 0, function (b) {
        b.add(G.sph(1, 16, 12), fur, { s: look.toad ? [0.3, 0.2, 0.28] : [0.24, 0.24, 0.26] });
        b.add(G.sph(1, 14, 10), belly, { p: [0, -0.06, 0.08], s: look.toad ? [0.24, 0.14, 0.2] : [0.17, 0.17, 0.18] });
        if (look.toad) for (var i = 0; i < 6; i++) b.add(G.sph(0.03, 6, 5), accent, { p: [Math.cos(i * 1.7) * 0.18, 0.14, Math.sin(i * 1.7) * 0.16 - 0.04] });
      });
      [-1, 1].forEach(function (s) {
        legs.push(part(hover, s * 0.17, 0.08, -0.08, function (b) { b.add(G.sph(1, 10, 8), sh(C(fur), -0.08), { s: [0.08, 0.07, 0.16], p: [0, 0, 0.04] }); }));
        legs.push(part(hover, s * 0.1, 0.07, 0.17, function (b) { b.add(G.sph(0.05, 8, 6), belly); }));
      });
      head = part(hover, 0, look.toad ? 0.38 : 0.48, look.toad ? 0.14 : 0.1, function (b) {
        if (look.toad) {
          b.add(G.sph(1, 14, 10), fur, { s: [0.24, 0.13, 0.2] });
          b.add(G.tor(0.15, 0.012, 4, 16, PI), '#3a2a1a', { p: [0, -0.03, 0.12], r: [0, 0, PI] });
          eyes(b, 0, 0.11, 0.06, 0.07, eyeC, 0.12);
        } else {
          b.add(G.sph(0.21, 16, 12), fur);
          b.add(G.sph(0.08, 10, 8), belly, { p: [0, -0.06, 0.16], s: [1.2, 0.8, 0.8] });
          b.add(G.sph(0.025, 8, 6), '#ff8aa8', { p: [0, -0.02, 0.21] });
          eyes(b, 0, 0.04, 0.14, 0.065, eyeC, 0.09);
          ears(b, look.ears, 0.08, 0, fur, accent);
          if (look.ears === 'leaf') b.glow(G.sph(0.03, 6, 5), glow, { p: [0, 0.22, 0.02] });
        }
      });
      tl = tail(hover, look.tail, 0, 0.22, -0.24, look, glow);
    } else if (body === 'moth' || body === 'owl' || body === 'mote') {
      var cy = body === 'owl' ? 0.32 : 0.55;
      torso = part(hover, 0, cy, 0, function (b) {
        if (body === 'mote') {
          b.glow(G.ico(0.17, 1), glow);
          b.add(G.sph(0.15, 14, 10), fur, { s: [1, 1, 1] });
          eyes(b, 0, 0.02, 0.1, 0.05, eyeC, 0.06);
        } else if (body === 'owl') {
          b.add(G.sph(1, 16, 12), fur, { s: [0.26, 0.3, 0.24] });
          b.add(G.sph(1, 14, 10), belly, { p: [0, -0.04, 0.1], s: [0.19, 0.22, 0.16] });
          if (look.brass) { b.add(G.tor(0.2, 0.02, 5, 18), '#d4a84a', { p: [0, 0.02, 0], r: [PI / 2, 0, 0] }); b.add(G.cyl(0.03, 0.03, 0.06, 8), '#b8862e', { p: [0, 0.31, -0.02] }); }
          [-1, 1].forEach(function (s) { b.add(G.cone(0.03, 0.08, 5), '#f0b84a', { p: [s * 0.08, -0.3, 0.06], r: [PI, 0, 0] }); });
        } else {
          b.add(G.sph(1, 14, 10), fur, { s: [0.14, 0.14, 0.26] });
          b.add(G.sph(0.16, 14, 10), belly, { p: [0, 0.02, 0.06] });
        }
      });
      if (body !== 'mote') head = part(torso, 0, body === 'owl' ? 0.26 : 0.1, body === 'owl' ? 0.02 : 0.2, function (b) {
        b.add(G.sph(body === 'owl' ? 0.2 : 0.13, 14, 10), fur);
        eyes(b, 0, 0.02, body === 'owl' ? 0.14 : 0.09, body === 'owl' ? 0.075 : 0.05, eyeC, body === 'owl' ? 0.09 : 0.065);
        if (body === 'owl') b.add(G.cone(0.035, 0.08, 6), '#f0b84a', { p: [0, -0.05, 0.2], r: [PI / 2 + 0.4, 0, 0] });
        ears(b, look.ears, 0.0, 0, fur, accent);
      });
      else head = torso;
      if (body === 'moth') wings = [-1, 1].map(function (s) {
        return part(torso, s * 0.1, 0.06, 0, function (b) {
          b.add(G.sph(1, 12, 8), accent, { p: [s * 0.26, 0.06, 0.04], s: [0.28, 0.02, 0.2], r: [0, s * 0.3, 0] });
          b.add(G.sph(1, 12, 8), sh(C(accent), 0.2), { p: [s * 0.2, 0.0, -0.16], s: [0.18, 0.02, 0.13] });
          b.glow(G.sph(0.04, 8, 6), glow, { p: [s * 0.3, 0.08, 0.06] });
        });
      });
      if (body === 'owl') wings = [-1, 1].map(function (s) {
        return part(torso, s * 0.24, 0.04, -0.02, function (b) { b.add(G.sph(1, 12, 8), accent, { p: [s * 0.04, -0.02, 0], s: [0.07, 0.22, 0.17] }); });
      });
      if (body === 'mote') {
        var orb = part(torso, 0, 0, 0, function (b) {
          b.glow(G.tor(0.26, 0.012, 4, 24), accent, { r: [PI / 2.4, 0, 0] });
          b.glow(G.sph(0.035, 6, 5), '#ffffff', { p: [0.26, 0, 0] });
        });
        wings = [orb];
      }
      tl = tail(torso, look.tail, 0, -0.02, -0.14, look, glow);
    }

    // rarity flair: aura (Rare+), sparkle crown (Legendary)
    var aura = null, crown = null;
    if (tier >= 2) { aura = halo(RCOL[opts.rarity] || glow, 1.1 + tier * 0.15, 0.32); aura.position.set(0, 0.35, 0); hover.add(aura); }
    if (tier >= 4) { crown = halo('#fff2b0', 0.34, 0.9); crown.position.set(0, 0.95, 0); hover.add(crown); }

    root.userData.flying = flying;
    root.userData.anim = function (t, state, dt) {
      var sp = state === 'run' ? 2.2 : (state === 'walk' ? 1.4 : 1), moving = state === 'walk' || state === 'run';
      var hopping = state === 'hop' || (body === 'hopper' && moving);
      var base = flying ? 0.25 + Math.sin(t * 2.4) * 0.07 : 0;
      var hopY = hopping ? Math.abs(Math.sin(t * (moving ? 7 : 6))) * (state === 'hop' ? 0.35 : 0.16) : 0;
      hover.position.y = base + hopY + (state === 'cast' ? 0.1 + Math.sin(t * 12) * 0.03 : 0);
      if (torso && !flying) torso.rotation.x = moving ? Math.sin(t * 9 * sp) * 0.05 : 0;
      for (var i = 0; i < legs.length; i++) legs[i].rotation.x = moving && !hopping ? Math.sin(t * 9 * sp + (i % 2 ? PI : 0) + (i > 1 ? PI : 0)) * 0.6 : (hopping ? -0.3 : 0);
      if (head && head !== torso) { head.rotation.x = Math.sin(t * 1.7) * 0.06 + (state === 'cast' ? -0.25 : 0); head.rotation.z = Math.sin(t * 1.1) * 0.05; }
      if (tl) tl.rotation.y = Math.sin(t * (moving ? 10 : 4)) * 0.35;
      for (var w = 0; w < wings.length; w++) {
        if (body === 'mote') wings[w].rotation.y = t * 2.5;
        else if (body === 'moth') wings[w].rotation.z = Math.sin(t * 14) * 0.5 * (w ? -1 : 1);
        else wings[w].rotation.z = (body === 'owl' ? (state === 'cast' || state === 'hop' ? Math.sin(t * 16) * 0.6 : 0) : Math.sin(t * (moving ? 9 : 2)) * 0.25) * (w ? -1 : 1);
      }
      if (aura) aura.material.opacity = 0.24 + Math.sin(t * 2) * 0.08;
      if (crown) { crown.position.y = 0.95 + Math.sin(t * 3) * 0.05; }
    };
    root.userData.anim(0, 'idle', 0);
    root.userData.height = measureTop(root);
    root.userData.isPet = true;
    return root;
  }

  Mo.pet = M_pet;
  Mo.petEgg = function (look, rarity) {
    look = look || {};
    var root = new T.Group(); root.name = 'pet_egg';
    var b = new Builder(), col = look.fur || '#f4e8d0', spot = look.accent || '#8a6a4a';
    b.add(G.sph(1, 16, 12), col, { p: [0, 0.3, 0], s: [0.22, 0.3, 0.22] });
    for (var i = 0; i < 9; i++) b.add(G.sph(0.035, 6, 5), spot, { p: [Math.cos(i * 2.4) * 0.2, 0.18 + (i % 3) * 0.12, Math.sin(i * 2.4) * 0.2] });
    var m = b.build(); m.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    var wob = pivot(root); wob.add(m);
    var tier = RAR[rarity] || 0;
    var h = halo(RCOL[rarity] || '#ffffff', 0.8 + tier * 0.12, tier >= 2 ? 0.5 : 0.25); h.position.set(0, 0.32, 0); root.add(h);
    root.userData.anim = function (t, ready) { wob.rotation.z = Math.sin(t * (ready ? 9 : 1.4)) * (ready ? 0.18 : 0.05); h.material.opacity = (tier >= 2 ? 0.4 : 0.2) + Math.sin(t * 2.2) * 0.1 + (ready ? 0.2 : 0); };
    root.userData.height = 0.6;
    return root;
  };
  Mo.petBoard = function () {
    var root = new T.Group(); root.name = 'pet_board';
    var b = new Builder();
    [-1, 1].forEach(function (s) { b.add(G.cyl(0.07, 0.08, 2.2, 8), '#7a5232', { p: [s * 0.95, 1.1, 0] }); b.add(G.sph(0.1, 8, 6), '#ffd76a', { p: [s * 0.95, 2.25, 0] }); });
    b.add(G.box(2.1, 1.2, 0.1), '#9a6a3e', { p: [0, 1.55, 0] });
    b.add(G.box(1.9, 1.0, 0.04), '#f4e6c4', { p: [0, 1.55, 0.06] });
    // painted paw print + three bars (a "stat chart")
    b.add(G.sph(0.16, 12, 8), '#e86aa8', { p: [-0.55, 1.5, 0.09], s: [1, 1, 0.2] });
    [[-0.75, 1.72], [-0.6, 1.78], [-0.42, 1.75], [-0.3, 1.66]].forEach(function (q) { b.add(G.sph(0.06, 8, 6), '#e86aa8', { p: [q[0] + 0.1, q[1], 0.09], s: [1, 1, 0.2] }); });
    [[0.05, 0.3, '#6fe07a'], [0.35, 0.5, '#5aa8ff'], [0.65, 0.7, '#ffb43a']].forEach(function (q) { b.add(G.box(0.18, q[1], 0.03), q[2], { p: [q[0], 1.2 + q[1] / 2, 0.09] }); });
    b.add(G.cone(0.14, 0.22, 4), '#c0503a', { p: [0, 2.3, 0], r: [0, PI / 4, 0], s: [8, 1, 0.8] });
    var m = b.build(); m.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(m);
    root.userData.height = 2.5;
    return root;
  };
})();
