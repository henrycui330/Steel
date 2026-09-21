import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { cloneGltfScene } from './loadGltf'
import { createLandingGear, type LandingGear } from './landingGear'
import { tankOptionById, type TankId } from './tankCatalog'

const CORSAIR_URL = assetUrl('models/f4u_corsair.glb?v=5')
const YAK9_URL = assetUrl('models/yak9.glb?v=6')
const P51_URL = assetUrl('models/p51_mustang.glb?v=1')
const F16_URL = assetUrl('models/f16a.glb?v=2')
const MIG15_URL = assetUrl('models/mig15.glb?v=1')
const MIG21_URL = assetUrl('models/mig21.glb?v=1')

/**
 * Prop revolutions per second. Deliberately *not* realistic (a real Corsair
 * prop would strobe into a backwards blur at 60fps) — tuned to read as a spin.
 */
const PROP_IDLE_RPS = 3.5
const PROP_MAX_RPS = 11

export type AircraftHandle = {
  /** Free for flight yaw/pitch/roll — never pre-rotated. */
  root: THREE.Group
  /** Inner scaled/centred model. */
  model: THREE.Object3D
  /** Propeller blade group — spins about `propAxis` in its own local space. */
  propeller: THREE.Object3D | null
  /** Local-space spin axis of the propeller disc. */
  propAxis: THREE.Vector3
  /** Marker just ahead of the spinner: camera look-ahead + gun convergence. */
  nose: THREE.Object3D
  wingspan: number
  lengthM: number
  /** Advance the propeller. `throttle01` 0–1. */
  spinProp: (dt: number, throttle01: number) => void
  /** Yak (and future packs with gear nodes). Null on Corsair until swapped. */
  landingGear: LandingGear | null
}

type AircraftRigOpts = {
  url: string
  /** Root group name (corsair / yak9). */
  name: string
  /** Real wingspan in metres — scale target after nose alignment. */
  targetWingspan: number
  /**
   * Extra yaw baked into the inner model so the nose faces game **+Z**.
   * Older Yak pack needed −π/2; FG-1D Corsair + current Yak are already +Z.
   */
  noseYaw?: number
  propNames?: string[]
  /** Jets have no propeller — skip spin heuristic. */
  noProp?: boolean
  /** Skip landing-gear carve / animation. */
  noGear?: boolean
}

function findNode(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const name of names) {
    const hit = root.getObjectByName(name)
    if (hit) return hit
  }
  const lower = names.map((n) => n.toLowerCase())
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (found || !obj.name) return
    if (lower.includes(obj.name.toLowerCase())) found = obj
  })
  return found
}

/**
 * Sketchfab / WT packs often leave metallicFactor at the glTF default (1.0)
 * with noisy metalness maps → painted fuselage reads as chrome / grey.
 * Keep albedo + roughness; kill metalness so paint shows.
 */
function sanitizeAircraftMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshPhysicalMaterial)) {
        continue
      }
      const mat = m as THREE.MeshStandardMaterial
      mat.metalnessMap = null
      mat.metalness = 0.06
      if (mat.roughness < 0.35) mat.roughness = 0.55
      if ('specularIntensity' in mat) {
        ;(mat as THREE.MeshPhysicalMaterial).specularIntensity = 0
        ;(mat as THREE.MeshPhysicalMaterial).specularColor?.setRGB(1, 1, 1)
      }
      mat.needsUpdate = true
    }
  })
}

function findPropeller(model: THREE.Object3D, names: string[]): THREE.Object3D | null {
  const named = findNode(model, names)
  if (named) return named

  // Flattened Sketchfab packs: only accept disc-like meshes (two wide axes,
  // one thin). Otherwise we spin nacelles / turrets (B-17 Object_38 lesson).
  model.updateMatrixWorld(true)
  const air = new THREE.Box3().setFromObject(model)
  const airSize = air.getSize(new THREE.Vector3())
  const maxDim = Math.max(airSize.x, airSize.y, airSize.z, 0.001)
  let best: THREE.Mesh | null = null
  let bestScore = -Infinity
  const c = new THREE.Vector3()
  const s = new THREE.Vector3()
  const b = new THREE.Box3()
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    b.setFromObject(obj)
    b.getSize(s)
    b.getCenter(c)
    const dims = [s.x, s.y, s.z].sort((a, b) => a - b)
    const longest = dims[2]!
    const mid = dims[1]!
    const thin = dims[0]!
    if (longest > maxDim * 0.28) return
    if (longest < maxDim * 0.02) return
    // Disc: thin normal, roughly circular face.
    if (thin / longest > 0.32) return
    if (mid / longest < 0.55) return
    const score = c.z * 2 - longest
    if (score > bestScore) {
      bestScore = score
      best = obj
    }
  })
  return best
}

/**
 * Spin axis of a propeller disc, expressed in that node's **own local space**.
 *
 * Derived from geometry rather than hardcoded: a prop disc is wide in two axes
 * and thin along its normal, so the thinnest local extent is the spin axis.
 * This must be measured in local space, not world — Sketchfab parents often
 * carry a Z-up→Y-up `matrix`, so world and local disagree.
 */
function localSpinAxis(prop: THREE.Object3D): THREE.Vector3 {
  prop.updateWorldMatrix(true, true)
  const toLocal = new THREE.Matrix4().copy(prop.matrixWorld).invert()
  const box = new THREE.Box3()
  const corner = new THREE.Vector3()

  prop.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    obj.geometry.computeBoundingBox()
    const gb = obj.geometry.boundingBox
    if (!gb) return
    for (const x of [gb.min.x, gb.max.x]) {
      for (const y of [gb.min.y, gb.max.y]) {
        for (const z of [gb.min.z, gb.max.z]) {
          corner.set(x, y, z).applyMatrix4(obj.matrixWorld).applyMatrix4(toLocal)
          box.expandByPoint(corner)
        }
      }
    }
  })

  if (box.isEmpty()) return new THREE.Vector3(0, 1, 0)
  const size = box.getSize(new THREE.Vector3())
  if (size.y <= size.x && size.y <= size.z) return new THREE.Vector3(0, 1, 0)
  if (size.z <= size.x && size.z <= size.y) return new THREE.Vector3(0, 0, 1)
  return new THREE.Vector3(1, 0, 0)
}

/**
 * Rig a fighter GLB for the shared flight model (nose **+Z**, up **+Y**,
 * right wing **−X**). See `aircraftFlight.ts`.
 */
async function loadAircraftRig(opts: AircraftRigOpts): Promise<AircraftHandle> {
  const model = await cloneGltfScene(opts.url)

  // Align nose to +Z before measuring wingspan (X after yaw).
  if (opts.noseYaw) {
    model.rotation.y = opts.noseYaw
  }

  model.updateMatrixWorld(true)
  const raw = new THREE.Box3().setFromObject(model)
  const rawSize = raw.getSize(new THREE.Vector3())
  // Wingspan = wider horizontal axis (some packs are nose-along-X).
  const span = Math.max(rawSize.x, rawSize.z, 0.001)
  const scale = opts.targetWingspan / span
  model.scale.multiplyScalar(scale)

  // Origin at the airframe centroid so flight rotations pivot around the plane.
  model.updateMatrixWorld(true)
  const fitted = new THREE.Box3().setFromObject(model)
  const centre = fitted.getCenter(new THREE.Vector3())
  model.position.sub(centre)

  model.updateMatrixWorld(true)
  const finalBox = new THREE.Box3().setFromObject(model)
  const size = finalBox.getSize(new THREE.Vector3())

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = false
    obj.frustumCulled = false
    obj.geometry?.computeBoundingSphere()
  })

  sanitizeAircraftMaterials(model)

  // Drop Sketchfab cameras / lights that hitch a ride in the GLB.
  const strip: THREE.Object3D[] = []
  model.traverse((obj) => {
    if (/^Camera$/i.test(obj.name) || obj.type === 'PerspectiveCamera') strip.push(obj)
  })
  for (const obj of strip) obj.parent?.remove(obj)

  const root = new THREE.Group()
  root.name = opts.name
  root.rotation.order = 'YXZ'
  root.add(model)

  const nose = new THREE.Object3D()
  nose.name = `${opts.name}Nose`
  nose.position.set(0, 0, finalBox.max.z + 0.25)
  root.add(nose)

  const propNames = opts.propNames ?? [
    'ProBlades',
    'Prop_Blades',
    'Propeller',
    'Propellor',
    'Yak-9_Propellor',
  ]
  const propeller = opts.noProp ? null : findPropeller(model, propNames)
  if (!propeller && !opts.noProp) {
    console.warn(`[Steel] ${opts.name} propeller node not found — prop will not spin`)
  }

  const propAxis = propeller ? localSpinAxis(propeller) : new THREE.Vector3(0, 1, 0)
  if (propeller) {
    console.info(
      `[Steel] ${opts.name} prop axis (local) = ${propAxis.x},${propAxis.y},${propAxis.z} · span ${size.x.toFixed(2)}m`,
    )
  }

  const landingGear = opts.noGear ? null : createLandingGear(model)

  return {
    root,
    model,
    propeller,
    propAxis,
    nose,
    wingspan: size.x,
    lengthM: size.z,
    landingGear,
    spinProp(dt, throttle01) {
      if (!propeller) return
      const rps = PROP_IDLE_RPS + THREE.MathUtils.clamp(throttle01, 0, 1) * PROP_MAX_RPS
      propeller.rotateOnAxis(propAxis, dt * rps * Math.PI * 2)
    },
  }
}

/** F4U-1A Corsair — original pack (nose +Z). No separate gear nodes. */
export async function loadCorsair(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: CORSAIR_URL,
    name: 'corsair',
    targetWingspan: 12.5,
    propNames: ['ProBlades', 'Prop_Blades', 'Propeller', 'Propellor'],
  })
}

/** P-51 Mustang — nose already +Z; spin `propeler` blades. */
export async function loadP51Mustang(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: P51_URL,
    name: 'p51',
    targetWingspan: 11.3,
    propNames: ['propeler', 'PROPELER', 'Propeller', 'Propellor'],
  })
}

/** Yak-9 — original pack; nose on +X → bake −90°; named Gear_L/R/B. */
export async function loadYak9(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: YAK9_URL,
    name: 'yak9',
    targetWingspan: 9.74,
    noseYaw: -Math.PI / 2,
    propNames: ['Yak-9_Propellor', 'Yak-9_Propeller', 'Yak-9_Propulsion'],
  })
}

/** F-16A Block 15 — jet; static airframe (no prop / gear motion). */
export async function loadF16(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: F16_URL,
    name: 'f16',
    targetWingspan: 9.96,
    noProp: true,
    noGear: true,
  })
}

/** MiG-15 — early Soviet jet; static airframe (no prop / gear motion). */
export async function loadMig15(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: MIG15_URL,
    name: 'mig15',
    targetWingspan: 10.08,
    noProp: true,
    noGear: true,
  })
}

/** MiG-21MF Fishbed — Soviet jet; SpecGloss→metalrough; no prop/gear. */
export async function loadMig21(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: MIG21_URL,
    name: 'mig21',
    targetWingspan: 7.15,
    noProp: true,
    noGear: true,
  })
}

/** Load the aircraft chosen on the menu / AI slot. */
export async function loadPlayerAircraft(id: TankId): Promise<AircraftHandle> {
  const opt = tankOptionById(id)
  if (!opt.aircraft) throw new Error(`Not an aircraft: ${id}`)
  if (id === 'yak9') return loadYak9()
  if (id === 'p51') return loadP51Mustang()
  if (id === 'f16') return loadF16()
  if (id === 'mig15') return loadMig15()
  if (id === 'mig21') return loadMig21()
  return loadCorsair()
}
