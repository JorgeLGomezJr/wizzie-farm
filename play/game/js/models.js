// =====================================================================
//  WIZZIE FARM — MODELS  (technical-artist)
//  Every visible thing in the game is built here from Three.js primitives.
//  No model files, no image textures (a few tiny canvas textures only).
//
//  Look: chunky, toon-shaded, storybook low-poly.
//   * MeshToonMaterial + ONE shared 3-step gradient (NearestFilter).
//   * Static parts are MERGED into a single vertex-coloured geometry per
//     moving part (Builder below). Characters are then packed into ONE
//     rigidly-skinned mesh + one halo batch (skinify, v0.3) and static props
//     use one toon + one glow material (oneToon) => very few draw calls.
//   * Glowing bits (eyes, gems, windows, runes) use unlit MeshBasicMaterial
//     plus cheap additive halo sprites.
//
//  Public API: see docs/ARCHITECTURE.md ("models.js — WF.models").
//  Conventions: origin at feet (y = 0), facing +Z, units ~ metres.
//  anim(t, state, dt): t = seconds (monotonic), state = idle|walk|cast|hit.
//  anim() only ever moves CHILD objects, never the root, so the engine is
//  free to position / rotate / scale the returned root Group.
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  'use strict';
  var T = window.THREE;
  var PI = Math.PI, TAU = Math.PI * 2;
  var M = {};
  var inited = false, gradient = null;
  var matCache = {}, texCache = {}, propCache = {};

  // ------------------------------------------------------------------
  //  Small utils
  // ------------------------------------------------------------------
  function C(c) {
    if (c instanceof T.Color) return c.clone();
    if (c === undefined || c === null) return new T.Color(0xffffff);
    return new T.Color(c);
  }
  function hx(c) { return C(c).getHexString(); }
  // f > 0 lightens toward white, f < 0 darkens
  function sh(c, f) { var k = C(c); return f >= 0 ? k.lerp(new T.Color(1, 1, 1), f) : k.multiplyScalar(1 + f); }
  function mix(a, b, t) { return C(a).lerp(C(b), t); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function V3(a) { return new T.Vector3(a[0], a[1], a[2]); }

  // ------------------------------------------------------------------
  //  init + materials
  // ------------------------------------------------------------------
  // v1.1 (R): shared glow-boost uniform. WF.gfx sets .value per quality (> 1 with
  // post-processing, 1 without); every unlit glow multiplies its colour by it so the
  // bloom pass picks glows out (eyes, gems, windows, portals, crystals, spells).
  M.glowBoost = M.glowBoost || { value: 1.0 };
  // Environment density multipliers (grass blades, ambient particles); set by WF.gfx tiers.
  M.envDensity = M.envDensity || { grass: 1, particles: 1 };
  // onBeforeCompile hook for MeshBasic / Sprite / Points materials: ONE function object
  // for every boosted material, so they share one program per material type.
  function boostCompile(shader) {
    shader.uniforms.glowBoost = M.glowBoost;
    shader.fragmentShader = 'uniform float glowBoost;\n' +
      shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.rgb *= glowBoost;\n#include <alphatest_fragment>');
  }
  M.boostCompile = boostCompile;

  M.init = function () {
    if (inited) return M;
    inited = true;
    // 3-step toon ramp: shadow / mid / lit
    var d = new Uint8Array([100, 100, 100, 255, 172, 172, 172, 255, 240, 240, 240, 255]);
    gradient = new T.DataTexture(d, 3, 1, T.RGBAFormat);
    gradient.minFilter = T.NearestFilter;
    gradient.magFilter = T.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
    gradient.userData.cached = true;
    return M;
  };
  function need() { if (!inited) M.init(); }

  // Toon material cache. opts: { flat, vc, emissive, emissiveIntensity, opacity, side, paint }
  // paint: true -> painterly surface detail (v1.1, agent S): a tileable brush-stroke / blotch
  // texture (WF.textures.propDetail, textures.js §PROPS) sampled triplanar in WORLD space
  // modulates the albedo, so static batches and single props look identical. Strength is the
  // shared uniform WF.models.paint.value (0 = off; gfx/quality code may tune it).
  M.paint = { value: 0.45 };
  var PAINT_GLSL = [
    '\t{',
    '\t\tvec3 wfB = abs( vWfN ); wfB *= wfB; wfB *= wfB; wfB /= max( wfB.x + wfB.y + wfB.z, 1e-4 );',
    '\t\tvec4 wfA = texture2D( wfPaintTex, vWfP.zy * 0.29 ) * wfB.x + texture2D( wfPaintTex, vWfP.xz * 0.29 ) * wfB.y + texture2D( wfPaintTex, vWfP.xy * 0.29 ) * wfB.z;',
    '\t\tvec4 wfC = texture2D( wfPaintTex, vWfP.zy * 1.13 + 0.37 ) * wfB.x + texture2D( wfPaintTex, vWfP.xz * 1.13 + 0.37 ) * wfB.y + texture2D( wfPaintTex, vWfP.xy * 1.13 + 0.37 ) * wfB.z;',
    '\t\tfloat wfD = ( wfA.r - 0.5 ) * 0.75 + ( wfA.g - 0.5 ) * 0.85 + ( wfC.g - 0.5 ) * 0.45 + ( wfC.b - 0.5 ) * 0.4;',
    '\t\tfloat wfL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
    '\t\tdiffuseColor.rgb *= 1.0 + wfPaint * wfD * ( 1.15 - 0.55 * wfL );',
    '\t\tdiffuseColor.rgb = max( mix( vec3( wfL ), diffuseColor.rgb, 1.0 + wfPaint * ( wfA.r - 0.45 ) * 0.9 ), 0.0 );',
    '\t}'].join('\n');
  // v1.1 polish (B8): explore-camera see-through. Props (painted, incl. static batches) that sit
  // between the camera and the player are stippled away inside a soft screen circle around the
  // player (ordered dither, ~80 % cut, so a ghost of the prop remains), plus anything hugging the
  // camera. world.js writes M.seeThrough.value = (player ndc.x * aspect, ndc.y, radius, player
  // view depth); w = 0 turns it off (duels, title). Shadow passes are unaffected.
  M.seeThrough = M.seeThrough || { value: new T.Vector4(0, 0, 0, 0) };
  var SEE_GLSL = [
    '\tif ( wfSee.w > 0.0 ) {',
    '\t\tvec2 wfSd = vWfC.xy / vWfC.z - wfSee.xy;',
    '\t\tfloat wfNear = wfSee.w - vViewPosition.z;',
    '\t\tfloat wfK = ( 1.0 - smoothstep( 0.55, 1.0, length( wfSd ) / wfSee.z ) ) * smoothstep( 0.5, 1.5, wfNear ) * 0.8;',
    '\t\twfK = max( wfK, 1.0 - smoothstep( 0.9, 1.7, vViewPosition.z ) );',
    '\t\tvec2 wfQ = floor( gl_FragCoord.xy ), wfH = floor( wfQ * 0.5 );',
    '\t\tfloat wfBy = fract( dot( wfH, vec2( 0.5, wfH.y * 0.75 ) ) ) * 0.25 + fract( dot( wfQ, vec2( 0.5, wfQ.y * 0.75 ) ) );',
    '\t\tif ( wfBy < wfK ) discard;',
    '\t}'].join('\n');
  function paintify(m) {
    var tex = WF.textures && WF.textures.propDetail ? WF.textures.propDetail() : null;
    if (!tex) return;
    m.onBeforeCompile = function (s) {
      s.uniforms.wfPaintTex = { value: tex };
      s.uniforms.wfPaint = M.paint;
      s.uniforms.wfSee = M.seeThrough;
      s.vertexShader = 'varying vec3 vWfP;\nvarying vec3 vWfN;\nvarying vec3 vWfC;\n' + s.vertexShader.replace('#include <fog_vertex>',
        '#include <fog_vertex>\n\tvWfP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvWfN = normalize( mat3( modelMatrix ) * objectNormal );' +
        '\n\tvWfC = vec3( gl_Position.x * projectionMatrix[1][1] / projectionMatrix[0][0], gl_Position.y, gl_Position.w );');
      s.fragmentShader = 'uniform sampler2D wfPaintTex;\nuniform float wfPaint;\nuniform vec4 wfSee;\nvarying vec3 vWfP;\nvarying vec3 vWfN;\nvarying vec3 vWfC;\n' +
        s.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + SEE_GLSL)
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + PAINT_GLSL);
    };
    m.customProgramCacheKey = function () { return 'wfPaint2'; };
  }
  M.toon = function (color, o) {
    need(); o = o || {};
    var key = 't' + hx(color) + (o.flat ? 'f' : '') + (o.vc ? 'v' : '') +
      (o.emissive !== undefined ? 'e' + hx(o.emissive) + (o.emissiveIntensity || 1) : '') +
      (o.opacity !== undefined ? 'o' + o.opacity : '') + (o.side ? 's' + o.side : '') + (o.paint ? 'p' : '');
    if (matCache[key]) return matCache[key];
    var m = new T.MeshToonMaterial({ color: C(color), gradientMap: gradient });
    if (o.vc) m.vertexColors = true;
    if (o.flat) m.flatShading = true;
    if (o.emissive !== undefined) { m.emissive = C(o.emissive); m.emissiveIntensity = o.emissiveIntensity || 1; }
    if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    if (o.side) m.side = o.side;
    if (o.paint) paintify(m);
    m.userData.cached = true;
    return (matCache[key] = m);
  };
  // Unlit glow material (eyes, gems, windows, magic)
  M.glow = function (color, opacity, additive) {
    need();
    var key = 'g' + hx(color) + '|' + (opacity === undefined ? 1 : opacity) + (additive ? 'a' : '');
    if (matCache[key]) return matCache[key];
    var m = new T.MeshBasicMaterial({ color: C(color) });
    if (opacity !== undefined && opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    if (additive) { m.transparent = true; m.blending = T.AdditiveBlending; m.depthWrite = false; m.forceSinglePass = true; }
    m.side = T.DoubleSide;
    m.toneMapped = false;
    m.onBeforeCompile = boostCompile;
    m.userData.cached = true;
    return (matCache[key] = m);
  };
  function vcMat(flat) { return M.toon(0xffffff, { vc: true, flat: !!flat }); }
  function vcGlowMat() {
    if (matCache.vcglow) return matCache.vcglow;
    var m = new T.MeshBasicMaterial({ vertexColors: true }); m.toneMapped = false;
    m.onBeforeCompile = boostCompile;
    m.userData.cached = true;
    return (matCache.vcglow = m);
  }

  // ------------------------------------------------------------------
  //  Canvas textures
  // ------------------------------------------------------------------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function haloTex() {
    if (texCache.halo) return texCache.halo;
    var c = canvas(64, 64), x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    var t = new T.CanvasTexture(c);
    t.userData.cached = true;
    return (texCache.halo = t);
  }
  function halo(color, size, opacity) {
    var key = 'h' + hx(color) + (opacity === undefined ? 1 : opacity);
    var m = matCache[key];
    if (!m) {
      m = matCache[key] = new T.SpriteMaterial({ map: haloTex(), color: C(color), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity === undefined ? 1 : opacity });
      m.toneMapped = false;
      m.onBeforeCompile = boostCompile;
      m.userData.cached = true;
    }
    var s = new T.Sprite(m);
    s.scale.set(size, size, 1);
    s.userData.base = size;
    return s;
  }

  // ------------------------------------------------------------------
  //  Shared caches (v0.2). Anything handed out from a cache is TAGGED so
  //  WF.models.dispose() never frees it:
  //    material.userData.cached = true      texture.userData.cached = true
  //    geometry.userData.sharedGeometry = true (and the mesh too)
  // ------------------------------------------------------------------
  var geoCache = {};
  function SG(key, make) {
    var g = geoCache[key];
    if (!g) { g = geoCache[key] = make(); g.userData.sharedGeometry = true; }
    return g;
  }
  function smesh(geo, mat) { var m = new T.Mesh(geo, mat); m.userData.sharedGeometry = true; return m; }
  function cmat(key, make) {
    var m = matCache[key];
    if (!m) { m = matCache[key] = make(); m.userData.cached = true; if (m.toneMapped !== undefined) m.toneMapped = false; }
    return m;
  }
  function ctex(key, make) {
    var t = texCache[key];
    if (!t) { t = texCache[key] = make(); t.userData.cached = true; }
    return t;
  }
  // Unit primitives (shared). Bases sit at y = 0 where it matters.
  var UG = {
    sph: function () { return SG('u_sph', function () { return new T.SphereGeometry(1, 16, 12); }); },
    sphLo: function () { return SG('u_sphLo', function () { return new T.SphereGeometry(1, 9, 7); }); },
    oct: function () { return SG('u_oct', function () { return new T.OctahedronGeometry(1, 0); }); },
    dod: function () { return SG('u_dod', function () { return new T.DodecahedronGeometry(1, 0); }); },
    ico: function () { return SG('u_ico', function () { return new T.IcosahedronGeometry(1, 0); }); },
    cone: function () { return SG('u_cone', function () { var g = new T.ConeGeometry(1, 1, 9, 1, true); g.translate(0, 0.5, 0); return g; }); },
    cone5: function () { return SG('u_cone5', function () { var g = new T.ConeGeometry(1, 1, 5, 1); g.translate(0, 0.5, 0); return g; }); },
    cyl: function () { return SG('u_cyl', function () { var g = new T.CylinderGeometry(1, 1, 1, 18, 1, true); g.translate(0, 0.5, 0); return g; }); },
    cylT: function () { return SG('u_cylT', function () { var g = new T.CylinderGeometry(0.55, 1, 1, 18, 4, true); g.translate(0, 0.5, 0); return g; }); },
    ring: function () { return SG('u_ring', function () { var g = new T.RingGeometry(0.8, 1, 48); g.rotateX(-PI / 2); return g; }); },
    disc: function () { return SG('u_disc', function () { var g = new T.CircleGeometry(1, 40); g.rotateX(-PI / 2); return g; }); },
    plane: function () { return SG('u_plane', function () { var g = new T.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return g; }); },
    tor: function () { return SG('u_tor', function () { var g = new T.TorusGeometry(1, 0.07, 6, 40); g.rotateX(PI / 2); return g; }); }
  };
  // Builder output cached under a key; every merged geometry is tagged shared.
  function cachedGeos(key, build) {
    var k = 'b_' + key, e = geoCache[k];
    if (!e) {
      var B = new Builder(); build(B);
      e = geoCache[k] = B.geos();
      ['s', 'f', 'g', 'e'].forEach(function (b) { if (e[b]) e[b].userData.sharedGeometry = true; });
    }
    return e;
  }

  // ------------------------------------------------------------------
  //  Geometry helpers (each call returns a FRESH geometry)
  // ------------------------------------------------------------------
  var G = {
    box: function (w, h, d) { return new T.BoxGeometry(w, h, d); },
    cyl: function (rt, rb, h, s, open) { return new T.CylinderGeometry(rt, rb, h, s || 10, 1, !!open); },
    cone: function (r, h, s) { return new T.ConeGeometry(r, h, s || 10); },
    sph: function (r, w, h) { return new T.SphereGeometry(r, w || 14, h || 10); },
    hemi: function (r, w, h) { return new T.SphereGeometry(r, w || 14, h || 6, 0, TAU, 0, PI / 2); },
    ico: function (r, d) { return new T.IcosahedronGeometry(r, d || 0); },
    dod: function (r, d) { return new T.DodecahedronGeometry(r, d || 0); },
    oct: function (r) { return new T.OctahedronGeometry(r, 0); },
    tor: function (R, r, rs, ts, arc) { return new T.TorusGeometry(R, r, rs || 6, ts || 16, arc || TAU); },
    disc: function (r, s) { return new T.CircleGeometry(r, s || 16); },
    lathe: function (pts, s) { return new T.LatheGeometry(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), s || 12); }
  };
  // Curved tube that tapers from r0 to r1 (horns, tails, branches, roots, vines)
  G.taper = function (pts, r0, r1, ts, rs) {
    ts = ts || 10; rs = rs || 5;
    var curve = new T.CatmullRomCurve3(pts.map(V3));
    var g = new T.TubeGeometry(curve, ts, 1, rs, false);
    var pos = g.attributes.position, P = new T.Vector3(), Q = new T.Vector3();
    for (var i = 0; i <= ts; i++) {
      var u = i / ts; curve.getPointAt(u, P);
      var rad = r0 + (r1 - r0) * u;
      for (var j = 0; j <= rs; j++) {
        var k = i * (rs + 1) + j;
        Q.fromBufferAttribute(pos, k).sub(P).multiplyScalar(rad).add(P);
        pos.setXYZ(k, Q.x, Q.y, Q.z);
      }
    }
    g.computeVertexNormals();
    return g;
  };
  // Floppy wizard-hat cone: base at y=0, tip bends toward -Z
  G.hat = function (r, h, bend, seg) {
    var g = new T.CylinderGeometry(0.004, r, h, seg || 14, 7, true);
    g.translate(0, h / 2, 0);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i), u = y / h;
      var b = bend * u * u * u;
      p.setXYZ(i, p.getX(i), y - b * h * 0.35, p.getZ(i) - b * h);
    }
    g.computeVertexNormals();
    return g;
  };
  // Triangular prism along X with apex up (roofs, tents). w = length, d = base width, h = height
  G.prism = function (w, d, h) {
    var g = new T.CylinderGeometry(1, 1, w, 3, 1);
    g.rotateZ(-PI / 2); g.rotateX(-PI / 2);       // axis X, apex +Y
    g.translate(0, 0.5, 0);                       // base at y=0
    g.scale(1, h / 1.5, d / 1.732);
    return g;
  };
  // Displace a geometry outward along normals (inverted-hull outlines)
  function inflate(geo, d) {
    var g = geo.clone(), p = g.attributes.position, n = g.attributes.normal;
    for (var i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
    return g;
  }

  // ------------------------------------------------------------------
  //  Builder: collects coloured primitives, merges them into ONE geometry
  //  per material class (smooth toon / flat toon / unlit glow).
  //  add(geo, color, { p:[x,y,z], r:[x,y,z], s:n|[x,y,z], flat, glow })
  // ------------------------------------------------------------------
  function mtx(o) {
    o = o || {};
    var p = o.p || [0, 0, 0], r = o.r || [0, 0, 0];
    var s = o.s === undefined ? [1, 1, 1] : (typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s);
    var q = o.dir ? new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), V3(o.dir).normalize())
      : new T.Quaternion().setFromEuler(new T.Euler(r[0], r[1], r[2], o.order || 'XYZ'));
    return new T.Matrix4().compose(V3(p), q, V3(s));
  }
  function Builder() { this.parts = { s: [], f: [], g: [], e: [] }; }
  Builder.prototype.add = function (geo, color, o) {
    o = o || {};
    var bucket = o.glow ? 'g' : o.emis ? 'e' : (o.flat ? 'f' : 's');
    this.parts[bucket].push({ g: geo, c: C(color), m: o.matrix ? o.matrix.clone() : mtx(o) });
    return this;
  };
  Builder.prototype.glow = function (geo, color, o) { o = o || {}; o.glow = true; return this.add(geo, color, o); };
  function mergeParts(parts) {
    var nv = 0, ni = 0, i, j;
    for (i = 0; i < parts.length; i++) {
      var gg = parts[i].g; nv += gg.attributes.position.count; ni += gg.index ? gg.index.count : gg.attributes.position.count;
    }
    var pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    var idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni);
    var vo = 0, io = 0, nm = new T.Matrix3();
    for (i = 0; i < parts.length; i++) {
      var p = parts[i], g = p.g, pa = g.attributes.position, na = g.attributes.normal, cnt = pa.count;
      nm.getNormalMatrix(p.m);
      // v1.2 WS6 (perf): the same maths as Vector3.applyMatrix4 / applyMatrix3 + normalize, inlined on the raw
      // arrays (geometry builders hand us plain, non-interleaved attributes) - wizard builds are ~2x faster
      var e = p.m.elements, q = nm.elements, PA = pa.array, NA = na && na.array, cr = p.c.r, cg = p.c.g, cb = p.c.b, plain = !pa.isInterleavedBufferAttribute && pa.itemSize === 3 && (!na || (!na.isInterleavedBufferAttribute && na.itemSize === 3));
      for (j = 0; j < cnt; j++) {
        var o3 = (vo + j) * 3, x, y, z, w;
        if (plain) { x = PA[j * 3]; y = PA[j * 3 + 1]; z = PA[j * 3 + 2]; } else { x = pa.getX(j); y = pa.getY(j); z = pa.getZ(j); }
        w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        pos[o3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; pos[o3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; pos[o3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
        if (na) {
          if (plain) { x = NA[j * 3]; y = NA[j * 3 + 1]; z = NA[j * 3 + 2]; } else { x = na.getX(j); y = na.getY(j); z = na.getZ(j); }
          var nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nor[o3] = nx / l; nor[o3 + 1] = ny / l; nor[o3 + 2] = nz / l;
        }
        col[o3] = cr; col[o3 + 1] = cg; col[o3 + 2] = cb;
      }
      var flip = p.m.determinant() < 0;
      var ic = g.index ? g.index.count : cnt, IA = g.index && g.index.array;
      for (j = 0; j < ic; j += 3) {
        var a = IA ? IA[j] : j, b = IA ? IA[j + 1] : j + 1, c = IA ? IA[j + 2] : j + 2;
        idx[io + j] = a + vo;
        idx[io + j + 1] = (flip ? c : b) + vo;
        idx[io + j + 2] = (flip ? b : c) + vo;
      }
      vo += cnt; io += ic;
      g.dispose();
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    // (no computeBoundingSphere here: most Builder output is packed straight into a character's skinned mesh;
    //  three computes it lazily on first frustum test / raycast for anything rendered as is)
    return geo;
  }
  // ---- v1.2 WS6 (perf): lazy Builder output while a wizard rig is built (M.wizard). Every toon / glow Builder mesh
  //  of a wizard is packed by skinify straight away, so merging its parts first only to copy them again is wasted
  //  work: in lazy mode the mesh carries an empty geometry with userData.lazyParts and skinify / measureTop read the
  //  parts directly (same vertices, normals, colours and winding as the merged copy). Emissive parts stay merged
  //  (skinify never packs them).
  var _lazyB = 0;
  function lazyGeo(parts) { var g = new T.BufferGeometry(); g.userData.lazyParts = parts; return g; }
  // exact local-space bounds of a lazy geometry (what computeBoundingBox() gives for the merged copy)
  function lazyBox(g) {
    var P = g.userData.lazyParts, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (var i = 0; i < P.length; i++) {
      var pa = P[i].g.attributes.position, e = P[i].m.elements, n = pa.count, A = pa.array, raw = !pa.isInterleavedBufferAttribute && pa.itemSize === 3;
      for (var j = 0; j < n; j++) {
        var x = raw ? A[j * 3] : pa.getX(j), y = raw ? A[j * 3 + 1] : pa.getY(j), z = raw ? A[j * 3 + 2] : pa.getZ(j), w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        var X = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w, Y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, Z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
      }
    }
    g.boundingBox = new T.Box3(new T.Vector3(x0, y0, z0), new T.Vector3(x1, y1, z1));
    return g.boundingBox;
  }
  // -> { s, f, g } merged geometries (or null)
  Builder.prototype.geos = function () {
    var L = _lazyB > 0, P = this.parts;
    return {
      s: P.s.length ? (L ? lazyGeo(P.s) : mergeParts(P.s)) : null,
      f: P.f.length ? (L ? lazyGeo(P.f) : mergeParts(P.f)) : null,
      g: P.g.length ? (L ? lazyGeo(P.g) : mergeParts(P.g)) : null,
      e: P.e.length ? mergeParts(P.e) : null
    };
  };
  function meshesFromGeos(geos, o) {
    o = o || {};
    var out = [];
    if (geos.s) out.push(new T.Mesh(geos.s, o.mat || vcMat(false)));
    if (geos.f) out.push(new T.Mesh(geos.f, o.flatMat || vcMat(true)));
    if (geos.e) out.push(new T.Mesh(geos.e, o.emisMat || M.toon(0xffffff, { vc: true, flat: true, emissive: '#444444' })));
    out.forEach(function (m) { m.castShadow = o.shadow !== false; m.receiveShadow = o.receive !== false; });
    if (geos.g) out.push(new T.Mesh(geos.g, vcGlowMat()));
    return out;
  }
  // Build into an Object3D (Group if several meshes, else the single mesh)
  Builder.prototype.build = function (o) {
    var ms = meshesFromGeos(this.geos(), o);
    if (ms.length === 1) return ms[0];
    var grp = new T.Group(); grp.userData.builderGroup = true;   // static wrapper, never animated
    ms.forEach(function (m) { grp.add(m); });
    return grp;
  };
  function pivot(parent, x, y, z) { var g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; }

  function measureTop(root) {
    root.updateMatrixWorld(true);
    var top = 0, box = new T.Box3();
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && !o.userData.noMeasure) {
        if (!o.geometry.boundingBox) { if (o.geometry.userData.lazyParts) lazyBox(o.geometry); else o.geometry.computeBoundingBox(); }
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.y > top) top = box.max.y;
      }
    });
    return top;
  }

  // ------------------------------------------------------------------
  //  Animation rig: tracks time-in-state and resets the body pivot each
  //  frame. custom(t, state, k, dt, e) where k = seconds in current state
  //  and e = { cast: 0..1 (ramps up and holds), hit: 0..1..0 bump }.
  // ------------------------------------------------------------------
  function rig(root, body, custom, opts) {
    opts = opts || {};
    var st = { s: null, t0: 0 };
    var halos = root.userData.eyeHalos || (root.userData.eyeHalos = []);
    root.userData.anim = function (t, state, dt) {
      state = state || 'idle';
      if (state !== st.s) { st.s = state; st.t0 = t; }
      var k = Math.max(0, t - st.t0);
      var e = {
        cast: state === 'cast' || state === 'windup' ? smooth(0, 0.28, k) : 0,   // v2.1 A3: windup glows like a cast
        hit: state === 'hit' ? Math.sin(Math.min(k * 7, PI)) : 0
      };
      body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
      custom(t, state, k, dt || 0.016, e);
      // shared reactions
      if (e.hit > 0) {
        body.rotation.x += -0.38 * e.hit * (opts.hitScale || 1);
        body.position.z += -0.22 * e.hit;
        body.scale.y *= 1 - 0.08 * e.hit;
      }
      var flare = 1 + e.cast * (1.4 + 0.4 * Math.sin(t * 18));
      for (var i = 0; i < halos.length; i++) {
        var hs = halos[i].userData.base * flare;
        halos[i].scale.set(hs, hs, 1);
      }
    };
  }
  function eyeHalos(root, parent, positions, color, size) {
    positions.forEach(function (p) {
      var s = halo(color, size, 0.9);
      s.position.set(p[0], p[1], p[2]);
      parent.add(s);
      (root.userData.eyeHalos = root.userData.eyeHalos || []).push(s);
    });
  }

  // ------------------------------------------------------------------
  //  CHARACTER DRAW-CALL PACKING (v0.3, technical-artist)
  //  Models are still authored as a tree of pivot Groups with one Builder
  //  mesh per pivot (so anim() code stays readable). After a character is
  //  built, skinify() packs the whole rig into ONE SkinnedMesh:
  //   * every pivot (or self-animated mesh) becomes a "bone"; vertices are
  //     rigidly bound to it (weight 1), so anim() keeps moving the very same
  //     Group objects and the look/animation are unchanged;
  //   * flat-shaded parts get baked face normals (identical to flatShading),
  //     DoubleSide cloth/hoods/wings get a back-face copy with flipped
  //     normals (identical to DoubleSide lighting), unlit glow parts are
  //     flagged per vertex and rendered unlit in the same draw call;
  //   * per-vertex flag `wfx`: 0 = toon lit, no received shadow (wizard face,
  //     hoods, capes), 1 = toon lit + receives shadow, 2 = unlit glow (never
  //     casts: the depth material discards it);
  //   * halo sprites become non-rendering proxies (layers mask 0) and are
  //     drawn by ONE camera-facing quad batch per character (haloBatch).
  //  Result: 1 draw call + 1 shadow draw call for the body, +1 for halos,
  //  +1–2 for each remaining translucent part (sprite wings, wraith tail,
  //  herald hem). Per-instance geometry is NOT tagged, so dispose() frees it;
  //  the skeleton's bone texture is freed through mesh.userData.dispose.
  // ------------------------------------------------------------------
  var EMPTY_GEO = null;
  function emptyGeo() {
    if (!EMPTY_GEO) { EMPTY_GEO = new T.BufferGeometry(); EMPTY_GEO.setAttribute('position', new T.Float32BufferAttribute([], 3)); EMPTY_GEO.userData.sharedGeometry = true; }
    return EMPTY_GEO;
  }
  function wfxVert(sh) {
    return 'attribute float wfx;\nvarying float vWfx;\nvarying vec3 vWfLocal;\n' +
      sh.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWfx = wfx; vWfLocal = position;');
  }
  // ---- v1.1 (C2): character shader extras, all uniform-driven so every character shares ONE program.
  //  wfRim/wfRimColor  crisp toon fresnel rim (0 = off: wizards look exactly as before)
  //  wfGlowBoost       = WF.models.glowBoost (shared object): unlit glow parts (wfx 2) x boost so bloom picks them out
  //  wfFlash           hit flash (mix toward wfFlashColor)
  //  wfDissolve 0..1   noise dissolve with glowing edge (enemy defeat), wfDisH = model height (bind pose)
  var WF_NOISE = [
    'float wfH3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }',
    'float wfNoise( vec3 x ) { vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );',
    '  return mix( mix( mix( wfH3( i ), wfH3( i + vec3( 1, 0, 0 ) ), f.x ), mix( wfH3( i + vec3( 0, 1, 0 ) ), wfH3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),',
    '             mix( mix( wfH3( i + vec3( 0, 0, 1 ) ), wfH3( i + vec3( 1, 0, 1 ) ), f.x ), mix( wfH3( i + vec3( 0, 1, 1 ) ), wfH3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }',
    'float wfDis( vec3 lp, float h ) { return wfNoise( lp * 4.2 ) * 0.55 + wfNoise( lp * 11.0 ) * 0.2 + clamp( 1.0 - lp.y / max( h, 0.1 ), 0.0, 1.0 ) * 0.25; }'
  ].join('\n');
  function skinUniforms(o) {
    o = o || {};
    return {
      wfRimColor: { value: C(o.rim || '#000000') }, wfRim: { value: o.rim ? (o.rimStrength == null ? 0.55 : o.rimStrength) : 0 },
      wfFlash: { value: 0 }, wfFlashColor: { value: C(o.flashColor || '#fff4ea') },
      wfDissolve: { value: 0 }, wfEdgeColor: { value: C(o.edge || HOLLOW_GREEN) }, wfDisH: { value: o.height || 2 }
    };
  }
  function makeSkinMat(u) {
    var m = new T.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, vertexColors: true });
    m.onBeforeCompile = function (s) {
      s.uniforms.wfGlowBoost = M.glowBoost;
      for (var k in u) s.uniforms[k] = u[k];
      s.vertexShader = wfxVert(s.vertexShader);
      s.fragmentShader = 'varying float vWfx;\nvarying vec3 vWfLocal;\nuniform float wfGlowBoost, wfRim, wfFlash, wfDissolve, wfDisH;\nuniform vec3 wfRimColor, wfFlashColor, wfEdgeColor;\n' + WF_NOISE + '\n' + s.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tfloat wfEdge = 0.0;\n\tif ( wfDissolve > 0.0 ) { float wn = wfDis( vWfLocal, wfDisH ) - ( wfDissolve * 1.3 - 0.15 ); if ( wn < 0.0 ) discard; wfEdge = 1.0 - smoothstep( 0.0, 0.07, wn ); }')
        .replace('#include <lights_fragment_begin>', T.ShaderChunk.lights_fragment_begin.replace(/receiveShadow/g, '( receiveShadow && vWfx > 0.5 && vWfx < 1.5 )'))
        .replace('#include <output_fragment>', [
          'float wfG = step( 1.5, vWfx );',
          'outgoingLight = mix( outgoingLight, diffuseColor.rgb * wfGlowBoost, wfG );',
          'if ( wfRim > 0.0 ) { float wfF = 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );',
          '  outgoingLight += wfRimColor * ( smoothstep( 0.52, 0.8, wfF ) * wfRim * ( 1.0 - wfG ) ); }',
          'outgoingLight = mix( outgoingLight, wfFlashColor, wfFlash * ( 1.0 - wfG * 0.7 ) );',
          'outgoingLight += wfEdgeColor * ( wfEdge * 1.6 * wfGlowBoost );',
          '#include <output_fragment>'].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'wfSkinToon2'; };
    m.userData.u = u;
    return m;
  }
  function makeSkinDepth(u) {
    var m = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    m.onBeforeCompile = function (s) {
      s.uniforms.wfDissolve = u.wfDissolve; s.uniforms.wfDisH = u.wfDisH;
      s.vertexShader = wfxVert(s.vertexShader);
      s.fragmentShader = 'varying float vWfx;\nvarying vec3 vWfLocal;\nuniform float wfDissolve, wfDisH;\n' + WF_NOISE + '\n' + s.fragmentShader.replace('void main() {',
        'void main() {\n\tif ( vWfx > 1.5 ) discard;\n\tif ( wfDissolve > 0.0 && wfDis( vWfLocal, wfDisH ) < wfDissolve * 1.3 - 0.15 ) discard;');
    };
    m.customProgramCacheKey = function () { return 'wfSkinDepth2'; };
    return m;
  }
  // Shared vertex-colour toon for packed characters (+ unlit glow + per-vertex shadow receive).
  // No options -> the shared cached material (wizards; rim off). With options (enemies: rim colour,
  // flash, dissolve) -> a per-instance material on the same program (freed by dispose()).
  function skinMat(o) {
    if (o) return makeSkinMat(skinUniforms(o));
    if (matCache.vcskin) return matCache.vcskin;
    var m = makeSkinMat(skinUniforms(null));
    m.userData.cached = true;
    return (matCache.vcskin = m);
  }
  // Shadow depth for packed characters: glow parts never cast (as before); dissolving parts don't either.
  function skinDepthMat(u) {
    if (u) return makeSkinDepth(u);
    if (matCache.vcskinDepth) return matCache.vcskinDepth;
    var m = makeSkinDepth(skinUniforms(null));
    m.userData.cached = true;
    return (matCache.vcskinDepth = m);
  }
  // Geometry accumulator: rigid parts -> one indexed geometry in root space
  // v1.2 WS6 (perf): growable typed arrays written in place (was JS arrays + push; same output)
  function Packer() { this.n = 0; this.ni = 0; this.cv = 0; this.ci = 0; this.reserve(2048, 6144); }
  Packer.prototype.reserve = function (addV, addI) {
    var nv = this.n + addV, ni = this.ni + addI, k;
    if (nv > this.cv) {
      var cv = Math.max(nv, this.cv * 2), o = this;
      [['pos', 3, Float32Array], ['nor', 3, Float32Array], ['col', 3, Float32Array], ['wfx', 1, Float32Array], ['si', 4, Uint16Array]].forEach(function (d) {
        var a = new d[2](cv * d[1]); if (o[d[0]]) a.set(o[d[0]].subarray(0, o.n * d[1])); o[d[0]] = a;
      });
      this.cv = cv;
    }
    if (ni > this.ci) { var ci = Math.max(ni, this.ci * 2), ix = new Uint32Array(ci); if (this.idx) ix.set(this.idx.subarray(0, this.ni)); this.idx = ix; this.ci = ci; }
  };
  var _pa = new T.Vector3(), _pb = new T.Vector3(), _pc = new T.Vector3(), _pn = new T.Vector3(), _pd = new T.Vector3(), _nm3 = new T.Matrix3(), _pcol = [1, 1, 1];
  Packer.prototype.vert = function (p, n, c, w, bone) {
    var v = this.n, o3 = v * 3;
    this.pos[o3] = p.x; this.pos[o3 + 1] = p.y; this.pos[o3 + 2] = p.z;
    this.nor[o3] = n.x; this.nor[o3 + 1] = n.y; this.nor[o3 + 2] = n.z;
    this.col[o3] = c[0]; this.col[o3 + 1] = c[1]; this.col[o3 + 2] = c[2];
    this.wfx[v] = w; this.si[v * 4] = bone;
    return this.n++;
  };
  // geo: source geometry; m: Matrix4 to root space; color: null (use attribute) or T.Color;
  // flat: bake face normals; dbl: add a flipped back-face copy
  Packer.prototype.add = function (geo, m, color, w, bone, flat, dbl) {
    var P = geo.attributes.position, N = geo.attributes.normal, CA = geo.attributes.color, I = geo.index;
    if (!P || !P.count) return;
    var cnt = I ? I.count : P.count, det = m.determinant() < 0, self = this, i, k, sides = dbl ? 2 : 1;
    this.reserve((flat ? cnt : P.count) * sides, cnt * sides);
    _nm3.getNormalMatrix(m);
    function colAt(v) { if (color) { _pcol[0] = color.r; _pcol[1] = color.g; _pcol[2] = color.b; } else if (CA) { _pcol[0] = CA.getX(v); _pcol[1] = CA.getY(v); _pcol[2] = CA.getZ(v); } else { _pcol[0] = _pcol[1] = _pcol[2] = 1; } return _pcol; }
    function vi(j) { return I ? I.getX(j) : j; }
    for (var side = 0; side < sides; side++) {
      var back = side === 1, swap = det !== back, idx = this.idx;
      if (flat) {
        for (i = 0; i < cnt; i += 3) {
          var a = vi(i), b = vi(swap ? i + 2 : i + 1), c = vi(swap ? i + 1 : i + 2);
          _pa.fromBufferAttribute(P, a).applyMatrix4(m); _pb.fromBufferAttribute(P, b).applyMatrix4(m); _pc.fromBufferAttribute(P, c).applyMatrix4(m);
          _pn.subVectors(_pc, _pb).cross(_pd.subVectors(_pa, _pb)).normalize();
          idx[self.ni++] = self.vert(_pa, _pn, colAt(a), w, bone); idx[self.ni++] = self.vert(_pb, _pn, colAt(b), w, bone); idx[self.ni++] = self.vert(_pc, _pn, colAt(c), w, bone);
        }
      } else {
        // Vector3.applyMatrix4 / applyMatrix3 + normalize inlined on the raw arrays (same maths)
        var o = this.n, e = m.elements, q = _nm3.elements, sg = back ? -1 : 1, pos = this.pos, nor = this.nor, col = this.col, wfx = this.wfx, si = this.si;
        var raw = !P.isInterleavedBufferAttribute && P.itemSize === 3 && (!N || (!N.isInterleavedBufferAttribute && N.itemSize === 3)), PA = P.array, NA = N && N.array;
        var cr = color ? color.r : 1, cg = color ? color.g : 1, cb = color ? color.b : 1;
        for (k = 0; k < P.count; k++) {
          var x, y, z, ww, v3 = (o + k) * 3;
          if (raw) { x = PA[k * 3]; y = PA[k * 3 + 1]; z = PA[k * 3 + 2]; } else { x = P.getX(k); y = P.getY(k); z = P.getZ(k); }
          ww = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
          pos[v3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * ww; pos[v3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * ww; pos[v3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * ww;
          if (N) {
            if (raw) { x = NA[k * 3]; y = NA[k * 3 + 1]; z = NA[k * 3 + 2]; } else { x = N.getX(k); y = N.getY(k); z = N.getZ(k); }
            var nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z, l = sg / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
            nor[v3] = nx * l; nor[v3 + 1] = ny * l; nor[v3 + 2] = nz * l;
          } else { nor[v3] = 0; nor[v3 + 1] = sg; nor[v3 + 2] = 0; }
          if (!color && CA) { col[v3] = CA.getX(k); col[v3 + 1] = CA.getY(k); col[v3 + 2] = CA.getZ(k); } else { col[v3] = cr; col[v3 + 1] = cg; col[v3 + 2] = cb; }
          wfx[o + k] = w; si[(o + k) * 4] = bone;
        }
        this.n += P.count;
        var IA = I && I.array, ni = this.ni;
        for (i = 0; i < cnt; i += 3) {
          var a2 = IA ? IA[i] : i, b2 = IA ? IA[i + 1] : i + 1, c2 = IA ? IA[i + 2] : i + 2;
          idx[ni++] = o + a2; idx[ni++] = o + (swap ? c2 : b2); idx[ni++] = o + (swap ? b2 : c2);
        }
        this.ni = ni;
      }
    }
  };
  Packer.prototype.index = function () {
    var src = this.idx.subarray(0, this.ni);
    return this.n > 65535 ? new T.BufferAttribute(src.slice(), 1) : new T.BufferAttribute(Uint16Array.from(src), 1);
  };
  Packer.prototype.geometry = function (withWfx) {
    var g = new T.BufferGeometry(), n = this.n;
    g.setAttribute('position', new T.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new T.BufferAttribute(this.nor.slice(0, n * 3), 3));
    g.setAttribute('color', new T.BufferAttribute(this.col.slice(0, n * 3), 3));
    if (withWfx) g.setAttribute('wfx', new T.BufferAttribute(this.wfx.slice(0, n), 1));
    g.setAttribute('skinIndex', new T.BufferAttribute(this.si.slice(0, n * 4), 4));
    var sw = new Float32Array(n * 4); for (var i = 0; i < n; i++) sw[i * 4] = 1;
    g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    g.setIndex(this.index());
    g.boundingSphere = this.sphere();
    g.boundingSphere.radius = g.boundingSphere.radius * 1.3 + 0.3;   // headroom for animation (bind-pose sphere)
    return g;
  }
  // v1.2 WS6 (perf): BufferGeometry.computeBoundingSphere() (box centre, max distance) on the raw array
  Packer.prototype.sphere = function () {
    var P = this.pos, n = this.n, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, i;
    if (!n) return new T.Sphere();
    for (i = 0; i < n * 3; i += 3) {
      var x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, r2 = 0;
    for (i = 0; i < n * 3; i += 3) { var dx = P[i] - cx, dy = P[i + 1] - cy, dz = P[i + 2] - cz, d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d; }
    return new T.Sphere(new T.Vector3(cx, cy, cz), Math.sqrt(r2));
  };
  // Exactly position/normal/color + index (what the engine's static-prop merger accepts)
  Packer.prototype.plain = function () {
    var g = new T.BufferGeometry(), n = this.n;
    g.setAttribute('position', new T.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new T.BufferAttribute(this.nor.slice(0, n * 3), 3));
    g.setAttribute('color', new T.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setIndex(this.index());
    g.computeBoundingSphere();
    return g;
  };
  // Static props: fold the flat-shaded bucket into the smooth one (baked face normals look
  // identical to flatShading), so every static prop uses ONE toon material (+ the shared
  // glow material) and the engine can batch them all together per cell.
  var _I4 = new T.Matrix4();
  function oneToon(geos) {
    if (!geos.f) return geos;
    var pk = new Packer();
    if (geos.s) pk.add(geos.s, _I4, null, 1, 0, false, false);
    pk.add(geos.f, _I4, null, 1, 0, true, false);
    if (geos.s) geos.s.dispose(); geos.f.dispose();
    geos.s = pk.plain(); geos.f = null;
    return geos;
  }
  // v1.1 (C2): ONE premultiplied-alpha batch per character for every soft sprite it owns:
  //   kind 0 halo proxies (camera-facing, additive-equivalent: rgb*a, alpha 0 -> identical to the
  //          v0.3 additive halo / SpriteMaterial look, so wizards are unchanged),
  //   kind 1 dark Hollow smoke (premultiplied normal blend: darkens, so it reads on bright zones),
  //   kind 2 rising embers (additive), kind 3 elite crimson-gold ground ring, kind 4 dark ground pool.
  //  Particles are animated entirely in the vertex shader from root.userData.auraState { t, a, d }
  //  (time, intensity, defeat burst) -> no per-frame CPU work, still ONE draw call per character.
  var HALO_MAX = 8;
  var HALO_VS = [
    'uniform vec4 hp[' + HALO_MAX + '];', 'uniform mat4 auraM;', 'uniform float uT, uA, uD;', 'uniform vec4 shape;', 'uniform vec2 life;',
    'attribute vec4 hcol;', 'attribute vec4 pdat;', 'varying vec2 vUv;', 'varying vec4 vCol;', 'varying float vKind;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '\tvKind = pdat.x; vUv = position.xy + 0.5; vCol = hcol;',
    '\tvec4 mvPosition;',
    '\tif ( pdat.x < 0.5 ) {',
    '\t\tvec4 c = hp[ int( position.z + 0.5 ) ];',
    '\t\tmvPosition = viewMatrix * vec4( c.xyz, 1.0 );',
    '\t\tmvPosition.xy += position.xy * c.w;',
    '\t} else if ( pdat.x > 2.5 ) {',
    '\t\tmvPosition = viewMatrix * ( auraM * vec4( position.x * pdat.z, pdat.x > 3.5 ? 0.025 : 0.04, -position.y * pdat.z, 1.0 ) );',
    '\t} else {',
    '\t\tfloat sc = length( auraM[ 0 ].xyz );',
    '\t\tfloat s1 = pdat.y, s2 = fract( s1 * 7.31 + 0.13 ), s3 = fract( s1 * 13.7 + 0.71 );',
    '\t\tbool em = pdat.x > 1.5;',
    '\t\tfloat L = ( em ? life.y : life.x ) * ( 0.8 + 0.4 * s3 );',
    '\t\tfloat ph = fract( uT / L + s1 );',
    '\t\tfloat ang = s1 * 6.2832 + ph * ( em ? 2.6 : 1.2 ) * ( s2 > 0.5 ? 1.0 : -1.0 );',
    '\t\tfloat rr = shape.x * ( 0.3 + 0.7 * s2 ) * ( em ? ( 1.0 - 0.35 * ph ) : ( 0.75 + 0.55 * ph ) );',
    '\t\tfloat yy = shape.w + ph * shape.y * ( em ? ( 0.75 + 0.5 * s3 ) : ( 0.3 + 0.45 * s3 ) );',
    '\t\trr = mix( rr, shape.x * ( 0.15 + 0.85 * s2 ) * ( 0.7 + ph * 0.8 ), uD );',
    '\t\tyy = mix( yy, shape.y * ( 0.05 + 0.6 * s3 ) + ph * shape.y * 0.9, uD );',
    '\t\tmvPosition = viewMatrix * ( auraM * vec4( cos( ang ) * rr, yy, sin( ang ) * rr, 1.0 ) );',
    '\t\tfloat sz = pdat.z * shape.z * sc * ( em ? ( 1.0 - 0.5 * ph ) : ( 0.55 + 0.9 * ph ) ) * ( 1.0 + uD * ( em ? 0.4 : 1.3 ) );',
    '\t\tfloat rot = s1 * 6.28 + ph * ( s2 - 0.5 ) * 3.0;',
    '\t\tvec2 q = position.xy; q = vec2( q.x * cos( rot ) - q.y * sin( rot ), q.x * sin( rot ) + q.y * cos( rot ) );',
    '\t\tmvPosition.xy += q * sz;',
    '\t\tfloat fade = em ? smoothstep( 0.0, 0.12, ph ) * ( 1.0 - ph ) * ( 0.65 + 0.35 * sin( uT * 13.0 + s1 * 40.0 ) ) : sin( ph * 3.14159 );',
    '\t\tvCol.a *= fade * ( em ? uA * ( 1.0 + uD ) : uA * ( 1.0 + uD * 0.9 ) );',
    '\t}',
    '\tgl_Position = projectionMatrix * mvPosition;',
    '\t#include <fog_vertex>',
    '}'].join('\n');
  var HALO_FS = [
    'uniform sampler2D map;', 'uniform float uT, uA, uB;', 'uniform vec3 ringA, ringB, glowC;',
    'varying vec2 vUv;', 'varying vec4 vCol;', 'varying float vKind;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '\tif ( vKind < 0.5 ) {',
    '\t\tvec4 t = texture2D( map, vUv );',
    '\t\tgl_FragColor = vec4( vCol.rgb * t.rgb * uB, vCol.a * t.a );',
    '\t\t#include <encodings_fragment>',
    '\t\t#include <fog_fragment>',
    '\t\tgl_FragColor = vec4( gl_FragColor.rgb * gl_FragColor.a, 0.0 );',
    '\t\treturn;',
    '\t}',
    '\tfloat fk = 1.0;',
    '\t#ifdef USE_FOG',
    '\t#ifdef FOG_EXP2',
    '\tfk = exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    '\t#else',
    '\tfk = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );',
    '\t#endif',
    '\t#endif',
    '\tvec2 p = vUv - 0.5; float d = length( p ) * 2.0; float an = atan( p.y, p.x );',
    '\tif ( vKind < 1.5 ) {',
    '\t\tfloat a = ( 1.0 - smoothstep( 0.12, 1.0, d ) ) * ( 0.88 + 0.12 * sin( an * 2.0 + d * 5.0 + vCol.a * 9.0 ) );',
    '\t\ta = clamp( a, 0.0, 1.0 ) * vCol.a;',
    '\t\tvec3 c = vCol.rgb;',
    '\t\t#ifdef USE_FOG',
    '\t\tc = mix( fogColor, c, fk );',
    '\t\t#endif',
    '\t\tgl_FragColor = vec4( c * a, a );',
    '\t} else if ( vKind < 2.5 ) {',
    '\t\tfloat a = pow( max( 0.0, 1.0 - d ), 2.0 ) * vCol.a;',
    '\t\tgl_FragColor = vec4( ( vCol.rgb + max( 0.0, 0.6 - d ) ) * a * uB * fk, 0.0 );',
    '\t} else if ( vKind < 3.5 ) {',
    '\t\tfloat band = smoothstep( 0.8, 0.86, d ) * ( 1.0 - smoothstep( 0.9, 0.95, d ) );',
    '\t\tfloat edge = smoothstep( 0.93, 0.955, d ) * ( 1.0 - smoothstep( 0.965, 0.995, d ) );',
    '\t\tfloat tk = step( 0.5, fract( an / 6.2832 * 20.0 + uT * 0.12 ) ) * smoothstep( 0.66, 0.69, d ) * ( 1.0 - smoothstep( 0.75, 0.78, d ) );',
    '\t\tfloat inner = ( 1.0 - smoothstep( 0.2, 0.86, d ) );',
    '\t\tfloat pulse = 0.75 + 0.25 * sin( uT * 3.2 );',
    '\t\tvec3 c = ringA * ( band * 0.95 + tk * 0.75 + inner * 0.06 ) * pulse + ringB * edge * 1.1;',
    '\t\tgl_FragColor = vec4( c * uB * fk * vCol.a * uA, ( inner * 0.45 + band * 0.5 ) * vCol.a * min( uA, 1.0 ) * fk );',
    '\t} else {',
    '\t\tfloat sw = 0.82 + 0.18 * sin( an * 5.0 + d * 9.0 - uT * 1.6 );',
    '\t\tfloat a = ( 1.0 - smoothstep( 0.3, 1.0, d ) ) * sw * vCol.a * fk * min( uA, 1.0 );',
    '\t\tfloat gr = smoothstep( 0.5, 0.66, d ) * ( 1.0 - smoothstep( 0.66, 0.86, d ) ) * ( 0.55 + 0.45 * sin( an * 3.0 + uT * 1.7 ) );',
    '\t\tgl_FragColor = vec4( vCol.rgb * a + glowC * gr * 0.22 * uB * fk * min( uA, 1.0 ), a );',
    '\t}',
    '}'].join('\n');
  var PREMULT = { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor };
  function isHaloSprite(o) { return o.isSprite && o.material && o.material.map === texCache.halo && o.material.blending === T.AdditiveBlending; }
  function haloBatch(root, sprites, aura) {
    var groups = [];
    for (var s0 = 0; s0 < sprites.length; s0 += HALO_MAX) groups.push(sprites.slice(s0, s0 + HALO_MAX));
    if (!groups.length) groups.push([]);
    var auraNode = aura ? (aura.node || root) : null;
    groups.forEach(function (list, gi) {
      var pos = [], col = [], pd = [], idx = [], nq = 0;
      function quad(z, c, a, d4) {
        var o = nq * 4; nq++;
        pos.push(-0.5, -0.5, z, 0.5, -0.5, z, 0.5, 0.5, z, -0.5, 0.5, z);
        for (var k = 0; k < 4; k++) { col.push(c.r, c.g, c.b, a); pd.push(d4[0], d4[1], d4[2], d4[3]); }
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
      list.forEach(function (sp, i) {
        var c = sp.userData.hcol ? C(sp.userData.hcol) : sp.material.color, a = sp.material.opacity;
        quad(i, c, a, [0, 0, 0, 0]);
        sp.layers.disableAll();                    // proxy: keeps its transform + anim, never renders itself
        sp.userData.haloProxy = true;
      });
      var A = gi === 0 ? aura : null;
      if (A) {
        var rnd = seeded(A.seed || 7), i2;
        if (A.pool) quad(0, C(A.poolColor || '#140a22'), A.poolAlpha == null ? 0.55 : A.poolAlpha, [4, 0, A.pool * 2, 0]);
        if (A.ring) quad(0, C('#ffffff'), 1, [3, 0, A.ring * 2, 0]);
        var sc1 = C(A.smokeColor || '#1e0f33'), sc2 = A.smokeColor2 ? C(A.smokeColor2) : sc1;
        for (i2 = 0; i2 < (A.smoke || 0); i2++) quad(0, i2 % 2 ? sc2 : sc1, A.smokeAlpha == null ? 0.5 : A.smokeAlpha, [1, (i2 + rnd() * 0.6) / (A.smoke || 1), 0.8 + rnd() * 0.5, 0]);
        var ec = (A.emberColors || [A.emberColor || HOLLOW_GREEN]).map(function (x) { return C(x); });
        for (i2 = 0; i2 < (A.embers || 0); i2++) quad(0, ec[i2 % ec.length], 1, [2, (i2 + rnd() * 0.7) / (A.embers || 1), (0.6 + rnd() * 0.6) * (A.emberSize || 0.16) / (A.size || 0.6), 0]);
      }
      if (!nq) return;
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('hcol', new T.Float32BufferAttribute(col, 4));
      g.setAttribute('pdat', new T.Float32BufferAttribute(pd, 4));
      g.setIndex(idx);
      var hp = new Float32Array(HALO_MAX * 4);
      var U = {
        map: { value: null }, hp: { value: null }, auraM: { value: new T.Matrix4() }, uT: { value: 0 }, uA: { value: 1 }, uD: { value: 0 },
        uB: M.glowBoost, shape: { value: new T.Vector4(A ? A.r || 0.6 : 0, A ? A.h || 1.5 : 0, A ? A.size || 0.6 : 0, A ? A.y0 || 0 : 0) },
        life: { value: new T.Vector2(A ? A.life || 2.6 : 1, A ? A.emberLife || 1.7 : 1) },
        ringA: { value: C(A && A.ringA || '#d8102a') }, ringB: { value: C(A && A.ringB || '#ffcf4a') }, glowC: { value: C(A && A.glow || (A && A.emberColor) || HOLLOW_GREEN) }
      };
      var mat = new T.ShaderMaterial({
        uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {}]),
        vertexShader: HALO_VS, fragmentShader: HALO_FS, fog: true,
        transparent: true, depthWrite: false
      });
      for (var k in U) mat.uniforms[k] = U[k];
      Object.assign(mat, PREMULT);
      mat.uniforms.map.value = haloTex(); mat.uniforms.hp.value = hp; mat.toneMapped = false;
      var mesh = new T.Mesh(g, mat);
      mesh.name = 'haloBatch'; mesh.frustumCulled = false; mesh.userData.noMeasure = true;
      mesh.raycast = function () {};
      mesh.onBeforeRender = function () {
        for (var i = 0; i < list.length; i++) {
          var sp = list[i], vis = true, o = sp;
          while (o && o !== root) { if (!o.visible) { vis = false; break; } o = o.parent; }
          var e = sp.matrixWorld.elements;
          hp[i * 4] = e[12]; hp[i * 4 + 1] = e[13]; hp[i * 4 + 2] = e[14];
          hp[i * 4 + 3] = vis ? Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) : 0;
        }
        if (A) {
          var st = root.userData.auraState;
          U.auraM.value.copy(auraNode.matrixWorld);
          U.uT.value = st ? st.t : performance.now() / 1000; U.uA.value = st ? st.a : 1; U.uD.value = st ? st.d : 0;
        }
        mat.uniformsNeedUpdate = true;
      };
      root.add(mesh);
    });
  }
  function classifyPart(o) {
    var m = o.material;
    if (!o.isMesh || o.isSkinnedMesh || !m || Array.isArray(m) || o.userData.haloProxy) return null;
    if (m.map || m.alphaMap || m.isShaderMaterial) return null;
    if (m === matCache.vcglow) return 'glow';
    if (m.isMeshToonMaterial && !m.transparent && (!m.emissive || (m.emissive.r + m.emissive.g + m.emissive.b) === 0)) return 'toon';
    if (m.isMeshBasicMaterial && !m.transparent && m.blending === T.NormalBlending) return 'glow';
    if (m.isMeshBasicMaterial && m.transparent) return 'trans';
    return null;
  }
  // opts (v1.1, optional; also read from root.userData.skinOpts):
  //   { rim: '#hex', rimStrength: 0..1, edge: '#hex' (dissolve edge), flashColor, height, own: true }
  //   Any option -> per-instance body + depth materials (same shader program) exposed as
  //   root.userData.skinU = { wfRim, wfRimColor, wfFlash, wfDissolve, ... } uniforms. No options -> the
  //   shared cached material (wizards look exactly as in v1.0).
  //   root.userData.aura (enemies) adds smoke / embers / ground ring / pool to the halo batch.
  var _skPm = new T.Matrix4();
  function skinify(root, opts) {
    opts = opts || root.userData.skinOpts || null;
    root.updateMatrixWorld(true);
    var rootInv = new T.Matrix4().copy(root.matrixWorld).invert();
    var bones = [], boneIx = new Map(), body = new Packer(), trans = {}, sprites = [], drop = [], proxies = [], found = [];
    function boneOf(o) { if (!boneIx.has(o)) { boneIx.set(o, bones.length); bones.push(o); } return boneIx.get(o); }
    root.traverse(function (o) {
      if (isHaloSprite(o)) { sprites.push(o); return; }
      var k = classifyPart(o); if (k) found.push([o, k]);
    });
    found.forEach(function (f) {
      var o = f[0], kind = f[1], m = o.material;
      // Builder meshes are static children of a pivot: bind to the pivot and drop the mesh.
      // Anything else may be animated itself (tail, shards, orb, hood): it becomes its own bone (a proxy).
      var vc = m.vertexColors && o.children.length === 0 && o.parent;
      var bone = vc ? (o.parent.userData.builderGroup && o.parent.parent ? o.parent.parent : o.parent) : o;
      if (vc && bone !== o.parent && (o.parent.position.lengthSq() || o.parent.quaternion.w !== 1 || o.parent.scale.x !== 1)) bone = o.parent;
      var mat = new T.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
      if (kind === 'trans') { (trans[m.uuid] = trans[m.uuid] || { mat: m, list: [] }).list.push({ o: o, m: mat, bone: bone }); return; }
      var w = kind === 'glow' ? 2 : (o.receiveShadow ? 1 : 0);
      var flat = kind === 'toon' && !!m.flatShading;
      var dbl = kind === 'toon' && m.side === T.DoubleSide;
      var lz = o.geometry.userData.lazyParts;   // v1.2 WS6: lazy Builder parts go straight into the packer
      if (lz) for (var li = 0; li < lz.length; li++) body.add(lz[li].g, _skPm.multiplyMatrices(mat, lz[li].m), lz[li].c, w, boneOf(bone), flat, dbl);
      else body.add(o.geometry, mat, m.vertexColors ? null : m.color, w, boneOf(bone), flat, dbl);
      (bone === o ? proxies : drop).push(o);
    });
    // translucent parts sharing ONE material (e.g. both sprite wings) -> one skinned mesh each
    var extra = [];
    Object.keys(trans).forEach(function (u) {
      var t = trans[u]; if (t.list.length < 2) return;
      var pk = new Packer();
      t.list.forEach(function (it) { pk.add(it.o.geometry, it.m, t.mat.color, 2, boneOf(it.bone), false, false); proxies.push(it.o); });
      extra.push({ geo: pk.geometry(false), mat: t.mat });
    });
    function retire(o, keep) {
      var g = o.geometry, shared = o.userData.sharedGeometry || (g && g.userData && g.userData.sharedGeometry);
      if (g && !shared) g.dispose();
      if (keep) { o.geometry = emptyGeo(); o.userData.sharedGeometry = true; o.layers.disableAll(); o.castShadow = false; }
      else if (o.parent) o.parent.remove(o);
    }
    if (body.n) {
      drop.forEach(function (o) { retire(o, false); });
      proxies.forEach(function (o) { retire(o, true); });
      var skel = new T.Skeleton(bones);
      var bodyMat = skinMat(opts), U = bodyMat.userData.u, depth = opts ? skinDepthMat(U) : skinDepthMat();
      var mk = function (geo, mat, shadow) {
        var sm = new T.SkinnedMesh(geo, mat);
        sm.name = 'skinnedBody'; sm.castShadow = shadow; sm.receiveShadow = shadow;
        if (shadow) sm.customDepthMaterial = depth;
        root.add(sm); sm.bind(skel);
        return sm;
      };
      var bm = mk(body.geometry(true), bodyMat, true);
      bm.userData.dispose = function () { skel.dispose(); if (opts) depth.dispose(); };
      extra.forEach(function (e) { mk(e.geo, e.mat, false); });
      root.userData.skinned = bm;
      if (opts) root.userData.skinU = U;
    }
    if (sprites.length || root.userData.aura) haloBatch(root, sprites, root.userData.aura);
    return root;
  }

  // ==================================================================
  //  WIZARD  (v1.1 "Gear & Glory" — owner: C1 technical-artist/characters)
  //  wizardModel(look) builds the pivot rig; M.wizard() packs it (skinify).
  //   * gear appearance: look.gear.{hat,robe,boots,wand,amulet} = { style,
  //     color, color2, gem, fx, rarity } (docs/V1.1-CONTRACT.md §4.2). Any
  //     slot missing = the v1.0 default look for that slot. Feet are always
  //     visible under the (slightly raised) hem so boots show.
  //   * rarity ladder per piece: common plain -> uncommon accent trim in
  //     color2 -> rare glowing gem + halo -> epic + glowing rune lines +
  //     sparkle motes -> legendary + animated aura (fx flavour) + pulsing
  //     halos. All motes/aura of one character = ONE Points draw call.
  //   * animation: anim(t, state, dt), states in WIZ_STATES (§4.3). Poses are
  //     cross-faded (Poser) and hat tip / skirt / cape / amulet get spring
  //     secondary motion driven by the character's real world motion.
  //   * budget (measured in tests/lab-wizard.html): <= 5 draw calls incl.
  //     shadow for a fully geared legendary wizard, build ~5-12 ms.
  // ==================================================================
  var RAR_TIER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  var FX_KINDS = { glow: 1, sparkle: 1, embers: 1, frost: 1, shadow: 1, radiant: 1, leaves: 1 };
  var WIZ_STATES = { idle: 1, walk: 1, run: 1, windup: 1, cast: 1, cast_big: 1, hit: 1, victory: 1, defeat: 1, ride: 1, talk: 1, duel_idle: 1, taunt: 1 };
  var WIZ_BLEND = { idle: 0.3, walk: 0.16, run: 0.14, windup: 0.12, cast: 0.07, cast_big: 0.1, hit: 0.08, victory: 0.22, defeat: 0.1, ride: 0.18, talk: 0.25, duel_idle: 0.25, taunt: 0.12 };
  var HEM = 0.22, WAIST = 0.55;

  function tierOf(it) { if (!it) return -1; var r = RAR_TIER[it.rarity]; return r === undefined ? 0 : r; }
  // fx flavour: explicit, else derived from the gem colour's hue
  function fxOf(it, fallback) {
    if (it && FX_KINDS[it.fx]) return it.fx;
    var hsl = {}; C((it && it.gem) || fallback || '#ffd76a').getHSL(hsl);
    var h = hsl.h * 360;
    if (hsl.s < 0.15) return hsl.l < 0.35 ? 'shadow' : 'sparkle';
    if (h < 22 || h >= 345) return 'embers';
    if (h < 52) return hsl.l > 0.62 ? 'radiant' : (hsl.s > 0.75 ? 'embers' : 'glow');
    if (h < 68) return 'radiant';
    if (h < 170) return 'leaves';
    if (h < 250) return 'frost';
    return hsl.l < 0.45 ? 'shadow' : (h < 300 ? 'shadow' : 'sparkle');
  }
  function hash01(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function segK(a, t0, t1) { return clamp((a - t0) / (t1 - t0), 0, 1); }
  function easeIO(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function easeO(k) { return 1 - Math.pow(1 - k, 3); }
  function bell(k) { return Math.sin(clamp(k, 0, 1) * PI); }

  // ---------------- geometry helpers (fresh geometries) ----------------
  // Lathe with radial cloth folds; optional partial sweep (phiStart/phiLen) and radial scale
  function foldLathe(pts, segs, folds, ampFn, phase, phiStart, phiLen, rs) {
    var g = new T.LatheGeometry(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), segs, phiStart || 0, phiLen || TAU);
    var p = g.attributes.position, k = rs || 1;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (x * x + z * z < 1e-8) continue;
      var a = Math.atan2(x, z), f = k * (1 + (folds ? ampFn(y) * Math.sin(a * folds + (phase || 0)) : 0));
      p.setX(i, x * f); p.setZ(i, z * f);
    }
    g.computeVertexNormals();
    return g;
  }
  // Solid hat brim (top, underside, outer rim). droop: edge drop; wave: ripple; up(a,u): extra lift
  function brimGeo(rIn, rOut, droop, wave, thick, segs, up) {
    var R = 4, pos = [], idx = [], W = segs + 1, i, j;
    for (var side = 0; side < 2; side++) for (i = 0; i <= R; i++) for (j = 0; j <= segs; j++) {
      var r = rIn + (rOut - rIn) * i / R, a = j / segs * TAU, u = i / R;
      var y = -droop * u * u + wave * Math.sin(a * 5 + 0.6) * u * u + (up ? up(a, u) : 0) - side * thick * (1 - 0.5 * u);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
    }
    var off = (R + 1) * W;
    for (i = 0; i < R; i++) for (j = 0; j < segs; j++) {
      var a0 = i * W + j, b0 = a0 + 1, c0 = a0 + W, d0 = c0 + 1;
      idx.push(a0, c0, b0, b0, c0, d0);
      idx.push(off + a0, off + b0, off + c0, off + b0, off + d0, off + c0);
    }
    for (j = 0; j < segs; j++) { var t0 = R * W + j; idx.push(t0, off + t0, t0 + 1, t0 + 1, off + t0, off + t0 + 1); }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // Mesh with per-vertex painted colour (fn(x,y,z,nx,ny,nz,out)) — packed by skinify like Builder meshes
  function vmesh(geo, col, o) {
    o = o || {};
    var p = geo.attributes.position, n = geo.attributes.normal, cnt = p.count, ca = new Float32Array(cnt * 3), c = new T.Color();
    if (!n) { geo.computeVertexNormals(); n = geo.attributes.normal; }
    var base = typeof col === 'function' ? null : C(col);
    for (var i = 0; i < cnt; i++) {
      if (base) c.copy(base); else col(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), c);
      ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(ca, 3));
    var m = new T.Mesh(geo, o.glow ? vcGlowMat() : vcMat(!!o.flat));
    m.castShadow = !o.glow; m.receiveShadow = o.receive !== false;
    if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
    if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
    if (o.s) { if (typeof o.s === 'number') m.scale.setScalar(o.s); else m.scale.set(o.s[0], o.s[1], o.s[2]); }
    return m;
  }
  // painter: vertical light ramp (dark at y0 -> base at y1) + optional fold crease + underside darkening
  function painter(base, y0, y1, dark, crease) {
    var b = C(base), lit = sh(b, 0.06);
    return function (x, y, z, nx, ny, nz, out) {
      var v = smooth(y0, y1, y), f = 1 - dark * (1 - v);
      if (crease) { var a = Math.atan2(x, z); f *= 1 - crease.amt * crease.w(y) * (0.5 - 0.5 * Math.sin(a * crease.n + crease.ph)); }
      if (ny < -0.55) f *= 0.82;
      out.copy(v > 0.85 ? lit : b).multiplyScalar(f);
    };
  }

  // ---------------- particle aura (one Points draw call per character) ----------------
  function c1Tex(kind) {
    return ctex('c1_' + kind, function () {
      var c = canvas(64, 64), x = c.getContext('2d'), g, i, a;
      if (kind === 'dot' || kind === 'flame') {
        g = x.createRadialGradient(32, kind === 'flame' ? 38 : 32, 0, 32, 32, 30);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        if (kind === 'flame') { x.beginPath(); x.moveTo(32, 2); x.bezierCurveTo(46, 22, 56, 40, 32, 62); x.bezierCurveTo(8, 40, 18, 22, 32, 2); x.fill(); }
        else x.fillRect(0, 0, 64, 64);
      } else if (kind === 'star') {
        g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        x.fillStyle = '#ffffff'; x.beginPath();
        for (i = 0; i < 8; i++) { a = i * PI / 4 - PI / 2; var r = i % 2 ? 5 : 31; if (!i) x.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); else x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
        x.closePath(); x.fill();
      } else if (kind === 'flake') {
        x.strokeStyle = '#ffffff'; x.lineWidth = 4; x.lineCap = 'round';
        for (i = 0; i < 6; i++) {
          a = i * PI / 3; var ex = 32 + Math.cos(a) * 27, ey = 32 + Math.sin(a) * 27;
          x.beginPath(); x.moveTo(32, 32); x.lineTo(ex, ey); x.stroke();
          var mx = 32 + Math.cos(a) * 17, my = 32 + Math.sin(a) * 17;
          x.beginPath(); x.moveTo(mx, my); x.lineTo(mx + Math.cos(a + 0.8) * 8, my + Math.sin(a + 0.8) * 8); x.moveTo(mx, my); x.lineTo(mx + Math.cos(a - 0.8) * 8, my + Math.sin(a - 0.8) * 8); x.stroke();
        }
        g = x.createRadialGradient(32, 32, 0, 32, 32, 12); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      } else if (kind === 'cog') {   // v1.2 WS6: tiny brass cog (Grand Artificer aura); the aura shader spins it
        g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        x.fillStyle = '#ffffff'; x.beginPath();
        for (i = 0; i < 32; i++) { a = (i + 0.5) * TAU / 32; var rt = (i >> 1) % 2 ? 17 : 24; if (!i) x.moveTo(32 + Math.cos(a) * rt, 32 + Math.sin(a) * rt); else x.lineTo(32 + Math.cos(a) * rt, 32 + Math.sin(a) * rt); }
        x.closePath(); x.arc(32, 32, 7, 0, TAU, true); x.fill('evenodd');
      } else if (kind === 'leaf') {
        x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(32, 4); x.bezierCurveTo(56, 18, 54, 46, 32, 60); x.bezierCurveTo(10, 46, 8, 18, 32, 4); x.fill();
        x.strokeStyle = 'rgba(150,150,150,0.9)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(32, 8); x.lineTo(32, 58); x.stroke();
        x.lineWidth = 1.5; for (i = 0; i < 4; i++) { var yy = 18 + i * 10; x.beginPath(); x.moveTo(32, yy + 6); x.lineTo(20, yy); x.moveTo(32, yy + 6); x.lineTo(44, yy); x.stroke(); }
      } else {   // smoke
        var rr = seeded(7);
        for (i = 0; i < 6; i++) {
          var px = 20 + rr() * 24, py = 20 + rr() * 24, rad = 12 + rr() * 10;
          g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill();
        }
      }
      return new T.CanvasTexture(c);
    });
  }
  // mode: 0 rise, 1 twinkle, 2 fall/swirl, 3 orbit-spiral, 4 smoke, 5 flame lick
  var AURA = {
    glow:    { mode: 0, tex: 'dot',   add: true,  size: 0.17, speed: 0.22, rise: 1.9, rad: 0.5,  n: 30 },
    sparkle: { mode: 1, tex: 'star',  add: true,  size: 0.26, speed: 0.12, rise: 0.0, rad: 0.62, n: 14 },
    embers:  { mode: 0, tex: 'dot',   add: true,  size: 0.15, speed: 0.5,  rise: 2.3, rad: 0.5,  n: 40 },
    frost:   { mode: 2, tex: 'flake', add: true,  size: 0.2,  speed: 0.16, rise: 2.2, rad: 0.62, n: 30 },
    shadow:  { mode: 4, tex: 'smoke', add: false, size: 0.55, speed: 0.28, rise: 1.2, rad: 0.42, n: 26 },
    radiant: { mode: 3, tex: 'star',  add: true,  size: 0.2,  speed: 0.22, rise: 2.1, rad: 0.72, n: 34 },
    leaves:  { mode: 3, tex: 'leaf',  add: false, size: 0.22, speed: 0.17, rise: 2.1, rad: 0.68, n: 26 },
    flame:   { mode: 5, tex: 'flame', add: false, size: 0.3,  speed: 1.3,  rise: 0.42, rad: 0.0,  n: 36 },
    hooffire:{ mode: 5, tex: 'flame', add: true,  size: 0.2,  speed: 1.6,  rise: 0.22, rad: 0.0,  n: 16 },
    // ---- v1.2 WS6: Starwalker greaves shed faint star motes (mode 6: drift back with the walking speed, uTrail)
    stardust:{ mode: 6, tex: 'star',  add: true,  size: 0.13, speed: 0.55, rise: 0.55, rad: 0.0,  n: 18 },
    // ---- v1.2 WS6: T3 set auras. Grand Artificer = little brass cogs spiralling up like a governor; Ascendant
    //      Starbound = stars falling slowly round the wizard in wide orbits.
    //      (the cogs blend normally so they read as brass, not as white additive flowers)
    clockwork:{ mode: 3, tex: 'cog',  add: false, size: 0.12, speed: 0.16, rise: 2.0, rad: 0.66, n: 20 },
    starfall: { mode: 2, tex: 'star', add: true,  size: 0.16, speed: 0.13, rise: 2.3, rad: 0.7,  n: 26 }
  };
  var AURA_VS = [
    'attribute vec4 aSeed; attribute vec3 aColor;',
    'uniform float uTime, uScale, uSize, uSpeed, uRise, uRad, uObj, uTrail;',
    'varying vec3 vC; varying float vA; varying float vRot;',
    'void main() {',
    '  float ph = fract(uTime * uSpeed * (0.65 + 0.7 * aSeed.x) + aSeed.y);',
    '  vec3 p = position; float a = 1.0; float sz = uSize * (0.6 + 0.8 * aSeed.z); float ang; float r;',
    '  vRot = aSeed.w * 6.2832 + uTime * (aSeed.x - 0.5) * 2.5;',
    '#if MODE == 0',
    '  p.y += ph * uRise;',
    '  p.x += sin(uTime * 2.3 + aSeed.w * 31.0) * 0.07 * (0.3 + ph);',
    '  p.z += cos(uTime * 1.9 + aSeed.x * 17.0) * 0.07 * (0.3 + ph);',
    '  a = smoothstep(0.0, 0.12, ph) * (1.0 - ph); sz *= 1.0 - 0.45 * ph;',
    '#elif MODE == 1',
    '  float tw = sin(uTime * (1.6 + 2.6 * aSeed.x) + aSeed.y * 6.2832); a = tw > 0.0 ? tw * tw : 0.0;',
    '  ang = aSeed.w * 6.2832 + uTime * 0.35; p.x += cos(ang) * 0.06; p.z += sin(ang) * 0.06; p.y += sin(uTime * 0.7 + aSeed.z * 6.0) * 0.06;',
    '  sz *= 0.35 + 0.85 * a;',
    '#elif MODE == 2',
    '  ang = aSeed.w * 6.2832 + uTime * 0.7 * (0.5 + aSeed.x); r = uRad * (0.7 + 0.5 * aSeed.z);',
    '  p.x += cos(ang) * r; p.z += sin(ang) * r; p.y += (1.0 - ph) * uRise;',
    '  a = smoothstep(0.0, 0.15, ph) * smoothstep(1.0, 0.8, ph);',
    '#elif MODE == 3',
    '  ang = aSeed.w * 6.2832 + uTime * uSpeed * 7.0 * (0.7 + 0.6 * aSeed.x); r = uRad * (0.8 + 0.4 * aSeed.z) * (1.0 - 0.35 * ph);',
    '  p.x += cos(ang) * r; p.z += sin(ang) * r; p.y += ph * uRise;',
    '  a = sin(ph * 3.1416);',
    '#elif MODE == 4',
    '  p.y += ph * uRise; p.x += (aSeed.x - 0.5) * 0.5 * ph; p.z += (aSeed.z - 0.5) * 0.5 * ph;',
    '  a = sin(ph * 3.1416) * 0.75; sz *= 0.55 + 0.9 * ph;',
    '#elif MODE == 6',
    '  p.y += ph * uRise * (0.35 + 0.65 * aSeed.z); p.z -= ph * ph * uTrail * 1.9;',
    '  p.x += sin(uTime * 1.7 + aSeed.w * 20.0) * 0.05 * ph;',
    '  a = smoothstep(0.0, 0.1, ph) * (1.0 - ph) * (0.5 + 0.5 * sin(uTime * (5.0 + aSeed.x * 7.0) + aSeed.y * 30.0)) * (0.55 + 0.45 * uTrail);',
    '  sz *= 1.0 - 0.55 * ph;',
    '#else',
    '  p.y += ph * uRise; p.z -= ph * uRise * 0.35; p.x += sin(uTime * 9.0 + aSeed.w * 20.0) * 0.03;',
    '  a = (1.0 - ph) * smoothstep(0.0, 0.08, ph); sz *= 1.0 - 0.65 * ph; vRot = 0.0;',
    '#endif',
    '  vC = aColor; vA = a;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_PointSize = sz * uObj * uScale / max(0.1, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'].join('\n');
  var AURA_FS = [
    'uniform sampler2D map; uniform float uBoost;',
    'varying vec3 vC; varying float vA; varying float vRot;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float c = cos(vRot), s = sin(vRot); uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);',
    '  vec4 t = texture2D(map, uv + 0.5);',
    '  float a = vA * t.a; if (a < 0.012) discard;',
    '#ifdef ADD',
    '  gl_FragColor = vec4(vC * t.rgb * uBoost, a);',
    '#else',
    '  gl_FragColor = vec4(vC * t.rgb, a);',
    '#endif',
    '}'].join('\n');
  function auraMat(kind) {
    var A = AURA[kind] || AURA.glow;
    return cmat('c1aura_' + kind, function () {
      var defs = { MODE: A.mode }; if (A.add) defs.ADD = 1;
      var m = new T.ShaderMaterial({
        defines: defs,
        uniforms: { map: { value: c1Tex(A.tex) }, uTime: { value: 0 }, uScale: { value: 500 }, uObj: { value: 1 }, uTrail: { value: 0 },
          uSize: { value: A.size }, uSpeed: { value: A.speed }, uRise: { value: A.rise }, uRad: { value: A.rad }, uBoost: M.glowBoost || { value: 1 } },
        vertexShader: AURA_VS, fragmentShader: AURA_FS,
        transparent: true, depthWrite: false, blending: A.add ? T.AdditiveBlending : T.NormalBlending
      });
      return m;
    });
  }
  var _auraV2 = new T.Vector2(), _auraS = new T.Vector3();
  // n particles; colours: array of colours (cycled); anchor(i, rnd) -> [x,y,z] base position
  function auraPoints(kind, n, colors, anchor, seed) {
    var A = AURA[kind] || AURA.glow, r = seeded(seed || 1234);
    var pos = new Float32Array(n * 3), sd = new Float32Array(n * 4), col = new Float32Array(n * 3);
    var cols = (colors && colors.length ? colors : ['#ffffff']).map(function (c) { return C(c); });
    for (var i = 0; i < n; i++) {
      var p = anchor(i, r);
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
      sd[i * 4] = r(); sd[i * 4 + 1] = r(); sd[i * 4 + 2] = r(); sd[i * 4 + 3] = r();
      var c = cols[i % cols.length]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(sd, 4));
    g.setAttribute('aColor', new T.BufferAttribute(col, 3));
    g.boundingSphere = new T.Sphere(new T.Vector3(0, 1, 0), 2.5);
    var pts = new T.Points(g, auraMat(kind));
    pts.name = 'aura'; pts.frustumCulled = false; pts.renderOrder = A.add ? 12 : 11;
    pts.userData.noMeasure = true; pts.userData.t = 0; pts.raycast = function () {};
    pts.onBeforeRender = function (renderer, scene, camera) {
      var m = this.material, u = m.uniforms;
      renderer.getDrawingBufferSize(_auraV2);
      u.uScale.value = camera.isPerspectiveCamera ? _auraV2.y * 0.5 / Math.tan(camera.fov * PI / 360) : _auraV2.y * 0.05;
      u.uTime.value = this.userData.t;
      u.uTrail.value = this.userData.trail || 0;     // v1.2 WS6 (stardust motes)
      _auraS.setFromMatrixScale(this.matrixWorld); u.uObj.value = _auraS.y;
      m.uniformsNeedUpdate = true;
    };
    return pts;
  }

  // ---------------- Poser: rest reset + cross-fade between states ----------------
  // joints: Object3D list. Each frame: begin(t, state, blend) -> k (s in state); reset();
  // set the pose (additive on rest); finish(t) blends from the pose at the switch.
  function Poser(joints) {
    this.j = joints; var n = joints.length * 9;
    this.rest = new Float32Array(n); this.cur = new Float32Array(n); this.out = new Float32Array(n); this.snap = new Float32Array(n);
    this.read(this.rest); this.out.set(this.rest);
    this.s = null; this.t0 = 0; this.bd = 0;
  }
  Poser.prototype.read = function (a) {
    for (var i = 0, o = 0; i < this.j.length; i++, o += 9) {
      var J = this.j[i];
      a[o] = J.position.x; a[o + 1] = J.position.y; a[o + 2] = J.position.z;
      a[o + 3] = J.rotation.x; a[o + 4] = J.rotation.y; a[o + 5] = J.rotation.z;
      a[o + 6] = J.scale.x; a[o + 7] = J.scale.y; a[o + 8] = J.scale.z;
    }
  };
  Poser.prototype.write = function (a) {
    for (var i = 0, o = 0; i < this.j.length; i++, o += 9) {
      var J = this.j[i];
      J.position.set(a[o], a[o + 1], a[o + 2]); J.rotation.set(a[o + 3], a[o + 4], a[o + 5]); J.scale.set(a[o + 6], a[o + 7], a[o + 8]);
    }
  };
  Poser.prototype.begin = function (t, state, blend) {
    if (state !== this.s) { var first = this.s === null; this.snap.set(this.out); this.s = state; this.t0 = t; this.bd = first ? 0 : (blend || 0); }
    if (t < this.t0) this.t0 = t;
    return t - this.t0;
  };
  Poser.prototype.reset = function () { this.write(this.rest); };
  Poser.prototype.finish = function (t) {
    this.read(this.cur);
    var w = this.bd > 0 ? smooth(0, this.bd, t - this.t0) : 1, o = this.out, c = this.cur, s = this.snap;
    if (w >= 1) o.set(c); else for (var i = 0; i < o.length; i++) o[i] = s[i] + (c[i] - s[i]) * w;
    if (w < 1) this.write(o);
  };
  // damped spring (angle), semi-implicit, sub-stepped
  function Spring(k, d) { this.x = 0; this.v = 0; this.k = k; this.d = d; }
  Spring.prototype.step = function (target, dt) {
    var n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (var i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.d * this.v) * h; this.x += this.v * h; }
    if (!(Math.abs(this.x) < 3)) { this.x = 0; this.v = 0; }
    return this.x;
  };
  // world-velocity tracker for an Object3D, expressed in root-local axes
  var _wq = new T.Quaternion(), _wv = new T.Vector3();
  function VelTrack(obj, root) { this.o = obj; this.r = root; this.p = new T.Vector3(); this.v = new T.Vector3(); this.ok = false; }
  VelTrack.prototype.update = function (dt) {
    this.o.updateWorldMatrix(true, false);
    _wv.setFromMatrixPosition(this.o.matrixWorld);
    if (this.ok && dt > 0) {
      this.v.subVectors(_wv, this.p).divideScalar(dt);
      if (this.v.lengthSq() > 400) this.v.set(0, 0, 0);     // teleport / zone change
      this.r.getWorldQuaternion(_wq); this.v.applyQuaternion(_wq.invert());
    } else this.v.set(0, 0, 0);
    this.p.copy(_wv); this.ok = true;
    return this.v;
  };

  // ---------------- gear piece helpers ----------------
  // X = build context (pivots, colours, halo list). it = gear entry or null. tier -1 = v1 default look.
  function gearCols(it, main, acc, gem) {
    return { main: C((it && it.color) || main), acc: C((it && it.color2) || acc), gem: C((it && it.gem) || gem) };
  }
  function accentOf(tier, c) { return tier === 0 ? sh(c.main, -0.22) : c.acc; }          // common = plain (darker self-colour)
  function glowsAt(tier) { return tier === -1 || tier >= 2; }
  function gemPart(B, geo, col, tier, o) { if (glowsAt(tier)) B.glow(geo, col, o); else B.add(geo, sh(col, 0.12), o); }
  function addHalo(X, parent, pos, col, size, tier) {
    if (tier < 2 && tier !== -1) return null;
    var s = halo(col, size, 0.85); s.position.set(pos[0], pos[1], pos[2]); parent.add(s);
    X.halos.push({ s: s, base: size, wand: false });
    return s;
  }
  // a curve-following thin glow/colour line on the surface of a radius function (rune lines, chains)
  function surfLine(pts, r) { return G.taper(pts, r, r, Math.max(6, pts.length * 3), 4); }

  // =====================================================================
  //  v2.1 WS-D: the round-2 look (Jorge, Oct 20, D5). look.build = p.look (character creation) or an
  //  NPC's npcs.js `build`; knobs and presets live in game/data/characters.js. resolveBuild merges the
  //  body preset with the wizard's choices; applyBuild re-proportions the finished v1.x rig (leaf meshes
  //  are scaled, joints only moved, so no animated joint ever carries a non-uniform scale -> no shear);
  //  buildHeadV21 draws the new face (round-2 eyes, presets) and hair styles.
  // =====================================================================
  function v21Hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null; }
  function resolveBuild(bl) {
    var CH = WF.data && WF.data.characters;
    if (!bl || typeof bl !== 'object' || !CH || !CH.bodies) return null;
    var body = CH.bodies[bl.body] || CH.bodies.a, o = {}, k;
    for (k in body) o[k] = body[k];
    ['headS', 'legs', 'torso', 'arms', 'chest', 'shoulders', 'armThick', 'scale', 'stoop'].forEach(function (n) { if (typeof bl[n] === 'number' && isFinite(bl[n])) o[n] = bl[n]; });
    var pick = function (list, i, def) { i = i == null ? (def || 0) : i; i = Math.floor(+i) || 0; return (list && (list[i] || list[0])) || {}; };
    o.bodyId = CH.bodies[bl.body] ? bl.body : 'a';
    o.faceP = pick(CH.faces, bl.face, body.face); o.eyeP = pick(CH.eyes, bl.eyes, body.eyes);
    o.noseP = pick(CH.noses, bl.nose, 0); o.mouthP = pick(CH.mouths, bl.mouth, 0);
    o.hairId = pick(CH.hairs, bl.hair, body.hair).id || 'bob';
    o.hairColor = v21Hex(bl.hairColor); o.skin = v21Hex(bl.skin);
    o.eyeColor = v21Hex(bl.eyeColor) || (CH.eyeColors && CH.eyeColors[0]) || '#5a3a22';
    o.beard = bl.beard || null; o.brows = typeof bl.brows === 'number' ? bl.brows : 1;
    return o;
  }
  function v21Leaves(piv, joints, kx, ky, kz) {
    piv.children.forEach(function (c) {
      if (joints.indexOf(c) >= 0) return;
      c.scale.x *= kx; c.scale.y *= ky; c.scale.z *= kz;
      c.position.x *= kx; c.position.y *= ky; c.position.z *= kz;
    });
  }
  function applyBuild(X) {
    var b = X.build, body = X.body, kL = b.legs || 1, kT = b.torso || 1, hs = b.headS || 1;
    var chest = b.chest || 1, sho = b.shoulders || 1, kA = b.arms || 1, th = b.armThick || 1;
    var waistY = WAIST * kL, upY = waistY + (0.95 - WAIST) * kT;
    X.hipY = waistY; X.lowK = kL;
    // lower body: the skirt pivot hangs from the waist; stretching it lengthens robe + legs
    var skW = (1 + (chest - 1) * 0.6) * (b.skirtW || 0.9);   // a slimmer bell: the taller body should not read squat
    X.skirt.position.y = waistY; X.skirt.scale.set(X.skirt.scale.x * skW, X.skirt.scale.y * kL, X.skirt.scale.z * skW);
    // torso: every static part built in body space moves into one stretched group (waist up)
    var torso = new T.Group(); torso.name = 'torsoV21';
    torso.position.y = waistY; torso.scale.set(chest, kT, chest);
    body.children.slice().forEach(function (c) {
      if (c === X.skirt || c === X.upper || c === X.footL || c === X.footR || c.isPoints) return;
      body.remove(c); c.position.y -= WAIST; torso.add(c);
    });
    body.add(torso);
    // shoulders, arms, head
    var U = X.upper, joints = [X.head, X.armL, X.armR, X.elbowL, X.elbowR, X.handL, X.handR, X.wand, X.cape].filter(Boolean);
    U.position.y = upY;
    v21Leaves(U, joints.concat(X.cape ? [] : []), sho, 1, Math.max(1, chest * 0.95));
    if (X.cape) { X.cape.scale.x *= sho; X.cape.scale.y *= (kT + kL) / 2; X.cape.position.x *= sho; }
    [X.armL, X.armR].forEach(function (a) { a.position.x *= sho; v21Leaves(a, joints, th, kA, th); });
    [X.elbowL, X.elbowR].forEach(function (e) { e.position.y *= kA; v21Leaves(e, joints, th, kA, th); });
    [X.handL, X.handR].forEach(function (h) { h.position.y *= kA; });
    // the head sits ON the collar (the bodice top is at 1.13 on the v1.x wizard, inside its big head)
    var collarTop = waistY + (1.13 - WAIST) * kT, r = 0.33 * hs * ((b.faceP && b.faceP.sy) || 1);
    X.head.position.y = collarTop - upY + r * (b.neck || 0.86);
    X.head.scale.multiplyScalar(hs);
    if (X.hat) X.hat.rotation.x -= 0.157;                    // hat tilted back 9 deg so the face shows (D5)
    if (b.stoop) { U.rotation.x += b.stoop; X.head.rotation.x -= b.stoop * 0.7; }
    if (b.scale && b.scale !== 1) X.scaler.scale.multiplyScalar(b.scale);
  }
  function buildHeadV21(X, hatStyle) {
    var b = X.build, look = X.look, skin = X.skin, head = X.head;
    var cowl = hatStyle === 'cowl', F = b.faceP || {}, E = b.eyeP || {}, N = b.noseP || {}, Mo = b.mouthP || {};
    var faceSkin = X.glowEyes ? sh(skin, -0.45) : cowl ? sh(skin, -0.38) : skin;
    var hb = new Builder();
    hb.add(G.sph(0.33, 22, 16), faceSkin, { s: [F.sx || 1, F.sy || 1, 1] });
    var eyes = X.eyes = pivot(head, 0, 0.0, 0.3);
    var eb = new Builder();
    var eyeGlow = X.glowEyes || (cowl && X.cowlGlow ? X.cowlGlow : null);
    var ew = E.w || 0.06, eh = E.h || 0.05, sq = E.square || 0, tuck = E.tuck || 0.18, ri = Math.min(ew, eh) * (E.iris || 0.72);
    if (eyeGlow) {
      [-1, 1].forEach(function (sx) { eb.glow(G.sph(0.06, 10, 8), eyeGlow, { p: [sx * 0.11, -0.01, 0], s: [1, 0.6, 0.6], r: [0, 0, sx * 0.25] }); });
    } else {
      [-1, 1].forEach(function (sx) {
        var ex = sx * 0.112;
        eb.add(G.sph(1, 14, 10), '#fbf6ee', { p: [ex, 0, 0], s: [ew, eh * (sq ? 0.92 : 1), 0.028], r: [0, 0, sx * (sq ? 0.03 : 0.1)] });
        eb.add(G.sph(ri, 12, 10), b.eyeColor, { p: [ex, -tuck * ri * 0.6, 0.012], s: [1, sq ? 0.92 : 1, 0.55] });
        eb.add(G.sph(ri * 0.5, 10, 8), '#140e1c', { p: [ex, -tuck * ri * 0.6, 0.02], s: [1, 1, 0.5] });
        eb.add(G.sph(ri * 0.26, 6, 5), '#ffffff', { p: [ex + sx * ri * 0.3, ri * 0.25, 0.028] });
        // upper lid + lashes (round-2: lighter lashes, short flick; the iris top tucks under the lid)
        var lidT = eh * (0.16 + tuck * 0.4);
        eb.add(G.sph(1, 12, 6), '#2a1a20', { p: [ex, eh * 0.9 - lidT * 0.3, 0.012], s: [ew * 1.04, lidT * (0.5 + 0.4 * (E.lash || 0.7)), 0.02], r: [0, 0, sx * (sq ? 0.02 : 0.12)] });
        if ((E.lash || 0) > 0.6) eb.add(G.cone(0.008, 0.03, 5), '#2a1a20', { p: [ex + sx * ew * 1.02, eh * 0.62, 0.012], r: [0, 0, -sx * 1.1] });
        if (tuck > 0.3) eb.add(G.sph(1, 12, 6), faceSkin, { p: [ex, eh * 0.62, 0.016], s: [ew * 1.08, eh * 0.45, 0.022] });   // gentle: half-lidded
      });
    }
    eyes.add(eb.build({ receive: false }));
    if (!X.glowEyes) {
      var browC = X.hair ? sh(X.hair, -0.25) : sh(skin, -0.45), bw = sq ? 0.016 : 0.012;
      [-1, 1].forEach(function (sx) {
        hb.add(G.sph(1, 8, 6), browC, { p: [sx * 0.118, 0.092 + eh * 0.5, 0.3], s: [0.052 * (b.brows || 1), bw * (b.brows || 1), 0.016], r: [-0.3, sx * 0.25, sq ? -sx * 0.04 : -sx * 0.14] });
        hb.add(G.sph(0.058, 8, 6), mix(skin, '#ff7d7d', 0.36), { p: [sx * 0.185, -0.09, 0.25], s: [1, 0.6, 0.4] });
        hb.add(G.sph(0.062, 8, 6), faceSkin, { p: [sx * 0.322 * (F.sx || 1), -0.02, 0.0], s: [0.5, 0.9, 0.8] });
        hb.add(G.sph(0.03, 6, 5), sh(faceSkin, -0.15), { p: [sx * 0.338 * (F.sx || 1), -0.02, 0.012], s: [0.5, 0.8, 0.7] });
      });
      var nr = N.r || 0.046;
      if (N.cone) hb.add(G.cone(nr, nr * 2.2, 10), sh(faceSkin, -0.08), { p: [0, -0.06, 0.33], r: [PI / 2 - 0.25, 0, 0] });
      else hb.add(G.sph(nr, 10, 8), sh(faceSkin, -0.08), { p: [0, -0.058, 0.325], s: [1, N.sy || 0.9, 1] });
      var mw = Mo.w || 0.05;
      hb.add(G.tor(mw, 0.011, 4, 12, PI * (Mo.arc || 0.8)), '#7a3b3b', { p: [0, -0.138 - (F.chin || 0) * 0.5, 0.302], r: [0, 0, PI + PI * (1 - (Mo.arc || 0.8)) / 2] });
      var mouth = X.mouth = pivot(head, 0, -0.152 - (F.chin || 0) * 0.5, 0.3);
      mouth.scale.y = 0.12 + (Mo.open || 0) * 0.25;
      var mb = new Builder();
      mb.add(G.sph(1, 10, 6), '#5a2230', { s: [mw * 0.8, 0.034, 0.02] });
      mouth.add(mb.build({ receive: false }));
    } else {
      X.mouth = pivot(head, 0, -0.148, 0.29);
    }
    hairV21(X, hb, hatStyle);
    var beard = b.beard || (look.beard ? 'full' : null);
    if (beard) {
      var bc = X.hair || C('#eeeeee');
      if (beard === 'square') { hb.add(G.sph(0.22, 14, 10), bc, { p: [0, -0.33, 0.17], s: [1.0, 1.05, 0.62] }); hb.add(G.cyl(0.19, 0.2, 0.16, 14), bc, { p: [0, -0.5, 0.17], s: [1, 1, 0.62] }); }
      else if (beard === 'long') hb.add(G.cone(0.24, 0.85, 14), bc, { p: [0, -0.5, 0.14], r: [PI - 0.2, 0, 0] });
      else hb.add(G.cone(0.25, 0.62, 14), bc, { p: [0, -0.4, 0.15], r: [PI - 0.25, 0, 0] });
      hb.add(G.sph(0.075, 8, 6), bc, { p: [-0.075, -0.125, 0.3], s: [1.3, 0.6, 0.7], r: [0, 0, 0.35] });
      hb.add(G.sph(0.075, 8, 6), bc, { p: [0.075, -0.125, 0.3], s: [1.3, 0.6, 0.7], r: [0, 0, -0.35] });
    }
    head.add(hb.build({ receive: false }));
  }
  // hair styles (game/data/characters.js hairs). Hats cover the crown for most styles, so every style
  // also reads from the sides, the back and a fringe under the brim.
  function hairV21(X, hb, hatStyle) {
    var covers = { pointed: 1, wide: 1, tall: 1, feathered: 1, hood: 1, cowl: 1, horned: 1, artisan: 1, starbound: 1 };
    var hair = X.hair, id = X.build.hairId || 'bob';
    if (hatStyle === 'helm' || id === 'none') return;
    if (!hair) hair = C('#5a3a22');
    var d1 = sh(hair, -0.08), d2 = sh(hair, 0.06), open = !covers[hatStyle];
    var hood = hatStyle === 'hood' || hatStyle === 'cowl';
    hb.add(new T.SphereGeometry(id === 'short' || id === 'spiky' ? 0.342 : 0.352, 16, 8, PI, PI, 0, PI * 0.72), hair);   // back of the head
    if (open) hb.add(new T.SphereGeometry(id === 'short' || id === 'spiky' ? 0.343 : 0.355, 18, 7, 0, TAU, 0, PI * 0.38), hair);
    if (!hood) for (var f = 0; f < 3; f++) hb.add(G.sph(0.09, 8, 6), f === 1 ? d2 : hair, { p: [(f - 1) * 0.13, 0.24, 0.24], s: [1.2, 0.55, 0.7], r: [0.5, 0, (f - 1) * -0.3] });   // fringe
    if (id === 'bob' || id === 'long' || id === 'curly') {
      hb.add(G.sph(0.11, 8, 6), hair, { p: [-0.28, -0.07, 0.05], s: [0.8, 1.25, 0.9] });
      hb.add(G.sph(0.11, 8, 6), hair, { p: [0.28, -0.07, 0.05], s: [0.8, 1.25, 0.9] });
      hb.add(G.sph(0.1, 8, 6), d1, { p: [0, -0.2, -0.24], s: [1.6, 0.9, 0.9] });
    }
    if (id === 'long') hb.add(G.sph(0.2, 10, 8), d1, { p: [0, -0.42, -0.22], s: [1.25, 1.6, 0.55] });
    if (id === 'curly') for (var c = 0; c < 8; c++) { var a = c / 8 * TAU; hb.add(G.sph(0.085, 7, 5), c % 2 ? d2 : hair, { p: [Math.sin(a) * 0.3, -0.1 + Math.cos(a * 2) * 0.05, Math.cos(a) * 0.26 - 0.04] }); }
    if (id === 'short' || id === 'spiky') {
      hb.add(G.sph(0.05, 6, 5), hair, { p: [-0.31, -0.05, 0.1], s: [0.6, 1.4, 0.8] });
      hb.add(G.sph(0.05, 6, 5), hair, { p: [0.31, -0.05, 0.1], s: [0.6, 1.4, 0.8] });
    }
    if (id === 'spiky' && open) for (var sp = 0; sp < 6; sp++) { var sa = -1 + sp * 0.4; hb.add(G.cone(0.07, 0.2, 6), sp % 2 ? d2 : hair, { p: [Math.sin(sa) * 0.22, 0.3, Math.cos(sa) * 0.12 - 0.04], r: [-0.3 + Math.cos(sa) * 0.3, 0, -Math.sin(sa) * 0.6] }); }
    if (id === 'ponytail') { hb.add(G.sph(0.08, 8, 6), d1, { p: [0, 0.02, -0.36] }); hb.add(G.cone(0.085, 0.42, 8), hair, { p: [0, -0.2, -0.42], r: [-0.35, 0, 0] }); }
    if (id === 'braids') [-1, 1].forEach(function (sx) { hb.add(G.cone(0.06, 0.5, 8), hair, { p: [sx * 0.27, -0.36, -0.02], r: [PI, 0, sx * 0.12] }); hb.add(G.sph(0.035, 6, 5), d2, { p: [sx * 0.29, -0.62, -0.02] }); });
    if (id === 'bun') hb.add(G.sph(0.12, 10, 8), d1, { p: [0, open ? 0.3 : 0.06, -0.3] });
  }

  // ---------------- HEAD / FACE / HAIR ----------------
  function buildHead(X, hatStyle) {
    var look = X.look, skin = X.skin, head = X.head;
    var cowl = hatStyle === 'cowl';
    var faceSkin = X.glowEyes ? sh(skin, -0.45) : cowl ? sh(skin, -0.38) : skin;
    var hb = new Builder();
    hb.add(G.sph(0.33, 20, 14), faceSkin);
    // eyes live on their own pivot (blinks); mouth too (talks)
    var eyes = X.eyes = pivot(head, 0, 0.01, 0.296);
    var eb = new Builder();
    var eyeGlow = X.glowEyes || (cowl && X.cowlGlow ? X.cowlGlow : null);
    if (eyeGlow) {
      eb.glow(G.sph(0.06, 10, 8), eyeGlow, { p: [-0.11, -0.01, 0], s: [1, 0.6, 0.6], r: [0, 0, -0.25] });
      eb.glow(G.sph(0.06, 10, 8), eyeGlow, { p: [0.11, -0.01, 0], s: [1, 0.6, 0.6], r: [0, 0, 0.25] });
    } else {
      [-1, 1].forEach(function (sx) {
        eb.add(G.sph(0.052, 10, 8), '#1d1626', { p: [sx * 0.115, 0, 0], s: [1, 1.45, 0.75] });
        eb.add(G.sph(0.019, 6, 5), '#ffffff', { p: [sx * 0.115 + 0.017, 0.036, 0.036] });
        eb.add(G.sph(0.009, 5, 4), '#ffffff', { p: [sx * 0.115 - 0.014, -0.028, 0.038] });
      });
    }
    eyes.add(eb.build({ receive: false }));
    if (!X.glowEyes) {
      var browC = X.hair ? sh(X.hair, -0.25) : sh(skin, -0.45);
      [-1, 1].forEach(function (sx) {
        hb.add(G.sph(1, 8, 6), browC, { p: [sx * 0.122, 0.118, 0.296], s: [0.05, 0.014, 0.018], r: [-0.35, sx * 0.25, -sx * 0.16] });
        hb.add(G.sph(0.064, 8, 6), mix(skin, '#ff7d7d', 0.42), { p: [sx * 0.19, -0.088, 0.248], s: [1, 0.62, 0.42] });
        hb.add(G.sph(0.062, 8, 6), faceSkin, { p: [sx * 0.322, -0.02, 0.0], s: [0.5, 0.9, 0.8] });
        hb.add(G.sph(0.03, 6, 5), sh(faceSkin, -0.15), { p: [sx * 0.338, -0.02, 0.012], s: [0.5, 0.8, 0.7] });
      });
      hb.add(G.sph(0.046, 10, 8), sh(faceSkin, -0.08), { p: [0, -0.055, 0.33], s: [1, 0.9, 1] });
      hb.add(G.tor(0.05, 0.012, 4, 10, PI * 0.8), '#7a3b3b', { p: [0, -0.135, 0.3], r: [0, 0, PI + PI * 0.1] });
      var mouth = X.mouth = pivot(head, 0, -0.148, 0.298);
      mouth.scale.y = 0.12;
      var mb = new Builder();
      mb.add(G.sph(1, 10, 6), '#5a2230', { s: [0.042, 0.034, 0.02] });
      mouth.add(mb.build({ receive: false }));
    } else {
      X.mouth = pivot(head, 0, -0.148, 0.29);
    }
    // hair
    var covers = { pointed: 1, wide: 1, tall: 1, feathered: 1, hood: 1, cowl: 1, horned: 1, artisan: 1, starbound: 1 };   // v1.2 WS6: + artisan, starbound
    var hair = X.hair;
    if (hatStyle === 'helm') hair = null;
    else if (!covers[hatStyle] && !hair) hair = C('#5a3a22');
    if (hair) {
      hb.add(new T.SphereGeometry(0.35, 14, 8, PI, PI, 0, PI * 0.72), hair);
      hb.add(G.sph(0.11, 8, 6), hair, { p: [-0.27, -0.06, 0.06], s: [0.8, 1.2, 0.9] });
      hb.add(G.sph(0.11, 8, 6), hair, { p: [0.27, -0.06, 0.06], s: [0.8, 1.2, 0.9] });
      hb.add(G.sph(0.09, 8, 6), sh(hair, -0.08), { p: [0, -0.2, -0.24], s: [1.6, 0.9, 0.9] });
      if (!covers[hatStyle]) {           // crown / circlet: the top of the head shows
        hb.add(new T.SphereGeometry(0.352, 16, 6, 0, TAU, 0, PI * 0.36), hair);
        for (var f = 0; f < 5; f++) {
          var fa = -0.62 + f * 0.31;
          hb.add(G.sph(0.075, 8, 6), f % 2 ? sh(hair, -0.06) : hair, { p: [Math.sin(fa) * 0.27, 0.2 - Math.abs(fa) * 0.06, Math.cos(fa) * 0.24], s: [1, 0.75, 0.8] });
        }
      }
    }
    if (look.beard) {
      var bc = X.hair || C('#eeeeee');
      hb.add(G.cone(0.25, 0.62, 14), bc, { p: [0, -0.4, 0.15], r: [PI - 0.25, 0, 0] });
      hb.add(G.sph(0.075, 8, 6), bc, { p: [-0.075, -0.125, 0.3], s: [1.3, 0.6, 0.7], r: [0, 0, 0.35] });
      hb.add(G.sph(0.075, 8, 6), bc, { p: [0.075, -0.125, 0.3], s: [1.3, 0.6, 0.7], r: [0, 0, -0.35] });
    }
    head.add(hb.build({ receive: false }));
  }

  // ---------------- HATS ----------------
  var HAT_STYLES = { pointed: 1, wide: 1, tall: 1, crown: 1, circlet: 1, hood: 1, helm: 1, cowl: 1, horned: 1, feathered: 1, artisan: 1, starbound: 1 };   // v1.2 WS6: + artisan / starbound
  function hatTip(X, y, pts, r0, main, tier, c, segs, key) {
    var tip = X.hatTip = pivot(X.hat, 0, y, 0);
    // v1.2 WS6 (perf): a keyed tip clones its taper from the build cache (vmesh paints the clone)
    var g = key ? v12Clone('tip_' + key, function () { return G.taper(pts, r0, 0.008, segs || 12, 10); }) : G.taper(pts, r0, 0.008, segs || 12, 10);
    tip.add(vmesh(g, painter(main, -0.05, 0.25, 0.0, null)));
    var tb = new Builder();
    tb.add(G.tor(r0 * 0.98, 0.016, 4, 14), sh(main, -0.12), { p: [0, 0.005, 0], r: [PI / 2, 0, 0] });
    var end = pts[pts.length - 1];
    if (tier >= 3) tb.glow(G.oct(0.04), c.gem, { p: end, s: [1, 1.3, 1] });
    tip.add(tb.build());
    return tip;
  }
  function brimHat(X, c, tier, o) {
    var hat = X.hat, main = c.main, acc = accentOf(tier, c);
    hat.add(vmesh(brimGeo(o.rIn, o.rOut, o.droop, o.wave, 0.035, 24, o.up), painter(main, -0.2, -0.05, 0, null)));
    var cg = new T.CylinderGeometry(o.rTop, o.rBot, o.h, 16, 2, true); cg.translate(0, o.h / 2, 0);
    hat.add(vmesh(cg, painter(main, 0.0, o.h * 0.7, 0.14, null)));
    var hb = new Builder();
    var bandR = o.rBot - (o.rBot - o.rTop) * (0.07 / o.h);
    hb.add(G.cyl(bandR + 0.006, o.rBot + 0.008, 0.13, 16, true), acc, { p: [0, 0.07, 0] });
    if (tier >= 1 || tier === -1) hb.add(G.tor(bandR + 0.01, 0.012, 3, 20), sh(acc, -0.2), { p: [0, 0.135, 0], r: [PI / 2, 0, 0] });
    gemPart(hb, G.oct(0.062), sh(c.gem, tier === -1 ? 0.3 : 0), tier, { p: [0, 0.075, o.rBot + 0.012], s: [1, 1.3, 0.5] });
    if (tier >= 1) hb.add(G.box(0.12, 0.1, 0.02), sh(acc, -0.3), { p: [0, 0.075, o.rBot + 0.004] });
    if (tier >= 3) {
      hb.glow(G.tor(bandR + 0.014, 0.008, 3, 22), c.gem, { p: [0, 0.008, 0], r: [PI / 2, 0, 0] });
      for (var i = 0; i < 6; i++) { var a = (i + 0.5) * TAU / 6 + 0.3; hb.glow(G.oct(0.022), c.gem, { p: [Math.sin(a) * (bandR + 0.012), 0.075, Math.cos(a) * (bandR + 0.012)], s: [1, 1.6, 0.4], r: [0, a, 0] }); }
    }
    hat.add(hb.build());
    addHalo(X, hat, [0, 0.075, o.rBot + 0.05], c.gem, 0.34, tier);
  }
  function buildHat(X, it, style, tier) {
    if (style === 'artisan') return hatArtisan(X, it, tier);        // v1.2 WS6
    if (style === 'starbound') return hatStarbound(X, it, tier);    // v1.2 WS6
    var c = gearCols(it, X.hatC, X.trim, X.gem), hat = X.hat, main = c.main, acc = accentOf(tier, c), hb, i, a;
    hat.rotation.x = -0.08;
    if (style === 'pointed') {
      brimHat(X, c, tier, { rIn: 0.3, rOut: 0.6, droop: 0.06, wave: 0.014, rTop: 0.2, rBot: 0.36, h: 0.42 });
      hatTip(X, 0.42, [[0, -0.02, 0], [0, 0.12, -0.02], [0, 0.23, -0.12], [0, 0.28, -0.33]], 0.205, main, tier, c);
    } else if (style === 'wide') {
      hat.rotation.x = -0.2; hat.position.y += 0.03;
      brimHat(X, c, tier, { rIn: 0.28, rOut: 0.88, droop: 0.13, wave: 0.03, rTop: 0.23, rBot: 0.335, h: 0.3, up: function (a, u) { return 0.05 * u * u * Math.max(0, Math.cos(a)); } });
      hatTip(X, 0.3, [[0, -0.02, 0], [0, 0.1, -0.02], [0, 0.18, -0.1], [0, 0.2, -0.25]], 0.235, main, tier, c);
    } else if (style === 'tall') {
      brimHat(X, c, tier, { rIn: 0.3, rOut: 0.56, droop: 0.05, wave: 0.01, rTop: 0.17, rBot: 0.35, h: 0.62 });
      var tp = hatTip(X, 0.62, [[0, -0.02, 0], [0, 0.22, -0.02], [0, 0.42, -0.12], [0, 0.53, -0.32], [0, 0.48, -0.5], [0, 0.36, -0.52], [0, 0.31, -0.42]], 0.175, main, tier, c, 16);
      hb = new Builder();
      gemPart(hb, G.sph(0.058, 10, 8), tier >= 1 || tier === -1 ? c.acc : sh(main, 0.25), tier >= 2 ? 2 : 0, { p: [0, 0.31, -0.42] });
      tp.add(hb.build());
      if (tier >= 2) addHalo(X, tp, [0, 0.31, -0.42], c.gem, 0.3, tier);
    } else if (style === 'feathered') {
      hat.rotation.z = 0.1;
      hat.add(vmesh(brimGeo(0.28, 0.66, 0.02, 0, 0.035, 24, function (a, u) { var s = Math.max(0, Math.sin(a)); return 0.24 * u * u * s * s; }), painter(main, -0.2, -0.05, 0, null)));
      hat.add(vmesh(G.lathe([[0, 0.0], [0.31, 0.0], [0.3, 0.2], [0.27, 0.32], [0.18, 0.37], [0, 0.38]], 20), painter(main, 0, 0.3, 0.12, null)));
      hb = new Builder();
      hb.add(G.cyl(0.318, 0.322, 0.09, 20, true), acc, { p: [0, 0.055, 0] });
      gemPart(hb, G.oct(0.05), c.gem, tier, { p: [0.17, 0.06, 0.27], s: [1, 1.3, 0.5], r: [0, 0.55, 0] });
      hat.add(hb.build());
      addHalo(X, hat, [0.18, 0.06, 0.3], c.gem, 0.3, tier);
      var pl = X.plume = pivot(hat, 0.24, 0.1, 0.12);
      var plC = tier === 0 ? sh(main, 0.35) : (it && it.color2 ? c.acc : C('#f4f1ea'));
      var p1 = G.taper([[0, 0, 0], [0.03, 0.22, -0.08], [0.02, 0.4, -0.32], [-0.05, 0.42, -0.6], [-0.1, 0.32, -0.8]], 0.075, 0.012, 16, 8); p1.scale(0.45, 1, 1);
      pl.add(vmesh(p1, function (x, y, z, nx, ny, nz, o) { o.copy(plC).lerp(C(tier >= 2 ? c.gem : plC), smooth(-0.3, -0.8, z)); }));
      var p2 = G.taper([[0, 0, 0], [0.06, 0.16, -0.06], [0.08, 0.3, -0.24], [0.04, 0.32, -0.42]], 0.05, 0.01, 12, 8); p2.scale(0.45, 1, 1);
      pl.add(vmesh(p2, sh(plC, -0.15)));
      if (tier >= 3) { hb = new Builder(); hb.glow(G.sph(0.03, 6, 5), c.gem, { p: [-0.1, 0.32, -0.8] }); pl.add(hb.build()); }
    } else if (style === 'crown') {
      hat.rotation.x = -0.14; hat.position.set(0, 0.2, -0.01);
      hb = new Builder();
      hb.add(G.lathe([[0.245, 0], [0.272, 0], [0.29, 0.1], [0.268, 0.1], [0.245, 0]], 24), main);
      var nSp = 7;
      for (i = 0; i < nSp; i++) {
        a = i * TAU / nSp; var front = Math.cos(a) > 0.95, hgt = front ? 0.19 : 0.13;
        hb.add(G.cone(0.05, hgt, 5), main, { p: [Math.sin(a) * 0.28, 0.1 + hgt / 2, Math.cos(a) * 0.28], r: [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12] });
        gemPart(hb, G.sph(0.024, 6, 5), i % 2 ? c.gem : (tier >= 1 || tier === -1 ? c.acc : sh(main, 0.3)), tier >= 2 ? 2 : 0, { p: [Math.sin(a) * 0.29, 0.1 + hgt + 0.012, Math.cos(a) * 0.29] });
      }
      gemPart(hb, G.oct(0.055), c.gem, tier === 0 ? 0 : 2, { p: [0, 0.055, 0.29], s: [1, 1.25, 0.5] });
      if (tier >= 1) for (i = 0; i < 6; i++) { a = (i + 0.5) * TAU / 6 + PI / 6; hb.add(G.sph(0.018, 6, 5), c.acc, { p: [Math.sin(a) * 0.282, 0.05, Math.cos(a) * 0.282] }); }
      if (tier >= 3) hb.glow(G.tor(0.285, 0.008, 4, 30), c.gem, { p: [0, 0.098, 0], r: [PI / 2, 0, 0] });
      hat.add(hb.build());
      addHalo(X, hat, [0, 0.055, 0.32], c.gem, 0.36, tier === 0 ? 0 : Math.max(tier, 2));
    } else if (style === 'circlet') {
      hat.rotation.x = 0; hat.position.set(0, 0.1, 0.0);
      hb = new Builder();
      hb.add(G.tor(0.325, 0.02, 6, 32), main, { r: [PI / 2 - 0.3, 0, 0] });
      hb.add(G.tor(0.04, 0.012, 5, 14), main, { p: [0, -0.02, 0.33] });
      gemPart(hb, G.oct(0.04), c.gem, tier === 0 ? 0 : 2, { p: [0, -0.02, 0.335], s: [1, 1.3, 0.55] });
      if (tier >= 1) [-1, 1].forEach(function (sx) { hb.add(G.sph(0.02, 6, 5), c.acc, { p: [sx * 0.2, 0.0, 0.25] }); hb.add(G.cone(0.02, 0.07, 5), main, { p: [sx * 0.06, 0.02, 0.322], r: [0.2, 0, -sx * 0.6] }); });
      if (tier >= 3) hb.glow(G.tor(0.33, 0.006, 4, 32), c.gem, { r: [PI / 2 - 0.3, 0, 0], p: [0, 0.022, 0] });
      hat.add(hb.build());
      addHalo(X, hat, [0, -0.02, 0.36], c.gem, 0.3, tier === 0 ? 0 : Math.max(tier, 2));
    } else if (style === 'hood' || style === 'cowl') {
      hat.rotation.x = 0;
      var big = style === 'cowl' ? 1.1 : 1;
      var hood = new T.Mesh(new T.SphereGeometry(0.415 * big, 20, 12, PI / 2 + 0.85, TAU - 1.7, 0, PI * 0.66), M.toon(main, { side: T.DoubleSide }));
      hood.position.set(0, -0.09 - 0.17, 0.0); hood.scale.set(1, 1.08, 1.08);
      hood.castShadow = true; hood.receiveShadow = false;
      hat.add(hood);
      hb = new Builder();
      if (style === 'hood') {
        hb.add(G.cone(0.2, 0.5, 12), main, { p: [0, 0.2 - 0.17, -0.3], r: [-2.1, 0, 0] });
        hb.add(G.tor(0.3, 0.09, 6, 18), main, { p: [0, -0.3 - 0.17, -0.02], r: [PI / 2 + 0.15, 0, 0] });
        hb.add(G.tor(0.39, 0.025, 4, 20, PI * 1.25), acc, { p: [0, -0.13 - 0.17, -0.02], r: [0, 0, -PI * 0.125], s: [1, 1.08, 1] });
      } else {
        hb.add(G.tor(0.34, 0.1, 6, 18), main, { p: [0, -0.31 - 0.17, -0.02], r: [PI / 2 + 0.15, 0, 0] });
        hb.add(G.tor(0.43, 0.03, 4, 22, PI * 1.25), acc, { p: [0, -0.13 - 0.17, -0.01], r: [0, 0, -PI * 0.125], s: [1, 1.08, 1] });
        // peaked brow over the face
        hb.add(G.sph(1, 14, 8), main, { p: [0, 0.2 - 0.17, 0.2], s: [0.3, 0.1, 0.22], r: [0.35, 0, 0] });
        // long pointed tip falling down the back
        hb.add(G.taper([[0, 0.2 - 0.17, -0.25], [0, 0.32 - 0.17, -0.42], [0, 0.2 - 0.17, -0.62], [0, -0.1 - 0.17, -0.7]], 0.17, 0.01, 14, 10), main);
      }
      if (tier !== -1) gemPart(hb, G.oct(0.045), c.gem, tier, { p: [0, -0.42 - 0.17, 0.27], s: [1, 1.3, 0.55] });
      if (tier >= 3) hb.glow(G.tor(0.40 * big + 0.03, 0.008, 4, 22, PI * 1.25), c.gem, { p: [0, -0.13 - 0.17, 0.0], r: [0, 0, -PI * 0.125], s: [1, 1.08, 1] });
      hat.add(hb.build());
      if (tier >= 2) addHalo(X, hat, [0, -0.59, 0.3], c.gem, 0.28, tier);
    } else if (style === 'helm') {
      hat.rotation.x = 0;
      var oy = -0.17;
      var metal = painter(main, oy + 0.0, oy + 0.3, 0.18, null);
      var dome = new T.SphereGeometry(0.372, 22, 9, 0, TAU, 0, PI * 0.4); dome.translate(0, oy, 0.01);
      hat.add(vmesh(dome, metal));
      var guard = new T.SphereGeometry(0.376, 22, 5, PI / 2 + 0.78, TAU - 1.56, PI * 0.4, PI * 0.24); guard.translate(0, oy, 0.01);
      hat.add(vmesh(guard, sh(main, -0.1)));
      hb = new Builder();
      hb.add(G.tor(0.372, 0.028, 5, 30), acc, { p: [0, oy + 0.372 * Math.cos(PI * 0.4), 0.01], r: [PI / 2, 0, 0] });
      hb.add(G.box(0.05, 0.2, 0.035), main, { p: [0, oy + 0.04, 0.37], r: [-0.12, 0, 0] });
      hb.add(G.cyl(0.2, 0.2, 0.035, 18), tier === 0 ? sh(main, 0.15) : acc, { p: [0, oy + 0.29, -0.03], r: [0, 0, PI / 2] });
      for (i = 0; i < 8; i++) { a = (i + 0.5) * TAU / 8; if (Math.cos(a) > 0.8) continue; hb.add(G.sph(0.018, 6, 5), acc, { p: [Math.sin(a) * 0.385, oy + 0.11, Math.cos(a) * 0.385 + 0.01] }); }
      [-1, 1].forEach(function (sx) { hb.add(G.box(0.05, 0.16, 0.13), sh(main, -0.05), { p: [sx * 0.33, oy - 0.06, 0.13], r: [0.1, sx * 0.45, 0] }); });
      gemPart(hb, G.oct(0.045), c.gem, tier === -1 ? 0 : tier, { p: [0, oy + 0.17, 0.355], s: [1, 1.3, 0.5] });
      if (tier >= 3) hb.glow(G.tor(0.205, 0.01, 4, 26, PI), c.gem, { p: [0, oy + 0.29, -0.03], r: [0, PI / 2, 0] });
      hat.add(hb.build());
      addHalo(X, hat, [0, oy + 0.17, 0.39], c.gem, 0.3, tier);
    } else if (style === 'horned') {
      hat.rotation.x = 0;
      var cap = new T.SphereGeometry(0.358, 20, 8, 0, TAU, 0, PI * 0.43); cap.translate(0, -0.17 + 0.0, 0.0);
      hat.add(vmesh(cap, painter(main, -0.17 + 0.05, -0.17 + 0.3, 0.15, null)));
      hb = new Builder();
      hb.add(G.tor(0.352, 0.035, 6, 30), acc, { p: [0, -0.17 + 0.358 * Math.cos(PI * 0.43), 0], r: [PI / 2, 0, 0] });
      var hornC = it && it.color2 && tier >= 1 ? mix(c.acc, '#f4ead2', 0.45) : C('#efe3c4');
      [-1, 1].forEach(function (sx) {
        hb.add(G.taper([[sx * 0.25, 0.0, 0.02], [sx * 0.36, 0.04, 0.03], [sx * 0.46, 0.16, 0.06], [sx * 0.47, 0.3, 0.13], [sx * 0.41, 0.38, 0.22]], 0.07, 0.008, 14, 8), hornC);
        hb.add(G.tor(0.07, 0.016, 5, 12), sh(acc, -0.1), { p: [sx * 0.27, 0.005, 0.02], r: [0, 0, PI / 2] });
        if (tier >= 3) hb.glow(G.cone(0.018, 0.08, 5), c.gem, { p: [sx * 0.41, 0.38, 0.22], r: [0.9, 0, -sx * 0.4] });
      });
      gemPart(hb, G.oct(0.05), c.gem, tier === -1 ? 0 : tier, { p: [0, -0.17 + 0.17, 0.34], s: [1, 1.3, 0.5] });
      hat.add(hb.build());
      addHalo(X, hat, [0, 0.0, 0.38], c.gem, 0.3, tier);
    }
  }

  // ---------------- ROBES ----------------
  var ROBE_STYLES = { bell: 1, layered: 1, long: 1, armored: 1, mantle: 1, battle: 1, artisan: 1, starbound: 1 };   // v1.2 WS6: + artisan / starbound
  var BODICE = [[0.0, 0.47], [0.44, 0.48], [0.445, 0.56], [0.41, 0.7], [0.36, 0.84], [0.315, 0.97], [0.225, 1.08], [0.0, 1.13]];
  function bodiceR(y) {   // outer radius of the bodice at height y (for things lying on the chest)
    for (var i = 1; i < BODICE.length - 1; i++) { var p = BODICE[i], q = BODICE[i + 1]; if (y <= q[1]) return lerp(p[0], q[0], clamp((y - p[1]) / (q[1] - p[1]), 0, 1)); }
    return 0.2;
  }
  // skirt lathe in skirt-pivot space (pivot at y = WAIST); pts given in body space
  function wizSkirtGeo(pts, folds, amp, hem, phase, phiStart, phiLen, rs) {
    var ampFn = function (y) { return amp * (1 - smooth(hem, WAIST + 0.02, y + WAIST)); };
    var shifted = pts.map(function (p) { return [p[0], p[1] - WAIST]; });
    return foldLathe(shifted, phiLen ? Math.max(2, Math.ceil(phiLen / 0.14)) : 26, folds, function (y) { return ampFn(y); }, phase, phiStart, phiLen, rs);
  }
  function skirtPaint(col, hem, folds, amp, phase) {
    return painter(col, hem - WAIST, -0.08, 0.24, { n: folds, ph: phase, amt: amp > 0 ? 0.22 : 0, w: function (y) { return 1 - smooth(hem - WAIST, 0.0, y); } });
  }
  function hemBand(X, pts, folds, amp, hem, phase, col, glowIt) {
    var g = wizSkirtGeo(pts, folds, amp, hem, phase, 0, 0, 1);
    X.skirt.add(vmesh(g, glowIt ? col : painter(col, hem - WAIST - 0.02, hem - WAIST + 0.06, 0.12, null), { glow: !!glowIt }));
  }
  function bodice(X, main, acc, tier, o) {
    o = o || {};
    X.body.add(vmesh(G.lathe(BODICE, 20), painter(main, 0.5, 1.0, 0.12, null)));
    var b = new Builder();
    b.add(G.tor(0.235, 0.06, 5, 16), acc, { p: [0, 1.05, 0], r: [PI / 2, 0, 0] });
    if (!o.noBelt) {
      b.add(G.tor(0.445, 0.05, 5, 22), o.belt || acc, { p: [0, 0.53, 0], r: [PI / 2, 0, 0] });
      b.add(G.box(0.15, 0.13, 0.06), sh(o.belt || acc, -0.2), { p: [0, 0.53, 0.46] });
      gemPart(b, G.oct(0.04), X.gemFor.robe, tier === -1 ? 0 : tier, { p: [0, 0.53, 0.495], s: [1, 1, 0.5] });
      addHalo(X, X.body, [0, 0.53, 0.53], X.gemFor.robe, 0.26, tier === -1 ? 0 : tier);
    }
    if (tier >= 3) {
      b.glow(G.tor(0.24, 0.01, 3, 18), X.gemFor.robe, { p: [0, 0.995, 0], r: [PI / 2, 0, 0] });
      // rune line down the chest
      var pts = []; for (var i = 0; i <= 6; i++) { var y = 0.6 + i * 0.065; pts.push([0, y, bodiceR(y) + 0.006]); }
      b.glow(surfLine(pts, 0.009), X.gemFor.robe);
    }
    X.body.add(b.build());
  }
  function sleeves(X, main, cuff, tier, o) {
    o = o || {};
    [[X.armL, X.elbowL, X.handL, 1], [X.armR, X.elbowR, X.handR, -1]].forEach(function (A) {
      var arm = A[0], elb = A[1], hand = A[2], sd = A[3];
      var ub = new Builder();
      ub.add(G.cyl(0.09, 0.105, 0.28, 10), main, { p: [0, -0.13, 0] });
      ub.add(G.sph(0.108, 10, 7), main);
      if (o.pauldron) {
        ub.add(new T.SphereGeometry(0.17, 14, 8, 0, TAU, 0, PI * 0.55), o.metal, { p: [sd * 0.015, 0.0, 0], s: [1.05, 0.9, 1.1], r: [0, 0, sd * 0.35] });
        ub.add(new T.SphereGeometry(0.15, 14, 6, 0, TAU, 0, PI * 0.5), sh(o.metal, -0.12), { p: [sd * 0.03, -0.08, 0], s: [1.08, 0.8, 1.12], r: [0, 0, sd * 0.45] });
        ub.add(G.tor(0.15, 0.018, 5, 18), o.trimMetal, { p: [sd * 0.035, -0.09, 0], r: [PI / 2, 0, sd * 0.45], order: 'ZYX' });
        if (tier >= 3) ub.glow(G.tor(0.12, 0.009, 4, 18), X.gemFor.robe, { p: [sd * 0.05, 0.06, 0], r: [PI / 2, 0, sd * 0.35], order: 'ZYX' });
      }
      arm.add(ub.build());
      var fb = new Builder(), fl = o.narrow ? 0.12 : 0.17;
      fb.add(G.cyl(0.1, fl, 0.28, 10), main, { p: [0, -0.14, 0] });
      fb.add(G.sph(0.1, 8, 6), main);
      fb.add(G.tor(fl - 0.008, 0.035, 4, 14), cuff, { p: [0, -0.275, 0], r: [PI / 2, 0, 0] });
      if (o.layered) fb.add(G.tor(fl - 0.03, 0.025, 5, 16), sh(cuff, -0.25), { p: [0, -0.21, 0], r: [PI / 2, 0, 0] });
      if (o.bracer) fb.add(G.cyl(0.108, 0.115, 0.13, 12), o.bracer, { p: [0, -0.2, 0] });
      if (tier >= 3) fb.glow(G.tor(fl + 0.012, 0.008, 4, 18), X.gemFor.robe, { p: [0, -0.255, 0], r: [PI / 2, 0, 0] });
      elb.add(fb.build());
      var hb = new Builder();
      hb.add(G.sph(0.088, 10, 7), X.skin, { s: [1, 1.05, 0.95] });
      hb.add(G.sph(0.038, 7, 6), X.skin, { p: [sd * -0.07, 0.02, 0.05] });
      hand.add(hb.build());
    });
  }
  function buildRobe(X, it, style, tier) {
    if (style === 'artisan') return robeArtisan(X, it, tier);       // v1.2 WS6
    if (style === 'starbound') return robeStarbound(X, it, tier);   // v1.2 WS6
    var c = gearCols(it, X.robeC, X.trim, X.gem), main = c.main, acc = accentOf(tier, c);
    X.gemFor.robe = c.gem;
    var plain = tier === 0, b, i, a, pts, ph = PI / 2;
    var hem = HEM, folds = 9, amp = 0.055;
    X.legLen = 0.46;
    if (style === 'bell' || style === 'armored' || style === 'mantle') {
      pts = [[0, 0.28], [0.5, hem], [0.585, hem + 0.012], [0.6, hem + 0.05], [0.565, 0.32], [0.505, 0.42], [0.455, 0.5], [0.435, 0.58], [0, 0.6]];
      X.skirt.add(vmesh(wizSkirtGeo(pts, folds, amp, hem, ph), skirtPaint(main, hem, folds, amp, ph)));
      hemBand(X, [[0.588, hem - 0.003], [0.618, hem + 0.022], [0.622, hem + 0.06], [0.6, hem + 0.088]], folds, amp, hem, ph, acc);
      if (!plain && style === 'bell') {
        var strip = wizSkirtGeo([[0.606, hem + 0.07], [0.568, 0.32], [0.508, 0.42], [0.458, 0.5], [0.44, 0.56]], folds, amp, hem, ph, -0.075, 0.15, 1.012);
        X.skirt.add(vmesh(strip, acc));
      }
      if (tier >= 3) hemBand(X, [[0.612, hem + 0.1], [0.616, hem + 0.112]], folds, amp, hem, ph, c.gem, true);
    } else if (style === 'layered') {
      var tiers = [[0.6, hem, main], [0.6, 0.33, sh(main, -0.14)], [0.565, 0.44, main]];
      tiers.forEach(function (T3, ti) {
        var r = T3[0], hh = T3[1];
        var p3 = [[0, hh + 0.06], [r - 0.08, hh], [r, hh + 0.01], [r + 0.01, hh + 0.04], [0.455 + 0.01 * (2 - ti), 0.52], [0.437, 0.58], [0, 0.6]];
        X.skirt.add(vmesh(wizSkirtGeo(p3, 11, 0.045, hh, ph + ti), skirtPaint(T3[2], hh, 11, 0.045, ph + ti)));
        hemBand(X, [[r + 0.002, hh - 0.004], [r + 0.026, hh + 0.016], [r + 0.03, hh + 0.045], [r + 0.012, hh + 0.064]], 11, 0.045, hh, ph + ti, ti === 1 ? sh(acc, -0.12) : acc);
        if (tier >= 3 && ti === 0) hemBand(X, [[r + 0.02, hh + 0.075], [r + 0.022, hh + 0.087]], 11, 0.045, hh, ph + ti, c.gem, true);
      });
    } else if (style === 'long') {
      hem = 0.06; folds = 14; amp = 0.028;
      pts = [[0, 0.1], [0.44, hem], [0.47, hem + 0.02], [0.465, 0.2], [0.45, 0.36], [0.44, 0.5], [0.435, 0.58], [0, 0.6]];
      X.skirt.add(vmesh(wizSkirtGeo(pts, folds, amp, hem, ph), skirtPaint(main, hem, folds, amp, ph)));
      hemBand(X, [[0.472, hem - 0.004], [0.495, hem + 0.02], [0.497, hem + 0.05], [0.478, hem + 0.07]], folds, amp, hem, ph, acc);
      var tab = tier === 0 ? sh(main, 0.15) : c.acc, tabEdge = sh(tab, -0.3);
      [0, PI].forEach(function (rot) {
        var tg = wizSkirtGeo([[0.49, 0.085], [0.484, 0.2], [0.468, 0.36], [0.458, 0.5], [0.452, 0.56]], 0, 0, hem, 0, rot - 0.36, 0.72, 1.03);
        X.skirt.add(vmesh(tg, painter(tab, 0.08 - WAIST, 0.0, 0.16, null)));
        [-0.37, 0.37].forEach(function (e) {
          X.skirt.add(vmesh(wizSkirtGeo([[0.495, 0.085], [0.489, 0.2], [0.473, 0.36], [0.463, 0.5], [0.457, 0.56]], 0, 0, hem, 0, rot + e - 0.025, 0.05, 1.04), tabEdge));
        });
      });
      b = new Builder();
      b.add(G.box(0.11, 0.11, 0.03), tabEdge, { p: [0, 0.3 - WAIST, 0.515], r: [0.04, 0, PI / 4] });
      gemPart(b, G.oct(0.04), c.gem, tier === -1 ? 0 : tier, { p: [0, 0.3 - WAIST, 0.535], s: [1, 1.2, 0.5] });
      if (tier >= 3) b.glow(G.tor(0.075, 0.008, 4, 4), c.gem, { p: [0, 0.3 - WAIST, 0.53], r: [0, 0, PI / 4] });
      X.skirt.add(b.build());
      addHalo(X, X.skirt, [0, 0.3 - WAIST, 0.56], c.gem, 0.26, tier);
      X.footZ = 0.12;
    } else if (style === 'battle') {
      hem = 0.36; folds = 8; amp = 0.04;
      pts = [[0, 0.42], [0.46, hem], [0.53, hem + 0.012], [0.535, hem + 0.045], [0.49, 0.46], [0.455, 0.52], [0.437, 0.58], [0, 0.6]];
      X.skirt.add(vmesh(wizSkirtGeo(pts, folds, amp, hem, ph), skirtPaint(main, hem, folds, amp, ph)));
      hemBand(X, [[0.536, hem - 0.004], [0.562, hem + 0.018], [0.565, hem + 0.05], [0.54, hem + 0.07]], folds, amp, hem, ph, acc);
      if (tier >= 3) hemBand(X, [[0.552, hem + 0.08], [0.552, hem + 0.092]], folds, amp, hem, ph, c.gem, true);
      X.legLen = 0.6;
    }
    // ---- upper body per style ----
    var metal = tier === 0 ? sh(main, 0.25) : c.acc, trimMetal = sh(metal, -0.25);
    if (style === 'battle') {
      bodice(X, main, acc, tier, { noBelt: true });
      b = new Builder();
      b.add(G.cyl(0.455, 0.46, 0.1, 26, false), sh(main, -0.45), { p: [0, 0.53, 0] });
      b.add(G.box(0.17, 0.15, 0.05), acc, { p: [0, 0.53, 0.465] });
      b.add(G.box(0.1, 0.08, 0.06), sh(acc, -0.35), { p: [0, 0.53, 0.47] });
      gemPart(b, G.oct(0.04), c.gem, tier === -1 ? 0 : tier, { p: [0, 0.53, 0.505], s: [1, 1, 0.5] });
      // sash over the right shoulder to the left hip
      var sash = []; for (i = 0; i <= 24; i++) {
        a = -PI + i / 24 * TAU; var yy = 0.8 - 0.21 * Math.sin(a);
        sash.push([Math.sin(a) * (bodiceR(yy) + 0.02), yy, Math.cos(a) * (bodiceR(yy) + 0.02)]);
      }
      b.add(G.taper(sash, 0.04, 0.04, 36, 5), tier === 0 ? sh(main, 0.2) : c.acc);
      b.add(G.box(0.08, 0.26, 0.03), tier === 0 ? sh(main, 0.2) : c.acc, { p: [0.3, 0.38, 0.33], r: [0.15, 0.6, 0.1] });
      X.body.add(b.build());
      addHalo(X, X.body, [0, 0.53, 0.54], c.gem, 0.26, tier);
      sleeves(X, main, acc, tier, { narrow: true, bracer: tier === 0 ? sh(main, -0.35) : sh(c.acc, -0.15) });
    } else if (style === 'armored') {
      bodice(X, main, acc, tier, { belt: metal });
      b = new Builder();
      // breastplate (front shell) + gorget
      var bpg = new T.LatheGeometry(BODICE.slice(2, 6).map(function (p) { return new T.Vector2(p[0] * 1.06 + 0.012, p[1]); }), 16, -1.25, 2.5);
      b.add(bpg, metal);
      b.add(G.box(0.03, 0.3, 0.03), trimMetal, { p: [0, 0.75, bodiceR(0.75) * 1.06 + 0.02], r: [-0.3, 0, 0] });
      b.add(G.tor(0.25, 0.045, 6, 22), metal, { p: [0, 1.02, 0], r: [PI / 2, 0, 0] });
      gemPart(b, G.oct(0.05), c.gem, tier === -1 ? 2 : tier, { p: [0, 0.8, bodiceR(0.8) * 1.06 + 0.035], s: [1, 1.3, 0.5] });
      X.body.add(b.build());
      addHalo(X, X.body, [0, 0.8, bodiceR(0.8) * 1.06 + 0.08], c.gem, 0.3, tier === -1 ? 0 : tier);
      // tassets on the skirt
      for (i = 0; i < 5; i++) {
        a = (i - 2) * 0.62;
        var tg2 = wizSkirtGeo([[0.5, 0.3], [0.49, 0.38], [0.465, 0.46], [0.45, 0.53]], 0, 0, hem, 0, a - 0.27, 0.54, 1.12);
        X.skirt.add(vmesh(tg2, painter(metal, 0.3 - WAIST, 0.5 - WAIST, 0.2, null), { flat: false }));
        b = new Builder();
        b.add(G.sph(0.016, 6, 5), trimMetal, { p: [Math.sin(a) * 0.57, 0.33 - WAIST, Math.cos(a) * 0.57] });
        X.skirt.add(b.build());
      }
      sleeves(X, main, acc, tier, { pauldron: true, metal: metal, trimMetal: trimMetal, narrow: true, bracer: metal });
    } else if (style === 'mantle') {
      bodice(X, main, acc, tier, {});
      // capelet over the shoulders (on the upper body so it leans with it)
      var cp = foldLathe([[0.0, -0.1], [0.5, -0.15], [0.46, -0.06], [0.36, 0.09], [0.25, 0.17], [0, 0.18]], 20, 10, function (y) { return 0.06 * smooth(0.1, -0.15, y); }, 0);
      X.upper.add(vmesh(cp, painter(sh(main, -0.08), -0.16, 0.1, 0.18, null)));
      b = new Builder();
      b.add(G.tor(0.49, 0.025, 4, 22), acc, { p: [0, -0.14, 0], r: [PI / 2, 0, 0] });
      // tall standing collar behind the head
      b.add(new T.LatheGeometry([new T.Vector2(0.21, 0.08), new T.Vector2(0.26, 0.2), new T.Vector2(0.36, 0.42), new T.Vector2(0.4, 0.5)], 12, PI - 1.35, 2.7), tier === 0 ? sh(main, -0.2) : c.acc);
      b.add(new T.LatheGeometry([new T.Vector2(0.405, 0.5), new T.Vector2(0.37, 0.43), new T.Vector2(0.27, 0.21), new T.Vector2(0.22, 0.08)], 12, PI - 1.35, 2.7), sh(main, -0.35));   // winding-ok: inner lining of the collar (faces inward on purpose)
      gemPart(b, G.oct(0.045), c.gem, tier === -1 ? 0 : tier, { p: [0, 0.1, 0.25], s: [1, 1.3, 0.5] });
      if (tier >= 3) b.glow(G.tor(0.5, 0.01, 3, 24), c.gem, { p: [0, -0.15, 0], r: [PI / 2, 0, 0] });
      X.upper.add(b.build());
      addHalo(X, X.upper, [0, 0.1, 0.29], c.gem, 0.28, tier);
      // cape (spring-driven)
      var cape = X.cape = pivot(X.upper, 0, 0.06, 0);
      var capeC = tier === 0 ? sh(main, -0.2) : c.acc;
      var cg = new T.LatheGeometry([new T.Vector2(0.27, 0.0), new T.Vector2(0.36, -0.2), new T.Vector2(0.52, -0.5), new T.Vector2(0.68, -0.82)], 18, PI - 1.15, 2.3);   // winding-ok: DoubleSide cape
      var cm = new T.Mesh(cg, M.toon(capeC, { side: T.DoubleSide })); cm.castShadow = true; cm.receiveShadow = false; cape.add(cm);
      b = new Builder();
      b.add(new T.TorusGeometry(0.68, 0.022, 4, 20, 2.3), sh(capeC, -0.3), { p: [0, -0.82, 0], r: [PI / 2, 0, -PI / 2 - 1.15] });
      if (tier >= 3) b.glow(new T.TorusGeometry(0.69, 0.009, 4, 20, 2.3), c.gem, { p: [0, -0.78, 0], r: [PI / 2, 0, -PI / 2 - 1.15] });
      cape.add(b.build());
      sleeves(X, main, acc, tier, {});
    } else if (style === 'layered') {
      bodice(X, main, acc, tier, {});
      b = new Builder();
      b.add(G.tor(0.3, 0.03, 5, 22), sh(acc, -0.1), { p: [0, 0.97, 0], r: [PI / 2, 0, 0] });
      X.body.add(b.build());
      sleeves(X, main, acc, tier, { layered: true });
    } else {   // bell / long
      bodice(X, main, acc, tier, {});
      sleeves(X, main, acc, tier, {});
    }
  }

  // ---------------- FEET / BOOTS ----------------
  var BOOT_STYLES = { slippers: 1, boots: 1, greaves: 1, curled: 1, artisan: 1, starwalker: 1 };   // v1.2 WS6: + artisan / starwalker
  function buildFeet(X, it, style, tier) {
    if (style === 'artisan' || style === 'starwalker') return feetV12(X, it, style, tier);   // v1.2 WS6
    var defCol = mix(X.hatC, '#4a2e1c', 0.6);
    var c = gearCols(it, it ? (style === 'greaves' ? '#a7afb8' : X.hatC) : defCol, X.trim, X.gem), main = c.main, acc = accentOf(tier, c);
    var tights = sh(X.robeC, -0.55), sole = C('#3a2a22'), L = X.legLen;
    [X.footL, X.footR].forEach(function (foot, fi) {
      var sd = fi ? -1 : 1, b = new Builder(), i;
      var shinC = style === 'boots' ? main : tights;
      var sg = new T.CylinderGeometry(0.06, 0.058, L - 0.05, 8, 1, false); sg.translate(0, 0.05 + (L - 0.05) / 2, 0);
      foot.add(vmesh(sg, painter(shinC, 0.0, 0.35, 0.15, null)));
      if (style === 'boots') {
        b.add(G.cyl(0.078, 0.082, 0.22, 12), main, { p: [0, 0.15, 0.0] });
        b.add(G.cyl(0.108, 0.088, 0.075, 12), tier === 0 ? sh(main, 0.15) : acc, { p: [0, 0.27, 0] });
        b.add(G.sph(0.112, 10, 7), main, { p: [0, 0.07, 0.07], s: [0.95, 0.66, 1.5] });
        b.add(G.cyl(0.1, 0.1, 0.04, 10), sole, { p: [0, 0.02, 0.07], s: [1, 1, 1.55] });
        b.add(G.box(0.1, 0.05, 0.07), sole, { p: [0, 0.025, -0.06] });
        if (tier >= 1 || tier === -1) { b.add(G.tor(0.084, 0.016, 4, 14), acc, { p: [0, 0.12, 0.0], r: [PI / 2 - 0.25, 0, 0] }); b.add(G.box(0.04, 0.04, 0.02), sh(acc, -0.3), { p: [sd * 0.07, 0.12, 0.04], r: [0, sd * 0.9, 0] }); }
        if (tier >= 2) gemPart(b, G.sph(0.022, 6, 5), c.gem, tier, { p: [0, 0.12, 0.09] });
        if (tier >= 3) b.glow(G.tor(0.106, 0.008, 4, 16), c.gem, { p: [0, 0.31, 0], r: [PI / 2, 0, 0] });
      } else if (style === 'greaves') {
        b.add(new T.CylinderGeometry(0.084, 0.078, 0.3, 12, 1, true, -1.3, 2.6), main, { p: [0, 0.2, 0] });
        b.add(G.sph(0.075, 10, 8), main, { p: [0, L - 0.04, 0.03], s: [1, 0.9, 0.8] });
        b.add(G.sph(0.09, 10, 7), sh(main, -0.08), { p: [0, 0.07, 0.0], s: [1, 0.75, 1.0] });
        b.add(G.sph(0.08, 10, 7), main, { p: [0, 0.065, 0.08], s: [1, 0.62, 1.0] });
        b.add(G.sph(0.07, 10, 7), sh(main, 0.08), { p: [0, 0.058, 0.15], s: [0.95, 0.58, 1.0] });
        b.add(G.cone(0.055, 0.12, 5), main, { p: [0, 0.05, 0.22], r: [PI / 2, 0, 0], s: [1, 1, 0.55] });
        b.add(G.cyl(0.092, 0.092, 0.03, 12), sole, { p: [0, 0.015, 0.06], s: [1, 1, 1.6] });
        [-1, 1].forEach(function (s2) { b.add(G.cone(0.022, 0.07, 5), acc, { p: [s2 * 0.085, 0.1, -0.01], r: [0, 0, -s2 * PI / 2] }); });
        for (i = 0; i < 3; i++) b.add(G.sph(0.012, 5, 4), acc, { p: [0, 0.1 + i * 0.07, 0.083] });
        if (tier >= 2) gemPart(b, G.oct(0.028), c.gem, tier, { p: [0, 0.31, 0.085], s: [1, 1.3, 0.5] });
        if (tier >= 3) b.glow(G.box(0.01, 0.2, 0.01), c.gem, { p: [0, 0.2, 0.09] });
      } else {   // slippers / curled
        var curled = style === 'curled';
        b.add(G.sph(0.1, 10, 7), main, { p: [0, 0.062, 0.075], s: [0.92, 0.6, curled ? 1.45 : 1.6] });
        b.add(G.cyl(0.094, 0.094, 0.028, 10), sole, { p: [0, 0.014, 0.075], s: [1, 1, 1.55] });
        if (tier >= 1 || tier === -1) b.add(G.tor(0.068, 0.017, 3, 12), acc, { p: [0, 0.1, 0.0], r: [PI / 2 - 0.15, 0, 0] });
        if (curled) {
          b.add(G.taper([[0, 0.06, 0.17], [0, 0.08, 0.28], [0, 0.15, 0.34], [0, 0.2, 0.29], [0, 0.16, 0.24]], 0.048, 0.012, 10, 6), main);
          gemPart(b, G.sph(0.034, 7, 5), tier >= 1 || tier === -1 ? c.gem : sh(main, 0.3), tier >= 2 ? 2 : 0, { p: [0, 0.16, 0.235] });
          for (i = 0; i < 3; i++) b.add(G.tor(0.062, 0.016, 3, 10), tier === 0 ? sh(tights, 0.35) : acc, { p: [0, 0.16 + i * 0.075, 0], r: [PI / 2, 0, 0] });
        } else if (tier >= 2) gemPart(b, G.sph(0.022, 6, 5), c.gem, tier, { p: [0, 0.1, 0.2] });
        if (tier >= 3) b.glow(G.tor(0.097, 0.007, 3, 14), c.gem, { p: [0, 0.03, 0.075], r: [PI / 2, 0, 0], s: [1, 1.55, 1] });
      }
      foot.add(b.build());
    });
  }

  // ---------------- WANDS ----------------
  var WAND_STYLES = { staff: 1, wand: 1, scepter: 1, crook: 1, blade: 1, orb: 1, branch: 1, forged: 1, starbound: 1 };   // v1.2 WS6: + forged / starbound
  function buildWand(X, it, style, tier) {
    if (style === 'forged' || style === 'starbound') return wandV12(X, it, style, tier);   // v1.2 WS6
    var c = gearCols(it, X.wood, X.trim, X.staffGem), main = c.main, acc = accentOf(tier, c), gem = c.gem;
    var w = X.wand, b = new Builder(), i, a, gy = 1.38, gz = 0, hs = 0.75, aim = 2.0;
    if (style === 'staff') {
      b.add(G.cyl(0.03, 0.04, 1.75, 9), main, { p: [0, 0.37, 0] });
      b.add(G.sph(0.052, 10, 8), sh(main, -0.1), { p: [0, 1.2, 0], s: [1, 1.2, 1] });
      b.add(G.tor(0.045, 0.018, 5, 10), acc, { p: [0, 1.0, 0], r: [PI / 2, 0, 0] });
      b.add(G.tor(0.045, 0.018, 5, 10), acc, { p: [0, 0.12, 0], r: [PI / 2, 0, 0] });
      for (i = 0; i < 3; i++) { a = i * TAU / 3; b.add(G.cone(0.025, 0.2, 6), acc, { p: [Math.cos(a) * 0.06, 1.3, Math.sin(a) * 0.06], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }); }
      gemPart(b, G.oct(0.11), gem, tier, { p: [0, 1.38, 0], s: [1, 1.35, 1] });
      if (tier >= 1) b.add(G.cyl(0.044, 0.044, 0.16, 9), acc, { p: [0, 0.62, 0] });
      if (tier >= 3) { b.glow(G.tor(0.047, 0.008, 4, 12), gem, { p: [0, 0.78, 0], r: [PI / 2, 0, 0] }); b.glow(G.tor(0.047, 0.008, 4, 12), gem, { p: [0, 0.86, 0], r: [PI / 2, 0, 0] }); }
    } else if (style === 'wand') {
      b.add(G.cyl(0.034, 0.04, 0.26, 9), main, { p: [0, -0.02, 0] });
      b.add(G.sph(0.048, 8, 6), acc, { p: [0, -0.17, 0] });
      b.add(G.tor(0.042, 0.015, 4, 10), acc, { p: [0, 0.11, 0], r: [PI / 2, 0, 0] });
      var sg = new T.CylinderGeometry(0.014, 0.03, 0.62, 8); sg.translate(0, 0.42, 0);
      b.add(sg, sh(main, 0.15));
      for (i = 0; i < 4; i++) { a = i * TAU / 4; b.add(G.cone(0.016, 0.09, 4), acc, { p: [Math.cos(a) * 0.03, 0.74, Math.sin(a) * 0.03], r: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45] }); }
      gemPart(b, G.sph(0.06, 10, 8), gem, tier, { p: [0, 0.8, 0], s: [1, 1.2, 1] });
      if (tier >= 1) b.add(G.tor(0.026, 0.01, 4, 10), acc, { p: [0, 0.36, 0], r: [PI / 2, 0, 0] });
      if (tier >= 3) b.glow(surfLine([[0, 0.14, 0.03], [0.022, 0.32, 0.0], [0, 0.5, -0.022], [-0.014, 0.68, 0]], 0.007), gem);
      gy = 0.8; hs = 0.5; aim = 2.75;
    } else if (style === 'scepter') {
      b.add(G.cyl(0.026, 0.026, 0.95, 9), main, { p: [0, 0.17, 0] });
      b.add(G.sph(0.05, 10, 8), acc, { p: [0, -0.32, 0] });
      b.add(G.tor(0.034, 0.014, 5, 10), acc, { p: [0, 0.1, 0], r: [PI / 2, 0, 0] });
      b.add(G.cyl(0.05, 0.03, 0.08, 10), acc, { p: [0, 0.62, 0] });
      for (i = 0; i < 4; i++) { a = i * TAU / 4 + PI / 4; var ca = Math.cos(a), sa = Math.sin(a);
        b.add(G.taper([[ca * 0.03, 0.64, sa * 0.03], [ca * 0.12, 0.72, sa * 0.12], [ca * 0.12, 0.86, sa * 0.12], [ca * 0.03, 0.96, sa * 0.03]], 0.017, 0.012, 10, 5), main); }
      b.add(G.cone(0.03, 0.12, 6), main, { p: [0, 1.02, 0] });
      gemPart(b, G.sph(0.08, 12, 10), gem, tier, { p: [0, 0.8, 0] });
      if (tier >= 1) b.add(G.tor(0.06, 0.012, 4, 14), acc, { p: [0, 0.665, 0], r: [PI / 2, 0, 0] });
      if (tier >= 3) b.glow(G.tor(0.105, 0.008, 4, 22), gem, { p: [0, 0.8, 0], r: [PI / 2, 0, 0] });
      gy = 0.8; hs = 0.55; aim = 2.4;
    } else if (style === 'crook') {
      b.add(G.cyl(0.03, 0.038, 1.6, 9), main, { p: [0, 0.3, 0] });
      b.add(G.taper([[0, 1.08, 0], [0, 1.3, 0.02], [0, 1.41, 0.15], [0, 1.37, 0.3], [0, 1.23, 0.34]], 0.032, 0.024, 16, 7), main);
      b.add(G.tor(0.04, 0.016, 5, 10), acc, { p: [0, 1.0, 0], r: [PI / 2, 0, 0] });
      b.add(G.tor(0.04, 0.016, 5, 10), acc, { p: [0, 0.1, 0], r: [PI / 2, 0, 0] });
      b.add(G.cyl(0.006, 0.006, 0.07, 4), acc, { p: [0, 1.17, 0.34] });
      b.add(G.cone(0.05, 0.05, 8), acc, { p: [0, 1.14, 0.34], r: [PI, 0, 0] });
      gemPart(b, G.sph(0.065, 10, 8), gem, tier, { p: [0, 1.06, 0.34], s: [1, 1.15, 1] });
      if (tier >= 1) b.add(G.tor(0.036, 0.01, 4, 10), acc, { p: [0, 1.26, 0.02], r: [PI / 2 - 0.3, 0, 0] });
      if (tier >= 3) b.glow(G.tor(0.08, 0.007, 4, 16), gem, { p: [0, 1.06, 0.34], r: [PI / 2, 0, 0] });
      gy = 1.06; gz = 0.34; hs = 0.6; aim = 1.9;
    } else if (style === 'blade') {
      var metal = mix('#dfe6ee', gem, 0.12);
      b.add(G.cyl(0.028, 0.031, 0.22, 9), main, { p: [0, -0.01, 0] });
      b.add(G.sph(0.04, 8, 6), acc, { p: [0, -0.14, 0] });
      b.add(G.box(0.26, 0.045, 0.055), acc, { p: [0, 0.12, 0] });
      [-1, 1].forEach(function (sx) { b.add(G.sph(0.03, 6, 5), acc, { p: [sx * 0.13, 0.12, 0] }); });
      b.add(G.box(0.1, 0.86, 0.024), metal, { p: [0, 0.57, 0] });
      b.add(G.oct(1), metal, { p: [0, 1.0, 0], s: [0.05, 0.16, 0.012] });
      if (tier >= 3) b.glow(G.box(0.018, 0.74, 0.03), gem, { p: [0, 0.55, 0] });
      else b.add(G.box(0.018, 0.74, 0.03), sh(metal, -0.25), { p: [0, 0.55, 0] });
      if (tier >= 1) b.add(G.tor(0.032, 0.008, 4, 10), acc, { p: [0, 0.03, 0], r: [PI / 2, 0, 0] });
      gemPart(b, G.sph(0.03, 8, 6), gem, tier, { p: [0, 0.12, 0.03], s: [1, 1, 0.6] });
      gy = 0.12; gz = 0.04; hs = 0.36; aim = 2.85;
    } else if (style === 'orb') {
      b.add(G.cyl(0.03, 0.04, 1.62, 9), main, { p: [0, 0.31, 0] });
      b.add(G.tor(0.045, 0.018, 5, 10), acc, { p: [0, 1.08, 0], r: [PI / 2, 0, 0] });
      b.add(G.tor(0.045, 0.018, 5, 10), acc, { p: [0, 0.12, 0], r: [PI / 2, 0, 0] });
      for (i = 0; i < 3; i++) { a = i * TAU / 3; var c2 = Math.cos(a), s2 = Math.sin(a);
        b.add(G.taper([[0, 1.08, 0], [c2 * 0.1, 1.15, s2 * 0.1], [c2 * 0.15, 1.3, s2 * 0.15], [c2 * 0.08, 1.43, s2 * 0.08]], 0.024, 0.008, 10, 5), acc); }
      gemPart(b, G.sph(0.14, 14, 10), gem, tier, { p: [0, 1.28, 0] });
      if (tier >= 3) b.glow(G.tor(0.19, 0.008, 4, 26), gem, { p: [0, 1.28, 0], r: [PI / 2 + 0.4, 0.3, 0] });
      gy = 1.28; hs = 0.9; aim = 2.0;
    } else if (style === 'branch') {
      var leaf = it && it.color2 ? c.acc : C('#6fbf4a');
      b.add(G.taper([[0, -0.5, 0], [0.025, -0.05, 0.01], [-0.02, 0.45, -0.01], [0.035, 0.95, 0.02], [0, 1.2, 0]], 0.046, 0.026, 18, 7), main);
      b.add(G.sph(0.04, 6, 5), sh(main, -0.1), { p: [0.03, 0.2, 0.01] });
      b.add(G.sph(0.035, 6, 5), sh(main, -0.1), { p: [-0.02, 0.7, 0.0] });
      b.add(G.taper([[0.03, 0.9, 0.02], [0.12, 1.05, 0.03], [0.16, 1.2, 0.0]], 0.02, 0.008, 8, 5), main);
      b.add(G.taper([[0.0, 1.05, 0.0], [-0.1, 1.18, -0.02], [-0.12, 1.32, 0.03]], 0.018, 0.007, 8, 5), main);
      b.add(G.taper([[0, 1.18, 0], [0.04, 1.3, 0.05], [-0.02, 1.36, 0.02]], 0.02, 0.006, 8, 5), main);
      [[0.17, 1.22, 0.0, 0.5], [0.13, 1.17, 0.06, -0.4], [-0.13, 1.33, 0.04, -0.6], [-0.08, 1.28, -0.06, 0.8], [0.06, 1.0, 0.06, 0.2]].forEach(function (L) {
        b.add(G.sph(1, 6, 4), leaf, { p: [L[0], L[1], L[2]], s: [0.035, 0.012, 0.07], r: [0.3, L[3], 0.5] });
      });
      gemPart(b, G.oct(0.06), gem, tier, { p: [0, 1.25, 0.0], s: [1, 1.4, 1] });
      if (tier >= 1) b.add(G.tor(0.04, 0.01, 4, 10), acc, { p: [0.01, 0.55, 0], r: [PI / 2, 0, 0.1] });
      if (tier >= 3) b.glow(surfLine([[0.045, 0.1, 0.02], [0.03, 0.35, 0.04], [0.01, 0.6, 0.04], [0.04, 0.85, 0.03]], 0.008), gem);
      gy = 1.25; hs = 0.55; aim = 2.0;
    }
    w.add(b.build());
    X.wandGemHalo = null;
    if (tier === -1 || tier >= 2) {
      var hsp = halo(gem, hs, 0.9); hsp.position.set(0, gy, gz); w.add(hsp);
      X.halos.push({ s: hsp, base: hs, wand: true });
    }
    X.wandAim = aim; X.wandGemPos = [0, gy, gz];
  }

  // ---------------- AMULETS ----------------
  var AMULET_STYLES = { pendant: 1, medallion: 1, talisman: 1, gearwork: 1, starbound: 1 };   // v1.2 WS6: + gearwork / starbound
  function buildAmulet(X, it, style, tier) {
    if (style === 'gearwork' || style === 'starbound') return amuletV12(X, it, style, tier);   // v1.2 WS6
    var c = gearCols(it, '#c9a24a', X.trim, X.gem), main = c.main, chainC = tier >= 1 ? c.acc : sh(main, -0.1), gem = c.gem;
    var off = X.chestOff || 0.012, yP = 0.86, b = new Builder();
    [-1, 1].forEach(function (sx) {
      var pts = [];
      for (var i = 0; i <= 8; i++) { var u = i / 8, a = sx * lerp(1.15, 0.0, u), y = lerp(1.07, yP + 0.01, u * u * 0.6 + u * 0.4); var r = bodiceR(y) * (X.chestScale || 1) + off; pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); }
      b.add(G.taper(pts, 0.01, 0.01, 12, 3), chainC);
    });
    X.body.add(b.build());
    var am = X.amulet = pivot(X.body, 0, yP, bodiceR(yP) * (X.chestScale || 1) + off + 0.01);
    b = new Builder();
    var gp;
    if (style === 'medallion') {
      b.add(G.cyl(0.085, 0.085, 0.024, 22), main, { p: [0, -0.085, 0.01], r: [PI / 2 - 0.25, 0, 0] });
      b.add(G.tor(0.062, 0.011, 4, 20), tier === 0 ? sh(main, -0.2) : c.acc, { p: [0, -0.085, 0.025], r: [-0.25, 0, 0] });
      gemPart(b, G.sph(0.034, 10, 8), gem, tier, { p: [0, -0.085, 0.028], s: [1, 1, 0.55] });
      b.add(G.tor(0.016, 0.006, 4, 8), chainC, { p: [0, -0.003, 0.005] });
      if (tier >= 3) b.glow(G.tor(0.084, 0.007, 4, 24), gem, { p: [0, -0.085, 0.024], r: [-0.25, 0, 0] });
      gp = [0, -0.085, 0.06];
    } else if (style === 'talisman') {
      b.add(G.box(0.1, 0.14, 0.024), main, { p: [0, -0.085, 0.01], r: [-0.22, 0, 0] });
      var rc = glowsAt(tier) && tier !== -1 ? null : (tier === 0 ? sh(main, -0.35) : c.acc);
      var rune = function (geo, o) { if (rc) b.add(geo, rc, o); else b.glow(geo, gem, o); };
      rune(G.box(0.012, 0.09, 0.006), { p: [0, -0.085, 0.024], r: [-0.22, 0, 0] });
      rune(G.box(0.06, 0.012, 0.006), { p: [0, -0.065, 0.02], r: [-0.22, 0, 0.5] });
      rune(G.box(0.06, 0.012, 0.006), { p: [0, -0.105, 0.028], r: [-0.22, 0, -0.5] });
      b.add(G.tor(0.016, 0.006, 4, 8), chainC, { p: [0, -0.008, 0.005] });
      if (tier >= 3) b.glow(G.tor(0.08, 0.006, 4, 4), gem, { p: [0, -0.085, 0.024], r: [-0.22, 0, PI / 4], s: [0.85, 1.15, 1] });
      gp = [0, -0.085, 0.06];
    } else {   // pendant
      b.add(G.cone(0.03, 0.04, 8), chainC, { p: [0, -0.02, 0.01], r: [PI, 0, 0] });
      gemPart(b, G.sph(0.05, 12, 10), gem, tier, { p: [0, -0.07, 0.012], s: [0.75, 1.15, 0.55] });
      b.add(G.tor(0.013, 0.005, 4, 8), chainC, { p: [0, 0.0, 0.005] });
      if (tier >= 1) b.add(G.tor(0.04, 0.007, 4, 14), c.acc, { p: [0, -0.07, 0.014], s: [0.8, 1.2, 1] });
      if (tier >= 3) b.glow(G.tor(0.047, 0.006, 4, 16), gem, { p: [0, -0.07, 0.016], s: [0.8, 1.25, 1] });
      gp = [0, -0.07, 0.05];
    }
    am.add(b.build());
    addHalo(X, am, gp, gem, 0.32, tier);
  }

  // ==================================================================
  // ---- v1.2 WS6: Artificer + Starbound gear looks (docs/V1.2-CONTRACT.md §2.5)
  //  Artificer = hat 'artisan', robe 'artisan', boots 'artisan', wand 'forged', amulet 'gearwork':
  //    warm brass, stitched leather and clockwork; cogs and gyroscope rings turn (X.spin, faster while casting).
  //  Starbound = hat 'starbound', robe 'starbound', boots 'starwalker', wand 'starbound', amulet 'starbound':
  //    night-sky cloth, star specks, floating pieces (X.float), star motes shed by the greaves.
  //  Item colours: color = cloth / leather / metal body (Starbound: tinted toward night), color2 = trims and
  //  straps, gem = lenses, crystals and stars. Same rarity ladder as v1.1: common = plain (tarnished brass,
  //  pale painted stars) -> uncommon accent trim -> rare glowing gems/lenses/stars + halos -> epic glowing
  //  filaments -> legendary + the fx aura. Everything is packed into the wizard's one skinned mesh.
  // ==================================================================
  var V12 = { brass: '#c99a3e', leather: '#6e4429', night: '#11143c', star: '#fff3d2', silver: '#dfe4f0', steel: '#a9b1bc' };
  var _v12z = new T.Vector3(0, 0, 1), _v12q = new T.Quaternion(), _v12q2 = new T.Quaternion();
  // build-time cache for constant source geometry that only ever goes through a Builder (merge copies it, never
  // mutates it; the dispose() it calls is a no-op on never-uploaded geometry). Saves ~40% of a v1.2 wizard build.
  var _v12G = {};
  function v12G(key, fn) { var g = _v12G[key]; if (!g) { g = _v12G[key] = fn(); g.userData.sharedGeometry = true; } return g; }
  // a private copy of a cached geometry (for vmesh, which paints its own colour attribute onto the geometry)
  function v12Clone(key, fn) { var g = v12G(key, fn).clone(); delete g.userData.sharedGeometry; return g; }
  function v12Line(key, pts, r) { return v12G('ln_' + key + '_' + r, function () { return surfLine(pts, r); }); }
  // the same cache for primitives handed straight to a Builder (GC.sph(...) etc. = G.sph(...) built once per argument set)
  var GC = {};
  ['sph', 'tor', 'cyl', 'box', 'cone', 'oct'].forEach(function (k) { GC[k] = function () { var a = arguments; return v12G(k + Array.prototype.join.call(a, ','), function () { return G[k].apply(G, a); }); }; });
  // ---- set tiers (V1.2-CONTRACT §6.3): every Artificer / Starbound / Starwalker piece carries look.tier 1|2|3
  //  (missing = 1). The tier drives the same detail ladder the rarity drives for v1.1 gear:
  //    T1 = base colours, glowing gems / lenses / stars + halos      (renders like 'rare')
  //    T2 = + glowing trim filaments + a second accent colour         (renders like 'epic' + acc2)
  //    T3 = + the set's animated aura + gold / star filigree          (renders like 'legendary' + filigree)
  //  Below epic and without a tier (lab rows, any non-endgame use) the plain rarity ladder still applies.
  var V12_SET = { artisan: 'artificer', forged: 'artificer', gearwork: 'artificer', starbound: 'starbound', starwalker: 'starbound' };
  var V12_ACC2 = { artificer: '#2f9c8c', starbound: '#9fb6ff' };   // T2+ second accent: verdigris enamel / moon silver
  var V12_AURA = { artificer: 'clockwork', starbound: 'starfall' };
  var V12_GOLD = '#ffcf5a';
  function v12Tier(it, style, t) { if (!it || !V12_SET[style] || (it.tier == null && t < 3)) return t; var st = +it.tier; return (st >= 3 ? 3 : st >= 2 ? 2 : 1) + 1; }
  //  the second accent: look.color3 = exact override; else the set's own enamel (verdigris / moon silver) tinted
  //  toward the gem, and toward look.accent when the item data gives one (a hint, so the set keeps its identity)
  function v12Acc2(it, set, c) {
    if (it && it.color3) return C(it.color3);
    var a = mix(V12_ACC2[set], c.gem, 0.2);
    return it && it.accent ? a.lerp(C(it.accent), 0.3) : a;
  }
  function brassOf(tier, c) { var b = C(V12.brass); if (tier <= 0) return mix(b, '#7c766a', 0.42); b.lerp(c.acc, 0.1); return tier >= 4 ? mix(b, V12_GOLD, 0.4) : tier >= 3 ? sh(b, 0.06) : b; }   // T3: gilded
  function leatherOf(tier, c) { return tier <= 0 ? sh(V12.leather, -0.1) : mix(V12.leather, c.main, 0.18); }
  function nightOf(col) { return mix(col, V12.night, 0.6); }
  function starTrim(tier, c) { return tier <= 0 ? mix(V12.silver, '#7a7f8c', 0.45) : tier >= 4 ? mix(mix('#ecd28c', c.acc, 0.22), V12_GOLD, 0.45) : mix('#ecd28c', c.acc, 0.22); }   // pale starlit gold (T3: warm gold), never snow-white
  // ---- T3 gold / star filigree (V1.2-CONTRACT §6.3). Drawn on a surface: surf(u, v) -> [x, y, z] with u, v in metres
  //  along the surface. A filigree is a wavy vine with a scroll curl leaving every crest (curling back toward the
  //  vine), tipped with a bead (Artificer) or a little glowing star (Starbound). Thin tubes in the same skinned mesh.
  function curl2(u, v, dir, size, turn, s, n) {   // tapering spiral that starts at (u, v) heading along dir
    var th0 = dir - s * PI / 2, cu = u - size * Math.cos(th0), cv = v - size * Math.sin(th0), out = [];
    for (var i = 0; i <= n; i++) { var k = i / n, th = th0 + s * turn * k, r = size * (1 - 0.7 * k); out.push([cu + r * Math.cos(th), cv + r * Math.sin(th)]); }
    return out;
  }
  function surfNormal(surf, u, v) {
    var p = V3(surf(u, v)), a = V3(surf(u + 0.004, v)).sub(p), b = V3(surf(u, v + 0.004)).sub(p);
    return a.cross(b).normalize().toArray();
  }
  //  o = { waves, amp, r, col, curl (size), turn, tip: 'bead'|'star'|null, tipC, tipS, key (geometry cache key) }
  function filigree(B, surf, u0, v0, u1, v1, o) {
    var du = u1 - u0, dv = v1 - v0, L = Math.sqrt(du * du + dv * dv) || 1, nu = -dv / L, nv = du / L, base = Math.atan2(dv, du);
    var W = o.waves || 3, amp = o.amp || 0.02, r = o.r || 0.004, cs = o.curl || amp * 1.25, N = W * 5, line = [], i, k;
    for (i = 0; i <= N; i++) { var s = i / N, w = Math.sin(s * W * PI) * amp; line.push(surf(u0 + du * s + nu * w, v0 + dv * s + nv * w)); }
    // thin 3-sided tubes, one ring per point (the Catmull-Rom curve keeps them smooth): ~4x lighter than surfLine
    function mk(pts, rr) { return G.taper(pts, rr, rr, Math.max(6, pts.length), 3); }
    function geo(key, pts, rr) { return o.key ? v12G('fil_' + o.key + '_' + key, function () { return mk(pts, rr); }) : mk(pts, rr); }
    B.add(geo('v', line, r), o.col);
    for (k = 0; k < W; k++) {
      var sk = (k + 0.5) / W, side = k % 2 ? -1 : 1, cu = u0 + du * sk + nu * amp * side, cv = v0 + dv * sk + nv * amp * side;
      var c2 = curl2(cu, cv, base + side * 1.05, cs, o.turn || 4.2, -side, 7), pts = c2.map(function (q) { return surf(q[0], q[1]); });
      B.add(geo('c' + k, pts, r * 0.85), o.col);
      if (!o.tip) continue;
      var e = c2[c2.length - 1], ep = surf(e[0], e[1]);
      if (o.tip === 'star') star4(B, ep, surfNormal(surf, e[0], e[1]), o.tipS || r * 5, o.tipC || o.col, true, k);
      else B.add(v12G('bead', function () { return G.oct(1); }), o.tipC || o.col, { p: ep, s: o.tipS || r * 1.8, flat: true });
    }
  }
  // a skirt / coat lathe as a surface (skirt-pivot space): u = metres around at radius Rref (angle = u / Rref), v = body height
  function skirtSurf(prof, Rref, rs, folds, amp, hem, ph, off, dfm) {
    return function (u, yb) {
      var R = v12ProfR(prof, yb), a = u / Rref, f = rs * (1 + amp * (1 - smooth(hem, WAIST + 0.02, yb)) * Math.sin(a * folds + ph)), rr = R * f + off, y = yb - WAIST;
      if (dfm) y = dfm(a, y);
      return [Math.sin(a) * rr, y, Math.cos(a) * rr];
    };
  }
  function starGlow(c) { return mix(V12.star, c.gem, 0.35); }
  // radius of a (monotonic in y) lathe profile at height y
  function v12ProfR(P, y) { for (var j = 0; j < P.length - 1; j++) if (y <= P[j + 1][1]) return lerp(P[j][0], P[j + 1][0], clamp((y - P[j][1]) / (P[j + 1][1] - P[j][1]), 0, 1)); return P[P.length - 1][0]; }
  // flat four-point star lying on a surface: p centre, n surface normal, s size, spin = turn about n
  function star4(B, p, n, s, col, glow, spin) {
    _v12q.setFromUnitVectors(_v12z, V3(n).normalize());
    if (spin) _v12q.multiply(_v12q2.setFromAxisAngle(_v12z, spin));
    var Mx = new T.Matrix4().compose(V3(p), _v12q, new T.Vector3(1, 1, 1));
    [[0.3, 1], [1, 0.3]].forEach(function (k) {
      var o = { matrix: Mx.clone().multiply(new T.Matrix4().makeScale(s * k[0], s * k[1], s * 0.16)) }, og = v12G('oct1', function () { return G.oct(1); });
      if (glow) B.glow(og, col, o); else B.add(og, col, o);
    });
  }
  // extruded five-point star in the XY plane (normal +Z), centred at the origin
  function starShape5(r0, r1, depth) {
    var s = new T.Shape();
    for (var i = 0; i < 10; i++) { var a = PI / 2 + i * PI / 5, r = i % 2 ? r1 : r0; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    var g = new T.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: depth * 0.35, bevelSize: r1 * 0.12, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2); g.deleteAttribute('uv'); g.computeVertexNormals();
    return g;
  }
  // a cog wheel in the XY plane (normal +Z) at o.p / o.r: rim, teeth, spokes, hub (+ glowing ring)
  function cogParts(B, R, n, th, col, hub, glowC, o) {
    o = o || {};
    var base = new T.Matrix4();
    if (o.p) base.makeTranslation(o.p[0], o.p[1], o.p[2]);
    if (o.r) base.multiply(new T.Matrix4().makeRotationFromEuler(new T.Euler(o.r[0], o.r[1], o.r[2])));
    function put(geo, cc, q, glow) { var m = { matrix: base.clone().multiply(mtx(q)) }; if (glow) B.glow(geo, cc, m); else B.add(geo, cc, m); }
    var box1 = v12G('box1', function () { return G.box(1, 1, 1); });
    put(v12G('cogrim' + Math.max(14, n * 2), function () { return G.tor(0.84, 0.17, 5, Math.max(14, n * 2)); }), col, { s: R });
    for (var i = 0; i < n; i++) { var a = i * TAU / n; put(box1, col, { p: [Math.cos(a) * R * 1.07, Math.sin(a) * R * 1.07, 0], r: [0, 0, a - PI / 2], s: [R * 0.3, R * 0.32, th] }); }
    var ns = o.spokes || 4;
    for (var k = 0; k < ns; k++) put(box1, col, { r: [0, 0, k * PI / ns + 0.3], s: [R * 0.13, R * 1.62, th * 0.62] });
    put(v12G('coghub', function () { return G.cyl(1, 1, 1, 12); }), hub || col, { r: [PI / 2, 0, 0], s: [R * 0.3, th * 1.3, R * 0.3] });
    if (glowC) put(v12G('cogglow', function () { return G.tor(0.6, 0.05, 4, 18); }), glowC, { s: R }, true);
  }

  // ---------------- v1.2 hats ----------------
  // Artificer cap: six-panel padded cap with ear flaps, brass goggles pushed up on the brow,
  // a strap-mounted pair of turning cogs and a floppy little tip with a brass bauble.
  function hatArtisan(X, it, tier) {
    var c = gearCols(it, X.hatC, X.trim, X.gem), hat = X.hat, main = c.main, acc = accentOf(tier, c);
    var brass = brassOf(tier, c), lea = leatherOf(tier, c), oy = -0.17, R0 = 0.368, TH = 1.16, i, a;
    var acc2 = tier >= 3 ? v12Acc2(it, 'artificer', c) : null, gold = C(V12_GOLD);   // T2: enamel strap + flap linings; T3: gold seams + filigree
    hat.rotation.x = -0.05;
    var dome = new T.SphereGeometry(R0, 24, 10, 0, TAU, 0, TH); dome.scale(1.03, 1, 1.06); dome.translate(0, oy, 0.008);
    hat.add(vmesh(dome, painter(main, oy + 0.1, oy + 0.34, 0.2, { n: 6, ph: PI / 6, amt: 0.14, w: function () { return 1; } })));
    var hb = new Builder();
    // stitched panel seams
    var seamC = tier >= 4 ? gold : tier >= 1 ? sh(acc, -0.05) : sh(main, -0.32);
    for (i = 0; i < 6; i++) {
      a = -PI / 9 + i * PI / 3; var sp = [];
      for (var k = 0; k <= 6; k++) { var th = 0.1 + (TH - 0.14) * k / 6; sp.push([Math.sin(th) * Math.sin(a) * R0 * 1.03 * 1.01, oy + Math.cos(th) * R0 * 1.006, Math.sin(th) * Math.cos(a) * R0 * 1.06 * 1.01 + 0.008]); }
      hb.add(v12Line('capseam' + i, sp, 0.0062), seamC);
    }
    hb.add(GC.sph(0.03, 8, 6), seamC, { p: [0, oy + R0 + 0.004, 0.008], s: [1, 0.55, 1] });
    // leather headband with brass rivets
    var yB = oy + R0 * Math.cos(TH), rB = R0 * Math.sin(TH), rBo = rB * 1.04 + 0.028;
    hb.add(GC.tor(rB * 1.04, 0.032, 6, 32), lea, { p: [0, yB + 0.012, 0.008], r: [PI / 2, 0, 0], s: [1, 1.03, 1] });
    if (tier >= 1) for (i = 0; i < 12; i++) { a = (i + 0.5) * TAU / 12; hb.add(GC.sph(0.012, 6, 5), brass, { p: [Math.sin(a) * rBo, yB + 0.012, Math.cos(a) * rBo * 1.03 + 0.008] }); }
    // ear flaps with snap + dangling chin strap
    [-1, 1].forEach(function (sx) {
      hb.add(GC.sph(1, 14, 10), lea, { p: [sx * 0.33, oy - 0.03, -0.01], s: [0.062, 0.15, 0.125], r: [0, 0, sx * 0.1] });
      hb.add(GC.sph(1, 12, 8), acc2 ? sh(acc2, -0.1) : sh(lea, 0.16), { p: [sx * 0.322, oy - 0.03, -0.01], s: [0.058, 0.158, 0.132], r: [0, 0, sx * 0.1] });
      hb.add(GC.sph(0.018, 6, 5), brass, { p: [sx * 0.392, oy - 0.08, 0.02] });
      hb.add(GC.box(0.024, 0.11, 0.012), sh(lea, -0.18), { p: [sx * 0.37, oy - 0.21, 0.05], r: [0.15, 0, sx * 0.1] });
      hb.add(GC.box(0.03, 0.022, 0.016), brass, { p: [sx * 0.372, oy - 0.265, 0.058] });
    });
    // brass goggles pushed up on the cap (lenses glow from rare up)
    var gy = 0.012, dyg = gy - oy, strapC = acc2 || (tier >= 1 ? mix(lea, acc, 0.4) : sh(lea, -0.15));
    var zC = 1.06 * Math.sqrt(R0 * R0 - dyg * dyg) + 0.008;
    [-1, 1].forEach(function (sx) {
      var x = sx * 0.104, zz = 1.06 * Math.sqrt(Math.max(0, R0 * R0 - dyg * dyg - (x / 1.03) * (x / 1.03))) + 0.008;
      var n = new T.Vector3(x / 1.0609, dyg, (zz - 0.008) / 1.1236).normalize(), d = [n.x, n.y, n.z];
      var cup = v12G('gogcup', function () { return G.lathe([[0.042, -0.012], [0.074, -0.012], [0.082, 0.018], [0.077, 0.047], [0.063, 0.052], [0.058, 0.036]], 18); });
      hb.add(cup, brass, { p: [x, gy, zz], dir: d });
      var lp = new T.Vector3(x, gy, zz).addScaledVector(n, 0.03);
      if (tier >= 2) hb.glow(GC.sph(0.059, 14, 8), c.gem, { p: lp.toArray(), dir: d, s: [1, 0.34, 1] });
      else {
        hb.add(GC.sph(0.059, 14, 8), tier === 1 ? mix('#2a4656', c.gem, 0.3) : '#27333d', { p: lp.toArray(), dir: d, s: [1, 0.34, 1] });
        hb.add(GC.sph(0.015, 6, 5), '#eaf6ff', { p: lp.clone().addScaledVector(n, 0.018).add(new T.Vector3(-0.02, 0.02, 0)).toArray() });
      }
      if (tier >= 3) { var rg = v12G('gogring', function () { var g0 = G.tor(0.046, 0.006, 4, 18); g0.rotateX(PI / 2); return g0; }); hb.glow(rg, sh(c.gem, 0.35), { p: lp.clone().addScaledVector(n, 0.012).toArray(), dir: d }); }
      addHalo(X, hat, lp.clone().addScaledVector(n, 0.045).toArray(), c.gem, 0.2, tier);
    });
    hb.add(GC.box(0.07, 0.022, 0.024), brass, { p: [0, gy + 0.004, zC + 0.012] });
    var rS = Math.sqrt(R0 * R0 - dyg * dyg);
    if (tier >= 4) {   // T3: a gold scroll on every panel above the strap (the front panel's sits between the goggles' cups)
      var thS = Math.acos(clamp(dyg / R0, -1, 1)) - 0.08;
      for (i = 0; i < 6; i++) {
        var pc = PI / 18 + i * PI / 3;
        filigree(hb, function (u, v) { var th = thS - v / R0, ph = pc + u / (R0 * Math.sin(Math.max(0.2, th))); return [Math.sin(th) * Math.sin(ph) * R0 * 1.03 * 1.014, oy + Math.cos(th) * R0 * 1.014, Math.sin(th) * Math.cos(ph) * R0 * 1.06 * 1.014 + 0.008]; },
          0, i ? 0.0 : 0.03, 0, 0.29, { waves: 2, amp: 0.022, r: 0.0042, curl: 0.03, col: gold, tip: 'bead', tipC: c.gem, tipS: 0.0085, key: 'capP' + i + (i ? '' : 'f') });
      }
    }
    hb.add(GC.tor(rS, 0.019, 5, 34), strapC, { p: [0, gy, 0.008], r: [PI / 2, 0, 0], s: [1.04, 1.075, 1] });
    [-1, 1].forEach(function (sx) { a = sx * 1.5; hb.add(GC.box(0.05, 0.046, 0.016), brass, { p: [Math.sin(a) * rS * 1.05, gy, Math.cos(a) * rS * 1.08 + 0.008], r: [0, a, 0] }); });
    hat.add(hb.build());
    // strap-mounted cogs on the left side, turning
    var gp = pivot(hat, 0.335, 0.03, -0.1); gp.rotation.y = PI / 2 - 0.3;
    var gs = pivot(gp), gb = new Builder();
    cogParts(gb, 0.068, 10, 0.022, brass, sh(brass, -0.25), tier >= 3 ? c.gem : null);
    gemPart(gb, GC.sph(0.02, 8, 6), tier >= 2 ? c.gem : sh(brass, -0.3), tier >= 2 ? tier : 0, { p: [0, 0, 0.016] });
    gs.add(gb.build());
    var gs2 = pivot(gp, 0.086, -0.082, -0.004), gb2 = new Builder();
    cogParts(gb2, 0.036, 7, 0.018, sh(brass, -0.1), null, null, { spokes: 2 }); gs2.add(gb2.build());
    X.spin.push({ o: gs, ax: 'z', w: 0.8, ph: 0, boost: 3 }, { o: gs2, ax: 'z', w: -0.8 * 0.068 / 0.036, ph: 0.25, boost: 3 });
    // floppy tip with a brass bauble (spring-driven like every hat tip)
    var tip = hatTip(X, 0.17, [[0, -0.02, -0.01], [0, 0.07, -0.035], [0, 0.12, -0.11], [0, 0.11, -0.21], [0, 0.05, -0.27]], 0.13, main, tier, c, 12, 'artisan');
    var tb = new Builder(); tb.add(GC.sph(0.03, 10, 8), brass, { p: [0, 0.045, -0.278] });
    if (tier >= 4) { tb.glow(GC.oct(0.022), c.gem, { p: [0, 0.06, -0.3], s: [1, 1.3, 1] }); tb.add(GC.tor(0.031, 0.006, 4, 14), gold, { p: [0, 0.045, -0.278], r: [PI / 2, 0, 0] }); }
    tip.add(tb.build());
  }
  // Starbound hood: a night-sky hood strewn with stars, its peak curling up into a star, under a floating
  // circlet of stars (the circlet bobs; its little stars travel round it).
  function hatStarbound(X, it, tier) {
    var c = gearCols(it, X.hatC, X.trim, X.gem), hat = X.hat, night = nightOf(c.main), trimC = starTrim(tier, c), sg = starGlow(c), glowS = tier >= 2;
    var speck = glowS ? sg : sh(night, 0.55), dusk = mix(night, c.gem, 0.3), oy = -0.26, HR = 0.42, i, a;
    // T2: moon-silver lining, collar band and circlet; T3: gold star-vines climbing the hood beside the face
    var acc2 = tier >= 3 ? v12Acc2(it, 'starbound', c) : null, gold = C(V12_GOLD);
    hat.rotation.x = 0;
    var hg = new T.SphereGeometry(HR, 24, 14, PI / 2 + 0.82, TAU - 1.64, 0, PI * 0.68), hgi = flipGeo(hg.clone());
    hat.add(vmesh(hg, function (x, y, z, nx, ny, nz, out) { var v = smooth(-0.3, 0.36, y); out.copy(night).lerp(dusk, (1 - v) * 0.42).multiplyScalar(0.84 + 0.2 * v); }, { p: [0, oy, 0], s: [1, 1.08, 1.08], receive: false }));
    hat.add(vmesh(hgi, acc2 ? mix(sh(night, -0.3), acc2, 0.3) : sh(night, -0.5), { p: [0, oy, 0], s: [0.995, 1.075, 1.075], receive: false }));
    var hb = new Builder(), rr = seeded(77);
    // stars strewn over the hood
    for (i = 0; i < 15; i++) {
      var th = 0.25 + rr() * 1.45, phi = PI / 2 + 1.0 + rr() * (TAU - 2.0);
      var dx = -Math.cos(phi) * Math.sin(th), dy = Math.cos(th), dz = Math.sin(phi) * Math.sin(th);
      star4(hb, [dx * HR * 1.012, oy + dy * HR * 1.08 * 1.012, dz * HR * 1.08 * 1.012], [dx, dy, dz], 0.02 + rr() * 0.022, speck, glowS, rr() * 2);
    }
    // starlight trim along the face opening
    var edge = [];
    for (i = 0; i <= 18; i++) {
      var u = i / 18, side = u < 0.5, th2 = side ? lerp(PI * 0.66, 0.06, u * 2) : lerp(0.06, PI * 0.66, (u - 0.5) * 2), ph2 = side ? PI / 2 - 0.82 : PI / 2 + 0.82;
      edge.push([-Math.cos(ph2) * Math.sin(th2) * HR * 1.012, oy + Math.cos(th2) * HR * 1.08 * 1.012, Math.sin(ph2) * Math.sin(th2) * HR * 1.08 * 1.012]);
    }
    hb.add(v12Line('hoodedge', edge, 0.015), trimC);
    if (tier >= 3) hb.glow(v12Line('hoodedge2', edge.map(function (p) { return [p[0] * 1.03, oy + (p[1] - oy) * 1.03, p[2] * 1.03]; }), 0.011), sg);
    if (tier >= 4) [-1, 1].forEach(function (sx) {
      var ph0 = PI / 2 + sx * (0.82 + 0.2);
      filigree(hb, function (u, v) { var th = v / HR, ph = ph0 + u / (HR * Math.max(0.3, Math.sin(th))); return [-Math.cos(ph) * Math.sin(th) * HR * 1.016, oy + Math.cos(th) * HR * 1.08 * 1.016, Math.sin(ph) * Math.sin(th) * HR * 1.08 * 1.016]; },
        0, PI * 0.62 * HR, 0, 0.32 * HR, { waves: 3, amp: 0.022, r: 0.0048, curl: 0.026, col: gold, tip: 'star', tipC: sg, tipS: 0.018, key: 'hoodV' + sx });
    });
    // collar + crescent-and-star clasp
    hb.add(GC.tor(0.3, 0.085, 6, 18), night, { p: [0, oy - 0.21, -0.02], r: [PI / 2 + 0.15, 0, 0] });
    hb.add(GC.tor(0.37, 0.016, 4, 24), acc2 || trimC, { p: [0, oy - 0.2, -0.02], r: [PI / 2 + 0.15, 0, 0] });
    hb.add(GC.tor(0.052, 0.013, 5, 16, PI * 1.3), trimC, { p: [0, oy - 0.25, 0.32], r: [-0.2, 0, PI * 0.85] });
    star4(hb, [0.008, oy - 0.25, 0.335], [0, 0.2, 1], 0.05, glowS ? sg : trimC, glowS);
    hat.add(hb.build());
    addHalo(X, hat, [0.008, oy - 0.25, 0.37], sg, 0.22, tier);
    // the peak curls up and back and ends in a star (spring-driven)
    var tip = X.hatTip = pivot(hat, 0, 0.1, -0.16);
    tip.add(vmesh(v12Clone('tip_starhood', function () { return G.taper([[0, -0.02, 0.02], [0, 0.12, -0.07], [0, 0.22, -0.21], [0, 0.21, -0.35], [0, 0.14, -0.42]], 0.135, 0.01, 16, 10); }), function (x, y, z, nx, ny, nz, out) { out.copy(night).lerp(dusk, smooth(-0.1, -0.42, z) * 0.35).multiplyScalar(0.9 + 0.12 * ny); }));
    var tb = new Builder();
    star4(tb, [0, 0.135, -0.43], [0, 0, 1], 0.07, glowS ? sg : trimC, glowS);
    star4(tb, [0, 0.135, -0.43], [1, 0, 0], 0.05, glowS ? sg : trimC, glowS);
    for (i = 0; i < 4; i++) star4(tb, [0, 0.07 + i * 0.04, -0.12 - i * 0.07], [0, 1, 0.3], 0.018, speck, glowS, i);
    tip.add(tb.build());
    // floating circlet of stars, tilted back over the hood
    var hp = pivot(hat, 0, 0.22, -0.03); hp.rotation.x = -0.34;
    var cb = new Builder();
    cb.add(GC.tor(0.4, 0.012, 5, 44), trimC, { r: [PI / 2, 0, 0] });
    if (acc2) cb.add(GC.tor(0.4, 0.007, 4, 44), acc2, { r: [PI / 2, 0, 0], p: [0, -0.014, 0] });
    if (tier >= 3) cb.glow(GC.tor(0.4, 0.0055, 4, 44), sg, { r: [PI / 2, 0, 0], p: [0, 0.013, 0] });
    cb.add(GC.tor(0.068, 0.014, 5, 16, PI * 1.25), trimC, { p: [0, 0.03, 0.4], r: [0, 0, PI * 0.875] });
    star4(cb, [0, 0.03, 0.41], [0, 0, 1], 0.08, glowS ? sg : trimC, glowS);
    hp.add(cb.build());
    addHalo(X, hp, [0, 0.03, 0.45], sg, 0.24, tier);
    var crown = pivot(hp), sb = new Builder();
    for (i = 0; i < 7; i++) {
      a = (i + 1) * TAU / 8;
      star4(sb, [Math.sin(a) * 0.4, 0.012, Math.cos(a) * 0.4], [Math.sin(a), 0.2, Math.cos(a)], i % 2 ? 0.032 : 0.045, glowS ? sg : trimC, glowS);
    }
    crown.add(sb.build());
    X.float.push({ o: hp, p: [0, 0.22, -0.03], amp: 0.018, f: 1.6, ph: X.seed * 6, rz: 0.05, r0: 0, lift: 0.05 });
    X.spin.push({ o: crown, ax: 'y', w: 0.4, ph: 0, boost: 2 });
  }

  // ---------------- v1.2 robes ----------------
  // coat-tails: the back of the coat hangs lower and splits in the middle (skirt-pivot space)
  function coatDeform(g, back, notch) {
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.abs(Math.atan2(x, z));
      var low = 1 - smooth(-0.3, -0.1, y), bf = smooth(1.5, 2.5, a), nf = smooth(PI - 0.36, PI - 0.05, a);
      p.setY(i, y - (back * bf - notch * nf) * low);
    }
    g.computeVertexNormals();
    return g;
  }
  // Artificer coat: an open long coat with split tails over a darker tunic, lapels and a shirt front,
  // double-breasted brass buttons, a wide tool belt (buckle, pouches, a wrench, glowing vials),
  // a turning cog brooch, leather shoulder pads and bracers.
  function robeArtisan(X, it, tier) {
    var c = gearCols(it, X.robeC, X.trim, X.gem), main = c.main, acc = accentOf(tier, c), brass = brassOf(tier, c), lea = leatherOf(tier, c);
    X.gemFor.robe = c.gem;
    var hem = 0.2, folds = 8, amp = 0.04, ph = PI / 2, gap = 0.5, b, i, a;
    X.legLen = 0.46;
    // T2: the tunic, lapels and bow turn to the second accent (verdigris enamel by default); T3: gold filigree hem
    // border, a gilded cog crest on the back, gold-piped lapels, gilded brass
    var acc2 = tier >= 3 ? v12Acc2(it, 'artificer', c) : null, gold = C(V12_GOLD);
    var tunic = acc2 ? sh(acc2, -0.45).lerp(C('#2a2420'), 0.25) : sh(main, -0.42).lerp(C('#3a2c24'), 0.3);
    var tp = [[0, 0.24], [0.5, hem], [0.56, hem + 0.01], [0.572, hem + 0.05], [0.535, 0.33], [0.49, 0.42], [0.45, 0.5], [0.433, 0.58], [0, 0.6]];
    X.skirt.add(vmesh(wizSkirtGeo(tp, folds, amp, hem, ph), skirtPaint(tunic, hem, folds, amp, ph)));
    var cHem = 0.25, cp = [[0.57, cHem], [0.6, cHem + 0.012], [0.612, cHem + 0.05], [0.575, 0.36], [0.515, 0.44], [0.466, 0.51], [0.448, 0.58]];
    X.skirt.add(vmesh(coatDeform(wizSkirtGeo(cp, folds, amp, hem, ph, gap, TAU - 2 * gap, 1.03), 0.13, 0.1), skirtPaint(main, cHem - 0.08, folds, amp, ph)));
    var band = coatDeform(wizSkirtGeo([[0.6, cHem - 0.004], [0.624, cHem + 0.016], [0.628, cHem + 0.045], [0.61, cHem + 0.064]], folds, amp, hem, ph, gap, TAU - 2 * gap, 1.03), 0.13, 0.1);
    X.skirt.add(vmesh(band, tier >= 1 ? acc : sh(main, -0.25)));
    var edgeC = tier >= 1 ? acc : sh(main, -0.28);
    [gap - 0.01, TAU - gap - 0.06].forEach(function (s0, si) {
      X.skirt.add(vmesh(wizSkirtGeo(cp, folds, amp, hem, ph, s0, 0.07, 1.042), edgeC));
      if (tier >= 3) X.skirt.add(vmesh(wizSkirtGeo(cp, folds, amp, hem, ph, s0 + (si ? 0.044 : 0.014), 0.012, 1.052), c.gem, { glow: true }));
      // brass buttons down the coat front
      b = new Builder();
      for (var bi = 0; bi < 3; bi++) {
        var yy = 0.5 - bi * 0.09, aa = si ? -gap - 0.06 : gap + 0.06, rr = v12ProfR(cp.slice(2), yy) * 1.06 + 0.012;
        b.add(GC.sph(0.019, 8, 6), brass, { p: [Math.sin(aa) * rr, yy - WAIST, Math.cos(aa) * rr] });
      }
      X.skirt.add(b.build());
    });
    if (tier >= 3) X.skirt.add(vmesh(coatDeform(wizSkirtGeo([[0.622, cHem + 0.075], [0.624, cHem + 0.087]], folds, amp, hem, ph, gap, TAU - 2 * gap, 1.03), 0.13, 0.1), c.gem, { glow: true }));
    if (tier >= 4) {
      var cDf = function (aa, y) { var ab = Math.abs(Math.atan2(Math.sin(aa), Math.cos(aa))); return y - (0.13 * smooth(1.5, 2.5, ab) - 0.1 * smooth(PI - 0.36, PI - 0.05, ab)) * (1 - smooth(-0.3, -0.1, y)); };
      var cS = skirtSurf(cp, 0.6, 1.03, folds, amp, hem, ph, 0.008, cDf), fb = new Builder();
      // gold scroll border just above the glowing filament, panel by panel (the coat tails split at the back)
      [[gap + 0.1, PI - 0.14], [PI + 0.14, TAU - gap - 0.1]].forEach(function (sp, k) {
        filigree(fb, cS, sp[0] * 0.6, cHem + 0.13, sp[1] * 0.6, cHem + 0.13, { waves: 7, amp: 0.022, r: 0.0045, curl: 0.026, col: gold, tip: 'bead', tipC: sh(gold, 0.25), tipS: 0.007, key: 'coatB' + k });
      });
      // the back crest: a gilded cog flanked by two scrolls, set into the coat between the shoulder blades of the skirt
      var cy0 = 0.4, cp0 = cS(PI * 0.6, cy0), tilt = Math.atan2(v12ProfR(cp, cy0 - 0.03) - v12ProfR(cp, cy0 + 0.03), 0.06);
      cogParts(fb, 0.07, 10, 0.016, gold, sh(brass, -0.2), c.gem, { p: [cp0[0], cp0[1], cp0[2] - 0.012], r: [tilt, PI, 0] });
      [-1, 1].forEach(function (sx) {
        filigree(fb, cS, PI * 0.6 + sx * 0.085, cy0 - 0.02, PI * 0.6 + sx * 0.2, cy0 + 0.035, { waves: 1, amp: 0.012, r: 0.0045, curl: 0.032, turn: 4.6, col: gold, tip: 'bead', tipC: c.gem, tipS: 0.009, key: 'coatC' + sx });
      });
      X.skirt.add(fb.build());
    }
    // upper body
    bodice(X, main, acc, tier, { noBelt: true });
    b = new Builder();
    var shirt = tier >= 1 ? mix('#efe4cc', c.acc, 0.12) : C('#ddd2bc');
    b.add(GC.box(0.13, 0.27, 0.012), shirt, { p: [0, 0.88, bodiceR(0.88) + 0.003], r: [-0.34, 0, 0] });
    var lapC = acc2 || (tier >= 1 ? acc : sh(main, -0.2));
    [-1, 1].forEach(function (sx) {
      b.add(GC.box(0.085, 0.3, 0.02), lapC, { p: [sx * 0.082, 0.87, bodiceR(0.87) + 0.012], r: [-0.34, sx * 0.3, -sx * 0.32], flat: true });
      if (tier >= 4) b.add(GC.box(0.012, 0.3, 0.024), gold, { p: [sx * 0.118, 0.87, bodiceR(0.87) + 0.016], r: [-0.34, sx * 0.3, -sx * 0.32] });
      for (var k = 0; k < 2; k++) b.add(GC.sph(0.021, 8, 6), brass, { p: [sx * 0.07, 0.63 + k * 0.07, bodiceR(0.63 + k * 0.07) + 0.012] });
    });
    // neck bow in the accent colour
    [-1, 1].forEach(function (sx) { b.add(GC.cone(0.04, 0.07, 6), acc2 ? sh(acc2, 0.1) : tier >= 1 ? c.acc : sh(main, -0.1), { p: [sx * 0.03, 1.02, bodiceR(1.02) + 0.03], r: [0, 0, sx * PI / 2], s: [1, 1, 0.55] }); });
    b.add(GC.sph(0.018, 8, 6), tier >= 1 ? sh(c.acc, -0.2) : sh(main, -0.25), { p: [0, 1.02, bodiceR(1.02) + 0.035] });
    // tool belt
    b.add(GC.cyl(0.462, 0.472, 0.115, 30, true), lea, { p: [0, 0.535, 0] });
    b.add(GC.tor(0.468, 0.011, 4, 30), sh(lea, 0.22), { p: [0, 0.586, 0], r: [PI / 2, 0, 0] });
    b.add(GC.tor(0.47, 0.011, 4, 30), sh(lea, 0.22), { p: [0, 0.484, 0], r: [PI / 2, 0, 0] });
    var bz = 0.478;
    b.add(GC.box(0.15, 0.024, 0.024), brass, { p: [0, 0.59, bz] }); b.add(GC.box(0.15, 0.024, 0.024), brass, { p: [0, 0.48, bz] });
    b.add(GC.box(0.024, 0.13, 0.024), brass, { p: [-0.064, 0.535, bz] }); b.add(GC.box(0.024, 0.13, 0.024), brass, { p: [0.064, 0.535, bz] });
    b.add(GC.box(0.014, 0.1, 0.02), sh(brass, -0.2), { p: [0.01, 0.535, bz + 0.006] });
    function pouch(pa, w, h, d, y) {
      var px = Math.sin(pa) * 0.5, pz = Math.cos(pa) * 0.5;
      b.add(rbox(w, h, d, 0.025), sh(lea, 0.06), { p: [px, y, pz], r: [0, pa, 0] });
      b.add(rbox(w * 1.06, h * 0.42, d * 1.14, 0.02), sh(lea, -0.14), { p: [px, y + h * 0.33, pz], r: [0.06, pa, 0] });
      b.add(GC.sph(0.016, 6, 5), brass, { p: [Math.sin(pa) * (0.5 + d * 0.58), y + h * 0.2, Math.cos(pa) * (0.5 + d * 0.58)] });
    }
    pouch(1.12, 0.15, 0.15, 0.085, 0.45); pouch(PI - 0.4, 0.19, 0.17, 0.09, 0.44);
    // wrench hanging on the right hip
    var wa = -1.18, wr = 0.5, steel = tier <= 0 ? sh(V12.steel, -0.25) : C(V12.steel);
    b.add(GC.tor(0.022, 0.007, 4, 10), brass, { p: [Math.sin(wa) * wr, 0.48, Math.cos(wa) * wr], r: [0, wa, 0] });
    b.add(GC.box(0.03, 0.24, 0.014), steel, { p: [Math.sin(wa) * (wr + 0.01), 0.35, Math.cos(wa) * (wr + 0.01)], r: [0.05, wa, 0.06] });
    b.add(GC.tor(0.04, 0.014, 4, 12, PI * 1.35), steel, { p: [Math.sin(wa) * (wr + 0.012), 0.21, Math.cos(wa) * (wr + 0.012)], r: [0, wa, -PI * 0.18] });
    // vials in a little holder (glowing liquid from rare up)
    var va = 1.78;
    b.add(rbox(0.11, 0.06, 0.05, 0.015), sh(lea, -0.1), { p: [Math.sin(va) * 0.5, 0.46, Math.cos(va) * 0.5], r: [0, va, 0] });
    [-1, 1].forEach(function (k) {
      var vx = Math.sin(va) * 0.5 + Math.cos(va) * k * 0.028, vz = Math.cos(va) * 0.5 - Math.sin(va) * k * 0.028;
      b.add(GC.cyl(0.021, 0.021, 0.1, 10), '#cfe8ee', { p: [vx, 0.5, vz] });
      gemPart(b, GC.cyl(0.017, 0.017, 0.07, 10), c.gem, tier, { p: [vx, 0.49, vz] });
      b.add(GC.cyl(0.015, 0.018, 0.025, 8), '#8a6040', { p: [vx, 0.56, vz] });
    });
    X.body.add(b.build());
    addHalo(X, X.body, [Math.sin(va) * 0.56, 0.5, Math.cos(va) * 0.56], c.gem, 0.22, tier);
    // turned-down collar
    var col = new T.Mesh(new T.LatheGeometry([new T.Vector2(0.2, 0.0), new T.Vector2(0.235, 0.075), new T.Vector2(0.275, 0.06), new T.Vector2(0.305, -0.025)], 22, 0.62, TAU - 1.24), M.toon(sh(main, -0.1), { side: T.DoubleSide }));   // winding-ok: DoubleSide collar
    col.position.y = 0.075; col.castShadow = true; col.receiveShadow = false; X.upper.add(col);
    // cog brooch on the chest (turns)
    var ba = 0.44, by = 0.885, bR = bodiceR(by) + 0.014;
    var bp = pivot(X.body, Math.sin(ba) * bR, by, Math.cos(ba) * bR); bp.rotation.set(-0.33, ba, 0, 'YXZ');
    var bs = pivot(bp), bb = new Builder();
    cogParts(bb, 0.046, 9, 0.016, brass, sh(brass, -0.22), tier >= 3 ? c.gem : null);
    gemPart(bb, GC.sph(0.016, 8, 6), tier >= 1 ? c.gem : sh(brass, -0.3), tier, { p: [0, 0, 0.012] });
    bs.add(bb.build());
    X.spin.push({ o: bs, ax: 'z', w: 0.6, ph: 0.4, boost: 3 });
    addHalo(X, bp, [0, 0, 0.04], c.gem, 0.2, tier);
    sleeves(X, main, brass, tier, { pauldron: true, metal: lea, trimMetal: brass, bracer: sh(lea, -0.06) });
  }
  // Starbound mantle: a long night-sky robe that fades to twilight at the hem, strewn with stars (and a
  // constellation), a starlit capelet and cape, a crescent clasp, and two shoulder plates that float.
  function robeStarbound(X, it, tier) {
    var c = gearCols(it, X.robeC, X.trim, X.gem), night = nightOf(c.main), trimC = starTrim(tier, c), sg = starGlow(c), glowS = tier >= 2;
    var speck = glowS ? sg : sh(night, 0.55), dusk = mix(night, c.gem, 0.3);
    // T2: a moon-silver band over the hem, silver-enamelled shoulder plates and capelet band;
    // T3: gold star-vines rising from the hem, a gold scroll border on the cape
    var acc2 = tier >= 3 ? v12Acc2(it, 'starbound', c) : null, gold = C(V12_GOLD);
    X.gemFor.robe = c.gem;
    var hem = 0.2, folds = 7, amp = 0.05, ph = PI / 2, b, i, a;
    X.legLen = 0.46; X.footZ = 0.06;
    var pts = [[0, 0.24], [0.56, hem], [0.655, hem + 0.012], [0.668, hem + 0.05], [0.615, 0.3], [0.54, 0.39], [0.475, 0.48], [0.437, 0.58], [0, 0.6]];
    X.skirt.add(vmesh(wizSkirtGeo(pts, folds, amp, hem, ph), function (x, y, z, nx, ny, nz, out) {
      var v = smooth(hem - WAIST, 0.0, y), k = 1 - v, fold = 0.5 - 0.5 * Math.sin(Math.atan2(x, z) * folds + ph);
      out.copy(night).lerp(dusk, k * k * 0.8).multiplyScalar((0.82 + 0.2 * v) * (1 - 0.16 * fold * (0.3 + 0.7 * k)));
      if (ny < -0.55) out.multiplyScalar(0.8);
    }));
    hemBand(X, [[0.668, hem - 0.002], [0.687, hem + 0.013], [0.69, hem + 0.038], [0.674, hem + 0.054]], folds, amp, hem, ph, trimC);
    if (tier >= 3) hemBand(X, [[0.666, hem + 0.066], [0.668, hem + 0.083]], folds, amp, hem, ph, sg, true);
    if (acc2) hemBand(X, [[0.664, hem + 0.093], [0.668, hem + 0.1], [0.666, hem + 0.118], [0.66, hem + 0.123]], folds, amp, hem, ph, acc2);
    var prof = [[0.668, hem + 0.05], [0.615, 0.3], [0.54, 0.39], [0.475, 0.48], [0.437, 0.56]];
    function onSkirt(aa, yy, out) {
      var f = 1 + amp * (1 - smooth(hem, WAIST + 0.02, yy)) * Math.sin(aa * folds + ph), R2 = v12ProfR(prof, yy) * f + (out || 0.006);
      return [Math.sin(aa) * R2, yy - WAIST, Math.cos(aa) * R2];
    }
    var sb = new Builder(), rr = seeded(311);
    for (i = 0; i < 30; i++) {
      var yy = hem + 0.07 + Math.pow(rr(), 1.3) * 0.3, aa = rr() * TAU;
      star4(sb, onSkirt(aa, yy), [Math.sin(aa), 0.3, Math.cos(aa)], 0.016 + rr() * 0.022, speck, glowS, rr() * 3);
    }
    // a constellation on the front-left panel
    var CN = [[0.25, 0.3], [0.42, 0.37], [0.6, 0.33], [0.72, 0.42], [0.55, 0.47]];
    CN.forEach(function (p) { star4(sb, onSkirt(p[0], p[1], 0.01), [Math.sin(p[0]), 0.3, Math.cos(p[0])], 0.034, glowS ? sg : trimC, glowS); });
    if (tier >= 4) {   // gold star-vines rising from the hem (the front-left constellation panel stays clear)
      var rS = skirtSurf(prof, 0.6, 1, folds, amp, hem, ph, 0.009);
      [1.25, 1.95, 2.65, PI + 0.45, PI + 1.2, PI + 1.95, -0.32].forEach(function (aa, k) {
        filigree(sb, rS, aa * 0.6, hem + 0.15, aa * 0.6 + (k % 2 ? 0.02 : -0.02), 0.47, { waves: 2, amp: 0.012, r: 0.0042, curl: 0.03, turn: 4.6, col: gold, tip: 'star', tipC: sg, tipS: 0.018, key: 'sbRobe' + k });
      });
    }
    if (tier >= 1) for (i = 0; i < CN.length - 1; i++) {
      var p0 = CN[i], p1 = CN[i + 1], line = [];
      for (var q = 0; q <= 4; q++) { var uu = q / 4; line.push(onSkirt(lerp(p0[0], p1[0], uu), lerp(p0[1], p1[1], uu), 0.008)); }
      if (tier >= 3) sb.glow(v12Line('cn' + i, line, 0.0045), sg); else sb.add(v12Line('cn' + i, line, 0.004), sh(trimC, -0.15));
    }
    X.skirt.add(sb.build());
    // upper body: bodice + star belt, capelet, clasp
    bodice(X, night, trimC, tier, { belt: trimC });
    var cp = foldLathe([[0.0, -0.1], [0.5, -0.15], [0.46, -0.06], [0.36, 0.09], [0.25, 0.17], [0, 0.18]], 22, 9, function (y) { return 0.05 * smooth(0.1, -0.15, y); }, 0);
    X.upper.add(vmesh(cp, function (x, y, z, nx, ny, nz, out) { out.copy(sh(night, 0.05)).lerp(dusk, smooth(-0.02, -0.15, y) * 0.35).multiplyScalar(0.82 + 0.2 * smooth(-0.16, 0.12, y)); }));
    b = new Builder();
    b.add(GC.tor(0.49, 0.015, 4, 26), trimC, { p: [0, -0.14, 0], r: [PI / 2, 0, 0] });
    if (acc2) b.add(GC.tor(0.47, 0.012, 4, 26), acc2, { p: [0, -0.115, 0], r: [PI / 2, 0, 0] });
    if (tier >= 3) b.glow(GC.tor(0.5, 0.012, 3, 26), sg, { p: [0, -0.157, 0], r: [PI / 2, 0, 0] });
    for (i = 0; i < 10; i++) { a = PI * 0.62 + i * PI * 0.76 / 9 + (i % 2) * 0.05; var ry = -0.06 + (i % 3) * 0.06, rad2 = ry < 0 ? 0.46 : ry < 0.05 ? 0.39 : 0.31; star4(b, [Math.sin(a) * rad2, ry, Math.cos(a) * rad2], [Math.sin(a), 0.6, Math.cos(a)], 0.02 + (i % 3) * 0.006, speck, glowS, i); }
    b.add(GC.tor(0.06, 0.016, 6, 16, PI * 1.3), trimC, { p: [0, 0.09, 0.262], r: [-0.25, 0, PI * 0.85] });
    star4(b, [0.01, 0.09, 0.27], [0, 0.3, 1], 0.05, glowS ? sg : trimC, glowS);
    X.upper.add(b.build());
    addHalo(X, X.upper, [0.01, 0.09, 0.31], sg, 0.24, tier);
    // cape (spring-driven) with stars on its outer side
    var cape = X.cape = pivot(X.upper, 0, 0.06, 0);
    var capeC = sh(night, -0.12), cpr = [[0.27, 0.0], [0.37, -0.22], [0.54, -0.52], [0.7, -0.86]];
    var cg = new T.LatheGeometry(cpr.map(function (p) { return new T.Vector2(p[0], p[1]); }), 18, PI - 1.15, 2.3);   // winding-ok: DoubleSide cape
    var cm = new T.Mesh(cg, M.toon(capeC, { side: T.DoubleSide })); cm.castShadow = true; cm.receiveShadow = false; cape.add(cm);
    b = new Builder();
    b.add(new T.TorusGeometry(0.7, 0.022, 4, 22, 2.3), trimC, { p: [0, -0.86, 0], r: [PI / 2, 0, -PI / 2 - 1.15] });
    if (tier >= 4) {   // gold scroll border along the cape's lower edge (outer side)
      var cpU = cpr.slice().reverse();
      filigree(b, function (u, v) { var a2 = u / 0.66, rr = v12ProfR(cpU, v) * 1.02 + 0.01; return [Math.sin(a2) * rr, v, Math.cos(a2) * rr]; },
        (PI - 1.0) * 0.66, -0.76, (PI + 1.0) * 0.66, -0.76, { waves: 9, amp: 0.026, r: 0.0055, curl: 0.03, col: gold, tip: 'star', tipC: sg, tipS: 0.016, key: 'sbCape' });
    }
    if (tier >= 3) b.glow(new T.TorusGeometry(0.71, 0.013, 4, 22, 2.3), sg, { p: [0, -0.82, 0], r: [PI / 2, 0, -PI / 2 - 1.15] });
    var rc = seeded(97);
    for (i = 0; i < 16; i++) {
      var pa = PI - 0.95 + rc() * 1.9, v = 0.12 + rc() * 0.8, seg = Math.min(2, Math.floor(v * 3)), lu = v * 3 - seg;
      var R3 = lerp(cpr[seg][0], cpr[seg + 1][0], lu) * 1.02 + 0.006, Y3 = lerp(cpr[seg][1], cpr[seg + 1][1], lu);
      star4(b, [Math.sin(pa) * R3, Y3, Math.cos(pa) * R3], [Math.sin(pa), 0.3, Math.cos(pa)], 0.02 + rc() * 0.022, speck, glowS, rc() * 3);
    }
    cape.add(b.build());
    // floating shoulder plates (night-silver shells with a starlit rim and a star)
    [-1, 1].forEach(function (sx) {
      var fp = pivot(X.upper, sx * 0.52, 0.26, -0.03), pb = new Builder(), plate = acc2 ? mix(night, acc2, 0.42) : mix(night, V12.silver, 0.2);
      pb.add(new T.SphereGeometry(0.2, 18, 6, 0, TAU, 0, PI * 0.42), plate, { s: [1, 0.55, 0.85] });
      pb.add(GC.cyl(0.194, 0.194, 0.014, 18), sh(plate, -0.3), { p: [0, 0.024, 0], s: [1, 1, 0.85] });
      pb.add(GC.tor(0.195, 0.016, 5, 24), trimC, { p: [0, 0.03, 0], r: [PI / 2, 0, 0], s: [1, 0.85, 1] });
      if (tier >= 3) pb.glow(GC.tor(0.15, 0.009, 4, 22), sg, { p: [0, 0.075, 0], r: [PI / 2, 0, 0], s: [1, 0.85, 1] });
      star4(pb, [0, 0.112, 0], [0, 1, 0], 0.065, glowS ? sg : trimC, glowS);
      pb.add(GC.cone(0.03, 0.17, 5), trimC, { p: [sx * 0.05, 0.03, -0.2], r: [-PI / 2 - 0.25, 0, 0] });
      pb.add(GC.cone(0.022, 0.12, 5), trimC, { p: [-sx * 0.07, 0.03, -0.17], r: [-PI / 2 - 0.35, 0, sx * 0.3] });
      for (var k = 0; k < 2; k++) star4(pb, [sx * (0.06 - k * 0.12), -0.07 - k * 0.04, 0.03], [0, 0, 1], 0.024, speck, glowS, k);
      fp.add(pb.build());
      fp.rotation.z = -sx * 0.46;
      X.float.push({ o: fp, p: [sx * 0.52, 0.26, -0.03], amp: 0.025, f: 1.3, ph: sx * 1.1 + X.seed * 4, rz: 0.06, r0: -sx * 0.46, lift: 0.04 });
      addHalo(X, fp, [0, -0.03, 0], sg, 0.22, tier);
    });
    sleeves(X, night, trimC, tier, { layered: true });
  }

  // ---------------- v1.2 boots ----------------
  // Artificer: buckled leather work boots with brass toe-caps and a little cog on the ankle.
  // Starwalker: sleek night-silver greaves with a crescent shin guard and swept ankle fins; from uncommon up
  // they shed faint star motes that drift behind you when you walk (one extra Points draw call).
  function feetV12(X, it, style, tier) {
    var art = style === 'artisan';
    var c = gearCols(it, art ? V12.leather : X.robeC, X.trim, X.gem), main = c.main, acc = accentOf(tier, c), L = X.legLen;
    var tights = sh(X.robeC, -0.55), sole = C('#2e221c');
    var brass = brassOf(tier, c), strap = tier >= 1 ? mix(sh(main, -0.32), acc, 0.25) : sh(main, -0.34);
    var nm = sh(nightOf(main), 0.14), trimC = starTrim(tier, c), sg = starGlow(c), glowS = tier >= 2;
    // T2: enamel straps (Artificer) / moon-silver crescent + inner fins (Starwalker); T3: gold filigree + gilding
    var acc2 = tier >= 3 ? v12Acc2(it, art ? 'artificer' : 'starbound', c) : null, gold = C(V12_GOLD);
    if (acc2 && art) strap = sh(acc2, -0.12);
    [X.footL, X.footR].forEach(function (foot, fi) {
      var sd = fi ? -1 : 1, b = new Builder(), i;
      var sgeo = new T.CylinderGeometry(0.06, 0.058, L - 0.05, 8, 1, false); sgeo.translate(0, 0.05 + (L - 0.05) / 2, 0);
      foot.add(vmesh(sgeo, painter(art ? main : sh(nm, -0.35), 0.0, 0.35, 0.15, null)));
      if (art) {
        b.add(GC.cyl(0.081, 0.086, 0.25, 12), main, { p: [0, 0.165, 0] });
        b.add(GC.cyl(0.108, 0.094, 0.075, 14), tier >= 1 ? acc : sh(main, 0.14), { p: [0, 0.312, 0] });
        b.add(GC.tor(0.104, 0.011, 4, 16), sh(main, -0.32), { p: [0, 0.274, 0], r: [PI / 2, 0, 0] });
        b.add(GC.sph(0.114, 12, 8), main, { p: [0, 0.075, 0.075], s: [0.98, 0.7, 1.55] });
        b.add(new T.SphereGeometry(0.1, 16, 7, 0, TAU, 0, PI * 0.5), brass, { p: [0, 0.068, 0.15], r: [PI / 2 + 0.18, 0, 0], s: [1.06, 0.98, 0.82] });
        b.add(GC.cyl(0.107, 0.107, 0.046, 14), sole, { p: [0, 0.023, 0.075], s: [1, 1, 1.62] });
        b.add(GC.box(0.13, 0.07, 0.085), sole, { p: [0, 0.035, -0.055] });
        [0.125, 0.215].forEach(function (y) {
          b.add(GC.tor(0.087, 0.017, 4, 16), strap, { p: [0, y, 0], r: [PI / 2, 0, 0] });
          b.add(GC.box(0.014, 0.044, 0.042), brass, { p: [sd * 0.092, y, 0.012] });
        });
        if (tier >= 1) for (i = 0; i < 5; i++) { var ra = PI * 0.15 + i * PI * 0.175; b.add(GC.sph(0.011, 6, 5), sh(brass, -0.2), { p: [Math.cos(ra) * 0.104, 0.068 + Math.sin(ra) * 0.075 - 0.02, 0.155] }); }
        cogParts(b, 0.034, 7, 0.014, brass, sh(brass, -0.25), null, { p: [sd * 0.088, 0.072, -0.01], r: [0, sd * PI / 2, 0], spokes: 2 });
        if (tier >= 2) gemPart(b, GC.oct(0.022), c.gem, tier, { p: [0, 0.318, 0.108], s: [1, 1.3, 0.5] });
        if (tier >= 3) b.glow(GC.tor(0.1, 0.006, 4, 22), c.gem, { p: [0, 0.066, 0.152], s: [1.06, 0.82, 1] });
        if (tier >= 4) {   // gold scroll band round the turned-down cuff
          filigree(b, function (u, v) { var a2 = u / 0.104, rr = lerp(0.094, 0.108, clamp((v - 0.275) / 0.075, 0, 1)) + 0.005; return [Math.sin(a2) * rr, v, Math.cos(a2) * rr]; },
            -PI * 0.104, 0.312, PI * 0.104, 0.312, { waves: 6, amp: 0.012, r: 0.0034, curl: 0.014, col: gold, key: 'bootCuff' });
          b.add(GC.tor(0.106, 0.006, 4, 20), gold, { p: [0, 0.35, 0], r: [PI / 2, 0, 0] });
        }
      } else {
        b.add(new T.CylinderGeometry(0.09, 0.082, 0.32, 14, 1, true, -1.35, 2.7), nm, { p: [0, 0.2, 0.004] });
        b.add(GC.cyl(0.072, 0.066, 0.3, 10), sh(nm, -0.32), { p: [0, 0.2, 0] });
        b.add(GC.tor(0.06, 0.02, 5, 16, PI * 1.25), acc2 || trimC, { p: [0, 0.205, 0.088], r: [-0.08, 0, PI * 0.875] });
        star4(b, [0, 0.2, 0.1], [0, 0.08, 1], 0.045, glowS ? sg : trimC, glowS);
        b.add(GC.sph(0.092, 12, 8), sh(nm, -0.06), { p: [0, 0.07, 0.0], s: [1, 0.78, 1.0] });
        b.add(GC.sph(0.082, 12, 8), nm, { p: [0, 0.064, 0.085], s: [1, 0.62, 1.05] });
        b.add(GC.sph(0.07, 12, 8), sh(nm, 0.1), { p: [0, 0.056, 0.16], s: [0.92, 0.55, 1.0] });
        b.add(GC.cone(0.05, 0.17, 6), sh(nm, 0.06), { p: [0, 0.05, 0.25], r: [PI / 2, 0, 0], s: [1, 1, 0.5] });
        b.add(GC.tor(0.072, 0.008, 4, 16, PI), trimC, { p: [0, 0.064, 0.12], r: [0, 0, 0], s: [1, 0.62, 1] });
        b.add(GC.cyl(0.094, 0.094, 0.028, 14), sole, { p: [0, 0.014, 0.07], s: [1, 1, 1.7] });
        [-1, 1].forEach(function (s2) {
          b.add(GC.cone(0.03, 0.16, 4), trimC, { p: [s2 * 0.088, 0.12, -0.035], r: [-1.05, 0, -s2 * 0.4] });
          b.add(GC.cone(0.02, 0.11, 4), acc2 || sh(trimC, -0.15), { p: [s2 * 0.084, 0.085, -0.03], r: [-1.25, 0, -s2 * 0.35] });
          if (tier >= 3) b.glow(GC.cone(0.01, 0.05, 4), sg, { p: [s2 * 0.15, 0.2, -0.13], r: [-1.05, 0, -s2 * 0.4] });
        });
        star4(b, [0.04, 0.29, 0.086], [0.3, 0, 1], 0.018, glowS ? sg : sh(nm, 0.5), glowS, 0.4);
        star4(b, [-0.035, 0.12, 0.09], [-0.3, 0, 1], 0.016, glowS ? sg : sh(nm, 0.5), glowS, 1.1);
        if (tier >= 3) b.glow(GC.box(0.012, 0.012, 0.2), sg, { p: [0, 0.103, 0.11], r: [0.28, 0, 0] });
        if (tier >= 4) [-1, 1].forEach(function (s2) {   // gold star-vines up both sides of the shin guard
          filigree(b, function (u, v) { var a2 = u / 0.09, rr = lerp(0.09, 0.082, clamp((0.36 - v) / 0.32, 0, 1)) + 0.005; return [Math.sin(a2) * rr, v, Math.cos(a2) * rr + 0.004]; },
            s2 * 0.068, 0.07, s2 * 0.062, 0.33, { waves: 3, amp: 0.011, r: 0.0034, curl: 0.014, col: gold, tip: 'star', tipC: sg, tipS: 0.012, key: 'greave' + s2 });
        });
      }
      foot.add(b.build());
    });
    if (!art && tier >= 1) X.starMotes = { n: [0, 10, 14, 18, 22][Math.min(4, tier)], colors: [V12.star, c.gem, '#bfe4ff'] };
  }

  // ---------------- v1.2 wands ----------------
  // Forged rod: leather grip, cog pommel, brass shaft with a piston and a pressure gauge, a claw cradle holding
  // a crystal, and two precessing gyroscope rings around it (they whirl while casting).
  // Starbound staff: a night-silver staff with a spiral inlay, a crescent cradle holding a mini orrery
  // (a sun, two orbits with planets, a moon) and a star on top.
  function wandV12(X, it, style, tier) {
    var forged = style === 'forged';
    var c = gearCols(it, forged ? V12.brass : '#2c2f5c', X.trim, X.staffGem), main = c.main, acc = accentOf(tier, c), gem = c.gem;
    var w = X.wand, b = new Builder(), i, a, gy, gz = 0, hs, aim;
    // T2: second accent on the grip wraps / staff rings and orbits; T3: gilded metal, gold filigree scrolls,
    // a third gyroscope ring (forged) or gold scroll wings under the cradle (starbound)
    var acc2 = tier >= 3 ? v12Acc2(it, forged ? 'artificer' : 'starbound', c) : null, gold = C(V12_GOLD);
    if (forged) {
      var metal = tier <= 0 ? mix(main, '#7c766a', 0.42) : tier >= 4 ? mix(main, V12_GOLD, 0.4) : main, lea = leatherOf(tier, c), dark = sh(metal, -0.35);
      cogParts(b, 0.05, 8, 0.03, metal, dark, null, { p: [0, -0.34, 0], r: [PI / 2, 0, 0] });
      b.add(GC.sph(0.034, 10, 8), metal, { p: [0, -0.37, 0] });
      b.add(GC.cyl(0.034, 0.036, 0.4, 10), lea, { p: [0, -0.11, 0] });
      for (i = 0; i < 6; i++) b.add(GC.tor(0.036, 0.007, 4, 12), acc2 && i % 2 ? acc2 : tier >= 1 ? acc : sh(lea, -0.25), { p: [0, -0.27 + i * 0.065, 0], r: [PI / 2 + 0.25, 0, 0] });
      if (tier >= 4) filigree(b, function (u, v) { var a2 = u / 0.026; return [Math.sin(a2) * 0.029, v, Math.cos(a2) * 0.029]; }, 0.052, 0.16, 0.109, 0.6,
        { waves: 3, amp: 0.012, r: 0.0032, curl: 0.016, col: gold, tip: 'bead', tipC: gem, tipS: 0.006, key: 'forgedShaft' });
      b.add(GC.cyl(0.05, 0.036, 0.05, 12), metal, { p: [0, 0.11, 0] });
      b.add(GC.cyl(0.022, 0.027, 0.5, 10), metal, { p: [0, 0.38, 0] });
      // piston + gauge
      b.add(GC.cyl(0.008, 0.008, 0.3, 6), sh(V12.steel, tier <= 0 ? -0.25 : 0), { p: [0.042, 0.36, 0] });
      b.add(GC.cyl(0.016, 0.016, 0.11, 8), metal, { p: [0.042, 0.28, 0] });
      b.add(GC.box(0.03, 0.014, 0.02), metal, { p: [0.03, 0.2, 0] }); b.add(GC.box(0.03, 0.014, 0.02), metal, { p: [0.03, 0.52, 0] });
      b.add(GC.cyl(0.03, 0.03, 0.014, 14), metal, { p: [0, 0.33, 0.03], r: [PI / 2, 0, 0] });
      b.add(GC.cyl(0.024, 0.024, 0.006, 14), '#f2ead8', { p: [0, 0.33, 0.038], r: [PI / 2, 0, 0] });
      b.add(GC.box(0.004, 0.02, 0.004), '#b0302a', { p: [0.005, 0.334, 0.042], r: [0, 0, -0.6] });
      b.add(GC.tor(0.032, 0.01, 4, 12), metal, { p: [0, 0.62, 0], r: [PI / 2, 0, 0] });
      // claw cradle + crystal
      for (i = 0; i < 4; i++) { a = i * TAU / 4 + PI / 4; var ca = Math.cos(a), sa = Math.sin(a);
        b.add(v12G('claw' + i, function () { return G.taper([[ca * 0.028, 0.62, sa * 0.028], [ca * 0.08, 0.7, sa * 0.08], [ca * 0.068, 0.82, sa * 0.068], [ca * 0.03, 0.88, sa * 0.03]], 0.014, 0.006, 10, 5); }), metal); }
      var cry = crystalGeo(0.048, 0.15, 0.08);
      gemPart(b, cry, gem, tier, { p: [0, 0.7, 0] });
      gemPart(b, GC.cone(0.048, 0.06, 6), gem, tier, { p: [0, 0.7, 0], r: [PI, 0, 0] });
      if (tier >= 1) b.add(GC.tor(0.04, 0.008, 4, 12), acc, { p: [0, 0.13, 0], r: [PI / 2, 0, 0] });
      // gyroscope rings (precessing), beads glow from epic up
      var rings = [[0.15, 0.9, 1.6], [0.13, -0.75, -1.15]];
      if (tier >= 4) rings.push([0.175, 0.25, -0.8]);
      rings.forEach(function (R, k) {
        var sp = pivot(w, 0, 0.79, 0), tilt = pivot(sp), rb = new Builder();
        if (k === 1) tilt.rotation.z = R[1]; else tilt.rotation.x = R[1];
        rb.add(GC.tor(R[0], 0.011, 5, 32), k === 2 ? gold : acc2 && k ? acc2 : k ? sh(metal, 0.12) : metal, { r: [PI / 2, 0, 0] });
        for (var q = 0; q < 3; q++) { var qa = q * TAU / 3 + k; gemPart(rb, GC.sph(0.014, 6, 5), tier >= 3 ? gem : metal, tier >= 3 ? 3 : 0, { p: [Math.cos(qa) * R[0], 0, Math.sin(qa) * R[0]] }); }
        tilt.add(rb.build());
        X.spin.push({ o: sp, ax: 'y', w: R[2], ph: k * 1.3, boost: 4 });
      });
      gy = 0.79; hs = 0.6; aim = 2.3;
    } else {
      var nm2 = sh(nightOf(main), 0.1), trimC = starTrim(tier, c), sgl = starGlow(c), glowS = tier >= 2;
      b.add(GC.cyl(0.026, 0.036, 1.8, 10), nm2, { p: [0, 0.4, 0] });
      [-0.42, 0.06, 0.92, 1.24].forEach(function (y, k) { b.add(GC.tor(0.036, 0.011, 5, 12), acc2 && k % 2 ? acc2 : trimC, { p: [0, y, 0], r: [PI / 2, 0, 0] }); });
      if (tier >= 4) [-1, 1].forEach(function (sx) {   // gold scroll wings cradling the orrery from below, a star at each tip
        filigree(b, function (u, v) { return [u, v, 0.0]; }, sx * 0.03, 1.04, sx * 0.11, 1.3, { waves: 1, amp: 0.02, r: 0.0055, curl: 0.05, turn: 4.4, col: gold, tip: 'star', tipC: sgl, tipS: 0.022, key: 'sbWing' + sx });
        filigree(b, function (u, v) { return [0.0, v, u]; }, sx * 0.03, 1.08, sx * 0.09, 1.28, { waves: 1, amp: 0.016, r: 0.0048, curl: 0.04, turn: 4.4, col: gold, key: 'sbWingZ' + sx });
      });
      var hel = []; for (i = 0; i <= 30; i++) { var hu = i / 30, ha = hu * TAU * 3; hel.push([Math.cos(ha) * 0.034, 0.08 + hu * 0.82, Math.sin(ha) * 0.034]); }
      if (tier >= 3) b.glow(v12Line('helix', hel, 0.0055), sgl); else if (tier >= 1) b.add(v12Line('helix', hel, 0.005), trimC);
      b.add(GC.sph(0.034, 10, 8), trimC, { p: [0, -0.5, 0] });
      b.add(GC.cone(0.02, 0.08, 6), trimC, { p: [0, -0.56, 0], r: [PI, 0, 0] });
      // crescent cradle (two crossed crescents)
      b.add(GC.tor(0.12, 0.017, 5, 20, PI * 1.25), trimC, { p: [0, 1.38, 0], r: [0, 0, PI * 0.875] });
      b.add(GC.tor(0.12, 0.014, 5, 20, PI * 1.25), sh(trimC, -0.1), { p: [0, 1.38, 0], r: [0, PI / 2, PI * 0.875] });
      gemPart(b, GC.sph(0.062, 14, 10), gem, tier, { p: [0, 1.38, 0] });
      star4(b, [0, 1.58, 0], [0, 0, 1], 0.06, glowS ? sgl : trimC, glowS);
      star4(b, [0, 1.58, 0], [1, 0, 0], 0.045, glowS ? sgl : trimC, glowS);
      // the orbits: rings sit on tilted pivots, the planets ride spinning pivots
      [[0.15, 0.35, 0, 1.1, 0.026, '#9fc4ff'], [0.22, 0, -0.45, -0.75, 0.034, '#ffb27a']].forEach(function (O, k) {
        var tp2 = pivot(w, 0, 1.38, 0); tp2.rotation.set(O[1], 0, O[2]);
        var ob = new Builder(); ob.add(GC.tor(O[0], 0.0055, 4, 40), acc2 || sh(trimC, -0.1), { r: [PI / 2, 0, 0] }); tp2.add(ob.build());
        var sp = pivot(tp2), pb = new Builder();
        gemPart(pb, GC.sph(O[4], 10, 8), mix(O[5], gem, 0.2), tier >= 3 ? 3 : 0, { p: [O[0], 0, 0] });
        if (k === 1) pb.add(GC.tor(O[4] * 1.7, 0.004, 3, 18), trimC, { p: [O[0], 0, 0], r: [PI / 2 + 0.4, 0, 0] });
        sp.add(pb.build());
        X.spin.push({ o: sp, ax: 'y', w: O[3], ph: k * 2.1, boost: 3 });
        if (k === 1) {
          var mp = pivot(sp, O[0], 0, 0), ms = pivot(mp), mb = new Builder();
          mb.add(GC.sph(0.012, 6, 5), '#e8e4f0', { p: [0.06, 0, 0] }); ms.add(mb.build());
          X.spin.push({ o: ms, ax: 'y', w: 2.4, ph: 0, boost: 2 });
        }
      });
      gy = 1.38; hs = 0.85; aim = 2.0;
    }
    w.add(b.build());
    X.wandGemHalo = null;
    if (tier >= 2) { var hsp = halo(gem, hs, 0.9); hsp.position.set(0, gy, gz); w.add(hsp); X.halos.push({ s: hsp, base: hs, wand: true }); }
    X.wandAim = aim; X.wandGemPos = [0, gy, gz];
  }

  // ---------------- v1.2 amulets ----------------
  // Gearwork: a clockwork medallion with two meshing cogs that turn. Starbound: a crescent moon cradling a
  // slowly turning star, with a tiny star dangling below.
  function amuletV12(X, it, style, tier) {
    var gw = style === 'gearwork';
    var c = gearCols(it, gw ? V12.brass : V12.silver, X.trim, X.gem), main = c.main, gem = c.gem;
    // T2: enamel back plate (gearwork) / moon-silver inlay (starbound); T3: gilded, with a gold filigree rim / scroll pair
    var acc2 = tier >= 3 ? v12Acc2(it, gw ? 'artificer' : 'starbound', c) : null, gold = C(V12_GOLD);
    var metal = tier <= 0 ? mix(main, '#7c766a', gw ? 0.42 : 0.3) : tier >= 4 ? mix(main, V12_GOLD, gw ? 0.4 : 0.3) : main, chainC = tier >= 4 ? gold : tier >= 1 ? (gw ? sh(metal, -0.14) : c.acc) : sh(metal, -0.15);
    var cT = -0.25, faceSurf = function (cy, z0) { return function (u, v) { return [u, cy + v * Math.cos(cT) - z0 * Math.sin(cT), 0.006 + v * Math.sin(cT) + z0 * Math.cos(cT)]; }; };
    var off = X.chestOff || 0.012, yP = 0.86, b = new Builder(), gp;
    [-1, 1].forEach(function (sx) {
      var pts = [];
      for (var i = 0; i <= 8; i++) { var u = i / 8, a = sx * lerp(1.15, 0.0, u), y = lerp(1.07, yP + 0.01, u * u * 0.6 + u * 0.4); var r = bodiceR(y) * (X.chestScale || 1) + off; pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); }
      b.add(v12G('chain' + sx + '_' + (X.chestScale || 1) + '_' + off, function () { return G.taper(pts, 0.01, 0.01, 12, 3); }), chainC);
    });
    X.body.add(b.build());
    var am = X.amulet = pivot(X.body, 0, yP, bodiceR(yP) * (X.chestScale || 1) + off + 0.01);
    b = new Builder();
    b.add(GC.tor(0.016, 0.006, 4, 8), chainC, { p: [0, -0.003, 0.005] });
    var face = pivot(am, 0, -0.09, 0.012); face.rotation.x = -0.25;
    if (gw) {
      b.add(GC.cyl(0.078, 0.078, 0.016, 26), acc2 ? sh(acc2, -0.25) : sh(metal, -0.32), { p: [0, -0.09, 0.0], r: [PI / 2 - 0.25, 0, 0] });
      if (tier >= 4) { var fs0 = faceSurf(-0.09, 0.012); filigree(b, function (u, v) { var a2 = u / 0.1, rr = 0.1 + v; return fs0(Math.cos(a2) * rr, Math.sin(a2) * rr); }, 0, 0, TAU * 0.1, 0, { waves: 8, amp: 0.006, r: 0.0028, curl: 0.009, col: gold, key: 'gwRim' }); }
      b.add(GC.tor(0.08, 0.012, 5, 26), metal, { p: [0, -0.09, 0.006], r: [-0.25, 0, 0] });
      for (var k = 0; k < 4; k++) { var ka = k * PI / 2 + PI / 4; b.add(GC.sph(0.009, 5, 4), sh(metal, 0.15), { p: [Math.cos(ka) * 0.08, -0.09 + Math.sin(ka) * 0.08, 0.02] }); }
      am.add(b.build());
      var s1 = pivot(face, 0.012, 0.012, 0.012), s2 = pivot(face, -0.04, -0.034, 0.018);
      var cb1 = new Builder(); cogParts(cb1, 0.046, 10, 0.012, metal, sh(metal, -0.2), tier >= 3 ? gem : null); s1.add(cb1.build());
      var cb2 = new Builder(); cogParts(cb2, 0.024, 7, 0.012, sh(metal, 0.12), null, null, { spokes: 2 }); s2.add(cb2.build());
      X.spin.push({ o: s1, ax: 'z', w: 0.7, ph: 0, boost: 2.5 }, { o: s2, ax: 'z', w: -0.7 * 0.046 / 0.024, ph: 0.3, boost: 2.5 });
      var gb = new Builder(); gemPart(gb, GC.sph(0.02, 10, 8), tier >= 1 ? gem : sh(metal, -0.3), tier, { p: [0.012, 0.012, 0.026], s: [1, 1, 0.6] }); face.add(gb.build());
      gp = [0.012, -0.075, 0.06];
    } else {
      b.add(GC.tor(0.062, 0.02, 6, 20, PI * 1.3), metal, { p: [0, -0.088, 0.01], r: [-0.25, 0, PI * 0.72], s: [1, 1, 0.65] });
      b.add(GC.tor(0.062, 0.006, 4, 20, PI * 1.3), acc2 || (tier >= 1 ? c.acc : sh(metal, 0.2)), { p: [0, -0.088, 0.024], r: [-0.25, 0, PI * 0.72] });
      if (tier >= 4) [-1, 1].forEach(function (sx) { filigree(b, faceSurf(-0.088, 0.016), sx * 0.025, -0.07, sx * 0.085, -0.02, { waves: 1, amp: 0.008, r: 0.0032, curl: 0.016, turn: 4.4, col: gold, tip: 'star', tipC: starGlow(c), tipS: 0.01, key: 'sbAm' + sx }); });
      if (tier >= 3) b.glow(GC.tor(0.082, 0.004, 4, 24, PI * 1.3), gem, { p: [0, -0.088, 0.02], r: [-0.25, 0, PI * 0.72] });
      b.add(GC.cyl(0.002, 0.002, 0.05, 4), chainC, { p: [0.03, -0.155, 0.016] });
      star4(b, [0.03, -0.185, 0.02], [0, 0.25, 1], 0.022, tier >= 2 ? starGlow(c) : metal, tier >= 2);
      am.add(b.build());
      var ss = pivot(face, 0.02, 0.008, 0.018), stb = new Builder();
      var st = v12G('star5', function () { return starShape5(0.042, 0.018, 0.014); });
      if (tier >= 2) stb.glow(st, gem); else stb.add(st, tier >= 1 ? sh(gem, 0.12) : sh(metal, 0.1));
      ss.add(stb.build());
      X.spin.push({ o: ss, ax: 'z', w: 0.5, ph: 0.2, boost: 2 });
      gp = [0.02, -0.08, 0.06];
    }
    addHalo(X, am, gp, gem, 0.3, tier);
  }

  // ---------------- aura selection ----------------
  function auraColors(kind, gem) {
    var g = C(gem);
    switch (kind) {
      case 'embers': return [g, C('#ffb347'), C('#ff5a1f'), C('#ffd23a')];
      case 'frost': return [C('#e8fbff'), g, C('#9fe6ff')];
      case 'shadow': return [C('#24123a'), C('#3f2470'), sh(g, -0.35)];
      case 'leaves': return [C('#7ccf5a'), C('#4fa83a'), C('#c8e86a'), mix(g, '#7ccf5a', 0.5)];
      case 'radiant': return [C('#fff3b0'), g, C('#ffd76a')];
      case 'sparkle': return [C('#ffffff'), g, sh(g, 0.5)];
      default: return [g, sh(g, 0.4)];
    }
  }
  function auraAnchor(mode, rad, y0, y1) {
    return function (i, r) {
      var a = r() * TAU, rr;
      if (mode === 0) { rr = rad * (0.45 + 0.55 * r()); return [Math.sin(a) * rr, r() * 0.9, Math.cos(a) * rr]; }
      if (mode === 1) { rr = rad * (0.6 + 0.5 * r()); return [Math.sin(a) * rr, (y0 || 0.15) + r() * ((y1 || 2.1) - (y0 || 0.15)), Math.cos(a) * rr]; }
      if (mode === 4) { rr = rad * (0.3 + 0.7 * r()); return [Math.sin(a) * rr, r() * 0.25, Math.cos(a) * rr]; }
      return [0, r() * 0.3, 0];
    };
  }

  // ---------------- the wizard ----------------
  var WIZ_SEED = 0;
  function wizardModel(look) {
    look = look || {};
    var gear = look.gear || {};
    function slotOf(n) { var g = gear[n]; return g && typeof g === 'object' ? g : null; }
    var X = { look: look, halos: [], gemFor: {}, legLen: 0.46, footZ: 0.03, seed: hash01(++WIZ_SEED * 1.618), spin: [], float: [] };   // v1.2 WS6: spin/float = clockwork + floating gear parts
    X.build = resolveBuild(look.build);   // v2.1 WS-D: round-2 proportions + face/hair presets (null = the v1.x wizard, unchanged)
    X.hipY = 0.55; X.lowK = 1;
    X.robeC = C(look.robe || '#2a6f9a');
    X.hatC = C(look.hat || sh(X.robeC, -0.35));
    X.trim = C(look.trim || '#ffd76a');
    X.glowEyes = look.glowEyes ? C(look.glowEyes) : null;
    X.skin = C((X.build && X.build.skin) || look.skin || '#f3c9a0');
    X.hair = X.build && X.build.hairColor ? C(X.build.hairColor) : look.hair ? C(look.hair) : null;
    X.staffGem = C(look.staffGem || X.trim);
    X.gem = X.staffGem;
    X.wood = C(look.staffWood || '#7a5232');

    var gH = slotOf('hat'), gR = slotOf('robe'), gB = slotOf('boots'), gW = slotOf('wand'), gA = slotOf('amulet');
    var hatStyle = gH ? (HAT_STYLES[gH.style] ? gH.style : 'pointed') : (look.hood ? 'hood' : 'pointed');
    var robeStyle = gR ? (ROBE_STYLES[gR.style] ? gR.style : 'bell') : (look.armor ? 'armored' : 'bell');
    var bootStyle = gB ? (BOOT_STYLES[gB.style] ? gB.style : 'slippers') : 'slippers';
    var wandStyle = gW ? (WAND_STYLES[gW.style] ? gW.style : 'staff') : 'staff';
    var amuletStyle = gA ? (AMULET_STYLES[gA.style] ? gA.style : 'pendant') : null;
    var tH = tierOf(gH), tR = tierOf(gR), tB = tierOf(gB), tW = tierOf(gW), tA = tierOf(gA);
    // v1.2 WS6: Artificer / Starbound pieces climb the set-tier ladder (look.tier), see v12Tier
    tH = v12Tier(gH, hatStyle, tH); tR = v12Tier(gR, robeStyle, tR); tB = v12Tier(gB, bootStyle, tB); tW = v12Tier(gW, wandStyle, tW); tA = v12Tier(gA, amuletStyle, tA);
    if (hatStyle === 'cowl' && tH >= 2) X.cowlGlow = C(gH.gem || X.gem);

    var root = new T.Group(); root.name = 'wizard';
    var scaler = X.scaler = pivot(root); scaler.scale.setScalar(look.scale || 1);
    var body = X.body = pivot(scaler);
    X.skirt = pivot(body, 0, WAIST, 0);
    var upper = X.upper = pivot(body, 0, 0.95, 0);
    var head = X.head = pivot(upper, 0, 0.33, 0);
    X.hat = pivot(head, 0, 0.17, -0.02);
    X.armL = pivot(upper, 0.27, 0.06, 0); X.armL.rotation.z = 0.24;
    X.armR = pivot(upper, -0.27, 0.06, 0); X.armR.rotation.z = -0.24;
    X.elbowL = pivot(X.armL, 0, -0.26, 0); X.elbowL.rotation.x = -0.2;
    X.elbowR = pivot(X.armR, 0, -0.26, 0); X.elbowR.rotation.x = -0.2;
    X.handL = pivot(X.elbowL, 0, -0.31, 0);
    X.handR = pivot(X.elbowR, 0, -0.31, 0);
    X.wand = pivot(X.handR, 0, 0, 0.02); X.wand.rotation.set(0.2, 0, 0.24);

    if (robeStyle === 'armored') { X.chestScale = 1.07; X.chestOff = 0.03; }
    buildRobe(X, gR, robeStyle, tR);
    if (X.build) buildHeadV21(X, hatStyle); else buildHead(X, hatStyle);
    buildHat(X, gH, hatStyle, tH);
    X.footL = pivot(body, 0.14, 0, X.footZ);
    X.footR = pivot(body, -0.14, 0, X.footZ);
    buildFeet(X, gB, bootStyle, tB);
    buildWand(X, gW, wandStyle, tW);
    if (amuletStyle) buildAmulet(X, gA, amuletStyle, tA);
    var wandTip = pivot(X.wand, X.wandGemPos[0], X.wandGemPos[1], X.wandGemPos[2]);
    // ---- v1.2 WS6: Starwalker greaves shed faint star motes (one extra Points draw call)
    if (X.starMotes) {
      var SM = X.starMotes;
      X.motes = auraPoints('stardust', SM.n, SM.colors, function (i, r) { var f = i % 2 ? X.footL : X.footR; return [f.position.x + (r() - 0.5) * 0.16, 0.04 + r() * 0.12, X.footZ + 0.04 + (r() - 0.5) * 0.2]; }, 515 + SM.n);
      scaler.add(X.motes);
    }

    if (X.build) applyBuild(X);           // v2.1 WS-D: re-proportion before the rig records its rest pose

    // ---- aura: legendary flavour, else epic sparkle motes (one Points) ----
    var items = [gW, gR, gH, gA, gB], leg = null, epic = null, legendary = false;
    // v1.2 WS6: set pieces don't use the rarity aura; T3 pieces bring their set's aura (most T3 pieces wins, robe first)
    var styles = [wandStyle, robeStyle, hatStyle, amuletStyle, bootStyle], tiers = [tW, tR, tH, tA, tB], setN = {}, setBest = null, setGem = null;
    [1, 0, 2, 3, 4].forEach(function (i) {
      var it = items[i], set = it && V12_SET[styles[i]];
      if (set && (it.tier != null || RAR_TIER[it.rarity] >= 3)) { if (tiers[i] >= 4) { setN[set] = (setN[set] || 0) + 1; if (!setBest || setN[set] > setN[setBest]) { setBest = set; setGem = it.gem; } } return; }
      var tt = tierOf(it); if (tt >= 4 && !leg) leg = it; if (tt === 3 && !epic) epic = it;
    });
    var aura = null;
    if (setBest) {
      var sk = V12_AURA[setBest], SA = AURA[sk], sg0 = C(setGem || X.gem);
      var scol = setBest === 'artificer' ? [C(V12.brass), C(V12_GOLD), sg0, C('#e8c27a')] : [C(V12.star), sg0, C('#bfe4ff'), C(V12_GOLD)];
      aura = auraPoints(sk, SA.n, scol, auraAnchor(SA.mode, SA.rad, 0.3, 1.9), 771 + SA.n);
      scaler.add(aura); legendary = true; X.auraKind = sk;
    } else if (leg || epic) {
      var kind = leg ? fxOf(leg, X.gem) : 'sparkle', A = AURA[kind], g0 = (leg || epic).gem || X.gem;
      var n = leg ? A.n : 12;
      aura = auraPoints(kind, n, leg ? auraColors(kind, g0) : [C(g0), C('#ffffff')], auraAnchor(A.mode, A.rad, 0.3, 1.9), 991 + n);
      scaler.add(aura);
      legendary = !!leg;
      X.auraKind = leg ? kind : 'epic-sparkle';
    }

    // ---------------- animation ----------------
    var B = body, SK = X.skirt, U = upper, H = head, HT = X.hat, AL = X.armL, AR = X.armR, EL = X.elbowL, ER = X.elbowR,
      HL = X.handL, HR = X.handR, WD = X.wand, FL = X.footL, FR = X.footR, EY = X.eyes, MO = X.mouth;
    var poser = new Poser([B, SK, U, H, HT, AL, AR, EL, ER, HL, HR, WD, FL, FR, EY, MO]);
    var sTipX = new Spring(70, 7), sTipZ = new Spring(70, 7), sSkX = new Spring(80, 9), sSkZ = new Spring(80, 9);
    var sCapeX = new Spring(45, 5.5), sCapeZ = new Spring(45, 5.5), sAm = new Spring(90, 6), sPl = new Spring(55, 5), sPlZ = new Spring(55, 5);
    var trTip = new VelTrack(X.hatTip || X.plume || HT, root), trSk = new VelTrack(SK, root), trCape = X.cape ? new VelTrack(X.cape, root) : null;
    var aim = X.wandAim || 2.0;

    function idle(t, w) {
      var br = Math.sin(t * 2.2);
      B.position.y += br * 0.012 * w;
      SK.scale.x += br * 0.01 * w; SK.scale.z += br * 0.01 * w;
      U.rotation.z += Math.sin(t * 1.3) * 0.025 * w; U.rotation.x += br * 0.015 * w;
      H.rotation.y += Math.sin(t * 0.7) * 0.12 * w; H.rotation.x += Math.sin(t * 0.9) * 0.03 * w;
      AL.rotation.x += Math.sin(t * 1.9) * 0.05 * w; AR.rotation.x += (-0.1 + Math.sin(t * 1.9 + 1) * 0.04) * w;
      HT.rotation.z += Math.sin(t * 1.5) * 0.035 * w;
      // fidgets (look around / adjust hat / spin staff / stretch) driven by t
      var L = 10, u = (t + X.seed * 13) / L, si = Math.floor(u), f = (u - si) * L, kind = Math.floor(hash01(si + X.seed * 97) * 5);
      var env = smooth(1.0, 1.5, f) * (1 - smooth(3.0, 3.5, f)) * w;
      if (env <= 0.0001) return;
      if (kind === 1) { var s = Math.sin((f - 1.0) * 2.0); H.rotation.y += env * 0.7 * s; U.rotation.y += env * 0.2 * s; }
      else if (kind === 2) {
        AL.rotation.x += -2.45 * env; AL.rotation.z += 0.3 * env; EL.rotation.x += -1.15 * env; H.rotation.z += 0.12 * env; H.rotation.x += 0.06 * env;
        HT.rotation.z += env * 0.07 * Math.sin(f * 10); HT.rotation.x += -0.05 * env;
      } else if (kind === 3) {
        var sp = smooth(1.4, 3.1, f);
        WD.rotation.y += sp * TAU * 2 * w; AR.rotation.x += -0.4 * env; ER.rotation.x += -0.5 * env; WD.rotation.x += 0.5 * env;
        H.rotation.y += -0.25 * env; H.rotation.x += 0.1 * env;
      } else if (kind === 4) {
        AL.rotation.x += -2.7 * env; AR.rotation.x += -2.6 * env; AL.rotation.z += 0.25 * env; AR.rotation.z -= 0.25 * env;
        EL.rotation.x += 0.15 * env; ER.rotation.x += 0.15 * env; WD.rotation.x += 2.4 * env;
        B.position.y += 0.04 * env; U.rotation.x += -0.12 * env; H.rotation.x += -0.22 * env; MO.scale.y += 0.8 * env; EY.scale.y -= 0.6 * env;
      }
    }
    function walk(t, w) {
      var s = t * 9.5, sw = Math.sin(s), cs = Math.cos(s);
      B.position.y += Math.abs(sw) * 0.055 * w; B.rotation.z += sw * 0.035 * w;
      U.rotation.x += 0.07 * w; U.rotation.y += -sw * 0.1 * w; SK.rotation.y += sw * 0.08 * w;
      AL.rotation.x += -sw * 0.5 * w; AR.rotation.x += sw * 0.32 * w; EL.rotation.x += -0.15 * w; ER.rotation.x += -0.15 * w;
      WD.rotation.x += (0.15 - sw * 0.15) * w;
      FL.position.z += sw * 0.2 * w; FL.position.y += Math.max(0, cs) * 0.08 * w; FL.rotation.x += -0.35 * Math.max(0, cs) * w;
      FR.position.z += -sw * 0.2 * w; FR.position.y += Math.max(0, -cs) * 0.08 * w; FR.rotation.x += -0.35 * Math.max(0, -cs) * w;
      HT.rotation.x += -0.05 * w; H.rotation.x += -0.04 * w;
    }
    function run(t, w) {
      var s = t * 12.5, sw = Math.sin(s), cs = Math.cos(s), bo = Math.abs(sw);
      B.position.y += (0.025 + bo * 0.15) * w;
      B.scale.y += (bo - 0.5) * 0.09 * w; B.scale.x -= (bo - 0.5) * 0.045 * w; B.scale.z -= (bo - 0.5) * 0.045 * w;
      B.rotation.x += 0.17 * w; B.rotation.z += sw * 0.05 * w;
      U.rotation.x += 0.08 * w; U.rotation.y += -sw * 0.18 * w;
      SK.rotation.y += sw * 0.12 * w;
      AL.rotation.x += -sw * 1.0 * w; AR.rotation.x += sw * 0.8 * w; AL.rotation.z += 0.12 * w; AR.rotation.z -= 0.12 * w;
      EL.rotation.x += -0.95 * w; ER.rotation.x += -0.85 * w;
      WD.rotation.x += (0.85 - sw * 0.5) * w;
      H.rotation.x += -0.14 * w; HT.rotation.x += -0.08 * w;
      FL.position.z += sw * 0.3 * w; FL.position.y += (Math.max(0, cs) * 0.17 + Math.max(0, -cs) * bo * 0.06) * w; FL.rotation.x += -cs * 0.45 * w;
      FR.position.z += -sw * 0.3 * w; FR.position.y += (Math.max(0, -cs) * 0.17 + Math.max(0, cs) * bo * 0.06) * w; FR.rotation.x += cs * 0.45 * w;
    }
    function cast(t, k) {
      var a = segK(k, 0, 0.13), b = segK(k, 0.1, 0.46), c = segK(k, 0.44, 0.58), d = segK(k, 0.58, 0.9);
      var eb = bell(b), ec = easeO(c);
      var ax = 0.45 * easeO(a); ax = lerp(ax, -2.75, easeIO(b)); ax = lerp(ax, -1.42, ec); ax = lerp(ax, -1.2, easeIO(d));
      var az = lerp(0, -0.35, easeIO(b)); az = lerp(az, 0.08, ec);
      var ex = lerp(0, -0.8, easeO(a)); ex = lerp(ex, -0.45, easeIO(b)); ex = lerp(ex, 0.18, ec); ex = lerp(ex, 0.05, d);
      AR.rotation.x += ax; AR.rotation.z += az; ER.rotation.x += ex;
      var tw = b * TAU * 2.2;
      WD.rotation.z += Math.sin(tw) * 0.75 * eb; WD.rotation.x += (1 - Math.cos(tw)) * 0.35 * eb + 0.6 * easeIO(b) * (1 - ec);
      WD.rotation.x += aim * ec * (1 - 0.22 * easeIO(d));
      AL.rotation.x += lerp(-0.7 * easeIO(b), 0.45, ec); AL.rotation.z += lerp(0.85 * easeIO(b), 0.55, ec); EL.rotation.x += -0.4 * eb;
      B.position.y += -0.045 * a * (1 - b) + 0.08 * eb; B.scale.y += -0.04 * a * (1 - b) + 0.03 * eb;
      U.rotation.x += -0.16 * easeIO(b) * (1 - c) + 0.26 * ec - 0.1 * easeIO(d);
      U.rotation.y += -0.22 * ec;
      B.position.z += 0.06 * ec;
      FR.position.z += 0.15 * ec; FL.position.z -= 0.06 * ec;
      H.rotation.x += -0.22 * easeIO(b) * (1 - c) + 0.06 * c; H.rotation.y += 0.18 * ec;
      SK.scale.x += 0.08 * eb + 0.05 * c; SK.scale.z += 0.08 * eb + 0.05 * c;
      HT.rotation.x += -0.1 * b * (1 - c);
      if (k > 0.9) { var hb = Math.sin((k - 0.9) * 5); B.position.y += hb * 0.008; AR.rotation.x += hb * 0.03; }
    }
    // v2.1 A3 (Jorge): a 1.5 s wand wind-up before every cast. The wand arm rises, the wand
    // circles faster and faster and the arm starts to tremble as the spell charges.
    // v2.1 (D5 "cast per school"): each school winds up its own way (look.school from WF.state.appearance)
    //   stoneward: plants the feet, crouches and lifts the wand slowly like a weight (low, heavy)
    //   tidecaller: wide flowing circles with both arms, swaying (smooth)
    //   emberstrike: sharp snapping flicks that speed up, sparks of impatience (jerky)
    var WSCHOOL = X.look.school || '';
    function windup(t, k) {
      var a = easeO(segK(k, 0, 0.35)), ch = Math.min(1, k / 1.5);
      if (WSCHOOL === 'stoneward') {
        var lift = easeIO(segK(k, 0.2, 1.4)), qk = Math.sin(t * 30) * 0.02 * ch;
        AR.rotation.x += -1.1 * a - 1.0 * lift + qk; AR.rotation.z += -0.18 * a; ER.rotation.x += -0.7 * a + 0.3 * lift;
        WD.rotation.x += 0.9 * a - 0.4 * lift;
        AL.rotation.x += -0.9 * a - 0.6 * lift; AL.rotation.z += 0.35 * a; EL.rotation.x += -0.8 * a;
        B.position.y += -0.09 * a + 0.03 * lift; U.rotation.x += 0.1 * a - 0.18 * lift; H.rotation.x += 0.06 * a - 0.1 * lift;
        FL.position.x += 0.08 * a; FR.position.x -= 0.08 * a; FL.position.z += 0.04 * a; FR.position.z -= 0.04 * a;
        SK.scale.x += 0.06 * a; SK.scale.z += 0.06 * a;
        return;
      }
      if (WSCHOOL === 'tidecaller') {
        var fl = k * TAU * (0.55 + 0.35 * ch), sw = Math.sin(fl);
        AR.rotation.x += -1.7 * a + Math.sin(fl) * 0.45 * a; AR.rotation.z += -0.5 * a + Math.cos(fl) * 0.35 * a; ER.rotation.x += -0.35 * a;
        WD.rotation.z += Math.sin(fl * 1.5) * 0.4 * a; WD.rotation.x += 0.5 * a;
        AL.rotation.x += -1.2 * a + Math.cos(fl) * 0.4 * a; AL.rotation.z += 0.9 * a - Math.sin(fl) * 0.3 * a; EL.rotation.x += -0.4 * a;
        U.rotation.y += sw * 0.14 * a; U.rotation.z += sw * 0.05 * a; B.position.y += 0.025 * ch + Math.cos(fl) * 0.015 * a;
        H.rotation.x += -0.1 * a; H.rotation.z += -sw * 0.06 * a;
        SK.rotation.y += sw * 0.08 * a;
        return;
      }
      if (WSCHOOL === 'emberstrike') {
        var rate = 3 + 6 * ch, ph = (k * rate) % 1, snap = ph < 0.25 ? easeO(ph / 0.25) : 1 - easeIO((ph - 0.25) / 0.75);
        AR.rotation.x += -1.9 * a - 0.5 * snap * a; AR.rotation.z += -0.3 * a; ER.rotation.x += -0.6 * a + 0.35 * snap * a;
        WD.rotation.x += 0.35 * a + 0.7 * snap * a; WD.rotation.z += 0.25 * snap * a;
        AL.rotation.x += -0.35 * a; AL.rotation.z += 0.55 * a; EL.rotation.x += -1.0 * a;
        B.position.y += -0.02 * a + 0.03 * snap * a; U.rotation.x += -0.08 * a - 0.06 * snap * a; U.rotation.y += -0.18 * a;
        H.rotation.x += -0.1 * a; H.rotation.y += 0.08 * a;
        FL.position.z += 0.1 * a; FR.position.z -= 0.1 * a;
        return;
      }
      var tw = k * TAU * (0.8 + 1.2 * ch), sh = Math.sin(t * 38) * 0.03 * ch;
      AR.rotation.x += -2.15 * a + sh; AR.rotation.z += -0.28 * a; ER.rotation.x += -0.45 * a;
      WD.rotation.z += Math.sin(tw) * 0.55 * a; WD.rotation.x += 0.45 * a + (1 - Math.cos(tw)) * 0.28 * a;
      AL.rotation.x += -0.55 * a; AL.rotation.z += 0.75 * a; EL.rotation.x += -0.55 * a;
      B.position.y += -0.035 * a + 0.02 * ch; U.rotation.x += -0.12 * a; U.rotation.y += -0.1 * a; H.rotation.x += -0.12 * a;
      FL.position.z += 0.06 * a; FR.position.z -= 0.08 * a;
      SK.scale.x += 0.04 * a * ch; SK.scale.z += 0.04 * a * ch;
    }
    function castBig(t, k) {
      var a = segK(k, 0, 0.45), hold = segK(k, 0.45, 0.95), c = segK(k, 0.95, 1.1), d = segK(k, 1.1, 1.4);
      var ea = easeIO(a), ec = easeO(c), up = ea * (1 - ec);
      AR.rotation.x += lerp(-2.85 * ea, -1.45, ec) + 0.15 * easeIO(d);
      AL.rotation.x += lerp(-2.85 * ea, -1.4, ec) + 0.15 * easeIO(d);
      AR.rotation.z += lerp(-0.5 * ea, 0.15, ec); AL.rotation.z += lerp(0.5 * ea, -0.1, ec);
      EL.rotation.x += 0.2 * ea; ER.rotation.x += 0.2 * ea;
      WD.rotation.x += lerp(3.0 * ea, aim, ec);
      var tr = Math.sin(k * 31) * 0.035 * hold * (1 - ec);
      AR.rotation.z += tr; AL.rotation.z -= tr;
      B.position.y += 0.2 * up + Math.sin(k * 5) * 0.03 * hold * (1 - ec) - 0.04 * bell(c);
      SK.scale.x += 0.16 * up + 0.04 * ec; SK.scale.z += 0.16 * up + 0.04 * ec; SK.scale.y -= 0.05 * up;
      U.rotation.x += -0.22 * up + 0.3 * ec - 0.12 * easeIO(d);
      H.rotation.x += -0.35 * up + 0.08 * ec;
      FL.rotation.x += 0.45 * up; FR.rotation.x += 0.45 * up; FR.position.z += 0.12 * ec;
      HT.rotation.x += -0.12 * up;
    }
    function hit(t, k) {
      var e = k < 0.45 ? Math.sin(Math.min(k * 7, PI)) : 0;
      idle(t, 1);
      B.rotation.x += -0.35 * e; B.position.z += -0.17 * e; B.scale.y += -0.08 * e;
      U.rotation.x += -0.2 * e; H.rotation.x += -0.3 * e; H.rotation.z += 0.14 * e;
      AL.rotation.z += 0.95 * e; AR.rotation.z -= 0.95 * e; AL.rotation.x += -0.55 * e; AR.rotation.x += -0.5 * e;
      EL.rotation.x += -0.5 * e; ER.rotation.x += -0.5 * e;
      FR.position.z += -0.12 * e; FL.position.z += 0.04 * e; FL.position.y += 0.05 * e;
      EY.scale.y -= 0.75 * e; MO.scale.y += 0.7 * e; HT.rotation.x += -0.22 * e;
    }
    function victory(t, k) {
      var Cy = 2.6, u = k % Cy;
      var wJ = Math.max(1 - smooth(0.62, 0.8, u), smooth(2.42, 2.6, u)), wS = smooth(0.62, 0.8, u) * (1 - smooth(1.42, 1.6, u)), wC = smooth(1.42, 1.6, u) * (1 - smooth(2.42, 2.6, u));
      var cr = bell(segK(u, 0.0, 0.18)), air = bell(segK(u, 0.15, 0.6)), land = bell(segK(u, 0.56, 0.74));
      if (u > 2.42) { cr = bell(segK(u, 2.42, 2.6) * 0.5); air = 0; land = 0; }
      B.position.y += (-0.08 * cr + 0.42 * air - 0.05 * land) * wJ;
      B.scale.y += (-0.08 * cr + 0.06 * air - 0.07 * land) * wJ;
      AR.rotation.x += -2.95 * wJ; ER.rotation.x += 0.2 * wJ; WD.rotation.x += 3.0 * wJ;
      AL.rotation.x += (-2.4 * air - 0.6) * wJ; AL.rotation.z += 0.3 * wJ; EL.rotation.x += -1.2 * wJ;
      FL.rotation.x += 0.4 * air * wJ; FR.rotation.x += 0.4 * air * wJ; FL.position.z -= 0.08 * air * wJ; FR.position.z += 0.08 * air * wJ;
      H.rotation.x += -0.2 * wJ; MO.scale.y += 0.9 * wJ;
      var sp = easeIO(segK(u, 0.7, 1.5));
      var ry = sp < 1 ? TAU * sp : 0; B.rotation.y += ry > PI ? ry - TAU : ry;   // shortest-path for cross-fades
      AL.rotation.z += 1.1 * wS; AR.rotation.z -= 1.1 * wS; AR.rotation.x += -0.3 * wS; WD.rotation.x += 1.2 * wS;
      SK.scale.x += 0.14 * wS; SK.scale.z += 0.14 * wS; B.position.y += 0.06 * bell(sp) * wS; H.rotation.z += 0.12 * wS; MO.scale.y += 0.6 * wS;
      AR.rotation.x += -2.8 * wC; AR.rotation.z += Math.sin(u * 7) * 0.28 * wC; WD.rotation.x += 3.0 * wC; WD.rotation.z += Math.sin(u * 7 + 0.5) * 0.3 * wC;
      AL.rotation.x += (-2.3 + Math.sin(u * 14) * 0.35) * wC; EL.rotation.x += -1.3 * wC; AL.rotation.z += 0.25 * wC;
      B.position.y += Math.abs(Math.sin(u * 7)) * 0.05 * wC; H.rotation.x += -0.15 * wC; MO.scale.y += 0.8 * wC; U.rotation.z += Math.sin(u * 7) * 0.05 * wC;
    }
    function defeat(t, k) {
      var st = bell(segK(k, 0, 0.45)), eb = easeIO(segK(k, 0.25, 0.75)), ec = easeIO(segK(k, 0.7, 1.2)), d = segK(k, 1.15, 1.45);
      B.rotation.x += -0.25 * st; H.rotation.x += -0.3 * st; AL.rotation.z += 0.6 * st; AR.rotation.z -= 0.6 * st; FR.position.z += -0.1 * st;
      B.position.y += (-0.24 * eb - 0.05 * ec - 0.03 * bell(d)) * X.lowK;
      SK.scale.y -= 0.4 * eb; SK.scale.x += 0.13 * eb; SK.scale.z += 0.15 * eb;
      FL.position.z -= 0.14 * eb; FR.position.z -= 0.14 * eb; FL.rotation.x += 0.6 * eb; FR.rotation.x += 0.6 * eb;
      FL.position.x += 0.06 * eb; FR.position.x -= 0.06 * eb;
      U.rotation.x += 0.15 * eb + 0.5 * ec; H.rotation.x += 0.35 * ec; H.rotation.z += 0.1 * ec;
      AL.rotation.x += -0.8 * ec; AR.rotation.x += -0.7 * ec; AL.rotation.z += -0.05 * ec; AR.rotation.z += 0.05 * ec;
      EL.rotation.x += 0.2 * ec; ER.rotation.x += 0.2 * ec;
      WD.rotation.x += 1.2 * ec; WD.rotation.z += 0.6 * ec;
      EY.scale.y -= 0.85 * ec; HT.rotation.x += 0.35 * ec; HT.rotation.z += 0.12 * ec;
      if (k > 1.2) { var br = Math.sin(k * 2.0); U.rotation.x += br * 0.03; B.position.y += br * 0.004; }
    }
    function ride(t, k) {
      B.position.y += -X.hipY;   // v2.1: hips to the saddle (0.55 on the v1.x wizard)
      SK.scale.x += 0.2; SK.scale.y -= 0.42; SK.scale.z -= 0.16;
      FL.position.x += 0.34; FR.position.x -= 0.34; FL.position.y += 0.15; FR.position.y += 0.15; FL.position.z += 0.06; FR.position.z += 0.06;
      FL.rotation.z += 0.22; FR.rotation.z -= 0.22; FL.rotation.x += 0.15; FR.rotation.x += 0.15;
      AL.rotation.x += -0.7; AR.rotation.x += -0.55; EL.rotation.x += -0.7; ER.rotation.x += -0.9; AL.rotation.z += -0.12; AR.rotation.z += 0.12;
      WD.rotation.x += 0.9;
      U.rotation.x += 0.06;
      B.position.y += Math.sin(t * 3.4) * 0.008; H.rotation.y += Math.sin(t * 0.45) * 0.18; H.rotation.x += -0.04;
    }
    function talk(t, k) {
      var g = Math.sin(t * 2.1), g2 = Math.sin(t * 2.1 + 0.7);
      AL.rotation.x += -0.85 + g * 0.3; EL.rotation.x += -1.0 + g2 * 0.3; AL.rotation.z += 0.2 + Math.sin(t * 1.3) * 0.12;
      HL.rotation.z += g * 0.4; HL.rotation.y += 0.6;
      var cyc = (t % 6.4) / 6.4, w2 = bell(segK(cyc, 0.5, 0.85));
      AR.rotation.x += -0.45 * w2; ER.rotation.x += -0.6 * w2; AR.rotation.z += -0.2 * w2; WD.rotation.x += 0.5 * w2;
      H.rotation.x += Math.sin(t * 4.2) * 0.06; H.rotation.z += Math.sin(t * 1.1) * 0.07; H.rotation.y += Math.sin(t * 0.6) * 0.15;
      U.rotation.y += Math.sin(t * 1.05) * 0.1; U.rotation.x += 0.03;
      B.rotation.z += Math.sin(t * 1.05) * 0.02; B.position.y += Math.sin(t * 2.2) * 0.01;
      MO.scale.y += 1.2 * Math.max(0, Math.sin(t * 11) * Math.sin(t * 3.3 + 1));
    }
    function duelIdle(t, k) {
      var bo = Math.sin(t * 3.2);
      B.position.y += -0.03 + bo * 0.018; B.scale.y -= bo * 0.012;
      FL.position.x += 0.06; FL.position.z += 0.09; FL.rotation.y += 0.25; FR.position.x -= 0.04; FR.position.z -= 0.09; FR.rotation.y -= 0.3;
      U.rotation.x += 0.07; U.rotation.y += -0.15 + Math.sin(t * 1.6) * 0.03;
      AR.rotation.x += -0.9 + bo * 0.04; AR.rotation.z += -0.12; ER.rotation.x += -1.0;
      WD.rotation.x += 1.75;
      AL.rotation.x += -0.5; AL.rotation.z += 0.35; EL.rotation.x += -0.75; HL.rotation.y += -0.5;
      H.rotation.y += 0.13; H.rotation.x += 0.03;
      SK.rotation.y += Math.sin(t * 1.6) * 0.04; SK.scale.x += 0.02;
      HT.rotation.z += Math.sin(t * 1.6) * 0.03;
    }
    function taunt(t, k) {
      var a = easeO(segK(k, 0, 0.35)), sk = k < 1.3 ? Math.sin(k * 22) * 0.05 * a : 0;
      AL.rotation.x += -2.3 * a; AR.rotation.x += -2.3 * a; AL.rotation.z += 0.6 * a + sk; AR.rotation.z -= 0.6 * a + sk;
      EL.rotation.x += -0.3 * a; ER.rotation.x += -0.3 * a; WD.rotation.x += 2.5 * a;
      B.position.y += 0.06 * a; U.rotation.x += -0.15 * a; H.rotation.x += -0.2 * a;
      SK.scale.x += 0.08 * a; SK.scale.z += 0.08 * a; MO.scale.y += 1.0 * a;
    }
    var POSE = { idle: function (t) { idle(t, 1); }, walk: function (t) { walk(t, 1); }, run: function (t) { run(t, 1); }, windup: windup, cast: cast, cast_big: castBig, hit: hit,
      victory: victory, defeat: defeat, ride: ride, talk: talk, duel_idle: duelIdle, taunt: taunt };

    root.userData.anim = function (t, state, dt) {
      t = t || 0;
      dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
      if (!WIZ_STATES[state]) state = 'idle';
      var k = poser.begin(t, state, WIZ_BLEND[state]);
      poser.reset();
      POSE[state](t, k);
      root.userData.defeatDone = state === 'defeat' && k > 1.5;
      poser.finish(t);
      // blink (not blended)
      var bl = ((t + X.seed * 3.1) % 3.7) / 3.7;
      if (bl > 0.965 && state !== 'defeat') EY.scale.y *= 0.12;
      // ---- secondary motion ----
      var vT = trTip.update(dt), vS = trSk.update(dt);
      if (X.hatTip) X.hatTip.rotation.set(sTipX.step(clamp(-vT.z * 0.05 - vT.y * 0.035, -0.55, 0.45), dt), 0, sTipZ.step(clamp(vT.x * 0.05, -0.45, 0.45), dt));
      if (X.plume) X.plume.rotation.set(sPl.step(clamp(-vT.z * 0.06 - vT.y * 0.04, -0.6, 0.4), dt), 0, sPlZ.step(clamp(vT.x * 0.05, -0.4, 0.4), dt));
      SK.rotation.x += sSkX.step(clamp(vS.z * 0.025, -0.2, 0.25), dt);
      SK.rotation.z += sSkZ.step(clamp(-vS.x * 0.025, -0.2, 0.2), dt);
      if (X.cape) {
        var vC = trCape.update(dt), sp = Math.min(1, Math.sqrt(vC.x * vC.x + vC.z * vC.z) / 7);
        var keep = -(U.rotation.x + B.rotation.x);
        X.cape.rotation.set(Math.max(keep - 0.02, keep * 0.3 + sCapeX.step(clamp(vC.z * 0.07 + Math.sin(t * 9) * 0.05 * sp, -0.05, 1.1), dt)), 0,
          sCapeZ.step(clamp(-vC.x * 0.05, -0.35, 0.35), dt));
      }
      if (X.amulet) X.amulet.rotation.x = Math.min(0, -(B.rotation.x + 0) * 0.9 + sAm.step(clamp(-vS.z * 0.03, -0.5, 0.2), dt));
      // ---- glow: halos breathe; the wand gem flares while casting; legendary pulses ----
      var castF = state === 'cast' ? smooth(0.08, 0.45, k) * (1 - 0.5 * smooth(0.9, 1.4, k)) : state === 'cast_big' ? smooth(0.1, 0.5, k) * (1 - 0.4 * smooth(1.2, 1.8, k)) : 0;
      for (var i = 0; i < X.halos.length; i++) {
        var hh = X.halos[i], s2 = hh.base * (1 + Math.sin(t * 3 + i) * 0.06);
        if (legendary) s2 *= 1 + 0.22 * Math.sin(t * 4 + i * 1.3);
        if (hh.wand) s2 *= 1 + castF * (1.6 + 0.5 * Math.sin(t * 20));
        hh.s.scale.set(s2, s2, 1);
      }
      if (aura) aura.userData.t = t;
      // ---- v1.2 WS6: clockwork spinners (faster while casting), floating plates / circlets, star motes
      for (var si = 0; si < X.spin.length; si++) { var S0 = X.spin[si]; S0.acc = (S0.acc || 0) + castF * (S0.boost || 0) * S0.w * dt; S0.o.rotation[S0.ax] = S0.ph + t * S0.w + S0.acc; }
      for (var fi = 0; fi < X.float.length; fi++) {
        var F0 = X.float[fi], bob = Math.sin(t * F0.f + F0.ph);
        F0.o.position.set(F0.p[0], F0.p[1] + bob * F0.amp + castF * (F0.lift || 0), F0.p[2]);
        if (F0.rz) F0.o.rotation.z = F0.r0 + Math.sin(t * F0.f * 0.63 + F0.ph) * F0.rz;
      }
      if (X.motes) { X.motes.userData.t = t; X.motes.userData.trail = clamp(Math.sqrt(vS.x * vS.x + vS.z * vS.z) / 6, 0, 1); }
    };

    root.userData.parts = { body: body, upper: upper, head: head, armL: X.armL, armR: X.armR, staff: X.wand, wand: X.wand, robe: X.skirt, skirt: X.skirt,
      hat: X.hat, hatTip: X.hatTip || null, elbowL: X.elbowL, elbowR: X.elbowR, handL: X.handL, handR: X.handR, footL: X.footL, footR: X.footR,
      cape: X.cape || null, amulet: X.amulet || null, eyes: X.eyes, mouth: X.mouth, aura: aura, motes: X.motes || null };
    root.userData.wandTip = wandTip;
    root.userData.rideDrop = 0.55 * (look.scale || 1);
    root.userData.gearLook = { hat: hatStyle, robe: robeStyle, boots: bootStyle, wand: wandStyle, amulet: amuletStyle, aura: X.auraKind || null };
    root.userData.height = measureTop(root);
    return root;
  }
  M.WIZARD_STATES = Object.keys(WIZ_STATES);
  M.GEAR_STYLES = { hat: Object.keys(HAT_STYLES), robe: Object.keys(ROBE_STYLES), boots: Object.keys(BOOT_STYLES), wand: Object.keys(WAND_STYLES), amulet: Object.keys(AMULET_STYLES) };
  // v2.1 WS-D: an NPC's look with its round-2 build (game/data/characters.js npcs[id]); unknown -> its old look
  M.npcLook = function (id) {
    var n = WF.data.npcs && WF.data.npcs[id], CH = WF.data.characters;
    if (!n) return {};
    var look = {}, k; for (k in (n.look || {})) look[k] = n.look[k];
    var bl = CH && CH.npcs && CH.npcs[id];
    if (bl) look.build = bl;
    return look;
  };
  M.wizard = function (look) {
    need();
    var t0 = window.performance ? performance.now() : 0;
    var rig; _lazyB++;
    try { rig = wizardModel(look); } finally { _lazyB--; }   // v1.2 WS6 (perf): lazy Builder output, see lazyGeo
    var root = skinify(rig);
    var sk = root.userData.skinned;
    if (sk && sk.geometry.boundingSphere) sk.geometry.boundingSphere.radius = Math.max(sk.geometry.boundingSphere.radius, 2.6 * ((look && look.scale) || 1));
    root.userData.buildMs = (window.performance ? performance.now() : 0) - t0;
    return root;
  };
  // helpers shared with game/js/models_mounts.js (C1). Read-only.
  M._c1 = { wizardModel: wizardModel, Poser: Poser, Spring: Spring, VelTrack: VelTrack, auraPoints: auraPoints, auraColors: auraColors, AURA: AURA, vmesh: vmesh, painter: painter,
    foldLathe: foldLathe, brimGeo: brimGeo, tierOf: tierOf, fxOf: fxOf, segK: segK, easeIO: easeIO, easeO: easeO, bell: bell, lerp: lerp, hash01: hash01, gemPart: gemPart, glowsAt: glowsAt,
    cogParts: cogParts, star4: star4, rbox: rbox };   // v1.2 WS6: + clockwork helpers (strider mount)

  // ==================================================================
  //  ENEMIES  (Hollow Court)  — v1.1 "more intense" pass (agent C2)
  //  Storybook villains: angry brows, narrowed glowing eyes (bloom via glowBoost), fangs, claws,
  //  horns/spikes, tattered edges, glowing Hollow runes/veins, dark smoke + ember aura, rim light.
  //  Every builder: E.key(color, o) with o = { elite } -> root (base() rig). M.enemy() adds scale,
  //  elite size/ring, aura, rim options and packs with skinify().
  //  States (erig): idle, walk (prowl), cast (wind-up -> lunge, holds), hit (recoil + flash),
  //  taunt (~1.2 s roar), duel_idle (aggressive stance), defeat (collapse + dissolve into smoke;
  //  sets root.userData.defeatDone = true at 1.5 s and holds). Unknown states -> idle.
  // ==================================================================
  var HOLLOW_GREEN = '#9dff5a', HOLLOW_VIOLET = '#c78bff', HOLLOW_BLACK = '#140a22';
  var BURN = '#ffb43a', BURN2 = '#ff5a1e', ELITE_GOLD = '#f0c04a', CRIMSON = '#e0203c';
  var ESTATES = { idle: 1, walk: 1, windup: 1, cast: 1, hit: 1, taunt: 1, duel_idle: 1, defeat: 1 };
  function base() { var root = new T.Group(); var scaler = pivot(root); var body = pivot(scaler); return { root: root, scaler: scaler, body: body }; }
  // point on an ellipsoid surface in direction d
  function onEll(c, r, d) {
    var k = 1 / Math.sqrt(Math.pow(d[0] / r[0], 2) + Math.pow(d[1] / r[1], 2) + Math.pow(d[2] / r[2], 2));
    return [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
  }
  function dk(c, f) { return mix(c, HOLLOW_BLACK, f); }          // darken toward Hollow black-violet
  function pulse(t, period, dur, ph) { var u = (((t + (ph || 0)) % period) + period) % period / dur; return u < 1 ? Math.sin(u * PI) : 0; }
  function wob(t, f, ph) { return Math.sin(t * f + (ph || 0)); }

  // ---- creature geometry (fresh geometries) ----
  // ridged, curving horn / claw / tail: tapered tube along a Catmull-Rom path
  function hornGeo(pts, r0, r1, ridges, ts, rs) {
    ts = ts || 14; rs = rs || 7;
    var curve = new T.CatmullRomCurve3(pts.map(V3));
    var g = new T.TubeGeometry(curve, ts, 1, rs, false);
    var pos = g.attributes.position, P = new T.Vector3(), Q = new T.Vector3();
    for (var i = 0; i <= ts; i++) {
      var u = i / ts; curve.getPointAt(u, P);
      var rad = r0 + (r1 - r0) * Math.pow(u, 0.8);
      if (ridges) rad *= 1 + 0.16 * Math.max(0, Math.sin(u * ridges * TAU)) * (1 - u * 0.7);
      for (var j = 0; j <= rs; j++) { var k = i * (rs + 1) + j; Q.fromBufferAttribute(pos, k).sub(P).multiplyScalar(rad).add(P); pos.setXYZ(k, Q.x, Q.y, Q.z); }
    }
    g.computeVertexNormals();
    return g;
  }
  // claw curling forward (+Z) and down from the origin
  function clawGeo(len, r) { return hornGeo([[0, 0, 0], [0, -len * 0.45, len * 0.2], [0, -len * 0.8, len * 0.55], [0, -len * 0.9, len * 0.85]], r, 0.003, 0, 6, 4); }
  // open skirt / cloak with a jagged, tattered hem. Top at y = h, hem at y = 0.
  // band = true: the whole strip follows the hem offsets (glowing hem trims made with the same seed/seg/jag)
  function skirtGeo(rTop, rBot, h, seg, jag, seed, hs, band) {
    hs = hs || 3;
    var g = new T.CylinderGeometry(rTop, rBot, h, seg, hs, true); g.translate(0, h / 2, 0);
    var p = g.attributes.position, rnd = seeded(seed || 3), off = [], fl = [];
    for (var c = 0; c < seg; c++) { off.push(c % 2 === 0 ? jag * (0.5 + 0.7 * rnd()) : jag * 0.08 * rnd()); fl.push(c % 2 === 0 ? 0.06 + rnd() * 0.06 : 0); }
    off.push(off[0]); fl.push(fl[0]);
    for (var row = 0; row <= hs; row++) {
      var u = row / hs, w3 = band ? 1 : u * u * u;
      for (var c2 = 0; c2 <= seg; c2++) {
        var k = row * (seg + 1) + c2, f = 1 + fl[c2] * w3 + 0.03 * Math.sin(c2 * 2.3 + row) * u;
        p.setXYZ(k, p.getX(k) * f, p.getY(k) - off[c2] * w3, p.getZ(k) * f);
      }
    }
    g.computeVertexNormals();
    return g;
  }
  // gnarled, twisted bark column (trunks, limbs). Base at y=0.
  function gnarlGeo(rTop, rBot, h, seg, hs, twist, amp, seed) {
    var g = new T.CylinderGeometry(rTop, rBot, h, seg, hs, true); g.translate(0, h / 2, 0);
    var p = g.attributes.position, nz = enoise(seed || 11);
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), u = y / h;
      var r = Math.sqrt(x * x + z * z) * (1 + amp * (nz(a * 2.2 + 9, y * 1.7) - 0.5) * 2 + amp * 0.6 * Math.sin(a * 5 + y * 3));
      var aa = a + twist * u;
      p.setXYZ(i, Math.cos(aa) * r, y, Math.sin(aa) * r);
    }
    g.computeVertexNormals();
    return g;
  }
  // tiny 2D value noise (own copy so the creature code never depends on the ground section)
  function enoise(seed) {
    function h(ix, iz) { var n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
    return function (x, z) {
      var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
      fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
      var a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };
  }
  // flat wing membrane in the XY plane (normal +Z) from the origin out to finger tips; scalloped trailing edge
  function membraneGeo(tips, sag) {
    var s = new T.Shape(); s.moveTo(0, 0); s.lineTo(tips[0][0], tips[0][1]);
    for (var i = 1; i < tips.length; i++) {
      var a = tips[i - 1], b = tips[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      s.quadraticCurveTo(mx * (1 - sag), my * (1 - sag), b[0], b[1]);
    }
    s.lineTo(0, 0);
    return new T.ShapeGeometry(s, 4);
  }
  // serrated blade (sword / greatsword / trident barbs): extruded jagged outline, base at y=0
  function bladeGeo(len, w, th, teeth, tip) {
    var s = new T.Shape(), n = teeth || 4, hw = w / 2;
    s.moveTo(-hw, 0);
    for (var i = 0; i < n; i++) { var y0 = len * (i / n) * 0.82, y1 = len * ((i + 0.6) / n) * 0.82; s.lineTo(-hw * (1 - i * 0.04), y0 + 0.001); s.lineTo(-hw * 1.35 * (1 - i * 0.04), y1); s.lineTo(-hw * (1 - i * 0.04), y1 + len * 0.04); }
    s.lineTo(-hw * 0.7, len * 0.84); s.lineTo(0, len * (tip || 1)); s.lineTo(hw * 0.75, len * 0.84);
    for (var j = n - 1; j >= 0; j--) { var y2 = len * ((j + 0.5) / n) * 0.82; s.lineTo(hw * (1 - j * 0.03), y2 + len * 0.05); s.lineTo(hw * 1.2 * (1 - j * 0.03), y2 - len * 0.02); s.lineTo(hw * (1 - j * 0.03), y2 - len * 0.07); }
    s.lineTo(hw, 0); s.lineTo(-hw, 0);
    var g = new T.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelThickness: th * 0.6, bevelSize: Math.min(w * 0.12, 0.03), bevelSegments: 1, curveSegments: 2 });
    g.translate(0, 0, -th / 2);
    return g;
  }

  // ---- face / detail kits (add into a Builder) ----
  // narrowed glowing eye: dark socket + glowing almond + slit pupil. sx = side (+1 = model's left, viewer's right)
  function angryEye(B, p, sx, col, s, o) {
    o = o || {};
    var tilt = sx * (o.tilt == null ? 0.42 : o.tilt), sq = o.squint || 0.55;
    B.add(G.sph(1, 12, 8), o.socket || '#0b0612', { p: [p[0], p[1], p[2] - s * 0.15], s: [s * 1.45, s * (sq + 0.25), s * 0.6], r: [0, 0, tilt] });
    B.glow(G.sph(1, 12, 8), col, { p: p, s: [s * 1.25, s * sq, s * 0.5], r: [0, o.yaw ? sx * o.yaw : 0, tilt] });
    if (o.pupil !== false) B.add(G.box(s * 0.22, s * sq * 1.7, s * 0.2), '#120a08', { p: [p[0] + (o.px || 0) * sx, p[1], p[2] + s * 0.42], r: [0, 0, tilt * 0.3] });
  }
  // heavy angled brow ridge over an eye (inner end low = angry)
  function brow(B, p, sx, w, col, o) {
    o = o || {};
    B.add(G.box(w, w * (o.th || 0.32), w * (o.d || 0.45)), col, { p: p, r: [o.rx == null ? 0.3 : o.rx, sx * (o.yaw || 0.15), sx * (o.ang == null ? 0.5 : o.ang)], flat: o.flat !== false });
  }
  // row of fangs along an arc in the XY plane (centre c, half-width w); down = upper teeth pointing down
  function fangRow(B, c, w, n, len, r, col, down, o) {
    o = o || {};
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? i / (n - 1) * 2 - 1 : 0, big = o.big && (i === 0 || i === n - 1) ? o.big : 1;
      var x = c[0] + u * w, y = c[1] + (o.curve || 0) * u * u, z = c[2] - (o.back || 0) * u * u;
      B.add(G.cone(r * big, len * big, 5), col, { p: [x, y + (down ? -1 : 1) * len * big * 0.5, z], r: [down ? PI : 0, 0, (o.splay || 0) * u * (down ? -1 : 1)] });
    }
  }
  // glowing Hollow glyph (built flat in XZ, oriented so its face points along n)
  function glyph(B, kind, p, n, size, col) {
    var q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), V3(n).normalize());
    var Mx = new T.Matrix4().compose(V3(p), q, new T.Vector3(1, 1, 1));
    function part(geo, o) { B.glow(geo, col, { matrix: Mx.clone().multiply(mtx(o)) }); }
    var s = size;
    if (kind === 'eye') {
      part(G.tor(s * 0.5, s * 0.07, 4, 14, PI * 0.8), { r: [PI / 2, 0, PI * 0.1], s: [1, 0.55, 1], p: [0, 0, -s * 0.1] });
      part(G.tor(s * 0.5, s * 0.07, 4, 14, PI * 0.8), { r: [PI / 2, 0, PI * 1.1], s: [1, 0.55, 1], p: [0, 0, s * 0.1] });
      part(G.sph(s * 0.16, 8, 6), { s: [1, 0.4, 1] });
    } else if (kind === 'zig') {
      part(G.box(s * 0.12, s * 0.06, s * 0.55), { p: [-s * 0.18, 0, 0], r: [0, 0.5, 0] });
      part(G.box(s * 0.12, s * 0.06, s * 0.55), { p: [s * 0.08, 0, 0], r: [0, -0.5, 0] });
      part(G.box(s * 0.12, s * 0.06, s * 0.4), { p: [s * 0.3, 0, -s * 0.05], r: [0, 0.5, 0] });
    } else if (kind === 'crescent') {
      part(G.tor(s * 0.45, s * 0.08, 4, 14, PI * 1.25), { r: [PI / 2, 0, PI * 0.12] });
      part(G.oct(s * 0.13), { p: [s * 0.12, 0, 0], s: [1, 0.4, 1] });
    } else {   // 'tri' rune
      for (var i = 0; i < 3; i++) part(G.box(s * 0.08, s * 0.06, s * 0.6), { r: [0, i * TAU / 3, 0], p: [Math.cos(i * TAU / 3 + PI / 2) * s * 0.17, 0, Math.sin(i * TAU / 3 + PI / 2) * s * 0.17] });
      part(G.sph(s * 0.1, 6, 5), { s: [1, 0.4, 1] });
    }
  }
  // spikes over an ellipsoid (c centre, r radii) along directions
  function spikesOn(B, c, r, dirs, len, rad, col, o) {
    o = o || {};
    dirs.forEach(function (d, i) {
      var p = onEll(c, r, d), L = len * (o.vary ? 0.7 + 0.6 * ((i * 0.618) % 1) : 1), dd = o.bias ? [d[0] + o.bias[0], d[1] + o.bias[1], d[2] + o.bias[2]] : d;
      var dl = Math.sqrt(dd[0] * dd[0] + dd[1] * dd[1] + dd[2] * dd[2]) || 1; dd = [dd[0] / dl, dd[1] / dl, dd[2] / dl];
      var sink = o.sink == null ? 0.15 : o.sink;   // fraction of the spike buried in the surface
      B.add(G.cone(rad, L, o.seg || 5), col, { p: [p[0] + dd[0] * L * (0.5 - sink), p[1] + dd[1] * L * (0.5 - sink), p[2] + dd[2] * L * (0.5 - sink)], dir: dd, flat: o.flat !== false });
      if (o.tips && i % (o.tipEvery || 1) === 0) B.glow(G.cone(rad * 0.34, L * 0.24, 4), o.tips, { p: [p[0] + dd[0] * L * (0.86 - sink), p[1] + dd[1] * L * (0.86 - sink), p[2] + dd[2] * L * (0.86 - sink)], dir: dd });
    });
  }
  // glowing vein / crack following a path
  function vein(B, pts, r, col) { B.glow(hornGeo(pts, r, r * 0.35, 0, 8, 4), col); }

  // ------------------------------------------------------------------
  //  Enemy animation rig. custom(t, state, k, dt, e):
  //   e.cast  0..1 ramp (holds)            e.wind  wind-up 0..1..0 (0 – 0.42 s)
  //   e.lunge strike 0 -> 1 (0.3 – 0.42 s) then settles to 0.55 and holds
  //   e.hit   recoil spring (+1 back, slight overshoot), e.flash (white hit flash)
  //   e.taunt 0..1..0 over ~1.25 s, e.roar = taunt with tremble
  //   e.duel  0..1 combat stance blend (duel_idle / cast / hit / taunt), smoothed
  //   e.fall  0..1 collapse (defeat), e.dis 0..1 dissolve (defeat, 0.45 – 1.5 s)
  // ------------------------------------------------------------------
  function erig(root, body, custom, opts) {
    opts = opts || {};
    var st = { s: null, t0: 0, duel: 0, init: false };
    var halos = root.userData.eyeHalos || (root.userData.eyeHalos = []);
    var aS = root.userData.auraState = { t: 0, a: 1, d: 0 };
    var fallDir = opts.fallDir || 1;
    var parts = root.userData.parts = root.userData.parts || {};
    parts.body = body;
    if (!parts.head && halos.length && halos[0].parent) parts.head = halos[0].parent;
    root.userData.anim = function (t, state, dt) {
      state = ESTATES[state] ? state : 'idle';
      if (state !== st.s) { st.s = state; st.t0 = t; }
      var k = Math.max(0, t - st.t0);
      dt = dt == null ? 0.016 : dt;
      var combat = state === 'duel_idle' || state === 'windup' || state === 'cast' || state === 'hit' || state === 'taunt' || state === 'defeat' ? 1 : 0;
      if (!st.init || dt > 0.4) st.duel = combat; else st.duel += (combat - st.duel) * Math.min(1, dt * 5);
      st.init = true;
      var dead = state === 'defeat';
      var tau = state === 'taunt' ? smooth(0, 0.22, k) * (1 - smooth(0.95, 1.25, k)) : 0;
      var e = {
        cast: state === 'cast' ? smooth(0, 0.28, k) : state === 'windup' ? 0.5 * smooth(0, 0.4, k) : 0,
        // v2.1 A3: 'windup' holds the wind-up pose for 1.5 s (with a growing tremble), no lunge
        wind: state === 'cast' ? smooth(0, 0.28, k) * (1 - smooth(0.3, 0.42, k)) : state === 'windup' ? smooth(0, 0.4, k) * (1 + 0.08 * Math.sin(k * 36) * Math.min(1, k / 1.5)) : 0,
        lunge: state === 'cast' ? (k < 0.3 ? 0 : k < 0.42 ? eOut((k - 0.3) / 0.12) : 0.55 + 0.45 * Math.exp(-(k - 0.42) * 6)) : 0,
        hit: state === 'hit' ? (k < 0.05 ? k / 0.05 : Math.exp(-(k - 0.05) * 6.5) * Math.cos((k - 0.05) * 11)) : 0,
        flash: state === 'hit' ? Math.max(0, 1 - k / 0.16) : 0,
        taunt: tau, roar: tau * (0.75 + 0.25 * Math.sin(k * 34)),
        duel: st.duel,
        fall: dead ? eInOut(clamp(k / 0.8, 0, 1)) : 0,
        dis: dead ? clamp((k - 0.45) / 1.05, 0, 1) : 0,
        dead: dead, state: state, k: k
      };
      body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
      custom(t, state, k, dt, e);
      var hs = opts.hitScale || 1, ls = opts.lungeScale == null ? 1 : opts.lungeScale;
      if (e.hit) { body.rotation.x += -0.4 * e.hit * hs; body.position.z += -0.24 * e.hit * hs; body.scale.y *= 1 - 0.07 * e.hit; }
      if (e.wind) { body.position.z -= 0.14 * e.wind * ls; body.rotation.x -= 0.1 * e.wind * ls; }
      if (e.lunge) { body.position.z += 0.34 * e.lunge * ls; body.rotation.x += 0.1 * e.lunge * ls; }
      if (e.taunt) { body.rotation.x -= 0.12 * e.taunt * (opts.tauntTilt == null ? 1 : opts.tauntTilt); body.scale.multiplyScalar(1 + 0.05 * e.taunt); body.position.x += Math.sin(k * 41) * 0.012 * e.taunt; }
      if (e.fall && !opts.customFall) {
        body.position.y -= (opts.sink || 0.1) * e.fall;
        body.rotation.x += (opts.fallX == null ? -0.35 : opts.fallX) * e.fall;
        body.rotation.z += 0.18 * fallDir * e.fall;
        body.scale.y *= 1 - 0.2 * e.fall;
      }
      // shader + glow reactions
      var U = root.userData.skinU;
      if (U) { U.wfFlash.value = e.flash * 0.42; U.wfDissolve.value = e.dis; }
      var flare = 1 + e.cast * (1.2 + 0.4 * Math.sin(t * 18)) + e.taunt * (1.8 + 0.5 * Math.sin(t * 27)) + 0.1 * Math.sin(t * 2.3) + e.duel * 0.15;
      if (root.userData.elite) flare *= 1.1 + 0.12 * Math.sin(t * 31) + 0.08 * Math.sin(t * 17.3);
      if (dead) flare *= (1 + 1.2 * (1 - smooth(0, 0.25, k))) * (1 - smooth(0.35, 1.2, k));
      for (var i = 0; i < halos.length; i++) { var h2 = halos[i].userData.base * flare; halos[i].scale.set(h2, h2, 1); }
      if (dead) {   // every other glow sprite (staff gems, lanterns, orbs, crowns) fades with the body
        if (!st.others) { st.others = []; root.traverse(function (ob) { if (ob.isSprite && halos.indexOf(ob) < 0 && !ob.userData.textTag && !(ob.material && ob.material.map && ob.material.map.isCanvasTexture && !ob.material.map.userData.cached)) st.others.push(ob); }); }
        var fo = 1 - smooth(0.4, 1.3, k);
        for (var oi = 0; oi < st.others.length; oi++) { var so = st.others[oi]; if (so.userData.dk0 === undefined) so.userData.dk0 = so.scale.clone(); so.scale.copy(so.userData.dk0).multiplyScalar(fo); }
      } else if (st.others) { for (var oj = 0; oj < st.others.length; oj++) { var sr = st.others[oj]; if (sr.userData.dk0 !== undefined) { sr.scale.copy(sr.userData.dk0); sr.userData.dk0 = undefined; } } }
      aS.t = t;
      aS.a = (1 + 0.7 * e.taunt + 0.35 * e.cast + 0.25 * e.duel) * (dead ? 1 - smooth(1.4, 2.6, k) : 1);
      aS.d = dead ? smooth(0.2, 0.8, k) * (1 - smooth(1.7, 2.7, k)) : 0;
      var done = dead && k >= 1.5;
      root.userData.defeatDone = done;
      var sk = root.userData.skinned;
      if (dead && !st.loose) {
        st.loose = [];
        root.traverse(function (ob) { if (ob.isMesh && ob.name !== 'skinnedBody' && ob.name !== 'haloBatch' && ob.layers.mask !== 0) st.loose.push(ob); });
      }
      if (st.loose) for (var lo = 0; lo < st.loose.length; lo++) st.loose[lo].visible = !(dead && e.dis > 0.35);
      if (sk) {
        var hideAll = dead && e.dis >= 1, hideTrans = dead && e.dis > 0.35;
        for (var c = 0; c < root.children.length; c++) {
          var ch = root.children[c];
          if (ch.name === 'skinnedBody') ch.visible = ch === sk ? !hideAll : !hideTrans;
        }
      }
    };
  }
  var E = {};

  // ---------------- Hollow Sprite: wicked floating wisp-imp ----------------
  E.sprite = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#a879ff'), skin = dk(c, 0.36), belly = sh(dk(c, 0.12), 0.1), dark = dk(c, 0.8), horn = C('#1c0d24');
    var eyeC = C(EL ? BURN : '#eaff6a'), glowV = sh(c, 0.45), gold = C(ELITE_GOLD), tooth = C('#f4ecd8');
    var b = base(), root = b.root, body = b.body;
    var core = pivot(body, 0, 1.18, 0);
    var B = new Builder();
    B.add(G.sph(0.36, 24, 18), skin, { s: [1, 1.04, 0.94] });
    B.add(G.sph(0.25, 18, 12), belly, { p: [0, -0.13, 0.15], s: [1, 0.95, 0.72] });
    [-1, 1].forEach(function (sx) {
      B.add(G.cone(0.09, 0.5, 8), skin, { p: [sx * 0.34, 0.13, -0.07], r: [-0.55, 0, -sx * 1.12] });
      B.add(hornGeo([[sx * 0.11, 0.25, 0.06], [sx * 0.21, 0.44, 0.0], [sx * 0.21, 0.6, 0.12], [sx * 0.13, 0.67, 0.28]], 0.062, 0.004, 3, 12, 7), horn);
      angryEye(B, [sx * 0.135, 0.055, 0.302], sx, eyeC, 0.09, {});
      brow(B, [sx * 0.135, 0.145, 0.315], sx, 0.21, dark, { ang: 0.5, th: 0.34 });
      B.add(G.cone(0.026, 0.09, 5), tooth, { p: [sx * 0.1, -0.085, 0.322], r: [PI, 0, sx * 0.12] });     // canines
    });
    // jagged glowing grin
    B.add(G.tor(0.155, 0.046, 5, 18, PI), '#12061c', { p: [0, -0.06, 0.296], r: [0.25, 0, PI], s: [1, 0.62, 1] });
    B.glow(G.tor(0.15, 0.026, 5, 18, PI), sh(eyeC, -0.15), { p: [0, -0.06, 0.312], r: [0.25, 0, PI], s: [1, 0.62, 1] });
    for (var i = 0; i < 6; i++) {
      var a = PI + 0.5 + i * (PI - 1.0) / 5, x = Math.cos(a) * 0.15, y = -0.06 + Math.sin(a) * 0.093;
      B.add(G.cone(0.017, 0.055, 4), tooth, { p: [x, y + 0.022, 0.33], r: [0.2, 0, -Math.cos(a) * 0.5] });
    }
    spikesOn(B, [0, 0, 0], [0.36, 0.374, 0.34], [[0, 1, -0.35], [0, 0.75, -0.75], [0, 0.35, -1], [0, -0.05, -1], [0, -0.45, -0.9]], 0.15, 0.05, dark, { vary: true });
    glyph(B, 'eye', [0, -0.28, 0.255], [0, -0.45, 1], 0.14, glowV);
    if (EL) {
      B.add(G.tor(0.3, 0.032, 5, 26), gold, { p: [0, -0.24, -0.02], r: [PI / 2 + 0.3, 0, 0] });
      [-1, 1].forEach(function (sx) {
        B.add(hornGeo([[sx * 0.2, 0.2, -0.12], [sx * 0.37, 0.34, -0.24], [sx * 0.44, 0.52, -0.4], [sx * 0.4, 0.62, -0.56]], 0.058, 0.004, 4, 12, 6), horn);
        B.add(G.cone(0.03, 0.12, 6), gold, { p: [sx * 0.135, 0.68, 0.3], r: [0.9, 0, -sx * 0.4] });
      });
    }
    core.add(B.build());
    // curling flame tail
    var tail = pivot(core, 0, -0.22, -0.04), TB = new Builder();
    TB.add(hornGeo([[0, 0.12, 0.06], [0, -0.22, -0.1], [0.1, -0.5, -0.2], [-0.08, -0.76, -0.14], [0.02, -0.97, 0.05]], 0.27, 0.012, 0, 18, 10), skin);
    [[0.13, -0.3, -0.17, [1, -0.3, -0.6]], [-0.12, -0.46, -0.21, [-1, -0.2, -0.5]], [0.08, -0.63, -0.22, [0.8, -0.3, -0.7]], [-0.07, -0.79, -0.13, [-0.8, -0.4, -0.4]]].forEach(function (s) {
      TB.add(G.cone(0.045, 0.2, 5), dark, { p: [s[0], s[1], s[2]], dir: s[3], flat: true });
    });
    TB.glow(G.oct(0.05), glowV, { p: [0.02, -0.99, 0.06], s: [1, 1.7, 1] });
    tail.add(TB.build());
    function arm(sx) {
      var p = pivot(core, sx * 0.27, -0.12, 0.14), A = new Builder();
      A.add(G.cyl(0.04, 0.056, 0.24, 8), skin, { p: [0, -0.1, 0.0] });
      A.add(G.sph(0.056, 10, 8), skin, { p: [0, -0.22, 0.0] });
      for (var j = -1; j <= 1; j++) A.add(clawGeo(0.12, 0.017), horn, { p: [j * 0.026, -0.24, 0.02], r: [-0.3, j * 0.35, 0] });
      p.add(A.build()); return p;
    }
    var armL = arm(1), armR = arm(-1);
    // tattered translucent wings with glowing veins (all four share one single-pass material = 1 draw call)
    var wc = dk(c, 0.22);
    var wingMat = cmat('wingSP2' + hx(wc), function () { var m = M.glow(wc, 0.6).clone(); m.forceSinglePass = true; return m; });
    function wing(sx, up) {
      var p = pivot(core, sx * 0.13, up ? 0.12 : -0.03, -0.25);
      var tips = up ? [[0.2, 0.55], [0.55, 0.52], [0.76, 0.24], [0.68, -0.06], [0.42, -0.17]] : [[0.32, -0.04], [0.52, -0.22], [0.45, -0.44], [0.22, -0.4]];
      var wm = new T.Mesh(membraneGeo(tips, 0.34), wingMat); p.add(wm);
      var VB = new Builder();
      tips.forEach(function (tp) { VB.glow(hornGeo([[0, 0, 0.006], [tp[0] * 0.5, tp[1] * 0.5 + 0.03, 0.01], [tp[0], tp[1], 0.006]], 0.013, 0.004, 0, 5, 4), glowV); });
      p.add(VB.build());
      if (sx < 0) p.scale.x = -1;
      return p;
    }
    var wL = wing(1, true), wR = wing(-1, true), wL2 = wing(1, false), wR2 = wing(-1, false);
    eyeHalos(root, core, [[-0.135, 0.055, 0.34], [0.135, 0.055, 0.34]], eyeC, 0.32);
    root.userData.aura = { r: 0.42, h: 1.1, y0: 0.55, size: 0.42, smoke: 10, smokeAlpha: 0.42, smokeColor: dk(c, 0.72), embers: 9, emberColor: eyeC, emberSize: 0.075, pool: 0.55, life: 2.2, emberLife: 1.5 };
    root.userData.skinOpts = { rim: sh(c, 0.15), rimStrength: 0.5 };
    erig(root, body, function (t, state, k, dt, e) {
      var walk = state === 'walk', d = e.duel;
      var sn = pulse(t, 4.3, 0.55) * (1 - d * 0.5);
      core.position.set(0, 1.18 + Math.sin(t * 2.4) * 0.1 + Math.sin(t * 17) * 0.012 - 0.08 * d, 0);
      core.rotation.set((walk ? 0.32 : 0) + 0.16 * d - sn * 0.12, Math.sin(t * 0.9) * 0.12 * (1 - d), Math.sin(t * 1.7) * 0.08 + Math.sin(t * 40) * 0.05 * sn);
      var f = walk ? 26 : 15 + 8 * d + 12 * e.taunt, w = 0.3 + 0.5 * Math.sin(t * f), w2 = 0.25 + 0.45 * Math.sin(t * f + 1.3);
      wL.rotation.set(0, w, 0.1); wR.rotation.set(0, -w, -0.1); wL2.rotation.set(0, w2, -0.15); wR2.rotation.set(0, -w2, 0.15);
      tail.rotation.set(Math.sin(t * 3.1) * 0.25, Math.sin(t * 2.2) * 0.35, 0);
      var cl = Math.sin(t * 5) * 0.12;
      armL.rotation.set(-0.55 + cl - 0.45 * d, 0, 0.3); armR.rotation.set(-0.55 - cl - 0.45 * d, 0, -0.3);
      if (e.wind) {
        core.position.z -= 0.22 * e.wind; core.position.y += 0.15 * e.wind; core.rotation.x -= 0.45 * e.wind;
        armL.rotation.x -= 1.3 * e.wind; armR.rotation.x -= 1.3 * e.wind; armL.rotation.z += 0.5 * e.wind; armR.rotation.z -= 0.5 * e.wind;
      }
      if (e.lunge) { core.position.z += 0.38 * e.lunge; core.rotation.x += 0.5 * e.lunge; armL.rotation.x -= 0.9 * e.lunge; armR.rotation.x -= 0.9 * e.lunge; }
      if (e.taunt) {
        core.position.y += 0.25 * e.taunt; core.rotation.x -= 0.42 * e.taunt; core.rotation.z += Math.sin(k * 38) * 0.08 * e.roar;
        armL.rotation.z += 1.0 * e.taunt; armR.rotation.z -= 1.0 * e.taunt; armL.rotation.x -= 0.7 * e.taunt; armR.rotation.x -= 0.7 * e.taunt;
        wL.rotation.y += 0.3 * e.taunt; wR.rotation.y -= 0.3 * e.taunt;
      }
      if (e.hit) core.rotation.z += 0.5 * e.hit;
      if (e.fall) {
        core.position.y += (0.42 - core.position.y) * e.fall; core.rotation.z += 1.2 * e.fall; core.rotation.x += 0.5 * e.fall;
        wL.rotation.z -= 0.9 * e.fall; wR.rotation.z += 0.9 * e.fall; armL.rotation.z += 0.8 * e.fall; armR.rotation.z -= 0.8 * e.fall;
      }
    }, { customFall: true, hitScale: 0.8 });
    return root;
  };

  // ---------------- Rot Toad / Grubnak the Bog King ----------------
  function toadModel(col, king, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || (king ? '#5f7f2e' : '#7a9a3c'));
    var skin = dk(c, king ? 0.44 : 0.38), belly = mix(skin, '#c9c28a', 0.36), mott = mix(skin, '#3a1848', 0.55), dark = dk(c, 0.76);
    var eyeC = C(EL ? BURN : (king ? '#ffe14a' : '#eaff5a')), sick = C(HOLLOW_GREEN), bone = C('#e6dcb8'), gold = C(king ? '#e8b43a' : ELITE_GOLD);
    var spineC = mix(bone, dark, 0.5), mouthC = C('#1a0a14');
    var b = base(), root = b.root, body = b.body;
    var torso = pivot(body);
    var B = new Builder();
    var bc = [0, 0.7, -0.05], br = [0.95, 0.66, 0.9];
    B.add(G.sph(1, 24, 18), skin, { p: bc, s: br });
    B.add(G.sph(0.7, 20, 14), belly, { p: [0, 0.48, 0.22], s: [1.05, 0.6, 0.85] });
    [[0.3, 0.9, -0.4], [-0.45, 0.8, -0.5], [0.72, 0.5, -0.25], [-0.75, 0.45, 0.05], [0.1, 1, -0.2], [-0.2, 0.7, -0.8], [0.55, 0.62, 0.2], [0.36, 0.42, -0.85], [-0.6, 0.62, -0.25], [0.8, 0.2, -0.5], [-0.3, 0.95, 0.1], [0.05, 0.6, -0.95]].forEach(function (d, i) {
      B.add(G.sph(1, 7, 5), mott, { p: onEll(bc, br, d), dir: d, s: [0.13 + (i % 3) * 0.04, 0.04, 0.11 + (i % 2) * 0.05] });
    });
    // pustules: some glow (Hollow rot), some plain warts
    [[0.42, 0.85, -0.5], [-0.5, 0.75, -0.42], [0.68, 0.58, -0.05], [-0.72, 0.5, -0.15], [0.2, 0.8, -0.75], [-0.25, 0.95, -0.55], [0.62, 0.4, -0.62], [-0.15, 0.6, -0.92], [0.85, 0.35, 0.1], [-0.85, 0.3, -0.35]].forEach(function (d, i) {
      var p = onEll(bc, br, d);
      if (i % 2 === 0 || king) B.glow(G.sph(0.055 + (i % 3) * 0.015, 8, 6), sick, { p: p });
      else B.add(G.sph(0.075, 8, 6), mix(skin, '#8a4fbf', 0.45), { p: p });
    });
    // bony dorsal spines
    var sp = [];
    for (var i = 0; i < 7; i++) { var th = 0.5 + i * 0.3; sp.push([0, Math.cos(th), -Math.sin(th)]); }
    spikesOn(B, bc, br, sp, king ? 0.28 : 0.22, king ? 0.09 : 0.07, spineC, { vary: true, bias: [0, 0, -0.35], tips: king ? sick : null });
    spikesOn(B, bc, br, [[0.4, 0.85, -0.45], [-0.4, 0.85, -0.45], [0.45, 0.6, -0.75], [-0.45, 0.6, -0.75], [0.5, 0.9, 0.0], [-0.5, 0.9, 0.0]], 0.13, 0.05, spineC, { vary: true });
    [-1, 1].forEach(function (sx) {
      B.add(G.sph(0.27, 16, 12), skin, { p: [sx * 0.4, 1.16, 0.34] });
      angryEye(B, [sx * 0.41, 1.17, 0.585], sx, eyeC, 0.155, { tilt: 0.38, squint: 0.5, pupil: false });
      B.add(G.box(0.085, 0.016, 0.02), '#120a08', { p: [sx * 0.41, 1.17, 0.668], r: [0, 0, sx * 0.38] });
      brow(B, [sx * 0.39, 1.3, 0.53], sx, 0.42, dk(c, 0.5), { ang: 0.42, th: 0.2, d: 0.42, rx: 0.45, flat: false });
      // haunches + feet with claws
      B.add(G.sph(0.42, 16, 12), skin, { p: [sx * 0.82, 0.36, -0.28], s: [0.72, 0.82, 1.2] });
      B.add(G.sph(0.25, 12, 8), dark, { p: [sx * 0.92, 0.06, 0.16], s: [1.2, 0.35, 1.5] });
      for (var j = -1; j <= 1; j++) B.add(clawGeo(0.13, 0.026), bone, { p: [sx * 0.92 + j * 0.11, 0.1, 0.42], r: [0, j * 0.25, 0] });
      B.add(G.cyl(0.1, 0.14, 0.5, 10), skin, { p: [sx * 0.56, 0.26, 0.62], r: [0.3, 0, -sx * 0.18] });
      B.add(G.sph(0.16, 12, 8), dark, { p: [sx * 0.6, 0.05, 0.78], s: [1.3, 0.4, 1.3] });
      for (var j2 = -1; j2 <= 1; j2++) B.add(clawGeo(0.11, 0.022), bone, { p: [sx * 0.6 + j2 * 0.075, 0.08, 0.92], r: [0, j2 * 0.3, 0] });
      // upper fangs hanging over the jaw
      B.add(G.cone(0.045, 0.22, 6), bone, { p: [sx * 0.3, 0.72, 0.92], r: [PI + 0.15, 0, sx * 0.1] });
    });
    // mouth roof / throat (revealed when the jaw drops)
    B.add(G.sph(1, 16, 10), mouthC, { p: [0, 0.63, 0.62], s: [0.62, 0.15, 0.37] });
    B.glow(G.sph(1, 12, 8), '#4f9a22', { p: [0, 0.6, 0.68], s: [0.36, 0.06, 0.26] });
    if (king) {
      // spiked iron-gold crown with Hollow gems
      B.add(G.cyl(0.44, 0.48, 0.26, 16, true), gold, { p: [0, 1.38, 0.02], flat: true });
      B.add(G.tor(0.47, 0.035, 5, 24), sh(gold, -0.25), { p: [0, 1.27, 0.02], r: [PI / 2, 0, 0] });
      for (var q = 0; q < 10; q++) {
        var a = q * TAU / 10;
        B.add(G.cone(0.075, q % 2 ? 0.26 : 0.42, 5), gold, { p: [Math.sin(a) * 0.45, 1.6 + (q % 2 ? 0 : 0.08), Math.cos(a) * 0.45], r: [Math.cos(a) * 0.15, 0, -Math.sin(a) * 0.15], flat: true });
        B.glow(G.oct(0.05), q % 2 ? '#ff5aa0' : HOLLOW_GREEN, { p: [Math.sin(a) * 0.49, 1.38, Math.cos(a) * 0.49], s: [1, 1.4, 0.6] });
      }
      // moss mantle + bone necklace
      for (var m = 0; m < 9; m++) {
        var ma = PI * 0.62 + m * PI * 0.76 / 8, mr = 0.86;
        B.add(G.cone(0.12, 0.42 + (m % 3) * 0.14, 5), m % 2 ? '#2f4a1c' : '#3d5a22', { p: [Math.sin(ma) * mr, 0.62 - (m % 3) * 0.05, Math.cos(ma) * mr * 0.95 - 0.05], r: [PI + Math.cos(ma) * 0.3, 0, -Math.sin(ma) * 0.3], flat: true });
      }
      B.add(G.sph(0.34, 8, 6), '#3d5a22', { p: [0.45, 1.06, -0.45], s: [1.4, 0.45, 1.2], flat: true });
      B.add(G.sph(0.34, 8, 6), '#2f4a1c', { p: [-0.4, 1.08, -0.5], s: [1.3, 0.42, 1.1], flat: true });
      [-1, 1].forEach(function (sx) {
        // gold spiked pauldron humps over the forelegs
        B.add(G.tor(0.14, 0.035, 5, 16), gold, { p: [sx * 0.57, 0.36, 0.66], r: [PI / 2 + 0.3, 0, -sx * 0.18] });
        for (var s2 = 0; s2 < 3; s2++) B.add(G.cone(0.05, 0.3 - s2 * 0.05, 5), spineC, { p: [sx * (0.66 + s2 * 0.08), 0.92 - s2 * 0.1, 0.3 + s2 * 0.1], r: [0.15, 0, -sx * (0.55 + s2 * 0.25)], flat: true });
        B.add(G.cone(0.06, 0.34, 6), bone, { p: [sx * 0.2, 0.74, 0.96], r: [PI + 0.1, 0, sx * 0.05] });
      });
      glyph(B, 'eye', onEll(bc, br, [0, 0.55, -1]), [0, 0.5, -1], 0.34, sick);
      glyph(B, 'zig', onEll(bc, br, [0.8, 0.5, -0.4]), [0.8, 0.5, -0.4], 0.26, sick);
      glyph(B, 'zig', onEll(bc, br, [-0.8, 0.5, -0.4]), [-0.8, 0.5, -0.4], 0.26, sick);
    }
    if (EL) {
      [-1, 1].forEach(function (sx) {
        B.add(hornGeo([[sx * 0.42, 1.36, 0.3], [sx * 0.55, 1.6, 0.22], [sx * 0.52, 1.82, 0.36], [sx * 0.4, 1.9, 0.52]], 0.075, 0.005, 4, 12, 7), dark);
        B.add(G.tor(0.07, 0.022, 4, 12), gold, { p: [sx * 0.47, 1.44, 0.27], r: [PI / 2, 0, -sx * 0.4] });
      });
      if (!king) { B.add(G.tor(0.28, 0.03, 5, 20), gold, { p: [0, 1.36, 0.1], r: [PI / 2 + 0.2, 0, 0] }); }
    }
    torso.add(B.build());
    // under-biting jaw (pivot = hinge)
    var jaw = pivot(torso, 0, 0.6, 0.12), J = new Builder();
    J.add(G.sph(1, 24, 14), belly, { p: [0, -0.07, 0.4], s: [0.8, 0.24, 0.62] });
    J.add(G.sph(1, 16, 10), mouthC, { p: [0, 0.1, 0.44], s: [0.64, 0.08, 0.5] });
    J.glow(G.sph(1, 12, 8), '#5aa82a', { p: [0, 0.135, 0.34], s: [0.32, 0.05, 0.3] });
    [-1, 1].forEach(function (sx) { J.add(G.cone(king ? 0.07 : 0.055, king ? 0.34 : 0.26, 7), bone, { p: [sx * 0.42, 0.2, 0.84], r: [0.25, 0, -sx * 0.22] }); });
    fangRow(J, [0, 0.11, 0.98], 0.28, 6, 0.075, 0.02, bone, false, { back: 0.14 });
    jaw.add(J.build());
    var staff = null;
    if (king) {
      staff = pivot(torso, -0.88, 0.0, 0.72);
      var S = new Builder();
      S.add(hornGeo([[0, 0, 0], [-0.05, 0.6, 0.02], [0.03, 1.2, -0.03], [-0.04, 1.75, 0.0]], 0.05, 0.035, 0, 10, 6), '#4a3220');
      S.add(G.tor(0.18, 0.025, 5, 16), '#3a2618', { p: [0, 1.95, 0], r: [0, 0, 0] });
      S.add(G.tor(0.18, 0.025, 5, 16), '#3a2618', { p: [0, 1.95, 0], r: [0, PI / 2, 0] });
      S.glow(G.sph(0.12, 14, 10), sick, { p: [0, 1.95, 0] });
      for (var h = 0; h < 4; h++) S.add(G.cone(0.03, 0.22, 5), bone, { p: [Math.sin(h * PI / 2) * 0.16, 2.12, Math.cos(h * PI / 2) * 0.16], r: [Math.cos(h * PI / 2) * 0.4, 0, -Math.sin(h * PI / 2) * 0.4] });
      staff.add(S.build());
      var lh = halo(sick, 0.75, 0.8); lh.position.set(0, 1.95, 0); staff.add(lh);
    }
    // (king: smaller, warmer eye glows; at 2x scale the yellow halos under the gold crown bloomed into one blob)
    eyeHalos(root, torso, [[-0.41, 1.17, 0.64], [0.41, 1.17, 0.64]], king ? C('#ffb02a') : eyeC, king ? 0.26 : 0.46);
    root.userData.aura = king
      ? { r: 1.0, h: 1.3, y0: 0.05, size: 0.62, smoke: 18, smokeAlpha: 0.5, smokeColor: '#16200c', smokeColor2: '#24123a', embers: 16, emberColor: sick, emberSize: 0.06, pool: 1.3, poolColor: '#0c1408', life: 3.0, emberLife: 2.0 }
      : { r: 0.95, h: 1.0, y0: 0.05, size: 0.55, smoke: 12, smokeAlpha: 0.45, smokeColor: '#18220e', embers: 10, emberColor: sick, emberSize: 0.06, pool: 1.15, poolColor: '#0c1408', life: 2.6, emberLife: 1.8 };
    root.userData.skinOpts = { rim: king ? '#b8ff6a' : '#a8ff5a', rimStrength: 0.42 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, br2 = Math.sin(t * 2.6);
      torso.position.set(0, 0, 0); torso.rotation.set(0.05 * d, 0, 0);
      torso.scale.set(1 + br2 * 0.025, 1 + br2 * 0.045 - 0.04 * d, 1 + br2 * 0.025);
      var sn = pulse(t, 3.7, 0.75);
      var jo = 0.04 + 0.1 * d + sn * 0.24 + Math.max(0, br2) * 0.03;
      torso.rotation.z = Math.sin(t * 36) * 0.025 * sn;
      if (state === 'walk') {
        var ph = (t * 2.0) % 1, hop = Math.sin(ph * PI);
        body.position.y = hop * (king ? 0.22 : 0.3);
        torso.scale.set(1 + (1 - hop) * 0.09, 1 - (1 - hop) * 0.11 + hop * 0.05, 1);
        torso.rotation.x = (hop - 0.5) * -0.22; jo = 0.08;
      }
      if (e.wind) { torso.rotation.x -= 0.32 * e.wind; jo += 0.35 * e.wind; torso.scale.multiplyScalar(1 + 0.07 * e.wind); }
      if (e.lunge) { torso.rotation.x += 0.22 * e.lunge; jo += 0.5 * e.lunge; }
      if (e.taunt) { torso.rotation.x -= 0.45 * e.taunt; jo += 0.7 * e.roar; torso.scale.multiplyScalar(1 + 0.09 * e.taunt); torso.rotation.z += Math.sin(k * 30) * 0.04 * e.taunt; }
      if (e.hit) jo += 0.25 * e.hit;
      if (e.fall) { torso.scale.y *= 1 - 0.35 * e.fall; torso.rotation.z += 0.35 * e.fall; jo = jo * (1 - e.fall) + 0.42 * e.fall; }
      jaw.rotation.set(Math.min(0.8, jo), 0, 0);
      if (staff) {
        staff.rotation.set(Math.sin(t * 1.3) * 0.03, 0, -0.05 + Math.sin(t * 0.9) * 0.03);
        if (e.wind || e.lunge || e.taunt) { staff.rotation.z -= 0.45 * e.wind + 0.3 * e.lunge + 0.5 * e.taunt; staff.rotation.x -= 0.5 * e.lunge; }
        if (e.fall) staff.rotation.z += 0.9 * e.fall;
      }
    }, { hitScale: king ? 0.5 : 1, lungeScale: king ? 0.6 : 1, sink: 0.05, fallX: -0.15 });
    return root;
  }
  E.toad = function (c, o) { return toadModel(c, false, o); };
  E.bogking = function (c, o) { var m = toadModel(c, true, o); m.children[0].scale.setScalar(2.05); return m; };

  // ---------------- Gloom Imp ----------------
  E.imp = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#8a3a6a'), skin = dk(c, 0.22), dark = dk(c, 0.8), belly = mix(skin, '#ffb08a', 0.16), horn = C('#1e1018');
    var eyeC = C(EL ? BURN : '#ffd23a'), green = C(HOLLOW_GREEN), gold = C(ELITE_GOLD), tooth = C('#f4ecd8'), metal = C(EL ? ELITE_GOLD : '#8a8a9a');
    var b = base(), root = b.root, body = b.body;
    function leg(sx) {
      var p = pivot(body, sx * 0.14, 0.62, 0), L = new Builder();
      L.add(G.cyl(0.09, 0.07, 0.32, 9), skin, { p: [0, -0.14, 0.06], r: [-0.42, 0, 0] });
      L.add(G.sph(0.07, 8, 6), skin, { p: [0, -0.28, 0.12] });
      L.add(G.cyl(0.062, 0.045, 0.3, 8), skin, { p: [0, -0.41, 0.05], r: [0.55, 0, 0] });
      L.add(G.cyl(0.045, 0.06, 0.1, 8), dark, { p: [0, -0.57, -0.01] });
      for (var j = -1; j <= 1; j += 2) L.add(clawGeo(0.1, 0.03), horn, { p: [j * 0.028, -0.58, 0.02], r: [0, j * 0.15, 0] });
      p.add(L.build()); return p;
    }
    var legL = leg(1), legR = leg(-1);
    var torso = pivot(body, 0, 0.6, 0);
    var B = new Builder();
    B.add(G.sph(0.27, 18, 14), skin, { p: [0, 0.26, 0], s: [1, 1.15, 0.85] });
    B.add(G.sph(0.19, 14, 10), belly, { p: [0, 0.18, 0.1], s: [1, 1.1, 0.8] });
    B.add(skirtGeo(0.19, 0.24, 0.24, 12, 0.09, 5), dark, { p: [0, -0.16, 0] });
    B.add(G.tor(0.2, 0.03, 5, 16), '#3a2418', { p: [0, 0.07, 0], r: [PI / 2, 0, 0] });
    B.add(G.tor(0.15, 0.028, 5, 16), dark, { p: [0, 0.55, 0], r: [PI / 2, 0, 0] });
    for (var i = 0; i < 6; i++) { var a = (i / 5 - 0.5) * 2.4; B.add(G.cone(0.025, 0.09, 4), metal, { p: [Math.sin(a) * 0.16, 0.56, Math.cos(a) * 0.16], r: [Math.cos(a) * 1.3, 0, -Math.sin(a) * 1.3] }); }
    glyph(B, 'tri', [0, 0.2, 0.245], [0, 0.05, 1], 0.15, green);
    spikesOn(B, [0, 0.26, 0], [0.27, 0.31, 0.23], [[0, 0.7, -0.7], [0, 0.35, -1], [0, 0, -1], [0, -0.35, -1]], 0.11, 0.04, dark, { vary: true, bias: [0, 0.3, 0] });
    torso.add(B.build());
    var head = pivot(torso, 0, 0.64, 0.03);
    var H = new Builder();
    H.add(G.sph(0.3, 20, 16), skin, { s: [1, 0.95, 0.95] });
    H.add(G.cone(0.13, 0.22, 10), skin, { p: [0, -0.24, 0.1], r: [PI - 0.35, 0, 0] });
    H.add(G.cone(0.04, 0.12, 6), sh(skin, -0.1), { p: [0, -0.0, 0.31], r: [PI / 2 + 0.6, 0, 0] });
    [-1, 1].forEach(function (sx) {
      H.add(G.cone(0.1, 0.46, 7), skin, { p: [sx * 0.34, 0.07, -0.03], r: [-0.25, 0, -sx * 1.22] });
      H.add(hornGeo([[sx * 0.11, 0.2, 0.04], [sx * 0.24, 0.36, -0.05], [sx * 0.31, 0.53, -0.2], [sx * 0.27, 0.68, -0.35], [sx * 0.18, 0.73, -0.44]], 0.072, 0.004, 4, 14, 7), horn);
      H.add(G.sph(0.08, 8, 6), sh(skin, 0.05), { p: [sx * 0.17, -0.06, 0.2], s: [1, 0.7, 0.8] });
      angryEye(H, [sx * 0.12, 0.055, 0.255], sx, eyeC, 0.078, {});
      brow(H, [sx * 0.12, 0.135, 0.268], sx, 0.18, dark, { ang: 0.55 });
      if (EL) {
        H.add(hornGeo([[sx * 0.07, 0.24, 0.12], [sx * 0.1, 0.36, 0.2], [sx * 0.08, 0.44, 0.3]], 0.04, 0.003, 2, 8, 6), horn);
        H.add(G.tor(0.062, 0.02, 4, 12), gold, { p: [sx * 0.25, 0.38, -0.08], r: [0.6, 0, -sx * 0.7] });
      }
    });
    // wicked grin: dark crescent, top fangs, two big canines
    H.add(G.tor(0.14, 0.042, 5, 18, PI), '#1a0610', { p: [0, -0.08, 0.255], r: [0.2, 0, PI], s: [1, 0.58, 1] });
    for (var t2 = 0; t2 < 7; t2++) {
      var a2 = PI + 0.42 + t2 * (PI - 0.84) / 6, x2 = Math.cos(a2) * 0.135, y2 = -0.08 + Math.sin(a2) * 0.078;
      H.add(G.cone(0.014, 0.045, 4), tooth, { p: [x2, y2 + 0.03, 0.29], r: [PI + 0.2, 0, Math.cos(a2) * 0.4] });
    }
    [-1, 1].forEach(function (sx) { H.add(G.cone(0.022, 0.085, 5), tooth, { p: [sx * 0.1, -0.1, 0.27], r: [PI, 0, sx * 0.15] }); });
    head.add(H.build());
    function arm(sx) {
      var p = pivot(torso, sx * 0.3, 0.42, 0), A = new Builder();
      A.add(G.sph(0.07, 8, 6), skin);
      A.add(G.cyl(0.055, 0.045, 0.28, 8), skin, { p: [0, -0.14, 0] });
      A.add(G.cyl(0.045, 0.038, 0.26, 8), skin, { p: [0, -0.39, 0.03], r: [-0.2, 0, 0] });
      A.add(G.cone(0.03, 0.12, 5), dark, { p: [sx * 0.04, -0.3, -0.04], r: [0.6, 0, -sx * 1.0] });
      A.add(G.sph(0.055, 8, 6), skin, { p: [0, -0.53, 0.05] });
      for (var j = -1; j <= 1; j++) A.add(clawGeo(0.1, 0.015), horn, { p: [j * 0.025, -0.56, 0.07], r: [-0.2, j * 0.3, 0] });
      p.add(A.build()); return p;
    }
    var armL = arm(1), armR = arm(-1);
    var fork = pivot(armR, 0, -0.53, 0.06);
    var F = new Builder();
    F.add(G.cyl(0.022, 0.024, 1.5, 7), '#2e1c14', { p: [0, 0.3, 0] });
    for (var r = 0; r < 3; r++) F.glow(G.tor(0.03, 0.009, 4, 10), green, { p: [0, 0.55 + r * 0.14, 0], r: [PI / 2, 0, 0] });
    F.add(G.box(0.3, 0.04, 0.04), metal, { p: [0, 1.05, 0], flat: true });
    F.add(G.cone(0.035, 0.32, 5), metal, { p: [0, 1.22, 0], flat: true });
    [-1, 1].forEach(function (sx) {
      F.add(hornGeo([[sx * 0.15, 1.04, 0], [sx * 0.2, 1.16, 0], [sx * 0.17, 1.32, 0]], 0.03, 0.003, 0, 8, 5), metal);
      F.add(G.cone(0.02, 0.08, 4), metal, { p: [sx * 0.13, 1.25, 0], r: [0, 0, -sx * 2.4] });
    });
    F.add(G.cone(0.03, 0.12, 5), metal, { p: [0, -0.48, 0], r: [PI, 0, 0], flat: true });
    F.glow(G.oct(0.045), green, { p: [0, 1.12, 0], s: [1, 1.5, 1] });
    fork.add(F.build());
    var fh = halo(green, 0.4, 0.8); fh.position.set(0, 1.12, 0); fork.add(fh);
    var tail = pivot(torso, 0, 0.1, -0.2);
    var TB = new Builder();
    TB.add(hornGeo([[0, 0, 0], [0, -0.12, -0.3], [0.05, 0.12, -0.58], [0, 0.45, -0.55]], 0.05, 0.016, 0, 14, 6), skin);
    TB.add(G.oct(0.09), dark, { p: [0, 0.52, -0.52], s: [1, 1.5, 0.3], flat: true });
    [-1, 1].forEach(function (sx) { TB.add(G.cone(0.03, 0.12, 4), dark, { p: [sx * 0.07, 0.44, -0.53], r: [0, 0, sx * 2.5], flat: true }); });
    tail.add(TB.build());
    var wingC = dk(c, 0.55);
    function wing(sx) {
      var p = pivot(torso, sx * 0.12, 0.4, -0.18);
      var tips = [[0.16, 0.5], [0.5, 0.46], [0.66, 0.14], [0.54, -0.12], [0.28, -0.22]];
      var m = new T.Mesh(membraneGeo(tips, 0.38), M.toon(wingC, { side: T.DoubleSide })); m.castShadow = true; p.add(m);
      var WB = new Builder();
      tips.forEach(function (tp, i) { WB.add(hornGeo([[0, 0, 0], [tp[0] * 0.55, tp[1] * 0.55 + 0.04, 0.01], [tp[0], tp[1], 0]], i === 0 ? 0.03 : 0.018, 0.005, 0, 6, 4), dark); });
      WB.add(clawGeo(0.08, 0.016), horn, { p: [0.16, 0.5, 0], r: [-PI / 2, 0, 0] });
      p.add(WB.build());
      if (sx < 0) p.scale.x = -1;
      return p;
    }
    var wL = wing(1), wR = wing(-1);
    eyeHalos(root, head, [[-0.12, 0.055, 0.29], [0.12, 0.055, 0.29]], eyeC, 0.27);
    root.userData.aura = { r: 0.5, h: 1.3, y0: 0.0, size: 0.42, smoke: 10, smokeAlpha: 0.42, smokeColor: dk(c, 0.75), embers: 10, emberColor: '#ff8a3a', emberColors: ['#ff8a3a', eyeC], emberSize: 0.06, pool: 0.75, life: 2.4, emberLife: 1.5 };
    root.userData.skinOpts = { rim: '#ff6a8a', rimStrength: 0.42 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk';
      var ck = pulse(t, 4.6, 0.9) * (1 - d * 0.6);
      legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
      armL.rotation.set(0, 0, 0.35); armR.rotation.set(-0.25, 0, -0.3);
      fork.rotation.set(0.25, 0, 0.3); head.rotation.set(0.05, 0, 0); torso.rotation.set(0.12 + 0.12 * d, 0, 0);
      tail.rotation.set(Math.sin(t * 2.6) * 0.2, Math.sin(t * 2.2) * 0.5, 0);
      var w = 0.45 + 0.25 * Math.sin(t * (walk ? 14 : 3 + 6 * d)) + 0.3 * d;
      wL.rotation.set(0, w, 0); wR.rotation.set(0, -w, 0);
      if (walk) {
        var s = t * 8.5;
        body.position.y = Math.abs(Math.sin(s)) * 0.09;
        legL.rotation.x = Math.sin(s) * 0.6; legR.rotation.x = -Math.sin(s) * 0.6;
        armL.rotation.x = -Math.sin(s) * 0.5; torso.rotation.x = 0.28; torso.rotation.y = Math.sin(s) * 0.1;
        head.rotation.x = -0.15;
      } else {
        body.position.y = -0.06 * d + Math.sin(t * 2.4) * 0.01;
        legL.rotation.x = legR.rotation.x = 0.25 * d;
        head.rotation.z = Math.sin(t * 1.6) * 0.1 * (1 - d) + Math.sin(t * 46) * 0.05 * ck;
        head.rotation.x = 0.05 - ck * 0.25 + 0.1 * d;
        torso.rotation.z = Math.sin(t * 1.1) * 0.04;
        armR.rotation.x = -0.25 - 0.75 * d + Math.sin(t * 2) * 0.05; fork.rotation.x = 0.25 + 0.55 * d;
        armL.rotation.z = 0.35 + 0.3 * d; armL.rotation.x = -0.3 * d + Math.sin(t * 4.3) * 0.1;
      }
      if (e.wind) { armR.rotation.x -= 2.2 * e.wind; fork.rotation.x += 0.4 * e.wind; torso.rotation.x -= 0.35 * e.wind; torso.rotation.y += 0.4 * e.wind; head.rotation.x -= 0.2 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 0.9 * e.lunge; fork.rotation.x += 0.9 * e.lunge; torso.rotation.x += 0.3 * e.lunge; torso.rotation.y -= 0.2 * e.lunge; legR.rotation.x -= 0.4 * e.lunge; }
      if (e.taunt) {
        armR.rotation.x -= 2.4 * e.taunt; armL.rotation.z += 1.0 * e.taunt; armL.rotation.x -= 0.4 * e.taunt;
        head.rotation.x -= 0.5 * e.taunt; head.rotation.z += Math.sin(k * 44) * 0.07 * e.taunt; torso.rotation.x -= 0.3 * e.taunt;
        wL.rotation.y = 0.05 + (1 - e.taunt) * w; wR.rotation.y = -wL.rotation.y;
      }
      if (e.hit) { armL.rotation.z += 0.5 * e.hit; armR.rotation.z -= 0.5 * e.hit; head.rotation.x -= 0.3 * e.hit; }
      if (e.fall) {
        legL.rotation.x = -0.9 * e.fall; legR.rotation.x = -0.5 * e.fall; armL.rotation.z += 0.9 * e.fall; armR.rotation.z -= 0.6 * e.fall;
        head.rotation.x += 0.5 * e.fall; wL.rotation.y = wR.rotation.y = 0; body.position.y -= 0.32 * e.fall;
      }
    }, { fallX: -0.7, sink: 0.05 });
    return root;
  };

  // ---------------- Hollow Wolf ----------------
  E.wolf = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#3d3158'), fur = dk(c, 0.36), dark = dk(c, 0.72), lite = sh(fur, 0.14), tip = mix(c, '#b18cff', 0.55);
    var eyeC = C(EL ? BURN : HOLLOW_GREEN), green = C(HOLLOW_GREEN), violet = C(HOLLOW_VIOLET), tooth = C('#f2ecdc'), gold = C(ELITE_GOLD);
    var b = base(), root = b.root, body = b.body;
    var torso = pivot(body);
    var B = new Builder();
    B.add(G.sph(0.5, 16, 12), fur, { p: [0, 1.02, 0.35], s: [0.8, 0.8, 0.95], flat: true });
    B.add(G.sph(0.4, 14, 10), fur, { p: [0, 0.94, -0.28], s: [0.62, 0.62, 1.1], flat: true });
    B.add(G.sph(0.38, 14, 10), fur, { p: [0, 0.92, -0.66], s: [0.75, 0.74, 0.78], flat: true });
    B.add(G.sph(0.36, 12, 10), lite, { p: [0, 0.84, 0.62], s: [0.8, 0.9, 0.7], flat: true });
    B.add(G.cyl(0.2, 0.28, 0.42, 10), fur, { p: [0, 1.12, 0.68], r: [0.9, 0, 0], flat: true });
    // spine ridge
    for (var i = 0; i < 9; i++) {
      var z = 0.1 - i * 0.12;
      B.add(G.cone(0.06, 0.24 - i * 0.015, 4), i % 3 === 0 ? tip : dark, { p: [0, 1.28 - i * 0.02 - (i > 5 ? (i - 5) * 0.03 : 0), z], r: [-0.75, 0, 0], flat: true });
    }
    // Hollow brand veins along the flanks
    [-1, 1].forEach(function (sx) {
      vein(B, [[sx * 0.33, 1.06, 0.32], [sx * 0.38, 0.96, 0.12], [sx * 0.3, 1.02, -0.1], [sx * 0.29, 0.92, -0.32], [sx * 0.33, 0.98, -0.55]], 0.022, green);
      vein(B, [[sx * 0.36, 0.86, 0.36], [sx * 0.33, 0.78, 0.2]], 0.016, green);
    });
    if (EL) spikesOn(B, [0, 0.94, -0.28], [0.25, 0.25, 0.44], [[0.6, 0.8, 0.2], [-0.6, 0.8, 0.2], [0.6, 0.8, -0.4], [-0.6, 0.8, -0.4]], 0.17, 0.045, dark, { tips: gold });
    torso.add(B.build());
    // bristling mane (own pivot so hackles can rise)
    var mane = pivot(torso, 0, 1.08, 0.42), MB = new Builder();
    var mdirs = [];
    for (var q = 0; q < 15; q++) { var a = -1.35 + q * 2.7 / 14; mdirs.push([Math.sin(a), Math.cos(a) * 0.95 + 0.15, -0.35 - Math.abs(Math.sin(a)) * 0.2]); }
    spikesOn(MB, [0, 0, 0], [0.4, 0.38, 0.32], mdirs, 0.36, 0.1, fur, { vary: true, tips: violet, tipEvery: 2 });
    var mdirs2 = [];
    for (var q2 = 0; q2 < 10; q2++) { var a2 = -1.2 + q2 * 2.4 / 9; mdirs2.push([Math.sin(a2) * 1.1, Math.cos(a2) * 0.8 + 0.25, -0.75]); }
    spikesOn(MB, [0, 0.02, -0.15], [0.36, 0.36, 0.3], mdirs2, 0.3, 0.09, dark, { vary: true });
    [-1, 1].forEach(function (sx) { MB.add(G.cone(0.08, 0.3, 4), fur, { p: [sx * 0.3, -0.18, 0.2], r: [0.3, 0, sx * 2.1], flat: true }); });
    if (EL) {
      MB.add(G.tor(0.36, 0.045, 5, 18), gold, { p: [0, -0.06, 0.18], r: [PI / 2 - 0.5, 0, 0] });
      for (var g = 0; g < 7; g++) { var ga = -1.5 + g * 0.5; MB.add(G.cone(0.03, 0.12, 5), gold, { p: [Math.sin(ga) * 0.38, -0.06 + Math.cos(ga) * 0.18, 0.18 + Math.cos(ga) * 0.2], dir: [Math.sin(ga), Math.cos(ga) * 0.5, 0.5] }); }
    }
    mane.add(MB.build());
    var head = pivot(torso, 0, 1.3, 0.88); head.scale.setScalar(1.18);
    var H = new Builder();
    H.add(G.sph(0.25, 14, 12), fur, { s: [0.95, 0.85, 1.1], flat: true });
    H.add(G.cyl(0.09, 0.16, 0.46, 9), lite, { p: [0, -0.06, 0.32], r: [PI / 2 + 0.1, 0, 0], flat: true });
    H.add(G.box(0.12, 0.06, 0.34), fur, { p: [0, 0.03, 0.3], r: [0.12, 0, 0], flat: true });
    H.add(G.sph(0.045, 8, 6), '#0e0a14', { p: [0, -0.02, 0.56], s: [1.2, 0.8, 0.8] });
    H.add(G.box(0.17, 0.05, 0.3), '#2a0e1a', { p: [0, -0.13, 0.3] });
    fangRow(H, [0, -0.13, 0.43], 0.065, 4, 0.06, 0.016, tooth, true, { back: 0.12 });
    [-1, 1].forEach(function (sx) {
      H.add(G.cone(0.03, 0.13, 5), tooth, { p: [sx * 0.075, -0.18, 0.38], r: [PI, 0, sx * 0.1] });
      H.add(G.cone(0.09, 0.36, 5), fur, { p: [sx * 0.14, 0.2, -0.1], r: [-0.95, 0, -sx * 0.3], flat: true });
      H.add(G.cone(0.08, 0.28, 4), lite, { p: [sx * 0.2, -0.08, 0.0], r: [-1.6, 0, -sx * 0.7], flat: true });
      angryEye(H, [sx * 0.11, 0.055, 0.2], sx, eyeC, 0.062, { tilt: 0.5, yaw: 0.35, squint: 0.5 });
      brow(H, [sx * 0.11, 0.115, 0.22], sx, 0.16, dark, { ang: 0.55, rx: 0.5 });
      // snarl wrinkles
      H.add(G.box(0.08, 0.018, 0.03), dark, { p: [sx * 0.07, 0.04, 0.42], r: [0.3, 0, sx * 0.4] });
      if (EL) H.add(hornGeo([[sx * 0.1, 0.17, 0.0], [sx * 0.2, 0.3, -0.05], [sx * 0.25, 0.38, 0.08], [sx * 0.2, 0.4, 0.22]], 0.045, 0.003, 3, 10, 6), '#1a0d22');
    });
    head.add(H.build());
    var jaw = pivot(head, 0, -0.13, 0.08), J = new Builder();
    J.add(G.cyl(0.065, 0.1, 0.36, 8), fur, { p: [0, -0.03, 0.18], r: [PI / 2, 0, 0], flat: true });
    J.add(G.box(0.12, 0.03, 0.28), '#2a0e1a', { p: [0, 0.035, 0.18] });
    J.glow(G.box(0.07, 0.02, 0.2), '#3f8a22', { p: [0, 0.045, 0.14] });
    [-1, 1].forEach(function (sx) { J.add(G.cone(0.024, 0.1, 5), tooth, { p: [sx * 0.055, 0.07, 0.33], r: [0, 0, -sx * 0.1] }); });
    fangRow(J, [0, 0.04, 0.3], 0.04, 3, 0.04, 0.012, tooth, false, {});
    jaw.add(J.build());
    var legs = [];
    [[1, 0.45, 1], [-1, 0.45, 1], [1, -0.62, 0], [-1, -0.62, 0]].forEach(function (lp) {
      var p = pivot(torso, lp[0] * 0.22, lp[2] ? 0.98 : 0.95, lp[1]), L = new Builder();
      if (lp[2]) {
        L.add(G.cyl(0.12, 0.08, 0.5, 8), lite, { p: [0, -0.25, 0], flat: true });
        L.add(G.cyl(0.075, 0.06, 0.42, 7), fur, { p: [0, -0.66, -0.02], flat: true });
      } else {
        L.add(G.cyl(0.15, 0.09, 0.44, 8), fur, { p: [0, -0.18, 0.06], r: [-0.42, 0, 0], flat: true });
        L.add(G.cyl(0.075, 0.06, 0.42, 7), fur, { p: [0, -0.56, -0.04], r: [0.38, 0, 0], flat: true });
      }
      L.add(G.sph(0.1, 8, 6), dark, { p: [0, -0.9, 0.04], s: [1, 0.55, 1.35] });
      for (var j = -1; j <= 1; j++) L.add(clawGeo(0.08, 0.018), '#1a1020', { p: [j * 0.04, -0.9, 0.14], r: [0, j * 0.2, 0] });
      p.add(L.build()); legs.push(p);
    });
    var tail = pivot(torso, 0, 1.0, -0.95);
    var TB = new Builder();
    TB.add(G.cone(0.15, 0.8, 7), fur, { p: [0, 0.18, -0.3], r: [-1.05, 0, 0], flat: true });
    [[0.1, 0.12, -0.25], [-0.1, 0.18, -0.35], [0.06, 0.3, -0.5], [-0.07, 0.05, -0.12]].forEach(function (p, n) {
      TB.add(G.cone(0.06, 0.3, 4), n % 2 ? dark : fur, { p: p, r: [-1.2, 0, p[0] * 6], flat: true });
    });
    TB.add(G.cone(0.08, 0.28, 5), tip, { p: [0, 0.38, -0.62], r: [-1.05, 0, 0], flat: true });
    TB.glow(G.cone(0.03, 0.12, 4), violet, { p: [0, 0.48, -0.78], r: [-1.05, 0, 0] });
    tail.add(TB.build());
    eyeHalos(root, head, [[-0.11, 0.055, 0.24], [0.11, 0.055, 0.24]], eyeC, 0.22);
    root.userData.aura = { r: 0.75, h: 1.1, y0: 0.0, size: 0.5, smoke: 12, smokeAlpha: 0.45, smokeColor: dk(c, 0.7), embers: 10, emberColor: green, emberSize: 0.06, pool: 1.0, life: 2.6, emberLife: 1.6 };
    root.userData.skinOpts = { rim: '#9a6aff', rimStrength: 0.5 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk';
      var gr = pulse(t, 3.4, 0.8);
      head.rotation.set(0.18 + 0.12 * d, Math.sin(t * 0.8) * 0.2 * (1 - d), 0); tail.rotation.set(-0.2 * d, Math.sin(t * 2.4) * 0.25, 0);
      torso.rotation.set(0, 0, 0); torso.position.set(0, 0, 0);
      legs.forEach(function (l) { l.rotation.set(0, 0, 0); });
      var jo = 0.05 + 0.12 * d + gr * 0.22 + (d > 0.5 ? pulse(t, 1.6, 0.25) * 0.25 : 0);
      var br = Math.sin(t * 2.8);
      mane.scale.setScalar(1 + 0.06 * gr + 0.05 * d + br * 0.01);
      mane.rotation.set(Math.sin(t * 40) * 0.03 * gr, 0, 0);
      torso.scale.set(1 + br * 0.02, 1 + br * 0.02, 1);
      if (walk) {
        var s = t * 8.5, sw = Math.sin(s);
        legs[0].rotation.x = sw * 0.65; legs[3].rotation.x = sw * 0.65; legs[1].rotation.x = -sw * 0.65; legs[2].rotation.x = -sw * 0.65;
        body.position.y = Math.abs(Math.cos(s)) * 0.05 - 0.04;
        torso.rotation.z = sw * 0.05; head.rotation.x = 0.3 + Math.sin(s * 2) * 0.04; head.rotation.y = 0;
        tail.rotation.y = sw * 0.35; jo = 0.08;
      } else {
        body.position.y = -0.1 * d;
        legs[0].rotation.set(-0.1 * d, 0, 0.12 * d); legs[1].rotation.set(-0.1 * d, 0, -0.12 * d);
        legs[2].rotation.x = 0.15 * d; legs[3].rotation.x = 0.15 * d;
        torso.rotation.x = 0.06 * d;
      }
      if (e.wind) { body.position.y -= 0.14 * e.wind; torso.rotation.x += 0.08 * e.wind; head.rotation.x += 0.15 * e.wind; legs[0].rotation.x += 0.3 * e.wind; legs[1].rotation.x += 0.3 * e.wind; legs[2].rotation.x += 0.35 * e.wind; legs[3].rotation.x += 0.35 * e.wind; jo += 0.15 * e.wind; }
      if (e.lunge) { body.position.y += 0.18 * e.lunge; legs[0].rotation.x -= 1.0 * e.lunge; legs[1].rotation.x -= 1.0 * e.lunge; legs[2].rotation.x += 0.5 * e.lunge; legs[3].rotation.x += 0.5 * e.lunge; head.rotation.x -= 0.2 * e.lunge; jo += 0.55 * e.lunge; }
      if (e.taunt) { head.rotation.x -= 1.15 * e.taunt; head.rotation.y = 0; torso.rotation.x -= 0.22 * e.taunt; jo += 0.55 * e.roar; mane.scale.multiplyScalar(1 + 0.15 * e.taunt); legs[0].rotation.x -= 0.25 * e.taunt; legs[1].rotation.x -= 0.25 * e.taunt; }
      if (e.hit) { jo += 0.2 * e.hit; head.rotation.x -= 0.3 * e.hit; }
      if (e.fall) {
        body.rotation.z += 1.2 * e.fall; body.position.y -= 0.05 * e.fall; body.position.x += 0.72 * e.fall;
        legs.forEach(function (l, n) { l.rotation.x = (n % 2 ? 0.4 : -0.3) * e.fall; l.rotation.z = -0.3 * e.fall; });
        head.rotation.x = head.rotation.x * (1 - e.fall) + 0.3 * e.fall; jo = jo * (1 - e.fall) + 0.35 * e.fall;
      }
      jaw.rotation.set(Math.min(0.75, jo), 0, 0);
    }, { customFall: true, lungeScale: 1.4 });
    return root;
  };

  // ---------------- Bramble Ghoul ----------------
  E.ghoul = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#5d6b3a'), moss = dk(c, 0.32), mossL = sh(moss, 0.1), bark = C('#3e2c20'), barkD = C('#281a12'), thorn = C('#2a1626');
    var eyeC = C(EL ? BURN : '#c4ff4a'), sap = C(HOLLOW_GREEN), bone = C('#e6dcc0'), gold = C(ELITE_GOLD), vine = C('#2f4a20');
    var b = base(), root = b.root, body = b.body;
    function leg(sx) {
      var p = pivot(body, sx * 0.26, 0.68, 0), L = new Builder();
      L.add(G.cyl(0.14, 0.11, 0.42, 7), bark, { p: [0, -0.15, 0.06], r: [-0.35, 0, 0], flat: true });
      L.add(G.sph(0.12, 7, 6), barkD, { p: [0, -0.32, 0.12], flat: true });
      L.add(G.cyl(0.11, 0.13, 0.4, 7), bark, { p: [0, -0.47, 0.05], r: [0.3, 0, 0], flat: true });
      L.add(G.box(0.22, 0.09, 0.3), barkD, { p: [0, -0.64, 0.1], flat: true });
      for (var j = -1; j <= 1; j++) L.add(clawGeo(0.14, 0.03), bone, { p: [j * 0.07, -0.62, 0.24], r: [0, j * 0.25, 0] });
      p.add(L.build()); return p;
    }
    var legL = leg(1), legR = leg(-1);
    var torso = pivot(body, 0, 0.78, 0);
    var B = new Builder();
    var tc = [0, 0.45, 0], tr = [0.58, 0.62, 0.5];
    B.add(G.sph(1, 16, 12), moss, { p: tc, s: tr, flat: true });
    // bark armour plates + chest crack with glowing sap
    [[0, 0.25, 0.4, 0.42, 0.3], [0.26, 0.5, 0.36, 0.26, 0.24], [-0.26, 0.52, 0.36, 0.26, 0.24], [0.4, 0.2, 0.25, 0.22, 0.3], [-0.4, 0.22, 0.25, 0.22, 0.3]].forEach(function (pl) {
      var d = [pl[0], pl[1] - 0.45, pl[2]];
      B.add(G.box(pl[3], pl[4], 0.08), bark, { p: onEll(tc, tr, d), dir: [d[0] * 0.3, 0.2, 1], s: [1, 1, 1], flat: true });
    });
    vein(B, [[0, 0.08, 0.47], [0.05, 0.28, 0.5], [-0.04, 0.45, 0.5], [0.06, 0.62, 0.46], [0.0, 0.8, 0.38]], 0.028, sap);
    vein(B, [[0.05, 0.4, 0.5], [0.22, 0.45, 0.45], [0.36, 0.38, 0.36]], 0.018, sap);
    vein(B, [[-0.04, 0.3, 0.5], [-0.22, 0.25, 0.46], [-0.38, 0.32, 0.34]], 0.018, sap);
    B.add(G.tor(0.5, 0.045, 4, 14), vine, { p: [0, 0.5, 0], r: [PI / 2 + 0.3, 0.2, 0] });
    B.add(G.tor(0.54, 0.04, 4, 14), vine, { p: [0, 0.3, 0], r: [PI / 2 - 0.25, -0.2, 0] });
    var sp = [[0, 1, -0.4], [0.5, 0.8, -0.5], [-0.5, 0.8, -0.5], [0.3, 0.4, -1], [-0.3, 0.4, -1], [0.8, 0.5, 0], [-0.8, 0.5, 0], [0, 0.6, -1], [0.55, 1, 0.1], [-0.55, 1, 0.1], [0.2, 0.1, -1], [-0.25, 0.9, -0.8], [0.25, 1, -0.6], [-0.1, 0.25, -1], [0.75, 0.75, -0.35], [-0.75, 0.75, -0.35]];
    spikesOn(B, tc, tr, sp, 0.32, 0.065, thorn, { vary: true, tips: EL ? gold : null, tipEvery: 2 });
    B.add(G.sph(0.2, 6, 5), '#4c7a2c', { p: onEll(tc, tr, [0.4, 0.9, -0.3]), s: [1.2, 0.45, 1], flat: true });
    B.add(G.sph(0.17, 6, 5), '#3d6a26', { p: onEll(tc, tr, [-0.6, 0.6, -0.4]), s: [1.1, 0.45, 1], flat: true });
    for (var h = 0; h < 5; h++) B.add(G.cone(0.04, 0.3 + (h % 2) * 0.15, 4), '#3d6a26', { p: [-0.36 + h * 0.18, 0.02, 0.32 - Math.abs(h - 2) * 0.06], r: [PI + 0.25, 0, 0], flat: true });
    torso.add(B.build());
    var head = pivot(torso, 0, 0.62, 0.5);
    var H = new Builder();
    H.add(G.sph(0.28, 12, 10), bark, { s: [1, 0.92, 1.05], flat: true });
    H.add(G.box(0.46, 0.1, 0.16), barkD, { p: [0, 0.1, 0.2], r: [0.35, 0, 0], flat: true });
    [-1, 1].forEach(function (sx) {
      H.add(G.sph(0.085, 8, 6), '#0a0608', { p: [sx * 0.105, 0.03, 0.22], s: [1.2, 0.9, 0.6] });
      angryEye(H, [sx * 0.105, 0.03, 0.245], sx, eyeC, 0.05, { tilt: 0.45, socket: '#0a0608', squint: 0.6 });
      brow(H, [sx * 0.11, 0.1, 0.25], sx, 0.17, barkD, { ang: 0.5 });
      // branch antlers
      H.add(hornGeo([[sx * 0.15, 0.2, -0.02], [sx * 0.3, 0.42, -0.08], [sx * 0.36, 0.62, -0.02], [sx * 0.32, 0.8, 0.08]], 0.05, 0.006, 0, 10, 5), barkD);
      H.add(hornGeo([[sx * 0.3, 0.44, -0.07], [sx * 0.46, 0.52, -0.1], [sx * 0.55, 0.66, -0.06]], 0.028, 0.004, 0, 6, 4), barkD);
      H.add(hornGeo([[sx * 0.35, 0.62, -0.02], [sx * 0.24, 0.74, 0.02], [sx * 0.2, 0.86, 0.06]], 0.022, 0.003, 0, 6, 4), barkD);
      if (EL) {
        H.add(G.tor(0.05, 0.016, 4, 10), gold, { p: [sx * 0.31, 0.46, -0.08], r: [0.4, 0, -sx * 0.5] });
        H.add(hornGeo([[sx * 0.08, 0.24, 0.1], [sx * 0.12, 0.38, 0.2], [sx * 0.08, 0.46, 0.3]], 0.04, 0.003, 2, 8, 5), thorn);
      }
      H.add(G.sph(0.022, 6, 5), '#0a0608', { p: [sx * 0.035, -0.06, 0.28] });
    });
    fangRow(H, [0, -0.12, 0.26], 0.11, 6, 0.08, 0.02, bone, true, { back: 0.05, big: 1.4 });
    H.add(G.box(0.26, 0.05, 0.08), '#0a0608', { p: [0, -0.17, 0.2] });
    head.add(H.build());
    var jaw = pivot(head, 0, -0.14, 0.04), J = new Builder();
    J.add(G.box(0.3, 0.09, 0.24), bark, { p: [0, -0.06, 0.1], flat: true });
    J.add(G.box(0.22, 0.02, 0.18), '#140808', { p: [0, -0.008, 0.1] });
    J.glow(G.box(0.14, 0.015, 0.12), '#5aa82a', { p: [0, 0.0, 0.08] });
    fangRow(J, [0, -0.01, 0.21], 0.1, 5, 0.07, 0.018, bone, false, { back: 0.05, big: 1.3 });
    jaw.add(J.build());
    function arm(sx) {
      var p = pivot(torso, sx * 0.54, 0.6, 0.2), A = new Builder();
      A.add(G.sph(0.14, 7, 6), bark, { flat: true });
      A.add(G.cyl(0.12, 0.09, 0.6, 7), bark, { p: [0, -0.3, 0], flat: true });
      A.add(G.sph(0.1, 7, 6), barkD, { p: [0, -0.6, 0.02], flat: true });
      A.add(G.cyl(0.09, 0.07, 0.6, 7), mossL, { p: [0, -0.85, 0.12], r: [-0.4, 0, 0], flat: true });
      A.add(G.sph(0.09, 7, 6), barkD, { p: [0, -1.12, 0.24], flat: true });
      for (var j = 0; j < 4; j++) A.add(clawGeo(0.3, 0.026), bone, { p: [(j - 1.5) * 0.05, -1.15, 0.28], r: [-0.35, (j - 1.5) * 0.25, 0] });
      A.add(G.cone(0.05, 0.24, 4), thorn, { p: [sx * 0.08, -0.6, -0.06], r: [0.4, 0, -sx * 1.2], flat: true });
      A.add(G.cone(0.04, 0.2, 4), thorn, { p: [sx * 0.1, -0.2, -0.05], r: [0, 0, -sx * 1.3], flat: true });
      p.add(A.build()); return p;
    }
    var armL = arm(1), armR = arm(-1);
    eyeHalos(root, head, [[-0.105, 0.03, 0.28], [0.105, 0.03, 0.28]], eyeC, 0.22);
    root.userData.aura = { r: 0.75, h: 1.4, y0: 0.0, size: 0.5, smoke: 12, smokeAlpha: 0.45, smokeColor: '#16180e', smokeColor2: '#22122a', embers: 10, emberColor: sap, emberSize: 0.06, pool: 1.0, poolColor: '#0c120a', life: 2.8, emberLife: 1.8 };
    root.userData.skinOpts = { rim: '#b6ff6a', rimStrength: 0.42 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, sn = pulse(t, 3.1, 0.45), tw = pulse(t, 2.3, 0.2, 1.1);
      torso.rotation.set(0.5 + 0.1 * d, 0, 0); head.rotation.set(-0.45 - 0.1 * d, Math.sin(t * 0.9) * 0.2 * (1 - d) + tw * 0.25, tw * 0.15);
      armL.rotation.set(-0.7 * d, 0, 0.15); armR.rotation.set(-0.7 * d, 0, -0.15);
      legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
      var jo = 0.05 + 0.15 * d + sn * 0.35;
      if (state === 'walk') {
        var s = t * 6, sw = Math.sin(s);
        body.rotation.z = sw * 0.1; body.position.y = Math.abs(sw) * 0.07;
        legL.rotation.x = sw * 0.5; legR.rotation.x = -sw * 0.5;
        armL.rotation.x = -sw * 0.45 - 0.2; armR.rotation.x = sw * 0.45 - 0.2; head.rotation.x = -0.35;
      } else {
        var br = Math.sin(t * 1.8);
        torso.rotation.x += br * 0.04; torso.scale.set(1 + br * 0.02, 1 + br * 0.03, 1);
        armL.rotation.x += br * 0.08 + Math.sin(t * 7) * 0.03; armR.rotation.x += -br * 0.08 + Math.sin(t * 6.3) * 0.03;
        armL.rotation.z += 0.25 * d; armR.rotation.z -= 0.25 * d;
        body.position.y = -0.08 * d; legL.rotation.x = legR.rotation.x = 0.2 * d;
      }
      if (e.wind) { torso.rotation.x -= 0.55 * e.wind; head.rotation.x -= 0.15 * e.wind; armL.rotation.x -= 2.0 * e.wind; armR.rotation.x -= 2.0 * e.wind; armL.rotation.z += 0.3 * e.wind; armR.rotation.z -= 0.3 * e.wind; jo += 0.3 * e.wind; }
      if (e.lunge) { torso.rotation.x += 0.08 * e.lunge; head.rotation.x -= 0.1 * e.lunge; armL.rotation.x -= 1.5 * e.lunge; armR.rotation.x -= 1.5 * e.lunge; armL.rotation.z -= 0.25 * e.lunge; armR.rotation.z += 0.25 * e.lunge; jo += 0.4 * e.lunge; }
      if (e.taunt) {
        torso.rotation.x -= 0.6 * e.taunt; head.rotation.x -= 0.25 * e.taunt; head.rotation.z += Math.sin(k * 36) * 0.06 * e.taunt;
        armL.rotation.z += 1.2 * e.taunt; armR.rotation.z -= 1.2 * e.taunt; armL.rotation.x -= 0.8 * e.taunt; armR.rotation.x -= 0.8 * e.taunt; jo += 0.6 * e.roar;
      }
      if (e.hit) { jo += 0.2 * e.hit; armL.rotation.z += 0.4 * e.hit; armR.rotation.z -= 0.4 * e.hit; }
      if (e.fall) { legL.rotation.x = 0.8 * e.fall; legR.rotation.x = 0.5 * e.fall; armL.rotation.x = -1.4 * e.fall; armR.rotation.x = -1.2 * e.fall; body.position.y -= 0.35 * e.fall; jo = 0.45 * e.fall; }
      jaw.rotation.set(Math.min(0.75, jo), 0, 0);
    }, { fallX: 0.7, sink: 0.05 });
    return root;
  };

  // ---------------- Thorn Sprout (minion) ----------------
  E.sprout = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#6f8f3a'), bark = C('#4e3626'), barkD = C('#2e1e14'), thorn = C('#2a1424'), leaf = dk(mix(c, '#7a2aa0', 0.6), 0.3), leaf2 = dk(c, 0.35);
    var eyeC = C(EL ? BURN : '#ffd84a'), gold = C(ELITE_GOLD), sap = C(HOLLOW_GREEN);
    var b = base(), root = b.root, body = b.body;
    var trunk = pivot(body);
    var B = new Builder();
    for (var i = 0; i < 5; i++) {
      var a = i * TAU / 5 + 0.3;
      B.add(hornGeo([[Math.sin(a) * 0.08, 0.26, Math.cos(a) * 0.08], [Math.sin(a) * 0.22, 0.14, Math.cos(a) * 0.22], [Math.sin(a) * 0.34, 0.04, Math.cos(a) * 0.34], [Math.sin(a) * 0.42, 0.0, Math.cos(a) * 0.42]], 0.075, 0.008, 0, 8, 5), barkD);
    }
    B.add(gnarlGeo(0.15, 0.24, 0.72, 10, 5, 0.9, 0.12, 4), bark, { p: [0, 0.12, 0], flat: true });
    // carved face: dark recesses, glowing slanted eyes, jagged glowing maw
    [-1, 1].forEach(function (sx) {
      angryEye(B, [sx * 0.085, 0.56, 0.175], sx, eyeC, 0.05, { tilt: 0.55, squint: 0.6, pupil: false, socket: '#0c0608' });
      brow(B, [sx * 0.085, 0.62, 0.19], sx, 0.13, barkD, { ang: 0.6, th: 0.4 });
    });
    B.add(G.sph(1, 10, 6), '#0c0608', { p: [0, 0.43, 0.17], s: [0.11, 0.05, 0.05] });
    for (var m = 0; m < 5; m++) {
      var x = -0.08 + m * 0.04;
      B.glow(G.cone(0.016, 0.045, 3), eyeC, { p: [x, m % 2 ? 0.415 : 0.445, 0.205], r: [m % 2 ? 0 : PI, 0, 0] });
    }
    for (var s2 = 0; s2 < 7; s2++) {
      var a2 = s2 * 1.7;
      B.add(G.cone(0.03, 0.16, 4), thorn, { p: [Math.sin(a2) * 0.2, 0.28 + s2 * 0.07, Math.cos(a2) * 0.2], r: [Math.cos(a2) * 1.3, 0, -Math.sin(a2) * 1.3] });
    }
    vein(B, [[0.12, 0.2, 0.15], [0.09, 0.32, 0.17], [0.13, 0.4, 0.13]], 0.012, sap);
    trunk.add(B.build());
    var crown = pivot(trunk, 0, 0.82, 0);
    var CB = new Builder();
    CB.add(G.ico(0.3, 0), leaf, { p: [0, 0.1, 0], flat: true });
    CB.add(G.ico(0.23, 0), leaf2, { p: [0.21, 0.02, -0.08], flat: true });
    CB.add(G.ico(0.21, 0), sh(leaf, -0.2), { p: [-0.19, 0.06, 0.05], flat: true });
    CB.add(G.ico(0.18, 0), leaf, { p: [0.02, 0.06, -0.24], flat: true });
    spikesOn(CB, [0, 0.1, 0], [0.32, 0.32, 0.32], [[0, 1, 0], [0.7, 0.6, 0], [-0.7, 0.5, 0.3], [0.2, 0.5, 0.8], [-0.2, 0.6, -0.8], [0.5, 0.8, -0.5], [-0.5, 0.85, -0.3], [0.6, 0.3, 0.5]], 0.2, 0.04, thorn, { vary: true });
    CB.glow(G.sph(0.035, 6, 5), sap, { p: [0.24, -0.1, 0.12] });
    CB.glow(G.sph(0.03, 6, 5), sap, { p: [-0.2, -0.08, -0.1] });
    if (EL) {
      for (var g = 0; g < 5; g++) { var ga = g * TAU / 5; CB.add(G.cone(0.035, 0.24, 5), gold, { p: [Math.sin(ga) * 0.2, 0.36, Math.cos(ga) * 0.2], r: [Math.cos(ga) * 0.4, 0, -Math.sin(ga) * 0.4] }); }
      CB.add(G.tor(0.22, 0.025, 4, 16), gold, { p: [0, 0.26, 0], r: [PI / 2, 0, 0] });
    }
    crown.add(CB.build());
    function twig(sx) {
      var p = pivot(trunk, sx * 0.17, 0.52, 0), A = new Builder();
      A.add(hornGeo([[0, 0, 0], [sx * 0.15, -0.04, 0.04], [sx * 0.28, 0.05, 0.08]], 0.04, 0.02, 0, 6, 5), bark);
      for (var j = -1; j <= 1; j++) A.add(hornGeo([[sx * 0.27, 0.05, 0.08], [sx * 0.34, 0.08 + j * 0.04, 0.12], [sx * 0.4, 0.04 + j * 0.06, 0.18]], 0.016, 0.002, 0, 5, 4), thorn);
      p.add(A.build()); return p;
    }
    var tL = twig(1), tR = twig(-1);
    eyeHalos(root, trunk, [[-0.085, 0.56, 0.2], [0.085, 0.56, 0.2]], eyeC, 0.17);
    root.userData.aura = { r: 0.4, h: 0.9, y0: 0.0, size: 0.32, smoke: 8, smokeAlpha: 0.4, smokeColor: '#16180e', embers: 7, emberColor: sap, emberSize: 0.05, pool: 0.55, life: 2.2, emberLife: 1.5 };
    root.userData.skinOpts = { rim: '#d0ff6a', rimStrength: 0.42 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, hs = pulse(t, 2.7, 0.35);
      crown.rotation.set(0, 0, Math.sin(t * 2.5) * 0.1 + Math.sin(t * 40) * 0.04 * hs); crown.scale.setScalar(1 + 0.08 * hs + 0.05 * d);
      tL.rotation.set(0, 0, Math.sin(t * 3) * 0.2 + 0.3 * d); tR.rotation.set(0, 0, -Math.sin(t * 3) * 0.2 - 0.3 * d);
      if (state === 'walk') { var s = t * 12; body.rotation.z = Math.sin(s) * 0.15; body.position.y = Math.abs(Math.sin(s)) * 0.08; }
      else { body.rotation.z = Math.sin(t * 2) * 0.05; body.position.y = Math.abs(Math.sin(t * 5)) * 0.02 * d; }
      if (e.wind) { tL.rotation.z += 1.2 * e.wind; tR.rotation.z -= 1.2 * e.wind; tL.rotation.y = 0.6 * e.wind; tR.rotation.y = -0.6 * e.wind; }
      if (e.lunge) { tL.rotation.y -= 1.0 * e.lunge; tR.rotation.y += 1.0 * e.lunge; crown.scale.multiplyScalar(1 + 0.15 * e.lunge); }
      if (e.taunt) { tL.rotation.z += 1.4 * e.taunt; tR.rotation.z -= 1.4 * e.taunt; crown.scale.multiplyScalar(1 + 0.22 * e.roar); body.position.y += Math.abs(Math.sin(k * 14)) * 0.08 * e.taunt; }
      if (e.fall) { tL.rotation.z = -0.4 * e.fall; tR.rotation.z = 0.4 * e.fall; }
    }, { fallX: -1.2, sink: 0.02 });
    return root;
  };

  // ---------------- Thornmaw: corrupted great oak (boss) ----------------
  E.oak = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#4b3a3a'), bark = dk(c, 0.3), barkD = dk(c, 0.62), leaf = C('#45205a'), leaf2 = C('#2f4a22'), leaf3 = C('#5a2a6a'), thorn = C('#24101e');
    var eyeC = C(EL ? BURN : '#c6ff4a'), sap = C(HOLLOW_GREEN), wood = mix(c, '#d8c8a0', 0.45), gold = C(ELITE_GOLD), violet = C(HOLLOW_VIOLET);
    var b = base(), root = b.root, body = b.body;
    var R = new Builder();
    for (var i = 0; i < 9; i++) {
      var a = i * TAU / 9 + 0.3, l = 1.6 + (i % 3) * 0.32;
      R.add(hornGeo([[Math.sin(a) * 0.75, 0.8, Math.cos(a) * 0.75], [Math.sin(a) * 1.15, 0.3, Math.cos(a) * 1.15], [Math.sin(a) * (l - 0.2), 0.12, Math.cos(a) * (l - 0.2)], [Math.sin(a) * l, -0.02, Math.cos(a) * l]], 0.34, 0.02, 0, 10, 7), barkD);
      R.add(G.cone(0.05, 0.3, 4), thorn, { p: [Math.sin(a) * 1.2, 0.36, Math.cos(a) * 1.2], r: [Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6], flat: true });
    }
    body.add(R.build());
    var trunk = pivot(body);
    var B = new Builder();
    B.add(gnarlGeo(0.82, 1.3, 4.0, 16, 9, 0.8, 0.08, 5), bark, { flat: true });
    for (var j = 0; j < 11; j++) {
      var a2 = j * TAU / 11 + 0.17;
      if (Math.abs(Math.sin(a2 / 2)) < 0.3) continue;
      B.add(G.box(0.15, 2.6 + (j % 3) * 0.5, 0.15), barkD, { p: [Math.sin(a2) * 1.03, 1.6, Math.cos(a2) * 1.03], r: [0, a2, Math.sin(j) * 0.1], flat: true });
    }
    // glowing sap veins climbing the trunk
    [[-2.2, 0.3], [2.4, 0.5], [3.1, 0.2], [-1.4, 0.7], [1.2, 0.4]].forEach(function (v, n) {
      var pts = [];
      for (var q = 0; q < 5; q++) { var y = 0.3 + q * 0.75 + v[1] * 0.3, an = v[0] + Math.sin(q * 1.7 + n) * 0.25, rr = 1.24 - y * 0.11; pts.push([Math.sin(an) * rr, y, Math.cos(an) * rr]); }
      vein(B, pts, 0.05, sap);
    });
    // face
    [-1, 1].forEach(function (sx) {
      B.add(G.sph(0.3, 10, 8), '#0b0610', { p: [sx * 0.38, 2.95, 0.86], s: [1.25, 0.8, 0.55] });
      angryEye(B, [sx * 0.38, 2.94, 0.98], sx, eyeC, 0.16, { tilt: 0.4, socket: '#0b0610', squint: 0.55 });
      brow(B, [sx * 0.37, 3.2, 0.98], sx, 0.7, barkD, { ang: 0.42, th: 0.3, d: 0.4 });
      B.add(G.cone(0.08, 0.4, 5), thorn, { p: [sx * 0.66, 3.34, 0.86], r: [-0.3, 0, -sx * 0.9], flat: true });
    });
    B.add(G.cone(0.2, 0.55, 6), bark, { p: [0, 2.62, 1.02], r: [PI / 2 + 0.35, 0, 0], flat: true });
    B.add(G.sph(1, 14, 10), '#0b0610', { p: [0, 2.1, 0.92], s: [0.66, 0.3, 0.32] });
    B.glow(G.sph(1, 12, 8), '#3f7a18', { p: [0, 2.05, 0.95], s: [0.4, 0.16, 0.2] });
    fangRow(B, [0, 2.36, 1.08], 0.48, 7, 0.26, 0.07, wood, true, { back: 0.18, big: 1.25, splay: 0.15 });
    // crown of thorns with Hollow crystals (boss ornament)
    B.add(G.tor(0.92, 0.09, 5, 18), thorn, { p: [0, 3.82, 0], r: [PI / 2, 0, 0], flat: true });
    for (var t3 = 0; t3 < 12; t3++) {
      var ta = t3 * TAU / 12;
      B.add(G.cone(0.07, 0.45, 4), thorn, { p: [Math.sin(ta) * 0.95, 4.0, Math.cos(ta) * 0.95], r: [Math.cos(ta) * 0.5, 0, -Math.sin(ta) * 0.5], flat: true });
      if (t3 % 3 === 0) B.glow(G.oct(0.11), t3 % 2 ? violet : sap, { p: [Math.sin(ta + 0.26) * 1.0, 3.86, Math.cos(ta + 0.26) * 1.0], s: [0.7, 1.4, 0.7] });
    }
    if (EL) for (var g = 0; g < 3; g++) B.add(G.tor(1.12 - g * 0.12, 0.05, 5, 20), gold, { p: [0, 0.8 + g * 1.1, 0], r: [PI / 2, 0, 0] });
    trunk.add(B.build());
    var jaw = pivot(trunk, 0, 2.08, 0.62), J = new Builder();
    J.add(G.sph(1, 14, 8), bark, { p: [0, -0.2, 0.36], s: [0.72, 0.22, 0.34], flat: true });
    J.add(G.sph(1, 10, 6), '#0b0610', { p: [0, -0.06, 0.38], s: [0.56, 0.08, 0.24] });
    fangRow(J, [0, -0.06, 0.66], 0.42, 6, 0.22, 0.065, wood, false, { back: 0.16, big: 1.3, splay: 0.15 });
    jaw.add(J.build());
    var crown = pivot(trunk, 0, 4.05, 0);
    var CB = new Builder();
    var blobs = [[0, 0.75, -0.2, 1.45], [1.25, 0.25, -0.3, 1.05], [-1.25, 0.35, -0.2, 1.1], [0.55, 1.3, 0.25, 0.95], [-0.65, 1.2, -0.5, 1.0], [0.2, 0.05, -1.0, 0.95], [-0.1, 1.75, -0.2, 0.7]];
    blobs.forEach(function (bl, n) {
      CB.add(G.ico(bl[3], 1), n % 3 === 2 ? leaf2 : (n % 2 ? leaf3 : leaf), { p: [bl[0], bl[1], bl[2]], flat: true });
      var dirs = [];
      for (var q = 0; q < 4; q++) dirs.push([Math.sin(n * 2.1 + q * 1.6), 0.35 + 0.5 * Math.cos(n + q), Math.cos(n * 2.1 + q * 1.6)]);
      spikesOn(CB, [bl[0], bl[1], bl[2]], [bl[3], bl[3], bl[3]], dirs, 0.5, 0.09, thorn, { vary: true });
    });
    // dead branch antlers piercing the canopy
    [[1, 0.2], [-1, 0.5], [0.4, -0.6], [-0.5, -0.9], [0.1, 0.9], [-0.9, -0.2]].forEach(function (br, n) {
      var x = br[0], z = br[1];
      CB.add(hornGeo([[x * 0.4, 0.2, z * 0.4], [x * 1.1, 1.0, z * 1.1], [x * 1.6, 1.8, z * 1.5], [x * 1.75, 2.4, z * 1.6]], 0.13, 0.015, 0, 10, 6), barkD);
      CB.add(hornGeo([[x * 1.2, 1.25, z * 1.15], [x * 1.7, 1.45, z * 1.3], [x * 2.0, 1.85, z * 1.4]], 0.06, 0.008, 0, 6, 4), barkD);
    });
    for (var v = 0; v < 8; v++) {
      var vx = -1.5 + v * 0.45, vz = 0.65 - (v % 2) * 1.3, vl = 0.9 + (v % 3) * 0.45;
      CB.add(G.cyl(0.03, 0.03, vl, 4), leaf2, { p: [vx, -0.55 - vl / 2 + 0.4, vz] });
      CB.glow(G.sph(0.09, 8, 6), v % 2 ? sap : violet, { p: [vx, -0.55 - vl + 0.35, vz] });
    }
    crown.add(CB.build());
    function arm(sx) {
      var p = pivot(trunk, sx * 0.85, 3.05, 0.1), A = new Builder();
      A.add(hornGeo([[0, 0, 0], [sx * 0.7, 0.18, 0.2], [sx * 1.3, 0.62, 0.42], [sx * 1.62, 1.22, 0.7]], 0.34, 0.1, 0, 12, 8), bark);
      for (var f = 0; f < 5; f++) {
        var fa = (f - 2) * 0.32;
        A.add(hornGeo([[sx * 1.6, 1.2, 0.7], [sx * (1.72 + Math.sin(fa) * 0.25), 1.4 + Math.cos(fa) * 0.1, 0.95], [sx * (1.8 + Math.sin(fa) * 0.42), 1.38 + Math.cos(fa) * 0.18, 1.3], [sx * (1.78 + Math.sin(fa) * 0.5), 1.2 + Math.cos(fa) * 0.2, 1.5]], 0.07, 0.006, 0, 8, 5), barkD);
      }
      A.add(G.ico(0.42, 0), leaf, { p: [sx * 1.15, 0.65, 0.2], flat: true });
      A.add(G.cone(0.07, 0.38, 4), thorn, { p: [sx * 0.75, 0.48, 0.3], r: [0, 0, sx * 0.6], flat: true });
      A.add(G.cone(0.06, 0.32, 4), thorn, { p: [sx * 1.4, 0.8, 0.3], r: [0.6, 0, -sx * 0.4], flat: true });
      vein(A, [[sx * 0.3, 0.12, 0.3], [sx * 0.9, 0.32, 0.45], [sx * 1.35, 0.75, 0.62]], 0.03, sap);
      p.add(A.build()); return p;
    }
    var armL = arm(1), armR = arm(-1);
    eyeHalos(root, trunk, [[-0.38, 2.94, 1.06], [0.38, 2.94, 1.06]], eyeC, 0.75);
    root.userData.aura = { r: 1.6, h: 3.2, y0: 0.0, size: 0.95, smoke: 20, smokeAlpha: 0.48, smokeColor: '#140e16', smokeColor2: '#1a2410', embers: 22, emberColor: sap, emberColors: [sap, violet], emberSize: 0.1, pool: 2.4, life: 3.4, emberLife: 2.4 };
    root.userData.skinOpts = { rim: '#b07aff', rimStrength: 0.45 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, rr = pulse(t, 5.2, 1.1);
      trunk.rotation.set(-0.03 * d, 0, Math.sin(t * 0.9) * 0.025);
      crown.rotation.set(Math.sin(t * 1.1) * 0.03, 0, Math.sin(t * 0.8) * 0.05 + Math.sin(t * 30) * 0.02 * rr);
      armL.rotation.set(Math.sin(t * 1.2) * 0.05 - 0.4 * d, 0, Math.sin(t * 1.2) * 0.06 + 0.1 * d);
      armR.rotation.set(Math.sin(t * 1.2 + 1) * 0.05 - 0.4 * d, 0, -Math.sin(t * 1.2 + 1) * 0.06 - 0.1 * d);
      var jo = 0.06 + 0.12 * d + rr * 0.32 + Math.sin(t * 1.6) * 0.03;
      if (state === 'walk') {
        var s = t * 3.2;
        body.rotation.z = Math.sin(s) * 0.05; body.position.y = Math.abs(Math.sin(s)) * 0.12;
        armL.rotation.x = Math.sin(s) * 0.2; armR.rotation.x = -Math.sin(s) * 0.2;
      }
      if (e.wind) { armL.rotation.x -= 1.0 * e.wind; armR.rotation.x -= 1.0 * e.wind; armL.rotation.z += 0.5 * e.wind; armR.rotation.z -= 0.5 * e.wind; trunk.rotation.x -= 0.1 * e.wind; jo += 0.3 * e.wind; }
      if (e.lunge) { armL.rotation.x += 0.6 * e.lunge; armR.rotation.x += 0.6 * e.lunge; armL.rotation.z -= 0.2 * e.lunge; armR.rotation.z += 0.2 * e.lunge; trunk.rotation.x += 0.1 * e.lunge; jo += 0.45 * e.lunge; }
      if (e.taunt) { armL.rotation.z += 0.8 * e.taunt; armR.rotation.z -= 0.8 * e.taunt; armL.rotation.x -= 0.5 * e.taunt; armR.rotation.x -= 0.5 * e.taunt; jo += 0.6 * e.roar; crown.rotation.z += Math.sin(k * 28) * 0.06 * e.taunt; trunk.rotation.x -= 0.08 * e.taunt; }
      if (e.hit) jo += 0.2 * e.hit;
      if (e.fall) { trunk.rotation.x -= 0.25 * e.fall; armL.rotation.z -= 0.5 * e.fall; armR.rotation.z += 0.5 * e.fall; jo = jo * (1 - e.fall) + 0.5 * e.fall; }
      jaw.rotation.set(Math.min(0.6, jo), 0, 0);
    }, { hitScale: 0.3, lungeScale: 0.5, tauntTilt: 0.4, fallX: -0.25, sink: 0.3 });
    b.scaler.scale.setScalar(0.86);
    return root;
  };

  // ---------------- Ash Wraith ----------------
  E.wraith = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#6c6680'), ember = mix(c, '#ffb050', 0.25), cloak = mix('#262030', c, 0.16), cloakD = dk(cloak, 0.45), bone = C('#d8ccb4');
    var eyeC = C(EL ? BURN : mix(c, '#fff2b0', 0.45)), gold = C(ELITE_GOLD), hot = mix(c, '#ffe08a', 0.3);
    var b = base(), root = b.root, body = b.body;
    var fl = pivot(body, 0, 0, 0);
    var B = new Builder();
    B.add(skirtGeo(0.27, 0.5, 1.2, 20, 0.34, 7, 4), cloak, { p: [0, 0.42, 0], flat: true });
    B.glow(skirtGeo(0.497, 0.507, 0.05, 20, 0.34, 7, 1, true), ember, { p: [0, 0.405, 0] });
    B.add(skirtGeo(0.33, 0.6, 0.92, 12, 0.46, 9, 3), cloakD, { p: [0, 0.7, 0], flat: true });
    B.glow(skirtGeo(0.597, 0.607, 0.04, 12, 0.46, 9, 1, true), hot, { p: [0, 0.685, 0] });
    B.add(G.sph(0.3, 14, 10), cloak, { p: [0, 1.62, 0.04], s: [1.0, 0.72, 0.85], flat: true });
    [-1, 1].forEach(function (sx) { for (var q = 0; q < 3; q++) B.add(G.cone(0.045, 0.3 - q * 0.06, 5), bone, { p: [sx * (0.26 + q * 0.06), 1.78 - q * 0.06, -0.06 + q * 0.06], r: [0, 0, -sx * (0.45 + q * 0.25)] }); });
    // bone collar + ember cracks
    for (var i = 0; i < 9; i++) {
      var a = -PI * 0.75 + i * PI * 1.5 / 8;
      B.add(G.cone(0.04, 0.26 + (i % 2) * 0.12, 5), bone, { p: [Math.sin(a) * 0.3, 1.86, Math.cos(a) * 0.24 - 0.04], r: [-Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5] });
    }
    vein(B, [[0.05, 1.05, 0.42], [-0.06, 1.25, 0.38], [0.04, 1.45, 0.33], [-0.03, 1.6, 0.3]], 0.022, ember);
    vein(B, [[0.3, 0.8, 0.45], [0.22, 1.0, 0.43], [0.27, 1.2, 0.36]], 0.016, ember);
    vein(B, [[-0.32, 0.75, 0.45], [-0.24, 0.95, 0.43], [-0.28, 1.12, 0.37]], 0.016, ember);
    glyph(B, 'crescent', [0, 1.5, 0.3], [0, 0.1, 1], 0.16, ember);
    fl.add(B.build());
    var tailMat = M.glow(sh(c, 0.15), 0.42);
    var tail = new T.Mesh(G.cone(0.45, 1.0, 12), tailMat);
    tail.rotation.x = PI; tail.position.y = 0.36; tail.userData.noMeasure = true;
    fl.add(tail);
    var head = pivot(fl, 0, 2.0, 0.02);
    var hood = new T.Mesh(new T.SphereGeometry(0.36, 16, 12, PI / 2 + 0.72, TAU - 1.44, 0, PI * 0.74), M.toon(cloak, { side: T.DoubleSide, flat: true }));
    hood.scale.set(1, 1.12, 1.12); hood.castShadow = true; head.add(hood);
    var H = new Builder();
    H.add(G.sph(0.29, 12, 10), '#050308', { p: [0, -0.03, 0.0] });
    H.add(hornGeo([[0, 0.3, -0.08], [0, 0.48, -0.3], [0, 0.5, -0.55], [0, 0.4, -0.72]], 0.17, 0.01, 0, 10, 8), cloak);
    for (var r = 0; r < 9; r++) { var ra = -1.15 + r * 2.3 / 8; H.add(G.cone(0.05, 0.16 + (r % 2) * 0.08, 4), cloakD, { p: [Math.sin(ra) * 0.36, -0.28 - (r % 2) * 0.03, Math.cos(ra) * 0.3], r: [PI, 0, 0], flat: true }); }
    [-1, 1].forEach(function (sx) { angryEye(H, [sx * 0.105, 0.0, 0.26], sx, eyeC, 0.07, { tilt: 0.5, squint: 0.42, pupil: false, socket: '#050308' }); });
    for (var m = 0; m < 6; m++) H.glow(G.cone(0.016, 0.05, 3), sh(ember, -0.2), { p: [-0.075 + m * 0.03, m % 2 ? -0.15 : -0.125, 0.26], r: [m % 2 ? 0 : PI, 0, 0] });
    if (EL) {
      for (var cr = 0; cr < 5; cr++) { var ca = -0.9 + cr * 0.45; H.add(G.cone(0.035, 0.24 + (cr === 2 ? 0.1 : 0), 5), bone, { p: [Math.sin(ca) * 0.3, 0.3, Math.cos(ca) * 0.2], r: [-0.3, 0, -Math.sin(ca) * 0.5] }); }
      H.add(G.tor(0.36, 0.022, 4, 20, PI * 1.2), gold, { p: [0, -0.14, 0.02], r: [-0.25, 0, -PI * 0.1 - PI * 0.5], s: [1, 1, 1.1] });
    }
    head.add(H.build());
    function arm(sx) {
      var p = pivot(fl, sx * 0.36, 1.66, 0), A = new Builder();
      A.add(skirtGeo(0.09, 0.22, 0.62, 10, 0.12, 3 + sx, 2), cloakD, { p: [0, -0.62, 0], flat: true });
      A.add(G.cyl(0.03, 0.025, 0.36, 6), bone, { p: [0, -0.66, 0.04], r: [0.3, 0, 0] });
      A.add(G.sph(0.045, 8, 6), bone, { p: [0, -0.82, 0.1] });
      for (var f = 0; f < 4; f++) A.add(hornGeo([[0, -0.82, 0.1], [(f - 1.5) * 0.05, -0.92, 0.17], [(f - 1.5) * 0.08, -1.04, 0.24], [(f - 1.5) * 0.08, -1.12, 0.34]], 0.016, 0.002, 2, 8, 4), bone);
      A.glow(G.sph(0.06, 8, 6), ember, { p: [0, -0.8, 0.08] });
      p.add(A.build()); return p;
    }
    var armL = arm(1), armR = arm(-1);
    // soul lantern on a chain (left hand)
    var lant = pivot(armL, 0, -0.86, 0.12), LB = new Builder();
    for (var ch = 0; ch < 4; ch++) LB.add(G.tor(0.025, 0.007, 4, 8), '#5a5060', { p: [0, -0.04 - ch * 0.045, 0], r: [0, ch % 2 ? PI / 2 : 0, 0] });
    LB.add(G.cone(0.08, 0.08, 6), '#3a3040', { p: [0, -0.24, 0], flat: true });
    for (var bar = 0; bar < 4; bar++) LB.add(G.cyl(0.007, 0.007, 0.2, 4), '#3a3040', { p: [Math.sin(bar * PI / 2) * 0.07, -0.38, Math.cos(bar * PI / 2) * 0.07] });
    LB.add(G.cyl(0.08, 0.06, 0.04, 6), '#3a3040', { p: [0, -0.5, 0], flat: true });
    LB.glow(G.sph(0.06, 10, 8), hot, { p: [0, -0.38, 0] });
    lant.add(LB.build());
    var lh = halo(ember, 0.55, 0.85); lh.position.set(0, -0.38, 0); lant.add(lh);
    eyeHalos(root, head, [[-0.105, 0, 0.29], [0.105, 0, 0.29]], eyeC, 0.26);
    root.userData.aura = { r: 0.6, h: 2.0, y0: 0.2, size: 0.55, smoke: 14, smokeAlpha: 0.5, smokeColor: '#1a1618', smokeColor2: '#2a2026', embers: 18, emberColor: ember, emberColors: [ember, hot], emberSize: 0.06, pool: 0.9, poolColor: '#100c10', glow: ember, life: 2.6, emberLife: 1.6 };
    root.userData.skinOpts = { rim: mix(c, '#ff7a3a', 0.4), rimStrength: 0.5, edge: ember };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk';
      fl.position.set(0, 0.22 + Math.sin(t * 1.8) * 0.12 - 0.05 * d, 0);
      fl.rotation.set((walk ? 0.22 : 0) + 0.1 * d, 0, Math.sin(t * 1.2) * 0.04);
      tail.rotation.z = Math.sin(t * 2.4) * 0.15; tail.scale.set(1, 1 + Math.sin(t * 3) * 0.1, 1);
      armL.rotation.set(Math.sin(t * 1.5) * 0.12 - 0.5 * d, 0, 0.35 + 0.2 * d);
      armR.rotation.set(Math.sin(t * 1.5 + 1) * 0.12 - 0.9 * d, 0, -0.35 - 0.15 * d);
      lant.rotation.set(-armL.rotation.x + Math.sin(t * 2.1) * 0.15, 0, -armL.rotation.z + Math.sin(t * 1.7) * 0.1);
      head.rotation.set(0.1 * d, Math.sin(t * 0.6) * 0.2 * (1 - d), Math.sin(t * 0.9) * 0.05);
      if (e.wind) { armR.rotation.x -= 1.6 * e.wind; armR.rotation.z -= 0.5 * e.wind; armL.rotation.x -= 0.8 * e.wind; fl.position.y += 0.15 * e.wind; head.rotation.x -= 0.2 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 0.6 * e.lunge; armR.rotation.z += 0.3 * e.lunge; armL.rotation.x -= 0.6 * e.lunge; fl.position.z += 0.3 * e.lunge; fl.rotation.x += 0.2 * e.lunge; }
      if (e.taunt) { fl.position.y += 0.3 * e.taunt; armL.rotation.z += 1.1 * e.taunt; armR.rotation.z -= 1.1 * e.taunt; armL.rotation.x -= 0.7 * e.taunt; armR.rotation.x -= 0.7 * e.taunt; head.rotation.x -= 0.3 * e.taunt; head.rotation.z += Math.sin(k * 40) * 0.06 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.4 * e.hit; armR.rotation.z -= 0.4 * e.hit; }
      if (e.fall) { fl.position.y *= 1 - e.fall; fl.scale.set(1 + 0.15 * e.fall, 1 - 0.45 * e.fall, 1 + 0.15 * e.fall); armL.rotation.z += 0.6 * e.fall; armR.rotation.z -= 0.6 * e.fall; head.rotation.x += 0.6 * e.fall; }
      else fl.scale.set(1, 1, 1);
    }, { customFall: true, hitScale: 0.8 });
    return root;
  };

  // ---------------- Bone Knight / Captain Vex ----------------
  function skeletonModel(col, captain, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || (captain ? '#3e3a52' : '#5a5670'));
    var armor = mix('#2a2636', c, captain ? 0.36 : 0.1), armorL = sh(armor, 0.12), armorD = dk(armor, 0.4);
    var bone = mix('#e2d8be', c, 0.15), cloth = C(captain ? '#34185e' : '#46205e'), steel = C(captain ? '#6e7286' : '#a8aebd');
    var eyeC = C(EL ? BURN : (captain ? HOLLOW_GREEN : HOLLOW_VIOLET)), trim = C(captain || EL ? '#c9a24a' : '#8c7caa'), green = C(HOLLOW_GREEN);
    var b = base(), root = b.root, body = b.body;
    function leg(sx) {
      var p = pivot(body, sx * 0.15, 0.95, 0), L = new Builder();
      L.add(G.cyl(0.045, 0.04, 0.42, 6), bone, { p: [0, -0.21, 0] });
      L.add(G.cyl(0.04, 0.035, 0.38, 6), bone, { p: [0, -0.64, 0] });
      L.add(G.cyl(0.105, 0.085, 0.26, 8), armor, { p: [0, -0.16, 0.01], flat: true });
      L.add(G.sph(0.09, 8, 6), armorL, { p: [0, -0.44, 0.03], flat: true });
      L.add(G.cone(0.04, 0.16, 5), trim, { p: [0, -0.44, 0.14], r: [PI / 2, 0, 0], flat: true });
      L.add(G.cyl(0.09, 0.075, 0.3, 8), armor, { p: [0, -0.66, 0.01], flat: true });
      L.add(G.box(0.18, 0.13, 0.32), armorD, { p: [0, -0.885, 0.05], flat: true });
      L.add(G.cone(0.04, 0.14, 4), armorD, { p: [0, -0.9, 0.26], r: [PI / 2, 0, 0], flat: true });
      p.add(L.build()); return p;
    }
    var legL = leg(1), legR = leg(-1);
    var torso = pivot(body, 0, 0.95, 0);
    var B = new Builder();
    B.add(G.box(0.32, 0.1, 0.16), bone);
    B.add(skirtGeo(0.24, 0.31, 0.3, 10, 0.06, 4, 2), armor, { p: [0, -0.3, 0], flat: true });
    B.add(G.cyl(0.035, 0.035, 0.32, 5), bone, { p: [0, 0.15, -0.05] });
    for (var r = 0; r < 3; r++) B.add(G.tor(0.15 - r * 0.012, 0.02, 4, 12, PI * 1.4), bone, { p: [0, 0.1 + r * 0.06, -0.02], r: [PI / 2, 0, PI * 0.8] });
    B.glow(G.oct(0.06), eyeC, { p: [0, 0.16, 0.0], s: [1, 1.3, 1] });
    B.add(G.sph(0.35, 14, 10), armor, { p: [0, 0.45, 0], s: [1, 0.78, 0.74], flat: true });
    B.add(G.cyl(0.17, 0.23, 0.13, 10), armorD, { p: [0, 0.68, 0], flat: true });
    B.add(G.tor(0.27, 0.03, 4, 14), trim, { p: [0, 0.27, 0], r: [PI / 2, 0, 0] });
    B.add(G.tor(0.2, 0.035, 4, 14), C('#2a2030'), { p: [0, 0.02, 0], r: [PI / 2, 0, 0] });
    glyph(B, 'eye', [0, 0.46, 0.255], [0, 0.15, 1], captain ? 0.24 : 0.17, eyeC);
    // tattered tabard + skull buckle
    var tb = new T.Shape(); tb.moveTo(-0.13, 0); tb.lineTo(0.13, 0); tb.lineTo(0.14, -0.42);
    for (var z = 0; z < 5; z++) tb.lineTo(0.14 - (z + 0.5) * 0.056, z % 2 ? -0.42 : -0.52);
    tb.lineTo(-0.14, -0.42); tb.lineTo(-0.13, 0);
    B.add(new T.ShapeGeometry(tb), cloth, { p: [0, 0.0, 0.215], r: [0.12, 0, 0] });
    glyph(B, captain ? 'crescent' : 'tri', [0, -0.2, 0.245], [0, 0.12, 1], 0.12, eyeC);
    B.add(G.sph(0.05, 8, 6), bone, { p: [0, 0.02, 0.22] });
    if (captain) {
      B.add(G.sph(0.3, 10, 8), armorL, { p: [0, 0.5, 0.08], s: [0.8, 0.5, 0.5], flat: true });
      B.add(G.box(0.4, 0.06, 0.04), trim, { p: [0, 0.6, 0.25], flat: true });
      for (var k3 = 0; k3 < 3; k3++) B.add(G.cone(0.035, 0.14, 4), trim, { p: [-0.12 + k3 * 0.12, 0.66, 0.25], flat: true });
      // war collar of spikes + skull trophies on the belt
      for (var k4 = 0; k4 < 7; k4++) { var ka = -PI * 0.8 + k4 * PI * 1.6 / 6; B.add(G.cone(0.04, 0.3, 4), armorD, { p: [Math.sin(ka) * 0.2, 0.84, -Math.cos(ka) * 0.16 - 0.02], r: [-Math.cos(ka) * 0.55 - 0.2, 0, -Math.sin(ka) * 0.55], flat: true }); }
      [-0.18, 0, 0.18].forEach(function (sx2, n2) {
        var sp2 = [sx2, -0.02, 0.26 - Math.abs(sx2) * 0.35];
        B.add(G.sph(0.05, 8, 6), bone, { p: sp2 });
        B.add(G.sph(0.013, 5, 4), '#0a0608', { p: [sp2[0] - 0.018, sp2[1] + 0.005, sp2[2] + 0.044] });
        B.add(G.sph(0.013, 5, 4), '#0a0608', { p: [sp2[0] + 0.018, sp2[1] + 0.005, sp2[2] + 0.044] });
      });
    }
    torso.add(B.build());
    var head = pivot(torso, 0, 0.8, 0);
    var H = new Builder();
    H.add(G.cyl(0.035, 0.035, 0.12, 5), bone, { p: [0, -0.06, 0] });
    H.add(G.sph(0.19, 12, 10), bone, { p: [0, 0.1, 0] });
    H.add(G.hemi(0.235, 14, 6), armor, { p: [0, 0.14, -0.01], s: [1, 1.05, 1.06], flat: true });
    H.add(G.cyl(0.232, 0.24, 0.2, 14, true), armor, { p: [0, 0.05, -0.01], flat: true });
    H.add(G.box(0.3, 0.24, 0.07), armorL, { p: [0, 0.09, 0.2], flat: true });
    H.add(G.box(0.24, 0.036, 0.02), '#06040a', { p: [0, 0.135, 0.236] });
    H.add(G.box(0.034, 0.12, 0.02), '#06040a', { p: [0, 0.04, 0.236] });
    [-1, 1].forEach(function (sx) { H.glow(G.sph(0.034, 8, 6), eyeC, { p: [sx * 0.065, 0.135, 0.232], s: [1.6, 0.55, 0.5], r: [0, 0, sx * 0.25] }); });
    H.add(G.tor(0.236, 0.022, 4, 16), trim, { p: [0, 0.15, -0.01], r: [PI / 2, 0, 0] });
    H.add(G.box(0.05, 0.3, 0.05), trim, { p: [0, 0.3, 0.12], r: [0.6, 0, 0], flat: true });
    var hr = captain ? 0.08 : (EL ? 0.06 : 0.05);
    [-1, 1].forEach(function (sx) {
      if (captain) H.add(hornGeo([[sx * 0.2, 0.18, -0.02], [sx * 0.4, 0.3, -0.12], [sx * 0.5, 0.52, -0.2], [sx * 0.47, 0.72, -0.1], [sx * 0.36, 0.82, 0.04]], hr, 0.005, 5, 16, 8), bone);
      else H.add(hornGeo([[sx * 0.2, 0.14, 0], [sx * 0.34, 0.2, 0.02], [sx * 0.43, 0.34, 0.07], [sx * 0.41, 0.5, 0.16]], hr, 0.004, 4, 12, 7), bone);
      if (EL) H.add(hornGeo([[sx * 0.12, 0.3, 0.02], [sx * 0.2, 0.44, -0.04], [sx * 0.22, 0.56, 0.02]], 0.035, 0.003, 2, 8, 5), trim);
    });
    for (var cs = 0; cs < (captain ? 5 : 4); cs++) H.add(G.cone(0.035, captain ? 0.22 + (cs === 2 ? 0.1 : 0) : 0.15, 4), captain ? trim : armorD, { p: [0, 0.36 - Math.abs(cs - 2) * 0.02, 0.1 - cs * 0.08], r: [-0.25 - cs * 0.15, 0, 0], flat: true });
    if (captain) H.glow(G.oct(0.04), green, { p: [0, 0.3, 0.18], s: [1, 1.4, 0.6] });
    head.add(H.build());
    var jaw = pivot(head, 0, -0.02, 0.05), J = new Builder();
    J.add(G.box(0.17, 0.06, 0.13), bone, { p: [0, -0.03, 0.04] });
    fangRow(J, [0, 0.0, 0.11], 0.06, 5, 0.035, 0.012, bone, false, {});
    jaw.add(J.build());
    function arm(sx) {
      var p = pivot(torso, sx * 0.34, 0.58, 0), A = new Builder();
      A.add(G.hemi(0.17, 12, 5), armor, { p: [0, 0.03, 0], s: [1.15, 0.85, 1.15], flat: true });
      A.add(G.hemi(0.2, 12, 5), armorL, { p: [sx * 0.02, -0.03, 0], s: [1.1, 0.7, 1.1], r: [0, 0, -sx * 0.25], flat: true });
      A.add(G.tor(0.21, 0.02, 4, 14), trim, { p: [sx * 0.02, -0.03, 0], r: [PI / 2, 0, -sx * 0.25] });
      var ns = captain ? 4 : 2;
      for (var q = 0; q < ns; q++) A.add(G.cone(0.04, captain ? 0.28 : 0.2, 4), captain ? armorD : trim, { p: [sx * 0.1, 0.12, -0.1 + q * (0.2 / Math.max(1, ns - 1))], r: [0, 0, -sx * 0.55], flat: true });
      if (captain) {
        A.add(G.hemi(0.25, 12, 5), armorD, { p: [sx * 0.05, -0.1, 0], s: [1.05, 0.6, 1.1], r: [0, 0, -sx * 0.45], flat: true });
        A.add(G.tor(0.25, 0.022, 4, 14), trim, { p: [sx * 0.05, -0.1, 0], r: [PI / 2, 0, -sx * 0.45] });
      }
      if (EL) A.add(G.cone(0.04, 0.24, 4), trim, { p: [sx * 0.04, 0.18, 0.1], r: [0.3, 0, -sx * 0.3], flat: true });
      A.add(G.cyl(0.035, 0.035, 0.32, 5), bone, { p: [0, -0.2, 0] });
      A.add(G.sph(0.05, 6, 5), bone, { p: [0, -0.37, 0] });
      A.add(G.cyl(0.03, 0.03, 0.3, 5), bone, { p: [0, -0.53, 0] });
      A.add(G.cyl(0.07, 0.055, 0.2, 8), armor, { p: [0, -0.58, 0], flat: true });
      A.add(G.box(0.09, 0.09, 0.09), armorD, { p: [0, -0.72, 0.01], flat: true });
      for (var f = 0; f < 4; f++) A.add(clawGeo(captain ? 0.11 : 0.08, 0.016), armorD, { p: [(f - 1.5) * 0.024, -0.76, 0.05], r: [-0.2, 0, 0] });
      p.add(A.build()); p.rotation.z = sx * 0.12; p.userData.rest = sx * 0.12; return p;
    }
    var armL = arm(1), armR = arm(-1);
    var sword = pivot(armR, 0, -0.72, 0.02);
    var S = new Builder();
    var bl = captain ? 1.6 : 0.95, bw = captain ? 0.22 : 0.12;
    S.add(G.cyl(0.025, 0.025, captain ? 0.34 : 0.22, 6), '#3a2a20', { p: [0, captain ? -0.05 : 0, 0] });
    S.add(G.sph(0.045, 8, 6), captain ? trim : bone, { p: [0, captain ? -0.24 : -0.13, 0] });
    S.add(G.box(captain ? 0.46 : 0.3, 0.05, 0.065), trim, { p: [0, 0.12, 0], flat: true });
    [-1, 1].forEach(function (sx) { S.add(G.cone(0.03, captain ? 0.2 : 0.12, 4), trim, { p: [sx * (captain ? 0.24 : 0.16), 0.18, 0], r: [0, 0, -sx * 0.6], flat: true }); });
    S.add(bladeGeo(bl, bw, captain ? 0.035 : 0.022, captain ? 5 : 4), steel, { p: [0, 0.14, 0], flat: true });
    S.glow(G.box(captain ? 0.045 : 0.025, bl * 0.72, captain ? 0.06 : 0.04), eyeC, { p: [0, 0.2 + bl * 0.38, 0] });
    if (captain) S.glow(G.oct(0.05), green, { p: [0, 0.12, 0.04], s: [1, 1.3, 0.6] });
    sword.add(S.build());
    var shield = null, cape = null;
    if (!captain) {
      shield = pivot(armL, 0.06, -0.5, 0.12);
      var SH = new Builder();
      SH.add(G.cyl(0.36, 0.36, 0.06, 10), armor, { r: [PI / 2, 0, PI / 10], flat: true });
      SH.add(G.tor(0.36, 0.035, 4, 10), trim, { r: [0, 0, PI / 10], p: [0, 0, 0.03] });
      for (var sp = 0; sp < 6; sp++) { var sa = sp * TAU / 6 + 0.3; SH.add(G.cone(0.035, 0.16, 4), trim, { p: [Math.cos(sa) * 0.42, Math.sin(sa) * 0.42, 0.02], r: [0, 0, sa - PI / 2], flat: true }); }
      glyph(SH, 'eye', [0, 0, 0.045], [0, 0, 1], 0.36, eyeC);
      SH.add(G.cone(0.06, 0.18, 5), trim, { p: [0, 0, 0.1], r: [PI / 2, 0, 0], flat: true });
      shield.add(SH.build());
    } else {
      cape = pivot(torso, 0, 0.64, -0.24);
      [[1.0, 1.7, cloth, 0], [0.8, 1.25, sh(cloth, -0.35), 0.03]].forEach(function (cl, n) {
        var cg = new T.PlaneGeometry(cl[0], cl[1], 4, 8); cg.translate(0, -cl[1] / 2, 0);
        var cp = cg.attributes.position;
        for (var ci = 0; ci < cp.count; ci++) {
          var cy = Math.min(0, cp.getY(ci)), cx = cp.getX(ci), col2 = Math.round((cx / cl[0] + 0.5) * 4);
          cp.setX(ci, cx * (1 + (-cy) * 0.4));
          cp.setZ(ci, -Math.pow(-cy, 1.5) * 0.12 + Math.cos(cx * 4) * 0.04 - cl[3]);
          if (cy < -cl[1] + 0.01) cp.setY(ci, cy + (col2 % 2 ? 0.2 : -0.02));
        }
        cg.computeVertexNormals();
        var cm = new T.Mesh(cg, M.toon(cl[2], { side: T.DoubleSide })); cm.castShadow = true; cape.add(cm);
      });
    }
    eyeHalos(root, head, [[-0.065, 0.135, 0.25], [0.065, 0.135, 0.25]], eyeC, captain ? 0.2 : 0.17);
    var hh = halo(eyeC, captain ? 0.42 : 0.32, 0.7); hh.position.set(0, 0.16, 0.02); torso.add(hh);
    root.userData.aura = captain
      ? { r: 0.85, h: 2.4, y0: 0.0, size: 0.62, smoke: 18, smokeAlpha: 0.48, smokeColor: '#120c1c', smokeColor2: '#1a2410', embers: 18, emberColor: green, emberColors: [green, HOLLOW_VIOLET], emberSize: 0.06, pool: 1.3, life: 3.0, emberLife: 2.0 }
      : { r: 0.6, h: 1.8, y0: 0.0, size: 0.48, smoke: 12, smokeAlpha: 0.42, smokeColor: '#140c1c', embers: 10, emberColor: HOLLOW_VIOLET, emberSize: 0.05, pool: 0.9, life: 2.6, emberLife: 1.8 };
    root.userData.skinOpts = { rim: captain ? '#9dff6a' : '#a77cff', rimStrength: 0.48 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk', br = Math.sin(t * 2);
      legL.rotation.set(0, 0, 0.1 * d); legR.rotation.set(0, 0, -0.1 * d);
      armL.rotation.set(0, 0, armL.userData.rest); armR.rotation.set(0, 0, armR.userData.rest);
      head.rotation.set(0.05 * d, 0, 0); torso.rotation.set(0.06 * d, 0, 0); torso.scale.set(1, 1 + br * 0.015, 1);
      var jo = 0.03 + pulse(t, 3.3, 0.35) * 0.2;
      if (captain) {
        armR.rotation.x = -0.75 - 0.75 * d; armL.rotation.set(-0.85 - 0.6 * d, 0, -0.35);
        sword.rotation.set(0.35 + 1.35 * d, 0, 0);
        cape.rotation.x = 0.12 + Math.sin(t * 1.5) * 0.05;
      } else {
        sword.rotation.set(1.1 - 0.5 * d, 0, 0); armR.rotation.x = -0.5 * d;
        armL.rotation.x = -0.35 - 0.6 * d; armL.rotation.z = 0.12 - 0.15 * d;
      }
      if (walk) {
        var s = t * 7.5, sw = Math.sin(s);
        legL.rotation.x = sw * 0.55; legR.rotation.x = -sw * 0.55;
        body.position.y = Math.abs(Math.cos(s)) * 0.05;
        if (!captain) armR.rotation.x = -sw * 0.3;
        if (cape) cape.rotation.x = 0.35 + Math.abs(sw) * 0.1;
        torso.rotation.y = sw * 0.06; torso.rotation.x = 0.06;
      } else {
        body.position.y = Math.sin(t * 2) * 0.012 - 0.05 * d;
        head.rotation.z = Math.sin(t * 7) * 0.015 + Math.sin(t * 0.9) * 0.05;
        head.rotation.y = Math.sin(t * 0.6) * 0.15 * (1 - d);
      }
      // sword arcs: blade direction = arm.x + sword.x (0 = up along a hanging arm)
      var aR = armR.rotation.x, sX = sword.rotation.x;
      if (e.wind) { aR += (-2.8 - aR) * e.wind; sX += (0.4 - sX) * e.wind; torso.rotation.y += 0.3 * e.wind; torso.rotation.x -= 0.12 * e.wind; head.rotation.x -= 0.15 * e.wind; }
      if (e.lunge) { aR += (-0.7 - aR) * e.lunge; sX += (2.5 - sX) * e.lunge; torso.rotation.y -= 0.4 * e.lunge; torso.rotation.x += 0.12 * e.lunge; legR.rotation.x -= 0.35 * e.lunge; legL.rotation.x += 0.2 * e.lunge; }
      if (e.taunt) {
        aR += (-2.9 - aR) * e.taunt; sX += (2.9 + Math.sin(k * 30) * 0.08 - sX) * e.taunt;
        if (captain) { armL.rotation.x += 0.3 * e.taunt; armL.rotation.z -= 0.7 * e.taunt; }
        else { armL.rotation.x -= 0.7 * e.taunt; armL.rotation.z -= 0.2 * e.taunt; }
        head.rotation.x -= 0.4 * e.taunt; jo += 0.5 * e.roar;
      }
      armR.rotation.x = aR; sword.rotation.x = sX;
      if (captain && (e.wind || e.lunge)) armL.rotation.x += (aR + 0.1 - armL.rotation.x) * Math.max(e.wind, e.lunge * 0.8);
      if (e.hit) { jo += 0.2 * e.hit; head.rotation.x -= 0.25 * e.hit; }
      if (e.fall) {
        legL.rotation.x = -1.3 * e.fall; legR.rotation.x = -0.4 * e.fall; body.position.y -= 0.42 * e.fall;
        torso.rotation.x += 0.45 * e.fall; head.rotation.x += 0.5 * e.fall; sword.rotation.x += 1.2 * e.fall;
        armR.rotation.x = armR.rotation.x * (1 - e.fall) + 0.2 * e.fall; armL.rotation.x = armL.rotation.x * (1 - e.fall) - 0.1 * e.fall; jo = 0.35 * e.fall;
      }
      jaw.rotation.set(Math.min(0.6, jo), 0, 0);
    }, { customFall: true, hitScale: captain ? 0.6 : 1 });
    if (captain) b.scaler.scale.setScalar(1.45);
    return root;
  }
  E.knight = function (c, o) { return skeletonModel(c, false, o); };
  E.captain = function (c, o) { return skeletonModel(c, true, o); };

  // ---------------- Hollow Acolyte: dark hooded cultist-wizard ----------------
  E.acolyte = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#3a1d6e'), robe = dk(c, 0.46), robeD = dk(c, 0.72), hand = mix('#b8a8cc', c, 0.2), wood = C('#2a1a24');
    var eyeC = C(EL ? BURN : HOLLOW_GREEN), green = C(HOLLOW_GREEN), gold = C(ELITE_GOLD), bone = C('#ddd2ba');
    var b = base(), root = b.root, body = b.body;
    var robeP = pivot(body);
    var RB = new Builder();
    RB.add(G.lathe([[0, 0], [0.46, 0], [0.5, 0.06], [0.42, 0.4], [0.33, 0.8], [0.27, 1.06], [0.19, 1.2], [0, 1.24]], 20), robe);
    RB.add(skirtGeo(0.3, 0.56, 0.74, 18, 0.3, 5, 3), robeD, { p: [0, 0.36, 0], flat: true });
    RB.glow(skirtGeo(0.562, 0.569, 0.03, 18, 0.3, 5, 1, true), green, { p: [0, 0.345, 0] });
    RB.add(G.tor(0.3, 0.045, 5, 20), C('#1a0c24'), { p: [0, 1.06, 0], r: [PI / 2, 0, 0] });
    glyph(RB, 'eye', [0, 1.06, 0.32], [0, 0, 1], 0.16, green);
    vein(RB, [[0.08, 1.02, 0.3], [0.1, 0.75, 0.37], [0.06, 0.45, 0.44]], 0.016, green);
    vein(RB, [[-0.08, 1.02, 0.3], [-0.1, 0.75, 0.37], [-0.06, 0.45, 0.44]], 0.016, green);
    if (EL) RB.add(G.tor(0.5, 0.03, 5, 22), gold, { p: [0, 0.38, 0], r: [PI / 2, 0, 0] });
    robeP.add(RB.build());
    var upper = pivot(body, 0, 1.05, 0);
    var UB = new Builder();
    UB.add(skirtGeo(0.2, 0.44, 0.34, 14, 0.13, 8, 2), robeD, { p: [0, -0.12, 0], flat: true });
    [-1, 1].forEach(function (sx) {
      for (var q = 0; q < 3; q++) UB.add(G.cone(0.035, 0.2 - q * 0.03, 4), EL ? gold : bone, { p: [sx * (0.3 + q * 0.04), 0.14 - q * 0.05, -0.05 + q * 0.06], r: [0, 0, -sx * (0.5 + q * 0.25)], flat: true });
    });
    for (var cs = 0; cs < 7; cs++) { var ca = -1.2 + cs * 0.4; UB.add(G.cone(0.03, 0.26 + (cs % 2) * 0.1, 4), robeD, { p: [Math.sin(ca) * 0.22, 0.22, -Math.cos(ca) * 0.14 - 0.06], r: [-0.45, 0, -Math.sin(ca) * 0.5], flat: true }); }
    upper.add(UB.build());
    var head = pivot(upper, 0, 0.33, 0);
    var hood = new T.Mesh(new T.SphereGeometry(0.41, 18, 12, PI / 2 + 0.85, TAU - 1.7, 0, PI * 0.66), M.toon(robe, { side: T.DoubleSide }));
    hood.position.set(0, -0.12, -0.02); hood.scale.set(1, 1.1, 1.1); hood.castShadow = true; head.add(hood);
    var H = new Builder();
    H.add(G.sph(0.31, 14, 12), '#07040c');
    H.add(hornGeo([[0, 0.25, -0.12], [0, 0.52, -0.26], [0, 0.7, -0.44], [0, 0.7, -0.66]], 0.21, 0.01, 0, 12, 9), robe);
    H.add(G.tor(0.31, 0.09, 6, 18), robe, { p: [0, -0.3, -0.02], r: [PI / 2 + 0.15, 0, 0] });
    for (var r = 0; r < 9; r++) { var ra = -1.15 + r * 2.3 / 8; H.add(G.cone(0.045, 0.14 + (r % 2) * 0.07, 4), robeD, { p: [Math.sin(ra) * 0.4, -0.3, Math.cos(ra) * 0.34], r: [PI - 0.15, 0, 0], flat: true }); }
    H.glow(G.tor(0.4, 0.014, 4, 22, PI * 1.25), green, { p: [0, -0.12, -0.02], r: [0, 0, -PI * 0.125], s: [1, 1.1, 1.1] });
    [-1, 1].forEach(function (sx) { angryEye(H, [sx * 0.11, 0.02, 0.28], sx, eyeC, 0.07, { tilt: 0.45, squint: 0.42, pupil: false, socket: '#07040c' }); });
    H.glow(G.box(0.12, 0.012, 0.02), sh(eyeC, -0.3), { p: [0, -0.12, 0.29] });
    if (EL) [-1, 1].forEach(function (sx) { H.add(hornGeo([[sx * 0.24, 0.2, 0.02], [sx * 0.42, 0.34, -0.02], [sx * 0.48, 0.52, 0.04], [sx * 0.42, 0.62, 0.14]], 0.055, 0.004, 4, 12, 7), '#1e1018'); });
    head.add(H.build());
    function arm(sx) {
      var p = pivot(upper, sx * 0.28, 0.06, 0), A = new Builder();
      A.add(skirtGeo(0.09, 0.2, 0.52, 10, 0.12, 6 + sx, 2), robe, { p: [0, -0.52, 0], flat: true });
      A.add(G.sph(0.1, 10, 8), robe);
      A.add(G.sph(0.06, 8, 6), hand, { p: [0, -0.56, 0] });
      for (var f = 0; f < 4; f++) A.add(clawGeo(0.11, 0.014), C('#1a0c18'), { p: [(f - 1.5) * 0.025, -0.6, 0.03], r: [-0.3, 0, 0] });
      p.add(A.build()); p.rotation.z = sx * 0.24; p.userData.rest = sx * 0.24; return p;
    }
    var armL = arm(1), armR = arm(-1);
    var staff = pivot(armR, 0, -0.56, 0.02);
    var S = new Builder();
    S.add(hornGeo([[0, -0.55, 0], [0.03, 0.0, 0.02], [-0.02, 0.6, -0.02], [0.02, 1.2, 0.0]], 0.04, 0.03, 6, 14, 6), wood);
    for (var pr = 0; pr < 3; pr++) {
      var pa = pr * TAU / 3;
      S.add(hornGeo([[Math.cos(pa) * 0.03, 1.18, Math.sin(pa) * 0.03], [Math.cos(pa) * 0.14, 1.32, Math.sin(pa) * 0.14], [Math.cos(pa) * 0.13, 1.5, Math.sin(pa) * 0.13], [Math.cos(pa) * 0.04, 1.6, Math.sin(pa) * 0.04]], 0.03, 0.004, 0, 8, 5), bone);
    }
    S.glow(G.sph(0.1, 14, 10), green, { p: [0, 1.38, 0] });
    S.add(G.box(0.025, 0.1, 0.02), '#0a0610', { p: [0, 1.38, 0.098] });
    S.add(G.tor(0.05, 0.016, 4, 10), wood, { p: [0, 1.16, 0], r: [PI / 2, 0, 0] });
    staff.add(S.build());
    var oh = halo(green, 0.8, 0.85); oh.position.set(0, 1.38, 0); staff.add(oh);
    var runes = pivot(body, 0, 1.0, 0), RU = new Builder();
    ['zig', 'crescent', 'tri'].forEach(function (g, i) { var a = i * TAU / 3; glyph(RU, g, [Math.sin(a) * 0.74, 0, Math.cos(a) * 0.74], [Math.sin(a), 0, Math.cos(a)], 0.26, green); });
    runes.add(RU.build());
    eyeHalos(root, head, [[-0.11, 0.02, 0.31], [0.11, 0.02, 0.31]], eyeC, 0.24);
    root.userData.aura = { r: 0.6, h: 1.6, y0: 0.0, size: 0.5, smoke: 14, smokeAlpha: 0.48, smokeColor: dk(c, 0.75), embers: 12, emberColor: green, emberSize: 0.05, pool: 0.95, life: 2.6, emberLife: 1.7 };
    root.userData.skinOpts = { rim: '#9a6aff', rimStrength: 0.5 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk', br = Math.sin(t * 2.0);
      upper.rotation.set(0.08 * d, 0, Math.sin(t * 1.3) * 0.03); head.rotation.set(0.12 * d, Math.sin(t * 0.7) * 0.15 * (1 - d), 0); head.position.y = 0.33 + br * 0.01;
      robeP.rotation.set(0, 0, 0); robeP.scale.set(1 + br * 0.012, 1, 1 + br * 0.012);
      armL.rotation.set(-0.3 * d + Math.sin(t * 1.9) * 0.05, 0, armL.userData.rest + 0.35 * d); armR.rotation.set(-0.2 - 0.6 * d, 0, armR.userData.rest);
      staff.rotation.set(0.2 + 0.4 * d, 0, 0.24);
      runes.rotation.set(0, t * (0.8 + 1.6 * e.cast + 2.5 * e.taunt), 0); runes.position.y = 1.0 + Math.sin(t * 1.4) * 0.06;
      runes.scale.setScalar(1 + 0.25 * e.taunt + 0.1 * d);
      body.position.y = Math.sin(t * 1.6) * 0.02;
      if (walk) {
        var s = t * 6.5, sw = Math.sin(s);
        robeP.rotation.y = sw * 0.14; body.position.y = Math.abs(sw) * 0.03; upper.rotation.x = 0.12;
        armL.rotation.x = -sw * 0.35; armR.rotation.x = -0.2 + sw * 0.2;
      }
      if (e.wind) { armR.rotation.x -= 2.2 * e.wind; staff.rotation.x += 0.6 * e.wind; armL.rotation.x -= 0.9 * e.wind; armL.rotation.z += 0.5 * e.wind; upper.rotation.x -= 0.15 * e.wind; head.rotation.x -= 0.15 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 1.2 * e.lunge; staff.rotation.x += 1.2 * e.lunge; upper.rotation.x += 0.2 * e.lunge; armL.rotation.x -= 0.5 * e.lunge; }
      if (e.taunt) { armR.rotation.x -= 2.6 * e.taunt; armL.rotation.z += 1.1 * e.taunt; armL.rotation.x -= 0.5 * e.taunt; head.rotation.x -= 0.35 * e.taunt; upper.rotation.x -= 0.15 * e.taunt; body.position.y += 0.12 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.5 * e.hit; armR.rotation.z -= 0.5 * e.hit; }
      if (e.fall) { upper.rotation.x += 0.6 * e.fall; head.rotation.x += 0.4 * e.fall; robeP.scale.y = 1 - 0.3 * e.fall; upper.position.y = 1.05 - 0.4 * e.fall; armL.rotation.z += 0.5 * e.fall; armR.rotation.z -= 0.6 * e.fall; }
      else upper.position.y = 1.05;
    }, { fallX: -0.2, sink: 0.05 });
    return root;
  };

  // ---------------- Nyx the Herald (final boss) ----------------
  E.herald = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#2a1640'), gown = dk(c, 0.22), gownD = dk(c, 0.62), dark = C('#0d0716'), skin = C('#d8c8f0'), hair = C('#160b24');
    var eyeC = C(EL ? BURN : HOLLOW_GREEN), violet = C(HOLLOW_VIOLET), gold = C('#c9a24a'), green = C(HOLLOW_GREEN);
    var b = base(), root = b.root, body = b.body;
    var fl = pivot(body);
    var B = new Builder();
    B.add(G.lathe([[0, 0.3], [0.95, 0.3], [1.05, 0.44], [0.8, 0.95], [0.52, 1.6], [0.34, 2.1], [0.38, 2.3], [0.42, 2.5], [0.24, 2.7], [0, 2.72]], 22), gown);
    B.add(skirtGeo(0.56, 1.12, 1.3, 24, 0.45, 13, 4), gownD, { p: [0, 0.56, 0], flat: true });
    B.glow(skirtGeo(1.12, 1.13, 0.05, 24, 0.45, 13, 1, true), violet, { p: [0, 0.545, 0] });
    for (var v = 0; v < 6; v++) {
      var va = -0.9 + v * 0.36, pts = [];
      for (var q = 0; q < 4; q++) { var y = 0.7 + q * 0.42, rr = 0.98 - (y - 0.44) * 0.44; pts.push([Math.sin(va + Math.sin(q * 2 + v) * 0.05) * rr * 1.02, y, Math.cos(va) * rr * 1.02]); }
      vein(B, pts, 0.02, violet);
    }
    B.add(G.tor(0.36, 0.04, 5, 20), gold, { p: [0, 2.1, 0], r: [PI / 2, 0, 0] });
    B.add(G.tor(0.4, 0.03, 5, 20), gold, { p: [0, 2.32, 0], r: [PI / 2, 0, 0] });
    glyph(B, 'eye', [0, 2.3, 0.38], [0, 0.1, 1], 0.22, green);
    [-1, 1].forEach(function (sx) {
      B.add(G.hemi(0.3, 14, 6), gownD, { p: [sx * 0.38, 2.5, 0], r: [0, 0, -sx * 0.35], s: [1.1, 0.7, 1.1], flat: true });
      B.add(G.tor(0.3, 0.025, 4, 16), gold, { p: [sx * 0.38, 2.5, 0], r: [PI / 2, 0, -sx * 0.35], s: [1.1, 1.1, 1] });
      for (var s2 = 0; s2 < 3; s2++) {
        B.add(G.cone(0.05, 0.42 - s2 * 0.08, 4), dark, { p: [sx * (0.5 + s2 * 0.06), 2.72 - s2 * 0.07, -0.12 + s2 * 0.12], r: [0, 0, -sx * (0.45 + s2 * 0.2)], flat: true });
        B.glow(G.cone(0.018, 0.1, 4), violet, { p: [sx * (0.6 + s2 * 0.1), 2.9 - s2 * 0.1, -0.12 + s2 * 0.12], r: [0, 0, -sx * (0.45 + s2 * 0.2)] });
      }
    });
    for (var j = 0; j < 9; j++) {
      var aa = -PI / 2 + (j / 8) * PI;
      B.add(G.cone(0.06, 0.7 - Math.abs(j - 4) * 0.08, 4), dark, { p: [Math.sin(aa) * 0.34, 2.9, -Math.abs(Math.cos(aa)) * 0.12 - 0.12], r: [-0.45, 0, -Math.sin(aa) * 0.75], flat: true });
    }
    fl.add(B.build());
    // shadow-blade wings
    function wing(sx) {
      var p = pivot(fl, sx * 0.2, 2.45, -0.28), WB = new Builder();
      [[0.45, 1.5, 0.16], [0.9, 1.75, 0.18], [1.35, 1.4, 0.15]].forEach(function (fw) {
        var len = fw[1], w = fw[2];
        var s = new T.Shape(); s.moveTo(0, 0); s.lineTo(w, len * 0.35); s.lineTo(w * 0.35, len * 0.86); s.lineTo(0, len); s.lineTo(-w * 0.55, len * 0.5); s.lineTo(0, 0);
        var m = mtx({ r: [-0.25, 0, -sx * fw[0]] });
        WB.add(new T.ShapeGeometry(s), dark, { matrix: m });
        WB.add(new T.ShapeGeometry(s), dark, { matrix: m.clone().multiply(mtx({ r: [0, PI, 0] })) });
        WB.glow(hornGeo([[0, 0.05, 0.012], [0.0, len * 0.5, 0.016], [0, len * 0.97, 0.012]], 0.018, 0.004, 0, 6, 4), violet, { matrix: m });
      });
      p.add(WB.build()); return p;
    }
    var wL = wing(1), wR = wing(-1);
    var head = pivot(fl, 0, 2.97, 0.02); head.scale.setScalar(1.12);
    var H = new Builder();
    H.add(G.sph(0.24, 18, 14), skin, { s: [0.92, 1.05, 0.95] });
    H.add(G.cyl(0.07, 0.08, 0.22, 8), skin, { p: [0, -0.25, 0] });
    [-1, 1].forEach(function (sx) {
      angryEye(H, [sx * 0.085, 0.01, 0.205], sx, eyeC, 0.042, { tilt: 0.38, squint: 0.5, socket: '#1a0a28' });
      H.add(G.box(0.12, 0.024, 0.03), dark, { p: [sx * 0.085, 0.065, 0.205], r: [0, 0, sx * 0.42] });
      H.add(G.cone(0.012, 0.09, 3), dark, { p: [sx * 0.15, -0.03, 0.18], r: [0, 0, sx * 0.3] });
      H.glow(G.box(0.008, 0.06, 0.008), violet, { p: [sx * 0.12, -0.08, 0.19], r: [0, 0, sx * 0.2] });
    });
    H.glow(G.sph(1, 10, 8), eyeC, { p: [0, 0.13, 0.205], s: [0.022, 0.05, 0.02] });
    H.add(G.sph(1, 10, 8), '#1a0a28', { p: [0, 0.13, 0.198], s: [0.035, 0.065, 0.025] });
    H.add(G.box(0.08, 0.022, 0.02), '#3a0a3a', { p: [0, -0.12, 0.215] });
    H.add(new T.SphereGeometry(0.256, 16, 10, PI, PI, 0, PI * 0.8), hair, { p: [0, 0.01, -0.01] });
    H.add(G.cone(0.22, 1.4, 8), hair, { p: [0, -0.6, -0.24], r: [0.2, 0, 0], flat: true });
    [-1, 1].forEach(function (sx) {
      H.add(G.cone(0.1, 1.0, 6), hair, { p: [sx * 0.2, -0.5, -0.1], r: [0.1, 0, sx * 0.12], flat: true });
      H.add(G.cone(0.06, 0.6, 5), hair, { p: [sx * 0.27, -0.2, -0.18], r: [0.4, 0, sx * 0.6], flat: true });
    });
    for (var k2 = 0; k2 < 5; k2++) H.add(G.cone(0.03, 0.2 + (k2 === 2 ? 0.14 : 0), 4), dark, { p: [-0.14 + k2 * 0.07, 0.26 + (k2 === 2 ? 0.06 : 0), 0.08], flat: true });
    head.add(H.build());
    var crown = pivot(head, 0, 0.12, -0.32);
    var CR = new Builder();
    CR.add(G.cyl(0.55, 0.55, 0.05, 28), dark, { r: [PI / 2, 0, 0] });
    CR.glow(G.tor(0.59, 0.05, 6, 36), violet, {});
    CR.glow(G.tor(0.42, 0.018, 4, 28), green, { p: [0, 0, 0.03] });
    for (var sp = 0; sp < 16; sp++) {
      var sa = sp * TAU / 16, long = sp % 2 === 0;
      CR.add(G.cone(long ? 0.05 : 0.035, long ? 0.62 : 0.32, 4), dark, { p: [Math.cos(sa) * (long ? 0.9 : 0.76), Math.sin(sa) * (long ? 0.9 : 0.76), -0.01], r: [0, 0, sa - PI / 2], flat: true });
      CR.glow(G.cone(long ? 0.02 : 0.015, 0.14, 4), long ? eyeC : violet, { p: [Math.cos(sa) * (long ? 1.18 : 0.9), Math.sin(sa) * (long ? 1.18 : 0.9), 0], r: [0, 0, sa - PI / 2] });
    }
    if (EL) { CR.add(G.tor(0.68, 0.03, 5, 36), C(ELITE_GOLD), { p: [0, 0, -0.02] }); for (var eg = 0; eg < 8; eg++) { var ea = eg * TAU / 8 + PI / 16; CR.add(G.cone(0.03, 0.3, 4), C(ELITE_GOLD), { p: [Math.cos(ea) * 0.82, Math.sin(ea) * 0.82, -0.02], r: [0, 0, ea - PI / 2] }); } }
    crown.add(CR.build());
    var crownHalo = halo(violet, 2.3, 0.45); crown.add(crownHalo);
    function arm(sx) {
      var p = pivot(fl, sx * 0.4, 2.5, 0), A = new Builder();
      A.add(G.cyl(0.065, 0.075, 0.5, 8), gown, { p: [0, -0.25, 0] });
      A.add(skirtGeo(0.08, 0.3, 0.55, 12, 0.16, 11 + sx, 2), gown, { p: [0, -1.02, 0], flat: true });
      A.add(G.tor(0.09, 0.022, 4, 12), gold, { p: [0, -0.5, 0], r: [PI / 2, 0, 0] });
      A.add(G.sph(0.06, 8, 6), skin, { p: [0, -0.98, 0] });
      for (var f = 0; f < 4; f++) A.add(hornGeo([[(f - 1.5) * 0.025, -1.0, 0.02], [(f - 1.5) * 0.045, -1.1, 0.06], [(f - 1.5) * 0.05, -1.2, 0.14]], 0.014, 0.002, 0, 6, 4), dark);
      p.add(A.build()); p.rotation.z = sx * 0.3; p.userData.rest = sx * 0.3; return p;
    }
    var armL = arm(1), armR = arm(-1);
    var orb = new T.Mesh(G.sph(0.15, 14, 12), M.glow(eyeC)); orb.position.set(0, -1.14, 0.06); armL.add(orb);
    var OB = new Builder(); OB.add(G.box(0.03, 0.14, 0.02), '#0a0610', { p: [0, -1.14, 0.205] }); armL.add(OB.build());
    var orbHalo = halo(eyeC, 1.0, 0.9); orbHalo.position.copy(orb.position); armL.add(orbHalo);
    var shards = pivot(fl, 0, 1.7, 0);
    var shardMeshes = [];
    for (var n = 0; n < 8; n++) {
      var sm = new T.Mesh(G.oct(0.14), M.glow(n % 2 ? violet : eyeC));
      sm.scale.set(0.55, 1.6, 0.55); sm.userData.noMeasure = true;
      shards.add(sm); shardMeshes.push(sm);
    }
    eyeHalos(root, head, [[-0.085, 0.01, 0.225], [0.085, 0.01, 0.225], [0, 0.13, 0.22]], eyeC, 0.2);
    root.userData.aura = { r: 1.2, h: 3.4, y0: 0.2, size: 0.85, smoke: 22, smokeAlpha: 0.48, smokeColor: '#140a22', smokeColor2: '#24103e', embers: 24, emberColor: violet, emberColors: [violet, green], emberSize: 0.08, pool: 1.9, life: 3.4, emberLife: 2.4 };
    root.userData.skinOpts = { rim: '#b78aff', rimStrength: 0.55 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel;
      fl.position.set(0, 0.28 + Math.sin(t * 1.4) * 0.14, 0);
      fl.rotation.set((state === 'walk' ? 0.12 : 0) + 0.04 * d, 0, Math.sin(t * 0.9) * 0.025);
      fl.scale.set(1, 1, 1);
      armL.rotation.set(-0.5 + Math.sin(t * 1.3) * 0.08 - 0.3 * d, 0, 0.3); armR.rotation.set(Math.sin(t * 1.3 + 1) * 0.08 - 0.4 * d, 0, -0.3 - 0.2 * d);
      head.rotation.set(0.06 * d, Math.sin(t * 0.5) * 0.15 * (1 - d), 0);
      crown.rotation.z = t * 0.4;
      var wf = Math.sin(t * 1.1) * 0.06 + 0.12 * d;
      wL.rotation.set(0, 0, -wf); wR.rotation.set(0, 0, wf);
      var r = 1.35 + e.cast * 0.35 + e.taunt * 0.6;
      for (var q = 0; q < shardMeshes.length; q++) {
        var a2 = t * 0.9 + q * TAU / shardMeshes.length;
        shardMeshes[q].position.set(Math.cos(a2) * r, Math.sin(t * 2 + q) * 0.35 + (q % 2) * 0.4, Math.sin(a2) * r);
        shardMeshes[q].rotation.y = t * 2 + q;
      }
      var os = 1.0 * (1 + Math.sin(t * 4) * 0.1 + e.cast * 1.2 + e.taunt);
      orbHalo.scale.set(os, os, 1);
      var ch = 2.3 * (1 + e.cast * 0.5 + e.taunt * 0.6 + Math.sin(t * 2) * 0.05) * (e.dead ? 1 - smooth(0.3, 1.2, e.k) : 1); crownHalo.scale.set(ch, ch, 1);
      if (e.wind) { armL.rotation.x -= 1.6 * e.wind; armR.rotation.x -= 2.0 * e.wind; armL.rotation.z += 0.4 * e.wind; armR.rotation.z -= 0.4 * e.wind; fl.position.y += 0.2 * e.wind; head.rotation.x -= 0.15 * e.wind; }
      if (e.lunge) { armL.rotation.x -= 0.8 * e.lunge; armR.rotation.x -= 0.6 * e.lunge; armL.rotation.z -= 0.2 * e.lunge; fl.position.z += 0.2 * e.lunge; }
      if (e.taunt) {
        fl.position.y += 0.4 * e.taunt; armL.rotation.x -= 1.6 * e.taunt; armR.rotation.x -= 2.2 * e.taunt; armL.rotation.z += 0.6 * e.taunt; armR.rotation.z -= 0.6 * e.taunt;
        wL.rotation.z -= 0.35 * e.taunt; wR.rotation.z += 0.35 * e.taunt; head.rotation.x -= 0.25 * e.taunt;
      }
      if (e.hit) { armL.rotation.z += 0.3 * e.hit; armR.rotation.z -= 0.3 * e.hit; }
      if (e.fall) {
        fl.position.y *= 1 - e.fall; fl.scale.set(1, 1 - 0.3 * e.fall, 1); wL.rotation.z += 0.5 * e.fall; wR.rotation.z -= 0.5 * e.fall;
        armL.rotation.x *= 1 - e.fall; armR.rotation.x *= 1 - e.fall; head.rotation.x += 0.5 * e.fall;
      }
    }, { hitScale: 0.6, lungeScale: 0.5, fallX: -0.15, sink: 0.05 });
    b.scaler.scale.setScalar(1.12);
    return root;
  };

  // ==================================================================
  // ---- v1.2 WS6: Hollow Orrery enemies (model keys used by WS4's enemies_dungeon.js)
  //  shardhound  crystal-backed hound (mob)            seer      floating astronomer-cultist with a glowing lens (mob)
  //  sentinel    Orrery Sentinel: brass-and-obsidian construct with a ring of orbiting rune-stones (boss)
  //  warden      Warden Morrow: tall corrupted Lumen knight-mage, tattered star cloak, lantern-staff (boss)
  //  archon      The Starless Archon: huge floating robed figure, cracked mask, orbiting dark planets (final boss)
  //  Palette: obsidian + tarnished orrery brass + cold star-light (cyan / violet), Hollow-green corruption.
  //  Every model uses erig (idle, walk/glide, cast, hit, taunt, duel_idle, defeat with dissolve) and packs with
  //  skinify: body 1 + shadow 1 + one halo/aura batch = 3 draw calls.
  // ==================================================================
  var VLT = { cyan: '#8feaff', violet: '#b48cff', brass: '#c99a3e', obsidian: '#1d1830', star: '#fff3d2', ivory: '#d6cdb8' };
  // faceted crystal shard (lit facets) with a thinner glowing core that pokes out of the point
  function shardOn(B, p, r, rad, h, col, glowC) {
    B.add(crystalGeo(rad, h, rad * 2.3), col, { p: p, r: r });
    if (glowC) B.glow(crystalGeo(rad * 0.45, h * 1.2, rad * 1.5), glowC, { p: p, r: r });
  }

  // ---------------- Shardhound: obsidian hound with crystal spires bursting from its spine ----------------
  E.shardhound = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#3a3256'), hide = dk(c, 0.4), hideL = sh(dk(c, 0.22), 0.06), dark = dk(c, 0.78);
    var cry = C(VLT.cyan), cry2 = C(VLT.violet), eyeC = C(EL ? BURN : HOLLOW_GREEN), gold = C(ELITE_GOLD), tooth = C('#e6f6ff');
    var cryG = sh(cry, 0.25), cry2G = sh(cry2, 0.25);
    var b = base(), root = b.root, body = b.body;
    var torso = pivot(body);
    var B = new Builder();
    B.add(G.sph(0.5, 10, 8), hide, { p: [0, 1.02, 0.34], s: [0.84, 0.82, 0.92], flat: true });
    B.add(G.sph(0.4, 10, 7), hide, { p: [0, 0.96, -0.24], s: [0.62, 0.6, 1.1], flat: true });
    B.add(G.sph(0.38, 10, 8), hide, { p: [0, 0.95, -0.64], s: [0.78, 0.76, 0.8], flat: true });
    B.add(G.sph(0.34, 9, 7), hideL, { p: [0, 0.82, 0.62], s: [0.82, 0.9, 0.7], flat: true });
    B.add(G.cyl(0.2, 0.3, 0.44, 8), hide, { p: [0, 1.14, 0.7], r: [0.9, 0, 0], flat: true });
    // stone armour plates down the back, glowing fault-lines in the hide
    for (var i = 0; i < 6; i++) B.add(rbox(0.36 - i * 0.02, 0.09, 0.24, 0.03), dark, { p: [0, 1.31 - i * 0.025 - (i > 3 ? (i - 3) * 0.03 : 0), 0.42 - i * 0.22], r: [0.12 + i * 0.03, 0, 0], flat: true });
    [-1, 1].forEach(function (sx) {
      vein(B, [[sx * 0.36, 1.1, 0.42], [sx * 0.4, 0.96, 0.2], [sx * 0.31, 1.02, -0.05], [sx * 0.29, 0.92, -0.3], [sx * 0.33, 1.0, -0.56]], 0.02, cry);
      vein(B, [[sx * 0.4, 0.88, 0.4], [sx * 0.36, 0.76, 0.24]], 0.015, cry);
      shardOn(B, [sx * 0.34, 1.08, 0.46], [0.2, 0, -sx * 0.9], 0.05, 0.22, cry2, cry2G);      // shoulder shards
      shardOn(B, [sx * 0.3, 1.0, -0.66], [-0.3, 0, -sx * 0.8], 0.04, 0.16, cry, null);
    });
    if (EL) spikesOn(B, [0, 0.95, -0.28], [0.25, 0.24, 0.44], [[0.7, 0.6, 0.1], [-0.7, 0.6, 0.1], [0.7, 0.5, -0.5], [-0.7, 0.5, -0.5]], 0.17, 0.045, dark, { tips: gold });
    torso.add(B.build());
    // crystal spires along the spine (own pivot: they rise and flare on taunt)
    var crest = pivot(torso, 0, 1.3, 0), CB = new Builder();
    [[0.48, 0.0, 0.92], [0.26, 0.02, 1.15], [0.03, 0.0, 1.32], [-0.2, -0.02, 1.08], [-0.42, -0.04, 0.94], [-0.64, -0.08, 0.76], [-0.84, -0.13, 0.56]].forEach(function (s, n) {
      var z = s[0], y = s[1], k = s[2] * (EL ? 1.15 : 1), c1 = n % 2 ? cry2 : cry, g1 = n % 2 ? cry2G : cryG;
      shardOn(CB, [0, y, z], [-0.5, 0, 0], 0.075 * k, 0.4 * k, c1, g1);
      shardOn(CB, [0.075, y - 0.03, z + 0.03], [-0.42, 0, -0.55], 0.05 * k, 0.24 * k, n % 2 ? cry : cry2, null);
      shardOn(CB, [-0.075, y - 0.03, z - 0.03], [-0.6, 0, 0.6], 0.045 * k, 0.2 * k, cry, null);
      if (EL && n % 2 === 0) CB.add(G.tor(0.09 * k, 0.014, 4, 12), gold, { p: [0, y + 0.02, z], r: [PI / 2 - 0.5, 0, 0] });
    });
    crest.add(CB.build());
    var crH1 = halo(cry, 0.9, 0.55); crH1.position.set(0, 0.35, 0.03); crest.add(crH1);
    var crH2 = halo(cry2, 0.7, 0.5); crH2.position.set(0, 0.25, 0.42); crest.add(crH2);
    // long angular head, crystal horns
    var head = pivot(torso, 0, 1.3, 0.92); head.scale.setScalar(1.15);
    var H = new Builder();
    H.add(G.sph(0.24, 10, 8), hide, { s: [0.95, 0.82, 1.1], flat: true });
    H.add(rbox(0.2, 0.14, 0.44, 0.04), hideL, { p: [0, -0.05, 0.3], r: [0.14, 0, 0] });
    H.add(rbox(0.15, 0.06, 0.36, 0.02), dark, { p: [0, 0.035, 0.28], r: [0.12, 0, 0] });
    H.add(G.sph(0.04, 8, 6), '#0a0812', { p: [0, -0.01, 0.53], s: [1.3, 0.8, 0.8] });
    H.add(G.box(0.16, 0.05, 0.3), '#14081e', { p: [0, -0.13, 0.31] });
    fangRow(H, [0, -0.11, 0.44], 0.055, 4, 0.06, 0.015, tooth, true, { back: 0.1 });
    [-1, 1].forEach(function (sx) {
      H.add(G.cone(0.028, 0.12, 5), tooth, { p: [sx * 0.07, -0.17, 0.38], r: [PI, 0, sx * 0.1] });
      angryEye(H, [sx * 0.1, 0.05, 0.2], sx, eyeC, 0.058, { tilt: 0.5, yaw: 0.35, squint: 0.46 });
      brow(H, [sx * 0.1, 0.11, 0.22], sx, 0.15, dark, { ang: 0.55, rx: 0.5 });
      shardOn(H, [sx * 0.12, 0.14, -0.02], [-1.0, 0, -sx * 0.3], 0.055, 0.42, cry, cryG);
      shardOn(H, [sx * 0.17, 0.07, 0.04], [-1.3, 0, -sx * 0.8], 0.03, 0.18, cry2, null);
      H.add(G.cone(0.065, 0.22, 4), hide, { p: [sx * 0.15, 0.17, -0.14], r: [-0.95, 0, -sx * 0.4], flat: true });
      vein(H, [[sx * 0.11, -0.07, 0.44], [sx * 0.13, -0.03, 0.28], [sx * 0.17, 0.03, 0.12]], 0.011, cry);
      if (EL) H.add(hornGeo([[sx * 0.1, 0.18, 0.02], [sx * 0.2, 0.32, -0.04], [sx * 0.24, 0.4, 0.08]], 0.04, 0.003, 3, 10, 6), gold);
    });
    head.add(H.build());
    var jaw = pivot(head, 0, -0.13, 0.08), J = new Builder();
    J.add(rbox(0.15, 0.06, 0.36, 0.02), hide, { p: [0, -0.02, 0.18] });
    J.add(G.box(0.11, 0.025, 0.28), '#14081e', { p: [0, 0.03, 0.18] });
    J.glow(G.box(0.06, 0.02, 0.2), sh(cry, -0.25), { p: [0, 0.04, 0.15] });
    fangRow(J, [0, 0.03, 0.31], 0.045, 4, 0.045, 0.012, cry, false, {});
    jaw.add(J.build());
    var legs = [];
    [[1, 0.45, 1], [-1, 0.45, 1], [1, -0.62, 0], [-1, -0.62, 0]].forEach(function (lp) {
      var p = pivot(torso, lp[0] * 0.23, lp[2] ? 1.0 : 0.95, lp[1]), L = new Builder();
      if (lp[2]) {
        L.add(G.cyl(0.15, 0.1, 0.52, 7), hideL, { p: [0, -0.26, 0], flat: true });
        L.add(G.cyl(0.095, 0.072, 0.44, 7), hide, { p: [0, -0.68, -0.02], flat: true });
        shardOn(L, [lp[0] * 0.05, -0.48, -0.08], [-2.3, 0, -lp[0] * 0.3], 0.03, 0.12, cry, null);
      } else {
        L.add(G.cyl(0.15, 0.09, 0.44, 7), hide, { p: [0, -0.18, 0.06], r: [-0.42, 0, 0], flat: true });
        L.add(G.cyl(0.075, 0.06, 0.42, 7), hide, { p: [0, -0.56, -0.04], r: [0.38, 0, 0], flat: true });
      }
      L.add(G.sph(0.1, 8, 6), dark, { p: [0, -0.9, 0.04], s: [1, 0.55, 1.35] });
      for (var j = -1; j <= 1; j++) L.add(clawGeo(0.08, 0.018), cry2, { p: [j * 0.04, -0.9, 0.14], r: [0, j * 0.2, 0] });
      p.add(L.build()); legs.push(p);
    });
    var tail = pivot(torso, 0, 1.0, -0.95), TB = new Builder();
    for (var t2 = 0; t2 < 4; t2++) TB.add(G.sph(0.11 - t2 * 0.018, 8, 6), t2 % 2 ? dark : hide, { p: [0, 0.06 + t2 * 0.1, -0.1 - t2 * 0.15], flat: true });
    shardOn(TB, [0, 0.38, -0.64], [-1.0, 0, 0], 0.06, 0.26, cry2, cry2G);
    tail.add(TB.build());
    eyeHalos(root, head, [[-0.1, 0.05, 0.24], [0.1, 0.05, 0.24]], eyeC, 0.22);
    root.userData.aura = { r: 0.8, h: 1.2, y0: 0.0, size: 0.5, smoke: 12, smokeAlpha: 0.42, smokeColor: dk(c, 0.72), embers: 12, emberColor: cry, emberColors: [cry, cry2], emberSize: 0.06, pool: 1.05, life: 2.6, emberLife: 1.6, glow: cry };
    root.userData.skinOpts = { rim: '#7fd8ff', rimStrength: 0.48, edge: VLT.cyan };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk', gr = pulse(t, 3.1, 0.7), br = Math.sin(t * 2.6);
      head.rotation.set(0.16 + 0.12 * d, Math.sin(t * 0.8) * 0.2 * (1 - d), 0); tail.rotation.set(-0.15 * d + Math.sin(t * 1.7) * 0.06, Math.sin(t * 2.2) * 0.25, 0);
      torso.rotation.set(0, 0, 0); torso.scale.set(1 + br * 0.018, 1 + br * 0.018, 1);
      legs.forEach(function (l) { l.rotation.set(0, 0, 0); });
      var jo = 0.05 + 0.12 * d + gr * 0.2;
      var fl = 1 + 0.12 * gr + 0.18 * d + 0.6 * e.taunt + 0.45 * e.cast;
      crest.scale.set(1, 1 + 0.04 * gr + 0.12 * e.taunt, 1); crest.position.y = 1.3 + 0.05 * e.taunt;
      crH1.scale.setScalar(0.9 * fl); crH2.scale.setScalar(0.7 * fl);
      if (walk) {
        var s = t * 8.2, sw = Math.sin(s);
        legs[0].rotation.x = sw * 0.62; legs[3].rotation.x = sw * 0.62; legs[1].rotation.x = -sw * 0.62; legs[2].rotation.x = -sw * 0.62;
        body.position.y = Math.abs(Math.cos(s)) * 0.05 - 0.04; torso.rotation.z = sw * 0.05;
        head.rotation.x = 0.3 + Math.sin(s * 2) * 0.04; head.rotation.y = 0; tail.rotation.y = sw * 0.35; jo = 0.08;
      } else {
        body.position.y = -0.12 * d;
        legs[0].rotation.set(-0.12 * d, 0, 0.12 * d); legs[1].rotation.set(-0.12 * d, 0, -0.12 * d);
        legs[2].rotation.x = 0.18 * d; legs[3].rotation.x = 0.18 * d; torso.rotation.x = 0.07 * d;
      }
      if (e.wind) { body.position.y -= 0.15 * e.wind; head.rotation.x += 0.2 * e.wind; legs.forEach(function (l, n) { l.rotation.x += (n < 2 ? 0.3 : 0.38) * e.wind; }); jo += 0.2 * e.wind; }
      if (e.lunge) { body.position.y += 0.2 * e.lunge; legs[0].rotation.x -= 1.0 * e.lunge; legs[1].rotation.x -= 1.0 * e.lunge; legs[2].rotation.x += 0.5 * e.lunge; legs[3].rotation.x += 0.5 * e.lunge; head.rotation.x -= 0.25 * e.lunge; jo += 0.6 * e.lunge; }
      if (e.taunt) { head.rotation.x -= 1.1 * e.taunt; head.rotation.y = 0; torso.rotation.x -= 0.24 * e.taunt; jo += 0.6 * e.roar; legs[0].rotation.x -= 0.3 * e.taunt; legs[1].rotation.x -= 0.3 * e.taunt; }
      if (e.hit) { jo += 0.2 * e.hit; head.rotation.x -= 0.3 * e.hit; }
      if (e.fall) {
        body.rotation.z += 1.2 * e.fall; body.position.y -= 0.05 * e.fall; body.position.x += 0.72 * e.fall;
        legs.forEach(function (l, n) { l.rotation.x = (n % 2 ? 0.4 : -0.3) * e.fall; l.rotation.z = -0.3 * e.fall; });
        head.rotation.x = head.rotation.x * (1 - e.fall) + 0.3 * e.fall; jo = jo * (1 - e.fall) + 0.4 * e.fall;
      }
      jaw.rotation.set(Math.min(0.8, jo), 0, 0);
    }, { customFall: true, lungeScale: 1.4 });
    return root;
  };

  // ---------------- Orrery Seer: hooded floating astronomer-cultist ----------------
  E.seer = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#2a2458'), robe = dk(c, 0.28), robeD = dk(c, 0.6), brass = C(VLT.brass), brassD = sh(brass, -0.35);
    var lensC = C(EL ? BURN : VLT.cyan), eyeC = C(EL ? BURN : HOLLOW_GREEN), star = C(VLT.star), hand = mix('#a898b8', c, 0.2), gold = C(ELITE_GOLD);
    var b = base(), root = b.root, body = b.body;
    var fl = pivot(body);
    var RB = new Builder();
    RB.add(G.lathe([[0, 0.62], [0.37, 0.58], [0.43, 0.7], [0.37, 1.0], [0.3, 1.28], [0.25, 1.5], [0.19, 1.62], [0, 1.66]], 18), robe);
    RB.add(skirtGeo(0.33, 0.52, 0.78, 16, 0.4, 21, 3), robeD, { p: [0, 0.3, 0], flat: true });
    RB.glow(skirtGeo(0.52, 0.527, 0.03, 16, 0.4, 21, 1, true), lensC, { p: [0, 0.285, 0] });
    RB.add(G.tor(0.34, 0.03, 5, 22), brass, { p: [0, 1.0, 0], r: [PI / 2, 0, 0] });
    RB.add(G.tor(0.36, 0.022, 5, 22), brassD, { p: [0, 0.95, 0], r: [PI / 2, 0, 0] });
    // star-chart embroidery and a hanging astrolabe
    var rs = seeded(41);
    for (var i = 0; i < 18; i++) {
      var a = rs() * TAU, y = 0.45 + rs() * 0.85, rr = y > 1.0 ? lerp(0.37, 0.25, (y - 1.0) / 0.5) : 0.4 + (1.0 - y) * 0.12;
      star4(RB, [Math.sin(a) * (rr + 0.012), y, Math.cos(a) * (rr + 0.012)], [Math.sin(a), 0.2, Math.cos(a)], 0.02 + rs() * 0.02, star, rs() > 0.5);
    }
    vein(RB, [[0.06, 1.3, 0.27], [0.1, 1.05, 0.36], [0.05, 0.75, 0.42]], 0.012, eyeC);
    vein(RB, [[-0.06, 1.3, 0.27], [-0.1, 1.05, 0.36], [-0.05, 0.75, 0.42]], 0.012, eyeC);
    RB.add(G.cyl(0.11, 0.11, 0.02, 20), brass, { p: [0.36, 0.78, 0.18], r: [PI / 2, 0.5, 0] });
    RB.add(G.tor(0.09, 0.01, 4, 18), brassD, { p: [0.37, 0.78, 0.2], r: [0, 0.5, 0] });
    RB.add(G.box(0.16, 0.01, 0.01), brassD, { p: [0.37, 0.78, 0.2], r: [0, 0.5, 0.6] });
    RB.add(G.cyl(0.006, 0.006, 0.2, 4), brassD, { p: [0.33, 0.9, 0.16] });
    if (EL) RB.add(G.tor(0.52, 0.03, 5, 24), gold, { p: [0, 0.38, 0], r: [PI / 2, 0, 0] });
    fl.add(RB.build());
    var upper = pivot(fl, 0, 1.5, 0);
    var UB = new Builder();
    UB.add(skirtGeo(0.18, 0.46, 0.32, 14, 0.12, 9, 2), robeD, { p: [0, -0.2, 0], flat: true });
    UB.add(G.tor(0.44, 0.018, 4, 22), brass, { p: [0, -0.19, 0], r: [PI / 2, 0, 0] });
    for (var s2 = 0; s2 < 5; s2++) { var sa = -0.9 + s2 * 0.45; UB.add(G.cone(0.025, 0.12, 4), brass, { p: [Math.sin(sa) * 0.42, -0.24, Math.cos(sa) * 0.36], r: [PI, 0, 0], flat: true }); }
    upper.add(UB.build());
    // the astrolabe ring behind the shoulders (its rete turns; spins fast while casting)
    var ast = pivot(upper, 0, 0.22, -0.38), AB = new Builder();
    AB.add(G.tor(0.62, 0.03, 5, 44), brass, {});
    AB.add(G.tor(0.52, 0.012, 4, 40), brassD, {});
    for (var tk = 0; tk < 24; tk++) { var ta = tk * TAU / 24; AB.add(G.box(0.012, tk % 2 ? 0.05 : 0.09, 0.012), brass, { p: [Math.cos(ta) * 0.57, Math.sin(ta) * 0.57, 0], r: [0, 0, ta + PI / 2] }); }
    for (var zs = 0; zs < 8; zs++) { var za = zs * TAU / 8 + 0.2; star4(AB, [Math.cos(za) * 0.62, Math.sin(za) * 0.62, 0.03], [0, 0, 1], 0.045, lensC, true); }
    ast.add(AB.build());
    var rete = pivot(ast), RT = new Builder();
    RT.add(G.tor(0.3, 0.014, 4, 30), brass, { p: [0.08, 0.05, 0.01] });
    for (var sp2 = 0; sp2 < 3; sp2++) RT.add(G.box(0.012, 1.04, 0.012), brassD, { r: [0, 0, sp2 * PI / 3] });
    RT.glow(G.sph(0.05, 10, 8), lensC, { p: [0, 0, 0.02] });
    rete.add(RT.build());
    // deep hood; a big brass lens over one eye, a slit of Hollow light for the other
    var head = pivot(upper, 0, 0.3, 0.02);
    var hood = new T.Mesh(new T.SphereGeometry(0.4, 18, 12, PI / 2 + 0.85, TAU - 1.7, 0, PI * 0.68), M.toon(robe, { side: T.DoubleSide }));
    hood.position.set(0, -0.1, -0.02); hood.scale.set(1, 1.12, 1.12); hood.castShadow = true; head.add(hood);
    var H = new Builder();
    H.add(G.sph(0.3, 14, 12), '#07040c');
    H.add(hornGeo([[0, 0.26, -0.12], [0, 0.48, -0.32], [0, 0.56, -0.56], [0, 0.48, -0.74]], 0.2, 0.01, 0, 12, 9), robe);
    H.add(G.tor(0.3, 0.08, 6, 18), robe, { p: [0, -0.3, -0.02], r: [PI / 2 + 0.15, 0, 0] });
    H.add(G.tor(0.39, 0.016, 4, 22, PI * 1.25), brass, { p: [0, -0.1, -0.02], r: [0, 0, -PI * 0.125], s: [1, 1.12, 1.12] });
    for (var dz = 0; dz < 5; dz++) { var dzA = -0.9 + dz * 0.45; H.add(G.cyl(0.004, 0.004, 0.08 + (dz % 2) * 0.04, 3), brassD, { p: [Math.sin(dzA) * 0.4, 0.2, Math.cos(dzA) * 0.33] }); star4(H, [Math.sin(dzA) * 0.4, 0.14 - (dz % 2) * 0.04, Math.cos(dzA) * 0.33 + 0.01], [Math.sin(dzA), 0, Math.cos(dzA)], 0.03, star, true); }
    // the lens (right eye, viewer's left)
    H.add(G.tor(0.105, 0.024, 6, 26), brass, { p: [-0.1, 0.03, 0.27] });
    H.add(G.tor(0.08, 0.008, 4, 22), brassD, { p: [-0.1, 0.03, 0.285] });
    H.glow(G.sph(0.088, 16, 10), lensC, { p: [-0.1, 0.03, 0.27], s: [1, 1, 0.35] });
    H.add(G.sph(0.035, 8, 6), '#06141a', { p: [-0.1, 0.03, 0.3], s: [1, 1, 0.3] });
    for (var lg = 0; lg < 6; lg++) { var la = lg * TAU / 6; H.add(G.box(0.022, 0.03, 0.02), brass, { p: [-0.1 + Math.cos(la) * 0.13, 0.03 + Math.sin(la) * 0.13, 0.265], r: [0, 0, la] }); }
    H.add(G.cyl(0.01, 0.01, 0.22, 5), brassD, { p: [-0.2, -0.06, 0.24], r: [0, 0, 0.9] });
    angryEye(H, [0.11, 0.03, 0.27], 1, eyeC, 0.055, { tilt: 0.45, squint: 0.38, pupil: false, socket: '#07040c' });
    H.glow(G.box(0.1, 0.01, 0.02), sh(eyeC, -0.3), { p: [0.02, -0.12, 0.28] });
    head.add(H.build());
    var lensHalo = halo(lensC, 0.75, 0.85); lensHalo.position.set(-0.1, 0.03, 0.32); head.add(lensHalo);
    function arm(sx) {
      var p = pivot(upper, sx * 0.28, 0.02, 0), A = new Builder();
      A.add(skirtGeo(0.09, 0.2, 0.52, 10, 0.12, 6 + sx, 2), robe, { p: [0, -0.52, 0], flat: true });
      A.add(G.sph(0.1, 10, 8), robe);
      A.add(G.tor(0.17, 0.014, 4, 14), brass, { p: [0, -0.5, 0], r: [PI / 2, 0, 0] });
      A.add(G.sph(0.06, 8, 6), hand, { p: [0, -0.56, 0] });
      for (var f = 0; f < 4; f++) A.add(clawGeo(0.1, 0.013), C('#1a0c18'), { p: [(f - 1.5) * 0.025, -0.6, 0.03], r: [-0.3, 0, 0] });
      p.add(A.build()); p.rotation.z = sx * 0.22; p.userData.rest = sx * 0.22; return p;
    }
    var armL = arm(1), armR = arm(-1);
    // telescope-staff (right hand)
    var staff = pivot(armR, 0, -0.56, 0.02), S = new Builder();
    S.add(G.cyl(0.026, 0.03, 1.5, 8), brassD, { p: [0, 0.35, 0] });
    [[-0.2, 0.036], [0.35, 0.04], [0.85, 0.045]].forEach(function (q) { S.add(G.tor(q[1], 0.012, 4, 12), brass, { p: [0, q[0], 0], r: [PI / 2, 0, 0] }); });
    S.add(G.cyl(0.05, 0.04, 0.24, 12), brass, { p: [0, 1.15, 0] });
    S.add(G.cyl(0.065, 0.05, 0.12, 12), brass, { p: [0, 1.32, 0] });
    S.glow(G.cyl(0.055, 0.055, 0.012, 14), lensC, { p: [0, 1.385, 0] });
    S.add(G.tor(0.12, 0.012, 4, 22), brass, { p: [0, 1.25, 0], r: [PI / 2 - 0.3, 0, 0] });
    staff.add(S.build());
    var sh2 = halo(lensC, 0.55, 0.8); sh2.position.set(0, 1.4, 0); staff.add(sh2);
    // floating armillary sphere over the left palm
    var arml = pivot(armL, 0, -0.78, 0.12), ARB = new Builder();
    ARB.add(G.tor(0.12, 0.009, 4, 24), brass, {});
    ARB.add(G.tor(0.12, 0.009, 4, 24), brass, { r: [PI / 2, 0, 0] });
    ARB.add(G.tor(0.12, 0.007, 4, 24), brassD, { r: [0, PI / 2, 0.4] });
    ARB.glow(G.sph(0.045, 10, 8), lensC, {});
    arml.add(ARB.build());
    eyeHalos(root, head, [[0.11, 0.03, 0.31]], eyeC, 0.22);
    root.userData.aura = { r: 0.6, h: 1.7, y0: 0.2, size: 0.5, smoke: 14, smokeAlpha: 0.45, smokeColor: dk(c, 0.75), embers: 14, emberColor: lensC, emberColors: [lensC, C(VLT.violet), star], emberSize: 0.05, pool: 0.9, life: 2.6, emberLife: 1.8, glow: lensC };
    root.userData.skinOpts = { rim: '#8ab0ff', rimStrength: 0.5, edge: VLT.cyan };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk';
      fl.position.set(0, 0.32 + Math.sin(t * 1.5) * 0.08, 0); fl.rotation.set((walk ? 0.14 : 0) + 0.05 * d, 0, Math.sin(t * 0.8) * 0.03);
      upper.rotation.set(0.08 * d, 0, Math.sin(t * 1.2) * 0.04); head.rotation.set(0.1 * d + Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.6) * 0.18 * (1 - d), 0);
      armL.rotation.set(-0.55 - 0.3 * d + Math.sin(t * 1.6) * 0.05, 0, armL.userData.rest + 0.2 * d); armR.rotation.set(-0.25 - 0.45 * d, 0, armR.userData.rest);
      staff.rotation.set(0.25 + 0.35 * d, 0, 0.15);
      var spin = 0.3 + 2.2 * e.cast + 3.5 * e.taunt;
      rete.rotation.z = -t * 0.35 - (rete.userData.acc = (rete.userData.acc || 0) + dt * (2.2 * e.cast + 3.5 * e.taunt));
      ast.rotation.set(0.05, 0, t * 0.08); ast.scale.setScalar(1 + 0.12 * e.taunt + 0.06 * e.cast);
      arml.rotation.set(t * 0.9, t * 1.3 * (1 + spin * 0.3), 0); arml.position.y = -0.78 + Math.sin(t * 2.1) * 0.03;
      var lf = 1 + 0.08 * Math.sin(t * 3) + 1.4 * e.cast + 0.9 * e.taunt; lensHalo.scale.setScalar(0.75 * lf); sh2.scale.setScalar(0.55 * (1 + e.cast * 1.6));
      if (e.wind) { armR.rotation.x -= 1.8 * e.wind; staff.rotation.x += 0.4 * e.wind; armL.rotation.x -= 0.8 * e.wind; head.rotation.x -= 0.2 * e.wind; fl.position.y += 0.15 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 1.0 * e.lunge; staff.rotation.x += 1.0 * e.lunge; armL.rotation.x -= 0.6 * e.lunge; upper.rotation.x += 0.2 * e.lunge; }
      if (e.taunt) { armL.rotation.z += 1.0 * e.taunt; armR.rotation.z -= 0.6 * e.taunt; armR.rotation.x -= 1.4 * e.taunt; head.rotation.x -= 0.3 * e.taunt; fl.position.y += 0.2 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.4 * e.hit; armR.rotation.z -= 0.4 * e.hit; }
      if (e.fall) { fl.position.y *= 1 - e.fall; upper.rotation.x += 0.6 * e.fall; head.rotation.x += 0.4 * e.fall; upper.position.y = 1.5 - 0.35 * e.fall; armL.rotation.z += 0.5 * e.fall; armR.rotation.z -= 0.5 * e.fall; }
      else upper.position.y = 1.5;
    }, { fallX: -0.2, sink: 0.05, hitScale: 0.8 });
    return root;
  };

  // ---------------- Orrery Sentinel: towering brass-and-obsidian construct (boss) ----------------
  E.sentinel = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#2a2440'), obs = dk(c, 0.35), obsL = sh(dk(c, 0.15), 0.06), obsD = dk(c, 0.7);
    var brass = C(VLT.brass), brassL = sh(brass, 0.18), brassD = sh(brass, -0.38), core = C(EL ? BURN : VLT.cyan), eyeC = C(EL ? BURN : HOLLOW_GREEN), gold = C(ELITE_GOLD);
    var b = base(), root = b.root, body = b.body;
    function leg(sx) {
      var p = pivot(body, sx * 0.44, 1.62, 0), L = new Builder();
      L.add(rbox(0.46, 0.78, 0.5, 0.07), obs, { p: [0, -0.36, 0], flat: true });
      L.add(G.tor(0.27, 0.04, 5, 12), brassD, { p: [0, -0.08, 0], r: [PI / 2, 0, 0] });
      L.add(G.tor(0.26, 0.035, 5, 12), brassD, { p: [0, -0.6, 0], r: [PI / 2, 0, 0] });
      L.add(G.sph(0.21, 12, 8), brass, { p: [0, -0.82, 0.1], s: [1, 0.9, 0.9] });
      L.add(G.cone(0.08, 0.22, 5), brassL, { p: [0, -0.82, 0.34], r: [PI / 2, 0, 0], flat: true });
      L.add(rbox(0.4, 0.62, 0.44, 0.06), obsL, { p: [0, -1.18, 0.02], flat: true });
      L.add(rbox(0.56, 0.24, 0.76, 0.06), obsD, { p: [0, -1.5, 0.12], flat: true });
      L.add(rbox(0.54, 0.13, 0.24, 0.04), brass, { p: [0, -1.47, 0.43], flat: true });
      vein(L, [[sx * 0.21, -0.15, 0.25], [sx * 0.22, -0.4, 0.26], [sx * 0.19, -0.6, 0.23]], 0.017, core);
      vein(L, [[sx * 0.2, -1.0, 0.23], [sx * 0.19, -1.2, 0.23], [sx * 0.2, -1.38, 0.22]], 0.014, core);
      p.add(L.build()); return p;
    }
    var legL = leg(1), legR = leg(-1);
    var pelvis = pivot(body, 0, 1.62, 0), PB2 = new Builder();
    PB2.add(rbox(1.0, 0.34, 0.7, 0.08), obsD, { flat: true });
    PB2.add(G.tor(0.56, 0.05, 5, 22), brass, { p: [0, 0.12, 0], r: [PI / 2, 0, 0], s: [1, 0.72, 1] });
    for (var tq = 0; tq < 5; tq++) { var ta = -0.9 + tq * 0.45; PB2.add(rbox(0.2, 0.34, 0.06, 0.02), tq % 2 ? brassD : brass, { p: [Math.sin(ta) * 0.55, -0.18, Math.cos(ta) * 0.4], r: [0.15, ta, 0], flat: true }); }
    pelvis.add(PB2.build());
    var torso = pivot(body, 0, 1.78, 0);
    var B = new Builder();
    B.add(G.lathe([[0, 0], [0.62, 0.0], [0.8, 0.3], [0.97, 0.76], [1.0, 1.06], [0.88, 1.32], [0.56, 1.46], [0, 1.5]], 10), obs, { flat: true, s: [1, 1, 0.82] });
    [[0.3, 0.83], [1.08, 1.02]].forEach(function (q) {
      B.add(G.tor(q[1], 0.05, 5, 30), brass, { p: [0, q[0], 0], r: [PI / 2, 0, 0], s: [1, 0.82, 1] });
      for (var rv = 0; rv < 16; rv++) { var ra = rv * TAU / 16; B.add(G.sph(0.026, 6, 5), brassL, { p: [Math.sin(ra) * (q[1] + 0.045), q[0], Math.cos(ra) * (q[1] + 0.045) * 0.82] }); }
    });
    // chest: brass hatch around a caged star-core
    var cz = 0.8;
    B.add(G.cyl(0.42, 0.44, 0.1, 24), brassD, { p: [0, 0.82, cz - 0.02], r: [PI / 2 - 0.12, 0, 0] });
    B.add(G.tor(0.36, 0.065, 6, 28), brass, { p: [0, 0.82, cz + 0.04], r: [-0.12, 0, 0] });
    for (var rb = 0; rb < 12; rb++) { var rba = rb * TAU / 12; B.add(G.box(0.05, 0.12, 0.05), brassL, { p: [Math.cos(rba) * 0.47, 0.82 + Math.sin(rba) * 0.47, cz], r: [0, 0, rba + PI / 2], flat: true }); }
    B.glow(G.sph(0.24, 18, 14), core, { p: [0, 0.82, cz + 0.03] });
    [0, PI / 3, -PI / 3].forEach(function (rr) { B.add(G.tor(0.26, 0.016, 4, 22, PI), brass, { p: [0, 0.82, cz + 0.03], r: [0, PI / 2, rr] }); });
    glyph(B, 'eye', [0, 1.28, 0.62], [0, 0.45, 1], 0.24, core);
    // back fins / vents
    for (var fn = 0; fn < 3; fn++) B.add(rbox(0.07, 0.7, 0.32, 0.02), fn === 1 ? brass : brassD, { p: [(fn - 1) * 0.28, 0.85, -0.82], r: [-0.25, 0, (fn - 1) * 0.15], flat: true });
    if (EL) for (var es = 0; es < 6; es++) { var ea = es * TAU / 6; B.add(G.cone(0.06, 0.32, 4), gold, { p: [Math.sin(ea) * 0.95, 1.12, Math.cos(ea) * 0.78], dir: [Math.sin(ea), 0.5, Math.cos(ea)], flat: true }); }
    torso.add(B.build());
    var coreHalo = halo(core, 2.2, 0.7); coreHalo.position.set(0, 0.82, cz + 0.2); torso.add(coreHalo);
    // head: small brass dome, one glowing visor slit, fins, a gyroscope ring behind
    var head = pivot(torso, 0, 1.5, 0.06), H = new Builder();
    H.add(G.sph(0.33, 16, 12), brass, { p: [0, 0.18, 0], s: [1, 0.86, 0.95] });
    H.add(G.cyl(0.36, 0.34, 0.18, 16), obsD, { p: [0, 0.04, 0], flat: true });
    H.add(rbox(0.5, 0.14, 0.14, 0.04), obsD, { p: [0, 0.12, 0.27] });
    H.glow(G.box(0.4, 0.045, 0.04), eyeC, { p: [0, 0.13, 0.34] });
    for (var hf = 0; hf < 3; hf++) H.add(rbox(0.05, 0.3 - Math.abs(hf - 1) * 0.08, 0.36, 0.02), hf === 1 ? brassL : brass, { p: [(hf - 1) * 0.12, 0.42, -0.04], r: [-0.2, 0, (hf - 1) * 0.3], flat: true });
    [-1, 1].forEach(function (sx) { H.add(G.cone(0.07, 0.28, 5), brassD, { p: [sx * 0.34, 0.12, 0], r: [0, 0, -sx * 1.25], flat: true }); });
    head.add(H.build());
    var gyro = pivot(head, 0, 0.2, -0.22), GB = new Builder();
    GB.add(G.tor(0.6, 0.03, 5, 40), brass, {});
    for (var gm = 0; gm < 8; gm++) { var ga = gm * TAU / 8; GB.add(G.box(0.02, 0.08, 0.02), brassL, { p: [Math.cos(ga) * 0.6, Math.sin(ga) * 0.6, 0], r: [0, 0, ga + PI / 2] }); }
    GB.glow(G.tor(0.52, 0.008, 4, 36), core, {});
    gyro.add(GB.build());
    // arms with pauldrons topped by little orreries, huge brass-banded fists
    function arm(sx) {
      var p = pivot(torso, sx * 1.02, 1.12, 0), A = new Builder();
      A.add(G.sph(0.44, 14, 8, 0), brass, { p: [sx * 0.04, 0.05, 0], s: [1.05, 0.82, 1.05], flat: true });
      A.add(G.tor(0.43, 0.035, 5, 20), brassD, { p: [sx * 0.04, -0.12, 0], r: [PI / 2, 0, 0] });
      A.add(G.cyl(0.03, 0.03, 0.4, 6), brassD, { p: [sx * 0.06, 0.55, 0] });
      A.add(G.sph(0.12, 12, 10), sx > 0 ? C(VLT.violet) : core, { p: [sx * 0.06, 0.8, 0] });
      A.add(G.tor(0.2, 0.012, 4, 22), brass, { p: [sx * 0.06, 0.8, 0], r: [PI / 2 + 0.4, 0, 0] });
      A.add(G.cyl(0.19, 0.2, 0.62, 8), obs, { p: [0, -0.42, 0], flat: true });
      A.add(G.sph(0.2, 10, 8), brass, { p: [0, -0.76, 0] });
      A.add(rbox(0.5, 0.74, 0.5, 0.06), obsL, { p: [0, -1.14, 0.02], flat: true });
      vein(A, [[sx * 0.26, -0.86, 0.12], [sx * 0.27, -1.1, 0.1], [sx * 0.26, -1.36, 0.12]], 0.016, core);
      A.add(G.tor(0.3, 0.045, 5, 14), brass, { p: [0, -1.44, 0.02], r: [PI / 2, 0, 0] });
      A.add(rbox(0.74, 0.62, 0.72, 0.09), obsD, { p: [0, -1.82, 0.07], flat: true });
      A.add(rbox(0.77, 0.13, 0.75, 0.03), brass, { p: [0, -1.6, 0.07], flat: true });
      A.add(rbox(0.77, 0.08, 0.75, 0.03), brassD, { p: [0, -2.04, 0.07], flat: true });
      for (var kn = 0; kn < 4; kn++) { A.glow(G.box(0.1, 0.08, 0.03), core, { p: [(kn - 1.5) * 0.17, -1.8, 0.44] }); A.add(G.cone(0.065, 0.2, 4), obsD, { p: [(kn - 1.5) * 0.17, -1.68, 0.47], r: [PI / 2 - 0.4, 0, 0], flat: true }); }
      p.add(A.build()); p.rotation.z = sx * 0.12; p.userData.rest = sx * 0.12; return p;
    }
    var armL = arm(1), armR = arm(-1);
    // the ring of orbiting rune-stones (each tumbles; the ring turns around the construct)
    var orbit = pivot(torso, 0, 0.5, 0); orbit.rotation.set(0.22, 0, 0.1);
    var stones = [], rS = seeded(19);
    for (var si = 0; si < 7; si++) {
      var sp = pivot(orbit), sB = new Builder(), sr = 0.2 + rS() * 0.13;
      var sc2 = si % 2 ? core : C(VLT.violet);
      sB.add(stoneGeo(sr, 1, rS() * 20, 4, 0.25), si % 3 ? obs : obsD, { flat: true });
      sB.glow(G.tor(sr * 0.98, sr * 0.06, 4, 18), sc2, { r: [PI / 2 + 0.3, 0.2, 0] });
      [-1, 1].forEach(function (sz) { glyph(sB, ['tri', 'eye', 'crescent', 'zig'][si % 4], [0, 0, sz * sr * 0.92], [0, 0, sz], sr * 0.9, sc2); });
      sp.add(sB.build()); stones.push({ o: sp, a: si * TAU / 7, r: 1.95 + rS() * 0.25, y: (rS() - 0.5) * 0.35, w: rS() * 2 + 0.5 });
    }
    eyeHalos(root, head, [[-0.14, 0.13, 0.38], [0.14, 0.13, 0.38]], eyeC, 0.3);
    root.userData.aura = { r: 1.4, h: 3.2, y0: 0.0, size: 0.85, smoke: 20, smokeAlpha: 0.45, smokeColor: '#120c1c', smokeColor2: '#1a1530', embers: 22, emberColor: core, emberColors: [core, brassL], emberSize: 0.08, pool: 2.0, life: 3.2, emberLife: 2.2, glow: core };
    root.userData.skinOpts = { rim: '#7fd8ff', rimStrength: 0.5, edge: VLT.cyan };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk', br = Math.sin(t * 1.6);
      legL.rotation.set(0, 0, 0.05 * d); legR.rotation.set(0, 0, -0.05 * d);
      torso.rotation.set(0.05 * d, Math.sin(t * 0.5) * 0.05 * (1 - d), 0); torso.scale.set(1 + br * 0.01, 1 + br * 0.012, 1);
      head.rotation.set(0.08 * d, Math.sin(t * 0.7) * 0.25 * (1 - d), 0);
      armL.rotation.set(-0.1 - 0.35 * d + br * 0.03, 0, armL.userData.rest + 0.1 * d); armR.rotation.set(-0.1 - 0.35 * d - br * 0.03, 0, armR.userData.rest - 0.1 * d);
      gyro.rotation.set(Math.sin(t * 0.6) * 0.3, t * 0.7, 0);
      var orbS = 0.45 + 1.4 * e.cast + 2.5 * e.taunt, orbR = 1 + 0.15 * e.taunt + 0.08 * e.cast;
      orbit.userData.a = (orbit.userData.a || 0) + dt * orbS;
      for (var q = 0; q < stones.length; q++) {
        var S0 = stones[q], aa = S0.a + orbit.userData.a;
        S0.o.position.set(Math.cos(aa) * S0.r * orbR, S0.y + Math.sin(t * 1.3 + q) * 0.08, Math.sin(aa) * S0.r * orbR);
        S0.o.rotation.set(t * S0.w * 0.5, t * S0.w, 0);
      }
      coreHalo.scale.setScalar(2.2 * (1 + 0.1 * Math.sin(t * 3) + 0.9 * e.cast + 0.6 * e.taunt));
      body.position.y = br * 0.015 - 0.06 * d;
      if (walk) {
        var s = t * 4.2, sw = Math.sin(s);
        legL.rotation.x = sw * 0.38; legR.rotation.x = -sw * 0.38; body.position.y = Math.abs(Math.cos(s)) * 0.06;
        torso.rotation.z = sw * 0.04; armL.rotation.x = -sw * 0.25; armR.rotation.x = sw * 0.25;
      }
      if (e.wind) { armR.rotation.x -= 2.4 * e.wind; armL.rotation.x -= 0.6 * e.wind; torso.rotation.x -= 0.15 * e.wind; torso.rotation.y += 0.25 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 0.6 * e.lunge; torso.rotation.x += 0.22 * e.lunge; torso.rotation.y -= 0.35 * e.lunge; legR.rotation.x -= 0.3 * e.lunge; }
      if (e.taunt) { armL.rotation.x -= 1.3 * e.taunt; armR.rotation.x -= 1.3 * e.taunt; armL.rotation.z += 0.7 * e.taunt; armR.rotation.z -= 0.7 * e.taunt; head.rotation.x -= 0.35 * e.taunt; torso.rotation.x -= 0.12 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.2 * e.hit; armR.rotation.z -= 0.2 * e.hit; }
      if (e.fall) {
        legL.rotation.x = -1.2 * e.fall; legR.rotation.x = -0.5 * e.fall; body.position.y -= 0.9 * e.fall;
        torso.rotation.x += 0.4 * e.fall; head.rotation.x += 0.5 * e.fall; armL.rotation.x = 0.3 * e.fall; armR.rotation.x = 0.4 * e.fall;
        for (var q2 = 0; q2 < stones.length; q2++) stones[q2].o.position.y -= 1.6 * e.fall * (0.6 + 0.4 * Math.sin(q2));
      }
    }, { customFall: true, hitScale: 0.45, lungeScale: 0.6, tauntTilt: 0.5 });
    b.scaler.scale.setScalar(1.08);
    return root;
  };

  // ---------------- Warden Morrow: corrupted Lumen knight-mage with a lantern-staff (boss) ----------------
  E.warden = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    var c = C(col || '#1e2050'), cloak = dk(c, 0.2), cloakD = dk(c, 0.55), plate = C(VLT.ivory), plateL = sh(plate, 0.1), plateD = sh(plate, -0.32);
    var gold = C('#c9a24a'), goldD = sh(gold, -0.3), green = C(HOLLOW_GREEN), eyeC = C(EL ? BURN : HOLLOW_GREEN), star = C(VLT.star), egold = C(ELITE_GOLD);
    var b = base(), root = b.root, body = b.body;
    function leg(sx) {
      var p = pivot(body, sx * 0.16, 0.98, 0), L = new Builder();
      L.add(G.cyl(0.1, 0.085, 0.46, 9), plateD, { p: [0, -0.24, 0], flat: true });
      L.add(G.sph(0.1, 10, 7), plate, { p: [0, -0.48, 0.04], flat: true });
      L.add(G.cone(0.05, 0.14, 5), gold, { p: [0, -0.48, 0.15], r: [PI / 2, 0, 0], flat: true });
      L.add(G.cyl(0.095, 0.08, 0.36, 9), plate, { p: [0, -0.72, 0.01], flat: true });
      L.add(rbox(0.18, 0.12, 0.34, 0.03), plateD, { p: [0, -0.92, 0.06], flat: true });
      L.add(G.cone(0.06, 0.14, 4), plateD, { p: [0, -0.93, 0.27], r: [PI / 2, 0, 0], flat: true });
      vein(L, [[sx * 0.05, -0.6, 0.09], [sx * 0.07, -0.72, 0.09], [sx * 0.04, -0.85, 0.08]], 0.009, green);
      p.add(L.build()); return p;
    }
    var legL = leg(1), legR = leg(-1);
    // mage robe under the armour (tattered), tassets, tabard with a cracked sun
    var robeP = pivot(body), RB = new Builder();
    RB.add(skirtGeo(0.3, 0.52, 0.86, 18, 0.24, 7, 3), cloakD, { p: [0, 0.16, 0], flat: true });
    RB.glow(skirtGeo(0.522, 0.528, 0.025, 18, 0.24, 7, 1, true), eyeC, { p: [0, 0.148, 0] });
    for (var ts = 0; ts < 6; ts++) { var tsa = (ts - 2.5) * 0.55; RB.add(rbox(0.2, 0.3, 0.04, 0.015), ts % 2 ? plateD : plate, { p: [Math.sin(tsa) * 0.36, 0.86, Math.cos(tsa) * 0.32], r: [0.2, tsa, 0], flat: true }); }
    var tab = new T.Shape(); tab.moveTo(-0.15, 0); tab.lineTo(0.15, 0); tab.lineTo(0.16, -0.6);
    for (var z = 0; z < 5; z++) tab.lineTo(0.16 - (z + 0.5) * 0.064, z % 2 ? -0.6 : -0.7);
    tab.lineTo(-0.16, -0.6); tab.lineTo(-0.15, 0);
    RB.add(new T.ShapeGeometry(tab), plateL, { p: [0, 0.98, 0.29], r: [0.06, 0, 0] });
    RB.add(G.cyl(0.11, 0.11, 0.02, 20), gold, { p: [0, 0.72, 0.31], r: [PI / 2 + 0.06, 0, 0] });
    for (var sr = 0; sr < 12; sr++) { var sra = sr * TAU / 12; if (sr === 4 || sr === 9) continue; RB.add(G.cone(0.025, sr % 2 ? 0.08 : 0.12, 4), gold, { p: [Math.cos(sra) * 0.15, 0.72 + Math.sin(sra) * 0.15, 0.31], r: [0, 0, sra - PI / 2], flat: true }); }
    vein(RB, [[-0.05, 0.84, 0.322], [0.0, 0.76, 0.33], [0.04, 0.7, 0.33], [0.02, 0.6, 0.33]], 0.011, green);
    robeP.add(RB.build());
    var torso = pivot(body, 0, 1.0, 0), B = new Builder();
    B.add(G.lathe([[0, 0], [0.3, 0.0], [0.36, 0.2], [0.42, 0.48], [0.4, 0.66], [0.27, 0.8], [0, 0.82]], 12), plate, { flat: true, s: [1, 1, 0.82] });
    B.add(G.tor(0.31, 0.035, 5, 20), gold, { p: [0, 0.03, 0], r: [PI / 2, 0, 0], s: [1, 0.82, 1] });
    B.add(G.tor(0.39, 0.03, 5, 20), gold, { p: [0, 0.56, 0], r: [PI / 2, 0, 0], s: [1, 0.82, 1] });
    // cracked sun on the breastplate
    B.add(G.cyl(0.12, 0.12, 0.03, 20), gold, { p: [0, 0.44, 0.33], r: [PI / 2 - 0.2, 0, 0] });
    for (var sb = 0; sb < 10; sb++) { var sba = sb * TAU / 10; if (sb === 3) continue; B.add(G.cone(0.03, sb % 2 ? 0.1 : 0.16, 4), goldD, { p: [Math.cos(sba) * 0.17, 0.44 + Math.sin(sba) * 0.17, 0.32], r: [0, 0, sba - PI / 2], flat: true }); }
    vein(B, [[0.08, 0.6, 0.29], [0.02, 0.5, 0.35], [-0.03, 0.42, 0.35], [-0.1, 0.3, 0.33]], 0.013, green);
    vein(B, [[-0.2, 0.62, 0.22], [-0.25, 0.48, 0.25]], 0.009, green);
    B.add(G.cyl(0.2, 0.26, 0.14, 12), plateD, { p: [0, 0.79, 0], flat: true });
    torso.add(B.build());
    // tattered star cloak (spring-ish sway in anim), stars on its outer side
    var cape = pivot(torso, 0, 0.74, -0.24);
    var cg = new T.PlaneGeometry(1.15, 2.05, 5, 10); cg.translate(0, -1.025, 0);
    var cp = cg.attributes.position;
    for (var ci = 0; ci < cp.count; ci++) {
      var cy = Math.min(0, cp.getY(ci)), cx = cp.getX(ci), colN = Math.round((cx / 1.15 + 0.5) * 5);
      cp.setX(ci, cx * (1 + (-cy) * 0.32)); cp.setZ(ci, -Math.pow(-cy, 1.5) * 0.1 + Math.cos(cx * 3.4) * 0.06);
      if (cy < -2.04) cp.setY(ci, cy + (colN % 2 ? 0.3 : -0.02));
    }
    cg.computeVertexNormals();
    var cm = new T.Mesh(cg, M.toon(cloak, { side: T.DoubleSide })); cm.castShadow = true; cape.add(cm);
    var CB = new Builder(), rc = seeded(5), edgeL = [], edgeR = [];
    for (var ce = 0; ce <= 8; ce++) { var cv = ce / 8 * 0.98, cyy = -cv * 2.05, wsc = 1 + cv * 2.05 * 0.32, zz = -Math.pow(cv * 2.05, 1.5) * 0.1 + Math.cos(0.575 * 3.4) * 0.06 - 0.008; edgeL.push([0.575 * wsc, cyy, zz]); edgeR.push([-0.575 * wsc, cyy, zz]); }
    CB.add(surfLine(edgeL, 0.016), C('#e8d08a')); CB.add(surfLine(edgeR, 0.016), C('#e8d08a'));
    for (var cs = 0; cs < 22; cs++) {
      var u = rc(), v = 0.1 + rc() * 0.8, yy = -v * 2.05, xx = (u - 0.5) * 1.15 * (1 + v * 2.05 * 0.32);
      star4(CB, [xx, yy, -Math.pow(v * 2.05, 1.5) * 0.1 + Math.cos(xx / (1 + v * 0.66) * 3.4) * 0.06 - 0.012], [0, 0.1, -1], 0.035 + rc() * 0.03, star, rc() > 0.35, rc() * 3);
    }
    cape.add(CB.build());
    // great helm with a broken sunburst crest and a cracked halo
    var head = pivot(torso, 0, 0.92, 0.02), H = new Builder();
    H.add(G.cyl(0.21, 0.23, 0.36, 12), plate, { p: [0, 0.12, 0], flat: true });
    H.add(G.hemi(0.21, 12, 5), plateL, { p: [0, 0.3, 0], flat: true });
    H.add(G.box(0.3, 0.05, 0.03), '#06040a', { p: [0, 0.18, 0.215] });
    H.add(G.box(0.05, 0.2, 0.03), '#06040a', { p: [0, 0.1, 0.215] });
    [-1, 1].forEach(function (sx) { H.glow(G.sph(0.03, 8, 6), eyeC, { p: [sx * 0.075, 0.18, 0.22], s: [1.7, 0.6, 0.5], r: [0, 0, sx * 0.25] }); });
    H.add(G.tor(0.22, 0.02, 4, 18), gold, { p: [0, 0.3, 0], r: [PI / 2, 0, 0] });
    for (var cr = 0; cr < 9; cr++) {
      var cra = PI * 0.12 + cr * PI * 0.76 / 8, broken = cr === 2 || cr === 6, len = broken ? 0.12 : (cr === 4 ? 0.48 : 0.3 + (cr % 2) * 0.08);
      H.add(G.cone(0.035, len, 4), cr % 2 ? goldD : gold, { p: [Math.cos(cra) * 0.22, 0.32 + Math.sin(cra) * 0.22 + len * 0.42, -0.05], r: [0, 0, cra - PI / 2], flat: true });
    }
    vein(H, [[0.12, 0.35, 0.15], [0.16, 0.22, 0.18], [0.14, 0.05, 0.2]], 0.01, green);
    head.add(H.build());
    var hal = pivot(head, 0, 0.36, -0.26), HB = new Builder();
    HB.add(G.tor(0.42, 0.028, 5, 36, PI * 1.62), goldD, { r: [0, 0, PI * 0.62] });
    HB.glow(G.tor(0.42, 0.008, 4, 36, PI * 1.62), green, { p: [0, 0, 0.02], r: [0, 0, PI * 0.62] });
    for (var hr = 0; hr < 6; hr++) { var hra = PI * 0.75 + hr * PI * 1.5 / 6; HB.add(G.cone(0.03, 0.1, 4), gold, { p: [Math.cos(hra) * 0.48, Math.sin(hra) * 0.48, 0], r: [0, 0, hra - PI / 2], flat: true }); }
    hal.add(HB.build());
    function arm(sx) {
      var p = pivot(torso, sx * 0.42, 0.66, 0), A = new Builder();
      A.add(G.hemi(0.2, 12, 5), plate, { p: [0, 0.04, 0], s: [1.15, 0.9, 1.15], flat: true });
      A.add(G.hemi(0.24, 12, 5), plateD, { p: [sx * 0.03, -0.04, 0], s: [1.1, 0.7, 1.1], r: [0, 0, -sx * 0.3], flat: true });
      A.add(G.tor(0.25, 0.022, 4, 16), gold, { p: [sx * 0.03, -0.04, 0], r: [PI / 2, 0, -sx * 0.3] });
      for (var q = 0; q < 3; q++) A.add(G.cone(0.035, 0.18, 4), goldD, { p: [sx * 0.14, 0.12, -0.08 + q * 0.08], r: [0, 0, -sx * 0.6], flat: true });
      A.add(skirtGeo(0.1, 0.17, 0.42, 10, 0.08, 4 + sx, 2), cloakD, { p: [0, -0.46, 0], flat: true });
      A.add(G.cyl(0.085, 0.075, 0.26, 8), plate, { p: [0, -0.56, 0.0], flat: true });
      A.add(G.box(0.12, 0.13, 0.1), plateD, { p: [0, -0.74, 0.02], flat: true });
      for (var f = 0; f < 4; f++) A.add(clawGeo(0.08, 0.015), plateD, { p: [(f - 1.5) * 0.026, -0.8, 0.05], r: [-0.2, 0, 0] });
      p.add(A.build()); p.rotation.z = sx * 0.14; p.userData.rest = sx * 0.14; return p;
    }
    var armL = arm(1), armR = arm(-1);
    var palm = halo(eyeC, 0.5, 0.8); palm.position.set(0, -0.84, 0.08); armL.add(palm);
    // lantern-staff: crook top, the lantern hangs on a chain and swings
    var staff = pivot(armR, 0, -0.76, 0.03), S = new Builder();
    S.add(G.cyl(0.03, 0.036, 2.5, 8), '#2a2430', { p: [0, 0.45, 0] });
    [[-0.75, 0.04], [0.2, 0.04], [1.25, 0.045], [1.6, 0.05]].forEach(function (q) { S.add(G.tor(q[1], 0.014, 4, 12), gold, { p: [0, q[0], 0], r: [PI / 2, 0, 0] }); });
    S.add(G.taper([[0, 1.68, 0], [0, 1.86, 0.04], [0, 1.94, 0.2], [0, 1.88, 0.36], [0, 1.76, 0.4]], 0.03, 0.022, 14, 6), '#2a2430');
    S.add(G.cone(0.05, 0.16, 5), gold, { p: [0, 1.96, -0.02], flat: true });
    star4(S, [0, 2.1, -0.02], [0, 0, 1], 0.07, gold, false);
    staff.add(S.build());
    var lantern = pivot(staff, 0, 1.76, 0.4), LB = new Builder();
    for (var ch = 0; ch < 3; ch++) LB.add(G.tor(0.022, 0.006, 4, 8), goldD, { p: [0, -0.04 - ch * 0.05, 0], r: [0, ch % 2 ? PI / 2 : 0, 0] });
    LB.add(G.cone(0.13, 0.12, 6), '#2a2430', { p: [0, -0.24, 0], flat: true });
    LB.add(G.cyl(0.11, 0.11, 0.03, 6), gold, { p: [0, -0.3, 0] });
    for (var lp = 0; lp < 6; lp++) { var lpa = lp * TAU / 6; LB.add(G.box(0.018, 0.26, 0.018), '#2a2430', { p: [Math.cos(lpa) * 0.1, -0.44, Math.sin(lpa) * 0.1] }); }
    LB.add(G.cyl(0.12, 0.09, 0.05, 6), gold, { p: [0, -0.59, 0] });
    LB.add(G.cone(0.04, 0.08, 6), '#2a2430', { p: [0, -0.65, 0], r: [PI, 0, 0] });
    LB.glow(G.sph(0.075, 10, 8), sh(eyeC, 0.35), { p: [0, -0.46, 0], s: [1, 1.4, 1] });
    LB.glow(G.cone(0.05, 0.16, 8), eyeC, { p: [0, -0.4, 0] });
    lantern.add(LB.build());
    var lanternHalo = halo(eyeC, 1.4, 0.85); lanternHalo.position.set(0, -0.44, 0); lantern.add(lanternHalo);
    eyeHalos(root, head, [[-0.075, 0.18, 0.24], [0.075, 0.18, 0.24]], eyeC, 0.2);
    root.userData.aura = { r: 0.9, h: 2.4, y0: 0.0, size: 0.62, smoke: 18, smokeAlpha: 0.46, smokeColor: '#10102a', smokeColor2: '#1a2410', embers: 18, emberColor: green, emberColors: [green, star], emberSize: 0.06, pool: 1.4, life: 3.0, emberLife: 2.0 };
    root.userData.skinOpts = { rim: '#b0d8ff', rimStrength: 0.45 };
    var swing = { x: 0, v: 0 };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk', br = Math.sin(t * 1.8);
      legL.rotation.set(0, 0, 0.08 * d); legR.rotation.set(0, 0, -0.08 * d);
      torso.rotation.set(0.05 * d, 0, 0); torso.scale.set(1, 1 + br * 0.012, 1); robeP.rotation.set(0, 0, 0);
      head.rotation.set(0.06 * d, Math.sin(t * 0.55) * 0.18 * (1 - d), 0);
      hal.rotation.set(0, 0, Math.sin(t * 0.4) * 0.15); hal.position.y = 0.36 + Math.sin(t * 1.3) * 0.02;
      armR.rotation.set(-0.45 - 0.3 * d, 0, armR.userData.rest); armL.rotation.set(-0.35 - 0.55 * d + br * 0.04, 0, armL.userData.rest + 0.2 * d);
      staff.rotation.set(0.42 + 0.3 * d, 0, 0.05);
      cape.rotation.set(0.08 + Math.sin(t * 1.4) * 0.04 + 0.1 * d, 0, Math.sin(t * 0.9) * 0.03);
      if (walk) {
        var s = t * 6.2, sw = Math.sin(s);
        legL.rotation.x = sw * 0.5; legR.rotation.x = -sw * 0.5; body.position.y = Math.abs(Math.cos(s)) * 0.04;
        robeP.rotation.y = sw * 0.08; armL.rotation.x = -0.35 - sw * 0.25; cape.rotation.x = 0.3 + Math.abs(sw) * 0.1; torso.rotation.y = sw * 0.05;
      } else body.position.y = br * 0.012 - 0.04 * d;
      if (e.wind) { armR.rotation.x -= 1.9 * e.wind; staff.rotation.x -= 0.25 * e.wind; armL.rotation.x -= 0.9 * e.wind; armL.rotation.z += 0.5 * e.wind; torso.rotation.x -= 0.1 * e.wind; head.rotation.x -= 0.15 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 0.5 * e.lunge; staff.rotation.x += 0.9 * e.lunge; armL.rotation.x -= 1.0 * e.lunge; torso.rotation.x += 0.15 * e.lunge; legR.rotation.x -= 0.3 * e.lunge; }
      if (e.taunt) { armR.rotation.x -= 2.3 * e.taunt; armL.rotation.z += 1.0 * e.taunt; armL.rotation.x -= 0.6 * e.taunt; head.rotation.x -= 0.3 * e.taunt; torso.rotation.x -= 0.12 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.3 * e.hit; head.rotation.x -= 0.2 * e.hit; }
      // the lantern swings on its chain (damped pendulum, kicked by the staff's motion)
      var tgt = -(armR.rotation.x + staff.rotation.x) * 0.9 + Math.sin(t * 1.1) * 0.08;
      swing.v += ((tgt - swing.x) * 18 - swing.v * 3.2) * Math.min(dt, 0.05); swing.x += swing.v * Math.min(dt, 0.05);
      if (!(Math.abs(swing.x) < 3)) { swing.x = 0; swing.v = 0; }
      lantern.rotation.set(swing.x, 0, Math.sin(t * 1.7) * 0.06);
      var lf = 1 + 0.08 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23) + 1.2 * e.cast + 0.8 * e.taunt;
      lanternHalo.scale.setScalar(1.4 * lf); palm.scale.setScalar(0.5 * (1 + 1.5 * e.cast + Math.sin(t * 4) * 0.1));
      if (e.fall) {
        legL.rotation.x = -1.3 * e.fall; legR.rotation.x = -0.4 * e.fall; body.position.y -= 0.42 * e.fall;
        torso.rotation.x += 0.45 * e.fall; head.rotation.x += 0.5 * e.fall; staff.rotation.x += 0.8 * e.fall; robeP.scale.y = 1 - 0.2 * e.fall;
        armR.rotation.x = armR.rotation.x * (1 - e.fall) + 0.3 * e.fall; armL.rotation.x = armL.rotation.x * (1 - e.fall);
      } else robeP.scale.y = 1;
    }, { customFall: true, hitScale: 0.6, lungeScale: 0.7 });
    b.scaler.scale.setScalar(1.38);
    return root;
  };

  // ---------------- The Starless Archon: huge floating robed figure (final boss) ----------------
  E.archon = function (col, o) {
    o = o || {};
    var EL = !!o.elite;
    // gown lifted toward a dusk violet so the silhouette still separates from the dark vault walls
    var c = C(col || '#1a1030'), robe = mix(dk(c, 0.18), '#4a3480', 0.3), robeD = mix(dk(c, 0.6), '#2c1e52', 0.3), voidC = C('#06030c'), violet = C(VLT.violet);
    var gold = C('#b8923e'), goldD = sh(gold, -0.35), mask = C('#e4dccb'), maskD = sh(mask, -0.3), cold = C('#cfe2ff'), eyeC = C(EL ? BURN : '#e2d4ff'), green = C(HOLLOW_GREEN), egold = C(ELITE_GOLD);
    var b = base(), root = b.root, body = b.body;
    var fl = pivot(body);
    var B = new Builder();
    // the great robe: a towering lathe gown over a tattered outer skirt, void-light leaking from the hem
    B.add(G.lathe([[0, 0.3], [1.2, 0.22], [1.3, 0.4], [1.02, 1.0], [0.8, 1.66], [0.68, 2.2], [0.74, 2.52], [0.5, 2.82], [0, 2.86]], 22), robe);
    B.add(skirtGeo(0.74, 1.42, 1.7, 26, 0.6, 31, 4), robeD, { p: [0, 0.32, 0], flat: true });
    B.glow(skirtGeo(1.42, 1.43, 0.05, 26, 0.6, 31, 1, true), violet, { p: [0, 0.305, 0] });
    B.glow(G.tor(1.12, 0.05, 6, 40), sh(violet, -0.2), { p: [0, 0.26, 0], r: [PI / 2, 0, 0] });
    // gold astral filigree: meridian lines and little orbit circles; dead and dying stars
    for (var m2 = 0; m2 < 8; m2++) {
      var ma = m2 * TAU / 8 + 0.2, pts = [];
      for (var q = 0; q <= 6; q++) { var y = 0.6 + q * 0.32, r = y < 1.0 ? lerp(1.12, 1.02, (y - 0.4) / 0.6) : y < 1.66 ? lerp(1.02, 0.8, (y - 1.0) / 0.66) : lerp(0.8, 0.68, (y - 1.66) / 0.54); pts.push([Math.sin(ma + Math.sin(q * 0.9) * 0.05) * (r + 0.012), y, Math.cos(ma + Math.sin(q * 0.9) * 0.05) * (r + 0.012)]); }
      B.add(hornGeo(pts, 0.012, 0.008, 0, 18, 4), m2 % 2 ? gold : goldD);
      var oy2 = 1.25 + (m2 % 3) * 0.3, orr = oy2 < 1.66 ? lerp(1.02, 0.8, (oy2 - 1.0) / 0.66) : 0.78;
      B.add(G.tor(0.07, 0.008, 4, 16), gold, { p: [Math.sin(ma) * (orr + 0.015), oy2, Math.cos(ma) * (orr + 0.015)], r: [0, ma, 0] });
    }
    var rs = seeded(66);
    for (var st = 0; st < 26; st++) {
      var sa = rs() * TAU, sy = 0.7 + rs() * 1.8, srr = sy < 1.0 ? 1.1 : sy < 1.66 ? lerp(1.02, 0.8, (sy - 1.0) / 0.66) : lerp(0.8, 0.68, Math.min(1, (sy - 1.66) / 0.54));
      var lit = rs() > 0.7;
      star4(B, [Math.sin(sa) * (srr + 0.014), sy, Math.cos(sa) * (srr + 0.014)], [Math.sin(sa), 0.2, Math.cos(sa)], 0.035 + rs() * 0.04, lit ? cold : sh(robe, 0.25), lit, rs() * 3);
    }
    // stiff mantle: layered shoulder shells with gold rims, a high collar of broken spikes
    [-1, 1].forEach(function (sx) {
      B.add(new T.SphereGeometry(0.55, 16, 7, 0, TAU, 0, PI * 0.5), robeD, { p: [sx * 0.72, 2.6, 0], s: [1.1, 0.62, 1.0], r: [0, 0, -sx * 0.32], flat: true });
      B.add(G.tor(0.55, 0.035, 5, 24), gold, { p: [sx * 0.72, 2.6, 0], r: [PI / 2, 0, -sx * 0.32], s: [1.1, 1.0, 1] });
      B.add(new T.SphereGeometry(0.42, 14, 6, 0, TAU, 0, PI * 0.5), robe, { p: [sx * 0.86, 2.48, 0], s: [1.1, 0.55, 0.95], r: [0, 0, -sx * 0.6], flat: true });
      B.add(G.tor(0.42, 0.028, 5, 22), goldD, { p: [sx * 0.86, 2.48, 0], r: [PI / 2, 0, -sx * 0.6], s: [1.1, 0.95, 1] });
      for (var sp = 0; sp < 3; sp++) B.add(G.cone(0.05, 0.5 - sp * 0.1, 4), voidC, { p: [sx * (0.95 + sp * 0.14), 2.82 - sp * 0.08, -0.15 + sp * 0.1], r: [0, 0, -sx * (0.5 + sp * 0.2)], flat: true });
    });
    for (var cl = 0; cl < 9; cl++) { var cla = -PI / 2 + (cl / 8) * PI; B.add(G.cone(0.06, 0.62 - Math.abs(cl - 4) * 0.07 - (cl === 2 || cl === 6 ? 0.25 : 0), 4), voidC, { p: [Math.sin(cla) * 0.48, 2.98, -Math.abs(Math.cos(cla)) * 0.16 - 0.14], r: [-0.4, 0, -Math.sin(cla) * 0.7], flat: true }); }
    glyph(B, 'eye', [0, 2.35, 0.7], [0, 0.15, 1], 0.32, violet);
    if (EL) { B.add(G.tor(1.25, 0.05, 5, 36), egold, { p: [0, 0.75, 0], r: [PI / 2, 0, 0] }); }
    fl.add(B.build());
    // broken armillary arcs rising behind the shoulders like wings (they creak open on taunt)
    function arc(sx) {
      var p = pivot(fl, sx * 0.55, 2.55, -0.45), A = new Builder();
      A.add(G.tor(1.15, 0.045, 5, 36, PI * 0.82), gold, { r: [0, 0, sx > 0 ? -0.15 : PI * 0.33] });
      A.add(G.tor(0.95, 0.025, 4, 32, PI * 0.7), goldD, { p: [sx * 0.08, 0.05, 0.04], r: [0, 0, sx > 0 ? -0.05 : PI * 0.35] });
      for (var tk = 0; tk < 7; tk++) { var ta = (sx > 0 ? -0.15 : PI * 0.33) + tk * PI * 0.82 / 6; A.add(G.box(0.03, 0.14, 0.03), goldD, { p: [Math.cos(ta) * 1.15, Math.sin(ta) * 1.15, 0], r: [0, 0, ta] }); }
      var e0 = sx > 0 ? -0.15 : PI * 0.33, e1 = e0 + PI * 0.82;
      [e0, e1].forEach(function (ea) { A.glow(G.oct(0.07), violet, { p: [Math.cos(ea) * 1.15, Math.sin(ea) * 1.15, 0], s: [1, 1.6, 1], r: [0, 0, ea] }); });
      A.add(G.sph(0.12, 10, 8), voidC, { p: [Math.cos(e0 + 0.9) * 1.15, Math.sin(e0 + 0.9) * 1.15, 0] });
      p.add(A.build()); p.rotation.y = sx * 0.35; return p;
    }
    var arcL = arc(1), arcR = arc(-1);
    // huge hood around a pale cracked mask
    var head = pivot(fl, 0, 3.1, 0.06);
    var hood = new T.Mesh(new T.SphereGeometry(0.62, 20, 12, PI / 2 + 0.75, TAU - 1.5, 0, PI * 0.68), M.toon(robe, { side: T.DoubleSide }));
    hood.position.set(0, -0.12, -0.04); hood.scale.set(1, 1.12, 1.1); hood.castShadow = true; head.add(hood);
    var H = new Builder();
    H.add(G.sph(0.52, 14, 10), voidC, { p: [0, -0.06, -0.06] });
    H.add(hornGeo([[0, 0.4, -0.2], [0, 0.72, -0.46], [0, 0.86, -0.8], [0, 0.72, -1.1]], 0.32, 0.02, 0, 14, 10), robe);
    H.add(G.tor(0.6, 0.032, 5, 26, PI * 1.25), gold, { p: [0, -0.12, 0.0], r: [0, 0, -PI * 0.125], s: [1, 1.12, 1.1] });
    H.add(G.sph(1, 22, 16), mask, { p: [0, -0.04, 0.35], s: [0.34, 0.45, 0.17] });
    H.add(G.box(0.36, 0.02, 0.06), maskD, { p: [0, -0.2, 0.47], r: [0.2, 0, 0] });
    [-1, 1].forEach(function (sx) {
      H.add(G.sph(1, 12, 8), '#06030c', { p: [sx * 0.11, 0.04, 0.47], s: [0.07, 0.05, 0.03], r: [0, 0, sx * 0.3] });
      H.glow(G.sph(0.022, 8, 6), eyeC, { p: [sx * 0.11, 0.04, 0.49] });
      H.add(G.box(0.12, 0.018, 0.02), maskD, { p: [sx * 0.11, 0.1, 0.48], r: [0, 0, sx * 0.4] });
    });
    // the crack: across the mask, glowing
    vein(H, [[0.05, 0.3, 0.42], [0.08, 0.18, 0.47], [0.02, 0.08, 0.5], [0.06, -0.06, 0.5], [0.0, -0.2, 0.47], [0.04, -0.34, 0.4]], 0.012, violet);
    vein(H, [[0.08, 0.18, 0.47], [0.2, 0.2, 0.42]], 0.008, violet);
    H.glow(G.oct(0.05), green, { p: [0, 0.22, 0.47], s: [0.6, 1.4, 0.4] });
    head.add(H.build());
    // crossed armillary rings behind the head (a gyroscope halo that turns like a clock face; it never crosses the mask)
    var gyro = pivot(head, 0, 0.12, -0.42), GR = new Builder();
    GR.add(G.tor(1.04, 0.045, 5, 48), gold, {});
    GR.add(G.tor(0.97, 0.032, 5, 48, PI * 1.55), goldD, { r: [0, 0.7, 0.4] });
    for (var gt = 0; gt < 24; gt++) { var gta = gt * TAU / 24; GR.add(G.box(0.025, gt % 6 ? 0.07 : 0.14, 0.03), goldD, { p: [Math.cos(gta) * 1.12, Math.sin(gta) * 1.12, 0], r: [0, 0, gta + PI / 2] }); }
    for (var gb = 0; gb < 8; gb++) { var gba = gb * TAU / 8; GR.glow(G.sph(0.045, 8, 6), cold, { p: [Math.cos(gba) * 1.04, Math.sin(gba) * 1.04, 0] }); }
    gyro.add(GR.build());
    var backGlow = halo(violet, 3.4, 0.32); backGlow.position.set(0, 0.05, -0.55); head.add(backGlow);
    function arm(sx) {
      var p = pivot(fl, sx * 0.88, 2.62, 0.02), A = new Builder();
      A.add(skirtGeo(0.16, 0.44, 1.3, 14, 0.28, 13 + sx, 3), robe, { p: [0, -1.36, 0], flat: true });
      A.add(G.tor(0.43, 0.02, 4, 20), gold, { p: [0, -1.28, 0], r: [PI / 2, 0, 0] });
      A.add(G.sph(0.16, 10, 8), robe);
      A.add(G.sph(0.11, 10, 8), mask, { p: [0, -1.38, 0.02], s: [1, 1.1, 0.9] });
      for (var f = 0; f < 4; f++) A.add(hornGeo([[(f - 1.5) * 0.045, -1.42, 0.04], [(f - 1.5) * 0.07, -1.58, 0.1], [(f - 1.5) * 0.075, -1.74, 0.24]], 0.022, 0.003, 0, 8, 4), voidC);
      A.add(hornGeo([[sx * -0.08, -1.4, 0.04], [sx * -0.14, -1.5, 0.12], [sx * -0.16, -1.6, 0.24]], 0.022, 0.003, 0, 8, 4), voidC);
      p.add(A.build()); p.rotation.z = sx * 0.22; p.userData.rest = sx * 0.22; return p;
    }
    var armL = arm(1), armR = arm(-1);
    // a dead star cupped in the right hand, a sigil over the left palm
    var dstar = pivot(armR, 0, -1.78, 0.16), DS = new Builder();
    DS.add(G.sph(0.22, 18, 14), voidC);
    DS.glow(G.tor(0.26, 0.018, 5, 30), violet, { r: [PI / 2 - 0.3, 0, 0] });
    DS.glow(G.tor(0.3, 0.008, 4, 30), cold, { r: [0.4, 0.5, 0] });
    dstar.add(DS.build());
    var dsHalo = halo(violet, 1.6, 0.7); dstar.add(dsHalo);
    var sig = pivot(armL, 0, -1.72, 0.22), SG2 = new Builder();
    SG2.glow(G.tor(0.2, 0.012, 4, 30), cold, { r: [PI / 2 - 0.2, 0, 0] });
    for (var sg = 0; sg < 3; sg++) SG2.glow(G.box(0.01, 0.006, 0.36), violet, { r: [-0.2, sg * PI / 3, 0] });
    sig.add(SG2.build());
    // orbiting dark planets (their own pivots; the anim moves them)
    var planets = [], PL = [
      { r: 0.42, R: 2.35, y: 1.6, w: 0.32, tilt: 0.25, col: '#241838', band: violet, ring: false },
      { r: 0.3, R: 2.75, y: 2.6, w: -0.24, tilt: -0.3, col: '#2a2236', band: cold, ring: true },
      { r: 0.24, R: 2.1, y: 3.3, w: 0.45, tilt: 0.4, col: '#1c2438', band: violet, ring: false, moon: true },
      { r: 0.2, R: 2.55, y: 0.9, w: -0.38, tilt: -0.15, col: '#30203a', band: green, ring: false }
    ];
    PL.forEach(function (P, n) {
      var pp = pivot(fl, 0, P.y, 0), Pb = new Builder();
      Pb.add(G.sph(P.r, 18, 14), P.col, { flat: false });
      Pb.add(new T.SphereGeometry(P.r * 1.01, 16, 3, 0, TAU, PI * 0.42, PI * 0.16), sh(P.col, 0.18));
      Pb.glow(G.tor(P.r * 1.015, P.r * 0.05, 4, 30), P.band, { r: [PI / 2 + 0.25, 0, 0] });
      vein(Pb, [[P.r * 0.3, P.r * 0.9, P.r * 0.3], [P.r * 0.6, P.r * 0.4, P.r * 0.65], [P.r * 0.85, -P.r * 0.1, P.r * 0.5]], P.r * 0.05, P.band);
      if (P.ring) { Pb.add(G.tor(P.r * 1.75, P.r * 0.09, 3, 36), goldD, { r: [PI / 2 + 0.45, 0, 0], s: [1, 1, 0.25] }); Pb.add(G.tor(P.r * 1.45, P.r * 0.05, 3, 36), gold, { r: [PI / 2 + 0.45, 0, 0], s: [1, 1, 0.25] }); }
      if (P.moon) Pb.add(G.sph(0.07, 10, 8), '#8a84a0', { p: [P.r * 1.9, P.r * 0.4, 0] });
      pp.add(Pb.build());
      planets.push({ o: pp, P: P, a: n * TAU / PL.length + 0.4 });
    });
    eyeHalos(root, head, [[-0.11, 0.04, 0.52], [0.11, 0.04, 0.52]], eyeC, 0.28);
    root.userData.aura = { r: 1.6, h: 4.2, y0: 0.1, size: 1.0, smoke: 24, smokeAlpha: 0.5, smokeColor: '#0c0616', smokeColor2: '#1c0e32', embers: 26, emberColor: violet, emberColors: [violet, cold, green], emberSize: 0.09, pool: 2.4, life: 3.6, emberLife: 2.6, glow: violet };
    root.userData.skinOpts = { rim: '#c8b0ff', rimStrength: 0.55, edge: VLT.violet };
    erig(root, body, function (t, state, k, dt, e) {
      var d = e.duel, walk = state === 'walk';
      fl.position.set(0, 0.55 + Math.sin(t * 1.1) * 0.14, 0); fl.rotation.set((walk ? 0.1 : 0) + 0.04 * d, 0, Math.sin(t * 0.7) * 0.02); fl.scale.set(1, 1, 1);
      head.rotation.set(0.08 * d + Math.sin(t * 0.8) * 0.03, Math.sin(t * 0.45) * 0.14 * (1 - d), 0);
      gyro.rotation.set(Math.sin(t * 0.3) * 0.12, Math.sin(t * 0.23) * 0.15, t * 0.3 * (1 + 2 * e.taunt + 1.2 * e.cast));
      armL.rotation.set(-0.35 - 0.3 * d + Math.sin(t * 1.2) * 0.06, 0, armL.userData.rest + 0.15 * d); armR.rotation.set(-0.45 - 0.35 * d + Math.sin(t * 1.2 + 1) * 0.06, 0, armR.userData.rest - 0.1 * d);
      var open = 0.12 * d + 0.55 * e.taunt + 0.25 * e.cast;
      arcL.rotation.set(0, 0.35 + open * 0.6, -open * 0.4); arcR.rotation.set(0, -0.35 - open * 0.6, open * 0.4);
      sig.rotation.set(0, t * 1.2, 0); sig.scale.setScalar(1 + 0.6 * e.cast + Math.sin(t * 3) * 0.06);
      dsHalo.scale.setScalar(1.6 * (1 + 0.1 * Math.sin(t * 2.3) + 0.8 * e.cast + 0.5 * e.taunt));
      backGlow.scale.setScalar(3.4 * (1 + 0.06 * Math.sin(t * 0.9) + 0.35 * e.cast + 0.6 * e.taunt));
      var pull = 1 - 0.25 * e.cast + 0.2 * e.taunt, ps = 1 + 1.5 * e.cast + 2.5 * e.taunt;
      planets.forEach(function (Q, n) {
        Q.a += dt * Q.P.w * ps;
        var R = Q.P.R * pull, ca = Math.cos(Q.a), sa = Math.sin(Q.a);
        Q.o.position.set(ca * R, Q.P.y + sa * R * Q.P.tilt + Math.sin(t * 0.9 + n) * 0.1, sa * R);
        Q.o.rotation.set(0.2, t * (0.3 + n * 0.1), 0);
      });
      if (e.wind) { armL.rotation.x -= 1.4 * e.wind; armR.rotation.x -= 1.9 * e.wind; armL.rotation.z += 0.35 * e.wind; armR.rotation.z -= 0.35 * e.wind; fl.position.y += 0.25 * e.wind; head.rotation.x -= 0.15 * e.wind; }
      if (e.lunge) { armR.rotation.x -= 0.6 * e.lunge; armL.rotation.x -= 0.9 * e.lunge; fl.position.z += 0.25 * e.lunge; }
      if (e.taunt) { fl.position.y += 0.45 * e.taunt; armL.rotation.x -= 1.3 * e.taunt; armR.rotation.x -= 1.3 * e.taunt; armL.rotation.z += 0.9 * e.taunt; armR.rotation.z -= 0.9 * e.taunt; head.rotation.x -= 0.25 * e.taunt; }
      if (e.hit) { armL.rotation.z += 0.25 * e.hit; armR.rotation.z -= 0.25 * e.hit; }
      if (e.fall) {
        fl.position.y *= 1 - e.fall; fl.scale.set(1, 1 - 0.25 * e.fall, 1); head.rotation.x += 0.45 * e.fall;
        armL.rotation.x *= 1 - e.fall; armR.rotation.x *= 1 - e.fall; arcL.rotation.z -= 0.6 * e.fall; arcR.rotation.z += 0.6 * e.fall;
        planets.forEach(function (Q, n) { Q.o.position.y -= (Q.P.y - Q.P.r) * e.fall * 0.9; });
      }
    }, { hitScale: 0.5, lungeScale: 0.5, fallX: -0.12, sink: 0.05, tauntTilt: 0.6 });
    b.scaler.scale.setScalar(1.12);
    return root;
  };

  // v1.1 presence: mobs read a little bigger from the duel camera (data scales stay as they are)
  var PRESENCE = { sprite: 1.1, toad: 1.12, imp: 1.06, wolf: 1.12, sprout: 1.1, acolyte: 1.05 };
  // WF.models.enemy(key, { color, scale, elite }) -> packed Group (see ENEMIES header for states)
  M.enemy = function (key, opts) {
    need(); opts = opts || {};
    var fn = E[key];
    if (!fn) { if (window.console) console.warn('WF.models.enemy: unknown model "' + key + '", using sprite'); fn = E.sprite; key = 'sprite'; }
    var o = { elite: !!opts.elite };
    var root = fn(opts.color, o);
    root.name = 'enemy_' + key;
    var sc = (opts.scale || 1) * (o.elite ? 1.25 : 1) * (PRESENCE[key] || 1);
    root.children[0].scale.multiplyScalar(sc);
    root.userData.modelKey = key;
    root.userData.elite = o.elite;
    root.userData.height = measureTop(root);
    var A = root.userData.aura;
    if (A) {
      A.node = root.children[0];
      if (o.elite) {
        A.ring = A.ring || Math.max(0.75, A.r * 1.35);
        A.emberColors = [BURN, ELITE_GOLD, CRIMSON, BURN2];
        A.embers = Math.round((A.embers || 8) * 1.4);
        A.glow = CRIMSON;
      }
    }
    if (o.elite) (root.userData.eyeHalos || []).forEach(function (h) { h.userData.hcol = BURN2; h.userData.base *= 1.45; h.scale.setScalar(h.userData.base); });
    var so = root.userData.skinOpts = root.userData.skinOpts || {};
    if (!so.rim) so.rim = '#8a5cff';
    if (o.elite) { so.rim = '#ff4a3a'; so.rimStrength = (so.rimStrength || 0.55) + 0.1; so.edge = BURN; }
    so.height = root.userData.height;
    return skinify(root, so);
  };

  // ==================================================================
  //  PROPS  (v1.1 "storybook" re-author, agent S)
  //  Each entry: { v: variant count, build(B, r, o) -> info, extra(grp, rng, o, info) }
  //  info = { radius, colliders?, jitter?, emis?, ... }
  //  B is a PropBuilder (PB): same add()/glow() API as Builder, plus per-vertex
  //  painting (gradients, sun-side/underside shading, crevice AO toward a centre,
  //  moss/snow caps, mottling, ground-contact AO) and organic noise helpers. It
  //  outputs ONE plain position/normal/color geometry for all toon parts (flat parts
  //  get baked face normals) + one for glow parts, so static props still batch into
  //  <= 2 draw calls per cell. Static geometry is cached per (type, variant, color).
  // ==================================================================
  var LEAVES = ['#58a444', '#63b04c', '#4c9a40', '#6db452', '#55a04a'];
  var STONE = ['#9a958c', '#8f8a82', '#a49f95'];
  function lum(c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }
  function randDirUp(r) { var a = r() * TAU, y = 0.2 + r() * 0.8; return [Math.cos(a), y, Math.sin(a)]; }
  function rowColliders(x0, x1, step, rad) { var out = []; for (var x = x0; x <= x1 + 1e-6; x += step) out.push({ x: +x.toFixed(3), z: 0, r: rad }); return out; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---------------- coherent 3D value noise (prop authoring only) ----------------
  function hash3(i, j, k) {
    var h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise3(x, y, z) {
    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    var a = hash3(x0, y0, z0), b = hash3(x0 + 1, y0, z0), c = hash3(x0, y0 + 1, z0), d = hash3(x0 + 1, y0 + 1, z0);
    var e = hash3(x0, y0, z0 + 1), f = hash3(x0 + 1, y0, z0 + 1), g = hash3(x0, y0 + 1, z0 + 1), h = hash3(x0 + 1, y0 + 1, z0 + 1);
    var ab = a + (b - a) * fx, cd = c + (d - c) * fx, ef = e + (f - e) * fx, gh = g + (h - g) * fx;
    var lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy;
    return lo + (hi - lo) * fz;
  }
  function fbm3(x, y, z, oct) { var a = 0, w = 0.5, s = 1, t = 0; for (var i = 0; i < (oct || 3); i++) { a += w * noise3(x * s, y * s, z * s); t += w; w *= 0.5; s *= 2.03; } return a / t; }

  // ---------------- organic geometry helpers ----------------
  // merge coincident vertices -> smooth indexed geometry (drops uv/normal, recomputes normals)
  function weld(geo) {
    var P = geo.attributes.position, I = geo.index, map = {}, pos = [], remap = new Uint32Array(P.count), n = 0, i;
    for (i = 0; i < P.count; i++) {
      var x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = Math.round(x * 1e4) + '_' + Math.round(y * 1e4) + '_' + Math.round(z * 1e4);
      var v = map[k]; if (v === undefined) { v = map[k] = n++; pos.push(x, y, z); } remap[i] = v;
    }
    var idx = [], cnt = I ? I.count : P.count;
    for (i = 0; i < cnt; i += 3) {
      var a = remap[I ? I.getX(i) : i], b = remap[I ? I.getX(i + 1) : i + 1], c = remap[I ? I.getX(i + 2) : i + 2];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    geo.dispose();
    return g;
  }
  // displace a (welded) geometry along its normals by fbm noise: amp in local units, f = frequency
  function bumpy(geo, amp, f, seed, oct) {
    var g = geo.index ? geo : weld(geo); if (!g.attributes.normal) g.computeVertexNormals();
    var P = g.attributes.position, N = g.attributes.normal, s = (seed || 0) * 17.31;
    for (var i = 0; i < P.count; i++) {
      var x = P.getX(i), y = P.getY(i), z = P.getZ(i), d = (fbm3(x * f + s, y * f - s * 0.7, z * f + s * 0.3, oct || 3) - 0.5) * 2 * amp;
      P.setXYZ(i, x + N.getX(i) * d, y + N.getY(i) * d, z + N.getZ(i) * d);
    }
    g.computeVertexNormals();
    return g;
  }
  // welded unit icosphere, built once per detail level and copied (authoring speed)
  var _icoW = {};
  function icoW(det) {
    var src = _icoW[det] || (_icoW[det] = weld(new T.IcosahedronGeometry(1, det)));
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(src.attributes.position.array), 3));
    g.setIndex(new T.BufferAttribute(new Uint16Array(src.index.array), 1));
    return g;
  }
  // leafy clump: lumpy, scalloped sphere with a softened flat-ish underside
  function clump(r, det, seed, amp, flat) {
    var g = icoW(det === undefined ? 2 : det), P = g.attributes.position, s = seed * 3.17;
    for (var i = 0; i < P.count; i++) {
      var x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      var n = fbm3(x * 1.6 + s, y * 1.6 + s * 0.5, z * 1.6 - s, 3);
      var sc = Math.abs(noise3(x * 3.4 - s, y * 3.4, z * 3.4 + s) - 0.5) * 2;        // ridged -> scallops
      var k = 1 + (amp === undefined ? 0.2 : amp) * ((n - 0.5) * 2 + (0.5 - sc) * 0.3);
      if (y < -0.25) y = -0.25 + (y + 0.25) * (flat === undefined ? 0.55 : flat);
      P.setXYZ(i, x * k * r, y * k * r, z * k * r);
    }
    g.computeVertexNormals();
    return g;
  }
  // stone: lumpy rounded blob with a few planar "chips" (smooth shading + flat facets)
  function stoneGeo(r, det, seed, chips, amp) {
    var g = icoW(det === undefined ? 2 : det), P = g.attributes.position, rr = seeded(seed * 7919 + 13), v = new T.Vector3();
    var planes = [];
    for (var c = 0; c < (chips === undefined ? 5 : chips); c++) { var a = rr() * TAU, e = (rr() - 0.3) * 1.4; planes.push([new T.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)), 0.62 + rr() * 0.22]); }
    for (var i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      var n = fbm3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3 - seed, 3);
      v.multiplyScalar(1 + ((amp === undefined ? 0.22 : amp)) * (n - 0.5) * 2);
      for (var p = 0; p < planes.length; p++) { var d = v.dot(planes[p][0]) - planes[p][1]; if (d > 0) v.addScaledVector(planes[p][0], -d * 0.92); }
      P.setXYZ(i, v.x * r, v.y * r, v.z * r);
    }
    g.computeVertexNormals();
    return g;
  }
  // tapered tube along a curve with root flare, buttress lobes and bark grooves.
  // Carries a 'color' attribute (groove darkening) that PB multiplies into the part colour.
  function barkTube(pts, r0, r1, o) {
    o = o || {};
    var ts = o.ts || 10, rs = o.rs || 9, seed = o.seed || 0;
    var curve = new T.CatmullRomCurve3(pts.map(V3));
    var g = new T.TubeGeometry(curve, ts, 1, rs, false);
    var pos = g.attributes.position, Pc = new T.Vector3(), Q = new T.Vector3(), col = new Float32Array(pos.count * 3);
    for (var i = 0; i <= ts; i++) {
      var u = i / ts; curve.getPointAt(u, Pc);
      var rad = r0 + (r1 - r0) * Math.pow(u, o.pow || 1);
      if (o.flare) rad *= 1 + o.flare * Math.pow(1 - u, o.flareK || 7);
      for (var j = 0; j <= rs; j++) {
        var k = i * (rs + 1) + j, ang = (j % rs) / rs * TAU, rr = rad;
        if (o.lobes) rr *= 1 + (o.lobeAmp || 0.5) * Math.pow(1 - u, o.lobeK || 5) * Math.pow(Math.max(0, Math.cos(ang * o.lobes + seed)), 2);
        var gr = 0;
        if (o.grooves) { gr = Math.sin(ang * o.grooves + seed + fbm3(u * 3 + seed, ang, 0.5, 2) * 4); rr *= 1 - (o.grooveAmp || 0.05) * (gr * 0.5 + 0.5); }
        if (o.wobble) rr *= 1 + (fbm3(u * 4 + seed, Math.cos(ang) * 1.5, Math.sin(ang) * 1.5, 2) - 0.5) * o.wobble;
        Q.fromBufferAttribute(pos, k).sub(Pc).multiplyScalar(rr).add(Pc);
        pos.setXYZ(k, Q.x, Q.y, Q.z);
        var shade = 1 - (o.grooves ? (o.grooveDark || 0.28) * Math.max(0, gr) : 0);
        col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade;
      }
    }
    g.deleteAttribute('uv');
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  // rounded box (bevelled) — stones, planks, blocks. The weld topology of a BoxGeometry does not
  // depend on its size, so the remap/index is computed once per segment count and reused.
  var _rboxTopo = {};
  function rbox(w, h, d, bev, seg) {
    seg = seg || 2;
    bev = Math.min(bev === undefined ? 0.06 : bev, w / 2.01, h / 2.01, d / 2.01);
    var src = new T.BoxGeometry(w, h, d, seg, seg, seg), SP = src.attributes.position;
    var topo = _rboxTopo[seg];
    if (!topo) {
      var u = new T.BoxGeometry(1, 1, 1, seg, seg, seg), UP = u.attributes.position, map = {}, remap = new Uint32Array(UP.count), nU = 0, first = [];
      for (var i = 0; i < UP.count; i++) { var key = Math.round(UP.getX(i) * 1e4) + '_' + Math.round(UP.getY(i) * 1e4) + '_' + Math.round(UP.getZ(i) * 1e4); var vv = map[key]; if (vv === undefined) { vv = map[key] = nU++; first.push(i); } remap[i] = vv; }
      var ix = []; for (var j = 0; j < u.index.count; j += 3) { var a = remap[u.index.getX(j)], b = remap[u.index.getX(j + 1)], c = remap[u.index.getX(j + 2)]; if (a !== b && b !== c && a !== c) ix.push(a, b, c); }
      topo = _rboxTopo[seg] = { first: first, index: new Uint16Array(ix) };
      u.dispose();
    }
    var pos = new Float32Array(topo.first.length * 3), v = new T.Vector3(), cc = new T.Vector3();
    var hx2 = w / 2 - bev, hy = h / 2 - bev, hz = d / 2 - bev;
    for (var k = 0; k < topo.first.length; k++) {
      v.fromBufferAttribute(SP, topo.first[k]);
      cc.set(clamp(v.x, -hx2, hx2), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
      v.sub(cc); if (v.lengthSq() > 1e-9) v.setLength(bev); v.add(cc);
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    }
    src.dispose();
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(new T.BufferAttribute(topo.index, 1)); g.computeVertexNormals();
    return g;
  }
  // vertical colour gradient baked into a geometry (multiplied into the part colour)
  function vgrad(geo, lo, hi) {
    geo.computeBoundingBox(); var b = geo.boundingBox, P = geo.attributes.position, h = Math.max(1e-5, b.max.y - b.min.y), col = new Float32Array(P.count * 3);
    for (var i = 0; i < P.count; i++) { var t = (P.getY(i) - b.min.y) / h, k = lo + (hi - lo) * t; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    return geo;
  }

  // ---------------- PropBuilder ----------------
  // add(geo, color, o): o = Builder transform opts { p, r, s, dir, order, matrix, flat, glow, emis } plus painting:
  //   tb:[under, sun]   multiply by normal.y (underside dark, sun side light)
  //   cen:[x,y,z,k]     crevice AO: faces pointing toward (x,y,z) darken by k (canopies, clusters)
  //   cap:[color, from, to, noise]  blend toward a cap colour where normal.y in [from,to] (moss, highlights)
  //   sn:[x,y,z,k,ys]   soft "spherical" normals: blend normals toward the direction from (x,y,z) by k
  //                     (ys squashes the y component) - foliage shades as one soft painted volume
  //   under:[color, k]  tint undersides toward a cool shadow colour
  //   cn: mottling amount (default B.cn), noAO: skip ground-contact AO, hue: rotate hue by this amount
  //   cf: function(p, n) -> brightness multiplier (stone courses, planks, rings...)
  // B.warp = function(v) { ...mutates v... } bends the whole prop (storybook wonkiness; noWarp opts out)
  // B.ao = [min, height] ground-contact darkening (null = off), B.cn / B.cnf mottling amount / frequency
  function PB() { this.parts = { s: [], g: [], e: [] }; this.ao = [0.62, 0.9]; this.cn = 0.07; this.cnf = 1.1; this.seed = 0; }
  PB.prototype.add = function (geo, color, o) {
    o = o || {};
    var b = o.glow ? 'g' : o.emis ? 'e' : 's';
    this.parts[b].push({ g: geo, c: C(color), m: o.matrix ? o.matrix.clone() : mtx(o), o: o });
    return this;
  };
  PB.prototype.glow = function (geo, color, o) { o = o || {}; o.glow = true; return this.add(geo, color, o); };
  var _pv = new T.Vector3(), _pn2 = new T.Vector3(), _pq = new T.Vector3(), _cc = new T.Color(), _ct = new T.Color();
  PB.prototype.merge = function (list, paint, flatAll) {
    if (!list.length) return null;
    var self = this, nm = new T.Matrix3(), NV = 0, NI = 0;
    list.forEach(function (part) {
      var g = part.g, cnt = g.index ? g.index.count : g.attributes.position.count;
      part.flat = flatAll || !!part.o.flat;
      NV += part.flat ? cnt : g.attributes.position.count; NI += cnt;
    });
    var pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), col = new Float32Array(NV * 3);
    var idx = NV > 65535 ? new Uint32Array(NI) : new Uint16Array(NI), n = 0, ni = 0;
    var A = new T.Vector3(), Bv = new T.Vector3(), Cv = new T.Vector3(), Fn = new T.Vector3(), E = new T.Vector3();
    var cen = new T.Vector3(), sn = new T.Vector3(), cap = new T.Color(), under = new T.Color(), base = new T.Color();
    var o, CA, hasCen, hasSn, hasCap, hasUnder;
    function shade(p, nn, vi) {
      _cc.copy(base);
      if (CA) _cc.multiply(_ct.setRGB(CA.getX(vi), CA.getY(vi), CA.getZ(vi)));
      if (!paint) return _cc;
      var k = 1;
      if (o.tb) k *= o.tb[0] + (o.tb[1] - o.tb[0]) * (nn.y * 0.5 + 0.5);
      if (hasCen) { _pq.copy(p).sub(cen); var l = _pq.length(); if (l > 1e-4) { var d = _pq.dot(nn) / l; k *= 1 - o.cen[3] * (0.5 - d * 0.5); } }
      if (hasUnder) _cc.lerp(under, o.under[1] * clamp(0.5 - nn.y * 0.7, 0, 1));
      if (hasCap) {
        var t = smooth(o.cap[1], o.cap[2], nn.y + (o.cap[3] ? (fbm3(p.x * 2.1, p.y * 2.1, p.z * 2.1, 2) - 0.5) * o.cap[3] : 0));
        if (t > 0) _cc.lerp(cap, t);
      }
      if (o.cf) k *= o.cf(p, nn);
      var cn = o.cn === undefined ? self.cn : o.cn;
      if (cn) k *= 1 + (fbm3(p.x * self.cnf + 11.3, p.y * self.cnf, p.z * self.cnf - 7.7, 2) - 0.5) * 2 * cn;
      if (!o.noAO && self.ao) k *= self.ao[0] + (1 - self.ao[0]) * smooth(0, self.ao[1], p.y);
      return _cc.multiplyScalar(k);
    }
    function put(p, nn, c) { var j = n * 3; pos[j] = p.x; pos[j + 1] = p.y; pos[j + 2] = p.z; nor[j] = nn.x; nor[j + 1] = nn.y; nor[j + 2] = nn.z; col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b; return n++; }
    list.forEach(function (part) {
      var g = part.g, P = g.attributes.position, N = g.attributes.normal, I = g.index, m = part.m;
      o = part.o; CA = g.attributes.color;
      if (!N && !part.flat) { g.computeVertexNormals(); N = g.attributes.normal; }
      nm.getNormalMatrix(m);
      var det = m.determinant() < 0, cnt = I ? I.count : P.count, warp = self.warp && !o.noWarp;
      base.copy(part.c);
      if (o.hue) { var hsl = {}; base.getHSL(hsl); base.setHSL((hsl.h + o.hue + 1) % 1, hsl.s, hsl.l); }
      hasCen = !!o.cen; if (hasCen) cen.set(o.cen[0], o.cen[1], o.cen[2]);
      hasSn = !!o.sn; if (hasSn) sn.set(o.sn[0], o.sn[1], o.sn[2]);
      hasCap = !!o.cap; if (hasCap) cap.set(o.cap[0]);
      hasUnder = !!o.under; if (hasUnder) under.set(o.under[0]);
      if (part.flat) {
        for (var i = 0; i < cnt; i += 3) {
          var ia = I ? I.getX(i) : i, ib = I ? I.getX(det ? i + 2 : i + 1) : (det ? i + 2 : i + 1), ic = I ? I.getX(det ? i + 1 : i + 2) : (det ? i + 1 : i + 2);
          A.fromBufferAttribute(P, ia).applyMatrix4(m); Bv.fromBufferAttribute(P, ib).applyMatrix4(m); Cv.fromBufferAttribute(P, ic).applyMatrix4(m);
          if (warp) { self.warp(A); self.warp(Bv); self.warp(Cv); }
          Fn.subVectors(Cv, Bv).cross(E.subVectors(A, Bv)).normalize();
          idx[ni++] = put(A, Fn, shade(A, Fn, ia)); idx[ni++] = put(Bv, Fn, shade(Bv, Fn, ib)); idx[ni++] = put(Cv, Fn, shade(Cv, Fn, ic));
        }
      } else {
        var o0 = n;
        for (var k2 = 0; k2 < P.count; k2++) {
          _pv.fromBufferAttribute(P, k2).applyMatrix4(m);
          if (warp) self.warp(_pv);
          _pn2.fromBufferAttribute(N, k2).applyMatrix3(nm).normalize();
          if (hasSn) { _pq.copy(_pv).sub(sn); if (o.sn[4]) _pq.y *= o.sn[4]; _pn2.lerp(_pq.normalize(), o.sn[3]).normalize(); }
          put(_pv, _pn2, shade(_pv, _pn2, k2));
        }
        for (var j2 = 0; j2 < cnt; j2 += 3) {
          var a = I ? I.getX(j2) : j2, b2 = I ? I.getX(j2 + 1) : j2 + 1, c2 = I ? I.getX(j2 + 2) : j2 + 2;
          idx[ni++] = o0 + a; idx[ni++] = o0 + (det ? c2 : b2); idx[ni++] = o0 + (det ? b2 : c2);
        }
      }
      g.dispose();
    });
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  };
  PB.prototype.geos = function () {
    return { s: this.merge(this.parts.s, true), f: null, g: this.merge(this.parts.g, false), e: this.merge(this.parts.e, true, true) };
  };
  // scenery material: vertex-colour toon + painterly detail (shared, cached)
  function propMat() { return M.toon(0xffffff, { vc: true, paint: true }); }

  var P = {};
  // a light, warm sun-catching version of a foliage colour (used for leaf caps)
  function sunlit(c, k) { return mix(c, '#eeff9a', k === undefined ? 0.24 : k); }
  // pointed leaf tufts poking out of a clump surface (breaks the blob silhouette)
  function leafTips(B, r, centre, R, n, col, o) {
    o = o || {};
    for (var i = 0; i < n; i++) {
      var a = r() * TAU, e = (o.lo === undefined ? -0.55 : o.lo) + r() * (o.span === undefined ? 1.25 : o.span);
      var d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      var len = (o.len || 0.32) * (0.7 + r() * 0.6);
      B.add(G.cone(len * 0.42, len, 4), sh(col, (r() - 0.5) * 0.18), { p: [centre[0] + d[0] * R * 0.93, centre[1] + d[1] * R * 0.8, centre[2] + d[2] * R * 0.93], dir: [d[0], d[1] - 0.35, d[2]], s: [1, 1, 0.45], tb: [0.6, 1.1], cn: 0.05 });
    }
  }
  // a rounded canopy (W101-style puffy crown): a soft core volume covered by many small leaf
  // puffs, so the silhouette is scalloped/leafy while soft normals make the whole crown shade
  // as one painted volume (sun-lit top, cool underside, dark crevices).
  function canopy(B, r, cx, cy, cz, R0, leaf, o) {
    o = o || {};
    var hi = sunlit(leaf, o.sun), ys = o.ys || 0.82, cen = [cx, cy - R0 * 0.3, cz, o.ao === undefined ? 0.5 : o.ao];
    var paint = { tb: [0.58, 1.08], cen: cen, cap: [hi, 0.55, 1.05, 0.3], cn: 0.05, sn: [cx, cy - R0 * 0.25, cz, o.sn === undefined ? 0.7 : o.sn, 1.15], under: [mix(leaf, '#1f4a52', 0.6), 0.45] };
    function P2(extra) { var q = {}; for (var k in paint) q[k] = paint[k]; for (var k2 in extra) q[k2] = extra[k2]; return q; }
    B.add(clump(R0 * 0.92, o.coreDet === undefined ? 2 : o.coreDet, r() * 20, 0.16), sh(leaf, -0.08), P2({ p: [cx, cy, cz], s: [1, ys, 1] }));
    var n = o.n || 26, gold = 2.39996;
    for (var i = 0; i < n; i++) {
      // fibonacci-ish spread over the upper ~80% of an ellipsoid shell
      var t = (i + 0.5) / n, e = Math.asin(1 - 1.75 * t), a = i * gold + r() * 0.4;
      var ce = Math.cos(e), dx = Math.cos(a) * ce, dy = Math.sin(e), dz = Math.sin(a) * ce;
      var rr = R0 * (o.puff || 0.36) * (0.8 + r() * 0.45) * (1 - Math.max(0, -dy) * 0.25);
      var d = R0 * (0.86 + r() * 0.08);
      B.add(clump(rr, rr > (o.hiR || 9) ? 2 : 1, r() * 40, 0.22, 0.7), sh(leaf, (r() - 0.5) * 0.08 + dy * 0.04), P2({ p: [cx + dx * d, cy + dy * d * ys, cz + dz * d], s: [1, 0.82, 1] }));
    }
  }

  // a tuft of grass blades (thin 3-sided cones) - used at the feet of props
  function grassTuft(B, r, x, z, n, col) {
    for (var b = 0; b < n; b++) {
      var a = r() * TAU, d = r() * 0.12;
      B.add(G.cone(0.03, 0.2 + r() * 0.16, 3), sh(col || '#5f9a3f', (r() - 0.4) * 0.25), { p: [x + Math.cos(a) * d, 0.08, z + Math.sin(a) * d], r: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45], noAO: true, tb: [0.7, 1.1] });
    }
  }
  P.tree_round = { v: 6, lod: true, build: function (B, r, o) {
    var h = 1.35 + r() * 0.7, bark = C(pick(r, ['#7a5232', '#6e4a2e', '#80583a'])), seed = r() * 6, lo = !!o.lod;
    var lean = 0.12 + r() * 0.3, la = r() * TAU, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    B.add(barkTube([[0, -0.1, 0], [lx * 0.15, h * 0.35, lz * 0.15], [lx * 0.6, h * 0.75, lz * 0.6], [lx, h + 1.0, lz]], 0.26, 0.14,
      { ts: lo ? 6 : 9, rs: lo ? 7 : 10, flare: 0.8, flareK: 6, lobes: 5, lobeAmp: 0.5, seed: seed, grooves: 7, grooveAmp: 0.08, wobble: 0.12 }), bark, { tb: [0.7, 1.08] });
    var rd = seeded(Math.floor(seed * 1e6) + 11);       // details use their own stream so LOD builds keep the same tree
    var nr = lo ? 0 : 3 + Math.floor(rd() * 2);
    for (var i = 0; i < nr; i++) {
      var a = i / nr * TAU + seed + rd() * 0.5, l = 0.65 + rd() * 0.4;
      B.add(barkTube([[Math.cos(a) * 0.12, 0.34, Math.sin(a) * 0.12], [Math.cos(a) * 0.42, 0.1, Math.sin(a) * 0.42], [Math.cos(a) * l, -0.03, Math.sin(a) * l]], 0.12, 0.025, { ts: 5, rs: 6, grooves: 3, seed: a }), sh(bark, -0.06), { tb: [0.7, 1.05] });
    }
    for (var b = 0; b < (lo ? 0 : 3); b++) {
      var ba = b / 3 * TAU + rd(), bl = 0.75 + rd() * 0.3;
      B.add(barkTube([[lx * 0.7, h * 0.78, lz * 0.7], [lx * 0.8 + Math.cos(ba) * bl * 0.5, h + 0.45, lz * 0.8 + Math.sin(ba) * bl * 0.5], [lx + Math.cos(ba) * bl, h + 1.05, lz + Math.sin(ba) * bl]], 0.09, 0.03, { ts: 5, rs: 5 }), bark, { tb: [0.65, 1.0] });
    }
    var leaf = C(o.color || pick(r, LEAVES)), R0 = 1.22 + r() * 0.32, top = h + 1.2;
    canopy(B, r, lx, top, lz, R0, leaf, lo ? { n: 13, puff: 0.47 } : {});
    for (var gt = 0; gt < (lo ? 0 : 4); gt++) { var ga = rd() * TAU, gd = 0.45 + rd() * 0.35; grassTuft(B, rd, Math.cos(ga) * gd, Math.sin(ga) * gd, 4); }
    if (r() < 0.4) {
      var fc = pick(r, ['#ff8aa8', '#ffe066', '#ff6a4a', '#ffffff']);
      for (var j = 0; j < (lo ? 5 : 9); j++) {
        var dd = randDirUp(r), p = onEll([lx, top + 0.1, lz], [R0 * 1.12, R0 * 0.98, R0 * 1.12], dd);
        B.add(G.sph(0.085, 6, 4), fc, { p: p, s: [1, 0.75, 1], tb: [0.8, 1.1], cn: 0 });
      }
    }
    B.ao = [0.55, 1.0];
    return { radius: 0.5, jitter: true };
  } };

  // drooping, star-lobed pine tier (top surface + closed underside)
  function pineTier(R, H, lobes, droop, seed, lo) {
    var S = lobes * (lo ? 2 : 3), K = lo ? 3 : 4, pos = [0, H, 0], idx = [];
    for (var k = 1; k <= K; k++) {
      var t = k / K;
      for (var j = 0; j < S; j++) {
        var a = j / S * TAU, lob = Math.pow(Math.abs(Math.cos(a * lobes / 2 + seed)), 1.4);
        var rr = R * t * (0.78 + 0.22 * lob) * (1 + (noise3(Math.cos(a) * 2 + seed, Math.sin(a) * 2, t * 2) - 0.5) * 0.18);
        var y = H * (1 - t) - droop * t * t * (0.45 + 0.55 * lob);
        pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      }
    }
    var uc = pos.length / 3; pos.push(0, H * 0.22 - droop * 0.5, 0);
    function vi(k, j) { return 1 + (k - 1) * S + ((j % S) + S) % S; }
    for (var j2 = 0; j2 < S; j2++) idx.push(0, vi(1, j2 + 1), vi(1, j2));
    for (var k2 = 1; k2 < K; k2++) for (var j3 = 0; j3 < S; j3++) {
      var A = vi(k2, j3), Bq = vi(k2, j3 + 1), Cq = vi(k2 + 1, j3), D = vi(k2 + 1, j3 + 1);
      idx.push(A, Bq, Cq, Bq, D, Cq);
    }
    for (var j4 = 0; j4 < S; j4++) idx.push(uc, vi(K, j4), vi(K, j4 + 1));
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  P.tree_pine = { v: 5, lod: true, build: function (B, r, o) {
    var bark = C('#6b4a2e'), base = C(o.color || pick(r, ['#2f7a4a', '#2a6e45', '#3a8a55', '#2d7550']));
    var tiers = 5 + Math.floor(r() * 2), Ht = 5.2 + r() * 0.8, tilt = (r() - 0.5) * 0.1, seed = r() * 5;
    B.add(barkTube([[0, -0.1, 0], [0, 1.2, 0], [tilt * 2, Ht * 0.7, 0]], 0.24, 0.08, { ts: 6, rs: 8, flare: 0.9, flareK: 8, lobes: 4, lobeAmp: 0.6, seed: seed, grooves: 6, grooveAmp: 0.1 }), bark, { tb: [0.65, 1.0] });
    for (var i = 0; i < tiers; i++) {
      var u = i / (tiers - 1), R = 1.85 - u * 1.3, y = 1.15 + u * (Ht - 2.1), hh = 1.25 - u * 0.35;
      var col = sh(base, -0.06 + u * 0.12);
      B.add(pineTier(R, hh, 7 + (i % 2), 0.32 + 0.25 * (1 - u), seed + i * 1.7, o.lod), col, { p: [tilt * u * 2, y, 0], r: [0, r() * TAU, 0], tb: [0.68, 1.16], cap: [sunlit(col, 0.34), 0.6, 1.0, 0.4], cen: [tilt * u * 2, y + hh * 0.2, 0, 0.25], sn: [tilt * u * 2, y + hh * 0.6, 0, 0.35], under: [mix(col, '#1a3a48', 0.5), 0.28] });
    }
    B.add(G.cone(0.32, 0.95, 7), sh(base, 0.1), { p: [tilt * 2, Ht - 0.2, 0], tb: [0.6, 1.1] });
    for (var gt = 0; gt < (o.lod ? 0 : 3); gt++) { var ga = r() * TAU, gd = 0.5 + r() * 0.4; grassTuft(B, r, Math.cos(ga) * gd, Math.sin(ga) * gd, 4, '#4f8a3f'); }
    if (r() < 0.6) for (var c = 0; c < 4; c++) { var ca = r() * TAU, cr = 0.6 + r() * 0.5; B.add(G.sph(0.08, 6, 5), '#7a4a2a', { p: [Math.cos(ca) * cr, 1.05 + r() * 1.5, Math.sin(ca) * cr], s: [1, 1.4, 1], flat: true }); }
    B.ao = [0.62, 1.2];
    return { radius: 0.5, jitter: true };
  } };

  P.tree_dead = { v: 5, lod: true, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#5b4d4f', '#4f4550', '#5d5048'])), seed = r() * 7;
    var tw = [[0, -0.1, 0], [0.15 * (r() - 0.5) * 2, 1.1, 0.05], [-0.18, 2.1, 0.12 * (r() - 0.5)], [0.25 * (r() - 0.5), 3.1, -0.12], [0.1, 3.6, 0.05]];
    B.add(barkTube(tw, 0.3, 0.05, { ts: 12, rs: 9, flare: 0.9, flareK: 6, lobes: 4, lobeAmp: 0.7, seed: seed, grooves: 5, grooveAmp: 0.14, grooveDark: 0.4, wobble: 0.25 }), c, { tb: [0.65, 1.05] });
    // gnarled branches with forks and twigs
    function branch(p0, dir, len, rad, depth) {
      var p1 = [p0[0] + dir[0] * len * 0.5, p0[1] + dir[1] * len * 0.5 + len * 0.12, p0[2] + dir[2] * len * 0.5];
      var p2 = [p0[0] + dir[0] * len + (r() - 0.5) * 0.3, p0[1] + dir[1] * len + len * 0.3, p0[2] + dir[2] * len + (r() - 0.5) * 0.3];
      B.add(barkTube([p0, p1, p2], rad, rad * 0.2, { ts: depth ? 6 : 4, rs: depth ? 6 : 4, grooves: depth ? 3 : 0, seed: len * 3 }), c, { tb: [0.65, 1.05] });
      if (depth > 0) for (var k = 0; k < 2; k++) {
        var aa = Math.atan2(dir[2], dir[0]) + (k ? 0.8 : -0.7) + (r() - 0.5) * 0.4;
        branch(p1, [Math.cos(aa), 0.35 + r() * 0.5, Math.sin(aa)], len * 0.55, rad * 0.45, depth - 1);
      }
    }
    var nb = 4 + Math.floor(r() * 2);
    for (var i = 0; i < nb; i++) {
      var a = i * TAU / nb + r() * 0.6, hh = 1.4 + i * 0.42 + r() * 0.3;
      branch([Math.cos(a) * 0.08, hh, Math.sin(a) * 0.08], [Math.cos(a), 0.25 + r() * 0.4, Math.sin(a)], 1.0 + r() * 0.6, 0.11, o.lod ? 0 : 1);
    }
    for (var k = 0; k < 5; k++) {
      var a2 = k * TAU / 5 + seed;
      B.add(barkTube([[Math.cos(a2) * 0.1, 0.4, Math.sin(a2) * 0.1], [Math.cos(a2) * 0.5, 0.12, Math.sin(a2) * 0.5], [Math.cos(a2) * 0.95, -0.02, Math.sin(a2) * 0.95]], 0.13, 0.025, { ts: 6, rs: 5, grooves: 3, seed: a2 }), sh(c, -0.12), { tb: [0.65, 1.0] });
    }
    // hollow knot
    B.add(G.sph(0.13, 8, 6), '#1a1418', { p: [0.05, 1.5, 0.24], s: [0.8, 1.3, 0.5], noAO: true, cn: 0 });
    B.add(G.tor(0.13, 0.05, 5, 10), sh(c, 0.12), { p: [0.05, 1.5, 0.25], s: [0.85, 1.3, 1], noAO: true });
    if (r() < 0.65) {
      var fu = pick(r, ['#8a5abf', '#9a6acf', '#7a8a4f']);
      for (var f = 0; f < 3; f++) B.add(G.hemi(0.2 - f * 0.04, 10, 4), sh(fu, f * 0.08), { p: [0.2, 0.95 + f * 0.27, 0.14 - f * 0.03], s: [1, 0.35, 0.8], r: [0.15, 0.7, -0.15], tb: [0.6, 1.15] });
    }
    if (r() < 0.5) for (var m = 0; m < 3; m++) { var ma = r() * TAU; B.add(G.taper([[Math.cos(ma) * 0.75, 2.5 + m * 0.3, Math.sin(ma) * 0.75], [Math.cos(ma) * 0.78, 2.0 + m * 0.3, Math.sin(ma) * 0.78], [Math.cos(ma) * 0.8, 1.6 + m * 0.3, Math.sin(ma) * 0.8]], 0.03, 0.006, 4, 3), '#6f7a5a', { noAO: true }); }
    B.ao = [0.6, 0.8];
    return { radius: 0.4, jitter: true };
  } };

  P.tree_giant = { v: 3, build: function (B, r, o) {
    var bark = C(pick(r, ['#6b4a30', '#64462e', '#70503a'])), leaf = C(o.color || pick(r, ['#3f8a4a', '#468f52', '#357a42'])), seed = r() * 9;
    B.add(barkTube([[0, -0.2, 0], [0.1, 2.5, 0.05], [-0.15, 5.0, 0.1], [0.05, 7.6, 0]], 1.25, 0.82, { ts: 14, rs: 18, flare: 0.75, flareK: 5, lobes: 7, lobeAmp: 0.55, seed: seed, grooves: 13, grooveAmp: 0.07, grooveDark: 0.35, wobble: 0.15 }), bark, { tb: [0.62, 1.05] });
    for (var i = 0; i < 7; i++) {
      var a = i * TAU / 7 + seed + r() * 0.3, l = 2.6 + r() * 0.9;
      B.add(barkTube([[Math.cos(a) * 0.9, 1.6, Math.sin(a) * 0.9], [Math.cos(a) * 1.7, 0.55, Math.sin(a) * 1.7], [Math.cos(a) * (l - 0.4), 0.05, Math.sin(a) * (l - 0.4)], [Math.cos(a + 0.15) * l, -0.08, Math.sin(a + 0.15) * l]], 0.5, 0.07, { ts: 8, rs: 8, grooves: 4, grooveAmp: 0.08, seed: a, wobble: 0.15 }), sh(bark, -0.08), { tb: [0.6, 1.05] });
    }
    for (var j = 0; j < 5; j++) {
      var b2 = j * TAU / 5 + 0.5 + r() * 0.3, bl = 2.6 + r() * 0.6;
      B.add(barkTube([[0, 5.8 + j * 0.25, 0], [Math.cos(b2) * 1.5, 7.2 + r() * 0.4, Math.sin(b2) * 1.5], [Math.cos(b2) * bl, 8.3 + r() * 0.5, Math.sin(b2) * bl]], 0.48, 0.14, { ts: 7, rs: 7, grooves: 5, seed: b2 }), bark, { tb: [0.6, 1.0] });
    }
    // crown: three overlapping puffy canopies
    canopy(B, r, 0, 9.6, 0, 3.3, leaf, { n: 34, ys: 0.72, puff: 0.32 });
    canopy(B, r, 2.2, 8.7, 0.8, 2.0, sh(leaf, 0.03), { n: 16, ys: 0.8, puff: 0.36 });
    canopy(B, r, -1.8, 8.9, -1.3, 2.1, sh(leaf, -0.03), { n: 16, ys: 0.8, puff: 0.36 });
    // hanging vines + moss beards
    for (var v = 0; v < 12; v++) {
      var va = r() * TAU, vd = 2.2 + r() * 1.6, vy = 8.0 - r() * 0.4, vl = 1.2 + r() * 1.8;
      B.add(G.taper([[Math.cos(va) * vd, vy, Math.sin(va) * vd], [Math.cos(va) * vd * 1.02, vy - vl * 0.5, Math.sin(va) * vd * 1.02], [Math.cos(va) * vd * 0.98, vy - vl, Math.sin(va) * vd * 0.98]], 0.045, 0.012, 5, 3), sh(leaf, -0.25), { noAO: true, tb: [0.7, 1.0] });
      if (v % 3 === 0) B.add(G.sph(0.08, 6, 4), sh(leaf, 0.15), { p: [Math.cos(va) * vd * 0.98, vy - vl, Math.sin(va) * vd * 0.98], noAO: true });
    }
    // mushrooms nestled in the roots
    for (var m = 0; m < 4; m++) {
      var ma = seed + m * 1.7, md = 1.6 + r() * 0.5, mx = Math.cos(ma) * md, mz = Math.sin(ma) * md, ms = 0.7 + r() * 0.5;
      B.add(G.cyl(0.05 * ms, 0.07 * ms, 0.3 * ms, 7), '#f2e6cf', { p: [mx, 0.15 * ms, mz] });
      B.add(G.hemi(0.2 * ms, 10, 4), '#e0703e', { p: [mx, 0.28 * ms, mz], s: [1, 0.7, 1], tb: [0.6, 1.15] });
    }
    for (var f = 0; f < 14; f++) {
      var a4 = r() * TAU, d = 2 + r() * 3;
      B.glow(G.sph(0.07, 5, 4), '#eaff8a', { p: [Math.cos(a4) * d, 1.2 + r() * 5.5, Math.sin(a4) * d] });
    }
    B.ao = [0.5, 1.8];
    return { radius: 1.7, jitter: true };
  } };

  P.bush = { v: 6, build: function (B, r, o) {
    var leaf = C(o.color || pick(r, LEAVES)), R0 = 0.55 + r() * 0.2, sx = 1 + r() * 0.4;
    canopy(B, r, 0, R0 * 0.62, 0, R0, leaf, { n: 9 + Math.floor(r() * 3), ys: 0.78, puff: 0.46, ao: 0.4, coreDet: 1, hiR: 0.25 });
    if (r() < 0.6) canopy(B, r, R0 * 0.8 * sx, R0 * 0.45, 0.2, R0 * 0.65, sh(leaf, 0.04), { n: 6, ys: 0.8, puff: 0.46, ao: 0.4, coreDet: 1, hiR: 0.25 });
    if (r() < 0.45) {
      var bc = pick(r, ['#e0304a', '#6a4aff', '#ffffff', '#ff9a3a']);
      for (var j = 0; j < 10; j++) B.add(G.sph(0.05, 6, 4), bc, { p: onEll([0, R0 * 0.62, 0], [R0 * 1.12, R0 * 0.95, R0 * 1.12], randDirUp(r)), cn: 0, tb: [0.75, 1.15] });
    }
    B.ao = [0.5, 0.7];
    return { radius: 0, jitter: true };
  } };

  var MOSS = '#6a8c48';
  // stone surface: faint strata bands + lichen speckles (multiplier)
  function rockSurf(seed) { return function (p) { var st = Math.sin(p.y * 7.5 + fbm3(p.x * 0.8 + seed, p.y * 0.8, p.z * 0.8, 2) * 5); var li = fbm3(p.x * 4.1 + seed, p.y * 4.1, p.z * 4.1, 2); return (1 - 0.06 * (st > 0.82 ? 1 : 0)) * (li > 0.66 ? 1.12 : 1) * (li < 0.3 ? 0.93 : 1); }; }
  P.rock = { v: 6, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#8a8f96', '#7d8288', '#969a9e', '#8c8680'])), sy = 0.6 + r() * 0.35, mossy = r() < 0.5;
    B.add(stoneGeo(0.72, 2, r() * 50, 7, 0.2), c, { p: [0, 0.72 * sy * 0.55, 0], r: [0, r() * TAU, (r() - 0.5) * 0.25], s: [1, sy, 0.8 + r() * 0.4], order: 'YXZ', tb: [0.62, 1.12], cap: mossy ? [MOSS, 0.55, 0.85, 0.6] : null, cn: 0.12, cf: rockSurf(r() * 9) });
    if (r() < 0.6) B.add(stoneGeo(0.3, 1, r() * 50, 3), sh(c, 0.06), { p: [0.68, 0.12, 0.28], r: [r(), r(), 0], tb: [0.62, 1.1], cn: 0.1 });
    if (r() < 0.5) B.add(stoneGeo(0.16, 1, r() * 50, 2), sh(c, -0.05), { p: [-0.55, 0.06, -0.4], tb: [0.62, 1.1] });
    B.cnf = 2.2; B.ao = [0.55, 0.45];
    return { radius: 0.65, jitter: true };
  } };

  P.rock_big = { v: 4, lod: true, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#8a8f96', '#7f848c', '#8c8680'])), mossy = r() < 0.7;
    var cap = mossy ? [MOSS, 0.5, 0.82, 0.7] : null;
    var rs = rockSurf(r() * 9);
    B.add(stoneGeo(1.8, o.lod ? 2 : 3, r() * 50, 9, 0.2), c, { p: [0, 1.05, 0], s: [1.1, 0.72, 1], r: [0, r() * TAU, 0.12], tb: [0.6, 1.12], cap: cap, cn: 0.12, cf: rs });
    B.add(stoneGeo(1.1, 2, r() * 50, 6), sh(c, 0.06), { p: [1.35, 0.5, 0.65], s: [1, 0.78, 1], r: [0, r() * TAU, 0], tb: [0.6, 1.12], cap: cap, cn: 0.12, cf: rs });
    B.add(stoneGeo(0.7, 2, r() * 50, 4), sh(c, -0.08), { p: [-1.55, 0.3, 0.9], s: [1, 0.75, 1], r: [0, r() * TAU, 0], tb: [0.6, 1.12], cap: cap });
    for (var i = 0; i < 4; i++) { var a = r() * TAU; B.add(stoneGeo(0.12 + r() * 0.12, 1, r() * 50, 2), sh(c, (r() - 0.5) * 0.15), { p: [Math.cos(a) * 2.1, 0.06, Math.sin(a) * 1.9], tb: [0.6, 1.1] }); }
    for (var g = 0; g < (o.lod ? 0 : 7); g++) {
      var ga = r() * TAU, gd = 1.6 + r() * 0.7;
      for (var b = 0; b < 3; b++) B.add(G.cone(0.05, 0.35 + r() * 0.25, 3), sh(MOSS, (r() - 0.3) * 0.25), { p: [Math.cos(ga) * gd + (b - 1) * 0.07, 0.12, Math.sin(ga) * gd], r: [(r() - 0.5) * 0.6, 0, (b - 1) * 0.35], noAO: true, tb: [0.7, 1.1] });
    }
    B.cnf = 1.6; B.ao = [0.55, 0.9];
    return { radius: 1.9, jitter: true };
  } };

  // lathe helper that returns a smooth cap/stem shape
  function latheS(pts, segs) { return G.lathe(pts, segs || 14); }
  function mushroomOne(B, x, z, s, cap, r, tilt) {
    var stemC = C('#f6ead2'), ry = r() * TAU, tz = tilt || 0;
    B.add(latheS([[0, 0], [0.13, 0], [0.11, 0.06], [0.085, 0.22], [0.09, 0.38], [0.075, 0.5], [0, 0.5]], 10), stemC, { p: [x, 0, z], s: s, r: [tz, ry, 0], tb: [0.85, 1.05], cn: 0.03 });
    var cy = 0.48 * s;
    // dome cap with a curled lip, and a darker gill underside
    B.add(latheS([[0.3, -0.03], [0.35, -0.01], [0.36, 0.05], [0.32, 0.15], [0.24, 0.24], [0.12, 0.29], [0, 0.3]], 14), cap, { p: [x, cy, z], s: s, r: [tz, ry, 0], tb: [0.55, 1.15], cap: [sh(cap, 0.25), 0.75, 1.0, 0.3], cn: 0.06 });
    B.add(G.cyl(0.3, 0.06, 0.06, 14, true), sh(cap, -0.5).lerp(C('#e8d8b8'), 0.6), { p: [x, cy - 0.005 * s, z], s: s, r: [tz, ry, 0], noAO: true });
    for (var j = 0; j < 7; j++) {
      var a = j * 2.39 + ry, e = 0.35 + (j % 3) * 0.35, rr = 0.36;
      var dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
      B.add(G.sph(0.05, 6, 3), '#fff8ec', { p: [x + dx * rr * s * 0.95, cy + (0.05 + dy * 0.26) * s, z + dz * rr * s * 0.95], s: [s, s * 0.45, s], dir: [dx, dy + 0.6, dz], cn: 0 });
    }
  }
  P.mushroom = { v: 6, build: function (B, r, o) {
    var cap = C(o.color || pick(r, ['#e0483e', '#e0483e', '#d9a03a', '#8a5abf'])), n = 1 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var s = i ? 0.5 + r() * 0.4 : 0.95 + r() * 0.5, a = r() * TAU, d = i ? 0.38 : 0;
      mushroomOne(B, Math.cos(a) * d, Math.sin(a) * d, s, sh(cap, (r() - 0.5) * 0.12), r, i ? (r() - 0.5) * 0.4 : 0);
    }
    for (var g = 0; g < 5; g++) { var ga = r() * TAU, gd = 0.2 + r() * 0.3; B.add(G.cone(0.035, 0.22 + r() * 0.12, 3), '#5f9a3f', { p: [Math.cos(ga) * gd, 0.08, Math.sin(ga) * gd], r: [(r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7], noAO: true }); }
    B.ao = [0.8, 0.3];
    return { radius: 0, jitter: true };
  } };

  P.flower = { v: 6, build: function (B, r, o) {
    var n = 4 + Math.floor(r() * 4), stemC = C('#4f8f3a'), leafC = C('#5fae45');
    for (var i = 0; i < n; i++) {
      var a = r() * TAU, d = r() * 0.6, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.34 + r() * 0.3, lean = (r() - 0.5) * 0.12;
      var pc = C(o.color || pick(r, ['#ff7aa8', '#ffd84d', '#9f7bff', '#ffffff', '#ff8a4d', '#6fd0ff']));
      var hx2 = x + lean, hz = z + lean * 0.5;
      B.add(G.taper([[x, 0, z], [x + lean * 0.4, h * 0.5, z + lean * 0.2], [hx2, h, hz]], 0.016, 0.011, 4, 3), stemC, { noAO: true });
      for (var l = 0; l < 2; l++) { var la = a + l * PI + r(); B.add(G.sph(0.05, 5, 3), leafC, { p: [x + Math.cos(la) * 0.07, 0.06 + l * 0.05, z + Math.sin(la) * 0.07], s: [1.9, 0.25, 0.7], r: [0, -la, 0.5], tb: [0.6, 1.1], noAO: true }); }
      B.add(G.sph(0.045, 6, 4), '#ffcf3a', { p: [hx2, h + 0.02, hz], s: [1, 0.7, 1], cn: 0, tb: [0.7, 1.1] });
      var np = 5 + (i % 2);
      for (var p = 0; p < np; p++) {
        var pa = p * TAU / np + r() * 0.2;
        B.add(G.sph(0.06, 6, 3), sh(pc, (p % 2) * 0.08), { p: [hx2 + Math.cos(pa) * 0.07, h + 0.012, hz + Math.sin(pa) * 0.07], s: [1.35, 0.35, 0.8], r: [0, -pa, 0.25], tb: [0.65, 1.15], cn: 0 });
      }
    }
    for (var g = 0; g < 6; g++) { var ga = r() * TAU, gd = r() * 0.5; B.add(G.cone(0.03, 0.2 + r() * 0.15, 3), '#5f9a3f', { p: [Math.cos(ga) * gd, 0.08, Math.sin(ga) * gd], r: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6], noAO: true }); }
    B.ao = null;
    return { radius: 0, jitter: true };
  } };

  // ---------------- built props ----------------
  var IRON = '#34323f', WOOD = '#7a5232', WOOD_D = '#5a3a22', GOLD = '#e8c25a';
  // stone courses: alternate brightness every `h` units + a little per-block noise
  function courses(h, amt, joints) {
    return function (p, n) {
      var row = Math.floor(p.y / h), f = p.y / h - row, k = 1 - (row % 2 ? amt : 0) - (hash3(row, 3, 7) - 0.5) * amt;
      if (f < 0.07) k *= 0.82;                                         // mortar line
      if (joints) { var a = Math.atan2(p.z, p.x) * joints / TAU + (row % 2) * 0.5, fa = a - Math.floor(a); if (fa < 0.04) k *= 0.85; k *= 1 + (hash3(row, Math.floor(a), 1) - 0.5) * amt; }
      return k;
    };
  }
  // wood grain stripes along an axis
  function grain(axis, f, amt) { return function (p) { var v = axis === 'x' ? p.x : axis === 'z' ? p.z : p.y; return 1 - amt * (0.5 + 0.5 * Math.sin(v * f + Math.sin(v * f * 0.37) * 2)); }; }

  P.lantern = { v: 1, build: function (B, r, o) {
    var tint = o.color ? C(o.color) : null;
    var snuffed = !!(tint && lum(tint) < 0.3);
    var iron = C(IRON), stone = C(pick(r, STONE));
    B.add(rbox(0.62, 0.2, 0.62, 0.05), sh(stone, -0.05), { p: [0, 0.1, 0], tb: [0.7, 1.08], cn: 0.1 });
    B.add(latheS([[0.24, 0], [0.24, 0.06], [0.19, 0.1], [0.17, 0.2], [0, 0.2]], 8), stone, { p: [0, 0.2, 0], r: [0, PI / 8, 0], flat: true, tb: [0.7, 1.08] });
    // turned iron post
    B.add(latheS([[0.1, 0], [0.11, 0.04], [0.075, 0.1], [0.06, 0.45], [0.085, 0.5], [0.06, 0.56], [0.048, 2.25], [0.07, 2.3], [0.05, 2.36], [0, 2.36]], 10), iron, { p: [0, 0.38, 0], tb: [0.7, 1.15], cn: 0.04 });
    B.add(G.tor(0.08, 0.022, 5, 12), sh(iron, 0.15), { p: [0, 0.95, 0], r: [PI / 2, 0, 0] });
    // scroll brackets under the head
    [-1, 1].forEach(function (sx) {
      var pts = []; for (var i = 0; i <= 8; i++) { var t = i / 8, a = t * PI * 1.6; pts.push([sx * (0.05 + Math.sin(a) * 0.14 * (1 - t * 0.4)), 2.35 + t * 0.32 - Math.cos(a) * 0.08 + 0.08, 0]); }
      B.add(G.taper(pts, 0.022, 0.012, 10, 4), iron, { tb: [0.7, 1.1] });
    });
    // head: base plate, corner posts, roof with flared eaves + finial
    B.add(latheS([[0, 0], [0.2, 0], [0.22, 0.04], [0.16, 0.08], [0, 0.08]], 4), iron, { p: [0, 2.74, 0], r: [0, PI / 4, 0], flat: true });
    for (var i = 0; i < 4; i++) { var a = i * PI / 2 + PI / 4; B.add(G.box(0.035, 0.42, 0.035), iron, { p: [Math.cos(a) * 0.16, 3.0, Math.sin(a) * 0.16] }); }
    for (var k = 0; k < 4; k++) { var a2 = k * PI / 2; B.add(G.box(0.012, 0.36, 0.012), sh(iron, 0.1), { p: [Math.cos(a2) * 0.145, 3.0, Math.sin(a2) * 0.145] }); }
    B.add(latheS([[0, 0], [0.31, 0.0], [0.28, 0.05], [0.18, 0.2], [0.06, 0.33], [0, 0.36]], 4), iron, { p: [0, 3.21, 0], r: [0, PI / 4, 0], flat: true, tb: [0.7, 1.2] });
    B.add(G.sph(0.055, 8, 6), sh(iron, 0.15), { p: [0, 3.6, 0] });
    B.add(G.tor(0.05, 0.014, 4, 10), iron, { p: [0, 3.7, 0], r: [0, 0, 0] });
    if (snuffed) { B.add(G.box(0.26, 0.36, 0.26), tint, { p: [0, 3.0, 0], flat: true }); B.add(G.cyl(0.03, 0.035, 0.08, 6), '#e8e0d0', { p: [0, 2.86, 0] }); }
    else {
      B.glow(G.box(0.25, 0.35, 0.25), tint ? sh(tint, 0.1) : '#ffd27a', { p: [0, 3.0, 0] });
      B.glow(G.sph(0.07, 8, 6), '#fff4c8', { p: [0, 2.97, 0], s: [1, 1.5, 1] });
    }
    B.ao = [0.65, 0.5];
    return { radius: 0.3, glowC: snuffed ? null : (tint || C('#ffd27a')) };
  }, extra: function (grp, rng, o, info) {
    if (!info.glowC) return;
    var h = halo(info.glowC, 1.8, 0.8); h.position.y = 3.0; grp.children[0].add(h);
    var ph = rng() * 10;
    grp.userData.anim = function (t) { var s = 1.8 * (1 + Math.sin(t * 7 + ph) * 0.04 + Math.sin(t * 13 + ph) * 0.03); h.scale.set(s, s, 1); };
  } };

  // shingled gable roof: rows of slightly irregular tiles along a concave, flared slope.
  // Ridge along X at height top+H, eaves at z = +-hd, length L.
  function shingleRoof(B, r, L, hd, H, top, col, o) {
    o = o || {};
    var rows = o.rows || 7, tw = o.tile || 0.44, nT = Math.max(2, Math.round(L / tw)), tw2 = L / nT;
    [-1, 1].forEach(function (side) {
      for (var k = 0; k < rows; k++) {
        var t0 = k / rows, t1 = (k + 1) / rows;
        function at(t) { return [hd * (1 - t), top - 0.15 + H * Math.pow(t, o.pow || 1.35)]; }
        var A = at(t0), Bp = at(t1), dz = A[0] - Bp[0], dy = Bp[1] - A[1], len = Math.sqrt(dz * dz + dy * dy) * 1.28, ang = Math.atan2(dy, dz);
        var mz = (A[0] + Bp[0]) / 2, my = (A[1] + Bp[1]) / 2;
        for (var i = 0; i < nT; i++) {
          var x = -L / 2 + (i + 0.5) * tw2 + (k % 2 ? tw2 * 0.25 : -tw2 * 0.25), c = sh(col, (hash3(i, k, side + 5) - 0.5) * 0.22 - (1 - t0) * 0.06);
          if (Math.abs(x) > L / 2 - tw2 * 0.2) continue;
          B.add(G.box(tw2 * 0.96, 0.075, len), c, { p: [x, my, side * mz], r: [side * ang, 0, (hash3(i, k, 9) - 0.5) * 0.06], tb: [0.55, 1.12], flat: true, cn: 0.04 });
        }
      }
    });
    B.add(G.cyl(0.13, 0.13, L + 0.15, 8), sh(col, -0.3), { p: [0, top - 0.15 + H + 0.05, 0], r: [0, 0, PI / 2], tb: [0.6, 1.1] });
  }
  P.house = { v: 5, build: function (B, r, o) {
    var w = 4.4, d = 3.6, wh = 2.5, b0 = 0.45, top = b0 + wh;
    var wall = C(pick(r, ['#f2e2c4', '#efe0bd', '#f5ead6', '#e9d8b8'])), timber = C(pick(r, ['#6b4a2e', '#5e3f26', '#734f30'])), stone = C(pick(r, STONE));
    var roof = C(o.color || pick(r, ['#c0504a', '#5a7fc0', '#7a5aa8', '#c27a3a', '#4f8f5a']));
    var win = C('#ffe39a'), lean = (r() - 0.5) * 0.25;
    B.warp = function (v) {
      var u = Math.max(0, v.y) / 6.5, ru = smooth(top, top + 2.8, v.y);
      v.y += 0.3 * (v.x * v.x) / 7.5 * ru;                                    // storybook roof: the ridge ends curl up
      v.x += lean * u * u + Math.sin(v.y * 1.1) * 0.03; v.z += Math.sin(v.x * 0.9 + 1) * 0.02 * u;
    };
    // stone foundation: irregular blocks round the footprint
    var W2 = w / 2 + 0.12, D2 = d / 2 + 0.12;
    function stonesAlong(x0, z0, x1, z1) {
      var len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0), x = 0;
      while (x < len - 0.05) {
        var sw = Math.min(0.45 + r() * 0.35, len - x), u = (x + sw / 2) / len;
        B.add(rbox(sw - 0.04, b0 + (r() - 0.5) * 0.08, 0.34, 0.07), sh(stone, (r() - 0.5) * 0.22), { p: [x0 + (x1 - x0) * u, b0 / 2, z0 + (z1 - z0) * u], r: [0, -ang, 0], tb: [0.7, 1.1], cn: 0.1 });
        x += sw;
      }
    }
    stonesAlong(-W2, D2, W2, D2); stonesAlong(W2, -D2, -W2, -D2); stonesAlong(-W2, -D2 + 0.3, -W2, D2 - 0.3); stonesAlong(W2, D2 - 0.3, W2, -D2 + 0.3);
    // plaster walls (subdivided so the warp can bend them) + gables
    B.add(vgrad(new T.BoxGeometry(w, wh, d, 4, 4, 4), 0.86, 1.04), wall, { p: [0, b0 + wh / 2, 0], tb: [0.85, 1.05], cn: 0.06 });
    B.add(G.prism(w - 0.02, d, 2.0), wall, { p: [0, top, 0], tb: [0.85, 1.05] });
    // timber frame
    var tb = { tb: [0.7, 1.1], cf: grain('y', 9, 0.12) };
    function beam(len, p, rot, th) { var q = { p: p, r: rot || [0, 0, 0] }; for (var kk in tb) q[kk] = tb[kk]; B.add(rbox(th || 0.2, len, th || 0.2, 0.04), timber, q); }
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) { beam(wh + 0.05, [sx * w / 2, b0 + wh / 2, sz * d / 2]); });
      beam(w + 0.15, [0, top, sx * d / 2], [0, 0, PI / 2], 0.18);
      beam(d + 0.15, [sx * w / 2, top, 0], [PI / 2, 0, 0], 0.18);
      beam(w, [0, b0 + 0.06, sx * (d / 2 + 0.02)], [0, 0, PI / 2], 0.14);
      beam(1.75, [sx * 1.55, b0 + 1.2, d / 2 + 0.05], [0, 0, sx * 0.6], 0.13);
      beam(1.75, [sx * (w / 2 + 0.05), b0 + 1.2, 1.0], [sx * 0.6, 0, 0], 0.13);
      beam(2.05, [sx * (w / 2 + 0.03), top + 0.85, 0], [0, 0, 0], 0.13);
      beam(1.4, [sx * (w / 2 + 0.04), top + 0.55, 0.62], [-0.95, 0, 0], 0.11);
      beam(1.4, [sx * (w / 2 + 0.04), top + 0.55, -0.62], [0.95, 0, 0], 0.11);
      // round gable window + side window with shutters
      B.glow(G.cyl(0.27, 0.27, 0.05, 14), win, { p: [sx * (w / 2 + 0.02), top + 0.95, 0], r: [0, 0, PI / 2] });
      B.add(G.tor(0.29, 0.055, 5, 14), timber, { p: [sx * (w / 2 + 0.05), top + 0.95, 0], r: [0, PI / 2, 0] });
      B.add(G.box(0.05, 0.56, 0.05), timber, { p: [sx * (w / 2 + 0.06), top + 0.95, 0] });
      B.glow(G.box(0.05, 0.68, 0.62), win, { p: [sx * (w / 2 + 0.02), b0 + 1.4, -0.75] });
      B.add(G.box(0.08, 0.08, 0.7), timber, { p: [sx * (w / 2 + 0.06), b0 + 1.4, -0.75] });
      B.add(G.box(0.08, 0.76, 0.08), timber, { p: [sx * (w / 2 + 0.06), b0 + 1.4, -0.75] });
      [-1, 1].forEach(function (s2) { B.add(rbox(0.06, 0.78, 0.34, 0.02), sh(roof, -0.15), { p: [sx * (w / 2 + 0.07), b0 + 1.4, -0.75 + s2 * 0.52], cf: grain('y', 30, 0.15), tb: [0.7, 1.1] }); });
    });
    // shingled roof + eave boards
    var H = 2.55, hd = (d + 1.1) / 2;
    shingleRoof(B, r, w + 0.95, hd, H, top + 0.2, roof, { rows: 7 });
    [-1, 1].forEach(function (sx) {
      var sl = Math.sqrt(H * H + hd * hd), ang = Math.atan2(H, hd);
      [-1, 1].forEach(function (sz) { B.add(rbox(0.1, 0.22, sl * 1.03, 0.03), sh(roof, -0.35), { p: [sx * (w / 2 + 0.48), top + 0.12 + H / 2, sz * hd / 2], r: [sz * ang, 0, 0], tb: [0.6, 1.1] }); });
    });
    // chimney of stacked stones
    var cx = (r() < 0.5 ? -1 : 1) * 1.3, cz = -0.55;
    for (var ly = 0; ly < 8; ly++) for (var q = 0; q < 2; q++) {
      B.add(rbox(0.6, 0.3, 0.3, 0.05), sh(stone, (r() - 0.5) * 0.2), { p: [cx + (ly % 2 ? 0 : 0.02), top + 1.1 + ly * 0.31, cz + (q - 0.5) * 0.3], r: [0, (ly % 2) * PI / 2, 0], tb: [0.65, 1.1] });
    }
    B.add(rbox(0.82, 0.16, 0.82, 0.04), sh(stone, -0.25), { p: [cx, top + 3.6, cz], tb: [0.6, 1.1] });
    B.add(G.cyl(0.18, 0.2, 0.25, 8, true), '#2a2420', { p: [cx, top + 3.74, cz], noAO: true });
    // arched plank door in a stone arch, step, lamp
    var dx = -0.55, fz = d / 2 + 0.05;
    for (var pl = 0; pl < 4; pl++) B.add(rbox(0.235, 1.45, 0.1, 0.03), sh(C('#7a4a2a'), (r() - 0.5) * 0.14), { p: [dx - 0.35 + pl * 0.235, b0 + 0.73, fz], cf: grain('y', 22, 0.12), tb: [0.75, 1.05] });
    B.add(G.cyl(0.47, 0.47, 0.1, 14), '#7a4a2a', { p: [dx, b0 + 1.45, fz], r: [PI / 2, 0, 0], tb: [0.75, 1.05] });
    for (var v = 0; v < 7; v++) { var va = v / 6 * PI; B.add(rbox(0.22, 0.3, 0.2, 0.04), sh(stone, (r() - 0.5) * 0.2), { p: [dx + Math.cos(va) * 0.6, b0 + 1.45 + Math.sin(va) * 0.6, fz + 0.03], r: [0, 0, va - PI / 2], tb: [0.7, 1.1] }); }
    B.add(G.box(0.12, 0.06, 0.04), '#3a2a1a', { p: [dx, b0 + 0.8, fz + 0.07] });
    B.add(G.sph(0.06, 8, 6), '#ffcf4a', { p: [dx + 0.28, b0 + 0.75, fz + 0.09] });
    B.add(rbox(1.25, 0.16, 0.6, 0.05), stone, { p: [dx, 0.08, fz + 0.45], tb: [0.7, 1.1] });
    B.add(G.box(0.06, 0.3, 0.06), IRON, { p: [dx + 0.82, b0 + 1.8, fz + 0.05] });
    B.glow(G.box(0.14, 0.2, 0.14), win, { p: [dx + 0.82, b0 + 1.62, fz + 0.12] });
    B.add(G.cone(0.12, 0.1, 4), IRON, { p: [dx + 0.82, b0 + 1.77, fz + 0.12], r: [0, PI / 4, 0], flat: true });
    // front window: mullions, shutters, flower box with blooms
    var wx = 1.2, wy = b0 + 1.4;
    B.glow(G.box(0.78, 0.78, 0.05), win, { p: [wx, wy, d / 2 + 0.02] });
    B.add(G.box(0.07, 0.84, 0.08), timber, { p: [wx, wy, d / 2 + 0.06] });
    B.add(G.box(0.84, 0.07, 0.08), timber, { p: [wx, wy, d / 2 + 0.06] });
    B.add(rbox(0.96, 0.1, 0.12, 0.03), timber, { p: [wx, wy + 0.45, d / 2 + 0.07] });
    [-1, 1].forEach(function (s2) { B.add(rbox(0.36, 0.84, 0.06, 0.02), sh(roof, -0.15), { p: [wx + s2 * 0.6, wy, d / 2 + 0.08], cf: grain('y', 30, 0.15), tb: [0.7, 1.1] }); });
    B.add(rbox(1.0, 0.22, 0.26, 0.03), timber, { p: [wx, wy - 0.52, d / 2 + 0.16], cf: grain('x', 25, 0.1) });
    var fcs = ['#ff6b8a', '#ffd84d', '#9f7bff', '#ff8a4d', '#ffffff'];
    for (var f = 0; f < 7; f++) {
      B.add(G.sph(0.09, 6, 4), '#4f9a3e', { p: [wx - 0.4 + f * 0.135, wy - 0.38, d / 2 + 0.18], s: [1, 0.7, 1], noAO: true });
      B.add(G.sph(0.06, 6, 4), pick(r, fcs), { p: [wx - 0.4 + f * 0.135 + 0.02, wy - 0.3 + (f % 2) * 0.04, d / 2 + 0.22], noAO: true, cn: 0 });
    }
    // back window, ivy or barrel by the wall
    B.glow(G.box(0.7, 0.7, 0.05), win, { p: [0.6, b0 + 1.4, -d / 2 - 0.02] });
    B.add(G.box(0.76, 0.07, 0.08), timber, { p: [0.6, b0 + 1.4, -d / 2 - 0.06] });
    if (r() < 0.6) {
      var bx = w / 2 - 0.1;
      B.add(latheS([[0, 0], [0.26, 0], [0.31, 0.3], [0.26, 0.6], [0, 0.6]], 12), '#8a5a32', { p: [bx + 0.3, 0, d / 2 + 0.35], cf: grain('y', 40, 0.05), tb: [0.7, 1.1] });
      B.add(G.tor(0.29, 0.02, 4, 14), IRON, { p: [bx + 0.3, 0.15, d / 2 + 0.35], r: [PI / 2, 0, 0] });
      B.add(G.tor(0.29, 0.02, 4, 14), IRON, { p: [bx + 0.3, 0.45, d / 2 + 0.35], r: [PI / 2, 0, 0] });
    } else {
      for (var iv = 0; iv < 9; iv++) B.add(clump(0.28 + r() * 0.15, 1, r() * 9, 0.3), pick(r, LEAVES), { p: [-w / 2 - 0.08, b0 + 0.3 + iv * 0.28, -d / 2 + 0.3 + r() * 0.8], s: [0.4, 1, 1], tb: [0.55, 1.1] });
    }
    B.ao = [0.7, 0.8];
    return { radius: 2.9, colliders: [{ x: -1.2, z: 0, r: 1.95 }, { x: 1.2, z: 0, r: 1.95 }] };
  } };

  P.tower = { v: 1, build: function (B, r, o) {
    var white = C('#f4f1ea'), stone = C('#d6d0c2'), gold = C(GOLD), roof = C(o.color || '#3f7fd6'), win = C('#ffe9a8'), wood = C(WOOD_D);
    var crs = courses(0.55, 0.035, 18), crsS = courses(0.45, 0.06, 24);
    // stepped stone base + buttresses + front steps
    B.add(latheS([[0, 0], [4.45, 0], [4.45, 0.35], [4.2, 0.4], [4.15, 0.65], [0, 0.65]], 40), stone, { tb: [0.7, 1.1], cf: crsS });
    for (var b = 0; b < 8; b++) {
      var ba = b / 8 * TAU + PI / 8;
      B.add(latheS([[0, 0], [0.42, 0], [0.38, 2.4], [0.15, 3.3], [0, 3.3]], 4), stone, { p: [Math.sin(ba) * 3.45, 0.6, Math.cos(ba) * 3.45], r: [0, ba + PI / 4, 0], flat: true, tb: [0.7, 1.1] });
    }
    for (var st = 0; st < 3; st++) B.add(rbox(2.9 - st * 0.25, 0.22, 0.6, 0.05), sh(stone, -0.04 * st), { p: [0, 0.11 + st * 0.2, 4.75 - st * 0.35], tb: [0.7, 1.1] });
    // main body: lathe profile with entasis
    B.add(latheS([[3.5, 0.6], [3.45, 2.0], [3.3, 3.6], [3.32, 3.75]], 40), white, { tb: [0.84, 1.08], cf: crs });
    B.add(G.tor(3.34, 0.14, 6, 48), gold, { p: [0, 3.65, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    B.add(latheS([[2.95, 3.6], [2.85, 6.0], [2.55, 8.6], [2.3, 10.2]], 40), white, { tb: [0.84, 1.08], cf: crs });
    B.add(G.tor(2.7, 0.12, 6, 44), gold, { p: [0, 6.7, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    // balcony with corbels and a railing
    B.add(latheS([[2.3, 0], [3.0, 0.38], [3.05, 0.55], [0, 0.55]], 40), stone, { p: [0, 10.0, 0], tb: [0.65, 1.1] });
    for (var c = 0; c < 12; c++) { var ca = c / 12 * TAU; B.add(G.cone(0.18, 0.55, 4), stone, { p: [Math.sin(ca) * 2.45, 9.75, Math.cos(ca) * 2.45], r: [PI, ca, 0], flat: true, tb: [0.6, 1.1] }); }
    B.add(G.tor(2.95, 0.07, 5, 48), gold, { p: [0, 11.08, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    for (var i = 0; i < 24; i++) { var a = i * TAU / 24; B.add(latheS([[0.05, 0], [0.07, 0.08], [0.04, 0.2], [0.06, 0.35], [0.04, 0.5], [0, 0.5]], 6), gold, { p: [Math.sin(a) * 2.95, 10.55, Math.cos(a) * 2.95], tb: [0.6, 1.2] }); }
    // upper drum, roof skirt, curling spire roof with shingle scallops
    B.add(latheS([[2.0, 10.5], [2.05, 11.6], [2.15, 12.6]], 32), white, { tb: [0.84, 1.08], cf: crs });
    B.add(G.tor(2.2, 0.16, 6, 40), gold, { p: [0, 12.65, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    B.add(G.cyl(2.92, 3.0, 0.2, 32), sh(roof, -0.2), { p: [0, 12.65, 0], tb: [0.6, 1.1] });
    var shingle = function (p) { var bands = (p.y - 12.7) * 3.2, sc = bands - Math.floor(bands), ang = Math.atan2(p.z, p.x) * 22 / TAU; var w = Math.abs((ang - Math.floor(ang)) - 0.5) * 2; return 0.8 + 0.25 * smooth(0.0, 0.7 + 0.3 * w, sc); };
    B.add(G.hat(2.75, 5.6, 0.22, 32), roof, { p: [0, 12.72, 0], tb: [0.6, 1.15], cf: shingle });
    B.add(G.cyl(2.3, 2.4, 0.35, 32, true), gold, { p: [0, 12.95, 0], tb: [0.6, 1.25] });
    for (var s = 0; s < 12; s++) {
      var u = 0.15 + (s % 4) * 0.16 + r() * 0.05, sa = s * 2.4;
      var rr = 2.7 * (1 - u) + 0.04, zoff = -0.22 * u * u * u * 5.6;
      B.glow(G.oct(0.12), '#fff2b0', { p: [Math.sin(sa) * rr, 12.7 + u * 5.6 - 0.22 * u * u * u * 5.6 * 0.35, Math.cos(sa) * rr + zoff], s: [1, 1.4, 1] });
    }
    // grand door: plank leaves, gold frame + rune lamp
    for (var pl = 0; pl < 5; pl++) B.add(rbox(0.32, 2.3, 0.22, 0.04), sh(wood, (r() - 0.5) * 0.15), { p: [-0.64 + pl * 0.32, 1.8, 3.38], cf: grain('y', 18, 0.12), tb: [0.75, 1.05] });
    B.add(G.cyl(0.8, 0.8, 0.22, 18), wood, { p: [0, 2.95, 3.38], r: [PI / 2, 0, 0] });
    B.add(G.tor(0.9, 0.12, 6, 20, PI), gold, { p: [0, 2.95, 3.52], tb: [0.6, 1.25] });
    B.add(rbox(0.16, 2.3, 0.22, 0.04), gold, { p: [-0.9, 1.8, 3.5], tb: [0.6, 1.25] });
    B.add(rbox(0.16, 2.3, 0.22, 0.04), gold, { p: [0.9, 1.8, 3.5], tb: [0.6, 1.25] });
    B.glow(G.sph(0.22, 10, 8), win, { p: [0, 3.0, 3.56], s: [1, 1, 0.3] });
    for (var nb = 0; nb < 2; nb++) B.add(G.tor(0.09, 0.025, 4, 10), gold, { p: [nb ? 0.25 : -0.25, 1.75, 3.52], r: [0, 0, 0] });
    // windows with gold sills and arches
    function winAt(a, y, R, h) {
      var sx = Math.sin(a), cz = Math.cos(a);
      B.glow(G.box(0.48, h, 0.16), win, { p: [sx * R, y, cz * R], r: [0, a, 0] });
      B.glow(G.cyl(0.24, 0.24, 0.16, 10), win, { p: [sx * R, y + h / 2, cz * R], r: [PI / 2, 0, a], order: 'YXZ' });
      B.add(G.tor(0.3, 0.06, 4, 12, PI), gold, { p: [sx * (R + 0.06), y + h / 2, cz * (R + 0.06)], r: [0, a, 0], tb: [0.6, 1.25] });
      B.add(rbox(0.66, 0.1, 0.3, 0.03), gold, { p: [sx * (R + 0.05), y - h / 2 - 0.05, cz * (R + 0.05)], r: [0, a, 0], tb: [0.6, 1.25] });
      B.add(G.box(0.05, h, 0.06), gold, { p: [sx * (R + 0.08), y, cz * (R + 0.08)], r: [0, a, 0] });
    }
    [1.2, 2.2, -2.2, -1.2, PI].forEach(function (a) { winAt(a, 2.3, 3.36, 0.8); });
    for (var k = 0; k < 7; k++) winAt(k * 0.95 + 0.5, 4.6 + k * 0.75, 2.86 - k * 0.075, 0.75);
    for (var m = 0; m < 6; m++) winAt(m * TAU / 6 + 0.3, 11.6, 2.07, 0.7);
    // side turret
    B.add(latheS([[1.05, 0], [1.0, 6.0], [1.1, 6.9], [1.12, 7.15]], 20), white, { p: [-3.15, 0.3, -1.3], tb: [0.75, 1.08], cf: crs });
    B.add(G.tor(1.0, 0.09, 5, 22), gold, { p: [-3.15, 7.1, -1.3], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    B.add(G.cyl(1.25, 1.3, 0.14, 20), sh(roof, -0.2), { p: [-3.15, 7.5, -1.3] });
    B.add(G.hat(1.2, 2.8, 0.35, 20), roof, { p: [-3.15, 7.55, -1.3], r: [0, 1.2, 0], tb: [0.6, 1.15], cf: shingle });
    B.add(G.sph(0.12, 8, 6), gold, { p: [-3.15 - 0.5, 7.55 + 2.55, -1.3 - 0.75] });
    winAt(-1.4, 5.5, 0.97, 0.5); winAt(-2.2, 3.2, 1.0, 0.5);
    B.ao = [0.72, 1.4]; B.cnf = 0.6; B.cn = 0.04;
    return { radius: 4.2 };
  }, extra: function (grp, rng, o) {
    var top = pivot(grp.children[0], 0, 19.4, 0);
    var cr = new T.Mesh(G.oct(0.6), M.glow('#ffe27a')); cr.scale.set(1, 1.6, 1); top.add(cr);
    var ring = new T.Mesh(G.tor(1.1, 0.06, 4, 28), M.glow('#fff2b0')); ring.rotation.x = PI / 2; top.add(ring);
    var ring2 = new T.Mesh(G.tor(0.8, 0.04, 4, 24), M.glow('#ffe27a')); top.add(ring2);
    var h = halo('#ffd76a', 4.5, 0.85); top.add(h);
    // v2.0 WS-E (story R5 / B3): WF.story drives the flame through flameMod.
    //  dim 0..1 (gutter: the flame shrinks almost out), lx/lz lean in the prop's units, boost 0..1 (brighter)
    var fm = grp.userData.flameMod = { dim: 0, lx: 0, lz: 0, boost: 0 };
    grp.userData.flame = { pivot: top };
    grp.userData.anim = function (t) {
      top.position.y = 19.4 + Math.sin(t * 1.2) * 0.25;
      top.position.x = fm.lx; top.position.z = fm.lz;
      cr.rotation.y = t * 0.8; ring.rotation.z = t * 0.5; ring.rotation.x = PI / 2 + Math.sin(t * 0.7) * 0.25;
      ring2.rotation.y = -t * 0.9; ring2.rotation.x = Math.sin(t * 0.5) * 0.4;
      var lit = (1 - fm.dim * 0.85) * (1 + fm.boost);
      cr.scale.set(lit, 1.6 * lit * (1 - fm.dim * 0.1), lit); cr.rotation.z = -fm.lx * 0.35; cr.rotation.x = fm.lz * 0.35;
      ring.scale.setScalar(1 - fm.dim * 0.5); ring2.scale.setScalar(1 - fm.dim * 0.5);
      var s = 4.5 * (1 + Math.sin(t * 2) * 0.08) * lit; h.scale.set(s, s, 1);
    };
  } };

  P.fountain = { v: 1, build: function (B, r, o) {
    var stone = C(o.color || '#d6d0c2'), gold = C(GOLD), crs = courses(0.3, 0.05, 20);
    // outer basin with a carved, scalloped rim
    B.add(latheS([[0, 0], [2.25, 0], [2.3, 0.08], [2.22, 0.14], [2.22, 0.42], [2.34, 0.5], [2.36, 0.62], [2.2, 0.68], [2.0, 0.66], [1.95, 0.32], [0, 0.32]], 40), stone, { tb: [0.7, 1.1], cf: crs });
    for (var i = 0; i < 16; i++) { var a = i * TAU / 16; B.add(G.sph(0.17, 8, 6), sh(stone, 0.04), { p: [Math.sin(a) * 2.18, 0.66, Math.cos(a) * 2.18], s: [1, 0.5, 0.7], r: [0, a, 0], tb: [0.7, 1.12] }); }
    for (var j = 0; j < 8; j++) { var a2 = j * TAU / 8 + PI / 8; B.add(rbox(0.28, 0.5, 0.18, 0.04), sh(stone, -0.08), { p: [Math.sin(a2) * 2.27, 0.27, Math.cos(a2) * 2.27], r: [0, a2, 0], tb: [0.7, 1.1] }); }
    // central column: fluted with rings, middle bowl, top bowl, gold orb
    B.add(latheS([[0.42, 0.3], [0.36, 0.45], [0.27, 0.6], [0.24, 1.2], [0.3, 1.38], [0.26, 1.5]], 16), stone, { tb: [0.7, 1.1] });
    B.add(G.tor(0.27, 0.05, 6, 18), sh(stone, 0.05), { p: [0, 0.75, 0], r: [PI / 2, 0, 0] });
    B.add(latheS([[0, 1.5], [0.6, 1.52], [0.98, 1.62], [1.1, 1.8], [1.08, 1.9], [0.96, 1.92], [0.88, 1.75], [0, 1.75]], 32), stone, { tb: [0.65, 1.12] });
    for (var k = 0; k < 12; k++) { var a3 = k * TAU / 12; B.add(G.sph(0.09, 6, 4), sh(stone, 0.05), { p: [Math.sin(a3) * 1.07, 1.88, Math.cos(a3) * 1.07], s: [1, 0.55, 1] }); }
    B.add(latheS([[0.16, 1.75], [0.11, 1.95], [0.11, 2.3], [0.17, 2.42]], 12), stone, { tb: [0.7, 1.1] });
    B.add(latheS([[0, 2.4], [0.35, 2.42], [0.5, 2.55], [0.48, 2.62], [0.4, 2.6], [0, 2.56]], 20), stone, { tb: [0.65, 1.12] });
    B.add(G.sph(0.17, 14, 10), gold, { p: [0, 2.78, 0], tb: [0.6, 1.25] });
    B.add(G.cone(0.05, 0.22, 8), gold, { p: [0, 2.97, 0] });
    // four fish spouts on the column
    for (var f = 0; f < 4; f++) {
      var fa = f * PI / 2 + PI / 4, fx = Math.sin(fa), fz = Math.cos(fa);
      B.add(G.sph(0.12, 8, 6), '#c9a24a', { p: [fx * 0.28, 1.15, fz * 0.28], s: [0.8, 0.8, 1.4], r: [0, fa, 0], tb: [0.6, 1.2] });
      B.add(G.cone(0.1, 0.18, 6), '#c9a24a', { p: [fx * 0.12, 1.15, fz * 0.12], dir: [-fx, 0, -fz] });
    }
    // lily pads + coins in the pool
    for (var l = 0; l < 5; l++) { var la = r() * TAU, ld = 1.2 + r() * 0.6; B.add(new T.CylinderGeometry(0.18, 0.18, 0.02, 10, 1, false, 0, TAU - 0.6), '#4f9a3e', { p: [Math.cos(la) * ld, 0.53, Math.sin(la) * ld], r: [0, r() * TAU, 0], noAO: true }); }
    B.ao = [0.7, 0.6];
    return { radius: 2.3 };
  }, extra: function (grp, rng, o) {
    var g = grp.children[0];
    var water = M.toon('#6fd0ff', { emissive: '#1e6a9a', emissiveIntensity: 0.6, opacity: 0.88 });
    // three pool surfaces in one mesh, spray in single-pass materials (1 draw call each)
    var wg = new PB(); wg.ao = null; wg.cn = 0;
    wg.add(G.cyl(1.98, 1.98, 0.04, 40), '#ffffff', { p: [0, 0.5, 0] }); wg.add(G.cyl(0.9, 0.9, 0.03, 28), '#ffffff', { p: [0, 1.8, 0] }); wg.add(G.cyl(0.42, 0.42, 0.03, 16), '#ffffff', { p: [0, 2.58, 0] });
    var wgeo = wg.merge(wg.parts.s, false); wgeo.deleteAttribute('color');
    var w1 = new T.Mesh(wgeo, water); w1.receiveShadow = true; g.add(w1);
    function spr(op) { return cmat('fspray' + op, function () { var m = new T.MeshBasicMaterial({ color: C('#cff4ff'), transparent: true, opacity: op, depthWrite: false, side: T.DoubleSide }); m.forceSinglePass = true; return m; }); }
    var jet = new T.Mesh(G.cone(0.1, 0.8, 10), spr(0.45)); jet.position.y = 3.3; g.add(jet);
    var cg = new PB(); cg.ao = null; cg.cn = 0;
    cg.add(G.cyl(0.98, 1.16, 1.25, 28, true), '#ffffff', { p: [0, 1.2, 0] }); cg.add(G.cyl(0.46, 0.6, 0.7, 20, true), '#ffffff', { p: [0, 2.25, 0] });
    for (var f = 0; f < 4; f++) { var fa = f * PI / 2 + PI / 4; cg.add(G.cyl(0.035, 0.05, 0.9, 6, true), '#ffffff', { p: [Math.sin(fa) * 0.55, 0.85, Math.cos(fa) * 0.55], r: [Math.cos(fa) * 0.7, 0, -Math.sin(fa) * 0.7] }); }
    var cgeo = cg.merge(cg.parts.s, false); cgeo.deleteAttribute('color');
    var curtain = new T.Mesh(cgeo, spr(0.3)); g.add(curtain);
    grp.userData.anim = function (t) {
      jet.scale.set(1, 1 + Math.sin(t * 9) * 0.12, 1);
      curtain.scale.set(1 + Math.sin(t * 6) * 0.015, 1 + Math.sin(t * 11) * 0.01, 1 + Math.cos(t * 6) * 0.015);
    };
  } };

  P.fence = { v: 4, build: function (B, r, o) {
    var wood = C(o.color || pick(r, ['#a07a4f', '#9a7248', '#a8845a']));
    [-1.5, 0, 1.5].forEach(function (x) {
      var tl = (r() - 0.5) * 0.12, hh = 1.1 + r() * 0.12;
      B.add(rbox(0.2, hh, 0.2, 0.035), sh(wood, -0.12 + (r() - 0.5) * 0.1), { p: [x, hh / 2, 0], r: [0, r() * 0.3, tl], tb: [0.7, 1.08], cf: grain('y', 16, 0.15) });
      B.add(G.cone(0.15, 0.24, 4), sh(wood, -0.1), { p: [x - tl * hh * 0.5, hh + 0.11, 0], r: [0, PI / 4, tl], flat: true, tb: [0.7, 1.1] });
      for (var g = 0; g < 3; g++) B.add(G.cone(0.035, 0.22 + r() * 0.14, 3), '#5f9a3f', { p: [x + (g - 1) * 0.12, 0.09, 0.12 - g * 0.06], r: [(r() - 0.5) * 0.6, 0, (g - 1) * 0.4], noAO: true });
    });
    [0.42, 0.84].forEach(function (y, i) {
      var sag = (r() - 0.5) * 0.06;
      B.add(rbox(3.25, 0.14, 0.08, 0.025), sh(wood, (r() - 0.5) * 0.1), { p: [0, y, 0.13], r: [0, (r() - 0.5) * 0.03, sag], tb: [0.7, 1.1], cf: grain('x', 7, 0.18) });
      [-1.5, 0, 1.5].forEach(function (x) { B.add(G.cyl(0.018, 0.018, 0.03, 5), '#3a3640', { p: [x, y + sag * x * 0.3, 0.18], r: [PI / 2, 0, 0] }); });
    });
    B.ao = [0.65, 0.5];
    return { radius: 0.5, colliders: rowColliders(-1.5, 1.5, 0.75, 0.35) };
  } };

  function bannerTex(color) {
    var key = 'ban2' + hx(color);
    if (texCache[key]) return texCache[key];
    var c = canvas(128, 256), x = c.getContext('2d'), col = C(color);
    var hsl = {}; col.getHSL(hsl);
    var evil = hsl.h > 0.68 && hsl.h < 0.92 || hsl.l < 0.18;
    var base = '#' + col.getHexString(), dark = '#' + sh(col, -0.3).getHexString(), lite = '#' + sh(col, 0.12).getHexString();
    var gr = x.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, dark); gr.addColorStop(0.25, base); gr.addColorStop(0.6, lite); gr.addColorStop(1, dark);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 256);
    // woven cloth texture
    for (var yy = 0; yy < 256; yy += 3) { x.fillStyle = 'rgba(0,0,0,' + (0.04 + (yy % 6 ? 0 : 0.03)) + ')'; x.fillRect(0, yy, 128, 1); }
    var trim = evil ? '#9dff5a' : '#ffe9a0', trim2 = evil ? '#2a1640' : '#c9a24a';
    x.strokeStyle = trim2; x.lineWidth = 12; x.strokeRect(6, -10, 116, 252);
    x.strokeStyle = trim; x.lineWidth = 5; x.strokeRect(10, -10, 108, 246);
    // stitched inner border
    x.setLineDash([5, 4]); x.lineWidth = 1.5; x.strokeStyle = trim; x.strokeRect(19, -10, 90, 236); x.setLineDash([]);
    x.fillStyle = trim; x.strokeStyle = trim; x.lineWidth = 6;
    x.beginPath();
    if (evil) {
      x.arc(64, 110, 30, 0, TAU); x.fill();
      x.fillStyle = base; x.beginPath(); x.arc(76, 100, 27, 0, TAU); x.fill();
      x.fillStyle = trim; x.beginPath(); x.ellipse(64, 175, 20, 9, 0, 0, TAU); x.fill();
      x.fillStyle = base; x.beginPath(); x.arc(64, 175, 6, 0, TAU); x.fill();
    } else {
      x.arc(64, 115, 22, 0, TAU); x.fill();
      for (var i = 0; i < 12; i++) {
        var a = i * TAU / 12; x.beginPath();
        x.moveTo(64 + Math.cos(a) * 28, 115 + Math.sin(a) * 28); x.lineTo(64 + Math.cos(a) * (i % 2 ? 38 : 46), 115 + Math.sin(a) * (i % 2 ? 38 : 46)); x.stroke();
      }
      x.fillStyle = base; x.beginPath(); x.arc(64, 115, 12, 0, TAU); x.fill();
      x.fillStyle = trim; x.beginPath(); x.arc(64, 115, 6, 0, TAU); x.fill();
    }
    // little diamonds near the hem
    x.fillStyle = trim; [40, 64, 88].forEach(function (dx) { x.beginPath(); x.moveTo(dx, 196); x.lineTo(dx + 6, 204); x.lineTo(dx, 212); x.lineTo(dx - 6, 204); x.fill(); });
    var t = new T.CanvasTexture(c);
    t.userData.cached = true;
    return (texCache[key] = t);
  }
  P.banner = { v: 1, build: function (B, r, o) {
    var gold = C('#c9a24a'), wood = C(WOOD_D), stone = C(pick(r, STONE));
    B.add(latheS([[0, 0], [0.38, 0], [0.38, 0.1], [0.3, 0.16], [0.26, 0.3], [0.12, 0.34], [0, 0.34]], 10), stone, { tb: [0.7, 1.1], cf: courses(0.17, 0.06) });
    B.add(latheS([[0.07, 0], [0.065, 4.2], [0.08, 4.25], [0.06, 4.3], [0, 4.3]], 8), wood, { p: [0, 0.3, 0], tb: [0.7, 1.08], cf: grain('y', 13, 0.1) });
    for (var k = 0; k < 3; k++) B.add(G.tor(0.075, 0.02, 4, 10), gold, { p: [0, 0.5 + k * 1.4, 0], r: [PI / 2, 0, 0] });
    B.add(rbox(1.35, 0.08, 0.08, 0.02), gold, { p: [0, 4.05, 0.1], tb: [0.6, 1.2] });
    [-1, 1].forEach(function (sx) {
      var pts = []; for (var i = 0; i <= 8; i++) { var t = i / 8, a = t * PI * 1.5; pts.push([sx * (0.66 + Math.sin(a) * 0.08), 4.05 + (1 - Math.cos(a)) * 0.08, 0.1]); }
      B.add(G.taper(pts, 0.03, 0.015, 8, 4), gold, { tb: [0.6, 1.2] });
    });
    B.add(G.sph(0.11, 10, 8), gold, { p: [0, 4.68, 0], tb: [0.6, 1.25] });
    B.add(G.cone(0.06, 0.28, 8), gold, { p: [0, 4.88, 0] });
    [-1, 1].forEach(function (sx) { B.add(G.sph(0.07, 6, 4), gold, { p: [sx * 0.13, 4.68, 0], s: [1.6, 0.4, 0.8], r: [0, 0, sx * 0.4] }); });
    B.ao = [0.7, 0.4];
    return { radius: 0.3 };
  }, extra: function (grp, rng, o) {
    var col = C(o.color || '#ffd76a');
    var g = new T.PlaneGeometry(1.15, 2.1, 6, 14); g.translate(0, -1.05, 0);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) { var yy = p.getY(i), xx = p.getX(i); if (yy < -2.05) p.setY(i, -1.75 - (0.575 - Math.abs(xx)) / 0.575 * 0.35 * (Math.abs(xx) < 0.2 ? 1 : 0.6)); }
    // swallow-tail hem: centre notch up
    for (var j = 0; j < p.count; j++) { if (p.getY(j) < -1.74 && Math.abs(p.getX(j)) < 0.01) p.setY(j, -1.72); }
    var orig = Float32Array.from(p.array);
    var key = 'banmat2' + hx(col);
    var mat = matCache[key] || (matCache[key] = (function () { var m = new T.MeshToonMaterial({ color: 0xffffff, map: bannerTex(col), gradientMap: gradient, side: T.DoubleSide }); m.userData.cached = true; return m; })());
    var cloth = new T.Mesh(g, mat); cloth.position.set(0, 4.0, 0.12); cloth.castShadow = true;
    grp.children[0].add(cloth);
    var ph = rng() * 10;
    grp.userData.anim = function (t) {
      for (var i = 0; i < p.count; i++) {
        var y = orig[i * 3 + 1], x = orig[i * 3];
        p.setZ(i, Math.sin(t * 2.2 + y * 2.2 + x * 1.5 + ph) * 0.09 * (-y / 2.1 + 0.15) + Math.sin(t * 3.1 + x * 4 + ph) * 0.02 * (-y / 2.1));
      }
      p.needsUpdate = true;
    };
  } };

  // fluted column shaft (24 flutes need 72 segments): open tube, base at y=0
  function flutedShaft(r0, r1, h, flutes, hs) {
    var segs = flutes * 3, g = new T.CylinderGeometry(r1, r0, h, segs, hs || 4, true); g.translate(0, h / 2, 0);
    var P = g.attributes.position;
    for (var i = 0; i < P.count; i++) {
      var x = P.getX(i), z = P.getZ(i), a = Math.atan2(z, x), k = 1 - 0.06 * Math.pow(Math.max(0, Math.cos(a * flutes)), 0.6);
      P.setXYZ(i, x * k, P.getY(i), z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function ivy(B, r, x0, y0, z0, h, rad, n, leafC) {
    var pts = []; for (var i = 0; i <= 10; i++) { var t = i / 10, a = t * TAU * 1.2 + r(); pts.push([x0 + Math.cos(a) * rad, y0 + t * h, z0 + Math.sin(a) * rad]); }
    B.add(G.taper(pts, 0.03, 0.012, 16, 3), '#4a5a2a', { noAO: true });
    for (var k = 0; k < n; k++) { var p = pts[1 + Math.floor(r() * 9)], a2 = r() * TAU; B.add(G.sph(0.09, 5, 3), sh(leafC, (r() - 0.5) * 0.2), { p: [p[0] + Math.cos(a2) * 0.06, p[1] + (r() - 0.5) * 0.1, p[2] + Math.sin(a2) * 0.06], s: [1.2, 0.35, 0.9], r: [r(), r() * 3, r()], tb: [0.6, 1.1], noAO: true }); }
  }
  P.pillar = { v: 4, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#cfc8b8', '#c4bdae', '#d6d0c2'])), tl = (r() - 0.5) * 0.06, mossy = r() < 0.5;
    var cap = mossy ? [MOSS, 0.6, 0.9, 0.5] : null;
    B.add(rbox(1.3, 0.36, 1.3, 0.05), sh(c, -0.08), { p: [0, 0.18, 0], tb: [0.65, 1.1], cap: cap });
    B.add(latheS([[0.62, 0], [0.63, 0.08], [0.55, 0.14], [0.52, 0.2], [0.56, 0.26], [0.5, 0.32], [0, 0.32]], 24), c, { p: [0, 0.36, 0], tb: [0.65, 1.1] });
    B.add(flutedShaft(0.48, 0.43, 3.85, 16, 6), c, { p: [0, 0.68, 0], r: [0, 0, tl], tb: [0.7, 1.1], cn: 0.1 });
    B.add(latheS([[0.44, 0], [0.5, 0.1], [0.58, 0.22], [0.62, 0.3], [0, 0.3]], 24), c, { p: [-tl * 2.2, 4.5, 0], tb: [0.65, 1.12] });
    [-1, 1].forEach(function (sx) {
      var pts = []; for (var i = 0; i <= 12; i++) { var t = i / 12, a = t * TAU * 1.1; pts.push([-tl * 2.2 + sx * (0.5 + Math.cos(a) * 0.14 * (1 - t * 0.7)), 4.68 + Math.sin(a) * 0.14 * (1 - t * 0.7), 0.0]); }
      B.add(G.taper(pts, 0.07, 0.03, 16, 5), sh(c, 0.03), { tb: [0.65, 1.1] });
    });
    B.add(rbox(1.25, 0.28, 1.25, 0.05), sh(c, -0.05), { p: [-tl * 2.2, 4.95, 0], tb: [0.65, 1.12], cap: cap });
    // cracks
    for (var k = 0; k < 3; k++) { var ka = r() * TAU, ky = 1.2 + r() * 2.5; B.add(G.box(0.025, 0.4 + r() * 0.4, 0.02), sh(c, -0.5), { p: [Math.cos(ka) * 0.465, ky, Math.sin(ka) * 0.465], r: [0, -ka, (r() - 0.5) * 0.8], noAO: true, cn: 0 }); }
    if (mossy) B.add(clump(0.5, 1, r() * 9, 0.3), MOSS, { p: [0.15 - tl * 2.2, 5.12, 0.05], s: [1.2, 0.28, 1], tb: [0.6, 1.1] });
    if (r() < 0.6) ivy(B, r, 0, 0.6, 0, 3.6, 0.5, 18, C('#4f8a3a'));
    B.ao = [0.62, 0.8];
    return { radius: 0.62 };
  } };

  P.pillar_broken = { v: 4, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#bdb6a6', '#b0a998', '#c4bdae'])), h = 1.2 + r() * 1.4, cap = [MOSS, 0.55, 0.9, 0.6];
    B.add(rbox(1.3, 0.36, 1.3, 0.05), sh(c, -0.08), { p: [0, 0.18, 0], r: [0, 0, 0.03], tb: [0.65, 1.1], cap: cap });
    B.add(latheS([[0.62, 0], [0.63, 0.08], [0.55, 0.14], [0.52, 0.2], [0.56, 0.26], [0.5, 0.32], [0, 0.32]], 24), c, { p: [0, 0.36, 0], tb: [0.65, 1.1] });
    // shaft with a jagged, broken top (closed)
    var shaft = flutedShaft(0.48, 0.46, h, 16, 5), SP2 = shaft.attributes.position, sd = r() * 9;
    for (var i = 0; i < SP2.count; i++) { var y = SP2.getY(i); if (y > h - 1e-3) { var a = Math.atan2(SP2.getZ(i), SP2.getX(i)); SP2.setY(i, y + (fbm3(Math.cos(a) * 2 + sd, Math.sin(a) * 2, 0, 2) - 0.5) * 0.9 + Math.cos(a + sd) * 0.25); } }
    shaft.computeVertexNormals();
    B.add(shaft, c, { p: [0, 0.68, 0], tb: [0.7, 1.1], cn: 0.1 });
    B.add(stoneGeo(0.47, 2, sd, 3, 0.3), sh(c, 0.05), { p: [0, 0.68 + h - 0.05, 0], s: [1, 0.35, 1], tb: [0.6, 1.15], cap: cap });
    // fallen drum and rubble
    var fa = r() * TAU;
    B.add(flutedShaft(0.45, 0.45, 0.85, 16, 1), sh(c, -0.05), { p: [1.45, 0.45, 0.35], r: [0, fa, PI / 2], order: 'YXZ', tb: [0.65, 1.1] });
    B.add(G.cyl(0.42, 0.42, 0.01, 24), sh(c, -0.1), { p: [1.45, 0.45, 0.35], r: [0, fa, PI / 2], order: 'YXZ' });
    for (var j = 0; j < 6; j++) B.add(stoneGeo(0.13 + r() * 0.13, 1, r() * 40, 3), sh(c, (r() - 0.5) * 0.15), { p: [(r() - 0.5) * 2.6, 0.06, (r() - 0.5) * 2.6], tb: [0.65, 1.1], cap: cap });
    if (r() < 0.6) ivy(B, r, 0, 0.6, 0, h * 0.8, 0.5, 10, C('#4f8a3a'));
    B.ao = [0.6, 0.7];
    return { radius: 0.7 };
  } };

  P.arch = { v: 3, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#9a948a', '#8f897f', '#a39d92'])), glowC = C(o.color ? sh(o.color, 0.4) : '#8affb0'), cap = [MOSS, 0.55, 0.9, 0.6];
    [-1, 1].forEach(function (s) {
      B.add(rbox(1.2, 0.42, 1.2, 0.06), sh(c, -0.1), { p: [s * 2.0, 0.21, 0], tb: [0.65, 1.1], cap: cap });
      var y = 0.42;
      for (var k = 0; k < 4; k++) {
        var bh = 0.62 + r() * 0.12, bw = k % 2 ? 0.86 : 0.94;
        B.add(rbox(bw, bh - 0.03, bw, 0.07), sh(c, (r() - 0.5) * 0.14), { p: [s * 2.0 + (r() - 0.5) * 0.04, y + bh / 2, 0], r: [0, (r() - 0.5) * 0.08, 0], tb: [0.65, 1.1], cn: 0.1 });
        y += bh;
      }
      B.add(rbox(1.12, 0.3, 1.12, 0.05), sh(c, -0.05), { p: [s * 2.0, 3.25, 0], tb: [0.65, 1.12], cap: cap });
      B.glow(G.box(0.16, 0.22, 0.02), glowC, { p: [s * 2.0, 1.6, 0.48] });
    });
    var nb = 9;
    for (var i = 0; i < nb; i++) {
      var a = i / (nb - 1) * PI, rr = 2.05, key = i === 4;
      B.add(rbox(key ? 0.78 : 0.68, key ? 1.05 : 0.88, key ? 1.05 : 0.95, 0.07), key ? sh(c, 0.06) : sh(c, (r() - 0.5) * 0.12), { p: [Math.cos(a) * rr, 3.4 + Math.sin(a) * rr, (r() - 0.5) * 0.06], r: [0, 0, a - PI / 2], tb: [0.65, 1.12], cap: cap, cn: 0.1 });
    }
    B.glow(G.box(0.22, 0.32, 0.03), glowC, { p: [0, 5.45, 0.54] });
    B.glow(G.box(0.22, 0.32, 0.03), glowC, { p: [0, 5.45, -0.54] });
    B.glow(G.tor(0.2, 0.025, 4, 12), glowC, { p: [0, 5.45, 0.55] });
    // hanging ivy curtain + moss tufts
    for (var m = 0; m < 9; m++) {
      var mx = -1.7 + m * 0.42 + r() * 0.2, my = 3.4 + Math.sqrt(Math.max(0, 4.2 - mx * mx)) * 0.95 - 0.2, ml = 0.4 + r() * 0.9;
      B.add(G.taper([[mx, my, 0.44], [mx + 0.05, my - ml * 0.5, 0.47], [mx - 0.03, my - ml, 0.46]], 0.025, 0.01, 5, 3), '#4f6a32', { noAO: true });
      for (var lf = 0; lf < 3; lf++) B.add(G.sph(0.08, 5, 3), sh(C('#4f8a3a'), (r() - 0.5) * 0.2), { p: [mx + (r() - 0.5) * 0.1, my - ml * (0.3 + lf * 0.3), 0.48], s: [1.1, 0.9, 0.35], noAO: true, tb: [0.6, 1.1] });
    }
    B.ao = [0.6, 1.0];
    return { radius: 0, colliders: [{ x: -2.0, z: 0, r: 0.62 }, { x: 2.0, z: 0, r: 0.62 }] };
  } };

  P.ruin_wall = { v: 4, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#8c8578', '#857e72', '#938b7e'])), cap = [MOSS, 0.6, 0.92, 0.6];
    var x = -2.5, cols = [];
    while (x < 2.45) {
      var bw = Math.min(0.75 + r() * 0.4, 2.5 - x), rows = 1 + Math.floor(r() * 4);
      cols.push([x + bw / 2, rows * 0.68]);
      if (Math.abs(x + bw / 2) < 1.2 && rows < 2) rows = 2;
      for (var j = 0; j < rows; j++) {
        var bh = 0.68, trim = j === 1;
        B.add(rbox(bw - 0.05, bh - 0.05, 0.8 + (r() - 0.5) * 0.08, 0.07), sh(c, (r() - 0.5) * 0.2 + (trim ? 0.06 : 0)), { p: [x + bw / 2 + (j % 2 ? 0.03 : 0), bh / 2 + j * bh, (r() - 0.5) * 0.05], r: [0, (r() - 0.5) * 0.05, (r() - 0.5) * 0.03], tb: [0.62, 1.1], cap: j === rows - 1 ? cap : null, cn: 0.1 });
        if (trim) for (var t = 0; t < 3; t++) B.add(G.box(bw * 0.24, 0.05, 0.05), sh(c, -0.25), { p: [x + bw * (0.2 + t * 0.3), bh * 1.5, 0.42], r: [0, 0, PI / 4], noAO: true });
      }
      if (rows < 4 && r() < 0.6) B.add(stoneGeo(0.2 + r() * 0.08, 1, r() * 30, 3), c, { p: [x + bw / 2, rows * 0.68 + 0.08, 0], tb: [0.62, 1.1], cap: cap });
      x += bw;
    }
    // carved trim course along the base
    B.add(rbox(5.1, 0.18, 0.95, 0.05), sh(c, -0.12), { p: [0, 0.09, 0], tb: [0.6, 1.1] });
    // cracks
    for (var k = 0; k < 3; k++) B.add(G.box(0.03, 0.5 + r() * 0.4, 0.02), sh(c, -0.55), { p: [(r() - 0.5) * 3.5, 0.6 + r() * 0.4, 0.42], r: [0, 0, (r() - 0.5) * 0.9], noAO: true, cn: 0 });
    // rubble
    for (var q = 0; q < 5; q++) B.add(stoneGeo(0.18 + r() * 0.2, 1, r() * 30, 3), sh(c, -0.08), { p: [(r() - 0.5) * 4.2, 0.12, 0.85 + r() * 0.7], tb: [0.62, 1.1], cap: cap });
    // ivy draping down from the top of a few columns
    for (var m = 0; m < 3; m++) {
      var col = cols[Math.floor(r() * cols.length)], ivyC = C(pick(r, ['#4f7a3a', '#557f3c', '#486f36']));
      for (var sI = 0; sI < 4; sI++) {
        var vx = col[0] + (sI - 1.5) * 0.16 + (r() - 0.5) * 0.08, top = col[1] + 0.02, len = 0.5 + r() * Math.min(1.4, top - 0.2);
        B.add(G.taper([[vx, top, 0.3], [vx, top + 0.02, 0.43], [vx + 0.04, top - len * 0.5, 0.45], [vx - 0.03, top - len, 0.44]], 0.022, 0.01, 6, 3), '#4a5a2a', { noAO: true });
        for (var lf = 0; lf < 5; lf++) B.add(G.sph(0.075, 5, 3), sh(ivyC, (r() - 0.5) * 0.25), { p: [vx + (r() - 0.5) * 0.1, top - len * lf / 5, 0.46], s: [1.1, 0.9, 0.3], r: [0, 0, r() * 3], tb: [0.6, 1.1], noAO: true });
      }
      B.add(clump(0.24, 1, r() * 9, 0.3), ivyC, { p: [col[0], col[1] + 0.05, 0.2], s: [1.5, 0.4, 1.0], tb: [0.6, 1.12], noAO: true });
    }
    if (r() < 0.6) B.glow(G.box(0.28, 0.36, 0.03), '#a98aff', { p: [(r() - 0.5) * 2, 0.95, 0.44] });
    B.ao = [0.6, 0.8];
    return { radius: 1.6, colliders: rowColliders(-2.1, 2.1, 0.7, 0.5) };
  } };

  function slabShape(w, h, round) {
    var s = new T.Shape(), hw = w / 2;
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, h - (round ? hw : 0));
    if (round) s.absarc(0, h - hw, hw, 0, PI, false); else s.lineTo(-hw, h);
    s.lineTo(-hw, 0);
    return s;
  }
  function extrudeC(shape, depth, bev, curveSegs) {
    var g = new T.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: curveSegs || 10 });
    g.translate(0, 0, -depth / 2); g.deleteAttribute('uv'); g.computeVertexNormals();
    return g;
  }
  P.gravestone = { v: 6, build: function (B, r, o) {
    var c = C(o.color || pick(r, ['#8a8a90', '#7f7f88', '#93918c'])), tz = (r() - 0.5) * 0.25, tx = (r() - 0.5) * 0.15, cap = [MOSS, 0.55, 0.9, 0.7];
    B.add(bumpy(G.sph(0.5, 14, 8), 0.05, 3, r() * 9), '#5a4a3a', { p: [0, -0.06, 0.62], s: [0.8, 0.36, 1.25], tb: [0.6, 1.12], cap: ['#5f7a45', 0.55, 0.95, 0.8] });
    B.add(rbox(0.86, 0.14, 0.34, 0.04), sh(c, -0.12), { p: [0, 0.05, 0], tb: [0.6, 1.1], cap: cap });
    var kind = r();
    if (kind < 0.55) {
      B.add(extrudeC(slabShape(0.7, 1.0, true), 0.16, 0.03, 12), c, { p: [0, 0.08, 0], r: [tx, 0, tz], tb: [0.6, 1.12], cap: cap, cn: 0.12 });
      B.add(G.box(0.36, 0.04, 0.02), sh(c, -0.4), { p: [-tz * 0.5, 0.62, 0.1 + tx * 0.5], r: [tx, 0, tz] });
      B.add(G.box(0.26, 0.035, 0.02), sh(c, -0.4), { p: [-tz * 0.45, 0.52, 0.1 + tx * 0.45], r: [tx, 0, tz] });
      B.add(G.box(0.04, 0.2, 0.02), sh(c, -0.4), { p: [-tz * 0.75, 0.84, 0.1 + tx * 0.75], r: [tx, 0, tz] });
      B.add(G.box(0.14, 0.04, 0.02), sh(c, -0.4), { p: [-tz * 0.78, 0.88, 0.1 + tx * 0.78], r: [tx, 0, tz] });
    } else if (kind < 0.85) {
      var cr = new T.Shape(); cr.moveTo(-0.08, 0); cr.lineTo(0.08, 0); cr.lineTo(0.08, 0.72); cr.lineTo(0.3, 0.72); cr.lineTo(0.3, 0.88); cr.lineTo(0.08, 0.88); cr.lineTo(0.08, 1.15); cr.lineTo(-0.08, 1.15); cr.lineTo(-0.08, 0.88); cr.lineTo(-0.3, 0.88); cr.lineTo(-0.3, 0.72); cr.lineTo(-0.08, 0.72); cr.lineTo(-0.08, 0);
      B.add(extrudeC(cr, 0.12, 0.025, 2), c, { p: [0, 0.08, 0], r: [tx, 0, tz], tb: [0.6, 1.12], cap: cap, cn: 0.12 });
      B.add(G.tor(0.17, 0.035, 5, 14), sh(c, 0.04), { p: [-tz * 0.8, 0.88, tx * 0.8], r: [tx, 0, tz] });
    } else {
      B.add(extrudeC(slabShape(0.7, 0.62, false), 0.16, 0.03, 2), c, { p: [0, 0.08, 0], r: [tx, 0, tz + 0.08], tb: [0.6, 1.12], cap: cap });
      B.add(stoneGeo(0.22, 1, r() * 9, 3), c, { p: [0.45, 0.1, 0.4], tb: [0.6, 1.1], cap: cap });
      B.add(stoneGeo(0.15, 1, r() * 9, 3), sh(c, -0.05), { p: [-0.35, 0.08, 0.55], tb: [0.6, 1.1] });
    }
    for (var g = 0; g < 5; g++) B.add(G.cone(0.03, 0.18 + r() * 0.12, 3), '#5f8a3f', { p: [(r() - 0.5) * 0.8, 0.05, 0.2 + r() * 0.8], r: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6], noAO: true });
    if (r() < 0.45) B.glow(G.oct(0.06), '#7affb0', { p: [-tz * 0.4, 0.42, 0.12 + tx * 0.4], s: [1, 1.5, 0.3] });
    if (r() < 0.3) { B.add(G.cyl(0.04, 0.045, 0.16, 8), '#efe6d0', { p: [0.3, 0.2, 0.25] }); B.glow(G.sph(0.03, 6, 4), '#ffd27a', { p: [0.3, 0.31, 0.25], s: [1, 1.6, 1] }); }
    B.ao = [0.6, 0.5];
    return { radius: 0.35 };
  } };

  // hexagonal crystal with a pointed tip, base at y=0
  function crystalGeo(rad, h, tip) {
    var g1 = new T.CylinderGeometry(rad, rad * 0.85, h, 6, 1, false); g1.translate(0, h / 2, 0);
    var g2 = new T.ConeGeometry(rad, tip, 6, 1, true); g2.translate(0, h + tip / 2, 0);
    var B2 = new PB(); B2.ao = null; B2.cn = 0; B2.add(g1, '#ffffff'); B2.add(g2, '#ffffff');
    var g = B2.merge(B2.parts.s, false, true); g.deleteAttribute('color');
    return g;
  }
  P.crystal = { v: 4, build: function (B, r, o) {
    var c = C(o.color || '#8fe8ff');
    B.add(stoneGeo(0.6, 1, r() * 9, 3), '#5f5a6a', { p: [0, 0.1, 0], s: [1.15, 0.42, 1], tb: [0.6, 1.1] });
    var n = 4 + Math.floor(r() * 4);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU + r(), d = i ? 0.22 + r() * 0.2 : 0, s = i ? 0.5 + r() * 0.4 : 1.15;
      var tilt = i ? 0.35 + r() * 0.25 : 0.06;
      B.add(crystalGeo(0.17 * s, 0.85 * s, 0.38 * s), sh(c, (r() - 0.5) * 0.3), { p: [Math.cos(a) * d, 0.1, Math.sin(a) * d], r: [Math.sin(a) * tilt, r(), -Math.cos(a) * tilt], emis: true });
    }
    for (var k = 0; k < 4; k++) { var ka = r() * TAU; B.add(crystalGeo(0.05, 0.12, 0.08), sh(c, 0.1), { p: [Math.cos(ka) * 0.62, 0.0, Math.sin(ka) * 0.62], r: [Math.sin(ka) * 0.5, 0, -Math.cos(ka) * 0.5], emis: true }); }
    B.ao = [0.7, 0.3];
    return { radius: 0.6, jitter: true, emis: sh(c, -0.55), glowC: c };
  }, extra: function (grp, rng, o, info) {
    var h = halo(info.glowC, 2.4, 0.55); h.position.y = 0.8; grp.children[0].add(h);
    var ph = rng() * 10;
    grp.userData.anim = function (t) { var s = 2.4 * (1 + Math.sin(t * 2 + ph) * 0.12); h.scale.set(s, s, 1); };
  } };

  // reversed-winding copy (back faces of thin cloth)
  function flipGeo(g) { var I = g.index; if (I) { var a = I.array; for (var q = 0; q < a.length; q += 3) { var t = a[q + 1]; a[q + 1] = a[q + 2]; a[q + 2] = t; } } g.computeVertexNormals(); return g; }
  function barrel(B, x, y, z, s, col, rot) {
    B.add(latheS([[0, 0], [0.24, 0], [0.29, 0.15], [0.31, 0.32], [0.29, 0.5], [0.24, 0.64], [0, 0.64]], 14), col || '#8a5a32', { p: [x, y, z], s: s, r: rot || [0, 0, 0], cf: function (p) { var a = Math.atan2(p.z - z, p.x - x) * 14 / TAU; return 1 - 0.12 * (a - Math.floor(a) < 0.12 ? 1 : 0); }, tb: [0.7, 1.1] });
    [0.12, 0.52].forEach(function (h) { B.add(G.tor(0.3 - Math.abs(h - 0.32) * 0.3, 0.018, 4, 16), IRON, { p: [x, y + h * s, z], s: s, r: [PI / 2, 0, 0] }); });
  }
  function crate(B, x, y, z, s, col, ry) {
    var c = C(col || '#a0784a');
    B.add(rbox(0.5, 0.5, 0.5, 0.03), c, { p: [x, y + 0.25 * s, z], s: s, r: [0, ry || 0, 0], tb: [0.7, 1.1], cf: grain('y', 30, 0.08) });
    [-1, 1].forEach(function (k) {
      B.add(G.box(0.52, 0.07, 0.52), sh(c, -0.2), { p: [x, y + (0.25 + k * 0.2) * s, z], s: s, r: [0, ry || 0, 0] });
    });
    B.add(G.box(0.07, 0.6, 0.52), sh(c, -0.2), { p: [x, y + 0.25 * s, z], s: s, r: [0, ry || 0, 0.78] });
  }
  P.stall = { v: 4, build: function (B, r, o) {
    var wood = C('#8a6440'), light = C('#c49a68'), stripe = C(o.color || pick(r, ['#d9534f', '#4f8fd9', '#5aa860', '#9a5ad9'])), cream = C('#f5ecd7');
    [[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]].forEach(function (p, i) {
      var hh = i < 2 ? 2.75 : 2.35;
      B.add(latheS([[0.08, 0], [0.1, 0.05], [0.07, 0.12], [0.065, hh - 0.15], [0.085, hh - 0.08], [0.06, hh], [0, hh]], 8), wood, { p: [p[0], 0, p[1]], tb: [0.7, 1.08], cf: grain('y', 14, 0.08) });
    });
    // counter of planks + top board + skirt cloth
    for (var pl = 0; pl < 5; pl++) B.add(rbox(2.6, 0.18, 0.06, 0.02), sh(wood, (r() - 0.5) * 0.15), { p: [0, 0.12 + pl * 0.18, 0.58], cf: grain('x', 9, 0.12), tb: [0.7, 1.08] });
    B.add(G.box(2.55, 0.9, 1.0), sh(wood, -0.25), { p: [0, 0.47, 0.05] });
    B.add(rbox(2.85, 0.1, 1.32, 0.03), light, { p: [0, 1.0, 0.1], cf: grain('x', 11, 0.1), tb: [0.7, 1.1] });
    for (var sk = 0; sk < 9; sk++) B.add(G.sph(0.17, 8, 4, 0), sk % 2 ? cream : stripe, { p: [-1.2 + sk * 0.3, 0.88, 0.78], s: [1, 0.45, 0.3], tb: [0.7, 1.1] });
    // billowing striped awning with a scalloped valance
    var nS = 8, AW = 2.9;
    for (var i = 0; i < nS; i++) {
      var x = -AW / 2 + (i + 0.5) * AW / nS, col = i % 2 ? cream : stripe;
      for (var sgi = 0; sgi < 4; sgi++) {
        var t0 = sgi / 4, t1 = (sgi + 1) / 4;
        function yz(t) { return [2.78 - t * 0.62 + Math.sin(t * PI) * 0.1, -0.72 + t * 1.68]; }
        var A = yz(t0), Bq = yz(t1), ang = Math.atan2(A[0] - Bq[0], Bq[1] - A[1]), len = Math.hypot(Bq[1] - A[1], Bq[0] - A[0]);
        B.add(G.box(AW / nS * 1.01, 0.05, len * 1.04), col, { p: [x, (A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2], r: [ang, 0, 0], tb: [0.55, 1.12], cn: 0.05 });
      }
      B.add(G.hemi(AW / nS / 2, 10, 3), col, { p: [x, 2.18, 0.96], r: [PI, 0, 0], s: [1, 0.9, 0.35], tb: [0.6, 1.1] });
    }
    B.add(G.cyl(0.035, 0.035, AW + 0.1, 8), wood, { p: [0, 2.2, 0.96], r: [0, 0, PI / 2] });
    // goods: potion bottles (glowing), apples in a basket, crates, barrel, sacks
    var cols = ['#ff5a6e', '#5ab8ff', '#9dff5a', '#ffd23a', '#c78bff'];
    for (var j = 0; j < 5; j++) {
      var bx = -1.05 + j * 0.24;
      B.add(latheS([[0, 0], [0.08, 0], [0.09, 0.08], [0.06, 0.16], [0.03, 0.2], [0.03, 0.26], [0, 0.26]], 8), '#d8eef0', { p: [bx, 1.05, 0.25], tb: [0.8, 1.1], cn: 0 });
      B.glow(G.sph(0.075, 8, 6), cols[j], { p: [bx, 1.13, 0.25] });
      B.add(G.cyl(0.028, 0.028, 0.05, 6), '#a07040', { p: [bx, 1.33, 0.25] });
    }
    B.add(latheS([[0, 0], [0.26, 0], [0.33, 0.18], [0.32, 0.2], [0, 0.04]], 12), '#b08048', { p: [0.65, 1.05, 0.2], cf: grain('y', 60, 0.15), tb: [0.7, 1.1] });
    for (var k = 0; k < 9; k++) B.add(G.sph(0.08, 8, 6), k % 3 ? '#e0402e' : '#9acd32', { p: [0.48 + (k % 3) * 0.13, 1.25 + Math.floor(k / 3) * 0.05, 0.1 + Math.floor(k / 3) * 0.1], tb: [0.65, 1.2], cn: 0 });
    crate(B, 1.7, 0, 0.45, 1, '#b08a58', 0.3); crate(B, 1.72, 0.5, 0.42, 0.85, '#9a7448', -0.25);
    barrel(B, -1.75, 0, 0.5, 1, '#8a5a32');
    B.add(bumpy(G.sph(0.25, 10, 8), 0.05, 3, 4), '#c9b48a', { p: [-1.75, 0.82, 0.55], s: [1, 0.8, 1], tb: [0.7, 1.1] });
    B.add(bumpy(G.sph(0.25, 10, 8), 0.05, 3, 5), '#bfa878', { p: [1.0, 0.22, 1.05], s: [1, 0.85, 1], tb: [0.7, 1.1] });
    // hanging sign board
    B.add(rbox(0.7, 0.32, 0.05, 0.02), light, { p: [0, 2.0, 1.05], cf: grain('x', 20, 0.1) });
    B.glow(G.sph(0.06, 6, 4), '#ffd76a', { p: [0, 2.0, 1.08], s: [1, 1, 0.3] });
    B.ao = [0.65, 0.8];
    return { radius: 1.5, colliders: [{ x: -0.75, z: 0.05, r: 0.85 }, { x: 0.75, z: 0.05, r: 0.85 }] };
  } };

  P.well = { v: 2, build: function (B, r, o) {
    var stone = C(pick(r, STONE)), wood = C(WOOD), roof = C(o.color || pick(r, ['#a0503a', '#5a7fc0']));
    // two courses of curved stone blocks + a cap ring
    for (var ly = 0; ly < 3; ly++) {
      var n = 12, R = 0.96;
      for (var i = 0; i < n; i++) {
        var a = (i + (ly % 2) * 0.5) / n * TAU;
        B.add(rbox(0.5, ly === 2 ? 0.2 : 0.3, 0.3, 0.06), sh(stone, (r() - 0.5) * 0.2), { p: [Math.cos(a) * R, (ly === 2 ? 0.75 : 0.15 + ly * 0.3), Math.sin(a) * R], r: [0, -a + PI / 2, 0], tb: [0.65, 1.1], cn: 0.1 });
      }
    }
    B.add(G.cyl(0.82, 0.82, 0.04, 20), '#2a4f6a', { p: [0, 0.42, 0], noAO: true });
    B.add(G.cyl(0.86, 0.86, 0.6, 20, true), '#3a3632', { p: [0, 0.55, 0], s: [1, 1, 1], noAO: true });
    // posts, crossbeam, gabled shingle roof
    [-1, 1].forEach(function (sx) {
      B.add(rbox(0.16, 2.2, 0.16, 0.03), wood, { p: [sx * 1.0, 1.1, 0], cf: grain('y', 16, 0.12), tb: [0.7, 1.08] });
      B.add(rbox(0.12, 0.6, 0.12, 0.02), wood, { p: [sx * 0.82, 1.86, 0], r: [0, 0, sx * 0.7] });
    });
    shingleRoof(B, r, 2.6, 0.95, 0.75, 2.25, roof, { rows: 4, tile: 0.32, pow: 1.1 });
    [-1, 1].forEach(function (sx) {
      var ang = Math.atan2(0.75, 0.95), sl = Math.hypot(0.75, 0.95);
      [-1, 1].forEach(function (sz) { B.add(rbox(0.08, 0.14, sl * 1.05, 0.02), sh(roof, -0.35), { p: [sx * 1.3, 2.1 + 0.37, sz * 0.47], r: [sz * ang, 0, 0] }); });
    });
    // crank, rope and bucket
    B.add(G.cyl(0.06, 0.06, 2.0, 8), sh(wood, 0.05), { p: [0, 1.7, 0], r: [0, 0, PI / 2] });
    B.add(G.tor(0.09, 0.03, 4, 10), '#c9b48a', { p: [0, 1.7, 0], r: [0, PI / 2, 0], s: [1, 1, 3] });
    B.add(G.box(0.05, 0.32, 0.05), wood, { p: [1.08, 1.56, 0.0] });
    B.add(G.cyl(0.03, 0.03, 0.2, 6), wood, { p: [1.14, 1.42, 0], r: [0, 0, PI / 2] });
    B.add(G.cyl(0.012, 0.012, 0.55, 4), '#c9b48a', { p: [0, 1.4, 0] });
    B.add(latheS([[0, 0], [0.13, 0], [0.16, 0.22], [0, 0.22]], 10), '#8a6038', { p: [0, 0.95, 0], tb: [0.7, 1.1], cf: grain('y', 50, 0.1) });
    B.add(G.tor(0.15, 0.012, 3, 12), IRON, { p: [0, 1.12, 0], r: [PI / 2, 0, 0] });
    B.add(G.tor(0.15, 0.01, 3, 12, PI), IRON, { p: [0, 1.17, 0], r: [0, 0, 0] });
    for (var f = 0; f < 6; f++) { var fa = r() * TAU; B.add(G.cone(0.035, 0.2 + r() * 0.12, 3), '#5f9a3f', { p: [Math.cos(fa) * 1.18, 0.08, Math.sin(fa) * 1.18], r: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6], noAO: true }); }
    B.ao = [0.62, 0.6];
    return { radius: 1.15 };
  } };

  // teardrop flame (lathe), base at y=0
  function flameGeo(rad, h, segs, c0, c1, lobes) {
    var g = G.lathe([[0, 0], [rad * 0.7, h * 0.08], [rad, h * 0.25], [rad * 0.8, h * 0.5], [rad * 0.35, h * 0.8], [0, h]], segs || 10);
    var P = g.attributes.position, col = new Float32Array(P.count * 3), A = C(c0 || '#ffd23a'), Bc = C(c1 || '#ff3a0a'), k = new T.Color();
    for (var i = 0; i < P.count; i++) {
      var x = P.getX(i), y = P.getY(i), z = P.getZ(i), t = y / h, a = Math.atan2(z, x) + t * 2.2;
      var m = 1 + (lobes ? 0.35 * Math.cos(a * lobes) * t : 0);
      P.setXYZ(i, x * m, y, z * m);
      k.copy(A).lerp(Bc, smooth(0.15, 0.95, t)); col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.deleteAttribute('uv'); g.computeVertexNormals();
    return g;
  }
  P.campfire = { v: 2, build: function (B, r, o) {
    for (var i = 0; i < 9; i++) { var a = i * TAU / 9 + r() * 0.2; B.add(stoneGeo(0.15 + r() * 0.06, 1, r() * 30, 3), pick(r, ['#8a8f96', '#7d8288', '#8c8680']), { p: [Math.cos(a) * 0.58, 0.07, Math.sin(a) * 0.58], s: [1, 0.8, 1], tb: [0.6, 1.1], cn: 0.1 }); }
    B.add(bumpy(G.sph(0.48, 14, 6), 0.04, 4, 3), '#3a302a', { p: [0, 0, 0], s: [1, 0.12, 1], noAO: true });
    for (var j = 0; j < 4; j++) {
      var b = j * TAU / 4 + 0.3, dx = Math.cos(b), dz = Math.sin(b);
      B.add(barkTube([[dx * 0.5, 0.04, dz * 0.5], [dx * 0.12, 0.28, dz * 0.12]], 0.075, 0.06, { ts: 3, rs: 7, grooves: 4, grooveAmp: 0.1 }), '#6b4a2a', { tb: [0.6, 1.05], cf: function (p) { return 0.45 + 0.55 * smooth(0.12, 0.4, Math.hypot(p.x, p.z)); } });
      B.add(G.cyl(0.075, 0.075, 0.01, 8), '#c9a06a', { p: [dx * 0.505, 0.04, dz * 0.505], dir: [dx, -0.5, dz] });
    }
    for (var e = 0; e < 7; e++) { var ea = r() * TAU, ed = r() * 0.3; B.glow(G.sph(0.035, 5, 4), pick(r, ['#ff6a1a', '#ffae2a', '#ff3a0a']), { p: [Math.cos(ea) * ed, 0.04, Math.sin(ea) * ed] }); }
    B.ao = null;
    return { radius: 0.65 };
  }, extra: function (grp, rng, o) {
    var g = grp.children[0];
    var fl = function (key, make) { var gg = SG('flame_' + key, make); return new T.Mesh(gg, vcGlowMat()); };
    var f1 = fl('a', function () { return flameGeo(0.32, 1.0, 12, '#ff9a2a', '#e8340c', 3); }); f1.position.y = 0.08;
    var f2 = fl('b', function () { return flameGeo(0.21, 0.78, 10, '#ffe066', '#ff7a1a', 2); }); f2.position.y = 0.1;
    var f3 = fl('c', function () { return flameGeo(0.1, 0.46, 8, '#fffbe0', '#ffd23a'); }); f3.position.y = 0.1;
    var f4 = fl('d', function () {
      var sf = new PB(); sf.ao = null; sf.cn = 0; sf.paintOff = true;
      sf.add(flameGeo(0.12, 0.52, 7, '#ffb03a', '#ff4a10'), '#ffffff', { p: [0.15, 0, 0.06], r: [0, 0, -0.25] });
      sf.add(flameGeo(0.11, 0.44, 7, '#ffb03a', '#ff4a10'), '#ffffff', { p: [-0.13, 0, -0.08], r: [0.15, 0, 0.25] });
      sf.add(flameGeo(0.09, 0.36, 7, '#ffb03a', '#ff4a10'), '#ffffff', { p: [0.02, 0, -0.17], r: [0.3, 0, 0] });
      return sf.merge(sf.parts.s, false);
    }); f4.position.y = 0.08;
    [f1, f2, f3, f4].forEach(function (f) { f.userData.noMeasure = true; g.add(f); });
    var h = halo('#ff9a3a', 2.8, 0.8); h.position.y = 0.6; g.add(h);
    var ph = rng() * 10;
    grp.userData.anim = function (t) {
      f1.scale.set(1 + Math.sin(t * 11 + ph) * 0.08, 1 + Math.sin(t * 7 + ph) * 0.15, 1 + Math.cos(t * 9) * 0.08);
      f2.scale.set(1, 1 + Math.sin(t * 13 + 1 + ph) * 0.18, 1); f2.rotation.y = t * 2;
      f3.scale.set(1, 1 + Math.sin(t * 17 + ph) * 0.2, 1);
      f4.scale.set(1, 1 + Math.sin(t * 15 + 2 + ph) * 0.25, 1); f4.rotation.y = Math.sin(t * 3 + ph) * 0.5;
      f1.rotation.z = Math.sin(t * 5) * 0.06;
      var s = 2.8 * (1 + Math.sin(t * 9 + ph) * 0.06 + Math.sin(t * 23) * 0.03); h.scale.set(s, s, 1);
    };
  } };

  P.tent = { v: 3, build: function (B, r, o) {
    var cv = C(o.color || pick(r, ['#d8c9a0', '#c9b48a', '#b8c4a8'])), wood = C(WOOD);
    var L = 2.3, hw = 1.25, H = 1.95, panels = 4;
    // stitched canvas panels on both slopes, sagging between the poles
    [-1, 1].forEach(function (side) {
      for (var p = 0; p < panels; p++) {
        var z0 = -L / 2 + p * L / panels, pw = L / panels;
        var g = new T.PlaneGeometry(pw, Math.hypot(hw, H), 3, 5), P2 = g.attributes.position;
        for (var i = 0; i < P2.count; i++) { var u = (P2.getX(i) / pw + 0.5), v = (P2.getY(i) / Math.hypot(hw, H) + 0.5); P2.setZ(i, -Math.sin(u * PI) * Math.sin(v * PI) * 0.06 * (p % 2 ? 1 : 0.6)); }
        g.computeVertexNormals();
        var ang = Math.atan2(H, hw);
        var m = new T.Matrix4().compose(new T.Vector3(side * hw / 2, H / 2, z0 + pw / 2), new T.Quaternion().setFromEuler(new T.Euler(0, side * PI / 2, 0)).multiply(new T.Quaternion().setFromEuler(new T.Euler(-(PI / 2 - ang), 0, 0))), new T.Vector3(1, 1, 1));
        B.add(g, sh(cv, (p % 2 ? 0.05 : -0.04) + (hash3(p, side, 3) - 0.5) * 0.06), { matrix: m, tb: [0.6, 1.1], cn: 0.05 });
        var gb = g.clone(); var ib = gb.index.array; for (var q = 0; q < ib.length; q += 3) { var tmp = ib[q + 1]; ib[q + 1] = ib[q + 2]; ib[q + 2] = tmp; } gb.computeVertexNormals();
        B.add(gb, sh(cv, -0.35), { matrix: m, noAO: true, cn: 0 });
        if (p) B.add(G.box(0.025, Math.hypot(hw, H) * 0.98, 0.02), sh(cv, -0.3), { matrix: m.clone().multiply(new T.Matrix4().makeTranslation(-pw / 2, 0, 0.012)), noAO: true });
      }
    });
    // back wall + open front flaps + dark interior
    var tri = new T.Shape(); tri.moveTo(-hw, 0); tri.lineTo(hw, 0); tri.lineTo(0, H); tri.lineTo(-hw, 0);
    B.add(new T.ShapeGeometry(tri), sh(cv, -0.1), { p: [0, 0, -L / 2], r: [0, PI, 0], tb: [0.6, 1.0] });
    B.add(new T.ShapeGeometry(tri), '#2a2018', { p: [0, 0, -L / 2 + 0.02], noAO: true, cn: 0 });
    var door = new T.Shape(); door.moveTo(-0.55, 0); door.lineTo(0.55, 0); door.lineTo(0, 1.35); door.lineTo(-0.55, 0);
    B.add(new T.ShapeGeometry(door), '#1e1610', { p: [0, 0.01, L / 2 - 0.3], noAO: true, cn: 0 });
    [-1, 1].forEach(function (sx) {
      var fw = new T.Shape(); fw.moveTo(sx * hw, 0); fw.lineTo(sx * 0.55, 0); fw.lineTo(0, 1.35); fw.lineTo(0, H); fw.lineTo(sx * hw, 0);
      var gF = new T.ShapeGeometry(fw);
      B.add(gF, sh(cv, 0.04), { p: [0, 0, L / 2], tb: [0.65, 1.05] });
      var gB = flipGeo(new T.ShapeGeometry(fw));
      B.add(gB, sh(cv, -0.35), { p: [0, 0, L / 2 - 0.01], noAO: true, cn: 0 });
      // rolled-up door flap + tie
      B.add(G.cyl(0.07, 0.06, 1.25, 8), sh(cv, 0.08), { p: [sx * 0.3, 0.68, L / 2 + 0.05], r: [0, 0, sx * 0.39], tb: [0.65, 1.08] });
      B.add(G.tor(0.075, 0.018, 4, 8), '#8a6a3a', { p: [sx * 0.3, 0.68, L / 2 + 0.05], r: [PI / 2, 0, sx * 0.39] });
    });
    // patch, poles, ridge rope, guy lines and pegs
    B.add(G.box(0.4, 0.35, 0.01), sh(cv, -0.15).lerp(C('#8a6a4a'), 0.3), { p: [0.55, 0.85, -0.3], r: [0, PI / 2, -(PI / 2 - Math.atan2(H, hw))], noAO: true });
    B.add(G.cyl(0.04, 0.045, 2.35, 6), wood, { p: [0, 1.1, L / 2 + 0.06], cf: grain('y', 20, 0.1) });
    B.add(G.cyl(0.04, 0.045, 2.35, 6), wood, { p: [0, 1.1, -L / 2 - 0.04] });
    B.add(G.sph(0.06, 6, 4), wood, { p: [0, 2.3, L / 2 + 0.06] });
    B.add(G.cyl(0.03, 0.03, L + 0.2, 6), sh(cv, -0.3), { p: [0, H + 0.01, 0], r: [PI / 2, 0, 0] });
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (s) {
      B.add(G.cyl(0.01, 0.01, 1.05, 3), '#c9b48a', { p: [s[0] * 1.48, 0.42, s[1] * 0.95], r: [0, 0, s[0] * 1.0] });
      B.add(G.cone(0.03, 0.28, 4), wood, { p: [s[0] * 1.86, 0.05, s[1] * 0.95], r: [PI, 0, 0] });
    });
    B.ao = [0.65, 0.7];
    return { radius: 1.5, colliders: [{ x: 0, z: -0.55, r: 1.2 }, { x: 0, z: 0.55, r: 1.2 }] };
  } };

  P.statue = { v: 1, build: function (B, r, o) {
    var stone = C('#bdb6a6'), marble = C(o.color || '#e6e2d8'), gold = C(GOLD), cap = [MOSS, 0.62, 0.95, 0.7];
    B.add(rbox(1.9, 0.5, 1.9, 0.06), sh(stone, -0.1), { p: [0, 0.25, 0], tb: [0.65, 1.1], cap: cap });
    B.add(latheS([[0.95, 0], [0.92, 0.06], [0.78, 0.12], [0.75, 0.16], [0, 0.16]], 4), stone, { p: [0, 0.5, 0], r: [0, PI / 4, 0], flat: true });
    B.add(rbox(1.4, 1.0, 1.4, 0.05), stone, { p: [0, 1.15, 0], tb: [0.65, 1.1], cf: courses(0.5, 0.05) });
    B.add(latheS([[0.75, 0], [0.82, 0.06], [0.95, 0.14], [0.98, 0.22], [0, 0.22]], 4), stone, { p: [0, 1.62, 0], r: [0, PI / 4, 0], flat: true, tb: [0.65, 1.1] });
    B.add(rbox(0.72, 0.34, 0.05, 0.02), gold, { p: [0, 1.15, 0.72], tb: [0.6, 1.25] });
    B.add(G.box(0.5, 0.03, 0.02), sh(gold, -0.4), { p: [0, 1.2, 0.75] }); B.add(G.box(0.4, 0.03, 0.02), sh(gold, -0.4), { p: [0, 1.1, 0.75] });
    var s = 1.3, y0 = 1.84;
    // robe with folds (lathe + radial ripples), sleeves, head, beard, floppy hat
    var robe = G.lathe([[0, 0], [0.58, 0], [0.62, 0.07], [0.52, 0.36], [0.4, 0.72], [0.32, 0.97], [0.2, 1.09], [0, 1.13]].map(function (p) { return p; }), 28), RP = robe.attributes.position;
    for (var i = 0; i < RP.count; i++) { var x = RP.getX(i), z = RP.getZ(i), y = RP.getY(i), a = Math.atan2(z, x), k = 1 + 0.06 * Math.sin(a * 9) * (1 - y / 1.13); RP.setXYZ(i, x * k, y, z * k); }
    robe.computeVertexNormals();
    B.add(robe, marble, { p: [0, y0, 0], s: s, tb: [0.65, 1.12] });
    B.add(G.tor(0.36, 0.05, 6, 18), sh(marble, -0.05), { p: [0, y0 + 0.62 * s, 0], r: [PI / 2, 0, 0], s: s });
    B.add(G.sph(0.31, 18, 14), marble, { p: [0, y0 + 1.27 * s, 0], s: s, tb: [0.65, 1.12] });
    B.add(G.sph(0.06, 8, 6), marble, { p: [0, y0 + 1.25 * s, 0.31 * s] });
    B.add(G.cone(0.24, 0.62, 12), marble, { p: [0, y0 + 0.86 * s, 0.17 * s], r: [PI - 0.25, 0, 0], s: s, tb: [0.65, 1.1] });
    B.add(G.cyl(0.6, 0.62, 0.05, 24), marble, { p: [0, y0 + 1.45 * s, -0.02], s: s });
    B.add(G.hat(0.36, 0.9, 0.42, 18), marble, { p: [0, y0 + 1.46 * s, -0.02], s: s, tb: [0.65, 1.12] });
    B.add(G.tor(0.36, 0.04, 5, 18), sh(marble, -0.08), { p: [0, y0 + 1.5 * s, -0.02], r: [PI / 2, 0, 0], s: s });
    var sh0 = [-0.36 * s, y0 + 1.0 * s, 0], dir = [-0.35, 0.9, 0.15];
    var dl = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    var hand = [sh0[0] + dir[0] / dl * 0.65 * s, sh0[1] + dir[1] / dl * 0.65 * s, sh0[2] + dir[2] / dl * 0.65 * s];
    B.add(G.cyl(0.1, 0.18, 0.62, 12, true), marble, { p: [(sh0[0] + hand[0]) / 2, (sh0[1] + hand[1]) / 2, (sh0[2] + hand[2]) / 2], dir: [-dir[0], -dir[1], -dir[2]], s: s, tb: [0.65, 1.1] });
    B.add(G.sph(0.1, 10, 8), marble, { p: hand, s: s });
    B.add(latheS([[0.05, 0], [0.06, 1.2], [0.07, 2.2], [0.1, 2.45], [0.06, 2.6], [0, 2.6]], 8), marble, { p: [hand[0], hand[1] - 1.05, hand[2]], tb: [0.65, 1.1] });
    B.add(G.tor(0.13, 0.025, 4, 12), gold, { p: [hand[0], hand[1] + 1.67, hand[2]] });
    B.add(G.cyl(0.1, 0.18, 0.62, 12, true), marble, { p: [0.42 * s, y0 + 0.72 * s, 0.05], r: [0, 0, 0.25], s: s, tb: [0.65, 1.1] });
    B.add(G.sph(0.1, 10, 8), marble, { p: [0.5 * s, y0 + 0.42 * s, 0.07] });
    // weathering: cracks + moss at the foot
    for (var k = 0; k < 3; k++) B.add(G.box(0.02, 0.25, 0.02), sh(marble, -0.45), { p: [(r() - 0.5) * 0.5, y0 + (0.2 + r() * 0.5) * s, 0.42], r: [0, 0, (r() - 0.5)], noAO: true, cn: 0 });
    for (var m = 0; m < 6; m++) { var ma = r() * TAU; B.add(clump(0.18 + r() * 0.1, 1, r() * 9, 0.3), MOSS, { p: [Math.cos(ma) * 0.95, 0.5, Math.sin(ma) * 0.95], s: [1.2, 0.4, 1.2], tb: [0.6, 1.1] }); }
    B.glow(G.oct(0.16), gold, { p: [hand[0], hand[1] + 1.67, hand[2]], s: [1, 1.4, 1] });
    B.ao = [0.65, 1.0];
    return { radius: 1.05, gem: [hand[0], hand[1] + 1.67, hand[2]] };
  }, extra: function (grp, rng, o, info) {
    var h = halo('#ffd76a', 1.4, 0.85); h.position.set(info.gem[0], info.gem[1], info.gem[2]); grp.children[0].add(h);
    grp.userData.anim = function (t) { var s = 1.4 * (1 + Math.sin(t * 2.4) * 0.1); h.scale.set(s, s, 1); };
  } };

  function boneGeo(len, rad) { return G.lathe([[0, 0], [rad * 1.9, 0.0], [rad * 2.1, len * 0.06], [rad * 1.2, len * 0.14], [rad, len * 0.3], [rad, len * 0.7], [rad * 1.2, len * 0.86], [rad * 2.1, len * 0.94], [rad * 1.9, len], [0, len]], 7); }
  P.bones = { v: 4, build: function (B, r, o) {
    var bone = C(o.color || '#e8e0c8'), dark = '#1a1218', ry = r() * 0.6 - 0.3;
    // skull: cranium, brow, cheekbones, eye sockets, nose, jaw with teeth
    B.add(G.sph(0.17, 14, 10), bone, { p: [0, 0.16, 0], r: [0.25, ry, 0.15], s: [1, 0.95, 1.12], tb: [0.65, 1.12] });
    B.add(G.sph(0.1, 10, 6), bone, { p: [0, 0.08, 0.1], s: [1.2, 0.8, 1], tb: [0.65, 1.1] });
    [-1, 1].forEach(function (sx) {
      B.add(G.sph(0.045, 8, 6), dark, { p: [sx * 0.06, 0.16, 0.15], s: [1, 1.1, 0.6], noAO: true, cn: 0 });
      B.add(G.sph(0.03, 6, 4), bone, { p: [sx * 0.1, 0.1, 0.12] });
    });
    B.add(G.cone(0.02, 0.04, 3), dark, { p: [0, 0.1, 0.18], r: [PI, 0, 0], noAO: true });
    B.add(G.box(0.13, 0.04, 0.09), bone, { p: [0, 0.025, 0.13], tb: [0.65, 1.1] });
    for (var t = 0; t < 5; t++) B.add(G.box(0.018, 0.025, 0.012), '#f4ecd8', { p: [-0.04 + t * 0.02, 0.055, 0.175] });
    // scattered long bones with knobbly ends
    for (var i = 0; i < 4; i++) {
      var a = r() * TAU, d = 0.32 + r() * 0.4, x = Math.cos(a) * d, z = Math.sin(a) * d, ryy = r() * PI, l = 0.35 + r() * 0.25;
      B.add(boneGeo(l, 0.025), sh(bone, (r() - 0.5) * 0.08), { p: [x - Math.cos(ryy) * l / 2, 0.045, z + Math.sin(ryy) * l / 2], r: [0, ryy, -PI / 2], order: 'YXZ', tb: [0.65, 1.12] });
    }
    // rib cage
    for (var k = 0; k < 4; k++) B.add(G.tor(0.18 - k * 0.022, 0.018, 4, 12, PI * 0.9), sh(bone, -0.04), { p: [-0.45, 0.02, -0.22 + k * 0.1], r: [0, PI / 2, 0], tb: [0.65, 1.1] });
    B.add(G.cyl(0.022, 0.022, 0.42, 6), bone, { p: [-0.45, 0.025, -0.08], r: [PI / 2, 0, 0] });
    for (var g = 0; g < 4; g++) B.add(G.cone(0.03, 0.16 + r() * 0.1, 3), '#6a7a4a', { p: [(r() - 0.5) * 0.9, 0.06, (r() - 0.5) * 0.9], r: [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5], noAO: true });
    B.ao = [0.7, 0.2];
    return { radius: 0, jitter: true };
  } };

  P.thornvine = { v: 4, build: function (B, r, o) {
    var c = C(o.color || '#3f2a4a'), thorn = sh(c, -0.35), leafC = sh(c, 0.15).lerp(C('#4a6a3a'), 0.4);
    for (var v = 0; v < 5; v++) {
      var sx = (r() - 0.5) * 1.2, sz = (r() - 0.5) * 1.2, a0 = r() * TAU, len = 1.1 + r() * 0.6, pts = [];
      var dx = Math.cos(a0), dz = Math.sin(a0), bend = (r() - 0.5) * 1.2;
      for (var i = 0; i < 7; i++) {
        var u = i / 6 - 0.5;
        pts.push([sx + dx * u * len - dz * bend * u * u, Math.max(0.03, Math.sin((u + 0.5) * TAU * 1.0 + v) * 0.24 + 0.17), sz + dz * u * len + dx * bend * u * u]);
      }
      B.add(barkTube(pts, 0.075, 0.025, { ts: 18, rs: 6, grooves: 3, grooveAmp: 0.15, seed: v }), v % 2 ? c : sh(c, 0.12), { tb: [0.6, 1.15] });
      var curve = new T.CatmullRomCurve3(pts.map(V3)), P0 = new T.Vector3(), Tn = new T.Vector3();
      for (var k = 1; k < 10; k++) {
        curve.getPointAt(k / 10, P0); curve.getTangentAt(k / 10, Tn);
        var side = new T.Vector3(0, 1, 0).cross(Tn).normalize().multiplyScalar(k % 2 ? 1 : -1).add(new T.Vector3(0, 0.7, 0));
        B.add(G.cone(0.028, 0.15, 5), thorn, { p: [P0.x, P0.y, P0.z], dir: [side.x, side.y, side.z], tb: [0.7, 1.2] });
        if (k % 3 === 0) B.add(G.sph(0.07, 5, 3), sh(leafC, (r() - 0.5) * 0.2), { p: [P0.x - side.x * 0.06, P0.y + 0.04, P0.z - side.z * 0.06], s: [1.4, 0.3, 0.7], r: [0, r() * 3, 0.3], tb: [0.6, 1.1] });
      }
      if (r() < 0.45) { B.glow(G.sph(0.055, 8, 6), HOLLOW_GREEN, { p: pts[3] }); B.add(G.cone(0.04, 0.08, 5), thorn, { p: [pts[3][0], pts[3][1] - 0.07, pts[3][2]], r: [PI, 0, 0] }); }
    }
    B.ao = [0.6, 0.35];
    return { radius: 0.7, jitter: true };
  } };

  P.log = { v: 3, build: function (B, r, o) {
    var bark = C(o.color || '#6b4a2e'), ring = C('#c9a06a'), seed = r() * 9;
    B.add(barkTube([[-1.5, 0.44, 0], [-0.5, 0.45, 0.02], [0.5, 0.43, -0.02], [1.5, 0.44, 0]], 0.48, 0.42, { ts: 10, rs: 14, grooves: 9, grooveAmp: 0.08, grooveDark: 0.35, seed: seed, wobble: 0.08 }), bark, { tb: [0.65, 1.08] });
    // end grain: concentric rings
    var rings = function (p) { var d = Math.hypot(p.y - 0.44, p.z) * 22; return 0.85 + 0.15 * Math.sin(d + Math.sin(Math.atan2(p.z, p.y - 0.44) * 3) * 0.6); };
    B.add(G.cyl(0.4, 0.4, 0.04, 16), ring, { p: [1.51, 0.44, 0], r: [0, 0, PI / 2], cf: rings, tb: [0.85, 1.05], noAO: true });
    B.add(G.cyl(0.45, 0.45, 0.04, 16), ring, { p: [-1.51, 0.44, 0], r: [0, 0, PI / 2], cf: rings, tb: [0.85, 1.05], noAO: true });
    // moss blanket on top, branch stub, shelf fungus, mushrooms
    B.add(clump(0.5, 2, seed, 0.3), MOSS, { p: [0.2, 0.84, 0], s: [1.9, 0.28, 0.8], tb: [0.62, 1.0], cn: 0.1 });
    B.add(barkTube([[-0.5, 0.75, 0.15], [-0.6, 1.05, 0.32]], 0.1, 0.07, { ts: 2, rs: 7 }), bark, { tb: [0.65, 1.05] });
    B.add(G.cyl(0.07, 0.07, 0.02, 8), ring, { p: [-0.6, 1.05, 0.32], dir: [-0.3, 0.9, 0.5] });
    for (var f = 0; f < 3; f++) B.add(G.hemi(0.16 - f * 0.03, 10, 3), sh(C('#c9a06a'), f * 0.06), { p: [-1.0 + f * 0.16, 0.5 + f * 0.12, -0.44], r: [-PI / 2 + 0.2, 0, 0], s: [1, 0.35, 0.8], tb: [0.6, 1.15] });
    for (var i = 0; i < 3; i++) mushroomOne(B, 0.6 + i * 0.22, 0.5 + (i % 2) * 0.06, 0.32, C('#d9822a'), r, 0.1);
    B.ao = [0.62, 0.5];
    return { radius: 0.9, colliders: [{ x: -1.0, z: 0, r: 0.5 }, { x: 0, z: 0, r: 0.5 }, { x: 1.0, z: 0, r: 0.5 }] };
  } };

  // arrow board, bevelled; front face at z = 0.155, back face at z = 0.08 (labels sit just outside)
  function arrowShape(len) {
    var s = new T.Shape();
    s.moveTo(0, -0.16); s.lineTo(len - 0.25, -0.16); s.lineTo(len, 0); s.lineTo(len - 0.25, 0.16); s.lineTo(0, 0.16); s.lineTo(0, -0.16);
    var g = new T.ExtrudeGeometry(s, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1 });
    g.translate(0, 0, 0.01); g.deleteAttribute('uv'); g.computeVertexNormals();
    return g;
  }
  P.signpost = { v: 1, build: function (B, r, o) {
    var wood = C('#8a6440'), board = C('#c49a68');
    B.add(rbox(0.17, 2.4, 0.17, 0.035), wood, { p: [0, 1.15, 0], tb: [0.7, 1.08], cf: grain('y', 18, 0.15) });
    B.add(G.cone(0.14, 0.18, 4), wood, { p: [0, 2.44, 0], r: [0, PI / 4, 0], flat: true, tb: [0.7, 1.1] });
    B.add(arrowShape(1.35), board, { p: [0.05, 1.95, 0.08], tb: [0.75, 1.08], cf: grain('y', 40, 0.08) });
    B.add(arrowShape(1.15), sh(board, -0.08), { p: [-0.05, 1.5, 0.08], r: [0, PI + 0.35, 0], tb: [0.75, 1.08], cf: grain('y', 40, 0.08) });
    [[0.12, 1.95], [-0.12, 1.5]].forEach(function (n) { B.add(G.sph(0.022, 5, 4), '#3a3640', { p: [n[0], n[1], n[0] > 0 ? 0.16 : 0.0] }); });
    B.add(stoneGeo(0.25, 1, 3, 3), '#8a8f96', { p: [0.16, 0.08, 0.15], tb: [0.6, 1.1] });
    B.add(stoneGeo(0.15, 1, 5, 2), '#7d8288', { p: [-0.18, 0.05, -0.1], tb: [0.6, 1.1] });
    for (var g = 0; g < 6; g++) B.add(G.cone(0.035, 0.22 + r() * 0.14, 3), '#5f9a3f', { p: [(r() - 0.5) * 0.5, 0.08, (r() - 0.5) * 0.5], r: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6], noAO: true });
    B.ao = [0.65, 0.4];
    return { radius: 0.25 };
  }, extra: function (grp, rng, o) {
    if (!o.label) return;
    var c = canvas(512, 128), x = c.getContext('2d');
    var fs = 72; x.font = 'bold ' + fs + 'px "Trebuchet MS", "Segoe UI", sans-serif';
    while (x.measureText(o.label).width > 480 && fs > 24) { fs -= 4; x.font = 'bold ' + fs + 'px "Trebuchet MS", "Segoe UI", sans-serif'; }
    x.fillStyle = '#3a2412'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(o.label, 256, 66);
    var tex = new T.CanvasTexture(c);
    var mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    var pg = new T.PlaneGeometry(1.08, 0.27);
    var front = new T.Mesh(pg, mat); front.position.set(0.6, 1.95, 0.162); front.userData.noMeasure = true;
    var back = new T.Mesh(pg, mat); back.position.set(0.6, 1.95, 0.073); back.rotation.y = PI; back.userData.noMeasure = true;
    grp.children[0].add(front); grp.children[0].add(back);
    grp.userData.label = o.label;
  } };

  // ==================================================================
  // ---- v1.2 WS9: the Lanternmere Vault (V1.2-CONTRACT §6.2). A sandstone strongroom front with a
  //  great round brass-and-iron vault door (closed, static), a teal banner with a gold coin, a teller's
  //  counter (open ledger, coin stacks, a brass balance, a strongbox) and two lamp pillars. Faces +Z:
  //  the banker NPC stands ~2.6 in front of it. opts.color tints the stone. Static except the lamp halos.
  // ==================================================================
  P.vault_counter = { v: 1, build: function (B, r, o) {
    var st = C(o.color || '#bcae94'), stD = sh(st, -0.24), stL = sh(st, 0.1), brass = C('#c99a3e'), gold = C(GOLD), iron = C('#3a3644');
    var wood = C('#6e4226'), woodL = C('#a06a3c'), teal = C('#1f5c58'), cream = C('#efe4c8'), i, a;
    var DX = -0.85, CY = 1.62, WZ = -0.55;                  // door centre x / height, wall centre z
    // plinth and front step
    B.add(rbox(5.3, 0.24, 2.4, 0.05), stD, { p: [0, 0.12, -0.05], tb: [0.65, 1.1], cn: 0.08 });
    B.add(rbox(2.6, 0.12, 0.45, 0.04), st, { p: [DX, 0.3, 0.25], tb: [0.65, 1.1] });
    // strongroom wall (coursed stone), gold string course, cornice, pediment
    B.add(rbox(4.2, 3.1, 1.1, 0.06), st, { p: [0, 1.79, WZ], tb: [0.7, 1.1], cf: courses(0.52, 0.07), cn: 0.05 });
    B.add(rbox(4.26, 0.06, 1.16, 0.02), gold, { p: [0, 3.3, WZ], tb: [0.6, 1.25] });
    B.add(rbox(4.5, 0.34, 1.4, 0.06), stD, { p: [0, 3.5, WZ + 0.05], tb: [0.65, 1.12] });
    B.add(rbox(2.3, 0.5, 1.0, 0.06), stL, { p: [0, 3.92, WZ], tb: [0.65, 1.1] });
    B.add(rbox(2.4, 0.08, 1.1, 0.03), stD, { p: [0, 4.2, WZ], tb: [0.65, 1.1] });
    // gold key emblem on the pediment
    var KZ = WZ + 0.52;
    B.add(G.tor(0.15, 0.045, 6, 20), gold, { p: [-0.42, 3.92, KZ], tb: [0.6, 1.3] });
    B.glow(G.sph(0.06, 8, 6), '#ffe9a0', { p: [-0.42, 3.92, KZ], s: [1, 1, 0.4] });
    B.add(G.box(0.7, 0.07, 0.05), gold, { p: [0.03, 3.92, KZ], tb: [0.6, 1.3] });
    B.add(G.box(0.06, 0.14, 0.05), gold, { p: [0.3, 3.83, KZ], tb: [0.6, 1.3] });
    B.add(G.box(0.06, 0.1, 0.05), gold, { p: [0.18, 3.85, KZ], tb: [0.6, 1.3] });
    // the vault door: stone recess, brass rim, iron leaf, gold rings, bolts, spoked wheel, hinges
    var FZ = WZ + 0.55;
    B.add(G.tor(1.13, 0.17, 8, 44), stD, { p: [DX, CY, FZ], tb: [0.65, 1.1] });
    B.add(G.cyl(0.98, 0.98, 0.12, 44), sh(iron, -0.3), { p: [DX, CY, FZ - 0.02], r: [PI / 2, 0, 0] });
    B.add(G.tor(1.0, 0.085, 8, 44), brass, { p: [DX, CY, FZ + 0.1], tb: [0.6, 1.25] });
    B.add(G.cyl(0.93, 0.93, 0.16, 44), iron, { p: [DX, CY, FZ + 0.08], r: [PI / 2, 0, 0], tb: [0.6, 1.15] });
    [0.74, 0.5].forEach(function (k) { B.add(G.tor(k, 0.028, 5, 40), gold, { p: [DX, CY, FZ + 0.17], tb: [0.6, 1.3] }); });
    for (i = 0; i < 12; i++) { a = i * TAU / 12; B.add(G.sph(0.05, 8, 6), brass, { p: [DX + Math.cos(a) * 0.85, CY + Math.sin(a) * 0.85, FZ + 0.17], s: [1, 1, 0.6], tb: [0.6, 1.25] }); }
    for (i = 0; i < 8; i++) { a = i * PI / 4 + PI / 8; B.add(G.box(0.2, 0.025, 0.02), gold, { p: [DX + Math.cos(a) * 0.62, CY + Math.sin(a) * 0.62, FZ + 0.17], r: [0, 0, a] }); }
    B.add(G.cyl(0.12, 0.14, 0.14, 16), brass, { p: [DX, CY, FZ + 0.24], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    B.add(G.tor(0.34, 0.035, 6, 28), brass, { p: [DX, CY, FZ + 0.32], tb: [0.6, 1.25] });
    for (i = 0; i < 4; i++) { a = i * PI / 2 + PI / 4; B.add(G.box(0.34, 0.035, 0.035), brass, { p: [DX + Math.cos(a) * 0.17, CY + Math.sin(a) * 0.17, FZ + 0.31], r: [0, 0, a] }); B.add(G.sph(0.045, 8, 6), sh(brass, 0.2), { p: [DX + Math.cos(a) * 0.34, CY + Math.sin(a) * 0.34, FZ + 0.32] }); }
    B.glow(G.sph(0.055, 8, 6), '#ffe9a0', { p: [DX, CY, FZ + 0.32], s: [1, 1, 0.5] });
    [-1, 1].forEach(function (sy) { B.add(rbox(0.26, 0.3, 0.2, 0.03), brass, { p: [DX + 1.02, CY + sy * 0.48, FZ + 0.08], tb: [0.6, 1.2] }); B.add(G.cyl(0.05, 0.05, 0.42, 10), sh(brass, -0.2), { p: [DX + 1.14, CY + sy * 0.48, FZ + 0.18] }); });
    // combination dial, upper right of the leaf
    B.add(G.cyl(0.11, 0.11, 0.05, 18), gold, { p: [DX + 0.45, CY + 0.42, FZ + 0.19], r: [PI / 2, 0, 0], tb: [0.6, 1.3] });
    B.add(G.box(0.02, 0.07, 0.02), iron, { p: [DX + 0.45, CY + 0.49, FZ + 0.22] });
    // teal banner with a gold coin on the right of the wall
    B.add(G.box(0.78, 1.55, 0.04), teal, { p: [1.32, 2.28, FZ + 0.03], tb: [0.6, 1.1], cf: grain('y', 22, 0.06) });
    B.add(G.cone(0.39, 0.3, 3), teal, { p: [1.32, 1.42, FZ + 0.03], r: [PI, 0, 0], s: [1, 1, 0.12], flat: true, tb: [0.6, 1.1] });
    B.add(G.box(0.82, 0.07, 0.07), sh(wood, -0.2), { p: [1.32, 3.08, FZ + 0.05] });
    B.add(G.box(0.78, 0.04, 0.05), gold, { p: [1.32, 1.56, FZ + 0.06] });
    B.add(G.cyl(0.22, 0.22, 0.04, 22), gold, { p: [1.32, 2.42, FZ + 0.07], r: [PI / 2, 0, 0], tb: [0.6, 1.3] });
    B.add(G.tor(0.17, 0.018, 4, 22), sh(gold, -0.25), { p: [1.32, 2.42, FZ + 0.1] });
    star4(B, [1.32, 2.42, FZ + 0.1], [0, 0, 1], 0.12, sh(gold, -0.3), false);
    // teller's counter (front right): panelled wood body, polished top, brass rail
    var CX = 1.15, CZ = 0.5;
    B.add(rbox(1.7, 0.95, 0.72, 0.04), wood, { p: [CX, 0.715, CZ], tb: [0.65, 1.1], cf: grain('y', 16, 0.1) });
    for (i = 0; i < 3; i++) B.add(rbox(0.46, 0.6, 0.03, 0.02), sh(wood, 0.12), { p: [CX - 0.54 + i * 0.54, 0.72, CZ + 0.37], tb: [0.65, 1.1] });
    B.add(rbox(1.86, 0.08, 0.86, 0.03), woodL, { p: [CX, 1.23, CZ], tb: [0.7, 1.12], cf: grain('x', 14, 0.08) });
    B.add(G.cyl(0.025, 0.025, 1.7, 8), brass, { p: [CX, 0.4, CZ + 0.45], r: [0, 0, PI / 2], tb: [0.6, 1.2] });
    // on the counter: open ledger + quill, coin stacks, a brass balance, a strongbox
    var TY = 1.27;
    B.add(G.box(0.62, 0.03, 0.42), '#7a2a2a', { p: [CX - 0.42, TY, CZ + 0.08], r: [0, 0.12, 0] });
    [-1, 1].forEach(function (sx) { B.add(G.box(0.29, 0.035, 0.38), cream, { p: [CX - 0.42 + sx * 0.15 * Math.cos(0.12), TY + 0.03 + 0.012, CZ + 0.08 - sx * 0.15 * Math.sin(0.12)], r: [0, 0.12, sx * -0.06], tb: [0.75, 1.1] }); });
    for (i = 0; i < 4; i++) B.add(G.box(0.2, 0.006, 0.012), '#6a6070', { p: [CX - 0.57, TY + 0.065, CZ - 0.02 + i * 0.07], r: [0, 0.12, 0], noAO: true });
    B.add(G.cone(0.02, 0.36, 5), '#f4f0e6', { p: [CX - 0.2, TY + 0.2, CZ + 0.2], r: [0.5, 0, -0.6] });
    [[0.1, 0.12], [0.22, 0.17], [0.2, 0.06]].forEach(function (c, k) { var n = 4 + k * 2; for (var j = 0; j < n; j++) B.add(G.cyl(0.065, 0.065, 0.022, 14), sh(gold, (hash3(k, j, 3) - 0.5) * 0.25), { p: [CX + c[0] + (hash3(j, k, 1) - 0.5) * 0.012, TY + 0.012 + j * 0.024, CZ + c[1] - 0.12], tb: [0.6, 1.3] }); });
    var bx = CX + 0.52;
    B.add(G.cyl(0.07, 0.1, 0.05, 12), brass, { p: [bx, TY + 0.025, CZ - 0.12], tb: [0.6, 1.25] });
    B.add(G.cyl(0.014, 0.014, 0.46, 8), brass, { p: [bx, TY + 0.27, CZ - 0.12] });
    B.add(G.box(0.48, 0.022, 0.022), brass, { p: [bx, TY + 0.49, CZ - 0.12], r: [0, 0, 0.08], tb: [0.6, 1.25] });
    [-1, 1].forEach(function (sx) {
      var px = bx + sx * 0.22, py = TY + 0.49 + sx * 0.018;
      B.add(G.cyl(0.004, 0.004, 0.24, 4), '#8a7a5a', { p: [px, py - 0.12, CZ - 0.12], noAO: true });
      B.add(latheS([[0, 0], [0.09, 0], [0.1, 0.02], [0, 0.015]], 12), brass, { p: [px, py - 0.25, CZ - 0.12], tb: [0.6, 1.25] });
    });
    B.add(G.sph(0.035, 8, 6), gold, { p: [bx, TY + 0.52, CZ - 0.12] });
    B.add(rbox(0.34, 0.24, 0.26, 0.03), iron, { p: [CX + 0.62, TY + 0.12, CZ + 0.17], r: [0, -0.2, 0], tb: [0.6, 1.15] });
    [-1, 1].forEach(function (sx) { B.add(G.box(0.036, 0.25, 0.27), brass, { p: [CX + 0.62 + sx * 0.1 * Math.cos(0.2), TY + 0.12, CZ + 0.17 + sx * 0.1 * Math.sin(0.2)], r: [0, -0.2, 0], tb: [0.6, 1.2] }); });
    // coin sacks at the foot of the wall (left of the door) + a few spilled coins
    [[-1.9, 0.42, 0.3, 7], [-1.45, 0.62, 0.24, 9]].forEach(function (k) {
      var sx = k[0], sz = k[1], rr = k[2], sy = 0.24 + rr * 0.85;
      B.add(bumpy(G.sph(rr, 12, 9), 0.05, 3, k[3]), '#a87c48', { p: [sx, sy, sz], s: [1, 0.92, 1], tb: [0.7, 1.1], cf: grain('y', 40, 0.08) });
      B.add(G.cyl(rr * 0.3, rr * 0.45, rr * 0.4, 8), '#94693a', { p: [sx, sy + rr * 0.95, sz] });
      B.add(G.tor(rr * 0.3, 0.02, 4, 10), '#5a3a1a', { p: [sx, sy + rr * 0.85, sz], r: [PI / 2, 0, 0] });
      B.add(G.cyl(0.06, 0.06, 0.018, 12), gold, { p: [sx + 0.03, sy + rr * 1.17, sz + 0.02], r: [0.3, 0, 0.2], tb: [0.6, 1.3] });
    });
    for (i = 0; i < 6; i++) B.add(G.cyl(0.06, 0.06, 0.018, 12), gold, { p: [-1.6 + (hash3(i, 4, 2) - 0.5) * 0.8, 0.25, 0.85 + (hash3(i, 7, 1) - 0.5) * 0.4], r: [(hash3(i, 1, 1) - 0.5) * 0.4, 0, (hash3(i, 2, 2) - 0.5) * 0.4], tb: [0.6, 1.3] });
    // lamp pillars at both front corners (warm glass orbs in brass bowls)
    [-1, 1].forEach(function (sx) {
      var x = sx * 2.45, z = 0.38;
      B.add(rbox(0.56, 0.3, 0.56, 0.04), stD, { p: [x, 0.39, z], tb: [0.65, 1.1] });
      B.add(rbox(0.38, 1.6, 0.38, 0.04), st, { p: [x, 1.34, z], tb: [0.7, 1.1], cf: courses(0.4, 0.06) });
      B.add(rbox(0.54, 0.12, 0.54, 0.03), gold, { p: [x, 2.2, z], tb: [0.6, 1.25] });
      B.add(latheS([[0, 0], [0.12, 0.0], [0.2, 0.08], [0.22, 0.14], [0.18, 0.14], [0, 0.06]], 14), brass, { p: [x, 2.26, z], tb: [0.6, 1.25] });
      B.glow(G.sph(0.17, 12, 10), '#ffd98a', { p: [x, 2.5, z] });
      B.glow(G.sph(0.08, 8, 6), '#fff6d8', { p: [x, 2.5, z] });
    });
    B.ao = [0.62, 1.0];
    return { radius: 2.4, colliders: [{ x: -1.6, z: -0.55, r: 0.62 }, { x: -0.55, z: -0.55, r: 0.62 }, { x: 0.5, z: -0.55, r: 0.62 }, { x: 1.55, z: -0.55, r: 0.62 }, { x: 0.75, z: 0.5, r: 0.48 }, { x: 1.55, z: 0.5, r: 0.48 }, { x: -2.45, z: 0.38, r: 0.32 }, { x: 2.45, z: 0.38, r: 0.32 }, { x: -1.75, z: 0.45, r: 0.4 }] };
  }, extra: function (grp, rng) {
    var g = grp.children[0], hs = [-2.45, 2.45].map(function (x) { var h = halo(C('#ffd27a'), 1.7, 0.75); h.position.set(x, 2.5, 0.38); g.add(h); return h; });
    var ph = rng() * 10;
    grp.userData.anim = function (t) { hs.forEach(function (h, k) { var s = 1.7 * (1 + Math.sin(t * 2.1 + ph + k * 1.7) * 0.06); h.scale.set(s, s, 1); }); };
  } };

  // ==================================================================
  // ---- v1.2 WS6: Hollow Orrery props (WS4 places them; same conventions as every prop:
  //  userData.radius / colliders, optional userData.anim(t), static meshes marked propStatic so the
  //  engine's per-cell batcher folds them in; moving assemblies (door leaf, orrery mechanism) are packed
  //  with skinify into one skinned mesh + one halo batch).
  //  vault_pillar, crystal_cluster, brazier (o.color = flame colour), star_door (userData.setOpen(bool)),
  //  orrery (giant animated brass orrery), rune_circle (o.color = rune glow, walk-through), chain_arch,
  //  telescope_broken, obelisk. opts.color tints the stone (crystals: the crystal colour).
  // ==================================================================
  var VSTONE = ['#4a4262', '#453d5c', '#504868'], VGOLD = '#d4a84a', VBRASS = '#b8873a';
  // a face frame on a vertical surface: local X = tangent, Y = up, Z = the face normal (angle a about Y)
  function faceMtx(a, d, y) { var m = new T.Matrix4().makeRotationY(a); m.setPosition(Math.sin(a) * d, y, Math.cos(a) * d); return m; }
  // glowing constellation on a face: dots joined by thin lines (pts in the face plane)
  function constellation(B, M4, pts, col, s) {
    pts.forEach(function (p, i) {
      B.glow(G.oct(s), col, { matrix: M4.clone().multiply(mtx({ p: [p[0], p[1], 0.008], s: [1, 1, 0.4] })) });
      if (!i) return;
      var q = pts[i - 1], dx = p[0] - q[0], dy = p[1] - q[1], L = Math.sqrt(dx * dx + dy * dy);
      B.glow(G.box(L, s * 0.24, s * 0.3), col, { matrix: M4.clone().multiply(mtx({ p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0.005], r: [0, 0, Math.atan2(dy, dx)] })) });
    });
  }
  function randConst(r, n, w, h) { var pts = []; for (var i = 0; i < n; i++) pts.push([(r() - 0.5) * w, (i + r() * 0.8) / n * h]); return pts; }

  P.vault_pillar = { v: 3, build: function (B, r, o) {
    var st = C(o.color || pick(r, VSTONE)), stD = sh(st, -0.3), gold = C(VGOLD), glowC = C(o.glow || VLT.cyan), crs = courses(0.62, 0.05, 8);
    B.add(rbox(1.8, 0.3, 1.8, 0.06), stD, { p: [0, 0.15, 0], tb: [0.65, 1.1], cn: 0.08 });
    B.add(rbox(1.56, 0.04, 1.56, 0.01), gold, { p: [0, 0.31, 0], tb: [0.6, 1.25] });
    B.add(rbox(1.5, 0.24, 1.5, 0.05), st, { p: [0, 0.44, 0], tb: [0.65, 1.1] });
    B.add(latheS([[0.68, 0], [0.64, 0.1], [0.64, 0.17], [0.6, 0.22]], 8), gold, { p: [0, 0.56, 0], r: [0, PI / 8, 0], flat: true, tb: [0.6, 1.25] });
    B.add(latheS([[0.6, 0], [0.585, 2.6], [0.55, 5.0]], 8), st, { p: [0, 0.78, 0], r: [0, PI / 8, 0], flat: true, tb: [0.72, 1.1], cf: crs, cn: 0.06 });
    [1.7, 4.1].forEach(function (y) { var rr = lerp(0.6, 0.55, (y - 0.78) / 5); B.add(latheS([[rr, 0], [rr + 0.03, 0.03], [rr + 0.03, 0.11], [rr, 0.14]], 8), gold, { p: [0, y, 0], r: [0, PI / 8, 0], flat: true, tb: [0.6, 1.25] }); });
    // star charts on four faces, a gem set into the front face
    [0, PI / 2, PI, -PI / 2].forEach(function (a, i) {
      var y0 = 2.0 + r() * 0.2, d = lerp(0.6, 0.55, (y0 + 0.5 - 0.78) / 5) * Math.cos(PI / 8);
      if (i === 0) {
        B.add(G.tor(0.15, 0.04, 6, 18), gold, { matrix: faceMtx(a, d, 3.0).multiply(mtx({ p: [0, 0, 0.02] })), tb: [0.6, 1.25] });
        B.glow(G.oct(0.11), glowC, { matrix: faceMtx(a, d, 3.0).multiply(mtx({ p: [0, 0, 0.05], s: [1, 1.3, 0.45] })) });
        constellation(B, faceMtx(a, d, y0 - 0.5), randConst(r, 4, 0.5, 0.7), glowC, 0.035);
      } else constellation(B, faceMtx(a, d, y0), randConst(r, 5, 0.55, 1.4), glowC, 0.035);
    });
    B.add(latheS([[0.55, 0], [0.62, 0.12], [0.78, 0.26], [0.86, 0.4], [0.86, 0.5], [0, 0.5]], 8), gold, { p: [0, 5.76, 0], r: [0, PI / 8, 0], flat: true, tb: [0.6, 1.25] });
    B.add(rbox(1.9, 0.34, 1.9, 0.06), stD, { p: [0, 6.43, 0], tb: [0.65, 1.12] });
    B.add(rbox(1.94, 0.05, 1.94, 0.015), gold, { p: [0, 6.27, 0], tb: [0.6, 1.25] });
    B.ao = [0.6, 1.2];
    return { radius: 0.9 };
  } };

  P.crystal_cluster = { v: 3, lod: true, build: function (B, r, o) {
    var c = C(o.color || pick(r, [VLT.cyan, VLT.violet, VLT.cyan])), rock = C('#3c3550'), lo = !!o.lod;   // lod: cavern-edge border build (fewer shards, no halos)
    B.add(stoneGeo(0.95, 2, r() * 9, 4, 0.25), rock, { p: [0, 0.05, 0], s: [1.3, 0.42, 1.15], tb: [0.6, 1.1], cn: 0.1 });
    for (var k = 0; k < (lo ? 2 : 4); k++) { var ka = r() * TAU; B.add(stoneGeo(0.28 + r() * 0.2, 1, r() * 40, 3), sh(rock, (r() - 0.5) * 0.2), { p: [Math.cos(ka) * 1.05, 0.08, Math.sin(ka) * 0.95], tb: [0.6, 1.1] }); }
    B.add(crystalGeo(0.3, 1.9, 0.6), sh(c, 0.05), { p: [0, 0.2, 0], r: [0.05, r(), -0.08], emis: true });
    var n = lo ? 4 : 6 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU + r() * 0.5, d = 0.35 + r() * 0.35, s = 0.45 + r() * 0.45, tilt = 0.35 + r() * 0.35;
      B.add(crystalGeo(0.2 * s, 1.3 * s, 0.4 * s), sh(c, (r() - 0.5) * 0.35), { p: [Math.cos(a) * d, 0.12, Math.sin(a) * d], r: [Math.sin(a) * tilt, r(), -Math.cos(a) * tilt], emis: true });
    }
    for (var j = 0; j < (lo ? 0 : 7); j++) { var ja = r() * TAU, jd = 0.9 + r() * 0.5; B.add(crystalGeo(0.05, 0.16, 0.1), sh(c, 0.1), { p: [Math.cos(ja) * jd, 0.0, Math.sin(ja) * jd], r: [Math.sin(ja) * 0.6, 0, -Math.cos(ja) * 0.6], emis: true }); }
    for (var g = 0; g < (lo ? 0 : 6); g++) { var ga = r() * TAU; B.glow(G.oct(0.035), sh(c, 0.4), { p: [Math.cos(ga) * (0.7 + r() * 0.5), 0.3 + r() * 0.15, Math.sin(ga) * (0.6 + r() * 0.5)] }); }
    B.ao = [0.7, 0.4];
    return { radius: 1.15, jitter: true, emis: sh(c, -0.52), glowC: c, lod: lo };
  }, extra: function (grp, rng, o, info) {
    if (info.lod) return;
    var h1 = halo(info.glowC, 3.6, 0.5); h1.position.y = 1.3; grp.children[0].add(h1);
    var h2 = halo(info.glowC, 1.8, 0.55); h2.position.set(0.3, 0.5, 0.2); grp.children[0].add(h2);
    var ph = rng() * 10;
    grp.userData.anim = function (t) { var s = 3.6 * (1 + Math.sin(t * 1.4 + ph) * 0.1); h1.scale.set(s, s, 1); var s2 = 1.8 * (1 + Math.sin(t * 2.3 + ph * 2) * 0.15); h2.scale.set(s2, s2, 1); };
  } };

  P.brazier = { v: 2, build: function (B, r, o) {
    var brass = C(VBRASS), iron = C('#2e2836'), stone = C(pick(r, VSTONE)), i, a;
    B.add(rbox(0.95, 0.2, 0.95, 0.05), stone, { p: [0, 0.1, 0], tb: [0.65, 1.1], cn: 0.08 });
    B.add(rbox(0.99, 0.03, 0.99, 0.01), VGOLD, { p: [0, 0.19, 0], tb: [0.6, 1.2] });
    for (i = 0; i < 3; i++) {
      a = i * TAU / 3 + 0.3; var ca = Math.cos(a), sa = Math.sin(a);
      B.add(G.taper([[ca * 0.36, 0.2, sa * 0.36], [ca * 0.45, 0.55, sa * 0.45], [ca * 0.3, 0.95, sa * 0.3], [ca * 0.4, 1.16, sa * 0.4]], 0.045, 0.032, 10, 5), iron, { tb: [0.6, 1.1] });
      B.add(G.sph(0.055, 8, 6), brass, { p: [ca * 0.45, 0.56, sa * 0.45], tb: [0.6, 1.2] });
      B.add(G.sph(0.06, 8, 6), iron, { p: [ca * 0.36, 0.22, sa * 0.36], s: [1.3, 0.6, 1.3] });
    }
    B.add(G.tor(0.37, 0.028, 5, 20), brass, { p: [0, 0.6, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.2] });
    B.add(latheS([[0, 1.02], [0.24, 1.04], [0.44, 1.14], [0.56, 1.3], [0.6, 1.37], [0.54, 1.37], [0.44, 1.26], [0, 1.22]], 20), brass, { tb: [0.6, 1.2] });
    B.add(G.tor(0.585, 0.026, 5, 28), sh(brass, 0.15), { p: [0, 1.37, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    for (i = 0; i < 8; i++) { a = i * TAU / 8; B.add(G.cone(0.035, 0.17, 4), brass, { p: [Math.cos(a) * 0.6, 1.45, Math.sin(a) * 0.6], dir: [Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45], tb: [0.6, 1.2] }); }
    for (i = 0; i < 4; i++) { a = i * PI / 2 + PI / 4; star4(B, [Math.cos(a) * 0.5, 1.21, Math.sin(a) * 0.5], [Math.cos(a), 0.45, Math.sin(a)], 0.07, VGOLD, false); }
    B.add(bumpy(G.sph(0.46, 14, 6), 0.04, 5, 2), '#241c22', { p: [0, 1.22, 0], s: [1, 0.16, 1], noAO: true });
    for (i = 0; i < 9; i++) { a = r() * TAU; var d = r() * 0.32; B.glow(G.sph(0.035, 5, 4), pick(r, ['#ff6a1a', '#ffae2a', '#ff3a0a']), { p: [Math.cos(a) * d, 1.27, Math.sin(a) * d] }); }
    B.ao = [0.65, 0.5];
    return { radius: 0.6 };
  }, extra: function (grp, rng, o) {
    var g = grp.children[0], c0 = o.color ? sh(o.color, 0.45) : C('#ffe48a'), c1 = o.color ? C(o.color) : C('#ff6a1a'), key = hx(c0) + hx(c1);
    var fl = function (k, make) { var m = new T.Mesh(SG('bz_' + k + key, make), vcGlowMat()); m.userData.noMeasure = true; m.position.y = 1.24; g.add(m); return m; };
    var f1 = fl('a', function () { return flameGeo(0.36, 1.15, 12, mix(c0, c1, 0.4), c1, 3); });
    var f2 = fl('b', function () { return flameGeo(0.24, 0.85, 10, c0, mix(c0, c1, 0.6), 2); });
    var f3 = fl('c', function () { return flameGeo(0.11, 0.5, 8, '#fffbe8', c0); });
    var h = halo(c1, 3.2, 0.8); h.position.y = 1.75; g.add(h);
    var ph = rng() * 10;
    grp.userData.anim = function (t) {
      f1.scale.set(1 + Math.sin(t * 10 + ph) * 0.08, 1 + Math.sin(t * 6.5 + ph) * 0.16, 1 + Math.cos(t * 8.3) * 0.08); f1.rotation.y = t * 0.6;
      f2.scale.set(1, 1 + Math.sin(t * 12.5 + 1 + ph) * 0.2, 1); f2.rotation.y = -t * 1.7;
      f3.scale.set(1, 1 + Math.sin(t * 16 + ph) * 0.22, 1);
      var s = 3.2 * (1 + Math.sin(t * 8.6 + ph) * 0.06 + Math.sin(t * 21) * 0.03); h.scale.set(s, s, 1);
    };
  } };

  // Sealed round star-door in a stone frame. userData.setOpen(true|false) animates it (the locking bars retract,
  // the leaf unscrews and sinks into the floor, ~2.6 s; closing reverses). Collision: while closed a row of
  // colliders blocks the doorway (userData.doorColliders); setOpen(true) sets userData.radius = 0 and leaves only
  // the two buttress colliders in userData.colliders (WS4: remove userData.doorColliders from the world list).
  P.star_door = { v: 1, build: function (B, r, o) {
    var st = C(o.color || VSTONE[0]), stD = sh(st, -0.3), gold = C(VGOLD), glowC = C(o.glow || VLT.cyan), cy = 2.55, R = 2.25, i, a;
    B.add(rbox(6.6, 0.26, 1.6, 0.05), stD, { p: [0, 0.13, 0], tb: [0.65, 1.1], cn: 0.08 });
    [-1, 1].forEach(function (sx) {
      B.add(rbox(0.95, 5.2, 1.3, 0.08), st, { p: [sx * 2.9, 2.6, 0], tb: [0.7, 1.1], cf: courses(0.65, 0.05) });
      B.add(rbox(1.12, 0.32, 1.46, 0.05), stD, { p: [sx * 2.9, 0.16, 0], tb: [0.65, 1.1] });
      B.add(rbox(1.0, 0.06, 1.34, 0.02), gold, { p: [sx * 2.9, 3.9, 0], tb: [0.6, 1.25] });
      B.add(rbox(1.0, 0.85, 1.0, 0.06), st, { p: [sx * 2.02, 4.85, 0], tb: [0.7, 1.1] });
      B.add(rbox(0.7, 0.95, 1.0, 0.06), st, { p: [sx * 2.2, 0.5, 0], tb: [0.7, 1.1] });
      constellation(B, faceMtx(0, 0.66, 2.0).multiply(new T.Matrix4().makeTranslation(sx * 2.9, 0, 0)), randConst(r, 5, 0.5, 1.5), glowC, 0.04);
    });
    B.add(rbox(6.8, 0.7, 1.5, 0.08), stD, { p: [0, 5.45, 0], tb: [0.65, 1.12] });
    B.add(rbox(6.86, 0.06, 1.56, 0.02), gold, { p: [0, 5.12, 0], tb: [0.6, 1.25] });
    B.add(G.tor(R + 0.3, 0.38, 10, 56), st, { p: [0, cy, 0], s: [1, 1, 1.6], tb: [0.65, 1.1], cn: 0.08 });
    [-1, 1].forEach(function (sz) { B.add(G.tor(R + 0.05, 0.07, 6, 56), gold, { p: [0, cy, sz * 0.36], tb: [0.6, 1.25] }); });
    for (i = 0; i < 16; i++) { a = i * TAU / 16; if (Math.sin(a) < -0.85) continue; star4(B, [Math.cos(a) * 2.58, cy + Math.sin(a) * 2.58, 0.6], [0, 0, 1], 0.11, VGOLD, false, PI / 4); }
    // keystone medallion
    B.add(G.cyl(0.36, 0.36, 0.2, 20), stD, { p: [0, cy + 2.62, 0.55], r: [PI / 2, 0, 0], tb: [0.65, 1.1] });
    B.add(G.tor(0.36, 0.05, 6, 22), gold, { p: [0, cy + 2.62, 0.65], tb: [0.6, 1.25] });
    star4(B, [0, cy + 2.62, 0.68], [0, 0, 1], 0.3, glowC, true);
    B.ao = [0.62, 1.2];
    var pillars = [{ x: -2.9, z: 0, r: 0.72 }, { x: 2.9, z: 0, r: 0.72 }], door = rowColliders(-1.8, 1.8, 0.6, 0.5);
    return { radius: 2.3, colliders: pillars.concat(door), pillars: pillars, door: door, glowC: glowC };
  }, extra: function (grp, rng, o, info) {
    var g = grp.children[0], cy = 2.55, R = 2.25, i, a;
    var dr = new T.Group(); dr.name = 'starDoorLeaf'; g.add(dr);
    var leaf = pivot(dr, 0, cy, 0), obs = C('#2a2338'), gold = C(VGOLD), glowC = info.glowC;
    var LB = new Builder();
    LB.add(G.cyl(R, R, 0.36, 56), obs, { r: [PI / 2, 0, 0] });
    [-1, 1].forEach(function (sz) {
      [0.95, 0.72, 0.42].forEach(function (k) { LB.add(G.tor(R * k, 0.035, 4, 56), gold, { p: [0, 0, sz * 0.18] }); });
      for (i = 0; i < 8; i++) { a = i * PI / 4; LB.add(G.box(R * 0.5, 0.05, 0.03), gold, { p: [Math.cos(a) * R * 0.685, Math.sin(a) * R * 0.685, sz * 0.18], r: [0, 0, a] }); }
    });
    star4(LB, [0, 0, 0.2], [0, 0, 1], 0.62, glowC, true);
    star4(LB, [0, 0, 0.2], [0, 0, 1], 0.4, sh(glowC, 0.3), true, PI / 4);
    LB.glow(G.tor(0.62, 0.025, 4, 36), glowC, { p: [0, 0, 0.19] });
    var rs = seeded(1234);
    for (i = 0; i < 26; i++) { var rr = R * (0.47 + rs() * 0.45), aa = rs() * TAU; LB.glow(G.oct(0.025 + rs() * 0.025), sh(glowC, 0.2), { p: [Math.cos(aa) * rr, Math.sin(aa) * rr, 0.19], s: [1, 1, 0.3] }); }
    leaf.add(LB.build());
    var bars = [];
    for (i = 0; i < 4; i++) {
      a = i * PI / 2 + PI / 4;
      var bp = pivot(leaf), bb = new Builder();
      bb.add(G.box(0.62, 0.22, 0.26), C(VBRASS), { p: [Math.cos(a) * (R - 0.18), Math.sin(a) * (R - 0.18), 0.12], r: [0, 0, a] });
      bb.add(G.sph(0.07, 8, 6), sh(C(VBRASS), 0.2), { p: [Math.cos(a) * (R - 0.42), Math.sin(a) * (R - 0.42), 0.27] });
      bp.add(bb.build()); bars.push({ o: bp, a: a });
    }
    var hl = halo(glowC, 2.8, 0.75); hl.position.set(0, 0, 0.5); leaf.add(hl);
    skinify(dr);
    var S = { open: false, p: 0, last: null };
    function apply(p) {
      var bar = segK(p, 0.0, 0.22), rot = easeIO(segK(p, 0.15, 0.5)), sink = easeIO(segK(p, 0.46, 1));
      bars.forEach(function (b) { b.o.position.set(Math.cos(b.a) * 0.42 * bar, Math.sin(b.a) * 0.42 * bar, 0); });
      leaf.rotation.z = -rot * 1.75; leaf.position.set(Math.sin(p * 60) * 0.015 * bell(segK(p, 0.4, 0.75)), cy - sink * 5.5, 0);
      dr.visible = p < 0.999;
    }
    grp.userData.doorColliders = info.door;
    grp.userData.isOpen = false;
    grp.userData.setOpen = function (v) {
      v = !!v; S.open = v; grp.userData.isOpen = v;
      grp.userData.radius = v ? 0 : 2.3;
      grp.userData.colliders = v ? info.pillars.slice() : info.pillars.concat(info.door);
    };
    grp.userData.openProgress = function () { return S.p; };
    grp.userData.anim = function (t) {
      var dt = S.last === null ? 0 : clamp(t - S.last, 0, 0.1); S.last = t;
      var tgt = S.open ? 1 : 0;
      if (S.p !== tgt) { S.p = S.open ? Math.min(1, S.p + dt / 2.6) : Math.max(0, S.p - dt / 2.6); apply(S.p); }
      var fl = bell(segK(S.p, 0.0, 0.35)) * 1.6 * (S.open ? 1 : 0.4);
      var s = 2.8 * (1 + Math.sin(t * 1.8) * 0.08 + fl); hl.scale.set(s, s, 1);
    };
    apply(0);
  } };

  // Giant animated brass orrery: a stepped dais with a star dial, a sun on a spire inside turning armillary
  // rings, and four planet arms sweeping overhead (above head height). The mechanism is one skinned mesh.
  P.orrery = { v: 1, build: function (B, r, o) {
    var st = C(o.color || VSTONE[1]), stD = sh(st, -0.3), gold = C(VGOLD), brass = C('#c08a3a'), glowC = C(o.glow || VLT.cyan), i, a;
    [[3.3, 0.0, 0.32], [2.75, 0.32, 0.3], [2.1, 0.62, 0.28]].forEach(function (s, n) {
      B.add(latheS([[s[0], 0], [s[0], s[2] - 0.04], [s[0] - 0.04, s[2]], [0, s[2]]], 56), n % 2 ? st : stD, { p: [0, s[1], 0], tb: [0.65, 1.1], cf: courses(0.5, 0.04, 40), cn: 0.06 });
      B.add(G.tor(s[0] - 0.14, 0.03, 4, 72), gold, { p: [0, s[1] + s[2] + 0.004, 0], r: [PI / 2, 0, 0], s: [1, 1, 0.4], tb: [0.6, 1.25], noAO: true });
    });
    for (i = 0; i < 12; i++) {
      a = i * TAU / 12;
      star4(B, [Math.cos(a) * 1.7, 0.905, Math.sin(a) * 1.7], [0, 1, 0], i % 3 ? 0.09 : 0.15, glowC, true, a);
      B.add(G.box(0.05, 0.02, 0.3), gold, { p: [Math.cos(a + PI / 12) * 1.75, 0.91, Math.sin(a + PI / 12) * 1.75], r: [0, -a - PI / 12, 0], noAO: true });
    }
    B.add(G.tor(1.25, 0.03, 4, 56), gold, { p: [0, 0.91, 0], r: [PI / 2, 0, 0], s: [1, 1, 0.4], noAO: true });
    B.add(latheS([[0.62, 0], [0.55, 0.1], [0.42, 0.18], [0.36, 0.3]], 24), brass, { p: [0, 0.9, 0], tb: [0.6, 1.2] });
    B.add(flutedShaft(0.34, 0.24, 2.5, 12, 4), brass, { p: [0, 1.15, 0], tb: [0.6, 1.2] });
    [1.6, 2.5, 3.4].forEach(function (y) { B.add(G.tor(0.32 - (y - 1.15) * 0.04, 0.04, 5, 20), gold, { p: [0, y, 0], r: [PI / 2, 0, 0], tb: [0.6, 1.25] }); });
    for (i = 0; i < 4; i++) {
      a = i * PI / 2 + PI / 4; var ca = Math.cos(a), sa = Math.sin(a);
      B.add(G.taper([[ca * 1.3, 0.9, sa * 1.3], [ca * 1.05, 1.5, sa * 1.05], [ca * 0.55, 1.75, sa * 0.55], [ca * 0.3, 1.7, sa * 0.3]], 0.07, 0.045, 12, 6), brass, { tb: [0.6, 1.2] });
      B.add(G.sph(0.1, 8, 6), gold, { p: [ca * 1.3, 0.95, sa * 1.3], tb: [0.6, 1.25] });
    }
    B.ao = [0.6, 1.0];
    return { radius: 3.3 };
  }, extra: function (grp, rng, o) {
    var g = grp.children[0], mech = new T.Group(); mech.name = 'orreryMech'; g.add(mech);
    var gold = C(VGOLD), brass = C('#c08a3a'), brassD = sh(brass, -0.32), sunC = C(o.sun || '#ffd76a'), glowC = C(o.glow || VLT.cyan), i, a;
    var hub = pivot(mech, 0, 3.6, 0), HB = new Builder();
    HB.add(G.sph(0.36, 16, 12), brass);
    HB.add(G.tor(0.38, 0.05, 5, 22), gold, { r: [PI / 2, 0, 0] });
    HB.add(G.cyl(0.06, 0.1, 1.0, 8), brass, { p: [0, 0.6, 0] });
    HB.glow(G.sph(0.55, 24, 18), sunC, { p: [0, 1.4, 0] });
    for (i = 0; i < 12; i++) { a = i * TAU / 12; HB.add(G.cone(0.07, 0.36, 4), gold, { p: [Math.cos(a) * 0.72, 1.4 + Math.sin(a) * 0.72, 0], r: [0, 0, a - PI / 2] }); }
    star4(HB, [0, 2.25, 0], [0, 0, 1], 0.22, gold, false); star4(HB, [0, 2.25, 0], [1, 0, 0], 0.16, gold, false);
    hub.add(HB.build());
    var sunHalo = halo(sunC, 4.6, 0.8); sunHalo.position.set(0, 1.4, 0); hub.add(sunHalo);
    var rings = [];
    [[1.15, 0.5, 0.0, 0.3], [1.34, -0.75, 0.5, -0.22], [1.55, PI / 2 - 0.25, 0.2, 0.12]].forEach(function (Rg, n) {
      var tp = pivot(hub, 0, 1.4, 0); tp.rotation.set(Rg[1], Rg[2], 0);
      var sp = pivot(tp), rb = new Builder();
      rb.add(G.tor(Rg[0], 0.04, 5, 56), n === 2 ? gold : brass, { r: [PI / 2, 0, 0] });
      for (var k = 0; k < 12; k++) { var ka = k * TAU / 12; rb.add(G.box(0.05, 0.12, 0.05), n === 2 ? brass : gold, { p: [Math.cos(ka) * Rg[0], 0, Math.sin(ka) * Rg[0]], r: [0, -ka, 0] }); }
      rb.glow(G.oct(0.06), glowC, { p: [Rg[0], 0, 0] });
      sp.add(rb.build()); rings.push({ o: sp, w: Rg[3] });
    });
    var arms = [];
    [[2.3, 0.36, 0.24, '#7fa8d8', 'moon'], [3.05, -0.25, 0.32, '#d88a5a', ''], [3.8, 0.17, 0.44, '#8a6ac8', 'ring'], [4.55, -0.12, 0.27, '#6ac8b0', 'moon']].forEach(function (A, n) {
      var ap = pivot(hub, 0, 0.08 + n * 0.12, 0), ab = new Builder(), L = A[0];
      ab.add(G.cyl(0.04, 0.04, L + 0.6, 6), brassD, { p: [L / 2 - 0.3, 0, 0], r: [0, 0, PI / 2] });
      ab.add(G.sph(0.14, 10, 8), brass, { p: [-0.62, 0, 0] });
      ab.add(G.sph(0.09, 8, 6), gold, { p: [L, 0, 0] });
      ab.add(G.cyl(0.028, 0.028, 0.62, 6), brassD, { p: [L, 0.31, 0] });
      ab.add(G.sph(A[2], 20, 14), A[3], { p: [L, 0.62 + A[2], 0] });
      ab.add(new T.SphereGeometry(A[2] * 1.012, 18, 3, 0, TAU, PI * 0.42, PI * 0.16), sh(A[3], 0.2), { p: [L, 0.62 + A[2], 0] });
      if (A[4] === 'ring') { ab.add(G.tor(A[2] * 1.75, A[2] * 0.08, 3, 40), gold, { p: [L, 0.62 + A[2], 0], r: [PI / 2 + 0.4, 0, 0], s: [1, 1, 0.3] }); ab.glow(G.tor(A[2] * 1.5, A[2] * 0.03, 3, 40), glowC, { p: [L, 0.62 + A[2], 0], r: [PI / 2 + 0.4, 0, 0] }); }
      if (A[4] === 'moon') { ab.add(G.cyl(0.012, 0.012, A[2] * 1.6, 4), brassD, { p: [L + A[2] * 0.8, 0.62 + A[2], 0], r: [0, 0, PI / 2] }); ab.add(G.sph(A[2] * 0.3, 10, 8), '#d8d4e4', { p: [L + A[2] * 1.65, 0.62 + A[2], 0] }); }
      ap.add(ab.build()); arms.push({ o: ap, w: A[1], ph: n * 1.7 });
    });
    skinify(mech);
    grp.userData.anim = function (t) {
      for (var q = 0; q < arms.length; q++) arms[q].o.rotation.y = arms[q].ph + t * arms[q].w;
      for (var j = 0; j < rings.length; j++) rings[j].o.rotation.y = t * rings[j].w;
      var s = 4.6 * (1 + Math.sin(t * 1.3) * 0.06); sunHalo.scale.set(s, s, 1);
    };
  } };

  // Rune circle inlaid in the floor (walk-through): stone disc, gold rings, a glowing glyph band, a slowly turning
  // inner rune ring and a soft ground glow. o.color = rune colour.
  P.rune_circle = { v: 2, build: function (B, r, o) {
    var st = C('#3a3350'), gold = C(VGOLD), glowC = C(o.color || VLT.cyan), i, a;
    B.add(G.cyl(3.0, 3.06, 0.06, 72), st, { p: [0, 0.03, 0], tb: [0.85, 1.05], cn: 0.05, noAO: true });
    [2.92, 2.34, 1.25].forEach(function (R0) { B.add(G.tor(R0, 0.05, 4, 80), gold, { p: [0, 0.062, 0], r: [PI / 2, 0, 0], s: [1, 1, 0.3], tb: [0.6, 1.25], noAO: true }); });
    for (i = 0; i < 28; i++) {
      a = i * TAU / 28;
      if (i % 2) B.glow(G.box(0.06, 0.012, 0.26), glowC, { p: [Math.cos(a) * 2.63, 0.07, Math.sin(a) * 2.63], r: [0, -a, 0] });
      else star4(B, [Math.cos(a) * 2.63, 0.07, Math.sin(a) * 2.63], [0, 1, 0], 0.1, glowC, true, a);
    }
    for (i = 0; i < 8; i++) { a = i * PI / 8; B.add(G.box(0.05, 0.01, 2.4), gold, { p: [0, 0.066, 0], r: [0, a, 0], noAO: true }); }
    B.ao = null;
    return { radius: 0, glowC: glowC };
  }, extra: function (grp, rng, o, info) {
    var g = grp.children[0], glowC = info.glowC;
    var RB = new Builder();
    for (var i = 0; i < 12; i++) { var a = i * TAU / 12; glyph(RB, ['tri', 'zig', 'crescent', 'eye'][i % 4], [Math.cos(a) * 1.8, 0.075, Math.sin(a) * 1.8], [0, 1, 0], 0.32, glowC); }
    RB.glow(G.tor(1.55, 0.018, 3, 64), glowC, { p: [0, 0.074, 0], r: [PI / 2, 0, 0] });
    RB.glow(G.tor(2.05, 0.018, 3, 64), glowC, { p: [0, 0.074, 0], r: [PI / 2, 0, 0] });
    var ring = RB.build(); g.add(ring);
    var gm = cmat('runeGlow' + hx(glowC), function () {
      var m = new T.MeshBasicMaterial({ map: haloTex(), color: glowC, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false });
      m.onBeforeCompile = boostCompile; return m;
    });
    var pool = smesh(SG('runePool', function () { var gg = new T.PlaneGeometry(6.6, 6.6); gg.rotateX(-PI / 2); return gg; }), gm);
    pool.position.y = 0.09; pool.renderOrder = 2; pool.userData.noMeasure = true; g.add(pool);
    var ph = rng() * 10;
    grp.userData.anim = function (t) { ring.rotation.y = t * 0.12 + ph; var s = 1 + Math.sin(t * 1.6 + ph) * 0.05; pool.scale.set(s, 1, s); };
  } };

  // Archway hung with heavy chains: catenary loops under the arch, two dangling ends (one with a star lock).
  P.chain_arch = { v: 2, build: function (B, r, o) {
    var st = C(o.color || pick(r, VSTONE)), stD = sh(st, -0.3), gold = C(VGOLD), iron = C('#3a3444'), glowC = C(o.glow || VLT.cyan), i, a;
    [-1, 1].forEach(function (s) {
      B.add(rbox(1.3, 0.4, 1.3, 0.06), stD, { p: [s * 2.35, 0.2, 0], tb: [0.65, 1.1] });
      var y = 0.4;
      for (var k = 0; k < 5; k++) { var bh = 0.68; B.add(rbox(0.95, bh - 0.03, 0.95, 0.07), sh(st, (r() - 0.5) * 0.12), { p: [s * 2.35, y + bh / 2, 0], tb: [0.65, 1.1], cn: 0.08 }); if (k % 2) B.add(rbox(1.0, 0.06, 1.0, 0.02), gold, { p: [s * 2.35, y + bh, 0], tb: [0.6, 1.25] }); y += bh; }
      B.add(rbox(1.15, 0.3, 1.15, 0.05), stD, { p: [s * 2.35, 3.95, 0], tb: [0.65, 1.12] });
      B.add(G.tor(0.09, 0.03, 4, 10), iron, { p: [s * 2.35, 2.0, 0.5] });
    });
    var nb = 11;
    for (i = 0; i < nb; i++) {
      a = i / (nb - 1) * PI; var key = i === 5;
      B.add(rbox(key ? 0.8 : 0.66, key ? 1.0 : 0.82, key ? 1.06 : 0.92, 0.06), key ? sh(st, 0.08) : sh(st, (r() - 0.5) * 0.12), { p: [Math.cos(a) * 2.35, 4.1 + Math.sin(a) * 2.35, 0], r: [0, 0, a - PI / 2], tb: [0.65, 1.12], cn: 0.08 });
    }
    B.add(G.tor(2.35, 0.04, 4, 48, PI), gold, { p: [0, 4.1, 0.47], tb: [0.6, 1.25] });
    star4(B, [0, 6.45, 0.54], [0, 0, 1], 0.24, glowC, true);
    // chains: links alternate their twist along a catenary
    function chain(x0, y0, x1, y1, sag, z) {
      var n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.15 + sag * 3));
      for (var k = 0; k <= n; k++) {
        var u = k / n, x = lerp(x0, x1, u), y = lerp(y0, y1, u) - sag * 4 * u * (1 - u);
        var dx = (x1 - x0) / n, dy = (y1 - y0) / n + sag * 4 * (2 * u - 1) / n;
        B.add(G.tor(0.085, 0.024, 4, 10), iron, { p: [x, y, z], r: [k % 2 ? PI / 2 : 0, 0, Math.atan2(dy, dx)], order: 'ZYX', s: [1.4, 1, 1], tb: [0.6, 1.15], noAO: true });
      }
    }
    chain(-1.7, 5.15, 1.7, 5.15, 1.4, 0.25);
    chain(-1.1, 5.7, 1.1, 5.7, 0.75, -0.2);
    chain(-2.0, 4.5, -2.0, 2.7, 0, 0.3);
    chain(2.05, 4.6, 2.05, 3.15, 0, 0.3);
    B.add(G.cyl(0.24, 0.24, 0.08, 18), gold, { p: [2.05, 2.92, 0.3], r: [PI / 2, 0, 0], tb: [0.6, 1.25] });
    star4(B, [2.05, 2.92, 0.36], [0, 0, 1], 0.14, glowC, true);
    B.ao = [0.62, 1.0];
    return { radius: 0, colliders: [{ x: -2.35, z: 0, r: 0.7 }, { x: 2.35, z: 0, r: 0.7 }] };
  } };

  // A great brass telescope fallen from its mount: the tube snapped, the lens end lying cracked on the floor.
  function jaggedTube(r0, r1, h, seg, amp, seed, inner) {
    var g = new T.CylinderGeometry(r1, r0, h, seg, 3, true), p = g.attributes.position, rr = seeded(seed);
    var off = []; for (var i = 0; i <= seg; i++) off.push((rr() - 0.3) * amp); off[seg] = off[0];
    for (var k = 0; k < p.count; k++) { var y = p.getY(k); if (y > h / 2 - 1e-4) { var ix = k % (seg + 1); p.setY(k, y + off[ix]); } }
    g.computeVertexNormals();
    return inner ? flipGeo(g) : g;
  }
  P.telescope_broken = { v: 2, build: function (B, r, o) {
    var brass = C(VBRASS), brassD = sh(brass, -0.35), st = C(o.color || pick(r, VSTONE)), glass = C('#a8ecff'), i, a;
    B.add(latheS([[1.05, 0], [1.05, 0.3], [0.96, 0.38], [0, 0.38]], 28), st, { tb: [0.65, 1.1], cf: courses(0.2, 0.05, 16) });
    B.add(G.cyl(0.78, 0.82, 0.16, 26), brassD, { p: [0, 0.46, 0], tb: [0.6, 1.2] });
    cogParts(B, 0.62, 26, 0.08, brass, brassD, null, { p: [0, 0.58, 0], r: [PI / 2, 0, 0] });
    [-1, 1].forEach(function (sx) { B.add(rbox(0.14, 1.15, 0.32, 0.03), brassD, { p: [sx * 0.56, 1.18, 0], r: [0, 0, sx * 0.06], tb: [0.6, 1.2] }); B.add(G.sph(0.11, 10, 8), brass, { p: [sx * 0.56, 1.72, 0], tb: [0.6, 1.2] }); });
    // the main tube, tilted up, snapped at the front
    var dir = [0, Math.sin(0.62), Math.cos(0.62)], tc = [0, 1.72, 0];
    function along(t) { return [tc[0] + dir[0] * t, tc[1] + dir[1] * t, tc[2] + dir[2] * t]; }
    B.add(jaggedTube(0.42, 0.37, 2.5, 22, 0.32, 7), brass, { p: along(0.5), dir: dir, tb: [0.6, 1.2], cn: 0.06 });
    B.add(jaggedTube(0.41, 0.36, 2.5, 22, 0.32, 7, true), '#1a1420', { p: along(0.5), dir: dir, noAO: true });
    [-0.55, 0.25, 1.05].forEach(function (t) { var tg = G.tor(0.43 - t * 0.02, 0.04, 5, 24); tg.rotateX(PI / 2); B.add(tg, brassD, { p: along(t), dir: dir, tb: [0.6, 1.2] }); });
    B.add(G.cyl(0.4, 0.4, 0.1, 22), brassD, { p: along(-0.76), dir: dir, tb: [0.6, 1.2] });
    B.add(G.cyl(0.08, 0.1, 0.36, 10), brass, { p: along(-0.95), dir: dir, tb: [0.6, 1.2] });
    B.add(G.cyl(0.05, 0.05, 1.5, 6), brassD, { p: [0, 1.72, 0], r: [0, 0, PI / 2] });
    // the fallen front section, lens cracked
    var fx = 0.9, fz = 2.35, fa = 0.6;
    var fdir = [Math.cos(fa), 0.02, Math.sin(fa)];
    B.add(jaggedTube(0.44, 0.4, 1.7, 22, 0.28, 11), brass, { p: [fx, 0.44, fz], dir: fdir, tb: [0.6, 1.2], cn: 0.06 });
    B.add(jaggedTube(0.43, 0.39, 1.7, 22, 0.28, 11, true), '#1a1420', { p: [fx, 0.44, fz], dir: fdir, noAO: true });
    var lens = [fx - fdir[0] * 0.86, 0.44, fz - fdir[2] * 0.86];
    var lg = G.tor(0.45, 0.05, 5, 26); lg.rotateX(PI / 2); B.add(lg, brassD, { p: lens, dir: [-fdir[0], 0, -fdir[2]], tb: [0.6, 1.2] });
    B.glow(G.cyl(0.41, 0.41, 0.02, 24), glass, { p: lens, dir: [-fdir[0], 0, -fdir[2]] });
    for (i = 0; i < 5; i++) { a = i * 1.3 + 0.4; B.add(G.box(0.014, 0.75, 0.012), '#3a4a58', { p: [lens[0] - fdir[0] * 0.02, 0.44 + Math.sin(a) * 0.1, lens[2] - fdir[2] * 0.02], r: [0, PI / 2 - fa, a], order: 'YXZ' }); }
    // scattered gears, glass shards and rubble
    [[1.8, -0.6, 0.32], [-1.4, 1.2, 0.24], [2.0, 1.1, 0.18], [-0.9, -1.5, 0.2]].forEach(function (q, n) { cogParts(B, q[2], 10 + n * 2, 0.05, n % 2 ? brassD : brass, brassD, null, { p: [q[0], 0.03, q[1]], r: [PI / 2 + (n % 2 ? 0.25 : 0), 0, n] }); });
    for (i = 0; i < 9; i++) { a = r() * TAU; var d = 1.1 + r() * 1.3; B.glow(G.oct(0.04 + r() * 0.04), glass, { p: [fx * 0.6 + Math.cos(a) * d, 0.03, fz * 0.6 + Math.sin(a) * d], s: [1, 0.3, 1.6], r: [0, r() * 3, 0] }); }
    for (i = 0; i < 5; i++) { a = r() * TAU; B.add(stoneGeo(0.12 + r() * 0.12, 1, r() * 30, 3), sh(st, (r() - 0.5) * 0.2), { p: [Math.cos(a) * 1.4, 0.06, Math.sin(a) * 1.4], tb: [0.62, 1.1] }); }
    B.ao = [0.62, 0.8];
    return { radius: 1.1, colliders: [{ x: 0, z: 0, r: 1.1 }, { x: 0.9, z: 2.35, r: 0.6 }] };   // literal numbers: tests/zones-check.js reads them (= fx, fz)
  } };

  // Tall tapered obelisk of dark stone with a gold pyramidion, columns of glowing star glyphs on every face,
  // and a little star hovering above the tip.
  P.obelisk = { v: 3, build: function (B, r, o) {
    var st = C(o.color || pick(r, ['#3a3350', '#352f4a', '#40385a'])), stD = sh(st, -0.3), gold = C(VGOLD), glowC = C(o.glow || pick(r, [VLT.cyan, VLT.violet, VLT.cyan]));
    var H = 5.0 + r() * 0.9, R0 = 0.64, R1 = 0.42, kinds = ['tri', 'eye', 'crescent', 'zig'];
    B.add(rbox(1.95, 0.3, 1.95, 0.06), stD, { p: [0, 0.15, 0], tb: [0.65, 1.1], cn: 0.08 });
    B.add(rbox(1.55, 0.3, 1.55, 0.05), st, { p: [0, 0.45, 0], tb: [0.65, 1.1] });
    B.add(rbox(1.6, 0.04, 1.6, 0.01), gold, { p: [0, 0.31, 0], tb: [0.6, 1.25] });
    B.add(latheS([[R0, 0], [R1, H]], 4), st, { p: [0, 0.6, 0], r: [0, PI / 4, 0], flat: true, tb: [0.72, 1.1], cf: courses(0.75, 0.04), cn: 0.06 });
    B.add(latheS([[R0 + 0.03, 0], [R0 + 0.03, 0.12], [R0, 0.14]], 4), gold, { p: [0, 0.6, 0], r: [0, PI / 4, 0], flat: true, tb: [0.6, 1.25] });
    B.add(G.cone(R1 * 1.04, 0.75, 4), gold, { p: [0, 0.6 + H + 0.375, 0], r: [0, PI / 4, 0], flat: true, tb: [0.6, 1.3] });
    [0, PI / 2, PI, -PI / 2].forEach(function (a, f) {
      for (var g = 0; g < 7; g++) {
        var y = 1.25 + g * (H - 1.4) / 7, rr = lerp(R0, R1, (y - 0.6) / H) * Math.cos(PI / 4) + 0.005;
        glyph(B, kinds[(g + f) % 4], [Math.sin(a) * rr, y, Math.cos(a) * rr], [Math.sin(a), 0.04, Math.cos(a)], 0.26, glowC);
      }
    });
    B.ao = [0.6, 1.2];
    return { radius: 0.95, tip: 0.6 + H + 1.15, glowC: glowC };
  }, extra: function (grp, rng, o, info) {
    var g = grp.children[0], sp = pivot(g, 0, info.tip, 0), SB = new Builder();
    star4(SB, [0, 0, 0], [0, 0, 1], 0.26, sh(info.glowC, 0.25), true);
    star4(SB, [0, 0, 0], [1, 0, 0], 0.2, sh(info.glowC, 0.25), true);
    var m = SB.build(); m.userData.noMeasure = true; sp.add(m);
    var h = halo(info.glowC, 1.8, 0.8); sp.add(h);
    var ph = rng() * 10;
    grp.userData.anim = function (t) { sp.position.y = info.tip + Math.sin(t * 1.3 + ph) * 0.12; sp.rotation.y = t * 0.6; var s = 1.8 * (1 + Math.sin(t * 2.2 + ph) * 0.12); h.scale.set(s, s, 1); };
  } };

  // ==================================================================
  // ---- v2.0 WS-E (story R8, plant B1): Aurelia's corner at the foot of the Spire.
  //  covered_portrait: a painting on a wooden easel under a heavy plum dust-cloth, one corner of the
  //    gilt frame peeking out. Faces +Z. Static. (Who is under the cloth is a later Book's business.)
  //  locked_door: a small iron-banded oak door set in a stone bay of the Spire's base, a heavy lock
  //    plate, a padlocked hasp and a chain. Faces +Z; the bay reaches back (-Z) into the tower wall.
  // ==================================================================
  P.covered_portrait = { v: 1, build: function (B, r, o) {
    var wood = C('#6e4226'), woodL = C('#94603a'), cloth = C(o.color || '#6a3a5e'), gold = C(GOLD), brass = C('#c99a3e');
    var TILT = -0.13, i;
    // easel: two front legs, a back prop leg, a ledge and a cross bar
    [-1, 1].forEach(function (sx) { B.add(rbox(0.09, 2.35, 0.08, 0.02), wood, { p: [sx * 0.52, 1.15, 0.12], r: [TILT, 0, sx * -0.09], tb: [0.7, 1.05], cf: grain('y', 18, 0.12) }); });
    B.add(rbox(0.08, 2.1, 0.07, 0.02), sh(wood, -0.1), { p: [0, 1.0, -0.42], r: [0.38, 0, 0], tb: [0.7, 1.05] });
    B.add(rbox(1.25, 0.08, 0.2, 0.02), woodL, { p: [0, 0.82, 0.24], r: [TILT, 0, 0], tb: [0.7, 1.1], cf: grain('x', 14, 0.1) });
    B.add(rbox(1.0, 0.06, 0.06, 0.02), wood, { p: [0, 2.12, 0.0], r: [TILT, 0, 0] });
    // the frame (mostly hidden) and one gilt corner showing at the lower left
    B.add(rbox(1.18, 1.42, 0.07, 0.02), sh(wood, -0.25), { p: [0, 1.6, 0.16], r: [TILT, 0, 0] });
    B.add(rbox(0.32, 0.09, 0.1, 0.02), gold, { p: [-0.47, 0.92, 0.27], r: [TILT, 0, 0], tb: [0.6, 1.3] });
    B.add(rbox(0.09, 0.3, 0.1, 0.02), gold, { p: [-0.6, 1.03, 0.25], r: [TILT, 0, 0], tb: [0.6, 1.3] });
    B.add(G.sph(0.045, 8, 6), sh(gold, 0.15), { p: [-0.6, 0.9, 0.3] });
    // the dust-cloth: a lumpy drape over the canvas, folds pooling at the hem, a cord + tassel
    B.add(bumpy(rbox(1.34, 1.5, 0.16, 0.06, 6), 0.035, 2.4, 3), cloth, { p: [0.04, 1.66, 0.2], r: [TILT, 0, 0.02], tb: [0.62, 1.1], cn: 0.06 });
    B.add(bumpy(G.sph(0.42, 14, 8), 0.04, 3, 5), sh(cloth, 0.06), { p: [0.02, 2.36, 0.12], s: [1.65, 0.38, 0.55], tb: [0.62, 1.12] });
    for (i = 0; i < 5; i++) {
      var fx = -0.42 + i * 0.24 + (r() - 0.5) * 0.06;
      B.add(G.cone(0.11, 0.42 + r() * 0.14, 6), sh(cloth, (r() - 0.5) * 0.12), { p: [fx + 0.06, 0.86, 0.33], r: [PI + 0.15, 0, (r() - 0.5) * 0.3], s: [1, 1, 0.5], tb: [0.6, 1.05] });
    }
    B.add(G.tor(0.36, 0.018, 4, 18, PI), brass, { p: [0.2, 1.98, 0.32], r: [TILT, 0, PI], tb: [0.6, 1.2] });
    B.add(G.cyl(0.012, 0.012, 0.42, 5), brass, { p: [0.56, 1.75, 0.33] });
    B.add(G.cone(0.05, 0.14, 7), sh(brass, -0.1), { p: [0.56, 1.5, 0.33], tb: [0.6, 1.2] });
    B.ao = [0.65, 1.15];
    return { radius: 0.6, colliders: [{ x: 0, z: 0, r: 0.55 }] };
  } };

  P.locked_door = { v: 1, build: function (B, r, o) {
    var stone = C(o.color || '#d6d0c2'), stD = sh(stone, -0.2), oak = C('#5a3720'), iron = C('#3a3644'), ironL = C('#5b5666'), gold = C(GOLD), brass = C('#b8893a');
    var i, FZ = 0.62;                           // door face z
    // stone bay (back into the tower wall), plinth, threshold step
    B.add(rbox(2.7, 3.5, 1.7, 0.06), stone, { p: [0, 1.75, -0.2], tb: [0.7, 1.1], cf: courses(0.5, 0.07), cn: 0.05 });
    B.add(rbox(2.9, 0.22, 1.9, 0.05), stD, { p: [0, 0.11, -0.15], tb: [0.65, 1.1] });
    B.add(rbox(1.5, 0.14, 0.5, 0.04), stone, { p: [0, 0.29, FZ + 0.15], tb: [0.65, 1.1] });
    B.add(rbox(2.8, 0.2, 1.8, 0.05), stD, { p: [0, 3.55, -0.18], tb: [0.65, 1.12] });
    B.add(rbox(2.82, 0.05, 1.82, 0.02), gold, { p: [0, 3.43, -0.18], tb: [0.6, 1.25] });
    // arched surround: jambs + a half-ring of voussoirs, a keystone with a small lantern sigil
    [-1, 1].forEach(function (sx) { B.add(rbox(0.3, 2.0, 0.3, 0.04), sh(stone, 0.06), { p: [sx * 0.78, 1.36, FZ], tb: [0.7, 1.1] }); });
    for (i = 0; i <= 6; i++) {
      var a = PI * i / 6;
      B.add(rbox(0.3, 0.24, 0.3, 0.04), sh(stone, 0.06 + (r() - 0.5) * 0.06), { p: [Math.cos(a) * 0.78, 2.36 + Math.sin(a) * 0.78, FZ], r: [0, 0, a - PI / 2], tb: [0.7, 1.1] });
    }
    B.add(rbox(0.3, 0.36, 0.34, 0.04), stD, { p: [0, 3.16, FZ + 0.02], tb: [0.7, 1.1] });
    B.add(G.oct(0.08), gold, { p: [0, 3.16, FZ + 0.2], s: [1, 1.5, 0.5] });
    // the door: oak planks under a round top, three iron straps, studs, ring pull
    for (i = 0; i < 5; i++) B.add(rbox(0.25, 1.98, 0.12, 0.03), sh(oak, (r() - 0.5) * 0.14), { p: [-0.5 + i * 0.25, 1.36, FZ - 0.08], cf: grain('y', 20, 0.14), tb: [0.75, 1.05] });
    B.add(G.cyl(0.63, 0.63, 0.12, 20, false), oak, { p: [0, 2.36, FZ - 0.08], r: [PI / 2, 0, 0], s: [1, 1, 1], tb: [0.75, 1.05] });
    [0.75, 1.55, 2.3].forEach(function (y) {
      B.add(rbox(1.26, 0.1, 0.05, 0.015), iron, { p: [0, y, FZ + 0.0], tb: [0.6, 1.15] });
      for (var s = 0; s < 5; s++) B.add(G.sph(0.03, 6, 4), ironL, { p: [-0.5 + s * 0.25, y, FZ + 0.03], s: [1, 1, 0.6] });
    });
    // lock plate + keyhole (a warm glint), hasp, padlock, and a chain looped across
    B.add(rbox(0.3, 0.42, 0.05, 0.02), ironL, { p: [0.36, 1.25, FZ + 0.04], tb: [0.6, 1.2] });
    B.add(G.cyl(0.035, 0.035, 0.06, 8), '#120f16', { p: [0.36, 1.3, FZ + 0.07], r: [PI / 2, 0, 0] });
    B.add(G.box(0.025, 0.07, 0.06), '#120f16', { p: [0.36, 1.25, FZ + 0.07] });
    B.glow(G.sph(0.022, 6, 4), '#ffcf7a', { p: [0.36, 1.3, FZ + 0.1] });
    B.add(G.tor(0.09, 0.022, 5, 12), iron, { p: [0.36, 1.06, FZ + 0.08], tb: [0.6, 1.2] });
    B.add(rbox(0.36, 0.08, 0.05, 0.015), iron, { p: [0.62, 1.55, FZ + 0.07] });
    B.add(G.tor(0.08, 0.02, 5, 12, PI), brass, { p: [0.76, 1.48, FZ + 0.1], r: [0, 0, PI], tb: [0.6, 1.25] });
    B.add(rbox(0.2, 0.22, 0.09, 0.03), brass, { p: [0.76, 1.33, FZ + 0.1], tb: [0.6, 1.25] });
    for (i = 0; i < 9; i++) {
      var u = i / 8, cx = -0.7 + u * 1.4, cy = 1.75 - Math.sin(u * PI) * 0.32;
      B.add(G.tor(0.06, 0.018, 4, 8), ironL, { p: [cx, cy, FZ + 0.14], r: [0, i % 2 ? PI / 2 : 0, 0], tb: [0.6, 1.2] });
    }
    [-1, 1].forEach(function (sx) { B.add(G.cyl(0.05, 0.05, 0.12, 8), iron, { p: [sx * 0.72, 1.75, FZ + 0.1], r: [PI / 2, 0, 0] }); });
    B.ao = [0.65, 1.2];
    return { radius: 1.4, colliders: [{ x: -0.7, z: -0.2, r: 0.9 }, { x: 0.7, z: -0.2, r: 0.9 }] };
  } };

  M.prop = function (type, opts) {
    need(); opts = opts || {};
    var rng = opts.rng || Math.random;
    var def = P[type];
    if (!def) { if (window.console) console.warn('WF.models.prop: unknown prop "' + type + '"'); def = P.rock; type = 'rock'; }
    var vi = Math.floor(rng() * def.v) % def.v;
    var lod = opts.lod && def.lod ? 1 : 0;      // lod 1: lighter build for far scenery (outside the playable square)
    var key = type + '|' + vi + '|' + (opts.color ? hx(opts.color) : '') + (lod ? '|L' : '');
    var entry = propCache[key];
    if (!entry) {
      var B = new PB();
      var info = def.build(B, seeded(hashStr(type) + vi * 7919), lod ? Object.assign({}, opts, { lod: 1 }) : opts) || {};
      entry = propCache[key] = { geos: B.geos(), info: info };
      ['s', 'g', 'e'].forEach(function (k) { if (entry.geos[k]) entry.geos[k].userData.sharedGeometry = true; });
    }
    var info2 = entry.info, geos = entry.geos;
    var grp = new T.Group(); grp.name = 'prop_' + type;
    var inner = pivot(grp), ms = [];
    if (geos.s) ms.push(new T.Mesh(geos.s, propMat()));
    if (geos.e) ms.push(new T.Mesh(geos.e, M.toon(0xffffff, { vc: true, flat: true, emissive: info2.emis || '#444444' })));
    ms.forEach(function (m) { m.castShadow = info2.shadow !== false; m.receiveShadow = true; });
    if (geos.g) ms.push(new T.Mesh(geos.g, vcGlowMat()));
    // propStatic: never animated -> the engine may fold it into a static batch even when the prop has an anim()
    ms.forEach(function (m) { m.userData.sharedGeometry = true; m.userData.propStatic = true; inner.add(m); });
    var s = 1;
    if (info2.jitter) { inner.rotation.y = rng() * TAU; s = 0.85 + rng() * 0.35; inner.scale.setScalar(s); }
    grp.userData.radius = (info2.radius || 0) * s;
    if (info2.colliders) grp.userData.colliders = info2.colliders.map(function (c) { return { x: c.x * s, z: c.z * s, r: c.r * s }; });
    grp.userData.type = type;
    if (def.extra) def.extra(grp, rng, opts, info2);
    return grp;
  };

  // ------------------------------------------------------------------
  //  Static scenery batching (used by world.js mergeStaticProps and tests/lab-props.html).
  //  Every static mesh (position/normal/color + index, single material) of the given props
  //  is merged per (cell, material, shadow flags) into one mesh. Animated props contribute
  //  their propStatic meshes (lantern posts, fountain stone, tower body...) while their
  //  moving parts stay separate. Vertices are baked into the parent's space.
  //  o = { cell: 24, noShadow: {type:1}, skip: Set(props), parent: Object3D }
  //  -> [mesh] (already added to parent); mesh.userData = { members, owners (prop per member), props }
  //  M.rebatch(batch, hiddenSet, parent) -> a mesh of the batch's members whose prop is NOT hidden
  //  (duels hide occluding props without falling back to one draw call per member).
  // ------------------------------------------------------------------
  M.mergeMeshes = function (list, toLocal) {
    var nv = 0, ni = 0;
    list.forEach(function (m) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; });
    var pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    var idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0, nm = new T.Matrix3(), mw = new T.Matrix4();
    list.forEach(function (m) {
      var g = m.geometry, pa = g.attributes.position.array, na = g.attributes.normal.array, ca = g.attributes.color.array, I = g.index, cnt = g.attributes.position.count, i;
      mw.copy(m.matrixWorld); if (toLocal) mw.premultiply(toLocal);
      nm.getNormalMatrix(mw);
      var e = mw.elements, q = nm.elements, o = vo * 3;
      for (i = 0; i < cnt * 3; i += 3) {
        var x = pa[i], y = pa[i + 1], z = pa[i + 2];
        pos[o + i] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[o + i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[o + i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        x = na[i]; y = na[i + 1]; z = na[i + 2];
        var nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nor[o + i] = nx / l; nor[o + i + 1] = ny / l; nor[o + i + 2] = nz / l;
        col[o + i] = ca[i]; col[o + i + 1] = ca[i + 1]; col[o + i + 2] = ca[i + 2];
      }
      var ia = I.array;
      for (i = 0; i < I.count; i++) idx[io + i] = ia[i] + vo;
      vo += cnt; io += I.count;
    });
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;                                   // per-zone (not shared): freed with the zone
  };
  function batchable(m) {
    if (!m.isMesh || Array.isArray(m.material) || !m.geometry.index) return false;
    var a = m.geometry.attributes;
    return !!(a.position && a.normal && a.color && Object.keys(a).length === 3);
  }
  M.rebatch = function (b, hidden, parent) {
    var keep = [], U = b.userData;
    for (var i = 0; i < U.members.length; i++) if (!hidden.has(U.owners[i])) keep.push(U.members[i]);
    if (!keep.length) return null;
    var toLocal = null;
    if (parent) { parent.updateMatrixWorld(true); toLocal = new T.Matrix4().copy(parent.matrixWorld).invert(); }
    var mesh = new T.Mesh(M.mergeMeshes(keep, toLocal), b.material);
    mesh.castShadow = b.castShadow; mesh.receiveShadow = b.receiveShadow; mesh.name = 'propBatchPart'; mesh.matrixAutoUpdate = false;
    if (parent) parent.add(mesh);
    return mesh;
  };
  M.batchStatic = function (props, o) {
    o = o || {};
    var CELLW = o.cell || 24, noSh = o.noShadow || {}, skip = o.skip, parent = o.parent, buckets = {}, out = [];
    var toLocal = null;
    if (parent) { parent.updateMatrixWorld(true); toLocal = new T.Matrix4().copy(parent.matrixWorld).invert(); }
    props.forEach(function (prop) {
      if (!prop || (skip && skip.has(prop)) || !prop.visible) return;
      var anim = !!prop.userData.anim, ns = !!noSh[prop.userData.type];
      var ck = Math.floor(prop.position.x / CELLW) + ',' + Math.floor(prop.position.z / CELLW);
      prop.updateMatrixWorld(true);
      prop.traverse(function (m) {
        if (!m.visible || !batchable(m) || (anim && !m.userData.propStatic)) return;
        var cast = m.castShadow && !ns, k = ck + '|' + m.material.uuid + '|' + (cast ? 1 : 0) + (m.receiveShadow ? 1 : 0);
        var b = buckets[k] || (buckets[k] = { meshes: [], owners: [], props: [], cast: cast, recv: m.receiveShadow, mat: m.material });
        b.meshes.push(m); b.owners.push(prop); if (b.props[b.props.length - 1] !== prop) b.props.push(prop);
      });
    });
    Object.keys(buckets).forEach(function (k) {
      var b = buckets[k]; if (b.meshes.length < 2) return;
      var mesh = new T.Mesh(M.mergeMeshes(b.meshes, toLocal), b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.name = 'propBatch'; mesh.matrixAutoUpdate = false;
      b.meshes.forEach(function (m) { m.visible = false; });
      mesh.userData.members = b.meshes; mesh.userData.owners = b.owners; mesh.userData.props = b.props;
      if (parent) parent.add(mesh);
      out.push(mesh);
    });
    return out;
  };

  // ==================================================================
  //  GROUND / SKY  (v1.1, agent R — render & environment)
  //  ground(zone): painterly splat terrain (tiled canvas textures from
  //    WF.textures §GROUND/SKY: zone grass/floor tile + path tile blended by a
  //    per-zone mask, anti-tiling + big low-frequency colour variation in the
  //    shader), soft hills outside the playable square, instanced grass blades
  //    and little flowers with wind sway in the vertex shader (density by tier).
  //  sky(zone): painted gradient dome, layered clouds, sun / moon / eclipse,
  //    stars, and distant hill / mountain / pine silhouettes (all in one shader).
  //  ambient(zone): one-draw-call ambient particles (pollen, fluff, fireflies,
  //    leaves, embers, ash, sparkles) wrapped around the camera.
  //  pool(r, color): painterly water disc (bogs, ponds).
  //  Falls back to the v1.0 vertex-colour ground if textures.js is missing.
  // ==================================================================
  function valueNoise(seed) {
    function h(ix, iz) { var n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
    function n2(x, z) {
      var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
      fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
      var a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    }
    return function (x, z) { return n2(x, z) * 0.65 + n2(x * 2.3 + 17, z * 2.3 - 9) * 0.35; };
  }
  function segDist(px, pz, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    var t = l2 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1) : 0;
    var x = a[0] + dx * t - px, z = a[1] + dz * t - pz;
    return Math.sqrt(x * x + z * z);
  }
  function envTX() { return window.WF && WF.textures && WF.textures.groundTile ? WF.textures : null; }
  var envTime = { value: 0 };
  function tickEnv() { envTime.value = (performance.now() / 1000) % 3600; }

  // Per-style look constants for the environment
  var ENV = {
    town:   { tintA: [1.1, 1.07, 0.86], tintB: [0.82, 0.92, 0.95], worn: 0.3, edge: 0.18, grass: 8000,  flowers: 1100, blades: 6, bladeH: 0.36, tall: 0.5, patch: [0.18, 0.5], wind: 0.10, gs: 1 / 5.5 },
    meadow: { tintA: [1.12, 1.06, 0.84], tintB: [0.8, 0.9, 0.95], worn: 0.6, edge: 0.24, grass: 10500, flowers: 1900, blades: 7, bladeH: 0.5,  tall: 0.9, patch: [0.2, 0.55], wind: 0.16, gs: 1 / 6 },
    forest: { tintA: [1.14, 1.1, 0.9], tintB: [0.78, 0.9, 1.08], worn: 0.5, edge: 0.26, grass: 8000,  flowers: 1300, blades: 6, bladeH: 0.44, tall: 0.8, patch: [0.3, 0.62], wind: 0.07, gs: 1 / 6.5 },
    ruins:  { tintA: [1.16, 1.0, 0.9],  tintB: [0.8, 0.8, 0.98], worn: 0.45, edge: 0.3, grass: 5000,  flowers: 550,  blades: 5, bladeH: 0.4,  tall: 0.7, patch: [0.45, 0.75], wind: 0.12, gs: 1 / 6 },
    // v1.2 WS6: polished star-tile floor, no vegetation, crisp inlaid walkways, cavern walls
    vault:  { tintA: [1.07, 1.03, 1.0], tintB: [0.9, 0.93, 1.06], worn: 0.0, edge: 0.0, grass: 0,     flowers: 0,    blades: 5, bladeH: 0.4,  tall: 0.0, patch: [0.5, 0.8],   wind: 0.0,  gs: 1 / 6 }
  };
  function envOf(style) { return ENV[style] || ENV.meadow; }

  // ---------- terrain splat shader (MeshToonMaterial + onBeforeCompile) ----------
  function groundCompile(shader) {
    var u = this.userData.gu;
    for (var k in u) shader.uniforms[k] = u[k];
    shader.vertexShader = 'varying vec3 vGW;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = [
      'varying vec3 vGW;',
      'uniform sampler2D tGrass; uniform sampler2D tPath; uniform sampler2D tNoise; uniform sampler2D tMask;',
      'uniform float uHalf; uniform float uGS; uniform float uPS; uniform vec3 uTintA; uniform vec3 uTintB;',
      'uniform vec3 uWorn; uniform vec3 uWet; uniform float uWornAmt; uniform float uEdge;',
      'uniform sampler2D tEmber; uniform float uEmber; uniform vec3 uEmberC; uniform float uTime; uniform float glowBoost;',
      // v1.2 WS6 (vault): uRough = path-edge roughness (0 = crisp inlay), uWall = cavern rock outside the floor,
      // uRim = gold border line along the walkways, uSheen = cool polished-stone sheen at grazing angles
      'uniform float uRough; uniform float uWall; uniform vec3 uWallC; uniform vec3 uWallC2; uniform float uRim; uniform vec3 uRimC; uniform float uSheen; uniform vec3 uSheenC;'
    ].join('\n') + '\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', [
      '#include <emissivemap_fragment>',
      '  totalEmissiveRadiance += emberGlow;',
      '  if (uSheen > 0.0) { float vf = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0); totalEmissiveRadiance += uSheenC * pow(vf, 2.5) * uSheen * (1.0 - wallK); }'
    ].join('\n')).replace('#include <map_fragment>', [
      '  vec2 wp = vGW.xz;',
      '  vec4 nz = texture2D(tNoise, wp * 0.0105);',
      '  vec4 nd = texture2D(tNoise, wp * 0.087 + vec2(0.31, 0.77));',
      '  vec2 ra = vec2(wp.x * 0.8 - wp.y * 0.6, wp.x * 0.6 + wp.y * 0.8);',
      '  vec3 g1 = texture2D(tGrass, wp * uGS).rgb;',
      '  vec3 g2 = texture2D(tGrass, ra * uGS * 0.41 + 0.37).rgb;',
      '  vec3 grass = mix(g1, g2, smoothstep(0.3, 0.7, nz.g) * 0.6);',
      // far away the painted tile fades to its mean colour (no visible repeats); the big tints remain
      '  vec3 gAvg = texture2D(tGrass, vec2(0.5), 12.0).rgb;',
      '  grass = mix(grass, gAvg * (0.85 + 0.3 * nd.g), smoothstep(22.0, 75.0, distance(vGW, cameraPosition)) * 0.75);',
      '  grass *= mix(uTintB, uTintA, smoothstep(0.22, 0.78, nz.r));',
      '  grass *= 0.84 + 0.32 * nz.a;',
      '  vec3 mk = texture2D(tMask, (wp + uHalf) / (2.0 * uHalf)).rgb;',
      '  float rough = ((nd.b - 0.5) * 0.5 + (texture2D(tNoise, wp * 0.41).g - 0.5) * 0.3) * uRough;',
      '  float pc = mk.r + rough * smoothstep(0.02, 0.3, mk.r);',
      '  float pw = smoothstep(0.42, 0.55, pc);',
      '  vec3 pth = texture2D(tPath, wp * uPS).rgb * (0.9 + 0.2 * nz.b);',
      '  float worn = clamp(mk.g * (0.45 + 0.7 * nd.a), 0.0, 1.0) * uWornAmt;',
      '  vec3 gcol = mix(grass, uWorn * (0.82 + 0.36 * nd.r), worn * (1.0 - pw));',
      '  gcol = mix(gcol, gcol * uWet, smoothstep(0.1, 0.8, mk.b));',
      '  gcol *= 1.0 - smoothstep(0.2, 0.44, pc) * (1.0 - pw) * uEdge;',
      '  gcol = mix(gcol, pth, pw);',
      '  float wallK = 0.0;',
      '  if (uRim > 0.0) { float rim = smoothstep(0.3, 0.36, pc) * (1.0 - smoothstep(0.4, 0.46, pc)); gcol = mix(gcol, uRimC * (0.85 + 0.3 * nd.r), rim * uRim); }',
      '  if (uWall > 0.0) {',
      '    wallK = smoothstep(0.12, 1.1, vGW.y) * uWall;',
      '    vec3 rock = mix(uWallC, uWallC2, smoothstep(0.3, 0.7, nz.g)) * (0.72 + 0.5 * nd.b) * (0.9 + 0.2 * texture2D(tNoise, wp * 0.33 + vGW.y * 0.2).r);',
      '    gcol = mix(gcol, rock, wallK);',
      '  }',
      '  diffuseColor.rgb *= gcol;',
      '  vec3 emberGlow = vec3(0.0);',
      '  if (uEmber > 0.0) {',
      '    float ev = texture2D(tEmber, wp * uGS * 0.55 + 0.13).r * smoothstep(0.52, 0.7, nz.g) * (1.0 - smoothstep(0.1, 0.4, pc)) * (1.0 - mk.b) * (1.0 - wallK * 0.7);',
      '    float pulse = 0.65 + 0.35 * sin(uTime * 1.3 + nz.r * 20.0 + wp.x * 0.15);',
      '    emberGlow = uEmberC * ev * pulse * uEmber * glowBoost;',
      '    diffuseColor.rgb = mix(diffuseColor.rgb, uEmberC * 0.08, ev * 0.6);',
      '  }'
    ].join('\n'));
  }

  // ---------- grass / flower shader (MeshToonMaterial + onBeforeCompile) ----------
  function vegCompile(shader) {
    var u = this.userData.vu;
    for (var k in u) shader.uniforms[k] = u[k];
    shader.uniforms.glowBoost = M.glowBoost;
    shader.vertexShader = [
      'uniform float uTime; uniform float uWind; uniform vec2 uFade; uniform float uBox; uniform float uBound; uniform float uHalf; uniform vec2 uBoxC;',
      'uniform vec2 uPatch; uniform float uTall; uniform sampler2D tMask; uniform sampler2D tNoise;',
      '#ifdef VEG_FLOWER', 'attribute float aPetal; varying float vPetal;', '#endif'
    ].join('\n') + '\n' + shader.vertexShader
      .replace('#include <color_vertex>', [
        '#ifdef USE_COLOR',
        '  vColor = color.xyz;',
        '#endif',
        '#ifdef USE_INSTANCING_COLOR',
        '  #ifdef VEG_FLOWER',
        '    vColor.xyz = mix(vColor.xyz, vColor.xyz * instanceColor.xyz, aPetal); vPetal = aPetal;',
        '  #else',
        '    vColor.xyz *= instanceColor.xyz;',
        '  #endif',
        '#endif'].join('\n'))
      .replace('#include <project_vertex>', [
        '  vec4 mvPosition = vec4(transformed, 1.0);',
        '  vec3 ip = vec3(0.0);',
        '#ifdef USE_INSTANCING',
        '  mvPosition = instanceMatrix * mvPosition;',
        '  ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        '#endif',
        // wrap the instance into a box that follows the camera (constant density near the player)
        '  vec2 wp = mod(ip.xz - uBoxC + uBox * 0.5, uBox) - uBox * 0.5 + uBoxC;',
        '  mvPosition.xz += wp - ip.xz; ip.xz = wp;',
        // where it grows: off paths, outside keep-clear spots, inside the playable square, in noisy patches
        '  vec4 mk = texture2D(tMask, (wp + uHalf) / (2.0 * uHalf));',
        '#ifdef VEG_FLOWER',
        '  float pn = texture2D(tNoise, wp * 0.021 + vec2(0.61, 0.13)).r;',
        '  float keep = (1.0 - smoothstep(0.05, 0.2, mk.r)) * smoothstep(0.6, 1.0, mk.a) * smoothstep(uPatch.x, uPatch.y, pn);',
        '#else',
        '  float pn = texture2D(tNoise, wp * 0.012 + vec2(0.21, 0.47)).g;',
        '  float keep = (1.0 - smoothstep(0.12, 0.32, mk.r)) * smoothstep(0.5, 1.0, mk.a) * smoothstep(uPatch.x, uPatch.y, pn) * (1.0 - mk.g * 0.35);',
        '  mvPosition.y *= 0.55 + uTall * smoothstep(0.35, 0.85, pn);',
        '#endif',
        '  keep *= step(abs(wp.x), uBound) * step(abs(wp.y), uBound);',
        '  float hh = max(position.y, 0.0);',
        '  vec2 wd = vec2(sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.17) + 0.45 * sin(uTime * 3.1 + ip.x * 0.9 - ip.z * 0.7),',
        '                 0.6 * sin(uTime * 1.3 + ip.z * 0.29 - ip.x * 0.11));',
        '  float gust = sin(uTime * 0.5 - (ip.x + ip.z * 0.7) * 0.05) * 0.5 + 0.5;',
        '  mvPosition.xz += wd * hh * hh * uWind * (0.4 + gust * 1.1);',
        '  float fade = (1.0 - smoothstep(uFade.x, uFade.y, distance(ip.xz, cameraPosition.xz))) * keep;',
        '  mvPosition.xyz = ip + (mvPosition.xyz - ip) * fade;',
        '  mvPosition = modelViewMatrix * mvPosition;',
        '  gl_Position = projectionMatrix * mvPosition;'].join('\n'));
    shader.fragmentShader = [
      'uniform float uFlowerGlow; uniform float glowBoost;',
      '#ifdef VEG_FLOWER', 'varying float vPetal;', '#endif'
    ].join('\n') + '\n' + shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '  float faceDirection = 1.0;\n  vec3 normal = normalize(vNormal);\n  vec3 geometryNormal = normal;')
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        '#ifdef VEG_FLOWER',
        '  totalEmissiveRadiance += vColor.rgb * vPetal * uFlowerGlow * glowBoost;',
        '#endif'].join('\n'));
  }
  function vegMaterial(flower, u) {
    var m = new T.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, vertexColors: true, side: T.DoubleSide });
    if (flower) m.defines = { VEG_FLOWER: '' };
    m.userData.vu = u;
    m.onBeforeCompile = vegCompile;
    return m;
  }
  // A clump of tapered, curved blades. Normals point up (lit like the ground);
  // vertex colour runs dark at the root -> bright at the tip.
  function grassClumpGeo(nBlades, H, seed) {
    var r = seeded(seed), pos = [], nor = [], colr = [], idx = [], v = 0;
    for (var b = 0; b < nBlades; b++) {
      var a = r() * TAU, ro = Math.sqrt(r()) * 0.16, bx = Math.cos(a) * ro, bz = Math.sin(a) * ro;
      var fa = r() * TAU, lean = 0.12 + r() * 0.22, h = H * (0.55 + r() * 0.6), w = 0.035 + r() * 0.03;
      var dx = Math.cos(fa), dz = Math.sin(fa), px = -dz, pz = dx;          // lean dir + blade width dir
      var rows = [[0, 1], [0.38, 0.85], [0.72, 0.55]];
      for (var k = 0; k < rows.length; k++) {
        var t = rows[k][0], ww = w * rows[k][1], bend = lean * t * t * h * 1.6;
        var cx = bx + dx * bend, cz = bz + dz * bend, cy = h * t;
        var shade = 0.62 + 0.5 * t;
        pos.push(cx - px * ww, cy, cz - pz * ww, cx + px * ww, cy, cz + pz * ww);
        for (var q = 0; q < 2; q++) { nor.push(0, 1, 0); colr.push(shade * 0.96, shade, shade * 0.9); }
      }
      var tb = lean * h * 1.6;
      pos.push(bx + dx * tb, h, bz + dz * tb); nor.push(0, 1, 0); colr.push(1.18, 1.22, 1.0);
      idx.push(v, v + 1, v + 3, v, v + 3, v + 2, v + 2, v + 3, v + 5, v + 2, v + 5, v + 4, v + 4, v + 5, v + 6);
      v += 7;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  // Little flower: crossed stem + tilted 5-petal star + centre. aPetal = 1 on petals.
  function flowerGeo(style) {
    var pos = [], nor = [], colr = [], pet = [], idx = [], v = 0;
    var stemC = style === 'ruins' ? [0.32, 0.3, 0.22] : [0.3, 0.55, 0.24], H = style === 'forest' ? 0.3 : 0.26;
    for (var s = 0; s < 2; s++) {
      var a = s * PI / 2, cx = Math.cos(a) * 0.012, cz = Math.sin(a) * 0.012;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx * 0.6, H, cz * 0.6, -cx * 0.6, H, -cz * 0.6);
      for (var q = 0; q < 4; q++) { nor.push(0, 1, 0); colr.push(stemC[0], stemC[1], stemC[2]); pet.push(0); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    }
    var R0 = style === 'forest' ? 0.075 : 0.06, R1 = R0 * 0.42, c0 = v, tilt = 0.25;
    function P(x, z) { return [x, H + z * tilt, z]; }
    var ce = P(0, 0); pos.push(ce[0], ce[1] + 0.012, ce[2]); nor.push(0, 1, 0); colr.push(1.0, 0.86, 0.3); pet.push(0); v++;
    for (var i = 0; i < 10; i++) {
      var ang = i / 10 * TAU, rr = i % 2 ? R1 : R0, p = P(Math.cos(ang) * rr, Math.sin(ang) * rr);
      pos.push(p[0], p[1], p[2]); nor.push(0, 1, 0);
      if (i % 2) { colr.push(1, 1, 1); pet.push(1); } else { colr.push(1, 1, 1); pet.push(1); }
      v++;
    }
    for (var j = 0; j < 10; j++) idx.push(c0, c0 + 1 + j, c0 + 1 + (j + 1) % 10);
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    g.setAttribute('aPetal', new T.Float32BufferAttribute(pet, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  // Rough keep-clear radius of hand-placed props (so blades don't poke through floors/water)
  var CLEAR_R = { house: 4.2, tower: 5.5, fountain: 3.6, well: 1.6, stall: 2.2, tent: 2.4, statue: 1.6, arch: 1.4, ruin_wall: 1.0, campfire: 1.3, pillar: 0.9, pillar_broken: 1.0 };

  M.ground = function (zone) {
    need(); zone = zone || {};
    var TX = envTX();
    if (!TX) return groundV10(zone);
    var size = zone.size || 45, S = 2 * size + 40, H = S / 2;
    var style = zone.style || 'meadow', E = envOf(style);
    var g1 = C(zone.ground || '#6fae5a'), g2 = C(zone.ground2 || sh(g1, -0.12)), pathC = C(zone.path || '#c9b48a');
    var noise = valueNoise((zone.seed || 1) | 0);
    var rng = seeded(((zone.seed || 1) * 31 + 7) >>> 0);
    var pw = style === 'town' ? 1.9 : 1.6;
    var root = new T.Group(); root.name = 'ground';

    // --- terrain: flat inside the playable square, soft rolling hills outside it
    var seg = 128, geo = new T.PlaneGeometry(S, S, seg, seg); geo.rotateX(-PI / 2);
    var pos = geo.attributes.position, colA = new Float32Array(pos.count * 3);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var out = Math.max(Math.abs(x), Math.abs(z)) - (size + 2), y = 0;
      if (out > 0 && style === 'vault') y = Math.pow(out, 1.35) * (0.55 + noise(x * 0.05 + 40, z * 0.05) * 0.7) + noise(x * 0.22, z * 0.22) * Math.min(out, 3) * 0.6;   // v1.2 WS6: cavern walls
      else if (out > 0) y = Math.pow(out, 1.12) * (0.16 + noise(x * 0.04 + 40, z * 0.04) * 0.4) + noise(x * 0.14, z * 0.14) * Math.min(out, 4) * 0.22;
      pos.setY(i, y);
      var f = 1 - clamp(out / 16, 0, 1) * 0.28;                    // hills darken + cool toward the rim
      colA[i * 3] = f * 0.97; colA[i * 3 + 1] = f; colA[i * 3 + 2] = f * (1 + (1 - f) * 0.4);
    }
    geo.setAttribute('color', new T.BufferAttribute(colA, 3));
    geo.computeVertexNormals();
    var clear = [];        // keep-clear spots for vegetation (hand-placed props, pools, portals)
    (zone.props || []).forEach(function (p) { var r0 = CLEAR_R[p.type]; if (r0) clear.push([p.pos[0], p.pos[1], r0 * (p.scale || 1)]); });
    (zone.pools || []).forEach(function (p) { clear.push([p.pos[0], p.pos[1], p.r + 0.4]); });
    (zone.portals || []).forEach(function (p) { clear.push([p.pos[0], p.pos[1], 2.6]); });
    var mask = TX.groundMask(zone, H, pw, clear);
    var worn = style === 'town' ? mix(pathC, g2, 0.55) : style === 'ruins' ? sh(mix(pathC, g1, 0.4), -0.1) : sh(mix(pathC, g2, 0.35), -0.08);
    var vault = style === 'vault';   // v1.2 WS6
    var gu = {
      tGrass: { value: TX.groundTile(style, g1, g2) }, tPath: { value: TX.pathTile(style, pathC) },
      tNoise: { value: TX.noise() }, tMask: { value: mask.tex },
      uHalf: { value: H }, uGS: { value: E.gs }, uPS: { value: style === 'ruins' ? 1 / 5 : 1 / 4 },
      uTintA: { value: new T.Vector3().fromArray(E.tintA) }, uTintB: { value: new T.Vector3().fromArray(E.tintB) },
      uWorn: { value: worn }, uWet: { value: style === 'ruins' ? C('#8a7a90') : C('#7f8f88') }, uWornAmt: { value: E.worn }, uEdge: { value: E.edge },
      tEmber: { value: style === 'ruins' ? TX.emberTile() : style === 'forest' ? TX.glowMossTile() : vault && TX.starFloorTile ? TX.starFloorTile() : TX.noise() },
      uEmber: { value: style === 'ruins' ? 1.0 : style === 'forest' ? 1.15 : vault ? 1.1 : 0.0 },
      uEmberC: { value: style === 'forest' ? new T.Vector3(0.3, 0.95, 0.85) : vault ? new T.Vector3(0.62, 0.86, 1.1) : new T.Vector3(1.0, 0.36, 0.08) },
      uTime: envTime, glowBoost: M.glowBoost,
      // v1.2 WS6 (vault): crisp gold-rimmed walkways, polished sheen, cavern rock beyond the floor
      uRough: { value: vault ? 0.0 : 1.0 }, uWall: { value: vault ? 1.0 : 0.0 },
      uWallC: { value: vault ? sh(mix(g2, '#2a2236', 0.5), -0.15) : C('#000000') }, uWallC2: { value: vault ? sh(mix(g1, '#4a3a62', 0.4), -0.05) : C('#000000') },
      uRim: { value: vault ? 1.0 : 0.0 }, uRimC: { value: vault ? sh(pathC, 0.18) : C('#000000') },
      uSheen: { value: vault ? 0.32 : 0.0 }, uSheenC: { value: vault ? mix(zone.sky || '#7a6aa8', '#9ab8ff', 0.5) : C('#000000') }
    };
    var tm = new T.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, vertexColors: true });
    tm.userData.gu = gu;
    tm.onBeforeCompile = groundCompile;
    var terrain = new T.Mesh(geo, tm);
    terrain.receiveShadow = true; terrain.name = 'terrain';
    terrain.onBeforeRender = tickEnv;
    terrain.userData.dispose = function () { mask.tex.dispose(); };
    root.add(terrain);
    root.userData.mask = mask;

    // --- grass blades + flowers: a fixed set of instances wrapped around the camera in the
    //     vertex shader; the mask (paths, keep-clear spots) and noise patches decide where they grow.
    var dens = M.envDensity || { grass: 1 };
    if (!E.grass) return root;   // v1.2 WS6: no vegetation (vault floors)
    var BOX = 72, vu = {
      uBoxC: { value: new T.Vector2() },
      uTime: envTime, uWind: { value: E.wind }, uFade: { value: new T.Vector2(27, 38) }, uFlowerGlow: { value: 0 },
      uBox: { value: BOX }, uBound: { value: size + 1.5 }, uHalf: { value: H }, uTall: { value: E.tall },
      uPatch: { value: new T.Vector2(E.patch[0], E.patch[1]) }, tMask: { value: mask.tex }, tNoise: { value: TX.noise() }
    };
    var clump = grassClumpGeo(E.blades, E.bladeH, 17 + style.length);
    var maxN = E.grass, grass = new T.InstancedMesh(clump, vegMaterial(false, vu), maxN);
    var mm = new T.Matrix4(), q = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), vP = new T.Vector3(), vS = new T.Vector3(), tc = new T.Color();
    var gBase = style === 'ruins' ? mix('#8a7a52', g1, 0.35) : style === 'forest' ? sh(mix(g1, '#5f9a64', 0.3), 0.04) : sh(g1, 0.02);
    var gAlt = style === 'ruins' ? mix('#6e6a48', g2, 0.3) : style === 'town' ? sh(g2, 0.06) : mix(g1, '#c8c060', style === 'meadow' ? 0.32 : 0.12);
    for (var gi = 0; gi < maxN; gi++) {
      var sc = 0.75 + rng() * 0.55;
      q.setFromAxisAngle(UP, rng() * TAU);
      mm.compose(vP.set((rng() - 0.5) * BOX, 0, (rng() - 0.5) * BOX), q, vS.set(sc, sc * (0.8 + rng() * 0.45), sc));
      grass.setMatrixAt(gi, mm);
      tc.copy(gBase).lerp(gAlt, rng() * 0.85).multiplyScalar(0.9 + rng() * 0.2);
      grass.setColorAt(gi, tc);
    }
    grass.userData.max = maxN;
    grass.count = Math.max(1, Math.floor(maxN * dens.grass));
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.receiveShadow = true; grass.castShadow = false; grass.frustumCulled = false; grass.name = 'grass';
    // the wrap box sits ahead of the camera so (almost) every instance is in view
    var _cf = new T.Vector3();
    grass.onBeforeRender = function (r, sc, cam) {
      tickEnv();
      cam.getWorldDirection(_cf); _cf.y = 0;
      if (_cf.lengthSq() < 1e-6) _cf.set(0, 0, -1); else _cf.normalize();
      vu.uBoxC.value.set(cam.position.x + _cf.x * BOX * 0.24, cam.position.z + _cf.z * BOX * 0.24);
    };
    grass.userData.applyDensity = function (d) { grass.count = Math.max(1, Math.floor(grass.userData.max * (d ? d.grass : 1))); };
    root.add(grass);

    // little flowers in drifts (forest: softly glowing bluebells; ruins: hollow-violet blooms)
    var fu = Object.assign({}, vu, { uPatch: { value: new T.Vector2(0.5, 0.72) } });
    var fN = E.flowers, fl = new T.InstancedMesh(flowerGeo(style), vegMaterial(true, fu), fN);
    var FC = style === 'forest' ? ['#7fd8ff', '#9fb8ff', '#c9a8ff', '#7fffd0'] : style === 'ruins' ? ['#c78bff', '#ff8a5a', '#a879ff'] :
      style === 'town' ? ['#ffffff', '#fff1a0', '#ffd0e0', '#ffe066'] : ['#ffffff', '#ffe066', '#ff9ec0', '#c6a8ff', '#ff8a5a', '#fff3c4'];
    if (style === 'forest') vu.uFlowerGlow.value = 0.55; else if (style === 'ruins') vu.uFlowerGlow.value = 0.7;
    for (var fi = 0; fi < fN; fi++) {
      var fs = 0.8 + rng() * 0.6;
      q.setFromAxisAngle(UP, rng() * TAU);
      mm.compose(vP.set((rng() - 0.5) * BOX, 0, (rng() - 0.5) * BOX), q, vS.set(fs, fs * (0.8 + rng() * 0.6), fs));
      fl.setMatrixAt(fi, mm);
      tc.set(FC[Math.floor(rng() * FC.length)]);
      fl.setColorAt(fi, tc);
    }
    fl.userData.max = fN;
    fl.count = Math.max(1, Math.floor(fN * Math.min(1, dens.grass * 1.4)));
    fl.instanceMatrix.needsUpdate = true;
    if (fl.instanceColor) fl.instanceColor.needsUpdate = true;
    fl.receiveShadow = true; fl.castShadow = false; fl.frustumCulled = false; fl.name = 'flowers';
    fl.onBeforeRender = tickEnv;
    fl.userData.applyDensity = function (d) { fl.count = Math.max(1, Math.floor(fl.userData.max * Math.min(1, (d ? d.grass : 1) * 1.4))); };
    root.add(fl);
    return root;
  };

  // v1.0 ground (used when textures.js is not loaded, e.g. older test pages)
  function groundV10(zone) {
    var size = zone.size || 45, S = 2 * size + 40, seg = 72;
    var style = zone.style || 'meadow';
    var g1 = C(zone.ground || '#6fae5a'), g2 = C(zone.ground2 || sh(g1, -0.12)), pathC = C(zone.path || '#c9b48a');
    var noise = valueNoise((zone.seed || 1) | 0);
    var paths = zone.paths || [];
    var pw = style === 'town' ? 1.9 : 1.6;
    function pathDist(x, z) {
      var d = 1e9;
      for (var i = 0; i < paths.length; i++) for (var j = 0; j < paths[i].length - 1; j++) d = Math.min(d, segDist(x, z, paths[i][j], paths[i][j + 1]));
      return d;
    }
    var root = new T.Group(); root.name = 'ground';
    var geo = new T.PlaneGeometry(S, S, seg, seg); geo.rotateX(-PI / 2);
    var pos = geo.attributes.position, col = new Float32Array(pos.count * 3), tmp = new T.Color();
    var edge = sh(g2, -0.15);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var n = noise(x * 0.09, z * 0.09);
      var out = Math.max(Math.abs(x), Math.abs(z)) - (size + 2);
      var y = 0;
      if (out > 0) y = Math.pow(out, 1.25) * (0.35 + noise(x * 0.05 + 40, z * 0.05) * 0.5);
      pos.setY(i, y);
      tmp.copy(g1).lerp(g2, smooth(0.3, 0.7, n));
      if (out > 0) tmp.lerp(edge, clamp(out / 14, 0, 0.6));
      var pd = paths.length ? pathDist(x, z) : 99;
      if (pd < pw) tmp.copy(pathC); else if (pd < pw + 1.6) tmp.lerp(sh(pathC, -0.25), (1 - smooth(pw, pw + 1.6, pd)) * 0.35);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    var terrain = new T.Mesh(geo, vcMat(false));
    terrain.receiveShadow = true; terrain.name = 'terrain';
    root.add(terrain);
    return root;
  }

  // ---------- sky ----------
  // Distant silhouette heights (sin(elevation)) around the horizon, per style, baked into a
  // 2048x1 texture (R = far ridge, G = mid, B = near; value * 0.32). Cached per style.
  function ridgeTex(style) {
    return ctex('ridge_' + style, function () {
      function fr(x) { return x - Math.floor(x); }
      function h1(n) { return fr(Math.sin(n * 12.9898 + 4.1414) * 43758.5453); }
      function n1(x, per, sd) { var i = Math.floor(x), f = x - i; f = f * f * (3 - 2 * f); return h1((i % per) + sd) * (1 - f) + h1(((i + 1) % per) + sd) * f; }
      function fbm1(az, per, sd) { var v = 0, a = 0.5, s2 = 0; for (var o = 0; o < 5; o++) { v += a * n1(az * per, per, sd); s2 += a; per *= 2; a *= 0.5; } return v / s2; }
      function sm(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
      function pines(az, N, sd, base, hv) {
        var x = az * N, i = Math.floor(x), best = 0;
        for (var j = -1; j <= 1; j++) {
          var id = ((i + j) % N + N) % N, cx = i + j + 0.5 + (h1(id + sd) - 0.5) * 0.7, w = 0.5 + h1(id * 1.7 + sd) * 0.55;
          var th = base + hv * (0.35 + h1(id * 3.1 + sd) * 0.65), k = Math.max(0, 1 - Math.abs(x - cx) / w);
          best = Math.max(best, th * k * (fr(k * 4) >= 0.5 ? 1 : 0.92));
        }
        return best;
      }
      function spires(az, N, sd, hgt) {
        var x = az * N, i = Math.floor(x), f = x - i, id = i % N;
        if (h1(id + sd) < 0.72) return 0;
        var w = 0.08 + h1(id * 2.3 + sd) * 0.08, c = 0.3 + h1(id * 5.1 + sd) * 0.4, x2 = Math.abs(f - c) / w;
        if (x2 > 1) return 0;
        var top = hgt * (0.55 + h1(id * 7.7 + sd) * 0.45), body = top * 0.72 * (1 - x2 * 0.18), roof = top * (1 - x2);
        var broken = h1(id * 9.3 + sd) > 0.5 ? top * (0.62 + (fr(x2 * 2 + 0.2) >= 0.3 ? 0.12 : 0)) : 1e3;
        return Math.min(Math.max(body, roof), broken);
      }
      var N = 2048, d = new Uint8Array(N * 4);
      for (var k = 0; k < N; k++) {
        var az = k / N, far, mid, near;
        if (style === 'town') { far = 0.06 + 0.13 * Math.pow(fbm1(az, 6, 1), 1.4); mid = 0.035 + 0.07 * fbm1(az, 9, 7); near = 0.02 + 0.045 * fbm1(az, 14, 3); }
        else if (style === 'forest') { far = 0.07 + 0.14 * Math.pow(fbm1(az, 5, 4), 1.3); mid = pines(az, 150, 1, 0.045 + 0.035 * fbm1(az, 6, 2), 0.07); near = pines(az, 95, 5, 0.03 + 0.025 * fbm1(az, 9, 8), 0.085); }
        else if (style === 'ruins') { var jj = fbm1(az, 7, 3); far = 0.06 + 0.15 * (1 - Math.abs(jj * 2 - 1)); mid = Math.max(0.035 + 0.08 * Math.pow(fbm1(az, 11, 6), 1.2), spires(az, 30, 2, 0.2)); near = 0.02 + 0.05 * (1 - Math.abs(fbm1(az, 15, 4) * 2 - 1)); }
        else if (style === 'vault') { far = 0.12 + 0.14 * fbm1(az, 9, 12) + pines(az, 70, 3, 0.0, 0.07); mid = Math.max(0.05 + 0.07 * fbm1(az, 13, 4), spires(az, 24, 5, 0.36)); near = 0.025 + 0.05 * Math.pow(fbm1(az, 17, 9), 2) + pines(az, 44, 7, 0.0, 0.075); }   // v1.2 WS6: cavern walls, stalagmites, observatory columns
        else { far = 0.05 + 0.16 * Math.pow(fbm1(az, 5, 2), 1.6); mid = 0.03 + 0.08 * sm(0, 1, fbm1(az, 8, 5)); near = 0.015 + 0.05 * sm(0.1, 0.9, fbm1(az, 12, 9)); }
        d[k * 4] = Math.round(clamp(far / 0.32, 0, 1) * 255); d[k * 4 + 1] = Math.round(clamp(mid / 0.32, 0, 1) * 255);
        d[k * 4 + 2] = Math.round(clamp(near / 0.32, 0, 1) * 255); d[k * 4 + 3] = 255;
      }
      var t = new T.DataTexture(d, N, 1, T.RGBAFormat);
      t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping;
      t.minFilter = T.LinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    });
  }
  var SKY_STYLE = { town: 0, meadow: 1, forest: 2, ruins: 3 };
  M.sky = function (zone) {
    need(); zone = zone || {};
    if (zone.style === 'vault') return vaultSky(zone);   // v1.2 WS6
    var style = zone.style || 'meadow', TX = envTX();
    var top = C(zone.skyTop || '#4a8fe0'), sky = C(zone.sky || '#9fd4ff'), fog = C(zone.fog || zone.sky || '#bfe3ff'), sunC = C(zone.sun || '#fff1d0');
    var gr = C(zone.ground || '#6fae5a');
    var night = style === 'forest' || style === 'ruins';
    // silhouette layers: far (hazy) -> near (darker, a little ground colour)
    var dark = style === 'ruins' ? C('#1c0c22') : style === 'forest' ? C('#141c30') : mix(top, gr, 0.5).multiplyScalar(0.55);
    var k0 = { town: 0.1, meadow: 0.1, forest: 0.32, ruins: 0.3 }[style] || 0.12;
    var r0 = mix(fog, sky, 0.4).lerp(dark, k0);
    var r1 = mix(fog, dark, k0 * 1.6).lerp(gr, night ? 0.03 : 0.06);
    var r2 = mix(fog, dark, k0 * 2.3).lerp(gr, night ? 0.05 : 0.1);
    var az = Math.atan2(14, 22), el = { town: 0.42, meadow: 0.16, forest: 0.5, ruins: 0.07 }[style] || 0.3;
    var sunDir = new T.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    var cfg = {
      // v1.1 polish (B14): cloud tops a touch below white so bright-zone up-shots don't bloom to cream
      town:   { disc: 1, size: 0.035, glow: 0.8, stars: 0, cover: 0.55, clouds: 1.0, lit: '#f3f7fc', shade: mix('#ffffff', top, 0.3) },
      meadow: { disc: 1, size: 0.045, glow: 0.75, stars: 0, cover: 0.52, clouds: 1.0, lit: mix('#f3f5f8', sunC, 0.12), shade: mix(sky, top, 0.45).lerp(C('#f4f8ff'), 0.35) },
      forest: { disc: 2, size: 0.05, glow: 0.45, stars: 0.6, cover: 0.58, clouds: 0.75, lit: mix(sky, '#ffffff', 0.35), shade: mix(top, sky, 0.3) },
      ruins:  { disc: 3, size: 0.075, glow: 1.0, stars: 1.0, cover: 0.5, clouds: 0.85, lit: mix(top, sky, 0.45), shade: mix(top, '#12060f', 0.35) }
    }[style] || null;
    cfg = cfg || { disc: 1, size: 0.04, glow: 1, stars: 0, cover: 0.52, clouds: 1, lit: '#ffffff', shade: '#c8d8f0' };
    var moonC = style === 'forest' ? C('#e8f0ff') : style === 'ruins' ? C('#ffb070') : sunC;
    var mat = new T.ShaderMaterial({
      uniforms: {
        uTop: { value: top }, uSky: { value: sky }, uFog: { value: fog }, uSunC: { value: moonC },
        uCloudLit: { value: C(cfg.lit) }, uCloudShade: { value: C(cfg.shade) },
        uR0: { value: r0 }, uR1: { value: r1 }, uR2: { value: r2 }, uStarC: { value: C(style === 'ruins' ? '#ffe8d8' : '#e8f0ff') },
        uSunDir: { value: sunDir }, uTime: { value: 0 }, uStyle: { value: SKY_STYLE[style] !== undefined ? SKY_STYLE[style] : 1 },
        uStars: { value: cfg.stars }, uCover: { value: cfg.cover }, uCloudAmt: { value: TX ? cfg.clouds : 0 },
        uSunSize: { value: cfg.size }, uSunGlow: { value: cfg.glow }, uDisc: { value: cfg.disc },
        glowBoost: M.glowBoost, tNoise: { value: TX ? TX.noise() : null }, tRidge: { value: ridgeTex(style) }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = position;',
        '  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);',
        '  gl_Position = p.xyww; gl_Position.z = p.w * 0.99999;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop; uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uSunC; uniform vec3 uCloudLit; uniform vec3 uCloudShade;',
        'uniform vec3 uR0; uniform vec3 uR1; uniform vec3 uR2; uniform vec3 uStarC; uniform vec3 uSunDir;',
        'uniform float uTime; uniform float uStyle; uniform float uStars; uniform float uCover; uniform float uCloudAmt;',
        'uniform float uSunSize; uniform float uSunGlow; uniform float uDisc; uniform float glowBoost;',
        'uniform sampler2D tNoise;',
        'varying vec3 vDir;',
        'uniform sampler2D tRidge;',
        'float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'vec3 layer(vec3 c, float h, float r, vec3 col){',
        '  return mix(c, col, 1.0 - smoothstep(r - 0.0022, r + 0.0022, h));',
        '}',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  float az = atan(d.z, d.x) / 6.2831853 + 0.5;',
        '  vec3 c = mix(uFog, uSky, smoothstep(-0.03, 0.2, h));',
        '  c = mix(c, uTop, smoothstep(0.12, 0.8, h));',
        '  float sd = dot(d, uSunDir), sdp = max(sd, 0.0);',
        '  c += uSunC * pow(sdp, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(h - uSunDir.y * 0.5))) * 0.2 * uSunGlow;',
        '  if (uStars > 0.0 && h > 0.0) {',
        '    vec2 g = d.xz / (h + 0.35) * 70.0; vec2 id = floor(g); vec2 f = fract(g) - 0.5;',
        '    float r = hash2(id); vec2 o = vec2(hash2(id + 3.1), hash2(id + 7.7)) - 0.5;',
        '    float s = step(0.955, r) * smoothstep(0.1, 0.0, length(f - o * 0.6)) * (0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));',
        '    c += uStarC * s * smoothstep(0.1, 0.55, h) * uStars * glowBoost;',
        '  }',
        '  float ang = acos(clamp(sd, -1.0, 1.0));',
        '  c += uSunC * exp(-ang / (uSunSize * 2.2)) * 0.45 * uSunGlow;',
        '  if (uDisc > 0.5) {',
        '    float disc = 1.0 - smoothstep(uSunSize * 0.9, uSunSize, ang);',
        '    if (uDisc < 1.5) c = mix(c, uSunC * 1.3 * glowBoost, disc);',
        '    else if (uDisc < 2.5) { float cr = texture2D(tNoise, d.xy * 4.0 + d.z * 2.0).b; c = mix(c, uSunC * (0.82 + 0.3 * cr) * glowBoost, disc); }',
        '    else {',
        '      float ring = smoothstep(uSunSize * 0.82, uSunSize * 0.97, ang) * (1.0 - smoothstep(uSunSize * 0.97, uSunSize * 1.45, ang));',
        '      c = mix(c, uSunC * 1.5 * glowBoost, ring);',
        '      c = mix(c, vec3(0.06, 0.02, 0.09), 1.0 - smoothstep(uSunSize * 0.86, uSunSize * 0.9, ang));',
        '    }',
        '  }',
        '  if (h > -0.05 && uCloudAmt > 0.0) {',
        '    vec2 uv = d.xz / (max(h, 0.0) + 0.2);',
        '    vec2 dr = vec2(uTime * 0.003, uTime * 0.001);',
        '    vec2 cu = uv * 0.028 + dr;',
        '    float n = texture2D(tNoise, cu).r * 0.6 + texture2D(tNoise, uv * 0.075 - dr * 1.6).g * 0.28 + texture2D(tNoise, uv * 0.2 + dr * 2.0).b * 0.12;',
        '    float nb = texture2D(tNoise, cu * 1.035).r * 0.6 + texture2D(tNoise, uv * 1.035 * 0.075 - dr * 1.6).g * 0.28 + texture2D(tNoise, uv * 1.035 * 0.2 + dr * 2.0).b * 0.12;',
        '    float cov = smoothstep(uCover, uCover + 0.07, n);',
        '    float fadeH = smoothstep(-0.02, 0.08, h) * (1.0 - smoothstep(0.6, 0.98, h));',
        '    float lit = clamp(0.55 + (n - nb) * 9.0 + (n - uCover) * 1.5, 0.0, 1.0);',   // lit tops, shaded bellies
        '    vec3 cc = mix(uCloudShade, uCloudLit, lit);',
        '    cc += uSunC * pow(sdp, 5.0) * 0.22 * (1.0 - cov * 0.6);',
        '    cc = min(cc, vec3(0.92));',
        '    c = mix(c, cc, cov * fadeH * uCloudAmt);',
        '    float ci = texture2D(tNoise, vec2(uv.x * 0.02 + dr.x * 3.0, uv.y * 0.09)).g;',
        '    c = mix(c, uCloudLit, smoothstep(0.6, 0.82, ci) * smoothstep(0.12, 0.45, h) * 0.22 * uCloudAmt);',
        '  }',
        // distant silhouettes, far -> near (heights precomputed per zone on the CPU: ridgeTex)
        '  vec3 rg = texture2D(tRidge, vec2(az, 0.5)).rgb * 0.32;',
        '  float far = rg.r, mid = rg.g, near = rg.b;',
        '  c = layer(c, h, far, uR0 + uSunC * pow(sdp, 6.0) * 0.05);',
        '  c = layer(c, h, mid, uR1);',
        '  c = layer(c, h, near, uR2);',
        '  c = mix(c, uFog, (1.0 - smoothstep(-0.02, 0.022, h)) * 0.5);',     // mist where the land meets the sky
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false
    });
    mat.toneMapped = false;
    var skyM = new T.Mesh(new T.SphereGeometry(100, 48, 24), mat);
    skyM.frustumCulled = false; skyM.renderOrder = -10; skyM.name = 'sky';
    skyM.onBeforeRender = function () { mat.uniforms.uTime.value = (performance.now() / 1000) % 3600; };
    skyM.userData.anim = function () {};
    return skyM;
  };

  // ---------- v1.2 WS6: zone style 'vault' (the Hollow Orrery): a cavern dome painted like a planetarium ----------
  // Dark violet rock with soft lumps and cracks, faint gold engraved circles (parallels, meridians, a tilted
  // ecliptic, some segments broken: the Starless), clustered twinkling crystal star-points, a nebula haze
  // along the ecliptic and cavern silhouettes (stalagmites, observatory columns) at the horizon.
  // A cold rim light (DirectionalLight, no shadows) rides along as a child of the dome: it is removed with
  // the zone. zone.dome = engraving colour, zone.rimLight / zone.rimIntensity override the rim light.
  function vaultSky(zone) {
    var TX = envTX();
    var top = C(zone.skyTop || '#0d0a1c'), sky = C(zone.sky || '#3a2c5c'), fog = C(zone.fog || '#2c2446'), gr = C(zone.ground || '#3a3150'), dark = C('#0b0814');
    var mat = new T.ShaderMaterial({
      uniforms: {
        uTop: { value: top }, uSky: { value: sky }, uFog: { value: fog },
        uR0: { value: mix(fog, dark, 0.3) }, uR1: { value: mix(fog, dark, 0.52).lerp(gr, 0.06) }, uR2: { value: mix(fog, dark, 0.7).lerp(gr, 0.1) },
        uLine: { value: C(zone.dome || '#d4a84a') }, uNeb: { value: mix(sky, '#9a6aff', 0.6) },
        uCryA: { value: C('#9ff2ff') }, uCryB: { value: C('#c8a8ff') }, uCryC: { value: C('#fff0c0') },
        uTime: { value: 0 }, glowBoost: M.glowBoost, tNoise: { value: TX ? TX.noise() : null }, tRidge: { value: ridgeTex('vault') }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = position;',
        '  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);',
        '  gl_Position = p.xyww; gl_Position.z = p.w * 0.99999;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop; uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uR0; uniform vec3 uR1; uniform vec3 uR2;',
        'uniform vec3 uLine; uniform vec3 uNeb; uniform vec3 uCryA; uniform vec3 uCryB; uniform vec3 uCryC;',
        'uniform float uTime; uniform float glowBoost; uniform sampler2D tNoise; uniform sampler2D tRidge;',
        'varying vec3 vDir;',
        'float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'vec3 layer(vec3 c, float h, float r, vec3 col){ return mix(c, col, 1.0 - smoothstep(r - 0.0022, r + 0.0022, h)); }',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  float az = atan(d.z, d.x) / 6.2831853 + 0.5, el = asin(clamp(h, -1.0, 1.0));',
        '  vec3 c = mix(uFog, uSky, smoothstep(-0.04, 0.3, h));',
        '  c = mix(c, uTop, smoothstep(0.25, 0.92, h));',
        '  vec2 duv = d.xz / (h + 0.65);',
        '  float rk = texture2D(tNoise, duv * 0.35).r * 0.6 + texture2D(tNoise, duv * 1.1 + 0.3).g * 0.4;',
        '  float cr = texture2D(tNoise, duv * 2.3 + 0.7).b;',
        '  c *= 0.8 + 0.4 * rk - 0.22 * smoothstep(0.62, 0.7, cr) * smoothstep(0.0, 0.2, h);',
        '  float lines = 0.0;',
        '  for (int i = 1; i <= 3; i++) { float e0 = float(i) * 0.36; lines = max(lines, 1.0 - smoothstep(0.0, 0.006, abs(el - e0))); }',
        '  float fm = fract(az * 12.0), dm = min(fm, 1.0 - fm) / 12.0 * 6.2831853 * cos(el);',
        '  lines = max(lines, (1.0 - smoothstep(0.0, 0.0055, dm)) * smoothstep(0.12, 0.3, h) * (1.0 - smoothstep(1.15, 1.4, el)));',
        '  vec3 en = normalize(vec3(0.25, 0.92, 0.3)); float ecl = abs(dot(d, en));',
        '  lines = max(lines, 1.0 - smoothstep(0.0, 0.008, ecl));',
        '  float brk = smoothstep(0.36, 0.48, texture2D(tNoise, vec2(az * 3.0, el * 0.9)).g);',
        '  c += uLine * lines * brk * smoothstep(0.02, 0.15, h) * 0.5;',
        '  if (h > 0.0) {',
        '    vec2 g = d.xz / (h + 0.4) * 55.0; vec2 id = floor(g); vec2 f = fract(g) - 0.5;',
        '    float rr = hash2(id); vec2 o = vec2(hash2(id + 3.1), hash2(id + 7.7)) - 0.5;',
        '    float cl = texture2D(tNoise, id * 0.013).r;',
        '    float th = mix(0.972, 0.9, smoothstep(0.45, 0.78, cl));',
        '    float s = step(th, rr) * smoothstep(0.13, 0.0, length(f - o * 0.6)) * (0.55 + 0.45 * sin(uTime * (0.8 + rr * 2.5) + rr * 50.0));',
        '    vec3 sc = rr > 0.988 ? uCryC : (fract(rr * 97.0) > 0.5 ? uCryA : uCryB);',
        '    c += sc * s * smoothstep(0.05, 0.4, h) * 1.25 * glowBoost;',
        '  }',
        '  float neb = texture2D(tNoise, vec2(az * 2.0, el * 1.3) + uTime * 0.002).r;',
        '  c += uNeb * smoothstep(0.45, 0.85, neb) * (1.0 - smoothstep(0.0, 0.35, ecl)) * smoothstep(0.05, 0.3, h) * 0.32;',
        '  vec3 rg = texture2D(tRidge, vec2(az, 0.5)).rgb * 0.32;',
        '  c = layer(c, h, rg.r, uR0); c = layer(c, h, rg.g, uR1); c = layer(c, h, rg.b, uR2);',
        '  c = mix(c, uFog, (1.0 - smoothstep(-0.02, 0.05, h)) * 0.55);',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false
    });
    mat.toneMapped = false;
    var skyM = new T.Mesh(new T.SphereGeometry(100, 48, 24), mat);
    skyM.frustumCulled = false; skyM.renderOrder = -10; skyM.name = 'sky';
    skyM.onBeforeRender = function () { mat.uniforms.uTime.value = (performance.now() / 1000) % 3600; };
    skyM.userData.anim = function () {};
    var rim = new T.DirectionalLight(C(zone.rimLight || '#8fb0ff'), zone.rimIntensity != null ? zone.rimIntensity : 0.42);
    rim.name = 'vaultRimLight'; rim.position.set(-28, 22, -34); rim.castShadow = false;
    skyM.add(rim); skyM.userData.rimLight = rim;
    return skyM;
  }

  // ---------- ambient particles: one draw call, wrapped around the camera ----------
  // kinds: 0 glow mote (add) 1 leaf 2 ash 3 sparkle (add) 4 firefly (add, blinks) 5 ember (add, rises) 6 fluff
  var AMB = {
    town:   { n: 300, mix: [[3, 0.55, ['#ffe08a', '#fff4c0', '#ffd0f0']], [0, 0.25, ['#fff2b0']], [6, 0.2, ['#ffffff']]] },
    meadow: { n: 460, mix: [[0, 0.45, ['#fff2a8', '#ffe27a']], [6, 0.4, ['#ffffff', '#fffbe8']], [3, 0.15, ['#fff0b0']]] },
    forest: { n: 560, mix: [[4, 0.45, ['#d8ff7a', '#a8ffb0', '#fff27a']], [1, 0.33, ['#c7843a', '#a8562a', '#d8b04a', '#7f9a3a', '#c06a3a']], [0, 0.22, ['#7fe8ff', '#b8a8ff']]] },
    ruins:  { n: 640, mix: [[5, 0.45, ['#ff8a3a', '#ffb347', '#ff5a2a']], [2, 0.43, ['#c8bec8', '#8a8090', '#5e5468']], [0, 0.12, ['#c78bff', '#9dff5a']]] },
    // v1.2 WS6: drifting dust, brazier embers, cold star sparkles, a few gold motes
    vault:  { n: 560, mix: [[2, 0.45, ['#b8a8d8', '#8a7aa8', '#d8cce8']], [5, 0.25, ['#ffb347', '#ffd27a', '#ff8a3a']], [0, 0.24, ['#9ff2ff', '#c8a8ff', '#ffd76a']], [3, 0.06, ['#fff3d2']]] }
  };
  var AMB_SIZE = [0.1, 0.3, 0.16, 0.3, 0.2, 0.11, 0.17];
  M.ambient = function (zone) {
    need(); zone = zone || {};
    var TX = envTX(), style = zone.style || 'meadow', A = AMB[style] || AMB.meadow, N = A.n;
    var r = seeded(((zone.seed || 3) * 13 + 101) >>> 0), BOX = 56, BOXH = 12;
    var pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), kind = new Float32Array(N), colr = new Float32Array(N * 3), size = new Float32Array(N), tmpC = new T.Color();
    for (var i = 0; i < N; i++) {
      var u = r(), acc = 0, e = A.mix[A.mix.length - 1];
      for (var k = 0; k < A.mix.length; k++) { acc += A.mix[k][1]; if (u <= acc) { e = A.mix[k]; break; } }
      var kd = e[0], yLo = 0, yHi = BOXH;
      if (kd === 4) { yLo = 0.3; yHi = 3.2; } else if (kd === 0 || kd === 3 || kd === 6) { yLo = 0.4; yHi = 5.5; }
      pos[i * 3] = (r() - 0.5) * BOX; pos[i * 3 + 1] = yLo + r() * (yHi - yLo); pos[i * 3 + 2] = (r() - 0.5) * BOX;
      seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r();
      kind[i] = kd;
      tmpC.set(e[2][Math.floor(r() * e[2].length)]);
      colr[i * 3] = tmpC.r; colr[i * 3 + 1] = tmpC.g; colr[i * 3 + 2] = tmpC.b;
      size[i] = AMB_SIZE[kd] * (0.6 + r() * 0.8);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seed, 4));
    g.setAttribute('aKind', new T.BufferAttribute(kind, 1));
    g.setAttribute('aColor', new T.BufferAttribute(colr, 3));
    g.setAttribute('aSize', new T.BufferAttribute(size, 1));
    var mat = new T.ShaderMaterial({
      uniforms: { uTime: envTime, uScale: { value: 400 }, uBox: { value: BOX }, uBoxH: { value: BOXH }, glowBoost: M.glowBoost, tAtlas: { value: TX ? TX.particleAtlas() : null } },
      vertexShader: [
        'uniform float uTime; uniform float uScale; uniform float uBox; uniform float uBoxH;',
        'attribute vec4 aSeed; attribute float aKind; attribute vec3 aColor; attribute float aSize;',
        'varying vec3 vCol; varying float vA; varying float vKind; varying float vRot;',
        'void main(){',
        '  vec3 p = position; float t = uTime; vec4 s = aSeed * 6.2831853; float k = aKind;',
        '  if (k < 0.5) p += vec3(sin(t * 0.3 + s.x) * 1.5 + t * 0.22, sin(t * 0.5 + s.y) * 0.5, cos(t * 0.27 + s.z) * 1.5);',
        '  else if (k < 1.5) { p.y -= t * (0.45 + aSeed.x * 0.4); p.x += sin(t * 1.1 + s.y) * 0.9 + t * 0.35; p.z += cos(t * 0.8 + s.z) * 0.6; }',
        '  else if (k < 2.5) { p.y -= t * (0.22 + aSeed.x * 0.2); p.x += sin(t * 0.7 + s.y) * 0.6 + t * 0.25; p.z += cos(t * 0.5 + s.z) * 0.5; }',
        '  else if (k < 3.5) p += vec3(sin(t * 0.4 + s.x) * 0.8, sin(t * 0.6 + s.y) * 0.4, cos(t * 0.35 + s.z) * 0.8);',
        '  else if (k < 4.5) p += vec3(sin(t * 0.6 + s.x) * 1.6 + sin(t * 1.9 + s.y) * 0.35, sin(t * 0.9 + s.y) * 0.6, cos(t * 0.55 + s.z) * 1.6);',
        '  else if (k < 5.5) { p.y += t * (0.55 + aSeed.x * 0.8); p.x += sin(t * 1.7 + s.y) * 0.5 + t * 0.15; p.z += cos(t * 1.3 + s.z) * 0.5; }',
        '  else p += vec3(t * 0.4 + sin(t * 0.5 + s.x) * 1.2, sin(t * 0.4 + s.y) * 0.7, cos(t * 0.3 + s.z) * 1.2);',
        '  vec2 cc = cameraPosition.xz;',
        '  p.xz = mod(p.xz - cc + uBox * 0.5, uBox) - uBox * 0.5 + cc;',
        '  p.y = mod(p.y, uBoxH);',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.48, length(p.xz - cc));',
        '  float yf = smoothstep(0.0, 0.6, p.y) * (1.0 - smoothstep(uBoxH - 2.0, uBoxH, p.y));',
        '  float bl = 1.0;',
        '  if (k > 3.5 && k < 4.5) bl = smoothstep(0.25, 0.95, sin(t * (1.2 + aSeed.w * 1.8) + s.x * 3.0) * 0.5 + 0.5);',
        '  else if (k > 4.5 && k < 5.5) bl = (0.65 + 0.35 * sin(t * 9.0 + s.y * 5.0)) * (1.0 - smoothstep(4.0, uBoxH, p.y) * 0.7);',
        '  else if (k > 2.5 && k < 3.5) bl = 0.35 + 0.65 * pow(sin(t * (1.5 + aSeed.w * 2.0) + s.x * 4.0) * 0.5 + 0.5, 3.0);',
        '  vA = edge * yf * bl;',
        '  vCol = aColor; vKind = k;',
        '  vRot = (k > 0.5 && k < 2.5) ? t * (0.6 + aSeed.z * 2.0) + s.w : (k > 2.5 && k < 3.5 ? t * 0.5 + s.w : 0.0);',
        '  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.5), 0.0, 72.0);',
        '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D tAtlas; uniform float glowBoost;',
        'varying vec3 vCol; varying float vA; varying float vKind; varying float vRot;',
        'void main(){',
        '  if (vA < 0.01) discard;',
        '  vec2 pc = gl_PointCoord - 0.5; float cs = cos(vRot), sn = sin(vRot);',
        '  pc = vec2(cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y) + 0.5;',
        '  float k = vKind;',
        '  float cell = (k > 0.5 && k < 1.5) ? 1.0 : (k > 1.5 && k < 2.5) ? 2.0 : (k > 2.5 && k < 3.5) ? 3.0 : 0.0;',
        '  vec4 tx = texture2D(tAtlas, vec2((cell + clamp(pc.x, 0.03, 0.97)) * 0.25, clamp(pc.y, 0.03, 0.97)));',
        '  float a = tx.a * vA;',
        '  if (a < 0.004) discard;',
        '  bool add = k < 0.5 || (k > 2.5 && k < 5.5);',
        '  vec3 c = vCol * tx.rgb;',
        '  if (add) gl_FragColor = vec4(c * a * glowBoost * (k > 3.5 ? 1.35 : 1.0), 0.0);',
        '  else gl_FragColor = vec4(c * a * (k > 5.5 ? 1.0 : 0.85), a * (k > 5.5 ? 0.8 : 1.0));',
        '}'].join('\n'),
      transparent: true, depthWrite: false, fog: false,
      blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendEquation: T.AddEquation
    });
    mat.toneMapped = false;
    var pts = new T.Points(g, mat);
    pts.frustumCulled = false; pts.name = 'ambient'; pts.renderOrder = 5;
    var _sz = new T.Vector2();
    pts.onBeforeRender = function (renderer) { tickEnv(); renderer.getDrawingBufferSize(_sz); mat.uniforms.uScale.value = _sz.y * 0.5; };
    var dens = M.envDensity || { particles: 1 };
    g.setDrawRange(0, Math.floor(N * dens.particles));
    pts.userData.applyDensity = function (d) { g.setDrawRange(0, Math.floor(N * (d ? d.particles : 1))); };
    if (!TX) pts.visible = false;
    return pts;
  };

  // ---------- pools: painterly water disc (bogs, ponds) ----------
  M.pool = function (radius, color) {
    need();
    var TX = envTX(), col = C(color || '#3d5a3a');
    var mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uColor: { value: col }, uR: { value: radius }, tNoise: { value: null } }]),
      vertexShader: [
        'varying vec2 vP; varying vec3 vW;',
        '#include <fog_pars_vertex>',
        'void main(){ vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;',
        '#include <fog_vertex>',
        '}'].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uR; uniform sampler2D tNoise; uniform float uTime;',
        'varying vec2 vP; varying vec3 vW;',
        '#include <fog_pars_fragment>',
        'void main(){',
        '  float r = length(vP) / uR;',
        '  vec2 uv = vW.xz;',
        '  float n1 = texture2D(tNoise, uv * 0.06 + vec2(uTime * 0.006, 0.0)).g;',
        '  float n2 = texture2D(tNoise, uv * 0.16 - vec2(0.0, uTime * 0.01)).b;',
        '  float edgeN = (texture2D(tNoise, uv * 0.2).r - 0.5) * 0.12;',
        '  if (r > 1.0 + edgeN) discard;',
        '  vec3 deep = uColor * 0.62, shallow = uColor * 1.25 + vec3(0.03, 0.05, 0.04);',
        '  vec3 c = mix(deep, shallow, smoothstep(0.35, 1.0, r + edgeN));',
        '  float rip = smoothstep(0.62, 0.7, n1 * 0.6 + n2 * 0.4) * (1.0 - smoothstep(0.85, 1.0, r));',
        '  c += vec3(0.16, 0.2, 0.2) * rip;',
        '  c = mix(c, c * 1.3 + 0.05, smoothstep(0.9, 1.0, r + edgeN) * 0.8);',
        '  float glint = pow(max(0.0, n2 - 0.55) * 2.2, 3.0);',
        '  c += vec3(0.45, 0.5, 0.45) * glint;',
        '  gl_FragColor = vec4(c, 1.0);',
        '#include <fog_fragment>',
        '}'].join('\n'),
      fog: true
    });
    mat.uniforms.tNoise.value = TX ? TX.noise() : null;
    mat.uniforms.uTime = envTime;
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    var disc = new T.Mesh(new T.CircleGeometry(radius * 1.08, 48), mat);
    disc.rotation.x = -PI / 2;
    disc.receiveShadow = false; disc.name = 'pool';
    disc.onBeforeRender = tickEnv;
    if (!TX) { disc.material.dispose(); disc.material = M.toon(col); }
    return disc;
  };

  // ==================================================================
  //  PORTAL / WISP  (v1.1, agent R)
  // ==================================================================
  M.portal = function (color) {
    need();
    var col = C(color || '#7fffb0'), TX = envTX();
    var root = new T.Group(); root.name = 'portal';
    var stone = C('#8d93a3'), dark = sh(stone, -0.25);
    var B = new Builder();
    B.add(G.cyl(2.6, 2.8, 0.25, 16), dark, { p: [0, 0.12, 0], s: [1, 1, 0.55], flat: true });
    [-1, 1].forEach(function (s) {
      B.add(G.box(0.8, 0.35, 0.8), dark, { p: [s * 1.85, 0.42, 0], flat: true });
      B.add(G.box(0.62, 3.0, 0.62), stone, { p: [s * 1.85, 2.0, 0], flat: true });
      B.add(G.box(0.72, 0.16, 0.72), sh(stone, 0.08), { p: [s * 1.85, 3.45, 0], flat: true });
      for (var k = 0; k < 3; k++) B.glow(G.box(0.16, 0.3, 0.04), col, { p: [s * 1.85, 1.0 + k * 0.85, 0.32] });
      for (var k2 = 0; k2 < 3; k2++) B.glow(G.box(0.16, 0.3, 0.04), col, { p: [s * 1.85, 1.0 + k2 * 0.85, -0.32] });
    });
    var nb = 9;
    for (var i = 0; i < nb; i++) {
      var a = i / (nb - 1) * PI;
      B.add(G.box(0.62, 0.62, 0.66), i === 4 ? sh(stone, 0.1) : stone, { p: [Math.cos(a) * 1.85, 3.5 + Math.sin(a) * 1.85, 0], r: [0, 0, a - PI / 2], flat: true });
      if (i % 2 === 1) B.glow(G.box(0.12, 0.12, 0.7), col, { p: [Math.cos(a) * 2.18, 3.5 + Math.sin(a) * 2.18, 0], r: [0, 0, a] });
    }
    B.glow(G.oct(0.22), col, { p: [0, 5.75, 0.25], s: [1, 1.4, 0.6] });
    root.add(B.build());
    // swirling surface: arch-shaped ShapeGeometry with a polar vortex shader (blooms via glowBoost)
    var shp = new T.Shape();
    shp.moveTo(-1.56, 0.5); shp.lineTo(1.56, 0.5); shp.lineTo(1.56, 3.5); shp.absarc(0, 3.5, 1.56, 0, PI, false); shp.lineTo(-1.56, 0.5);
    var sg = new T.ShapeGeometry(shp, 32);
    var smat = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: col }, glowBoost: M.glowBoost, tNoise: { value: TX ? TX.noise() : null }, uHasN: { value: TX ? 1 : 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float glowBoost; uniform sampler2D tNoise; uniform float uHasN; varying vec2 vP;',
        'void main(){',
        '  vec2 p = (vP - vec2(0.0, 2.55)) / vec2(1.56, 2.3);',
        '  float r = length(p); float a = atan(p.y, p.x);',
        '  float tw = a + log(r + 0.06) * 1.9 - uTime * 1.4;',
        '  float arms = sin(tw * 3.0) * 0.5 + 0.5;',
        '  float n = uHasN > 0.5 ? texture2D(tNoise, vec2(tw * 0.159 * 2.0, r * 0.7 - uTime * 0.25)).r : 0.5;',
        '  float sw = smoothstep(0.25, 0.95, arms * 0.7 + n * 0.5);',
        '  vec3 deep = uColor * 0.28 + vec3(0.02, 0.0, 0.06);',
        '  vec3 c = mix(deep, uColor * 0.85, sw);',
        '  c = mix(c, mix(uColor, vec3(1.0), 0.45), smoothstep(0.45, 0.0, r) * 0.7);',       // bright heart
        '  c += uColor * smoothstep(0.66, 1.0, r) * 0.4;',                                    // glowing rim
        '  vec2 g = vec2(a * 6.0, r * 9.0 - uTime * 1.5); vec2 gi = floor(g);',
        '  float h = fract(sin(dot(gi, vec2(12.9898, 78.233))) * 43758.5453);',
        '  float sp = step(0.93, h) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));',
        '  c += vec3(1.0) * sp * 0.7;',                                                        // sparkles
        '  gl_FragColor = vec4(c * (0.55 + 0.45 * glowBoost), 0.92);',
        '}'].join('\n'),
      transparent: true, side: T.DoubleSide, depthWrite: false
    });
    smat.forceSinglePass = true;
    smat.toneMapped = false;
    var surf = new T.Mesh(sg, smat); surf.position.z = 0.0; surf.userData.noMeasure = true;
    root.add(surf);
    var h = halo(col, 6.5, 0.26); h.position.set(0, 2.8, 0.3); root.add(h);
    // glow pool on the ground in front of / behind the arch
    var gmat = cmat('portalGround|' + hx(col), function () {
      var m = new T.MeshBasicMaterial({ map: haloTex(), color: col, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false });
      m.onBeforeCompile = boostCompile;
      return m;
    });
    var gp = smesh(SG('portalGroundGeo', function () { var g = new T.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return g; }), gmat);
    gp.scale.set(6.2, 1, 4.2); gp.position.y = 0.27; root.add(gp);
    // rising spiral motes (vertex animated, one draw call)
    var N = 40, mg = new T.BufferGeometry(), mp = new Float32Array(N * 3), seeds = [];
    for (var m = 0; m < N; m++) seeds.push([Math.random() * TAU, 0.5 + Math.random() * 1.4, Math.random(), Math.random() < 0.5 ? 1 : -1]);
    mg.setAttribute('position', new T.BufferAttribute(mp, 3));
    var pmat = cmat('portalMotes|' + hx(col), function () {
      var m2 = new T.PointsMaterial({ color: sh(col, 0.25), size: 0.26, map: haloTex(), transparent: true, depthWrite: false, blending: T.AdditiveBlending });
      m2.onBeforeCompile = boostCompile;
      return m2;
    });
    var motes = new T.Points(mg, pmat);
    motes.frustumCulled = false;
    root.add(motes);
    root.userData.radius = 0;
    root.userData.height = 6;
    root.userData.anim = function (t) {
      smat.uniforms.uTime.value = t;
      for (var i = 0; i < N; i++) {
        var s = seeds[i], u = (t * 0.22 + s[2]) % 1, rr = s[1] * (1 - u * 0.5);
        mp[i * 3] = Math.cos(s[0] + t * 1.2 * s[3]) * rr;
        mp[i * 3 + 1] = 0.3 + u * 5.4;
        mp[i * 3 + 2] = Math.sin(s[0] + t * 1.2 * s[3]) * rr * 0.45;
      }
      mg.attributes.position.needsUpdate = true;
      var hs = 6.5 * (1 + Math.sin(t * 2) * 0.06); h.scale.set(hs, hs, 1);
      gmat.opacity = 0.45 + Math.sin(t * 2.3) * 0.1;
    };
    root.userData.anim(0);
    return root;
  };

  M.wisp = function () {
    need();
    var root = new T.Group(); root.name = 'wisp';
    var bob = pivot(root, 0, 1.1, 0);
    var core = smesh(UG.sph(), M.glow('#fffaf0')); core.scale.setScalar(0.17); bob.add(core);
    var ring = smesh(SG('wispRing', function () { return new T.TorusGeometry(0.34, 0.022, 4, 32); }), M.glow('#ffe08a')); bob.add(ring);
    var h = halo('#ffe8a8', 1.5, 0.9); bob.add(h);
    // orbiting health/mana motes + trailing sparkles: ONE points draw call
    var N = 26, pg = new T.BufferGeometry(), pp = new Float32Array(N * 3), pc = new Float32Array(N * 3), cR = C('#ff5a6e'), cB = C('#5ab8ff'), cW = C('#fff3c8');
    for (var i = 0; i < N; i++) { var c = i < 2 ? (i ? cB : cR) : (i % 3 === 0 ? cW : (i % 2 ? cR : cB)); pc[i * 3] = c.r; pc[i * 3 + 1] = c.g; pc[i * 3 + 2] = c.b; }
    pg.setAttribute('position', new T.BufferAttribute(pp, 3));
    pg.setAttribute('color', new T.BufferAttribute(pc, 3));
    var pmat = cmat('wispMotes', function () {
      var m = new T.PointsMaterial({ size: 0.34, map: haloTex(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
      m.onBeforeCompile = boostCompile;
      return m;
    });
    var pts = new T.Points(pg, pmat); pts.frustumCulled = false; bob.add(pts);
    root.userData.height = 1.5;
    root.userData.anim = function (t) {
      bob.position.y = 1.1 + Math.sin(t * 2.2) * 0.15;
      ring.rotation.set(PI / 2 + Math.sin(t * 1.3) * 0.5, t * 1.5, 0);
      for (var i = 0; i < N; i++) {
        var lead = i < 2, ph = (i % 2) * PI, lag = lead ? 0 : (1 + Math.floor((i - 2) / 2)) * 0.09, a = (t - lag) * 3 + ph;
        var rr = lead ? 0.45 : 0.45 + Math.sin(i * 7.3 + t) * 0.03;
        pp[i * 3] = Math.cos(a) * rr; pp[i * 3 + 1] = Math.sin(a * 2) * 0.12 + (lead ? 0 : (i % 4 - 1.5) * 0.02); pp[i * 3 + 2] = Math.sin(a) * rr;
      }
      pg.attributes.position.needsUpdate = true;
      var s = 1.5 * (1 + Math.sin(t * 4) * 0.1); h.scale.set(s, s, 1);
    };
    root.userData.anim(0);
    return root;
  };

  // ==================================================================
  //  TEXT / QUEST MARKERS / DUEL RING
  // ==================================================================
  // Sprite anchored at its BOTTOM-CENTRE (place it at the top of a head).
  M.textSprite = function (text, o) {
    need(); o = o || {}; text = String(text);
    var size = o.size || 1, px = 48, pad = o.bg ? 26 : 14, scale = 2;
    var font = (o.bold ? 'bold ' : '600 ') + px + 'px "Trebuchet MS", "Segoe UI", Verdana, sans-serif';
    var c = document.createElement('canvas'), x = c.getContext('2d');
    x.font = font;
    var w = Math.ceil(x.measureText(text).width) + pad * 2, h = 72;
    c.width = w * scale; c.height = h * scale;
    x = c.getContext('2d'); x.scale(scale, scale); x.font = font;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (o.bg) {
      x.fillStyle = o.bg; var rr = 18;
      x.beginPath(); x.moveTo(rr, 4); x.lineTo(w - rr, 4); x.quadraticCurveTo(w - 2, 4, w - 2, rr + 4); x.lineTo(w - 2, h - rr - 4); x.quadraticCurveTo(w - 2, h - 4, w - rr, h - 4);
      x.lineTo(rr, h - 4); x.quadraticCurveTo(2, h - 4, 2, h - rr - 4); x.lineTo(2, rr + 4); x.quadraticCurveTo(2, 4, rr, 4); x.fill();
    }
    x.lineJoin = 'round'; x.lineWidth = 8; x.strokeStyle = 'rgba(20,12,30,0.85)';
    x.strokeText(text, w / 2, h / 2 + 2);
    x.fillStyle = o.color ? '#' + C(o.color).getHexString() : '#ffffff';
    x.fillText(text, w / 2, h / 2 + 2);
    var tex = new T.CanvasTexture(c); tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
    var mat = new T.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false });
    var s = new T.Sprite(mat);
    var wh = 0.35 * size * (h / px) * 1.05;
    s.scale.set(wh * w / h, wh, 1);
    s.center.set(0.5, 0);
    s.renderOrder = 999;
    s.userData.textTag = true;   // v1.1: name plates are never treated as glow sprites (enemy defeat fade)
    s.userData.text = text;
    var freed = false;
    s.userData.dispose = function () { if (freed) return; freed = true; tex.dispose(); mat.dispose(); };
    return s;
  };

  // Quest markers share one geometry + material set per kind (no per-call GPU allocations).
  function questGeos(kind) {
    return cachedGeos('qm_' + kind, function (B) {
      var fill = '#ffffff';
      if (kind === '!') {
        B.add(G.cyl(0.13, 0.07, 0.56, 10), fill, { p: [0, 0.55, 0] });
        B.add(G.sph(0.13, 10, 8), fill, { p: [0, 0.83, 0] });
        B.add(G.sph(0.1, 10, 8), fill, { p: [0, 0.12, 0] });
      } else {
        B.add(G.tor(0.19, 0.075, 8, 18, PI * 1.55), fill, { p: [0, 0.68, 0], r: [0, 0, -PI / 2] });
        B.add(G.sph(0.075, 8, 6), fill, { p: [-0.18, 0.62, 0] });
        B.add(G.cyl(0.075, 0.06, 0.2, 8), fill, { p: [0, 0.4, 0] });
        B.add(G.sph(0.1, 10, 8), fill, { p: [0, 0.12, 0] });
      }
    }).s;
  }
  M.questMarker = function (kind) {
    need();
    var grey = kind === '?grey';
    var shape = kind === '!' ? '!' : '?';
    var geo = questGeos(shape);
    var outGeo = SG('qm_out_' + shape, function () { return inflate(geo, 0.035); });
    var fill = grey ? '#b8bcc8' : '#ffd23a', edge = grey ? '#4a4c58' : '#7a4a00';
    var mat = cmat('qm_fill_' + (grey ? 'g' : 'y'), function () {
      return new T.MeshToonMaterial({ color: C(fill), gradientMap: gradient, emissive: grey ? C('#202028') : C('#6a4000') });
    });
    var omat = cmat('qm_edge_' + (grey ? 'g' : 'y'), function () { return new T.MeshBasicMaterial({ color: C(edge), side: T.BackSide }); });
    var root = new T.Group(); root.name = 'questMarker';
    var spin = pivot(root);
    spin.scale.setScalar(1.25);
    spin.add(smesh(outGeo, omat)); spin.add(smesh(geo, mat));
    if (!grey) { var h = halo('#ffd23a', 1.3, 0.5); h.position.y = 0.55; spin.add(h); }
    root.userData.kind = kind;
    root.userData.height = 1.3;
    root.userData.anim = function (t) { spin.position.y = Math.sin(t * 2.5) * 0.1; spin.rotation.y = t * 1.8; };
    return root;
  };

  function runeGlyph(x, cx, cy, s, seed) {
    var r = seeded(seed * 977 + 13);
    x.beginPath();
    x.moveTo(cx, cy - s); x.lineTo(cx, cy + s);
    var n = 1 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var y = cy - s + r() * 2 * s, dir = r() < 0.5 ? -1 : 1;
      x.moveTo(cx, y); x.lineTo(cx + dir * s * (0.5 + r() * 0.4), y + (r() - 0.5) * s);
    }
    if (r() < 0.4) { x.moveTo(cx - s * 0.5, cy + s * 0.6); x.lineTo(cx + s * 0.5, cy + s * 0.6); }
    x.stroke();
  }
  function ringTex(kind) {
    var key = 'ring_' + kind;
    if (texCache[key]) return texCache[key];
    var N = 1024, c = canvas(N, N), x = c.getContext('2d'), cx = N / 2, U = (N / 2) / 1.32; // U px per ring-radius
    x.strokeStyle = '#ffffff'; x.fillStyle = '#ffffff'; x.lineCap = 'round';
    x.shadowColor = 'rgba(255,255,255,0.9)'; x.shadowBlur = 10;
    if (kind === 'static') {
      x.lineWidth = 7; x.beginPath(); x.arc(cx, cx, U * 1.0, 0, TAU); x.stroke();
      x.lineWidth = 5; x.beginPath(); x.arc(cx, cx, U * 0.45, 0, TAU); x.stroke();
      var gr = x.createRadialGradient(cx, cx, 0, cx, cx, U * 0.45);
      gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0.05)');
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cx, U * 0.45, 0, TAU); x.fill();
      for (var i = 0; i < 8; i++) {
        var a = PI / 8 + i * PI / 4, sx = cx + Math.cos(a) * U, sy = cx + Math.sin(a) * U;
        x.fillStyle = 'rgba(255,255,255,0.22)'; x.beginPath(); x.arc(sx, sy, U * 0.17, 0, TAU); x.fill();
        x.lineWidth = 6; x.beginPath(); x.arc(sx, sy, U * 0.17, 0, TAU); x.stroke();
        x.lineWidth = 2.5; x.beginPath(); x.arc(sx, sy, U * 0.13, 0, TAU); x.stroke();
        x.lineWidth = 5; runeGlyph(x, sx, sy, U * 0.075, i + 1);
      }
    } else {
      x.lineWidth = 4; x.beginPath(); x.arc(cx, cx, U * 1.16, 0, TAU); x.stroke();
      x.lineWidth = 6; x.beginPath(); x.arc(cx, cx, U * 1.29, 0, TAU); x.stroke();
      x.lineWidth = 3.5;
      var n = 40;
      for (var k = 0; k < n; k++) {
        var b = k / n * TAU;
        x.save(); x.translate(cx + Math.cos(b) * U * 1.225, cx + Math.sin(b) * U * 1.225); x.rotate(b + PI / 2);
        runeGlyph(x, 0, 0, U * 0.035, k + 50); x.restore();
      }
      // 8-point star inside the inner circle
      x.lineWidth = 3.5; x.beginPath();
      for (var p = 0; p <= 8; p++) {
        var a1 = p * TAU * 3 / 8;
        var px = cx + Math.cos(a1) * U * 0.4, py = cx + Math.sin(a1) * U * 0.4;
        if (p === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
      x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cx, U * 0.2, 0, TAU); x.stroke();
    }
    var t = new T.CanvasTexture(c);
    t.userData.cached = true;
    return (texCache[key] = t);
  }
  // Sigil positions are exposed in userData.sigils (local, on the ring):
  // indices 0-3 lie on the +Z side, 4-7 on the -Z side (W101-style 4 vs 4).
  // Geometry is cached per radius and materials per colour, so a duel allocates
  // nothing new on the GPU after the first one with the same ring.
  M.duelRing = function (radius, color) {
    need(); radius = radius || 4;
    var col = C(color || '#ffd76a'), ch = hx(col), rk = radius.toFixed(2);
    var root = new T.Group(); root.name = 'duelRing';
    var size = radius * 1.32 * 2;
    var planeGeo = SG('dr_plane_' + rk, function () { return new T.PlaneGeometry(size, size); });
    function layer(kind, y, op) {
      var m = cmat('dr_' + kind + ch, function () {
        return new T.MeshBasicMaterial({ map: ringTex(kind), color: col, transparent: true, opacity: op, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      });
      var me = smesh(planeGeo, m);
      me.rotation.x = -PI / 2; me.position.y = y; me.renderOrder = 2;
      return me;
    }
    var under = smesh(SG('dr_under_' + rk, function () { return new T.CircleGeometry(radius * 1.3, 48); }),
      cmat('dr_under' + ch, function () { return new T.MeshBasicMaterial({ color: sh(col, -0.75), transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); }));
    under.rotation.x = -PI / 2; under.position.y = 0.03; root.add(under);
    // v1.1 polish (B13): ~35% dimmer than v1.1.0 so the circle frames the duel instead of dominating it
    var st = layer('static', 0.05, 0.5); root.add(st);
    var rot = pivot(root); rot.add(layer('rot', 0.06, 0.45));
    var sig = [];
    for (var i = 0; i < 8; i++) { var a = PI / 8 + i * PI / 4; sig.push(new T.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)); }
    // canvas +y maps to world +Z after the -PI/2 X rotation, so these match the drawn sigils.
    // Order: 0..3 on the +Z side, 4..7 on the -Z side, each sorted +X -> -X.
    var plusZ = sig.filter(function (v) { return v.z > 0; }), minusZ = sig.filter(function (v) { return v.z < 0; });
    plusZ.sort(function (a, b) { return b.x - a.x; }); minusZ.sort(function (a, b) { return b.x - a.x; });
    root.userData.sigils = plusZ.concat(minusZ);
    root.userData.radius = radius;
    // (the static layer's material is shared per colour; every ring of that colour pulses together)
    root.userData.anim = function (t) { rot.rotation.y = t * 0.12; st.material.opacity = 0.5 + Math.sin(t * 2) * 0.07; };
    return root;
  };

  // duelSigil(school, radius) -> the school sigil glowing under a duelist's feet (W101: your
  // school's mark on your side of the circle). Flat, origin at the feet, cached texture /
  // geometry / materials (nothing to free). userData.anim(t) slowly turns + breathes it.
  M.duelSigil = function (school, radius) {
    need(); radius = radius || 1.15;
    var sc = (WF.data && WF.data.schools && WF.data.schools[school]) || null;
    var col = C(sc ? sc.color : '#ffd76a'), ch = hx(col), key = school in FXPAL ? school : null;
    var tex = sigilTex(key);
    var root = new T.Group(); root.name = 'duelSigil';
    var mN = cmat('dsig_n' + ch + (key || ''), function () { return new T.MeshBasicMaterial({ map: tex, color: sh(col, -0.1), transparent: true, opacity: 0.8, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); });
    var mA = cmat('dsig_a' + ch + (key || ''), function () { return new T.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }); });
    mN.toneMapped = mA.toneMapped = false;
    var d1 = smesh(UG.plane(), mN), d2 = smesh(UG.plane(), mA);
    d1.position.y = 0.04; d2.position.y = 0.05; d1.renderOrder = 3; d2.renderOrder = 4;
    d1.scale.set(radius * 2, 1, radius * 2); d2.scale.set(radius * 2.04, 1, radius * 2.04);
    root.add(d1); root.add(d2);
    root.userData.school = school;
    root.userData.anim = function (t) { d1.rotation.y = t * 0.25; d2.rotation.y = -t * 0.18; var k = 1 + Math.sin(t * 1.7) * 0.025; d2.scale.set(radius * 2.04 * k, 1, radius * 2.04 * k); };
    return root;
  };

  // ==================================================================
  //  COMBAT FX
  // ==================================================================
  // projectile: all GPU resources shared (geometry + cached materials) -> nothing to free.
  M.projectile = function (colorHex) {
    need();
    var col = C(colorHex || '#ffd76a');
    var root = new T.Group(); root.name = 'projectile';
    var core = smesh(UG.sph(), M.glow(mix(col, '#ffffff', 0.55))); core.scale.setScalar(0.17);
    root.add(core);
    var h = halo(col, 1.2, 1); root.add(h);
    var trail = [], N = 10, hist = [];
    for (var i = 0; i < N; i++) { var s = halo(col, 0.9 * (1 - i / N) + 0.15, 0.7); s.renderOrder = 11; root.add(s); trail.push(s); }
    var spark = smesh(UG.oct(), M.glow(sh(col, 0.4))); spark.scale.setScalar(0.12); root.add(spark);
    var wp = new T.Vector3(), lp = new T.Vector3();
    core.onBeforeRender = function () {
      root.getWorldPosition(wp);
      if (!hist.length || hist[0].distanceToSquared(wp) > 0.0004) { hist.unshift(wp.clone()); if (hist.length > N * 2) hist.pop(); }
      for (var i = 0; i < N; i++) {
        var p = hist[Math.min(hist.length - 1, i * 2 + 1)] || wp;
        lp.copy(p); root.worldToLocal(lp);
        trail[i].position.copy(lp); trail[i].updateMatrixWorld();
      }
    };
    root.userData.anim = function (t) {
      var s = 1.2 * (1 + Math.sin(t * 25) * 0.12); h.scale.set(s, s, 1);
      spark.rotation.set(t * 7, t * 9, 0); spark.position.set(Math.cos(t * 14) * 0.28, Math.sin(t * 14) * 0.28, 0);
    };
    root.userData.update = function (dt) { return true; };
    return root;
  };

  // burst: place at the combatant's FEET; particles spawn around chest height (~1 unit).
  // Per-instance: 1 points geometry + 1-2 materials, released automatically when update() returns false.
  M.burst = function (colorHex, kind) {
    need();
    kind = kind || 'hit';
    var col = C(colorHex || '#ffffff');
    var root = new T.Group(); root.name = 'burst_' + kind;
    var N = kind === 'fizzle' ? 22 : 40, life = kind === 'buff' ? 1.2 : kind === 'heal' ? 1.3 : kind === 'fizzle' ? 1.0 : 0.8;
    var pos = new Float32Array(N * 3), vel = [], i;
    for (i = 0; i < N; i++) {
      var a = Math.random() * TAU, u = Math.random();
      if (kind === 'hit') {
        var el = (Math.random() - 0.3) * PI * 0.8, sp = 3 + Math.random() * 4;
        pos[i * 3 + 1] = 1.0;
        vel.push([Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 1, Math.sin(a) * Math.cos(el) * sp]);
      } else if (kind === 'heal' || kind === 'buff') {
        var rr = kind === 'heal' ? 0.5 + u * 0.4 : 0.85;
        pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = Math.random() * 0.6; pos[i * 3 + 2] = Math.sin(a) * rr;
        vel.push([a, 1.2 + Math.random() * 1.6, rr]);
      } else {
        pos[i * 3] = (Math.random() - 0.5) * 0.4; pos[i * 3 + 1] = 1.0 + (Math.random() - 0.5) * 0.4; pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
        vel.push([(Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8]);
      }
    }
    var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    var pm = new T.PointsMaterial({
      color: kind === 'fizzle' ? C('#8a8494') : col, size: kind === 'fizzle' ? 0.55 : 0.32, map: haloTex(),
      transparent: true, depthWrite: false, blending: kind === 'fizzle' ? T.NormalBlending : T.AdditiveBlending
    });
    var pts = new T.Points(geo, pm); pts.frustumCulled = false; root.add(pts);
    var extra = null, extraMat = null;
    if (kind === 'hit') {
      extraMat = new T.MeshBasicMaterial({ color: mix(col, '#ffffff', 0.4), transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending });
      extra = smesh(UG.sph(), extraMat); extra.position.y = 1.0;
    } else if (kind === 'heal' || kind === 'buff') {
      extraMat = new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
      extra = smesh(SG('burstRing', function () { var g = new T.RingGeometry(0.75, 0.95, 32); g.rotateX(-PI / 2); return g; }), extraMat); extra.position.y = 0.05;
    }
    if (extra) root.add(extra);
    var age = 0, done = false, freed = false;
    function free() { if (freed) return; freed = true; geo.dispose(); pm.dispose(); if (extraMat) extraMat.dispose(); }
    root.userData.life = life;
    root.userData.dispose = free;
    root.userData.update = function (dt) {
      if (done) return false;
      age += dt; var k = age / life;
      for (var i = 0; i < N; i++) {
        var v = vel[i];
        if (kind === 'hit') {
          pos[i * 3] += v[0] * dt; pos[i * 3 + 1] += v[1] * dt; pos[i * 3 + 2] += v[2] * dt;
          v[0] *= 0.9; v[2] *= 0.9; v[1] = v[1] * 0.9 - 6 * dt;
        } else if (kind === 'heal' || kind === 'buff') {
          v[0] += dt * (kind === 'heal' ? 2.5 : 1.2);
          var rr = v[2] * (kind === 'buff' ? 1 - k * 0.3 : 1 - k * 0.5);
          pos[i * 3] = Math.cos(v[0]) * rr; pos[i * 3 + 2] = Math.sin(v[0]) * rr; pos[i * 3 + 1] += v[1] * dt;
        } else {
          pos[i * 3] += v[0] * dt; pos[i * 3 + 1] += v[1] * dt; pos[i * 3 + 2] += v[2] * dt;
        }
      }
      geo.attributes.position.needsUpdate = true;
      pm.opacity = 1 - smooth(0.5, 1, k);
      pm.size = (kind === 'fizzle' ? 0.55 + k * 0.5 : 0.32 * (1 - k * 0.4));
      if (extra) {
        if (kind === 'hit') { var s = (0.4 + k * 2.2) * 0.5; extra.scale.setScalar(s); extraMat.opacity = 0.8 * (1 - smooth(0, 0.6, k)); }
        else { var s2 = kind === 'heal' ? 0.6 + k * 1.2 : 1; extra.scale.set(s2, s2, s2); extra.position.y = kind === 'buff' ? 0.05 + k * 2.0 : 0.05; extraMat.opacity = 0.8 * (1 - smooth(0.4, 1, k)); }
      }
      if (age >= life) { done = true; root.visible = false; free(); return false; }
      return true;
    };
    return root;
  };

  // charmIcon: geometry cached per (kind, colour); materials cached -> nothing to free.
  M.charmIcon = function (colorHex, kind) {
    need();
    var col = C(colorHex || '#ffd76a');
    var geos = cachedGeos('charm_' + (kind || 'absorb') + hx(col), function (B) {
      switch (kind) {
        case 'blade':
          B.add(G.oct(0.1), col, { p: [0, 0.1, 0], s: [0.5, 2.0, 0.25] });
          B.add(G.box(0.18, 0.035, 0.05), sh(col, -0.3), { p: [0, -0.07, 0] });
          B.add(G.cyl(0.02, 0.02, 0.08, 5), sh(col, -0.4), { p: [0, -0.12, 0] });
          break;
        case 'trap':
          B.add(G.tor(0.11, 0.032, 4, 6), col, { r: [0, 0, PI / 6] });
          B.add(G.oct(0.04), sh(col, 0.4), {});
          break;
        case 'shield':
          B.add(G.cyl(0.13, 0.13, 0.04, 16), col, { r: [PI / 2, 0, 0] });
          B.add(G.tor(0.13, 0.022, 4, 16), sh(col, 0.4), {});
          break;
        case 'weakness':
          B.add(G.cone(0.11, 0.13, 4), col, { p: [0, -0.07, 0], r: [PI, PI / 4, 0] });
          B.add(G.box(0.07, 0.15, 0.07), col, { p: [0, 0.06, 0] });
          break;
        case 'absorb':
        default:
          B.add(G.sph(0.03, 6, 4), '#ffffff', { p: [-0.045, 0.05, 0.1] });
          break;
      }
    });
    var root = new T.Group(); root.name = 'charm_' + kind;
    var spin = pivot(root);
    spin.add(smesh(geos.s, vcGlowMat()));
    if (kind === 'absorb' || !kind) {
      var bub = smesh(UG.sph(), M.glow(col, 0.45)); bub.scale.setScalar(0.13);
      spin.add(bub);
    }
    var h = halo(col, 0.45, 0.6); root.add(h);
    root.userData.kind = kind;
    root.userData.anim = function (t) { spin.rotation.y = t * 2.5; spin.position.y = Math.sin(t * 3) * 0.03; };
    return root;
  };

  // ==================================================================
  //  DISPOSE (v0.2)
  //  Frees every NON-shared geometry / material / texture under root.
  //  Skips: material.userData.cached, texture.userData.cached,
  //         geometry.userData.sharedGeometry or mesh.userData.sharedGeometry,
  //         sprite geometry (three.js shares ONE quad across all sprites).
  //  Calls obj.userData.dispose() first where present (text sprites, spell FX,
  //  bursts, sigils, auras). Safe to call twice and on anything models.js built.
  //  It does NOT detach root from its parent: remove it yourself.
  // ==================================================================
  var TEX_SLOTS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'emissiveMap', 'envMap', 'lightMap', 'specularMap', 'gradientMap', 'displacementMap', 'roughnessMap', 'metalnessMap'];
  M.dispose = function (root) {
    if (!root || typeof root.traverse !== 'function') return;
    var geos = [], mats = [], texs = [];
    function addU(arr, x) { if (x && arr.indexOf(x) < 0) arr.push(x); }
    function tex(t) { if (t && t.isTexture && !(t.userData && t.userData.cached)) addU(texs, t); }
    root.traverse(function (o) {
      var ud = o.userData || {};
      if (typeof ud.dispose === 'function') { try { ud.dispose(); } catch (e) { /* keep going */ } }
      if (o.geometry && !o.isSprite && !ud.sharedGeometry && !(o.geometry.userData && o.geometry.userData.sharedGeometry)) addU(geos, o.geometry);
      if (o.isInstancedMesh && typeof o.dispose === 'function') { try { o.dispose(); } catch (e) { /* r149 */ } }
      var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m || (m.userData && m.userData.cached)) continue;
        addU(mats, m);
        for (var s = 0; s < TEX_SLOTS.length; s++) tex(m[TEX_SLOTS[s]]);
        if (m.uniforms) for (var u in m.uniforms) { if (m.uniforms[u]) tex(m.uniforms[u].value); }
      }
    });
    geos.forEach(function (g) { g.dispose(); });
    mats.forEach(function (m) { m.dispose(); });
    texs.forEach(function (t) { t.dispose(); });
    return { geometries: geos.length, materials: mats.length, textures: texs.length };
  };

  // ==================================================================
  //  SPELL FX (v0.2)
  //  spellFx(kind, colorHex, from, to, opts) -> Group (already placed in world space)
  //  See docs/design/art-bible.md section 6 for the full visual language.
  //
  //  Colour rule: every effect has a NORMAL-blended coloured body (reads on bright
  //  meadows AND dark ruins) plus small ADDITIVE hot cores/sparks. Purely additive
  //  effects wash out to white on the daytime zones, so never build a spell from
  //  additive layers alone.
  // ==================================================================
  var UPV = new T.Vector3(0, 1, 0), ZERO = new T.Vector3(), _m4 = new T.Matrix4(), _va = new T.Vector3(), _vb = new T.Vector3(), _v2 = new T.Vector2(), _fd = new T.Vector3(), _up2 = new T.Vector3();
  function seg(a, t0, t1) { return clamp((a - t0) / (t1 - t0), 0, 1); }
  function eOut(k) { return 1 - Math.pow(1 - k, 3); }
  function eIn(k) { return k * k; }
  function eInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function eBack(k) { var c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  function rgb(c) { var k = C(c); return [k.r, k.g, k.b]; }
  var _oy = new T.Vector3();
  function orientY(obj, dir) { _oy.copy(dir); if (_oy.lengthSq() < 1e-8) _oy.set(0, 1, 0); obj.quaternion.setFromUnitVectors(UPV, _oy.normalize()); }
  // +Z of obj along dir (Matrix4.lookAt puts +Z along eye - target)
  function faceDir(obj, dir) {
    if (dir.lengthSq() < 1e-8) return;
    _fd.copy(dir).normalize();
    _m4.lookAt(_fd, ZERO, Math.abs(_fd.y) > 0.995 ? _up2.set(0, 0, 1) : UPV);
    obj.quaternion.setFromRotationMatrix(_m4);
  }
  function bez(p0, p1, p2, p3, t, out) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return out.set(p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
  }
  function toV(v) { if (!v) return new T.Vector3(); if (v.isVector3) return v.clone(); if (Array.isArray(v)) return new T.Vector3(v[0] || 0, v[1] || 0, v[2] || 0); return new T.Vector3(v.x || 0, v.y || 0, v.z || 0); }

  // ---------- canvas textures ----------
  function starTex() {
    return ctex('fx_star', function () {
      var c = canvas(64, 64), x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.6)'); g.addColorStop(0.45, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#ffffff'; x.beginPath();
      for (var i = 0; i < 8; i++) { var a = i * PI / 4 - PI / 2, r = i % 2 ? 7 : 31; if (!i) x.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); else x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
      x.closePath(); x.fill();
      return new T.CanvasTexture(c);
    });
  }
  function smokeTex() {
    return ctex('fx_smoke', function () {
      var c = canvas(64, 64), x = c.getContext('2d'), r = seeded(99);
      for (var i = 0; i < 7; i++) {
        var px = 22 + r() * 20, py = 22 + r() * 20, rr = 12 + r() * 10;
        var g = x.createRadialGradient(px, py, 0, px, py, rr);
        g.addColorStop(0, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
      }
      return new T.CanvasTexture(c);
    });
  }
  // soft round "puff" with a firmer body than the halo (coloured normal-blend particles)
  function puffTex() {
    return ctex('fx_puff', function () {
      var c = canvas(64, 64), x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 31);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(0.8, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    });
  }
  // vertical gradient (bright bottom -> clear top) for pillars, walls, aura shells
  function vgradTex() {
    return ctex('fx_vgrad', function () {
      var c = canvas(8, 128), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 128, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 8, 128);
      return new T.CanvasTexture(c);
    });
  }
  // streaks around a cylinder (beams): scrolls along V for a "flowing" beam
  function beamTex() {
    return ctex('fx_beam', function () {
      var c = canvas(64, 64), x = c.getContext('2d'), r = seeded(5);
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillRect(0, 0, 64, 64);
      for (var i = 0; i < 14; i++) {
        var px = r() * 64, w = 3 + r() * 6, py = r() * 64, h = 14 + r() * 30;
        var g = x.createLinearGradient(0, py, 0, py + h);
        g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.55)');
        x.fillStyle = g; x.fillRect(px, py, w, h); x.fillRect(px, py - 64, w, h);
      }
      var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping;
      return t;
    });
  }
  function fxTex(kind) { return kind === 'star' ? starTex() : kind === 'smoke' ? smokeTex() : kind === 'puff' ? puffTex() : haloTex(); }

  // ---------- materials ----------
  // particle material: per-vertex colour+alpha+size, so ONE cached material serves every
  // particle system of that (texture, blending) pair; per-instance cost = 1 geometry.
  function pointScale(renderer, scene, camera) {
    var m = this.material;
    renderer.getDrawingBufferSize(_v2);
    m.uniforms.uScale.value = camera.isPerspectiveCamera ? _v2.y * 0.5 / Math.tan(camera.fov * PI / 360) : _v2.y * 0.05;
  }
  function partMat(texKind, additive) {
    return cmat('pm_' + texKind + (additive ? 'a' : 'n'), function () {
      return new T.ShaderMaterial({
        uniforms: { map: { value: fxTex(texKind) }, uScale: { value: 500 } },
        vertexShader: [
          'attribute float aSize; attribute vec4 aColor; uniform float uScale; varying vec4 vC;',
          'void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          '  gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }'].join('\n'),
        fragmentShader: [
          'uniform sampler2D map; varying vec4 vC;',
          'void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = vC.a * t.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb * t.rgb, a); }'].join('\n'),
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending
      });
    });
  }
  function addMat(color, opacity) { return M.glow(color, opacity === undefined ? 1 : opacity, true); }   // additive highlight
  function bodyMat(color, opacity) { return M.glow(color, opacity === undefined ? 0.9 : opacity); }      // unlit coloured body (normal blend)
  function vcAddMat() {
    return cmat('vcadd', function () { var m = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }); m.forceSinglePass = true; return m; });
  }
  function vcBodyMat(op) {
    return cmat('vcbody' + op, function () { return new T.MeshBasicMaterial({ vertexColors: true, transparent: op < 1, opacity: op, depthWrite: op >= 1, side: T.DoubleSide }); });
  }
  // inverted-hull glow rim (back faces of an inflated copy, additive)
  function rimMat(color, op) {
    return cmat('rim' + hx(color) + (op || 0.8), function () { var m = new T.MeshBasicMaterial({ color: C(color), side: T.BackSide, transparent: true, opacity: op || 0.8, blending: T.AdditiveBlending, depthWrite: false }); m.forceSinglePass = true; return m; });
  }
  function gradMat(color, additive) {
    return new T.MeshBasicMaterial({ color: C(color), map: vgradTex(), transparent: true, blending: additive ? T.AdditiveBlending : T.NormalBlending, depthWrite: false, side: T.DoubleSide });
  }

  function Parts(n, texKind, additive) {
    var geo = new T.BufferGeometry();
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 4), siz = new Float32Array(n);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aColor', new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aSize', new T.BufferAttribute(siz, 1).setUsage(T.DynamicDrawUsage));
    var vel = new Float32Array(n * 3), age = new Float32Array(n), life = new Float32Array(n), s0 = new Float32Array(n), s1 = new Float32Array(n);
    var c0 = new Float32Array(n * 3), c1 = new Float32Array(n * 3), a0 = new Float32Array(n), grav = new Float32Array(n), drag = new Float32Array(n);
    var pts = new T.Points(geo, partMat(texKind, additive));
    pts.frustumCulled = false; pts.renderOrder = additive ? 12 : 11;
    pts.onBeforeRender = pointScale;
    var head = 0, live = 0;
    return {
      obj: pts, geo: geo, n: n,
      // emit(x,y,z, vx,vy,vz, life, size0, size1, rgb0, rgb1, alpha, gravity(+up), drag)
      emit: function (x, y, z, vx, vy, vz, lf, sa, sb, ca, cb, al, g, dr) {
        var i = head; head = (head + 1) % n; live++;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        age[i] = 0; life[i] = lf; s0[i] = sa; s1[i] = sb;
        c0[i * 3] = ca[0]; c0[i * 3 + 1] = ca[1]; c0[i * 3 + 2] = ca[2];
        cb = cb || ca; c1[i * 3] = cb[0]; c1[i * 3 + 1] = cb[1]; c1[i * 3 + 2] = cb[2];
        a0[i] = al === undefined ? 1 : al; grav[i] = g || 0; drag[i] = dr || 0;
      },
      update: function (dt) {
        if (!live) return;
        var steps = dt > 0.05 ? Math.ceil(dt / 0.05) : 1, h = dt / steps, alive = 0;
        for (var i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          var i3 = i * 3;
          for (var s = 0; s < steps; s++) {
            var d = Math.max(0, 1 - drag[i] * h);
            vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * h; vel[i3 + 2] *= d;
            pos[i3] += vel[i3] * h; pos[i3 + 1] += vel[i3 + 1] * h; pos[i3 + 2] += vel[i3 + 2] * h;
          }
          if (pos[i3 + 1] < 0.02) { pos[i3 + 1] = 0.02; vel[i3 + 1] = Math.abs(vel[i3 + 1]) * 0.2; }
          age[i] += dt;
          var k = age[i] / life[i];
          if (k >= 1) { life[i] = 0; siz[i] = 0; col[i * 4 + 3] = 0; continue; }
          alive++;
          siz[i] = s0[i] + (s1[i] - s0[i]) * k;
          col[i * 4] = c0[i3] + (c1[i3] - c0[i3]) * k;
          col[i * 4 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * k;
          col[i * 4 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * k;
          col[i * 4 + 3] = a0[i] * Math.min(1, k * 10) * (1 - k * k);
        }
        live = alive;
        geo.attributes.position.needsUpdate = true; geo.attributes.aColor.needsUpdate = true; geo.attributes.aSize.needsUpdate = true;
      }
    };
  }
  function Rate(r) { var acc = 0; return function (dt, fn) { acc += r * dt; var n = Math.floor(acc); acc -= n; for (var i = 0; i < n; i++) fn((i + 1) / n); }; }

  // ---------- palettes & school lookup ----------
  // a = school colour, b = lighter, core = near-white, hot = bright highlight, deep = saturated dark
  var FXPAL = {
    emberstrike: { a: '#ff6b2d', b: '#ffa63a', core: '#fff3c8', hot: '#ffd23a', deep: '#c81e08' },
    stoneward: { a: '#d4a25f', b: '#f2be6a', core: '#fff1d2', hot: '#ffb347', deep: '#7a4a1a', rock: '#8f7c63', rock2: '#a8936f', dust: '#b49a76' },
    tidecaller: { a: '#3fb8ea', b: '#8fe4ff', core: '#f0fcff', hot: '#d8f8ff', deep: '#1a5fb0' },
    lumen: { a: '#ffd04a', b: '#ffe890', core: '#fffdf2', hot: '#fff3b0', deep: '#d88a10' },
    hollow: { a: '#a879ff', b: '#d0b0ff', core: '#f3e8ff', hot: '#e2d0ff', deep: '#4a1e98', smoke: '#1e0f33', smoke2: '#3d2266', eye: '#9dff5a' }
  };
  function schoolOf(colorHex) {
    if (colorHex === undefined || colorHex === null) return null;
    var h = hx(colorHex), S = (window.WF.data && window.WF.data.schools) || {};
    for (var id in S) { if (S[id] && S[id].color && hx(S[id].color) === h) return id; }
    for (var k in FXPAL) { if (hx(FXPAL[k].a) === h) return k; }
    return null;
  }
  function fxPalette(school, colorHex) {
    var base = FXPAL[school], p = {};
    if (base) for (var k in base) p[k] = C(base[k]);
    var tint = colorHex !== undefined && colorHex !== null ? C(colorHex) : null;
    var schoolCol = school && window.WF.data && window.WF.data.schools && window.WF.data.schools[school] ? hx(window.WF.data.schools[school].color) : null;
    if (!base || (tint && hx(tint) !== hx(base.a) && hx(tint) !== schoolCol)) {
      var a = tint || C('#ffd76a');
      p.a = a; p.b = sh(a, 0.3); p.core = sh(a, 0.85); p.hot = sh(a, 0.55); p.deep = sh(a, -0.4);
    }
    if (!p.rock) { p.rock = C('#8f7c63'); p.rock2 = C('#a8936f'); p.dust = C('#b49a76'); }
    if (!p.smoke) { p.smoke = sh(p.a, -0.85); p.smoke2 = sh(p.a, -0.65); p.eye = C('#9dff5a'); }
    p.A = [p.a.r, p.a.g, p.a.b]; p.Bc = [p.b.r, p.b.g, p.b.b]; p.Co = [p.core.r, p.core.g, p.core.b];
    p.H = [p.hot.r, p.hot.g, p.hot.b]; p.D = [p.deep.r, p.deep.g, p.deep.b];
    return p;
  }

  // ---------- FX scaffold ----------
  // setup(ctx) -> tick(age, dt). ctx.fade(baseMat) clones a cached material for
  // per-instance opacity; ctx.parts() makes a particle system. Both are freed
  // automatically when the FX ends (or by WF.models.dispose()).
  function makeFx(q, opts, dur, impact, setup) {
    var root = new T.Group(); root.name = 'spellFx_' + q.kind + '_' + (q.school || 'custom');
    var res = { mats: [], geos: [], freed: false }, parts = [];
    var ctx = {
      q: q, root: root, pal: q.pal, S: q.S, r: q.r,
      fade: function (base) { var m = base.clone(); m.userData = {}; m.transparent = true; m.depthWrite = false; res.mats.push(m); return m; },
      own: function (m) { res.mats.push(m); return m; },
      parts: function (n, tex, additive) {
        var p = Parts(Math.max(8, Math.round(n * q.n)), tex || 'soft', additive !== false);
        res.geos.push(p.geo); root.add(p.obj); parts.push(p); return p;
      },
      mesh: function (geo, mat, parent) { var m = smesh(geo, mat); (parent || root).add(m); return m; }
    };
    var tick = setup(ctx);
    var delay = Math.max(0, +opts.delay || 0), age = 0, done = false;
    function free() {
      if (res.freed) return; res.freed = true;
      res.mats.forEach(function (m) { m.dispose(); }); res.geos.forEach(function (g) { g.dispose(); });
    }
    root.userData.kind = q.kind; root.userData.school = q.school;
    root.userData.impact = impact + delay; root.userData.duration = dur + delay;
    root.userData.dispose = free;
    root.userData.update = function (dt) {
      if (done) return false;
      dt = Math.max(0, dt || 0); age += dt;
      var a = age - delay;
      if (a < 0) { root.visible = false; return true; }
      root.visible = true;
      tick(a, dt);
      for (var i = 0; i < parts.length; i++) parts[i].update(dt);
      if (a >= dur) { done = true; root.visible = false; free(); return false; }
      return true;
    };
    tick(0, 0);
    root.visible = delay <= 0;
    return root;
  }

  // ---------- school particle flavours ----------
  // ctx.pc = coloured puffs (normal blend, the readable mass), ctx.pa = additive sparks,
  // ctx.pn = smoke/dust (normal blend, stoneward + hollow only)
  function stdParts(ctx, n) {
    var sc = ctx.q.school;
    ctx.pc = ctx.parts(Math.round(n * 0.6), sc === 'lumen' ? 'star' : 'puff', false);
    ctx.pa = ctx.parts(Math.round(n * 0.4), sc === 'lumen' ? 'star' : 'soft', true);
    ctx.pn = sc === 'stoneward' || sc === 'hollow' ? ctx.parts(Math.round(n * 0.5), 'smoke', false) : null;
  }
  function emitTrail(ctx, x, y, z) {
    var q = ctx.q, p = q.pal, S = q.S, r = q.r, pa = ctx.pa, pc = ctx.pc, pn = ctx.pn;
    function j(s) { return (r() - 0.5) * s; }
    switch (q.school) {
      case 'stoneward':
        pn.emit(x + j(0.3), y + j(0.3), z + j(0.3), j(0.6), 0.2 + r() * 0.4, j(0.6), 0.55 + r() * 0.35, 0.35 * S, 1.0 * S, rgb(p.dust), rgb(sh(p.dust, -0.25)), 0.7, 0.3, 2.5);
        if (r() < 0.5) pc.emit(x + j(0.25), y + j(0.25), z + j(0.25), j(1.4), r() * 1.0, j(1.4), 0.45, 0.16 * S, 0.1 * S, rgb(p.rock2), rgb(p.rock), 1, -8, 0.5);
        if (r() < 0.35) pa.emit(x + j(0.25), y + j(0.25), z + j(0.25), j(1.2), r() * 0.8, j(1.2), 0.35, 0.2 * S, 0.02, p.H, p.A, 1, -3, 1);
        break;
      case 'tidecaller':
        pc.emit(x + j(0.25), y + j(0.25), z + j(0.25), j(1.0), r() * 0.6, j(1.0), 0.45 + r() * 0.25, 0.26 * S, 0.12 * S, p.Bc, p.D, 0.95, -7, 0.5);
        if (r() < 0.5) pa.emit(x + j(0.3), y + j(0.3), z + j(0.3), j(0.6), r() * 0.5, j(0.6), 0.35, 0.22 * S, 0.02, p.Co, p.Bc, 0.8, -2, 1);
        break;
      case 'lumen':
        pc.emit(x + j(0.35), y + j(0.35), z + j(0.35), j(0.6), j(0.6) + 0.3, j(0.6), 0.45 + r() * 0.35, (0.36 + r() * 0.22) * S, 0.04, p.A, p.D, 1, 0, 1.5);
        if (r() < 0.6) pa.emit(x + j(0.35), y + j(0.35), z + j(0.35), j(0.5), j(0.5), j(0.5), 0.35, 0.28 * S, 0.02, p.Co, p.A, 0.9, 0, 1.5);
        break;
      case 'hollow':
        pn.emit(x + j(0.3), y + j(0.3), z + j(0.3), j(0.4), 0.15 + r() * 0.3, j(0.4), 0.6 + r() * 0.4, 0.38 * S, 1.1 * S, rgb(p.smoke2), rgb(p.smoke), 0.8, 0.3, 2);
        if (r() < 0.5) pc.emit(x + j(0.3), y + j(0.3), z + j(0.3), j(0.6), j(0.6), j(0.6), 0.4, 0.26 * S, 0.06, p.A, p.D, 0.9, 0, 2);
        if (r() < 0.4) pa.emit(x + j(0.3), y + j(0.3), z + j(0.3), j(1.0), j(1.0), j(1.0), 0.3, 0.18 * S, 0.02, p.Bc, p.A, 1, 0, 2);
        break;
      default: // emberstrike + custom colours: flame puffs that cool from orange to red, plus hot sparks
        pc.emit(x + j(0.25), y + j(0.25), z + j(0.25), j(0.7), 0.5 + r() * 0.8, j(0.7), 0.3 + r() * 0.25, (0.48 + r() * 0.2) * S, 0.12 * S, p.Bc, p.D, 0.95, 1.6, 2.0);
        if (r() < 0.55) pa.emit(x + j(0.25), y + j(0.25), z + j(0.25), j(1.2), 0.6 + r() * 1.2, j(1.2), 0.3 + r() * 0.3, 0.2 * S, 0.02, p.H, p.A, 1, 1.0, 1.0);
    }
  }
  function emitBurst(ctx, x, y, z, count, power) {
    var q = ctx.q, p = q.pal, S = q.S, r = q.r, pa = ctx.pa, pc = ctx.pc, pn = ctx.pn;
    count = Math.round(count * q.n);
    for (var i = 0; i < count; i++) {
      var th = r() * TAU, el = Math.asin(r() * 1.6 - 0.6), sp = power * (2 + r() * 3.5);
      var dx = Math.cos(th) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(th) * Math.cos(el);
      var m3 = i % 3;
      switch (q.school) {
        case 'stoneward':
          if (m3 === 0) pn.emit(x + dx * 0.3, Math.max(0.25, y - 0.4) + dy * 0.2, z + dz * 0.3, dx * sp * 0.5, Math.abs(dy) * sp * 0.25, dz * sp * 0.5, 0.8 + r() * 0.5, 0.6 * S, 1.9 * S, rgb(p.dust), rgb(sh(p.dust, -0.3)), 0.75, 0.2, 3);
          else if (m3 === 1) pc.emit(x, y, z, dx * sp, dy * sp + 2, dz * sp, 0.6 + r() * 0.3, 0.2 * S, 0.14 * S, rgb(p.rock2), rgb(p.rock), 1, -12, 0.6);
          else pa.emit(x, y, z, dx * sp, dy * sp + 1, dz * sp, 0.4 + r() * 0.3, 0.24 * S, 0.03, p.H, p.A, 1, -9, 1.5);
          break;
        case 'tidecaller':
          if (m3 < 2) pc.emit(x + dx * 0.2, y, z + dz * 0.2, dx * sp * 0.7, Math.abs(dy) * sp + 2.5, dz * sp * 0.7, 0.6 + r() * 0.4, (0.32 + r() * 0.16) * S, 0.14 * S, p.Bc, p.D, 1, -11, 0.4);
          else pa.emit(x + dx * 0.2, y, z + dz * 0.2, dx * sp * 0.5, Math.abs(dy) * sp + 1.5, dz * sp * 0.5, 0.5, 0.3 * S, 0.02, p.Co, p.Bc, 0.9, -8, 0.6);
          break;
        case 'lumen':
          if (m3 < 2) pc.emit(x, y, z, dx * sp, dy * sp, dz * sp, 0.5 + r() * 0.4, (0.5 + r() * 0.3) * S, 0.04, p.A, p.D, 1, 0, 3.5);
          else pa.emit(x, y, z, dx * sp * 0.7, dy * sp * 0.7, dz * sp * 0.7, 0.5, 0.45 * S, 0.02, p.Co, p.A, 1, 0, 3);
          break;
        case 'hollow':
          if (m3 === 0) pn.emit(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, dx * sp * 0.45, dy * sp * 0.45 + 0.4, dz * sp * 0.45, 0.8 + r() * 0.5, 0.55 * S, 1.8 * S, rgb(p.smoke2), rgb(p.smoke), 0.85, 0.2, 3);
          else if (m3 === 1) pc.emit(x, y, z, dx * sp, dy * sp, dz * sp, 0.45 + r() * 0.3, 0.34 * S, 0.05, p.A, p.D, 1, 0, 2.5);
          else pa.emit(x, y, z, dx * sp, dy * sp, dz * sp, 0.4, 0.22 * S, 0.02, p.Bc, p.A, 1, 0, 2.5);
          break;
        default:
          if (m3 < 2) pc.emit(x, y, z, dx * sp, dy * sp + 0.8, dz * sp, 0.4 + r() * 0.3, (0.55 + r() * 0.3) * S, 0.12 * S, p.Bc, p.D, 1, 2.0, 2.4);
          else pa.emit(x, y, z, dx * sp * 1.2, dy * sp + 1, dz * sp * 1.2, 0.4 + r() * 0.3, 0.22 * S, 0.02, p.H, p.A, 1, 0, 1.5);
      }
    }
  }

  // rock debris (stoneward): shared dodecahedron + cached toon materials
  function Debris(ctx, n) {
    var q = ctx.q, S = q.S, r = q.r, list = [];
    n = Math.max(2, Math.round(n * q.n));
    var mats = [M.toon(q.pal.rock, { flat: true }), M.toon(q.pal.rock2, { flat: true })];
    for (var i = 0; i < n; i++) { var m = ctx.mesh(UG.dod(), mats[i % 2]); m.visible = false; m.castShadow = true; list.push({ m: m, v: new T.Vector3(), w: new T.Vector3(), s: 0, t: -1 }); }
    return {
      launch: function (at, power) {
        list.forEach(function (d) {
          var th = r() * TAU, sp = (2 + r() * 3) * power;
          d.m.position.copy(at); d.v.set(Math.cos(th) * sp, 3 + r() * 4 * power, Math.sin(th) * sp);
          d.w.set(r() * 10, r() * 10, r() * 10); d.s = (0.12 + r() * 0.16) * S; d.t = 0; d.m.visible = true;
        });
      },
      update: function (dt) {
        list.forEach(function (d) {
          if (d.t < 0) return;
          d.t += dt;
          d.v.y -= 14 * dt; d.m.position.addScaledVector(d.v, dt);
          if (d.m.position.y < d.s * 0.6) { d.m.position.y = d.s * 0.6; d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
          d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
          var k = 1 - smooth(0.6, 1.0, d.t);
          d.m.scale.setScalar(d.s * k);
          if (k <= 0) { d.m.visible = false; d.t = -1; }
        });
      }
    };
  }

  // impact: small hot flash + coloured puff + ground shock ring + school burst (+ debris for stone)
  function Impact(ctx) {
    var q = ctx.q, pal = q.pal, S = q.S;
    var flash = ctx.mesh(UG.sph(), ctx.fade(addMat(q.school === 'hollow' ? pal.b : pal.hot, 0.9))); flash.visible = false;
    var ring = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.b, 0.9))); ring.visible = false; ring.renderOrder = 4;
    var debris = q.school === 'stoneward' ? Debris(ctx, 7) : null;
    var t = -1, sz = 1;
    return {
      go: function (p, size, nParts) {
        t = 0; sz = size || 1;
        flash.visible = ring.visible = true;
        flash.position.copy(p); ring.position.set(p.x, 0.08, p.z);
        emitBurst(ctx, p.x, p.y, p.z, nParts || 36 * sz, Math.sqrt(sz));
        if (debris) debris.launch(_vb.set(p.x, Math.max(0.3, p.y * 0.5), p.z), Math.sqrt(sz));
      },
      tick: function (dt) {
        if (debris) debris.update(dt);
        if (t < 0) return;
        t += dt;
        var k = t / 0.5;
        if (k >= 1) { flash.visible = ring.visible = false; if (!debris) t = -1; return; }
        flash.scale.setScalar((0.15 + 0.4 * eOut(Math.min(1, k * 4))) * Math.min(sz, 1.6) * S);
        flash.material.opacity = 0.8 * (1 - smooth(0.0, 0.3, k));
        flash.visible = k < 0.3;
        ring.scale.setScalar((0.3 + 2.2 * eOut(k)) * sz * S);
        ring.material.opacity = 0.85 * (1 - k);
      }
    };
  }

  // ---------- cached creature / prop geometry for spells ----------
  // Stone arm: pivot at the elbow (y=0) pointing +Y; fist at the top, knuckles on the +Y end face.
  function stoneArmGeos(len) {
    return cachedGeos('stoneArm' + len, function (B) {
      var st = C('#9a8a70'), st2 = C('#6f604c'), st3 = C('#b9a37e'), moss = C('#6a8a4a'), rune = C('#ffb347');
      // forearm: tapered, flat-shaded, with armour-like slabs and a mossy elbow
      B.add(G.cyl(0.5, 0.68, len, 7), st, { p: [0, len / 2, 0], flat: true });
      for (var i = 0; i < 5; i++) {
        var a = i * TAU / 5 + 0.3;
        B.add(G.box(0.46, len * (0.34 + (i % 2) * 0.12), 0.22), i % 2 ? st2 : st3, { p: [Math.cos(a) * 0.58, len * (0.28 + (i % 3) * 0.2), Math.sin(a) * 0.58], r: [0, -a + PI / 2, 0.06 * (i - 2)], flat: true });
      }
      B.add(G.dod(0.8, 0), st2, { p: [0, 0.1, 0], s: [1, 0.6, 1], flat: true });
      B.add(G.ico(0.55, 0), moss, { p: [0.25, 0.42, -0.35], s: [1, 0.35, 1], flat: true });
      B.add(G.cyl(0.72, 0.72, 0.32, 8), st2, { p: [0, len - 0.02, 0], flat: true });            // wrist band
      for (var r2 = 0; r2 < 3; r2++) B.glow(G.box(0.08, len * 0.55, 0.05), rune, { p: [Math.cos(r2 * 2.1) * 0.62, len * 0.5, Math.sin(r2 * 2.1) * 0.62], r: [0, -r2 * 2.1 + PI / 2, 0.15 * (r2 - 1)] });
      B.glow(G.tor(0.74, 0.04, 4, 16), rune, { p: [0, len - 0.02, 0], r: [PI / 2, 0, 0] });
      // FIST (much wider than the wrist so the silhouette reads as a hand)
      var f = len + 0.85;
      B.add(G.box(1.75, 1.3, 1.25), st, { p: [0, f, -0.05], flat: true });                    // back of hand / palm
      B.add(G.box(1.55, 0.35, 1.0), st3, { p: [0, f - 0.62, -0.1], flat: true });              // heel of the palm
      for (var k = 0; k < 4; k++) {
        var x = -0.62 + k * 0.415;
        B.add(G.dod(0.27, 0), k % 2 ? st3 : st, { p: [x, f + 0.7, 0.18], s: [1.05, 0.85, 1.1], flat: true });   // knuckles (+Y end)
        B.add(G.box(0.37, 0.95, 0.42), k % 2 ? st : st3, { p: [x, f + 0.18, 0.6], r: [-0.12, 0, 0], flat: true });   // curled fingers (front, +Z)
        B.add(G.box(0.33, 0.3, 0.3), st2, { p: [x, f - 0.32, 0.72], flat: true });             // fingertips tucked in
      }
      B.add(G.box(1.25, 0.38, 0.4), st3, { p: [0.12, f - 0.18, 0.92], r: [0, 0, 0.12], flat: true });   // thumb across the fingers
      B.add(G.box(0.45, 0.7, 0.45), st, { p: [0.82, f - 0.25, 0.55], r: [0.2, 0, -0.35], flat: true });  // thumb base
      B.glow(G.box(1.4, 0.07, 0.05), rune, { p: [0, f + 0.25, -0.69] });
      B.glow(G.box(0.07, 0.9, 0.05), rune, { p: [-0.35, f, -0.69] });
      B.glow(G.box(0.07, 0.6, 0.05), rune, { p: [0.4, f - 0.1, -0.69] });
    });
  }
  function stoneArm(ctx, len, parent) {
    var g = stoneArmGeos(len), grp = new T.Group();
    if (g.f) { var m = ctx.mesh(g.f, vcMat(true), grp); m.castShadow = true; }
    if (g.s) ctx.mesh(g.s, vcMat(false), grp);
    if (g.g) ctx.mesh(g.g, vcGlowMat(), grp);
    if (g.f) ctx.mesh(SG('rim_arm' + len, function () { return inflate(g.f, 0.06); }), rimMat('#ffb347', 0.45), grp);
    (parent || ctx.root).add(grp);
    return grp;
  }
  // Winged creature (phoenix | raven): body + two wing pivots. Faces +Z, wing extends +X.
  function wingGeos(kind) {
    return cachedGeos('wing_' + kind, function (B) {
      var raven = kind === 'raven', n = 7;
      for (var i = 0; i < n; i++) {
        var u = i / (n - 1), len = raven ? 1.3 + u * 1.4 : 1.25 + u * 1.75, ang = -0.15 + u * 0.95;
        var col = raven ? mix('#2a1450', '#6a42b8', u * 0.8) : mix('#ffd23a', '#e82a08', Math.pow(u, 0.9));
        var cx = Math.cos(ang) * len * 0.5 + u * 0.35, cz = -Math.sin(ang) * len * 0.5;
        if (raven) B.glow(G.cone(0.2, len, 4), col, { p: [cx, 0, cz], r: [0, ang, -PI / 2], s: [1, 1, 0.25], order: 'YXZ' });
        else B.glow(G.sph(1, 10, 6), col, { p: [cx, 0, cz], r: [0, ang, 0], s: [len * 0.5, 0.06, 0.2 + 0.05 * (1 - u)] });
      }
      for (var c2 = 0; c2 < 4; c2++) {                                                         // coverts
        var u2 = c2 / 3, l2 = 0.95 + u2 * 0.65, a2 = -0.05 + u2 * 0.6;
        B.glow(G.sph(1, 8, 5), raven ? mix('#1e0f33', '#3d2266', u2) : mix('#fff3c8', '#ff9a2a', u2), { p: [Math.cos(a2) * l2 * 0.5 + 0.1, 0.05, -Math.sin(a2) * l2 * 0.5 + 0.05], r: [0, a2, 0], s: [l2 * 0.5, 0.07, 0.24] });
      }
    });
  }
  function birdBodyGeos(kind) {
    return cachedGeos('bird_' + kind, function (B) {
      if (kind === 'raven') {
        var d = C('#24123e'), d2 = C('#3a1f66');
        B.glow(G.sph(1, 12, 8), d, { s: [0.42, 0.42, 0.95] });
        B.glow(G.sph(0.34, 10, 8), d2, { p: [0, 0.2, 0.85] });
        B.glow(G.cone(0.13, 0.55, 5), '#8a7aa8', { p: [0, 0.14, 1.32], r: [PI / 2, 0, 0], s: [1, 1, 0.7] });
        B.glow(G.sph(0.08, 6, 5), '#9dff5a', { p: [0.2, 0.3, 1.0] });
        B.glow(G.sph(0.08, 6, 5), '#9dff5a', { p: [-0.2, 0.3, 1.0] });
        for (var t = 0; t < 5; t++) B.glow(G.cone(0.16, 1.2, 4), mix('#24123e', '#5a3a9a', t / 4), { p: [(t - 2) * 0.16, 0, -1.25], r: [-PI / 2 + 0.05, 0, (t - 2) * 0.18], s: [1, 1, 0.3] });
        for (var c = 0; c < 3; c++) B.glow(G.cone(0.07, 0.4, 4), '#3a1f66', { p: [(c - 1) * 0.12, 0.5, 0.75], r: [-0.6, 0, (c - 1) * 0.4] });
      } else {
        B.glow(G.sph(1, 12, 8), '#ffe27a', { s: [0.42, 0.44, 0.95] });
        B.glow(G.sph(1, 10, 8), '#fff3c8', { p: [0, -0.08, 0.25], s: [0.3, 0.3, 0.55] });
        B.glow(G.sph(0.32, 10, 8), '#ffc43a', { p: [0, 0.32, 0.85] });
        B.glow(G.cone(0.1, 0.42, 5), '#fff3c8', { p: [0, 0.28, 1.25], r: [PI / 2, 0, 0] });
        B.glow(G.sph(0.06, 6, 5), '#5a1a00', { p: [0.16, 0.4, 1.05] });
        B.glow(G.sph(0.06, 6, 5), '#5a1a00', { p: [-0.16, 0.4, 1.05] });
        for (var k = 0; k < 3; k++) B.glow(G.taper([[0, 0.5, 0.75], [0, 0.95, 0.45 - k * 0.25], [0, 1.1 + k * 0.1, -0.1 - k * 0.35]], 0.08, 0.01, 6, 4), mix('#ff9a2a', '#e82a08', k / 2), { p: [(k - 1) * 0.08, 0, 0] });
        for (var i = 0; i < 5; i++) {
          var sx = (i - 2) * 0.32;
          B.glow(G.taper([[0, 0, -0.7], [sx * 0.6, -0.15, -1.8], [sx, 0.15 + Math.abs(sx) * 0.4, -3.1 - (2 - Math.abs(i - 2)) * 0.4]], 0.16, 0.03, 8, 4), mix('#ffb03a', '#e82a08', 0.2 + Math.abs(i - 2) * 0.35));
        }
      }
    });
  }
  function Winged(ctx, kind, scale) {
    var root = new T.Group(); ctx.root.add(root);
    var inner = pivot(root); inner.scale.setScalar(scale);
    var raven = kind === 'raven';
    var mat = vcGlowMat();
    var bg = birdBodyGeos(kind).g, wg = wingGeos(kind).g;
    var rimC = raven ? '#b48aff' : '#ffb347';
    ctx.mesh(bg, mat, inner);
    ctx.mesh(SG('rim_body_' + kind, function () { return inflate(bg, 0.08); }), rimMat(rimC, 0.85), inner);
    var wR = pivot(inner, 0.3, 0.12, 0.15), wL = pivot(inner, -0.3, 0.12, 0.15);
    var rwG = SG('rim_wing_' + kind, function () { return inflate(wg, 0.06); });
    ctx.mesh(wg, mat, wR); ctx.mesh(rwG, rimMat(rimC, 0.85), wR);
    ctx.mesh(wg, mat, wL).scale.x = -1; ctx.mesh(rwG, rimMat(rimC, 0.85), wL).scale.x = -1;
    var glow = halo(raven ? '#8a5aff' : '#ff8a2a', 4.2 * scale, raven ? 0.5 : 0.55); inner.add(glow);
    return {
      root: root, inner: inner, glow: glow,
      flap: function (ang, fold) { wR.rotation.set(0, fold || 0, ang); wL.rotation.set(0, -(fold || 0), -ang); }
    };
  }
  // Leviathan head (faces +Z), water body colours
  function levHeadGeos() {
    return cachedGeos('levHead', function (B) {
      var a = C('#3fb8ea'), b = C('#8fe4ff'), w = C('#f0fcff'), d = C('#1a5fb0');
      B.glow(G.sph(1, 14, 10), a, { s: [0.75, 0.62, 1.05] });
      B.glow(G.sph(1, 12, 8), b, { p: [0, 0.12, 0.85], s: [0.55, 0.38, 0.75] });             // snout
      B.glow(G.sph(1, 12, 8), d, { p: [0, -0.32, 0.75], s: [0.5, 0.18, 0.75], r: [0.35, 0, 0] }); // jaw
      for (var i = 0; i < 5; i++) B.glow(G.cone(0.05, 0.22, 4), w, { p: [(i - 2) * 0.17, -0.08, 1.25 - Math.abs(i - 2) * 0.08], r: [PI, 0, 0] });
      [-1, 1].forEach(function (s) {
        B.glow(G.sph(0.13, 8, 6), '#ffffff', { p: [s * 0.42, 0.3, 0.55], s: [1, 0.7, 1] });
        B.glow(G.sph(0.06, 6, 5), '#0a2a5a', { p: [s * 0.48, 0.31, 0.6] });
        B.glow(G.taper([[s * 0.35, 0.4, 0.1], [s * 0.55, 0.8, -0.5], [s * 0.6, 1.0, -1.2]], 0.12, 0.02, 6, 4), b);           // horns
        B.glow(G.cone(0.32, 0.9, 4), b, { p: [s * 0.75, -0.05, -0.2], r: [0, 0, -s * 1.3], s: [1, 1, 0.25] });            // side fins
      });
      for (var f = 0; f < 3; f++) B.glow(G.cone(0.14, 0.55 - f * 0.1, 4), b, { p: [0, 0.6 - f * 0.05, 0.1 - f * 0.35], r: [-0.5, 0, 0], s: [0.3, 1, 1] }); // crest
    });
  }
  function sunSpikeGeos() {
    return cachedGeos('sunSpikes', function (B) {
      var dirs = new T.IcosahedronGeometry(1, 1), p = dirs.attributes.position, seen = {}, n = 0;
      for (var i = 0; i < p.count; i++) {
        var v = new T.Vector3().fromBufferAttribute(p, i).normalize(), key = v.x.toFixed(2) + v.y.toFixed(2) + v.z.toFixed(2);
        if (seen[key]) continue; seen[key] = 1; n++;
        var long = n % 2 === 0, L = long ? 1.8 : 1.15;
        B.glow(G.cone(0.16, L, 4), long ? '#ffc43a' : '#ffe890', { p: [v.x * (0.75 + L / 2), v.y * (0.75 + L / 2), v.z * (0.75 + L / 2)], dir: [v.x, v.y, v.z] });
      }
      dirs.dispose();
    });
  }
  // small swarm critters, all face +Z, wings along X (white vertex colours -> tinted by material colour)
  function critterGeos(kind) {
    return cachedGeos('critter_' + kind, function (B) {
      var w = '#ffffff', g2 = '#d8d8d8';
      if (kind === 'bird') {
        B.glow(G.sph(1, 8, 6), w, { s: [0.12, 0.12, 0.3] });
        B.glow(G.cone(0.16, 0.75, 3), g2, { p: [0.32, 0.02, -0.08], r: [0, 0.5, -PI / 2], s: [1, 1, 0.2], order: 'YXZ' });
        B.glow(G.cone(0.16, 0.75, 3), g2, { p: [-0.32, 0.02, -0.08], r: [0, -0.5, PI / 2], s: [1, 1, 0.2], order: 'YXZ' });
        B.glow(G.cone(0.1, 0.42, 3), g2, { p: [0, 0, -0.4], r: [-PI / 2, 0, 0], s: [1, 1, 0.25] });
      } else if (kind === 'fish') {
        B.glow(G.sph(1, 10, 6), w, { s: [0.11, 0.18, 0.38] });
        B.glow(G.cone(0.17, 0.28, 3), g2, { p: [0, 0, -0.45], r: [-PI / 2, 0, 0], s: [0.25, 1, 1] });
        B.glow(G.cone(0.08, 0.18, 3), g2, { p: [0, 0.19, -0.02], r: [-0.4, 0, 0], s: [0.25, 1, 1] });
      } else if (kind === 'butterfly') {
        B.glow(G.sph(1, 6, 4), w, { s: [0.04, 0.04, 0.16] });
        [-1, 1].forEach(function (s) {
          B.glow(G.disc(0.19, 10), w, { p: [s * 0.19, 0, 0.06], r: [-PI / 2, 0, 0], s: [1, 1.3, 1] });
          B.glow(G.disc(0.13, 10), g2, { p: [s * 0.14, 0, -0.13], r: [-PI / 2, 0, 0] });
        });
      } else { // feather
        B.glow(G.sph(1, 8, 4), w, { s: [0.1, 0.025, 0.4] });
        B.glow(G.cyl(0.01, 0.01, 0.95, 3), g2, { p: [0, 0.01, 0], r: [PI / 2, 0, 0] });
      }
    }).g;
  }
  // wave curl: width X (-0.5..0.5), height 1, crest leaning +Z; vertex colour = brightness
  function curlGeo() {
    return SG('fx_curl', function () {
      var prof = new T.CatmullRomCurve3([[-1.25, 0], [-0.75, 0.12], [-0.3, 0.5], [0.0, 0.88], [0.25, 1.04], [0.46, 0.94], [0.56, 0.72], [0.5, 0.56]].map(function (p) { return new T.Vector3(0, p[1], p[0]); }));
      var NX = 16, NS = 18, pos = [], colA = [], idx = [], P = new T.Vector3();
      for (var i = 0; i <= NX; i++) {
        var u = i / NX, x = u - 0.5, edge = Math.pow(Math.sin(u * PI), 0.6);
        for (var j = 0; j <= NS; j++) {
          var s = j / NS; prof.getPointAt(s, P);
          pos.push(x, P.y * (0.3 + 0.7 * edge), P.z * (0.7 + 0.3 * edge));
          var c = 0.55 + 0.45 * Math.pow(s, 1.4);
          if (s > 0.8) c = 1.0;
          colA.push(c, c, c);
        }
      }
      for (var i2 = 0; i2 < NX; i2++) for (var j2 = 0; j2 < NS; j2++) {
        var a = i2 * (NS + 1) + j2, b = a + NS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(colA, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    });
  }

  // Lightning strand: N shared-cylinder segments, re-jittered over time
  function Lightning(ctx, n, width, coreMat, glowMat) {
    var segs = [], cylG = SG('fx_cylC', function () { return new T.CylinderGeometry(1, 1, 1, 5, 1, true); });
    for (var i = 0; i < n; i++) segs.push([ctx.mesh(cylG, glowMat), ctx.mesh(cylG, coreMat)]);
    var pts = []; for (var k = 0; k <= n; k++) pts.push(new T.Vector3());
    var d = new T.Vector3(), mid = new T.Vector3(), perp1 = new T.Vector3(), perp2 = new T.Vector3();
    return {
      set: function (A, B, amp, r, w) {
        d.subVectors(B, A); perp1.crossVectors(d, UPV); if (perp1.lengthSq() < 1e-6) perp1.set(1, 0, 0); perp1.normalize(); perp2.crossVectors(d, perp1).normalize();
        for (var k = 0; k <= n; k++) {
          var u = k / n, e = Math.sin(u * PI) * amp;
          pts[k].lerpVectors(A, B, u).addScaledVector(perp1, (r() - 0.5) * 2 * e).addScaledVector(perp2, (r() - 0.5) * 2 * e);
        }
        for (var i = 0; i < n; i++) {
          d.subVectors(pts[i + 1], pts[i]); var L = d.length(); mid.addVectors(pts[i], pts[i + 1]).multiplyScalar(0.5);
          for (var s = 0; s < 2; s++) {
            var m = segs[i][s]; m.position.copy(mid); orientY(m, d);
            var ww = (s ? 0.33 : 1) * width * (w || 1);
            m.scale.set(ww, L + ww * 0.6, ww);
          }
        }
      },
      vis: function (v) { segs.forEach(function (p) { p[0].visible = p[1].visible = v; }); }
    };
  }

  var _beamV = new T.Vector3();
  function placeBeam(m, A, B, radius) {
    _beamV.subVectors(B, A); var L = _beamV.length();
    m.position.copy(A); orientY(m, _beamV); m.scale.set(radius, L, radius);
  }

  // =========================== KINDS ===========================
  var FXK = {};

  // ---- bolt: a carried projectile with a school "head" and trail ----
  FXK.bolt = function (q, opts) {
    var T1 = 0.4 + 0.035 * q.pips, dur = T1 + 0.55;
    return makeFx(q, opts, dur, T1, function (ctx) {
      var pal = q.pal, S = q.S, sc = q.school, r = q.r;
      stdParts(ctx, 200);
      var head = new T.Group(); ctx.root.add(head);
      var spinner = pivot(head), parts = [];
      var hal = halo(pal.a, 1.5 * S, 0.45); head.add(hal);
      if (sc === 'stoneward') {
        var rock = ctx.mesh(UG.dod(), M.toon(pal.rock2, { flat: true }), spinner); rock.scale.set(0.5 * S, 0.44 * S, 0.44 * S); rock.castShadow = true;
        ctx.mesh(SG('rim_dod', function () { return inflate(UG.dod(), 0.12); }), rimMat(pal.hot, 0.6), rock);
        for (var i = 0; i < 3; i++) { var pb = ctx.mesh(UG.dod(), M.toon(pal.rock, { flat: true }), spinner); pb.scale.setScalar(0.13 * S); parts.push(pb); }
      } else if (sc === 'hollow') {
        var dk = ctx.mesh(UG.sph(), M.glow(pal.smoke), spinner); dk.scale.setScalar(0.26 * S);
        ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.a, 0.9), dk);
        var sh1 = ctx.mesh(UG.sph(), bodyMat(pal.a, 0.35), spinner); sh1.scale.setScalar(0.38 * S);
        for (var h2 = 0; h2 < 3; h2++) { var mo = ctx.mesh(UG.oct(), bodyMat(pal.b, 1), spinner); mo.scale.setScalar(0.09 * S); parts.push(mo); }
      } else if (sc === 'lumen') {
        var s1 = ctx.mesh(UG.oct(), bodyMat(pal.a, 1), spinner); s1.scale.set(0.13 * S, 0.6 * S, 0.13 * S);
        var s2 = ctx.mesh(UG.oct(), bodyMat(pal.a, 1), spinner); s2.scale.set(0.6 * S, 0.13 * S, 0.13 * S);
        var s3 = ctx.mesh(UG.sph(), M.glow(pal.core), spinner); s3.scale.setScalar(0.17 * S);
        ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.hot, 0.8), s3);
      } else if (sc === 'tidecaller') {
        var wc = ctx.mesh(UG.sph(), M.glow(pal.core), spinner); wc.scale.setScalar(0.16 * S);
        var ws = ctx.mesh(UG.sph(), bodyMat(pal.a, 0.75), spinner); ws.scale.set(0.32 * S, 0.32 * S, 0.42 * S);
        var t1 = ctx.mesh(UG.tor(), bodyMat(pal.b, 0.95), spinner); t1.scale.setScalar(0.42 * S); parts.push(t1);
        var t2 = ctx.mesh(UG.tor(), bodyMat(pal.deep, 0.9), spinner); t2.scale.setScalar(0.34 * S); parts.push(t2);
      } else {
        var fc = ctx.mesh(UG.sph(), M.glow(pal.hot), spinner); fc.scale.setScalar(0.2 * S);
        var fo = ctx.mesh(UG.sph(), bodyMat(pal.a, 0.85), spinner); fo.scale.setScalar(0.34 * S); parts.push(fo);
        for (var f = 0; f < 4; f++) {   // flame tongues streaming backwards (-Z)
          var tg = ctx.mesh(UG.cone(), bodyMat(f === 0 ? pal.b : f === 3 ? pal.deep : pal.a, 0.85), head);
          tg.rotation.x = -PI / 2; tg.position.set(((f % 2) - 0.5) * 0.16 * S, (f < 2 ? 0.08 : -0.08) * S, 0.05);
          tg.userData.L = (0.95 - f * 0.12) * S; tg.scale.set(0.27 * S, tg.userData.L, 0.27 * S); parts.push(tg);
        }
      }
      var imp = Impact(ctx);
      var arcH = (sc === 'stoneward' ? 1.5 : sc === 'hollow' ? 0.5 : sc === 'lumen' ? 1.1 : 0.85) * clamp(q.dist / 9, 0.5, 1.4);
      var P0 = q.A, P1 = q.B, cur = new T.Vector3(), nxt = new T.Vector3(), prev = new T.Vector3().copy(P0), hit = false;
      var trail = Rate((sc === 'stoneward' ? 80 : 160) * q.n);
      function posAt(k, out) {
        out.lerpVectors(P0, P1, k); out.y += Math.sin(k * PI) * arcH;
        if (sc === 'hollow') out.addScaledVector(q.side, Math.sin(k * PI * 2) * 0.55 * (1 - k));
        return out;
      }
      return function (a, dt) {
        var k = Math.min(1, a / T1);
        if (!hit) {
          var kk = sc === 'stoneward' ? k : eInOut(k) * 0.3 + k * 0.7;
          posAt(kk, cur); posAt(Math.min(1, kk + 0.03), nxt).sub(cur);
          if (nxt.lengthSq() > 1e-6) faceDir(head, nxt);
          head.position.copy(cur);
          head.scale.setScalar(smooth(0, 0.1, a));
          spinner.rotation.z = a * 9; spinner.rotation.x = a * (sc === 'stoneward' ? 11 : 3);
          if (sc === 'stoneward') parts.forEach(function (pb, i) { var an = a * 8 + i * 2.1; pb.position.set(Math.cos(an) * 0.55 * S, Math.sin(an) * 0.55 * S, 0); });
          else if (sc === 'hollow') parts.forEach(function (mo, i) { var an = -a * 12 + i * 2.1; mo.position.set(Math.cos(an) * 0.46 * S, Math.sin(an) * 0.46 * S, Math.sin(an * 2) * 0.1); });
          else if (sc === 'tidecaller') { parts[0].rotation.set(a * 7, 0, a * 3); parts[1].rotation.set(0, a * 5, a * 9); }
          else if (sc !== 'lumen') parts.forEach(function (tg, i) { if (tg.userData.L) tg.scale.y = tg.userData.L * (1 + Math.sin(a * 40 + i * 2) * 0.2); });
          var hs = 1.5 * S * (1 + Math.sin(a * 30) * 0.08); hal.scale.set(hs, hs, 1);
          if (dt > 0) trail(dt, function (u) { _va.lerpVectors(prev, cur, u); emitTrail(ctx, _va.x, _va.y, _va.z); });
          prev.copy(cur);
          if (k >= 1) { hit = true; head.visible = false; imp.go(P1, 0.8 + q.pips * 0.1); }
        }
        imp.tick(dt);
      };
    });
  };

  // ---- meteor: falls from the sky behind the target ----
  FXK.meteor = function (q, opts) {
    var TI = 0.74 + 0.02 * q.pips, dur = TI + (q.school === 'stoneward' ? 0.75 : 0.6);
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, sc = q.school, r = q.r;
      stdParts(ctx, 300);
      var start = new T.Vector3(0, 6.6 + q.pips * 0.3, 0).addScaledVector(q.fwd, -3.4).addScaledVector(q.side, 2.0);
      var end = new T.Vector3(0, sc === 'stoneward' ? q.th * 0.25 : 0.35, 0);
      var tele = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.b, 0.9))); tele.position.y = 0.08; tele.renderOrder = 4;
      var teleD = ctx.mesh(UG.disc(), ctx.fade(bodyMat(pal.deep, 0.35))); teleD.position.y = 0.06; teleD.renderOrder = 3;
      var obj = new T.Group(); ctx.root.add(obj);
      var spin = pivot(obj), fist = null, hal = halo(pal.a, 2.6 * S, 0.5);
      S = S * 1.25;   // meteors are big
      obj.add(hal);
      if (sc === 'stoneward') {
        fist = stoneArm(ctx, 1.3, spin); fist.rotation.x = PI; fist.position.y = 1.3 + 0.85;   // knuckles down, origin ~ fist centre
        faceDir(obj, _va.copy(q.fwd).negate());                                                 // curled fingers face the caster/camera
        spin.scale.setScalar(0.8 * S); hal.scale.setScalar(2.0 * S);
      } else if (sc === 'tidecaller') {
        var drop = ctx.mesh(UG.sph(), bodyMat(pal.a, 0.8), spin); drop.scale.setScalar(0.62 * S);
        var dcore = ctx.mesh(UG.sph(), M.glow(pal.core), spin); dcore.scale.setScalar(0.3 * S);
        ctx.mesh(UG.cone(), bodyMat(pal.b, 0.6), obj).userData.tail = [0.62, 1.9];
        ctx.mesh(UG.tor(), bodyMat(pal.core, 0.9), spin).scale.setScalar(0.75 * S);
      } else if (sc === 'lumen') {
        [[0.2, 1.2, 0.2], [1.2, 0.2, 0.2], [0.2, 0.2, 1.2]].forEach(function (s) { var m = ctx.mesh(UG.oct(), bodyMat(pal.a, 1), spin); m.scale.set(s[0] * S, s[1] * S, s[2] * S); });
        var lg = ctx.mesh(UG.sph(), M.glow(pal.core), spin); lg.scale.setScalar(0.38 * S);
        ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.hot, 0.8), lg);
        ctx.mesh(UG.cone(), bodyMat(pal.b, 0.55), obj).userData.tail = [0.4, 2.0];
      } else if (sc === 'hollow') {
        var hk = ctx.mesh(UG.sph(), M.glow(pal.smoke), spin); hk.scale.setScalar(0.55 * S);
        ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.a, 0.9), hk);
        ctx.mesh(UG.cone(), bodyMat(pal.deep, 0.6), obj).userData.tail = [0.62, 2.2];
      } else {
        var rk = ctx.mesh(UG.dod(), M.toon('#5a2a1a', { flat: true, emissive: '#7a1a00', emissiveIntensity: 0.8 }), spin); rk.scale.setScalar(0.55 * S);
        var rs = ctx.mesh(UG.ico(), bodyMat(pal.a, 0.55), spin); rs.scale.setScalar(0.8 * S);
        ctx.mesh(UG.cone(), bodyMat(pal.a, 0.7), obj).userData.tail = [0.75, 2.4];
        ctx.mesh(UG.cone(), bodyMat(pal.hot, 0.8), obj).userData.tail = [0.42, 1.5];
      }
      var imp = Impact(ctx), hit = false, cur = new T.Vector3(), prev = new T.Vector3().copy(start), dir = new T.Vector3().subVectors(end, start).normalize();
      var trail = Rate(190 * q.n), t0 = 0.16, sinkT = -1;
      obj.children.forEach(function (c) {
        if (!c.userData.tail) return;
        c.geometry = UG.sph();                                   // comet tail = ellipsoid trailing back up the path
        c.quaternion.setFromUnitVectors(UPV, _va.copy(dir).negate());
        var tr = c.userData.tail[0] * S * 0.85, tl = c.userData.tail[1] * S * 0.62;
        c.scale.set(tr, tl, tr); c.position.copy(_va).multiplyScalar(tl * 0.75);
      });
      return function (a, dt) {
        var tk = seg(a, 0, TI);
        var after = hit ? Math.max(0, 1 - (a - TI) * 4) : 1;
        tele.scale.setScalar((0.25 + 1.25 * eOut(tk)) * S); tele.material.opacity = (0.5 + 0.4 * Math.abs(Math.sin(a * 14))) * after;
        teleD.scale.setScalar(1.3 * S * eOut(tk)); teleD.material.opacity = 0.35 * (hit ? after : tk);
        if (!hit) {
          var k = seg(a, t0, TI);
          cur.lerpVectors(start, end, Math.pow(k, 1.6));
          obj.position.copy(cur);
          obj.scale.setScalar(smooth(0, t0, a));
          if (sc === 'stoneward') spin.rotation.set(0, Math.sin(a * 4) * 0.25, Math.sin(a * 5) * 0.12);
          else spin.rotation.set(a * 5, a * 3, 0);
          if (dt > 0) trail(dt, function (u) { _va.lerpVectors(prev, cur, u); emitTrail(ctx, _va.x, _va.y, _va.z); if (sc !== 'stoneward') emitTrail(ctx, _va.x + (r() - 0.5) * 0.6 * S, _va.y, _va.z + (r() - 0.5) * 0.6 * S); });
          prev.copy(cur);
          if (k >= 1) {
            hit = true; imp.go(new T.Vector3(0, Math.max(0.5, q.th * 0.35), 0), 1.4 + q.pips * 0.1, 60);
            if (fist) sinkT = 0; else obj.visible = false;
          }
        } else if (fist && sinkT >= 0) {
          sinkT += dt;
          obj.position.y = end.y - smooth(0.25, 0.75, sinkT) * 2.6 * S;
          hal.scale.setScalar(2.0 * S * (1 - smooth(0, 0.3, sinkT)));
          if (sinkT > 0.75) obj.visible = false;
        }
        imp.tick(dt);
      };
    });
  };

  // ---- spike: erupts from the ground under the target ----
  FXK.spike = function (q, opts) {
    var TE = 0.3, TI = 0.4, dur = 1.05;
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, sc = q.school, r = q.r;
      stdParts(ctx, 320);
      var crack = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.b, 0.9))); crack.position.y = 0.08; crack.renderOrder = 4;
      var glowD = ctx.mesh(UG.disc(), ctx.fade(bodyMat(pal.deep, 0.4))); glowD.position.y = 0.06; glowD.renderOrder = 3;
      var spikes = [], cols = [], fountain = Rate(240 * q.n), rising = Rate(70 * q.n);
      var imp = Impact(ctx), hit = false;
      var H = (2.2 + q.pips * 0.22) * S;
      var solid = sc === 'stoneward' || sc === 'hollow';
      if (solid) {
        var nm = sc === 'stoneward' ? 7 : 8;
        var mA = sc === 'stoneward' ? M.toon(pal.rock2, { flat: true }) : M.glow(pal.smoke);
        var mB = sc === 'stoneward' ? M.toon(pal.rock, { flat: true }) : M.glow(pal.smoke2);
        for (var i = 0; i < nm; i++) {
          var centre = i === 0, a0 = i * TAU / (nm - 1) + r() * 0.4, rad = centre ? 0 : (0.75 + r() * 0.35) * S;
          var m = ctx.mesh(sc === 'stoneward' ? UG.cone5() : UG.cone(), i % 2 ? mA : mB);
          m.castShadow = true;
          var h = centre ? H : H * (0.45 + r() * 0.35), w = (centre ? 0.55 : 0.32 + r() * 0.12) * S * (sc === 'hollow' ? 0.7 : 1);
          m.position.set(Math.cos(a0) * rad, 0, Math.sin(a0) * rad);
          m.rotation.set(Math.sin(a0) * (centre ? 0.05 : 0.38), r() * TAU, -Math.cos(a0) * (centre ? 0.05 : 0.38), 'YXZ');
          m.userData.h = h; m.userData.w = w; m.userData.d = i * 0.025;
          spikes.push(m);
          if (sc === 'hollow') {
            ctx.mesh(SG('rim_cone', function () { return inflate(UG.cone(), 0.12); }), rimMat(pal.a, 0.7), m);
            var tip = ctx.mesh(UG.oct(), bodyMat(pal.b, 1), m); tip.position.y = 0.98; tip.scale.set(0.5, 0.12, 0.5);
          }
        }
      } else if (sc === 'tidecaller') {
        cols.push(ctx.mesh(UG.cylT(), ctx.fade(bodyMat(pal.a, 0.75))));
        cols.push(ctx.mesh(UG.cylT(), ctx.fade(bodyMat(pal.core, 0.7))));
      } else if (sc === 'lumen') {
        cols.push(ctx.mesh(UG.cyl(), ctx.own(gradMat(pal.a, false))));
        cols.push(ctx.mesh(UG.cyl(), ctx.fade(M.glow(pal.core, 0.9))));
      } else {
        for (var f = 0; f < 7; f++) {
          var inner = f < 2, fm = ctx.mesh(UG.cone(), inner ? M.glow(pal.hot, 0.95) : bodyMat(f % 2 ? pal.a : pal.deep, 0.85));
          var fa = f * 2.4; fm.position.set(Math.cos(fa) * (inner ? 0.05 : 0.32) * S, 0, Math.sin(fa) * (inner ? 0.05 : 0.32) * S);
          fm.userData.h = H * (inner ? 0.75 : 1 - (f - 2) * 0.1); fm.userData.w = (inner ? 0.3 : 0.55 + (f % 2) * 0.15) * S; fm.userData.d = 0;
          fm.renderOrder = inner ? 6 : 5;
          spikes.push(fm);
        }
      }
      return function (a, dt) {
        var kt = seg(a, 0, TE), ke = seg(a, TE, TE + 0.14), kr = seg(a, 0.72, 1.0);
        crack.scale.setScalar((0.3 + 1.1 * eOut(kt) + 0.4 * ke) * S); crack.material.opacity = 0.9 * (1 - kr) * (0.6 + 0.4 * Math.sin(a * 30));
        glowD.scale.setScalar((0.4 + 0.9 * kt) * S); glowD.material.opacity = 0.4 * (1 - kr);
        if (dt > 0 && a < TE) rising(dt, function () { var th = r() * TAU, rr = (0.5 + r() * 0.8) * S; emitTrail(ctx, Math.cos(th) * rr, 0.1, Math.sin(th) * rr); });
        spikes.forEach(function (m, i) {
          var k = seg(a, TE + (m.userData.d || 0), TE + 0.13 + (m.userData.d || 0));
          var grow = solid ? eBack(k) : eOut(k);
          var fl = solid ? 1 : 1 + Math.sin(a * 38 + i * 1.7) * 0.15;
          var y = grow * (1 - eIn(kr));
          m.scale.set(m.userData.w * (solid ? 1 : (1 + 0.2 * Math.sin(a * 25 + i))), Math.max(0.001, m.userData.h * y * fl), m.userData.w);
          if (solid) m.position.y = -kr * m.userData.h * 0.3;
          m.visible = y > 0.002;
        });
        if (cols.length) {
          var k2 = eOut(ke) * (1 - kr);
          if (sc === 'tidecaller') {
            placeBeam(cols[0], ZERO, _va.set(0, H * 1.35 * eOut(ke) * (1 - 0.5 * kr), 0), 0.8 * S * (1 + 0.08 * Math.sin(a * 30)));
            cols[0].material.opacity = 0.75 * k2;
            placeBeam(cols[1], ZERO, _va.set(0, H * 1.2 * eOut(ke) * (1 - 0.5 * kr), 0), 0.38 * S);
            cols[1].material.opacity = 0.7 * k2;
          } else {
            var top = 12, kk = eOut(seg(a, TE - 0.12, TE + 0.05));
            cols[0].scale.set(0.8 * S * (0.6 + 0.4 * ke), Math.max(0.01, top * kk), 0.8 * S * (0.6 + 0.4 * ke));
            cols[0].material.opacity = 0.95 * (1 - kr); cols[0].rotation.y = a * 2;
            cols[1].scale.set(0.24 * S, Math.max(0.01, top * kk * 0.6), 0.24 * S);
            cols[1].material.opacity = 0.9 * k2;
          }
        }
        if (dt > 0 && a > TE && a < 0.8) fountain(dt, function () {
          var th = r() * TAU, rr = r() * 0.5 * S, p = q.pal;
          if (sc === 'tidecaller') ctx.pc.emit(Math.cos(th) * rr, H * 1.1 * (0.6 + r() * 0.4), Math.sin(th) * rr, Math.cos(th) * (1 + r() * 2), 1 + r() * 3, Math.sin(th) * (1 + r() * 2), 0.6, 0.34 * S, 0.14 * S, p.Bc, p.D, 1, -10, 0.3);
          else if (sc === 'lumen') ctx.pc.emit(Math.cos(th) * rr * 1.6, r() * 0.5, Math.sin(th) * rr * 1.6, 0, 3 + r() * 4, 0, 0.8, 0.45 * S, 0.04, p.A, p.D, 1, 0, 0.5);
          else if (solid) { if (r() < 0.25) emitTrail(ctx, Math.cos(th) * rr * 2, 0.3, Math.sin(th) * rr * 2); }
          else emitTrail(ctx, Math.cos(th) * rr, r() * H * 0.7, Math.sin(th) * rr);
        });
        if (!hit && a >= TI) { hit = true; imp.go(q.B, 1 + q.pips * 0.08, 30); }
        imp.tick(dt);
      };
    });
  };

  // ---- wave: sweeps along the ground from caster to target ----
  FXK.wave = function (q, opts) {
    var D = q.dist, s0 = Math.min(0.9, D * 0.25), s1 = D + 1.6, Tt = 0.62 + 0.03 * q.pips;
    var kHit = clamp((D - s0 - 0.4) / (s1 - s0), 0.05, 1), TI = Tt * kHit, dur = Tt + 0.4;
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, sc = q.school, r = q.r;
      stdParts(ctx, 340);
      var dirT = q.fwd.clone().negate(), base = new T.Vector3(q.A.x, 0, q.A.z);
      var W = (2.4 + q.pips * 0.25) * S, H = (1.25 + q.pips * 0.12) * S;
      var body = new T.Group(); ctx.root.add(body); faceDir(body, dirT);
      var curl = null, curl2 = null, flames = [], rocks = [], arc = null, arc2 = null, ringG = null;
      if (sc === 'tidecaller') {
        curl = ctx.mesh(curlGeo(), ctx.own(new T.MeshBasicMaterial({ color: mix(pal.a, pal.deep, 0.25), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide })), body);
        curl2 = ctx.mesh(curlGeo(), ctx.own(new T.MeshBasicMaterial({ color: pal.b, vertexColors: true, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })), body);
      } else if (sc === 'stoneward') {
        curl = ctx.mesh(curlGeo(), M.toon(sh(pal.rock, -0.1), { flat: true, side: T.DoubleSide }), body); curl.castShadow = true;
        for (var b = 0; b < 6; b++) { var rb = ctx.mesh(UG.dod(), M.toon(b % 2 ? pal.rock2 : pal.rock, { flat: true }), body); rb.castShadow = true; rb.userData.x = (b - 2.5) / 5 * W * 0.8; rb.userData.s = (0.3 + r() * 0.2) * S; rocks.push(rb); }
      } else if (sc === 'hollow') {
        curl = ctx.mesh(curlGeo(), ctx.own(new T.MeshBasicMaterial({ color: mix(pal.smoke2, pal.a, 0.35), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide })), body);
        curl2 = ctx.mesh(curlGeo(), ctx.own(new T.MeshBasicMaterial({ color: pal.a, vertexColors: true, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })), body);
      } else if (sc === 'lumen') {
        var arcGeo = SG('fx_arcwall', function () { var g = new T.CylinderGeometry(1, 1, 1, 40, 1, true, -0.55, 1.1); g.translate(0, 0.5, 0); return g; });
        arc = ctx.mesh(arcGeo, ctx.own(gradMat(pal.a, false))); arc2 = ctx.mesh(arcGeo, ctx.own(gradMat(pal.core, true)));
        arc.position.copy(base); arc2.position.copy(base);
        var ang = Math.atan2(dirT.x, dirT.z); arc.rotation.y = arc2.rotation.y = ang;
        ringG = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.b, 0.8))); ringG.position.set(base.x, 0.08, base.z); ringG.renderOrder = 4;
      } else {
        for (var f = 0; f < 9; f++) {
          var fm = ctx.mesh(UG.cone(), bodyMat(f % 3 === 0 ? pal.deep : pal.a, 0.85), body);
          fm.userData.x = (f / 8 - 0.5) * W; fm.userData.ph = r() * 6;
          var fi = ctx.mesh(UG.cone(), M.glow(pal.hot, 0.95), body); fi.userData.x = fm.userData.x; fi.userData.ph = fm.userData.ph; fi.userData.inner = true; fi.renderOrder = 6;
          flames.push(fm, fi);
        }
      }
      var imp = Impact(ctx), hit = false, em = Rate(220 * q.n), front = new T.Vector3();
      return function (a, dt) {
        var k = seg(a, 0, Tt), dist = s0 + (s1 - s0) * k;
        front.copy(base).addScaledVector(dirT, dist);
        var rise = eOut(seg(a, 0, Tt * 0.3)), crash = smooth(kHit, 1, k), fadeEnd = seg(a, Tt, dur);
        if (curl) {
          body.position.copy(front);
          var hy = H * rise * (1 - 0.65 * crash) * (1 - fadeEnd);
          curl.scale.set(W, Math.max(0.001, hy), H * 1.05);
          if (sc === 'stoneward') curl.position.y = -fadeEnd * H;
          else curl.material.opacity = 0.95 * (1 - fadeEnd);
          if (curl2) { curl2.scale.set(W * 1.02, Math.max(0.001, hy * 1.04), H * 1.1); curl2.material.opacity = (sc === 'hollow' ? 0.5 : 0.35) * (1 - fadeEnd); }
          rocks.forEach(function (rb, i) { rb.position.set(rb.userData.x, hy * (i % 2 ? 0.95 : 0.55) + rb.userData.s * 0.5 + Math.abs(Math.sin(a * 9 + i)) * 0.15, (i % 2 ? 0.25 : 0.45) * H); rb.rotation.x = a * 12; rb.scale.setScalar(rb.userData.s * (1 - fadeEnd)); });
        } else if (arc) {
          var rr = Math.max(0.2, dist);
          arc.scale.set(rr, (1.4 + q.pips * 0.1) * S * rise * (1 - fadeEnd), rr); arc.material.opacity = 0.95 * (1 - crash * 0.4) * (1 - fadeEnd);
          arc2.scale.set(rr * 0.995, 0.7 * S * rise * (1 - fadeEnd), rr * 0.995); arc2.material.opacity = 0.7 * (1 - fadeEnd);
          ringG.scale.setScalar(rr); ringG.material.opacity = 0.6 * (1 - k);
        } else {
          body.position.copy(front);
          flames.forEach(function (fm) {
            var fl = 1 + 0.25 * Math.sin(a * 30 + fm.userData.ph);
            var edge = 1 - Math.pow(Math.abs(fm.userData.x) / (W * 0.55), 2);
            var hh = H * 1.35 * edge * rise * (1 - 0.5 * crash) * (1 - fadeEnd) * fl * (fm.userData.inner ? 0.55 : 1);
            fm.position.set(fm.userData.x, 0, fm.userData.inner ? 0.06 : 0);
            fm.scale.set((fm.userData.inner ? 0.24 : 0.5) * S, Math.max(0.001, hh), (fm.userData.inner ? 0.24 : 0.42) * S);
          });
        }
        if (dt > 0 && a < Tt) em(dt, function () {
          var x = (r() - 0.5) * W, pt = _va.copy(front).addScaledVector(q.side, x);
          if (arc) { var an = Math.atan2(dirT.x, dirT.z) + (r() - 0.5) * 1.1; pt.set(base.x + Math.sin(an) * dist, 0.2 + r() * 1.2 * S, base.z + Math.cos(an) * dist); }
          else pt.y = H * rise * (sc === 'tidecaller' || sc === 'hollow' ? 0.9 : 0.4) * (0.5 + r() * 0.5);
          emitTrail(ctx, pt.x, pt.y, pt.z);
        });
        if (!hit && a >= TI) { hit = true; imp.go(q.B, 1 + q.pips * 0.08, 30); }
        imp.tick(dt);
      };
    });
  };

  // ---- beam: lightning (ember), water serpent (tide), dark / light / sand beams ----
  FXK.beam = function (q, opts) {
    var sc = q.school, serpent = sc === 'tidecaller';
    var TC = 0.18, TI = serpent ? 0.62 : 0.26, TOFF = 0.72 + 0.03 * q.pips, dur = serpent ? 1.05 : TOFF + 0.22;
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, r = q.r, A = q.A, B = q.B;
      stdParts(ctx, 280);
      var orb = ctx.mesh(UG.sph(), ctx.fade(M.glow(pal.core, 1)));
      ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.a, 0.9), orb);
      orb.position.copy(A);
      var imp = Impact(ctx), hit = false, em = Rate(170 * q.n);
      var bolts = null, outer = null, inner = null, segs = [], head = null, pebbles = [];
      var L = A.distanceTo(B);
      if (sc === 'emberstrike' || !(sc in FXPAL)) {
        var core = M.glow('#fffbe8'), gl = bodyMat(pal.b, 0.7);
        bolts = [Lightning(ctx, 12, 0.16 * S, core, gl), Lightning(ctx, 7, 0.1 * S, core, gl)];
      } else if (serpent) {
        var n = 14, segMat = bodyMat(pal.a, 0.85), segIn = M.glow(pal.b, 0.7), finMat = bodyMat(pal.b, 0.9);
        for (var i = 0; i < n; i++) {
          var sgm = ctx.mesh(UG.sph(), segMat);
          if (!q.aoe) { var inn = ctx.mesh(UG.sphLo(), segIn, sgm); inn.scale.setScalar(0.6); inn.position.y = 0.25; }
          if (i % 3 === 1) { var fin = ctx.mesh(UG.cone(), finMat, sgm); fin.position.y = 0.6; fin.scale.set(0.22, 0.95, 0.6); }
          sgm.visible = false; segs.push(sgm);
        }
        head = new T.Group(); ctx.root.add(head);
        var hm = ctx.mesh(levHeadGeos().g, vcGlowMat(), head); hm.scale.setScalar(0.48 * S);
        ctx.mesh(SG('rim_lev', function () { return inflate(levHeadGeos().g, 0.07); }), rimMat(pal.b, 0.7), hm);
        head.visible = false;
      } else {
        var om = new T.MeshBasicMaterial({ color: sc === 'stoneward' ? pal.b : pal.a, map: beamTex(), transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide });
        outer = ctx.mesh(UG.cyl(), ctx.own(om));
        inner = ctx.mesh(UG.cyl(), ctx.fade(sc === 'hollow' ? M.glow(pal.smoke, 0.95) : M.glow(pal.core, 0.95)));
        if (sc === 'hollow') ctx.mesh(UG.cyl(), ctx.fade(rimMat(pal.a, 0.5)), inner).scale.set(1.6, 1, 1.6);
        if (sc === 'stoneward') for (var p = 0; p < 9; p++) { var pb = ctx.mesh(UG.dod(), M.toon(p % 2 ? pal.rock : pal.rock2, { flat: true })); pb.userData.o = r(); pb.userData.s = (0.12 + r() * 0.12) * S; pebbles.push(pb); }
      }
      var cur = new T.Vector3(), nxt = new T.Vector3(), jitT = 0, brA = new T.Vector3(), brB = new T.Vector3();
      var serpH = 1.6 + L * 0.12;
      function serpAt(u, out) { out.lerpVectors(A, B, u); out.y += Math.sin(u * PI) * serpH; out.addScaledVector(q.side, Math.sin(u * PI * 2.2) * 0.9 * (1 - u)); return out; }
      return function (a, dt) {
        var kc = seg(a, 0, TC), on = a >= TC && a < TOFF, koff = seg(a, TOFF, TOFF + 0.2);
        orb.scale.setScalar((0.12 + 0.22 * eOut(kc)) * S * (1 - koff) * (1 + 0.15 * Math.sin(a * 40)));
        orb.material.opacity = 1 - koff; orb.visible = koff < 1;
        if (bolts) {
          jitT -= dt;
          var vis = on || (a >= TOFF && a < TOFF + 0.12 && Math.sin(a * 90) > 0);
          bolts.forEach(function (b) { b.vis(vis); });
          if (vis && (jitT <= 0 || dt === 0)) {
            jitT = 0.045;
            bolts[0].set(A, B, 0.55 + L * 0.05, r, 1);
            brA.lerpVectors(A, B, 0.35 + r() * 0.3); brB.set(B.x + (r() - 0.5) * 1.5, B.y + (r() - 0.5) * 1.2, B.z + (r() - 0.5) * 1.5);
            bolts[1].set(brA, brB, 0.4, r, 0.8);
          }
          if (on && dt > 0) em(dt, function () { emitTrail(ctx, B.x + (r() - 0.5) * 0.5, B.y + (r() - 0.5) * 0.5, B.z + (r() - 0.5) * 0.5); });
        } else if (serpent) {
          var ku = seg(a, 0.1, TI), uHead = eInOut(ku) + (a > TI ? (a - TI) * 1.6 : 0);
          head.visible = a > 0.1 && uHead <= 1.0;
          if (head.visible) {
            serpAt(Math.min(1, uHead), cur); serpAt(Math.min(1, uHead + 0.02), nxt).sub(cur);
            head.position.copy(cur); if (nxt.lengthSq() > 1e-7) faceDir(head, nxt);
            head.scale.setScalar(smooth(0.1, 0.25, a));
          }
          segs.forEach(function (sgm, i) {
            var u = uHead - (i + 1) * 0.045;
            sgm.visible = a > 0.1 && u > 0 && u < 1;
            if (!sgm.visible) return;
            serpAt(u, sgm.position);
            var sz = (0.38 - i * 0.018) * S * smooth(0.1, 0.25, a);
            sgm.scale.setScalar(Math.max(0.02, sz));
            serpAt(Math.min(1, u + 0.02), nxt).sub(sgm.position); if (nxt.lengthSq() > 1e-7) faceDir(sgm, nxt);
          });
          if (dt > 0 && head.visible) em(dt, function () { emitTrail(ctx, cur.x, cur.y, cur.z); });
        } else {
          var w = on ? eOut(seg(a, TC, TC + 0.08)) : 1 - koff;
          if (a < TC) w = 0;
          var pulse = 1 + 0.12 * Math.sin(a * 45);
          placeBeam(outer, A, B, (sc === 'hollow' ? 0.36 : sc === 'stoneward' ? 0.42 : 0.38) * S * w * pulse);
          placeBeam(inner, A, B, (sc === 'hollow' ? 0.15 : 0.13) * S * w);
          outer.visible = inner.visible = w > 0.001;
          outer.material.map.offset.y = -a * 3;
          outer.material.opacity = 0.85 * w; inner.material.opacity = 0.95 * w;
          pebbles.forEach(function (pb) {
            var u = (pb.userData.o + a * 2.4) % 1; pb.visible = w > 0.05;
            pb.position.lerpVectors(A, B, u).addScaledVector(q.side, Math.sin(u * 20 + pb.userData.o * 9) * 0.25 * S); pb.position.y += Math.cos(u * 17 + pb.userData.o * 7) * 0.2 * S;
            pb.rotation.set(a * 10, a * 7, 0); pb.scale.setScalar(pb.userData.s * w);
          });
          if (on && dt > 0) em(dt, function () {
            var u = r(); _va.lerpVectors(A, B, u);
            var an = a * 12 + u * 14, rad = 0.4 * S;
            _va.addScaledVector(q.side, Math.cos(an) * rad); _va.y += Math.sin(an) * rad;
            emitTrail(ctx, _va.x, _va.y, _va.z);
          });
        }
        if (!hit && a >= TI) { hit = true; imp.go(B, 0.9 + q.pips * 0.1, 30); }
        imp.tick(dt);
      };
    });
  };

  // ---- swarm: a flight of small creatures (fire birds, fish, butterflies, feathers, pebbles) ----
  FXK.swarm = function (q, opts) {
    var n = Math.round(clamp(4 + q.pips, 5, 9) * (q.aoe ? 0.6 : 1)), TI = 0.62, dur = 1.0;
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, sc = q.school, r = q.r;
      stdParts(ctx, 260);
      var kind = sc === 'tidecaller' ? 'fish' : sc === 'lumen' ? 'butterfly' : sc === 'hollow' ? 'feather' : 'bird';
      var list = [], imp = Impact(ctx), hit = false, em = Rate(240 * q.n);
      var rimG = sc === 'stoneward' ? null : SG('rim_critter_' + kind, function () { return inflate(critterGeos(kind), 0.04); });
      for (var i = 0; i < n; i++) {
        var g = new T.Group(); ctx.root.add(g);
        var m;
        if (sc === 'stoneward') { m = ctx.mesh(UG.dod(), M.toon(i % 2 ? pal.rock : pal.rock2, { flat: true }), g); m.scale.setScalar((0.24 + r() * 0.1) * S); }
        else {
          var col = sc === 'hollow' ? (i % 2 ? pal.smoke : pal.smoke2) : (i % 3 === 0 ? pal.b : pal.a);
          m = ctx.mesh(critterGeos(kind), M.glow(col), g); m.scale.setScalar((kind === 'butterfly' ? 1.5 : 1.35) * S);
          ctx.mesh(rimG, rimMat(sc === 'hollow' ? pal.a : pal.hot, 0.8), m);
        }
        var hl = halo(pal.a, 0.8 * S, 0.4); g.add(hl);
        var t0 = i * 0.04 + r() * 0.03, tr = 0.48 + r() * 0.1, sd = (i % 2 ? 1 : -1) * (0.8 + r() * 1.6);
        var c1 = q.A.clone().addScaledVector(q.side, sd).add(_va.set(0, 0.6 + r() * 1.8, 0)).addScaledVector(q.fwd, -1.2);
        var c2 = q.B.clone().addScaledVector(q.side, sd * 0.6).add(_va.set(0, 0.8 + r() * 1.2, 0)).addScaledVector(q.fwd, 2.0);
        var end = q.B.clone().add(_va.set((r() - 0.5) * 0.5, (r() - 0.5) * 0.6, (r() - 0.5) * 0.5));
        list.push({ g: g, m: m, t0: t0, tr: tr, c1: c1, c2: c2, end: end, done: false, ph: r() * 6, s: m.scale.x });
      }
      var cur = new T.Vector3(), nx = new T.Vector3();
      return function (a, dt) {
        list.forEach(function (c) {
          var k = seg(a, c.t0, c.t0 + c.tr);
          c.g.visible = a >= c.t0 && k < 1;
          if (k >= 1 && !c.done) { c.done = true; emitBurst(ctx, c.end.x, c.end.y, c.end.z, 6, 0.6); }
          if (!c.g.visible) return;
          var kk = eInOut(k) * 0.4 + k * 0.6;
          bez(q.A, c.c1, c.c2, c.end, kk, cur); bez(q.A, c.c1, c.c2, c.end, Math.min(1, kk + 0.03), nx).sub(cur);
          c.g.position.copy(cur); if (nx.lengthSq() > 1e-7) faceDir(c.g, nx);
          var flap = Math.sin(a * (kind === 'butterfly' ? 34 : 28) + c.ph);
          if (sc === 'stoneward') c.m.rotation.set(a * 14, a * 9, 0);
          else if (kind === 'fish') c.m.rotation.y = flap * 0.35;
          else if (kind === 'feather') c.m.rotation.z = a * 10 + c.ph;
          else c.m.scale.x = c.s * (0.45 + 0.55 * Math.abs(flap));
          c.g.scale.setScalar(smooth(c.t0, c.t0 + 0.08, a));
        });
        if (dt > 0) em(dt, function () { var c = list[Math.floor(r() * list.length)]; if (c.g.visible) emitTrail(ctx, c.g.position.x, c.g.position.y, c.g.position.z); });
        if (!hit && a >= TI) { hit = true; imp.go(q.B, 0.9 + q.pips * 0.08, 24); }
        imp.tick(dt);
      };
    });
  };

  // ---- big: the 5+ pip "summoned moment" ----
  FXK.big = function (q, opts) {
    var extra = Math.max(0, q.pips - 5) * 0.08, TI = 1.3 + extra, dur = 2.05 + extra;
    var sc = q.school;
    return makeFx(q, opts, dur, TI, function (ctx) {
      var pal = q.pal, S = q.S, r = q.r, A = q.A, B = q.B;
      var BS = S / 1.45;           // ~1.03 at 5 pips (0.85x for AoE)
      stdParts(ctx, 560);
      var imp = Impact(ctx), hit = false, em = Rate(280 * q.n), em2 = Rate(130 * q.n);
      var rune = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.b, 0.9))); rune.renderOrder = 4; rune.position.y = 0.08;
      var runeD = ctx.mesh(UG.disc(), ctx.fade(bodyMat(pal.deep, 0.4))); runeD.renderOrder = 3; runeD.position.y = 0.06;
      var cur = new T.Vector3(), nxt = new T.Vector3(), tick2 = null;
      var shock2 = ctx.mesh(UG.ring(), ctx.fade(bodyMat(pal.a, 0.9))); shock2.visible = false; shock2.position.y = 0.09; shock2.renderOrder = 4;
      function bigImpact() {
        imp.go(new T.Vector3(0, Math.max(0.6, q.th * 0.4), 0), 1.6 * BS + 0.4, 90);
        shock2.visible = true;
      }
      function shockTick(a) {
        if (!shock2.visible) return;
        var k = seg(a, TI, TI + 0.6);
        shock2.scale.setScalar((0.5 + 5.0 * eOut(k)) * BS); shock2.material.opacity = 0.9 * (1 - k);
        if (k >= 1) shock2.visible = false;
      }
      if (sc === 'emberstrike' || sc === 'hollow' || !(sc in FXPAL)) {
        // PHOENIX (fire) / SHADOW RAVEN (hollow): rises behind the caster, then dives onto the target
        var raven = sc === 'hollow';
        var bird = Winged(ctx, raven ? 'raven' : 'phoenix', 1.05 * BS);
        var P0 = A.clone().setY(0.4).addScaledVector(q.fwd, 0.6).addScaledVector(q.side, 1.2), P1 = A.clone().setY(3.6 * BS + 0.8).addScaledVector(q.fwd, -0.6).addScaledVector(q.side, 2.4);
        var P2 = B.clone().setY(4.4 * BS + 0.8).addScaledVector(q.fwd, q.dist * 0.5).addScaledVector(q.side, 1.2), P3 = B.clone();
        rune.position.set(P0.x, 0.08, P0.z); runeD.position.set(P0.x, 0.06, P0.z);
        tick2 = function (a, dt) {
          var kr = seg(a, 0, 0.35);
          rune.scale.setScalar((0.5 + 1.6 * eOut(kr)) * BS); rune.material.opacity = 0.9 * (1 - seg(a, 0.8, 1.2)); rune.rotation.y = a * 2;
          runeD.scale.setScalar(1.8 * BS * eOut(kr)); runeD.material.opacity = 0.4 * (1 - seg(a, 0.8, 1.2));
          var u = a < 0.95 ? 0.42 * eOut(seg(a, 0.1, 0.95)) : 0.42 + 0.58 * eIn(seg(a, 0.95, TI));
          bez(P0, P1, P2, P3, u, cur); bez(P0, P1, P2, P3, Math.min(1, u + 0.01), nxt).sub(cur);
          bird.root.visible = a > 0.08 && a < TI;
          bird.root.position.copy(cur);
          if (a < 0.95) nxt.y *= 0.3;
          if (nxt.lengthSq() > 1e-8) faceDir(bird.root, nxt);
          var grow = eBack(seg(a, 0.08, 0.5));
          bird.inner.scale.setScalar(1.05 * BS * Math.max(0.01, grow));
          var dive = seg(a, 0.95, 1.15);
          bird.flap((0.15 + 0.75 * Math.sin(a * 11)) * (1 - dive) - 0.15 * dive, 0.15 + dive * 0.95);
          var gs = 4.2 * BS * (1 + 0.12 * Math.sin(a * 20)); bird.glow.scale.set(gs, gs, 1);
          if (dt > 0 && bird.root.visible) em(dt, function () {
            _va.set((r() - 0.5) * 2.4, (r() - 0.5) * 0.4, -0.6 - r() * 2.6).multiplyScalar(BS).applyQuaternion(bird.root.quaternion).add(cur);
            if (!raven || r() < 0.35) emitTrail(ctx, _va.x, _va.y, _va.z);
            else ctx.pa.emit(_va.x, _va.y, _va.z, (r() - 0.5), (r() - 0.5), (r() - 0.5), 0.45, 0.3 * BS, 0.02, pal.Bc, pal.A, 1, 0, 1);
          });
          if (dt > 0 && a > TI && a < TI + 0.45) em2(dt, function () {
            var th = r() * TAU, rr = r() * 2.2 * BS;
            if (raven) emitTrail(ctx, Math.cos(th) * rr, 0.3 + r() * 1.5, Math.sin(th) * rr);
            else ctx.pc.emit(Math.cos(th) * rr, 0.1, Math.sin(th) * rr, 0, 3 + r() * 4, 0, 0.6 + r() * 0.4, (0.7 + r() * 0.4) * BS, 0.1, pal.Bc, pal.D, 1, 1, 1.0);
          });
        };
      } else if (sc === 'tidecaller') {
        // LEVIATHAN: a water serpent towers out of a whirlpool behind the target and crashes down
        var NSEG = 16, segs = [];
        var segMat = bodyMat(pal.a, 0.85), segIn = M.glow(pal.b, 0.8), finMat = bodyMat(pal.b, 0.9), segRim = rimMat(pal.core, 0.45);
        var rimS = SG('rim_sph', function () { return inflate(UG.sph(), 0.18); });
        for (var i = 0; i < NSEG; i++) {
          var sg = ctx.mesh(UG.sph(), segMat);
          if (!q.aoe) { var inn = ctx.mesh(UG.sphLo(), segIn, sg); inn.scale.setScalar(0.62); inn.position.y = 0.28; ctx.mesh(rimS, segRim, sg); }   // AoE: 1 mesh per segment
          if (i % 2 === 0) { var fn = ctx.mesh(UG.cone(), finMat, sg); fn.position.y = 0.55; fn.scale.set(0.2, 0.95, 0.65); }
          sg.visible = false; segs.push(sg);
        }
        var head = new T.Group(); ctx.root.add(head);
        var hm2 = ctx.mesh(levHeadGeos().g, vcGlowMat(), head); hm2.scale.setScalar(1.2 * BS);
        ctx.mesh(SG('rim_lev', function () { return inflate(levHeadGeos().g, 0.07); }), rimMat(pal.b, 0.7), hm2);
        var hh = halo(pal.a, 3.5 * BS, 0.4); head.add(hh);
        var pool = B.clone().setY(-1.2).addScaledVector(q.fwd, -3.0 * BS).addScaledVector(q.side, 1.6 * BS);
        var C1 = pool.clone().setY(8.0 * BS), C2 = B.clone().setY(8.6 * BS).addScaledVector(q.fwd, -0.6), E = B.clone().setY(Math.max(0.4, B.y * 0.8));
        rune.position.set(pool.x, 0.08, pool.z); runeD.position.set(pool.x, 0.06, pool.z);
        var spout = ctx.mesh(UG.cylT(), ctx.fade(bodyMat(pal.a, 0.6))); spout.position.set(pool.x, 0, pool.z);
        var path = function (u, out) { return bez(pool, C1, C2, E, clamp(u, 0, 1), out); };
        tick2 = function (a, dt) {
          var kr = seg(a, 0, 0.35), kend = seg(a, 1.5, 2.0);
          rune.scale.setScalar((0.6 + 1.8 * eOut(kr)) * BS); rune.rotation.y = -a * 4; rune.material.opacity = 0.9 * (1 - kend);
          runeD.scale.setScalar(2.2 * BS * eOut(kr)); runeD.material.opacity = 0.45 * (1 - kend);
          spout.scale.set(1.1 * BS * (1 - kend), Math.max(0.01, 2.2 * BS * eOut(seg(a, 0.2, 0.5)) * (1 - seg(a, 1.0, 1.4))), 1.1 * BS * (1 - kend));
          spout.material.opacity = 0.6 * (1 - seg(a, 1.0, 1.4));
          var u = a < 1.0 ? 0.62 * eOut(seg(a, 0.25, 1.0)) : a < 1.08 ? 0.62 + 0.03 * seg(a, 1.0, 1.08) : 0.65 + 0.35 * eIn(seg(a, 1.08, TI));
          if (a > TI) u = 1 + (a - TI) * 1.3;
          var spacing = 0.05;
          head.visible = a > 0.25 && u <= 1.0;
          if (head.visible) {
            path(u, cur); path(u + 0.01, nxt).sub(cur);
            head.position.copy(cur); if (nxt.lengthSq() > 1e-8) faceDir(head, nxt);
            head.scale.setScalar(smooth(0.25, 0.45, a));
          }
          segs.forEach(function (sg, i) {
            var su = u - (i + 1) * spacing;
            sg.visible = a > 0.25 && su > 0.02 && su < 1;
            if (!sg.visible) return;
            path(su, sg.position);
            sg.scale.setScalar((0.85 - i * 0.035) * BS * (1 - smooth(0.85, 1, su) * 0.7));
            path(su + 0.01, nxt).sub(sg.position); if (nxt.lengthSq() > 1e-8) faceDir(sg, nxt);
          });
          if (dt > 0 && a > 0.25 && a < TI + 0.4) em(dt, function () {
            var idx = Math.floor(r() * NSEG), su = u - (idx + 1) * spacing;
            if (su <= 0 || su >= 1) return;
            path(su, _va); emitTrail(ctx, _va.x + (r() - 0.5) * BS, _va.y, _va.z + (r() - 0.5) * BS);
          });
          if (dt > 0 && a > 0.2 && a < 1.0) em2(dt, function () { var th = r() * TAU; ctx.pc.emit(pool.x + Math.cos(th) * 1.2 * BS, 0.2, pool.z + Math.sin(th) * 1.2 * BS, -Math.sin(th) * 2, 2 + r() * 3, Math.cos(th) * 2, 0.6, 0.38 * BS, 0.12, pal.Bc, pal.D, 1, -8, 0.5); });
          if (dt > 0 && a > TI && a < TI + 0.3) em2(dt, function () { var th = r() * TAU, sp = 2 + r() * 5; ctx.pc.emit(0, 0.4, 0, Math.cos(th) * sp, 5 + r() * 6, Math.sin(th) * sp, 0.9, 0.55 * BS, 0.15, pal.Bc, pal.D, 1, -12, 0.3); });
        };
      } else if (sc === 'stoneward') {
        // STONE TITAN: a colossal fist bursts out of the ground behind the target and slams down
        var Lr = 3.4, AS = 1.2 * BS, reachC = (Lr + 0.85) * AS, reach = (Lr + 1.6) * AS;
        var hT = Math.max(0.9, q.th * 0.42), thetaHit = Math.acos(clamp(hT / reachC, 0.05, 0.95)), dBack = reachC * Math.sin(thetaHit);
        var piv = new T.Group(); ctx.root.add(piv);
        piv.position.copy(q.fwd).multiplyScalar(-dBack);
        faceDir(piv, q.fwd);                      // +Z toward the target
        var armG = stoneArm(ctx, Lr, piv); armG.scale.setScalar(AS);
        var pillarsM = M.toon(pal.rock2, { flat: true }), pillars = [];
        for (var pI = 0; pI < 6; pI++) { var pm = ctx.mesh(UG.cone5(), pillarsM); var an = pI * TAU / 6 + 0.3; pm.position.set(piv.position.x + Math.cos(an) * 1.6 * BS, 0, piv.position.z + Math.sin(an) * 1.6 * BS); pm.rotation.set(Math.sin(an) * 0.5, 0, -Math.cos(an) * 0.5); pm.userData.h = (1.0 + r() * 0.8) * BS; pm.castShadow = true; pillars.push(pm); }
        rune.position.set(piv.position.x, 0.08, piv.position.z); runeD.position.set(piv.position.x, 0.06, piv.position.z);
        var debris2 = Debris(ctx, 10), launched = false;
        tick2 = function (a, dt) {
          var kr = seg(a, 0, 0.3), up = eOut(seg(a, 0.2, 0.75)), rear = seg(a, 0.75, 1.05), slam = eIn(seg(a, 1.05, TI)), sink = seg(a, 1.6, 2.0);
          rune.scale.setScalar((0.6 + 1.6 * eOut(kr)) * BS); rune.material.opacity = 0.9 * (1 - sink);
          runeD.scale.setScalar(2.0 * BS * eOut(kr)); runeD.material.opacity = 0.45 * (1 - sink);
          armG.position.y = (-reach - 0.5) * (1 - up) - sink * reach * 1.1;
          armG.rotation.x = -0.28 * eOut(rear) + (thetaHit + 0.28) * slam;
          pillars.forEach(function (pm, i) { var k = eBack(seg(a, 0.2 + i * 0.03, 0.4 + i * 0.03)) * (1 - sink); pm.scale.set(0.35 * BS, Math.max(0.001, pm.userData.h * k), 0.35 * BS); pm.visible = k > 0.002; });
          if (!launched && a > 0.3) { launched = true; debris2.launch(_vb.copy(piv.position).setY(0.3), 1.1); }
          debris2.update(dt);
          if (dt > 0 && a > 0.2 && a < 0.8) em2(dt, function () { var an2 = r() * TAU; emitTrail(ctx, piv.position.x + Math.cos(an2) * 1.4 * BS, 0.2, piv.position.z + Math.sin(an2) * 1.4 * BS); });
          if (dt > 0 && a > TI && a < TI + 0.35) em(dt, function () { var an3 = r() * TAU, rr = (0.5 + r() * 2.8) * BS; emitTrail(ctx, Math.cos(an3) * rr, 0.25, Math.sin(an3) * rr); });
        };
      } else {
        // LUMEN SUN: a radiant sun rises over the target and drops a pillar of light
        var sun = new T.Group(); ctx.root.add(sun);
        var sunH = 4.3 * BS + 0.9;
        var core2 = ctx.mesh(UG.sph(), M.glow(pal.core), sun); core2.scale.setScalar(0.85 * BS);
        ctx.mesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(pal.hot, 0.9), core2);
        var corona = ctx.mesh(UG.sph(), bodyMat(pal.a, 0.45), sun); corona.scale.setScalar(1.25 * BS);
        var spikes = ctx.mesh(sunSpikeGeos().g, vcGlowMat(), sun); spikes.scale.setScalar(1.1 * BS);
        var spikes2 = ctx.mesh(sunSpikeGeos().g, vcGlowMat(), sun); spikes2.scale.setScalar(0.75 * BS); spikes2.rotation.set(0.6, 0.4, 0.2);
        var sh1 = halo(pal.a, 8 * BS, 0.4); sun.add(sh1);
        var pillar = ctx.mesh(UG.cyl(), ctx.own(gradMat(pal.a, false)));
        var pillarIn = ctx.mesh(UG.cyl(), ctx.fade(M.glow(pal.core, 0.9)));
        pillar.rotation.x = PI; pillarIn.rotation.x = PI;     // hang down from the sun (gradient bright at the sun)
        rune.position.set(0, 0.08, 0); runeD.position.set(0, 0.06, 0);
        tick2 = function (a, dt) {
          var rise = eOut(seg(a, 0.0, 0.7)), charge = seg(a, 0.7, 1.12), drop = eIn(seg(a, 1.12, TI)), fade = seg(a, 1.45, 2.0);
          sun.position.set(0, sunH * (0.45 + 0.55 * rise), 0).addScaledVector(q.fwd, -0.6);
          var s = Math.max(0.01, eBack(seg(a, 0, 0.55)) * (1 + 0.25 * charge) * (1 - fade));
          sun.scale.setScalar(s);
          spikes.rotation.y = a * 1.4; spikes.rotation.z = a * 0.5; spikes2.rotation.y = -a * 2;
          spikes.scale.setScalar(1.1 * BS * (1 + 0.4 * charge + 0.15 * Math.sin(a * 16)));
          var hs = 8 * BS * (1 + 0.5 * charge) * s; sh1.scale.set(hs, hs, 1);
          rune.scale.setScalar((0.6 + 1.8 * eOut(seg(a, 0.3, 0.9))) * BS); rune.rotation.y = a * 1.5; rune.material.opacity = 0.9 * (1 - fade);
          runeD.scale.setScalar(2.0 * BS * eOut(seg(a, 0.3, 0.9))); runeD.material.opacity = 0.4 * (1 - fade);
          var len = sun.position.y * (a > 1.12 ? drop : 0);
          pillar.visible = pillarIn.visible = a > 1.12 && fade < 1;
          pillar.position.copy(sun.position); pillarIn.position.copy(sun.position);
          pillar.scale.set(1.0 * BS * (1 - fade), Math.max(0.01, len), 1.0 * BS * (1 - fade)); pillar.material.opacity = 0.9 * (1 - fade);
          pillarIn.scale.set(0.3 * BS * (1 - fade), Math.max(0.01, len), 0.3 * BS * (1 - fade)); pillarIn.material.opacity = 0.9 * (1 - fade);
          if (dt > 0 && a < 1.4) em(dt, function () {
            var th = r() * TAU, el = (r() - 0.5) * PI;
            _va.set(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el)).multiplyScalar(1.4 * BS * s).add(sun.position);
            emitTrail(ctx, _va.x, _va.y, _va.z);
          });
          if (dt > 0 && a > TI && a < TI + 0.5) em2(dt, function () { var th = r() * TAU, rr = r() * 1.5 * BS; ctx.pc.emit(Math.cos(th) * rr, 0.2, Math.sin(th) * rr, Math.cos(th) * 2, 4 + r() * 4, Math.sin(th) * 2, 0.8, 0.6 * BS, 0.04, pal.A, pal.D, 1, 0, 1); });
        };
      }
      return function (a, dt) {
        tick2(a, dt);
        if (!hit && a >= TI) { hit = true; bigImpact(); }
        shockTick(a);
        imp.tick(dt);
      };
    });
  };

  // Public: spellFx(kind, colorHex, from, to, opts)
  //   from / to: world-space points (THREE.Vector3 or [x,y,z]). from = where the spell
  //   leaves the caster (staff/chest height); to = the hit point on the target (chest).
  //   Ground-based kinds (meteor, spike, wave, big) use (to.x, 0, to.z).
  //   opts: { pips 1-7, school, aoe, delay (s), targetHeight, seed }
  //   Returns a Group already positioned at (to.x, 0, to.z): add it to the SCENE and don't move it.
  //   userData.update(dt) -> false when finished (hidden + per-instance GPU memory released)
  //   userData.impact / userData.duration in seconds from creation (delay included).
  M.SPELL_FX_KINDS = ['bolt', 'meteor', 'spike', 'wave', 'beam', 'swarm', 'big'];
  M.spellFx = function (kind, colorHex, from, to, opts) {
    need(); opts = opts || {};
    if (!FXK[kind]) kind = 'bolt';
    var school = opts.school || schoolOf(colorHex) || null;
    if (school && !FXPAL[school] && !(window.WF.data.schools || {})[school]) school = null;
    from = toV(from); to = toV(to);
    var pips = clamp(Math.round(opts.pips || (kind === 'big' ? 5 : 2)), 1, 7);
    var G0 = new T.Vector3(to.x, 0, to.z);
    var A = from.clone().sub(G0), B = new T.Vector3(0, Math.max(0.3, to.y), 0);
    var flat = new T.Vector3(A.x, 0, A.z), dist = flat.length();
    var fwd = dist > 1e-4 ? flat.clone().divideScalar(dist) : new T.Vector3(0, 0, 1);
    var q = {
      kind: kind, school: school, pal: fxPalette(school, colorHex), pips: pips,
      S: (0.85 + 0.13 * pips) * (opts.aoe ? 0.85 : 1), r: opts.seed !== undefined && opts.seed !== null ? seeded(opts.seed) : Math.random,
      A: A, B: B, fwd: fwd, side: new T.Vector3(fwd.z, 0, -fwd.x), dist: Math.max(dist, 0.5),
      th: opts.targetHeight || Math.max(1.4, B.y / 0.6), aoe: !!opts.aoe, n: opts.aoe ? 0.5 : 1
    };
    var root = FXK[kind](q, opts);
    root.position.copy(G0);
    return root;
  };
  // Engine helper: default fx kind for a card when card.fx is absent.
  M.spellFxKind = function (school, pips, type) {
    pips = pips || 1;
    if (type === 'aoe') return { stoneward: 'spike', tidecaller: 'wave', emberstrike: 'meteor', lumen: 'wave', hollow: 'wave' }[school] || 'wave';
    if (type === 'dot') return pips >= 3 ? (school === 'hollow' ? 'swarm' : 'spike') : 'swarm';
    if (pips >= 5) return 'big';
    if (pips <= 1) return 'bolt';
    var t = {
      stoneward: { 2: 'wave', 3: 'meteor', 4: 'spike' },
      tidecaller: { 2: 'bolt', 3: 'beam', 4: 'wave' },
      emberstrike: { 2: 'bolt', 3: 'swarm', 4: 'beam' },
      lumen: { 2: 'beam', 3: 'beam', 4: 'meteor' },
      hollow: { 2: 'bolt', 3: 'beam', 4: 'meteor' }
    }[school];
    return (t && t[pips]) || 'bolt';
  };
  // v1.1 (agent F): spell-creature builders for cine.js (read-only use; all geometry is cached/shared).
  // ctx = { root, mesh(geo, mat, parent) } (a cine stage or a makeFx ctx).
  M._fx = {
    stoneArm: stoneArm, stoneArmGeos: stoneArmGeos, levHeadGeos: levHeadGeos, sunSpikeGeos: sunSpikeGeos,
    critterGeos: critterGeos, curlGeo: curlGeo, wingGeos: wingGeos, birdBodyGeos: birdBodyGeos, Winged: Winged,
    Lightning: Lightning, Impact: Impact, Debris: Debris, emitTrail: emitTrail, emitBurst: emitBurst, stdParts: stdParts,
    Parts: Parts, partMat: partMat, fxPalette: fxPalette, FXPAL: FXPAL, bodyMat: bodyMat, addMat: addMat, rimMat: rimMat,
    gradMat: gradMat, beamTex: beamTex, vgradTex: vgradTex, sigilTex: sigilTex, ringTex: ringTex, starTex: starTex,
    smokeTex: smokeTex, puffTex: puffTex, placeBeam: placeBeam, inflate: inflate, faceDir: faceDir, orientY: orientY,
    bez: bez, seg: seg, eOut: eOut, eIn: eIn, eInOut: eInOut, eBack: eBack, Rate: Rate, rgb: rgb, halo: halo,
    SG: SG, smesh: smesh, cmat: cmat, ctex: ctex, UG: UG, G: G, cachedGeos: cachedGeos, Builder: Builder, pivot: pivot,
    C: C, hx: hx, sh: sh, mix: mix, clamp: clamp, smooth: smooth, seeded: seeded, canvas: canvas,
    vcMat: vcMat, vcGlowMat: vcGlowMat, schoolOf: schoolOf, haloTex: haloTex
  };

  // ==================================================================
  //  CAST SIGIL / PIPS / PHASE AURA (v0.2)
  // ==================================================================
  function sigilTex(school) {
    return ctex('sigil_' + (school || 'x'), function () {
      var N = 512, c = canvas(N, N), x = c.getContext('2d'), m = N / 2;
      x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
      x.shadowColor = 'rgba(255,255,255,0.9)'; x.shadowBlur = 10;
      var g0 = x.createRadialGradient(m, m, 0, m, m, 236);
      g0.addColorStop(0, 'rgba(255,255,255,0.28)'); g0.addColorStop(0.85, 'rgba(255,255,255,0.12)'); g0.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g0; x.beginPath(); x.arc(m, m, 236, 0, TAU); x.fill(); x.fillStyle = '#fff';
      x.lineWidth = 12; x.beginPath(); x.arc(m, m, 236, 0, TAU); x.stroke();
      x.lineWidth = 6; x.beginPath(); x.arc(m, m, 210, 0, TAU); x.stroke();
      for (var i = 0; i < 24; i++) {
        var a = i * TAU / 24, r1 = i % 2 ? 194 : 182;
        x.lineWidth = i % 2 ? 4 : 7; x.beginPath(); x.moveTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1); x.lineTo(m + Math.cos(a) * 208, m + Math.sin(a) * 208); x.stroke();
      }
      for (var k = 0; k < 8; k++) { x.save(); x.translate(m + Math.cos(k * TAU / 8 + 0.2) * 223, m + Math.sin(k * TAU / 8 + 0.2) * 223); x.rotate(k * TAU / 8 + 0.2 + PI / 2); x.lineWidth = 4; runeGlyph(x, 0, 0, 9, k + 31); x.restore(); }
      x.lineWidth = 11;
      switch (school) {
        case 'stoneward':
          x.beginPath(); x.moveTo(m, m - 140); x.lineTo(m + 110, m); x.lineTo(m, m + 140); x.lineTo(m - 110, m); x.closePath(); x.stroke();
          x.lineWidth = 6; x.beginPath(); x.moveTo(m, m - 140); x.lineTo(m, m + 140); x.moveTo(m - 110, m); x.lineTo(m + 110, m);
          x.moveTo(m - 55, m - 70); x.lineTo(m + 55, m + 70); x.stroke();
          [[0, -170], [170, 0], [0, 170], [-170, 0]].forEach(function (p) { x.fillRect(m + p[0] - 13, m + p[1] - 13, 26, 26); });
          break;
        case 'tidecaller':
          for (var w = -1; w <= 1; w++) {
            x.beginPath();
            for (var s = -120; s <= 120; s += 4) { var yy = m + w * 55 + Math.sin(s / 120 * PI * 2) * 22; if (s === -120) x.moveTo(m + s, yy); else x.lineTo(m + s, yy); }
            x.stroke();
          }
          for (var d = 0; d < 6; d++) { var da = d * TAU / 6; x.beginPath(); x.arc(m + Math.cos(da) * 165, m + Math.sin(da) * 165, 12, 0, TAU); x.fill(); }
          break;
        case 'emberstrike':
          x.beginPath();
          for (var f = 0; f <= 16; f++) { var fa = f * TAU / 16 - PI / 2, fr = f % 2 ? 70 : 150; if (!f) x.moveTo(m + Math.cos(fa) * fr, m + Math.sin(fa) * fr); else x.lineTo(m + Math.cos(fa) * fr, m + Math.sin(fa) * fr); }
          x.stroke();
          x.beginPath(); x.moveTo(m, m - 70); x.quadraticCurveTo(m + 50, m, m, m + 55); x.quadraticCurveTo(m - 50, m, m, m - 70); x.fill();
          break;
        case 'lumen':
          x.beginPath(); x.arc(m, m, 62, 0, TAU); x.stroke();
          x.beginPath(); x.arc(m, m, 30, 0, TAU); x.fill();
          for (var l = 0; l < 12; l++) { var la = l * TAU / 12; x.lineWidth = l % 2 ? 6 : 10; x.beginPath(); x.moveTo(m + Math.cos(la) * 85, m + Math.sin(la) * 85); x.lineTo(m + Math.cos(la) * (l % 2 ? 130 : 160), m + Math.sin(la) * (l % 2 ? 130 : 160)); x.stroke(); }
          break;
        case 'hollow':
          x.beginPath(); x.arc(m, m, 120, 0.35 * PI, 1.65 * PI); x.arc(m + 55, m, 100, 1.55 * PI, 0.45 * PI, true); x.closePath(); x.stroke();
          x.beginPath(); x.ellipse(m - 10, m, 42, 22, 0, 0, TAU); x.stroke();
          x.beginPath(); x.arc(m - 10, m, 11, 0, TAU); x.fill();
          break;
        default:
          x.beginPath();
          for (var h = 0; h <= 6; h++) { var ha = h * TAU / 6 * 2 - PI / 2; if (!h) x.moveTo(m + Math.cos(ha) * 140, m + Math.sin(ha) * 140); else x.lineTo(m + Math.cos(ha) * 140, m + Math.sin(ha) * 140); }
          x.stroke();
      }
      return new T.CanvasTexture(c);
    });
  }
  // castSigil(colorHex, opts?) -> flat school sigil; place it at the caster's FEET.
  // ~0.9 s (opts.duration), update(dt) returns false when done. opts.school, opts.radius (1.25).
  M.castSigil = function (colorHex, opts) {
    need(); opts = opts || {};
    var school = opts.school || schoolOf(colorHex);
    var pal = fxPalette(school, colorHex), R = opts.radius || 1.25, DUR = opts.duration || 0.9;
    var q = { kind: 'sigil', school: school, pal: pal, pips: 1, S: R / 1.25, r: Math.random, n: 1 };
    var root = makeFx(q, {}, DUR, 0, function (ctx) {
      // two layers: a coloured (normal-blend) sigil so it reads on bright grass, + an additive glow copy
      var tex = sigilTex(school);
      var mat = ctx.own(new T.MeshBasicMaterial({ map: tex, color: pal.a, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      var matG = ctx.own(new T.MeshBasicMaterial({ map: tex, color: pal.b, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
      var disc = ctx.mesh(UG.plane(), mat); disc.position.y = 0.09; disc.renderOrder = 5;
      var discG = ctx.mesh(UG.plane(), matG); discG.position.y = 0.1; discG.renderOrder = 6;
      var col = ctx.mesh(UG.cyl(), ctx.own(gradMat(pal.a, false)));
      ctx.pc = ctx.parts(50, school === 'lumen' ? 'star' : 'puff', false);
      ctx.pa = ctx.parts(40, school === 'lumen' ? 'star' : 'soft', true);
      var em = Rate(80);
      return function (a, dt) {
        var kin = eBack(seg(a, 0, 0.22)), kout = seg(a, DUR - 0.3, DUR);
        var s = 2 * R * Math.max(0.01, kin);
        disc.scale.set(s, 1, s); discG.scale.set(s, 1, s);
        disc.rotation.y = discG.rotation.y = a * 1.6;
        mat.opacity = 0.95 * (1 - kout);
        matG.opacity = (0.45 + 0.25 * Math.sin(a * 24)) * (1 - kout);
        col.scale.set(R * 0.8 * (0.6 + 0.4 * kin), 1.8 * eOut(seg(a, 0.05, 0.35)) * (1 - kout * 0.5), R * 0.8 * (0.6 + 0.4 * kin));
        col.material.opacity = 0.22 * (1 - kout);
        if (dt > 0 && a < DUR - 0.25) em(dt, function () {
          var th = Math.random() * TAU, rr = R * (0.5 + Math.random() * 0.45);
          if (Math.random() < 0.6) ctx.pc.emit(Math.cos(th) * rr, 0.1, Math.sin(th) * rr, 0, 1.2 + Math.random() * 1.6, 0, 0.55, 0.2, 0.04, pal.A, pal.D, 0.9, 0, 0.5);
          else ctx.pa.emit(Math.cos(th) * rr, 0.1, Math.sin(th) * rr, 0, 1.4 + Math.random() * 1.6, 0, 0.5, 0.18, 0.02, pal.Co, pal.A, 1, 0, 0.5);
        });
      };
    });
    root.name = 'castSigil';
    root.position.set(0, 0, 0);
    return root;
  };

  // pipMesh(bright) -> small glowing orb (shared geometry + cached materials; nothing to free).
  // Normal pip: gold r=0.13. Bright pip: white-gold r=0.17 with a ring and bigger halo.
  // userData.anim(t) twinkles the halo; userData.bright.
  M.pipMesh = function (bright) {
    need();
    var m = smesh(UG.sph(), M.glow(bright ? '#ffefa0' : '#ffb81c'));
    var r = bright ? 0.17 : 0.13;
    m.scale.setScalar(r);
    m.name = bright ? 'pipBright' : 'pip';
    var shell = smesh(SG('rim_sph', function () { return inflate(UG.sph(), 0.18); }), rimMat(bright ? '#fff6d0' : '#ffd23a', bright ? 1 : 0.7)); m.add(shell);
    var hi = smesh(UG.sphLo(), M.glow('#ffffff')); hi.scale.setScalar(0.4); hi.position.set(-0.3, 0.4, 0.4); m.add(hi);
    var h = halo(bright ? '#fff0b0' : '#ffbf3a', (bright ? 0.85 : 0.5) / r, bright ? 0.9 : 0.55); m.add(h);
    var ring = null;
    if (bright) { ring = smesh(UG.tor(), M.glow('#ffffff')); ring.scale.setScalar(1.5); m.add(ring); }
    var base = h.scale.x, ph = Math.random() * 6;
    m.userData.bright = !!bright;
    m.userData.anim = function (t) {
      var s = base * (1 + Math.sin(t * (bright ? 6 : 3) + ph) * (bright ? 0.18 : 0.08)); h.scale.set(s, s, 1);
      if (ring) { ring.rotation.x = Math.sin(t * 1.3 + ph) * 0.6; ring.rotation.z = t * 2; }
    };
    return m;
  };

  // phaseAura(colorHex, opts?) -> boss aura after its phase change. Origin at the boss's feet:
  // add it as a CHILD of the boss root, or to the scene at the boss position.
  // opts.height (default 3), opts.radius (default 1.3). userData.anim(t[, dt]) every frame
  // (dt is derived from t when omitted). Per-instance GPU cost: 1 particle geometry.
  M.phaseAura = function (colorHex, opts) {
    need(); opts = opts || {};
    var col = C(colorHex || '#a879ff'), H = opts.height || 3, R = opts.radius || 1.3;
    var school = opts.school || schoolOf(colorHex);
    var pal = fxPalette(school, col);
    var root = new T.Group(); root.name = 'phaseAura';
    var ringM = cmat('aura_ring' + hx(col), function () { return new T.MeshBasicMaterial({ map: ringTex('rot'), color: col, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); });
    var ringG = cmat('aura_ringG' + hx(col), function () { return new T.MeshBasicMaterial({ map: ringTex('rot'), color: sh(col, 0.3), transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }); });
    var ring = smesh(UG.plane(), ringM); ring.scale.set(R * 2.4, 1, R * 2.4); ring.position.y = 0.09; ring.renderOrder = 5; root.add(ring);
    var ring2 = smesh(UG.plane(), ringG); ring2.scale.set(R * 2.4, 1, R * 2.4); ring2.position.y = 0.1; ring2.renderOrder = 6; root.add(ring2);
    var shellM = cmat('aura_shell' + hx(col), function () { return new T.MeshBasicMaterial({ color: col, map: vgradTex(), transparent: true, opacity: 0.4, depthWrite: false, side: T.DoubleSide }); });
    var shell = smesh(UG.cylT(), shellM); shell.scale.set(R, H * 0.9, R); root.add(shell);
    var tongueM = bodyMat(sh(col, 0.15), 0.75), tongueG = bodyMat(sh(col, 0.45), 0.6), tongues = [];
    for (var i = 0; i < 9; i++) {
      var tg = smesh(UG.cone(), i % 3 === 0 ? tongueG : tongueM); var a = i * TAU / 9;
      tg.position.set(Math.cos(a) * R * 0.95, 0, Math.sin(a) * R * 0.95); tg.userData.a = a; tg.userData.ph = i * 1.7;
      root.add(tg); tongues.push(tg);
    }
    var hl = halo(col, R * 3.2, 0.3); hl.position.y = H * 0.45; root.add(hl);
    var P = Parts(90, school === 'lumen' ? 'star' : 'puff', false); root.add(P.obj);
    var A0 = [pal.b.r, pal.b.g, pal.b.b], A1 = [pal.deep.r, pal.deep.g, pal.deep.b], last = null, acc = 0;
    root.userData.dispose = function () { P.geo.dispose(); };
    root.userData.anim = function (t, dt) {
      if (dt === undefined) dt = last === null ? 0 : Math.max(0, Math.min(0.1, t - last));
      last = t;
      ring.rotation.y = -t * 0.8; ring2.rotation.y = -t * 0.8;
      var pulse = 1 + 0.06 * Math.sin(t * 3);
      shell.scale.set(R * pulse, H * (0.85 + 0.08 * Math.sin(t * 2.3)), R * pulse); shell.rotation.y = t * 0.5;
      tongues.forEach(function (tg) {
        var f = 0.5 + 0.5 * Math.sin(t * 7 + tg.userData.ph);
        tg.scale.set(0.16 * R, H * (0.25 + 0.3 * f), 0.16 * R);
        var a = tg.userData.a + t * 0.6; tg.position.set(Math.cos(a) * R * 0.95, 0, Math.sin(a) * R * 0.95);
      });
      hl.scale.setScalar(R * 3.2 * (1 + 0.1 * Math.sin(t * 5)));
      acc += dt * 45;
      while (acc >= 1) {
        acc -= 1;
        var th = Math.random() * TAU;
        P.emit(Math.cos(th) * R, 0.1, Math.sin(th) * R, -Math.sin(th) * 1.4 - Math.cos(th) * 0.3, 1.0 + Math.random() * 1.2, Math.cos(th) * 1.4 - Math.sin(th) * 0.3, 1.4, 0.3, 0.06, A0, A1, 0.9, 0.3, 0.8);
      }
      P.update(dt);
    };
    root.userData.anim(0, 0);
    return root;
  };

  // ------------------------------------------------------------------
  //  v1.1: shared glow-boost uniform (WF.gfx sets .value; every unlit
  //  glow shader multiplies its colour by it so bloom picks glows out).
  //  Internals for the v1.1 extension files (models_mounts.js, cine.js,
  //  textures.js, gfx.js). Read-only use; do not reassign.
  // ------------------------------------------------------------------
  M.glowBoost = M.glowBoost || { value: 1.0 };
  M._k = {
    T: T, PI: PI, TAU: TAU, C: C, hx: hx, sh: sh, mix: mix, clamp: clamp, smooth: smooth, pick: pick, seeded: seeded, V3: V3,
    canvas: canvas, halo: halo, haloTex: haloTex, SG: SG, smesh: smesh, cmat: cmat, ctex: ctex, UG: UG, cachedGeos: cachedGeos,
    G: G, inflate: inflate, mtx: mtx, Builder: Builder, meshesFromGeos: meshesFromGeos, pivot: pivot, measureTop: measureTop,
    rig: rig, eyeHalos: eyeHalos, skinify: skinify, base: base, vcMat: vcMat, vcGlowMat: vcGlowMat,
    matCache: matCache, texCache: texCache, geoCache: geoCache,
    Parts: Parts, partMat: partMat, fxPalette: fxPalette, FXPAL: FXPAL, FXK: FXK, makeFx: makeFx, schoolOf: schoolOf,
    seg: seg, eOut: eOut, eIn: eIn, eInOut: eInOut, eBack: eBack, rgb: rgb, bez: bez, toV: toV, orientY: orientY, faceDir: faceDir,
    stdParts: stdParts, emitTrail: emitTrail, emitBurst: emitBurst, Debris: Debris, Impact: Impact, Winged: Winged, Lightning: Lightning,
    bodyMat: bodyMat, addMat: addMat, rimMat: rimMat, gradMat: gradMat, fxTex: fxTex, starTex: starTex, smokeTex: smokeTex,
    puffTex: puffTex, beamTex: beamTex, vgradTex: vgradTex, ringTex: ringTex, sigilTex: sigilTex, Rate: Rate, placeBeam: placeBeam
  };

  window.WF.models = M;
})();
