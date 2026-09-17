import * as THREE from 'three'
import type { HeightSampler } from './ballistics'

const _quat = new THREE.Quaternion()
const _fwd = new THREE.Vector3()
const _muzzle = new THREE.Vector3()
const _aimDir = new THREE.Vector3()
const mouseWorld = new THREE.Vector3(0, 0, 28)
const barrelWorld = new THREE.Vector3()

/** Radians per pixel (pointer lock). */
const AIM_SENS = 0.0022
const AIM_SENS_ZOOMED = 0.0011
/** Distance along aim/gun ray for HUD markers. */
const RETICLE_DISTANCE = 48

let aimPrecision = false
let turretYawRate = 6.5
let barrelPitchRate = 4.5
let pitchMin = THREE.MathUtils.degToRad(-8)
let pitchMax = THREE.MathUtils.degToRad(20)
let aimPitchMin = THREE.MathUtils.degToRad(-12)
let aimPitchMax = THREE.MathUtils.degToRad(28)

let bound = false
/** Turret yaw relative to hull (not world/map). */
let aimLocalYaw = 0
/** Gun pitch relative to hull deck (not horizon). */
let aimLocalPitch = 0
let aimReady = false
let heightAt: HeightSampler | null = null
/** Hull used to lift local aim into world each frame. */
let aimHull: THREE.Object3D | null = null

export type AimTarget = {
  root: THREE.Object3D
  alive: boolean
}

/** Terrain height sampler (kept for API; reticles use rays, not dirt hits). */
export function setAimHeightAt(fn: HeightSampler | null): void {
  heightAt = fn
}

export type AimFrame = {
  fireYaw: number
  firePitch: number
  mouseHit: THREE.Vector3
  barrelHit: THREE.Vector3
  /** True when gun forward is close enough to aim that barrel HUD can hide. */
  gunSynced: boolean
  /** Terrain range along aim (m / world units), or null if no hit in envelope. */
  rangeM: number | null
}

export function bindMouseAim(): void {
  if (bound) return
  bound = true
  window.addEventListener('pointermove', (e) => {
    if (!document.pointerLockElement) return
    const sens = aimPrecision ? AIM_SENS_ZOOMED : AIM_SENS
    aimLocalYaw -= e.movementX * sens
    aimLocalPitch -= e.movementY * sens
    aimLocalPitch = THREE.MathUtils.clamp(aimLocalPitch, aimPitchMin, aimPitchMax)
  })
}

/** Reset to hull-forward / deck-level. */
export function resetAim(_tankYaw?: number): void {
  aimLocalYaw = 0
  aimLocalPitch = 0
  aimReady = true
}

export function setAimPrecision(enabled: boolean): void {
  aimPrecision = enabled
}

export function setAimRates(traverseRadPerSec: number, elevateRadPerSec: number): void {
  turretYawRate = traverseRadPerSec
  barrelPitchRate = elevateRadPerSec
}

/** Gun depression / elevation limits (degrees). AA needs a much higher max. */
export function setAimPitchLimits(minDeg: number, maxDeg: number): void {
  pitchMin = THREE.MathUtils.degToRad(minDeg)
  pitchMax = THREE.MathUtils.degToRad(maxDeg)
  aimPitchMin = THREE.MathUtils.degToRad(minDeg - 4)
  aimPitchMax = THREE.MathUtils.degToRad(maxDeg + 8)
}

/** Restore MBT-ish defaults after an AA / SPG session. */
export function resetAimPitchLimits(): void {
  setAimPitchLimits(-8, 20)
}

/** Overwrite local aim (artillery location mark). */
export function setAimLocalYawPitch(yaw: number, pitch: number): void {
  aimLocalYaw = yaw
  aimLocalPitch = THREE.MathUtils.clamp(pitch, aimPitchMin, aimPitchMax)
}

export function getAimYaw(): number {
  return aimLocalYaw
}

export function getAimPitch(): number {
  return aimLocalPitch
}

function directionFromLocalYawPitch(
  yaw: number,
  pitch: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const cp = Math.cos(pitch)
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize()
}

/** World aim direction (hull orientation × local yaw/pitch). */
export function getAimDirection(out = new THREE.Vector3()): THREE.Vector3 {
  directionFromLocalYawPitch(aimLocalYaw, aimLocalPitch, out)
  if (aimHull) {
    aimHull.updateMatrixWorld(true)
    aimHull.getWorldQuaternion(_quat)
    out.applyQuaternion(_quat)
  }
  return out
}

export function getAimImpactPoint(): THREE.Vector3 {
  return mouseWorld
}

export function getAimLookPoint(origin: THREE.Vector3, distance: number, out: THREE.Vector3): THREE.Vector3 {
  getAimDirection(_aimDir)
  return out.copy(origin).addScaledVector(_aimDir, distance)
}

function shortestAngleDelta(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function stepAngle(current: number, target: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, target)
  return current + THREE.MathUtils.clamp(delta, -maxStep, maxStep)
}

const RANGE_MAX = 600
const RANGE_STEP = 1.5

/** Distance along aim ray to first terrain contact (1 u ≈ 1 m). */
function sampleAimRange(origin: THREE.Vector3, dir: THREE.Vector3): number | null {
  for (let t = 2; t <= RANGE_MAX; t += RANGE_STEP) {
    const y = origin.y + dir.y * t
    const x = origin.x + dir.x * t
    const z = origin.z + dir.z * t
    const gy = heightAt ? heightAt(x, z) : 0
    if (y <= gy + 0.05) return t
  }
  return null
}

/**
 * Lagged turret + ray reticles. No auto-aim — player aim only.
 */
export function updateTurretAim(
  dt: number,
  _camera: THREE.Camera,
  tank: THREE.Object3D,
  turretYawPivot: THREE.Object3D,
  barrelPitchPivot: THREE.Object3D,
  muzzle: THREE.Object3D,
  _targets: readonly AimTarget[] = [],
): AimFrame {
  aimHull = tank
  if (!aimReady) resetAim()

  const targetLocalYaw = aimLocalYaw
  const gunPitch = THREE.MathUtils.clamp(aimLocalPitch, pitchMin, pitchMax)
  const targetPitch = -gunPitch

  // Skinned bones with gun along +X: yaw on Y, pitch on Z.
  const skinnedX = barrelPitchPivot.userData.gunForward === 'x'
  if (skinnedX) {
    turretYawPivot.rotation.y = stepAngle(
      turretYawPivot.rotation.y,
      targetLocalYaw,
      turretYawRate * dt,
    )
    barrelPitchPivot.rotation.z = stepAngle(
      barrelPitchPivot.rotation.z,
      targetPitch,
      barrelPitchRate * dt,
    )
  } else {
    turretYawPivot.rotation.set(
      0,
      stepAngle(turretYawPivot.rotation.y, targetLocalYaw, turretYawRate * dt),
      0,
    )
    barrelPitchPivot.rotation.set(
      stepAngle(barrelPitchPivot.rotation.x, targetPitch, barrelPitchRate * dt),
      0,
      0,
    )
  }

  barrelPitchPivot.updateMatrixWorld(true)
  barrelPitchPivot.getWorldQuaternion(_quat)
  if (skinnedX) {
    _fwd.set(1, 0, 0).applyQuaternion(_quat).normalize()
  } else {
    _fwd.set(0, 0, 1).applyQuaternion(_quat).normalize()
  }
  muzzle.getWorldPosition(_muzzle)

  const fireYaw = Math.atan2(_fwd.x, _fwd.z)
  const firePitch = skinnedX ? barrelPitchPivot.rotation.z : barrelPitchPivot.rotation.x

  getAimDirection(_aimDir)
  mouseWorld.copy(_muzzle).addScaledVector(_aimDir, RETICLE_DISTANCE)
  barrelWorld.copy(_muzzle).addScaledVector(_fwd, RETICLE_DISTANCE)

  const gunSynced = _fwd.dot(_aimDir) > 0.9995
  const rangeM = sampleAimRange(_muzzle, _aimDir)

  return {
    fireYaw,
    firePitch,
    mouseHit: mouseWorld,
    barrelHit: barrelWorld,
    gunSynced,
    rangeM,
  }
}
