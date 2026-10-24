// =====================================================================
//  WIZZIE FARM — REALMS (friends play together) — tunables
//  v2.0 WS-C. Design: docs/design/realms.md. Code: game/js/net/*.js
//  Everything a designer may want to change about multiplayer lives here.
// =====================================================================
window.WF = window.WF || { data: {} };

WF.data.realms = {
  protocol: 3,               // message protocol major (docs/design/realms.md §4); bump on breaking changes (v2.1: 2 = summons, cards left, finite decks; 3 = Heroic mode in duels)
  maxPlayers: 3,             // host + 2 friends (V2.0-CONTRACT §0.3)

  // ---- duels (fixed timing for everyone, §6) ----
  turnSeconds: 30,           // planning phase; a wizard who hasn't picked by then passes
  outOfCardsSeconds: 5,      // v2.1 A5: a wizard with no cards and no scrolls passes after this (time to click Flee)
  readySeconds: 90,          // longest the host waits for a slow client to finish animating a round (v2.1: 45 -> 90 for the 1.5 s wand wind-up per cast + enemy lines)
  loadoutSeconds: 6,         // a friend who doesn't answer the duel invite in time sits this duel out
  joinRadius: 20,            // party members this close to the camp (same zone) join the duel


  // ---- connection (§3, §8) ----
  connectSeconds: 15,        // give up opening a connection after this long (NAT trouble, wrong code)
  reconnectSeconds: 60,      // a dropped friend keeps their seat this long
  reconnectBackoff: [1, 2, 4, 8, 8, 8, 8, 8, 8, 8],   // seconds between reconnect tries
  pingSeconds: 3,

  // ---- world presence (§9) ----
  presenceHz: 10,            // while moving
  idleHz: 1,                 // while standing still
  interpMs: 100,             // remote wizards are drawn this far in the past (smooth)
  staleSeconds: 6,           // a remote wizard with no update for this long fades out

  // ---- join code / lantern sigil (§2) ----
  codeLength: 6,
  alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',     // no I, O, 0, 1 (easy to read aloud)
  peerPrefix: 'wizziefarm-r1-',                     // signaling id = prefix + code

  // ---- WebRTC (§1). Free public servers, best effort. Add your own TURN here if you need one:
  //      { urls: 'turn:my.server:3478', username: '...', credential: '...' }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
  ],
  // Signaling broker (PeerJS cloud). null = PeerJS defaults (0.peerjs.com:443, secure).
  signaling: null,

  // ---- words (Realm panel) ----
  text: {
    title: 'Realms',
    blurb: 'Invite up to two friends into your world. Share your lantern sigil; they type its six runes to join. Everyone keeps their own wizard, loot and save.',
    hostBtn: 'Light a Realm Lantern',
    joinBtn: 'Join a Friend',
    leaveBtn: 'Leave Realm',
    closeBtn: 'Close Realm',
    codePrompt: 'Lantern sigil (6 runes)',
    opening: 'Lighting the lantern…',
    connecting: 'Following the lantern light…',
    offline: 'Could not reach the lantern network. Check your internet connection and try again.',
    timeout: 'Couldn’t reach the realm. Your two networks may block direct connections. Try: the same Wi-Fi, a free virtual LAN (Tailscale or ZeroTier) on both PCs, or add a TURN server in game/data/realms.js.',
    notFound: 'No lantern burns with that sigil. Check the six runes with your friend.',
    badCode: 'A sigil has six runes from A–Z and 2–9 (no I, O, 0 or 1).',
    full: 'That realm already has three wizards.',
    version: 'Both players need the same Wizzie Farm version. Update the game, then try again.',
    closed: 'The realm’s lantern went out. You keep playing on your own.',
    kicked: 'The host asked you to leave the realm.',
    reconnecting: 'Lost the lantern light… reconnecting',
    joined: '{name} joined your realm.',
    left: '{name} left the realm.',
    away: '{name} lost connection (their seat is kept for a minute).',
    back: '{name} is back.',
    followHost: 'Your party follows {name}.'
  }
};
