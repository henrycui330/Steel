# Steel — MVP controls & map

## Controls

| Input | Action |
| --- | --- |
| `W` / ↑ | Accelerate forward |
| `S` / ↓ | Reverse |
| `A` / ← | Turn left |
| `D` / → | Turn right |
| `Shift` / `Ctrl` | Brake (coast if released with no throttle) |
| `1` | Select **HE** (soft targets — blast, almost no pen) |
| `2` | Select **APHE** (armor — high pen) |
| `Space` | Fire chambered round (shell after **0.4s**; tank reload time) |
| `C` | Toggle camera (turret ↔ chase) |
| **Right-click** | Toggle **aim mode** (zoom / gun-sight; click again to exit) |
| **Scroll** | While aiming: zoom in / out (FOV ~14–52°) |
| Mouse | Aim (pointer locked after Deploy; Esc unlocks, click to re-lock) |

**Drive:** accelerates / coasts / brakes; hull **pitches** slightly (nose up on accel, nose down on brake).

**Aim mode:** FOV zooms in, camera pulls closer to the gun, mouse sens drops slightly, vignette on. Scroll adjusts zoom. Does not block drive or fire.
**Ammo:** switching with `1`/`2` starts loading that type. If you do not switch, the gun keeps loading the same round after each shot.

**Crosshairs:** ring = mouse aim impact (ballistic) · gold cross = barrel impact. Camera looks **along aim direction** (gun matches view); impacts may sit slightly below center due to drop.

Barrel **elevation** pitches only the gun; turret body yaws. Mouse moves aim yaw/pitch (FPS-style); gun lags behind.

Fire SFX: `public/sfx/fire.m4a` (audio only; **no video**). Fades out over ~3s.

Movement uses **acceleration** (not instant velocity). Release throttle to **coast**; **Shift/Ctrl** to brake.

On boot: **main menu** — pick Tiger / Pz-III, then Deploy.

## Combat

- SFX plays on fire; shell leaves the muzzle **0.4s** later
- Shells use **ballistics** (gravity arc); hit ground, wall, ~5s lifetime, or **dummy**
- Flat aim at long range drops short — loft the gun to reach far targets
- Crosshairs show predicted **impact points** (not a straight laser)
- **Enemy AI:** darker Pz-III at ~z=58 — drives toward you, fires APHE (~6.5s reload). Same **part armor** as the old dummy:
  - **Hull front** — thick / angled; mostly **ricochet**, **no pen**, or **soft** pens
  - **Hull sides** — thinner; more reliable **hard** pens
  - **Hull rear** — very thin; high damage + **ammo-rack** crits
  - **Turret** — slightly softer than the nose
  - **Turret ring** (hull↔turret gap) — tiny hitbox, catastrophic if you land it
  - **Tracks / gun** — weak but low damage
- Player also has part armor vs AI shells; HP ≤ 0 stops drive/fire (full death FX in F3)
- Penetrations / HE blast chip HP; ricochets bounce the shell; banners show the result
- HUD: player **armor HP**, **reload** countdown, **HE / APHE** selector

## Player tank

| | **Pz-III J** | **Pz-IV** | **Pz-VI Tiger** |
| --- | --- | --- | --- |
| Role | Flanking blitz | Medium workhorse | Heavy breakthrough |
| Speed / turn | Fast, snappy | Mid | Slow, ponderous |
| Reload | **4s** | **5.5s** | **8s** |
| Turret | Quick traverse | Mid | Slower traverse |
| APHE | Weaker | Balanced (long 75) | High pen/dmg |
| HP | **780** | **1050** | **1400** |
| Model | Newc42 | IsolatedSoulStudio | Newc42 |

- Models: `public/models/*.glb`
- Turret cam follows **turret forward** (not hull), mount on yaw pivot

## Map

- **Map 1 — Forest Overwatch:** **150 × 150** bare arena (props/visual FX cleared for rebuild)
- Flat ground + perimeter walls; AI still spawns north (~z=58)
- Asset packs remain on disk under `public/assets/` but are **not** placed

## Camera

- Default: turret cam (above/behind turret along gun yaw)
- **`C`**: toggle turret ↔ chase

## Stack

Vite + TypeScript + Three.js (`code/`)
