// =====================================================================
//  WIZZIE FARM — PETS: rules engine (v2.0 M2, WS-B)
//  Design: docs/design/pets.md · Data: game/data/pets.js · Contract: docs/V2.0-CONTRACT.md §3, §9
//
//  Pure logic (no THREE, no DOM) so tests/pets.test.js and tests/pet-sim.js run it in Node.
//  Two halves:
//   1. PET RULES on plain pet objects: pools, growth stages, pick-1-of-2 talents, talent
//      values, pet cards, breeding (rarity + pool inheritance), egg / snack drops.
//   2. THE WIZARD'S PETS (needs WF.state): equip, feed, starter shop, incubator, breeding
//      (also with pets in the shared Vault), appraisal, training ring, bank, save migration,
//      and the hooks that feed pets into the game:
//        WF.state.stats()          + the equipped pet's talents (the gear stat pipeline, caps kept)
//        WF.state.battleLoadout()  + the equipped pet's cards (on top of the deck size limit)
//        WF.state.rollLoot()       + egg and snack drops, pet XP for the duel
//        WF.state.applyLoot()      eggs go to your pets, the equipped pet gets the XP
//      They WRAP the state.js functions (no edit of another workstream's code), and they are
//      no-ops for a wizard without an equipped pet.
//
//  Save (V2.0-CONTRACT §9):  p.pets[]  p.activePet (uid|null)  p.hatchery { slots[], cooldowns{} }
//                            account.bank.pets[]  (state.js: bankPets() / petBankTxn())
//  A pet: { uid, species, name, rarity, xp, stage (0 Baby .. 5 Mega), pool[talentId],
//           talents[learned, in order], seen[talentIds shown in offers], offer {stage, choices[2]}|null,
//           egg (true until hatched), gen, parents [speciesA, speciesB]|null, born, restUntil, appraised }
// =====================================================================
window.WF = window.WF || { data: {} };

WF.pets = (function () {
  'use strict';
  var PT = {};
  var ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  PT.RARITIES = ORDER;
  function D() { return WF.data; }
  function PD() { return WF.data.pets; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  PT.clock = function () { return Date.now(); };          // tests and the sim replace this
  function now() { return PT.clock(); }
  var listeners = [];
  PT.on = function (fn) { listeners.push(fn); };
  function emit(type, e) { listeners.forEach(function (fn) { try { fn(type, e || {}); } catch (x) { if (typeof console !== 'undefined') console.error(x); } }); }

  PT.rarIdx = function (r) { var i = ORDER.indexOf(r); return i < 0 ? 0 : i; };
  PT.rarity = function (r) { return PD().rarity[r] || PD().rarity.common; };
  PT.rarityName = function (r) { var R = (D().rarities || {})[r]; return R ? R.name : (r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Common'); };
  PT.rarityColor = function (r) { var R = (D().rarities || {})[r]; return (R && R.color) || '#d8d8d8'; };
  PT.species = function (id) { return has(PD().species, id) ? PD().species[id] : null; };
  PT.talent = function (id) { return has(PD().talents, id) ? PD().talents[id] : null; };
  PT.stages = function () { return PD().stages; };
  PT.maxStage = function () { return PD().stages.length - 1; };

  var uidN = 0;
  PT.newUid = function (rng) {
    uidN = (uidN + 1) % 1e6;
    return 'pet' + now().toString(36) + (uidN).toString(36) + Math.floor((rng || Math.random)() * 1e9).toString(36);
  };

  // Weighted pick of one key from {key: weight} (keys in `skip` excluded). null if empty.
  function wpick(weights, rng, skip) {
    var keys = Object.keys(weights).filter(function (k) { return !(skip && skip[k]) && weights[k] > 0; }), tot = 0;
    keys.forEach(function (k) { tot += weights[k]; });
    if (!keys.length || tot <= 0) return null;
    var x = rng() * tot;
    for (var i = 0; i < keys.length; i++) { x -= weights[keys[i]]; if (x < 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  PT.wpick = wpick;

  // ------------------------------------------------------------------
  // 1. PET RULES
  // ------------------------------------------------------------------
  // A fresh talent pool from the species' list (weighted, no repeats)
  PT.rollPool = function (speciesId, rng) {
    rng = rng || Math.random;
    var sp = PT.species(speciesId), size = PD().breeding.poolSize, out = [], used = {};
    if (!sp) return out;
    while (out.length < size) {
      var t = wpick(sp.pool, rng, used);
      if (!t) break;
      used[t] = true; out.push(t);
    }
    return out;
  };

  PT.makePet = function (speciesId, rarity, o) {
    o = o || {};
    var rng = o.rng || Math.random, sp = PT.species(speciesId);
    if (!sp) return null;
    return {
      uid: PT.newUid(rng), species: speciesId, name: o.name || sp.name, rarity: ORDER.indexOf(rarity) >= 0 ? rarity : 'common',
      xp: 0, stage: 0, pool: o.pool ? o.pool.slice() : PT.rollPool(speciesId, rng), talents: [], seen: [], offer: null,
      egg: !!o.egg, gen: o.gen || 1, parents: o.parents || null, born: now(), restUntil: 0, appraised: false
    };
  };

  // stage index reached by an amount of XP (ignores pending offers)
  PT.stageForXp = function (xp) {
    var S = PD().stages, s = 0;
    for (var i = 0; i < S.length; i++) if (xp >= S[i].xp) s = i;
    return s;
  };
  PT.stageOf = function (pet) { return PD().stages[Math.max(0, Math.min(PT.maxStage(), pet.stage | 0))]; };
  PT.nextStage = function (pet) { return pet.stage < PT.maxStage() ? PD().stages[pet.stage + 1] : null; };
  PT.isMega = function (pet) { return pet.stage >= PT.maxStage(); };

  // Grow: stage up while the XP allows and no talent pick is waiting. Each new stage offers 2
  // unlearned talents from the pool (the player picks one, PT.pick). Returns the stages reached.
  PT.grow = function (pet, rng) {
    var ups = [];
    if (!pet || pet.egg) return ups;
    while (!pet.offer && pet.stage < PT.maxStage() && pet.xp >= PD().stages[pet.stage + 1].xp) {
      pet.stage++;
      ups.push(pet.stage);
      PT.makeOffer(pet, rng);
    }
    return ups;
  };
  PT.addXp = function (pet, n, rng) {
    if (!pet || pet.egg) return [];
    var cap = PD().stages[PT.maxStage()].xp;
    pet.xp = Math.min(cap, Math.max(0, Math.round((pet.xp || 0) + (n || 0))));
    return PT.grow(pet, rng);
  };
  PT.unlearned = function (pet) { return pet.pool.filter(function (t) { return pet.talents.indexOf(t) < 0 && PT.talent(t); }); };
  PT.makeOffer = function (pet, rng) {
    rng = rng || Math.random;
    var left = PT.unlearned(pet), choices = [];
    while (left.length && choices.length < 2) choices.push(left.splice(Math.floor(rng() * left.length) % left.length, 1)[0]);
    if (!choices.length) { pet.offer = null; return null; }
    pet.offer = { stage: pet.stage, choices: choices };
    choices.forEach(function (t) { if (pet.seen.indexOf(t) < 0) pet.seen.push(t); });
    return pet.offer;
  };
  // Learn one of the two offered talents. -> { ok, reason }
  PT.pick = function (pet, talentId, rng) {
    if (!pet || !pet.offer) return { ok: false, reason: 'No talent to choose right now' };
    if (pet.offer.choices.indexOf(talentId) < 0) return { ok: false, reason: 'That talent was not offered' };
    pet.talents.push(talentId);
    pet.offer = null;
    PT.grow(pet, rng);                 // XP banked while waiting may reach the next stage
    return { ok: true };
  };

  PT.rankOf = function (pet) { return PT.rarity(pet.rarity).rankCap; };
  // One talent's value for a wizard (school + natural max HP at their level). 0 if it does not apply.
  // v2.0 retune: a `ramp` talent (flat health, flat damage) grows with the WIZARD's level from
  // levelRamp.at1 of its value at L1 to 100 % at levelRamp.full, then stays flat. So a perfect
  // pet is ~2x at L1 and at L10, and fades towards ~1.2x by L60 as spells and gear keep growing
  // (pets.md "v2.0 retune"; tests/pet-sim.js projects L60). No level given = full value.
  PT.rampAt = function (level) {
    var R = PD().levelRamp;
    if (!R || level == null) return 1;
    var L = Math.max(1, Math.min(R.full, +level || 1));
    return R.at1 + (1 - R.at1) * (L - 1) / Math.max(1, R.full - 1);
  };
  PT.talentValue = function (tid, pet, ctx) {
    var t = PT.talent(tid);
    if (!t) return 0;
    ctx = ctx || {};
    if (t.school && ctx.school && t.school !== ctx.school) return 0;
    var r = Math.max(1, Math.min(t.ranks.length, PT.rankOf(pet)));
    var v = t.ranks[r - 1];
    if (t.ramp) v = Math.round(v * PT.rampAt(ctx.level));
    if (t.natural && ctx.naturalHp) v = Math.max(v, Math.round(ctx.naturalHp * t.natural * (r / t.ranks.length)));
    return v;
  };
  // Every stat the pet gives (gear units: dmg 10 = +10 %; flatDmg in whole damage points),
  // for a wizard of `school` at `level` (level: optional, see rampAt).
  PT.STAT_KEYS = ['hp', 'mana', 'dmg', 'resist', 'acc', 'brightPip', 'pipSurge', 'flatDmg'];
  PT.bonus = function (pet, school, naturalHp, level) {
    var out = { lines: [] };
    PT.STAT_KEYS.forEach(function (k) { out[k] = 0; });
    if (!pet || pet.egg) return out;
    pet.talents.forEach(function (tid) {
      var t = PT.talent(tid);
      if (!t) return;
      var v = PT.talentValue(tid, pet, { school: school, naturalHp: naturalHp, level: level });
      var full = PT.talentValue(tid, pet, { naturalHp: naturalHp, level: level });
      out[t.stat] += v;
      out.lines.push({ id: tid, name: t.name, stat: t.stat, value: full, active: v > 0, school: t.school || null });
    });
    return out;
  };

  // Pet cards: count by rarity, rank by stage (I Baby/Teen, II Adult..Epic, III Mega)
  PT.cardsOf = function (pet) {
    if (!pet || pet.egg) return [];
    var sp = PT.species(pet.species), n = PT.rarity(pet.rarity).cards, rank = PT.stageOf(pet).cardRank || 1;
    if (!sp || !sp.cardIds) return [];
    return sp.cardIds.slice(0, n).map(function (ids) { return ids[Math.min(ids.length, rank) - 1]; }).filter(function (id) { return D().cards[id]; });
  };

  // ---- Breeding ----
  // Rarity odds of a baby: { rarityId: probability }
  PT.rarityOdds = function (a, b) {
    var B = PD().breeding, ia = PT.rarIdx(a.rarity), ib = PT.rarIdx(b.rarity), lo = Math.min(ia, ib), out = {};
    var up = lo < ORDER.length - 1 ? (ia === ib ? B.rollUpSame : B.rollUp) : 0, down = lo > 0 ? B.rollDown : 0;
    out[ORDER[lo]] = 1 - up - down;
    if (up) out[ORDER[lo + 1]] = up;
    if (down) out[ORDER[lo - 1]] = down;
    return out;
  };
  PT.babyRarity = function (a, b, rng) {
    var odds = PT.rarityOdds(a, b), x = (rng || Math.random)(), keys = Object.keys(odds).sort(function (p, q) { return PT.rarIdx(q) - PT.rarIdx(p); });
    for (var i = 0; i < keys.length; i++) { x -= odds[keys[i]]; if (x < 0) return keys[i]; }
    return ORDER[Math.min(PT.rarIdx(a.rarity), PT.rarIdx(b.rarity))];
  };
  // The baby's pool: each slot is a weighted draw from both parents' pools (a talent both carry
  // counts sharedWeight times) or, with the mutation chance, a random talent of the baby's species.
  PT.inheritPool = function (a, b, babySpecies, rng) {
    rng = rng || Math.random;
    var B = PD().breeding, w = {}, used = {}, out = [], sp = PT.species(babySpecies);
    a.pool.forEach(function (t) { if (PT.talent(t)) w[t] = 1; });
    b.pool.forEach(function (t) { if (PT.talent(t)) w[t] = w[t] ? B.sharedWeight : 1; });
    while (out.length < B.poolSize) {
      var t = null;
      if (rng() < B.mutation && sp) t = wpick(sp.pool, rng, used);
      if (!t) t = wpick(w, rng, used);
      if (!t && sp) t = wpick(sp.pool, rng, used);
      if (!t) break;
      used[t] = true; out.push(t);
    }
    return out;
  };
  // A new egg from two parents (pure; nothing else changes). Both must be hatched pets.
  PT.offspring = function (a, b, rng) {
    rng = rng || Math.random;
    var species = rng() < PD().breeding.speciesFromA ? a.species : b.species;
    var rarity = PT.babyRarity(a, b, rng);
    var pool = PT.inheritPool(a, b, species, rng);
    return PT.makePet(species, rarity, { rng: rng, pool: pool, egg: true, gen: Math.max(a.gen || 1, b.gen || 1) + 1, parents: [a.species, b.species] });
  };
  PT.hatchFee = function (a, b) { return PT.rarity(ORDER[Math.min(PT.rarIdx(a.rarity), PT.rarIdx(b.rarity))]).hatchFee; };
  PT.incubateMs = function (rarity) { return PT.rarity(rarity).incubate * 60000; };
  // talents both parents are known to carry (learned / seen / appraised) - shown in the hatchery
  PT.knownPool = function (pet) { return pet.appraised ? pet.pool.slice() : pet.pool.filter(function (t) { return pet.talents.indexOf(t) >= 0 || pet.seen.indexOf(t) >= 0; }); };

  // ---- Drops ----
  // Eggs from a list of defeated enemy ids -> [{ species, rarity, from }]
  PT.rollEggs = function (enemyIds, rng) {
    rng = rng || Math.random;
    var out = [];
    (enemyIds || []).forEach(function (eid) {
      var e = D().enemies[eid], L = e && e.loot && e.loot.eggs, T = L && PD().eggTables[L.table];
      if (!T || !(L.species || []).length) return;
      var chance = L.chance != null ? L.chance : T.chance;
      if (!(rng() < chance)) return;
      var sid = L.species[Math.floor(rng() * L.species.length) % L.species.length];
      var r = wpick(T.rarity, rng) || 'common';
      if (PT.species(sid)) out.push({ species: sid, rarity: r, from: eid });
    });
    return out;
  };
  PT.enemyKind = function (e) { return e.boss ? 'boss' : (e.elite ? 'elite' : 'mob'); };
  PT.rollSnacks = function (enemyIds, rng) {
    rng = rng || Math.random;
    var out = {};
    (enemyIds || []).forEach(function (eid) {
      var e = D().enemies[eid];
      if (!e) return;
      (PD().snackDrops[PT.enemyKind(e)] || []).forEach(function (d) { if (D().items[d.item] && rng() < d.chance) out[d.item] = (out[d.item] || 0) + 1; });
    });
    return out;
  };
  PT.duelXpFor = function (enemyIds) {
    var X = PD().duelXp, xp = 0;
    (enemyIds || []).forEach(function (eid) {
      var e = D().enemies[eid];
      if (!e) return;
      xp += (X.perEnemy + X.perLevel * (e.level || 1)) * (e.boss ? X.bossMult : (e.elite ? X.eliteMult : 1));
    });
    return Math.round(xp);
  };
  PT.snackXp = function (itemId) { var it = D().items[itemId]; return (it && it.snack) || 0; };

  // ---- Save repair (V2.0-CONTRACT §9) ----
  // Sanitise one pet; null when it can't be a pet of this game version.
  PT.cleanPet = function (x) {
    if (!isObj(x) || !PT.species(x.species)) return null;
    var T = PD().talents, ms = PT.maxStage();
    var pet = {
      uid: typeof x.uid === 'string' && x.uid ? x.uid.slice(0, 40) : PT.newUid(),
      species: x.species,
      name: Array.from(String(x.name || PT.species(x.species).name).replace(/[<>&"]/g, '')).slice(0, 18).join('') || PT.species(x.species).name,
      rarity: ORDER.indexOf(x.rarity) >= 0 ? x.rarity : 'common',
      xp: Math.max(0, Math.min(PD().stages[ms].xp, Math.floor(num(x.xp, 0)))),
      stage: Math.max(0, Math.min(ms, Math.floor(num(x.stage, 0)))),
      pool: [], talents: [], seen: [], offer: null,
      egg: !!x.egg, gen: Math.max(1, Math.min(999, Math.floor(num(x.gen, 1)))),
      parents: Array.isArray(x.parents) ? x.parents.filter(function (s) { return PT.species(s); }).slice(0, 2) : null,
      born: num(x.born, 0), restUntil: Math.max(0, num(x.restUntil, 0)), appraised: !!x.appraised
    };
    (Array.isArray(x.pool) ? x.pool : []).forEach(function (t) { if (has(T, t) && pet.pool.indexOf(t) < 0) pet.pool.push(t); });
    if (!pet.pool.length) pet.pool = PT.rollPool(pet.species);
    (Array.isArray(x.talents) ? x.talents : []).forEach(function (t) { if (pet.pool.indexOf(t) >= 0 && pet.talents.indexOf(t) < 0) pet.talents.push(t); });
    pet.talents = pet.talents.slice(0, ms);
    (Array.isArray(x.seen) ? x.seen : []).forEach(function (t) { if (pet.pool.indexOf(t) >= 0 && pet.seen.indexOf(t) < 0) pet.seen.push(t); });
    if (pet.parents && !pet.parents.length) pet.parents = null;
    if (pet.egg) { pet.stage = 0; pet.xp = 0; pet.talents = []; }
    // a talent is learned at every stage after Baby: the stage can't run ahead of the picks + 1 pending offer
    pet.stage = Math.min(pet.stage, pet.talents.length + 1);
    if (isObj(x.offer) && Array.isArray(x.offer.choices) && pet.stage > pet.talents.length) {
      var ch = x.offer.choices.filter(function (t) { return pet.pool.indexOf(t) >= 0 && pet.talents.indexOf(t) < 0; }).slice(0, 2);
      if (ch.length) pet.offer = { stage: pet.stage, choices: ch };
    }
    if (pet.stage > pet.talents.length && !pet.offer && !pet.egg) PT.makeOffer(pet);
    if (!pet.offer && pet.stage < pet.talents.length) pet.stage = pet.talents.length;
    return pet;
  };
  // The wizard's pet fields; old saves (v4) get empty ones. Idempotent.
  PT.migrate = function (p) {
    if (!isObj(p)) return p;
    var seen = {};
    p.pets = (Array.isArray(p.pets) ? p.pets : []).map(PT.cleanPet).filter(function (x) {
      if (!x || seen[x.uid]) return false;
      seen[x.uid] = true; return true;
    }).slice(0, PD().maxPets);
    var hz = isObj(p.hatchery) ? p.hatchery : {};
    var slots = (Array.isArray(hz.slots) ? hz.slots : []).map(function (s) {
      if (!isObj(s)) return null;
      var pet = PT.cleanPet(s.pet);
      if (!pet || seen[pet.uid]) return null;
      seen[pet.uid] = true; pet.egg = true;
      return { pet: pet, readyAt: Math.max(0, num(s.readyAt, 0)), kind: s.kind === 'bred' ? 'bred' : 'egg' };
    }).filter(Boolean).slice(0, PD().incubatorSlots);
    var cd = {};
    if (isObj(hz.cooldowns)) Object.keys(hz.cooldowns).forEach(function (k) { if (k !== '__proto__' && isFinite(Number(hz.cooldowns[k]))) cd[k] = Number(hz.cooldowns[k]); });
    p.hatchery = { slots: slots, cooldowns: cd };
    var act = p.pets.filter(function (x) { return x.uid === p.activePet && !x.egg; })[0];
    p.activePet = act ? act.uid : null;
    return p;
  };
  PT.cleanBankPets = function (list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).map(PT.cleanPet).filter(function (x) { if (!x || seen[x.uid]) return false; seen[x.uid] = true; return true; }).slice(0, PD().bankPets);
  };

  // ------------------------------------------------------------------
  // 2. THE WIZARD'S PETS (WF.state.player)
  // ------------------------------------------------------------------
  function S() { return WF.state; }
  function P() { var s = S(), p = s && s.player; if (p && (!Array.isArray(p.pets) || !isObj(p.hatchery))) PT.migrate(p); return p; }
  PT.player = P;
  PT.list = function () { var p = P(); return p ? p.pets : []; };
  PT.get = function (uid) { return PT.list().filter(function (x) { return x.uid === uid; })[0] || null; };
  PT.active = function () { var p = P(); return p && p.activePet ? PT.get(p.activePet) : null; };
  PT.hatched = function () { return PT.list().filter(function (x) { return !x.egg; }); };
  PT.eggs = function () { return PT.list().filter(function (x) { return x.egg; }); };
  PT.room = function () { var p = P(); return p ? PD().maxPets - p.pets.length : 0; };
  function save() { try { if (S() && S().save) S().save(); } catch (e) { /* storage blocked */ } }
  function vitals() { try { if (S().clampVitals) S().clampVitals(); } catch (e) { /* no player */ } }
  function naturalHp(p) { try { return S().baseVitals(p.school, p.level).hp; } catch (e) { return 0; } }
  PT.naturalHp = naturalHp;
  // what the equipped pet gives the current wizard right now
  PT.activeBonus = function () { var p = P(), pet = PT.active(); return pet ? PT.bonus(pet, p.school, naturalHp(p), p.level) : PT.bonus(null); };

  PT.equip = function (uid) {
    var p = P(), pet = PT.get(uid);
    if (!pet || pet.egg) return { ok: false, reason: pet ? 'Hatch it first' : 'No such pet' };
    p.activePet = uid; vitals(); save(); emit('equip', { uid: uid });
    return { ok: true };
  };
  PT.unequip = function () { var p = P(); if (!p || !p.activePet) return { ok: false }; p.activePet = null; vitals(); save(); emit('equip', { uid: null }); return { ok: true }; };

  // XP for one pet (snacks / training / duels). Returns the stages reached.
  PT.giveXp = function (uid, n, rng) {
    var pet = PT.get(uid);
    if (!pet || pet.egg) return [];
    var ups = PT.addXp(pet, n, rng);
    vitals();
    emit('xp', { uid: uid, xp: n, stages: ups });
    return ups;
  };
  PT.canFeed = function (uid, snackId) {
    var pet = PT.get(uid), p = P();
    if (!pet) return { ok: false, reason: 'No such pet' };
    if (pet.egg) return { ok: false, reason: 'Eggs don’t eat (yet)' };
    if (!PT.snackXp(snackId)) return { ok: false, reason: 'That is not a snack' };
    if (!(p.inventory[snackId] > 0)) return { ok: false, reason: 'You have no ' + D().items[snackId].name };
    if (PT.isMega(pet)) return { ok: false, reason: pet.name + ' is fully grown' };
    return { ok: true };
  };
  PT.feed = function (uid, snackId) {
    var c = PT.canFeed(uid, snackId);
    if (!c.ok) return c;
    S().removeItem(snackId, 1);
    var ups = PT.giveXp(uid, PT.snackXp(snackId));
    save();
    return { ok: true, xp: PT.snackXp(snackId), stages: ups };
  };
  PT.pickTalent = function (uid, tid) {
    var pet = PT.get(uid);
    var r = PT.pick(pet, tid);
    if (r.ok) { vitals(); save(); emit('talent', { uid: uid, talent: tid }); }
    return r;
  };
  PT.rename = function (uid, name) {
    var pet = PT.get(uid);
    if (!pet) return false;
    var n = Array.from(String(name || '').replace(/[<>&"]/g, '').trim()).slice(0, 18).join('');
    pet.name = n || PT.species(pet.species).name;
    save(); emit('rename', { uid: uid });
    return true;
  };
  PT.canRelease = function (uid) {
    var pet = PT.get(uid);
    if (!pet) return { ok: false, reason: 'No such pet' };
    if (P().activePet === uid) return { ok: false, reason: 'Unequip it first' };
    return { ok: true };
  };
  PT.release = function (uid) {
    if (!PT.canRelease(uid).ok) return false;
    var p = P(); p.pets = p.pets.filter(function (x) { return x.uid !== uid; });
    save(); emit('release', { uid: uid });
    return true;
  };

  // ---- Starter shop (Common only, no cards) ----
  PT.starters = function () { return Object.keys(PD().species).filter(function (id) { return PD().species[id].starter > 0; }); };
  PT.canBuyStarter = function (sid) {
    var sp = PT.species(sid), p = P();
    if (!sp || !(sp.starter > 0)) return { ok: false, reason: 'Not for sale' };
    if (PT.room() <= 0) return { ok: false, reason: 'You can’t carry more pets (' + PD().maxPets + ')' };
    if (p.gold < sp.starter) return { ok: false, reason: 'Not enough gold' };
    return { ok: true };
  };
  PT.buyStarter = function (sid, rng) {
    var c = PT.canBuyStarter(sid);
    if (!c.ok) return c;
    var p = P(), pet = PT.makePet(sid, PD().starterRarity, { rng: rng });
    S().addGold(-PT.species(sid).starter);
    p.pets.push(pet);
    if (!p.activePet) p.activePet = pet.uid;
    vitals(); save(); emit('new', { uid: pet.uid, from: 'shop' });
    return { ok: true, pet: pet };
  };

  // ---- Incubator (eggs from drops, babies from breeding) ----
  PT.slots = function () { var p = P(); return p ? p.hatchery.slots : []; };
  PT.freeSlot = function () { return PT.slots().length < PD().incubatorSlots; };
  PT.slotReady = function (s) { return !!s && now() >= s.readyAt; };
  PT.canIncubate = function (uid) {
    var pet = PT.get(uid);
    if (!pet || !pet.egg) return { ok: false, reason: 'Not an egg' };
    if (!PT.freeSlot()) return { ok: false, reason: 'Both incubator nests are busy' };
    return { ok: true };
  };
  PT.incubate = function (uid) {
    var c = PT.canIncubate(uid);
    if (!c.ok) return c;
    var p = P(), pet = PT.get(uid);
    p.pets = p.pets.filter(function (x) { return x.uid !== uid; });
    var slot = { pet: pet, readyAt: now() + PT.incubateMs(pet.rarity), kind: 'egg' };
    p.hatchery.slots.push(slot);
    save(); emit('incubate', { uid: uid });
    return { ok: true, slot: slot };
  };
  PT.canCollect = function (i) {
    var s = PT.slots()[i];
    if (!s) return { ok: false, reason: 'Empty nest' };
    if (!PT.slotReady(s)) return { ok: false, reason: 'Still incubating' };
    if (PT.room() <= 0) return { ok: false, reason: 'You can’t carry more pets (' + PD().maxPets + ')' };
    return { ok: true };
  };
  PT.collect = function (i) {
    var c = PT.canCollect(i);
    if (!c.ok) return c;
    var p = P(), s = p.hatchery.slots.splice(i, 1)[0], pet = s.pet;
    pet.egg = false; pet.born = now();
    p.pets.push(pet);
    if (!p.activePet) p.activePet = pet.uid;
    vitals(); save(); emit('new', { uid: pet.uid, from: s.kind });
    return { ok: true, pet: pet };
  };

  // ---- Breeding (your pets + pets in the shared Vault) ----
  // ref = { uid, where: 'pack' | 'bank' }
  PT.bankPets = function () { try { return (S().bankPets && S().bankPets()) || []; } catch (e) { return []; } };
  function find(ref) {
    if (!ref) return null;
    if (ref.where === 'bank') return PT.bankPets().filter(function (x) { return x.uid === ref.uid; })[0] || null;
    return PT.get(ref.uid);
  }
  PT.find = find;
  PT.breedCandidates = function () {
    return PT.hatched().map(function (x) { return { uid: x.uid, where: 'pack', pet: x }; })
      .concat(PT.bankPets().filter(function (x) { return !x.egg; }).map(function (x) { return { uid: x.uid, where: 'bank', pet: x }; }));
  };
  PT.resting = function (pet) { return !!pet && now() < (pet.restUntil || 0); };
  PT.canBreedPet = function (pet) {
    if (!pet) return { ok: false, reason: 'Choose a pet' };
    if (pet.egg) return { ok: false, reason: 'Eggs can’t breed' };
    if (pet.stage < PD().breedMinStage) return { ok: false, reason: pet.name + ' must be ' + PD().stages[PD().breedMinStage].name + ' or older' };
    if (PT.resting(pet)) return { ok: false, reason: pet.name + ' is resting', restUntil: pet.restUntil };
    return { ok: true };
  };
  PT.canBreed = function (ra, rb) {
    var a = find(ra), b = find(rb), p = P();
    if (!a || !b) return { ok: false, reason: 'Choose two pets' };
    if (a.uid === b.uid) return { ok: false, reason: 'Choose two different pets' };
    var ca = PT.canBreedPet(a); if (!ca.ok) return ca;
    var cb = PT.canBreedPet(b); if (!cb.ok) return cb;
    if (!PT.freeSlot()) return { ok: false, reason: 'Both incubator nests are busy' };
    var fee = PT.hatchFee(a, b);
    if (p.gold < fee) return { ok: false, reason: 'The hatching costs ' + fee + ' gold', fee: fee };
    return { ok: true, fee: fee };
  };
  PT.breed = function (ra, rb, rng) {
    var c = PT.canBreed(ra, rb);
    if (!c.ok) return c;
    var p = P(), a = find(ra), b = find(rb), egg = PT.offspring(a, b, rng), rest = now() + PD().breeding.restHours * 3600000;
    var bankRefs = [ra, rb].filter(function (r) { return r.where === 'bank'; });
    if (bankRefs.length) {
      // parents in the Vault rest there too: one account write (bank + this wizard)
      var ok = S().petBankTxn(function (list) {
        list.forEach(function (x) { bankRefs.forEach(function (r) { if (x.uid === r.uid) x.restUntil = rest; }); });
      });
      if (!ok) return { ok: false, reason: 'Could not save (storage blocked?)' };
    }
    [ra, rb].forEach(function (r) { if (r.where !== 'bank') PT.get(r.uid).restUntil = rest; });
    S().addGold(-c.fee);
    p.hatchery.slots.push({ pet: egg, readyAt: now() + PT.incubateMs(egg.rarity), kind: 'bred' });
    save(); emit('breed', { uid: egg.uid });
    return { ok: true, egg: egg, fee: c.fee };
  };

  // ---- Appraisal (Quillby reveals the whole hidden pool) ----
  PT.appraiseCost = function (pet) { return PT.rarity(pet.rarity).appraise; };
  PT.canAppraise = function (uid) {
    var pet = PT.get(uid);
    if (!pet) return { ok: false, reason: 'No such pet' };
    if (pet.appraised) return { ok: false, reason: 'Already appraised' };
    if (P().gold < PT.appraiseCost(pet)) return { ok: false, reason: 'Not enough gold' };
    return { ok: true, cost: PT.appraiseCost(pet) };
  };
  PT.appraise = function (uid) {
    var c = PT.canAppraise(uid);
    if (!c.ok) return c;
    S().addGold(-c.cost);
    PT.get(uid).appraised = true;
    save(); emit('appraise', { uid: uid });
    return { ok: true };
  };

  // ---- Training ring (free XP for the equipped pet, once per cooldown) ----
  PT.trainReadyAt = function () { var p = P(); return (p && p.hatchery.cooldowns.training) || 0; };
  PT.canTrain = function () {
    var pet = PT.active();
    // v2.1 A4: every gate carries a `code` so Coach Bramble can say exactly what is missing
    if (!pet) return { ok: false, code: PT.hatched().length ? 'equip' : 'nopet', reason: PT.hatched().length ? 'Equip a pet first (Pets panel, P)' : 'You have no pet yet: adopt one from Tobin Burrow' };
    if (PT.isMega(pet) && !pet.offer) return { ok: false, code: 'grown', reason: pet.name + ' is fully grown', pet: pet.name };
    if (now() < PT.trainReadyAt()) return { ok: false, code: 'resting', reason: 'The ring is resting', readyAt: PT.trainReadyAt() };
    return { ok: true, pet: pet.name };
  };
  PT.train = function () {
    var c = PT.canTrain();
    if (!c.ok) return c;
    var p = P(), pet = PT.active(), X = PD().training;
    p.hatchery.cooldowns.training = now() + X.cooldownMin * 60000;
    var ups = PT.giveXp(pet.uid, X.xp);
    save();
    return { ok: true, xp: X.xp, stages: ups };
  };

  // ---- Shared Vault (account.bank.pets) ----
  PT.canDeposit = function (uid) {
    var pet = PT.get(uid);
    if (!pet) return { ok: false, reason: 'No such pet' };
    if (P().activePet === uid) return { ok: false, reason: 'Unequip it first' };
    if (!S().petBankTxn) return { ok: false, reason: 'No Vault in this version' };
    if (PT.bankPets().length >= PD().bankPets) return { ok: false, reason: 'The Vault’s pet nook is full (' + PD().bankPets + ')' };
    return { ok: true };
  };
  PT.deposit = function (uid) {
    var c = PT.canDeposit(uid);
    if (!c.ok) return c;
    var ok = S().petBankTxn(function (list, p) {
      var pet = p.pets.filter(function (x) { return x.uid === uid; })[0];
      p.pets = p.pets.filter(function (x) { return x.uid !== uid; });
      list.push(pet);
    });
    if (ok) emit('bank', { uid: uid, to: 'bank' });
    return ok ? { ok: true } : { ok: false, reason: 'Could not save (storage blocked?)' };
  };
  PT.canWithdraw = function (uid) {
    if (!PT.bankPets().some(function (x) { return x.uid === uid; })) return { ok: false, reason: 'Not in the Vault' };
    if (PT.room() <= 0) return { ok: false, reason: 'You can’t carry more pets (' + PD().maxPets + ')' };
    return { ok: true };
  };
  PT.withdraw = function (uid) {
    var c = PT.canWithdraw(uid);
    if (!c.ok) return c;
    var ok = S().petBankTxn(function (list, p) {
      for (var i = 0; i < list.length; i++) if (list[i].uid === uid) { var pet = PT.cleanPet(list.splice(i, 1)[0]); if (pet) p.pets.push(pet); break; }
    });
    if (ok) emit('bank', { uid: uid, to: 'pack' });
    return ok ? { ok: true } : { ok: false, reason: 'Could not save (storage blocked?)' };
  };

  // ---- Breeding with a friend in a Realm (WS-C hook, docs/design/realms.md §9) ----
  // exportForBreeding(uid) -> plain JSON summary of YOUR pet (null if it can't breed now).
  // breedWithFriend(myUid, summary, rng) -> { ok, egg, fee } / { ok: false, reason }: your own game
  // makes your own egg from your pet + the friend's summary (sanitised; nothing of the friend's
  // is saved except the egg). Same rules, fee and rest as breeding at home; the friend's pet rests
  // in the friend's own game.
  PT.exportForBreeding = function (uid) {
    var pet = PT.get(uid);
    if (!pet || !PT.canBreedPet(pet).ok) return null;
    return { v: 1, species: pet.species, name: pet.name, rarity: pet.rarity, gen: pet.gen || 1, stage: pet.stage, pool: pet.pool.slice() };
  };
  PT.friendPet = function (sm) {
    if (!isObj(sm) || !PT.species(sm.species)) return null;
    var pool = (Array.isArray(sm.pool) ? sm.pool : []).filter(function (t, i, a) { return typeof t === 'string' && PT.talent(t) && a.indexOf(t) === i; }).slice(0, PD().breeding.poolSize);
    var stage = Math.max(0, Math.min(PT.maxStage(), num(sm.stage, 0) | 0));
    if (stage < PD().breedMinStage) return null;
    return { uid: 'friend', species: sm.species, name: typeof sm.name === 'string' ? sm.name.slice(0, 24) : PT.species(sm.species).name,
      rarity: ORDER.indexOf(sm.rarity) >= 0 ? sm.rarity : 'common', gen: Math.max(1, Math.min(99, num(sm.gen, 1) | 0)),
      stage: stage, pool: pool, talents: [], seen: [], egg: false };
  };
  PT.canBreedWithFriend = function (uid, summary) {
    var p = P(), pet = PT.get(uid), fr = PT.friendPet(summary);
    if (!pet) return { ok: false, reason: 'Choose one of your pets' };
    var c = PT.canBreedPet(pet); if (!c.ok) return c;
    if (!fr) return { ok: false, reason: 'Your friend’s pet can’t breed' };
    if (!PT.freeSlot()) return { ok: false, reason: 'Both incubator nests are busy' };
    var fee = PT.hatchFee(pet, fr);
    if (p.gold < fee) return { ok: false, reason: 'The hatching costs ' + fee + ' gold', fee: fee };
    return { ok: true, fee: fee, friend: fr };
  };
  PT.breedWithFriend = function (uid, summary, rng) {
    var c = PT.canBreedWithFriend(uid, summary);
    if (!c.ok) return c;
    var p = P(), pet = PT.get(uid), egg = PT.offspring(pet, c.friend, rng);
    pet.restUntil = now() + PD().breeding.restHours * 3600000;
    S().addGold(-c.fee);
    p.hatchery.slots.push({ pet: egg, readyAt: now() + PT.incubateMs(egg.rarity), kind: 'bred' });
    save(); emit('breed', { uid: egg.uid, friend: true });
    return { ok: true, egg: egg, fee: c.fee };
  };

  // ------------------------------------------------------------------
  // Hooks into WF.state (installed once, when state.js is loaded first)
  // ------------------------------------------------------------------
  PT.installHooks = function (St) {
    if (!St || St.__petHooks) return;
    St.__petHooks = true;
    // (0) a brand-new wizard gets the v5 pet fields straight away
    if (St.newGame) {
      var baseNew = St.newGame;
      St.newGame = function () { var p = baseNew.apply(this, arguments); if (p) PT.migrate(p); return p; };
    }
    // (a) stats: the equipped pet's talents, added like gear (Bright Pip / Pip Surge caps re-applied)
    var baseStats = St.stats;
    St.stats = function (eo) {
      var s = baseStats.apply(this, arguments), p = St.player;
      if (!p || !p.activePet || !Array.isArray(p.pets)) return s;
      var pet = PT.active();
      if (!pet) return s;
      var b = PT.bonus(pet, p.school, naturalHp(p), p.level);
      s.maxHp = Math.round(s.maxHp + b.hp);
      s.maxMana = Math.round(s.maxMana + b.mana);
      if (typeof s.dmg === 'number') s.dmg += b.dmg / 100;
      if (typeof s.resist === 'number') s.resist += b.resist / 100;
      if (typeof s.acc === 'number') s.acc += b.acc / 100;
      s.flatDmg = (s.flatDmg || 0) + b.flatDmg;     // v2.0 retune: flat damage per hit (combat.js flatDmg)
      // v2.0 merge (WS-A Schools): pet talents stay UNIVERSAL (school talents are gated by the
      // wearer's school in talentValue, not "vs that school"), so schoolStats is left alone; the
      // own-school totals of the character sheet are universal + own school, so they move too.
      if (typeof s.ownDmg === 'number') s.ownDmg += b.dmg / 100;
      if (typeof s.ownAcc === 'number') s.ownAcc += b.acc / 100;
      if ((b.brightPip || b.pipSurge) && St.gearStats && St.pipStats) {
        var g = St.gearStats(eo);
        g.brightPip = (g.brightPip || 0) + b.brightPip; g.pipSurge = (g.pipSurge || 0) + b.pipSurge;
        var pip = St.pipStats(p.level, g);
        s.brightPip = pip.brightPip; s.pipSurge = pip.pipSurge;
      }
      s.pet = { uid: pet.uid, hp: b.hp, mana: b.mana, dmg: b.dmg, resist: b.resist, acc: b.acc, brightPip: b.brightPip, pipSurge: b.pipSurge, flatDmg: b.flatDmg };
      return s;
    };
    // (b) battle deck: the pet's cards ride on top of the deck size limit
    if (St.battleLoadout) {
      var baseLo = St.battleLoadout;
      St.battleLoadout = function () {
        var lo = baseLo.apply(this, arguments), pet = St.player && St.player.activePet ? PT.active() : null;
        if (lo && lo.deck && pet) PT.cardsOf(pet).forEach(function (id) { lo.deck[id] = (lo.deck[id] || 0) + 1; });
        return lo;
      };
    }
    // (c) loot: eggs + snacks + the pet's duel XP (rng shared, drawn AFTER the normal loot)
    if (St.rollLoot) {
      var baseRoll = St.rollLoot;
      St.rollLoot = function (enemyIds, rng) {
        var out = baseRoll.apply(this, arguments), r = rng || Math.random;
        out.eggs = PT.rollEggs(enemyIds, r);
        var sn = PT.rollSnacks(enemyIds, r);
        Object.keys(sn).forEach(function (id) { out.items[id] = (out.items[id] || 0) + sn[id]; });
        out.petXp = St.player && St.player.activePet ? PT.duelXpFor(enemyIds) : 0;
        return out;
      };
    }
    if (St.applyLoot) {
      var baseApply = St.applyLoot;
      St.applyLoot = function (loot) {
        var ups = baseApply.apply(this, arguments);
        try { PT.applyDuelLoot(loot); } catch (e) { if (typeof console !== 'undefined') console.error('pet loot failed', e); }
        return ups;
      };
    }
  };
  // eggs into the pet list (or lost with a note when full), XP to the equipped pet
  PT.applyDuelLoot = function (loot) {
    var p = P();
    if (!p || !loot) return { eggs: [], vaulted: [], lostEggs: [], lost: 0, stages: [] };
    var got = [], lost = 0, stages = [], vaulted = [], lostEggs = [];
    (loot.eggs || []).forEach(function (e) {
      var egg = PT.makePet(e.species, e.rarity, { egg: true });
      if (!egg) return;
      if (PT.room() <= 0) {
        // v2.0 QA M1: a full pet list sends the egg to the shared Vault instead of losing it
        var ok = false;
        if (S().petBankTxn && PT.bankPets().length < PD().bankPets) ok = S().petBankTxn(function (list) { list.push(egg); });
        if (ok) { vaulted.push(egg); emit('bank', { uid: egg.uid, to: 'bank' }); } else { lost++; lostEggs.push(egg); }
        return;
      }
      p.pets.push(egg); got.push(egg);
      emit('egg', { uid: egg.uid, from: e.from });
    });
    var pet = PT.active();
    if (pet && loot.petXp > 0) stages = PT.giveXp(pet.uid, loot.petXp);
    loot.petResult = { eggs: got, vaulted: vaulted, lostEggs: lostEggs, lost: lost, stages: stages, xp: pet ? loot.petXp : 0, pet: pet ? pet.uid : null };
    return loot.petResult;
  };

  if (WF.state) PT.installHooks(WF.state);
  return PT;
})();

if (typeof module !== 'undefined') module.exports = WF.pets;
