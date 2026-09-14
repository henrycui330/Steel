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

const TILT_SMOOTH = 7.5
const TRACK_HALF_W = 1.15
const TRACK_HALF_L = 1.55
/** Soft spring — readable settle without earthquake rocking. */
const SPRING = 42
const DAMP = 17
const MAX_HANG = 0.28
/** Peak micro-relief amplitude (m) — subtle undulation only. */
const RELIEF_AMP = 0.045
/** How much corner-sample pitch/roll reaches the hull (0–1). */
const TERRAIN_TILT_BLEND = 0.45
/** TP1b — max bank into a turn (rad), scaled by speed. */
const TURN_LEAN_MAX = (3.2 * Math.PI) / 180
/** Brake dive stronger than throttle squat (multiplies catalog tiltFromAccel). */
const BRAKE_DIVE_MUL = 2.1
const THROTTLE_SQUAT_MUL = 1.15
/** Extra pitch clamp headroom for dive/squat vs catalog tiltMax. */
const ACCEL_PITCH_HEADROOM = 1.25
/** How fast turn-lean eases in/out (slightly snappier than terrain). */
const LEAN_SMOOTH = 9
/** TP1c — throttle catches power (1/s exp rate). */
const THROTTLE_ENGAGE = 6.5
/** TP1c — throttle falls off slower → coast inertia. */
const THROTTLE_RELEASE = 3.2
/** TP1c — brake snuffs throttle fast (still responsive). */
const THROTTLE_BRAKE = 14
/** TP1c — coast drag multiplier (<1 = longer glide). */
const COAST_INERTIA = 0.68
/** Deadzone on smoothed throttle. */
const THROTTLE_EPS = 0.03

/**
 * Soft procedural undulation under the tracks.
 * Makes spring/damper readable on flat Forest; stacks lightly on dunes.
 */
function microRelief(x: number, z: number): number {
  // Longer wavelengths only — drop high-freq chatter that felt like shaking
  const a = Math.sin(x * 0.18) * Math.cos(z * 0.16) * 0.65
  const b = Math.sin(x * 0.42 + z * 0.35) * 0.35
  return (a + b) * RELIEF_AMP
}

/**
 * Arcade tank drive tuned per chassis profile.
 * `tank.rotation.order` becomes YXZ (yaw then pitch).
 */
export function createDriveController(profile: DriveProfile): DriveController {
  let speed = 0
  let prevSpeed = 0
  let throttle = 0
  let pitchTilt = 0
  let rollTilt = 0
  let turnLean = 0
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
    const base = heightAt ? heightAt(x, z) : groundY
    return base + microRelief(x, z)
  }

  console.info(
    `[Steel] Drive TP1c — throttle lag engage=${THROTTLE_ENGAGE} release=${THROTTLE_RELEASE} · coast×${COAST_INERTIA}`,
  )

  return {
    getSpeed: () => speed,
    killSpeed() {
      speed = 0
      prevSpeed = 0
      throttle = 0
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

      // TP1c — smoothed throttle (brake cuts fast; release coasts)
      const want = brake ? 0 : forward
      let thrRate = THROTTLE_ENGAGE
      if (brake) thrRate = THROTTLE_BRAKE
      else if (want === 0) thrRate = THROTTLE_RELEASE
      else if (Math.sign(want) !== Math.sign(throttle) && Math.abs(throttle) > 0.05) {
        // Direction flip — dump old throttle a bit quicker
        thrRate = THROTTLE_ENGAGE * 1.35
      }
      throttle += (want - throttle) * (1 - Math.exp(-thrRate * dt))
      if (Math.abs(throttle) < 0.008) throttle = 0

      if (brake) {
        if (speed > 0) speed = Math.max(0, speed - brakeDecel * brakeMul * dt)
        else if (speed < 0) speed = Math.min(0, speed + brakeDecel * brakeMul * dt)
      } else if (throttle > THROTTLE_EPS) {
        speed = Math.min(capFwd, speed + aFwd * throttle * dt)
      } else if (throttle < -THROTTLE_EPS) {
        speed = Math.max(-capRev, speed - aRev * -throttle * dt)
      } else {
        const drag = coastDrag * coastMul * COAST_INERTIA
        if (speed > 0) speed = Math.max(0, speed - drag * dt)
        else if (speed < 0) speed = Math.min(0, speed + drag * dt)
      }

      if (Math.abs(speed) < 0.02 && Math.abs(throttle) < THROTTLE_EPS && !brake) {
        speed = 0
      }
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
      // Always sample relief (and dunes when heightAt is set)
      {
        const ahead = 2.2
        const y0 = sampleGround(tank.position.x, tank.position.z)
        const y1 = sampleGround(
          tank.position.x + sy * ahead,
          tank.position.z + cy * ahead,
        )
        const grade = (y1 - y0) / ahead
        if (grade > 0.28) climbMul = Math.max(0.3, 1 - (grade - 0.28) * 1.6)
        else if (grade < -0.35) climbMul = 1.12
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
        // Contact — light rebound (was too punchy)
        rideY = terrainY
        if (rideVel < 0) rideVel *= -0.18
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
      terrainPitch = THREE.MathUtils.clamp(terrainPitch, -0.22, 0.22) * TERRAIN_TILT_BLEND
      terrainRoll = THREE.MathUtils.clamp(terrainRoll, -0.18, 0.18) * TERRAIN_TILT_BLEND

      // TP1b — accel: nose up (squat); brake: nose down (dive). Sign was inverted before.
      const accelGain =
        tiltFromAccel * (accelNow < 0 || brake ? BRAKE_DIVE_MUL : THROTTLE_SQUAT_MUL)
      const pitchCap = tiltMax * ACCEL_PITCH_HEADROOM
      const pitchFromAccel = THREE.MathUtils.clamp(
        accelNow * accelGain,
        -pitchCap,
        pitchCap,
      )

      // Lean into turn: +turn = left → +roll (left side down). Speed gates the lean.
      const leanTarget = THREE.MathUtils.clamp(
        turn * speedRatio * TURN_LEAN_MAX,
        -TURN_LEAN_MAX,
        TURN_LEAN_MAX,
      )
      const leanK = 1 - Math.exp(-LEAN_SMOOTH * dt)
      turnLean += (leanTarget - turnLean) * leanK
      if (Math.abs(turnLean) < 1e-4 && Math.abs(leanTarget) < 1e-4) turnLean = 0

      const targetPitch = pitchFromAccel + terrainPitch
      const targetRoll = terrainRoll + turnLean
      const k = 1 - Math.exp(-TILT_SMOOTH * dt)
      pitchTilt += (targetPitch - pitchTilt) * k
      rollTilt += (targetRoll - rollTilt) * k
      if (Math.abs(pitchTilt) < 1e-4 && Math.abs(targetPitch) < 1e-4) pitchTilt = 0
      if (Math.abs(rollTilt) < 1e-4 && Math.abs(targetRoll) < 1e-4) rollTilt = 0
      tank.rotation.x = pitchTilt
      tank.rotation.z = rollTilt
    },
  }
}
