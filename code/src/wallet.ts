import { getSession } from './auth'

const STORAGE_KEY = 'steel-wallet-v1'

/** Flat Victory payout (Skirmish / KOTH, tank / air). */
export const WIN_SILVER = 150
export const WIN_GOLD = 5

export type Wallet = {
  silver: number
  gold: number
}

export type WalletReward = {
  silver: number
  gold: number
  totals: Wallet
}

type WalletStore = Record<string, Wallet>

function guestKey(): string {
  return 'guest'
}

function userKey(): string {
  const s = getSession()
  return s?.userId?.trim() || guestKey()
}

function readStore(): WalletStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WalletStore
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeStore(store: WalletStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (err) {
    console.warn('[Steel] Wallet save failed', err)
  }
}

function normalize(w: Wallet | undefined): Wallet {
  return {
    silver: Math.max(0, Math.floor(w?.silver ?? 0)),
    gold: Math.max(0, Math.floor(w?.gold ?? 0)),
  }
}

/** Current balances for the signed-in (or guest) account. */
export function getWallet(): Wallet {
  const store = readStore()
  return normalize(store[userKey()])
}

/**
 * Add currency. Returns the new totals.
 * W2 uses this for match-win grants.
 */
export function addReward(opts: {
  silver?: number
  gold?: number
  reason?: string
}): Wallet {
  const store = readStore()
  const key = userKey()
  const cur = normalize(store[key])
  const next: Wallet = {
    silver: cur.silver + Math.max(0, Math.floor(opts.silver ?? 0)),
    gold: cur.gold + Math.max(0, Math.floor(opts.gold ?? 0)),
  }
  store[key] = next
  writeStore(store)
  console.info(
    `[Steel] Wallet +${opts.silver ?? 0} Ag · +${opts.gold ?? 0} Au` +
      (opts.reason ? ` (${opts.reason})` : '') +
      ` → ${next.silver} / ${next.gold} [${key}]`,
  )
  return next
}

/** Victory grant — call once when the end screen is shown. */
export function grantMatchWin(reason = 'victory'): WalletReward {
  const totals = addReward({
    silver: WIN_SILVER,
    gold: WIN_GOLD,
    reason,
  })
  return { silver: WIN_SILVER, gold: WIN_GOLD, totals }
}
