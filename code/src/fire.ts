import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'
import { ammoById, cloneAmmoStock, DEFAULT_AMMO_STOCK, type AmmoId, type WeaponId, type AmmoDef, type AmmoStock } from './ammo'
import {
  integrateShell,
  SHELL_GRAVITY,
  SHELL_RADIUS,
  SHELL_SPEED,
  type HeightSampler,
} from './ballistics'
import type { HitResolution, ShellImpact } from './armor'
import { getBarrelDirection } from './aim'
import { playFireSound, playRocketFireSound, playReloadSound, stopReloadSound } from './audio'
import type { DummyTarget } from './dummy'
import { hitsPropCollider, type PropCollider } from './collision'
import { showHitBanner, worldToScreen } from './hitFeedback'
import type { TrackedProjectile } from './impactCinematic'
import { predictLethalHit } from './lethalShot'
import type { GunProfile } from './tankCatalog'
import { spawnExplosion } from './explosions'
import type { HitAnalyzeReport } from './hitAnalyzer'

const SHELL_LIFETIME = 4
const MG_LIFETIME = 1.6
/** Short delay so muzzle flash can play — direction is locked at trigger. */
const SHELL_RELEASE_DELAY = 0.08
const MG_RELEASE_DELAY = 0.02
/** Coax MG cyclic rate (~650 rpm → ~0.09s). */
const MG_COOLDOWN = 0.09
/** Katyusha / rack rockets — 2 rounds per second. */
const MAGAZINE_SHOT_COOLDOWN = 0.5
const MG_RADIUS = 0.045
const MG_SPEED = SHELL_SPEED * 1.05
/** Visible shell length in meters (model is huge Sketchfab units). */
const SHELL_MODEL_LENGTH = 0.55
const SHELL_MODEL_URL = assetUrl('models/88mm_shell.glb')

export type FireHudState = {
  weapon: WeaponId
  chambered: AmmoId | null
  loading: AmmoId
  reloadLeft: number
  reloadTotal: number
  ready: boolean
  /** Rack / magazine rounds left (rocket trucks). */
  magazineLeft?: number
  magazineSize?: number
  /** Remaining HE / APHE / MG rounds (normal guns). */
  stock?: AmmoStock
  /** ATGM carrier — no AP/HE cannon. */
  noMainGun?: boolean
}

type Shell = {
  mesh: THREE.Object3D
  velocity: THREE.Vector3
  age: number
  ammoId: AmmoId
  lifetime: number
  hitRadius: number
  /** False once removed — the kill cam holds the handle past the impact. */
  dead: boolean
  /** The kill cam has already been offered this shell. */
  tracked: boolean
  /** Unspent frame time, carried so every step is exactly SHELL_SUBSTEP. */
  accum: number
  /** Distance budget for aircraft-style rocket smoke trail. */
  trailBudget: number
}

type RocketTrailPuff = {
  mesh: THREE.Mesh
  age: number
  life: number
  drift: THREE.Vector3
}

/** Match Corsair HVAR / aircraft rocket trail feel. */
const ROCKET_TRAIL_SPACING = 3.2
const ROCKET_TRAIL_LIFE = 1.55
const ROCKET_TRAIL_BURST = 2
/** Boom1 — thinner spaced trail for tank AP/HE (shared puff pool). */
const SHELL_TRAIL_SPACING = 5.2
const SHELL_TRAIL_LIFE = 0.95
const SHELL_TRAIL_BURST = 1
const PROJECTILE_MAX_TRAIL = 64

type PendingShot = {
  remaining: number
  ammoId: AmmoId
  dir: THREE.Vector3
}

export type FireSystem = {
  update: (
    dt: number,
    wantsFire: boolean,
    muzzle: THREE.Object3D,
    dummies?: readonly DummyTarget[],
    camera?: THREE.Camera,
    propColliders?: readonly PropCollider[],
  ) => boolean
  setReloadSec: (sec: number) => void
  /**
   * Salvo / rack mode (Katyusha): fire with no per-shot cooldown until empty,
   * then restock for `reloadSec`. Pass size 0 to return to normal chambered gun.
   */
  setMagazine: (size: number, restockSec?: number) => void
  isMagazineMode: () => boolean
  /** Disable cannon shells (MG + external ATGM only). */
  setNoMainGun: (on: boolean) => void
  /** Replace HE/AP/MG racks (mission start / respawn). */
  setAmmoStock: (stock: AmmoStock) => void
  getAmmoStock: () => AmmoStock
  setGunProfile: (profile: GunProfile) => void
  setPlayableBounds: (bounds: { x: number; z: number }) => void
  /** @deprecated use setPlayableBounds */
  setPlayableHalf: (half: number) => void
  setHeightAt: (fn: HeightSampler | null) => void
  selectAmmo: (id: AmmoId) => void
  setWeapon: (id: WeaponId) => void
  toggleWeapon: () => void
  getWeapon: () => WeaponId
  getHudState: () => FireHudState
  /** Called when a player shell destroys a target (victim root). */
  setOnKill: (fn: ((victim: THREE.Object3D) => void) | null) => void
  /**
   * Armor hit analyzer — main gun / rockets (not MG). Pass null to clear.
   */
  setOnHitAnalyze: (fn: ((report: HitAnalyzeReport) => void) | null) => void
  /**
   * Called once for a shell in flight that is predicted to destroy what it is
   * about to hit — the kill cam's cue. Fires with `KILL_CAM_LEAD` to run.
   */
  setOnLethalShot: (fn: ((shot: TrackedProjectile) => void) | null) => void
  /**
   * Crew voice hooks — beginLoad / chamber complete (main gun only).
   */
  setVoiceHooks: (
    hooks: {
      onBeginLoad?: (id: AmmoId) => void
      onChambered?: (id: AmmoId) => void
      /** Main-gun damaging hit on an enemy (pen/blast/kill) — not ricochet / no-pen / miss. */
      onEnemyHit?: () => void
    } | null,
  ) => void
  dispose: () => void
}

/** How much of a shell's flight the kill cam gets, in sim seconds. */
const KILL_CAM_LEAD = 0.45
/**
 * Shells advance in fixed steps with the remainder carried between frames,
 * never in one variable-sized frame step.
 *
 * Hits are point samples against the armour volumes, so the step size decides
 * which plate a shell can land on: a whole 60 fps frame is ~3 m of travel at
 * 180 u/s, wide enough to skip straight over a 1.6 m-deep rear plate, and a
 * frame-time wobble was enough to turn a penetration into a bounce. Fixed
 * steps make a given shot resolve the same way on any machine, and let the
 * kill cam's look-ahead march the exact sample sequence the shell will follow.
 */
const SHELL_SUBSTEP = 1 / 120

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _look = new THREE.Vector3()
  const _sparkPos = new THREE.Vector3()
  const _localHit = new THREE.Vector3()
  const _localDir = new THREE.Vector3()
  const _invTarget = new THREE.Matrix4()

/** Align long axis to −Z (Three.js lookAt forward) and scale to game size. */
function prepareShellModel(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'shell88Template'
  const model = scene.clone(true)
  // Authored long on +X → map to −Z for lookAt.
  model.rotation.y = Math.PI / 2
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  const len = Math.max(size.x, size.y, size.z, 0.001)
  wrap.scale.setScalar(SHELL_MODEL_LENGTH / len)
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const center = box2.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.geometry?.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) m?.dispose()
  })
}

/**
 * Shell leave direction = **barrel** axis (not mouse aim).
 * Turret lag is real — wait for sync or lead with the ghost reticle.
 */
function aimDirFromMuzzle(
  _muzzle: THREE.Object3D,
  _camera: THREE.Camera | undefined,
  out: THREE.Vector3,
): THREE.Vector3 {
  return getBarrelDirection(out)
}

function flashSpark(scene: THREE.Scene, pos: THREE.Vector3, color: number, scale = 1): void {
  const geo = new THREE.SphereGeometry(0.18 * scale, 6, 6)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(pos)
  scene.add(mesh)
  const t0 = performance.now()
  const tick = (now: number): void => {
    const u = (now - t0) / 220
    if (u >= 1) {
      scene.remove(mesh)
      geo.dispose()
      mat.dispose()
      return
    }
    mesh.scale.setScalar(1 + u * 2.2)
    mat.opacity = 1 - u
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function createFireSystem(
  scene: THREE.Scene,
  initialPlayableHalf: number,
  reloadSec = 4,
): FireSystem {
  const shells: Shell[] = []
  const rocketTrails: RocketTrailPuff[] = []
  const mgGeometry = new THREE.SphereGeometry(MG_RADIUS, 6, 6)
  // Same silhouette / materials as aircraftRockets (Corsair HVAR).
  const rocketBodyGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.15, 6)
  rocketBodyGeo.rotateX(Math.PI / 2)
  const rocketTipGeo = new THREE.ConeGeometry(0.09, 0.28, 6)
  rocketTipGeo.rotateX(Math.PI / 2)
  const rocketBodyMat = new THREE.MeshStandardMaterial({
    color: 0x6a6e62,
    roughness: 0.55,
    metalness: 0.45,
  })
  const rocketTipMat = new THREE.MeshStandardMaterial({
    color: 0xc4a35a,
    roughness: 0.4,
    metalness: 0.5,
    emissive: 0x3a2808,
    emissiveIntensity: 0.35,
  })
  const rocketTrailGeo = new THREE.SphereGeometry(0.62, 6, 6)
  const rocketTrailSmokeMat = new THREE.MeshBasicMaterial({
    color: 0xb8b4aa,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  })
  const rocketTrailHotMat = new THREE.MeshBasicMaterial({
    color: 0xff9030,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  })
  /** Cooler / thinner trail for AP; HE can use a warm tint. */
  const shellTrailSmokeMat = new THREE.MeshBasicMaterial({
    color: 0xc8c4b8,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  })
  const shellTrailHotMat = new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })

  console.info(`[Steel] Boom1 · gravity=${SHELL_GRAVITY} · AP/HE trail`)

  const _rocketBack = new THREE.Vector3()
  const _rocketSide = new THREE.Vector3()
  let shellTemplate: THREE.Group | null = null
  let shellTemplateFailed = false
  void loadGltfCached(SHELL_MODEL_URL)
    .then((gltf) => {
      shellTemplate = prepareShellModel(gltf.scene)
      console.info('[Steel] 88mm shell model ready')
    })
    .catch((err) => {
      shellTemplateFailed = true
      console.warn('[Steel] 88mm shell GLB failed — sphere fallback', err)
    })

  let playable = { x: initialPlayableHalf, z: initialPlayableHalf }
  let heightAt: HeightSampler | null = null
  let cooldown = 0
  let cooldownMax = reloadSec
  let pending: PendingShot | null = null
  let loading: AmmoId = 'aphe'
  let chambered: AmmoId | null = 'aphe'
  let weapon: WeaponId = 'main'
  let mgCooldown = 0
  /** 0 = normal single-shot gun; >0 = rack salvo (no HE/APHE switch). */
  let magazineSize = 0
  let magazineLeft = 0
  let magazineRestock = reloadSec
  let magazineShotCooldown = 0
  /** ATGM carriers — cannon disabled; coax only. */
  let noMainGun = false
  let stock: AmmoStock = cloneAmmoStock(DEFAULT_AMMO_STOCK)
  let onKill: ((victim: THREE.Object3D) => void) | null = null
  let onHitAnalyze: ((report: HitAnalyzeReport) => void) | null = null
  let onLethalShot: ((shot: TrackedProjectile) => void) | null = null
  let voiceHooks: {
    onBeginLoad?: (id: AmmoId) => void
    onChambered?: (id: AmmoId) => void
    onEnemyHit?: () => void
  } | null = null
  let gun: GunProfile = {
    aphePen: 120,
    apheDmg: 320,
    hePen: 16,
    heDmg: 80,
    heBlast: 140,
    traverseRadPerSec: 6.5,
    elevateRadPerSec: 4.5,
    apLabel: 'AP',
    heLabel: 'HE',
  }

  function effectiveAmmo(def: AmmoDef): {
    penetration: number
    penDamage: number
    blastDamage: number
  } {
    if (def.id === 'mg') {
      return {
        penetration: def.penetration,
        penDamage: def.penDamage,
        blastDamage: 0,
      }
    }
    if (def.id === 'aphe') {
      return {
        penetration: gun.aphePen,
        penDamage: gun.apheDmg,
        blastDamage: 0,
      }
    }
    return {
      penetration: gun.hePen,
      penDamage: gun.heDmg,
      blastDamage: gun.heBlast,
    }
  }

  function beginLoad(id: AmmoId): void {
    if (id === 'mg') return
    if (magazineSize > 0) return
    loading = id
    chambered = null
    if (stock[id] <= 0) {
      cooldown = 0
      stopReloadSound()
      console.info(
        `[Steel] ${id === 'aphe' ? (gun.apLabel ?? 'AP') : (gun.heLabel ?? 'HE')} EMPTY`,
      )
      return
    }
    cooldown = cooldownMax
    console.info(
      `[Steel] Loading ${id === 'aphe' ? (gun.apLabel ?? 'AP') : (gun.heLabel ?? 'HE')} (${cooldownMax.toFixed(1)}s) · ${stock[id]} left`,
    )
    // Mechanical reload under crew callouts — skip SPAAG / burst guns
    if (cooldownMax >= 1.8) playReloadSound()
    else stopReloadSound()
    voiceHooks?.onBeginLoad?.(id)
  }

  function beginMagazineRestock(): void {
    chambered = null
    cooldown = magazineRestock
    cooldownMax = magazineRestock
    loading = 'he'
    console.info(`[Steel] Rocket rack empty — restocking (${magazineRestock.toFixed(1)}s)`)
    // No breech reload VO / SFX — rockets restock silently.
    stopReloadSound()
  }

  function finishMagazineRestock(): void {
    magazineLeft = magazineSize
    chambered = 'he'
    loading = 'he'
    stopReloadSound()
    console.info(`[Steel] Rocket rack READY · ${magazineLeft}/${magazineSize}`)
  }

  function killRocketTrail(p: RocketTrailPuff): void {
    scene.remove(p.mesh)
    ;(p.mesh.material as THREE.Material).dispose()
  }

  function emitRocketTrail(shell: Shell, hot: boolean): void {
    while (rocketTrails.length >= PROJECTILE_MAX_TRAIL) {
      killRocketTrail(rocketTrails[0]!)
      rocketTrails.shift()
    }
    _rocketBack.copy(shell.velocity)
    if (_rocketBack.lengthSq() < 1e-8) _rocketBack.set(0, 0, -1)
    else _rocketBack.normalize().multiplyScalar(-1)
    _rocketSide.set(_rocketBack.z, 0, -_rocketBack.x)
    if (_rocketSide.lengthSq() < 1e-8) _rocketSide.set(1, 0, 0)
    else _rocketSide.normalize()

    for (let i = 0; i < ROCKET_TRAIL_BURST; i++) {
      if (rocketTrails.length >= PROJECTILE_MAX_TRAIL) break
      const matInst = (hot ? rocketTrailHotMat : rocketTrailSmokeMat).clone()
      const mesh = new THREE.Mesh(rocketTrailGeo, matInst)
      const aft = 0.55 + Math.random() * 1.2 + i * 0.4
      const spray = (Math.random() - 0.5) * 1.4
      mesh.position
        .copy(shell.mesh.position)
        .addScaledVector(_rocketBack, aft)
        .addScaledVector(_rocketSide, spray)
      mesh.position.y += (Math.random() - 0.3) * 0.55
      mesh.scale.setScalar((hot ? 0.65 : 1.05) + Math.random() * 0.85)
      mesh.frustumCulled = true
      scene.add(mesh)

      const drift = _rocketBack
        .clone()
        .multiplyScalar(1.8 + Math.random() * 3.5)
        .addScaledVector(_rocketSide, (Math.random() - 0.5) * 2.8)
      drift.y += 0.5 + Math.random() * 1.8

      rocketTrails.push({
        mesh,
        age: 0,
        life: ROCKET_TRAIL_LIFE * (0.7 + Math.random() * 0.45),
        drift,
      })
    }
  }

  /** Boom1 — lighter aft smoke for tank AP/HE (not MG). */
  function emitShellTrail(shell: Shell, hot: boolean): void {
    while (rocketTrails.length >= PROJECTILE_MAX_TRAIL) {
      killRocketTrail(rocketTrails[0]!)
      rocketTrails.shift()
    }
    _rocketBack.copy(shell.velocity)
    if (_rocketBack.lengthSq() < 1e-8) _rocketBack.set(0, 0, -1)
    else _rocketBack.normalize().multiplyScalar(-1)
    _rocketSide.set(_rocketBack.z, 0, -_rocketBack.x)
    if (_rocketSide.lengthSq() < 1e-8) _rocketSide.set(1, 0, 0)
    else _rocketSide.normalize()

    for (let i = 0; i < SHELL_TRAIL_BURST; i++) {
      if (rocketTrails.length >= PROJECTILE_MAX_TRAIL) break
      const matInst = (hot ? shellTrailHotMat : shellTrailSmokeMat).clone()
      const mesh = new THREE.Mesh(rocketTrailGeo, matInst)
      const aft = 0.35 + Math.random() * 0.55
      const spray = (Math.random() - 0.5) * 0.35
      mesh.position
        .copy(shell.mesh.position)
        .addScaledVector(_rocketBack, aft)
        .addScaledVector(_rocketSide, spray)
      mesh.position.y += (Math.random() - 0.4) * 0.2
      mesh.scale.setScalar((hot ? 0.28 : 0.38) + Math.random() * 0.22)
      mesh.frustumCulled = true
      scene.add(mesh)

      const drift = _rocketBack
        .clone()
        .multiplyScalar(0.6 + Math.random() * 1.2)
        .addScaledVector(_rocketSide, (Math.random() - 0.5) * 0.8)
      drift.y += 0.15 + Math.random() * 0.45

      rocketTrails.push({
        mesh,
        age: 0,
        life: SHELL_TRAIL_LIFE * (0.75 + Math.random() * 0.35),
        drift,
      })
    }
  }

  function updateRocketTrails(dt: number): void {
    for (const p of rocketTrails) {
      p.age += dt
      p.mesh.position.addScaledVector(p.drift, dt)
      p.drift.multiplyScalar(Math.exp(-0.5 * dt))
      p.drift.y += 2.1 * dt
      const fade = 1 - p.age / p.life
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, fade * fade * 0.7)
      p.mesh.scale.multiplyScalar(1 + 0.7 * dt)
    }
    for (let i = rocketTrails.length - 1; i >= 0; i--) {
      if (rocketTrails[i]!.age >= rocketTrails[i]!.life) {
        killRocketTrail(rocketTrails[i]!)
        rocketTrails.splice(i, 1)
      }
    }
  }

  function makeRocketMesh(): THREE.Object3D {
    const root = new THREE.Group()
    root.name = 'rocket'
    const body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat.clone())
    body.castShadow = true
    const tip = new THREE.Mesh(rocketTipGeo, rocketTipMat.clone())
    tip.position.z = 0.65
    tip.castShadow = true
    root.add(body, tip)
    return root
  }

  function detonateRocket(at: THREE.Vector3): void {
    spawnExplosion({ scene, at, radius: 14, kind: 'rocket' })
  }

  function makeMainShellMesh(ammoId: AmmoId): THREE.Object3D {
    if (shellTemplate) {
      const clone = shellTemplate.clone(true)
      clone.name = 'shell'
      clone.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true
          obj.frustumCulled = false
        }
      })
      return clone
    }
    const def = ammoById(ammoId)
    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.6,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SHELL_RADIUS, 10, 10), material)
    mesh.name = 'shell'
    mesh.castShadow = true
    return mesh
  }

  function spawnShell(muzzle: THREE.Object3D, ammoId: AmmoId, dir: THREE.Vector3): void {
    const isMg = ammoId === 'mg'
    const isRocket = !isMg && magazineSize > 0
    let mesh: THREE.Object3D
    if (isMg) {
      const def = ammoById(ammoId)
      const material = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        metalness: 0.6,
      })
      mesh = new THREE.Mesh(mgGeometry, material)
      mesh.name = 'mgTracer'
      mesh.castShadow = false
    } else if (isRocket) {
      mesh = makeRocketMesh()
    } else {
      mesh = makeMainShellMesh(ammoId)
      if (!shellTemplate && !shellTemplateFailed) {
        // Model still loading — sphere is fine for this shot
      }
    }

    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_origin)
    _dir.copy(dir).normalize()

    mesh.position.copy(_origin).addScaledVector(_dir, isMg ? 0.5 : isRocket ? 0.7 : 0.35)
    const speed = isMg ? MG_SPEED : isRocket ? SHELL_SPEED * 0.82 : SHELL_SPEED
    const velocity = _dir.clone().multiplyScalar(speed)
    scene.add(mesh)
    const shell: Shell = {
      mesh,
      velocity,
      age: 0,
      ammoId,
      lifetime: isMg ? MG_LIFETIME : isRocket ? 5.2 : SHELL_LIFETIME,
      hitRadius: isMg ? MG_RADIUS : isRocket ? 0.35 : SHELL_RADIUS,
      dead: false,
      tracked: false,
      accum: 0,
      trailBudget: 0,
    }
    shells.push(shell)
    if (isRocket) {
      emitRocketTrail(shell, true)
      emitRocketTrail(shell, true)
    } else if (!isMg) {
      // Boom1 — one muzzle puff so the shell path reads immediately.
      emitShellTrail(shell, shell.ammoId === 'he')
    }
  }

  function removeAt(index: number): void {
    const shell = shells[index]
    shell.dead = true
    scene.remove(shell.mesh)
    if (shell.mesh.name === 'rocket') {
      shell.mesh.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        // Shared geos — only dispose cloned materials.
        const m = o.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
      })
      shells.splice(index, 1)
      return
    }
    // MG / sphere fallback own their materials; GLB clones share template geo — don't dispose.
    if (shell.mesh instanceof THREE.Mesh) {
      const shared = shellTemplate !== null && shell.ammoId !== 'mg'
      if (!shared) {
        if (shell.mesh.geometry && shell.mesh.geometry !== mgGeometry) {
          shell.mesh.geometry.dispose()
        }
        if (shell.mesh.material instanceof THREE.Material) shell.mesh.material.dispose()
      }
    }
    shells.splice(index, 1)
  }

  function outOfBounds(pos: THREE.Vector3): boolean {
    return (
      Math.abs(pos.x) > playable.x - SHELL_RADIUS ||
      Math.abs(pos.z) > playable.z - SHELL_RADIUS ||
      pos.y > 80
    )
  }

  function hitGround(pos: THREE.Vector3, radius: number): boolean {
    const gy = (heightAt ? heightAt(pos.x, pos.z) : 0) + radius
    if (pos.y <= gy) {
      pos.y = gy
      return true
    }
    return false
  }

  function bannerFor(
    camera: THREE.Camera | undefined,
    pos: THREE.Vector3,
    text: string,
    kind: Parameters<typeof showHitBanner>[1],
  ): void {
    if (!camera) return
    const s = worldToScreen(pos, camera)
    if (s.visible) showHitBanner(text, kind, s.x, s.y - 28)
  }

  function shellStatsFor(ammoId: AmmoId): Omit<ShellImpact, 'speed'> {
    const eff = effectiveAmmo(ammoById(ammoId))
    return {
      basePenetration: eff.penetration,
      baseDamage: eff.penDamage,
      blastDamage: eff.blastDamage,
    }
  }

  function ammoLabelFor(ammoId: AmmoId): string {
    if (ammoId === 'mg') return 'MG'
    if (magazineSize > 0) return gun.heLabel ?? 'Rocket'
    if (ammoId === 'aphe') return gun.apLabel ?? 'AP'
    return gun.heLabel ?? 'HE'
  }

  function reportHitAnalyze(
    target: DummyTarget,
    resolution: HitResolution,
    destroyed: boolean,
    tracksDisabled: boolean | undefined,
    ammoId: AmmoId,
    hpAfter: number,
    worldHit: THREE.Vector3,
    worldVel: THREE.Vector3,
  ): void {
    if (!onHitAnalyze || ammoId === 'mg') return
    let outcome: HitAnalyzeReport['outcome'] = resolution.kind
    if (destroyed) outcome = resolution.crit ? 'crit' : 'kill'
    target.root.updateMatrixWorld(true)
    _invTarget.copy(target.root.matrixWorld).invert()
    _localHit.copy(worldHit).applyMatrix4(_invTarget)
    _localDir.copy(worldVel).transformDirection(_invTarget)
    if (_localDir.lengthSq() > 1e-8) _localDir.normalize()
    else _localDir.set(0, 0, 1)
    onHitAnalyze({
      targetRoot: target.root,
      localHit: _localHit.clone(),
      localDir: _localDir.clone(),
      partId: resolution.part.id,
      targetName:
        (typeof target.root.userData?.displayName === 'string' &&
          target.root.userData.displayName) ||
        target.root.name ||
        'Enemy',
      ammoLabel: ammoLabelFor(ammoId),
      outcome,
      partLabel: resolution.part.label,
      damage: resolution.damage,
      penetration: resolution.penetration,
      effectiveArmor: resolution.effectiveArmor,
      angleDeg: resolution.angleDeg,
      hp: hpAfter,
      maxHp: target.maxHp,
      tracksDisabled: !!tracksDisabled,
    })
  }

  function processDummyHits(
    shell: Shell,
    shellIndex: number,
    dummies: readonly DummyTarget[] | undefined,
    camera: THREE.Camera | undefined,
  ): boolean {
    if (!dummies) return false
    const stats = shellStatsFor(shell.ammoId)

    for (const d of dummies) {
      if (!d.containsPoint(shell.mesh.position)) continue
      const result = d.resolveShellHit(shell.mesh.position, shell.velocity, stats, {
        ammoId: shell.ammoId,
      })
      if (!result) continue

      const { resolution, destroyed, tracksDisabled, hp } = result
      _sparkPos.copy(shell.mesh.position)
      const isMg = shell.ammoId === 'mg'
      if (destroyed) onKill?.(d.root)
      reportHitAnalyze(
        d,
        resolution,
        destroyed,
        tracksDisabled,
        shell.ammoId,
        hp,
        shell.mesh.position,
        shell.velocity,
      )
      if (resolution.kind === 'ricochet') {
        flashSpark(scene, _sparkPos, 0xe8e8e8, isMg ? 0.45 : 1)
        if (!isMg) {
          bannerFor(camera, _sparkPos, `RICOCHET · ${resolution.part.label}`, 'ricochet')
        }
        shell.velocity.reflect(resolution.normal)
        shell.velocity.multiplyScalar(0.55)
        shell.mesh.position.addScaledVector(resolution.normal, 0.35)
        return false
      }

      if (resolution.kind === 'stopped') {
        flashSpark(scene, _sparkPos, 0xc4a35a, isMg ? 0.4 : 1)
        if (!isMg) {
          bannerFor(camera, _sparkPos, `NO PEN · ${resolution.part.label}`, 'stopped')
        }
        removeAt(shellIndex)
        return true
      }

      if (resolution.kind === 'blast') {
        const isRocket = shell.mesh.name === 'rocket'
        spawnExplosion({
          scene,
          at: _sparkPos,
          radius: destroyed ? 14 : isRocket ? 12 : 7,
          kind: destroyed ? 'kill' : isRocket ? 'rocket' : 'he',
        })
        if (destroyed) {
          bannerFor(camera, _sparkPos, isRocket ? 'KILL · RKT' : 'KILL · HE', 'kill')
        } else {
          bannerFor(
            camera,
            _sparkPos,
            `${isRocket ? 'RKT' : 'HE'} BLAST −${resolution.damage} · ${resolution.part.label}`,
            'blast',
          )
        }
        if (!isMg) voiceHooks?.onEnemyHit?.()
        removeAt(shellIndex)
        return true
      }

      if (destroyed && !isMg) {
        spawnExplosion({
          scene,
          at: _sparkPos,
          radius: resolution.crit ? 14 : 9,
          kind: 'kill',
        })
      } else {
        flashSpark(scene, _sparkPos, destroyed ? 0xff4422 : 0xffcc66, isMg ? 0.5 : 1)
      }
      if (destroyed) {
        bannerFor(
          camera,
          _sparkPos,
          resolution.crit
            ? `AMMO RACK · ${resolution.part.label}`
            : isMg
              ? 'KILL · MG'
              : 'KILL',
          resolution.crit ? 'crit' : 'kill',
        )
      } else if (tracksDisabled) {
        bannerFor(camera, _sparkPos, 'TRACKS OUT · 30s', 'pen')
      } else if (!isMg) {
        bannerFor(
          camera,
          _sparkPos,
          `PEN −${resolution.damage} · ${resolution.part.label}`,
          'pen',
        )
      }
      if (!isMg) voiceHooks?.onEnemyHit?.()
      removeAt(shellIndex)
      return true
    }
    return false
  }

  return {
    setReloadSec(sec) {
      cooldownMax = sec
      if (magazineSize > 0) magazineRestock = sec
    },
    setMagazine(size, restockSec) {
      magazineSize = Math.max(0, Math.floor(size))
      if (magazineSize > 0) {
        magazineRestock = restockSec ?? cooldownMax
        magazineLeft = magazineSize
        loading = 'he'
        chambered = 'he'
        cooldown = 0
        magazineShotCooldown = 0
        pending = null
        weapon = 'main'
        stopReloadSound()
        console.info(
          `[Steel] Magazine rack · ${magazineLeft}/${magazineSize} · restock ${magazineRestock.toFixed(1)}s`,
        )
      } else {
        magazineLeft = 0
      }
    },
    isMagazineMode() {
      return magazineSize > 0
    },
    setNoMainGun(on) {
      noMainGun = !!on
      if (noMainGun) {
        weapon = 'mg'
        chambered = null
        pending = null
        stopReloadSound()
        console.info('[Steel] Main gun disabled — MG + ATGM only')
      }
    },
    setAmmoStock(next) {
      stock = cloneAmmoStock(next)
      // Re-seat a chambered main round if stock allows; otherwise go dry.
      if (magazineSize <= 0) {
        pending = null
        if (noMainGun) {
          weapon = 'mg'
          chambered = null
          cooldown = 0
          stopReloadSound()
        } else if (weapon === 'main') {
          const prefer = chambered && chambered !== 'mg' ? chambered : loading
          if (prefer !== 'mg' && stock[prefer] > 0) {
            loading = prefer
            chambered = prefer
            cooldown = 0
            stopReloadSound()
          } else if (stock.aphe > 0) {
            loading = 'aphe'
            chambered = 'aphe'
            cooldown = 0
          } else if (stock.he > 0) {
            loading = 'he'
            chambered = 'he'
            cooldown = 0
          } else {
            chambered = null
            cooldown = 0
          }
        }
      }
      console.info(
        `[Steel] Ammo racks · HE ${stock.he} · AP ${stock.aphe} · MG ${stock.mg}`,
      )
    },
    getAmmoStock() {
      return cloneAmmoStock(stock)
    },
    setGunProfile(profile) {
      gun = profile
    },
    setPlayableBounds(bounds) {
      playable = { x: bounds.x, z: bounds.z }
    },
    setPlayableHalf(half) {
      playable = { x: half, z: half }
    },
    setHeightAt(fn) {
      heightAt = fn
    },
    setWeapon(id) {
      if (magazineSize > 0 && id === 'mg') return
      if (noMainGun && id === 'main') {
        weapon = 'mg'
        return
      }
      if (weapon === id) return
      weapon = id
      pending = null
      if (id === 'mg') stopReloadSound()
      console.info(`[Steel] Weapon → ${id === 'mg' ? 'MACHINE GUN' : 'MAIN GUN'}`)
    },
    toggleWeapon() {
      if (magazineSize > 0 || noMainGun) return
      this.setWeapon(weapon === 'main' ? 'mg' : 'main')
    },
    getWeapon() {
      return weapon
    },
    setOnKill(fn) {
      onKill = fn
    },
    setOnHitAnalyze(fn) {
      onHitAnalyze = fn
    },
    setOnLethalShot(fn) {
      onLethalShot = fn
    },
    setVoiceHooks(hooks) {
      voiceHooks = hooks
    },
    selectAmmo(id) {
      if (magazineSize > 0) return
      if (noMainGun) {
        this.setWeapon('mg')
        return
      }
      if (id === 'mg') {
        this.setWeapon('mg')
        return
      }
      this.setWeapon('main')
      if (loading === id && (chambered === id || chambered === null)) {
        loading = id
        return
      }
      if (chambered === id && cooldown <= 0) {
        loading = id
        return
      }
      beginLoad(id)
    },
    getHudState() {
      if (weapon === 'mg') {
        return {
          weapon,
          chambered: 'mg',
          loading: loading === 'mg' ? 'aphe' : loading,
          reloadLeft: mgCooldown,
          reloadTotal: MG_COOLDOWN,
          ready: mgCooldown <= 0 && pending === null && stock.mg > 0,
          stock: cloneAmmoStock(stock),
          noMainGun,
        }
      }
      if (magazineSize > 0) {
        const restocking = magazineLeft <= 0 && cooldown > 0
        return {
          weapon,
          chambered: magazineLeft > 0 ? 'he' : null,
          loading: 'he',
          reloadLeft: Math.max(0, restocking ? cooldown : magazineShotCooldown),
          reloadTotal: restocking ? magazineRestock : MAGAZINE_SHOT_COOLDOWN,
          ready:
            magazineLeft > 0 &&
            cooldown <= 0 &&
            magazineShotCooldown <= 0 &&
            pending === null,
          magazineLeft,
          magazineSize,
          stock: cloneAmmoStock(stock),
        }
      }
      return {
        weapon,
        chambered,
        loading,
        reloadLeft: Math.max(0, cooldown),
        reloadTotal: cooldownMax,
        ready: chambered !== null && cooldown <= 0 && pending === null,
        stock: cloneAmmoStock(stock),
        noMainGun,
      }
    },
    update(dt, wantsFire, muzzle, dummies, camera, propColliders) {
      if (cooldown > 0) {
        cooldown = Math.max(0, cooldown - dt)
        if (cooldown <= 0 && chambered === null) {
          if (magazineSize > 0) {
            finishMagazineRestock()
          } else if (stock[loading] <= 0) {
            stopReloadSound()
            // Stay dry — HUD shows EMPTY via stock + null chambered
          } else {
            chambered = loading
            stopReloadSound()
            console.info(
              `[Steel] ${chambered === 'aphe' ? (gun.apLabel ?? 'AP') : (gun.heLabel ?? 'HE')} READY · ${stock[chambered]} left`,
            )
            voiceHooks?.onChambered?.(chambered)
          }
        }
      }
      if (mgCooldown > 0) mgCooldown = Math.max(0, mgCooldown - dt)
      if (magazineShotCooldown > 0) {
        magazineShotCooldown = Math.max(0, magazineShotCooldown - dt)
      }
      let triggered = false

      if (weapon === 'mg') {
        if (wantsFire && mgCooldown <= 0 && pending === null && stock.mg > 0) {
          playRocketFireSound()
          pending = {
            remaining: MG_RELEASE_DELAY,
            ammoId: 'mg',
            dir: aimDirFromMuzzle(muzzle, camera, new THREE.Vector3()),
          }
          stock.mg--
          mgCooldown = MG_COOLDOWN
          triggered = true
          if (stock.mg <= 0) {
            console.info('[Steel] MG belt EMPTY')
          }
        }
      } else if (magazineSize > 0) {
        // Rack salvo at 2 rps until empty, then restock.
        if (
          wantsFire &&
          magazineLeft > 0 &&
          cooldown <= 0 &&
          magazineShotCooldown <= 0 &&
          pending === null
        ) {
          playRocketFireSound()
          pending = {
            remaining: MG_RELEASE_DELAY,
            ammoId: 'he',
            dir: aimDirFromMuzzle(muzzle, camera, new THREE.Vector3()),
          }
          magazineLeft--
          magazineShotCooldown = MAGAZINE_SHOT_COOLDOWN
          triggered = true
          if (magazineLeft <= 0) beginMagazineRestock()
        }
      } else if (
        !noMainGun &&
        wantsFire &&
        chambered !== null &&
        cooldown <= 0 &&
        pending === null
      ) {
        const fired = chambered
        if (stock[fired] <= 0) {
          chambered = null
          beginLoad(loading)
        } else {
          playFireSound()
          pending = {
            remaining: SHELL_RELEASE_DELAY,
            ammoId: fired,
            dir: aimDirFromMuzzle(muzzle, camera, new THREE.Vector3()),
          }
          stock[fired]--
          chambered = null
          beginLoad(loading)
          triggered = true
        }
      }

      if (pending) {
        pending.remaining -= dt
        if (pending.remaining <= 0) {
          spawnShell(muzzle, pending.ammoId, pending.dir)
          pending = null
        }
      }

      for (let i = shells.length - 1; i >= 0; i--) {
        const shell = shells[i]
        shell.age += dt
        shell.accum += dt
        const isRocket = shell.mesh.name === 'rocket'
        const wantsTrail = isRocket || shell.ammoId !== 'mg'
        let stepDist = 0

        let removed = false
        while (shell.accum >= SHELL_SUBSTEP) {
          shell.accum -= SHELL_SUBSTEP
          integrateShell(shell.mesh.position, shell.velocity, SHELL_SUBSTEP)
          if (wantsTrail) stepDist += shell.velocity.length() * SHELL_SUBSTEP

          if (hitGround(shell.mesh.position, shell.hitRadius)) {
            if (isRocket) detonateRocket(shell.mesh.position)
            removeAt(i)
            removed = true
            break
          }

          // A ricochet returns false: the round lives on with a reflected
          // velocity, so keep stepping it through the rest of the frame.
          if (processDummyHits(shell, i, dummies, camera)) {
            removed = true
            break
          }

          if (
            propColliders &&
            propColliders.length > 0 &&
            hitsPropCollider(shell.mesh.position, propColliders, shell.hitRadius)
          ) {
            if (isRocket) detonateRocket(shell.mesh.position)
            else flashSpark(scene, shell.mesh.position, 0xb0a080, shell.ammoId === 'mg' ? 0.4 : 1)
            removeAt(i)
            removed = true
            break
          }
        }
        if (removed) continue

        if (wantsTrail && stepDist > 0) {
          shell.trailBudget += stepDist
          if (isRocket) {
            while (shell.trailBudget >= ROCKET_TRAIL_SPACING) {
              shell.trailBudget -= ROCKET_TRAIL_SPACING
              emitRocketTrail(shell, Math.random() < 0.4)
            }
          } else {
            while (shell.trailBudget >= SHELL_TRAIL_SPACING) {
              shell.trailBudget -= SHELL_TRAIL_SPACING
              emitShellTrail(shell, shell.ammoId === 'he' && Math.random() < 0.35)
            }
          }
        }

        if (shell.velocity.lengthSq() > 1e-4) {
          _look.copy(shell.mesh.position).add(shell.velocity)
          shell.mesh.lookAt(_look)
        }

        if (shell.age >= shell.lifetime || outOfBounds(shell.mesh.position)) {
          removeAt(i)
          continue
        }

        // Kill cam cue. MG rounds are excluded: a burst would re-trigger on
        // every round in the air, and a fatal .30 cal is a fluke, not a shot.
        if (onLethalShot && !shell.tracked && shell.ammoId !== 'mg' && dummies) {
          const lethal = predictLethalHit({
            position: shell.mesh.position,
            velocity: shell.velocity,
            hitRadius: shell.hitRadius,
            stats: shellStatsFor(shell.ammoId),
            targets: dummies,
            dt: SHELL_SUBSTEP,
            horizon: KILL_CAM_LEAD,
            heightAt,
            blockers: propColliders,
          })
          if (lethal) {
            shell.tracked = true
            onLethalShot({
              position: shell.mesh.position,
              impact: lethal.point,
              flightTime: lethal.time,
              live: () => !shell.dead,
            })
          }
        }
      }

      updateRocketTrails(dt)

      return triggered
    },
    dispose() {
      pending = null
      stopReloadSound()
      for (let i = shells.length - 1; i >= 0; i--) removeAt(i)
      for (let i = rocketTrails.length - 1; i >= 0; i--) {
        killRocketTrail(rocketTrails[i]!)
      }
      rocketTrails.length = 0
      mgGeometry.dispose()
      rocketBodyGeo.dispose()
      rocketTipGeo.dispose()
      rocketBodyMat.dispose()
      rocketTipMat.dispose()
      rocketTrailGeo.dispose()
      rocketTrailSmokeMat.dispose()
      rocketTrailHotMat.dispose()
      shellTrailSmokeMat.dispose()
      shellTrailHotMat.dispose()
      if (shellTemplate) {
        disposeObject(shellTemplate)
        shellTemplate = null
      }
    },
  }
}