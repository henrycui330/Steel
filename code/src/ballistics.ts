import * as THREE from 'three'

/** Muzzle speed (units/sec). */
export const SHELL_SPEED = 180
/** Flat shots — no lob. */
export const SHELL_GRAVITY = 0
export const SHELL_RADIUS = 0.12
export const SHELL_MAX_FLIGHT = 6

export type HeightSampler = (x: number, z: number) => number

const _vel = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _stepVel = new THREE.Vector3()

/** Initial velocity from muzzle along gun forward. */
export function shellVelocityFromDir(dir: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(dir).normalize().multiplyScalar(SHELL_SPEED)
}

function groundYAt(x: number, z: number, heightAt?: HeightSampler): number {
  return (heightAt ? heightAt(x, z) : 0) + SHELL_RADIUS
}

/**
 * Ballistic ground impact. Uses flat y≈0 unless `heightAt` is provided
 * (dunes / uneven maps). Never returns a mid-air sample that pins the
 * crosshair in the sky.
 */
export function predictBallisticImpact(
  origin: THREE.Vector3,
  dirOrVel: THREE.Vector3,
  out: THREE.Vector3,
  opts?: { velocityIsScaled?: boolean; maxTime?: number; heightAt?: HeightSampler },
): number {
  const maxTime = opts?.maxTime ?? SHELL_MAX_FLIGHT
  const heightAt = opts?.heightAt
  if (opts?.velocityIsScaled) {
    _vel.copy(dirOrVel)
  } else {
    shellVelocityFromDir(dirOrVel, _vel)
  }

  const flatGround = !heightAt
  if (flatGround) {
    const y0 = Math.max(origin.y, SHELL_RADIUS + 0.05)
    const vy = _vel.y
    const g = SHELL_GRAVITY
    const a = 0.5 * g
    const b = -vy
    const c = SHELL_RADIUS - y0
    const disc = b * b - 4 * a * c

    let tHit = -1
    if (disc >= 0 && a > 1e-8) {
      const s = Math.sqrt(disc)
      const t1 = (-b - s) / (2 * a)
      const t2 = (-b + s) / (2 * a)
      const candidates = [t1, t2].filter((t) => t > 0.02)
      if (candidates.length) tHit = Math.min(...candidates)
    }

    if (tHit > 0 && tHit <= maxTime) {
      out.set(origin.x + _vel.x * tHit, SHELL_RADIUS, origin.z + _vel.z * tHit)
      return tHit
    }
  }

  // Numerical step — terrain-aware when heightAt is set
  const yFloor = groundYAt(origin.x, origin.z, heightAt)
  _pos.set(origin.x, Math.max(origin.y, yFloor + 0.05), origin.z)
  _stepVel.copy(_vel)
  const dt = 1 / 60
  let t = 0
  while (t < maxTime) {
    _stepVel.y -= SHELL_GRAVITY * dt
    _pos.addScaledVector(_stepVel, dt)
    t += dt
    const gy = groundYAt(_pos.x, _pos.z, heightAt)
    if (_pos.y <= gy) {
      out.set(_pos.x, gy, _pos.z)
      return t
    }
  }

  out.set(_pos.x, groundYAt(_pos.x, _pos.z, heightAt), _pos.z)
  return -1
}

/** Step velocity/position one frame under gravity. */
export function integrateShell(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  dt: number,
): void {
  velocity.y -= SHELL_GRAVITY * dt
  position.addScaledVector(velocity, dt)
}

/**
 * Low-angle gun elevation (radians above horizon) to hit a point at
 * horizontal range `range` with height delta `deltaY` (target − muzzle).
 * Returns null if unreachable.
 */
export function elevationToHit(
  range: number,
  deltaY: number,
  speed = SHELL_SPEED,
  g = SHELL_GRAVITY,
): number | null {
  const x = Math.max(range, 0.5)
  const y = deltaY
  const a = (g * x * x) / (2 * speed * speed)
  if (a < 1e-8) return Math.atan2(y, x)
  const A = a
  const B = -x
  const C = y + a
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  const u1 = (-B - s) / (2 * A)
  const u2 = (-B + s) / (2 * A)
  const u = Math.abs(u1) <= Math.abs(u2) ? u1 : u2
  return Math.atan(u)
}
