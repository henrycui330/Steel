import * as THREE from 'three'
import {
  type ArmorPartDef,
  type ArmorPartId,
  type HitResolution,
  type ShellImpact,
  PZ3_ARMOR,
  resolveArmorHit,
} from './armor'

export type PartHitVolumes = {
  /** Refresh world matrices from the tank root (call if it moves). */
  updateWorld: () => void
  /**
   * If `worldPoint` is inside the tank, resolve which plate was struck.
   * Uses `velocity` for incidence angle.
   */
  resolveHit: (
    worldPoint: THREE.Vector3,
    velocity: THREE.Vector3,
    shellStats: Omit<ShellImpact, 'speed'>,
  ) => HitResolution | null
}

type LocalPart = {
  def: ArmorPartDef
  /** AABB in tank-root local space. */
  box: THREE.Box3
  /** Preferred outward normal in local space (unit). */
  normalLocal: THREE.Vector3
}

const _local = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _normalWorld = new THREE.Vector3()
const _dir = new THREE.Vector3()

/**
 * Build gameplay hit volumes from the tank's world bounds.
 * Local +Z = hull forward (Newc42 models after our yaw convention).
 */
export function createTankHitVolumes(
  root: THREE.Object3D,
  armorTable: Record<ArmorPartId, ArmorPartDef> = PZ3_ARMOR,
): PartHitVolumes {
  root.updateMatrixWorld(true)
  const worldBox = new THREE.Box3().setFromObject(root)

  // Local AABB from world corners (handles root yaw)
  _inv.copy(root.matrixWorld).invert()
  const corners: THREE.Vector3[] = []
  for (const x of [worldBox.min.x, worldBox.max.x]) {
    for (const y of [worldBox.min.y, worldBox.max.y]) {
      for (const z of [worldBox.min.z, worldBox.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyMatrix4(_inv))
      }
    }
  }
  const localBox = new THREE.Box3().setFromPoints(corners)
  const min = localBox.min.clone()
  const max = localBox.max.clone()
  const mid = localBox.getCenter(new THREE.Vector3())
  const frontDepth = (max.z - min.z) * 0.28
  const rearDepth = (max.z - min.z) * 0.28
  const sideWidth = (max.x - min.x) * 0.22
  const trackHeight = min.y + (max.y - min.y) * 0.38
  const turretFloor = min.y + (max.y - min.y) * 0.55
  /** Thin hull↔turret gap — hard to hit, catastrophic if you do. */
  const ringHalfH = (max.y - min.y) * 0.035
  const ringY0 = turretFloor - ringHalfH
  const ringY1 = turretFloor + ringHalfH
  const turretBottom = ringY1 + 0.02

  const parts: LocalPart[] = [
    {
      def: armorTable.gun,
      box: new THREE.Box3(
        new THREE.Vector3(mid.x - (max.x - min.x) * 0.12, turretBottom, mid.z + (max.z - min.z) * 0.05),
        new THREE.Vector3(mid.x + (max.x - min.x) * 0.12, max.y * 0.95, max.z + 0.15),
      ),
      normalLocal: new THREE.Vector3(0, 0, 1),
    },
    // Checked before turret/hull so a shot into the gap claims the ring.
    {
      def: armorTable.turretRing,
      box: new THREE.Box3(
        new THREE.Vector3(
          mid.x - (max.x - min.x) * 0.2,
          ringY0,
          mid.z - (max.z - min.z) * 0.16,
        ),
        new THREE.Vector3(
          mid.x + (max.x - min.x) * 0.2,
          ringY1,
          mid.z + (max.z - min.z) * 0.16,
        ),
      ),
      normalLocal: new THREE.Vector3(0, 1, 0),
    },
    {
      def: armorTable.turret,
      box: new THREE.Box3(
        new THREE.Vector3(min.x + sideWidth * 0.5, turretBottom, min.z + rearDepth * 0.6),
        new THREE.Vector3(max.x - sideWidth * 0.5, max.y, max.z - frontDepth * 0.35),
      ),
      normalLocal: new THREE.Vector3(0, 0, 1),
    },
    {
      def: armorTable.tracks,
      box: new THREE.Box3(
        new THREE.Vector3(min.x - 0.05, min.y, min.z + 0.05),
        new THREE.Vector3(min.x + sideWidth, trackHeight, max.z - 0.05),
      ),
      normalLocal: new THREE.Vector3(-1, 0, 0),
    },
    {
      def: armorTable.tracks,
      box: new THREE.Box3(
        new THREE.Vector3(max.x - sideWidth, min.y, min.z + 0.05),
        new THREE.Vector3(max.x + 0.05, trackHeight, max.z - 0.05),
      ),
      normalLocal: new THREE.Vector3(1, 0, 0),
    },
  // Hull plates stop below the ring so they don't steal ring hits.
  {
      def: armorTable.hullFront,
      box: new THREE.Box3(
        new THREE.Vector3(min.x + sideWidth * 0.3, min.y, max.z - frontDepth),
        new THREE.Vector3(max.x - sideWidth * 0.3, ringY0, max.z + 0.08),
      ),
      normalLocal: new THREE.Vector3(0, 0, 1),
    },
    {
      def: armorTable.hullRear,
      box: new THREE.Box3(
        new THREE.Vector3(min.x + sideWidth * 0.3, min.y, min.z - 0.08),
        new THREE.Vector3(max.x - sideWidth * 0.3, ringY0, min.z + rearDepth),
      ),
      normalLocal: new THREE.Vector3(0, 0, -1),
    },
    {
      def: armorTable.hullSide,
      box: new THREE.Box3(
        new THREE.Vector3(min.x - 0.05, trackHeight * 0.7, min.z + rearDepth * 0.5),
        new THREE.Vector3(min.x + sideWidth * 1.1, ringY0, max.z - frontDepth * 0.5),
      ),
      normalLocal: new THREE.Vector3(-1, 0, 0),
    },
    {
      def: armorTable.hullSide,
      box: new THREE.Box3(
        new THREE.Vector3(max.x - sideWidth * 1.1, trackHeight * 0.7, min.z + rearDepth * 0.5),
        new THREE.Vector3(max.x + 0.05, ringY0, max.z - frontDepth * 0.5),
      ),
      normalLocal: new THREE.Vector3(1, 0, 0),
    },
  ]

  // Broad hull fallback
  const hullFallback: LocalPart = {
    def: armorTable.hullSide,
    box: localBox.clone().expandByScalar(0.05),
    normalLocal: new THREE.Vector3(0, 0, 1),
  }

  function pickNormal(part: LocalPart, localPoint: THREE.Vector3): THREE.Vector3 {
    // If inside a slab, use configured normal; else nearest-face normal of that box
    const b = part.box
    const dxL = localPoint.x - b.min.x
    const dxR = b.max.x - localPoint.x
    const dyB = localPoint.y - b.min.y
    const dyT = b.max.y - localPoint.y
    const dzR = localPoint.z - b.min.z
    const dzF = b.max.z - localPoint.z
    const faces: Array<{ d: number; n: THREE.Vector3 }> = [
      { d: dxL, n: new THREE.Vector3(-1, 0, 0) },
      { d: dxR, n: new THREE.Vector3(1, 0, 0) },
      { d: dyB, n: new THREE.Vector3(0, -1, 0) },
      { d: dyT, n: new THREE.Vector3(0, 1, 0) },
      { d: dzR, n: new THREE.Vector3(0, 0, -1) },
      { d: dzF, n: new THREE.Vector3(0, 0, 1) },
    ]
    faces.sort((a, b) => a.d - b.d)
    // Prefer the authoring normal when it's among the two closest faces
    const best = faces[0].n
    if (part.normalLocal.dot(best) > 0.5 || part.normalLocal.dot(faces[1]?.n ?? best) > 0.5) {
      return part.normalLocal.clone()
    }
    return best
  }

  return {
    updateWorld() {
      root.updateMatrixWorld(true)
    },
    resolveHit(worldPoint, velocity, shellStats) {
      _inv.copy(root.matrixWorld).invert()
      _local.copy(worldPoint).applyMatrix4(_inv)

      let hit: LocalPart | null = null
      for (const p of parts) {
        if (p.box.containsPoint(_local)) {
          hit = p
          break
        }
      }
      if (!hit) {
        if (!hullFallback.box.containsPoint(_local)) return null
        hit = hullFallback
        const z = _local.z
        const x = _local.x
        const zMid = (min.z + max.z) * 0.5
        if (z > zMid + (max.z - min.z) * 0.2)
          hit = { ...hit, def: armorTable.hullFront, normalLocal: new THREE.Vector3(0, 0, 1) }
        else if (z < zMid - (max.z - min.z) * 0.2)
          hit = { ...hit, def: armorTable.hullRear, normalLocal: new THREE.Vector3(0, 0, -1) }
        else if (Math.abs(x - mid.x) > (max.x - min.x) * 0.25) {
          hit = {
            ...hit,
            def: armorTable.hullSide,
            normalLocal: new THREE.Vector3(Math.sign(x - mid.x) || 1, 0, 0),
          }
        }
      }

      const nLocal = pickNormal(hit, _local)
      _normalWorld.copy(nLocal).transformDirection(root.matrixWorld).normalize()
      _dir.copy(velocity)
      if (_dir.lengthSq() < 1e-6) return null
      _dir.normalize()

      return resolveArmorHit(hit.def, _normalWorld, _dir, {
        speed: velocity.length(),
        basePenetration: shellStats.basePenetration,
        baseDamage: shellStats.baseDamage,
        blastDamage: shellStats.blastDamage,
      })
    },
  }
}
