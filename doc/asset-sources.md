# Free online assets for Steel (Three.js)

Prefer **GLB / glTF**, **CC0** (or clear commercial-ok), low-poly. Store downloads under `code/public/models/` when we integrate.

## Best tank picks (ready for Three.js)

| Asset | License | Format | Why | Link |
| --- | --- | --- | --- | --- |
| **Quaternius Animated Tank Pack** | CC0 | FBX + **GLB** | Best fit: 4 tanks, animated, Poly Pizza — **stylized / not historical names** | https://poly.pizza/bundle/Animated-Tank-Pack-0tfvbeAJkU |
| Quaternius single Tank | CC0 | FBX/GLTF | Smaller download if one model is enough | https://poly.pizza/m/j59k7ctnZM |
| **Toy Tanks (Artisau)** | CC0 | FBX/OBJ/**GLTF** + projectile | Arcade look; includes bullet mesh | https://aitordsgn.itch.io/toy-tank-3d |
| MrEliptik stylized tank | free (credit asked) | FBX + glTF | Green/BW variants | https://mreliptik.itch.io/free-lowpoly-tank-3d-model |

**Recommendation:** Quaternius Animated Tank Pack (player + future enemies) **or** Toy Tanks if we want a matching shell mesh for firing.

## Historical WWII tanks (Sherman, Panzer, etc.)

Quaternius packs are **generic arcade tanks**, not labeled Sherman/Panzer. For period names, use these instead:

| Asset | Models | License | Format | Notes | Link |
| --- | --- | --- | --- | --- | --- |
| **metaworldos WWII Tank Pack** | **Sherman (M4), Panzer IV, Panther, IS-2** (+ desert MBT) | **CC0** | **GLB** (Draco) | Best historical pack for Three.js; Y-up, +Z forward, 1m; needs `DRACOLoader`; itch zip is **~809 MB** (tanks + lots of props) — prefer grabbing single GLBs from their site viewer | https://metaworldos.itch.io/wwii-tank-pack-glb-models · browse https://metaworldos.com/en/game-assets |
| **Newc42 Low Poly German WWII** | Leichttraktor, **Pz III J**, **Tiger I** | **CC0** | Blender / **FBX** / Unity (convert FBX→GLB in Blender) | Separate turret/gun; tiny downloads (~0.5 MB) | https://newc-42.itch.io/german-low-poly-wwii-tanks |
| **IsolatedSoulStudio Panzer IV** | **Panzer IV** (free sample); full pack also Sherman, T-34, etc. | Name-your-price (free sample) | FBX/DAE → **GLB** | Separate body/turret/barrel + atlas; `pz4.glb` shipped | https://isolatedsoulstudio.itch.io/lowpoly-tank-pack-01 |
| CraftUz Low Poly Tanks | Unclear naming | Royalty-free (check page) | includes GLB | Generic pack; verify which hulls | https://craftuz.itch.io/free-low-poly-tanks-pack |
| CGTrader “Low Poly WW2 Sherman” | Sherman (separable turret) | Royalty Free (not always CC0) | mostly BLEND/FBX | Good topology for games; check licence before ship | https://www.cgtrader.com/free-3d-models/military/military-vehicle/low-poly-ww2-sherman-tank |
| Sketchfab Tiger I (various) | Tiger I | **Often not CC0** | varies | Many free downloads are Standard/CC-BY — read each licence | e.g. search Sketchfab “Tiger I” |

### Historical pick for Steel

1. **Player = Sherman**, enemies later = Panzer IV / Panther — from **metaworldos** (download only the tank GLBs, not the whole 809 MB zip if the site allows per-file).
2. Want a **Tiger** cheaply → **Newc42** FBX → convert to GLB (one Blender export).
3. Keep **Quaternius (A)** only if we stay stylized and don’t care about real names.

**Three.js caveat:** metaworldos GLBs are Draco-compressed → use `GLTFLoader` + `DRACOLoader` (Three.js addons).

### Status 2026-09-05 (Executor)

- Asset page: https://metaworldos.com/en/game-assets/tank-battle-sherman
- License on page: **proprietary** (itch listing previously said CC0 — do not assume)
- `https://metaworldos.com/public/gamecenter/tank-battle/models/sherman.glb` → **404**
- **Steel currently ships a procedural Sherman** + optional drop-in `code/public/models/sherman.glb`


## Map / environment (not full “levels”, but buildable arenas)

| Asset | License | Format | Use | Link |
| --- | --- | --- | --- | --- |
| **Kenney Nature Kit** | CC0 | **GLB** (installed) | Trees, rocks, cliffs, bushes | https://kenney.nl/assets/nature-kit |
| **Kenney Prototype Textures** | CC0 | PNG (installed) | Tiling ground (Green = grass) | https://kenney.nl/assets/prototype-textures |
| **Kenney Road Textures** | CC0 | PNG tilesheet (installed) | Dirt/road patches | https://kenney.nl/assets/road-textures |
| **Kenney Castle Kit** | CC0 | OBJ/FBX/**glTF** | Walls, towers, modular fort arena | https://kenney.nl/assets/castle-kit |
| Polyfork terrain blobs | commercial-ok (no raw resale) | **GLB** + hotlink CDN | Small sand/grass/crater patches | e.g. https://polyfork.dev/asset/sand-terrain-blob-f6255a |
| Poly Pizza (search “terrain”, “battlefield”) | mostly CC0 | GLTF | One-off props / ground pieces | https://poly.pizza |

### Installed 2026-09-05 (Executor)

Under `code/public/assets/kenney/` (~4.6 MB):

- `nature-kit/gltf/` — **329** `.glb` props (rocks, cliffs, trees, plants, bridges)
- `prototype-textures/PNG/` — Dark / Green / Light / Orange / Purple / Red grids
- `road-textures/Tilesheet/` — road tile sheets
- See `code/public/assets/kenney/README.md` for obstacle picks

**Next:** scatter Nature Kit rocks/trees + Green prototype ground for map v1 (Planner layout or Executor stub).

**Recommendation for Steel:** keep procedural arena bounds, dress with **Kenney Nature Kit** + textured ground. Castle Kit optional later for ruins.

## Audio (optional later)

- Kenney UI / impact SFX packs (CC0) — search on https://kenney.nl/assets  
- Freesound — **check licence per file** (often CC-BY)

## Skip / caution

- Kenney “Tanks” pack is **2D sprites**, not 3D.
- Sketchfab: many “free” models are **CC-BY** or non-commercial — read each licence.
- Hotlinking Polyfork CDN is fine for prototypes; for a shippable game, **download into `public/`**.

## Integration notes (when Executor runs)

1. Drop `.glb` into `code/public/models/`.
2. Load with `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.
3. Scale/orient to match our tank (+Z forward, ground Y=0).
4. Keep primitive tank as fallback until load succeeds.
