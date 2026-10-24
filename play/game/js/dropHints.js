// =====================================================================
//  WIZZIE FARM — DROP HINTS at the dungeon entrance (v2.1)
//
//  Jorge (Oct 20, docs/V2.1-BACKLOG.md §B 4): "each dungeon boss drops
//  specific gear slots ... and the game shows it, so a player farming boots
//  knows which boss to fight". The boss nameplate tooltip in duels shows it
//  too (combatView.js plateHTML); this file adds the dungeon-entrance view:
//  an NPC with `dropHints: '<dungeonId>'` (npcs.js: the Orrery keeper) gets a
//  "What do the guardians carry?" button that lists, for YOUR school, each
//  room boss's slots by tier with the per-kill chance.
//  Data: WF.state.bossDropHints (state.js, read from the loot tables), the
//  dungeon's rooms (dungeons.js), copy in lore.js dungeonLines.<id>.dropHints.
//  Like petsUI.js it wraps WF.ui.talkTo (no edit of ui.js); every hook is
//  wrapped in try/catch so a problem here never breaks a conversation.
//  WF.dropHints.panelHTML(dungeonId, school) is pure (tests/drop-hints.test.js).
// =====================================================================
window.WF = window.WF || {};
WF.dropHints = (function () {
  'use strict';
  var DH = {};
  function D() { return WF.data; }
  function esc(s) { return WF.util && WF.util.esc ? WF.util.esc(String(s)) : String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function copy(dungeonId) { return (((D().lore || {}).dungeonLines || {})[dungeonId] || {}).dropHints || {}; }
  // tier colours dark enough for the parchment dialogue box (T1 amber, T2 sky, T3 violet)
  var TIER_COLOR = { 1: '#8a5a00', 2: '#1d6a94', 3: '#7a32b0' };
  function pctText(p) { var x = p * 100; return (x >= 10 ? Math.round(x) : x >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100) + '%'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // The room bosses of a dungeon, in path order -> [{ enemyId, name, room, hints }]
  DH.bosses = function (dungeonId, school) {
    var dg = (D().dungeons || {})[dungeonId], S = WF.state;
    if (!dg || !S || !S.bossDropHints) return [];
    return (dg.rooms || []).filter(function (r) { return r.boss && D().enemies[r.boss]; }).map(function (r) {
      return { enemyId: r.boss, name: D().enemies[r.boss].name, room: r.name, final: !!r.final, hints: S.bossDropHints(r.boss, school) };
    });
  };

  // The panel (HTML string): for each boss, one row per slot with its tiers and per-kill chances
  DH.panelHTML = function (dungeonId, school) {
    school = school || (WF.state && WF.state.player && WF.state.player.school);
    var c = copy(dungeonId), sc = (D().schools || {})[school] || {}, out = [];
    out.push('<div class="dh-panel">');
    out.push('<div class="dlg-text dh-intro">' + esc(String(c.intro || 'Here is what each guardian carries for a {school}:').replace('{school}', sc.name || school || 'wizard')) + '</div>');
    DH.bosses(dungeonId, school).forEach(function (b) {
      var bySlot = {}, order = [];
      b.hints.forEach(function (h) { if (!bySlot[h.slot]) { bySlot[h.slot] = []; order.push(h.slot); } bySlot[h.slot].push(h); });
      out.push('<div class="dh-boss" data-enemy="' + esc(b.enemyId) + '"><div class="dh-bname">' + esc(b.name) + ' <small>' + esc(b.room) + '</small></div>');
      if (!order.length) out.push('<div class="dh-row"><span class="dh-slot">-</span></div>');
      order.forEach(function (sl) {
        var list = bySlot[sl];
        out.push('<div class="dh-row" data-slot="' + esc(sl) + '"><span class="dh-slot">' + esc(cap(sl)) + '</span><span class="dh-item">' + esc(list[0].name) + '</span><span class="dh-tiers">' +
          list.map(function (h) {
            return '<span class="dh-tier" style="--c:' + (TIER_COLOR[h.tier] || '#ffd76a') + '" title="' + esc(h.name + ': about ' + pctText(h.chance) + ' per kill') + '">' + (h.tiered ? 'T' + h.tier + ' ' : '') + pctText(h.chance) + '</span>';
          }).join('') + '</span></div>');
      });
      out.push('</div>');
    });
    if (c.tiers) out.push('<div class="dh-foot">' + esc(c.tiers) + '</div>');
    out.push('</div>');
    return out.join('');
  };

  var CSS = [
    '#dialog .dh-panel{margin:4px 0 6px}',
    '#dialog .dh-intro{margin-bottom:8px}',
    '#dialog .dh-boss{background:rgba(90,47,0,.06);border:1px solid rgba(168,120,46,.45);border-radius:8px;padding:6px 10px;margin:6px 0}',
    '#dialog .dh-bname{font-family:var(--display);font-weight:800;font-size:1.02em;color:#5a2f00;margin-bottom:3px}',
    '#dialog .dh-bname small{font-family:inherit;font-style:italic;font-weight:400;font-size:.8em;color:#8a6430;margin-left:6px}',
    '#dialog .dh-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0}',
    '#dialog .dh-slot{min-width:58px;font-weight:700}',
    '#dialog .dh-item{flex:1 1 160px;opacity:.9}',
    '#dialog .dh-tiers{display:flex;gap:5px}',
    '#dialog .dh-tier{border:1px solid var(--c);color:var(--c);background:#fffaf0;border-radius:10px;padding:0 7px;font-size:.85em;font-weight:700;white-space:nowrap;cursor:help}',
    '#dialog .dh-foot{font-size:.85em;color:#6e4c1f;margin-top:6px}'
  ].join('\n');
  function ensureCss() {
    if (document.getElementById('dh-style')) return;
    var st = document.createElement('style'); st.id = 'dh-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  // Show the panel inside the open dialogue box (Back = the greeting again)
  DH.open = function (npcId) {
    var npc = D().npcs[npcId], box = document.getElementById('dialog'), UI = WF.ui;
    if (!npc || !box || !npc.dropHints) return false;
    ensureCss();
    var c = copy(npc.dropHints);
    box.innerHTML = '<div class="dlg-head"><span class="dlg-name">' + esc(npc.name) + '</span>' + (npc.title ? '<span class="dlg-title">' + esc(npc.title) + '</span>' : '') +
      '<span class="dlg-quest">' + esc(((D().dungeons || {})[npc.dropHints] || {}).name || '') + '</span></div>' +
      DH.panelHTML(npc.dropHints) + '<div class="dlg-buttons"></div><div class="dlg-keys">Esc: close</div>';
    var bb = box.querySelector('.dlg-buttons');
    var back = document.createElement('button'); back.className = 'btn primary dh-back'; back.textContent = c.back || 'Back';
    back.onclick = function () { try { if (WF.sfx) WF.sfx.play('click'); } catch (e) { /* silent */ } UI.talkTo(npcId); };
    var bye = document.createElement('button'); bye.className = 'btn'; bye.textContent = 'Goodbye';
    bye.onclick = function () { UI.closeDialog(); };
    bb.appendChild(back); bb.appendChild(bye);
    return true;
  };

  // The button goes on the LAST page of the conversation (ui.js pages() rebuilds the box on "Next", and
  // a greeting can have a story aside as a second page), before "Goodbye".
  function ensureButton() {
    var UI = WF.ui, npcId = UI && UI.dialogNpc ? UI.dialogNpc() : null, npc = npcId && D().npcs[npcId];
    if (!npc || !npc.dropHints || WF.world.mode !== 'dialog') return;
    var box = document.getElementById('dialog'), bb = box && box.querySelector('.dlg-buttons');
    if (!bb || box.querySelector('.dh-panel') || bb.querySelector('.dh-btn') || bb.querySelector('.btn-ghost')) return;   // .btn-ghost = "Skip": not the last page yet
    var b = document.createElement('button'); b.className = 'btn dh-btn';
    b.textContent = copy(npc.dropHints).button || 'What drops here?';
    b.onclick = function () { try { if (WF.sfx) WF.sfx.play('open'); } catch (e) { /* silent */ } DH.open(npcId); };
    bb.insertBefore(b, bb.lastChild);         // before "Goodbye"
  }
  DH.install = function () {
    if (DH.installed || !WF.ui || !WF.ui.talkTo) return;
    DH.installed = true;
    var UI = WF.ui, talk = UI.talkTo;
    UI.talkTo = function () {
      var r = talk.apply(this, arguments);
      try { ensureButton(); } catch (e) { console.warn('[dropHints]', e); }
      return r;
    };
    var box = document.getElementById('dialog');
    if (box && typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () { try { ensureButton(); } catch (e) { console.warn('[dropHints]', e); } }).observe(box, { childList: true });
    }
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { try { DH.install(); } catch (e) { console.warn(e); } });
    else setTimeout(function () { try { DH.install(); } catch (e) { console.warn(e); } }, 0);
  }
  return DH;
})();
