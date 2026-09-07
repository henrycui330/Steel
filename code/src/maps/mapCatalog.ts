import * as THREE from 'three'
import {
  FOREST_OVERWATCH_SIZE,
  loadForestOverwatch,
} from './forestOverwatch'
import {
  DUSTY_SIZE,
  loadALittleDusty,
} from './aLittleDusty'
import type { PropCollider } from '../collision'

export type MapId = 'forest' | 'dusty'

export type TeamSpawns = {
  red: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
  blue: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

export type MapOption = {
  id: MapId
  name: string
  blurb: string
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
  red: triple([-80, -320], [0, -340], [80, -320]),
  blue: triple([-80, 320], [0, 340], [80, 320]),
}

const DUSTY_SPAWNS: TeamSpawns = {
  red: triple([-180, -300], [0, -330], [180, -300]),
  blue: triple([-180, 300], [0, 330], [180, 300]),
}

export const MAP_OPTIONS: MapOption[] = [
  {
    id: 'forest',
    name: 'Forest Overwatch',
    blurb: '1000m flat arena · pine cover · open center',
    size: FOREST_OVERWATCH_SIZE,
    playerSpawn: FOREST_SPAWNS.red[1].clone(),
    enemySpawn: FOREST_SPAWNS.blue[1].clone(),
    spawns: FOREST_SPAWNS,
    useArenaWalls: true,
  },
  {
    id: 'dusty',
    name: 'A little dusty',
    blurb: '1000m desert · dunes · houses · camps',
    size: DUSTY_SIZE,
    playerSpawn: DUSTY_SPAWNS.red[1].clone(),
    enemySpawn: DUSTY_SPAWNS.blue[1].clone(),
    spawns: DUSTY_SPAWNS,
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
}

export async function loadMap(
  id: MapId,
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<MapLoadResult> {
  if (id === 'dusty') return loadALittleDusty(scene, ground)
  const forest = await loadForestOverwatch(scene, ground)
  return { ...forest, groundY: 0 }
}
