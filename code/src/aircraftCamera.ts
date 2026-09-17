import * as THREE from 'three'
import type { FlightTelemetry } from './aircraftFlight'

/**
 * Chase camera for the Corsair.
 *
 * The camera frame is built from the nose direction and **world up**, ignoring
 * the aircraft's roll. If the camera rolled with the aircraft, a barrel roll
 * would spin the whole screen and a loop would leave you inverted with no
 * horizon reference. Ignoring roll means you *watch* the aircraft roll inside a
 * stable frame, which is what makes arcade flight readable.
 */

const BASE_DIST = 19
const BASE_HEIGHT = 4.6
/** Camera easing — position is smoothed, aim is not, so the nose stays crisp. */
const FOLLOW_LAMBDA = 7
/** Extra trail and FOV at speed, for a sense of pace. */
const DIST_PER_SPEED = 0.055
const FOV_SPAN = 7
/** Keep this far above terrain so the view never clips into a hill. */
const GROUND_CLEARANCE = 3.5
/** How much of the bank angle leaks into camera tilt (0 = none). */
const BANK_LEAN = 0.3
const LOOK_AHEAD = 30

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const ORIGIN = new THREE.Vector3(0, 0, 0)

export type ChaseCamera = {
  update: (dt: number, tm: FlightTelemetry) => void
  /** Snap straight to the ideal pose (deploy / respawn). */
  reset: () => void
  dispose: () => void
}

export type ChaseCameraOptions = {
  camera: THREE.PerspectiveCamera
  target: THREE.Object3D
  /** World velocity, so the view leads where the aircraft is actually going. */
  velocity: THREE.Vector3
  heightAt: (x: number, z: number) => number
  maxSpeed?: number
}

export function createAircraftChaseCamera(opts: ChaseCameraOptions): ChaseCamera {
  const { camera, target, velocity, heightAt } = opts
  const maxSpeed = opts.maxSpeed ?? 110
  const baseFov = camera.fov

  const nose = new THREE.Vector3()
  const flat = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const look = new THREE.Vector3()
  const lead = new THREE.Vector3()
  const up = new THREE.Vector3()
  const velDir = new THREE.Vector3()
  const frame = new THREE.Matrix4()
  const frameQuat = new THREE.Quaternion()
  const offset = new THREE.Vector3()

  function idealPose(tm: FlightTelemetry): void {
    nose.set(0, 0, 1).applyQuaternion(target.quaternion)

    // Roll-free frame: look down the nose, but keep "up" as world up.
    // Degenerate straight up/down, so fall back to a flat heading there.
    flat.copy(nose)
    if (Math.abs(nose.y) > 0.985) {
      flat.set(nose.x, 0, nose.z)
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1)
      flat.normalize()
    }

    // Note the argument order: `Matrix4.lookAt` builds +Z pointing from target
    // back toward eye, so passing (flat, ORIGIN) makes the frame's +Z the
    // forward direction — and the offset's negative Z then reads as "behind".
    frame.lookAt(flat, ORIGIN, WORLD_UP)
    frameQuat.setFromRotationMatrix(frame)

    const speed01 = THREE.MathUtils.clamp(tm.speed / maxSpeed, 0, 1)
    offset.set(0, BASE_HEIGHT, -(BASE_DIST + tm.speed * DIST_PER_SPEED))
    offset.applyQuaternion(frameQuat)

    goal.copy(target.position).add(offset)

    // Lead the view along actual velocity, not just the nose — during a slip or
    // a stall the aircraft is not going where it is pointing.
    lead.copy(nose)
    if (velocity.lengthSq() > 1) {
      velDir.copy(velocity).normalize()
      lead.lerp(velDir, 0.35).normalize()
    }
    look.copy(target.position).addScaledVector(lead, LOOK_AHEAD)

    camera.fov = baseFov + FOV_SPAN * speed01
  }

  function applyUp(tm: FlightTelemetry): void {
    // A touch of the bank angle in the camera tilt sells the turn without
    // costing the stable horizon.
    const lean = THREE.MathUtils.degToRad(tm.bank) * BANK_LEAN
    up.copy(WORLD_UP).applyAxisAngle(nose, lean)
    camera.up.copy(up)
  }

  function finish(tm: FlightTelemetry): void {
    const floor = heightAt(camera.position.x, camera.position.z) + GROUND_CLEARANCE
    if (camera.position.y < floor) camera.position.y = floor
    applyUp(tm)
    camera.lookAt(look)
    camera.updateProjectionMatrix()
  }

  return {
    update(dt, tm) {
      idealPose(tm)
      const t = 1 - Math.exp(-FOLLOW_LAMBDA * dt)
      camera.position.lerp(goal, t)
      finish(tm)
    },
    reset() {
      const tm = { speed: 0, bank: 0 } as FlightTelemetry
      idealPose(tm)
      camera.position.copy(goal)
      finish(tm)
    },
    dispose() {
      camera.fov = baseFov
      camera.up.copy(WORLD_UP)
      camera.updateProjectionMatrix()
    },
  }
}
