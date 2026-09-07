import * as THREE from 'three'

export type WheelSet = {
  left: THREE.Object3D[]
  right: THREE.Object3D[]
  /** Approx wheel radius in world units (after tank normalize). */
  radius: number
}

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _axis = new THREE.Vector3()

/**
 * If mesh verts are far from the object origin, spin orbits the wrong pivot
 * (looks like the whole track tumbling). Recenter geometry on the hub.
 */
function ensureHubOrigin(mesh: THREE.Mesh): void {
  let geom = mesh.geometry
  if (geom.userData.hubCentered) return
  if (!geom.boundingBox) geom.computeBoundingBox()
  const bb = geom.boundingBox
  if (!bb) return
  bb.getCenter(_pos)
  if (_pos.lengthSq() < 1e-6) {
    geom.userData.hubCentered = true
    return
  }
  // clone — GLTF clones often share BufferGeometry across instances
  geom = geom.clone()
  geom.translate(-_pos.x, -_pos.y, -_pos.z)
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  geom.userData.hubCentered = true
  mesh.geometry = geom
  mesh.position.add(_pos)
}

function isWheelMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  if (!(obj instanceof THREE.Mesh) || !obj.name) return false
  const n = obj.name.toLowerCase()
  // Fused Sketchfab assemblies (whole bogie / track run) — never spin these
  if (n === 'wheels' || n === 'tracks' || n === 'track') return false
  if (!n.includes('wheel')) return false

  _box.setFromObject(obj)
  _box.getSize(_size)
  const longest = Math.max(_size.x, _size.y, _size.z)
  // Real road wheels are small; a multi-meter chunk is a fused mesh
  if (longest > 1.25) return false
  return true
}

function sideOf(obj: THREE.Object3D): 'left' | 'right' | 'unknown' {
  const n = obj.name.toLowerCase()
  if (n.includes('left') || n.includes('wheelsl') || /wheelsl/.test(n)) return 'left'
  if (n.includes('right') || n.includes('wheelsr') || /wheelsr/.test(n)) return 'right'
  // Geometry-baked hubs often sit on identity nodes — use AABB center, not origin.
  _box.setFromObject(obj)
  _box.getCenter(_pos)
  if (_pos.x < -0.05) return 'left'
  if (_pos.x > 0.05) return 'right'
  return 'unknown'
}

/**
 * Local axis that best matches world left/right (tank lateral = +X when facing +Z).
 * Abrams (rotated −90° Y) uses local Y; Newc42-style wheels use local X.
 */
function detectSpinAxis(obj: THREE.Object3D): 'x' | 'y' | 'z' {
  const tagged = obj.userData.wheelSpinAxis
  if (tagged === 'x' || tagged === 'y' || tagged === 'z') return tagged

  obj.getWorldQuaternion(_quat)
  let best: 'x' | 'y' | 'z' = 'x'
  let bestDot = -1
  for (const axis of ['x', 'y', 'z'] as const) {
    _axis.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
    _axis.applyQuaternion(_quat)
    const d = Math.abs(_axis.x) // world lateral
    if (d > bestDot) {
      bestDot = d
      best = axis
    }
  }
  obj.userData.wheelSpinAxis = best
  return best
}

function applySpin(obj: THREE.Object3D, delta: number): void {
  const axis = detectSpinAxis(obj)
  if (axis === 'y') obj.rotation.y += delta
  else if (axis === 'z') obj.rotation.z += delta
  else obj.rotation.x += delta
}

/** Find individual road wheels (Tiger-style). Skip fused Wheels/Tracks assemblies. */
export function collectWheels(root: THREE.Object3D): WheelSet {
  root.updateMatrixWorld(true)
  const left: THREE.Object3D[] = []
  const right: THREE.Object3D[] = []
  let radius = 0.32

  root.traverse((obj) => {
    if (!isWheelMesh(obj)) return
    ensureHubOrigin(obj)
    detectSpinAxis(obj)
    const side = sideOf(obj)
    if (side === 'left') left.push(obj)
    else if (side === 'right') right.push(obj)
    else {
      left.push(obj)
      right.push(obj)
    }
    _box.setFromObject(obj)
    _box.getSize(_size)
    // Radius ≈ half the larger diameter axes (ignore thin axle span)
    const dims = [_size.x, _size.y, _size.z].sort((a, b) => a - b)
    const r = dims[2]! * 0.5
    if (r > 0.08 && r < 1.2) radius = THREE.MathUtils.clamp(r, 0.2, 0.55)
  })

  console.info(
    `[Steel] Wheels: L=${left.length} R=${right.length} radius≈${radius.toFixed(2)}`,
  )
  return { left, right, radius }
}

/**
 * Spin wheels from drive speed (m/s). Turn adds differential so pivots look alive.
 * Axle = local axis aligned with world left/right (see detectSpinAxis).
 */
export function updateWheels(
  wheels: WheelSet,
  dt: number,
  speed: number,
  turn: number,
): void {
  if (wheels.left.length + wheels.right.length === 0) return
  const r = Math.max(0.15, wheels.radius)
  // Differential: positive turn = left (A) → left track slower / reverse bias
  const diff = turn * Math.max(1.2, Math.abs(speed) * 0.35 + 1.8)
  const leftSpeed = speed - diff
  const rightSpeed = speed + diff
  const leftOmega = -leftSpeed / r
  const rightOmega = -rightSpeed / r
  for (const w of wheels.left) applySpin(w, leftOmega * dt)
  for (const w of wheels.right) applySpin(w, rightOmega * dt)
}
