import { getSession, getSteelApiBase } from '../auth'
import { parseMpServerMsg, type MpClientMsg, type MpPlayer, type MpServerMsg } from './mpProtocol'

export type MpLobbyState = {
  code: string
  you: MpPlayer | null
  players: MpPlayer[]
  max: number
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  error: string
}

type LobbyListener = (state: MpLobbyState) => void

function httpToWsBase(apiBase: string): string {
  if (apiBase.startsWith('/')) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${apiBase}`
  }
  const u = new URL(apiBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.origin
}

function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < 5; i++) s += alphabet[bytes[i]! % alphabet.length]!
  return s
}

export async function createMpRoom(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const base = getSteelApiBase()
  const session = getSession()
  if (!base) return { ok: false, error: 'Online API not configured (VITE_STEEL_API).' }
  if (!session || session.mode !== 'online' || !session.token) {
    return { ok: false, error: 'Sign in Online to create a room.' }
  }
  try {
    const res = await fetch(`${base}/mp/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: '{}',
      cache: 'no-store',
    })
    const data = (await res.json()) as { ok?: boolean; code?: string; error?: string }
    if (!res.ok || !data.ok || !data.code) {
      return { ok: false, error: data.error || `Could not create room (HTTP ${res.status}).` }
    }
    return { ok: true, code: data.code }
  } catch (err) {
    console.error('[Steel] createMpRoom', err)
    return { ok: false, error: 'Cannot reach multiplayer server.' }
  }
}

/** Normalize join codes typed by humans. */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export type MpClient = {
  getState: () => MpLobbyState
  subscribe: (fn: LobbyListener) => () => void
  connect: (code: string) => void
  send: (msg: MpClientMsg) => void
  disconnect: () => void
}

export function createMpClient(): MpClient {
  let ws: WebSocket | null = null
  let state: MpLobbyState = {
    code: '',
    you: null,
    players: [],
    max: 2,
    status: 'idle',
    error: '',
  }
  const listeners = new Set<LobbyListener>()

  function setState(patch: Partial<MpLobbyState>): void {
    state = { ...state, ...patch }
    for (const fn of listeners) fn(state)
  }

  function handleMsg(msg: MpServerMsg): void {
    if (msg.t === 'welcome') {
      setState({
        status: 'open',
        error: '',
        code: msg.code,
        you: msg.you,
        players: msg.players,
        max: msg.max,
      })
      console.info(
        `[Steel] MP welcome room=${msg.code} you=${msg.you.username} host=${msg.you.host} n=${msg.players.length}`,
      )
      return
    }
    if (msg.t === 'lobby') {
      setState({ players: msg.players })
      console.info(`[Steel] MP lobby n=${msg.players.length}`, msg.players.map((p) => p.username))
      return
    }
    if (msg.t === 'error') {
      setState({ error: msg.message })
      console.warn('[Steel] MP error', msg.message)
      return
    }
    if (msg.t === 'pong') return
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      fn(state)
      return () => listeners.delete(fn)
    },
    connect(codeRaw) {
      const code = normalizeRoomCode(codeRaw)
      const base = getSteelApiBase()
      const session = getSession()
      if (!base) {
        setState({ status: 'error', error: 'Online API not configured.' })
        return
      }
      if (!session || session.mode !== 'online' || !session.token) {
        setState({ status: 'error', error: 'Sign in Online to join.' })
        return
      }
      if (code.length < 4) {
        setState({ status: 'error', error: 'Enter a valid room code.' })
        return
      }

      this.disconnect()
      setState({
        status: 'connecting',
        error: '',
        code,
        you: null,
        players: [],
      })

      const wsBase = httpToWsBase(base)
      const url = `${wsBase}/mp/ws?room=${encodeURIComponent(code)}&token=${encodeURIComponent(session.token)}`
      console.info(`[Steel] MP connecting room=${code}`)
      const socket = new WebSocket(url)
      ws = socket

      socket.addEventListener('open', () => {
        if (ws !== socket) return
        console.info('[Steel] MP socket open')
      })
      socket.addEventListener('message', (ev) => {
        if (ws !== socket) return
        const msg = parseMpServerMsg(String(ev.data))
        if (msg) handleMsg(msg)
      })
      socket.addEventListener('close', (ev) => {
        if (ws !== socket) return
        ws = null
        const reason = ev.reason || `code ${ev.code}`
        console.info(`[Steel] MP closed ${reason}`)
        setState({
          status: 'closed',
          error: ev.code === 1000 ? '' : `Disconnected (${reason})`,
          you: null,
          players: [],
        })
      })
      socket.addEventListener('error', () => {
        console.error('[Steel] MP socket error')
        if (ws === socket) {
          setState({ status: 'error', error: 'WebSocket failed — is the Worker running?' })
        }
      })
    },
    send(msg) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(msg))
    },
    disconnect() {
      if (!ws) return
      const s = ws
      ws = null
      try {
        if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t: 'leave' } satisfies MpClientMsg))
      } catch {
        /* ignore */
      }
      try {
        s.close(1000, 'client')
      } catch {
        /* ignore */
      }
      setState({ status: 'idle', you: null, players: [], error: '' })
    },
  }
}

/** Suggest a local code when create API is unavailable (dev fallback — prefer createMpRoom). */
export function suggestLocalRoomCode(): string {
  return roomCode()
}
