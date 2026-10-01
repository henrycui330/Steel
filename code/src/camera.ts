import * as THREE from 'three'
import { getAimDirection } from './aim'

export type CameraMode = 'turret' | 'chase' | 'hull'

const TURRET_CAM_HEIGHT = 0.85
const TURRET_CAM_BACK = 4.8
const AIM_CAM_HEIGHT = 0.15
const AIM_CAM_BACK = 1.4
/** Look-at distance along the shoot/aim line (reticle converge). */
const AIM_LOOK_DISTANCE = 72

const CHASE_DISTANCE = 12
const CHASE_HEIGHT = 5.5
const CHASE_LOOK_AHEAD = 48
const CHASE_LERP = 8
/** Extra chase trail (m) at full speed — sells pace. */
const CHASE_SPEED_PULL = 3.2

/** Close rear-quarter / over-engine — “in the tank” without a full cabin. */
const HULL_DISTANCE = 5.4
const HULL_HEIGHT = 2.15
const HULL_LOOK_AHEAD = 26
const HULL_LERP = 11
const HULL_SPEED_PULL = 1.6
const HULL_FOV = 62

export const DEFAULT_FOV = 70
/**
 * Discrete optic zoom steps (wide → tight). Scroll snaps one notch at a time
 * so aim FOV feels steadier than continuous scrub.
 */
export const AIM_FOV_STEPS = [48, 36, 26, 18, 14] as const
export const AIM_FOV_DEFAULT = AIM_FOV_STEPS[1]
export const AIM_FOV_MIN = AIM_FOV_STEPS[AIM_FOV_STEPS.length - 1]
export const AIM_FOV_MAX = AIM_FOV_STEPS[0]
/** Default step index (36°). */
const AIM_STEP_DEFAULT = 1
/** Accumulate wheel delta before stepping one notch. */
const ZOOM_STEP_THRESHOLD = 55
/** Faster settle onto stepped FOV so notches feel crisp. */
const FOV_LERP = 18
const AIM_FOV_LERP = 22
/** Extra FOV at full drive speed (chase / turret, not while aiming). */
const SPEED_FOV_SPAN = 9

/** Peak positional shake (m) from stacked kicks. */
const SHAKE_CAP = 0.18
/** Speed rumble amplitude at full pace (m) — keep tiny; high-freq offset feels huge. */
const RUMBLE_MAX = 0.006
/** No drive rumble below this speed fraction. */
const RUMBLE_SPEED_GATE = 0.35
/** Aim mode: no rumble; kicks decay fast. */
const AIM_SHAKE_DECAY = 16
const DRIVE_SHAKE_DECAY = 3.2

const desiredPos = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const _mount = new THREE.Vector3()
const _back = new THREE.Vector3()
const _up = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _aimDir = new THREE.Vector3()
const _muzzlePos = new THREE.Vector3()
const _shake = new THREE.Vector3()
const _right = new THREE.Vector3()

let aimStep = AIM_STEP_DEFAULT
let aimFov: number = AIM_FOV_STEPS[aimStep]
let zoomWheelAcc = 0
let shakeAmp = 0
let rumblePhase = 0
let kickPhase = 0

export function getAimFov(): number {
  return aimFov
}

export function getAimZoomStep(): number {
  return aimStep
}

export function getAimZoomLabel(): string {
  // Relative to default step — ×1.0 at 36°, higher when tighter.
  const base = AIM_FOV_STEPS[AIM_STEP_DEFAULT]
  const mag = base / aimFov
  return `×${mag.toFixed(1)}`
}

/** Scroll to zoom while aiming: negative deltaY = zoom in (one FOV step). */
export function adjustAimZoom(deltaY: number): void {
  zoomWheelAcc += deltaY
  while (zoomWheelAcc >= ZOOM_STEP_THRESHOLD) {
    zoomWheelAcc -= ZOOM_STEP_THRESHOLD
    if (aimStep > 0) {
      aimStep -= 1
      aimFov = AIM_FOV_STEPS[aimStep]
    }
  }
  while (zoomWheelAcc <= -ZOOM_STEP_THRESHOLD) {
    zoomWheelAcc += ZOOM_STEP_THRESHOLD
    if (aimStep < AIM_FOV_STEPS.length - 1) {
      aimStep += 1
      aimFov = AIM_FOV_STEPS[aimStep]
    }
  }
}

export function resetAimFov(): void {
  aimStep = AIM_STEP_DEFAULT
  aimFov = AIM_FOV_STEPS[aimStep]
  zoomWheelAcc = 0
}

/** Impulse camera kick (gun fire, landing). Stacks softly up to a cap. */
export function punchCameraShake(amount: number): void {
  const a = THREE.MathUtils.clamp(amount, 0, 1)
  shakeAmp = Math.min(SHAKE_CAP, shakeAmp + a * 0.16)
  kickPhase = 0
}

export function resetCameraShake(): void {
  shakeAmp = 0
  rumblePhase = 0
  kickPhase = 0
}

export function nextCameraMode(mode: CameraMode): CameraMode {
  if (mode === 'turret') return 'chase'
  if (mode === 'chase') return 'hull'
  return 'turret'
}

/**
 * Camera sits behind the turret and looks at a point ON the shoot/aim line
 * (from muzzle), so screen-center matches where shells go — not a parallel
 * ray from a higher eye (that made shells look high/low vs the reticle).
 */
export function updateTurretCamera(
  camera: THREE.PerspectiveCamera,
  _tank: THREE.Object3D,
  turretMount: THREE.Object3D,
  _dt: number,
  aiming: boolean,
  muzzle?: THREE.Object3D | null,
): void {
  turretMount.updateMatrixWorld(true)
  turretMount.getWorldPosition(_mount)

  if (muzzle) {
    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_muzzlePos)
  } else {
    _muzzlePos.copy(_mount)
  }

  getAimDirection(_aimDir)
  if (_aimDir.lengthSq() < 1e-8) {
    turretMount.getWorldQuaternion(_quat)
    _aimDir.set(0, 0, 1).applyQuaternion(_quat).normalize()
  }

  _back.copy(_aimDir).multiplyScalar(-1)
  _up.set(0, 1, 0)

  const back = aiming ? AIM_CAM_BACK : TURRET_CAM_BACK
  const height = aiming ? AIM_CAM_HEIGHT : TURRET_CAM_HEIGHT

  camera.position
    .copy(_muzzlePos)
    .addScaledVector(_back, back)
    .addScaledVector(_up, height)

  lookTarget.copy(_muzzlePos).addScaledVector(_aimDir, AIM_LOOK_DISTANCE)
  camera.lookAt(lookTarget)
}

/** Third-person chase: behind hull, look along aim so reticle ≈ shoot line. */
export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  dt: number,
  muzzle?: THREE.Object3D | null,
  speed01 = 0,
): void {
  const trail = CHASE_DISTANCE + CHASE_SPEED_PULL * THREE.MathUtils.clamp(speed01, 0, 1)
  const yaw = tank.rotation.y
  desiredPos.set(
    tank.position.x - Math.sin(yaw) * trail,
    tank.position.y + CHASE_HEIGHT,
    tank.position.z - Math.cos(yaw) * trail,
  )

  const t = 1 - Math.exp(-CHASE_LERP * dt)
  camera.position.lerp(desiredPos, t)

  if (muzzle) {
    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_muzzlePos)
  } else {
    _muzzlePos.set(tank.position.x, tank.position.y + 2.2, tank.position.z)
  }
  getAimDirection(_aimDir)
  if (_aimDir.lengthSq() < 1e-8) {
    _aimDir.set(Math.sin(yaw), 0, Math.cos(yaw))
  }
  lookTarget.copy(_muzzlePos).addScaledVector(_aimDir, CHASE_LOOK_AHEAD)
  camera.lookAt(lookTarget)
}

/** Tight hull cam — lower, closer, sells mass without blocking the gun sight. */
export function updateHullCamera(
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  dt: number,
  muzzle?: THREE.Object3D | null,
  speed01 = 0,
): void {
  const trail = HULL_DISTANCE + HULL_SPEED_PULL * THREE.MathUtils.clamp(speed01, 0, 1)
  const yaw = tank.rotation.y
  // Slight starboard bias so the turret cupola reads in frame.
  const side = 0.85
  desiredPos.set(
    tank.position.x - Math.sin(yaw) * trail + Math.cos(yaw) * side,
    tank.position.y + HULL_HEIGHT,
    tank.position.z - Math.cos(yaw) * trail - Math.sin(yaw) * side,
  )

  const t = 1 - Math.exp(-HULL_LERP * dt)
  camera.position.lerp(desiredPos, t)

  if (muzzle) {
    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_muzzlePos)
  } else {
    _muzzlePos.set(tank.position.x, tank.position.y + 1.6, tank.position.z)
  }
  getAimDirection(_aimDir)
  if (_aimDir.lengthSq() < 1e-8) {
    _aimDir.set(Math.sin(yaw), 0, Math.cos(yaw))
  }
  lookTarget.copy(_muzzlePos).addScaledVector(_aimDir, HULL_LOOK_AHEAD)
  lookTarget.y += 0.35
  camera.lookAt(lookTarget)
}

function updateFov(
  camera: THREE.PerspectiveCamera,
  aiming: boolean,
  mode: CameraMode,
  dt: number,
  speed01 = 0,
): void {
  const speedFov = aiming ? 0 : THREE.MathUtils.clamp(speed01, 0, 1) * SPEED_FOV_SPAN
  const base = aiming ? aimFov : mode === 'hull' ? HULL_FOV : DEFAULT_FOV
  const target = base + speedFov
  const lerp = aiming ? AIM_FOV_LERP : FOV_LERP
  const t = 1 - Math.exp(-lerp * dt)
  camera.fov = THREE.MathUtils.lerp(camera.fov, target, t)
  camera.updateProjectionMatrix()
}

/**
 * After lookAt: add speed rumble + kick. Aim mode damps hard so ranging stays true.
 */
function applyCameraWeight(
  camera: THREE.PerspectiveCamera,
  dt: number,
  aiming: boolean,
  speed01: number,
): void {
  const s01 = THREE.MathUtils.clamp(speed01, 0, 1)
  // Low frequency only — high-freq sin on the camera reads as seizure.
  rumblePhase += dt * (2.2 + s01 * 3.5)
  kickPhase += dt

  const decay = aiming ? AIM_SHAKE_DECAY : DRIVE_SHAKE_DECAY
  shakeAmp = Math.max(0, shakeAmp * Math.exp(-decay * dt))

  const rumbleGate = THREE.MathUtils.smoothstep(s01, RUMBLE_SPEED_GATE, 1)
  const rumble = aiming ? 0 : rumbleGate * rumbleGate * RUMBLE_MAX
  const kick = shakeAmp * (aiming ? 0.15 : 1)

  camera.getWorldDirection(_aimDir)
  _up.set(0, 1, 0)
  _right.crossVectors(_aimDir, _up)
  if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0)
  else _right.normalize()
  _up.crossVectors(_right, _aimDir).normalize()

  _shake
    .set(0, 0, 0)
    .addScaledVector(
      _right,
      Math.sin(rumblePhase) * rumble + Math.sin(kickPhase * 28) * kick * 0.35,
    )
    .addScaledVector(
      _up,
      Math.cos(rumblePhase * 0.85) * rumble * 0.55 + Math.cos(kickPhase * 19) * kick * 0.22,
    )
    .addScaledVector(_aimDir, -kick * 0.12)

  camera.position.add(_shake)
}

export function updatePlayerCamera(
  mode: CameraMode,
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  turretMount: THREE.Object3D,
  dt: number,
  aiming = false,
  muzzle?: THREE.Object3D | null,
  speed = 0,
  maxSpeed = 20,
): void {
  const speed01 = Math.min(1, Math.abs(speed) / Math.max(maxSpeed, 1))
  updateFov(camera, aiming, mode, dt, speed01)
  // Aim mode forces gun-sight cam even if chase/hull was selected with C.
  if (aiming || mode === 'turret') {
    updateTurretCamera(camera, tank, turretMount, dt, aiming, muzzle)
  } else if (mode === 'hull') {
    updateHullCamera(camera, tank, dt, muzzle, speed01)
  } else {
    updateChaseCamera(camera, tank, dt, muzzle, speed01)
  }
  applyCameraWeight(camera, dt, aiming, speed01)
}
