/*
 * NES core wrapper. Loads emu/fceumm.wasm (libretro FCEUmm + core/frontend.c,
 * built with clang + wasi-libc, no Emscripten) and exposes the same small API
 * as ALTTPR Snes9x's core, so the shared player (emu/player.js) runs it.
 * Works in the browser and in Node (for tests).
 *
 *   const core = await EmuCore.create(wasmBytesOrUrl);
 *   core.load(romUint8Array);
 *   core.runFrame(pad1Bits, pad2Bits);
 *   core.frame()  -> { w, h, data: Uint16Array (RGB565) }
 *   core.audio()  -> Int16Array interleaved stereo (view, copy if kept)
 *   core.wram()   -> Uint8Array view of the NES's live 2 KB RAM
 *   core.sram()   -> battery save RAM (8 KB for Zelda), or empty
 */
(function (root) {
  'use strict';

  // Just enough WASI for a reactor that never opens files: stdio goes to
  // the console, everything else reports "not supported".
  function wasiImports(getMem) {
    const ENOSYS = 52, EBADF = 8, ENOENT = 44;
    const dec = new TextDecoder();
    let line = '';
    const imp = {
      fd_write(fd, iovs, n, nwritten) {
        const mem = getMem(), dv = new DataView(mem.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const p = dv.getUint32(iovs + i * 8, true), l = dv.getUint32(iovs + i * 8 + 4, true);
          line += dec.decode(new Uint8Array(mem.buffer, p, l));
          total += l;
        }
        let nl;
        while ((nl = line.indexOf('\n')) >= 0) { if (line.slice(0, nl).trim()) console.warn('[fceumm]', line.slice(0, nl)); line = line.slice(nl + 1); }
        dv.setUint32(nwritten, total, true);
        return 0;
      },
      clock_time_get(id, prec, out) {
        const ns = BigInt(Math.round((id === 0 ? Date.now() : performance.now()) * 1e6));
        new DataView(getMem().buffer).setBigUint64(out, ns, true); return 0;
      },
      fd_close() { return 0; },
      fd_fdstat_get() { return EBADF; },
      fd_fdstat_set_flags() { return ENOSYS; },
      fd_filestat_get() { return EBADF; },
      fd_prestat_get() { return EBADF; },
      fd_prestat_dir_name() { return EBADF; },
      fd_read() { return EBADF; },
      fd_seek() { return EBADF; },
      fd_tell() { return EBADF; },
      path_open() { return ENOENT; },
      path_filestat_get() { return ENOENT; },
      proc_exit(c) { throw new Error('fceumm exited ' + c); },
    };
    return new Proxy(imp, { get: (t, k) => (k in t ? t[k] : () => ENOSYS) });
  }

  async function create(source) {
    let mem = null;
    const imports = { wasi_snapshot_preview1: wasiImports(() => mem) };
    let inst;
    if (typeof source === 'string') {
      try { inst = (await WebAssembly.instantiateStreaming(fetch(source), imports)).instance; }
      catch (e) { inst = (await WebAssembly.instantiate(await (await fetch(source)).arrayBuffer(), imports)).instance; }
    } else {
      inst = (await WebAssembly.instantiate(source, imports)).instance;
    }
    const x = inst.exports;
    mem = x.memory;
    x._initialize();
    return new Core(x);
  }

  function Core(x) { this.x = x; this.loaded = false; this._rom = null; }
  Core.prototype = {
    get memory() { return this.x.memory; },
    load(rom) {
      const p = this.x.z_alloc(rom.length);       // kept: the core reads the ROM from here
      new Uint8Array(this.x.memory.buffer, p, rom.length).set(rom);
      this.loaded = !!this.x.z_load(p, rom.length);
      this._rom = { p, n: rom.length };
      return this.loaded;
    },
    reset() { this.x.z_reset(); },
    runFrame(p1, p2) { this.x.z_input(0, p1 | 0); this.x.z_input(1, p2 | 0); this.x.z_run(); },
    get fps() { return this.x.z_fps() || 60.0988; },
    get sampleRate() { return this.x.z_sample_rate() || 48000; },
    frameSerial() { return this.x.z_fb_count(); },
    frame() {
      const w = this.x.z_fb_w(), h = this.x.z_fb_h();
      return { w, h, data: new Uint16Array(this.x.memory.buffer, this.x.z_fb(), w * h) };
    },
    audio() {
      const n = this.x.z_audio_take();
      return new Int16Array(this.x.memory.buffer, this.x.z_audio(), n * 2);
    },
    mem(id) {
      const p = this.x.z_mem(id), n = this.x.z_mem_size(id);
      return p && n ? new Uint8Array(this.x.memory.buffer, p, n) : new Uint8Array(0);
    },
    wram() { return this.mem(2); },          // RETRO_MEMORY_SYSTEM_RAM: $0000-$07FF
    sram() { return this.mem(0); },          // RETRO_MEMORY_SAVE_RAM: battery-backed $6000-$7FFF
    rom() { return this._rom ? new Uint8Array(this.x.memory.buffer, this._rom.p, this._rom.n) : new Uint8Array(0); },
    saveState() {
      const n = this.x.z_state_size();
      if (!n) return null;
      const p = this.x.z_alloc(n);
      try { return this.x.z_state_save(p, n) ? new Uint8Array(this.x.memory.buffer, p, n).slice() : null; }
      finally { this.x.z_free(p); }
    },
    loadState(bytes) {
      const p = this.x.z_alloc(bytes.length);
      try { new Uint8Array(this.x.memory.buffer, p, bytes.length).set(bytes); return !!this.x.z_state_load(p, bytes.length); }
      finally { this.x.z_free(p); }
    },
  };

  // NES pad bits (libretro RETRO_DEVICE_ID_JOYPAD_* order, same as the SNES player uses)
  const BTN = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8 };

  const api = { create, BTN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EmuCore = api;
})(typeof self !== 'undefined' ? self : this);
