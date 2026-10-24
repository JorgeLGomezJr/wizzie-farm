// =====================================================================
//  WIZZIE FARM — gfx.js (v1.1)  ·  technical-director (rendering)
//  Post-processing + quality tiers. No three.js examples: every pass is
//  written here with WebGLRenderTarget + ShaderMaterial (Three r149 UMD).
//
//  Frame (post on):
//    scene  ──► HDR half-float target (MSAA on WebGL2)
//           ──► bloom: prefilter (threshold + soft knee, Karis average) at ½ or ¼ res
//                      → dual-filter mip chain down → tent upsample back up (additive)
//           ──► composite to screen: exposure, bloom, highlight shoulder (filmic,
//               hue-preserving), saturation / contrast / warmth / split-tone grade
//               per zone style, vignette, optional sharpen, flash, dither.
//  Fallback (tier 'low', WebGL1 or no float render targets): direct render.
//
//  Materials are authored for LinearEncoding output with no tone mapping, so the
//  HDR target simply holds the old display values; unlit glows are multiplied by
//  WF.models.glowBoost (> 1) so they rise above the bloom threshold and glow.
//
//  API (docs/V1.1-CONTRACT.md §4.6):
//    init(renderer, { sun })      setQuality(q)      resize(w, h)
//    render(scene, camera)        setGrade(zone)     shake(i, s)
//    flash(hex, i, s)             bloomPulse(a, s)   stats(scene, camera)
//    qualities, quality, tier(), post (bool), supported (bool)
// =====================================================================
window.WF = window.WF || { data: {} };

WF.gfx = (function () {
  'use strict';
  var T = window.THREE;
  var G = {
    qualities: ['ultra', 'high', 'medium', 'low'],
    quality: 'high',
    post: false,            // post-processing active right now
    supported: false,       // WebGL2 + float render targets available
    ready: false,
    passes: 0               // fullscreen passes per frame (for stats)
  };

  // ---------------------------------------------------------------
  //  Quality tiers
  //   pr: max pixel ratio · msaa: samples on the HDR target · bloomDiv: bloom base
  //   resolution divisor · mips: bloom mip levels · shadow: map size (0 = off) ·
  //   shadowR: half-extent of the fitted shadow box (world units) · grass /
  //   particles: density multipliers for the environment · glow: glowBoost value ·
  //   paint: WF.models.paint (painterly detail on props, agent S)
  // ---------------------------------------------------------------
  var TIERS = {
    ultra:  { pr: 2,   msaa: 8, post: true,  bloomDiv: 2, mips: 6, shadow: 4096, soft: true,  shadowR: 44, grass: 1.0,  particles: 1.0,  glow: 1.6,  sharpen: 0.22, aniso: 16, paint: 0.5 },
    high:   { pr: 2,   msaa: 4, post: true,  bloomDiv: 2, mips: 5, shadow: 2048, soft: true,  shadowR: 36, grass: 0.65, particles: 0.75, glow: 1.55, sharpen: 0,    aniso: 8,  paint: 0.45 },
    medium: { pr: 1,   msaa: 2, post: true,  bloomDiv: 4, mips: 4, shadow: 1024, soft: false, shadowR: 30, grass: 0.35, particles: 0.5,  glow: 1.45, sharpen: 0,    aniso: 4,  paint: 0.38 },
    low:    { pr: 1,   msaa: 0, post: false, bloomDiv: 4, mips: 0, shadow: 0,    soft: false, shadowR: 30, grass: 0.12, particles: 0.3,  glow: 1.0,  sharpen: 0,    aniso: 2,  paint: 0 }
  };
  G.tiers = TIERS;
  // Effective tier settings. On software rasterisers (G.software) every tier is clamped to a
  // CPU-friendly variant (pixel ratio 1, no MSAA, quarter-res bloom, 1024 PCF shadows, half the
  // grass) so headless test browsers and GPU-less machines stay usable; the look is unchanged.
  G.tier = function () {
    var t = TIERS[G.quality] || TIERS.high;
    if (!G.software) return t;
    return Object.assign({}, t, { pr: 1, msaa: 0, bloomDiv: 4, mips: Math.min(t.mips, 4), soft: false,
      shadow: Math.min(t.shadow, 1024), shadowR: Math.min(t.shadowR, 32), grass: t.grass * 0.5, particles: t.particles * 0.6, sharpen: 0 });
  };

  // Per-style colour grades. zone.grade = { exposure, saturation, contrast, warmth, bloom, vignette,
  // threshold, shadowTint:'#hex', highTint:'#hex' } overrides any field.
  var GRADES = {
    town:   { exposure: 1.02, saturation: 1.1, contrast: 1.08, warmth: 0.04, bloom: 0.75, vignette: 0.22, threshold: 1.0,  shadowTint: '#e8ecff', highTint: '#fdfbff' },   // v1.1 polish (B14): neutral highlights keep the sky blue
    meadow: { exposure: 1.02, saturation: 1.1, contrast: 1.07, warmth: 0.0, bloom: 0.8,  vignette: 0.30, threshold: 1.0,  shadowTint: '#e6eaff', highTint: '#fffaf0' },
    forest: { exposure: 1.12, saturation: 1.14, contrast: 1.08, warmth: -0.04, bloom: 1.05, vignette: 0.40, threshold: 0.92, shadowTint: '#dfe6ff', highTint: '#fbf6ff' },
    ruins:  { exposure: 1.07, saturation: 1.12, contrast: 1.10, warmth: 0.10, bloom: 1.1,  vignette: 0.42, threshold: 0.92, shadowTint: '#ecdcff', highTint: '#fff0e2' },
    // v1.2 WS6: the Hollow Orrery: violet shadows, warm gold highlights, generous exposure so the cavern reads clearly
    vault:  { exposure: 1.16, saturation: 1.1,  contrast: 1.06, warmth: 0.03, bloom: 1.15, vignette: 0.34, threshold: 0.9,  shadowTint: '#e2daff', highTint: '#fff3e0' }
  };
  G.grades = GRADES;

  var R = null, sun = null, flashEl = null;
  var rtScene = null, mips = [], fsScene, fsCam, fsQuad;
  var matPre, matDown, matUp, matComp;
  var W = 1, H = 1, lastKey = '';         // drawing-buffer size (pixels)
  var grade = Object.assign({}, GRADES.town), gradeTarget = Object.assign({}, GRADES.town);
  var shakeS = { i: 0, t: 0, d: 1 }, flashS = { c: new T.Color(1, 1, 1), i: 0, t: 0, d: 1 }, pulseS = { a: 0, t: 0, d: 1 };
  var clock = { last: 0, t: 0 };
  var _v = new T.Vector3(), _f = new T.Vector3(), _p = new T.Vector3(), _q = new T.Quaternion(), _x = new T.Vector3(), _y = new T.Vector3(), _z = new T.Vector3();
  var LIGHT_DIR = new T.Vector3(22, 40, 14).normalize();

  // ---------------------------------------------------------------
  //  Shaders
  // ---------------------------------------------------------------
  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // Prefilter: 4 bilinear taps (= 16 texels) with Karis weighting (no fireflies), then soft-knee threshold
  var FS_PRE = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;',
    'varying vec2 vUv;',
    'float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'vec3 tap(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return c / (1.0 + lum(c)); }',
    'void main(){',
    '  vec3 c = tap(vec2(-1.0,-1.0)) + tap(vec2(1.0,-1.0)) + tap(vec2(-1.0,1.0)) + tap(vec2(1.0,1.0));',
    '  c *= 0.25; c = c / max(1.0 - lum(c), 0.02);',          // undo the Karis weighting
    '  float br = max(c.r, max(c.g, c.b));',
    '  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);',
    '  rq = rq * rq / (4.0 * uKnee + 1e-4);',
    '  c *= max(rq, br - uThreshold) / max(br, 1e-4);',
    '  gl_FragColor = vec4(min(c, vec3(32.0)), 1.0);',
    '}'].join('\n');
  // Dual-filter downsample (5 taps)
  var FS_DOWN = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;',
    '  c += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * uTexel).rgb;',
    '  c += texture2D(tSrc, vUv + vec2( 1.0,-1.0) * uTexel).rgb;',
    '  c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;',
    '  c += texture2D(tSrc, vUv + vec2( 1.0, 1.0) * uTexel).rgb;',
    '  gl_FragColor = vec4(c * 0.125, 1.0);',
    '}'].join('\n');
  // Tent upsample (8 taps), added onto the next larger mip
  var FS_UP = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter; varying vec2 vUv;',
    'void main(){',
    '  vec2 o = uTexel;',
    '  vec3 c = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * o).rgb + texture2D(tSrc, vUv + vec2(2.0, 0.0) * o).rgb;',
    '  c += texture2D(tSrc, vUv + vec2(0.0, -2.0) * o).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0) * o).rgb;',
    '  c += (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * o).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * o).rgb',
    '      + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * o).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * o).rgb) * 2.0;',
    '  gl_FragColor = vec4(c / 12.0 * uScatter, 1.0);',
    '}'].join('\n');
  var FS_COMP = [
    'uniform sampler2D tScene; uniform sampler2D tBloom; uniform vec2 uTexel;',
    'uniform float uExposure; uniform float uSat; uniform float uContrast; uniform float uWarmth;',
    'uniform float uBloom; uniform float uVignette; uniform float uSharpen; uniform float uTime;',
    'uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform vec4 uFlash;',
    'varying vec2 vUv;',
    'float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    // identity below the knee, smooth exponential shoulder above (reaches 1 asymptotically)
    'vec3 shoulder(vec3 x){ const float k = 0.72; vec3 s = k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))); return mix(x, s, step(k, x)); }',
    'float shoulder1(float x){ const float k = 0.72; return x < k ? x : k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))); }',
    'void main(){',
    '  vec3 c = texture2D(tScene, vUv).rgb;',
    '  if (uSharpen > 0.0) {',
    '    vec3 n = texture2D(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(uTexel.x, 0.0)).rgb',
    '           + texture2D(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, uTexel.y)).rgb;',
    '    c = max(c + (c - n * 0.25) * uSharpen, 0.0);',
    '  }',
    '  c = c * uExposure + texture2D(tBloom, vUv).rgb * uBloom;',
    // filmic highlight roll-off: half per channel (hot cores go toward white), half hue-preserving
    '  float m = max(c.r, max(c.g, c.b));',
    '  vec3 hp = c * (shoulder1(m) / max(m, 1e-4));',
    '  c = mix(shoulder(c), hp, 0.55);',
    // grade
    '  float l = lum(c);',
    '  c = mix(vec3(l), c, uSat);',
    '  c = (c - 0.45) * uContrast + 0.45;',
    '  c *= vec3(1.0 + uWarmth * 0.07, 1.0 + uWarmth * 0.01, 1.0 - uWarmth * 0.08);',
    '  c *= mix(uShadowTint, uHighTint, smoothstep(0.05, 0.75, l));',
    '  vec2 q = vUv - 0.5; q.x *= 1.25;',
    '  c *= 1.0 - uVignette * smoothstep(0.18, 0.75, dot(q, q) * 1.7);',
    '  c = mix(c, uFlash.rgb, uFlash.a);',
    '  float h = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);',
    '  c += (h - 0.5) / 255.0;',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'].join('\n');

  function passMat(fs, uniforms, additive) {
    var m = new T.ShaderMaterial({ uniforms: uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
    if (additive) { m.blending = T.CustomBlending; m.blendSrc = T.OneFactor; m.blendDst = T.OneFactor; m.blendEquation = T.AddEquation; }
    m.toneMapped = false;
    return m;
  }

  // ---------------------------------------------------------------
  //  init
  // ---------------------------------------------------------------
  G.init = function (renderer, opts) {
    R = renderer; opts = opts || {};
    sun = opts.sun || null;
    R.toneMapping = T.NoToneMapping;
    var caps = R.capabilities;
    G.supported = !!(caps.isWebGL2 && R.extensions.has('EXT_color_buffer_float'));
    G.maxSamples = caps.maxSamples || 0;
    // Software rasterisers (SwiftShader / llvmpipe, e.g. headless test browsers or machines without a
    // GPU driver) shade every MSAA sample on the CPU: skip MSAA there and keep the rest of the tier.
    try {
      var gl = R.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      G.rendererName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch (e) { G.rendererName = ''; }
    G.software = /swiftshader|llvmpipe|softpipe|software/i.test(G.rendererName);
    if (WF.textures && WF.textures.setAnisotropy) WF.textures.anisotropy = caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 4;
    fsScene = new T.Scene();
    fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    fsQuad = new T.Mesh(new T.PlaneGeometry(2, 2), null);
    fsQuad.frustumCulled = false;
    fsScene.add(fsQuad);
    matPre = passMat(FS_PRE, { tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.35 } });
    matDown = passMat(FS_DOWN, { tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    matUp = passMat(FS_UP, { tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uScatter: { value: 1 } }, true);
    matComp = passMat(FS_COMP, {
      tScene: { value: null }, tBloom: { value: null }, uTexel: { value: new T.Vector2() },
      uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uWarmth: { value: 0 },
      uBloom: { value: 0.8 }, uVignette: { value: 0.3 }, uSharpen: { value: 0 }, uTime: { value: 0 },
      uShadowTint: { value: new T.Color(1, 1, 1) }, uHighTint: { value: new T.Color(1, 1, 1) }, uFlash: { value: new T.Vector4(1, 1, 1, 0) }
    });
    G.ready = true;
    G.setQuality(G.quality);
    // GPU driver reset / sleep on laptops: let the browser restore the context, then rebuild targets
    try {
      var cv = R.domElement;
      cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); G.lost = true; }, false);
      cv.addEventListener('webglcontextrestored', function () { G.lost = false; try { G.setQuality(G.quality); } catch (e2) { /* fall back to direct render */ G.post = false; } }, false);
    } catch (e) { /* ignore */ }
    return G;
  };

  function freeTargets() {
    if (rtScene) { rtScene.dispose(); rtScene = null; }
    mips.forEach(function (m) { m.dispose(); }); mips = [];
  }
  function makeTargets() {
    freeTargets();
    var t = G.tier();
    if (!G.post) return;
    var samples = Math.min(t.msaa, G.maxSamples || 0);
    rtScene = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true, stencilBuffer: false, samples: samples });
    rtScene.texture.generateMipmaps = false;
    rtScene.texture.name = 'gfx.scene';
    var w = Math.max(1, Math.floor(W / t.bloomDiv)), h = Math.max(1, Math.floor(H / t.bloomDiv));
    for (var i = 0; i < t.mips; i++) {
      var m = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, stencilBuffer: false });
      m.texture.generateMipmaps = false;
      mips.push(m);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
  }

  // ---------------------------------------------------------------
  //  Quality
  // ---------------------------------------------------------------
  G.setQuality = function (q) {
    if (!TIERS[q]) q = 'high';
    G.quality = q;
    if (!R) return G;
    var t = G.tier(), dpr = window.devicePixelRatio || 1;
    G.post = !!(t.post && G.supported);
    R.setPixelRatio(Math.min(dpr, t.pr));
    var shadows = t.shadow > 0;
    R.shadowMap.enabled = shadows;
    R.shadowMap.type = t.soft ? T.PCFSoftShadowMap : T.PCFShadowMap;
    if (sun) {
      sun.castShadow = shadows;
      if (shadows && sun.shadow.mapSize.x !== t.shadow) {
        sun.shadow.mapSize.set(t.shadow, t.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      var sc = sun.shadow.camera;
      sc.left = -t.shadowR; sc.right = t.shadowR; sc.top = t.shadowR; sc.bottom = -t.shadowR; sc.near = 1; sc.far = 220;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.025 * (t.shadowR / 36) * (2048 / Math.max(1024, t.shadow)) + 0.01;
    }
    var M = WF.models;
    if (M) {
      if (M.glowBoost) M.glowBoost.value = G.post ? t.glow : 1.0;
      if (M.paint) M.paint.value = t.paint;          // painterly prop detail strength (agent S's uniform)
      M.envDensity = M.envDensity || { grass: 1, particles: 1 };
      M.envDensity.grass = t.grass; M.envDensity.particles = t.particles;
    }
    if (WF.textures && WF.textures.setAnisotropy) WF.textures.setAnisotropy(Math.min(t.aniso, R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 4));
    var size = R.getSize(new T.Vector2());
    G.resize(size.x, size.y);
    return G;
  };

  G.resize = function (w, h) {
    if (!R) return;
    var pr = R.getPixelRatio(), nw = Math.max(1, Math.floor(w * pr)), nh = Math.max(1, Math.floor(h * pr));
    var tt = G.tier(), key = [nw, nh, G.quality, G.post, tt.msaa, tt.bloomDiv, tt.mips].join(':');
    if (key === lastKey && (rtScene || !G.post)) return;     // nothing changed: keep the targets
    lastKey = key; W = nw; H = nh;
    makeTargets();
  };

  // ---------------------------------------------------------------
  //  Grade (eases toward the zone's grade over ~1 s)
  // ---------------------------------------------------------------
  G.setGrade = function (zone, instant) {
    var base = GRADES[(zone && zone.style) || 'town'] || GRADES.town;
    gradeTarget = Object.assign({}, base, (zone && zone.grade) || {});
    if (instant !== false) grade = Object.assign({}, gradeTarget);
    return gradeTarget;
  };
  function ease(dt) {
    var k = Math.min(1, dt * 3);
    ['exposure', 'saturation', 'contrast', 'warmth', 'bloom', 'vignette', 'threshold'].forEach(function (f) {
      if (gradeTarget[f] !== undefined) grade[f] = (grade[f] === undefined ? gradeTarget[f] : grade[f] + (gradeTarget[f] - grade[f]) * k);
    });
    grade.shadowTint = gradeTarget.shadowTint; grade.highTint = gradeTarget.highTint;
  }

  // ---------------------------------------------------------------
  //  Shake / flash / bloom pulse
  // ---------------------------------------------------------------
  function reduceMotion() { try { return !!(WF.state && WF.state.player && WF.state.player.settings && WF.state.player.settings.reduceMotion); } catch (e) { return false; } }
  G.shake = function (intensity, seconds) {
    if (reduceMotion()) return;
    intensity = intensity === undefined ? 0.25 : +intensity || 0; seconds = seconds === undefined ? 0.4 : Math.max(0.01, +seconds || 0.4);
    var remaining = shakeS.t < shakeS.d ? shakeS.i * (1 - shakeS.t / shakeS.d) : 0;
    if (intensity >= remaining) { shakeS.i = intensity; shakeS.t = 0; shakeS.d = seconds; }   // stronger shake wins
  };
  G.flash = function (colorHex, intensity, seconds) {
    flashS.c.set(colorHex === undefined ? 0xffffff : colorHex);
    flashS.i = Math.max(0, Math.min(1, intensity === undefined ? 0.5 : +intensity || 0));
    flashS.t = 0; flashS.d = Math.max(0.01, seconds === undefined ? 0.25 : +seconds || 0.25);
  };
  G.bloomPulse = function (amount, seconds) {
    pulseS.a = Math.max(0, amount === undefined ? 0.6 : +amount || 0);
    pulseS.t = 0; pulseS.d = Math.max(0.01, seconds === undefined ? 0.5 : +seconds || 0.5);
  };
  function flashAmount() { if (flashS.t >= flashS.d) return 0; var k = 1 - flashS.t / flashS.d; return flashS.i * k * k; }
  function cssFlash(a) {
    if (!flashEl) {
      if (!a || !R || !R.domElement || !R.domElement.parentNode) return;
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;opacity:0;';
      R.domElement.parentNode.appendChild(flashEl);
    }
    flashEl.style.background = '#' + flashS.c.getHexString();
    flashEl.style.opacity = a.toFixed(3);
  }

  // ---------------------------------------------------------------
  //  Shadow box fitted to what the camera looks at (texel-snapped: no shimmer)
  // ---------------------------------------------------------------
  function fitShadow(camera) {
    if (!sun || !sun.castShadow || !R.shadowMap.enabled) return;
    var t = G.tier(), Rr = t.shadowR;
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_f);
    var dist;
    if (_f.y < -0.05) { dist = Math.min(-_p.y / _f.y, 26); } else dist = 14;
    _v.copy(_p).addScaledVector(_f, dist); _v.y = 0;
    _f.y = 0; if (_f.lengthSq() > 1e-6) { _f.normalize(); _v.addScaledVector(_f, Rr * 0.35); }
    // light basis (same as Matrix4.lookAt(eye, target, up=Y))
    _z.copy(LIGHT_DIR); _x.set(0, 1, 0).cross(_z).normalize(); _y.copy(_z).cross(_x);
    var texel = (2 * Rr) / sun.shadow.mapSize.x;
    var a = Math.round(_v.dot(_x) / texel) * texel, b = Math.round(_v.dot(_y) / texel) * texel, c = _v.dot(_z);
    _v.set(0, 0, 0).addScaledVector(_x, a).addScaledVector(_y, b).addScaledVector(_z, c);
    sun.target.position.copy(_v);
    sun.position.copy(_v).addScaledVector(LIGHT_DIR, 90);
    sun.target.updateMatrixWorld();
    var sc = sun.shadow.camera;
    if (sc.right !== Rr) { sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------
  function pass(mat, target) { fsQuad.material = mat; R.setRenderTarget(target); R.render(fsScene, fsCam); }

  G.render = function (scene, camera) {
    if (!R || G.lost) return;
    var now = performance.now() / 1000, dt = clock.last ? Math.min(0.1, now - clock.last) : 0.016;
    clock.last = now; clock.t += dt;
    ease(dt);
    shakeS.t += dt; flashS.t += dt; pulseS.t += dt;
    fitShadow(camera);

    // camera shake: applied only for this frame's render, the stored camera is restored after
    var shaking = shakeS.t < shakeS.d && shakeS.i > 0, sx = 0, sy = 0, roll = 0;
    if (shaking) {
      var k = 1 - shakeS.t / shakeS.d, amp = shakeS.i * k * k, tt = clock.t * 38;
      sx = (Math.sin(tt * 1.13) + Math.sin(tt * 2.71 + 1.7) * 0.5) * amp * 0.6;
      sy = (Math.sin(tt * 1.37 + 0.6) + Math.sin(tt * 3.11 + 2.2) * 0.5) * amp * 0.6;
      roll = Math.sin(tt * 0.91 + 0.3) * amp * 0.03;
      _p.copy(camera.position); _q.copy(camera.quaternion);
      camera.translateX(sx); camera.translateY(sy); camera.rotateZ(roll);
    }

    var fa = flashAmount();
    if (!G.post || !rtScene) {
      R.setRenderTarget(null);
      R.render(scene, camera);
      G.passes = 0;
      cssFlash(fa);
    } else {
      if (flashEl && flashEl.style.opacity !== '0') flashEl.style.opacity = '0';
      try {
        renderPost(scene, camera, fa);
      } catch (e) {
        console.warn('gfx: post-processing failed, falling back to direct render', e);
        G.supported = false; lastKey = ''; G.setQuality(G.quality);
        R.setRenderTarget(null); R.render(scene, camera);
      }
    }
    if (shaking) { camera.position.copy(_p); camera.quaternion.copy(_q); camera.updateMatrixWorld(); }
  };

  function renderPost(scene, camera, fa) {
    var t = G.tier(), autoClear = R.autoClear;
    R.setRenderTarget(rtScene);
    R.render(scene, camera);
    R.autoClear = false;
    var n = mips.length;
    // bloom
    var u = matPre.uniforms;
    u.tSrc.value = rtScene.texture; u.uTexel.value.set(1 / W, 1 / H);
    u.uThreshold.value = grade.threshold || 1.0; u.uKnee.value = 0.38;
    pass(matPre, mips[0]);
    for (var i = 1; i < n; i++) {
      matDown.uniforms.tSrc.value = mips[i - 1].texture;
      matDown.uniforms.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
      pass(matDown, mips[i]);
    }
    for (var j = n - 1; j > 0; j--) {
      matUp.uniforms.tSrc.value = mips[j].texture;
      matUp.uniforms.uTexel.value.set(0.5 / mips[j].width, 0.5 / mips[j].height);
      matUp.uniforms.uScatter.value = 0.85;
      pass(matUp, mips[j - 1]);
    }
    // composite
    var c = matComp.uniforms, pulse = pulseS.t < pulseS.d ? pulseS.a * (1 - pulseS.t / pulseS.d) : 0;
    c.tScene.value = rtScene.texture; c.tBloom.value = mips[0].texture;
    c.uTexel.value.set(1 / W, 1 / H);
    c.uExposure.value = grade.exposure; c.uSat.value = grade.saturation; c.uContrast.value = grade.contrast;
    c.uWarmth.value = grade.warmth; c.uVignette.value = grade.vignette;
    c.uBloom.value = (grade.bloom + pulse) * (2.2 / Math.max(1, n));
    c.uSharpen.value = t.sharpen; c.uTime.value = clock.t % 100;
    c.uShadowTint.value.set(grade.shadowTint || '#ffffff'); c.uHighTint.value.set(grade.highTint || '#ffffff');
    c.uFlash.value.set(flashS.c.r, flashS.c.g, flashS.c.b, fa);
    pass(matComp, null);
    R.autoClear = autoClear;
    G.passes = 1 + 2 * (n - 1) + 1;
  }

  // ---------------------------------------------------------------
  //  Stats: draw calls / triangles of one full frame INCLUDING the shadow pass
  //  (art bible §8.1), plus the post passes.
  // ---------------------------------------------------------------
  G.stats = function (scene, camera) {
    if (!R) return null;
    var info = R.info;
    fitShadow(camera);
    info.autoReset = false; info.reset();
    R.shadowMap.needsUpdate = true;
    R.setRenderTarget(G.post ? rtScene : null);
    R.render(scene, camera);
    var total = info.render.calls, tris = info.render.triangles;
    info.autoReset = true;
    R.render(scene, camera);
    var main = info.render.calls, mainTris = info.render.triangles;
    R.setRenderTarget(null);
    return { quality: G.quality, post: G.post, calls: total, mainCalls: main, shadowCalls: total - main, triangles: tris, mainTriangles: mainTris,
      postPasses: G.post ? G.passes || (1 + 2 * (mips.length - 1) + 1) : 0, size: [W, H], pixelRatio: R.getPixelRatio(),
      geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : 0 };
  };

  return G;
})();
