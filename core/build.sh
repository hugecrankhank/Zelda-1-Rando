#!/bin/sh
# Builds emu/fceumm.wasm: libretro FCEUmm + core/frontend.c, for the browser.
#
# Needs clang 15+ with the wasm32 target and wasm-ld, a wasi-libc sysroot
# (https://github.com/WebAssembly/wasi-libc, built for wasm32-wasip1) and
# compiler-rt's builtins for wasm32 (BUILTINS, a libclang_rt.builtins-wasm32.a;
# wasi-sdk ships both).
#   SYSROOT=/path/to/sysroot BUILTINS=/path/to/libclang_rt.builtins-wasm32.a sh core/build.sh
# FCEUMM defaults to a fresh clone of the pinned commit below.
set -eu
FCEUMM_COMMIT=ac0d00a7fc01166f84c7bac01d1084ebfd2b865e
here=$(cd "$(dirname "$0")" && pwd)
: "${SYSROOT:?set SYSROOT to a wasi-libc sysroot}"
if [ -z "${FCEUMM:-}" ]; then
  FCEUMM=$here/.fceumm
  [ -d "$FCEUMM" ] || { git clone -q https://github.com/libretro/libretro-fceumm "$FCEUMM"; git -C "$FCEUMM" checkout -q $FCEUMM_COMMIT; }
fi
SRC=$FCEUMM/src
COMM=$SRC/drivers/libretro/libretro-common
OUT=$here/build
mkdir -p "$OUT"

CFLAGS="--target=wasm32-wasip1 --sysroot=$SYSROOT -O2 -fno-strict-aliasing -w \
  -D__LIBRETRO__ -DPATH_MAX=1024 -DFCEU_VERSION_NUMERIC=9900 -DFRONTEND_SUPPORTS_RGB565 \
  -DLSB_FIRST -DLOCAL_LE=1 -DINLINE=inline -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN \
  -I$SRC/drivers/libretro -I$COMM/include -I$SRC -I$SRC/input -I$SRC/boards"

SOURCES="$SRC/boards/*.c $SRC/input/*.c \
  $SRC/drivers/libretro/libretro.c $SRC/drivers/libretro/libretro_dipswitch.c \
  $SRC/cart.c $SRC/cheat.c $SRC/crc32.c $SRC/fceu-endian.c $SRC/fceu-memory.c $SRC/fceu.c \
  $SRC/fds.c $SRC/fds_apu.c $SRC/file.c $SRC/filter.c $SRC/general.c $SRC/input.c $SRC/md5.c \
  $SRC/nsf.c $SRC/palette.c $SRC/ppu.c $SRC/sound.c $SRC/state.c $SRC/video.c $SRC/vsuni.c \
  $SRC/ines.c $SRC/unif.c $SRC/x6502.c \
  $COMM/streams/memory_stream.c $COMM/compat/compat_posix_string.c $COMM/compat/compat_snprintf.c \
  $COMM/compat/compat_strcasestr.c $COMM/compat/compat_strl.c $COMM/compat/fopen_utf8.c \
  $COMM/encodings/encoding_utf.c $COMM/file/file_path.c $COMM/file/file_path_io.c \
  $COMM/streams/file_stream.c $COMM/streams/file_stream_transforms.c $COMM/string/stdstring.c \
  $COMM/time/rtime.c $COMM/vfs/vfs_implementation.c \
  $here/frontend.c"

objs=""
for f in $SOURCES; do
  o=$OUT/$(echo "$f" | sed "s#$FCEUMM/##; s#$here/##; s#/#_#g; s#\.c\$#.o#")
  objs="$objs $o"
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ]; then
    clang $CFLAGS -c "$f" -o "$o" &
    while [ "$(jobs -p | wc -l)" -ge 8 ]; do sleep 0.1; done
  fi
done
wait

# Link against the given builtins instead of clang's (often missing) copy.
RD=$OUT/resource-dir
mkdir -p "$RD/lib/wasip1"
[ -n "${BUILTINS:-}" ] && cp "$BUILTINS" "$RD/lib/wasip1/libclang_rt.builtins-wasm32.a"
clang --target=wasm32-wasip1 --sysroot=$SYSROOT -resource-dir="$RD" -O2 -mexec-model=reactor \
  -Wl,--export=_initialize -Wl,--strip-all -Wl,-z,stack-size=1048576 \
  -Wl,--initial-memory=33554432 -Wl,--max-memory=134217728 \
  $objs -lwasi-emulated-signal -lwasi-emulated-mman -o "$here/../emu/fceumm.wasm"
ls -l "$here/../emu/fceumm.wasm"
