/*
 * owmap.js — draws Zelda 1's overworld from the ROM being played, and reads
 * where its entrances are.
 *
 * Everything comes from the player's own ROM (the seed), so a mixed-quest or
 * otherwise changed overworld is drawn as it really is. The decoding follows
 * the game's LayoutRoomOrCaveOW / WriteSquareOW / FillPlayAreaAttrs
 * (aldonunez's disassembly) and the table offsets are ZORA's
 * (zora/rom/vanilla_overworld/tables.py, checked by its tests against both
 * US releases; PRG1 doesn't move any of them).
 *
 *   const ow = OwMap.read(romBytes)  // null if this isn't a Zelda 1 ROM
 *   ow.drawMap(ctx, W, H, secretOf) / ow.drawScreen(ctx, s, secretFound)
 *   ow.screen(s) → {dest, kind, entrance, quest, layout}
 */
(function () {
  'use strict';

  const HDR = 0x10;
  const PRG0 = {
    LEVEL_BLOCK_OW: 0x18400,      // six $80-byte tables A-F
    LEVEL_INFO_OW: 0x19300,       // palettes transfer buffer first
    ROOM_LAYOUTS_OW: 0x15418,     // 121 layouts x 16 column descriptors
    COLUMN_DIRECTORY_OW: 0x19D0F, // 16 pointers into bank 5
    PRIMARY_SQUARES_OW: 0x1697C,  // $38 bytes
    SECONDARY_SQUARES_OW: 0x169B4,// $40 bytes
    CHR_COMMON_BG: 34687,         // $700 bytes -> BG tiles $00-$6F
    CHR_OW_BG: 51515,             // $820 bytes -> BG tiles $70-$F1
    CHR_MISC: 36479,              // $E0 bytes  -> BG tiles $F2-$FF
  };
  const LAYOUTS = 121, ROWS = 11, COLS = 16;
  let PRG = PRG0;

  // The NES (2C02) palette, $00-$3F. From cynes (MIT, Combey Theo), via ZORA's
  // zora_export/nes_palette.py; see THIRD-PARTY in README.
  const NES = [
    '545454', '001e74', '081090', '300088', '440064', '5c0030', '540400', '3c1800',
    '202a00', '083a00', '004000', '003c00', '00323c', '000000', '000000', '000000',
    '989698', '084cc4', '3032ec', '5c1ee4', '8814b0', 'a01464', '982220', '783c00',
    '545a00', '287200', '087c00', '007628', '006678', '000000', '000000', '000000',
    'eceeec', '4c9aec', '787cec', 'b062ec', 'e454ec', 'ec58b4', 'ec6a64', 'd48820',
    'a0aa00', '74c400', '4cd020', '38cc6c', '38b4cc', '3c3c3c', '000000', '000000',
    'eceeec', 'a8ccec', 'bcbcec', 'd4b2ec', 'ecaeec', 'ecaed4', 'ecb4b0', 'e4c490',
    'ccd278', 'b4de78', 'a8e290', '98e2b4', 'a0d6e4', 'a0a2a0', '000000', '000000',
  ].map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

  // How each screen's entrance (if it has one) is opened. Facts of the game,
  // as tabulated in ZORA's zora/model/overworld.py (SCREEN_ENTRANCE_TYPES).
  const E = { O: 'open', B: 'bomb', C: 'candle', P: 'bracelet', R: 'raft', L: 'ladder', LB: 'ladder+bomb', F: 'recorder' };
  const ENTRANCE = {
    0x00: 'B', 0x01: 'B', 0x02: 'B', 0x03: 'B', 0x04: 'O', 0x05: 'B', 0x06: 'F', 0x07: 'B',
    0x09: 'P', 0x0A: 'O', 0x0B: 'O', 0x0C: 'O', 0x0D: 'B', 0x0E: 'O', 0x0F: 'O', 0x10: 'B',
    0x11: 'P', 0x12: 'B', 0x13: 'B', 0x14: 'B', 0x15: 'B', 0x16: 'B', 0x18: 'LB', 0x19: 'LB',
    0x1A: 'O', 0x1B: 'P', 0x1C: 'O', 0x1D: 'P', 0x1E: 'B', 0x1F: 'O', 0x20: 'O', 0x21: 'O',
    0x22: 'O', 0x23: 'P', 0x24: 'O', 0x25: 'O', 0x26: 'B', 0x27: 'B', 0x28: 'C', 0x29: 'F',
    0x2B: 'F', 0x2C: 'B', 0x2D: 'B', 0x2F: 'R', 0x30: 'F', 0x33: 'B', 0x34: 'O', 0x37: 'O',
    0x3A: 'F', 0x3C: 'F', 0x3D: 'O', 0x42: 'F', 0x44: 'O', 0x45: 'R', 0x46: 'C', 0x47: 'C',
    0x48: 'C', 0x49: 'P', 0x4A: 'O', 0x4B: 'C', 0x4D: 'C', 0x4E: 'O', 0x51: 'C', 0x53: 'C',
    0x56: 'C', 0x58: 'F', 0x5B: 'C', 0x5E: 'O', 0x5F: 'L', 0x60: 'F', 0x62: 'C', 0x63: 'C',
    0x64: 'O', 0x66: 'O', 0x67: 'B', 0x68: 'C', 0x6A: 'C', 0x6B: 'C', 0x6C: 'C', 0x6D: 'C',
    0x6E: 'F', 0x6F: 'O', 0x70: 'O', 0x71: 'B', 0x72: 'F', 0x74: 'O', 0x75: 'O', 0x76: 'B',
    0x77: 'O', 0x78: 'C', 0x79: 'P', 0x7B: 'B', 0x7C: 'B', 0x7D: 'B',
  };

  // Destination codes (LevelBlockAttrsB bits 2-7), named as ZORA's Destination enum.
  function kindOf(dest) {
    if (dest >= 1 && dest <= 9) return 'L' + dest;
    return ({
      0x10: 'wood', 0x11: 'takeany', 0x12: 'white', 0x13: 'magic', 0x14: 'anyroad',
      0x15: 'hint', 0x16: 'gamble', 0x17: 'repair', 0x18: 'letter', 0x19: 'hint',
      0x1A: 'potion', 0x1B: 'hint', 0x1C: 'hint', 0x1D: 'shop', 0x1E: 'shop', 0x1F: 'shop',
      0x20: 'shop', 0x21: 'money', 0x22: 'money', 0x23: 'money',
    })[dest] || (dest ? 'cave' : null);
  }

  function read(romIn) {
    try {
      const rom = romIn instanceof Uint8Array ? romIn : new Uint8Array(romIn);
      // The file may or may not carry the 16-byte iNES header.
      const base = rom[0] === 0x4E && rom[1] === 0x45 && rom[2] === 0x53 && rom[3] === 0x1A ? HDR : 0;
      if (rom.length - base < 0x20000) return null;
      const at = (prg) => base + prg;
      const bytes = (prg, n) => rom.subarray(at(prg), at(prg) + n);
      // Follow the pointers the game itself uses to find its tables, in case
      // the randomizer moved them: LevelBlockAddrsQ1 / LevelInfoAddrs (bank 6
      // $8000 / $8014), RoomLayoutsOWAddr / ColumnHeapOWAddr (bank 5 $9F9C /
      // $9F9E). Fall back to the usual places if a pointer looks wrong.
      const ptr = (bank, prg, fallback) => {
        const v = rom[at(prg)] | (rom[at(prg) + 1] << 8);
        return v >= 0x8000 && v < 0xC000 ? bank * 0x4000 + (v - 0x8000) : fallback;
      };
      PRG = Object.assign({}, PRG0, {
        LEVEL_BLOCK_OW: ptr(6, 0x18000, PRG0.LEVEL_BLOCK_OW),
        LEVEL_INFO_OW: ptr(6, 0x18014, PRG0.LEVEL_INFO_OW),
        ROOM_LAYOUTS_OW: ptr(5, 0x15F9C, PRG0.ROOM_LAYOUTS_OW),
      });
      const heap0 = rom[at(0x15F9E)] | (rom[at(0x15F9E) + 1] << 8);
      const where = { block: PRG.LEVEL_BLOCK_OW, info: PRG.LEVEL_INFO_OW, layouts: PRG.ROOM_LAYOUTS_OW, heap0 };

      // Copies, so the game's live tables can replace them (applyLive).
      const block = bytes(PRG.LEVEL_BLOCK_OW, 6 * 0x80).slice();
      let info = bytes(PRG.LEVEL_INFO_OW, 0xFC);
      // LevelInfo starts with the palettes' PPU transfer header: $3F00, 32 bytes.
      const okInfo = (i) => i[0] === 0x3F && i[1] === 0x00 && i[2] === 0x20;
      if (!okInfo(info)) { info = bytes(PRG0.LEVEL_INFO_OW, 0xFC); if (!okInfo(info)) return null; }
      let bgPal = Array.from(info.subarray(3, 3 + 16)).map((c) => NES[c & 0x3F]);
      const layouts = bytes(PRG.ROOM_LAYOUTS_OW, LAYOUTS * 16);
      // Column heaps, from a 16-pointer directory into bank 5.
      function heapsFrom(dir) {
        const out = [];
        for (let i = 0; i < 16; i++) {
          const p = dir[i * 2] | (dir[i * 2 + 1] << 8);
          if (p < 0x8000 || p >= 0xC000) return null;           // must point into bank 5
          out.push(base + 5 * 0x4000 + (p - 0x8000));
        }
        return out;
      }
      const dir0 = bytes(PRG.COLUMN_DIRECTORY_OW, 32).slice();
      if (heap0 >= 0x8000 && heap0 < 0xC000) { dir0[0] = heap0 & 0xFF; dir0[1] = heap0 >> 8; }   // PatchColumnDirectoryForCellar
      let heaps = heapsFrom(dir0);
      if (!heaps) return null;
      const primary = bytes(PRG.PRIMARY_SQUARES_OW, 0x38);
      const secondary = bytes(PRG.SECONDARY_SQUARES_OW, 0x40);

      // BG pattern table ($1000): common $00-$6F, overworld $70-$F1, misc $F2-$FF.
      const chr = new Uint8Array(0x1000);
      chr.set(bytes(PRG.CHR_COMMON_BG, 0x700), 0);
      chr.set(bytes(PRG.CHR_OW_BG, 0x820), 0x700);
      chr.set(bytes(PRG.CHR_MISC, 0xE0), 0xF20);

      // Columns: the descriptor's high nibble picks a heap, the low nibble
      // the column (the heap is scanned for bytes with bit 7 set).
      const colCache = new Map();
      function column(desc) {
        if (colCache.has(desc)) return colCache.get(desc);
        let pos = heaps[desc >> 4] - 1;
        for (let n = 0; n <= (desc & 15); n++) {
          pos++;
          let guard = 0;
          while (!(rom[pos] & 0x80)) { pos++; if (++guard > 512) throw new Error('column'); }
        }
        const out = [];
        let repeating = false;
        while (out.length < ROWS) {
          const d = rom[pos];
          out.push(d & 0x3F);
          if (d & 0x40) { repeating = !repeating; if (repeating) continue; }
          pos++;
        }
        colCache.set(desc, out);
        return out;
      }
      function layout(n) {
        const cols = [];
        for (let c = 0; c < COLS; c++) cols.push(column(layouts[n * 16 + c]));
        return cols;
      }
      // Decode every layout once: also the sanity check that this is Zelda.
      for (let n = 0; n < LAYOUTS; n++) layout(n);

      // The four tiles of a square: TL, BL, TR, BR (WriteSquareOW), with the
      // game's tile-object and found-secret substitutions.
      function squareTiles(sq, secretFound) {
        let p = primary[sq];
        if (secretFound) {
          if (p === 0xE7 || p === 0xEA) { sq = 0x10; p = 0x70; }      // tree / armos -> stairs
          else if (p === 0xE6) { sq = 0x0C; }                         // rock wall -> cave
        }
        if (p >= 0xE5 && p <= 0xEA) p = [0xC8, 0xD8, 0xC4, 0xBC, 0xC0, 0xC0][p - 0xE5];
        if (sq < 0x10) return [secondary[sq * 4], secondary[sq * 4 + 1], secondary[sq * 4 + 2], secondary[sq * 4 + 3]];
        return [p, (p + 1) & 0xFF, (p + 2) & 0xFF, (p + 3) & 0xFF];
      }

      const T = (t, s) => block[t * 0x80 + s];
      const screens = [];
      function buildScreens() {
       screens.length = 0;
       for (let s = 0; s < 128; s++) {
        const dest = (T(1, s) >> 2) & 0x3F;
        screens.push({
          s,
          outer: T(0, s) & 3, inner: T(1, s) & 3,
          layout: T(3, s) & 0x7F,
          dest, kind: kindOf(dest),
          quest: (T(5, s) >> 6) & 3,               // 0 both, 1 first only, 2 second only, 3 neither
          entrance: E[ENTRANCE[s]] || null,
        });
       }
      }
      buildScreens();

      // The game's own copies, from cartridge RAM while a file is on the
      // overworld: LevelBlockAttrsA-F ($687E), ColumnDirectoryOW ($6827) and
      // the palettes ($6B7E). These are exactly what the game draws from, so
      // they replace the ROM file's when they differ. Returns how many
      // screens changed (layout, palette or destination), or -1 if the RAM
      // doesn't hold overworld tables.
      function applyLive(sram) {
        if (!sram || sram.length < 0x2000) return -1;
        const live = sram.subarray(0x087E, 0x087E + 0x300);
        for (let i = 0; i < 0x80; i++) if ((live[0x180 + i] & 0x7F) >= LAYOUTS) return -1;
        const liveHeaps = heapsFrom(sram.subarray(0x0827, 0x0827 + 32));
        if (!liveHeaps) return -1;
        let changed = 0;
        for (let i = 0; i < 0x80; i++) {
          if (((live[0x180 + i] ^ block[0x180 + i]) & 0x7F) || ((live[i] ^ block[i]) & 3) ||
              (live[0x80 + i] ^ block[0x80 + i])) changed++;
        }
        const heapsChanged = liveHeaps.some((h, i) => h !== heaps[i]);
        block.set(live);
        if (heapsChanged) { heaps = liveHeaps; colCache.clear(); changed = Math.max(changed, 128); }
        const pal = sram.subarray(0x0B7E, 0x0B7E + 19);
        if (pal[0] === 0x3F && pal[1] === 0x00 && pal[2] === 0x20) {
          const p2 = Array.from(pal.subarray(3, 19)).map((c) => NES[c & 0x3F]);
          if (p2.some((c, i) => c !== bgPal[i])) { bgPal = p2; changed = Math.max(changed, 128); }
        }
        buildScreens();
        return changed;
      }

      // One screen as RGBA, 256 x 176.
      function screenPixels(s, secretFound) {
        const sc = screens[s];
        const img = new Uint8ClampedArray(256 * 176 * 4);
        if (sc.layout >= LAYOUTS) return img;
        const cols = layout(sc.layout);
        for (let c = 0; c < COLS; c++) {
          for (let r = 0; r < ROWS; r++) {
            const tiles = squareTiles(cols[c][r], secretFound);
            // FillPlayAreaAttrs: inner palette for columns 2-13, rows 2-8.
            const pal = (c >= 2 && c <= 13 && r >= 2 && r <= 8) ? sc.inner : sc.outer;
            for (let q = 0; q < 4; q++) {
              const tx = c * 16 + (q >> 1) * 8, ty = r * 16 + (q & 1) * 8;
              const t = tiles[q] * 16;
              for (let y = 0; y < 8; y++) {
                const lo = chr[t + y], hi = chr[t + y + 8];
                for (let x = 0; x < 8; x++) {
                  const ci = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
                  const rgb = bgPal[ci ? pal * 4 + ci : 0];
                  const o = ((ty + y) * 256 + tx + x) * 4;
                  img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = 255;
                }
              }
            }
          }
        }
        return img;
      }

      // Draws screens straight into pixel buffers (no canvas-to-canvas
      // copies: Safari could show stale content when one scratch canvas was
      // redrawn and copied many times in a row).
      //   drawMap(ctx, W, H, secretOf): the whole 16x8 map, each screen
      //   box-filtered down to its cell of a W x H image.
      function drawMap(ctx, W, H, secretOf) {
        const out = ctx.createImageData(W, H);
        const d = out.data;
        for (let s = 0; s < 128; s++) {
          const px = screenPixels(s, secretOf(s));
          const x0 = Math.round((s & 15) * W / 16), x1 = Math.round(((s & 15) + 1) * W / 16);
          const y0 = Math.round((s >> 4) * H / 8), y1 = Math.round(((s >> 4) + 1) * H / 8);
          const cw = x1 - x0, ch = y1 - y0;
          for (let y = 0; y < ch; y++) {
            const sy0 = Math.floor(y * 176 / ch), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * 176 / ch));
            for (let x = 0; x < cw; x++) {
              const sx0 = Math.floor(x * 256 / cw), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * 256 / cw));
              let r = 0, g = 0, b = 0, n = 0;
              for (let sy = sy0; sy < sy1; sy++) {
                for (let sx = sx0; sx < sx1; sx++) {
                  const o = (sy * 256 + sx) * 4;
                  r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
                }
              }
              const o = ((y0 + y) * W + x0 + x) * 4;
              d[o] = r / n; d[o + 1] = g / n; d[o + 2] = b / n; d[o + 3] = 255;
            }
          }
        }
        ctx.putImageData(out, 0, 0);
      }
      // One screen at full size (256 x 176) into a canvas of that size.
      function drawScreen(ctx, s, secretFound) {
        ctx.putImageData(new ImageData(screenPixels(s, secretFound), 256, 176), 0, 0);
      }

      // The second quest swaps eight screens' destinations when a file loads
      // (LevelBlockAttrsBQ2Replacement*, ZORA's tables.py offsets).
      const q2Offs = bytes(0x1815F, 8), q2Vals = bytes(0x18167, 8);
      const q2 = new Map();
      for (let i = 0; i < 8; i++) if (q2Offs[i] < 0x80) q2.set(q2Offs[i], (q2Vals[i] >> 2) & 0x3F);

      return {
        screens,
        // The screen's destination for a file of this quest (0 first, 1 second).
        destFor(s, quest) { return quest === 1 && q2.has(s) ? q2.get(s) : screens[s].dest; },
        applyLive, where,
        screen: (s) => screens[s],
        startRoom: info[0x2F],
        anyRoadRooms: Array.from(info.subarray(0x34, 0x38)),
        // A cave's three wares (item ids; $3F = none), for shops once entered.
        wares(dest) {
          if (dest < 0x10 || dest > 0x23) return [];
          const i = (dest - 0x10) * 3;
          return [0, 1, 2].map((k) => block[4 * 0x80 + i + k] & 0x3F).filter((id) => id !== 0x3F);
        },
        screenPixels, drawScreen, drawMap, layout, squareTiles,
      };
    } catch (e) {
      console.warn('[owmap] not a readable Zelda overworld', e);
      return null;
    }
  }

  const api = { read, kindOf, ENTRANCE_TYPES: E };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.OwMap = api;
})();
