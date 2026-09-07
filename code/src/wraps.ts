import * as THREE from 'three'

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
    url: '/wraps/china-camo.webp',
  },
  {
    id: 'desert',
    name: 'Desert camo',
    blurb: 'Sand / dust theatre',
    url: '/wraps/desert-camo.webp',
  },
  {
    id: 'nato',
    name: 'NATO camo',
    blurb: 'Woodland NATO scheme',
    url: '/wraps/nato-camo.jpeg',
  },
  {
    id: 'us',
    name: 'US camo',
    blurb: 'US MERDC / woodland',
    url: '/wraps/us-camo.webp',
  },
  {
    id: 'patriotic',
    name: 'Patriotic',
    blurb: 'Stars and stripes energy',
    url: '/wraps/patriotic.webp',
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
    pending = new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader()
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          tex.wrapS = THREE.RepeatWrapping
          tex.wrapT = THREE.RepeatWrapping
          tex.repeat.set(2.4, 2.4)
          tex.anisotropy = 4
          tex.needsUpdate = true
          resolve(tex)
        },
        undefined,
        (err) => reject(err),
      )
    })
    textureCache.set(url, pending)
  }
  return pending
}

function isSkippedPart(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('track') ||
    n.includes('wheel') ||
    n.includes('tire') ||
    n.includes('tyre') ||
    n.includes('chain')
  )
}

/**
 * Apply the player's chosen wrap to a tank root (player only).
 * `stock` leaves factory / dunkelgrau paint alone.
 */
export async function applyTankWrap(root: THREE.Object3D, wrapId: WrapId = getSelectedWrapId()): Promise<void> {
  const opt = wrapOptionById(wrapId)
  if (!opt.url) {
    console.info('[Steel] Wrap: stock paint')
    return
  }

  let map: THREE.Texture
  try {
    map = await loadWrapTexture(opt.url)
  } catch (err) {
    console.warn('[Steel] Wrap texture failed', opt.url, err)
    return
  }

  let painted = 0
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return
    if (isSkippedPart(obj.name)) return

    const src = Array.isArray(obj.material) ? obj.material : [obj.material]
    const next = src.map((m) => {
      if (!m) return m
      const mat = m.clone() as THREE.MeshStandardMaterial
      if ('map' in mat) {
        mat.map = map
        if ('color' in mat && mat.color) mat.color.set(0xffffff)
        mat.needsUpdate = true
      }
      return mat
    })
    obj.material = next.length === 1 ? next[0]! : next
    painted++
  })
  console.info(`[Steel] Wrap "${opt.name}" on ${painted} meshes`)
}
