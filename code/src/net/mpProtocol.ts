/** Shared multiplayer message types (client ↔ SteelRoom DO). Lobby-only for MP1. */

export type MpPlayer = {
  id: string
  username: string
  host: boolean
}

export type MpClientMsg =
  | { t: 'ping' }
  | { t: 'leave' }

export type MpServerMsg =
  | {
      t: 'welcome'
      code: string
      you: MpPlayer
      players: MpPlayer[]
      max: number
    }
  | { t: 'lobby'; players: MpPlayer[] }
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
