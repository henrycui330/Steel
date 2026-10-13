import { assetUrl, fixPublicUrl } from './assetUrl'
import type { AmmoId } from './ammo'

function url(file: string): string {
  return fixPublicUrl(assetUrl(`sfx/german-crew/${file}`))
}

const LINES = {
  loadAp: () => url('load-ap.mp3'),
  loadHe: () => url('load-he.mp3'),
  loaded: () => url('loaded.mp3'),
  understood: () => url('understood-fire.mp3'),
  ready: () => url('ready.mp3'),
  hit: () => url('hit.mp3'),
} as const

export type GermanCrewVoice = {
  /** Prime under a user gesture (Deploy / unlockAudio). */
  start: () => void
  stop: () => void
  /** Call when main-gun reload of AP/HE begins. */
  announceLoad: (id: AmmoId) => void
  /** Call when the round is chambered / reload finishes. */
  announceLoaded: () => void
  /** Damaging hit on the player tank. */
  announceHit: () => void
  /** Fire gate — passes through instantly (callouts muted). */
  gateFire: (wantsFire: boolean, canFireNow: boolean) => boolean
}

/**
 * German tank crew — "we've been hit" only.
 * Load / fire telegraphs muted (unfair).
 */
export function createGermanCrewVoice(): GermanCrewVoice {
  let armed = false
  const hitBase = new Audio(LINES.hit())
  hitBase.preload = 'auto'

  return {
    start() {
      armed = true
      hitBase.volume = 0
      void hitBase
        .play()
        .then(() => {
          hitBase.pause()
          hitBase.currentTime = 0
          hitBase.volume = 0.88
        })
        .catch(() => {
          hitBase.volume = 0.88
        })
      console.info('[Steel] German crew voice armed (hit only)')
    },
    stop() {
      armed = false
    },
    announceLoad(_id) {
      /* muted */
    },
    announceLoaded() {
      /* muted */
    },
    announceHit() {
      if (!armed) return
      const shot = hitBase.cloneNode(true) as HTMLAudioElement
      shot.volume = 0.9
      void shot.play().catch((err) => {
        console.warn('[Steel] German crew hit SFX failed', err)
      })
    },
    gateFire(wantsFire, canFireNow) {
      return !!(wantsFire && canFireNow)
    },
  }
}

/** Clip URLs for unlockAudio warm-up. */
export function germanCrewSfxUrls(): string[] {
  return [
    LINES.loadAp(),
    LINES.loadHe(),
    LINES.loaded(),
    LINES.understood(),
    LINES.ready(),
    LINES.hit(),
  ]
}
