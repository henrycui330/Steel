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
  /** Successful pen/blast on an enemy — miss/ricochet stay silent. */
  announceHitThem: () => void
  gateFire: (wantsFire: boolean, canFireNow: boolean) => boolean
}

/**
 * Soviet tank crew callouts.
 * Load AP/HE → Loaded! → Understood, confirming fire! → Ready! → bang.
 * Hit them! on a damaging enemy hit only.
 */
export function createSovietCrewVoice(): SovietCrewVoice {
  let armed = false
  let line: HTMLAudioElement | null = null
  let lineGen = 0
  type Phase = 'idle' | 'understood' | 'ready'
  let phase: Phase = 'idle'
  let firePulse = false
  let loadBusy = false
  const hitBase = new Audio(LINES.hitThem())
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
      console.warn('[Steel] Soviet crew line blocked/failed', err)
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
      hitBase.volume = 0
      void hitBase
        .play()
        .then(() => {
          hitBase.pause()
          hitBase.currentTime = 0
          hitBase.volume = 0.9
        })
        .catch(() => {
          hitBase.volume = 0.9
        })
      console.info('[Steel] Soviet crew voice armed')
    },
    stop() {
      armed = false
      cancelFireArm()
      loadBusy = false
      stopLine()
    },
    announceLoad(id) {
      if (id !== 'aphe' && id !== 'he') return
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
    announceHitThem() {
      if (!armed) return
      const shot = hitBase.cloneNode(true) as HTMLAudioElement
      shot.volume = 0.92
      void shot.play().catch((err) => {
        console.warn('[Steel] Soviet HIT THEM SFX failed', err)
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
