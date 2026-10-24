// =====================================================================
//  WIZZIE FARM — VOICE PROFILES  (v1.2 WS7 "NPC voices")
//
//  One profile per speaker id: every NPC id in npcs.js, every enemy id in
//  enemies.js that has spoken lines, plus 'narrator'. Used in two places:
//    * tools/gen-voices.py renders every line OFFLINE with the neural TTS
//      (Kokoro-82M, Apache-2.0) using `tts` + `fx`, into
//      game/audio/voice/<speaker>/<hash>.ogg  (see docs/VOICES.md)
//    * game/js/voice.js plays those clips; for a line with no clip it falls
//      back to the browser's speech synthesis using `web`.
//
//  Fields
//    note     who this voice is (for writers and the audio-director)
//    base     inherit every field from another profile, then override
//    address  spoken in place of {name} (pre-rendered clips can't know the
//             player's name; the TEXT still shows the real name, the way
//             classic wizard MMOs say "young wizard")
//    tts      { voice, lang, speed }
//               voice  Kokoro voice id, or a blend "am_onyx*0.7+bm_george*0.3". Main
//                      NPCs use the higher-quality packs (af_heart, af_bella, bf_emma,
//                      am_fenrir, am_michael, am_puck, bm_george, bm_fable...); the
//                      rougher packs (am_onyx, am_echo, af_river, bm_daniel) only
//                      appear blended or under heavy monster processing.
//               lang   'en-us' | 'en-gb' (phonemizer accent)
//               speed  0.5..2 (1 = normal)
//    fx       offline post-processing (all optional)
//               pitch     semitones (rubberband; + = higher)
//               formant   'shifted' (default: bigger/smaller body) | 'preserved'
//               vibrato   [hz, depth 0..1]   old-age quaver / unearthly wobble
//               tremolo   [hz, depth 0..1]
//               chorus    0..1               many voices at once (cultists, spirits)
//               layer     [semitones, gain]  a pitched copy mixed under the voice
//                                            (-12 = shadowy sub-octave)
//               echo      [delayMs, decay]   short metallic slap (armour, helmets)
//               reverb    [seconds, wet 0..1] synthetic room / hall / cave tail
//               lowpass, highpass   Hz
//               maxPause  seconds: shorten longer pauses between sentences
//    web      Web Speech fallback { lang, gender, prefer: [voice name parts], pitch 0..2, rate 0.1..10 }
//    variants { freed: {...} }  overrides for a line kind (bossLines.freed)
//    Merging (base and variants): tts / fx / web are merged key by key;
//    a key set to null removes the inherited value (e.g. fx: { layer: null }).
//
//  Changing a profile makes tools/gen-voices.py re-render that speaker's
//  clips on its next run (every clip stores a signature of its settings).
// =====================================================================
window.WF = window.WF || { data: {} };

// Pronunciation fixes for the offline TTS (whole words; case-insensitive,
// except keys written in ALL CAPS, which match only that exact spelling).
// The TEXT on screen never changes; only what the voice is fed. Checked
// against the phonemizer's output (tools/gen-voices.py --phonemes "word").
WF.data.voiceLexicon = {
  'Aurelia': 'Oreelia',            // not "AW-ril-eye-a"
  "Aurelia's": "Oreelia's",
  'Emberstrike': 'Ember-strike',   // stress on EM, not em-BER
  'Emberstrikes': 'Ember-strikes',
  "Emberstrike's": "Ember-strike's",
  'Ignis': 'Igniss',               // not "Ig-niz"
  'Tomas': 'Tommus',
  'Archon': 'Arkon',               // not "Ar-chon"
  'Granitemere': 'Granite-meer',
  'Cindralis': 'Sin-drahliss',     // v2.0: "sin-DRAH-liss", not "sin-DRAH-leez"
  'Ah. A little lamp': 'Ah... A little lamp',  // v2.0, Archon intro only: a held beat after "Ah"; without it "Ah. A little" fused into "I'll allow"
  'Brrroak': 'Bur-roke',           // otherwise spelled out letter by letter
  'Hm': 'Hmm',                     // otherwise "aitch-em"
  'Hmph': 'Humph',
  'Nyeh': 'Nyeah',
  "'ow'": 'ouw',                   // the pain noise, not "oh"
  'huuug': 'hugg',
  'BOW': 'Bough'                   // the verb (Grubnak: "BOW, little wizard!")
};

// Played when the player turns voices on or sets the voice volume in the menu
// (must be a real line so it has a pre-rendered clip).
WF.data.voicePreview = { speaker: 'aurelia', text: 'The light is only kept by those who share it, dear one. Remember that.' };

WF.data.voices = {
  // Used for any speaker without a profile (new NPCs before they get one).
  _default: {
    note: 'Fallback for speakers without a profile.',
    address: 'young wizard',
    tts: { voice: 'af_sarah', lang: 'en-us', speed: 1.0 },
    fx: {},
    web: { lang: 'en-US', gender: 'female', prefer: ['Aria', 'Jenny', 'Zira', 'Samantha'], pitch: 1.0, rate: 1.0 }
  },

  narrator: {
    note: 'Storybook narrator for the intro, zone arrivals and the chapter ending. Warm, hushed, unhurried.',
    address: 'young wizard',
    tts: { voice: 'af_heart', lang: 'en-us', speed: 0.92 },
    fx: { reverb: [1.2, 0.06] },
    web: { lang: 'en-US', gender: 'female', prefer: ['Aria', 'Jenny', 'Samantha', 'Zira'], pitch: 1.0, rate: 0.9 }
  },

  // ------------------------------------------------ LANTERNMERE
  aurelia: {
    note: 'Headmistress of the Lumen Order. Elderly, warm, wry, unhurried; never panics. British. Calls you "dear one".',
    address: 'dear one',
    tts: { voice: 'bf_emma', lang: 'en-gb', speed: 0.9 },
    fx: { pitch: -0.6, formant: 'preserved', reverb: [1.4, 0.07] },
    web: { lang: 'en-GB', gender: 'female', prefer: ['Sonia', 'Libby', 'Hazel', 'Susan', 'Zira'], pitch: 0.95, rate: 0.9 }
  },

  brannoc: {
    note: 'Stoneward master. Big, bearded, slow and deadpan; few words, full stops. A voice like a rockslide taking its time. Calls students "pebble".',
    address: 'pebble',
    tts: { voice: 'am_fenrir*0.5+am_onyx*0.3+bm_george*0.2', lang: 'en-us', speed: 0.82 },
    fx: { pitch: -2.5, formant: 'shifted' },
    web: { lang: 'en-US', gender: 'male', prefer: ['Guy', 'David', 'George', 'Mark'], pitch: 0.55, rate: 0.82 }
  },

  maris: {
    note: 'Tidecaller master. Calm, poetic, gently teasing; soft balanced sentences with a sly joke at the end. A hint of sea-cave air.',
    address: 'young one',
    tts: { voice: 'af_aoede', lang: 'en-us', speed: 0.88 },
    fx: { reverb: [1.8, 0.08] },
    web: { lang: 'en-US', gender: 'female', prefer: ['Michelle', 'Jenny', 'Zira', 'Samantha'], pitch: 0.95, rate: 0.88 }
  },

  ignis: {
    note: 'Emberstrike master. Loud, delighted, speaks in CAPITALS and exclamation marks; missing his eyebrows again. Quick and bright.',
    address: 'spark',
    tts: { voice: 'am_puck', lang: 'en-us', speed: 1.12 },
    fx: { pitch: 0.6, formant: 'preserved' },
    web: { lang: 'en-US', gender: 'male', prefer: ['Eric', 'Mark', 'David', 'Alex'], pitch: 1.2, rate: 1.15 }
  },

  pip_quickcoin: {
    note: 'Merchant. Small, fast-talking, cheerful sales patter; everyone is his favourite customer. A little voice for a little fellow.',
    address: 'friend',
    tts: { voice: 'am_michael', lang: 'en-us', speed: 1.14 },
    fx: { pitch: 3.2, formant: 'shifted' },
    web: { lang: 'en-US', gender: 'male', prefer: ['Eric', 'Mark', 'David'], pitch: 1.5, rate: 1.2 }
  },

  guard_tomas: {
    note: 'Lanternmere Watch. Earnest, brave in words, nervous in practice; "Halt!" and self-reassurance. A plain, slightly over-loud guard.',
    address: 'young wizard',
    tts: { voice: 'am_fenrir', lang: 'en-us', speed: 1.04 },
    fx: {},
    web: { lang: 'en-US', gender: 'male', prefer: ['Christopher', 'David', 'Mark'], pitch: 0.9, rate: 1.05 }
  },

  hollis: {
    note: 'Stablemaster. Folksy, warm, a twinkle of mischief; talks about horses like family. Calls you "partner".',
    address: 'partner',
    tts: { voice: 'am_michael*0.5+am_fenrir*0.5', lang: 'en-us', speed: 0.97 },
    fx: { pitch: -1.0, formant: 'shifted' },
    web: { lang: 'en-US', gender: 'male', prefer: ['Roger', 'David', 'Mark'], pitch: 0.8, rate: 0.95 }
  },

  tamsin: {
    note: 'Tamsin Gearwright, Master Artificer (v1.2 crafter, Lanternmere). Warm, brisk and clever: thinks faster than she talks and talks quite fast.',
    address: 'apprentice',
    tts: { voice: 'bf_isabella*0.7+af_heart*0.3', lang: 'en-gb', speed: 1.06 },
    fx: {},
    web: { lang: 'en-GB', gender: 'female', prefer: ['Libby', 'Sonia', 'Hazel', 'Susan'], pitch: 1.05, rate: 1.08 }
  },

  // v2.0 M1 (WS-A): Oswin Lenscroft, the Spellwright (Lanternmere lens bench)
  spellwright: {
    note: 'Oswin Lenscroft, the Spellwright (v2.0). Lanternwright descendant who grinds Runeglass into spells. Soft-spoken, precise, gently rueful about his family; warm, hums while he works. An older British man.',
    address: 'friend',
    tts: { voice: 'bm_fable*0.6+bm_george*0.4', lang: 'en-gb', speed: 0.94 },
    fx: { pitch: -0.5, formant: 'preserved' },
    web: { lang: 'en-GB', gender: 'male', prefer: ['George', 'Ryan', 'Daniel', 'Arthur'], pitch: 0.9, rate: 0.94 }
  },

  banker: {
    note: 'Orsolya Coffersmith, keeper of the Lanternmere Vault (v1.2, WS8 adds the NPC). Dry, precise, unimpressed; counts everything twice and every word once. A small stone room around her.',
    address: 'depositor',
    tts: { voice: 'af_sarah*0.6+bf_alice*0.4', lang: 'en-gb', speed: 0.96 },
    fx: { pitch: -0.8, formant: 'preserved', reverb: [0.7, 0.05] },
    web: { lang: 'en-GB', gender: 'female', prefer: ['Hazel', 'Susan', 'Sonia', 'Libby', 'Zira'], pitch: 0.9, rate: 0.95 }
  },

  // ------------------------------------------------ MOSSLIGHT PATH
  fennick: {
    note: 'Old Fennick, bog hermit. Forgetful, kind, rambling, talks to his mushroom Gerald. An old British gent with a slight quaver. Calls you "young sprout".',
    address: 'young sprout',
    tts: { voice: 'bm_fable', lang: 'en-gb', speed: 0.92 },
    fx: { pitch: 0.8, formant: 'preserved', vibrato: [5.5, 0.05] },
    web: { lang: 'en-GB', gender: 'male', prefer: ['Ryan', 'George', 'Thomas', 'David'], pitch: 1.1, rate: 0.85 }
  },

  // ------------------------------------------------ WHISPERWOOD
  sela: {
    note: 'Ranger Sela. Terse, dry, sarcastic, secretly soft; keeps her voice down because the trees are listening. Low and breathy.',
    address: 'wizard',
    tts: { voice: 'af_nicole', lang: 'en-us', speed: 1.0 },
    fx: { maxPause: 0.42 },          // af_nicole leaves 1-1.5 s gaps between sentences; Sela is terse
    web: { lang: 'en-US', gender: 'female', prefer: ['Ana', 'Michelle', 'Zira'], pitch: 0.85, rate: 1.0 }
  },

  wren: {
    note: 'Wren, herbalist. Young, bubbly, science-mad; "Hi hi hi!", trips over her own sentences. Fast and bright.',
    address: 'friend',
    tts: { voice: 'af_bella', lang: 'en-us', speed: 1.14 },
    fx: { pitch: 1.0, formant: 'preserved' },
    web: { lang: 'en-US', gender: 'female', prefer: ['Ana', 'Jenny', 'Aria', 'Zira'], pitch: 1.4, rate: 1.2 }
  },

  // ------------------------------------------------ ASHEN RUINS
  aldric: {
    note: 'Sir Aldric, last paladin of the Dawn Watch. Grand, formal, theatrical ("By the Dawn!") then deflating asides. British, chest-voice, echoing ruins.',
    address: 'friend',
    tts: { voice: 'bm_george', lang: 'en-gb', speed: 0.95 },
    fx: { pitch: -0.7, formant: 'shifted', reverb: [1.6, 0.08] },
    web: { lang: 'en-GB', gender: 'male', prefer: ['Ryan', 'George', 'Thomas', 'David'], pitch: 0.8, rate: 0.92 }
  },

  // ------------------------------------------------ HOLLOW ORRERY (v1.2 dungeon, WS4 adds the NPC)
  orrery_keeper: {
    note: 'The Orrery Keeper, Orrin Tellwhistle, Last Star-Keeper of Dawnhold: an ancient caretaker spirit of the dungeon (an old bearded man in WS4\'s data). Eerie but kind; slow, faraway, absent-minded, a faint starry shimmer around every word.',
    address: 'star-seeker',
    tts: { voice: 'bm_george*0.55+bm_fable*0.3+af_kore*0.15', lang: 'en-gb', speed: 0.86 },
    fx: { pitch: -1.2, formant: 'preserved', chorus: 0.3, layer: [12, 0.08], reverb: [2.8, 0.2] },
    web: { lang: 'en-GB', gender: 'male', prefer: ['Ryan', 'George', 'Thomas', 'David'], pitch: 0.7, rate: 0.82 }
  },

  // ================================================ ENEMIES (duel shouts, boss speeches)
  hollow_sprite: {
    note: 'Tiny giggling light-nibbler. Squeaky, gleeful.',
    tts: { voice: 'af_kore', lang: 'en-us', speed: 1.15 },
    fx: { pitch: 6, formant: 'shifted', reverb: [0.8, 0.1] },
    web: { lang: 'en-US', gender: 'female', pitch: 2.0, rate: 1.3 }
  },
  rot_toad: {
    note: 'Soured bog toad. Low, croaky, sulky.',
    tts: { voice: 'am_onyx', lang: 'en-us', speed: 0.9 },
    fx: { pitch: -4, formant: 'shifted', tremolo: [22, 0.25], lowpass: 3800 },
    web: { lang: 'en-US', gender: 'male', pitch: 0.3, rate: 0.9 }
  },
  bogmire_brute: {
    base: 'rot_toad',
    note: 'Elite toad: even bigger, even croakier.',
    fx: { pitch: -5.5, formant: 'shifted', tremolo: [18, 0.3], lowpass: 3400, reverb: [1.0, 0.08] }
  },
  gloom_imp: {
    note: 'Cackling sock thief. Nasal, sneering, small.',
    tts: { voice: 'am_puck*0.6+am_liam*0.4', lang: 'en-us', speed: 1.12 },
    fx: { pitch: 4, formant: 'shifted', highpass: 180 },
    web: { lang: 'en-US', gender: 'male', pitch: 1.8, rate: 1.25 }
  },
  gloomhorn_ringleader: {
    base: 'gloom_imp',
    note: 'Elite imp boss "of THESE imps". Same sneer, a bit bigger and prouder.',
    fx: { pitch: 2.5, formant: 'shifted', highpass: 150 }
  },
  grubnak: {
    note: 'Grubnak the Bog King, puffed up by a Herald\'s quill. Pompous, boomy, toad-throated; the bog echoes him.',
    tts: { voice: 'am_fenrir', lang: 'en-us', speed: 0.94 },
    fx: { pitch: -5, formant: 'shifted', tremolo: [14, 0.18], reverb: [1.4, 0.12] },
    web: { lang: 'en-US', gender: 'male', pitch: 0.2, rate: 0.9 },
    variants: {
      freed: { note: 'Freed: a dizzy, kindly old toad who just wants to sing.', tts: { speed: 0.9 }, fx: { pitch: -3.5, formant: 'shifted', tremolo: [10, 0.1] } }
    }
  },
  hollow_wolf: {
    note: 'Hollowed wolf (its intro is a howl in narration, so usually silent). Growling.',
    tts: { voice: 'am_onyx', lang: 'en-us', speed: 0.85 },
    fx: { pitch: -6, formant: 'shifted', reverb: [1.2, 0.12] },
    web: { lang: 'en-US', gender: 'male', pitch: 0.1, rate: 0.8 }
  },
  shadowfang_alpha: { base: 'hollow_wolf', note: 'Elite wolf pack leader.' },
  bramble_ghoul: {
    note: 'Walking dead thorns that want to hug you grey. Slow, breathy, wrong.',
    tts: { voice: 'af_nicole', lang: 'en-us', speed: 0.8 },
    fx: { pitch: -4, formant: 'shifted', layer: [-12, 0.25], reverb: [1.6, 0.18] },
    web: { lang: 'en-US', gender: 'female', pitch: 0.4, rate: 0.7 }
  },
  elder_bramblehulk: {
    base: 'bramble_ghoul',
    note: 'Elite ghoul. Bigger, slower, the "BIGGEST hug".',
    tts: { speed: 0.76 },
    fx: { pitch: -6, formant: 'shifted', layer: [-12, 0.3], reverb: [1.8, 0.2] }
  },
  thorn_sprout: {
    note: 'Thornmaw\'s angry seedling. Tiny, shrill, loud.',
    tts: { voice: 'af_sky', lang: 'en-us', speed: 1.2 },
    fx: { pitch: 7, formant: 'shifted' },
    web: { lang: 'en-US', gender: 'female', pitch: 2.0, rate: 1.4 }
  },
  thornmaw: {
    note: 'Thornmaw, the hollowed Heartoak. Enormous, slow, groaning wood; the whole forest resonates.',
    tts: { voice: 'am_onyx*0.6+am_fenrir*0.4', lang: 'en-us', speed: 0.82 },
    // was -7 st + a louder sub-octave + lowpass: too muddy to follow (Whisper QA ~45 %)
    fx: { pitch: -5.5, formant: 'shifted', layer: [-12, 0.25], reverb: [2.4, 0.18] },
    web: { lang: 'en-US', gender: 'male', pitch: 0.1, rate: 0.7 },
    variants: {
      freed: { note: 'Freed: the gentle old tree again, warm and sleepy.', fx: { pitch: -5, formant: 'shifted', layer: [-12, 0.12], reverb: [2.2, 0.12] } }
    }
  },
  ash_wraith: {
    note: 'Drifting fire-ghost of Dawnhold. A pained whisper with a long hollow tail.',
    tts: { voice: 'af_river', lang: 'en-us', speed: 0.85 },
    fx: { pitch: -3, formant: 'shifted', chorus: 0.5, reverb: [2.4, 0.25] },
    web: { lang: 'en-US', gender: 'female', pitch: 0.5, rate: 0.75 }
  },
  cinder_revenant: { base: 'ash_wraith', note: 'Elite wraith: angrier fire.', fx: { pitch: -4.5, formant: 'shifted', chorus: 0.45, layer: [-12, 0.2], reverb: [2.4, 0.25] } },
  bone_knight: {
    note: 'Risen Dawn Watch knight. Hollow, halting, ringing inside an empty helmet.',
    tts: { voice: 'bm_daniel', lang: 'en-gb', speed: 0.85 },
    fx: { pitch: -3, formant: 'shifted', echo: [28, 0.45], reverb: [1.6, 0.14], highpass: 120 },
    web: { lang: 'en-GB', gender: 'male', pitch: 0.4, rate: 0.75 }
  },
  dread_knight: { base: 'bone_knight', note: 'Elite knight-commander: barks orders.', tts: { speed: 0.9 }, fx: { pitch: -4.5, formant: 'shifted', echo: [24, 0.5], layer: [-12, 0.15], reverb: [1.8, 0.15], highpass: 100 } },
  hollow_acolyte: {
    note: 'Hooded cultist chanting stolen light into the Gloamgate. Fervent; sounds like many voices at once.',
    tts: { voice: 'am_echo', lang: 'en-us', speed: 0.95 },
    fx: { pitch: -1, formant: 'shifted', chorus: 0.7, reverb: [2.0, 0.18] },
    web: { lang: 'en-US', gender: 'male', pitch: 0.6, rate: 0.9 }
  },
  hollow_hierophant: { base: 'hollow_acolyte', note: 'Elite high priest; Nyx sees through his eyes.', fx: { pitch: -2.5, formant: 'shifted', chorus: 0.7, layer: [-12, 0.2], reverb: [2.2, 0.2] } },
  captain_vex: {
    note: 'Captain Vex, Aldric\'s hollowed squire. Young, bitter, clipped; a little Hollow darkness under every word.',
    tts: { voice: 'bm_lewis*0.5+am_fenrir*0.5', lang: 'en-gb', speed: 1.0 },
    fx: { pitch: -1, formant: 'shifted', layer: [-12, 0.14], reverb: [1.4, 0.1] },
    web: { lang: 'en-GB', gender: 'male', pitch: 0.8, rate: 1.0 },
    variants: {
      freed: { note: 'Freed: exhausted and sorry, the darkness gone.', tts: { speed: 0.86 }, fx: { pitch: -0.5, formant: 'shifted', layer: null, reverb: [1.0, 0.05] } }
    }
  },
  nyx_herald: {
    note: 'Nyx, Herald of the Hollow King. Elegant, mocking, patient; calls you "little light". A shadow speaks a beat under her voice.',
    tts: { voice: 'af_alloy*0.6+bf_emma*0.4', lang: 'en-gb', speed: 0.9 },
    fx: { pitch: -2, formant: 'preserved', layer: [-12, 0.3], chorus: 0.2, reverb: [2.6, 0.2] },
    web: { lang: 'en-GB', gender: 'female', pitch: 0.6, rate: 0.85 }
  },

  // ------------------------------------------------ HOLLOW ORRERY enemies (v1.2, WS4) — pre-made so their lines voice on the next tools/gen-voices.py run
  shard_hound: { base: 'hollow_wolf', note: 'Crystal-backed hound. Growls and glassy rasp.', fx: { pitch: -5, formant: 'shifted', echo: [18, 0.3], reverb: [1.8, 0.15] } },
  orrery_seer: {
    note: 'Hooded floating astronomer-cultist. Dreamy, whispery prophecy.',
    tts: { voice: 'af_river', lang: 'en-us', speed: 0.88 },
    fx: { pitch: -1.5, formant: 'preserved', chorus: 0.4, reverb: [2.6, 0.22] },
    web: { lang: 'en-US', gender: 'female', pitch: 0.7, rate: 0.85 }
  },
  orrery_sentinel: {
    note: 'Towering brass-and-obsidian construct. Mechanical, booming, metallic.',
    tts: { voice: 'am_onyx', lang: 'en-us', speed: 0.82 },
    fx: { pitch: -5, formant: 'shifted', echo: [16, 0.55], layer: [-12, 0.25], reverb: [2.2, 0.16], highpass: 90 },
    web: { lang: 'en-US', gender: 'male', pitch: 0.1, rate: 0.75 }
  },
  warden_morrow: {
    note: 'Warden Morrow, a corrupted Lumen knight-mage. Noble voice gone cold and tired; lantern-lit halls.',
    tts: { voice: 'bm_george*0.5+am_fenrir*0.5', lang: 'en-gb', speed: 0.9 },
    fx: { pitch: -2, formant: 'shifted', layer: [-12, 0.18], reverb: [2.2, 0.16] },
    web: { lang: 'en-GB', gender: 'male', pitch: 0.5, rate: 0.85 }
  },
  starless_archon: {
    note: 'The Starless Archon. Huge, ancient, robed; a voice from the bottom of a well of stars.',
    tts: { voice: 'am_onyx*0.6+af_nicole*0.4', lang: 'en-us', speed: 0.8 },
    fx: { pitch: -6, formant: 'shifted', layer: [-12, 0.35], chorus: 0.3, reverb: [3.2, 0.24] },
    web: { lang: 'en-US', gender: 'male', pitch: 0.1, rate: 0.7 }
  }
};
