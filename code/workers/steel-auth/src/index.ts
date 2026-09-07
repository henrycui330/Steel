import {
  hashPassword,
  newUserId,
  randomSaltB64,
  randomToken,
  verifyPassword,
} from './crypto'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
}

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

function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ok = allowed.includes(origin) || allowed.includes('*')
  return {
    'Access-Control-Allow-Origin': ok ? origin || allowed[0] || '*' : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) })
    }

    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (req.method === 'GET' && (path === '/' || path === '/health')) {
        return json(req, env, { ok: true, service: 'steel-auth' })
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

        const salt = randomSaltB64()
        const hash = await hashPassword(password, salt)
        const id = newUserId()
        const createdAt = Date.now()
        const display = username.trim()
        await env.DB.prepare(
          `INSERT INTO users (id, username, username_key, pass_salt, pass_hash, wrap_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'stock', ?)`,
        )
          .bind(id, display, key, salt, hash, createdAt)
          .run()

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
