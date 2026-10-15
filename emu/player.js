/*
 * NES player (from ALTTPR Snes9x's emu/player.js, adapted for the NES: two
 * face buttons, no shoulders). Runs the FCEUmm core (emu/fceumm.wasm) inside the page's
 * game box, with the on-screen controller and an in-game menu overlaid on
 * the picture, the way EmulatorJS's were.
 *
 * The rest of the app was written against EmulatorJS, so once a game is
 * running this publishes window.EJS_emulator with the parts of that API the
 * app uses: gameManager.getState/loadState (Resume), pause/play/paused
 * (leaving and coming back), volume/muted/setVolume and
 * Module.AL.currentCtx.gain (the app's volume fix and the MSU-1 player).
 * window.EJS_onGameStart is called the same way EmulatorJS called it.
 *
 *   EmuPlayer.boot('#game', file)   // a File (or { bytes, name })
 */
(function () {
  'use strict';
  var BASE = 'emu/';
  var SETTINGS_KEY = 'z1r-nes-player-settings';
  var DEFAULTS = {
    filter: 'xbrz6', aspect: '8:7', volume: 0.5, muted: false,
    touch: 'auto', opacity: 0.45, size: 1, haptics: true, slot: 1,
    keymap: null, padmap: null,
  };
  var LABELS = { UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', A: 'A', B: 'B', START: 'Start', SELECT: 'Select' };
  var ORDER = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'B', 'A', 'START', 'SELECT'];

  var cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
  function saveCfg() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch (e) {} }

  // ── storage: in-game saves (SRAM) and save-state slots, per game ────────
  var dbp = null;
  cfg.slot = Math.min(4, Math.max(1, cfg.slot | 0 || 1));
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('z1r-nes-emu', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  function kv(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('kv', mode), r = fn(t.objectStore('kv')), out;
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function kvGet(k) { return kv('readonly', function (s) { return s.get(k); }).catch(function () { return null; }); }
  function kvPut(k, v) { return kv('readwrite', function (s) { return s.put(v, k); }); }

  // ── styles ──────────────────────────────────────────────────────────────
  var CSS = [
    '.s9x { position: absolute; inset: 0; background: #000; overflow: hidden; user-select: none; -webkit-user-select: none; }',
    '.s9x canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }',
    '.s9x-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #8b95a3; font: 14px system-ui, sans-serif; pointer-events: none; }',
    '.s9x-toast { position: absolute; left: 50%; top: 44px; transform: translate(-50%, -6px); opacity: 0; z-index: 30;',
    '  background: rgba(22,27,34,.92); color: #e6e9ee; border: 1px solid #2a313c; padding: 5px 11px; border-radius: 8px;',
    '  font: 13px system-ui, sans-serif; pointer-events: none; transition: opacity .15s, transform .15s; white-space: nowrap; }',
    '.s9x-toast.show { opacity: 1; transform: translate(-50%, 0); }',
    /* top pill: pause / fast-forward / save state / load state / slot / settings */
    '.s9x-pill { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; gap: 4px;',
    '  background: rgba(13,17,23,.6); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 3px; transition: opacity .3s; }',
    '.s9x-pill button { all: unset; cursor: pointer; width: 34px; height: 28px; border-radius: 14px; display: flex; align-items: center;',
    '  justify-content: center; color: #e6e9ee; font: 600 14px system-ui, sans-serif; }',
    '.s9x-pill button:hover { background: rgba(255,255,255,.12); }',
    '.s9x-pill button.on { background: #1f6f3a; }',
    '.s9x-pill .sep { width: 1px; margin: 4px 1px; background: rgba(255,255,255,.18); }',
    '.s9x-pill [data-a=slot] { width: 30px; font-size: 12px; color: #aab3bf; }',
    '.s9x.idle .s9x-pill { opacity: 0; pointer-events: none; }',
    '.s9x.touch:not(.idle) .s9x-pill { opacity: .85; }',
    /* on-screen controller */
    '.s9x-touch { display: none; position: absolute; inset: 0; z-index: 10; pointer-events: none; --pad: 140px; touch-action: none; -webkit-touch-callout: none; }',
    '.s9x.touch .s9x-touch { display: block; }',
    '.s9x-touch .btn, .s9x-touch .dpad { position: absolute; pointer-events: auto; opacity: var(--op, .45); }',
    '.s9x-touch .btn { display: flex; align-items: center; justify-content: center; font: 700 14px system-ui, sans-serif; color: #fff;',
    '  border-radius: 50%; border: 2px solid rgba(255,255,255,.3); text-shadow: 0 1px 2px #000; box-sizing: border-box; }',
    '.s9x-touch .btn.down { opacity: .95; filter: brightness(1.35); transform: scale(.94); }',
    '.s9x-touch .dpad { left: max(8px, env(safe-area-inset-left)); bottom: 8px; width: var(--pad); height: var(--pad); border-radius: 50%; background: rgba(255,255,255,.07); }',
    '.s9x-touch .dpad::before, .s9x-touch .dpad::after { content: ""; position: absolute; background: #3a414c; border-radius: 7px; }',
    '.s9x-touch .dpad::before { left: 33.3%; top: 5%; width: 33.4%; height: 90%; }',
    '.s9x-touch .dpad::after { top: 33.3%; left: 5%; height: 33.4%; width: 90%; }',
    '.s9x-touch .dpad i { position: absolute; z-index: 1; width: 0; height: 0; border: 8px solid transparent; }',
    '.s9x-touch .dpad .u { left: calc(50% - 8px); top: 10%; border-bottom-color: #aab3bf; }',
    '.s9x-touch .dpad .d { left: calc(50% - 8px); bottom: 10%; border-top-color: #aab3bf; }',
    '.s9x-touch .dpad .l { top: calc(50% - 8px); left: 10%; border-right-color: #aab3bf; }',
    '.s9x-touch .dpad .r { top: calc(50% - 8px); right: 10%; border-left-color: #aab3bf; }',
    '.s9x-touch .dpad.d-up, .s9x-touch .dpad.d-down, .s9x-touch .dpad.d-left, .s9x-touch .dpad.d-right { opacity: .9; }',
    '.s9x-touch .dpad.d-up .u { border-bottom-color: #fff; } .s9x-touch .dpad.d-down .d { border-top-color: #fff; }',
    '.s9x-touch .dpad.d-left .l { border-right-color: #fff; } .s9x-touch .dpad.d-right .r { border-left-color: #fff; }',
    '.s9x-touch .face { position: absolute; right: max(8px, env(safe-area-inset-right)); bottom: 8px; width: var(--pad); height: var(--pad); pointer-events: none; }',
    '.s9x-touch .face .btn { width: 36%; height: 36%; font-size: calc(var(--pad) * .11); }',
    /* NES pad: B on the left, A on the right (a little higher, like the thumb arc) */
    '.s9x-touch .face .btn { width: 44%; height: 44%; font-size: calc(var(--pad) * .13); }',
    '.s9x-touch .face [data-btn=B] { left: 0; top: 42%; background: #c0392b; }',
    '.s9x-touch .face [data-btn=A] { right: 0; top: 18%; background: #c0392b; }',
    '.s9x-touch .face .combo { width: 18%; height: 30%; border: 0; background: transparent; opacity: 0; }',
    '.s9x-touch .face [data-btn="B,A"] { left: 41%; top: 36%; }',
    '.s9x-touch .sh { top: 6px; width: calc(var(--pad) * .5); height: calc(var(--pad) * .23); border-radius: 9px; background: #3a414c; }',
    '.s9x-touch .sh.l { left: max(8px, env(safe-area-inset-left)); } .s9x-touch .sh.r { right: max(8px, env(safe-area-inset-right)); }',
    '.s9x-touch .sm { bottom: 6px; width: calc(var(--pad) * .42); height: calc(var(--pad) * .17); border-radius: 99px; background: #3a414c;',
    '  font-size: calc(var(--pad) * .07); letter-spacing: .05em; }',
    '.s9x-touch .sm.sel { right: calc(50% + 4px); } .s9x-touch .sm.sta { left: calc(50% + 4px); }',
    /* controller beside the picture instead of over it (setTouchPlacement('outside')):
       upright, the picture on top and the controller under it, shoulder buttons and
       Select/Start in a row just below the picture; sideways, the picture in the
       middle with the D-pad on the left and the buttons on the right */
    '.s9x.out-port .s9x-touch .sh, .s9x.out-port .s9x-touch .sm { top: var(--sh-top); bottom: auto; }',
    '.s9x.out-port .s9x-touch .dpad, .s9x.out-port .s9x-touch .face { bottom: var(--ctl-b); }',
    '.s9x.out-land .s9x-touch .sm { bottom: auto; top: calc(14px + var(--pad) * .23); }',
    '.s9x.out-land .s9x-touch .sm.sel { left: max(8px, env(safe-area-inset-left)); right: auto; }',
    '.s9x.out-land .s9x-touch .sm.sta { right: max(8px, env(safe-area-inset-right)); left: auto; }',
    '.s9x.out-land .s9x-touch .dpad, .s9x.out-land .s9x-touch .face { bottom: 12px; }',
    /* menu */
    '.s9x-menu { position: absolute; inset: 0; z-index: 40; background: rgba(10,13,18,.94); color: #e6e9ee; overflow-y: auto;',
    '  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; user-select: none; }',
    '.s9x-menu[hidden] { display: none; }',
    '.s9x-menu .hd { position: sticky; top: 0; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #161b22; border-bottom: 1px solid #2a313c; }',
    '.s9x-menu .hd b { flex: 1; font-size: 15px; } .s9x-menu .hd b span { color: #5fbf6f; }',
    '.s9x-menu .bd { padding: 4px 12px 14px; max-width: 520px; margin: 0 auto; }',
    '.s9x-menu h4 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8b95a3; }',
    '.s9x-menu .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; }',
    '.s9x-menu .acts { display: flex; flex-wrap: wrap; gap: 6px; }',
    '.s9x-menu button, .s9x-menu select { background: #0d1117; color: #e6e9ee; border: 1px solid #2a313c; border-radius: 6px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }',
    '.s9x-menu button.primary { background: #1f6f3a; border-color: #2a8a4a; }',
    '.s9x-menu select, .s9x-menu input[type=range] { width: 55%; max-width: 240px; }',
    '.s9x-menu .hint { color: #8b95a3; font-size: 12px; margin: 4px 0; }',
    '.s9x-menu table { width: 100%; border-collapse: collapse; font-size: 13px; }',
    '.s9x-menu td { padding: 3px 0; } .s9x-menu td button { width: 100%; padding: 4px 6px; }',
    '.s9x-menu td:first-child { width: 22%; color: #8b95a3; } .s9x-menu td + td { padding-left: 6px; }',
    '.s9x-menu td button.wait { border-color: #e3b341; color: #e3b341; }',
  ].join('\n');

  var started = false, core = null, video = null, audio = null, input = null;
  var root, canvas, touchEl, menuEl, pill, toastEl, msgEl;
  var running = false, paused = false, ff = false, gameName = '', lastSram = null;
  // Add-ons (crowd/effects.js) plug in here without touching the loop:
  //   input(pad) -> pad   change the buttons the game sees this frame
  //   frame(core)         runs after every emulated frame
  //   menu {html(rerender), click(button, rerender), input(el)}  a section in the menu
  var hooks = { input: null, frame: null, menu: null };

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  // ── building the player ────────────────────────────────────────────────
  function build(container) {
    if (!document.getElementById('s9x-css')) { var st = el('style'); st.id = 's9x-css'; st.textContent = CSS; document.head.appendChild(st); }
    root = el('div', 's9x');
    canvas = el('canvas');
    msgEl = el('div', 's9x-msg', 'Starting the emulator…');
    toastEl = el('div', 's9x-toast');
    pill = el('div', 's9x-pill',
      '<button type="button" data-a="pause" title="Pause">❚❚</button>' +
      '<button type="button" data-a="ff" title="Fast-forward (hold `)">⏩</button>' +
      '<span class="sep"></span>' +
      '<button type="button" data-a="save" title="Save state (F5)">💾</button>' +
      '<button type="button" data-a="load" title="Load state (F8)">📂</button>' +
      '<button type="button" data-a="slot" title="Save-state slot (tap to change)"></button>' +
      '<span class="sep"></span>' +
      '<button type="button" data-a="menu" title="Emulator settings">⋯</button>');
    syncSlot();
    touchEl = el('div', 's9x-touch',
      '<div class="dpad" data-dpad><i class="u"></i><i class="d"></i><i class="l"></i><i class="r"></i></div>' +
      '<div class="btn sm sel" data-btn="SELECT">SELECT</div><div class="btn sm sta" data-btn="START">START</div>' +
      '<div class="face"><div class="btn" data-btn="B">B</div><div class="btn" data-btn="A">A</div>' +
      '<div class="btn combo" data-btn="B,A"></div></div>');
    menuEl = el('div', 's9x-menu');
    menuEl.hidden = true;
    [canvas, msgEl, touchEl, pill, toastEl, menuEl].forEach(function (c) { root.appendChild(c); });
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(root);

    pill.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var a = b.dataset.a;
      if (a === 'pause') setPaused(!paused);
      else if (a === 'ff') setFF(!ff);
      else if (a === 'save') saveState();
      else if (a === 'load') loadState();
      else if (a === 'menu') openMenu();
      else if (a === 'slot') { cfg.slot = cfg.slot % 4 + 1; saveCfg(); syncSlot(); toast('Slot ' + cfg.slot); }
    });
    // The pill stays out of the way: it shows when the picture is tapped (or the
    // mouse moves over it) and fades out again after a few seconds. Presses on
    // the on-screen controller don't bring it up. While paused it stays, so
    // there's always a way to resume.
    var idleT = null;
    function hideSoon(ms) {
      clearTimeout(idleT);
      idleT = setTimeout(function () { if (!paused) root.classList.add('idle'); else hideSoon(1000); }, ms);
    }
    function wakeUi(ms) { root.classList.remove('idle'); hideSoon(ms || 3000); }
    root.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') wakeUi(2500); });
    root.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.s9x-touch .btn, .s9x-touch .dpad')) return;
      wakeUi(e.target.closest && e.target.closest('.s9x-pill') ? 4000 : 3000);
    });
    root.classList.add('idle');
    // keep the mouse free (no pointer lock, no context menu on the picture)
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    new ResizeObserver(layoutTouch).observe(root);
  }

  // Controller size follows the game box (bigger box, bigger buttons).
  // 'overlay' (default): the controller sits over the picture.
  // 'outside': with the controller showing, the picture shrinks to leave it
  // room, below the picture when upright and on both sides when sideways.
  var placement = 'overlay';
  function setCanvasBox(x, y, w, h) {
    var st = canvas.style;
    if (x == null) { st.left = st.top = st.width = st.height = ''; return; }
    st.left = Math.round(x) + 'px'; st.top = Math.round(y) + 'px';
    st.width = Math.round(w) + 'px'; st.height = Math.round(h) + 'px';
  }
  function layoutTouch() {
    var w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    var size = cfg.size || 1, pad, op = cfg.opacity;
    var out = placement === 'outside' && root.classList.contains('touch');
    var port = out && h >= w * 0.9;
    root.classList.toggle('out-port', port);
    root.classList.toggle('out-land', out && !port);
    var ar = cfg.aspect === '4:3' ? 4 / 3 : 8 / 7;
    if (!out) {
      setCanvasBox(null);
      pad = Math.max(84, Math.min(w * 0.31, h * 0.42, 180)) * size;
    } else if (port) {
      // picture across the full width on top; the rest is the controller
      var want = Math.min(w * 0.40, 210) * size;      // the controller at full size
      var picH = Math.max(Math.min(w / ar, h - (want * 1.23 + 30)), h * 0.35);
      var zone = h - picH, row = 0;
      pad = Math.max(72, Math.min(w * 0.40, 210, (zone - 30) / 1.23)) * size;
      row = pad * 0.23;
      setCanvasBox(0, 0, w, picH);
      touchEl.style.setProperty('--sh-top', Math.round(picH + 8) + 'px');
      var rest = zone - row - 16;   // under the shoulder row
      touchEl.style.setProperty('--ctl-b', Math.max(8, Math.round((rest - pad) / 2)) + 'px');
      op = Math.max(op, 0.85);      // nothing to see through now
    } else {
      // picture in the middle at full height; controls in the side columns
      pad = Math.max(84, Math.min(h * 0.42, w * 0.22, 190)) * size;
      var picW = Math.max(Math.min(h * ar, w - 2 * (pad + 20)), w * 0.4);
      setCanvasBox((w - picW) / 2, 0, picW, h);
      op = Math.max(op, 0.85);
    }
    touchEl.style.setProperty('--pad', Math.round(pad) + 'px');
    touchEl.style.setProperty('--op', op);
    if (video) { video.dirty = true; try { video.fit(); } catch (e) {} }
  }
  function setTouchPlacement(m) {
    placement = m === 'outside' ? 'outside' : 'overlay';
    if (root) layoutTouch();
  }

  var coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
  var padUsed = false;    // a physical controller is in use: hide the on-screen one (auto mode)
  function applyTouch() {
    var touchy = coarse.matches || (navigator.maxTouchPoints > 0 && !window.matchMedia('(hover: hover)').matches);
    var show = cfg.touch === 'on' || (cfg.touch === 'auto' && touchy && !padUsed);
    root.classList.toggle('touch', !!show);
    input.haptics = !!cfg.haptics;
    layoutTouch();
  }

  function syncSlot() { var b = pill && pill.querySelector('[data-a=slot]'); if (b) b.textContent = 'S' + cfg.slot; }

  // ── menu (opened from the app's ⚙ → Emulator button) ────────────────────
  function keyName(code) {
    if (!code) return '—';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace(/Left$|Right$/, function (s) { return /^(Shift|Control|Alt|Meta)/.test(code) ? ' ' + s : s; });
  }
  function keyFor(btn) { return Object.keys(input.keymap).filter(function (k) { return input.keymap[k] === btn; }); }
  function padFor(btn) { return Object.keys(input.padmap).filter(function (k) { return input.padmap[k] === btn; }); }

  function openMenu() {
    var wasPaused = paused;
    if (!paused) setPaused(true);
    menuEl._resume = !wasPaused;
    renderMenu();
    menuEl.hidden = false;
  }
  function closeMenu() {
    input.capture = null;
    menuEl.hidden = true;
    if (menuEl._resume) setPaused(false);
  }
  function renderMenu() {
    var P = window.Video ? Video.PRESETS : {};
    var opts = function (list, cur) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };
    var rows = ORDER.map(function (b) {
      return '<tr><td>' + LABELS[b] + '</td><td><button type="button" data-map="key" data-b="' + b + '">' +
        (keyFor(b).map(keyName).join(' / ') || '—') + '</button></td><td><button type="button" data-map="pad" data-b="' + b + '">' +
        (padFor(b).map(function (i) { return 'Button ' + i; }).join(' / ') || '—') + '</button></td></tr>';
    }).join('');
    menuEl.innerHTML =
      '<div class="hd"><b>NES <span>emulator</span></b><button type="button" class="primary" data-a="close">Back to game</button></div>' +
      '<div class="bd">' +
      '<h4>Game</h4><div class="acts">' +
        '<button type="button" data-a="restart">Restart</button>' +
        (root.requestFullscreen ? '<button type="button" data-a="fs">Full screen</button>' : '') +
      '</div><p class="hint">Save and load states from the bar on the game screen (💾 / 📂, S1–S4 picks the slot). In-game saves are kept automatically for each seed. Keys: F5 save state, F8 load state, hold ` to fast-forward.</p>' +
      '<h4>Sound</h4><div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-s="volume" value="' + cfg.volume + '"></div>' +
      '<div class="row"><span>Mute</span><input type="checkbox" data-s="muted"' + (cfg.muted ? ' checked' : '') + '></div>' +
      '<h4>Graphics</h4>' +
      '<div class="row"><span>Filter</span><select data-s="filter">' + opts(Object.keys(P).map(function (k) { return [k, P[k].name]; }), cfg.filter) + '</select></div>' +
      '<div class="row"><span>Aspect ratio</span><select data-s="aspect">' + opts([['8:7', 'Pixel-perfect (8:7)'], ['4:3', 'TV (4:3)'], ['fill', 'Fill the box']], cfg.aspect) + '</select></div>' +
      '<p class="hint">6xBRZ runs on the graphics chip. If an older phone stutters, try 4xBRZ or Sharp pixels.</p>' +
      '<h4>On-screen controller</h4>' +
      '<div class="row"><span>Show</span><select data-s="touch">' + opts([['auto', 'Auto (touch screens)'], ['on', 'Always'], ['off', 'Never']], cfg.touch) + '</select></div>' +
      '<div class="row"><span>Opacity</span><input type="range" min="0.1" max="1" step="0.05" data-s="opacity" value="' + cfg.opacity + '"></div>' +
      '<div class="row"><span>Size</span><input type="range" min="0.7" max="1.4" step="0.05" data-s="size" value="' + cfg.size + '"></div>' +
      '<div class="row"><span>Vibrate on press (Android)</span><input type="checkbox" data-s="haptics"' + (cfg.haptics ? ' checked' : '') + '></div>' +
      '<h4>Controls</h4><p class="hint">Tap a box, then press the key or controller button for it (Esc cancels).</p>' +
      '<table><tr><td></td><td class="hint">Keyboard</td><td class="hint">Controller</td></tr>' + rows + '</table>' +
      '<div class="acts" style="margin-top:8px"><button type="button" data-a="resetmap">Reset controls</button></div>' +
      (input.padName ? '<p class="hint">Controller: ' + input.padName.replace(/</g, '&lt;') + '</p>' : '') +
      (hooks.menu ? hooks.menu.html(renderMenu) : '') +
      '<h4>Diagnostics</h4>' + diagnostics() +
      '</div>';
  }
  function bindMenu() {
    menuEl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var a = b.dataset.a;
      if (a === 'close') closeMenu();
      else if (a === 'restart') { if (confirm('Restart the game?')) { core.reset(); audio.clear(); menuEl._resume = true; closeMenu(); } }
      else if (a === 'fs') { closeMenu(); fullscreen(); }
      else if (a === 'resetmap') { input.keymap = Object.assign({}, EmuInput.DEFAULT_KEYS); input.padmap = Object.assign({}, EmuInput.DEFAULT_PAD); cfg.keymap = cfg.padmap = null; saveCfg(); renderMenu(); }
      else if (b.dataset.map) remap(b);
      else if (b.dataset.ext && hooks.menu) hooks.menu.click(b, renderMenu);
    });
    menuEl.addEventListener('input', function (e) {
      if (e.target.dataset.ext && hooks.menu && hooks.menu.input) { hooks.menu.input(e.target); return; }
      var s = e.target.dataset.s; if (!s) return;
      var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (s === 'volume' || s === 'opacity' || s === 'size') v = +v;
      cfg[s] = v; saveCfg();
      if (s === 'volume' || s === 'muted') { ejs.volume = cfg.volume; ejs.muted = cfg.muted; ejs.setVolume(cfg.volume); }
      else if (s === 'filter') applyFilter();
      else if (s === 'aspect') applyAspect();
      else applyTouch();
    });
  }
  function remap(btn) {
    var kind = btn.dataset.map, target = btn.dataset.b;
    menuEl.querySelectorAll('button.wait').forEach(function (x) { x.classList.remove('wait'); });
    btn.classList.add('wait'); btn.textContent = kind === 'key' ? 'Press a key…' : 'Press a button…';
    if (kind === 'pad') padPoll();
    input.capture = function (r) {
      input.capture = null;
      if (!r.cancel) {
        if (kind === 'key' && r.key) {
          Object.keys(input.keymap).forEach(function (k) { if (input.keymap[k] === target) delete input.keymap[k]; });
          input.keymap[r.key] = target; cfg.keymap = input.keymap;
        } else if (kind === 'pad' && r.pad != null) {
          Object.keys(input.padmap).forEach(function (k) { if (input.padmap[k] === target) delete input.padmap[k]; });
          input.padmap[r.pad] = target; cfg.padmap = input.padmap;
        }
        saveCfg();
      }
      renderMenu();
    };
  }
  // While paused the frame loop doesn't read controllers; poll for a remap.
  function padPoll() { if (!input.capture) return; input.gamepadMask(); requestAnimationFrame(padPoll); }

  function fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && p.catch) p.catch(function () {});
  }

  // ── graphics ────────────────────────────────────────────────────────────
  function applyAspect() {
    if (!video) return;
    video.aspect = cfg.aspect === '4:3' ? 4 / 3 : cfg.aspect === 'fill' ? 0 : 8 / 7;
    video.dirty = true;
    if (placement === 'outside') layoutTouch();   // the picture's box follows the shape
  }
  function applyFilter() {
    if (!video) return;
    video.setPreset(cfg.filter).catch(function (e) {
      console.warn('[emu] filter', e);
      toast('That filter isn’t supported here; using sharp pixels.');
      cfg.filter = 'nearest'; saveCfg(); video.setPreset('nearest');
    });
  }

  // ── saves ───────────────────────────────────────────────────────────────
  function sramKey() { return 'sram:' + gameName; }
  function flushSram() {
    if (!running || !core) return Promise.resolve();
    var s = core.sram();
    if (!s.length || !lastSram) return Promise.resolve();
    var changed = false;
    for (var i = 0; i < s.length; i++) if (s[i] !== lastSram[i]) { changed = true; break; }
    if (!changed) return Promise.resolve();
    lastSram = s.slice();
    return kvPut(sramKey(), lastSram).catch(function (e) { console.warn('[emu] sram', e); });
  }
  function saveState() {
    if (!running) return;
    var st = core.saveState();
    if (!st) { toast('Couldn’t save state'); return; }
    kvPut('state:' + gameName + ':' + cfg.slot, { at: Date.now(), data: st })
      .then(function () { toast('Saved to slot ' + cfg.slot); }, function () { toast('Couldn’t save state'); });
  }
  function loadState(done) {
    if (!running) return;
    kvGet('state:' + gameName + ':' + cfg.slot).then(function (r) {
      if (!r) { toast('Slot ' + cfg.slot + ' is empty'); if (done) done(false); return; }
      var ok = core.loadState(r.data);
      if (ok) { audio.clear(); toast('Loaded slot ' + cfg.slot); } else toast('That state didn’t load');
      if (done) done(ok);
    });
  }

  // ── pause / fast-forward ────────────────────────────────────────────────
  function setPaused(p) {
    if (!running) return;
    paused = !!p;
    var b = pill.querySelector('[data-a=pause]');
    b.textContent = paused ? '▶' : '❚❚'; b.classList.toggle('on', paused); b.title = paused ? 'Resume' : 'Pause';
    if (paused) { flushSram(); audio.clear(); }
    wake(!paused);
  }
  function setFF(on) { ff = !!on; pill.querySelector('[data-a=ff]').classList.toggle('on', ff); if (!ff) audio.clear(); }

  // keep the screen on while playing
  var lock = null;
  function wake(on) {
    if (!('wakeLock' in navigator)) return;
    if (on && !lock && !document.hidden) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {});
    else if (!on && lock) { lock.release().catch(function () {}); lock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) flushSram(); else if (running && !paused) wake(true);
  });
  window.addEventListener('pagehide', function () { flushSram(); });

  // ── frame loop ──────────────────────────────────────────────────────────
  // If the display refresh is within 1% of the SNES rate (~60.1 Hz), run
  // exactly one frame per refresh for perfectly smooth scrolling; the audio
  // absorbs the tiny speed difference. Otherwise (120 Hz screens, throttled
  // windows) pace frames with a time accumulator.
  var acc = 0, last = 0, ema = 0;
  // What happened, for the Diagnostics section of the menu.
  var stats = { frames: 0, draws: 0, glLost: 0, glRestored: 0, error: null, started: 0 };
  function stopWithError(where, e) {
    stats.error = where + ': ' + (e && (e.message || e.name) || e);
    console.error('[emu]', where, e);
    running = false;
    var m = el('div', 's9x-msg', '');
    m.style.pointerEvents = 'auto'; m.style.flexDirection = 'column'; m.style.gap = '10px'; m.style.padding = '16px'; m.style.textAlign = 'center';
    m.innerHTML = '<b style="color:#e5534b">The emulator stopped</b><span></span>' +
      '<button type="button" style="all:unset;cursor:pointer;padding:6px 14px;border-radius:6px;background:#1f6f3a;color:#fff">Reload</button>';
    m.querySelector('span').textContent = stats.error;
    m.querySelector('button').onclick = function () { location.reload(); };
    root.appendChild(m);
  }
  function tick(now) {
    requestAnimationFrame(tick);
    if (!video) return;
    try { video.fit(); } catch (e) {}
    var dt = last ? Math.min(now - last, 100) : 16.7; last = now;
    ema = ema ? ema * 0.95 + dt * 0.05 : dt;
    if (!running || paused) { try { video.draw(); } catch (e) {} return; }
    var frameMs = 1000 / core.fps, pad = input.read(), n = 0;
    if (hooks.input) { try { pad = hooks.input(pad) | 0; } catch (e) { console.warn('[emu] input hook', e); } }
    var vsync = !ff && Math.abs(ema - frameMs) / frameMs < 0.01;
    if (vsync) { n = 1; acc = 0; }
    else {
      acc += dt * (ff ? 4 : 1);
      n = Math.floor(acc / frameMs); acc -= n * frameMs;
      var max = ff ? 8 : 3;
      if (n > max) { n = max; acc = 0; }
    }
    try {
      for (var i = 0; i < n; i++) {
        core.runFrame(pad, 0);
        stats.frames++;
        if (hooks.frame) { try { hooks.frame(core); } catch (e) { console.warn('[emu] frame hook', e); } }
        var a = core.audio();
        if (!ff) { try { audio.push(a); } catch (e) {} }
      }
    } catch (e) { stopWithError('Emulator', e); return; }
    try {
      if (n) video.upload(core.frame());
      video.draw();
      stats.draws++;
    } catch (e) {
      // A graphics error shouldn't stop the game: drop to the plainest filter.
      if (!stats.gfxErr) { stats.gfxErr = String(e && e.message || e); console.warn('[emu] video', e); }
      if (cfg.filter !== 'nearest') { cfg.filter = 'nearest'; applyFilter(); }
    }
  }
  // iOS can take the graphics context away under memory pressure (e.g. right
  // after Kara's generator ran in the browser); the picture then goes black.
  // Ask for it back and rebuild the renderer when it returns.
  function watchGl() {
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stats.glLost++; });
    canvas.addEventListener('webglcontextrestored', function () {
      stats.glRestored++;
      try { video = new Video(canvas); applyAspect(); applyFilter(); if (running) video.upload(core.frame()); }
      catch (e) { stats.gfxErr = String(e && e.message || e); }
    });
  }
  function diagnostics() {
    var gl = video && video.gl, f = core && core.loaded ? core.frame() : null, lit = 0;
    if (f) { for (var i = 0; i < f.data.length; i += 37) if (f.data[i]) lit++; lit = Math.round(lit * 3700 / f.data.length); }
    var info = [
      ['Game', gameName],
      ['ROM', core && core.loaded ? (core.rom().length / 1048576).toFixed(2) + ' MB' : 'not loaded'],
      ['Running', running ? (paused ? 'paused' : 'yes') : 'no'],
      ['Frames run', stats.frames + ' (' + Math.round(stats.frames / Math.max(1, (performance.now() - stats.started) / 1000)) + '/s)'],
      ['Picture', f ? f.w + '×' + f.h + ', ' + lit + '% lit' : '—'],
      ['Filter', (video && video.presetId) || cfg.filter],
      ['Graphics', gl ? (gl.isContextLost() ? 'LOST' : 'ok') + ', lost ' + stats.glLost + '×, restored ' + stats.glRestored + '×' : 'none'],
      ['Audio', audio && audio.ctx ? audio.ctx.state + ' @ ' + audio.ctx.sampleRate : 'not started'],
    ];
    if (stats.error) info.push(['Error', stats.error]);
    if (stats.gfxErr) info.push(['Video error', stats.gfxErr]);
    return info.map(function (r) { return '<div class="row"><span class="hint">' + r[0] + '</span><span style="text-align:right;word-break:break-word">' +
      String(r[1]).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span></div>'; }).join('');
  }
  // A hidden page gets no animation frames, but the app expects the game to
  // keep running when a desktop window is merely covered by tracker windows;
  // browsers still give hidden pages ~1 timer a second, so nothing to do there.

  // ── the EmulatorJS-shaped object the rest of the app uses ───────────────
  var ejs = {
    gameManager: {
      getState: function () { return core.saveState(); },
      loadState: function (bytes) { if (!core.loadState(bytes)) throw new Error('state did not load'); audio.clear(); },
      restart: function () { core.reset(); audio.clear(); },
    },
    get paused() { return paused; },
    pause: function () { setPaused(true); },
    play: function () { setPaused(false); },
    volume: cfg.volume,
    muted: cfg.muted,
    setVolume: function (v) { this.volume = v; cfg.volume = v; cfg.muted = this.muted; saveCfg(); audio.setMuted(this.muted); audio.setVolume(v); },
    Module: {
      AL: {
        get currentCtx() { return audio && audio.ctx ? { gain: audio.gain, sources: [], audioCtx: audio.ctx } : null; },
      },
    },
    enableMouseLock: false,
    nes: true,
    get core() { return core; },
    saveState: saveState, loadState: loadState, openMenu: openMenu,
  };

  // ── boot ────────────────────────────────────────────────────────────────
  function boot(container, file) {
    if (started) return Promise.reject(new Error('already started'));
    started = true;
    if (typeof container === 'string') container = document.querySelector(container);
    build(container);
    var name = file.name || 'game.sfc';
    gameName = name.replace(/\.[^.]+$/, '');
    // A File/Blob is read with arrayBuffer(). (Not by testing for .bytes:
    // Safari 18+ and new Chrome give every Blob a bytes() method.)
    var bytesP = (typeof Blob !== 'undefined' && file instanceof Blob) || typeof file.arrayBuffer === 'function'
      ? file.arrayBuffer().then(function (b) { return new Uint8Array(b); })
      : Promise.resolve(new Uint8Array(file.bytes));

    watchGl();
    try { video = new Video(canvas); } catch (e) {
      msgEl.textContent = 'This browser has no WebGL2, which the emulator needs. Try an up-to-date Safari, Chrome or Firefox.';
      return Promise.reject(e);
    }
    audio = new EmuAudio();
    input = new EmuInput();
    if (cfg.keymap) input.keymap = Object.assign({}, cfg.keymap);
    if (cfg.padmap) input.padmap = Object.assign({}, cfg.padmap);
    input.bindTouch(touchEl);
    input.enabled = function () { return menuEl.hidden; };
    input.onActivity = function () { audio.unlock(); };
    input.onPadPress = function () { if (!padUsed) { padUsed = true; applyTouch(); } };
    input.hotkeys = {
      F5: function (d) { if (d) saveState(); },
      F8: function (d) { if (d) loadState(); },
      Backquote: function (d) { setFF(d); },
    };
    // Touching the screen again brings the on-screen controller back.
    root.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch' && padUsed) { padUsed = false; applyTouch(); } }, true);
    ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { document.addEventListener(t, function () { audio.unlock(); }, true); });
    if (coarse.addEventListener) coarse.addEventListener('change', applyTouch);
    bindMenu();
    applyTouch(); applyAspect(); applyFilter();
    audio.volume = cfg.volume; audio.muted = cfg.muted;
    requestAnimationFrame(tick);

    return Promise.all([EmuCore.create(BASE + 'fceumm.wasm'), bytesP]).then(function (r) {
      core = r[0];
      if (!r[1] || r[1].length < 0x4010) throw new Error('the ROM for "' + name + '" was empty (' + (r[1] ? r[1].length : 0) + ' bytes).');
      if (!core.load(r[1])) throw new Error('The emulator could not load "' + name + '".');
      audio.setRate(core.sampleRate);
      return kvGet(sramKey());
    }).then(function (saved) {
      var s = core.sram();
      if (saved && saved.length === s.length) s.set(saved);
      lastSram = core.sram().slice();
      setInterval(flushSram, 3000);
      msgEl.remove();
      running = true;
      stats.started = performance.now();
      window.EJS_emulator = ejs;
      setPaused(false);
      try { document.dispatchEvent(new Event('s9x-ready')); } catch (e) {}
      if (typeof window.EJS_onGameStart === 'function') { try { window.EJS_onGameStart(); } catch (e) { console.error(e); } }
      return ejs;
    }).catch(function (e) {
      msgEl.textContent = 'The emulator failed to start: ' + (e && e.message || e);
      throw e;
    });
  }

  window.EmuPlayer = {
    boot: boot, hooks: hooks, setTouchPlacement: setTouchPlacement,
    get emulator() { return running ? ejs : null; },
    get core() { return running ? core : null; },
    get paused() { return paused; },
    toast: function (msg) { if (toastEl) toast(msg); },
    openMenu: function () { if (running) openMenu(); },
    get ready() { return running; },
  };
})();
