import type { AmmoId } from './ammo'
import { AMMO_ORDER, AMMO_TYPES } from './ammo'
import type { FireHudState } from './fire'
import * as THREE from 'three'

export type CombatHudState = {
  hp: number
  maxHp: number
  fire: FireHudState
  /** Seconds left immobilized (0 = mobile). */
  tracksDisableLeft?: number
  /** Weather / climate status line. */
  envStatus?: string
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
  dispose: () => void
}

function placeEl(el: HTMLElement, x: number, y: number, onScreen: boolean): void {
  el.style.opacity = onScreen ? '1' : '0'
  if (!onScreen) return
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
}

/** Crosshairs + combat strip (HP, reload, ammo, tracks). */
export function createHud(): GameHud {
  const root = document.createElement('div')
  root.id = 'hud'
  root.setAttribute('aria-hidden', 'true')

  const mouse = document.createElement('div')
  mouse.className = 'xhair xhair-mouse'
  mouse.innerHTML =
    '<img class="xhair-img" src="/assets/crosshair.png" alt="" draggable="false" />'

  const barrel = document.createElement('div')
  barrel.className = 'xhair xhair-barrel'
  barrel.setAttribute('hidden', '')
  // Kept for API/layout; optic PNG is the sole reticle.

  const aimMask = document.createElement('div')
  aimMask.className = 'aim-mask'
  aimMask.setAttribute('aria-hidden', 'true')

  const panel = document.createElement('div')
  panel.className = 'combat-panel'
  panel.innerHTML = `
    <div class="combat-row combat-hp">
      <span class="combat-label">Armor</span>
      <div class="combat-bar"><i class="combat-bar-fill hp-fill"></i></div>
      <span class="combat-value hp-text">1000</span>
    </div>
    <div class="combat-row combat-weapon">
      <span class="combat-label">Gun</span>
      <span class="combat-value weapon-text">MAIN</span>
    </div>
    <div class="combat-row combat-reload">
      <span class="combat-label">Load</span>
      <div class="combat-bar"><i class="combat-bar-fill reload-fill"></i></div>
      <span class="combat-value reload-text">READY</span>
    </div>
    <div class="combat-row combat-tracks">
      <span class="combat-label">Tracks</span>
      <span class="combat-value tracks-text">OK</span>
    </div>
    <div class="combat-row combat-env">
      <span class="combat-label">Cond</span>
      <span class="combat-value env-text">—</span>
    </div>
    <div class="combat-ammo"></div>
  `

  const ammoBox = panel.querySelector('.combat-ammo') as HTMLDivElement
  for (const id of AMMO_ORDER) {
    const def = AMMO_TYPES[id]
    const btn = document.createElement('div')
    btn.className = 'ammo-slot'
    btn.dataset.ammo = id
    btn.innerHTML = `<kbd>${def.key}</kbd><span class="ammo-name">${def.name}</span><span class="ammo-role">${def.role}</span>`
    ammoBox.appendChild(btn)
  }

  root.append(aimMask, mouse, barrel, panel)
  document.body.appendChild(root)

  const hpFill = panel.querySelector('.hp-fill') as HTMLElement
  const hpText = panel.querySelector('.hp-text') as HTMLElement
  const reloadFill = panel.querySelector('.reload-fill') as HTMLElement
  const reloadText = panel.querySelector('.reload-text') as HTMLElement
  const weaponText = panel.querySelector('.weapon-text') as HTMLElement
  const tracksText = panel.querySelector('.tracks-text') as HTMLElement
  const envText = panel.querySelector('.env-text') as HTMLElement

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

      const { fire } = state
      const onMg = fire.weapon === 'mg'
      weaponText.textContent = onMg ? 'MG · 2' : 'MAIN · 1'
      weaponText.classList.toggle('is-mg', onMg)
      root.classList.toggle('is-mg', onMg)

      if (onMg) {
        reloadFill.style.transform = 'scaleX(1)'
        reloadFill.classList.add('is-ready')
        reloadText.textContent = fire.ready ? 'MG READY' : 'MG…'
      } else if (fire.ready && fire.chambered) {
        reloadFill.style.transform = 'scaleX(1)'
        reloadText.textContent = `READY · ${AMMO_TYPES[fire.chambered].name}`
        reloadFill.classList.add('is-ready')
      } else {
        const progress =
          fire.reloadTotal > 0 ? 1 - fire.reloadLeft / fire.reloadTotal : 0
        reloadFill.style.transform = `scaleX(${THREE.MathUtils.clamp(progress, 0, 1)})`
        reloadFill.classList.remove('is-ready')
        const name = AMMO_TYPES[fire.loading].name
        reloadText.textContent =
          fire.reloadLeft > 0.05 ? `${name} ${fire.reloadLeft.toFixed(1)}s` : `READY · ${name}`
      }

      const trackLeft = state.tracksDisableLeft ?? 0
      if (trackLeft > 0) {
        tracksText.textContent = `OUT ${Math.ceil(trackLeft)}s`
        tracksText.classList.add('is-disabled')
      } else {
        tracksText.textContent = 'OK'
        tracksText.classList.remove('is-disabled')
      }

      const env = (state.envStatus ?? '').trim()
      envText.textContent = env || 'OK'
      envText.classList.toggle('is-warn', !!env)

      for (const slot of ammoBox.querySelectorAll('.ammo-slot')) {
        const id = slot.getAttribute('data-ammo') as AmmoId
        slot.classList.toggle('is-loading', !onMg && fire.loading === id)
        slot.classList.toggle('is-chambered', !onMg && fire.chambered === id && fire.ready)
        slot.classList.toggle('is-dim', onMg)
      }
    },
    dispose() {
      root.remove()
    },
  }
}
