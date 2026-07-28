# Pin the x86-64 instruction set of every ggml-based backend (whisper.cpp in
# the Tauri app, llama.cpp in the llama-helper sidecar) to an AVX2 baseline.
#
# Why this file exists
# --------------------
# ggml defaults to GGML_NATIVE=ON, and on MSVC that runs FindSIMD.cmake, which
# probes the CPU of the *build machine* and compiles with /arch:AVX512 whenever
# that machine happens to support it. GitHub's Windows runners are a mixed
# fleet: some have AVX-512, some do not. So the same source produced a portable
# binary in one run and an AVX-512-only binary in the next — and the AVX-512 one
# died with STATUS_ILLEGAL_INSTRUCTION (0xc000001d) on the first ggml call on
# any consumer CPU without AVX-512 (Intel disabled it on hybrid P+E core parts,
# e.g. Core Ultra / Meteor Lake).
#
# Setting GGML_NATIVE=OFF skips the probe entirely, and ggml then honours the
# explicit feature flags below. AVX2/FMA/F16C/BMI2 are Haswell-era (2013) and
# present on every machine this app targets.
#
# Used as CMAKE_TOOLCHAIN_FILE so that it applies to crates whose build scripts
# only forward CMAKE_*-prefixed environment variables (llama-cpp-sys-2).
# Toolchain files are read before the projects declare their options(), and
# FORCE-ed cache entries win over the option() defaults.

set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

set(GGML_SSE42 ON  CACHE BOOL "" FORCE)
set(GGML_AVX   ON  CACHE BOOL "" FORCE)
set(GGML_AVX2  ON  CACHE BOOL "" FORCE)
set(GGML_FMA   ON  CACHE BOOL "" FORCE)
set(GGML_F16C  ON  CACHE BOOL "" FORCE)
set(GGML_BMI2  ON  CACHE BOOL "" FORCE)

set(GGML_AVX_VNNI    OFF CACHE BOOL "" FORCE)
set(GGML_AVX512      OFF CACHE BOOL "" FORCE)
set(GGML_AVX512_VBMI OFF CACHE BOOL "" FORCE)
set(GGML_AVX512_VNNI OFF CACHE BOOL "" FORCE)
set(GGML_AVX512_BF16 OFF CACHE BOOL "" FORCE)
