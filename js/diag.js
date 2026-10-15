/*
 * diag.js — crash recorder and status panel.
 *
 * While a game runs, a heartbeat is written to localStorage every 10 s:
 * play time, the emulator's WASM memory, page memory where the browser
 * reports it, how the tracker reads RAM, and how many save states were taken.
 * iOS closes a web app without any warning when it runs out of memory, so
 * the next launch checks for a heartbeat that never got a clean ending and
 * keeps it as a crash report. Tapping the status dot shows all of this.
 *
 * Test mode (?safe or the toggle in the panel) runs the emulator with the
 * tracker's RAM reading and autosave off, to tell whether a crash comes from
 * the emulator itself or from the tracker.
 */
(function () {
  'use strict';
  const KEY = 'z1ru:diag', CRASHES = 'z1ru:crashes', SAFE = 'z1ru:safe';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // A heartbeat left behind by a session that didn't end cleanly = crash.
  const prev = read(KEY, null);
  if (prev && prev.playing && !prev.clean) {
    const list = read(CRASHES, []);
    list.unshift(Object.assign({}, prev, { detected: Date.now() }));
    write(CRASHES, list.slice(0, 5));
  }
  localStorage.removeItem(KEY);

  const isSafe = () => /[?&]safe\b/.test(location.search) || localStorage.getItem(SAFE) === '1';
  let session = null, getStates = 0, peakHeap = 0, firstHeap = 0;

  function wasmMB() {
    const c = window.EJS_emulator && window.EJS_emulator.core;
    const m = c && c.memory;
    return m ? +(m.buffer.byteLength / 1048576).toFixed(1) : 0;
  }
  function jsMB() {
    const m = performance.memory;
    return m && m.usedJSHeapSize ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null;
  }
  function countStates() {
    const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!gm || gm.__counted || typeof gm.getState !== 'function') return;
    const orig = gm.getState.bind(gm);
    gm.getState = function () { getStates++; return orig(); };
    gm.__counted = true;
  }
  function snapshot() {
    const b = window.NesBridge ? NesBridge.status() : {};
    const heap = wasmMB();
    if (heap) { peakHeap = Math.max(peakHeap, heap); if (!firstHeap) firstHeap = heap; }
    return {
      playing: !!session, clean: false, label: session && session.label, start: session && session.start,
      last: Date.now(), minutes: session ? +((Date.now() - session.start) / 60000).toFixed(1) : 0,
      wasmMB: heap, firstWasmMB: firstHeap, peakWasmMB: peakHeap, jsMB: jsMB(),
      tracking: isSafe() ? 'off (test mode)' : b.direct ? 'direct RAM' : b.mode || 'idle',
      saveStates: getStates, hidden: document.hidden, ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''),
    };
  }
  function beat() {
    if (!session) return;
    countStates();
    write(KEY, snapshot());
  }
  // A clean ending (switching games, closing on desktop) is not a crash.
  window.addEventListener('pagehide', () => {
    if (!session) return;
    const s = snapshot(); s.clean = true; write(KEY, s);
  });
  // iOS fires pagehide when the app is merely backgrounded, then may resume
  // it; mark the session live again when it comes back.
  window.addEventListener('pageshow', () => { if (session) beat(); });
  // Leaving the app (app switcher, home screen) isn't a crash either, even if
  // iOS later discards it in the background. Only a session that dies while
  // on screen leaves an unclean heartbeat behind.
  document.addEventListener('visibilitychange', () => {
    if (!session) return;
    if (document.hidden) { const s = snapshot(); s.clean = true; write(KEY, s); } else beat();
  });

  function fmtCrash(c) {
    const t = new Date(c.last);
    return [
      'Crash report (Z1R Unified)',
      'When: ' + t.toLocaleString(),
      'Game: ' + (c.label || '?'),
      'Played: ' + c.minutes + ' min',
      'Emulator memory: ' + c.firstWasmMB + ' MB at start, ' + c.wasmMB + ' MB last, ' + c.peakWasmMB + ' MB peak',
      'Page memory: ' + (c.jsMB == null ? 'not reported' : c.jsMB + ' MB'),
      'Tracking: ' + c.tracking + ', save states taken: ' + c.saveStates,
      'In background: ' + (c.hidden ? 'yes' : 'no'),
      'Device: ' + c.ua,
    ].join('\n');
  }

  // ── status panel ──────────────────────────────────────────────────────────
  function open() {
    const d = document.getElementById('status-dlg');
    const live = session ? snapshot() : null;
    const crashes = read(CRASHES, []);
    const lines = [];
    if (live) {
      lines.push('Playing ' + live.label + ' for ' + live.minutes + ' min.');
      lines.push('Emulator memory: ' + live.wasmMB + ' MB (started at ' + live.firstWasmMB + ' MB).');
      if (live.jsMB != null) lines.push('Page memory: ' + live.jsMB + ' MB.');
      lines.push('Tracking: ' + live.tracking + '. Save states taken: ' + live.saveStates + '.');
    } else {
      lines.push('No game running.');
    }
    document.getElementById('status-live').textContent = lines.join('\n');
    const box = document.getElementById('status-crash');
    if (crashes.length) {
      box.textContent = fmtCrash(crashes[0]) + (crashes.length > 1 ? '\n\n(' + (crashes.length - 1) + ' earlier report' + (crashes.length > 2 ? 's' : '') + ' kept)' : '');
      document.getElementById('status-copy').hidden = false;
      document.getElementById('status-clear').hidden = false;
    } else {
      box.textContent = 'No crashes recorded.';
      document.getElementById('status-copy').hidden = true;
      document.getElementById('status-clear').hidden = true;
    }
    const t = document.getElementById('status-safe');
    t.checked = isSafe();
    d.showModal();
  }
  function init() {
    document.getElementById('link-status').addEventListener('click', open);
    document.getElementById('status-copy').addEventListener('click', async () => {
      const text = read(CRASHES, []).map(fmtCrash).join('\n\n');
      try { await navigator.clipboard.writeText(text); document.getElementById('status-copy').textContent = 'Copied'; }
      catch (e) {
        const box = document.getElementById('status-crash');
        const r = document.createRange(); r.selectNodeContents(box);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    });
    document.getElementById('status-clear').addEventListener('click', () => { write(CRASHES, []); open(); });
    document.getElementById('status-safe').addEventListener('change', (e) => {
      try { e.target.checked ? localStorage.setItem(SAFE, '1') : localStorage.removeItem(SAFE); } catch (x) {}
      document.getElementById('status-safe-note').hidden = false;
    });
  }

  window.Z1Diag = {
    get safe() { return isSafe(); },
    start(label) {
      session = { label, start: Date.now() };
      getStates = 0; peakHeap = 0; firstHeap = 0;
      setInterval(beat, 10000);
      setTimeout(beat, 3000);
    },
    init, open,
  };
})();
