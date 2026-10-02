/** Player ammunition / auxiliary weapon rounds. */

export type AmmoId = 'he' | 'aphe' | 'mg'

/** Primary cannon vs coaxial machine gun vs ATGM / SAM. */
export type WeaponId = 'main' | 'mg' | 'atgm'

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

/** Remaining rounds the player can still fire. */
export type AmmoStock = Record<AmmoId, number>

/** Default rack for a typical MBT / medium tank. */
export const DEFAULT_AMMO_STOCK: AmmoStock = {
  he: 20,
  aphe: 24,
  mg: 350,
}

/** High ROF SPAAG / autocannon — more ammo, still finite. */
export const AA_AMMO_STOCK: AmmoStock = {
  he: 160,
  aphe: 100,
  mg: 600,
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

export function cloneAmmoStock(src: AmmoStock): AmmoStock {
  return { he: src.he, aphe: src.aphe, mg: src.mg }
}

/** Pick starting racks from tank role (rockets use magazine mode — stock unused). */
export function defaultAmmoRacks(opts: {
  reloadSec: number
  magazineSize?: number
  antiAir?: boolean
  /** ATGM carriers — coax belt only, no AP/HE. */
  noMainGun?: boolean
}): AmmoStock {
  if (opts.magazineSize && opts.magazineSize > 0) {
    return { he: 0, aphe: 0, mg: 0 }
  }
  if (opts.noMainGun) {
    return { he: 0, aphe: 0, mg: 600 }
  }
  if (opts.antiAir || opts.reloadSec < 1.2) {
    return cloneAmmoStock(AA_AMMO_STOCK)
  }
  return cloneAmmoStock(DEFAULT_AMMO_STOCK)
}
