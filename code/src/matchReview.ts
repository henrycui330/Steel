import * as THREE from 'three'
import { loadPlayerAircraft } from './loadAircraft'
import { loadTankChassis } from './loadTank'
import {
  sampleTapeAt,
  type MatchTape,
  type TapeClip,
} from './matchTape'
import type { TankId } from './tankCatalog'
import './matchReview.css'

export type MatchReview = {
  active: () => boolean
  begin: (seed?: number) => void
  reroll: () => void
  stop: () => void
  update: (realDt: number, camera: THREE.PerspectiveCamera) => void
  dispose: () => void
}

export type MatchReviewOptions = {
  scene: THREE.Scene
  heightAt: (x: number, z: number) => number
  tape: MatchTape
  /** Chassis / airframe shown as the replay ghost. */
  tankId: TankId
  /** Aircraft review uses higher chase / more bank. */
  aircraft?: boolean
  onShow?: (showing: boolean) => void
  onDone?: () => void
}

const RATES = [0.25, 0.5, 1, 2, 4] as const

type CamStyle = {
  side: number
  rise: number
  back: number
  fov: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickCam(rng: () => number, aircraft: boolean): CamStyle {
  const sideSign = rng() < 0.5 ? -1 : 1
  if (aircraft) {
    const styles: CamStyle[] = [
      { side: 9 * sideSign, rise: 4.5, back: 14, fov: 52 },
      { side: 4 * sideSign, rise: 2.2, back: 10, fov: 44 },
      { side: 14 * sideSign, rise: 7, back: 18, fov: 58 },
      { side: 0.5 * sideSign, rise: 1.4, back: 8, fov: 40 },
    ]
    return styles[Math.floor(rng() * styles.length)]!
  }
  const styles: CamStyle[] = [
    { side: 7 * sideSign, rise: 3.2, back: 11, fov: 48 },
    { side: 3 * sideSign, rise: 1.8, back: 8, fov: 42 },
    { side: 11 * sideSign, rise: 5.5, back: 14, fov: 55 },
    { side: 5 * sideSign, rise: 2.4, back: 9, fov: 46 },
  ]
  return styles[Math.floor(rng() * styles.length)]!
}

/** Soft replay look — readable silhouette, not a live combatant. */
function tintReplayGhost(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return
    const srcList = Array.isArray(obj.material) ? obj.material : [obj.material]
    const next = srcList.map((m) => {
      const mat = m.clone()
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial
      ) {
        mat.transparent = true
        mat.opacity = Math.min(mat.opacity, 0.92)
        mat.emissive = new THREE.Color(0x3a2a12)
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.22)
        mat.depthWrite = true
        mat.needsUpdate = true
      } else if ('opacity' in mat && 'transparent' in mat) {
        ;(mat as THREE.Material & { transparent: boolean; opacity: number }).transparent =
          true
        ;(mat as THREE.Material & { opacity: number }).opacity = 0.9
        mat.needsUpdate = true
      }
      return mat
    })
    obj.material = next.length === 1 ? next[0]! : next
    obj.castShadow = true
    obj.receiveShadow = true
  })
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    // Geometries stay on the GLB cache — disposing them pinks every copy.
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) m?.dispose?.()
  })
}

export function createMatchReview(opts: MatchReviewOptions): MatchReview {
  const { scene, heightAt, tape, tankId, aircraft = false, onShow, onDone } = opts

  const overlay = document.createElement('div')
  overlay.className = 'matchrev'
  overlay.innerHTML = `
    <div class="matchrev-bar top"></div>
    <div class="matchrev-bar bottom"></div>
    <div class="matchrev-slate">
      <span class="matchrev-dot"></span>
      <span class="matchrev-label">HIGHLIGHTS</span>
      <span class="matchrev-clip">—</span>
    </div>
    <div class="matchrev-hud">
      <div class="matchrev-row">
        <button type="button" class="matchrev-btn" data-act="slower" title="Slower">«</button>
        <button type="button" class="matchrev-btn" data-act="play" title="Play / Pause">❚❚</button>
        <button type="button" class="matchrev-btn" data-act="faster" title="Faster">»</button>
        <span class="matchrev-rate">×1.0</span>
        <button type="button" class="matchrev-btn matchrev-reroll" data-act="reroll">Reroll cams</button>
        <button type="button" class="matchrev-btn" data-act="done">Done</button>
      </div>
      <input class="matchrev-scrub" type="range" min="0" max="1000" value="0" />
      <div class="matchrev-time"><span class="matchrev-t0">0:00</span><span class="matchrev-t1">0:00</span></div>
    </div>`
  overlay.style.display = 'none'
  document.body.appendChild(overlay)

  const clipEl = overlay.querySelector('.matchrev-clip') as HTMLElement
  const rateEl = overlay.querySelector('.matchrev-rate') as HTMLElement
  const playBtn = overlay.querySelector('[data-act="play"]') as HTMLButtonElement
  const scrub = overlay.querySelector('.matchrev-scrub') as HTMLInputElement
  const t0El = overlay.querySelector('.matchrev-t0') as HTMLElement
  const t1El = overlay.querySelector('.matchrev-t1') as HTMLElement

  const ghost = new THREE.Group()
  ghost.name = 'matchReviewGhost'
  ghost.visible = false
  scene.add(ghost)

  let vehicleRoot: THREE.Object3D | null = null
  let loadFailed = false
  const loadPromise = (async () => {
    try {
      if (aircraft) {
        const air = await loadPlayerAircraft(tankId)
        vehicleRoot = air.root
      } else {
        const handle = await loadTankChassis(tankId)
        vehicleRoot = handle.root
      }
      vehicleRoot.name = 'matchReviewVehicle'
      tintReplayGhost(vehicleRoot)
      ghost.add(vehicleRoot)
      console.info(`[Steel] Match review ghost · ${tankId}${aircraft ? ' (air)' : ''}`)
    } catch (err) {
      loadFailed = true
      console.warn('[Steel] Match review ghost failed — no vehicle mesh', err)
    }
  })()

  let running = false
  let paused = false
  let rateIdx = 2
  let seed = 1
  let clips: TapeClip[] = []
  let clipIndex = 0
  let localT = 0
  let cam = pickCam(() => 0.5, aircraft)
  let scrubbing = false
  /** Next frameCamera hard-cuts instead of lerping (new clip / seek). */
  let cutCam = true

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const side = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const quat = new THREE.Quaternion()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')

  function fmt(sec: number): string {
    const s = Math.max(0, Math.floor(sec))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
  }

  function currentClip(): TapeClip | null {
    return clips[clipIndex] ?? null
  }

  function playlistDuration(): number {
    return clips.reduce((n, c) => n + (c.end - c.start), 0)
  }

  function absoluteTime(): number {
    const c = currentClip()
    if (!c) return 0
    return THREE.MathUtils.clamp(c.start + localT, c.start, c.end)
  }

  function rebuildPlaylist(rng: () => number): void {
    const base = tape.highlights().slice()
    const finals = base.filter((c) => c.kind === 'flight' && c.label === 'FINAL')
    const rest = base.filter((c) => !(c.kind === 'flight' && c.label === 'FINAL'))
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
    }
    clips = [...rest, ...finals]
    if (clips.length === 0) {
      clips = [{ start: 0, end: Math.max(1, tape.duration()), kind: 'flight', label: 'ACTION' }]
    }
    clipIndex = 0
    localT = 0
    cam = pickCam(rng, aircraft)
    const c = currentClip()
    clipEl.textContent = c?.label ?? '—'
    t1El.textContent = fmt(playlistDuration())
    cutCam = true
  }

  function setRateDisplay(): void {
    rateEl.textContent = `×${RATES[rateIdx]!}`
  }

  function syncScrub(): void {
    if (scrubbing) return
    const total = playlistDuration()
    let played = 0
    for (let i = 0; i < clipIndex; i++) {
      const c = clips[i]!
      played += c.end - c.start
    }
    played += localT
    scrub.value = String(Math.round((played / Math.max(total, 1e-3)) * 1000))
    t0El.textContent = fmt(played)
  }

  function seekPlaylist(u01: number): void {
    const total = playlistDuration()
    let target = u01 * total
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]!
      const len = c.end - c.start
      if (target <= len || i === clips.length - 1) {
        clipIndex = i
        localT = THREE.MathUtils.clamp(target, 0, len)
        clipEl.textContent = c.label
        cam = pickCam(mulberry32(seed + i * 997), aircraft)
        cutCam = true
        return
      }
      target -= len
    }
  }

  function frameCamera(camera: THREE.PerspectiveCamera, realDt: number): void {
    const pose = sampleTapeAt(tape, absoluteTime(), pos)
    euler.set(pose.pitch, pose.yaw, pose.roll)
    quat.setFromEuler(euler)
    ghost.position.copy(pos)
    ghost.quaternion.copy(quat)

    forward.set(0, 0, 1).applyQuaternion(quat).normalize()
    side.set(1, 0, 0).applyQuaternion(quat).normalize()

    goal.copy(pos)
    goal.addScaledVector(side, cam.side)
    goal.addScaledVector(forward, -cam.back)
    goal.y += cam.rise
    const floor = heightAt(goal.x, goal.z) + 1.8
    if (goal.y < floor) goal.y = floor

    look.copy(pos).addScaledVector(forward, aircraft ? 12 : 8)
    look.y += aircraft ? 0.4 : 0.8

    const snap = cutCam
    cutCam = false
    if (snap) {
      camera.position.copy(goal)
      camera.fov = cam.fov
    } else {
      camera.position.lerp(goal, 1 - Math.exp(-5.5 * realDt))
      camera.fov = THREE.MathUtils.lerp(camera.fov, cam.fov, 1 - Math.exp(-4 * realDt))
    }
    camera.up.copy(up)
    camera.lookAt(look)
    camera.updateProjectionMatrix()
  }

  function advanceClip(simDt: number): void {
    const c = currentClip()
    if (!c) {
      stop()
      onDone?.()
      return
    }
    localT += simDt
    const len = c.end - c.start
    // Cut straight into the next clip — no freeze-frame between scenes.
    while (localT >= len) {
      const overflow = localT - len
      if (clipIndex >= clips.length - 1) {
        stop()
        onDone?.()
        return
      }
      clipIndex++
      localT = overflow
      const next = currentClip()
      if (!next) {
        stop()
        onDone?.()
        return
      }
      clipEl.textContent = next.label
      cam = pickCam(mulberry32(seed + clipIndex * 997), aircraft)
      cutCam = true
    }
  }

  function begin(nextSeed?: number): void {
    tape.seal()
    seed = (nextSeed ?? (Date.now() & 0xffff)) || 1
    const rng = mulberry32(seed)
    rebuildPlaylist(rng)
    rateIdx = 2
    paused = false
    playBtn.textContent = '❚❚'
    setRateDisplay()
    running = true
    ghost.visible = true
    overlay.style.display = ''
    void overlay.offsetHeight
    overlay.classList.add('in')
    onShow?.(true)
    void loadPromise.then(() => {
      if (running && loadFailed) {
        console.warn('[Steel] Match review playing without vehicle mesh')
      }
    })
    console.info(
      `[Steel] Match review · ${clips.length} clips · ${tape.samples().length} samples · seed ${seed}`,
    )
  }

  function stop(): void {
    if (!running) return
    running = false
    ghost.visible = false
    overlay.classList.remove('in')
    overlay.style.display = 'none'
    onShow?.(false)
  }

  overlay.querySelector('[data-act="slower"]')!.addEventListener('click', () => {
    rateIdx = Math.max(0, rateIdx - 1)
    setRateDisplay()
  })
  overlay.querySelector('[data-act="faster"]')!.addEventListener('click', () => {
    rateIdx = Math.min(RATES.length - 1, rateIdx + 1)
    setRateDisplay()
  })
  playBtn.addEventListener('click', () => {
    paused = !paused
    playBtn.textContent = paused ? '▶' : '❚❚'
  })
  overlay.querySelector('[data-act="reroll"]')!.addEventListener('click', () => {
    begin(seed + 17 + Math.floor(Math.random() * 1000))
  })
  overlay.querySelector('[data-act="done"]')!.addEventListener('click', () => {
    stop()
    onDone?.()
  })
  scrub.addEventListener('pointerdown', () => {
    scrubbing = true
  })
  scrub.addEventListener('pointerup', () => {
    scrubbing = false
  })
  scrub.addEventListener('input', () => {
    seekPlaylist(Number(scrub.value) / 1000)
  })

  return {
    active: () => running,
    begin,
    reroll() {
      begin(seed + 31 + Math.floor(Math.random() * 2000))
    },
    stop,
    update(realDt, camera) {
      if (!running) return
      if (!paused && !scrubbing) {
        const rate = RATES[rateIdx]!
        advanceClip(realDt * rate)
      }
      frameCamera(camera, realDt)
      syncScrub()
    },
    dispose() {
      stop()
      if (vehicleRoot) {
        ghost.remove(vehicleRoot)
        disposeObject3D(vehicleRoot)
        vehicleRoot = null
      }
      scene.remove(ghost)
      overlay.remove()
    },
  }
}
