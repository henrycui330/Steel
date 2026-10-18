import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'

/**
 * Rafael Litening targeting pod — hung under F-16 (GBU / future Hellfire).
 * Template long axis → +Z (airframe forward).
 */

export const LITENING_MODEL_URL = assetUrl('models/rafael_litening.glb?v=1')

/** Real Litening ≈ 2.2 m class; keep readable under the inlet. */
const LITENING_LENGTH = 1.85

type Slot = {
  template: THREE.Group | null
  failed: boolean
  pending: Promise<THREE.Group | null> | null
}

const slot: Slot = { template: null, failed: false, pending: null }

function prepareLitening(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'litening'
  const model = scene.clone(true)
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  if (size.x >= size.y && size.x >= size.z) {
    model.rotation.y = -Math.PI / 2
  } else if (size.y >= size.x && size.y >= size.z) {
    model.rotation.x = -Math.PI / 2
  }
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const size2 = box2.getSize(new THREE.Vector3())
  const len = Math.max(size2.x, size2.y, size2.z, 0.001)
  wrap.scale.setScalar(LITENING_LENGTH / len)
  wrap.updateMatrixWorld(true)

  const box3 = new THREE.Box3().setFromObject(wrap)
  const center = box3.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

export function ensureLiteningTemplate(): Promise<THREE.Group | null> {
  if (slot.template) return Promise.resolve(slot.template)
  if (slot.failed) return Promise.resolve(null)
  if (!slot.pending) {
    slot.pending = loadGltfCached(LITENING_MODEL_URL)
      .then((gltf) => {
        slot.template = prepareLitening(gltf.scene)
        console.info(
          `[Steel] Litening TGP model ready · ${LITENING_LENGTH.toFixed(2)} m`,
        )
        return slot.template
      })
      .catch((err) => {
        slot.failed = true
        console.warn(`[Steel] Litening GLB failed — box fallback`, err)
        return null
      })
      .finally(() => {
        slot.pending = null
      })
  }
  return slot.pending
}

export function liteningTemplateReady(): boolean {
  return slot.template !== null
}

export function cloneLiteningHung(): THREE.Object3D | null {
  if (!slot.template) return null
  const clone = slot.template.clone(true)
  clone.name = 'hardpointLitening'
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

/** Grey capsule if the GLB is still loading / failed. */
export function makeLiteningFallback(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'litening_fallback'
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.14, 1.1, 4, 8),
    new THREE.MeshStandardMaterial({
      color: 0x3a3e38,
      roughness: 0.55,
      metalness: 0.45,
    }),
  )
  body.rotation.x = Math.PI / 2
  body.castShadow = true
  g.add(body)
  return g
}

/**
 * Attach a Litening under the airframe (right chin / inlet).
 * Returns the pod root (sensor origin ≈ group origin).
 */
export function attachLiteningPod(
  aircraftRoot: THREE.Object3D,
  local: readonly [number, number, number] = [1.05, -1.42, 0.15],
): THREE.Group {
  void ensureLiteningTemplate()
  const pod = new THREE.Group()
  pod.name = 'liteningPod'
  pod.position.set(local[0], local[1], local[2])
  const hung = cloneLiteningHung() ?? makeLiteningFallback()
  pod.add(hung)
  aircraftRoot.add(pod)

  // Swap in the real mesh when the template finishes loading.
  if (!liteningTemplateReady()) {
    void ensureLiteningTemplate().then((tpl) => {
      if (!tpl || !pod.parent) return
      const next = cloneLiteningHung()
      if (!next) return
      pod.clear()
      pod.add(next)
    })
  }

  console.info(
    `[Steel] Litening TGP hung @ (${local[0]}, ${local[1]}, ${local[2]}) · press E`,
  )
  return pod
}
