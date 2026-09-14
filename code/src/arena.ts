import * as THREE from 'three'
import { createSandstoneTexture } from './textures'

const WALL_HEIGHT = 3.2
const WALL_THICKNESS = 0.6

export type ArenaHalf = {
  x: number
  z: number
}

/**
 * Visible low perimeter walls — rectangular playable area (sizeX × sizeZ).
 * Returns half-extents a tank center may reach (inside walls).
 */
export function addArenaWalls(
  scene: THREE.Scene,
  sizeX: number,
  sizeZ: number = sizeX,
): ArenaHalf {
  const wallMap = createSandstoneTexture(
    Math.max(6, Math.max(sizeX, sizeZ) / 28),
    WALL_HEIGHT / 1.6,
  )
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd4c4a8,
    map: wallMap,
    roughness: 0.92,
    metalness: 0.04,
  })

  const halfX = sizeX / 2
  const halfZ = sizeZ / 2

  const specs: Array<{ w: number; d: number; x: number; z: number }> = [
    { w: sizeX + WALL_THICKNESS, d: WALL_THICKNESS, x: 0, z: -halfZ },
    { w: sizeX + WALL_THICKNESS, d: WALL_THICKNESS, x: 0, z: halfZ },
    { w: WALL_THICKNESS, d: sizeZ + WALL_THICKNESS, x: -halfX, z: 0 },
    { w: WALL_THICKNESS, d: sizeZ + WALL_THICKNESS, x: halfX, z: 0 },
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

  return {
    x: halfX - WALL_THICKNESS / 2,
    z: halfZ - WALL_THICKNESS / 2,
  }
}

/**
 * Hard-stop XZ clamp for ground vehicles (tanks / SPG / AI).
 */
export function clampToArena(
  position: THREE.Vector3,
  playable: ArenaHalf,
  tankRadius: number,
): boolean {
  const limX = playable.x - tankRadius
  const limZ = playable.z - tankRadius
  const x0 = position.x
  const z0 = position.z
  position.x = THREE.MathUtils.clamp(position.x, -limX, limX)
  position.z = THREE.MathUtils.clamp(position.z, -limZ, limZ)
  return position.x !== x0 || position.z !== z0
}
