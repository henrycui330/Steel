#!/usr/bin/env bash
# Convert Newc42 "Low Poly Tanks - FBX" into tiger.glb / pz3.glb for Steel.
# Usage:
#   1. Download FBX zip from https://newc-42.itch.io/german-low-poly-wwii-tanks
#   2. Unzip somewhere, then:
#      ./scripts/convert-newc42-fbx.sh /path/to/folder-with-fbx
set -euo pipefail

SRC_DIR="${1:-}"
if [[ -z "$SRC_DIR" || ! -d "$SRC_DIR" ]]; then
  echo "Usage: $0 /path/to/newc42-fbx-folder"
  exit 1
fi

BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
if [[ ! -x "$BLENDER" ]]; then
  echo "Blender not found at $BLENDER"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/public/models"
mkdir -p "$OUT_DIR"

# Find likely FBX files (names vary)
mapfile -t FBXS < <(find "$SRC_DIR" -iname '*.fbx' | sort)
if [[ ${#FBXS[@]} -eq 0 ]]; then
  echo "No .fbx files under $SRC_DIR"
  exit 1
fi

echo "Found FBX files:"
printf '  %s\n' "${FBXS[@]}"

export_one() {
  local fbx="$1"
  local out_name="$2"
  local out="$OUT_DIR/$out_name"
  local py
  py="$(mktemp /tmp/steel-fbx2glb.XXXXXX.py)"
  cat >"$py" <<PY
import bpy
import sys

fbx = r'''$fbx'''
out = r'''$out'''

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
# Export selected / all as GLB
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
)
print('Wrote', out)
PY
  echo "Converting $(basename "$fbx") -> $out_name"
  "$BLENDER" --background --python "$py"
  rm -f "$py"
}

# Heuristic naming
for f in "${FBXS[@]}"; do
  base="$(basename "$f" | tr '[:upper:]' '[:lower:]')"
  if [[ "$base" == *tiger* || "$base" == *pz-vi* || "$base" == *pz_vi* || "$base" == *pzvi* ]]; then
    export_one "$f" "tiger.glb"
  elif [[ "$base" == *pz-iii* || "$base" == *pz_iii* || "$base" == *pziii* || "$base" == *pz3* ]]; then
    export_one "$f" "pz3.glb"
  elif [[ "$base" == *leicht* ]]; then
    export_one "$f" "leichttraktor.glb"
  else
    # If only one file or unknown names, export first as tiger
    :
  fi
done

# If tiger.glb still missing, export the largest FBX as tiger
if [[ ! -f "$OUT_DIR/tiger.glb" ]]; then
  largest="$(ls -S "${FBXS[@]}" | head -1)"
  export_one "$largest" "tiger.glb"
fi

ls -la "$OUT_DIR"/*.glb
echo "Done. Refresh the game — loader prefers /models/tiger.glb"
