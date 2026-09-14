import type { AuthBackend, AuthResult, AuthUser, UserProfile } from './types'

const FETCH_TIMEOUT_MS = 20_000

async function readAuthResult(res: Response): Promise<AuthResult> {
  const text = await res.text()
  let data: Partial<AuthResult> & { error?: string } = {}
  try {
    data = text ? (JSON.parse(text) as AuthResult) : {}
  } catch {
    return {
      ok: false,
      error: `Auth server returned non-JSON (${res.status}). Try again in a moment.`,
    }
  }
  if (!data.ok) {
    return {
      ok: false,
      error:
        data.error ||
        (res.status === 0
          ? 'Cannot reach auth server.'
          : `Sign-up failed (HTTP ${res.status}).`),
    }
  }
  if (!data.user || !data.session) {
    return { ok: false, error: 'Auth server returned an incomplete response.' }
  }
  return { ok: true, user: data.user, session: data.session }
}

async function postJson(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export function getSteelApiBase(): string | null {
  const v = import.meta.env.VITE_STEEL_API
  if (!v || !String(v).trim()) return null
  return String(v).trim().replace(/\/$/, '')
}

export function createCloudflareAuthBackend(apiBase: string): AuthBackend {
  const base = apiBase.replace(/\/$/, '')

  return {
    mode: 'online',

    async register(username, password): Promise<AuthResult> {
      try {
        const t0 = performance.now()
        const res = await postJson(base, '/auth/register', { username, password })
        const result = await readAuthResult(res)
        console.info(
          `[Steel] Online register ${result.ok ? 'ok' : 'fail'} in ${(performance.now() - t0).toFixed(0)}ms` +
            (result.ok ? '' : ` — ${result.error}`),
        )
        if (!result.ok) return result
        return {
          ok: true,
          user: result.user,
          session: { ...result.session, mode: 'online' },
        }
      } catch (err) {
        console.warn('[Steel] Online register failed', err)
        const aborted = err instanceof Error && err.name === 'AbortError'
        return {
          ok: false,
          error: aborted
            ? 'Auth server timed out (20s). If using workers.dev, your network may block it — run local Worker (wrangler dev :8787) or use a VPN.'
            : `Cannot reach auth server (${base}). Check VITE_STEEL_API, CORS, network, or workers.dev block.`,
        }
      }
    },

    async login(username, password): Promise<AuthResult> {
      try {
        const t0 = performance.now()
        const res = await postJson(base, '/auth/login', { username, password })
        const result = await readAuthResult(res)
        console.info(
          `[Steel] Online login ${result.ok ? 'ok' : 'fail'} in ${(performance.now() - t0).toFixed(0)}ms` +
            (result.ok ? '' : ` — ${result.error}`),
        )
        if (!result.ok) return result
        return {
          ok: true,
          user: result.user,
          session: { ...result.session, mode: 'online' },
        }
      } catch (err) {
        console.warn('[Steel] Online login failed', err)
        const aborted = err instanceof Error && err.name === 'AbortError'
        return {
          ok: false,
          error: aborted
            ? 'Auth server timed out (20s). If using workers.dev, your network may block it — run local Worker (wrangler dev :8787) or use a VPN.'
            : `Cannot reach auth server (${base}). Check VITE_STEEL_API, CORS, network, or workers.dev block.`,
        }
      }
    },

    async logout(token: string): Promise<void> {
      try {
        await postJson(base, '/auth/logout', {}, token)
      } catch (err) {
        console.warn('[Steel] Online logout failed', err)
      }
    },

    async me(token: string): Promise<AuthUser | null> {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        let res: Response
        try {
          res = await fetch(`${base}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          })
        } finally {
          clearTimeout(timer)
        }
        const data = (await res.json()) as { ok: boolean; user?: AuthUser; error?: string }
        if (!data.ok || !data.user) return null
        return data.user
      } catch (err) {
        console.warn('[Steel] Online me failed', err)
        return null
      }
    },

    async updateProfile(token: string, patch: Partial<UserProfile>): Promise<AuthUser | null> {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        let res: Response
        try {
          res = await fetch(`${base}/auth/profile`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(patch),
            signal: ctrl.signal,
          })
        } finally {
          clearTimeout(timer)
        }
        const data = (await res.json()) as { ok: boolean; user?: AuthUser }
        if (!data.ok || !data.user) return null
        return data.user
      } catch (err) {
        console.warn('[Steel] Online profile failed', err)
        return null
      }
    },
  }
}

/** Stub used when Online is selected but VITE_STEEL_API is missing. */
export function createMissingApiBackend(): AuthBackend {
  const msg =
    'Online auth needs VITE_STEEL_API. See doc/cloudflare-auth.md (deploy Worker, then set .env).'
  return {
    mode: 'online',
    async register() {
      return { ok: false, error: msg }
    },
    async login() {
      return { ok: false, error: msg }
    },
    async logout() {},
    async me() {
      return null
    },
    async updateProfile() {
      return null
    },
  }
}
