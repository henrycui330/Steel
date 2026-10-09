import * as THREE from 'three'
import { critProbability, type HitResolution, type ShellImpact } from './armor'
import { integrateShell, type HeightSampler } from './ballistics'
import { hitsPropCollider, type PropCollider } from './collision'
import { moduleForArmorPart } from './modules'

/**
 * Look ahead down a shell's trajectory and report the impact if — and only if
 * — it would destroy what it hits. This is the kill cam's cue: ordinary hits,
 * bounces and misses must never interrupt play.
 */

export type LethalTarget = {
  alive: boolean
  hp: number
  /** Hull max HP — used for predictable APHE ammo-cook fuse bonus. */
  maxHp?: number
  containsPoint: (p: THREE.Vector3) => boolean
  previewShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
  ) => HitResolution | null
}

export type LethalShotQuery = {
  position: THREE.Vector3
  velocity: THREE.Vector3
  hitRadius: number
  stats: Omit<ShellImpact, 'speed'>
  targets: readonly LethalTarget[]
  /**
   * Step size. Must be the **same fixed substep the live shell advances in**
   * (`SHELL_SUBSTEP`). Hits are point samples against the armour volumes, so
   * marching at any other size lands on different samples and would report
   * penetrations the real shell flies straight past.
   */
  dt: number
  /** Sim seconds to look ahead. */
  horizon: number
  heightAt?: HeightSampler | null
  blockers?: readonly PropCollider[]
}

export type LethalShot = {
  point: THREE.Vector3
  /** Seconds from now to the impact. */
  time: number
}

/** Must match the deflection the live shell loop applies in `fire.ts`. */
const RICOCHET_SPEED_LOSS = 0.55
const RICOCHET_NUDGE = 0.35

const _pos = new THREE.Vector3()
const _vel = new THREE.Vector3()

/**
 * Lethality is hull HP after the same rules as combat: pen damage only counts
 * against the hull when the plate maps to hull; APHE also adds `internalBlast`.
 * Random `crit` is never guessed. Saturated crit plates (odds ≥ 1) add a
 * predictable ammo-cook fuse bonus (~42% hull), matching combatant — still not
 * a contact instakill flag.
 */
export function predictLethalHit(q: LethalShotQuery): LethalShot | null {
  if (q.dt <= 0 || q.targets.length === 0) return null

  _pos.copy(q.position)
  _vel.copy(q.velocity)

  let t = 0
  while (t < q.horizon) {
    integrateShell(_pos, _vel, q.dt)
    t += q.dt

    // Same order the live shell loop resolves in: ground, armour, then props.
    const groundY = (q.heightAt ? q.heightAt(_pos.x, _pos.z) : 0) + q.hitRadius
    if (_pos.y <= groundY) return null

    for (const target of q.targets) {
      if (!target.alive || !target.containsPoint(_pos)) continue
      const r = target.previewShellHit(_pos, _vel, q.stats)
      if (!r) continue

      // A ricochet doesn't end the round: mirror what the live shell does and
      // keep marching the deflection, since a bounce off one plate into
      // another is still a kill worth watching. The speed loss carries into
      // the next resolution, as it does in flight.
      if (r.kind === 'ricochet') {
        _vel.reflect(r.normal).multiplyScalar(RICOCHET_SPEED_LOSS)
        _pos.addScaledVector(r.normal, RICOCHET_NUDGE)
        break
      }
      // 'stopped' means the round is spent.
      if (r.kind !== 'penetrated' && r.kind !== 'blast') return null

      let hullThreat = 0
      if (r.kind === 'blast') {
        hullThreat = r.damage
      } else {
        if (moduleForArmorPart(r.part.id) === 'hull') hullThreat += r.damage
        const fuse = q.stats.internalBlast ?? 0
        if (fuse > 0) hullThreat += fuse
        const certainCook =
          critProbability(r.part, r.penetration, r.effectiveArmor) >= 1
        if (certainCook) {
          // Predictable ammo-cook bonus (matches combatant APHE_CRIT_HULL_FRAC).
          const maxHull = target.maxHp ?? target.hp
          hullThreat += Math.round(maxHull * 0.42)
        }
      }
      if (hullThreat < target.hp) return null
      return { point: _pos.clone(), time: t }
    }

    if (q.blockers && q.blockers.length > 0 && hitsPropCollider(_pos, q.blockers, q.hitRadius)) {
      return null
    }
  }
  return null
}
