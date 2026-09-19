import * as THREE from 'three'
import { setAimLocalYawPitch } from './aim'
import { SHELL_SPEED } from './ballistics'

/**
 * Player SPAAG auto-aim: while hard-locked, drive mouse aim toward a
 * constant-velocity lead on the locked target (same idea as AI AA).
 */

const _pos = new THREE.Vector3()
const _muzzle = new THREE.Vector3()
const _lead = new THREE.Vector3()
const _local = new THREE.Vector3()
const _inv = new THREE.Quaternion()

const prevPos = new WeakMap<THREE.Object3D, { x: number; y: number; z: number }>()
const smoothVel = new WeakMap<THREE.Object3D, { x: number; y: number; z: number }>()

export function aimAaAtLockedTarget(opts: {
  hull: THREE.Object3D
  muzzle: THREE.Object3D
  target: THREE.Object3D
  dt: number
  /** Prefer aircraft aim point slightly above root. */
  aircraft?: boolean
  shellSpeed?: number
}): void {
  const speed = opts.shellSpeed ?? SHELL_SPEED
  const dtSafe = Math.max(opts.dt, 1e-4)

  opts.target.getWorldPosition(_pos)
  const aimLift = opts.aircraft ? 0.6 : 1.15
  const ax = _pos.x
  const ay = _pos.y + aimLift
  const az = _pos.z

  const prev = prevPos.get(opts.target) ?? { x: ax, y: ay, z: az }
  let vx = (ax - prev.x) / dtSafe
  let vy = (ay - prev.y) / dtSafe
  let vz = (az - prev.z) / dtSafe
  // Clamp insane spikes (teleport / first frame / hitch).
  const maxSpd = opts.aircraft ? 120 : 40
  const spd = Math.hypot(vx, vy, vz)
  if (spd > maxSpd) {
    const s = maxSpd / spd
    vx *= s
    vy *= s
    vz *= s
  }
  const sv = smoothVel.get(opts.target) ?? { x: vx, y: vy, z: vz }
  const vk = 1 - Math.exp(-8 * dtSafe)
  sv.x += (vx - sv.x) * vk
  sv.y += (vy - sv.y) * vk
  sv.z += (vz - sv.z) * vk
  smoothVel.set(opts.target, sv)
  prevPos.set(opts.target, { x: ax, y: ay, z: az })

  opts.muzzle.updateMatrixWorld(true)
  opts.muzzle.getWorldPosition(_muzzle)

  const dist = Math.hypot(ax - _muzzle.x, ay - _muzzle.y, az - _muzzle.z)
  const tFlight = THREE.MathUtils.clamp(dist / speed, 0.05, 2.6) * 1.08
  _lead.set(ax + sv.x * tFlight, ay + sv.y * tFlight, az + sv.z * tFlight)

  // Lead point → hull-local aim angles (matches aim.ts yaw/pitch convention).
  opts.hull.updateMatrixWorld(true)
  opts.hull.getWorldQuaternion(_inv)
  _inv.invert()
  _local.copy(_lead).sub(_muzzle).applyQuaternion(_inv)
  const horiz = Math.max(Math.hypot(_local.x, _local.z), 0.05)
  const yaw = Math.atan2(_local.x, _local.z)
  const pitch = Math.atan2(_local.y, horiz)
  setAimLocalYawPitch(yaw, pitch)
}

/** Drop velocity history (match end / unlock). */
export function clearAaAimTracking(target?: THREE.Object3D | null): void {
  if (target) {
    prevPos.delete(target)
    smoothVel.delete(target)
  }
}
