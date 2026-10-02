/**
 * Per-part HP for ground tanks (arcade WT-style modules).
 * `hp` / `maxHp` on Combatant stay equal to **hull** for HUD / death-cam compat.
 */

export type ModuleId = 'hull' | 'turret' | 'trackL' | 'trackR' | 'fuel'

export type ModuleState = {
  id: ModuleId
  label: string
  hp: number
  maxHp: number
}

export type ModuleKit = Record<ModuleId, ModuleState>

/** Fractions of chassis maxHp → each module pool. */
const FRACTIONS: Record<ModuleId, number> = {
  hull: 1.0,
  turret: 0.55,
  trackL: 0.28,
  trackR: 0.28,
  fuel: 0.35,
}

const LABELS: Record<ModuleId, string> = {
  hull: 'Hull',
  turret: 'Turret',
  trackL: 'Track L',
  trackR: 'Track R',
  fuel: 'Fuel',
}

export function createModuleKit(chassisMaxHp: number): ModuleKit {
  const kit = {} as ModuleKit
  for (const id of Object.keys(FRACTIONS) as ModuleId[]) {
    const maxHp = Math.max(1, Math.round(chassisMaxHp * FRACTIONS[id]!))
    kit[id] = { id, label: LABELS[id]!, hp: maxHp, maxHp }
  }
  return kit
}

export function resetModuleKit(kit: ModuleKit): void {
  for (const id of Object.keys(kit) as ModuleId[]) {
    kit[id]!.hp = kit[id]!.maxHp
  }
}

/** Map armor plate id → which module takes the HP. */
export function moduleForArmorPart(partId: string): ModuleId {
  switch (partId) {
    case 'turret':
    case 'turretRing':
    case 'gun':
      return 'turret'
    case 'tracksL':
    case 'trackL':
      return 'trackL'
    case 'tracksR':
    case 'trackR':
      return 'trackR'
    case 'fuel':
      return 'fuel'
    case 'hullFront':
    case 'hullRear':
    case 'hullSide':
    case 'tracks': // legacy combined tracks → hull mobility via both? treat as hull soft
    default:
      return 'hull'
  }
}
