# Z1R Unified — roll, play and track Zelda 1 randomizer seeds in one page

The Zelda 1 sibling of ALTTPR Unified. Generate a randomized Legend of Zelda
from your own ROM, play it in the browser, and the tracker follows along as
you play. Works on PC and phones, and installs as an app.

## Run it

It must be served over HTTP (opening `index.html` as a file won't work: the
seed generator runs in a Web Worker, which browsers block on `file://`).

```bash
cd z1r-unified
python3 -m http.server 8080      # or: npx serve .
```

Open http://localhost:8080, tap **New seed**, choose your Legend of Zelda
(USA) `.nes` ROM, pick a preset or paste flags, and tap **Generate**, then
**Play now**. Already have a randomized ROM (from zora.gg or the Z1R desktop
app)? Use **Play ROM file**; the tracker works with any Zelda 1 ROM.

It also works as a static site. Push to a GitHub repo and the included
workflow publishes it to GitHub Pages, which lets you play from any device.

## What's in the page

```
index.html
├── EmulatorJS (FCEUmm core, from cdn.emulatorjs.org)
├── js/nes-bridge.js   ← finds the NES's 2 KB RAM inside the emulator
├── js/tracker.js      ← items, levels, overworld + dungeon maps, pickup log
├── js/seed.js         ← "New seed" dialog
└── zora/seed-worker.js  ← ZORA randomizer, in Pyodide, in a Web Worker
```

**Seeds.** [ZORA](https://github.com/tetraly/zora) (MIT, by Tetra) is a
Python Zelda 1 randomizer. Its wheel is bundled in `zora/` and runs in the
browser through [Pyodide](https://pyodide.org) (loaded from jsDelivr the first
time you open the dialog, then cached). Presets, the flag string, ZORA's
extras string and every individual flag are available; the file-select code
and spoiler log come with each seed. Your base ROM and the seed you're playing
are kept in this browser (IndexedDB), never uploaded.

**Autotracking.** EmulatorJS doesn't export the core's memory, but its save
states do: FCEUmm stores CPU RAM as a tagged `RAM` block. The bridge takes one
state, finds that block, then searches the emulator's heap for the same 2 KB.
From then on reads are direct views into live memory; it re-checks every few
seconds and relocates if needed, falling back to throttled snapshots if the
search fails. From RAM the tracker reads:

- inventory ($0657–$0676), hearts, rupees, keys, bombs and bomb capacity
- triforce pieces, maps and compasses per level
- where Link is ($0010 level, $00EB room): overworld screens fill in as you
  walk them, and when you enter a level the screen you came from is marked as
  its entrance
- dungeon rooms you visit, drawn as a map per level, with taken items marked
- every item you pick up, with the screen or room it came from

Everything can also be set by hand: tap an item to cycle it (right-click to go
back), tap a level's triforce, map or compass, and tap any overworld screen to
label it (levels, sword caves, shops, take-any, hints and so on). A hand-set
value stays until the game's own value changes. Tracking is saved per ROM, and
each ROM gets its own battery save, so seeds never overwrite each other.

## Debugging

```js
NesBridge.status()          // mode: 'live' | 'snapshot' | 'idle'
NesBridge.peek(0x657, 32)   // dump inventory bytes
Z1Tracker._state()          // tracker data for this seed
```

## Updating ZORA

Rebuild the wheel from a ZORA checkout and replace `zora/zora-*.whl`, then
update `zora/wheel.json` (and `zora/flag-tabs.json` from ZORA's `web/`).
Bundled: ZORA 2.0 beta 5 (commit 67a24be). ZORA is in beta: its author notes
seeds are checked by automated tests and may be unbeatable, so report odd
seeds with the seed, flags and spoiler log in the ZORA Discord.

## Known limits

- **FCEUmm core only.** The bridge parses FCEUmm's state format.
- **Changing games reloads the page.** EmulatorJS can't swap games in place.
  The new seed is stored first and starts right after the reload.
- **iPhone can close the app when memory runs low.** The randomizer is
  unloaded once a game starts, and the running game is snapshotted every 20 s
  and whenever the app goes to the background, so **Continue** resumes right
  where you were.
- **The first seed needs a connection** to download Pyodide (~10 MB); after
  that it's cached.

## Credits

- Randomizer: [ZORA](https://github.com/tetraly/zora) by Tetra, MIT License
  (see `zora/LICENSE`). `zora/seed-worker.js` is adapted from its web worker.
- RAM map: [aldonunez/zelda1-disassembly](https://github.com/aldonunez/zelda1-disassembly).
- Emulator: [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0)
  with libretro FCEUmm, loaded from its CDN at runtime.
- No ROMs are included. Use your own legally obtained copy.
