// =====================================================================
//  WIZZIE FARM — LOOK EDITOR (v2.1 WS-D: W101-style character creation)
//
//  One picker panel for a wizard's look (p.look = { body, face, eyes, nose, mouth, hair, hairColor,
//  skin, eyeColor }); options and labels come from game/data/characters.js. Used by:
//   * main.js showCreate: the "Your look" step of Create your Wizard (live 3D preview on the stage)
//   * the in-game Mirror (Menu -> "Change your look"): every v2.0 wizard moved to the new look with
//     the default face, so they can restyle any time. The camera swings to the front while it is open.
//
//  WF.lookEditor.render(container, look, onChange) -> { get(), set(look) }
//  WF.lookEditor.random(body) -> a random look      WF.lookEditor.normal(look) -> a complete, valid look
//  WF.lookEditor.openMirror()
// =====================================================================
window.WF = window.WF || { data: {} };

WF.lookEditor = (function () {
  'use strict';
  var LE = {};
  function CH() { return (WF.data && WF.data.characters) || { bodies: {}, defaults: {} }; }
  function esc(s) { return WF.util && WF.util.esc ? WF.util.esc(s) : String(s); }
  var ROWS = [
    { k: 'face', list: 'faces', label: 'Face' },
    { k: 'eyes', list: 'eyes', label: 'Eyes' },
    { k: 'eyeColor', list: 'eyeColors', label: 'Eye colour', swatch: true },
    { k: 'nose', list: 'noses', label: 'Nose' },
    { k: 'mouth', list: 'mouths', label: 'Mouth' },
    { k: 'hair', list: 'hairs', label: 'Hair' },
    { k: 'hairColor', list: 'hairColors', label: 'Hair colour', swatch: true },
    { k: 'skin', list: 'skins', label: 'Skin', swatch: true }
  ];
  var STYLE = [
    '.le{display:flex;flex-direction:column;gap:7px;font-size:14px}',
    '.le-bodies{display:flex;gap:8px}',
    '.le-body{flex:1;padding:7px 8px;border-radius:9px;border:2px solid rgba(255,231,168,.35);background:rgba(20,14,40,.6);color:#fff;cursor:pointer;text-align:left}',
    '.le-body.on{border-color:#ffd76a;box-shadow:0 0 10px rgba(255,215,106,.45)}',
    '.le-body b{display:block;font-size:15px}.le-body small{opacity:.8}',
    '.le-row{display:flex;align-items:center;gap:8px}',
    '.le-row>span{width:92px;flex:none;color:#ffe7a8}',
    '.le-step{display:flex;align-items:center;gap:6px;flex:1}',
    '.le-step button{width:30px;height:28px;border-radius:7px;border:1px solid #c9a24a;background:rgba(30,20,50,.85);color:#ffe9a8;cursor:pointer;font-size:14px}',
    '.le-step b{flex:1;text-align:center;font-weight:700}',
    '.le-sw{display:flex;flex-wrap:wrap;gap:5px;flex:1}',
    '.le-sw button{width:24px;height:24px;border-radius:50%;border:2px solid rgba(255,255,255,.35);cursor:pointer;padding:0}',
    '.le-sw button.on{border-color:#ffd76a;box-shadow:0 0 0 2px #ffd76a}',
    '.le-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}',
    '#le-mirror{position:fixed;right:18px;top:70px;width:340px;z-index:40;padding:12px 14px;border-radius:12px;background:linear-gradient(180deg,#241a4e,#120e26);border:2px solid #c9a24a;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.6)}',
    '#le-mirror h3{margin:0 0 8px;font:800 17px var(--display,Georgia,serif);color:#ffd76a}'
  ].join('');
  function ensureStyle() {
    if (document.getElementById('le-style')) return;
    var st = document.createElement('style'); st.id = 'le-style'; st.textContent = STYLE; document.head.appendChild(st);
  }
  function hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null; }

  // a complete, valid look (unknown fields dropped, indexes clamped to the lists)
  LE.normal = function (look) {
    var C = CH(), d = C.defaults || {}, o = {}, L = look || {};
    o.body = C.bodies && (L.body === 'a' || L.body === 'b') ? L.body : (d.body || 'a');
    ['face', 'eyes', 'nose', 'mouth', 'hair'].forEach(function (k) {
      var list = C[{ face: 'faces', eyes: 'eyes', nose: 'noses', mouth: 'mouths', hair: 'hairs' }[k]] || [];
      var n = Math.floor(+L[k]);
      o[k] = isFinite(n) && n >= 0 && n < list.length ? n : (d[k] || 0);
    });
    o.hairColor = hex(L.hairColor) || d.hairColor || '#4a2f1c';
    o.skin = hex(L.skin) || d.skin || '#f2c9a0';
    o.eyeColor = hex(L.eyeColor) || d.eyeColor || '#5a3a22';
    return o;
  };
  LE.random = function (body, rnd) {
    var C = CH(), r = rnd || Math.random, pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var idx = function (a) { return Math.floor(r() * (a || [0]).length); };
    return LE.normal({ body: body || (r() < 0.5 ? 'a' : 'b'), face: idx(C.faces), eyes: idx(C.eyes), nose: idx(C.noses), mouth: idx(C.mouths),
      hair: idx(C.hairs), hairColor: pick(C.hairColors || ['#4a2f1c']), skin: pick(C.skins || ['#f2c9a0']), eyeColor: pick(C.eyeColors || ['#5a3a22']) });
  };
  // when the body changes, its default eyes/face come along unless the player already chose
  function bodyDefaults(look, body, touched) {
    var B = (CH().bodies || {})[body] || {};
    look.body = body;
    if (!touched.eyes && B.eyes != null) look.eyes = B.eyes;
    if (!touched.face && B.face != null) look.face = B.face;
    if (!touched.hair && B.hair != null) look.hair = B.hair;
  }

  LE.render = function (box, look0, onChange) {
    ensureStyle();
    var C = CH(), look = LE.normal(look0), touched = {};
    function changed() { if (onChange) onChange(LE.normal(look)); }
    function focusKey() {
      var f = document.activeElement;
      if (!f || !box.contains(f) || !f.getAttribute) return null;
      return focusKeyOf(f);
    }
    function draw() {
      var fk = focusKey();
      var h = '<div class="le"><div class="le-bodies">';
      ['a', 'b'].forEach(function (id) {
        var B = (C.bodies || {})[id] || {};
        h += '<button class="le-body' + (look.body === id ? ' on' : '') + '" data-body="' + id + '"><b>' + esc(B.label || id) + '</b><small>' + esc(B.desc || '') + '</small></button>';
      });
      h += '</div>';
      ROWS.forEach(function (R) {
        var list = C[R.list] || [];
        h += '<div class="le-row"><span>' + esc(R.label) + '</span>';
        if (R.swatch) {
          h += '<div class="le-sw">' + list.map(function (c) { return '<button data-k="' + R.k + '" data-v="' + c + '" class="' + (look[R.k] === c ? 'on' : '') + '" style="background:' + c + '" title="' + c + '" aria-label="' + esc(R.label + ' ' + c) + '"></button>'; }).join('') + '</div>';
        } else {
          var it = list[look[R.k]] || list[0] || {};
          h += '<div class="le-step"><button data-k="' + R.k + '" data-d="-1" aria-label="Previous ' + esc(R.label) + '">◀</button><b>' + esc(it.label || it.id || look[R.k]) + '</b><button data-k="' + R.k + '" data-d="1" aria-label="Next ' + esc(R.label) + '">▶</button></div>';
        }
        h += '</div>';
      });
      h += '<div class="le-foot"><button class="btn" data-rand="1">Surprise me</button></div></div>';
      box.innerHTML = h;
      box.querySelectorAll('[data-body]').forEach(function (b) { b.onclick = function () { bodyDefaults(look, b.getAttribute('data-body'), touched); draw(); changed(); }; });
      box.querySelectorAll('[data-d]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-k'), R = ROWS.filter(function (x) { return x.k === k; })[0], n = (C[R.list] || []).length || 1;
          look[k] = ((look[k] || 0) + (+b.getAttribute('data-d')) + n) % n; touched[k] = true;
          if (WF.sfx) WF.sfx.play('click');
          draw(); changed();
        };
      });
      box.querySelectorAll('.le-sw button').forEach(function (b) { b.onclick = function () { look[b.getAttribute('data-k')] = b.getAttribute('data-v'); if (WF.sfx) WF.sfx.play('click'); draw(); changed(); }; });
      var rb = box.querySelector('[data-rand]');
      if (rb) rb.onclick = function () { look = LE.random(look.body); touched = { eyes: true, face: true, hair: true }; draw(); changed(); };
      // keep keyboard focus on the same control after a redraw (stepping ▶ ▶ ▶ with Enter/Space)
      if (fk) { var all = box.querySelectorAll('button'); for (var i = 0; i < all.length; i++) if (focusKeyOf(all[i]) === fk) { try { all[i].focus(); } catch (e) { /* headless */ } break; } }
    }
    function focusKeyOf(f) { return ['data-body', 'data-d', 'data-v', 'data-rand'].map(function (a) { return f.getAttribute(a) == null ? '' : a + '=' + f.getAttribute(a); }).join('|') + '|' + (f.getAttribute('data-k') || ''); }
    draw();
    return { get: function () { return LE.normal(look); }, set: function (l) { look = LE.normal(l); draw(); } };
  };

  // ---- in-game Mirror: Menu -> "Change your look" ----
  var mirror = null;
  LE.openMirror = function () {
    var S = WF.state, W = WF.world, p = S && S.player;
    if (mirror) { focusIn(mirror.box); return; }           // one Mirror at a time
    if (!p || !W || W.mode !== 'explore' && W.mode !== 'menu') return;
    if (WF.ui && WF.ui.closeAll) WF.ui.closeAll(true);
    ensureStyle();
    var box = document.createElement('div'); box.id = 'le-mirror';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Change your look');
    box.innerHTML = '<h3>The Mirror of Lanternmere</h3><div id="le-mirror-body"></div><div class="le-foot"><button class="btn" id="le-cancel">Cancel</button><button class="btn primary" id="le-ok">Keep this look</button></div>';
    document.body.appendChild(box);
    var before = JSON.parse(JSON.stringify(p.look || {})), yaw = W.cam.yaw, dist = W.cam.targetDist, pitch = W.cam.pitch;
    W.mode = 'dialog';
    W.cam.yaw = W.player ? W.player.rot + 0.35 : yaw;     // look at the wizard's face, a little from the side
    W.cam.targetDist = 4.2; W.cam.pitch = 0.18;
    // the preview is drawn from the picked look, but p.look keeps the saved one until "Keep this look"
    // (an autosave while the Mirror is open never stores a look you did not keep)
    function preview(l) { p.look = l; W.rebuildPlayer(); p.look = before; }
    var ed = LE.render(box.querySelector('#le-mirror-body'), p.look, preview);
    function close(keep) {
      if (!mirror) return;
      if (keep) { p.look = ed.get(); S.migrateLook(p); S.save(); if (WF.ui) WF.ui.toast('Looking sharp, ' + esc(p.name) + '!', 'quest'); }
      else p.look = before;
      W.rebuildPlayer();
      box.remove(); mirror = null; W.cam.yaw = yaw; W.cam.targetDist = dist; W.cam.pitch = pitch;
      if (W.mode === 'dialog') W.mode = 'explore';           // never pull a duel (or anything else) back to explore
    }
    mirror = { box: box, close: close };
    box.querySelector('#le-ok').onclick = function () { close(true); };
    box.querySelector('#le-cancel').onclick = function () { close(false); };
    focusIn(box);
  };
  function focusIn(box) { var b = box && box.querySelector('#le-ok'); if (b && b.focus) try { b.focus(); } catch (e) { /* headless */ } }
  // the game's key handler (ui.js) hands every key to the Mirror while it is open: Escape cancels,
  // Space/Enter act on the focused Mirror button, nothing reaches the hidden NPC dialog
  LE.mirrorKey = function (e) {
    if (!mirror) return false;
    if (e.code === 'Escape') { if (e.preventDefault) e.preventDefault(); mirror.close(false); }
    return true;
  };
  LE.closeMirror = function (keep) { if (mirror) mirror.close(!!keep); };
  LE.mirrorOpen = function () { return !!mirror; };

  // adds "Change your look" to the game menu (no edit of ui.js: wraps UI.toggle like petsUI does)
  LE.install = function () {
    var UI = WF.ui;
    if (LE.installed || !UI || !UI.toggle) return;
    LE.installed = true;
    var toggle = UI.toggle;
    UI.toggle = function (name) {
      var r = toggle.apply(this, arguments);
      try {
        if (name === 'menu') {
          var row = document.querySelector('#mn-resume') && document.querySelector('#mn-resume').parentNode;
          if (row && !document.getElementById('mn-look')) {
            var b = document.createElement('button'); b.className = 'btn'; b.id = 'mn-look'; b.textContent = 'Change your look';
            b.title = 'The Mirror: build, face, eyes, hair, colours';
            b.onclick = function () { LE.openMirror(); };
            row.appendChild(b);
          }
        }
      } catch (e) { if (window.console) console.warn(e); }
      return r;
    };
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(LE.install, 0); });
    else setTimeout(LE.install, 0);
  }
  return LE;
})();
