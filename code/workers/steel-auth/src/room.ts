/**
 * Steel multiplayer room — Durable Object WebSocket relay.
 * Lobby + start + host snapshot fan-out (up to 6 players).
 */

export interface RoomEnv {
  DB: D1Database
  ALLOWED_ORIGINS: string
  STEEL_ROOM: DurableObjectNamespace
}

type Seat = {
  userId: string
  username: string
  host: boolean
  tankId?: string
}

const MAX_PLAYERS = 6
const MIN_START = 2
const DEFAULT_TANK = 'tiger'

function lobbyPayload(seats: Seat[]) {
  return {
    t: 'lobby' as const,
    players: seats.map((s) => ({
      id: s.userId,
      username: s.username,
      host: s.host,
      tankId: s.tankId,
    })),
  }
}

/** Host first, then stable id order; alternate red/blue with spawn slots 0–2. */
function matchPlayersFromSeats(seats: Seat[]) {
  const ordered = [...seats].sort((a, b) => {
    if (a.host !== b.host) return a.host ? -1 : 1
    return a.userId.localeCompare(b.userId)
  })
  return ordered.map((s, i) => ({
    id: s.userId,
    username: s.username,
    host: s.host,
    tankId: s.tankId || DEFAULT_TANK,
    team: (i % 2 === 0 ? 'red' : 'blue') as 'red' | 'blue',
    spawnIndex: Math.floor(i / 2) % 3,
  }))
}

export class SteelRoom implements DurableObject {
  private seats = new Map<WebSocket, Seat>()

  constructor(
    private readonly ctx: DurableObjectState,
    _env: RoomEnv,
  ) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Seat | null
      if (att?.userId) this.seats.set(ws, att)
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.headers.get('Upgrade') !== 'websocket') {
      if (req.method === 'GET' && url.pathname.endsWith('/peek')) {
        return Response.json({
          ok: true,
          players: [...this.seats.values()].map((s) => ({
            id: s.userId,
            username: s.username,
            host: s.host,
            tankId: s.tankId,
          })),
          max: MAX_PLAYERS,
        })
      }
      return new Response('Expected WebSocket', { status: 426 })
    }

    const userId = req.headers.get('X-Steel-User-Id')?.trim() ?? ''
    const username = req.headers.get('X-Steel-Username')?.trim() ?? ''
    const roomCode = req.headers.get('X-Steel-Room')?.trim() ?? ''
    if (!userId || !username) {
      return new Response('Missing user', { status: 401 })
    }

    for (const [ws, seat] of this.seats) {
      if (seat.userId === userId) {
        try {
          ws.close(1000, 'replaced')
        } catch {
          /* ignore */
        }
        this.seats.delete(ws)
      }
    }

    if (this.seats.size >= MAX_PLAYERS) {
      return new Response('Room full', { status: 409 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)

    const host = this.seats.size === 0
    const seat: Seat = { userId, username, host, tankId: DEFAULT_TANK }
    server.serializeAttachment(seat)
    this.seats.set(server, seat)

    const welcome = JSON.stringify({
      t: 'welcome',
      code: roomCode,
      you: { id: userId, username, host, tankId: seat.tankId },
      players: [...this.seats.values()].map((s) => ({
        id: s.userId,
        username: s.username,
        host: s.host,
        tankId: s.tankId,
      })),
      max: MAX_PLAYERS,
    })
    server.send(welcome)
    this.broadcast(JSON.stringify(lobbyPayload([...this.seats.values()])), server)

    console.info(
      `[SteelRoom] join user=${username} host=${host} n=${this.seats.size}/${MAX_PLAYERS} room=${roomCode}`,
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    let data: { t?: string; tankId?: string; tanks?: unknown }
    try {
      data = JSON.parse(message) as { t?: string; tankId?: string; tanks?: unknown }
    } catch {
      ws.send(JSON.stringify({ t: 'error', message: 'Bad JSON' }))
      return
    }

    const seat = this.seats.get(ws)
    if (!seat) return

    if (data.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong' }))
      return
    }

    if (data.t === 'leave') {
      try {
        ws.close(1000, 'leave')
      } catch {
        /* ignore */
      }
      return
    }

    if (data.t === 'tank' && typeof data.tankId === 'string') {
      const id = data.tankId.trim().slice(0, 32)
      if (!id) return
      seat.tankId = id
      ws.serializeAttachment(seat)
      this.broadcast(JSON.stringify(lobbyPayload([...this.seats.values()])))
      return
    }

    if (data.t === 'start') {
      if (!seat.host) {
        ws.send(JSON.stringify({ t: 'error', message: 'Only the host can start.' }))
        return
      }
      if (this.seats.size < MIN_START) {
        ws.send(
          JSON.stringify({
            t: 'error',
            message: `Need at least ${MIN_START} players to start.`,
          }),
        )
        return
      }
      const players = matchPlayersFromSeats([...this.seats.values()])
      const startMsg = {
        t: 'start' as const,
        mapId: 'forest',
        timeOfDay: 'day',
        season: 'summer',
        weather: 'clear',
        players,
      }
      console.info(
        `[SteelRoom] start n=${players.length} ${players.map((p) => `${p.username}:${p.tankId}:${p.team}`).join(' | ')}`,
      )
      this.broadcast(JSON.stringify(startMsg))
      return
    }

    if (data.t === 'snap' && seat.host && Array.isArray(data.tanks)) {
      this.broadcast(message, ws)
      return
    }

    if (data.t === 'input' && !seat.host) {
      // Stamp sender id so the host can drive multiple guests.
      const stamped = JSON.stringify({ ...(data as object), id: seat.userId })
      let delivered = 0
      for (const [ows, oseat] of this.seats) {
        if (!oseat.host) continue
        try {
          ows.send(stamped)
          delivered++
        } catch {
          /* ignore */
        }
      }
      if (delivered === 0) {
        console.warn('[SteelRoom] input dropped — no host seat')
      }
      return
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _clean: boolean): Promise<void> {
    const seat = this.seats.get(ws)
    this.seats.delete(ws)
    if (seat) {
      console.info(
        `[SteelRoom] leave user=${seat.username} code=${code} reason=${reason || '-'} n=${this.seats.size}`,
      )
      const leftMsg = JSON.stringify({
        t: 'peerLeft',
        message: seat.host ? 'Host left the match.' : `${seat.username} left the match.`,
      })
      for (const [ows] of this.seats) {
        try {
          ows.send(leftMsg)
        } catch {
          /* ignore */
        }
      }
      if (seat.host && this.seats.size > 0) {
        const next = this.seats.entries().next().value as [WebSocket, Seat] | undefined
        if (next) {
          const [nws, nseat] = next
          nseat.host = true
          nws.serializeAttachment(nseat)
        }
      }
      this.broadcast(JSON.stringify(lobbyPayload([...this.seats.values()])))
    }
    try {
      ws.close(code, reason)
    } catch {
      /* ignore */
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[SteelRoom] ws error', error)
    this.seats.delete(ws)
    this.broadcast(JSON.stringify(lobbyPayload([...this.seats.values()])))
  }

  private broadcast(msg: string, except?: WebSocket): void {
    for (const [ows] of this.seats) {
      if (ows === except) continue
      try {
        ows.send(msg)
      } catch {
        /* ignore */
      }
    }
  }
}
