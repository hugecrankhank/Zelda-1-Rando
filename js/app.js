/*
 * app.js — wires the page together: the emulator (emu/, FCEUmm) boot, ROM
 * loading, the tracker session, controller and audio fixes, and the PWA bits.
 */
(function () {
  'use strict';
    const $ = (id) => document.getElementById(id);

  $('brand-mark').innerHTML = Z1Icons.svg('triforce');
  $('tri-mark').innerHTML = Z1Icons.svg('triforce');

  Z1Diag.init();

  // ── tracker ───────────────────────────────────────────────────────────────
  Z1Tracker.init($('tracker'));
  Z1Tracker.setSession('manual', 'No game running: tap items to track by hand.');
  Z1Tracker.onLink((s) => {
    const el = $('link-status');
    el.className = 'pill' + (s === 'live' ? ' on' : s === 'waiting' ? ' wait' : '');
    const b = window.NesBridge && NesBridge.status();
    
    el.querySelector('span').textContent =
      s === 'live' ? 'Autotracking' : s === 'waiting' ? (window.EJS_emulator ? 'Waiting for a save file' : 'Starting…') : 'No game running';
  });

  // ── seed dialog ──────────────────────────────────────────────────────────
  Z1Seed.init({ onPlay: (entry) => play(entry) });
  $('new-seed').addEventListener('click', Z1Seed.open);
  $('ph-new').addEventListener('click', Z1Seed.open);

  // A stored seed you were playing: offer to continue it.
  let stored = null;
  Z1Store.get('current').then((c) => {
    if (!c || !c.bytes) return;
    stored = { rom: new Uint8Array(c.bytes), name: c.name, meta: c.meta || {} };
    const b = $('ph-continue');
    b.textContent = 'Continue ' + describe(stored);
    b.hidden = false;
    // A reload asked for by "play a different game" boots straight in.
    if (sessionStorage.getItem('z1ru:autoplay')) { sessionStorage.removeItem('z1ru:autoplay'); play(stored); }
  });
  $('ph-continue').addEventListener('click', () => stored && play(stored, { resume: true }));

  function describe(entry) {
    const m = entry.meta || {};
    return m.seed ? 'seed ' + m.seed : entry.name.replace(/\.[^.]+$/, '');
  }

  // ── playing a ROM ────────────────────────────────────────────────────────
  $('rom-input').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) { alert('That is a .zip file. Unzip it and pick the .nes inside.'); return; }
    const ines = bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A;
    if (!ines && !confirm('"' + f.name + '" doesn\'t look like an NES ROM (.nes). Play it anyway?')) return;
    const entry = { rom: bytes, name: f.name, meta: { source: 'file' } };
    await Z1Store.set('current', { bytes: bytes.buffer.slice(0), name: f.name, meta: entry.meta }).catch(() => {});
    play(entry);
  });

  let booted = false;
  async function play(entry, opts) {
    if (booted) {
      // The player runs one game per page load; the seed is already stored, so
      // reload and start it straight away.
      if (!confirm('Switch to ' + describe(entry) + '? The current game closes; its save stays in this browser.')) return;
      await Z1Store.set('current', { bytes: entry.rom.buffer.slice(0), name: entry.name, meta: entry.meta }).catch(() => {});
      sessionStorage.setItem('z1ru:autoplay', '1');
      location.reload();
      return;
    }
    booted = true;
    const id = Z1Hash(entry.rom);
    const label = entry.meta && entry.meta.seed
      ? 'Seed ' + entry.meta.seed + ' (ZORA ' + (entry.meta.version || '') + ')'
      : entry.name;
    Z1Tracker.setSession(id, label);
    Z1Tracker.setRom(entry.rom);
    Z1Diag.start(label);
    document.title = describe(entry) + ' - Z1R Unified';
    boot(new File([entry.rom], 'Z1R-' + id + '.nes'), 'Z1R-' + id, id, !!(opts && opts.resume));
  }

  // The NES runs on our own build of FCEUmm (emu/), the same setup as
  // ALTTPR Snes9x: no EmulatorJS. The player publishes window.EJS_emulator
  // (getState/loadState, pause, volume) and calls EJS_onGameStart.
  const COMPACT_Q = window.matchMedia('(max-width: 900px) and (orientation: portrait), (orientation: landscape) and (max-height: 560px)');
  function placeControls() {
    // The on-screen controller sits over the picture (semi-transparent), so
    // the game takes only its own height and the tracker gets the rest.
    if (window.EmuPlayer) EmuPlayer.setTouchPlacement('overlay');
  }
  if (COMPACT_Q.addEventListener) COMPACT_Q.addEventListener('change', placeControls);

  function boot(file, gameName, id, resume) {
    $('placeholder').remove();
    document.body.classList.add('playing');
    Z1Seed.release();
    window.EJS_onGameStart = function () {
      NesBridge.invalidate();
      if (Z1Diag.safe) {
        // Test mode: nothing of ours touches the emulator while it runs.
        NesBridge.ram = () => null;
        toast('Test mode: autotracking and autosave are off');
        return;
      }
      startAutosave(id, resume);
    };
    placeControls();
    EmuPlayer.boot('#game', file).catch((e) => console.error('[app] emulator failed', e));
    placeControls();
  }

  // ── autosave ──────────────────────────────────────────────────────────────
  // iOS closes web apps that use too much memory, and the app reopens at the
  // start screen. Keep a snapshot of the running game (every 20 s, and when
  // the app goes to the background) so Continue picks up where you were.
  let autosaveKey = null;
  function snapshotNow() {
    const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!gm || !autosaveKey) return;
    let st;
    try { st = gm.getState(); } catch (e) { return; }
    if (!st || st.length < 1024) return;
    const copy = new Uint8Array(st).buffer;   // own buffer, not a view into the emulator
    Z1Store.set(autosaveKey, { state: copy, t: Date.now() }).catch(() => {});
  }
  function startAutosave(id, resume) {
    autosaveKey = 'resume:' + id;
    const begin = () => {
      setInterval(() => { if (!document.hidden) snapshotNow(); }, 20000);
      document.addEventListener('visibilitychange', () => { if (document.hidden) snapshotNow(); });
      window.addEventListener('pagehide', snapshotNow);
    };
    if (!resume) { begin(); return; }
    Z1Store.get(autosaveKey).then((saved) => {
      if (saved && saved.state) {
        setTimeout(() => {
          try {
            window.EJS_emulator.gameManager.loadState(new Uint8Array(saved.state));
            NesBridge.invalidate();
            toast('Picked up where you left off');
          } catch (e) { console.warn('[autosave] could not restore', e); }
          begin();
        }, 600);
      } else begin();
    });
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text; t.setAttribute('role', 'status');
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ── controller indicator (the player reads gamepads itself) ──────────────
  function pads() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; }
  }
  function paintPad() {
    const el = $('pad-status'), list = pads();
    el.className = 'pill' + (list.length ? ' on' : '');
    el.title = list.length ? list[0].id : 'Connect a controller, then press any button on it';
    el.querySelector('span').textContent = list.length ? 'Controller connected' : 'No controller';
  }
  setInterval(paintPad, 1000);
  window.addEventListener('gamepadconnected', paintPad);

  // ── installable app ───────────────────────────────────────────────────────
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('install-btn').hidden = false; });
  $('install-btn').addEventListener('click', () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(() => { deferredPrompt = null; $('install-btn').hidden = true; });
  });
  window.addEventListener('appinstalled', () => { $('install-btn').hidden = true; });
})();
