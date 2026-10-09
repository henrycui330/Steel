import * as THREE from 'three'
import type { DriveProfile, MassClass } from './tankCatalog'

export type DriveControls = {
  /** -1 reverse, 0 idle, +1 forward throttle */
  forward: number
  /** -1 right, +1 left */
  turn: number
  /** Hard brake toward zero speed */
  brake: boolean
}

/** Per-track longitudinal speeds (m/s) — TR3 dual-track. */
export type TrackSpeeds = {
  left: number
  right: number
}

export type DriveController = {
  getSpeed: () => number
  /** Left / right track speeds for tread scroll + wheels. */
  getTrackSpeeds: () => TrackSpeeds
  /** Smoothed throttle −1…+1 (for engine / immersion). */
  getThrottle: () => number
  /** Vertical ride velocity (m/s) — bumps / landings. */
  getRideVel: () => number
  /** True while crest-flying / hang above terrain. */
  isAirborne: () => boolean
  /** Instant zero speed (prop / wall hard-stop). */
  killSpeed: () => void
  setGroundY: (y: number) => void
  /** Dynamic terrain height (dunes). Overrides flat groundY when set. */
  setHeightAt: (fn: ((x: number, z: number) => number) | null) => void
  /** Heat / oil freeze multiplier (1 = normal). Kept for API; climate pens removed. */
  setMobilityMul: (mul: number) => void
  /** Rain slip 0–1. */
  setSlip: (amount: number) => void
  /**
   * TR5 — module track outs. Dead side speed = 0 → hull circles that way.
   * Both out → immobilized (caller should also brake).
   */
  setTrackOut: (leftOut: boolean, rightOut: boolean) => void
  update: (
    dt: number,
    controls: DriveControls,
    tank: THREE.Object3D,
    clampPos: (pos: THREE.Vector3) => void,
  ) => void
}

const TILT_SMOOTH = 7.5
/** Half-gauge / half-wheelbase for track contact samples (m). */
const TRACK_HALF_W = 1.15
const TRACK_HALF_L = 1.55
/**
 * TR2 suspension — softer spring + heavier damp so bumps compress then settle
 * instead of telegraph-pole bounce.
 */
const SPRING = 28
const DAMP = 22
/** Grounded hang above support filter (m). */
const MAX_HANG = 0.42
/** Peak micro-relief amplitude (m) — subtle undulation only. */
const RELIEF_AMP = 0.045
/** Contact samples use quieter relief so crests don’t chatter. */
const CONTACT_RELIEF_SCALE = 0.18
/**
 * Fore→aft stations along each track (−1…+1 × TRACK_HALF_L).
 * Mid stations catch hill summits so ends can hang clear of dirt.
 */
const TRACK_STATIONS = [-1, -0.5, 0, 0.5, 1] as const
/** Tiny lift so treads sit on top of the heightfield, not in it. */
const CONTACT_EPS = 0.03
/** How much support-plane pitch/roll reaches the hull (0–1). */
const TERRAIN_TILT_BLEND = 0.88
/**
 * TR2 — support filter: max rise rate (m/s) when ground comes up under the
 * tracks (reads as suspension compress). Drop uses SUSP_EXTEND.
 */
const SUSP_COMPRESS_RATE = 4.5
/** Max lag below raw clearance before we catch up (m). */
const MAX_COMPRESS_LAG = 0.22
/** How fast filtered support falls when terrain drops (1/s). */
const SUSP_EXTEND = 5.5
/** Extra pitch when only nose or only tail is on dirt (rad). */
const WEDGE_PITCH = (3.2 * Math.PI) / 180
/** How fast wedge eases in/out. */
const WEDGE_SMOOTH = 6.5
/** Sample counts as “on dirt” if within this of the clearance constraint (m). */
const SUPPORT_EPS = 0.06
/** Track gauge (m) — yaw = (vR − vL) / TRACK_GAUGE. */
export const TRACK_GAUGE = TRACK_HALF_W * 2
/** TP1b — max bank into a turn (rad), scaled by speed. */
const TURN_LEAN_MAX = (4.8 * Math.PI) / 180
/** Brake dive stronger than throttle squat (multiplies catalog tiltFromAccel). */
const BRAKE_DIVE_MUL = 2.55
const THROTTLE_SQUAT_MUL = 1.35
/** Extra pitch clamp headroom for dive/squat vs catalog tiltMax. */
const ACCEL_PITCH_HEADROOM = 1.35
/** How fast turn-lean eases in/out (slightly snappier than terrain). */
const LEAN_SMOOTH = 8
/** TP1c — throttle catches power (1/s exp rate). */
const THROTTLE_ENGAGE = 5.2
/** TP1c — throttle falls off slower → coast inertia. */
const THROTTLE_RELEASE = 2.15
/** TP1c — brake snuffs throttle fast (still responsive). */
const THROTTLE_BRAKE = 12
/** TP1c — coast drag multiplier (<1 = longer glide). */
const COAST_INERTIA = 0.42
/** Deadzone on smoothed throttle. */
const THROTTLE_EPS = 0.03
/**
 * Global arcade pace — soft enough for massClass to read, not a crawl.
 */
export const SPEED_FEEL = 1.32
/**
 * At full speed, turn authority falls toward this fraction of catalog turnRate
 * (WT: heavy chassis won't pivot at pace).
 */
const TURN_AT_SPEED = 0.32
/** Exponent on speedRatio for turn falloff (>1 = stays agile longer, then dumps). */
const TURN_SPEED_EXP = 1.55
/** Grade (rise/run) where uphill tax begins. */
const GRADE_TAX_START = 0.16
/** Downhill push begins below this grade. */
const GRADE_PUSH_START = -0.2
/** Base grade accel (m/s² per unit grade) — scaled by mass. */
const GRADE_FORCE = 11
/** Cap downhill speed bonus vs catalog top (fraction). */
const GRADE_DOWN_CAP = 1.12
/** Airborne gravity (m/s²) while crest-flying. */
const AIR_GRAVITY = 26
/** Max meters above terrain while airborne. */
const MAX_AIR = 3.4
/** Need this fraction of top speed before a crest can launch you. */
const CREST_SPEED_FRAC = 0.4
/** Uphill grade (rise/run) that arms a crest launch. */
const CREST_ARM_GRADE = 0.11
/** Downhill grade that triggers launch once armed. */
const CREST_FIRE_GRADE = -0.04
/** Upward launch scale: rideVel += |speed| * armedGrade * this. */
const CREST_LAUNCH = 1.85
/** Extra launch from how hard the slope pitches over. */
const CREST_SNAP = 0.55
/** Airborne only if hull clears support by this much (m). */
const AIR_SEPARATION = 0.12

/** TR4 — per-class inertia / grade / suspension multipliers. */
type MassFeel = {
  /** Multiplies accel / reverseAccel (light > 1). */
  accelMul: number
  /** Multiplies brakeDecel. */
  brakeMul: number
  /** Multiplies throttle engage rate. */
  thrEngageMul: number
  /** Multiplies throttle release rate. */
  thrReleaseMul: number
  /** Track speed catch-up rate (1/s) toward commanded vL/vR. */
  trackCatch: number
  /** Spring / damp scale for ride. */
  springMul: number
  dampMul: number
  /** Uphill grade force scale. */
  gradeTax: number
  /** Downhill grade force scale. */
  gradePush: number
  /** Floor on residual climbMul (don't stuck on mild slopes). */
  climbFloor: number
}

const MASS_FEEL: Record<MassClass, MassFeel> = {
  light: {
    accelMul: 1.12,
    brakeMul: 1.1,
    thrEngageMul: 1.22,
    thrReleaseMul: 1.15,
    trackCatch: 16,
    springMul: 1.1,
    dampMul: 0.95,
    gradeTax: 0.85,
    gradePush: 1.05,
    climbFloor: 0.52,
  },
  medium: {
    accelMul: 1,
    brakeMul: 1,
    thrEngageMul: 1,
    thrReleaseMul: 1,
    trackCatch: 11,
    springMul: 1,
    dampMul: 1,
    gradeTax: 1,
    gradePush: 1.08,
    climbFloor: 0.42,
  },
  heavy: {
    accelMul: 0.9,
    brakeMul: 0.88,
    thrEngageMul: 0.78,
    thrReleaseMul: 0.8,
    trackCatch: 7,
    springMul: 0.9,
    dampMul: 1.12,
    gradeTax: 1.28,
    gradePush: 1.18,
    climbFloor: 0.32,
  },
}

/**
 * Soft procedural undulation under the tracks.
 * Makes spring/damper readable on flat Forest; stacks lightly on dunes.
 */
function microRelief(x: number, z: number, scale = 1): number {
  // Longer wavelengths only — drop high-freq chatter that felt like shaking
  const a = Math.sin(x * 0.18) * Math.cos(z * 0.16) * 0.65
  const b = Math.sin(x * 0.42 + z * 0.35) * 0.35
  return (a + b) * RELIEF_AMP * scale
}

type TrackSample = {
  /** Forward offset along hull (+Z), metres. */
  f: number
  /** Right offset (+X via yaw frame), metres. */
  r: number
  gy: number
}

/**
 * Arcade tank drive tuned per chassis profile.
 * `tank.rotation.order` becomes YXZ (yaw then pitch).
 *
 * TR1 — multi-point track contact: hull clears the worst dig-in under L/R
 * tread runs so crests wedge mid-track and free ends hang (no phase-through).
 * TR2 — suspension filter (compress / extend) + wedge pitch on single-end plant.
 * TR3 — dual-track: vL/vR → hull speed + yaw (pivot crawl, wide radius at pace).
 * TR4 — massClass inertia + grade force (heavies late / struggle uphill).
 * TR5 — track module out → that side v=0 (circle toward dead side).
 */
export function createDriveController(profile: DriveProfile): DriveController {
  let speed = 0
  /** Left / right track longitudinal speeds (m/s). */
  let vL = 0
  let vR = 0
  /** Filtered track differential (vR − vL) — mass lag on steer only. */
  let trackDiffFilt = 0
  let prevSpeed = 0
  let throttle = 0
  let pitchTilt = 0
  let rollTilt = 0
  let turnLean = 0
  let rideY: number | null = null
  let rideVel = 0
  /** Filtered support height — lags rises (compress), follows drops (extend). */
  let clearanceFilt: number | null = null
  let wedgeTilt = 0
  let slipLat = 0
  let groundY = 0
  let heightAt: ((x: number, z: number) => number) | null = null
  let mobilityMul = 1
  let slip = 0
  let airborne = false
  let prevGrade = 0
  /** Peak uphill grade while armed — spent on crest launch. */
  let armedGrade = 0
  let leftTrackOut = false
  let rightTrackOut = false
  let lastTrackOutLog = 'ok'

  const {
    maxSpeed: catalogMaxSpeed,
    maxReverse: catalogMaxReverse,
    accel: catalogAccel,
    reverseAccel: catalogReverseAccel,
    brakeDecel: catalogBrakeDecel,
    coastDrag,
    turnRate,
    turnInPlace,
    tiltMax,
    tiltFromAccel,
    massClass,
  } = profile

  const mass = MASS_FEEL[massClass]
  const maxSpeed = catalogMaxSpeed * SPEED_FEEL
  const maxReverse = catalogMaxReverse * SPEED_FEEL
  const accel = catalogAccel * SPEED_FEEL * mass.accelMul
  const reverseAccel = catalogReverseAccel * SPEED_FEEL * mass.accelMul
  const brakeDecel = catalogBrakeDecel * mass.brakeMul
  const springK = SPRING * mass.springMul
  const dampK = DAMP * mass.dampMul
  const sampleCount = TRACK_STATIONS.length * 2

  function sampleGround(x: number, z: number, reliefScale = 1): number {
    const base = heightAt ? heightAt(x, z) : groundY
    return base + microRelief(x, z, reliefScale)
  }

  /**
   * World XZ under the track run, then quiet height samples.
   * Side −1 = left, +1 = right (game right = +yaw cross up).
   */
  function collectTrackSamples(px: number, pz: number, sy: number, cy: number): TrackSample[] {
    const out: TrackSample[] = []
    for (const station of TRACK_STATIONS) {
      const f = station * TRACK_HALF_L
      for (const side of [-1, 1] as const) {
        const r = side * TRACK_HALF_W
        // Nose (+Z) and right in XZ from yaw.
        const x = px + sy * f + cy * r
        const z = pz + cy * f - sy * r
        out.push({
          f,
          r,
          gy: sampleGround(x, z, CONTACT_RELIEF_SCALE),
        })
      }
    }
    return out
  }

  /**
   * Rigid clearance: every track sample must sit on/above ground after pitch/roll.
   * relativeY ≈ −f·sin(pitch) + r·sin(roll) (YXZ small-angle; matches existing tilt sign).
   */
  function clearanceFromSamples(
    samples: readonly TrackSample[],
    pitch: number,
    roll: number,
  ): {
    clearanceY: number
    terrainPitch: number
    terrainRoll: number
    /** + = only nose on dirt (wedge nose-down); − = only tail. */
    wedgePitch: number
  } {
    let yFore = 0
    let yAft = 0
    let nFore = 0
    let nAft = 0
    let yLeft = 0
    let yRight = 0
    let nLeft = 0
    let nRight = 0
    for (const s of samples) {
      if (s.f > 0.05) {
        yFore += s.gy
        nFore++
      } else if (s.f < -0.05) {
        yAft += s.gy
        nAft++
      }
      if (s.r < -0.05) {
        yLeft += s.gy
        nLeft++
      } else if (s.r > 0.05) {
        yRight += s.gy
        nRight++
      }
    }
    const frontAvg = nFore > 0 ? yFore / nFore : samples[0]!.gy
    const backAvg = nAft > 0 ? yAft / nAft : samples[0]!.gy
    const leftAvg = nLeft > 0 ? yLeft / nLeft : samples[0]!.gy
    const rightAvg = nRight > 0 ? yRight / nRight : samples[0]!.gy

    let terrainPitch = Math.atan2(backAvg - frontAvg, TRACK_HALF_L * 2)
    let terrainRoll = Math.atan2(rightAvg - leftAvg, TRACK_HALF_W * 2)
    terrainPitch = THREE.MathUtils.clamp(terrainPitch, -0.28, 0.28)
    terrainRoll = THREE.MathUtils.clamp(terrainRoll, -0.24, 0.24)

    const sinP = Math.sin(pitch)
    const sinR = Math.sin(roll)

    let clearanceY = -Infinity
    for (const s of samples) {
      const relY = -s.f * sinP + s.r * sinR
      clearanceY = Math.max(clearanceY, s.gy - relY + CONTACT_EPS)
    }
    if (!Number.isFinite(clearanceY)) {
      clearanceY = samples.reduce((a, s) => a + s.gy, 0) / Math.max(1, samples.length)
    }

    // TR2 wedge — which stations are actually carrying the hull?
    let foreSupport = false
    let aftSupport = false
    for (const s of samples) {
      const relY = -s.f * sinP + s.r * sinR
      const needY = s.gy - relY + CONTACT_EPS
      if (needY < clearanceY - SUPPORT_EPS) continue
      if (s.f > 0.2) foreSupport = true
      if (s.f < -0.2) aftSupport = true
    }
    let wedgePitch = 0
    if (foreSupport && !aftSupport) wedgePitch = WEDGE_PITCH
    else if (aftSupport && !foreSupport) wedgePitch = -WEDGE_PITCH

    return {
      clearanceY,
      terrainPitch: terrainPitch * TERRAIN_TILT_BLEND,
      terrainRoll: terrainRoll * TERRAIN_TILT_BLEND,
      wedgePitch,
    }
  }

  console.info(
    `[Steel] Drive TR5 · mass ${massClass} · feel ${SPEED_FEEL} · gauge ${TRACK_GAUGE.toFixed(2)}m · track-out · ${sampleCount} samples`,
  )

  return {
    getSpeed: () => (vL + vR) * 0.5,
    getTrackSpeeds: () => ({ left: vL, right: vR }),
    getThrottle: () => throttle,
    getRideVel: () => rideVel,
    isAirborne: () => airborne,
    killSpeed() {
      speed = 0
      vL = 0
      vR = 0
      trackDiffFilt = 0
      prevSpeed = 0
      throttle = 0
      slipLat = 0
      airborne = false
      armedGrade = 0
      prevGrade = 0
      rideVel = 0
      clearanceFilt = null
      wedgeTilt = 0
    },
    setGroundY(y) {
      groundY = y
    },
    setHeightAt(fn) {
      heightAt = fn
      rideY = null
      clearanceFilt = null
      rideVel = 0
      wedgeTilt = 0
      airborne = false
      armedGrade = 0
      prevGrade = 0
    },
    setMobilityMul(mul) {
      mobilityMul = THREE.MathUtils.clamp(mul, 0.2, 1.2)
    },
    setSlip(amount) {
      slip = THREE.MathUtils.clamp(amount, 0, 1)
    },
    setTrackOut(leftOut, rightOut) {
      leftTrackOut = leftOut
      rightTrackOut = rightOut
      const key =
        leftOut && rightOut ? 'both' : leftOut ? 'L' : rightOut ? 'R' : 'ok'
      if (key !== lastTrackOutLog) {
        lastTrackOutLog = key
        if (key === 'L') console.info('[Steel] Track L OUT → vL=0')
        else if (key === 'R') console.info('[Steel] Track R OUT → vR=0')
        else if (key === 'both') console.info('[Steel] Tracks BOTH OUT → immobilized')
        else console.info('[Steel] Tracks OK — dual drive restored')
      }
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

      // TP1c — smoothed throttle (brake cuts fast; release coasts); TR4 mass scales rates
      const want = brake ? 0 : forward
      let thrRate = THROTTLE_ENGAGE * mass.thrEngageMul
      if (brake) thrRate = THROTTLE_BRAKE
      else if (want === 0) thrRate = THROTTLE_RELEASE * mass.thrReleaseMul
      else if (Math.sign(want) !== Math.sign(throttle) && Math.abs(throttle) > 0.05) {
        // Direction flip — dump old throttle a bit quicker
        thrRate = THROTTLE_ENGAGE * mass.thrEngageMul * 1.35
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

      // Sample grade early — TR4 applies force to speed before track split.
      const yawProbe = tank.rotation.y
      const syProbe = Math.sin(yawProbe)
      const cyProbe = Math.cos(yawProbe)
      let grade = 0
      {
        const ahead = 2.2
        const y0 = sampleGround(tank.position.x, tank.position.z)
        const y1 = sampleGround(
          tank.position.x + syProbe * ahead,
          tank.position.z + cyProbe * ahead,
        )
        grade = (y1 - y0) / ahead
      }

      // TR4 — grade force on hull speed (heavies tax harder uphill).
      if (!airborne && Math.abs(speed) > 0.05) {
        let gForce = 0
        if (grade > GRADE_TAX_START) {
          gForce = -(grade - GRADE_TAX_START) * GRADE_FORCE * mass.gradeTax
        } else if (grade < GRADE_PUSH_START) {
          gForce = -(grade - GRADE_PUSH_START) * GRADE_FORCE * 0.55 * mass.gradePush
        }
        speed += gForce * dt
        const downCap = capFwd * GRADE_DOWN_CAP
        if (speed > downCap) speed = downCap
        if (speed < -capRev) speed = -capRev
        // Mild floor: still crawling uphill if throttle held (no forever-stuck).
        if (
          throttle > THROTTLE_EPS &&
          grade > GRADE_TAX_START &&
          speed < capFwd * 0.1
        ) {
          speed = Math.max(speed, capFwd * 0.08)
        }
      }

      const speedRatio = Math.min(1, Math.abs(speed) / Math.max(capFwd, 0.01))
      // Heavy at pace — agile when crawling / neutral steer (pivot).
      const turnSpeedT = Math.pow(speedRatio, TURN_SPEED_EXP)
      const turnAuthority = THREE.MathUtils.lerp(turnInPlace, TURN_AT_SPEED, turnSpeedT)
      // Rain: slightly less grip when turning
      const turnGrip = slip > 0 ? 1 - slip * 0.25 : 1
      // TR3/4 — lag differential only (steer inertia). Never write speed from
      // lagged tracks — that multiplied accel by catchK (~0.1) and made 0→10 take ~20s.
      const yawWant = turn * turnRate * turnAuthority * turnGrip
      const wantDiff = yawWant * TRACK_GAUGE
      const catchK = 1 - Math.exp(-mass.trackCatch * dt)
      trackDiffFilt += (wantDiff - trackDiffFilt) * catchK
      if (Math.abs(trackDiffFilt) < 1e-4 && Math.abs(wantDiff) < 1e-4) trackDiffFilt = 0
      vL = speed - trackDiffFilt * 0.5
      vR = speed + trackDiffFilt * 0.5

      // TR5 — dead track locked at 0. Keep `speed` as commanded live-track
      // target (don't write average back — that collapsed 0→10 every frame).
      if (leftTrackOut && rightTrackOut) {
        vL = 0
        vR = 0
        speed = 0
        trackDiffFilt = 0
        throttle = 0
      } else if (leftTrackOut) {
        vL = 0
        // Live right track runs at commanded speed (± steer bias already in vR).
        vR = speed + trackDiffFilt * 0.5
      } else if (rightTrackOut) {
        vR = 0
        vL = speed - trackDiffFilt * 0.5
      }

      const moveSpeed = (vL + vR) * 0.5
      const yawRate = (vR - vL) / TRACK_GAUGE
      if (Math.abs(yawRate) > 1e-5) {
        tank.rotation.y += yawRate * dt
      }

      const yaw = tank.rotation.y
      const sy = Math.sin(yaw)
      const cy = Math.cos(yaw)

      // Soft residual climbMul (don't double-tax hard — force already on speed).
      let climbMul = 1
      if (grade > GRADE_TAX_START) {
        climbMul = Math.max(
          mass.climbFloor,
          1 - (grade - GRADE_TAX_START) * 0.55 * mass.gradeTax,
        )
      } else if (grade < GRADE_PUSH_START) {
        climbMul = Math.min(1.12, 1 + (-grade + GRADE_PUSH_START) * 0.25 * mass.gradePush)
      }

      tank.position.x += sy * moveSpeed * climbMul * dt
      tank.position.z += cy * moveSpeed * climbMul * dt

      // Rain slip — lateral drift; brief brake-turn skid (TR4).
      const brakeSkid =
        brake && Math.abs(turn) > 0.2 && Math.abs(moveSpeed) > 1.2 ? 0.35 : 0
      const slipEff = Math.max(slip, brakeSkid)
      if (slipEff > 0.05 && Math.abs(moveSpeed) > 0.8) {
        slipLat += (Math.random() - 0.5) * slipEff * 22 * dt
        slipLat *= Math.exp(-2.2 * dt)
        // right vector for yaw
        tank.position.x += cy * slipLat * dt
        tank.position.z += -sy * slipLat * dt
      } else {
        slipLat *= Math.exp(-6 * dt)
      }

      clampPos(tank.position)

      // ——— TR1 contact + TR2 suspension filter / wedge ———
      const samples = collectTrackSamples(tank.position.x, tank.position.z, sy, cy)
      // Support plane from heights (unscaled), then clearance with that plane.
      const plane = clearanceFromSamples(samples, 0, 0)
      const rawPitch = plane.terrainPitch / Math.max(TERRAIN_TILT_BLEND, 0.01)
      const rawRoll = plane.terrainRoll / Math.max(TERRAIN_TILT_BLEND, 0.01)
      const contact = clearanceFromSamples(samples, rawPitch, rawRoll)
      const clearanceY = contact.clearanceY
      let terrainPitch = plane.terrainPitch
      let terrainRoll = plane.terrainRoll

      // Rate-limit rising support (compress); ease down when terrain falls (extend).
      if (clearanceFilt == null) {
        clearanceFilt = clearanceY
      } else if (clearanceY >= clearanceFilt) {
        clearanceFilt = Math.min(
          clearanceY,
          clearanceFilt + SUSP_COMPRESS_RATE * dt,
        )
        if (clearanceY - clearanceFilt > MAX_COMPRESS_LAG) {
          clearanceFilt = clearanceY - MAX_COMPRESS_LAG
        }
      } else {
        clearanceFilt +=
          (clearanceY - clearanceFilt) * (1 - Math.exp(-SUSP_EXTEND * dt))
        // Never filter below raw clearance (would invite dig-in).
        clearanceFilt = Math.max(clearanceFilt, clearanceY)
      }

      const supportY = clearanceFilt

      if (rideY == null) {
        rideY = supportY
        rideVel = 0
        airborne = false
      }

      // Arm crest: climbing at pace stores peak uphill grade
      if (
        !airborne &&
        Math.abs(speed) >= capFwd * CREST_SPEED_FRAC &&
        grade > CREST_ARM_GRADE
      ) {
        armedGrade = Math.max(armedGrade, grade)
      } else if (!airborne && grade < CREST_ARM_GRADE * 0.5) {
        // Fade arm if you slow / level out without pitching over
        armedGrade *= Math.exp(-2.5 * dt)
        if (armedGrade < 0.04) armedGrade = 0
      }

      // Fire: slope pitches from climb → drop while still fast
      if (
        !airborne &&
        armedGrade >= CREST_ARM_GRADE &&
        Math.abs(speed) >= capFwd * CREST_SPEED_FRAC &&
        grade <= CREST_FIRE_GRADE &&
        prevGrade > CREST_FIRE_GRADE
      ) {
        const snap = Math.max(0, armedGrade - grade)
        const launch =
          Math.abs(speed) * armedGrade * CREST_LAUNCH +
          Math.abs(speed) * snap * CREST_SNAP
        rideVel = Math.max(rideVel, launch)
        airborne = true
        armedGrade = 0
      }
      prevGrade = grade

      if (airborne) {
        rideVel -= AIR_GRAVITY * dt
        rideY += rideVel * dt
        if (rideY <= clearanceY) {
          rideY = clearanceY
          clearanceFilt = clearanceY
          if (rideVel < -3.5) rideVel *= -0.14
          else rideVel = 0
          airborne = false
        } else if (rideY > clearanceY + MAX_AIR) {
          rideY = clearanceY + MAX_AIR
          if (rideVel > 0) rideVel = 0
        }
      } else {
        // Spring toward filtered support (compress/extend feel); TR4 mass scales.
        const accelY = -springK * (rideY - supportY) - dampK * rideVel
        rideVel += accelY * dt
        rideY += rideVel * dt

        // Hard floor — never phase through raw clearance.
        if (rideY < clearanceY) {
          rideY = clearanceY
          if (rideVel < 0) rideVel *= -0.12
        } else if (rideY > supportY + MAX_HANG) {
          rideY = supportY + MAX_HANG
          if (rideVel > 0) rideVel = 0
        }
        if (rideY > clearanceY + AIR_SEPARATION && rideVel > 1.2) {
          airborne = true
        }
      }

      tank.position.y = rideY

      const hullSpeed = (vL + vR) * 0.5
      const accelNow = dt > 1e-6 ? (hullSpeed - prevSpeed) / dt : 0
      prevSpeed = hullSpeed

      // TR2 wedge pitch toward the planted end.
      const wedgeK = 1 - Math.exp(-WEDGE_SMOOTH * dt)
      const wedgeTarget = airborne ? 0 : contact.wedgePitch
      wedgeTilt += (wedgeTarget - wedgeTilt) * wedgeK
      if (Math.abs(wedgeTilt) < 1e-4 && Math.abs(wedgeTarget) < 1e-4) wedgeTilt = 0

      // While airborne, keep a bit of nose-up from the launch then ease to flat fall
      if (airborne) {
        terrainPitch *= 0.35
        terrainRoll *= 0.35
      }

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

      const targetPitch = pitchFromAccel + terrainPitch + wedgeTilt
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
