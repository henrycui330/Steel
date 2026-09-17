import * as THREE from 'three'
import { assetUrl } from './assetUrl'
import { cloneGltfScene } from './loadGltf'
import { tankOptionById, type TankId } from './tankCatalog'

const CORSAIR_URL = assetUrl('models/f4u_corsair.glb?v=1')
const YAK9_URL = assetUrl('models/yak9.glb?v=1')

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
}

type AircraftRigOpts = {
  url: string
  /** Root group name (corsair / yak9). */
  name: string
  /** Real wingspan in metres — scale target after nose alignment. */
  targetWingspan: number
  /**
   * Extra yaw baked into the inner model so the nose faces game **+Z**.
   * Yak-9 export has nose on +X → −π/2.
   */
  noseYaw?: number
  propNames?: string[]
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
  const span = Math.max(rawSize.x, 0.001)
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
  const propeller = findNode(model, propNames)
  if (!propeller) {
    console.warn(`[Steel] ${opts.name} propeller node not found — prop will not spin`)
  }

  const propAxis = propeller ? localSpinAxis(propeller) : new THREE.Vector3(0, 1, 0)
  if (propeller) {
    console.info(
      `[Steel] ${opts.name} prop axis (local) = ${propAxis.x},${propAxis.y},${propAxis.z} · span ${size.x.toFixed(2)}m`,
    )
  }

  return {
    root,
    model,
    propeller,
    propAxis,
    nose,
    wingspan: size.x,
    lengthM: size.z,
    spinProp(dt, throttle01) {
      if (!propeller) return
      const rps = PROP_IDLE_RPS + THREE.MathUtils.clamp(throttle01, 0, 1) * PROP_MAX_RPS
      propeller.rotateOnAxis(propAxis, dt * rps * Math.PI * 2)
    },
  }
}

/** F4U-1A — export already Y-up with nose on +Z. */
export async function loadCorsair(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: CORSAIR_URL,
    name: 'corsair',
    targetWingspan: 12.5,
    propNames: ['ProBlades', 'Prop_Blades', 'Propeller'],
  })
}

/** Yak-9 — Sketchfab pack has nose on +X; bake −90° yaw to game +Z. */
export async function loadYak9(): Promise<AircraftHandle> {
  return loadAircraftRig({
    url: YAK9_URL,
    name: 'yak9',
    targetWingspan: 9.74,
    noseYaw: -Math.PI / 2,
    propNames: ['Yak-9_Propellor', 'Yak-9_Propeller', 'Yak-9_Propulsion'],
  })
}

/** Load the aircraft chosen on the menu / AI slot. */
export async function loadPlayerAircraft(id: TankId): Promise<AircraftHandle> {
  const opt = tankOptionById(id)
  if (!opt.aircraft) throw new Error(`Not an aircraft: ${id}`)
  if (id === 'yak9') return loadYak9()
  return loadCorsair()
}
