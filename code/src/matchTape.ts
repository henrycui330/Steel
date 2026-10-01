import * as THREE from 'three'

/** Sparse event tags on the match tape. */
export type TapeEventKind = 'kill' | 'death' | 'boost' | 'maneuver'

export type TapeEvent = {
  t: number
  kind: TapeEventKind
}

export type TapeSample = {
  t: number
  x: number
  y: number
  z: number
  /** Yaw (rad). */
  yaw: number
  /** Pitch (rad) — aircraft; 0 for tanks. */
  pitch: number
  /** Roll (rad) — aircraft; 0 for tanks. */
  roll: number
  speed: number
}

export type MatchTape = {
  /** Seconds since mission start (sim time). */
  now: () => number
  /** Advance the tape clock (call once per sim frame). */
  tick: (dt: number) => void
  /** Push a pose sample (throttled internally). */
  sample: (opts: {
    position: THREE.Vector3
    yaw: number
    pitch?: number
    roll?: number
    speed: number
  }) => void
  mark: (kind: TapeEventKind) => void
  /** Freeze recording (match over). */
  seal: () => void
  sealed: () => boolean
  duration: () => number
  samples: () => readonly TapeSample[]
  events: () => readonly TapeEvent[]
  /** Build highlight windows for review. */
  highlights: () => TapeClip[]
}

export type TapeClip = {
  start: number
  end: number
  kind: TapeEventKind | 'flight'
  label: string
}

const SAMPLE_HZ = 12
const MAX_SAMPLES = 12 * 120 // ~2 min
const MAX_EVENTS = 48

const CLIP_PAD_BEFORE = 2.2
const CLIP_PAD_AFTER = 2.8
const MIN_CLIP = 3.2

export function createMatchTape(): MatchTape {
  let time = 0
  let sealed = false
  let sampleAcc = 0
  let lastSoftMarkT = -999
  const samples: TapeSample[] = []
  const events: TapeEvent[] = []

  function pushSample(s: TapeSample): void {
    samples.push(s)
    while (samples.length > MAX_SAMPLES) samples.shift()
  }

  return {
    now: () => time,
    tick(dt) {
      if (sealed) return
      time += dt
      sampleAcc += dt
    },
    sample(opts) {
      if (sealed) return
      const interval = 1 / SAMPLE_HZ
      if (sampleAcc < interval && samples.length > 0) return
      sampleAcc = 0
      pushSample({
        t: time,
        x: opts.position.x,
        y: opts.position.y,
        z: opts.position.z,
        yaw: opts.yaw,
        pitch: opts.pitch ?? 0,
        roll: opts.roll ?? 0,
        speed: opts.speed,
      })
    },
    mark(kind) {
      if (sealed) return
      // Soft events (speed / maneuver) debounce so the reel isn't all SPEED tags.
      if (kind === 'boost' || kind === 'maneuver') {
        if (time - lastSoftMarkT < 4.5) return
        lastSoftMarkT = time
      }
      events.push({ t: time, kind })
      while (events.length > MAX_EVENTS) events.shift()
    },
    seal() {
      sealed = true
    },
    sealed: () => sealed,
    duration: () => time,
    samples: () => samples,
    events: () => events,
    highlights() {
      const dur = Math.max(time, 0.01)
      const clips: TapeClip[] = []
      const labelFor = (k: TapeEventKind): string => {
        switch (k) {
          case 'kill':
            return 'KILL'
          case 'death':
            return 'DOWN'
          case 'boost':
            return 'SPEED'
          case 'maneuver':
            return 'MANEUVER'
        }
      }

      for (const ev of events) {
        const start = Math.max(0, ev.t - CLIP_PAD_BEFORE)
        const end = Math.min(dur, Math.max(start + MIN_CLIP, ev.t + CLIP_PAD_AFTER))
        clips.push({ start, end, kind: ev.kind, label: labelFor(ev.kind) })
      }

      // Always include a closing “flight” window near the end if we have motion.
      if (samples.length >= 8) {
        const end = dur
        const start = Math.max(0, end - 6)
        clips.push({ start, end, kind: 'flight', label: 'FINAL' })
      }

      if (clips.length === 0 && samples.length >= 2) {
        clips.push({
          start: 0,
          end: dur,
          kind: 'flight',
          label: 'ACTION',
        })
      }

      // Merge heavily overlapping clips of the same kind.
      clips.sort((a, b) => a.start - b.start)
      const merged: TapeClip[] = []
      for (const c of clips) {
        const last = merged[merged.length - 1]
        if (last && c.start <= last.end + 0.4 && c.kind === last.kind) {
          last.end = Math.max(last.end, c.end)
        } else {
          merged.push({ ...c })
        }
      }
      return merged
    },
  }
}

/** Lerp a pose at time `t` from the sealed tape. */
export function sampleTapeAt(
  tape: MatchTape,
  t: number,
  outPos: THREE.Vector3,
): { yaw: number; pitch: number; roll: number; speed: number } {
  const list = tape.samples()
  if (list.length === 0) {
    outPos.set(0, 2, 0)
    return { yaw: 0, pitch: 0, roll: 0, speed: 0 }
  }
  if (list.length === 1) {
    const s = list[0]!
    outPos.set(s.x, s.y, s.z)
    return { yaw: s.yaw, pitch: s.pitch, roll: s.roll, speed: s.speed }
  }

  const tt = THREE.MathUtils.clamp(t, list[0]!.t, list[list.length - 1]!.t)
  let i = 1
  while (i < list.length && list[i]!.t < tt) i++
  const b = list[i]!
  const a = list[i - 1]!
  const span = Math.max(1e-4, b.t - a.t)
  const u = (tt - a.t) / span
  outPos.set(
    THREE.MathUtils.lerp(a.x, b.x, u),
    THREE.MathUtils.lerp(a.y, b.y, u),
    THREE.MathUtils.lerp(a.z, b.z, u),
  )
  return {
    yaw: THREE.MathUtils.lerp(a.yaw, b.yaw, u),
    pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, u),
    roll: THREE.MathUtils.lerp(a.roll, b.roll, u),
    speed: THREE.MathUtils.lerp(a.speed, b.speed, u),
  }
}
