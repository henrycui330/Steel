import * as THREE from 'three'
import { nationByTeam, nationFlagSrc, type TeamId } from './nations'

export type MatchOpeningUnit = {
  root: THREE.Object3D
  team: TeamId
  aircraft?: boolean
}

export type MatchOpening = {
  active: () => boolean
  /** Drive the intro camera. No-op once finished / skipped. */
  update: (dt: number, camera: THREE.PerspectiveCamera) => void
  skip: () => void
  dispose: () => void
}

type Beat = {
  /** Duration of the hold / ease into this look. */
  dur: number
  pos: THREE.Vector3
  look: THREE.Vector3
  title: string
  sub: string
  flagUrl: string | null
  accent: string
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function centroid(roots: THREE.Object3D[]): THREE.Vector3 | null {
  if (roots.length === 0) return null
  const c = new THREE.Vector3()
  for (const r of roots) c.add(r.position)
  c.multiplyScalar(1 / roots.length)
  return c
}

function spawnFallback(
  spawns: THREE.Vector3[],
  heightAt: (x: number, z: number) => number,
): THREE.Vector3 | null {
  if (spawns.length === 0) return null
  const c = new THREE.Vector3()
  for (const s of spawns) c.add(s)
  c.multiplyScalar(1 / spawns.length)
  c.y = heightAt(c.x, c.z)
  return c
}

function shotFor(
  focus: THREE.Vector3,
  opts: { side: 'south' | 'east'; elev: number; dist: number; lookY: number },
): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const look = focus.clone()
  look.y += opts.lookY
  const pos = focus.clone()
  if (opts.side === 'south') {
    pos.z -= opts.dist
    pos.x += opts.dist * 0.18
  } else {
    pos.x += opts.dist
    pos.z += opts.dist * 0.12
  }
  pos.y = focus.y + opts.elev
  return { pos, look }
}

/**
 * Match opening flyover — south → north over Forest Overwatch.
 * Beats: Vostok tanks → Vostok air → Meridian tanks → Meridian air → settle on player.
 * Space / Enter / Esc / click skips.
 */
export function createMatchOpening(opts: {
  units: MatchOpeningUnit[]
  spawns: { red: THREE.Vector3[]; blue: THREE.Vector3[] }
  heightAt: (x: number, z: number) => number
  mapHalfZ: number
  playerRoot: THREE.Object3D
  /** Called once when the intro ends (natural or skip). */
  onDone?: () => void
}): MatchOpening {
  const { heightAt, mapHalfZ, playerRoot } = opts

  const redGround = opts.units.filter((u) => u.team === 'red' && !u.aircraft).map((u) => u.root)
  const redAir = opts.units.filter((u) => u.team === 'red' && u.aircraft).map((u) => u.root)
  const blueGround = opts.units.filter((u) => u.team === 'blue' && !u.aircraft).map((u) => u.root)
  const blueAir = opts.units.filter((u) => u.team === 'blue' && u.aircraft).map((u) => u.root)

  const beats: Beat[] = []

  // Establish: high south, looking up the map.
  const southZ = -mapHalfZ * 0.92
  const establishFocus = new THREE.Vector3(0, heightAt(0, southZ + 80), southZ + 120)
  beats.push({
    dur: 3.2,
    pos: new THREE.Vector3(40, establishFocus.y + 95, southZ - 40),
    look: establishFocus.clone().setY(establishFocus.y + 8),
    title: 'Steel',
    sub: 'Forces deploying',
    flagUrl: null,
    accent: '#c4a35a',
  })

  function pushForce(
    team: TeamId,
    kind: 'tanks' | 'aircraft',
    roots: THREE.Object3D[],
    fallbackSpawns: THREE.Vector3[],
  ): void {
    const nation = nationByTeam(team)
    const focus =
      centroid(roots) ??
      spawnFallback(fallbackSpawns, heightAt) ??
      new THREE.Vector3(0, heightAt(0, team === 'red' ? -mapHalfZ * 0.85 : mapHalfZ * 0.85), team === 'red' ? -mapHalfZ * 0.85 : mapHalfZ * 0.85)
    if (kind === 'aircraft' && roots.length === 0) {
      // No air units this match — skip the beat entirely.
      return
    }
    // Empty tank slots still get a spawn flyby so both nations appear.
    const elev = kind === 'aircraft' ? 55 : 28
    const dist = kind === 'aircraft' ? 90 : 55
    const lookY = kind === 'aircraft' ? 8 : 2.5
    const { pos, look } = shotFor(focus, {
      side: team === 'red' ? 'south' : 'east',
      elev,
      dist,
      lookY,
    })
    beats.push({
      dur: kind === 'aircraft' ? 3.6 : 4.2,
      pos,
      look,
      title: nation.name,
      sub: kind === 'aircraft' ? 'Air wing' : 'Armoured column',
      flagUrl: nationFlagSrc(nation),
      accent: nation.color,
    })
  }

  pushForce('red', 'tanks', redGround, opts.spawns.red)
  pushForce('red', 'aircraft', redAir, opts.spawns.red)
  pushForce('blue', 'tanks', blueGround, opts.spawns.blue)
  pushForce('blue', 'aircraft', blueAir, opts.spawns.blue)

  // Settle onto the player.
  const py = playerRoot.position.y
  const yaw = playerRoot.rotation.y
  const behind = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(18)
  const settlePos = playerRoot.position.clone().add(behind)
  settlePos.y = py + 9
  const settleLook = playerRoot.position.clone()
  settleLook.y = py + 2
  beats.push({
    dur: 2.4,
    pos: settlePos,
    look: settleLook,
    title: '',
    sub: '',
    flagUrl: null,
    accent: '#c4a35a',
  })

  const overlay = document.createElement('div')
  overlay.id = 'match-opening'
  overlay.innerHTML = `
    <div class="mo-letterbox mo-top"></div>
    <div class="mo-letterbox mo-bot"></div>
    <div class="mo-slate">
      <img class="mo-flag" alt="" hidden />
      <p class="mo-title"></p>
      <p class="mo-sub"></p>
    </div>
    <p class="mo-skip">Space / click — skip</p>
  `
  document.body.appendChild(overlay)
  const flagEl = overlay.querySelector('.mo-flag') as HTMLImageElement
  const titleEl = overlay.querySelector('.mo-title') as HTMLElement
  const subEl = overlay.querySelector('.mo-sub') as HTMLElement
  const slateEl = overlay.querySelector('.mo-slate') as HTMLElement

  let beatIdx = 0
  let beatT = 0
  let live = true
  let finished = false
  let fromPos = beats[0]!.pos.clone()
  let fromLook = beats[0]!.look.clone()
  let labelShown = ''

  function showLabel(b: Beat): void {
    const key = `${b.title}|${b.sub}`
    if (key === labelShown) return
    labelShown = key
    if (!b.title) {
      slateEl.classList.remove('is-on')
      return
    }
    titleEl.textContent = b.title
    subEl.textContent = b.sub
    titleEl.style.color = b.accent
    if (b.flagUrl) {
      flagEl.src = b.flagUrl
      flagEl.hidden = false
    } else {
      flagEl.hidden = true
      flagEl.removeAttribute('src')
    }
    slateEl.classList.remove('is-on')
    // Retrigger CSS fade
    void slateEl.offsetWidth
    slateEl.classList.add('is-on')
  }

  showLabel(beats[0]!)

  function finish(): void {
    if (finished) return
    finished = true
    live = false
    overlay.classList.add('is-done')
    window.setTimeout(() => overlay.remove(), 350)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pointerdown', onPointer, true)
    console.info('[Steel] Match opening done')
    opts.onDone?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (!live) return
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish()
    }
  }
  function onPointer(e: PointerEvent): void {
    if (!live) return
    // Ignore HUD-ish UI targets if any
    if ((e.target as HTMLElement | null)?.closest?.('#main-menu')) return
    finish()
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointer, true)

  console.info(
    `[Steel] Match opening — ${beats.length} beats · Vostok ground ${redGround.length} air ${redAir.length} · Meridian ground ${blueGround.length} air ${blueAir.length}`,
  )

  const camPos = new THREE.Vector3()
  const camLook = new THREE.Vector3()

  return {
    active: () => live,
    skip: finish,
    dispose() {
      live = false
      finished = true
      overlay.remove()
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    },
    update(dt, camera) {
      if (!live) return
      const beat = beats[beatIdx]
      if (!beat) {
        finish()
        return
      }
      beatT += dt
      const u = Math.min(1, beatT / beat.dur)
      const e = easeInOut(u)
      camPos.lerpVectors(fromPos, beat.pos, e)
      camLook.lerpVectors(fromLook, beat.look, e)
      // Soft sway
      camPos.x += Math.sin((beatIdx + beatT) * 0.35) * 1.2
      camera.position.copy(camPos)
      camera.lookAt(camLook)
      showLabel(beat)

      if (u >= 1) {
        fromPos.copy(beat.pos)
        fromLook.copy(beat.look)
        beatIdx++
        beatT = 0
        if (beatIdx >= beats.length) finish()
        else showLabel(beats[beatIdx]!)
      }
    },
  }
}
