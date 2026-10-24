// =====================================================================
//  WIZZIE FARM — THE SPELLWRIGHT'S BENCH  (v2.0 M1 "Schools", WS-A)
//
//  Contract: docs/V2.0-CONTRACT.md §2 + §9. Numbers and paths live in
//  game/data/runeglass.js; the rules (costs, path lock, reset refund) are in
//  game/js/state.js (canUpgradeSpell / upgradeSpell / resetSpell); combat.js
//  applies a rank with Battle.rankCard. This file is only the panel.
//
//  Opened from the Spellwright's dialogue ("Upgrade Spells", ui.js). Draws
//  into the dialogue box, like the trainer's screen, so the world stays in
//  'dialog' mode and Esc / Goodbye close it the usual way.
//    WF.spellwright.open(npcId)
//    WF.spellwright.rowsFor()   pure-ish view model (tests, debugging)
// =====================================================================
(function () {
  'use strict';
  var D = function () { return WF.data; }, S = function () { return WF.state; };
  var R = function () { return WF.data.runeglass; };
  function el(id) { return document.getElementById(id); }
  function esc(t) { return WF.util && WF.util.esc ? WF.util.esc(t) : String(t == null ? '' : t); }
  function h(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  var STYLE = [
    '.sw-list{max-height:min(52vh,430px);overflow-y:auto;margin:8px 0 4px;padding-right:4px;display:flex;flex-direction:column;gap:8px}',
    '.sw-row{display:flex;gap:12px;align-items:center;background:#1d1838;color:#f4efff;border:1px solid rgba(159,230,255,.28);border-radius:10px;padding:6px 10px}',   /* v2.0 QA M2: opaque, readable on the cream dialog */
    '.sw-row .card{flex:none;color:#fff}',
    '.sw-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}',
    '.sw-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
    '.sw-name{font-weight:800;font-size:15px;text-shadow:0 1px 2px #000}',
    '.sw-rank{letter-spacing:2px;color:#9fe6ff;font-size:13px}',
    '.sw-rank i{font-style:normal;opacity:.35}',
    '.sw-now{font-size:13px;color:#e4f3ff}',
    '.sw-paths{display:flex;gap:8px;flex-wrap:wrap}',
    '.sw-path{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-width:170px;max-width:260px;padding:6px 10px;border-radius:8px;',
    'border:1px solid var(--pc,#9fe6ff);background:rgba(0,0,0,.25);color:#fff;cursor:pointer;font:inherit}',
    '.sw-path b{color:var(--pc,#9fe6ff);font-size:13px}',
    '.sw-path small{font-size:12px;line-height:1.3;color:#eef4ff}',
    '.sw-path:disabled{cursor:not-allowed;opacity:.45}',
    '.sw-path.locked{opacity:.3}',
    '.sw-path.on{box-shadow:0 0 0 2px var(--pc,#9fe6ff) inset}',
    '.sw-path:not(:disabled):hover{background:rgba(159,230,255,.12)}',
    '.sw-reset{align-self:flex-start;font-size:11px;padding:2px 8px}',
    '.sw-glass{color:#9fe6ff;font-weight:800;background:#1d1838;padding:1px 8px;border-radius:8px}',
    '.sw-empty{padding:14px;opacity:.8}'
  ].join('');
  function ensureStyle() {
    if (el('sw-style')) return;
    var st = document.createElement('style'); st.id = 'sw-style'; st.textContent = STYLE; document.head.appendChild(st);
  }

  // One row per spell the Spellwright can work on.
  function rowsFor() {
    var rg = R(), st = S(), p = st && st.player;
    if (!rg || !p) return [];
    return st.upgradeableSpells().map(function (id) {
      var card = D().cards[id], cur = st.spellRank(id);
      var paths = ['a', 'b'].map(function (path) {
        var def = rg.pathFor(card, path, p.school) || {}, chk = st.canUpgradeSpell(id, path);
        return {
          path: path, name: def.name || path.toUpperCase(), color: def.color || '#9fe6ff',
          on: cur.path === path, locked: !!(cur.path && cur.path !== path),
          now: cur.path === path ? rg.describe(card, path, cur.rank, p.school) : '',
          next: cur.rank < rg.maxRank ? rg.describe(card, path, cur.rank + 1, p.school) : '',
          cost: chk.cost != null ? chk.cost : rg.stepCost(cur.rank + 1), ok: chk.ok, reason: chk.reason || ''
        };
      });
      return { id: id, card: card, rank: cur.rank, path: cur.path, max: rg.maxRank, paths: paths, reset: cur.rank > 1 ? st.resetCost(id) : null };
    });
  }

  function rankHTML(n, max) {
    var s = '';
    for (var i = 1; i <= max; i++) s += i <= n ? '◆' : '<i>◇</i>';
    return s;
  }

  function open(npcId) {
    ensureStyle();
    var npc = D().npcs[npcId] || { name: 'Spellwright' }, box = el('dialog');
    if (!box) return;
    if (WF.world && WF.world.mode !== 'dialog') WF.world.mode = 'dialog';
    box.classList.add('show');
    var keepScroll = 0;
    function render(msg) {
      var p = S().player, rows = rowsFor();
      var old = box.querySelector('.sw-list'); if (old) keepScroll = old.scrollTop;
      box.innerHTML = '<div class="dlg-head"><span class="dlg-name">' + esc(npc.name) + '</span>' + (npc.title ? '<span class="dlg-title">' + esc(npc.title) + '</span>' : '') +
        '<span class="dlg-quest"><span class="sw-glass">◈ ' + (p.runeglass || 0) + '</span> Runeglass</span></div>' +
        '<div class="dlg-text">' + esc(msg || 'Pick a spell and a path. A spell keeps the path you choose all the way to rank ' + R().maxRank + '. A reset gives back every shard, for a little gold.') + '</div>' +
        '<div class="sw-list"></div><div class="dlg-buttons"></div>';
      var list = box.querySelector('.sw-list');
      if (!rows.length) list.appendChild(h('div', 'sw-empty', 'You have no spells I can work on yet. Learn your school\'s spells from your trainer first.'));
      rows.forEach(function (r) {
        var row = h('div', 'sw-row');
        row.setAttribute('data-card', r.id);
        row.appendChild(WF.ui.cardEl(r.id, { small: true }));
        var info = h('div', 'sw-info');
        var cur = r.paths.filter(function (x) { return x.on; })[0];
        info.appendChild(h('div', 'sw-top', '<span class="sw-name" style="color:' + ((D().schools[r.card.school] || {}).color || '#fff') + '">' + esc(r.card.name) + '</span>' +
          '<span class="sw-rank" title="Rank ' + r.rank + ' of ' + r.max + '">' + rankHTML(r.rank, r.max) + '</span>' +
          (cur ? '<span class="sw-now">' + esc(cur.now) + '</span>' : '<span class="sw-now dim">Rank 1 (as trained)</span>')));
        var pathsBox = h('div', 'sw-paths');
        r.paths.forEach(function (pa) {
          var b = h('button', 'sw-path' + (pa.on ? ' on' : '') + (pa.locked ? ' locked' : ''));
          b.style.setProperty('--pc', pa.color);
          b.setAttribute('data-path', pa.path);
          var label = r.rank >= r.max && pa.on ? 'Rank ' + r.max + ' (complete)' : (pa.locked ? 'Locked' : (pa.on ? 'Rank ' + (r.rank + 1) : 'Start') + ': ◈ ' + pa.cost);
          b.innerHTML = '<b>' + esc(pa.path.toUpperCase() + ' · ' + pa.name) + '</b><small>' + esc(pa.next || pa.now) + '</small><small class="sw-glass">' + esc(label) + '</small>';
          b.disabled = !pa.ok;
          b.title = pa.ok ? 'Upgrade to rank ' + (r.rank + 1) + ' for ' + pa.cost + ' Runeglass' : pa.reason;
          b.onclick = function () {
            if (!S().upgradeSpell(r.id, pa.path)) return;
            if (WF.sfx) WF.sfx.play('levelup');
            var rk = S().spellRank(r.id).rank;
            if (WF.ui && WF.ui.toast) WF.ui.toast('<b>' + esc(r.card.name) + '</b> is now rank ' + rk + ' (' + esc(pa.name) + ').', 'quest');
            if (WF.world && WF.world.refreshMarkers) WF.world.refreshMarkers();
            if (WF.ui && WF.ui.refresh) WF.ui.refresh();
            render(rk >= r.max ? 'Rank ' + r.max + '. That spell is as bright as glass can make it.' : 'There. It rings truer already.');
          };
          pathsBox.appendChild(b);
        });
        info.appendChild(pathsBox);
        if (r.reset) {
          var rs = h('button', 'btn sm sw-reset', 'Reset to rank 1 (' + r.reset.gold + ' gold, ◈ ' + r.reset.refund + ' back)');
          var ok = S().canResetSpell(r.id);
          rs.disabled = !ok.ok; rs.title = ok.reason || 'Grind the glass back out: every Runeglass is returned, and you can pick the other path';
          rs.onclick = function () {
            if (!S().resetSpell(r.id)) return;
            if (WF.sfx) WF.sfx.play('click');
            if (WF.ui && WF.ui.refresh) WF.ui.refresh();
            render('Ground clean. The shards are yours again. Choose its path anew.');
          };
          info.appendChild(rs);
        }
        row.appendChild(info);
        list.appendChild(row);
      });
      list.scrollTop = keepScroll;
      var done = h('button', 'btn primary', 'Done');
      done.onclick = function () { WF.ui.closeDialog(); };
      box.querySelector('.dlg-buttons').appendChild(done);
    }
    render();
  }

  WF.spellwright = { open: open, rowsFor: rowsFor };
})();
