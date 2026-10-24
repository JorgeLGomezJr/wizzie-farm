// =====================================================================
//  WIZZIE FARM — SFX & MUSIC  (WF.sfx)
//  Owner: audio-director / sound-designer.  Spec: docs/design/audio.md
//
//  100% synthesized with the Web Audio API. No audio files, no libraries.
//
//  Public API (see docs/ARCHITECTURE.md):
//    WF.sfx.init()                 create/resume the AudioContext (call on first click)
//    WF.sfx.play(name)             one-shot sound effect (names in WF.sfx.list)
//    WF.sfx.music(style|null)      crossfade (~1.5 s) to a generative loop, null = fade out
//                                  styles: town | meadow | forest | ruins | battle | boss
//    WF.sfx.setVolume(m, mu)       master 0..1, music 0..1 (either may be null to keep)
//    WF.sfx.list / WF.sfx.styles   arrays of valid names (for tests / sound board)
//    WF.sfx.isReady()              true once an AudioContext exists
//    WF.sfx._renderOffline(n, s)   TEST HOOK: render a sound or style to an AudioBuffer
//
//  Every public call is wrapped in try/catch and is a silent no-op when
//  Web Audio is unavailable or init() has not been called yet.
//
//  Signal flow:
//    sounds -> sfxBus ----------------------\
//    sounds -> sfxRev (convolver) -> sfxBus  >- comp -> tone LPF -> master -> limiter -> out
//    music players -> fade -> musicBus -> duck /
//    music players -> fade -> musicRev -> musicBus
// =====================================================================
window.WF = window.WF || { data: {} };

(function () {
  'use strict';

  var NAMES = ['click', 'hover', 'open', 'close',
    'cast_stoneward', 'cast_tidecaller', 'cast_emberstrike', 'cast_lumen', 'cast_hollow',
    'hit', 'heal', 'buff', 'debuff', 'shield', 'fizzle', 'death', 'windup',
    'victory', 'defeat', 'levelup', 'loot', 'gold',
    'quest_accept', 'quest_complete', 'portal', 'wisp', 'error', 'card_draw',
    // v1.1 (agent F): spell cinematics, duel presentation
    'summon', 'summon_small', 'summon_big', 'whoosh', 'whoosh_big', 'shadow_whoosh', 'zap', 'thunder', 'ignite', 'crash', 'rumble', 'rumble_big',
    'splash', 'splash_small', 'water_swirl', 'drain', 'boom', 'hit_big',
    'impact_emberstrike', 'impact_stoneward', 'impact_tidecaller', 'impact_lumen', 'impact_hollow',
    'cry_hawk', 'cry_phoenix', 'roar_drake', 'roar_serpent', 'roar_stone', 'bleat_stone', 'snort', 'chomp', 'shriek', 'shriek_big', 'wail',
    'dread_rise', 'gulp', 'splat', 'creak', 'bone_crack', 'blade_ring', 'blade_shing', 'cleave', 'slash', 'whip', 'thud', 'croak', 'war_cry',
    'chime_moon', 'chime_sun', 'heal_chime', 'shield_up', 'trap_snap', 'debuff_chain', 'card_flip', 'card_deal', 'duel_start', 'taunt',
    'enemy_defeat', 'boss_phase',
    // v1.1 names for agent D (loot rarity, mounts)
    'loot_uncommon', 'loot_rare', 'loot_epic', 'loot_legendary', 'mount_summon', 'mount_dismiss', 'hoof_step', 'whinny'];
  var STYLE_NAMES = ['town', 'meadow', 'forest', 'ruins', 'battle', 'boss'];

  // ---- mix constants (see audio.md "Mix levels") -----------------------
  var SFX_GAIN = 0.9;      // sfx bus
  var MUSIC_GAIN = 0.5;    // music bus at music volume 1.0
  var FADE = 1.5;          // music crossfade seconds
  var LOOKAHEAD = 0.22;    // scheduler lookahead (s) while tab visible
  var LOOKAHEAD_HIDDEN = 1.6;
  var TICK_MS = 40;

  var G = null;                       // live graph
  var vol = { master: 0.8, music: 0.6 };
  var wantStyle = null;               // last requested music style
  var players = [];                   // active + fading music players
  var timer = null;
  var lastPlay = {};                  // name -> ctx time (throttle)
  var recent = [];                    // ctx times of recent plays (global cap)
  var MIN_GAP = { hover: 0.075, card_draw: 0.035, gold: 0.05, hoof_step: 0.06, card_deal: 0.05, boom: 0.12 };
  var DUCKERS = { victory: [0.35, 1.9], defeat: [0.3, 2.3], levelup: [0.3, 2.2], quest_complete: [0.55, 1.2], loot_legendary: [0.4, 2.0], loot_epic: [0.55, 1.4], boom: [0.6, 0.7], summon_big: [0.65, 1.2], duel_start: [0.6, 1.0] };

  // ---- small helpers ----------------------------------------------------
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  // null / undefined / '' mean "keep the current value" (setVolume contract). Number(null) is 0,
  // so they must be checked before converting, or a caller passing null mutes the game (v1.2 bug).
  function clamp01(v) { if (v == null || v === '') return null; v = Number(v); return isFinite(v) ? Math.max(0, Math.min(1, v)) : null; }
  function vary(p) { return 1 + rnd(-p, p); }

  // =====================================================================
  //  GRAPH
  // =====================================================================
  function makeNoise(ctx, secs) {
    var len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // sparse random impulses with tiny ringing -> fire crackle
  function makeCrackle(ctx, secs) {
    var sr = ctx.sampleRate, len = Math.floor(sr * secs), buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      if (Math.random() < 0.0009) {
        var amp = rnd(0.3, 1) * (Math.random() < 0.5 ? -1 : 1), ring = 20 + (Math.random() * 60 | 0);
        for (var k = 0; k < ring && i + k < len; k++) d[i + k] += amp * Math.pow(1 - k / ring, 2) * (k % 2 ? -1 : 1);
      }
    }
    return buf;
  }

  // warm, darkening stereo reverb tail
  function makeIR(ctx, secs) {
    var sr = ctx.sampleRate, len = Math.floor(sr * secs), buf = ctx.createBuffer(2, len, sr);
    var pre = Math.floor(sr * 0.012);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), y = 0;
      for (var i = pre; i < len; i++) {
        var p = (i - pre) / (len - pre);
        var a = 0.55 - 0.45 * p;                       // one-pole LPF closes over time
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - p, 2.6);
      }
    }
    return buf;
  }

  function buildGraph(ctx) {
    var g = { ctx: ctx };
    g.limiter = ctx.createDynamicsCompressor();
    g.limiter.threshold.value = -2; g.limiter.knee.value = 0; g.limiter.ratio.value = 20;
    g.limiter.attack.value = 0.002; g.limiter.release.value = 0.12;
    g.limiter.connect(ctx.destination);

    g.master = ctx.createGain(); g.master.gain.value = vol.master; g.master.connect(g.limiter);

    g.tone = ctx.createBiquadFilter(); g.tone.type = 'lowpass';   // tame harsh highs
    g.tone.frequency.value = 10500; g.tone.Q.value = 0.5; g.tone.connect(g.master);

    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -16; g.comp.knee.value = 10; g.comp.ratio.value = 3;
    g.comp.attack.value = 0.006; g.comp.release.value = 0.25;
    g.comp.connect(g.tone);

    g.sfx = ctx.createGain(); g.sfx.gain.value = SFX_GAIN; g.sfx.connect(g.comp);

    g.duck = ctx.createGain(); g.duck.gain.value = 1; g.duck.connect(g.comp);
    g.musicBus = ctx.createGain(); g.musicBus.gain.value = vol.music * MUSIC_GAIN; g.musicBus.connect(g.duck);

    var ir = makeIR(ctx, 2.6);
    g.sfxRev = ctx.createConvolver(); g.sfxRev.buffer = ir; g.sfxRev.connect(g.sfx);
    g.musicRev = ctx.createConvolver(); g.musicRev.buffer = ir; g.musicRev.connect(g.musicBus);

    g.noise = makeNoise(ctx, 2);
    g.crackle = makeCrackle(ctx, 1.2);
    return g;
  }

  // =====================================================================
  //  VOICE HELPERS  (all take o.dest; default = sfx bus with optional reverb)
  // =====================================================================
  function out(g, node, o) {
    var c = g.ctx, last = node, dest = o.dest || g.sfx;
    if (o.pan && c.createStereoPanner) {
      var p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan));
      last.connect(p); last = p;
    }
    last.connect(dest);
    if (o.rev && dest === g.sfx) {
      var s = c.createGain(); s.gain.value = o.rev; last.connect(s); s.connect(g.sfxRev);
    }
  }

  // linear attack -> optional hold -> exponential decay. returns end time.
  function env(param, t, a, peak, hold, d) {
    peak = Math.max(peak, 0.0002); a = Math.max(a, 0.001); d = Math.max(d, 0.01); hold = hold || 0;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) param.setValueAtTime(peak, t + a + hold);
    param.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    param.setValueAtTime(0, t + a + hold + d + 0.005);
    return t + a + hold + d;
  }

  function lfo(g, t, end, rate, depth, param, type) {
    var c = g.ctx, o = c.createOscillator(), gg = c.createGain();
    o.type = type || 'sine'; o.frequency.value = rate; gg.gain.value = depth;
    o.connect(gg); gg.connect(param); o.start(t); o.stop(end + 0.05);
  }

  function addFilter(g, src, o, t, total) {
    var f = g.ctx.createBiquadFilter();
    f.type = o.filter; f.Q.value = o.q != null ? o.q : 0.7;
    f.frequency.setValueAtTime(o.ff, t);
    if (o.fpts) {
      for (var i = 0; i < o.fpts.length; i++) f.frequency.exponentialRampToValueAtTime(o.fpts[i][1], t + o.fpts[i][0]);
    } else if (o.ff2) {
      f.frequency.exponentialRampToValueAtTime(o.ff2, t + (o.fglide != null ? o.fglide : total));
    }
    if (o.flfo) lfo(g, t, t + total, o.flfo[0], o.flfo[1], f.frequency);
    src.connect(f);
    return f;
  }

  // oscillator voice
  function tone(g, o) {
    var c = g.ctx, t = o.t, a = o.a != null ? o.a : 0.005, hold = o.hold || 0, d = o.d != null ? o.d : 0.2;
    var total = a + hold + d;
    var osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide != null ? o.glide : total));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.vib) lfo(g, t + (o.vib[2] || 0), t + total, o.vib[0], o.vib[1], osc.frequency);
    var amp = c.createGain(), end = env(amp.gain, t, a, o.peak != null ? o.peak : 0.2, hold, d);
    var n = o.filter ? addFilter(g, osc, o, t, total) : osc;
    n.connect(amp); out(g, amp, o);
    osc.start(t); osc.stop(end + 0.05);
    return osc;
  }

  // filtered noise voice (o.buf = custom buffer, o.trem = [rate, depth])
  function noise(g, o) {
    var c = g.ctx, t = o.t, a = o.a != null ? o.a : 0.005, hold = o.hold || 0, d = o.d != null ? o.d : 0.2;
    var total = a + hold + d, buf = o.buf || g.noise;
    var s = c.createBufferSource(); s.buffer = buf; s.loop = !o.buf;
    s.playbackRate.value = o.rate || 1;
    if (o.filter == null) o.filter = 'bandpass';
    if (o.ff == null) o.ff = 1000;
    var n = addFilter(g, s, o, t, total);
    if (o.trem) {
      var tg = c.createGain(); tg.gain.value = 1 - o.trem[1] / 2;
      lfo(g, t, t + total, o.trem[0], o.trem[1] / 2, tg.gain, o.trem[2] || 'sine');
      n.connect(tg); n = tg;
    }
    var amp = c.createGain(), end = env(amp.gain, t, a, o.peak != null ? o.peak : 0.2, hold, d);
    n.connect(amp); out(g, amp, o);
    s.start(t, o.buf ? 0 : Math.random() * (buf.duration - 0.1)); s.stop(end + 0.05);
  }

  // simple 2-op FM bell. ratio 2 = warm/harmonic, 3.5 = glassy chime.
  // Modulation index auto-shrinks for high notes so bells never get shrill.
  function bell(g, o) {
    var c = g.ctx, t = o.t, f = o.f, d = o.d || 1.2;
    var car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * (o.ratio || 3.5);
    var idx = (o.index == null ? 1.0 : o.index) * f * Math.min(1, 700 / f);
    mg.gain.setValueAtTime(Math.max(idx, 0.01), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(idx * 0.04, 0.01), t + d * 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    var amp = c.createGain(), end = env(amp.gain, t, o.a || 0.003, o.peak || 0.12, 0, d);
    car.connect(amp); out(g, amp, o);
    car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
  }

  // brassy note (saw + triangle through a soft low-pass)
  function brass(g, o) {
    var p = o.peak || 0.08;
    tone(g, { t: o.t, type: 'sawtooth', f: o.f, a: o.a || 0.02, hold: o.hold || 0.08, d: o.d || 0.25, peak: p * 0.7,
      filter: 'lowpass', ff: o.ff || 1800, ff2: (o.ff || 1800) * 0.5, q: 0.8, rev: o.rev, pan: o.pan, dest: o.dest });
    tone(g, { t: o.t, type: 'triangle', f: o.f, a: o.a || 0.02, hold: o.hold || 0.08, d: o.d || 0.25, peak: p,
      rev: o.rev, pan: o.pan, dest: o.dest });
  }

  function duck(g, level, hold) {
    var p = g.duck.gain, now = g.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(level, now, 0.05);
    p.setTargetAtTime(1, now + hold, 0.45);
  }

  // =====================================================================
  //  SOUND EFFECTS  fn(g, t)
  // =====================================================================
  var C5 = 523.25, D5 = 587.33, E5 = 659.26, F5 = 698.46, G5 = 783.99, A5 = 880, B5 = 987.77,
    C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760;

  var SOUNDS = {
    // ---------------- UI ----------------
    click: function (g, t) {
      var r = vary(0.04);
      tone(g, { t: t, type: 'triangle', f: 900 * r, f2: 600 * r, glide: 0.04, a: 0.002, d: 0.06, peak: 0.15 });
      noise(g, { t: t, filter: 'bandpass', ff: 2400, q: 2, a: 0.001, d: 0.02, peak: 0.05 });
    },
    hover: function (g, t) {
      tone(g, { t: t, type: 'sine', f: 1320 * vary(0.03), a: 0.004, d: 0.05, peak: 0.045 });
    },
    open: function (g, t) {
      tone(g, { t: t, f: C5, f2: G5, glide: 0.12, a: 0.01, d: 0.18, peak: 0.15, rev: 0.15 });
      bell(g, { t: t + 0.08, f: C6, ratio: 2, index: 0.6, peak: 0.06, d: 0.5, rev: 0.3 });
      noise(g, { t: t, filter: 'bandpass', ff: 500, ff2: 2500, q: 1, a: 0.06, d: 0.15, peak: 0.05 });
    },
    close: function (g, t) {
      tone(g, { t: t, f: G5, f2: 466, glide: 0.12, a: 0.008, d: 0.16, peak: 0.14, rev: 0.1 });
      noise(g, { t: t, filter: 'bandpass', ff: 2500, ff2: 500, q: 1, a: 0.04, d: 0.12, peak: 0.045 });
      tone(g, { t: t + 0.06, f: 200, f2: 120, a: 0.003, d: 0.08, peak: 0.1 });
    },
    error: function (g, t) {
      for (var i = 0; i < 2; i++) {
        tone(g, { t: t + i * 0.12, type: 'square', f: 180, a: 0.005, hold: 0.06, d: 0.05, peak: 0.08, filter: 'lowpass', ff: 900 });
        tone(g, { t: t + i * 0.12, f: 90, a: 0.005, hold: 0.06, d: 0.05, peak: 0.12 });
      }
    },
    card_draw: function (g, t) {
      var r = vary(0.06);
      noise(g, { t: t, filter: 'bandpass', ff: 4000 * r, ff2: 1600 * r, q: 1.2, a: 0.002, d: 0.07, peak: 0.16, pan: rnd(-0.2, 0.2) });
      tone(g, { t: t, type: 'triangle', f: 1800 * r, f2: 1200 * r, glide: 0.03, d: 0.03, peak: 0.03 });
    },

    // ---------------- school casts ----------------
    cast_stoneward: function (g, t) {          // earth: deep thud, rumble, stone clacks
      tone(g, { t: t, f: 120, f2: 42, glide: 0.35, a: 0.003, d: 0.5, peak: 0.5 });
      tone(g, { t: t, type: 'triangle', f: 70, f2: 50, a: 0.01, d: 0.6, peak: 0.25, filter: 'lowpass', ff: 300 });
      noise(g, { t: t, filter: 'lowpass', ff: 320, ff2: 110, q: 0.7, a: 0.12, hold: 0.15, d: 0.5, peak: 0.4, rate: 0.5, rev: 0.2 });
      var offs = [0.06, 0.15, 0.27, 0.36];
      for (var i = 0; i < offs.length; i++) {
        var p = 0.25 * (1 - i * 0.15);
        noise(g, { t: t + offs[i], filter: 'bandpass', ff: rnd(1400, 2400), q: 6, a: 0.001, d: 0.04, peak: p, pan: rnd(-0.4, 0.4), rev: 0.15 });
        tone(g, { t: t + offs[i], f: rnd(650, 1000), a: 0.001, d: 0.05, peak: p * 0.45 });
      }
    },
    cast_tidecaller: function (g, t) {         // water/moon: wave whoosh, bubbles, moon chimes
      noise(g, { t: t, filter: 'bandpass', ff: 300, fpts: [[0.45, 1400], [1.0, 350]], q: 1.2, a: 0.35, hold: 0.1, d: 0.55, peak: 0.32, rev: 0.3 });
      for (var i = 0; i < 8; i++) {
        var f = rnd(350, 900);
        tone(g, { t: t + i * 0.06 + rnd(0, 0.03), f: f, f2: f * 1.8, glide: 0.04, a: 0.003, d: 0.07, peak: 0.11, pan: rnd(-0.4, 0.4) });
      }
      var ch = [D6, E6, A6];
      for (var j = 0; j < ch.length; j++) bell(g, { t: t + 0.35 + j * 0.09, f: ch[j], ratio: 2, index: 0.6, peak: 0.06, d: 0.9, rev: 0.45, pan: (j - 1) * 0.35 });
    },
    cast_emberstrike: function (g, t) {        // fire/storm: whoosh, zap, thunder, crackle
      noise(g, { t: t, filter: 'bandpass', ff: 400, fpts: [[0.25, 2600], [0.5, 900]], q: 0.9, a: 0.18, d: 0.35, peak: 0.3 });
      tone(g, { t: t + 0.12, type: 'sawtooth', f: 1400, f2: 120, glide: 0.18, a: 0.002, d: 0.2, peak: 0.13,
        filter: 'lowpass', ff: 3000, ff2: 600, vib: [55, 300] });
      tone(g, { t: t + 0.12, type: 'square', f: 900, f2: 80, glide: 0.2, a: 0.002, d: 0.2, peak: 0.06, filter: 'lowpass', ff: 2200 });
      noise(g, { t: t + 0.16, filter: 'lowpass', ff: 900, ff2: 120, a: 0.01, hold: 0.05, d: 0.7, peak: 0.42, rate: 0.6, rev: 0.25 });
      noise(g, { t: t + 0.02, buf: g.crackle, filter: 'highpass', ff: 1500, a: 0.02, d: 0.75, peak: 0.4, pan: 0.15 });
    },
    cast_lumen: function (g, t) {              // good: bright warm bells
      var notes = [G5, B5, D6, G6];
      for (var i = 0; i < notes.length; i++) bell(g, { t: t + i * 0.07, f: notes[i], ratio: 2, index: 0.8, peak: 0.1, d: 1.1, rev: 0.5, pan: (i - 1.5) * 0.25 });
      var pad = [392, 493.88, 587.33];
      for (var j = 0; j < pad.length; j++) tone(g, { t: t, type: 'triangle', f: pad[j], a: 0.15, hold: 0.2, d: 0.7, peak: 0.06, rev: 0.4 });
      noise(g, { t: t + 0.1, filter: 'bandpass', ff: 3500, q: 3, a: 0.2, d: 0.6, peak: 0.03, rev: 0.4 });
    },
    cast_hollow: function (g, t) {             // evil: low dissonance + whispers
      tone(g, { t: t, type: 'sawtooth', f: 98, f2: 82, glide: 1.0, a: 0.15, hold: 0.25, d: 0.6, peak: 0.14, filter: 'lowpass', ff: 700, ff2: 250, rev: 0.3 });
      tone(g, { t: t, type: 'sawtooth', f: 103.8, f2: 87, glide: 1.0, a: 0.15, hold: 0.25, d: 0.6, peak: 0.14, filter: 'lowpass', ff: 700, ff2: 250, rev: 0.3 });
      tone(g, { t: t + 0.05, f: 138.6, a: 0.2, d: 0.7, peak: 0.12 });
      tone(g, { t: t, f: 60, f2: 40, a: 0.05, d: 0.6, peak: 0.3 });
      noise(g, { t: t, filter: 'bandpass', ff: 2200, q: 2.5, a: 0.25, hold: 0.2, d: 0.5, peak: 0.14, trem: [11, 0.9], pan: -0.3, rev: 0.35 });
      noise(g, { t: t + 0.1, filter: 'bandpass', ff: 1100, q: 4, a: 0.2, hold: 0.2, d: 0.5, peak: 0.09, trem: [7, 0.8], pan: 0.3, rev: 0.35 });
    },

    // ---------------- combat results ----------------
    hit: function (g, t) {
      var r = vary(0.05);
      noise(g, { t: t, filter: 'lowpass', ff: 2500 * r, ff2: 400, a: 0.001, d: 0.14, peak: 0.42 });
      tone(g, { t: t, f: 170 * r, f2: 55, glide: 0.12, a: 0.002, d: 0.18, peak: 0.45 });
      noise(g, { t: t, filter: 'bandpass', ff: 1200 * r, q: 1.5, a: 0.001, d: 0.05, peak: 0.2 });
    },
    heal: function (g, t) {
      var n = [C5, E5, G5, C6, E6];
      for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.065, f: n[i], ratio: 2, index: 0.5, peak: 0.11, d: 0.8, rev: 0.45, pan: (i - 2) * 0.15 });
      tone(g, { t: t, f: C5, a: 0.2, d: 0.5, peak: 0.05, rev: 0.4 });
      tone(g, { t: t, f: G5, a: 0.2, d: 0.5, peak: 0.04, rev: 0.4 });
      noise(g, { t: t, filter: 'bandpass', ff: 800, ff2: 3000, q: 1.5, a: 0.3, d: 0.3, peak: 0.04 });
    },
    buff: function (g, t) {                    // blade / trap applied: metallic shing + rising fifth
      tone(g, { t: t, f: 1200, a: 0.005, d: 0.45, peak: 0.07, rev: 0.3 });
      tone(g, { t: t, f: 2890, a: 0.005, d: 0.3, peak: 0.035, rev: 0.3 });
      noise(g, { t: t, filter: 'bandpass', ff: 1500, ff2: 5000, q: 2, a: 0.1, d: 0.15, peak: 0.07 });
      tone(g, { t: t, type: 'triangle', f: 440, a: 0.01, d: 0.15, peak: 0.12 });
      tone(g, { t: t + 0.1, type: 'triangle', f: 660, a: 0.01, d: 0.35, peak: 0.12, rev: 0.3 });
    },
    debuff: function (g, t) {                  // weakness / dot on you: wah-down
      tone(g, { t: t, type: 'square', f: 440, f2: 311, glide: 0.4, a: 0.01, d: 0.5, peak: 0.08, filter: 'lowpass', ff: 1800, ff2: 300, q: 4, rev: 0.2 });
      tone(g, { t: t, type: 'triangle', f: 330, f2: 220, glide: 0.45, a: 0.01, d: 0.5, peak: 0.1 });
      tone(g, { t: t, f: 110, a: 0.02, d: 0.4, peak: 0.12 });
    },
    shield: function (g, t) {                  // glassy dome + bwong
      tone(g, { t: t, f: 196, f2: 247, glide: 0.1, a: 0.005, d: 0.4, peak: 0.2 });
      tone(g, { t: t, f: 392, a: 0.06, hold: 0.1, d: 0.5, peak: 0.08, vib: [7, 4], rev: 0.35 });
      tone(g, { t: t, f: 587.33, a: 0.06, hold: 0.1, d: 0.5, peak: 0.07, vib: [6.3, 5], rev: 0.35 });
      noise(g, { t: t, filter: 'lowpass', ff: 600, a: 0.05, d: 0.3, peak: 0.12 });
      bell(g, { t: t + 0.05, f: G6, ratio: 2.76, index: 0.4, peak: 0.045, d: 0.7, rev: 0.4 });
    },
    windup: function (g, t) {                  // v2.1 A3: 1.5 s wand charge, a rising shimmer
      tone(g, { t: t, type: 'triangle', f: 220, f2: 660, glide: 1.4, a: 0.25, hold: 0.9, d: 0.35, peak: 0.07, vib: [5, 9], filter: 'lowpass', ff: 900, ff2: 3200, rev: 0.3 });
      tone(g, { t: t + 0.1, f: 330, f2: 990, glide: 1.3, a: 0.3, hold: 0.8, d: 0.3, peak: 0.045, vib: [7, 6], rev: 0.35 });
      noise(g, { t: t, filter: 'bandpass', ff: 1800, ff2: 5200, q: 3, a: 0.4, hold: 0.7, d: 0.4, peak: 0.05, trem: [9, 0.6] });
    },
    fizzle: function (g, t) {                  // comedic sputter
      noise(g, { t: t, filter: 'bandpass', ff: 1500, ff2: 300, q: 1.5, a: 0.01, hold: 0.1, d: 0.35, peak: 0.22, trem: [22, 0.9, 'square'] });
      tone(g, { t: t, type: 'triangle', f: 700, f2: 160, glide: 0.45, a: 0.01, d: 0.5, peak: 0.12 });
      tone(g, { t: t + 0.42, f: 300, f2: 150, a: 0.003, d: 0.08, peak: 0.1 });
    },
    death: function (g, t) {
      tone(g, { t: t, type: 'triangle', f: 420, f2: 70, glide: 0.9, a: 0.01, hold: 0.1, d: 0.9, peak: 0.16, filter: 'lowpass', ff: 2000, ff2: 200, rev: 0.3 });
      tone(g, { t: t, type: 'triangle', f: 420, f2: 70, glide: 0.9, detune: -30, a: 0.01, hold: 0.1, d: 0.9, peak: 0.12, filter: 'lowpass', ff: 2000, ff2: 200 });
      noise(g, { t: t + 0.5, filter: 'lowpass', ff: 1200, ff2: 200, a: 0.05, d: 0.5, peak: 0.2, rev: 0.3 });
      tone(g, { t: t + 0.6, f: 90, f2: 40, a: 0.01, d: 0.4, peak: 0.3 });
    },

    // ---------------- rewards / outcomes ----------------
    victory: function (g, t) {
      var run = [C5, E5, G5];
      for (var i = 0; i < run.length; i++) brass(g, { t: t + i * 0.13, f: run[i], hold: 0.06, d: 0.15, peak: 0.1, ff: 2200, rev: 0.25 });
      var s = t + 0.42, chord = [C5, E5, G5, C6];
      for (var j = 0; j < chord.length; j++) brass(g, { t: s, f: chord[j], a: 0.03, hold: 0.6, d: 0.9, peak: 0.055, ff: 1800, rev: 0.4, pan: (j - 1.5) * 0.2 });
      var sp = [C6, E6, G6];
      for (var k = 0; k < sp.length; k++) bell(g, { t: s + k * 0.08, f: sp[k], ratio: 2, index: 0.6, peak: 0.07, d: 1.2, rev: 0.5, pan: (k - 1) * 0.4 });
      tone(g, { t: s, f: 130, f2: 98, a: 0.003, d: 0.5, peak: 0.35 });
      noise(g, { t: s, filter: 'lowpass', ff: 600, a: 0.002, d: 0.3, peak: 0.15 });
    },
    defeat: function (g, t) {
      var n = [392, 349.23, 311.13];
      for (var i = 0; i < n.length; i++) tone(g, { t: t + i * 0.35, type: 'triangle', f: n[i], a: 0.03, hold: 0.15, d: 0.35, peak: 0.15, filter: 'lowpass', ff: 1500, rev: 0.4 });
      var s = t + 1.05, ch = [196, 261.63, 311.13];
      for (var j = 0; j < ch.length; j++) tone(g, { t: s, type: 'triangle', f: ch[j], a: 0.1, hold: 0.4, d: 1.0, peak: 0.1, filter: 'lowpass', ff: 1200, rev: 0.45 });
      tone(g, { t: s, f: 65.41, a: 0.05, hold: 0.3, d: 1.0, peak: 0.22 });
    },
    levelup: function (g, t) {
      tone(g, { t: t, f: 300, f2: 1200, glide: 0.5, a: 0.05, d: 0.45, peak: 0.08, rev: 0.3 });
      noise(g, { t: t, filter: 'bandpass', ff: 400, ff2: 4000, fglide: 0.5, q: 1.5, a: 0.4, d: 0.2, peak: 0.06, rev: 0.3 });
      var run = [C5, D5, E5, G5, A5, C6, D6, E6, G6];
      for (var i = 0; i < run.length; i++) bell(g, { t: t + i * 0.055, f: run[i], ratio: 2, index: 0.5, peak: 0.08, d: 0.6, rev: 0.4, pan: (i - 4) * 0.08 });
      var s = t + 0.55, chord = [C5, E5, G5, C6];
      for (var j = 0; j < chord.length; j++) brass(g, { t: s, f: chord[j], a: 0.04, hold: 0.7, d: 1.0, peak: 0.055, ff: 2000, rev: 0.45, pan: (j - 1.5) * 0.2 });
      var top = [C6, E6, G6];
      for (var k = 0; k < top.length; k++) bell(g, { t: s + 0.05 + k * 0.1, f: top[k], ratio: 2, index: 0.6, peak: 0.07, d: 1.6, rev: 0.55, pan: (k - 1) * 0.45 });
      tone(g, { t: s, f: 110, f2: 55, a: 0.003, d: 0.4, peak: 0.3 });
    },
    loot: function (g, t) {
      bell(g, { t: t, f: B5, ratio: 2, index: 0.6, peak: 0.1, d: 0.5, rev: 0.3 });
      bell(g, { t: t + 0.08, f: E6, ratio: 2, index: 0.6, peak: 0.1, d: 0.6, rev: 0.3 });
      noise(g, { t: t + 0.05, filter: 'bandpass', ff: 3000, q: 4, a: 0.02, d: 0.2, peak: 0.03, rev: 0.3 });
    },
    gold: function (g, t) {                    // cha-ching coin clink
      var hits = [0, 0.075];
      for (var i = 0; i < hits.length; i++) {
        var r = vary(0.03) * (1 + i * 0.06), tt = t + hits[i];
        tone(g, { t: tt, f: 2100 * r, a: 0.001, d: 0.12, peak: 0.065, rev: 0.15 });
        tone(g, { t: tt, f: 2850 * r, a: 0.001, d: 0.1, peak: 0.045, rev: 0.15 });
        tone(g, { t: tt, type: 'square', f: 1050 * r, a: 0.001, d: 0.03, peak: 0.025, filter: 'lowpass', ff: 3000 });
      }
    },
    quest_accept: function (g, t) {
      brass(g, { t: t, f: 392, hold: 0.1, d: 0.3, peak: 0.08, ff: 1400, rev: 0.35 });
      brass(g, { t: t + 0.14, f: C5, hold: 0.15, d: 0.4, peak: 0.1, ff: 1400, rev: 0.35 });
      bell(g, { t: t + 0.14, f: C6, ratio: 2, index: 0.5, peak: 0.06, d: 0.8, rev: 0.4 });
    },
    quest_complete: function (g, t) {
      var m = [E5, G5, C6];
      for (var i = 0; i < m.length; i++) {
        tone(g, { t: t + i * 0.12, type: 'triangle', f: m[i], a: 0.005, d: 0.3, peak: 0.08, rev: 0.3 });
        bell(g, { t: t + i * 0.12, f: m[i], ratio: 2, index: 0.5, peak: 0.07, d: 0.4, rev: 0.35 });
      }
      var s = t + 0.36;
      bell(g, { t: s, f: C6, ratio: 2, index: 0.6, peak: 0.08, d: 1.1, rev: 0.45, pan: -0.25 });
      bell(g, { t: s, f: E6, ratio: 2, index: 0.6, peak: 0.07, d: 1.1, rev: 0.45, pan: 0.25 });
      var pad = [C5, E5, G5];
      for (var j = 0; j < pad.length; j++) tone(g, { t: s, type: 'triangle', f: pad[j], a: 0.05, hold: 0.3, d: 0.6, peak: 0.05, rev: 0.4 });
    },

    // ---------------- world ----------------
    portal: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 300, ff2: 2500, fglide: 1.0, q: 2, flfo: [6, 300], a: 0.3, hold: 0.3, d: 0.5, peak: 0.2, rev: 0.5 });
      tone(g, { t: t, f: 220, f2: 880, glide: 1.0, a: 0.2, hold: 0.3, d: 0.5, peak: 0.08, vib: [6, 15], rev: 0.5 });
      tone(g, { t: t, f: 330, f2: 1320, glide: 1.0, a: 0.2, hold: 0.3, d: 0.5, peak: 0.035, vib: [6, 20], rev: 0.5 });
    },
    wisp: function (g, t) {
      var pool = [C6, D6, E6, G6, A6];
      for (var i = 0; i < 5; i++) bell(g, { t: t + i * 0.09 + rnd(0, 0.03), f: pick(pool), ratio: 2, index: 0.3, peak: 0.05, d: 0.6, rev: 0.55, pan: rnd(-0.6, 0.6) });
      tone(g, { t: t, f: G5, a: 0.1, d: 0.5, peak: 0.04, rev: 0.5 });
    }
  };

  // =====================================================================
  //  v1.1 — SPELL CINEMATICS & DUEL PRESENTATION (agent F, sound-designer)
  // =====================================================================
  function whooshV(g, t, f0, f1, f2, dur, peak, o) {
    o = o || {};
    noise(g, { t: t, filter: 'bandpass', ff: f0, fpts: [[dur * 0.45, f1], [dur, f2]], q: o.q || 1.1, a: dur * 0.4, d: dur * 0.6, peak: peak, pan: o.pan, rev: o.rev != null ? o.rev : 0.2 });
  }
  function crackle(g, t, d, peak, pan) { noise(g, { t: t, buf: g.crackle, filter: 'highpass', ff: 1400, a: 0.02, d: d, peak: peak, pan: pan || 0 }); }
  function thump(g, t, f0, f1, d, peak) { tone(g, { t: t, f: f0, f2: f1, glide: d * 0.7, a: 0.003, d: d, peak: peak }); }
  function screech(g, t, f0, f1, d, peak, o) {
    o = o || {};
    tone(g, { t: t, type: 'sawtooth', f: f0, f2: f1, glide: d, a: 0.02, d: d, peak: peak, filter: 'bandpass', ff: o.ff || 2200, q: 2.5, vib: [o.vr || 28, f0 * 0.03], rev: 0.35, pan: o.pan });
    tone(g, { t: t, f: f0 * 1.5, f2: f1 * 1.5, glide: d, a: 0.02, d: d * 0.8, peak: peak * 0.35, vib: [o.vr || 28, f0 * 0.04], rev: 0.35, pan: o.pan });
  }
  function growl(g, t, f0, f1, d, peak, ff) {
    tone(g, { t: t, type: 'sawtooth', f: f0, f2: f1, glide: d, a: 0.08, hold: d * 0.3, d: d * 0.7, peak: peak, filter: 'bandpass', ff: ff || 500, q: 1.6, vib: [22, f0 * 0.06], rev: 0.3 });
    tone(g, { t: t, type: 'square', f: f0 * 0.5, f2: f1 * 0.5, glide: d, a: 0.08, hold: d * 0.3, d: d * 0.7, peak: peak * 0.5, filter: 'lowpass', ff: 400, rev: 0.25 });
    noise(g, { t: t, filter: 'bandpass', ff: (ff || 500) * 1.4, q: 1.2, a: 0.06, hold: d * 0.3, d: d * 0.7, peak: peak * 0.6, trem: [28, 0.8], rev: 0.25 });
  }
  var V11 = {
    summon: function (g, t) { V11.summon_small(g, t); },
    summon_small: function (g, t) {
      whooshV(g, t, 300, 2600, 1200, 0.45, 0.18, { q: 1.4, rev: 0.35 });
      bell(g, { t: t + 0.18, f: E6, ratio: 2, index: 0.5, peak: 0.06, d: 0.6, rev: 0.5, pan: -0.2 });
      bell(g, { t: t + 0.26, f: B5 * 2, ratio: 2, index: 0.4, peak: 0.04, d: 0.6, rev: 0.5, pan: 0.2 });
    },
    summon_big: function (g, t) {
      whooshV(g, t, 120, 1800, 500, 1.1, 0.26, { q: 0.9, rev: 0.4 });
      tone(g, { t: t, f: 55, f2: 98, glide: 1.0, a: 0.4, hold: 0.3, d: 0.8, peak: 0.28, rev: 0.3 });
      tone(g, { t: t, type: 'sawtooth', f: 110, f2: 196, glide: 1.0, a: 0.5, hold: 0.2, d: 0.7, peak: 0.06, filter: 'lowpass', ff: 600, ff2: 2000, rev: 0.4 });
      var n = [C6, E6, G6, C6 * 2];
      for (var i = 0; i < n.length; i++) bell(g, { t: t + 0.55 + i * 0.08, f: n[i], ratio: 2, index: 0.5, peak: 0.05, d: 1.0, rev: 0.6, pan: (i - 1.5) * 0.3 });
    },
    whoosh: function (g, t) { var r = vary(0.08); whooshV(g, t, 500 * r, 2400 * r, 700 * r, 0.32, 0.22, { pan: rnd(-0.3, 0.3) }); },
    whoosh_big: function (g, t) { whooshV(g, t, 180, 1500, 260, 0.75, 0.3, { q: 0.8, rev: 0.3 }); thump(g, t + 0.1, 80, 50, 0.5, 0.18); },
    shadow_whoosh: function (g, t) {
      whooshV(g, t, 200, 900, 300, 0.5, 0.24, { q: 1.3, rev: 0.4 });
      tone(g, { t: t, type: 'sawtooth', f: 82, f2: 62, glide: 0.5, a: 0.1, d: 0.45, peak: 0.1, filter: 'lowpass', ff: 500, rev: 0.4 });
      noise(g, { t: t + 0.05, filter: 'bandpass', ff: 2400, q: 3, a: 0.15, d: 0.35, peak: 0.06, trem: [13, 0.9], pan: 0.3, rev: 0.4 });
    },
    zap: function (g, t) {
      tone(g, { t: t, type: 'sawtooth', f: 2200, f2: 180, glide: 0.16, a: 0.002, d: 0.2, peak: 0.12, filter: 'lowpass', ff: 4000, ff2: 700, vib: [70, 400] });
      tone(g, { t: t, type: 'square', f: 1400, f2: 120, glide: 0.18, a: 0.002, d: 0.18, peak: 0.05, filter: 'lowpass', ff: 2600 });
      crackle(g, t, 0.35, 0.35, 0.2);
    },
    thunder: function (g, t) {
      noise(g, { t: t, filter: 'highpass', ff: 2500, a: 0.001, d: 0.12, peak: 0.35 });
      noise(g, { t: t + 0.02, filter: 'lowpass', ff: 900, ff2: 90, fglide: 1.2, a: 0.02, hold: 0.15, d: 1.4, peak: 0.45, rate: 0.5, rev: 0.4, trem: [9, 0.5] });
      thump(g, t + 0.02, 70, 34, 1.0, 0.35);
      crackle(g, t, 0.5, 0.3, -0.2);
    },
    ignite: function (g, t) {
      noise(g, { t: t, filter: 'lowpass', ff: 300, ff2: 2200, fglide: 0.25, a: 0.08, d: 0.45, peak: 0.32, rev: 0.25 });
      thump(g, t, 110, 60, 0.35, 0.2);
      crackle(g, t + 0.05, 0.8, 0.38, 0.1);
    },
    crash: function (g, t) {
      thump(g, t, 120, 40, 0.5, 0.5);
      noise(g, { t: t, filter: 'lowpass', ff: 1400, ff2: 200, a: 0.002, d: 0.6, peak: 0.42, rev: 0.3 });
      for (var i = 0; i < 6; i++) noise(g, { t: t + 0.05 + i * rnd(0.04, 0.09), filter: 'bandpass', ff: rnd(1200, 3000), q: 6, a: 0.001, d: 0.05, peak: 0.16, pan: rnd(-0.6, 0.6), rev: 0.2 });
    },
    rumble: function (g, t) {
      noise(g, { t: t, filter: 'lowpass', ff: 160, q: 0.8, a: 0.25, hold: 0.4, d: 0.6, peak: 0.5, rate: 0.5, trem: [7, 0.6], rev: 0.2 });
      tone(g, { t: t, f: 48, a: 0.3, hold: 0.4, d: 0.6, peak: 0.22, vib: [5, 3] });
    },
    rumble_big: function (g, t) {
      noise(g, { t: t, filter: 'lowpass', ff: 130, q: 0.8, a: 0.4, hold: 0.9, d: 1.0, peak: 0.6, rate: 0.4, trem: [5, 0.6], rev: 0.25 });
      tone(g, { t: t, f: 38, f2: 46, glide: 1.5, a: 0.5, hold: 0.8, d: 1.0, peak: 0.3, vib: [4, 2] });
      for (var i = 0; i < 5; i++) noise(g, { t: t + 0.3 + i * 0.3, filter: 'bandpass', ff: rnd(900, 1800), q: 5, a: 0.002, d: 0.06, peak: 0.1, pan: rnd(-0.7, 0.7), rev: 0.3 });
    },
    splash: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 1400, ff2: 500, q: 0.8, a: 0.005, d: 0.5, peak: 0.36, rev: 0.3 });
      thump(g, t, 160, 70, 0.25, 0.25);
      for (var i = 0; i < 9; i++) { var f = rnd(400, 1200); tone(g, { t: t + 0.06 + i * rnd(0.03, 0.07), f: f, f2: f * 1.9, glide: 0.04, a: 0.002, d: 0.06, peak: 0.08, pan: rnd(-0.5, 0.5) }); }
    },
    splash_small: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 2200, ff2: 900, q: 1, a: 0.003, d: 0.25, peak: 0.2, rev: 0.25 });
      for (var i = 0; i < 4; i++) { var f = rnd(600, 1300); tone(g, { t: t + i * 0.05, f: f, f2: f * 1.8, glide: 0.04, a: 0.002, d: 0.05, peak: 0.07, pan: rnd(-0.4, 0.4) }); }
    },
    water_swirl: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 600, q: 2, flfo: [5, 380], a: 0.3, hold: 0.5, d: 0.6, peak: 0.26, rev: 0.4 });
      noise(g, { t: t, filter: 'lowpass', ff: 300, a: 0.3, hold: 0.5, d: 0.6, peak: 0.2, trem: [3, 0.5] });
      for (var i = 0; i < 6; i++) { var f = rnd(300, 800); tone(g, { t: t + 0.2 + i * 0.12, f: f, f2: f * 1.7, glide: 0.05, a: 0.003, d: 0.07, peak: 0.06, pan: rnd(-0.6, 0.6) }); }
    },
    drain: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 2600, ff2: 400, fglide: 0.6, q: 2, a: 0.25, d: 0.4, peak: 0.16, rev: 0.4 });
      tone(g, { t: t, f: 880, f2: 330, glide: 0.6, a: 0.1, d: 0.5, peak: 0.07, vib: [8, 12], rev: 0.4 });
      bell(g, { t: t + 0.45, f: A5, ratio: 2, index: 0.4, peak: 0.06, d: 0.7, rev: 0.5 });
    },
    boom: function (g, t) {
      tone(g, { t: t, f: 75, f2: 32, glide: 0.8, a: 0.004, d: 1.0, peak: 0.6 });
      noise(g, { t: t, filter: 'lowpass', ff: 700, ff2: 80, a: 0.004, hold: 0.06, d: 1.1, peak: 0.5, rate: 0.6, rev: 0.4 });
      noise(g, { t: t, filter: 'highpass', ff: 1800, a: 0.001, d: 0.15, peak: 0.18 });
    },
    hit_big: function (g, t) { SOUNDS.hit(g, t); thump(g, t, 110, 38, 0.4, 0.4); noise(g, { t: t, filter: 'lowpass', ff: 900, ff2: 150, a: 0.002, d: 0.35, peak: 0.3, rev: 0.25 }); },
    impact_emberstrike: function (g, t) {
      noise(g, { t: t, filter: 'lowpass', ff: 2200, ff2: 160, a: 0.002, hold: 0.04, d: 0.6, peak: 0.45, rev: 0.3 });
      thump(g, t, 130, 45, 0.4, 0.38); crackle(g, t + 0.03, 0.7, 0.4, 0.15);
    },
    impact_stoneward: function (g, t) { V11.crash(g, t); },
    impact_tidecaller: function (g, t) { V11.splash(g, t); },
    impact_lumen: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 4000, ff2: 1500, q: 1, a: 0.002, d: 0.35, peak: 0.2, rev: 0.4 });
      thump(g, t, 180, 80, 0.3, 0.25);
      var n = [G5, B5, D6, G6]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.04, f: n[i], ratio: 2, index: 0.7, peak: 0.07, d: 0.9, rev: 0.5, pan: (i - 1.5) * 0.3 });
    },
    impact_hollow: function (g, t) {
      thump(g, t, 95, 35, 0.6, 0.45);
      noise(g, { t: t, filter: 'lowpass', ff: 1200, ff2: 120, a: 0.003, d: 0.6, peak: 0.36, rev: 0.4 });
      tone(g, { t: t, type: 'sawtooth', f: 155, f2: 98, glide: 0.5, a: 0.01, d: 0.5, peak: 0.1, filter: 'lowpass', ff: 800, rev: 0.4 });
      tone(g, { t: t, type: 'sawtooth', f: 164, f2: 104, glide: 0.5, a: 0.01, d: 0.5, peak: 0.1, filter: 'lowpass', ff: 800, rev: 0.4 });
    },
    cry_hawk: function (g, t) { screech(g, t, 1900, 1250, 0.32, 0.14, { pan: -0.2 }); screech(g, t + 0.36, 2100, 1300, 0.42, 0.12, { pan: 0.2 }); },
    cry_phoenix: function (g, t) {
      tone(g, { t: t, type: 'triangle', f: 880, f2: 1320, glide: 0.25, a: 0.05, hold: 0.25, d: 0.6, peak: 0.16, vib: [9, 30, 0.2], rev: 0.55 });
      tone(g, { t: t + 0.35, type: 'triangle', f: 1320, f2: 990, glide: 0.4, a: 0.03, d: 0.6, peak: 0.12, vib: [9, 30], rev: 0.55 });
      screech(g, t, 1500, 1800, 0.5, 0.06, { ff: 3000, vr: 18 });
      bell(g, { t: t + 0.1, f: E6, ratio: 2, index: 0.6, peak: 0.05, d: 1.2, rev: 0.6 });
    },
    roar_drake: function (g, t) { growl(g, t, 95, 62, 1.0, 0.3, 450); noise(g, { t: t, filter: 'lowpass', ff: 260, a: 0.1, hold: 0.4, d: 0.6, peak: 0.3, rev: 0.3 }); },
    roar_serpent: function (g, t) { growl(g, t, 150, 92, 0.9, 0.24, 700); for (var i = 0; i < 6; i++) { var f = rnd(200, 600); tone(g, { t: t + 0.2 + i * 0.1, f: f, f2: f * 1.6, glide: 0.05, a: 0.003, d: 0.08, peak: 0.06 }); } },
    roar_stone: function (g, t) { growl(g, t, 62, 44, 1.2, 0.32, 300); for (var i = 0; i < 5; i++) noise(g, { t: t + 0.1 + i * 0.18, filter: 'bandpass', ff: rnd(800, 1600), q: 5, a: 0.002, d: 0.07, peak: 0.12, pan: rnd(-0.6, 0.6) }); },
    bleat_stone: function (g, t) {
      tone(g, { t: t, type: 'sawtooth', f: 330, f2: 300, glide: 0.5, a: 0.03, hold: 0.25, d: 0.25, peak: 0.12, filter: 'bandpass', ff: 1100, q: 2, vib: [16, 14], rev: 0.3 });
      tone(g, { t: t, type: 'square', f: 165, f2: 150, glide: 0.5, a: 0.03, hold: 0.25, d: 0.25, peak: 0.05, filter: 'lowpass', ff: 700 });
    },
    snort: function (g, t) { for (var i = 0; i < 2; i++) noise(g, { t: t + i * 0.16, filter: 'lowpass', ff: 900, ff2: 300, a: 0.01, d: 0.12, peak: 0.25, rate: 0.7 }); },
    chomp: function (g, t) { noise(g, { t: t, filter: 'bandpass', ff: 1800, q: 2, a: 0.001, d: 0.06, peak: 0.35 }); thump(g, t, 420, 90, 0.12, 0.3); thump(g, t + 0.02, 180, 60, 0.2, 0.25); },
    shriek: function (g, t) {
      tone(g, { t: t, f: 1300, f2: 720, glide: 0.55, a: 0.03, d: 0.55, peak: 0.12, vib: [14, 40], rev: 0.5 });
      noise(g, { t: t, filter: 'bandpass', ff: 2600, q: 3, a: 0.05, d: 0.5, peak: 0.08, trem: [17, 0.9], rev: 0.5 });
    },
    shriek_big: function (g, t) {
      V11.shriek(g, t); tone(g, { t: t + 0.05, f: 980, f2: 520, glide: 0.8, a: 0.05, d: 0.8, peak: 0.1, vib: [11, 35], rev: 0.6, pan: 0.3 });
      tone(g, { t: t, type: 'sawtooth', f: 58, f2: 46, glide: 1.0, a: 0.1, d: 0.9, peak: 0.12, filter: 'lowpass', ff: 300, rev: 0.4 });
    },
    wail: function (g, t) { tone(g, { t: t, f: 420, f2: 700, glide: 0.5, a: 0.2, hold: 0.2, d: 0.7, peak: 0.1, vib: [6, 18], rev: 0.6 }); tone(g, { t: t + 0.1, f: 400, f2: 560, glide: 0.7, a: 0.2, d: 0.8, peak: 0.07, vib: [5, 16], rev: 0.6, pan: -0.3 }); },
    dread_rise: function (g, t) {
      tone(g, { t: t, type: 'sawtooth', f: 55, f2: 110, glide: 1.5, a: 0.5, hold: 0.6, d: 0.8, peak: 0.12, filter: 'lowpass', ff: 300, ff2: 900, rev: 0.4 });
      tone(g, { t: t, type: 'sawtooth', f: 58.3, f2: 116.5, glide: 1.5, a: 0.5, hold: 0.6, d: 0.8, peak: 0.12, filter: 'lowpass', ff: 300, ff2: 900, rev: 0.4 });
      noise(g, { t: t + 0.3, filter: 'bandpass', ff: 1800, q: 3, a: 0.4, hold: 0.4, d: 0.6, peak: 0.09, trem: [9, 0.85], rev: 0.5, pan: -0.3 });
      noise(g, { t: t + 0.5, filter: 'bandpass', ff: 1200, q: 3, a: 0.4, hold: 0.3, d: 0.6, peak: 0.07, trem: [7, 0.85], rev: 0.5, pan: 0.3 });
    },
    gulp: function (g, t) { tone(g, { t: t, f: 220, f2: 90, glide: 0.15, a: 0.005, d: 0.18, peak: 0.25 }); tone(g, { t: t + 0.2, f: 180, f2: 80, glide: 0.15, a: 0.005, d: 0.18, peak: 0.2 }); },
    splat: function (g, t) { noise(g, { t: t, filter: 'lowpass', ff: 1600, ff2: 300, a: 0.002, d: 0.3, peak: 0.36 }); thump(g, t, 190, 60, 0.25, 0.3); },
    creak: function (g, t) { tone(g, { t: t, type: 'sawtooth', f: 85, f2: 65, glide: 0.7, a: 0.05, hold: 0.2, d: 0.5, peak: 0.26, filter: 'bandpass', ff: 650, q: 4, vib: [31, 18], rev: 0.3 }); },
    bone_crack: function (g, t) {
      noise(g, { t: t, filter: 'highpass', ff: 2000, a: 0.001, d: 0.08, peak: 0.36 });
      tone(g, { t: t, f: 950, a: 0.001, d: 0.06, peak: 0.12 }); tone(g, { t: t + 0.04, f: 1350, a: 0.001, d: 0.05, peak: 0.1 });
      thump(g, t, 120, 40, 0.5, 0.45); noise(g, { t: t, filter: 'lowpass', ff: 900, ff2: 150, a: 0.002, d: 0.5, peak: 0.3, rev: 0.3 });
    },
    blade_ring: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 1500, ff2: 6000, q: 2, a: 0.12, d: 0.2, peak: 0.08 });
      tone(g, { t: t + 0.1, f: 1520, a: 0.005, d: 1.1, peak: 0.07, vib: [5, 3], rev: 0.5 });
      tone(g, { t: t + 0.1, f: 2930, a: 0.005, d: 0.8, peak: 0.035, rev: 0.5 });
      tone(g, { t: t + 0.1, f: 4100, a: 0.005, d: 0.5, peak: 0.02, rev: 0.5 });
    },
    blade_shing: function (g, t) { SOUNDS.buff(g, t); tone(g, { t: t, f: 1800, a: 0.004, d: 0.5, peak: 0.05, rev: 0.4 }); },
    cleave: function (g, t) { whooshV(g, t, 300, 1800, 400, 0.35, 0.28); V11.blade_ring(g, t + 0.05); thump(g, t + 0.05, 110, 35, 0.6, 0.45); },
    slash: function (g, t) { var r = vary(0.1); whooshV(g, t, 900 * r, 4000 * r, 1500 * r, 0.18, 0.2); tone(g, { t: t + 0.06, f: 2400 * r, a: 0.002, d: 0.25, peak: 0.04, rev: 0.3 }); },
    whip: function (g, t) { noise(g, { t: t, filter: 'bandpass', ff: 600, ff2: 5000, fglide: 0.12, q: 1.5, a: 0.08, d: 0.06, peak: 0.25 }); noise(g, { t: t + 0.13, filter: 'highpass', ff: 2500, a: 0.001, d: 0.05, peak: 0.35 }); },
    thud: function (g, t) { thump(g, t, 140, 50, 0.3, 0.4); noise(g, { t: t, filter: 'lowpass', ff: 700, a: 0.002, d: 0.15, peak: 0.25 }); },
    croak: function (g, t) {
      tone(g, { t: t, type: 'square', f: 120, f2: 95, glide: 0.5, a: 0.02, hold: 0.25, d: 0.25, peak: 0.12, filter: 'lowpass', ff: 900, rev: 0.25 });
      noise(g, { t: t, filter: 'bandpass', ff: 500, q: 2, a: 0.02, hold: 0.25, d: 0.25, peak: 0.2, trem: [32, 0.95, 'square'] });
    },
    war_cry: function (g, t) {
      brass(g, { t: t, f: 110, hold: 0.45, d: 0.5, peak: 0.12, ff: 900, rev: 0.4 }); brass(g, { t: t, f: 165, hold: 0.45, d: 0.5, peak: 0.1, ff: 900, rev: 0.4 });
      growl(g, t, 130, 95, 0.8, 0.14, 650);
    },
    chime_moon: function (g, t) { var n = [D6, A6 / 2 * 2, F5 * 2, D6 * 2]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.12, f: n[i], ratio: 3.5, index: 0.35, peak: 0.05, d: 1.4, rev: 0.7, pan: (i - 1.5) * 0.35 }); },
    chime_sun: function (g, t) { var n = [C6, E6, G6]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.07, f: n[i], ratio: 2, index: 0.8, peak: 0.07, d: 1.2, rev: 0.6 }); var pd = [523.25, 659.26, 783.99]; for (var j = 0; j < pd.length; j++) tone(g, { t: t, type: 'triangle', f: pd[j], a: 0.3, hold: 0.3, d: 0.8, peak: 0.04, rev: 0.5 }); },
    heal_chime: function (g, t) { var n = [E5, G5, C6, E6]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.06, f: n[i], ratio: 2, index: 0.5, peak: 0.08, d: 0.8, rev: 0.5, pan: (i - 1.5) * 0.2 }); },
    shield_up: function (g, t) { SOUNDS.shield(g, t); },
    trap_snap: function (g, t) {
      tone(g, { t: t, f: 700, f2: 320, glide: 0.08, a: 0.002, d: 0.12, peak: 0.16 });
      noise(g, { t: t, filter: 'bandpass', ff: 3000, q: 4, a: 0.001, d: 0.04, peak: 0.25 });
      tone(g, { t: t + 0.03, f: 1180, a: 0.004, d: 0.45, peak: 0.05, rev: 0.4 }); tone(g, { t: t + 0.03, f: 1770, a: 0.004, d: 0.35, peak: 0.03, rev: 0.4 });
    },
    debuff_chain: function (g, t) { for (var i = 0; i < 5; i++) noise(g, { t: t + i * 0.06, filter: 'bandpass', ff: rnd(2600, 4200), q: 6, a: 0.001, d: 0.05, peak: 0.12, pan: rnd(-0.4, 0.4) }); SOUNDS.debuff(g, t + 0.1); },
    card_flip: function (g, t) { var r = vary(0.06); noise(g, { t: t, filter: 'bandpass', ff: 3200 * r, ff2: 5200 * r, q: 1.6, a: 0.004, d: 0.06, peak: 0.14 }); tone(g, { t: t + 0.03, type: 'triangle', f: 2400 * r, a: 0.002, d: 0.04, peak: 0.03 }); },
    card_deal: function (g, t) { for (var i = 0; i < 3; i++) { var r = vary(0.06); noise(g, { t: t + i * 0.07, filter: 'bandpass', ff: 3800 * r, ff2: 1600 * r, q: 1.2, a: 0.002, d: 0.06, peak: 0.12, pan: (i - 1) * 0.3 }); } },
    duel_start: function (g, t) {
      whooshV(g, t, 200, 2400, 600, 0.6, 0.2, { q: 1, rev: 0.4 });
      bell(g, { t: t + 0.35, f: 196, ratio: 1.41, index: 1.2, peak: 0.16, d: 2.2, rev: 0.6 });
      bell(g, { t: t + 0.35, f: 392, ratio: 2.76, index: 0.5, peak: 0.06, d: 1.6, rev: 0.6 });
      brass(g, { t: t + 0.35, f: 196, hold: 0.25, d: 0.5, peak: 0.08, ff: 1400, rev: 0.4 });
      brass(g, { t: t + 0.35, f: 293.66, hold: 0.25, d: 0.5, peak: 0.06, ff: 1400, rev: 0.4 });
      thump(g, t + 0.35, 90, 45, 0.5, 0.3);
    },
    taunt: function (g, t) { growl(g, t, 140, 105, 0.6, 0.12, 700); },
    enemy_defeat: function (g, t) {
      noise(g, { t: t, filter: 'lowpass', ff: 1400, ff2: 200, a: 0.02, d: 0.5, peak: 0.22, rev: 0.4 });
      tone(g, { t: t, type: 'triangle', f: 520, f2: 130, glide: 0.6, a: 0.01, d: 0.6, peak: 0.1, rev: 0.4 });
      var n = [G6, E6, C6, G5]; for (var i = 0; i < n.length; i++) bell(g, { t: t + 0.2 + i * 0.06, f: n[i], ratio: 2, index: 0.4, peak: 0.04, d: 0.6, rev: 0.6, pan: rnd(-0.5, 0.5) });
    },
    boss_phase: function (g, t) {
      brass(g, { t: t, f: 146.83, hold: 0.4, d: 0.7, peak: 0.12, ff: 1000, rev: 0.5 }); brass(g, { t: t, f: 155.56, hold: 0.4, d: 0.7, peak: 0.1, ff: 1000, rev: 0.5 });
      V11.rumble(g, t); thump(g, t, 80, 40, 0.6, 0.35);
    },
    // ---- loot rarity stingers (agent D) ----
    loot_uncommon: function (g, t) { bell(g, { t: t, f: G5, ratio: 2, index: 0.6, peak: 0.1, d: 0.5, rev: 0.3 }); bell(g, { t: t + 0.08, f: D6, ratio: 2, index: 0.6, peak: 0.1, d: 0.7, rev: 0.35 }); },
    loot_rare: function (g, t) {
      var n = [E5, B5, E6]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.08, f: n[i], ratio: 2, index: 0.7, peak: 0.1, d: 0.8, rev: 0.4, pan: (i - 1) * 0.3 });
      noise(g, { t: t + 0.15, filter: 'bandpass', ff: 5000, q: 3, a: 0.05, d: 0.5, peak: 0.03, rev: 0.5 });
    },
    loot_epic: function (g, t) {
      var n = [D5, A5, D6, F5 * 2]; for (var i = 0; i < n.length; i++) bell(g, { t: t + i * 0.08, f: n[i], ratio: 2, index: 0.8, peak: 0.1, d: 1.0, rev: 0.5, pan: (i - 1.5) * 0.3 });
      var ch = [293.66, 349.23, 440]; for (var j = 0; j < ch.length; j++) tone(g, { t: t + 0.3, type: 'triangle', f: ch[j], a: 0.1, hold: 0.3, d: 0.8, peak: 0.05, rev: 0.5 });
      noise(g, { t: t + 0.3, filter: 'bandpass', ff: 4500, ff2: 8000, q: 2, a: 0.2, d: 0.6, peak: 0.04, rev: 0.5 });
    },
    loot_legendary: function (g, t) {
      whooshV(g, t, 300, 3000, 1200, 0.5, 0.12, { rev: 0.5 });
      var run = [C5, E5, G5]; for (var i = 0; i < run.length; i++) brass(g, { t: t + 0.1 + i * 0.11, f: run[i], hold: 0.05, d: 0.15, peak: 0.09, ff: 2400, rev: 0.3 });
      var s = t + 0.45, ch = [C5, E5, G5, C6];
      for (var j = 0; j < ch.length; j++) brass(g, { t: s, f: ch[j], a: 0.03, hold: 0.7, d: 1.0, peak: 0.055, ff: 2000, rev: 0.5, pan: (j - 1.5) * 0.2 });
      var sp = [C6, E6, G6, C6 * 2]; for (var k = 0; k < sp.length; k++) bell(g, { t: s + k * 0.09, f: sp[k], ratio: 2, index: 0.7, peak: 0.07, d: 1.5, rev: 0.6, pan: (k - 1.5) * 0.35 });
      thump(g, s, 130, 65, 0.5, 0.3);
    },
    // ---- mounts (agent D) ----
    mount_summon: function (g, t) {
      whooshV(g, t, 400, 2800, 900, 0.45, 0.15, { rev: 0.45 });
      bell(g, { t: t + 0.2, f: G5, ratio: 2, index: 0.5, peak: 0.06, d: 0.7, rev: 0.5 }); bell(g, { t: t + 0.28, f: D6, ratio: 2, index: 0.5, peak: 0.05, d: 0.7, rev: 0.5 });
      V11.hoof_step(g, t + 0.42); V11.hoof_step(g, t + 0.56);
    },
    mount_dismiss: function (g, t) {
      noise(g, { t: t, filter: 'bandpass', ff: 2600, ff2: 500, fglide: 0.35, q: 1.2, a: 0.03, d: 0.35, peak: 0.12, rev: 0.4 });
      bell(g, { t: t + 0.05, f: D6, ratio: 2, index: 0.4, peak: 0.05, d: 0.6, rev: 0.5 }); bell(g, { t: t + 0.13, f: G5, ratio: 2, index: 0.4, peak: 0.05, d: 0.6, rev: 0.5 });
    },
    hoof_step: function (g, t) {
      var r = vary(0.08);
      tone(g, { t: t, f: 330 * r, f2: 210 * r, glide: 0.04, a: 0.001, d: 0.06, peak: 0.22, filter: 'bandpass', ff: 900, q: 1.5 });
      noise(g, { t: t, filter: 'bandpass', ff: 1400 * r, q: 2.5, a: 0.001, d: 0.035, peak: 0.18 });
      tone(g, { t: t + 0.07, f: 290 * r, f2: 190 * r, glide: 0.04, a: 0.001, d: 0.05, peak: 0.13, filter: 'bandpass', ff: 800, q: 1.5 });
    },
    whinny: function (g, t) {
      tone(g, { t: t, type: 'sawtooth', f: 620, f2: 900, glide: 0.25, a: 0.03, hold: 0.1, d: 0.15, peak: 0.17, filter: 'bandpass', ff: 1300, q: 2, vib: [24, 60], rev: 0.35 });
      tone(g, { t: t + 0.28, type: 'sawtooth', f: 880, f2: 480, glide: 0.6, a: 0.02, d: 0.65, peak: 0.17, filter: 'bandpass', ff: 1200, q: 2, vib: [21, 70], rev: 0.35 });
      noise(g, { t: t + 0.9, filter: 'lowpass', ff: 800, ff2: 300, a: 0.03, d: 0.25, peak: 0.2 });
    }
  };
  Object.keys(V11).forEach(function (k) { if (!SOUNDS[k]) SOUNDS[k] = V11[k]; });

  // =====================================================================
  //  MUSIC — instruments  fn(g, dest, t, midi, vel, dur, opts)
  // =====================================================================
  var INST = {
    bell: function (g, dest, t, m, v, dur, o) {
      bell(g, { t: t, f: mtof(m), ratio: (o && o.ratio) || 2, index: (o && o.index != null) ? o.index : 0.7, peak: v, d: Math.max(1.3, dur), dest: dest, pan: o && o.pan });
    },
    pluck: function (g, dest, t, m, v, dur, o) {
      var f = mtof(m);
      tone(g, { t: t, type: 'triangle', f: f, a: 0.003, d: 0.5, peak: v, filter: 'lowpass', ff: 2600, ff2: 500, fglide: 0.3, dest: dest, pan: o && o.pan });
      tone(g, { t: t, f: f * 2, a: 0.003, d: 0.18, peak: v * 0.25, dest: dest, pan: o && o.pan });
    },
    flute: function (g, dest, t, m, v, dur, o) {
      var f = mtof(m), d = Math.max(0.4, dur);
      tone(g, { t: t, f: f, a: 0.08, hold: d * 0.5, d: d * 0.6, peak: v, vib: [5, f * 0.006, 0.15], dest: dest, pan: o && o.pan });
      tone(g, { t: t, type: 'triangle', f: f, a: 0.08, hold: d * 0.4, d: d * 0.5, peak: v * 0.25, dest: dest, pan: o && o.pan });
      noise(g, { t: t, filter: 'bandpass', ff: Math.min(f * 2, 3000), q: 3, a: 0.05, d: 0.25, peak: v * 0.15, dest: dest });
    },
    ghost: function (g, dest, t, m, v, dur, o) {      // eerie sliding sine
      var f = mtof(m);
      tone(g, { t: t, f: f, f2: f * 0.944, glide: 2.2, a: 0.5, hold: 0.6, d: 1.2, peak: v, vib: [4.5, f * 0.01, 0.3], dest: dest, pan: o && o.pan });
    },
    bass: function (g, dest, t, m, v, dur) {
      var f = mtof(m);
      tone(g, { t: t, f: f, a: 0.012, hold: dur * 0.5, d: dur * 0.6 + 0.2, peak: v, dest: dest });
      tone(g, { t: t, type: 'triangle', f: f, a: 0.012, hold: dur * 0.4, d: dur * 0.5, peak: v * 0.5, filter: 'lowpass', ff: 500, dest: dest });
    },
    pluckbass: function (g, dest, t, m, v) {
      tone(g, { t: t, type: 'triangle', f: mtof(m), a: 0.004, d: 0.25, peak: v, filter: 'lowpass', ff: 900, ff2: 250, fglide: 0.2, dest: dest });
    },
    pulse: function (g, dest, t, m, v) {
      tone(g, { t: t, type: 'sawtooth', f: mtof(m), a: 0.004, d: 0.15, peak: v, filter: 'lowpass', ff: 900, ff2: 180, fglide: 0.12, q: 3, dest: dest });
    },
    kick: function (g, dest, t, v) {
      tone(g, { t: t, f: 120, f2: 45, glide: 0.12, a: 0.003, d: 0.32, peak: v, dest: dest });
      noise(g, { t: t, filter: 'lowpass', ff: 1500, a: 0.001, d: 0.012, peak: v * 0.2, dest: dest });
    },
    tom: function (g, dest, t, v) {
      tone(g, { t: t, f: 220, f2: 140, glide: 0.08, a: 0.002, d: 0.2, peak: v, dest: dest, pan: 0.2 });
      noise(g, { t: t, filter: 'bandpass', ff: 800, q: 1, a: 0.001, d: 0.04, peak: v * 0.4, dest: dest, pan: 0.2 });
    },
    shaker: function (g, dest, t, v) {
      noise(g, { t: t, filter: 'bandpass', ff: 4500, q: 1.2, a: 0.004, d: 0.05, peak: v, dest: dest, pan: -0.25 });
    },
    taiko: function (g, dest, t, v) {
      tone(g, { t: t, f: 90, f2: 52, glide: 0.2, a: 0.004, d: 0.6, peak: v, dest: dest });
      noise(g, { t: t, filter: 'lowpass', ff: 350, a: 0.002, d: 0.25, peak: v * 0.5, dest: dest });
    }
  };

  function pad(g, dest, t, midis, dur, P) {
    var lvl = P.level / 2;
    for (var i = 0; i < midis.length; i++) {
      var f = mtof(midis[i]);
      for (var k = -1; k <= 1; k += 2) {
        tone(g, { t: t, type: P.wave || 'sawtooth', f: f, detune: k * 7, a: P.attack || 1.2, hold: Math.max(0, dur - (P.attack || 1.2)), d: 1.6,
          peak: lvl, filter: 'lowpass', ff: P.cutoff || 900, q: 0.5, dest: dest, pan: k * 0.3 });
      }
    }
  }

  // sustained layers (returned nodes are stopped when the player is disposed)
  function startDrone(g, dest, t, S) {
    var c = g.ctx, D = S.drone, nodes = [];
    function osc(type, f, level, filterF) {
      var o = c.createOscillator(); o.type = type; o.frequency.value = f;
      var gg = c.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(level, t + 3);
      var n = o;
      if (filterF) {
        var fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filterF; fl.Q.value = 1.2;
        var l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.07; lg.gain.value = filterF * 0.45;
        l.connect(lg); lg.connect(fl.frequency); l.start(t); nodes.push(l);
        o.connect(fl); n = fl;
      }
      n.connect(gg); gg.connect(dest); o.start(t); nodes.push(o);
    }
    if (D.type === 'dark') {
      osc('sawtooth', mtof(S.root - 24), D.level, 260);
      osc('sawtooth', mtof(S.root - 17) * 1.002, D.level * 0.7, 240);
    }
    if (D.type === 'wind') {
      var s = c.createBufferSource(); s.buffer = g.noise; s.loop = true;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
      var l1 = c.createOscillator(), l1g = c.createGain(); l1.frequency.value = 0.05; l1g.gain.value = 400;
      l1.connect(l1g); l1g.connect(bp.frequency);
      var wg = c.createGain(); wg.gain.setValueAtTime(0, t); wg.gain.linearRampToValueAtTime(D.level, t + 3);
      var l2 = c.createOscillator(), l2g = c.createGain(); l2.frequency.value = 0.11; l2g.gain.value = D.level * 0.6;
      l2.connect(l2g); l2g.connect(wg.gain);
      s.connect(bp); bp.connect(wg); wg.connect(dest);
      s.start(t); l1.start(t); l2.start(t); nodes.push(s, l1, l2);
      osc('sine', mtof(S.root - 24), D.level * 0.9, 0);
    }
    return nodes;
  }

  // =====================================================================
  //  MUSIC — styles  (chords: [bassOffset, voicing...] relative to root)
  // =====================================================================
  var PENTA = [0, 2, 4, 7, 9], DOR = [0, 2, 3, 5, 7, 9, 10], AEOL = [0, 2, 3, 5, 7, 8, 10],
    MINP = [0, 3, 5, 7, 10], HARM = [0, 2, 3, 5, 7, 8, 11];

  var STYLES = {
    town: {   // D major pentatonic: warm bells over a soft pad, music-box arp
      bpm: 76, root: 62, scale: PENTA, barsPerChord: 2, reverb: 0.35,
      chords: [[0, 0, 4, 7], [-3, -3, 0, 4], [-7, -3, 0, 5], [-5, -1, 2, 7]],
      pad: { level: 0.05, cutoff: 950, wave: 'sawtooth' },
      bass: { inst: 'bass', level: 0.11, pattern: [0, null, null, null, null, null, 7, null] },
      lead: { inst: 'bell', level: 0.075, density: 0.38, oct: 12, range: [0, 7], ratio: 2, index: 0.7 },
      arp: { inst: 'bell', level: 0.03, oct: 12, pattern: [0, null, 1, null, 2, null, 1, null], ratio: 3.5, index: 0.4 },
      sparkle: 0.12
    },
    meadow: { // G major pentatonic: flute + plucked arpeggio, pastoral
      bpm: 100, root: 67, scale: PENTA, barsPerChord: 2, reverb: 0.3,
      chords: [[0, 0, 4, 7], [5, 0, 5, 9], [-3, 0, 4, 9], [-5, -1, 2, 7]],
      pad: { level: 0.03, cutoff: 1300, wave: 'triangle' },
      bass: { inst: 'bass', level: 0.1, pattern: [0, null, null, null, 7, null, null, null] },
      lead: { inst: 'flute', level: 0.06, density: 0.32, oct: 0, range: [3, 9] },
      arp: { inst: 'pluck', level: 0.04, oct: 0, pattern: [0, 1, 2, 3, 2, 1, 2, 1] },
      sparkle: 0.06
    },
    forest: { // D dorian: airy wind, slow flute, mysterious pad
      bpm: 66, root: 62, scale: DOR, barsPerChord: 2, reverb: 0.5,
      chords: [[0, 0, 3, 7], [-7, -3, 0, 5], [0, 0, 3, 7], [-2, -2, 2, 5]],
      pad: { level: 0.045, cutoff: 700, wave: 'sawtooth', attack: 2 },
      drone: { type: 'wind', level: 0.05 },
      bass: { inst: 'bass', level: 0.08, pattern: [0, null, null, null, null, null, null, null] },
      lead: { inst: 'flute', level: 0.055, density: 0.2, oct: 0, range: [2, 10] },
      sparkle: 0.1, sparkleInst: { ratio: 3.5, index: 0.4 }
    },
    ruins: {  // A aeolian: low drone, sparse dark bells, ghost tones, distant booms
      bpm: 56, root: 57, scale: AEOL, barsPerChord: 2, reverb: 0.6,
      chords: [[0, 0, 3, 7], [-4, -4, 0, 3], [-7, -7, -4, 0], [-5, -2, 2, 7]],
      pad: { level: 0.03, cutoff: 500, wave: 'sawtooth', attack: 2.5 },
      drone: { type: 'dark', level: 0.07 },
      lead: { inst: 'bell', level: 0.06, density: 0.1, oct: 12, range: [0, 7], ratio: 3.5, index: 0.5 },
      drums: [{ inst: 'taiko', level: 0.12, pattern: [1].concat(new Array(31).fill(0)) }],
      ghost: 0.2
    },
    battle: { // E minor: light percussion, bouncing bass, plucky motif
      bpm: 124, root: 64, scale: MINP, barsPerChord: 1, reverb: 0.25,
      chords: [[0, 0, 3, 7], [-4, -4, 0, 3], [-2, -2, 2, 5], [-5, -2, 2, 7]],
      pad: { level: 0.025, cutoff: 900, wave: 'sawtooth', attack: 0.6 },
      bass: { inst: 'pluckbass', level: 0.11, pattern: [0, null, 0, 12, null, 0, 7, null] },
      lead: { inst: 'pluck', level: 0.06, density: 0.45, oct: 0, range: [3, 11] },
      drums: [
        { inst: 'kick', level: 0.3, pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.6] },
        { inst: 'tom', level: 0.1, pattern: [0, 0, 0.8, 0, 0, 0, 0.8, 0.5, 0, 0, 0.8, 0, 0, 0.6, 0.8, 0] },
        { inst: 'shaker', level: 0.022, pattern: [0.4, 0.8, 0.4, 0.8, 0.4, 0.8, 0.4, 0.8] }
      ]
    },
    boss: {   // D harmonic minor: driving low pulses, taiko, Neapolitan tension
      bpm: 140, root: 62, scale: HARM, barsPerChord: 1, reverb: 0.3,
      chords: [[0, 0, 3, 7], [-4, -4, 0, 3], [1, 1, 5, 8], [-5, -1, 2, 7]],
      pad: { level: 0.03, cutoff: 700, wave: 'sawtooth', attack: 0.5 },
      drone: { type: 'dark', level: 0.045 },
      bass: { inst: 'pulse', level: 0.085, pattern: [0, 0, 0, 0, 0, 0, 0, 0], accent: [1, 0.6, 0.7, 0.6, 1, 0.6, 0.75, 0.8] },
      lead: { inst: 'pluck', level: 0.05, density: 0.3, oct: 0, range: [4, 11] },
      drums: [
        { inst: 'kick', level: 0.3, pattern: [1, 0, 0, 1, 0, 0, 1, 0] },
        { inst: 'taiko', level: 0.16, pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.7, 0] },
        { inst: 'shaker', level: 0.02, pattern: [0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.9] }
      ]
    }
  };

  function scaleNote(S, deg, oct) {
    var L = S.scale.length, o = Math.floor(deg / L), i = ((deg % L) + L) % L;
    return S.root + oct + 12 * o + S.scale[i];
  }

  function genMotif(S) {
    var L = S.lead, m = new Array(16), deg = L.range[0] + ((Math.random() * (L.range[1] - L.range[0] + 1)) | 0), count = 0;
    for (var i = 0; i < 16; i++) {
      var dens = L.density * (i % 2 === 0 ? 1.3 : 0.6);
      if (Math.random() < dens) {
        deg += pick([-2, -1, -1, 0, 1, 1, 2]);
        deg = Math.max(L.range[0], Math.min(L.range[1], deg));
        m[i] = deg; count++;
      } else m[i] = null;
    }
    if (count < 2) { m[0] = L.range[0] + 2; m[8] = L.range[0] + 1; }
    return m;
  }

  function Player(g, style, t, fadeIn) {
    var c = g.ctx, S = STYLES[style];
    this.g = g; this.S = S; this.style = style;
    this.fade = c.createGain();
    this.fade.gain.setValueAtTime(0, t);
    this.fade.gain.linearRampToValueAtTime(1, t + Math.max(0.01, fadeIn));
    this.fade.connect(g.musicBus);
    this.rev = c.createGain(); this.rev.gain.value = S.reverb || 0.3;
    this.fade.connect(this.rev); this.rev.connect(g.musicRev);
    this.stepDur = 60 / S.bpm / 2;              // 8th notes
    this.nextTime = t + 0.05; this.step = 0;
    this.motif = S.lead ? genMotif(S) : null; this.reps = 0;
    this.endTime = Infinity;
    this.drones = S.drone ? startDrone(g, this.fade, t, S) : [];
  }

  Player.prototype.stop = function (t, fadeOut) {
    var p = this.fade.gain, cur = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(cur, t);
    p.linearRampToValueAtTime(0, t + fadeOut);
    this.endTime = t + fadeOut + 0.05;
  };

  Player.prototype.dispose = function () {
    for (var i = 0; i < this.drones.length; i++) { try { this.drones[i].stop(); } catch (e) { /* already stopped */ } }
    try { this.fade.disconnect(); this.rev.disconnect(); } catch (e2) { /* ignore */ }
  };

  Player.prototype.schedule = function (until, now) {
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.02;   // fell behind (tab throttled): resync
    while (this.nextTime < until && this.nextTime < this.endTime) {
      this.doStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  };

  Player.prototype.doStep = function (s, t) {
    var g = this.g, S = this.S, dest = this.fade, sd = this.stepDur, pos = s % 8, bar = Math.floor(s / 8);
    var chord = S.chords[Math.floor(bar / S.barsPerChord) % S.chords.length];
    var voicing = chord.slice(1);
    var j, n, v;

    // pad on chord change
    if (S.pad && pos === 0 && bar % S.barsPerChord === 0) {
      var midis = [];
      for (j = 0; j < voicing.length; j++) midis.push(S.root - 12 + voicing[j]);
      pad(g, dest, t, midis, sd * 8 * S.barsPerChord, S.pad);
    }
    // bass
    if (S.bass) {
      n = S.bass.pattern[s % S.bass.pattern.length];
      if (n != null) {
        v = S.bass.level * (S.bass.accent ? S.bass.accent[s % S.bass.accent.length] : (pos === 0 ? 1 : 0.85));
        INST[S.bass.inst](g, dest, t, S.root - 24 + chord[0] + n, v, sd * 2);
      }
    }
    // arpeggio over chord tones
    if (S.arp) {
      n = S.arp.pattern[s % S.arp.pattern.length];
      if (n != null) {
        var vi = n % voicing.length, octUp = Math.floor(n / voicing.length) * 12;
        INST[S.arp.inst](g, dest, t, S.root + S.arp.oct + voicing[vi] + octUp, S.arp.level * rnd(0.85, 1.05), sd * 2,
          { pan: (s % 2 ? 0.2 : -0.2), ratio: S.arp.ratio, index: S.arp.index });
      }
    }
    // drums
    if (S.drums) {
      for (j = 0; j < S.drums.length; j++) {
        var D = S.drums[j], hv = D.pattern[s % D.pattern.length];
        if (hv > 0) INST[D.inst](g, dest, t + rnd(0, 0.006), D.level * hv * rnd(0.88, 1.05));
      }
    }
    // generative lead motif (2 bars, mutates slowly, snapped to chord on strong beats)
    if (S.lead) {
      var deg = this.motif[s % 16];
      if (deg != null) {
        var midi = scaleNote(S, deg, S.lead.oct);
        if (pos % 4 === 0) midi = snapToChord(midi, S.root, chord);
        INST[S.lead.inst](g, dest, t + rnd(0, 0.01), midi, S.lead.level * rnd(0.8, 1.05) * (pos === 0 ? 1.1 : 1), sd * 2,
          { pan: rnd(-0.25, 0.25), ratio: S.lead.ratio, index: S.lead.index });
      }
      if (s % 16 === 15) {
        this.reps++;
        if (this.reps % 8 === 0) this.motif = genMotif(S);
        else if (Math.random() < 0.4) mutate(this.motif, S);
      }
    }
    // occasional sparkle arpeggio
    if (S.sparkle && pos === 0 && Math.random() < S.sparkle) {
      var si = S.sparkleInst || { ratio: 2, index: 0.4 }, sb = S.root >= 66 ? 12 : 24;   // keep sparkles ~1-1.6 kHz
      for (j = 0; j < 3; j++) {
        bell(g, { t: t + sd * 4 + j * 0.09, f: mtof(scaleNote(S, j * 2, sb)),
          ratio: si.ratio, index: si.index, peak: 0.025, d: 1.0, dest: dest, pan: (j - 1) * 0.5 });
      }
    }
    // ghost tones (ruins)
    if (S.ghost && pos === 4 && bar % 2 === 1 && Math.random() < S.ghost * 2) {
      INST.ghost(g, dest, t, scaleNote(S, pick([4, 5, 7, 8]), 0), 0.035, 2, { pan: rnd(-0.6, 0.6) });
    }
  };

  function snapToChord(midi, root, chord) {
    var pcs = [];
    for (var i = 0; i < chord.length; i++) pcs.push((((root + chord[i]) % 12) + 12) % 12);
    for (var d = 0; d <= 3; d++) {
      if (pcs.indexOf(((midi - d) % 12 + 12) % 12) >= 0) return midi - d;
      if (pcs.indexOf(((midi + d) % 12 + 12) % 12) >= 0) return midi + d;
    }
    return midi;
  }

  function mutate(m, S) {
    var L = S.lead, k = 1 + ((Math.random() * 2) | 0);
    for (var i = 0; i < k; i++) {
      var p = (Math.random() * 16) | 0;
      if (m[p] == null) { if (Math.random() < L.density) m[p] = L.range[0] + ((Math.random() * (L.range[1] - L.range[0] + 1)) | 0); }
      else if (Math.random() < 0.3) m[p] = null;
      else m[p] = Math.max(L.range[0], Math.min(L.range[1], m[p] + pick([-1, 1])));
    }
  }

  // =====================================================================
  //  SCHEDULER + MUSIC CONTROL
  // =====================================================================
  function tick() {
    try {
      if (!G || G.ctx.state !== 'running') return;
      var now = G.ctx.currentTime;
      var la = (typeof document !== 'undefined' && document.hidden) ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
      for (var i = players.length - 1; i >= 0; i--) {
        var p = players[i];
        if (p.endTime < now) { p.dispose(); players.splice(i, 1); continue; }
        p.schedule(now + la, now);
      }
    } catch (e) { /* never throw from the timer */ }
  }

  function applyMusic() {
    if (!G) return;
    var now = G.ctx.currentTime, cur = null;
    for (var i = 0; i < players.length; i++) if (players[i].endTime === Infinity) cur = players[i];
    if (cur && cur.style === wantStyle) return;
    if (cur) cur.stop(now, FADE);
    if (wantStyle) players.push(new Player(G, wantStyle, now, FADE));
    tick();
  }

  function resume() {
    try { if (G && G.ctx.state === 'suspended' && G.ctx.resume) { var pr = G.ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) { /* ignore */ }
  }

  // =====================================================================
  //  PUBLIC API
  // =====================================================================
  WF.sfx = {
    list: NAMES.slice(),
    styles: STYLE_NAMES.slice(),

    init: function () {
      try {
        if (G) { resume(); return true; }
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return false;
        var ctx;
        try { ctx = new Ctor({ latencyHint: 'interactive' }); } catch (e) { ctx = new Ctor(); }
        G = buildGraph(ctx);
        resume();
        if (!timer) timer = setInterval(tick, TICK_MS);
        if (wantStyle) applyMusic();
        return true;
      } catch (err) {
        G = null;
        return false;
      }
    },

    isReady: function () { return !!G; },

    play: function (name) {
      try {
        if (!G) return;
        var fn = SOUNDS[name];
        if (!fn) return;
        resume();
        var now = G.ctx.currentTime;
        var gap = MIN_GAP[name] || 0.03;
        if (lastPlay[name] != null && now - lastPlay[name] < gap && now >= lastPlay[name]) return;
        while (recent.length && now - recent[0] > 0.15) recent.shift();
        if (recent.length >= 12 && name === 'hover') return;
        if (recent.length >= 16) return;                // global voice cap
        lastPlay[name] = now; recent.push(now);
        fn(G, now + 0.005);
        if (DUCKERS[name]) duck(G, DUCKERS[name][0], DUCKERS[name][1]);
      } catch (e) { /* silent */ }
    },

    music: function (style) {
      try {
        wantStyle = (style && STYLES[style]) ? style : null;
        if (!G) return;
        resume();
        applyMusic();
      } catch (e) { /* silent */ }
    },

    setVolume: function (master, music) {
      try {
        var m = clamp01(master), mu = clamp01(music);
        if (m != null) vol.master = m;
        if (mu != null) vol.music = mu;
        if (!G) return;
        var now = G.ctx.currentTime;
        G.master.gain.setTargetAtTime(vol.master, now, 0.03);
        G.musicBus.gain.setTargetAtTime(vol.music * MUSIC_GAIN, now, 0.03);
      } catch (e) { /* silent */ }
    },

    getVolume: function () { return { master: vol.master, music: vol.music }; },

    // TEST HOOK: render one sound or music style offline. Resolves to an AudioBuffer.
    _renderOffline: function (name, seconds, sampleRate) {
      try {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
        // Sounds start after SETTLE seconds: Chrome's compressors attenuate anything in
        // their first few hundred ms, which would under-report levels. buf.wfOffset = SETTLE.
        var SETTLE = 0.6, sr = sampleRate || 44100, secs = seconds || 3;
        var ctx = new OAC(2, Math.ceil(sr * (secs + SETTLE)), sr), g = buildGraph(ctx);
        if (SOUNDS[name]) SOUNDS[name](g, SETTLE);
        else if (STYLES[name]) new Player(g, name, SETTLE, 0.05).schedule(secs + SETTLE, SETTLE);
        else return Promise.reject(new Error('unknown sound ' + name));
        return ctx.startRendering().then(function (buf) { buf.wfOffset = SETTLE; return buf; });
      } catch (e) { return Promise.reject(e); }
    }
  };
})();
