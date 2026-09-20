/** Shared multiplayer message types (client ↔ SteelRoom DO). */

export type MpPlayer = {
  id: string
  username: string
  host: boolean
  tankId?: string
}

export type MpMatchPlayer = {
  id: string
  username: string
  host: boolean
  tankId: string
  team: 'red' | 'blue'
  spawnIndex: number
}

export type MpTankPose = {
  id: string
  x: number
  y: number
  z: number
  yaw: number
  turret: number
  barrel: number
}

/** Guest → host control packet (compact keys). */
export type MpInput = {
  /** Forward −1..1 */
  f: number
  /** Turn −1..1 (left +) */
  u: number
  /** Brake */
  b: boolean
  /** Fire held (MP4) */
  fire: boolean
  /** Aim local yaw (rad) */
  ay: number
  /** Aim local pitch (rad) */
  ap: number
}

export type MpClientMsg =
  | { t: 'ping' }
  | { t: 'leave' }
  | { t: 'tank'; tankId: string }
  | { t: 'start' }
  | { t: 'snap'; tanks: MpTankPose[] }
  | ({ t: 'input' } & MpInput)

export type MpServerMsg =
  | {
      t: 'welcome'
      code: string
      you: MpPlayer
      players: MpPlayer[]
      max: number
    }
  | { t: 'lobby'; players: MpPlayer[] }
  | {
      t: 'start'
      mapId: string
      timeOfDay: string
      season: string
      weather: string
      players: MpMatchPlayer[]
    }
  | { t: 'snap'; tanks: MpTankPose[] }
  | ({ t: 'input' } & MpInput)
  | { t: 'peerLeft'; message: string }
  | { t: 'pong' }
  | { t: 'error'; message: string }

export function parseMpServerMsg(raw: string): MpServerMsg | null {
  try {
    const data = JSON.parse(raw) as { t?: string }
    if (!data || typeof data.t !== 'string') return null
    return data as MpServerMsg
  } catch {
    return null
  }
}
