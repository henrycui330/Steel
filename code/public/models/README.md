# Tank models

## Active (menu)
- `tiger.glb` — **Pz-V Panther A** mid-prod (baked from `Tanks/German Tanks/panther-a_mid_prod..glb`). Slot id still `tiger`. Bake: `scripts/bake_panther_a.py`
- `pz3.glb` — Sketchfab **Pz-III L** low-poly (baked)
- `leopard.glb` — **Leopard 1** (baked from `Tanks/German Tanks/tank_leopard_1.glb`). Bake: `scripts/bake_leopard_1.py`
- `leopard2.glb` — **Leopard 2A6** (War Thunder export `leopard_2a6_war_thunder.glb`). Bake: `scripts/bake_leopard_2a6.py`
- `pz4.glb` — Toshueyi **Panzer IV** (Sketchfab CC-BY-4.0), **Blender-baked** (non-uniform 3DS scales applied; ~2.5×2.1×5.9 m). Raw: `pz4.toshueyi.raw.glb`. Bake: `scripts/bake-pz4-toshueyi.sh`

## Source
- Newc42: https://newc-42.itch.io/german-low-poly-wwii-tanks (CC0)  
  Convert script: `scripts/convert-newc42-fbx.sh`
- Toshueyi Pz-IV: https://sketchfab.com/3d-models/panzer-iv-medium-tank-toshueyi-14c74d148326448c8edb5fee81be3894 (CC-BY-4.0)  
  Drop-in file: `panzer_iv_medium_tank_-_toshueyi.glb` → `public/models/pz4.glb`
