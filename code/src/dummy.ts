import * as THREE from 'three'
import { cloneGltfScene } from './loadGltf'
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
  /** APHE filler applied after pen. */
  internalDamage?: number
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
  /**
   * Same resolution **without** applying it, so the kill cam can tell whether
   * a shell in flight is lethal. Decide on `damage >= hp`; the `crit` flag is
   * a fresh random roll that won't match the real hit's.
   */
  previewShellHit: (
    p: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
  ) => HitResolution | null
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

/** Ground ring + tall beacon so the practice target is obvious in tutorials. */
function attachPracticeHighlight(root: THREE.Group, model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  root.worldToLocal(center)

  const mark = new THREE.Group()
  mark.name = 'practiceHighlight'

  const ringR = Math.max(3.2, Math.max(size.x, size.z) * 0.7)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ringR - 0.45, ringR, 48),
    new THREE.MeshBasicMaterial({
      color: 0xe8b84a,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.set(center.x, 0.12, center.z)
  ring.renderOrder = 10
  mark.add(ring)

  const inner = new THREE.Mesh(
    new THREE.RingGeometry(ringR * 0.35, ringR * 0.35 + 0.18, 40),
    new THREE.MeshBasicMaterial({
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  inner.rotation.x = -Math.PI / 2
  inner.position.set(center.x, 0.14, center.z)
  inner.renderOrder = 10
  mark.add(inner)

  // Tall beacon column — draws through foliage so you can find it in the trees.
  const poleH = 14
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, poleH, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffc84a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
    }),
  )
  pole.position.set(center.x, poleH * 0.5, center.z)
  pole.renderOrder = 11
  mark.add(pole)

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffe080,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
    }),
  )
  beacon.position.set(center.x, poleH + 0.4, center.z)
  beacon.renderOrder = 12
  mark.add(beacon)

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || !('emissive' in m)) continue
      const std = m as THREE.MeshStandardMaterial
      std.emissive = new THREE.Color(0x8a5a10)
      std.emissiveIntensity = 0.55
    }
  })

  root.add(mark)
  console.info('[Steel] Practice target highlighted (ring + tall beacon)')
}

/** Static Pz-III J target with part armor / HP. */
export async function spawnStaticPz3Dummy(
  scene: THREE.Scene,
  position: THREE.Vector3,
  yaw = Math.PI,
  opts?: { highlight?: boolean },
): Promise<DummyTarget> {
  const url = tankOptionById('pz3').url
  const model = await cloneGltfScene(url)
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
  if (opts?.highlight) attachPracticeHighlight(root, model)

  // Hull-only broadphase (exclude tall beacon so shells aren't "near" empty air).
  const broad = new THREE.Box3().setFromObject(model).expandByScalar(0.4)
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
    previewShellHit(p, velocity, shellStats) {
      if (!alive) return null
      volumes.updateWorld()
      return volumes.resolveHit(p, velocity, shellStats)
    },
    resolveShellHit(p, velocity, shellStats, ctx) {
      if (!alive) return null
      volumes.updateWorld()
      const resolution = volumes.resolveHit(p, velocity, shellStats)
      if (!resolution) return null

      let destroyed = false
      let internalDamage = 0
      if (resolution.kind === 'penetrated' || resolution.kind === 'blast') {
        hp = Math.max(0, hp - resolution.damage)
        // APHE fuse after pen — crit adds filler, never contact instakill.
        if (resolution.kind === 'penetrated' && ctx?.ammoId === 'aphe') {
          let fuse = Math.max(0, Math.round(shellStats.internalBlast ?? 0))
          if (resolution.crit) fuse += Math.round(maxHp * 0.42)
          if (fuse > 0) {
            hp = Math.max(0, hp - fuse)
            internalDamage = fuse
            console.info(
              `[Steel] APHE FUSE −${fuse}` +
                (resolution.crit ? ' (ammo cook)' : '') +
                ` · HP ${hp}/${maxHp}`,
            )
          }
        }
        if (hp <= 0) {
          alive = false
          destroyed = true
          hp = 0
          const reason =
            ctx?.ammoId === 'aphe'
              ? resolution.crit
                ? 'APHE FUSE · AMMO'
                : 'APHE FUSE'
              : 'DESTROYED'
          console.info(
            `[Steel] ${reason} — ${resolution.part.label} ${resolution.kind} ${resolution.damage}` +
              (internalDamage ? ` +fuse ${internalDamage}` : ''),
          )
          const hi = root.getObjectByName('practiceHighlight')
          if (hi) root.remove(hi)
          destroyVisual(scene, root)
        } else {
          console.info(
            `[Steel] ${resolution.kind.toUpperCase()} ${resolution.part.label} −${resolution.damage}` +
              (internalDamage ? ` · FUSE −${internalDamage}` : '') +
              ` HP (${hp}/${maxHp})`,
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

      return { resolution, destroyed, hp, internalDamage }
    },
  }
}
