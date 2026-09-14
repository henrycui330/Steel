import * as THREE from 'three'
import { createTrackTreadTexture } from './textures'

export type TrackBand = {
  mesh: THREE.Mesh
  side: 'left' | 'right' | 'both'
  /** Which UV axis to scroll (along tread run). */
  uv: 'u' | 'v'
  maps: THREE.Texture[]
  /** World meters represented by one full UV repeat along the tread. */
  metersPerUvRepeat: number
}

export type CollectTracksOptions = {
  /**
   * When true (Germany pass), also infer track materials on Hull meshes
   * that lack “track” in the name (Leo 2 UUIDs, baked Pz IV, etc.).
   */
  hullInference?: boolean
}

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()

/** Fine tune if baked albedo repeats more than once per side. */
const TRACK_SCROLL_GAIN = 1.05

/** Estimate how many world meters one UV cycle covers on this mesh. */
function estimateMetersPerUvRepeat(mesh: THREE.Mesh, hullSlice: boolean): number {
  _box.setFromObject(mesh)
  _box.getSize(_size)
  const alongZ = _size.z
  const alongX = _size.x
  if (hullSlice) {
    // Track material on full hull — UV strip ≈ side run, not whole bbox diagonal
    const run = Math.max(alongZ, alongX * 0.55)
    return THREE.MathUtils.clamp(run * 0.38, 2.4, 5.5)
  }
  const run = Math.max(alongZ, alongX)
  return THREE.MathUtils.clamp(run * 0.88, 2.0, 8.0)
}

/** Material / node names that mean treads. */
const TRACK_NAME_RE =
  /track|tread|kette|chain|panther-a-track|pzh_2000tracks|m1-tank-track/i

/** Baked Pz IV hull — unique Image_1 sheet is the tread (Material_5937). */
const FORCE_TRACK_MAT = new Set(['material_5937'])

function sideOfTrack(obj: THREE.Object3D, matName?: string): 'left' | 'right' | 'both' {
  const n = `${obj.name} ${matName ?? ''}`.toLowerCase()
  if (n.includes('left') || n.includes('_l') || /track1\b/.test(n) || /\.001\b/.test(n)) {
    return 'left'
  }
  if (n.includes('right') || n.includes('_r') || /track2\b/.test(n) || /\.002\b/.test(n)) {
    return 'right'
  }
  // Leo 1: tank_track / .001 / .002 / .003 — treat odd/even as L/R for differential
  const m = n.match(/track(?:\.|_)?0*(\d+)/)
  if (m) {
    const idx = Number(m[1])
    return idx % 2 === 0 ? 'left' : 'right'
  }
  obj.updateWorldMatrix(true, false)
  _box.setFromObject(obj)
  _box.getCenter(_center)
  if (_center.x < -0.2) return 'left'
  if (_center.x > 0.2) return 'right'
  return 'both'
}

function matNameLooksTrack(name: string): boolean {
  const n = name.toLowerCase()
  if (FORCE_TRACK_MAT.has(n)) return true
  return TRACK_NAME_RE.test(n)
}

function getMatMap(m: THREE.Material): THREE.Texture | null {
  if (m instanceof THREE.MeshStandardMaterial) return m.map
  if (m instanceof THREE.MeshBasicMaterial) return m.map
  return null
}

/** Shared albedo used 2–4× on one mesh → usually L/R (or multi) tread sheets. */
function inferTrackIndicesBySharedMap(mats: THREE.Material[]): number[] {
  const byMap = new Map<string, number[]>()
  mats.forEach((m, i) => {
    const map = getMatMap(m)
    if (!map) return
    const list = byMap.get(map.uuid) ?? []
    list.push(i)
    byMap.set(map.uuid, list)
  })
  for (const indices of byMap.values()) {
    if (indices.length === 2) return indices
  }
  for (const indices of byMap.values()) {
    if (indices.length >= 3 && indices.length <= 4) return indices
  }
  return []
}

/**
 * Minority albedo (used once) while another map dominates the hull —
 * typical baked tread sheet (Pz IV Material_5937).
 */
function inferTrackIndicesByMinorityMap(mats: THREE.Material[]): number[] {
  const byMap = new Map<string, number[]>()
  mats.forEach((m, i) => {
    const map = getMatMap(m)
    if (!map) return
    const list = byMap.get(map.uuid) ?? []
    list.push(i)
    byMap.set(map.uuid, list)
  })
  let hasMajority = false
  const minority: number[] = []
  for (const indices of byMap.values()) {
    if (indices.length >= 3) hasMajority = true
    if (indices.length === 1) minority.push(indices[0]!)
  }
  if (hasMajority && minority.length >= 1 && minority.length <= 2) return minority
  return []
}

function isDedicatedTrackMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  if (!(obj instanceof THREE.Mesh) || !obj.geometry) return false
  const n = (obj.name || '').toLowerCase()
  if (!n) return false
  if (/wheel|tire|sprocket|idler|bogie|suspension|roller/.test(n) && !/tread|track/.test(n)) {
    return false
  }
  const looksTrack =
    /^tracks?$/.test(n) ||
    /^tread/.test(n) ||
    /^chain$/.test(n) ||
    /tread[_-]?(left|right)/.test(n) ||
    /track\d/.test(n) ||
    /m1-tank-track/.test(n) ||
    /pzh_2000tracks/.test(n) ||
    (n.includes('track') && !/trackmark|attract|soundtrack/.test(n))
  if (!looksTrack) return false

  _box.setFromObject(obj)
  _box.getSize(_size)
  const longest = Math.max(_size.x, _size.y, _size.z)
  if (longest < 0.8) return false
  return true
}

function pickUvAxis(_mesh: THREE.Mesh): 'u' | 'v' {
  // Tread albedo almost always runs along V (along-track). Scrolling U looks
  // like left/right sliding across the pads — wrong for every DE hull so far.
  return 'v'
}

/** Base tint — near white so the generated tread map carries the black/gray. */
const TRACK_TINT = new THREE.Color(0xffffff)

function applyTrackTreadLook(mat: THREE.Material): THREE.Texture[] {
  const tread = createTrackTreadTexture().clone()
  tread.wrapS = THREE.RepeatWrapping
  tread.wrapT = THREE.RepeatWrapping
  tread.repeat.copy(createTrackTreadTexture().repeat)
  tread.needsUpdate = true

  if (mat instanceof THREE.MeshStandardMaterial) {
    mat.map = tread
    mat.color.copy(TRACK_TINT)
    mat.metalness = 0.06
    mat.roughness = 0.94
    mat.envMapIntensity = 0
    // Drop baked maps that fight the cleat pattern
    mat.normalMap = null
    mat.roughnessMap = null
    mat.metalnessMap = null
    mat.aoMap = null
    mat.needsUpdate = true
    return [tread]
  }
  if (mat instanceof THREE.MeshBasicMaterial) {
    mat.map = tread
    mat.color.copy(TRACK_TINT)
    mat.needsUpdate = true
    return [tread]
  }
  return []
}

function cloneScrollTextures(mat: THREE.Material): {
  mat: THREE.Material
  maps: THREE.Texture[]
} | null {
  if (mat instanceof THREE.MeshStandardMaterial) {
    const cloned = mat.clone()
    const maps = applyTrackTreadLook(cloned)
    return { mat: cloned, maps }
  }
  if (mat instanceof THREE.MeshBasicMaterial) {
    const cloned = mat.clone()
    const maps = applyTrackTreadLook(cloned)
    return { mat: cloned, maps }
  }
  return null
}

/**
 * Scroll only selected material slots on a (often multi-material) mesh.
 */
function bindTrackMaterials(
  mesh: THREE.Mesh,
  indices: number[],
): { maps: THREE.Texture[]; side: 'left' | 'right' | 'both' } | null {
  const mats = Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material]
  const allMaps: THREE.Texture[] = []
  let side: 'left' | 'right' | 'both' = 'both'
  let got = false

  for (const i of indices) {
    const src = mats[i]
    if (!src) continue
    const prepared = cloneScrollTextures(src)
    if (!prepared) continue
    mats[i] = prepared.mat
    allMaps.push(...prepared.maps)
    const s = sideOfTrack(mesh, src.name)
    if (side === 'both') side = s
    else if (s !== 'both' && s !== side) side = 'both'
    got = true
  }

  if (!got) return null
  mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!
  return { maps: allMaps, side }
}

function trackIndicesForMesh(
  mesh: THREE.Mesh,
  hullInference: boolean,
): number[] {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const named: number[] = []
  mats.forEach((m, i) => {
    if (m?.name && matNameLooksTrack(m.name)) named.push(i)
  })
  if (named.length > 0) return named

  if (!hullInference) return []
  const n = mesh.name.toLowerCase()
  if (n !== 'hull' && n !== 'chassis' && !n.includes('hull')) return []

  const shared = inferTrackIndicesBySharedMap(mats)
  if (shared.length > 0) return shared
  return inferTrackIndicesByMinorityMap(mats)
}

/**
 * Collect tread bands: dedicated track meshes + track materials on hulls.
 */
export function collectTracks(
  root: THREE.Object3D,
  opts: CollectTracksOptions = {},
): TrackBand[] {
  const hullInference = opts.hullInference ?? false
  root.updateMatrixWorld(true)
  const bands: TrackBand[] = []
  const seen = new Set<string>()

  const pushBand = (
    mesh: THREE.Mesh,
    indices: number[] | 'all',
    label: string,
    hullSlice = false,
  ) => {
    const key = `${mesh.uuid}:${indices === 'all' ? 'all' : indices.join(',')}`
    if (seen.has(key)) return
    seen.add(key)

    let maps: THREE.Texture[]
    let side: 'left' | 'right' | 'both'
    if (indices === 'all') {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const idx = mats.map((_, i) => i)
      const bound = bindTrackMaterials(mesh, idx)
      if (!bound) {
        console.info(`[Steel] Tracks: skip ${label} (no bindable mat)`)
        return
      }
      maps = bound.maps
      side = bound.side
    } else {
      const bound = bindTrackMaterials(mesh, indices)
      if (!bound) {
        console.info(`[Steel] Tracks: skip ${label} (no bindable mat)`)
        return
      }
      maps = bound.maps
      side = bound.side
    }

    bands.push({
      mesh,
      side,
      uv: pickUvAxis(mesh),
      maps,
      metersPerUvRepeat: estimateMetersPerUvRepeat(mesh, hullSlice),
    })
  }

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return

    // 1) Dedicated track / tread / chain meshes (Pz3 Tracks, PzH tread_*, Abrams…)
    if (isDedicatedTrackMesh(obj)) {
      pushBand(obj, 'all', obj.name, false)
      return
    }

    // 2) Multi-material hull with track materials (Tiger, Leo 1, Leo 2, Pz IV)
    const indices = trackIndicesForMesh(obj, hullInference)
    if (indices.length > 0) {
      pushBand(obj, indices, `${obj.name} mats[${indices.join(',')}]`, true)
    }
  })

  console.info(
    `[Steel] Tracks: ${bands.length} band(s) — ` +
      (bands
        .map(
          (b) =>
            `${b.mesh.name}[${b.side}] pitch≈${b.metersPerUvRepeat.toFixed(1)}m`,
        )
        .join(', ') || 'none') +
      (hullInference ? ' · DE hull-inference on' : ''),
  )
  return bands
}

/**
 * Scroll tread UVs from drive speed. Turn adds L/R differential.
 */
export function updateTracks(
  bands: TrackBand[],
  dt: number,
  speed: number,
  turn: number,
): void {
  if (bands.length === 0) return
  const diff = turn * Math.max(1.2, Math.abs(speed) * 0.35 + 1.8)
  const leftSpeed = speed - diff
  const rightSpeed = speed + diff

  for (const b of bands) {
    let v = speed
    if (b.side === 'left') v = leftSpeed
    else if (b.side === 'right') v = rightSpeed
    // UV scroll rate = track speed / tread pitch (m per UV cycle)
    const pitch = Math.max(0.8, b.metersPerUvRepeat)
    const delta = (-v * dt * TRACK_SCROLL_GAIN) / pitch
    for (const map of b.maps) {
      if (b.uv === 'u') map.offset.x = (map.offset.x + delta) % 1
      else map.offset.y = (map.offset.y + delta) % 1
    }
  }
}
