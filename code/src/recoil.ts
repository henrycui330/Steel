import * as THREE from 'three'

/**
 * Shot recoil: hull rock + barrel slides back along gun axis (+Z forward → −Z kick).
 * Offsets ease in, then settle.
 */
let hullTarget = 0
let hullShown = 0
let barrelPitchTarget = 0
let barrelPitchShown = 0
let slideTarget = 0
let slideShown = 0
let posKick = 0
/** Rest local Z of the pitch pivot (captured once per load). */
let barrelRestZ: number | null = null

const HULL_IMPULSE = -0.035 // ~2° nose-up
const BARREL_PITCH_IMPULSE = -0.02 // slight elevate with the slide
const SLIDE_IMPULSE = 0.32 // meters back along local −Z
const POS_IMPULSE = 0.22
const EASE_IN = 18 // how fast kick appears
const SETTLE = 3.4 // how fast target returns to 0
const SLIDE_SETTLE = 4.2 // barrel returns a bit quicker than hull
const POS_DECAY = 6

export function punchShotRecoil(): void {
  hullTarget += HULL_IMPULSE
  barrelPitchTarget += BARREL_PITCH_IMPULSE
  slideTarget += SLIDE_IMPULSE
  // Cap so spam-fire doesn’t stack absurdly
  hullTarget = THREE.MathUtils.clamp(hullTarget, -0.05, 0.02)
  barrelPitchTarget = THREE.MathUtils.clamp(barrelPitchTarget, -0.06, 0.02)
  slideTarget = Math.min(0.45, slideTarget)
  posKick = Math.min(0.35, posKick + POS_IMPULSE)
}

export function updateShotRecoil(
  dt: number,
  tank: THREE.Object3D,
  barrelPitchPivot: THREE.Object3D,
): void {
  if (barrelRestZ === null) {
    barrelRestZ = barrelPitchPivot.position.z
  }

  const ease = 1 - Math.exp(-EASE_IN * dt)
  hullShown += (hullTarget - hullShown) * ease
  barrelPitchShown += (barrelPitchTarget - barrelPitchShown) * ease
  slideShown += (slideTarget - slideShown) * ease

  const settle = Math.exp(-SETTLE * dt)
  const slideSettle = Math.exp(-SLIDE_SETTLE * dt)
  hullTarget *= settle
  barrelPitchTarget *= settle
  slideTarget *= slideSettle
  if (Math.abs(hullTarget) < 1e-4) hullTarget = 0
  if (Math.abs(barrelPitchTarget) < 1e-4) barrelPitchTarget = 0
  if (Math.abs(slideTarget) < 1e-4) slideTarget = 0
  if (Math.abs(hullShown) < 1e-4 && hullTarget === 0) hullShown = 0
  if (Math.abs(barrelPitchShown) < 1e-4 && barrelPitchTarget === 0) barrelPitchShown = 0
  if (Math.abs(slideShown) < 1e-4 && slideTarget === 0) slideShown = 0

  tank.rotation.x += hullShown
  barrelPitchPivot.rotation.x += barrelPitchShown
  // Local +Z is gun forward — slide the cradle/barrel back on fire.
  barrelPitchPivot.position.z = barrelRestZ - slideShown

  if (posKick > 1e-4) {
    const yaw = tank.rotation.y
    const step = posKick * Math.min(1, dt * POS_DECAY)
    tank.position.x -= Math.sin(yaw) * step
    tank.position.z -= Math.cos(yaw) * step
    posKick = Math.max(0, posKick - step)
  }
}

export function resetShotRecoil(): void {
  hullTarget = 0
  hullShown = 0
  barrelPitchTarget = 0
  barrelPitchShown = 0
  slideTarget = 0
  slideShown = 0
  posKick = 0
  barrelRestZ = null
}
