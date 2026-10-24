// =====================================================================
//  WIZZIE FARM — PLAYER STATE, SAVING, LEVELING, INVENTORY, QUESTS
//  Everything about "your wizard" lives in WF.state.player and is saved
//  to the browser's local storage.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.state = (function () {
  'use strict';
  var SAVE_KEY = 'wizziefarm_save_v1';
  // Save format version. v3 (v1.1): equipped.mount, mounted, newItems, settings.cinematics.
  // v5 (v2.0, V2.0-CONTRACT §9 "v4 -> v5"): ONE number for the whole save format, so the per-wizard
  // version jumps 3 -> 5 together with the account (4 -> 5); there is no wizard "v4". A save written
  // by a NEWER game keeps its higher number (never downgraded). Format: docs/ARCHITECTURE.md "Saves (v5)".
  var SAVE_VERSION = 6;

  var api = { player: null, locked: false };
  var listeners = [];

  function D() { return WF.data; }
  function P() { return WF.data.progression; }
  function emit(type, payload) {
    listeners.forEach(function (fn) { try { fn(type, payload); } catch (e) { console.error(e); } });
  }
  api.on = function (fn) { listeners.push(fn); };

  // Deck limits: v1.2 WS3 — the EQUIPPED DECK ITEM's rules (decks.js), falling
  // back to progression.js when the game data has no deck items.
  api.deckMax = function () { return api.deckRules().size; };
  api.deckMin = function () { return P().deckMin || 6; };
  api.maxCopies = function () { return api.deckRules().maxCopies; };
  api.homeZone = function () { return P().homeZone || 'lumen_commons'; };

  // ------------------------------------------------------------------
  // New game / save / load
  // ---- v1.2 WS5: account with 3 wizard slots (V1.2-CONTRACT §4)
  //  storage key 'wizziefarm_account_v1' = { version: 5, slots: [p|null, p|null, p|null],
  //    last: 0..2, settings: { master, music, textScale, quality }, legacySig,
  //    bank: { items, capacity, pets[] }, realm: { lastCode } }          (v5 = v2.0, see SAVE_VERSION)
  //  api.player is still the ACTIVE wizard (a plain JSON object), so all other code is unchanged.
  //  The account is re-read from storage on every call (it is small), so a second tab, a test
  //  that clears storage, or the desktop app's file storage can never get out of step with it.
  // ------------------------------------------------------------------
  var ACCOUNT_KEY = 'wizziefarm_account_v1';
  var ACCOUNT_BAK = 'wizziefarm_account_v1_bak';          // last good account seen this session (browser safety copy)
  var ACCOUNT_BAD = 'wizziefarm_account_v1_damaged';      // unreadable account text, kept for recovery
  var DELETED_KEY = 'wizziefarm_deleted_v1';              // the most recently deleted wizard (insurance)
  var ACCOUNT_PRE_V5 = 'wizziefarm_account_v1_pre_v5';    // v2.0: the account text exactly as the last pre-v5 game left it (written once)
  var ACCOUNT_PRE_V6 = 'wizziefarm_account_v1_pre_v6';    // v2.1: the account text exactly as the last pre-v6 (v2.0) game left it (written once)
  var ACCOUNT_NEWER = 'wizziefarm_account_v1_from_v';     // + version: a save from a NEWER game, as first seen here (written once)
  var REALM_OLD_KEY = 'wizziefarm_realm_v1';               // v2.0 WS-C's interim key for the last realm code (moved into account.realm)
  var ACCOUNT_VERSION = 6;                                 // v4 = v1.2 (slots + bank); v5 = v2.0 (bank.pets, realm; wizards: look, storyFlags, ...)
                                                           // v6 = v2.1 (wizards: deckDepth x3 decks, dungeonsCleared, look.eyeColor). The number
                                                           // matters for going BACK: a v2.0 copy of the game sees a newer save and keeps its fields.
  api.SLOTS = 3;
  var activeIdx = null;                                    // slot of api.player (null = none loaded)
  api.recovered = null;                                    // 'backup' | 'reset' after a damaged account was found
  api.legacyPending = false;                               // an old-version save could not be placed (all slots full)
  var lastBak = 0;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // v2.1 QA (v2.0 review minor): a new wizard starts with the OS "reduce motion" preference
  function osReducedMotion() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function slotIdx(i) { i = Number(i); return (i >= 0 && i < api.SLOTS && Math.floor(i) === i) ? i : -1; }
  // Small stable hash of a text (FNV-1a 32) - tells whether the old v1.1 save changed since we read it.
  function sig(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return text.length + ':' + h.toString(16);
  }
  function defaultSettings() { return { master: 0.7, music: 0.45, textScale: 1, quality: 'auto' }; }
  var BANK_CAPACITY = 120;                                 // V1.2-CONTRACT §6.2
  function freshBank() { return { items: {}, capacity: BANK_CAPACITY, pets: [] }; }
  function freshAccount() { return { version: ACCOUNT_VERSION, slots: [null, null, null], last: 0, settings: defaultSettings(), legacySig: null, bank: freshBank(), realm: {} }; }
  function badKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }
  // A save from a newer game: keep the fields this version does not know (so they survive a rollback)
  function keepUnknown(src, out) {
    if (!isObj(src) || !isObj(out)) return;
    Object.keys(src).forEach(function (k) { if (!badKey(k) && !Object.prototype.hasOwnProperty.call(out, k)) out[k] = src[k]; });
  }
  // The version number a stored save claims (0 = none / unreadable)
  function verOf(o) { var v = isObj(o) ? Number(o.version) : 0; return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  // v5: the shared Vault's pets. pets.js (WS-B) owns the repair rules (cleanBankPets); without it
  // (Node tests that load a subset of the game) the list is kept as it is (objects only), never emptied.
  function cleanBankPetList(list) {
    if (!Array.isArray(list)) return [];
    if (WF.pets && WF.pets.cleanBankPets) return WF.pets.cleanBankPets(list);
    var cap = (D().pets && D().pets.bankPets) || 200;
    return list.filter(isObj).slice(0, cap);
  }
  // v5 (V2.0-CONTRACT §9, WS-C): account.realm = { lastCode } - only the code of the last realm YOU
  // hosted (reused when it is free). Nothing about another player is ever saved.
  function cleanRealmCode(c) { return (typeof c === 'string' && /^[A-Z0-9]{4,12}$/.test(c)) ? c : null; }
  function migrateRealm(r) {
    var out = {};
    var c = isObj(r) ? cleanRealmCode(r.lastCode) : null;
    if (c) out.lastCode = c;
    return out;
  }
  // Repair the shared bank. Counts become whole numbers >= 1. An item id this version of the
  // game does not know is KEPT (an older copy of the data, a later update) but never listed.
  function migrateBank(b) {
    var out = freshBank();
    if (!isObj(b)) return out;
    var items = isObj(b.items) ? b.items : {};
    Object.keys(items).forEach(function (id) {
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') return;
      var n = Math.floor(num(items[id], 0));
      if (n > 0) out.items[id] = Math.min(MAX_NUM, n);
    });
    var cap = Math.floor(num(b.capacity, BANK_CAPACITY));
    out.capacity = Math.max(BANK_CAPACITY, Math.min(10000, cap));       // only ever grows
    out.pets = cleanBankPetList(b.pets);                                  // v5 (WS-B): pets in the Vault, default []
    return out;
  }

  // Repair / upgrade the account object itself (wizards inside are migrated when loaded).
  // A slot that is an object but not a valid wizard is KEPT (shown as "damaged" so the player
  // can export or delete it); anything else becomes an empty slot.
  function migrateAccount(a) {
    if (!isObj(a)) return freshAccount();
    var out = freshAccount();
    var src = Array.isArray(a.slots) ? a.slots : [];
    for (var i = 0; i < api.SLOTS; i++) out.slots[i] = isObj(src[i]) ? src[i] : null;
    var l = slotIdx(a.last); out.last = l >= 0 ? l : 0;
    var s = isObj(a.settings) ? a.settings : {};
    out.settings.master = Math.min(1, Math.max(0, num(s.master, 0.7)));
    out.settings.music = Math.min(1, Math.max(0, num(s.music, 0.45)));
    var ts = num(s.textScale, 1);
    out.settings.textScale = [1, 1.15, 1.3].reduce(function (x, y) { return Math.abs(y - ts) < Math.abs(x - ts) ? y : x; }, 1);
    var q = ['auto', 'ultra', 'high', 'medium', 'low'].concat((WF.gfx && WF.gfx.qualities) || []);
    out.settings.quality = q.indexOf(s.quality) >= 0 ? s.quality : 'auto';
    out.legacySig = typeof a.legacySig === 'string' ? a.legacySig : null;
    if (isObj(a.legacySync) && slotIdx(a.legacySync.slot) >= 0) out.legacySync = { slot: a.legacySync.slot, savedAt: num(a.legacySync.savedAt, 0) };
    if (a.created) out.created = num(a.created, Date.now());
    out.bank = migrateBank(a.bank);                          // accounts made before the bank existed get an empty one
    out.realm = migrateRealm(a.realm);                       // v5: {} until you host a realm
    out.version = ACCOUNT_VERSION;
    var v = verOf(a);
    if (v > ACCOUNT_VERSION) {                               // a NEWER game wrote this: keep its number and its extra fields
      out.version = v;
      keepUnknown(a, out); keepUnknown(a.settings, out.settings); keepUnknown(a.bank, out.bank); keepUnknown(a.realm, out.realm);
    }
    return out;
  }
  api.migrateAccount = migrateAccount;

  // Browser only (the desktop app keeps 5 rotating file backups itself): every 10 minutes the
  // account text that is about to be replaced is copied to ACCOUNT_BAK first.
  function safetyCopy(force) {
    var St = WF.storage;
    if (St.kind() !== 'browser') return;
    var now = Date.now();
    if (!force && now - lastBak < 10 * 60 * 1000) return;
    var text = St.raw(ACCOUNT_KEY), ok = false;
    try { ok = !!text && isObj(JSON.parse(text)); } catch (e) { ok = false; }
    if (ok) { St.storeRaw(ACCOUNT_BAK, text); lastBak = now; }
  }
  function writeAccount(acc) {
    if (!(verOf(acc) > ACCOUNT_VERSION)) acc.version = ACCOUNT_VERSION;   // never downgrade a newer save's number
    acc.savedAt = Date.now();
    safetyCopy(false);
    var ok = WF.util.store(ACCOUNT_KEY, acc);
    if (ok) dropOldRealmKey(acc);                     // v5: the realm code is in the account now
    return ok;
  }

  // ---- v2.0: save v4 -> v5 (V2.0-CONTRACT §0 rule 8, §9). Before the first v5 write, the account
  //  text exactly as the older game left it is copied ONCE to ACCOUNT_PRE_V5 (never overwritten:
  //  a later v4 text, e.g. after rolling back to v1.2 and playing on, does not replace the first copy).
  //  WF.storage keeps it in localStorage (browser) or in its own file
  //  %APPDATA%\Wizzie Farm\saves\wizziefarm_account_v1_pre_v5.json (desktop app), next to the app's
  //  5 rotating account.N.json backups (those rotate out after about an hour of play).
  //  A v1.1-only player has no account yet: the v1.1 key itself is the untouched original (never written).
  function keepOnce(key, text) {
    var St = WF.storage;
    if (!text || St.raw(key)) return true;
    var ok = St.storeRaw(key, text);
    if (!ok) console.warn('Wizzie Farm: could not keep a copy of the old save under ' + key + ' (storage full or blocked); the safety copies still hold it.');
    return ok;
  }
  // The old realm key (WS-C, before v5) moves into account.realm.lastCode. -> true when acc changed.
  //  The old key is removed only after an account write that holds the code (realmKeyPending).
  var realmKeyPending = false;
  function oldRealmCode() { var old = WF.storage.load(REALM_OLD_KEY); return isObj(old) ? cleanRealmCode(old.lastCode) : null; }
  function takeOldRealmKey(acc) {
    var c = oldRealmCode();
    if (!c) return false;
    realmKeyPending = true;                           // the account (once written) is the only home of the code
    if (acc.realm.lastCode) return false;             // an account code always wins over the old key
    acc.realm.lastCode = c;
    return true;
  }
  function dropOldRealmKey(acc) {
    if (!realmKeyPending || !acc.realm || !acc.realm.lastCode) return;
    WF.storage.remove(REALM_OLD_KEY);
    realmKeyPending = false;
  }

  // Read the account (never null). opts.sync = also pick up a save written by an older
  // version of the game (the v1.1 key). Damaged account text is copied aside, then the
  // session's safety copy is used if there is one. An account from before v5 is backed up
  // (ACCOUNT_PRE_V5) and upgraded in memory; like every other repair, it reaches the disk with
  // the next write (reading alone never rewrites the account), and migrateAccount is idempotent.
  function readAccount(opts) {
    var St = WF.storage, text = St.raw(ACCOUNT_KEY), acc = null, dirty = false, srcText = text;
    if (text) {
      try { acc = JSON.parse(text); } catch (e) { acc = null; }
      if (!isObj(acc)) {
        if (!St.raw(ACCOUNT_BAD)) St.storeRaw(ACCOUNT_BAD, text);       // never overwrite an older damaged copy
        var bak = St.load(ACCOUNT_BAK);
        acc = isObj(bak) ? bak : null;
        srcText = acc ? St.raw(ACCOUNT_BAK) : null;
        api.recovered = acc ? 'backup' : 'reset';
        dirty = true;
        console.warn('Wizzie Farm: the account save was damaged; ' + (acc ? 'restored the safety copy.' : 'starting a new account.') + ' The damaged text is kept under ' + ACCOUNT_BAD);
      }
    }
    var fromV = acc ? verOf(acc) : ACCOUNT_VERSION, upgrade = !!acc && fromV < ACCOUNT_VERSION;
    if (upgrade && fromV < 5) keepOnce(ACCOUNT_PRE_V5, srcText);          // before anything can write v5
    if (upgrade) keepOnce(ACCOUNT_PRE_V6, srcText);                       // v2.1: before the decks are tripled (migrateDeckDepth)
    else if (acc && fromV > ACCOUNT_VERSION) keepOnce(ACCOUNT_NEWER + fromV, srcText);
    if (!acc) { acc = freshAccount(); acc.created = Date.now(); }
    acc = migrateAccount(acc);
    if (upgrade) takeOldRealmKey(acc);
    if (opts && opts.sync && syncLegacy(acc)) dirty = true;
    if (dirty) writeAccount(acc);
    return acc;
  }

  // ---- v5 (WS-C): the last realm code you hosted (realmUI.js). -> 'K7Q4MD' | null
  //  A code still in the pre-v5 key (an account that was already v5, or none yet) moves over here once.
  api.realmLastCode = function () {
    var acc = readAccount();
    if (!acc.realm.lastCode && takeOldRealmKey(acc)) writeAccount(acc);
    return acc.realm.lastCode || null;
  };
  api.setRealmLastCode = function (code) {
    var c = cleanRealmCode(code);
    if (!c) return false;
    var acc = readAccount();
    if (acc.realm.lastCode === c) return true;
    acc.realm.lastCode = c;
    return writeAccount(acc);
  };
  api.account = function () { return readAccount({ sync: true }); };

  // Same wizard? (created time is set once at creation; old saves without it use name + school)
  function sameWizard(a, b) {
    if (!isObj(a) || !isObj(b)) return false;
    var ca = a.stats && a.stats.created, cb = b.stats && b.stats.created;
    if (ca && cb) return ca === cb;
    return String(a.name) === String(b.name) && a.school === b.school;
  }
  function validWizard(p) { return isObj(p) && (D().playableSchools || []).indexOf(p.school) >= 0; }

  // First boot of v1.2: the v1.1 save ('wizziefarm_save_v1') moves into slot 0. The old key is
  // never changed (it stays as a backup). If an OLDER copy of the game writes that key again
  // later (Chrome shares storage between every game folder opened from disk), its progress is
  // picked up too:
  //  - same wizard, not played in v1.2 since the last pick-up, and at least as new -> that slot;
  //  - same wizard but ALSO played in v1.2 since (two different futures) -> a copy in an empty
  //    slot, so neither version's progress is lost;
  //  - another wizard -> the first empty slot.
  // With no empty slot nothing changes and api.legacyPending is set (the select screen says so).
  function syncLegacy(acc) {
    var text = WF.storage.raw(SAVE_KEY);
    if (!text) return false;
    var s = sig(text);
    if (s === acc.legacySig) return false;
    acc.legacySig = s;
    var p = null;
    try { p = JSON.parse(text); } catch (e) { p = null; }
    if (!validWizard(p)) return true;                       // unreadable old save: remember it, leave it alone
    var at = -1, i, match = -1;
    for (i = 0; i < api.SLOTS; i++) if (sameWizard(acc.slots[i], p)) { match = i; break; }
    if (match >= 0) {
      var cur = acc.slots[match], ls = acc.legacySync;
      var forked = !!(ls && ls.slot === match && num(cur.savedAt, 0) !== ls.savedAt);
      if (!forked) {
        if (num(p.savedAt, 0) < num(cur.savedAt, 0)) return true;   // this slot already has newer progress
        at = match;
      }
    }
    if (at < 0) {
      for (i = 0; i < api.SLOTS; i++) if (!acc.slots[i]) { at = i; break; }
      if (at < 0) { api.legacyPending = true; return true; }
    }
    acc.slots[at] = p;
    acc.last = at;
    acc.legacySync = { slot: at, savedAt: num(p.savedAt, 0) };
    return true;
  }

  // Run a function with p as the current wizard (stats/appearance helpers read api.player)
  function withPlayer(p, fn) {
    var prev = api.player;
    api.player = p;
    try { return fn(); } finally { api.player = prev; }
  }
  api.appearanceFor = function (p) { return withPlayer(p, function () { return api.appearance(); }); };

  // Summaries for the wizard select screen: [{ slot, name, school, level, zone, look, ... } | null] x3
  api.slots = function () {
    var acc = readAccount({ sync: true });
    return acc.slots.map(function (raw, i) {
      if (!raw) return null;
      var p;
      try { p = migrate(WF.util.deepClone(raw)); } catch (e) { p = null; }
      if (!p) return { slot: i, damaged: true, name: typeof raw.name === 'string' ? raw.name.replace(/[<>&"]/g, '').slice(0, 18) : '' };
      var sc = D().schools[p.school] || {}, z = D().zones[p.zone];
      var look = null;
      try { look = api.appearanceFor(p); } catch (e) { look = null; }
      return {
        slot: i, name: p.name, school: p.school, schoolName: sc.name || p.school, level: p.level,
        zone: z ? p.zone : api.homeZone(), zoneName: (z || D().zones[api.homeZone()] || {}).name || '',
        look: look, playTime: num(p.stats && p.stats.playTime, 0), savedAt: num(raw.savedAt, 0),
        mount: p.equipped && p.equipped.mount || null, damaged: false
      };
    });
  };
  api.activeSlot = function () { return api.player ? activeIdx : null; };
  api.lastSlot = function () { return readAccount({ sync: true }).last; };
  api.firstEmptySlot = function () {
    var acc = readAccount({ sync: true });
    for (var i = 0; i < api.SLOTS; i++) if (!acc.slots[i]) return i;
    return -1;
  };
  api.accountSettings = function () { return readAccount().settings; };
  // Settings used before a wizard is loaded (volume / text size / graphics on the select screen)
  api.setAccountSettings = function (patch) {
    var acc = readAccount();
    Object.keys(patch || {}).forEach(function (k) { acc.settings[k] = patch[k]; });
    acc = migrateAccount(acc);
    return writeAccount(acc);
  };

  // The rest of loading a wizard (shared by loadSlot / importSave callers)
  function finishLoad(p) {
    api.player = p;
    try { api.applyGrant(); } catch (e) { console.error('Gear grant failed', e); }
    // An update may have raised the level cap: apply XP banked at the old cap
    if (p.bankedXp > 0 && p.level < P().maxLevel) {
      var b = p.bankedXp; p.bankedXp = 0; api.addXP(b);
    }
    // An update may have added spells for levels already reached: grant them right away
    schoolCardsUpTo(p.level).forEach(function (id) {
      if (p.known.indexOf(id) < 0 && p.pendingSpells.indexOf(id) < 0) p.pendingSpells.push(id);
    });
    var s = api.stats();
    p.hp = Math.min(p.hp, s.maxHp); p.mana = Math.min(p.mana, s.maxMana);
    if (!D().zones[p.zone]) { p.zone = api.homeZone(); p.pos = D().zones[p.zone].spawn.slice(); }
    return p;
  }

  // Load slot i as the active wizard (runs the per-wizard migrate). Returns the player or null.
  api.loadSlot = function (i) {
    i = slotIdx(i);
    if (i < 0) return null;
    var acc = readAccount({ sync: true }), raw = acc.slots[i];
    if (!validWizard(raw)) return null;
    var p;
    try { p = migrate(WF.util.deepClone(raw)); } catch (e) { console.error('Save migration failed', e); return null; }
    activeIdx = i;
    api.locked = false;
    finishLoad(p);
    if (acc.last !== i) { acc.last = i; writeAccount(acc); }
    return p;
  };

  // v1.1 API: load the last-played wizard (or the first one that loads)
  api.load = function () {
    var acc = readAccount({ sync: true });
    var order = [acc.last, 0, 1, 2].filter(function (v, k, a) { return a.indexOf(v) === k; });
    for (var k = 0; k < order.length; k++) {
      if (acc.slots[order[k]]) { var p = api.loadSlot(order[k]); if (p) return p; }
    }
    return null;
  };

  // A new wizard in `slot` (default: the first empty slot). Returns the player, or null when
  // every slot is taken (and nothing changes). Keeps the account's sound/text/graphics settings.
  api.newGame = function (name, school, slot, look) {
    var acc = readAccount({ sync: true });
    var at = slot == null ? -1 : slotIdx(slot);
    if (slot == null) { for (var i = 0; i < api.SLOTS; i++) if (!acc.slots[i]) { at = i; break; } }
    if (at < 0) return null;
    activeIdx = at;
    return createWizard(name, school, acc.settings, look);      // saves into slot `at`
  };

  function createWizard(name, school, accSettings, look) {
    var home = api.homeZone(), z = D().zones[home];
    var p = {
      version: SAVE_VERSION,
      name: name, school: school, level: 1, xp: 0, bankedXp: 0,
      gold: P().startGold != null ? P().startGold : 25,
      hp: 1, mana: 1,
      known: [], deck: {}, tcs: {}, pendingSpells: [], trainingPoints: 0,
      runeglass: 0, spellRanks: {},                 // v2.0 M1 (WS-A): Runeglass + Spellwright ranks
      deckDepth: 3,                                 // v2.1 A5: deck numbers tripled for finite decks (migrateDeckDepth)
      inventory: WF.util.deepClone(P().startItems || { minor_health: 2, mana_potion: 1 }),
      equipped: { hat: null, robe: null, boots: null, wand: null, amulet: null, mount: null },
      mounted: false, newItems: {},
      quests: { active: {}, done: {} },
      visited: {}, interacted: {}, seenEnemies: {}, seenZones: {},
      storyFlags: {},          // v2.0 WS-E: story plants / vignettes seen (WF.story)
      dungeonsCleared: {},     // v2.1: { dungeonId: full clears } (the world-exit gate, WF.state.meets)
      look: isObj(look) ? WF.util.deepClone(look) : defaultLook(),   // v2.1 WS-D: the creator's choices (validated by migrateLook)
      pets: [], activePet: null, hatchery: { slots: [], cooldowns: {} },   // v2.0 WS-B (pets.js repairs them)
      zone: home, pos: [z.spawn[0], z.spawn[1]], rot: Math.PI,
      stats: { kills: {}, deaths: 0, fights: 0, playTime: 0, created: Date.now(), levelAt: { 1: 0 } },
      settings: { master: 0.7, music: 0.45, textScale: 1, cinematics: 'full', reduceMotion: osReducedMotion() }   // v2.1 QA: follows the OS setting at creation
    };
    if (accSettings) {      // v1.2 WS5: a new wizard keeps the account's sound / text / graphics choices
      p.settings.master = accSettings.master; p.settings.music = accSettings.music;
      p.settings.textScale = accSettings.textScale; p.settings.graphics = accSettings.quality || 'auto';
    }
    api.migrateLook(p);                              // v2.1 WS-D: a valid p.look from the creator (or the default)
    api.player = p;
    api.locked = false;
    // Starting spells are known immediately (no trainer visit needed)
    schoolCardsUpTo(1).forEach(function (id) { api.learnCard(id, true); });
    // make sure the starting deck meets the minimum size (extra copies of the first attack)
    var first = schoolCardsUpTo(1).filter(function (id) { return ['damage', 'dot', 'aoe'].indexOf(D().cards[id].type) >= 0; })[0];
    while (first && api.deckSize() < api.deckMin() && (p.deck[first] || 0) < api.maxCopies()) p.deck[first] = (p.deck[first] || 0) + 1;
    var s = api.stats();
    p.hp = s.maxHp; p.mana = s.maxMana;
    api.save();
    return p;
  };

  // ---- v1.2 WS5: save / slots
  // true when at least one slot holds a wizard (an old v1.1 save is moved in first)
  api.hasSave = function () { return readAccount({ sync: true }).slots.some(function (s) { return !!s; }); };

  // Write the active wizard into its slot (and the account's settings from it)
  // put the active wizard (and its settings) into acc
  function putActive(acc) {
    if (activeIdx == null || slotIdx(activeIdx) < 0) {          // a player set directly (tests / tools): first empty slot
      activeIdx = acc.slots.indexOf(null) >= 0 ? acc.slots.indexOf(null) : acc.last;
    }
    var p = api.player;
    p.savedAt = Date.now();
    acc.slots[activeIdx] = p;
    acc.last = activeIdx;
    var st = p.settings || {}, prevSettings = acc.settings;
    acc.settings = { master: st.master, music: st.music, textScale: st.textScale, quality: st.graphics || 'auto' };
    if (verOf(acc) > ACCOUNT_VERSION) keepUnknown(prevSettings, acc.settings);   // v5: a newer game's settings survive
    return acc;
  }
  api.save = function () {
    if (!api.player || api.locked) return false;
    return writeAccount(migrateAccount(putActive(readAccount())));
  };

  // Delete slot i (the UI asks the player to type the wizard's name first). The wizard is
  // kept under 'wizziefarm_deleted_v1' until the next delete, as insurance.
  api.deleteSlot = function (i) {
    i = slotIdx(i);
    if (i < 0) return false;
    var acc = readAccount({ sync: true });
    if (!acc.slots[i]) return false;
    WF.util.store(DELETED_KEY, { at: Date.now(), slot: i, wizard: acc.slots[i] });
    acc.slots[i] = null;
    if (acc.last === i) { var f = acc.slots.findIndex(function (s) { return !!s; }); acc.last = f >= 0 ? f : 0; }
    if (activeIdx === i) { api.player = null; activeIdx = null; }
    return writeAccount(acc);
  };
  // v1.1 API: delete the active wizard
  api.deleteSave = function () { if (activeIdx != null) api.deleteSlot(activeIdx); api.player = null; activeIdx = null; };

  // ------------------------------------------------------------------
  // ---- v1.2 WS5: shared account bank (V1.2-CONTRACT §6.2). Data layer only; the Vault NPC
  //  and its two-pane UI are WS8's. One bank for the whole account: deposit from the active
  //  wizard, withdraw into the active wizard (switch wizards to hand things over).
  //  Capacity: a reagent/potion stack takes 1 space whatever its size; every gear piece,
  //  mount and deck takes 1 space each. Equipped gear/mounts must be unequipped first.
  //  Decks (WS3, p.decks / p.equipped.deck): a deposited deck leaves p.decks and the wizard
  //  re-equips the best remaining deck; a withdrawn deck gets an empty p.decks entry. Every
  //  deposit/withdraw writes the whole account (bank + this wizard) at once; if that write
  //  fails, nothing changes.
  // ------------------------------------------------------------------
  function itemOf(id) { return Object.prototype.hasOwnProperty.call(D().items, id) ? D().items[id] : null; }
  function perPiece(it) { return !!it && (it.type === 'gear' || it.type === 'mount' || it.type === 'deck'); }
  function bankSpaces(items, id, n) { var it = itemOf(id); return it ? (perPiece(it) ? n : (n > 0 ? 1 : 0)) : 0; }
  function bankUsedOf(b) { var u = 0; Object.keys(b.items).forEach(function (id) { u += bankSpaces(b.items, id, b.items[id]); }); return u; }
  function wholeN(n) { n = n == null ? 1 : Math.floor(Number(n)); return isFinite(n) && n >= 1 ? n : 0; }
  function decksOf(p) { return isObj(p.decks) ? p.decks : null; }
  function ownsDeckEntry(p, id) { var d = decksOf(p); return !!(d && Object.prototype.hasOwnProperty.call(d, id)); }
  function deckScore(id) { var it = itemOf(id) || {}, r = (D().rarities || {})[it.rarity || 'common'] || {}; return ((it.deck && it.deck.size) || 0) * 1000 + (it.level || 0) * 10 + (r.order || 0); }
  function deckUsable(p, id) { var it = itemOf(id); return !!it && (it.level || 1) <= (p.level || 1); }
  // The decks p could switch to if `id` left: the usable ones, strongest first
  function otherDecks(p, id) {
    var d = decksOf(p) || {};
    return Object.keys(d).filter(function (k) { return k !== id && itemOf(k) && deckUsable(p, k); })
      .sort(function (a, c) { return deckScore(c) - deckScore(a); });
  }

  // { items: {id: n} (known items only, copy), capacity, used, free }
  api.bank = function () {
    var b = readAccount().bank, items = {};
    Object.keys(b.items).forEach(function (id) { if (itemOf(id)) items[id] = b.items[id]; });
    var used = bankUsedOf(b);
    return { items: items, capacity: b.capacity, used: used, free: Math.max(0, b.capacity - used) };
  };
  api.bankCount = function (id) { var b = readAccount().bank; return itemOf(id) ? (b.items[id] || 0) : 0; };
  api.bankUsed = function () { return bankUsedOf(readAccount().bank); };

  // How many of id the active wizard can hand to the bank right now (unequipped copies)
  function depositable(p, it, id) {
    if (it.type === 'deck') return (p.inventory[id] || 0) + (ownsDeckEntry(p, id) ? 1 : 0);
    return p.inventory[id] || 0;
  }
  api.canDeposit = function (id, n) {
    var p = api.player, it = itemOf(id);
    n = wholeN(n);
    if (!p) return { ok: false, reason: 'No wizard is playing' };
    if (api.locked) return { ok: false, reason: 'Saving is paused' };
    if (!it) return { ok: false, reason: 'Unknown item' };
    if (!n) return { ok: false, reason: 'Nothing to store' };
    var have = depositable(p, it, id);
    if (have < n) {
      var equipped = Object.keys(p.equipped || {}).some(function (s) { return p.equipped[s] === id; });
      if (equipped && it.type !== 'deck') return { ok: false, reason: 'Unequip it first' };
      return { ok: false, reason: have ? 'You only have ' + have : 'You don’t have that' };
    }
    if (it.type === 'deck' && ownsDeckEntry(p, id) && (p.inventory[id] || 0) < n) {
      if (!otherDecks(p, id).length) return { ok: false, reason: 'You can’t store your only usable deck' };
    }
    var b = readAccount().bank, after = bankUsedOf(b) - bankSpaces(b.items, id, b.items[id] || 0) + bankSpaces(b.items, id, (b.items[id] || 0) + n);
    if (after > b.capacity) return { ok: false, reason: 'The bank is full (' + b.capacity + ' spaces)' };
    return { ok: true };
  };
  api.canWithdraw = function (id, n) {
    var p = api.player, it = itemOf(id);
    n = wholeN(n);
    if (!p) return { ok: false, reason: 'No wizard is playing' };
    if (api.locked) return { ok: false, reason: 'Saving is paused' };
    if (!it) return { ok: false, reason: 'Unknown item' };
    if (!n) return { ok: false, reason: 'Nothing to take' };
    var have = readAccount().bank.items[id] || 0;
    if (have < n) return { ok: false, reason: have ? 'The bank only has ' + have : 'Not in the bank' };
    if (it.type === 'mount' && (n > 1 || api.ownsMount(id))) return { ok: false, reason: 'Already in your stable' };
    if (it.type === 'deck' && (n > 1 || ownsDeckEntry(p, id) || (p.inventory[id] || 0) > 0)) return { ok: false, reason: 'You already have this deck' };
    return { ok: true };
  };

  // Change the bank and the active wizard together; one account write. fn(bank) mutates both.
  function bankTxn(fn) {
    var p = api.player, before = JSON.stringify(p), acc = readAccount();
    fn(acc.bank, p);
    acc.bank = migrateBank(acc.bank);
    if (writeAccount(migrateAccount(putActive(acc)))) return true;
    // the write failed: put the wizard back exactly as it was (the bank was never written)
    var old = JSON.parse(before);
    Object.keys(p).forEach(function (k) { delete p[k]; });
    Object.keys(old).forEach(function (k) { p[k] = old[k]; });
    return false;
  }

  api.deposit = function (id, n) {
    n = wholeN(n);
    if (!api.canDeposit(id, n).ok) return false;
    var it = itemOf(id);
    var ok = bankTxn(function (bank, p) {
      var fromInv = Math.min(n, p.inventory[id] || 0);
      if (fromInv) api.removeItem(id, fromInv);
      if (fromInv < n && it.type === 'deck') {                    // the deck the wizard owns (p.decks)
        var d = decksOf(p);
        if (p.equipped && p.equipped.deck === id) {
          // switch to the strongest other deck the wizard can use BEFORE this one leaves, so
          // WS3's equipDeck() can carry the spells over into an empty deck. equipDeck returns
          // { ok } (WS3) or a boolean; it is checked, never assumed.
          var cands = otherDecks(p, id), done = false;
          if (typeof api.equipDeck === 'function') {
            for (var k = 0; k < cands.length && !done; k++) {
              var r;
              try { r = api.equipDeck(cands[k]); } catch (e) { r = false; }
              done = (r === true || !!(r && r.ok)) && p.equipped.deck === cands[k];
            }
          }
          if (!done && cands.length) {        // no deck API (pre-WS3 data): plain switch, p.deck mirrors it
            if (!isObj(d[cands[0]])) d[cands[0]] = { cards: {}, tcs: {} };
            if (!isObj(d[cands[0]].cards)) d[cands[0]].cards = {};
            p.equipped.deck = cands[0]; p.deck = d[cands[0]].cards;
          }
        }
        delete d[id];
      }
      if (api.player.newItems) delete api.player.newItems[id];
      bank.items[id] = (bank.items[id] || 0) + n;
    });
    if (ok) emit('bank', { id: id, n: n });
    return ok;
  };

  api.withdraw = function (id, n) {
    n = wholeN(n);
    if (!api.canWithdraw(id, n).ok) return false;
    var it = itemOf(id);
    var ok = bankTxn(function (bank, p) {
      bank.items[id] -= n;
      if (bank.items[id] <= 0) delete bank.items[id];
      if (it.type === 'deck' && decksOf(p)) p.decks[id] = { cards: {}, tcs: {} };   // an empty deck to fill
      else api.addItem(id, n);                                                    // gear shows as NEW for this wizard
    });
    if (ok) emit('bank', { id: id, n: -n });
    return ok;
  };

  // ---- v2.0 WS-B: pets in the shared Vault (game/js/pets.js owns the rules). bankPets() = a copy;
  //  petBankTxn(fn(list, player)) changes the Vault's pets and the active wizard in ONE account write.
  api.bankPets = function () { return WF.util.deepClone(readAccount().bank.pets || []); };
  api.petBankTxn = function (fn) {
    if (!api.player || api.locked) return false;
    return bankTxn(function (bank, p) { if (!Array.isArray(bank.pets)) bank.pets = []; fn(bank.pets, p); });
  };

  // ------------------------------------------------------------------
  // Owner's sandbox grant (tests/tools "Unlock All Gear.html" writes
  // localStorage['wizziefarm_grant_v1'] = { kind: 'max' }). Applied once on
  // the next load, then removed: every legendary + epic piece your school can
  // wear, every mount, best set equipped, best mount equipped.
  // ------------------------------------------------------------------
  var GRANT_KEY = 'wizziefarm_grant_v1';
  api.applyGrant = function () {
    var g = WF.util.load(GRANT_KEY), p = api.player;
    if (!g || !p) return false;
    var R = D().rarities || {}, items = D().items, ord = function (it) { return (R[it.rarity || 'common'] || {}).order || 0; };
    var score = function (it) { var st = it.stats || {}; return ord(it) * 1e6 + (it.level || 0) * 1e3 + (st.hp || 0) / 10 + (st.dmg || 0) * 3 + (st.resist || 0) * 3 + (st.acc || 0) * 2 + (st.mana || 0); };
    var best = {}, bestMount = null, n = 0;
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (it.type === 'mount') { if (!api.ownsMount(id)) { api.addItem(id, 1); n++; } if (!bestMount || (it.speed || 0) > (items[bestMount].speed || 0)) bestMount = id; return; }
      if (it.type !== 'gear' || it.variants) return;
      if (it.school && it.school !== p.school) return;
      if (ord(it) < 3) return;   // epic + legendary only
      if ((it.level || 1) > p.level) return;
      if (!p.newItems) p.newItems = {};
      api.addItem(id, 1); n++;
      if (!best[it.slot] || score(it) > score(items[best[it.slot]])) best[it.slot] = id;
    });
    Object.keys(best).forEach(function (slot) { api.equip(best[slot]); });
    if (bestMount) { api.equipMount(bestMount); p.mounted = false; }
    var s = api.stats(); p.hp = s.maxHp; p.mana = s.maxMana;
    WF.util.remove(GRANT_KEY);
    api.save();
    api.grantApplied = n;
    return true;
  };

  // ---- v1.2 WS5: export / import
  // One wizard = the same JSON shape as a v1.1 save file (v1.1 can import it, v1.2 imports v1.1 files).
  api.exportSave = function () { return JSON.stringify(api.player); };
  api.exportSlot = function (i) {
    i = slotIdx(i);
    var acc = readAccount({ sync: true });
    if (i < 0 || !acc.slots[i]) return null;
    if (api.player && activeIdx === i) return JSON.stringify(api.player);
    return JSON.stringify(acc.slots[i]);       // as stored (also works for a damaged slot: recovery)
  };
  // Every wizard: the account itself ("Export all wizards")
  api.exportAccount = function () {
    var acc = readAccount({ sync: true });
    if (api.player && activeIdx != null && !api.locked) acc.slots[activeIdx] = api.player;
    // v5: the bank carries its pets (bank.pets) and the account its realm code (realm.lastCode)
    var out = { kind: 'wizziefarm-account', version: acc.version, exported: Date.now(), slots: acc.slots, last: acc.last, settings: acc.settings, bank: acc.bank, realm: acc.realm };
    if (WF.main && WF.main.VERSION) out.gameVersion = WF.main.VERSION;
    return JSON.stringify(out);
  };

  // Read an exported file: a single wizard (v1.0+ save) or an "all wizards" account file.
  // -> { ok, wizards: [player (migrated copy)], skipped: n, account: bool, error }
  api.parseImport = function (text) {
    var data;
    try { data = JSON.parse(String(text == null ? '' : text).replace(/^﻿/, '')); } catch (e) { return { ok: false, wizards: [], error: 'That file is not a Wizzie Farm save (not JSON).' }; }
    if (!isObj(data)) return { ok: false, wizards: [], error: 'That file is not a Wizzie Farm save.' };
    var list = Array.isArray(data.slots) ? data.slots : [data], out = [], skipped = 0;
    list.forEach(function (raw) {
      if (raw == null) return;
      if (!validWizard(raw)) { skipped++; return; }
      try { out.push(migrate(WF.util.deepClone(raw))); } catch (e) { skipped++; }
    });
    if (!out.length) return { ok: false, wizards: [], skipped: skipped, account: Array.isArray(data.slots), error: Array.isArray(data.slots) ? 'That file has no wizards in it.' : 'That file is not a valid Wizzie Farm save.' };
    var res = { ok: true, wizards: out, skipped: skipped, account: Array.isArray(data.slots) };
    if (res.account && isObj(data.bank)) res.bank = migrateBank(data.bank);
    if (res.account && isObj(data.realm)) { var rl = migrateRealm(data.realm); if (rl.lastCode) res.realm = rl; }   // v5
    return res;
  };

  // The shared bank from an "Export all wizards" file (moving from the browser to the desktop
  // app, or restoring a backup). It is only put back into an EMPTY bank (no items and no pets),
  // so importing the same file twice can never double anything.
  // -> { ok, items: n stacks/pieces, pets: n pets in the Vault (v5), reason }
  api.importBank = function (bank) {
    if (!isObj(bank)) return { ok: false, items: 0, pets: 0, reason: 'No bank in that file' };
    var b = migrateBank(bank), n = Object.keys(b.items).length, np = b.pets.length;
    if (!n && !np) return { ok: false, items: 0, pets: 0, reason: 'The bank in that file is empty' };
    var acc = readAccount({ sync: true });
    if (Object.keys(acc.bank.items).length || acc.bank.pets.length) return { ok: false, items: 0, pets: 0, reason: 'Your bank already has items, so the bank in that file was not added' };
    acc.bank = b;
    if (!writeAccount(acc)) return { ok: false, items: 0, pets: 0, reason: 'Could not save (storage blocked?)' };
    emit('bank', { imported: n, pets: np });
    return { ok: true, items: n, pets: np };
  };
  // v5: the realm code from an "Export all wizards" file, kept only when this account has none yet
  api.importRealm = function (realm) {
    var r = migrateRealm(realm), acc = readAccount();
    if (!r.lastCode || acc.realm.lastCode) return false;
    acc.realm.lastCode = r.lastCode;
    return writeAccount(acc);
  };

  // Put an (already parsed) wizard into slot i. Importing over the ACTIVE wizard locks
  // autosave (a reload follows) so the running game can't overwrite the import.
  api.importWizard = function (p, i) {
    i = slotIdx(i);
    if (i < 0 || !validWizard(p)) return false;
    try { p = migrate(WF.util.deepClone(p)); } catch (e) { return false; }
    var acc = readAccount({ sync: true });
    acc.slots[i] = p;
    acc.last = i;
    if (!writeAccount(acc)) return false;
    if (api.player && activeIdx === i) api.locked = true;
    return true;
  };

  // v1.1 API, still used by the in-game menu: validate fully BEFORE overwriting anything.
  // slot: where to put it (default: the active wizard's slot, else the first empty slot).
  api.importSave = function (text, slot) {
    var r = api.parseImport(text);
    if (!r.ok) return false;
    var at = slot != null ? slotIdx(slot) : (api.player && activeIdx != null ? activeIdx : api.firstEmptySlot());
    if (at < 0) return false;
    return api.importWizard(r.wizards[0], at);
  };

  function num(v, def) { v = Number(v); return isFinite(v) ? v : def; }
  function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  var MAX_NUM = 1e9;

  // Upgrade / repair saves (old versions, hand-edited or shared files)
  function migrate(p) {
    var maxL = P().maxLevel;
    if ((D().playableSchools || []).indexOf(p.school) < 0) throw new Error('not a playable school');
    p.name = Array.from(String(p.name || 'Wizard').replace(/[<>&"]/g, '')).slice(0, 18).join('') || 'Wizard';
    p.level = Math.max(1, Math.min(maxL, Math.floor(num(p.level, 1))));
    var hadHp = p.hp != null && isFinite(Number(p.hp));
    ['xp', 'gold', 'hp', 'mana', 'bankedXp', 'trainingPoints'].forEach(function (k) { p[k] = Math.min(MAX_NUM, Math.max(0, num(p[k], 0))); });
    p.known = Array.isArray(p.known) ? p.known.filter(function (id) { return D().cards[id]; }) : [];
    p.deck = (p.deck && typeof p.deck === 'object') ? p.deck : {};
    Object.keys(p.deck).forEach(function (id) {
      if (!D().cards[id] || p.known.indexOf(id) < 0) delete p.deck[id];
      else p.deck[id] = Math.max(0, Math.min(legacyMaxCopies(), Math.floor(num(p.deck[id], 0))));   // v1.2 WS3: deck rules applied in migrateDecks
    });
    p.tcs = obj(p.tcs);
    Object.keys(p.tcs).forEach(function (id) { if (!D().cards[id]) delete p.tcs[id]; else p.tcs[id] = Math.max(0, Math.floor(num(p.tcs[id], 0))); });
    p.pendingSpells = Array.isArray(p.pendingSpells) ? p.pendingSpells.filter(function (id) { return D().cards[id] && p.known.indexOf(id) < 0; }) : [];
    p.inventory = obj(p.inventory);
    Object.keys(p.inventory).forEach(function (id) { if (!D().items[id]) delete p.inventory[id]; else p.inventory[id] = Math.max(0, Math.floor(num(p.inventory[id], 0))); if (!p.inventory[id]) delete p.inventory[id]; });
    p.equipped = obj(p.equipped);
    (D().gearSlots || []).forEach(function (s) { if (!(s in p.equipped)) p.equipped[s] = null; });
    Object.keys(p.equipped).forEach(function (s) {
      if (s === 'deck') return;          // v1.2 WS3: the equipped deck item is checked by migrateDecks
      var it = p.equipped[s] && D().items[p.equipped[s]];
      if (!it) { p.equipped[s] = null; return; }
      // a slot may only hold its own kind of item (repairs hand-edited saves)
      if (s === 'mount' ? it.type !== 'mount' : (it.type !== 'gear' || it.slot !== s)) { p.equipped[s] = null; p.inventory[it.id] = (p.inventory[it.id] || 0) + 1; }
    });
    if (!('mount' in p.equipped)) p.equipped.mount = null;               // v2 -> v3
    p.mounted = !!(p.mounted && p.equipped.mount);
    p.newItems = obj(p.newItems);
    Object.keys(p.newItems).forEach(function (id) { if (!D().items[id]) delete p.newItems[id]; });
    p.quests = obj(p.quests);
    p.quests.active = obj(p.quests.active); p.quests.done = obj(p.quests.done);
    Object.keys(p.quests.active).forEach(function (q) {
      if (!D().quests[q]) { delete p.quests.active[q]; return; }
      var a = obj(p.quests.active[q]);
      a.kills = obj(a.kills); a.talked = obj(a.talked); a.visited = obj(a.visited);
      p.quests.active[q] = a;
    });
    p.visited = obj(p.visited); p.interacted = obj(p.interacted);
    p.seenEnemies = obj(p.seenEnemies); p.seenZones = obj(p.seenZones);
    // v2.0 WS-E: p.storyFlags { id: true } — which story asides / vignettes / triggers this wizard has seen
    p.storyFlags = obj(p.storyFlags);
    Object.keys(p.storyFlags).forEach(function (k) { if (p.storyFlags[k] === true) return; if (p.storyFlags[k]) p.storyFlags[k] = true; else delete p.storyFlags[k]; });
    // v2.1: p.dungeonsCleared { dungeonId: full clears } (the progression gate: requires.dungeon).
    // Old saves get {}; counts are whole numbers >= 1 (anything else is dropped). Ids of dungeons this
    // game does not know are kept (a save from a newer game keeps its clears).
    var dc = obj(p.dungeonsCleared), dOut = {};
    Object.keys(dc).forEach(function (k) { if (badKey(k)) return; var n = Math.floor(num(dc[k], 0)); if (n >= 1) dOut[k] = Math.min(MAX_NUM, n); });
    p.dungeonsCleared = dOut;
    // a wizard who already beat a dungeon's final boss (e.g. in v2.0, before the gate existed) has cleared it
    var kl = isObj(p.stats) && isObj(p.stats.kills) ? p.stats.kills : {};
    Object.keys(D().dungeons || {}).forEach(function (id) {
      var ex = D().dungeons[id] && D().dungeons[id].exit;
      if (ex && Math.floor(num(kl[ex.after], 0)) >= 1 && !dOut[id]) dOut[id] = 1;
    });
    p.stats = obj(p.stats);
    p.stats.kills = obj(p.stats.kills);
    ['fights', 'deaths', 'playTime'].forEach(function (k) { p.stats[k] = num(p.stats[k], 0); });
    p.stats.levelAt = obj(p.stats.levelAt);
    p.settings = obj(p.settings);
    p.settings.master = Math.min(1, Math.max(0, num(p.settings.master, 0.7)));
    p.settings.music = Math.min(1, Math.max(0, num(p.settings.music, 0.45)));
    var ts = num(p.settings.textScale, 1);
    p.settings.textScale = [1, 1.15, 1.3].reduce(function (a, b) { return Math.abs(b - ts) < Math.abs(a - ts) ? b : a; }, 1);
    var gq = ['auto', 'ultra', 'high', 'medium', 'low'].concat((WF.gfx && WF.gfx.qualities) || []);
    if (gq.indexOf(p.settings.graphics) < 0) p.settings.graphics = p.settings.lowGraphics ? 'low' : 'auto';
    p.settings.cinematics = 'full'; delete p.settings.fastCombat;   // v2.0: battle speed settings removed (fixed timing)
    if (!Array.isArray(p.pos) || p.pos.length !== 2 || !isFinite(p.pos[0]) || !isFinite(p.pos[1])) p.pos = null;
    if (!(p.version >= 2)) {
      // v1 saves learned spells automatically; keep that and grant earned training points
      var tp = P().trainingPoints || {};
      Object.keys(tp).forEach(function (l) { if (p.level >= +l) p.trainingPoints += tp[l]; });
    }
    // A save with no spells at all (hand-made / damaged): give the school's starting spells back
    if (!p.known.length) {
      var prev = api.player; api.player = p;
      schoolCardsUpTo(1).forEach(function (id) { api.learnCard(id, true); });
      api.player = prev;
    }
    if (!hadHp) p.hp = 1e9;      // clamped to max health after load
    if (!(p.mana > 0) && !hadHp) p.mana = 1e9;
    // ---- save v5 (v2.0, V2.0-CONTRACT §9): every step below is idempotent and runs on every load
    api.migrateDeckDepth(p);     // v2.1 A5: finite decks -> existing decks x3 once (before the rule checks)
    api.migrateDecks(p);         // v1.2 WS3: deck items (p.decks, p.equipped.deck, p.deck mirror); v5: never trims (F-1)
    api.migrateSchools(p);       // v2.0 M1 (WS-A): p.runeglass 0, p.spellRanks {}
    api.migrateLook(p);          // v2.0 WS-D: p.look, derived from the look every v1.x wizard has
    // v2.0 WS-B: p.pets [], p.activePet null, p.hatchery {slots, cooldowns}. pets.js owns the repair;
    // without it (Node tests that load a subset) only missing fields get their defaults, nothing is dropped.
    if (WF.pets && WF.pets.migrate) WF.pets.migrate(p);
    else {
      if (!Array.isArray(p.pets)) p.pets = [];
      if (p.activePet === undefined) p.activePet = null;
      if (!isObj(p.hatchery)) p.hatchery = { slots: [], cooldowns: {} };
    }
    p.version = Math.max(SAVE_VERSION, verOf(p));   // a wizard from a newer game keeps its number
    return p;
  }

  // ---- v2.0 (save v5, WS-D): p.look = { body, face, eyes, nose, mouth, hair, hairColor, skin }.
  //  Stored for the v2.1 character creator; the current (procedural) wizard does NOT read it, so a
  //  migrated wizard renders exactly as before. Every v1.x wizard had the same body and face, and the
  //  skin / hair colours appearance() gives everyone (BASE_SKIN / BASE_HAIR), so that is the old look:
  //  body 'a' (the prototype build), preset 0 for face/eyes/nose/mouth/hair. Valid fields a save already
  //  has are kept (a later creator wrote them); anything else gets the default.
  var BASE_SKIN = '#f2c9a0', BASE_HAIR = '#4a2f1c';
  var LOOK_PRESETS = ['face', 'eyes', 'nose', 'mouth', 'hair'];
  function defaultLook() { return { body: 'a', face: 0, eyes: 0, nose: 0, mouth: 0, hair: 0, hairColor: BASE_HAIR, skin: BASE_SKIN }; }
  function hexColor(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null; }
  api.defaultLook = defaultLook;
  api.migrateLook = function (p) {
    if (!isObj(p)) return p;
    var src = isObj(p.look) ? p.look : {}, out = defaultLook();
    if (src.body === 'a' || src.body === 'b') out.body = src.body;
    LOOK_PRESETS.forEach(function (k) { var n = Number(src[k]); if (isFinite(n) && n >= 0 && n <= 99 && Math.floor(n) === n) out[k] = n; });
    out.hairColor = hexColor(src.hairColor) || out.hairColor;
    out.skin = hexColor(src.skin) || out.skin;
    if (hexColor(src.eyeColor)) out.eyeColor = hexColor(src.eyeColor);   // v2.1 WS-D: creator eye colour (optional)
    if (verOf(p) > SAVE_VERSION) keepUnknown(src, out);   // fields a newer creator added
    p.look = out;
    return p;
  };

  // ------------------------------------------------------------------
  // Stats (school base + level + gear)
  // ------------------------------------------------------------------
  // v1.2 WS2: every gear stat key, in display order. brightPip ("Bright Pip")
  // and pipSurge ("Pip Surge") are percents like dmg (docs/V1.2-CONTRACT.md §2.1).
  // v2.0 M1 (WS-A): + per-school dmg_<school> / resist_<school> / acc_<school> (schools.js)
  api.GEAR_STATS = ['hp', 'mana', 'dmg', 'resist', 'acc', 'brightPip', 'pipSurge'].concat(WF.data.schoolStatKeys || []);

  // ---- v1.2 WS2: set bonuses (items_endgame.js WF.data.gearSets, contract §6.3)
  // Pure: itemIds = the equipped gear ids, school = the wearer's school.
  // Returns { stats: {bonus stats}, sets: { setId: { name, count, max, active: [bonus], next: bonus|null } } }.
  // A piece counts when it belongs to the set and the wearer can wear it
  // (its school is the wearer's, or it has none). Count is capped at the
  // set's maxCount (Starbound 4: Starwalker counts only with <= 3 others).
  api.setBonusFor = function (itemIds, school) {
    var SETS = D().gearSets || {}, out = { stats: {}, sets: {} };
    (itemIds || []).forEach(function (id) {
      var it = id && D().items[id];
      if (!it || it.type !== 'gear' || !it.set || !SETS[it.set]) return;
      if (it.school && school && it.school !== school) return;
      var s = out.sets[it.set] = out.sets[it.set] || { id: it.set, name: SETS[it.set].name, count: 0, max: SETS[it.set].maxCount || 5, active: [], next: null };
      s.count++;
    });
    Object.keys(out.sets).forEach(function (sid) {
      var s = out.sets[sid], def = SETS[sid];
      s.count = Math.min(s.count, s.max);
      (def.bonuses || []).forEach(function (b) {
        if (s.count >= b.count) {
          s.active.push(b);
          var add = function (st) { Object.keys(st || {}).forEach(function (k) { out.stats[k] = (out.stats[k] || 0) + st[k]; }); };
          add(b.stats); add(b.school && b.school[school]);
        } else if (!s.next) s.next = b;
      });
    });
    return out;
  };
  // Raw gear stats only (no set bonuses)
  api.gearStatsRaw = function (equippedOverride) {
    var p = api.player, out = {};
    api.GEAR_STATS.forEach(function (k) { out[k] = 0; });
    if (!p) return out;
    var eq = equippedOverride || p.equipped;
    (D().gearSlots || []).forEach(function (slot) {
      var it = eq[slot] && D().items[eq[slot]];
      if (!it || !it.stats) return;
      Object.keys(it.stats).forEach(function (k) { out[k] = (out[k] || 0) + it.stats[k]; });
    });
    return out;
  };
  api.equippedIds = function (equippedOverride) {
    var p = api.player, eq = equippedOverride || (p && p.equipped) || {};
    return (D().gearSlots || []).map(function (s) { return eq[s]; }).filter(Boolean);
  };
  api.setBonuses = function (equippedOverride) {
    return api.setBonusFor(api.equippedIds(equippedOverride), api.player && api.player.school);
  };
  // Gear stats INCLUDING set bonuses (what the battle uses)
  api.gearStats = function (equippedOverride) {
    var out = api.gearStatsRaw(equippedOverride);
    if (!api.player) return out;
    var b = api.setBonuses(equippedOverride).stats;
    Object.keys(b).forEach(function (k) { out[k] = (out[k] || 0) + b[k]; });
    return out;
  };

  // ---- v1.2 WS2: natural (no-gear) health and mana by level.
  // Levels <= progression.levelScaling.from use schools.js (baseHP +
  // hpPerLevel x (L-1)); above it the PROJECTED gentle growth of
  // progression.levelScaling (x1.03 per level, Stoneward x1.034; contract §6.4, Jorge's "gear stays the main
  // way to get stronger"). Pure: also used by tests/balance-sim.js.
  api.baseVitals = function (school, level) {
    var sc = D().schools[school] || {}, ls = P().levelScaling || {}, from = ls.from || Infinity;
    var L1 = Math.min(level, from), hp = sc.baseHP + sc.hpPerLevel * (L1 - 1), mana = sc.baseMana + sc.manaPerLevel * (L1 - 1);
    if (level > from) {
      hp = typeof ls.naturalHP === 'function' ? ls.naturalHP(hp, level, school) : hp;
      mana = typeof ls.naturalMana === 'function' ? ls.naturalMana(mana, level) : mana;
    }
    return { hp: hp, mana: mana };
  };
  // Health / mana a level-up to `level` adds (level-up screen)
  api.levelGain = function (level, school) {
    school = school || (api.player && api.player.school);
    var a = api.baseVitals(school, level), b = api.baseVitals(school, Math.max(1, level - 1));
    return { hp: Math.round(a.hp - b.hp), mana: Math.round(a.mana - b.mana) };
  };

  // v1.2 WS2: Bright Pip / Pip Surge as battle fractions (0..1), caps applied.
  //   brightPip = the GEAR share of the bright-pip chance, cut so that
  //               progression.brightPipChance(level) + brightPip <= brightPipCap
  //   pipSurge  = min(gear pipSurge / 100, pipSurgeCap)
  api.pipStats = function (level, g) {
    var prog = P(), base = typeof prog.brightPipChance === 'function' ? Math.max(0, +prog.brightPipChance(level) || 0) : 0;
    var bCap = prog.brightPipCap != null ? prog.brightPipCap : 0.60, sCap = prog.pipSurgeCap != null ? prog.pipSurgeCap : 0.35;
    var bright = Math.max(0, Math.min((g.brightPip || 0) / 100, bCap - base));
    var surge = Math.max(0, Math.min((g.pipSurge || 0) / 100, sCap));
    return { base: base, brightPip: bright, pipSurge: surge, brightTotal: Math.max(base, Math.min(bCap, base + bright)) };
  };

  // v2.0 M1 (WS-A): per-school gear stats as battle fractions:
  //   { dmg: { emberstrike: 0.12 }, resist: { tidecaller: 0.05 }, acc: {} }
  // Pure: g = summed gear stats (percent). Battle input player.schoolStats.
  // school (optional) adds that school's natural resists / weaknesses (schools.js schoolResist)
  api.schoolStatsOf = function (g, school) {
    return D().schoolStatsFromGear ? D().schoolStatsFromGear(g, school) : { dmg: {}, resist: {}, acc: {} };
  };
  api.stats = function (equippedOverride) {
    var p = api.player, sc = D().schools[p.school], g = api.gearStats(equippedOverride), pip = api.pipStats(p.level, g), bv = api.baseVitals(p.school, p.level);
    var ss = api.schoolStatsOf(g, p.school), own = p.school;
    return {
      maxHp: Math.round(bv.hp + g.hp),
      maxMana: Math.round(bv.mana + g.mana),
      dmg: sc.dmg + g.dmg / 100,
      resist: sc.resist + g.resist / 100,
      acc: sc.acc + g.acc / 100,
      brightPip: pip.brightPip,      // battle input player.brightPip (gear share, capped)
      pipSurge: pip.pipSurge,        // battle input player.pipSurge (capped)
      schoolStats: ss,               // v2.0 M1: battle input player.schoolStats
      // own-school totals for the character sheet (universal + own school)
      ownDmg: sc.dmg + g.dmg / 100 + (ss.dmg[own] || 0),
      ownAcc: sc.acc + g.acc / 100 + (ss.acc[own] || 0)
    };
  };

  api.clampVitals = function () {
    var s = api.stats(), p = api.player;
    p.hp = WF.util.clamp(p.hp, 0, s.maxHp);
    p.mana = WF.util.clamp(p.mana, 0, s.maxMana);
  };

  // ------------------------------------------------------------------
  // XP and leveling
  // ------------------------------------------------------------------
  api.xpNeeded = function () {
    var p = api.player, prog = P();
    if (p.level >= prog.maxLevel) return 0;
    return prog.xpToNext[p.level] || 999999;
  };

  // Returns an array of level-up results: [{ level, cards: [ids], points }]
  api.addXP = function (amount) {
    var p = api.player, prog = P(), ups = [];
    amount = Math.round(amount);
    if (p.level >= prog.maxLevel) { p.bankedXp = (p.bankedXp || 0) + amount; p.xp = 0; return ups; }
    p.xp += amount;
    while (p.level < prog.maxLevel && p.xp >= api.xpNeeded()) {
      p.xp -= api.xpNeeded();
      p.level += 1;
      p.stats.levelAt = p.stats.levelAt || {};
      p.stats.levelAt[p.level] = Math.round(p.stats.playTime || 0);
      // New school spells must be learned from your trainer (W101 style)
      var fresh = schoolCardsUpTo(p.level).filter(function (id) { return p.known.indexOf(id) < 0 && p.pendingSpells.indexOf(id) < 0; });
      fresh.forEach(function (id) { p.pendingSpells.push(id); });
      var pts = (prog.trainingPoints && prog.trainingPoints[p.level]) || 0;
      p.trainingPoints += pts;
      var s = api.stats();
      p.hp = s.maxHp; p.mana = s.maxMana;   // full restore on level up
      ups.push({ level: p.level, cards: fresh, points: pts, maxHp: s.maxHp, maxMana: s.maxMana });
      emit('levelup', { level: p.level, cards: fresh });
    }
    if (p.level >= prog.maxLevel) { p.bankedXp = (p.bankedXp || 0) + p.xp; p.xp = 0; }
    return ups;
  };

  function schoolCardsUpTo(lvl) {
    var p = api.player;
    return Object.keys(D().cards).filter(function (id) {
      var c = D().cards[id];
      return c.school === p.school && c.level <= lvl && !c.source;
    }).sort(function (a, b) { return D().cards[a].level - D().cards[b].level; });
  }

  // v2.1 A5: decks became finite (no reshuffle) and every deck number tripled (decks.js, cards.js
  // copies, progression deckMax). A wizard saved before that gets each deck's copies x3 ONCE, so
  // the hand odds stay the same and the deck lasts three times as long. p.deckDepth = 3 marks it
  // done (idempotent; a wizard made in v2.1 starts at 3; a missing deckDepth means 1). Spell
  // Scrolls are not multiplied.
  var DECK_DEPTH = 3;
  api.migrateDeckDepth = function (p) {
    if (!p || typeof p !== 'object') return false;
    if (p.deckDepth >= DECK_DEPTH) return false;
    var from = p.deckDepth >= 1 && p.deckDepth < DECK_DEPTH ? Math.floor(p.deckDepth) : 1;
    var dbl = function (cards) {
      if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return;
      Object.keys(cards).forEach(function (id) { var n = Math.floor(+cards[id]); if (n > 0 && isFinite(n)) cards[id] = Math.min(MAX_NUM, Math.round(n * DECK_DEPTH / from)); });
    };
    if (p.decks && typeof p.decks === 'object' && !Array.isArray(p.decks)) {
      Object.keys(p.decks).forEach(function (k) { var d = p.decks[k]; if (d && typeof d === 'object') dbl(d.cards); });
      // the v1.2 p.deck mirror is rebuilt by migrateDecks from the equipped deck; keep it in step
      if (p.deck && p.equipped && p.equipped.deck && p.decks[p.equipped.deck] && p.deck !== p.decks[p.equipped.deck].cards) dbl(p.deck);
    } else dbl(p.deck);                   // a v1.1 save: p.deck only (migrateDecks moves it into a deck item)
    p.deckDepth = DECK_DEPTH;
    p.deckDepthNews = true;              // main.js tells the player once (decks no longer reshuffle)
    return true;
  };

  // Learn a spell; optionally auto-add copies to the deck (space permitting).
  api.learnCard = function (id, addToDeck) {
    var p = api.player, c = D().cards[id];
    if (!c) return false;
    var isNew = p.known.indexOf(id) < 0;
    if (isNew) p.known.push(id);
    var pi = p.pendingSpells.indexOf(id);
    if (pi >= 0) p.pendingSpells.splice(pi, 1);
    if (addToDeck !== false) {
      // v1.2 WS3: copies go into the EQUIPPED deck, within its rules (size, copies, other schools)
      ensureDecks(p);
      var want = c.copies || 2;
      var have = p.deck[id] || 0;
      var room = api.deckRoom(id);
      var add = Math.max(0, Math.min(want - have, room.n));
      if (add > 0) p.deck[id] = have + add;
      if (isNew && add < want - have) emit('deck', { kind: 'nofit', card: id, added: add, wanted: want - have, deck: p.equipped && p.equipped.deck, reason: room.reason, rule: room.rule });
    }
    return isNew;
  };

  // Trainer: learn every pending spell. Returns the ids learned.
  api.learnPending = function () {
    var ids = api.player.pendingSpells.slice();
    ids.forEach(function (id) { api.learnCard(id, true); });
    api.save();
    return ids;
  };

  // Training points: buy another school's "trainable" spell from its trainer
  api.trainableAt = function (npcId) {
    var npc = D().npcs[npcId], p = api.player;
    if (!npc || npc.role !== 'trainer') return [];
    return Object.keys(D().cards).filter(function (id) {
      var c = D().cards[id];
      return c.trainable && c.school === npc.school && c.school !== p.school;
    }).sort(function (a, b) { return D().cards[a].level - D().cards[b].level; });
  };
  api.canTrain = function (cardId) {
    var c = D().cards[cardId], p = api.player;
    if (!c || !c.trainable || c.school === p.school) return { ok: false, reason: 'Not trainable' };
    if (p.known.indexOf(cardId) >= 0) return { ok: false, reason: 'Already known' };
    if (p.level < c.level) return { ok: false, reason: 'Requires level ' + c.level };
    if (p.trainingPoints < (c.trainCost || 1)) return { ok: false, reason: 'Not enough training points' };
    return { ok: true };
  };
  api.train = function (cardId) {
    if (!api.canTrain(cardId).ok) return false;
    var c = D().cards[cardId];
    api.player.trainingPoints -= (c.trainCost || 1);
    api.learnCard(cardId, true);
    api.save();
    return true;
  };

  // ---- v1.2 WS3: DECKS — deck items, rules, sideboard, battle loadout, migration ----
  // Save (per wizard):  p.decks = { deckItemId: { cards: {cardId: n}, tcs: {cardId: n} } }  (every owned deck)
  //                     p.equipped.deck = deckItemId
  //                     p.deck  = the equipped deck's `cards` (the SAME object, so v1.1 code keeps working)
  //                     p.tcs   = the whole Spell Scroll inventory; a deck's `tcs` is its sideboard
  //                           (each count <= p.tcs, total <= tcSlots).
  // With no deck items in the game data every call falls back to the v1.1 rules
  // (progression.deckMax / maxCopies, all scrolls carried).
  function deckItem(id) { var it = id && D().items[id]; return (it && it.type === 'deck' && it.deck) ? it : null; }
  function countSum(o) { var n = 0; for (var k in o) n += o[k] || 0; return n; }
  function cleanCounts(o) {
    var out = {};
    o = obj(o);
    Object.keys(o).forEach(function (k) { var n = Math.floor(num(o[k], 0)); if (n > 0) out[k] = Math.min(n, MAX_NUM); });
    return out;
  }
  function sameCounts(a, b) {
    var ka = Object.keys(a).filter(function (k) { return a[k] > 0; }), kb = Object.keys(b).filter(function (k) { return b[k] > 0; });
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }
  // Highest copy limit any rule set allows (repairs saves without trimming legal decks)
  function legacyMaxCopies() {
    var m = P().maxCopies || 6;
    api.deckItemIds().forEach(function (id) { m = Math.max(m, deckItem(id).deck.maxCopies || 0); });
    return m;
  }
  // A known spell from another playable school (trained). Lumen counts as your own school.
  function isOther(cardId, p) { var c = D().cards[cardId]; return !!c && c.school !== p.school && c.school !== 'lumen'; }
  function otherIn(cards, p) { var n = 0; for (var k in cards) if (isOther(k, p)) n += cards[k]; return n; }
  function cardName(id) { var c = D().cards[id]; return c ? c.name : id; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Every deck item in the data, weakest first (level, then size). Cached per item count.
  var deckIdCache = null, deckIdKey = -1;
  api.deckItemIds = function () {
    var keys = Object.keys(D().items || {});
    if (deckIdCache && deckIdKey === keys.length) return deckIdCache.slice();
    deckIdCache = keys.filter(deckItem).sort(function (a, b) {
      var A = deckItem(a), B = deckItem(b);
      return (A.level || 1) - (B.level || 1) || A.deck.size - B.deck.size || a.localeCompare(b);
    });
    deckIdKey = keys.length;
    return deckIdCache.slice();
  };
  // The deck everyone starts with: the lowest-level free deck (never the Legacy Deck)
  function starterDeckId() {
    var ids = api.deckItemIds();
    for (var i = 0; i < ids.length; i++) if (!deckItem(ids[i]).price && !deckItem(ids[i]).legacy) return ids[i];
    return ids[0] || null;
  }
  // v5 (F-1): the deck item that keeps an old deck which fits nothing else (decks.js deck_legacy)
  function legacyDeckId() {
    var ids = api.deckItemIds();
    for (var i = 0; i < ids.length; i++) if (deckItem(ids[i]).legacy) return ids[i];
    return null;
  }
  // v5 (F-1): copies `over` that fit no deck's rules are moved into `cards` while r allows
  // (copy limit, size, other-school room). Changes both; returns how many moved.
  function placeCopies(cards, over, r, p) {
    var moved = 0;
    Object.keys(over).sort().forEach(function (k) {
      var room = Math.min(over[k], r.maxCopies - (cards[k] || 0), r.size - countSum(cards));
      if (isOther(k, p)) room = Math.min(room, r.maxOther - otherIn(cards, p));
      if (room <= 0) return;
      cards[k] = (cards[k] || 0) + room; moved += room;
      if (!(over[k] -= room)) delete over[k];
    });
    return moved;
  }
  function fallbackRules(p) {
    var f = P().deckMax, lvl = p ? p.level : 1;
    return { id: null, name: null, size: typeof f === 'function' ? f(lvl) : (f || 30), maxCopies: P().maxCopies || 6,
      maxOther: Infinity, tcSlots: Infinity, min: P().deckMin || 6 };
  }
  // Rules of one deck item: { id, name, size, maxCopies, maxOther, tcSlots, min }
  api.rulesOf = function (deckId) {
    var it = deckItem(deckId), fb = fallbackRules(api.player);
    if (!it) return fb;
    var r = it.deck;
    return { id: deckId, name: it.name, size: r.size || fb.size, maxCopies: r.maxCopies || fb.maxCopies,
      maxOther: r.maxOther != null ? r.maxOther : r.size, tcSlots: r.tcSlots || 0, min: fb.min, level: it.level || 1 };
  };
  function emptyDeck() { return { cards: {}, tcs: {} }; }

  // Fit a card list into a rule set. Removes the fewest copies possible and
  // keeps at least one copy of every spell while it can. -> { cards, removed }
  function fitCards(cards, r, p) {
    var out = {}, removed = 0;
    Object.keys(cards).forEach(function (k) { if (cards[k] > 0) out[k] = cards[k]; });
    Object.keys(out).forEach(function (k) { if (out[k] > r.maxCopies) { removed += out[k] - r.maxCopies; out[k] = r.maxCopies; } });
    function dropOne(filter) {
      var ids = Object.keys(out).filter(filter);
      if (!ids.length) return false;
      ids.sort(function (a, b) {      // most copies first; then the lowest-level spell goes first
        var A = D().cards[a] || {}, B = D().cards[b] || {};
        return out[b] - out[a] || (A.source ? 99 : A.level || 0) - (B.source ? 99 : B.level || 0) || (A.pips || 0) - (B.pips || 0);
      });
      var k = ids[0];
      if (--out[k] <= 0) delete out[k];
      removed++;
      return true;
    }
    while (otherIn(out, p) > r.maxOther && dropOne(function (k) { return isOther(k, p); })) { /* trim trained spells */ }
    while (countSum(out) > r.size && dropOne(function () { return true; })) { /* trim to size */ }
    return { cards: out, removed: removed };
  }
  // Known, real spells only
  function cleanDeckCards(o, p) {
    var c = cleanCounts(o), out = {};
    Object.keys(c).forEach(function (k) { if (D().cards[k] && p.known.indexOf(k) >= 0) out[k] = c[k]; });
    return out;
  }
  // Sideboard: real scrolls you own, <= owned, total <= tcSlots
  function fitScrolls(tcs, r, p) {
    var c = cleanCounts(tcs), out = {}, room = r.tcSlots;
    Object.keys(c).forEach(function (k) {
      if (!D().cards[k] || room <= 0) return;
      var n = Math.min(c[k], Math.floor(num(p.tcs[k], 0)), room);
      if (n > 0) { out[k] = n; room -= n; }
    });
    return out;
  }
  // Scroll priority for auto-fill: attacks first, then by pip cost
  function scrollOrder(ids) {
    var ATT = { damage: 1, aoe: 1, dot: 1 };
    return ids.slice().sort(function (a, b) {
      var A = D().cards[a], B = D().cards[b];
      return (ATT[B.type] ? 1 : 0) - (ATT[A.type] ? 1 : 0) || B.pips - A.pips || A.name.localeCompare(B.name);
    });
  }
  // Add scrolls one of each per pass (variety first) until the slots are full
  function fillScrolls(tcs, r, p) {
    var ids = scrollOrder(Object.keys(p.tcs).filter(function (k) { return D().cards[k] && p.tcs[k] > 0; }));
    var added = 0, more = true;
    while (more && countSum(tcs) < r.tcSlots) {
      more = false;
      for (var i = 0; i < ids.length && countSum(tcs) < r.tcSlots; i++) {
        if ((tcs[ids[i]] || 0) < p.tcs[ids[i]]) { tcs[ids[i]] = (tcs[ids[i]] || 0) + 1; added++; more = true; }
      }
    }
    return added;
  }

  // v1.1 -> v1.2 (and repair of any save). Safe to run any number of times.
  // No spell or scroll is ever lost: spells stay in p.known, scrolls in p.tcs;
  // the old deck goes into the smallest deck that holds it.
  // v2.0 save v5 (F-1): no card COPY is lost either: an old deck no usable deck holds unchanged goes
  // whole into the Legacy Deck, and copies that break a deck's rules move to another deck.
  api.migrateDecks = function (p) {
    var ids = api.deckItemIds();
    if (!p || !ids.length) return p;                 // no deck items in this build: v1.1 rules
    p.equipped = obj(p.equipped);
    p.tcs = obj(p.tcs);
    p.inventory = obj(p.inventory);
    if (!Array.isArray(p.known)) p.known = [];
    var had = !!(p.decks && typeof p.decks === 'object' && !Array.isArray(p.decks));
    var legacyObj = (p.deck && typeof p.deck === 'object') ? p.deck : null;
    var legacy = cleanDeckCards(legacyObj, p);
    var decks = {}, notice = null;
    if (had) {
      Object.keys(p.decks).forEach(function (id) {
        if (!deckItem(id)) return;                    // a deck removed from the data (its spells stay known)
        var e = obj(p.decks[id]);
        decks[id] = { cards: cleanDeckCards(e.cards, p), tcs: cleanCounts(e.tcs) };
      });
    }
    // deck items sitting in the backpack become owned decks; spares turn into gold
    Object.keys(p.inventory).forEach(function (id) {
      if (!deckItem(id)) return;
      var n = Math.max(0, Math.floor(num(p.inventory[id], 0)));
      delete p.inventory[id];
      if (p.newItems) delete p.newItems[id];
      if (n > 0 && !decks[id]) { decks[id] = emptyDeck(); n--; }
      if (n > 0) p.gold = Math.min(MAX_NUM, num(p.gold, 0) + n * (deckItem(id).sell || 0));
    });
    var starter = starterDeckId();
    if (starter && !decks[starter]) decks[starter] = emptyDeck();
    var eq = deckItem(p.equipped.deck) && decks[p.equipped.deck] ? p.equipped.deck : null;
    if (!had) {
      // v1.1 save: everyone gets the starter deck + every shop deck their level allows that can hold the old deck
      var size = countSum(legacy), granted = [];
      ids.forEach(function (id) {
        var it = deckItem(id);
        if (it.price > 0 && (it.level || 1) <= p.level && it.deck.size >= size && !decks[id]) { decks[id] = emptyDeck(); granted.push(id); }
      });
      // the smallest owned deck that holds the old deck unchanged; otherwise the one that keeps the most
      var cands = Object.keys(decks).filter(function (id) { return (deckItem(id).level || 1) <= p.level; });
      if (!cands.length) cands = Object.keys(decks);
      cands.sort(function (a, b) { return deckItem(a).deck.size - deckItem(b).deck.size || (deckItem(a).level || 1) - (deckItem(b).level || 1); });
      var best = null, bestFit = null;
      cands.forEach(function (id) {
        var f = fitCards(legacy, api.rulesOf(id), p);
        if (!bestFit || f.removed < bestFit.removed) { best = id; bestFit = f; }
      });
      eq = best;
      // v5 (F-1): no deck you can use holds it unchanged -> the Legacy Deck (v1.1 rules) keeps it card for card
      var leg = legacyDeckId();
      if (bestFit.removed && leg) { if (!decks[leg]) decks[leg] = emptyDeck(); eq = leg; }
      decks[eq].cards = legacy;       // as it was: the rules pass below MOVES any copy that breaks a rule, never deletes it
      decks[eq].tcs = {};
      fillScrolls(decks[eq].tcs, api.rulesOf(eq), p);
      // a v1.1 wizard (not a brand-new one) is told once where the old deck went
      if (size > 0) notice = { kind: 'migrated', deck: eq, granted: granted, removed: 0, at: Date.now() };
    } else {
      if (!eq) {
        // equipped deck missing/unknown: the strongest owned deck you can use
        var usable = Object.keys(decks).filter(function (id) { return (deckItem(id).level || 1) <= p.level; });
        usable.sort(function (a, b) { return api.deckItemIds().indexOf(b) - api.deckItemIds().indexOf(a); });
        eq = usable[0] || starter || Object.keys(decks)[0];
      }
      // v1.1 code (or an older game build) edited p.deck after this save was made: that edit wins
      if (legacyObj && !sameCounts(legacy, decks[eq].cards)) decks[eq].cards = legacy;
    }
    // every deck obeys its rules; sideboards never hold more scrolls than you own
    var removed = 0, over = {}, movedTo = [];
    Object.keys(decks).forEach(function (id) {
      var r = api.rulesOf(id), before = decks[id].cards, f = fitCards(before, r, p);
      if (f.removed) {
        Object.keys(before).forEach(function (k) { var d = before[k] - (f.cards[k] || 0); if (d > 0) over[k] = (over[k] || 0) + d; });
        decks[id].cards = f.cards;
      }
      decks[id].tcs = fitScrolls(decks[id].tcs, r, p);
    });
    // v5 (V1.2 review F-1): copies that break a deck's rules are MOVED, never deleted: into the Legacy
    // Deck first (given now if needed), then into any other deck with room, smallest first. Only copies
    // no deck can hold (more than all your decks together allow: hand-edited saves) are left out; the
    // spell itself always stays in your spellbook.
    var total = countSum(over);
    if (total) {
      var LEG = legacyDeckId();
      if (LEG && !decks[LEG]) decks[LEG] = emptyDeck();
      Object.keys(decks).sort(function (a, b) {
        return (b === LEG) - (a === LEG) || deckItem(a).deck.size - deckItem(b).deck.size || a.localeCompare(b);
      }).forEach(function (id) {
        if (countSum(over) && placeCopies(decks[id].cards, over, api.rulesOf(id), p)) movedTo.push(id);
      });
      removed = countSum(over);
    }
    var moved = total - removed;
    if (notice && (moved || removed)) { notice.removed = removed; notice.moved = moved; notice.movedTo = movedTo; }
    else if (total && !notice) notice = { kind: 'trimmed', deck: eq, removed: removed, moved: moved, movedTo: movedTo, at: Date.now() };
    p.decks = decks;
    p.equipped.deck = eq;
    p.deck = decks[eq].cards;                         // the legacy mirror IS the equipped deck's card list
    if (notice) p.deckNotice = notice;
    else if (p.deckNotice && (typeof p.deckNotice !== 'object' || !deckItem(p.deckNotice.deck))) delete p.deckNotice;
    return p;
  };

  // The current wizard's equipped deck entry (creates/repairs it), or null without deck data
  function ensureDecks(p) {
    p = p || api.player;
    if (!p || !api.deckItemIds().length) return null;
    if (!p.decks || !p.equipped || !p.equipped.deck || !deckItem(p.equipped.deck) || !p.decks[p.equipped.deck]) api.migrateDecks(p);
    var d = p.decks[p.equipped.deck];
    if (p.deck !== d.cards) {
      // something replaced p.deck (v1.1-style code or a cloned player): the newest edit wins, within the rules
      if (p.deck && typeof p.deck === 'object' && !sameCounts(cleanCounts(p.deck), d.cards)) {
        d.cards = fitCards(cleanDeckCards(p.deck, p), api.rulesOf(p.equipped.deck), p).cards;
      }
      p.deck = d.cards;
    }
    return d;
  }
  function curDeck() { reconcileScrolls(); return ensureDecks(api.player); }

  api.ownedDecks = function () {
    var p = api.player; ensureDecks(p);
    if (!p || !p.decks) return [];
    var order = api.deckItemIds();
    return Object.keys(p.decks).filter(deckItem).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  };
  api.ownsDeck = function (id) { var p = api.player; ensureDecks(p); return !!(p && p.decks && p.decks[id] && deckItem(id)); };
  api.equippedDeck = function () { var p = api.player, d = ensureDecks(p); return d ? deckItem(p.equipped.deck) : null; };
  api.deckRules = function () {
    var p = api.player, d = ensureDecks(p);
    return d ? api.rulesOf(p.equipped.deck) : fallbackRules(p);
  };
  api.deckCards = function () { var p = api.player, d = curDeck(); return Object.assign({}, d ? d.cards : (p && p.deck) || {}); };
  api.deckSideboard = function () { var d = curDeck(); return Object.assign({}, d ? d.tcs : {}); };
  api.deckSize = function () {
    var p = api.player, d = ensureDecks(p);
    return countSum(d ? d.cards : p.deck);
  };
  api.deckCount = function (cardId) { var p = api.player, d = ensureDecks(p); return ((d ? d.cards : p.deck)[cardId]) || 0; };
  api.otherSchoolCount = function () { var p = api.player, d = ensureDecks(p); return otherIn(d ? d.cards : p.deck, p); };
  api.isOtherSchool = function (cardId) { return isOther(cardId, api.player); };
  api.sideboardSize = function () { var d = curDeck(); return d ? countSum(d.tcs) : countSum(api.player.tcs); };
  api.sideboardCount = function (cardId) { var d = curDeck(); return d ? (d.tcs[cardId] || 0) : (api.player.tcs[cardId] || 0); };
  // Summary of any owned deck (deck switcher): { id, item, rules, cards, scrolls, other, equipped }
  api.deckInfo = function (id) {
    var p = api.player; ensureDecks(p);
    var e = p && p.decks && p.decks[id];
    if (!e || !deckItem(id)) return null;
    return { id: id, item: deckItem(id), rules: api.rulesOf(id), cards: countSum(e.cards), scrolls: countSum(e.tcs), other: otherIn(e.cards, p), equipped: p.equipped.deck === id };
  };

  function deckLabel(r) { return r.name ? 'the ' + r.name : 'your deck'; }
  // How many more copies of a spell fit the equipped deck, and which rule stops it:
  // -> { n, rule: null|'unknown'|'copies'|'size'|'other', reason }
  api.deckRoom = function (cardId) {
    var p = api.player, d = ensureDecks(p), cards = d ? d.cards : p.deck, r = api.deckRules(), c = D().cards[cardId];
    if (!c || p.known.indexOf(cardId) < 0) return { n: 0, rule: 'unknown', reason: 'You have not learned ' + (c ? c.name : 'that spell') + ' yet.' };
    var have = cards[cardId] || 0, lim = [
      { n: r.maxCopies - have, rule: 'copies', reason: 'Max ' + plural(r.maxCopies, 'copy', 'copies') + ' per spell in ' + deckLabel(r) + '.' },
      { n: r.size - countSum(cards), rule: 'size', reason: (r.name ? 'The ' + r.name : 'Your deck') + ' is full (' + r.size + ' cards). Remove a card to make room.' }
    ];
    if (isOther(cardId, p)) lim.push({ n: r.maxOther - otherIn(cards, p), rule: 'other', reason: (r.name ? 'The ' + r.name : 'Your deck') + ' holds only ' + plural(r.maxOther, 'card') + ' from other schools.' });
    var best = lim[0];
    lim.forEach(function (l) { if (l.n < best.n) best = l; });
    return { n: Math.max(0, best.n), rule: best.rule, reason: best.reason };
  };
  // Can one more copy go in? -> { ok, rule, reason }
  api.canAddCard = function (cardId) {
    var room = api.deckRoom(cardId);
    return room.n > 0 ? { ok: true } : { ok: false, rule: room.rule, reason: room.reason };
  };
  api.canAddScroll = function (cardId) {
    var p = api.player, d = curDeck(), r = api.deckRules(), c = D().cards[cardId];
    if (!c) return { ok: false, rule: 'unknown', reason: 'Unknown Spell Scroll.' };
    if (!d) return { ok: false, rule: 'none', reason: 'Spell Scrolls go into a deck’s sideboard.' };
    var owned = Math.floor(num(p.tcs[cardId], 0)), inSb = d.tcs[cardId] || 0;
    if (!r.tcSlots) return { ok: false, rule: 'slots', reason: (r.name ? 'The ' + r.name : 'Your deck') + ' has no room for Spell Scrolls.' };
    if (inSb >= owned) return { ok: false, rule: 'owned', reason: owned ? 'You only have ' + owned + ' ' + c.name + ' scroll' + (owned > 1 ? 's' : '') + '.' : 'You have no ' + c.name + ' scrolls.' };
    if (countSum(d.tcs) >= r.tcSlots) return { ok: false, rule: 'slots', reason: (r.name ? 'The ' + r.name : 'Your deck') + ' carries only ' + plural(r.tcSlots, 'Spell Scroll') + '.' };
    return { ok: true };
  };

  // Set the copies of a spell in the EQUIPPED deck (existing v1.1 signature).
  // The count is clamped to the deck's rules. Returns true when the deck now
  // holds exactly `count` copies; otherwise false and api.deckError says why.
  // (v1.2: a deck may go below deckMin while you edit it; battleLoadout tops it up.)
  api.deckError = null;
  api.setDeckCount = function (id, count) {
    var p = api.player, d = curDeck(), cards = d ? d.cards : p.deck;
    api.deckError = null;
    if (p.known.indexOf(id) < 0 || !D().cards[id]) { api.deckError = 'You have not learned that spell.'; return false; }
    count = Math.max(0, Math.floor(num(count, 0)));
    var have = cards[id] || 0, n = count;
    if (count > have) {
      var room = api.deckRoom(id);
      n = Math.min(count, have + room.n);
      if (n < count) api.deckError = room.reason;
    }
    if (n <= 0) delete cards[id]; else cards[id] = n;
    if (d) p.deck = d.cards;
    if (n !== have) emit('deck', { kind: 'cards', card: id, count: n });
    return n === count;
  };
  // Spell Scrolls in the equipped deck's sideboard (<= owned, total <= tcSlots)
  api.setSideboardCount = function (cardId, count) {
    var p = api.player, d = curDeck();
    api.deckError = null;
    if (!d) { api.deckError = 'Spell Scrolls go into a deck’s sideboard.'; return false; }
    count = Math.max(0, Math.floor(num(count, 0)));
    var have = d.tcs[cardId] || 0, n = count;
    if (count > have) {
      var r = api.deckRules(), owned = Math.floor(num(p.tcs[cardId], 0)), bySlots = have + Math.max(0, r.tcSlots - countSum(d.tcs));
      n = Math.max(have, Math.min(count, owned, bySlots));
      if (n < count) {
        var lbl = r.name ? 'The ' + r.name : 'Your deck';
        api.deckError = !D().cards[cardId] ? 'Unknown Spell Scroll.'
          : owned < count && owned <= bySlots ? (owned ? 'You only have ' + owned + ' ' + cardName(cardId) + ' scroll' + (owned > 1 ? 's' : '') + '.' : 'You have no ' + cardName(cardId) + ' scrolls.')
          : !r.tcSlots ? lbl + ' has no room for Spell Scrolls.'
          : lbl + ' carries only ' + plural(r.tcSlots, 'Spell Scroll') + '.';
      }
    }
    if (n <= 0) delete d.tcs[cardId]; else d.tcs[cardId] = n;
    if (n !== have) emit('deck', { kind: 'scrolls', card: cardId, count: n });
    return n === count;
  };

  // Fill a card list (own spells first, the strongest first; then trained
  // spells; then extra copies of your attacks) up to the rules. Returns adds.
  function fillCards(cards, r, p, upTo) {
    var C = D().cards, added = 0, cap = Math.min(r.size, upTo || r.size);
    var known = p.known.filter(function (k) { return C[k]; });
    var lvl = function (k) { return C[k].source ? 0 : C[k].level; };
    var byStrength = function (a, b) { return lvl(b) - lvl(a) || C[b].pips - C[a].pips || C[a].name.localeCompare(C[b].name); };
    var own = known.filter(function (k) { return !isOther(k, p) && C[k].school !== 'lumen'; }).sort(byStrength);
    var lumen = known.filter(function (k) { return C[k].school === 'lumen'; }).sort(byStrength);
    var other = known.filter(function (k) { return isOther(k, p); }).sort(byStrength);
    function tryAdd(k, upto) {
      var have = cards[k] || 0;
      if (have >= upto || have >= r.maxCopies || countSum(cards) >= cap) return false;
      if (isOther(k, p) && otherIn(cards, p) >= r.maxOther) return false;
      cards[k] = have + 1; added++; return true;
    }
    var mains = own.concat(lumen);
    // 1) one copy of every own/Lumen spell, 2) up to its suggested copies, 3) trained spells
    mains.forEach(function (k) { tryAdd(k, 1); });
    var more = true;
    while (more) { more = false; mains.forEach(function (k) { if (tryAdd(k, C[k].copies || 2)) more = true; }); }
    other.forEach(function (k) { tryAdd(k, 1); });
    more = true;
    while (more) { more = false; other.forEach(function (k) { if (tryAdd(k, C[k].copies || 2)) more = true; }); }
    // 4) still room: extra copies of your own school's attacks, strongest first
    var ATT = { damage: 1, aoe: 1, dot: 1 };
    var attacks = own.filter(function (k) { return ATT[C[k].type]; });
    more = true;
    while (more) { more = false; attacks.forEach(function (k) { if (tryAdd(k, r.maxCopies)) more = true; }); }
    return added;
  }
  // Auto-fill: keeps what is in the equipped deck and fills the free space
  // (cards and sideboard). Returns { cards, scrolls } added.
  api.autoFillDeck = function () {
    var p = api.player, d = curDeck(), r = api.deckRules();
    var cards = d ? d.cards : p.deck;
    var out = { cards: fillCards(cards, r, p), scrolls: d ? fillScrolls(d.tcs, r, p) : 0 };
    if (d) p.deck = d.cards;
    if (out.cards || out.scrolls) emit('deck', { kind: 'autofill', cards: out.cards, scrolls: out.scrolls });
    return out;
  };
  // Clear: empties the equipped deck (cards and sideboard). Returns how many cards were removed.
  api.clearDeck = function () {
    var p = api.player, d = curDeck(), cards = d ? d.cards : p.deck, n = countSum(cards);
    Object.keys(cards).forEach(function (k) { delete cards[k]; });
    if (d) Object.keys(d.tcs).forEach(function (k) { delete d.tcs[k]; });
    emit('deck', { kind: 'clear', cards: n });
    return n;
  };

  api.canEquipDeck = function (id) {
    var p = api.player, it = deckItem(id);
    if (!it) return { ok: false, reason: 'Not a deck.' };
    if (!api.ownsDeck(id)) return { ok: false, reason: 'You do not own the ' + it.name + '.' };
    if (p.level < (it.level || 1)) return { ok: false, reason: 'Requires level ' + it.level + '.' };
    return { ok: true };
  };
  // Equip an owned deck. An EMPTY deck gets a copy of the current deck's cards
  // and scrolls (fitted to its rules) unless opts.copy === false.
  // Returns { ok, reason, copied, removed }.
  api.equipDeck = function (id, opts) {
    var p = api.player, chk = api.canEquipDeck(id);
    if (!chk.ok) return chk;
    curDeck();
    var from = p.equipped.deck, out = { ok: true, copied: 0, removed: 0 };
    if (from === id) return out;
    var dst = p.decks[id], src = p.decks[from];
    if (src && (!opts || opts.copy !== false) && !countSum(dst.cards) && !countSum(dst.tcs)) {
      var r = api.rulesOf(id), f = fitCards(src.cards, r, p);
      dst.cards = f.cards; dst.tcs = fitScrolls(src.tcs, r, p);
      out.copied = countSum(dst.cards); out.removed = f.removed; out.from = from;
    }
    p.equipped.deck = id;
    p.deck = dst.cards;
    emit('deck', { kind: 'equip', id: id, from: from, copied: out.copied, removed: out.removed });
    return out;
  };

  // A new deck item (shop, loot, quest, crafting). Decks are unique: a copy you
  // already own turns into its sell value. Returns [{ id, kind: 'new'|'duplicate', gold }].
  api.gainDeck = function (id, n) {
    var p = api.player, it = deckItem(id), out = [];
    if (!p || !it) return out;
    ensureDecks(p);
    for (var i = 0; i < (n || 1); i++) {
      if (!p.decks[id]) {
        p.decks[id] = emptyDeck();
        out.push({ id: id, kind: 'new' });
        emit('deck', { kind: 'new', id: id });
      } else {
        api.addGold(it.sell || 0);
        out.push({ id: id, kind: 'duplicate', gold: it.sell || 0 });
        emit('deck', { kind: 'duplicate', id: id, gold: it.sell || 0 });
      }
    }
    emit('inventory', { id: id, n: n || 1 });
    return out;
  };

  // ---- Battle input (contract §2.4): the equipped deck's cards + its sideboard ----
  // A deck below deckMin is topped up for that duel only (never saved), so a
  // half-built deck can't leave you with an empty hand.
  var pendingLoadout = null;   // scrolls carried into the current/last duel (see reconcileScrolls)
  api.battleLoadout = function () {
    var p = api.player, d = curDeck();
    if (!d) return { deck: WF.util.deepClone(p.deck || {}), tcs: WF.util.deepClone(p.tcs || {}) };
    var r = api.deckRules(), deck = Object.assign({}, d.cards), tcs = {}, inv = {};
    Object.keys(d.tcs).forEach(function (k) {
      var n = Math.min(d.tcs[k], Math.floor(num(p.tcs[k], 0)));
      if (n > 0) { tcs[k] = n; inv[k] = Math.floor(num(p.tcs[k], 0)); }
    });
    if (countSum(deck) < r.min) fillCards(deck, r, p, r.min);
    pendingLoadout = { deck: p.equipped.deck, tcs: Object.assign({}, tcs), inv: inv };
    return { deck: deck, tcs: tcs };
  };
  // After a duel: remove used scrolls from the equipped deck's sideboard and
  // from the scroll inventory (pass the Battle's tcsUsed).
  api.consumeScrolls = function (used) {
    var p = api.player, d = ensureDecks(p), spent = pendingLoadout && p.decks && p.decks[pendingLoadout.deck];
    used = cleanCounts(used);
    Object.keys(used).forEach(function (k) {
      var sb = spent || d;
      if (sb && sb.tcs[k]) { sb.tcs[k] = Math.max(0, sb.tcs[k] - used[k]); if (!sb.tcs[k]) delete sb.tcs[k]; }
      p.tcs[k] = Math.max(0, Math.floor(num(p.tcs[k], 0)) - used[k]);
      if (!p.tcs[k]) delete p.tcs[k];
    });
    pendingLoadout = null;
    clampSideboards(p);
  };
  // If the duel screen subtracted used scrolls from p.tcs itself (v1.1 code path),
  // take them out of the sideboard they were carried in, too.
  function reconcileScrolls() {
    var p = api.player, L = pendingLoadout;
    if (!p || !p.decks) return;
    if (!L || !p.decks[L.deck]) { clampSideboards(p); return; }   // scrolls spent/sold elsewhere: sideboards never exceed what you own
    var sb = p.decks[L.deck].tcs;
    Object.keys(L.inv).forEach(function (k) {
      var now = Math.floor(num(p.tcs[k], 0)), gone = L.inv[k] - now;
      if (gone > 0) {
        var take = Math.min(gone, L.tcs[k] || 0);
        if (take > 0 && sb[k]) { sb[k] = Math.max(0, sb[k] - take); if (!sb[k]) delete sb[k]; L.tcs[k] -= take; }
      }
      L.inv[k] = now;
    });
    clampSideboards(p);
  }
  function clampSideboards(p) {
    if (!p || !p.decks) return;
    Object.keys(p.decks).forEach(function (id) { if (deckItem(id)) p.decks[id].tcs = fitScrolls(p.decks[id].tcs, api.rulesOf(id), p); });
  }
  // The one-time "your deck moved" note from migrateDecks (UI shows it once)
  api.takeDeckNotice = function () { var p = api.player, n = p && p.deckNotice; if (p) delete p.deckNotice; return n || null; };

  // ------------------------------------------------------------------
  // Inventory, gold, gear, potions, crafting
  // ------------------------------------------------------------------
  api.count = function (id) { return api.player.inventory[id] || 0; };
  api.addItem = function (id, n) {
    if (!D().items[id]) return;
    var t = D().items[id].type;
    if ((t === 'gear' || t === 'mount') && api.player.newItems) api.player.newItems[id] = Date.now();
    var inv = api.player.inventory;
    inv[id] = (inv[id] || 0) + (n || 1);
    emit('inventory', { id: id, n: n || 1 });
  };
  api.removeItem = function (id, n) {
    var inv = api.player.inventory;
    n = n || 1;
    if ((inv[id] || 0) < n) return false;
    inv[id] -= n;
    if (inv[id] <= 0) { delete inv[id]; if (api.player.newItems) delete api.player.newItems[id]; }
    emit('inventory', { id: id, n: -n });
    return true;
  };
  api.addTC = function (id, n) {
    var t = api.player.tcs;
    t[id] = (t[id] || 0) + (n || 1);
  };
  api.addGold = function (n) { api.player.gold = Math.max(0, api.player.gold + Math.round(n)); emit('gold', n); };

  api.canEquip = function (id) {
    var it = D().items[id];
    if (!it || it.type !== 'gear' || api.player.level < (it.level || 1)) return false;
    if (it.school && it.school !== api.player.school) return false;
    return true;
  };
  api.equip = function (id) {
    var p = api.player, it = D().items[id];
    if (!api.canEquip(id) || api.count(id) < 1) return false;
    var old = p.equipped[it.slot];
    api.removeItem(id, 1);
    if (old) { api.addItem(old, 1); delete p.newItems[old]; }
    p.equipped[it.slot] = id;
    api.clampVitals();
    emit('equip', { slot: it.slot, id: id });
    return true;
  };
  api.unequip = function (slot) {
    var p = api.player, id = p.equipped[slot];
    if (!id) return false;
    p.equipped[slot] = null;
    api.addItem(id, 1);
    delete p.newItems[id];
    api.clampVitals();
    emit('equip', { slot: slot, id: null });
    return true;
  };
  api.canBuy = function (id) {
    var it = D().items[id];
    if (!it || !it.price) return { ok: false, reason: 'Not for sale' };
    if (it.type === 'mount' && api.ownsMount(id)) return { ok: false, reason: 'Already in your stable' };
    if (api.player.gold < it.price) return { ok: false, reason: 'Not enough gold' };
    return { ok: true };
  };
  api.buy = function (id) {
    var it = D().items[id];
    if (!api.canBuy(id).ok) return false;
    api.addGold(-it.price);
    // v1.2 WS2 (contract §6.1): a shop item with school `variants` comes in the buyer's school
    var got = schoolVariant(id, api.player.school);
    api.addItem(got, 1);
    delete api.player.newItems[got];             // you know what you just bought
    return true;
  };
  api.sell = function (id) {
    var it = D().items[id];
    if (!it || api.count(id) < 1) return false;
    api.removeItem(id, 1);
    api.addGold(it.sell || 1);
    return true;
  };
  // Sell every unequipped item matching filter(item) (vendors: "Sell all Common").
  // Returns { count, gold }. preview=true only counts.
  api.sellWhere = function (filter, preview) {
    var p = api.player, out = { count: 0, gold: 0, ids: [] };
    Object.keys(p.inventory).forEach(function (id) {
      var it = D().items[id];
      if (!it || !filter(it)) return;
      var n = p.inventory[id];
      out.count += n; out.gold += n * (it.sell || 1); out.ids.push(id);
      if (!preview) { api.removeItem(id, n); }
    });
    if (!preview && out.gold) api.addGold(out.gold);
    return out;
  };
  api.sellAllCommonGear = function (preview) {
    return api.sellWhere(function (it) { return it.type === 'gear' && api.rarityId(it) === 'common'; }, preview);
  };

  // ---- NEW badges (fresh drops) ----
  api.isNew = function (id) { return !!(api.player.newItems && api.player.newItems[id]); };
  api.markSeen = function (id) { if (api.player.newItems) delete api.player.newItems[id]; };
  api.clearNew = function () { api.player.newItems = {}; };

  // ---- Rarity helpers ----
  api.rarityId = function (it) {
    if (typeof it === 'string') it = D().items[it];
    var r = it && it.rarity;
    return (r && D().rarities && D().rarities[r]) ? r : 'common';
  };
  api.rarity = function (it) { return (D().rarities || {})[api.rarityId(it)] || { id: 'common', name: 'Common', color: '#d8d8d8', order: 0 }; };
  // Stat difference if this gear replaced what is equipped in its slot: { hp: +12, dmg: -1, ... }
  api.compareGear = function (id) {
    var it = D().items[id], p = api.player, out = {};
    if (!it || it.type !== 'gear') return out;
    // v1.2: the whole loadout before vs after the swap, so set bonuses gained
    // or lost are part of the comparison
    var eq = {}; Object.keys(p.equipped).forEach(function (k) { eq[k] = p.equipped[k]; });
    var before = api.gearStats(), after;
    eq[it.slot] = id; after = api.gearStats(eq);
    api.GEAR_STATS.forEach(function (k) { var d = (after[k] || 0) - (before[k] || 0); if (d) out[k] = Math.round(d * 100) / 100; });
    return out;
  };
  // Rough single-number value of a piece (same weights as the balance sim).
  // v1.2: 1% Bright Pip or Pip Surge ~ +0.01 pip per round ~ 0.8% damage
  // output at L10, about what 1% damage is worth -> same weight as dmg.
  // v2.0 M1: school damage / accuracy weigh like the universal stat (they sit on
  // school-only gear, so they are always the wearer's own school); resist against
  // ONE school only stops some hits, so it weighs SCHOOL_RESIST_W of universal.
  api.GEAR_SCORE_WEIGHTS = { hp: 1 / 8, dmg: 4, resist: 4, acc: 1.5, mana: 2, brightPip: 4, pipSurge: 4 };
  api.SCHOOL_SCORE_WEIGHTS = { dmg: 4, resist: 2, acc: 1.5 };
  api.gearScore = function (it) {
    if (typeof it === 'string') it = D().items[it];
    var s = (it && it.stats) || {}, w = api.GEAR_SCORE_WEIGHTS, sw = api.SCHOOL_SCORE_WEIGHTS, n = 0;
    Object.keys(w).forEach(function (k) { n += (s[k] || 0) * w[k]; });
    Object.keys(s).forEach(function (k) { var sp = D().splitSchoolStat && D().splitSchoolStat(k); if (sp) n += (s[k] || 0) * (sw[sp.kind] || 0); });
    return n;
  };

  // ---- Mounts (contract §4.5) ----
  api.ownedMounts = function () {
    var p = api.player, out = [];
    if (p.equipped.mount) out.push(p.equipped.mount);
    Object.keys(p.inventory).forEach(function (id) { var it = D().items[id]; if (it && it.type === 'mount' && out.indexOf(id) < 0) out.push(id); });
    return out;
  };
  api.ownsMount = function (id) { return api.ownedMounts().indexOf(id) >= 0; };
  api.canEquipMount = function (id) {
    var it = D().items[id];
    return !!(it && it.type === 'mount' && api.player.level >= (it.level || 1) && api.ownsMount(id));
  };
  api.equipMount = function (id) {
    var p = api.player;
    if (!api.canEquipMount(id)) return false;
    if (p.equipped.mount === id) return true;
    var old = p.equipped.mount;
    api.removeItem(id, 1);
    if (old) api.addItem(old, 1);
    delete p.newItems[id]; if (old) delete p.newItems[old];
    p.equipped.mount = id;
    emit('mount', { id: id, mounted: p.mounted });
    return true;
  };
  api.unequipMount = function () {
    var p = api.player, id = p.equipped.mount;
    if (!id) return false;
    p.equipped.mount = null; p.mounted = false;
    api.addItem(id, 1); delete p.newItems[id];
    emit('mount', { id: null, mounted: false });
    return true;
  };
  api.setMounted = function (on) {
    var p = api.player;
    on = !!on && !!p.equipped.mount;
    if (p.mounted === on) return on;
    p.mounted = on;
    emit('mount', { id: p.equipped.mount, mounted: on });
    return on;
  };
  api.toggleMount = function () { return api.setMounted(!api.player.mounted); };
  // Movement speed bonus (0.4 = +40%) of the equipped mount while riding
  api.mountSpeed = function () {
    var p = api.player, it = p.mounted && p.equipped.mount && D().items[p.equipped.mount];
    return it ? (it.speed || 0) : 0;
  };

  // ---- Appearance (contract §4.2): school colours + equipped gear looks ----
  var SCHOOL_FX = { stoneward: 'sparkle', tidecaller: 'frost', emberstrike: 'embers' };
  api.appearance = function (equippedOverride) {
    var p = api.player, sc = D().schools[p.school] || {}, eq = equippedOverride || p.equipped;
    var look = { robe: sc.robe, hat: sc.hat, trim: sc.trim, skin: BASE_SKIN, hair: BASE_HAIR, staffGem: sc.color, scale: 1, gear: {}, school: p.school };   // v2.1: school -> its own wand wind-up
    if (isObj(p.look)) { look.build = WF.util.deepClone(p.look); look.skin = p.look.skin || BASE_SKIN; look.hair = p.look.hairColor || BASE_HAIR; }   // v2.1 WS-D
    var defColor = { hat: sc.hat, robe: sc.robe, boots: sc.hat, wand: '#7a5232', amulet: sc.trim };
    (D().gearSlots || []).forEach(function (slot) {
      var it = eq[slot] && D().items[eq[slot]];
      if (!it) { look.gear[slot] = null; return; }
      var l = it.look || {}, styles = (D().gearStyles || {})[slot] || [], rar = api.rarityId(it);
      var ord = api.rarity(it).order || 0;
      look.gear[slot] = {
        style: styles.indexOf(l.style) >= 0 ? l.style : (styles[0] || null),
        color: l.color || defColor[slot],
        color2: l.color2 || sc.trim,
        gem: l.gem || sc.color,
        fx: l.fx !== undefined ? l.fx : (ord >= 4 ? (SCHOOL_FX[p.school] || 'glow') : ord >= 3 ? 'sparkle' : ord >= 2 ? 'glow' : null),
        rarity: rar,
        // ---- v1.2 integration: tier escalation looks (§6.3, WS6 renderer reads tier + color3)
        tier: l.tier || it.tier || 1,
        color3: l.color3 || undefined
      };
    });
    // keep the v1.0 fields in step with the most visible gear (old renderers)
    if (look.gear.robe) look.robe = look.gear.robe.color;
    if (look.gear.hat) look.hat = look.gear.hat.color;
    if (look.gear.wand) look.staffGem = look.gear.wand.gem;
    return look;
  };
  // kind: 'health' | 'mana'. Uses the smallest potion that does the job.
  api.usePotion = function (kind) {
    var p = api.player, s = api.stats();
    var ids = Object.keys(p.inventory).filter(function (id) {
      var it = D().items[id];
      return it && it.type === 'potion' && (kind === 'health' ? it.heal : it.mana);
    }).sort(function (a, b) {
      var A = D().items[a], B = D().items[b];
      return (A.heal || A.mana) - (B.heal || B.mana);
    });
    if (!ids.length) return null;
    if (kind === 'health' && p.hp >= s.maxHp) return 'full';
    if (kind === 'mana' && p.mana >= s.maxMana) return 'full';
    var id = ids[0], it = D().items[id];
    api.removeItem(id, 1);
    if (it.heal) p.hp = Math.min(s.maxHp, p.hp + it.heal);
    if (it.mana) p.mana = Math.min(s.maxMana, p.mana + it.mana);
    return id;
  };

  // Crafting (recipes.js)
  // v1.2 WS2: a recipe whose result does not exist (a data file of another
  // workstream not loaded yet, an old save's mod...) is hidden, never offered.
  function recipeValid(r) {
    if (!r || !r.makes) return false;
    if (r.makes.item) return !!D().items[r.makes.item];
    if (r.makes.tc) return !!D().cards[r.makes.tc];
    return false;
  }
  api.recipesAt = function (npcId) {
    var R = D().recipes || {};
    return Object.keys(R).filter(function (id) { return R[id].npc === npcId && recipeValid(R[id]); });
  };
  // v1.2 WS2: the item a recipe gives THIS wizard. Gear with school
  // `variants` (Artificer hat/robe/wand) is crafted in the player's school
  // version, exactly like a boss drop. null for spell scrolls.
  api.recipeItem = function (rid, school) {
    var r = (D().recipes || {})[rid];
    if (!r || !r.makes || !r.makes.item || !D().items[r.makes.item]) return null;
    return schoolVariant(r.makes.item, school || (api.player && api.player.school));
  };
  api.canCraft = function (rid) {
    var r = (D().recipes || {})[rid], p = api.player;
    if (!r) return { ok: false, reason: 'Unknown recipe' };
    if (!recipeValid(r)) return { ok: false, reason: 'Not available yet' };
    if (r.level && p.level < r.level) return { ok: false, reason: 'Requires level ' + r.level };
    var mk = r.makes.item && D().items[api.recipeItem(rid)];
    // deck items are unique (contract §2.4): no second copy from crafting
    if (mk && mk.type === 'deck' && api.ownsDeckItem(mk.id)) return { ok: false, reason: 'Already owned' };
    if (r.gold && p.gold < r.gold) return { ok: false, reason: 'Not enough gold' };
    var miss = Object.keys(r.needs || {}).filter(function (id) { return api.count(id) < r.needs[id]; });
    if (miss.length) return { ok: false, reason: 'Missing reagents' };
    return { ok: true };
  };
  // Owns a deck item? (WS3's ownedDecks() when present, else the backpack / p.decks)
  api.ownsDeckItem = function (id) {
    var p = api.player;
    if (typeof api.ownedDecks === 'function') { try { return api.ownedDecks().indexOf(id) >= 0; } catch (e) { /* fall through */ } }
    return !!((p.inventory && p.inventory[id]) || (p.decks && p.decks[id]) || (p.equipped && p.equipped.deck === id));
  };
  // school (optional, v1.2 §6.1): craft another school's version of a gear
  // piece with `variants` (for your other wizards). Defaults to your own.
  api.craft = function (rid, school) {
    var r = (D().recipes || {})[rid];
    if (!api.canCraft(rid).ok) return false;
    if (school && (D().playableSchools || []).indexOf(school) < 0) return false;
    Object.keys(r.needs || {}).forEach(function (id) { api.removeItem(id, r.needs[id]); });
    if (r.gold) api.addGold(-r.gold);
    var n = r.count || 1;
    if (r.makes && r.makes.item) api.addItem(api.recipeItem(rid, school), n);
    if (r.makes && r.makes.tc) api.addTC(r.makes.tc, n);
    api.save();
    return true;
  };

  // ---- v1.2 WS2: Tamsin's UPGRADE and SALVAGE (contract §6.3) ----
  // Costs: WF.data.gearUpgrades[item.upgradeCost].t2 / .t3 (reagents + gold),
  // salvage[t1|t2|t3] = Starlight Essence per piece. A piece can be upgraded
  // from the backpack or while equipped (it stays equipped); salvage only
  // takes pieces from the backpack.
  function upgCost(it) { var U = D().gearUpgrades || {}; return it && U[it.upgradeCost || it.set] || null; }
  api.isUpgrader = function (npcId) { return !!(D().gearUpgrades && D().gearUpgrades.npc === npcId); };
  api.upgradeInfo = function (id) {
    var it = D().items[id], c = upgCost(it);
    if (!it || !it.next || !D().items[it.next] || !c) return null;
    var row = c['t' + (it.tier + 1)]; if (!row) return null;
    var needs = {}, gold = 0;
    Object.keys(row).forEach(function (k) { if (k === 'gold') gold = row[k]; else needs[k] = row[k]; });
    return { from: id, to: it.next, tier: it.tier + 1, needs: needs, gold: gold };
  };
  // where the player holds a piece: 'equipped' | 'pack' | null
  api.holds = function (id) {
    var p = api.player, it = D().items[id];
    if (it && it.slot && p.equipped[it.slot] === id) return 'equipped';
    return api.count(id) > 0 ? 'pack' : null;
  };
  api.canUpgrade = function (id, where) {
    var info = api.upgradeInfo(id), p = api.player;
    if (!info) return { ok: false, reason: 'Already at the highest tier' };
    if (!api.holds(id) || (where === 'pack' && api.count(id) < 1)) return { ok: false, reason: 'You do not have it' };
    if (p.level < (D().items[info.to].level || 1)) return { ok: false, reason: 'Requires level ' + D().items[info.to].level };
    if (p.gold < info.gold) return { ok: false, reason: 'Not enough gold' };
    if (Object.keys(info.needs).some(function (k) { return api.count(k) < info.needs[k]; })) return { ok: false, reason: 'Missing reagents' };
    return { ok: true };
  };
  // where (optional): 'equipped' | 'pack' when the player has both (a duplicate)
  api.upgrade = function (id, where) {
    if (!api.canUpgrade(id, where).ok) return false;
    var info = api.upgradeInfo(id), p = api.player, it = D().items[id];
    where = where === 'pack' || where === 'equipped' && api.holds(id) === 'equipped' ? where : api.holds(id);
    Object.keys(info.needs).forEach(function (k) { api.removeItem(k, info.needs[k]); });
    api.addGold(-info.gold);
    if (where === 'equipped') {
      p.equipped[it.slot] = info.to;
      api.clampVitals();
      emit('equip', { slot: it.slot, id: info.to });
    } else {
      api.removeItem(id, 1);
      api.addItem(info.to, 1);
    }
    api.save();
    return info.to;
  };
  api.salvageValue = function (id) {
    var it = D().items[id], c = upgCost(it);
    return (it && c && c.salvage && c.salvage['t' + (it.tier || 1)]) || 0;
  };
  api.canSalvage = function (id) {
    if (!api.salvageValue(id)) return { ok: false, reason: 'Tamsin cannot salvage that' };
    if (api.count(id) < 1) return { ok: false, reason: api.holds(id) === 'equipped' ? 'Unequip it first' : 'You do not have it' };
    return { ok: true };
  };
  api.salvage = function (id) {
    if (!api.canSalvage(id).ok) return 0;
    var n = api.salvageValue(id);
    api.removeItem(id, 1);
    api.addItem('starlight_essence', n);
    api.save();
    return n;
  };
  // Endgame pieces the player holds that Tamsin can work on: [{ id, where }]
  api.upgradeablePieces = function () {
    var p = api.player, out = [];
    (D().gearSlots || []).forEach(function (s) { var id = p.equipped[s]; if (id && (api.upgradeInfo(id) || api.salvageValue(id))) out.push({ id: id, where: 'equipped' }); });
    Object.keys(p.inventory).forEach(function (id) { if (api.upgradeInfo(id) || api.salvageValue(id)) out.push({ id: id, where: 'pack' }); });
    return out;
  };
  // Raw stat difference b - a of two items (upgrade previews)
  api.statDiff = function (aId, bId) {
    var a = (D().items[aId] || {}).stats || {}, b = (D().items[bId] || {}).stats || {}, out = {};
    api.GEAR_STATS.forEach(function (k) { var d = (b[k] || 0) - (a[k] || 0); if (d) out[k] = d; });
    return out;
  };

  // ------------------------------------------------------------------
  // Loot (called after winning a duel)
  // ------------------------------------------------------------------
  // A Spell Scroll of your own school is mostly useless (you know it already),
  // so it re-rolls into another school's spell of a similar level.
  function pickR(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
  function rerollTC(cardId, rng, school) {
    var c = D().cards[cardId];
    if (!c || c.school !== school) return cardId;
    var pool = Object.keys(D().cards).filter(function (id) {
      var k = D().cards[id];
      return k.school !== school && D().schools[k.school] && D().schools[k.school].playable && !k.source &&
        Math.abs(k.level - c.level) <= 1 && ['damage', 'aoe', 'dot', 'heal', 'blade', 'trap', 'shield', 'absorb'].indexOf(k.type) >= 0;
    });
    return pool.length ? pickR(pool, rng) : cardId;
  }
  function schoolVariant(itemId, school) {
    var it = D().items[itemId];
    if (it && it.variants && it.variants[school] && D().items[it.variants[school]]) return it.variants[school];
    return itemId;
  }
  api.schoolVariant = function (itemId, school) { return schoolVariant(itemId, school || api.player.school); };
  // v1.2 WS2 (contract §6.1): a DROP with `variants` rolls its school
  // uniformly at random (1/3 each), not the player's school. Quest rewards
  // and shop items still use schoolVariant(id, playerSchool).
  // v2.1 (Jorge, Oct 20): a piece marked `ownSchool: true` in the data (the
  // dungeon set Starbound/Starwalker and the world-boss set Duskherald,
  // items_endgame.js) drops ONLY in the looter's school; no rng is used then.
  // Without a known school it falls back to the random roll.
  function dropVariant(itemId, rng, school) {
    var it = D().items[itemId];
    if (!it || !it.variants) return itemId;
    if (it.ownSchool && school && it.variants[school] && D().items[it.variants[school]]) return it.variants[school];
    var keys = Object.keys(it.variants).filter(function (s) { return D().items[it.variants[s]]; }).sort();
    return keys.length ? it.variants[keys[Math.floor(rng() * keys.length) % keys.length]] : itemId;
  }
  api.dropVariant = function (itemId, rng, school) { return dropVariant(itemId, rng || Math.random, school); };

  // --- Rarity-weighted gear drops (items.js WF.data.lootRules / lootTables) ---
  api.enemyKind = function (e) { return e.boss ? 'boss' : (e.elite ? 'elite' : 'mob'); };
  api.lootTableFor = function (e) {
    var T = D().lootTables || {}, L = e.loot || {};
    if (L.table && T[L.table]) return T[L.table];
    var best = null;
    Object.keys(T).forEach(function (k) { var t = T[k]; if (t.levels && e.level >= t.levels[0] && e.level <= t.levels[1]) best = best || t; });
    if (!best) {     // above every table: the highest one
      Object.keys(T).forEach(function (k) { if (!best || (T[k].levels || [0, 0])[1] > (best.levels || [0, 0])[1]) best = T[k]; });
    }
    return best;
  };
  api.rollRarity = function (kind, level, rng) {
    rng = rng || Math.random;
    var rules = D().lootRules || {}, order = D().rarityOrder || ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    var w = rules.rarityWeights ? rules.rarityWeights(kind, level) : { common: 1 };
    var min = (rules.minRarity || {})[kind], minI = min ? order.indexOf(min) : 0, tot = 0;
    order.forEach(function (r, i) { if (i >= minI) tot += Math.max(0, w[r] || 0); });
    if (tot <= 0) return order[minI] || 'common';
    var x = rng() * tot;
    for (var i = minI; i < order.length; i++) { x -= Math.max(0, w[order[i]] || 0); if (x < 0) return order[i]; }
    return order[order.length - 1];
  };
  // One random gear piece of `rarity` for enemy e (steps down if a pool is empty)
  api.pickGear = function (e, rarity, rng) {
    rng = rng || Math.random;
    var order = D().rarityOrder || ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    var t = api.lootTableFor(e), L = e.loot || {}, ri = order.indexOf(rarity);
    for (; ri >= 0; ri--) {
      var r = order[ri], pool;
      if (r === 'legendary') pool = (L.legendary && L.legendary.length ? L.legendary : (t && t.legendary) || []);
      else pool = ((t && t.items) || []).filter(function (id) { return api.rarityId(id) === r; });
      pool = pool.filter(function (id) { return D().items[id] && D().items[id].type === 'gear'; });
      if (!pool.length) continue;
      // random slot first (so slots with more variety do not dominate), then an item
      var slots = [];
      pool.forEach(function (id) { var sl = D().items[id].slot; if (slots.indexOf(sl) < 0) slots.push(sl); });
      var slot = pickR(slots, rng);
      return pickR(pool.filter(function (id) { return D().items[id].slot === slot; }), rng);
    }
    return null;
  };
  // v2.1: one random piece of a gear set (the school-less drop ids with `variants`): a random slot,
  // then a random piece of that slot (lowest tier first: a set roll never gives an upgraded tier).
  function setDropIds(setId) {
    var I = D().items, out = [];
    Object.keys(I).forEach(function (id) { var it = I[id]; if (it && it.type === 'gear' && it.set === setId && it.variants && (it.tier || 1) === 1) out.push(id); });
    return out.sort();
  }
  api.pickSetPiece = function (setId, rng) {
    var pool = setDropIds(setId); if (!pool.length) return null;
    var slots = [];
    pool.forEach(function (id) { var sl = D().items[id].slot; if (slots.indexOf(sl) < 0) slots.push(sl); });
    var slot = pickR(slots, rng || Math.random);
    return pickR(pool.filter(function (id) { return D().items[id].slot === slot; }), rng || Math.random);
  };

  // ---- v2.1 DROP HINTS (Jorge, Oct 20): "each dungeon boss drops specific gear slots, and the game
  // shows it, so a player farming boots knows which boss to fight". Pure and data-driven: read from
  // the boss's loot (hand-placed loot.gear, its loot.legendary pool, loot.setRolls); only SET pieces
  // (the dungeon set, the world-boss set) count. For `school` (default: the current wizard's) ->
  //   [{ slot, tier, itemId, name, set, tiered, chance }]  sorted by gear slot, then tier
  // (`tiered` false = a one-tier set such as the world-boss set: show no tier).
  // `itemId` is the piece YOU would get (your school's version); `chance` = per kill, approximate
  // (several sources of the same piece combine).
  api.bossDropHints = function (enemyId, school) {
    school = school || (api.player && api.player.school);
    var e = D().enemies[enemyId], I = D().items, byKey = {}, out = [];
    if (!e) return out;
    var L = e.loot || {}, rules = D().lootRules || {}, kind = api.enemyKind(e);
    var gearChance = L.gearChance != null ? L.gearChance : ((rules.gearChance || {})[kind] || 0);
    function add(baseId, p) {
      var b = I[baseId]; if (!b || b.type !== 'gear' || !b.set || !(p > 0)) return;
      var id = school && b.variants && b.variants[school] && I[b.variants[school]] ? b.variants[school] : baseId, it = I[id];
      var k = it.slot + '|' + (it.tier || 1);
      if (!byKey[k]) { byKey[k] = { slot: it.slot, tier: it.tier || 1, itemId: id, name: it.name, set: it.set, tiered: !!(it.next || it.tier > 1), chance: 0 }; out.push(byKey[k]); }
      byKey[k].chance = 1 - (1 - byKey[k].chance) * (1 - p);
    }
    (L.gear || []).forEach(function (d) { add(d.item, d.chance); });
    // the legendary rarity roll picks a slot, then a piece of the boss's legendary pool
    var leg = (L.legendary || []).filter(function (id) { return I[id] && I[id].type === 'gear'; });
    if (leg.length && gearChance > 0) {
      var w = rules.rarityWeights ? rules.rarityWeights(kind, e.level) : {}, order = D().rarityOrder || ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      var mi = order.indexOf((rules.minRarity || {})[kind] || 'common'), tot = 0;
      order.forEach(function (r, i) { if (i >= mi) tot += Math.max(0, w[r] || 0); });
      var rolls = L.setRolls && L.setRolls.count > 0 ? Math.floor(L.setRolls.count) : 1, notSet = L.setRolls ? 1 - (L.setRolls.chance || 0) : 1;
      var pLeg = tot ? gearChance * notSet * Math.max(0, w.legendary || 0) / tot : 0, slots = [];
      leg.forEach(function (id) { if (slots.indexOf(I[id].slot) < 0) slots.push(I[id].slot); });
      leg.forEach(function (id) {
        var inSlot = leg.filter(function (x) { return I[x].slot === I[id].slot; }).length;
        add(id, 1 - Math.pow(1 - pLeg / slots.length / inSlot, rolls));
      });
    }
    if (L.setRolls && L.setRolls.count > 0) {
      var pool = setDropIds(L.setRolls.set), ss = [];
      pool.forEach(function (id) { if (ss.indexOf(I[id].slot) < 0) ss.push(I[id].slot); });
      pool.forEach(function (id) {
        var n = pool.filter(function (x) { return I[x].slot === I[id].slot; }).length;
        add(id, 1 - Math.pow(1 - gearChance * (L.setRolls.chance || 0) / ss.length / n, Math.floor(L.setRolls.count)));
      });
    }
    var so = D().gearSlots || ['hat', 'robe', 'boots', 'wand', 'amulet'];
    return out.sort(function (a, b) { return (so.indexOf(a.slot) - so.indexOf(b.slot)) || (a.tier - b.tier); });
  };

  // Gear rolled for one defeated enemy -> [itemId] (school variants applied)
  // opts.gearMult (v2.1 D16 Heroic): multiplies the fixed gear drops (loot.gear: the dungeon set), capped at 1
  api.rollGear = function (eid, rng, school, opts) {
    rng = rng || Math.random; school = school || (api.player && api.player.school);
    var gm = opts && opts.gearMult > 0 ? +opts.gearMult : 1;
    var e = D().enemies[eid], out = [];
    if (!e) return out;
    var L = e.loot || {}, rules = D().lootRules || {}, kind = api.enemyKind(e);
    var chance = L.gearChance != null ? L.gearChance : ((rules.gearChance || {})[kind] || 0);
    // v1.2: school versions are rolled at random (dropVariant), contract §6.1; v2.1: `ownSchool` pieces in yours
    // v2.1 world-boss set (Jorge, Oct 20 8:20 PM): loot.setRolls = { set, count, chance } makes the
    // boss's random gear roll happen `count` times; each roll is a piece of `set` (random slot, your
    // school) with `chance`, otherwise normal gear (the rarity-weighted roll below).
    var sr = L.setRolls, rolls = sr && sr.count > 0 ? Math.floor(sr.count) : 1;
    for (var ri = 0; ri < rolls; ri++) {
      if (!(chance > 0 && rng() < chance)) continue;
      var setId = sr && sr.count > 0 && rng() < (sr.chance || 0) ? api.pickSetPiece(sr.set, rng) : null;
      var id = setId || api.pickGear(e, api.rollRarity(kind, e.level, rng), rng);
      if (id) out.push(dropVariant(id, rng, school));
    }
    (L.gear || []).forEach(function (d) { if (rng() < Math.min(1, d.chance * gm)) out.push(dropVariant(d.item, rng, school)); });
    (L.mounts || []).forEach(function (d) {
      // a mount you already own never drops again (and never twice in one fight)
      if (rng() < d.chance && D().items[d.item] && out.indexOf(d.item) < 0 && !(api.player && api.ownsMount(d.item))) out.push(d.item);
    });
    return out;
  };

  // rng (optional) makes every roll deterministic for tests and the balance
  // sim; school (optional) defaults to the current player's school.
  // opts (v2.1 D16): { gearMult } for a Heroic dungeon run (dungeons.js heroic.rewards)
  api.rollLoot = function (enemyIds, rng, school, opts) {
    rng = rng || Math.random; school = school || (api.player && api.player.school);
    var out = { gold: 0, items: {}, tcs: {}, xp: 0, gear: [], runeglass: 0 };
    var prog = P();
    enemyIds.forEach(function (eid) {
      var e = D().enemies[eid];
      if (!e) return;
      out.xp += e.xp != null ? e.xp : prog.mobXp(e.level) * (e.boss ? prog.bossMult : 1);
      var L = e.loot || {};
      if (L.gold) out.gold += L.gold[0] + Math.floor(rng() * (L.gold[1] - L.gold[0] + 1));
      (L.drops || []).forEach(function (d) { if (rng() < d.chance) out.items[d.item] = (out.items[d.item] || 0) + (d.count || 1); });
      api.rollGear(eid, rng, school, opts).forEach(function (id) {
        out.items[id] = (out.items[id] || 0) + 1;
        out.gear.push(id);
      });
      (L.tc || []).forEach(function (d) {
        if (rng() < d.chance) { var id = rerollTC(d.card, rng, school); out.tcs[id] = (out.tcs[id] || 0) + 1; }
      });
      out.runeglass += api.rollRuneglass(eid, rng);       // v2.0 M1 (WS-A): last, so older rolls keep their rng order
    });
    // highest rarity among the gear/mounts (results screen fanfare)
    var best = -1;
    out.gear.forEach(function (id) { var o = api.rarity(id).order || 0; if (o > best) { best = o; out.best = api.rarityId(id); } });
    return out;
  };

  api.applyLoot = function (loot) {
    api.addGold(loot.gold);
    if (loot.runeglass) api.addRuneglass(loot.runeglass);     // v2.0 M1
    Object.keys(loot.items).forEach(function (id) { api.addItem(id, loot.items[id]); });
    Object.keys(loot.tcs).forEach(function (id) { api.addTC(id, loot.tcs[id]); });
    return api.addXP(loot.xp);
  };

  // ------------------------------------------------------------------
  // Quests
  // ------------------------------------------------------------------
  api.trainerId = function (school) {
    var npcs = D().npcs, sc = school || api.player.school;
    for (var id in npcs) if (npcs[id].role === 'trainer' && npcs[id].school === sc) return id;
    return null;
  };
  api.resolveNpc = function (id) { return id === '@trainer' ? api.trainerId() : id; };

  api.questState = function (qid) {
    var p = api.player, q = D().quests[qid];
    if (!q) return 'locked';
    if (p.quests.done[qid]) return 'done';
    if (p.quests.active[qid]) return api.isReady(qid) ? 'ready' : 'active';
    var ok = (q.prereq || []).every(function (r) { return p.quests.done[r]; });
    return ok ? 'available' : 'locked';
  };

  // Count interacted props of a kind in a zone (relight lanterns etc.)
  api.interactCount = function (zone, kind) {
    var n = 0, it = api.player.interacted;
    Object.keys(it).forEach(function (k) { if (it[k] === kind && k.indexOf(zone + ':') === 0) n++; });
    return n;
  };
  api.isInteracted = function (zone, propId) { return !!api.player.interacted[zone + ':' + propId]; };

  function zoneLanternsRestored(zoneId) {
    var z = D().zones[zoneId];
    return !!(z && (z.restored || []).some(function (r) { return r.lanterns === 'lit' && r.quest && api.player.quests.done[r.quest]; }));
  }

  api.objectiveProgress = function (qid, i) {
    var p = api.player, q = D().quests[qid], o = q.objectives[i];
    var a = p.quests.active[qid] || {};
    if (o.type === 'kill') {
      var have = (a.kills && a.kills[o.enemy]) || 0;
      return { have: Math.min(have, o.count), need: o.count, done: have >= o.count };
    }
    if (o.type === 'collect') {
      var c = api.count(o.item);
      return { have: Math.min(c, o.count), need: o.count, done: c >= o.count };
    }
    if (o.type === 'talk') {
      var t = !!(a.talked && a.talked[api.resolveNpc(o.npc)]);
      return { have: t ? 1 : 0, need: 1, done: t };
    }
    if (o.type === 'visit') {
      var v = !!(a.visited && a.visited[o.zone]);
      return { have: v ? 1 : 0, need: 1, done: v };
    }
    if (o.type === 'interact') {
      var n = api.interactCount(o.zone, o.kind);
      if (n < o.count && o.kind === 'relight' && zoneLanternsRestored(o.zone)) n = o.count;   // the zone was restored: lanterns are lit
      return { have: Math.min(n, o.count), need: o.count, done: n >= o.count };
    }
    if (o.type === 'upgrade') {        // v2.0 M1: raise `count` spells to `rank` (default 2) at the Spellwright
      var up = api.rankedSpellCount(o.rank || 2), un = o.count || 1;
      return { have: Math.min(up, un), need: un, done: up >= un };
    }
    return { have: 0, need: 1, done: false };
  };

  api.isReady = function (qid) {
    var q = D().quests[qid];
    if (!q || !api.player.quests.active[qid]) return false;
    for (var i = 0; i < q.objectives.length; i++) if (!api.objectiveProgress(qid, i).done) return false;
    return true;
  };

  var INTERACT_VERB = { relight: 'Relight', default: 'Use' };
  api.objectiveText = function (qid, i) {
    var q = D().quests[qid], o = q.objectives[i], pr = api.objectiveProgress(qid, i);
    if (o.type === 'kill') {
      var e = D().enemies[o.enemy];
      var nm = e ? e.name : o.enemy;
      if (o.count > 1 && !/s$/.test(nm)) nm += 's';
      return 'Defeat ' + (o.count > 1 ? o.count + ' ' : '') + nm + ' (' + pr.have + '/' + pr.need + ')';
    }
    if (o.type === 'collect') {
      var it = D().items[o.item];
      return 'Collect ' + o.count + ' ' + (it ? it.name : o.item) + ' (' + pr.have + '/' + pr.need + ')';
    }
    if (o.type === 'talk') {
      var n = D().npcs[api.resolveNpc(o.npc)];
      return 'Talk to ' + (n ? n.name : o.npc) + (pr.done ? ' ✓' : '');
    }
    if (o.type === 'visit') {
      var z = D().zones[o.zone];
      return 'Travel to ' + (z ? z.name : o.zone) + (pr.done ? ' ✓' : '');
    }
    if (o.type === 'upgrade') {
      return (o.label || ('Upgrade ' + (o.count > 1 ? o.count + ' spells' : 'a spell') + ' to rank ' + (o.rank || 2) + ' at the Spellwright')) + ' (' + pr.have + '/' + pr.need + ')';
    }
    if (o.type === 'interact') {
      return (o.label || ((INTERACT_VERB[o.kind] || INTERACT_VERB.default) + ' ' + o.count + ' ' + (o.kind === 'relight' ? 'lanterns' : 'objects'))) + ' (' + pr.have + '/' + pr.need + ')';
    }
    return '?';
  };

  // Where to go next for a quest (zone hint shown in the tracker)
  api.questHint = function (qid) {
    var q = D().quests[qid];
    if (api.isReady(qid)) return { npc: api.resolveNpc(q.turnIn), zone: api.npcZone(api.resolveNpc(q.turnIn)) };
    for (var i = 0; i < q.objectives.length; i++) {
      if (api.objectiveProgress(qid, i).done) continue;
      var o = q.objectives[i];
      if (o.type === 'kill') return { enemy: o.enemy, zone: api.enemyZone(o.enemy) };
      if (o.type === 'collect') return { item: o.item, zone: api.itemZone(o.item) };
      if (o.type === 'talk') { var n = api.resolveNpc(o.npc); return { npc: n, zone: api.npcZone(n) }; }
      if (o.type === 'visit') return { zone: o.zone };
      if (o.type === 'interact') return { zone: o.zone };
      if (o.type === 'upgrade') { var sw = (D().runeglass || {}).npc || 'spellwright'; return { npc: sw, zone: api.npcZone(sw) }; }
    }
    return {};
  };
  api.npcZone = function (npcId) {
    var Z = D().zones;
    for (var z in Z) if ((Z[z].npcs || []).some(function (n) { return n.id === npcId; })) return z;
    return null;
  };
  api.enemyZone = function (eid) {
    var Z = D().zones;
    for (var z in Z) if ((Z[z].groups || []).some(function (g) { return g.enemies.indexOf(eid) >= 0; })) return z;
    return null;
  };
  api.itemZone = function (itemId) {
    var E = D().enemies;
    for (var e in E) {
      var drops = (E[e].loot && E[e].loot.drops) || [];
      if (drops.some(function (d) { return d.item === itemId; })) return api.enemyZone(e);
    }
    return null;
  };

  api.offersAt = function (npcId) {
    return Object.keys(D().quests).filter(function (qid) {
      var q = D().quests[qid];
      return api.resolveNpc(q.giver) === npcId && api.questState(qid) === 'available';
    });
  };
  api.turnInsAt = function (npcId) {
    return Object.keys(api.player.quests.active).filter(function (qid) {
      var q = D().quests[qid];
      return q && api.resolveNpc(q.turnIn) === npcId && api.isReady(qid);
    });
  };
  api.pendingAt = function (npcId) {
    return Object.keys(api.player.quests.active).filter(function (qid) {
      var q = D().quests[qid];
      return q && api.resolveNpc(q.turnIn) === npcId && !api.isReady(qid);
    });
  };
  api.talkTargetsAt = function (npcId) {
    return Object.keys(api.player.quests.active).filter(function (qid) {
      var q = D().quests[qid];
      return q && q.objectives.some(function (o, i) {
        return o.type === 'talk' && api.resolveNpc(o.npc) === npcId && !api.objectiveProgress(qid, i).done;
      });
    });
  };
  // Does an active quest need interactions of this kind in this zone?
  api.wantsInteract = function (zone, kind) {
    var p = api.player;
    return Object.keys(p.quests.active).some(function (qid) {
      var q = D().quests[qid];
      return q && q.objectives.some(function (o, i) { return o.type === 'interact' && o.zone === zone && o.kind === kind && !api.objectiveProgress(qid, i).done; });
    });
  };

  api.accept = function (qid) {
    var p = api.player;
    if (api.questState(qid) !== 'available') return false;
    p.quests.active[qid] = { kills: {}, talked: {}, visited: {}, accepted: Date.now() };
    api.onVisit(p.zone, true);
    emit('quest', { id: qid, state: 'accepted' });
    api.save();
    return true;
  };

  api.abandon = function (qid) {
    delete api.player.quests.active[qid];
    emit('quest', { id: qid, state: 'abandoned' });
  };

  function progressUpdates(test) {
    var p = api.player, updates = [];
    Object.keys(p.quests.active).forEach(function (qid) {
      var q = D().quests[qid], a = p.quests.active[qid];
      if (!q) return;
      q.objectives.forEach(function (o, i) {
        if (test(o, a)) updates.push({ qid: qid, text: api.objectiveText(qid, i), ready: api.isReady(qid) });
      });
    });
    return updates;
  }

  api.onKill = function (enemyId) {
    var p = api.player, e = D().enemies[enemyId];
    p.stats.kills[enemyId] = (p.stats.kills[enemyId] || 0) + 1;
    // an elite also counts as its base enemy ("Defeat 3 Rot Toads" accepts a Bogmire Brute)
    var ids = [enemyId];
    if (e && e.base && D().enemies[e.base]) ids.push(e.base);
    return progressUpdates(function (o, a) {
      if (o.type !== 'kill' || ids.indexOf(o.enemy) < 0) return false;
      var before = a.kills[o.enemy] || 0;
      if (before >= o.count) return false;
      a.kills[o.enemy] = before + 1;
      return true;
    });
  };

  api.onTalk = function (npcId) {
    return progressUpdates(function (o, a) {
      if (o.type !== 'talk' || api.resolveNpc(o.npc) !== npcId || (a.talked && a.talked[npcId])) return false;
      a.talked = a.talked || {}; a.talked[npcId] = true;
      return true;
    });
  };

  api.onVisit = function (zoneId, silent) {
    api.player.visited[zoneId] = true;
    var u = progressUpdates(function (o, a) {
      if (o.type !== 'visit' || o.zone !== zoneId || (a.visited && a.visited[zoneId])) return false;
      a.visited = a.visited || {}; a.visited[zoneId] = true;
      return true;
    });
    return silent ? [] : u;
  };

  // Interact with a zone prop (e.g. relight a lantern)
  api.onInteract = function (zoneId, propId, kind) {
    var key = zoneId + ':' + propId;
    if (api.player.interacted[key]) return [];
    var relevant = api.wantsInteract(zoneId, kind);
    api.player.interacted[key] = kind;
    if (!relevant) return [];
    return progressUpdates(function (o) { return o.type === 'interact' && o.zone === zoneId && o.kind === kind; });
  };

  api.turnIn = function (qid) {
    var p = api.player, q = D().quests[qid];
    if (!api.isReady(qid)) return null;
    q.objectives.forEach(function (o) { if (o.type === 'collect') api.removeItem(o.item, o.count); });
    delete p.quests.active[qid];
    p.quests.done[qid] = true;
    var r = q.rewards || {}, sum = { xp: r.xp || 0, gold: r.gold || 0, items: r.items || {}, cards: [], tcs: r.tcs || {}, levelUps: [] };
    if (r.gold) api.addGold(r.gold);
    if (r.runeglass) { api.addRuneglass(r.runeglass); sum.runeglass = r.runeglass; }   // v2.0 M1
    // v1.2 WS2 (contract §6.1): quest rewards with `variants` give the player's own school version
    Object.keys(r.items || {}).forEach(function (id) { api.addItem(schoolVariant(id, p.school), r.items[id]); });
    Object.keys(r.tcs || {}).forEach(function (id) { api.addTC(id, r.tcs[id]); });
    (r.cards || []).forEach(function (id) { if (api.learnCard(id, true)) sum.cards.push(id); });
    // ---- v1.2 WS4: boss-earned spells (contract §8): `cardsBySchool` teaches the player's school's spell (deck rules apply)
    var bossSpell = r.cardsBySchool && r.cardsBySchool[p.school];
    if (bossSpell && D().cards[bossSpell] && api.learnCard(bossSpell, true)) sum.cards.push(bossSpell);
    if (r.xp) sum.levelUps = api.addXP(r.xp);
    emit('quest', { id: qid, state: 'done' });
    api.save();
    return sum;
  };

  api.activeQuestIds = function () {
    var order = Object.keys(D().quests);
    return Object.keys(api.player.quests.active).filter(function (q) { return D().quests[q]; })
      .sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  };

  api.meets = function (req) {
    if (!req) return true;
    if (req.quest && !api.player.quests.done[req.quest]) return false;
    if (req.level && api.player.level < req.level) return false;
    if (req.dungeon && api.missingDungeons(req).length) return false;     // v2.1: the world-exit gate
    return true;
  };

  // ---- v2.1 PROGRESSION GATE (Jorge, Oct 20): "you have to complete [the dungeon] once and then you
  // can continue to the next worlds". A portal / zone `requires: { dungeon: 'hollow_orrery' }` (or a
  // list of ids) is met once the wizard has fully cleared it (the final boss fell): world.js
  // W.dungeon records that via recordDungeonClear(). Saved per wizard: p.dungeonsCleared { id: count }.
  api.dungeonClears = function (dungeonId, p) {
    p = p || api.player;
    var d = p && isObj(p.dungeonsCleared) ? p.dungeonsCleared[dungeonId] : 0;
    return d > 0 ? Math.floor(d) : 0;
  };
  api.missingDungeons = function (req) {
    var ids = !req || !req.dungeon ? [] : (Array.isArray(req.dungeon) ? req.dungeon : [req.dungeon]);
    return ids.filter(function (id) { return !api.dungeonClears(id); });
  };
  api.recordDungeonClear = function (dungeonId) {
    var p = api.player;
    if (!p || !dungeonId || badKey(dungeonId)) return 0;
    if (!isObj(p.dungeonsCleared)) p.dungeonsCleared = {};
    var n = Math.min(MAX_NUM, api.dungeonClears(dungeonId) + 1);
    p.dungeonsCleared[dungeonId] = n;
    emit('dungeon', { id: dungeonId, count: n, first: n === 1 });
    return n;
  };

  // =====================================================================
  //  v2.0 M1 (WS-A): RUNEGLASS + SPELLWRIGHT  (game/data/runeglass.js)
  //  Save fields (V2.0-CONTRACT §9): p.runeglass (number), p.spellRanks
  //  { cardId: { path: 'a'|'b', rank: 2..5 } }. Rank 1 (base) is never stored.
  // =====================================================================
  function RG() { return D().runeglass || null; }
  // Old saves: add the fields; a wizard who already freed bosses before
  // v2.0 gets those bosses' first-victory Runeglass once (field missing =
  // never migrated). Unknown cards / bad paths / ranks are dropped or clamped.
  api.migrateSchools = function (p) {
    var R = RG(), fresh = !(typeof p.runeglass === 'number' && isFinite(p.runeglass));
    p.runeglass = fresh ? 0 : Math.max(0, Math.min(MAX_NUM, Math.floor(p.runeglass)));
    if (fresh && R && R.drops && p.stats && p.stats.kills) {
      Object.keys(R.drops).forEach(function (eid) { if ((p.stats.kills[eid] || 0) > 0) p.runeglass += R.drops[eid].first || 0; });
    }
    var src = obj(p.spellRanks), out = {}, max = (R && R.maxRank) || 5;
    Object.keys(src).forEach(function (id) {
      var r = src[id], c = D().cards[id];
      if (!c || !r || (r.path !== 'a' && r.path !== 'b') || (R && !R.eligible(c))) return;
      var n = Math.max(1, Math.min(max, Math.floor(num(r.rank, 1))));
      if (n > 1) out[id] = { path: r.path, rank: n };
    });
    p.spellRanks = out;
    return p;
  };
  api.runeglass = function () { return (api.player && api.player.runeglass) || 0; };
  api.addRuneglass = function (n) {
    var p = api.player; if (!p) return 0;
    p.runeglass = Math.max(0, Math.min(MAX_NUM, (p.runeglass || 0) + Math.round(n || 0)));
    emit('runeglass', { n: n, total: p.runeglass });
    return p.runeglass;
  };
  // Runeglass dropped by one defeated enemy. The first victory over a boss pays
  // `first` (combatView counts the kill AFTER rolling loot, so kills 0 = first).
  api.rollRuneglass = function (eid, rng) {
    var R = RG(), d = R && R.drops && R.drops[eid];
    if (!d) return 0;
    rng = rng || Math.random;
    var p = api.player, firstWin = !!(p && p.stats && p.stats.kills && !(p.stats.kills[eid] > 0));
    if (firstWin && d.first) return d.first;
    if (rng() >= (d.chance || 0)) return 0;
    var n = d.n || [1, 1];
    return n[0] + Math.floor(rng() * (n[1] - n[0] + 1));
  };
  api.spellRank = function (cardId) {
    var r = api.player && api.player.spellRanks && api.player.spellRanks[cardId];
    return r ? { path: r.path, rank: r.rank } : { path: null, rank: 1 };
  };
  // v2.1 A1: the card exactly as THIS wizard casts it, for every place a card is drawn
  // (hand, deck editor, spellbook, Spellwright, rewards, cinematics). Pure data, no DOM.
  //   -> { card (ranked copy, or the base card), base, rank (1..max), max, path, pathName,
  //        pathColor, pathText ("Empower: +9% damage"), ranked (bool) }
  // opts.ranks overrides the wizard's p.spellRanks (a party seat's own ranks in co-op).
  api.cardView = function (cardId, opts) {
    opts = opts || {};
    var base = D().cards[cardId], R = RG(), p = api.player;
    var max = (R && R.maxRank) || 5;
    var out = { card: base || null, base: base || null, rank: 1, max: max, path: null, pathName: '', pathColor: '', pathText: '', ranked: false };
    if (!base || !R) return out;
    var ranks = opts.ranks || (p && p.spellRanks) || {}, info = ranks[cardId];
    if (!info || !(info.rank > 1) || (info.path !== 'a' && info.path !== 'b')) return out;
    var school = opts.school || (p && p.school), Bt = WF.Battle;
    var def = R.pathFor(base, info.path, school);
    if (!def || !Bt || typeof Bt.rankCard !== 'function') return out;
    var rank = Math.min(max, info.rank);
    out.card = Bt.rankCard(base, { path: info.path, rank: rank }, R, school);
    out.rank = rank; out.path = info.path; out.ranked = true;
    out.pathName = def.name || ''; out.pathColor = def.color || '#9fe6ff';
    out.pathText = R.describe(base, info.path, rank, school);
    return out;
  };
  api.rankedSpellCount = function (minRank) {
    var sr = (api.player && api.player.spellRanks) || {};
    return Object.keys(sr).filter(function (id) { return sr[id].rank >= (minRank || 2); }).length;
  };
  // Known spells the Spellwright can work on: own school first, boss spells last.
  api.upgradeableSpells = function () {
    var R = RG(), p = api.player;
    if (!R || !p) return [];
    return p.known.filter(function (id) { return R.eligible(D().cards[id]); }).sort(function (a, b) {
      var A = D().cards[a], B = D().cards[b];
      return ((A.source === 'boss') - (B.source === 'boss')) || ((A.school === p.school ? 0 : 1) - (B.school === p.school ? 0 : 1)) ||
        ((A.level || 0) - (B.level || 0)) || ((A.pips || 0) - (B.pips || 0));
    });
  };
  // Raise cardId one rank along `path` ('a'|'b'). The first upgrade picks the path.
  api.canUpgradeSpell = function (cardId, path) {
    var R = RG(), p = api.player, c = D().cards[cardId];
    if (!R || !p) return { ok: false, reason: 'No Spellwright here' };
    if (!c || !R.eligible(c)) return { ok: false, reason: 'This spell can\'t be upgraded' };
    if (p.known.indexOf(cardId) < 0) return { ok: false, reason: 'You don\'t know this spell' };
    if (path !== 'a' && path !== 'b') return { ok: false, reason: 'Pick a path' };
    var cur = api.spellRank(cardId);
    if (cur.path && cur.path !== path) return { ok: false, reason: 'Locked: this spell follows the ' + R.pathFor(c, cur.path, p.school).name + ' path (reset it to switch)' };
    if (cur.rank >= R.maxRank) return { ok: false, reason: 'Already at rank ' + R.maxRank };
    var cost = R.stepCost(cur.rank + 1);
    if ((p.runeglass || 0) < cost) return { ok: false, reason: 'Needs ' + cost + ' Runeglass', cost: cost };
    return { ok: true, cost: cost, rank: cur.rank + 1 };
  };
  api.upgradeSpell = function (cardId, path) {
    var ok = api.canUpgradeSpell(cardId, path);
    if (!ok.ok) return false;
    var p = api.player;
    p.runeglass -= ok.cost;
    p.spellRanks[cardId] = { path: path, rank: ok.rank };
    emit('spellRank', { card: cardId, path: path, rank: ok.rank });
    api.save();
    return true;
  };
  // Reset a spell to rank 1: costs gold per rank, refunds every Runeglass spent on it.
  api.resetCost = function (cardId) {
    var R = RG(), cur = api.spellRank(cardId);
    return { gold: R ? (cur.rank - 1) * (R.resetGoldPerRank || 0) : 0, refund: R ? R.spentTo(cur.rank) : 0 };
  };
  api.canResetSpell = function (cardId) {
    var cur = api.spellRank(cardId), c = api.resetCost(cardId);
    if (cur.rank <= 1) return { ok: false, reason: 'Nothing to reset' };
    if (api.player.gold < c.gold) return { ok: false, reason: 'Needs ' + c.gold + ' gold' };
    return { ok: true, gold: c.gold, refund: c.refund };
  };
  api.resetSpell = function (cardId) {
    var ok = api.canResetSpell(cardId);
    if (!ok.ok) return false;
    var p = api.player;
    api.addGold(-ok.gold);
    p.runeglass += ok.refund;
    delete p.spellRanks[cardId];
    emit('spellRank', { card: cardId, path: null, rank: 1 });
    api.save();
    return true;
  };

  // ---- v1.2 WS3: deck items never go into the backpack ----
  // Every way of getting an item (shop, loot, quest reward, crafting) ends in
  // addItem; a deck item goes to p.decks instead (unique; a spare becomes gold).
  // You can't buy or craft a deck you already own.
  (function () {
    var baseAddItem = api.addItem, baseCanBuy = api.canBuy, baseCanCraft = api.canCraft;
    api.addItem = function (id, n) {
      if (api.player && deckItem(id)) { api.gainDeck(id, n || 1); return; }
      return baseAddItem.apply(api, arguments);
    };
    api.canBuy = function (id) {
      if (api.player && deckItem(id) && api.ownsDeck(id)) return { ok: false, reason: 'Already in your spellbook' };
      return baseCanBuy.apply(api, arguments);
    };
    api.canCraft = function (rid) {
      var r = (D().recipes || {})[rid], mk = r && r.makes && r.makes.item;
      if (api.player && mk && deckItem(mk) && api.ownsDeck(mk)) return { ok: false, reason: 'You already own the ' + deckItem(mk).name };
      return baseCanCraft.apply(api, arguments);
    };
  })();

  return api;
})();
