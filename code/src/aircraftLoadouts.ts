import { TANK_OPTIONS, tankOptionById, type TankId } from './tankCatalog'

export type LoadoutId = 'guns' | 'bombs' | 'rockets' | 'strike'

export type AircraftLoadout = {
  loadoutId: LoadoutId
}

export type LoadoutOption = {
  id: LoadoutId
  name: string
  blurb: string
}

export type AircraftStores = {
  loadoutId: LoadoutId
  bombCount: number
  rockets: boolean
  label: string
}

export const LOADOUT_OPTIONS: readonly LoadoutOption[] = [
  { id: 'guns', name: 'Guns only', blurb: 'Cannon / MGs. No bombs or rockets.' },
  { id: 'bombs', name: 'Bombs', blurb: 'Guns plus bomb bay (stock count).' },
  { id: 'rockets', name: 'Rockets', blurb: 'Guns plus unguided rockets.' },
  { id: 'strike', name: 'Strike', blurb: 'Guns, bombs, and rockets.' },
]

const STORAGE_KEY = 'steel.aircraftLoadouts'

function isLoadoutId(id: unknown): id is LoadoutId {
  return id === 'guns' || id === 'bombs' || id === 'rockets' || id === 'strike'
}

function isAircraftId(id: string): id is TankId {
  return TANK_OPTIONS.some((t) => t.id === id && t.aircraft)
}

function catalogBombCount(id: TankId): number {
  return tankOptionById(id).aircraftBombCount ?? 2
}

/** Stock loadout matches current spawn (Corsair strike, others bombs). */
export function defaultLoadoutId(id: TankId): LoadoutId {
  return id === 'corsair' ? 'strike' : 'bombs'
}

export function loadoutOptionById(id: LoadoutId): LoadoutOption {
  return LOADOUT_OPTIONS.find((o) => o.id === id) ?? LOADOUT_OPTIONS[0]!
}

export function resolveStores(id: TankId, loadoutId: LoadoutId): AircraftStores {
  const bay = catalogBombCount(id)
  const opt = loadoutOptionById(loadoutId)
  if (loadoutId === 'guns') {
    return { loadoutId, bombCount: 0, rockets: false, label: opt.name }
  }
  if (loadoutId === 'rockets') {
    return { loadoutId, bombCount: 0, rockets: true, label: opt.name }
  }
  if (loadoutId === 'strike') {
    return { loadoutId, bombCount: bay, rockets: true, label: opt.name }
  }
  return { loadoutId: 'bombs', bombCount: bay, rockets: false, label: loadoutOptionById('bombs').name }
}

function readMap(): Partial<Record<TankId, AircraftLoadout>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<TankId, AircraftLoadout>> = {}
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isAircraftId(key)) continue
      if (!val || typeof val !== 'object') continue
      const loadoutId = (val as { loadoutId?: unknown }).loadoutId
      if (!isLoadoutId(loadoutId)) continue
      out[key] = { loadoutId }
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: Partial<Record<TankId, AircraftLoadout>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* private mode */
  }
}

export function getAircraftLoadout(id: TankId): AircraftLoadout {
  if (!isAircraftId(id)) return { loadoutId: defaultLoadoutId(id) }
  return readMap()[id] ?? { loadoutId: defaultLoadoutId(id) }
}

export function setAircraftLoadout(id: TankId, patch: Partial<AircraftLoadout>): AircraftLoadout {
  const prev = getAircraftLoadout(id)
  const next: AircraftLoadout = {
    loadoutId: isLoadoutId(patch.loadoutId) ? patch.loadoutId : prev.loadoutId,
  }
  if (!isAircraftId(id)) return next
  const map = readMap()
  map[id] = next
  writeMap(map)
  console.info(`[Steel] Hangar ${id}: loadout=${next.loadoutId}`)
  return { ...next }
}

export function resolveAircraftStores(id: TankId): AircraftStores {
  return resolveStores(id, getAircraftLoadout(id).loadoutId)
}

export function loadoutSelfTest(): boolean {
  const corsairStrike = resolveStores('corsair', 'strike')
  const p51Guns = resolveStores('p51', 'guns')
  const f35Bombs = resolveStores('f35b', 'bombs')
  const ok =
    corsairStrike.rockets === true &&
    corsairStrike.bombCount === 2 &&
    p51Guns.bombCount === 0 &&
    p51Guns.rockets === false &&
    f35Bombs.bombCount === 4 &&
    f35Bombs.rockets === false &&
    defaultLoadoutId('corsair') === 'strike' &&
    defaultLoadoutId('p51') === 'bombs'
  console.info(`[Steel] loadoutSelfTest ${ok ? 'PASS' : 'FAIL'}`, {
    corsairStrike,
    p51Guns,
    f35Bombs,
  })
  return ok
}

declare global {
  interface Window {
    steelLoadoutSelfTest?: () => boolean
  }
}

if (typeof window !== 'undefined') {
  window.steelLoadoutSelfTest = loadoutSelfTest
}
