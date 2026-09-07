/** Player ammunition / auxiliary weapon rounds. */

export type AmmoId = 'he' | 'aphe' | 'mg'

/** Primary cannon vs coaxial machine gun. */
export type WeaponId = 'main' | 'mg'

export type AmmoDef = {
  id: AmmoId
  /** Short HUD name. */
  name: string
  /** One-line role. */
  role: string
  /** Key binding hint. */
  key: string
  /** Penetration at full muzzle speed (mm). */
  penetration: number
  /** Damage on armor penetration. */
  penDamage: number
  /** External blast when it fails to pen (HE). */
  blastDamage: number
  /** Shell mesh / spark tint. */
  color: number
  emissive: number
}

export const AMMO_TYPES: Record<AmmoId, AmmoDef> = {
  he: {
    id: 'he',
    name: 'HE',
    role: 'Infantry / soft — negligible pen, blast on contact',
    key: '↑',
    penetration: 4,
    penDamage: 40,
    blastDamage: 140,
    color: 0xd4a574,
    emissive: 0x5a3010,
  },
  aphe: {
    id: 'aphe',
    name: 'APHE',
    role: 'Armor — high pen, fuse after armor',
    key: '↓',
    penetration: 58,
    penDamage: 280,
    blastDamage: 0,
    color: 0xe8c84a,
    emissive: 0x6a5010,
  },
  mg: {
    id: 'mg',
    name: 'MG',
    role: 'Coax MG — soft / optics / suppression',
    key: '2',
    penetration: 9,
    penDamage: 22,
    blastDamage: 0,
    color: 0xffe090,
    emissive: 0xaa7000,
  },
}

/** Main-gun ammo only (HUD ↑/↓). */
export const AMMO_ORDER: AmmoId[] = ['he', 'aphe']

export function ammoById(id: AmmoId): AmmoDef {
  return AMMO_TYPES[id]
}
