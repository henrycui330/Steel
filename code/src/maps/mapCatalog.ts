import * as THREE from 'three'
import {
  FOREST_OVERWATCH_DEPTH,
  FOREST_OVERWATCH_SIZE,
  FOREST_OVERWATCH_WIDTH,
  loadForestOverwatch,
} from './forestOverwatch'
import type { PropCollider } from '../collision'

export type MapId = 'forest'

/** Sketch layout: 2 flank pads per team (no center spawn). */
export type TeamSpawns = {
  red: [THREE.Vector3, THREE.Vector3]
  blue: [THREE.Vector3, THREE.Vector3]
}

export type MapOption = {
  id: MapId
  name: string
  blurb: string
  /** X extent (width). */
  sizeX: number
  /** Z extent (depth / “height” on the map). */
  sizeZ: number
  /** Max axis — fog / shadows / legacy callers. */
  size: number
  /** @deprecated Prefer spawns — kept for older call sites. */
  playerSpawn: THREE.Vector3
  /** @deprecated Prefer spawns */
  enemySpawn: THREE.Vector3
  spawns: TeamSpawns
  /** Box walls around arena (skip when map has its own rim). */
  useArenaWalls: boolean
}

function pair(
  a: [number, number],
  b: [number, number],
): [THREE.Vector3, THREE.Vector3] {
  return [new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(b[0], 0, b[1])]
}

const L = FOREST_OVERWATCH_WIDTH / 2000

const FOREST_SPAWNS: TeamSpawns = {
  // Sketch: 2 south (red) · 2 north (blue)
  red: pair([-520 * L, -900 * L], [520 * L, -900 * L]),
  blue: pair([-520 * L, 900 * L], [520 * L, 900 * L]),
}

export const MAP_OPTIONS: MapOption[] = [
  {
    id: 'forest',
    name: 'Forest Overwatch',
    blurb: '3500×3500 · giant river · 2 spawns/side · points C / Midwood / A',
    sizeX: FOREST_OVERWATCH_WIDTH,
    sizeZ: FOREST_OVERWATCH_DEPTH,
    size: FOREST_OVERWATCH_SIZE,
    playerSpawn: FOREST_SPAWNS.red[0].clone(),
    enemySpawn: FOREST_SPAWNS.blue[0].clone(),
    spawns: FOREST_SPAWNS,
    useArenaWalls: true,
  },
]

export function mapOptionById(id: MapId): MapOption {
  const found = MAP_OPTIONS.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown map: ${id}`)
  return found
}

export type MapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
  groundY: number
  /** If set, drive/AI sample this instead of flat groundY. */
  heightAt?: (x: number, z: number) => number
  /** Optional road polylines for combat minimap. */
  paths?: Array<{ points: Array<{ x: number; z: number }> }>
  /** Optional river polylines for combat minimap. */
  rivers?: Array<{ points: Array<{ x: number; z: number }> }>
  /** Optional runtime spawns. */
  spawns?: TeamSpawns
  /** Distance-cull foliage around player (x,z world; optional rangeMul for air). */
  updateLod?: (x: number, z: number, rangeMul?: number) => void
}

export async function loadMap(
  id: MapId,
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<MapLoadResult> {
  void id
  return loadForestOverwatch(scene, ground)
}
