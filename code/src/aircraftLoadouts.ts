import {
  DEFAULT_CORSAIR_STATIONS,
  F16_STATIONS,
  F84F_STATIONS,
  hasHardpointPicker,
  isBombArmament,
  isMissileArmament,
  isRocketStore,
  isTerArmament,
  stationsForPlane,
  stationDef,
  type CorsairStationMap,
  type F16StationMap,
  type F35BStationMap,
  type F104GStationMap,
  type F84FStationMap,
  type HardpointArmament,
  type HardpointPlaneId,
  type HardpointStationId,
  type P51StationMap,
  type PlaneStationMap,
  type Yak9StationMap,
  type Mig15StationMap,
  type Mig21StationMap,
  type Su25StationMap,
  type Su27StationMap,
  YAK9_STATIONS,
  MIG15_STATIONS,
  MIG21_STATIONS,
  SU25_STATIONS,
  SU27_STATIONS,
} from './aircraftHardpoints'
import { TANK_OPTIONS, tankOptionById, type TankId } from './tankCatalog'

export type LoadoutId = 'guns' | 'bombs' | 'rockets' | 'strike'

export type AircraftLoadout = {
  loadoutId: LoadoutId
  /** Per-pylon stores (US hardpoint airframes). Overrides preset when present. */
  stations?: Partial<Record<HardpointStationId, HardpointArmament>>
}

export type LoadoutOption = {
  id: LoadoutId
  name: string
  blurb: string
}

export type AircraftStores = {
  loadoutId: LoadoutId
  bombCount: number
  /** Unguided HVAR rockets (R). */
  rockets: boolean
  /** AIM-9 / AIM-120 count on hardpoints (P lock / M fire). */
  aamCount: number
  label: string
  /** Resolved station map when the airframe has hardpoints. */
  stations?: PlaneStationMap
}

export const LOADOUT_OPTIONS: readonly LoadoutOption[] = [
  { id: 'guns', name: 'Guns only', blurb: 'Clear all hardpoints.' },
  { id: 'bombs', name: 'Bombs', blurb: 'Wing bombs · belly 1000 lb (Corsair).' },
  {
    id: 'rockets',
    name: 'Rockets / AAMs',
    blurb: 'HVAR (R) on props · AIM-9/120 (P+M) on jets.',
  },
  {
    id: 'strike',
    name: 'Strike',
    blurb: 'F-16: Litening + Hellfire + GBU · AIM tips.',
  },
]

const STORAGE_KEY = 'steel.aircraftLoadouts'

function isLoadoutId(id: unknown): id is LoadoutId {
  return id === 'guns' || id === 'bombs' || id === 'rockets' || id === 'strike'
}

function isArmament(a: unknown): a is HardpointArmament {
  return (
    a === 'empty' ||
    a === 'rocket' ||
    a === 'bomb' ||
    a === 'bomb1000' ||
    a === 'gbu27' ||
    a === 'kab500' ||
    a === 'kab500l' ||
    a === 'fab100' ||
    a === 'ter' ||
    a === 'terGbu' ||
    a === 'aim9' ||
    a === 'aim120' ||
    a === 'r73' ||
    a === 'r77' ||
    a === 'hellfire' ||
    a === 'litening'
  )
}

function isAircraftId(id: string): id is TankId {
  return TANK_OPTIONS.some((t) => t.id === id && t.aircraft)
}

function catalogBombCount(id: TankId): number {
  return tankOptionById(id).aircraftBombCount ?? 2
}

function emptyMap(plane: HardpointPlaneId): PlaneStationMap {
  const out: Record<string, HardpointArmament> = {}
  for (const s of stationsForPlane(plane)) out[s.id] = 'empty'
  return out as PlaneStationMap
}

/** Preset → station map for a hardpoint airframe. */
export function stationsFromLoadoutId(
  loadoutId: LoadoutId,
  plane: HardpointPlaneId = 'corsair',
): PlaneStationMap {
  const empty = emptyMap(plane)
  if (loadoutId === 'guns') return empty

  if (plane === 'p51' || plane === 'f84f') {
    if (loadoutId === 'rockets') {
      return {
        ...empty,
        tipL: 'rocket',
        tipR: 'rocket',
        midL: 'rocket',
        midR: 'rocket',
      } as P51StationMap | F84FStationMap
    }
    if (loadoutId === 'bombs') {
      return {
        ...empty,
        wingL: 'bomb',
        wingR: 'bomb',
      } as P51StationMap | F84FStationMap
    }
    // strike
    return {
      tipL: 'rocket',
      tipR: 'rocket',
      midL: 'rocket',
      midR: 'rocket',
      wingL: 'bomb',
      wingR: 'bomb',
    } as P51StationMap | F84FStationMap
  }

  if (plane === 'yak9') {
    if (loadoutId === 'rockets') return empty
    return {
      wingL: 'kab500',
      wingR: 'kab500',
    } as Yak9StationMap
  }

  if (plane === 'mig15') {
    if (loadoutId === 'rockets') {
      return {
        ...empty,
        tipL: 'rocket',
        tipR: 'rocket',
        midL: 'rocket',
        midR: 'rocket',
      } as Mig15StationMap
    }
    if (loadoutId === 'bombs') {
      return {
        ...empty,
        wingL: 'kab500',
        wingR: 'kab500',
      } as Mig15StationMap
    }
    // strike — 4× S-5 + 2× KAB
    return {
      tipL: 'rocket',
      tipR: 'rocket',
      midL: 'rocket',
      midR: 'rocket',
      wingL: 'kab500',
      wingR: 'kab500',
    } as Mig15StationMap
  }

  if (plane === 'mig21') {
    if (loadoutId === 'rockets') {
      return {
        ...empty,
        tipL: 'r73',
        tipR: 'r73',
        midL: 'rocket',
        midR: 'rocket',
      } as Mig21StationMap
    }
    if (loadoutId === 'bombs') {
      return {
        ...empty,
        wingL: 'kab500',
        wingR: 'kab500',
      } as Mig21StationMap
    }
    // strike — tip R-73 · mid S-5 · wing KAB
    return {
      tipL: 'r73',
      tipR: 'r73',
      midL: 'rocket',
      midR: 'rocket',
      wingL: 'kab500',
      wingR: 'kab500',
    } as Mig21StationMap
  }

  if (plane === 'su25') {
    if (loadoutId === 'rockets') {
      return {
        tipL: 'rocket',
        tipR: 'rocket',
        outerL: 'rocket',
        outerR: 'rocket',
        midL: 'rocket',
        midR: 'rocket',
        midInL: 'rocket',
        midInR: 'rocket',
        innerL: 'rocket',
        innerR: 'rocket',
        wingL: 'rocket',
        wingR: 'rocket',
      } as Su25StationMap
    }
    if (loadoutId === 'bombs') {
      return {
        ...empty,
        outerL: 'kab500',
        outerR: 'kab500',
        midL: 'kab500',
        midR: 'kab500',
        midInL: 'kab500',
        midInR: 'kab500',
        innerL: 'kab500',
        innerR: 'kab500',
        wingL: 'kab500',
        wingR: 'kab500',
      } as Su25StationMap
    }
    // strike — tip/outer S-5 · mid/midIn/inner/wing KAB
    return {
      tipL: 'rocket',
      tipR: 'rocket',
      outerL: 'rocket',
      outerR: 'rocket',
      midL: 'kab500',
      midR: 'kab500',
      midInL: 'kab500',
      midInR: 'kab500',
      innerL: 'kab500',
      innerR: 'kab500',
      wingL: 'kab500',
      wingR: 'kab500',
    } as Su25StationMap
  }

  if (plane === 'su27') {
    if (loadoutId === 'rockets') {
      return {
        ...empty,
        tipL: 'r73',
        tipR: 'r73',
        outerL: 'r77',
        outerR: 'r77',
        midL: 'r77',
        midR: 'r77',
        innerL: 'r73',
        innerR: 'r73',
      } as Su27StationMap
    }
    if (loadoutId === 'bombs') {
      return {
        ...empty,
        innerL: 'kab500',
        innerR: 'kab500',
        wingL: 'kab500',
        wingR: 'kab500',
        bellyL: 'kab500',
        bellyR: 'kab500',
      } as Su27StationMap
    }
    // strike — tip R-73 · outer/mid R-77 · inner S-5 · wing/belly KAB
    return {
      tipL: 'r73',
      tipR: 'r73',
      outerL: 'r77',
      outerR: 'r77',
      midL: 'r77',
      midR: 'r77',
      innerL: 'rocket',
      innerR: 'rocket',
      wingL: 'kab500',
      wingR: 'kab500',
      bellyL: 'kab500',
      bellyR: 'kab500',
    } as Su27StationMap
  }

  if (plane === 'f104g') {
    if (loadoutId === 'rockets') {
      return { ...empty, tipL: 'aim9', tipR: 'aim9' } as F104GStationMap
    }
    if (loadoutId === 'bombs') {
      return { ...empty, belly: 'bomb' } as F104GStationMap
    }
    // strike / interceptor — 2× AIM-9 + belly bomb
    return {
      tipL: 'aim9',
      tipR: 'aim9',
      belly: 'bomb',
    } as F104GStationMap
  }

  if (plane === 'f16' || plane === 'f35b') {
    if (loadoutId === 'rockets') {
      return {
        ...empty,
        tipL: 'aim9',
        tipR: 'aim9',
        outerL: 'aim120',
        outerR: 'aim120',
      } as F16StationMap | F35BStationMap
    }
    if (loadoutId === 'bombs') {
      // F-35: mid/outer = missiles only — bombs/GBU/Litening on belly.
      if (plane === 'f35b') {
        return {
          ...empty,
          belly: 'gbu27',
        } as F35BStationMap
      }
      return {
        ...empty,
        outerL: 'litening',
        wingL: 'bomb',
        wingR: 'bomb',
        belly: 'gbu27',
      } as F16StationMap
    }
    // strike — Litening + Hellfire AGM + tip AIM-9 + belly GBU
    // F-35: Litening on belly with GBU (mid/outer are missile-only).
    if (plane === 'f35b') {
      return {
        tipL: 'aim9',
        tipR: 'aim9',
        outerL: 'hellfire',
        outerR: 'hellfire',
        wingL: 'hellfire',
        wingR: 'hellfire',
        belly: 'gbu27',
      } as F35BStationMap
    }
    return {
      tipL: 'aim9',
      tipR: 'aim9',
      outerL: 'litening',
      outerR: 'hellfire',
      wingL: 'hellfire',
      wingR: 'hellfire',
      belly: 'gbu27',
    } as F16StationMap
  }

  // Corsair
  if (loadoutId === 'rockets') {
    return {
      tipL: 'rocket',
      tipR: 'rocket',
      outerL: 'rocket',
      outerR: 'rocket',
      midL: 'rocket',
      midR: 'rocket',
      innerL: 'empty',
      innerR: 'empty',
      belly: 'empty',
    } as CorsairStationMap
  }
  if (loadoutId === 'bombs') {
    return {
      tipL: 'empty',
      tipR: 'empty',
      outerL: 'empty',
      outerR: 'empty',
      midL: 'empty',
      midR: 'empty',
      innerL: 'bomb',
      innerR: 'bomb',
      belly: 'bomb1000',
    } as CorsairStationMap
  }
  return { ...DEFAULT_CORSAIR_STATIONS }
}

export function loadoutIdFromStations(
  map: PlaneStationMap,
  plane: HardpointPlaneId = 'corsair',
): LoadoutId {
  let rocketsOrAam = false
  let bombs = false
  for (const s of stationsForPlane(plane)) {
    const arm = (map as Record<string, HardpointArmament>)[s.id]
    if (arm && (isRocketStore(arm) || isMissileArmament(arm))) rocketsOrAam = true
    if (arm && (isBombArmament(arm) || isTerArmament(arm))) bombs = true
  }
  if (rocketsOrAam && bombs) return 'strike'
  if (rocketsOrAam) return 'rockets'
  if (bombs) return 'bombs'
  return 'guns'
}

function sanitizeStations(
  plane: HardpointPlaneId,
  raw: Partial<Record<HardpointStationId, HardpointArmament>> | undefined,
  fallback: PlaneStationMap,
): PlaneStationMap {
  const out: Record<string, HardpointArmament> = { ...fallback }
  if (!raw) return out as PlaneStationMap
  for (const s of stationsForPlane(plane)) {
    const a = raw[s.id]
    if (!isArmament(a)) continue
    if (stationDef(s.id, plane).allows.includes(a)) out[s.id] = a
  }
  return out as PlaneStationMap
}

function countBombs(map: PlaneStationMap, plane: HardpointPlaneId): number {
  let n = 0
  for (const s of stationsForPlane(plane)) {
    const arm = (map as Record<string, HardpointArmament>)[s.id]
    if (arm && isBombArmament(arm)) n++
    else if (arm && isTerArmament(arm)) n += 3
  }
  return n
}

function hasRockets(map: PlaneStationMap, plane: HardpointPlaneId): boolean {
  for (const s of stationsForPlane(plane)) {
    const arm = (map as Record<string, HardpointArmament>)[s.id]
    if (arm && isRocketStore(arm)) return true
  }
  return false
}

function countAams(map: PlaneStationMap, plane: HardpointPlaneId): number {
  let n = 0
  for (const s of stationsForPlane(plane)) {
    const arm = (map as Record<string, HardpointArmament>)[s.id]
    if (arm && isMissileArmament(arm)) n++
  }
  return n
}

/** Stock loadout matches current spawn (Corsair strike, Apache rockets, others bombs). */
export function defaultLoadoutId(id: TankId): LoadoutId {
  if (id === 'corsair') return 'strike'
  if (id === 'apache') return 'rockets'
  if (id === 'f104g') return 'strike'
  if (id === 'mig15') return 'strike'
  if (id === 'mig21') return 'strike'
  if (id === 'su25') return 'strike'
  if (id === 'su27') return 'strike'
  return 'bombs'
}

export function loadoutOptionById(id: LoadoutId): LoadoutOption {
  return LOADOUT_OPTIONS.find((o) => o.id === id) ?? LOADOUT_OPTIONS[0]!
}

export function resolveStores(
  id: TankId,
  loadoutId: LoadoutId,
  stations?: Partial<Record<HardpointStationId, HardpointArmament>>,
): AircraftStores {
  const opt = loadoutOptionById(loadoutId)
  if (hasHardpointPicker(id)) {
    const map = sanitizeStations(id, stations, stationsFromLoadoutId(loadoutId, id))
    const derived = loadoutIdFromStations(map, id)
    return {
      loadoutId: derived,
      bombCount: countBombs(map, id),
      rockets: hasRockets(map, id),
      aamCount: countAams(map, id),
      label: loadoutOptionById(derived).name,
      stations: map,
    }
  }
  const bay = catalogBombCount(id)
  if (loadoutId === 'guns') {
    return { loadoutId, bombCount: 0, rockets: false, aamCount: 0, label: opt.name }
  }
  if (loadoutId === 'rockets') {
    return { loadoutId, bombCount: 0, rockets: true, aamCount: 0, label: opt.name }
  }
  if (loadoutId === 'strike') {
    return {
      loadoutId,
      bombCount: bay,
      rockets: true,
      aamCount: 0,
      label: opt.name,
    }
  }
  return {
    loadoutId: 'bombs',
    bombCount: bay,
    rockets: false,
    aamCount: 0,
    label: loadoutOptionById('bombs').name,
  }
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
      const rec = val as { loadoutId?: unknown; stations?: unknown }
      const loadoutId = isLoadoutId(rec.loadoutId) ? rec.loadoutId : defaultLoadoutId(key)
      let stations: Partial<Record<HardpointStationId, HardpointArmament>> | undefined
      if (rec.stations && typeof rec.stations === 'object' && hasHardpointPicker(key)) {
        stations = sanitizeStations(
          key,
          rec.stations as Partial<Record<HardpointStationId, HardpointArmament>>,
          stationsFromLoadoutId(loadoutId, key),
        )
      }
      out[key] = { loadoutId, stations }
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
  const saved = readMap()[id]
  if (!saved) {
    const loadoutId = defaultLoadoutId(id)
    return {
      loadoutId,
      stations: hasHardpointPicker(id)
        ? stationsFromLoadoutId(loadoutId, id)
        : undefined,
    }
  }
  if (hasHardpointPicker(id) && !saved.stations) {
    return {
      loadoutId: saved.loadoutId,
      stations: stationsFromLoadoutId(saved.loadoutId, id),
    }
  }
  return saved
}

export function setAircraftLoadout(id: TankId, patch: Partial<AircraftLoadout>): AircraftLoadout {
  const prev = getAircraftLoadout(id)
  const loadoutId = isLoadoutId(patch.loadoutId) ? patch.loadoutId : prev.loadoutId
  let stations = prev.stations
  if (hasHardpointPicker(id)) {
    if (patch.stations) {
      stations = sanitizeStations(
        id,
        patch.stations,
        stationsFromLoadoutId(loadoutId, id),
      )
    } else if (patch.loadoutId) {
      stations = stationsFromLoadoutId(loadoutId, id)
    }
  }
  const next: AircraftLoadout = { loadoutId, stations }
  if (hasHardpointPicker(id) && stations) {
    next.loadoutId = loadoutIdFromStations(
      sanitizeStations(id, stations, stationsFromLoadoutId(loadoutId, id)),
      id,
    )
  }
  if (!isAircraftId(id)) return next
  const map = readMap()
  map[id] = next
  writeMap(map)
  console.info(`[Steel] Hangar ${id}: loadout=${next.loadoutId}`, next.stations)
  return { ...next }
}

export function resolveAircraftStores(id: TankId): AircraftStores {
  const lo = getAircraftLoadout(id)
  return resolveStores(id, lo.loadoutId, lo.stations)
}

export function loadoutSelfTest(): boolean {
  const corsairStrike = resolveStores('corsair', 'strike')
  const p51Bombs = resolveStores('p51', 'bombs')
  const p51Guns = resolveStores('p51', 'guns')
  const f84Bombs = resolveStores('f84f', 'bombs')
  const f16Strike = resolveStores('f16', 'strike')
  const f16Bombs = resolveStores('f16', 'bombs')
  const f35Bombs = resolveStores('f35b', 'bombs')
  const f35Strike = resolveStores('f35b', 'strike')
  const f104Strike = resolveStores('f104g', 'strike')
  const yakBombs = resolveStores('yak9', 'bombs')
  const migStrike = resolveStores('mig15', 'strike')
  const mig21Strike = resolveStores('mig21', 'strike')
  const su25Strike = resolveStores('su25', 'strike')
  const su27Strike = resolveStores('su27', 'strike')
  const apacheRockets = resolveStores('apache', 'rockets')
  const f16Tip = F16_STATIONS.find((s) => s.id === 'tipL')
  const f16Outer = F16_STATIONS.find((s) => s.id === 'outerL')
  const f16Wing = F16_STATIONS.find((s) => s.id === 'wingL')
  const f84Wing = F84F_STATIONS.find((s) => s.id === 'wingL')
  const yakWing = YAK9_STATIONS.find((s) => s.id === 'wingL')
  const migTip = MIG15_STATIONS.find((s) => s.id === 'tipL')
  const migWing = MIG15_STATIONS.find((s) => s.id === 'wingL')
  const mig21Tip = MIG21_STATIONS.find((s) => s.id === 'tipL')
  const su25Tip = SU25_STATIONS.find((s) => s.id === 'tipL')
  const su25Wing = SU25_STATIONS.find((s) => s.id === 'wingL')
  const su27Tip = SU27_STATIONS.find((s) => s.id === 'tipL')
  const su27Outer = SU27_STATIONS.find((s) => s.id === 'outerL')
  const f16WingMix =
    !!f16Tip &&
    f16Tip.allows.includes('bomb') &&
    f16Tip.allows.includes('gbu27') &&
    f16Tip.allows.includes('aim9') &&
    f16Tip.allows.includes('aim120') &&
    f16Tip.allows.includes('hellfire') &&
    f16Tip.allows.includes('litening') &&
    !f16Tip.allows.includes('ter')
  const f16TerMidInner =
    !!f16Outer &&
    !!f16Wing &&
    f16Outer.allows.includes('ter') &&
    f16Wing.allows.includes('ter')
  const f84NoModern =
    !!f84Wing &&
    !f84Wing.allows.includes('gbu27') &&
    !f84Wing.allows.includes('litening')
  const ok =
    corsairStrike.rockets === true &&
    corsairStrike.bombCount === 2 &&
    (corsairStrike.stations as CorsairStationMap).outerL === 'rocket' &&
    (corsairStrike.stations as CorsairStationMap).midL === 'rocket' &&
    p51Bombs.bombCount === 2 &&
    p51Bombs.rockets === false &&
    p51Guns.bombCount === 0 &&
    p51Guns.rockets === false &&
    f84Bombs.bombCount === 2 &&
    f84Bombs.rockets === false &&
    f84NoModern &&
    f16TerMidInner &&
    f16Strike.rockets === false &&
    f16Strike.aamCount === 5 &&
    f16Strike.loadoutId === 'strike' &&
    f16Strike.bombCount === 1 &&
    (f16Strike.stations as F16StationMap).tipL === 'aim9' &&
    (f16Strike.stations as F16StationMap).outerL === 'litening' &&
    (f16Strike.stations as F16StationMap).wingL === 'hellfire' &&
    f16Bombs.bombCount === 3 &&
    f16Bombs.aamCount === 0 &&
    (f16Bombs.stations as F16StationMap).belly === 'gbu27' &&
    (f16Bombs.stations as F16StationMap).outerL === 'litening' &&
    f16WingMix &&
    f35Bombs.bombCount === 1 &&
    f35Bombs.rockets === false &&
    f35Bombs.aamCount === 0 &&
    f35Bombs.loadoutId === 'bombs' &&
    (f35Bombs.stations as F35BStationMap).belly === 'gbu27' &&
    f35Strike.loadoutId === 'strike' &&
    f35Strike.aamCount === 6 &&
    (f35Strike.stations as F35BStationMap).outerL === 'hellfire' &&
    (f35Strike.stations as F35BStationMap).belly === 'gbu27' &&
    apacheRockets.rockets === true &&
    apacheRockets.bombCount === 0 &&
    defaultLoadoutId('corsair') === 'strike' &&
    defaultLoadoutId('apache') === 'rockets' &&
    defaultLoadoutId('p51') === 'bombs' &&
    defaultLoadoutId('f84f') === 'bombs' &&
    defaultLoadoutId('f16') === 'bombs' &&
    defaultLoadoutId('f35b') === 'bombs' &&
    defaultLoadoutId('f104g') === 'strike' &&
    f104Strike.loadoutId === 'strike' &&
    f104Strike.aamCount === 2 &&
    f104Strike.bombCount === 1 &&
    (f104Strike.stations as F104GStationMap).tipL === 'aim9' &&
    (f104Strike.stations as F104GStationMap).belly === 'bomb' &&
    !!yakWing &&
    yakWing.allows.includes('kab500') &&
    yakWing.allows.includes('kab500l') &&
    yakWing.allows.includes('fab100') &&
    yakBombs.bombCount === 2 &&
    yakBombs.rockets === false &&
    (yakBombs.stations as Yak9StationMap).wingL === 'kab500' &&
    (yakBombs.stations as Yak9StationMap).wingR === 'kab500' &&
    defaultLoadoutId('yak9') === 'bombs' &&
    !!migTip &&
    !!migWing &&
    migTip.allows.includes('rocket') &&
    migWing.allows.includes('kab500') &&
    migWing.allows.includes('kab500l') &&
    migWing.allows.includes('fab100') &&
    migStrike.loadoutId === 'strike' &&
    migStrike.rockets === true &&
    migStrike.bombCount === 2 &&
    (migStrike.stations as Mig15StationMap).tipL === 'rocket' &&
    (migStrike.stations as Mig15StationMap).wingL === 'kab500' &&
    defaultLoadoutId('mig15') === 'strike' &&
    !!mig21Tip &&
    mig21Tip.allows.includes('r73') &&
    mig21Tip.allows.includes('rocket') &&
    mig21Tip.allows.includes('kab500') &&
    mig21Tip.allows.includes('kab500l') &&
    mig21Tip.allows.includes('fab100') &&
    mig21Strike.loadoutId === 'strike' &&
    mig21Strike.aamCount === 2 &&
    mig21Strike.rockets === true &&
    mig21Strike.bombCount === 2 &&
    (mig21Strike.stations as Mig21StationMap).tipL === 'r73' &&
    (mig21Strike.stations as Mig21StationMap).midL === 'rocket' &&
    (mig21Strike.stations as Mig21StationMap).wingL === 'kab500' &&
    defaultLoadoutId('mig21') === 'strike' &&
    !!su25Tip &&
    !!su25Wing &&
    SU25_STATIONS.length === 12 &&
    su25Tip.allows.includes('rocket') &&
    su25Tip.allows.includes('r73') &&
    !su25Tip.allows.includes('kab500') &&
    !su25Tip.allows.includes('kab500l') &&
    !su25Tip.allows.includes('fab100') &&
    su25Wing.allows.includes('kab500') &&
    su25Wing.allows.includes('kab500l') &&
    su25Wing.allows.includes('fab100') &&
    su25Wing.allows.includes('rocket') &&
    su25Wing.allows.includes('r73') &&
    su25Strike.loadoutId === 'strike' &&
    su25Strike.rockets === true &&
    su25Strike.bombCount === 8 &&
    (su25Strike.stations as Su25StationMap).tipL === 'rocket' &&
    (su25Strike.stations as Su25StationMap).midInL === 'kab500' &&
    (su25Strike.stations as Su25StationMap).wingL === 'kab500' &&
    defaultLoadoutId('su25') === 'strike' &&
    !!su27Tip &&
    !!su27Outer &&
    SU27_STATIONS.length === 12 &&
    su27Tip.allows.includes('r73') &&
    su27Tip.allows.includes('r77') &&
    !su27Tip.allows.includes('kab500') &&
    !su27Tip.allows.includes('kab500l') &&
    !su27Tip.allows.includes('fab100') &&
    su27Outer.allows.includes('r77') &&
    su27Outer.allows.includes('kab500') &&
    su27Outer.allows.includes('kab500l') &&
    su27Outer.allows.includes('fab100') &&
    su27Outer.allows.includes('rocket') &&
    su27Strike.loadoutId === 'strike' &&
    su27Strike.aamCount === 6 &&
    su27Strike.rockets === true &&
    su27Strike.bombCount === 4 &&
    (su27Strike.stations as Su27StationMap).tipL === 'r73' &&
    (su27Strike.stations as Su27StationMap).outerL === 'r77' &&
    (su27Strike.stations as Su27StationMap).bellyL === 'kab500' &&
    defaultLoadoutId('su27') === 'strike'
  console.info(`[Steel] loadoutSelfTest ${ok ? 'PASS' : 'FAIL'}`, {
    corsairStrike,
    p51Bombs,
    p51Guns,
    f84Bombs,
    f16Strike,
    f16Bombs,
    f35Bombs,
    f35Strike,
    f104Strike,
    yakBombs,
    migStrike,
    mig21Strike,
    su25Strike,
    su27Strike,
    apacheRockets,
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
