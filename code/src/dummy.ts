import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HitResolution, ShellImpact } from './armor'
import type { ShellHitContext } from './combatant'
import { createTankHitVolumes } from './hitParts'
import { paintTankDunkelgrau } from './paint'
import { tankOptionById } from './tankCatalog'
import { spawnDestroyedWreck } from './wreck'

export type DummyHitResult = {
  resolution: HitResolution
  /** True if this hit destroyed the dummy. */
  destroyed: boolean
  /** Remaining HP after the hit. */
  hp: number
  tracksDisabled?: boolean
}

export type DummyTarget = {
  root: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  /** Broad phase: is the point near the dummy at all? */
  containsPoint: (p: THREE.Vector3) => boolean
  /** Armor resolution for a shell at this point with this velocity. */
  resolveShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
    ctx?: ShellHitContext,
  ) => DummyHitResult | null
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = false
    }
  })
}

function normalizeModel(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  const longest = Math.max(size.x, size.y, size.z, 0.001)
  root.scale.setScalar(3.8 / longest)
  box.setFromObject(root)
  root.position.y -= box.min.y
}

function destroyVisual(scene: THREE.Scene, root: THREE.Group): void {
  spawnDestroyedWreck(scene, root, null)
}

/** Static Pz-III J target with part armor / HP. */
export async function spawnStaticPz3Dummy(
  scene: THREE.Scene,
  position: THREE.Vector3,
  yaw = Math.PI,
): Promise<DummyTarget> {
  const url = tankOptionById('pz3').url
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
  loader.setDRACOLoader(draco)

  const gltf = await loader.loadAsync(url)
  const model = gltf.scene
  model.name = 'dummyPz3Model'
  normalizeModel(model)
  paintTankDunkelgrau(model)
  enableShadows(model)
  model.updateMatrixWorld(true)
  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.frustumCulled = false
      obj.geometry?.computeBoundingSphere()
      // Slightly darker than player so the dummy reads as a target
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (m && 'color' in m && m.color instanceof THREE.Color) {
          m.color.multiplyScalar(0.78)
        }
      }
    }
  })

  const root = new THREE.Group()
  root.name = 'dummyPz3'
  root.add(model)
  root.position.copy(position)
  root.rotation.y = yaw
  scene.add(root)
  root.updateMatrixWorld(true)

  const broad = new THREE.Box3().setFromObject(root).expandByScalar(0.4)
  const volumes = createTankHitVolumes(root)

  const maxHp = 1000
  let hp = maxHp
  let alive = true

  return {
    root,
    get alive() {
      return alive
    },
    get hp() {
      return hp
    },
    maxHp,
    containsPoint(p) {
      if (!alive) return false
      return broad.containsPoint(p)
    },
    resolveShellHit(p, velocity, shellStats) {
      if (!alive) return null
      volumes.updateWorld()
      const resolution = volumes.resolveHit(p, velocity, shellStats)
      if (!resolution) return null

      let destroyed = false
      if (resolution.kind === 'penetrated' || resolution.kind === 'blast') {
        hp = Math.max(0, hp - resolution.damage)
        if (resolution.crit || hp <= 0) {
          alive = false
          destroyed = true
          hp = 0
          const reason = resolution.crit ? 'AMMO RACK' : 'DESTROYED'
          console.info(
            `[Steel] ${reason} — ${resolution.part.label} ${resolution.kind} ${resolution.damage}`,
          )
          destroyVisual(scene, root)
        } else {
          console.info(
            `[Steel] ${resolution.kind.toUpperCase()} ${resolution.part.label} −${resolution.damage} HP (${hp}/${maxHp})`,
          )
        }
      } else if (resolution.kind === 'ricochet') {
        console.info(
          `[Steel] RICOCHET ${resolution.part.label} @ ${resolution.angleDeg.toFixed(0)}°`,
        )
      } else {
        console.info(
          `[Steel] NO PEN ${resolution.part.label} — ${resolution.penetration.toFixed(0)} < ${resolution.effectiveArmor.toFixed(0)}mm`,
        )
      }

      return { resolution, destroyed, hp }
    },
  }
}
