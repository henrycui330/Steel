import * as THREE from 'three'

/**
 * Player aircraft chaff / flare — Q dumps decoys that confuse seekers.
 */

const COOLDOWN = 3.5
const BURST = 8
const DECOY_LIFE = 5.5
const BANNER_SEC = 1.6

export type Countermeasures = {
  /** Call each frame; pass true while Q is held / edge handled inside. */
  update: (dt: number, wantsDrop: boolean) => void
  /** Live decoy roots for missile spoofing. */
  getDecoys: () => readonly THREE.Object3D[]
  /** True while the on-screen release banner should show. */
  bannerActive: () => boolean
  dispose: () => void
}

export type CountermeasureOpts = {
  scene: THREE.Scene
  getPosition: (out: THREE.Vector3) => void
  getVelocity: (out: THREE.Vector3) => void
}

type Decoy = {
  root: THREE.Object3D
  vel: THREE.Vector3
  age: number
  life: number
  kind: 'chaff' | 'flare'
}

const _pos = new THREE.Vector3()
const _vel = new THREE.Vector3()
const _right = new THREE.Vector3()
const _back = new THREE.Vector3()

export function createCountermeasures(opts: CountermeasureOpts): Countermeasures {
  const { scene } = opts
  const decoys: Decoy[] = []
  let cooldown = 0
  let bannerT = 0
  let dropHeld = false

  const chaffMat = new THREE.MeshBasicMaterial({
    color: 0xb8c0c8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const flareMat = new THREE.MeshBasicMaterial({
    color: 0xff9030,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const chaffGeo = new THREE.SphereGeometry(0.55, 6, 6)
  const flareGeo = new THREE.SphereGeometry(0.35, 6, 6)

  function dropBurst(): void {
    opts.getPosition(_pos)
    opts.getVelocity(_vel)
    _back.copy(_vel)
    if (_back.lengthSq() < 1) _back.set(0, 0, -1)
    else _back.normalize().multiplyScalar(-1)
    _right.set(_back.z, 0, -_back.x)
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0)
    _right.normalize()

    for (let i = 0; i < BURST; i++) {
      const kind: 'chaff' | 'flare' = i % 2 === 0 ? 'flare' : 'chaff'
      const mesh = new THREE.Mesh(
        kind === 'flare' ? flareGeo : chaffGeo,
        (kind === 'flare' ? flareMat : chaffMat).clone(),
      )
      const side = (i % 2 === 0 ? 1 : -1) * (1.2 + Math.random() * 2.5)
      const aft = 2 + Math.random() * 4
      mesh.position
        .copy(_pos)
        .addScaledVector(_back, aft)
        .addScaledVector(_right, side)
        .addScaledVector(new THREE.Vector3(0, 1, 0), -0.5 + Math.random() * 1.2)
      scene.add(mesh)

      const drift = _back
        .clone()
        .multiplyScalar(8 + Math.random() * 14)
        .addScaledVector(_right, (Math.random() - 0.5) * 10)
      drift.y += (Math.random() - 0.3) * 6
      // Inherit some airframe velocity so decoys don't stop dead.
      drift.addScaledVector(_vel, 0.35)

      decoys.push({
        root: mesh,
        vel: drift,
        age: 0,
        life: DECOY_LIFE * (0.75 + Math.random() * 0.4),
        kind,
      })
    }
    cooldown = COOLDOWN
    bannerT = BANNER_SEC
    console.info('[Steel] Releasing Chaff / Flare')
  }

  function killDecoy(d: Decoy): void {
    scene.remove(d.root)
    if (d.root instanceof THREE.Mesh) {
      d.root.geometry.dispose()
      ;(d.root.material as THREE.Material).dispose()
    }
  }

  return {
    update(dt, wantsDrop) {
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt)
      if (bannerT > 0) bannerT = Math.max(0, bannerT - dt)

      if (wantsDrop && !dropHeld && cooldown <= 0) dropBurst()
      dropHeld = wantsDrop

      for (const d of decoys) {
        d.age += dt
        d.root.position.addScaledVector(d.vel, dt)
        d.vel.multiplyScalar(Math.exp(-0.35 * dt))
        d.vel.y -= 2.2 * dt
        const fade = 1 - d.age / d.life
        if (d.root instanceof THREE.Mesh) {
          const mat = d.root.material as THREE.MeshBasicMaterial
          mat.opacity = Math.max(0, fade * (d.kind === 'flare' ? 0.95 : 0.5))
        }
        if (d.kind === 'flare') {
          const s = 0.8 + Math.sin(d.age * 14) * 0.25
          d.root.scale.setScalar(s)
        }
      }
      for (let i = decoys.length - 1; i >= 0; i--) {
        if (decoys[i]!.age >= decoys[i]!.life) {
          killDecoy(decoys[i]!)
          decoys.splice(i, 1)
        }
      }
      publishDecoys(decoys.map((d) => d.root))
    },
    getDecoys: () => decoys.map((d) => d.root),
    bannerActive: () => bannerT > 0,
    dispose() {
      for (const d of decoys) killDecoy(d)
      decoys.length = 0
      publishDecoys([])
      chaffGeo.dispose()
      flareGeo.dispose()
      chaffMat.dispose()
      flareMat.dispose()
    },
  }
}

/** Shared list so ground SAMs can see player aircraft decoys. */
let publishedDecoys: readonly THREE.Object3D[] = []

function publishDecoys(list: readonly THREE.Object3D[]): void {
  publishedDecoys = list
}

export function readPublishedDecoys(): readonly THREE.Object3D[] {
  return publishedDecoys
}
