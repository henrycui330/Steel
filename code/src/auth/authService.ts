import { createCloudflareAuthBackend, createMissingApiBackend, getSteelApiBase } from './cloudBackend'
import { createLocalAuthBackend } from './localBackend'
import type {
  AuthBackend,
  AuthMode,
  AuthResult,
  AuthSession,
  AuthUser,
  UserProfile,
} from './types'

const SESSION_KEY = 'steel.session'
const MODE_KEY = 'steel.authMode'

let backend: AuthBackend = createLocalAuthBackend()

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AuthSession
    if (!s?.token || !s?.username) return null
    return s
  } catch {
    return null
  }
}

function writeSession(session: AuthSession | null): void {
  if (!session) localStorage.removeItem(SESSION_KEY)
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function getPreferredAuthMode(): AuthMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    if (raw === 'online' || raw === 'offline') return raw
  } catch {
    /* private mode */
  }
  return 'offline'
}

function applyBackend(mode: AuthMode): void {
  if (mode === 'online') {
    const base = getSteelApiBase()
    if (base) {
      backend = createCloudflareAuthBackend(base)
      console.info('[Steel] Auth backend: online →', base)
    } else {
      backend = createMissingApiBackend()
      console.warn('[Steel] Auth online selected but VITE_STEEL_API unset')
    }
  } else {
    backend = createLocalAuthBackend()
    console.info('[Steel] Auth backend: offline (local)')
  }
}

export function setPreferredAuthMode(mode: AuthMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* private mode */
  }
  applyBackend(mode)
}

export function getSession(): AuthSession | null {
  return readSession()
}

export { getSteelApiBase }

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = readSession()
  if (!session) return null
  // Use the backend that matches the session (online vs offline accounts differ).
  applyBackend(session.mode)
  const user = await backend.me(session.token)
  if (!user) {
    writeSession(null)
    return null
  }
  return user
}

export async function register(username: string, password: string): Promise<AuthResult> {
  applyBackend(getPreferredAuthMode())
  const result = await backend.register(username, password)
  if (result.ok) writeSession(result.session)
  return result
}

export async function login(username: string, password: string): Promise<AuthResult> {
  applyBackend(getPreferredAuthMode())
  const result = await backend.login(username, password)
  if (result.ok) writeSession(result.session)
  return result
}

export async function logout(): Promise<void> {
  const session = readSession()
  if (session) {
    applyBackend(session.mode)
    await backend.logout(session.token)
  }
  writeSession(null)
}

export async function updateProfile(patch: Partial<UserProfile>): Promise<AuthUser | null> {
  const session = readSession()
  if (!session) return null
  applyBackend(session.mode)
  return backend.updateProfile(session.token, patch)
}

/** Call once at boot so preferred mode is applied. */
export function initAuth(): void {
  const session = readSession()
  applyBackend(session?.mode ?? getPreferredAuthMode())
}
