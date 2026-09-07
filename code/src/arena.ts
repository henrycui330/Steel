import * as THREE from 'three'
import { createSandstoneTexture } from './textures'

const WALL_HEIGHT = 2.5
const WALL_THICKNESS = 0.6

/**
 * Adds four visible arena walls around a square ground of `arenaSize`.
 * Returns the half-extent the tank center may reach (inside walls).
 */
export function addArenaWalls(scene: THREE.Scene, arenaSize: number): number {
  const wallMap = createSandstoneTexture(
    Math.max(6, arenaSize / 28),
    WALL_HEIGHT / 1.6,
  )
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd4c4a8,
    map: wallMap,
    roughness: 0.92,
    metalness: 0.04,
  })

  const half = arenaSize / 2
  const length = arenaSize + WALL_THICKNESS

  const specs: Array<{ w: number; d: number; x: number; z: number }> = [
    { w: length, d: WALL_THICKNESS, x: 0, z: -half }, // north (-Z)
    { w: length, d: WALL_THICKNESS, x: 0, z: half }, // south (+Z)
    { w: WALL_THICKNESS, d: length, x: -half, z: 0 }, // west (-X)
    { w: WALL_THICKNESS, d: length, x: half, z: 0 }, // east (+X)
  ]

  for (const s of specs) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, WALL_HEIGHT, s.d),
      wallMat,
    )
    wall.position.set(s.x, WALL_HEIGHT / 2, s.z)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
  }

  return half - WALL_THICKNESS / 2
}

/** Clamp tank XZ so it stays inside the arena. Returns true if clamped (hard-stop). */
export function clampToArena(
  position: THREE.Vector3,
  playableHalf: number,
  tankRadius: number,
): boolean {
  const limit = playableHalf - tankRadius
  const x0 = position.x
  const z0 = position.z
  position.x = THREE.MathUtils.clamp(position.x, -limit, limit)
  position.z = THREE.MathUtils.clamp(position.z, -limit, limit)
  return position.x !== x0 || position.z !== z0
}
