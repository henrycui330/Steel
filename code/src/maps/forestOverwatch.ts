import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { estimatePropCollider, type PropCollider } from '../collision'
import { createAsphaltTexture, createPineForestFloorTexture } from '../textures'

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
  { x: 220, z: 380, h: 14, r: 110 },
  { x: -210, z: -420, h: 16, r: 120 },
  { x: 180, z: -700, h: 11, r: 95 },
  { x: -230, z: 680, h: 13, r: 100 },
  { x: 120, z: 820, h: 9, r: 80 },
  { x: -140, z: -860, h: 10, r: 88 },
  { x: 280, z: -160, h: 12, r: 100 },
  { x: -270, z: 120, h: 9.5, r: 85 },
  { x: 70, z: -300, h: 7, r: 55 },
  { x: -90, z: 280, h: 8, r: 60 },
  { x: 150, z: 160, h: 6.5, r: 50 },
  { x: -160, z: -180, h: 7.5, r: 58 },
]

export type ForestMapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
  groundY: number
  heightAt?: (x: number, z: number) => number
  paths?: Array<{ points: Array<{ x: number; z: number }> }>
}

const PINE_URL = '/maps/props/pine_tree.glb'
const RUIN_HOUSE_URL = '/maps/props/ruined_house_low_poly.glb'
const EMPTY_INTERIOR_URL = '/maps/props/empty_building_interior.glb'
const CITY_RUIN_URL = '/maps/props/ruined_city_building.glb'
const CRATES_URL = '/maps/props/crates_and_barrels.glb'
const RUBBLE_URL = '/maps/props/construction_rubble.glb'
const FANCY_CAR_URL = '/maps/props/fancy_cardestroyed.glb'
/** Kept low — pines are heavy; instances share 1–2 merged meshes. */
const TREE_COUNT = 72
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
  // Stronger multi-scale bumps (meters)
  let h =
    Math.sin(x * 0.009) * Math.cos(z * 0.0085) * 4.2 +
    Math.sin(x * 0.019 + 1.1) * Math.cos(z * 0.017 - 0.5) * 3.1 +
    Math.sin(x * 0.038 + z * 0.015) * Math.cos(z * 0.034) * 1.8 +
    Math.sin(x * 0.072) * Math.sin(z * 0.068 + 2.2) * 1.15 +
    Math.sin(x * 0.13 + 0.7) * Math.cos(z * 0.11) * 0.55

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
  }

  console.info(
    `[Steel] Forest pines — ${count} instances, ${parts.length} merged draw calls (was ~${count * 160} meshes)`,
  )
  return count
}

/** Continuous asphalt ribbon along a densified path (smooth curves, no tile seams). */
function makeRoadRibbon(
  pts: readonly RoadPt[],
  width: number,
  mat: THREE.Material,
  name: string,
): THREE.Mesh | null {
  if (pts.length < 2) return null
  const half = width * 0.5
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
    const lx = -tz * half
    const lz = tx * half
    if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z)

    const iL = i * 2
    const iR = i * 2 + 1
    positions[iL * 3] = p.x + lx
    positions[iL * 3 + 1] = ROAD_Y
    positions[iL * 3 + 2] = p.z + lz
    positions[iR * 3] = p.x - lx
    positions[iR * 3 + 1] = ROAD_Y
    positions[iR * 3 + 2] = p.z - lz

    // ~1 tile across width, ~1 tile per 16 m along path (procedural asphalt)
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

/**
 * Smooth curved road ribbons (Catmull-Rom densified). Climbable — no colliders.
 */
async function placeRoads(root: THREE.Group): Promise<{
  tileCount: number
  paths: Array<{ points: Array<{ x: number; z: number }> }>
}> {
  const mat = loadRoadAsphaltMaterial()
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
  for (let i = 0; i < ROAD_POLYLINES.length; i++) {
    const line = ROAD_POLYLINES[i]!
    const ribbon = makeRoadRibbon(line, ROAD_WIDTH, mat, `roadRibbon_${i}`)
    if (ribbon) {
      roads.add(ribbon)
      ribbonCount++
    }
    // Narrow darker center stripe
    const stripe = makeRoadRibbon(line, ROAD_WIDTH * 0.08, edgeMat, `roadStripe_${i}`)
    if (stripe) {
      stripe.position.y = 0.01
      roads.add(stripe)
    }
  }

  roads.updateMatrixWorld(true)
  _box.setFromObject(roads)
  console.info(
    `[Steel] Forest roads — ${ribbonCount} curved ribbons · width ${ROAD_WIDTH}m · bbox ` +
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
 * Ruined houses in all three clearings (Midwood densest).
 */
async function placeTownHouses(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const group = new THREE.Group()
  group.name = 'TownHouses'
  root.add(group)

  let count = 0
  try {
    const houseGltf = await loader.loadAsync(RUIN_HOUSE_URL)
    const house = prepareRuinPiece(houseGltf.scene)
    for (const spot of houseSpots()) {
      if (onAsphalt(spot.x, spot.z)) continue
      plantRuin(house, group, colliders, spot.x, spot.z, spot.yaw, spot.h)
      count++
    }
  } catch (err) {
    console.warn('[Steel] Ruined house failed', err)
  }

  console.info(`[Steel] Town houses — ${count} ruins (South + Midwood + North)`)
  return count
}

/**
 * Larger shells: empty interior + ruined city building (Midwood gets the most).
 */
async function placeLargeBuildings(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const group = new THREE.Group()
  group.name = 'LargeBuildings'
  root.add(group)

  const south = FOREST_TOWNS.find((t) => t.id === 'south')!
  const mid = FOREST_TOWNS.find((t) => t.id === 'mid')!
  const north = FOREST_TOWNS.find((t) => t.id === 'north')!

  let count = 0

  const plantSpots = async (url: string, spots: PropSpot[], label: string) => {
    try {
      const gltf = await loader.loadAsync(url)
      const piece = prepareRuinPiece(gltf.scene)
      let n = 0
      for (const spot of spots) {
        if (onAsphalt(spot.x, spot.z)) continue
        plantRuin(piece, group, colliders, spot.x, spot.z, spot.yaw, spot.h)
        n++
      }
      console.info(`[Steel] ${label} — ${n}`)
      count += n
    } catch (err) {
      console.warn(`[Steel] ${label} failed`, err)
    }
  }

  await plantSpots(
    EMPTY_INTERIOR_URL,
    [
      ...townRing(south, 2, 48, 15, 0.0),
      ...townRing(mid, 2, 55, 16, 0.6),
      ...townRing(north, 2, 48, 15, 0.3),
    ],
    'Empty interiors',
  )

  await plantSpots(
    CITY_RUIN_URL,
    [
      ...townRing(south, 2, 70, 18, 1.1),
      ...townRing(mid, 2, 82, 19, 1.7),
      ...townRing(north, 2, 70, 18, 1.4),
    ],
    'City ruins',
  )

  return count
}

/**
 * Construction rubble piles at clearing edges (cover, not on roads).
 */
async function placeRubblePiles(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const group = new THREE.Group()
  group.name = 'TownRubble'
  root.add(group)

  const south = FOREST_TOWNS.find((t) => t.id === 'south')!
  const mid = FOREST_TOWNS.find((t) => t.id === 'mid')!
  const north = FOREST_TOWNS.find((t) => t.id === 'north')!
  const spots: PropSpot[] = [
    { x: south.x - 50, z: south.z + 22, yaw: 0.8, h: 4.2 },
    { x: south.x + 44, z: south.z - 36, yaw: -1.4, h: 3.8 },
    { x: south.x - 28, z: south.z + 58, yaw: 2.4, h: 4.0 },
    { x: mid.x + 78, z: mid.z - 48, yaw: 0.3, h: 5.0 },
    { x: mid.x - 82, z: mid.z + 40, yaw: 2.1, h: 4.6 },
    { x: mid.x + 28, z: mid.z - 78, yaw: -0.6, h: 4.0 },
    { x: north.x + 48, z: north.z + 18, yaw: 1.1, h: 4.4 },
    { x: north.x - 52, z: north.z - 24, yaw: -2.0, h: 3.9 },
    { x: north.x + 18, z: north.z + 62, yaw: -0.4, h: 4.1 },
  ]

  let count = 0
  try {
    const gltf = await loader.loadAsync(RUBBLE_URL)
    const pile = prepareRuinPiece(gltf.scene)
    for (const spot of spots) {
      if (onAsphalt(spot.x, spot.z)) continue
      plantRuin(pile, group, colliders, spot.x, spot.z, spot.yaw, spot.h)
      count++
    }
  } catch (err) {
    console.warn('[Steel] Construction rubble failed', err)
  }

  console.info(`[Steel] Rubble piles — ${count}`)
  return count
}

/**
 * Crate / barrel dumps next to houses (supply purpose).
 */
async function placeSupplyDumps(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const group = new THREE.Group()
  group.name = 'SupplyDumps'
  root.add(group)

  const spots: PropSpot[] = [
    { x: 20, z: -500, yaw: 0.4, h: 2.4 },
    { x: -12, z: 24, yaw: -0.7, h: 2.6 },
    { x: 40, z: -22, yaw: 1.15, h: 2.5 },
    { x: -30, z: 536, yaw: 2.0, h: 2.4 },
    { x: -46, z: 6, yaw: 0.25, h: 2.5 },
    { x: 24, z: -546, yaw: -1.4, h: 2.3 },
    { x: 8, z: 548, yaw: 0.9, h: 2.4 },
    { x: -38, z: -532, yaw: 1.6, h: 2.4 },
    { x: 28, z: 500, yaw: -1.1, h: 2.5 },
  ]

  let count = 0
  try {
    const gltf = await loader.loadAsync(CRATES_URL)
    const dump = prepareRuinPiece(gltf.scene)
    for (const spot of spots) {
      if (onAsphalt(spot.x, spot.z)) continue
      plantRuin(dump, group, colliders, spot.x, spot.z, spot.yaw, spot.h)
      count++
    }
  } catch (err) {
    console.warn('[Steel] Crates pack failed', err)
  }

  console.info(`[Steel] Supply dumps — ${count} crate/barrel clusters`)
  return count
}

/**
 * Fancy wrecks only — a few on shoulders + town edges.
 */
async function placeAbandonedCars(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const group = new THREE.Group()
  group.name = 'FancyWrecks'
  root.add(group)

  let piece: ReturnType<typeof prepareRuinPiece>
  try {
    const gltf = await loader.loadAsync(FANCY_CAR_URL)
    piece = prepareRuinPiece(gltf.scene)
  } catch (err) {
    console.warn(`[Steel] Fancy car load failed`, err)
    return 0
  }

  const spots: PropSpot[] = [
    { x: 55, z: 35, yaw: -1.2, h: 2.5 },
    { x: -48, z: 508, yaw: 1.4, h: 2.6 },
    { x: 38, z: -508, yaw: 0.6, h: 2.4 },
  ]

  const main = ROAD_POLYLINES[0]
  if (main && main.length > 8) {
    const a = main[Math.floor(main.length * 0.28)]!
    const b = main[Math.floor(main.length * 0.28) + 1] ?? a
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    const px = -dz / len
    const pz = dx / len
    spots.push({
      x: a.x + px * 16,
      z: a.z + pz * 16,
      yaw: Math.atan2(dx, dz) + 0.35,
      h: 2.5,
    })
    const c = main[Math.floor(main.length * 0.72)]!
    spots.push({
      x: c.x - px * 16,
      z: c.z - pz * 16,
      yaw: Math.atan2(dx, dz) - 0.5,
      h: 2.45,
    })
  }

  let count = 0
  for (const spot of spots) {
    if (Math.abs(spot.x) > FOREST_OVERWATCH_WIDTH * 0.46) continue
    if (Math.abs(spot.z) > FOREST_OVERWATCH_DEPTH * 0.46) continue
    plantRuin(piece, group, colliders, spot.x, spot.z, spot.yaw, spot.h)
    count++
  }

  console.info(`[Steel] Fancy wrecks — ${count}`)
  return count
}

function applyForestFloorMaterial(mat: THREE.MeshStandardMaterial): void {
  const floor = createPineForestFloorTexture(
    Math.max(48, FOREST_OVERWATCH_WIDTH / 8),
    Math.max(64, FOREST_OVERWATCH_DEPTH / 12),
  )
  if (mat.map && mat.map !== floor) {
    mat.map.dispose()
  }
  mat.map = floor
  // Tint toward pine duff (texture carries most of the look)
  mat.color.setHex(0xc4b89a)
  mat.roughness = 0.98
  mat.metalness = 0.0
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
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = forestHeightAt(x, z)
    pos.setY(i, y)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4b89a,
    roughness: 0.98,
    metalness: 0,
  })
  applyForestFloorMaterial(mat)

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'forestTerrain'
  mesh.receiveShadow = true
  mesh.castShadow = false
  root.add(mesh)

  console.info(
    `[Steel] Forest terrain — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH} · ${TERRAIN_SEG_X}×${TERRAIN_SEG_Z} · y[${minY.toFixed(2)}…${maxY.toFixed(2)}] · clearings ${FOREST_TOWNS.map((t) => t.name).join(', ')}`,
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
  // Heightfield replaces the shared flat ground plane
  ground.visible = false

  const root = new THREE.Group()
  root.name = 'ForestOverwatch'
  scene.add(root)

  buildForestTerrain(root)

  const colliders: PropCollider[] = []
  let paths: ForestMapLoadResult['paths']
  let roadTiles = 0
  try {
    const roads = await placeRoads(root)
    roadTiles = roads.tileCount
    paths = roads.paths
  } catch (err) {
    console.warn('[Steel] Forest roads failed to load', err)
  }

  let treeCount = 0
  try {
    treeCount = await placePineTrees(root, colliders)
  } catch (err) {
    console.warn('[Steel] Forest pine trees failed to load', err)
  }

  let ruinCount = 0
  try {
    ruinCount = await placeTownHouses(root, colliders)
  } catch (err) {
    console.warn('[Steel] Town houses failed', err)
  }

  let largeCount = 0
  try {
    largeCount = await placeLargeBuildings(root, colliders)
  } catch (err) {
    console.warn('[Steel] Large buildings failed', err)
  }

  let rubbleCount = 0
  try {
    rubbleCount = await placeRubblePiles(root, colliders)
  } catch (err) {
    console.warn('[Steel] Rubble failed', err)
  }

  let dumpCount = 0
  try {
    dumpCount = await placeSupplyDumps(root, colliders)
  } catch (err) {
    console.warn('[Steel] Supply dumps failed', err)
  }

  let carCount = 0
  try {
    carCount = await placeAbandonedCars(root, colliders)
  } catch (err) {
    console.warn('[Steel] Fancy wrecks failed', err)
  }

  console.info(
    `[Steel] Forest Overwatch — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH}m, ${roadTiles} road tiles, ${treeCount} pines, ${ruinCount} houses, ${largeCount} large buildings, ${rubbleCount} rubble, ${dumpCount} crates, ${carCount} fancy wrecks, ${FOREST_TOWNS.length} clearings, ${colliders.length} colliders`,
  )
  return {
    root,
    colliders,
    groundY: 0,
    heightAt: forestHeightAt,
    paths,
  }
}
