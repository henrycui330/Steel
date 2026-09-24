import * as THREE from 'three'
import type { FlightInput } from './input'

/**
 * Arcade flight model for the Corsair.
 *
 * Body convention matches the rig: nose **+Z**, up **+Y**, and the **right wing
 * is −X** (right = forward × up, which for +Z forward and +Y up gives −X — the
 * easy mistake is assuming +X). So roll turns about Z, pitch about X (negative
 * = nose up), yaw about Y — and a **positive** Y rotation swings the nose
 * toward +X, i.e. to the **left**, so turning right is a negative Y rotation.
 *
 * Deliberately arcade: a real Corsair cruises ~186 m/s and would cross Forest
 * Overwatch's 750 m width in 4 s. Cruise here is ~70 m/s (≈10 s across), the
 * same "scaled" treatment the shells already get.
 */

/** Throttle 0 → idle, 1 → full. Cruise (~70 m/s) sits near half throttle. */
const IDLE_SPEED = 25
const MAX_SPEED = 110
/** Below this the wing stops holding the aircraft up (soft, not instant death). */
const STALL_SPEED = 32
const SPEED_ACCEL = 18
/** Gravity feeding airspeed: nose down gains knots, nose up bleeds them. */
const DIVE_SPEED_GAIN = 26
const GRAVITY = 24

const THROTTLE_RATE = 0.55

// Stick rates kept low on purpose — high rates plus auto-level fight each other.
const PITCH_RATE = 1.1
const ROLL_RATE = 2.0
const RUDDER_RATE = 0.55
/** Bank-to-turn: banked lift pulls the nose around. */
const TURN_K = 0.62

// Hands-off recovery. Levels to the HORIZON, never to nose-up.
const LEVEL_PITCH_K = 1.6
const LEVEL_PITCH_MAX = 0.8
const LEVEL_ROLL_K = 2.2
const LEVEL_ROLL_MAX = 1.6

/** Belly clearance — below this above terrain counts as hitting the ground. */
const CRASH_AGL = 2.5
/** Climb is bled off over this depth below the ceiling, so it feels like thin air. */
const CEILING_SOFT = 60
/**
 * Soft turn-back band inside the arena edge. These are sized against the
 * geometry, not taste: at full throttle the aircraft crosses the band in ~1.4 s,
 * while a 180° turn needs ~1.4 s at 2.2 rad/s, so the turn only beats the wall
 * if authority is high *and* the band bleeds speed. Undercooking either one
 * leaves the aircraft sliding along the hard clamp, which reads as a bug.
 */
const EDGE_MARGIN = 150
const TURNBACK_K = 1.8
const TURNBACK_MAX = 2.2
/** Fraction of top speed lost at the outer edge of the band. */
const EDGE_SPEED_BLEED = 0.4

/** Deadstick after shot-down: gravity pull while airspeed bleeds. */
const FLAMEOUT_GRAVITY = 28
const FLAMEOUT_DRAG = 0.38
const FLAMEOUT_TUMBLE = 0.55
const FLAMEOUT_NOSE_HEAVY = 0.32

/** Pugachev's Cobra — arcade timing. */
const COBRA_MIN_SPEED = 48
const COBRA_COOLDOWN = 5.5
const COBRA_PULL_SEC = 0.42
const COBRA_HOLD_SEC = 0.28
const COBRA_RECOVER_SEC = 0.85
const COBRA_PEAK_PITCH = 1.72 // ~98°
const COBRA_PULL_RATE = 4.2

const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const WORLD_UP = new THREE.Vector3(0, 1, 0)

export type FlightTelemetry = {
  speed: number
  throttle: number
  /** Metres above the terrain. */
  agl: number
  altitude: number
  /** Compass heading in degrees. */
  heading: number
  /** Bank angle in degrees, positive = right wing down. */
  bank: number
  pitch: number
  stalled: boolean
  handsOff: boolean
  /** In the thin-air band below the ceiling. */
  nearCeiling: boolean
  /** In the turn-back band near the arena edge. */
  nearEdge: boolean
  crashed: boolean
  /** Shot-down deadstick — engine out, tumbling toward the deck. */
  flameout: boolean
  /** True while Pugachev's Cobra is playing. */
  cobra: boolean
}

export type AircraftFlight = {
  update: (dt: number, input: FlightInput) => FlightTelemetry
  telemetry: () => FlightTelemetry
  /** World-space velocity — chase camera and, later, gun leading. */
  velocity: THREE.Vector3
  noseDir: () => THREE.Vector3
  /**
   * KOTH / retry: put the aircraft back in the air after a crash.
   * Clears the crashed latch and restores arcade cruise.
   */
  reset: (pos: THREE.Vector3, yaw: number, throttle01?: number) => void
  /** Stop the aircraft immediately (eject / external kill). Does not fire onCrash. */
  forceCrash: () => void
  /**
   * Shot down: cut the engine and keep integrating as a burning deadstick
   * until terrain contact fires `onCrash`. No-op if already crashed / flameout.
   * `hard` = catastrophic hit — steeper sink, still glides (never freezes mid-air).
   */
  beginFlameout: (severity?: 'normal' | 'hard') => void
  isFlameout: () => boolean
}

export type FlightOptions = {
  root: THREE.Object3D
  /** Terrain sampler, so "altitude" means above ground. */
  heightAt: (x: number, z: number) => number
  /** Initial throttle (0–1). */
  throttle?: number
  /** Playable half-extents: soft turn-back inside the margin, hard stop at the edge. */
  bounds?: { x: number; z: number }
  /** Hard altitude ceiling (world Y). */
  ceiling?: number
  /** Su-27: allow Pugachev's Cobra on input.cobra (T). */
  canCobra?: boolean
  /** Fired once, when the aircraft touches terrain. */
  onCrash?: (info: { speed: number; agl: number }) => void
}

export function createAircraftFlight(opts: FlightOptions): AircraftFlight {
  const { root, heightAt, bounds, ceiling, onCrash, canCobra } = opts

  let throttle = THREE.MathUtils.clamp(opts.throttle ?? 0.55, 0, 1)
  let speed = THREE.MathUtils.lerp(IDLE_SPEED, MAX_SPEED, throttle)
  /** Vertical rate owned by the flight model (negative = sinking). */
  let sinkRate = 0
  let stalled = false
  let nearCeiling = false
  let nearEdge = false
  let crashed = false
  let flameout = false
  /** Stable tumble axis while flaming out (picked once on beginFlameout). */
  const flameTumble = new THREE.Vector3(0.55, 0.25, 0.8).normalize()

  type CobraPhase = 'idle' | 'pull' | 'hold' | 'recover'
  let cobraPhase: CobraPhase = 'idle'
  let cobraAge = 0
  let cobraCool = 0
  const cobraPath = new THREE.Vector3(0, 0, 1)

  const velocity = new THREE.Vector3()
  const nose = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const spin = new THREE.Quaternion()
  const worldSpin = new THREE.Quaternion()

  function readAxes(): void {
    nose.set(0, 0, 1).applyQuaternion(root.quaternion)
    // Right wing is −X in this frame, not +X.
    right.set(-1, 0, 0).applyQuaternion(root.quaternion)
    up.set(0, 1, 0).applyQuaternion(root.quaternion)
  }

  /** Bank angle: positive = right wing **down**. */
  function bankAngle(): number {
    return Math.atan2(-right.y, up.y)
  }

  function pitchAngle(): number {
    return Math.asin(THREE.MathUtils.clamp(nose.y, -1, 1))
  }

  /** Rotate about a body axis. */
  function rotateBody(axis: THREE.Vector3, angle: number): void {
    if (!angle) return
    spin.setFromAxisAngle(axis, angle)
    root.quaternion.multiply(spin)
  }

  function telemetry(): FlightTelemetry {
    readAxes()
    const agl = root.position.y - heightAt(root.position.x, root.position.z)
    // +Z is north and **−X is east** (screen-right for a camera looking down
    // +Z), so the x term is negated or the compass would count backwards.
    let heading = THREE.MathUtils.radToDeg(Math.atan2(-nose.x, nose.z))
    if (heading < 0) heading += 360
    return {
      speed,
      throttle,
      agl,
      altitude: root.position.y,
      heading,
      bank: THREE.MathUtils.radToDeg(bankAngle()),
      pitch: THREE.MathUtils.radToDeg(pitchAngle()),
      stalled,
      handsOff: false,
      nearCeiling,
      nearEdge,
      crashed,
      flameout,
      cobra: cobraPhase !== 'idle',
    }
  }

  let flameoutHard = false

  function clearCobra(): void {
    cobraPhase = 'idle'
    cobraAge = 0
  }

  function startCobra(): void {
    readAxes()
    cobraPath.set(nose.x, 0, nose.z)
    if (cobraPath.lengthSq() < 1e-4) cobraPath.set(0, 0, 1)
    else cobraPath.normalize()
    cobraPhase = 'pull'
    cobraAge = 0
    cobraCool = COBRA_COOLDOWN
    sinkRate = Math.min(sinkRate, 0)
    console.info('[Steel] COBRA — pull')
  }

  /** Arcade Pugachev: path keeps going while the nose snaps up past vertical. */
  function updateCobra(dt: number): FlightTelemetry {
    cobraAge += dt
    readAxes()
    stalled = true
    nearEdge = edgeStrength() > 0

    // Bleed knots hard — the point of the move.
    speed = Math.max(18, speed * Math.exp(-1.15 * dt))

    if (cobraPhase === 'pull') {
      const p = pitchAngle()
      if (p < COBRA_PEAK_PITCH) {
        rotateBody(AXIS_X, -COBRA_PULL_RATE * dt)
      }
      // Kill bank so the profile reads clean.
      const b = bankAngle()
      rotateBody(AXIS_Z, THREE.MathUtils.clamp(-b * 4, -3, 3) * dt)
      if (cobraAge >= COBRA_PULL_SEC || p >= COBRA_PEAK_PITCH * 0.92) {
        cobraPhase = 'hold'
        cobraAge = 0
        console.info('[Steel] COBRA — hold')
      }
    } else if (cobraPhase === 'hold') {
      const p = pitchAngle()
      const err = COBRA_PEAK_PITCH - p
      rotateBody(AXIS_X, THREE.MathUtils.clamp(-err * 3, -2, 2) * dt)
      if (cobraAge >= COBRA_HOLD_SEC) {
        cobraPhase = 'recover'
        cobraAge = 0
        console.info('[Steel] COBRA — recover')
      }
    } else {
      // Recover: nose to horizon, wings level.
      const p = pitchAngle()
      const b = bankAngle()
      rotateBody(
        AXIS_X,
        THREE.MathUtils.clamp(p * 2.8, -2.5, 2.5) * dt,
      )
      rotateBody(
        AXIS_Z,
        THREE.MathUtils.clamp(-b * 3.2, -2.5, 2.5) * dt,
      )
      if (cobraAge >= COBRA_RECOVER_SEC || (Math.abs(p) < 0.12 && Math.abs(b) < 0.12)) {
        clearCobra()
        console.info('[Steel] COBRA — done')
      }
    }

    readAxes()
    // Flight path stays mostly along the entry track; attitude is decoupled.
    const pathBlend = cobraPhase === 'recover' ? THREE.MathUtils.clamp(cobraAge / COBRA_RECOVER_SEC, 0, 1) : 0
    const path = cobraPath.clone().multiplyScalar(1 - pathBlend)
    path.addScaledVector(nose, pathBlend)
    if (path.lengthSq() > 1e-6) path.normalize()
    else path.copy(nose)

    velocity.copy(path).multiplyScalar(speed)
    // Slight loft on the pull so it doesn't pancake.
    if (cobraPhase === 'pull') velocity.y += 6 * (1 - cobraAge / COBRA_PULL_SEC)
    if (cobraPhase === 'hold') velocity.y += 2
    if (cobraPhase === 'recover') velocity.y += sinkRate

    nearCeiling = false
    if (ceiling !== undefined) {
      const room = ceiling - root.position.y
      nearCeiling = room < CEILING_SOFT
      if (nearCeiling && velocity.y > 0) {
        velocity.y *= THREE.MathUtils.clamp(room / CEILING_SOFT, 0, 1)
      }
    }

    root.position.addScaledVector(velocity, dt)

    if (ceiling !== undefined && root.position.y > ceiling) {
      root.position.y = ceiling
    }

    if (bounds) {
      root.position.x = THREE.MathUtils.clamp(root.position.x, -bounds.x, bounds.x)
      root.position.z = THREE.MathUtils.clamp(root.position.z, -bounds.z, bounds.z)
    }

    const groundY = heightAt(root.position.x, root.position.z)
    const agl = root.position.y - groundY
    if (agl <= CRASH_AGL) {
      clearCobra()
      const impact = Math.hypot(velocity.x, velocity.y, velocity.z)
      hitGround(Math.max(speed, impact))
    }

    const tm = telemetry()
    tm.handsOff = false
    return tm
  }

  function hitGround(impactSpeed: number): void {
    clearCobra()
    const groundY = heightAt(root.position.x, root.position.z)
    root.position.y = groundY + CRASH_AGL
    crashed = true
    flameout = false
    flameoutHard = false
    velocity.set(0, 0, 0)
    sinkRate = 0
    onCrash?.({ speed: impactSpeed, agl: CRASH_AGL })
  }

  /** Engine-out tumbling dive — no stick, no thrust. */
  function updateFlameout(dt: number): FlightTelemetry {
    readAxes()
    throttle = 0
    stalled = true
    nearCeiling = false
    nearEdge = false

    const drag = flameoutHard ? FLAMEOUT_DRAG * 0.85 : FLAMEOUT_DRAG
    const grav = flameoutHard ? FLAMEOUT_GRAVITY * 1.55 : FLAMEOUT_GRAVITY
    const tumble = flameoutHard ? FLAMEOUT_TUMBLE * 1.4 : FLAMEOUT_TUMBLE
    const noseHeavy = flameoutHard ? FLAMEOUT_NOSE_HEAVY * 1.6 : FLAMEOUT_NOSE_HEAVY

    // Bleed airspeed; gravity owns the vertical.
    speed = Math.max(0, speed * Math.exp(-drag * dt))
    sinkRate -= grav * dt

    // Nose tends to drop; light tumble so it reads as a glide, not a freeze.
    rotateBody(AXIS_X, noseHeavy * dt)
    spin.setFromAxisAngle(flameTumble, tumble * dt)
    root.quaternion.premultiply(spin)
    root.quaternion.normalize()

    readAxes()
    velocity.copy(nose).multiplyScalar(speed)
    velocity.y += sinkRate

    root.position.addScaledVector(velocity, dt)

    if (bounds) {
      root.position.x = THREE.MathUtils.clamp(root.position.x, -bounds.x, bounds.x)
      root.position.z = THREE.MathUtils.clamp(root.position.z, -bounds.z, bounds.z)
    }

    const groundY = heightAt(root.position.x, root.position.z)
    const agl = root.position.y - groundY
    if (agl <= CRASH_AGL) {
      const impact = Math.hypot(velocity.x, velocity.y, velocity.z)
      hitGround(Math.max(speed, impact))
    }

    return telemetry()
  }

  /** How deep into the edge band the aircraft is: 0 inside, 1 at the wall. */
  function edgeStrength(): number {
    if (!bounds) return 0
    const softX = Math.max(bounds.x - EDGE_MARGIN, 0)
    const softZ = Math.max(bounds.z - EDGE_MARGIN, 0)
    const over = Math.max(
      Math.abs(root.position.x) - softX,
      Math.abs(root.position.z) - softZ,
    )
    return THREE.MathUtils.clamp(over / EDGE_MARGIN, 0, 1)
  }

  /** Nudge the nose back toward the arena centre while in the edge band. */
  function turnBack(dt: number, strength: number): void {
    readAxes()
    const yawNose = Math.atan2(nose.x, nose.z)
    const yawHome = Math.atan2(-root.position.x, -root.position.z)
    let delta = yawHome - yawNose
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const rate =
      THREE.MathUtils.clamp(delta * TURNBACK_K, -TURNBACK_MAX, TURNBACK_MAX) * strength
    if (!rate) return
    worldSpin.setFromAxisAngle(WORLD_UP, rate * dt)
    root.quaternion.premultiply(worldSpin)
  }

  function update(dt: number, input: FlightInput): FlightTelemetry {
    // Wreckage does not fly. Everything below assumes a live aircraft.
    if (crashed) return telemetry()
    if (flameout) {
      clearCobra()
      return updateFlameout(dt)
    }

    cobraCool = Math.max(0, cobraCool - dt)
    if (
      canCobra &&
      input.cobra &&
      cobraPhase === 'idle' &&
      cobraCool <= 0 &&
      speed >= COBRA_MIN_SPEED
    ) {
      startCobra()
    }
    if (cobraPhase !== 'idle') return updateCobra(dt)

    // ——— Throttle ———
    if (input.throttleUp) throttle += THROTTLE_RATE * dt
    if (input.throttleDown) throttle -= THROTTLE_RATE * dt
    throttle = THREE.MathUtils.clamp(throttle, 0, 1)

    readAxes()

    // Edge depth is read before integrating so the speed bleed and the
    // turn-back act on the same value.
    const edge = edgeStrength()
    nearEdge = edge > 0

    // ——— Airspeed: throttle target, then gravity along the nose ———
    const target =
      THREE.MathUtils.lerp(IDLE_SPEED, MAX_SPEED, throttle) *
      (1 - EDGE_SPEED_BLEED * edge)
    speed = THREE.MathUtils.lerp(speed, target, 1 - Math.exp(-(SPEED_ACCEL / 40) * dt))
    speed -= nose.y * DIVE_SPEED_GAIN * dt
    speed = THREE.MathUtils.clamp(speed, 0, MAX_SPEED * 1.35)

    // Control authority fades with airspeed — a stalled wing barely answers.
    const authority = THREE.MathUtils.clamp(speed / STALL_SPEED, 0.15, 1)
    stalled = speed < STALL_SPEED

    // ——— Stick ———
    // Nose up is a NEGATIVE rotation about body X. Roll right is a POSITIVE
    // rotation about Z: it drops the −X wing, which is the right one.
    rotateBody(AXIS_X, -input.pitch * PITCH_RATE * authority * dt)
    rotateBody(AXIS_Z, input.roll * ROLL_RATE * authority * dt)
    rotateBody(AXIS_Y, -input.rudder * RUDDER_RATE * authority * dt)

    // ——— Bank-to-turn ———
    readAxes()
    const bank = bankAngle()
    // Right wing down (positive bank) must turn right, which is a negative
    // rotation about world up.
    const turn = -TURN_K * Math.sin(bank) * authority
    if (turn) {
      worldSpin.setFromAxisAngle(WORLD_UP, turn * dt)
      root.quaternion.premultiply(worldSpin)
    }

    // ——— Hands-off auto-level ———
    // Levels to the horizon and damps vertical rate. Never level to nose-up
    // while weathervaning: that pulls velocity up the nose and climbs forever.
    if (input.handsOff) {
      readAxes()
      const p = pitchAngle()
      const b = bankAngle()
      rotateBody(
        AXIS_X,
        THREE.MathUtils.clamp(p * LEVEL_PITCH_K, -LEVEL_PITCH_MAX, LEVEL_PITCH_MAX) * dt,
      )
      rotateBody(
        AXIS_Z,
        THREE.MathUtils.clamp(-b * LEVEL_ROLL_K, -LEVEL_ROLL_MAX, LEVEL_ROLL_MAX) * dt,
      )
      sinkRate *= Math.pow(0.02, dt)
    }

    // ——— Lift vs gravity (soft stall) ———
    readAxes()
    const lift = THREE.MathUtils.clamp(speed / STALL_SPEED, 0, 1)
    sinkRate -= GRAVITY * (1 - lift) * dt
    // Flying wing washes the sink out; also keeps recovery from feeling sticky.
    sinkRate *= Math.pow(lift > 0.999 ? 0.05 : 0.6, dt)

    // ——— Integrate ———
    velocity.copy(nose).multiplyScalar(speed)
    velocity.y += sinkRate

    // ——— Ceiling ———
    // Climb is bled away approaching the ceiling rather than stopped dead, so
    // it reads as running out of air instead of hitting an invisible lid.
    nearCeiling = false
    if (ceiling !== undefined) {
      const room = ceiling - root.position.y
      nearCeiling = room < CEILING_SOFT
      if (nearCeiling && velocity.y > 0) {
        velocity.y *= THREE.MathUtils.clamp(room / CEILING_SOFT, 0, 1)
      }
    }

    root.position.addScaledVector(velocity, dt)

    if (ceiling !== undefined && root.position.y > ceiling) {
      root.position.y = ceiling
      if (sinkRate > 0) sinkRate = 0
    }

    // ——— Arena edges ———
    if (bounds) {
      const depth = Math.max(edge, edgeStrength())
      if (depth > 0) turnBack(dt, depth)
      // Hard stop, so the arena is genuinely inescapable even at full throttle.
      root.position.x = THREE.MathUtils.clamp(root.position.x, -bounds.x, bounds.x)
      root.position.z = THREE.MathUtils.clamp(root.position.z, -bounds.z, bounds.z)
    }

    // ——— Terrain contact ———
    const groundY = heightAt(root.position.x, root.position.z)
    const agl = root.position.y - groundY
    if (agl <= CRASH_AGL) {
      hitGround(speed)
    }

    const tm = telemetry()
    tm.handsOff = input.handsOff
    return tm
  }

  return {
    update,
    telemetry,
    velocity,
    noseDir() {
      readAxes()
      return nose.clone()
    },
    reset(pos, yaw, throttle01 = 0.55) {
      crashed = false
      flameout = false
      flameoutHard = false
      clearCobra()
      cobraCool = 0
      stalled = false
      nearCeiling = false
      nearEdge = false
      sinkRate = 0
      throttle = THREE.MathUtils.clamp(throttle01, 0, 1)
      speed = THREE.MathUtils.lerp(IDLE_SPEED, MAX_SPEED, throttle)
      root.position.copy(pos)
      root.quaternion.setFromAxisAngle(WORLD_UP, yaw)
      root.updateMatrixWorld(true)
      readAxes()
      velocity.copy(nose).multiplyScalar(speed)
    },
    forceCrash() {
      if (crashed) return
      clearCobra()
      crashed = true
      flameout = false
      flameoutHard = false
      velocity.set(0, 0, 0)
      sinkRate = 0
    },
    beginFlameout(severity: 'normal' | 'hard' = 'normal') {
      if (crashed || flameout) return
      clearCobra()
      flameout = true
      flameoutHard = severity === 'hard'
      throttle = 0
      stalled = true
      // Keep residual airspeed + vertical rate so the dive continues from now.
      readAxes()
      if (velocity.lengthSq() < 1) {
        velocity.copy(nose).multiplyScalar(speed)
      }
      sinkRate = Math.min(sinkRate, flameoutHard ? -18 : -6)
      // Pick a tumble bias from current attitude so each kill looks different.
      flameTumble
        .set(0.35 + Math.random() * 0.5, 0.15 + Math.random() * 0.35, 0.55 + Math.random() * 0.45)
        .normalize()
      console.info(
        `[Steel] Flight flame-out — engine dead, diving${flameoutHard ? ' (hard)' : ''}`,
      )
    },
    isFlameout: () => flameout,
  }
}
