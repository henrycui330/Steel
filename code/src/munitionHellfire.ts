import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'

/**
 * AGM-114 Hellfire — Apache AGM flight mesh.
 * Template nose faces +Z (airframe forward / flight axis).
 */

export const HELLFIRE_MODEL_URL = assetUrl('models/hellfire.glb?v=1')

/** Real AGM-114 ≈ 1.6 m; pack is long on ±Z already. */
const HELLFIRE_LENGTH = 1.65

type Slot = {
  template: THREE.Group | null
  failed: boolean
  pending: Promise<THREE.Group | null> | null
}

const slot: Slot = { template: null, failed: false, pending: null }

function prepareHellfire(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'hellfire'
  const model = scene.clone(true)
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  // Long on +Z already (Sketchfab pack) — tip toward +Z. Remap if needed.
  if (size.x >= size.y && size.x >= size.z) {
    model.rotation.y = -Math.PI / 2
  } else if (size.y >= size.x && size.y >= size.z) {
    model.rotation.x = -Math.PI / 2
  }
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const size2 = box2.getSize(new THREE.Vector3())
  const len = Math.max(size2.x, size2.y, size2.z, 0.001)
  wrap.scale.setScalar(HELLFIRE_LENGTH / len)
  wrap.updateMatrixWorld(true)

  const box3 = new THREE.Box3().setFromObject(wrap)
  const center = box3.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

export function ensureHellfireTemplate(): Promise<THREE.Group | null> {
  if (slot.template) return Promise.resolve(slot.template)
  if (slot.failed) return Promise.resolve(null)
  if (!slot.pending) {
    slot.pending = loadGltfCached(HELLFIRE_MODEL_URL)
      .then((gltf) => {
        slot.template = prepareHellfire(gltf.scene)
        console.info(
          `[Steel] Hellfire AGM model ready · ${HELLFIRE_LENGTH.toFixed(2)} m`,
        )
        return slot.template
      })
      .catch((err) => {
        slot.failed = true
        console.warn(`[Steel] Hellfire GLB failed — capsule fallback`, err)
        return null
      })
      .finally(() => {
        slot.pending = null
      })
  }
  return slot.pending
}

function cloneFrom(name: string): THREE.Object3D | null {
  if (!slot.template) return null
  const clone = slot.template.clone(true)
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

export function cloneHellfireFlight(): THREE.Object3D | null {
  return cloneFrom('hellfire_flight')
}

/** Hung under a pylon (same mesh as flight). */
export function cloneHellfireHung(): THREE.Object3D | null {
  return cloneFrom('hardpointHellfire')
}

export function hellfireTemplateReady(): boolean {
  return slot.template !== null
}

/** Procedural stub until GLB loads. */
export function makeHellfireFallback(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'hellfire_fallback'
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 1.5, 6),
    new THREE.MeshStandardMaterial({
      color: 0x6a7058,
      roughness: 0.55,
      metalness: 0.35,
    }),
  )
  body.rotation.x = Math.PI / 2
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.28, 6),
    new THREE.MeshStandardMaterial({
      color: 0x3a3e38,
      roughness: 0.5,
      metalness: 0.35,
    }),
  )
  tip.rotation.x = Math.PI / 2
  tip.position.z = 0.9
  g.add(body, tip)
  return g
}
