import type { LockOn, LockPhase } from './lockOn'
import type { Object3D } from 'three'

/**
 * F-16 missile bridge (L3 stub).
 * Hard lock lives in `LockOn`; this exposes a stable API missiles will call later.
 * No mesh / seeker physics yet — `tryFire` only logs.
 */

export type MissileLockStub = {
  /** World root of the hard-locked foe, or null. */
  getTarget: () => Object3D | null
  getPhase: () => LockPhase
  /** Edge-triggered: pretend to launch at the locked target. */
  tryFire: () => boolean
  /** Clear after unlock / match end. */
  reset: () => void
}

export function createMissileLockStub(lock: LockOn): MissileLockStub {
  return {
    getTarget: () => lock.getLockedTarget(),
    getPhase: () => lock.getPhase(),
    tryFire() {
      const target = lock.getLockedTarget()
      if (!target) {
        console.info('[Steel] F-16 MSL — no lock (hold P on a diamond first)')
        return false
      }
      const name = target.name || 'target'
      console.info(`[Steel] F-16 MSL STUB → seek ${name} (missiles not spawned yet)`)
      return true
    },
    reset() {
      lock.reset()
    },
  }
}

/** Log once when hard lock is first acquired (for debugging / future RWR). */
export function noteMissileLockChange(
  stub: MissileLockStub,
  prevPhase: LockPhase,
): LockPhase {
  const phase = stub.getPhase()
  if (phase === 'hard' && prevPhase !== 'hard') {
    const t = stub.getTarget()
    console.info(`[Steel] F-16 radar lock → ${t?.name || 'target'} · M = fire stub`)
  }
  return phase
}
