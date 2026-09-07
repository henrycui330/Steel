/** PBKDF2 helpers (Web Crypto) — shared by local + future Worker hashing. */

const ITERATIONS = 120_000
const HASH_BITS = 256

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes.buffer
}

export function randomSaltB64(bytes = 16): string {
  const salt = new Uint8Array(bytes)
  crypto.getRandomValues(salt)
  return bufToB64(salt.buffer)
}

export async function hashPassword(password: string, saltB64: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: b64ToBuf(saltB64),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  )
  return bufToB64(bits)
}

export async function verifyPassword(
  password: string,
  saltB64: string,
  hashB64: string,
): Promise<boolean> {
  const next = await hashPassword(password, saltB64)
  if (next.length !== hashB64.length) return false
  let diff = 0
  for (let i = 0; i < next.length; i++) diff |= next.charCodeAt(i)! ^ hashB64.charCodeAt(i)!
  return diff === 0
}

export function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return bufToB64(bytes.buffer).replace(/[+/=]/g, (c) =>
    c === '+' ? '-' : c === '/' ? '_' : '',
  )
}

export function newUserId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `u_${randomToken().slice(0, 16)}`
}
