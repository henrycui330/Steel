import * as THREE from 'three'
import { createAircraftFlight, type AircraftFlight } from './aircraftFlight'
import { createAircraftGuns, type AircraftGuns } from './aircraftGuns'
import type { AiEnemy, AiHostile, AiSpawnOptions, AiUpdateContext } from './aiEnemy'
import { createCombatant } from './combatant'
import type { FlightInput } from './input'
import { loadPlayerAircraft } from './loadAircraft'
import { tankOptionById, type TankId } from './tankCatalog'
import { spawnDestroyedWreck } from './wreck'

const SPAWN_ALT = 140
/** Hold this AGL in cruise — never dive to hull height. */
const CRUISE_AGL = 130
/** Lowest gun-run AGL. Below this the AI only pulls up. */
const ATTACK_AGL = 85
const MIN_AGL = 55
const PULLUP_AGL = 70
const FIRE_RANGE = 320
const FIRE_DOT = 0.82
const ENGAGE_XZ = 420

const _to = new THREE.Vector3()
const _nose = new THREE.Vector3()
const _noseH = new THREE.Vector3()
const _horiz = new THREE.Vector3()
const _idle = new THREE.Vector3()
const _aim = new THREE.Vector3()
const _crashVel = new THREE.Vector3(0, -80, 0)

function darkenEnemy(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m && 'color' in m && m.color instanceof THREE.Color) {
        m.color.multiplyScalar(0.72)
      }
    }
  })
}

function tintFriendly(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m && 'color' in m && m.color instanceof THREE.Color) {
        m.color.offsetHSL(0.12, 0.12, 0.04)
        m.color.multiplyScalar(0.92)
      }
    }
  })
}

function pickHostile3d(from: THREE.Vector3, hostiles: readonly AiHostile[]): AiHostile | null {
  let best: AiHostile | null = null
  let bestD = Infinity
  for (const h of hostiles) {
    if (!h.alive) continue
    const d = from.distanceTo(h.root.position)
    if (d < bestD) {
      bestD = d
      best = h
    }
  }
  return best
}

export type AiAircraftSpawnOptions = AiSpawnOptions & {
  bounds: { x: number; z: number }
  ceiling: number
  /** Height above ground at spawn / respawn (default 140). */
  spawnAlt?: number
}

function emptyStick(partial: Partial<FlightInput> = {}): FlightInput {
  const base: FlightInput = {
    pitch: 0,
    roll: 0,
    rudder: 0,
    throttleUp: false,
    throttleDown: false,
    fire: false,
    dropBomb: false,
    fireRocket: false,
    toggleSight: false,
    skipCinematic: false,
    eject: false,
    toggleGear: false,
    fireMissile: false,
    dropChaff: false,
    handsOff: true,
  }
  return { ...base, ...partial, toggleGear: partial.toggleGear ?? base.toggleGear }
}

/**
 * AI F4U Corsair — arcade orbit / gun-run against ground (or air) hostiles.
 * Same `AiEnemy` surface as tank AI so mission loops stay shared.
 */
export async function spawnAiCorsair(
  scene: THREE.Scene,
  opts: AiAircraftSpawnOptions,
): Promise<AiEnemy> {
  const {
    team,
    position,
    yaw = 0,
    heightAt,
    persistMesh = false,
    bounds,
    ceiling,
    spawnAlt = SPAWN_ALT,
  } = opts
  if (!heightAt) throw new Error('spawnAiCorsair requires heightAt')
  const sampleGround = heightAt

  const chassis = tankOptionById(opts.tankId ?? 'corsair')
  const air = await loadPlayerAircraft(chassis.id)
  const { root } = air
  root.name = team === 'friendly' ? 'aiAircraftFriendly' : 'aiAircraftEnemy'
  root.userData.air = true
  const gy = sampleGround(position.x, position.z)
  root.position.set(position.x, gy + spawnAlt, position.z)
  root.rotation.order = 'YXZ'
  root.rotation.y = yaw
  if (team === 'friendly') tintFriendly(root)
  else darkenEnemy(root)
  scene.add(root)

  const label = team === 'friendly' ? `Friendly ${chassis.name}` : `Enemy ${chassis.name}`
  let flight!: AircraftFlight
  let flaming = false
  let wrecked = false
  const combat = createCombatant(root, {
    maxHp: Math.round(chassis.maxHp * 0.9),
    armor: chassis.armor,
    broadRadius: 9,
    altitudeSpan: 7,
    label,
    onDestroyed: (r, info) => {
      opts.onDeath?.(r)
      if (info.severe) {
        // Catastrophic — stop mid-air and leave a wreck (or hide in KOTH).
        flight.forceCrash()
        flaming = false
        if (persistMesh) {
          r.visible = false
        } else if (!wrecked) {
          wrecked = true
          spawnDestroyedWreck(scene, r, opts.smoke)
        }
        console.info(`[Steel] AI ${chassis.name} catastrophic kill — mid-air wreck`)
        return
      }
      // HP gone but not crit — deadstick glide until the deck.
      if (!flight.isFlameout()) {
        flight.beginFlameout()
        flaming = true
        console.info(`[Steel] AI ${chassis.name} shot down — flame-out glide`)
      }
    },
  })

  flight = createAircraftFlight({
    root,
    heightAt: sampleGround,
    throttle: 0.55,
    bounds,
    ceiling,
    onCrash: () => {
      flaming = false
      if (persistMesh) {
        root.visible = false
        return
      }
      if (!wrecked) {
        wrecked = true
        spawnDestroyedWreck(scene, root, opts.smoke)
        console.info(`[Steel] AI ${chassis.name} impact — wreck`)
      }
    },
  })

  const guns: AircraftGuns = createAircraftGuns({
    scene,
    root,
    gun: chassis.gun,
    heightAt: sampleGround,
    bounds: { x: bounds.x + 20, z: bounds.z + 20 },
    velocity: flight.velocity,
  })
  guns.setOnKill(() => opts.onKill?.())

  let passTimer = 0

  function altitudePitch(agl: number, wantAgl: number): number {
    const err = wantAgl - agl
    // Soft hold around the band; never command a hard dive.
    let pitch = THREE.MathUtils.clamp(err * 0.035, -0.25, 0.9)
    if (agl < PULLUP_AGL) {
      pitch = Math.max(pitch, THREE.MathUtils.clamp((PULLUP_AGL - agl) / 35, 0.55, 1))
    }
    if (agl < MIN_AGL) pitch = 1
    return pitch
  }

  function steer(dt: number, ctx: AiUpdateContext): FlightInput {
    const tm = flight.telemetry()
    const agl = tm.agl
    // Keep energy — climbing while slow is how they stall and never notice.
    const lowEnergy = tm.stalled || tm.speed < 48 || (tm.pitch > 16 && tm.speed < 62)
    const throttleUp = lowEnergy || tm.throttle < 0.62 || agl < PULLUP_AGL
    const throttleDown = !lowEnergy && tm.throttle > 0.78 && agl > CRUISE_AGL + 40

    const target = pickHostile3d(root.position, ctx.hostiles)
    _nose.copy(flight.noseDir())

    if (lowEnergy) {
      // Nose down to the horizon, wings level, full throttle — then resume the path.
      const unload = tm.pitch > 4 ? -0.7 : tm.pitch > -2 ? -0.2 : 0
      return emptyStick({
        pitch: unload,
        roll: THREE.MathUtils.clamp(-tm.bank / 28, -0.65, 0.65),
        throttleUp: true,
        handsOff: false,
      })
    }

    // Emergency: ignore combat, climb out.
    if (agl < MIN_AGL) {
      return emptyStick({
        pitch: 1,
        roll: THREE.MathUtils.clamp(-tm.bank / 45, -0.4, 0.4),
        throttleUp: true,
        handsOff: false,
      })
    }

    if (!target) {
      const pitch = altitudePitch(agl, CRUISE_AGL)
      _idle.set(-root.position.x, 0, -root.position.z)
      if (_idle.lengthSq() > 400) {
        _idle.normalize()
        _noseH.set(_nose.x, 0, _nose.z)
        if (_noseH.lengthSq() < 1e-6) _noseH.set(0, 0, 1)
        else _noseH.normalize()
        const crossY = _noseH.x * _idle.z - _noseH.z * _idle.x
        return emptyStick({
          pitch,
          roll: THREE.MathUtils.clamp(crossY * 1.0, -0.4, 0.4),
          throttleUp,
          throttleDown,
          handsOff: false,
        })
      }
      return emptyStick({ pitch, throttleUp, throttleDown, handsOff: false })
    }

    const tpos = target.root.position
    const distXZ = Math.hypot(tpos.x - root.position.x, tpos.z - root.position.z)

    if (distXZ < 70) passTimer = 3.2
    if (passTimer > 0) passTimer = Math.max(0, passTimer - dt)

    // Aim at a sky point *above* the target — never at the hull on the dirt.
    const wantAgl =
      distXZ < ENGAGE_XZ && passTimer <= 0 ? ATTACK_AGL : CRUISE_AGL
    const groundT = sampleGround(tpos.x, tpos.z)
    // Air targets already sit high — use the higher of hull+offset vs attack band.
    const aimY = Math.max(tpos.y + 12, groundT + wantAgl)
    _aim.set(tpos.x, aimY, tpos.z)
    _to.copy(_aim).sub(root.position)
    const dist = _to.length()
    if (dist > 1e-3) _to.multiplyScalar(1 / dist)
    else _to.set(0, 0, 1)

    _horiz.set(_to.x, 0, _to.z)
    if (_horiz.lengthSq() < 1e-6) _horiz.set(0, 0, 1)
    else _horiz.normalize()
    _noseH.set(_nose.x, 0, _nose.z)
    if (_noseH.lengthSq() < 1e-6) _noseH.set(0, 0, 1)
    else _noseH.normalize()

    // +crossY ⇒ target to the right of nose ⇒ roll right (bank-to-turn).
    const crossY = _noseH.x * _horiz.z - _noseH.z * _horiz.x
    let roll = THREE.MathUtils.clamp(crossY * 2.0, -0.85, 0.85)
    const rudder = THREE.MathUtils.clamp(crossY * 0.55, -0.7, 0.7)

    // Altitude first; only a mild look-at pitch when safely above the floor.
    let pitch = altitudePitch(agl, wantAgl)
    if (agl > PULLUP_AGL + 15) {
      pitch = THREE.MathUtils.clamp(pitch + _to.y * 0.35, -0.28, 0.55)
    }
    // Don't pull past the energy you have.
    if (tm.speed < 70) pitch = Math.min(pitch, 0.35)
    if (passTimer > 0) {
      // Climb-out after a pass — no diving.
      pitch = Math.max(pitch, 0.45)
      roll *= 0.45
    }
    if (agl < PULLUP_AGL) roll *= 0.35

    // Fire when nose is near the elevated aim (still hits tanks below the beam).
    const aligned = _nose.dot(_to) > FIRE_DOT
    const fire =
      agl > MIN_AGL + 10 &&
      dist < FIRE_RANGE &&
      aligned &&
      passTimer <= 0 &&
      distXZ > 50

    return emptyStick({
      pitch,
      roll,
      rudder,
      throttleUp,
      throttleDown,
      fire,
      handsOff: false,
    })
  }

  const unit: AiEnemy = {
    team,
    aircraft: true,
    get root() {
      return combat.root
    },
    get alive() {
      return combat.alive
    },
    get hp() {
      return combat.hp
    },
    maxHp: combat.maxHp,
    containsPoint: (p) => combat.containsPoint(p),
    resolveShellHit: (p, v, s, ctx) => combat.resolveShellHit(p, v, s, ctx),
    previewShellHit: (p, v, s) => combat.previewShellHit(p, v, s),

    update(dt, ctx) {
      // Keep integrating a flame-out dive after HP death so the airframe
      // glides to the deck instead of freezing mid-sky.
      if (!combat.alive) {
        if (flaming && !flight.telemetry().crashed) {
          const tm = flight.update(dt, emptyStick())
          if (!tm.crashed) air.spinProp(dt, 0)
          if (opts.smoke && Math.random() < 0.35) {
            _aim.set(0, 0.4, -2.2).applyQuaternion(root.quaternion)
            _aim.add(root.position)
            opts.smoke.wreckBurn(_aim)
          }
        }
        guns.update(dt, false, ctx.hostiles, ctx.camera)
        return
      }
      const input = steer(dt, ctx)
      const tm = flight.update(dt, input)
      if (!tm.crashed) air.spinProp(dt, tm.throttle)
      if (tm.crashed && combat.alive) {
        combat.resolveShellHit(root.position, _crashVel, {
          basePenetration: 2000,
          baseDamage: 99_999,
          blastDamage: 0,
        })
      }
      guns.update(dt, input.fire && !tm.crashed, ctx.hostiles, ctx.camera)
    },

    reviveAt(pos, newYaw) {
      const y = sampleGround(pos.x, pos.z) + spawnAlt
      const p = new THREE.Vector3(pos.x, y, pos.z)
      combat.revive()
      flaming = false
      wrecked = false
      flight.reset(p, newYaw, 0.55)
      guns.refill()
      passTimer = 0
      root.visible = true
      console.info(`[Steel] AI ${chassis.name} respawn (${team})`)
    },
  }

  console.info(
    `[Steel] AI ${chassis.name} spawned (${team}) at y=${root.position.y.toFixed(0)} · ${label}`,
  )
  return unit
}

export function isAircraftTankId(id: TankId): boolean {
  return !!tankOptionById(id).aircraft
}
