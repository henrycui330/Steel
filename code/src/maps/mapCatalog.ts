import * as THREE from 'three'
import {
  FOREST_OVERWATCH_DEPTH,
  FOREST_OVERWATCH_SIZE,
  FOREST_OVERWATCH_WIDTH,
  loadForestOverwatch,
} from './forestOverwatch'
import type { PropCollider } from '../collision'

/** Only Forest Overwatch is playable for now. */
export type MapId = 'forest'

export type TeamSpawns = {
  red: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
  blue: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
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

function triple(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  return [
    new THREE.Vector3(a[0], 0, a[1]),
    new THREE.Vector3(b[0], 0, b[1]),
    new THREE.Vector3(c[0], 0, c[1]),
  ]
}

const FOREST_SPAWNS: TeamSpawns = {
  red: triple([-60, -860], [0, -900], [60, -860]),
  blue: triple([-60, 860], [0, 900], [60, 860]),
}

export const MAP_OPTIONS: MapOption[] = [
  {
    id: 'forest',
    name: 'Forest Overwatch',
    blurb: '750×2000 pine hills · road clearings · 3 towns',
    sizeX: FOREST_OVERWATCH_WIDTH,
    sizeZ: FOREST_OVERWATCH_DEPTH,
    size: FOREST_OVERWATCH_SIZE,
    playerSpawn: FOREST_SPAWNS.red[1].clone(),
    enemySpawn: FOREST_SPAWNS.blue[1].clone(),
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
  /** Optional runtime spawns. */
  spawns?: TeamSpawns
}

export async function loadMap(
  id: MapId,
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<MapLoadResult> {
  void id
  return loadForestOverwatch(scene, ground)
}
