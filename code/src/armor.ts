import * as THREE from 'three'
import { SHELL_SPEED } from './ballistics'

export type ArmorPartId =
  | 'hullFront'
  | 'hullRear'
  | 'hullSide'
  | 'turret'
  | 'turretRing'
  | 'gun'
  | 'tracks'

export type ArmorPartDef = {
  id: ArmorPartId
  label: string
  /** Armor thickness (gameplay mm). */
  armor: number
  /** Damage multiplier after a penetration. */
  damageMult: number
  /** Chance of catastrophic kill on pen (ammo / fuel). */
  critChance: number
  /** Impact angle from normal (deg) above which shot always ricochets. */
  autoRicochetDeg: number
}

/**
 * Zone feel (Pz-III–ish):
 * front = bounce / stop / soft pens · sides = hard hits · rear = delete ·
 * turret = slightly soft · turret ring = tiny & catastrophic.
 */
export const PZ3_ARMOR: Record<ArmorPartId, ArmorPartDef> = {
  hullFront: {
    id: 'hullFront',
    label: 'Hull front',
    armor: 72,
    damageMult: 0.5,
    critChance: 0.02,
    autoRicochetDeg: 58,
  },
  hullSide: {
    id: 'hullSide',
    label: 'Hull side',
    armor: 28,
    damageMult: 1.25,
    critChance: 0.14,
    autoRicochetDeg: 72,
  },
  hullRear: {
    id: 'hullRear',
    label: 'Hull rear',
    armor: 12,
    damageMult: 1.75,
    critChance: 0.72,
    autoRicochetDeg: 75,
  },
  turret: {
    id: 'turret',
    label: 'Turret',
    armor: 38,
    damageMult: 1.2,
    critChance: 0.18,
    autoRicochetDeg: 65,
  },
  turretRing: {
    id: 'turretRing',
    label: 'Turret ring',
    armor: 6,
    damageMult: 2.2,
    critChance: 0.9,
    autoRicochetDeg: 78,
  },
  gun: {
    id: 'gun',
    label: 'Gun',
    armor: 22,
    damageMult: 0.55,
    critChance: 0.04,
    autoRicochetDeg: 75,
  },
  tracks: {
    id: 'tracks',
    label: 'Tracks',
    armor: 12,
    damageMult: 0.35,
    critChance: 0,
    autoRicochetDeg: 78,
  },
}

export type HitOutcomeKind = 'ricochet' | 'stopped' | 'penetrated' | 'blast'

export type HitResolution = {
  kind: HitOutcomeKind
  part: ArmorPartDef
  angleDeg: number
  effectiveArmor: number
  penetration: number
  damage: number
  crit: boolean
  normal: THREE.Vector3
}

export type ShellImpact = {
  speed: number
  basePenetration: number
  baseDamage: number
  /** HE blast applied when the round cannot pen. */
  blastDamage?: number
}

export function shellPenetrationAtSpeed(basePen: number, speed: number): number {
  const ratio = THREE.MathUtils.clamp(speed / SHELL_SPEED, 0.25, 1.15)
  return basePen * ratio
}

/**
 * Resolve armor vs shell at a known plate.
 * `normal` = unit outward plate normal; `incomingDir` = unit velocity direction.
 */
export function resolveArmorHit(
  part: ArmorPartDef,
  normal: THREE.Vector3,
  incomingDir: THREE.Vector3,
  shell: ShellImpact,
): HitResolution {
  const against = -incomingDir.dot(normal)
  const clamped = THREE.MathUtils.clamp(against, -1, 1)
  const angleDeg = THREE.MathUtils.radToDeg(Math.acos(Math.abs(clamped)))
  const pen = shellPenetrationAtSpeed(shell.basePenetration, shell.speed)
  const cos = Math.max(0.2, Math.abs(clamped))
  const effectiveArmor = part.armor / cos
  const normalOut = normal.clone().normalize()
  const blast = shell.blastDamage ?? 0

  if (angleDeg >= part.autoRicochetDeg || against <= 0.08) {
    return {
      kind: 'ricochet',
      part,
      angleDeg,
      effectiveArmor,
      penetration: pen,
      damage: 0,
      crit: false,
      normal: normalOut,
    }
  }

  if (pen < effectiveArmor) {
    if (blast > 0) {
      return {
        kind: 'blast',
        part,
        angleDeg,
        effectiveArmor,
        penetration: pen,
        damage: Math.round(blast * (0.55 + 0.45 * part.damageMult)),
        crit: false,
        normal: normalOut,
      }
    }
    if (angleDeg > part.autoRicochetDeg - 8 && pen < effectiveArmor * 0.85) {
      return {
        kind: 'ricochet',
        part,
        angleDeg,
        effectiveArmor,
        penetration: pen,
        damage: 0,
        crit: false,
        normal: normalOut,
      }
    }
    return {
      kind: 'stopped',
      part,
      angleDeg,
      effectiveArmor,
      penetration: pen,
      damage: 0,
      crit: false,
      normal: normalOut,
    }
  }

  const overmatch = pen / effectiveArmor
  // Front / hard plates: barely-overmatch pens stay soft; soft plates scale up harder.
  const overClamp =
    part.id === 'hullFront'
      ? THREE.MathUtils.clamp(overmatch, 0.55, 1.05)
      : THREE.MathUtils.clamp(overmatch, 0.85, 1.55)
  const damage = Math.round(shell.baseDamage * part.damageMult * overClamp)
  const crit = Math.random() < part.critChance * THREE.MathUtils.clamp(overmatch, 0.8, 1.5)

  return {
    kind: 'penetrated',
    part,
    angleDeg,
    effectiveArmor,
    penetration: pen,
    damage,
    crit,
    normal: normalOut,
  }
}
