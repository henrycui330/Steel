import * as THREE from 'three'
import type { CameraMode } from './camera'
import { setTankCosmetics, getTankCosmetics } from './cosmetics'
import type { TankId } from './tankCatalog'
import { applyTankWrap, WRAP_OPTIONS, type WrapId } from './wraps'

export type LandTutorialCtx = {
  dt: number
  speed: number
  position: THREE.Vector3
  turnInput: number
  braking: boolean
  cameraMode: CameraMode
  cameraToggled: boolean
  dummyAlive: boolean
  /** Metres to practice panzer (null if none). */
  dummyDistM: number | null
  aiming: boolean
  fired: boolean
}

export type LandTutorialHandle = {
  update: (ctx: LandTutorialCtx) => void
  /** True after the player finishes (or skips) the tutorial. */
  isComplete: () => boolean
  dispose: () => void
}

type StepId =
  | 'welcome'
  | 'drive'
  | 'steer'
  | 'brake'
  | 'camera'
  | 'aim'
  | 'fire'
  | 'customize'
  | 'done'

type StepDef = {
  id: StepId
  title: string
  body: string
  hint: string
}

const STEPS: StepDef[] = [
  {
    id: 'welcome',
    title: 'Basics — Land',
    body: 'Interactive range. Complete each task — movement, camera effects, a live shot, then paint.',
    hint: 'Click Start, then click the game to capture the mouse.',
  },
  {
    id: 'drive',
    title: 'Drive forward',
    body: 'Hold W to throttle. Cover about 25 metres from your spawn.',
    hint: 'W = forward · S = reverse',
  },
  {
    id: 'steer',
    title: 'Steer',
    body: 'While rolling, press A or D to turn the hull.',
    hint: 'A = left · D = right',
  },
  {
    id: 'brake',
    title: 'Brake',
    body: 'Build a little speed, then hold Shift (or Ctrl) to scrub it off.',
    hint: 'Shift / Ctrl = brake',
  },
  {
    id: 'camera',
    title: 'Camera effects',
    body: 'Press C to cycle Hull → Chase → Turret views. Feel how the ride changes.',
    hint: 'C = next camera',
  },
  {
    id: 'aim',
    title: 'Aim',
    body: 'Move the mouse to traverse the turret. Hold right-mouse for the aim scope.',
    hint: 'Mouse = aim · RMB = scope',
  },
  {
    id: 'fire',
    title: 'Test fire',
    body: 'A gold beacon marks the practice Pz-III — it drops ~30 m in front of your hull when this step starts. Space to fire until it wrecks.',
    hint: 'Look for the tall gold beam · Space = fire',
  },
  {
    id: 'customize',
    title: 'Customize paint',
    body: 'Pick a wrap for this chassis. It saves for future matches.',
    hint: 'Choose a card, then Continue',
  },
  {
    id: 'done',
    title: 'Lesson complete',
    body: 'You can drive, aim, shoot, change cameras, and paint your tank. Try Basics — Air or Advanced — Systems next.',
    hint: 'Return to hangar when ready.',
  },
]

/**
 * Interactive Basics—Land coach overlay + step checks.
 */
export function createLandTutorial(opts: {
  tankId: TankId
  spawn: THREE.Vector3
  tankRoot: THREE.Object3D
  /** Ensure a live practice target exists (respawn if killed early). */
  onEnterFireStep?: () => void
  onComplete: () => void
}): LandTutorialHandle {
  const root = document.createElement('div')
  root.className = 'tutor-root'
  root.innerHTML = `
    <div class="tutor-card">
      <p class="tutor-kicker">Tutorial 1</p>
      <h2 class="tutor-title"></h2>
      <p class="tutor-body"></p>
      <p class="tutor-hint"></p>
      <div class="tutor-progress"><i class="tutor-progress-fill"></i></div>
      <div class="tutor-wraps" hidden></div>
      <div class="tutor-actions">
        <button type="button" class="tutor-btn tutor-btn-primary" data-act="primary">Start</button>
        <button type="button" class="tutor-btn" data-act="skip">Skip tutorial</button>
      </div>
    </div>
  `
  document.body.appendChild(root)

  const titleEl = root.querySelector('.tutor-title') as HTMLElement
  const bodyEl = root.querySelector('.tutor-body') as HTMLElement
  const hintEl = root.querySelector('.tutor-hint') as HTMLElement
  const fillEl = root.querySelector('.tutor-progress-fill') as HTMLElement
  const wrapsEl = root.querySelector('.tutor-wraps') as HTMLElement
  const primaryBtn = root.querySelector('[data-act="primary"]') as HTMLButtonElement
  const skipBtn = root.querySelector('[data-act="skip"]') as HTMLButtonElement

  let stepIndex = 0
  let complete = false
  let driveDist = 0
  let lastPos = opts.spawn.clone()
  let steered = false
  let brakedFromSpeed = false
  let sawSpeed = false
  let cameraHits = 0
  let aimSeconds = 0
  let fireSawAlive = false
  let fireShot = false
  let wrapPicked: WrapId | null = null
  let awaitingPrimary = true

  function current(): StepDef {
    return STEPS[stepIndex] ?? STEPS[STEPS.length - 1]!
  }

  function render(): void {
    const s = current()
    titleEl.textContent = s.title
    bodyEl.textContent = s.body
    hintEl.textContent = s.hint
    fillEl.style.transform = `scaleX(${(stepIndex + (awaitingPrimary && s.id !== 'welcome' ? 0 : 1)) / STEPS.length})`
    wrapsEl.hidden = s.id !== 'customize'
    root.classList.toggle('is-customize', s.id === 'customize')
    root.classList.toggle('is-done', s.id === 'done')

    if (s.id === 'welcome') {
      primaryBtn.hidden = false
      primaryBtn.textContent = 'Start'
      awaitingPrimary = true
    } else if (s.id === 'customize') {
      primaryBtn.hidden = false
      primaryBtn.textContent = 'Continue'
      primaryBtn.disabled = !wrapPicked
      awaitingPrimary = true
      document.exitPointerLock()
      if (!wrapsEl.dataset.built) {
        wrapsEl.dataset.built = '1'
        for (const w of WRAP_OPTIONS) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'tutor-wrap-card'
          btn.dataset.wrap = w.id
          const thumb = w.url
            ? `<img src="${w.url}" alt="" />`
            : `<span class="tutor-wrap-stock">Stock</span>`
          btn.innerHTML = `${thumb}<span>${w.name}</span>`
          btn.addEventListener('click', () => {
            void (async () => {
              wrapPicked = w.id
              wrapsEl.querySelectorAll('.tutor-wrap-card').forEach((el) => {
                el.classList.toggle('is-selected', (el as HTMLElement).dataset.wrap === w.id)
              })
              setTankCosmetics(opts.tankId, { wrapId: w.id })
              await applyTankWrap(opts.tankRoot, w.id)
              primaryBtn.disabled = false
              console.info(`[Steel] Tutorial wrap → ${w.id}`)
            })()
          })
          wrapsEl.appendChild(btn)
        }
        const cur = getTankCosmetics(opts.tankId).wrapId
        wrapsEl.querySelector(`[data-wrap="${cur}"]`)?.classList.add('is-selected')
      }
    } else if (s.id === 'done') {
      primaryBtn.hidden = false
      primaryBtn.textContent = 'Back to hangar'
      primaryBtn.disabled = false
      awaitingPrimary = true
      skipBtn.hidden = true
    } else {
      primaryBtn.hidden = true
      awaitingPrimary = false
    }
  }

  function finish(): void {
    if (complete) return
    complete = true
    console.info('[Steel] Tutorial 1 (Basics — Land) complete')
    opts.onComplete()
  }

  function advance(): void {
    if (stepIndex >= STEPS.length - 1) {
      finish()
      return
    }
    stepIndex += 1
    driveDist = 0
    steered = false
    brakedFromSpeed = false
    sawSpeed = false
    cameraHits = 0
    aimSeconds = 0
    fireSawAlive = false
    fireShot = false
    lastPos.copy(opts.spawn)
    console.info(`[Steel] Tutorial step → ${current().id}`)
    render()
    if (current().id === 'fire') {
      // Don't complete from a panzer killed during aim — respawn if needed.
      opts.onEnterFireStep?.()
    }
  }

  primaryBtn.addEventListener('click', () => {
    const s = current()
    if (s.id === 'welcome') {
      advance()
      return
    }
    if (s.id === 'customize') {
      if (!wrapPicked) return
      advance()
      return
    }
    if (s.id === 'done') {
      finish()
      window.location.reload()
    }
  })

  skipBtn.addEventListener('click', () => {
    stepIndex = STEPS.length - 1
    render()
    finish()
    window.location.reload()
  })

  render()

  return {
    update(ctx) {
      if (complete) return
      const s = current()
      if (s.id === 'welcome' || s.id === 'customize' || s.id === 'done') return

      const dx = ctx.position.x - lastPos.x
      const dz = ctx.position.z - lastPos.z
      const stepDist = Math.hypot(dx, dz)
      if (stepDist < 8) driveDist += stepDist
      lastPos.copy(ctx.position)

      if (s.id === 'drive') {
        fillEl.style.transform = `scaleX(${Math.min(1, driveDist / 25) * ((stepIndex + 1) / STEPS.length)})`
        if (driveDist >= 25) advance()
        return
      }
      if (s.id === 'steer') {
        if (Math.abs(ctx.speed) > 1.2 && Math.abs(ctx.turnInput) > 0.4) steered = true
        if (steered) advance()
        return
      }
      if (s.id === 'brake') {
        if (Math.abs(ctx.speed) > 4) sawSpeed = true
        if (sawSpeed && ctx.braking && Math.abs(ctx.speed) < 2.5) brakedFromSpeed = true
        if (brakedFromSpeed) advance()
        return
      }
      if (s.id === 'camera') {
        if (ctx.cameraToggled) cameraHits += 1
        hintEl.textContent = `C = next camera · switched ${cameraHits}/2 · now: ${ctx.cameraMode}`
        if (cameraHits >= 2) advance()
        return
      }
      if (s.id === 'aim') {
        if (ctx.aiming) aimSeconds += ctx.dt
        hintEl.textContent = ctx.aiming
          ? `Scope up — hold ${Math.max(0, 1.5 - aimSeconds).toFixed(1)}s more`
          : 'Hold right-mouse for the aim scope'
        if (aimSeconds >= 1.5) advance()
        return
      }
      if (s.id === 'fire') {
        if (ctx.dummyAlive) fireSawAlive = true
        const distLabel =
          ctx.dummyDistM != null ? ` · ${ctx.dummyDistM.toFixed(0)} m ahead` : ''
        if (ctx.fired) {
          fireShot = true
          hintEl.textContent = ctx.dummyAlive
            ? `Keep firing until it wrecks${distLabel}`
            : 'Target down!'
        } else if (!fireSawAlive) {
          hintEl.textContent = 'Placing panzer in front of you…'
        } else {
          hintEl.textContent = `Tall gold beacon${distLabel} · Space = fire`
        }
        // Must see it alive this step, take a shot, then wreck it (no skip if already dead).
        if (fireSawAlive && fireShot && !ctx.dummyAlive) advance()
      }
    },
    isComplete: () => complete,
    dispose() {
      root.remove()
    },
  }
}
