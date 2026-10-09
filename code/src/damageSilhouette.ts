import type { TankId } from './tankCatalog'

/**
 * Top-down WT-style damage schematic (nose = −Y in local SVG space).
 * Each tank family gets a distinct hull / module layout.
 */
export type DamageSilhouette = {
  armor: string
  trackL: { x: number; y: number; w: number; h: number; rx?: number }
  trackR: { x: number; y: number; w: number; h: number; rx?: number }
  fuel: Array<{ cx: number; cy: number; rx: number; ry: number }>
  ammo: Array<{ x: number; y: number; w: number; h: number }>
  turret: { cx: number; cy: number; r: number }
  /** Barrel length from turret centre toward −Y. */
  gunLen: number
  gunHalfW: number
  crew: number
  /** Optional label under STAB (e.g. SPAAG). */
  tag?: string
}

const MBT: DamageSilhouette = {
  armor: 'M-13,-30 L13,-30 L17,-10 L17,26 L-17,26 L-17,-10 Z',
  trackL: { x: -24, y: -30, w: 7, h: 60, rx: 2 },
  trackR: { x: 17, y: -30, w: 7, h: 60, rx: 2 },
  fuel: [
    { cx: -10, cy: 14, rx: 5.5, ry: 9 },
    { cx: 10, cy: 14, rx: 5.5, ry: 9 },
  ],
  ammo: [{ x: 5, y: -20, w: 9, h: 14 }],
  turret: { cx: 0, cy: -2, r: 10 },
  gunLen: 40,
  gunHalfW: 2.1,
  crew: 4,
}

const MBT_BUSTLE: DamageSilhouette = {
  ...MBT,
  armor: 'M-12,-28 L12,-28 L16,-8 L16,22 L10,28 L-10,28 L-16,22 L-16,-8 Z',
  ammo: [{ x: -6, y: 16, w: 12, h: 10 }],
  fuel: [
    { cx: -11, cy: 6, rx: 5, ry: 8 },
    { cx: 11, cy: 6, rx: 5, ry: 8 },
  ],
  turret: { cx: 0, cy: -6, r: 9.5 },
  gunLen: 42,
  crew: 3,
}

const WW2_MED: DamageSilhouette = {
  armor: 'M-12,-24 L12,-24 L14,-6 L14,22 L-14,22 L-14,-6 Z',
  trackL: { x: -21, y: -26, w: 6, h: 52, rx: 1.5 },
  trackR: { x: 15, y: -26, w: 6, h: 52, rx: 1.5 },
  fuel: [
    { cx: -8, cy: 12, rx: 4.5, ry: 7 },
    { cx: 8, cy: 12, rx: 4.5, ry: 7 },
  ],
  ammo: [
    { x: -12, y: -8, w: 6, h: 10 },
    { x: 6, y: -8, w: 6, h: 10 },
  ],
  turret: { cx: 0, cy: -2, r: 8.5 },
  gunLen: 34,
  gunHalfW: 1.9,
  crew: 5,
}

const WW2_HEAVY: DamageSilhouette = {
  armor: 'M-15,-26 L15,-26 L18,-4 L18,24 L-18,24 L-18,-4 Z',
  trackL: { x: -25, y: -28, w: 7.5, h: 56, rx: 2 },
  trackR: { x: 17.5, y: -28, w: 7.5, h: 56, rx: 2 },
  fuel: [
    { cx: -11, cy: 13, rx: 5, ry: 8 },
    { cx: 11, cy: 13, rx: 5, ry: 8 },
  ],
  ammo: [{ x: 4, y: -14, w: 10, h: 12 }],
  turret: { cx: 0, cy: -1, r: 11 },
  gunLen: 38,
  gunHalfW: 2.3,
  crew: 5,
}

const LIGHT: DamageSilhouette = {
  armor: 'M-10,-22 L10,-22 L12,-4 L12,18 L-12,18 L-12,-4 Z',
  trackL: { x: -18, y: -22, w: 5, h: 44, rx: 1.5 },
  trackR: { x: 13, y: -22, w: 5, h: 44, rx: 1.5 },
  fuel: [{ cx: 0, cy: 10, rx: 6, ry: 6 }],
  ammo: [{ x: -4, y: -12, w: 8, h: 8 }],
  turret: { cx: 0, cy: -4, r: 7 },
  gunLen: 28,
  gunHalfW: 1.6,
  crew: 4,
}

const IFV: DamageSilhouette = {
  armor: 'M-11,-32 L11,-32 L14,-12 L14,28 L-14,28 L-14,-12 Z',
  trackL: { x: -20, y: -32, w: 5.5, h: 64, rx: 1.5 },
  trackR: { x: 14.5, y: -32, w: 5.5, h: 64, rx: 1.5 },
  fuel: [
    { cx: -8, cy: 16, rx: 4, ry: 7 },
    { cx: 8, cy: 16, rx: 4, ry: 7 },
  ],
  ammo: [{ x: 3, y: -18, w: 8, h: 10 }],
  turret: { cx: 0, cy: -8, r: 7.5 },
  gunLen: 30,
  gunHalfW: 1.5,
  crew: 3,
}

const WHEELED: DamageSilhouette = {
  armor: 'M-10,-30 L10,-30 L13,-8 L13,26 L-13,26 L-13,-8 Z',
  trackL: { x: -18, y: -28, w: 5, h: 56, rx: 2.5 },
  trackR: { x: 13, y: -28, w: 5, h: 56, rx: 2.5 },
  fuel: [{ cx: 0, cy: 14, rx: 7, ry: 6 }],
  ammo: [{ x: -4, y: -14, w: 8, h: 9 }],
  turret: { cx: 0, cy: -6, r: 6.5 },
  gunLen: 26,
  gunHalfW: 1.4,
  crew: 3,
  tag: 'WHEELED',
}

const SPAAG: DamageSilhouette = {
  armor: 'M-13,-22 L13,-22 L15,0 L15,20 L-15,20 L-15,0 Z',
  trackL: { x: -22, y: -24, w: 6, h: 48, rx: 1.5 },
  trackR: { x: 16, y: -24, w: 6, h: 48, rx: 1.5 },
  fuel: [
    { cx: -9, cy: 10, rx: 4.5, ry: 6 },
    { cx: 9, cy: 10, rx: 4.5, ry: 6 },
  ],
  ammo: [
    { x: -11, y: -10, w: 7, h: 9 },
    { x: 4, y: -10, w: 7, h: 9 },
  ],
  turret: { cx: 0, cy: -2, r: 9 },
  gunLen: 32,
  gunHalfW: 1.3,
  crew: 4,
  tag: 'AA',
}

const SPG: DamageSilhouette = {
  armor: 'M-14,-20 L8,-26 L16,-8 L16,24 L-16,24 L-16,-4 Z',
  trackL: { x: -23, y: -24, w: 6.5, h: 52, rx: 1.5 },
  trackR: { x: 16.5, y: -24, w: 6.5, h: 52, rx: 1.5 },
  fuel: [
    { cx: -10, cy: 12, rx: 5, ry: 7 },
    { cx: 10, cy: 12, rx: 5, ry: 7 },
  ],
  ammo: [{ x: -2, y: -8, w: 12, h: 14 }],
  turret: { cx: -2, cy: 2, r: 8 },
  gunLen: 44,
  gunHalfW: 2.4,
  crew: 5,
  tag: 'SPG',
}

/** Casemate TD — no rotating turret disc; gun from fixed superstructure. */
const CASEMATE: DamageSilhouette = {
  armor: 'M-11,-26 L11,-26 L14,-4 L13,22 L-13,22 L-14,-4 Z',
  trackL: { x: -20, y: -26, w: 5.5, h: 50, rx: 1.5 },
  trackR: { x: 14.5, y: -26, w: 5.5, h: 50, rx: 1.5 },
  fuel: [
    { cx: -8, cy: 12, rx: 4.5, ry: 6 },
    { cx: 8, cy: 12, rx: 4.5, ry: 6 },
  ],
  ammo: [{ x: -5, y: -10, w: 10, h: 12 }],
  turret: { cx: 0, cy: 2, r: 5.5 },
  gunLen: 36,
  gunHalfW: 1.8,
  crew: 4,
  tag: 'TD',
}

const MLRS: DamageSilhouette = {
  armor: 'M-12,-26 L12,-26 L14,-6 L14,24 L-14,24 L-14,-6 Z',
  trackL: { x: -20, y: -26, w: 5.5, h: 52, rx: 1.5 },
  trackR: { x: 14.5, y: -26, w: 5.5, h: 52, rx: 1.5 },
  fuel: [{ cx: 0, cy: 14, rx: 7, ry: 6 }],
  ammo: [{ x: -10, y: -18, w: 20, h: 16 }],
  turret: { cx: 0, cy: -8, r: 5 },
  gunLen: 22,
  gunHalfW: 3.5,
  crew: 3,
  tag: 'MLRS',
}

const ATGM: DamageSilhouette = {
  armor: 'M-11,-24 L11,-24 L13,-4 L13,22 L-13,22 L-13,-4 Z',
  trackL: { x: -19, y: -24, w: 5.5, h: 48, rx: 1.5 },
  trackR: { x: 13.5, y: -24, w: 5.5, h: 48, rx: 1.5 },
  fuel: [{ cx: 0, cy: 12, rx: 6, ry: 6 }],
  ammo: [{ x: -8, y: -14, w: 16, h: 12 }],
  turret: { cx: 0, cy: -6, r: 7 },
  gunLen: 20,
  gunHalfW: 2.8,
  crew: 3,
  tag: 'ATGM',
}

const BY_ID: Partial<Record<TankId, DamageSilhouette>> = {
  abrams: MBT_BUSTLE,
  leopard2: MBT_BUSTLE,
  challenger2: MBT_BUSTLE,
  chieftain: MBT_BUSTLE,
  challenger3: MBT_BUSTLE,
  t72: MBT,
  t90: MBT,
  t64: MBT,
  leopard: MBT,
  t55: MBT,
  pershing: MBT,
  conqueror: WW2_HEAVY,
  tiger: WW2_HEAVY,
  churchill: WW2_HEAVY,
  pz3: WW2_MED,
  hetzer: CASEMATE,
  pz4: WW2_MED,
  sherman: WW2_MED,
  t34: WW2_MED,
  t3476: WW2_MED,
  t44: WW2_MED,
  cromwell: WW2_MED,
  chaffee: LIGHT,
  sheridan: { ...LIGHT, gunLen: 22, tag: 'ATGM', ammo: [{ x: -5, y: -10, w: 10, h: 10 }] },
  bradley: IFV,
  m3a3: IFV,
  desertWarrior: IFV,
  btr82a: WHEELED,
  lav25: WHEELED,
  duster: SPAAG,
  shilka: SPAAG,
  pantsir: { ...SPAAG, gunLen: 28, tag: 'SAM' },
  m55: SPG,
  pzh2000: SPG,
  katyusha: MLRS,
  m901: ATGM,
  khrizantema: ATGM,
}

/** Fallback classic medium outline. */
const DEFAULT_SIL = WW2_MED

export function silhouetteForTank(id: TankId | undefined | null): DamageSilhouette {
  if (!id) return DEFAULT_SIL
  return BY_ID[id] ?? DEFAULT_SIL
}

/** Rebuild hull-group children for a silhouette. Keeps `.dmg-hull` transform. */
export function applyDamageSilhouette(hullGroup: SVGGElement, sil: DamageSilhouette): void {
  const NS = 'http://www.w3.org/2000/svg'
  while (hullGroup.firstChild) hullGroup.removeChild(hullGroup.firstChild)

  function el<K extends keyof SVGElementTagNameMap>(
    name: K,
    attrs: Record<string, string | number>,
    cls: string,
  ): SVGElementTagNameMap[K] {
    const node = document.createElementNS(NS, name)
    node.setAttribute('class', cls)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
    return node
  }

  hullGroup.appendChild(
    el(
      'rect',
      {
        x: sil.trackL.x,
        y: sil.trackL.y,
        width: sil.trackL.w,
        height: sil.trackL.h,
        rx: sil.trackL.rx ?? 1.5,
      },
      'dmg-part dmg-track-l',
    ),
  )
  hullGroup.appendChild(
    el(
      'rect',
      {
        x: sil.trackR.x,
        y: sil.trackR.y,
        width: sil.trackR.w,
        height: sil.trackR.h,
        rx: sil.trackR.rx ?? 1.5,
      },
      'dmg-part dmg-track-r',
    ),
  )
  const armor = el('path', { d: sil.armor }, 'dmg-part dmg-armor')
  armor.setAttribute('data-part', 'armor')
  hullGroup.appendChild(armor)

  for (const f of sil.fuel) {
    const n = el(
      'ellipse',
      { cx: f.cx, cy: f.cy, rx: f.rx, ry: f.ry },
      'dmg-part dmg-fuel',
    )
    n.setAttribute('data-part', 'fuel')
    hullGroup.appendChild(n)
  }
  for (const a of sil.ammo) {
    const n = el(
      'rect',
      { x: a.x, y: a.y, width: a.w, height: a.h, rx: 1 },
      'dmg-part dmg-ammo',
    )
    n.setAttribute('data-part', 'ammo')
    hullGroup.appendChild(n)
  }

  const spin = document.createElementNS(NS, 'g')
  spin.setAttribute('class', 'dmg-turret-spin')
  const tur = el(
    'circle',
    { cx: sil.turret.cx, cy: sil.turret.cy, r: sil.turret.r },
    'dmg-part dmg-turret',
  )
  tur.setAttribute('data-part', 'turret')
  spin.appendChild(tur)
  const y0 = sil.turret.cy
  const y1 = sil.turret.cy - sil.gunLen
  const hw = sil.gunHalfW
  spin.appendChild(
    el(
      'path',
      {
        d: `M${-hw},${y0} L${hw},${y0} L${hw * 0.65},${y1} L${-hw * 0.65},${y1} Z`,
      },
      'dmg-gun',
    ),
  )
  spin.appendChild(
    el(
      'line',
      { x1: 0, y1: y0, x2: 0, y2: y1 - 8 },
      'dmg-gun-line',
    ),
  )
  hullGroup.appendChild(spin)

  // data-part on tracks for paintPart
  const tl = hullGroup.querySelector('.dmg-track-l')
  const tr = hullGroup.querySelector('.dmg-track-r')
  tl?.setAttribute('data-part', 'trackL')
  tr?.setAttribute('data-part', 'trackR')
}
