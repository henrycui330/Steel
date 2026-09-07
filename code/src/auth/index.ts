export type {
  AuthBackend,
  AuthMode,
  AuthResult,
  AuthSession,
  AuthUser,
  UserProfile,
} from './types'
export {
  getCurrentUser,
  getPreferredAuthMode,
  getSession,
  getSteelApiBase,
  initAuth,
  login,
  logout,
  register,
  setPreferredAuthMode,
  updateProfile,
} from './authService'
