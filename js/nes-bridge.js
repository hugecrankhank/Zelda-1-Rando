/*
 * nes-bridge.js — the tracker's view of the NES's 2 KB RAM.
 *
 * The emulator is our own FCEUmm build (emu/), which reports where it keeps
 * system RAM, so every read is a direct view into live memory: no save
 * states, no searching. (The EmulatorJS version had to find RAM by taking a
 * save state and searching the heap for it.)
 *
 * window.NesBridge:
 *   ram()        → Uint8Array(2048) live view, or null when no game is running
 *   sram()       → Uint8Array(8192) live view of cartridge RAM ($6000-$7FFF), or null
 *   status()     → {running, mode: 'idle'|'live', direct}
 *   invalidate() → no-op, kept for the app's game-start hook
 *   peek(addr, n)→ hex dump helper for the console
 */
(function () {
  'use strict';
  const listeners = new Set();

  function core() {
    const e = window.EJS_emulator;
    const c = e && e.core;
    return c && c.loaded ? c : null;
  }
  function ram() {
    const c = core();
    if (!c) return null;
    const r = c.wram();
    return r.length >= 0x800 ? r : null;
  }
  // Cartridge RAM ($6000-$7FFF): the game's live copies of the level tables.
  function sram() {
    const c = core();
    if (!c) return null;
    const r = c.sram();
    return r.length >= 0x2000 ? r : null;
  }
  function status() {
    const live = !!ram();
    return { running: !!core(), mode: live ? 'live' : 'idle', direct: live };
  }
  function peek(addr, n) {
    const r = ram(); if (!r) return 'no RAM';
    const out = [];
    for (let i = 0; i < (n || 16); i++) out.push(r[(addr + i) & 0x7FF].toString(16).padStart(2, '0'));
    return out.join(' ');
  }

  window.NesBridge = {
    ram, sram, status, peek,
    invalidate() { const s = status(); listeners.forEach((fn) => { try { fn(s); } catch (e) {} }); },
    onStatus: (fn) => listeners.add(fn),
  };
})();
