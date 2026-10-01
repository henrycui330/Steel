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
  /**
   * Gate main-gun fire input.
   * Plays UNDERSTOOD → READY, then pulses true for one frame so the gun fires.
   */
  gateFire: (wantsFire: boolean, canFireNow: boolean) => boolean
}

/**
 * German tank crew callouts.
 * Sequence: Load AP/HE → Loaded! → (fire press) Understood, fire! → Ready! → bang.
 */
export function createGermanCrewVoice(): GermanCrewVoice {
  let armed = false
  /** Shared channel for load / fire callouts (one at a time). */
  let line: HTMLAudioElement | null = null
  let lineGen = 0
  /** Fire-arming FSM. */
  type Phase = 'idle' | 'understood' | 'ready'
  let phase: Phase = 'idle'
  /** Fire system should receive wantsFire this frame. */
  let firePulse = false
  /** True while Load / Loaded callout is playing — don't cut into fire arm. */
  let loadBusy = false
  const hitBase = new Audio(LINES.hit())
  hitBase.preload = 'auto'

  function stopLine(): void {
    lineGen++
    if (line) {
      line.onended = null
      line.pause()
      line.currentTime = 0
      line = null
    }
  }

  function playLine(src: string, onEnded?: () => void): void {
    if (!armed) {
      onEnded?.()
      return
    }
    stopLine()
    const gen = lineGen
    const el = new Audio(src)
    el.preload = 'auto'
    el.volume = 0.85
    line = el
    el.onended = () => {
      if (gen !== lineGen) return
      line = null
      onEnded?.()
    }
    void el.play().catch((err) => {
      console.warn('[Steel] German crew line blocked/failed', err)
      if (gen !== lineGen) return
      line = null
      onEnded?.()
    })
  }

  function cancelFireArm(): void {
    if (phase === 'idle' && !firePulse) return
    phase = 'idle'
    firePulse = false
  }

  return {
    start() {
      armed = true
      // Warm the hit clip under the same gesture.
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
      console.info('[Steel] German crew voice armed')
    },
    stop() {
      armed = false
      cancelFireArm()
      loadBusy = false
      stopLine()
    },
    announceLoad(id) {
      if (id !== 'aphe' && id !== 'he') return
      // Don't talk over the fire callout chain.
      if (phase !== 'idle') return
      loadBusy = true
      playLine(id === 'aphe' ? LINES.loadAp() : LINES.loadHe(), () => {
        loadBusy = false
      })
    },
    announceLoaded() {
      if (phase !== 'idle') return
      loadBusy = true
      playLine(LINES.loaded(), () => {
        loadBusy = false
      })
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
      if (firePulse) {
        firePulse = false
        return true
      }
      if (phase !== 'idle' || loadBusy) return false
      if (!wantsFire || !canFireNow || !armed) return false

      phase = 'understood'
      playLine(LINES.understood(), () => {
        if (phase !== 'understood') return
        phase = 'ready'
        playLine(LINES.ready(), () => {
          if (phase !== 'ready') return
          phase = 'idle'
          firePulse = true
        })
      })
      return false
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
