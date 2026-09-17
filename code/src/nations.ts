import { assetUrl, fixPublicUrl } from './assetUrl'

export type TeamId = 'red' | 'blue'

export type NationId = 'vostok' | 'meridian'

export type NationDef = {
  id: NationId
  team: TeamId
  name: string
  short: string
  flagUrl: string
  /** Primary UI / minimap color. */
  color: string
  accent: string
}

export const NATIONS: readonly NationDef[] = [
  {
    id: 'vostok',
    team: 'red',
    name: 'Vostok Republic',
    short: 'Vostok',
    flagUrl: assetUrl('nations/vostok.png'),
    color: '#e23d3d',
    accent: '#f5c400',
  },
  {
    id: 'meridian',
    team: 'blue',
    name: 'United Meridian Democracy',
    short: 'Meridian',
    flagUrl: assetUrl('nations/meridian.png'),
    color: '#1aa3c4',
    accent: '#f5c400',
  },
]

export function nationByTeam(team: TeamId): NationDef {
  return team === 'red' ? NATIONS[0]! : NATIONS[1]!
}

export function nationById(id: NationId): NationDef {
  const found = NATIONS.find((n) => n.id === id)
  if (!found) throw new Error(`[Steel] Unknown nation ${id}`)
  return found
}

/** Flag URL safe for GitHub Pages (`/Steel/…`). */
export function nationFlagSrc(n: NationDef): string {
  return fixPublicUrl(n.flagUrl)
}
