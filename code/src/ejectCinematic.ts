import * as THREE from 'three'
import './impactCinematic.css'

/**
 * Ejection seat shot: rocket clear of the cockpit, camera looks back at the
 * abandoned airframe as it deadsticks into a tumble (and often the deck).
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0)
/** Long enough to read residual airspeed + the dive — still short for KOTH. */
const DURATION = 3.8
const SEAT_SPEED = 58
const SEAT_SIDE = 3.6
const SEAT_BACK = 5.2
const FOV_START = 58
const FOV_PEAK = 40
const FOV_END = 50

const PLANE_GRAVITY = 34
const PLANE_DRAG = 0.28
const PLANE_TUMBLE0 = 1.6
const PLANE_TUMBLE_GAIN = 0.55
const PLANE_NOSE_DROP = 0.9
const CRASH_AGL = 2.8
const GROUND_FRICTION = 2.8

export type EjectCinematic = {
  begin: (opts: {
    aircraft: THREE.Object3D
    /** Aircraft world velocity at punch-out (copied — pass BEFORE forceCrash). */
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
  /** Per-frame FX hook on the abandoned airframe (engine fire / smoke). */
  onAirframeFx?: (origin: THREE.Vector3, grounded: boolean) => void
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function createEjectCinematic(opts: EjectOptions): EjectCinematic {
  const { scene, heightAt, onShow, onDone, onAirframeFx } = opts

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
  let grounded = false
  let groundedFor = 0
  let tumbleRate = PLANE_TUMBLE0

  const seatPos = new THREE.Vector3()
  const seatVel = new THREE.Vector3()
  const planePos = new THREE.Vector3()
  const planeVel = new THREE.Vector3()
  const camGoal = new THREE.Vector3()
  const look = new THREE.Vector3()
  const side = new THREE.Vector3()
  const tumble = new THREE.Quaternion()
  const tumbleAxis = new THREE.Vector3()
  const noseLocal = new THREE.Vector3(0, 0, 1)
  const noseWorld = new THREE.Vector3()
  const fxPos = new THREE.Vector3()
  const bodyX = new THREE.Vector3(1, 0, 0)

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
      grounded = false
      groundedFor = 0
      tumbleRate = PLANE_TUMBLE0 + Math.random() * 0.5

      ac.getWorldPosition(planePos)
      planeVel.copy(velocity)
      // Punch-out must keep cruise energy — a near-zero vel reads as a hover-drop.
      if (planeVel.lengthSq() < 4) {
        noseWorld.copy(noseLocal).applyQuaternion(ac.quaternion)
        planeVel.copy(noseWorld).multiplyScalar(45)
        planeVel.y -= 8
      }

      seatPos.copy(planePos).y += 1.2
      seatVel.set(planeVel.x * 0.18, SEAT_SPEED, planeVel.z * 0.18)

      side.set(1, 0, 0)
      if (Math.abs(planeVel.x) + Math.abs(planeVel.z) > 1) {
        side.set(-planeVel.z, 0, planeVel.x).normalize()
      }

      // Unique tumble each eject.
      tumbleAxis
        .set(
          0.35 + Math.random() * 0.55,
          0.2 + Math.random() * 0.4,
          0.55 + Math.random() * 0.45,
        )
        .normalize()

      seat.position.copy(seatPos)
      seat.visible = true
      plumeMat.opacity = 0.9

      overlay.style.display = ''
      void overlay.offsetHeight
      overlay.classList.add('in')
      onShow?.(true)
      console.info(
        `[Steel] Eject cinematic — airframe ${planeVel.length().toFixed(0)} m/s`,
      )
    },
    active: () => phase !== 'idle',
    update(realDt, camera) {
      if (phase !== 'shot' || !aircraft) return
      elapsed += realDt
      const u = THREE.MathUtils.clamp(elapsed / DURATION, 0, 1)

      // ——— Seat rocket ———
      const boost = 1 - smoothstep(0.28, 0.9, u)
      seatVel.y -= 20 * realDt * (1 - boost * 0.65)
      seatPos.addScaledVector(seatVel, realDt)
      const seatFloor = heightAt(seatPos.x, seatPos.z) + 3
      if (seatPos.y < seatFloor) seatPos.y = seatFloor
      seat.position.copy(seatPos)
      seat.lookAt(seatPos.x, seatPos.y + 2, seatPos.z)
      plumeMat.opacity = 0.12 + boost * 0.8
      plume.scale.setScalar(0.65 + boost * 1.5)

      // ——— Abandoned airframe ———
      if (!grounded) {
        planeVel.y -= PLANE_GRAVITY * realDt
        planeVel.multiplyScalar(Math.exp(-PLANE_DRAG * realDt))
        planePos.addScaledVector(planeVel, realDt)

        // Nose drops into the dive; tumble spins up as energy bleeds.
        tumble.setFromAxisAngle(bodyX, PLANE_NOSE_DROP * realDt)
        aircraft.quaternion.multiply(tumble)
        tumbleRate += PLANE_TUMBLE_GAIN * realDt
        tumble.setFromAxisAngle(tumbleAxis, tumbleRate * realDt)
        aircraft.quaternion.premultiply(tumble)
        aircraft.quaternion.normalize()

        const groundY = heightAt(planePos.x, planePos.z)
        const agl = planePos.y - groundY
        if (agl <= CRASH_AGL) {
          planePos.y = groundY + CRASH_AGL
          // Smack: kill most vertical, skid forward, start sliding.
          const impact = Math.abs(planeVel.y)
          planeVel.y = Math.min(4, impact * 0.12)
          planeVel.x *= 0.45
          planeVel.z *= 0.45
          grounded = true
          groundedFor = 0
          tumbleRate *= 0.35
          console.info(`[Steel] Eject — airframe hit deck @ ${impact.toFixed(0)} m/s sink`)
        }
      } else {
        groundedFor += realDt
        planeVel.y = 0
        const friction = Math.exp(-GROUND_FRICTION * realDt)
        planeVel.x *= friction
        planeVel.z *= friction
        planePos.addScaledVector(planeVel, realDt)
        planePos.y = heightAt(planePos.x, planePos.z) + CRASH_AGL
        tumble.setFromAxisAngle(tumbleAxis, tumbleRate * realDt * 0.4)
        aircraft.quaternion.premultiply(tumble)
        aircraft.quaternion.normalize()
        // Once it's sliding as a wreck, end the shot a beat early.
        if (groundedFor > 0.85 && planeVel.length() < 6) {
          finish()
          return
        }
      }

      aircraft.position.copy(planePos)

      noseWorld.copy(noseLocal).applyQuaternion(aircraft.quaternion)
      fxPos.copy(planePos).addScaledVector(noseWorld, -2.2)
      fxPos.y += 0.35
      onAirframeFx?.(fxPos, grounded)

      // ——— Camera: seat ride, bias look toward the falling plane over time ———
      camGoal.copy(seatPos)
      camGoal.addScaledVector(side, SEAT_SIDE)
      camGoal.addScaledVector(WORLD_UP, 1.4)
      const back = new THREE.Vector3().subVectors(seatPos, planePos)
      if (back.lengthSq() > 1e-4) {
        back.normalize()
        camGoal.addScaledVector(back, SEAT_BACK * (0.25 + 0.35 * u))
      }

      if (elapsed < realDt * 1.5) camera.position.copy(camGoal)
      else camera.position.lerp(camGoal, 1 - Math.exp(-7 * realDt))

      // Early: seat + plane. Late: mostly the crashing airframe.
      look.lerpVectors(seatPos, planePos, 0.4 + 0.5 * u)
      camera.up.copy(WORLD_UP)
      camera.lookAt(look)
      camera.fov = THREE.MathUtils.lerp(
        FOV_START,
        THREE.MathUtils.lerp(FOV_PEAK, FOV_END, smoothstep(0.4, 1, u)),
        smoothstep(0, 0.3, u),
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
