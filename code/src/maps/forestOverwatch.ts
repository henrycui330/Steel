import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { estimatePropCollider, type PropCollider } from '../collision'
import { assetUrl } from '../assetUrl'
import { loadGltfCached, preloadUrls } from '../loadGltf'
import {
  createBridgeConcreteTexture,
  createBridgeSteelTexture,
  createCropTuft,
  createDirtPathTexture,
  createGravelShoulderTexture,
  createRuralMixedFloorMaps,
  sampleForestGroundTint,
  type CropKind,
} from '../textures'

/** 2000 m layout × this = playable size (3500×3500). */
const MAP_SCALE = 1.75

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
 * Sketch layout — three capture pads.
 * Frontline order south → north: C → B (Midwood / KOTH) → A.
 */
export const FOREST_TOWNS: readonly ForestTown[] = [
  { id: 'c', name: 'Point C', x: -420 * MAP_SCALE, z: -380 * MAP_SCALE, radius: 155 },
  // Midwood / Point B — KOTH center (on the giant river ford)
  { id: 'mid', name: 'Midwood', x: 0, z: 0, radius: 165 },
  { id: 'a', name: 'Point A', x: 420 * MAP_SCALE, z: 380 * MAP_SCALE, radius: 155 },
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
  { id: 'barley-se', kind: 'barley', x: 620 * MAP_SCALE, z: -520 * MAP_SCALE, rx: 90, rz: 68 },
  { id: 'barley-nw', kind: 'barley', x: -600 * MAP_SCALE, z: 520 * MAP_SCALE, rx: 85, rz: 70 },
  { id: 'flower-ne', kind: 'flower', x: 280 * MAP_SCALE, z: 620 * MAP_SCALE, rx: 80, rz: 65 },
  { id: 'flower-sw', kind: 'flower', x: -280 * MAP_SCALE, z: -640 * MAP_SCALE, rx: 78, rz: 62 },
]

/**
 * Open-field scrub meadows — pines cleared, bushes dense for open-camo
 * (away from dense forest belts / river chokes).
 */
export const FOREST_OPEN_SCRUB: ReadonlyArray<{
  id: string
  x: number
  z: number
  rx: number
  rz: number
}> = [
  { id: 'scrub-ne-approach', x: 280 * MAP_SCALE, z: 220 * MAP_SCALE, rx: 155, rz: 125 },
  { id: 'scrub-sw-approach', x: -260 * MAP_SCALE, z: -220 * MAP_SCALE, rx: 150, rz: 130 },
  { id: 'scrub-se-open', x: 560 * MAP_SCALE, z: -620 * MAP_SCALE, rx: 145, rz: 135 },
  { id: 'scrub-nw-open', x: -560 * MAP_SCALE, z: 620 * MAP_SCALE, rx: 145, rz: 135 },
  { id: 'scrub-s-mid', x: 80 * MAP_SCALE, z: -720 * MAP_SCALE, rx: 170, rz: 115 },
  { id: 'scrub-n-mid', x: -80 * MAP_SCALE, z: 720 * MAP_SCALE, rx: 170, rz: 115 },
  // Extra camo pockets flanking approaches / bridge approaches
  { id: 'scrub-c-flank', x: -280 * MAP_SCALE, z: -480 * MAP_SCALE, rx: 130, rz: 110 },
  { id: 'scrub-a-flank', x: 300 * MAP_SCALE, z: 480 * MAP_SCALE, rx: 130, rz: 110 },
  { id: 'scrub-west-bridge', x: -620 * MAP_SCALE, z: 140 * MAP_SCALE, rx: 120, rz: 100 },
  { id: 'scrub-east-bridge', x: 620 * MAP_SCALE, z: -80 * MAP_SCALE, rx: 120, rz: 100 },
  { id: 'scrub-mid-s', x: 40 * MAP_SCALE, z: -280 * MAP_SCALE, rx: 125, rz: 105 },
  { id: 'scrub-mid-n', x: -40 * MAP_SCALE, z: 280 * MAP_SCALE, rx: 125, rz: 105 },
]

/**
 * Dense forest belts from the sketch — tree placement biases hard into these.
 */
export const FOREST_DENSE: ReadonlyArray<{
  id: string
  x: number
  z: number
  rx: number
  rz: number
}> = [
  // North of river, center-left
  { id: 'dense-n', x: -80 * MAP_SCALE, z: 420 * MAP_SCALE, rx: 380, rz: 260 },
  // South-west corner near C / south-left spawn
  { id: 'dense-sw', x: -520 * MAP_SCALE, z: -560 * MAP_SCALE, rx: 300, rz: 260 },
  // South of river, center-right (between B and east bridge)
  { id: 'dense-se', x: 320 * MAP_SCALE, z: -180 * MAP_SCALE, rx: 290, rz: 240 },
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
  /** Giant river centerline(s) for combat minimap. */
  rivers?: Array<{ points: Array<{ x: number; z: number }> }>
  /** Distance-cull foliage chunks around the player (call each frame). */
  updateLod?: (x: number, z: number, rangeMul?: number) => void
}

const PINE_URL = assetUrl('maps/props/pine_tree.glb')
/** Metal-rough convert of Sketchfab oak (was specular-glossiness → white mats). */
const OAK_URL = assetUrl('maps/props/oak_tree.glb?v=2')
const BUSH_URL = assetUrl('maps/props/photorealistic_bush.glb?v=2')
const RUIN_HOUSE_URL = assetUrl('maps/props/ruined_house_low_poly.glb')
const FANCY_CAR_URL = assetUrl('maps/props/fancy_cardestroyed.glb')

/** Forest props for boot/menu preload (no rocks / no shed — dropped for load speed). */
export const FOREST_PROP_URLS: readonly string[] = [
  PINE_URL,
  OAK_URL,
  BUSH_URL,
  RUIN_HOUSE_URL,
  FANCY_CAR_URL,
]
/** Kept moderate — pines share 1–2 merged meshes via InstancedMesh. */
const TREE_COUNT = 720
/** Broadleaf oaks mixed into the temperate belt. */
const OAK_COUNT = 320
/** Photoreal bush scatter — one GLB, chunked InstancedMesh (scale/yaw vary). */
const BUSH_COUNT = 5800
/** Cap mid-distance wrecks (fancy + destroyed). */
const WRECK_CAP = 24
/** Flank spawn pads (sketch: 2 N + 2 S) — clear trees / flatten. */
const SPAWN_PADS: ReadonlyArray<{ x: number; z: number; rx: number; rz: number }> = [
  { x: -520 * MAP_SCALE, z: -900 * MAP_SCALE, rx: 110 * MAP_SCALE, rz: 90 * MAP_SCALE },
  { x: 520 * MAP_SCALE, z: -900 * MAP_SCALE, rx: 110 * MAP_SCALE, rz: 90 * MAP_SCALE },
  { x: -520 * MAP_SCALE, z: 900 * MAP_SCALE, rx: 110 * MAP_SCALE, rz: 90 * MAP_SCALE },
  { x: 520 * MAP_SCALE, z: 900 * MAP_SCALE, rx: 110 * MAP_SCALE, rz: 90 * MAP_SCALE },
]

/** Native tile scale unused — roads are continuous ribbons now. */
const ROAD_CLEAR_HALF = 22
/** Hard-flat shoulder so roads sit in a real clearing. */
const ROAD_FLAT_HALF = 18
const ROAD_Y = 0.05
/** Terrain grid — enough detail on 3500² without crushing the GPU. */
const TERRAIN_SEG_X = 240
const TERRAIN_SEG_Z = 240
/** Split InstancedMesh draws so frustum culling can drop off-screen chunks. */
const PROP_CHUNK_CELLS = 6

/** Distance LOD — hide far chunks (props stay loaded; not drawn). */
const LOD_RANGE_BUSH = 380
const LOD_RANGE_TREE = 720
const LOD_RANGE_AO = 260

type FoliageLodChunk = {
  mesh: THREE.Object3D
  x: number
  z: number
  /** Hide beyond this radius (m). */
  range: number
  visible: boolean
}

const _foliageLod: FoliageLodChunk[] = []

function clearFoliageLod(): void {
  _foliageLod.length = 0
}

function registerFoliageLod(
  mesh: THREE.Object3D,
  x: number,
  z: number,
  range: number,
): void {
  mesh.visible = true
  _foliageLod.push({ mesh, x, z, range, visible: true })
}

/**
 * Show foliage/AO chunks near (cx,cz). `rangeMul` > 1 for aircraft altitude.
 * Hysteresis (~12%) stops pop flicker on the rim.
 */
export function updateForestLod(cx: number, cz: number, rangeMul = 1): void {
  const mul = Math.max(0.5, rangeMul)
  for (let i = 0; i < _foliageLod.length; i++) {
    const c = _foliageLod[i]!
    const dx = c.x - cx
    const dz = c.z - cz
    const d2 = dx * dx + dz * dz
    const onR = c.range * mul
    const offR = onR * 1.12
    let next = c.visible
    if (c.visible) {
      if (d2 > offR * offR) next = false
    } else if (d2 < onR * onR) {
      next = true
    }
    if (next !== c.visible) {
      c.visible = next
      c.mesh.visible = next
    }
  }
}

/**
 * Discrete height grid matching the terrain mesh. Props/tanks sample this with
 * bilinear interp so nothing floats above (or sinks through) the visible ground.
 */
let _heightGrid: Float32Array | null = null
let _gridNx = 0
let _gridNz = 0
let _gridHalfX = 0
let _gridHalfZ = 0
let _gridStepX = 1
let _gridStepZ = 1

function rebuildHeightGrid(): void {
  _gridNx = TERRAIN_SEG_X + 1
  _gridNz = TERRAIN_SEG_Z + 1
  _gridHalfX = FOREST_OVERWATCH_WIDTH * 0.5
  _gridHalfZ = FOREST_OVERWATCH_DEPTH * 0.5
  _gridStepX = FOREST_OVERWATCH_WIDTH / TERRAIN_SEG_X
  _gridStepZ = FOREST_OVERWATCH_DEPTH / TERRAIN_SEG_Z
  const g = new Float32Array(_gridNx * _gridNz)
  for (let iz = 0; iz < _gridNz; iz++) {
    for (let ix = 0; ix < _gridNx; ix++) {
      const x = -_gridHalfX + ix * _gridStepX
      const z = -_gridHalfZ + iz * _gridStepZ
      const natural = rawRelief(x, z) * flattenMask(x, z)
      // Flat floodplain + shallow channel (no floating water through hills).
      g[iz * _gridNx + ix] = riverFloodplainY(x, z, natural)
    }
  }
  _heightGrid = g
}

type RoadPt = { x: number; z: number }

function roadPt(x: number, z: number): RoadPt {
  return { x: x * MAP_SCALE, z: z * MAP_SCALE }
}

/**
 * Sketch paths — west bridge corridor, east bridge corridor, C–B–A spine,
 * south + north laterals between flank spawns.
 */
const ROAD_CTRL: readonly (readonly RoadPt[])[] = [
  // West: S-left spawn → C → west bridge → N-left spawn
  [
    roadPt(-520, -920),
    roadPt(-480, -700),
    roadPt(-420, -380),
    roadPt(-580, -120),
    roadPt(-720, 40),
    roadPt(-600, 380),
    roadPt(-520, 920),
  ],
  // East: S-right spawn → east bridge → A → N-right spawn
  [
    roadPt(520, -920),
    roadPt(580, -480),
    roadPt(700, 20),
    roadPt(540, 220),
    roadPt(420, 380),
    roadPt(480, 680),
    roadPt(520, 920),
  ],
  // Capture spine C → B → A
  [
    roadPt(-420, -380),
    roadPt(-220, -140),
    roadPt(0, 0),
    roadPt(220, 220),
    roadPt(420, 380),
  ],
  // South lateral (red spawn belt)
  [
    roadPt(-520, -920),
    roadPt(0, -940),
    roadPt(520, -920),
  ],
  // North lateral (blue spawn belt)
  [
    roadPt(-520, 920),
    roadPt(0, 940),
    roadPt(520, 920),
  ],
  // N-right spawn down to A (sketch top-right → A)
  [
    roadPt(520, 920),
    roadPt(460, 620),
    roadPt(420, 380),
  ],
  // S-left spawn up to C
  [
    roadPt(-520, -920),
    roadPt(-460, -620),
    roadPt(-420, -380),
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

  // Chunk so off-screen AO discs cull (one giant mesh never did)
  const cells = PROP_CHUNK_CELLS
  const halfX = FOREST_OVERWATCH_WIDTH * 0.5
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.5
  const cellW = FOREST_OVERWATCH_WIDTH / cells
  const cellD = FOREST_OVERWATCH_DEPTH / cells
  const buckets: ContactSpot[][] = Array.from({ length: cells * cells }, () => [])
  for (const s of spots) {
    const ix = Math.max(0, Math.min(cells - 1, Math.floor((s.x + halfX) / cellW)))
    const iz = Math.max(0, Math.min(cells - 1, Math.floor((s.z + halfZ) / cellD)))
    buckets[iz * cells + ix]!.push(s)
  }

  let draws = 0
  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b]!
    if (list.length === 0) continue
    const ix = b % cells
    const iz = Math.floor(b / cells)
    const cx = -halfX + (ix + 0.5) * cellW
    const cz = -halfZ + (iz + 0.5) * cellD
    const mesh = new THREE.InstancedMesh(geo, mat, list.length)
    mesh.name = `forestContactBlobs_${b}`
    mesh.renderOrder = 2
    mesh.frustumCulled = true
    mesh.matrixAutoUpdate = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!
      const y = forestHeightAt(s.x, s.z) + 0.06
      const d = s.radius * 2
      _dummy.position.set(s.x, y, s.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(d, 1, d)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    root.add(mesh)
    registerFoliageLod(mesh, cx, cz, LOD_RANGE_AO)
    draws++
  }
  console.info(`[Steel] V3 contact blobs — ${spots.length} discs · ${draws} chunks`)
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

/**
 * Giant W→E river (sketch midline). Mild bend on the east side.
 * West + east road corridors cross on bridges.
 */
function riverPt(x: number, z: number): RoadPt {
  return { x: x * MAP_SCALE, z: z * MAP_SCALE }
}

/** Layout units × MAP_SCALE — mostly flat mid-band, dips south around +X. */
const RIVER_CTRL: readonly RoadPt[] = [
  riverPt(-1000, 30),
  riverPt(-780, 70),
  riverPt(-560, 20),
  riverPt(-360, 55),
  riverPt(-160, 35),
  riverPt(0, 45),
  riverPt(180, 70),
  riverPt(360, 10),
  riverPt(520, -55),
  riverPt(700, 25),
  riverPt(860, 60),
  riverPt(1000, 40),
]
const RIVER_POLYLINE: readonly RoadPt[] = densifyRoad(RIVER_CTRL, 28)
/** Half-width of water (m) — giant river. */
const RIVER_HALF_W = 48
/** Flat muddy shelf outside water (m). */
const RIVER_SHELF = 52
/** Blend from floodplain up into hills (m). */
const RIVER_BLEND = 80
/** Cleared floodplain elevation (world Y). */
const RIVER_FLOOR = -0.9
/** Extra cut below floodplain for the wet channel (m). */
const RIVER_CHANNEL = 2.35
/** Water surface — seated in the flat channel. */
const RIVER_WATER_Y = RIVER_FLOOR - RIVER_CHANNEL * 0.58

function distToRiver(x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < RIVER_POLYLINE.length - 1; i++) {
    const a = RIVER_POLYLINE[i]!
    const b = RIVER_POLYLINE[i + 1]!
    best = Math.min(best, distToSegment(x, z, a.x, a.z, b.x, b.z))
  }
  return best
}

/** 0 outside valley · ~1 in wet channel (for tint / prop clear). */
function riverChannel01(x: number, z: number): number {
  const d = distToRiver(x, z)
  const outer = RIVER_HALF_W + RIVER_SHELF + RIVER_BLEND
  if (d >= outer) return 0
  if (d <= RIVER_HALF_W) {
    const u = 1 - d / RIVER_HALF_W
    return 0.55 + 0.45 * u * u * (3 - 2 * u)
  }
  if (d <= RIVER_HALF_W + RIVER_SHELF) {
    return 0.35 * (1 - (d - RIVER_HALF_W) / RIVER_SHELF)
  }
  const u = 1 - (d - RIVER_HALF_W - RIVER_SHELF) / RIVER_BLEND
  return 0.2 * Math.max(0, u)
}

/**
 * Flatten a floodplain along the river, cut a shallow channel, blend outer
 * rim into natural hills — water never slices through raised terrain.
 */
function riverFloodplainY(x: number, z: number, natural: number): number {
  const d = distToRiver(x, z)
  const flatR = RIVER_HALF_W + RIVER_SHELF
  const blendR = flatR + RIVER_BLEND
  if (d >= blendR) return natural

  let target = RIVER_FLOOR
  if (d < RIVER_HALF_W) {
    const u = 1 - d / RIVER_HALF_W
    const wet = u * u * (3 - 2 * u)
    target = RIVER_FLOOR - RIVER_CHANNEL * wet
  }

  if (d <= flatR) return target

  const t = (d - flatR) / RIVER_BLEND
  const s = t * t * (3 - 2 * t)
  return THREE.MathUtils.lerp(target, natural, s)
}

/** Road over wet channel — driveable deck at road height. */
function onRiverBridgeDeck(x: number, z: number): boolean {
  return (
    distToRiver(x, z) < RIVER_HALF_W + 8 &&
    distToRoads(x, z) < ROAD_FLAT_HALF + 4
  )
}

type BridgeSite = { x: number; z: number; yaw: number; span: number }

/**
 * Nearest river×road crossing for a densified road polyline.
 * Yaw aligns local +X with the road (deck long axis); width is across-road.
 */
function findRiverCrossing(road: readonly RoadPt[]): BridgeSite | null {
  let best: BridgeSite | null = null
  let bestScore = -Infinity
  for (let i = 1; i < road.length - 1; i++) {
    const p = road[i]!
    const ch = riverChannel01(p.x, p.z)
    if (ch < 0.45) continue
    const prev = road[i - 1]!
    const next = road[i + 1]!
    const tx = next.x - prev.x
    const tz = next.z - prev.z
    // Snap onto the ribbon centre so the deck isn't offset into the water.
    const snap = nearestRoadPoint(p.x, p.z)
    // Local +X = road forward after +90° from the usual +Z heading.
    const yaw = Math.atan2(tx, tz) + Math.PI / 2
    const score = ch * 10 - distToRiver(snap.x, snap.z) * 0.05
    if (score > bestScore) {
      bestScore = score
      best = {
        x: snap.x,
        z: snap.z,
        yaw,
        // Only the wet channel + short abutments (not the whole floodplain).
        span: RIVER_HALF_W * 2 + 12,
      }
    }
  }
  return best
}

/** West corridor + east corridor crossings (sketch bridges). */
const BRIDGE_SITES: readonly BridgeSite[] = [
  findRiverCrossing(ROAD_POLYLINES[0]!),
  findRiverCrossing(ROAD_POLYLINES[1]!),
].filter((s): s is BridgeSite => !!s)

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

  // Flank spawn pads stay driveable
  for (const pad of SPAWN_PADS) {
    const nx = (x - pad.x) / pad.rx
    const nz = (z - pad.z) / pad.rz
    const d2 = nx * nx + nz * nz
    if (d2 <= 1) {
      const u = Math.sqrt(d2)
      m = Math.min(m, u < 0.7 ? 0.06 : 0.06 + ((u - 0.7) / 0.3) * 0.94)
    }
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
  // Multi-scale bumps — stronger mid/high freq so off-road drives chatter
  // (roads/clearings still killed by flattenMask).
  let h =
    Math.sin(x * 0.0085) * Math.cos(z * 0.008) * 7.4 +
    Math.sin(x * 0.018 + 1.1) * Math.cos(z * 0.016 - 0.5) * 6.0 +
    Math.sin(x * 0.036 + z * 0.014) * Math.cos(z * 0.032) * 4.2 +
    Math.sin(x * 0.068) * Math.sin(z * 0.064 + 2.2) * 3.1 +
    Math.sin(x * 0.12 + 0.7) * Math.cos(z * 0.105) * 2.0 +
    Math.sin(x * 0.2 + z * 0.16) * Math.cos(z * 0.18 - 0.4) * 1.35 +
    Math.sin(x * 0.31 + 1.4) * Math.cos(z * 0.28) * 0.85 +
    // Washboards / rocky chatter (~4–12 m wavelength)
    Math.sin(x * 0.55 + z * 0.42) * Math.cos(z * 0.48 - 1.1) * 0.55 +
    Math.sin(x * 0.9 - z * 0.7 + 2.3) * Math.cos(z * 0.85) * 0.38 +
    Math.sin(x * 1.35 + 0.4) * Math.sin(z * 1.2 - 0.8) * 0.22

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

/** Bilinear sample of carved height grid (no bridge / road deck lift). */
function sampleHeightGrid(x: number, z: number): number {
  if (!_heightGrid || _gridNx < 2 || _gridNz < 2) {
    const natural = rawRelief(x, z) * flattenMask(x, z)
    return riverFloodplainY(x, z, natural)
  }
  const u = (x + _gridHalfX) / _gridStepX
  const v = (z + _gridHalfZ) / _gridStepZ
  const x0 = Math.max(0, Math.min(_gridNx - 2, Math.floor(u)))
  const z0 = Math.max(0, Math.min(_gridNz - 2, Math.floor(v)))
  const tx = THREE.MathUtils.clamp(u - x0, 0, 1)
  const tz = THREE.MathUtils.clamp(v - z0, 0, 1)
  const g = _heightGrid
  const i00 = z0 * _gridNx + x0
  const h00 = g[i00]!
  const h10 = g[i00 + 1]!
  const h01 = g[i00 + _gridNx]!
  const h11 = g[i00 + _gridNx + 1]!
  const hx0 = h00 * (1 - tx) + h10 * tx
  const hx1 = h01 * (1 - tx) + h11 * tx
  return hx0 * (1 - tz) + hx1 * tz
}

/**
 * Sample terrain height (m). Matches mesh off-road; on roads / bridge decks
 * rides the dirt ribbon (ROAD_Y) so the path doesn't clip through the hull.
 */
export function forestHeightAt(x: number, z: number): number {
  const h = sampleHeightGrid(x, z)
  if (onRiverBridgeDeck(x, z)) return Math.max(h, ROAD_Y)
  // Packed path surface — keep tracks on the ribbon, not under it.
  if (distToRoads(x, z) < ROAD_WIDTH * 0.55 + 1.5) {
    return Math.max(h, ROAD_Y)
  }
  return h
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

/** Sketch dense forest belt. */
function inDenseForest(x: number, z: number, pad = 1): boolean {
  for (const d of FOREST_DENSE) {
    const nx = (x - d.x) / (d.rx * pad)
    const nz = (z - d.z) / (d.rz * pad)
    if (nx * nx + nz * nz <= 1) return true
  }
  return false
}

function inSpawnPad(x: number, z: number, pad = 1): boolean {
  for (const p of SPAWN_PADS) {
    const nx = (x - p.x) / (p.rx * pad)
    const nz = (z - p.z) / (p.rz * pad)
    if (nx * nx + nz * nz <= 1) return true
  }
  return false
}

function blockedForTree(x: number, z: number): boolean {
  if (onRoadCorridor(x, z)) return true
  if (riverChannel01(x, z) > 0.2) return true
  if (inTownClearing(x, z)) return true
  if (inCropField(x, z)) return true
  if (inOpenScrub(x, z)) return true
  if (inSpawnPad(x, z)) return true
  return false
}

/** Bushes = open-camo: off roads/crops/town cores/spawn; prefer scrub meadows. */
function blockedForBush(x: number, z: number): boolean {
  if (onRoadCorridor(x, z)) return true
  if (riverChannel01(x, z) > 0.25) return true
  if (inCropField(x, z)) return true
  if (inDenseForest(x, z, 0.92)) return true
  for (const town of FOREST_TOWNS) {
    if (Math.hypot(x - town.x, z - town.z) < town.radius * 0.45) return true
  }
  if (inSpawnPad(x, z, 0.85)) return true
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
  return plantBakedPartsFeet(parts)
}

/**
 * Shift all baked parts so the shared plant feet sit at y=0.
 * Returns unit height (max Y after plant).
 */
function plantBakedPartsFeet(parts: PinePart[]): PinePart[] {
  if (parts.length === 0) return parts
  _box.makeEmpty()
  for (const p of parts) {
    p.geometry.computeBoundingBox()
    if (p.geometry.boundingBox) _box.union(p.geometry.boundingBox)
  }
  if (!_box.isEmpty()) {
    const dy = -_box.min.y
    if (Math.abs(dy) > 1e-5) {
      const lift = new THREE.Matrix4().makeTranslation(0, dy, 0)
      for (const p of parts) {
        p.geometry.applyMatrix4(lift)
        p.geometry.computeBoundingBox()
        p.geometry.computeBoundingSphere()
      }
    }
  }
  return parts
}

/** World Y for planting a prop — mesh-matched height, slight sink so no float gap. */
function plantY(x: number, z: number, sink = 0.06): number {
  return forestHeightAt(x, z) - sink
}

type PropPlacement = {
  x: number
  z: number
  yaw: number
  height: number
  /** Optional non-uniform scale (oaks fatten XZ). */
  sx?: number
  sy?: number
  sz?: number
}

/**
 * One InstancedMesh for the whole map never frustum-culls (huge bounding sphere).
 * Bucket into a grid so off-screen / far chunks skip draw — same instance count.
 */
function addChunkedInstances(
  root: THREE.Group,
  name: string,
  parts: PinePart[],
  placements: readonly PropPlacement[],
  unitHeight: number,
  sink: number,
  receiveShadow = false,
  lodRange = LOD_RANGE_TREE,
): number {
  const cells = PROP_CHUNK_CELLS
  const halfX = FOREST_OVERWATCH_WIDTH * 0.5
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.5
  const cellW = FOREST_OVERWATCH_WIDTH / cells
  const cellD = FOREST_OVERWATCH_DEPTH / cells
  const buckets: PropPlacement[][] = Array.from({ length: cells * cells }, () => [])
  for (const pl of placements) {
    const ix = Math.max(0, Math.min(cells - 1, Math.floor((pl.x + halfX) / cellW)))
    const iz = Math.max(0, Math.min(cells - 1, Math.floor((pl.z + halfZ) / cellD)))
    buckets[iz * cells + ix]!.push(pl)
  }

  let draws = 0
  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b]!
    if (list.length === 0) continue
    const ix = b % cells
    const iz = Math.floor(b / cells)
    const cx = -halfX + (ix + 0.5) * cellW
    const cz = -halfZ + (iz + 0.5) * cellD
    for (let p = 0; p < parts.length; p++) {
      const { geometry, material } = parts[p]!
      const mesh = new THREE.InstancedMesh(geometry, material, list.length)
      mesh.name = `${name}_${b}_${p}`
      mesh.castShadow = false
      mesh.receiveShadow = receiveShadow
      mesh.frustumCulled = true
      mesh.matrixAutoUpdate = false
      for (let i = 0; i < list.length; i++) {
        const pl = list[i]!
        const s = pl.height / unitHeight
        _dummy.position.set(pl.x, plantY(pl.x, pl.z, sink), pl.z)
        _dummy.rotation.set(0, pl.yaw, 0)
        _dummy.scale.set(pl.sx ?? s, pl.sy ?? s, pl.sz ?? s)
        _dummy.updateMatrix()
        mesh.setMatrixAt(i, _dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      root.add(mesh)
      registerFoliageLod(mesh, cx, cz, lodRange)
      draws++
    }
  }
  return draws
}

async function placePineTrees(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const gltf = await loadGltfCached(PINE_URL)
  const src = gltf.scene
  uprightAndPlant(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Pine bake produced 0 parts')
    return 0
  }
  // Unit height from planted baked feet
  _box.makeEmpty()
  for (const p of parts) {
    p.geometry.computeBoundingBox()
    if (p.geometry.boundingBox) _box.union(p.geometry.boundingBox)
  }
  const unitHeight = Math.max(_box.max.y - _box.min.y, 0.001)

  const rand = mulberry32(0xf02e57)
  const halfX = FOREST_OVERWATCH_WIDTH * 0.46
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.46
  const placements: Array<{ x: number; z: number; yaw: number; height: number }> =
    []
  let attempts = 0
  const maxAttempts = TREE_COUNT * 18
  const denseTarget = Math.floor(TREE_COUNT * 0.72)
  while (placements.length < TREE_COUNT && attempts < maxAttempts) {
    attempts++
    let x: number
    let z: number
    // Pack most pines into sketch dense belts
    if (placements.length < denseTarget) {
      const belt = FOREST_DENSE[Math.floor(rand() * FOREST_DENSE.length)]!
      const ang = rand() * Math.PI * 2
      const rad = Math.sqrt(rand())
      x = belt.x + Math.cos(ang) * belt.rx * rad
      z = belt.z + Math.sin(ang) * belt.rz * rad
    } else {
      x = (rand() - 0.5) * 2 * halfX
      z = (rand() - 0.5) * 2 * halfZ
      if (!inDenseForest(x, z) && rand() < 0.55) continue
    }
    if (blockedForTree(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 13 + rand() * 8,
    })
  }

  const count = placements.length
  const draws = addChunkedInstances(
    root,
    'forestPine',
    parts,
    placements,
    unitHeight,
    0.1,
    false,
    LOD_RANGE_TREE,
  )

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
      // Soft suspension chatter — wider than the hard trunk stop
      radius: Math.max(1.4, shape.radius * 1.6),
    })
  }

  console.info(
    `[Steel] Forest pines — ${count} instances, ${draws} chunk draws · trunk hard-stop r≤0.95`,
  )
  return count
}

/**
 * Sketchfab oak sits in huge Sketchfab units far below origin — normalize to
 * ~1 m tall with feet at y=0 before bake so instances don't float / jitter.
 */
function normalizeOakTemplate(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  const h = Math.max(_box.max.y - _box.min.y, 0.001)
  const s = 1 / h
  root.scale.multiplyScalar(s)
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  root.position.y -= _box.min.y
  root.updateMatrixWorld(true)
}

/** Leaf cutout + sRGB maps — BLEND leaves go white/invisible on InstancedMesh. */
function hardenOakMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of list) {
      if (!mat || !(mat instanceof THREE.MeshStandardMaterial)) continue
      const name = (mat.name || '').toLowerCase()
      const leaf = /branch|leaf|foliage|projection/i.test(name) || mat.transparent
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace
        mat.map.needsUpdate = true
      }
      mat.side = THREE.DoubleSide
      mat.metalness = 0
      mat.roughness = Math.max(0.75, mat.roughness ?? 0.9)
      // Sketchfab leaf pack ships a bright emissive map → washed / white crowns
      mat.emissive?.setHex(0x000000)
      mat.emissiveIntensity = 0
      mat.emissiveMap = null
      if (leaf) {
        mat.transparent = false
        mat.opacity = 1
        mat.alphaTest = 0.35
        mat.depthWrite = true
        // Slight green tint if albedo failed to bind
        if (!mat.map) mat.color.setHex(0x3a5a28)
      } else if (!mat.map) {
        mat.color.setHex(0x5a4030)
      }
      mat.needsUpdate = true
    }
  })
}

/**
 * Leaf cards hang below the trunk in the Sketchfab oak — planting the full
 * bbox floats the bark. Shift so bark feet sit at y=0.
 */
function plantOakPartsOnBarkFeet(parts: PinePart[]): void {
  _box.makeEmpty()
  let usedBark = false
  for (const p of parts) {
    const name = ((p.material as THREE.Material).name || '').toLowerCase()
    if (!/bark|trunk|wood/i.test(name)) continue
    p.geometry.computeBoundingBox()
    if (p.geometry.boundingBox) {
      _box.union(p.geometry.boundingBox)
      usedBark = true
    }
  }
  if (!usedBark) {
    for (const p of parts) {
      p.geometry.computeBoundingBox()
      if (p.geometry.boundingBox) _box.union(p.geometry.boundingBox)
    }
  }
  if (_box.isEmpty()) return
  const dy = -_box.min.y
  if (Math.abs(dy) < 1e-5) return
  const lift = new THREE.Matrix4().makeTranslation(0, dy, 0)
  for (const p of parts) {
    p.geometry.applyMatrix4(lift)
    p.geometry.computeBoundingBox()
    p.geometry.computeBoundingSphere()
  }
}

async function placeOakTrees(
  root: THREE.Group,
  colliders: PropCollider[],
  contacts: ContactSpot[],
): Promise<number> {
  const gltf = await loadGltfCached(OAK_URL)
  const src = gltf.scene.clone(true)
  uprightAndPlant(src)
  normalizeOakTemplate(src)
  hardenOakMaterials(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Oak bake produced 0 parts')
    return 0
  }
  // Re-harden after bake clones materials
  for (const p of parts) {
    const m = p.material
    if (m instanceof THREE.MeshStandardMaterial) {
      const name = (m.name || '').toLowerCase()
      const leaf = /branch|leaf|foliage|projection/i.test(name)
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace
        m.map.needsUpdate = true
      }
      m.side = THREE.DoubleSide
      m.metalness = 0
      m.emissive?.setHex(0x000000)
      m.emissiveIntensity = 0
      m.emissiveMap = null
      if (leaf || m.transparent) {
        m.transparent = false
        m.opacity = 1
        m.alphaTest = 0.35
        m.depthWrite = true
        if (!m.map) m.color.setHex(0x3a5a28)
      } else if (!m.map) {
        m.color.setHex(0x5a4030)
      }
      m.needsUpdate = true
    }
  }

  // bakePineParts already planted on full bbox — re-anchor on bark only
  plantOakPartsOnBarkFeet(parts)

  _box.makeEmpty()
  for (const p of parts) {
    p.geometry.computeBoundingBox()
    if (p.geometry.boundingBox) _box.union(p.geometry.boundingBox)
  }
  const unitHeight = Math.max(_box.max.y - _box.min.y, 0.001)

  const rand = mulberry32(0x0a7ee5)
  const halfX = FOREST_OVERWATCH_WIDTH * 0.46
  const halfZ = FOREST_OVERWATCH_DEPTH * 0.46
  const placements: Array<{ x: number; z: number; yaw: number; height: number }> =
    []
  let attempts = 0
  const maxAttempts = OAK_COUNT * 18
  const denseTarget = Math.floor(OAK_COUNT * 0.7)
  while (placements.length < OAK_COUNT && attempts < maxAttempts) {
    attempts++
    let x: number
    let z: number
    if (placements.length < denseTarget) {
      const belt = FOREST_DENSE[Math.floor(rand() * FOREST_DENSE.length)]!
      const ang = rand() * Math.PI * 2
      const rad = Math.sqrt(rand())
      x = belt.x + Math.cos(ang) * belt.rx * rad * 0.95
      z = belt.z + Math.sin(ang) * belt.rz * rad * 0.95
    } else {
      x = (rand() - 0.5) * 2 * halfX
      z = (rand() - 0.5) * 2 * halfZ
    }
    if (blockedForTree(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 11 + rand() * 7,
    })
  }

  const OAK_SINK = 1.15
  const oakPlacements: PropPlacement[] = placements.map((pl, i) => {
    const s = pl.height / unitHeight
    const fat = 1.12 + (i % 5) * 0.03
    return {
      x: pl.x,
      z: pl.z,
      yaw: pl.yaw,
      height: pl.height,
      sx: s * fat,
      sy: s,
      sz: s * fat,
    }
  })
  const count = oakPlacements.length
  const draws = addChunkedInstances(
    root,
    'forestOak',
    parts,
    oakPlacements,
    unitHeight,
    OAK_SINK,
    false,
    LOD_RANGE_TREE,
  )

  // Trunk hard-stop only (was 1.6–2.8 m → invisible canopy walls in dense belts)
  for (const pl of oakPlacements) {
    const shape = estimatePropCollider('tree', pl.height)
    const radius = THREE.MathUtils.clamp(shape.radius * 1.2, 0.65, 1.15)
    colliders.push({
      x: pl.x,
      z: pl.z,
      radius,
      maxY: shape.maxY,
    })
    contacts.push({
      x: pl.x,
      z: pl.z,
      radius: Math.max(1.6, radius * 1.55),
    })
  }

  console.info(
    `[Steel] Forest oaks — ${count} instances, ${draws} chunk draws · bark-anchored · trunk hard-stop r≤1.15`,
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
  uprightAndPlant(src)
  const parts = bakePineParts(src)

  if (parts.length === 0) {
    console.warn('[Steel] Bush bake produced 0 parts')
    return 0
  }
  _box.makeEmpty()
  for (const p of parts) {
    p.geometry.computeBoundingBox()
    if (p.geometry.boundingBox) _box.union(p.geometry.boundingBox)
  }
  const unitHeight = Math.max(_box.max.y - _box.min.y, 0.001)

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

  // Pack hard into scrub meadows (same bush GLB — scale/yaw only)
  const scrubTarget = Math.floor(BUSH_COUNT * 0.88)
  let scrubAttempts = 0
  const maxScrubAttempts = scrubTarget * 28
  while (placements.length < scrubTarget && scrubAttempts < maxScrubAttempts) {
    scrubAttempts++
    const scrub = FOREST_OPEN_SCRUB[Math.floor(rand() * FOREST_OPEN_SCRUB.length)]!
    const ang = rand() * Math.PI * 2
    const r = Math.sqrt(rand())
    const x = scrub.x + Math.cos(ang) * r * scrub.rx * 0.98
    const z = scrub.z + Math.sin(ang) * r * scrub.rz * 0.98
    if (blockedForBush(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 2.6 + rand() * 3.4,
    })
  }

  // Light rural scatter for the rest
  let attempts = 0
  const maxAttempts = BUSH_COUNT * 22
  while (placements.length < BUSH_COUNT && attempts < maxAttempts) {
    attempts++
    const x = (rand() - 0.5) * 2 * halfX
    const z = (rand() - 0.5) * 2 * halfZ
    if (blockedForBush(x, z)) continue
    placements.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      height: 2.4 + rand() * 3.0,
    })
  }

  const bushPlacements: PropPlacement[] = placements.map((pl, i) => {
    const s = pl.height / unitHeight
    // Wide scale jitter so one mesh reads as a mixed thicket
    const fat = 1.15 + (i % 7) * 0.14 + rand() * 0.2
    const tall = 0.85 + (i % 4) * 0.12 + rand() * 0.15
    return {
      x: pl.x,
      z: pl.z,
      yaw: pl.yaw,
      height: pl.height,
      sx: s * fat,
      sy: s * tall,
      sz: s * fat * (0.9 + (i % 3) * 0.08),
    }
  })
  const count = bushPlacements.length
  const draws = addChunkedInstances(
    root,
    'forestBush',
    parts,
    bushPlacements,
    unitHeight,
    0.08,
    false,
    LOD_RANGE_BUSH,
  )

  // Sparse AO discs (every 3rd) — same bushes, fewer transparent quads
  for (let i = 0; i < bushPlacements.length; i += 3) {
    const pl = bushPlacements[i]!
    contacts.push({
      x: pl.x,
      z: pl.z,
      radius: Math.max(1.2, pl.height * 0.55),
    })
  }

  console.info(
    `[Steel] Forest bushes — ${count} instances · ${draws} chunk draws · 1 GLB scale/yaw · ${FOREST_OPEN_SCRUB.length} scrub meadows`,
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

    // ~1 tile across width, ~1 tile per 18 m along path (seamless V texture)
    const v = dist / 18
    uvs[iL * 2] = 0
    uvs[iL * 2 + 1] = v
    uvs[iR * 2] = 1
    uvs[iR * 2 + 1] = v

    if (i < n - 1) {
      const a = iL
      const b = iR
      const c = (i + 1) * 2
      const d = (i + 1) * 2 + 1
      // CCW from above → +Y normals (FrontSide roads stay visible)
      indices.push(a, b, c, b, d, c)
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
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xe8d4b0,
    roughness: 0.97,
    metalness: 0.02,
    envMapIntensity: 0,
    transparent: true,
    depthWrite: true,
    // DoubleSide — path tangents flip; FrontSide culled half the map
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

function loadRoadSkirtMaterial(): THREE.MeshStandardMaterial {
  const map = createGravelShoulderTexture(1, 1)
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
    // Micro Y stagger so crossing ribbons don't z-fight (junction flicker)
    const yBias = (i % 5) * 0.004

    // Gravel/dirt shoulder under the packed path (wider, slightly lower)
    const skirt = makeRoadRibbon(line, ROAD_SKIRT_WIDTH, skirtMat, `roadSkirt_${i}`, {
      y: ROAD_Y - 0.028 + yBias,
    })
    if (skirt) {
      roads.add(skirt)
      skirtCount++
    }

    const ribbon = makeRoadRibbon(line, ROAD_WIDTH, mat, `roadRibbon_${i}`, {
      y: ROAD_Y + yBias,
    })
    if (ribbon) {
      roads.add(ribbon)
      ribbonCount++
    }

    // Soft dual tire ruts (lift + polygonOffset vs dirt bed)
    const rutL = makeRoadRibbon(line, ROAD_RUT_WIDTH, rutMat, `roadRutL_${i}`, {
      y: ROAD_Y + 0.016 + yBias,
      lateral: -ROAD_RUT_HALF,
    })
    const rutR = makeRoadRibbon(line, ROAD_RUT_WIDTH, rutMat, `roadRutR_${i}`, {
      y: ROAD_Y + 0.016 + yBias,
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
  clone.position.set(x, plantY(x, z, 0.05), z)
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
  const floor = createRuralMixedFloorMaps(
    Math.max(56, FOREST_OVERWATCH_WIDTH / 7),
    Math.max(72, FOREST_OVERWATCH_DEPTH / 10),
  )
  if (mat.map && mat.map !== floor.map) mat.map.dispose()
  if (mat.normalMap && mat.normalMap !== floor.normalMap) mat.normalMap.dispose()
  if (mat.roughnessMap && mat.roughnessMap !== floor.roughnessMap) {
    mat.roughnessMap.dispose()
  }
  mat.map = floor.map
  mat.normalMap = floor.normalMap
  mat.normalScale = new THREE.Vector2(1.15, 1.15)
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
        if (riverChannel01(x, z) > 0.18) continue
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
      mesh.receiveShadow = false
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
  // Build discrete grid first so mesh verts + props share the same surface.
  rebuildHeightGrid()

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
    // Carved mesh (gap under road ribbons); drive sampler lifts bridge decks.
    const y = sampleHeightGrid(x, z)
    pos.setY(i, y)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    const relief = rawRelief(x, z)
    sampleForestGroundTint(x, z, tint, relief)
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
    } else if (inCropField(x, z, 1.15)) {
      // Farm pads read as tilled dirt under stalks (paths unchanged)
      tint.r = THREE.MathUtils.lerp(tint.r, 0.95, 0.55)
      tint.g = THREE.MathUtils.lerp(tint.g, 0.72, 0.55)
      tint.b = THREE.MathUtils.lerp(tint.b, 0.42, 0.55)
    }
    // Muddy banks along the river cut
    const bank = riverChannel01(x, z)
    if (bank > 0.05) {
      const mud = Math.min(1, bank * 1.15)
      tint.r = THREE.MathUtils.lerp(tint.r, 0.42, mud * 0.75)
      tint.g = THREE.MathUtils.lerp(tint.g, 0.38, mud * 0.7)
      tint.b = THREE.MathUtils.lerp(tint.b, 0.28, mud * 0.55)
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
    `[Steel] Forest terrain — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH} · ${TERRAIN_SEG_X}×${TERRAIN_SEG_Z} · y[${minY.toFixed(2)}…${maxY.toFixed(2)}] · rough off-road · mixed grass/dirt/rock · path flat · river cut · clearings ${FOREST_TOWNS.map((t) => t.name).join(', ')}`,
  )
  return mesh
}

/**
 * Water ribbon in the cleared floodplain channel (fixed Y — land is flat here).
 */
function placeRiverWater(root: THREE.Group): THREE.Mesh | null {
  const pts = RIVER_POLYLINE
  if (pts.length < 2) return null
  const half = RIVER_HALF_W * 0.96
  const n = pts.length
  const positions = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const indices: number[] = []
  let dist = 0
  const y = RIVER_WATER_Y

  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(n - 1, i + 1)]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    const nx = -tz
    const nz = tx
    if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z)

    const iL = i * 2
    const iR = i * 2 + 1
    positions[iL * 3] = p.x + nx * half
    positions[iL * 3 + 1] = y
    positions[iL * 3 + 2] = p.z + nz * half
    positions[iR * 3] = p.x - nx * half
    positions[iR * 3 + 1] = y
    positions[iR * 3 + 2] = p.z - nz * half

    const v = dist / 14
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

  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a5664,
    roughness: 0.28,
    metalness: 0.22,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
    side: THREE.DoubleSide,
    envMapIntensity: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'forestRiverWater'
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.renderOrder = 1
  root.add(mesh)
  console.info(
    `[Steel] Forest river — flat floodplain Y=${RIVER_FLOOR} · channel ${RIVER_CHANNEL}m · water Y=${RIVER_WATER_Y.toFixed(2)} · shelf ${RIVER_SHELF}m · ${pts.length} segs · bridges ${BRIDGE_SITES.length}`,
  )
  return mesh
}

type BridgeMats = {
  deck: THREE.MeshStandardMaterial
  rail: THREE.MeshStandardMaterial
  pier: THREE.MeshStandardMaterial
}

function loadBridgeMaterials(): BridgeMats {
  const deckMap = createBridgeConcreteTexture(1, 1)
  deckMap.anisotropy = 8
  const pierMap = createBridgeConcreteTexture(1, 1)
  pierMap.anisotropy = 6
  // Offset so piers don't tile identically to the deck.
  pierMap.offset.set(0.37, 0.21)
  const steelMap = createBridgeSteelTexture(1, 1)
  steelMap.anisotropy = 6

  return {
    deck: new THREE.MeshStandardMaterial({
      map: deckMap,
      color: 0xd8d4c8,
      roughness: 0.92,
      metalness: 0.06,
      envMapIntensity: 0.35,
    }),
    rail: new THREE.MeshStandardMaterial({
      map: steelMap,
      color: 0xc4c2b8,
      roughness: 0.72,
      metalness: 0.45,
      envMapIntensity: 0.5,
    }),
    pier: new THREE.MeshStandardMaterial({
      map: pierMap,
      color: 0xc8c2b4,
      roughness: 0.96,
      metalness: 0.04,
      envMapIntensity: 0.3,
    }),
  }
}

/** Tile UVs so ~4 m of concrete / steel per repeat on a box face. */
function tileBoxUVs(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  if (!uv) return
  // BoxGeometry face order: +X −X +Y −Y +Z −Z — each 4 verts.
  const faceScale: Array<[number, number]> = [
    [sz / 4, sy / 4],
    [sz / 4, sy / 4],
    [sx / 4, sz / 4],
    [sx / 4, sz / 4],
    [sx / 4, sy / 4],
    [sx / 4, sy / 4],
  ]
  for (let f = 0; f < 6; f++) {
    const [ru, rv] = faceScale[f]!
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i
      uv.setXY(idx, uv.getX(idx) * ru, uv.getY(idx) * rv)
    }
  }
  uv.needsUpdate = true
}

/** Textured concrete deck + steel rails — long axis on road, narrow as the path. */
function placeBridgeAt(
  parent: THREE.Group,
  site: BridgeSite,
  index: number,
  mats: BridgeMats,
): void {
  const g = new THREE.Group()
  g.name = `forestBridge_${index}`
  g.position.set(site.x, 0, site.z)
  g.rotation.y = site.yaw

  // Local +X = along road (span over water); local +Z = across road (narrow).
  const along = site.span
  const across = ROAD_WIDTH + 1.2
  const deckH = 0.55
  const deckGeo = new THREE.BoxGeometry(along, deckH, across)
  tileBoxUVs(deckGeo, along, deckH, across)
  const deck = new THREE.Mesh(deckGeo, mats.deck)
  deck.position.y = ROAD_Y + 0.28
  deck.receiveShadow = true
  deck.castShadow = false
  g.add(deck)

  // Side rails along the span (outer edges across the road)
  for (const side of [-1, 1]) {
    const rw = along * 0.96
    const rh = 1.05
    const rl = 0.32
    const railGeo = new THREE.BoxGeometry(rw, rh, rl)
    tileBoxUVs(railGeo, rw, rh, rl)
    const rail = new THREE.Mesh(railGeo, mats.rail)
    rail.position.set(0, ROAD_Y + 0.95, side * (across * 0.5 - 0.2))
    g.add(rail)
  }

  // End abutments on the banks (ends of the span)
  for (const end of [-1, 1]) {
    const pw = 2.2
    const ph = 3.2
    const pl = across + 0.8
    const pierGeo = new THREE.BoxGeometry(pw, ph, pl)
    tileBoxUVs(pierGeo, pw, ph, pl)
    const pier = new THREE.Mesh(pierGeo, mats.pier)
    pier.position.set(end * (along * 0.5 - 1.0), ROAD_Y - 1.2, 0)
    g.add(pier)
  }

  parent.add(g)
}

function placeBridges(root: THREE.Group): number {
  const group = new THREE.Group()
  group.name = 'ForestBridges'
  root.add(group)
  const mats = loadBridgeMaterials()
  for (let i = 0; i < BRIDGE_SITES.length; i++) {
    placeBridgeAt(group, BRIDGE_SITES[i]!, i, mats)
  }
  console.info(
    `[Steel] Forest bridges — ${BRIDGE_SITES.length} textured · ` +
      BRIDGE_SITES.map(
        (s, i) =>
          `#${i + 1} (${s.x.toFixed(0)},${s.z.toFixed(0)}) span ${s.span.toFixed(0)}m`,
      ).join(' · '),
  )
  return BRIDGE_SITES.length
}

/**
 * Forest Overwatch — rolling floor, 3 flat clearings, modular roads, pines.
 */
export async function loadForestOverwatch(
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<ForestMapLoadResult> {
  void preloadUrls(FOREST_PROP_URLS)
  clearFoliageLod()
  // Heightfield replaces the shared flat ground plane
  ground.visible = false

  const root = new THREE.Group()
  root.name = 'ForestOverwatch'
  scene.add(root)

  buildForestTerrain(root)
  placeRiverWater(root)

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
  const bridgeCount = placeBridges(root)

  const [treeCount, oakCount, bushCount, ruinCount, carCount] = await Promise.all([
    placePineTrees(root, colliders, contacts).catch((err) => {
      console.warn('[Steel] Forest pine trees failed to load', err)
      return 0
    }),
    placeOakTrees(root, colliders, contacts).catch((err) => {
      console.warn('[Steel] Forest oak trees failed to load', err)
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
    `[Steel] Forest Overwatch — ${FOREST_OVERWATCH_WIDTH}×${FOREST_OVERWATCH_DEPTH}m, ${roadTiles} road tiles, ${bridgeCount} bridges, ${treeCount} pines, ${oakCount} oaks, ${bushCount} bushes, ${ruinCount} houses, ${carCount} wrecks, ${blobCount} contact blobs, ${FOREST_TOWNS.length} clearings, ${crops.fields} crop fields (${crops.stalks} stalks), ${colliders.length} colliders · LOD chunks ${_foliageLod.length} (bush≤${LOD_RANGE_BUSH}m tree≤${LOD_RANGE_TREE}m)`,
  )
  // Subsample densified ribbon so the minimap path stays light
  const riverPts: Array<{ x: number; z: number }> = []
  const step = Math.max(1, Math.floor(RIVER_POLYLINE.length / 48))
  for (let i = 0; i < RIVER_POLYLINE.length; i += step) {
    const p = RIVER_POLYLINE[i]!
    riverPts.push({ x: p.x, z: p.z })
  }
  const lastR = RIVER_POLYLINE[RIVER_POLYLINE.length - 1]!
  if (
    riverPts.length === 0 ||
    riverPts[riverPts.length - 1]!.x !== lastR.x ||
    riverPts[riverPts.length - 1]!.z !== lastR.z
  ) {
    riverPts.push({ x: lastR.x, z: lastR.z })
  }

  return {
    root,
    colliders,
    groundY: 0,
    heightAt: forestHeightAt,
    paths,
    rivers: riverPts.length >= 2 ? [{ points: riverPts }] : undefined,
    updateLod: updateForestLod,
  }
}
