import * as THREE from 'three'
import type { HeightSampler } from './ballistics'
import type { GunTarget } from './aircraftGuns'
import type { TrackedProjectile } from './impactCinematic'

/**
 * Two 1000 lb bombs plus the bombsight that makes them usable.
 *
 * The sight and the bomb share one integrator (`integrate`), so the predicted
 * impact ring cannot drift from where a bomb actually lands — if the physics
 * are tuned, the sight follows automatically.
 */

/**
 * Arcade bomb gravity. Real 9.81 from 140 m gives a ~5.3 s fall and a ~425 m
 * lead, which is unaimable without instruments on a 750 m-wide map; 16 keeps
 * the lead around 220 m from a 60 m run-in.
 */
const BOMB_GRAVITY = 16
const BOMB_COUNT = 2
/** Direct-hit and blast damage at the centre of the crater. */
const BOMB_DIRECT = 260
const BOMB_BLAST = 1600
const BOMB_RADIUS = 30
/** Low pen on purpose: a bomb should resolve as `blast`, not as a solid shot. */
const BOMB_PEN = 24
const RELEASE_GAP = 0.4
const BOMB_LIFETIME = 20

/** Prediction: coarse march in time to find the ground crossing, then bisect. */
const PREDICT_STEP = 1 / 20
const PREDICT_MAX_TIME = 14
const BISECT_STEPS = 10

export type BombPrediction = {
  point: THREE.Vector3
  /** Seconds from release to impact. */
  time: number
  valid: boolean
  /** An enemy is inside the lethal radius of the predicted impact. */
  lethal: boolean
}

type Bomb = {
  mesh: THREE.Mesh
  /** Release state — position is solved from this, never accumulated. */
  origin: THREE.Vector3
  vel0: THREE.Vector3
  t: number
  dead: boolean
}

/** Live handle on a released bomb, for the cinematic camera to follow. */
export type BombHandle = TrackedProjectile

export type AircraftBombs = {
  update: (
    dt: number,
    wantsDrop: boolean,
    targets: readonly GunTarget[],
    camera?: THREE.Camera,
  ) => void
  prediction: () => BombPrediction
  remaining: () => number
  inFlight: () => number
  /** Restock the bomb bay (KOTH respawn). */
  refill: () => void
  setOnKill: (fn: ((victim: THREE.Object3D) => void) | null) => void
  /** Fired the instant a bomb leaves the aircraft. */
  setOnRelease: (fn: ((bomb: BombHandle) => void) | null) => void
  /** Fired at detonation, with the blast centre. */
  setOnDetonate: (fn: ((at: THREE.Vector3) => void) | null) => void
  setSightVisible: (visible: boolean) => void
  dispose: () => void
}

export type BombOptions = {
  scene: THREE.Scene
  root: THREE.Object3D
  heightAt: HeightSampler
  bounds: { x: number; z: number }
  velocity: THREE.Vector3
}

export function createAircraftBombs(opts: BombOptions): AircraftBombs {
  const { scene, root, heightAt, bounds, velocity } = opts

  const bombGeo = new THREE.CapsuleGeometry(0.19, 1.0, 4, 8)
  const bombMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f45,
    roughness: 0.8,
    metalness: 0.3,
  })

  // Sight: flat ring on the ground plus a stalk so it reads against terrain.
  const sight = new THREE.Group()
  sight.name = 'bombSight'
  const ringGeo = new THREE.RingGeometry(5.5, 7.2, 40)
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7df0b8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 8
  const crossGeo = new THREE.PlaneGeometry(18, 0.5)
  const crossA = new THREE.Mesh(crossGeo, ringMat)
  crossA.rotation.x = -Math.PI / 2
  crossA.renderOrder = 8
  const crossB = new THREE.Mesh(crossGeo, ringMat)
  crossB.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  crossB.renderOrder = 8
  sight.add(ring, crossA, crossB)
  sight.visible = false
  scene.add(sight)

  const bombs: Bomb[] = []
  let remaining = BOMB_COUNT
  let gap = 0
  let sightOn = true
  let onKill: ((victim: THREE.Object3D) => void) | null = null
  let onRelease: ((bomb: BombHandle) => void) | null = null
  let onDetonate: ((at: THREE.Vector3) => void) | null = null

  const pred: BombPrediction = {
    point: new THREE.Vector3(),
    time: 0,
    valid: false,
    lethal: false,
  }

  const _p = new THREE.Vector3()
  const _v = new THREE.Vector3()
  const _dir = new THREE.Vector3()
  const _probe = new THREE.Vector3()

  /**
   * Exact ballistic position at time `t` after release.
   *
   * Solved in closed form rather than stepped, because the bomb advances on
   * variable frame `dt` while the sight marches on a fixed step — with Euler
   * integration those two disagree by ~0.5·g·t·h (about a metre here), so a
   * stepped sight would quietly lie about where the bomb lands.
   */
  function posAt(
    origin: THREE.Vector3,
    vel0: THREE.Vector3,
    t: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    out.copy(origin).addScaledVector(vel0, t)
    out.y -= 0.5 * BOMB_GRAVITY * t * t
    return out
  }

  function velAt(vel0: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(vel0)
    out.y -= BOMB_GRAVITY * t
    return out
  }

  function outOfBounds(p: THREE.Vector3): boolean {
    return Math.abs(p.x) > bounds.x || Math.abs(p.z) > bounds.z
  }

  /** Where a bomb released right now would land. */
  function predict(targets: readonly GunTarget[]): void {
    pred.valid = false
    pred.lethal = false

    let t = 0
    let prevT = 0
    while (t < PREDICT_MAX_TIME) {
      prevT = t
      t += PREDICT_STEP
      posAt(root.position, velocity, t, _p)
      if (outOfBounds(_p)) return
      if (_p.y > heightAt(_p.x, _p.z)) continue

      // Crossed the ground between prevT and t — bisect on time.
      let lo = prevT
      let hi = t
      for (let i = 0; i < BISECT_STEPS; i++) {
        const mid = (lo + hi) * 0.5
        posAt(root.position, velocity, mid, _p)
        if (_p.y > heightAt(_p.x, _p.z)) lo = mid
        else hi = mid
      }
      posAt(root.position, velocity, hi, _p)
      pred.point.copy(_p)
      pred.point.y = heightAt(_p.x, _p.z)
      pred.time = hi
      pred.valid = true

      for (const target of targets) {
        if (!target.alive) continue
        if (target.root.position.distanceTo(pred.point) <= BOMB_RADIUS) {
          pred.lethal = true
          break
        }
      }
      return
    }
  }

  /**
   * Find a point on the target the armour volumes will accept, by marching in
   * from the blast toward the hull centre.
   */
  function surfacePoint(from: THREE.Vector3, target: GunTarget): THREE.Vector3 | null {
    const centre = target.root.position
    if (target.containsPoint(centre)) return centre
    for (let i = 1; i <= 12; i++) {
      _probe.lerpVectors(from, centre, i / 12)
      if (target.containsPoint(_probe)) return _probe
    }
    return null
  }

  function detonate(at: THREE.Vector3, targets: readonly GunTarget[]): void {
    flash(at)
    onDetonate?.(at)
    for (const target of targets) {
      if (!target.alive) continue
      const dist = target.root.position.distanceTo(at)
      if (dist > BOMB_RADIUS) continue

      const falloff = Math.pow(1 - dist / BOMB_RADIUS, 1.5)
      const probe = surfacePoint(at, target)
      if (!probe) continue

      _dir.copy(target.root.position).sub(at)
      if (_dir.lengthSq() < 1e-6) _dir.set(0, -1, 0)
      _dir.normalize().multiplyScalar(90)

      const result = target.resolveShellHit(
        probe,
        _dir,
        {
          basePenetration: BOMB_PEN,
          baseDamage: Math.round(BOMB_DIRECT * falloff),
          blastDamage: Math.round(BOMB_BLAST * falloff),
        },
        { ammoId: 'he' },
      )
      if (result?.destroyed) onKill?.(target.root)
    }
  }

  /** Expanding flash — cheap stand-in for a proper explosion. */
  function flash(at: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(2.2, 10, 10)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb257,
      transparent: true,
      opacity: 1,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(at)
    scene.add(mesh)
    const t0 = performance.now()
    const tick = (now: number): void => {
      const u = (now - t0) / 620
      if (u >= 1) {
        scene.remove(mesh)
        geo.dispose()
        mat.dispose()
        return
      }
      mesh.scale.setScalar(1 + u * 7)
      mat.opacity = 1 - u
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  function release(): void {
    if (remaining <= 0 || gap > 0) return
    remaining--
    gap = RELEASE_GAP
    const mesh = new THREE.Mesh(bombGeo, bombMat)
    mesh.position.copy(root.position)
    mesh.castShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
    const bomb: Bomb = {
      mesh,
      origin: root.position.clone(),
      vel0: velocity.clone(),
      t: 0,
      dead: false,
    }
    bombs.push(bomb)

    onRelease?.({
      // Live reference: the mesh position is rewritten each frame.
      position: bomb.mesh.position,
      impact: pred.valid ? pred.point.clone() : root.position.clone(),
      flightTime: pred.valid ? pred.time : 0,
      live: () => !bomb.dead,
    })
  }

  function retire(i: number): void {
    const b = bombs[i]!
    b.dead = true
    scene.remove(b.mesh)
    bombs.splice(i, 1)
  }

  function update(
    dt: number,
    wantsDrop: boolean,
    targets: readonly GunTarget[],
    _camera?: THREE.Camera,
  ): void {
    gap = Math.max(0, gap - dt)
    if (wantsDrop) release()

    predict(targets)
    const showSight = sightOn && pred.valid && remaining > 0
    sight.visible = showSight
    if (showSight) {
      sight.position.copy(pred.point)
      sight.position.y += 0.4
      ringMat.color.setHex(pred.lethal ? 0xff8355 : 0x7df0b8)
    }

    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]!
      b.t += dt
      if (b.t >= BOMB_LIFETIME) {
        retire(i)
        continue
      }

      posAt(b.origin, b.vel0, b.t, b.mesh.position)
      if (outOfBounds(b.mesh.position)) {
        retire(i)
        continue
      }

      // Weathervane into the airstream so it falls nose-first.
      velAt(b.vel0, b.t, _v)
      b.mesh.lookAt(
        b.mesh.position.x + _v.x,
        b.mesh.position.y + _v.y,
        b.mesh.position.z + _v.z,
      )
      b.mesh.rotateX(Math.PI / 2)

      const p = b.mesh.position
      let hit = p.y <= heightAt(p.x, p.z)
      if (!hit) {
        for (const target of targets) {
          if (target.alive && target.containsPoint(p)) {
            hit = true
            break
          }
        }
      }
      if (hit) {
        detonate(p, targets)
        retire(i)
      }
    }
  }

  return {
    update,
    prediction: () => pred,
    remaining: () => remaining,
    inFlight: () => bombs.length,
    refill() {
      remaining = BOMB_COUNT
      gap = 0
    },
    setOnKill: (fn) => {
      onKill = fn
    },
    setOnRelease: (fn) => {
      onRelease = fn
    },
    setOnDetonate: (fn) => {
      onDetonate = fn
    },
    setSightVisible: (visible) => {
      sightOn = visible
    },
    dispose() {
      for (let i = bombs.length - 1; i >= 0; i--) retire(i)
      scene.remove(sight)
      bombGeo.dispose()
      bombMat.dispose()
      ringGeo.dispose()
      crossGeo.dispose()
      ringMat.dispose()
    },
  }
}

export { BOMB_RADIUS }
