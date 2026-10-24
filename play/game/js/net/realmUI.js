// =====================================================================
//  WIZZIE FARM — REALMS IN THE GAME  (WF.realm)   v2.0 WS-C
//  Browser glue between the realm sessions (game/js/net/realm.js) and the
//  game: the Realm panel (host / join / party list / leave), friends'
//  wizards walking, riding and jumping in your world, the party following
//  the host between zones, camps the party beat, and party duels (the host
//  runs them, everyone plays the same event stream: combatView.startParty).
//  Design: docs/design/realms.md. Nothing here runs until you Host or Join,
//  so single-player is untouched (and works offline).
// =====================================================================
window.WF = window.WF || { data: {} };

WF.realm = (function () {
  'use strict';
  var U = WF.util, R = { role: null };
  var host = null, guest = null, transport = null;
  var avatars = {};                  // seat -> { mesh, tag, mount, mountId, sig, x, z, rot, jy, seen }
  var lastSend = 0, lastPres = null, lastZone = null, lookT = 0, lookSig = '', pingT = 0;
  var pendingGroup = null, pendingZone = null, lastError = '', busyText = '';
  function D() { return WF.data; }
  function cfg() { return D().realms || {}; }
  function T(k, vars) {
    var s = (cfg().text || {})[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  }
  function session() { return host || guest; }
  function P() { return WF.net.protocol; }
  function W() { return WF.world; }
  function now() { return performance.now(); }
  function toast(msg, kind) { try { WF.ui.toast(U.esc(msg), kind || 'info'); } catch (e) { /* no UI yet */ } }
  function refreshPanel() { try { if (WF.ui.panelOpen && WF.ui.panelOpen() === 'realm') R.renderPanel(document.getElementById('rl-body')); } catch (e) { console.error(e); } }

  R.setTransport = function (t) { transport = t; };     // tests: WF.net.transport.loopback()
  function tp() { return transport || WF.net.transport.webrtc; }
  R.active = function () { var s = session(); return !!s && (s.state === 'open' || s.state === 'joined' || s.state === 'reconnecting'); };
  R.session = session;

  // ---- who am I (sent to friends) ----
  function me() {
    var p = WF.state.player, look = null;
    try { look = WF.state.appearance(); } catch (e) { look = null; }
    return { name: p.name, school: p.school, level: p.level, look: look, game: (WF.main && WF.main.VERSION) || '?', zone: W().zoneId, code: loadLast().lastCode || null };
  }
  // account.realm.lastCode (V2.0-CONTRACT §9, save v5): read/written through WF.state, which also moves a
  // code still in the pre-v5 key 'wizziefarm_realm_v1' into the account once (and removes that key).
  function loadLast() { try { return { lastCode: WF.state.realmLastCode() }; } catch (e) { return {}; } }
  function saveLast(code) { try { WF.state.setRealmLastCode(code); } catch (e) { /* ignore */ } }

  // =====================================================================
  //  Host / join / leave
  // =====================================================================
  R.hostRealm = function (cb) {
    if (session()) return;
    lastError = ''; busyText = T('opening'); refreshPanel();
    host = new WF.net.RealmHost({ transport: tp(), me: me() });
    wireCommon(host);
    host.on('aggro', onGuestAggro);
    host.on('duelEvents', function (e) {
      if (e.seq === 1) startPartyView('host', e);
      else WF.combatView.netStream(e.events, e.seq);
    });
    host.on('joined', function (e) { toast(T('joined', { name: e.name })); WF.sfx.play('quest_accept'); host.setZone(W().zoneId, null); });
    host.on('left', function (e) { toast(T('left', { name: e.name })); dropAvatar(e.seat); });
    host.on('away', function (e) { toast(T('away', { name: e.name }), 'warn'); });
    host.on('back', function (e) { toast(T('back', { name: e.name })); });
    host.open(function (err, code) {
      busyText = '';
      if (err) { lastError = T(err === 'offline' || err === 'unsupported' ? 'offline' : 'timeout'); host = null; refreshPanel(); if (cb) cb(err); return; }
      saveLast(code);
      R.role = 'host'; lastZone = W().zoneId;
      refreshPanel();
      if (cb) cb(null, code);
    });
  };

  R.joinRealm = function (codeText, cb) {
    if (session()) return;
    var code = P().normalizeCode(codeText);
    if (!code) { lastError = T('badCode'); refreshPanel(); if (cb) cb('badCode'); return; }
    lastError = ''; busyText = T('connecting'); refreshPanel();
    guest = new WF.net.RealmGuest({ transport: tp(), me: me() });
    wireCommon(guest);
    guest.on('zone', function (z) { followZone(z.zone, z.arrive); });
    guest.on('camps', function (c) { applyCamps(c.zone, c.dead); });
    guest.on('gone', function (e) { dropAvatar(e.seat); });
    guest.on('duelInvite', onInvite);
    guest.on('duelEvents', function (e) {
      if (!WF.combatView.party()) startPartyView('guest', e);
      else WF.combatView.netStream(e.events, e.seq);
    });
    guest.on('duelSync', function () { if (WF.combatView.party()) WF.combatView.netSync(); });
    guest.on('planAck', function (a) { if (!a.ok) WF.combatView.netRefused(a.reason); });
    guest.on('duelSkip', function () { WF.combatView.netSkip(); });
    guest.on('state', function (s) {
      if (s.state === 'reconnecting') toast(T('reconnecting'), 'warn');
      refreshPanel();
    });
    guest.on('reconnected', function () { toast(T('back', { name: WF.state.player.name })); });
    guest.on('left', function (e) {
      var why = e.reason === 'kicked' ? 'kicked' : (e.reason === 'left' ? null : 'closed');
      if (why) toast(T(why), 'warn');
      // a party duel without its host: you slip away (nothing is lost)
      var cv = WF.combatView;
      if (cv.party && cv.party()) {
        var b = cv._battle, pc = b && b.players[cv.party().mySeat];
        cv.netEnd({ outcome: 'flee', result: 'flee', hp: pc ? pc.hp : WF.state.player.hp, mana: pc ? pc.mana : WF.state.player.mana, tcsUsed: {}, enemies: [] });
      }
      endSession();
    });
    guest.join(code, function (err, w) {
      busyText = '';
      if (err) {
        lastError = T({ notFound: 'notFound', full: 'full', version: 'version', closed: 'closed', badCode: 'badCode', offline: 'offline', unsupported: 'offline' }[err] || 'timeout');
        guest = null; refreshPanel(); if (cb) cb(err); return;
      }
      R.role = 'guest';
      var hostM = (w.roster || []).filter(function (m) { return m.seat === 0; })[0];
      toast(T('followHost', { name: hostM ? hostM.name : 'the host' }));
      WF.sfx.play('portal');
      refreshPanel();
      if (cb) cb(null, w);
    });
  };

  R.leave = function () {
    if (WF.combatView.active) { toast('Finish the duel first.', 'warn'); return; }
    if (host) host.close();
    if (guest) guest.leave();
    endSession();
  };
  R.kick = function (seat) { if (host) host.kick(seat); };
  function endSession() {
    Object.keys(avatars).forEach(function (s) { dropAvatar(+s); });
    host = null; guest = null; R.role = null; pendingGroup = null; pendingZone = null;
    refreshPanel();
  }

  function wireCommon(s) {
    s.on('roster', function () { syncAvatars(); refreshPanel(); });
    s.on('presence', function () { /* avatars read session().presence every frame */ });
    s.on('duelTurn', function (t) { WF.combatView.netTurn({ ms: t.ms, waiting: toIdx(t.waiting) }); });
    s.on('duelPlanned', function (m) { WF.combatView.netPlanned(toIdx(m.seats)); });
    s.on('duelEnd', function (end) { WF.combatView.netEnd(end); });
    s.on('emote', function (m) { var a = avatars[m.from]; if (a && m.emote) floatOver(a, m.emote); });
    s.on('petOffer', function (m) { petIncoming[m.offerId] = m; if (WF.pets && WF.pets.onFriendOffer) WF.pets.onFriendOffer(m); });
    s.on('petAccept', function (m) {
      var mine = petOffers[m.offerId]; delete petOffers[m.offerId];
      if (mine) breedLocal(mine.petId, m.pet);
      if (WF.pets && WF.pets.onFriendAccept) WF.pets.onFriendAccept(m);
    });
  }
  // ---- Pets with a friend: message + API hook only (WS-B builds pets; docs/design/realms.md §9).
  //  WF.realm.petsReady()                 -> true when WF.pets.exportForBreeding + breedWithFriend exist
  //  WF.realm.offerPet(toSeat, myPetId)   -> offerId (sends pet:offer with your pet's summary)
  //  WF.realm.acceptPet(offerId, myPetId) -> true (sends pet:accept; your own game makes your egg)
  //  Each side calls WF.pets.breedWithFriend(myPetId, friendSummary) locally; no friend data is saved.
  var petOffers = {}, petIncoming = {};
  function petsReady() { return !!(WF.pets && typeof WF.pets.exportForBreeding === 'function' && typeof WF.pets.breedWithFriend === 'function'); }
  function breedLocal(myPetId, friendSummary) {
    try {
      var r = WF.pets.breedWithFriend(myPetId, friendSummary);
      if (r && r.ok) toast('Your friend\'s pet and yours made an egg! It\'s in your Nestery nest.');
      else toast('No egg this time: ' + ((r && r.reason) || 'the pets could not breed'));
      return r;
    } catch (e) { console.warn('breedWithFriend failed', e); return null; }
  }
  R.petsReady = petsReady;
  R.offerPet = function (toSeat, myPetId) {
    var s = session(); if (!s || !petsReady()) return null;
    var sm = WF.pets.exportForBreeding(myPetId); if (!sm) return null;   // that pet can't breed right now
    var id = s.offerPet(toSeat, sm);
    if (id) petOffers[id] = { petId: myPetId, to: toSeat };
    return id;
  };
  R.acceptPet = function (offerId, myPetId) {
    var s = session(), offer = petIncoming[offerId]; if (!s || !offer || !petsReady()) return false;
    var sm = WF.pets.exportForBreeding(myPetId); if (!sm) return false;
    delete petIncoming[offerId];
    s.acceptPet(offer, sm);
    breedLocal(myPetId, offer.pet);
    return true;
  };
  R.petOffers = function () { return Object.keys(petIncoming).map(function (k) { return petIncoming[k]; }); };
  // realm seats -> combatant indices of the running duel
  function toIdx(seats) {
    var s = session(), order = host ? (host.duel && host.duel.order) : (guest.duel && guest.duel.order);
    if (!order) return [];
    return (seats || []).map(function (x) { return order.indexOf(x); }).filter(function (i) { return i >= 0; });
  }

  // =====================================================================
  //  Friends' wizards in the world
  // =====================================================================
  function schoolLook(school) {
    var sc = D().schools[school] || {};
    return { robe: sc.robe, hat: sc.hat, trim: sc.trim, skin: '#f2c9a0', hair: '#4a2f1c', staffGem: sc.color, scale: 1, gear: {} };
  }
  function memberOf(seat) { var s = session(); if (!s) return null; var l = host ? host.roster() : s.members; for (var i = 0; i < l.length; i++) if (l[i].seat === seat) return l[i]; return null; }
  function buildWizard(member) {
    var m;
    try { m = WF.models.wizard(member.look || schoolLook(member.school)); }
    catch (e) { console.warn('realm: wizard look failed, using school look', e); m = WF.models.wizard(schoolLook(member.school)); }
    return m;
  }
  function makeAvatar(member) {
    var mesh = buildWizard(member), sc = D().schools[member.school] || {};
    mesh.userData.realmAvatar = true;
    var tag = WF.models.textSprite(member.name + '  Lv ' + member.level, { color: sc.color || '#bfe8ff', size: 0.62, bold: true });
    tag.position.set(0, (mesh.userData.height || 2.1) + 0.38, 0);
    mesh.add(tag);
    var a = { mesh: mesh, tag: tag, mount: null, mountId: null, sig: JSON.stringify(member.look || member.school) + member.level, x: 0, z: 0, rot: 0, jy: 0, seen: 0, placed: false };
    mesh.visible = false;
    W().scene.add(mesh);
    return a;
  }
  function dropAvatar(seat) {
    var a = avatars[seat]; if (!a) return;
    if (a.mount) { if (a.mount.parent) a.mount.parent.remove(a.mount); WF.models.dispose && WF.models.dispose(a.mount); }
    if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
    if (WF.models.dispose) WF.models.dispose(a.mesh);
    delete avatars[seat];
  }
  function syncAvatars() {
    var s = session(); if (!s || !W().scene) return;
    var mine = host ? 0 : guest.seat, list = host ? host.roster() : s.members, seen = {};
    list.forEach(function (m) {
      if (m.seat === mine) return;
      seen[m.seat] = true;
      var sig = JSON.stringify(m.look || m.school) + m.level, a = avatars[m.seat];
      if (a && a.sig !== sig) { var keep = { x: a.x, z: a.z, rot: a.rot, placed: a.placed }; dropAvatar(m.seat); a = null; avatars[m.seat] = makeAvatar(m); Object.assign(avatars[m.seat], keep); }
      if (!a && !avatars[m.seat]) avatars[m.seat] = makeAvatar(m);
      avatars[m.seat].away = !!m.away;
    });
    Object.keys(avatars).forEach(function (k) { if (!seen[k]) dropAvatar(+k); });
  }
  function buildMount(itemId) {
    var it = D().items[itemId];
    if (!it || !WF.models.mount) return null;
    try { return WF.models.mount((it.mount && it.mount.kind) || 'horse', Object.assign({ rarity: it.rarity || 'common' }, it.mount || {})); }
    catch (e) { return null; }
  }
  function updateAvatars(dt) {
    var s = session(); if (!s) return;
    var w = W(), hideAll = !w.zoneId || w.mode === 'combat' || w.mode === 'title' || w.mode === 'loading';
    var k = Math.min(1, dt * 10), stale = (cfg().staleSeconds || 6) * 1000;
    Object.keys(avatars).forEach(function (seat) {
      var a = avatars[seat], pr = s.presence[seat];
      var show = !hideAll && pr && pr.zone === w.zoneId;
      if (pr && pr !== a.lastPr) { a.lastPr = pr; a.seen = now(); }
      if (show && now() - a.seen > stale) show = false;
      var root = a.mount && a.mount.parent ? a.mount : a.mesh;
      if (!show) { a.mesh.visible = false; if (a.mount) a.mount.visible = false; a.placed = false; return; }
      if (!a.placed) { a.x = pr.x; a.z = pr.z; a.rot = pr.rot || 0; a.placed = true; }
      a.x += (pr.x - a.x) * k; a.z += (pr.z - a.z) * k;
      a.rot += U.angleDiff(a.rot, pr.rot || 0) * k;
      a.jy += ((pr.jy || 0) - a.jy) * Math.min(1, dt * 18);
      // mounted: wizard sits in the saddle
      var wantMount = pr.mounted && pr.mount;
      if (wantMount && a.mountId !== pr.mount) {
        if (a.mount) { if (a.mount.parent) a.mount.parent.remove(a.mount); if (WF.models.dispose) WF.models.dispose(a.mount); }
        a.mount = buildMount(pr.mount); a.mountId = a.mount ? pr.mount : null;
        if (a.mount) w.scene.add(a.mount);
      }
      var seatObj = a.mount && (a.mount.userData.seat || a.mount);
      if (wantMount && a.mount) {
        if (a.mesh.parent !== seatObj) { if (a.mesh.parent) a.mesh.parent.remove(a.mesh); seatObj.add(a.mesh); a.mesh.position.set(0, 0, 0); a.mesh.rotation.set(0, 0, 0); }
        a.mount.visible = true; a.mesh.visible = true;
        a.mount.position.set(a.x, a.jy, a.z); a.mount.rotation.y = a.rot;
        if (a.mount.userData.anim) a.mount.userData.anim(w.time, pr.gait || 'idle', dt);
        if (a.mesh.userData.anim) a.mesh.userData.anim(w.time, 'ride', dt);
      } else {
        if (a.mesh.parent !== w.scene) { if (a.mesh.parent) a.mesh.parent.remove(a.mesh); w.scene.add(a.mesh); }
        if (a.mount) a.mount.visible = false;
        a.mesh.visible = true;
        a.mesh.position.set(a.x, a.jy, a.z); a.mesh.rotation.y = a.rot;
        if (a.mesh.userData.anim) a.mesh.userData.anim(w.time + (+seat), pr.gait || 'idle', dt);
      }
      a.mesh.traverse && a.tag && (a.tag.material.opacity = a.away ? 0.45 : 1);
    });
  }
  function floatOver(a, text) {
    try { WF.ui.floatText(String(text), new THREE.Vector3(a.x, (a.mesh.userData.height || 2) + 1, a.z), '#ffffff', 1.2, 'cast'); } catch (e) { /* cosmetic */ }
  }

  // ---- my presence ----
  function sendPresence(force) {
    var s = session(), w = W(), Pl = w.player;
    if (!s || !Pl || !w.zoneId || w.mode === 'title' || w.mode === 'loading') return;
    var p = WF.state.player;
    var pr = { zone: w.zoneId, x: +Pl.x.toFixed(2), z: +Pl.z.toFixed(2), rot: +(Pl.rot || 0).toFixed(3), jy: +((Pl.jumpY || 0)).toFixed(2),
      mounted: !!(w.isRiding && w.isRiding()), mount: p.equipped.mount || null, gait: Pl.moving ? 'run' : 'idle' };
    var dg = w.dungeon;
    if (host && dg && dg.active && dg.mode && dg.mode()) pr.dm = dg.mode().id;   // v2.1 D16: the host's Heroic run, for its guests
    var moving = Pl.moving || pr.jy > 0;
    var hz = moving ? (cfg().presenceHz || 10) : (cfg().idleHz || 1);
    var changed = !lastPres || lastPres.x !== pr.x || lastPres.z !== pr.z || lastPres.rot !== pr.rot || lastPres.jy !== pr.jy || lastPres.mounted !== pr.mounted || lastPres.zone !== pr.zone || lastPres.gait !== pr.gait || lastPres.dm !== pr.dm;
    if (!force && now() - lastSend < 1000 / hz) return;
    if (!force && !changed && now() - lastSend < 1000 / (cfg().idleHz || 1)) return;
    lastSend = now(); lastPres = pr;
    s.sendPresence(pr);
  }

  // v2.1 D16 (review m1): a guest inside the zone the HOST is in plays the host's dungeon mode.
  // -> undefined (not a guest there: your own choice counts) | true (host is Heroic) | false (Normal)
  WF.net.hostRunMode = function (zoneId) {
    if (!guest || !R.active || !R.active()) return undefined;
    var hp = guest.presence && guest.presence[0];
    if (!hp || !zoneId || hp.zone !== zoneId) return undefined;
    return hp.dm === 'heroic';
  };
  // ---- the party follows the host (V2.0-CONTRACT §4 default) ----
  function followZone(zone, arrive) {
    if (!zone || !D().zones[zone]) return;
    if (W().zoneId === zone) { pendingZone = null; return; }
    var m = W().mode;
    if (m !== 'explore' && m !== 'menu') { pendingZone = { zone: zone, arrive: arrive }; return; }
    pendingZone = null;
    var hp = guest && guest.presence[0], at = (hp && hp.zone === zone) ? [hp.x + 1.5, hp.z + 1.5] : (arrive || null);
    WF.main.travel(zone, at);
  }
  function applyCamps(zone, dead) {
    if (zone !== W().zoneId) return;
    (dead || []).forEach(function (gid) {
      var g = findGroup(gid);
      if (g && g.state === 'alive' && !(WF.combatView.active && WF.combatView.party())) W().killGroup(g);
    });
  }
  function findGroup(gid) { var gs = W().groups || []; for (var i = 0; i < gs.length; i++) if (gs[i].def && gs[i].def.id === gid) return gs[i]; return null; }

  // =====================================================================
  //  Party duels
  // =====================================================================
  function dist(a, x, z) { return Math.hypot(a.x - x, a.z - z); }
  // combatView.start(g) asks this first: true = the realm handles this duel
  R.interceptDuel = function (g) {
    if (!R.active() || !g || !g.def || !g.def.id) return false;
    var s = session(), rad = cfg().joinRadius || 20;
    if (host) {
      var seats = [0];
      host.roster().forEach(function (m) {
        if (m.seat === 0 || m.away) return;
        var pr = host.presence[m.seat];
        if (pr && pr.zone === W().zoneId && dist(pr, g.x, g.z) < rad) seats.push(m.seat);
      });
      if (seats.length < 2) return false;        // nobody near: a normal solo duel
      pendingGroup = g;
      W().mode = 'combat';
      WF.ui.closeAll(true); WF.ui.prompt(null);
      toast('Gathering your party…');
      var dg = W().dungeon, mode = dg && dg.active && dg.mode ? dg.mode() : null;     // v2.1 D16: the host's Heroic run counts for the party
      var id = host.startDuel({ groupId: g.def.id, enemies: g.def.enemies.slice(), seats: seats, player: WF.net.realmLoadout(WF.state), mode: mode });
      if (!id) { W().mode = 'explore'; pendingGroup = null; return false; }
      return true;
    }
    // guest: near the host -> ask the host to start it for the party; far away -> solo duel
    var hp = s.presence[0];
    if (s.state !== 'joined' || !hp || hp.zone !== W().zoneId || dist(hp, g.x, g.z) > rad) return false;
    g.cooldown = now() + 4000;
    guest.aggro(g.def.id);
    return true;
  };
  function onGuestAggro(e) {
    if (!host || WF.combatView.active || W().mode !== 'explore') return;
    var g = findGroup(e.groupId);
    if (!g || g.state !== 'alive') { host.campDefeated(W().zoneId, e.groupId); return; }
    if (!R.interceptDuel(g)) { /* nobody else near any more */ }
  }
  function onInvite(inv) {
    var w = W(), ok = (w.mode === 'explore' || w.mode === 'menu') && !WF.combatView.active && !(WF.ui.blocking && WF.ui.blocking());
    var hp = guest.presence[0];
    if (ok && hp && hp.zone !== w.zoneId) ok = false;
    if (!ok) { guest.sendLoadout(inv.duelId, null); return; }
    pendingGroup = findGroup(inv.groupId);
    guest.sendLoadout(inv.duelId, WF.net.realmLoadout(WF.state));
  }
  // a stand-in camp when the guest's world has no such group (should not happen: same zone data)
  function fallbackGroup(enemies, at) {
    var models = enemies.map(function (eid) {
      var e = D().enemies[eid] || {};
      var m = WF.models.enemy(e.model || 'sprite', { color: e.color, scale: e.scale || 1, elite: !!e.elite });
      m.position.set(at.x, 0, at.z); W().scene.add(m);
      return m;
    });
    return { def: { id: 'realm_fallback', enemies: enemies }, models: models, tags: [], x: at.x, z: at.z, state: 'alive', cooldown: 0,
      boss: enemies.some(function (e) { return D().enemies[e] && D().enemies[e].boss; }), fallback: true };
  }
  function startPartyView(mode, e) {
    var b = e.battle, order = e.order, myIdx = e.bseat, w = W();
    var g = pendingGroup || (mode === 'guest' ? findGroup(guest.duel && guest.duel.groupId) : null);
    if (!g) {
      var hp = session().presence[0] || { x: w.player.x + 6, z: w.player.z };
      g = fallbackGroup(b.enemies.map(function (c) { return c.enemyId; }), { x: hp.x - 4, z: hp.z });
    }
    pendingGroup = null;
    var meshes = order.map(function (seat, i) {
      if (i === myIdx) return null;
      var m = memberOf(seat) || { name: b.players[i].name, school: b.players[i].school, level: b.players[i].level };
      var mesh = buildWizard(m), av = avatars[seat];
      if (av && av.placed) mesh.position.set(av.x, 0, av.z);
      return mesh;
    });
    var s = session();
    var ctl = mode === 'host'
      ? { plan: function (a) { return host.plan(a); }, ready: function (q) { host.ready(q); }, discard: function () { }, skip: function () { host.skip(); } }
      : { plan: function (a) { return guest.plan(a); }, ready: function (q) { guest.ready(q); }, discard: function (u) { guest.discard(u); }, skip: function () { } };
    if (w.isRiding && w.isRiding() && w.toggleMount) { /* world suspends the mount itself when a camp aggroes */ }
    var started = WF.combatView.startParty({ mode: mode, battle: b, mySeat: myIdx, group: g, meshes: meshes, events: e.events, seq: e.seq, ctl: ctl });
    if (!started) console.warn('realm: could not open the party duel view');
  }
  // combatView.cleanup -> here
  R.duelClosed = function () {
    if (pendingZone) { var z = pendingZone; pendingZone = null; setTimeout(function () { followZone(z.zone, z.arrive); }, 600); }
  };

  // =====================================================================
  //  Per-frame (own loop: no edits to the world/main loops)
  // =====================================================================
  var lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, lastT ? (t - lastT) / 1000 : 0.016); lastT = t;
    if (!session()) return;
    try {
      var w = W();
      syncAvatarsIfNeeded();
      updateAvatars(dt);
      sendPresence(false);
      if (host && w.zoneId && w.zoneId !== lastZone && w.mode !== 'loading') { lastZone = w.zoneId; host.setZone(w.zoneId, w.player ? [w.player.x, w.player.z] : null); sendPresence(true); }
      if (guest && w.zoneId !== lastZone && w.mode !== 'loading') { lastZone = w.zoneId; var dz = guest.dead[w.zoneId]; if (dz) applyCamps(w.zoneId, Object.keys(dz)); sendPresence(true); }
      if (guest && pendingZone && (w.mode === 'explore' || w.mode === 'menu')) followZone(pendingZone.zone, pendingZone.arrive);
      lookT += dt;
      if (lookT > 2 && WF.state.player) {
        lookT = 0;
        var who = me(), sig = JSON.stringify(who.look) + who.level;
        if (sig !== lookSig) { lookSig = sig; session().updateMe({ look: who.look, level: who.level }); }
      }
      pingT += dt;
      if (host && pingT > (cfg().pingSeconds || 3)) { pingT = 0; host.ping(); }
    } catch (e) { console.error('[realm] frame', e); }
  }
  var avatarCount = -1;
  function syncAvatarsIfNeeded() { var n = Object.keys(session().presence || {}).length; if (n !== avatarCount) { avatarCount = n; syncAvatars(); } }

  // camps the host's world beats (solo duels too) are down for the whole party
  function wrapKillGroup() {
    var w = W(); if (!w || w._realmKillWrapped) return;
    var orig = w.killGroup;
    w.killGroup = function (g) { orig.call(w, g); try { if (host && g && g.def && g.def.id) host.campDefeated(w.zoneId, g.def.id); } catch (e) { console.error(e); } };
    w._realmKillWrapped = true;
  }

  // =====================================================================
  //  Realm panel (opened from the HUD "Realm" button or G; rendered by ui.js into #rl-body)
  // =====================================================================
  R.renderPanel = function (box) {
    if (!box) return;
    var s = session(), h = '', fc = P().formatCode;
    h += '<div class="rl-blurb dim">' + U.esc(T('blurb')) + '</div>';
    if (busyText) h += '<div class="rl-busy"><span class="rl-spin"></span>' + U.esc(busyText) + '</div>';
    if (lastError) h += '<div class="rl-err">' + U.esc(lastError) + '</div>';
    if (!s && !busyText) {
      var last = loadLast().lastCode;
      h += '<div class="rl-cols">' +
        '<div class="rl-col"><h4>Host</h4><p class="dim">Your game becomes the realm. Friends see your lantern sigil and type it in.</p>' +
        '<button class="btn primary" id="rl-host">' + U.esc(T('hostBtn')) + '</button>' +
        (last ? '<div class="dim rl-last">Your last sigil: <b>' + U.esc(fc(last)) + '</b> (reused when it is free)</div>' : '') + '</div>' +
        '<div class="rl-col"><h4>Join</h4><p class="dim">' + U.esc(T('codePrompt')) + '</p>' +
        '<div class="rl-join"><input id="rl-code" maxlength="9" autocomplete="off" spellcheck="false" placeholder="K7Q·4MD"><button class="btn" id="rl-join">' + U.esc(T('joinBtn')) + '</button></div></div>' +
        '</div>';
    } else if (s) {
      var code = host ? host.code : guest.code, list = host ? host.roster() : s.members, max = cfg().maxPlayers || 3;
      h += '<div class="rl-realm"><div class="rl-sigil-wrap">' + P().sigilSVG(code, 132) + '<div class="rl-code">' + U.esc(fc(code)) + '</div>' +
        (host ? '<button class="btn sm" id="rl-copy">Copy sigil</button>' : '') + '</div>' +
        '<div class="rl-party"><h4>' + (host ? 'Your realm' : 'In ' + U.esc((list.filter(function (m) { return m.seat === 0; })[0] || {}).name || 'a friend') + '’s realm') +
        ' <small class="dim">' + list.length + ' / ' + max + '</small></h4>';
      list.forEach(function (m) {
        var sc = D().schools[m.school] || {}, mine = m.seat === (host ? 0 : guest.seat);
        h += '<div class="rl-m' + (m.away ? ' away' : '') + '"><span class="rl-seat">' + (m.seat + 1) + '</span>' +
          '<span class="rl-sch" style="color:' + (sc.color || '#fff') + '">' + (sc.glyph || '✦') + '</span>' +
          '<span class="rl-nm">' + U.esc(m.name) + (mine ? ' <small class="dim">(you)</small>' : '') + (m.seat === 0 ? ' <small class="rl-host">host</small>' : '') + '</span>' +
          '<span class="rl-lv">Lv ' + U.esc(String(m.level)) + '</span>' +
          (m.away ? '<span class="rl-away">reconnecting…</span>' : (host && m.rtt != null && !mine ? '<span class="dim rl-rtt">' + Math.round(m.rtt) + ' ms</span>' : '')) +
          (host && !mine ? '<button class="btn sm btn-ghost" data-kick="' + m.seat + '" title="Remove from the realm">✕</button>' : '') + '</div>';
      });
      for (var e = list.length; e < max; e++) h += '<div class="rl-m empty"><span class="rl-seat">' + (e + 1) + '</span><span class="dim">an empty seat — share your sigil</span></div>';
      h += '</div></div>';
      if (guest && s.state === 'reconnecting') h += '<div class="rl-busy"><span class="rl-spin"></span>' + U.esc(T('reconnecting')) + '</div>';
      h += '<div class="rl-notes dim">Duels: everyone near the camp joins (up to 3 vs 3), each picks a card in the same 30 s planning phase, and the round plays in seat order. Loot is rolled for each wizard separately. The party follows the host through portals.</div>';
      h += '<div class="mn-row"><button class="btn btn-ghost" id="rl-leave">' + U.esc(host ? T('closeBtn') : T('leaveBtn')) + '</button></div>';
    }
    var fresh = !box.querySelector('.rl-blurb');   // v2.1 QA: the panel just opened -> keyboard focus moves into it
    box.innerHTML = h;
    if (fresh) { try { var fb = box.querySelector('input, button:not([disabled])'); if (fb) fb.focus({ preventScroll: true }); } catch (eF) { /* old browsers */ } }
    var q = function (id) { return document.getElementById(id); };
    if (q('rl-host')) q('rl-host').onclick = function () { WF.sfx.play('click'); R.hostRealm(); };
    if (q('rl-join')) q('rl-join').onclick = function () { WF.sfx.play('click'); R.joinRealm(q('rl-code').value); };
    if (q('rl-code')) q('rl-code').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); R.joinRealm(this.value); } ev.stopPropagation(); };
    if (q('rl-leave')) q('rl-leave').onclick = function () { WF.sfx.play('close'); R.leave(); };
    if (q('rl-copy')) q('rl-copy').onclick = function () {
      try { navigator.clipboard.writeText(fc(host.code)); toast('Sigil copied: ' + fc(host.code)); } catch (e2) { toast('Sigil: ' + fc(host.code)); }
    };
    Array.prototype.forEach.call(box.querySelectorAll('[data-kick]'), function (b) { b.onclick = function () { R.kick(+b.getAttribute('data-kick')); }; });
  };

  // ---- styles (kept with the module; the shared stylesheet stays untouched) ----
  function injectStyles() {
    if (document.getElementById('realm-css')) return;
    var css =
      '#panel[data-panel="realm"]{width:min(720px,94vw)}' +
      '.rl-blurb{margin:0 0 12px}.rl-cols{display:flex;gap:18px;flex-wrap:wrap}.rl-col{flex:1 1 260px;background:rgba(255,255,255,.04);border:1px solid rgba(255,211,107,.18);border-radius:12px;padding:10px 14px 14px}' +
      '.rl-col h4{margin-top:4px}.rl-last{margin-top:8px;font-size:.85em}.rl-join{display:flex;gap:8px}.rl-join input{flex:1;min-width:0;font:800 1.15em var(--body);letter-spacing:.18em;text-transform:uppercase;text-align:center;padding:6px 8px;border-radius:9px;border:2px solid var(--gold-d);background:#140f2c;color:#fff2c8}' +
      '.rl-err{margin:0 0 10px;padding:8px 12px;border-radius:10px;border:1px solid #ff8a6a;background:rgba(80,20,10,.35);color:#ffd8cc}' +
      '.rl-busy{margin:0 0 10px;color:#fff2c8;display:flex;align-items:center;gap:8px}.rl-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--gold);border-right-color:transparent;animation:rlspin .8s linear infinite}@keyframes rlspin{to{transform:rotate(360deg)}}' +
      '.rl-realm{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}.rl-sigil-wrap{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 14px;border-radius:14px;background:radial-gradient(circle,rgba(255,200,90,.16),rgba(0,0,0,0) 70%)}' +
      '.rl-sigil{filter:drop-shadow(0 0 8px rgba(255,200,90,.55))}.rl-code{font:800 1.6em var(--display);letter-spacing:.12em;color:var(--gold);text-shadow:0 2px 6px #000}' +
      '.rl-party{flex:1 1 260px}.rl-party h4{margin-top:4px}.rl-m{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;background:rgba(255,255,255,.05);margin-bottom:6px}' +
      '.rl-m.away{opacity:.6}.rl-m.empty{background:none;border:1px dashed rgba(255,255,255,.15)}.rl-seat{width:20px;height:20px;border-radius:50%;background:var(--gold);color:#2a1a00;font-weight:800;font-size:.8em;display:inline-flex;align-items:center;justify-content:center}' +
      '.rl-nm{flex:1}.rl-host{color:var(--gold);border:1px solid var(--gold-d);border-radius:6px;padding:0 4px}.rl-away{color:#ffb08a;font-size:.85em}.rl-rtt{font-size:.8em}.rl-notes{margin:12px 0 4px;font-size:.88em}' +
      // party duel bits (combatView)
      '.cb-party{margin-top:6px;display:flex;flex-direction:column;gap:3px}.cbp{display:flex;align-items:center;gap:6px;font-size:.8em}.cbp.dead{opacity:.45}.cbp-nm{min-width:72px;font-weight:800}.cbp-ok{color:#7dff9a}' +
      '.cbp-bar{flex:1;height:6px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;min-width:60px}.cbp-bar i{display:block;height:100%}.cbp-pips{color:var(--gold);font-size:.9em}' +
      '#cb-timer{align-self:center;text-align:center;min-width:72px;font:800 1.35em var(--display);color:#fff2c8;text-shadow:0 2px 6px #000;padding:2px 12px;border-radius:12px;background:rgba(16,12,38,.75);border:1px solid var(--gold-d);pointer-events:none}' +
      '#cb-timer.low{color:#ff8a6a;border-color:#ff8a6a}#cb-timer.hidden{visibility:hidden}' +
      '.cb-plate.ally{border-color:rgba(120,220,255,.6)}.cb-plate.ally.planned{box-shadow:0 0 0 2px rgba(125,255,154,.6)}.pl-ok{color:#7dff9a;margin-left:4px;font-weight:800}' +
      '#cb-player.targetable{cursor:pointer;box-shadow:0 0 0 2px var(--gold)}';
    var st = document.createElement('style'); st.id = 'realm-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  R.init = function () {
    injectStyles();
    wrapKillGroup();
    requestAnimationFrame(frame);
  };
  // QA / tests
  R._avatars = function () { return avatars; };
  R._state = function () { var s = session(); return s ? { role: R.role, state: s.state, code: host ? host.code : guest.code, seat: host ? 0 : guest.seat, members: (host ? host.roster() : s.members).length } : null; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { R.init(); });
  else setTimeout(R.init, 0);
  return R;
})();
