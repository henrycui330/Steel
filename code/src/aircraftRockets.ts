import * as THREE from 'three'
import type { HeightSampler } from './ballistics'
import type { GunTarget } from './aircraftGuns'

/**
 * Unguided wing rockets (Corsair HVAR-style).
 * Forward along the nose; light gravity; HE blast on impact.
 */

const ROCKET_COUNT = 8
const FIRE_GAP = 0.38
const MUZZLE_BOOST = 195
const GRAVITY = 9
const LIFE = 5.5
const HIT_RADIUS = 3.2
const BLAST_RADIUS = 14
const DIRECT_DMG = 420
const BLAST_DMG = 900
const PEN = 55
/** Exhaust puff every this many metres. */
const TRAIL_SPACING = 3.2
const TRAIL_LIFE = 1.55
const TRAIL_BURST = 2
const MAX_TRAIL = 56
/** Alternate left / right wing stations (local). */
const STATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [-3.4, -0.35, 0.6],
  [3.4, -0.35, 0.6],
  [-4.1, -0.4, 0.35],
  [4.1, -0.4, 0.35],
]

type Rocket = {
  root: THREE.Object3D
  vel: THREE.Vector3
  age: number
  dead: boolean
  trailBudget: number
}

type TrailPuff = {
  mesh: THREE.Mesh
  age: number
  life: number
  drift: THREE.Vector3
}

export type AircraftRockets = {
  update: (
    dt: number,
    wantsFire: boolean,
    targets: readonly GunTarget[],
  ) => void
  remaining: () => number
  refill: () => void
  setOnKill: (fn: ((victim: THREE.Object3D) => void) | null) => void
  dispose: () => void
}

export type RocketOptions = {
  scene: THREE.Scene
  root: THREE.Object3D
  heightAt: HeightSampler
  bounds: { x: number; z: number }
  velocity: THREE.Vector3
}

export function createAircraftRockets(opts: RocketOptions): AircraftRockets {
  const { scene, root, heightAt, bounds, velocity } = opts

  const bodyGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.15, 6)
  bodyGeo.rotateX(Math.PI / 2)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x6a6e62,
    roughness: 0.55,
    metalness: 0.45,
  })
  const tipGeo = new THREE.ConeGeometry(0.09, 0.28, 6)
  tipGeo.rotateX(Math.PI / 2)
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xc4a35a,
    roughness: 0.4,
    metalness: 0.5,
    emissive: 0x3a2808,
    emissiveIntensity: 0.35,
  })

  const trailGeo = new THREE.SphereGeometry(0.62, 6, 6)
  const trailSmokeMat = new THREE.MeshBasicMaterial({
    color: 0xb8b4aa,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  })
  const trailHotMat = new THREE.MeshBasicMaterial({
    color: 0xff9030,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  })

  const live: Rocket[] = []
  const trail: TrailPuff[] = []
  let remaining = ROCKET_COUNT
  let gap = 0
  let station = 0
  let onKill: ((victim: THREE.Object3D) => void) | null = null

  const _nose = new THREE.Vector3()
  const _pos = new THREE.Vector3()
  const _dir = new THREE.Vector3()
  const _probe = new THREE.Vector3()
  const _local = new THREE.Vector3()
  const _q = new THREE.Quaternion()
  const _fwd = new THREE.Vector3(0, 0, 1)
  const _back = new THREE.Vector3()
  const _side = new THREE.Vector3()

  function outOfBounds(p: THREE.Vector3): boolean {
    return Math.abs(p.x) > bounds.x + 40 || Math.abs(p.z) > bounds.z + 40
  }

  function killTrail(p: TrailPuff): void {
    scene.remove(p.mesh)
    ;(p.mesh.material as THREE.Material).dispose()
  }

  function emitTrail(r: Rocket, hot: boolean): void {
    while (trail.length >= MAX_TRAIL) {
      killTrail(trail[0]!)
      trail.shift()
    }
    _back.copy(r.vel)
    if (_back.lengthSq() < 1e-8) _back.set(0, 0, -1)
    else _back.normalize().multiplyScalar(-1)
    _side.set(_back.z, 0, -_back.x)
    if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0)
    else _side.normalize()

    for (let i = 0; i < TRAIL_BURST; i++) {
      if (trail.length >= MAX_TRAIL) break
      const matInst = (hot ? trailHotMat : trailSmokeMat).clone()
      const mesh = new THREE.Mesh(trailGeo, matInst)
      const aft = 0.55 + Math.random() * 1.2 + i * 0.4
      const spray = (Math.random() - 0.5) * 1.4
      mesh.position
        .copy(r.root.position)
        .addScaledVector(_back, aft)
        .addScaledVector(_side, spray)
      mesh.position.y += (Math.random() - 0.3) * 0.55
      mesh.scale.setScalar((hot ? 0.65 : 1.05) + Math.random() * 0.85)
      mesh.frustumCulled = true
      scene.add(mesh)

      const drift = _back
        .clone()
        .multiplyScalar(1.8 + Math.random() * 3.5)
        .addScaledVector(_side, (Math.random() - 0.5) * 2.8)
      drift.y += 0.5 + Math.random() * 1.8

      trail.push({
        mesh,
        age: 0,
        life: TRAIL_LIFE * (0.7 + Math.random() * 0.45),
        drift,
      })
    }
  }

  function updateTrail(dt: number): void {
    for (const p of trail) {
      p.age += dt
      p.mesh.position.addScaledVector(p.drift, dt)
      p.drift.multiplyScalar(Math.exp(-0.5 * dt))
      p.drift.y += 2.1 * dt
      const fade = 1 - p.age / p.life
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, fade * fade * 0.7)
      p.mesh.scale.multiplyScalar(1 + 0.7 * dt)
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      if (trail[i]!.age >= trail[i]!.life) {
        killTrail(trail[i]!)
        trail.splice(i, 1)
      }
    }
  }

  function surfacePoint(from: THREE.Vector3, target: GunTarget): THREE.Vector3 | null {
    const centre = target.root.position
    if (target.containsPoint(centre)) return centre.clone()
    for (let i = 1; i <= 10; i++) {
      _probe.lerpVectors(from, centre, i / 10)
      if (target.containsPoint(_probe)) return _probe.clone()
    }
    return null
  }

  function flash(at: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(1.4, 8, 8)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8844,
      transparent: true,
      opacity: 0.95,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(at)
    scene.add(mesh)
    const t0 = performance.now()
    const tick = (now: number): void => {
      const u = (now - t0) / 420
      if (u >= 1) {
        scene.remove(mesh)
        geo.dispose()
        mat.dispose()
        return
      }
      mesh.scale.setScalar(1 + u * 3.5)
      mat.opacity = 0.95 * (1 - u)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  function detonate(at: THREE.Vector3, targets: readonly GunTarget[]): void {
    flash(at)
    for (const target of targets) {
      if (!target.alive) continue
      const dist = target.root.position.distanceTo(at)
      if (dist > BLAST_RADIUS) continue
      const falloff = Math.pow(1 - dist / BLAST_RADIUS, 1.35)
      const probe = surfacePoint(at, target)
      if (!probe) continue
      _dir.copy(target.root.position).sub(at)
      if (_dir.lengthSq() < 1e-6) _dir.set(0, -1, 0)
      _dir.normalize().multiplyScalar(120)
      const result = target.resolveShellHit(
        probe,
        _dir,
        {
          basePenetration: PEN,
          baseDamage: Math.round(DIRECT_DMG * falloff),
          blastDamage: Math.round(BLAST_DMG * falloff),
        },
        { ammoId: 'he' },
      )
      if (result?.destroyed) onKill?.(target.root)
    }
  }

  function fireOne(): void {
    if (remaining <= 0) return
    root.updateMatrixWorld(true)
    root.getWorldQuaternion(_q)
    _nose.set(0, 0, 1).applyQuaternion(_q)

    const st = STATIONS[station % STATIONS.length]!
    station++
    _local.set(st[0], st[1], st[2])
    _pos.copy(_local).applyQuaternion(_q).add(root.position)

    const body = new THREE.Mesh(bodyGeo, bodyMat.clone())
    const tip = new THREE.Mesh(tipGeo, tipMat.clone())
    tip.position.z = 0.65
    const group = new THREE.Group()
    group.add(body, tip)
    group.position.copy(_pos)
    group.quaternion.copy(_q)
    group.name = 'hvarRocket'
    scene.add(group)

    const vel = velocity.clone().addScaledVector(_nose, MUZZLE_BOOST)
    live.push({ root: group, vel, age: 0, dead: false, trailBudget: 0 })
    remaining--
    gap = FIRE_GAP
    // Launch bloom — a few hot puffs at the rail.
    const just = live[live.length - 1]!
    emitTrail(just, true)
    emitTrail(just, true)
    console.info(`[Steel] HVAR launch · ${remaining} left`)
  }

  function killRocket(r: Rocket): void {
    if (r.dead) return
    r.dead = true
    scene.remove(r.root)
    r.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      // Shared geos — only dispose cloned materials.
      const m = o.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    })
  }

  return {
    update(dt, wantsFire, targets) {
      gap = Math.max(0, gap - dt)
      if (wantsFire && gap <= 0 && remaining > 0) fireOne()

      for (let i = live.length - 1; i >= 0; i--) {
        const r = live[i]!
        if (r.dead) {
          live.splice(i, 1)
          continue
        }
        r.age += dt
        r.vel.y -= GRAVITY * dt
        const step = r.vel.length() * dt
        r.root.position.addScaledVector(r.vel, dt)
        if (r.vel.lengthSq() > 1e-4) {
          _dir.copy(r.vel).normalize()
          r.root.quaternion.setFromUnitVectors(_fwd, _dir)
        }

        r.trailBudget += step
        while (r.trailBudget >= TRAIL_SPACING) {
          r.trailBudget -= TRAIL_SPACING
          emitTrail(r, Math.random() < 0.4)
        }

        const p = r.root.position
        if (r.age > LIFE || outOfBounds(p)) {
          killRocket(r)
          live.splice(i, 1)
          continue
        }
        const gy = heightAt(p.x, p.z)
        if (p.y <= gy + 0.4) {
          p.y = gy + 0.3
          detonate(p, targets)
          killRocket(r)
          live.splice(i, 1)
          continue
        }

        let hit = false
        for (const t of targets) {
          if (!t.alive) continue
          if (t.root.position.distanceTo(p) > HIT_RADIUS + 8) continue
          if (!t.containsPoint(p) && t.root.position.distanceTo(p) > HIT_RADIUS) continue
          detonate(p, targets)
          hit = true
          break
        }
        if (hit) {
          killRocket(r)
          live.splice(i, 1)
        }
      }

      updateTrail(dt)
    },

    remaining: () => remaining,
    refill() {
      remaining = ROCKET_COUNT
      gap = 0
      console.info('[Steel] HVAR rearmed ×8')
    },
    setOnKill(fn) {
      onKill = fn
    },
    dispose() {
      for (const r of live) killRocket(r)
      live.length = 0
      for (const p of trail) killTrail(p)
      trail.length = 0
      bodyGeo.dispose()
      tipGeo.dispose()
      bodyMat.dispose()
      tipMat.dispose()
      trailGeo.dispose()
      trailSmokeMat.dispose()
      trailHotMat.dispose()
    },
  }
}
