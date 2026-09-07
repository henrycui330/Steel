import * as THREE from 'three'
import type { AmmoId } from './ammo'
import type { HitResolution, ShellImpact } from './armor'
import { createTankHitVolumes } from './hitParts'

export const TRACK_DISABLE_SEC = 30

export type ShellHitContext = {
  /** Used for track immobilization (APHE only). */
  ammoId?: AmmoId
}

export type CombatHitResult = {
  resolution: HitResolution
  destroyed: boolean
  hp: number
  /** True if this hit just immobilized the tracks. */
  tracksDisabled?: boolean
}

/** Shared hittable tank: armor volumes + HP (player, AI, dummy). */
export type Combatant = {
  root: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  containsPoint: (p: THREE.Vector3) => boolean
  resolveShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
    ctx?: ShellHitContext,
  ) => CombatHitResult | null
  tickMobility: (dt: number) => void
  isImmobilized: () => boolean
  /** Seconds left on track disable (0 if mobile). */
  getTracksDisableLeft: () => number
}

export type CombatantOptions = {
  maxHp: number
  /** Broad-phase radius on XZ (and soft Y gate). */
  broadRadius?: number
  onDestroyed?: (root: THREE.Group) => void
  /** Fired when APHE pens tracks (immobilize applied). */
  onTracksDisabled?: (seconds: number) => void
  label?: string
}

const _tmp = new THREE.Vector3()

/**
 * Attach armor hit volumes + HP to an existing tank root.
 * Call after the tank is parented / posed; volumes track the root as it moves.
 */
export function createCombatant(
  root: THREE.Group,
  opts: CombatantOptions,
): Combatant {
  const maxHp = opts.maxHp
  const broadR = opts.broadRadius ?? 5.5
  const broadR2 = broadR * broadR
  const volumes = createTankHitVolumes(root)
  let hp = maxHp
  let alive = true
  let tracksDisableLeft = 0
  const label = opts.label ?? root.name ?? 'tank'

  return {
    root,
    get alive() {
      return alive
    },
    get hp() {
      return hp
    },
    maxHp,
    containsPoint(p) {
      if (!alive) return false
      root.getWorldPosition(_tmp)
      const dx = p.x - _tmp.x
      const dz = p.z - _tmp.z
      if (dx * dx + dz * dz > broadR2) return false
      return p.y > -0.5 && p.y < 6
    },
    tickMobility(dt) {
      if (tracksDisableLeft > 0) {
        tracksDisableLeft = Math.max(0, tracksDisableLeft - dt)
        if (tracksDisableLeft === 0) {
          console.info(`[Steel] ${label} tracks repaired`)
        }
      }
    },
    isImmobilized() {
      return tracksDisableLeft > 0
    },
    getTracksDisableLeft() {
      return tracksDisableLeft
    },
    resolveShellHit(p, velocity, shellStats, ctx) {
      if (!alive) return null
      volumes.updateWorld()
      const resolution = volumes.resolveHit(p, velocity, shellStats)
      if (!resolution) return null

      let destroyed = false
      let tracksDisabled = false

      if (resolution.kind === 'penetrated' || resolution.kind === 'blast') {
        hp = Math.max(0, hp - resolution.damage)

        // APHE into tracks → immobilize hull movement for 30s (turret still works)
        if (
          resolution.kind === 'penetrated' &&
          resolution.part.id === 'tracks' &&
          ctx?.ammoId === 'aphe'
        ) {
          tracksDisableLeft = TRACK_DISABLE_SEC
          tracksDisabled = true
          console.info(
            `[Steel] ${label} TRACKS DISABLED ${TRACK_DISABLE_SEC}s`,
          )
          opts.onTracksDisabled?.(TRACK_DISABLE_SEC)
        }

        if (resolution.crit || hp <= 0) {
          alive = false
          destroyed = true
          hp = 0
          const reason = resolution.crit ? 'AMMO RACK' : 'DESTROYED'
          console.info(
            `[Steel] ${label} ${reason} — ${resolution.part.label} ${resolution.kind} ${resolution.damage}`,
          )
          opts.onDestroyed?.(root)
        } else if (!tracksDisabled) {
          console.info(
            `[Steel] ${label} ${resolution.kind.toUpperCase()} ${resolution.part.label} −${resolution.damage} HP (${hp}/${maxHp})`,
          )
        } else {
          console.info(
            `[Steel] ${label} TRACK PEN −${resolution.damage} HP (${hp}/${maxHp})`,
          )
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

      return { resolution, destroyed, hp, tracksDisabled }
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
