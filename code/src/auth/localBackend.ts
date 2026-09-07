import type { WrapId } from '../wraps'
import { hashPassword, newUserId, randomSaltB64, randomToken, verifyPassword } from './crypto'
import type {
  AuthBackend,
  AuthResult,
  AuthSession,
  AuthUser,
  UserProfile,
} from './types'

const ACCOUNTS_KEY = 'steel.accounts.v1'
const SESSIONS_KEY = 'steel.localSessions.v1'

type StoredAccount = {
  id: string
  username: string
  salt: string
  hash: string
  profile: UserProfile
}

type StoredSession = {
  token: string
  userId: string
  expiresAt: number
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function readAccounts(): Record<string, StoredAccount> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, StoredAccount>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAccounts(map: Record<string, StoredAccount>): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(map))
}

function readSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSessions(list: StoredSession[]): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list))
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function validateCredentials(
  username: string,
  password: string,
): string | null {
  const u = username.trim()
  if (u.length < 3 || u.length > 24) return 'Username must be 3–24 characters.'
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Username: letters, numbers, underscore only.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

function toUser(acc: StoredAccount): AuthUser {
  return {
    id: acc.id,
    username: acc.username,
    profile: { ...acc.profile },
  }
}

function makeSession(user: AuthUser): AuthSession {
  const token = randomToken()
  const sessions = readSessions().filter((s) => s.expiresAt > Date.now())
  sessions.push({
    token,
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  writeSessions(sessions)
  return {
    userId: user.id,
    username: user.username,
    token,
    mode: 'offline',
  }
}

export function createLocalAuthBackend(): AuthBackend {
  return {
    mode: 'offline',

    async register(username, password): Promise<AuthResult> {
      const err = validateCredentials(username, password)
      if (err) return { ok: false, error: err }

      const key = normalizeUsername(username)
      const accounts = readAccounts()
      if (accounts[key]) return { ok: false, error: 'That username is taken.' }

      const salt = randomSaltB64()
      const hash = await hashPassword(password, salt)
      const displayName = username.trim()
      const acc: StoredAccount = {
        id: newUserId(),
        username: displayName,
        salt,
        hash,
        profile: {
          wrapId: 'stock' as WrapId,
          createdAt: Date.now(),
        },
      }
      accounts[key] = acc
      writeAccounts(accounts)

      const user = toUser(acc)
      const session = makeSession(user)
      console.info('[Steel] Auth local register:', user.username)
      return { ok: true, user, session }
    },

    async login(username, password): Promise<AuthResult> {
      const err = validateCredentials(username, password)
      if (err) return { ok: false, error: err }

      const key = normalizeUsername(username)
      const accounts = readAccounts()
      const acc = accounts[key]
      if (!acc) return { ok: false, error: 'Unknown username or password.' }

      const ok = await verifyPassword(password, acc.salt, acc.hash)
      if (!ok) return { ok: false, error: 'Unknown username or password.' }

      const user = toUser(acc)
      const session = makeSession(user)
      console.info('[Steel] Auth local login:', user.username)
      return { ok: true, user, session }
    },

    async logout(token: string): Promise<void> {
      const next = readSessions().filter((s) => s.token !== token)
      writeSessions(next)
      console.info('[Steel] Auth local logout')
    },

    async me(token: string): Promise<AuthUser | null> {
      const sessions = readSessions()
      const now = Date.now()
      const live = sessions.filter((s) => s.expiresAt > now)
      if (live.length !== sessions.length) writeSessions(live)

      const sess = live.find((s) => s.token === token)
      if (!sess) return null

      const accounts = readAccounts()
      const acc = Object.values(accounts).find((a) => a.id === sess.userId)
      return acc ? toUser(acc) : null
    },

    async updateProfile(token: string, patch: Partial<UserProfile>): Promise<AuthUser | null> {
      const user = await this.me(token)
      if (!user) return null

      const accounts = readAccounts()
      const key = Object.keys(accounts).find((k) => accounts[k]!.id === user.id)
      if (!key) return null

      const acc = accounts[key]!
      acc.profile = { ...acc.profile, ...patch }
      accounts[key] = acc
      writeAccounts(accounts)
      return toUser(acc)
    },
  }
}
