import type { AmmoId } from './ammo'
import { AMMO_ORDER, AMMO_TYPES } from './ammo'
import type { FireHudState } from './fire'
import { assetUrl, fixPublicUrl } from './assetUrl'
import { nationByTeam, nationFlagSrc } from './nations'
import * as THREE from 'three'

export type CombatHudState = {
  hp: number
  maxHp: number
  fire: FireHudState
  /** Seconds left immobilized (0 = mobile). */
  tracksDisableLeft?: number
  /** Weather / climate status line. */
  envStatus?: string
  /** Artillery deploy / map status (PzH only). */
  artilleryStatus?: string
  /** Hull yaw, radians (Three.js Y). */
  headingRad?: number
  /** Drive speed in world units / sec (≈ m/s). */
  speedU?: number
  /** Aim rangefinder distance in meters, or null if no hit. */
  rangeM?: number | null
  /** Player world XZ for minimap. */
  posX?: number
  posZ?: number
  /** Enemy blips (alive only preferred). */
  foes?: Array<{ x: number; z: number }>
  /** Friendly AI blips. */
  allies?: Array<{ x: number; z: number }>
}

export type HudTownMark = {
  x: number
  z: number
  name?: string
  radius?: number
}

export type HudPathMark = {
  points: readonly { x: number; z: number }[]
}

export type HudSpawnMark = {
  x: number
  z: number
  team: 'red' | 'blue'
}

export type HudMinimapConfig = {
  /** Square maps — prefer mapSizeX / mapSizeZ. */
  mapSize?: number
  mapSizeX?: number
  mapSizeZ?: number
  /** Visual theme — forest gets green field + brown roads. */
  theme?: 'forest' | 'desert' | 'city' | 'default'
  towns?: readonly HudTownMark[]
  paths?: readonly HudPathMark[]
  spawns?: readonly HudSpawnMark[]
  hill?: { x: number; z: number; radius: number }
}

export type HudKothState = {
  vostokHold: number
  meridianHold: number
  owner: 'red' | 'blue' | 'contested' | 'none'
  winSec: number
}

export type GameHud = {
  setVisible: (visible: boolean) => void
  setAiming: (aiming: boolean) => void
  updateCrosshairs: (
    camera: THREE.Camera,
    mouseHit: THREE.Vector3,
    barrelHit: THREE.Vector3,
    gunSynced?: boolean,
  ) => void
  updateCombat: (state: CombatHudState) => void
  setKoth: (state: HudKothState | null) => void
  setRespawn: (secondsLeft: number | null) => void
  dispose: () => void
}

function placeEl(el: HTMLElement, x: number, y: number, onScreen: boolean): void {
  el.style.opacity = onScreen ? '1' : '0'
  if (!onScreen) return
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
}

/** World units/s → km/h (1 u ≈ 1 m). */
function speedToKmh(speedU: number): number {
  return Math.abs(speedU) * 3.6
}

/** Heading deg 0–360; 0 = +Z (N). */
function yawToHeadingDeg(yawRad: number): number {
  let deg = THREE.MathUtils.radToDeg(yawRad)
  deg = ((deg % 360) + 360) % 360
  return deg
}

function headingCardinal(deg: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const i = Math.round(deg / 45) % 8
  return labels[i]!
}

/**
 * Tank combat HUD — Phase U + minimap.
 * Corners · sight READY/range · compass · speed · minimap.
 */
export function createHud(minimap?: HudMinimapConfig): GameHud {
  const root = document.createElement('div')
  root.id = 'hud'
  root.setAttribute('aria-hidden', 'true')

  const mouse = document.createElement('div')
  mouse.className = 'xhair xhair-mouse'
  mouse.innerHTML =
    `<img class="xhair-img" src="${fixPublicUrl(assetUrl('assets/crosshair.png'))}" alt="" draggable="false" />`

  const barrel = document.createElement('div')
  barrel.className = 'xhair xhair-barrel'
  barrel.setAttribute('hidden', '')

  const aimMask = document.createElement('div')
  aimMask.className = 'aim-mask'
  aimMask.setAttribute('aria-hidden', 'true')

  const mapSizeX = Math.max(1, minimap?.mapSizeX ?? minimap?.mapSize ?? 150)
  const mapSizeZ = Math.max(1, minimap?.mapSizeZ ?? minimap?.mapSize ?? mapSizeX)
  const halfX = mapSizeX * 0.5
  const halfZ = mapSizeZ * 0.5
  const aspect = mapSizeX / mapSizeZ
  const svgH = 180
  const svgW = Math.max(56, Math.round(svgH * aspect))
  const theme = minimap?.theme ?? 'default'
  const toCx = (x: number) => ((x + halfX) / mapSizeX) * svgW
  const toCy = (z: number) => ((halfZ - z) / mapSizeZ) * svgH
  const pathStroke = Math.max(1.6, (10 / Math.max(mapSizeX, mapSizeZ)) * svgH)

  const minimapEl = document.createElement('div')
  minimapEl.className = `hud-minimap is-${theme}`
  minimapEl.innerHTML = `
    <div class="minimap-frame">
      <svg class="minimap-svg" viewBox="0 0 ${svgW} ${svgH}" aria-hidden="true">
        <defs>
          <linearGradient id="mm-forest-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#3a6b3e"/>
            <stop offset="55%" stop-color="#4f7d45"/>
            <stop offset="100%" stop-color="#2f5534"/>
          </linearGradient>
          <linearGradient id="mm-desert-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c9a878"/>
            <stop offset="100%" stop-color="#a8895c"/>
          </linearGradient>
          <linearGradient id="mm-city-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#4a4e52"/>
            <stop offset="50%" stop-color="#5a5e62"/>
            <stop offset="100%" stop-color="#3a3e42"/>
          </linearGradient>
        </defs>
        <rect class="minimap-arena minimap-arena-${theme}" x="0" y="0" width="${svgW}" height="${svgH}" />
        <g class="minimap-paths"></g>
        <g class="minimap-towns"></g>
        <g class="minimap-hill"></g>
        <g class="minimap-spawns"></g>
        <g class="minimap-foes"></g>
        <g class="minimap-allies"></g>
        <polygon class="minimap-player" points="0,-7 5.5,6 -5.5,6" />
      </svg>
      <div class="minimap-legend">
        <span class="mm-key mm-road"></span>ROAD
        <span class="mm-key mm-town"></span>TOWN
        <span class="mm-key mm-you"></span>YOU
      </div>
    </div>
  `
  const pathsG = minimapEl.querySelector('.minimap-paths') as SVGGElement
  const townsG = minimapEl.querySelector('.minimap-towns') as SVGGElement
  const spawnsG = minimapEl.querySelector('.minimap-spawns') as SVGGElement
  const foesG = minimapEl.querySelector('.minimap-foes') as SVGGElement
  const alliesG = minimapEl.querySelector('.minimap-allies') as SVGGElement
  const playerMark = minimapEl.querySelector('.minimap-player') as SVGPolygonElement

  if (minimap?.paths) {
    for (const path of minimap.paths) {
      if (path.points.length < 2) continue
      const d = path.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${toCx(p.x).toFixed(1)} ${toCy(p.z).toFixed(1)}`)
        .join(' ')
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      line.setAttribute('class', 'minimap-road')
      line.setAttribute('d', d)
      line.setAttribute('stroke-width', String(pathStroke))
      pathsG.appendChild(line)
    }
  }

  if (minimap?.towns) {
    for (const t of minimap.towns) {
      const r = ((t.radius ?? 120) / Math.max(mapSizeX, mapSizeZ)) * svgH
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      c.setAttribute('class', 'minimap-town')
      c.setAttribute('cx', String(toCx(t.x)))
      c.setAttribute('cy', String(toCy(t.z)))
      c.setAttribute('r', String(Math.max(5, r * 0.55)))
      townsG.appendChild(c)
      if (t.name) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('class', 'minimap-town-label')
        label.setAttribute('x', String(toCx(t.x)))
        label.setAttribute('y', String(toCy(t.z) + 3))
        label.textContent = t.name.slice(0, 3).toUpperCase()
        townsG.appendChild(label)
      }
    }
  }

  if (minimap?.hill) {
    const hillG = minimapEl.querySelector('.minimap-hill') as SVGGElement
    const hx = toCx(minimap.hill.x)
    const hy = toCy(minimap.hill.z)
    const hr = (minimap.hill.radius / mapSizeZ) * svgH
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    ring.setAttribute('class', 'minimap-hill-ring')
    ring.setAttribute('cx', String(hx))
    ring.setAttribute('cy', String(hy))
    ring.setAttribute('r', String(Math.max(6, hr)))
    hillG.appendChild(ring)
  }

  if (minimap?.spawns) {
    for (const s of minimap.spawns) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('class', `minimap-spawn minimap-spawn-${s.team}`)
      dot.setAttribute('cx', String(toCx(s.x)))
      dot.setAttribute('cy', String(toCy(s.z)))
      dot.setAttribute('r', '2.4')
      spawnsG.appendChild(dot)
    }
  }

  playerMark.setAttribute(
    'transform',
    `translate(${svgW / 2} ${svgH / 2}) rotate(0)`,
  )

  // Top: compass strip
  const compass = document.createElement('div')
  compass.className = 'hud-compass'
  const tapeMarks: string[] = []
  // Two full circles of marks so the tape can scroll seamlessly
  for (let loop = 0; loop < 2; loop++) {
    for (let d = 0; d < 360; d += 15) {
      const major = d % 90 === 0
      const mid = d % 45 === 0
      let label = ''
      if (d === 0) label = 'N'
      else if (d === 90) label = 'E'
      else if (d === 180) label = 'S'
      else if (d === 270) label = 'W'
      else if (mid) label = String(d)
      tapeMarks.push(
        `<span class="compass-tick${major ? ' is-major' : mid ? ' is-mid' : ''}" data-deg="${d}" style="--i:${loop * 24 + d / 15}">${
          label ? `<b>${label}</b>` : ''
        }</span>`,
      )
    }
  }
  compass.innerHTML = `
    <div class="compass-frame">
      <div class="compass-tape">${tapeMarks.join('')}</div>
    </div>
    <div class="compass-caret" aria-hidden="true"></div>
    <div class="compass-readout">
      <span class="compass-cardinal">N</span>
      <span class="compass-deg">000°</span>
    </div>
  `

  // Center: gun ready under optic (WT-style)
  const sight = document.createElement('div')
  sight.className = 'hud-sight'
  sight.innerHTML = `
    <div class="sight-ready sight-ready-text">READY</div>
    <div class="sight-shell sight-shell-text">HE</div>
    <div class="sight-range sight-range-text">— m</div>
    <div class="sight-bar"><i class="sight-bar-fill"></i></div>
  `

  // Bottom-left: armor + status chips
  const status = document.createElement('div')
  status.className = 'hud-corner hud-bl'
  status.innerHTML = `
    <div class="hud-plate combat-hp">
      <div class="hud-plate-head">
        <span class="combat-label">Armor</span>
        <span class="combat-value hp-text">1000</span>
      </div>
      <div class="combat-bar"><i class="combat-bar-fill hp-fill"></i></div>
    </div>
    <div class="hud-chips">
      <div class="hud-chip combat-tracks is-ok" data-chip="tracks">
        <span class="combat-label">Trk</span>
        <span class="combat-value tracks-text">OK</span>
      </div>
      <div class="hud-chip combat-env is-quiet" data-chip="env">
        <span class="combat-label">Cond</span>
        <span class="combat-value env-text">OK</span>
      </div>
      <div class="hud-chip combat-arty" data-chip="arty" hidden>
        <span class="combat-label">Arty</span>
        <span class="combat-value arty-text">—</span>
      </div>
    </div>
  `

  // Bottom-right: speed + weapon + ammo
  const weapon = document.createElement('div')
  weapon.className = 'hud-corner hud-br'
  weapon.innerHTML = `
    <div class="hud-plate combat-speed">
      <div class="hud-plate-head">
        <span class="combat-label">Spd</span>
        <span class="combat-value speed-text">0</span>
      </div>
      <span class="speed-unit">km/h</span>
    </div>
    <div class="hud-plate combat-weapon-block">
      <div class="hud-plate-head">
        <span class="combat-label">Gun</span>
        <span class="combat-value weapon-text">MAIN · 1</span>
      </div>
    </div>
    <div class="combat-ammo" role="list"></div>
  `

  const ammoBox = weapon.querySelector('.combat-ammo') as HTMLDivElement
  for (const id of AMMO_ORDER) {
    const def = AMMO_TYPES[id]
    const btn = document.createElement('div')
    btn.className = 'ammo-slot'
    btn.dataset.ammo = id
    btn.setAttribute('role', 'listitem')
    btn.innerHTML = `
      <kbd>${def.key}</kbd>
      <div class="ammo-meta">
        <span class="ammo-name">${def.name}</span>
        <span class="ammo-role">${def.role}</span>
      </div>
      <span class="ammo-state"></span>
    `
    ammoBox.appendChild(btn)
  }

  root.append(aimMask, mouse, barrel, compass, sight, status, weapon, minimapEl)

  const vostok = nationByTeam('red')
  const meridian = nationByTeam('blue')
  const kothEl = document.createElement('div')
  kothEl.className = 'hud-koth'
  kothEl.hidden = true
  kothEl.innerHTML = `
    <div class="koth-side koth-vostok">
      <img src="${nationFlagSrc(vostok)}" alt="" />
      <span class="koth-name">${vostok.short}</span>
      <div class="koth-bar"><i class="koth-fill koth-fill-v"></i></div>
      <span class="koth-time koth-time-v">0s</span>
    </div>
    <div class="koth-mid">
      <span class="koth-label">HILL</span>
      <span class="koth-owner">NEUTRAL</span>
    </div>
    <div class="koth-side koth-meridian">
      <span class="koth-time koth-time-m">0s</span>
      <div class="koth-bar"><i class="koth-fill koth-fill-m"></i></div>
      <span class="koth-name">${meridian.short}</span>
      <img src="${nationFlagSrc(meridian)}" alt="" />
    </div>
  `
  const respawnEl = document.createElement('div')
  respawnEl.className = 'hud-respawn'
  respawnEl.hidden = true
  respawnEl.innerHTML = `<span class="respawn-label">RESPAWN</span><span class="respawn-count">5</span>`
  root.append(kothEl, respawnEl)

  document.body.appendChild(root)

  const hpFill = status.querySelector('.hp-fill') as HTMLElement
  const hpText = status.querySelector('.hp-text') as HTMLElement
  const hpPlate = status.querySelector('.combat-hp') as HTMLElement
  const tracksChip = status.querySelector('.combat-tracks') as HTMLElement
  const envChip = status.querySelector('.combat-env') as HTMLElement
  const weaponText = weapon.querySelector('.weapon-text') as HTMLElement
  const speedText = weapon.querySelector('.speed-text') as HTMLElement
  const tracksText = status.querySelector('.tracks-text') as HTMLElement
  const envText = status.querySelector('.env-text') as HTMLElement
  const artyRow = status.querySelector('.combat-arty') as HTMLElement
  const artyText = status.querySelector('.arty-text') as HTMLElement
  const sightReady = sight.querySelector('.sight-ready-text') as HTMLElement
  const sightShell = sight.querySelector('.sight-shell-text') as HTMLElement
  const sightRange = sight.querySelector('.sight-range-text') as HTMLElement
  const sightBar = sight.querySelector('.sight-bar-fill') as HTMLElement
  const compassTape = compass.querySelector('.compass-tape') as HTMLElement
  const compassDeg = compass.querySelector('.compass-deg') as HTMLElement
  const compassCardinal = compass.querySelector('.compass-cardinal') as HTMLElement

  /** Tick width in CSS matches --compass-tick-w */
  const TICK_W = 28
  const TICKS_PER_CIRCLE = 24

  function shortChip(s: string, max = 14): string {
    const t = s.trim()
    if (t.length <= max) return t
    return `${t.slice(0, max - 1)}…`
  }

  return {
    setVisible(visible) {
      root.style.display = visible ? 'block' : 'none'
    },
    setAiming(aiming) {
      root.classList.toggle('is-aiming', aiming)
    },
    updateCrosshairs(_camera, _mouseHit, _barrelHit, _gunSynced = false) {
      const cx = window.innerWidth * 0.5
      const cy = window.innerHeight * 0.5
      placeEl(mouse, cx, cy, true)
      placeEl(barrel, cx, cy, true)
    },
    updateCombat(state) {
      const hpPct = THREE.MathUtils.clamp(state.hp / state.maxHp, 0, 1)
      hpFill.style.transform = `scaleX(${hpPct})`
      hpText.textContent = `${Math.round(state.hp)}`
      hpPlate.classList.toggle('is-critical', hpPct <= 0.25)
      hpPlate.classList.toggle('is-low', hpPct > 0.25 && hpPct <= 0.5)

      const kmh = Math.round(speedToKmh(state.speedU ?? 0))
      speedText.textContent = `${kmh}`
      speedText.classList.toggle('is-rev', (state.speedU ?? 0) < -0.15)

      const heading = yawToHeadingDeg(state.headingRad ?? 0)
      compassDeg.textContent = `${String(Math.round(heading)).padStart(3, '0')}°`
      compassCardinal.textContent = headingCardinal(heading)
      const px = (heading / 360) * TICKS_PER_CIRCLE * TICK_W
      compassTape.style.transform = `translateX(calc(-50% - ${px}px))`

      const { fire } = state
      const onMg = fire.weapon === 'mg'
      weaponText.textContent = onMg ? 'MG · 2' : 'MAIN · 1'
      weaponText.classList.toggle('is-mg', onMg)
      root.classList.toggle('is-mg', onMg)

      let readyLabel: string
      let shellLabel: string
      let progress: number
      let isReady: boolean

      if (onMg) {
        isReady = fire.ready
        readyLabel = fire.ready ? 'READY' : '…'
        shellLabel = 'MG'
        progress = 1
      } else if (fire.ready && fire.chambered) {
        isReady = true
        readyLabel = 'READY'
        shellLabel = AMMO_TYPES[fire.chambered].name
        progress = 1
      } else {
        isReady = false
        progress =
          fire.reloadTotal > 0 ? 1 - fire.reloadLeft / fire.reloadTotal : 0
        progress = THREE.MathUtils.clamp(progress, 0, 1)
        const name = AMMO_TYPES[fire.loading].name
        shellLabel = name
        readyLabel =
          fire.reloadLeft > 0.05 ? fire.reloadLeft.toFixed(1) : 'READY'
      }

      sightReady.textContent = readyLabel
      sightShell.textContent = shellLabel
      sightBar.style.transform = `scaleX(${progress})`
      sight.classList.toggle('is-ready', isReady)
      sight.classList.toggle('is-loading', !isReady)
      sight.classList.toggle('is-mg', onMg)

      const range = state.rangeM
      if (range != null && Number.isFinite(range) && range > 0) {
        sightRange.textContent = `${Math.round(range)} m`
        sightRange.classList.remove('is-empty')
      } else {
        sightRange.textContent = '— m'
        sightRange.classList.add('is-empty')
      }

      const trackLeft = state.tracksDisableLeft ?? 0
      if (trackLeft > 0) {
        tracksText.textContent = `OUT ${Math.ceil(trackLeft)}s`
        tracksChip.classList.add('is-warn')
        tracksChip.classList.remove('is-ok')
      } else {
        tracksText.textContent = 'OK'
        tracksChip.classList.add('is-ok')
        tracksChip.classList.remove('is-warn')
      }

      const env = (state.envStatus ?? '').trim()
      if (env) {
        envText.textContent = shortChip(env)
        envChip.classList.add('is-warn')
        envChip.classList.remove('is-quiet', 'is-ok')
      } else {
        envText.textContent = 'OK'
        envChip.classList.add('is-quiet')
        envChip.classList.remove('is-warn')
      }

      const arty = (state.artilleryStatus ?? '').trim()
      if (arty) {
        artyRow.hidden = false
        artyText.textContent = shortChip(arty, 16)
        const warn = arty.includes('STOP') || arty.includes('MOVE')
        const ok = arty.includes('DEPLOYED') || arty.includes('MAP')
        artyRow.classList.toggle('is-warn', warn)
        artyRow.classList.toggle('is-ok', ok && !warn)
      } else {
        artyRow.hidden = true
        artyRow.classList.remove('is-warn', 'is-ok')
      }

      for (const slot of ammoBox.querySelectorAll('.ammo-slot')) {
        const id = slot.getAttribute('data-ammo') as AmmoId
        const loading = !onMg && fire.loading === id
        const chambered = !onMg && fire.chambered === id && fire.ready
        slot.classList.toggle('is-loading', loading)
        slot.classList.toggle('is-chambered', chambered)
        slot.classList.toggle('is-dim', onMg)
        const stateEl = slot.querySelector('.ammo-state')
        if (stateEl) {
          if (onMg) stateEl.textContent = ''
          else if (chambered) stateEl.textContent = 'RDY'
          else if (loading) stateEl.textContent = 'LOAD'
          else stateEl.textContent = ''
        }
      }

      // Minimap (reuse compass `heading`)
      const mapX = state.posX ?? 0
      const mapZ = state.posZ ?? 0
      playerMark.setAttribute(
        'transform',
        `translate(${toCx(mapX)} ${toCy(mapZ)}) rotate(${heading})`,
      )

      foesG.replaceChildren()
      for (const f of state.foes ?? []) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('class', 'minimap-foe')
        dot.setAttribute('cx', String(toCx(f.x)))
        dot.setAttribute('cy', String(toCy(f.z)))
        dot.setAttribute('r', '3.2')
        foesG.appendChild(dot)
      }
      alliesG.replaceChildren()
      for (const a of state.allies ?? []) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('class', 'minimap-ally')
        dot.setAttribute('cx', String(toCx(a.x)))
        dot.setAttribute('cy', String(toCy(a.z)))
        dot.setAttribute('r', '2.8')
        alliesG.appendChild(dot)
      }
    },
    setKoth(state) {
      kothEl.hidden = !state
      if (!state) return
      const vPct = Math.min(1, state.vostokHold / state.winSec)
      const mPct = Math.min(1, state.meridianHold / state.winSec)
      ;(kothEl.querySelector('.koth-fill-v') as HTMLElement).style.transform = `scaleX(${vPct})`
      ;(kothEl.querySelector('.koth-fill-m') as HTMLElement).style.transform = `scaleX(${mPct})`
      ;(kothEl.querySelector('.koth-time-v') as HTMLElement).textContent =
        `${Math.floor(state.vostokHold)}s`
      ;(kothEl.querySelector('.koth-time-m') as HTMLElement).textContent =
        `${Math.floor(state.meridianHold)}s`
      const ownerEl = kothEl.querySelector('.koth-owner') as HTMLElement
      kothEl.classList.remove('is-vostok', 'is-meridian', 'is-contested')
      if (state.owner === 'red') {
        ownerEl.textContent = 'VOSTOK'
        kothEl.classList.add('is-vostok')
      } else if (state.owner === 'blue') {
        ownerEl.textContent = 'MERIDIAN'
        kothEl.classList.add('is-meridian')
      } else if (state.owner === 'contested') {
        ownerEl.textContent = 'CONTESTED'
        kothEl.classList.add('is-contested')
      } else {
        ownerEl.textContent = 'NEUTRAL'
      }
    },
    setRespawn(secondsLeft) {
      if (secondsLeft == null || secondsLeft <= 0) {
        respawnEl.hidden = true
        return
      }
      respawnEl.hidden = false
      ;(respawnEl.querySelector('.respawn-count') as HTMLElement).textContent =
        String(Math.ceil(secondsLeft))
    },
    dispose() {
      root.remove()
    },
  }
}
