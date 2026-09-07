/** Keyboard: WASD drive, Shift brake, Space fire, C camera; ↑/↓ ammo; 1/2 gun; RMB aim. */
export type DriveInput = {
  forward: number
  turn: number
  brake: boolean
  fire: boolean
}

import type { AmmoId } from './ammo'
import type { WeaponId } from './ammo'

const keys = new Set<string>()
let cameraToggleQueued = false
let aimToggleQueued = false
let ammoSelectQueued: AmmoId | null = null
let weaponSelectQueued: WeaponId | null = null
let zoomDeltaQueued = 0

function isDown(code: string): boolean {
  return keys.has(code)
}

export function getDriveInput(): DriveInput {
  let forward = 0
  let turn = 0

  // Movement is WASD only — arrows are ammo select.
  if (isDown('KeyW')) forward += 1
  if (isDown('KeyS')) forward -= 1
  if (isDown('KeyA')) turn += 1
  if (isDown('KeyD')) turn -= 1

  const brake =
    isDown('ShiftLeft') ||
    isDown('ShiftRight') ||
    isDown('ControlLeft') ||
    isDown('ControlRight')
  const fire = isDown('Space')

  return { forward, turn, brake, fire }
}

export function consumeCameraToggle(): boolean {
  if (!cameraToggleQueued) return false
  cameraToggleQueued = false
  return true
}

/** Edge-triggered right-click aim mode toggle. */
export function consumeAimToggle(): boolean {
  if (!aimToggleQueued) return false
  aimToggleQueued = false
  return true
}

/** Accumulated wheel deltaY since last consume (positive = scroll down). */
export function consumeZoomDelta(): number {
  const d = zoomDeltaQueued
  zoomDeltaQueued = 0
  return d
}

/** Edge-triggered ammo select (↑ HE, ↓ APHE) — also selects main gun. */
export function consumeAmmoSelect(): AmmoId | null {
  const id = ammoSelectQueued
  ammoSelectQueued = null
  return id
}

/** Edge-triggered weapon select (1 = main, 2 = MG). */
export function consumeWeaponSelect(): WeaponId | null {
  const id = weaponSelectQueued
  weaponSelectQueued = null
  return id
}

export function bindDriveInput(): void {
  window.addEventListener('keydown', (e) => {
    // Don’t steal keys while the HTML menu is up (scroll / forms).
    if (document.getElementById('main-menu')) return
    if (
      e.code === 'Space' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      e.preventDefault()
    }
    if (e.code === 'KeyC' && !e.repeat) {
      cameraToggleQueued = true
    }
    if (e.code === 'ArrowUp' && !e.repeat) {
      ammoSelectQueued = 'he'
    }
    if (e.code === 'ArrowDown' && !e.repeat) {
      ammoSelectQueued = 'aphe'
    }
    if (e.code === 'Digit1' && !e.repeat) {
      weaponSelectQueued = 'main'
    }
    if (e.code === 'Digit2' && !e.repeat) {
      weaponSelectQueued = 'mg'
    }
    keys.add(e.code)
  })
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code)
  })
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return
    e.preventDefault()
    aimToggleQueued = true
  })
  window.addEventListener(
    'wheel',
    (e) => {
      // Global preventDefault was blocking #main-menu scroll entirely.
      if (document.getElementById('main-menu')) return
      e.preventDefault()
      zoomDeltaQueued += e.deltaY
    },
    { passive: false },
  )
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
  window.addEventListener('blur', () => {
    keys.clear()
    cameraToggleQueued = false
    aimToggleQueued = false
    ammoSelectQueued = null
    weaponSelectQueued = null
    zoomDeltaQueued = 0
  })
}
