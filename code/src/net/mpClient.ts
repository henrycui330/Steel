import { getSession, getSteelApiBase } from '../auth'
import {
  parseMpServerMsg,
  type MpClientMsg,
  type MpInput,
  type MpMatchPlayer,
  type MpPlayer,
  type MpServerMsg,
  type MpTankPose,
} from './mpProtocol'

export type MpLobbyState = {
  code: string
  you: MpPlayer | null
  players: MpPlayer[]
  max: number
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error' | 'starting'
  error: string
}

export type MpStartPayload = {
  mapId: string
  timeOfDay: string
  season: string
  weather: string
  players: MpMatchPlayer[]
}

type LobbyListener = (state: MpLobbyState) => void
type StartListener = (match: MpStartPayload) => void
type SnapListener = (tanks: MpTankPose[]) => void
type InputListener = (input: MpInput) => void
type PeerLeftListener = (message: string) => void

function httpToWsBase(apiBase: string): string {
  if (apiBase.startsWith('/')) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${apiBase}`
  }
  const u = new URL(apiBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.origin
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
  onStart: (fn: StartListener) => () => void
  onSnap: (fn: SnapListener) => () => void
  onInput: (fn: InputListener) => () => void
  onPeerLeft: (fn: PeerLeftListener) => () => void
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
  const startListeners = new Set<StartListener>()
  const snapListeners = new Set<SnapListener>()
  const inputListeners = new Set<InputListener>()
  const peerLeftListeners = new Set<PeerLeftListener>()

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
    if (msg.t === 'start') {
      setState({ status: 'starting', error: '' })
      console.info(
        `[Steel] MP start map=${msg.mapId} players=${msg.players.map((p) => `${p.username}:${p.tankId}`).join(' / ')}`,
      )
      for (const fn of startListeners) fn(msg)
      return
    }
    if (msg.t === 'snap') {
      for (const fn of snapListeners) fn(msg.tanks)
      return
    }
    if (msg.t === 'input') {
      const { t: _t, ...input } = msg
      for (const fn of inputListeners) fn(input)
      return
    }
    if (msg.t === 'peerLeft') {
      console.warn('[Steel] MP peerLeft', msg.message)
      for (const fn of peerLeftListeners) fn(msg.message)
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
    onStart(fn) {
      startListeners.add(fn)
      return () => startListeners.delete(fn)
    },
    onSnap(fn) {
      snapListeners.add(fn)
      return () => snapListeners.delete(fn)
    },
    onInput(fn) {
      inputListeners.add(fn)
      return () => inputListeners.delete(fn)
    },
    onPeerLeft(fn) {
      peerLeftListeners.add(fn)
      return () => peerLeftListeners.delete(fn)
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
        if (state.status === 'starting') return
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
