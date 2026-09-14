import type { ArmorPartDef, ArmorPartId } from './armor'

/** Build a full plate table from thickness numbers (gameplay mm). */
export function armorKit(mm: {
  front: number
  side: number
  rear: number
  turret: number
  ring?: number
  gun?: number
  tracks?: number
  /** Modern composites ricochet less often at crazy angles — slightly lower auto-rico. */
  modern?: boolean
}): Record<ArmorPartId, ArmorPartDef> {
  const rico = mm.modern ? 62 : 58
  return {
    hullFront: {
      id: 'hullFront',
      label: 'Hull front',
      armor: mm.front,
      damageMult: 0.5,
      critChance: 0.02,
      autoRicochetDeg: rico,
    },
    hullSide: {
      id: 'hullSide',
      label: 'Hull side',
      armor: mm.side,
      damageMult: 1.25,
      critChance: 0.14,
      autoRicochetDeg: 72,
    },
    hullRear: {
      id: 'hullRear',
      label: 'Hull rear',
      armor: mm.rear,
      damageMult: 1.75,
      critChance: 0.72,
      autoRicochetDeg: 75,
    },
    turret: {
      id: 'turret',
      label: 'Turret',
      armor: mm.turret,
      damageMult: 1.15,
      critChance: 0.18,
      autoRicochetDeg: mm.modern ? 64 : 65,
    },
    turretRing: {
      id: 'turretRing',
      label: 'Turret ring',
      armor: mm.ring ?? Math.max(6, Math.round(mm.turret * 0.12)),
      damageMult: 2.2,
      critChance: 0.9,
      autoRicochetDeg: 78,
    },
    gun: {
      id: 'gun',
      label: 'Gun',
      armor: mm.gun ?? Math.max(18, Math.round(mm.front * 0.2)),
      damageMult: 0.55,
      critChance: 0.04,
      autoRicochetDeg: 75,
    },
    tracks: {
      id: 'tracks',
      label: 'Tracks',
      armor: mm.tracks ?? Math.max(10, Math.round(mm.side * 0.35)),
      damageMult: 0.35,
      critChance: 0,
      autoRicochetDeg: 78,
    },
  }
}

/** HUD / menu: nominal front plate. */
export function frontArmorMm(table: Record<ArmorPartId, ArmorPartDef>): number {
  return table.hullFront.armor
}
