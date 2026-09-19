import * as THREE from 'three'

export type WreckFx = {
  wreckPlume: (origin: THREE.Vector3) => void
  wreckFire: (origin: THREE.Vector3) => void
  wreckBurn: (origin: THREE.Vector3) => void
}

type BurningWreck = {
  root: THREE.Object3D
  age: number
  origin: THREE.Vector3
  /** Seconds until next cheap burn puff. */
  nextEmit: number
}

const burning: BurningWreck[] = []

const _turretNames = ['Turret', 'turret', 'turretYawPivot']

/**
 * Char the tank and leave it where it died. `keepOriginal` clones first so a
 * respawning vehicle can hide its live mesh without the wreck vanishing with it.
 */
export function spawnDestroyedWreck(
  scene: THREE.Scene,
  root: THREE.Object3D,
  fx?: WreckFx | null,
  keepOriginal = false,
): void {
  const subject = keepOriginal ? cloneWreck(scene, root) : root
  if (keepOriginal) root.visible = false

  const origin = new THREE.Vector3()
  subject.getWorldPosition(origin)
  origin.y += 1.4

  fx?.wreckPlume(origin)
  fx?.wreckFire(origin)

  const charcoal = new THREE.MeshStandardMaterial({
    color: 0x2a2a28,
    roughness: 0.95,
    metalness: 0.05,
    emissive: 0x3a1808,
    emissiveIntensity: 0.35,
  })

  subject.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.material = charcoal
  })

  // Knock the turret, but keep it on the hull. Detaching it used to drop the
  // mesh to y=0.4, which is under the terrain — the tank looked like it vanished.
  let turret: THREE.Object3D | null = null
  for (const n of _turretNames) {
    const hit = subject.getObjectByName(n)
    if (hit) {
      turret = hit
      break
    }
  }
  if (turret) {
    turret.rotation.x += 0.35 + Math.random() * 0.45
    turret.rotation.z += (Math.random() - 0.5) * 0.4
    turret.position.y += 0.12
  }
  subject.rotation.z += (Math.random() - 0.5) * 0.12

  burning.push({ root: subject, age: 0, origin, nextEmit: 0.15 })
  console.info('[Steel] Wreck left burning')
}

function cloneWreck(scene: THREE.Scene, root: THREE.Object3D): THREE.Object3D {
  const clone = root.clone(true)
  clone.name = `${root.name || 'tank'}-wreck`
  clone.visible = true
  clone.traverse((obj) => {
    obj.visible = obj === clone ? true : obj.visible
    obj.userData = { wreck: true }
  })
  scene.add(clone)
  return clone
}

export function updateWrecks(dt: number, fx?: WreckFx | null): void {
  for (const b of burning) {
    b.age += dt
    b.nextEmit -= dt
    // Sparse cheap burn — was ~0.35 * wreckFire(16 puffs) every frame → lag
    if (b.age < 75 && fx && b.nextEmit <= 0) {
      fx.wreckBurn(b.origin)
      b.nextEmit = 0.28 + Math.random() * 0.22
    }
  }
}
