import * as THREE from 'three'
import type { DriveProfile } from './tankCatalog'

export type DriveControls = {
  /** -1 reverse, 0 idle, +1 forward throttle */
  forward: number
  /** -1 right, +1 left */
  turn: number
  /** Hard brake toward zero speed */
  brake: boolean
}

export type DriveController = {
  getSpeed: () => number
  /** Instant zero speed (prop / wall hard-stop). */
  killSpeed: () => void
  setGroundY: (y: number) => void
  /** Dynamic terrain height (dunes). Overrides flat groundY when set. */
  setHeightAt: (fn: ((x: number, z: number) => number) | null) => void
  /** Heat / oil freeze multiplier (1 = normal). */
  setMobilityMul: (mul: number) => void
  /** Rain slip 0–1. */
  setSlip: (amount: number) => void
  update: (
    dt: number,
    controls: DriveControls,
    tank: THREE.Object3D,
    clampPos: (pos: THREE.Vector3) => void,
  ) => void
}

const TILT_SMOOTH = 8
const TRACK_HALF_W = 1.15
const TRACK_HALF_L = 1.55
const SPRING = 52
const DAMP = 14
const MAX_HANG = 0.55

/**
 * Arcade tank drive tuned per chassis profile.
 * `tank.rotation.order` becomes YXZ (yaw then pitch).
 */
export function createDriveController(profile: DriveProfile): DriveController {
  let speed = 0
  let prevSpeed = 0
  let pitchTilt = 0
  let rollTilt = 0
  let rideY: number | null = null
  let rideVel = 0
  let slipLat = 0
  let groundY = 0
  let heightAt: ((x: number, z: number) => number) | null = null
  let mobilityMul = 1
  let slip = 0

  const {
    maxSpeed,
    maxReverse,
    accel,
    reverseAccel,
    brakeDecel,
    coastDrag,
    turnRate,
    turnInPlace,
    tiltMax,
    tiltFromAccel,
  } = profile

  function sampleGround(x: number, z: number): number {
    return heightAt ? heightAt(x, z) : groundY
  }

  return {
    getSpeed: () => speed,
    killSpeed() {
      speed = 0
      prevSpeed = 0
      slipLat = 0
    },
    setGroundY(y) {
      groundY = y
    },
    setHeightAt(fn) {
      heightAt = fn
      rideY = null
      rideVel = 0
    },
    setMobilityMul(mul) {
      mobilityMul = THREE.MathUtils.clamp(mul, 0.2, 1.2)
    },
    setSlip(amount) {
      slip = THREE.MathUtils.clamp(amount, 0, 1)
    },
    update(dt, controls, tank, clampPos) {
      tank.rotation.order = 'YXZ'

      const { forward, turn, brake } = controls
      const capFwd = maxSpeed * mobilityMul
      const capRev = maxReverse * mobilityMul
      const aFwd = accel * mobilityMul
      const aRev = reverseAccel * mobilityMul
      // Wet: weaker brakes, more coast
      const brakeMul = slip > 0.2 ? 1 - slip * 0.55 : 1
      const coastMul = slip > 0.2 ? 1 - slip * 0.4 : 1

      if (brake) {
        if (speed > 0) speed = Math.max(0, speed - brakeDecel * brakeMul * dt)
        else if (speed < 0) speed = Math.min(0, speed + brakeDecel * brakeMul * dt)
      } else if (forward > 0) {
        speed = Math.min(capFwd, speed + aFwd * dt)
      } else if (forward < 0) {
        speed = Math.max(-capRev, speed - aRev * dt)
      } else {
        if (speed > 0) speed = Math.max(0, speed - coastDrag * coastMul * dt)
        else if (speed < 0) speed = Math.min(0, speed + coastDrag * coastMul * dt)
      }

      if (Math.abs(speed) < 0.02 && forward === 0 && !brake) speed = 0

      const speedRatio = Math.min(1, Math.abs(speed) / Math.max(capFwd, 0.01))
      const turnAuthority = THREE.MathUtils.lerp(turnInPlace, 1, speedRatio)
      // Rain: slightly less grip when turning
      const turnGrip = slip > 0 ? 1 - slip * 0.25 : 1
      if (turn !== 0) {
        tank.rotation.y += turn * turnRate * turnAuthority * turnGrip * dt
      }

      const yaw = tank.rotation.y
      const sy = Math.sin(yaw)
      const cy = Math.cos(yaw)

      let climbMul = 1
      if (heightAt) {
        const ahead = 2.2
        const y0 = sampleGround(tank.position.x, tank.position.z)
        const y1 = sampleGround(
          tank.position.x + sy * ahead,
          tank.position.z + cy * ahead,
        )
        const grade = (y1 - y0) / ahead
        if (grade > 0.35) climbMul = Math.max(0.25, 1 - (grade - 0.35) * 1.8)
        else if (grade < -0.4) climbMul = 1.15
      }

      tank.position.x += sy * speed * climbMul * dt
      tank.position.z += cy * speed * climbMul * dt

      // Rain slip — lateral drift
      if (slip > 0.05 && Math.abs(speed) > 0.8) {
        slipLat += (Math.random() - 0.5) * slip * 22 * dt
        slipLat *= Math.exp(-2.2 * dt)
        // right vector for yaw
        tank.position.x += cy * slipLat * dt
        tank.position.z += -sy * slipLat * dt
      } else {
        slipLat *= Math.exp(-6 * dt)
      }

      clampPos(tank.position)

      const fx = sy * TRACK_HALF_L
      const fz = cy * TRACK_HALF_L
      const rx = cy * TRACK_HALF_W
      const rz = -sy * TRACK_HALF_W
      const px = tank.position.x
      const pz = tank.position.z
      const yFL = sampleGround(px + fx - rx, pz + fz - rz)
      const yFR = sampleGround(px + fx + rx, pz + fz + rz)
      const yBL = sampleGround(px - fx - rx, pz - fz - rz)
      const yBR = sampleGround(px - fx + rx, pz - fz + rz)
      const terrainY = (yFL + yFR + yBL + yBR) * 0.25

      if (rideY == null) {
        rideY = terrainY
        rideVel = 0
      }

      const accelY = -SPRING * (rideY - terrainY) - DAMP * rideVel
      rideVel += accelY * dt
      rideY += rideVel * dt

      if (rideY < terrainY) {
        rideY = terrainY
        if (rideVel < 0) rideVel *= -0.2
      } else if (rideY > terrainY + MAX_HANG) {
        rideY = terrainY + MAX_HANG
        if (rideVel > 0) rideVel = 0
      }

      tank.position.y = rideY

      const accelNow = dt > 1e-6 ? (speed - prevSpeed) / dt : 0
      prevSpeed = speed

      const frontAvg = (yFL + yFR) * 0.5
      const backAvg = (yBL + yBR) * 0.5
      const leftAvg = (yFL + yBL) * 0.5
      const rightAvg = (yFR + yBR) * 0.5
      let terrainPitch = Math.atan2(backAvg - frontAvg, TRACK_HALF_L * 2)
      let terrainRoll = Math.atan2(rightAvg - leftAvg, TRACK_HALF_W * 2)
      terrainPitch = THREE.MathUtils.clamp(terrainPitch, -0.45, 0.45)
      terrainRoll = THREE.MathUtils.clamp(terrainRoll, -0.35, 0.35)

      const targetPitch =
        THREE.MathUtils.clamp(-accelNow * tiltFromAccel, -tiltMax, tiltMax) +
        terrainPitch
      const k = 1 - Math.exp(-TILT_SMOOTH * dt)
      pitchTilt += (targetPitch - pitchTilt) * k
      rollTilt += (terrainRoll - rollTilt) * k
      if (Math.abs(pitchTilt) < 1e-4 && Math.abs(targetPitch) < 1e-4) pitchTilt = 0
      if (Math.abs(rollTilt) < 1e-4 && Math.abs(terrainRoll) < 1e-4) rollTilt = 0
      tank.rotation.x = pitchTilt
      tank.rotation.z = rollTilt
    },
  }
}
