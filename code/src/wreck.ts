import * as THREE from 'three'

export type WreckFx = {
  wreckPlume: (origin: THREE.Vector3) => void
  wreckFire: (origin: THREE.Vector3) => void
  wreckBurn: (origin: THREE.Vector3) => void
}

type FlyingTurret = {
  mesh: THREE.Object3D
  vel: THREE.Vector3
  spin: THREE.Vector3
  life: number
}

type BurningWreck = {
  root: THREE.Object3D
  age: number
  origin: THREE.Vector3
  /** Seconds until next cheap burn puff. */
  nextEmit: number
}

const flying: FlyingTurret[] = []
const burning: BurningWreck[] = []

const _turretNames = ['Turret', 'turret', 'turretYawPivot']

/**
 * Char the tank, fling the turret, leave a lasting burning wreck (no instant despawn).
 */
export function spawnDestroyedWreck(
  scene: THREE.Scene,
  root: THREE.Object3D,
  fx?: WreckFx | null,
): void {
  const origin = root.position.clone()
  origin.y = 1.2

  fx?.wreckPlume(origin)
  fx?.wreckFire(origin)

  const charcoal = new THREE.MeshStandardMaterial({
    color: 0x2a2a28,
    roughness: 0.95,
    metalness: 0.05,
    emissive: 0x3a1808,
    emissiveIntensity: 0.35,
  })

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.material = charcoal
    }
  })

  let turret: THREE.Object3D | null = null
  for (const n of _turretNames) {
    const hit = root.getObjectByName(n)
    if (hit) {
      turret = hit
      break
    }
  }

  if (turret && turret.parent) {
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    turret.getWorldPosition(worldPos)
    turret.getWorldQuaternion(worldQuat)
    turret.parent.remove(turret)
    scene.add(turret)
    turret.position.copy(worldPos)
    turret.quaternion.copy(worldQuat)
    flying.push({
      mesh: turret,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        8 + Math.random() * 5,
        (Math.random() - 0.5) * 6,
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      ),
      life: 4,
    })
  }

  burning.push({ root, age: 0, origin, nextEmit: 0.15 })
  console.info('[Steel] Wreck left burning')
}

export function updateWrecks(dt: number, fx?: WreckFx | null): void {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]
    f.life -= dt
    f.vel.y -= 18 * dt
    f.mesh.position.addScaledVector(f.vel, dt)
    f.mesh.rotation.x += f.spin.x * dt
    f.mesh.rotation.y += f.spin.y * dt
    f.mesh.rotation.z += f.spin.z * dt
    if (f.mesh.position.y < 0.4) {
      f.mesh.position.y = 0.4
      f.vel.set(0, 0, 0)
      f.spin.multiplyScalar(0.9)
    }
    if (f.life <= 0) {
      flying.splice(i, 1)
    }
  }

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
