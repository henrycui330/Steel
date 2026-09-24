import type { ArmorPartDef, ArmorPartId } from './armor'
import { armorKit, frontArmorMm } from './armorKits'
import { assetUrl } from './assetUrl'

export type TankId =
  | 'tiger'
  | 'pz3'
  | 'pz4'
  | 'leopard'
  | 'leopard2'
  | 'pzh2000'
  | 'chaffee'
  | 'sherman'
  | 'pershing'
  | 'duster'
  | 'abrams'
  | 't34'
  | 't44'
  | 't55'
  | 'shilka'
  | 'pantsir'
  | 't72'
  | 't90'
  | 'corsair'
  | 'yak9'
  | 'p51'
  | 'f16'
  | 'mig15'
  | 'mig21'
  | 'su25'

export type DriveProfile = {
  maxSpeed: number
  maxReverse: number
  accel: number
  reverseAccel: number
  brakeDecel: number
  coastDrag: number
  turnRate: number
  turnInPlace: number
  /** Max hull pitch from accel (radians). */
  tiltMax: number
  tiltFromAccel: number
}

/** Absolute gun power — not multipliers on a shared weak shell. */
export type GunProfile = {
  /** AP / APHE / APFSDS pen (game mm). */
  aphePen: number
  apheDmg: number
  hePen: number
  heDmg: number
  heBlast: number
  traverseRadPerSec: number
  elevateRadPerSec: number
  /** HUD label for AP-class round. */
  apLabel?: string
  heLabel?: string
}

export type TankOption = {
  id: TankId
  name: string
  /** Short role tag for the menu. */
  role: string
  blurb: string
  url: string
  reloadSec: number
  maxHp: number
  drive: DriveProfile
  gun: GunProfile
  /** Plate thicknesses — used for hit resolution. */
  armor: Record<ArmorPartId, ArmorPartDef>
  /**
   * Target overall width in game units after load (track gauge / hull width).
   * Relative to real tanks: Pz III ~2.9 m, Panther ~3.4 m, Leo 2 ~3.75 m.
   */
  targetWidth: number
  /**
   * WWII / early chassis — susceptible to summer crew heat and winter oil freeze.
   * Modern MBTs ignore those climate penalties.
   */
  vintageCrew: boolean
  /**
   * Sketchfab packs without Turret/Barrel names — aim pivots only (no mesh split).
   */
  rigidRig?: boolean
  /**
   * Self-propelled gun — deploy/map location-aim loop (PzH 2000).
   */
  artillery?: boolean
  /**
   * Fixed-wing aircraft — flies instead of driving. Takes the air branch in
   * `startMission`. Also available as an AI slot (see `spawnAiCorsair`).
   */
  aircraft?: boolean
  /**
   * Jet — no prop SFX, no spinning parts, no gear animation.
   */
  jet?: boolean
  /**
   * Yaw (radians) to bake into podium / raw GLB so nose faces camera-forward.
   * Flight load path applies the same via `loadAircraft`.
   */
  aircraftNoseYaw?: number
  /**
   * SPAAG / AA — high gun elevation + fast reload. When set, `main` applies
   * `aimPitchMinDeg` / `aimPitchMaxDeg` (defaults −5° / +85°).
   */
  antiAir?: boolean
  /**
   * Pantsir-style SAM: M fires seekers at the hard-locked target (off-boresight OK).
   */
  samMissiles?: boolean
  /** Override gun depression (degrees). Used with `antiAir` or SPG. */
  aimPitchMinDeg?: number
  /** Override gun elevation (degrees). */
  aimPitchMaxDeg?: number
  /** Tech-tree nation — used for country-by-country track/wheel passes. */
  nation?: 'germany' | 'usa' | 'soviet'
}

/** Menu / HUD helper. */
export function tankCombatSummary(t: TankOption): {
  pen: number
  frontArmor: number
  hp: number
  apLabel: string
} {
  return {
    pen: t.gun.aphePen,
    frontArmor: frontArmorMm(t.armor),
    hp: t.maxHp,
    apLabel: t.gun.apLabel ?? 'AP',
  }
}

/** Pz-III L — flanking / blitz medium. */
const PZ3_DRIVE: DriveProfile = {
  maxSpeed: 18,
  maxReverse: 7,
  accel: 13,
  reverseAccel: 9,
  brakeDecel: 28,
  coastDrag: 6,
  turnRate: 2.85,
  turnInPlace: 1.4,
  tiltMax: (6.5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/** Panther A — heavy medium / long 75mm (slot id still `tiger`). */
const TIGER_DRIVE: DriveProfile = {
  maxSpeed: 12.5,
  maxReverse: 4.5,
  accel: 7,
  reverseAccel: 5,
  brakeDecel: 19,
  coastDrag: 4.2,
  turnRate: 1.55,
  turnInPlace: 0.9,
  tiltMax: (4.5 * Math.PI) / 180,
  tiltFromAccel: 0.013,
}

/** Pz-IV — versatile medium workhorse. */
const PZ4_DRIVE: DriveProfile = {
  maxSpeed: 14,
  maxReverse: 5.5,
  accel: 9,
  reverseAccel: 6.5,
  brakeDecel: 22,
  coastDrag: 5,
  turnRate: 2.1,
  turnInPlace: 1.05,
  tiltMax: (5 * Math.PI) / 180,
  tiltFromAccel: 0.012,
}

/** Leopard 1 — cold-war MBT, mobility over armor. */
const LEOPARD_DRIVE: DriveProfile = {
  maxSpeed: 20,
  maxReverse: 8,
  accel: 14,
  reverseAccel: 10,
  brakeDecel: 30,
  coastDrag: 5.5,
  turnRate: 2.6,
  turnInPlace: 1.35,
  tiltMax: (5.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** M24 Chaffee — light / infantry support (fast, thin skin, 75mm). */
const CHAFFEE_DRIVE: DriveProfile = {
  maxSpeed: 19.5,
  maxReverse: 7.5,
  accel: 14,
  reverseAccel: 10,
  brakeDecel: 27,
  coastDrag: 5.5,
  turnRate: 2.95,
  turnInPlace: 1.45,
  tiltMax: (6.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** M4 Sherman Firefly — medium / 17-pdr (slower than Chaffee, hard AP). */
const SHERMAN_DRIVE: DriveProfile = {
  maxSpeed: 15.5,
  maxReverse: 6,
  accel: 10,
  reverseAccel: 7,
  brakeDecel: 23,
  coastDrag: 5.2,
  turnRate: 2.25,
  turnInPlace: 1.1,
  tiltMax: (5.5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/** M26 Pershing — heavy medium / 90mm. */
const PERSHING_DRIVE: DriveProfile = {
  maxSpeed: 13.5,
  maxReverse: 5,
  accel: 8.5,
  reverseAccel: 6,
  brakeDecel: 21,
  coastDrag: 4.8,
  turnRate: 1.85,
  turnInPlace: 0.95,
  tiltMax: (5 * Math.PI) / 180,
  tiltFromAccel: 0.012,
}

/** M42 Duster — SPAAG on M41 chassis (fast traverse, light skin). */
const DUSTER_DRIVE: DriveProfile = {
  maxSpeed: 18.5,
  maxReverse: 7,
  accel: 13,
  reverseAccel: 9,
  brakeDecel: 26,
  coastDrag: 5.4,
  turnRate: 2.75,
  turnInPlace: 1.35,
  tiltMax: (6 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** ZSU-23-4 Shilka — tracked SPAAG (quad 23mm, radar turret). */
const SHILKA_DRIVE: DriveProfile = {
  maxSpeed: 14.5,
  maxReverse: 5.5,
  accel: 10,
  reverseAccel: 7,
  brakeDecel: 22,
  coastDrag: 5.6,
  turnRate: 2.2,
  turnInPlace: 1.05,
  tiltMax: (5.5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/** Pantsir-S2 — wheeled SPAAG/SAM (fast road sprint). */
const PANTSIR_DRIVE: DriveProfile = {
  maxSpeed: 20,
  maxReverse: 8,
  accel: 12,
  reverseAccel: 8,
  brakeDecel: 28,
  coastDrag: 5.2,
  turnRate: 2.4,
  turnInPlace: 1.15,
  tiltMax: (5.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** M1A1 Abrams — modern MBT / 120mm. */
const ABRAMS_DRIVE: DriveProfile = {
  maxSpeed: 18,
  maxReverse: 7.5,
  accel: 12,
  reverseAccel: 8.5,
  brakeDecel: 28,
  coastDrag: 5,
  turnRate: 2.35,
  turnInPlace: 1.2,
  tiltMax: (4.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** T-34 — Soviet medium / 76mm. */
const T34_DRIVE: DriveProfile = {
  maxSpeed: 16.5,
  maxReverse: 6.5,
  accel: 11,
  reverseAccel: 7.5,
  brakeDecel: 24,
  coastDrag: 5.2,
  turnRate: 2.4,
  turnInPlace: 1.15,
  tiltMax: (5.5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/** T-44-100 — late-war / early cold-war medium · 100mm. */
const T44_DRIVE: DriveProfile = {
  maxSpeed: 15.5,
  maxReverse: 6,
  accel: 10,
  reverseAccel: 7,
  brakeDecel: 23,
  coastDrag: 5,
  turnRate: 2.2,
  turnInPlace: 1.1,
  tiltMax: (5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/** T-55 — cold-war MBT · 100mm. */
const T55_DRIVE: DriveProfile = {
  maxSpeed: 16,
  maxReverse: 6.5,
  accel: 10.5,
  reverseAccel: 7.5,
  brakeDecel: 25,
  coastDrag: 5,
  turnRate: 2.25,
  turnInPlace: 1.15,
  tiltMax: (5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** T-72 Ural — cold-war MBT · 125mm. */
const T72_DRIVE: DriveProfile = {
  maxSpeed: 17,
  maxReverse: 7,
  accel: 11,
  reverseAccel: 8,
  brakeDecel: 26,
  coastDrag: 5,
  turnRate: 2.3,
  turnInPlace: 1.2,
  tiltMax: (4.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** T-90 — modern MBT · 125mm. */
const T90_DRIVE: DriveProfile = {
  maxSpeed: 17.5,
  maxReverse: 7.5,
  accel: 11.5,
  reverseAccel: 8.5,
  brakeDecel: 27,
  coastDrag: 5,
  turnRate: 2.4,
  turnInPlace: 1.25,
  tiltMax: (4.5 * Math.PI) / 180,
  tiltFromAccel: 0.01,
}

/** PzH 2000 — SPG · slow chassis, long 155mm. */
const PZH_DRIVE: DriveProfile = {
  maxSpeed: 14.5,
  maxReverse: 5.5,
  accel: 9.5,
  reverseAccel: 6.5,
  brakeDecel: 24,
  coastDrag: 5.5,
  turnRate: 2.0,
  turnInPlace: 1.05,
  tiltMax: (4 * Math.PI) / 180,
  tiltFromAccel: 0.009,
}

/** Leopard 2A6 — modern MBT, heavy punch + good mobility. */
const LEOPARD2_DRIVE: DriveProfile = {
  maxSpeed: 17.5,
  maxReverse: 7,
  accel: 11,
  reverseAccel: 8,
  brakeDecel: 26,
  coastDrag: 5,
  turnRate: 2.2,
  turnInPlace: 1.15,
  tiltMax: (4.5 * Math.PI) / 180,
  tiltFromAccel: 0.011,
}

/**
 * Placeholder ground profile for the Corsair. Aircraft never use the drive
 * controller — the flight model moves them — but the shared option shape
 * requires a profile.
 */
const CORSAIR_DRIVE: DriveProfile = {
  maxSpeed: 0,
  maxReverse: 0,
  accel: 0,
  reverseAccel: 0,
  brakeDecel: 0,
  coastDrag: 0,
  turnRate: 0,
  turnInPlace: 0,
  tiltMax: 0,
  tiltFromAccel: 0,
}

/** Selectable player vehicles (files in public/models/). */
export const TANK_OPTIONS: TankOption[] = [
  {
    id: 'tiger',
    name: 'Pz-V Panther A',
    role: 'Heavy medium',
    blurb: 'Fast for its weight · long 75mm · frontal slope · open-ground hunter',
    url: assetUrl('models/tiger.glb?v=4'),
    reloadSec: 6.5,
    maxHp: 1100,
    targetWidth: 3.05,
    vintageCrew: true,
    nation: 'germany',
    drive: TIGER_DRIVE,
    armor: armorKit({ front: 120, side: 50, rear: 40, turret: 110 }),
    gun: {
      aphePen: 165,
      apheDmg: 420,
      hePen: 18,
      heDmg: 90,
      heBlast: 160,
      traverseRadPerSec: 4.6,
      elevateRadPerSec: 3.4,
      apLabel: 'APCBC',
      heLabel: 'HE',
    },
  },
  {
    id: 'pz3',
    name: 'Pz-III L',
    role: 'Flanking blitz',
    blurb: 'Fast · agile · quick reload · made for flank and encircle',
    url: assetUrl('models/pz3.glb?v=5'),
    reloadSec: 4,
    maxHp: 680,
    targetWidth: 2.7,
    vintageCrew: true,
    nation: 'germany',
    drive: PZ3_DRIVE,
    armor: armorKit({ front: 72, side: 28, rear: 12, turret: 38 }),
    gun: {
      aphePen: 78,
      apheDmg: 260,
      hePen: 12,
      heDmg: 70,
      heBlast: 130,
      traverseRadPerSec: 8.5,
      elevateRadPerSec: 5.5,
      apLabel: 'APHE',
      heLabel: 'HE',
    },
  },
  {
    id: 'pz4',
    name: 'Pz-IV',
    role: 'Medium workhorse',
    blurb: 'Balanced · long 75mm · the German jack-of-all-trades',
    url: assetUrl('models/pz4.glb?v=30'),
    reloadSec: 5.5,
    maxHp: 920,
    targetWidth: 2.7,
    vintageCrew: true,
    nation: 'germany',
    drive: PZ4_DRIVE,
    armor: armorKit({ front: 85, side: 35, rear: 22, turret: 55 }),
    gun: {
      aphePen: 135,
      apheDmg: 360,
      hePen: 16,
      heDmg: 85,
      heBlast: 150,
      traverseRadPerSec: 6.2,
      elevateRadPerSec: 4.2,
      apLabel: 'APCBC',
      heLabel: 'HE',
    },
  },
  {
    id: 'leopard',
    name: 'Leopard 1',
    role: 'Cold-war MBT',
    blurb: 'Fast · sharp 105mm · thin skin · shoot and scoot',
    url: assetUrl('models/leopard.glb?v=3'),
    reloadSec: 5,
    maxHp: 980,
    targetWidth: 2.95,
    vintageCrew: false,
    nation: 'germany',
    drive: LEOPARD_DRIVE,
    armor: armorKit({ front: 180, side: 70, rear: 40, turret: 160 }),
    gun: {
      aphePen: 320,
      apheDmg: 620,
      hePen: 28,
      heDmg: 120,
      heBlast: 200,
      traverseRadPerSec: 7.2,
      elevateRadPerSec: 4.8,
      apLabel: 'APDS',
      heLabel: 'HE',
    },
  },
  {
    id: 'leopard2',
    name: 'Leopard 2A6',
    role: 'Modern MBT',
    blurb: 'L55 120mm · composite armor · NATO spearhead',
    url: assetUrl('models/leopard2.glb?v=13'),
    reloadSec: 5.5,
    maxHp: 1520,
    targetWidth: 3.35,
    vintageCrew: false,
    nation: 'germany',
    drive: LEOPARD2_DRIVE,
    armor: armorKit({ front: 720, side: 220, rear: 90, turret: 780, modern: true }),
    gun: {
      aphePen: 780,
      apheDmg: 1180,
      hePen: 40,
      heDmg: 180,
      heBlast: 280,
      traverseRadPerSec: 6.5,
      elevateRadPerSec: 4.5,
      apLabel: 'APFSDS',
      heLabel: 'HE',
    },
  },
  {
    id: 'pzh2000',
    name: 'PzH 2000',
    role: 'SPG · 155mm howitzer',
    blurb: 'Stop · map-aim · lock · fire for effect',
    url: assetUrl('models/pzh2000.glb?v=8'),
    reloadSec: 8.0,
    maxHp: 1050,
    targetWidth: 3.5,
    vintageCrew: false,
    nation: 'germany',
    artillery: true,
    drive: PZH_DRIVE,
    armor: armorKit({ front: 90, side: 45, rear: 30, turret: 70 }),
    gun: {
      aphePen: 95,
      apheDmg: 400,
      hePen: 55,
      heDmg: 220,
      heBlast: 520,
      traverseRadPerSec: 4.5,
      elevateRadPerSec: 3.8,
      apLabel: 'AP',
      heLabel: 'HE 155',
    },
  },
  {
    id: 'chaffee',
    name: 'M24 Chaffee',
    role: 'Light infantry support',
    blurb: 'Quick · light · 75mm · built to aid infantry in fast fights',
    url: assetUrl('models/m24_chaffee.glb?v=1'),
    reloadSec: 4.2,
    maxHp: 620,
    targetWidth: 2.85,
    vintageCrew: true,
    rigidRig: false,
    drive: CHAFFEE_DRIVE,
    armor: armorKit({ front: 45, side: 22, rear: 18, turret: 38 }),
    gun: {
      aphePen: 95,
      apheDmg: 280,
      hePen: 14,
      heDmg: 80,
      heBlast: 145,
      traverseRadPerSec: 7.8,
      elevateRadPerSec: 5.2,
      apLabel: 'APCBC',
      heLabel: 'HE',
    },
  },
  {
    id: 'sherman',
    name: 'M4 Sherman Firefly',
    role: 'Medium · 17-pdr',
    blurb: 'Allied medium · long 17-pounder · hard AP punch',
    url: assetUrl('models/m4_sherman_firefly.glb?v=1'),
    reloadSec: 6.2,
    maxHp: 900,
    targetWidth: 2.95,
    vintageCrew: true,
    rigidRig: false,
    drive: SHERMAN_DRIVE,
    armor: armorKit({ front: 76, side: 38, rear: 38, turret: 76 }),
    gun: {
      aphePen: 175,
      apheDmg: 440,
      hePen: 18,
      heDmg: 95,
      heBlast: 155,
      traverseRadPerSec: 5.8,
      elevateRadPerSec: 4.0,
      apLabel: 'APCBC',
      heLabel: 'HE',
    },
  },
  {
    id: 'pershing',
    name: 'M26 Pershing',
    role: 'Heavy medium · 90mm',
    blurb: 'Late-war US · thick face · 90mm M3',
    url: assetUrl('models/m26_pershing.glb?v=2'),
    reloadSec: 6.0,
    maxHp: 1180,
    targetWidth: 3.15,
    vintageCrew: true,
    rigidRig: false,
    drive: PERSHING_DRIVE,
    armor: armorKit({ front: 140, side: 76, rear: 50, turret: 130 }),
    gun: {
      aphePen: 210,
      apheDmg: 520,
      hePen: 22,
      heDmg: 110,
      heBlast: 175,
      traverseRadPerSec: 5.2,
      elevateRadPerSec: 3.8,
      apLabel: 'APCBC',
      heLabel: 'HE',
    },
  },
  {
    id: 'duster',
    name: 'M42 Duster',
    role: 'SPAAG · twin 40mm',
    blurb: 'Open turret · twin Bofors · owns low-flying aircraft',
    url: assetUrl('models/m42_duster.glb?v=1'),
    reloadSec: 0.38,
    maxHp: 560,
    targetWidth: 3.23,
    vintageCrew: true,
    nation: 'usa',
    antiAir: true,
    aimPitchMinDeg: -5,
    aimPitchMaxDeg: 85,
    rigidRig: false,
    drive: DUSTER_DRIVE,
    armor: armorKit({ front: 25, side: 12, rear: 12, turret: 15 }),
    gun: {
      aphePen: 52,
      apheDmg: 110,
      hePen: 10,
      heDmg: 70,
      heBlast: 110,
      traverseRadPerSec: 8.8,
      elevateRadPerSec: 7.2,
      apLabel: 'AP 40mm',
      heLabel: 'HE-T 40mm',
    },
  },
  {
    id: 'abrams',
    name: 'M1A1 Abrams',
    role: 'Modern MBT · 120mm',
    blurb: 'US heavyweight · composite armor · L44 120mm',
    url: assetUrl('models/m1a1_abrams.glb?v=2'),
    reloadSec: 5.0,
    maxHp: 1580,
    targetWidth: 3.65,
    vintageCrew: false,
    rigidRig: false,
    drive: ABRAMS_DRIVE,
    armor: armorKit({ front: 760, side: 240, rear: 95, turret: 820, modern: true }),
    gun: {
      aphePen: 800,
      apheDmg: 1220,
      hePen: 42,
      heDmg: 190,
      heBlast: 290,
      traverseRadPerSec: 6.8,
      elevateRadPerSec: 4.6,
      apLabel: 'APFSDS',
      heLabel: 'HE',
    },
  },
  {
    id: 't34',
    name: 'T-34',
    role: 'Soviet medium · 76mm',
    blurb: 'Sloped armor · wide tracks · the Red Army workhorse',
    url: assetUrl('models/t34.glb?v=2'),
    reloadSec: 5.2,
    maxHp: 860,
    targetWidth: 3.0,
    vintageCrew: true,
    rigidRig: false,
    drive: T34_DRIVE,
    armor: armorKit({ front: 90, side: 45, rear: 40, turret: 70 }),
    gun: {
      aphePen: 95,
      apheDmg: 300,
      hePen: 14,
      heDmg: 85,
      heBlast: 150,
      traverseRadPerSec: 5.5,
      elevateRadPerSec: 4.0,
      apLabel: 'APHE',
      heLabel: 'HE',
    },
  },
  {
    id: 't44',
    name: 'T-44-100',
    role: 'Soviet medium · 100mm',
    blurb: 'Low silhouette · hard 100mm · bridge from T-34 to T-54',
    url: assetUrl('models/t44_100.glb?v=2'),
    reloadSec: 5.8,
    maxHp: 1020,
    targetWidth: 3.1,
    vintageCrew: true,
    rigidRig: false,
    drive: T44_DRIVE,
    armor: armorKit({ front: 130, side: 75, rear: 45, turret: 120 }),
    gun: {
      aphePen: 220,
      apheDmg: 540,
      hePen: 24,
      heDmg: 115,
      heBlast: 185,
      traverseRadPerSec: 5.4,
      elevateRadPerSec: 3.9,
      apLabel: 'APHE',
      heLabel: 'HE',
    },
  },
  {
    id: 't55',
    name: 'T-55',
    role: 'Cold-war MBT · 100mm',
    blurb: 'Ubiquitous · thick face · D-10T 100mm',
    url: assetUrl('models/t55.glb?v=2'),
    reloadSec: 5.5,
    maxHp: 1180,
    targetWidth: 3.3,
    vintageCrew: false,
    rigidRig: false,
    drive: T55_DRIVE,
    armor: armorKit({ front: 240, side: 90, rear: 50, turret: 220 }),
    gun: {
      aphePen: 280,
      apheDmg: 600,
      hePen: 26,
      heDmg: 125,
      heBlast: 200,
      traverseRadPerSec: 5.8,
      elevateRadPerSec: 4.2,
      apLabel: 'APDS',
      heLabel: 'HE',
    },
  },
  {
    id: 'shilka',
    name: 'ZSU-23-4 Shilka',
    role: 'SPAAG · quad 23mm',
    blurb: 'Radar turret · AZP-23 shredder · soft vs tanks, lethal vs air',
    url: assetUrl('models/zsu_shilka.glb?v=1'),
    reloadSec: 0.22,
    maxHp: 620,
    targetWidth: 2.95,
    vintageCrew: false,
    nation: 'soviet',
    antiAir: true,
    aimPitchMinDeg: -4,
    aimPitchMaxDeg: 85,
    rigidRig: false,
    drive: SHILKA_DRIVE,
    armor: armorKit({ front: 15, side: 10, rear: 10, turret: 12 }),
    gun: {
      aphePen: 38,
      apheDmg: 85,
      hePen: 8,
      heDmg: 55,
      heBlast: 90,
      traverseRadPerSec: 9.5,
      elevateRadPerSec: 8.0,
      apLabel: 'AP-T 23mm',
      heLabel: 'HEI-T 23mm',
    },
  },
  {
    id: 'pantsir',
    name: 'Pantsir-S2',
    role: 'SPAAG / SAM · 30mm + missiles',
    blurb: 'Radar lock · off-boresight SAMs · shreds aircraft',
    url: assetUrl('models/pantsir_s2.glb?v=1'),
    reloadSec: 0.18,
    maxHp: 720,
    targetWidth: 3.0,
    vintageCrew: false,
    nation: 'soviet',
    antiAir: true,
    samMissiles: true,
    aimPitchMinDeg: -5,
    aimPitchMaxDeg: 85,
    rigidRig: false,
    drive: PANTSIR_DRIVE,
    armor: armorKit({ front: 20, side: 14, rear: 12, turret: 18 }),
    gun: {
      aphePen: 42,
      apheDmg: 95,
      hePen: 10,
      heDmg: 60,
      heBlast: 95,
      traverseRadPerSec: 9.0,
      elevateRadPerSec: 7.5,
      apLabel: 'AP 30mm',
      heLabel: 'HEI 30mm',
    },
  },
  {
    id: 't72',
    name: 'T-72 Ural',
    role: 'Cold-war MBT · 125mm',
    blurb: 'Autoloader · low profile · 2A46 125mm',
    url: assetUrl('models/t72.glb?v=1'),
    reloadSec: 6.5,
    maxHp: 1380,
    targetWidth: 3.55,
    vintageCrew: false,
    rigidRig: false,
    drive: T72_DRIVE,
    armor: armorKit({ front: 420, side: 140, rear: 60, turret: 450 }),
    gun: {
      aphePen: 520,
      apheDmg: 880,
      hePen: 36,
      heDmg: 160,
      heBlast: 250,
      traverseRadPerSec: 6.2,
      elevateRadPerSec: 4.4,
      apLabel: 'APFSDS',
      heLabel: 'HE',
    },
  },
  {
    id: 't90',
    name: 'T-90',
    role: 'Modern MBT · 125mm',
    blurb: 'Shtora · Kontakt · 2A46M 125mm — final boss',
    url: assetUrl('models/t90.glb?v=9'),
    reloadSec: 6.2,
    maxHp: 1600,
    targetWidth: 3.7,
    vintageCrew: false,
    rigidRig: false,
    drive: T90_DRIVE,
    armor: armorKit({ front: 780, side: 250, rear: 100, turret: 850, modern: true }),
    gun: {
      aphePen: 820,
      apheDmg: 1250,
      hePen: 44,
      heDmg: 200,
      heBlast: 300,
      traverseRadPerSec: 6.6,
      elevateRadPerSec: 4.6,
      apLabel: 'APFSDS',
      heLabel: 'HE',
    },
  },
  {
    id: 'corsair',
    name: 'F4U-1A Corsair',
    role: 'Fighter-bomber · air',
    blurb: 'Bent-wing carrier fighter · six .50s · bombs + HVAR rockets',
    url: assetUrl('models/f4u_corsair.glb?v=5'),
    reloadSec: 0.12,
    maxHp: 520,
    // Wingspan, not track gauge — the air rig scales from this.
    targetWidth: 12.5,
    vintageCrew: true,
    nation: 'usa',
    aircraft: true,
    // Required by the shared option shape but unused: the flight model owns
    // aircraft movement (Phase F4U task F2).
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 16, side: 12, rear: 10, turret: 14 }),
    gun: {
      aphePen: 26,
      apheDmg: 55,
      hePen: 8,
      heDmg: 30,
      heBlast: 40,
      traverseRadPerSec: 2.4,
      elevateRadPerSec: 2.0,
      apLabel: 'AP .50',
      heLabel: 'API .50',
    },
  },
  {
    id: 'p51',
    name: 'P-51 Mustang',
    role: 'Fighter · air',
    blurb: 'Long-range escort · six .50s · queen of the piston fighters',
    url: assetUrl('models/p51_mustang.glb?v=1'),
    reloadSec: 0.11,
    maxHp: 540,
    targetWidth: 11.3,
    vintageCrew: true,
    nation: 'usa',
    aircraft: true,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 16, side: 12, rear: 10, turret: 14 }),
    gun: {
      aphePen: 28,
      apheDmg: 58,
      hePen: 8,
      heDmg: 32,
      heBlast: 42,
      traverseRadPerSec: 2.5,
      elevateRadPerSec: 2.1,
      apLabel: 'AP .50',
      heLabel: 'API .50',
    },
  },
  {
    id: 'f16',
    name: 'F-16A Fighting Falcon',
    role: 'Jet fighter · air',
    blurb: 'Block 15 · VIPER · light multirole',
    url: assetUrl('models/f16a.glb?v=2'),
    reloadSec: 0.07,
    maxHp: 580,
    targetWidth: 9.96,
    vintageCrew: false,
    nation: 'usa',
    aircraft: true,
    jet: true,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 16, side: 12, rear: 10, turret: 14 }),
    gun: {
      aphePen: 34,
      apheDmg: 65,
      hePen: 12,
      heDmg: 40,
      heBlast: 50,
      traverseRadPerSec: 2.8,
      elevateRadPerSec: 2.4,
      apLabel: 'AP 20mm',
      heLabel: 'HEI 20mm',
    },
  },
  {
    id: 'yak9',
    name: 'Yak-9',
    role: 'Fighter · air',
    blurb: 'Soviet interceptor · 20mm ShVAK · light and mean',
    url: assetUrl('models/yak9.glb?v=6'),
    reloadSec: 0.14,
    maxHp: 480,
    targetWidth: 9.74,
    vintageCrew: true,
    nation: 'soviet',
    aircraft: true,
    aircraftNoseYaw: -Math.PI / 2,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 14, side: 10, rear: 8, turret: 12 }),
    gun: {
      aphePen: 38,
      apheDmg: 78,
      hePen: 12,
      heDmg: 42,
      heBlast: 55,
      traverseRadPerSec: 2.6,
      elevateRadPerSec: 2.2,
      apLabel: 'AP 20mm',
      heLabel: 'HE 20mm',
    },
  },
  {
    id: 'mig15',
    name: 'MiG-15',
    role: 'Jet fighter · air',
    blurb: 'Early Soviet jet · swept wing · NR-23 cannon',
    url: assetUrl('models/mig15.glb?v=1'),
    reloadSec: 0.09,
    maxHp: 560,
    targetWidth: 10.08,
    vintageCrew: false,
    nation: 'soviet',
    aircraft: true,
    jet: true,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 18, side: 14, rear: 12, turret: 16 }),
    gun: {
      aphePen: 42,
      apheDmg: 88,
      hePen: 14,
      heDmg: 48,
      heBlast: 58,
      traverseRadPerSec: 2.7,
      elevateRadPerSec: 2.3,
      apLabel: 'AP 23mm',
      heLabel: 'HE 23mm',
    },
  },
  {
    id: 'mig21',
    name: 'MiG-21MF',
    role: 'Jet fighter · air',
    blurb: 'Fishbed · delta wing · GSh-23 · Mach-capable interceptor',
    url: assetUrl('models/mig21.glb?v=1'),
    reloadSec: 0.08,
    maxHp: 600,
    targetWidth: 7.15,
    vintageCrew: false,
    nation: 'soviet',
    aircraft: true,
    jet: true,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 18, side: 14, rear: 12, turret: 16 }),
    gun: {
      aphePen: 44,
      apheDmg: 92,
      hePen: 14,
      heDmg: 50,
      heBlast: 60,
      traverseRadPerSec: 2.9,
      elevateRadPerSec: 2.5,
      apLabel: 'AP 23mm',
      heLabel: 'HE 23mm',
    },
  },
  {
    id: 'su25',
    name: 'Su-25',
    role: 'Attack jet · air',
    blurb: 'Grach · armored frogfoot · GSh-30-2 · close air support',
    url: assetUrl('models/su25.glb?v=2'),
    reloadSec: 0.08,
    maxHp: 780,
    targetWidth: 14.36,
    vintageCrew: false,
    nation: 'soviet',
    aircraft: true,
    jet: true,
    drive: CORSAIR_DRIVE,
    armor: armorKit({ front: 24, side: 18, rear: 16, turret: 20 }),
    gun: {
      aphePen: 52,
      apheDmg: 110,
      hePen: 18,
      heDmg: 60,
      heBlast: 75,
      traverseRadPerSec: 2.4,
      elevateRadPerSec: 2.1,
      apLabel: 'AP 30mm',
      heLabel: 'HE 30mm',
    },
  },
]

export function tankOptionById(id: TankId): TankOption {
  const found = TANK_OPTIONS.find((t) => t.id === id)
  if (!found) throw new Error(`Unknown tank id: ${id}`)
  return found
}
