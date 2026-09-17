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
const _localDir = new THREE.Vector3()

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

  /**
   * Plate normal for armour resolution.
   *
   * Always the **authored** outward normal for that plate — never the nearest
   * AABB face of the hit volume. Hits are point samples, so a sample that
   * lands deep in a plate box is nearer that box's *inner* face; picking by
   * proximity flipped the normal and made dead-on shots report ricochets
   * (`against <= 0.08`). Oblique ricochets still work: the tank's yaw rotates
   * the authored normal in world space, so a turned front plate still exceeds
   * `autoRicochetDeg`.
   *
   * After transforming to world, flip so the normal faces the incoming round
   * (in case a part table ever stores an inward vector).
   */
  function plateNormalWorld(
    part: LocalPart,
    incomingDir: THREE.Vector3,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    out.copy(part.normalLocal).transformDirection(root.matrixWorld).normalize()
    if (out.dot(incomingDir) > 0) out.negate()
    return out
  }

  /**
   * When a sample lands inside the broad hull (skipping a thin outer plate at
   * ~1.5 m/step), pick the plate the round *entered through* from its local
   * travel direction — not from where the sample sits inside.
   *
   * Entry face = the face opposing travel: a round with localDir.z > 0 came in
   * through the rear (−Z), not the front.
   */
  function hullFallbackFromDir(localDir: THREE.Vector3): LocalPart {
    const ax = Math.abs(localDir.x)
    const ay = Math.abs(localDir.y)
    const az = Math.abs(localDir.z)
    if (ay >= ax && ay >= az) {
      // Steep dive / loft into the roof — treat as turret ring vulnerability.
      return {
        def: armorTable.turretRing,
        box: hullFallback.box,
        normalLocal: new THREE.Vector3(0, localDir.y > 0 ? -1 : 1, 0),
      }
    }
    if (az >= ax) {
      if (localDir.z > 0) {
        // Traveling nose-ward → entered through the rear.
        return {
          def: armorTable.hullRear,
          box: hullFallback.box,
          normalLocal: new THREE.Vector3(0, 0, -1),
        }
      }
      return {
        def: armorTable.hullFront,
        box: hullFallback.box,
        normalLocal: new THREE.Vector3(0, 0, 1),
      }
    }
    // Traveling +X → entered through the left (−X) side.
    return {
      def: armorTable.hullSide,
      box: hullFallback.box,
      normalLocal: new THREE.Vector3(localDir.x > 0 ? -1 : 1, 0, 0),
    }
  }

  return {
    updateWorld() {
      root.updateMatrixWorld(true)
    },
    resolveHit(worldPoint, velocity, shellStats) {
      _inv.copy(root.matrixWorld).invert()
      _local.copy(worldPoint).applyMatrix4(_inv)

      _dir.copy(velocity)
      if (_dir.lengthSq() < 1e-6) return null
      _dir.normalize()
      _localDir.copy(_dir).transformDirection(_inv).normalize()

      let hit: LocalPart | null = null
      for (const p of parts) {
        if (p.box.containsPoint(_local)) {
          hit = p
          break
        }
      }
      if (!hit) {
        if (!hullFallback.box.containsPoint(_local)) return null
        hit = hullFallbackFromDir(_localDir)
      }

      plateNormalWorld(hit, _dir, _normalWorld)

      return resolveArmorHit(hit.def, _normalWorld, _dir, {
        speed: velocity.length(),
        basePenetration: shellStats.basePenetration,
        baseDamage: shellStats.baseDamage,
        blastDamage: shellStats.blastDamage,
      })
    },
  }
}
