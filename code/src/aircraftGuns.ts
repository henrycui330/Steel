import * as THREE from 'three'
import { SHELL_GRAVITY, SHELL_SPEED, type HeightSampler } from './ballistics'
import { shellPenetrationAtSpeed } from './armor'
import type { DummyTarget } from './dummy'
import type { GunProfile } from './tankCatalog'

/**
 * Six wing-mounted .50 cals for the Corsair.
 *
 * Projectiles are integrated here rather than through `fire.ts`, because that
 * system takes its leave direction from the tank's mouse aim (`getAimDirection`)
 * and is bound to the turret/muzzle rig. Armour resolution is *not* duplicated:
 * hits go through the same `resolveShellHit` path tanks use, so penetration,
 * ricochet, damage and kills behave identically.
 */

/** Guns are harmonised to converge this far ahead — the classic gun-sight trick. */
const CONVERGENCE = 260
/** Rounds per second across all six guns (arcade; six M2s would be ~80/s). */
const RATE = 20
const BULLET_SPEED = SHELL_SPEED * 1.15
const BULLET_LIFETIME = 1.8
const BULLET_RADIUS = 0.06
const TRACER_EVERY = 3
const MAX_AMMO = 2400
/** Guns fade out as the barrels cook; released trigger cools them. */
const HEAT_PER_SHOT = 0.006
const COOL_PER_SEC = 0.22

/** Wing stations in aircraft local space (mirrored across the centreline). */
const STATIONS: Array<[number, number, number]> = [
  [2.15, -0.05, 1.3],
  [2.95, -0.05, 1.2],
  [3.75, -0.05, 1.1],
]

export type GunTarget = {
  root: THREE.Object3D
  alive: boolean
  containsPoint: DummyTarget['containsPoint']
  resolveShellHit: DummyTarget['resolveShellHit']
}

type Bullet = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  tracer: boolean
}

export type AircraftGuns = {
  update: (
    dt: number,
    wantsFire: boolean,
    targets: readonly GunTarget[],
    camera?: THREE.Camera,
  ) => void
  ammo: () => number
  heat: () => number
  firing: () => boolean
  /** Restock ammo + cool the barrels (KOTH respawn). */
  refill: () => void
  setOnKill: (fn: ((victim: THREE.Object3D) => void) | null) => void
  dispose: () => void
}

export type GunOptions = {
  scene: THREE.Scene
  /** Aircraft root — muzzles ride this. */
  root: THREE.Object3D
  gun: GunProfile
  heightAt: HeightSampler
  bounds: { x: number; z: number }
  /** Aircraft world velocity, added to muzzle velocity. */
  velocity: THREE.Vector3
  /**
   * Local muzzle stations. Default = six wing .50s.
   * Pass a single nose station for jets (e.g. F-16 M61).
   */
  stations?: ReadonlyArray<readonly [number, number, number]>
  /** If true, each station is used once (no left/right mirror). */
  noMirrorStations?: boolean
}

export function createAircraftGuns(opts: GunOptions): AircraftGuns {
  const { scene, root, gun, heightAt, bounds, velocity } = opts

  const bullets: Bullet[] = []
  const pool: THREE.Mesh[] = []
  const geometry = new THREE.SphereGeometry(BULLET_RADIUS, 6, 6)
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe08a })
  const plainMat = new THREE.MeshBasicMaterial({ color: 0xbfae86 })

  // Muzzles are real children so they inherit the aircraft's attitude.
  const muzzles: THREE.Object3D[] = []
  const stations = opts.stations ?? STATIONS
  const mirror = !opts.noMirrorStations
  for (const [x, y, z] of stations) {
    if (!mirror) {
      const m = new THREE.Object3D()
      m.position.set(x, y, z)
      root.add(m)
      muzzles.push(m)
      continue
    }
    for (const side of [1, -1]) {
      const m = new THREE.Object3D()
      m.position.set(x * side, y, z)
      root.add(m)
      muzzles.push(m)
    }
  }

  const converge = new THREE.Object3D()
  converge.position.set(0, 0, CONVERGENCE)
  root.add(converge)

  let ammo = MAX_AMMO
  let heat = 0
  let cooldown = 0
  let next = 0
  let shotSeq = 0
  let isFiring = false
  let onKill: ((victim: THREE.Object3D) => void) | null = null

  const _muzzleW = new THREE.Vector3()
  const _convergeW = new THREE.Vector3()
  const _dir = new THREE.Vector3()
  const _step = new THREE.Vector3()

  function takeMesh(tracer: boolean): THREE.Mesh {
    const mesh = pool.pop() ?? new THREE.Mesh(geometry, plainMat)
    mesh.material = tracer ? tracerMat : plainMat
    mesh.visible = true
    mesh.frustumCulled = false
    return mesh
  }

  function fireOne(): void {
    if (ammo <= 0) return
    const muzzle = muzzles[next % muzzles.length]!
    next++
    ammo--
    heat = Math.min(1, heat + HEAT_PER_SHOT)

    muzzle.getWorldPosition(_muzzleW)
    converge.getWorldPosition(_convergeW)
    // Every gun aims at the single convergence point, so the cone tightens to a
    // point at that range instead of firing six parallel streams.
    _dir.copy(_convergeW).sub(_muzzleW).normalize()

    const tracer = shotSeq++ % TRACER_EVERY === 0
    const mesh = takeMesh(tracer)
    mesh.position.copy(_muzzleW)
    scene.add(mesh)

    bullets.push({
      mesh,
      // Muzzle velocity is relative to the aircraft, so inherit its motion.
      velocity: _dir.clone().multiplyScalar(BULLET_SPEED).add(velocity),
      life: BULLET_LIFETIME,
      tracer,
    })
  }

  function retire(i: number): void {
    const b = bullets[i]!
    scene.remove(b.mesh)
    b.mesh.visible = false
    pool.push(b.mesh)
    bullets.splice(i, 1)
  }

  function impactStats(): { basePenetration: number; baseDamage: number } {
    return { basePenetration: gun.aphePen, baseDamage: gun.apheDmg }
  }

  function update(
    dt: number,
    wantsFire: boolean,
    targets: readonly GunTarget[],
    _camera?: THREE.Camera,
  ): void {
    // ——— Trigger ———
    isFiring = false
    if (!wantsFire) heat = Math.max(0, heat - COOL_PER_SEC * dt)
    if (wantsFire && ammo > 0 && heat < 1) {
      isFiring = true
      cooldown -= dt
      const interval = 1 / RATE
      // Catch up across the frame so the rate is frame-rate independent.
      let guard = 0
      while (cooldown <= 0 && guard++ < 8) {
        fireOne()
        cooldown += interval
      }
    } else {
      cooldown = 0
    }

    // ——— Projectiles ———
    const stats = impactStats()
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!
      b.life -= dt
      if (b.life <= 0) {
        retire(i)
        continue
      }

      b.velocity.y -= SHELL_GRAVITY * dt
      _step.copy(b.velocity).multiplyScalar(dt)
      b.mesh.position.add(_step)
      const p = b.mesh.position

      if (Math.abs(p.x) > bounds.x || Math.abs(p.z) > bounds.z) {
        retire(i)
        continue
      }

      if (p.y <= heightAt(p.x, p.z)) {
        retire(i)
        continue
      }

      let consumed = false
      for (const t of targets) {
        if (!t.alive || !t.containsPoint(p)) continue
        const speed = b.velocity.length()
        const result = t.resolveShellHit(
          p,
          b.velocity,
          {
            basePenetration: shellPenetrationAtSpeed(stats.basePenetration, speed),
            baseDamage: stats.baseDamage,
          },
          { ammoId: 'mg' },
        )
        if (!result) continue
        if (result.destroyed) onKill?.(t.root)
        // A .50 cal splashes on armour rather than deflecting onward. Retiring
        // it here also stops a deflected round re-resolving against the same
        // tank for the rest of its life (which produced ~6 hits per round).
        consumed = true
        break
      }
      if (consumed) retire(i)
    }
  }

  return {
    update,
    ammo: () => ammo,
    heat: () => heat,
    firing: () => isFiring,
    refill() {
      ammo = MAX_AMMO
      heat = 0
      isFiring = false
    },
    setOnKill: (fn) => {
      onKill = fn
    },
    dispose() {
      for (let i = bullets.length - 1; i >= 0; i--) retire(i)
      // All bullets share one geometry and two materials — dispose once.
      geometry.dispose()
      tracerMat.dispose()
      plainMat.dispose()
      for (const m of muzzles) m.parent?.remove(m)
      converge.parent?.remove(converge)
    },
  }
}
