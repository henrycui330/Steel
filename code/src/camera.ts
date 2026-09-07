import * as THREE from 'three'
import { getAimLookPoint } from './aim'

export type CameraMode = 'turret' | 'chase'

const TURRET_CAM_HEIGHT = 1.25
const TURRET_CAM_BACK = 4.8
const AIM_CAM_HEIGHT = 0.7
const AIM_CAM_BACK = 1.6
const AIM_LOOK_DISTANCE = 48

const CHASE_DISTANCE = 12
const CHASE_HEIGHT = 5.5
const CHASE_LOOK_AHEAD = 4
const CHASE_LOOK_HEIGHT = 2.2
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
 * Camera sits behind the turret roof mount and looks along **player aim**.
 * Back offset uses aim direction (not mount local −Z) so skinned bones with
 * non-Z gun axes still frame the tank under the reticle.
 */
export function updateTurretCamera(
  camera: THREE.PerspectiveCamera,
  _tank: THREE.Object3D,
  turretMount: THREE.Object3D,
  _dt: number,
  aiming: boolean,
): void {
  turretMount.updateMatrixWorld(true)
  turretMount.getWorldPosition(_mount)

  // Prefer aim axis; fall back to mount −Z if aim not bound yet.
  getAimLookPoint(_mount, 1, lookTarget)
  _back.subVectors(_mount, lookTarget)
  if (_back.lengthSq() < 1e-8) {
    turretMount.getWorldQuaternion(_quat)
    _back.set(0, 0, -1).applyQuaternion(_quat)
  } else {
    _back.normalize()
  }
  _up.set(0, 1, 0)

  const back = aiming ? AIM_CAM_BACK : TURRET_CAM_BACK
  const height = aiming ? AIM_CAM_HEIGHT : TURRET_CAM_HEIGHT

  camera.position.copy(_mount).addScaledVector(_back, back).addScaledVector(_up, height)

  getAimLookPoint(camera.position, AIM_LOOK_DISTANCE, lookTarget)
  camera.lookAt(lookTarget)
}

/** Third-person chase: farther behind and above the tank. */
export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  tank: THREE.Object3D,
  dt: number,
): void {
  const yaw = tank.rotation.y
  desiredPos.set(
    tank.position.x - Math.sin(yaw) * CHASE_DISTANCE,
    tank.position.y + CHASE_HEIGHT,
    tank.position.z - Math.cos(yaw) * CHASE_DISTANCE,
  )

  const t = 1 - Math.exp(-CHASE_LERP * dt)
  camera.position.lerp(desiredPos, t)

  lookTarget.set(
    tank.position.x + Math.sin(yaw) * CHASE_LOOK_AHEAD,
    tank.position.y + CHASE_LOOK_HEIGHT,
    tank.position.z + Math.cos(yaw) * CHASE_LOOK_AHEAD,
  )
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
): void {
  updateFov(camera, aiming, dt)
  // Aim mode forces gun-sight cam even if chase was selected with C.
  if (aiming || mode === 'turret') {
    updateTurretCamera(camera, tank, turretMount, dt, aiming)
  } else {
    updateChaseCamera(camera, tank, dt)
  }
}
