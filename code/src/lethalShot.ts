import * as THREE from 'three'
import { critProbability, type HitResolution, type ShellImpact } from './armor'
import { integrateShell, type HeightSampler } from './ballistics'
import { hitsPropCollider, type PropCollider } from './collision'

/**
 * Look ahead down a shell's trajectory and report the impact if — and only if
 * — it would destroy what it hits. This is the kill cam's cue: ordinary hits,
 * bounces and misses must never interrupt play.
 */

export type LethalTarget = {
  alive: boolean
  hp: number
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
 * Lethality is resolved through the target's own armour path, and decided on
 * `damage >= hp` — never on `HitResolution.crit`, which is a fresh
 * `Math.random()` roll that won't match the one the real hit makes. The
 * exception is a plate whose crit odds *saturate* under overmatch (the rear
 * plate and the turret ring both exceed 1.0): there, any penetration is
 * certainly fatal, so it is predictable. Genuinely chancy ammo-rack kills are
 * left to happen without a cinematic rather than guessed at.
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

      const certainCrit =
        r.kind === 'penetrated' &&
        critProbability(r.part, r.penetration, r.effectiveArmor) >= 1
      if (r.damage < target.hp && !certainCrit) return null
      return { point: _pos.clone(), time: t }
    }

    if (q.blockers && q.blockers.length > 0 && hitsPropCollider(_pos, q.blockers, q.hitRadius)) {
      return null
    }
  }
  return null
}
