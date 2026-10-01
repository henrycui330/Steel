import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { estimatePropCollider, type PropCollider } from '../collision'
import { assetUrl } from '../assetUrl'
import { loadGltfCached, preloadUrls } from '../loadGltf'
import { createAsphaltTexture, createGravelShoulderTexture, createPineForestFloorMaps, sampleForestGroundTint } from '../textures'

/** Playable arena — width (X) × depth/height (Z). */
export const FOREST_OVERWATCH_WIDTH = 750
export const FOREST_OVERWATCH_DEPTH = 2000
/** Max axis — fog / shadow helpers. */
export const FOREST_OVERWATCH_SIZE = Math.max(
  FOREST_OVERWATCH_WIDTH,
  FOREST_OVERWATCH_DEPTH,
)
/** Legacy AI hint — north side. */
export const FOREST_OVERWATCH_DUMMY = new THREE.Vector3(0, 0, 280)

export type ForestTown = {
  id: string
  name: string
  x: number
  z: number
  radius: number
}

/**
 * Three open clearings — ruined hamlets (houses + crates + rubble).
 * Middle = largest. Flattened in the heightfield; trees kept out.
 */
export const FOREST_TOWNS: readonly ForestTown[] = [
  { id: 'south', name: 'South Hollow', x: 14, z: -520, radius: 92 },
  { id: 'mid', name: 'Midwood', x: 0, z: 0, radius: 110 },
  { id: 'north', name: 'North Ridge', x: -16, z: 520, radius: 92 },
]

/** Soft hills placed away from clearings / roads (peak height ≈ h). */
const FOREST_HILLS: ReadonlyArray<{ x: number; z: number; h: number; r: number }> = [
  { x: 220, z: 380, h: 18, r: 115 },
  { x: -210, z: -420, h: 20, r: 125 },
  { x: 180, z: -700, h: 14, r: 100 },
  { x: -230, z: 680, h: 16, r: 105 },
  { x: 120, z: 820, h: 12, r: 85 },
  { x: -140, z: -860, h: 13, r: 92 },
  { x: 280, z: -160, h: 15, r: 105 },
  { x: -270, z: 120, h: 12, r: 90 },
  { x: 70, z: -300, h: 9, r: 58 },
  { x: -90, z: 280, h: 10.5, r: 65 },
  { x: 150, z: 160, h: 8.5, r: 55 },
  { x: -160, z: -180, h: 9.5, r: 62 },
  // Extra mid-scale bumps for a slightly rougher floor
  { x: 250, z: 540, h: 11, r: 72 },
  { x: -255, z: -560, h: 12, r: 78 },
  { x: 95, z: -480, h: 8, r: 48 },
  { x: -110, z: 460, h: 8.5, r: 52 },
]

export type ForestMapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
  groundY: number
  heightAt?: (x: number, z: number) => number
  paths?: Array<{ points: Array<{ x: number; z: number }> }>
}

const PINE_URL = assetUrl('maps/props/pine_tree.glb')
const RUIN_HOUSE_URL = assetUrl('maps/props/ruined_house_low_poly.glb')
const WORN_SHED_URL = assetUrl('maps/props/worn_shed.glb')
const FANCY_CAR_URL = assetUrl('maps/props/fancy_cardestroyed.glb')
const DESTROYED_CAR_URL = assetUrl('maps/props/destroyed_car.glb')
const ROCKS_URL = assetUrl('maps/props/stylised_rocks_asset_pack.glb')

export const FOREST_PROP_URLS: readonly string[] = [
  PINE_URL,
  RUIN_HOUSE_URL,
  WORN_SHED_URL,
  FANCY_CAR_URL,
  DESTROYED_CAR_URL,
  ROCKS_URL,
]
/** Kept moderate — pines share 1–2 merged meshes via InstancedMesh. */
const TREE_COUNT = 168
/** Individual rock instances (clustered into small cliff piles + field scatter). */
const ROCK_COUNT = 120
/** How many unique Plain_Rock meshes to keep as instance templates. */
const ROCK_TEMPLATE_COUNT = 8
/** Cap mid-distance wrecks (fancy + destroyed). */
const WRECK_CAP = 14
const CLEAR_SPAWN_HALF_X = 70
const CLEAR_SPAWN_Z = 820

/** Native tile scale unused — roads are continuous ribbons now. */
const ROAD_CLEAR_HALF = 22
/** Hard-flat shoulder so roads sit in a real clearing. */
const ROAD_FLAT_HALF = 18
const ROAD_Y = 0.05
/** Heightfield resolution (segments per axis). */
const TERRAIN_SEG_X = 96
const TERRAIN_SEG_Z = 200

type RoadPt = { x: number; z: number }

/** Gentle control points — densified into smooth curves (not stair-steps). */
const ROAD_CTRL: readonly (readonly RoadPt[])[] = [
  // Main S–N winding spine
  [
    { x: 0, z: -920 },
    { x: 35, z: -740 },
    { x: 95, z: -560 },
    { x: -50, z: -380 },
    { x: 55, z: -200 },
    { x: 0, z: -40 },
    { x: -65, z: 140 },
    { x: 70, z: 320 },
    { x: -45, z: 500 },
    { x: 25, z: 680 },
    { x: 0, z: 860 },
    { x: 0, z: 940 },
  ],
  // Midwood west spur
  [
    { x: -320, z: 10 },
    { x: -200, z: -25 },
    { x: -90, z: 20 },
    { x: 0, z: -40 },
  ],
  // Midwood east spur
  [
    { x: 320, z: -10 },
    { x: 200, z: 30 },
    { x: 85, z: -15 },
    { x: 0, z: -40 },
  ],
  // Soft spur into North Ridge
  [
    { x: -45, z: 500 },
    { x: -55, z: 545 },
    { x: 5, z: 575 },
    { x: 50, z: 545 },
    { x: 15, z: 510 },
  ],
]

const ROAD_WIDTH = 14
/** Gravel shoulder wider than asphalt (Vision V5a). */
const ROAD_SKIRT_WIDTH = ROAD_WIDTH + 10
/** Tire track half-spacing from centerline (Vision V5b). */
const ROAD_RUT_HALF = 1.15
const ROAD_RUT_WIDTH = 0.55

type ContactSpot = { x: number; z: number; radius: number }

/** Soft radial disc under props — read as contact AO without real shadow maps. */
function createContactBlobTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.62)')
  g.addColorStop(0.28, 'rgba(0,0,0,0.32)')
  g.addColorStop(0.62, 'rgba(0,0,0,0.1)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return tex
}

function placeContactBlobs(root: THREE.Group, spots: ContactSpot[]): number {
  if (spots.length === 0) return 0
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    map: createContactBlobTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
  mesh.name = 'forestContactBlobs'
  mesh.renderOrder = 2
  mesh.frustumCulled = true
  mesh.matrixAutoUpdate = false
  mesh.castShadow = false
  mesh.receiveShadow = false

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!
    const y = forestHeightAt(s.x, s.z) + 0.06
    const d = s.radius * 2
    _dummy.position.set(s.x, y, s.z)
    _dummy.rotation.set(0, 0, 0)
    _dummy.scale.set(d, 1, d)
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  root.add(mesh)
  console.info(`[Steel] V3 contact blobs — ${spots.length} discs`)
  return spots.length
}

/**
 * V3b — darken shoulders / town pads in vertex tint (worn vs deep forest).
 * Returns 0.75–1 multiplier.
 */
function sampleWearMul(x: number, z: number): number {
  let mul = 1

  const dRoad = distToRoads(x, z)
  const asphalt = ROAD_WIDTH * 0.5
  const outer = ROAD_FLAT_HALF + 24
  if (dRoad < outer) {
    let wear: number
    if (dRoad <= asphalt + 1.5) wear = 0.2
    else {
      const u = (dRoad - asphalt) / (outer - asphalt)
      const s = u * u * (3 - 2 * u)
      wear = 0.2 * (1 - s)
    }
    mul *= 1 - wear
  }

  for (const town of FOREST_TOWNS) {
    const d = Math.hypot(x - town.x, z - town.z)
    const outerT = town.radius * 1.02
    const innerT = town.radius * 0.28
    if (d < outerT) {
      const u = d <= innerT ? 1 : 1 - (d - innerT) / (outerT - innerT)
      mul *= 1 - 0.16 * Math.max(0, u)
    }
  }

  return THREE.MathUtils.clamp(mul, 0.72, 1)
}

function catmull1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/** Densify control polyline into a smooth path for mesh + corridor tests. */
function densifyRoad(ctrl: readonly RoadPt[], perSeg = 18): RoadPt[] {
  if (ctrl.length < 2) return ctrl.map((p) => ({ ...p }))
  const out: RoadPt[] = []
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!
    const p1 = ctrl[i]!
    const p2 = ctrl[i + 1]!
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg
      out.push({
        x: catmull1(p0.x, p1.x, p2.x, p3.x, t),
        z: catmull1(p0.z, p1.z, p2.z, p3.z, t),
      })
    }
  }
  const last = ctrl[ctrl.length - 1]!
  out.push({ x: last.x, z: last.z })
  return out
}

const ROAD_POLYLINES: readonly (readonly RoadPt[])[] = ROAD_CTRL.map((c) =>
  densifyRoad(c, 20),
)

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

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-8) return Math.hypot(px - ax, pz - az)
  let t = ((px - ax) * dx + (pz - az) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function distToRoads(x: number, z: number): number {
  let best = Infinity
  for (const line of ROAD_POLYLINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!
      const b = line[i + 1]!
      best = Math.min(best, distToSegment(x, z, a.x, a.z, b.x, b.z))
    }
  }
  return best
}

function onRoadCorridor(x: number, z: number): boolean {
  return distToRoads(x, z) < ROAD_CLEAR_HALF
}

/** 1 = full relief, 0 = forced flat (roads, clearings, spawn pads). */
function flattenMask(x: number, z: number): number {
  let m = 1

  const roadOuter = ROAD_FLAT_HALF + 16
  const dRoad = distToRoads(x, z)
  if (dRoad <= ROAD_FLAT_HALF) m = 0
  else if (dRoad < roadOuter) {
    const u = (dRoad - ROAD_FLAT_HALF) / (roadOuter - ROAD_FLAT_HALF)
    m = Math.min(m, u * u * (3 - 2 * u))
  }

  for (const town of FOREST_TOWNS) {
    const d = Math.hypot(x - town.x, z - town.z)
    const inner = town.radius * 0.78
    const outer = town.radius
    if (d <= inner) m = 0
    else if (d < outer) {
      const u = (d - inner) / Math.max(0.001, outer - inner)
      m = Math.min(m, u * u * (3 - 2 * u))
    }
  }

  // Spawn lanes (N/S) stay driveable
  if (Math.abs(x) < CLEAR_SPAWN_HALF_X && Math.abs(z) > CLEAR_SPAWN_Z * 0.55) {
    const tx = Math.abs(x) / CLEAR_SPAWN_HALF_X
    m = Math.min(m, 0.08 + tx * 0.92)
  }

  return Math.max(0, Math.min(1, m))
}

function rawRelief(x: number, z: number): number {
  // Multi-scale bumps — slightly rougher than the original soft roll
  let h =
    Math.sin(x * 0.009) * Math.cos(z * 0.0085) * 5.4 +
    Math.sin(x * 0.019 + 1.1) * Math.cos(z * 0.017 - 0.5) * 4.0 +
    Math.sin(x * 0.038 + z * 0.015) * Math.cos(z * 0.034) * 2.5 +
    Math.sin(x * 0.072) * Math.sin(z * 0.068 + 2.2) * 1.55 +
    Math.sin(x * 0.13 + 0.7) * Math.cos(z * 0.11) * 0.8 +
    Math.sin(x * 0.21 + z * 0.17) * Math.cos(z * 0.19 - 0.4) * 0.45

  for (const hill of FOREST_HILLS) {
    const dx = x - hill.x
    const dz = z - hill.z
    const u = 1 - (dx * dx + dz * dz) / (hill.r * hill.r)
    if (u > 0) h += hill.h * u * u * (0.65 + 0.35 * u)
  }

  // Soft bowl at far rim so walls still meet the floor
  const edgeX = Math.abs(x) / (FOREST_OVERWATCH_WIDTH * 0.48)
  const edgeZ = Math.abs(z) / (FOREST_OVERWATCH_DEPTH * 0.48)
  const edge = Math.max(edgeX, edgeZ)
  if (edge > 0.9) h *= Math.max(0, 1 - (edge - 0.9) / 0.1)

  return h
}

/** Sample terrain height (m). Flat in clearings + road corridors. */
export function forestHeightAt(x: number, z: number): number {
  return rawRelief(x, z) * flattenMask(x, z)
}

function inTownClearing(x: number, z: number): boolean {
  for (const town of FOREST_TOWNS) {
    if (Math.hypot(x - town.x, z - town.z) < town.radius * 0.92) return true
  }
  return false
}

function blockedForTree(x: number, z: number): boolean {
  if (onRoadCorridor(x, z)) return true
  if (inTownClearing(x, z)) return true
  if (Math.abs(x) < CLEAR_SPAWN_HALF_X && Math.abs(z) > CLEAR_SPAWN_Z * 0.55) return true
  if (Math.abs(x) < 28 && Math.abs(z) < CLEAR_SPAWN_Z) return true
  return false
}

/** Rocks stay off roads / clearings / spawn lanes (same keep-outs as trees). */
function blockedForRock(x: number, z: number): boolean {
  return blockedForTree(x, z)
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
  contacts: ContactSpot[],
): Promise<number> {
  const gltf = await loadGltfCached(PINE_URL)
  const src = gltf.scene
  const unitHeight = uprightAndPlant(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Pine bake produced 0 parts')
    return 0
  }

  const rand = mulberry32(0xf02e57)
  const halfX = FOREST_OVERWATCH_WIDTH * 0.46
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.46
  const placements: Array<{ x: number; z: number; yaw: number; height: number }> =
    []
  let attempts = 0
  const maxAttempts = TREE_COUNT * 10
  while (placements.length < TREE_COUNT && attempts < maxAttempts) {
    attempts++
    const x = (rand() - 0.5) * 2 * halfX
    const z = (rand() - 0.5) * 2 * halfZ
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
      _dummy.position.set(pl.x, forestHeightAt(pl.x, pl.z), pl.z)
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
    contacts.push({
      x: pl.x,
      z: pl.z,
      radius: Math.max(1.8, shape.radius * 1.35),
    })
  }

  console.info(
    `[Steel] Forest pines — ${count} instances, ${parts.length} merged draw calls (was ~${count * 160} meshes)`,
  )
  return count
}

type RockTemplate = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  unitHeight: number
}

/**
 * Pull the largest Plain_Rock meshes from the stylised pack, upright them,
 * and bake world-space geometry for InstancedMesh (cliff-scale cover).
 */
function bakeRockTemplates(src: THREE.Object3D): RockTemplate[] {
  const candidates: Array<{ mesh: THREE.Mesh; vol: number }> = []
  src.updateMatrixWorld(true)
  src.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    const name = obj.name || ''
    if (!/Plain_Rock/i.test(name)) return
    if (Array.isArray(obj.material)) return
    obj.geometry.computeBoundingBox()
    const bb = obj.geometry.boundingBox
    if (!bb) return
    const sx = bb.max.x - bb.min.x
    const sy = bb.max.y - bb.min.y
    const sz = bb.max.z - bb.min.z
    candidates.push({ mesh: obj, vol: sx * sy * sz })
  })
  candidates.sort((a, b) => b.vol - a.vol)

  const picked = candidates.slice(0, ROCK_TEMPLATE_COUNT)
  const templates: RockTemplate[] = []
  for (const { mesh } of picked) {
    const holder = new THREE.Group()
    const clone = mesh.clone(false)
    clone.material = mesh.material
    // Detach from pack layout offsets — plant from local geometry alone
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    clone.scale.set(1, 1, 1)
    clone.updateMatrix()
    holder.add(clone)

    // glTF rocks are Y-up; only tip if clearly Z-up (unlike pines, width > height is normal)
    holder.position.set(0, 0, 0)
    holder.rotation.set(0, 0, 0)
    holder.scale.setScalar(1)
    holder.updateMatrixWorld(true)
    _box.setFromObject(holder)
    _box.getSize(_size)
    if (_size.z > _size.y * 1.4 && _size.z >= _size.x) {
      holder.rotation.x = -Math.PI / 2
      holder.updateMatrixWorld(true)
      _box.setFromObject(holder)
    }
    holder.position.y = -_box.min.y
    holder.updateMatrixWorld(true)
    _box.setFromObject(holder)
    const unitHeight = Math.max(_box.max.y - _box.min.y, 0.001)

    const g = clone.geometry.clone()
    g.applyMatrix4(clone.matrixWorld)
    g.computeBoundingSphere()

    const srcMat = Array.isArray(clone.material) ? clone.material[0]! : clone.material
    const mat = srcMat.clone()
    if ('metalness' in mat && typeof mat.metalness === 'number') mat.metalness = 0
    if ('roughness' in mat && typeof mat.roughness === 'number') {
      mat.roughness = Math.max(0.9, mat.roughness)
    }
    templates.push({ geometry: g, material: mat, unitHeight })
  }
  return templates
}

/**
 * Scatter small cliff piles from the stylised rock pack (instanced).
 * Prefers hill slopes; keeps roads / clearings / spawn lanes clear.
 */
async function placeCliffRocks(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const gltf = await loadGltfCached(ROCKS_URL)
  const templates = bakeRockTemplates(gltf.scene)
  if (templates.length === 0) {
    console.warn('[Steel] Rock bake produced 0 templates')
    return 0
  }

  const rand = mulberry32(0xc11ff70)
  const halfX = FOREST_OVERWATCH_WIDTH * 0.46
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.46

  type RockPlace = {
    x: number
    z: number
    yaw: number
    height: number
    template: number
    cliff: boolean
  }
  const placements: RockPlace[] = []

  // Seed ~18 cliff cluster centers, then fill with satellite rocks
  const clusters: Array<{ x: number; z: number }> = []
  let attempts = 0
  while (clusters.length < 18 && attempts < 400) {
    attempts++
    const x = (rand() - 0.5) * 2 * halfX
    const z = (rand() - 0.5) * 2 * halfZ
    if (blockedForRock(x, z)) continue
    // Prefer higher relief (hill flanks read as cliff bases)
    if (rawRelief(x, z) < 3.5 && rand() > 0.35) continue
    let ok = true
    for (const c of clusters) {
      if (Math.hypot(x - c.x, z - c.z) < 55) {
        ok = false
        break
      }
    }
    if (!ok) continue
    clusters.push({ x, z })
  }

  for (const c of clusters) {
    const pileN = 2 + Math.floor(rand() * 3) // 2–4 rocks per pile
    for (let i = 0; i < pileN; i++) {
      const ang = rand() * Math.PI * 2
      const dist = i === 0 ? rand() * 2.5 : 3 + rand() * 7
      const x = c.x + Math.cos(ang) * dist
      const z = c.z + Math.sin(ang) * dist
      if (blockedForRock(x, z)) continue
      const cliff = i === 0 || rand() > 0.55
      placements.push({
        x,
        z,
        yaw: rand() * Math.PI * 2,
        height: cliff ? 5.5 + rand() * 4.5 : 2.8 + rand() * 2.8,
        template: Math.floor(rand() * templates.length),
        cliff,
      })
    }
  }

  // Fill remaining budget with lone mid/small rocks (plains + hills)
  attempts = 0
  while (placements.length < ROCK_COUNT && attempts < ROCK_COUNT * 16) {
    attempts++
    const x = (rand() - 0.5) * 2 * halfX
    const z = (rand() - 0.5) * 2 * halfZ
    if (blockedForRock(x, z)) continue
    // V4a: allow flatter plains so chase view isn’t empty between roads
    const relief = rawRelief(x, z)
    if (relief < 1.0 && rand() > 0.7) continue
    let ok = true
    for (const p of placements) {
      if (Math.hypot(x - p.x, z - p.z) < 11) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const small = relief < 2.5 && rand() > 0.4
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: small ? 1.1 + rand() * 1.6 : 2.4 + rand() * 3.2,
      template: Math.floor(rand() * templates.length),
      cliff: false,
    })
  }

  // One InstancedMesh per template
  const byTemplate: RockPlace[][] = templates.map(() => [])
  for (const pl of placements) {
    byTemplate[pl.template]!.push(pl)
  }

  for (let t = 0; t < templates.length; t++) {
    const list = byTemplate[t]!
    if (list.length === 0) continue
    const { geometry, material, unitHeight } = templates[t]!
    const mesh = new THREE.InstancedMesh(geometry, material, list.length)
    mesh.name = `forestRockInstanced_${t}`
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = true
    mesh.matrixAutoUpdate = false

    for (let i = 0; i < list.length; i++) {
      const pl = list[i]!
      const s = pl.height / unitHeight
      _dummy.position.set(pl.x, forestHeightAt(pl.x, pl.z), pl.z)
      _dummy.rotation.set(0, pl.yaw, 0)
      // Slight non-uniform scale so piles don't look stamped
      const sx = s * (0.9 + rand() * 0.25)
      const sy = s
      const sz = s * (0.9 + rand() * 0.25)
      _dummy.scale.set(sx, sy, sz)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    root.add(mesh)
  }

  for (const pl of placements) {
    const kind = pl.cliff || pl.height >= 5.5 ? 'cliff' : 'rock'
    const shape = estimatePropCollider(kind, pl.height)
    colliders.push({
      x: pl.x,
      z: pl.z,
      radius: shape.radius,
      maxY: shape.maxY,
    })
    contacts.push({
      x: pl.x,
      z: pl.z,
      radius: Math.max(2.0, Math.min(5.5, shape.radius * 1.25)),
    })
  }

  console.info(
    `[Steel] Forest rocks — ${placements.length} instances, ${templates.length} templates, ${clusters.length} cliff piles`,
  )
  return placements.length
}

/** Continuous asphalt ribbon along a densified path (smooth curves, no tile seams). */
function makeRoadRibbon(
  pts: readonly RoadPt[],
  width: number,
  mat: THREE.Material,
  name: string,
  opts?: { y?: number; lateral?: number },
): THREE.Mesh | null {
  if (pts.length < 2) return null
  const half = width * 0.5
  const y0 = opts?.y ?? ROAD_Y
  const lateral = opts?.lateral ?? 0
  const n = pts.length
  const positions = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const indices: number[] = []
  let dist = 0

  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(n - 1, i + 1)]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    // Left normal in XZ
    const nx = -tz
    const nz = tx
    const cx = nx * lateral
    const cz = nz * lateral
    const lx = nx * half
    const lz = nz * half
    if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z)

    const iL = i * 2
    const iR = i * 2 + 1
    positions[iL * 3] = p.x + cx + lx
    positions[iL * 3 + 1] = y0
    positions[iL * 3 + 2] = p.z + cz + lz
    positions[iR * 3] = p.x + cx - lx
    positions[iR * 3 + 1] = y0
    positions[iR * 3 + 2] = p.z + cz - lz

    // ~1 tile across width, ~1 tile per 16 m along path
    const v = dist / 16
    uvs[iL * 2] = 0
    uvs[iL * 2 + 1] = v
    uvs[iR * 2] = 1
    uvs[iR * 2 + 1] = v

    if (i < n - 1) {
      const a = iL
      const b = iR
      const c = (i + 1) * 2
      const d = (i + 1) * 2 + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = name
  mesh.receiveShadow = true
  mesh.castShadow = false
  return mesh
}

/** Procedural asphalt — modular road GLB atlas was collage/glitch on ribbons. */
function loadRoadAsphaltMaterial(): THREE.MeshStandardMaterial {
  const map = createAsphaltTexture(1, 1)
  map.anisotropy = 8
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xc8c8c8,
    roughness: 0.94,
    metalness: 0.04,
    envMapIntensity: 0,
    side: THREE.DoubleSide,
  })
}

function loadRoadSkirtMaterial(): THREE.MeshStandardMaterial {
  const map = createGravelShoulderTexture(1, 1)
  map.anisotropy = 4
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xb8a890,
    roughness: 0.97,
    metalness: 0.02,
    envMapIntensity: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

function loadRoadRutMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2a241c,
    roughness: 0.98,
    metalness: 0.02,
    envMapIntensity: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

/**
 * Smooth curved road ribbons (Catmull-Rom densified). Climbable — no colliders.
 * V5: gravel skirts under asphalt + dual tire ruts.
 */
async function placeRoads(root: THREE.Group): Promise<{
  tileCount: number
  paths: Array<{ points: Array<{ x: number; z: number }> }>
}> {
  const mat = loadRoadAsphaltMaterial()
  const skirtMat = loadRoadSkirtMaterial()
  const rutMat = loadRoadRutMaterial()
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
  })

  const roads = new THREE.Group()
  roads.name = 'ForestRoads'
  root.add(roads)

  let ribbonCount = 0
  let skirtCount = 0
  let rutCount = 0
  for (let i = 0; i < ROAD_POLYLINES.length; i++) {
    const line = ROAD_POLYLINES[i]!

    // V5a — gravel/dirt skirt under asphalt (wider, slightly lower)
    const skirt = makeRoadRibbon(line, ROAD_SKIRT_WIDTH, skirtMat, `roadSkirt_${i}`, {
      y: ROAD_Y - 0.025,
    })
    if (skirt) {
      roads.add(skirt)
      skirtCount++
    }

    const ribbon = makeRoadRibbon(line, ROAD_WIDTH, mat, `roadRibbon_${i}`)
    if (ribbon) {
      roads.add(ribbon)
      ribbonCount++
    }

    // Narrow darker center stripe
    const stripe = makeRoadRibbon(line, ROAD_WIDTH * 0.08, edgeMat, `roadStripe_${i}`, {
      y: ROAD_Y + 0.01,
    })
    if (stripe) {
      roads.add(stripe)
    }

    // V5b — soft dual tire ruts (no z-fight vs asphalt via slight lift + polygonOffset)
    const rutL = makeRoadRibbon(line, ROAD_RUT_WIDTH, rutMat, `roadRutL_${i}`, {
      y: ROAD_Y + 0.014,
      lateral: -ROAD_RUT_HALF,
    })
    const rutR = makeRoadRibbon(line, ROAD_RUT_WIDTH, rutMat, `roadRutR_${i}`, {
      y: ROAD_Y + 0.014,
      lateral: ROAD_RUT_HALF,
    })
    if (rutL) {
      roads.add(rutL)
      rutCount++
    }
    if (rutR) {
      roads.add(rutR)
      rutCount++
    }
  }

  roads.updateMatrixWorld(true)
  _box.setFromObject(roads)
  console.info(
    `[Steel] Forest roads — ${ribbonCount} asphalt · ${skirtCount} skirts · ${rutCount} ruts · width ${ROAD_WIDTH}m · V5 · bbox ` +
      `x[${_box.min.x.toFixed(0)}…${_box.max.x.toFixed(0)}] z[${_box.min.z.toFixed(0)}…${_box.max.z.toFixed(0)}]`,
  )

  // Minimap: subsample densified paths
  const paths = ROAD_POLYLINES.map((line) => ({
    points: line.filter((_, idx) => idx % 4 === 0 || idx === line.length - 1).map((p) => ({
      x: p.x,
      z: p.z,
    })),
  }))

  return { tileCount: ribbonCount, paths }
}

/** Normalize a ruin piece: upright, plant Y=0, return height. */
function prepareRuinPiece(src: THREE.Object3D): { root: THREE.Group; height: number; hx: number; hz: number } {
  const root = new THREE.Group()
  root.add(src.clone(true))
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.setScalar(1)
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  _box.getSize(_size)

  // Some Sketchfab ruins are Z-up
  if (_size.z >= _size.y && _size.z >= _size.x * 0.85) {
    root.rotation.x = -Math.PI / 2
    root.updateMatrixWorld(true)
    _box.setFromObject(root)
    _box.getSize(_size)
  }

  root.position.y = -_box.min.y
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  _box.getSize(_size)
  const height = Math.max(_box.max.y - _box.min.y, 0.5)
  const hx = Math.max((_box.max.x - _box.min.x) * 0.45, 1.2)
  const hz = Math.max((_box.max.z - _box.min.z) * 0.45, 1.2)
  return { root, height, hx, hz }
}

function plantRuin(
  piece: { root: THREE.Group; height: number; hx: number; hz: number },
  parent: THREE.Group,
  colliders: PropCollider[],
  x: number,
  z: number,
  yaw: number,
  targetHeight: number,
): void {
  const s = targetHeight / piece.height
  const clone = piece.root.clone(true)
  clone.position.set(x, forestHeightAt(x, z), z)
  clone.rotation.y = yaw
  clone.scale.setScalar(s)
  clone.updateMatrixWorld(true)
  parent.add(clone)
  colliders.push({
    x,
    z,
    yaw,
    hx: piece.hx * s,
    hz: piece.hz * s,
    radius: Math.hypot(piece.hx * s, piece.hz * s),
    maxY: targetHeight * 0.95,
  })
}

/** Only skip if sitting on asphalt — towns sit *beside* the road. */
function onAsphalt(x: number, z: number): boolean {
  return distToRoads(x, z) < ROAD_WIDTH * 0.55 + 3
}

type PropSpot = { x: number; z: number; yaw: number; h: number }

function townRing(
  town: ForestTown,
  count: number,
  radius: number,
  h: number,
  yaw0: number,
): PropSpot[] {
  const spots: PropSpot[] = []
  for (let i = 0; i < count; i++) {
    const a = yaw0 + (i / count) * Math.PI * 2
    spots.push({
      x: town.x + Math.cos(a) * radius,
      z: town.z + Math.sin(a) * radius,
      yaw: a + Math.PI * 0.5,
      h: h + (i % 3) * 0.4,
    })
  }
  return spots
}

function houseSpots(): PropSpot[] {
  const south = FOREST_TOWNS.find((t) => t.id === 'south')!
  const mid = FOREST_TOWNS.find((t) => t.id === 'mid')!
  const north = FOREST_TOWNS.find((t) => t.id === 'north')!
  return [
    ...townRing(south, 6, 36, 13, 0.2),
    ...townRing(south, 4, 58, 12.5, 0.9),
    ...townRing(mid, 6, 42, 13.5, 0.4),
    ...townRing(mid, 4, 68, 13, 1.1),
    ...townRing(north, 6, 36, 13, 0.15),
    ...townRing(north, 4, 58, 12.5, 0.85),
  ]
}

/**
 * Town buildings — mix of ruin / brick / low-poly house / worn shed.
 */
async function placeTownHouses(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const group = new THREE.Group()
  group.name = 'TownHouses'
  root.add(group)

  type HouseTpl = {
    piece: ReturnType<typeof prepareRuinPiece>
    label: string
    h: number
  }
  const templates: HouseTpl[] = []
  const loads: Array<{ url: string; label: string; h: number }> = [
    { url: RUIN_HOUSE_URL, label: 'ruin', h: 13 },
    { url: WORN_SHED_URL, label: 'shed', h: 4.6 },
  ]
  for (const L of loads) {
    try {
      const gltf = await loadGltfCached(L.url)
      templates.push({
        piece: prepareRuinPiece(gltf.scene),
        label: L.label,
        h: L.h,
      })
    } catch (err) {
      console.warn(`[Steel] House load failed (${L.label})`, err)
    }
  }
  if (templates.length === 0) {
    console.warn('[Steel] Town houses — no templates loaded')
    return 0
  }

  let count = 0
  const spots = houseSpots()
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i]!
    if (onAsphalt(spot.x, spot.z)) continue
    const pick = templates[i % templates.length]!
    // Sheds stay short; houses use ring height scaled to template.
    const targetH =
      pick.label === 'shed'
        ? pick.h + (i % 3) * 0.2
        : spot.h * (pick.h / 13)
    plantRuin(pick.piece, group, colliders, spot.x, spot.z, spot.yaw, targetH)
    contacts.push({
      x: spot.x,
      z: spot.z,
      radius: Math.max(
        pick.label === 'shed' ? 3.2 : 4.5,
        pick.piece.hx * (targetH / pick.piece.height) * 1.05 + 1.0,
      ),
    })
    count++
  }

  console.info(
    `[Steel] Town houses — ${count} · templates ${templates.map((t) => t.label).join('+')}`,
  )
  return count
}

/**
 * Sample road-shoulder spots for wrecks (off asphalt, capped).
 */
function roadShoulderSpots(
  count: number,
  offsetM: number,
  h: number,
  seed: number,
): PropSpot[] {
  const rand = mulberry32(seed)
  const spots: PropSpot[] = []
  const lines = ROAD_POLYLINES
  if (lines.length === 0) return spots
  const perLine = Math.max(1, Math.ceil(count / lines.length))
  for (const line of lines) {
    if (line.length < 3) continue
    const step = Math.max(1, Math.floor(line.length / (perLine + 1)))
    for (let i = step; i < line.length - 1 && spots.length < count; i += step) {
      const a = line[i]!
      const b = line[Math.min(i + 1, line.length - 1)]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz) || 1
      const px = -dz / len
      const pz = dx / len
      const sign = spots.length % 2 === 0 ? 1 : -1
      const off = offsetM * (0.85 + rand() * 0.35) * sign
      const x = a.x + px * off
      const z = a.z + pz * off
      if (onAsphalt(x, z)) continue
      if (Math.abs(x) > FOREST_OVERWATCH_WIDTH * 0.46) continue
      if (Math.abs(z) > FOREST_OVERWATCH_DEPTH * 0.46) continue
      // Skip deep town centers — keep edges / shoulders
      let deepTown = false
      for (const town of FOREST_TOWNS) {
        if (Math.hypot(x - town.x, z - town.z) < town.radius * 0.45) {
          deepTown = true
          break
        }
      }
      if (deepTown) continue
      spots.push({
        x,
        z,
        yaw: Math.atan2(dx, dz) + (rand() - 0.5) * 0.9,
        h: h * (0.92 + rand() * 0.16),
      })
    }
  }
  return spots
}

/**
 * Wreck scatter on shoulders + town edges (fancy + destroyed, capped).
 */
async function placeAbandonedCars(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const group = new THREE.Group()
  group.name = 'FancyWrecks'
  root.add(group)

  type WreckPiece = { piece: ReturnType<typeof prepareRuinPiece>; h: number }
  const pieces: WreckPiece[] = []
  try {
    const fancy = await loadGltfCached(FANCY_CAR_URL)
    pieces.push({ piece: prepareRuinPiece(fancy.scene), h: 2.5 })
  } catch (err) {
    console.warn(`[Steel] Fancy car load failed`, err)
  }
  try {
    const wreck = await loadGltfCached(DESTROYED_CAR_URL)
    pieces.push({ piece: prepareRuinPiece(wreck.scene), h: 2.35 })
  } catch (err) {
    console.warn(`[Steel] Destroyed car load failed`, err)
  }
  if (pieces.length === 0) return 0

  const spots: PropSpot[] = [
    { x: 55, z: 35, yaw: -1.2, h: 2.5 },
    { x: -48, z: 508, yaw: 1.4, h: 2.6 },
    { x: 38, z: -508, yaw: 0.6, h: 2.4 },
    { x: -70, z: -40, yaw: 2.1, h: 2.45 },
    { x: 82, z: 480, yaw: -0.7, h: 2.4 },
    ...roadShoulderSpots(10, 17, 2.45, 0xc4a5),
  ]

  let count = 0
  for (let i = 0; i < spots.length && count < WRECK_CAP; i++) {
    const spot = spots[i]!
    if (Math.abs(spot.x) > FOREST_OVERWATCH_WIDTH * 0.46) continue
    if (Math.abs(spot.z) > FOREST_OVERWATCH_DEPTH * 0.46) continue
    if (onAsphalt(spot.x, spot.z)) continue
    const pick = pieces[i % pieces.length]!
    plantRuin(pick.piece, group, colliders, spot.x, spot.z, spot.yaw, pick.h)
    contacts.push({ x: spot.x, z: spot.z, radius: 3.6 })
    count++
  }

  console.info(`[Steel] Fancy wrecks — ${count}/${WRECK_CAP} · ${pieces.length} templates · V4b`)
  return count
}

function applyForestFloorMaterial(mat: THREE.MeshStandardMaterial): void {
  const floor = createPineForestFloorMaps(
    Math.max(48, FOREST_OVERWATCH_WIDTH / 8),
    Math.max(64, FOREST_OVERWATCH_DEPTH / 12),
  )
  if (mat.map && mat.map !== floor.map) mat.map.dispose()
  if (mat.normalMap && mat.normalMap !== floor.normalMap) mat.normalMap.dispose()
  if (mat.roughnessMap && mat.roughnessMap !== floor.roughnessMap) {
    mat.roughnessMap.dispose()
  }
  mat.map = floor.map
  mat.normalMap = floor.normalMap
  mat.normalScale = new THREE.Vector2(0.78, 0.78)
  mat.roughnessMap = floor.roughnessMap
  // Vertex colors multiply this — keep near white so world tint reads.
  mat.color.setHex(0xffffff)
  mat.vertexColors = true
  mat.roughness = 1
  mat.metalness = 0
  mat.envMapIntensity = 0.4
  mat.needsUpdate = true
}

/** Displaced grass mesh + height sampler (clearings stay flat). */
function buildForestTerrain(root: THREE.Group): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(
    FOREST_OVERWATCH_WIDTH,
    FOREST_OVERWATCH_DEPTH,
    TERRAIN_SEG_X,
    TERRAIN_SEG_Z,
  )
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const tint = new THREE.Color()
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = forestHeightAt(x, z)
    pos.setY(i, y)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    sampleForestGroundTint(x, z, tint)
    const wear = sampleWearMul(x, z)
    colors[i * 3] = tint.r * wear
    colors[i * 3 + 1] = tint.g * wear
    colors[i * 3 + 2] = tint.b * wear
  }
  pos.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  })
  applyForestFloorMaterial(mat)

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'forestTerrain'
  mesh.receiveShadow = true
  mesh.castShadow = false
  root.add(mesh)

  console.info(
    `[Steel] Forest terrain — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH} · ${TERRAIN_SEG_X}×${TERRAIN_SEG_Z} · y[${minY.toFixed(2)}…${maxY.toFixed(2)}] · V1 floor+vertexTint · V3b road/town wear · clearings ${FOREST_TOWNS.map((t) => t.name).join(', ')}`,
  )
  return mesh
}

/**
 * Forest Overwatch — rolling grass, 3 flat clearings, modular roads, pines.
 */
export async function loadForestOverwatch(
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<ForestMapLoadResult> {
  void preloadUrls(FOREST_PROP_URLS)
  // Heightfield replaces the shared flat ground plane
  ground.visible = false

  const root = new THREE.Group()
  root.name = 'ForestOverwatch'
  scene.add(root)

  buildForestTerrain(root)

  const colliders: PropCollider[] = []
  const contacts: ContactSpot[] = []
  let paths: ForestMapLoadResult['paths']
  let roadTiles = 0
  try {
    const roads = await placeRoads(root)
    roadTiles = roads.tileCount
    paths = roads.paths
  } catch (err) {
    console.warn('[Steel] Forest roads failed to load', err)
  }

  const [treeCount, rockCount, ruinCount, carCount] =
    await Promise.all([
      placePineTrees(root, colliders, contacts).catch((err) => {
        console.warn('[Steel] Forest pine trees failed to load', err)
        return 0
      }),
      placeCliffRocks(root, colliders, contacts).catch((err) => {
        console.warn('[Steel] Forest cliff rocks failed to load', err)
        return 0
      }),
      placeTownHouses(root, colliders, contacts).catch((err) => {
        console.warn('[Steel] Town houses failed', err)
        return 0
      }),
      placeAbandonedCars(root, colliders, contacts).catch((err) => {
        console.warn('[Steel] Fancy wrecks failed', err)
        return 0
      }),
    ])

  const blobCount = placeContactBlobs(root, contacts)

  console.info(
    `[Steel] Forest Overwatch — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH}m, ${roadTiles} road tiles, ${treeCount} pines, ${rockCount} rocks, ${ruinCount} houses, ${carCount} wrecks, ${blobCount} contact blobs, ${FOREST_TOWNS.length} clearings, ${colliders.length} colliders · no sandbag pack`,
  )
  return {
    root,
    colliders,
    groundY: 0,
    heightAt: forestHeightAt,
    paths,
  }
}
