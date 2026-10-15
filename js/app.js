/*
 * app.js — wires the page together: EmulatorJS (FCEUmm core) boot, ROM
 * loading, the tracker session, controller and audio fixes, and the PWA bits.
 */
(function () {
  'use strict';
  const EJS_CDN = 'https://cdn.emulatorjs.org/stable/data/';
  const $ = (id) => document.getElementById(id);

  $('brand-mark').innerHTML = Z1Icons.svg('triforce');
  $('tri-mark').innerHTML = Z1Icons.svg('triforce');

  // ── tracker ───────────────────────────────────────────────────────────────
  Z1Tracker.init($('tracker'));
  Z1Tracker.setSession('manual', 'No game running: tap items to track by hand.');
  Z1Tracker.onLink((s) => {
    const el = $('link-status');
    el.className = 'pill' + (s === 'live' ? ' on' : s === 'waiting' ? ' wait' : '');
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
  $('ph-continue').addEventListener('click', () => stored && play(stored));

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
  async function play(entry) {
    if (booted) {
      // EmulatorJS can't swap games in place; the seed is already stored, so
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
    document.title = describe(entry) + ' - Z1R Unified';
    boot(new File([entry.rom], 'Z1R-' + id + '.nes'), 'Z1R-' + id);
  }

  function boot(file, gameName) {
    $('placeholder').remove();
    document.body.classList.add('playing');
    Z1Seed.release();
    window.EJS_player = '#game';
    window.EJS_core = 'fceumm';          // the bridge reads FCEUmm's state format
    window.EJS_pathtodata = EJS_CDN;
    window.EJS_gameUrl = file;
    window.EJS_gameName = gameName;      // one battery save per ROM, so seeds never overwrite each other
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#0058F8';
    window.EJS_backgroundColor = '#000000';
    window.EJS_defaultOptions = { lockMouse: 'disabled' };
    window.EJS_onGameStart = function () {
      if (window.EJS_emulator) window.EJS_emulator.enableMouseLock = false;
      NesBridge.invalidate();
    };
    const s = document.createElement('script');
    s.src = EJS_CDN + 'loader.js';
    s.onerror = () => alert('Could not load the emulator. Check your connection and reload.');
    document.body.appendChild(s);
  }

  // ── controller: indicator + auto-assign to player 1 ───────────────────────
  // EmulatorJS only assigns a pad from its own "connected" event, which can
  // fire before it listens. Assign the first pad ourselves when that happens.
  function pads() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; }
  }
  function assignPad() {
    const ejs = window.EJS_emulator;
    const sel = ejs && ejs.frontend && ejs.frontend.gamepadSelection;
    const known = ejs && ejs.gamepad && ejs.gamepad.gamepads;
    if (!sel || !known || !known.length || sel.some(Boolean)) return;
    sel[0] = known[0].id + '_' + known[0].index;
    try { ejs.frontend.updateGamepadLabels(); } catch (e) {}
  }
  function paintPad() {
    const el = $('pad-status'), list = pads();
    el.className = 'pill' + (list.length ? ' on' : '');
    el.title = list.length ? list[0].id : 'Connect a controller, then press any button on it';
    el.querySelector('span').textContent = list.length ? 'Controller connected' : 'No controller';
  }
  setInterval(() => { paintPad(); assignPad(); }, 500);
  window.addEventListener('gamepadconnected', () => { paintPad(); assignPad(); });

  // ── volume that works on iPhone/iPad (same fix as ALTTPR Unified) ─────────
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  function applyVolume() {
    const ejs = window.EJS_emulator;
    const ctx = ejs && ejs.Module && ejs.Module.AL && ejs.Module.AL.currentCtx;
    if (!ctx || !ctx.gain) return;
    const v = ejs.muted ? 0 : (typeof ejs.volume === 'number' ? ejs.volume : 0.5);
    if (ctx.gain.gain.value !== v) ctx.gain.gain.value = v;
    (ctx.sources || []).forEach((s) => { if (s && s.gain && s.gain.gain.value !== 1) s.gain.gain.value = 1; });
    if (ctx.audioCtx && ctx.audioCtx.state === 'suspended') { try { ctx.audioCtx.resume(); } catch (e) {} }
  }
  function hookVolume() {
    const ejs = window.EJS_emulator;
    if (!ejs || ejs.__volHooked || typeof ejs.setVolume !== 'function') return;
    const orig = ejs.setVolume.bind(ejs);
    ejs.setVolume = (v) => { orig(v); applyVolume(); };
    ejs.__volHooked = true;
  }
  setInterval(() => { hookVolume(); applyVolume(); }, 500);
  ['touchend', 'click'].forEach((t) => document.addEventListener(t, () => setTimeout(applyVolume, 50), true));

  // Zelda never uses a mouse: never let the canvas grab the pointer.
  ['requestPointerLock', 'mozRequestPointerLock', 'webkitRequestPointerLock'].forEach((k) => {
    if (Element.prototype[k]) Element.prototype[k] = () => Promise.resolve();
  });

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
