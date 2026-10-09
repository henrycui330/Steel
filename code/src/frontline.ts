import * as THREE from 'three'
import type { TeamId } from './nations'
import { FOREST_TOWNS, nearestRoadPoint, type ForestTown } from './maps/forestOverwatch'

/** Red / Vostok attacks north along the diagonal towns. */
export const FRONTLINE_ATTACKER: TeamId = 'red'
export const FRONTLINE_DEFENDER: TeamId = 'blue'

export const FRONTLINE_CAPTURE_SEC = 20
export const FRONTLINE_MATCH_SEC = 12 * 60
export const FRONTLINE_RESPAWN_SEC = 5

const SLOT_SPREAD = 24
const LAST_TOWN_NEXT = { x: 0, z: 2300 }

export function frontlineTowns(): readonly ForestTown[] {
  return FOREST_TOWNS
}

export type FrontlineState = {
  /** How many towns attackers currently hold, from the south end. */
  taken: number
  captureT: number
  recaptureT: number
  matchT: number
  winner: TeamId | null
}

export function createFrontlineState(): FrontlineState {
  return { taken: 0, captureT: 0, recaptureT: 0, matchT: 0, winner: null }
}

export function attackTown(state: FrontlineState): ForestTown | null {
  const towns = frontlineTowns()
  if (state.taken >= towns.length) return null
  return towns[state.taken] ?? null
}

export function spawnTown(state: FrontlineState): ForestTown | null {
  const towns = frontlineTowns()
  if (state.taken <= 0) return null
  return towns[state.taken - 1] ?? null
}

export function inFrontlineTown(
  town: { x: number; z: number; radius: number },
  x: number,
  z: number,
): boolean {
  return Math.hypot(x - town.x, z - town.z) <= town.radius * 0.82
}

function decay(value: number, dt: number, rate = 1): number {
  return Math.max(0, value - dt * rate)
}

export function tickFrontline(
  state: FrontlineState,
  dt: number,
  atkOnObj: number,
  defOnObj: number,
  atkOnSpawn: number,
  defOnSpawn: number,
): FrontlineState {
  if (state.winner) return state

  const towns = frontlineTowns()
  let { taken, captureT, recaptureT, matchT } = state
  let winner: TeamId | null = state.winner
  matchT += dt

  if (taken < towns.length) {
    if (atkOnObj > 0 && defOnObj === 0) captureT += dt
    else if (atkOnObj > 0 && defOnObj > 0) captureT = decay(captureT, dt, 0.6)
    else if (defOnObj > 0) captureT = decay(captureT, dt, 1.4)
    else captureT = decay(captureT, dt, 0.35)

    if (captureT >= FRONTLINE_CAPTURE_SEC) {
      taken += 1
      captureT = 0
      recaptureT = 0
      console.info(
        `[Steel] Frontline capture · ${taken}/${towns.length}` +
          (towns[taken - 1] ? ` · ${towns[taken - 1]!.name}` : ''),
      )
      if (taken >= towns.length) winner = FRONTLINE_ATTACKER
    }
  }

  if (!winner && taken > 0 && taken < towns.length) {
    if (defOnSpawn > 0 && atkOnSpawn === 0) recaptureT += dt
    else if (defOnSpawn > 0 && atkOnSpawn > 0) recaptureT = decay(recaptureT, dt, 0.6)
    else recaptureT = decay(recaptureT, dt, 0.5)

    if (recaptureT >= FRONTLINE_CAPTURE_SEC) {
      const lost = towns[taken - 1]
      taken -= 1
      recaptureT = 0
      captureT = 0
      console.info(
        `[Steel] Frontline recapture · attackers hold ${taken}/${towns.length}` +
          (lost ? ` · lost ${lost.name}` : ''),
      )
    }
  }

  if (!winner && matchT >= FRONTLINE_MATCH_SEC) {
    winner = FRONTLINE_DEFENDER
    console.info('[Steel] Frontline — time expired, defenders hold')
  }

  return { taken, captureT, recaptureT, matchT, winner }
}

function slotOffset(index: number): { x: number; z: number } {
  const a = -Math.PI / 2 + (index % 3) * ((Math.PI * 2) / 3)
  return { x: Math.cos(a) * SLOT_SPREAD, z: Math.sin(a) * SLOT_SPREAD }
}

/** Defender rally: road halfway from the contested town toward the next. */
export function defenderRally(state: FrontlineState): { x: number; z: number } {
  const towns = frontlineTowns()
  const atk = towns[Math.min(state.taken, towns.length - 1)]!
  const next = towns[state.taken + 1] ?? LAST_TOWN_NEXT
  return nearestRoadPoint((atk.x + next.x) * 0.5, (atk.z + next.z) * 0.5)
}

export function frontlineSpawnAnchor(
  state: FrontlineState,
  team: TeamId,
  index: number,
  mapSpawns: { red: THREE.Vector3[]; blue: THREE.Vector3[] },
): { x: number; z: number } {
  const off = slotOffset(index)
  if (team === FRONTLINE_ATTACKER) {
    const held = spawnTown(state)
    if (!held) {
      const base = mapSpawns.red[index] ?? mapSpawns.red[0]!
      return { x: base.x, z: base.z }
    }
    return { x: held.x + off.x, z: held.z + off.z }
  }
  const mid = defenderRally(state)
  return { x: mid.x + off.x, z: mid.z + off.z }
}

export function createFrontlineRings(
  scene: THREE.Scene,
  heightAt: (x: number, z: number) => number,
): THREE.Mesh[] {
  const rings: THREE.Mesh[] = []
  for (const town of frontlineTowns()) {
    const geo = new THREE.RingGeometry(town.radius * 0.78, town.radius * 0.86, 64)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9aa3a0,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = `FrontlineRing_${town.id}`
    mesh.position.set(town.x, heightAt(town.x, town.z) + 0.12, town.z)
    mesh.renderOrder = 2
    scene.add(mesh)
    rings.push(mesh)
  }
  return rings
}

export function frontlineHudPayload(state: FrontlineState): {
  taken: number
  townCount: number
  townName: string
  captureT: number
  recaptureT: number
  captureSec: number
  matchLeft: number
} {
  const towns = frontlineTowns()
  const atk = attackTown(state)
  return {
    taken: state.taken,
    townCount: towns.length,
    townName: atk?.name ?? 'All towns',
    captureT: state.captureT,
    recaptureT: state.recaptureT,
    captureSec: FRONTLINE_CAPTURE_SEC,
    matchLeft: FRONTLINE_MATCH_SEC - state.matchT,
  }
}

export function paintFrontlineRings(rings: THREE.Mesh[], state: FrontlineState): void {
  for (let i = 0; i < rings.length; i++) {
    const mat = rings[i]!.material
    if (!(mat instanceof THREE.MeshBasicMaterial)) continue
    if (i < state.taken) {
      mat.color.set(0xe23d3d)
      mat.opacity = 0.7
    } else if (i === state.taken) {
      mat.color.set(0xf5c400)
      mat.opacity = 0.85
    } else {
      mat.color.set(0x1aa3c4)
      mat.opacity = 0.4
    }
  }
}
