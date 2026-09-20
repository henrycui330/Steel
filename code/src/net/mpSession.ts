import type { MpClient } from './mpClient'
import type { MpMatchPlayer, MpTankPose } from './mpProtocol'

export type MpSession = {
  client: MpClient
  isHost: boolean
  myUserId: string
  matchPlayers: MpMatchPlayer[]
  /** Latest snap from host (guest); host may mirror for debug. */
  lastSnap: MpTankPose[] | null
}

let active: MpSession | null = null

export function setMpSession(session: MpSession | null): void {
  active = session
  if (session) {
    console.info(
      `[Steel] MP session ${session.isHost ? 'host' : 'guest'} user=${session.myUserId} n=${session.matchPlayers.length}`,
    )
  } else {
    console.info('[Steel] MP session cleared')
  }
}

export function getMpSession(): MpSession | null {
  return active
}

export function clearMpSession(): void {
  if (active) {
    try {
      active.client.disconnect()
    } catch {
      /* ignore */
    }
  }
  active = null
}
