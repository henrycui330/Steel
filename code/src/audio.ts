import { assetUrl, fixPublicUrl } from './assetUrl'
import { germanCrewSfxUrls } from './germanCrew'
import { sovietCrewSfxUrls } from './sovietCrew'

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
function jetIdleUrl(): string {
  return fixPublicUrl(assetUrl('sfx/jet-idle.mp3'))
}
function ejectSirenUrl(): string {
  return fixPublicUrl(assetUrl('sfx/eject-siren.mp3'))
}
function lowAltAlarmUrl(): string {
  return fixPublicUrl(assetUrl('sfx/low-alt-alarm.mp3'))
}
function stallAlarmUrl(): string {
  return fixPublicUrl(assetUrl('sfx/stall-alarm.mp3'))
}
function reloadSfxUrl(): string {
  return fixPublicUrl(assetUrl('sfx/reloading.mp3'))
}

const PEAK_VOLUME = 0.9
/** Full volume before fade starts (seconds). */
const HOLD_SEC = 0.35
/** Smooth fade length (seconds). */
const FADE_SEC = 3

let shared: HTMLAudioElement | null = null
let reloadShared: HTMLAudioElement | null = null

function getShared(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio(fireSfxUrl())
    shared.preload = 'auto'
  }
  return shared
}

function getReloadShared(): HTMLAudioElement {
  if (!reloadShared) {
    reloadShared = new Audio(reloadSfxUrl())
    reloadShared.preload = 'auto'
  }
  return reloadShared
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

let rocketCtx: AudioContext | null = null

/** Short whoosh for MLRS / rocket rack — not the tank cannon sample. */
export function playRocketFireSound(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!rocketCtx) rocketCtx = new AC()
    const ctx = rocketCtx
    if (ctx.state === 'suspended') void ctx.resume()

    const t0 = ctx.currentTime
    const dur = 0.28
    const bufferSize = Math.floor(ctx.sampleRate * dur)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      const env = 1 - i / bufferSize
      data[i] = (Math.random() * 2 - 1) * env * env
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(480, t0)
    filter.frequency.exponentialRampToValueAtTime(180, t0 + dur)
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  } catch (err) {
    console.warn('[Steel] Rocket SFX failed', err)
  }
}

/** Delay after fire before breech reload SFX (eject / cool beat). */
const RELOAD_SFX_DELAY_MS = 300
let reloadDelayTimer: ReturnType<typeof setTimeout> | null = null

/** Main-gun breech / loader — starts after a short post-shot delay. */
export function playReloadSound(): void {
  if (reloadDelayTimer != null) {
    clearTimeout(reloadDelayTimer)
    reloadDelayTimer = null
  }
  reloadDelayTimer = setTimeout(() => {
    reloadDelayTimer = null
    const el = getReloadShared()
    try {
      el.pause()
      el.currentTime = 0
    } catch {
      /* ignore seek errors before metadata */
    }
    el.volume = 0.72
    void el.play().catch((err) => {
      console.warn('[Steel] Reload SFX blocked or failed', err)
    })
  }, RELOAD_SFX_DELAY_MS)
}

/** Stop reload SFX early (match end / weapon swap). */
export function stopReloadSound(): void {
  if (reloadDelayTimer != null) {
    clearTimeout(reloadDelayTimer)
    reloadDelayTimer = null
  }
  if (!reloadShared) return
  reloadShared.pause()
  reloadShared.currentTime = 0
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

export type CabinBed = {
  start: () => void
  stop: () => void
  /**
   * Track clatter under the diesel.
   * `speed01` / `turn01` 0–1; `aiming` ducks the bed so the sight stays calm.
   */
  setDrive: (speed01: number, turn01: number, aiming: boolean) => void
  /** Soft suspension / landing thud (0–1). */
  thump: (amount: number) => void
}

let cabinCtx: AudioContext | null = null
let trackNoiseBuf: AudioBuffer | null = null

function getCabinCtx(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!cabinCtx) cabinCtx = new AC()
    return cabinCtx
  } catch {
    return null
  }
}

function getTrackNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (trackNoiseBuf && trackNoiseBuf.sampleRate === ctx.sampleRate) return trackNoiseBuf
  const sec = 1.4
  const n = Math.floor(ctx.sampleRate * sec)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let brown = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + white * 0.02) * 0.986
    // Metallic ticks every so often — reads as track links.
    const tick =
      Math.random() < 0.0025 ? (Math.random() * 2 - 1) * 0.55 : 0
    data[i] = brown * 0.55 + tick
  }
  trackNoiseBuf = buf
  return buf
}

/**
 * Procedural cabin bed — track clatter loop + bump thumps (no extra assets).
 * Sits under diesel; never louder than the gun.
 */
export function createCabinBed(): CabinBed {
  let started = false
  let src: AudioBufferSourceNode | null = null
  let filter: BiquadFilterNode | null = null
  let gain: GainNode | null = null
  let wantedSpeed = 0
  let wantedTurn = 0
  let aiming = false

  function apply(): void {
    const ctx = getCabinCtx()
    if (!ctx || !gain || !filter || !started) return
    if (ctx.state === 'suspended') void ctx.resume()

    const s = clamp01(wantedSpeed)
    const t = clamp01(wantedTurn)
    // Need real motion before clatter reads; turn at crawl still ticks a little.
    const motion = Math.max(0, (s - 0.08) / 0.92)
    const raw = motion * 0.72 + t * motion * 0.28
    const duck = aiming ? 0.28 : 1
    const level = raw * duck * 0.14
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setTargetAtTime(level, now, 0.08)
    const hz = 280 + motion * 520 + t * 90
    filter.frequency.cancelScheduledValues(now)
    filter.frequency.setTargetAtTime(hz, now, 0.1)
  }

  function ensureLoop(): void {
    const ctx = getCabinCtx()
    if (!ctx || !started || src) return
    if (ctx.state === 'suspended') void ctx.resume()
    const g = ctx.createGain()
    g.gain.value = 0
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 320
    f.Q.value = 0.7
    const s = ctx.createBufferSource()
    s.buffer = getTrackNoiseBuffer(ctx)
    s.loop = true
    s.connect(f)
    f.connect(g)
    g.connect(ctx.destination)
    try {
      s.start()
    } catch (err) {
      console.warn('[Steel] Cabin track loop failed', err)
      return
    }
    src = s
    filter = f
    gain = g
    apply()
  }

  return {
    start() {
      started = true
      ensureLoop()
      apply()
      console.info('[Steel] Cabin bed — track clatter ready')
    },
    stop() {
      started = false
      wantedSpeed = 0
      wantedTurn = 0
      try {
        src?.stop()
      } catch {
        /* already stopped */
      }
      src?.disconnect()
      filter?.disconnect()
      gain?.disconnect()
      src = null
      filter = null
      gain = null
    },
    setDrive(speed01, turn01, aim) {
      wantedSpeed = clamp01(speed01)
      wantedTurn = clamp01(turn01)
      aiming = aim
      if (started && !src) ensureLoop()
      apply()
    },
    thump(amount) {
      const ctx = getCabinCtx()
      if (!ctx || !started) return
      if (ctx.state === 'suspended') void ctx.resume()
      const a = clamp01(amount)
      if (a < 0.05) return
      const t0 = ctx.currentTime
      const dur = 0.12 + a * 0.1
      const n = Math.floor(ctx.sampleRate * dur)
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < n; i++) {
        const env = Math.pow(1 - i / n, 1.8)
        data[i] = (Math.random() * 2 - 1) * env
      }
      const node = ctx.createBufferSource()
      node.buffer = buf
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(90 + a * 70, t0)
      const g = ctx.createGain()
      const peak = 0.12 + a * 0.18
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(peak * (aiming ? 0.35 : 1), t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      node.connect(lp)
      lp.connect(g)
      g.connect(ctx.destination)
      node.start(t0)
      node.stop(t0 + dur + 0.02)
    },
  }
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

/** Jet turbine loop — F-16 / MiG / Su-25. */
export function createJetEngine(): EngineLoop {
  return createEngineLoop({
    url: jetIdleUrl(),
    label: 'Jet',
    volIdle: 0.14,
    volFull: 0.5,
    rateIdle: 0.9,
    rateFull: 1.28,
  })
}

export type ConditionAlarm = {
  /** Begin under a user gesture so later setActive works. */
  start: () => void
  /** Hard stop — match end. */
  stop: () => void
  /**
   * While `on`, loop the clip. When `off`, pause + rewind immediately
   * (condition over — no need to finish the full file).
   */
  setActive: (on: boolean) => void
}

function createConditionAlarm(opts: {
  url: string
  label: string
  volume: number
}): ConditionAlarm {
  const el = new Audio(opts.url)
  el.preload = 'auto'
  el.loop = true
  el.volume = 0
  let armed = false
  let active = false

  function apply(): void {
    if (!armed) return
    if (!active) {
      el.volume = 0
      if (!el.paused) el.pause()
      el.currentTime = 0
      return
    }
    el.volume = opts.volume
    if (el.paused) {
      void el.play().catch((err) => {
        console.warn(`[Steel] ${opts.label} alarm SFX blocked`, err)
      })
    }
  }

  return {
    start() {
      armed = true
      apply()
    },
    stop() {
      armed = false
      active = false
      el.pause()
      el.currentTime = 0
      el.volume = 0
    },
    setActive(on) {
      if (active === on) return
      active = on
      apply()
      if (on) console.info(`[Steel] ${opts.label} alarm ON`)
      else console.info(`[Steel] ${opts.label} alarm OFF`)
    },
  }
}

/** Ejection seat siren — active only while the eject cinematic runs. */
export function createEjectSiren(): ConditionAlarm {
  return createConditionAlarm({
    url: ejectSirenUrl(),
    label: 'Eject',
    volume: 0.42,
  })
}

/** Low-altitude buzzer — active while AGL is below the warning band. */
export function createLowAltAlarm(): ConditionAlarm {
  return createConditionAlarm({
    url: lowAltAlarmUrl(),
    label: 'Low-alt',
    volume: 0.38,
  })
}

/** Stall warning — high-pitch buzz while airspeed is below stall. */
export function createStallAlarm(): ConditionAlarm {
  return createConditionAlarm({
    url: stallAlarmUrl(),
    label: 'Stall',
    volume: 0.4,
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
  for (const url of [
    dieselIdleUrl(),
    propIdleUrl(),
    ejectSirenUrl(),
    lowAltAlarmUrl(),
    stallAlarmUrl(),
    reloadSfxUrl(),
    ...germanCrewSfxUrls(),
    ...sovietCrewSfxUrls(),
  ]) {
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
