/**
 * Steel multiplayer room — Durable Object WebSocket relay (lobby for MP1).
 * Host-authoritative game traffic will reuse this DO in later steps.
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
}

const MAX_PLAYERS = 2

function lobbyPayload(seats: Seat[]) {
  return {
    t: 'lobby' as const,
    players: seats.map((s) => ({
      id: s.userId,
      username: s.username,
      host: s.host,
    })),
  }
}

export class SteelRoom implements DurableObject {
  private seats = new Map<WebSocket, Seat>()

  constructor(
    private readonly ctx: DurableObjectState,
    _env: RoomEnv,
  ) {
    // Restore after hibernation
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

    // Drop stale sockets for same user (reconnect)
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
    const seat: Seat = { userId, username, host }
    server.serializeAttachment(seat)
    this.seats.set(server, seat)

    const welcome = JSON.stringify({
      t: 'welcome',
      code: roomCode,
      you: { id: userId, username, host },
      players: [...this.seats.values()].map((s) => ({
        id: s.userId,
        username: s.username,
        host: s.host,
      })),
      max: MAX_PLAYERS,
    })
    server.send(welcome)
    this.broadcastLobby(server)

    console.info(
      `[SteelRoom] join user=${username} host=${host} n=${this.seats.size} room=${roomCode}`,
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    let data: { t?: string }
    try {
      data = JSON.parse(message) as { t?: string }
    } catch {
      ws.send(JSON.stringify({ t: 'error', message: 'Bad JSON' }))
      return
    }

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

    // Lobby-only for MP1 — ignore unknown (future: input / start)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _clean: boolean): Promise<void> {
    const seat = this.seats.get(ws)
    this.seats.delete(ws)
    if (seat) {
      console.info(
        `[SteelRoom] leave user=${seat.username} code=${code} reason=${reason || '-'} n=${this.seats.size}`,
      )
      // Promote a remaining seat to host if host left
      if (seat.host && this.seats.size > 0) {
        const next = this.seats.entries().next().value as [WebSocket, Seat] | undefined
        if (next) {
          const [nws, nseat] = next
          nseat.host = true
          nws.serializeAttachment(nseat)
        }
      }
      this.broadcastLobby()
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
    this.broadcastLobby()
  }

  private broadcastLobby(except?: WebSocket): void {
    const msg = JSON.stringify(lobbyPayload([...this.seats.values()]))
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
