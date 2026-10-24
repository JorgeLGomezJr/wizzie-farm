// =====================================================================
//  WIZZIE FARM — textures.js (v1.1)
//  Procedural textures painted at load time (canvas / DataTexture).
//  No image files: the game must run offline from file://.
//
//  Sections
//    * shared helpers (top)      — cache, canvas, texture wrapping (everyone)
//    * §GROUND/SKY               — agent R (render & environment)
//    * §PROPS                    — agent S (props & scenery art)
//
//  Every texture handed out from WF.textures.cached() is TAGGED
//  (texture.userData.cached = true) so WF.models.dispose() never frees a
//  texture that other objects still share.
// =====================================================================
window.WF = window.WF || { data: {} };
WF.textures = WF.textures || {};

// ---------------------------------------------------------------------
//  Shared helpers
// ---------------------------------------------------------------------
(function (TX) {
  'use strict';
  var cache = TX._cache = TX._cache || {};
  // Max anisotropic filtering; WF.gfx.init() raises it to what the GPU supports.
  TX.anisotropy = TX.anisotropy || 4;

  // cached(key, make): build once, tag as shared, return the same texture afterwards
  TX.cached = TX.cached || function (key, make) {
    var t = cache[key];
    if (!t) {
      t = cache[key] = make();
      if (t && t.userData) t.userData.cached = true;
    }
    return t;
  };
  TX.canvas = TX.canvas || function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
  // Deterministic RNG (mulberry32)
  TX.rng = TX.rng || function (seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  // Wrap a canvas as a tiling, mip-mapped, anisotropic texture
  TX.tiled = TX.tiled || function (cv, o) {
    o = o || {};
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(TX.anisotropy, o.aniso || 16);
    t.userData.aniso = o.aniso || 16;
    if (o.flipY === false) t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  // Re-apply anisotropy to every cached texture (called by WF.gfx when the tier changes)
  TX.setAnisotropy = TX.setAnisotropy || function (n) {
    TX.anisotropy = n;
    Object.keys(cache).forEach(function (k) {
      var t = cache[k];
      if (t && t.isTexture && t.userData.aniso) { var a = Math.min(n, t.userData.aniso); if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; } }
    });
  };
})(WF.textures);

// =====================================================================
//  §GROUND/SKY  (agent R — render & environment)
//  Painterly, seamless ground tiles per zone style, path tiles (cobbles,
//  packed dirt, flagstones), a shared tiling noise texture (clouds, ridges,
//  anti-tiling, path edges) and the per-zone splat mask.
// =====================================================================
(function (TX) {
  'use strict';
  var T = window.THREE;

  // ---------- colour helpers ----------
  function col(c) { return c instanceof T.Color ? c.clone() : new T.Color(c); }
  // shift hue (turns), saturation and lightness (additive) in HSL
  function hsl(c, dh, ds, dl) {
    var k = col(c), o = {}; k.getHSL(o);
    k.setHSL((o.h + (dh || 0) + 1) % 1, Math.max(0, Math.min(1, o.s + (ds || 0))), Math.max(0, Math.min(1, o.l + (dl || 0))));
    return k;
  }
  function css(c, a) {
    var k = col(c);
    return 'rgba(' + Math.round(Math.max(0, Math.min(1, k.r)) * 255) + ',' + Math.round(Math.max(0, Math.min(1, k.g)) * 255) + ',' + Math.round(Math.max(0, Math.min(1, k.b)) * 255) + ',' + (a === undefined ? 1 : a) + ')';
  }
  function lerpC(a, b, t) { return col(a).lerp(col(b), t); }
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // ---------- tileable fBm value noise (period P cells across N pixels) ----------
  function tileNoise(N, P, oct, seed, gain) {
    var out = new Float32Array(N * N), r = TX.rng(seed), amp = 1, tot = 0, g = gain || 0.5;
    for (var o = 0; o < oct; o++) {
      var p = P << o, lat = new Float32Array(p * p);
      for (var i = 0; i < lat.length; i++) lat[i] = r();
      for (var y = 0; y < N; y++) {
        var fy = y / N * p, iy = Math.floor(fy), ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
        var y0 = (iy % p) * p, y1 = ((iy + 1) % p) * p;
        for (var x = 0; x < N; x++) {
          var fx = x / N * p, ix = Math.floor(fx), tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
          var x0 = ix % p, x1 = (ix + 1) % p;
          var a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
          out[y * N + x] += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp;
        }
      }
      tot += amp; amp *= g;
    }
    // stretch to 0..1
    var mn = 1e9, mx = -1e9, k;
    for (k = 0; k < out.length; k++) { if (out[k] < mn) mn = out[k]; if (out[k] > mx) mx = out[k]; }
    var s = 1 / Math.max(1e-6, mx - mn);
    for (k = 0; k < out.length; k++) out[k] = (out[k] - mn) * s;
    return out;
  }
  TX.tileNoise = tileNoise;

  // Shared 256² RGBA noise: R = fbm(4) G = fbm(8) B = fbm(16, detail) A = fbm(2, very broad)
  TX.noise = function () {
    return TX.cached('env_noise', function () {
      var N = 256, ch = [tileNoise(N, 4, 5, 11), tileNoise(N, 8, 4, 23), tileNoise(N, 16, 3, 37), tileNoise(N, 2, 4, 51)];
      var d = new Uint8Array(N * N * 4);
      for (var i = 0; i < N * N; i++) for (var c = 0; c < 4; c++) d[i * 4 + c] = Math.round(ch[c][i] * 255);
      var t = new T.DataTexture(d, N, N, T.RGBAFormat);
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
      t.generateMipmaps = true; t.needsUpdate = true;
      return t;
    });
  };

  // ---------- painting helpers (all wrap around the tile edges) ----------
  function wrapped(N, x, y, r, fn) {
    var xs = [0], ys = [0];
    if (x < r) xs.push(N); if (x > N - r) xs.push(-N);
    if (y < r) ys.push(N); if (y > N - r) ys.push(-N);
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) fn(x + xs[i], y + ys[j]);
  }
  function blob(ctx, N, x, y, r, c, a) {
    wrapped(N, x, y, r, function (px, py) {
      var g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, css(c, a)); g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  function stroke(ctx, N, x, y, ang, len, w, c, a, bend) {
    var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, b = bend || 0;
    wrapped(N, x, y, len + w, function (px, py) {
      ctx.strokeStyle = css(c, a); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + dx * 0.5 - dy * b, py + dy * 0.5 + dx * b, px + dx, py + dy);
      ctx.stroke();
    });
  }
  function ellipse(ctx, N, x, y, rx, ry, rot, c, a) {
    wrapped(N, x, y, Math.max(rx, ry) + 1, function (px, py) {
      ctx.fillStyle = css(c, a);
      ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Base layer: per-pixel blend between two colours by tileable noise (+ fine grain)
  function paintBase(ctx, N, cA, cB, seed, P, grain) {
    var img = ctx.createImageData(N, N), d = img.data;
    var n1 = tileNoise(N, P || 4, 5, seed), n2 = tileNoise(N, 32, 2, seed + 7);
    var A = col(cA), B = col(cB), g = grain === undefined ? 0.08 : grain;
    for (var i = 0; i < N * N; i++) {
      var t = smooth(0.15, 0.85, n1[i]), f = 1 + (n2[i] - 0.5) * g * 2;
      d[i * 4] = Math.min(255, (A.r + (B.r - A.r) * t) * f * 255);
      d[i * 4 + 1] = Math.min(255, (A.g + (B.g - A.g) * t) * f * 255);
      d[i * 4 + 2] = Math.min(255, (A.b + (B.b - A.b) * t) * f * 255);
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- ground tiles ----------
  // style: town | meadow | forest | ruins ; c1 = zone.ground, c2 = zone.ground2
  // One tile covers ~6 world units (the shader samples it at two scales to hide repeats).
  TX.groundTile = function (style, c1, c2) {
    if (style === 'vault') return TX.vaultFloorTile(c1, c2);   // v1.2 WS6
    var key = 'gt_' + style + '_' + col(c1).getHexString() + col(c2).getHexString();
    return TX.cached(key, function () {
      var N = 512, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(style.length * 977 + 13);
      var dS = style === 'town' ? -0.08 : 0;
      var mid = hsl(c1, 0, dS, 0), dark = hsl(c2, 0.03, -0.04 + dS, -0.08), light = hsl(c1, -0.035, -0.04 + dS, 0.06), hi = hsl(c1, -0.075, -0.1 + dS, 0.13);
      var ochre = hsl(c1, -0.09, -0.12, 0.04), deep = hsl(c2, 0.06, -0.06, -0.12);
      var i, x, y;
      ctx.lineCap = 'round';
      if (style === 'ruins') {
        // ash and scorched earth, dead grass, cracks, pebbles
        var ashA = hsl(c1, 0, -0.05, -0.04), ashB = hsl(c1, 0.02, -0.08, 0.07);
        paintBase(ctx, N, ashA, ashB, 101, 4, 0.12);
        for (i = 0; i < 80; i++) blob(ctx, N, r() * N, r() * N, 20 + r() * 70, r() < 0.45 ? hsl(c2, 0, 0, -0.08) : r() < 0.7 ? hsl(c1, 0.75, -0.25, 0.14) : hsl(c1, 0.03, -0.1, 0.12), 0.2 + r() * 0.22);
        for (i = 0; i < 26; i++) blob(ctx, N, r() * N, r() * N, 10 + r() * 34, '#1d1418', 0.18 + r() * 0.2);   // scorch marks
        // cracks
        for (i = 0; i < 22; i++) {
          x = r() * N; y = r() * N; var a = r() * Math.PI * 2, segs = 3 + Math.floor(r() * 5);
          for (var s = 0; s < segs; s++) {
            var L = 8 + r() * 22; a += (r() - 0.5) * 1.2;
            stroke(ctx, N, x + 1.4, y + 1.4, a, L, 1.2, hsl(c1, 0, -0.12, 0.2), 0.45);
            stroke(ctx, N, x, y, a, L, 1.4 + r() * 1.5, '#140d12', 0.75);
            x += Math.cos(a) * L; y += Math.sin(a) * L; x = (x + N) % N; y = (y + N) % N;
          }
        }
        // dead grass strokes (straw/olive) and ash speckles
        var straw = ['#8a7a52', '#6f6343', '#a39063', '#5d5a3e'];
        for (i = 0; i < 40; i++) {             // tufts of dead grass
          x = r() * N; y = r() * N;
          for (var tq = 0; tq < 14; tq++) stroke(ctx, N, x + (r() - 0.5) * 10, y + (r() - 0.5) * 6, -Math.PI / 2 + (r() - 0.5) * 1.8, 5 + r() * 9, 1 + r(), straw[tq % 4], 0.6 + r() * 0.3, (r() - 0.5) * 0.5);
        }
        for (i = 0; i < 2600; i++) stroke(ctx, N, r() * N, r() * N, -Math.PI / 2 + (r() - 0.5) * 2.2, 3 + r() * 9, 0.8 + r() * 1.3, straw[i % 4], 0.3 + r() * 0.35, (r() - 0.5) * 0.5);
        for (i = 0; i < 900; i++) ellipse(ctx, N, r() * N, r() * N, 1 + r() * 3, 0.8 + r() * 2, r() * 3, r() < 0.5 ? hsl(c1, 0, -0.1, 0.18) : '#241a20', 0.4 + r() * 0.4);
        // ember specks (warm, tiny)
        for (i = 0; i < 70; i++) ellipse(ctx, N, r() * N, r() * N, 0.8 + r() * 1.2, 0.8 + r(), 0, r() < 0.5 ? '#ff8a3a' : '#ffb35a', 0.45 + r() * 0.4);
      } else {
        var P = style === 'town' ? 8 : 4;
        paintBase(ctx, N, dark, light, style === 'forest' ? 203 : 307, P, style === 'town' ? 0.06 : 0.1);
        // big painterly blotches
        var nb = style === 'town' ? 50 : 80;
        for (i = 0; i < nb; i++) { var bu = r(); blob(ctx, N, r() * N, r() * N, 18 + r() * 60, bu < 0.3 ? dark : bu < 0.5 ? deep : bu < 0.75 ? light : bu < 0.9 ? ochre : hi, 0.12 + r() * 0.18); }
        if (style === 'forest') {
          // moss + leaf litter + twigs on a darker floor
          var leafC = ['#8a5a2a', '#a8642a', '#6e5a2c', '#b4823a', '#7a3e22', '#596b2e', '#c08a3c'];
          for (i = 0; i < 2200; i++) stroke(ctx, N, r() * N, r() * N, r() * Math.PI * 2, 3 + r() * 7, 1 + r() * 1.6, r() < 0.5 ? dark : light, 0.35 + r() * 0.4, (r() - 0.5) * 0.6);
          for (i = 0; i < 55; i++) blob(ctx, N, r() * N, r() * N, 10 + r() * 34, hsl(c1, -0.07, 0.16, 0.1), 0.5);    // moss cushions
          for (i = 0; i < 900; i++) ellipse(ctx, N, r() * N, r() * N, 1 + r() * 2, 1 + r() * 1.6, 0, hsl(c1, -0.08, 0.2, 0.16), 0.5);   // moss speckle
          for (i = 0; i < 1100; i++) {
            x = r() * N; y = r() * N; var ang = r() * Math.PI * 2, lc = leafC[Math.floor(r() * leafC.length)], sz = 3 + r() * 4;
            var mixed = lerpC(lc, mid, 0.25 + r() * 0.35);
            ellipse(ctx, N, x + 1, y + 1.2, sz, sz * 0.48, ang, '#000000', 0.18);
            ellipse(ctx, N, x, y, sz, sz * 0.48, ang, mixed, 0.85);
            stroke(ctx, N, x - Math.cos(ang) * sz * 0.8, y - Math.sin(ang) * sz * 0.8, ang, sz * 1.6, 0.6, hsl(mixed, 0, 0, -0.15), 0.6);
          }
          for (i = 0; i < 60; i++) stroke(ctx, N, r() * N, r() * N, r() * Math.PI * 2, 10 + r() * 22, 1.2 + r() * 1.2, '#3e2a1a', 0.6, (r() - 0.5) * 0.3);
          for (i = 0; i < 600; i++) stroke(ctx, N, r() * N, r() * N, -Math.PI / 2 + (r() - 0.5) * 1.6, 4 + r() * 8, 1 + r(), hi, 0.3 + r() * 0.3, (r() - 0.5) * 0.4);
        } else {
          // grass: thousands of short brush strokes (dark undercoat, then lights)
          var n = style === 'town' ? 7000 : 8000;
          for (i = 0; i < n; i++) {
            var u = r(), c = u < 0.25 ? dark : u < 0.33 ? deep : u < 0.58 ? mid : u < 0.82 ? light : u < 0.92 ? ochre : hi;
            stroke(ctx, N, r() * N, r() * N, -Math.PI / 2 + (r() - 0.5) * (style === 'town' ? 1.4 : 2.0),
              (style === 'town' ? 3 : 4) + r() * (style === 'town' ? 6 : 9), 1.1 + r() * 1.5, c, 0.45 + r() * 0.45, (r() - 0.5) * 0.6);
          }
          if (style === 'town') {
            // clover clusters + daisies on the lawn
            for (i = 0; i < 140; i++) {
              x = r() * N; y = r() * N; var cc = hsl(c1, 0.01, 0.06, -0.06);
              for (var k = 0; k < 3; k++) ellipse(ctx, N, x + Math.cos(k * 2.1) * 2.2, y + Math.sin(k * 2.1) * 2.2, 2.2, 2.2, 0, cc, 0.7);
            }
            for (i = 0; i < 90; i++) { x = r() * N; y = r() * N; ellipse(ctx, N, x, y, 1.8, 1.8, 0, '#fffaf0', 0.9); ellipse(ctx, N, x, y, 0.8, 0.8, 0, '#ffd23a', 1); }
          } else {
            // meadow flowers: little clusters of colour
            var fl = ['#fff3c4', '#ffd84a', '#ff9ec0', '#c6a8ff', '#ffffff', '#ff7a5a'];
            for (i = 0; i < 160; i++) {
              x = r() * N; y = r() * N; var fc = fl[Math.floor(r() * fl.length)], m = 2 + Math.floor(r() * 4);
              for (var q = 0; q < m; q++) ellipse(ctx, N, x + (r() - 0.5) * 9, y + (r() - 0.5) * 9, 1.2 + r() * 1.1, 1.2 + r() * 0.9, 0, fc, 0.85);
            }
          }
        }
      }
      return TX.tiled(cv);
    });
  };

  // ---------- path tiles: town = cobbles, ruins = flagstones, else packed dirt ----------
  // One tile covers ~4 world units. v1.1 polish (B15): cobbles 16 per tile edge (were 9: stones
  // as big as a wizard hat), forest paths get a warmer, textured forest-floor dirt (needles,
  // leaf litter, roots, moss) instead of reading as flat grey asphalt under the blue light.
  TX.pathTile = function (style, pathColor) {
    if (style === 'vault') return TX.vaultPathTile(pathColor);   // v1.2 WS6
    var kind = style === 'town' ? 'cobble' : style === 'ruins' ? 'flag' : 'dirt';
    var forest = kind === 'dirt' && style === 'forest';
    var key = 'pt_' + kind + (forest ? 'F' : '') + '2_' + col(pathColor).getHexString();
    return TX.cached(key, function () {
      var N = kind === 'cobble' ? 768 : 512, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(kind.length * 131 + 5);
      var base = col(pathColor), img = ctx.createImageData(N, N), d = img.data;
      var grain = tileNoise(N, 32, 2, 77), broad = tileNoise(N, 4, 4, 91);
      var i, x, y;
      if (kind === 'dirt') {
        var dA = hsl(base, 0.01, 0.02, forest ? -0.13 : -0.08), dB = hsl(base, -0.01, forest ? 0.04 : -0.02, forest ? 0.08 : 0.06);
        for (i = 0; i < N * N; i++) {
          var t = smooth(0.1, 0.9, broad[i]), f = 1 + (grain[i] - 0.5) * (forest ? 0.24 : 0.16);
          d[i * 4] = Math.min(255, (dA.r + (dB.r - dA.r) * t) * f * 255);
          d[i * 4 + 1] = Math.min(255, (dA.g + (dB.g - dA.g) * t) * f * 255);
          d[i * 4 + 2] = Math.min(255, (dA.b + (dB.b - dA.b) * t) * f * 255);
          d[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        for (i = 0; i < 60; i++) blob(ctx, N, r() * N, r() * N, 14 + r() * 40, r() < 0.5 ? hsl(base, 0, 0, -0.1) : hsl(base, -0.02, 0, 0.08), 0.18 + r() * 0.15);
        // dabs and pebbles
        for (i = 0; i < 1600; i++) ellipse(ctx, N, r() * N, r() * N, 1.5 + r() * 3.5, 1 + r() * 2, r() * 3, r() < 0.5 ? hsl(base, 0, 0, -0.07) : hsl(base, 0, 0, 0.07), 0.35);
        for (i = 0; i < 260; i++) {
          x = r() * N; y = r() * N; var pr = 2 + r() * 5, pc = r() < 0.5 ? hsl(base, 0.02, -0.15, 0.1) : hsl(base, 0, -0.2, -0.05);
          ellipse(ctx, N, x + 1.2, y + 1.6, pr, pr * 0.75, 0, '#000000', 0.25);
          ellipse(ctx, N, x, y, pr, pr * 0.75, r(), pc, 1);
          ellipse(ctx, N, x - pr * 0.3, y - pr * 0.3, pr * 0.45, pr * 0.3, 0, hsl(pc, 0, 0, 0.12), 0.7);
        }
        for (i = 0; i < 300; i++) stroke(ctx, N, r() * N, r() * N, r() * 6.3, 2 + r() * 5, 0.7, hsl(base, 0, 0, -0.18), 0.35);
        if (forest) {
          // forest floor: moss tufts at the edges of puddled patches, fallen leaves, pine needles, a few roots
          for (i = 0; i < 26; i++) blob(ctx, N, r() * N, r() * N, 12 + r() * 26, r() < 0.5 ? '#4f6a3a' : '#5d7a40', 0.16 + r() * 0.12);
          for (i = 0; i < 9; i++) {
            x = r() * N; y = r() * N; var ra = r() * 6.3, rc = hsl(base, 0.01, -0.05, -0.2);
            for (var rs = 0; rs < 6; rs++) { var rl = 10 + r() * 18; ra += (r() - 0.5) * 0.7; stroke(ctx, N, x + 1, y + 2, ra, rl, 3.2 - rs * 0.35, '#1e140c', 0.35); stroke(ctx, N, x, y, ra, rl, 2.8 - rs * 0.35, rc, 0.95); stroke(ctx, N, x - 0.6, y - 0.8, ra, rl, 0.9, hsl(rc, 0, 0, 0.16), 0.6); x = (x + Math.cos(ra) * rl + N) % N; y = (y + Math.sin(ra) * rl + N) % N; }
          }
          for (i = 0; i < 320; i++) {
            x = r() * N; y = r() * N; var lr = 3 + r() * 4, lc = ['#b0682e', '#c8913a', '#8a4a26', '#9c7a34', '#6e7a34'][Math.floor(r() * 5)];
            ellipse(ctx, N, x + 1, y + 1.4, lr, lr * 0.5, 0.7, '#000000', 0.22);
            ellipse(ctx, N, x, y, lr, lr * 0.5, r() * 3, lc, 0.85);
          }
          for (i = 0; i < 900; i++) stroke(ctx, N, r() * N, r() * N, r() * 6.3, 4 + r() * 6, 0.8, r() < 0.6 ? '#9a5e2e' : '#c48a4a', 0.55);
        }
      } else {
        // Voronoi stones (cobble) / offset rectangular slabs (flag), computed per pixel
        var cells = kind === 'cobble' ? 16 : 4, cs = N / cells, pts = [];
        for (y = 0; y < cells; y++) for (x = 0; x < cells; x++) pts.push([(x + 0.2 + r() * 0.6) * cs, (y + 0.2 + r() * 0.6) * cs, r(), r()]);
        var mortar = hsl(base, 0, -0.1, kind === 'cobble' ? -0.22 : -0.28);
        for (y = 0; y < N; y++) {
          for (x = 0; x < N; x++) {
            var id, d1, d2, cx2 = 0, cy2 = 0;
            if (kind === 'cobble') {
              var gx = Math.floor(x / cs), gy = Math.floor(y / cs);
              d1 = 1e9; d2 = 1e9; id = 0;
              for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
                var cxI = (gx + ox + cells) % cells, cyI = (gy + oy + cells) % cells, p = pts[cyI * cells + cxI];
                var px = p[0] + (gx + ox - cxI) * cs, py = p[1] + (gy + oy - cyI) * cs;
                var dd = Math.hypot(x - px, y - py);
                if (dd < d1) { d2 = d1; d1 = dd; id = cyI * cells + cxI; cx2 = px; cy2 = py; } else if (dd < d2) d2 = dd;
              }
              var e = (d2 - d1) * 0.5;      // ~distance to the cell edge
            } else {
              var rh = cs, row = Math.floor(y / rh), off = (row % 2) * cs * 0.5 + (row % 3) * cs * 0.17;
              var xx = (x + off) % N, ci = Math.floor(xx / cs), lx = xx - ci * cs, ly = y - row * rh;
              id = row * cells + ci;
              e = Math.min(lx, cs - lx, ly, rh - ly);
              cx2 = x - lx + cs / 2; cy2 = y - ly + rh / 2;
            }
            var sp = pts[id % pts.length], o4 = (y * N + x) * 4, g2 = 1 + (grain[y * N + x] - 0.5) * 0.18;
            var cr, cg, cb;
            var mw = kind === 'cobble' ? 2.3 : 2.2;
            if (e < mw) { cr = mortar.r; cg = mortar.g; cb = mortar.b; g2 *= 0.9 + 0.2 * grain[y * N + x]; }
            else {
              var lv = (sp[2] - 0.5) * (kind === 'cobble' ? 0.24 : 0.16), hv = (sp[3] - 0.5) * 0.05;
              var sc = hsl(base, hv, kind === 'flag' ? -0.06 : 0, lv + (kind === 'flag' ? 0.02 : 0.04));
              var bev = smooth(mw, mw + (kind === 'cobble' ? 9 : 7), e);        // rounded edges
              var vx = x - cx2, vy = y - cy2, vl = Math.hypot(vx, vy) || 1;
              var lit = ((-vx - vy) / vl) * (1 - bev) * 0.16;                     // top-left light
              var sh = 0.68 + 0.32 * bev + lit + (broad[y * N + x] - 0.5) * 0.12;
              cr = sc.r * sh; cg = sc.g * sh; cb = sc.b * sh;
            }
            d[o4] = Math.min(255, cr * g2 * 255); d[o4 + 1] = Math.min(255, cg * g2 * 255); d[o4 + 2] = Math.min(255, cb * g2 * 255); d[o4 + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        ctx.lineCap = 'round';
        if (kind === 'cobble') {
          // moss and grass in the joints, a few highlights
          for (i = 0; i < 1900; i++) {
            var pp = pts[Math.floor(r() * pts.length)], a2 = r() * Math.PI * 2, rr = cs * (0.42 + r() * 0.12);
            ellipse(ctx, N, (pp[0] + Math.cos(a2) * rr + N) % N, (pp[1] + Math.sin(a2) * rr + N) % N, 1 + r() * 1.6, 1 + r(), 0, r() < 0.6 ? '#5f8a3a' : '#7aa64a', 0.55);
          }
          for (i = 0; i < 520; i++) stroke(ctx, N, r() * N, r() * N, r() * 6.3, 2 + r() * 4, 1, hsl(base, 0, 0, 0.16), 0.3);
        } else {
          // cracks, ash drifts, missing corners, glowing cinder specks
          for (i = 0; i < 18; i++) {
            x = r() * N; y = r() * N; var a3 = r() * 6.3;
            for (var s2 = 0; s2 < 4; s2++) { var L2 = 6 + r() * 16; a3 += (r() - 0.5) * 1.4; stroke(ctx, N, x, y, a3, L2, 1 + r(), hsl(base, 0, 0, -0.3), 0.7); x = (x + Math.cos(a3) * L2 + N) % N; y = (y + Math.sin(a3) * L2 + N) % N; }
          }
          for (i = 0; i < 40; i++) blob(ctx, N, r() * N, r() * N, 10 + r() * 40, r() < 0.6 ? '#9a9098' : '#2a1e22', 0.18 + r() * 0.15);
          for (i = 0; i < 300; i++) ellipse(ctx, N, r() * N, r() * N, 1 + r() * 2, 1 + r() * 1.5, r(), r() < 0.5 ? '#3a2e30' : '#b0a6a8', 0.4);
        }
      }
      return TX.tiled(cv);
    });
  };

  // ---------- per-zone splat mask (NOT cached: freed with the zone) ----------
  // Canvas covering the whole terrain square [-H, H]² (world x → u, world z → v, flipY off).
  //   R = path core (soft edge; the shader roughens it with noise)
  //   G = worn ground around paths (wider, very soft)
  //   B = damp ground around pools
  // Returns { tex, data (Uint8ClampedArray RGBA), M, H, at(x, z) -> [r, g, b] 0..1 }
  // ---------- per-zone splat mask (NOT cached: freed with the zone) ----------
  // DataTexture covering the whole terrain square [-H, H]² (world x -> u, world z -> v).
  //   R = path core (soft edge; the shader roughens it with noise)
  //   G = worn ground around paths (wider, very soft)
  //   B = damp ground around pools
  //   A = vegetation allowed (0 inside keep-clear circles: hand-placed props, pools, portals)
  // Rasterised analytically (capsule distance per segment, only inside each segment's
  // bounding box), so it is fast everywhere — no canvas, no blur.
  // Returns { tex, data (Uint8Array RGBA), M, H, at(x, z) -> [r, g, b] 0..1 }
  TX.groundMask = function (zone, H, pathWidth, clear) {
    var M = 1024, s = M / (2 * H), data = new Uint8Array(M * M * 4);
    var w = pathWidth, eR = 0.32, wG = pathWidth + 2.8;
    function sm(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
    function seg(ax, az, bx, bz) {
      var reach = wG + 0.5;
      var u0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + H) * s)), u1 = Math.min(M - 1, Math.ceil((Math.max(ax, bx) + reach + H) * s));
      var v0 = Math.max(0, Math.floor((Math.min(az, bz) - reach + H) * s)), v1 = Math.min(M - 1, Math.ceil((Math.max(az, bz) + reach + H) * s));
      var dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      for (var v = v0; v <= v1; v++) {
        var z = (v + 0.5) / s - H;
        for (var u = u0; u <= u1; u++) {
          var x = (u + 0.5) / s - H;
          var t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          var ex = ax + dx * t - x, ez = az + dz * t - z, d = Math.sqrt(ex * ex + ez * ez);
          if (d > reach) continue;
          var o = (v * M + u) * 4;
          var r = Math.round((1 - sm(w - eR, w + eR, d)) * 255), g = Math.round((1 - sm(w * 0.6, wG, d)) * 255);
          if (r > data[o]) data[o] = r;
          if (g > data[o + 1]) data[o + 1] = g;
        }
      }
    }
    (zone.paths || []).forEach(function (pl) {
      if (pl.length === 1) seg(pl[0][0], pl[0][1], pl[0][0], pl[0][1]);
      for (var i = 0; i < pl.length - 1; i++) seg(pl[i][0], pl[i][1], pl[i + 1][0], pl[i + 1][1]);
    });
    (zone.pools || []).forEach(function (pl) {
      var R0 = pl.r + 0.2, R1 = pl.r + 2.6, cx = pl.pos[0], cz = pl.pos[1];
      var u0 = Math.max(0, Math.floor((cx - R1 + H) * s)), u1 = Math.min(M - 1, Math.ceil((cx + R1 + H) * s));
      var v0 = Math.max(0, Math.floor((cz - R1 + H) * s)), v1 = Math.min(M - 1, Math.ceil((cz + R1 + H) * s));
      for (var v = v0; v <= v1; v++) for (var u = u0; u <= u1; u++) {
        var d = Math.hypot((u + 0.5) / s - H - cx, (v + 0.5) / s - H - cz), o = (v * M + u) * 4;
        var b = Math.round((1 - sm(R0, R1, d)) * 255);
        if (b > data[o + 2]) data[o + 2] = b;
      }
    });
    for (var k = 3; k < data.length; k += 4) data[k] = 255;
    (clear || []).forEach(function (c) {
      var cx = c[0], cz = c[1], R0 = c[2], R1 = c[2] + 0.5;
      var u0 = Math.max(0, Math.floor((cx - R1 + H) * s)), u1 = Math.min(M - 1, Math.ceil((cx + R1 + H) * s));
      var v0 = Math.max(0, Math.floor((cz - R1 + H) * s)), v1 = Math.min(M - 1, Math.ceil((cz + R1 + H) * s));
      for (var v = v0; v <= v1; v++) for (var u = u0; u <= u1; u++) {
        var d = Math.hypot((u + 0.5) / s - H - cx, (v + 0.5) / s - H - cz), o = (v * M + u) * 4;
        var a = Math.round(sm(R0 - 0.3, R1, d) * 255);
        if (a < data[o + 3]) data[o + 3] = a;
      }
    });
    var tex = new T.DataTexture(data, M, M, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
    tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = Math.min(TX.anisotropy, 8);
    tex.needsUpdate = true;
    return {
      tex: tex, data: data, M: M, H: H,
      at: function (x, z) {
        var u = Math.floor((x + H) * s), v = Math.floor((z + H) * s);
        if (u < 0 || v < 0 || u >= M || v >= M) return [0, 0, 0];
        var o = (v * M + u) * 4;
        return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
      }
    };
  };

  // ---------- glowing ember veins (ruins floor emissive mask, red channel) ----------
  TX.emberTile = function () {
    return TX.cached('env_ember', function () {
      var N = 512, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(4242);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, N, N);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (var i = 0; i < 9; i++) {
        var x = r() * N, y = r() * N, a = r() * Math.PI * 2, pts = [[x, y]];
        for (var k = 0; k < 7; k++) {
          a += (r() - 0.5) * 1.3; var L = 14 + r() * 30;
          x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]);
          if (r() < 0.3) {                                   // side branch
            var bx = x, by = y, ba = a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.6), bp = [[bx, by]];
            for (var m = 0; m < 3; m++) { ba += (r() - 0.5) * 1.0; bx += Math.cos(ba) * (8 + r() * 14); by += Math.sin(ba) * (8 + r() * 14); bp.push([bx, by]); }
            drawVein(bp, 0.6);
          }
        }
        drawVein(pts, 1);
      }
      function drawVein(pts, wscale) {
        [[9, 0.1], [5, 0.25], [2.2, 0.75], [1, 1]].forEach(function (pass) {
          [-N, 0, N].forEach(function (ox) {
            [-N, 0, N].forEach(function (oy) {
              ctx.strokeStyle = 'rgba(255,255,255,' + pass[1] + ')'; ctx.lineWidth = pass[0] * wscale;
              ctx.beginPath();
              pts.forEach(function (p, j) { if (j) ctx.lineTo(p[0] + ox, p[1] + oy); else ctx.moveTo(p[0] + ox, p[1] + oy); });
              ctx.stroke();
            });
          });
        });
      }
      return TX.tiled(cv, { aniso: 8 });
    });
  };

  // ---------- glowing moss / spore clusters (forest floor emissive mask) ----------
  TX.glowMossTile = function () {
    return TX.cached('env_glowmoss', function () {
      var N = 512, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(9191);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, N, N);
      for (var i = 0; i < 46; i++) {
        var cx = r() * N, cy = r() * N, n = 5 + Math.floor(r() * 12), sp = 6 + r() * 14;
        for (var k = 0; k < n; k++) {
          var x = cx + (r() - 0.5) * sp * 2, y = cy + (r() - 0.5) * sp * 2, rad = 1.2 + r() * 2.6;
          [-N, 0, N].forEach(function (ox) {
            [-N, 0, N].forEach(function (oy) {
              var g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad * 2.4);
              g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = g; ctx.fillRect(x + ox - rad * 2.4, y + oy - rad * 2.4, rad * 4.8, rad * 4.8);
            });
          });
        }
      }
      return TX.tiled(cv, { aniso: 8 });
    });
  };

  // ---------- small soft sprites for ambient particles (cached) ----------
  // 4 cells in a 128x32 strip: 0 soft glow dot, 1 leaf, 2 ash flake, 3 four-point sparkle
  TX.particleAtlas = function () {
    return TX.cached('env_particles', function () {
      var cv = TX.canvas(256, 64), ctx = cv.getContext('2d'), S = 64;
      // 0: glow dot
      var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.8)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      // 1: leaf
      ctx.save(); ctx.translate(S + 32, 32); ctx.rotate(0.6);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(16, -4, 0, 24); ctx.quadraticCurveTo(-16, -4, 0, -24); ctx.fill();
      ctx.strokeStyle = 'rgba(120,120,120,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 22); ctx.stroke();
      ctx.restore();
      // 2: ash flake (irregular)
      ctx.save(); ctx.translate(2 * S + 32, 32); ctx.fillStyle = '#ffffff'; ctx.beginPath();
      for (var i = 0; i < 7; i++) { var a = i / 7 * Math.PI * 2, rr = 10 + ((i * 37) % 9); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8); }
      ctx.closePath(); ctx.fill(); ctx.restore();
      // 3: sparkle
      ctx.save(); ctx.translate(3 * S + 32, 32);
      var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(-32, -32, 64, 64);
      ctx.fillStyle = '#ffffff';
      [0, Math.PI / 2].forEach(function (rot) { ctx.save(); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(-28, 0); ctx.quadraticCurveTo(0, -3, 28, 0); ctx.quadraticCurveTo(0, 3, -28, 0); ctx.fill(); ctx.restore(); });
      ctx.restore();
      var t = new T.CanvasTexture(cv);
      t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    });
  };

  // ---- v1.2 WS6: zone style 'vault' (the Hollow Orrery, an underground observatory) ----
  // Polished star-tile floor: 4x4 slabs per tile (1.5 world units each) of dark marbled stone with a soft
  // polish sheen, bevelled edges, gold inlay grout, gold eight-point stars at the corners and faint engraved
  // constellations on every other slab. c1 = zone.ground, c2 = zone.ground2.
  function star8(ctx, x, y, r0, r1, fill, stroke) {
    ctx.beginPath();
    for (var i = 0; i < 16; i++) { var a = i * Math.PI / 8 - Math.PI / 2, r = i % 2 ? r1 : (i % 4 ? r0 * 0.72 : r0); if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath(); if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); } ctx.fillStyle = fill; ctx.fill();
  }
  TX.vaultFloorTile = function (c1, c2) {
    var key = 'gt_vault4_' + col(c1).getHexString() + col(c2).getHexString();
    return TX.cached(key, function () {
      var N = 512, K = 3, S = N / K, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(8080), i, x, y;
      var img = ctx.createImageData(N, N), d = img.data;
      var vein = tileNoise(N, 8, 4, 515), broad = tileNoise(N, 2, 3, 77), grain = tileNoise(N, 64, 1, 33);
      var A = col(c1), Bc = col(c2), veinC = hsl(c1, 0.04, -0.12, 0.22), slab = [], tmp = new T.Color();
      for (i = 0; i < K * K; i++) slab.push([0.88 + r() * 0.24, r() * 6, r() < 0.5 ? 1 : -1]);
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        var tx = Math.floor(x / S), ty = Math.floor(y / S), s = slab[ty * K + tx], lx = (x - tx * S) / S, ly = (y - ty * S) / S, o = (y * N + x) * 4, n = y * N + x;
        var v = Math.abs(Math.sin((vein[n] * 7 + s[1] + (s[2] > 0 ? lx : ly) * 0.8) * Math.PI));
        var vk = Math.pow(1 - v, 18) * 0.65 + Math.pow(1 - v, 5) * 0.1;
        tmp.copy(A).lerp(Bc, smooth(0.2, 0.8, broad[n]) * 0.85);
        var polish = 1 + 0.16 * Math.max(0, 1 - Math.hypot(lx - 0.3, ly - 0.28) * 1.5);
        var e = Math.min(lx, ly, 1 - lx, 1 - ly) * S, bev = e < 6 ? (lx < 0.5 && lx <= ly && lx <= 1 - ly) || (ly < 0.5 && ly < lx && ly <= 1 - lx) ? 1.12 : 0.8 : 1;
        var f = s[0] * polish * bev * (1 + (grain[n] - 0.5) * 0.07);
        tmp.multiplyScalar(f).lerp(veinC, vk);
        d[o] = Math.min(255, tmp.r * 255); d[o + 1] = Math.min(255, tmp.g * 255); d[o + 2] = Math.min(255, tmp.b * 255); d[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      // gold inlay grout (wraps)
      var goldD = '#3e2c14', gold = '#b48a3a', goldL = '#e8c878';
      ctx.lineCap = 'butt';
      for (var k = 0; k <= K; k++) {
        var p = k * S;
        [[5, goldD], [2.6, gold], [0.9, goldL]].forEach(function (L) {
          ctx.strokeStyle = L[1]; ctx.lineWidth = L[0];
          ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke();
        });
      }
      // gold eight-point stars at the slab corners
      for (var cy = 0; cy <= K; cy++) for (var cx = 0; cx <= K; cx++) star8(ctx, cx * S, cy * S, 11, 3.4, gold, goldD);
      for (var cy2 = 0; cy2 <= K; cy2++) for (var cx2 = 0; cx2 <= K; cx2++) star8(ctx, cx2 * S, cy2 * S, 4.5, 1.6, goldL, null);
      // faint engraved constellations / orbit rings on every other slab
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (var ty2 = 0; ty2 < K; ty2++) for (var tx2 = 0; tx2 < K; tx2++) {
        if ((tx2 + ty2) % 2) continue;
        var ox = tx2 * S, oy = ty2 * S, cxs = ox + S / 2, cys = oy + S / 2;
        ctx.strokeStyle = 'rgba(190,150,70,0.24)';
        ctx.beginPath(); ctx.arc(cxs, cys, S * 0.34, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cxs, cys, S * 0.3, r() * 2, r() * 2 + 4.2); ctx.stroke();
        var pts = []; for (i = 0; i < 5; i++) pts.push([cxs + (r() - 0.5) * S * 0.44, cys + (r() - 0.5) * S * 0.44]);
        ctx.strokeStyle = 'rgba(230,200,130,0.2)'; ctx.beginPath(); pts.forEach(function (q, j) { if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
        pts.forEach(function (q) { ctx.fillStyle = 'rgba(255,236,180,0.45)'; ctx.beginPath(); ctx.arc(q[0], q[1], 2.0, 0, Math.PI * 2); ctx.fill(); });
      }
      return TX.tiled(cv);
    });
  };
  // Gold mosaic for the inlaid walkways (zone.path = the gold tone): small bevelled tesserae, dark grout.
  TX.vaultPathTile = function (pathColor) {
    return TX.cached('pt_vault3_' + col(pathColor).getHexString(), function () {
      var N = 512, cells = 22, cs = N / cells, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(6262);
      var img = ctx.createImageData(N, N), d = img.data, base = col(pathColor), grain = tileNoise(N, 32, 2, 71), broad = tileNoise(N, 4, 3, 19);
      var shade = []; for (var i = 0; i < cells * cells; i++) shade.push([r(), r(), r()]);
      var grout = hsl(base, 0.02, -0.25, -0.36), stone = col('#2c2440').lerp(base, 0.12);
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var off = (Math.floor(y / cs) % 2) * cs * 0.5, xx = (x + off) % N, ci = Math.floor(xx / cs), cj = Math.floor(y / cs), lx = xx - ci * cs, ly = y - cj * cs;
        var e = Math.min(lx, ly, cs - lx, cs - ly), o = (y * N + x) * 4, sp = shade[(cj % cells) * cells + (ci % cells)], g = 1 + (grain[y * N + x] - 0.5) * 0.12, c;
        if (e < 1.6) c = grout;
        else {
          var goldT = sp[2] < 0.42 + 0.3 * (broad[y * N + x] - 0.5);
          c = goldT ? hsl(base, (sp[1] - 0.5) * 0.03, (sp[0] - 0.5) * 0.1 - 0.08, (sp[0] - 0.5) * 0.14 - 0.05 + (broad[y * N + x] - 0.5) * 0.08)
            : hsl(stone, (sp[1] - 0.5) * 0.04, 0, (sp[0] - 0.5) * 0.1);
          var bev = smooth(1.6, 5.5, e), lit = (lx < ly ? 1 : -1) * (1 - bev) * 0.12;
          c.multiplyScalar(0.8 + 0.2 * bev + lit + (lx + ly < cs * 0.7 ? 0.06 : 0));
        }
        d[o] = Math.min(255, c.r * g * 255); d[o + 1] = Math.min(255, c.g * g * 255); d[o + 2] = Math.min(255, c.b * g * 255); d[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return TX.tiled(cv);
    });
  };
  // Crystal star-points set into the floor (emissive mask, red channel): tiny specks and a few four-point stars.
  TX.starFloorTile = function () {
    return TX.cached('env_vaultstars', function () {
      var N = 512, cv = TX.canvas(N), ctx = cv.getContext('2d'), r = TX.rng(7373);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, N, N);
      for (var i = 0; i < 140; i++) {
        var x = r() * N, y = r() * N, big = r() < 0.12, rad = big ? 7 + r() * 5 : 1.2 + r() * 2.2;
        [-N, 0, N].forEach(function (ox) {
          [-N, 0, N].forEach(function (oy) {
            var g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad * (big ? 1 : 2.2));
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillRect(x + ox - rad * 2.2, y + oy - rad * 2.2, rad * 4.4, rad * 4.4);
            if (big) { ctx.fillStyle = '#fff'; [0, Math.PI / 2].forEach(function (rot) { ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(rot + 0.3); ctx.beginPath(); ctx.moveTo(-rad * 2, 0); ctx.quadraticCurveTo(0, -1.4, rad * 2, 0); ctx.quadraticCurveTo(0, 1.4, -rad * 2, 0); ctx.fill(); ctx.restore(); }); }
          });
        });
      }
      return TX.tiled(cv, { aniso: 8 });
    });
  };
})(WF.textures);

// =====================================================================
// §PROPS  (agent S — props & scenery art). Do not edit outside this block.
// Procedural, tileable "painterly" detail texture for scenery materials
// (WF.models toon materials with { paint: true }). 256x256 RGBA, repeat:
//   R = soft low-frequency blotches (paint density / value wobble)
//   G = short oriented brush strokes (the storybook "painted" look)
//   B = fine grain + speckle (stone grit, bark, plaster)
// Sampled triplanar in world space by models.js, so merged batches and
// individual props look identical. Cached; tagged userData.cached.
// =====================================================================
(function () {
  'use strict';
  var WF = window.WF = window.WF || { data: {} };
  var TX = WF.textures = WF.textures || {};
  var cache = null;
  function rngOf(seed) { var s = seed >>> 0 || 1; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // periodic value noise on an n x n lattice (tiles perfectly over [0,1)^2)
  function lattice(n, r) { var a = new Float32Array(n * n); for (var i = 0; i < a.length; i++) a[i] = r(); return a; }
  function sampleP(lat, n, u, v) {
    var x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var i0 = ((x0 % n) + n) % n, j0 = ((y0 % n) + n) % n, i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
    var a = lat[j0 * n + i0], b = lat[j0 * n + i1], c = lat[j1 * n + i0], d = lat[j1 * n + i1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  TX.propDetail = function () {
    if (cache) return cache;
    if (typeof document === 'undefined' || !window.THREE) return null;
    var N = 256, r = rngOf(9127), i, j;
    var L4 = lattice(4, r), L8 = lattice(8, r), L16 = lattice(16, r), L32 = lattice(32, r), L64 = lattice(64, r);
    var R = new Float32Array(N * N), B = new Float32Array(N * N);
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var u = i / N, v = j / N;
      R[j * N + i] = sampleP(L4, 4, u, v) * 0.45 + sampleP(L8, 8, u, v) * 0.33 + sampleP(L16, 16, u, v) * 0.22;
      B[j * N + i] = sampleP(L32, 32, u, v) * 0.45 + sampleP(L64, 64, u, v) * 0.35 + r() * 0.2;
    }
    // brush strokes, drawn wrapped so the tile is seamless
    var sc = document.createElement('canvas'); sc.width = N; sc.height = N;
    var x = sc.getContext('2d');
    x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, N, N);
    x.lineCap = 'round';
    var dirs = [0.35, 0.9, 2.2, 2.75];
    for (var s = 0; s < 1400; s++) {
      var cx = r() * N, cy = r() * N, a = dirs[Math.floor(r() * dirs.length)] + (r() - 0.5) * 0.5;
      var len = 6 + r() * 18, w = 1.5 + r() * 4.5, g = Math.round(128 + (r() - 0.5) * 2 * (40 + r() * 60));
      x.strokeStyle = 'rgba(' + g + ',' + g + ',' + g + ',' + (0.18 + r() * 0.3).toFixed(3) + ')';
      x.lineWidth = w;
      var dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var px = cx + ox * N, py = cy + oy * N;
        if (px < -len || px > N + len || py < -len || py > N + len) continue;
        x.beginPath(); x.moveTo(px - dx, py - dy);
        x.quadraticCurveTo(px + dy * 0.25, py - dx * 0.25, px + dx, py + dy); x.stroke();
      }
    }
    var G = x.getImageData(0, 0, N, N).data;
    var c = document.createElement('canvas'); c.width = N; c.height = N;
    var cx2 = c.getContext('2d'), img = cx2.createImageData(N, N), d = img.data;
    var rmin = 1, rmax = 0, bmin = 1, bmax = 0;
    for (i = 0; i < N * N; i++) { rmin = Math.min(rmin, R[i]); rmax = Math.max(rmax, R[i]); bmin = Math.min(bmin, B[i]); bmax = Math.max(bmax, B[i]); }
    for (i = 0; i < N * N; i++) {
      d[i * 4] = Math.round((R[i] - rmin) / (rmax - rmin) * 255);
      d[i * 4 + 1] = G[i * 4];
      d[i * 4 + 2] = Math.round((B[i] - bmin) / (bmax - bmin) * 255);
      d[i * 4 + 3] = 255;
    }
    cx2.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.userData.cached = true;
    return (cache = t);
  };
})();
// §PROPS end
