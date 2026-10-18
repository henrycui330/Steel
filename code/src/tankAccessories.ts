import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { cloneGltfScene } from './loadGltf'

export type TankAccessoryKind = 'bush'

/** One hung prop on a chassis (local tank-root space). */
export type TankAccessory = {
  id: string
  kind: TankAccessoryKind
  /** Local metres on tank root. */
  pos: [number, number, number]
  /** Yaw around local +Y (radians). */
  yaw: number
  /** Approx height in metres (template normalized to 1 m at scale 1). */
  scale: number
}

export const ACCESSORY_KINDS: readonly {
  id: TankAccessoryKind
  name: string
}[] = [{ id: 'bush', name: 'Photoreal bush' }]

const BUSH_URL = assetUrl('maps/props/photorealistic_bush.glb?v=2')
const MAX_ACCESSORIES = 12
const DEFAULT_BUSH_SCALE = 1.1

let bushTemplate: THREE.Group | null = null
let bushTemplateReady: Promise<THREE.Group> | null = null

const _box = new THREE.Box3()
const _size = new THREE.Vector3()

/** Stand Z-up Sketchfab props on Y; plant base at y=0. Returns height. */
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

function tuneBushMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = true
    obj.frustumCulled = false
    obj.visible = true
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of mats) {
      if (!mat || !(mat instanceof THREE.Material)) continue
      mat.visible = true
      mat.side = THREE.DoubleSide
      mat.depthWrite = true
      mat.depthTest = true

      const std =
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial
          ? mat
          : null
      if (!std) continue

      const name = (std.name || '').toLowerCase()
      const looksLeaf =
        /leaf|foliage|twig/i.test(name) ||
        !!std.alphaMap ||
        std.transparent ||
        std.alphaTest > 0

      // Soft BLEND leaves were vanishing (alphaTest ate every texel). Hard cutout.
      if (looksLeaf) {
        std.transparent = false
        std.opacity = 1
        std.alphaTest = 0.08
        if (!std.map && !std.alphaMap) {
          std.color.setHex(0x3f5a28)
        }
      }
      if (std.map) {
        std.map.colorSpace = THREE.SRGBColorSpace
        std.map.needsUpdate = true
      }
      std.metalness = 0
      std.roughness = Math.max(0.85, std.roughness ?? 0.9)
      std.needsUpdate = true
    }
  })
}

/**
 * Flatten a GLB into a unit-height (1 m) group at scale 1 so instance
 * `scale` is simply height in metres.
 */
function bakeUnitHeightBush(src: THREE.Object3D): THREE.Group {
  const h = uprightAndPlant(src)
  src.scale.multiplyScalar(1 / h)
  src.updateMatrixWorld(true)
  _box.setFromObject(src)
  src.position.y -= _box.min.y
  src.updateMatrixWorld(true)

  const baked = new THREE.Group()
  baked.name = 'bushBaked'
  const meshes: THREE.Mesh[] = []
  src.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry) meshes.push(o)
  })
  for (const mesh of meshes) {
    const geo = mesh.geometry.clone()
    geo.applyMatrix4(mesh.matrixWorld)
    const mats = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone()
    const m = new THREE.Mesh(geo, mats)
    m.name = mesh.name
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false
    baked.add(m)
  }
  tuneBushMaterials(baked)
  baked.updateMatrixWorld(true)
  _box.setFromObject(baked)
  baked.position.y -= _box.min.y
  _box.setFromObject(baked)
  _box.getSize(_size)
  console.info(
    `[Steel] Bush bake · meshes=${meshes.length} · size=` +
      `${_size.x.toFixed(2)}×${_size.y.toFixed(2)}×${_size.z.toFixed(2)}`,
  )
  return baked
}

async function ensureBushTemplate(): Promise<THREE.Group> {
  if (bushTemplate) return bushTemplate
  if (!bushTemplateReady) {
    bushTemplateReady = (async () => {
      const wrapper = new THREE.Group()
      wrapper.name = 'bushAccessoryTemplate'
      const src = await cloneGltfScene(BUSH_URL)
      const baked = bakeUnitHeightBush(src)
      baked.name = 'bushPhotoreal'
      wrapper.add(baked)
      wrapper.userData.unitScale = 1
      wrapper.visible = true
      bushTemplate = wrapper
      console.info('[Steel] Tank accessory bush template ready · unit height')
      return wrapper
    })().catch((err) => {
      bushTemplateReady = null
      console.warn('[Steel] Tank accessory bush template FAILED', err)
      throw err
    })
  }
  return bushTemplateReady
}

/** Warm the bush GLB while Customize opens. */
export function preloadBushAccessory(): Promise<void> {
  return ensureBushTemplate().then(() => undefined)
}

function cloneBushInstance(template: THREE.Object3D, id: string): THREE.Object3D {
  const node = template.clone(true)
  node.name = `acc_${id}`
  node.userData.accessoryId = id
  node.visible = true
  node.traverse((o) => {
    o.visible = true
    o.userData.accessoryId = id
    if (!(o instanceof THREE.Mesh)) return
    o.frustumCulled = false
    o.geometry = o.geometry.clone()
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => m.clone())
    } else if (o.material) {
      o.material = o.material.clone()
    }
  })
  return node
}

export function isAccessoryKind(v: unknown): v is TankAccessoryKind {
  return v === 'bush'
}

export function normalizeAccessory(raw: unknown): TankAccessory | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isAccessoryKind(o.kind)) return null
  if (typeof o.id !== 'string' || !o.id) return null
  const pos = o.pos
  if (!Array.isArray(pos) || pos.length !== 3) return null
  const px = Number(pos[0])
  const py = Number(pos[1])
  const pz = Number(pos[2])
  if (![px, py, pz].every((n) => Number.isFinite(n))) return null
  const yaw = Number(o.yaw)
  const scale = Number(o.scale)
  if (!Number.isFinite(yaw) || !Number.isFinite(scale)) return null
  return {
    id: o.id,
    kind: o.kind,
    pos: [px, py, pz],
    yaw,
    scale: Math.min(2.8, Math.max(0.25, scale)),
  }
}

export function normalizeAccessories(raw: unknown): TankAccessory[] {
  if (!Array.isArray(raw)) return []
  const out: TankAccessory[] = []
  for (const item of raw) {
    const a = normalizeAccessory(item)
    if (a) out.push(a)
    if (out.length >= MAX_ACCESSORIES) break
  }
  return out
}

export function newBushAccessory(
  pos: readonly [number, number, number],
): TankAccessory {
  return {
    id: `bush_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'bush',
    pos: [pos[0], pos[1], pos[2]],
    yaw: 0,
    scale: DEFAULT_BUSH_SCALE,
  }
}

/** Compact wire form for MP lobby / start (no client-only ids). */
export type MpAccessoryWire = {
  kind: 'bush'
  pos: [number, number, number]
  yaw: number
  scale: number
}

export function accessoriesToWire(
  list: readonly TankAccessory[],
): MpAccessoryWire[] {
  return normalizeAccessories(list).map((a) => ({
    kind: 'bush' as const,
    pos: [a.pos[0], a.pos[1], a.pos[2]] as [number, number, number],
    yaw: a.yaw,
    scale: a.scale,
  }))
}

export function accessoriesFromWire(raw: unknown): TankAccessory[] {
  if (!Array.isArray(raw)) return []
  const out: TankAccessory[] = []
  for (let i = 0; i < raw.length && out.length < MAX_ACCESSORIES; i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const a = normalizeAccessory({
      id: typeof o.id === 'string' ? o.id : `mp_bush_${i}`,
      kind: o.kind === 'bush' ? 'bush' : undefined,
      pos: o.pos,
      yaw: o.yaw,
      scale: o.scale,
    })
    if (a) out.push(a)
  }
  return out
}

export type TankAccessoryRig = {
  group: THREE.Group
  setAccessories: (list: readonly TankAccessory[]) => Promise<void>
  /** Meshes / roots that can be ray-picked to select an accessory. */
  pickRoots: () => THREE.Object3D[]
  highlight: (id: string | null) => void
  dispose: () => void
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry?.dispose()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) m?.dispose?.()
  })
}

/**
 * Attach a live accessory group under a tank root. Call `setAccessories` to sync.
 */
export function attachTankAccessories(root: THREE.Object3D): TankAccessoryRig {
  const group = new THREE.Group()
  group.name = 'tankAccessories'
  root.add(group)

  const byId = new Map<string, THREE.Object3D>()
  let highlightId: string | null = null
  let gen = 0

  function applyHighlight(): void {
    for (const [id, node] of byId) {
      const on = id === highlightId
      node.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue
          m.emissive.setHex(on ? 0x5a8030 : 0x000000)
          m.emissiveIntensity = on ? 0.45 : 0
        }
      })
    }
  }

  async function setAccessories(list: readonly TankAccessory[]): Promise<void> {
    const my = ++gen
    const keep = new Set(list.map((a) => a.id))
    for (const [id, node] of [...byId]) {
      if (keep.has(id)) continue
      group.remove(node)
      disposeObject(node)
      byId.delete(id)
    }

    const template = await ensureBushTemplate()
    if (my !== gen) return

    for (const acc of list) {
      if (acc.kind !== 'bush') continue
      let node = byId.get(acc.id)
      if (!node) {
        node = cloneBushInstance(template, acc.id)
        group.add(node)
        byId.set(acc.id, node)
      }
      node.position.set(acc.pos[0], acc.pos[1], acc.pos[2])
      node.rotation.set(0, acc.yaw, 0)
      // Template is unit-height at scale 1 → scale ≈ metres tall.
      node.scale.setScalar(acc.scale)
      node.visible = true
      node.updateMatrixWorld(true)
      _box.setFromObject(node)
      _box.getSize(_size)
      console.info(
        `[Steel] Bush hung ${acc.id.slice(-6)} · pos=${acc.pos.map((n) => n.toFixed(2)).join(',')} · ` +
          `scale=${acc.scale.toFixed(2)} · bbox=${_size.x.toFixed(2)}×${_size.y.toFixed(2)}×${_size.z.toFixed(2)}`,
      )
    }
    applyHighlight()
    console.info(`[Steel] Tank accessories · ${list.length} hung`)
  }

  return {
    group,
    setAccessories,
    pickRoots: () => [...byId.values()],
    highlight(id) {
      highlightId = id
      applyHighlight()
    },
    dispose() {
      gen++
      root.remove(group)
      for (const node of byId.values()) disposeObject(node)
      byId.clear()
    },
  }
}

export async function applyTankAccessories(
  root: THREE.Object3D,
  list: readonly TankAccessory[],
): Promise<void> {
  if (list.length === 0) return
  const rig = attachTankAccessories(root)
  await rig.setAccessories(list)
}
