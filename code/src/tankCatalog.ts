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
  | 'abrams'
  | 't34'
  | 't44'
  | 't55'
  | 't72'
  | 't90'

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

export type GunProfile = {
  /** Multipliers on base ammo defs. */
  aphePenMult: number
  apheDmgMult: number
  hePenMult: number
  heBlastMult: number
  /** Turret traverse / gun elevate (rad/s). */
  traverseRadPerSec: number
  elevateRadPerSec: number
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
   * Self-propelled gun — deploy/map/lock artillery loop (PzH 2000).
   */
  artillery?: boolean
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

/** Selectable player tanks (files in public/models/). */
export const TANK_OPTIONS: TankOption[] = [
  {
    id: 'tiger',
    name: 'Pz-V Panther A',
    role: 'Heavy medium',
    blurb: 'Fast for its weight · long 75mm · frontal slope · open-ground hunter',
    url: '/models/tiger.glb?v=4',
    reloadSec: 6.5,
    maxHp: 1200,
    targetWidth: 3.05,
    vintageCrew: true,
    drive: TIGER_DRIVE,
    gun: {
      aphePenMult: 1.22,
      apheDmgMult: 1.25,
      hePenMult: 1,
      heBlastMult: 1.1,
      traverseRadPerSec: 4.6,
      elevateRadPerSec: 3.4,
    },
  },
  {
    id: 'pz3',
    name: 'Pz-III L',
    role: 'Flanking blitz',
    blurb: 'Fast · agile · quick reload · made for flank and encircle',
    url: '/models/pz3.glb?v=4',
    reloadSec: 4,
    maxHp: 780,
    targetWidth: 2.7,
    vintageCrew: true,
    drive: PZ3_DRIVE,
    gun: {
      aphePenMult: 0.72,
      apheDmgMult: 0.7,
      hePenMult: 1,
      heBlastMult: 0.95,
      traverseRadPerSec: 8.5,
      elevateRadPerSec: 5.5,
    },
  },
  {
    id: 'pz4',
    name: 'Pz-IV',
    role: 'Medium workhorse',
    blurb: 'Balanced · long 75mm · the German jack-of-all-trades',
    url: '/models/pz4.glb?v=30',
    reloadSec: 5.5,
    maxHp: 1050,
    targetWidth: 2.7,
    vintageCrew: true,
    drive: PZ4_DRIVE,
    gun: {
      aphePenMult: 1.0,
      apheDmgMult: 1.05,
      hePenMult: 1,
      heBlastMult: 1.05,
      traverseRadPerSec: 6.2,
      elevateRadPerSec: 4.2,
    },
  },
  {
    id: 'leopard',
    name: 'Leopard 1',
    role: 'Cold-war MBT',
    blurb: 'Fast · sharp 105mm · thin skin · shoot and scoot',
    url: '/models/leopard.glb?v=3',
    reloadSec: 5,
    maxHp: 980,
    targetWidth: 2.95,
    vintageCrew: false,
    drive: LEOPARD_DRIVE,
    gun: {
      aphePenMult: 1.35,
      apheDmgMult: 1.3,
      hePenMult: 1.05,
      heBlastMult: 1.15,
      traverseRadPerSec: 7.2,
      elevateRadPerSec: 4.8,
    },
  },
  {
    id: 'leopard2',
    name: 'Leopard 2A6',
    role: 'Modern MBT',
    blurb: 'L55 120mm · composite armor · NATO spearhead',
    url: '/models/leopard2.glb?v=13',
    reloadSec: 5.5,
    maxHp: 1450,
    targetWidth: 3.35,
    vintageCrew: false,
    drive: LEOPARD2_DRIVE,
    gun: {
      aphePenMult: 1.55,
      apheDmgMult: 1.45,
      hePenMult: 1.1,
      heBlastMult: 1.25,
      traverseRadPerSec: 6.5,
      elevateRadPerSec: 4.5,
    },
  },
  {
    id: 'pzh2000',
    name: 'PzH 2000',
    role: 'SPG · 155mm howitzer',
    blurb: 'Stop · map-aim · lock · fire for effect',
    url: '/models/pzh2000.glb?v=8',
    reloadSec: 8.0,
    maxHp: 1150,
    targetWidth: 3.5,
    vintageCrew: false,
    artillery: true,
    drive: PZH_DRIVE,
    gun: {
      aphePenMult: 0.85,
      apheDmgMult: 1.1,
      hePenMult: 1.4,
      heBlastMult: 1.9,
      traverseRadPerSec: 4.5,
      elevateRadPerSec: 3.8,
    },
  },
  {
    id: 'chaffee',
    name: 'M24 Chaffee',
    role: 'Light infantry support',
    blurb: 'Quick · light · 75mm · built to aid infantry in fast fights',
    url: '/models/m24_chaffee.glb?v=1',
    reloadSec: 4.2,
    maxHp: 720,
    targetWidth: 2.85,
    vintageCrew: true,
    rigidRig: false,
    drive: CHAFFEE_DRIVE,
    gun: {
      aphePenMult: 0.88,
      apheDmgMult: 0.9,
      hePenMult: 1.08,
      heBlastMult: 1.12,
      traverseRadPerSec: 7.8,
      elevateRadPerSec: 5.2,
    },
  },
  {
    id: 'sherman',
    name: 'M4 Sherman Firefly',
    role: 'Medium · 17-pdr',
    blurb: 'Allied medium · long 17-pounder · hard AP punch',
    url: '/models/m4_sherman_firefly.glb?v=1',
    reloadSec: 6.2,
    maxHp: 980,
    targetWidth: 2.95,
    vintageCrew: true,
    rigidRig: false,
    drive: SHERMAN_DRIVE,
    gun: {
      aphePenMult: 1.28,
      apheDmgMult: 1.2,
      hePenMult: 1.02,
      heBlastMult: 1.05,
      traverseRadPerSec: 5.8,
      elevateRadPerSec: 4.0,
    },
  },
  {
    id: 'pershing',
    name: 'M26 Pershing',
    role: 'Heavy medium · 90mm',
    blurb: 'Late-war US · thick face · 90mm M3',
    url: '/models/m26_pershing.glb?v=2',
    reloadSec: 6.0,
    maxHp: 1280,
    targetWidth: 3.15,
    vintageCrew: true,
    rigidRig: false,
    drive: PERSHING_DRIVE,
    gun: {
      aphePenMult: 1.32,
      apheDmgMult: 1.28,
      hePenMult: 1.05,
      heBlastMult: 1.1,
      traverseRadPerSec: 5.2,
      elevateRadPerSec: 3.8,
    },
  },
  {
    id: 'abrams',
    name: 'M1A1 Abrams',
    role: 'Modern MBT · 120mm',
    blurb: 'US heavyweight · composite armor · L44 120mm',
    url: '/models/m1a1_abrams.glb?v=2',
    reloadSec: 5.0,
    maxHp: 1500,
    targetWidth: 3.65,
    vintageCrew: false,
    rigidRig: false,
    drive: ABRAMS_DRIVE,
    gun: {
      aphePenMult: 1.58,
      apheDmgMult: 1.48,
      hePenMult: 1.12,
      heBlastMult: 1.28,
      traverseRadPerSec: 6.8,
      elevateRadPerSec: 4.6,
    },
  },
  {
    id: 't34',
    name: 'T-34',
    role: 'Soviet medium · 76mm',
    blurb: 'Sloped armor · wide tracks · the Red Army workhorse',
    url: '/models/t34.glb?v=2',
    reloadSec: 5.2,
    maxHp: 980,
    targetWidth: 3.0,
    vintageCrew: true,
    rigidRig: false,
    drive: T34_DRIVE,
    gun: {
      aphePenMult: 0.95,
      apheDmgMult: 1.0,
      hePenMult: 1.05,
      heBlastMult: 1.1,
      traverseRadPerSec: 5.5,
      elevateRadPerSec: 4.0,
    },
  },
  {
    id: 't44',
    name: 'T-44-100',
    role: 'Soviet medium · 100mm',
    blurb: 'Low silhouette · hard 100mm · bridge from T-34 to T-54',
    url: '/models/t44_100.glb?v=2',
    reloadSec: 5.8,
    maxHp: 1120,
    targetWidth: 3.1,
    vintageCrew: true,
    rigidRig: false,
    drive: T44_DRIVE,
    gun: {
      aphePenMult: 1.25,
      apheDmgMult: 1.22,
      hePenMult: 1.05,
      heBlastMult: 1.12,
      traverseRadPerSec: 5.4,
      elevateRadPerSec: 3.9,
    },
  },
  {
    id: 't55',
    name: 'T-55',
    role: 'Cold-war MBT · 100mm',
    blurb: 'Ubiquitous · thick face · D-10T 100mm',
    url: '/models/t55.glb?v=2',
    reloadSec: 5.5,
    maxHp: 1250,
    targetWidth: 3.3,
    vintageCrew: false,
    rigidRig: false,
    drive: T55_DRIVE,
    gun: {
      aphePenMult: 1.35,
      apheDmgMult: 1.28,
      hePenMult: 1.08,
      heBlastMult: 1.15,
      traverseRadPerSec: 5.8,
      elevateRadPerSec: 4.2,
    },
  },
  {
    id: 't72',
    name: 'T-72 Ural',
    role: 'Cold-war MBT · 125mm',
    blurb: 'Autoloader · low profile · 2A46 125mm',
    url: '/models/t72.glb?v=1',
    reloadSec: 6.5,
    maxHp: 1380,
    targetWidth: 3.55,
    vintageCrew: false,
    rigidRig: false,
    drive: T72_DRIVE,
    gun: {
      aphePenMult: 1.5,
      apheDmgMult: 1.4,
      hePenMult: 1.1,
      heBlastMult: 1.22,
      traverseRadPerSec: 6.2,
      elevateRadPerSec: 4.4,
    },
  },
  {
    id: 't90',
    name: 'T-90',
    role: 'Modern MBT · 125mm',
    blurb: 'Shtora · Kontakt · 2A46M 125mm — final boss',
    url: '/models/t90.glb?v=9',
    reloadSec: 6.2,
    maxHp: 1550,
    targetWidth: 3.7,
    vintageCrew: false,
    rigidRig: false,
    drive: T90_DRIVE,
    gun: {
      aphePenMult: 1.6,
      apheDmgMult: 1.48,
      hePenMult: 1.12,
      heBlastMult: 1.28,
      traverseRadPerSec: 6.6,
      elevateRadPerSec: 4.6,
    },
  },
]

export function tankOptionById(id: TankId): TankOption {
  const found = TANK_OPTIONS.find((t) => t.id === id)
  if (!found) throw new Error(`Unknown tank id: ${id}`)
  return found
}
