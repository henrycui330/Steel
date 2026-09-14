import * as THREE from 'three'
import type { TeamId } from './nations'
import { nationByTeam } from './nations'

export const KOTH_WIN_SEC = 90
export const KOTH_RADIUS = 55
export const KOTH_CENTER = { x: 0, z: 0 }
export const KOTH_RESPAWN_SEC = 5

export type HillOwner = TeamId | 'contested' | 'none'

export type KothState = {
  vostokHold: number
  meridianHold: number
  owner: HillOwner
  winner: TeamId | null
}

export function createKothState(): KothState {
  return { vostokHold: 0, meridianHold: 0, owner: 'none', winner: null }
}

export function inHill(x: number, z: number): boolean {
  return Math.hypot(x - KOTH_CENTER.x, z - KOTH_CENTER.z) <= KOTH_RADIUS
}

export function tickKoth(
  state: KothState,
  dt: number,
  vostokAliveOnHill: number,
  meridianAliveOnHill: number,
): KothState {
  if (state.winner) return state

  let owner: HillOwner = 'none'
  if (vostokAliveOnHill > 0 && meridianAliveOnHill > 0) owner = 'contested'
  else if (vostokAliveOnHill > 0) owner = 'red'
  else if (meridianAliveOnHill > 0) owner = 'blue'

  let vostokHold = state.vostokHold
  let meridianHold = state.meridianHold
  if (owner === 'red') vostokHold += dt
  else if (owner === 'blue') meridianHold += dt

  let winner: TeamId | null = null
  if (vostokHold >= KOTH_WIN_SEC) winner = 'red'
  else if (meridianHold >= KOTH_WIN_SEC) winner = 'blue'

  return { vostokHold, meridianHold, owner, winner }
}

/** Ground ring on Midwood. Recolor with `setHillRingColor`. */
export function createHillRing(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.RingGeometry(KOTH_RADIUS - 2.4, KOTH_RADIUS, 72)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9aa3a0,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'KothHill'
  mesh.position.set(KOTH_CENTER.x, 0.12, KOTH_CENTER.z)
  mesh.renderOrder = 2
  scene.add(mesh)
  return mesh
}

export function setHillRingColor(mesh: THREE.Mesh, owner: HillOwner): void {
  const mat = mesh.material
  if (!(mat instanceof THREE.MeshBasicMaterial)) return
  if (owner === 'red') mat.color.set(nationByTeam('red').color)
  else if (owner === 'blue') mat.color.set(nationByTeam('blue').color)
  else if (owner === 'contested') mat.color.set(0xf5c400)
  else mat.color.set(0x9aa3a0)
}
