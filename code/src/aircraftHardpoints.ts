import * as THREE from 'three'
import {
  cloneBombHung,
  ensureAllBombTemplates,
  type BombStoreKind,
} from './munitionMk82'
import { cloneHvarHung, ensureHvarTemplate } from './munitionHvar'
import {
  cloneAamHung,
  ensureAllAamTemplates,
  makeAamFallback,
  type AamKind,
} from './munitionAam'
import {
  cloneHellfireHung,
  ensureHellfireTemplate,
  makeHellfireFallback,
} from './munitionHellfire'
import {
  cloneLiteningHung,
  ensureLiteningTemplate,
  makeLiteningFallback,
} from './munitionLitening'

/**
 * Aircraft hardpoints (local XYZ, nose +Z, up +Y, right wing −X).
 * Corsair: tip/outer/mid rocket rails + inner/belly bombs.
 * P-51 / F-84F: tip/mid rockets + wing bombs.
 * F-16 / F-35B: tip/outer rails + wing bombs + belly.
 * F-104G: tip AIM rails + belly bomb (interceptor).
 */

export type HardpointPlaneId =
  | 'corsair'
  | 'p51'
  | 'f84f'
  | 'f16'
  | 'f35b'
  | 'f104g'

export type CorsairStationId =
  | 'tipL'
  | 'tipR'
  | 'outerL'
  | 'outerR'
  | 'midL'
  | 'midR'
  | 'innerL'
  | 'innerR'
  | 'belly'

export type P51StationId =
  | 'tipL'
  | 'tipR'
  | 'midL'
  | 'midR'
  | 'wingL'
  | 'wingR'

/** Same station ids as P-51; layout locals differ. */
export type F84FStationId = P51StationId

export type F16StationId =
  | 'tipL'
  | 'tipR'
  | 'outerL'
  | 'outerR'
  | 'wingL'
  | 'wingR'
  | 'belly'

/** Same station ids as F-16; locals differ for Lightning span. */
export type F35BStationId = F16StationId

/** F-104G — tip rails + belly only. */
export type F104GStationId = 'tipL' | 'tipR' | 'belly'

export type HardpointStationId =
  | CorsairStationId
  | P51StationId
  | F84FStationId
  | F16StationId
  | F35BStationId
  | F104GStationId
export type HardpointArmament =
  | 'empty'
  | 'rocket'
  | 'bomb'
  | 'bomb1000'
  | 'gbu27'
  | 'aim9'
  | 'aim120'
  | 'hellfire'
  | 'litening'

/** Unguided HVAR-style rockets only (not AIM-9 / AIM-120). */
export type RocketStoreKind = 'rocket'

/** Seeker stores fired with P-lock / M (AIM + Hellfire AGM). */
export type MissileStoreKind = AamKind | 'hellfire'

export type RocketStation = {
  local: readonly [number, number, number]
  kind: RocketStoreKind
}

export type AamStation = {
  local: readonly [number, number, number]
  kind: MissileStoreKind
}

export type BombStation = {
  local: readonly [number, number, number]
  kind: BombStoreKind
}

export type HardpointStationDef = {
  id: HardpointStationId
  allows: readonly HardpointArmament[]
  local: readonly [number, number, number]
}

const BOMB_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
  'litening',
]
/** F-84F era — iron bombs only (no GBU / Litening). */
const F84F_BOMB_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
]
const ROCKET_ALLOWS: readonly HardpointArmament[] = ['empty', 'rocket']
/** F-16 tip / outer / wing — bombs, seekers, Litening pod. */
const F16_WING_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
  'aim9',
  'aim120',
  'hellfire',
  'litening',
]
/** F-16 belly — bombs / GBU / Litening. */
const F16_BELLY_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
  'litening',
]
/** F-35 mid / outer wing — seekers only. */
const F35_MISSILE_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'aim9',
  'aim120',
  'hellfire',
]
/** F-104 tip rails — Sidewinder-class only. */
const F104_TIP_ALLOWS: readonly HardpointArmament[] = ['empty', 'aim9']
/** F-104 belly — single bomb / GBU. */
const F104_BELLY_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
]

/** Corsair — 6 HVAR rails + 2 wing bombs + belly. */
export const CORSAIR_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: ROCKET_ALLOWS, local: [5.85, -0.38, 1.65] },
  { id: 'tipR', allows: ROCKET_ALLOWS, local: [-5.85, -0.38, 1.65] },
  { id: 'outerL', allows: ROCKET_ALLOWS, local: [4.55, -0.62, 1.35] },
  { id: 'outerR', allows: ROCKET_ALLOWS, local: [-4.55, -0.62, 1.35] },
  { id: 'midL', allows: ROCKET_ALLOWS, local: [3.15, -0.7, 1.1] },
  { id: 'midR', allows: ROCKET_ALLOWS, local: [-3.15, -0.7, 1.1] },
  { id: 'innerL', allows: BOMB_ALLOWS, local: [1.55, -0.82, 0.85] },
  { id: 'innerR', allows: BOMB_ALLOWS, local: [-1.55, -0.82, 0.85] },
  { id: 'belly', allows: BOMB_ALLOWS, local: [0, -1.15, 0.55] },
]

/** P-51 — 4 HVAR rails + 2 wing bombs. */
export const P51_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: ROCKET_ALLOWS, local: [5.05, -0.58, 1.15] },
  { id: 'tipR', allows: ROCKET_ALLOWS, local: [-5.05, -0.58, 1.15] },
  { id: 'midL', allows: ROCKET_ALLOWS, local: [3.45, -0.65, 0.85] },
  { id: 'midR', allows: ROCKET_ALLOWS, local: [-3.45, -0.65, 0.85] },
  { id: 'wingL', allows: BOMB_ALLOWS, local: [1.85, -0.78, 0.45] },
  { id: 'wingR', allows: BOMB_ALLOWS, local: [-1.85, -0.78, 0.45] },
]

/**
 * F-84F — 4 HVAR rails + 2 wing bombs (no pylon stubs).
 * Tight cluster under the swept wing; tip furthest aft.
 */
export const F84F_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: ROCKET_ALLOWS, local: [2.95, -1.22, -0.75] },
  { id: 'tipR', allows: ROCKET_ALLOWS, local: [-2.95, -1.22, -0.75] },
  { id: 'midL', allows: ROCKET_ALLOWS, local: [2.2, -1.15, -0.15] },
  { id: 'midR', allows: ROCKET_ALLOWS, local: [-2.2, -1.15, -0.15] },
  { id: 'wingL', allows: F84F_BOMB_ALLOWS, local: [1.5, -0.95, 0.45] },
  { id: 'wingR', allows: F84F_BOMB_ALLOWS, local: [-1.5, -0.95, 0.45] },
]

/**
 * F-16C — tip/outer/wing: bombs or AIM-9/120; belly bombs only (≈9.96 m span).
 * Under-wing at model pylon height; strong sweep (tip furthest aft). No stub pylons
 * (airframe already has them).
 */
export const F16_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: F16_WING_ALLOWS, local: [4.3, -1.4, -3.0] },
  { id: 'tipR', allows: F16_WING_ALLOWS, local: [-4.3, -1.4, -3.0] },
  { id: 'outerL', allows: F16_WING_ALLOWS, local: [3.1, -1.44, -2.1] },
  { id: 'outerR', allows: F16_WING_ALLOWS, local: [-3.1, -1.44, -2.1] },
  { id: 'wingL', allows: F16_WING_ALLOWS, local: [1.75, -1.5, -1.2] },
  { id: 'wingR', allows: F16_WING_ALLOWS, local: [-1.75, -1.5, -1.2] },
  { id: 'belly', allows: F16_BELLY_ALLOWS, local: [0, -1.54, -1.35] },
]

/**
 * F-35B Lightning II — tip/outer/wing + belly (≈10.7 m span).
 * Compact under-wing cluster; mid+outer = missiles only; belly = bombs/GBU/Litening.
 */
export const F35B_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: F35_MISSILE_ALLOWS, local: [3.15, -0.58, -1.35] },
  { id: 'tipR', allows: F35_MISSILE_ALLOWS, local: [-3.15, -0.58, -1.35] },
  { id: 'outerL', allows: F35_MISSILE_ALLOWS, local: [2.35, -0.62, -0.95] },
  { id: 'outerR', allows: F35_MISSILE_ALLOWS, local: [-2.35, -0.62, -0.95] },
  { id: 'wingL', allows: F35_MISSILE_ALLOWS, local: [1.55, -0.68, -0.55] },
  { id: 'wingR', allows: F35_MISSILE_ALLOWS, local: [-1.55, -0.68, -0.55] },
  { id: 'belly', allows: F16_BELLY_ALLOWS, local: [0, -0.8, -0.35] },
]

/**
 * F-104G Starfighter — stub wings (~6.68 m span); tip AIM-9 + belly bomb.
 * Half-span ≈ 3.34 m — tip rails sit just inboard of the tip.
 */
export const F104G_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: F104_TIP_ALLOWS, local: [3.05, -1.28, -2.0] },
  { id: 'tipR', allows: F104_TIP_ALLOWS, local: [-3.05, -1.28, -2.0] },
  { id: 'belly', allows: F104_BELLY_ALLOWS, local: [0, -0.95, -0.35] },
]

export type CorsairStationMap = Record<CorsairStationId, HardpointArmament>
export type P51StationMap = Record<P51StationId, HardpointArmament>
export type F84FStationMap = Record<F84FStationId, HardpointArmament>
export type F16StationMap = Record<F16StationId, HardpointArmament>
export type F35BStationMap = Record<F35BStationId, HardpointArmament>
export type F104GStationMap = Record<F104GStationId, HardpointArmament>
export type PlaneStationMap =
  | CorsairStationMap
  | P51StationMap
  | F84FStationMap
  | F16StationMap
  | F35BStationMap
  | F104GStationMap

export const DEFAULT_CORSAIR_STATIONS: CorsairStationMap = {
  tipL: 'rocket',
  tipR: 'rocket',
  outerL: 'rocket',
  outerR: 'rocket',
  midL: 'rocket',
  midR: 'rocket',
  innerL: 'bomb',
  innerR: 'bomb',
  belly: 'empty',
}

export const DEFAULT_P51_STATIONS: P51StationMap = {
  tipL: 'empty',
  tipR: 'empty',
  midL: 'empty',
  midR: 'empty',
  wingL: 'bomb',
  wingR: 'bomb',
}

export const DEFAULT_F84F_STATIONS: F84FStationMap = {
  tipL: 'empty',
  tipR: 'empty',
  midL: 'empty',
  midR: 'empty',
  wingL: 'bomb',
  wingR: 'bomb',
}

export const DEFAULT_F16_STATIONS: F16StationMap = {
  tipL: 'aim9',
  tipR: 'aim9',
  outerL: 'aim120',
  outerR: 'aim120',
  wingL: 'bomb',
  wingR: 'bomb',
  belly: 'empty',
}

export const DEFAULT_F35B_STATIONS: F35BStationMap = {
  tipL: 'aim9',
  tipR: 'aim9',
  outerL: 'aim120',
  outerR: 'aim120',
  wingL: 'bomb',
  wingR: 'bomb',
  belly: 'empty',
}

/** Interceptor default — 2× AIM-9 + belly bomb. */
export const DEFAULT_F104G_STATIONS: F104GStationMap = {
  tipL: 'aim9',
  tipR: 'aim9',
  belly: 'bomb',
}

export function hasHardpointPicker(planeId: string): planeId is HardpointPlaneId {
  return (
    planeId === 'corsair' ||
    planeId === 'p51' ||
    planeId === 'f84f' ||
    planeId === 'f16' ||
    planeId === 'f35b' ||
    planeId === 'f104g'
  )
}

export function stationsForPlane(plane: HardpointPlaneId): readonly HardpointStationDef[] {
  if (plane === 'p51') return P51_STATIONS
  if (plane === 'f84f') return F84F_STATIONS
  if (plane === 'f16') return F16_STATIONS
  if (plane === 'f35b') return F35B_STATIONS
  if (plane === 'f104g') return F104G_STATIONS
  return CORSAIR_STATIONS
}

export function defaultStations(plane: HardpointPlaneId): PlaneStationMap {
  if (plane === 'p51') return { ...DEFAULT_P51_STATIONS }
  if (plane === 'f84f') return { ...DEFAULT_F84F_STATIONS }
  if (plane === 'f16') return { ...DEFAULT_F16_STATIONS }
  if (plane === 'f35b') return { ...DEFAULT_F35B_STATIONS }
  if (plane === 'f104g') return { ...DEFAULT_F104G_STATIONS }
  return { ...DEFAULT_CORSAIR_STATIONS }
}

export function stationDef(
  id: HardpointStationId,
  plane: HardpointPlaneId = 'corsair',
): HardpointStationDef {
  const hit = stationsForPlane(plane).find((s) => s.id === id)
  if (!hit) {
    throw new Error(`[Steel] Unknown hardpoint ${id} on ${plane}`)
  }
  return hit
}

export function isBombArmament(a: HardpointArmament): a is BombStoreKind {
  return a === 'bomb' || a === 'bomb1000' || a === 'gbu27'
}

export function isAamArmament(a: HardpointArmament): a is AamKind {
  return a === 'aim9' || a === 'aim120'
}

/** AIM-9 / AIM-120 / Hellfire — P lock / M fire. */
export function isMissileArmament(a: HardpointArmament): a is MissileStoreKind {
  return a === 'aim9' || a === 'aim120' || a === 'hellfire'
}

export function isLiteningArmament(a: HardpointArmament): a is 'litening' {
  return a === 'litening'
}

/** Manual-fire HVAR rockets only — AAMs are seekers (P lock / M fire). */
export function isRocketStore(a: HardpointArmament): a is RocketStoreKind {
  return a === 'rocket'
}

export function armamentLabel(a: HardpointArmament): string {
  if (a === 'rocket') return 'HVAR rocket'
  if (a === 'bomb') return '500 lb bomb'
  if (a === 'bomb1000') return '1000 lb bomb'
  if (a === 'gbu27') return 'GBU-27 Paveway'
  if (a === 'aim9') return 'AIM-9 Sidewinder'
  if (a === 'aim120') return 'AIM-120 AMRAAM'
  if (a === 'hellfire') return 'AGM-114 Hellfire'
  if (a === 'litening') return 'Litening TGP'
  return 'Empty'
}

export type AircraftHardpoints = {
  plane: HardpointPlaneId
  rocketLocals: ReadonlyArray<readonly [number, number, number]>
  rocketStations: readonly RocketStation[]
  aamLocals: ReadonlyArray<readonly [number, number, number]>
  aamStations: readonly AamStation[]
  bombLocals: ReadonlyArray<readonly [number, number, number]>
  bombStations: readonly BombStation[]
  /** True when any pylon carries a Litening pod. */
  hasLitening: () => boolean
  /** First Litening station root (sensor mount), or null. */
  getLiteningMount: () => THREE.Object3D | null
  markers: THREE.Mesh[]
  getStations: () => PlaneStationMap
  setStation: (id: HardpointStationId, arm: HardpointArmament) => void
  setStations: (map: Partial<Record<HardpointStationId, HardpointArmament>>) => void
  setMarkersVisible: (on: boolean) => void
  highlight: (id: HardpointStationId | null) => void
  consumeRocket: () => void
  consumeAam: () => void
  consumeBomb: () => void
  dispose: () => void
}

/** @deprecated use AircraftHardpoints */
export type CorsairHardpoints = AircraftHardpoints

function makePylon(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.055, 0.28, 0.32)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a3e38,
    roughness: 0.75,
    metalness: 0.35,
  })
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  return m
}

function makeRocketStore(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'hardpointRocket'
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1.2, 6),
    new THREE.MeshStandardMaterial({
      color: 0x6a6e62,
      roughness: 0.55,
      metalness: 0.45,
    }),
  )
  body.rotation.x = Math.PI / 2
  body.position.z = 0.15
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.28, 6),
    new THREE.MeshStandardMaterial({
      color: 0xc4a35a,
      roughness: 0.4,
      metalness: 0.5,
    }),
  )
  tip.rotation.x = Math.PI / 2
  tip.position.z = 0.9
  g.add(body, tip)
  return g
}

function makeBombStoreFallback(kind: BombStoreKind): THREE.Group {
  const g = new THREE.Group()
  g.name =
    kind === 'bomb1000'
      ? 'hardpointBomb1000'
      : kind === 'gbu27'
        ? 'hardpointGbu27'
        : 'hardpointBomb'
  const r = kind === 'bomb1000' || kind === 'gbu27' ? 0.22 : 0.18
  const h = kind === 'gbu27' ? 1.35 : kind === 'bomb1000' ? 1.2 : 0.95
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r, h, 4, 8),
    new THREE.MeshStandardMaterial({
      color: kind === 'gbu27' ? 0x5a5248 : kind === 'bomb1000' ? 0x3a4038 : 0x4a4f45,
      roughness: 0.8,
      metalness: 0.3,
    }),
  )
  body.rotation.x = Math.PI / 2
  body.position.y = kind === 'gbu27' ? -0.42 : kind === 'bomb1000' ? -0.4 : -0.35
  g.add(body)
  return g
}

function disposeProceduralStore(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (o.userData.sharedMunition) return
    o.geometry?.dispose()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) m?.dispose()
  })
}

function makeYellowMarker(stationId: HardpointStationId): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(0.55, 0.55)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf2d44a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  })
  const m = new THREE.Mesh(geo, mat)
  m.name = `hpMarker_${stationId}`
  m.userData.hardpointId = stationId
  m.renderOrder = 20
  m.rotation.x = -Math.PI / 2
  m.position.y = -0.15
  return m
}

type StationRuntime = {
  def: HardpointStationDef
  root: THREE.Group
  rocket: THREE.Object3D
  aim9: THREE.Object3D
  aim120: THREE.Object3D
  hellfire: THREE.Object3D
  litening: THREE.Object3D
  bomb500: THREE.Object3D
  bomb1000: THREE.Object3D
  bombGbu: THREE.Object3D
  marker: THREE.Mesh
  arm: HardpointArmament
}

function activeBombMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'bomb') return rt.bomb500
  if (rt.arm === 'bomb1000') return rt.bomb1000
  if (rt.arm === 'gbu27') return rt.bombGbu
  return null
}

function activeRocketMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'rocket') return rt.rocket
  return null
}

function activeAamMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'aim9') return rt.aim9
  if (rt.arm === 'aim120') return rt.aim120
  if (rt.arm === 'hellfire') return rt.hellfire
  return null
}

/**
 * Attach pylons, hung stores, and yellow pick squares for Corsair or P-51.
 */
export function attachAircraftHardpoints(
  root: THREE.Object3D,
  opts: {
    plane: HardpointPlaneId
    stations?: Partial<Record<HardpointStationId, HardpointArmament>>
    markers?: boolean
  },
): AircraftHardpoints {
  const plane = opts.plane
  const layout = stationsForPlane(plane)
  const defaults = defaultStations(plane)
  const group = new THREE.Group()
  group.name = `${plane}Hardpoints`
  root.add(group)

  const initial: Record<string, HardpointArmament> = { ...defaults }
  if (opts.stations) {
    for (const [k, v] of Object.entries(opts.stations)) {
      if (v) initial[k] = v
    }
  }
  const showMarkers = opts.markers === true
  const runtimes: StationRuntime[] = []
  const markers: THREE.Mesh[] = []

  // F-84F / F-16 / F-35 / F-104 meshes — don't stack stub boxes.
  const showPylons =
    plane !== 'f84f' && plane !== 'f16' && plane !== 'f35b' && plane !== 'f104g'
  /** Extra Y on hung stores (P-51 snug; jets lift toward wing). */
  const storeHangY =
    plane === 'p51'
      ? -0.08
      : plane === 'f16' || plane === 'f35b' || plane === 'f104g'
        ? -0.02
        : null

  for (const def of layout) {
    const station = new THREE.Group()
    station.name = `hp_${def.id}`
    station.position.set(def.local[0], def.local[1], def.local[2])
    if (showPylons) {
      const pylon = makePylon()
      pylon.position.y = 0.12
      station.add(pylon)
    }
    const rocket = makeRocketStore()
    const aim9 = makeAamFallback('aim9')
    const aim120 = makeAamFallback('aim120')
    const hellfire = makeHellfireFallback()
    const litening = makeLiteningFallback()
    const bomb500 = makeBombStoreFallback('bomb')
    const bomb1000 = makeBombStoreFallback('bomb1000')
    const bombGbu = makeBombStoreFallback('gbu27')
    if (storeHangY !== null) {
      for (const o of [
        rocket,
        aim9,
        aim120,
        hellfire,
        litening,
        bomb500,
        bomb1000,
        bombGbu,
      ]) {
        o.position.y = storeHangY
      }
      for (const g of [bomb500, bomb1000, bombGbu]) {
        const body = g.children[0]
        if (body) body.position.y = storeHangY
      }
    }
    station.add(
      rocket,
      aim9,
      aim120,
      hellfire,
      litening,
      bomb500,
      bomb1000,
      bombGbu,
    )
    const marker = makeYellowMarker(def.id)
    marker.visible = showMarkers
    station.add(marker)
    markers.push(marker)
    group.add(station)
    runtimes.push({
      def,
      root: station,
      rocket,
      aim9,
      aim120,
      hellfire,
      litening,
      bomb500,
      bomb1000,
      bombGbu,
      marker,
      arm: initial[def.id] ?? 'empty',
    })
  }

  function applyVisual(rt: StationRuntime): void {
    const arm = rt.arm
    const allowed = rt.def.allows.includes(arm) ? arm : 'empty'
    rt.arm = allowed
    rt.rocket.visible = allowed === 'rocket'
    rt.aim9.visible = allowed === 'aim9'
    rt.aim120.visible = allowed === 'aim120'
    rt.hellfire.visible = allowed === 'hellfire'
    rt.litening.visible = allowed === 'litening'
    rt.bomb500.visible = allowed === 'bomb'
    rt.bomb1000.visible = allowed === 'bomb1000'
    rt.bombGbu.visible = allowed === 'gbu27'
  }

  for (const rt of runtimes) applyVisual(rt)

  let disposed = false
  let rocketConsume = 0
  let aamConsume = 0
  let bombConsume = 0

  void Promise.all([
    ensureAllBombTemplates(),
    ensureHvarTemplate(),
    ensureAllAamTemplates(),
    ensureHellfireTemplate(),
    ensureLiteningTemplate(),
  ]).then(() => {
    if (disposed) return
    for (const rt of runtimes) {
      for (const kind of ['bomb', 'bomb1000', 'gbu27'] as const) {
        const next = cloneBombHung(kind)
        if (!next) continue
        if (storeHangY !== null) next.position.y = storeHangY
        const prev =
          kind === 'bomb'
            ? rt.bomb500
            : kind === 'bomb1000'
              ? rt.bomb1000
              : rt.bombGbu
        next.visible = prev.visible
        rt.root.remove(prev)
        disposeProceduralStore(prev)
        rt.root.add(next)
        if (kind === 'bomb') rt.bomb500 = next
        else if (kind === 'bomb1000') rt.bomb1000 = next
        else rt.bombGbu = next
      }
      const hvar = cloneHvarHung()
      if (hvar) {
        if (storeHangY !== null) hvar.position.y = storeHangY
        hvar.visible = rt.rocket.visible
        rt.root.remove(rt.rocket)
        disposeProceduralStore(rt.rocket)
        rt.root.add(hvar)
        rt.rocket = hvar
      }
      for (const kind of ['aim9', 'aim120'] as const) {
        const next = cloneAamHung(kind)
        if (!next) continue
        if (storeHangY !== null) next.position.y = storeHangY
        const prev = kind === 'aim9' ? rt.aim9 : rt.aim120
        next.visible = prev.visible
        rt.root.remove(prev)
        disposeProceduralStore(prev)
        rt.root.add(next)
        if (kind === 'aim9') rt.aim9 = next
        else rt.aim120 = next
      }
      const hf = cloneHellfireHung()
      if (hf) {
        if (storeHangY !== null) hf.position.y = storeHangY
        hf.visible = rt.hellfire.visible
        rt.root.remove(rt.hellfire)
        disposeProceduralStore(rt.hellfire)
        rt.root.add(hf)
        rt.hellfire = hf
      }
      const lit = cloneLiteningHung()
      if (lit) {
        if (storeHangY !== null) lit.position.y = storeHangY
        lit.visible = rt.litening.visible
        rt.root.remove(rt.litening)
        disposeProceduralStore(rt.litening)
        rt.root.add(lit)
        rt.litening = lit
      }
    }
    console.info(
      `[Steel] ${plane} hardpoints · hung stores ready` +
        (plane === 'f16' || plane === 'f35b'
          ? ' · AIM / Hellfire / Litening'
          : plane === 'f104g'
            ? ' · tip AIM-9 + belly'
            : ''),
    )
  })

  console.info(
    `[Steel] ${plane} hardpoints · ${layout.map((s) => s.id).join(', ')}` +
      (showMarkers ? ' · yellow pick' : ''),
  )

  function listBombStations(): BombStation[] {
    return runtimes
      .filter((r) => isBombArmament(r.arm))
      .map((r) => ({ local: r.def.local, kind: r.arm as BombStoreKind }))
  }

  function listRocketStations(): RocketStation[] {
    return runtimes
      .filter((r) => isRocketStore(r.arm))
      .map((r) => ({ local: r.def.local, kind: r.arm as RocketStoreKind }))
  }

  function listAamStations(): AamStation[] {
    return runtimes
      .filter((r) => isMissileArmament(r.arm))
      .map((r) => ({ local: r.def.local, kind: r.arm as MissileStoreKind }))
  }

  return {
    plane,
    get rocketLocals() {
      return listRocketStations().map((s) => s.local)
    },
    get rocketStations() {
      return listRocketStations()
    },
    get aamLocals() {
      return listAamStations().map((s) => s.local)
    },
    get aamStations() {
      return listAamStations()
    },
    get bombLocals() {
      return listBombStations().map((s) => s.local)
    },
    get bombStations() {
      return listBombStations()
    },
    hasLitening() {
      return runtimes.some((r) => isLiteningArmament(r.arm) && r.litening.visible)
    },
    getLiteningMount() {
      const rt = runtimes.find(
        (r) => isLiteningArmament(r.arm) && r.litening.visible,
      )
      return rt?.root ?? null
    },
    markers,
    getStations() {
      const out: Record<string, HardpointArmament> = { ...defaults }
      for (const rt of runtimes) out[rt.def.id] = rt.arm
      return out as PlaneStationMap
    },
    setStation(id, arm) {
      const rt = runtimes.find((r) => r.def.id === id)
      if (!rt) return
      if (!rt.def.allows.includes(arm)) {
        console.warn(`[Steel] Hardpoint ${id} rejects ${arm}`)
        return
      }
      rt.arm = arm
      applyVisual(rt)
      console.info(`[Steel] Hardpoint ${id} → ${arm}`)
    },
    setStations(map) {
      for (const rt of runtimes) {
        const next = map[rt.def.id]
        if (next && rt.def.allows.includes(next)) rt.arm = next
        applyVisual(rt)
      }
    },
    setMarkersVisible(on) {
      for (const m of markers) m.visible = on
    },
    highlight(id) {
      for (const rt of runtimes) {
        const mat = rt.marker.material as THREE.MeshBasicMaterial
        const on = rt.def.id === id
        mat.color.setHex(on ? 0xfff0a0 : 0xf2d44a)
        mat.opacity = on ? 1 : 0.92
        rt.marker.scale.setScalar(on ? 1.25 : 1)
      }
    },
    consumeRocket() {
      const armed = runtimes.filter((r) => {
        const mesh = activeRocketMesh(r)
        return mesh !== null && mesh.visible
      })
      if (armed.length === 0) return
      const rt = armed[rocketConsume % armed.length]!
      const mesh = activeRocketMesh(rt)
      if (mesh) mesh.visible = false
      rocketConsume++
    },
    consumeAam() {
      const armed = runtimes.filter((r) => {
        const mesh = activeAamMesh(r)
        return mesh !== null && mesh.visible
      })
      if (armed.length === 0) return
      const rt = armed[aamConsume % armed.length]!
      const mesh = activeAamMesh(rt)
      if (mesh) mesh.visible = false
      aamConsume++
    },
    consumeBomb() {
      const armed = runtimes.filter((r) => {
        const mesh = activeBombMesh(r)
        return mesh !== null && mesh.visible
      })
      if (armed.length === 0) return
      const rt = armed[bombConsume % armed.length]!
      const mesh = activeBombMesh(rt)
      if (mesh) mesh.visible = false
      bombConsume++
    },
    dispose() {
      disposed = true
      group.parent?.remove(group)
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        if (o.userData.sharedMunition) return
        o.geometry?.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) m?.dispose()
      })
    },
  }
}

/** @deprecated prefer attachAircraftHardpoints({ plane: 'corsair' }) */
export function attachCorsairHardpoints(
  root: THREE.Object3D,
  opts?: {
    stations?: Partial<CorsairStationMap>
    markers?: boolean
  },
): AircraftHardpoints {
  return attachAircraftHardpoints(root, {
    plane: 'corsair',
    stations: opts?.stations,
    markers: opts?.markers,
  })
}
