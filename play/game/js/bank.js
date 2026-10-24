// =====================================================================
//  WIZZIE FARM — v1.2 WS9: the Lanternmere Vault (the shared account Bank's UI)
//
//  Jorge: "Create some sort of banking system where you could transfer gear to the
//  other wizards you have."  Data layer: WF.state bank APIs (WS5, docs/V1.2-CONTRACT.md
//  §6.2): bank(), bankCount(), bankUsed(), canDeposit(), deposit(), canWithdraw(),
//  withdraw(); 120 spaces shared by the account's 3 wizards.
//
//  This file has two halves:
//   1. LOGIC (no DOM; unit-tested in Node by tests/bank-ui.test.js): which zones have a
//      Vault (any zone that places an NPC with role 'banker'), the two lists (backpack /
//      vault) with filters + sorting, moving one / a whole stack, "send all off-school
//      gear", friendly reasons when a move is blocked, and which of your other wizards
//      can wear a piece.
//   2. PANEL (DOM): the two-pane Bank (Backpack ⇄ Vault) drawn inside WF.ui's side panel
//      (ui.js renderPanel('bank') calls WF.bank.render). It reuses the backpack's tiles,
//      rarity frames, NEW badges and tooltips through WF.ui.items.
//  Opening: talk to Orsolya (ui.js talkTo → UI.openBank) or the backpack's Vault button
//  while standing in a zone that has a Vault. The backpack's "Send to Bank" deposits
//  straight away there; anywhere else it says where the Vault is.
//  Every move is one account write (bank + this wizard), done by the data layer.
// =====================================================================
window.WF = window.WF || {};
WF.bank = (function () {
  var B = {};
  var S = function () { return WF.state; }, D = function () { return WF.data; };
  var U = function () { return WF.util; };

  // ------------------------------------------------------------------
  // 1. LOGIC
  // ------------------------------------------------------------------
  B.CATS = [['all', 'All'], ['gear', 'Gear'], ['mount', 'Mounts'], ['deck', 'Decks'], ['potion', 'Potions'], ['reagent', 'Reagents']];
  B.RARITY_FILTERS = ['uncommon', 'rare', 'epic', 'legendary'];
  var TYPE_ORDER = { gear: 0, mount: 1, deck: 2, potion: 3, reagent: 4 };
  var SLOT_ORDER = { hat: 0, robe: 1, boots: 2, wand: 3, amulet: 4 };
  var WORN_SLOTS = ['hat', 'robe', 'boots', 'wand', 'amulet', 'mount'];

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function item(id) { return has(D().items, id) ? D().items[id] : null; }
  function rarOrder(it) { var r = (D().rarities || {})[(it && it.rarity) || 'common']; return r ? (r.order || 0) : 0; }
  function nameOf(id) { var it = item(id); return it ? it.name : id; }
  function perPiece(it) { return !!it && (it.type === 'gear' || it.type === 'mount' || it.type === 'deck'); }
  function player() { return S().player; }

  // ---- Where the Vault is (data-driven: any zone placing a role 'banker' NPC)
  B.bankerIn = function (zid) {
    var z = zid && has(D().zones, zid) ? D().zones[zid] : null;
    if (!z) return null;
    var n = (z.npcs || []).filter(function (x) { var d = D().npcs[x.id]; return d && d.role === 'banker'; })[0];
    return n ? n.id : null;
  };
  B.vaultZones = function () { return Object.keys(D().zones).filter(function (z) { return !!B.bankerIn(z); }); };
  B.zone = function () { return (WF.world && WF.world.zoneId) || (player() && player().zone) || null; };
  // true while the active wizard stands in a zone with a Vault (and is not in a duel)
  B.here = function () {
    if (!player()) return false;
    if (WF.world && (WF.world.mode === 'combat' || WF.world.mode === 'title' || WF.world.mode === 'loading')) return false;
    return !!B.bankerIn(B.zone());
  };
  // the banker of this zone, else the first one anywhere
  B.banker = function (zid) { return B.bankerIn(zid || B.zone()) || B.bankerIn(B.vaultZones()[0]) || null; };
  function bankerData(npcId) { var id = npcId || B.banker(); return (id && D().npcs[id]) || null; }
  B.vaultName = function (npcId) { var d = bankerData(npcId); return (d && d.vault && d.vault.name) || 'Bank'; };
  B.shortName = function (npcId) { var d = bankerData(npcId); return (d && d.vault && d.vault.short) || 'Bank'; };
  // "Visit the Lanternmere Vault (Orsolya Coffersmith) to send it to your other wizards."
  B.whereText = function () {
    var d = bankerData();
    if (!d) return 'There is no Bank in this world yet.';
    return 'Visit the ' + B.vaultName() + ' (' + d.name + ') to send it to your other wizards.';
  };

  // ---- Off-school gear (another school's piece: this wizard can never wear it)
  B.isOffSchool = function (id) {
    var it = item(id), p = player();
    return !!(it && p && it.type === 'gear' && it.school && it.school !== p.school);
  };
  // Your OTHER wizards whose school can wear id: [{ slot, name, school, level, ready }]
  B.wearers = function (id) {
    var it = item(id);
    if (!it || it.type !== 'gear' || !it.school || typeof S().slots !== 'function') return [];
    var me = typeof S().activeSlot === 'function' ? S().activeSlot() : null;
    return S().slots().map(function (s, i) { return s ? { slot: s.slot != null ? s.slot : i, name: s.name, school: s.school, level: s.level || 1 } : null; })
      .filter(function (s) { return s && s.slot !== me && s.school === it.school && !s.damaged; })
      .map(function (s) { s.ready = s.level >= (it.level || 1); return s; });
  };
  // the names of all wizards on the account (the Vault is shared by them)
  B.wizardNames = function () {
    if (typeof S().slots !== 'function') return player() ? [player().name] : [];
    return S().slots().filter(function (s) { return s && s.name; }).map(function (s) { return s.name; });
  };

  // ---- The two lists
  // Backpack side: everything the wizard carries, plus what they wear (listed, locked)
  // [{ key, side:'pack', id, n, equipped:false|'hat'|..|'mount'|'deck' }]
  B.packEntries = function () {
    var p = player(), out = [], byId = {};
    if (!p) return out;
    Object.keys(p.inventory || {}).forEach(function (id) {
      var it = item(id), n = Math.floor(p.inventory[id] || 0);
      if (!it || n <= 0) return;
      var e = { key: 'pack:' + id, side: 'pack', id: id, n: n, equipped: false };
      out.push(e); byId[id] = e;
    });
    // deck items live in p.decks (WS3), one of each
    var decks = typeof S().ownedDecks === 'function' ? S().ownedDecks() : [];
    decks.forEach(function (id) {
      if (!item(id)) return;
      var eq = p.equipped && p.equipped.deck === id ? 'deck' : false;
      if (byId[id]) { byId[id].n += 1; if (eq) byId[id].equipped = eq; return; }
      out.push({ key: 'pack:' + id, side: 'pack', id: id, n: 1, equipped: eq });
    });
    WORN_SLOTS.forEach(function (slot) {
      var id = p.equipped && p.equipped[slot];
      if (id && item(id)) out.push({ key: 'worn:' + slot, side: 'pack', id: id, n: 1, equipped: slot });
    });
    return out;
  };
  B.vaultEntries = function () {
    var items = S().bank().items;
    return Object.keys(items).filter(function (id) { return item(id) && items[id] > 0; })
      .map(function (id) { return { key: 'vault:' + id, side: 'vault', id: id, n: items[id], equipped: false }; });
  };
  // f = { cat: 'all'|'gear'|'mount'|'deck'|'potion'|'reagent', rarity: 'all'|<rarity id> (that or better), off: bool }
  B.matches = function (e, f) {
    var it = item(e.id);
    if (!it) return false;
    f = f || {};
    if (f.cat && f.cat !== 'all' && it.type !== f.cat) return false;
    if (f.rarity && f.rarity !== 'all') {
      var need = ((D().rarities || {})[f.rarity] || {}).order || 0;
      if (!it.rarity || rarOrder(it) < need) return false;
    }
    if (f.off && !B.isOffSchool(e.id)) return false;
    return true;
  };
  function typeRank(it) { return has(TYPE_ORDER, it.type) ? TYPE_ORDER[it.type] : 9; }
  // Backpack: off-school gear first (that is what you came to store). Vault: what this wizard
  // can wear first, other schools' pieces after. Worn things last; then type, rarity, tier, level.
  function cmp(a, b) {
    var A = item(a.id), Bi = item(b.id), off = a.side === 'vault' ? 1 : -1;
    return (a.equipped ? 1 : 0) - (b.equipped ? 1 : 0) ||
      typeRank(A) - typeRank(Bi) ||
      off * ((B.isOffSchool(a.id) ? 1 : 0) - (B.isOffSchool(b.id) ? 1 : 0)) ||
      rarOrder(Bi) - rarOrder(A) || (Bi.tier || 0) - (A.tier || 0) || (Bi.level || 0) - (A.level || 0) ||
      (SLOT_ORDER[A.slot] || 0) - (SLOT_ORDER[Bi.slot] || 0) || A.name.localeCompare(Bi.name);
  }
  B.list = function (side, f) { return (side === 'vault' ? B.vaultEntries() : B.packEntries()).filter(function (e) { return B.matches(e, f); }).sort(cmp); };
  // entries per category (for the tab counters), ignoring the category filter itself
  B.counts = function (side, f) {
    var base = { rarity: (f || {}).rarity, off: (f || {}).off }, out = {};
    B.CATS.forEach(function (c) { out[c[0]] = 0; });
    (side === 'vault' ? B.vaultEntries() : B.packEntries()).forEach(function (e) {
      if (!B.matches(e, base)) return;
      out.all++; out[item(e.id).type] = (out[item(e.id).type] || 0) + 1;
    });
    return out;
  };
  B.capacity = function () { var b = S().bank(); return { used: b.used, capacity: b.capacity, free: b.free }; };

  // How many a "whole stack" move is: the backpack's unequipped copies, or the Vault's count.
  // Mounts and decks are one at a time (each wizard owns one of each).
  B.stackSize = function (side, id) {
    var it = item(id), p = player();
    if (!it || !p) return 0;
    if (side === 'vault') return (it.type === 'mount' || it.type === 'deck') ? Math.min(1, S().bankCount(id)) : S().bankCount(id);
    if (it.type === 'deck') return 1;
    if (it.type === 'mount') return Math.min(1, (p.inventory || {})[id] || 0);
    return (p.inventory || {})[id] || 0;
  };

  // Can n of entry e move to the other side? -> { ok, code, reason, action }
  // code: 'worn' | 'riding' | 'onlyDeck' | 'full' | 'stable' | 'haveDeck' | 'none' | 'locked' | 'other'
  B.check = function (e, n) {
    var it = item(e.id), p = player();
    n = n == null ? 1 : n;
    if (!p) return { ok: false, code: 'other', reason: 'No wizard is playing.' };
    if (!it) return { ok: false, code: 'other', reason: 'Unknown item.' };
    if (e.side === 'pack' && e.equipped && e.equipped !== 'deck') {
      if (e.equipped === 'mount') return { ok: false, code: 'riding', action: 'unequipMount', reason: it.name + ' is your active mount. Send it to the stable first (or use the button).' };
      return { ok: false, code: 'worn', action: 'unequip', reason: 'You are wearing the ' + it.name + '. Take it off first (or use the button).' };
    }
    var r = e.side === 'pack' ? S().canDeposit(e.id, n) : S().canWithdraw(e.id, n);
    if (r.ok) return { ok: true };
    var why = String(r.reason || ''), cap = S().bank().capacity;
    if (/full/i.test(why)) return { ok: false, code: 'full', reason: 'The ' + B.vaultName() + ' is full (' + cap + ' / ' + cap + ' spaces). Take something out first.' };
    if (/only usable deck/i.test(why)) return { ok: false, code: 'onlyDeck', reason: 'The ' + it.name + ' is the only deck you can use. Get another deck first (Pip Quickcoin sells them).' };
    if (/stable/i.test(why)) return { ok: false, code: 'stable', reason: p.name + ' already has ' + it.name + ' in the stable. Each wizard keeps one of each mount.' };
    if (/already have this deck/i.test(why)) return { ok: false, code: 'haveDeck', reason: p.name + ' already owns the ' + it.name + '. Each wizard keeps one of each deck.' };
    if (/unequip/i.test(why)) return { ok: false, code: 'worn', action: it.type === 'mount' ? 'unequipMount' : 'unequip', reason: 'Take the ' + it.name + ' off first.' };
    if (/paus/i.test(why)) return { ok: false, code: 'locked', reason: 'Saving is paused, so nothing can move right now.' };
    if (/don.t have|only have|not in the bank|only has/i.test(why)) return { ok: false, code: 'none', reason: why + '.' };
    return { ok: false, code: 'other', reason: why ? why + '.' : 'That can’t move right now.' };
  };

  // Move one ('one') or the whole stack ('stack') of entry e to the other side.
  // A whole stack of gear that only partly fits moves as many as fit (partial: true).
  // -> { ok, moved, wanted, partial, code, reason, action, deckNow }
  B.move = function (e, mode) {
    var it = item(e && e.id), p = player();
    if (!it || !p) return { ok: false, moved: 0, code: 'other', reason: 'Nothing to move.' };
    var wanted = mode === 'stack' ? B.stackSize(e.side, e.id) : 1;
    if (e.side === 'pack' && e.equipped) wanted = 1;
    if (wanted < 1) wanted = 1;
    var n = wanted, chk = B.check(e, n), partial = false;
    if (!chk.ok && chk.code === 'full' && e.side === 'pack' && perPiece(it) && n > 1) {
      while (n > 1 && !B.check(e, n).ok) n--;
      chk = B.check(e, n); partial = chk.ok;
    }
    if (!chk.ok) return { ok: false, moved: 0, wanted: wanted, code: chk.code, reason: chk.reason, action: chk.action };
    var deckBefore = p.equipped && p.equipped.deck;
    var ok = e.side === 'pack' ? S().deposit(e.id, n) : S().withdraw(e.id, n);
    if (!ok) return { ok: false, moved: 0, wanted: wanted, code: 'other', reason: 'The ' + B.vaultName() + ' could not be saved, so nothing moved.' };
    var deckNow = p.equipped && p.equipped.deck !== deckBefore ? p.equipped.deck : null;
    return { ok: true, moved: n, wanted: wanted, partial: partial, deckNow: deckNow };
  };
  // The backpack entry / vault entry for an id (what a click on a tile means)
  B.entry = function (side, id, worn) {
    var list = side === 'vault' ? B.vaultEntries() : B.packEntries();
    return list.filter(function (e) { return e.id === id && (worn ? e.equipped === worn : !e.equipped || e.equipped === 'deck'); })[0] || null;
  };

  // Every off-school gear piece in the backpack (unequipped; off-school can't be worn anyway)
  B.offSchoolIds = function () {
    var p = player();
    if (!p) return [];
    return Object.keys(p.inventory || {}).filter(function (id) { return p.inventory[id] > 0 && B.isOffSchool(id); })
      .sort(function (a, b) { return cmp({ id: a, side: 'pack' }, { id: b, side: 'pack' }); });
  };
  B.offSchoolCount = function () { var p = player(); return B.offSchoolIds().reduce(function (s, id) { return s + p.inventory[id]; }, 0); };
  // "Send all off-school gear to Vault": best pieces first, as many as fit.
  // -> { ok, pieces, kinds, left, full, ids: {id: n} }
  B.sendOffSchool = function () {
    var p = player(), out = { ok: false, pieces: 0, kinds: 0, left: 0, full: false, ids: {} };
    if (!p) return out;
    B.offSchoolIds().forEach(function (id) {
      var have = p.inventory[id] || 0;
      if (out.full) { out.left += have; return; }
      var r = B.move({ side: 'pack', id: id, n: have, equipped: false }, 'stack');
      if (r.ok) { out.pieces += r.moved; out.kinds++; out.ids[id] = r.moved; out.left += have - r.moved; if (r.partial) out.full = true; }
      else { out.left += have; if (r.code === 'full') out.full = true; }
    });
    out.ok = out.pieces > 0;
    return out;
  };

  // ------------------------------------------------------------------
  // 2. PANEL (DOM)
  // ------------------------------------------------------------------
  var ui = { cat: 'all', rarity: 'all', off: false, msg: null, confirm: null, flash: null, npc: null, drag: null, sticky: {} };
  B._ui = ui;                                       // tests / debugging
  function esc(s) { return U().esc(s); }
  function I() { return WF.ui.items; }
  function el(id) { return document.getElementById(id); }

  // called by UI.openBank: remember which banker we are talking to; reset the one-off message
  B.opened = function (npcId) { ui.npc = npcId || B.banker(); ui.msg = null; ui.confirm = null; ui.flash = null; };
  B.titleHTML = function () { return esc(B.vaultName(ui.npc)) + ' <small>shared by all your wizards</small>'; };
  // a line under Orsolya's greeting: how full the Vault is
  B.dialogHTML = function (npcId) {
    var c = B.capacity();
    return '<div class="bk-dlg">Your ' + esc(B.vaultName(npcId)) + ': <b>' + c.used + ' / ' + c.capacity + '</b> spaces used' +
      (B.offSchoolCount() ? ' &middot; <span class="bk-dlg-off">' + B.offSchoolCount() + ' off-school piece' + (B.offSchoolCount() > 1 ? 's' : '') + ' in your backpack</span>' : '') + '</div>';
  };
  function say(kind, html, action) { ui.msg = { kind: kind, html: html, action: action || null, at: Date.now() }; }

  // Backpack "Send to Bank" (ui.js renderPack): deposits here, elsewhere explains where.
  B.sendFromPack = function (id) {
    if (!B.here()) { WF.ui.toast(esc(B.whereText()), 'warn', 5200); WF.sfx.play('error'); return { ok: false, code: 'away' }; }
    var r = B.move({ side: 'pack', id: id, equipped: false }, 'one');
    if (r.ok) { WF.sfx.play('gold'); WF.ui.toast(I().itemNameHTML(id) + ' is in the ' + esc(B.vaultName()) + ' now.' + wearersNote(id)); }
    else { WF.ui.toast(esc(r.reason), 'warn', 5200); WF.sfx.play('error'); }
    return r;
  };
  function wearersNote(id) {
    var w = B.wearers(id);
    return w.length ? ' ' + esc(w.map(function (x) { return x.name; }).join(' or ')) + ' can take it out.' : '';
  }

  function metaHTML(e, it) {
    var C = I(), bits = [];
    if (it.type === 'gear') {
      bits.push(C.slotNames[it.slot] + ' · Lv ' + it.level);
      if (it.tier && it.set) bits.push('<b style="color:' + C.tierColors[it.tier] + '">T' + it.tier + '</b>');
      if (it.school) bits.push(B.isOffSchool(e.id) ? '<b style="color:' + C.offSchoolRed + '">' + esc(C.schoolName(it.school)) + ' only</b>' : esc(C.schoolName(it.school)));
      if (it.crafted) bits.push('<b style="color:' + C.craftedColor + '">Crafted</b>');
    } else if (it.type === 'mount') bits.push('Mount · +' + Math.round((it.speed || 0) * 100) + '% speed');
    else if (it.type === 'deck') bits.push('Deck · ' + ((it.deck && it.deck.size) || '?') + ' cards · Lv ' + (it.level || 1));
    else bits.push(esc(it.desc || (it.type === 'potion' ? 'Potion' : 'Reagent')));
    return bits.join(' · ');
  }
  function tagHTML(e, it) {
    var p = player();
    if (e.side === 'vault' && it.type === 'gear' && S().canEquip(e.id) && S().gearScore(it) > S().gearScore(p.equipped[it.slot] ? item(p.equipped[it.slot]) : null))
      return '<span class="upg" title="Better than what you wear">&#9650;</span>';
    if (e.side === 'pack' && e.equipped) return '<span class="bk-tag eq">' + (e.equipped === 'deck' ? 'In use' : e.equipped === 'mount' ? 'Riding' : 'Worn') + '</span>';
    if (it.type === 'gear' && B.isOffSchool(e.id)) {
      var w = B.wearers(e.id);
      if (w.length) return '<span class="bk-tag for" title="Your ' + esc(I().schoolName(it.school)) + ' wizard">For ' + esc(w[0].name.split(' ')[0]) + (w.length > 1 ? ' +' + (w.length - 1) : '') + '</span>';
    }
    return '';
  }
  function cardHTML(e) {
    var it = item(e.id), C = I(), rc = C.rarColor(it), locked = e.side === 'pack' && e.equipped && e.equipped !== 'deck';
    var fl = ui.flash && ui.flash.key === e.key && Date.now() - ui.flash.at < 1600 ? ' bk-' + ui.flash.kind : '';
    var cf = ui.confirm && ui.confirm.key === e.key ? ' bk-confirm' : '';
    return '<div class="icard bk-card r-' + S().rarityId(it) + (locked ? ' bk-locked' : '') + (B.isOffSchool(e.id) ? ' bk-off' : '') + fl + cf + '" tabindex="0" draggable="true"' +
      ' data-key="' + esc(e.key) + '" data-side="' + e.side + '" data-id="' + esc(e.id) + '"' + (e.equipped ? ' data-eq="' + esc(e.equipped) + '"' : '') +
      ' data-tip="' + esc(e.id) + '" data-ctx="bank" style="--rc:' + rc + '">' +
      C.iconTile(e.id, { count: e.n, badge: e.side === 'pack' }) +
      '<div class="icard-main">' + C.itemNameHTML(e.id) + '<small>' + metaHTML(e, it) + '</small></div>' + tagHTML(e, it) +
      '<span class="bk-arrow" aria-hidden="true">' + (e.side === 'pack' ? '&#10148;' : '&#10148;') + '</span></div>';
  }
  function emptyHTML(side, any) {
    if (side === 'vault') return '<p class="bk-empty">' + (any ? 'Nothing in the Vault matches these filters.' : 'The Vault is empty.<br><span class="dim">Click an item in your backpack to put it here. Every wizard on this account can take it out.</span>') + '</p>';
    return '<p class="bk-empty">' + (any ? 'Nothing in your backpack matches these filters.' : 'Your backpack is empty.') + '</p>';
  }

  // tooltip footer: what a click does + who can wear it
  function tipExtra(id, node) {
    var side = node.getAttribute('data-side'), eq = node.getAttribute('data-eq'), it = item(id), lines = [];
    if (!it) return '';
    var n = side === 'vault' ? S().bankCount(id) : B.stackSize('pack', id);
    if (side === 'pack' && eq && eq !== 'deck') lines.push('<span class="bad">' + (eq === 'mount' ? 'Your active mount: send it to the stable to store it' : 'Worn: take it off to store it') + '</span>');
    else lines.push('<span class="hint">Click: ' + (side === 'vault' ? 'take 1 out' : 'put 1 in the Vault') + (n > 1 && it.type !== 'mount' && it.type !== 'deck' ? ' · Shift-click: all ' + n : '') + '</span>');
    if (side === 'pack' && eq === 'deck') lines.push('<span class="hint">Your equipped deck: you switch to your next best deck</span>');
    if (it.type === 'deck') lines.push('<span class="dim">A stored deck arrives empty: its spell layout stays behind.</span>');
    var w = B.wearers(id);
    if (w.length) lines.push('Fits ' + w.map(function (x) { return '<b>' + esc(x.name) + '</b> <span class="dim">(Lv ' + x.level + (x.ready ? '' : ', needs ' + it.level) + ')</span>'; }).join(', '));
    else if (B.isOffSchool(id)) lines.push('<span class="dim">None of your wizards is ' + esc(I().schoolName(it.school)) + ' yet.</span>');
    return '<div class="it-foot bk-tipfoot">' + lines.join('<br>') + '</div>';
  }

  var host = null;
  B.render = function (container) {
    host = container || host;
    if (!host || !player()) return;
    var C = I(), p = player(), f = { cat: ui.cat, rarity: ui.rarity, off: ui.off };
    var keep = {};
    host.querySelectorAll('.bk-grid').forEach(function (g) { keep[g.getAttribute('data-drop')] = g.scrollTop; });
    var pack = B.list('pack', f), vault = B.list('vault', f), cap = B.capacity(), pc = B.counts('pack', f), vc = B.counts('vault', f);
    var pct = Math.min(100, Math.round(cap.used / Math.max(1, cap.capacity) * 100)), capCls = cap.free <= 0 ? ' full' : cap.free <= 10 ? ' low' : '';
    var sch = D().schools[p.school] || {}, names = B.wizardNames(), off = B.offSchoolCount(), bd = bankerData(ui.npc);
    var msg = ui.msg && Date.now() - ui.msg.at < 12000 ? ui.msg : null;
    host.innerHTML =
      '<div class="bk-wrap">' +
      (bd && bd.vaultIntro ? '<div class="bk-intro"><b>' + esc(bd.name) + ':</b> “' + esc(U().fillText(bd.vaultIntro)) + '”</div>' : '') +
      '<div class="bk-bar"><div class="tabs bk-cats">' + B.CATS.map(function (c) {
        var n = pc[c[0]] + vc[c[0]];
        return '<button class="tab' + (ui.cat === c[0] ? ' on' : '') + '" data-cat="' + c[0] + '">' + c[1] + (c[0] !== 'all' ? ' <small>' + n + '</small>' : '') + '</button>';
      }).join('') + '</div><div class="bk-tools">' +
        '<select id="bk-rar" title="Filter by rarity"><option value="all">Any rarity</option>' + B.RARITY_FILTERS.map(function (r) { return '<option value="' + r + '"' + (ui.rarity === r ? ' selected' : '') + '>' + esc(D().rarities[r].name) + '+</option>'; }).join('') + '</select>' +
        '<button class="chip bk-offf' + (ui.off ? ' on' : '') + '" id="bk-off" title="Show only gear made for another school">Off-school only</button>' +
      '</div></div>' +
      '<div class="bk-panes">' +
        '<section class="bk-pane" data-pane="pack"><header><div><b>Backpack</b><small><span style="color:' + (sch.color || '#fff') + '">' + esc(p.name) + '</span> · Level ' + p.level + ' ' + esc(sch.name || '') + '</small></div>' +
          '<span class="bk-count">' + pack.length + ' shown</span></header>' +
          '<div class="bk-grid" data-drop="pack">' + (pack.length ? pack.map(cardHTML).join('') : emptyHTML('pack', B.packEntries().length > 0)) + '</div></section>' +
        '<div class="bk-mid" aria-hidden="true"><span>&#8644;</span></div>' +
        '<section class="bk-pane bk-vault" data-pane="vault"><header><div><b>&#9919; ' + esc(B.vaultName(ui.npc)) + '</b><small>Shared by ' + esc(names.join(', ') || 'your wizards') + '</small></div>' +
          '<div class="bk-cap' + capCls + '" title="A stack of potions or reagents takes 1 space; every gear piece, mount and deck takes 1 space."><div class="bk-capbar"><i style="width:' + pct + '%"></i></div><span><b>' + cap.used + '</b> / ' + cap.capacity + ' spaces</span></div></header>' +
          '<div class="bk-grid" data-drop="vault">' + (vault.length ? vault.map(cardHTML).join('') : emptyHTML('vault', B.vaultEntries().length > 0)) + '</div></section>' +
      '</div>' +
      '<div class="bk-msg' + (msg ? ' show ' + msg.kind : '') + '" id="bk-msg" role="status" aria-live="polite">' + (msg ? '<span>' + msg.html + '</span>' + (msg.action ? '<button class="btn sm" id="bk-act">' + esc(msg.action.label) + '</button>' : '') : '') + '</div>' +
      '<div class="bk-foot"><button class="btn' + (off ? ' primary' : '') + '" id="bk-sendoff"' + (off ? '' : ' disabled') + ' title="Every gear piece in your backpack made for another school">Send all off-school gear to Vault' + (off ? ' (' + off + ')' : '') + '</button>' +
        '<span class="bk-help">Click: move one &middot; <b>Shift</b>-click: whole stack &middot; or drag between the two sides</span></div>' +
      '</div>';
    host.querySelectorAll('.bk-grid').forEach(function (g) { var k = g.getAttribute('data-drop'); if (keep[k]) g.scrollTop = keep[k]; });
    bind();
  };
  B.refresh = function () { if (host && document.body.contains(host)) B.render(host); if (WF.ui.refreshHUD) WF.ui.refreshHUD(); };

  function entryOf(node) {
    var side = node.getAttribute('data-side'), id = node.getAttribute('data-id'), eq = node.getAttribute('data-eq');
    var e = B.entry(side, id, eq && eq !== 'deck' ? eq : null);
    if (e) e.key = node.getAttribute('data-key');
    return e;
  }
  // act on a tile (click / Enter / drop). mode 'one' | 'stack'
  B.act = function (e, mode) {
    if (!e) return null;
    var it = item(e.id), p = player(), C = I();
    // storing the deck you duel with: ask once (click again)
    if (e.side === 'pack' && e.equipped === 'deck' && !(ui.confirm && ui.confirm.key === e.key && Date.now() - ui.confirm.at < 8000)) {
      var chk = B.check(e, 1);
      if (chk.ok) {
        ui.confirm = { key: e.key, at: Date.now() };
        say('info', 'The ' + C.itemNameHTML(e.id) + ' is the deck you duel with. Click it again to store it: you switch to your next best deck and its spell layout is cleared.');
        WF.sfx.play('click'); B.refresh();
        return { ok: false, code: 'confirm' };
      }
    }
    ui.confirm = null;
    var r = B.move(e, mode);
    if (r.ok) {
      var to = e.side === 'pack' ? 'the Vault' : 'your backpack', nm = C.itemNameHTML(e.id) + (r.moved > 1 ? ' ×' + r.moved : '');
      var txt = nm + ' → ' + to + '.';
      if (r.partial) txt += ' Only ' + r.moved + ' of ' + r.wanted + ' fit: the Vault is full now.';
      if (e.side === 'pack' && B.isOffSchool(e.id)) txt += wearersNote(e.id);
      if (r.deckNow) txt += ' You now duel with the ' + C.itemNameHTML(r.deckNow) + '.';
      if (e.side === 'vault' && it.type === 'gear' && S().canEquip(e.id)) txt += ' Equip it from your backpack (B).';
      if (e.side === 'vault' && it.type === 'mount') txt += ' It is in your stable now.';
      say(r.partial ? 'warn' : 'ok', txt);
      ui.flash = { key: (e.side === 'pack' ? 'vault:' : 'pack:') + e.id, kind: 'in', at: Date.now() };
      WF.sfx.play('gold');
    } else {
      var action = null;
      if (r.action === 'unequip' && it.slot) action = { label: 'Take it off', fn: function () { if (S().unequip(it.slot)) { S().save(); say('info', C.itemNameHTML(e.id) + ' is back in your backpack. Click it to store it.'); ui.flash = { key: 'pack:' + e.id, kind: 'in', at: Date.now() }; WF.sfx.play('click'); B.refresh(); } } };
      if (r.action === 'unequipMount') action = { label: 'Send to stable', fn: function () { if (S().unequipMount()) { S().save(); say('info', C.itemNameHTML(e.id) + ' is in your stable. Click it to store it.'); ui.flash = { key: 'pack:' + e.id, kind: 'in', at: Date.now() }; WF.sfx.play('click'); B.refresh(); } } };
      say('warn', esc(r.reason), action);
      ui.flash = { key: e.key, kind: 'no', at: Date.now() };
      WF.sfx.play('error');
    }
    B.refresh();
    return r;
  };
  B.sendAllOffSchool = function () {
    var r = B.sendOffSchool();
    if (r.ok) {
      say(r.left ? 'warn' : 'ok', 'Sent <b>' + r.pieces + '</b> off-school piece' + (r.pieces > 1 ? 's' : '') + ' to the Vault.' + (r.left ? ' ' + r.left + ' did not fit: the Vault is full.' : ' Your other wizards can take them out.'));
      WF.sfx.play('gold');
    } else { say('warn', r.full ? esc(B.check({ side: 'pack', id: B.offSchoolIds()[0] }, 1).reason || 'The Vault is full.') : 'No off-school gear in your backpack.'); WF.sfx.play('error'); }
    B.refresh();
    return r;
  };

  function bind() {
    var C = I();
    host.querySelectorAll('[data-cat]').forEach(function (b) { b.onclick = function () { ui.cat = b.getAttribute('data-cat'); WF.sfx.play('click'); B.refresh(); }; });
    var rs = el('bk-rar'); if (rs) rs.onchange = function () { ui.rarity = this.value; B.refresh(); };
    var of = el('bk-off'); if (of) of.onclick = function () { ui.off = !ui.off; WF.sfx.play('click'); B.refresh(); };
    var so = el('bk-sendoff'); if (so) so.onclick = function () { C.hideTip(); B.sendAllOffSchool(); };
    var ab = el('bk-act'); if (ab && ui.msg && ui.msg.action) ab.onclick = ui.msg.action.fn;
    host.querySelectorAll('.bk-card').forEach(function (n) {
      n.addEventListener('click', function (ev) { C.hideTip(); B.act(entryOf(n), ev.shiftKey ? 'stack' : 'one'); });
      n.addEventListener('keydown', function (ev) {
        if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); ev.stopPropagation(); B.act(entryOf(n), ev.shiftKey ? 'stack' : 'one'); }
      });
      n.addEventListener('dragstart', function (ev) {
        ui.drag = { side: n.getAttribute('data-side'), key: n.getAttribute('data-key'), node: n };
        try { ev.dataTransfer.setData('text/plain', n.getAttribute('data-id')); ev.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ }
        C.hideTip(); n.classList.add('bk-dragging');
        host.querySelectorAll('.bk-grid').forEach(function (g) { if (g.getAttribute('data-drop') !== ui.drag.side) g.classList.add('bk-target'); });
      });
      n.addEventListener('dragend', function () { n.classList.remove('bk-dragging'); ui.drag = null; host.querySelectorAll('.bk-grid').forEach(function (g) { g.classList.remove('bk-target', 'bk-over'); }); });
    });
    host.querySelectorAll('.bk-grid').forEach(function (g) {
      var side = g.getAttribute('data-drop');
      g.addEventListener('dragover', function (ev) { if (ui.drag && ui.drag.side !== side) { ev.preventDefault(); g.classList.add('bk-over'); } });
      g.addEventListener('dragleave', function () { g.classList.remove('bk-over'); });
      g.addEventListener('drop', function (ev) {
        if (!ui.drag || ui.drag.side === side) return;
        ev.preventDefault();
        var node = ui.drag.node; ui.drag = null;
        B.act(entryOf(node), ev.shiftKey ? 'stack' : 'one');
      });
    });
    C.bindTips(host, 'bank', tipExtra);
  }

  return B;
})();

// ---- v2.0 WS-B (Pets): pets live in the same shared Vault (account.bank.pets[], WF.state.bankPets /
// petBankTxn; rules in game/js/pets.js). The Vault panel gets one button that opens the Pets panel's
// Vault tab (game/js/petsUI.js), where pets move between this wizard and the Vault.
(function (B) {
  if (!B || !B.render) return;
  var render = B.render;
  B.render = function (container) {
    var r = render.apply(this, arguments);
    try {
      if (container && WF.petsUI && WF.pets && WF.state && WF.state.bankPets) {
        var n = WF.state.bankPets().length, b = document.createElement('button');
        b.className = 'btn sm bk-pets'; b.style.margin = '8px 0 0';
        b.innerHTML = '&#128062; Pets in the Vault (' + n + ')';
        b.title = 'Move pets between this wizard and the shared Vault';
        b.onclick = function () { WF.ui.closeAll(true); WF.petsUI.open('vault', 'banker'); };
        container.appendChild(b);
      }
    } catch (e) { if (typeof console !== 'undefined') console.error('[pets] vault hook', e); }
    return r;
  };
})(WF.bank);
