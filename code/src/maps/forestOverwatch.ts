import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { estimatePropCollider, type PropCollider } from '../collision'
import { createGrassTexture } from '../textures'

/** Playable arena size. */
export const FOREST_OVERWATCH_SIZE = 1000
/** Legacy AI hint — north side. */
export const FOREST_OVERWATCH_DUMMY = new THREE.Vector3(0, 0, 280)

export type ForestMapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
}

const PINE_URL = '/maps/props/pine_tree.glb'
/** Kept low — pines are heavy; instances share 1–2 merged meshes. */
const TREE_COUNT = 72
/** Keep center + spawn lanes open for fighting. */
const CLEAR_CENTER_R = 110
const CLEAR_SPAWN_HALF_X = 90
const CLEAR_SPAWN_Z = 340

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _dummy = new THREE.Object3D()

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function blockedForTree(x: number, z: number): boolean {
  if (Math.hypot(x, z) < CLEAR_CENTER_R) return true
  if (Math.abs(x) < CLEAR_SPAWN_HALF_X && Math.abs(z) > CLEAR_SPAWN_Z * 0.55) return true
  if (Math.abs(x) < 28 && Math.abs(z) < CLEAR_SPAWN_Z) return true
  return false
}

/** Stand Z-up Sketchfab pines on Y and plant base at y=0. Returns unit height. */
function uprightAndPlant(root: THREE.Object3D): number {
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.setScalar(1)
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  _box.getSize(_size)

  if (_size.z >= _size.y && _size.z >= _size.x) {
    root.rotation.x = -Math.PI / 2
  } else if (_size.x >= _size.y && _size.x >= _size.z) {
    root.rotation.z = Math.PI / 2
  }
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  root.position.y = -_box.min.y
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  return Math.max(_box.max.y - _box.min.y, 0.001)
}

type PinePart = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/**
 * Collapse ~160 pine meshes into 1 draw call per unique material.
 * Geometry is baked in world space of the uprighted template.
 */
function bakePineParts(root: THREE.Object3D): PinePart[] {
  const buckets = new Map<
    string,
    { material: THREE.Material; geos: THREE.BufferGeometry[] }
  >()

  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    if (Array.isArray(obj.material)) return // skip rare multi-mat meshes
    const mat = obj.material
    if (!mat) return
    let bucket = buckets.get(mat.uuid)
    if (!bucket) {
      const m = mat.clone()
      if ('metalness' in m && typeof m.metalness === 'number') m.metalness = 0
      if ('roughness' in m && typeof m.roughness === 'number') {
        m.roughness = Math.max(0.85, m.roughness)
      }
      bucket = { material: m, geos: [] }
      buckets.set(mat.uuid, bucket)
    }
    const g = obj.geometry.clone()
    g.applyMatrix4(obj.matrixWorld)
    bucket.geos.push(g)
  })

  const parts: PinePart[] = []
  for (const bucket of buckets.values()) {
    if (bucket.geos.length === 0) continue
    const merged = mergeGeometries(bucket.geos, false)
    for (const g of bucket.geos) g.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    parts.push({ geometry: merged, material: bucket.material })
  }
  return parts
}

async function placePineTrees(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(PINE_URL)
  const src = gltf.scene
  const unitHeight = uprightAndPlant(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Pine bake produced 0 parts')
    return 0
  }

  const rand = mulberry32(0xf02e57)
  const half = FOREST_OVERWATCH_SIZE * 0.46
  const placements: Array<{ x: number; z: number; yaw: number; height: number }> =
    []
  let attempts = 0
  const maxAttempts = TREE_COUNT * 10
  while (placements.length < TREE_COUNT && attempts < maxAttempts) {
    attempts++
    const x = (rand() - 0.5) * 2 * half
    const z = (rand() - 0.5) * 2 * half
    if (blockedForTree(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 13 + rand() * 8,
    })
  }

  const count = placements.length
  for (let p = 0; p < parts.length; p++) {
    const { geometry, material } = parts[p]
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = `forestPineInstanced_${p}`
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = true
    mesh.matrixAutoUpdate = false

    for (let i = 0; i < count; i++) {
      const pl = placements[i]
      const s = pl.height / unitHeight
      _dummy.position.set(pl.x, 0, pl.z)
      _dummy.rotation.set(0, pl.yaw, 0)
      _dummy.scale.set(s, s, s)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    root.add(mesh)
  }

  for (const pl of placements) {
    const shape = estimatePropCollider('tree', pl.height)
    colliders.push({
      x: pl.x,
      z: pl.z,
      radius: shape.radius,
      maxY: shape.maxY,
    })
  }

  console.info(
    `[Steel] Forest pines — ${count} instances, ${parts.length} merged draw calls (was ~${count * 160} meshes)`,
  )
  return count
}

function applyForestFloor(ground: THREE.Mesh): void {
  const mat = ground.material
  if (!(mat instanceof THREE.MeshStandardMaterial)) return
  const grass = createGrassTexture(Math.max(40, FOREST_OVERWATCH_SIZE / 18))
  if (mat.map && mat.map !== grass) {
    mat.map.dispose()
  }
  mat.map = grass
  mat.color.setHex(0xb8c98a)
  mat.roughness = 0.96
  mat.metalness = 0.02
  mat.needsUpdate = true
}

/**
 * Forest Overwatch — large flat arena with instanced pine cover.
 */
export async function loadForestOverwatch(
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<ForestMapLoadResult> {
  applyForestFloor(ground)

  const root = new THREE.Group()
  root.name = 'ForestOverwatch'
  scene.add(root)

  const colliders: PropCollider[] = []
  let treeCount = 0
  try {
    treeCount = await placePineTrees(root, colliders)
  } catch (err) {
    console.warn('[Steel] Forest pine trees failed to load', err)
  }

  console.info(
    `[Steel] Forest Overwatch — ${FOREST_OVERWATCH_SIZE}m, ${treeCount} pines, ${colliders.length} colliders`,
  )
  return { root, colliders }
}
