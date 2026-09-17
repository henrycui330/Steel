import * as THREE from 'three'
import './impactCinematic.css'

/**
 * Slow-motion tracking shot for a projectile that matters: the bomb cam on
 * release, and the kill cam for a shell that is about to destroy a tank.
 *
 * The shape is the familiar bullet-cam one — linger on the launch, skim the
 * dull middle of the flight, slow hard into the impact — but the middle is
 * solved against a *real-time budget* rather than run at a fixed multiplier.
 * Flight time varies hugely (a shell triggers with ~0.45 s left, a bomb from
 * the service ceiling falls for ~10 s), and one fixed factor would either
 * blink past or strand the player watching for ten seconds with no control.
 * Budgeting keeps every shot at roughly the same length on screen.
 */

/** A projectile the camera can ride. Position must be a live reference. */
export type TrackedProjectile = {
  /** Mutated in place as it flies — hold the reference, don't copy. */
  position: THREE.Vector3
  /** Impact solution at the moment tracking starts. */
  impact: THREE.Vector3
  /** Predicted seconds from now to impact. */
  flightTime: number
  /** False once it has detonated or been retired. */
  live: () => boolean
}

export type CinematicProfile = {
  /** Time scale just after launch, and again on the run in to impact. */
  slowIn: number
  slowOut: number
  /** Sim seconds spent at `slowIn` after launch / at `slowOut` before impact. */
  inWindow: number
  outWindow: number
  /** Sim seconds easing between a slow window and the middle. */
  blend: number
  /** Real seconds the middle of the flight should take. */
  midRealTarget: number
  /** Bounds on the solved middle multiplier. */
  fastMin: number
  fastMax: number
  /** Real seconds held on the impact before handing control back. */
  hold: number
  /** Hard bail, so a bad prediction can never trap the player. */
  maxReal: number
  /** Camera rig offsets from the projectile, in metres. */
  side: number
  rise: number
  back: number
  /**
   * Follow stiffness. Steady-state lag is roughly `speed / followLambda`, so
   * this has to scale with the projectile: a 180 u/s shell needs a far stiffer
   * follow than a bomb drifting down at 60.
   */
  followLambda: number
  fovIn: number
  fovOut: number
  /**
   * The shot looks a little past the projectile so the target stays in frame,
   * but the lead is capped in metres rather than taken purely as a fraction of
   * the distance to impact: on a high drop a proportional lead aims tens of
   * metres downrange and shoves the projectile itself out of the frustum.
   */
  lookLeadFrac: number
  lookLeadMax: number
  label: string
  hint: string
}

export const BOMB_SHOT: CinematicProfile = {
  slowIn: 0.4,
  slowOut: 0.5,
  inWindow: 0.3,
  outWindow: 0.65,
  blend: 0.18,
  midRealTarget: 0.9,
  fastMin: 1,
  fastMax: 3,
  hold: 0.6,
  maxReal: 8,
  side: 13,
  rise: 4.5,
  back: 5,
  followLambda: 6,
  fovIn: 38,
  fovOut: 58,
  lookLeadFrac: 0.25,
  lookLeadMax: 8,
  label: 'Bomb Cam',
  hint: 'C to skip',
}

/**
 * Kill cam. Tracking starts with well under a second of flight left, so there
 * is no dull middle to skip — `fastMin` below 1 keeps the whole run-in slow
 * instead of snapping back to real time between the two windows.
 */
export const KILL_SHOT: CinematicProfile = {
  slowIn: 0.25,
  slowOut: 0.3,
  inWindow: 0.12,
  outWindow: 0.2,
  blend: 0.06,
  midRealTarget: 0.6,
  fastMin: 0.28,
  fastMax: 1.2,
  hold: 1.1,
  maxReal: 5,
  // Tight rig with a short look-lead. The lead has to stay well inside the
  // camera's distance from the shell or the shell itself falls behind the view
  // — counter-intuitively, a *stiffer* follow made framing worse, because
  // sitting exactly on the rig point put the subject behind the look vector.
  side: 5,
  rise: 1.6,
  back: 2.5,
  followLambda: 10,
  fovIn: 40,
  fovOut: 58,
  lookLeadFrac: 0.5,
  lookLeadMax: 5,
  label: 'Kill Cam',
  hint: 'C to skip',
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

export type ImpactCinematic = {
  begin: (projectile: TrackedProjectile) => void
  active: () => boolean
  /** Sim time multiplier for this frame (1 when inactive). */
  timeScale: () => number
  /** Advance with **real** dt — drives the camera and the internal sim clock. */
  update: (realDt: number, camera: THREE.PerspectiveCamera) => void
  cancel: () => void
  dispose: () => void
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export type CinematicOptions = {
  heightAt: (x: number, z: number) => number
  profile: CinematicProfile
  /** Hide the normal instruments for the duration of the shot. */
  onShow?: (showing: boolean) => void
}

export function createImpactCinematic(opts: CinematicOptions): ImpactCinematic {
  const { heightAt, profile: p, onShow } = opts

  const overlay = document.createElement('div')
  overlay.className = 'impactcam'
  overlay.innerHTML = `
    <div class="impactcam-bar top"></div>
    <div class="impactcam-bar bottom"></div>
    <div class="impactcam-slate">
      <span class="impactcam-dot"></span>
      <span class="impactcam-label"></span>
      <span class="impactcam-hint"></span>
    </div>`
  overlay.querySelector<HTMLElement>('.impactcam-label')!.textContent = p.label
  overlay.querySelector<HTMLElement>('.impactcam-hint')!.textContent = p.hint
  overlay.style.display = 'none'
  document.body.appendChild(overlay)

  let shot: TrackedProjectile | null = null
  let phase: 'flight' | 'hold' | 'idle' = 'idle'
  let simElapsed = 0
  let realElapsed = 0
  let holdElapsed = 0
  /**
   * The first frame cuts to the shot instead of lerping in. Easing over from
   * the previous camera position leaves the projectile out of frame for the
   * opening beat, and a cut is the right cinematic language regardless.
   */
  let cut = true
  let flightTime = 1
  let scale = 1
  /** Time-curve anchors in sim seconds, solved when tracking starts. */
  let inWin = p.inWindow
  let outWin = p.outWindow
  let blend = p.blend
  let midScale = 1

  const side = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const impact = new THREE.Vector3()
  const blastAt = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const look = new THREE.Vector3()
  const toImpact = new THREE.Vector3()

  function begin(next: TrackedProjectile): void {
    overlay.style.display = ''
    // Force a reflow so the bars animate in rather than snapping.
    void overlay.offsetHeight
    overlay.classList.add('in')
    onShow?.(true)

    shot = next
    phase = 'flight'
    cut = true
    scale = p.slowIn
    simElapsed = 0
    realElapsed = 0
    holdElapsed = 0
    flightTime = Math.max(next.flightTime, 0.12)
    impact.copy(next.impact)

    // A short flight can't afford the full slow windows, so squeeze them.
    const span = p.inWindow + p.outWindow + p.blend * 2
    const squeeze = flightTime < span ? flightTime / span : 1
    inWin = p.inWindow * squeeze
    outWin = p.outWindow * squeeze
    blend = p.blend * squeeze
    const midSim = Math.max(0, flightTime - inWin - outWin - blend * 2)
    midScale = THREE.MathUtils.clamp(midSim / p.midRealTarget, p.fastMin, p.fastMax)

    // Frame the shot from a fixed side axis chosen up front, so the camera
    // doesn't orbit the projectile while it flies.
    forward.copy(impact).sub(next.position)
    forward.y = 0
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, 1)
    forward.normalize()
    side.crossVectors(WORLD_UP, forward).normalize()
  }

  function progress(): number {
    return THREE.MathUtils.clamp(simElapsed / flightTime, 0, 1)
  }

  function computeScale(): number {
    if (phase === 'idle') return 1
    if (phase === 'hold') {
      // Ease back to real time as we let go.
      return THREE.MathUtils.lerp(p.slowOut, 1, smoothstep(0, p.hold, holdElapsed))
    }
    const t = simElapsed
    const outStart = flightTime - outWin
    if (t < inWin) return p.slowIn
    if (t < inWin + blend) {
      return THREE.MathUtils.lerp(p.slowIn, midScale, smoothstep(inWin, inWin + blend, t))
    }
    if (t < outStart - blend) return midScale
    if (t < outStart) {
      return THREE.MathUtils.lerp(
        midScale,
        p.slowOut,
        smoothstep(outStart - blend, outStart, t),
      )
    }
    // Overrun: the prediction said it should have hit by now. Ease back to real
    // time so a bad solution can't sit the player in slow motion.
    if (t > flightTime) {
      return THREE.MathUtils.lerp(p.slowOut, 1, smoothstep(flightTime, flightTime + 0.6, t))
    }
    return p.slowOut
  }

  function frameShot(
    target: THREE.Vector3,
    pull: number,
    realDt: number,
    cam: THREE.PerspectiveCamera,
  ): void {
    goal.copy(target)
    goal.addScaledVector(side, p.side * pull)
    goal.addScaledVector(forward, -p.back * pull)
    goal.y += p.rise * pull

    // Never let the shot sink into the ground.
    const floor = heightAt(goal.x, goal.z) + 2.5
    if (goal.y < floor) goal.y = floor

    if (cut) {
      cam.position.copy(goal)
      cut = false
    } else {
      cam.position.lerp(goal, 1 - Math.exp(-p.followLambda * realDt))
    }
    cam.up.copy(WORLD_UP)
    cam.lookAt(look)
    cam.updateProjectionMatrix()
  }

  function cancel(): void {
    if (phase !== 'idle') onShow?.(false)
    overlay.classList.remove('in')
    overlay.style.display = 'none'
    shot = null
    phase = 'idle'
    scale = 1
  }

  return {
    begin,
    active: () => phase !== 'idle',
    timeScale: () => scale,
    update(realDt, camera) {
      if (phase === 'idle' || !shot) return

      realElapsed += realDt
      if (realElapsed > p.maxReal) {
        cancel()
        return
      }

      if (phase === 'flight') {
        simElapsed += realDt * scale
        if (!shot.live()) {
          // Detonated (or retired): hold on the impact.
          phase = 'hold'
          blastAt.copy(shot.position)
        }
      } else {
        holdElapsed += realDt
        if (holdElapsed >= p.hold) {
          cancel()
          return
        }
      }

      scale = computeScale()

      // FOV is set before framing, since frameShot refreshes the projection.
      if (phase === 'flight') {
        camera.fov = THREE.MathUtils.lerp(p.fovIn, p.fovOut, progress())
        toImpact.copy(impact).sub(shot.position)
        const lead = Math.min(toImpact.length() * p.lookLeadFrac, p.lookLeadMax)
        look.copy(shot.position).addScaledVector(toImpact.normalize(), lead)
        frameShot(shot.position, 1, realDt, camera)
      } else {
        camera.fov = p.fovOut
        look.copy(blastAt)
        const out = 1 + smoothstep(0, p.hold, holdElapsed) * 0.9
        frameShot(blastAt, out, realDt, camera)
      }
    },
    cancel,
    dispose() {
      cancel()
      overlay.remove()
    },
  }
}
