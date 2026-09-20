import * as THREE from 'three'
import type { DummyTarget } from './dummy'

/**
 * Seeker missiles (Pantsir SAM + F-16 AAM).
 * Lead pursuit; accelerates in flight; dense smoke trail; range-capped.
 * Optional chaff/flare spoof via getDecoys().
 */

const MISSILE_SPEED = 130
/** Launch fraction of cruise — builds up as it flies. */
const SPEED_LAUNCH_FRAC = 0.48
/** Terminal speed multiplier vs cruise. */
const SPEED_MAX_FRAC = 1.55
/** Distance (m) over which speed ramps launch → max. */
const ACCEL_DIST = 420
const TURN_RATE = 8.2
const HIT_RADIUS = 8
/** Soft time cap; range usually kills first. */
const LIFETIME = 22
/** Max path length — still long enough for air/SAM fights. */
const MAX_RANGE = 1650
const RELOAD = 2.4
const MAX_AMMO = 12
const DAMAGE = 480
const PEN = 80
const SPOOF_RANGE = 95
const SPOOF_DOT = 0.15

/** Trail puff every this many metres of flight. */
const TRAIL_SPACING = 7.5
const TRAIL_LIFE = 1.55
const TRAIL_BURST = 1
/** Hard cap — dense trails were spawning hundreds of meshes mid-match. */
const MAX_TRAIL = 40

export type SamMissiles = {
  update: (dt: number, wantsFire: boolean) => void
  ammo: () => number
  reloadLeft: () => number
  dispose: () => void
}

export type SamMissileOpts = {
  scene: THREE.Scene
  getLaunchOrigin: (out: THREE.Vector3) => void
  getLaunchDir: (out: THREE.Vector3) => void
  getLockedTarget: () => THREE.Object3D | null
  getHostiles: () => readonly DummyTarget[]
  getDecoys?: () => readonly THREE.Object3D[]
  heightAt?: (x: number, z: number) => number
  onKill?: (victim: THREE.Object3D) => void
  maxAmmo?: number
  reloadSec?: number
  speed?: number
  damage?: number
  color?: number
  logTag?: string
  /** Air-launched: no forced loft (ground SAMs keep upward bias). */
  airLaunch?: boolean
  /** Visual scale of the missile mesh. */
  meshScale?: number
  /** Override max path length (metres). */
  maxRange?: number
}

type TrailPuff = {
  mesh: THREE.Mesh
  age: number
  life: number
  drift: THREE.Vector3
}

type LiveMissile = {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  target: THREE.Object3D
  intended: THREE.Object3D
  prevTgt: THREE.Vector3
  tgtVel: THREE.Vector3
  age: number
  distFlown: number
  trailBudget: number
  speedNow: number
  dead: boolean
  spoofed: boolean
}

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _to = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _aim = new THREE.Vector3()
const _tgt = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _axis = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _back = new THREE.Vector3()
const _side = new THREE.Vector3()

export function createSamMissiles(opts: SamMissileOpts): SamMissiles {
  const { scene } = opts
  const cruise = opts.speed ?? MISSILE_SPEED
  const speedLaunch = cruise * SPEED_LAUNCH_FRAC
  const speedMax = cruise * SPEED_MAX_FRAC
  const maxRange = opts.maxRange ?? MAX_RANGE
  const maxAmmo = opts.maxAmmo ?? MAX_AMMO
  const reloadSec = opts.reloadSec ?? RELOAD
  const damage = opts.damage ?? DAMAGE
  const logTag = opts.logTag ?? 'SAM'
  const airLaunch = !!opts.airLaunch
  const meshScale = opts.meshScale ?? 1

  const geo = new THREE.CapsuleGeometry(0.18 * meshScale, 1.8 * meshScale, 3, 6)
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xc4c8b8,
    metalness: 0.55,
    roughness: 0.35,
    emissive: new THREE.Color(opts.color ?? 0xc4c8b8).multiplyScalar(0.35),
  })

  const trailGeo = new THREE.SphereGeometry(0.55, 6, 6)
  const trailMatBase = new THREE.MeshBasicMaterial({
    color: 0xc8c4bc,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const trailHotMat = new THREE.MeshBasicMaterial({
    color: 0xffa040,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  })

  const live: LiveMissile[] = []
  const trail: TrailPuff[] = []
  let ammo = maxAmmo
  let reload = 0
  let fireHeld = false

  function currentSpeed(distFlown: number): number {
    const t = THREE.MathUtils.clamp(distFlown / ACCEL_DIST, 0, 1)
    // Ease-in so early flight is slower, then it really opens up.
    const eased = t * t * (3 - 2 * t)
    return THREE.MathUtils.lerp(speedLaunch, speedMax, eased)
  }

  function hostileFor(root: THREE.Object3D): DummyTarget | null {
    return opts.getHostiles().find((h) => h.root === root) ?? null
  }

  function sampleTarget(root: THREE.Object3D, out: THREE.Vector3): void {
    root.getWorldPosition(out)
    out.y += 1.4
  }

  function killTrail(p: TrailPuff): void {
    scene.remove(p.mesh)
    // trailGeo is shared — only dispose the cloned material.
    ;(p.mesh.material as THREE.Material).dispose()
  }

  function emitTrail(m: LiveMissile, hot: boolean): void {
    while (trail.length >= MAX_TRAIL) {
      killTrail(trail[0]!)
      trail.shift()
    }

    _fwd.copy(m.vel)
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1)
    else _fwd.normalize()
    _back.copy(_fwd).multiplyScalar(-1)
    _side.set(_fwd.z, 0, -_fwd.x)
    if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0)
    else _side.normalize()

    for (let i = 0; i < TRAIL_BURST; i++) {
      if (trail.length >= MAX_TRAIL) break
      const matInst = (hot ? trailHotMat : trailMatBase).clone()
      const mesh = new THREE.Mesh(trailGeo, matInst)
      const aft = 0.8 + Math.random() * 1.4 + i * 0.35
      const spray = (Math.random() - 0.5) * 1.2
      const lift = (Math.random() - 0.35) * 0.7
      mesh.position
        .copy(m.mesh.position)
        .addScaledVector(_back, aft)
        .addScaledVector(_side, spray)
      mesh.position.y += lift
      const s = (hot ? 0.55 : 0.9) + Math.random() * 0.7
      mesh.scale.setScalar(s * meshScale)
      mesh.frustumCulled = true
      scene.add(mesh)

      const drift = _back
        .clone()
        .multiplyScalar(2 + Math.random() * 4)
        .addScaledVector(_side, (Math.random() - 0.5) * 2.5)
      drift.y += 0.4 + Math.random() * 1.6

      trail.push({
        mesh,
        age: 0,
        life: TRAIL_LIFE * (0.75 + Math.random() * 0.35),
        drift,
      })
    }
  }

  function updateTrail(dt: number): void {
    for (const p of trail) {
      p.age += dt
      p.mesh.position.addScaledVector(p.drift, dt)
      p.drift.multiplyScalar(Math.exp(-0.55 * dt))
      p.drift.y += 1.8 * dt
      const fade = 1 - p.age / p.life
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, fade * fade * 0.65)
      p.mesh.scale.multiplyScalar(1 + 0.55 * dt)
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      if (trail[i]!.age >= trail[i]!.life) {
        killTrail(trail[i]!)
        trail.splice(i, 1)
      }
    }
  }

  function maybeSpoof(m: LiveMissile): void {
    const decoys = opts.getDecoys?.() ?? []
    if (decoys.length === 0) return
    _fwd.copy(m.vel)
    if (_fwd.lengthSq() < 1e-8) return
    _fwd.normalize()

    let best: THREE.Object3D | null = null
    let bestScore = -Infinity
    for (const d of decoys) {
      d.getWorldPosition(_tgt)
      _to.copy(_tgt).sub(m.mesh.position)
      const dist = _to.length()
      if (dist < 2 || dist > SPOOF_RANGE) continue
      _to.multiplyScalar(1 / dist)
      const align = _to.dot(_fwd)
      if (align < SPOOF_DOT) continue
      const score = align * 2 - dist / SPOOF_RANGE
      if (score > bestScore) {
        bestScore = score
        best = d
      }
    }
    if (!best) return

    if (m.spoofed) {
      if (!m.target.parent) {
        m.target = best
        sampleTarget(best, m.prevTgt)
        m.tgtVel.set(0, -2, 0)
      }
      return
    }

    sampleTarget(m.intended, _aim)
    const tgtDist = m.mesh.position.distanceTo(_aim)
    best.getWorldPosition(_tgt)
    const decoyDist = m.mesh.position.distanceTo(_tgt)
    if (decoyDist < tgtDist * 0.92 || bestScore > 0.55) {
      m.target = best
      m.spoofed = true
      sampleTarget(best, m.prevTgt)
      m.tgtVel.set(0, -2, 0)
      console.info(`[Steel] ${logTag} spoofed by chaff/flare`)
    }
  }

  function spawn(): boolean {
    const target = opts.getLockedTarget()
    if (!target) {
      console.info(`[Steel] ${logTag} — need radar track (diamond / P lock) before M`)
      return false
    }
    if (ammo <= 0 || reload > 0) return false

    opts.getLaunchOrigin(_origin)
    opts.getLaunchDir(_dir)
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0.25, 1)
    _dir.normalize()
    sampleTarget(target, _tgt)
    _to.copy(_tgt).sub(_origin)
    if (_to.lengthSq() > 1) {
      _to.normalize()
      _dir.lerp(_to, 0.85).normalize()
    }
    if (!airLaunch) _dir.y = Math.max(_dir.y, 0.08)
    _dir.normalize()

    const mesh = new THREE.Mesh(geo, mat.clone())
    mesh.castShadow = true
    mesh.position.copy(_origin)
    mesh.quaternion.setFromUnitVectors(_up, _dir)
    scene.add(mesh)

    sampleTarget(target, _tgt)
    const launchSpd = speedLaunch
    live.push({
      mesh,
      vel: _dir.clone().multiplyScalar(launchSpd),
      target,
      intended: target,
      prevTgt: _tgt.clone(),
      tgtVel: new THREE.Vector3(),
      age: 0,
      distFlown: 0,
      trailBudget: 0,
      speedNow: launchSpd,
      dead: false,
      spoofed: false,
    })
    ammo--
    reload = reloadSec
    console.info(
      `[Steel] ${logTag} launch → ${target.name || 'lock'} · ammo ${ammo} · range ${maxRange}m`,
    )
    return true
  }

  function killMissile(m: LiveMissile): void {
    if (m.dead) return
    m.dead = true
    // One exhaust puff on death — avoid a 6-puff burst every burnout.
    emitTrail(m, true)
    scene.remove(m.mesh)
    m.mesh.geometry.dispose()
    ;(m.mesh.material as THREE.Material).dispose()
  }

  function tryHit(m: LiveMissile): boolean {
    sampleTarget(m.target, _tgt)
    const close = m.mesh.position.distanceTo(_tgt) <= HIT_RADIUS
    const unit = hostileFor(m.target)

    // Hit a decoy — missile dies, no damage.
    if (!unit) {
      if (close) {
        console.info(`[Steel] ${logTag} burned on chaff/flare`)
        return true
      }
      return false
    }

    for (const h of opts.getHostiles()) {
      if (!h.alive) continue
      const isLock = h.root === m.target || h.root === m.intended
      if (!isLock && !h.containsPoint(m.mesh.position)) continue
      if (isLock && !close && !h.containsPoint(m.mesh.position)) continue
      if (!isLock && !close) continue

      let result = h.resolveShellHit(
        m.mesh.position,
        m.vel,
        { basePenetration: PEN, baseDamage: damage },
        { ammoId: 'he' },
      )
      if (!result && isLock && close) {
        result = h.resolveShellHit(
          _tgt,
          m.vel,
          { basePenetration: PEN, baseDamage: damage },
          { ammoId: 'he' },
        )
      }
      if (!result && isLock && close) {
        h.hp = Math.max(0, h.hp - damage)
        if (h.hp <= 0) {
          h.alive = false
          opts.onKill?.(h.root)
        }
        console.info(`[Steel] ${logTag} proximity hit ${h.root.name || 'target'}`)
        return true
      }
      if (!result) continue
      if (result.destroyed) opts.onKill?.(h.root)
      console.info(`[Steel] ${logTag} hit ${h.root.name || 'target'}`)
      return true
    }
    return false
  }

  function steerToward(m: LiveMissile, desiredDir: THREE.Vector3, dt: number): void {
    const spd = m.speedNow
    _fwd.copy(m.vel)
    if (_fwd.lengthSq() < 1e-8) {
      m.vel.copy(desiredDir).multiplyScalar(spd)
      return
    }
    _fwd.normalize()
    const dot = THREE.MathUtils.clamp(_fwd.dot(desiredDir), -1, 1)
    const ang = Math.acos(dot)
    if (ang < 1e-4) {
      m.vel.copy(desiredDir).multiplyScalar(spd)
      return
    }
    // Slightly snappier turn early; still tracks at high speed.
    const turnBoost = THREE.MathUtils.lerp(1.15, 0.85, (spd - speedLaunch) / (speedMax - speedLaunch + 1e-6))
    const maxStep = TURN_RATE * turnBoost * dt
    const t = Math.min(1, maxStep / ang)
    _axis.crossVectors(_fwd, desiredDir)
    if (_axis.lengthSq() < 1e-10) {
      _axis.set(0, 1, 0).cross(_fwd)
      if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0)
    }
    _axis.normalize()
    _q.setFromAxisAngle(_axis, ang * t)
    _fwd.applyQuaternion(_q).normalize()
    m.vel.copy(_fwd).multiplyScalar(spd)
  }

  return {
    update(dt, wantsFire) {
      const dtSafe = Math.max(dt, 1e-4)
      if (reload > 0) reload = Math.max(0, reload - dt)
      if (wantsFire && !fireHeld) spawn()
      fireHeld = wantsFire

      for (const m of live) {
        if (m.dead) continue
        m.age += dt
        if (m.age > LIFETIME || m.distFlown > maxRange) {
          console.info(
            `[Steel] ${logTag} burnout · flown ${m.distFlown.toFixed(0)}m / ${maxRange}m`,
          )
          killMissile(m)
          continue
        }

        m.speedNow = currentSpeed(m.distFlown)
        // Keep velocity magnitude on the ramp even mid-steer.
        if (m.vel.lengthSq() > 1e-8) {
          m.vel.setLength(m.speedNow)
        }

        maybeSpoof(m)

        const unit = hostileFor(m.target)
        if (unit && !unit.alive) {
          m.mesh.position.addScaledVector(m.vel, dt)
          m.distFlown += m.speedNow * dt
          m.trailBudget += m.speedNow * dt
          while (m.trailBudget >= TRAIL_SPACING) {
            m.trailBudget -= TRAIL_SPACING
            emitTrail(m, Math.random() < 0.35)
          }
          if (m.age > 0.4) killMissile(m)
          continue
        }

        // Lead pursuit — always track living / spoofed target.
        if (m.target.visible || m.target.parent) {
          sampleTarget(m.target, _tgt)
          m.tgtVel.copy(_tgt).sub(m.prevTgt).multiplyScalar(1 / dtSafe)
          const spd = m.tgtVel.length()
          if (spd > 180) m.tgtVel.multiplyScalar(180 / spd)
          m.prevTgt.copy(_tgt)

          const dist = m.mesh.position.distanceTo(_tgt)
          const tFlight = THREE.MathUtils.clamp(dist / Math.max(m.speedNow, 40), 0.05, 3.8)
          _aim.copy(_tgt).addScaledVector(m.tgtVel, tFlight * 1.08)
          _to.copy(_aim).sub(m.mesh.position)
          if (_to.lengthSq() > 0.25) {
            _to.normalize()
            steerToward(m, _to, dt)
          }
        }

        const step = m.speedNow * dt
        m.mesh.position.addScaledVector(m.vel, dt)
        m.distFlown += step
        m.trailBudget += step
        while (m.trailBudget >= TRAIL_SPACING) {
          m.trailBudget -= TRAIL_SPACING
          emitTrail(m, Math.random() < 0.4)
        }

        if (m.vel.lengthSq() > 1e-6) {
          m.mesh.quaternion.setFromUnitVectors(_up, _fwd.copy(m.vel).normalize())
        }

        const gy = opts.heightAt?.(m.mesh.position.x, m.mesh.position.z) ?? 0
        if (m.mesh.position.y < gy + 0.5) {
          killMissile(m)
          continue
        }
        if (tryHit(m)) killMissile(m)
      }

      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i]!.dead) live.splice(i, 1)
      }

      updateTrail(dt)
    },
    ammo: () => ammo,
    reloadLeft: () => reload,
    dispose() {
      for (const m of live) killMissile(m)
      live.length = 0
      for (const p of trail) killTrail(p)
      trail.length = 0
      geo.dispose()
      mat.dispose()
      trailGeo.dispose()
      trailMatBase.dispose()
      trailHotMat.dispose()
    },
  }
}
