/** Fire SFX from extracted audio (no video element). */
const FIRE_SFX_URL = '/sfx/fire.m4a'
const PEAK_VOLUME = 0.9
/** Full volume before fade starts (seconds). */
const HOLD_SEC = 0.35
/** Smooth fade length (seconds). */
const FADE_SEC = 3

let shared: HTMLAudioElement | null = null

function getShared(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio(FIRE_SFX_URL)
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
}
