#!/usr/bin/env bash
# Bake Toshueyi Pz-IV: clear non-uniform 3DS scales, join, size to ~5.9m length.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
export STEEL_PZ4_IN="${1:-$ROOT/public/models/pz4.toshueyi.raw.glb}"
export STEEL_PZ4_OUT="$ROOT/public/models/pz4.glb"
"$BLENDER" --background --python "$ROOT/scripts/bake_pz4_toshueyi.py"
ls -la "$STEEL_PZ4_OUT"
