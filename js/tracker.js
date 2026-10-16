/*
 * tracker.js — Zelda 1 tracker in the spirit of Z-Tracker
 * (github.com/Stevie-O/ZTracker), autotracked from NES RAM.
 *
 *  - Dungeon item area: per level a numeral (gray until its entrance is
 *    known), its triforce, map and compass, and item boxes (red while empty,
 *    green with the item once you got it there).
 *  - Other item area: wood/white/magical sword caves, letter cave, coast and
 *    armos item boxes, and the four take-any hearts.
 *  - Overworld: the seed's real map (js/owmap.js), fully lit at the start;
 *    screens fade as you walk them. Every screen with an entrance carries a
 *    check indicator: a dot colored by whether you can open it now, a gold
 *    ring when you've been in but left something behind, a check mark when
 *    it's done. Once you've been inside, the tile shows what it is.
 *
 * RAM (aldonunez's disassembly labels, as ZORA's inventory module uses):
 *   $0010 CurLevel  $0012 GameMode (5 play, $B cave, $C any road)  $0016 slot
 *   $00EB RoomId    $0657… inventory   $066F hearts   $0671 triforces
 *   $067F WorldFlags: overworld, levels 1-6, levels 7-9 ($80 secret found,
 *         $10 item taken)   $062D QuestNumbers (per slot)
 * Cartridge RAM: $687E LevelBlockAttrsA-F (live overworld tables).
 */
(function () {
  'use strict';

  const I = () => window.Z1Icons;
  const A = { LEVEL: 0x10, MODE: 0x12, SLOT: 0x16, ROOM: 0xEB, BOMBS: 0x658, MAXBOMBS: 0x67C,
    COMPASS: 0x667, MAP: 0x668, COMPASS9: 0x669, MAP9: 0x66A, RUPEES: 0x66D, KEYS: 0x66E,
    HEARTS: 0x66F, TRIFORCE: 0x671, MAGICKEY: 0x664, WORLD: 0x67F, QUEST: 0x62D };
  const PLAY = 5, CAVE = 0x0B, SHORTCUT = 0x0C, WIN = 0x13;
  const LOADED_MODES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 0xA, 0xB, 0xC, 0x10, 0x11, 0x12, 0x13]);
  const SRAM_BLOCK = 0x087E;            // LevelBlockAttrsA in cartridge RAM
  const COAST_SCREEN = 0x5F;

  const ITEMS = [
    { id: 'sword', names: ['Sword', 'Wooden sword', 'White sword', 'Magical sword', 'Level 4 sword'], addr: 0x657, max: 3,
      icon: 'sword', tint: [null, { x: 'N', z: 'T' }, { x: 'W', z: 'G' }, { x: 'C', z: 'B' }, { x: 'Y', z: 'O' }] },
    { id: 'boomerang', names: ['Boomerang', 'Boomerang', 'Magical boomerang'], max: 2, icon: 'boomerang',
      read: (r) => (r[0x675] ? 2 : r[0x674] ? 1 : 0), tint: [null, { x: 'N', z: 'Y' }, { x: 'B', z: 'C' }] },
    { id: 'bombs', names: ['Bombs', 'Bombs'], max: 1, icon: 'bomb', read: (r) => (r[A.BOMBS] > 0 || r[A.MAXBOMBS] > 8 ? 1 : 0),
      badge: (st) => st.bombs + '/' + st.maxBombs },
    { id: 'bow', names: ['Bow', 'Bow'], addr: 0x65A, max: 1, icon: 'bow' },
    { id: 'arrows', names: ['Arrows', 'Wooden arrows', 'Silver arrows'], addr: 0x659, max: 2, icon: 'arrow',
      tint: [null, { x: 'Y', z: 'G' }, { x: 'W', z: 'C' }] },
    { id: 'candle', names: ['Candle', 'Blue candle', 'Red candle'], addr: 0x65B, max: 2, icon: 'candle',
      tint: [null, { x: 'B', z: 'C' }, { x: 'R', z: 'O' }] },
    { id: 'recorder', names: ['Recorder', 'Recorder'], addr: 0x65C, max: 1, icon: 'recorder' },
    { id: 'bait', names: ['Bait', 'Bait'], addr: 0x65D, max: 1, icon: 'bait' },
    { id: 'potion', names: ['Potion', 'Blue potion', 'Red potion', 'Red potion ×2', 'Red potion ×2'], addr: 0x65E, max: 2,
      icon: 'potion', tint: [null, { x: 'B', z: 'C' }, { x: 'R', z: 'O' }, { x: 'R', z: 'O' }, { x: 'R', z: 'O' }] },
    { id: 'letter', names: ['Letter', 'Letter', 'Letter (shown)'], addr: 0x666, max: 2, icon: 'letter',
      tint: [null, { x: 'G', z: 'G' }, { x: 'R', z: 'R' }] },
    { id: 'wand', names: ['Wand', 'Wand'], addr: 0x65F, max: 1, icon: 'wand' },
    { id: 'book', names: ['Book', 'Book of Magic'], addr: 0x661, max: 1, icon: 'book' },
    { id: 'raft', names: ['Raft', 'Raft'], addr: 0x660, max: 1, icon: 'raft' },
    { id: 'ladder', names: ['Ladder', 'Ladder'], addr: 0x663, max: 1, icon: 'ladder' },
    { id: 'bracelet', names: ['Power bracelet', 'Power bracelet'], addr: 0x665, max: 1, icon: 'bracelet' },
    { id: 'magickey', names: ['Magical key', 'Magical key'], addr: 0x664, max: 1, icon: 'key' },
    { id: 'ring', names: ['Ring', 'Blue ring', 'Red ring'], addr: 0x662, max: 2, icon: 'ring',
      tint: [null, { x: 'B', z: 'C' }, { x: 'R', z: 'O' }] },
    { id: 'shield', names: ['Magical shield', 'Magical shield'], addr: 0x676, max: 1, icon: 'shield' },
  ];
  const ITEM = Object.fromEntries(ITEMS.map((d) => [d.id, d]));

  // Zelda item codes (shop wares) → [icon, tint, name]
  const WARE = {
    0x00: ['bomb', null, 'Bombs'], 0x01: ['sword', { x: 'N', z: 'T' }, 'Wooden sword'], 0x02: ['sword', null, 'White sword'],
    0x03: ['sword', { x: 'C', z: 'B' }, 'Magical sword'], 0x04: ['bait', null, 'Bait'], 0x05: ['recorder', null, 'Recorder'],
    0x06: ['candle', { x: 'B', z: 'C' }, 'Blue candle'], 0x07: ['candle', { x: 'R', z: 'O' }, 'Red candle'],
    0x08: ['arrow', { x: 'Y', z: 'G' }, 'Wooden arrows'], 0x09: ['arrow', { x: 'W', z: 'C' }, 'Silver arrows'],
    0x0A: ['bow', null, 'Bow'], 0x0B: ['key', null, 'Magical key'], 0x0C: ['raft', null, 'Raft'], 0x0D: ['ladder', null, 'Ladder'],
    0x0F: ['rupee', { x: 'B', z: 'C' }, '5 rupees'], 0x10: ['wand', null, 'Wand'], 0x11: ['book', null, 'Book'],
    0x12: ['ring', { x: 'B', z: 'C' }, 'Blue ring'], 0x13: ['ring', { x: 'R', z: 'O' }, 'Red ring'],
    0x14: ['bracelet', null, 'Power bracelet'], 0x15: ['letter', { x: 'G', z: 'G' }, 'Letter'], 0x16: ['compass', null, 'Compass'],
    0x17: ['map', null, 'Map'], 0x18: ['rupee', { x: 'Y', z: 'W' }, 'Rupee'], 0x19: ['key', null, 'Key'],
    0x1A: ['heart', null, 'Heart container'], 0x1B: ['triforce', null, 'Triforce'], 0x1C: ['shield', null, 'Magical shield'],
    0x1D: ['boomerang', { x: 'N', z: 'Y' }, 'Boomerang'], 0x1E: ['boomerang', { x: 'B', z: 'C' }, 'Magical boomerang'],
    0x1F: ['potion', { x: 'B', z: 'C' }, 'Blue potion'], 0x20: ['potion', { x: 'R', z: 'O' }, 'Red potion'],
    0x22: ['heart', null, 'Heart'],
  };

  // Tile labels: auto (from what you entered) or set by hand from the picker.
  const KINDS = {
    wood: ['Wooden sword cave', 'cave'], white: ['White sword cave', 'cave'], magic: ['Magical sword cave', 'cave'],
    letter: ['Letter cave', 'cave'], takeany: ['Take any one', 'cave'], shop: ['Shop', 'cave'], potion: ['Potion shop', 'cave'],
    hint: ['Hint', 'cave'], money: ['Secret money', 'cave'], gamble: ['Money-making game', 'cave'], repair: ['Door repair', 'cave'],
    anyroad: ['Any road', 'cave'], cave: ['Cave', 'cave'], bombup: ['Bomb upgrade', 'cave'],
    item: ['Item here', 'other'], armos: ['Armos item', 'other'], nothing: ['Nothing here', 'other'],
  };
  for (let n = 1; n <= 9; n++) KINDS['L' + n] = ['Level ' + n, 'lv'];
  const PICKER = [['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
    ['wood', 'white', 'magic', 'letter', 'takeany', 'shop', 'potion', 'hint', 'money', 'gamble', 'repair', 'anyroad', 'bombup'],
    ['item', 'armos', 'nothing']];
  // A cave whose item you can leave behind: wood/white/magic sword, letter, take any.
  const ITEM_CAVE = { 0x10: 1, 0x11: 1, 0x12: 1, 0x13: 1, 0x18: 1 };
  const NEEDS = { bomb: 'bombs', candle: 'a candle', bracelet: 'the power bracelet', raft: 'the raft',
    ladder: 'the ladder', 'ladder+bomb': 'the ladder and bombs', recorder: 'the recorder', open: '' };

  const coord = (s) => 'ABCDEFGH'[(s >> 4) & 7] + ((s & 15) + 1);

  // ── state ────────────────────────────────────────────────────────────────
  const blank = () => ({ v: 2, manual: {}, lvManual: {}, entrance: {}, entranceManual: {}, marks: {},
    visited: [], entered: {}, rooms: {}, log: [], hideSpots: false });
  let S = blank();
  let key = 'z1ru:track:manual';
  let label = 'No seed';
  let auto = null;            // last auto values {items, lv, stats}
  let ram = null;             // last RAM view
  let pos = null;             // {level, room}
  let lastOW = null, prevLevel = null, curSlot = null, needBaseline = true, lastMode = null;
  let quest = 0;              // the file's quest: 0 first, 1 second
  let liveDest = null;        // live overworld destinations from cartridge RAM
  let ow = null;              // OwMap for this ROM, or null
  let mapInfo = 'no map', mapTables = '';
  let mapCanvas = null, mapSecret = new Uint8Array(128), mapDirty = false;
  let link = 'off';           // off | waiting | live
  let view = 'ow', dgLevel = 1, dgPinned = false;
  const COMPACT = window.matchMedia('(max-width: 900px) and (orientation: portrait), (orientation: landscape) and (max-height: 560px)');
  const isCompact = () => COMPACT.matches;
  if (isCompact()) view = 'items';
  const linkListeners = new Set();
  let el = {};
  let dirty = true;

  function save() {
    clearTimeout(save.t);
    save.t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(S)); } catch (e) {} }, 300);
  }
  function load(k) {
    try { const raw = localStorage.getItem(k); if (raw) return Object.assign(blank(), JSON.parse(raw)); } catch (e) {}
    return blank();
  }

  // ── reading RAM ──────────────────────────────────────────────────────────
  function fileLoaded(r) {
    return r[0xF5] === 0x5A && r[0x528] === 0x5A && r[A.SLOT] < 3 && LOADED_MODES.has(r[A.MODE]);
  }
  function readAll(r) {
    const items = {};
    ITEMS.forEach((d) => { items[d.id] = d.read ? d.read(r) : r[d.addr]; });
    const lv = {};
    for (let n = 1; n <= 9; n++) {
      lv[n] = n < 9
        ? { tri: (r[A.TRIFORCE] >> (n - 1)) & 1, map: (r[A.MAP] >> (n - 1)) & 1, compass: (r[A.COMPASS] >> (n - 1)) & 1 }
        : { tri: r[A.MODE] === WIN ? 1 : 0, map: r[A.MAP9] ? 1 : 0, compass: r[A.COMPASS9] ? 1 : 0 };
    }
    return {
      items, lv,
      hearts: (r[A.HEARTS] >> 4) + 1,
      maxBombs: r[A.MAXBOMBS],
      stats: { rupees: r[A.RUPEES], keys: r[A.KEYS], bombs: r[A.BOMBS], maxBombs: r[A.MAXBOMBS],
        hearts: (r[A.HEARTS] >> 4) + 1, magicKey: !!r[A.MAGICKEY] },
    };
  }

  // The destination of an overworld screen: the game's live table when we
  // have it (it includes second-quest changes), else the ROM's.
  function destOf(s) {
    if (liveDest) return liveDest[s];
    return ow ? ow.destFor(s, quest) : 0;
  }
  // Reads the live overworld tables from cartridge RAM while on the
  // overworld; checks table A against the ROM's so we never mistake a
  // dungeon's tables for the overworld's.
  // While on the overworld, the game's live tables replace the ROM file's:
  // they're what the game itself draws from. Checked every few seconds.
  let liveCheckAt = 0;
  function readLiveTables() {
    const sr = window.NesBridge && NesBridge.sram && NesBridge.sram();
    if (!sr || !ow) return;
    const now = performance.now();
    if (liveDest && now - liveCheckAt < 5000) return;
    liveCheckAt = now;
    const changed = ow.applyLive(sr);
    if (changed < 0) return;
    if (changed > 0) {
      mapInfo = 'drawn from the game\'s live tables (' + changed + ' screens differed from the ROM file)';
      mapDirty = true; dirty = true;
    } else if (!liveDest) mapInfo = 'drawn from the ROM file (matches the game\'s live tables)';
    const d = new Array(128);
    for (let s = 0; s < 128; s++) d[s] = (sr[SRAM_BLOCK + 0x80 + s] >> 2) & 0x3F;
    liveDest = d;
  }

  function logPickup(id, v, where, mode) {
    const e = { id, v, lv: where.level, room: where.room, t: Date.now() };
    if (where.level === 0 && mode === CAVE) e.cave = destOf(where.room);
    S.log.push(e);
    if (S.log.length > 300) S.log.shift();
  }

  function tick() {
    const r = window.NesBridge && window.NesBridge.ram();
    if (!r) { setLink(window.EJS_emulator ? 'waiting' : 'off'); return; }
    if (!fileLoaded(r)) { setLink('waiting'); needBaseline = true; ram = null; pos = null; return; }
    ram = r;
    setLink('live');
    const now = readAll(r);
    const slot = r[A.SLOT], level = r[A.LEVEL], room = r[A.ROOM], mode = r[A.MODE];
    if (slot !== curSlot) { needBaseline = true; curSlot = slot; lastOW = null; prevLevel = null; liveDest = null; }
    const q = r[A.QUEST + slot] ? 1 : 0;
    if (q !== quest) { quest = q; dirty = true; }
    const where = { level: level <= 9 ? level : 0, room };

    if (!needBaseline && auto) {
      ITEMS.forEach((d) => {
        const a = now.items[d.id], b = auto.items[d.id];
        if (a !== b) { delete S.manual[d.id]; dirty = true; }
        if (a > b && d.id !== 'bombs' && !(d.id === 'letter' && a === 2)) logPickup(d.id, a, where, mode);
      });
      if (now.hearts > auto.hearts) logPickup('heart', now.hearts, where, mode);
      if (now.maxBombs > auto.maxBombs) logPickup('bombup', now.maxBombs, where, mode);
      for (let n = 1; n <= 9; n++) {
        ['tri', 'map', 'compass'].forEach((f) => {
          if (now.lv[n][f] !== auto.lv[n][f]) {
            if (S.lvManual[n]) delete S.lvManual[n][f];
            if (now.lv[n][f] > auto.lv[n][f] && !(n === 9 && f === 'tri')) logPickup(f === 'tri' ? 'triforce' : f, n, where, mode);
            dirty = true;
          }
        });
      }
      if (JSON.stringify(now.stats) !== JSON.stringify(auto.stats)) dirty = true;
    }
    needBaseline = false;
    auto = now;

    if (level === 0 && mode === PLAY) readLiveTables();

    // Caves and any roads: the screen you entered from.
    if (level === 0 && (mode === CAVE || mode === SHORTCUT) && room < 0x80 && S.entered[room] === undefined) {
      S.entered[room] = destOf(room) || (mode === SHORTCUT ? 0x14 : 0);
      dirty = true;
    }
    // Secrets found (bombed, burned, pushed): redraw that screen opened.
    if (ow) {
      for (let s = 0; s < 128; s++) {
        const f = r[A.WORLD + s] & 0x80 ? 1 : 0;
        if (f !== mapSecret[s]) { mapSecret[s] = f; mapDirty = true; dirty = true; }
      }
    }

    if (mode === PLAY && level <= 9) {
      if (level === 0) {
        if (lastOW !== room) dirty = true;
        lastOW = room;
        if (S.visited.indexOf(room) < 0) { S.visited.push(room); dirty = true; }
      } else {
        const rooms = S.rooms[level] || (S.rooms[level] = []);
        if (rooms.indexOf(room) < 0) {
          Object.keys(S.rooms).forEach((k) => {
            const sameGrid = (k < 7) === (level < 7);
            if (+k !== level && sameGrid) S.rooms[k] = S.rooms[k].filter((x) => x !== room);
          });
          rooms.push(room); dirty = true;
        }
      }
      if (prevLevel === 0 && level >= 1 && lastOW !== null) {
        if (!S.entranceManual[level] && S.entrance[level] !== lastOW) { S.entrance[level] = lastOW; dirty = true; }
        if (S.entered[lastOW] === undefined) { S.entered[lastOW] = level; dirty = true; }
      }
      prevLevel = level;
    }
    lastMode = mode;
    const p = mode === PLAY ? level + ':' + room : null;
    if (p !== (pos && pos.key)) { pos = p ? { key: p, level, room } : null; dirty = true; }
    if (pos && pos.level >= 1 && !dgPinned && dgLevel !== pos.level) { dgLevel = pos.level; dirty = true; }
    if (dirty) { save(); render(); }
  }

  function setLink(s) {
    if (s === link) return;
    link = s; dirty = true;
    linkListeners.forEach((fn) => { try { fn(s); } catch (e) {} });
    render();
  }

  // ── derived values ───────────────────────────────────────────────────────
  function itemValue(id) {
    if (S.manual[id] !== undefined) return S.manual[id];
    return auto && link === 'live' ? auto.items[id] : 0;
  }
  function lvValue(n, f) {
    const m = S.lvManual[n];
    if (m && m[f] !== undefined) return m[f];
    return auto && link === 'live' ? auto.lv[n][f] : 0;
  }
  function entranceOf(n) { return S.entrance[n] !== undefined ? S.entrance[n] : null; }

  // What a tile is labelled as: a hand-set mark, a level entrance, or what
  // you found inside.
  function kindAt(s) {
    if (S.marks[s]) return S.marks[s];
    for (let n = 1; n <= 9; n++) if (entranceOf(n) === s) return 'L' + n;
    if (S.entered[s] !== undefined) return OwMap.kindOf(S.entered[s]) || 'cave';
    return null;
  }

  // The seed's entrance on a screen, for this file's quest; null if none.
  function spotAt(s) {
    if (!ow) return null;
    const sc = ow.screen(s);
    const dest = destOf(s);
    if (!dest) return null;
    const vis = sc.quest === 0 || (sc.quest === 1 && quest === 0) || (sc.quest === 2 && quest === 1);
    if (!vis) return null;
    return { dest, how: sc.entrance };
  }
  function canOpen(how) {
    const has = (id) => itemValue(id) > 0;
    const bombs = (auto && link === 'live' ? auto.stats.bombs > 0 : false) || S.manual.bombs > 0;
    switch (how) {
      case 'open': return true;
      case 'bomb': return bombs;
      case 'candle': return has('candle');
      case 'bracelet': return has('bracelet');
      case 'raft': return has('raft');
      case 'ladder': return has('ladder');
      case 'ladder+bomb': return has('ladder') && bombs;
      case 'recorder': return has('recorder');
      default: return null;          // unknown: yellow
    }
  }
  // Check state of a screen: null (no check), 'todo', 'return', 'done'.
  function checkState(s) {
    const spot = spotAt(s);
    const entered = S.entered[s] !== undefined;
    if (!spot && !entered) return null;
    if (!entered) return 'todo';
    const dest = spot ? spot.dest : S.entered[s];
    if (dest >= 1 && dest <= 9) return lvValue(dest, 'tri') ? 'done' : 'return';
    if (ITEM_CAVE[dest]) {
      const taken = (ram && (ram[A.WORLD + s] & 0x10)) || S.log.some((e) => e.lv === 0 && e.room === s && e.cave === dest);
      return taken ? 'done' : 'return';
    }
    return 'done';
  }

  // ── building the UI ──────────────────────────────────────────────────────
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    kids.flat().forEach((k) => { if (k != null) e.append(k.nodeType ? k : document.createTextNode(k)); });
    return e;
  }

  function build(root) {
    root.innerHTML = '';
    el.root = root;

    el.stats = h('div', { class: 't-stats' });

    // Dungeon item area
    el.dia = h('div', { class: 'dia', role: 'group', 'aria-label': 'Levels' });
    el.lvCells = {};
    for (let n = 1; n <= 9; n++) {
      const c = {
        num: h('button', { class: 'dia-num', type: 'button', title: 'Show level ' + n, onclick: () => showLevel(n) }, String(n)),
        tri: h('button', { class: 'dia-tri', type: 'button', onclick: () => toggleLv(n, 'tri') }),
        map: h('button', { class: 'dia-mini', type: 'button', onclick: () => toggleLv(n, 'map') }),
        compass: h('button', { class: 'dia-mini', type: 'button', onclick: () => toggleLv(n, 'compass') }),
        boxes: h('div', { class: 'dia-boxes' }),
      };
      el.lvCells[n] = c;
      el.dia.append(h('div', { class: 'dia-col' }, c.num, c.tri, h('span', { class: 'dia-mc' }, c.map, c.compass), c.boxes));
    }

    // Other item area
    el.oia = h('div', { class: 'oia', role: 'group', 'aria-label': 'Overworld items' });
    el.oiaBoxes = {};
    [['wood', 'Wood'], ['white', 'White'], ['magic', 'Magic'], ['letter', 'Letter'], ['coast', 'Coast'], ['armos', 'Armos']].forEach(([id, txt]) => {
      const b = h('span', { class: 'box' });
      el.oiaBoxes[id] = b;
      el.oia.append(h('span', { class: 'oia-slot' }, b, h('small', {}, txt)));
    });
    el.takeAny = h('span', { class: 'oia-ta', title: 'Take-any caves' });
    el.oia.append(el.takeAny);

    // Item progress
    el.items = h('div', { class: 't-items', role: 'group', 'aria-label': 'Items' });
    el.itemBtns = {};
    ITEMS.forEach((d) => {
      const b = h('button', { class: 'item', type: 'button', onclick: () => cycleItem(d.id, 1),
        oncontextmenu: (e) => { e.preventDefault(); cycleItem(d.id, -1); } },
        h('span', { class: 'ico' }), h('span', { class: 'badge' }));
      el.itemBtns[d.id] = b;
      el.items.append(b);
    });

    el.tabs = h('div', { class: 't-tabs', role: 'tablist' });
    el.tabBtns = {};
    [['items', 'Items'], ['ow', 'Overworld'], ['dg', 'Dungeons'], ['log', 'Pickups']].forEach(([id, txt]) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'tab-' + id, onclick: () => { view = id; dirty = true; render(); } }, txt);
      el.tabBtns[id] = b; el.tabs.append(b);
    });

    // Overworld: the map canvas with a grid of tappable screens over it
    el.ow = h('div', { class: 't-view ow' });
    el.map = h('div', { class: 'ow-map' });
    el.mapCanvas = h('canvas', { class: 'ow-canvas', 'aria-hidden': 'true' });
    el.grid = h('div', { class: 'ow-grid', role: 'grid', 'aria-label': 'Overworld screens' });
    el.owCells = [];
    for (let s = 0; s < 128; s++) {
      const cell = h('button', { class: 'ow-cell', type: 'button', 'aria-label': 'Screen ' + coord(s),
        onclick: (e) => openPicker(s, e.currentTarget) }, h('span', { class: 'lbl' }), h('span', { class: 'chk' }));
      el.owCells.push(cell); el.grid.append(cell);
    }
    el.map.append(el.mapCanvas, el.grid);
    el.owBar = h('div', { class: 'ow-bar' },
      h('span', { class: 'ow-count' }),
      h('label', { class: 'ow-toggle' }, h('input', { type: 'checkbox', onchange: (e) => { S.hideSpots = !e.target.checked; dirty = true; save(); render(); } }), 'Spots'));
    el.ow.append(el.map, el.owBar);

    // Dungeons
    el.dg = h('div', { class: 't-view dg' });
    el.dgChips = h('div', { class: 'dg-chips' });
    for (let n = 1; n <= 9; n++) el.dgChips.append(h('button', { type: 'button', 'aria-label': 'Level ' + n, onclick: () => showLevel(n) }, h('span', { class: 'lvword' }, 'Level '), String(n)));
    el.dgMap = h('div', { class: 'dg-map' });
    el.dgInfo = h('p', { class: 'hint' });
    el.dg.append(el.dgChips, el.dgMap, el.dgInfo);

    el.log = h('div', { class: 't-view log' });

    el.foot = h('div', { class: 't-foot' },
      h('span', { class: 'seed-label' }),
      h('button', { type: 'button', class: 'linkish', onclick: resetTracker }, 'Reset tracker'));

    el.picker = h('div', { class: 'picker', hidden: '' });
    el.itemsPanel = h('div', { class: 't-view itemsp' }, el.stats, el.dia, el.oia, el.items);
    root.append(el.itemsPanel, el.tabs, el.ow, el.dg, el.log, el.foot, el.picker);
    if (window.ResizeObserver) new ResizeObserver(() => { dirty = true; render(); }).observe(root);
    COMPACT.addEventListener && COMPACT.addEventListener('change', () => {
      if (isCompact() && view !== 'items') view = 'items';
      dirty = true; render();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!el.picker.hidden && !el.picker.contains(e.target) && !e.target.closest('.ow-cell')) closePicker();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
    dirty = true; render();
  }

  // ── sizing ───────────────────────────────────────────────────────────────
  // Every cell gets an explicit pixel size computed from the space available
  // (iPhone Safari sized percentage/aspect-ratio grid cells differently).
  function fit() {
    if (!el.root || !el.root.clientWidth) return;
    const compact = isCompact();
    const W = el.root.clientWidth;
    // Items panel: 9 level columns; one size for every box ("cell").
    if (!el.itemsPanel.hidden) {
      let cell = Math.floor((W - 8 * 3) / 9 - 4);
      const set = (c) => { el.itemsPanel.style.setProperty('--cell', c + 'px'); el.itemsPanel.style.setProperty('--item', c + 'px'); };
      if (compact) {
        // Phones: size the boxes to fill the panel's height. The content is
        // a fixed part plus 5.7 box heights (triforce .7, two level boxes,
        // one overworld box, two item rows): measure once, solve for the box.
        const H = el.itemsPanel.clientHeight;
        const cur = parseFloat(el.itemsPanel.style.getPropertyValue('--cell')) || 24;
        set(cur);
        const used = el.stats.offsetHeight + el.dia.offsetHeight + el.oia.offsetHeight + el.items.offsetHeight + 16;
        const fixed = used - 5.7 * cur;
        cell = Math.min(cell, Math.floor((H - fixed) / 5.7));
      }
      cell = Math.max(18, Math.min(compact ? 44 : 46, cell));
      set(cell);
    }
    // Overworld: 16x8 screens of 16:11, the whole map as large as fits.
    if (!el.ow.hidden) {
      let w = W, hgt = w * 11 * 8 / (16 * 16);
      if (compact) {
        const H = el.ow.clientHeight - el.owBar.offsetHeight - 4;
        if (H > 0 && hgt > H) { hgt = H; w = hgt * 16 * 16 / (11 * 8); }
      }
      w = Math.floor(w / 16) * 16;
      hgt = Math.round(w * 11 * 8 / 256);
      if (el.map.clientWidth !== w || el.map.clientHeight !== hgt) {
        el.map.style.width = w + 'px'; el.map.style.height = hgt + 'px';
        el.map.style.setProperty('--owh', (hgt / 8) + 'px');
        mapDirty = true;
      }
    }
  }

  // ── the map image ────────────────────────────────────────────────────────
  // Drawn at the map's display size (times the screen's pixel density) from
  // the ROM; redrawn when the size changes or a secret is found.
  function drawMap() {
    if (!mapDirty || el.ow.hidden) return;
    mapDirty = false;
    const c = el.mapCanvas;
    const cw = el.map.clientWidth, ch = el.map.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    const ctx = c.getContext('2d');
    if (!ow) { ctx.clearRect(0, 0, c.width, c.height); return; }
    ow.drawMap(ctx, c.width, c.height, (s) => !!mapSecret[s]);
  }

  // ── interactions ─────────────────────────────────────────────────────────
  function cycleItem(id, dir) {
    const d = ITEM[id], cur = itemValue(id);
    let v = cur + dir;
    if (v > d.max) v = 0;
    if (v < 0) v = d.max;
    S.manual[id] = v;
    dirty = true; save(); render();
  }
  function toggleLv(n, f) {
    const m = S.lvManual[n] || (S.lvManual[n] = {});
    m[f] = lvValue(n, f) ? 0 : 1;
    dirty = true; save(); render();
  }
  function showLevel(n) { dgLevel = n; dgPinned = !(pos && pos.level === n); view = 'dg'; dirty = true; render(); }

  function tileText(s) {
    const k = kindAt(s), st = checkState(s), spot = spotAt(s);
    let t = 'Screen ' + coord(s);
    if (k) t += ': ' + KINDS[k][0];
    if (st === 'todo' && spot && !S.hideSpots) {
      const can = canOpen(spot.how);
      t += spot.how === 'open' ? ', entrance not visited' : ', entrance (needs ' + (NEEDS[spot.how] || 'something') + ')' + (can ? ', you can open it' : '');
    }
    if (st === 'return') t += ', something left here';
    if (st === 'done') t += ', done';
    const pk = S.log.filter((e) => e.lv === 0 && e.room === s);
    if (pk.length) t += '; got ' + pk.map((e) => itemName(e.id, e.v)).join(', ');
    return t;
  }

  function openPicker(s, anchor) {
    const p = el.picker;
    p.innerHTML = '';
    const cur = kindAt(s);
    p.append(h('div', { class: 'pk-head' }, tileText(s)));
    // Magnified screen, like Z-Tracker's hover magnifier.
    if (ow) {
      const cv = h('canvas', { class: 'pk-zoom', width: '256', height: '176' });
      ow.drawScreen(cv.getContext('2d'), s, !!mapSecret[s]);
      p.append(cv);
    }
    PICKER.forEach((g, gi) => {
      const row = h('div', { class: 'pk-row pk-' + ['lv', 'cave', 'other'][gi] });
      g.forEach((k) => {
        row.append(h('button', { type: 'button', class: cur === k ? 'on' : '', title: KINDS[k][0],
          onclick: () => { setMark(s, k); closePicker(); } }, gi === 0 ? k : KINDS[k][0]));
      });
      p.append(row);
    });
    p.append(h('button', { type: 'button', class: 'pk-clear', onclick: () => { setMark(s, null); closePicker(); } }, 'Clear label'));
    p.hidden = false;
    const r = anchor.getBoundingClientRect(), pw = Math.min(320, window.innerWidth - 16);
    p.style.width = pw + 'px';
    p.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    const ph = Math.min(p.offsetHeight, window.innerHeight - 16);
    const below = r.bottom + 6 + ph < window.innerHeight;
    p.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - ph - 6)) + 'px';
  }
  function closePicker() { if (el.picker) el.picker.hidden = true; }

  function setMark(s, code) {
    for (let n = 1; n <= 9; n++) {
      if (entranceOf(n) === s && code !== 'L' + n) { delete S.entrance[n]; S.entranceManual[n] = true; }
    }
    delete S.marks[s];
    if (code && /^L\d$/.test(code)) {
      const n = +code[1];
      Object.keys(S.marks).forEach((k) => { if (S.marks[k] === code) delete S.marks[k]; });
      S.entrance[n] = s; S.entranceManual[n] = true;
    } else if (code) {
      S.marks[s] = code;
    }
    dirty = true; save(); render();
  }

  function resetTracker() {
    if (!confirm('Clear everything tracked for ' + label + '? Items read from the game come back on their own.')) return;
    S = blank(); lastOW = null; prevLevel = null; needBaseline = true;
    dirty = true; save(); render();
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function itemName(id, v) {
    if (id === 'heart') return 'Heart container (' + v + ' total)';
    if (id === 'bombup') return 'Bomb upgrade (' + v + ' max)';
    if (id === 'triforce') return 'Triforce of level ' + v;
    if (id === 'map') return 'Map of level ' + v;
    if (id === 'compass') return 'Compass of level ' + v;
    const d = ITEM[id]; return d ? d.names[Math.min(v, d.names.length - 1)] : id;
  }
  function itemIcon(id, v) {
    if (id === 'heart') return I().svg('heart');
    if (id === 'bombup') return I().svg('bomb');
    if (id === 'triforce') return I().svg('triforce');
    if (id === 'map') return I().svg('map');
    if (id === 'compass') return I().svg('compass');
    const d = ITEM[id]; if (!d) return '';
    return I().svg(d.icon, d.tint && d.tint[Math.min(v, d.tint.length - 1)]);
  }
  function whereText(e) {
    let w = e.lv ? 'Level ' + e.lv + ', room ' + coord(e.room) : 'Overworld ' + coord(e.room);
    const k = e.cave !== undefined ? OwMap.kindOf(e.cave) : null;
    if (k && KINDS[k]) w += ' (' + KINDS[k][0].toLowerCase() + ')';
    return w;
  }
  function boxHtml(e) {
    return e ? '<span class="box got" title="' + itemName(e.id, e.v) + '">' + itemIcon(e.id, e.v) + '</span>'
      : '<span class="box"></span>';
  }

  function render() {
    if (!el.root || !dirty) return;
    dirty = false;
    const st = auto && link === 'live' ? auto.stats : null;
    const compact = isCompact();
    if (!compact && view === 'items') view = 'ow';
    el.root.classList.toggle('compact', compact);
    el.root.dataset.view = view;
    Object.entries(el.tabBtns).forEach(([id, b]) => b.setAttribute('aria-selected', String(id === view)));
    el.itemsPanel.hidden = compact && view !== 'items';
    el.ow.hidden = view !== 'ow'; el.dg.hidden = view !== 'dg'; el.log.hidden = view !== 'log';
    fit();

    const tri = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => lvValue(n, 'tri')).length;
    const found = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => entranceOf(n) !== null).length;
    el.stats.innerHTML =
      stat('heart', st ? st.hearts : '–', 'Heart containers') +
      stat('rupee', st ? st.rupees : '–', 'Rupees', { x: 'Y', z: 'W' }) +
      stat('key', st ? (st.magicKey ? '∞' : st.keys) : '–', 'Keys') +
      stat('bomb', st ? st.bombs + '/' + st.maxBombs : '–', 'Bombs') +
      stat('triforce', tri + '/8', 'Triforce pieces') +
      '<span class="stat found" title="Levels found">' + found + '/9 found</span>';

    // Dungeon item area
    for (let n = 1; n <= 9; n++) {
      const c = el.lvCells[n];
      const t = lvValue(n, 'tri'), m = lvValue(n, 'map'), k = lvValue(n, 'compass');
      const e = entranceOf(n);
      c.num.classList.toggle('known', e !== null);
      c.num.classList.toggle('here', !!(pos && pos.level === n));
      c.num.title = 'Level ' + n + (e === null ? ': not found yet' : ': entrance at ' + coord(e));
      c.tri.innerHTML = I().svg('triforce');
      c.tri.classList.toggle('have', !!t);
      c.tri.title = n < 9 ? (t ? 'Triforce ' + n + ' collected' : 'Triforce ' + n + ' missing') : (t ? 'Zelda rescued' : 'Level 9 not beaten');
      c.map.innerHTML = I().svg('map'); c.map.classList.toggle('have', !!m); c.map.title = 'Map ' + (m ? 'found' : 'missing');
      c.compass.innerHTML = I().svg('compass'); c.compass.classList.toggle('have', !!k); c.compass.title = 'Compass ' + (k ? 'found' : 'missing');
      const got = S.log.filter((x) => x.lv === n && x.id !== 'triforce' && x.id !== 'map' && x.id !== 'compass' && x.id !== 'bombup');
      const slots = Math.max(2, got.length);
      let html = '';
      for (let i = 0; i < slots; i++) html += boxHtml(got[i]);
      c.boxes.innerHTML = html;
    }

    // Other item area: what came from sword caves, letter cave, coast, armos
    const ows = S.log.filter((x) => x.lv === 0);
    const pick = (test) => ows.find(test);
    const caveItem = (dest) => pick((x) => x.cave === dest);
    const pairs = {
      wood: caveItem(0x10), white: caveItem(0x12), magic: caveItem(0x13), letter: caveItem(0x18),
      coast: pick((x) => x.cave === undefined && x.room === COAST_SCREEN),
      armos: pick((x) => x.cave === undefined && x.room !== COAST_SCREEN && x.id !== 'bombup'),
    };
    Object.entries(pairs).forEach(([id, e]) => {
      const b = el.oiaBoxes[id];
      b.className = 'box' + (e ? ' got' : '');
      b.innerHTML = e ? itemIcon(e.id, e.v) : '';
      b.title = e ? itemName(e.id, e.v) : 'Nothing yet';
    });
    // Take-any: a red heart per container taken, an X per other choice.
    const ta = ows.filter((x) => x.cave === 0x11);
    let taHtml = '';
    for (let i = 0; i < 4; i++) {
      const e = ta[i];
      taHtml += '<span class="ta' + (e ? (e.id === 'heart' ? ' heart' : ' other') : '') + '" title="' +
        (e ? (e.id === 'heart' ? 'Took a heart container' : 'Took ' + itemName(e.id, e.v)) : 'Take-any cave not used') + '">' +
        I().svg('heart') + '</span>';
    }
    el.takeAny.innerHTML = taHtml;

    // Item progress
    ITEMS.forEach((d) => {
      const v = itemValue(d.id), b = el.itemBtns[d.id];
      const shown = Math.max(v, 1);
      b.querySelector('.ico').innerHTML = I().svg(d.icon, d.tint && d.tint[Math.min(shown, d.tint.length - 1)]);
      b.classList.toggle('have', v > 0);
      b.classList.toggle('manual', S.manual[d.id] !== undefined && link === 'live');
      const name = d.names[Math.min(v, d.names.length - 1)];
      b.title = v ? name : name + ' (not found)';
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', v > 0 ? 'true' : 'false');
      let badge = '';
      if (d.badge && st && v) badge = d.badge(st);
      else if (d.id === 'potion' && v > 2) badge = '×' + v;
      else if (d.id === 'letter' && v === 2) badge = 'shown';
      b.querySelector('.badge').textContent = badge;
    });

    if (view === 'ow') renderOverworld();
    if (view === 'dg') renderDungeon();
    if (view === 'log') renderLog();
    el.foot.querySelector('.seed-label').textContent = label;
  }

  function stat(icon, val, title, tint) {
    return '<span class="stat" title="' + title + '"><span class="ico">' + I().svg(icon, tint) + '</span><b>' + val + '</b></span>';
  }

  // Tile label: level numerals as Z-Tracker draws them (yellow box while
  // active, green once its triforce is in), item icons for item caves and
  // shops, short glyphs for the rest.
  function labelHtml(s, k) {
    if (!k) return '';
    if (/^L\d$/.test(k)) {
      const n = +k[1];
      return '<b class="lvl' + (lvValue(n, 'tri') ? ' done' : '') + '">' + n + '</b>';
    }
    const dest = S.entered[s];
    if (k === 'shop' && ow && dest) {
      const w = ow.wares(dest).filter((id) => WARE[id]).slice(0, 2);
      if (w.length) return '<span class="ico2">' + w.map((id) => I().svg(WARE[id][0], WARE[id][1])).join('') + '</span>';
    }
    const ico = { wood: ['sword', { x: 'N', z: 'T' }], white: ['sword', null], magic: ['sword', { x: 'C', z: 'B' }],
      letter: ['letter', { x: 'G', z: 'G' }], takeany: ['heart', null], potion: ['potion', { x: 'R', z: 'O' }],
      armos: ['shield', null], bombup: ['bomb', null] }[k];
    if (ico) return '<span class="ico1">' + I().svg(ico[0], ico[1]) + '</span>';
    const glyph = { hint: '?', money: '$', gamble: '±', repair: '−', cave: '•', item: '!', nothing: '×' }[k];
    if (k === 'anyroad' && ow) {
      const i = ow.anyRoadRooms.indexOf(s);
      return '<b class="road">' + (i >= 0 ? i + 1 : '↯') + '</b>';
    }
    return glyph ? '<b class="gl gl-' + k + '">' + glyph + '</b>' : '';
  }

  function renderOverworld() {
    drawMap();
    el.map.classList.toggle('no-rom', !ow);
    const visited = new Set(S.visited);
    let left = 0, gettable = 0;
    for (let s = 0; s < 128; s++) {
      const cell = el.owCells[s];
      const k = kindAt(s), st = checkState(s);
      cell.classList.toggle('seen', visited.has(s));
      cell.classList.toggle('here', !!(pos && pos.level === 0 && pos.room === s));
      cell.querySelector('.lbl').innerHTML = labelHtml(s, k);
      const chk = cell.querySelector('.chk');
      let cls = 'chk';
      if (st === 'todo') {
        const spot = spotAt(s);
        const open = ram && (ram[A.WORLD + s] & 0x80);
        const can = open ? true : spot ? canOpen(spot.how) : null;
        left++; if (can) gettable++;
        if (!S.hideSpots) cls += ' todo ' + (can === null ? 'maybe' : can ? 'go' : 'no');
      } else if (st === 'return') cls += ' return';
      else if (st === 'done') cls += ' done';
      chk.className = cls;
      const t = tileText(s);
      cell.title = t;
      cell.setAttribute('aria-label', t);
    }
    el.owBar.querySelector('.ow-count').textContent = ow
      ? left + (left === 1 ? ' spot' : ' spots') + ' left · ' + gettable + ' gettable'
      : 'Map appears when a Zelda ROM is running';
    el.owBar.querySelector('input').checked = !S.hideSpots;
    el.owBar.querySelector('.ow-toggle').hidden = !ow;
  }

  function renderDungeon() {
    [...el.dgChips.children].forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i + 1 === dgLevel));
      b.classList.toggle('here', !!(pos && pos.level === i + 1));
    });
    const n = dgLevel, rooms = S.rooms[n] || [];
    el.dgMap.innerHTML = '';
    if (!rooms.length) {
      el.dgMap.append(h('p', { class: 'empty' }, 'Level ' + n + ' draws itself here as you explore it.'));
      el.dgInfo.textContent = entranceOf(n) !== null ? 'Entrance at ' + coord(entranceOf(n)) + '.' : '';
      return;
    }
    let c0 = 15, c1 = 0, r0 = 7, r1 = 0;
    rooms.forEach((x) => { c0 = Math.min(c0, x & 15); c1 = Math.max(c1, x & 15); r0 = Math.min(r0, x >> 4); r1 = Math.max(r1, x >> 4); });
    const cols = c1 - c0 + 1, rws = r1 - r0 + 1;
    const g = h('div', { class: 'dg-grid' });
    const gap = 3;
    const availW = el.dgMap.clientWidth || el.root.clientWidth;
    let room = Math.floor((availW - gap * (cols - 1)) / cols);
    if (isCompact()) {
      const availH = el.dg.clientHeight - el.dgChips.offsetHeight - 28;
      room = Math.min(room, Math.floor((availH - gap * (rws - 1)) / rws));
    }
    room = Math.max(8, Math.min(36, room));
    g.style.gridTemplateColumns = 'repeat(' + cols + ', ' + room + 'px)';
    g.style.setProperty('--room', room + 'px');
    const base = A.WORLD + 0x80 * (n < 7 ? 1 : 2);
    const set = new Set(rooms);
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const id = rr * 16 + cc;
        if (!set.has(id)) { g.append(h('span', { class: 'room void' })); continue; }
        const f = ram ? ram[base + id] : 0;
        const pk = S.log.filter((e) => e.lv === n && e.room === id);
        const here = pos && pos.level === n && pos.room === id;
        const t = 'Room ' + coord(id) + (pk.length ? '; got ' + pk.map((e) => itemName(e.id, e.v)).join(', ') : '');
        g.append(h('span', { class: 'room' + (here ? ' here' : '') + (f & 0x10 ? ' taken' : ''), title: t,
          html: pk.length ? itemIcon(pk[pk.length - 1].id, pk[pk.length - 1].v) : '' }));
      }
    }
    el.dgMap.append(g);
    const parts = [rooms.length + (rooms.length === 1 ? ' room' : ' rooms') + ' explored'];
    if (entranceOf(n) !== null) parts.push('entrance at ' + coord(entranceOf(n)));
    const got = S.log.filter((e) => e.lv === n);
    if (got.length) parts.push(got.length + ' found here');
    el.dgInfo.textContent = parts.join(', ') + '.';
  }

  function renderLog() {
    el.log.innerHTML = '';
    if (!S.log.length) {
      el.log.append(h('p', { class: 'empty' }, 'Items you pick up are listed here with where you found them.'));
      return;
    }
    const ul = h('ol', { class: 'log-list', reversed: '' });
    S.log.slice().reverse().forEach((e) => {
      ul.append(h('li', {}, h('span', { class: 'ico', html: itemIcon(e.id, e.v) }),
        h('span', { class: 'what' }, itemName(e.id, e.v)), h('span', { class: 'where' }, whereText(e))));
    });
    el.log.append(ul);
  }

  // ── public API ───────────────────────────────────────────────────────────
  let timer = null;
  window.Z1Tracker = {
    init(root) { build(root); if (!timer) timer = setInterval(tick, 250); },
    setSession(k, lbl) {
      key = 'z1ru:track:' + k; label = lbl || k; S = load(key);
      auto = null; needBaseline = true; lastOW = null; prevLevel = null; curSlot = null; liveDest = null;
      dirty = true; render();
    },
    // The ROM being played: draws the map and finds the entrances.
    setRom(bytes) {
      ow = bytes && window.OwMap ? OwMap.read(bytes) : null;
      mapInfo = ow ? 'drawn from the ROM file (not yet checked against the game)' : 'no map: not a readable Zelda ROM';
      if (ow) {
        const w = ow.where, hex = (n) => '$' + n.toString(16).toUpperCase();
        const moved = [];
        if (w.block !== 0x18400) moved.push('screens ' + hex(w.block));
        if (w.info !== 0x19300) moved.push('level info ' + hex(w.info));
        if (w.layouts !== 0x15418) moved.push('layouts ' + hex(w.layouts));
        if (w.heap0 !== 0x9BD8) moved.push('heap 0 ' + hex(w.heap0));
        mapTables = moved.length ? 'tables moved: ' + moved.join(', ') : 'tables at the usual places';
      }
      mapSecret = new Uint8Array(128); liveDest = null;
      mapDirty = true; dirty = true; render();
      return !!ow;
    },
    onLink(fn) { linkListeners.add(fn); fn(link); },
    get link() { return link; },
    get mapInfo() { return mapInfo + (mapTables ? '; ' + mapTables : ''); },
    _tick: tick, _state: () => S, _ow: () => ow,   // for tests
  };
})();
