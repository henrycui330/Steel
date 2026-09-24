import './flightHud.css'
import type { FlightTelemetry } from './aircraftFlight'
import { createMinimapWidget, type HudKothState, type HudMinimapConfig } from './hud'
import { nationByTeam, nationFlagSrc } from './nations'

/**
 * Flight HUD for the Corsair — separate from the tank HUD on purpose.
 *
 * The tank HUD is built around armor, tracks, reload and ammo, none of which
 * mean anything in the air, so this is its own instrument set rather than the
 * tank corners with rows hidden.
 */

/** Degrees of pitch per pixel of ladder travel. */
const PITCH_PX_PER_DEG = 5.2
/** Ladder rungs every N degrees. */
const LADDER_STEP = 10
const LADDER_RANGE = 40

/** Wing-gun state, when the aircraft is armed. */
export type GunHudState = {
  ammo: number
  /** 0–1; at 1 the guns have cooked and stop. */
  heat: number
  firing: boolean
}

export type BombHudState = {
  remaining: number
  /** Seconds to impact for a bomb released now, or null if no solution. */
  fallTime: number | null
  /** Predicted impact is inside the lethal radius of an enemy. */
  onTarget: boolean
  scopeOn: boolean
}

/** Corsair wing rockets (HVAR). */
export type RocketHudState = {
  remaining: number
}

/** F-16 missile lock + ammo. */
export type MissileHudState = {
  phase: 'idle' | 'soft' | 'acquiring' | 'hard'
  ammo?: number
}

/** Screen rect of the scope, so the renderer can match its viewport. */
export type ScopeRect = { x: number; y: number; w: number; h: number }
export const SCOPE_SIZE = 300
export const SCOPE_PAD = 20

export type FlightTactical = {
  hp: number
  maxHp: number
  posX: number
  posZ: number
  /** Map arrow: 0 = +Z, clockwise toward +X. Not the compass tape. */
  headingDeg: number
  foes?: ReadonlyArray<{ x: number; z: number }>
  allies?: ReadonlyArray<{ x: number; z: number }>
}

export type FlightHud = {
  update: (
    tm: FlightTelemetry,
    guns?: GunHudState,
    bombs?: BombHudState,
    tactical?: FlightTactical,
    missiles?: MissileHudState | null,
    countermeasures?: { releasing: boolean } | null,
    rockets?: RocketHudState | null,
  ) => void
  setVisible: (visible: boolean) => void
  setKoth: (state: HudKothState | null) => void
  setRespawn: (secondsLeft: number | null) => void
  /** Top-right scope rect in CSS pixels (DOM coords, origin top-left). */
  scopeRect: () => ScopeRect
  dispose: () => void
}

function ladderHtml(): string {
  const rows: string[] = []
  for (let deg = -LADDER_RANGE; deg <= LADDER_RANGE; deg += LADDER_STEP) {
    // Offset with margin-top, NOT top: the rungs are centred with `top: 50%`
    // in CSS, and an inline `top` would replace that and shift the whole
    // ladder half its height (parking the −40 rung at screen centre).
    const offset = `margin-top:${-deg * PITCH_PX_PER_DEG}px`
    if (deg === 0) {
      rows.push(
        `<div class="fh-rung fh-rung-zero" style="${offset}">` +
          `<i></i><span>0</span><i></i></div>`,
      )
      continue
    }
    const cls = deg > 0 ? 'fh-rung-up' : 'fh-rung-down'
    rows.push(
      `<div class="fh-rung ${cls}" style="${offset}">` +
        `<i></i><span>${Math.abs(deg)}</span><i></i></div>`,
    )
  }
  return rows.join('')
}

export function createFlightHud(minimap?: HudMinimapConfig): FlightHud {
  const root = document.createElement('div')
  root.className = 'fhud'
  root.innerHTML = `
    <div class="fh-horizon">
      <div class="fh-ladder">${ladderHtml()}</div>
    </div>
    <div class="fh-reticle">
      <i class="fh-ret-l"></i>
      <i class="fh-ret-dot"></i>
      <i class="fh-ret-r"></i>
    </div>
    <div class="fh-gauge fh-left">
      <span class="fh-label">AIRSPEED</span>
      <span class="fh-value fh-speed">0</span>
      <span class="fh-unit">m/s</span>
    </div>
    <div class="fh-gauge fh-right">
      <span class="fh-label">ALT AGL</span>
      <span class="fh-value fh-alt">0</span>
      <span class="fh-unit">m</span>
    </div>
    <div class="fh-heading">
      <span class="fh-hdg-card">N</span>
      <span class="fh-hdg-num">000°</span>
    </div>
    <div class="fh-throttle">
      <span class="fh-label">THR</span>
      <div class="fh-thr-bar"><i class="fh-thr-fill"></i></div>
      <span class="fh-value fh-thr-num">0%</span>
    </div>
    <div class="fh-guns" hidden>
      <span class="fh-label">GUNS</span>
      <span class="fh-value fh-gun-ammo">0</span>
      <div class="fh-heat"><i class="fh-heat-fill"></i></div>
    </div>
    <div class="fh-bombs" hidden>
      <span class="fh-label">BOMBS</span>
      <span class="fh-value fh-bomb-count">0</span>
      <span class="fh-bomb-fall">—</span>
    </div>
    <div class="fh-rockets" hidden>
      <span class="fh-label">RKT</span>
      <span class="fh-value fh-rkt-count">0</span>
      <span class="fh-rkt-hint">R</span>
    </div>
    <div class="fh-msl" hidden>
      <span class="fh-label">MSL</span>
      <span class="fh-value fh-msl-status">—</span>
      <span class="fh-msl-ammo" hidden></span>
      <span class="fh-msl-hint">P lock/unlock · M fire · Q chaff</span>
    </div>
    <div class="fh-cm-banner" hidden>Releasing, Chaff, Flare</div>
    <div class="fh-scope" hidden>
      <div class="fh-scope-frame">
        <i class="fh-scope-v"></i>
        <i class="fh-scope-h"></i>
        <span class="fh-scope-tag">BOMBSIGHT</span>
        <span class="fh-scope-fall">—</span>
      </div>
    </div>
    <div class="fh-warn fh-stall">STALL</div>
    <div class="fh-caution">CEILING</div>
    <div class="fh-mode fh-autolevel">AUTO-LEVEL</div>
    <div class="fh-mode fh-cobra">COBRA</div>
    <div class="fh-hp combat-hp">
      <div class="hud-plate-head">
        <span class="combat-label">HP</span>
        <span class="combat-value hp-text">0</span>
      </div>
      <div class="combat-bar"><i class="combat-bar-fill hp-fill"></i></div>
    </div>
  `
  document.body.appendChild(root)

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
  const mini = createMinimapWidget(minimap)
  root.appendChild(mini.el)

  const hpPlate = root.querySelector<HTMLElement>('.fh-hp')!
  const hpFill = root.querySelector<HTMLElement>('.fh-hp .hp-fill')!
  const hpText = root.querySelector<HTMLElement>('.fh-hp .hp-text')!

  const horizon = root.querySelector<HTMLElement>('.fh-horizon')!
  const ladder = root.querySelector<HTMLElement>('.fh-ladder')!
  const speedEl = root.querySelector<HTMLElement>('.fh-speed')!
  const altEl = root.querySelector<HTMLElement>('.fh-alt')!
  const hdgCard = root.querySelector<HTMLElement>('.fh-hdg-card')!
  const hdgNum = root.querySelector<HTMLElement>('.fh-hdg-num')!
  const thrFill = root.querySelector<HTMLElement>('.fh-thr-fill')!
  const thrNum = root.querySelector<HTMLElement>('.fh-thr-num')!
  const stall = root.querySelector<HTMLElement>('.fh-stall')!
  const caution = root.querySelector<HTMLElement>('.fh-caution')!
  const autoLevel = root.querySelector<HTMLElement>('.fh-autolevel')!
  const cobraEl = root.querySelector<HTMLElement>('.fh-cobra')!
  const gunsEl = root.querySelector<HTMLElement>('.fh-guns')!
  const gunAmmo = root.querySelector<HTMLElement>('.fh-gun-ammo')!
  const heatFill = root.querySelector<HTMLElement>('.fh-heat-fill')!
  const reticle = root.querySelector<HTMLElement>('.fh-reticle')!
  const bombsEl = root.querySelector<HTMLElement>('.fh-bombs')!
  const bombCount = root.querySelector<HTMLElement>('.fh-bomb-count')!
  const bombFall = root.querySelector<HTMLElement>('.fh-bomb-fall')!
  const rocketsEl = root.querySelector<HTMLElement>('.fh-rockets')!
  const rktCount = root.querySelector<HTMLElement>('.fh-rkt-count')!
  const mslEl = root.querySelector<HTMLElement>('.fh-msl')!
  const mslStatus = root.querySelector<HTMLElement>('.fh-msl-status')!
  const mslAmmo = root.querySelector<HTMLElement>('.fh-msl-ammo')!
  const cmBanner = root.querySelector<HTMLElement>('.fh-cm-banner')!
  const scopeEl = root.querySelector<HTMLElement>('.fh-scope')!
  const scopeFall = root.querySelector<HTMLElement>('.fh-scope-fall')!
  const scopeFrame = root.querySelector<HTMLElement>('.fh-scope-frame')!
  scopeEl.style.setProperty('--scope-size', `${SCOPE_SIZE}px`)
  scopeEl.style.setProperty('--scope-pad', `${SCOPE_PAD}px`)

  function cardinal(deg: number): string {
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    return labels[Math.round(deg / 45) % 8]!
  }

  let lastSpeed = -1
  let lastAlt = -1
  let lastHdg = -1
  let lastThr = -1
  let lastStall: boolean | null = null
  let lastAuto: boolean | null = null
  let lastCobra: boolean | null = null
  let lastCaution = ''
  let lastAmmo = -1
  let lastHeat = -1
  let lastFiring: boolean | null = null
  let lastBombs = -1
  let lastRockets = -1
  let lastFall = ''
  let lastOnTarget: boolean | null = null
  let lastScope: boolean | null = null
  let lastHp = -1
  let lastMsl = ''
  let lastMslAmmo = -1
  let lastCm = false

  return {
    update(tm, guns, bombs, tactical, missiles, countermeasures, rockets) {
      // Artificial horizon: roll the whole horizon against bank, slide the
      // ladder against pitch. Bank is "right wing down positive", and the
      // instrument rolls opposite the aircraft, hence the negation.
      horizon.style.transform = `rotate(${-tm.bank}deg)`
      ladder.style.transform = `translateY(${tm.pitch * PITCH_PX_PER_DEG}px)`

      // Text writes are the expensive part — only touch on change.
      const speed = Math.round(tm.speed)
      if (speed !== lastSpeed) {
        lastSpeed = speed
        speedEl.textContent = String(speed)
      }

      const alt = Math.round(tm.agl)
      if (alt !== lastAlt) {
        lastAlt = alt
        altEl.textContent = String(alt)
        altEl.classList.toggle('is-low', tm.agl < 40)
      }

      const hdg = Math.round(tm.heading) % 360
      if (hdg !== lastHdg) {
        lastHdg = hdg
        hdgNum.textContent = `${String(hdg).padStart(3, '0')}°`
        hdgCard.textContent = cardinal(hdg)
      }

      const thr = Math.round(tm.throttle * 100)
      if (thr !== lastThr) {
        lastThr = thr
        thrFill.style.width = `${thr}%`
        thrNum.textContent = `${thr}%`
      }

      if (tm.stalled !== lastStall) {
        lastStall = tm.stalled
        stall.classList.toggle('is-on', tm.stalled)
        speedEl.classList.toggle('is-low', tm.stalled)
      }

      // Bounds beat ceiling: leaving the arena is the more urgent problem.
      const cautionText = tm.nearEdge ? 'RETURN TO AREA' : tm.nearCeiling ? 'CEILING' : ''
      if (cautionText !== lastCaution) {
        lastCaution = cautionText
        caution.textContent = cautionText
        caution.classList.toggle('is-on', cautionText !== '')
      }

      if (tm.handsOff !== lastAuto) {
        lastAuto = tm.handsOff
        autoLevel.classList.toggle('is-on', tm.handsOff)
      }

      if (tm.cobra !== lastCobra) {
        lastCobra = tm.cobra
        cobraEl.classList.toggle('is-on', tm.cobra)
      }

      if (bombs) {
        if (bombsEl.hidden) bombsEl.hidden = false
        if (bombs.remaining !== lastBombs) {
          lastBombs = bombs.remaining
          bombCount.textContent = String(bombs.remaining)
          bombCount.classList.toggle('is-low', bombs.remaining === 0)
        }
        const fall =
          bombs.remaining > 0 && bombs.fallTime !== null
            ? `${bombs.fallTime.toFixed(1)}s`
            : '—'
        if (fall !== lastFall) {
          lastFall = fall
          bombFall.textContent = fall
          scopeFall.textContent = fall
        }
        if (bombs.onTarget !== lastOnTarget) {
          lastOnTarget = bombs.onTarget
          bombsEl.classList.toggle('is-on-target', bombs.onTarget)
          scopeFrame.classList.toggle('is-on-target', bombs.onTarget)
        }
        if (bombs.scopeOn !== lastScope) {
          lastScope = bombs.scopeOn
          scopeEl.hidden = !bombs.scopeOn
        }
      } else if (!bombsEl.hidden) {
        bombsEl.hidden = true
        scopeEl.hidden = true
      }

      if (rockets) {
        if (rocketsEl.hidden) rocketsEl.hidden = false
        if (rockets.remaining !== lastRockets) {
          lastRockets = rockets.remaining
          rktCount.textContent = String(rockets.remaining)
          rktCount.classList.toggle('is-low', rockets.remaining === 0)
        }
      } else if (!rocketsEl.hidden) {
        rocketsEl.hidden = true
      }

      if (!guns) {
        if (!gunsEl.hidden) gunsEl.hidden = true
      } else {
        if (gunsEl.hidden) gunsEl.hidden = false

        if (guns.ammo !== lastAmmo) {
          lastAmmo = guns.ammo
          gunAmmo.textContent = String(guns.ammo)
          gunAmmo.classList.toggle('is-low', guns.ammo === 0)
        }

        const heatPct = Math.round(guns.heat * 100)
        if (heatPct !== lastHeat) {
          lastHeat = heatPct
          heatFill.style.width = `${heatPct}%`
          heatFill.classList.toggle('is-hot', guns.heat >= 1)
        }

        if (guns.firing !== lastFiring) {
          lastFiring = guns.firing
          reticle.classList.toggle('is-firing', guns.firing)
        }
      }

      if (!missiles) {
        if (!mslEl.hidden) mslEl.hidden = true
      } else {
        if (mslEl.hidden) mslEl.hidden = false
        const label =
          missiles.phase === 'hard'
            ? 'LOCKED'
            : missiles.phase === 'acquiring'
              ? 'ACQ…'
              : missiles.phase === 'soft'
                ? 'TRACK'
                : '—'
        if (label !== lastMsl) {
          lastMsl = label
          mslStatus.textContent = label
          mslEl.dataset.phase = missiles.phase
        }
        const ammo = missiles.ammo
        if (ammo != null) {
          mslAmmo.hidden = false
          if (ammo !== lastMslAmmo) {
            lastMslAmmo = ammo
            mslAmmo.textContent = `×${ammo}`
          }
        } else {
          mslAmmo.hidden = true
        }
      }

      const releasing = !!countermeasures?.releasing
      if (releasing !== lastCm) {
        lastCm = releasing
        cmBanner.hidden = !releasing
      }

      if (!tactical) return
      const hpPct = Math.max(0, Math.min(1, tactical.maxHp > 0 ? tactical.hp / tactical.maxHp : 0))
      hpFill.style.transform = `scaleX(${hpPct})`
      hpPlate.classList.toggle('is-critical', hpPct <= 0.25)
      hpPlate.classList.toggle('is-low', hpPct > 0.25 && hpPct <= 0.5)
      const hp = Math.round(tactical.hp)
      if (hp !== lastHp) {
        lastHp = hp
        hpText.textContent = String(hp)
      }
      mini.update({
        posX: tactical.posX,
        posZ: tactical.posZ,
        headingDeg: tactical.headingDeg,
        foes: tactical.foes,
        allies: tactical.allies,
      })
    },
    setVisible(visible) {
      root.style.display = visible ? '' : 'none'
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
    scopeRect: () => ({
      x: window.innerWidth - SCOPE_SIZE - SCOPE_PAD,
      y: SCOPE_PAD,
      w: SCOPE_SIZE,
      h: SCOPE_SIZE,
    }),
    dispose() {
      root.remove()
    },
  }
}
