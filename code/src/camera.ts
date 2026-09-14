import * as THREE from 'three'
import { getAimDirection } from './aim'

export type CameraMode = 'turret' | 'chase'

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

export const DEFAULT_FOV = 70
/** Default FOV when entering aim mode. */
export const AIM_FOV_DEFAULT = 36
export const AIM_FOV_MIN = 14
export const AIM_FOV_MAX = 52
const FOV_LERP = 12
/** Degrees of FOV change per wheel notch (≈100 deltaY). */
const ZOOM_PER_WHEEL = 0.045

const desiredPos = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const _mount = new THREE.Vector3()
const _back = new THREE.Vector3()
const _up = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _aimDir = new THREE.Vector3()
const _muzzlePos = new THREE.Vector3()

let aimFov = AIM_FOV_DEFAULT

export function getAimFov(): number {
  return aimFov
}

/** Scroll to zoom while aiming: negative deltaY = zoom in (lower FOV). */
export function adjustAimZoom(deltaY: number): void {
  aimFov = THREE.MathUtils.clamp(aimFov + deltaY * ZOOM_PER_WHEEL, AIM_FOV_MIN, AIM_FOV_MAX)
}

export function resetAimFov(): void {
  aimFov = AIM_FOV_DEFAULT
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

  // Sit behind along aim axis, slight height for framing
  camera.position
    .copy(_muzzlePos)
    .addScaledVector(_back, back)
    .addScaledVector(_up, height)

  // Converge: look at a point on the same ray the shell flies
  lookTarget.copy(_muzzlePos).addScaledVector(_aimDir, AIM_LOOK_DISTANCE)
  camera.lookAt(lookTarget)
}

/** Third-person chase: behind hull, look along aim so reticle ≈ shoot line. */
export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  dt: number,
  muzzle?: THREE.Object3D | null,
): void {
  const yaw = tank.rotation.y
  desiredPos.set(
    tank.position.x - Math.sin(yaw) * CHASE_DISTANCE,
    tank.position.y + CHASE_HEIGHT,
    tank.position.z - Math.cos(yaw) * CHASE_DISTANCE,
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

function updateFov(camera: THREE.PerspectiveCamera, aiming: boolean, dt: number): void {
  const target = aiming ? aimFov : DEFAULT_FOV
  const t = 1 - Math.exp(-FOV_LERP * dt)
  camera.fov = THREE.MathUtils.lerp(camera.fov, target, t)
  camera.updateProjectionMatrix()
}

export function updatePlayerCamera(
  mode: CameraMode,
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  turretMount: THREE.Object3D,
  dt: number,
  aiming = false,
  muzzle?: THREE.Object3D | null,
): void {
  updateFov(camera, aiming, dt)
  // Aim mode forces gun-sight cam even if chase was selected with C.
  if (aiming || mode === 'turret') {
    updateTurretCamera(camera, tank, turretMount, dt, aiming, muzzle)
  } else {
    updateChaseCamera(camera, tank, dt, muzzle)
  }
}
