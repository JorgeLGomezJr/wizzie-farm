// =====================================================================
//  WIZZIE FARM — BOOT, TITLE SCREEN, CHOOSE YOUR WIZARD (3 slots),
//  WIZARD CREATION, DESKTOP-APP BRIDGE, GAME LOOP
// =====================================================================
window.WF = window.WF || { data: {} };

WF.main = (function () {
  'use strict';
  var U = WF.util, D = function () { return WF.data; };
  var M = {};
  var last = 0, saveTimer = 0, titleT = 0, started = false, saveWarned = false;

  // Automatic graphics fallback: average frame time over 5 s of exploring (after a 1.5 s warm-up)
  var probe = null;
  function startProbe() { probe = { warm: 1.5, ms: 0, n: 0, sum: 0 }; }
  function feedProbe(rawMs, dt) {
    if (!probe || WF.world.mode !== 'explore' || rawMs > 250) return;     // ignore hidden-tab gaps and loading
    if (probe.warm > 0) { probe.warm -= dt; return; }
    probe.n++; probe.sum += rawMs; probe.ms += rawMs;
    if (probe.ms < 5000) return;
    // v1.1 (R): tiers come from WF.gfx (ultra > high > medium > low). Only ever step DOWN
    // (one tier, two if very slow) and re-check once at the new tier, so it never thrashes.
    var avg = probe.sum / probe.n, W = WF.world, next = null;
    var Q = (WF.gfx && WF.gfx.qualities) || ['high', 'medium', 'low'], qi = Q.indexOf(W.quality);
    if (qi >= 0 && qi < Q.length - 1 && avg > 22) next = Q[Math.min(Q.length - 1, qi + (avg > 40 ? 2 : 1))];
    probe = null;
    if (next) {
      W.setQuality(next);
      WF.ui.toast('Graphics set to ' + next + ' for smoother play (Menu → Graphics to change).', 'info', 6000);
      startProbe();                                                           // re-check once at the new tier
    }
  }
  M.startProbe = startProbe;

  function el(id) { return document.getElementById(id); }

  // Show any crash on screen so it can be reported (instead of a silent freeze)
  window.addEventListener('error', function (e) {
    var box = el('errors');
    if (!box) return;
    box.classList.remove('hidden');
    var d = document.createElement('div');
    d.textContent = (e.message || 'Error') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '');
    box.appendChild(d);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var box = el('errors'); if (!box) return;
    box.classList.remove('hidden');
    var d = document.createElement('div'); d.textContent = 'Async: ' + (e.reason && e.reason.message || e.reason);
    box.appendChild(d);
  });

  M.boot = function () {
    if (typeof THREE === 'undefined') { el('loading').textContent = 'Could not load the 3D library (game/lib/three.min.js).'; return; }
    WF.models.init();
    WF.world.init(el('canvas-wrap'));
    WF.ui.init();
    applyAccountSettings();
    WF.world.mode = 'title';
    WF.world.loadZone(D().progression.homeZone || 'lumen_commons');     // backdrop for the title screen
    el('loading').classList.add('hidden');
    if (takeBootFlag() === 'select' && WF.state.hasSave()) showSelect(); else showTitle();
    requestAnimationFrame(loop);
    // audio can only start after a user gesture
    var startAudio = function () { WF.sfx.init(); WF.sfx.music('town'); window.removeEventListener('pointerdown', startAudio); window.removeEventListener('keydown', startAudio); };
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button');
      if (b) {
        WF.sfx.play('click');
        // drop focus after a mouse click so Space/Enter don't re-trigger the button later
        if (e.detail > 0) setTimeout(function () { b.blur(); }, 0);
      }
    }, true);
    nativeInit();
  };

  // ------------------------------------------------------------------
  // ---- v1.2 WS5: account-wide settings before a wizard is loaded
  // ------------------------------------------------------------------
  function applyAccountSettings() {
    var s = WF.state.accountSettings();
    document.documentElement.style.setProperty('--ts', s.textScale || 1);
    try { WF.sfx.setVolume(s.master, s.music); } catch (e) { /* audio not ready */ }
    var q = s.quality || 'auto';
    try { WF.world.setQuality(q === 'auto' ? 'high' : q); } catch (e) { /* keep default */ }
  }
  // "Switch Wizard" reloads the page and lands on the select screen
  var BOOT_FLAG = 'wizziefarm_boot';
  function takeBootFlag() {
    var v = null;
    try { v = sessionStorage.getItem(BOOT_FLAG); sessionStorage.removeItem(BOOT_FLAG); } catch (e) { v = null; }
    return v;
  }
  M.switchWizard = function () {
    if (WF.world.mode === 'combat') return false;
    if (started) WF.state.save();
    try { sessionStorage.setItem(BOOT_FLAG, 'select'); } catch (e) { /* lands on the title instead */ }
    started = false;
    location.reload();
    return true;
  };
  M.quitToTitle = function () {
    if (started && WF.world.mode !== 'combat') WF.state.save();
    started = false;
    location.reload();
  };

  // ------------------------------------------------------------------
  // ---- v1.2 WS5: wizard select stage — 3 pedestals with live 3D wizards
  //  Its own small scene, drawn through WF.gfx (bloom/grade) instead of the
  //  world while the select / create screens are open.
  // ------------------------------------------------------------------
  var Stage = (function () {
    var T = THREE, ST = null;
    var PEDS = [{ x: -3.95, z: 1.15 }, { x: 0, z: 0 }, { x: 3.95, z: 1.15 }];
    var TOP = 0.62, EMPTY_COL = '#b9a6ff', DAMAGED_COL = '#ff6b7a';
    var _v = new T.Vector3(), _ray = new T.Raycaster(), _ndc = new T.Vector2();

    function schoolCol(id) { var s = D().schools[id]; return s ? s.color : EMPTY_COL; }

    function domeMat() {
      return new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false, fog: false,
        uniforms: { t: { value: 0 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform float t; varying vec3 vP;',
          'float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }',
          'void main(){',
          '  vec3 d = normalize(vP); float y = d.y;',
          '  vec3 bot = vec3(0.075,0.05,0.15), hor = vec3(0.26,0.16,0.42), mid = vec3(0.11,0.07,0.24), top = vec3(0.025,0.02,0.07);',
          '  vec3 c = mix(bot, hor, smoothstep(-0.12, 0.04, y));',
          '  c = mix(c, mid, smoothstep(0.04, 0.3, y)); c = mix(c, top, smoothstep(0.3, 0.9, y));',
          '  float neb = sin(d.x*5.0+1.3)*sin(d.z*4.0-0.7)*sin(y*6.0+d.x*2.0);',
          '  c += vec3(0.20,0.07,0.28) * smoothstep(0.35, 0.95, neb) * smoothstep(0.02, 0.4, y) * 0.55;',
          '  c += vec3(0.05,0.10,0.22) * smoothstep(0.5, 1.0, -neb) * smoothstep(0.05, 0.5, y) * 0.5;',
          '  vec3 q = d*150.0; vec3 cell = floor(q); float r = h3(cell);',
          '  float star = step(0.975, r) * smoothstep(0.42, 0.0, length(fract(q)-0.5));',
          '  star *= (0.55 + 0.45*sin(t*1.7 + r*60.0)) * smoothstep(0.0, 0.25, y);',
          '  c += star * mix(vec3(1.0,0.9,0.75), vec3(0.75,0.85,1.0), fract(r*13.0)) * 1.8;',
          '  gl_FragColor = vec4(c, 1.0);',
          '}'].join('\n')
      });
    }

    // Floor: dark star-tiles with gold inlay circles under the pedestals (canvas texture)
    function floorTex() {
      var S = 2048, R = 18, cv = document.createElement('canvas'); cv.width = cv.height = S;
      var g = cv.getContext('2d'), px = function (m) { return (m / R + 1) / 2 * S; }, sc = S / (2 * R);
      var bg = g.createRadialGradient(S / 2, S * 0.53, 40, S / 2, S / 2, S / 2);
      bg.addColorStop(0, '#4a3d73'); bg.addColorStop(0.45, '#2c2350'); bg.addColorStop(0.8, '#1a1332'); bg.addColorStop(1, '#130d26');
      g.fillStyle = bg; g.fillRect(0, 0, S, S);
      // tile rings
      g.strokeStyle = 'rgba(10,6,24,0.55)'; g.lineWidth = 3;
      for (var r = 1.6; r < R; r += 1.25) {
        g.beginPath(); g.arc(S / 2, S / 2, r * sc, 0, Math.PI * 2); g.stroke();
        var n = Math.max(8, Math.round(r * 5));
        for (var k = 0; k < n; k++) {
          var a = k / n * Math.PI * 2 + r;
          g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * r * sc, S / 2 + Math.sin(a) * r * sc);
          g.lineTo(S / 2 + Math.cos(a) * (r + 1.25) * sc, S / 2 + Math.sin(a) * (r + 1.25) * sc); g.stroke();
        }
      }
      // gold inlay: a great circle through the pedestals + rings under each
      g.strokeStyle = 'rgba(255,211,107,0.55)'; g.lineWidth = 7;
      g.beginPath(); g.arc(px(0), px(9.0), 9.0 * sc, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      PEDS.forEach(function (p) {
        g.lineWidth = 6; g.strokeStyle = 'rgba(255,211,107,0.6)';
        g.beginPath(); g.arc(px(p.x), px(p.z), 1.9 * sc, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 3; g.strokeStyle = 'rgba(255,230,160,0.35)';
        g.beginPath(); g.arc(px(p.x), px(p.z), 2.15 * sc, 0, Math.PI * 2); g.stroke();
        for (var i = 0; i < 8; i++) {           // little star studs
          var a2 = i / 8 * Math.PI * 2, cx = px(p.x) + Math.cos(a2) * 2.02 * sc, cy = px(p.z) + Math.sin(a2) * 2.02 * sc;
          g.fillStyle = 'rgba(255,224,150,0.85)'; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
        }
      });
      // scattered star specks
      var rnd = U.seeded(77);
      for (var s = 0; s < 900; s++) { g.fillStyle = 'rgba(220,200,255,' + (0.08 + rnd() * 0.25) + ')'; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 2, 2 + rnd() * 2); }
      // fade the rim into the fog colour so the floor has no visible edge
      var fade = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
      fade.addColorStop(0, 'rgba(19,12,40,0)'); fade.addColorStop(1, 'rgba(19,12,40,1)');
      g.fillStyle = fade; g.fillRect(0, 0, S, S);
      var t = new T.CanvasTexture(cv);
      if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
      t.anisotropy = 4;
      return t;
    }

    function glowSprite() {
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(cv);
    }

    // Light beam over the selected pedestal (additive, fades up and at the edges)
    function beamMat(col) {
      return new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
        uniforms: { c: { value: new T.Color(col) }, a: { value: 0 }, t: { value: 0 } },
        vertexShader: 'varying vec2 vU; varying vec3 vN; varying vec3 vV; void main(){ vU = uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 c; uniform float a; uniform float t; varying vec2 vU; varying vec3 vN; varying vec3 vV;' +
          'void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float h = 1.0 - vU.y; float f = smoothstep(0.0, 0.12, h) * pow(1.0 - h, 1.4);' +
          ' float shim = 0.85 + 0.15*sin(vU.x*40.0 + t*2.0 + vU.y*8.0); gl_FragColor = vec4(c * edge * f * shim * a * 0.55, 1.0); }'
      });
    }

    function motes(n, area) {
      var g = new T.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3), sp = new Float32Array(n);
      var rnd = U.seeded(311), cols = [new T.Color('#ffe2a0'), new T.Color('#c8a8ff'), new T.Color('#9fd8ff')];
      for (var i = 0; i < n; i++) {
        p[i * 3] = (rnd() - 0.5) * area; p[i * 3 + 1] = rnd() * 6; p[i * 3 + 2] = (rnd() - 0.6) * area * 0.7;
        var k = cols[i % 3]; c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; sp[i] = 0.15 + rnd() * 0.35;
      }
      g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('color', new T.BufferAttribute(c, 3));
      var m = new T.PointsMaterial({ size: 0.13, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.8 });
      var pts = new T.Points(g, m); pts.frustumCulled = false;
      pts.userData.update = function (dt, t) {
        for (var i = 0; i < n; i++) {
          p[i * 3 + 1] += sp[i] * dt; p[i * 3] += Math.sin(t * 0.5 + i) * 0.04 * dt;
          if (p[i * 3 + 1] > 6.5) p[i * 3 + 1] = 0;
        }
        g.attributes.position.needsUpdate = true;
      };
      return pts;
    }

    function addProp(scene, list, type, x, z, ry, s, opts) {
      var o = WF.models.prop(type, Object.assign({ rng: U.seeded(Math.round(x * 31 + z * 17 + 999)) }, opts || {}));
      o.position.set(x, 0, z); o.rotation.y = ry || 0; o.scale.setScalar(s || 1);
      o.traverse(function (m) { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
      scene.add(o); list.push(o);
      return o;
    }

    function pedestal(i) {
      var P = PEDS[i], g = new T.Group(); g.position.set(P.x, 0, P.z);
      var stone = WF.models.toon('#4b4274'), stone2 = WF.models.toon('#5d5390'), stoneD = WF.models.toon('#2f2850');
      var parts = [[1.36, 1.52, 0.22, 0.11, stoneD], [1.1, 1.2, 0.3, 0.37, stone], [1.2, 1.1, 0.1, 0.57, stone2]];
      parts.forEach(function (q) {
        var m = new T.Mesh(new T.CylinderGeometry(q[0], q[1], q[2], 48), q[4]);
        m.position.y = q[3]; m.castShadow = true; m.receiveShadow = true; g.add(m);
      });
      var ring = new T.Mesh(new T.TorusGeometry(1.19, 0.035, 8, 72), new T.MeshBasicMaterial({ color: EMPTY_COL, toneMapped: false }));
      ring.rotation.x = Math.PI / 2; ring.position.y = TOP; g.add(ring);
      var studs = [], studMat = new T.MeshBasicMaterial({ color: EMPTY_COL, toneMapped: false });
      for (var k = 0; k < 8; k++) {
        var a = k / 8 * Math.PI * 2 + Math.PI / 8, st = new T.Mesh(new T.OctahedronGeometry(0.075, 0), studMat);
        st.position.set(Math.cos(a) * 1.16, 0.37, Math.sin(a) * 1.16); st.scale.set(1, 1.6, 1); g.add(st); studs.push(st);
      }
      // invisible pick volume (pedestal + wizard)
      var pick = new T.Mesh(new T.CylinderGeometry(1.45, 1.45, 3.4, 12), new T.MeshBasicMaterial({ visible: false }));
      pick.position.y = 1.7; pick.userData.slot = i; g.add(pick);
      var beam = new T.Mesh(new T.CylinderGeometry(1.05, 1.35, 7.5, 40, 1, true), beamMat(EMPTY_COL));
      beam.position.y = TOP + 3.75; beam.renderOrder = 5; g.add(beam);
      var glow = new T.Sprite(new T.SpriteMaterial({ map: ST.spriteTex, color: EMPTY_COL, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.0 }));
      glow.scale.set(4.2, 4.2, 1); glow.position.y = TOP + 0.05; g.add(glow);
      return { root: g, ring: ring, studMat: studMat, pick: pick, beam: beam, glow: glow, wiz: null, sigil: null, wisp: null, key: '', col: EMPTY_COL, sel: 0, hover: 0, act: null, actT: 0, del: 0, spawn: 1 };
    }

    function build() {
      var scene = new T.Scene();
      scene.fog = new T.Fog(0x130c28, 15, 40);
      var cam = new T.PerspectiveCamera(30, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 200);
      ST = { scene: scene, cam: cam, t: 0, slots: [], props: [], sel: -1, hover: -1, mode: 'select', focus: -1, preview: -1, camPos: new T.Vector3(0, 4.3, 16), camLook: new T.Vector3(0, 0.5, 0.4), spriteTex: glowSprite() };
      var dome = new T.Mesh(new T.SphereGeometry(80, 40, 20), domeMat()); scene.add(dome); ST.dome = dome;
      var fl = new T.Mesh(new T.CircleGeometry(18, 96), new T.MeshLambertMaterial({ map: floorTex() }));
      fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; scene.add(fl);
      scene.add(new T.HemisphereLight(0x9a8cff, 0x1d1430, 0.42));
      var key = new T.DirectionalLight(0xfff0d8, 0.85); key.position.set(4, 10, 8); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024); var sc = key.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 6; sc.bottom = -4; sc.near = 1; sc.far = 30;
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03; scene.add(key); scene.add(key.target);
      var rim = new T.DirectionalLight(0x9a7bff, 0.55); rim.position.set(-6, 5, -7); scene.add(rim);
      var spot = new T.SpotLight(0xffffff, 0, 18, 0.36, 0.6, 1.1); spot.position.set(0, 10, 4); scene.add(spot); scene.add(spot.target); ST.spot = spot;
      // backdrop: a half-ring colonnade with the school banners between the columns, lanterns and
      // crystals (game props, so the art style matches the world)
      var R = 10.5, n = 7;
      for (var c = 0; c < n; c++) {
        var a = (c / (n - 1) - 0.5) * 2.3, px = Math.sin(a) * R, pz = 1.2 - Math.cos(a) * R;
        addProp(scene, ST.props, 'pillar', px, pz, -a, 1.08, { color: '#8c82b8' });
        if (c < n - 1) {
          var a2 = ((c + 0.5) / (n - 1) - 0.5) * 2.3, bc = (D().playableSchools || []).map(schoolCol);
          addProp(scene, ST.props, 'banner', Math.sin(a2) * (R - 0.3), 1.2 - Math.cos(a2) * (R - 0.3), -a2, 0.92, { color: bc.length ? bc[c % bc.length] : '#ffd76a' });
        }
      }
      [-1, 1].forEach(function (s) {
        addProp(scene, ST.props, 'lantern', s * 7.0, 3.0, 0, 0.9, { color: '#ffd27a' });
        addProp(scene, ST.props, 'crystal', s * 7.3, -1.6, s, 1.1, { color: s < 0 ? '#8a6ae8' : '#6fbfe8' });
        addProp(scene, ST.props, 'crystal', s * 2.1, -3.6, s * 2, 0.7, { color: '#a98ae0' });
      });
      var lamp = new T.PointLight(0xffc870, 0.55, 9, 1.6); lamp.position.set(-7.0, 3.1, 3.0); scene.add(lamp);
      var lamp2 = lamp.clone(); lamp2.position.x = 7.0; scene.add(lamp2);
      ST.motes = motes(170, 22); scene.add(ST.motes);
      for (var i = 0; i < 3; i++) { var s = pedestal(i); scene.add(s.root); ST.slots.push(s); }
      return ST;
    }

    function setColor(s, col) {
      if (s.col === col) return;
      s.col = col;
      s.ring.material.color.set(col); s.studMat.color.set(col);
      s.beam.material.uniforms.c.value.set(col); s.glow.material.color.set(col);
    }
    function clearOccupant(s) {
      ['wiz', 'sigil', 'wisp'].forEach(function (k) {
        if (s[k]) { s.root.remove(s[k]); try { WF.models.dispose(s[k]); } catch (e) { /* ignore */ } s[k] = null; }
      });
    }
    function faceCam(o, P) { o.rotation.y = Math.atan2(0 - P.x, 16 - P.z) * 1.6; }
    function fallbackLook(school) {
      var sc = D().schools[school] || {};
      return { robe: sc.robe, hat: sc.hat, trim: sc.trim, skin: '#f2c9a0', hair: '#4a2f1c', staffGem: sc.color, scale: 1, gear: {} };
    }
    // occupant: { look, school } | 'empty' | 'damaged'
    function occupy(i, occ, key) {
      var s = ST.slots[i], P = PEDS[i];
      if (s.key === key) return;
      s.key = key;
      clearOccupant(s);
      s.del = 0; s.root.scale.setScalar(1);
      if (occ === 'empty' || occ === 'damaged') {
        setColor(s, occ === 'empty' ? EMPTY_COL : DAMAGED_COL);
        s.sigil = WF.models.duelRing(0.92, occ === 'empty' ? EMPTY_COL : DAMAGED_COL); s.sigil.position.y = TOP + 0.004; s.root.add(s.sigil);
        s.wisp = WF.models.wisp(); s.wisp.position.y = TOP - 0.15; s.wisp.scale.setScalar(occ === 'empty' ? 0.85 : 0.6); s.root.add(s.wisp);
        return;
      }
      setColor(s, schoolCol(occ.school));
      try { s.sigil = WF.models.duelSigil ? WF.models.duelSigil(occ.school, 0.98) : WF.models.duelRing(0.92, schoolCol(occ.school)); }
      catch (e) { s.sigil = WF.models.duelRing(0.92, schoolCol(occ.school)); }
      s.sigil.position.y = TOP + 0.004; s.root.add(s.sigil);
      var wiz = null;
      try { wiz = WF.models.wizard(occ.look || fallbackLook(occ.school)); }
      catch (e) { console.error('wizard preview failed', e); try { wiz = WF.models.wizard(fallbackLook(occ.school)); } catch (e2) { wiz = null; } }
      if (wiz) {
        wiz.position.y = TOP; faceCam(wiz, P);
        wiz.traverse(function (m) { if (m.isMesh || m.isSkinnedMesh) m.castShadow = true; });
        s.root.add(wiz); s.wiz = wiz; s.spawn = 0;
      }
    }
    function play(i, state, secs) { var s = ST.slots[i]; if (s && s.wiz) { s.act = state; s.actT = secs; } }

    function camGoal() {
      var asp = window.innerWidth / Math.max(1, window.innerHeight), tv = Math.tan(T.MathUtils.degToRad(ST.cam.fov / 2));
      if (ST.mode === 'create' && ST.focus >= 0) {
        // the wizard stands right of centre; the creation panel covers the left of the screen
        var P = PEDS[ST.focus], narrow = window.innerWidth <= 820;
        var off = narrow ? 0 : 1.05 * Math.min(1, 1.78 / asp) + 0.25;
        ST.camPos.set(P.x - off, narrow ? 3.4 : 2.3, P.z + (narrow ? 9.5 : 7.8));
        ST.camLook.set(P.x - off, narrow ? 2.4 : 1.4, P.z);
        return;
      }
      // all three pedestals in view at any aspect ratio, standing in the upper-middle of the screen
      var dist = Math.max(16, 6.2 / (tv * asp) + 1.2);
      ST.camPos.set(0, 4.3 + (dist - 16) * 0.25, dist);
      ST.camLook.set(0, 0.5, 0.4);
    }

    var api = {};
    api.active = false;
    api.ensure = function () { if (!ST) build(); return ST; };
    api.show = function () {
      api.ensure(); api.active = true; ST.mode = 'select';
      camGoal(); ST.cam.position.copy(ST.camPos); ST.curLook = ST.camLook.clone(); ST.cam.lookAt(ST.curLook);
      if (WF.gfx && WF.gfx.setGrade) { try { WF.gfx.setGrade({ style: 'town', grade: { exposure: 1.0, saturation: 1.06, contrast: 1.06, warmth: 0.02, bloom: 0.9, vignette: 0.42, threshold: 1.0, shadowTint: '#e4e0ff', highTint: '#fff8ec' } }, true); } catch (e) { /* default grade */ } }
    };
    api.hide = function () {
      api.active = false;
      if (WF.gfx && WF.gfx.setGrade && WF.world.zone) { try { WF.gfx.setGrade(WF.world.zone, true); } catch (e) { /* ignore */ } }
    };
    api.dispose = function () {
      if (!ST) return;
      api.active = false;
      ST.slots.forEach(clearOccupant);
      try { WF.models.dispose(ST.scene); } catch (e) { /* ignore */ }
      ST = null;
    };
    // summaries from WF.state.slots()
    api.setSlots = function (sl) {
      api.ensure();
      for (var i = 0; i < 3; i++) {
        var s = sl[i];
        if (ST.mode === 'create' && i === ST.preview) continue;
        if (!s) occupy(i, 'empty', 'empty');
        else if (s.damaged) occupy(i, 'damaged', 'damaged');
        else occupy(i, { look: s.look, school: s.school }, 'w|' + s.name + '|' + JSON.stringify(s.look));
      }
    };
    api.select = function (i, cheer) {
      api.ensure();
      if (ST.sel === i) return;
      ST.sel = i;
      if (cheer !== false) play(i, 'cast', 1.0);
    };
    api.hover = function (i) { if (ST) ST.hover = i; };
    api.create = function (i) { api.ensure(); ST.mode = 'create'; ST.focus = i; ST.preview = i; ST.sel = i; camGoal(); };
    api.endCreate = function () { if (!ST) return; ST.mode = 'select'; ST.focus = -1; ST.preview = -1; camGoal(); };
    api.preview = function (i, school, look, tag, quiet) {
      if (quiet === undefined) quiet = !!tag;
      api.ensure();
      var key = 'preview|' + school + (tag ? '|' + tag : '');
      if (ST.slots[i] && ST.slots[i].key === key) return;
      occupy(i, { school: school, look: look }, key);
      if (!quiet) play(i, 'cast_big', 1.4);          // v2.1: restyling the look doesn't replay the cast flourish; picking a school does
    };
    api.vanish = function (i) {           // delete: shrink away in a puff of the school colour
      var s = ST && ST.slots[i]; if (!s || !s.wiz) return;
      s.del = 0.001;
      try {
        var b = WF.models.burst(s.col, 'fizzle'); b.position.set(PEDS[i].x, TOP + 1, PEDS[i].z); b.scale.setScalar(1.6);
        ST.scene.add(b); (ST.fx = ST.fx || []).push(b);
      } catch (e) { /* no fx */ }
    };
    // slot under the pointer (-1 = none)
    api.pick = function (cx, cy) {
      if (!ST) return -1;
      _ndc.set(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, ST.cam);
      var hits = _ray.intersectObjects(ST.slots.map(function (s) { return s.pick; }), false);
      return hits.length ? hits[0].object.userData.slot : -1;
    };
    // screen position (CSS px) of the front edge of pedestal i
    api.screen = function (i) {
      if (!ST) return null;
      _v.set(PEDS[i].x, 0, PEDS[i].z + 1.45).project(ST.cam);
      return { x: (_v.x + 1) / 2 * window.innerWidth, y: (1 - _v.y) / 2 * window.innerHeight };
    };
    api.update = function (dt) {
      if (!ST) return;
      ST.t += dt;
      var t = ST.t, cam = ST.cam;
      var asp = window.innerWidth / Math.max(1, window.innerHeight);
      if (Math.abs(cam.aspect - asp) > 1e-3) { cam.aspect = asp; cam.updateProjectionMatrix(); }
      camGoal();
      var k = 1 - Math.exp(-dt * 2.6);
      cam.position.lerp(ST.camPos, k);
      ST.curLook = ST.curLook || ST.camLook.clone(); ST.curLook.lerp(ST.camLook, k);
      cam.position.x += Math.sin(t * 0.21) * 0.02; cam.position.y += Math.sin(t * 0.33) * 0.012;
      cam.lookAt(ST.curLook);
      ST.dome.material.uniforms.t.value = t;
      ST.props.forEach(function (o) { if (o.userData.anim) o.userData.anim(t); });
      if (ST.motes) ST.motes.userData.update(dt, t);
      ST.slots.forEach(function (s, i) {
        var on = i === ST.sel ? 1 : 0, hov = (i === ST.hover && i !== ST.sel) ? 1 : 0;
        s.sel += (on - s.sel) * Math.min(1, dt * 5); s.hover += (hov - s.hover) * Math.min(1, dt * 8);
        s.beam.material.uniforms.a.value = s.sel; s.beam.material.uniforms.t.value = t; s.beam.visible = s.sel > 0.01;
        s.glow.material.opacity = 0.18 + s.sel * 0.45 + s.hover * 0.2 + Math.sin(t * 2 + i) * 0.04;
        if (s.sigil && s.sigil.userData.anim) s.sigil.userData.anim(t + i);
        if (s.wisp && s.wisp.userData.anim) s.wisp.userData.anim(t + i * 1.7);
        if (s.wiz) {
          if (s.spawn < 1) { s.spawn = Math.min(1, s.spawn + dt * 2.5); var e = 1 - Math.pow(1 - s.spawn, 3); s.wiz.scale.setScalar(0.25 + 0.75 * e); }
          var state = 'idle';
          if (s.act && s.actT > 0) { s.actT -= dt; state = s.act; if (s.actT <= 0) s.act = null; }
          if (s.wiz.userData.anim) s.wiz.userData.anim(t + i * 3.1, state, dt);
          if (s.del > 0) {
            s.del += dt * 1.8;
            var q = Math.max(0, 1 - s.del); s.wiz.scale.setScalar(q * q); s.wiz.position.y = TOP + (1 - q) * 0.6;
          }
        }
      });
      if (ST.fx) ST.fx = ST.fx.filter(function (f) { var alive = f.userData.update ? f.userData.update(dt) !== false : false; if (!alive) { ST.scene.remove(f); try { WF.models.dispose(f); } catch (e) { /* ignore */ } } return alive; });
      // spotlight follows the selection
      var tgt = ST.sel >= 0 ? PEDS[ST.sel] : PEDS[1];
      ST.spot.target.position.x += (tgt.x - ST.spot.target.position.x) * k * 2; ST.spot.target.position.z += (tgt.z - ST.spot.target.position.z) * k * 2;
      ST.spot.position.set(ST.spot.target.position.x * 0.8, 9, ST.spot.target.position.z + 3);
      ST.spot.intensity += ((ST.sel >= 0 ? 1.7 : 0) - ST.spot.intensity) * k * 2;
      if (ST.sel >= 0 && ST.slots[ST.sel]) ST.spot.color.set(ST.slots[ST.sel].col).lerp(new T.Color('#ffffff'), 0.55);
    };
    api.render = function () {
      if (!ST) return;
      if (WF.gfx && WF.gfx.ready) WF.gfx.render(ST.scene, ST.cam);
      else WF.world.renderer.render(ST.scene, ST.cam);
    };
    api._st = function () { return ST; };       // tests / debugging
    return api;
  })();
  M.stage = Stage;

  // ------------------------------------------------------------------
  // Title + "Choose your Wizard" + character creation
  // ------------------------------------------------------------------
  var sel = 0;                 // selected slot on the select screen
  var slotCache = null;        // last WF.state.slots()
  var platesRaf = 0;

  function titleMode(on) {
    document.body.classList.toggle('ac-title', !!on);
  }
  function hasNative() { return !!(N && N.isDesktop); }

  function showTitle() {
    var t = el('title');
    stopPlates();
    keysOn(false);
    if (Stage.active) { Stage.hide(); }
    t.className = '';
    t.onkeydown = null;
    titleMode(true);
    var has = WF.state.hasSave();
    var lastS = has ? (WF.state.slots()[WF.state.lastSlot()] || null) : null;
    t.innerHTML =
      '<div class="tt-logo">Wizzie<span>Farm</span></div>' +
      '<div class="tt-sub">A wizard’s tale of the Lumen Order and the Hollow Court</div>' +
      '<div class="tt-buttons">' +
      (has ? '<button class="btn primary big" id="tt-play">Play<small>' + (lastS && !lastS.damaged ? U.esc(lastS.name) + ' · Level ' + U.esc(lastS.level) + ' ' + U.esc(lastS.schoolName) : 'Choose your wizard') + '</small></button>'
        : '<button class="btn primary big" id="tt-new">New Wizard</button>') +
      '</div>' +
      (has ? '' : '<div class="tt-buttons ac-sub-buttons"><button class="btn btn-ghost" id="tt-import" title="A .json file saved with Menu → Export">' + (hasNative() ? 'Import save from browser…' : 'Import a save file…') + '</button></div>') +
      (hasNative() && !has ? '<div class="ac-first">Played Wizzie Farm in the browser before? Open it there, choose <b>Menu → Export all wizards</b>, then click <b>Import save from browser…</b> here and pick that file.</div>' : '') +
      '<div class="tt-foot">' + versionLine() + '</div>' +
      (hasNative() ? '<div class="ac-corner"><button class="btn sm btn-ghost" id="tt-upd">Check for updates</button><button class="btn sm btn-ghost" id="tt-quit">Quit</button></div>' : '') +
      '<input type="file" id="ac-file" accept=".json,application/json" class="hidden">';
    t.classList.remove('hidden');
    setTimeout(function () { var f = el('tt-play') || el('tt-new'); if (f) f.focus(); }, 50);
    if (el('tt-play')) el('tt-play').onclick = function () { goSelect(); };
    if (el('tt-new')) el('tt-new').onclick = function () { showCreate(0); };
    if (el('tt-import')) el('tt-import').onclick = function () { pickImport(null); };
    if (el('tt-upd')) el('tt-upd').onclick = function () { M.checkUpdates(true); };
    if (el('tt-quit')) el('tt-quit').onclick = function () { N.app.quit(); };
    titleNotices();
  }
  function versionLine() {
    var v = 'v' + M.VERSION + ' · solo or with friends · made for fun';   // v2.0: Realms (co-op)
    if (hasNative()) v += ' · desktop app ' + U.esc((N.version && N.version.shell) || '');
    return v;
  }
  function titleNotices() {
    if (WF.state.recovered === 'backup') WF.ui.toast('Your save file was damaged, so the safety copy was loaded. (The damaged text is kept.)', 'warn', 9000);
    else if (WF.state.recovered === 'reset') WF.ui.toast('Your save file was damaged and could not be read. The damaged text is kept; ask for help to recover it.', 'warn', 12000);
    WF.state.recovered = null;
    if (WF.state.legacyPending) { WF.ui.toast('A save from an older version of Wizzie Farm was found, but all 3 wizard slots are full. Delete a wizard to bring it in.', 'warn', 10000); WF.state.legacyPending = false; }
  }

  async function goSelect() {
    await WF.ui.fade(true);
    showSelect();
    await WF.ui.fade(false);
  }

  // ---- Choose your Wizard
  function showSelect(pick) {
    var t = el('title');
    titleMode(true);
    t.onkeydown = null;
    t.className = 'ac-mode';
    Stage.show();
    slotCache = WF.state.slots();
    var lastI = WF.state.lastSlot();
    sel = pick != null ? pick : (slotCache[lastI] ? lastI : Math.max(0, slotCache.findIndex(function (s) { return !!s; })));
    Stage.setSlots(slotCache);
    Stage.select(sel, false);
    t.innerHTML =
      '<div class="ac-head"><div class="ac-logo">Wizzie<span>Farm</span></div><div class="ac-title">Choose your Wizard</div></div>' +
      '<div class="ac-plates" id="ac-plates"></div>' +
      '<div class="ac-bar" id="ac-bar"></div>' +
      '<div class="ac-side">' +
        '<button class="btn sm btn-ghost" id="ac-back" title="Back to the title screen (Esc)">‹ Title</button>' +
        '<button class="btn sm btn-ghost" id="ac-settings">Settings</button>' +
        '<button class="btn sm btn-ghost" id="ac-exp-all" title="Save every wizard to one file (a backup you can import later)">Export all wizards</button>' +
        (hasNative() ? '<button class="btn sm btn-ghost" id="ac-upd">Check for updates</button>' : '') +
      '</div>' +
      '<div class="ac-keys" id="ac-keys"></div>' +
      '<div class="ac-ver">' + versionLine() + '</div>' +
      '<div id="ac-modal-host"></div>' +
      '<input type="file" id="ac-file" accept=".json,application/json" class="hidden">';
    t.classList.remove('hidden');
    renderPlates();
    renderBar();
    el('ac-back').onclick = function () { showTitle(); };
    el('ac-exp-all').onclick = exportAll;
    el('ac-settings').onclick = showSettings;
    if (el('ac-upd')) el('ac-upd').onclick = function () { M.checkUpdates(true); };
    // pointer: pedestals in the 3D scene
    t.onpointermove = function (e) { if (e.target === t || e.target.id === 'ac-plates') { var i = Stage.pick(e.clientX, e.clientY); Stage.hover(i); t.style.cursor = i >= 0 ? 'pointer' : ''; } };
    t.onclick = function (e) {
      if (e.target !== t && e.target.id !== 'ac-plates') return;
      var i = Stage.pick(e.clientX, e.clientY);
      if (i >= 0) { if (i === sel && e.detail >= 2) primary(); else choose(i); }
    };
    t.ondblclick = function (e) { if (e.target === t || e.target.id === 'ac-plates') { var i = Stage.pick(e.clientX, e.clientY); if (i >= 0 && i === sel) primary(); } };
    t.onkeydown = null;
    keysOn(true);
    t.setAttribute('tabindex', '-1');
    setTimeout(function () { var b = el('ac-primary'); if (b) b.focus(); else t.focus(); }, 60);
    startPlates();
    titleNotices();
  }
  // keyboard on the select screen: listen on the document (buttons are re-rendered on every
  // change, so focus can fall back to <body>)
  var keysBound = false;
  function keysOn(on) {
    if (on && !keysBound) { document.addEventListener('keydown', selectKeys); keysBound = true; }
    else if (!on && keysBound) { document.removeEventListener('keydown', selectKeys); keysBound = false; }
  }
  function selectKeys(e) {
    if (!el('ac-plates') || el('title').classList.contains('hidden')) { keysOn(false); return; }
    if (el('ac-modal')) return;
    if (U.isTyping(e.target)) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); choose((sel + 2) % 3); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); choose((sel + 1) % 3); }
    else if (/^(Digit|Numpad)[1-3]$/.test(e.code)) choose(+e.code.slice(-1) - 1);
    else if (e.code === 'Enter' && !e.repeat) { var f = document.activeElement; if (!(f && f.tagName === 'BUTTON' && f.id !== 'ac-primary')) { e.preventDefault(); primary(); } }
    else if ((e.code === 'Delete' || e.code === 'Backspace') && slotCache[sel]) { e.preventDefault(); askDelete(sel); }
    else if (e.code === 'Escape') showTitle();
  }
  function choose(i) {
    if (i === sel) return;
    sel = i;
    Stage.select(i);
    WF.sfx.play(slotCache[i] && !slotCache[i].damaged ? 'cast_' + slotCache[i].school : 'hover');
    renderPlates(); renderBar();
  }
  function fmtTime(sec) {
    var m = Math.round((sec || 0) / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function renderPlates() {
    var host = el('ac-plates'); if (!host) return;
    host.innerHTML = slotCache.map(function (s, i) {
      var cls = 'ac-plate' + (i === sel ? ' on' : '') + (!s ? ' empty' : '') + (s && s.damaged ? ' damaged' : '');
      var col = s && !s.damaged ? (D().schools[s.school] || {}).color : '';
      var inner;
      if (!s) inner = '<div class="ac-name">Empty slot</div><div class="ac-sub">Create a new wizard</div>';
      else if (s.damaged) inner = '<div class="ac-name">' + (U.esc(s.name) || 'Damaged save') + '</div><div class="ac-sub">This save is damaged</div><div class="ac-meta">Export it for repair, or delete it</div>';
      else inner = '<div class="ac-name' + (s.name.length > 15 ? ' long' : '') + '" title="' + U.esc(s.name) + '">' + U.esc(s.name) + '</div>' +
        '<div class="ac-sub"><b class="ac-glyph">' + U.esc((D().schools[s.school] || {}).glyph || '') + '</b> Level ' + U.esc(s.level) + ' ' + U.esc(s.schoolName) + '</div>' +
        '<div class="ac-meta">' + U.esc(s.zoneName) + ' · ' + fmtTime(s.playTime) + '</div>';
      return '<div class="' + cls + '" data-i="' + i + '"' + (col ? ' style="--sc:' + col + '"' : '') + ' role="button" tabindex="0" aria-label="Wizard slot ' + (i + 1) + '">' +
        '<div class="ac-num">' + (i + 1) + '</div>' + inner + '</div>';
    }).join('');
    host.querySelectorAll('.ac-plate').forEach(function (p) {
      var i = +p.getAttribute('data-i');
      p.onclick = function (e) { if (i === sel && e.detail >= 2) primary(); else choose(i); };
      p.onmouseenter = function () { Stage.hover(i); };
      p.onmouseleave = function () { Stage.hover(-1); };
      p.onkeydown = function (e) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (i === sel) primary(); else choose(i); } };
    });
    placePlates();
  }
  function placePlates() {
    var host = el('ac-plates'); if (!host || !Stage.active) return;
    var ps = host.querySelectorAll('.ac-plate'), bar = el('ac-bar');
    var barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight - 110;
    for (var i = 0; i < ps.length; i++) {
      var p = Stage.screen(i); if (!p) continue;
      var w = ps[i].offsetWidth || 240, h = ps[i].offsetHeight || 90, x = Math.max(w / 2 + 8, Math.min(window.innerWidth - w / 2 - 8, p.x));
      var y = Math.min(p.y + 6, barTop - h - 12);                  // never under the Play bar
      ps[i].style.transform = 'translate(' + Math.round(x - w / 2) + 'px,' + Math.round(y) + 'px)';
    }
  }
  function startPlates() { stopPlates(); var f = function () { placePlates(); platesRaf = requestAnimationFrame(f); }; platesRaf = requestAnimationFrame(f); }
  function stopPlates() { if (platesRaf) cancelAnimationFrame(platesRaf); platesRaf = 0; }

  function renderBar() {
    var bar = el('ac-bar'); if (!bar) return;
    var s = slotCache[sel];
    if (!s) {
      bar.innerHTML = '<button class="btn" id="ac-import" title="Put a wizard from an exported .json file into this slot">Import…</button>' +
        '<button class="btn primary big" id="ac-primary">Create Wizard</button>' +
        '<span class="ac-gap"></span>';
      el('ac-import').onclick = function () { pickImport(sel); };
    } else if (s.damaged) {
      bar.innerHTML = '<button class="btn" id="ac-export">Export…</button>' +
        '<button class="btn primary big" id="ac-primary" disabled>Play</button>' +
        '<button class="btn ac-danger" id="ac-delete">Delete</button>';
    } else {
      bar.innerHTML = '<button class="btn" id="ac-export" title="Save this wizard to a .json file">Export…</button>' +
        '<button class="btn primary big" id="ac-primary" title="Play ' + U.esc(s.name) + ' (Enter)">Play</button>' +
        '<button class="btn ac-danger" id="ac-delete" title="Delete this wizard (Del)">Delete</button>';
    }
    var keys = el('ac-keys');
    if (keys) keys.innerHTML = '← → choose &nbsp;·&nbsp; ' + (!s ? 'Enter create' : s.damaged ? 'Del delete' : 'Enter play &nbsp;·&nbsp; Del delete');
    if (el('ac-primary')) el('ac-primary').onclick = primary;
    if (el('ac-export')) el('ac-export').onclick = function () { exportSlot(sel); };
    if (el('ac-delete')) el('ac-delete').onclick = function () { askDelete(sel); };
    var a = document.activeElement;
    if ((!a || a === document.body) && el('ac-primary') && !el('ac-modal')) el('ac-primary').focus({ preventScroll: true });
  }
  function primary() {
    var s = slotCache[sel];
    if (!s) { showCreate(sel); return; }
    if (s.damaged) return;
    playSlot(sel);
  }
  function playSlot(i) {
    var p = WF.state.loadSlot(i);
    if (!p) { WF.ui.toast('That wizard could not be loaded.', 'warn'); return; }
    stopPlates();
    keysOn(false);
    var title = el('title');
    title.onkeydown = title.onclick = title.ondblclick = title.onpointermove = null;
    WF.ui.fade(true).then(function () {
      Stage.dispose();
      startGame(false);
      if (WF.state.grantApplied) setTimeout(function () { WF.ui.toast('Unlocked <b>' + WF.state.grantApplied + '</b> epic/legendary items and mounts. Your best set is equipped. Open your Backpack (B) and press R to ride.', 'quest', 9000); }, 1500);
    });
  }

  // ---- Delete (type the wizard's name to confirm)
  function modal(html) {
    var host = el('ac-modal-host') || el('title');
    var m = document.createElement('div'); m.id = 'ac-modal'; m.className = 'ac-modal';
    m.innerHTML = '<div class="ac-card">' + html + '</div>';
    host.appendChild(m);
    m.onclick = function (e) { if (e.target === m) closeModal(); };
    m.onkeydown = function (e) { if (e.code === 'Escape') { e.stopPropagation(); closeModal(); } };
    return m;
  }
  function closeModal() { var m = el('ac-modal'); if (m) m.remove(); var b = el('ac-primary'); if (b) b.focus(); }
  function askDelete(i) {
    var s = slotCache[i]; if (!s) return;
    var name = s.damaged ? (s.name || 'DELETE') : s.name;
    var m = modal('<h3>Delete ' + U.esc(name) + '?</h3>' +
      '<p>' + (s.damaged ? 'This damaged save will be removed.' : 'Level ' + U.esc(s.level) + ' ' + U.esc(s.schoolName) + ' · ' + fmtTime(s.playTime) + ' played.') +
      ' <b>This cannot be undone.</b> Export the wizard first if you might want it back.</p>' +
      '<label>Type <b class="ac-typed">' + U.esc(name) + '</b> to confirm<input id="ac-del-name" autocomplete="off" spellcheck="false" maxlength="24"></label>' +
      '<div class="ac-row"><button class="btn btn-ghost" id="ac-del-no">Keep wizard</button><button class="btn ac-danger" id="ac-del-yes" disabled>Delete forever</button></div>');
    var inp = el('ac-del-name'), yes = el('ac-del-yes');
    var norm = function (v) { return String(v).trim().toLowerCase().replace(/\s+/g, ' '); };
    inp.oninput = function () { yes.disabled = norm(inp.value) !== norm(name); };
    inp.onkeydown = function (e) { if (e.code === 'Enter' && !yes.disabled) { e.preventDefault(); yes.click(); } if (e.code === 'Escape') { e.stopPropagation(); closeModal(); } };
    el('ac-del-no').onclick = closeModal;
    yes.onclick = function () {
      if (norm(inp.value) !== norm(name)) return;
      closeModal();
      Stage.vanish(i);
      WF.sfx.play('fizzle');
      setTimeout(function () {
        if (!WF.state.deleteSlot(i)) { WF.ui.toast('Could not delete (storage blocked).', 'warn'); }
        else WF.ui.toast(U.esc(name) + ' was deleted.', 'info');
        refreshSelect(i);
      }, 650);
    };
    setTimeout(function () { inp.focus(); }, 30);
    void m;
  }
  function refreshSelect(keep) {
    slotCache = WF.state.slots();
    if (keep != null) sel = keep;
    Stage.setSlots(slotCache);
    renderPlates(); renderBar();
  }

  // ---- Export / import
  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function fileSafe(s) { return String(s || 'Wizard').replace(/[^a-z0-9]/gi, '') || 'Wizard'; }
  function stamp() { var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
  function exportSlot(i) {
    var text = WF.state.exportSlot(i), s = slotCache && slotCache[i];
    if (!text) return;
    download('WizzieFarm-' + fileSafe(s && s.name) + (s && s.level ? '-Lv' + s.level : '') + '.json', text);
    WF.ui.toast('Wizard exported.', 'info');
  }
  function exportAll() {
    download('WizzieFarm-all-wizards-' + stamp() + '.json', WF.state.exportAccount());
    WF.ui.toast('All wizards exported to one file.', 'info');
  }
  M.exportActive = function () {
    var p = WF.state.player; if (!p) return;
    download('WizzieFarm-' + fileSafe(p.name) + '-Lv' + p.level + '.json', WF.state.exportSave());
  };
  M.exportAll = exportAll;

  // Import into `slot` (or, from the title / menu with slot null, into empty slots in order)
  function pickImport(slot) {
    var f = el('ac-file');
    if (!f) { f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json'; f.id = 'ac-file'; f.className = 'hidden'; el('title').appendChild(f); }
    f.value = '';
    f.onchange = function () {
      var file = f.files && f.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = function () { importText(String(r.result || ''), slot); };
      r.onerror = function () { WF.ui.toast('Could not read that file.', 'warn'); };
      r.readAsText(file);
    };
    f.click();
  }
  // -> { imported: [slot...], names: [...], skipped, full }
  M.importIntoEmpty = function (text) {
    var r = WF.state.parseImport(text), out = { ok: r.ok, error: r.error, imported: [], names: [], full: 0 };
    if (!r.ok) return out;
    r.wizards.forEach(function (w) {
      var at = WF.state.firstEmptySlot();
      if (at < 0) { out.full++; return; }
      if (WF.state.importWizard(w, at)) { out.imported.push(at); out.names.push(w.name); }
    });
    // an "Export all wizards" file also carries the shared bank: restored into an empty bank only
    if (r.bank && out.imported.length && WF.state.importBank) out.bank = WF.state.importBank(r.bank);
    // v2.0 save v5: your last realm code too, when this account has none yet
    if (r.realm && out.imported.length && WF.state.importRealm) WF.state.importRealm(r.realm);
    return out;
  };
  function bankNote(res) {
    if (!res.bank) return '';
    var b = res.bank, pets = b.pets ? ', ' + b.pets + ' pet' + (b.pets === 1 ? '' : 's') : '';
    return b.ok ? ' The shared bank came too (' + b.items + ' item' + (b.items === 1 ? '' : 's') + pets + ').' : (/already has/.test(b.reason || '') ? ' ' + U.esc(b.reason) + '.' : '');
  }
  M.importBankNote = bankNote;
  function importText(text, slot) {
    var r = WF.state.parseImport(text);
    if (!r.ok) { WF.ui.toast(U.esc(r.error || 'That file is not a valid Wizzie Farm save.'), 'warn', 6000); return; }
    if (slot == null) {
      var res = M.importIntoEmpty(text);
      if (!res.imported.length) { WF.ui.toast('All 3 wizard slots are full. Delete a wizard first.', 'warn', 6000); return; }
      WF.ui.toast('Imported ' + res.names.map(U.esc).join(', ') + (res.full ? ' (' + res.full + ' did not fit: all slots full)' : '') + '.' + bankNote(res), 'quest', 8000);
      showSelect(res.imported[0]);
      return;
    }
    var finish = function (w) {
      if (!WF.state.importWizard(w, slot)) { WF.ui.toast('Could not import (storage blocked?).', 'warn'); return; }
      WF.ui.toast('Imported <b>' + U.esc(w.name) + '</b> into slot ' + (slot + 1) + '.', 'quest');
      refreshSelect(slot);
      Stage.select(-1, false); Stage.select(slot);
    };
    if (r.wizards.length === 1) { finish(r.wizards[0]); return; }
    // an "all wizards" file: choose which one goes into this slot
    modal('<h3>Which wizard?</h3><p>This file has ' + r.wizards.length + ' wizards. Pick one for slot ' + (slot + 1) + '.</p>' +
      '<div class="ac-list">' + r.wizards.map(function (w, k) {
        var sc = D().schools[w.school] || {};
        return '<button class="btn ac-pick" data-k="' + k + '" style="--sc:' + sc.color + '"><b>' + U.esc(w.name) + '</b><small>Level ' + w.level + ' ' + U.esc(sc.name || '') + '</small></button>';
      }).join('') + '</div><div class="ac-row"><button class="btn btn-ghost" id="ac-pick-no">Cancel</button></div>');
    document.querySelectorAll('.ac-pick').forEach(function (b) { b.onclick = function () { closeModal(); finish(r.wizards[+b.getAttribute('data-k')]); }; });
    el('ac-pick-no').onclick = closeModal;
  }

  // ---- Settings before a wizard is loaded (account settings)
  function showSettings() {
    var s = WF.state.accountSettings();
    var q = (WF.gfx && WF.gfx.qualities) || ['high', 'medium', 'low'];
    modal('<h3>Settings</h3>' +
      '<label class="ac-set">Master volume <input type="range" id="as-vol" min="0" max="100" value="' + Math.round(s.master * 100) + '"></label>' +
      '<label class="ac-set">Music volume <input type="range" id="as-mus" min="0" max="100" value="' + Math.round(s.music * 100) + '"></label>' +
      '<label class="ac-set">Text size <select id="as-text"><option value="1">Normal</option><option value="1.15">Large</option><option value="1.3">Extra large</option></select></label>' +
      '<label class="ac-set">Graphics <select id="as-gfx"><option value="auto">Auto (recommended)</option>' + q.map(function (k) { return '<option value="' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</option>'; }).join('') + '</select></label>' +
      '<p class="dim">Each wizard keeps its own settings in the game menu; these are used here and for new wizards.</p>' +
      '<div class="ac-row"><button class="btn primary" id="as-ok">Done</button></div>');
    el('as-text').value = String(s.textScale); el('as-gfx').value = s.quality;
    var apply = function () {
      WF.state.setAccountSettings({ master: el('as-vol').value / 100, music: el('as-mus').value / 100, textScale: parseFloat(el('as-text').value), quality: el('as-gfx').value });
      applyAccountSettings();
    };
    ['as-vol', 'as-mus'].forEach(function (id) { el(id).oninput = function () { var a = WF.state.accountSettings(); WF.sfx.setVolume(el('as-vol').value / 100, el('as-mus').value / 100); void a; }; el(id).onchange = apply; });
    el('as-text').onchange = apply; el('as-gfx').onchange = apply;
    el('as-ok').onclick = function () { apply(); closeModal(); };
  }

  // ---- Create a wizard in `slot`
  var NAMES = ['Merrin', 'Quill', 'Tamsin', 'Bram', 'Juniper', 'Orrin', 'Wisp', 'Fable', 'Rowan', 'Ember', 'Pike', 'Lark', 'Sable', 'Thistle'];
  var SUR = ['Starweaver', 'Moonbrook', 'Ashfeather', 'Stormwick', 'Thornbury', 'Glimmerstone', 'Brightwater', 'Hollowell', 'Dawnmantle', 'Copperleaf'];

  // the create panel's details pane: all three schools in one line each, or the chosen one in full
  function schoolsOverview() {
    return '<div class="cr-ov-head">Choose a school. Each one plays differently:</div>' + D().playableSchools.map(function (id) {
      var s = D().schools[id];
      return '<div class="cr-ov" style="--sc:' + s.color + '"><b>' + U.esc(s.name) + '</b> <span>' + U.esc(s.role) + '</span> ' + U.esc(s.tagline || '') + '</div>';
    }).join('') + '<div class="cr-ov-foot">You can make up to 3 wizards, so you can try them all.</div>';
  }
  function schoolDetail(id) {
    var s = D().schools[id];
    var bar = function (label, v) { var o = ''; for (var i = 0; i < 5; i++) o += '<i class="' + (i < v ? 'on' : '') + '"></i>'; return '<div class="cr-bar"><span>' + label + '</span><b>' + o + '</b></div>'; };
    var intro = D().lore && D().lore.schoolIntros && D().lore.schoolIntros[id];
    var start = Object.keys(D().cards).filter(function (c) { return D().cards[c].school === id && D().cards[c].level <= 1 && !D().cards[c].source; }).map(function (c) { return U.esc(D().cards[c].name); });
    return '<div class="cr-tag">' + U.esc(s.tagline) + '</div>' +
      '<div class="cr-bars">' + bar('Health', s.bars.health) + bar('Damage', s.bars.damage) + bar('Defense', s.bars.defense) + bar('Accuracy', s.bars.accuracy) + '</div>' +
      '<div class="cr-desc">' + U.esc(intro || s.desc) + '</div>' +
      '<div class="cr-start">Starting spells: ' + start.join(', ') + '</div>';
  }

  function showCreate(slot) {
    var t = el('title');
    if (slot == null || slot < 0) slot = WF.state.firstEmptySlot();
    if (slot < 0) { WF.ui.toast('All 3 wizard slots are full. Delete a wizard first.', 'warn'); return; }
    stopPlates();
    keysOn(false);
    titleMode(true);
    var fromSelect = Stage.active;
    if (!Stage.active) { Stage.show(); slotCache = WF.state.slots(); Stage.setSlots(slotCache); }
    Stage.create(slot);
    t.className = 'ac-mode ac-create-mode';
    t.onclick = t.ondblclick = t.onpointermove = null;
    var chosen = null;
    // three compact school cards in a row; the chosen school's details fill the pane below them
    var html = '<div class="ac-create"><div class="cr-title">Create your Wizard</div><div class="ac-slotnote">Wizard slot ' + (slot + 1) + ' of 3</div><div class="cr-schools">';
    D().playableSchools.forEach(function (id, k) {
      var s = D().schools[id];
      html += '<div class="cr-school" data-s="' + id + '" style="--sc:' + s.color + ';--scd:' + s.dark + '">' +
        '<div class="cr-glyph">' + s.glyph + '</div>' +
        '<div class="cr-head"><div class="cr-name">' + U.esc(s.name) + '</div><div class="cr-role">' + U.esc(s.role) + '</div></div>' +
        '<div class="cr-key">' + (k + 1) + '</div></div>';
    });
    html += '</div><div class="cr-tabs"><button class="btn sm on" id="cr-tab-school">1. School</button><button class="btn sm" id="cr-tab-look" disabled title="Choose a school first">2. Your look</button></div>' +
      '<div class="cr-detail" id="cr-detail">' + schoolsOverview() + '</div>' +
      '<div class="ac-create-foot"><div class="cr-name-row"><label for="cr-name">Wizard name</label><input id="cr-name" maxlength="18" value="' + U.esc(U.pick(NAMES) + ' ' + U.pick(SUR)) + '"><button class="btn" id="cr-rand" title="Random name">↻</button></div>' +
      '<div class="tt-buttons"><button class="btn btn-ghost" id="cr-back">Back</button><button class="btn primary big" id="cr-go" disabled>Begin your adventure</button></div></div></div>' +
      '<div class="ac-preview-hint" id="ac-preview-hint">Choose a school to see your wizard</div>' +
      '<div id="ac-modal-host"></div>';
    t.innerHTML = html;
    t.classList.remove('hidden');
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (eF) { /* old browsers */ }   // v2.1 QA: keys 1-3 work without a click first
    var cards = t.querySelectorAll('.cr-school');
    // v2.1 WS-D: W101-style look step (build, face, eyes, nose, mouth, hair, colours), live on the stage
    var look = WF.lookEditor ? WF.lookEditor.normal(null) : null, lookTab = false;
    function showLook() {
      if (!look || !chosen) return;
      Stage.preview(slot, chosen, WF.state.appearanceFor({ school: chosen, equipped: {}, look: look }), JSON.stringify(look));
    }
    function tabs(onLook) {
      lookTab = onLook;
      el('cr-tab-school').classList.toggle('on', !onLook); el('cr-tab-look').classList.toggle('on', onLook);
      var det = el('cr-detail'); if (!det) return;
      if (onLook && WF.lookEditor) { det.innerHTML = ''; WF.lookEditor.render(det, look, function (l) { look = l; showLook(); }); det.scrollTop = 0; }
      else det.innerHTML = chosen ? schoolDetail(chosen) : schoolsOverview();
      moreFade();
    }
    el('cr-tab-school').onclick = function () { tabs(false); };
    el('cr-tab-look').onclick = function () { if (chosen) tabs(true); };
    // the details pane scrolls when the lore is long: fade its bottom edge until the end is reached
    var moreFade = function () { var d = el('cr-detail'); if (d) d.classList.toggle('more', d.scrollTop + d.clientHeight < d.scrollHeight - 4); };
    if (el('cr-detail')) el('cr-detail').onscroll = moreFade;
    cards.forEach(function (n, i) {
      n.setAttribute('tabindex', '0');
      n.setAttribute('role', 'button');
      n.setAttribute('aria-label', 'Choose ' + n.querySelector('.cr-name').textContent + ' (' + (i + 1) + ')');
      n.onclick = function () {
        var id = n.getAttribute('data-s');
        if (chosen === id) return;
        cards.forEach(function (m) { m.classList.remove('on'); });
        n.classList.add('on'); chosen = id;
        var det = el('cr-detail'); if (det) { if (!lookTab) det.innerHTML = schoolDetail(id); det.scrollTop = 0; det.style.setProperty('--sc', D().schools[id].color); moreFade(); }
        el('cr-go').disabled = false;
        el('cr-tab-look').disabled = false; el('cr-tab-look').title = 'Build, face, eyes, hair and colours';
        var hint = el('ac-preview-hint'); if (hint) { hint.classList.add('gone'); setTimeout(function () { if (hint.parentNode) hint.remove(); }, 450); }
        WF.sfx.play('cast_' + chosen);
        Stage.preview(slot, chosen, WF.state.appearanceFor({ school: chosen, equipped: {}, look: look }), look ? JSON.stringify(look) : null, false);
      };
      n.onkeydown = function (e) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); n.click(); } };
    });
    // keys 1-3 pick a school (unless typing the name)
    t.onkeydown = function (e) {
      if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter' && !el('cr-go').disabled) { e.preventDefault(); el('cr-go').click(); } return; }
      var d = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (d && cards[+d[2] - 1]) { cards[+d[2] - 1].click(); cards[+d[2] - 1].focus(); }
      else if (e.code === 'Escape') el('cr-back').click();
    };
    el('cr-rand').onclick = function () { el('cr-name').value = U.pick(NAMES) + ' ' + U.pick(SUR); };
    el('cr-back').onclick = function () {
      t.onkeydown = null;
      Stage.endCreate();
      if (fromSelect || WF.state.hasSave()) showSelect(slot); else { Stage.hide(); Stage.setSlots(WF.state.slots()); showTitle(); }
    };
    el('cr-go').onclick = function () {
      if (!chosen) return;
      t.onkeydown = null;
      var name = el('cr-name').value.trim().replace(/[<>&"]/g, '') || 'Wizard';
      if (!WF.state.newGame(name, chosen, slot, look)) { WF.ui.toast('Could not create the wizard (storage blocked?).', 'warn'); return; }
      Stage.endCreate();
      showIntro();
    };
  }

  function showIntro() {
    var t = el('title');
    t.className = 'ac-intro-mode';
    var lines = (D().lore && D().lore.intro) || ['Welcome to the Lumen Spire, young wizard.'];
    var i = 0;
    function show() {
      t.innerHTML = '<div class="intro"><div class="intro-text">' + U.esc(U.fillText(lines[i])) + '</div>' +
        '<div class="tt-buttons"><button class="btn btn-ghost" id="in-skip">Skip</button><button class="btn primary" id="in-next">' + (i < lines.length - 1 ? 'Next ▶' : 'Enter the Commons') + '</button></div></div>';
      el('in-next').onclick = function () { i++; if (i >= lines.length) begin(); else show(); };
      el('in-skip').onclick = begin;
    }
    function begin() { Stage.dispose(); startGame(true); }
    show();
  }

  function startGame(isNew) {
    el('title').classList.add('hidden');
    el('title').className = 'hidden';
    titleMode(false);
    stopPlates();
    Stage.dispose();
    var p = WF.state.player;
    WF.ui.applyTextScale();
    WF.sfx.setVolume(p.settings.master, p.settings.music);
    var gq = p.settings.graphics || (p.settings.lowGraphics ? 'low' : 'auto');
    WF.world.setQuality(gq === 'auto' ? 'high' : gq);
    if (gq === 'auto') startProbe();
    WF.world.player = null;               // build the player avatar fresh
    M.travel(p.zone, isNew ? null : p.pos, false, true).then(function () {
      started = true;
      if (isNew) {
        setTimeout(function () {
          var ui = (D().lore && D().lore.ui) || {};
          WF.ui.toast(U.esc(U.fillText(ui.welcome || 'Welcome, {name}! Talk to Headmistress Aurelia - look for the gold "!" above her head.')), 'quest', 9000);
          WF.ui.toast(U.esc(U.fillText(ui.controlsHint || 'Move with W A S D, drag the mouse to look around, press E to talk.')), 'info', 12000);
        }, 1200);
      }
      if (updateReady) setTimeout(function () { showUpdatePill(updateReady); }, 2500);
    });
  }

  // ------------------------------------------------------------------
  // ---- v1.2 WS5: desktop app bridge (window.wfNative from desktop/preload.js)
  //  wfNative = { isDesktop, version: { shell, game }, storage: {...},
  //    app: { bootOk(v), quit(), openExternal(url) },
  //    updates: { check() -> Promise<status>, status() -> status, onStatus(fn), restart() } }
  //  status = { state: 'disabled'|'idle'|'checking'|'downloading'|'ready'|'uptodate'|'shell'|'error',
  //             version, message, url }
  // ------------------------------------------------------------------
  var N = null, updateReady = null;
  try { N = window.wfNative || null; } catch (e) { N = null; }
  M.isDesktop = function () { return hasNative(); };

  function nativeInit() {
    if (!hasNative()) return;
    document.body.classList.add('is-desktop');
    try { if (N.app && N.app.bootOk) N.app.bootOk(M.VERSION); } catch (e) { /* old shell */ }
    try {
      if (N.updates && N.updates.onStatus) N.updates.onStatus(function (st) { onUpdateStatus(st, false); });
      var cur = N.updates && N.updates.status && N.updates.status();
      if (cur) onUpdateStatus(cur, false);
    } catch (e) { console.warn('update bridge', e); }
  }
  var announced = {};
  function onUpdateStatus(st, manual) {
    if (!st) return;
    if (st.state === 'ready' && st.version) {
      updateReady = st;
      // the update card says it; a toast as well only answers a manual "Check for updates"
      if (manual) WF.ui.toast('Update ready – restart to play v' + U.esc(st.version), 'quest', 6000);
      showUpdatePill(st);
    } else if (st.state === 'shell') {
      if (!announced['s' + st.version] || manual) {
        announced['s' + st.version] = true;
        WF.ui.toast('Wizzie Farm v' + U.esc(st.version || '') + ' needs a newer app. Use “Get the new app” to download it.', 'warn', 10000);
      }
      showUpdatePill(st);
    } else if (manual) {
      if (st.state === 'uptodate') WF.ui.toast('You have the newest version (v' + U.esc(st.current || M.VERSION) + ').', 'info');
      else if (st.state === 'disabled') WF.ui.toast(U.esc(st.message || 'Updates are not set up yet (no GitHub repository configured).'), 'info', 7000);
      else if (st.state === 'error') WF.ui.toast('Could not check for updates: ' + U.esc(st.message || 'offline?'), 'warn', 7000);
      else if (st.state === 'downloading' || st.state === 'checking') WF.ui.toast('Checking for updates…', 'info');
    }
  }
  function showUpdatePill(st) {
    var pill = el('ac-update');
    if (!pill) { pill = document.createElement('div'); pill.id = 'ac-update'; document.body.appendChild(pill); }
    if (st.state === 'shell') {
      pill.innerHTML = '<span>Wizzie Farm v' + U.esc(st.version || '') + ' needs a newer app</span><button class="btn sm primary" id="ac-upd-go">Get the new app</button><button class="ac-x" id="ac-upd-x" title="Later">✕</button>';
      el('ac-upd-go').onclick = function () { if (st.url && N.app && N.app.openExternal) N.app.openExternal(st.url); };
    } else {
      pill.innerHTML = '<span>Update ready – restart to play <b>v' + U.esc(st.version) + '</b></span><button class="btn sm primary" id="ac-upd-go">Restart now</button><button class="ac-x" id="ac-upd-x" title="Later (it installs next time you start the game)">✕</button>';
      el('ac-upd-go').onclick = function () { M.restartForUpdate(); };
    }
    el('ac-upd-x').onclick = function () { pill.classList.add('hidden'); };
    pill.classList.remove('hidden');
  }
  M.restartForUpdate = function () {
    if (!hasNative()) return;
    if (WF.world.mode === 'combat') { WF.ui.toast('Finish the duel first – the update will be ready after it.', 'warn'); return; }
    if (started) WF.state.save();
    started = false;
    N.updates.restart();
  };
  // menu / title "Check for updates"
  M.checkUpdates = function (manual) {
    if (!hasNative() || !N.updates || !N.updates.check) { if (manual) WF.ui.toast('Updates come with the Wizzie Farm desktop app.', 'info'); return Promise.resolve(null); }
    if (manual) WF.ui.toast('Checking for updates…', 'info', 2500);
    return Promise.resolve(N.updates.check()).then(function (st) { onUpdateStatus(st, manual); return st; }, function (e) { onUpdateStatus({ state: 'error', message: e && e.message }, manual); return null; });
  };
  M.appVersions = function () { return { game: M.VERSION, shell: hasNative() && N.version ? N.version.shell : null, desktop: hasNative() }; };

  // ------------------------------------------------------------------
  // Travel between zones (portals, defeat)
  // ------------------------------------------------------------------
  M.travel = async function (zoneId, arrive, defeated, firstLoad) {
    var W = WF.world;
    if (W.mode === 'loading') return;
    W.mode = 'loading';
    WF.ui.closeAll(true);
    WF.ui.prompt(null);
    try {
      if (!firstLoad) { WF.sfx.play('portal'); await WF.ui.fade(true); }
      else el('fade').classList.add('on');
      if (!D().zones[zoneId]) zoneId = WF.state.homeZone();
      var keepPose = firstLoad && !defeated && arrive && WF.state.player.pos && arrive === WF.state.player.pos;
      if (defeated || !arrive) arrive = D().zones[zoneId].spawn;
      W.loadZone(zoneId, keepPose ? null : arrive);     // null = use the saved position AND facing
      W.render();
      var ups = WF.state.onVisit(zoneId);
      WF.ui.showHUD(true);
      WF.ui.refresh();
      await WF.ui.fade(false);
      W.mode = 'explore';
      WF.ui.zoneBanner(W.zone);
      WF.sfx.music(W.zone.style);
      var zi = D().lore && D().lore.zoneIntros && D().lore.zoneIntros[zoneId];
      var p = WF.state.player;
      p.seenZones = p.seenZones || {};
      if (zi && !p.seenZones[zoneId]) { p.seenZones[zoneId] = true; setTimeout(function () { WF.ui.toast('<i>' + U.esc(zi) + '</i>', 'lore'); }, 1500); }
      ups.forEach(function (u) { WF.ui.toast('<b>' + U.esc(D().quests[u.qid].name) + '</b>: ' + U.esc(u.text), 'quest'); });
      if (ups.length) { WF.sfx.play('quest_accept'); W.refreshMarkers(); }
      if (WF.story) { try { WF.story.onZone(zoneId); } catch (e2) { console.error('story', e2); } }   // v2.0 WS-E: Spire flicker (R5), story triggers
      if (p.deckDepthNews) {   // v2.1 A5: once, for a wizard whose decks were just tripled
        delete p.deckDepthNews;
        setTimeout(function () { WF.ui.toast('<b>Decks changed in v2.1:</b> spent cards no longer come back during a duel. Every deck now holds 3x the cards (yours were tripled), so plan for long fights. When your deck runs dry, you can only Pass or Flee.', 'quest', 9000); }, 2500);
      }
      WF.state.save();
    } catch (e) {
      console.error('Travel failed', e);
      el('fade').classList.remove('on');
      W.mode = 'explore';
      throw e;
    }
  };

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  function loop(ts) {
    requestAnimationFrame(loop);
    var raw = ts - last;
    var dt = Math.min(0.05, raw / 1000 || 0.016);
    last = ts;
    var W = WF.world;
    if (W.mode === 'title' && Stage.active) {
      // v1.2 WS5: choose-your-wizard / create screens draw their own stage
      Stage.update(dt);
      WF.ui.update(dt);
      Stage.render();
      return;
    }
    if (W.mode === 'title') {
      // slow cinematic orbit around the Lumen Spire
      titleT += dt;
      W.time += dt;
      var r = 34, a = titleT * 0.05;
      W.camera.position.set(Math.sin(a) * r, 12 + Math.sin(titleT * 0.2) * 2, Math.cos(a) * r);
      W.camera.lookAt(0, 6, 0);
      W.npcs.forEach(function (n) { if (n.mesh.userData.anim) n.mesh.userData.anim(W.time + n.x, 'idle', dt); });
      W.portals.forEach(function (p) { if (p.mesh.userData.anim) p.mesh.userData.anim(W.time); });
      W.fx.forEach(function (f) { if (f.userData.update) f.userData.update(dt); });
    } else {
      W.update(dt);
      feedProbe(raw, dt);
      WF.combatView.update(dt);
      if (started && WF.state.player) {
        WF.state.player.stats.playTime = (WF.state.player.stats.playTime || 0) + dt;
        saveTimer += dt;
        if (saveTimer > 30 && W.mode === 'explore') {
          saveTimer = 0;
          // v1.2 WS5: say so (once) when the save could not be written
          if (!WF.state.save() && !WF.state.locked && !saveWarned) { saveWarned = true; WF.ui.toast('Your progress could not be saved (storage blocked or full). Use Menu → Export to keep a copy.', 'warn', 10000); }
        }
      }
    }
    WF.ui.update(dt);
    W.render();
  }

  window.addEventListener('beforeunload', function () { if (started && WF.world.mode !== 'combat') WF.state.save(); });

  M.VERSION = '2.1.0';
  return M;
})();

// ---------------------------------------------------------------------
// Debug / testing helpers (open the browser console with F12 and type e.g.
//   WF.debug.level(5)   WF.debug.gold(500)   WF.debug.goto('whisperwood')
// ---------------------------------------------------------------------
WF.debug = (function () {
  'use strict';
  var Dg = {};
  Dg.level = function (n) {
    var S = WF.state, p = S.player;
    while (p.level < Math.min(n, WF.data.progression.maxLevel)) S.addXP(S.xpNeeded() - p.xp);
    WF.ui.refresh(); return p.level;
  };
  Dg.xp = function (n) { var u = WF.state.addXP(n); u.forEach(WF.ui.levelUp); WF.ui.refresh(); };
  Dg.gold = function (n) { WF.state.addGold(n); WF.ui.refresh(); };
  Dg.heal = function () { var s = WF.state.stats(); WF.state.player.hp = s.maxHp; WF.state.player.mana = s.maxMana; WF.ui.refresh(); };
  Dg.goto = function (zone, pos) { return WF.main.travel(zone, pos || null); };
  Dg.tp = function (x, z) { WF.world.player.x = x; WF.world.player.z = z; };
  Dg.item = function (id, n) { WF.state.addItem(id, n || 1); WF.ui.refresh(); };
  Dg.complete = function (qid) {
    var S = WF.state, p = S.player;
    if (!p.quests.active[qid]) S.accept(qid);
    delete p.quests.active[qid]; p.quests.done[qid] = true;
    WF.world.refreshMarkers(); WF.world.refreshPortals(); WF.ui.refresh();
  };
  // Start a duel with the nearest enemy camp
  Dg.fight = function (idx) {
    var W = WF.world, g = idx != null ? W.groups[idx] : null;
    if (!g) {
      var best = 1e9;
      W.groups.forEach(function (gg) { var d = Math.hypot(gg.x - W.player.x, gg.z - W.player.z); if (gg.state === 'alive' && d < best) { best = d; g = gg; } });
    }
    if (g) { W.player.x = g.x + 3; W.player.z = g.z + 3; WF.combatView.start(g); }
    return !!g;
  };
  return Dg;
})();

// Scripts are at the end of <body>, so the DOM is ready; don't wait for web fonts.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { WF.main.boot(); });
else WF.main.boot();
