/*
 * tracker.js — Zelda 1 tracker with autotracking from NES RAM.
 *
 * Reads (aldonunez's disassembly labels, as used by ZORA's inventory module):
 *   $0010 CurLevel (0 overworld, 1–9)   $0012 GameMode (5 = playing)
 *   $0016 CurSaveSlot                   $00EB RoomId (screen / dungeon room)
 *   $0657… inventory (see ITEMS)        $066F HeartValues (containers-1 in high nibble)
 *   $0671 InvTriforce (bit per level)   $0667/$0668 compass/map bits, $0669/$066A level 9
 *   $067F WorldFlags: 128 overworld bytes, then levels 1–6, then levels 7–9
 *        bit $80 secret found, $20 room visited (dungeons), $10 item taken
 *
 * Everything also works by hand: tap items to cycle them, tap a screen on the
 * overworld to label it. Autotracking wins whenever the game's value changes.
 */
(function () {
  'use strict';

  const I = () => window.Z1Icons;
  const A = { LEVEL: 0x10, MODE: 0x12, SLOT: 0x16, ROOM: 0xEB, BOMBS: 0x658, MAXBOMBS: 0x67C,
    COMPASS: 0x667, MAP: 0x668, COMPASS9: 0x669, MAP9: 0x66A, RUPEES: 0x66D, KEYS: 0x66E,
    HEARTS: 0x66F, TRIFORCE: 0x671, MAGICKEY: 0x664, WORLD: 0x67F };
  const PLAY = 5, WIN = 0x13;
  const LOADED_MODES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 0xA, 0xB, 0xC, 0x10, 0x11, 0x12, 0x13]);

  // id, label per level, RAM read, manual max, icon + tint per level.
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

  // Overworld labels. code → [short tag, name, group]
  const MARKS = [
    ['L1', 'L1', 'Level 1', 'lv'], ['L2', 'L2', 'Level 2', 'lv'], ['L3', 'L3', 'Level 3', 'lv'],
    ['L4', 'L4', 'Level 4', 'lv'], ['L5', 'L5', 'Level 5', 'lv'], ['L6', 'L6', 'Level 6', 'lv'],
    ['L7', 'L7', 'Level 7', 'lv'], ['L8', 'L8', 'Level 8', 'lv'], ['L9', 'L9', 'Level 9', 'lv'],
    ['wood', 'Wd', 'Wooden sword cave', 'cave'], ['white', 'Wh', 'White sword cave', 'cave'],
    ['magic', 'Mg', 'Magical sword cave', 'cave'], ['letter', 'Lt', 'Letter cave', 'cave'],
    ['takeany', 'TA', 'Take any', 'cave'], ['shop', 'Sh', 'Shop', 'cave'], ['potion', 'Pt', 'Potion shop', 'cave'],
    ['hint', 'Ht', 'Hint', 'cave'], ['money', '$', 'Secret money', 'cave'], ['gamble', 'Gm', 'Money game', 'cave'],
    ['repair', 'Rp', 'Door repair', 'cave'], ['bombup', 'B+', 'Bomb upgrade', 'cave'],
    ['item', 'It', 'Item here', 'other'], ['armos', 'Ar', 'Armos item', 'other'],
    ['nothing', '×', 'Nothing here', 'other'],
  ];
  const MARK = Object.fromEntries(MARKS.map((m) => [m[0], m]));

  const coord = (s) => 'ABCDEFGH'[(s >> 4) & 7] + ((s & 15) + 1);

  // ── state ────────────────────────────────────────────────────────────────
  const blank = () => ({ v: 1, manual: {}, lvManual: {}, entrance: {}, entranceManual: {}, marks: {},
    visited: [], rooms: {}, log: [] });
  let S = blank();
  let key = 'z1ru:track:manual';
  let label = 'No seed';
  let auto = null;            // last auto values {items:{}, lv:{}, stats}
  let ram = null;             // last RAM view (for flags)
  let pos = null;             // {level, room}
  let lastOW = null, prevLevel = null, curSlot = null, needBaseline = true;
  let link = 'off';           // off | waiting | live
  let view = 'ow', dgLevel = 1, dgPinned = false;
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

  function logPickup(id, v, where) {
    S.log.push({ id, v, lv: where.level, room: where.room, t: Date.now() });
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
    if (slot !== curSlot) { needBaseline = true; curSlot = slot; lastOW = null; prevLevel = null; }
    const where = { level: level <= 9 ? level : 0, room };

    if (!needBaseline && auto) {
      // Pickups: values that went up since the last sample.
      ITEMS.forEach((d) => {
        const a = now.items[d.id], b = auto.items[d.id];
        if (a !== b) { delete S.manual[d.id]; dirty = true; }
        if (a > b && d.id !== 'bombs' && !(d.id === 'letter' && a === 2)) logPickup(d.id, a, where);
      });
      if (now.hearts > auto.hearts) logPickup('heart', now.hearts, where);
      if (now.maxBombs > auto.maxBombs) logPickup('bombup', now.maxBombs, where);
      for (let n = 1; n <= 9; n++) {
        ['tri', 'map', 'compass'].forEach((f) => {
          if (now.lv[n][f] !== auto.lv[n][f]) {
            if (S.lvManual[n]) delete S.lvManual[n][f];
            if (now.lv[n][f] > auto.lv[n][f] && !(n === 9 && f === 'tri')) logPickup(f === 'tri' ? 'triforce' : f, n, where);
            dirty = true;
          }
        });
      }
      if (JSON.stringify(now.stats) !== JSON.stringify(auto.stats)) dirty = true;
    }
    needBaseline = false;
    auto = now;

    // Where Link is: explored screens, dungeon rooms, and level entrances.
    if (mode === PLAY && level <= 9) {
      if (level === 0) {
        if (lastOW !== room) dirty = true;
        lastOW = room;
        if (S.visited.indexOf(room) < 0) { S.visited.push(room); dirty = true; }
      } else {
        const rooms = S.rooms[level] || (S.rooms[level] = []);
        if (rooms.indexOf(room) < 0) {
          // A room belongs to one level; drop it from any other (shared grids).
          Object.keys(S.rooms).forEach((k) => {
            const sameGrid = (k < 7) === (level < 7);
            if (+k !== level && sameGrid) S.rooms[k] = S.rooms[k].filter((x) => x !== room);
          });
          rooms.push(room); dirty = true;
        }
      }
      if (prevLevel === 0 && level >= 1 && lastOW !== null && !S.entranceManual[level]) {
        if (S.entrance[level] !== lastOW) { S.entrance[level] = lastOW; dirty = true; }
      }
      prevLevel = level;
    }
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

  // ── display values (auto, unless overridden by hand) ─────────────────────
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
  function markAt(s) {
    if (S.marks[s]) return S.marks[s];
    for (let n = 1; n <= 9; n++) if (entranceOf(n) === s) return 'L' + n;
    return null;
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
    el.items = h('div', { class: 't-items', role: 'group', 'aria-label': 'Items' });
    el.itemBtns = {};
    ITEMS.forEach((d) => {
      const b = h('button', { class: 'item', type: 'button', onclick: () => cycleItem(d.id, 1),
        oncontextmenu: (e) => { e.preventDefault(); cycleItem(d.id, -1); } },
        h('span', { class: 'ico' }), h('span', { class: 'badge' }));
      el.itemBtns[d.id] = b;
      el.items.append(b);
    });

    el.levels = h('div', { class: 't-levels', role: 'group', 'aria-label': 'Levels' });
    el.lvCells = {};
    for (let n = 1; n <= 9; n++) {
      const c = {
        num: h('button', { class: 'lv-num', type: 'button', title: 'Show level ' + n + ' map', onclick: () => showLevel(n) }, String(n)),
        tri: h('button', { class: 'lv-tri', type: 'button', onclick: () => toggleLv(n, 'tri') }),
        map: h('button', { class: 'lv-mini', type: 'button', onclick: () => toggleLv(n, 'map') }),
        compass: h('button', { class: 'lv-mini', type: 'button', onclick: () => toggleLv(n, 'compass') }),
        loc: h('span', { class: 'lv-loc' }),
      };
      el.lvCells[n] = c;
      el.levels.append(h('div', { class: 'lv' }, c.num, c.tri, h('span', { class: 'lv-mc' }, c.map, c.compass), c.loc));
    }

    el.tabs = h('div', { class: 't-tabs', role: 'tablist' });
    el.tabBtns = {};
    [['ow', 'Overworld'], ['dg', 'Dungeons'], ['log', 'Pickups']].forEach(([id, txt]) => {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => { view = id; dirty = true; render(); } }, txt);
      el.tabBtns[id] = b; el.tabs.append(b);
    });

    // Overworld grid
    el.ow = h('div', { class: 't-view ow' });
    const grid = h('div', { class: 'ow-grid', role: 'grid', 'aria-label': 'Overworld screens' });
    const colHead = h('div', { class: 'ow-cols', 'aria-hidden': 'true' });
    for (let c = 0; c < 16; c++) colHead.append(h('span', {}, String(c + 1)));
    el.owCells = [];
    for (let s = 0; s < 128; s++) {
      if ((s & 15) === 0) grid.append(h('span', { class: 'ow-row', 'aria-hidden': 'true' }, 'ABCDEFGH'[s >> 4]));
      const cell = h('button', { class: 'ow-cell', type: 'button', 'aria-label': 'Screen ' + coord(s),
        onclick: (e) => openPicker(s, e.currentTarget) }, h('span', { class: 'tag' }), h('span', { class: 'pk' }));
      el.owCells.push(cell); grid.append(cell);
    }
    el.ow.append(colHead, grid,
      h('p', { class: 'hint' }, 'Tap a screen to label it. Screens fill in as you walk them; level entrances mark themselves.'));

    // Dungeons
    el.dg = h('div', { class: 't-view dg' });
    el.dgChips = h('div', { class: 'dg-chips' });
    for (let n = 1; n <= 9; n++) el.dgChips.append(h('button', { type: 'button', onclick: () => showLevel(n) }, 'Level ' + n));
    el.dgMap = h('div', { class: 'dg-map' });
    el.dgInfo = h('p', { class: 'hint' });
    el.dg.append(el.dgChips, el.dgMap, el.dgInfo);

    // Log
    el.log = h('div', { class: 't-view log' });

    el.foot = h('div', { class: 't-foot' },
      h('span', { class: 'seed-label' }),
      h('button', { type: 'button', class: 'linkish', onclick: resetTracker }, 'Reset tracker'));

    el.picker = h('div', { class: 'picker', hidden: '' });
    root.append(el.stats, el.items, el.levels, el.tabs, el.ow, el.dg, el.log, el.foot, el.picker);
    document.addEventListener('pointerdown', (e) => {
      if (!el.picker.hidden && !el.picker.contains(e.target) && !e.target.closest('.ow-cell')) closePicker();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
    dirty = true; render();
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

  function openPicker(s, anchor) {
    const p = el.picker;
    p.innerHTML = '';
    const cur = markAt(s);
    p.append(h('div', { class: 'pk-head' }, 'Screen ' + coord(s)));
    ['lv', 'cave', 'other'].forEach((g) => {
      const row = h('div', { class: 'pk-row pk-' + g });
      MARKS.filter((m) => m[3] === g).forEach((m) => {
        row.append(h('button', { type: 'button', class: cur === m[0] ? 'on' : '', title: m[2],
          onclick: () => { setMark(s, m[0]); closePicker(); } }, g === 'lv' ? m[1] : m[2]));
      });
      p.append(row);
    });
    p.append(h('button', { type: 'button', class: 'pk-clear', onclick: () => { setMark(s, null); closePicker(); } }, 'Clear label'));
    p.hidden = false;
    // Position under/over the tapped cell, inside the viewport.
    const r = anchor.getBoundingClientRect(), pw = Math.min(320, window.innerWidth - 16);
    p.style.width = pw + 'px';
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
    p.style.left = left + 'px';
    const ph = p.offsetHeight;
    const below = r.bottom + 6 + ph < window.innerHeight;
    p.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - ph - 6)) + 'px';
    const first = p.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function closePicker() { if (el.picker) el.picker.hidden = true; }

  function setMark(s, code) {
    // Clearing or relabelling a level entrance screen.
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
    return e.lv ? 'Level ' + e.lv + ', room ' + coord(e.room) : 'Overworld ' + coord(e.room);
  }

  function render() {
    if (!el.root || !dirty) return;
    dirty = false;
    const st = auto && link === 'live' ? auto.stats : null;

    // stats line
    const tri = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => lvValue(n, 'tri')).length;
    el.stats.innerHTML =
      stat('heart', st ? st.hearts : '–', 'Heart containers') +
      stat('rupee', st ? st.rupees : '–', 'Rupees', { x: 'Y', z: 'W' }) +
      stat('key', st ? (st.magicKey ? '∞' : st.keys) : '–', 'Keys') +
      stat('bomb', st ? st.bombs + '/' + st.maxBombs : '–', 'Bombs') +
      stat('triforce', tri + '/8', 'Triforce pieces');

    // items
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

    // levels
    for (let n = 1; n <= 9; n++) {
      const c = el.lvCells[n];
      const t = lvValue(n, 'tri'), m = lvValue(n, 'map'), k = lvValue(n, 'compass');
      c.tri.innerHTML = I().svg('triforce');
      c.tri.classList.toggle('have', !!t);
      c.tri.title = n < 9 ? (t ? 'Triforce ' + n + ' collected' : 'Triforce ' + n + ' missing') : (t ? 'Zelda rescued' : 'Level 9 not beaten');
      c.map.innerHTML = I().svg('map'); c.map.classList.toggle('have', !!m); c.map.title = 'Map ' + (m ? 'found' : 'missing');
      c.compass.innerHTML = I().svg('compass'); c.compass.classList.toggle('have', !!k); c.compass.title = 'Compass ' + (k ? 'found' : 'missing');
      const e = entranceOf(n);
      c.loc.textContent = e === null ? '·' : coord(e);
      c.loc.title = e === null ? 'Entrance not found yet' : 'Entrance at ' + coord(e);
      c.num.classList.toggle('here', !!(pos && pos.level === n));
      c.num.closest('.lv').classList.toggle('done', !!t);
    }

    // tabs
    Object.entries(el.tabBtns).forEach(([id, b]) => b.setAttribute('aria-selected', String(id === view)));
    el.ow.hidden = view !== 'ow'; el.dg.hidden = view !== 'dg'; el.log.hidden = view !== 'log';

    if (view === 'ow') renderOverworld();
    if (view === 'dg') renderDungeon();
    if (view === 'log') renderLog();

    el.foot.querySelector('.seed-label').textContent = label;
  }

  function stat(icon, val, title, tint) {
    return '<span class="stat" title="' + title + '"><span class="ico">' + I().svg(icon, tint) + '</span><b>' + val + '</b></span>';
  }

  function pickupsAt(lv, room) { return S.log.filter((e) => e.lv === lv && e.room === room); }

  function renderOverworld() {
    const visited = new Set(S.visited);
    for (let s = 0; s < 128; s++) {
      const cell = el.owCells[s];
      const flags = ram ? ram[A.WORLD + s] : 0;
      cell.classList.toggle('seen', visited.has(s));
      cell.classList.toggle('secret', !!(flags & 0x80));
      cell.classList.toggle('taken', !!(flags & 0x10));
      cell.classList.toggle('here', !!(pos && pos.level === 0 && pos.room === s));
      const m = markAt(s);
      const tag = cell.querySelector('.tag');
      tag.textContent = m ? MARK[m][1] : '';
      cell.dataset.kind = m ? MARK[m][3] : '';
      const pk = pickupsAt(0, s);
      cell.querySelector('.pk').innerHTML = pk.length ? itemIcon(pk[pk.length - 1].id, pk[pk.length - 1].v) : '';
      let t = 'Screen ' + coord(s);
      if (m) t += ': ' + MARK[m][2];
      if (pk.length) t += ' — got ' + pk.map((e) => itemName(e.id, e.v)).join(', ');
      cell.title = t;
      cell.setAttribute('aria-label', t);
    }
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
    g.style.gridTemplateColumns = 'repeat(' + cols + ', var(--room))';
    g.style.setProperty('--cols', cols);
    const base = A.WORLD + 0x80 * (n < 7 ? 1 : 2);
    const set = new Set(rooms);
    let taken = 0;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const id = rr * 16 + cc;
        if (!set.has(id)) { g.append(h('span', { class: 'room void' })); continue; }
        const f = ram ? ram[base + id] : 0;
        if (f & 0x10) taken++;
        const pk = pickupsAt(n, id);
        const here = pos && pos.level === n && pos.room === id;
        const t = 'Room ' + coord(id) + (pk.length ? ' — got ' + pk.map((e) => itemName(e.id, e.v)).join(', ') : '');
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
    void rws; void taken;
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
      auto = null; needBaseline = true; lastOW = null; prevLevel = null; curSlot = null;
      dirty = true; render();
    },
    onLink(fn) { linkListeners.add(fn); fn(link); },
    get link() { return link; },
    _tick: tick, _state: () => S,   // for tests
  };
})();
