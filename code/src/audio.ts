import { assetUrl, fixPublicUrl } from './assetUrl'

/** Fire SFX from extracted audio (no video element). */
function fireSfxUrl(): string {
  return fixPublicUrl(assetUrl('sfx/fire.m4a'))
}
function dieselIdleUrl(): string {
  return fixPublicUrl(assetUrl('sfx/diesel-idle.mp3'))
}
function propIdleUrl(): string {
  return fixPublicUrl(assetUrl('sfx/prop-idle.mp3'))
}

const PEAK_VOLUME = 0.9
/** Full volume before fade starts (seconds). */
const HOLD_SEC = 0.35
/** Smooth fade length (seconds). */
const FADE_SEC = 3

let shared: HTMLAudioElement | null = null

function getShared(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio(fireSfxUrl())
    shared.preload = 'auto'
  }
  return shared
}

function fadeOutAndStop(el: HTMLAudioElement, durationSec: number): void {
  const startVol = el.volume
  const t0 = performance.now()
  const durationMs = Math.max(16, durationSec * 1000)

  const tick = (now: number): void => {
    const t = Math.min(1, (now - t0) / durationMs)
    // Ease-out so the tail softens instead of a linear drop
    const eased = 1 - (1 - t) * (1 - t)
    el.volume = Math.max(0, startVol * (1 - eased))
    if (t < 1) {
      requestAnimationFrame(tick)
      return
    }
    el.pause()
    el.currentTime = 0
  }

  requestAnimationFrame(tick)
}

/** Play cannon fire; overlaps allowed via clone. Fades out instead of hard cut. */
export function playFireSound(): void {
  const base = getShared()
  const shot = base.cloneNode(true) as HTMLAudioElement
  shot.volume = PEAK_VOLUME

  void shot
    .play()
    .then(() => {
      window.setTimeout(() => fadeOutAndStop(shot, FADE_SEC), HOLD_SEC * 1000)
    })
    .catch((err) => {
      console.warn('[Steel] Fire SFX blocked or failed', err)
    })
}

export type EngineLoop = {
  /** Begin looping (call after a user gesture / unlockAudio). */
  start: () => void
  /** Hard stop — match end, leave mission. */
  stop: () => void
  /**
   * 0 = mute/pause, 1 = full revs.
   * Maps to volume + slight playbackRate so idle vs moving reads differently.
   */
  setIntensity: (t01: number) => void
}

type LoopOpts = {
  url: string
  label: string
  /** Volume at intensity 0 (still audible idle). */
  volIdle: number
  /** Volume at intensity 1. */
  volFull: number
  /** playbackRate at intensity 0. */
  rateIdle: number
  /** playbackRate at intensity 1. */
  rateFull: number
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function createEngineLoop(opts: LoopOpts): EngineLoop {
  const el = new Audio(opts.url)
  el.preload = 'auto'
  el.loop = true
  el.volume = 0
  let started = false
  let wanted = 0

  function apply(): void {
    const t = clamp01(wanted)
    if (!started) return
    if (t < 0.02) {
      el.volume = 0
      if (!el.paused) el.pause()
      return
    }
    el.volume = opts.volIdle + (opts.volFull - opts.volIdle) * t
    el.playbackRate = opts.rateIdle + (opts.rateFull - opts.rateIdle) * t
    if (el.paused) {
      void el.play().catch((err) => {
        console.warn(`[Steel] ${opts.label} engine SFX blocked`, err)
      })
    }
  }

  return {
    start() {
      started = true
      apply()
    },
    stop() {
      started = false
      wanted = 0
      el.pause()
      el.currentTime = 0
      el.volume = 0
    },
    setIntensity(t01) {
      wanted = clamp01(t01)
      apply()
    },
  }
}

/** Tank diesel idle — speed raises volume / pitch slightly. */
export function createDieselEngine(): EngineLoop {
  return createEngineLoop({
    url: dieselIdleUrl(),
    label: 'Diesel',
    volIdle: 0.2,
    volFull: 0.48,
    rateIdle: 0.92,
    rateFull: 1.18,
  })
}

/** Prop fighter idle — throttle / airspeed raises intensity. */
export function createPropEngine(): EngineLoop {
  return createEngineLoop({
    url: propIdleUrl(),
    label: 'Prop',
    volIdle: 0.16,
    volFull: 0.42,
    rateIdle: 0.88,
    rateFull: 1.22,
  })
}

/** Call once after user gesture (Deploy) so later plays are allowed. */
export function unlockAudio(): void {
  const a = getShared()
  a.volume = 0
  void a
    .play()
    .then(() => {
      a.pause()
      a.currentTime = 0
      a.volume = PEAK_VOLUME
    })
    .catch(() => {
      /* ignore — will retry on first fire */
    })

  // Prime engine loops under the same gesture so Chrome allows them later.
  for (const url of [dieselIdleUrl(), propIdleUrl()]) {
    const probe = new Audio(url)
    probe.volume = 0
    void probe
      .play()
      .then(() => {
        probe.pause()
        probe.currentTime = 0
      })
      .catch(() => {
        /* retry on engine.start() */
      })
  }
}
