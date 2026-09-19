import * as THREE from 'three'

/**
 * Shared soft-track → hold-P acquire → hard lock for F-16 + SPAAG.
 * Missiles (F-16) and AA auto-aim consume `getLockedTarget()` later.
 *
 * Hard lock must NOT require lookDir≈target: SPAAG auto-aim points at a
 * lead point ahead of the aircraft, which would otherwise break the lock
 * every frame. Sticky hard lock: stays until P is pressed again (after release)
 * or the target dies / leaves range.
 */

export type LockCandidate = {
  root: THREE.Object3D
  alive: boolean
  aircraft?: boolean
}

export type LockPhase = 'idle' | 'soft' | 'acquiring' | 'hard'

export type LockDiamond = {
  /** CSS pixels, origin top-left. */
  x: number
  y: number
  mode: 'soft' | 'acquiring' | 'hard'
  /** 0–1 fill while acquiring. */
  acquire01: number
}

export type LockFrame = {
  phase: LockPhase
  diamond: LockDiamond | null
  lockedBanner: boolean
}

export type LockOn = {
  update: (opts: {
    dt: number
    origin: THREE.Vector3
    lookDir: THREE.Vector3
    camera: THREE.Camera
    foes: readonly LockCandidate[]
    holdLock: boolean
  }) => LockFrame
  getLockedTarget: () => THREE.Object3D | null
  /** Soft or hard track root — for AAM seek when hard lock isn't required. */
  getTrackTarget: () => THREE.Object3D | null
  getPhase: () => LockPhase
  reset: () => void
}

/** Soft diamond / acquire cone half-angle (radians). */
const SOFT_HALF_ANGLE = (16 * Math.PI) / 180
/** Keep the same soft target while acquiring even if slightly off-centre. */
const STICKY_HALF_ANGLE = (22 * Math.PI) / 180
const MAX_RANGE = 900
const HARD_RANGE = 1200
/** Seconds of continuous P-hold on a soft target to hard-lock. */
const ACQUIRE_SEC = 1.0
/** Smooth diamond screen motion (higher = snappier). */
const DIAMOND_SMOOTH = 18

const _to = new THREE.Vector3()
const _ndc = new THREE.Vector3()
const _look = new THREE.Vector3()

function refresh(
  c: LockCandidate | null,
  foes: readonly LockCandidate[],
): LockCandidate | null {
  if (!c) return null
  const hit = foes.find((f) => f.root === c.root)
  if (!hit || !hit.alive || !hit.root.visible) return null
  return hit
}

function inCone(
  origin: THREE.Vector3,
  lookDir: THREE.Vector3,
  foe: LockCandidate,
  halfAngle: number,
  maxRange: number,
  minRange: number,
): boolean {
  foe.root.getWorldPosition(_to)
  _to.sub(origin)
  const dist = _to.length()
  if (dist < minRange || dist > maxRange) return false
  _to.multiplyScalar(1 / dist)
  return _to.dot(_look.copy(lookDir).normalize()) >= Math.cos(halfAngle)
}

function pickSoft(
  origin: THREE.Vector3,
  lookDir: THREE.Vector3,
  foes: readonly LockCandidate[],
  sticky: LockCandidate | null,
): LockCandidate | null {
  // Stick to current soft while acquiring / hovering so the timer doesn't reset.
  if (
    sticky &&
    refresh(sticky, foes) &&
    inCone(origin, lookDir, sticky, STICKY_HALF_ANGLE, MAX_RANGE, 6)
  ) {
    return refresh(sticky, foes)
  }

  _look.copy(lookDir).normalize()
  const cosSoft = Math.cos(SOFT_HALF_ANGLE)
  let bestAir: LockCandidate | null = null
  let bestAirScore = -Infinity
  let bestGround: LockCandidate | null = null
  let bestGroundScore = -Infinity

  for (const foe of foes) {
    if (!foe.alive || !foe.root.visible) continue
    foe.root.getWorldPosition(_to)
    _to.sub(origin)
    const dist = _to.length()
    if (dist < 6 || dist > MAX_RANGE) continue
    _to.multiplyScalar(1 / dist)
    const align = _to.dot(_look)
    if (align < cosSoft) continue
    const score = align * 2 - dist / MAX_RANGE
    if (foe.aircraft) {
      if (score > bestAirScore) {
        bestAirScore = score
        bestAir = foe
      }
    } else if (score > bestGroundScore) {
      bestGroundScore = score
      bestGround = foe
    }
  }
  return bestAir ?? bestGround
}

/** Hard lock: alive + in range only (lookDir ignored — auto-aim leads off-boresight). */
function hardStillOk(
  origin: THREE.Vector3,
  foe: LockCandidate,
): boolean {
  foe.root.getWorldPosition(_to)
  const dist = _to.distanceTo(origin)
  return dist >= 4 && dist <= HARD_RANGE
}

function projectScreen(
  camera: THREE.Camera,
  world: THREE.Vector3,
): { x: number; y: number; onScreen: boolean } {
  _ndc.copy(world).project(camera)
  const behind = _ndc.z < -1 || _ndc.z > 1
  const x = THREE.MathUtils.clamp((_ndc.x * 0.5 + 0.5) * window.innerWidth, 8, window.innerWidth - 8)
  const y = THREE.MathUtils.clamp((-_ndc.y * 0.5 + 0.5) * window.innerHeight, 8, window.innerHeight - 8)
  const onScreen =
    !behind &&
    _ndc.x >= -1.05 &&
    _ndc.x <= 1.05 &&
    _ndc.y >= -1.05 &&
    _ndc.y <= 1.05
  return { x, y, onScreen }
}

export function createLockOn(): LockOn {
  let phase: LockPhase = 'idle'
  let soft: LockCandidate | null = null
  let hard: LockCandidate | null = null
  let acquireT = 0
  let smoothX = 0
  let smoothY = 0
  let smoothReady = false
  /** After hard lock, ignore held P until released — then next P press unlocks. */
  let unlockArmed = false
  let prevHold = false

  function reset(): void {
    phase = 'idle'
    soft = null
    hard = null
    acquireT = 0
    smoothReady = false
    unlockArmed = false
    prevHold = false
  }

  function diamondAt(
    camera: THREE.Camera,
    root: THREE.Object3D,
    dt: number,
    mode: LockDiamond['mode'],
    acquire01: number,
    /** Hard lock keeps a clamped diamond even when clipped. */
    keepOffscreen: boolean,
  ): LockDiamond | null {
    root.getWorldPosition(_to)
    const scr = projectScreen(camera, _to)
    if (!scr.onScreen && !keepOffscreen) {
      smoothReady = false
      return null
    }
    if (!smoothReady) {
      smoothX = scr.x
      smoothY = scr.y
      smoothReady = true
    } else {
      const k = 1 - Math.exp(-DIAMOND_SMOOTH * dt)
      smoothX += (scr.x - smoothX) * k
      smoothY += (scr.y - smoothY) * k
    }
    return { x: smoothX, y: smoothY, mode, acquire01 }
  }

  function update(opts: {
    dt: number
    origin: THREE.Vector3
    lookDir: THREE.Vector3
    camera: THREE.Camera
    foes: readonly LockCandidate[]
    holdLock: boolean
  }): LockFrame {
    const { dt, origin, lookDir, camera, foes, holdLock } = opts
    const pressEdge = holdLock && !prevHold

    // —— Hard lock: sticky until P pressed again (after release) or target lost ——
    if (hard) {
      hard = refresh(hard, foes)
      if (!holdLock) unlockArmed = true
      const unlock = unlockArmed && pressEdge
      if (!hard || unlock || !hardStillOk(origin, hard)) {
        if (unlock) console.info('[Steel] Lock cleared (P)')
        hard = null
        acquireT = 0
        unlockArmed = false
        phase = 'idle'
        soft = null
        prevHold = holdLock
        // Fall through to soft pick (same frame).
      } else {
        phase = 'hard'
        soft = hard
        prevHold = holdLock
        return {
          phase,
          diamond: diamondAt(camera, hard.root, dt, 'hard', 1, true),
          lockedBanner: true,
        }
      }
    }

    // —— Soft / acquire (hold P to fill) ——
    soft = pickSoft(origin, lookDir, foes, soft)
    if (!soft) {
      acquireT = 0
      phase = 'idle'
      smoothReady = false
      prevHold = holdLock
      return { phase, diamond: null, lockedBanner: false }
    }

    if (holdLock) {
      if (inCone(origin, lookDir, soft, STICKY_HALF_ANGLE, MAX_RANGE, 6)) {
        acquireT += dt
      } else {
        acquireT = Math.max(0, acquireT - dt * 2)
      }
      if (acquireT >= ACQUIRE_SEC) {
        hard = soft
        phase = 'hard'
        acquireT = ACQUIRE_SEC
        unlockArmed = false
        prevHold = holdLock
        console.info(`[Steel] LOCKED ON → ${hard.root.name || 'target'}`)
        return {
          phase,
          diamond: diamondAt(camera, hard.root, dt, 'hard', 1, true),
          lockedBanner: true,
        }
      }
      phase = 'acquiring'
    } else {
      acquireT = 0
      phase = 'soft'
    }

    prevHold = holdLock
    const acquire01 = THREE.MathUtils.clamp(acquireT / ACQUIRE_SEC, 0, 1)
    return {
      phase,
      diamond: diamondAt(
        camera,
        soft.root,
        dt,
        phase === 'acquiring' ? 'acquiring' : 'soft',
        acquire01,
        false,
      ),
      lockedBanner: false,
    }
  }

  return {
    update,
    getLockedTarget: () => (hard && hard.alive ? hard.root : null),
    getTrackTarget: () => {
      if (hard && hard.alive) return hard.root
      if (soft && soft.alive && (phase === 'soft' || phase === 'acquiring' || phase === 'hard')) {
        return soft.root
      }
      return null
    },
    getPhase: () => phase,
    reset,
  }
}
