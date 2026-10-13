import { assetUrl, fixPublicUrl } from './assetUrl'
import type { AmmoId } from './ammo'

function url(file: string): string {
  return fixPublicUrl(assetUrl(`sfx/soviet-crew/${file}`))
}

const LINES = {
  loadAp: () => url('load-ap.mp3'),
  loadHe: () => url('load-he.mp3'),
  loaded: () => url('loaded.mp3'),
  understood: () => url('understood-fire.mp3'),
  ready: () => url('ready.mp3'),
  hitThem: () => url('hit-them.mp3'),
} as const

export type SovietCrewVoice = {
  start: () => void
  stop: () => void
  announceLoad: (id: AmmoId) => void
  announceLoaded: () => void
  /** Successful pen/blast on an enemy — muted. */
  announceHitThem: () => void
  /** Fire gate — passes through instantly (callouts muted). */
  gateFire: (wantsFire: boolean, canFireNow: boolean) => boolean
}

/**
 * Soviet tank crew — fire/load/HIT THEM muted (unfair telegraph).
 */
export function createSovietCrewVoice(): SovietCrewVoice {
  return {
    start() {
      console.info('[Steel] Soviet crew voice armed (muted fire/load)')
    },
    stop() {},
    announceLoad(_id) {
      /* muted */
    },
    announceLoaded() {
      /* muted */
    },
    announceHitThem() {
      /* muted */
    },
    gateFire(wantsFire, canFireNow) {
      return !!(wantsFire && canFireNow)
    },
  }
}

export function sovietCrewSfxUrls(): string[] {
  return [
    LINES.loadAp(),
    LINES.loadHe(),
    LINES.loaded(),
    LINES.understood(),
    LINES.ready(),
    LINES.hitThem(),
  ]
}
