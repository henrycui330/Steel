import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { loadGltfCached } from './loadGltf'

/**
 * Air-to-air missiles — AIM-9 / AIM-120 / R-73 / R-77.
 * Template nose faces +Z (airframe forward / flight axis).
 */

export type AamKind = 'aim9' | 'aim120' | 'r73' | 'r77'

export const AIM9_MODEL_URL = assetUrl('models/aim9_sidewinder.glb?v=1')
export const AIM120_MODEL_URL = assetUrl('models/aim120_amraam.glb?v=1')
export const R73_MODEL_URL = assetUrl('models/r73_vympel.glb?v=1')
export const R77_MODEL_URL = assetUrl('models/r77.glb?v=1')

const LENGTH: Record<AamKind, number> = {
  aim9: 2.85,
  aim120: 3.65,
  r73: 2.9,
  r77: 3.6,
}

const URL: Record<AamKind, string> = {
  aim9: AIM9_MODEL_URL,
  aim120: AIM120_MODEL_URL,
  r73: R73_MODEL_URL,
  r77: R77_MODEL_URL,
}

const LABEL: Record<AamKind, string> = {
  aim9: 'AIM-9 Sidewinder',
  aim120: 'AIM-120 AMRAAM',
  r73: 'R-73 Vympel',
  r77: 'R-77 Adder',
}

type Slot = {
  template: THREE.Group | null
  failed: boolean
  pending: Promise<THREE.Group | null> | null
}

const slots: Record<AamKind, Slot> = {
  aim9: { template: null, failed: false, pending: null },
  aim120: { template: null, failed: false, pending: null },
  r73: { template: null, failed: false, pending: null },
  r77: { template: null, failed: false, pending: null },
}

function prepareAam(scene: THREE.Object3D, name: string, length: number): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = name
  const model = scene.clone(true)
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  // Long on +Z already — tip toward +Z. Flip if tip was −Z.
  if (size.x >= size.y && size.x >= size.z) {
    model.rotation.y = -Math.PI / 2
  } else if (size.y >= size.x && size.y >= size.z) {
    model.rotation.x = -Math.PI / 2
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

function ensureSlot(kind: AamKind): Promise<THREE.Group | null> {
  const slot = slots[kind]
  if (slot.template) return Promise.resolve(slot.template)
  if (slot.failed) return Promise.resolve(null)
  const url = URL[kind]
  const label = LABEL[kind]
  if (!slot.pending) {
    slot.pending = loadGltfCached(url)
      .then((gltf) => {
        slot.template = prepareAam(gltf.scene, kind, LENGTH[kind])
        console.info(`[Steel] ${label} model ready · ${LENGTH[kind].toFixed(2)} m`)
        return slot.template
      })
      .catch((err) => {
        slot.failed = true
        console.warn(`[Steel] ${label} GLB failed — stub fallback`, err)
        return null
      })
      .finally(() => {
        slot.pending = null
      })
  }
  return slot.pending
}

export function ensureAim9Template(): Promise<THREE.Group | null> {
  return ensureSlot('aim9')
}

export function ensureAim120Template(): Promise<THREE.Group | null> {
  return ensureSlot('aim120')
}

export function ensureR73Template(): Promise<THREE.Group | null> {
  return ensureSlot('r73')
}

export function ensureR77Template(): Promise<THREE.Group | null> {
  return ensureSlot('r77')
}

export function ensureAllAamTemplates(): Promise<void> {
  return Promise.all([
    ensureAim9Template(),
    ensureAim120Template(),
    ensureR73Template(),
    ensureR77Template(),
  ]).then(() => undefined)
}

function cloneFrom(kind: AamKind, name: string): THREE.Object3D | null {
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

export function cloneAamFlight(kind: AamKind): THREE.Object3D | null {
  return cloneFrom(kind, `${kind}_flight`)
}

/** Hung rail — nose +Z. */
export function cloneAamHung(kind: AamKind): THREE.Object3D | null {
  const name =
    kind === 'aim9'
      ? 'hardpointAim9'
      : kind === 'aim120'
        ? 'hardpointAim120'
        : kind === 'r73'
          ? 'hardpointR73'
          : 'hardpointR77'
  return cloneFrom(kind, name)
}

export function aamTemplateReady(kind: AamKind): boolean {
  return slots[kind].template !== null
}

export function aamLabel(kind: AamKind): string {
  return LABEL[kind]
}

/** Tiny procedural stub until GLB loads. */
export function makeAamFallback(kind: AamKind): THREE.Group {
  const g = new THREE.Group()
  g.name =
    kind === 'aim9'
      ? 'hardpointAim9'
      : kind === 'aim120'
        ? 'hardpointAim120'
        : kind === 'r73'
          ? 'hardpointR73'
          : 'hardpointR77'
  const len = kind === 'aim120' || kind === 'r77' ? 3.0 : 2.4
  const r = kind === 'aim120' || kind === 'r77' ? 0.075 : 0.06
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.05, len, 6),
    new THREE.MeshStandardMaterial({
      color:
        kind === 'r73'
          ? 0x6a6e62
          : kind === 'r77'
            ? 0x5a5e58
            : kind === 'aim9'
              ? 0xffffff
              : 0xc8c4b8,
      roughness: 0.45,
      metalness: 0.4,
    }),
  )
  body.rotation.x = Math.PI / 2
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(r, 0.35, 6),
    new THREE.MeshStandardMaterial({
      color: 0x3a3e38,
      roughness: 0.5,
      metalness: 0.35,
    }),
  )
  tip.rotation.x = Math.PI / 2
  tip.position.z = len / 2 + 0.1
  g.add(body, tip)
  return g
}
