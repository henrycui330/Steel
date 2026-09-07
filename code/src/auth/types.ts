import type { WrapId } from '../wraps'

export type AuthMode = 'offline' | 'online'

export type UserProfile = {
  wrapId: WrapId
  createdAt: number
}

export type AuthUser = {
  id: string
  username: string
  profile: UserProfile
}

export type AuthSession = {
  userId: string
  username: string
  token: string
  mode: AuthMode
}

export type AuthResult =
  | { ok: true; user: AuthUser; session: AuthSession }
  | { ok: false; error: string }

export type AuthBackend = {
  readonly mode: AuthMode
  register(username: string, password: string): Promise<AuthResult>
  login(username: string, password: string): Promise<AuthResult>
  logout(token: string): Promise<void>
  me(token: string): Promise<AuthUser | null>
  updateProfile(token: string, patch: Partial<UserProfile>): Promise<AuthUser | null>
}
