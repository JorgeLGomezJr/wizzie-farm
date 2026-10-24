// =====================================================================
//  WIZZIE FARM — PETS UI + PETS IN THE WORLD (v2.0 M2, WS-B: ui-programmer + gameplay-programmer)
//  Rules: game/js/pets.js (WF.pets) · Data: game/data/pets.js · Zone: game/data/zones_glade.js
//
//  1. THE PETS PANEL (P, or the HUD "Pets" button): your pets and eggs, stage + XP, talents (pick 1
//     of 2 when a pet grows), the hidden pool you have seen, pet cards, equip / feed / rename /
//     release. In the Nestling Glade (or at the Vault) it also has:
//       Nestery  the two nests (incubate an egg, collect a hatchling), breeding (any 2 of your pets,
//                 incl. pets in the shared Vault, so across wizards), appraisal (Nell Quillby)
//       Starters  Tobin Burrow's Common starter pets
//       Vault     move pets between this wizard and the shared Vault
//       Board     the Pet Stat Board: what your pet gives you, the "perfect pet" for your school,
//                 every species' talent list and where its eggs drop, the rarity table
//  2. NPC HOOKS: an NPC with `pets: 'hatchery' | 'starters' | 'ring'` gets a button in its dialogue
//     (wraps WF.ui.talkTo; no edit of ui.js). Coach Bramble's training ring = WF.pets.train().
//  3. THE PET IN THE WORLD: the equipped pet follows you (own mesh in the scene, survives zone
//     changes), stands beside you in duels, and hops when you cast one of its cards. The Glade's
//     nests show the eggs incubating, and the Pet Stat Board is a real board you read with E.
//  4. Small wraps: duel results list eggs + pet XP; pet cards borrow existing card art (artAs).
//  Everything here is a no-op until a wizard is loaded; every hook is wrapped in try/catch so a pet
//  problem can never break a duel or the world.
// =====================================================================
window.WF = window.WF || {};
WF.petsUI = (function () {
  'use strict';
  var PU = {};
  function PT() { return WF.pets; }
  function D() { return WF.data; }
  function PD() { return WF.data.pets; }
  function S() { return WF.state; }
  function U() { return WF.util; }
  function el(id) { return document.getElementById(id); }
  function esc(s) { return U().esc(String(s == null ? '' : s)); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function player() { return S() && S().player; }
  function warn(e) { if (typeof console !== 'undefined') console.error('[pets]', e); }

  // ------------------------------------------------------------------ 1. LOGIC (no DOM)
  PU.STAT_NAMES = { hp: 'Max Health', mana: 'Max Mana', dmg: 'Damage', resist: 'Resist', acc: 'Accuracy', brightPip: 'Bright Pip', pipSurge: 'Pip Surge', flatDmg: 'Damage per hit' };
  PU.statText = function (stat, v) { return '+' + v + (stat === 'hp' || stat === 'mana' || stat === 'flatDmg' ? '' : '%') + ' ' + PU.STAT_NAMES[stat]; };
  PU.talentLine = function (tid, pet, school) {
    var t = PT().talent(tid); if (!t) return '';
    var v = PT().talentValue(tid, pet, { naturalHp: PT().naturalHp(player()), level: player() && player().level });
    var sc = t.school && D().schools[t.school] ? D().schools[t.school].name : null;
    return t.name + ': ' + PU.statText(t.stat, v) + (sc ? ' (' + sc + ' only)' : '');
  };
  // where you can use the hatchery / vault parts of the panel
  PU.inGlade = function () { return !!(WF.world && WF.world.zone && WF.world.zone.petBoard); };
  PU.atVault = function () { return !!(WF.bank && WF.bank.here && WF.bank.here()); };
  PU.canHatch = function () { return PU.inGlade(); };
  PU.canVault = function () { return PU.inGlade() || PU.atVault(); };
  PU.tabs = function () {
    var t = [['pets', 'My Pets']];
    if (PU.canHatch()) t.push(['hatchery', 'Nestery'], ['starters', 'Starter Pets']);
    if (PU.canVault()) t.push(['vault', 'Vault']);
    t.push(['board', 'Stat Board']);
    return t;
  };
  PU.xpInfo = function (pet) {
    var S0 = PD().stages, st = S0[pet.stage], nx = S0[pet.stage + 1];
    if (!nx) return { pct: 100, text: 'Fully grown (' + stageName(-1) + ')' };
    var a = st.xp, b = nx.xp, have = Math.max(0, pet.xp - a);
    return { pct: Math.max(0, Math.min(100, Math.round(have / (b - a) * 100))), text: (pet.xp - a) + ' / ' + (b - a) + ' XP to ' + nx.name };
  };
  PU.fmtTime = function (ms) {
    ms = Math.max(0, ms); var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + 'h ' + m + 'm' : (m ? m + 'm ' + x + 's' : x + 's');
  };
  // enemies whose eggs a species can come from: [{ id, name, table }]
  PU.eggSources = function (sid) {
    var out = [];
    Object.keys(D().enemies || {}).forEach(function (id) {
      var e = D().enemies[id], L = e.loot && e.loot.eggs;
      if (L && (L.species || []).indexOf(sid) >= 0 && id.indexOf('__') !== 0) out.push({ id: id, name: e.name, table: L.table });
    });
    return out;
  };
  PU.anyOffer = function () { return PT() && player() ? PT().list().some(function (p) { return !!p.offer; }) : false; };

  // ------------------------------------------------------------------ 2. PANEL (DOM)
  var panel = null, tab = 'pets', sel = null, breedA = null, breedB = null, friendPet = null, msg = '', msgKind = '', prevMode = null, tick = null, opener = null;
  var CSS = [
    '#pets-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1020px,96vw);max-height:90vh;z-index:36;display:flex;flex-direction:column;',
    'background:rgba(22,18,48,.97);border:2px solid var(--line);border-radius:18px;box-shadow:0 16px 60px rgba(0,0,0,.65);}',
    '#pets-panel.hidden{display:none}',
    '#pets-panel .pt-tabs{display:flex;gap:6px;padding:8px 18px 0;flex-wrap:wrap}',
    '#pets-panel .pt-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,211,107,.35);color:var(--text);border-radius:10px 10px 0 0;padding:6px 14px;font:800 .95em var(--body);cursor:pointer}',
    '#pets-panel .pt-tab.on{background:linear-gradient(#ffd977,#d39a2a);color:#3a2405}',
    '#pets-panel .pt-cols{display:grid;grid-template-columns:minmax(230px,300px) 1fr;gap:14px}',
    '#pets-panel .pt-list{display:flex;flex-direction:column;gap:6px;max-height:62vh;overflow:auto;padding-right:4px}',
    '#pets-panel .pt-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.05);border:2px solid transparent;cursor:pointer;text-align:left;color:var(--text);font:inherit}',
    '#pets-panel .pt-row:hover{background:rgba(255,255,255,.1)} #pets-panel .pt-row.sel{border-color:var(--gold)}',
    '#pets-panel .pt-ico{width:38px;height:38px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:20px;border:3px solid var(--rc,#ccc);background:radial-gradient(circle at 35% 30%,var(--pf2,#fff) 0,var(--pf,#c8a07a) 60%)}',
    '#pets-panel .pt-ico.egg{border-radius:50% 50% 46% 46%/60% 60% 40% 40%;width:30px;margin:0 4px}',
    '#pets-panel .pt-nm{font-weight:800} #pets-panel .pt-sub{font-size:.8em;color:var(--dim)}',
    '#pets-panel .pt-badge{margin-left:auto;font-size:.75em;padding:2px 7px;border-radius:8px;background:#ffd36b;color:#3a2405;font-weight:800}',
    '#pets-panel button.pt-badge{border:0;font-family:inherit;cursor:pointer}#pets-panel button.pt-badge:focus-visible{outline:2px solid #fff;outline-offset:2px}',   /* v2.0 QA M3: keyboard-usable Take */
    '#pets-panel .pt-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,211,107,.25);border-radius:14px;padding:12px 14px;margin-bottom:10px}',
    '#pets-panel h3{font-family:var(--display);margin:0 0 4px;color:var(--gold)} #pets-panel h4{font-family:var(--display);color:var(--gold);margin:10px 0 6px}',
    '#pets-panel .pt-bar{height:10px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin:6px 0 2px}',
    '#pets-panel .pt-bar i{display:block;height:100%;background:linear-gradient(90deg,#c58bff,#ffd36b)}',
    '#pets-panel .pt-tal{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.1)}',
    '#pets-panel .pt-tal.off{opacity:.5} #pets-panel .pt-pick{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}',
    '#pets-panel .pt-pick .btn{flex:1;min-width:200px;text-align:left}',
    '#pets-panel .pt-cards{display:flex;gap:8px;flex-wrap:wrap}',
    '#pets-panel .pt-cards .card{position:relative}',
    '#pets-panel .pt-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}',
    '#pets-panel .pt-msg{margin:6px 0;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.07)} #pets-panel .pt-msg.bad{background:rgba(255,80,80,.18)} #pets-panel .pt-msg.good{background:rgba(80,220,120,.18)}',
    '#pets-panel .pt-nests{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#pets-panel table{border-collapse:collapse;width:100%;font-size:.88em} #pets-panel td,#pets-panel th{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}',
    '#pets-panel select{background:#1e1840;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px;font:inherit;max-width:100%}',
    '#pets-panel .pt-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '@media (max-width:760px){#pets-panel .pt-cols,#pets-panel .pt-grid2,#pets-panel .pt-nests{grid-template-columns:1fr}}',
    '.card.pet-card{box-shadow:0 0 0 2px #ffb8e0 inset}',
    '.card.pet-card::after{content:"\\1F43E";position:absolute;right:4px;bottom:2px;font-size:13px;filter:drop-shadow(0 1px 1px #000)}',
    '.rs-pets{margin:8px 0;padding:8px 10px;border-radius:10px;background:rgba(255,184,224,.12);border:1px solid rgba(255,184,224,.4)}.rs-pet-lost{color:#ffb4a0;font-weight:700}'
  ].join('\n');
  var GLYPH = { pup: '🐶', kit: '🐱', hopper: '🐰', fawn: '🦌', moth: '🦋', drake: '🐉', owl: '🦉', mote: '✨' };

  function ensurePanel() {
    if (panel) return panel;
    var st = document.createElement('style'); st.id = 'pets-css'; st.textContent = CSS; document.head.appendChild(st);
    panel = document.createElement('div'); panel.id = 'pets-panel'; panel.className = 'hidden';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Pets');
    document.body.appendChild(panel);
    return panel;
  }
  function icon(pet) {
    var sp = PT().species(pet.species) || {}, L = sp.look || {};
    var g = pet.egg ? '' : (L.toad ? '🐸' : (GLYPH[L.body] || '🐾'));
    return '<span class="pt-ico' + (pet.egg ? ' egg' : '') + '" style="--rc:' + PT().rarityColor(pet.rarity) + ';--pf:' + (L.fur || '#c8a07a') + ';--pf2:' + (L.belly || '#fff') + '">' + g + '</span>';
  }
  // v2.1 D18: stage names come from data (pets.js stages[].name), never hard-coded here
  function rankStage(r) { var st = PT().stages(); for (var i = 0; i < st.length; i++) if (st[i].cardRank === r) return st[i].name; return ''; }
  function stageName(i) { var st = PT().stages(); return st[i < 0 ? st.length + i : i].name; }
  function rarName(r) { return '<b style="color:' + PT().rarityColor(r) + '">' + esc(PT().rarityName(r)) + '</b>'; }
  function say(text, kind) { msg = text || ''; msgKind = kind || ''; }
  function result(r, okText) { if (r && r.ok) { say(okText || 'Done.', 'good'); try { WF.sfx.play('buff'); } catch (e) { /* no audio */ } } else { say((r && r.reason) || 'You can’t do that.', 'bad'); try { WF.sfx.play('error'); } catch (e) { /* no audio */ } } render(); }

  PU.isOpen = function () { return !!panel && !panel.classList.contains('hidden'); };
  PU.open = function (which, npcId) {
    var W = WF.world;
    if (!player() || !W || W.mode === 'combat' || W.mode === 'title' || W.mode === 'loading') return false;
    if (!PU.isOpen() && WF.ui.blocking && WF.ui.blocking()) return false;   // (blocking() is true while this panel is open)
    if (WF.ui.panelOpen && WF.ui.panelOpen() || WF.ui.dialogNpc && WF.ui.dialogNpc()) WF.ui.closeAll(true);
    ensurePanel();
    opener = npcId || null;
    tab = which || tab || 'pets';
    if (!PU.tabs().some(function (t) { return t[0] === tab; })) tab = 'pets';
    if (!PU.isOpen()) { prevMode = W.mode; W.mode = 'menu'; }
    panel.classList.remove('hidden');
    if (!sel || !PT().get(sel)) sel = (PT().active() || PT().list()[0] || {}).uid || null;
    var waiting = PT().list().filter(function (x) { return !!x.offer; });   // a pet waiting for its talent pick comes first
    if (tab === 'pets' && waiting.length && !(PT().get(sel) || {}).offer) sel = (waiting.filter(function (x) { return x.uid === player().activePet; })[0] || waiting[0]).uid;
    say('');
    var wasOpen = panel.getAttribute('data-open') === '1';
    render();
    panel.setAttribute('data-open', '1');
    if (!wasOpen) { try { var fb = panel.querySelector('button:not([disabled]), [tabindex="0"]'); if (fb) fb.focus({ preventScroll: true }); } catch (eF) { /* old browsers */ } }   // v2.1 QA: keyboard focus moves into the panel
    if (!tick) tick = setInterval(function () { if (PU.isOpen() && (tab === 'hatchery' || tab === 'pets')) render(true); }, 1000);
    try { WF.sfx.play('open'); } catch (e) { /* no audio */ }
    return true;
  };
  PU.close = function (silent) {
    if (!PU.isOpen()) return;
    panel.classList.add('hidden'); panel.removeAttribute('data-open');
    if (tick) { clearInterval(tick); tick = null; }
    if (WF.world && WF.world.mode === 'menu') WF.world.mode = 'explore';
    if (!silent) try { WF.sfx.play('close'); } catch (e) { /* no audio */ }
    refreshHudBadge();
  };
  PU.toggle = function (which) { if (PU.isOpen() && (!which || which === tab)) PU.close(); else PU.open(which); };
  PU.tab = function () { return tab; };

  function render(soft) {
    if (!panel || !player()) return;
    if (soft) {   // timers only: refresh countdown spans without rebuilding (keeps selects / scroll)
      panel.querySelectorAll('[data-until]').forEach(function (n) {
        var left = +n.getAttribute('data-until') - PT().clock();
        if (left <= 0 && n.getAttribute('data-done') !== '1') { n.setAttribute('data-done', '1'); render(); return; }
        n.textContent = PU.fmtTime(left);
      });
      return;
    }
    var body0 = panel.querySelector('.pn-body'), scroll = body0 ? body0.scrollTop : 0;
    var tabs = PU.tabs().map(function (t) { return '<button class="pt-tab' + (t[0] === tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('');
    var n = PT().list().length;
    panel.innerHTML = '<div class="pn-head"><span>Pets <small>(P) · ' + n + ' / ' + PD().maxPets + ' carried</small></span><button class="pn-x" id="pt-close" title="Close (Esc)">✕</button></div>' +
      '<div class="pt-tabs">' + tabs + '</div><div class="pn-body" id="pt-body"></div>';
    var body = el('pt-body');
    var html = msg ? '<div class="pt-msg ' + msgKind + '">' + esc(msg) + '</div>' : '';
    if (tab === 'pets') html += petsTab();
    else if (tab === 'hatchery') html += hatcheryTab();
    else if (tab === 'starters') html += startersTab();
    else if (tab === 'vault') html += vaultTab();
    else html += boardTab();
    body.innerHTML = html;
    wire(body);
    el('pt-close').onclick = function () { PU.close(); };
    panel.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-tab'); say(''); render(); }; });
    body.scrollTop = scroll;
    refreshHudBadge();
  }

  // ---- My Pets
  function petRow(pet, extra) {
    var act = player().activePet === pet.uid;
    var sub = pet.egg ? 'Egg · ' + esc(PT().rarityName(pet.rarity)) : esc(PT().stageOf(pet).name) + ' ' + esc(PT().species(pet.species).name) + ' · ' + esc(PT().rarityName(pet.rarity));
    return '<button class="pt-row' + (sel === pet.uid ? ' sel' : '') + '" data-sel="' + esc(pet.uid) + '">' + icon(pet) +
      '<span><span class="pt-nm" style="color:' + PT().rarityColor(pet.rarity) + '">' + esc(pet.egg ? PT().species(pet.species).name + ' Egg' : pet.name) + '</span><br><span class="pt-sub">' + sub + '</span></span>' +
      (pet.offer ? '<span class="pt-badge">Pick!</span>' : (act ? '<span class="pt-badge">Equipped</span>' : '')) + (extra || '') + '</button>';
  }
  function cardsHTML(ids) {
    if (!ids.length) return '<span class="dim">No pet cards (Rare: 1, Epic: 2, Legendary: 3 incl. a signature card).</span>';
    return ids.map(function (id) { return '<span data-card="' + esc(id) + '"></span>'; }).join('');
  }
  function petsTab() {
    var list = PT().list();
    if (!list.length) {
      return '<div class="pt-card"><h3>No pets yet</h3><p>Visit the <b>Nestling Glade</b> (portal north-east of the Lumen Spire): Tobin Burrow has Common starter pets, ' +
        'and rare eggs drop from Hollow bosses and elites. Your equipped pet follows you, fights beside you and adds its talents to your stats.</p></div>';
    }
    var pet = PT().get(sel) || list[0]; sel = pet.uid;
    var left = '<div class="pt-list">' + list.map(function (p) { return petRow(p); }).join('') + '</div>';
    return '<div class="pt-cols">' + left + '<div>' + (pet.egg ? eggDetail(pet) : petDetail(pet)) + '</div></div>';
  }
  function eggDetail(pet) {
    var sp = PT().species(pet.species), mins = PD().rarity[pet.rarity].incubate;
    return '<div class="pt-card"><h3>' + esc(sp.name) + ' Egg</h3><div>' + rarName(pet.rarity) + ' · ' + esc(D().schools[sp.school] ? D().schools[sp.school].name : sp.school) + (pet.gen > 1 ? ' · generation ' + pet.gen : '') + '</div>' +
      '<p class="dim">' + esc(sp.desc) + '</p><p>Put it in a nest at the Nestery (Nell Quillby, Nestling Glade). It hatches after <b>' + PU.fmtTime(mins * 60000) + '</b> of real time.</p>' +
      '<div class="pt-acts">' + (PU.canHatch() ? '<button class="btn primary" data-act="incubate">Put in a nest</button>' : '<span class="dim">Nests: Nestling Glade</span>') +
      (PU.canVault() ? '<button class="btn" data-act="deposit">Send to Vault</button>' : '') + '<button class="btn btn-ghost" data-act="release">Give away</button></div></div>';
  }
  function petDetail(pet) {
    var p = player(), sp = PT().species(pet.species), act = p.activePet === pet.uid, xi = PU.xpInfo(pet);
    var b = PT().bonus(pet, p.school, PT().naturalHp(p), p.level);
    var h = '<div class="pt-card"><h3>' + icon(pet) + ' ' + esc(pet.name) + '</h3>' +
      '<div>' + rarName(pet.rarity) + ' ' + esc(sp.name) + ' · ' + esc(D().schools[sp.school] ? D().schools[sp.school].name : sp.school) + ' · <b>' + esc(PT().stageOf(pet).name) + '</b>' + (pet.gen > 1 ? ' · gen ' + pet.gen : '') + '</div>' +
      '<div class="pt-bar"><i style="width:' + xi.pct + '%"></i></div><div class="pt-sub">' + esc(xi.text) + ' · learns from snacks, the training ring and every duel it is equipped for</div>' +
      (PT().resting(pet) ? '<div class="pt-sub">Resting after hatching an egg: <span data-until="' + pet.restUntil + '">' + PU.fmtTime(pet.restUntil - PT().clock()) + '</span></div>' : '') + '</div>';
    if (pet.offer) {
      h += '<div class="pt-card"><h4>' + esc(pet.name) + ' grew into a ' + esc(PT().stageOf(pet).name) + '! Choose one talent:</h4><div class="pt-pick">' +
        pet.offer.choices.map(function (t) { return '<button class="btn primary" data-pick="' + esc(t) + '">' + esc(PU.talentLine(t, pet, p.school)) + '<br><small>' + esc(PT().talent(t).desc) + '</small></button>'; }).join('') +
        '</div><div class="pt-sub">The other one stays in the pool and may be offered again later.</div></div>';
    }
    h += '<div class="pt-card"><h4>Talents (' + pet.talents.length + ' / ' + PT().maxStage() + ')</h4>';
    if (!pet.talents.length) h += '<div class="dim">None yet: a pet learns one talent at every stage (' + PT().stages().slice(1).map(function (x) { return x.name; }).join(', ') + ').</div>';
    b.lines.forEach(function (l) {
      h += '<div class="pt-tal' + (l.active ? '' : ' off') + '"><span>' + esc(l.name) + '</span><span>' + esc(PU.statText(l.stat, l.value)) + (l.school ? ' · ' + esc(D().schools[l.school].name) + (l.active ? '' : ' only') : '') + '</span></div>';
    });
    var known = PT().knownPool(pet).filter(function (t) { return pet.talents.indexOf(t) < 0; });
    var hidden = PD().breeding.poolSize - pet.talents.length - known.length;
    h += '<div class="pt-sub" style="margin-top:6px">Hidden pool: ' + (known.length ? known.map(function (t) { return esc(PT().talent(t).name); }).join(', ') : '') + (hidden > 0 ? (known.length ? ' + ' : '') + hidden + ' unknown' : '') +
      (pet.appraised ? ' (appraised)' : '') + '</div></div>';
    h += '<div class="pt-card"><h4>Pet cards</h4><div class="pt-cards">' + cardsHTML(PT().cardsOf(pet)) + '</div><div class="pt-sub">Added to your duel deck on top of the deck size limit while this pet is equipped. Stronger at ' + rankStage(2) + ' (II) and ' + rankStage(3) + ' (III).</div></div>';
    // actions
    var snacks = Object.keys(p.inventory).filter(function (id) { return PT().snackXp(id) > 0 && p.inventory[id] > 0; });
    h += '<div class="pt-card"><div class="pt-acts">' +
      (act ? '<button class="btn" data-act="unequip">Unequip</button>' : '<button class="btn primary" data-act="equip">Equip</button>') +
      '<button class="btn" data-act="rename">Rename</button>' +
      (snacks.length && !PT().isMega(pet) ? '<select id="pt-snack">' + snacks.map(function (id) { return '<option value="' + id + '">' + esc(D().items[id].name) + ' ×' + p.inventory[id] + ' (+' + PT().snackXp(id) + ' XP)</option>'; }).join('') + '</select><button class="btn" data-act="feed">Feed</button>' : '<span class="dim">' + (PT().isMega(pet) ? 'Fully grown.' : 'No snacks (Marla Crumb bakes them; monsters drop them).') + '</span>') +
      (opener === 'quillby' || PU.canHatch() ? (pet.appraised ? '' : '<button class="btn" data-act="appraise">Appraise (' + PT().appraiseCost(pet) + ' g)</button>') : '') +
      (PU.canVault() && !act ? '<button class="btn" data-act="deposit">Send to Vault</button>' : '') +
      (!act ? '<button class="btn btn-ghost" data-act="release">Give away</button>' : '') + '</div></div>';
    return h;
  }

  // ---- Nestery: nests + breeding
  function nestHTML(slot, i) {
    if (!slot) return '<div class="pt-card"><h4>Nest ' + (i + 1) + '</h4><div class="dim">Empty. Put an egg here, or breed two pets below.</div></div>';
    var pet = slot.pet, ready = PT().slotReady(slot), sp = PT().species(pet.species);
    return '<div class="pt-card"><h4>Nest ' + (i + 1) + '</h4><div>' + icon(pet) + ' ' + rarName(pet.rarity) + ' ' + esc(sp.name) + ' egg' + (slot.kind === 'bred' ? ' (bred, gen ' + pet.gen + ')' : '') + '</div>' +
      (ready ? '<div class="pt-acts"><button class="btn primary" data-collect="' + i + '">Hatch it!</button></div>' : '<div class="pt-sub">Hatches in <span data-until="' + slot.readyAt + '">' + PU.fmtTime(slot.readyAt - PT().clock()) + '</span> (real time; keeps going while you play elsewhere or close the game)</div>') + '</div>';
  }
  function candLabel(c) {
    var x = c.pet, r = PT().canBreedPet(x);
    return (c.where === 'bank' ? '[Vault] ' : '') + x.name + ' — ' + PT().rarityName(x.rarity) + ' ' + PT().species(x.species).name + ', ' + PT().stageOf(x).name + (r.ok ? '' : ' (' + r.reason.replace(x.name + ' ', '') + ')');
  }
  function hatcheryTab() {
    var slots = PT().slots(), h = '<div class="pt-nests">' + [0, 1].slice(0, PD().incubatorSlots).map(function (i) { return nestHTML(slots[i], i); }).join('') + '</div>';
    var eggs = PT().eggs();
    if (eggs.length) h += '<div class="pt-card"><h4>Your eggs</h4><div class="pt-list">' + eggs.map(function (e) { return petRow(e, '<span class="pt-badge" data-inc="' + esc(e.uid) + '">Nest it</span>'); }).join('') + '</div></div>';
    var cands = PT().breedCandidates();
    var opt = function (cur) { return '<option value="">— choose a pet —</option>' + cands.map(function (c) { var v = c.where + ':' + c.uid; return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(candLabel(c)) + '</option>'; }).join(''); };
    h += '<div class="pt-card"><h4>Breed a new egg</h4><p class="pt-sub">Any two of your pets, ' + esc(PD().stages[PD().breedMinStage].name) + ' or older — also pets your other wizards left in the Vault. ' +
      'The baby is one parent’s species; its hidden talents are a mix of both parents’ pools (talents both carry pass on more often). Its rarity is the lower parent’s, with a small chance to go up (' +
      Math.round(PD().breeding.rollUp * 100) + '%, ' + Math.round(PD().breeding.rollUpSame * 100) + '% if both share it) or down (' + Math.round(PD().breeding.rollDown * 100) + '%). Each parent rests ' + PD().breeding.restHours + ' h afterwards.</p>' +
      '<div class="pt-grid2"><label>Parent 1<br><select id="pt-ba">' + opt(breedA) + '</select></label><label>Parent 2<br><select id="pt-bb">' + opt(breedB) + '</select></label></div>';
    var ra = refOf(breedA), rb = refOf(breedB);
    if (ra && rb) {
      var a = PT().find(ra), b = PT().find(rb), chk = PT().canBreed(ra, rb);
      if (a && b) {
        var odds = PT().rarityOdds(a, b), shared = PT().knownPool(a).filter(function (t) { return PT().knownPool(b).indexOf(t) >= 0; });
        h += '<div style="margin-top:8px">' + stageName(0) + ' rarity: ' + Object.keys(odds).sort(function (x, y) { return PT().rarIdx(y) - PT().rarIdx(x); }).map(function (r) { return rarName(r) + ' ' + Math.round(odds[r] * 100) + '%'; }).join(' · ') +
          '<br>Species: ' + esc(PT().species(a.species).name) + ' or ' + esc(PT().species(b.species).name) + ' · Fee: <b>' + PT().hatchFee(a, b) + ' gold</b> · Incubation: ' + PU.fmtTime(PT().incubateMs(PT().RARITIES[Math.min(PT().rarIdx(a.rarity), PT().rarIdx(b.rarity))])) +
          (shared.length ? '<br>Known talents both carry: ' + shared.map(function (t) { return esc(PT().talent(t).name); }).join(', ') : '') + '</div>';
      }
      h += '<div class="pt-acts"><button class="btn primary" data-act="breed"' + (chk.ok ? '' : ' disabled title="' + esc(chk.reason) + '"') + '>Breed (' + (a && b ? PT().hatchFee(a, b) : '?') + ' g)</button>' + (chk.ok ? '' : '<span class="dim">' + esc(chk.reason) + '</span>') + '</div>';
    }
    return h + '</div>' + friendBreedHTML();
  }
  // ---- v2.0 merge (WS-B x WS-C): breed with a friend in your Realm (WF.realm.offerPet / acceptPet).
  //      Each game makes its own egg from its own pet + the friend's pet summary (pets.js breedWithFriend).
  function realmMembers() { var s = WF.realm && WF.realm.session && WF.realm.session(); return (s && s.members) || []; }
  function friendBreedHTML() {
    if (!(WF.realm && WF.realm.active && WF.realm.active() && WF.realm.petsReady && WF.realm.petsReady())) return '';
    var s = WF.realm.session(), me = s ? s.seat : -1, friends = realmMembers().filter(function (m) { return m.seat !== me && !m.away; });
    var mine = PT().hatched().filter(function (x) { return PT().canBreedPet(x).ok; });
    if (friendPet && !mine.some(function (x) { return x.uid === friendPet; })) friendPet = null;
    if (!friendPet && mine.length) friendPet = mine[0].uid;
    var nameOf = function (seat) { var m = realmMembers().filter(function (x) { return x.seat === seat; })[0]; return m ? m.name : 'A friend'; };
    var h = '<div class="pt-card"><h4>Breed with a friend</h4><p class="pt-sub">Offer one of your pets to a wizard in your Realm. If they accept with one of theirs, <b>each of you</b> gets an egg in your own nest (you each pay your own hatching fee; both pets rest).</p>';
    if (!mine.length) return h + '<div class="dim">None of your pets can breed right now (' + esc(PD().stages[PD().breedMinStage].name) + ' or older, not resting).</div></div>';
    h += '<label>Your pet<br><select id="pt-fpet">' + mine.map(function (x) { return '<option value="' + esc(x.uid) + '"' + (x.uid === friendPet ? ' selected' : '') + '>' + esc(x.name + ' (' + PT().rarityName(x.rarity) + ' ' + PT().species(x.species).name + ', ' + PT().stageOf(x).name + ')') + '</option>'; }).join('') + '</select></label>';
    h += '<div class="pt-acts">' + (friends.length ? friends.map(function (m) { return '<button class="btn" data-foffer="' + m.seat + '">Offer to ' + esc(m.name) + '</button>'; }).join('') : '<span class="dim">No friends in your Realm right now.</span>') + '</div>';
    var offers = WF.realm.petOffers ? WF.realm.petOffers() : [];
    offers.forEach(function (o) {
      var pt = o.pet || {}, sp = PT().species(pt.species);
      h += '<div style="margin-top:6px">' + esc(nameOf(o.from)) + ' offers ' + (sp ? '<b style="color:' + PT().rarityColor(pt.rarity) + '">' + esc(PT().rarityName(pt.rarity) + ' ' + sp.name) + '</b>' : 'a pet') +
        ' <button class="btn primary" data-faccept="' + esc(o.offerId) + '">Accept with your pet</button></div>';
    });
    return h + '</div>';
  }
  function refOf(v) { if (!v) return null; var i = v.indexOf(':'); return { where: v.slice(0, i), uid: v.slice(i + 1) }; }

  // ---- Starter pets (Tobin)
  function startersTab() {
    var p = player();
    return '<div class="pt-card"><h3>Tobin’s starter pets</h3><p class="pt-sub">Common pets: talents only, no pet cards. Every one can grow to ' + stageName(-1) + ', breed, and become the start of a great line. ' +
      'You have <b>' + U().fmt(p.gold) + ' gold</b>.</p></div>' +
      PT().starters().map(function (sid) {
        var sp = PT().species(sid), c = PT().canBuyStarter(sid);
        return '<div class="pt-card" style="display:flex;gap:12px;align-items:center">' + icon({ species: sid, rarity: 'common' }) +
          '<div style="flex:1"><b>' + esc(sp.name) + '</b> <span class="pt-sub">' + esc(D().schools[sp.school] ? D().schools[sp.school].name : sp.school) + '</span><br><span class="pt-sub">' + esc(sp.desc) + '</span><br>' +
          '<span class="pt-sub">Talents it can carry: ' + Object.keys(sp.pool).map(function (t) { return esc(PT().talent(t).name); }).join(', ') + '</span></div>' +
          '<button class="btn primary" data-buy="' + sid + '"' + (c.ok ? '' : ' disabled title="' + esc(c.reason) + '"') + '>Adopt · ' + sp.starter + ' g</button></div>';
      }).join('');
  }

  // ---- Vault (shared by every wizard of the account)
  function vaultTab() {
    var bank = PT().bankPets(), mine = PT().list().filter(function (x) { return x.uid !== player().activePet; });
    return '<div class="pt-grid2"><div class="pt-card"><h4>This wizard (' + PT().list().length + ' / ' + PD().maxPets + ')</h4><div class="pt-list">' +
      (mine.length ? mine.map(function (x) { return petRow(x, '<span class="pt-badge" data-dep="' + esc(x.uid) + '">Vault ▶</span>'); }).join('') : '<span class="dim">Nothing to send (your equipped pet stays with you).</span>') + '</div></div>' +
      '<div class="pt-card"><h4>Vault (' + bank.length + ' / ' + PD().bankPets + ', all your wizards)</h4><div class="pt-list">' +
      (bank.length ? bank.map(function (x) { return '<div class="pt-row">' + icon(x) + '<span><span class="pt-nm" style="color:' + PT().rarityColor(x.rarity) + '">' + esc(x.egg ? PT().species(x.species).name + ' Egg' : x.name) + '</span><br><span class="pt-sub">' + (x.egg ? 'Egg' : esc(PT().stageOf(x).name)) + ' · ' + esc(PT().rarityName(x.rarity)) + '</span></span><button type="button" class="pt-badge" data-wd="' + esc(x.uid) + '" aria-label="Take ' + esc(x.egg ? PT().species(x.species).name + ' egg' : x.name) + ' from the Vault">◀ Take</button></div>'; }).join('') : '<span class="dim">Empty. Pets you put here can be taken out by any of your wizards, and can parent eggs from here.</span>') +
      '</div></div></div>';
  }

  // ---- Pet Stat Board
  function boardTab() {
    var p = player(), pet = PT().active(), b = PT().activeBonus();
    var h = '<div class="pt-card"><h3>Pet Stat Board</h3>';
    if (pet) {
      h += '<div>' + icon(pet) + ' <b>' + esc(pet.name) + '</b> gives your ' + esc(D().schools[p.school].name) + ' wizard: ' +
        (PT().STAT_KEYS.filter(function (k) { return b[k]; }).map(function (k) { return esc(PU.statText(k, b[k])); }).join(' · ') || '<span class="dim">nothing yet (no talents learned)</span>') +
        (PT().cardsOf(pet).length ? ' · ' + PT().cardsOf(pet).length + ' pet card' + (PT().cardsOf(pet).length > 1 ? 's' : '') : '') + '</div>';
    } else h += '<div class="dim">No pet equipped.</div>';
    var want = PD().wanted[p.school] || [];
    h += '<h4>The perfect pet for ' + esc(D().schools[p.school].name) + '</h4><div>' + rarName('legendary') + ', ' + stageName(-1) + ', with: ' + want.map(function (t) { return '<b>' + esc(PT().talent(t).name) + '</b> (' + esc(PU.statText(PT().talent(t).stat, PT().talent(t).ranks[4])) + ')'; }).join(', ') + '.</div>' +
      '<div class="pt-sub">Breed for pools that carry these talents, then pick them as your pet grows. Glade Heart and the Dealers grow with your level up to 10 (values shown at level 10).</div></div>';
    h += '<div class="pt-card"><h4>Rarities</h4><table><tr><th>Rarity</th><th>Talent rank</th><th>Pet cards</th><th>Hatch fee</th><th>Incubation</th></tr>' +
      PT().RARITIES.map(function (r) { var R = PD().rarity[r]; return '<tr><td>' + rarName(r) + '</td><td>' + R.rankCap + ' / 5</td><td>' + R.cards + '</td><td>' + R.hatchFee + ' g</td><td>' + PU.fmtTime(R.incubate * 60000) + '</td></tr>'; }).join('') + '</table></div>';
    h += '<div class="pt-card"><h4>Species</h4><table><tr><th>Species</th><th>School</th><th>Talents it can carry</th><th>Eggs from</th></tr>' +
      Object.keys(PD().species).map(function (sid) {
        var sp = PD().species[sid], src = PU.eggSources(sid);
        return '<tr><td>' + icon({ species: sid, rarity: 'common' }) + ' ' + esc(sp.name) + '</td><td>' + esc(D().schools[sp.school] ? D().schools[sp.school].name : sp.school) + '</td><td>' +
          Object.keys(sp.pool).map(function (t) { return esc(PT().talent(t).name); }).join(', ') + '</td><td>' + (sp.starter ? 'Tobin (starter)' + (src.length ? ', ' : '') : '') + src.map(function (s) { return esc(s.name); }).join(', ') + '</td></tr>';
      }).join('') + '</table><div class="pt-sub">Eggs are a chase drop: only bosses and elites carry them, and rarely.</div></div>';
    return h;
  }

  function wire(body) {
    body.querySelectorAll('[data-sel]').forEach(function (b) { b.onclick = function () { sel = b.getAttribute('data-sel'); say(''); if (tab !== 'pets') tab = 'pets'; render(); }; });
    body.querySelectorAll('[data-card]').forEach(function (n) {
      try { var c = WF.ui.cardEl(n.getAttribute('data-card'), { small: true }); n.replaceWith(c); } catch (e) { n.textContent = n.getAttribute('data-card'); }
    });
    body.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { var t = b.getAttribute('data-pick'); result(PT().pickTalent(sel, t), 'Learned ' + PT().talent(t).name + '!'); }; });
    body.querySelectorAll('[data-collect]').forEach(function (b) {
      b.onclick = function () { var r = PT().collect(+b.getAttribute('data-collect')); if (r.ok) { sel = r.pet.uid; tab = 'pets'; } result(r, r.ok ? r.pet.name + ' hatched! ' + (player().activePet === r.pet.uid ? 'It is now your equipped pet.' : '') : null); };
    });
    body.querySelectorAll('[data-inc]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); result(PT().incubate(b.getAttribute('data-inc')), 'The egg is snug in its nest.'); }; });
    body.querySelectorAll('[data-buy]').forEach(function (b) { b.onclick = function () { var r = PT().buyStarter(b.getAttribute('data-buy')); if (r.ok) { sel = r.pet.uid; } result(r, r.ok ? 'Welcome home, ' + r.pet.name + '!' : null); }; });
    body.querySelectorAll('[data-dep]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); result(PT().deposit(b.getAttribute('data-dep')), 'Sent to the Vault.'); }; });
    body.querySelectorAll('[data-wd]').forEach(function (b) { b.onclick = function () { result(PT().withdraw(b.getAttribute('data-wd')), 'Taken from the Vault.'); }; });
    var ba = el('pt-ba'), bb = el('pt-bb');
    if (ba) ba.onchange = function () { breedA = ba.value || null; say(''); render(); };
    var fp = body.querySelector('#pt-fpet');
    if (fp) fp.onchange = function () { friendPet = fp.value || null; };
    body.querySelectorAll('[data-foffer]').forEach(function (b) { b.onclick = function () {
      var id = WF.realm.offerPet(+b.getAttribute('data-foffer'), friendPet);
      result(id ? { ok: true } : { ok: false, reason: 'That pet can’t breed right now' }, 'Offer sent. If your friend accepts, an egg appears in your nest.');
    }; });
    body.querySelectorAll('[data-faccept]').forEach(function (b) { b.onclick = function () {
      var ok = WF.realm.acceptPet(b.getAttribute('data-faccept'), friendPet);
      result(ok ? { ok: true } : { ok: false, reason: 'That pet can’t breed right now' }, 'Accepted!');
    }; });
    if (bb) bb.onchange = function () { breedB = bb.value || null; say(''); render(); };
    body.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-act'), pet = PT().get(sel);
        if (a === 'equip') result(PT().equip(sel), pet.name + ' is now following you.');
        else if (a === 'unequip') result(PT().unequip(), 'Unequipped.');
        else if (a === 'feed') { var sn = el('pt-snack'); result(PT().feed(sel, sn && sn.value), 'Yum!'); }
        else if (a === 'rename') { var nn = window.prompt('A new name for ' + pet.name + ':', pet.name); if (nn != null) result({ ok: PT().rename(sel, nn) }, 'Renamed.'); }
        else if (a === 'appraise') result(PT().appraise(sel), 'Nell squints at ' + pet.name + ' for a long time… and writes down every hidden talent.');
        else if (a === 'incubate') { result(PT().incubate(sel), 'The egg is snug in its nest.'); tab = 'hatchery'; render(); }
        else if (a === 'deposit') result(PT().deposit(sel), 'Sent to the Vault.');
        else if (a === 'release') {
          var why = PT().canRelease(sel);
          if (!why.ok) result(why);
          else if (window.confirm('Give ' + (pet.egg ? 'this egg' : pet.name) + ' to Tobin to look after? This cannot be undone.')) { PT().release(sel); sel = null; result({ ok: true }, 'Tobin will take good care of it.'); }
        } else if (a === 'breed') {
          var r = PT().breed(refOf(breedA), refOf(breedB));
          if (r.ok) { breedA = breedB = null; }
          result(r, r.ok ? 'A new ' + PT().rarityName(r.egg.rarity) + ' ' + PT().species(r.egg.species).name + ' egg is in the nest!' : null);
        }
      };
    });
  }

  // ---- HUD button (built here so the HTML and ui.js stay untouched)
  function ensureHud() {
    var hb = el('hud-buttons'), pk = el('hud-btn-pack');
    if (!hb || el('hud-btn-pets')) return;
    var b = document.createElement('button');
    b.id = 'hud-btn-pets'; b.className = 'hbtn'; b.title = 'Pets (P)';
    b.innerHTML = '<b>&#128062;</b><span>Pets</span><small>P</small><em class="hud-new hidden">!</em>';
    b.onclick = function () { PU.toggle(); };
    hb.insertBefore(b, pk || null);
  }
  function refreshHudBadge() {
    var b = el('hud-btn-pets'), e = b && b.querySelector('.hud-new');
    if (e) e.classList.toggle('hidden', !PU.anyOffer() && !PT().slots().some(function (s) { return PT().slotReady(s); }));
  }
  PU.refreshHudBadge = refreshHudBadge;

  // ------------------------------------------------------------------ 3. THE PET IN THE WORLD
  var follow = { mesh: null, key: '', x: 0, z: 0, rot: 0, moving: false, castUntil: 0, hopUntil: 0, zone: null };
  var glade = { nests: [], board: null, zone: null };
  function petKey(pet) { return pet ? pet.uid + '|' + pet.stage + '|' + pet.rarity + '|' + pet.species : ''; }
  function dropFollower() { if (follow.mesh) { if (follow.mesh.parent) follow.mesh.parent.remove(follow.mesh); try { WF.models.dispose(follow.mesh); } catch (e) { /* ignore */ } } follow.mesh = null; follow.key = ''; }
  PU.followerMesh = function () { return follow.mesh; };
  function syncFollower(W) {
    var pet = player() && player().activePet ? PT().active() : null, k = petKey(pet);
    if (k === follow.key) return;
    dropFollower();
    if (!pet || !WF.models.pet) return;
    var sp = PT().species(pet.species);
    follow.mesh = WF.models.pet(sp.look, { rarity: pet.rarity, scale: PT().stageOf(pet).scale * 1.15 });
    follow.mesh.userData.persistent = true;
    W.scene.add(follow.mesh);
    follow.key = k;
    placeBehind(W, true);
  }
  function placeBehind(W, snap) {
    var P = W.player; if (!P || !follow.mesh) return;
    var r = P.rot, tx = P.x - Math.sin(r) * 1.3 + Math.cos(r) * 0.9, tz = P.z - Math.cos(r) * 1.3 - Math.sin(r) * 0.9;
    if (snap) { follow.x = tx; follow.z = tz; follow.rot = r; follow.mesh.position.set(tx, 0, tz); follow.mesh.rotation.y = r; }
    return { x: tx, z: tz };
  }
  function updateFollower(W, dt) {
    if (!follow.mesh || !W.player) return;
    var P = W.player, m = follow.mesh, t = W.time || 0, state = 'idle';
    var duel = W.mode === 'combat' && WF.combatView && WF.combatView.active;
    if (duel) {
      // beside you in the duel circle, facing the same way (between you and the camera's right side)
      var r = P.rot, x = P.x + Math.cos(r) * 1.45 + Math.sin(r) * 0.35, z = P.z - Math.sin(r) * 1.45 + Math.cos(r) * 0.35;
      follow.x += (x - follow.x) * Math.min(1, dt * 6); follow.z += (z - follow.z) * Math.min(1, dt * 6);
      follow.rot = r;
      state = performance.now() < follow.castUntil ? 'cast' : (performance.now() < follow.hopUntil ? 'hop' : 'idle');
    } else {
      var tg = placeBehind(W, false), dx = tg.x - follow.x, dz = tg.z - follow.z, d = Math.hypot(dx, dz);
      if (d > 14) { placeBehind(W, true); d = 0; }
      if (d > 0.25) {
        var sp = Math.min(d, (d > 3 ? 9 : 5.2) * dt);
        follow.x += dx / d * sp; follow.z += dz / d * sp;
        follow.rot += U().angleDiff(follow.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
        state = d > 2.5 ? 'run' : 'walk';
      } else {
        follow.rot += U().angleDiff(follow.rot, P.rot) * Math.min(1, dt * 3);
        state = performance.now() < follow.hopUntil ? 'hop' : 'idle';
      }
    }
    m.position.set(follow.x, 0, follow.z);
    m.rotation.y = follow.rot;
    m.visible = !!(P.mesh ? P.mesh.visible || duel : true) && W.mode !== 'title';
    if (m.userData.anim) m.userData.anim(t, state, dt);
  }
  PU.cheer = function (ms) { follow.hopUntil = performance.now() + (ms || 1400); };
  // the Glade's nests (eggs) + the Pet Stat Board
  function buildGlade(W) {
    glade.nests.forEach(function (n) { if (n.mesh && n.mesh.parent) n.mesh.parent.remove(n.mesh); });
    if (glade.board && glade.board.parent) glade.board.parent.remove(glade.board);
    glade.nests = []; glade.board = null; glade.zone = W.zoneId;
    var Z = W.zone; if (!Z || !Z.petBoard || !W.scene) return;
    if (WF.models.petBoard) {
      glade.board = WF.models.petBoard();
      glade.board.position.set(Z.petBoard.pos[0], 0, Z.petBoard.pos[1]);
      glade.board.rotation.y = Z.petBoard.face || 0;
      W.scene.add(glade.board);
      if (W.fx) { glade.board.userData.update = function () { return W.zoneId === glade.zone; }; W.addFx(glade.board); }
    }
    (Z.petNests || []).forEach(function (n) { glade.nests.push({ pos: n.pos, mesh: null, key: '' }); });
  }
  function updateGlade(W, dt) {
    if (!W.zone || !W.zone.petBoard || !player()) return;
    var slots = PT().slots();
    glade.nests.forEach(function (n, i) {
      var s = slots[i], k = s ? s.pet.uid : '';
      if (k !== n.key) {
        if (n.mesh && n.mesh.parent) n.mesh.parent.remove(n.mesh);
        n.mesh = null; n.key = k;
        if (s && WF.models.petEgg) {
          n.mesh = WF.models.petEgg(PT().species(s.pet.species).look, s.pet.rarity);
          n.mesh.position.set(n.pos[0], 0.55, n.pos[1]);
          W.addFx(n.mesh);
          n.mesh.userData.update = function () { return W.zoneId === glade.zone && n.mesh && n.key === k; };
        }
      }
      if (n.mesh && n.mesh.userData.anim) n.mesh.userData.anim(W.time || 0, PT().slotReady(s));
    });
  }
  function nearBoard(W, d) {
    var Z = W.zone, P = W.player;
    if (!Z || !Z.petBoard || !P) return false;
    return Math.hypot(P.x - Z.petBoard.pos[0], P.z - Z.petBoard.pos[1]) < (d || 3.2);
  }

  // ------------------------------------------------------------------ 4. HOOKS (installed once at boot)
  // v2.1 A4: the training ring's state in the coach's words. Pure (tests/v21-fixes.test.js).
  //   -> { ok, code: 'nopet'|'equip'|'grown'|'resting'|undefined, reason, short, line }
  PU.ringStatus = function (npcId) {
    var c = PT().canTrain(), npc = D().npcs[npcId || 'coach_bramble'] || {}, L = npc.ringLines || {};
    var time = c.readyAt ? PU.fmtTime(c.readyAt - PT().clock()) : '';
    var key = c.ok ? 'ready' : c.code;
    var line = String(L[key] || c.reason || '').replace('{pet}', c.pet || '').replace('{time}', time);
    var short = { nopet: 'no pet yet', equip: 'equip a pet', grown: 'fully grown', resting: 'ready in ' + time }[c.code] || '';
    return { ok: !!c.ok, code: c.code, reason: c.reason + (time ? ' (ready in ' + time + ')' : ''), short: short, line: line };
  };
  PU.install = function () {
    // v2.0 merge: Realm pet offers (realmUI calls these) -> a toast + refresh the Nestery
    PT().onFriendOffer = function (m) { try { UI.toast('A friend offers to breed pets with you: open the Nestery (Pets panel) to accept.', 'quest'); if (PU.isOpen()) render(); } catch (e) { warn(e); } };
    PT().onFriendAccept = function () { try { if (PU.isOpen()) render(); refreshHudBadge(); } catch (e) { warn(e); } };
    if (PU.installed || !WF.ui || !WF.world || !WF.pets) return;
    PU.installed = true;
    var UI = WF.ui, W = WF.world;
    // (a) NPC dialogue buttons
    var talk = UI.talkTo;
    UI.talkTo = function (npcId) {
      var r = talk.apply(this, arguments);
      try {
        var npc = D().npcs[npcId];
        if (npc && npc.pets && UI.dialogNpc && UI.dialogNpc() === npcId) {
          var bb = document.querySelector('#dialog .dlg-buttons');
          if (bb && !bb.querySelector('.pt-dlg')) {
            var label = { hatchery: 'Open the Nestery', starters: 'Adopt a pet', ring: 'Spar in the ring' }[npc.pets] || 'Pets';
            var nb = document.createElement('button'); nb.className = 'btn primary pt-dlg'; nb.textContent = label;
            // v2.1 A4: the ring says what is missing up front, in the dialogue (not a toast after it closes)
            var ring = npc.pets === 'ring' ? PU.ringStatus(npcId) : null;
            if (ring && !ring.ok) {
              nb.textContent = label + ' (' + ring.short + ')';
              nb.title = ring.reason;
              var tx = document.querySelector('#dialog .dlg-text');
              if (tx && ring.line) { tx.textContent = ring.line; try { if (WF.voice) WF.voice.say(npcId, ring.line, { noFallback: true }); } catch (e) { /* silent */ } }   // no robot voice for lines without a clip
              if (ring.code === 'equip') {
                var ob = document.createElement('button'); ob.className = 'btn pt-dlg-open'; ob.textContent = 'Open Pets (P)';
                ob.onclick = function () { UI.closeDialog(true); PU.open('pets'); };
                bb.insertBefore(ob, bb.firstChild);
              }
            }
            nb.onclick = function () {
              if (npc.pets === 'ring') {
                var tr = PT().train();
                if (!tr.ok) {   // v2.1 A4: stay in the dialogue and let the coach explain
                  var st = PU.ringStatus(npcId), t2 = document.querySelector('#dialog .dlg-text');
                  if (t2 && st.line) t2.textContent = st.line;
                  WF.sfx.play('error');
                  return;
                }
                UI.closeDialog(true);
                PU.cheer(2400); UI.toast('<b>' + esc(PT().active().name) + '</b> spars with Coach Bramble: +' + tr.xp + ' pet XP' + (tr.stages.length ? ' · grew into a <b>' + esc(PT().stageOf(PT().active()).name) + '</b>!' : ''), 'quest'); WF.sfx.play('buff'); if (PT().active().offer) PU.open('pets');
                return;
              }
              UI.closeDialog(true);
              PU.open(npc.pets === 'hatchery' ? 'hatchery' : 'starters', npcId);
            };
            bb.insertBefore(nb, bb.firstChild);
            bb.querySelectorAll('.btn.primary:not(.pt-dlg)').forEach(function (x) { x.classList.remove('primary'); });
          }
        }
      } catch (e) { warn(e); }
      return r;
    };
    // (b) closing everything closes the Pets panel too; nothing else opens on top of it
    var closeAll = UI.closeAll;
    UI.closeAll = function () { if (PU.isOpen()) PU.close(true); return closeAll.apply(this, arguments); };
    var blocking = UI.blocking;
    UI.blocking = function () { return PU.isOpen() || blocking.apply(this, arguments); };
    // (c) keys: P toggles, Esc closes (capture: before ui.js opens its menu)
    window.addEventListener('keydown', function (e) {
      if (U().isTyping(e.target) || e.repeat) return;
      if (PU.isOpen() && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); PU.close(); return; }
      if (e.code === 'KeyP' && W.mode !== 'combat' && W.mode !== 'title' && W.mode !== 'loading' && W.mode !== 'dialog' && W.mode !== 'cutscene') {   // v2.1 QA: not during story vignettes
        if (PU.isOpen()) { e.preventDefault(); PU.close(); } else if (W.mode === 'explore') { e.preventDefault(); PU.open('pets'); }
        return;
      }
      if (e.code === 'KeyE' && W.mode === 'explore' && !PU.isOpen() && nearBoard(W) && !(W.nearestNpc && W.nearestNpc(3.6))) { e.preventDefault(); e.stopImmediatePropagation(); PU.open('board'); }
    }, true);
    // (d) prompt for the Stat Board
    var prompt = UI.prompt;
    UI.prompt = function (html) {
      if (!html && W.mode === 'explore' && nearBoard(W) && !PU.isOpen()) html = 'Press <b>E</b> to read the Pet Stat Board';
      return prompt.call(this, html);
    };
    // (e) world: follower, nests, board
    var upd = W.update;
    W.update = function (dt) {
      var r = upd.apply(this, arguments);
      try {
        if (player() && W.scene && W.player) {
          if (glade.zone !== W.zoneId) buildGlade(W);
          syncFollower(W); updateFollower(W, dt); updateGlade(W, dt);
        } else if (follow.mesh) dropFollower();
      } catch (e) { warn(e); }
      return r;
    };
    var load = W.loadZone;
    W.loadZone = function () {
      var r = load.apply(this, arguments);
      try { glade.zone = null; if (follow.mesh) placeBehind(W, true); } catch (e) { warn(e); }
      return r;
    };
    // (f) duels: the pet hops when you cast its card
    if (WF.cine && WF.cine.play) {
      var play = WF.cine.play;
      WF.cine.play = function (spec) {
        try { var c = spec && D().cards[spec.card]; if (c && c.source === 'pet' && !spec.isEnemy && (!spec.caster || !WF.world.player || spec.caster === WF.world.player.mesh)) follow.castUntil = performance.now() + 2600; } catch (e) { warn(e); }
        return play.apply(this, arguments);
      };
    }
    // (g) pet cards borrow an existing painted picture (artAs) until they get their own
    if (WF.cardArt) {
      var has0 = WF.cardArt.has, url0 = WF.cardArt.url;
      // v2.1: every pet card has its own picture (rank I's; ranks II / III share it); artAs is the fallback
      var alias = function (id) {
        var c = D().cards[id]; if (!c || c.source !== 'pet' || has0(id)) return id;
        var base = c.petRank > 1 ? id.replace(/_[23]$/, '') : id;
        return has0(base) ? base : (c.artAs || id);
      };
      WF.cardArt.has = function (id) { return has0(alias(id)); };
      WF.cardArt.url = function (id) { return url0(alias(id)); };
    }
    if (UI.cardEl) {
      var cardEl = UI.cardEl;
      UI.cardEl = function (cardId) { var n = cardEl.apply(this, arguments); try { var c = D().cards[cardId]; if (c && c.source === 'pet' && n && n.classList) n.classList.add('pet-card'); } catch (e) { warn(e); } return n; };
    }
    // (h) duel results: eggs + pet XP
    var show = UI.showResults;
    UI.showResults = function (r) {
      var pr = show.apply(this, arguments);
      try {
        var res = r && r.result === 'win' && r.loot && r.loot.petResult, box = el('results'), ok = el('rs-ok');
        if (res && box && ok && (res.eggs.length || res.xp || res.lost || (res.vaulted && res.vaulted.length))) {
          var pet = res.pet ? PT().get(res.pet) : null, d = document.createElement('div');
          d.className = 'rs-pets';
          d.innerHTML = (res.eggs.length ? res.eggs.map(function (e) { return '<div>🥚 <b style="color:' + PT().rarityColor(e.rarity) + '">' + esc(PT().rarityName(e.rarity)) + ' ' + esc(PT().species(e.species).name) + ' egg!</b> Hatch it at the Nestling Glade.</div>'; }).join('') : '') +
            // v2.0 QA M1: eggs that did not fit go to the Vault; only if the Vault is full too is an egg lost (named)
            (res.vaulted || []).map(function (e) { return '<div>🥚 <b style="color:' + PT().rarityColor(e.rarity) + '">' + esc(PT().rarityName(e.rarity)) + ' ' + esc(PT().species(e.species).name) + ' egg!</b> Your pets are full (' + PD().maxPets + '), so it went to the Vault.</div>'; }).join('') +
            (res.lost ? '<div class="rs-pet-lost">' + (res.lostEggs || []).map(function (e) { return esc(PT().rarityName(e.rarity) + ' ' + PT().species(e.species).name); }).join(', ') + ' egg' + (res.lost > 1 ? 's' : '') + ' rolled away: your pets (' + PD().maxPets + ') and the Vault (' + PD().bankPets + ') are full. Make room before your next boss!</div>' : '') +
            (pet && res.xp ? '<div>🐾 ' + esc(pet.name) + ' +' + res.xp + ' XP' + (res.stages.length ? ' · grew into a <b>' + esc(PT().stageOf(pet).name) + '</b>! Choose its new talent in the Pets panel (P).' : '') + '</div>' : '');
          box.insertBefore(d, ok);
          if (res.eggs.length || (res.vaulted && res.vaulted.length)) try { WF.sfx.play('loot_epic'); } catch (e2) { /* sound missing */ }
        }
        refreshHudBadge();
      } catch (e) { warn(e); }
      return pr;
    };
    // (i) toasts from the pet rules
    PT().on(function (type, e) {
      try {
        if (type === 'xp' && e.stages && e.stages.length && WF.world.mode !== 'combat') { var p = PT().get(e.uid); if (p) UI.toast('<b>' + esc(p.name) + '</b> grew into a <b>' + esc(PT().stageOf(p).name) + '</b>! Pick its new talent (P).', 'quest'); }
        refreshHudBadge();
        if (PU.isOpen()) render();
      } catch (x) { warn(x); }
    });
    ensureHud();
  };

  // install after the game's own modules (main.js boots on DOMContentLoaded)
  function boot() { try { PU.install(); } catch (e) { warn(e); } }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }
  return PU;
})();
