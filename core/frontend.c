/*
 * frontend.c: a minimal libretro frontend around the FCEUmm NES core,
 * compiled to WebAssembly. JavaScript (js/nes-core.js) drives it: it hands
 * over the ROM, calls z_run() once per frame, then reads the frame buffer and
 * the audio samples straight out of WebAssembly memory. It replaces the whole
 * EmulatorJS/RetroArch stack with a few kilobytes of glue.
 */
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "libretro.h"

#define EXPORT(name) __attribute__((export_name(#name)))

#define FB_MAX_W 512
#define FB_MAX_H 512
#define AUDIO_MAX 16384               /* stereo frames buffered between takes */

static uint16_t fb[FB_MAX_W * FB_MAX_H];  /* RGB565, packed (pitch = width): uploads straight to WebGL */
static unsigned fb_w = 256, fb_h = 240, fb_count = 0;
static int16_t audio[AUDIO_MAX * 2];
static unsigned audio_n = 0;
static uint16_t pad[2];
static struct retro_system_av_info av;
static int loaded = 0;
/* This FCEUmm reads ROMs held in memory only through GAME_INFO_EXT. */
static struct retro_game_info_ext game_ext;

/* Core options this frontend answers; everything else uses core defaults. */
static const char *option(const char *key) {
   if (!strcmp(key, "fceumm_sndrate_hint")) return "48KHz";
   if (!strcmp(key, "fceumm_sndquality")) return "High";
   if (!strcmp(key, "fceumm_region")) return "NTSC";
   if (!strcmp(key, "fceumm_overscan_v_top")) return "8";
   if (!strcmp(key, "fceumm_overscan_v_bottom")) return "8";
   if (!strcmp(key, "fceumm_overscan_h_left")) return "0";
   if (!strcmp(key, "fceumm_overscan_h_right")) return "0";
   return NULL;
}

static void log_cb(enum retro_log_level level, const char *fmt, ...) {
   va_list ap;
   if (level < RETRO_LOG_WARN) return;
   va_start(ap, fmt);
   vfprintf(stderr, fmt, ap);
   va_end(ap);
}

static bool env_cb(unsigned cmd, void *data) {
   switch (cmd) {
   case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      return *(const enum retro_pixel_format *)data == RETRO_PIXEL_FORMAT_RGB565;
   case RETRO_ENVIRONMENT_GET_VARIABLE: {
      struct retro_variable *v = (struct retro_variable *)data;
      v->value = option(v->key);
      return v->value != NULL;
   }
   case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *(bool *)data = false;
      return true;
   case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      *(bool *)data = true;
      return true;
   case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      ((struct retro_log_callback *)data)->log = log_cb;
      return true;
   case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
      *(unsigned *)data = 0;            /* legacy SET_VARIABLES is fine */
      return true;
   case RETRO_ENVIRONMENT_GET_GAME_INFO_EXT:
      if (!game_ext.data) return false;
      *(const struct retro_game_info_ext **)data = &game_ext;
      return true;
   case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
      av = *(const struct retro_system_av_info *)data;
      return true;
   case RETRO_ENVIRONMENT_SET_GEOMETRY:
      av.geometry = *(const struct retro_game_geometry *)data;
      return true;
   default:
      return false;
   }
}

static void video_cb(const void *data, unsigned w, unsigned h, size_t pitch) {
   unsigned y;
   if (!data) return;                   /* duped frame: keep the last one */
   if (w > FB_MAX_W) w = FB_MAX_W;
   if (h > FB_MAX_H) h = FB_MAX_H;
   for (y = 0; y < h; y++)
      memcpy(fb + y * w, (const uint8_t *)data + y * pitch, w * 2);
   fb_w = w; fb_h = h; fb_count++;
}

static size_t audio_batch_cb(const int16_t *data, size_t frames) {
   size_t room = AUDIO_MAX - audio_n;
   size_t n = frames < room ? frames : room;  /* drop overflow; JS drains each frame */
   memcpy(audio + audio_n * 2, data, n * 4);
   audio_n += n;
   return frames;
}
static void audio_cb(int16_t l, int16_t r) { int16_t s[2] = { l, r }; audio_batch_cb(s, 1); }

static void input_poll_cb(void) {}
static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
   if (port > 1 || device != RETRO_DEVICE_JOYPAD) return 0;
   if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)pad[port];
   return (pad[port] >> id) & 1;
}

/* ── exports ─────────────────────────────────────────────────────────────── */
EXPORT(z_alloc) void *z_alloc(size_t n) { return malloc(n); }
EXPORT(z_free) void z_free(void *p) { free(p); }

EXPORT(z_load) int z_load(const void *rom, size_t size) {
   struct retro_game_info info = { "game.nes", rom, size, NULL };
   memset(&game_ext, 0, sizeof game_ext);
   game_ext.full_path = "game.nes"; game_ext.dir = ""; game_ext.name = "game"; game_ext.ext = "nes";
   game_ext.data = rom; game_ext.size = size; game_ext.persistent_data = true;
   retro_set_environment(env_cb);
   retro_set_video_refresh(video_cb);
   retro_set_audio_sample(audio_cb);
   retro_set_audio_sample_batch(audio_batch_cb);
   retro_set_input_poll(input_poll_cb);
   retro_set_input_state(input_state_cb);
   retro_init();
   if (!retro_load_game(&info)) return 0;
   retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
   retro_set_controller_port_device(1, RETRO_DEVICE_JOYPAD);
   retro_get_system_av_info(&av);
   loaded = 1;
   return 1;
}

EXPORT(z_run) void z_run(void) { if (loaded) retro_run(); }
EXPORT(z_reset) void z_reset(void) { if (loaded) retro_reset(); }
EXPORT(z_input) void z_input(unsigned port, unsigned mask) { if (port < 2) pad[port] = (uint16_t)mask; }

EXPORT(z_fb) uint16_t *z_fb(void) { return fb; }
EXPORT(z_fb_w) unsigned z_fb_w(void) { return fb_w; }
EXPORT(z_fb_h) unsigned z_fb_h(void) { return fb_h; }
EXPORT(z_fb_count) unsigned z_fb_count(void) { return fb_count; }

EXPORT(z_audio) int16_t *z_audio(void) { return audio; }
/* Frames buffered since the last take; resets the buffer. */
EXPORT(z_audio_take) unsigned z_audio_take(void) { unsigned n = audio_n; audio_n = 0; return n; }
EXPORT(z_sample_rate) double z_sample_rate(void) { return av.timing.sample_rate; }
EXPORT(z_fps) double z_fps(void) { return av.timing.fps; }

/* RETRO_MEMORY_SAVE_RAM = 0 (battery save), RETRO_MEMORY_SYSTEM_RAM = 2. */
EXPORT(z_mem) void *z_mem(unsigned id) { return loaded ? retro_get_memory_data(id) : NULL; }
EXPORT(z_mem_size) size_t z_mem_size(unsigned id) { return loaded ? retro_get_memory_size(id) : 0; }

EXPORT(z_state_size) size_t z_state_size(void) { return loaded ? retro_serialize_size() : 0; }
EXPORT(z_state_save) int z_state_save(void *buf, size_t size) { return loaded && retro_serialize(buf, size); }
EXPORT(z_state_load) int z_state_load(const void *buf, size_t size) { return loaded && retro_unserialize(buf, size); }
