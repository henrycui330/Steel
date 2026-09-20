import {
  hashPassword,
  newUserId,
  randomSaltB64,
  randomToken,
  verifyPassword,
} from './crypto'
import { SteelRoom, type RoomEnv } from './room'

export { SteelRoom }

export interface Env extends RoomEnv {}

type UserRow = {
  id: string
  username: string
  username_key: string
  pass_salt: string
  pass_hash: string
  wrap_id: string
  created_at: number
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Vite (and friends) may use :5173, :4173, :5174, etc. */
function isLocalDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ok =
    !origin ||
    allowed.includes(origin) ||
    allowed.includes('*') ||
    isLocalDevOrigin(origin)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  // Never echo a *wrong* allow-origin (old bug: denied → allowed[0] → browser TypeError).
  if (origin && ok) headers['Access-Control-Allow-Origin'] = origin
  else if (allowed.includes('*')) headers['Access-Control-Allow-Origin'] = '*'
  return headers
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(req, env),
    },
  })
}

function validateCredentials(username: string, password: string): string | null {
  const u = username.trim()
  if (u.length < 3 || u.length > 24) return 'Username must be 3–24 characters.'
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Username: letters, numbers, underscore only.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

function userPayload(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    profile: {
      wrapId: row.wrap_id,
      createdAt: row.created_at,
    },
  }
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization')
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7).trim() || null
}

async function userFromToken(env: Env, token: string): Promise<UserRow | null> {
  const now = Date.now()
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run()
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, now)
    .first<UserRow>()
  return row ?? null
}

async function createSession(env: Env, user: UserRow) {
  const token = randomToken()
  const expiresAt = Date.now() + SESSION_TTL_MS
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(token, user.id, expiresAt)
    .run()
  return {
    userId: user.id,
    username: user.username,
    token,
    mode: 'online' as const,
  }
}

function makeRoomCode(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[bytes[i]! % ROOM_ALPHABET.length]!
  return s
}

function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) })
    }

    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (req.method === 'GET' && (path === '/' || path === '/health')) {
        return json(req, env, { ok: true, service: 'steel-auth', mp: true })
      }

      // —— Multiplayer ——
      if (req.method === 'POST' && path === '/mp/rooms') {
        const token = bearerToken(req)
        if (!token) return json(req, env, { ok: false, error: 'Not signed in.' }, 401)
        const user = await userFromToken(env, token)
        if (!user) return json(req, env, { ok: false, error: 'Session expired.' }, 401)
        if (!env.STEEL_ROOM) {
          return json(req, env, { ok: false, error: 'Multiplayer not configured on Worker.' }, 503)
        }
        const code = makeRoomCode()
        console.info(`[steel-auth] mp room create code=${code} by=${user.username}`)
        return json(req, env, { ok: true, code })
      }

      if (req.method === 'GET' && path === '/mp/ws') {
        const upgrade = req.headers.get('Upgrade')
        if (upgrade !== 'websocket') {
          return json(req, env, { ok: false, error: 'Expected WebSocket upgrade.' }, 426)
        }
        if (!env.STEEL_ROOM) {
          return new Response('Multiplayer not configured', { status: 503 })
        }

        const room = normalizeRoomCode(url.searchParams.get('room') ?? '')
        const token =
          url.searchParams.get('token')?.trim() ||
          bearerToken(req) ||
          ''
        if (room.length < 4) {
          return new Response('Bad room code', { status: 400 })
        }
        if (!token) return new Response('Not signed in', { status: 401 })

        const user = await userFromToken(env, token)
        if (!user) return new Response('Session expired', { status: 401 })

        const id = env.STEEL_ROOM.idFromName(room)
        const stub = env.STEEL_ROOM.get(id)
        const headers = new Headers(req.headers)
        headers.set('X-Steel-User-Id', user.id)
        headers.set('X-Steel-Username', user.username)
        headers.set('X-Steel-Room', room)
        // Preserve Upgrade so the DO can accept the WebSocket.
        return stub.fetch(new Request(req, { headers }))
      }

      if (req.method === 'GET' && path.startsWith('/mp/rooms/')) {
        const code = normalizeRoomCode(path.slice('/mp/rooms/'.length))
        if (code.length < 4 || !env.STEEL_ROOM) {
          return json(req, env, { ok: false, error: 'Not found.' }, 404)
        }
        const id = env.STEEL_ROOM.idFromName(code)
        const stub = env.STEEL_ROOM.get(id)
        const peek = await stub.fetch(new Request('https://room/peek'))
        const body = await peek.json()
        return json(req, env, body)
      }

      if (req.method === 'POST' && path === '/auth/register') {
        const body = (await req.json()) as { username?: string; password?: string }
        const username = String(body.username ?? '')
        const password = String(body.password ?? '')
        const err = validateCredentials(username, password)
        if (err) return json(req, env, { ok: false, error: err }, 400)

        const key = username.trim().toLowerCase()
        const existing = await env.DB.prepare(
          'SELECT id FROM users WHERE username_key = ?',
        )
          .bind(key)
          .first()
        if (existing) {
          return json(req, env, { ok: false, error: 'That username is taken.' }, 409)
        }

        const t0 = Date.now()
        const salt = randomSaltB64()
        const hash = await hashPassword(password, salt)
        const hashMs = Date.now() - t0
        const id = newUserId()
        const createdAt = Date.now()
        const display = username.trim()
        try {
          await env.DB.prepare(
            `INSERT INTO users (id, username, username_key, pass_salt, pass_hash, wrap_id, created_at)
             VALUES (?, ?, ?, ?, ?, 'stock', ?)`,
          )
            .bind(id, display, key, salt, hash, createdAt)
            .run()
        } catch (dbErr) {
          console.error('[steel-auth] register insert', dbErr)
          const msg = String(dbErr)
          if (/UNIQUE|constraint/i.test(msg)) {
            return json(req, env, { ok: false, error: 'That username is taken.' }, 409)
          }
          return json(req, env, { ok: false, error: 'Could not create account (database).' }, 500)
        }

        const row: UserRow = {
          id,
          username: display,
          username_key: key,
          pass_salt: salt,
          pass_hash: hash,
          wrap_id: 'stock',
          created_at: createdAt,
        }
        const session = await createSession(env, row)
        console.info(`[steel-auth] register ok user=${display} hashMs=${hashMs}`)
        return json(req, env, { ok: true, user: userPayload(row), session })
      }

      if (req.method === 'POST' && path === '/auth/login') {
        const body = (await req.json()) as { username?: string; password?: string }
        const username = String(body.username ?? '')
        const password = String(body.password ?? '')
        const err = validateCredentials(username, password)
        if (err) return json(req, env, { ok: false, error: err }, 400)

        const key = username.trim().toLowerCase()
        const row = await env.DB.prepare('SELECT * FROM users WHERE username_key = ?')
          .bind(key)
          .first<UserRow>()
        if (!row) {
          return json(req, env, { ok: false, error: 'Unknown username or password.' }, 401)
        }
        const ok = await verifyPassword(password, row.pass_salt, row.pass_hash)
        if (!ok) {
          return json(req, env, { ok: false, error: 'Unknown username or password.' }, 401)
        }
        const session = await createSession(env, row)
        return json(req, env, { ok: true, user: userPayload(row), session })
      }

      if (req.method === 'POST' && path === '/auth/logout') {
        const token = bearerToken(req)
        if (token) {
          await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
        }
        return json(req, env, { ok: true })
      }

      if (req.method === 'GET' && path === '/auth/me') {
        const token = bearerToken(req)
        if (!token) return json(req, env, { ok: false, error: 'Not signed in.' }, 401)
        const row = await userFromToken(env, token)
        if (!row) return json(req, env, { ok: false, error: 'Session expired.' }, 401)
        return json(req, env, { ok: true, user: userPayload(row) })
      }

      if (req.method === 'PATCH' && path === '/auth/profile') {
        const token = bearerToken(req)
        if (!token) return json(req, env, { ok: false, error: 'Not signed in.' }, 401)
        const row = await userFromToken(env, token)
        if (!row) return json(req, env, { ok: false, error: 'Session expired.' }, 401)

        const body = (await req.json()) as { wrapId?: string }
        const wrapId = typeof body.wrapId === 'string' ? body.wrapId : row.wrap_id
        await env.DB.prepare('UPDATE users SET wrap_id = ? WHERE id = ?')
          .bind(wrapId, row.id)
          .run()
        row.wrap_id = wrapId
        return json(req, env, { ok: true, user: userPayload(row) })
      }

      return json(req, env, { ok: false, error: 'Not found.' }, 404)
    } catch (err) {
      console.error('[steel-auth]', err)
      return json(req, env, { ok: false, error: 'Server error.' }, 500)
    }
  },
}
