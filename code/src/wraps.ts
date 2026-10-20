import * as THREE from 'three'
import { assetUrl, fixPublicUrl } from './assetUrl'
import { loadTextureCached } from './loadGltf'

export type WrapId = 'stock' | 'china' | 'desert' | 'nato' | 'us' | 'patriotic'

export type WrapOption = {
  id: WrapId
  name: string
  blurb: string
  /** Public URL, or null for factory paint (no camo map). */
  url: string | null
}

const STORAGE_KEY = 'steel.wrapId'

export const WRAP_OPTIONS: WrapOption[] = [
  {
    id: 'stock',
    name: 'Factory paint',
    blurb: 'Stock dunkelgrau · no camo wrap',
    url: null,
  },
  {
    id: 'china',
    name: 'China camo',
    blurb: 'PLA digital pattern',
    url: assetUrl('wraps/china-camo.webp'),
  },
  {
    id: 'desert',
    name: 'Desert camo',
    blurb: 'Sand / dust theatre',
    url: assetUrl('wraps/desert-camo.webp'),
  },
  {
    id: 'nato',
    name: 'NATO camo',
    blurb: 'Woodland NATO scheme',
    url: assetUrl('wraps/nato-camo.jpeg'),
  },
  {
    id: 'us',
    name: 'US camo',
    blurb: 'US MERDC / woodland',
    url: assetUrl('wraps/us-camo.webp'),
  },
  {
    id: 'patriotic',
    name: 'Patriotic',
    blurb: 'Stars and stripes energy',
    url: assetUrl('wraps/patriotic.webp'),
  },
]

export function wrapOptionById(id: WrapId): WrapOption {
  return WRAP_OPTIONS.find((w) => w.id === id) ?? WRAP_OPTIONS[0]!
}

export function getSelectedWrapId(): WrapId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && WRAP_OPTIONS.some((w) => w.id === raw)) return raw as WrapId
  } catch {
    /* private mode */
  }
  return 'stock'
}

export function setSelectedWrapId(id: WrapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* private mode */
  }
  console.info('[Steel] Wrap selected:', id)
}

/** Pull wrap from account profile into the active selection (login / session restore). */
export function syncWrapFromProfile(wrapId: WrapId | string | undefined): WrapId {
  const id =
    wrapId && WRAP_OPTIONS.some((w) => w.id === wrapId) ? (wrapId as WrapId) : 'stock'
  setSelectedWrapId(id)
  return id
}

const textureCache = new Map<string, Promise<THREE.Texture>>()

function loadWrapTexture(url: string): Promise<THREE.Texture> {
  let pending = textureCache.get(url)
  if (!pending) {
    pending = (async () => {
      const base = await loadTextureCached(url)
      const tex = base.clone()
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(2.4, 2.4)
      tex.anisotropy = 4
      tex.needsUpdate = true
      return tex
    })()
    textureCache.set(url, pending)
  }
  return pending
}

function isSkippedPart(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('track') ||
    n.includes('tread') ||
    n.includes('kette') ||
    n.includes('wheel') ||
    n.includes('tire') ||
    n.includes('tyre') ||
    n.includes('chain')
  )
}

function isTrackMaterialName(name: string | undefined): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  return (
    /track|tread|kette|chain|panther-a-track|pzh_2000tracks|m1-tank-track/i.test(n) ||
    n === 'material_5937'
  )
}

function isAccessoryMesh(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj
  while (p) {
    if (p.name === 'tankAccessories' || p.userData?.accessoryId) return true
    p = p.parent
  }
  return false
}

/** Stable key for selective wrap picks (shared names toggle together). */
export function meshWrapKey(mesh: THREE.Mesh): string {
  const n = mesh.name?.trim()
  if (n) return n
  return `anon:${mesh.uuid}`
}

/** True when this mesh can receive a camo wrap (not tracks / accessories). */
export function isWrapPaintableMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  if (!(obj instanceof THREE.Mesh) || !obj.material) return false
  if (isAccessoryMesh(obj)) return false
  if (isSkippedPart(obj.name)) return false
  return true
}

/** All paintable mesh keys under a tank root (unique, stable order). */
export function listPaintableWrapKeys(root: THREE.Object3D): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  root.traverse((obj) => {
    if (!isWrapPaintableMesh(obj)) return
    const key = meshWrapKey(obj)
    if (seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out
}

const STOCK_MATS_KEY = 'wrapStockMats'

function cloneMats(src: THREE.Material[]): THREE.Material[] {
  return src.map((m) => m.clone())
}

function ensureStockMats(mesh: THREE.Mesh): THREE.Material[] {
  const cached = mesh.userData[STOCK_MATS_KEY] as THREE.Material[] | undefined
  if (cached?.length) return cached
  const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const stock = cloneMats(src.filter(Boolean) as THREE.Material[])
  mesh.userData[STOCK_MATS_KEY] = stock
  return stock
}

function restoreStockMats(mesh: THREE.Mesh): void {
  const stock = ensureStockMats(mesh)
  const next = cloneMats(stock)
  mesh.material = next.length === 1 ? next[0]! : next
}

export type ApplyTankWrapOpts = {
  /**
   * When set, only these mesh keys receive the camo map.
   * `null` / omitted = paint every paintable mesh (legacy full wrap).
   */
  onlyKeys?: readonly string[] | null
}

/**
 * Apply the player's chosen wrap to a tank root (player only).
 * Restores factory materials first, then paints selected (or all) parts.
 * `stock` leaves factory / dunkelgrau paint alone.
 */
export async function applyTankWrap(
  root: THREE.Object3D,
  wrapId: WrapId = getSelectedWrapId(),
  opts?: ApplyTankWrapOpts,
): Promise<void> {
  // Always restore stock first so selective toggles / wrap swaps don't stack.
  root.traverse((obj) => {
    if (!isWrapPaintableMesh(obj)) return
    restoreStockMats(obj)
  })

  const opt = wrapOptionById(wrapId)
  if (!opt.url) {
    console.info('[Steel] Wrap: stock paint')
    return
  }

  let map: THREE.Texture
  try {
    map = await loadWrapTexture(fixPublicUrl(opt.url))
  } catch (err) {
    console.warn('[Steel] Wrap texture failed', opt.url, err)
    return
  }

  const allow =
    opts?.onlyKeys != null ? new Set(opts.onlyKeys) : null

  let painted = 0
  root.traverse((obj) => {
    if (!isWrapPaintableMesh(obj)) return
    const key = meshWrapKey(obj)
    if (allow && !allow.has(key)) return

    const stock = ensureStockMats(obj)
    const next = stock.map((m) => {
      if (!m) return m
      // Keep rubber tracks black — never wrap tread materials on hull multi-mats
      if (isTrackMaterialName(m.name)) return m.clone()
      const mat = m.clone() as THREE.MeshStandardMaterial
      if ('map' in mat) {
        mat.map = map
        if ('color' in mat && mat.color) mat.color.set(0xffffff)
        // Old normal / ORM maps stay in UV space 1 and tint large roof plates.
        mat.normalMap = null
        mat.roughnessMap = null
        mat.metalnessMap = null
        mat.aoMap = null
        mat.metalness = 0.08
        mat.roughness = 0.86
        if ('specularIntensity' in mat) {
          ;(mat as THREE.MeshPhysicalMaterial).specularIntensity = 0
        }
        mat.needsUpdate = true
      }
      return mat
    })
    obj.material = next.length === 1 ? next[0]! : next
    painted++
  })
  console.info(
    `[Steel] Wrap "${opt.name}" on ${painted} meshes${
      allow ? ` · selective ${allow.size} keys` : ''
    }`,
  )
}
