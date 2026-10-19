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
 * Yak-9: 2× wing KAB-500KR.
 * MiG-15: 4× wing rockets (S-5 label · HVAR mesh) + 2× KAB.
 * MiG-21: R-73 / S-5 / KAB-500KR mix.
 * Su-25: 6× per wing · R-73 / S-5 / KAB.
 * Su-27: tip + underwing + intake · prior Soviet stores + R-77.
 */

export type HardpointPlaneId =
  | 'corsair'
  | 'p51'
  | 'f84f'
  | 'f16'
  | 'f35b'
  | 'f104g'
  | 'yak9'
  | 'mig15'
  | 'mig21'
  | 'su25'
  | 'su27'

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

/** MiG-15 — same ids as P-51 / F-84F. */
export type Mig15StationId = P51StationId

/** MiG-21 — same ids as MiG-15. */
export type Mig21StationId = P51StationId

/**
 * Su-25 — 6 per wing: tip (small) + 5 big (outer→wing inboard).
 * `midIn` = skipped middle rack between mid and inner.
 */
export type Su25StationId =
  | 'tipL'
  | 'tipR'
  | 'outerL'
  | 'outerR'
  | 'midL'
  | 'midR'
  | 'midInL'
  | 'midInR'
  | 'innerL'
  | 'innerR'
  | 'wingL'
  | 'wingR'

/** Su-27 — tip / underwing / intake belly pair. */
export type Su27StationId =
  | 'tipL'
  | 'tipR'
  | 'outerL'
  | 'outerR'
  | 'midL'
  | 'midR'
  | 'innerL'
  | 'innerR'
  | 'wingL'
  | 'wingR'
  | 'bellyL'
  | 'bellyR'

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

/** Yak-9 — two under-wing bomb stations. */
export type Yak9StationId = 'wingL' | 'wingR'

export type HardpointStationId =
  | CorsairStationId
  | P51StationId
  | F84FStationId
  | F16StationId
  | F35BStationId
  | F104GStationId
  | Yak9StationId
  | Mig15StationId
  | Mig21StationId
  | Su25StationId
  | Su27StationId
export type HardpointArmament =
  | 'empty'
  | 'rocket'
  | 'bomb'
  | 'bomb1000'
  | 'gbu27'
  | 'kab500'
  | 'kab500l'
  | 'fab100'
  | 'ter'
  | 'terGbu'
  | 'aim9'
  | 'aim120'
  | 'r73'
  | 'r77'
  | 'hellfire'
  | 'litening'

/** TER rack variants (picker chooses payload). */
export type TerArmament = 'ter' | 'terGbu'

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
/** F-16 tip — bombs, seekers, Litening (no TER). */
const F16_TIP_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
  'aim9',
  'aim120',
  'hellfire',
  'litening',
]
/** F-16 mid (outer) + inner (wing) — same + TER (500 lb / GBU). */
const F16_MID_INNER_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'bomb',
  'bomb1000',
  'gbu27',
  'ter',
  'terGbu',
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
/** F-35 tip — seekers only. */
const F35_MISSILE_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'aim9',
  'aim120',
  'hellfire',
]
/** F-35 mid (outer) + inner (wing) — seekers + TER (500 lb / GBU). */
const F35_MID_INNER_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'aim9',
  'aim120',
  'hellfire',
  'ter',
  'terGbu',
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
/** Yak-9 / MiG-15 wing — KAB / FAB. */
const YAK9_BOMB_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'kab500',
  'kab500l',
  'fab100',
]
/** MiG-15 tip/mid — unguided rockets (mesh = HVAR; UI = S-5). */
const MIG15_ROCKET_ALLOWS: readonly HardpointArmament[] = ['empty', 'rocket']
/** MiG-21 stations — R-73 / S-5 / KAB / FAB. */
const MIG21_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'r73',
  'rocket',
  'kab500',
  'kab500l',
  'fab100',
]
/** Su-25 tip (small pylon) — S-5 or R-73. */
const SU25_SMALL_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'rocket',
  'r73',
]
/** Su-25 big pylons — S-5 / R-73 / KAB / FAB. */
const SU25_BIG_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'rocket',
  'r73',
  'kab500',
  'kab500l',
  'fab100',
]
/** Su-27 tip — AAMs + S-5 (no bombs). */
const SU27_TIP_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'r73',
  'r77',
  'rocket',
]
/** Su-27 underwing / intake — prior Soviet store mix + R-77. */
const SU27_BIG_ALLOWS: readonly HardpointArmament[] = [
  'empty',
  'r73',
  'r77',
  'rocket',
  'kab500',
  'kab500l',
  'fab100',
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
  { id: 'tipL', allows: F16_TIP_ALLOWS, local: [4.3, -1.4, -3.0] },
  { id: 'tipR', allows: F16_TIP_ALLOWS, local: [-4.3, -1.4, -3.0] },
  { id: 'outerL', allows: F16_MID_INNER_ALLOWS, local: [3.1, -1.44, -2.1] },
  { id: 'outerR', allows: F16_MID_INNER_ALLOWS, local: [-3.1, -1.44, -2.1] },
  { id: 'wingL', allows: F16_MID_INNER_ALLOWS, local: [1.75, -1.5, -1.2] },
  { id: 'wingR', allows: F16_MID_INNER_ALLOWS, local: [-1.75, -1.5, -1.2] },
  { id: 'belly', allows: F16_BELLY_ALLOWS, local: [0, -1.54, -1.35] },
]

/**
 * F-35B Lightning II — tip/outer/wing + belly (≈10.7 m span).
 * Tip = missiles; mid (outer) + inner (wing) = missiles + TER; belly = bombs/GBU.
 */
export const F35B_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: F35_MISSILE_ALLOWS, local: [3.15, -0.58, -1.35] },
  { id: 'tipR', allows: F35_MISSILE_ALLOWS, local: [-3.15, -0.58, -1.35] },
  { id: 'outerL', allows: F35_MID_INNER_ALLOWS, local: [2.35, -0.62, -0.95] },
  { id: 'outerR', allows: F35_MID_INNER_ALLOWS, local: [-2.35, -0.62, -0.95] },
  { id: 'wingL', allows: F35_MID_INNER_ALLOWS, local: [1.55, -0.68, -0.55] },
  { id: 'wingR', allows: F35_MID_INNER_ALLOWS, local: [-1.55, -0.68, -0.55] },
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

/**
 * Yak-9 — 2× under-wing KAB-500KR (≈9.74 m span, nose +Z after bake).
 * Inboard wing stations; slight aft of CG so racks clear gear.
 */
export const YAK9_STATIONS: readonly HardpointStationDef[] = [
  { id: 'wingL', allows: YAK9_BOMB_ALLOWS, local: [1.75, -0.72, 0.35] },
  { id: 'wingR', allows: YAK9_BOMB_ALLOWS, local: [-1.75, -0.72, 0.35] },
]

/**
 * MiG-15 — 4× under-wing rockets + 2× KAB-500KR (≈10.08 m span, nose +Z).
 * Swept wing: tip furthest aft; no stub pylons (airframe mounts).
 */
export const MIG15_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: MIG15_ROCKET_ALLOWS, local: [3.45, -0.72, -0.95] },
  { id: 'tipR', allows: MIG15_ROCKET_ALLOWS, local: [-3.45, -0.72, -0.95] },
  { id: 'midL', allows: MIG15_ROCKET_ALLOWS, local: [2.45, -0.76, -0.35] },
  { id: 'midR', allows: MIG15_ROCKET_ALLOWS, local: [-2.45, -0.76, -0.35] },
  { id: 'wingL', allows: YAK9_BOMB_ALLOWS, local: [1.55, -0.82, 0.15] },
  { id: 'wingR', allows: YAK9_BOMB_ALLOWS, local: [-1.55, -0.82, 0.15] },
]

/**
 * MiG-21PFM — tip R-73 / mid S-5 / wing KAB (≈7.15 m span, nose +Z).
 * Delta: stations sit close-in; tip furthest aft.
 */
export const MIG21_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: MIG21_ALLOWS, local: [2.55, -0.78, -2.05] },
  { id: 'tipR', allows: MIG21_ALLOWS, local: [-2.55, -0.78, -2.05] },
  { id: 'midL', allows: MIG21_ALLOWS, local: [1.85, -0.84, -1.15] },
  { id: 'midR', allows: MIG21_ALLOWS, local: [-1.85, -0.84, -1.15] },
  { id: 'wingL', allows: MIG21_ALLOWS, local: [1.15, -0.88, -0.45] },
  { id: 'wingR', allows: MIG21_ALLOWS, local: [-1.15, -0.88, -0.45] },
]

/**
 * Su-25UBP — 6 under-wing pylons per side (mesh valleys, ≈14.36 m span).
 * tip = small; outer/mid/midIn/inner/wing = big. Nose +Z, left wing +X.
 */
export const SU25_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: SU25_SMALL_ALLOWS, local: [6.47, -1.22, -1.43] },
  { id: 'tipR', allows: SU25_SMALL_ALLOWS, local: [-6.47, -1.22, -1.43] },
  { id: 'outerL', allows: SU25_BIG_ALLOWS, local: [5.09, -1.36, -0.75] },
  { id: 'outerR', allows: SU25_BIG_ALLOWS, local: [-5.09, -1.36, -0.75] },
  { id: 'midL', allows: SU25_BIG_ALLOWS, local: [4.33, -1.33, -0.18] },
  { id: 'midR', allows: SU25_BIG_ALLOWS, local: [-4.33, -1.33, -0.18] },
  { id: 'midInL', allows: SU25_BIG_ALLOWS, local: [3.55, -1.27, 0.06] },
  { id: 'midInR', allows: SU25_BIG_ALLOWS, local: [-3.55, -1.27, 0.06] },
  { id: 'innerL', allows: SU25_BIG_ALLOWS, local: [2.78, -1.23, 0.33] },
  { id: 'innerR', allows: SU25_BIG_ALLOWS, local: [-2.78, -1.23, 0.33] },
  { id: 'wingL', allows: SU25_BIG_ALLOWS, local: [2.01, -1.19, 0.55] },
  { id: 'wingR', allows: SU25_BIG_ALLOWS, local: [-2.01, -1.19, 0.55] },
]

/**
 * Su-27SKM — tip + 4 underwing + intake belly (≈14.7 m span, nose +Z after π bake).
 * Locals from under-skin valleys with wingspanAxis x.
 */
export const SU27_STATIONS: readonly HardpointStationDef[] = [
  { id: 'tipL', allows: SU27_TIP_ALLOWS, local: [7.16, -0.98, -4.51] },
  { id: 'tipR', allows: SU27_TIP_ALLOWS, local: [-7.15, -1.05, -4.37] },
  // Mid-wing pair — spread along span (outer toward tip, mid toward root).
  { id: 'outerL', allows: SU27_BIG_ALLOWS, local: [6.55, -1.08, -4.15] },
  { id: 'outerR', allows: SU27_BIG_ALLOWS, local: [-6.55, -1.16, -4.1] },
  { id: 'midL', allows: SU27_BIG_ALLOWS, local: [4.45, -1.1, -3.95] },
  { id: 'midR', allows: SU27_BIG_ALLOWS, local: [-4.45, -1.16, -3.9] },
  { id: 'innerL', allows: SU27_BIG_ALLOWS, local: [2.13, -1.12, -2.56] },
  { id: 'innerR', allows: SU27_BIG_ALLOWS, local: [-2.13, -1.12, -2.56] },
  // Under-fuselage: exterior pair outboard, interior pair toward centerline.
  { id: 'wingL', allows: SU27_BIG_ALLOWS, local: [2.05, -1.83, -1.43] },
  { id: 'wingR', allows: SU27_BIG_ALLOWS, local: [-2.05, -1.86, -1.31] },
  { id: 'bellyL', allows: SU27_BIG_ALLOWS, local: [0.42, -1.81, 0.33] },
  { id: 'bellyR', allows: SU27_BIG_ALLOWS, local: [-0.42, -1.79, 0.03] },
]

export type CorsairStationMap = Record<CorsairStationId, HardpointArmament>
export type P51StationMap = Record<P51StationId, HardpointArmament>
export type F84FStationMap = Record<F84FStationId, HardpointArmament>
export type F16StationMap = Record<F16StationId, HardpointArmament>
export type F35BStationMap = Record<F35BStationId, HardpointArmament>
export type F104GStationMap = Record<F104GStationId, HardpointArmament>
export type Yak9StationMap = Record<Yak9StationId, HardpointArmament>
export type Mig15StationMap = Record<Mig15StationId, HardpointArmament>
export type Mig21StationMap = Record<Mig21StationId, HardpointArmament>
export type Su25StationMap = Record<Su25StationId, HardpointArmament>
export type Su27StationMap = Record<Su27StationId, HardpointArmament>
export type PlaneStationMap =
  | CorsairStationMap
  | P51StationMap
  | F84FStationMap
  | F16StationMap
  | F35BStationMap
  | F104GStationMap
  | Yak9StationMap
  | Mig15StationMap
  | Mig21StationMap
  | Su25StationMap
  | Su27StationMap

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

export const DEFAULT_YAK9_STATIONS: Yak9StationMap = {
  wingL: 'kab500',
  wingR: 'kab500',
}

/** Strike default — 4× S-5 + 2× KAB. */
export const DEFAULT_MIG15_STATIONS: Mig15StationMap = {
  tipL: 'rocket',
  tipR: 'rocket',
  midL: 'rocket',
  midR: 'rocket',
  wingL: 'kab500',
  wingR: 'kab500',
}

/** Strike default — tip R-73 · mid S-5 · wing KAB. */
export const DEFAULT_MIG21_STATIONS: Mig21StationMap = {
  tipL: 'r73',
  tipR: 'r73',
  midL: 'rocket',
  midR: 'rocket',
  wingL: 'kab500',
  wingR: 'kab500',
}

/** Strike — tip/outer S-5 · mid/midIn/inner/wing KAB (5 big + tip small). */
export const DEFAULT_SU25_STATIONS: Su25StationMap = {
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
}

/** Strike — tip R-73 · outer/mid R-77 · inner S-5 · wing/belly KAB. */
export const DEFAULT_SU27_STATIONS: Su27StationMap = {
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
}

export function hasHardpointPicker(planeId: string): planeId is HardpointPlaneId {
  return (
    planeId === 'corsair' ||
    planeId === 'p51' ||
    planeId === 'f84f' ||
    planeId === 'f16' ||
    planeId === 'f35b' ||
    planeId === 'f104g' ||
    planeId === 'yak9' ||
    planeId === 'mig15' ||
    planeId === 'mig21' ||
    planeId === 'su25' ||
    planeId === 'su27'
  )
}

export function stationsForPlane(plane: HardpointPlaneId): readonly HardpointStationDef[] {
  if (plane === 'p51') return P51_STATIONS
  if (plane === 'f84f') return F84F_STATIONS
  if (plane === 'f16') return F16_STATIONS
  if (plane === 'f35b') return F35B_STATIONS
  if (plane === 'f104g') return F104G_STATIONS
  if (plane === 'yak9') return YAK9_STATIONS
  if (plane === 'mig15') return MIG15_STATIONS
  if (plane === 'mig21') return MIG21_STATIONS
  if (plane === 'su25') return SU25_STATIONS
  if (plane === 'su27') return SU27_STATIONS
  return CORSAIR_STATIONS
}

export function defaultStations(plane: HardpointPlaneId): PlaneStationMap {
  if (plane === 'p51') return { ...DEFAULT_P51_STATIONS }
  if (plane === 'f84f') return { ...DEFAULT_F84F_STATIONS }
  if (plane === 'f16') return { ...DEFAULT_F16_STATIONS }
  if (plane === 'f35b') return { ...DEFAULT_F35B_STATIONS }
  if (plane === 'f104g') return { ...DEFAULT_F104G_STATIONS }
  if (plane === 'yak9') return { ...DEFAULT_YAK9_STATIONS }
  if (plane === 'mig15') return { ...DEFAULT_MIG15_STATIONS }
  if (plane === 'mig21') return { ...DEFAULT_MIG21_STATIONS }
  if (plane === 'su25') return { ...DEFAULT_SU25_STATIONS }
  if (plane === 'su27') return { ...DEFAULT_SU27_STATIONS }
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
  return (
    a === 'bomb' ||
    a === 'bomb1000' ||
    a === 'gbu27' ||
    a === 'kab500' ||
    a === 'kab500l' ||
    a === 'fab100'
  )
}

/** Triple ejection rack — F-16 / F-35 mid+inner. */
export function isTerArmament(a: HardpointArmament): a is TerArmament {
  return a === 'ter' || a === 'terGbu'
}

/** Drop kind for a TER rack (3× same store). */
export function terPayloadKind(a: TerArmament): BombStoreKind {
  return a === 'terGbu' ? 'gbu27' : 'bomb'
}

export function isAamArmament(a: HardpointArmament): a is AamKind {
  return a === 'aim9' || a === 'aim120' || a === 'r73' || a === 'r77'
}

/** AIM-9 / AIM-120 / R-73 / R-77 / Hellfire — P lock / M fire. */
export function isMissileArmament(a: HardpointArmament): a is MissileStoreKind {
  return (
    a === 'aim9' ||
    a === 'aim120' ||
    a === 'r73' ||
    a === 'r77' ||
    a === 'hellfire'
  )
}

export function isLiteningArmament(a: HardpointArmament): a is 'litening' {
  return a === 'litening'
}

/** Manual-fire HVAR rockets only — AAMs are seekers (P lock / M fire). */
export function isRocketStore(a: HardpointArmament): a is RocketStoreKind {
  return a === 'rocket'
}

/** Hangar / HUD store name. MiG rockets reuse HVAR mesh → labeled S-5. */
export function armamentLabel(
  a: HardpointArmament,
  plane?: HardpointPlaneId,
): string {
  if (a === 'rocket') {
    return plane === 'mig15' ||
      plane === 'mig21' ||
      plane === 'su25' ||
      plane === 'su27'
      ? 'S-5 rocket'
      : 'HVAR rocket'
  }
  if (a === 'bomb') return '500 lb bomb'
  if (a === 'bomb1000') return '1000 lb bomb'
  if (a === 'gbu27') return 'GBU-27 Paveway'
  if (a === 'kab500') return 'KAB-500KR'
  if (a === 'kab500l') return 'KAB-500L'
  if (a === 'fab100') return 'FAB-100'
  if (a === 'ter') return 'TER · 3× 500 lb'
  if (a === 'terGbu') return 'TER · 3× GBU-27'
  if (a === 'aim9') return 'AIM-9 Sidewinder'
  if (a === 'aim120') return 'AIM-120 AMRAAM'
  if (a === 'r73') return 'R-73 Vympel'
  if (a === 'r77') return 'R-77 Adder'
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

/**
 * TER ejector locals (rack space): left / center / right.
 * Triangle — outers slightly forward+high, center aft+low (classic TER).
 */
const TER_SLOTS: readonly (readonly [number, number, number])[] = [
  [-0.34, -0.1, 0.1],
  [0, -0.22, -0.06],
  [0.34, -0.1, 0.1],
]

const _terBox = new THREE.Box3()
const _terInv = new THREE.Matrix4()

/**
 * TER rack (+ optional wing pylon for F-35) + 3 slot groups.
 * Slots start with capsules; `dressTerWithGlb` snaps real bomb GLBs to the ejectors.
 */
function makeTerStore(
  payload: 'bomb' | 'gbu27',
  opts?: { wingPylon?: boolean },
): THREE.Group {
  const g = new THREE.Group()
  g.name = payload === 'gbu27' ? 'hardpointTerGbu' : 'hardpointTer'
  g.userData.terPayload = payload
  const metal = new THREE.MeshStandardMaterial({
    color: 0x3a4038,
    roughness: 0.7,
    metalness: 0.45,
  })
  const barW = payload === 'gbu27' ? 0.92 : 0.8
  // Cross-bar (ejector beam)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.055, 0.16), metal)
  bar.position.set(0, 0, 0)
  g.add(bar)
  // Spine under bar
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.28), metal)
  spine.position.set(0, 0.04, 0)
  g.add(spine)

  if (opts?.wingPylon) {
    // F-35 under-wing pylon: wedge from wing down to TER spine.
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.48, 0.55),
      metal.clone(),
    )
    pylon.name = 'terWingPylon'
    pylon.position.set(0, 0.32, 0.02)
    // Slight forward taper via scale
    pylon.scale.set(1, 1, 1.05)
    g.add(pylon)
    const fairing = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.62),
      metal.clone(),
    )
    fairing.position.set(0, 0.52, 0.02)
    g.add(fairing)
  }

  for (let i = 0; i < TER_SLOTS.length; i++) {
    const [sx, sy, sz] = TER_SLOTS[i]!
    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.1), metal)
    stub.position.set(sx, sy + 0.05, sz)
    const slot = new THREE.Group()
    slot.name = `terBomb_${i}`
    slot.userData.terSlot = i
    // Ejector face — bombs snap so their top sits here.
    slot.position.set(sx, sy, sz)
    const fallback = makeBombStoreFallback(payload)
    fallback.scale.setScalar(payload === 'gbu27' ? 0.5 : 0.65)
    slot.add(fallback)
    snapStoreUnderEjector(slot, fallback)
    g.add(stub, slot)
  }
  return g
}

/** Shift a hung store so its AABB top kisses the slot origin (ejector). */
function snapStoreUnderEjector(slot: THREE.Object3D, store: THREE.Object3D): void {
  store.position.set(0, 0, 0)
  slot.updateMatrixWorld(true)
  store.updateMatrixWorld(true)
  _terBox.setFromObject(store)
  _terInv.copy(slot.matrixWorld).invert()
  _terBox.applyMatrix4(_terInv)
  // Small gap so the lug reads as attached, not intersecting the bar.
  store.position.y += 0.015 - _terBox.max.y
}

/** Replace TER slot fallbacks with real hung bomb GLBs, snug on the rack. */
function dressTerWithGlb(ter: THREE.Object3D, payload: 'bomb' | 'gbu27'): void {
  const scale = payload === 'gbu27' ? 0.5 : 0.65
  for (const slot of terBombMeshes(ter)) {
    while (slot.children.length > 0) {
      const c = slot.children[0]!
      slot.remove(c)
      disposeProceduralStore(c)
    }
    const hung = cloneBombHung(payload)
    if (!hung) {
      const fb = makeBombStoreFallback(payload)
      fb.scale.setScalar(scale)
      slot.add(fb)
      snapStoreUnderEjector(slot, fb)
      continue
    }
    // Clear cloneBombHung's solo-pylon hang offset — TER slot owns placement.
    hung.position.set(0, 0, 0)
    hung.scale.multiplyScalar(scale)
    hung.visible = true
    slot.add(hung)
    snapStoreUnderEjector(slot, hung)
  }
}

function makeBombStoreFallback(kind: BombStoreKind): THREE.Group {
  const g = new THREE.Group()
  g.name =
    kind === 'bomb1000'
      ? 'hardpointBomb1000'
      : kind === 'gbu27'
        ? 'hardpointGbu27'
        : kind === 'kab500'
          ? 'hardpointKab500'
          : kind === 'kab500l'
            ? 'hardpointKab500l'
            : kind === 'fab100'
              ? 'hardpointFab100'
              : 'hardpointBomb'
  const r =
    kind === 'bomb1000' ||
    kind === 'gbu27' ||
    kind === 'kab500' ||
    kind === 'kab500l'
      ? 0.22
      : kind === 'fab100'
        ? 0.14
        : 0.18
  const h =
    kind === 'gbu27'
      ? 1.35
      : kind === 'bomb1000' || kind === 'kab500' || kind === 'kab500l'
        ? 1.2
        : kind === 'fab100'
          ? 0.7
          : 0.95
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r, h, 4, 8),
    new THREE.MeshStandardMaterial({
      color:
        kind === 'gbu27'
          ? 0x5a5248
          : kind === 'kab500l'
            ? 0x454838
            : kind === 'kab500'
              ? 0x3d4538
              : kind === 'fab100'
                ? 0x4a4538
                : kind === 'bomb1000'
                  ? 0x3a4038
                  : 0x4a4f45,
      roughness: 0.8,
      metalness: 0.3,
    }),
  )
  body.rotation.x = Math.PI / 2
  body.position.y =
    kind === 'gbu27'
      ? -0.42
      : kind === 'bomb1000' || kind === 'kab500' || kind === 'kab500l'
        ? -0.4
        : kind === 'fab100'
          ? -0.32
          : -0.35
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
  r73: THREE.Object3D
  r77: THREE.Object3D
  hellfire: THREE.Object3D
  litening: THREE.Object3D
  bomb500: THREE.Object3D
  bomb1000: THREE.Object3D
  bombGbu: THREE.Object3D
  bombKab: THREE.Object3D
  bombKabL: THREE.Object3D
  bombFab: THREE.Object3D
  ter: THREE.Object3D
  terGbu: THREE.Object3D
  marker: THREE.Mesh
  arm: HardpointArmament
}

function activeTerMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'ter') return rt.ter
  if (rt.arm === 'terGbu') return rt.terGbu
  return null
}

function activeBombMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'bomb') return rt.bomb500
  if (rt.arm === 'bomb1000') return rt.bomb1000
  if (rt.arm === 'gbu27') return rt.bombGbu
  if (rt.arm === 'kab500') return rt.bombKab
  if (rt.arm === 'kab500l') return rt.bombKabL
  if (rt.arm === 'fab100') return rt.bombFab
  return activeTerMesh(rt)
}

function terBombMeshes(ter: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  ter.traverse((o) => {
    if (typeof o.userData?.terSlot === 'number') out.push(o)
  })
  out.sort(
    (a, b) => (a.userData.terSlot as number) - (b.userData.terSlot as number),
  )
  return out
}

function activeRocketMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'rocket') return rt.rocket
  return null
}

function activeAamMesh(rt: StationRuntime): THREE.Object3D | null {
  if (rt.arm === 'aim9') return rt.aim9
  if (rt.arm === 'aim120') return rt.aim120
  if (rt.arm === 'r73') return rt.r73
  if (rt.arm === 'r77') return rt.r77
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

  // F-84F / F-16 / F-35 / F-104 / MiG meshes — don't stack stub boxes.
  const showPylons =
    plane !== 'f84f' &&
    plane !== 'f16' &&
    plane !== 'f35b' &&
    plane !== 'f104g' &&
    plane !== 'mig15' &&
    plane !== 'mig21' &&
    plane !== 'su25' &&
    plane !== 'su27'
  /** Extra Y on hung stores (P-51/Yak snug; jets lift toward wing). */
  const storeHangY =
    plane === 'p51' || plane === 'yak9'
      ? -0.08
      : plane === 'f16' ||
          plane === 'f35b' ||
          plane === 'f104g' ||
          plane === 'mig15' ||
          plane === 'mig21' ||
          plane === 'su25' ||
          plane === 'su27'
        ? -0.02
        : null
  /** MiG-21: bombs / R-73 hang lower than S-5 rockets (station Y unchanged). */
  const mig21HeavyHangExtra = plane === 'mig21' ? -0.28 : 0
  const baseHang = storeHangY ?? 0
  const heavyHang = baseHang + mig21HeavyHangExtra

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
    const r73 = makeAamFallback('r73')
    const r77 = makeAamFallback('r77')
    const hellfire = makeHellfireFallback()
    const litening = makeLiteningFallback()
    const bomb500 = makeBombStoreFallback('bomb')
    const bomb1000 = makeBombStoreFallback('bomb1000')
    const bombGbu = makeBombStoreFallback('gbu27')
    const bombKab = makeBombStoreFallback('kab500')
    const bombKabL = makeBombStoreFallback('kab500l')
    const bombFab = makeBombStoreFallback('fab100')
    const terPylon = plane === 'f35b'
    const ter = makeTerStore('bomb', { wingPylon: terPylon })
    const terGbu = makeTerStore('gbu27', { wingPylon: terPylon })
    // F-35 TER pylon reaches up toward the wing — drop the rack a bit so the
    // fairing sits under the skin instead of floating mid-air.
    if (terPylon) {
      ter.position.y = -0.28
      terGbu.position.y = -0.28
    }
    if (storeHangY !== null || mig21HeavyHangExtra !== 0) {
      rocket.position.y += baseHang
      for (const o of [aim9, aim120, r77, hellfire, litening, ter, terGbu]) {
        o.position.y += baseHang
      }
      // MiG-21: R-73 + bombs sit lower; rockets keep station hang.
      r73.position.y += heavyHang
      for (const o of [bomb500, bomb1000, bombGbu, bombKab, bombKabL, bombFab]) {
        o.position.y += heavyHang
      }
      for (const g of [bomb500, bomb1000, bombGbu, bombKab, bombKabL, bombFab]) {
        const body = g.children[0]
        if (body) body.position.y = heavyHang
      }
    }
    station.add(
      rocket,
      aim9,
      aim120,
      r73,
      r77,
      hellfire,
      litening,
      bomb500,
      bomb1000,
      bombGbu,
      bombKab,
      bombKabL,
      bombFab,
      ter,
      terGbu,
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
      r73,
      r77,
      hellfire,
      litening,
      bomb500,
      bomb1000,
      bombGbu,
      bombKab,
      bombKabL,
      bombFab,
      ter,
      terGbu,
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
    rt.r73.visible = allowed === 'r73'
    rt.r77.visible = allowed === 'r77'
    rt.hellfire.visible = allowed === 'hellfire'
    rt.litening.visible = allowed === 'litening'
    rt.bomb500.visible = allowed === 'bomb'
    rt.bomb1000.visible = allowed === 'bomb1000'
    rt.bombGbu.visible = allowed === 'gbu27'
    rt.bombKab.visible = allowed === 'kab500'
    rt.bombKabL.visible = allowed === 'kab500l'
    rt.bombFab.visible = allowed === 'fab100'
    rt.ter.visible = allowed === 'ter'
    rt.terGbu.visible = allowed === 'terGbu'
    const terMesh = activeTerMesh(rt)
    if (terMesh) {
      for (const b of terBombMeshes(terMesh)) b.visible = true
    }
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
      for (const kind of [
        'bomb',
        'bomb1000',
        'gbu27',
        'kab500',
        'kab500l',
        'fab100',
      ] as const) {
        const next = cloneBombHung(kind)
        if (!next) continue
        next.position.y = heavyHang
        const prev =
          kind === 'bomb'
            ? rt.bomb500
            : kind === 'bomb1000'
              ? rt.bomb1000
              : kind === 'gbu27'
                ? rt.bombGbu
                : kind === 'kab500'
                  ? rt.bombKab
                  : kind === 'kab500l'
                    ? rt.bombKabL
                    : rt.bombFab
        next.visible = prev.visible
        rt.root.remove(prev)
        disposeProceduralStore(prev)
        rt.root.add(next)
        if (kind === 'bomb') rt.bomb500 = next
        else if (kind === 'bomb1000') rt.bomb1000 = next
        else if (kind === 'gbu27') rt.bombGbu = next
        else if (kind === 'kab500') rt.bombKab = next
        else if (kind === 'kab500l') rt.bombKabL = next
        else rt.bombFab = next
      }
      const hvar = cloneHvarHung()
      if (hvar) {
        hvar.position.y = baseHang
        hvar.visible = rt.rocket.visible
        rt.root.remove(rt.rocket)
        disposeProceduralStore(rt.rocket)
        rt.root.add(hvar)
        rt.rocket = hvar
      }
      for (const kind of ['aim9', 'aim120', 'r73', 'r77'] as const) {
        const next = cloneAamHung(kind)
        if (!next) continue
        next.position.y = kind === 'r73' ? heavyHang : baseHang
        const prev =
          kind === 'aim9'
            ? rt.aim9
            : kind === 'aim120'
              ? rt.aim120
              : kind === 'r73'
                ? rt.r73
                : rt.r77
        next.visible = prev.visible
        rt.root.remove(prev)
        disposeProceduralStore(prev)
        rt.root.add(next)
        if (kind === 'aim9') rt.aim9 = next
        else if (kind === 'aim120') rt.aim120 = next
        else if (kind === 'r73') rt.r73 = next
        else rt.r77 = next
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
      dressTerWithGlb(rt.ter, 'bomb')
      dressTerWithGlb(rt.terGbu, 'gbu27')
      // Restore slot visibility after dress (dress leaves meshes visible).
      if (rt.arm === 'ter') {
        rt.ter.visible = true
        for (const b of terBombMeshes(rt.ter)) b.visible = true
      } else if (rt.arm === 'terGbu') {
        rt.terGbu.visible = true
        for (const b of terBombMeshes(rt.terGbu)) b.visible = true
      }
    }
    console.info(
      `[Steel] ${plane} hardpoints · hung stores ready` +
        (plane === 'f16' || plane === 'f35b'
          ? ' · AIM / Hellfire / Litening / TER GLB'
          : plane === 'f104g'
            ? ' · tip AIM-9 + belly'
            : plane === 'yak9'
              ? ' · 2× KAB-500KR'
              : plane === 'mig15'
                ? ' · S-5 + KAB-500KR'
                : plane === 'mig21'
                  ? ' · R-73 / S-5 / KAB'
                  : plane === 'su25'
                    ? ' · 12× R-73 / S-5 / KAB'
                    : plane === 'su27'
                      ? ' · R-73 / R-77 / S-5 / KAB'
                      : ''),
    )
  })

  console.info(
    `[Steel] ${plane} hardpoints · ${layout.map((s) => s.id).join(', ')}` +
      (showMarkers ? ' · yellow pick' : ''),
  )

  function listBombStations(): BombStation[] {
    const out: BombStation[] = []
    for (const r of runtimes) {
      if (isBombArmament(r.arm)) {
        const [lx, ly, lz] = r.def.local
        out.push({
          local: [lx, ly + mig21HeavyHangExtra, lz],
          kind: r.arm as BombStoreKind,
        })
        continue
      }
      if (!isTerArmament(r.arm)) continue
      const terMesh = activeTerMesh(r)
      if (!terMesh?.visible) continue
      const kind = terPayloadKind(r.arm)
      const [lx, ly, lz] = r.def.local
      const terY = terMesh.position.y
      const slots = terBombMeshes(terMesh)
      for (let i = 0; i < TER_SLOTS.length; i++) {
        const bomb = slots[i]
        if (bomb && !bomb.visible) continue
        const [sx, sy, sz] = TER_SLOTS[i]!
        out.push({
          local: [lx + sx, ly + terY + sy, lz + sz],
          kind,
        })
      }
    }
    return out
  }

  function listRocketStations(): RocketStation[] {
    return runtimes
      .filter((r) => isRocketStore(r.arm))
      .map((r) => ({ local: r.def.local, kind: r.arm as RocketStoreKind }))
  }

  function listAamStations(): AamStation[] {
    return runtimes
      .filter((r) => isMissileArmament(r.arm))
      .map((r) => {
        const [lx, ly, lz] = r.def.local
        const yOff = r.arm === 'r73' ? mig21HeavyHangExtra : 0
        return {
          local: [lx, ly + yOff, lz] as const,
          kind: r.arm as MissileStoreKind,
        }
      })
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
      // FIFO — matches aircraftBombs peekStationIndex (first unused).
      for (const r of runtimes) {
        if (isTerArmament(r.arm)) {
          const terMesh = activeTerMesh(r)
          if (!terMesh?.visible) continue
          for (const b of terBombMeshes(terMesh)) {
            if (!b.visible) continue
            b.visible = false
            if (terBombMeshes(terMesh).every((m) => !m.visible)) {
              terMesh.visible = false
            }
            bombConsume++
            return
          }
          continue
        }
        const mesh = activeBombMesh(r)
        if (!mesh || !mesh.visible) continue
        mesh.visible = false
        bombConsume++
        return
      }
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
