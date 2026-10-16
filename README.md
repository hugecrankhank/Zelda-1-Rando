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
├── emu/                 the NES emulator (same design as ALTTPR Snes9x's)
│   ├── fceumm.wasm      libretro FCEUmm + core/frontend.c, clang + wasi-libc (no Emscripten)
│   ├── core.js          loads the wasm (minimal WASI shim)
│   ├── player.js        game box: on-screen controller, top bar, menu, saves
│   ├── video.js         WebGL2 shader runner (6xBRZ, 4xBRZ, sharp, smooth, CRT)
│   └── audio.js         AudioWorklet output with drift correction
├── js/nes-bridge.js     the tracker's live view of the NES's 2 KB RAM
├── js/tracker.js        items, levels, overworld + dungeon maps, pickup log
├── js/seed.js           "New seed" dialog
├── js/diag.js           crash recorder and status panel
└── zora/seed-worker.js  ZORA randomizer, in Pyodide, in a Web Worker
```

**Emulator.** FCEUmm, compiled to WebAssembly with a few kilobytes of glue
(`core/frontend.c`) instead of running inside EmulatorJS/RetroArch. It uses
about a quarter of the memory, and the core reports where it keeps the NES's
RAM, so the tracker reads live memory directly. The player (`emu/player.js`,
`video.js`, `audio.js`, `input.js`, shaders) comes from ALTTPR Snes9x, adapted
for the NES's two buttons: on-screen controller under the picture on phones,
a top bar with pause, fast-forward and four save-state slots (F5 / F8), and a
menu (⋯) for volume, filter, aspect ratio, controller size and remapping.
In-game saves are kept per ROM; the running game is also snapshotted every
20 s so **Continue** resumes where you were if the app is closed.

Rebuild the core (optional, `emu/fceumm.wasm` is committed):

```bash
SYSROOT=/path/to/wasi-sysroot BUILTINS=/path/to/libclang_rt.builtins-wasm32.a sh core/build.sh
```

wasi-sdk provides both; `core/build.sh` clones FCEUmm at the pinned commit.

**Seeds.** [ZORA](https://github.com/tetraly/zora) (MIT, by Tetra) is a
Python Zelda 1 randomizer. Its wheel is bundled in `zora/` and runs in the
browser through [Pyodide](https://pyodide.org) (loaded from jsDelivr the first
time you open the dialog, then cached). Presets, the flag string, ZORA's
extras string and every individual flag are available; the file-select code
and spoiler log come with each seed. Your base ROM and the seed you're playing
are kept in this browser (IndexedDB), never uploaded.

**Tracker.** Laid out like [Z-Tracker](https://github.com/Stevie-O/ZTracker):

- **Dungeon item area:** each level's number (gray until you find its
  entrance), triforce, map and compass, and item boxes: red while empty,
  green with the item once you get it there.
- **Other item area:** the wood, white and magical sword caves, the letter
  cave, the coast and armos items, and the four take-any hearts.
- **Overworld:** the seed's own map, drawn from the ROM you're playing
  (`js/owmap.js`), so mixed-quest and other changed overworlds look right.
  It starts fully lit; each screen fades once you've walked it. Every
  screen with an entrance has a check indicator: a dot while unvisited
  (green: you can open it now, red: you need bombs, a candle, the bracelet,
  raft, ladder or recorder first), a gold ring when you've been in but left
  its item behind, and a check mark when it's done. Once you've been in, the
  tile shows what's there (level number, sword, take-any, a shop's wares...).
  Tap a screen for a magnified view and to label it by hand. The **Spots**
  box hides the entrance dots if you'd rather find them yourself.

**Autotracking.** From the NES's RAM the tracker reads:

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
NesBridge.status()          // mode: 'live' | 'idle'
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

- **Changing games reloads the page.** The player runs one game per load.
  The new seed is stored first and starts right after the reload.
- **iPhone can close the app when memory runs low.** The randomizer is
  unloaded once a game starts, and the running game is snapshotted every 20 s
  and whenever the app goes to the background, so **Continue** resumes right
  where you were.
- **The first seed needs a connection** to download Pyodide (~10 MB); after
  that it's cached.

## Credits

- Tracker layout inspired by [Z-Tracker](https://github.com/Stevie-O/ZTracker) (no code
  or images used). Overworld table offsets and entrance types from ZORA's
  `zora/rom/vanilla_overworld/` and `zora/model/overworld.py` (MIT); NES
  palette from [cynes](https://github.com/Youlixx/cynes) (MIT, via ZORA).
- Randomizer: [ZORA](https://github.com/tetraly/zora) by Tetra, MIT License
  (see `zora/LICENSE`). `zora/seed-worker.js` is adapted from its web worker.
- RAM map: [aldonunez/zelda1-disassembly](https://github.com/aldonunez/zelda1-disassembly).
- Emulator: [libretro FCEUmm](https://github.com/libretro/libretro-fceumm)
  (GPL-2.0, `core/LICENSES/`); player from ALTTPR Snes9x; shaders from
  [libretro/glsl-shaders](https://github.com/libretro/glsl-shaders) (each file's header).
- No ROMs are included. Use your own legally obtained copy.
