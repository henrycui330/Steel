import { TANK_OPTIONS, type TankId } from './tankCatalog'
import {
  normalizeAccessories,
  type TankAccessory,
} from './tankAccessories'
import {
  WRAP_OPTIONS,
  getSelectedWrapId,
  type WrapId,
} from './wraps'

export type TankCosmetics = {
  wrapId: WrapId
  accessories: TankAccessory[]
  /**
   * Selective wrap: mesh keys that receive camo.
   * `undefined` = full hull (legacy). Empty array = wrap none.
   */
  wrapParts?: string[]
}

export type CosmeticsMap = Partial<Record<TankId, TankCosmetics>>

export const DEFAULT_COSMETICS: TankCosmetics = {
  wrapId: 'stock',
  accessories: [],
}

function normalizeWrapParts(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  const keys = raw
    .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    .map((k) => k.trim())
  // Cap runaway lists from bad saves.
  return keys.slice(0, 400)
}

const STORAGE_KEY = 'steel.cosmetics'
const MIGRATED_KEY = 'steel.cosmetics.migrated'

function isWrapId(id: unknown): id is WrapId {
  return typeof id === 'string' && WRAP_OPTIONS.some((w) => w.id === id)
}

function isTankId(id: string): id is TankId {
  return TANK_OPTIONS.some((t) => t.id === id)
}

function normalizeEntry(raw: unknown): TankCosmetics | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const wrapId = isWrapId(o.wrapId) ? o.wrapId : null
  if (!wrapId) return null
  const wrapParts = normalizeWrapParts(o.wrapParts)
  const entry: TankCosmetics = {
    wrapId,
    accessories: normalizeAccessories(o.accessories),
  }
  if (wrapParts !== undefined) entry.wrapParts = wrapParts
  return entry
}

function readMap(): CosmeticsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: CosmeticsMap = {}
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isTankId(key)) continue
      const entry = normalizeEntry(val)
      if (entry) out[key] = entry
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: CosmeticsMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* private mode */
  }
}

function migrateFromGlobalWrapIfNeeded(): void {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return
    if (localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(MIGRATED_KEY, '1')
      return
    }
    const legacy = getSelectedWrapId()
    const map: CosmeticsMap = {}
    for (const t of TANK_OPTIONS) {
      map[t.id] = { wrapId: legacy, accessories: [] }
    }
    writeMap(map)
    localStorage.setItem(MIGRATED_KEY, '1')
    console.info(
      `[Steel] Cosmetics migrated from global wrap "${legacy}" → ${TANK_OPTIONS.length} tanks`,
    )
  } catch {
    /* private mode */
  }
}

/** Cosmetics for one chassis (defaults to stock). */
export function getTankCosmetics(tankId: TankId): TankCosmetics {
  migrateFromGlobalWrapIfNeeded()
  const entry = readMap()[tankId]
  if (!entry) return { ...DEFAULT_COSMETICS, accessories: [] }
  const out: TankCosmetics = {
    wrapId: entry.wrapId,
    accessories: entry.accessories.map((a) => ({
      ...a,
      pos: [...a.pos] as [number, number, number],
    })),
  }
  if (entry.wrapParts !== undefined) out.wrapParts = [...entry.wrapParts]
  return out
}

/** Merge-patch one tank; other chassis untouched. */
export function setTankCosmetics(
  tankId: TankId,
  patch: Partial<TankCosmetics>,
): TankCosmetics {
  migrateFromGlobalWrapIfNeeded()
  const map = readMap()
  const prev = map[tankId] ?? { ...DEFAULT_COSMETICS, accessories: [] }
  const next: TankCosmetics = {
    wrapId: isWrapId(patch.wrapId) ? patch.wrapId : prev.wrapId,
    accessories:
      patch.accessories !== undefined
        ? normalizeAccessories(patch.accessories)
        : prev.accessories,
  }
  if ('wrapParts' in patch) {
    const parts = normalizeWrapParts(patch.wrapParts)
    if (parts !== undefined) next.wrapParts = parts
    // else: clear selective mode (full hull wrap)
  } else if (prev.wrapParts !== undefined) {
    next.wrapParts = [...prev.wrapParts]
  }
  map[tankId] = next
  writeMap(map)
  console.info(
    `[Steel] Cosmetics ${tankId}: wrap=${next.wrapId} · accessories=${next.accessories.length}${
      next.wrapParts ? ` · selective ${next.wrapParts.length}` : ''
    }`,
  )
  return getTankCosmetics(tankId)
}

/** Set the same wrap on every chassis (accessories untouched). */
export function setAllTankWraps(wrapId: WrapId): void {
  if (!isWrapId(wrapId)) return
  migrateFromGlobalWrapIfNeeded()
  const map = readMap()
  for (const t of TANK_OPTIONS) {
    const prev = map[t.id]
    const entry: TankCosmetics = {
      wrapId,
      accessories: prev?.accessories ?? [],
    }
    if (prev?.wrapParts !== undefined) entry.wrapParts = [...prev.wrapParts]
    map[t.id] = entry
  }
  writeMap(map)
  console.info(`[Steel] Cosmetics wrap → all tanks: ${wrapId}`)
}

export function getAllTankCosmetics(): CosmeticsMap {
  migrateFromGlobalWrapIfNeeded()
  return readMap()
}

export function cosmeticsSelfTest(): boolean {
  const a0 = getTankCosmetics('abrams')
  const p0 = getTankCosmetics('pz3')
  setTankCosmetics('pz3', {
    wrapId: 'nato',
    accessories: [
      {
        id: 'test_bush',
        kind: 'bush',
        pos: [0.5, 0.2, -0.3],
        yaw: 0.2,
        scale: 0.9,
      },
    ],
  })
  const a1 = getTankCosmetics('abrams')
  const p1 = getTankCosmetics('pz3')
  const ok =
    a1.wrapId === a0.wrapId &&
    p1.wrapId === 'nato' &&
    p1.accessories.length === 1 &&
    p1.accessories[0]?.kind === 'bush'
  setTankCosmetics('pz3', p0)
  console.info(`[Steel] cosmeticsSelfTest ${ok ? 'PASS' : 'FAIL'}`, {
    before: { abrams: a0, pz3: p0 },
    afterPz3: p1,
    abramsUnchanged: a1,
  })
  return ok
}

declare global {
  interface Window {
    steelCosmeticsSelfTest?: () => boolean
  }
}

if (typeof window !== 'undefined') {
  window.steelCosmeticsSelfTest = cosmeticsSelfTest
}
