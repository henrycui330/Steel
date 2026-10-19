import * as THREE from 'three'
import type { DummyTarget } from './dummy'
import type { HitAnalyzeReport } from './hitAnalyzer'
import { segmentHitsPropCollider, type PropCollider } from './collision'

/**
 * Seeker missiles (Pantsir SAM + jet AAM).
 * Rail forward first, then curve into lead pursuit; range-capped.
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
/** Ground SAM max path length (m). */
const MAX_RANGE = 1100
/** Air-launched AAM / Hellfire — slightly shorter leash. */
const MAX_RANGE_AIR = 850
/**
 * Fly mostly along launch nose for this many metres, then blend into seeker.
 * Reads as “fires forward, then curves.”
 */
const RAIL_DIST = 90
/** Extra metres over which seeker authority ramps 0 → 1 after the rail. */
const CURVE_IN_DIST = 160
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
  /** Buildings / arena walls — missiles detonate on impact. */
  propColliders?: readonly PropCollider[]
  onKill?: (victim: THREE.Object3D) => void
  /** Armor hit analyzer (player SAM / ATGM). */
  onHitAnalyze?: (report: HitAnalyzeReport) => void
  maxAmmo?: number
  reloadSec?: number
  speed?: number
  damage?: number
  /** Base armour penetration (mm). */
  pen?: number
  color?: number
  logTag?: string
  /** Air-launched: no forced loft (ground SAMs keep upward bias). */
  airLaunch?: boolean
  /**
   * ATGM/TOW: no radar lock — fire along aim; missile follows sight (MCLOS).
   * Hits any hostile it reaches (not a locked seeker).
   */
  manualAim?: boolean
  /** Visual scale of the missile mesh. */
  meshScale?: number
  /** Override max path length (metres). */
  maxRange?: number
  /**
   * Optional flight mesh (e.g. AIM-9 / AIM-120 GLB). Return null to use capsule.
   * Called after getLaunchOrigin so callers can pick the rail kind first.
   */
  createMissileMesh?: () => THREE.Object3D | null
  /** After a successful spawn (ammo already decremented). */
  onLaunch?: () => void
}

type TrailPuff = {
  mesh: THREE.Mesh
  age: number
  life: number
  drift: THREE.Vector3
}

type LiveMissile = {
  mesh: THREE.Object3D
  vel: THREE.Vector3
  target: THREE.Object3D
  intended: THREE.Object3D
  prevTgt: THREE.Vector3
  tgtVel: THREE.Vector3
  /** World unit — nose at spawn; seeker blends from this after RAIL_DIST. */
  launchFwd: THREE.Vector3
  age: number
  distFlown: number
  trailBudget: number
  speedNow: number
  dead: boolean
  spoofed: boolean
  /** Follow getLaunchDir each frame — no lock seeker. */
  manual: boolean
  /** GLB / shared mats — skip geometry dispose. */
  sharedMesh: boolean
}

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _to = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _aim = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _tgt = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _segFrom = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _back = new THREE.Vector3()
const _side = new THREE.Vector3()
const _localHit = new THREE.Vector3()
const _localDir = new THREE.Vector3()
const _invTarget = new THREE.Matrix4()

function emitHitAnalyze(
  opts: SamMissileOpts,
  h: DummyTarget,
  hitPos: THREE.Vector3,
  vel: THREE.Vector3,
  report: Omit<
    HitAnalyzeReport,
    'targetRoot' | 'localHit' | 'localDir' | 'partId' | 'targetName' | 'ammoLabel'
  > & { partId: HitAnalyzeReport['partId']; partLabel: string },
  logTag: string,
): void {
  if (!opts.onHitAnalyze) return
  h.root.updateMatrixWorld(true)
  _invTarget.copy(h.root.matrixWorld).invert()
  _localHit.copy(hitPos).applyMatrix4(_invTarget)
  _localDir.copy(vel).transformDirection(_invTarget)
  if (_localDir.lengthSq() > 1e-8) _localDir.normalize()
  else _localDir.set(0, 0, 1)
  opts.onHitAnalyze({
    targetRoot: h.root,
    localHit: _localHit.clone(),
    localDir: _localDir.clone(),
    partId: report.partId,
    targetName:
      (typeof h.root.userData?.displayName === 'string' &&
        h.root.userData.displayName) ||
      h.root.name ||
      'Enemy',
    ammoLabel: logTag,
    outcome: report.outcome,
    partLabel: report.partLabel,
    damage: report.damage,
    penetration: report.penetration,
    effectiveArmor: report.effectiveArmor,
    angleDeg: report.angleDeg,
    hp: report.hp,
    maxHp: report.maxHp,
  })
}

export function createSamMissiles(opts: SamMissileOpts): SamMissiles {
  const { scene } = opts
  const cruise = opts.speed ?? MISSILE_SPEED
  const speedLaunch = cruise * SPEED_LAUNCH_FRAC
  const speedMax = cruise * SPEED_MAX_FRAC
  const airLaunch = !!opts.airLaunch
  const maxRange = opts.maxRange ?? (airLaunch ? MAX_RANGE_AIR : MAX_RANGE)
  const maxAmmo = opts.maxAmmo ?? MAX_AMMO
  const reloadSec = opts.reloadSec ?? RELOAD
  const damage = opts.damage ?? DAMAGE
  const pen = opts.pen ?? PEN
  const logTag = opts.logTag ?? 'SAM'
  const manualAim = !!opts.manualAim
  const meshScale = opts.meshScale ?? 1
  /** Invisible aim proxy for manual MCLOS missiles. */
  const aimProxy = new THREE.Object3D()
  aimProxy.name = 'atgmAimProxy'

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
    if (ammo <= 0 || reload > 0) return false

    opts.getLaunchOrigin(_origin)
    opts.getLaunchDir(_dir)
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0.25, 1)
    _dir.normalize()

    let target: THREE.Object3D
    if (manualAim) {
      // MCLOS: fly where the reticle points — no lock.
      target = aimProxy
      aimProxy.position.copy(_origin).addScaledVector(_dir, 80)
    } else {
      const locked = opts.getLockedTarget()
      if (!locked) {
        console.info(`[Steel] ${logTag} — hold P until LOCKED, then fire (LMB / M)`)
        return false
      }
      target = locked
      // Keep nose rail — seeker curves in after RAIL_DIST (no snap-to-target).
    }
    if (!airLaunch) _dir.y = Math.max(_dir.y, 0.08)
    _dir.normalize()

    const custom = opts.createMissileMesh?.() ?? null
    let mesh: THREE.Object3D
    let sharedMesh = false
    if (custom) {
      mesh = custom
      sharedMesh = true
      mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.frustumCulled = false
        }
      })
    } else {
      const capsule = new THREE.Mesh(geo, mat.clone())
      capsule.castShadow = true
      mesh = capsule
    }
    mesh.position.copy(_origin)
    // Capsule is +Y long; AIM GLBs are nose +Z.
    if (custom) {
      mesh.quaternion.setFromUnitVectors(_fwd.set(0, 0, 1), _dir)
    } else {
      mesh.quaternion.setFromUnitVectors(_up, _dir)
    }
    scene.add(mesh)

    if (!manualAim) sampleTarget(target, _tgt)
    else _tgt.copy(aimProxy.position)
    const launchSpd = speedLaunch
    live.push({
      mesh,
      vel: _dir.clone().multiplyScalar(launchSpd),
      target,
      intended: target,
      prevTgt: _tgt.clone(),
      tgtVel: new THREE.Vector3(),
      launchFwd: _dir.clone(),
      age: 0,
      distFlown: 0,
      trailBudget: 0,
      speedNow: launchSpd,
      dead: false,
      spoofed: false,
      manual: manualAim,
      sharedMesh,
    })
    ammo--
    reload = reloadSec
    opts.onLaunch?.()
    console.info(
      manualAim
        ? `[Steel] ${logTag} manual launch · ammo ${ammo} · range ${maxRange}m`
        : `[Steel] ${logTag} launch → ${target.name || 'lock'} · rail ${RAIL_DIST}m · range ${maxRange}m`,
    )
    return true
  }

  function killMissile(m: LiveMissile): void {
    if (m.dead) return
    m.dead = true
    // One exhaust puff on death — avoid a 6-puff burst every burnout.
    emitTrail(m, true)
    scene.remove(m.mesh)
    if (m.sharedMesh) return
    if (m.mesh instanceof THREE.Mesh) {
      // Shared capsule geo — only dispose the cloned material.
      ;(m.mesh.material as THREE.Material).dispose()
    }
  }

  function tryHit(m: LiveMissile): boolean {
    sampleTarget(m.target, _tgt)
    const close = m.mesh.position.distanceTo(_tgt) <= HIT_RADIUS
    const unit = hostileFor(m.target)

    // Hit a decoy — missile dies, no damage.
    if (!unit && !m.manual) {
      if (close) {
        console.info(`[Steel] ${logTag} burned on chaff/flare`)
        return true
      }
      return false
    }

    for (const h of opts.getHostiles()) {
      if (!h.alive) continue
      const isLock = !m.manual && (h.root === m.target || h.root === m.intended)
      h.root.getWorldPosition(_aim)
      _aim.y += 1.4
      const near =
        m.manual && m.mesh.position.distanceTo(_aim) <= HIT_RADIUS * 1.15
      if (!isLock && !near && !h.containsPoint(m.mesh.position)) continue
      if (isLock && !close && !h.containsPoint(m.mesh.position)) continue
      if (!isLock && !near && !close) continue

      let result = h.resolveShellHit(
        m.mesh.position,
        m.vel,
        { basePenetration: pen, baseDamage: damage },
        { ammoId: 'he' },
      )
      if (!result && isLock && close) {
        result = h.resolveShellHit(
          _tgt,
          m.vel,
          { basePenetration: pen, baseDamage: damage },
          { ammoId: 'he' },
        )
      }
      if (!result && isLock && close) {
        h.hp = Math.max(0, h.hp - damage)
        if (h.hp <= 0) {
          h.alive = false
          opts.onKill?.(h.root)
        }
        emitHitAnalyze(
          opts,
          h,
          m.mesh.position,
          m.vel,
          {
            partId: 'hullFront',
            partLabel: 'Proximity',
            outcome: h.hp <= 0 ? 'kill' : 'blast',
            damage,
            penetration: pen,
            effectiveArmor: 0,
            angleDeg: 0,
            hp: h.hp,
            maxHp: h.maxHp,
          },
          logTag,
        )
        console.info(`[Steel] ${logTag} proximity hit ${h.root.name || 'target'}`)
        return true
      }
      if (!result) continue
      if (result.destroyed) opts.onKill?.(h.root)
      {
        const r = result.resolution
        let outcome: HitAnalyzeReport['outcome'] = r.kind
        if (result.destroyed) outcome = r.crit ? 'crit' : 'kill'
        emitHitAnalyze(
          opts,
          h,
          m.mesh.position,
          m.vel,
          {
            partId: r.part.id,
            partLabel: r.part.label,
            outcome,
            damage: r.damage,
            penetration: r.penetration,
            effectiveArmor: r.effectiveArmor,
            angleDeg: r.angleDeg,
            hp: result.hp,
            maxHp: h.maxHp,
          },
          logTag,
        )
      }
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

        if (!m.manual) maybeSpoof(m)

        if (m.manual) {
          // Wire-guide: steer toward a point far along current aim.
          opts.getLaunchOrigin(_origin)
          opts.getLaunchDir(_dir)
          if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1)
          else _dir.normalize()
          aimProxy.position.copy(_origin).addScaledVector(_dir, 120)
          _to.copy(aimProxy.position).sub(m.mesh.position)
          if (_to.lengthSq() > 0.25) {
            _to.normalize()
            steerToward(m, _to, dt)
          }
        } else {
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

          // Lead pursuit — locked / spoofed target.
          // Rail forward first, then smoothstep into full seeker curve.
          if (m.target.visible || m.target.parent) {
            sampleTarget(m.target, _tgt)
            m.tgtVel.copy(_tgt).sub(m.prevTgt).multiplyScalar(1 / dtSafe)
            const spd = m.tgtVel.length()
            if (spd > 180) m.tgtVel.multiplyScalar(180 / spd)
            m.prevTgt.copy(_tgt)

            const dist = m.mesh.position.distanceTo(_tgt)
            const tFlight = THREE.MathUtils.clamp(
              dist / Math.max(m.speedNow, 40),
              0.05,
              3.8,
            )
            _aim.copy(_tgt).addScaledVector(m.tgtVel, tFlight * 1.08)
            _to.copy(_aim).sub(m.mesh.position)
            if (_to.lengthSq() > 0.25) {
              _to.normalize()
              const blend = THREE.MathUtils.smoothstep(
                (m.distFlown - RAIL_DIST) / CURVE_IN_DIST,
                0,
                1,
              )
              _desired.copy(m.launchFwd).lerp(_to, blend).normalize()
              steerToward(m, _desired, dt)
            } else {
              steerToward(m, m.launchFwd, dt)
            }
          } else {
            steerToward(m, m.launchFwd, dt)
          }
        }

        const step = m.speedNow * dt
        _segFrom.copy(m.mesh.position)
        m.mesh.position.addScaledVector(m.vel, dt)
        m.distFlown += step
        m.trailBudget += step
        while (m.trailBudget >= TRAIL_SPACING) {
          m.trailBudget -= TRAIL_SPACING
          emitTrail(m, Math.random() < 0.4)
        }

        if (m.vel.lengthSq() > 1e-6) {
          _fwd.copy(m.vel).normalize()
          if (m.sharedMesh) {
            m.mesh.quaternion.setFromUnitVectors(_to.set(0, 0, 1), _fwd)
          } else {
            m.mesh.quaternion.setFromUnitVectors(_up, _fwd)
          }
        }

        const walls = opts.propColliders
        if (
          walls &&
          walls.length > 0 &&
          segmentHitsPropCollider(_segFrom, m.mesh.position, walls, 0.35)
        ) {
          console.info(`[Steel] ${logTag} hit wall / building`)
          killMissile(m)
          continue
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
