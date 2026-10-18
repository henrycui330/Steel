import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'

/**
 * US HVAR — unguided air-to-ground rocket (War Thunder pack).
 * Template nose faces +Z (airframe forward / rocket flight axis).
 */

export const HVAR_MODEL_URL = assetUrl('models/hvar_rocket.glb?v=1')
/** Game length along the rocket axis. */
const HVAR_MODEL_LENGTH = 1.45

let template: THREE.Group | null = null
let templateFailed = false
let pending: Promise<THREE.Group | null> | null = null

function prepareHvar(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'hvar_rocket'
  const model = scene.clone(true)
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  // Pack long on +X → nose +Z for airframe / setFromUnitVectors(+Z).
  if (size.x >= size.y && size.x >= size.z) {
    model.rotation.y = -Math.PI / 2
  } else if (size.z >= size.x && size.z >= size.y) {
    // Already Z-long; leave as-is (assume tip +Z).
  } else {
    model.rotation.x = -Math.PI / 2
  }
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const size2 = box2.getSize(new THREE.Vector3())
  const len = Math.max(size2.x, size2.y, size2.z, 0.001)
  wrap.scale.setScalar(HVAR_MODEL_LENGTH / len)
  wrap.updateMatrixWorld(true)

  const box3 = new THREE.Box3().setFromObject(wrap)
  const center = box3.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

export function ensureHvarTemplate(): Promise<THREE.Group | null> {
  if (template) return Promise.resolve(template)
  if (templateFailed) return Promise.resolve(null)
  if (!pending) {
    pending = loadGltfCached(HVAR_MODEL_URL)
      .then((gltf) => {
        template = prepareHvar(gltf.scene)
        console.info(
          `[Steel] HVAR rocket model ready · ${HVAR_MODEL_LENGTH.toFixed(2)} m`,
        )
        return template
      })
      .catch((err) => {
        templateFailed = true
        console.warn('[Steel] HVAR GLB failed — procedural fallback', err)
        return null
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

function cloneBase(name: string): THREE.Object3D | null {
  if (!template) return null
  const clone = template.clone(true)
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

/** In-flight — nose +Z; caller sets world quaternion / aligns to velocity. */
export function cloneHvarFlight(): THREE.Object3D | null {
  return cloneBase('hvarRocket')
}

/** Hung tip rail — nose +Z (airframe forward). */
export function cloneHvarHung(): THREE.Object3D | null {
  const clone = cloneBase('hardpointRocket')
  if (!clone) return null
  clone.position.z = 0.15
  return clone
}

export function hvarTemplateReady(): boolean {
  return template !== null
}
