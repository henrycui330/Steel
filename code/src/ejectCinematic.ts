import * as THREE from 'three'
import './impactCinematic.css'

/**
 * Ejection seat shot: the camera punches off the Corsair on a rocket rail,
 * looks back at the abandoned airframe, then hands control back.
 *
 * Kept short (~2.2 s real) so it never stalls a KOTH respawn or a Skirmish end.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const DURATION = 2.2
const SEAT_SPEED = 55
const SEAT_SIDE = 3.2
const SEAT_BACK = 4.5
const FOV_START = 58
const FOV_PEAK = 42
const FOV_END = 52

export type EjectCinematic = {
  begin: (opts: {
    aircraft: THREE.Object3D
    /** Aircraft world velocity at punch-out (copied). */
    velocity: THREE.Vector3
  }) => void
  active: () => boolean
  update: (realDt: number, camera: THREE.PerspectiveCamera) => void
  cancel: () => void
  dispose: () => void
}

export type EjectOptions = {
  scene: THREE.Scene
  heightAt: (x: number, z: number) => number
  onShow?: (showing: boolean) => void
  /** Fired once when the shot finishes (or is cancelled after begin). */
  onDone?: () => void
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function createEjectCinematic(opts: EjectOptions): EjectCinematic {
  const { scene, heightAt, onShow, onDone } = opts

  const overlay = document.createElement('div')
  overlay.className = 'impactcam'
  overlay.innerHTML = `
    <div class="impactcam-bar top"></div>
    <div class="impactcam-bar bottom"></div>
    <div class="impactcam-slate">
      <span class="impactcam-dot"></span>
      <span class="impactcam-label">Eject</span>
      <span class="impactcam-hint">seat clear</span>
    </div>`
  overlay.style.display = 'none'
  document.body.appendChild(overlay)

  // Minimal seat stand-in — reads as a rocketing mass without a pilot mesh.
  const seatGeo = new THREE.BoxGeometry(0.55, 0.9, 0.7)
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d42,
    metalness: 0.55,
    roughness: 0.4,
    emissive: 0x4a1808,
    emissiveIntensity: 0.35,
  })
  const seat = new THREE.Mesh(seatGeo, seatMat)
  seat.visible = false
  seat.castShadow = true
  scene.add(seat)

  const plumeGeo = new THREE.ConeGeometry(0.22, 1.4, 6)
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xff6a2a,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const plume = new THREE.Mesh(plumeGeo, plumeMat)
  plume.position.y = -0.85
  plume.rotation.x = Math.PI
  seat.add(plume)

  let phase: 'idle' | 'shot' = 'idle'
  let elapsed = 0
  let aircraft: THREE.Object3D | null = null
  let doneFired = false

  const seatPos = new THREE.Vector3()
  const seatVel = new THREE.Vector3()
  const planePos = new THREE.Vector3()
  const planeVel = new THREE.Vector3()
  const camGoal = new THREE.Vector3()
  const look = new THREE.Vector3()
  const side = new THREE.Vector3()
  const tumble = new THREE.Quaternion()
  const tumbleAxis = new THREE.Vector3()

  function finish(): void {
    if (phase === 'idle') return
    phase = 'idle'
    seat.visible = false
    overlay.classList.remove('in')
    overlay.style.display = 'none'
    onShow?.(false)
    aircraft = null
    if (!doneFired) {
      doneFired = true
      onDone?.()
    }
  }

  return {
    begin({ aircraft: ac, velocity }) {
      aircraft = ac
      phase = 'shot'
      elapsed = 0
      doneFired = false

      ac.getWorldPosition(planePos)
      planeVel.copy(velocity)
      seatPos.copy(planePos).y += 1.2
      // Rocket almost straight up, slight lead from residual airspeed.
      seatVel.set(planeVel.x * 0.15, SEAT_SPEED, planeVel.z * 0.15)

      side.set(1, 0, 0)
      if (Math.abs(planeVel.x) + Math.abs(planeVel.z) > 1) {
        side.set(-planeVel.z, 0, planeVel.x).normalize()
      }

      seat.position.copy(seatPos)
      seat.visible = true
      plumeMat.opacity = 0.9

      overlay.style.display = ''
      void overlay.offsetHeight
      overlay.classList.add('in')
      onShow?.(true)
    },
    active: () => phase !== 'idle',
    update(realDt, camera) {
      if (phase !== 'shot' || !aircraft) return
      elapsed += realDt
      const u = THREE.MathUtils.clamp(elapsed / DURATION, 0, 1)

      // Seat climbs; gravity bleeds the rocket after the first beat.
      const boost = 1 - smoothstep(0.35, 0.95, u)
      seatVel.y -= 18 * realDt * (1 - boost * 0.7)
      seatPos.addScaledVector(seatVel, realDt)
      const floor = heightAt(seatPos.x, seatPos.z) + 3
      if (seatPos.y < floor) seatPos.y = floor
      seat.position.copy(seatPos)
      seat.lookAt(seatPos.x, seatPos.y + 2, seatPos.z)
      plumeMat.opacity = 0.15 + boost * 0.75
      plume.scale.setScalar(0.7 + boost * 1.4)

      // Abandoned airframe drifts and tumbles.
      planePos.addScaledVector(planeVel, realDt)
      planeVel.y -= 12 * realDt
      planeVel.multiplyScalar(1 - 0.35 * realDt)
      aircraft.position.copy(planePos)
      tumbleAxis.set(0.4, 0.2, 1).normalize()
      tumble.setFromAxisAngle(tumbleAxis, realDt * 1.1)
      aircraft.quaternion.premultiply(tumble)

      // Camera rides beside the seat, looking back at the Corsair.
      camGoal.copy(seatPos)
      camGoal.addScaledVector(side, SEAT_SIDE)
      camGoal.addScaledVector(WORLD_UP, 1.2)
      camGoal.z += SEAT_BACK * 0.15
      const back = new THREE.Vector3().subVectors(seatPos, planePos).normalize()
      if (back.lengthSq() > 1e-4) camGoal.addScaledVector(back, SEAT_BACK * 0.35)

      if (elapsed < realDt * 1.5) camera.position.copy(camGoal)
      else camera.position.lerp(camGoal, 1 - Math.exp(-8 * realDt))

      look.lerpVectors(seatPos, planePos, 0.55 + 0.25 * u)
      camera.up.copy(WORLD_UP)
      camera.lookAt(look)
      camera.fov = THREE.MathUtils.lerp(
        FOV_START,
        THREE.MathUtils.lerp(FOV_PEAK, FOV_END, smoothstep(0.45, 1, u)),
        smoothstep(0, 0.35, u),
      )
      camera.updateProjectionMatrix()

      if (elapsed >= DURATION) finish()
    },
    cancel() {
      if (phase === 'idle') return
      finish()
    },
    dispose() {
      if (phase !== 'idle') {
        phase = 'idle'
        onShow?.(false)
      }
      overlay.remove()
      scene.remove(seat)
      seatGeo.dispose()
      seatMat.dispose()
      plumeGeo.dispose()
      plumeMat.dispose()
    },
  }
}
