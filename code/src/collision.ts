import * as THREE from 'three'

/**
 * Horizontal solid for map props (XZ).
 * Circles use `radius` only. Oriented boxes set `hx` + `hz` (+ optional `yaw`);
 * `radius` stays as circumradius for broad-phase / legacy callers.
 */
export type PropCollider = {
  x: number
  z: number
  radius: number
  /** Shells / agents above this height ignore the collider (tree canopy). */
  maxY: number
  /** Oriented box half-extent X (local). */
  hx?: number
  /** Oriented box half-extent Z (local). */
  hz?: number
  /** Box yaw (radians), same convention as Object3D.rotation.y. */
  yaw?: number
}

function isBox(c: PropCollider): c is PropCollider & { hx: number; hz: number } {
  return c.hx != null && c.hz != null
}

/** World → box-local XZ (matches Three.js Ry). */
function toLocal(dx: number, dz: number, yaw: number): { lx: number; lz: number } {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c }
}

/** Box-local → world delta XZ. */
function toWorld(lx: number, lz: number, yaw: number): { dx: number; dz: number } {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { dx: lx * c + lz * s, dz: -lx * s + lz * c }
}

/**
 * Push a circle (tank) out of overlapping props.
 * Returns true if any solid pushed the agent (caller should hard-stop).
 */
export function resolvePropCollisions(
  pos: THREE.Vector3,
  agentRadius: number,
  colliders: readonly PropCollider[],
  passes = 3,
): boolean {
  if (colliders.length === 0) return false

  let hit = false
  for (let pass = 0; pass < passes; pass++) {
    for (const c of colliders) {
      if (isBox(c)) {
        if (resolveCircleVsBox(pos, agentRadius, c)) hit = true
      } else if (resolveCircleVsCircle(pos, agentRadius, c)) {
        hit = true
      }
    }
  }
  return hit
}

function resolveCircleVsCircle(
  pos: THREE.Vector3,
  agentRadius: number,
  c: PropCollider,
): boolean {
  const dx = pos.x - c.x
  const dz = pos.z - c.z
  const minDist = agentRadius + c.radius
  const distSq = dx * dx + dz * dz
  if (distSq >= minDist * minDist) return false

  if (distSq < 1e-10) {
    pos.x += minDist
    return true
  }

  const dist = Math.sqrt(distSq)
  const push = (minDist - dist) / dist
  pos.x += dx * push
  pos.z += dz * push
  return true
}

function resolveCircleVsBox(
  pos: THREE.Vector3,
  agentRadius: number,
  c: PropCollider & { hx: number; hz: number },
): boolean {
  const yaw = c.yaw ?? 0
  const { lx, lz } = toLocal(pos.x - c.x, pos.z - c.z, yaw)
  const hx = c.hx
  const hz = c.hz

  const inside = Math.abs(lx) <= hx && Math.abs(lz) <= hz
  if (inside) {
    const penX = hx - Math.abs(lx)
    const penZ = hz - Math.abs(lz)
    let nlx = lx
    let nlz = lz
    if (penX < penZ) {
      nlx = lx >= 0 ? hx + agentRadius : -hx - agentRadius
    } else {
      nlz = lz >= 0 ? hz + agentRadius : -hz - agentRadius
    }
    const w = toWorld(nlx, nlz, yaw)
    pos.x = c.x + w.dx
    pos.z = c.z + w.dz
    return true
  }

  const closestX = THREE.MathUtils.clamp(lx, -hx, hx)
  const closestZ = THREE.MathUtils.clamp(lz, -hz, hz)
  const ox = lx - closestX
  const oz = lz - closestZ
  const distSq = ox * ox + oz * oz
  if (distSq >= agentRadius * agentRadius) return false

  if (distSq < 1e-10) {
    // On a face exactly — push along dominant axis
    if (Math.abs(lx) * hz > Math.abs(lz) * hx) {
      const nlx = lx >= 0 ? hx + agentRadius : -hx - agentRadius
      const w = toWorld(nlx, lz, yaw)
      pos.x = c.x + w.dx
      pos.z = c.z + w.dz
    } else {
      const nlz = lz >= 0 ? hz + agentRadius : -hz - agentRadius
      const w = toWorld(lx, nlz, yaw)
      pos.x = c.x + w.dx
      pos.z = c.z + w.dz
    }
    return true
  }

  const dist = Math.sqrt(distSq)
  const push = (agentRadius - dist) / dist
  const nlx = lx + ox * push
  const nlz = lz + oz * push
  const w = toWorld(nlx, nlz, yaw)
  pos.x = c.x + w.dx
  pos.z = c.z + w.dz
  return true
}

function pointHitsCollider(
  x: number,
  z: number,
  y: number,
  pointRadius: number,
  c: PropCollider,
): boolean {
  if (y - pointRadius > c.maxY) return false

  if (isBox(c)) {
    const yaw = c.yaw ?? 0
    const { lx, lz } = toLocal(x - c.x, z - c.z, yaw)
    if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return true
    const cx = THREE.MathUtils.clamp(lx, -c.hx, c.hx)
    const cz = THREE.MathUtils.clamp(lz, -c.hz, c.hz)
    const dx = lx - cx
    const dz = lz - cz
    return dx * dx + dz * dz < pointRadius * pointRadius
  }

  const dx = x - c.x
  const dz = z - c.z
  const minDist = c.radius + pointRadius
  return dx * dx + dz * dz < minDist * minDist
}

/** True if a point (with optional radius) overlaps any prop solid under maxY. */
export function hitsPropCollider(
  pos: THREE.Vector3,
  colliders: readonly PropCollider[],
  pointRadius = 0,
): boolean {
  for (const c of colliders) {
    if (pointHitsCollider(pos.x, pos.z, pos.y, pointRadius, c)) return true
  }
  return false
}

export type PropSolidKind = 'tree' | 'rock' | 'cliff' | 'stump' | 'log'

/** Estimate trunk/rock radius + shell-blocking height from prop role. */
export function estimatePropCollider(
  kind: PropSolidKind,
  height: number,
): Pick<PropCollider, 'radius' | 'maxY'> {
  switch (kind) {
    case 'tree':
      return {
        radius: THREE.MathUtils.clamp(height * 0.09, 0.55, 1.4),
        maxY: THREE.MathUtils.clamp(height * 0.28, 2.2, 4.5),
      }
    case 'rock':
      return {
        radius: THREE.MathUtils.clamp(height * 0.42, 1.1, 3.0),
        maxY: height * 0.95,
      }
    case 'cliff':
      return {
        radius: THREE.MathUtils.clamp(height * 0.5, 3.5, 7.5),
        maxY: height * 0.95,
      }
    case 'stump':
      return {
        radius: THREE.MathUtils.clamp(height * 0.45, 0.7, 1.6),
        maxY: height * 1.05,
      }
    case 'log':
      return {
        radius: THREE.MathUtils.clamp(height * 0.85, 0.9, 2.2),
        maxY: height * 1.1,
      }
  }
}
