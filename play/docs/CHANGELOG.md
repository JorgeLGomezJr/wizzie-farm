# Wizzie Farm — Changelog

## v2.1.0 — "New Faces" (Oct 2026)
Jorge's v2.0 playtest fixes, the new characters and character creation, finite decks, boss summons, the new spell cards, pet card art, Jorge's dungeon and loot rules, and the Chatterbox voice kit.
**New voices:** all 382 spoken lines re-voiced with Chatterbox (more natural, with emotion), rendered on Jorge's laptop. Two-PC internet play is still untested.
**Heroic mode (Hollow Orrery):** at the entrance, choose Normal or **Heroic** (locked until you leave). Heroic guardians have 21 % more health and hit 20 % harder; the Starbound set drops 1.5× as often (a set piece in ~65 % of runs, a T3 in ~7 %) and the chest holds 4–6 extra Star Shards. Built for wizards in full Starbound gear: about 58 % of solo runs succeed. In a realm, the host's choice counts for the party. Normal is unchanged.
**Gear and loot:** T2 now takes real farming: the T1→T2 upgrade costs 340 Star Shards (was 95) and T2 rarely drops directly, so the first T2 piece arrives around run 7 (was 3). The first T3 still comes at about run 18.
**Flee:** you can flee any duel at any time, boss fights included, with no penalty (you just leave without rewards).
**Cards:** the accuracy on a card (and in the duel tooltip) is the card's printed accuracy, never changed by gear. Your gear still counts when you cast.
**New names:** Power Pip → **Bright Pip**; pet stages are now **Hatchling → Fledgling → Grown → Elder → Radiant → Starborn**; the Orrery's keeper is **Orrin Tellwhistle**; the Hatchery is the **Nestery** in **Nestling Glade**. Your saves and pets carry over unchanged.
**Playtest fixes (A1–A7)**
- A1: a Runeglass upgrade now shows on the card everywhere (hand, deck, spellbook, Spellwright, scrolls): upgraded numbers, rank diamonds, a RANK ribbon and path-B bonus text.
- A2: when an enemy talks, the duel waits for the whole line (the voice clip's length, the same on every realm PC) before any spell.
- A3: a fixed 1.5 s wand wind-up before every cast and every FIZZLE, for every caster, in its school's own style (Stoneward heaves, Tidecaller sweeps, Emberstrike snaps). Rounds are longer: a 1v1 round is about 12 s, a 3v3 round about 36 s; realm guests get up to 90 s per round.
- A4: Coach Bramble says exactly what the training ring needs (no pet / equip one with P / fully grown / ready in 12m 3s), in the dialogue, with an "Open Pets" button.
- A5: decks are finite: spent cards don't come back during a duel. When your hand and deck are empty you can only Pass, use a Spell Scroll or Flee. The duel shows "N cards left in your deck". To keep the same hands as v2.0, every deck number is tripled (a new Stoneward starts with 9 Pebble Strikes; the L10 deck holds 90 cards) and your existing decks were tripled once. Early story bosses and two Orrery bosses hit a little softer to keep the v2.0 win rates.
- A6: entering the Hollow Orrery (from the Ashen Ruins) mounted no longer turns your wizard backwards on the mount.
- A7: no more "damage after buffs" preview under the cards or in the tooltip.
**New characters (WS-D, approved round 2)**
- Taller wizards (4.1 heads, smaller head), the hat at Aurelia's ratio tilted back so the face shows; Build A and the broader Build B (+15 % shoulders/chest).
- Create your Wizard has a second step, "Your look": build, face, eyes (round-2 almond, the smaller squarer eyes, gentle, wide), eye colour, nose, mouth, 8 hair styles, hair colour and skin, with a live 3D preview. Existing wizards: Menu → "Change your look" (the Mirror).
- All 19 named NPCs got their own build with one strong shape hook (tall Aurelia, broad square-bearded Brannoc, stooped Fennick, round little Pip...). Every gear style, rarity effect, animation and mount works on every body.
**Combat**
- Bosses can summon helpers at 50 % health: the Starless Archon calls its two keepers mid-fight (in co-op too).
**Cards (approved redesign)**
- Every card (hand, deck editor, spellbook, Spellwright, scrolls, trainer, level-up, pets) uses the approved design: gold double frame with filigree corners and school gems, sunburst, pip gems, school emblem, level badge, embossed name banner, parchment effect box with a school rune, accuracy badge, Runeglass diamonds + RANK ribbon, rarity gem; epic/legendary foil shimmer, aura and sparkles; support spells (heals, blades, traps, shields) get a round window and striped back. Hover tilts and glows (only lifts with Reduce motion).
- Pet cards: all 27 have their own picture showing the pet casting its move.
**Dungeon, world boss and loot (Jorge's rules, no party scaling)**
- Dungeon gear drops only for your own school. Each Hollow Orrery boss drops fixed slots (Sentinel: amulet + boots, Warden: wand, Archon: hat + robe), shown on the boss nameplate and by the Orrery's keeper ("What do the guardians carry?"). About half of all runs give a set piece; a T3 piece drops in ~5 % of runs (first T3 after ~18 runs, upgrades included).
- New world-boss set, Duskherald (5 pieces per school, about as strong as Starbound T1): Nyx drops 2 rolls at 10 % each per win (full set ~57 wins).
- Clearing a dungeon is recorded; future worlds can require it (no new world in v2.1 yet).
- The Orrery bosses hit a little softer: an average solo wizard in typical gear clears a full run ~35 % of the time.
**Fixes from the v2.0 QA list**: no panel hotkeys during story vignettes; long messages stay on screen longer; keyboard focus moves into the Pets and Realm panels; the school keys 1–3 work on Create your Wizard without a click; new wizards follow the OS "reduce motion" setting.
**Fixes from the v2.1 reviews**
- Saves are now version 6, and the account as v2.0 left it is copied once (`wizziefarm_account_v1_pre_v6`) before decks are tripled. Opening a v2.1 save in an older v2.0 copy keeps your eye colour and doesn't triple decks a second time later.
- Wizards who beat the Starless Archon in v2.0 count as having cleared the Orrery. A clear only counts when you win the final duel yourself (not a friend's fight you sat out).
- Realms: a friend who reconnects after a boss summoned helpers sees them (it used to resync in a loop). A wizard with no cards and no scrolls passes after 5 s instead of holding the party for 30 s. Realm protocol 2: v2.0 and v2.1 can't share a realm.
- The Mirror owns the keyboard (Escape cancels, keys don't reach the hidden NPC dialog, only one Mirror opens, focus stays on the control you used), and an autosave never stores a look you didn't keep.
- Picking a school in Create your Wizard plays the cast flourish again.
- Deck editor: Shift + click / right-click (or Shift + Enter / Delete) moves every copy of a spell at once.
- Tips and messages match finite decks: no more "see its real damage" tip; the discard tip says spent cards are gone; the out-of-cards hint offers Pass or Flee.

## v2.0.0 — "Schools, Pets & Realms" (Oct 20 2026)
The big Levels 1–10 update: school stats and Runeglass, pets and the Hatchery Glade, co-op Realms for up to 3 wizards, the story plants for the saga ahead, save format v5, and fixes from the independent reviews. The new character models and character creation come in v2.1.
**Known limits in this release:** the new voice lines use the current voice style until the new voice engine is picked; the Hollow Orrery Archon's keepers stand beside it from the start (no summon at 50 % yet); co-op makes story bosses easier (enemies don't scale with party size; decision pending); the desktop app may show the Windows SmartScreen warning (unsigned). Real two-PC internet play is still to be tested on your second PC (same Wi-Fi first).
**Realms co-op fixes (code review)**: a friend who reconnects while a duel is being set up stays connected; a friend whose Wi-Fi drops as a duel ends gets its result when they're back (no stuck duel screen, loot settled once); a friend's game can't send absurd numbers, decks or text into the host's duel.
**Review fixes (QA + accessibility)**: a boss egg that drops while you carry 24 pets now goes to the shared Vault (only lost if the Vault is full too, and then the results screen names it); the Spellwright's upgrade list is readable (opaque dark rows, bigger text); "◀ Take" in the Vault is a real button (keyboard); the title, wizard-select and "Create your Wizard" screens no longer inherit the big title font (clipped "Create your Wizar" / "EMBERSTRI…").
**Fonts** (Cinzel + Nunito, SIL OFL) now ship with the game, so it looks the same offline and makes no web requests.
**Realms — play with friends (WS-C, `docs/design/realms.md`)**
- Host a realm from your own game (Realm panel: **G** or the HUD button) and share the **lantern sigil** join code (6 runes, e.g. `K7Q·4MD`); up to **3 wizards**. Free: peer-to-peer WebRTC (vendored PeerJS, lazy-loaded only when you Host/Join — single-player stays fully offline). No accounts, no paid servers.
- See each other walk, run, ride, jump and emote, with nameplates; the party follows the host between zones; camps the party clears disappear for everyone.
- **Party duels up to 3 vs 3** (including up to 3 bosses): everyone picks in the same planning phase (30 s turn timer, auto-pass on timeout), then the round resolves in a fixed order (players by join order, then enemies). Heals, blades, shields and absorbs can target an ally; enemies pick their targets (tanks draw attention, sure kills are taken). Fallen allies share a party win. Fleeing is solo and blocked against bosses.
- Fixed battle timing for everyone: the next planning phase opens only when every client has finished the round's cinematics (capped so a frozen client can't stall the party). The host decides boss-speech skips.
- Host-authoritative combat with a per-round state hash: a desync or a dropped link heals itself with a full state sync; a disconnected friend has 60 s to reconnect and gets their seat back (auto-passes meanwhile).
- **Own loot, own save, own story**: every player rolls their own drops; nobody's save is ever written by someone else; quest updates and story lines play per player.
- Pets with a friend: message + API hook ready (`pet:offer/accept/egg`) for the pets system.
- Honest network note: works on the same Wi-Fi and on most home routers; two networks that both block direct connections (some mobile hotspots / carrier-grade NAT) can fail without a relay — the panel says so and suggests a free virtual LAN (Tailscale/ZeroTier) or your own TURN server.
- Single-player duels are unchanged (all existing combat tests pass).
**Schools — M1 (WS-A; `docs/V2.0-CONTRACT.md` §2, §10 F-4/F-5)**
**School stats**
- New gear stats per school: Damage, Resist and Accuracy for Stoneward, Tidecaller and Emberstrike (e.g. "+12% Emberstrike Damage"), on top of the universal ones. Hit = base × (1 + damage + school damage) × (1 − (resist + school resist)) × blades/traps; resist below 0 is a weakness; total resist capped at 75 %. Power Pip and Pip Surge stay one stat each (no double count).
- Natural school matchups: Tidecaller wears down Stoneward, Stoneward smothers Emberstrike, Emberstrike boils Tidecaller (−8 to −12 % resist vs that school); Stoneward also shrugs off fire (+5 %). The backpack shows your resist against every school and your Runeglass.
- Every enemy has a school, shown with its icon on the duel nameplate; its Hollow spells hit as that school. Camps mix schools from Whisperwood on. The story bosses (Grubnak, Thornmaw, Captain Vex, Nyx) all hit as Tidecaller.
- All gear converted: school gear (boss variants, school versions of drop sets, Starbound / Starwalker / Artificer T1–T3) now carries school damage / accuracy; zone drop sets and boss drops guard against one school (part of their resist became school resist). Shop gear stays universal.
- Retune: Stoneward −5 % damage, 5 % resist, no base accuracy, slightly less health per level; Tidecaller +5 % damage. Ward conversion: warded drops keep 60 % of their resist as universal and add 80 % as school resist. Every school now wins 60–90 % of boss duels at level with typical gear (was: Stoneward 98–100 %). `balance-sim --check` enforces it.
- Spell pacing: school spells now unlock at levels 1, 3, 5, 7, 8 and 10 (boss-level decks unchanged).
**Runeglass & the Spellwright**
- Bosses drop Runeglass (shards of the Hollow Orrery's star-lenses); the first victory over each boss always pays. Shown on the victory screen.
- Oswin Lenscroft, the Spellwright, works at an open-air lens bench on the lane west of the Spire. "Upgrade Spells": every school spell (and boss spell) can rise from rank 1 to 5 along one of two paths (A = more power; B = a school trick: Bedrock soak, Undertow drain, Kindling trap, Shelter, Afterglow…). Reset any time for gold; all Runeglass comes back.
- Tutorial side quest "Glass That Remembers" (after Grubnak).
**Endgame**
- Starbound / Starwalker / Artificer T1 → T2 now costs 95 Star Shards per piece (was 220): about 12 clears of shard income for a full set (review F-5).
- Realms × Schools: every party seat brings its own school stats, Power Pip and Runeglass spell ranks into party duels (`duel:loadout` carries `schoolStats` + `spellRanks`); enemies weigh the school resist of the wizard they actually go after.
**Saves**: new per-wizard fields `runeglass`, `spellRanks` (old wizards get the first-victory Runeglass of bosses they already freed).
**Story — Levels 1–10 made right (WS-E, `docs/design/story-retrofits-v2.0.md`; canon `docs/design/story.md` §9 R1–R17)**
- Book I now plants the saga: a star fell over Mosslight (and you woke in the moss "warm as a coal"); Fennick's moss glows brighter and lanterns light at your touch; Sela and Aldric ask how you *free* what they can only banish.
- Aurelia: "You're coming along beautifully." / "Brighter every day." at level-5 and level-10 turn-ins; after the final turn-in a short, skippable vignette — the Spire's flame gutters and she murmurs "Not yet." New Book I end card.
- Aurelia's corner of the Spire forecourt: a covered portrait and a locked door. On about one visit in five the Spire's flame leans toward you.
- A tiny gold mote drifts from you into every boss you free (not Nyx or the Archon, who are banished).
- New lines: Nyx's parting words, Captain Vex and Warden Morrow when freed, the Archon's "The first one is still hungry", the Orrery Keeper at the Archon's dais and in his greeting, Orsolya on the sealed deep vault, Guard Tomas's night shifts, a truer Ashen Ruins intro (Cindralis, the Ashfall).
- Audit: no Hollow being ever says your name or calls Malgrath its master; the Archon no longer calls you a "little star" (that is a level-30 secret).
- Saves: `storyFlags` remembers which story moments a wizard has seen (old saves get it automatically).
**Voices (stopgap, Jorge D11)**
- The 51 new v2.0 lines (Spellwright Oswin Lenscroft, the four Hatchery Glade keepers, the story plants, the Glade arrival narration, the reworded intro) now have voice clips instead of the browser voice. Rendered in the current v1.2 Kokoro style; the whole game will be re-voiced once the new voice engine is picked (D2).
- Clips of reworded lines were removed, so old audio never plays. "Cindralis" is now said "sin-DRAH-liss". Intelligibility (Whisper QA) of the new clips: 96.8 % average.
**Fixes**
- Captain Vex (a Tidecaller boss) is now weak to Emberstrike instead of Tidecaller (review F8). Boss win rates at level, typical gear: Stoneward 85 %, Tidecaller 83 %, Emberstrike 75 % (was 66 %).
- Intro: "The histories say that three hundred years ago, the Order sealed him away beyond the Gloamgate." (the Order's official story).
- Legendary items' NEW badge is no longer clipped in the backpack (review F-10).
- Party duels: the planning timer no longer covers the Spell Scrolls button.
- Verified (review F-3): the Hollow Orrery's exit portal and reward chest appear even when the bosses are freed out of order (`tests/dungeon-f3-browser.js`).
**Pets — M2 (WS-B; `docs/V2.0-CONTRACT.md` §3, design `docs/design/pets.md`)**
- **Hatchery Glade**: a small new safe zone behind one portal arch north-east of the Lumen Spire (Lanternmere stays uncluttered). Nell Quillby's Hatchery (two incubator nests, breeding, appraisal), Tobin Burrow's Common starter pets, Marla Crumb's snack bakery, Coach Bramble's training ring, and the Pet Stat Board (press E).
- **Pets**: 9 species (Mossling, Puddlepup, Cinderkit, Glowmoth starters; Bogglet, Thornfawn, Ashwing, Duskmote, Orrery Owlet from bosses/elites), 5 rarities (Common to Legendary), 6 growth stages Baby, Teen, Adult, Ancient, Epic, Mega. At every stage the pet offers **2 talents from its hidden pool and you pick 1**.
- **Talents** go through the normal stat pipeline (max health, mana, damage / resist for one school, accuracy, Power Pip, Pip Surge). A perfect pet is a big boost at every level 1–10 (see the retune below).
- **Pet cards**: Rare 1, Epic 2, Legendary 3 incl. a signature spell; added to your duel deck on top of the deck limit (paw-print frame); rank II at Adult, rank III at Mega.
- **Eggs** are a chase drop from bosses and elites only (0.5–4 % per kill). **Breeding**: any two Adult+ pets, also pets your other wizards left in the shared Vault; the baby mixes both parents' talent pools; rarity = the lower parent's with a small roll-up; gold fee, real-time incubation (30 min to 6 h) and a 12 h parent rest. The perfect pet takes ~60–100 h (tests/pet-sim.js).
- **Leveling**: snacks (bought or dropped), the training ring (every 20 min), and every duel won with the pet equipped.
- Your equipped pet **follows you** in the world and **stands beside you in duels** (hops when you cast its cards). New **Pets panel** (P or the HUD Pets button).
- Saves: new wizard fields `pets[]`, `activePet`, `hatchery {slots, cooldowns}` and `account.bank.pets[]` (old saves get empty ones).
- Tests: `tests/pets.test.js` (23 unit tests), `tests/pet-sim.js --check` (power + chase targets), `tests/pets-browser.js` (Glade, adopt, hatch, panel, duel).
- Pets × Schools × Realms (integration): pet talents stay universal (school talents are gated by your school, school gear stats untouched); your equipped pet's cards and talents come with you into Realm party duels; **breed pets with a friend** in your Realm (Hatchery → "Breed with a friend": each of you gets your own egg, pays your own fee). Retune after Schools gave L1 decks a school blade (it boosted pet signature spells): Puddlepup Torrent 290–335 (was 325–375), Cinderkit Pounce 200–235 + 78×3 (was 225–265 + 88×3); Stonehide (Stoneward-only resist talent) ranks 1/1/2/3/6 % (was 1/1/2/2/3). `pet-sim --check` green: L1 twink 1.90–1.95×, L10 perfect pet 1.16–1.18×.
- **Pets retune — stronger (Jorge, Oct 19: "at level 10 it can be 2x … 1.2x stronger at lvl 60")**: a perfect pet is now **≈2× combat power at level 10** (and 2.1–2.9× at level 1), fading to **≈1.2× at level 60** (projected). The big parts are flat: **Glade Heart** +900 max health (Legendary) and the school **Dealers** now add **flat damage to every hit** (Legendary: Stoneward +100, Tidecaller +105, Emberstrike +150) instead of +4 % damage. Both grow with your level, from 40 % at level 1 to the full value at level 10 (then stay flat, so they shrink as spells and health keep growing past 10). Wards +2 % resist, Bright Spark +2 % Power Pip, Pip Surger +1 % (Legendary). New combat stat `flatDmg` (added to the base roll before blades/traps; DoT ticks and heals unchanged), shown as "Pet strike +N" in spell tooltips and on the backpack's Damage stat; it rides into Realm party duels per seat. `pet-sim --check` now plays with balance-sim's player AI: L1 2.14–2.88×, L10 1.95–2.01×, L60 projected 1.22–1.24×; chase times unchanged (Rare 2.8 h, Epic 10.0 h, Legendary 21.0 h, perfect 89 h median). A perfect pet takes an L1 wizard from 0 % to 95–100 % against Grubnak; bosses are untouched (balanced for wizards without a pet); `balance-sim --check` stays gear-only. A perfect pet of another school still helps a lot (1.8–3.3× at L1 from Heart + its cards; Jorge OK'd).

## v1.2.0 — "Deck & Dungeon" (Jorge's v1.1 feedback)
Built by nine parallel studio workstreams under `docs/V1.2-CONTRACT.md` (§1–10), merged, integration-tested and independently reviewed.
**Duels**
- Spell casts take ~1.5× longer (longer wind-up, creature presence and impact hold; the strike stays fast). "Fast combat animations" keeps the v1.1 timing.
- Nameplates above every enemy (name, level, health, school, elite ★ / boss ♛, charms/wards); HUD panels ordered exactly as the enemies stand and re-sorted when the camera moves; model/plate/panel clicks target the same enemy.
- Pip Surge: a chance to gain 2 pips in one round ("+2 Pips!"). Power Pip: chance each new pip is a bright pip worth 2.
- Every spell card has its own painted illustration (91 cards).
**Decks (W101-style)**
- Deck items: Apprentice, Journeyman, Adept, Luminary (shop), Orrery (dungeon), Artificer (crafted), each with size, copy limits, other-school limit and a Spell Scroll sideboard. New two-page Spellbook & Deck book: click or drag to copy cards in, auto-fill, multiple saved decks.
**End-game (level 10)**
- The Hollow Orrery: a repeatable level-10 dungeon (3 sealed rooms, Orrery Sentinel, Warden Morrow, the Starless Archon), unlocked after the story via Aldric's quest.
- Boss spells: the Archon's first clear teaches a 4-pip area spell per school (Ascendant Quake / Tide / Flare).
- Gear tiers T1/T2/T3 for Starbound (dungeon), Starwalker Boots (Nyx re-fight) and Artificer (crafted only): school-specific in every slot, random-school drops, set bonuses, upgrades and salvage at Tamsin Gearwright (new crafter in Lanternmere).
- Gear-over-levels rule (balance-sim): a perfect level 10 ≥ a bad-gear level 20 (≤ 1.25×); projected scaling to level 60.
- Level-up screen shows health and mana gained.
**Account & app**
- Up to 3 wizards per account ("Choose your Wizard" with live 3D previews), export/import, typed-name delete. Old saves move into slot 1 automatically (old save kept as a backup).
- Shared bank (Lanternmere Vault) to move gear, mounts, decks and reagents between your wizards.
- Windows desktop app (Electron) with file saves + 5 backups and self-updates (GitHub Releases once configured, or a drop-in `updates` folder).
**World, art & audio**
- Every NPC and boss is voiced (Kokoro neural TTS, 40+ voices); Voices on/off + volume in Settings.
- New art: 5 dungeon enemies, vault zone, 9 props, Artificer/Starbound/Starwalker gear looks with T1–T3 escalation, Orrery Strider mount.
**Saves**: account format v4 (3 slots + bank); per-wizard migration adds deck items. v1.1 saves upgrade automatically.

## v1.1.0 — "Gear & Glory" (Jorge's first-play feedback)
Built by six parallel studio workstreams (render, props, characters, creatures, VFX/duels, systems/UI) under `docs/V1.1-CONTRACT.md`, then merged, integration-tested and reviewed.
**Spell cinematics (Wizard101-style)**
- Every spell plays as a short cinematic: wand twirl, the spell card rises over the caster, a school sigil flares, the camera cuts, an original summoned creature performs the attack, big impact with shake/flash/bloom, camera returns.
- 48 cinematics: every player attack (e.g. Spark Newt, Ember Moth, Gale Hawk, Blaze Fox, Skyrend Drake, Phoenix; Pebble Golem, Stone Boar, Golem Fist, Quake Ram, Stone Titan; Water Sprite, Undertow, Wave Serpent, Moon Tide, Maelstrom, Leviathan; Sunburst), heal fairies, blades, traps, shields, absorbs, weaknesses, and all Hollow enemy spells incl. boss signatures (Night Terror, Eclipse, Captain's Cleave…).
- Click / Space skips to the hit. Settings: Spell animations Cinematic / Quick (fast combat and reduce motion respected).
- Duel entry: the ring draws itself, enemies taunt; cards are dealt in; enemies collapse and dissolve when defeated; victory/defeat poses.
**Graphics**
- New render pipeline: HDR bloom (glows really glow), MSAA, colour grading per zone, full-resolution rendering, sharper shadows. Graphics tiers Ultra / High / Medium / Low (Auto steps down if slow).
- Painted textured ground (cobbles, dirt, flagstones, leaf litter, ember veins), dense wind-swept grass and flowers, painted skies with clouds, sun/moon/eclipse and distant mountains, ambient particles (pollen, fireflies, leaves, embers), new portals and wisps, water.
- All 30 props re-authored at much higher detail (layered trees, timber houses with shingled roofs, carved ruins, three-tier fountain…) with a painterly surface finish — and fewer draw calls than v1.0.
- All 13 enemies reworked to look far more menacing (brows, fangs, horns, glowing runes, smoke/ember auras, rim light); bosses ~40% bigger.
**Gear & rarity**
- Five rarities: Common, Uncommon, Rare, Epic, Legendary. 164 gear pieces across four zone tiers; 13 unique boss legendaries.
- Every enemy can drop gear (~36% per normal fight, ~83% elite, bosses always — rare or better).
- Elite enemies (gold ★ names) in every combat zone: harder, better loot.
- Gear changes your look: 10 hat styles, 6 robes, 4 boots (wizards now have feet), 7 wands, 3 amulets; rarity adds trim, glowing gems, runes and (legendary) animated auras.
- Backpack redesign: live 3D wizard preview, rarity frames, stat-compare tooltips, filters/sorting, NEW badges; "Sell all Common" at vendors; rarity reveal on legendary/epic drops.
**Mounts**
- Press R to ride. Pony, horses, Lumen Warhorse from Hollis Brightmane's new Brightmane Stables in Lanternmere; side quest "A Steed of Your Own" gives a free pony; rare boss/elite mounts: Mossback, Thornstag, Emberhoof, Nightmare of the Gloam. +25–60% speed. Duels dismount and remount you automatically.
**Animation**
- Wizards: bouncy run, wand-twirl casts, big summon cast, hit reactions, victory cheer, defeat slump, riding, talking gestures, idle fidgets, flowing robes/hats.
- Enemies: taunt, aggressive duel stance, prowl, lunge casts, collapse-and-dissolve defeat.
**Balance**
- Bosses retuned for the stronger gear (at-level win rates 67–89% for Tidecaller/Emberstrike, tank Stoneward ~98%). Shop prices rebalanced for the extra gear income.
**Polish (independent creative-director + lead-programmer reviews)**
- Duel HUD fades out while a cinematic plays; smarter duel camera keeps your wizard and boss heads clear of the UI and hides scenery in the way; deliberate victory/defeat shots; cleaner results screen; elite ★ panels; per-school blade/trap/shield effects; softer impact flashes; dimmer duel ring with your school sigil.
- Dialogue close-ups on NPCs, mounted camera that shows your horse, hoof dust, see-through scenery when a tree blocks your view, nameplates that never cover menus, denser cobblestones, warmer forest paths, less haze in Mosslight, bluer skies.
- Fixes: inside-out feathered hat and mushroom caps, name plates stretched after respawn, gear equipped from the victory screen now shows immediately, owned mounts don't drop again, riders keep their size on every mount, wider collision while riding, graphics context-loss recovery.
**Saves**: format v3 (mounts, NEW badges, cinematics setting). v1.0 saves upgrade automatically with gear intact.

## v1.0.0 — Chapter One, polished (studio review sprint)
Built and reviewed with the Claude Code Game Studios roles (design, narrative, level, art, audio, programming, QA, creative-director review).
**Combat feel**
- Bright pips: some pips arrive "bright" and pay double for your own school and Lumen spells.
- Enemy school affinities: monsters are weak to or resist certain schools (shown on their duel panel).
- Burns now keep the blades/traps that were active when cast.
- Bosses have intros, a 50%-health phase (with a free spell and an aura), opening wards, and "freed" lines on victory.
- Spell cards show their real, boosted numbers in gold when blades/traps/weaknesses apply; tooltip lists every modifier.
- New spell visuals per school: bolts, meteors, Golem Fist, Wave Serpent, lightning, swarms, and summoned 5-pip creatures (Phoenix, Stone Titan, Leviathan, Sun, Shadow Raven). Cast sigils under the caster.
- Duel camera moved to a 3/4 view; world name tags hidden during duels; regular mobs only shout the first time you meet them.
**Progression & economy**
- Learn new spells from your school trainer (W101 style). Training points (L2/4/6/8) buy other schools' utility spells.
- Crafting at Wren and Pip: potions, Spell Scrolls and amulets from reagents.
- Rare/epic gear, per-school boss drops, Spell Scrolls re-roll if they're your own school.
- Level-9 Luminary gear tier. Starter gear from the first Mosslight quests.
**World & story**
- Hub renamed Lanternmere (original IP). New side quest "Relight the Path" (relight lanterns with E).
- Zones visibly heal after their boss is freed. South Gate plaza reserved for future zones.
- In-world ending; cliffhanger lives in lore.js.
**Fixes** (from lead-programmer review): player model could vanish after a defeat; Spell Scrolls were unusable; panels lost clicks; minimap rotated 180°; E taps missed; Enter re-opened dialogs; memory leaks over long sessions; duel UI showed results before animations; save import/migration hardening; flee/charm-cap feedback; keyboard handling for overlays.


## v0.1.0 — Chapter One: The Black Feathers (first playable, internal)
- 3 schools: Stoneward (tank), Tidecaller (balanced), Emberstrike (damage).
- Levels 1–10 (data-driven cap, ready for 11+).
- 4 zones in 3D: Lanternmere (hub), Mosslight Path (L1–3), Whisperwood (L3–6), Ashen Ruins (L6–10).
- Turn-based card duels: pips, mana, accuracy/fizzles, blades, traps, shields, weakness, absorbs, burns, heals over time, drains, area spells, spell scrolls; live damage preview showing how blades/traps change each spell.
- 13 enemy types incl. 4 bosses (Grubnak, Thornmaw, Captain Vex, Nyx the Herald) with distinct AI personalities.
- 22 quests (17 main story + 5 side), 10 NPCs, Good (Lumen Order) vs Evil (Hollow Court).
- Loot: gold, reagents, gear (5 slots), potions, spell scrolls. Shops.
- Spellbook deck editor, backpack/equipment, quest log & tracker, minimap, wisps, autosave + export/import.
- Synthesized sound effects and adaptive ambient music per zone.
