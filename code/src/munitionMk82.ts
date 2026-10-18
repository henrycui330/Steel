import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'

/**
 * US free-fall bombs:
 *   AN-M64A1 — 500 lb
 *   Mk 83 LDGP — 1000 lb
 *   GBU-27 Paveway III — LGB (Litening lock → guided pickle)
 * Hung + in-flight share prepared templates (nose −Z for lookAt).
 */

export type BombStoreKind = 'bomb' | 'bomb1000' | 'gbu27'

export const BOMB_500_MODEL_URL = assetUrl('models/an_m64a1_500lb.glb?v=2')
export const BOMB_1000_MODEL_URL = assetUrl('models/mk83_1000lb.glb?v=2')
export const GBU27_MODEL_URL = assetUrl('models/gbu27_paveway.glb?v=1')
/** @deprecated alias */
export const MK82_MODEL_URL = BOMB_500_MODEL_URL

const BOMB_500_LENGTH = 1.55
/** Was 1.95 m; human asked 1.5× bigger. */
const BOMB_1000_LENGTH = 1.95 * 1.5
/** GBU-27 ~4.2 m class — sit near Mk83 game scale. */
const GBU27_LENGTH = 3.15

type Slot = {
  template: THREE.Group | null
  failed: boolean
  pending: Promise<THREE.Group | null> | null
}

const slots: Record<BombStoreKind, Slot> = {
  bomb: { template: null, failed: false, pending: null },
  bomb1000: { template: null, failed: false, pending: null },
  gbu27: { template: null, failed: false, pending: null },
}

function prepareBomb(
  scene: THREE.Object3D,
  name: string,
  length: number,
  /** Extra yaw after long-axis remap (π = flip 180°). */
  yawExtra = 0,
): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = name
  const model = scene.clone(true)
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  // WT packs are long on +X → map nose to −Z for lookAt.
  if (size.x >= size.y && size.x >= size.z) {
    model.rotation.y = Math.PI / 2 + yawExtra
  } else if (size.z >= size.x && size.z >= size.y) {
    model.rotation.y = Math.PI + yawExtra
  } else {
    model.rotation.x = Math.PI / 2
    model.rotation.y = yawExtra
  }
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const size2 = box2.getSize(new THREE.Vector3())
  const len = Math.max(size2.x, size2.y, size2.z, 0.001)
  wrap.scale.setScalar(length / len)
  wrap.updateMatrixWorld(true)

  const box3 = new THREE.Box3().setFromObject(wrap)
  const center = box3.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

function ensureSlot(
  kind: BombStoreKind,
  url: string,
  name: string,
  length: number,
  yawExtra: number,
  label: string,
): Promise<THREE.Group | null> {
  const slot = slots[kind]
  if (slot.template) return Promise.resolve(slot.template)
  if (slot.failed) return Promise.resolve(null)
  if (!slot.pending) {
    slot.pending = loadGltfCached(url)
      .then((gltf) => {
        slot.template = prepareBomb(gltf.scene, name, length, yawExtra)
        console.info(`[Steel] ${label} model ready · ${length.toFixed(2)} m`)
        return slot.template
      })
      .catch((err) => {
        slot.failed = true
        console.warn(`[Steel] ${label} GLB failed — capsule fallback`, err)
        return null
      })
      .finally(() => {
        slot.pending = null
      })
  }
  return slot.pending
}

/** AN-M64A1 500 lb — nose remapped +π/2 (180° flip from first import). */
export function ensureMk82Template(): Promise<THREE.Group | null> {
  return ensureSlot(
    'bomb',
    BOMB_500_MODEL_URL,
    'an_m64a1_500lb',
    BOMB_500_LENGTH,
    0,
    'AN-M64A1 500 lb',
  )
}

export function ensureBomb1000Template(): Promise<THREE.Group | null> {
  return ensureSlot(
    'bomb1000',
    BOMB_1000_MODEL_URL,
    'mk83_1000lb',
    BOMB_1000_LENGTH,
    0,
    'Mk83 1000 lb',
  )
}

export function ensureGbu27Template(): Promise<THREE.Group | null> {
  return ensureSlot(
    'gbu27',
    GBU27_MODEL_URL,
    'gbu27_paveway',
    GBU27_LENGTH,
    0,
    'GBU-27 Paveway',
  )
}

export function ensureAllBombTemplates(): Promise<void> {
  return Promise.all([
    ensureMk82Template(),
    ensureBomb1000Template(),
    ensureGbu27Template(),
  ]).then(() => undefined)
}

function cloneFrom(kind: BombStoreKind, name: string): THREE.Object3D | null {
  const tpl = slots[kind].template
  if (!tpl) return null
  const clone = tpl.clone(true)
  clone.name = name
  clone.castShadow = true
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.frustumCulled = false
      o.userData.sharedMunition = true
    }
  })
  return clone
}

export function cloneMk82Flight(): THREE.Object3D | null {
  return cloneFrom('bomb', 'bomb500_flight')
}

export function cloneBomb1000Flight(): THREE.Object3D | null {
  return cloneFrom('bomb1000', 'bomb1000_flight')
}

export function cloneGbu27Flight(): THREE.Object3D | null {
  return cloneFrom('gbu27', 'gbu27_flight')
}

export function cloneBombFlight(kind: BombStoreKind): THREE.Object3D | null {
  if (kind === 'bomb1000') return cloneBomb1000Flight()
  if (kind === 'gbu27') return cloneGbu27Flight()
  return cloneMk82Flight()
}

/** Hung hardpoint — nose +Z (airframe forward). */
export function cloneMk82Hung(): THREE.Object3D | null {
  const clone = cloneFrom('bomb', 'hardpointBomb')
  if (!clone) return null
  clone.rotation.y = Math.PI
  clone.position.y = -0.35
  return clone
}

export function cloneBomb1000Hung(): THREE.Object3D | null {
  const clone = cloneFrom('bomb1000', 'hardpointBomb1000')
  if (!clone) return null
  clone.rotation.y = Math.PI
  clone.position.y = -0.4
  return clone
}

export function cloneGbu27Hung(): THREE.Object3D | null {
  const clone = cloneFrom('gbu27', 'hardpointGbu27')
  if (!clone) return null
  clone.rotation.y = Math.PI
  clone.position.y = -0.42
  return clone
}

export function cloneBombHung(kind: BombStoreKind): THREE.Object3D | null {
  if (kind === 'bomb1000') return cloneBomb1000Hung()
  if (kind === 'gbu27') return cloneGbu27Hung()
  return cloneMk82Hung()
}

export function mk82TemplateReady(): boolean {
  return slots.bomb.template !== null
}

export function bombTemplateReady(kind: BombStoreKind): boolean {
  return slots[kind].template !== null
}

export function bombKindLabel(kind: BombStoreKind): string {
  if (kind === 'bomb1000') return 'Mk83 1000 lb'
  if (kind === 'gbu27') return 'GBU-27 Paveway'
  return 'AN-M64A1 500 lb'
}
