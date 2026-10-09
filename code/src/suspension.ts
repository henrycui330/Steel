import * as THREE from 'three'
import type { WheelSet } from './wheels'
import type { TrackBand } from './tracks'

/** Max wheel compress into hull (m). */
const MAX_COMPRESS = 0.14
/** Max wheel droop below rest (m). */
const MAX_EXTEND = 0.1
/** Spring / damp toward terrain target (visual only). */
const SPRING = 48
const DAMP = 14
/** Ignore tiny errors (m). */
const EPS = 0.004
/** Top-run vertices pick up this fraction of travel (keeps upper tread steadier). */
const TOP_RUN_BLEND = 0.12
/** Half-gauge / half-run for virtual bogies when no wheel meshes. */
const VIRT_HALF_W = 1.1
const VIRT_HALF_L = 1.45
const VIRT_STATIONS = [-1, -0.5, 0, 0.5, 1] as const
/** Soft undulation so flat maps still show a little flex. */
const RELIEF = 0.035

const _world = new THREE.Vector3()
const _vertWorld = new THREE.Vector3()
const _bogie = new THREE.Vector3()
const _restLocal = new THREE.Vector3()
const _local = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _tankPos = new THREE.Vector3()

type SuspensionWheel = {
  /** Real road-wheel mesh, or null for virtual bogie. */
  obj: THREE.Object3D | null
  side: 'left' | 'right'
  /** Parent-local rest Y (real wheels only). */
  restY: number
  /** Local XZ offset from tank origin (virtual bogies). */
  localX: number
  localZ: number
  radius: number
  travel: number
  vel: number
}

type SuspensionTrack = {
  mesh: THREE.Mesh
  side: 'left' | 'right' | 'both'
  restPos: Float32Array
  midY: number
}

export type SuspensionRig = {
  wheelCount: number
  trackCount: number
  update: (
    dt: number,
    tank: THREE.Object3D,
    sampleY: (x: number, z: number) => number,
  ) => void
}

function relief(x: number, z: number): number {
  return (
    (Math.sin(x * 0.22) * Math.cos(z * 0.19) * 0.65 +
      Math.sin(x * 0.5 + z * 0.4) * 0.35) *
    RELIEF
  )
}

/**
 * Visual suspension: road wheels follow ground; track meshes bend to match.
 * Does not affect hull drive contact (TR1–2) — cosmetic only.
 */
export function createSuspension(
  tank: THREE.Object3D,
  wheels: WheelSet,
  bands: TrackBand[],
): SuspensionRig {
  tank.updateMatrixWorld(true)
  const radius = Math.max(0.18, wheels.radius)
  const suspWheels: SuspensionWheel[] = []

  for (const obj of wheels.left) {
    obj.getWorldPosition(_world)
    tank.worldToLocal(_world)
    suspWheels.push({
      obj,
      side: 'left',
      restY: obj.position.y,
      localX: _world.x,
      localZ: _world.z,
      radius,
      travel: 0,
      vel: 0,
    })
  }
  for (const obj of wheels.right) {
    obj.getWorldPosition(_world)
    tank.worldToLocal(_world)
    suspWheels.push({
      obj,
      side: 'right',
      restY: obj.position.y,
      localX: _world.x,
      localZ: _world.z,
      radius,
      travel: 0,
      vel: 0,
    })
  }

  // Fused chassis (no separate wheels) — virtual bogies so tracks still flex.
  if (suspWheels.length === 0) {
    for (const station of VIRT_STATIONS) {
      const z = station * VIRT_HALF_L
      for (const side of [-1, 1] as const) {
        suspWheels.push({
          obj: null,
          side: side < 0 ? 'left' : 'right',
          restY: 0,
          localX: side * VIRT_HALF_W,
          localZ: z,
          radius: 0.28,
          travel: 0,
          vel: 0,
        })
      }
    }
  }

  const tracks: SuspensionTrack[] = []
  const seen = new Set<string>()
  for (const band of bands) {
    if (band.hullSlice) continue
    const mesh = band.mesh
    if (seen.has(mesh.uuid)) continue
    seen.add(mesh.uuid)
    const geom = mesh.geometry
    const attr = geom.getAttribute('position')
    if (!attr || attr.count < 8) continue
    if (!geom.userData.suspensionRest) {
      const rest = new Float32Array(attr.count * 3)
      for (let v = 0; v < attr.count; v++) {
        rest[v * 3] = attr.getX(v)
        rest[v * 3 + 1] = attr.getY(v)
        rest[v * 3 + 2] = attr.getZ(v)
      }
      geom.userData.suspensionRest = rest
    }
    const restPos = geom.userData.suspensionRest as Float32Array
    let yMin = Infinity
    let yMax = -Infinity
    for (let v = 0; v < attr.count; v++) {
      const y = restPos[v * 3 + 1]!
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    tracks.push({
      mesh,
      side: band.side,
      restPos,
      midY: (yMin + yMax) * 0.5,
    })
  }

  const realWheels = suspWheels.filter((w) => w.obj).length
  console.info(
    `[Steel] Suspension · bendy · real wheels ${realWheels}` +
      (realWheels === 0 ? ` · virtual bogies ${suspWheels.length}` : '') +
      ` · track meshes ${tracks.length}`,
  )

  function bogieWorld(tankObj: THREE.Object3D, w: SuspensionWheel, out: THREE.Vector3): void {
    tankObj.getWorldPosition(_tankPos)
    const yaw = tankObj.rotation.y
    const sy = Math.sin(yaw)
    const cy = Math.cos(yaw)
    // local +Z forward, +X right — rest hub height ≈ tank Y + radius (visual)
    out.set(
      _tankPos.x + sy * w.localZ + cy * w.localX,
      _tankPos.y + w.radius,
      _tankPos.z + cy * w.localZ - sy * w.localX,
    )
  }

  function travelAt(
    x: number,
    z: number,
    side: 'left' | 'right' | 'both',
    tankObj: THREE.Object3D,
  ): number {
    let wSum = 0
    let tSum = 0
    for (const w of suspWheels) {
      if (side !== 'both' && w.side !== side) continue
      bogieWorld(tankObj, w, _bogie)
      const dx = _bogie.x - x
      const dz = _bogie.z - z
      const d2 = dx * dx + dz * dz + 0.08
      const wt = 1 / d2
      wSum += wt
      tSum += w.travel * wt
    }
    if (wSum < 1e-6) return 0
    return tSum / wSum
  }

  return {
    wheelCount: suspWheels.length,
    trackCount: tracks.length,
    update(dt, tankObj, sampleY) {
      if (suspWheels.length === 0 && tracks.length === 0) return
      const dtClamped = Math.min(dt, 0.05)
      tankObj.updateMatrixWorld(true)

      for (const w of suspWheels) {
        const curTravel = w.travel
        bogieWorld(tankObj, w, _world)
        const ground = sampleY(_world.x, _world.z) + relief(_world.x, _world.z)
        const contactY = ground + w.radius
        let target = contactY - _world.y
        target = THREE.MathUtils.clamp(target, -MAX_EXTEND, MAX_COMPRESS)
        if (Math.abs(target) < EPS) target = 0

        const accel = -SPRING * (curTravel - target) - DAMP * w.vel
        w.vel += accel * dtClamped
        w.travel = curTravel + w.vel * dtClamped
        w.travel = THREE.MathUtils.clamp(w.travel, -MAX_EXTEND, MAX_COMPRESS)
        if (Math.abs(w.travel) < 1e-4 && Math.abs(target) < EPS) {
          w.travel = 0
          w.vel = 0
        }
        if (w.obj) w.obj.position.y = w.restY + w.travel
      }

      if (tracks.length === 0) return

      for (const tr of tracks) {
        const pos = tr.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
        tr.mesh.updateMatrixWorld(true)
        _inv.copy(tr.mesh.matrixWorld).invert()
        const rest = tr.restPos
        for (let v = 0; v < pos.count; v++) {
          _restLocal.set(rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!)
          // Keep vertex world in _vertWorld — travelAt must not clobber it.
          _vertWorld.copy(_restLocal)
          tr.mesh.localToWorld(_vertWorld)
          let travel = travelAt(_vertWorld.x, _vertWorld.z, tr.side, tankObj)
          if (_restLocal.y > tr.midY) travel *= TOP_RUN_BLEND
          _vertWorld.y += travel
          _local.copy(_vertWorld).applyMatrix4(_inv)
          if (
            !Number.isFinite(_local.x) ||
            !Number.isFinite(_local.y) ||
            !Number.isFinite(_local.z)
          ) {
            pos.setXYZ(v, _restLocal.x, _restLocal.y, _restLocal.z)
          } else {
            pos.setXYZ(v, _local.x, _local.y, _local.z)
          }
        }
        pos.needsUpdate = true
      }
    },
  }
}
