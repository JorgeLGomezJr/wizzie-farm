// =====================================================================
//  WIZZIE FARM — USER INTERFACE
//  HUD, NPC dialogue, trainers, quest log, spellbook (deck editor),
//  backpack, shops & crafting, menus, toasts, floating combat text,
//  level-up / results / ending screens.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.ui = (function () {
  'use strict';
  var U = WF.util, D = function () { return WF.data; }, S = function () { return WF.state; };
  var UI = {};
  var floats = [];
  var openPanel = null;          // id of open side panel
  var dialogNpc = null;
  var overlayQueue = [], overlayShowing = false;   // level-ups and the chapter ending

  function el(id) { return document.getElementById(id); }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function schoolColor(s) { var sc = D().schools[s]; return sc ? sc.color : '#ccc'; }
  function itemName(id) { var it = D().items[id]; return it ? it.name : id; }
  function lore() { return D().lore || {}; }
  function uiText(key, fallback) { var t = (lore().ui || {})[key]; return U.fillText(t || fallback); }
  function overlayOpen() { return el('levelup').classList.contains('show'); }

  // ------------------------------------------------------------------
  // Cards
  // ------------------------------------------------------------------
  var TYPE_GLYPH = { damage: '✹', aoe: '❂', dot: '♨', heal: '✚', hot: '❁', blade: '⚔', trap: '⬡', shield: '⛨', weakness: '▼', absorb: '◎' };
  var TYPE_NAME = { damage: 'Attack', aoe: 'Area Attack', dot: 'Burn', heal: 'Heal', hot: 'Heal over Time', blade: 'Blade', trap: 'Trap', shield: 'Shield', weakness: 'Weakness', absorb: 'Absorb' };

  UI.cardDesc = function (c) {
    var sch = function (a) { return a === 'any' ? 'any' : (D().schools[a] ? D().schools[a].name : a); };
    switch (c.type) {
      case 'damage': return 'Deal <b>' + c.min + '–' + c.max + '</b> damage' + (c.drain ? ' and heal ' + Math.round(c.drain * 100) + '% of it' : '') + '.';
      case 'aoe': return 'Deal <b>' + c.min + '–' + c.max + '</b> damage to <b>all</b> enemies.';
      case 'dot': return (c.max > 0 ? 'Deal <b>' + (c.min === c.max ? c.min : c.min + '–' + c.max) + '</b>, then ' : 'Deal ') + '<b>' + c.dot.amt + '</b> per round for ' + c.dot.rounds + ' rounds.';
      case 'heal': return 'Heal yourself for <b>' + c.value + '</b>.';
      case 'hot': return 'Heal <b>' + c.value + '</b> now, then <b>' + c.hot.amt + '</b> per round for ' + c.hot.rounds + ' rounds.';
      case 'blade': return '<b>+' + c.value + '%</b> to your next ' + (c.affects === 'any' ? '' : sch(c.affects) + ' ') + 'attack.';
      case 'trap': return 'Target takes <b>+' + c.value + '%</b> from the next ' + (c.affects === 'any' ? '' : sch(c.affects) + ' ') + 'attack.';
      case 'shield': return 'Take <b>-' + c.value + '%</b> from the next attack.';
      case 'weakness': return 'Target’s next attack deals <b>-' + c.value + '%</b>.';
      case 'absorb': return 'Absorb the next <b>' + c.value + '</b> damage.';
    }
    return '';
  };
  // v2.1 A1: a rider's second effect (boss spells, Runeglass path B), shown under the main text
  UI.riderDesc = function (c) {
    var r = c && c.rider;
    if (!r) return '';
    var sch = function (a) { return a === 'any' || !a ? '' : (D().schools[a] ? D().schools[a].name + ' ' : ''); };
    if (r.type === 'absorb' && r.value > 0) return 'Then soak the next <b>' + r.value + '</b> damage.';
    if (r.type === 'hot' && r.hot && r.hot.amt > 0) return 'Then heal <b>' + r.hot.amt + '</b> per round for ' + r.hot.rounds + ' rounds.';
    if (r.type === 'trap' && r.value > 0) return 'Leaves a <b>+' + r.value + '%</b> ' + sch(r.affects) + 'trap on each target hit.';
    return '';
  };

  // ---- v2.1 B5: the approved card face (docs/review/v2.1-cards/card-design-approved.png; styles in
  // game/css/cards.css). Gold double frame + corner gems, school sunburst, pip gems, school emblem,
  // level badge, embossed name banner, parchment effect box with the school rune, accuracy, Runeglass
  // rank diamonds + RANK ribbon, rarity gem (WF.data.cardRarity), foil on epic / legendary.
  // Non-attack "support" spells (blade, trap, shield, weakness, absorb, heal, hot) get the round art
  // window and the striped back so they read differently from attacks.
  var CARD_ATTACK = { damage: 1, aoe: 1, dot: 1 };
  // Original school marks (24 x 24 emblem, filled; 40 x 40 rune, stroked). Unknown schools fall back
  // to the school's `glyph` from schools.js.
  var CARD_EMBLEM = {
    stoneward: '<path d="M2 21 9.5 7.5l3.6 5.6 2.6-3.4L22 21z"/><path class="hi" d="M9.5 7.5 7.4 11.3l2-1 1.4 1.7 1-1.2z"/><path d="M2.5 22.4h19" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    tidecaller: '<path d="M2 17.5c3 0 4.4-6.6 9.8-7.3 4.6-.6 7.2 3.2 5 5.6-1.6 1.6-4 .3-2.8-1.4-2.7-.2-3.3 3.6.2 4.7 3.6 1.1 6.6-1.6 7.8-3.4V21H2z"/><path d="M2 22.5c2.5-1.2 4.5-1.2 7 0s4.5 1.2 7 0 4.5-1.2 6 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
    emberstrike: '<path d="M12 1.8c.8 3.9 5.6 6.2 5.6 11.9 0 4-2.6 6.9-5.6 6.9s-5.6-2.7-5.6-6.3c0-3 1.9-4.6 2.7-6.9 1 2 1.1 3.2.8 4.6 2.4-1.6 2.8-6.2 2.1-10.2z"/><path class="hi" d="M12 11.2c.8 2.3 2.7 3.4 2.7 5.4 0 1.7-1.2 2.7-2.7 2.7s-2.6-1.1-2.6-2.5c0-1.7 1.4-2.4 2.6-5.6z"/><path d="M5 22.3h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    lumen: '<path d="m12 1 1.6 6.1 5.5-3.2-3.2 5.5L22 11l-6.1 1.6 3.2 5.5-5.5-3.2L12 21l-1.6-6.1-5.5 3.2 3.2-5.5L2 11l6.1-1.6-3.2-5.5 5.5 3.2z"/><circle class="hi" cx="12" cy="11" r="3.4"/>',
    hollow: '<path d="M1.5 12C5 6 19 6 22.5 12 19 18 5 18 1.5 12z"/><ellipse class="hi" cx="12" cy="12" rx="2" ry="4.4"/>'
  };
  var CARD_RUNE = {
    stoneward: '<path d="M20 4l14 8v16l-14 8-14-8V12zM20 4v32M6 12l28 16M34 12 20 20"/>',
    tidecaller: '<path d="M4 13c4-5 8-5 12 0s8 5 12 0 6-4 8-2M4 21c4-5 8-5 12 0s8 5 12 0 6-4 8-2M4 29c4-5 8-5 12 0s8 5 12 0 6-4 8-2"/>',
    emberstrike: '<path d="M20 4 36 34H4zM20 14c4 5 4.5 10 0 15-4.5-5-4-10 0-15z"/>',
    lumen: '<circle cx="20" cy="20" r="8"/><path d="M20 2v8M20 30v8M2 20h8M30 20h8M7.3 7.3l5.7 5.7M27 27l5.7 5.7M32.7 7.3 27 13M13 27l-5.7 5.7"/>',
    hollow: '<path d="M27 5a16 16 0 1 0 0 30A12 12 0 1 1 27 5z"/><path d="M14 20h12"/>'
  };
  var PAW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="16" rx="5.2" ry="4.4"/><circle cx="5.3" cy="10.4" r="2.3"/><circle cx="9.4" cy="6.4" r="2.4"/><circle cx="14.6" cy="6.4" r="2.4"/><circle cx="18.7" cy="10.4" r="2.3"/></svg>';
  // -> rarity id of a card (data: WF.data.cardRarity, colours: WF.data.rarities)
  UI.cardRarity = function (cardOrId) {
    var R = D().cardRarity, r = R && typeof R.of === 'function' ? R.of(cardOrId) : 'common';
    return (D().rarities && D().rarities[r]) ? r : 'common';
  };

  // opts: disabled, reason, count, tc, small, key (shortcut number); pv (battle.preview result) is ignored since v2.1 A7
  // opts.ranks / opts.school: draw with another seat's Runeglass ranks (co-op); opts.base: the trained card, no ranks
  UI.cardEl = function (cardId, opts) {
    opts = opts || {};
    var st = S();
    var view = !opts.base && st && st.cardView ? st.cardView(cardId, { ranks: opts.ranks, school: opts.school }) : { card: D().cards[cardId] || null, ranked: false, rank: 1 };
    var c = view.card;   // v2.1 A1: the ranked copy when the wizard upgraded it at the Spellwright
    var node = h('div', 'card' + (opts.disabled ? ' disabled' : '') + (opts.tc ? ' tc' : '') + (opts.small ? ' small' : '') + (view.ranked ? ' ranked' : ''));
    if (!c) { node.textContent = cardId; return node; }
    var sc = D().schools[c.school], col = schoolColor(c.school);
    var support = !CARD_ATTACK[c.type];
    var rarity = UI.cardRarity(c), rar = D().rarities[rarity] || { name: 'Common', color: '#d8d8d8' };
    var foil = rarity === 'epic' || rarity === 'legendary';
    node.className += ' wf-card s-' + c.school + ' r-' + rarity + (support ? ' support' : ' attack') + (foil ? ' foil' : '');
    node.setAttribute('data-card', cardId);
    node.setAttribute('data-rarity', rarity);
    if (view.ranked) { node.setAttribute('data-rank', view.rank); node.style.setProperty('--pc', view.pathColor); }
    node.style.setProperty('--sc', col);
    node.style.setProperty('--scd', sc ? sc.dark : '#333');
    node.style.setProperty('--rc', rar.color);
    // pip gems in the school colour (6+ pips: one gem and ×n)
    var pips = '';
    if (!c.pips) pips = '<em class="pip0" title="Free: costs no pips">0</em>';
    else if (c.pips > 5) pips = '<i></i><em class="pipx">×' + c.pips + '</em>';
    else for (var i = 0; i < c.pips; i++) pips += '<i></i>';
    var flavor = (lore().cardFlavor && lore().cardFlavor[cardId]) || '';
    var desc = UI.cardDesc(c);
    var rider = UI.riderDesc(c);
    if (rider) desc += ' <span class="c-rider">' + rider + '</span>';
    // v2.1 A1: Runeglass rank: diamonds in the footer (lit up to the rank) + a RANK n ribbon on the art
    var ribbon = '', diamonds = '';
    var RG = D().runeglass, canRank = !opts.base && RG && typeof RG.eligible === 'function' && RG.eligible(D().cards[cardId]);
    if (view.ranked || canRank) {
      var max = view.max || (RG && RG.maxRank) || 5, rk = view.ranked ? view.rank : 1, dm = '';
      for (var ri = 1; ri <= max; ri++) dm += ri <= rk ? '◆' : '◇';
      diamonds = '<span class="c-rank' + (view.ranked ? ' on' : '') + '" title="' + (view.ranked ? 'Rank ' + rk + ' of ' + max + ': ' + U.esc(view.pathText) : 'Rank 1 of ' + max + ': upgrade it with Runeglass at the Spellwright') + '"><span class="c-rank-d">' + dm + '</span></span>';
      if (view.ranked) ribbon = '<span class="c-ribclip"><span class="c-ribbon" title="' + U.esc(view.pathText) + '"><span class="c-rank-r">RANK ' + rk + '</span></span></span>';
    }
    // v2.1 A7 (Jorge): no "damage after buffs" preview on the card face: it always shows its own
    // (Runeglass-ranked) range. opts.pv is still accepted for compatibility and ignored.
    // ---- v1.2 WS8: painted card art (WF.cardArt); the type glyph becomes a corner badge
    var glyph = TYPE_GLYPH[c.type] || '✦';
    var art = WF.cardArt && WF.cardArt.has(cardId) ? WF.cardArt.imgHTML(cardId) : '';
    if (art) node.classList.add('art');
    // boss-earned spells (source 'boss', V1.2-CONTRACT §8) carry a "Boss spell" ribbon on the picture; pet cards a "Pet spell" one
    var boss = c.source === 'boss' ? '<span class="c-boss" title="Boss spell: earned by defeating a boss">Boss spell</span>' : '';
    if (boss) node.classList.add('boss');
    var pet = c.source === 'pet' ? '<span class="c-boss c-pet" title="Pet spell: your pet casts it beside you">' + PAW_SVG + 'Pet spell</span>' : '';
    var lvl = !c.source && c.level > 0 && c.level < 99 ? '<span class="c-lvl" title="Learned at level ' + c.level + '">L' + c.level + '</span>' : '';
    var sparks = foil ? '<i class="c-spark k1">✦</i><i class="c-spark k2">✧</i><i class="c-spark k3">✦</i>' : '';
    var emb = CARD_EMBLEM[c.school] ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + CARD_EMBLEM[c.school] + '</svg>' : '<b>' + U.esc((sc && sc.glyph) || '✦') + '</b>';
    var rune = CARD_RUNE[c.school] ? '<svg class="c-rune" viewBox="0 0 40 40" aria-hidden="true">' + CARD_RUNE[c.school] + '</svg>' : '';
    var tname = TYPE_NAME[c.type] || '';
    node.innerHTML =
      '<div class="c-face"><div class="c-inner">' +
        '<div class="c-top"><span class="c-pips">' + pips + '</span><span class="c-emb" title="' + U.esc(sc ? sc.name : '') + '">' + emb + '</span></div>' +
        // the picture (or the type glyph when there is none); badges sit on the inner face so the round
        // support window never clips them
        '<div class="c-art' + (art ? ' has-art' : '') + '" data-glyph="' + glyph + '">' + art + '</div>' +
        (art ? '<span class="c-badge" title="' + tname + '">' + glyph + '</span>' : '') + lvl + boss + pet + ribbon + sparks +
        '<div class="c-name"><span>' + U.esc(c.name) + '</span></div>' +
        '<div class="c-text">' + rune + '<div class="c-type"><span class="c-tsch">' + (sc ? sc.name : '') + ' </span>' + tname + '</div>' +
          '<div class="c-desc">' + desc + '</div></div>' +
        '<div class="c-foot"><span class="c-acc" title="Accuracy"><i>◎ </i>' + c.acc + '%</span>' + diamonds +
          '<span class="c-rar" title="' + U.esc(rar.name) + '"></span></div>' +
        (foil ? '<div class="c-foil"></div>' : '') +
      '</div><i class="c-gem g1"></i><i class="c-gem g2"></i><i class="c-gem g3"></i><i class="c-gem g4"></i></div>' +
      (opts.count != null ? '<div class="c-count">×' + opts.count + '</div>' : '') +
      (opts.tc ? '<div class="c-tc">SCROLL</div>' : '') +
      (opts.key ? '<div class="c-key">' + opts.key + '</div>' : '') +
      (opts.disabled && opts.reason ? '<div class="c-why">' + U.esc(String(opts.reason).replace('Not enough ', 'Need ')) + '</div>' : '');
    node.title = c.name + (view.ranked ? ' (Rank ' + view.rank + ', ' + view.pathText + ')' : '') + ' · ' + rar.name + (flavor ? ' — ' + flavor : '') + (opts.reason && opts.disabled ? '\n(' + opts.reason + ')' : '');
    return node;
  };

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  UI.init = function () {
    el('hud-btn-quests').onclick = function () { UI.toggle('quests'); };
    el('hud-btn-spells').onclick = function () { UI.toggle('spells'); };
    el('hud-btn-pack').onclick = function () { UI.toggle('pack'); };
    el('hud-btn-menu').onclick = function () { UI.toggle('menu'); };
    // v1.1 Mount button (built here so the HTML stays untouched)
    var hb = el('hud-buttons');
    if (hb && !el('hud-btn-mount')) {
      var mb = h('button', 'hbtn', '<b>&#9822;</b><span>Mount</span><small>R</small>');
      mb.id = 'hud-btn-mount'; mb.title = 'Ride / dismount (R)';
      mb.onclick = function () { WF.world.toggleMount(); };
      hb.insertBefore(mb, hb.firstChild);
    }
    // ---- v2.0 WS-C: Realm button (friends join your world with a lantern sigil)
    if (hb && WF.realm && !el('hud-btn-realm')) {
      var rb = h('button', 'hbtn', '<b>&#10040;</b><span>Realm</span><small>G</small>');
      rb.id = 'hud-btn-realm'; rb.title = 'Realms: play with friends (G)';
      rb.onclick = function () { UI.toggle('realm'); };
      hb.insertBefore(rb, el('hud-btn-menu'));
    }
    var pb = el('hud-btn-pack');
    if (pb && !pb.querySelector('.hud-new')) pb.appendChild(h('em', 'hud-new hidden', 'NEW'));
    el('hud-hp-pot').onclick = function () { UI.potion('health'); };
    el('hud-mana-pot').onclick = function () { UI.potion('mana'); };
    window.addEventListener('keydown', function (e) {
      if (U.isTyping(e.target)) return;
      // Level-up / ending overlay sits above everything: only it reacts to keys
      if (overlayOpen()) {
        if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') && !e.repeat) {
          e.preventDefault(); e.stopImmediatePropagation();
          var b = el('lu-ok'); if (b) b.click();
        }
        return;
      }
      var W = WF.world;
      if (W.mode === 'title' || W.mode === 'combat' || W.mode === 'loading' || W.mode === 'cutscene') return;   // v2.1 QA: no panels during story vignettes
      if (!el('results').classList.contains('hidden')) return;
      if (W.mode === 'dialog') {
        if (WF.lookEditor && WF.lookEditor.mirrorKey && WF.lookEditor.mirrorKey(e)) return;   // v2.1: the Mirror owns the keys
        if (e.repeat) return;
        if (e.code === 'Escape') { UI.closeDialog(); return; }
        if (e.code === 'Space' || e.code === 'Enter') {
          var f = document.activeElement;
          if (f && f.tagName === 'BUTTON' && el('dialog').contains(f)) return;   // let the focused button act
          var btn = document.querySelector('#dialog .dlg-buttons .btn.primary') || document.querySelector('#dialog .dlg-buttons .btn');
          if (btn) { e.preventDefault(); e.stopImmediatePropagation(); btn.click(); }
        }
        var dn = /^(Digit|Numpad)([1-9])$/.exec(e.code);
        if (dn) {
          var bs = document.querySelectorAll('#dialog .dlg-buttons .btn, #dialog .train-item .btn');
          var b2 = bs[+dn[2] - 1];
          if (b2 && !b2.disabled) { e.preventDefault(); b2.click(); }
        }
        return;
      }
      if (e.code === 'Escape') {
        if (openPanel) { UI.closeAll(); return; }
        UI.toggle('menu'); return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyL') UI.toggle('quests');
      else if (e.code === 'KeyK') UI.toggle('spells');
      else if (e.code === 'KeyB' || e.code === 'KeyI') UI.toggle('pack');
      else if (e.code === 'KeyH') UI.potion('health');
      else if (e.code === 'KeyJ') UI.potion('mana');
      else if (e.code === 'KeyG' && WF.realm) UI.toggle('realm');     // v2.0 WS-C
    });
    S().on(function (type) {
      if (type === 'quest' || type === 'inventory') { UI.refresh(); if (WF.world.zone) WF.world.refreshMarkers(); }
    });
  };

  UI.showHUD = function (on) { el('hud').classList.toggle('hidden', !on); };

  UI.potion = function (kind) {
    if (WF.world.mode !== 'explore' && WF.world.mode !== 'menu') return;
    var r = S().usePotion(kind);
    if (!r) { UI.toast(uiText('noPotions', 'No potions left. Buy some from Pip Quickcoin.'), 'warn'); WF.sfx.play('error'); }
    else if (r === 'full') UI.toast(kind === 'health' ? 'Health is already full.' : 'Mana is already full.');
    else { WF.sfx.play('heal'); UI.toast('Used ' + U.esc(itemName(r)) + '.'); }
    UI.refresh();
  };

  // HUD only (cheap; runs every 0.1 s). Panels re-render on events, never on a timer.
  var lastHud = '';
  UI.refreshHUD = function () {
    var p = S().player;
    if (!p) return;
    var st = S().stats(), sc = D().schools[p.school];
    var need = S().xpNeeded();
    var hpPotions = 0, manaPotions = 0;
    Object.keys(p.inventory).forEach(function (id) {
      var it = D().items[id];
      if (it && it.type === 'potion') { if (it.heal) hpPotions += p.inventory[id]; if (it.mana) manaPotions += p.inventory[id]; }
    });
    var newN = Object.keys(p.newItems || {}).filter(function (id) { return p.inventory[id]; }).length;
    var key = [Math.round(p.hp), Math.floor(p.mana), p.xp, p.level, p.gold, st.maxHp, st.maxMana, hpPotions, manaPotions, newN, p.mounted, p.equipped.mount, S().ownedMounts().length].join('|');
    if (key !== lastHud) {
      lastHud = key;
      var nb = document.querySelector('#hud-btn-pack .hud-new');
      if (nb) { nb.classList.toggle('hidden', !newN); nb.textContent = newN > 9 ? '9+' : String(newN); }
      var mbt = el('hud-btn-mount');
      if (mbt) {
        var owned = S().ownedMounts().length;
        mbt.classList.toggle('on', !!p.mounted);
        mbt.classList.toggle('none', !owned);
        mbt.querySelector('span').textContent = p.mounted ? 'Dismount' : 'Mount';
        mbt.title = owned ? (p.mounted ? 'Dismount (R)' : 'Ride ' + itemName(p.equipped.mount || S().ownedMounts()[0]) + ' (R)') : (((D().lore || {}).ui || {}).noMountTitle || 'No mount yet');
      }
      el('hud-name').innerHTML = U.esc(p.name) + ' <small style="color:' + sc.color + '">' + sc.name + '</small>';
      el('hud-level').textContent = p.level;
      el('hud-level').style.background = sc.color;
      setBar('hud-hp', p.hp / st.maxHp, '❤ ' + Math.round(p.hp) + ' / ' + st.maxHp);
      setBar('hud-mana', p.mana / st.maxMana, '✦ ' + Math.floor(p.mana) + ' / ' + st.maxMana);
      setBar('hud-xp', need ? p.xp / need : 1, need ? 'XP ' + U.fmt(p.xp) + ' / ' + U.fmt(need) : 'MAX LEVEL');
      el('hud-gold').textContent = U.fmt(p.gold);
      el('hud-hp-pot').innerHTML = '❤ <b>' + hpPotions + '</b><small>H</small>';
      el('hud-mana-pot').innerHTML = '✦ <b>' + manaPotions + '</b><small>J</small>';
    }
    renderTracker();
  };
  UI.refresh = function () {
    UI.refreshHUD();
    if (openPanel && openPanel !== 'menu') renderPanel(openPanel);
  };
  function setBar(id, f, text) {
    var b = el(id);
    b.querySelector('.fill').style.width = (U.clamp(f, 0, 1) * 100) + '%';
    b.querySelector('span').textContent = text;
  }

  var lastTracker = '';
  function renderTracker() {
    var ids = S().activeQuestIds();
    var html = '';
    var p = S().player;
    if (p.pendingSpells.length) {
      var tn = D().npcs[S().trainerId()];
      html += '<div class="tq main"><div class="tq-name">✨ New spells to learn</div><div class="tq-obj ready">Visit ' + U.esc(tn ? tn.name : 'your trainer') + zoneHint(S().npcZone(S().trainerId())) + '</div></div>';
    }
    ids.slice(0, 4).forEach(function (qid) {
      var q = D().quests[qid], ready = S().isReady(qid);
      html += '<div class="tq' + (q.main ? ' main' : '') + '"><div class="tq-name">' + (q.main ? '★ ' : '') + U.esc(q.name) + '</div>';
      if (ready) {
        var n = D().npcs[S().resolveNpc(q.turnIn)];
        html += '<div class="tq-obj ready">✔ Return to ' + U.esc(n ? n.name : q.turnIn) + zoneHint(S().npcZone(S().resolveNpc(q.turnIn))) + '</div>';
      } else {
        q.objectives.forEach(function (o, i) {
          var pr = S().objectiveProgress(qid, i);
          html += '<div class="tq-obj' + (pr.done ? ' done' : '') + '">' + U.esc(S().objectiveText(qid, i)) + '</div>';
        });
        var hint = S().questHint(qid);
        if (hint.zone && hint.zone !== WF.world.zoneId) html += '<div class="tq-hint">➜ ' + U.esc(D().zones[hint.zone] ? D().zones[hint.zone].name : hint.zone) + '</div>';
      }
      html += '</div>';
    });
    if (!ids.length && !p.pendingSpells.length) {
      var avail = Object.keys(D().quests).filter(function (q) { return S().questState(q) === 'available'; });
      if (avail.length) {
        var q0 = D().quests[avail[0]], n0 = D().npcs[S().resolveNpc(q0.giver)];
        html = '<div class="tq"><div class="tq-name">New quest available</div><div class="tq-obj">Look for the gold <b style="color:#ffd23f">!</b> — ' + U.esc(n0 ? n0.name : '') + zoneHint(S().npcZone(S().resolveNpc(q0.giver))) + '</div></div>';
      }
    }
    if (html !== lastTracker) { lastTracker = html; el('tracker').innerHTML = html; }
  }
  function zoneHint(z) {
    if (!z || z === WF.world.zoneId) return '';
    return ' <span class="dim">(' + U.esc(D().zones[z] ? D().zones[z].name : z) + ')</span>';
  }

  // True while a modal overlay (level-up, new spells, ending, duel results) is on screen
  UI.blocking = function () { return overlayOpen() || !el('results').classList.contains('hidden'); };

  // ------------------------------------------------------------------
  // Per-frame (floating texts, minimap)
  // ------------------------------------------------------------------
  var mmTimer = 0, _pos = new THREE.Vector3(), _scr = { x: 0, y: 0, visible: false };
  UI.update = function (dt) {
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      f.t += dt;
      var k = f.t / f.life;
      if (k >= 1) { f.node.remove(); floats.splice(i, 1); continue; }
      _pos.copy(f.pos); if (f.kind !== 'speech') _pos.y += k * 1.2;
      var sp = WF.world.toScreen(_pos, _scr);
      f.node.style.transform = 'translate(-50%,-50%) translate(' + sp.x + 'px,' + sp.y + 'px) scale(' + (f.kind === 'cast' || f.kind === 'speech' ? 1 : (k < 0.12 ? 0.6 + k * 4 : 1)) + ')';
      f.node.style.opacity = sp.visible ? (k > 0.75 ? (1 - k) * 4 : 1) : 0;
    }
    mmTimer -= dt;
    if (mmTimer <= 0 && WF.world.mode !== 'combat' && WF.world.mode !== 'title' && WF.world.player) {
      mmTimer = 0.1;
      WF.world.drawMinimap(el('minimap'));
      if (S().player) UI.refreshHUD();
    }
  };

  UI.floatText = function (text, pos, color, size, kind) {
    var n = h('div', 'float' + (kind ? ' ' + kind : ''), U.esc(text));
    n.style.color = color || '#fff';
    var ts = (S().player && S().player.settings.textScale) || 1;
    n.style.fontSize = Math.round(18 * (size || 1) * ts) + 'px';
    n.style.opacity = 0;
    el('floats').appendChild(n);
    // Stack texts that pop up at the same spot at the same time instead of overlapping
    var p0 = pos.clone(), stacked = 0;
    for (var i = 0; i < floats.length; i++) {
      var f = floats[i];
      if (f.kind === 'speech' || kind === 'speech') continue;
      if (f.t < 0.9 && Math.abs(f.base.x - p0.x) < 0.8 && Math.abs(f.base.z - p0.z) < 0.8) stacked++;
    }
    var shifted = p0.clone(); shifted.y += stacked * 0.5;
    floats.push({ node: n, pos: shifted, base: p0, t: 0, life: kind === 'speech' ? 3.2 : 1.4, kind: kind });
    if (kind === 'speech' && WF.voice) WF.voice.sayAny(text, { queue: true, delay: 0 });   // ---- v1.2 WS7: duel speech
  };
  // Remove floating texts (all, or one kind e.g. 'speech')
  UI.clearFloats = function (kind) {
    for (var i = floats.length - 1; i >= 0; i--) {
      if (!kind || floats[i].kind === kind) { floats[i].node.remove(); floats.splice(i, 1); }
    }
  };

  UI.toast = function (msg, type, ms) {
    var t = h('div', 'toast ' + (type || 'info'), msg);
    if (type === 'lore' && WF.voice && WF.voice.lookup('narrator', msg)) WF.voice.say('narrator', msg, { delay: 400 });   // ---- v1.2 WS7
    var box = el('toasts');
    box.appendChild(t);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    // v2.1 QA: long messages (realm notes, coach lines) stay up long enough to read: ~55 ms per character
    var plain = String(msg).replace(/<[^>]*>/g, '');
    var life = ms || Math.max(type === 'lore' ? 6500 : 3800, Math.min(12000, plain.length * 55));
    setTimeout(function () { t.classList.add('out'); }, life);
    setTimeout(function () { t.remove(); }, life + 600);
  };

  UI.prompt = function (html) {
    var p = el('prompt');
    if (overlayOpen() || !el('results').classList.contains('hidden')) html = null;
    if (!html) { if (!p.classList.contains('hidden')) p.classList.add('hidden'); return; }
    if (p.innerHTML !== html) p.innerHTML = html;
    p.classList.remove('hidden');
  };

  UI.zoneBanner = function (zone) {
    var b = el('zone-banner');
    b.innerHTML = '<div class="zb-name">' + U.esc(zone.name) + '</div><div class="zb-sub">' + U.esc(zone.subtitle || '') +
      (zone.safe ? ' &middot; Safe Zone' : ' &middot; Levels ' + zone.levelRange[0] + '–' + zone.levelRange[1]) + '</div>';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    el('zone-name').textContent = zone.name;
  };

  UI.fade = function (on) {
    return new Promise(function (r) { el('fade').classList.toggle('on', on); setTimeout(r, 420); });
  };

  // ------------------------------------------------------------------
  // Dialogue with NPCs (quests, trainers, shops)
  // ------------------------------------------------------------------
  // v2.1 D16: a plain choice box in the dialog panel (no NPC, not voiced), e.g. Normal / Heroic at a
  // dungeon entrance. o = { name, title, heading, text, extraHTML, buttons: [{ label, primary, action }] }.
  // Every button closes the box before its action. Esc closes it (no choice). -> true when shown
  var silentDialog = false, choiceNo = 0;
  UI.choice = function (o) {
    if (!o || overlayOpen() || WF.world.mode !== 'explore') return false;
    UI.closeAll(true);
    dialogNpc = null; silentDialog = true;
    var mine = ++choiceNo;
    WF.world.mode = 'dialog';
    WF.sfx.play('open');
    pages({ name: o.name || '', title: o.title || '' }, [o.text || ''], (o.buttons || []).map(function (b) {
      return { label: b.label, primary: b.primary, action: function () {
        if (mine !== choiceNo || !silentDialog || WF.world.mode !== 'dialog') return;   // a stale box: ignore
        UI.closeDialog(); if (b.action) b.action();
      } };
    }), o.heading ? U.esc(o.heading) : '', o.extraHTML || '');
    return true;
  };
  UI.talkTo = function (npcId) {
    silentDialog = false;
    var npc = D().npcs[npcId];
    if (!npc || overlayOpen()) return;
    if (WF.world.mode !== 'explore' && WF.world.mode !== 'dialog') return;
    UI.closeAll(true);
    dialogNpc = npcId;
    WF.world.mode = 'dialog';
    if (WF.world.player && WF.world.player.tag) WF.world.player.tag.visible = false;
    WF.sfx.play('open');

    // "Talk to X" objectives complete just by talking
    var talkQs = S().talkTargetsAt(npcId);
    var talkUpdates = S().onTalk(npcId);
    talkUpdates.forEach(function (u) { UI.toast('<b>' + U.esc(D().quests[u.qid].name) + '</b>: ' + U.esc(u.text), 'quest'); });
    if (talkUpdates.length) { WF.sfx.play('quest_accept'); WF.world.refreshMarkers(); }

    var turnIns = S().turnInsAt(npcId);
    var offers = S().offersAt(npcId);
    var pending = S().pendingAt(npcId);
    var isMyTrainer = npcId === S().trainerId();

    if (talkQs.length && !turnIns.some(function (q) { return talkQs.indexOf(q) >= 0; })) {
      var tq = D().quests[talkQs[0]];
      var tob = tq.objectives.filter(function (o) { return o.type === 'talk' && S().resolveNpc(o.npc) === npcId; })[0] || {};
      var lines = (tob.schoolLines && tob.schoolLines[S().player.school]) || tob.lines || tq.talk ||
        [(npc.greeting && npc.greeting[0]) || 'Ah, I was expecting you.'];
      return pages(npc, lines, [{ label: 'Continue', action: function () {
        // only keep talking if this NPC has more business with us
        var more = S().turnInsAt(npcId).length || S().offersAt(npcId).length || (npcId === S().trainerId() && S().player.pendingSpells.length);
        if (more) UI.talkTo(npcId); else UI.closeDialog();
      }, primary: true }], U.esc(tq.name));
    }
    // Your school trainer teaches the spells you've earned (before any quest business)
    if (isMyTrainer && S().player.pendingSpells.length) {
      var tl = (lore().trainerLines || {})[npcId] || {};
      return pages(npc, [tl.learn || 'You have grown, {name}. Let me teach you what you have earned.'], [
        { label: 'Learn ' + S().player.pendingSpells.length + ' new spell' + (S().player.pendingSpells.length > 1 ? 's' : ''), primary: true, action: function () { learnSpells(npcId); } }
      ], 'Spell Training');
    }
    if (turnIns.length) {
      var qid = turnIns[0], q = D().quests[qid];
      // v2.0 WS-E: a once-only story aside at this turn-in (lore.storyAsides, e.g. B2 at L5 / L10)
      var aside = WF.story ? WF.story.turnInAside(npcId, qid) : null;
      var cLines = (q.complete || ['Well done!']).concat(aside ? [aside.line] : []);
      return pages(npc, cLines, [{ label: 'Complete Quest', primary: true, action: function () { completeQuest(qid, npcId, aside); } }], U.esc(q.name), rewardsHTML(q.rewards));
    }
    if (offers.length) {
      var oid = offers[0], oq = D().quests[oid];
      return pages(npc, oq.offer || ['I have a task for you.'], [
        { label: 'Accept', primary: true, action: function () {
          S().accept(oid);
          WF.sfx.play('quest_accept');
          UI.toast('Quest accepted: <b>' + U.esc(oq.name) + '</b>', 'quest');
          WF.world.refreshMarkers();
          UI.refresh();
          if (S().offersAt(npcId).length || S().turnInsAt(npcId).length) UI.talkTo(npcId); else UI.closeDialog();
        } },
        { label: 'Not now', action: UI.closeDialog }
      ], U.esc(oq.name) + (oq.level ? ' <small>(Lv ' + oq.level + ')</small>' : ''), objectivesHTML(oq) + rewardsHTML(oq.rewards));
    }
    var buttons = [];
    var sellsMounts = (npc.vendor || []).some(function (id) { return D().items[id] && D().items[id].type === 'mount'; });
    if (npc.vendor && npc.vendor.length) buttons.push({ label: sellsMounts ? 'Browse Mounts' : 'Shop', primary: true, action: function () { UI.closeDialog(true); UI.openShop(npcId); } });
    if (S().recipesAt(npcId).length && !(npc.vendor && npc.vendor.length)) buttons.push({ label: 'Craft', primary: true, action: function () { UI.closeDialog(true); UI.openShop(npcId, 'craft'); } });
    if (npc.role === 'trainer' && !isMyTrainer && S().trainableAt(npcId).length) buttons.push({ label: 'Train (' + S().player.trainingPoints + ' pts)', primary: true, action: function () { trainScreen(npcId); } });
    if (npc.role === 'trainer' && isMyTrainer) buttons.push({ label: 'View Spells', action: function () { UI.closeDialog(true); UI.toggle('spells'); } });
    // ---- v1.2 WS9: the banker opens the shared account Bank (game/js/bank.js)
    if (npc.role === 'banker' && WF.bank) buttons.push({ label: 'Open the Vault', primary: true, action: function () { UI.closeDialog(true); UI.openBank(npcId); } });
    // ---- v2.0 M1 (WS-A): the Spellwright's bench (game/js/spellwright.js)
    if (npc.role === 'spellwright' && WF.spellwright) buttons.unshift({ label: 'Upgrade Spells (◈ ' + (S().player.runeglass || 0) + ')', primary: true, action: function () { WF.spellwright.open(npcId); } });
    buttons.push({ label: 'Goodbye', action: UI.closeDialog });
    if (pending.length) {
      var pq = D().quests[pending[0]];
      return pages(npc, pq.progress || ['Still working on it?'], buttons, U.esc(pq.name));
    }
    var greet = npc.greeting && npc.greeting.length ? [U.pick(npc.greeting)] : ['Hello there.'];
    if (isMyTrainer) {
      var tl2 = (lore().trainerLines || {})[npcId] || {};
      if (tl2.nothing) greet = [tl2.nothing];
    } else if (npc.role === 'trainer' && npc.school) {
      greet = [greet[0], 'You walk the ' + D().schools[S().player.school].name + ' path, I see. If you have training points, I can teach you a little ' + D().schools[npc.school].name + ' magic.'];
    }
    if (WF.story) greet = WF.story.withGreetAside(npcId, greet);   // v2.0 WS-E: once-only greeting aside (A8, B4, R15)
    if (npc.role === 'banker' && WF.bank) return pages(npc, greet, buttons, null, WF.bank.dialogHTML(npcId));   // v1.2 WS9
    pages(npc, greet, buttons);
  };

  function learnSpells(npcId) {
    var ids = S().learnPending();
    WF.sfx.play('levelup');
    UI.closeDialog(true);
    WF.world.refreshMarkers();
    UI.refresh();
    overlayQueue.push({ learned: ids, npc: npcId });
    if (!overlayShowing) nextOverlay();
  }

  function trainScreen(npcId) {
    var npc = D().npcs[npcId], box = el('dialog');
    var tl = (lore().trainerLines || {})[npcId] || {};
    voiceSay(tl.train || '', npcId);   // ---- v1.2 WS7 (once, not on every re-render)
    function render() {
      var p = S().player;
      var list = S().trainableAt(npcId);
      box.innerHTML = '<div class="dlg-head"><span class="dlg-name">' + U.esc(npc.name) + '</span><span class="dlg-quest">Training points: <b>' + p.trainingPoints + '</b></span></div>' +
        '<div class="dlg-text">' + U.esc(U.fillText(tl.train || 'Each spell costs one training point. Choose wisely.')) + '</div><div class="train-list"></div><div class="dlg-buttons"></div>';
      var tlist = box.querySelector('.train-list');
      list.forEach(function (cid) {
        var chk = S().canTrain(cid);
        var wrap = h('div', 'train-item');
        wrap.appendChild(UI.cardEl(cid, { small: true, disabled: !chk.ok, reason: chk.reason }));
        var b = h('button', 'btn sm primary', p.known.indexOf(cid) >= 0 ? 'Known' : 'Learn (1 pt)');
        b.disabled = !chk.ok;
        b.title = chk.reason || '';
        b.onclick = function () { if (S().train(cid)) { WF.sfx.play('levelup'); UI.toast('Learned <b>' + U.esc(D().cards[cid].name) + '</b>! Added to your deck.', 'quest'); render(); } };
        wrap.appendChild(b);
        tlist.appendChild(wrap);
      });
      var bye = h('button', 'btn', 'Done');
      bye.onclick = UI.closeDialog;
      box.querySelector('.dlg-buttons').appendChild(bye);
    }
    render();
  }

  function objectivesHTML(q) {
    return '<div class="dlg-objs"><b>Objectives</b>' + q.objectives.map(function (o) {
      var t;
      if (o.type === 'kill') { var e = D().enemies[o.enemy]; t = 'Defeat ' + o.count + ' × ' + (e ? e.name : o.enemy); }
      else if (o.type === 'collect') t = 'Collect ' + o.count + ' × ' + itemName(o.item);
      else if (o.type === 'talk') { var n = D().npcs[S().resolveNpc(o.npc)]; t = 'Talk to ' + (n ? n.name : o.npc); }
      else if (o.type === 'visit') t = 'Travel to ' + (D().zones[o.zone] ? D().zones[o.zone].name : o.zone);
      else if (o.type === 'interact') t = (o.kind === 'relight' ? 'Relight ' : 'Use ') + o.count + (o.kind === 'relight' ? ' lanterns' : ' objects') + ' in ' + (D().zones[o.zone] ? D().zones[o.zone].name : o.zone);
      else if (o.type === 'upgrade') t = o.label || ('Upgrade ' + (o.count || 1) + ' spell(s) to rank ' + (o.rank || 2));   // v2.0 M1
      return '<div>• ' + U.esc(t) + '</div>';
    }).join('') + '</div>';
  }

  function rewardsHTML(r) {
    if (!r) return '';
    var parts = [];
    if (r.xp) parts.push('<span class="rw xp">' + U.fmt(r.xp) + ' XP</span>');
    if (r.gold) parts.push('<span class="rw gold">' + U.fmt(r.gold) + ' gold</span>');
    if (r.runeglass) parts.push('<span class="rw" style="--c:#9fe6ff">◈ ' + r.runeglass + ' Runeglass</span>');   // v2.0 M1
    Object.keys(r.items || {}).forEach(function (id) {
      var it = D().items[id], fancy = it && (it.type === 'gear' || it.type === 'mount');
      parts.push('<span class="rw' + (fancy ? ' item' : '') + '"' + (fancy ? ' style="--c:' + rarColor(it) + '"' : '') + '>' + r.items[id] + ' × ' + (fancy ? '<b style="color:' + rarColor(it) + '">' + U.esc(it.name) + '</b>' : U.esc(itemName(id))) + (it && it.type === 'mount' ? ' (mount)' : '') + '</span>');
    });
    (r.cards || []).forEach(function (id) { var c = D().cards[id]; parts.push('<span class="rw card" style="--c:' + schoolColor(c && c.school) + '">Spell: ' + U.esc(c ? c.name : id) + '</span>'); });
    Object.keys(r.tcs || {}).forEach(function (id) { var c = D().cards[id]; parts.push('<span class="rw">Scroll: ' + U.esc(c ? c.name : id) + '</span>'); });
    return parts.length ? '<div class="dlg-rewards"><b>Rewards</b> ' + parts.join(' ') + '</div>' : '';
  }

  // Shows lines one page at a time, then the final buttons. title is trusted HTML (escape before passing).
  function pages(npc, lines, finalButtons, title, extraHTML) {
    var box = el('dialog');
    var i = 0;
    lines = (lines || []).map(U.fillText);
    if (!lines.length) lines = [''];
    function show() {
      var last = i >= lines.length - 1;
      box.innerHTML =
        '<div class="dlg-head"><span class="dlg-name">' + U.esc(npc.name) + '</span>' + (npc.title ? '<span class="dlg-title">' + U.esc(npc.title) + '</span>' : '') +
        (title ? '<span class="dlg-quest">' + title + '</span>' : '') + '</div>' +
        '<div class="dlg-text">' + U.esc(lines[i] || '') + '</div>' +
        (last && extraHTML ? extraHTML : '') +
        '<div class="dlg-buttons"></div>' +
        '<div class="dlg-keys">' + (last ? 'Space / Enter: ' + U.esc(finalButtons[0].label) + ' · Esc: close' : 'Space / Enter: next · Esc: close') + '</div>';
      var bb = box.querySelector('.dlg-buttons');
      if (!last) {
        var nb = h('button', 'btn primary', 'Next ▶');
        nb.onclick = function () { i++; WF.sfx.play('click'); show(); };
        bb.appendChild(nb);
        var sk = h('button', 'btn btn-ghost', 'Skip');
        sk.onclick = function () { i = lines.length - 1; show(); };
        bb.appendChild(sk);
      } else {
        finalButtons.forEach(function (b) {
          var n = h('button', 'btn' + (b.primary ? ' primary' : ''), U.esc(b.label));
          n.onclick = function () { b.action(); };
          bb.appendChild(n);
        });
      }
      // ---- v1.2 WS7: read the page aloud (advancing/closing stops the previous line)
      voiceSay(lines[i]);
      var tx = box.querySelector('.dlg-text');
      if (tx) { tx.title = 'Click to stop the voice'; tx.onclick = voiceStop; }
    }
    box.classList.remove('hidden');
    show();
  }

  // ---- v1.2 WS7: NPC voices (WF.voice, game/js/voice.js). Hooks only; never throws.
  function voiceSay(text, speaker) {
    if (silentDialog && !speaker) return;          // v2.1: UI.choice boxes are not spoken
    try { if (WF.voice && text) WF.voice.say(speaker || dialogNpc, text); } catch (e) { /* silent */ }
  }
  function voiceStop() { try { if (WF.voice) WF.voice.stop(); } catch (e) { /* silent */ } }
  // Every menu render (first open, or the graphics option re-rendering it) gets the
  // voice settings appended: wrap renderMenu instead of editing it (WS5 owns it).
  var renderMenuBase = renderMenu;
  renderMenu = function () { renderMenuBase(); voiceMenu(); };
  function voicePreview() { var pv = D().voicePreview; if (pv) voiceSay(pv.text, pv.speaker); }
  // Menu: "Voices" on/off + "Voice volume", placed right after the music slider
  function voiceMenu() {
    var body = el('mn-body'), p = S().player;
    if (!body || !p || !WF.voice || el('mn-voice')) return;
    WF.voice.enabled();                       // applies the defaults (ON, 0.9) to p.settings
    var st = p.settings;
    var wrap = h('div', 'mn-voice-set',
      '<label class="mn-set"><input type="checkbox" id="mn-voice"' + (st.voice ? ' checked' : '') + '> Voices (characters read their lines aloud)</label>' +
      '<label class="mn-set">Voice volume <input type="range" id="mn-vvol" min="0" max="100" value="' + Math.round(st.voiceVolume * 100) + '"></label>');
    var after = el('mn-mus') && el('mn-mus').closest('label');
    if (after && after.parentNode) after.parentNode.insertBefore(wrap, after.nextSibling); else body.appendChild(wrap);
    el('mn-voice').onchange = function () { WF.voice.setEnabled(this.checked); S().save(); if (this.checked) voicePreview(); };
    el('mn-vvol').oninput = function () { WF.voice.setVolume(this.value / 100); };
    el('mn-vvol').onchange = function () { S().save(); if (st.voice && !WF.voice.isSpeaking()) voicePreview(); };
  }

  function completeQuest(qid, npcId, aside) {
    var q = D().quests[qid];
    var sum = S().turnIn(qid);
    if (!sum) { UI.closeDialog(); return; }
    if (aside && WF.story) WF.story.markAside(aside);        // v2.0 WS-E
    WF.sfx.play('quest_complete');
    UI.toast('Quest complete: <b>' + U.esc(q.name) + '</b> &nbsp;+' + sum.xp + ' XP' + (sum.gold ? ', +' + sum.gold + ' gold' : ''), 'quest');
    sum.cards.forEach(function (cid) { UI.toast('New spell: <b>' + U.esc(D().cards[cid].name) + '</b> (added to your deck)', 'quest'); });
    Object.keys((q.rewards || {}).items || {}).forEach(function (id) {
      var it = D().items[id];
      if (it && it.type === 'gear') UI.toast('New gear: ' + itemNameHTML(id) + ' — open your Backpack (B) to equip it.', 'quest', 6000);
      if (it && it.type === 'mount') {
        if (!S().player.equipped.mount) S().equipMount(id);
        UI.toast('New mount: ' + itemNameHTML(id) + '! Press <b>R</b> (or the Mount button) to ride.', 'quest', 7000);
        WF.sfx.play('whinny');
      }
    });
    WF.world.refreshMarkers();
    WF.world.refreshPortals();
    UI.refresh();
    sum.levelUps.forEach(function (u) { UI.levelUp(u); });
    // v2.0 WS-E (B3, R7): a story vignette after this turn-in plays first (after any level-up
    // overlays), then the chapter ending / the rest of the conversation
    var vg = WF.story ? WF.story.vignetteAfter(qid) : null;
    if (vg) {
      UI.closeDialog(true);
      afterOverlays(function () {
        WF.story.playVignette(vg, UI.storySay).then(function () {
          if (q.final) UI.ending(q);
          else if (S().offersAt(npcId).length || S().turnInsAt(npcId).length) UI.talkTo(npcId);
        });
      });
      return;
    }
    if (q.final) { UI.closeDialog(true); UI.ending(q); return; }
    if (sum.levelUps.length) {
      // Level-up overlays are showing: continue the conversation once they're dismissed
      UI.closeDialog(true);
      if (S().offersAt(npcId).length || S().turnInsAt(npcId).length) afterOverlays(function () { UI.talkTo(npcId); });
      return;
    }
    // Zone restored by this quest? (reloads the look next time the zone loads)
    if (S().offersAt(npcId).length || S().turnInsAt(npcId).length) UI.talkTo(npcId); else UI.closeDialog(true);
  }

  UI.dialogNpc = function () { return dialogNpc; };
  // v2.0 WS-E: a short story line from an NPC outside quest business (vignettes). A normal dialogue:
  // Continue, Space/Enter or Esc all close it, and `done` runs exactly once however it closes.
  var storyDone = null;
  UI.storySay = function (npcId, lines, done) {
    silentDialog = false;
    var npc = D().npcs[npcId];
    if (!npc || !lines || !lines.length) { if (done) done(); return; }
    UI.closeAll(true);
    dialogNpc = npcId;
    WF.world.mode = 'dialog';
    if (WF.world.player && WF.world.player.tag) WF.world.player.tag.visible = false;
    storyDone = done || null;
    pages(npc, lines, [{ label: 'Continue', primary: true, action: function () { UI.closeDialog(); } }]);
  };
  UI.closeDialog = function (silent) {
    el('dialog').classList.add('hidden');
    dialogNpc = null;
    if (silentDialog) { silentDialog = false; choiceNo++; if (UI.onChoiceClosed) try { UI.onChoiceClosed(); } catch (e) { /* hook */ } }
    if (storyDone) { var sd = storyDone; storyDone = null; setTimeout(function () { try { sd(); } catch (e) { console.error(e); } }, 0); }
    voiceStop();   // ---- v1.2 WS7
    if (WF.world.player && WF.world.player.tag) WF.world.player.tag.visible = true;
    if (WF.world.mode === 'dialog') WF.world.mode = 'explore';
    if (silent !== true) WF.sfx.play('close');
  };

  // ------------------------------------------------------------------
  // Side panels: quests / spells / pack / shop / menu
  // ------------------------------------------------------------------
  UI.toggle = function (name) {
    var m = WF.world.mode;
    if (m === 'combat' || m === 'title' || m === 'loading' || overlayOpen()) return;
    if (openPanel === name) { UI.closeAll(); return; }
    UI.closeAll(true);
    openPanel = name;
    WF.world.mode = 'menu';
    el('panel').classList.remove('hidden');
    renderPanel(name);
    WF.sfx.play('open');
  };

  UI.closeAll = function (silent) {
    dollDispose();
    hideTip();
    if (silentDialog) UI.closeDialog(true);           // v2.1 review M1: a choice box never outlives a panel / duel
    if (openPanel) {
      el('panel').classList.add('hidden');
      openPanel = null; shopNpc = null;
      if (WF.world.mode === 'menu') WF.world.mode = 'explore';
      if (!silent) WF.sfx.play('close');
    }
    if (dialogNpc) UI.closeDialog(true);
  };

  function panelFrame(title, bodyHTML) {
    return '<div class="pn-head"><span>' + title + '</span><button class="pn-x" id="pn-close" title="Close (Esc)">✕</button></div><div class="pn-body">' + bodyHTML + '</div>';
  }

  function renderPanel(name) {
    var pn = el('panel');
    var body0 = pn.querySelector('.pn-body');
    var scroll = body0 ? body0.scrollTop : 0;
    if (name !== 'pack') dollDispose();
    hideTip();
    pn.classList.toggle('wide', name === 'pack' || name === 'shop' || name === 'bank');
    pn.setAttribute('data-panel', name);
    if (name === 'quests') {
      pn.innerHTML = panelFrame('Quest Log <small>(L)</small>', questsHTML());
      pn.querySelectorAll('[data-abandon]').forEach(function (b) {
        b.onclick = function () {
          var qid = b.getAttribute('data-abandon');
          if (!window.confirm('Abandon "' + D().quests[qid].name + '"? You can pick it up again from the quest giver.')) return;
          S().abandon(qid); S().save(); WF.world.refreshMarkers(); rerender();
        };
      });
    }
    else if (name === 'spells') { pn.innerHTML = panelFrame('Spellbook &amp; Deck <small>(K)</small>', '<div id="sp-body"></div>'); renderSpells(); }
    else if (name === 'pack') {
      // keep the frame (and the paper-doll canvas) when re-rendering the open backpack
      if (!el('pk-body')) pn.innerHTML = panelFrame('Backpack <small>(B)</small>', '<div id="pk-body"></div>');
      renderPack();
    }
    else if (name === 'shop') { pn.innerHTML = panelFrame(U.esc(D().npcs[shopNpc] ? D().npcs[shopNpc].name : 'Shop'), '<div id="sh-body"></div>'); renderShop(); }
    else if (name === 'menu') { pn.innerHTML = panelFrame('Menu', '<div id="mn-body"></div>'); renderMenu(); }
    // v1.2 WS9: the Lanternmere Vault (game/js/bank.js draws the inside)
    else if (name === 'bank') { pn.innerHTML = panelFrame(WF.bank.titleHTML(), '<div id="bk-body"></div>'); WF.bank.render(el('bk-body')); }
    // ---- v2.0 WS-C: Realm panel (play with friends; game/js/net/realmUI.js draws the inside)
    else if (name === 'realm' && WF.realm) { pn.innerHTML = panelFrame('Realms <small>(G)</small>', '<div id="rl-body"></div>'); WF.realm.renderPanel(el('rl-body')); }
    el('pn-close').onclick = function () { UI.closeAll(); };
    var body = pn.querySelector('.pn-body');
    if (body) body.scrollTop = scroll;
  }
  // Re-render the open panel after a click (keeps scroll position)
  function rerender() { if (openPanel) renderPanel(openPanel); UI.refreshHUD(); }

  // ---- Quest log
  function questsHTML() {
    var ids = S().activeQuestIds();
    var out = '';
    if (!ids.length) out += '<p class="dim">No active quests. Look for NPCs with a gold <b style="color:#ffd23f">!</b> above their heads.</p>';
    ids.forEach(function (qid) {
      var q = D().quests[qid], g = D().npcs[S().resolveNpc(q.giver)], t = D().npcs[S().resolveNpc(q.turnIn)];
      out += '<div class="ql' + (q.main ? ' main' : '') + '"><div class="ql-name">' + (q.main ? '★ ' : '') + U.esc(q.name) + ' <small>Lv ' + (q.level || 1) + (q.main ? ' · Main Story' : ' · Side Quest') + '</small></div>';
      out += '<div class="ql-from">From ' + U.esc(g ? g.name : '') + ' → return to ' + U.esc(t ? t.name : '') + zoneHint(S().npcZone(S().resolveNpc(q.turnIn))) + '</div>';
      q.objectives.forEach(function (o, i) {
        var pr = S().objectiveProgress(qid, i);
        out += '<div class="ql-obj' + (pr.done ? ' done' : '') + '">' + (pr.done ? '✔ ' : '○ ') + U.esc(S().objectiveText(qid, i)) + '</div>';
      });
      var hint = S().questHint(qid);
      if (hint.zone) out += '<div class="ql-hint">Where: ' + U.esc(D().zones[hint.zone] ? D().zones[hint.zone].name : hint.zone) + '</div>';
      out += rewardsHTML(q.rewards) + (q.main ? '' : '<div class="ql-actions"><button class="btn sm btn-ghost" data-abandon="' + qid + '">Abandon</button></div>') + '</div>';
    });
    var done = Object.keys(S().player.quests.done).length, total = Object.keys(D().quests).length;
    out += '<p class="dim">Completed ' + done + ' of ' + total + ' quests.</p>';
    return out;
  }

  // ---- v1.2 WS3: Spellbook & Deck (W101-style deck items) ----
  // A two-page book. Left page: every spell you know as card art (click =
  // copy it into the deck, right-click = take one out). Right page: the
  // equipped deck as a grid of copies + the sideboard row for Spell Scrolls.
  // Drag and drop works both ways. The shelf on top lists every deck item.
  var dk = { tab: 'spells', school: 'all', type: 'all', msg: null, msgKind: '', msgRule: null, msgAt: 0, added: null,
    scroll: { left: 0, right: 0 }, notice: null, drag: null, peekEl: null, popEl: null };
  var DK_TYPES = { attack: { damage: 1, aoe: 1, dot: 1 }, heal: { heal: 1, hot: 1 }, charm: { blade: 1, trap: 1, weakness: 1 }, ward: { shield: 1, absorb: 1 } };
  var DK_TYPE_NAMES = [['all', 'All'], ['attack', 'Attacks'], ['heal', 'Healing'], ['charm', 'Charms'], ['ward', 'Wards']];
  // Deck cover emblems (original 24x24 art, painted in the deck's trim colour)
  var DK_EMBLEMS = {
    star: '<path d="M12 2.5 L14 10 L21.5 12 L14 14 L12 21.5 L10 14 L2.5 12 L10 10 Z"/>',
    leaf: '<path d="M5 19 C5 9 11 4 20 4 C20 13 15 19 5 19 Z M6 18 C9 14 12 11 16.5 7.5" stroke-width="1.2" fill-opacity=".9"/>',
    rune: '<path d="M12 2 L20 12 L12 22 L4 12 Z M12 6.5 L12 17.5 M8.5 12 L15.5 12" fill="none" stroke-width="1.6"/>',
    sun: '<circle cx="12" cy="12" r="4.6"/><path d="M12 1.5 V5 M12 19 V22.5 M1.5 12 H5 M19 12 H22.5 M4.6 4.6 L7 7 M17 17 L19.4 19.4 M4.6 19.4 L7 17 M17 7 L19.4 4.6" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
    orbit: '<ellipse cx="12" cy="12" rx="10" ry="4.2" fill="none" stroke-width="1.3" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="3.4"/><circle cx="20.4" cy="8.6" r="1.6"/><circle cx="4.2" cy="15.2" r="1.1"/>',
    gear: '<path d="M10.3 2 h3.4 l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5 v3.4 l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6 h-3.4 l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7 v-3.4 l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8 Z M12 8.4 a3.6 3.6 0 1 0 .01 0 Z" fill-rule="evenodd"/>'
  };

  // The 2D art of a deck item (also used by other panels: UI.deckCoverHTML)
  function deckCoverHTML(itemId, size) {
    var it = D().items[itemId]; if (!it) return '';
    var l = it.look || {}, s = size || 44;
    var em = DK_EMBLEMS[l.emblem] || DK_EMBLEMS.star;
    return '<span class="dk-cover r-' + S().rarityId(it) + '" style="--dc:' + (l.color || '#5a4a8a') + ';--dt:' + (l.color2 || '#ffd36b') + ';--dg:' + (l.gem || '#9fd4ff') + ';--cs:' + s + 'px">' +
      '<svg class="dk-emb" viewBox="0 0 24 24" aria-hidden="true">' + em.replace(/<(path|circle|ellipse)/g, '<$1 fill="' + (l.color2 || '#ffd36b') + '" stroke="' + (l.color2 || '#ffd36b') + '"') + '</svg>' +
      '<i class="dk-gem"></i></span>';
  }
  UI.deckCoverHTML = deckCoverHTML;
  // Rules list for a deck item (shop/tooltip helpers: UI.deckRulesHTML)
  function deckRulesHTML(itemId) {
    var it = D().items[itemId]; if (!it || !it.deck) return '';
    var r = it.deck;
    return '<div class="dk-rl"><span>Cards</span><b>' + r.size + '</b></div><div class="dk-rl"><span>Copies of a spell</span><b>' + r.maxCopies + '</b></div>' +
      '<div class="dk-rl"><span>From other schools</span><b>' + r.maxOther + '</b></div><div class="dk-rl"><span>Spell Scrolls</span><b>' + r.tcSlots + '</b></div>';
  }
  UI.deckRulesHTML = deckRulesHTML;

  // Where a deck you don't own comes from (data-driven: vendor, recipe, drop, quest)
  function deckSource(id) {
    var N = D().npcs, R = D().recipes || {}, E = D().enemies, Q = D().quests, k;
    for (k in N) if ((N[k].vendor || []).indexOf(id) >= 0) return 'Sold by ' + N[k].name + ' · ' + U.fmt(D().items[id].price) + ' gold';
    for (k in R) if (R[k].makes && R[k].makes.item === id) return 'Crafted by ' + ((N[R[k].npc] || {}).name || 'a crafter');
    for (k in E) {
      var L = E[k].loot || {};
      if ((L.drops || []).concat(L.gear || []).some(function (d) { return d.item === id; })) return 'Dropped by ' + E[k].name;
    }
    for (k in Q) if (((Q[k].rewards || {}).items || {})[id]) return 'Reward: ' + Q[k].name;
    return 'Found somewhere in the world';
  }

  function dkSay(msg, kind, rule) {
    dk.msg = msg; dk.msgKind = kind || ''; dk.msgRule = rule || null; dk.msgAt = Date.now();
    if (kind === 'warn') WF.sfx.play('error');
  }
  function dkSaved() { S().save(); renderSpells(); UI.refreshHUD(); }
  // Copy one spell in / take one out / scrolls in and out
  // v2.1: decks are 3x deep, so Shift (click / right-click / Enter / Delete) moves every copy at once
  function dkAdd(cid, all) {
    var chk = S().canAddCard(cid);
    if (!chk.ok) { dkSay(chk.reason, 'warn', chk.rule); renderSpells(); return false; }
    var have = S().deckCount(cid), n = all ? Math.max(1, S().deckRoom(cid).n) : 1;
    S().setDeckCount(cid, have + n);
    n = S().deckCount(cid) - have;
    dk.added = { card: cid, at: Date.now() };
    dkSay(n > 1 ? n + ' × ' + D().cards[cid].name + ' copied into your deck.' : D().cards[cid].name + ' copied into your deck.', 'ok');
    WF.sfx.play('card_draw');
    dkSaved(); return true;
  }
  function dkRemove(cid, all) {
    var n = S().deckCount(cid);
    if (!n) return false;
    S().setDeckCount(cid, all ? 0 : n - 1);
    dk.added = null;
    dkSay(all && n > 1 ? 'All ' + n + ' × ' + D().cards[cid].name + ' taken out of your deck.' : D().cards[cid].name + ' taken out of your deck.', '');
    WF.sfx.play('click');
    dkSaved(); return true;
  }
  function dkAddScroll(cid) {
    var chk = S().canAddScroll(cid);
    if (!chk.ok) { dkSay(chk.reason, 'warn', chk.rule === 'owned' ? null : 'scrolls'); renderSpells(); return false; }
    S().setSideboardCount(cid, S().sideboardCount(cid) + 1);
    dk.added = { scroll: cid, at: Date.now() };
    dkSay('Spell Scroll: ' + D().cards[cid].name + ' added to the sideboard.', 'ok');
    WF.sfx.play('card_draw');
    dkSaved(); return true;
  }
  function dkRemoveScroll(cid) {
    var n = S().sideboardCount(cid);
    if (!n) return false;
    S().setSideboardCount(cid, n - 1);
    dk.added = null;
    dkSay('Spell Scroll: ' + D().cards[cid].name + ' back in your satchel.', '');
    WF.sfx.play('click');
    dkSaved(); return true;
  }
  function dkEquip(id) {
    var it = D().items[id], r = S().equipDeck(id);
    if (!r.ok) { dkSay(r.reason, 'warn'); renderSpells(); return; }
    WF.sfx.play('buff');
    dkSay(it.name + ' equipped.' + (r.copied ? ' Copied ' + r.copied + ' card' + (r.copied > 1 ? 's' : '') + ' from your ' + D().items[r.from].name + (r.removed ? ' (' + r.removed + ' didn’t fit its rules)' : '') + '.' : ''), 'ok');
    dkSaved();
  }

  function dkSchoolOf(cid) { var c = D().cards[cid]; return c ? c.school : ''; }
  function dkSortSpells(ids, p) {
    var grp = function (c) { return c.school === p.school ? 0 : c.school === 'lumen' ? 1 : 2; };
    return ids.slice().sort(function (a, b) {
      var A = D().cards[a], B = D().cards[b];
      return grp(A) - grp(B) || (A.source ? 0 : A.level) - (B.source ? 0 : B.level) || A.pips - B.pips || A.name.localeCompare(B.name);
    });
  }
  function dkPasses(cid) {
    var c = D().cards[cid];
    if (!c) return false;
    if (dk.school !== 'all' && c.school !== dk.school) return false;
    if (dk.type !== 'all' && !(DK_TYPES[dk.type] || {})[c.type]) return false;
    return true;
  }

  // Copy dots under a book card: ●●○○ (in deck / max copies)
  function dkDots(n, max) {
    var s = '';
    if (!isFinite(max) || max > 8) return '<b>' + n + '</b>';
    for (var i = 0; i < max; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return s;
  }

  // ---- deck shelf (every deck item; owned ones are clickable) ----
  function dkShelf(p) {
    var shelf = h('div', 'dk-shelf');
    var owned = S().ownedDecks(), all = S().deckItemIds ? S().deckItemIds() : [];
    // v2.0 save v5: the Legacy Deck (decks.js `legacy`) only exists for wizards whose old deck needed it
    all = all.filter(function (id) { return !D().items[id].legacy || owned.indexOf(id) >= 0; });
    shelf.appendChild(h('div', 'dk-shelf-t', 'Your Decks <small>' + owned.length + ' of ' + all.length + '</small>'));
    var row = h('div', 'dk-shelf-row');
    all.forEach(function (id) {
      var it = D().items[id], info = S().deckInfo(id), have = !!info;
      var lvlOk = p.level >= (it.level || 1);
      var b = h('button', 'dk-deck' + (have ? '' : ' locked') + (info && info.equipped ? ' on' : '') + (have && !lvlOk ? ' lowlvl' : ''));
      b.setAttribute('data-deck', id);
      b.innerHTML = deckCoverHTML(id, 34) + '<span class="dk-deck-tx"><b class="iname r-' + S().rarityId(it) + '">' + U.esc(it.name.replace(/ Deck$/, '')) + '</b><small>' +
        (have ? (info.equipped ? 'Equipped' : info.cards + ' / ' + it.deck.size + ' cards') : (lvlOk ? 'Not owned' : 'Lv ' + it.level)) + '</small></span>' +
        (info && info.equipped ? '<em class="dk-eq">✔</em>' : '');
      b.onclick = function () {
        if (!have) { dkSay(it.name + ': ' + deckSource(id) + '.', ''); renderSpells(); return; }
        if (info.equipped) { dkSay('The ' + it.name + ' is already equipped.', ''); renderSpells(); return; }
        dkEquip(id);
      };
      b.onmouseenter = function () { dkPop(b, id, info); };
      b.onmouseleave = dkPopHide;
      row.appendChild(b);
    });
    shelf.appendChild(row);
    return shelf;
  }
  // Hover layers live inside #panel (they close with it); x/y are viewport coordinates
  function dkLayer(key, cls) {
    var pn = el('panel');
    if (!dk[key] || dk[key].parentNode !== pn) { dk[key] = h('div', cls + ' hidden'); pn.appendChild(dk[key]); }
    return dk[key];
  }
  function dkPlace(node, x, y) {
    var pn = el('panel'), r = pn.getBoundingClientRect();
    node.style.left = Math.round(x - r.left - pn.clientLeft) + 'px';
    node.style.top = Math.round(y - r.top - pn.clientTop) + 'px';
  }
  function dkPop(anchor, id, info) {
    var it = D().items[id], r = rar(it), p = S().player;
    dkLayer('popEl', 'dk-pop');
    dk.popEl.innerHTML = '<div class="dk-pop-h">' + deckCoverHTML(id, 40) + '<div><div class="dk-pop-n" style="color:' + r.color + '">' + U.esc(it.name) + '</div>' +
      '<div class="dk-pop-s"><span style="color:' + r.color + '">' + U.esc(r.name) + '</span> · <span class="' + (p.level < it.level ? 'bad' : '') + '">Level ' + it.level + '</span></div></div></div>' +
      '<div class="dk-pop-r">' + deckRulesHTML(id) + '</div>' +
      (info ? '<div class="dk-pop-f">' + (info.equipped ? '<b>Equipped</b> · ' : '') + info.cards + ' cards · ' + info.scrolls + ' scrolls inside' + (info.equipped ? '' : '<br><span class="hint">Click to equip' + (info.cards ? '' : ' (copies your current deck in)') + '</span>') + '</div>'
        : '<div class="dk-pop-f"><span class="hint">' + U.esc(deckSource(id)) + '</span></div>') +
      '<div class="dk-pop-d">' + U.esc(((lore().itemFlavor || {})[id]) || (it.desc || '').replace(it.rules || '', '').trim()) + '</div>';
    dk.popEl.classList.remove('hidden');
    var a = anchor.getBoundingClientRect(), w = dk.popEl.offsetWidth, hh = dk.popEl.offsetHeight;
    var x = Math.min(window.innerWidth - w - 8, Math.max(8, a.left + a.width / 2 - w / 2)), y = a.bottom + 8;
    if (y + hh > window.innerHeight - 8) y = Math.max(8, a.top - hh - 8);
    dkPlace(dk.popEl, x, y);
  }
  function dkPopHide() { if (dk.popEl) dk.popEl.classList.add('hidden'); }

  // ---- left page: the spellbook ----
  function dkLeft(p) {
    var page = h('section', 'dk-page dk-left dk-zone-book');
    var counts = { spells: p.known.length, scrolls: Object.keys(p.tcs).filter(function (k) { return p.tcs[k] > 0 && D().cards[k]; }).length };
    var fut = Object.keys(D().cards).filter(function (cid) { var c = D().cards[cid]; return c.school === p.school && !c.source && (c.level > p.level || p.pendingSpells.indexOf(cid) >= 0); });
    counts.upcoming = fut.length;
    var tabs = [['spells', 'Spells'], ['scrolls', 'Spell Scrolls'], ['upcoming', 'Upcoming']];
    page.innerHTML = '<div class="dk-ph"><span class="dk-title">Spellbook</span><span class="dk-tabs">' + tabs.map(function (t) {
      return '<button class="dk-tab' + (dk.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + ' <small>' + counts[t[0]] + '</small></button>';
    }).join('') + '</span></div>';
    // school + type filters (spells only)
    if (dk.tab !== 'upcoming') {
      var src = dk.tab === 'spells' ? p.known : Object.keys(p.tcs).filter(function (k) { return p.tcs[k] > 0; });
      var schools = ['all'];
      [p.school, 'lumen'].concat(D().playableSchools || []).forEach(function (s) { if (schools.indexOf(s) < 0 && src.some(function (c) { return dkSchoolOf(c) === s; })) schools.push(s); });
      if (schools.indexOf(dk.school) < 0) dk.school = 'all';
      var f = h('div', 'dk-filters');
      f.innerHTML = '<span class="dk-fg">' + schools.map(function (s) {
        var sc = D().schools[s];
        return '<button class="dk-chip' + (dk.school === s ? ' on' : '') + '" data-school="' + s + '"' + (sc ? ' style="--sc:' + sc.color + '"' : '') + '>' + (sc ? '<i></i>' + U.esc(sc.name) : 'All schools') + '</button>';
      }).join('') + '</span><span class="dk-fg">' + DK_TYPE_NAMES.map(function (t) {
        return '<button class="dk-chip t' + (dk.type === t[0] ? ' on' : '') + '" data-type="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</span>';
      page.appendChild(f);
    }
    var grid = h('div', 'dk-grid');
    var r = S().deckRules();
    if (dk.tab === 'spells') {
      var ids = dkSortSpells(p.known.filter(dkPasses), p);
      if (!ids.length) grid.innerHTML = '<p class="dk-empty">' + (p.known.length ? 'No spells match these filters.' : 'You know no spells yet.') + '</p>';
      ids.forEach(function (cid) {
        var n = S().deckCount(cid), chk = S().canAddCard(cid);
        var slot = h('div', 'dk-slot' + (n ? ' in' : '') + (!chk.ok ? ' full' : '') + (S().isOtherSchool(cid) ? ' other' : ''));
        slot.setAttribute('data-card', cid); slot.setAttribute('data-src', 'book'); slot.tabIndex = 0;
        slot.appendChild(UI.cardEl(cid, { small: true, count: n || null }));
        var foot = h('div', 'dk-cfoot', '<span class="dk-dots" title="Copies in your deck">' + dkDots(n, r.maxCopies) + '</span>' +
          (S().isOtherSchool(cid) ? '<em class="dk-tag" title="Counts toward the other-school limit">Trained</em>' : '') +
          (!chk.ok && chk.rule === 'copies' ? '<em class="dk-tag max">MAX</em>' : ''));
        slot.appendChild(foot);
        grid.appendChild(slot);
      });
    } else if (dk.tab === 'scrolls') {
      var tcs = dkSortSpells(Object.keys(p.tcs).filter(function (k) { return p.tcs[k] > 0 && D().cards[k] && dkPasses(k); }), p);
      if (!tcs.length) grid.innerHTML = '<p class="dk-empty">' + (counts.scrolls ? 'No scrolls match these filters.' : 'No Spell Scrolls yet. Enemies drop them, and crafters can scribe them. Put them in your deck’s sideboard to use them in duels — each scroll is used up when cast.') + '</p>';
      tcs.forEach(function (cid) {
        var inSb = S().sideboardCount(cid), chk = S().canAddScroll(cid);
        var slot = h('div', 'dk-slot scroll' + (inSb ? ' in' : '') + (!chk.ok ? ' full' : ''));
        slot.setAttribute('data-card', cid); slot.setAttribute('data-src', 'scrolls'); slot.tabIndex = 0;
        slot.appendChild(UI.cardEl(cid, { small: true, count: p.tcs[cid], tc: true }));
        slot.appendChild(h('div', 'dk-cfoot', '<span class="dk-sbn">In sideboard <b>' + inSb + '</b> / ' + p.tcs[cid] + '</span>'));
        grid.appendChild(slot);
      });
    } else {
      fut.sort(function (a, b) { return D().cards[a].level - D().cards[b].level; });
      if (!fut.length) grid.innerHTML = '<p class="dk-empty">You know every spell of your school in this version of the game.</p>';
      fut.forEach(function (cid) {
        var c = D().cards[cid], pend = p.pendingSpells.indexOf(cid) >= 0;
        var slot = h('div', 'dk-slot future' + (pend ? ' pend' : ''));
        slot.appendChild(UI.cardEl(cid, { small: true, disabled: true }));
        slot.appendChild(h('div', 'dk-cfoot', pend ? '<em class="dk-tag learn">Learn at your trainer</em>' : '<em class="dk-tag">Level ' + c.level + '</em>'));
        grid.appendChild(slot);
      });
    }
    page.appendChild(grid);
    // footer: trainer / training points / how-to
    var tn = (D().npcs[S().trainerId()] || {}).name || 'your trainer', notes = [];
    if (p.pendingSpells.length) notes.push('<b class="dk-hot">✨ ' + p.pendingSpells.length + ' new spell' + (p.pendingSpells.length > 1 ? 's' : '') + '</b> waiting — visit ' + U.esc(tn) + '.');
    if (p.trainingPoints) notes.push('<b>' + p.trainingPoints + ' training point' + (p.trainingPoints > 1 ? 's' : '') + '</b> — spend at other schools’ trainers.');
    if (!notes.length) notes.push(dk.tab === 'scrolls' ? 'Click a scroll to put it in your sideboard · right-click takes one out. Scrolls are used up when cast.' : 'Click a card to copy it into your deck · right-click takes one out · Shift moves every copy · or drag cards between the pages.');
    page.appendChild(h('div', 'dk-foot', notes.join(' ')));
    return page;
  }

  // Small card tile for the deck grid / sideboard (full card on hover)
  function dkMini(cid, opts) {
    var c = D().cards[cid], sc = c && D().schools[c.school];
    var t = h('div', 'dk-mini' + (opts.tc ? ' tc' : '') + (opts.fresh ? ' fresh' : ''));
    t.style.setProperty('--sc', sc ? sc.color : '#999'); t.style.setProperty('--scd', sc ? sc.dark : '#333');
    t.setAttribute('data-card', cid); t.setAttribute('data-src', opts.tc ? 'sideboard' : 'deck'); t.tabIndex = 0;
    if (!c) { t.textContent = '?'; return t; }
    // v1.2 WS8: the card's painted art fills the tile (glyph shrinks to a badge)
    var au = WF.cardArt && WF.cardArt.url(cid);
    if (au) t.classList.add('art');
    t.innerHTML = (au ? '<span class="dk-mart" style="background-image:url(\'' + au + '\')"></span>' : '') +
      '<span class="dk-mp">' + c.pips + '</span><span class="' + (au ? 'dk-mb' : 'dk-mg') + '">' + (TYPE_GLYPH[c.type] || '✦') + '</span><span class="dk-mn">' + U.esc(c.name) + '</span>' + (opts.tc ? '<span class="dk-ms">✦</span>' : '');
    return t;
  }

  // ---- right page: the equipped deck ----
  function dkRight(p) {
    var page = h('section', 'dk-page dk-right');
    var r = S().deckRules(), it = S().equippedDeck(), cards = S().deckCards(), size = S().deckSize();
    var other = S().otherSchoolCount(), sb = S().deckSideboard(), sbn = S().sideboardSize();
    var hasDeck = !!it, fresh = dk.added && Date.now() - dk.added.at < 1500 ? dk.added : null;
    var head = h('div', 'dk-ph dk-rh');
    head.innerHTML = (hasDeck ? deckCoverHTML(it.id, 30) : '') + '<span class="dk-title">' + U.esc(hasDeck ? it.name : 'Your Deck') + '</span>' +
      '<span class="dk-count' + (size >= r.size ? ' full' : '') + (size < r.min ? ' low' : '') + (dk.msgRule === 'size' && Date.now() - dk.msgAt < 2500 ? ' flash' : '') + '" data-rule="size"><b>' + size + '</b> / ' + r.size + '</span>';
    page.appendChild(head);
    // rule chips
    var chips = h('div', 'dk-rules');
    var chip = function (rule, label, val, full) { return '<span class="dk-rule' + (full ? ' full' : '') + (dk.msgRule === rule && Date.now() - dk.msgAt < 2500 ? ' flash' : '') + '" data-rule="' + rule + '">' + label + ' <b>' + val + '</b></span>'; };
    chips.innerHTML = chip('copies', 'Copies per spell', isFinite(r.maxCopies) ? '≤ ' + r.maxCopies : '—') +
      chip('other', 'Other schools', isFinite(r.maxOther) ? other + ' / ' + r.maxOther : other, isFinite(r.maxOther) && other >= r.maxOther) +
      (hasDeck ? chip('scrolls', 'Spell Scrolls', sbn + ' / ' + r.tcSlots, sbn >= r.tcSlots) : '') +
      '<span class="dk-rule dim" title="Cards dealt into your hand each round">Hand <b>' + D().progression.handSize + '</b></span>';
    page.appendChild(chips);
    // notices: migration (once) / below the minimum
    if (dk.notice) {
      var n = dk.notice, nm = (D().items[n.deck] || {}).name || 'deck';
      var txt = n.kind === 'migrated' ? 'Decks are items now! Your deck was copied into your <b>' + U.esc(nm) + '</b>' +
        (n.granted && n.granted.length ? ' and you received: ' + n.granted.map(function (g) { return U.esc((D().items[g] || {}).name || g); }).join(', ') : '') + '.'
        : 'Your <b>' + U.esc(nm) + '</b> was updated to fit its rules.';
      // v2.0 save v5 (F-1): copies that break a deck's rules are moved to another deck, not deleted
      if (n.moved) txt += ' ' + n.moved + ' extra cop' + (n.moved > 1 ? 'ies' : 'y') + ' did not fit its rules, so ' + (n.moved > 1 ? 'they were' : 'it was') + ' moved to your ' +
        (n.movedTo || []).map(function (d) { return '<b>' + U.esc((D().items[d] || {}).name || 'deck') + '</b>'; }).join(' and ') + '.';
      if (n.removed) txt += ' ' + n.removed + ' extra cop' + (n.removed > 1 ? 'ies' : 'y') + ' did not fit any deck — every spell is still in your spellbook.';
      var nb = h('div', 'dk-notice', '<span>' + txt + '</span><button class="dk-x" title="Dismiss">✕</button>');
      nb.querySelector('.dk-x').onclick = function () { dk.notice = null; renderSpells(); };
      page.appendChild(nb);
    } else if (size < r.min) {
      page.appendChild(h('div', 'dk-notice warn', '<span>Your deck has ' + size + ' card' + (size === 1 ? '' : 's') + '. Duels need at least <b>' + r.min + '</b> — until you add more, basic spells are shuffled in for each duel.</span>'));
    }
    // deck grid: one tile per copy, then the empty slots
    var body = h('div', 'dk-rbody');
    var zone = h('div', 'dk-deckgrid dk-zone-deck');
    var order = dkSortSpells(Object.keys(cards), p);
    order.forEach(function (cid) {
      for (var i = 0; i < cards[cid]; i++) zone.appendChild(dkMini(cid, { fresh: fresh && fresh.card === cid && i === cards[cid] - 1 }));
    });
    var empty = isFinite(r.size) ? Math.max(0, r.size - size) : 0;
    for (var e = 0; e < empty; e++) zone.appendChild(h('div', 'dk-mini empty'));
    if (!size) zone.appendChild(h('div', 'dk-hint', 'Click spells on the left page (or drag them here) to copy them into this deck — or press <b>Auto-fill</b>.'));
    body.appendChild(zone);
    // sideboard (W101: treasure cards ride along in the deck)
    var sbh = h('div', 'dk-sbh', '<span>Sideboard <small>Spell Scrolls carried into duels</small></span><b>' + (hasDeck ? sbn + ' / ' + r.tcSlots : 'all') + '</b>');
    body.appendChild(sbh);
    var sbz = h('div', 'dk-sideboard dk-zone-sb');
    if (hasDeck) {
      dkSortSpells(Object.keys(sb), p).forEach(function (cid) {
        for (var i = 0; i < sb[cid]; i++) sbz.appendChild(dkMini(cid, { tc: true, fresh: fresh && fresh.scroll === cid && i === sb[cid] - 1 }));
      });
      for (var j = sbn; j < r.tcSlots; j++) sbz.appendChild(h('div', 'dk-mini tc empty'));
      if (!sbn && !Object.keys(p.tcs).some(function (k) { return p.tcs[k] > 0; })) sbz.appendChild(h('div', 'dk-hint', 'No Spell Scrolls yet.'));
    } else sbz.appendChild(h('div', 'dk-hint', 'All your Spell Scrolls come with you.'));
    body.appendChild(sbz);
    page.appendChild(body);
    // actions + message line
    var act = h('div', 'dk-actions');
    var fill = h('button', 'btn sm primary', '✦ Auto-fill'), clr = h('button', 'btn sm btn-ghost', 'Clear');
    fill.title = 'Fill the free space with your best spells and scrolls'; clr.title = 'Take every card and scroll out of this deck';
    fill.onclick = function () {
      var res = S().autoFillDeck();
      if (!res.cards && !res.scrolls) dkSay(S().deckSize() >= r.size ? 'Your deck is already full.' : 'Nothing more fits the deck’s rules.', 'warn', S().deckSize() >= r.size ? 'size' : null);
      else { dkSay('Auto-fill added ' + res.cards + ' card' + (res.cards === 1 ? '' : 's') + (res.scrolls ? ' and ' + res.scrolls + ' scroll' + (res.scrolls === 1 ? '' : 's') : '') + '.', 'ok'); WF.sfx.play('card_draw'); }
      dkSaved();
    };
    clr.onclick = function () {
      if (!S().deckSize() && !S().sideboardSize()) { dkSay('Your deck is already empty.', ''); renderSpells(); return; }
      var n = S().clearDeck();
      dkSay('Cleared ' + n + ' card' + (n === 1 ? '' : 's') + '. Your spells are still in your spellbook.', '');
      WF.sfx.play('click');
      dkSaved();
    };
    act.appendChild(fill); act.appendChild(clr);
    var fresh2 = dk.msg && Date.now() - dk.msgAt < 6000;
    act.appendChild(h('div', 'dk-msg' + (fresh2 ? ' show ' + dk.msgKind : ''), fresh2 ? U.esc(dk.msg) : ''));
    page.appendChild(act);
    return page;
  }

  function renderSpells() {
    var p = S().player, body = el('sp-body');
    if (!body || !p) return;
    var lg = body.querySelector('.dk-grid'), rg = body.querySelector('.dk-rbody');
    if (lg) dk.scroll.left = lg.scrollTop;
    if (rg) dk.scroll.right = rg.scrollTop;
    if (!dk.notice && S().takeDeckNotice) { var n = S().takeDeckNotice(); if (n) { dk.notice = n; S().save(); } }
    dkPeekHide(); dkPopHide();
    var book = h('div', 'dk-book' + (S().equippedDeck() ? '' : ' nodecks'));
    if (S().equippedDeck()) book.appendChild(dkShelf(p));
    var spread = h('div', 'dk-spread');
    spread.appendChild(dkLeft(p));
    spread.appendChild(h('div', 'dk-spine'));
    spread.appendChild(dkRight(p));
    book.appendChild(spread);
    body.innerHTML = '';
    body.appendChild(book);
    var lg2 = body.querySelector('.dk-grid'), rg2 = body.querySelector('.dk-rbody');
    if (lg2) lg2.scrollTop = dk.scroll.left;
    if (rg2) rg2.scrollTop = dk.scroll.right;
    dkBind(book);
  }
  UI.renderSpells = renderSpells;   // tests / other panels

  // ---- input: click, right-click, keyboard, drag and drop, hover preview ----
  function dkBind(book) {
    book.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { dk.tab = b.getAttribute('data-tab'); dk.school = 'all'; WF.sfx.play('click'); renderSpells(); }; });
    book.querySelectorAll('[data-school]').forEach(function (b) { b.onclick = function () { dk.school = b.getAttribute('data-school'); renderSpells(); }; });
    book.querySelectorAll('[data-type]').forEach(function (b) { b.onclick = function () { dk.type = b.getAttribute('data-type'); renderSpells(); }; });
    book.querySelectorAll('[data-src]').forEach(function (n) {
      n.addEventListener('pointerdown', dkDown);
      n.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var cid = n.getAttribute('data-card'), src = n.getAttribute('data-src');
        if (src === 'book' || src === 'deck') { if (!dkRemove(cid, e.shiftKey)) { dkSay(D().cards[cid].name + ' is not in your deck.', ''); renderSpells(); } }
        else if (!dkRemoveScroll(cid)) { dkSay(D().cards[cid].name + ' is not in your sideboard.', ''); renderSpells(); }
      });
      n.addEventListener('keydown', function (e) {
        if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'Delete' && e.code !== 'Backspace') return;
        e.preventDefault(); e.stopPropagation();
        var cid = n.getAttribute('data-card'), src = n.getAttribute('data-src'), del = e.code === 'Delete' || e.code === 'Backspace';
        if (src === 'book') { if (del) dkRemove(cid, e.shiftKey); else dkAdd(cid, e.shiftKey); }
        else if (src === 'scrolls') { if (del) dkRemoveScroll(cid); else dkAddScroll(cid); }
        else if (src === 'deck') dkRemove(cid, e.shiftKey); else dkRemoveScroll(cid);
        var again = el('sp-body') && el('sp-body').querySelector('[data-src="' + src + '"][data-card="' + cid + '"]');
        if (again) again.focus();
      });
      if (n.classList.contains('dk-mini')) {
        n.addEventListener('mouseenter', function (e) { if (!dk.drag) dkPeek(n.getAttribute('data-card'), n, n.getAttribute('data-src') === 'sideboard'); });
        n.addEventListener('mouseleave', dkPeekHide);
      }
    });
  }
  // Full-size card next to a hovered deck tile
  function dkPeek(cid, anchor, tc) {
    dkLayer('peekEl', 'dk-peek');
    dk.peekEl.innerHTML = '';
    dk.peekEl.appendChild(UI.cardEl(cid, { tc: tc }));
    dk.peekEl.appendChild(h('div', 'dk-peek-h', tc ? 'Click or drag out: back to your satchel' : 'Click or drag out: take this copy out'));
    dk.peekEl.classList.remove('hidden');
    var a = anchor.getBoundingClientRect(), w = dk.peekEl.offsetWidth || 150, hh = dk.peekEl.offsetHeight || 230;
    var x = a.left - w - 14; if (x < 8) x = a.right + 14;
    var y = Math.min(window.innerHeight - hh - 8, Math.max(8, a.top + a.height / 2 - hh / 2));
    dkPlace(dk.peekEl, x, y);
  }
  function dkPeekHide() { if (dk.peekEl) dk.peekEl.classList.add('hidden'); }

  // Pointer-based drag and drop (works the same with mouse, pen and touch)
  function dkDown(e) {
    if (e.button !== 0) return;
    var n = e.currentTarget;
    dk.drag = { node: n, cid: n.getAttribute('data-card'), src: n.getAttribute('data-src'), x: e.clientX, y: e.clientY, on: false, ghost: null, pid: e.pointerId };
    window.addEventListener('pointermove', dkMove, true);
    window.addEventListener('pointerup', dkUp, true);
    window.addEventListener('pointercancel', dkCancel, true);
  }
  function dkTargetFor(src) { return src === 'book' ? 'deck' : src === 'scrolls' ? 'sb' : 'book'; }
  function dkZoneAt(x, y) {
    var t = document.elementFromPoint(x, y);
    if (!t || !t.closest) return null;
    if (t.closest('.dk-zone-sb')) return 'sb';
    if (t.closest('.dk-zone-deck') || t.closest('.dk-right')) return 'deck';
    if (t.closest('.dk-zone-book')) return 'book';
    return null;
  }
  function dkMove(e) {
    var d = dk.drag; if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7) return;
      d.on = true;
      dkPeekHide(); dkPopHide(); hideTip();
      var g = h('div', 'dk-ghost');
      if (d.src === 'book' || d.src === 'scrolls') g.appendChild(UI.cardEl(d.cid, { small: true, tc: d.src === 'scrolls' }));
      else g.appendChild(dkMini(d.cid, { tc: d.src === 'sideboard' }));
      g.appendChild(h('div', 'dk-ghost-l', ''));
      document.body.appendChild(g);
      d.ghost = g;
      document.body.classList.add('dk-dragging');
      d.node.classList.add('dk-lift');
      var want = dkTargetFor(d.src), book = el('sp-body');
      var tgt = book && book.querySelector(want === 'deck' ? '.dk-zone-deck' : want === 'sb' ? '.dk-zone-sb' : '.dk-zone-book');
      var ok = d.src === 'book' ? S().canAddCard(d.cid) : d.src === 'scrolls' ? S().canAddScroll(d.cid) : { ok: true };
      d.ok = ok;
      if (tgt) tgt.classList.add(ok.ok ? 'dk-drop' : 'dk-drop-bad');
    }
    d.ghost.style.transform = 'translate(' + (e.clientX - 40) + 'px,' + (e.clientY - 50) + 'px) rotate(-4deg)';
    var over = dkZoneAt(e.clientX, e.clientY), want2 = dkTargetFor(d.src), lab = d.ghost.querySelector('.dk-ghost-l');
    d.ghost.classList.toggle('over', over === want2);
    d.ghost.classList.toggle('bad', over === want2 && !d.ok.ok);
    lab.textContent = over === want2 ? (d.ok.ok ? (d.src === 'book' ? 'Copy into deck' : d.src === 'scrolls' ? 'Add to sideboard' : 'Take out') : d.ok.reason) :
      (d.src === 'book' ? 'Drop on your deck' : d.src === 'scrolls' ? 'Drop on the sideboard' : 'Drop on the spellbook');
  }
  function dkEnd() {
    var d = dk.drag; dk.drag = null;
    window.removeEventListener('pointermove', dkMove, true);
    window.removeEventListener('pointerup', dkUp, true);
    window.removeEventListener('pointercancel', dkCancel, true);
    if (d && d.ghost) d.ghost.remove();
    document.body.classList.remove('dk-dragging');
    document.querySelectorAll('.dk-drop, .dk-drop-bad, .dk-lift').forEach(function (n) { n.classList.remove('dk-drop', 'dk-drop-bad', 'dk-lift'); });
    return d;
  }
  function dkCancel() { dkEnd(); }
  function dkUp(e) {
    var d = dkEnd(); if (!d) return;
    if (!d.on) {      // a click (Shift: every copy)
      if (d.src === 'book') dkAdd(d.cid, e.shiftKey);
      else if (d.src === 'scrolls') dkAddScroll(d.cid);
      else if (d.src === 'deck') dkRemove(d.cid, e.shiftKey);
      else dkRemoveScroll(d.cid);
      return;
    }
    var zone = dkZoneAt(e.clientX, e.clientY);
    if (zone !== dkTargetFor(d.src)) { renderSpells(); return; }
    if (d.src === 'book') dkAdd(d.cid);
    else if (d.src === 'scrolls') dkAddScroll(d.cid);
    else if (d.src === 'deck') dkRemove(d.cid);
    else dkRemoveScroll(d.cid);
  }
  UI._dk = dk;   // tests / screenshots
  UI._dkMove = { add: dkAdd, remove: dkRemove };   // v2.1 tests (Shift = every copy)
  UI._dkMini = dkMini;   // v1.2 WS8: tests/lab-cards.html shows the deck tiles with art

  // Toasts for deck events that happen outside the book (shop, loot, trainer)
  if (WF.state && WF.state.on) WF.state.on(function (type, e) {
    if (type !== 'deck' || !e || !WF.ui || !WF.state.player) return;
    var nm = function (id) { return itemNameHTML(id); };
    if (e.kind === 'new') UI.toast('New deck: ' + nm(e.id) + '! Open your Spellbook (<b>K</b>) to equip it.', 'quest', 5200);
    else if (e.kind === 'duplicate') UI.toast('You already own the ' + nm(e.id) + ' — the spare sold for <b class="gold">' + U.fmt(e.gold) + ' g</b>.', 'info', 4600);
    else if (e.kind === 'nofit') {
      var c = D().cards[e.card], dn = (D().items[e.deck] || {}).name || 'deck';
      UI.toast(e.added ? 'Only ' + e.added + ' of ' + e.wanted + ' copies of <b>' + U.esc(c ? c.name : e.card) + '</b> fit your ' + U.esc(dn) + '.'
        : 'No room for <b>' + U.esc(c ? c.name : e.card) + '</b> in your ' + U.esc(dn) + ' — open your Spellbook (<b>K</b>) to make room.', 'warn', 5200);
    }
  });

  // ---- Items: rarity, icons, tooltips (v1.1) ----
  var STAT_NAMES = { hp: 'Health', mana: 'Mana', dmg: 'Damage', resist: 'Resist', acc: 'Accuracy', brightPip: 'Bright Pip', pipSurge: 'Pip Surge' };
  var STAT_ORDER = ['hp', 'mana', 'dmg', 'resist', 'acc', 'brightPip', 'pipSurge'];
  // ---- v2.0 M1 (WS-A): per-school stats, e.g. dmg_emberstrike -> "Emberstrike Damage" (schools.js)
  (D().schoolStatKeys || []).forEach(function (k) {
    var sp = D().splitSchoolStat(k), sc = D().schools[sp.school];
    STAT_NAMES[k] = sc.name + ' ' + D().schoolStatNames[sp.kind];
    STAT_ORDER.push(k);
  });
  // ---- v1.2 WS2: stat tooltips (docs/V1.2-CONTRACT.md §2.1) + endgame set labels
  var STAT_TIPS = { brightPip: 'Chance each new pip is a bright pip worth 2.', pipSurge: 'Chance to gain 2 pips in one round.' };
  var SET_NAMES = { starbound: 'Starbound', artificer: 'Artificer' };
  var CRAFTED_COLOR = '#e0b456';
  function statLabel(k) { return STAT_TIPS[k] ? '<span title="' + U.esc(STAT_TIPS[k]) + '">' + STAT_NAMES[k] + '</span>' : '<span>' + STAT_NAMES[k] + '</span>'; }
  function craftedTag(it) { return it && it.crafted ? ' <span class="rar" style="color:' + CRAFTED_COLOR + '" title="Crafted only: made by a crafter, never dropped">Crafted</span>' : ''; }
  // Who crafts this item (recipes that make it or its base item)
  function craftedBy(id) {
    var R = D().recipes || {}, base = Object.keys(D().items).filter(function (k) { var v = D().items[k].variants; return v && Object.keys(v).some(function (s) { return v[s] === id; }); })[0];
    for (var rid in R) { var m = R[rid].makes || {}; if (m.item === id || (base && m.item === base)) return D().npcs[R[rid].npc] || null; }
    return null;
  }
  // Named enemy sources of a gear piece (signature drops), e.g. "Nyx (30%)"
  function dropSources(id) {
    var E = D().enemies || {}, base = Object.keys(D().items).filter(function (k) { var v = D().items[k].variants; return v && Object.keys(v).some(function (s) { return v[s] === id; }); })[0], out = [];
    Object.keys(E).forEach(function (eid) {
      ((E[eid].loot || {}).gear || []).forEach(function (d) { if (d.item === id || d.item === base) out.push(U.esc(E[eid].name.split(',')[0]) + ' (' + Math.round(d.chance * 100) + '%)'); });
    });
    return out;
  }
  // ---- v1.2 WS2: tiers T1/T2/T3, set bonuses, school-only gear, upgrade/salvage
  // (docs/V1.2-CONTRACT.md §6.1, §6.3). Pure HTML helpers for the tooltip,
  // the backpack and Tamsin's panel.
  var TIER_COLORS = { 1: '#cfd8ff', 2: '#ffe08a', 3: '#ff9ef0' };
  var OFF_SCHOOL_RED = '#ff7a6a';
  function tierTag(it) {
    var T = D().gearTiers;
    return it && it.tier && it.set && T && T[it.tier] ? '<span style="color:' + TIER_COLORS[it.tier] + ';font-weight:800">' + T[it.tier].name + '</span>' : '';
  }
  function offSchool(it) { var p = S().player; return !!(it && it.type === 'gear' && it.school && p && it.school !== p.school); }
  function schoolName(s) { return (D().schools[s] || {}).name || s; }
  function bankAvailable() { return typeof S().deposit === 'function'; }
  // "a Stoneward" / "an Emberstrike" (v1.2 WS9 grammar fix)
  function aSchool(sc) { var n = schoolName(sc); return (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + U.esc(n); }
  // "Stoneward only" in red + what to do with it
  function offSchoolHTML(it) {
    if (!offSchool(it)) return '';
    return '<div class="it-note" style="color:' + OFF_SCHOOL_RED + ';font-weight:800;font-size:.8em">' + U.esc(schoolName(it.school)) + ' only: your ' + U.esc(schoolName(S().player.school)) + ' wizard can\'t wear it</div>' +
      '<div class="it-note">' + (bankAvailable() ? 'Send it to the Bank for ' + aSchool(it.school) + ' wizard, salvage it at Tamsin, or sell it.' : 'Keep it for ' + aSchool(it.school) + ' wizard, salvage it at Tamsin, or sell it.') + '</div>';
  }
  // a set bonus's label for the player's school (e.g. Stoneward's 4-piece Starbound also adds resist)
  function bonusText(b) { var sc = S().player && S().player.school; return (b.schoolText && b.schoolText[sc]) || b.text; }
  // Set progress + every bonus of the item's set (active ones in green)
  function setBlockHTML(id) {
    var it = D().items[id], SETS = D().gearSets || {}, def = it && SETS[it.set], p = S().player;
    if (!def || !S().setBonusFor) return '';
    var now = S().setBonuses().sets[it.set], cnt = now ? now.count : 0, max = def.maxCount || 5;
    var eq = {}; Object.keys(p.equipped).forEach(function (k) { eq[k] = p.equipped[k]; }); eq[it.slot] = id;
    var w = S().setBonusFor(S().equippedIds(eq), p.school).sets[it.set], cnt2 = w ? w.count : cnt;
    var next = (def.bonuses || []).filter(function (b) { return b.count > cnt; })[0];
    var head = next ? U.esc(def.name) + ' ' + cnt + '/' + next.count + ': next bonus ' + U.esc(bonusText(next)) : U.esc(def.name) + ' ' + cnt + '/' + max + ': every bonus active';
    var html = '<div style="margin-top:6px;padding:5px 8px;border-radius:8px;background:rgba(160,130,255,.10);border:1px solid rgba(190,170,255,.22);font-size:.76em">' +
      '<div style="font-weight:800;color:#e8e0ff">' + head + (cnt2 > cnt && !offSchool(it) ? ' <span style="color:#6dff8a">(' + cnt2 + '/' + max + ' with this)</span>' : '') + '</div>' +
      (def.bonuses || []).map(function (b) {
        var on = cnt >= b.count;
        return '<div style="color:' + (on ? '#6dff8a' : '#9a92bc') + '">' + (on ? '✔ ' : '· ') + b.count + ' pieces: ' + U.esc(bonusText(b)) + '</div>';
      }).join('') +
      (it.set === 'starbound' ? '<div style="color:#9a92bc">Starwalker Greaves count as Starbound (up to 4 pieces).</div>' : '') +
      (offSchool(it) ? '<div style="color:' + OFF_SCHOOL_RED + '">Only pieces of your own school count.</div>' : '') + '</div>';
    return html;
  }
  // Where a tier comes from / what Tamsin can do with it
  function tierInfoHTML(id) {
    var it = D().items[id]; if (!it || !it.tier || !it.set) return '';
    var out = [], nx = it.next && D().items[it.next], salv = S().salvageValue ? S().salvageValue(id) : 0;
    if (it.tier === 3) out.push('Made only by upgrading at <b>Tamsin</b>.');
    if (nx) out.push('<b>Tamsin</b> can upgrade it to <span style="color:' + TIER_COLORS[nx.tier] + '">' + U.esc(nx.name) + '</span>.');
    if (salv) out.push('Salvages into ' + salv + ' Starlight Essence.');
    return out.length ? '<div class="it-look">' + out.join(' ') + '</div>' : '';
  }
  // Active set bonuses of the worn gear (backpack, under the stats)
  function packSetsHTML() {
    if (!S().setBonuses) return '';
    var sets = S().setBonuses().sets, ids = Object.keys(sets);
    if (!ids.length) return '';
    return '<div style="margin:6px 2px 0;font-size:.78em;color:#d8d0f0">' + ids.map(function (k) {
      var x = sets[k], act = x.active.map(function (b) { return U.esc(bonusText(b)); }).join(', ');
      return '<div><b style="color:#e8e0ff">' + U.esc(x.name) + ' ' + x.count + '/' + x.max + '</b>: ' + (act ? '<span style="color:#6dff8a">' + act + '</span>' : '<span class="dim">no bonus yet</span>') +
        (x.next ? ' <span class="dim">· next at ' + x.next.count + ': ' + U.esc(bonusText(x.next)) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  // Stat rows "before -> after" with deltas (upgrade previews)
  function compareRowsHTML(fromId, toId) {
    var a = (D().items[fromId] || {}).stats || {}, b = (D().items[toId] || {}).stats || {};
    return '<div class="it-stats">' + STAT_ORDER.filter(function (k) { return a[k] || b[k]; }).map(function (k) {
      var unit = (k === 'hp' || k === 'mana') ? '' : '%', d = (b[k] || 0) - (a[k] || 0);
      return '<div class="it-stat" style="grid-template-columns:1fr 54px 54px 58px">' + statLabel(k) + '<b style="color:#bdb4dc;font-weight:600">' + (a[k] ? '+' + a[k] + unit : '—') + '</b><b>' + (b[k] ? '+' + b[k] + unit : '—') + '</b>' +
        (d ? '<i class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ ') + d + unit + '</i>' : '<i></i>') + '</div>';
    }).join('') + '</div>';
  }
  var SLOT_NAMES = { hat: 'Hat', robe: 'Robe', boots: 'Boots', wand: 'Wand', amulet: 'Amulet', mount: 'Mount' };
  function rar(it) { return S().rarity(it); }
  function rarColor(it) { return rar(it).color || '#d8d8d8'; }
  // Item name in its rarity colour (trusted HTML)
  function itemNameHTML(id, extraCls) {
    var it = D().items[id];
    if (!it) return U.esc(id);
    return '<span class="iname r-' + S().rarityId(it) + (extraCls ? ' ' + extraCls : '') + '" style="color:' + rarColor(it) + '">' + U.esc(it.name) + '</span>';
  }
  function rarityTag(it) {
    if (!it || (it.type !== 'gear' && it.type !== 'mount')) return '';
    var r = rar(it);
    return ' <span class="rar" style="color:' + r.color + '">' + U.esc(r.name) + '</span>';
  }
  function statsText(s) {
    if (!s) return '';
    return STAT_ORDER.filter(function (k) { return s[k]; }).map(function (k) { return '+' + s[k] + (k === 'hp' || k === 'mana' ? ' ' : '% ') + STAT_NAMES[k]; }).join(', ');
  }
  function lookColors(it) {
    var p = S().player, sc = (p && D().schools[p.school]) || {}, l = it.look || {};
    var def = { hat: sc.hat, robe: sc.robe, boots: '#6a4a2a', wand: '#8a6a3a', amulet: '#e8c87a' };
    if (it.type === 'mount') { var m = it.mount || {}; return { c1: m.coat || '#8a5a2b', c2: m.mane || '#3a2010', gem: m.gem || m.trim || '#ffd76a' }; }
    if (it.type === 'potion') return { c1: it.color || '#ff5a6a', c2: '#ffffff', gem: '#ffffff' };
    if (it.type === 'reagent') return { c1: it.color || '#c9b07a', c2: '#ffffff', gem: '#ffffff' };
    return { c1: l.color || def[it.slot] || '#8a7aff', c2: l.color2 || sc.trim || '#ffd76a', gem: l.gem || sc.color || '#ffd76a' };
  }
  // Darken (f < 0) or lighten (f > 0) a #hex colour for icon shading
  function shadeHex(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex;
    var n = parseInt(m[1], 16), r = n >> 16, g2 = (n >> 8) & 255, b = n & 255, t = f < 0 ? 0 : 255, a = Math.abs(f);
    function c(v) { return Math.round(v + (t - v) * a); }
    return '#' + ((1 << 24) + (c(r) << 16) + (c(g2) << 8) + c(b)).toString(16).slice(1);
  }
  // Small inline SVG icon per item kind, painted in the item's look colours.
  // Gear icons follow look.style so the icon matches the 3D model (contract §4.2 styles).
  function itemIcon(id, size) {
    var it = D().items[id]; if (!it) return '';
    var k = it.type === 'gear' ? it.slot : it.type;
    return iconSVG(k, (it.look && it.look.style) || '', lookColors(it), size);
  }
  function iconSVG(k, st, c, size) {
    var body, d1 = shadeHex(c.c1, -0.32), l1 = shadeHex(c.c1, 0.22), ln = ' stroke-linejoin="round"';
    var gem = '<circle cx="__X" cy="__Y" r="__R" fill="' + c.gem + '" stroke="#fff" stroke-width=".6"/>';
    function g(x, y, r) { return gem.replace('__X', x).replace('__Y', y).replace('__R', r); }
    function brim(rx, ry, y) { return '<ellipse cx="12" cy="' + (y || 17) + '" rx="' + rx + '" ry="' + ry + '" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>'; }
    if (k === 'hat') {
      if (st === 'crown') body = '<path d="M4 17 L5 8 L9 12 L12 5 L15 12 L19 8 L20 17 Z" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width="1.2"' + ln + '/><rect x="4" y="16" width="16" height="3" rx="1" fill="' + c.c2 + '"/>' + g(12, 13, 1.8) + g(5, 8, 0.9) + g(19, 8, 0.9);
      else if (st === 'circlet') body = '<path d="M3.5 13 C6 18 18 18 20.5 13" stroke="' + c.c2 + '" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M3.5 13 C6 9.5 18 9.5 20.5 13" stroke="' + shadeHex(c.c2, -0.35) + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
        '<path d="M12 11 L14.2 14.5 L12 18.5 L9.8 14.5 Z" fill="' + c.c2 + '" stroke="#fff" stroke-width=".5"/>' + g(12, 14.6, 1.6);
      else if (st === 'hood') body = '<path d="M12 3 C6 4 4 10 5 20 L19 20 C20 10 18 4 12 3 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/><path d="M8 20 C8 12.5 16 12.5 16 20 Z" fill="#1d1626" opacity=".7"/><circle cx="12" cy="16.5" r="2.6" fill="#f2d2b6" opacity=".9"/><path d="M5 20 L19 20" stroke="' + c.c2 + '" stroke-width="1.6"/>';
      else if (st === 'cowl') body = '<path d="M13 1.5 C7 4.5 4 11 4 21 L20 21 C20 12 18 6 13 1.5 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/><path d="M13 1.5 C14 6 16 9 17 12" stroke="' + l1 + '" stroke-width=".9" fill="none"/>' +
        '<path d="M7 21 C7 11 17 11 17 21 Z" fill="#0d0a14"/><circle cx="10.4" cy="16" r="1" fill="' + c.gem + '"/><circle cx="13.6" cy="16" r="1" fill="' + c.gem + '"/><path d="M4 21 L20 21" stroke="' + c.c2 + '" stroke-width="1.6"/>';
      else if (st === 'helm') body = '<path d="M5 15 C5 7 19 7 19 15 L19 19 L5 19 Z" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width="1.2"/><rect x="11" y="9" width="2" height="9" fill="' + c.c2 + '"/><path d="M12 4 C15 4 17 6 16 9" stroke="' + c.gem + '" stroke-width="2" fill="none"/>';
      else if (st === 'horned') body = '<path d="M7 16 L9 7 L12 5 L15 7 L17 16 Z" fill="' + c.c1 + '"/><path d="M8 10 C4 9 3 5 4 3 C6 6 8 7 9 8 M16 10 C20 9 21 5 20 3 C18 6 16 7 15 8" fill="' + c.c2 + '" stroke="' + c.c2 + '"/><ellipse cx="12" cy="17" rx="9" ry="2.6" fill="' + c.c1 + '"/>' + g(12, 12, 1.6);
      else if (st === 'feathered') body =
        // big plume sweeping back over the crown, wide floppy brim, rounded crown with band + gem
        '<path d="M15.5 12.5 C16 7 19 3.5 23 2.5 C21.5 5 21 8 18.5 11.5 Z" fill="' + c.c2 + '" stroke="' + shadeHex(c.c2, -0.3) + '" stroke-width=".6"/><path d="M16.2 12 C17.5 8 19.5 5.5 22 3.6" stroke="' + shadeHex(c.c2, -0.35) + '" stroke-width=".6" fill="none"/>' +
        '<path d="M1 16.5 C2 13.5 7 13 12 13 C17 13 22 13.5 23 16.5 C22 19.5 17 20 12 20 C7 20 2 19.5 1 16.5 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>' +
        '<path d="M6.5 16 C6.5 8.5 17.5 8.5 17.5 16 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/><path d="M8.5 11 C9.5 9.6 11 9.3 12 9.4" stroke="' + l1 + '" stroke-width=".9" fill="none"/>' +
        '<path d="M6.6 14.2 C9 15.2 15 15.2 17.4 14.2 L17.5 16 C15 17 9 17 6.5 16 Z" fill="' + c.c2 + '"/>' + g(15.2, 15.3, 1.3);
      else if (st === 'wide') body = '<path d="M13 4 C11.5 7 10 10 8.5 14.5 L15.5 14.5 C14.6 11 14.6 8 15.8 5.5 C15 5 14 4.6 13 4 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>' +
        '<path d="M0.8 17.5 C1.5 14.5 6 14 12 14 C18 14 22.5 14.5 23.2 17.5 C22 19 20 18.4 18 19.2 C15 20.3 9 20.3 6 19.2 C4 18.4 2 19 0.8 17.5 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>' +
        '<rect x="8.3" y="12.6" width="7.4" height="2.1" fill="' + c.c2 + '"/>' + g(12, 13.6, 1.2);
      else if (st === 'tall') body = '<path d="M8 17 L10.6 7 C11.2 3.5 13 1.2 16 1.4 C18.3 1.6 19 3.8 17.4 4.6 C16.4 3.6 14.8 3.6 14.4 5.6 L15.8 17 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"' + ln + '/>' + g(17.6, 4.4, 1.2) +
        brim(8.6, 2.5) + '<rect x="8.4" y="13.6" width="7.4" height="2.1" fill="' + c.c2 + '"/>' + g(12, 14.6, 1.2);
      else body = '<path d="M7 16 C9 11 10 7 12 4 C13 2.5 15.5 2 17.5 3 C15.5 3.8 14.3 5.6 14.6 9 L17 16 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"' + ln + '/>' +
        brim(9.5, 2.8) + '<rect x="7.5" y="13.4" width="9" height="2.2" fill="' + c.c2 + '"/>' + g(12, 14.5, 1.3);
    } else if (k === 'robe') {
      var sleeves = '<path d="M7.5 6.5 L3.5 13 L6 14 L8.8 9.5 M16.5 6.5 L20.5 13 L18 14 L15.2 9.5" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width=".6"/>';
      if (st === 'layered') body = sleeves + '<path d="M9 3 L15 3 L16.5 7 L18 11 L6 11 L7.5 7 Z" fill="' + c.c1 + '"/>' +
        '<path d="M6.5 10 L17.5 10 L19.5 15.5 L4.5 15.5 Z" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width=".9"/><path d="M5 14.5 L19 14.5 L21 21 L3 21 Z" fill="' + d1 + '" stroke="' + c.c2 + '" stroke-width=".9"/>' +
        '<path d="M4.5 15.5 L19.5 15.5 M3 21 L21 21" stroke="' + c.c2 + '" stroke-width="1.5"/>' + g(12, 7.5, 1.3);
      else if (st === 'long') body = sleeves + '<path d="M9 3 L15 3 L16.5 7 L17.5 21.5 L6.5 21.5 L7.5 7 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".6"/>' +
        '<path d="M10.2 7.5 L13.8 7.5 L13.8 21.5 L10.2 21.5 Z" fill="' + c.c2 + '"/><path d="M10.2 18 L12 20 L13.8 18" stroke="' + d1 + '" stroke-width=".7" fill="none"/>' + g(12, 10, 1.4);
      else if (st === 'armored') body = sleeves + '<path d="M9 3 L15 3 L17 7 L19.5 20 L4.5 20 L7 7 Z" fill="' + c.c1 + '"/>' +
        '<path d="M7.6 8 L16.4 8 L16.8 15 L7.2 15 Z" fill="' + c.c2 + '" stroke="' + shadeHex(c.c2, -0.4) + '" stroke-width=".7"/><path d="M7.4 10.4 L16.6 10.4 M7.3 12.7 L16.7 12.7" stroke="' + shadeHex(c.c2, -0.4) + '" stroke-width=".6"/>' +
        '<ellipse cx="6.4" cy="7.4" rx="3" ry="2.3" fill="' + c.c2 + '" stroke="' + shadeHex(c.c2, -0.4) + '" stroke-width=".7"/><ellipse cx="17.6" cy="7.4" rx="3" ry="2.3" fill="' + c.c2 + '" stroke="' + shadeHex(c.c2, -0.4) + '" stroke-width=".7"/>' +
        '<path d="M4.5 20 L19.5 20" stroke="' + c.c2 + '" stroke-width="1.8"/>' + g(12, 11.6, 1.5);
      else if (st === 'mantle') body = '<path d="M7 5 L2 22 L22 22 L17 5 Z" fill="' + d1 + '"/>' + sleeves + '<path d="M9 3 L15 3 L16.5 7 L18.5 20 L5.5 20 L7.5 7 Z" fill="' + c.c1 + '"/>' +
        '<path d="M5.5 6.5 C8 4 16 4 18.5 6.5 L17 10 C14 8.5 10 8.5 7 10 Z" fill="' + c.c2 + '" stroke="' + shadeHex(c.c2, -0.35) + '" stroke-width=".6"/><path d="M8 4.5 L7 1.8 L10 3.5 M16 4.5 L17 1.8 L14 3.5" fill="' + c.c2 + '" stroke="' + c.c2 + '" stroke-width=".8"/>' +
        '<path d="M5.5 20 L18.5 20" stroke="' + c.c2 + '" stroke-width="1.6"/>' + g(12, 8.4, 1.4);
      else if (st === 'battle') body = sleeves + '<path d="M9 3 L15 3 L17 7 L18.5 16.5 L5.5 16.5 L7 7 Z" fill="' + c.c1 + '"/>' +
        '<path d="M7 9.5 L17 9.5 L17.4 12 L6.6 12 Z" fill="' + shadeHex(c.c2, -0.45) + '"/><rect x="10.6" y="9.2" width="2.8" height="3.1" rx=".5" fill="' + c.c2 + '"/>' +
        '<path d="M8.2 4 L16.8 12.8 L15.4 14 L7 5.4 Z" fill="' + c.c2 + '" opacity=".95"/><path d="M5.5 16.5 L18.5 16.5" stroke="' + c.c2 + '" stroke-width="1.8"/>' +
        '<path d="M7.5 16.5 L7 21 L10.5 21 L10.5 16.5 M13.5 16.5 L13.5 21 L17 21 L16.5 16.5" fill="' + d1 + '"/>' + g(12, 10.8, 1.1);
      else body = sleeves + '<path d="M9 3 L15 3 L17 7 C18 12 19.5 17 21 21 L3 21 C4.5 17 6 12 7 7 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".6"/>' +
        '<rect x="7.5" y="10" width="9" height="1.6" fill="' + c.c2 + '"/><path d="M3 21 L21 21" stroke="' + c.c2 + '" stroke-width="1.8"/>' + g(12, 10.8, 1.4);
    } else if (k === 'boots') {
      var sd = shadeHex(c.c2, -0.35);
      if (st === 'slippers' || !st) body = '<path d="M4 14 C4 11 7 10.5 9 11.5 C12 13 16 13.5 19.5 14 C22 14.5 22 18 19 18.5 L5 18.5 C3.8 18.5 3.6 16 4 14 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>' +
        '<path d="M4.2 12.8 C6 12 8 12.2 9.5 13.2" stroke="' + c.c2 + '" stroke-width="1.4" fill="none"/><path d="M4 18.5 L19.5 18.5" stroke="' + c.c2 + '" stroke-width="1.3"/>' + g(15.5, 14.6, 1.1);
      else if (st === 'curled') body = '<path d="M5 9 L11 9 L11.5 13 C14 13.5 16 14 17.5 15 C18.5 13 21 11 22 13 C22.6 14.4 21 15 20.2 14.3 C20 16.5 19 18.5 17 18.5 L5 18.5 C4 18.5 4 12 5 9 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".7"/>' +
        '<rect x="4.8" y="8.6" width="6.6" height="2.4" rx=".8" fill="' + c.c2 + '"/><path d="M4.6 18.5 L18 18.5" stroke="' + c.c2 + '" stroke-width="1.3"/>' + g(21, 13.2, 1);
      else if (st === 'greaves') body = '<path d="M6 3 L12 3 L12 13 L18 15 C21 16 21 20 19 20 L5 20 Z" fill="' + c.c1 + '"/>' +
        '<path d="M5.3 3.5 L12.7 3.5 L12.7 13 L5.3 13 Z" fill="' + c.c2 + '" stroke="' + sd + '" stroke-width=".7"/><path d="M5.3 6.6 L12.7 6.6 M5.3 9.8 L12.7 9.8" stroke="' + sd + '" stroke-width=".7"/>' +
        '<path d="M12 14.5 L17 15.6" stroke="' + c.c2 + '" stroke-width="1.6"/><path d="M5 20 L19 20" stroke="' + c.c2 + '" stroke-width="1.5"/>' + g(9, 8.2, 1.1);
      else body = '<path d="M6 3 L12 3 L12 13 L18 15 C21 16 21 20 19 20 L5 20 Z" fill="' + c.c1 + '" stroke="' + d1 + '" stroke-width=".6"/>' +
        '<rect x="5.5" y="3" width="7" height="3" fill="' + c.c2 + '"/><path d="M5 20 L19 20" stroke="' + c.c2 + '" stroke-width="1.5"/><path d="M8 9 L10.5 10 M8 11.5 L10.5 12.5" stroke="' + d1 + '" stroke-width=".8"/>';
    } else if (k === 'wand') {
      var head = st === 'orb' ? g(17.5, 5.5, 3.3) : st === 'blade' ? '<path d="M14 9 L19 2 L20 3.5 L15.5 10 Z" fill="' + c.c2 + '" stroke="#fff" stroke-width=".4"/>' + g(14, 10, 1.4)
        : st === 'crook' ? '<path d="M15 8 C15 3 21 3 20 7" stroke="' + c.c1 + '" stroke-width="2.4" fill="none"/>' + g(20, 8, 1.4)
        : st === 'scepter' ? '<path d="M14.5 8 L17 3 L19.5 8 Z" fill="' + c.c2 + '"/>' + g(17, 6, 1.6) : g(17, 6, 2.2);
      body = '<path d="M5 21 L16 8" stroke="' + c.c1 + '" stroke-width="' + (st === 'wand' ? 2 : 2.6) + '" stroke-linecap="round"/>' + (st === 'branch' ? '<path d="M9 16 C7 14 6 14 5 15 M12 12 C14 13 15 12 15 11" stroke="' + c.c2 + '" stroke-width="1.2" fill="none"/>' : '<path d="M7 18.5 L9 16" stroke="' + c.c2 + '" stroke-width="3"/>') + head;
    } else if (k === 'amulet') {
      body = '<path d="M6 3 C7 9 10 11 12 11 C14 11 17 9 18 3" stroke="' + c.c2 + '" stroke-width="1.3" fill="none"/>' +
        (st === 'talisman' ? '<path d="M12 9 L17 15 L12 22 L7 15 Z" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width="1"/>' + g(12, 15.5, 2.2)
          : '<circle cx="12" cy="15.5" r="' + (st === 'medallion' ? 5.5 : 4.5) + '" fill="' + c.c1 + '" stroke="' + c.c2 + '" stroke-width="1.2"/>' + g(12, 15.5, 2.2));
    } else if (k === 'mount') {
      body = '<path d="M5 21 L7.5 13 C6.5 8 9 4.5 11 3.5 L11.5 1.5 L13 4 C17.5 4.5 20 8 19.5 11.5 L17.5 12.5 L14.5 10 L13.5 14 L16 21 Z" fill="' + c.c1 + '" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>' +
        '<path d="M11 4 C9 7 8 10 8.5 14" stroke="' + c.c2 + '" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="15.5" cy="7.5" r="1" fill="#1d1626"/>' + g(10.5, 16, 1.3);
    } else if (k === 'potion') {
      body = '<path d="M10 3 L14 3 L14 8 C18 9 19 13 18 16 C17 20 7 20 6 16 C5 13 6 9 10 8 Z" fill="' + c.c1 + '" stroke="#fff" stroke-width=".8"/><rect x="9.5" y="2" width="5" height="2.5" rx="1" fill="#c9a26a"/><ellipse cx="10" cy="12" rx="1.5" ry="2.5" fill="#fff" opacity=".5"/>';
    } else {
      body = '<path d="M12 3 L18 10 L12 21 L6 10 Z" fill="' + c.c1 + '" stroke="#fff" stroke-width=".7"/><path d="M6 10 L18 10 M12 3 L12 21" stroke="#fff" stroke-width=".4" opacity=".6"/>';
    }
    var s2 = size || 34;
    return '<svg class="ico" viewBox="0 0 24 24" width="' + s2 + '" height="' + s2 + '" aria-hidden="true">' + body + '</svg>';
  }
  // A framed icon tile (rarity frame + NEW badge)
  function iconTile(id, opts) {
    opts = opts || {};
    var it = D().items[id]; if (!it) return '';
    var r = S().rarityId(it), isNew = opts.badge !== false && S().isNew(id);
    return '<span class="itile r-' + r + (opts.big ? ' big' : '') + '" style="--rc:' + rarColor(it) + '">' + itemIcon(id, opts.big ? 46 : (opts.size || 32)) +
      (isNew ? '<em class="new">NEW</em>' : '') + (opts.count > 1 ? '<em class="cnt">×' + opts.count + '</em>' : '') + '</span>';
  }
  UI.itemIcon = itemIcon;
  UI.iconSVG = iconSVG;     // (kind, style, {c1, c2, gem}, size) -> svg string (icon lab / tests)

  // Tooltip with stat comparison (green/red deltas vs what is equipped)
  var tipEl = null;
  function tipNode() {
    if (!tipEl) { tipEl = h('div', 'itip hidden'); tipEl.id = 'item-tip'; document.body.appendChild(tipEl); }
    return tipEl;
  }
  function tooltipHTML(id, ctx) {
    var it = D().items[id], p = S().player; if (!it) return '';
    var r = rar(it), html = '<div class="it-name" style="color:' + r.color + '">' + U.esc(it.name) + '</div>';
    var sub = [];
    if (it.type === 'gear' || it.type === 'mount') sub.push('<span style="color:' + r.color + '">' + r.name + '</span>');
    if (it.type === 'gear') sub.push(SLOT_NAMES[it.slot]);
    if (it.type === 'mount') sub.push('Mount');
    if (it.type === 'potion') sub.push('Potion');
    if (it.type === 'reagent') sub.push('Reagent');
    if (it.level) sub.push('<span class="' + (p.level < it.level ? 'bad' : '') + '">Level ' + it.level + '</span>');
    if (it.school) sub.push('<span class="' + (it.school !== p.school ? 'bad' : '') + '" style="color:' + schoolColor(it.school) + '">' + U.esc(D().schools[it.school].name) + ' only</span>');
    // v1.2 WS2: endgame set name + "Crafted" tag
    if (it.type === 'gear' && SET_NAMES[it.set]) sub.push('<span style="color:#e8e0ff">' + SET_NAMES[it.set] + ' set</span>');
    if (tierTag(it)) sub.push(tierTag(it));
    if (it.crafted) sub.push('<span style="color:' + CRAFTED_COLOR + ';font-weight:800">Crafted</span>');
    html += '<div class="it-sub">' + sub.join(' · ') + '</div>';
    if (it.type === 'gear') {
      var equippedHere = p.equipped[it.slot] === id && ctx !== 'shop';
      var delta = equippedHere || offSchool(it) ? {} : S().compareGear(id), s0 = it.stats || {};
      var cur = !equippedHere && p.equipped[it.slot] && D().items[p.equipped[it.slot]];
      html += '<div class="it-stats">' + STAT_ORDER.filter(function (k) { return s0[k] || delta[k]; }).map(function (k) {
        var v = s0[k] || 0, d = delta[k] || 0, unit = (k === 'hp' || k === 'mana') ? '' : '%';
        return '<div class="it-stat">' + statLabel(k) + '<b>' + (v ? '+' + v + unit : '—') + '</b>' +
          (d ? '<i class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ ') + d + unit + '</i>' : '') + '</div>';
      }).join('') + '</div>';
      if (s0.brightPip || s0.pipSurge) {
        html += '<div class="it-note">' + [s0.brightPip ? '<b>Bright Pip</b>: ' + STAT_TIPS.brightPip : '', s0.pipSurge ? '<b>Pip Surge</b>: ' + STAT_TIPS.pipSurge : ''].filter(Boolean).join('<br>') + '</div>';
      }
      html += offSchoolHTML(it);             // v1.2 WS2 §6.1
      if (equippedHere) html += '<div class="it-note eq">Equipped</div>';
      else if (offSchool(it)) { /* the comparison would be misleading: it can't be worn */ }
      else if (cur) html += '<div class="it-note">Compared with ' + itemNameHTML(cur.id) + '</div>';
      else html += '<div class="it-note">Your ' + SLOT_NAMES[it.slot].toLowerCase() + ' slot is empty</div>';
      var l = it.look || {};
      if (l.style) html += '<div class="it-look">Look: <b>' + U.esc(l.style) + '</b> ' + SLOT_NAMES[it.slot].toLowerCase() + (l.fx ? ' · <b>' + U.esc(l.fx) + '</b> aura' : '') + '</div>';
      if (SET_NAMES[it.set]) {
        var by = it.crafted && craftedBy(id), src = by ? [] : dropSources(id);
        if (by) html += '<div class="it-look">Crafted by <b>' + U.esc(by.name) + '</b>, ' + U.esc(by.title || '') + (it.tier > 1 ? ' (as an upgrade)' : '') + '</div>';
        else if (src.length) html += '<div class="it-look">Drops from ' + src.join(', ') + (it.tier === 2 ? ', or upgrade a Tier 1 piece' : '') + '</div>';
        html += tierInfoHTML(id) + setBlockHTML(id);     // v1.2 WS2 §6.3
      }
    } else if (it.type === 'mount') {
      html += '<div class="it-stats"><div class="it-stat"><span>Speed</span><b>+' + Math.round((it.speed || 0) * 100) + '%</b></div></div>';
    }
    var fl = (lore().itemFlavor && lore().itemFlavor[id]) || it.desc;
    if (fl) html += '<div class="it-flavor">' + U.esc(fl) + '</div>';
    var foot = [];
    if (ctx === 'shop' && it.price) foot.push('Price <b class="gold">' + U.fmt(it.price) + ' g</b>');
    else if (it.sell) foot.push('Sells for <b class="gold">' + U.fmt(it.sell) + ' g</b>');
    if (ctx === 'pack' && it.type === 'gear' && p.equipped[it.slot] !== id) foot.push(S().canEquip(id) ? '<span class="hint">Click to equip</span>' : offSchool(it) && bankAvailable() ? '<span class="hint">Use "Send to Bank" for another wizard</span>' : '');
    if (ctx === 'slot') foot.push('<span class="hint">Click to unequip</span>');
    if (foot.length) html += '<div class="it-foot">' + foot.filter(Boolean).join(' &nbsp;·&nbsp; ') + '</div>';
    return html;
  }
  // extra (optional, v1.2 WS9): function (id, node) -> trusted HTML appended to the tooltip
  function bindTips(root, ctx, extra) {
    root.querySelectorAll('[data-tip]').forEach(function (n) {
      n.addEventListener('mouseenter', function (e) {
        var id = n.getAttribute('data-tip'), t = tipNode();
        t.innerHTML = tooltipHTML(id, n.getAttribute('data-ctx') || ctx) + (extra ? extra(id, n) || '' : '');
        t.style.setProperty('--rc', rarColor(D().items[id]));
        t.classList.remove('hidden');
        moveTip(e);
        if (S().isNew(id)) { S().markSeen(id); var b = n.querySelector('.new'); if (b) b.remove(); UI.refreshHUD(); }
      });
      n.addEventListener('mousemove', moveTip);
      n.addEventListener('mouseleave', hideTip);
    });
  }
  function moveTip(e) {
    var t = tipNode(), w = t.offsetWidth || 260, hgt = t.offsetHeight || 160;
    var x = e.clientX + 18, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + hgt > window.innerHeight - 8) y = Math.max(8, window.innerHeight - hgt - 8);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.add('hidden'); }
  UI.hideTip = hideTip;

  // ---- Paper doll: a small separate WebGL view of your wizard (lazy; freed on close)
  // One renderer per session: closing the backpack PARKS it (stops drawing, frees the
  // wizard/mount models) instead of destroying it, because three.js keeps dispose
  // listeners on shared cached resources that would pin every old renderer in memory.
  var doll = null, parked = null;
  function dollCreate() {
    if (doll) return doll;
    if (parked) {
      doll = parked; parked = null;
      doll.last = 0; doll.key = '';
      doll.raf = requestAnimationFrame(doll.frame);
      return doll;
    }
    if (typeof THREE === 'undefined' || !WF.models || !WF.models.wizard) return null;
    var canvas = document.createElement('canvas');
    canvas.className = 'doll-canvas';
    var R;
    try { R = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch (e) { console.warn('paper doll unavailable', e); return null; }
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.setClearColor(0x000000, 0);
    if ('outputEncoding' in R && THREE.sRGBEncoding && WF.world.renderer) R.outputEncoding = WF.world.renderer.outputEncoding;
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(28, 0.7, 0.1, 60);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x50406a, 0.9));
    var key = new THREE.DirectionalLight(0xfff1d0, 0.85); key.position.set(3, 6, 5); scene.add(key);
    var rim = new THREE.DirectionalLight(0xb48cff, 0.55); rim.position.set(-4, 3, -5); scene.add(rim);
    // soft floor glow
    var gc = document.createElement('canvas'); gc.width = gc.height = 128;
    var gx = gc.getContext('2d'), grd = gx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,220,140,0.55)'); grd.addColorStop(0.55, 'rgba(180,140,255,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    gx.fillStyle = grd; gx.fillRect(0, 0, 128, 128);
    var gtex = new THREE.CanvasTexture(gc);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; scene.add(floor);
    var turn = new THREE.Group(); scene.add(turn);
    doll = { R: R, canvas: canvas, scene: scene, cam: cam, turn: turn, floor: floor, gtex: gtex, wiz: null, mount: null, key: '', yaw: 0.5, spin: 0.35, drag: null, idleAt: 0, t: 0, raf: 0, last: 0, w: 0, hgt: 0, mode: 'gear' };
    canvas.addEventListener('pointerdown', function (e) { doll.drag = { x: e.clientX }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grab'); });
    canvas.addEventListener('pointermove', function (e) { if (!doll || !doll.drag) return; doll.yaw += (e.clientX - doll.drag.x) * 0.012; doll.drag.x = e.clientX; doll.idleAt = performance.now() + 2500; });
    var up = function () { if (doll) { doll.drag = null; canvas.classList.remove('grab'); } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
    function frame(ts) {
      if (!doll) return;
      doll.raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, ((ts - doll.last) / 1000) || 0.016); doll.last = ts; doll.t += dt;
      var host = canvas.parentNode;
      if (!host || !document.body.contains(canvas)) return;
      var w = host.clientWidth | 0, hh = host.clientHeight | 0;
      if (w < 10 || hh < 10) return;
      if (w !== doll.w || hh !== doll.hgt) { doll.w = w; doll.hgt = hh; R.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
      if (!doll.drag && performance.now() > doll.idleAt) doll.yaw += dt * doll.spin;
      doll.turn.rotation.y = doll.yaw;
      var riding = !!doll.mount;
      if (doll.mount && doll.mount.userData.anim) doll.mount.userData.anim(doll.t, 'idle', dt);
      if (doll.wiz && doll.wiz.userData.anim) doll.wiz.userData.anim(doll.t, riding ? 'ride' : 'idle', dt);
      var top = riding ? (doll.mount.userData.height || 2) + 1.4 : ((doll.wiz && doll.wiz.userData.height) || 2.3);
      var dist = riding ? 9.5 : 7.2, cy = top * 0.5;
      cam.position.set(0, cy + top * 0.18, dist); cam.lookAt(0, cy, 0);
      try { R.render(scene, cam); } catch (e) { /* context lost */ }
    }
    doll.frame = frame;
    doll.raf = requestAnimationFrame(frame);
    return doll;
  }
  // Show the wizard wearing equippedOverride (or the current gear); withMount = item id to ride
  // v1.2 WS2: previewId = a gear item to TRY ON (crafting look preview): the
  // wizard is shown with that piece in its slot, nothing is equipped.
  function dollShow(withMount, previewId) {
    var d = dollCreate(); if (!d) return;
    var pv = previewId && D().items[previewId], eq = null;
    if (pv && pv.type === 'gear') { eq = {}; Object.keys(S().player.equipped).forEach(function (k) { eq[k] = S().player.equipped[k]; }); eq[pv.slot] = previewId; }
    var look = S().appearance(eq || undefined), key = JSON.stringify(look) + '|' + (withMount || '');
    if (key === d.key && d.wiz) return;
    d.key = key;
    if (d.wiz) { if (d.wiz.parent) d.wiz.parent.remove(d.wiz); WF.models.dispose(d.wiz); d.wiz = null; }
    if (d.mount) { d.turn.remove(d.mount); WF.models.dispose(d.mount); d.mount = null; }
    try { d.wiz = WF.models.wizard(look); } catch (e) { console.error(e); return; }
    var it = withMount && D().items[withMount];
    if (it && WF.models.mount) {
      try { d.mount = WF.models.mount((it.mount && it.mount.kind) || 'horse', Object.assign({ rarity: it.rarity }, it.mount || {})); } catch (e) { d.mount = null; }
    }
    if (d.mount) { d.turn.add(d.mount); (d.mount.userData.seat || d.mount).add(d.wiz); }
    else d.turn.add(d.wiz);
    d.floor.scale.setScalar(d.mount ? 1.6 : 1);
  }
  function dollDispose() {
    if (!doll) return;
    var d = doll; doll = null;
    cancelAnimationFrame(d.raf);
    try {
      if (d.wiz) { if (d.wiz.parent) d.wiz.parent.remove(d.wiz); WF.models.dispose(d.wiz); }
      if (d.mount) { if (d.mount.parent) d.mount.parent.remove(d.mount); WF.models.dispose(d.mount); }
    } catch (e) { /* ignore */ }
    d.wiz = null; d.mount = null; d.key = ''; d.drag = null;
    if (d.canvas.parentNode) d.canvas.parentNode.removeChild(d.canvas);
    parked = d;
  }
  UI._doll = function () { return doll; };      // tests / debugging

  // ---- Backpack
  var packTab = 'gear', packSlot = 'all', packRarity = 'all', packSort = 'rarity';
  function packList(p) {
    var ord = function (id) { return rar(D().items[id]).order || 0; };
    var ids = Object.keys(p.inventory).filter(function (id) {
      var it = D().items[id];
      if (!it) return false;
      if (packTab === 'gear') {
        if (it.type !== 'gear') return false;
        if (packSlot !== 'all' && it.slot !== packSlot) return false;
        if (packRarity !== 'all' && ord(id) < (D().rarities[packRarity] || {}).order) return false;
        return true;
      }
      return packTab === 'potions' ? it.type === 'potion' : packTab === 'reagents' ? it.type === 'reagent' : false;
    });
    var cmp = {
      rarity: function (a, b) { return ord(b) - ord(a) || (D().items[b].level || 0) - (D().items[a].level || 0) || D().items[a].name.localeCompare(D().items[b].name); },
      level: function (a, b) { return (D().items[b].level || 0) - (D().items[a].level || 0) || ord(b) - ord(a); },
      name: function (a, b) { return D().items[a].name.localeCompare(D().items[b].name); },
      'new': function (a, b) { return ((p.newItems || {})[b] || 0) - ((p.newItems || {})[a] || 0) || ord(b) - ord(a); },
      upgrade: function (a, b) { return S().gearScore(b) - S().gearScore(a); }
    }[packSort] || function () { return 0; };
    return ids.sort(cmp);
  }
  function slotTile(slot) {
    var p = S().player, id = slot === 'mount' ? p.equipped.mount : p.equipped[slot], it = id && D().items[id];
    return '<button class="pslot' + (it ? ' full r-' + S().rarityId(it) : '') + '" data-slot="' + slot + '"' + (it ? ' data-tip="' + id + '" data-ctx="slot"' : '') + ' style="--rc:' + (it ? rarColor(it) : 'rgba(255,255,255,.18)') + '">' +
      (it ? itemIcon(id, 40) : '<span class="pslot-empty">' + itemIconEmpty(slot) + '</span>') +
      '<span class="pslot-name">' + (it ? '<b style="color:' + rarColor(it) + '">' + U.esc(it.name) + '</b>' : SLOT_NAMES[slot]) + '</span></button>';
  }
  // ---- v2.0 M1 (WS-A): total resist against each school's hits (universal + school gear + natural weakness) + Runeglass
  function schoolResistHTML(st) {
    var ss = (st && st.schoolStats) || {}, res = ss.resist || {}, cap = (D().progression.levelScaling || {}).resistCap || 0.75;
    var ids = (D().playableSchools || []).concat(['hollow']);
    var chips = ids.map(function (sid) {
      var sc = D().schools[sid], v = Math.min(cap, st.resist + (res[sid] || 0)), r = Math.round(v * 100);
      return '<span title="' + U.esc('Resist vs ' + sc.name + ' hits: ' + r + '%' + (r < 0 ? ' (weakness)' : '')) + '" style="color:' + sc.color + ';margin-right:8px;white-space:nowrap">' + sc.glyph + ' <b style="color:' + (r < 0 ? '#ff8a7a' : '#e8e2ff') + '">' + (r > 0 ? '+' : '') + r + '%</b></span>';
    }).join('');
    return '<div class="pk-schoolres" style="margin:6px 2px 0;font-size:12px;opacity:.95"><span class="dim" style="margin-right:6px">Resist by school</span>' + chips +
      '<span title="Runeglass: shards of the Orrery\'s star-lenses. The Spellwright in Lanternmere grinds them into your spells." style="color:#9fe6ff;white-space:nowrap">◈ <b>' + (S().player.runeglass || 0) + '</b> Runeglass</span></div>';
  }
  function itemIconEmpty(slot) {
    var fake = { hat: 'apprentice_hat', robe: 'apprentice_robe', boots: 'apprentice_boots', wand: 'willow_wand', amulet: 'mossy_charm', mount: 'mount_pony_dapple' }[slot];
    return itemIcon(fake, 34);
  }
  function renderPack() {
    var p = S().player, body = el('pk-body'), st = S().stats(), g = S().gearStats();
    hideTip();
    var statCell = function (label, val, extra, cls, tip) { return '<div class="pst' + (cls ? ' ' + cls : '') + '"' + (tip ? ' title="' + U.esc(tip) + '"' : '') + '><span>' + label + '</span><b>' + val + '</b>' + (extra ? '<small>' + extra + '</small>' : '') + '</div>'; };
    // v1.2 WS2: Bright Pip shows the TOTAL bright chance (level + gear, capped), Pip Surge the capped gear chance
    var pip = S().pipStats ? S().pipStats(p.level, g) : { brightTotal: 0, pipSurge: 0 };
    var capNote = function (raw, used) { return raw > used + 1e-9 ? ' (capped)' : ''; };
    var pct = function (v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'; };
    var newOf = function (type) { return Object.keys(p.newItems || {}).filter(function (id) { return p.inventory[id] && D().items[id] && D().items[id].type === type; }).length; };
    var newCount = newOf('gear'), newMounts = newOf('mount');
    var mountIt = p.equipped.mount && D().items[p.equipped.mount];
    var left = '<div class="pk-left">' +
      '<div class="pk-doll"><div class="pk-col">' + ['hat', 'robe', 'boots'].map(slotTile).join('') + '</div>' +
      '<div class="pk-stage"><div id="pk-doll-host" class="doll-host"></div><div class="doll-hint">drag to turn</div>' +
      (D().schools[p.school] ? '<div class="doll-name">' + U.esc(p.name) + '<small style="color:' + schoolColor(p.school) + '">Level ' + p.level + ' ' + U.esc(D().schools[p.school].name) + '</small></div>' : '') + '</div>' +
      '<div class="pk-col">' + ['wand', 'amulet', 'mount'].map(slotTile).join('') + '</div></div>' +
      '<div class="pk-stats2" style="grid-template-columns:repeat(4,1fr)">' +
        statCell('Health', U.fmt(st.maxHp), g.hp ? '+' + g.hp + ' gear' : '', 'hp') +
        statCell('Mana', U.fmt(st.maxMana), g.mana ? '+' + g.mana + ' gear' : '', 'mana') +
        statCell('Damage', pct(st.ownDmg != null ? st.ownDmg : st.dmg), [(g.dmg || g['dmg_' + p.school]) ? '+' + ((g.dmg || 0) + (g['dmg_' + p.school] || 0)) + '% gear' : '', st.flatDmg ? '+' + st.flatDmg + ' per hit (pet)' : ''].filter(Boolean).join(', '), '', 'Your ' + D().schools[p.school].name + ' spells (v2.0: school gear powers your own school)' + (st.flatDmg ? '. Your pet adds ' + st.flatDmg + ' damage to every hit, before blades and traps.' : '')) +
        statCell('Resist', Math.round(st.resist * 100) + '%', g.resist ? '+' + g.resist + '% gear' : '') +
        statCell('Accuracy', pct(st.ownAcc != null ? st.ownAcc : st.acc), (g.acc || g['acc_' + p.school]) ? '+' + ((g.acc || 0) + (g['acc_' + p.school] || 0)) + '% gear' : '') +
        statCell('Bright Pip', Math.round(pip.brightTotal * 100) + '%', g.brightPip ? '+' + g.brightPip + '% gear' + capNote(g.brightPip / 100, pip.brightPip) : 'from level', 'pst-pp', STAT_TIPS.brightPip) +
        statCell('Pip Surge', Math.round(pip.pipSurge * 100) + '%', g.pipSurge ? '+' + g.pipSurge + '% gear' + capNote(g.pipSurge / 100, pip.pipSurge) : '', 'pst-ps', STAT_TIPS.pipSurge) +
        statCell('Gold', U.fmt(p.gold), '', 'gold') +
      '</div>' + schoolResistHTML(st) + packSetsHTML() +
      (mountIt ? '<div class="pk-ride"><span>' + itemNameHTML(mountIt.id) + ' <small class="dim">+' + Math.round(mountIt.speed * 100) + '% speed</small></span><button class="btn sm' + (p.mounted ? '' : ' primary') + '" id="pk-ride">' + (p.mounted ? 'Dismount (R)' : 'Ride (R)') + '</button></div>' : '') +
      '</div>';
    var tabs = [['gear', 'Gear'], ['mounts', 'Mounts'], ['potions', 'Potions'], ['reagents', 'Reagents']];
    var right = '<div class="pk-right"><div class="tabs">' + tabs.map(function (t) {
      var n = t[0] === 'gear' ? newCount : t[0] === 'mounts' ? newMounts : 0;
      return '<button class="tab' + (packTab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (n ? ' <em class="tab-new">' + n + '</em>' : '') + '</button>';
    }).join('') +
      // v1.2 WS9: open the shared Vault from the backpack while standing in a town that has one
      (WF.bank && WF.bank.here() ? '<button class="btn sm pk-vault" id="pk-vault" title="' + U.esc(WF.bank.vaultName()) + ': shared by all your wizards">&#9919; ' + U.esc(WF.bank.shortName()) + '</button>' : '') +
      '</div>';
    if (packTab === 'gear') {
      right += '<div class="pk-tools"><div class="chips">' + ['all', 'hat', 'robe', 'boots', 'wand', 'amulet'].map(function (sl) {
        return '<button class="chip' + (packSlot === sl ? ' on' : '') + '" data-slotf="' + sl + '">' + (sl === 'all' ? 'All' : SLOT_NAMES[sl]) + '</button>';
      }).join('') + '</div><div class="sel">' +
        '<select id="pk-rar" title="Filter by rarity"><option value="all">Any rarity</option>' + ['uncommon', 'rare', 'epic', 'legendary'].map(function (r) { return '<option value="' + r + '">' + D().rarities[r].name + '+</option>'; }).join('') + '</select>' +
        '<select id="pk-sort" title="Sort"><option value="rarity">Sort: Rarity</option><option value="level">Sort: Level</option><option value="upgrade">Sort: Best stats</option><option value="new">Sort: Newest</option><option value="name">Sort: Name</option></select>' +
        '</div></div>';
    }
    right += '<div class="pk-grid' + (packTab === 'gear' || packTab === 'mounts' ? '' : ' rows') + '" id="pk-grid"></div></div>';
    body.innerHTML = '<div class="pk-wrap">' + left + right + '</div>';
    var grid = el('pk-grid');
    if (packTab === 'mounts') renderMountsTab(grid, p);
    else {
      var ids = packList(p);
      if (!ids.length) grid.innerHTML = '<p class="dim pk-empty">' + (packTab === 'gear' ? (packSlot !== 'all' || packRarity !== 'all' ? 'No gear matches this filter.' : 'No spare gear. Defeat Hollow creatures — every one can drop gear, and elites and bosses drop the best.') : 'Nothing here yet.') + '</p>';
      ids.forEach(function (id) {
        var it = D().items[id];
        var card = h('div', 'icard r-' + S().rarityId(it) + (it.type === 'gear' && !S().canEquip(id) ? ' locked' : ''));
        card.setAttribute('data-tip', id); card.setAttribute('data-ctx', 'pack');
        card.style.setProperty('--rc', rarColor(it));
        var up = it.type === 'gear' && S().canEquip(id) && S().gearScore(it) > S().gearScore(p.equipped[it.slot] ? D().items[p.equipped[it.slot]] : null);
        card.innerHTML = iconTile(id, { count: p.inventory[id] }) + '<div class="icard-main">' + itemNameHTML(id) +
          '<small>' + (it.type === 'gear' ? SLOT_NAMES[it.slot] + ' · Lv ' + it.level + (it.tier && it.set ? ' · <b style="color:' + TIER_COLORS[it.tier] + '">T' + it.tier + '</b>' : '') +
            (it.school ? (offSchool(it) ? ' · <b style="color:' + OFF_SCHOOL_RED + '">' + U.esc(schoolName(it.school)) + ' only</b>' : ' · ' + U.esc(schoolName(it.school))) : '') + (it.crafted ? ' · <b style="color:' + CRAFTED_COLOR + '">Crafted</b>' : '') : (it.type === 'potion' ? U.esc(it.desc || '') : U.esc(it.desc || ''))) + '</small></div>' +
          (up ? '<span class="upg" title="Better than what you wear">▲</span>' : '');
        if (it.type === 'gear') {
          card.onclick = function () {
            if (!S().canEquip(id)) { UI.toast(it.school && it.school !== p.school ? 'Only ' + U.esc(D().schools[it.school].name) + ' wizards can wear that.' : 'You need level ' + it.level + ' for that.', 'warn'); WF.sfx.play('error'); return; }
            S().equip(id); WF.sfx.play('buff'); S().save(); rerender();
          };
          // ---- v1.2 WS2 (§6.1): another school's gear -> "Send to Bank" (when the shared bank exists)
          // v1.2 WS9: goes straight in while you are in a town with a Vault; elsewhere it says where to go
          if (offSchool(it) && bankAvailable()) {
            var bk = h('button', 'btn sm' + (WF.bank && !WF.bank.here() ? ' btn-ghost' : ''), 'Send to Bank');
            bk.title = WF.bank && !WF.bank.here() ? WF.bank.whereText() : 'Put it in the shared account Bank so your ' + schoolName(it.school) + ' wizard can take it';
            bk.style.marginLeft = 'auto';
            bk.onclick = function (e) {
              e.stopPropagation();
              if (WF.bank) { var r = WF.bank.sendFromPack(id); if (r.ok) { hideTip(); rerender(); } return; }
              var chk = typeof S().canDeposit === 'function' ? S().canDeposit(id, 1) : true;
              if (chk === false || (chk && chk.ok === false)) { UI.toast((chk && chk.reason) || 'The Bank is full.', 'warn'); WF.sfx.play('error'); return; }
              if (S().deposit(id, 1)) { WF.sfx.play('gold'); UI.toast(itemNameHTML(id) + ' is in the Bank now.'); hideTip(); rerender(); }
            };
            card.appendChild(bk);
          }
        } else if (it.type === 'potion') {
          card.onclick = function () { UI.potion(it.heal ? 'health' : 'mana'); rerender(); };
          card.classList.add('click');
        }
        grid.appendChild(card);
      });
    }
    // paper doll: re-home the persistent canvas into the fresh host
    var host = el('pk-doll-host'), d = dollCreate();
    if (d && host) { host.appendChild(d.canvas); dollShow(packTab === 'mounts' ? p.equipped.mount : null); }
    else if (host) host.innerHTML = '<div class="dim doll-off">Preview unavailable</div>';
    body.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { packTab = b.getAttribute('data-tab'); rerender(); }; });
    body.querySelectorAll('[data-slotf]').forEach(function (b) { b.onclick = function () { packSlot = b.getAttribute('data-slotf'); rerender(); }; });
    var rs = el('pk-rar'); if (rs) { rs.value = packRarity; rs.onchange = function () { packRarity = this.value; rerender(); }; }
    var so = el('pk-sort'); if (so) { so.value = packSort; so.onchange = function () { packSort = this.value; rerender(); }; }
    body.querySelectorAll('[data-slot]').forEach(function (b) {
      b.onclick = function () {
        var slot = b.getAttribute('data-slot');
        if (slot === 'mount') { packTab = 'mounts'; rerender(); return; }
        if (S().unequip(slot)) { WF.sfx.play('click'); S().save(); rerender(); }
        else { packTab = 'gear'; packSlot = slot; rerender(); }
      };
    });
    var rb = el('pk-ride'); if (rb) rb.onclick = function () { WF.world.toggleMount(); rerender(); };
    var vb = el('pk-vault'); if (vb) vb.onclick = function () { UI.openBank(); };     // v1.2 WS9
    bindTips(body, 'pack');
  }
  function renderMountsTab(grid, p) {
    var owned = S().ownedMounts().sort(function (a, b) { return (D().items[b].speed || 0) - (D().items[a].speed || 0); });
    if (!owned.length) {
      grid.innerHTML = '<div class="pk-empty mount-empty">' + itemIcon('mount_horse_chestnut', 64) + (((D().lore || {}).ui || {}).stableEmpty || '<p><b>Your stable is empty.</b></p>') + '</div>';
      return;
    }
    owned.forEach(function (id) {
      var it = D().items[id], eq = p.equipped.mount === id;
      var card = h('div', 'icard mount r-' + S().rarityId(it) + (eq ? ' equipped' : '') + (S().canEquipMount(id) ? '' : ' locked'));
      card.setAttribute('data-tip', id); card.style.setProperty('--rc', rarColor(it));
      card.innerHTML = iconTile(id, { big: true }) + '<div class="icard-main">' + itemNameHTML(id) + '<small>+' + Math.round((it.speed || 0) * 100) + '% speed · Lv ' + it.level + (eq ? ' · <b class="eqtag">Equipped</b>' : '') + '</small></div>';
      var b = h('button', 'btn sm' + (eq ? '' : ' primary'), eq ? (p.mounted ? 'Dismount' : 'Ride') : 'Equip');
      b.onclick = function (e) {
        e.stopPropagation();
        if (!eq) {
          if (!S().equipMount(id)) { UI.toast('You need level ' + it.level + ' to ride ' + U.esc(it.name) + '.', 'warn'); WF.sfx.play('error'); return; }
          WF.sfx.play('buff');
        } else WF.world.toggleMount();
        S().save(); rerender();
      };
      card.appendChild(b);
      card.onclick = function () { if (!eq && S().equipMount(id)) { WF.sfx.play('buff'); S().save(); rerender(); } };
      grid.appendChild(card);
    });
    if (p.equipped.mount) {
      var un = h('button', 'btn sm btn-ghost pk-unmount', 'Send ' + U.esc(D().items[p.equipped.mount].name) + ' to the stable');
      un.onclick = function () { S().unequipMount(); S().save(); rerender(); };
      grid.appendChild(un);
    }
  }

  // ---- v1.2 WS9: the Lanternmere Vault panel. game/js/bank.js draws it; these are the
  // panel hook and the item helpers it shares with the backpack (same tiles, tooltips, colours).
  UI.openBank = function (npcId) {
    var m = WF.world.mode;
    if (!WF.bank || !S().player || m === 'combat' || m === 'title' || m === 'loading' || overlayOpen()) return false;
    UI.closeAll(true);
    WF.bank.opened(npcId);
    openPanel = 'bank';
    WF.world.mode = 'menu';
    el('panel').classList.remove('hidden');
    renderPanel('bank');
    WF.sfx.play('open');
    return true;
  };
  UI.panelOpen = function () { return openPanel; };
  UI.items = {
    iconTile: iconTile, itemNameHTML: itemNameHTML, tooltipHTML: tooltipHTML, bindTips: bindTips, hideTip: hideTip,
    rarColor: rarColor, offSchool: offSchool, schoolName: schoolName, slotNames: SLOT_NAMES,
    tierColors: TIER_COLORS, offSchoolRed: OFF_SCHOOL_RED, craftedColor: CRAFTED_COLOR
  };

  // ---- Shop & crafting
  var shopNpc = null, shopTab = 'buy', craftPick = null;   // craftPick: v1.2 WS2 recipe shown in the try-on preview
  UI.openShop = function (npcId, tab) {
    UI.closeAll(true);
    shopNpc = npcId; shopTab = tab || 'buy';
    craftSchool = null;      // v1.2 WS2: Tamsin's school picker starts at your own school
    openPanel = 'shop';
    WF.world.mode = 'menu';
    el('panel').classList.remove('hidden');
    renderPanel('shop');
  };
  // ---- v1.2 WS2: Tamsin's panel = Craft (pick the school) / Upgrade / Salvage
  // (contract §2.3, §6.1, §6.3). All three share one layout: a 3D try-on stage
  // with a stat comparison on the left, the list on the right.
  var STAGE_CSS = 'min-height:300px;border:1px solid rgba(255,211,107,.3);background:radial-gradient(ellipse at 50% 30%, rgba(120,90,200,.35), rgba(14,10,34,.9) 70%);box-shadow:inset 0 0 30px rgba(0,0,0,.5)';
  function stageLayout(list, stageHTML) {
    var wrap = h('div', 'pk-wrap craft-wrap'), stage = h('div', 'pk-left');
    wrap.style.gridTemplateColumns = '290px 1fr';
    stage.innerHTML = stageHTML;
    list.parentNode.insertBefore(wrap, list);
    wrap.appendChild(stage); wrap.appendChild(list);
    return stage;
  }
  function stageDoll(hostId, previewId) {
    var host = el(hostId), dd = host && dollCreate();
    if (dd && host) { host.appendChild(dd.canvas); dollShow(null, previewId); }
    else if (host) host.innerHTML = '<div class="dim doll-off">Preview unavailable</div>';
  }
  function stageTop(it, hint, h) {
    // h: a shorter stage (upgrade tab) so the before/after table AND the button fit without scrolling at 720p
    return '<div class="pk-stage" style="' + STAGE_CSS + (h ? ';min-height:' + h + 'px' : '') + '"><div id="cr-doll-host" class="doll-host"></div><div class="doll-hint">' + hint + '</div>' +
      (it ? '<div class="doll-name">' + U.esc(it.name) + '<small style="color:' + rarColor(it) + '">' + rar(it).name + ' ' + SLOT_NAMES[it.slot] + (it.tier && it.set ? ' · ' + tierTag(it) : '') +
        (it.crafted ? ' · <span style="color:' + CRAFTED_COLOR + '">Crafted</span>' : '') + (it.school ? ' · <span style="color:' + (offSchool(it) ? OFF_SCHOOL_RED : schoolColor(it.school)) + '">' + U.esc(schoolName(it.school)) + '</span>' : '') + '</small></div>' : '') + '</div>';
  }
  function needsHTML(needs, gold) {
    var parts = Object.keys(needs || {}).map(function (id) {
      var have = S().count(id), ok = have >= needs[id];
      return '<span class="' + (ok ? 'ok' : 'miss') + '">' + (ok ? '✔ ' : '✖ ') + U.esc(itemName(id)) + ' ' + have + '/' + needs[id] + '</span>';
    });
    if (gold) parts.push('<span class="' + (S().player.gold >= gold ? 'ok' : 'miss') + '">' + (S().player.gold >= gold ? '✔ ' : '✖ ') + U.fmt(gold) + ' gold</span>');
    return parts.join(', ');
  }
  var craftSchool = null, upgPick = null;
  function renderCraftTab(list, recipes) {
    var p = S().player;
    if (!craftSchool || (D().playableSchools || []).indexOf(craftSchool) < 0) craftSchool = p.school;
    var made = function (rid) { return S().recipeItem ? S().recipeItem(rid, craftSchool) : D().recipes[rid].makes.item; };
    var gearRecipes = recipes.filter(function (rid) { var id = made(rid), it = id && D().items[id]; return it && it.type === 'gear'; });
    var hasVariants = gearRecipes.some(function (rid) { var it = D().items[D().recipes[rid].makes.item]; return it && it.variants; });
    if (gearRecipes.indexOf(craftPick) < 0) craftPick = gearRecipes[0] || null;
    // school picker: craft for another of your wizards (contract §6.1)
    if (hasVariants) {
      var pick = h('div', 'pk-tools');
      pick.innerHTML = '<div class="chips"><span class="dim" style="font-size:.85em;margin-right:6px">Craft for:</span>' + (D().playableSchools || []).map(function (sc) {
        return '<button class="chip' + (craftSchool === sc ? ' on' : '') + '" data-cs="' + sc + '" style="' + (craftSchool === sc ? 'border-color:' + schoolColor(sc) : '') + '"><span style="color:' + schoolColor(sc) + '">' + (D().schools[sc].glyph || '') + '</span> ' + U.esc(schoolName(sc)) + (sc === p.school ? ' (you)' : '') + '</button>';
      }).join('') + '</div>';
      list.appendChild(pick);
      pick.querySelectorAll('[data-cs]').forEach(function (b) { b.onclick = function () { craftSchool = b.getAttribute('data-cs'); WF.sfx.play('click'); rerender(); }; });
      if (craftSchool !== p.school) {
        var note = h('div', 'it-note');
        note.style.cssText = 'color:' + OFF_SCHOOL_RED + ';font-weight:800;margin:0 0 8px';
        note.innerHTML = 'Crafting ' + U.esc(schoolName(craftSchool)) + ' versions: only a ' + U.esc(schoolName(craftSchool)) + ' wizard can wear them' + (bankAvailable() ? ' (send them over with the Bank).' : '.');
        list.appendChild(note);
      }
    }
    if (gearRecipes.length) {
      var pickId = made(craftPick), it = D().items[pickId], cmp = '';
      if (it) {
        if (offSchool(it)) cmp = '<div style="padding:6px 10px 2px">' + compareRowsHTML(null, pickId) + '</div>' + '<div class="it-note" style="padding:0 10px;color:' + OFF_SCHOOL_RED + '">For a ' + U.esc(schoolName(it.school)) + ' wizard: you can\'t wear it.</div>';
        else {
          var curId = p.equipped[it.slot], same = curId === pickId, delta = same ? {} : S().compareGear(pickId), s0 = it.stats || {};
          cmp = '<div class="it-stats" style="padding:6px 10px 2px">' + STAT_ORDER.filter(function (k) { return s0[k] || delta[k]; }).map(function (k) {
            var v = s0[k] || 0, d = delta[k] || 0, unit = (k === 'hp' || k === 'mana') ? '' : '%';
            return '<div class="it-stat">' + statLabel(k) + '<b>' + (v ? '+' + v + unit : '—') + '</b>' + (d ? '<i class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ ') + d + unit + '</i>' : '<i></i>') + '</div>';
          }).join('') + '</div><div class="it-note" style="padding:0 10px">' + (same ? 'You are wearing this.' : curId ? 'Compared with ' + itemNameHTML(curId) + ' (set bonuses included)' : 'Your ' + SLOT_NAMES[it.slot].toLowerCase() + ' slot is empty') + '</div>';
        }
      }
      stageLayout(list, stageTop(it, 'drag to turn · click a recipe to try it on') + cmp);
    }
    recipes.forEach(function (rid) {
      var r = D().recipes[rid], chk = S().canCraft(rid), row = h('div', 'inv-row'), out = made(rid);
      var makes = r.makes.item ? itemName(out) : ('Spell Scroll: ' + (D().cards[r.makes.tc] ? D().cards[r.makes.tc].name : r.makes.tc));
      var mk = r.makes.item && D().items[out];
      if (mk) { row.classList.add('r-' + S().rarityId(mk)); row.style.setProperty('--rc', rarColor(mk)); }
      var isGear = mk && mk.type === 'gear', picked = isGear && rid === craftPick;
      if (picked) { row.style.background = 'rgba(255,215,106,.10)'; row.style.boxShadow = 'inset 0 0 0 1px rgba(255,215,106,.35)'; }
      var up = isGear && S().canEquip(out) && S().gearScore(mk) > S().gearScore(p.equipped[mk.slot] ? D().items[p.equipped[mk.slot]] : null);
      var icon = mk ? '<span' + (mk.type === 'gear' || mk.type === 'mount' ? ' data-tip="' + out + '" data-ctx="craft"' : '') + '>' + iconTile(out, { badge: false }) + '</span>' : '<span class="itile r-common scroll">' + '<span class="scroll-glyph">✦</span></span>';
      var head = isGear
        ? itemNameHTML(out) + rarityTag(mk) + craftedTag(mk) + ' <small class="dim">· ' + SLOT_NAMES[mk.slot] + ' · Lv ' + mk.level + (mk.tier ? ' · T' + mk.tier : '') + '</small>' + (up ? ' <span style="color:#6dff8a" title="Better than what you wear">▲</span>' : '')
        : '<b>' + U.esc(r.name || makes) + '</b>' + ((r.count || 1) > 1 ? ' ×' + r.count : '') + ' <small class="dim">→ ' + (mk ? itemNameHTML(out) : U.esc(makes)) + (mk ? rarityTag(mk) : '') + (r.level ? ' · Lv ' + r.level : '') + '</small>';
      row.innerHTML = icon + '<div class="inv-main">' + head + (isGear ? '<div class="slot-stats">' + statsText(mk.stats) + '</div>' : '') +
        '<div class="needs">' + needsHTML(r.needs) + '</div></div>' + (r.gold ? '<span class="price">' + U.fmt(r.gold) + ' g</span>' : '');
      if (isGear) {
        row.style.cursor = 'pointer';
        row.onclick = function (e) { if (e.target.closest && e.target.closest('button')) return; if (craftPick !== rid) { craftPick = rid; WF.sfx.play('click'); rerender(); } };
      }
      var b = h('button', 'btn sm primary', /already own/i.test(chk.reason || '') ? 'Owned' : 'Craft');
      b.disabled = !chk.ok; b.title = chk.reason || '';
      b.onclick = function () {
        if (S().craft(rid, mk && mk.type === 'gear' ? craftSchool : undefined)) {
          sfxOr(mk ? 'loot_' + S().rarityId(mk) : 'loot', 'loot');
          UI.toast('Crafted ' + (mk ? itemNameHTML(out) : '<b>' + U.esc(makes) + '</b>') + (isGear ? '. Find it in your backpack (B).' : '.'), 'quest', 4500);
          rerender();
        }
      };
      row.appendChild(b);
      list.appendChild(row);
    });
    if (gearRecipes.length) stageDoll('cr-doll-host', made(craftPick));
  }
  function renderUpgradeTab(list) {
    var p = S().player;
    var pieces = (S().upgradeablePieces ? S().upgradeablePieces() : []).filter(function (x) { return S().upgradeInfo(x.id); });
    // own-school first, equipped first, then by tier
    pieces.sort(function (a, b) {
      var A = D().items[a.id], B = D().items[b.id];
      return (offSchool(A) ? 1 : 0) - (offSchool(B) ? 1 : 0) || (a.where === 'equipped' ? 0 : 1) - (b.where === 'equipped' ? 0 : 1) || B.tier - A.tier;
    });
    var key = function (x) { return x.where + ':' + x.id; };
    if (!pieces.some(function (x) { return key(x) === upgPick; })) upgPick = pieces.length ? key(pieces[0]) : null;
    var intro = h('div', 'dim');
    intro.style.cssText = 'margin:0 0 8px;font-size:.88em';
    intro.innerHTML = 'Tier 1 → <b style="color:' + TIER_COLORS[2] + '">Tier 2</b>: Star Shards + gold. Tier 2 → <b style="color:' + TIER_COLORS[3] + '">Tier 3</b>: Archon Cores + Starlight Essence + gold. Same school and slot; equipped pieces stay equipped.';
    list.appendChild(intro);
    if (!pieces.length) {
      list.insertAdjacentHTML('beforeend', '<p class="dim">Bring Tamsin a Starbound, Starwalker or Artificer piece and she will make it shine. Starbound and the Starwalker Greaves drop in the Hollow Orrery (for your school only), and she crafts the Artificer set.</p>');
      return;
    }
    var sel = pieces.filter(function (x) { return key(x) === upgPick; })[0], info = S().upgradeInfo(sel.id), from = D().items[sel.id], to = D().items[info.to];
    var chk = S().canUpgrade(sel.id, sel.where);
    var setNote = sel.where === 'equipped' && !offSchool(to) ? '<div class="it-note" style="padding:0 10px">It stays equipped; set bonuses stay the same (any tier counts).</div>' : '';
    var stage = stageLayout(list, stageTop(to, 'drag to turn · the upgraded look', 220) +
      '<div style="padding:6px 10px 2px"><div class="it-stat" style="grid-template-columns:1fr 54px 54px 58px;font-size:.74em;color:var(--dim)"><span></span><b style="color:' + TIER_COLORS[from.tier] + ';font-weight:800">T' + from.tier + '</b><b style="color:' + TIER_COLORS[to.tier] + '">T' + to.tier + '</b><i></i></div>' +
      compareRowsHTML(sel.id, info.to) + '</div>' + setNote +
      (offSchool(to) ? '<div class="it-note" style="padding:0 10px;color:' + OFF_SCHOOL_RED + '">' + U.esc(schoolName(to.school)) + ' only: upgrading it for another wizard.</div>' : ''));
    var foot = h('div', '');
    foot.style.cssText = 'padding:8px 10px 0';
    foot.innerHTML = '<div class="needs" style="margin-bottom:6px">' + needsHTML(info.needs, info.gold) + '</div>';
    var go = h('button', 'btn primary', 'Upgrade to Tier ' + to.tier);
    go.disabled = !chk.ok; go.title = chk.reason || '';
    go.onclick = function () {
      var nid = S().upgrade(sel.id, sel.where);
      if (nid) {
        sfxOr('loot_' + S().rarityId(D().items[nid]), 'loot');
        UI.toast('Tamsin upgraded it: ' + itemNameHTML(nid) + (sel.where === 'equipped' ? ' (still equipped)' : '') + '.', 'quest', 5000);
        upgPick = sel.where + ':' + nid;
        rerender();
      }
    };
    foot.appendChild(go);
    if (!chk.ok) foot.insertAdjacentHTML('beforeend', ' <span class="dim" style="font-size:.85em">' + U.esc(chk.reason) + '</span>');
    stage.appendChild(foot);
    pieces.forEach(function (x) {
      var it = D().items[x.id], inf = S().upgradeInfo(x.id), nx = D().items[inf.to], ok = S().canUpgrade(x.id, x.where).ok, row = h('div', 'inv-row r-' + S().rarityId(it));
      row.style.setProperty('--rc', rarColor(it)); row.style.cursor = 'pointer';
      if (key(x) === upgPick) { row.style.background = 'rgba(255,215,106,.10)'; row.style.boxShadow = 'inset 0 0 0 1px rgba(255,215,106,.35)'; }
      row.innerHTML = '<span data-tip="' + x.id + '" data-ctx="craft">' + iconTile(x.id, { badge: false }) + '</span><div class="inv-main">' + itemNameHTML(x.id) +
        ' <small class="dim">· ' + SLOT_NAMES[it.slot] + ' · ' + (x.where === 'equipped' ? '<b style="color:var(--gold)">Equipped</b>' : 'Backpack') + (offSchool(it) ? ' · <b style="color:' + OFF_SCHOOL_RED + '">' + U.esc(schoolName(it.school)) + ' only</b>' : '') + '</small>' +
        '<div class="slot-stats"><b style="color:' + TIER_COLORS[it.tier] + '">T' + it.tier + '</b> → <span style="color:' + TIER_COLORS[nx.tier] + ';font-weight:800">' + U.esc(nx.name) + '</span></div>' +
        '<div class="needs">' + needsHTML(inf.needs, inf.gold) + '</div></div>' + (ok ? '<span class="price" style="color:#6dff8a">Ready</span>' : '');
      row.onclick = function () { if (upgPick !== key(x)) { upgPick = key(x); WF.sfx.play('click'); rerender(); } };
      list.appendChild(row);
    });
    stageDoll('cr-doll-host', offSchool(to) ? null : info.to);
  }
  function renderSalvageTab(list) {
    var p = S().player, ess = S().count('starlight_essence');
    var ids = Object.keys(p.inventory).filter(function (id) { return S().salvageValue && S().salvageValue(id) > 0 && p.inventory[id] > 0; });
    ids.sort(function (a, b) { var A = D().items[a], B = D().items[b]; return (offSchool(B) ? 1 : 0) - (offSchool(A) ? 1 : 0) || A.tier - B.tier || A.name.localeCompare(B.name); });
    var head = h('div', '');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 0 8px';
    head.innerHTML = iconTile('starlight_essence', { badge: false }) + '<div><b style="color:#fff3c4">Starlight Essence: ' + ess + '</b><div class="dim" style="font-size:.85em">Salvage unwanted star-gear: Tier 1 → 1, Tier 2 → 3, Tier 3 → 6. Tier 3 upgrades need 10-15. Equipped gear is never salvaged.</div></div>';
    list.appendChild(head);
    if (!ids.length) { list.insertAdjacentHTML('beforeend', '<p class="dim">No spare Starbound, Starwalker or Artificer pieces in your backpack. Duplicates end up here.</p>'); return; }
    ids.forEach(function (id) {
      var it = D().items[id], n = S().salvageValue(id), eqd = p.equipped[it.slot] === id, row = h('div', 'inv-row r-' + S().rarityId(it));
      var why = offSchool(it) ? '<b style="color:' + OFF_SCHOOL_RED + '">' + U.esc(schoolName(it.school)) + ' only</b>' : (eqd || p.inventory[id] > 1) ? '<b style="color:#ffd76a">duplicate</b>' : '<span>your school</span>';
      row.style.setProperty('--rc', rarColor(it));
      row.innerHTML = '<span data-tip="' + id + '" data-ctx="pack">' + iconTile(id, { badge: false, count: p.inventory[id] }) + '</span><div class="inv-main">' + itemNameHTML(id) +
        ' <small class="dim">· ' + SLOT_NAMES[it.slot] + ' · <b style="color:' + TIER_COLORS[it.tier] + '">T' + it.tier + '</b> · ' + why + '</small>' +
        '<div class="slot-stats">→ <b style="color:#fff3c4">' + n + ' Starlight Essence</b>' + (bankAvailable() && offSchool(it) ? ' <span class="dim">· or send it to the Bank from your backpack</span>' : '') + '</div></div>';
      var b = h('button', 'btn sm', 'Salvage');
      b.onclick = function () {
        if (!window.confirm('Salvage ' + it.name + ' into ' + n + ' Starlight Essence? The piece is gone for good.')) return;
        var got = S().salvage(id);
        if (got) { WF.sfx.play('buff'); UI.toast('Tamsin took it apart: +' + got + ' <b style="color:#fff3c4">Starlight Essence</b>.', 'quest'); rerender(); }
      };
      row.appendChild(b);
      list.appendChild(row);
    });
  }
  function renderShop() {
    var p = S().player, body = el('sh-body'), npc = D().npcs[shopNpc];
    hideTip();
    var hasShop = npc.vendor && npc.vendor.length, recipes = S().recipesAt(shopNpc);
    var stable = hasShop && npc.vendor.some(function (id) { return D().items[id] && D().items[id].type === 'mount'; });
    var tabs = (hasShop ? ['buy', 'sell'] : []).concat(recipes.length ? ['craft'] : []).concat(S().isUpgrader && S().isUpgrader(shopNpc) ? ['upgrade', 'salvage'] : []);   // v1.2 WS2: Tamsin
    if (tabs.indexOf(shopTab) < 0) shopTab = tabs[0];
    var common = shopTab === 'sell' ? S().sellAllCommonGear(true) : null;
    body.innerHTML = '<div class="sh-top"><div class="sh-gold"><span class="coin"></span> <b>' + U.fmt(p.gold) + '</b> gold</div>' +
      (common && common.count ? '<button class="btn sm" id="sh-sellcommon" title="Sell every Common gear piece in your backpack (equipped gear is safe)">Sell all Common gear (' + common.count + ') · +' + U.fmt(common.gold) + ' g</button>' : '') + '</div>' +
      // v1.2 WS2: a crafter with nothing but recipes (Tamsin) gets a heading instead of a lone tab
      (tabs.length === 1 && tabs[0] === 'craft' ? '<div class="dim" style="margin:8px 0 12px">Crafting · bring the reagents and the gold and you get exactly what you ask for, no luck involved. Hover a piece for its full stats.</div>'
        : '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (shopTab === t ? ' on' : '') + '" data-t="' + t + '">' + (t === 'buy' && stable ? 'Mounts' : t) + '</button>'; }).join('') + '</div>') +
      '<div class="pk-list"></div>';
    var list = body.querySelector('.pk-list');
    if (shopTab === 'craft') renderCraftTab(list, recipes);
    else if (shopTab === 'upgrade') renderUpgradeTab(list);
    else if (shopTab === 'salvage') renderSalvageTab(list);
    else {
      var ids = shopTab === 'buy' ? (npc.vendor || []).filter(function (id) { var it = D().items[id]; return it && (!it.level || it.level <= p.level + 3); })
        : Object.keys(p.inventory).sort(function (a, b) {
          var A = D().items[a], B = D().items[b];
          var t = function (x) { return { gear: 1, mount: 2, potion: 3, reagent: 4 }[x.type] || 5; };
          return t(A) - t(B) || (rar(A).order - rar(B).order) || (A.level || 0) - (B.level || 0);
        });
      ids.forEach(function (id) {
        var it = D().items[id]; if (!it) return;
        var row = h('div', 'inv-row r-' + S().rarityId(it));
        row.style.setProperty('--rc', rarColor(it));
        var price = shopTab === 'buy' ? it.price : (it.sell || 1);
        var sub = it.type === 'gear' ? SLOT_NAMES[it.slot] + ' · Lv ' + it.level + (it.school ? ' · ' + U.esc(D().schools[it.school].name) + ' only' : '')
          : it.type === 'mount' ? '+' + Math.round((it.speed || 0) * 100) + '% speed · ' + (p.level < it.level ? '<span class="bad">ride from Lv ' + it.level + '</span>' : 'Lv ' + it.level) : '';
        var tipable = it.type === 'gear' || it.type === 'mount';
        row.innerHTML = '<span' + (tipable ? ' data-tip="' + id + '" data-ctx="' + (shopTab === 'buy' ? 'shop' : 'pack') + '"' : '') + '>' + iconTile(id, { badge: false }) + '</span>' +
          '<div class="inv-main">' + itemNameHTML(id) + rarityTag(it) + (shopTab === 'sell' ? ' <span class="dim">×' + p.inventory[id] + '</span>' : '') +
          (sub ? ' <small class="dim">' + sub + '</small>' : '') +
          (it.type === 'gear' ? '<div class="slot-stats">' + statsText(it.stats) + '</div>' : '<div class="dim">' + U.esc(it.type === 'mount' ? (it.desc || '') : (it.desc || '')) + '</div>') +
          '</div><span class="price">' + U.fmt(price) + ' g</span>';
        var chk = shopTab === 'buy' ? S().canBuy(id) : null;
        var b = h('button', 'btn sm primary', shopTab === 'buy' ? (chk.reason === 'Already in your stable' ? 'Owned' : 'Buy') : 'Sell');
        if (shopTab === 'buy') {
          b.disabled = !chk.ok; b.title = chk.reason || '';
          b.onclick = function () {
            if (S().buy(id)) {
              WF.sfx.play('gold');
              if (it.type === 'mount') {
                if (!p.equipped.mount) S().equipMount(id);
                UI.toast('<b>' + U.esc(it.name) + '</b> joins your stable! Press <b>R</b> to ride.', 'quest', 5000);
              } else UI.toast('Bought ' + itemNameHTML(id) + '.');
              S().save(); rerender();
            }
          };
          if ((it.type === 'gear' || it.type === 'mount') && p.level < it.level) row.classList.add('locked');
        } else {
          b.onclick = function () { if (S().sell(id)) { WF.sfx.play('gold'); S().save(); rerender(); } };
        }
        row.appendChild(b);
        list.appendChild(row);
      });
    }
    if (!list.children.length) list.innerHTML = '<p class="dim">Nothing here.</p>';
    body.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { shopTab = b.getAttribute('data-t'); rerender(); }; });
    var sc = el('sh-sellcommon');
    if (sc) sc.onclick = function () {
      var pv = S().sellAllCommonGear(true);
      if (!pv.count || !window.confirm('Sell ' + pv.count + ' Common gear piece' + (pv.count > 1 ? 's' : '') + ' for ' + pv.gold + ' gold? Equipped gear is not sold.')) return;
      var r = S().sellAllCommonGear(false);
      WF.sfx.play('gold'); UI.toast('Sold ' + r.count + ' Common piece' + (r.count > 1 ? 's' : '') + ' for <b>' + r.gold + '</b> gold.');
      S().save(); rerender();
    };
    bindTips(body, 'shop');
  }

  // ---- Menu
  function renderMenu() {
    var p = S().player, body = el('mn-body'), st = p.settings;
    var mins = Math.round((p.stats.playTime || 0) / 60);
    var ver = (WF.main.appVersions && WF.main.appVersions()) || { game: WF.main.VERSION }, desk = !!ver.desktop;   // v1.2 WS5
    body.innerHTML =
      '<div class="mn-row"><button class="btn primary" id="mn-resume">Resume</button><button class="btn" id="mn-save">Save Game</button>' +
      '<button class="btn" id="mn-switch" title="Save and go back to Choose your Wizard">Switch Wizard</button></div>' +   // v1.2 WS5
      '<h4>Settings</h4>' +
      '<label class="mn-set">Master volume <input type="range" id="mn-vol" min="0" max="100" value="' + Math.round(st.master * 100) + '"></label>' +
      '<label class="mn-set">Music volume <input type="range" id="mn-mus" min="0" max="100" value="' + Math.round(st.music * 100) + '"></label>' +
      '<label class="mn-set">Graphics <select id="mn-gfx">' + gfxOptions() + '</select> <span class="dim">now: ' + U.esc(WF.world.quality) + '</span></label>' +
      '<label class="mn-set"><input type="checkbox" id="mn-motion"' + (st.reduceMotion ? ' checked' : '') + '> Reduce camera motion & pulsing effects</label>' +
      '<div class="mn-row"><button class="btn" id="mn-full">Fullscreen (F11)</button></div>' +
      '<label class="mn-set">Text size <select id="mn-text"><option value="1">Normal</option><option value="1.15">Large</option><option value="1.3">Extra large</option></select></label>' +
      '<h4>Controls</h4>' +
      '<div class="controls">' +
      '<div><b>W / S</b> move forward / back &nbsp; <b>A / D</b> turn &nbsp; <b>Q / Z</b> strafe &nbsp; <b>Shift</b> run &nbsp; <b>Space</b> jump (also on a mount)</div>' +
      '<div><b>Drag mouse</b> rotate camera &nbsp; <b>Wheel</b> zoom &nbsp; <b>Both mouse buttons</b> run forward</div>' +
      '<div><b>E</b> or click: talk / interact &nbsp; <b>R</b> ride / dismount &nbsp; <b>L</b> quest log &nbsp; <b>K</b> spellbook &nbsp; <b>B</b> backpack &nbsp; <b>H / J</b> health / mana potion</div>' +
      '<div><b>In duels:</b> click a card or press <b>1–7</b>; when choosing a target press the enemy’s number. Right-click or <b>Shift+1–7</b> discards, <b>T</b> Spell Scrolls, <b>P</b> pass, <b>Space</b> skips boss speeches.</div>' +
      '<div><b>In conversations:</b> Space/Enter = main button, <b>1–9</b> = choose a button, Esc = close.</div>' +
      '</div>' +
      '<h4>Your wizard</h4><div class="dim">Played ' + U.fmt(mins) + ' min &middot; ' + U.fmt(p.stats.fights || 0) + ' duels &middot; ' + U.fmt(p.stats.deaths || 0) + ' defeats' + (p.bankedXp ? ' &middot; ' + U.fmt(p.bankedXp) + ' XP banked for the next chapter' : '') + '</div>' +
      levelTimesHTML(p) +
      // ---- v1.2 WS5: wizards & saves (3 slots, export one/all, import, desktop updates)
      '<h4>Wizards &amp; saves</h4>' +
      '<div class="mn-row"><button class="btn" id="mn-export" title="Save this wizard to a file">Export this wizard</button>' +
      '<button class="btn" id="mn-export-all" title="Save all your wizards to one file">Export all wizards</button></div>' +
      '<div class="mn-row"><button class="btn" id="mn-import" title="Add wizards from a file into empty slots">Import save file</button><input type="file" id="mn-file" accept=".json,application/json" class="hidden">' +
      (desk ? '<button class="btn" id="mn-updates">Check for updates</button>' : '') + '</div>' +
      '<div class="mn-row"><button class="btn btn-ghost" id="mn-title">Save &amp; quit to title</button>' +
      (desk ? '<button class="btn btn-ghost" id="mn-quit">Save &amp; quit game</button>' : '') + '</div>' +
      '<div class="dim mn-ver">Wizzie Farm v' + U.esc(ver.game) + (ver.shell ? ' &middot; desktop app ' + U.esc(ver.shell) : '') + '</div>';
    el('mn-text').value = String(st.textScale || 1);
    el('mn-resume').onclick = function () { UI.closeAll(); };
    el('mn-save').onclick = function () { S().save() ? UI.toast('Game saved.') : UI.toast('Could not save (browser storage blocked).', 'warn'); };
    el('mn-vol').oninput = function () { st.master = this.value / 100; WF.sfx.setVolume(st.master, st.music); };
    el('mn-mus').oninput = function () { st.music = this.value / 100; WF.sfx.setVolume(st.master, st.music); };
    el('mn-vol').onchange = el('mn-mus').onchange = function () { S().save(); };
    el('mn-gfx').value = st.graphics || (st.lowGraphics ? 'low' : 'auto');
    if (!el('mn-gfx').value) el('mn-gfx').value = 'auto';
    el('mn-gfx').onchange = function () {
      st.graphics = this.value; st.lowGraphics = this.value === 'low';
      WF.world.setQuality(this.value === 'auto' ? 'high' : this.value);
      if (this.value === 'auto' && WF.main.startProbe) WF.main.startProbe();
      S().save(); renderMenu();
    };
    el('mn-motion').onchange = function () { st.reduceMotion = this.checked; document.body.classList.toggle('reduce-motion', this.checked); S().save(); };
    el('mn-full').onclick = function () {
      try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
    };
    el('mn-text').onchange = function () { st.textScale = parseFloat(this.value); UI.applyTextScale(); S().save(); };
    // ---- v1.2 WS5: wizards & saves
    el('mn-switch').onclick = function () { UI.closeAll(true); WF.main.switchWizard(); };
    el('mn-export').onclick = function () { S().save(); WF.main.exportActive(); UI.toast('Wizard exported.'); };
    el('mn-export-all').onclick = function () { S().save(); WF.main.exportAll(); };
    el('mn-import').onclick = function () { el('mn-file').click(); };
    el('mn-file').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader();
      // never replaces a wizard: imports go into empty slots (play them with Switch Wizard)
      r.onload = function () {
        S().save();
        var res = WF.main.importIntoEmpty(String(r.result || ''));
        if (!res.ok) UI.toast(U.esc(res.error || 'That file is not a valid Wizzie Farm save.'), 'warn', 6000);
        else if (!res.imported.length) UI.toast('All 3 wizard slots are full. Use Switch Wizard to delete one, then import from there.', 'warn', 8000);
        else UI.toast('Imported <b>' + res.names.map(U.esc).join(', ') + '</b> into slot ' + res.imported.map(function (i) { return i + 1; }).join(', ') + '. Use Switch Wizard to play.' + (res.full ? ' (' + res.full + ' did not fit.)' : '') + ((WF.main.importBankNote && WF.main.importBankNote(res)) || ''), 'quest', 9000);
      };
      r.readAsText(f);
      this.value = '';
    };
    el('mn-title').onclick = function () { WF.main.quitToTitle(); };
    if (el('mn-updates')) el('mn-updates').onclick = function () { WF.main.checkUpdates(true); };
    if (el('mn-quit')) el('mn-quit').onclick = function () { S().save(); if (window.wfNative && window.wfNative.app) window.wfNative.app.quit(); };
  }
  // Graphics tiers: WF.gfx.qualities when the renderer module offers them (v1.1)
  var QUALITY_LABEL = { ultra: 'Ultra', high: 'High', medium: 'Medium', low: 'Low (fastest)' };
  function gfxOptions() {
    var q = (WF.gfx && Array.isArray(WF.gfx.qualities) && WF.gfx.qualities.length) ? WF.gfx.qualities : ['high', 'medium', 'low'];
    return '<option value="auto">Auto (recommended)</option>' + q.map(function (k) { return '<option value="' + U.esc(k) + '">' + U.esc(QUALITY_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1))) + '</option>'; }).join('');
  }
  function levelTimesHTML(p) {
    var la = p.stats.levelAt || {};
    var keys = Object.keys(la).map(Number).filter(function (l) { return l > 1; }).sort(function (a, b) { return a - b; });
    if (!keys.length) return '';
    return '<div class="dim lvl-times">Reached: ' + keys.map(function (l) { return 'L' + l + ' at ' + Math.round(la[l] / 60) + 'm'; }).join(' &middot; ') + '</div>';
  }

  UI.applyTextScale = function () {
    var p = S().player;
    document.documentElement.style.setProperty('--ts', (p && p.settings.textScale) || 1);
    document.body.classList.toggle('reduce-motion', !!(p && p.settings.reduceMotion));
  };

  // ------------------------------------------------------------------
  // Duel results, level up, spell learning, ending
  // ------------------------------------------------------------------
  function sfxOr(name, fallback) {
    var list = WF.sfx && WF.sfx.list;
    if (list && (Array.isArray(list) ? list.indexOf(name) < 0 : !list[name]) && fallback) WF.sfx.play(fallback);
    else WF.sfx.play(name);
  }
  UI.showResults = function (r) {
    return new Promise(function (resolve) {
      var box = el('results');
      var html, best = null;
      hideTip();
      box.classList.remove('rv-epic', 'rv-legendary');
      if (r.result === 'win') {
        var L = r.loot, p = S().player;
        html = '<div class="rs-title win">Victory!</div>';
        (r.freed || []).forEach(function (f) { html += '<div class="rs-freed">“' + U.esc(U.fillText(f.line)) + '”</div>'; });
        html += '<div class="rs-grid"><div class="rs-xp">+' + U.fmt(L.xp) + ' XP</div><div class="rs-gold">+' + U.fmt(L.gold) + ' gold</div></div>';
        // v2.0 M1 (WS-A): Runeglass from bosses (spend it at the Spellwright in Lanternmere)
        if (L.runeglass) html += '<div class="rs-runeglass" style="text-align:center;color:#9fe6ff;font-weight:800;margin:4px 0" title="Shards of the Orrery\'s star-lenses. The Spellwright in Lanternmere grinds them into your spells.">◈ +' + L.runeglass + ' Runeglass</div>';
        var ord = function (id) { var it = D().items[id]; return it && (it.type === 'gear' || it.type === 'mount') ? (rar(it).order || 0) + (it.type === 'mount' ? 0.5 : 0) : -1; };
        var items = Object.keys(L.items).sort(function (a, b) { return ord(b) - ord(a); }), tcs = Object.keys(L.tcs);
        items.forEach(function (id) { var it = D().items[id]; if (it && (it.type === 'gear' || it.type === 'mount') && (!best || rar(it).order > rar(D().items[best]).order)) best = id; });
        var bestR = best ? S().rarityId(best) : null, bestO = best ? rar(D().items[best]).order : -1;
        if (best && bestO >= 3) {
          var bi = D().items[best];
          html = '<div class="rs-reveal r-' + bestR + '" style="--rc:' + rarColor(bi) + '"><div class="rv-rays"></div><div class="rv-banner">' + (bestR === 'legendary' ? '✦ LEGENDARY ✦' : '✦ EPIC ✦') + '</div>' +
            '<div class="rv-item">' + iconTile(best, { big: true, badge: false }) + '<div class="rv-name" style="color:' + rarColor(bi) + '">' + U.esc(bi.name) + '</div>' +
            '<div class="rv-sub">' + (bi.type === 'mount' ? 'Mount · +' + Math.round(bi.speed * 100) + '% speed' : SLOT_NAMES[bi.slot] + ' · Level ' + bi.level) + '</div></div></div>' + html;
          box.classList.add('rv-' + bestR);
        }
        if (items.length || tcs.length) {
          html += '<div class="rs-loot"><b>Loot</b>' + items.map(function (id) {
            var it = D().items[id], gear = it && it.type === 'gear', mount = it && it.type === 'mount';
            if (!it) return '';
            var canUp = gear && S().canEquip(id) && S().gearScore(it) > S().gearScore(p.equipped[it.slot] ? D().items[p.equipped[it.slot]] : null);
            return '<div class="rs-item' + (gear || mount ? ' gear r-' + S().rarityId(it) : '') + '"' + (gear || mount ? ' data-tip="' + id + '" data-ctx="pack" style="--rc:' + rarColor(it) + '"' : '') + '>' +
              (gear || mount ? iconTile(id, { size: 26, badge: false }) : '<span class="dotc" style="background:' + (it.color || '#e0c070') + '"></span>') +
              '<span class="rs-iname">' + (L.items[id] > 1 ? L.items[id] + ' × ' : '') + (gear || mount ? itemNameHTML(id) + rarityTag(it) : U.esc(it.name)) +
              (mount ? ' <small>(new mount!)</small>' : '') + '</span>' +
              (canUp ? '<button class="btn sm primary rs-equip" data-equip="' + id + '">Equip ▲</button>' : '') + '</div>';
          }).join('') + tcs.map(function (id) { return '<div class="rs-item tc"><span class="itile r-common scroll"><span class="scroll-glyph">✦</span></span><span class="rs-iname">Spell Scroll: ' + U.esc(D().cards[id].name) + ' ×' + L.tcs[id] + '</span></div>'; }).join('') + '</div>';
          if (bestO >= 1) sfxOr('loot_' + bestR, bestO >= 3 ? 'levelup' : 'loot');
          else WF.sfx.play('loot');
        }
        if (r.quests && r.quests.length) {
          html += '<div class="rs-quests">' + r.quests.map(function (u) { return '<div>' + (u.ready ? '✔ ' : '• ') + '<b>' + U.esc(D().quests[u.qid].name) + '</b>: ' + U.esc(u.text) + '</div>'; }).join('') + '</div>';
        }
      } else {
        html = '<div class="rs-title lose">Defeated…</div><p>' + U.esc(uiText('defeat', 'The Lumen Order’s healers carry you home. Rest, buy potions, or tune your deck and try again.')) + '</p>';
      }
      html += '<button class="btn primary" id="rs-ok">Continue</button>';
      box.innerHTML = html;
      box.classList.remove('hidden');
      if (r.result === 'win' && r.freed && r.freed.length && WF.voice) WF.voice.sayAll(r.freed.map(function (f) { return { speaker: f.id, text: f.line, kind: 'freed' }; }));   // ---- v1.2 WS7
      box.querySelectorAll('[data-equip]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          var id = b.getAttribute('data-equip');
          if (S().equip(id)) { WF.sfx.play('buff'); S().save(); b.textContent = 'Equipped ✔'; b.disabled = true; UI.refreshHUD(); }
        };
      });
      bindTips(box, 'pack');
      var closed = false;
      var key = function (e) { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(); } };
      var done = function () {
        if (closed) return;
        closed = true;
        hideTip();
        box.classList.add('hidden');
        box.classList.remove('rv-epic', 'rv-legendary');
        window.removeEventListener('keydown', key, true);
        resolve();
      };
      el('rs-ok').onclick = done;
      setTimeout(function () { if (!closed) window.addEventListener('keydown', key, true); }, best && rar(D().items[best]).order >= 3 ? 900 : 400);
    });
  };

  var overlayDone = [];
  function afterOverlays(fn) { if (!overlayShowing && !overlayQueue.length) fn(); else overlayDone.push(fn); }

  UI.levelUp = function (u) {
    overlayQueue.push(u);
    if (!overlayShowing) nextOverlay();
  };
  UI.ending = function (q) {
    overlayQueue.push({ ending: q || {} });
    if (!overlayShowing) nextOverlay();
  };

  function nextOverlay() {
    var u = overlayQueue.shift();
    var box = el('levelup');
    if (!u) {
      overlayShowing = false; box.classList.remove('show');
      var cbs = overlayDone; overlayDone = [];
      cbs.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      return;
    }
    overlayShowing = true;
    var p = S().player, sc = D().schools[p.school];
    var html;
    if (u.ending) {
      var lines = u.ending.ending || lore().ending || ['The story will continue in the next chapter.'];
      html = '<div class="lu-inner"><div class="lu-title">' + U.esc(u.ending.endingTitle || lore().endingTitle || 'Chapter Complete') + '</div>' +
        lines.map(function (l) { return '<p' + (l === lore().endCard ? ' class="end-card"' : '') + '>' + U.esc(U.fillText(l)) + '</p>'; }).join('') +   // v2.0 WS-E (R16)
        '<p class="dim">You can keep exploring, farming bosses for rare gear and Spell Scrolls, and crafting. More chapters are coming in a future update.</p>' +
        '<button class="btn primary" id="lu-ok">Continue</button></div>';
      WF.sfx.play('victory');
      if (WF.voice) u.voiceT = setTimeout(function () { WF.voice.sayLines('narrator', lines); }, 1800);   // ---- v1.2 WS7: after the fanfare
    } else if (u.learned) {
      var tl = (lore().trainerLines || {})[u.npc] || {};
      html = '<div class="lu-inner"><div class="lu-title">New Spells!</div>' +
        '<div class="lu-sub">' + U.esc(D().npcs[u.npc] ? D().npcs[u.npc].name : '') + ' teaches you:</div><div class="lu-cards"></div>' +
        (tl.after ? '<p>' + U.esc(U.fillText(tl.after)) + '</p>' : '') +
        '<div class="lu-stats">New spells were added to your deck. Adjust it any time in the Spellbook (K).</div>' +
        '<button class="btn primary" id="lu-ok">Wonderful!</button></div>';
    } else {
      var st = S().stats(), trainer = D().npcs[S().trainerId()];
      // v1.2 WS2: what this level added (natural health/mana; schools.js, projected levelScaling above L10)
      var gain = S().levelGain ? S().levelGain(u.level) : null;
      html = '<div class="lu-inner"><div class="lu-title">Level Up!</div><div class="lu-level" style="color:' + sc.color + '">Level ' + u.level + '</div>' +
        (gain && (gain.hp || gain.mana) ? '<div class="lu-gain" style="font-weight:800;font-size:1.15em;margin:2px 0 6px;color:#9ff0b5">' + [gain.hp ? '+' + gain.hp + ' Max Health' : '', gain.mana ? '+' + gain.mana + ' Max Mana' : ''].filter(Boolean).join(', ') + '</div>' : '') +
        '<div class="lu-stats">Health ' + (u.maxHp || st.maxHp) + ' &middot; Mana ' + (u.maxMana || st.maxMana) + ' &middot; fully restored' + (u.points ? ' &middot; <b style="color:var(--gold)">+' + u.points + ' training point</b>' : '') + '</div>' +
        (u.cards && u.cards.length ? '<div class="lu-sub">New spells are ready to learn — visit <b>' + U.esc(trainer ? trainer.name : 'your trainer') + '</b>:</div><div class="lu-cards"></div>' : '<div class="lu-sub dim">No new spells this level — keep going!</div>') +
        (u.level >= D().progression.maxLevel ? '<div class="lu-sub">You reached the current level cap!</div>' : '') +
        '<button class="btn primary" id="lu-ok">Awesome!</button></div>';
      WF.sfx.play('levelup');
    }
    box.innerHTML = html;
    var cards = box.querySelector('.lu-cards');
    var list = u.learned || u.cards || [];
    if (cards) list.forEach(function (cid) { cards.appendChild(UI.cardEl(cid, { disabled: !u.learned })); });
    box.classList.add('show');
    el('lu-ok').onclick = function () {
      if (u.ending) { clearTimeout(u.voiceT); voiceStop(); }   // ---- v1.2 WS7
      box.classList.remove('show');
      UI.refresh();
      if (u.cards && u.cards.length && !u.learned && !overlayQueue.length) UI.toast(uiText('trainerReminder', '{trainer} has new spells for you!').replace('{trainer}', U.esc((D().npcs[S().trainerId()] || {}).name || 'Your trainer')), 'quest');
      setTimeout(nextOverlay, 220);
    };
  }

  return UI;
})();
