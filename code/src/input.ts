/** Keyboard: WASD drive, Shift brake, Space fire, C camera, U arty map; ↑/↓ ammo; 1/2 gun; RMB aim. */
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
let artilleryMapToggleQueued = false
let nvgToggleQueued = false

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

/** Aircraft: mouse = pitch/roll stick, A/D = rudder, W/S = throttle, Space = fire. */
export type FlightInput = {
  /** -1..1, positive = nose up. */
  pitch: number
  /** -1..1, positive = roll right. */
  roll: number
  /** -1..1, positive = nose right. */
  rudder: number
  throttleUp: boolean
  throttleDown: boolean
  fire: boolean
  /** Edge-triggered: release one bomb (B). */
  dropBomb: boolean
  /** Edge-triggered: fire one wing rocket (R) — Corsair HVAR. */
  fireRocket: boolean
  /** Edge-triggered: toggle the bombsight scope (V). */
  toggleSight: boolean
  /** Edge-triggered: cut the bomb cinematic short (C). */
  skipCinematic: boolean
  /** Edge-triggered: punch out (Y). */
  eject: boolean
  /** Edge-triggered: retract / drop landing gear (G). */
  toggleGear: boolean
  /** Edge-triggered: F-16 / SAM missile fire (M). */
  fireMissile: boolean
  /** Hold/press Q: dump chaff + flare. */
  dropChaff: boolean
  /** No stick input recently — flight model auto-levels. */
  handsOff: boolean
}

/** Virtual spring-centred stick, driven by relative mouse motion. */
const STICK_SENS = 0.0042
/** Stick returns to neutral this fast (per second) once the mouse stops. */
const STICK_RETURN = 3.4
/** Below this deflection with no fresh input we consider it hands-off. */
const HANDS_OFF_DEFLECTION = 0.06

let stickPitch = 0
let stickRoll = 0
let stickMovedAt = 0
let flightBound = false
let bombQueued = false
let rocketQueued = false
let sightQueued = false
let skipCineQueued = false
let ejectQueued = false
let gearQueued = false
let missileQueued = false

export function bindFlightInput(): void {
  if (flightBound) return
  flightBound = true
  // Bomb release and the scope are edge-triggered: holding B must not dump the
  // whole rack, and the scope is a toggle.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return
    if (e.code === 'KeyB') bombQueued = true
    if (e.code === 'KeyR') rocketQueued = true
    if (e.code === 'KeyV') sightQueued = true
    if (e.code === 'KeyC') skipCineQueued = true
    if (e.code === 'KeyY') ejectQueued = true
    if (e.code === 'KeyG') gearQueued = true
    if (e.code === 'KeyM') missileQueued = true
    if (e.code === 'KeyN') nvgToggleQueued = true
  })
  window.addEventListener('pointermove', (e) => {
    if (!document.pointerLockElement) return
    // Mouse up = nose up, matching the tank's mouse-up = look-up feel.
    stickPitch -= e.movementY * STICK_SENS
    stickRoll += e.movementX * STICK_SENS
    stickPitch = Math.max(-1, Math.min(1, stickPitch))
    stickRoll = Math.max(-1, Math.min(1, stickRoll))
    stickMovedAt = performance.now()
  })
}

export function getFlightInput(dt: number): FlightInput {
  const decay = Math.pow(1 / (1 + STICK_RETURN), dt)
  stickPitch *= decay
  stickRoll *= decay

  let rudder = 0
  if (isDown('KeyD')) rudder += 1
  if (isDown('KeyA')) rudder -= 1

  const idleMs = performance.now() - stickMovedAt
  const deflection = Math.abs(stickPitch) + Math.abs(stickRoll)
  const handsOff = idleMs > 180 && deflection < HANDS_OFF_DEFLECTION && rudder === 0

  const dropBomb = bombQueued
  const fireRocket = rocketQueued
  const toggleSight = sightQueued
  const skipCinematic = skipCineQueued
  const eject = ejectQueued
  const toggleGear = gearQueued
  const fireMissile = missileQueued
  bombQueued = false
  rocketQueued = false
  sightQueued = false
  skipCineQueued = false
  ejectQueued = false
  gearQueued = false
  missileQueued = false

  return {
    pitch: stickPitch,
    roll: stickRoll,
    rudder,
    throttleUp: isDown('KeyW'),
    throttleDown: isDown('KeyS'),
    fire: isDown('Space'),
    dropBomb,
    fireRocket,
    toggleSight,
    skipCinematic,
    eject,
    toggleGear,
    fireMissile,
    dropChaff: isDown('KeyQ'),
    handsOff,
  }
}

/** Centre the stick (deploy / respawn). */
export function resetFlightInput(): void {
  stickPitch = 0
  stickRoll = 0
  stickMovedAt = 0
  bombQueued = false
  rocketQueued = false
  sightQueued = false
  skipCineQueued = false
  ejectQueued = false
  gearQueued = false
  missileQueued = false
}

/** Hold P to acquire / keep a hard lock (F-16 + SPAAG). */
export function isLockHold(): boolean {
  return isDown('KeyP')
}

/** Hold M to fire Pantsir SAMs (edge handled inside samMissiles). */
export function isSamFire(): boolean {
  return isDown('KeyM')
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

/** Edge-triggered artillery aiming map (U). */
export function consumeArtilleryMapToggle(): boolean {
  if (!artilleryMapToggleQueued) return false
  artilleryMapToggleQueued = false
  return true
}

/** Edge-triggered night-vision goggles (N). */
export function consumeNvgToggle(): boolean {
  if (!nvgToggleQueued) return false
  nvgToggleQueued = false
  return true
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
    if (e.code === 'KeyU' && !e.repeat) {
      artilleryMapToggleQueued = true
    }
    if (e.code === 'KeyN' && !e.repeat) {
      nvgToggleQueued = true
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
    artilleryMapToggleQueued = false
    nvgToggleQueued = false
  })
}
