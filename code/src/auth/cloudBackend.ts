import type { AuthBackend, AuthResult, AuthUser, UserProfile } from './types'

async function postJson(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
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
        const res = await postJson(base, '/auth/register', { username, password })
        const data = (await res.json()) as AuthResult
        if (!data.ok) return data
        return {
          ok: true,
          user: data.user,
          session: { ...data.session, mode: 'online' },
        }
      } catch (err) {
        console.warn('[Steel] Online register failed', err)
        return { ok: false, error: 'Cannot reach auth server. Check VITE_STEEL_API / network.' }
      }
    },

    async login(username, password): Promise<AuthResult> {
      try {
        const res = await postJson(base, '/auth/login', { username, password })
        const data = (await res.json()) as AuthResult
        if (!data.ok) return data
        return {
          ok: true,
          user: data.user,
          session: { ...data.session, mode: 'online' },
        }
      } catch (err) {
        console.warn('[Steel] Online login failed', err)
        return { ok: false, error: 'Cannot reach auth server. Check VITE_STEEL_API / network.' }
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
        const res = await fetch(`${base}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
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
        const res = await fetch(`${base}/auth/profile`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        })
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
