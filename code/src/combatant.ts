import * as THREE from 'three'
import type { AmmoId } from './ammo'
import type { ArmorPartDef, ArmorPartId, HitResolution, ShellImpact } from './armor'
import { createTankHitVolumes } from './hitParts'
import {
  createModuleKit,
  moduleForArmorPart,
  resetModuleKit,
  type ModuleId,
  type ModuleKit,
  type ModuleState,
} from './modules'

export const TRACK_DISABLE_SEC = 30

export type ShellHitContext = {
  /** Used for track immobilization (APHE only historically; any pen now). */
  ammoId?: AmmoId
}

export type CombatHitResult = {
  resolution: HitResolution
  destroyed: boolean
  /** Hull HP (compat). */
  hp: number
  /** True if this hit just disabled a track side (or both). */
  tracksDisabled?: boolean
  /** Which track side went out on this hit, if any. */
  trackSide?: 'L' | 'R' | 'both'
  /** Module that absorbed the damage. */
  moduleId?: ModuleId
  /** APHE filler damage applied to hull after pen (0 if none). */
  internalDamage?: number
}

/** After APHE fuse kills the hull, wait this long before spawning the wreck. */
const APHE_WRECK_DELAY_SEC = 0.22
/** Ammo-cook bonus as a fraction of hull max HP (crit after pen — not instakill). */
const APHE_CRIT_HULL_FRAC = 0.42

export type TrackSideState = {
  leftOut: boolean
  rightOut: boolean
  /** Seconds left on L/R repair timers (0 if healthy). */
  leftDisableLeft: number
  rightDisableLeft: number
}

/** Drive modifiers from damaged tracks (M2). */
export type TrackDriveMods = {
  leftOut: boolean
  rightOut: boolean
  /** Both tracks out — hard stop. */
  immobilized: boolean
  /** Scale throttle (1 = full, ~0.32 crawl on one track). */
  forwardMul: number
  /** Added to turn (−1…+1). Kept for API; always 0 (no auto-steer). */
  turnBias: number
  /** Scale player turn input. */
  turnMul: number
}

export type FuelState = {
  leaking: boolean
  empty: boolean
  /** Fuel HP fraction 0–1. */
  fraction: number
}

/** Crawl pace with one track (fraction of throttle). */
const ONE_TRACK_FORWARD = 0.32
/** No auto-steer — broken track only slows you; turn only when you steer. */
const ONE_TRACK_TURN_MUL = 0.75
/** Chance per second to cook off once fuel HP is empty. */
const FUEL_COOK_OFF_CHANCE = 0.11
/** Smoke / FX interval while leaking (s). */
const FUEL_LEAK_FX_SEC = 0.3

export function trackDriveModsFromState(s: TrackSideState): TrackDriveMods {
  const leftOut = s.leftOut
  const rightOut = s.rightOut
  if (leftOut && rightOut) {
    return {
      leftOut,
      rightOut,
      immobilized: true,
      forwardMul: 0,
      turnBias: 0,
      turnMul: 0,
    }
  }
  if (leftOut || rightOut) {
    return {
      leftOut,
      rightOut,
      immobilized: false,
      forwardMul: ONE_TRACK_FORWARD,
      turnBias: 0,
      turnMul: ONE_TRACK_TURN_MUL,
    }
  }
  return {
    leftOut: false,
    rightOut: false,
    immobilized: false,
    forwardMul: 1,
    turnBias: 0,
    turnMul: 1,
  }
}

/** Shared hittable tank: armor volumes + module HP (player, AI, dummy). */
export type Combatant = {
  root: THREE.Group
  alive: boolean
  /** Hull HP — death when ≤ 0. */
  hp: number
  maxHp: number
  containsPoint: (p: THREE.Vector3) => boolean
  resolveShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
    ctx?: ShellHitContext,
  ) => CombatHitResult | null
  /**
   * Armour resolution **without** applying it — for the kill cam, which has to
   * know whether a shell in flight is lethal before it lands. Compare hull
   * threat (pen-to-hull + `internalBlast`) to `hp`; random `crit` is not
   * predictable (saturated plates still add predictable fuse bonus in
   * `lethalShot`).
   */
  previewShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
  ) => HitResolution | null
  tickMobility: (dt: number) => void
  /** Fully immobilized = both tracks out. */
  isImmobilized: () => boolean
  /** Max seconds left on either track disable (0 if both mobile). */
  getTracksDisableLeft: () => number
  getTrackState: () => TrackSideState
  /** Forward crawl + turn bias when one track is out. */
  getTrackDriveMods: () => TrackDriveMods
  getFuelState: () => FuelState
  getModules: () => Readonly<ModuleKit>
  getModule: (id: ModuleId) => ModuleState
  /** Restore HP / alive after a KOTH respawn (mesh must still exist). */
  revive: () => void
}

export type CombatantOptions = {
  maxHp: number
  /** Broad-phase radius on XZ (and soft Y gate). */
  broadRadius?: number
  /**
   * Hit height relative to the root (metres). Aircraft need this — the default
   * absolute Y gate (−0.5…6) only covers ground vehicles.
   */
  altitudeSpan?: number
  /** Per-tank armor table (defaults to Pz-III if omitted). */
  armor?: Record<ArmorPartId, ArmorPartDef>
  /**
   * `severe` = ammo-rack / crit — airframes may explode mid-air instead of
   * flaming out and gliding to the deck.
   */
  onDestroyed?: (root: THREE.Group, info: { severe: boolean }) => void
  /** Fired when a track side is disabled. */
  onTracksDisabled?: (seconds: number) => void
  /** Periodic fuel leak FX while fuel module is damaged. */
  onFuelLeak?: (info: { intensity: number; empty: boolean }) => void
  /** Damaging hit (pen / blast) that applied HP loss — crew “we've been hit”. */
  onDamaged?: (info: { damage: number; kind: string; destroyed: boolean }) => void
  label?: string
}

const _tmp = new THREE.Vector3()

/**
 * Attach armor hit volumes + module HP to an existing tank root.
 * Call after the tank is parented / posed; volumes track the root as it moves.
 */
export function createCombatant(
  root: THREE.Group,
  opts: CombatantOptions,
): Combatant {
  const maxHp = opts.maxHp
  const broadR = opts.broadRadius ?? 5.5
  const broadR2 = broadR * broadR
  const altSpan = opts.altitudeSpan
  const volumes = createTankHitVolumes(root, opts.armor)
  const modules = createModuleKit(maxHp)
  let alive = true
  let trackLDisableLeft = 0
  let trackRDisableLeft = 0
  let fuelLeaking = false
  let fuelLeakFxAcc = 0
  let fuelCookAcc = 0
  const label = opts.label ?? root.name ?? 'tank'
  let lastTrackDriveLog = ''
  let fuelWarned = false
  let cookWarned = false
  /** Lethal APHE fuse — wreck/onDestroyed deferred so the boom reads first. */
  let pendingApheWreck: { t: number; severe: boolean } | null = null

  console.info(
    `[Steel] Modules · ${label} · hull ${modules.hull.maxHp} · turret ${modules.turret.maxHp} · ` +
      `trackL/R ${modules.trackL.maxHp} · fuel ${modules.fuel.maxHp}`,
  )

  const readTrackState = (): TrackSideState => ({
    leftOut: trackLDisableLeft > 0 || modules.trackL.hp <= 0,
    rightOut: trackRDisableLeft > 0 || modules.trackR.hp <= 0,
    leftDisableLeft: trackLDisableLeft,
    rightDisableLeft: trackRDisableLeft,
  })

  const applyTrackDisable = (side: 'L' | 'R'): void => {
    if (side === 'L') {
      trackLDisableLeft = TRACK_DISABLE_SEC
      modules.trackL.hp = 0
    } else {
      trackRDisableLeft = TRACK_DISABLE_SEC
      modules.trackR.hp = 0
    }
    console.info(
      `[Steel] ${label} TRACK ${side} DISABLED ${TRACK_DISABLE_SEC}s ` +
        `(L=${trackLDisableLeft > 0 ? 'OUT' : 'OK'} R=${trackRDisableLeft > 0 ? 'OUT' : 'OK'})`,
    )
    opts.onTracksDisabled?.(TRACK_DISABLE_SEC)
  }

  return {
    root,
    get alive() {
      return alive
    },
    get hp() {
      return modules.hull.hp
    },
    maxHp: modules.hull.maxHp,
    containsPoint(p) {
      if (!alive) return false
      root.getWorldPosition(_tmp)
      const dx = p.x - _tmp.x
      const dz = p.z - _tmp.z
      if (dx * dx + dz * dz > broadR2) return false
      if (altSpan != null) {
        const dy = p.y - _tmp.y
        return dy > -altSpan && dy < altSpan
      }
      return p.y > -0.5 && p.y < 6
    },
    tickMobility(dt) {
      if (pendingApheWreck) {
        pendingApheWreck.t -= dt
        if (pendingApheWreck.t <= 0) {
          const severe = pendingApheWreck.severe
          pendingApheWreck = null
          console.info(
            `[Steel] ${label} APHE wreck — fuse complete · severe=${severe}`,
          )
          opts.onDestroyed?.(root, { severe })
        }
      }

      if (trackLDisableLeft > 0) {
        trackLDisableLeft = Math.max(0, trackLDisableLeft - dt)
        if (trackLDisableLeft === 0) {
          modules.trackL.hp = modules.trackL.maxHp
          console.info(`[Steel] ${label} track L repaired`)
        }
      }
      if (trackRDisableLeft > 0) {
        trackRDisableLeft = Math.max(0, trackRDisableLeft - dt)
        if (trackRDisableLeft === 0) {
          modules.trackR.hp = modules.trackR.maxHp
          console.info(`[Steel] ${label} track R repaired`)
        }
      }

      if (!alive) return

      const fuel = modules.fuel
      const fuelFrac = fuel.maxHp > 0 ? fuel.hp / fuel.maxHp : 1
      if (fuel.hp < fuel.maxHp) fuelLeaking = true

      if (fuelLeaking) {
        fuelLeakFxAcc += dt
        if (fuelLeakFxAcc >= FUEL_LEAK_FX_SEC) {
          fuelLeakFxAcc = 0
          const intensity = 0.35 + (1 - fuelFrac) * 1.1
          opts.onFuelLeak?.({ intensity, empty: fuel.hp <= 0 })
        }
      }

      // Empty fuel tank → ticking cook-off (ammo/fuel fire).
      if (fuel.hp <= 0) {
        if (!cookWarned) {
          cookWarned = true
          console.info(`[Steel] ${label} FUEL EMPTY — cook-off risk`)
        }
        fuelCookAcc += dt
        if (fuelCookAcc >= 1) {
          fuelCookAcc = 0
          if (Math.random() < FUEL_COOK_OFF_CHANCE) {
            alive = false
            modules.hull.hp = 0
            console.info(`[Steel] ${label} FUEL COOK-OFF — tank exploded`)
            opts.onDamaged?.({
              damage: modules.hull.maxHp,
              kind: 'blast',
              destroyed: true,
            })
            opts.onDestroyed?.(root, { severe: true })
          }
        }
      }
    },
    isImmobilized() {
      // M1: only full stop when both sides out. M2 will crawl on one track.
      return trackLDisableLeft > 0 && trackRDisableLeft > 0
    },
    getTracksDisableLeft() {
      return Math.max(trackLDisableLeft, trackRDisableLeft)
    },
    getTrackState() {
      return readTrackState()
    },
    getTrackDriveMods() {
      const mods = trackDriveModsFromState(readTrackState())
      const key = mods.immobilized
        ? 'both'
        : mods.leftOut
          ? 'L'
          : mods.rightOut
            ? 'R'
            : 'ok'
      if (key !== lastTrackDriveLog) {
        lastTrackDriveLog = key
        if (key === 'both') {
          console.info(`[Steel] ${label} tracks BOTH OUT — immobilized`)
        } else if (key === 'L' || key === 'R') {
          console.info(
            `[Steel] ${label} track ${key} OUT — TR5 circle (dead side v=0)`,
          )
        }
      }
      return mods
    },
    getFuelState() {
      const fuel = modules.fuel
      const fraction = fuel.maxHp > 0 ? fuel.hp / fuel.maxHp : 1
      return {
        leaking: fuelLeaking || fuel.hp < fuel.maxHp,
        empty: fuel.hp <= 0,
        fraction,
      }
    },
    getModules() {
      return modules
    },
    getModule(id) {
      return modules[id]
    },
    revive() {
      alive = true
      resetModuleKit(modules)
      trackLDisableLeft = 0
      trackRDisableLeft = 0
      fuelLeaking = false
      fuelLeakFxAcc = 0
      fuelCookAcc = 0
      fuelWarned = false
      cookWarned = false
      pendingApheWreck = null
      lastTrackDriveLog = ''
      root.visible = true
      console.info(
        `[Steel] ${label} respawned hull ${modules.hull.hp}/${modules.hull.maxHp}`,
      )
    },
    previewShellHit(p, velocity, shellStats) {
      if (!alive) return null
      volumes.updateWorld()
      return volumes.resolveHit(p, velocity, shellStats)
    },
    resolveShellHit(p, velocity, shellStats, ctx) {
      if (!alive) return null
      volumes.updateWorld()
      const resolution = volumes.resolveHit(p, velocity, shellStats)
      if (!resolution) return null

      let destroyed = false
      let tracksDisabled = false
      let trackSide: 'L' | 'R' | 'both' | undefined
      let internalDamage = 0
      const moduleId = moduleForArmorPart(resolution.part.id)
      const mod = modules[moduleId]
      const isAphe = ctx?.ammoId === 'aphe'

      if (resolution.kind === 'penetrated' || resolution.kind === 'blast') {
        const before = mod.hp
        mod.hp = Math.max(0, mod.hp - resolution.damage)

        // Track pen → disable that side when module empties (or any APHE pen for feel).
        if (
          resolution.kind === 'penetrated' &&
          (moduleId === 'trackL' || moduleId === 'trackR')
        ) {
          const side: 'L' | 'R' = moduleId === 'trackL' ? 'L' : 'R'
          const force =
            isAphe || mod.hp <= 0 || (before > 0 && mod.hp === 0)
          if (force || mod.hp <= 0) {
            applyTrackDisable(side)
            tracksDisabled = true
            trackSide = side
            if (trackLDisableLeft > 0 && trackRDisableLeft > 0) trackSide = 'both'
          }
        }

        if (moduleId === 'fuel' && mod.hp < mod.maxHp) {
          fuelLeaking = true
          if (!fuelWarned) {
            fuelWarned = true
            console.info(
              `[Steel] ${label} FUEL LEAK — tank ${mod.hp}/${mod.maxHp}` +
                (mod.hp <= 0 ? ' · EMPTY cook-off armed' : ''),
            )
          }
          // Immediate puff on the hit that opened the tank.
          opts.onFuelLeak?.({
            intensity: 0.9 + (1 - mod.hp / mod.maxHp),
            empty: mod.hp <= 0,
          })
        }

        // APHE: after pen, fuse detonates inside — hull takes filler (+ ammo cook bonus).
        // Crit is NOT an instakill; it only adds internal hull damage.
        if (resolution.kind === 'penetrated' && isAphe) {
          let fuse = Math.max(0, Math.round(shellStats.internalBlast ?? 0))
          if (resolution.crit) {
            fuse += Math.round(modules.hull.maxHp * APHE_CRIT_HULL_FRAC)
          }
          if (fuse > 0) {
            modules.hull.hp = Math.max(0, modules.hull.hp - fuse)
            internalDamage = fuse
            console.info(
              `[Steel] ${label} APHE FUSE −${fuse}` +
                (resolution.crit ? ' (ammo cook)' : '') +
                ` · hull ${modules.hull.hp}/${modules.hull.maxHp}`,
            )
          }
        }

        const hullDead = modules.hull.hp <= 0
        if (hullDead) {
          alive = false
          destroyed = true
          modules.hull.hp = 0
          const severe = resolution.crit === true
          const reason =
            isAphe && severe
              ? 'APHE FUSE · AMMO'
              : isAphe
                ? 'APHE FUSE · HULL'
                : severe
                  ? 'AMMO RACK'
                  : 'HULL DESTROYED'
          console.info(
            `[Steel] ${label} ${reason} — ${mod.label} ${resolution.kind} ${resolution.damage}` +
              (internalDamage ? ` +fuse ${internalDamage}` : '') +
              ` (${moduleId} ${mod.hp}/${mod.maxHp})`,
          )
          opts.onDamaged?.({
            damage: resolution.damage + internalDamage,
            kind: isAphe ? 'aphe-fuse' : resolution.kind,
            destroyed: true,
          })
          if (isAphe && resolution.kind === 'penetrated') {
            // Boom first; wreck appears after a short fuse delay.
            pendingApheWreck = { t: APHE_WRECK_DELAY_SEC, severe }
          } else {
            opts.onDestroyed?.(root, { severe })
          }
        } else {
          console.info(
            `[Steel] ${label} ${resolution.kind.toUpperCase()} ${mod.label} −${resolution.damage}` +
              (internalDamage ? ` · FUSE −${internalDamage}` : '') +
              ` (${moduleId} ${mod.hp}/${mod.maxHp}` +
              (moduleId !== 'hull'
                ? ` · hull ${modules.hull.hp}/${modules.hull.maxHp}`
                : '') +
              `)`,
          )
          opts.onDamaged?.({
            damage: resolution.damage + internalDamage,
            kind: resolution.kind,
            destroyed: false,
          })
        }
      } else if (resolution.kind === 'ricochet') {
        console.info(
          `[Steel] ${label} RICOCHET ${resolution.part.label} @ ${resolution.angleDeg.toFixed(0)}°`,
        )
      } else {
        console.info(
          `[Steel] ${label} NO PEN ${resolution.part.label} — ${resolution.penetration.toFixed(0)} < ${resolution.effectiveArmor.toFixed(0)}mm`,
        )
      }

      return {
        resolution,
        destroyed,
        hp: modules.hull.hp,
        tracksDisabled,
        trackSide,
        moduleId,
        internalDamage,
      }
    },
  }
}

/** Flash wreck then remove (placeholder until F3 death FX). */
export function flashDestroyVisual(scene: THREE.Scene, root: THREE.Group): void {
  const hitFlashMat = new THREE.MeshStandardMaterial({
    color: 0xc45a2a,
    emissive: 0x6a2008,
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.9,
  })
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.material = hitFlashMat
  })
  window.setTimeout(() => {
    scene.remove(root)
    hitFlashMat.dispose()
  }, 550)
}
