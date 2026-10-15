/*
 * nes-bridge.js — reads the NES's 2 KB work RAM straight out of EmulatorJS.
 *
 * Same idea as ALTTPR Unified's SNES bridge: EmulatorJS doesn't export the
 * core's memory pointer, but gameManager.getState() returns an FCEUmm save
 * state, which stores CPU RAM as an SFORMAT entry: "RAM\0", a 32-bit LE size
 * (0x800), then the 2048 bytes. We take one snapshot, find that block, then
 * search the WASM heap for the same 2 KB. After that every read is a direct
 * view into live memory. It re-verifies periodically, relocates if the core
 * moved its buffer, and falls back to throttled snapshots if the heap search
 * fails.
 *
 * window.NesBridge:
 *   ram()        → Uint8Array(2048) view (live) or copy (snapshot), or null
 *   status()     → {running, mode: 'idle'|'live'|'snapshot', ptr}
 *   invalidate() → forget the pointer (call when a game starts)
 *   peek(addr, n)→ hex dump helper for the console
 */
(function () {
  'use strict';

  const RAM_SIZE = 0x800;
  // SFORMAT entry header for RAM: desc "RAM\0" + size 0x00000800 (LE).
  const TAG = [0x52, 0x41, 0x4D, 0x00, 0x00, 0x08, 0x00, 0x00];
  const SNAPSHOT_MIN_MS = 250;
  const VERIFY_EVERY_MS = 4000;

  const st = { ptr: -1, mode: 'idle', snap: null, snapAt: 0, lastVerify: 0, listeners: new Set() };

  function gm() { const e = window.EJS_emulator; return e && e.gameManager ? e.gameManager : null; }
  function heap() { const g = gm(); return g && g.Module && g.Module.HEAPU8 ? g.Module.HEAPU8 : null; }

  function findTag(buf) {
    outer:
    for (let i = 0; i <= buf.length - TAG.length - RAM_SIZE; i++) {
      if (buf[i] !== 0x52) continue;
      for (let j = 1; j < TAG.length; j++) if (buf[i + j] !== TAG[j]) continue outer;
      return i + TAG.length;
    }
    return -1;
  }

  function snapshot() {
    const g = gm();
    if (!g) return null;
    let s;
    try { s = g.getState(); } catch (e) { return null; }
    if (!s) return null;
    const buf = s instanceof Uint8Array ? s : new Uint8Array(s.buffer || s);
    const at = findTag(buf);
    return at < 0 ? null : buf.slice(at, at + RAM_SIZE);
  }

  // A window of RAM with many distinct values, so the search doesn't lock
  // onto zero-filled or repeating stretches. NES RAM is small and can be
  // sparse early on; accept a lower bar if nothing better exists.
  function pickNeedle(ram) {
    let best = 0, bestN = -1;
    for (let off = 0; off + 48 <= RAM_SIZE; off += 16) {
      const seen = new Set();
      for (let k = 0; k < 48; k++) seen.add(ram[off + k]);
      if (seen.size > bestN) { bestN = seen.size; best = off; }
      if (seen.size >= 24) break;
    }
    return { off: best, distinct: bestN };
  }

  function emit() { const s = status(); st.listeners.forEach((fn) => { try { fn(s); } catch (e) {} }); }

  function locate() {
    const ram = snapshot(), h = heap();
    if (!ram || !h) return false;
    st.snap = ram; st.snapAt = performance.now(); st.lastVerify = st.snapAt;
    const { off, distinct } = pickNeedle(ram);
    const hits = [];
    if (distinct >= 8) {
      const b0 = ram[off];
      for (let i = off; i <= h.length - (RAM_SIZE - off); i++) {
        if (h[i] !== b0) continue;
        let ok = true;
        for (let k = 1; k < 48; k++) if (h[i + k] !== ram[off + k]) { ok = false; break; }
        if (!ok) continue;
        const base = i - off;
        // Skip the serialized state itself (preceded by the RAM tag).
        if (base >= TAG.length) {
          let tagged = true;
          for (let t = 0; t < TAG.length; t++) if (h[base - TAG.length + t] !== TAG[t]) { tagged = false; break; }
          if (tagged) continue;
        }
        let full = true;
        for (let k = 0; k < RAM_SIZE; k++) if (h[base + k] !== ram[k]) { full = false; break; }
        if (full) hits.push(base);
        if (hits.length > 3) break;
      }
    }
    if (hits.length) {
      st.ptr = hits[0]; st.mode = 'live';
      console.log('[nes-bridge] RAM located at heap 0x' + st.ptr.toString(16) +
                  (hits.length > 1 ? ' (' + hits.length + ' candidates)' : ''));
    } else {
      st.ptr = -1; st.mode = 'snapshot';
    }
    emit();
    return true;
  }

  function verify() {
    const now = performance.now();
    if (now - st.lastVerify < VERIFY_EVERY_MS) return;
    st.lastVerify = now;
    const ram = snapshot(), h = heap();
    if (!ram || !h) return;
    // The NMI handler can change a few bytes between the snapshot and this
    // check only if the core ran in between — it doesn't, same JS tick — so
    // any mismatch means the pointer is stale.
    for (let k = 0; k < RAM_SIZE; k += 64) {
      if (h[st.ptr + k] !== ram[k] || h[st.ptr + k + 31] !== ram[k + 31]) {
        console.warn('[nes-bridge] live pointer went stale, relocating');
        locate();
        return;
      }
    }
  }

  function ram() {
    if (!gm()) return null;
    if (st.mode === 'idle' && !locate()) return null;
    if (st.mode === 'live') {
      verify();
      const h = heap();
      if (st.mode === 'live' && h) return h.subarray(st.ptr, st.ptr + RAM_SIZE);
    }
    const now = performance.now();
    if (now - st.snapAt > SNAPSHOT_MIN_MS) {
      const s = snapshot();
      if (s) { st.snap = s; st.snapAt = now; }
      if (st.mode === 'snapshot' && now - st.lastVerify > VERIFY_EVERY_MS) locate();  // try to go live
    }
    return st.snap;
  }

  function status() { return { running: !!gm(), mode: st.mode, ptr: st.ptr }; }
  function invalidate() { st.ptr = -1; st.mode = 'idle'; st.snap = null; emit(); }
  function peek(addr, n) {
    const r = ram(); if (!r) return 'no RAM';
    const out = [];
    for (let i = 0; i < (n || 16); i++) out.push(r[(addr + i) & 0x7FF].toString(16).padStart(2, '0'));
    return out.join(' ');
  }

  window.NesBridge = { ram, status, invalidate, peek, onStatus: (fn) => st.listeners.add(fn),
    _findTag: findTag };   // exposed for tests
})();
