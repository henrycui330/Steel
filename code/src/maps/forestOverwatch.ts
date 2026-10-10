import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { estimatePropCollider, type PropCollider } from '../collision'
import { assetUrl } from '../assetUrl'
import { loadGltfCached, preloadUrls } from '../loadGltf'
import {
  createCropTuft,
  createDirtPathTexture,
  createGravelShoulderTexture,
  createPineForestFloorMaps,
  sampleForestGroundTint,
  type CropKind,
} from '../textures'

/** 2000 m layout × this = playable size. */
const MAP_SCALE = 2.5

/** Playable arena — width (X) × depth/height (Z). Square so east/west flanks exist. */
export const FOREST_OVERWATCH_WIDTH = 2000 * MAP_SCALE
export const FOREST_OVERWATCH_DEPTH = 2000 * MAP_SCALE
/** Max axis — fog / shadow helpers. */
export const FOREST_OVERWATCH_SIZE = Math.max(
  FOREST_OVERWATCH_WIDTH,
  FOREST_OVERWATCH_DEPTH,
)
/** Legacy AI hint — north side. */
export const FOREST_OVERWATCH_DUMMY = new THREE.Vector3(0, 0, 280 * MAP_SCALE)

export type ForestTown = {
  id: string
  name: string
  x: number
  z: number
  radius: number
}

/**
 * Five pads on the SW→NE attack road.
 * Capture order: south → west → mid → east → north.
 */
export const FOREST_TOWNS: readonly ForestTown[] = [
  { id: 'south', name: 'South Hollow', x: -540 * MAP_SCALE, z: -520 * MAP_SCALE, radius: 160 },
  { id: 'west', name: 'West Mill', x: -300 * MAP_SCALE, z: -260 * MAP_SCALE, radius: 150 },
  { id: 'mid', name: 'Midwood', x: 0, z: 0, radius: 180 },
  { id: 'east', name: 'East Ford', x: 300 * MAP_SCALE, z: 280 * MAP_SCALE, radius: 150 },
  { id: 'north', name: 'North Ridge', x: 540 * MAP_SCALE, z: 520 * MAP_SCALE, radius: 160 },
]

export type ForestCropField = {
  id: string
  kind: CropKind
  x: number
  z: number
  /** Ellipse radii (m) — farm plots in rural flanks. */
  rx: number
  rz: number
}

/**
 * Rural crop pads off the attack road — tall 3D stalks (not floor paint).
 * Cleared of pines so tanks can drive in and sit in cover.
 */
export const FOREST_CROP_FIELDS: readonly ForestCropField[] = [
  { id: 'barley-se', kind: 'barley', x: 420 * MAP_SCALE, z: -480 * MAP_SCALE, rx: 95, rz: 70 },
  { id: 'barley-nw', kind: 'barley', x: -520 * MAP_SCALE, z: 380 * MAP_SCALE, rx: 88, rz: 75 },
  { id: 'barley-sw', kind: 'barley', x: -620 * MAP_SCALE, z: -200 * MAP_SCALE, rx: 78, rz: 62 },
  { id: 'barley-ne', kind: 'barley', x: 580 * MAP_SCALE, z: 160 * MAP_SCALE, rx: 72, rz: 68 },
  { id: 'flower-e', kind: 'flower', x: 280 * MAP_SCALE, z: -700 * MAP_SCALE, rx: 85, rz: 70 },
  { id: 'flower-w', kind: 'flower', x: -240 * MAP_SCALE, z: 720 * MAP_SCALE, rx: 90, rz: 65 },
  { id: 'flower-se', kind: 'flower', x: 700 * MAP_SCALE, z: -120 * MAP_SCALE, rx: 70, rz: 80 },
  { id: 'flower-nw', kind: 'flower', x: -700 * MAP_SCALE, z: 80 * MAP_SCALE, rx: 75, rz: 70 },
]

/**
 * Open-field scrub meadows — pines cleared, bushes dense for open-camo
 * (not crop pads; sit in otherwise open rural ground).
 */
export const FOREST_OPEN_SCRUB: ReadonlyArray<{
  id: string
  x: number
  z: number
  rx: number
  rz: number
}> = [
  { id: 'scrub-mid-e', x: 200 * MAP_SCALE, z: -180 * MAP_SCALE, rx: 170, rz: 140 },
  { id: 'scrub-mid-w', x: -220 * MAP_SCALE, z: 160 * MAP_SCALE, rx: 165, rz: 145 },
  { id: 'scrub-n', x: 40 * MAP_SCALE, z: 480 * MAP_SCALE, rx: 180, rz: 130 },
  { id: 'scrub-s', x: -40 * MAP_SCALE, z: -500 * MAP_SCALE, rx: 175, rz: 135 },
  { id: 'scrub-ne', x: 480 * MAP_SCALE, z: 320 * MAP_SCALE, rx: 150, rz: 120 },
  { id: 'scrub-sw', x: -460 * MAP_SCALE, z: -340 * MAP_SCALE, rx: 155, rz: 125 },
  { id: 'scrub-se', x: 560 * MAP_SCALE, z: -280 * MAP_SCALE, rx: 140, rz: 150 },
  { id: 'scrub-nw', x: -540 * MAP_SCALE, z: 260 * MAP_SCALE, rx: 145, rz: 140 },
  { id: 'scrub-approach', x: 0, z: 160 * MAP_SCALE, rx: 130, rz: 160 },
  { id: 'scrub-flank-e', x: 320 * MAP_SCALE, z: 40 * MAP_SCALE, rx: 125, rz: 170 },
  { id: 'scrub-flank-w', x: -340 * MAP_SCALE, z: -20 * MAP_SCALE, rx: 130, rz: 165 },
  { id: 'scrub-far-ne', x: 700 * MAP_SCALE, z: 520 * MAP_SCALE, rx: 130, rz: 110 },
  { id: 'scrub-far-sw', x: -720 * MAP_SCALE, z: -540 * MAP_SCALE, rx: 135, rz: 115 },
  { id: 'scrub-far-se', x: 680 * MAP_SCALE, z: -620 * MAP_SCALE, rx: 125, rz: 120 },
  { id: 'scrub-far-nw', x: -660 * MAP_SCALE, z: 600 * MAP_SCALE, rx: 128, rz: 118 },
  { id: 'scrub-mid-n', x: 180 * MAP_SCALE, z: 280 * MAP_SCALE, rx: 120, rz: 100 },
  { id: 'scrub-mid-s', x: -160 * MAP_SCALE, z: -300 * MAP_SCALE, rx: 118, rz: 105 },
]

/** Soft hills placed away from clearings / roads (peak height ≈ h). */
const FOREST_HILLS: ReadonlyArray<{ x: number; z: number; h: number; r: number }> = [
  { x: 520 * MAP_SCALE, z: -620 * MAP_SCALE, h: 22, r: 140 * MAP_SCALE },
  { x: -540 * MAP_SCALE, z: 640 * MAP_SCALE, h: 24, r: 150 * MAP_SCALE },
  { x: 720 * MAP_SCALE, z: 180 * MAP_SCALE, h: 18, r: 120 * MAP_SCALE },
  { x: -740 * MAP_SCALE, z: -160 * MAP_SCALE, h: 19, r: 125 * MAP_SCALE },
  { x: 280 * MAP_SCALE, z: 780 * MAP_SCALE, h: 16, r: 110 * MAP_SCALE },
  { x: -300 * MAP_SCALE, z: -800 * MAP_SCALE, h: 17, r: 115 * MAP_SCALE },
  { x: 820 * MAP_SCALE, z: -280 * MAP_SCALE, h: 15, r: 105 * MAP_SCALE },
  { x: -800 * MAP_SCALE, z: 260 * MAP_SCALE, h: 14, r: 100 * MAP_SCALE },
  { x: 160 * MAP_SCALE, z: -360 * MAP_SCALE, h: 11, r: 70 * MAP_SCALE },
  { x: -180 * MAP_SCALE, z: 340 * MAP_SCALE, h: 12, r: 74 * MAP_SCALE },
  { x: 380 * MAP_SCALE, z: 120 * MAP_SCALE, h: 10, r: 62 * MAP_SCALE },
  { x: -400 * MAP_SCALE, z: -140 * MAP_SCALE, h: 11, r: 68 * MAP_SCALE },
  { x: 640 * MAP_SCALE, z: -780 * MAP_SCALE, h: 14, r: 88 * MAP_SCALE },
  { x: -660 * MAP_SCALE, z: 800 * MAP_SCALE, h: 15, r: 92 * MAP_SCALE },
  { x: 90 * MAP_SCALE, z: -620 * MAP_SCALE, h: 9, r: 55 * MAP_SCALE },
  { x: -110 * MAP_SCALE, z: 600 * MAP_SCALE, h: 9.5, r: 58 * MAP_SCALE },
  { x: 430 * MAP_SCALE, z: -200 * MAP_SCALE, h: 10, r: 60 * MAP_SCALE },
  { x: -450 * MAP_SCALE, z: 220 * MAP_SCALE, h: 10.5, r: 64 * MAP_SCALE },
]

export type ForestMapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
  groundY: number
  heightAt?: (x: number, z: number) => number
  paths?: Array<{ points: Array<{ x: number; z: number }> }>
}

const PINE_URL = assetUrl('maps/props/pine_tree.glb')
const BUSH_URL = assetUrl('maps/props/photorealistic_bush.glb?v=2')
const RUIN_HOUSE_URL = assetUrl('maps/props/ruined_house_low_poly.glb')
const FANCY_CAR_URL = assetUrl('maps/props/fancy_cardestroyed.glb')

/** Forest props for boot/menu preload (no rocks / no shed — dropped for load speed). */
export const FOREST_PROP_URLS: readonly string[] = [
  PINE_URL,
  BUSH_URL,
  RUIN_HOUSE_URL,
  FANCY_CAR_URL,
]
/** Kept moderate — pines share 1–2 merged meshes via InstancedMesh. */
const TREE_COUNT = 450
/** Photoreal bush scatter — dense open-camo clumps, shared InstancedMesh draws. */
const BUSH_COUNT = 2400
/** Cap mid-distance wrecks (fancy + destroyed). */
const WRECK_CAP = 24
const CLEAR_SPAWN_HALF_X = 90 * MAP_SCALE
const CLEAR_SPAWN_Z = 840 * MAP_SCALE

/** Native tile scale unused — roads are continuous ribbons now. */
const ROAD_CLEAR_HALF = 22
/** Hard-flat shoulder so roads sit in a real clearing. */
const ROAD_FLAT_HALF = 18
const ROAD_Y = 0.05
/** Heightfield resolution (segments per axis). */
const TERRAIN_SEG_X = 320
const TERRAIN_SEG_Z = 320

type RoadPt = { x: number; z: number }

function roadPt(x: number, z: number): RoadPt {
  return { x: x * MAP_SCALE, z: z * MAP_SCALE }
}

/** Gentle control points — densified into smooth curves (not stair-steps). */
const ROAD_CTRL: readonly (readonly RoadPt[])[] = [
  // S–N spawn spine (direct push)
  [
    roadPt(0, -940),
    roadPt(45, -700),
    roadPt(-40, -420),
    roadPt(30, -180),
    roadPt(0, 0),
    roadPt(-35, 180),
    roadPt(40, 420),
    roadPt(-30, 700),
    roadPt(0, 940),
  ],
  // SW→NE diagonal through all five towns
  [
    roadPt(-80, -920),
    roadPt(-280, -740),
    roadPt(-500, -600),
    roadPt(-540, -520),
    roadPt(-300, -260),
    roadPt(-80, -80),
    roadPt(0, 0),
    roadPt(80, 80),
    roadPt(300, 280),
    roadPt(540, 520),
    roadPt(280, 740),
    roadPt(40, 920),
  ],
  // West flank (NW empty quadrant)
  [
    roadPt(-820, -900),
    roadPt(-760, -480),
    roadPt(-800, 0),
    roadPt(-740, 480),
    roadPt(-820, 900),
  ],
  // East flank (SE empty quadrant)
  [
    roadPt(820, -900),
    roadPt(760, -480),
    roadPt(800, 0),
    roadPt(740, 480),
    roadPt(820, 900),
  ],
  // South Hollow spur off west flank
  [
    roadPt(-760, -480),
    roadPt(-640, -500),
    roadPt(-540, -520),
  ],
  // North Ridge spur off east flank
  [
    roadPt(740, 480),
    roadPt(640, 500),
    roadPt(540, 520),
  ],
]

const ROAD_WIDTH = 14
/** Dirt shoulder wider than path — soft fade zone into grass. */
const ROAD_SKIRT_WIDTH = ROAD_WIDTH + 16
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

  for (const f of FOREST_CROP_FIELDS) {
    const nx = (x - f.x) / f.rx
    const nz = (z - f.z) / f.rz
    if (nx * nx + nz * nz < 1) {
      mul *= f.kind === 'barley' ? 0.82 : 0.88
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

/** Snap a world point onto the nearest road ribbon (frontline defender rallies). */
export function nearestRoadPoint(x: number, z: number): { x: number; z: number } {
  let bestX = x
  let bestZ = z
  let bestD = Infinity
  for (const line of ROAD_POLYLINES) {
    for (const p of line) {
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)
      if (d < bestD) {
        bestD = d
        bestX = p.x
        bestZ = p.z
      }
    }
  }
  return { x: bestX, z: bestZ }
}

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

  // Crop fields — mostly flat farm plots (stalks carry the cover, not the dirt).
  for (const f of FOREST_CROP_FIELDS) {
    const nx = (x - f.x) / f.rx
    const nz = (z - f.z) / f.rz
    const d2 = nx * nx + nz * nz
    if (d2 <= 1) {
      const u = Math.sqrt(d2)
      const flat = u < 0.82 ? 0.12 : 0.12 + ((u - 0.82) / 0.18) * 0.88
      m = Math.min(m, flat)
    }
  }

  return Math.max(0, Math.min(1, m))
}

function rawRelief(x: number, z: number): number {
  // Multi-scale bumps — slightly more rugged than the old 750×2000 roll
  let h =
    Math.sin(x * 0.0085) * Math.cos(z * 0.008) * 6.8 +
    Math.sin(x * 0.018 + 1.1) * Math.cos(z * 0.016 - 0.5) * 5.2 +
    Math.sin(x * 0.036 + z * 0.014) * Math.cos(z * 0.032) * 3.4 +
    Math.sin(x * 0.068) * Math.sin(z * 0.064 + 2.2) * 2.15 +
    Math.sin(x * 0.12 + 0.7) * Math.cos(z * 0.105) * 1.15 +
    Math.sin(x * 0.2 + z * 0.16) * Math.cos(z * 0.18 - 0.4) * 0.7 +
    Math.sin(x * 0.31 + 1.4) * Math.cos(z * 0.28) * 0.38

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

/** Inside a rural crop ellipse (slightly padded so tree line sits outside stalks). */
function inCropField(x: number, z: number, pad = 1.08): boolean {
  for (const f of FOREST_CROP_FIELDS) {
    const nx = (x - f.x) / (f.rx * pad)
    const nz = (z - f.z) / (f.rz * pad)
    if (nx * nx + nz * nz <= 1) return true
  }
  return false
}

/** Open scrub meadow (pines cleared; bush open-camo lives here). */
function inOpenScrub(x: number, z: number, pad = 1.05): boolean {
  for (const s of FOREST_OPEN_SCRUB) {
    const nx = (x - s.x) / (s.rx * pad)
    const nz = (z - s.z) / (s.rz * pad)
    if (nx * nx + nz * nz <= 1) return true
  }
  return false
}

function blockedForTree(x: number, z: number): boolean {
  if (onRoadCorridor(x, z)) return true
  if (inTownClearing(x, z)) return true
  if (inCropField(x, z)) return true
  if (inOpenScrub(x, z)) return true
  if (Math.abs(x) < CLEAR_SPAWN_HALF_X && Math.abs(z) > CLEAR_SPAWN_Z * 0.55) return true
  return false
}

/** Bushes = open-camo: off roads/crops/town cores/spawn; prefer scrub meadows. */
function blockedForBush(x: number, z: number): boolean {
  if (onRoadCorridor(x, z)) return true
  if (inCropField(x, z)) return true
  for (const town of FOREST_TOWNS) {
    if (Math.hypot(x - town.x, z - town.z) < town.radius * 0.45) return true
  }
  if (Math.abs(x) < CLEAR_SPAWN_HALF_X * 0.65 && Math.abs(z) > CLEAR_SPAWN_Z * 0.7) {
    return true
  }
  return false
}

/** Stand Z-up Sketchfab props on Y and plant base at y=0. Returns unit height.
 *  Only tip when one axis clearly dominates — near-cubic bushes stay Y-up. */
function uprightAndPlant(root: THREE.Object3D): number {
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.setScalar(1)
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  _box.getSize(_size)

  const dom = 1.2
  if (_size.z >= _size.y * dom && _size.z >= _size.x * dom) {
    root.rotation.x = -Math.PI / 2
  } else if (_size.x >= _size.y * dom && _size.x >= _size.z * dom) {
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
    mesh.computeBoundingSphere()
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

/**
 * Photorealistic bushes scattered map-wide for soft camo cover.
 * Drive-through (no solid colliders) — contact blobs only for suspension chatter.
 */
async function placeBushes(
  root: THREE.Group,
  contacts: ContactSpot[],
): Promise<number> {
  const gltf = await loadGltfCached(BUSH_URL)
  const src = gltf.scene.clone(true)
  const unitHeight = uprightAndPlant(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Bush bake produced 0 parts')
    return 0
  }

  // Leaf cards: cutout (not soft BLEND) so InstancedMesh stays visible + sorted
  for (const part of parts) {
    const m = part.material as THREE.MeshStandardMaterial
    const name = (m.name || '').toLowerCase()
    const looksLeaf =
      /leaf|foliage|twig/i.test(name) || !!m.alphaMap || m.transparent
    m.side = THREE.DoubleSide
    if (looksLeaf) {
      m.transparent = false
      m.opacity = 1
      m.alphaTest = 0.2
      m.depthWrite = true
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace
        m.map.needsUpdate = true
      }
    }
    if ('metalness' in m) m.metalness = 0
    if ('roughness' in m) m.roughness = Math.max(0.88, m.roughness ?? 0.9)
    m.needsUpdate = true
  }

  const rand = mulberry32(0xb051001)
  const halfX = FOREST_OVERWATCH_WIDTH * 0.46
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.46
  const placements: Array<{ x: number; z: number; yaw: number; height: number }> =
    []

  // Dense fill inside open scrub meadows (open-camo, not crop pads)
  const scrubTarget = Math.floor(BUSH_COUNT * 0.78)
  let scrubAttempts = 0
  const maxScrubAttempts = scrubTarget * 24
  while (placements.length < scrubTarget && scrubAttempts < maxScrubAttempts) {
    scrubAttempts++
    const scrub = FOREST_OPEN_SCRUB[Math.floor(rand() * FOREST_OPEN_SCRUB.length)]!
    const ang = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) // denser toward center
    const x = scrub.x + Math.cos(ang) * r * scrub.rx * 0.98
    const z = scrub.z + Math.sin(ang) * r * scrub.rz * 0.98
    if (blockedForBush(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 3.2 + rand() * 2.8,
    })
  }

  // Remainder: scatter in open rural ground (still off crops)
  let attempts = 0
  const maxAttempts = BUSH_COUNT * 20
  while (placements.length < BUSH_COUNT && attempts < maxAttempts) {
    attempts++
    const x = (rand() - 0.5) * 2 * halfX
    const z = (rand() - 0.5) * 2 * halfZ
    if (blockedForBush(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 2.8 + rand() * 2.6,
    })
  }

  const count = placements.length
  for (let p = 0; p < parts.length; p++) {
    const { geometry, material } = parts[p]!
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = `forestBushInstanced_${p}`
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = true
    mesh.matrixAutoUpdate = false

    for (let i = 0; i < count; i++) {
      const pl = placements[i]!
      const s = pl.height / unitHeight
      const fat = 1.35 + (i % 5) * 0.1
      _dummy.position.set(pl.x, forestHeightAt(pl.x, pl.z), pl.z)
      _dummy.rotation.set(0, pl.yaw, 0)
      _dummy.scale.set(s * fat, s, s * fat)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    // InstancedMesh defaults to template sphere at origin — culls every bush off-center
    mesh.computeBoundingSphere()
    root.add(mesh)
  }

  for (const pl of placements) {
    contacts.push({
      x: pl.x,
      z: pl.z,
      radius: Math.max(1.2, pl.height * 0.55),
    })
  }

  console.info(
    `[Steel] Forest bushes — ${count} instances · ${parts.length} draws · unitH=${unitHeight.toFixed(2)}m · ${FOREST_OPEN_SCRUB.length} open-scrub meadows · drive-through camo`,
  )
  return count
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

/** Packed dirt path ribbon (rural forest lanes) — edge alpha fades into grass. */
function loadRoadDirtMaterial(): THREE.MeshStandardMaterial {
  const map = createDirtPathTexture(1, 1)
  map.anisotropy = 8
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xe8d4b0,
    roughness: 0.97,
    metalness: 0.02,
    envMapIntensity: 0,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  })
}

function loadRoadSkirtMaterial(): THREE.MeshStandardMaterial {
  const map = createGravelShoulderTexture(1, 1)
  map.anisotropy = 4
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xc4b090,
    roughness: 0.98,
    metalness: 0.02,
    envMapIntensity: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

/** Soft mud tire tracks on top of the dirt bed. */
function loadRoadRutMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x4a3828,
    roughness: 0.99,
    metalness: 0.02,
    envMapIntensity: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

/**
 * Smooth curved road ribbons (Catmull-Rom densified). Climbable — no colliders.
 * V7: packed dirt path + gravel skirt + soft tire ruts (no painted markings).
 */
async function placeRoads(root: THREE.Group): Promise<{
  tileCount: number
  paths: Array<{ points: Array<{ x: number; z: number }> }>
}> {
  const mat = loadRoadDirtMaterial()
  const skirtMat = loadRoadSkirtMaterial()
  const rutMat = loadRoadRutMaterial()

  const roads = new THREE.Group()
  roads.name = 'ForestRoads'
  root.add(roads)

  let ribbonCount = 0
  let skirtCount = 0
  let rutCount = 0
  for (let i = 0; i < ROAD_POLYLINES.length; i++) {
    const line = ROAD_POLYLINES[i]!

    // Gravel/dirt shoulder under the packed path (wider, slightly lower)
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

    // Soft dual tire ruts (lift + polygonOffset vs dirt bed)
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
    `[Steel] Forest roads — ${ribbonCount} dirt paths · ${skirtCount} skirts · ${rutCount} ruts · width ${ROAD_WIDTH}m · V7 dirt · bbox ` +
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
  const spots: PropSpot[] = []
  for (const town of FOREST_TOWNS) {
    const r = town.radius
    spots.push(
      ...townRing(town, 8, r * 0.32, 13.2, 0.18),
      ...townRing(town, 6, r * 0.52, 12.8, 0.72),
      ...townRing(town, 5, r * 0.72, 12.4, 1.2),
    )
  }
  return spots
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
    const targetH = spot.h * (pick.h / 13)
    plantRuin(pick.piece, group, colliders, spot.x, spot.z, spot.yaw, targetH)
    contacts.push({
      x: spot.x,
      z: spot.z,
      radius: Math.max(
        4.5,
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
 * Wreck scatter on shoulders + town edges (fancy_cardestroyed only, capped).
 */
async function placeAbandonedCars(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const group = new THREE.Group()
  group.name = 'FancyWrecks'
  root.add(group)

  let piece: ReturnType<typeof prepareRuinPiece>
  try {
    const fancy = await loadGltfCached(FANCY_CAR_URL)
    piece = prepareRuinPiece(fancy.scene)
  } catch (err) {
    console.warn(`[Steel] Fancy car load failed`, err)
    return 0
  }
  const h = 2.5

  const spots: PropSpot[] = [
    { x: 55, z: 35, yaw: -1.2, h },
    { x: 500, z: 480, yaw: 1.4, h },
    { x: -500, z: -480, yaw: 0.6, h },
    { x: -70, z: -40, yaw: 2.1, h },
    { x: 80, z: 70, yaw: -0.7, h },
    ...roadShoulderSpots(14, 17, h, 0xc4a5),
  ]

  let count = 0
  for (let i = 0; i < spots.length && count < WRECK_CAP; i++) {
    const spot = spots[i]!
    if (Math.abs(spot.x) > FOREST_OVERWATCH_WIDTH * 0.46) continue
    if (Math.abs(spot.z) > FOREST_OVERWATCH_DEPTH * 0.46) continue
    if (onAsphalt(spot.x, spot.z)) continue
    plantRuin(piece, group, colliders, spot.x, spot.z, spot.yaw, h)
    contacts.push({ x: spot.x, z: spot.z, radius: 3.6 })
    count++
  }

  console.info(`[Steel] Fancy wrecks — ${count}/${WRECK_CAP} · fancy_cardestroyed only`)
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

/**
 * Rural barley / flower fields — dense tall crossed-card stalks.
 * No solid colliders: tanks drive through and can sit fully in cover (~2–2.6 m).
 */
function placeRuralCropFields(root: THREE.Group): { stalks: number; fields: number } {
  const barley = createCropTuft('barley')
  const flowerA = createCropTuft('flower', 0)
  const flowerB = createCropTuft('flower', 1)
  const flowerC = createCropTuft('flower', 2)

  type Spot = { x: number; z: number; yaw: number; h: number; variant: number }
  const barleySpots: Spot[] = []
  const flowerSpots: Spot[] = []
  const rand = mulberry32(0xc20f1e1d)

  /**
   * ~1.85 m grid + fat clumps ≈ continuous cover without 10k+ alpha cards.
   * Height 2m+ so a hull sits behind the stalks, not on painted dirt.
   */
  const STEP = 1.85

  for (const field of FOREST_CROP_FIELDS) {
    const x0 = field.x - field.rx
    const z0 = field.z - field.rz
    for (let x = x0; x <= field.x + field.rx; x += STEP) {
      for (let z = z0; z <= field.z + field.rz; z += STEP) {
        const nx = (x - field.x) / field.rx
        const nz = (z - field.z) / field.rz
        if (nx * nx + nz * nz > 0.96) continue
        if (onRoadCorridor(x, z)) continue
        // Soft edge — thin out near rim
        const edge = Math.sqrt(nx * nx + nz * nz)
        if (edge > 0.78 && rand() < (edge - 0.78) / 0.22) continue
        // Occasional gaps so it reads as planted rows
        if (rand() < 0.06) continue

        const jx = x + (rand() - 0.5) * STEP * 0.5
        const jz = z + (rand() - 0.5) * STEP * 0.5
        const spot: Spot = {
          x: jx,
          z: jz,
          yaw: rand() * Math.PI * 2,
          h:
            field.kind === 'barley'
              ? 2.15 + rand() * 0.5
              : 1.95 + rand() * 0.45,
          variant: Math.floor(rand() * 3),
        }
        if (field.kind === 'barley') barleySpots.push(spot)
        else flowerSpots.push(spot)
      }
    }
  }

  const plant = (
    spots: Spot[],
    tufts: ReturnType<typeof createCropTuft>[],
    name: string,
  ): number => {
    if (spots.length === 0) return 0
    // One InstancedMesh per tuft variant (flowers); barley uses a single tuft.
    for (let v = 0; v < tufts.length; v++) {
      const subset = tufts.length === 1 ? spots : spots.filter((s) => s.variant === v)
      if (subset.length === 0) continue
      const { geometry, material, unitHeight } = tufts[v]!
      const mesh = new THREE.InstancedMesh(geometry, material, subset.length)
      mesh.name = `${name}_${v}`
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.frustumCulled = true
      mesh.matrixAutoUpdate = false
      for (let i = 0; i < subset.length; i++) {
        const s = subset[i]!
        const sc = s.h / unitHeight
        // Fat XZ so neighbouring clumps mesh into a hideable wall
        const fat = 1.35 + (s.variant % 3) * 0.12
        _dummy.position.set(s.x, forestHeightAt(s.x, s.z), s.z)
        _dummy.rotation.set(0, s.yaw, 0)
        _dummy.scale.set(fat, sc, fat)
        _dummy.updateMatrix()
        mesh.setMatrixAt(i, _dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      // Alpha cards need a generous sphere so frustum cull doesn't pop cover
      mesh.geometry.computeBoundingSphere()
      if (mesh.geometry.boundingSphere) {
        mesh.geometry.boundingSphere.radius = Math.max(
          mesh.geometry.boundingSphere.radius,
          2.8,
        )
      }
      root.add(mesh)
    }
    return spots.length
  }

  const nBarley = plant(barleySpots, [barley], 'forestBarley')
  const nFlower = plant(flowerSpots, [flowerA, flowerB, flowerC], 'forestFlower')

  // Soft dirt pads under crops (readable farm plot — secondary to stalks)
  const dirtGeo = new THREE.CircleGeometry(1, 24)
  dirtGeo.rotateX(-Math.PI / 2)
  const dirtMat = new THREE.MeshStandardMaterial({
    color: 0x6a5a3a,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const dirt = new THREE.InstancedMesh(dirtGeo, dirtMat, FOREST_CROP_FIELDS.length)
  dirt.name = 'forestCropDirt'
  dirt.receiveShadow = true
  dirt.castShadow = false
  dirt.matrixAutoUpdate = false
  for (let i = 0; i < FOREST_CROP_FIELDS.length; i++) {
    const f = FOREST_CROP_FIELDS[i]!
    const y = forestHeightAt(f.x, f.z) + 0.04
    _dummy.position.set(f.x, y, f.z)
    _dummy.rotation.set(0, f.kind === 'barley' ? 0.15 : -0.2, 0)
    _dummy.scale.set(f.rx * 1.02, 1, f.rz * 1.02)
    _dummy.updateMatrix()
    dirt.setMatrixAt(i, _dummy.matrix)
  }
  dirt.instanceMatrix.needsUpdate = true
  root.add(dirt)

  console.info(
    `[Steel] Rural fields — ${FOREST_CROP_FIELDS.length} plots · ${nBarley} barley stalks · ${nFlower} flower stalks (drive-through cover ~2m+)`,
  )
  return { stalks: nBarley + nFlower, fields: FOREST_CROP_FIELDS.length }
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
    // Soft dirt bleed under path shoulders so ribbon alpha fade meets brown, not a hard green cut
    const dRoad = distToRoads(x, z)
    const blendInner = ROAD_WIDTH * 0.28
    const blendOuter = ROAD_SKIRT_WIDTH * 0.5 + 10
    if (dRoad < blendOuter) {
      const u = THREE.MathUtils.clamp(
        (dRoad - blendInner) / Math.max(0.001, blendOuter - blendInner),
        0,
        1,
      )
      const dirtAmt = 1 - u * u * (3 - 2 * u)
      tint.r = THREE.MathUtils.lerp(tint.r, 0.62, dirtAmt * 0.82)
      tint.g = THREE.MathUtils.lerp(tint.g, 0.48, dirtAmt * 0.78)
      tint.b = THREE.MathUtils.lerp(tint.b, 0.3, dirtAmt * 0.8)
    }
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
    `[Steel] Forest terrain — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH} · ${TERRAIN_SEG_X}×${TERRAIN_SEG_Z} · y[${minY.toFixed(2)}…${maxY.toFixed(2)}] · V1 floor+vertexTint · V7 road dirt bleed · clearings ${FOREST_TOWNS.map((t) => t.name).join(', ')}`,
  )
  return mesh
}

/**
 * Forest Overwatch — rolling floor, 3 flat clearings, modular roads, pines.
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

  const [treeCount, bushCount, ruinCount, carCount] = await Promise.all([
    placePineTrees(root, colliders, contacts).catch((err) => {
      console.warn('[Steel] Forest pine trees failed to load', err)
      return 0
    }),
    placeBushes(root, contacts).catch((err) => {
      console.warn('[Steel] Forest bushes failed to load', err)
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
  const crops = placeRuralCropFields(root)

  console.info(
    `[Steel] Forest Overwatch — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH}m, ${roadTiles} road tiles, ${treeCount} pines, ${bushCount} bushes, ${ruinCount} houses, ${carCount} wrecks, ${blobCount} contact blobs, ${FOREST_TOWNS.length} clearings, ${crops.fields} crop fields (${crops.stalks} stalks), ${colliders.length} colliders`,
  )
  return {
    root,
    colliders,
    groundY: 0,
    heightAt: forestHeightAt,
    paths,
  }
}
