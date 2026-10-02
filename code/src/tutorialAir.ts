/**
 * Interactive Basics — Air coach (Tutorial 2).
 * Fly · bank · guns · bombs · eject.
 */

export type AirTutorialCtx = {
  dt: number
  speed: number
  throttle: number
  agl: number
  bankDeg: number
  firing: boolean
  bombDropped: boolean
  bombsLeft: number
  ejectArmed: boolean
  ejected: boolean
}

export type AirTutorialHandle = {
  update: (ctx: AirTutorialCtx) => void
  /** True while on the eject step (bailOut should complete the lesson). */
  awaitingEject: () => boolean
  /** Call when the eject seat has fired / cinematic started. */
  noteEject: () => void
  isComplete: () => boolean
  dispose: () => void
}

type StepId =
  | 'welcome'
  | 'throttle'
  | 'climb'
  | 'bank'
  | 'guns'
  | 'bombs'
  | 'eject'
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
    title: 'Basics — Air',
    body: 'Flight range. Learn throttle, climb, bank, guns, bombs, then punch out.',
    hint: 'Click Start, then click the game to capture the mouse.',
  },
  {
    id: 'throttle',
    title: 'Throttle up',
    body: 'Hold W to add power. Reach a solid cruise (~70 m/s). S cuts throttle.',
    hint: 'W = throttle up · S = throttle down',
  },
  {
    id: 'climb',
    title: 'Climb',
    body: 'Pull the nose up (mouse back / stick aft) and gain altitude. Get above ~90 m AGL.',
    hint: 'Mouse pitch · keep airspeed — don’t stall',
  },
  {
    id: 'bank',
    title: 'Bank to turn',
    body: 'Roll left or right with the mouse. Hit about 40° of bank.',
    hint: 'Mouse roll · A/D = rudder',
  },
  {
    id: 'guns',
    title: 'Guns',
    body: 'A gold-marked practice panzer sits on the deck ahead. Dive in and hose it with Space.',
    hint: 'Space = fire · watch the tracers',
  },
  {
    id: 'bombs',
    title: 'Drop a bomb',
    body: 'Press B to pickle one off. Optional: V toggles the bombsight.',
    hint: 'B = bomb · V = bombsight',
  },
  {
    id: 'eject',
    title: 'Eject',
    body: 'Press Y to arm the seat, then wait for the punch-out. This ends the lesson — not a defeat.',
    hint: 'Y = eject',
  },
  {
    id: 'done',
    title: 'Lesson complete',
    body: 'You can fly, shoot, bomb, and eject. Try Advanced — Systems next for lock / NVG / ATGM.',
    hint: 'Return to hangar when ready.',
  },
]

export function createAirTutorial(opts: {
  onEnterGuns?: () => void
  onComplete: () => void
}): AirTutorialHandle {
  const root = document.createElement('div')
  root.className = 'tutor-root'
  root.innerHTML = `
    <div class="tutor-card">
      <p class="tutor-kicker">Tutorial 2</p>
      <h2 class="tutor-title"></h2>
      <p class="tutor-body"></p>
      <p class="tutor-hint"></p>
      <div class="tutor-progress"><i class="tutor-progress-fill"></i></div>
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
  const primaryBtn = root.querySelector('[data-act="primary"]') as HTMLButtonElement
  const skipBtn = root.querySelector('[data-act="skip"]') as HTMLButtonElement

  let stepIndex = 0
  let complete = false
  let gunTime = 0
  let bankOk = false
  let bombsAtStep = -1
  let awaitingPrimary = true

  function current(): StepDef {
    return STEPS[stepIndex] ?? STEPS[STEPS.length - 1]!
  }

  function render(): void {
    const s = current()
    titleEl.textContent = s.title
    bodyEl.textContent = s.body
    hintEl.textContent = s.hint
    fillEl.style.transform = `scaleX(${(stepIndex + 1) / STEPS.length})`
    root.classList.toggle('is-done', s.id === 'done')

    if (s.id === 'welcome') {
      primaryBtn.hidden = false
      primaryBtn.textContent = 'Start'
      awaitingPrimary = true
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
    console.info('[Steel] Tutorial 2 (Basics — Air) complete')
    opts.onComplete()
  }

  function advance(): void {
    if (stepIndex >= STEPS.length - 1) {
      finish()
      return
    }
    stepIndex += 1
    gunTime = 0
    bankOk = false
    bombsAtStep = -1
    console.info(`[Steel] Air tutorial step → ${current().id}`)
    render()
    if (current().id === 'guns') opts.onEnterGuns?.()
  }

  primaryBtn.addEventListener('click', () => {
    const s = current()
    if (s.id === 'welcome') {
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
      if (complete || awaitingPrimary) return
      const s = current()

      if (s.id === 'throttle') {
        hintEl.textContent = `Speed ${ctx.speed.toFixed(0)} m/s · throttle ${(ctx.throttle * 100).toFixed(0)}%`
        if (ctx.speed >= 68) advance()
        return
      }
      if (s.id === 'climb') {
        hintEl.textContent = `AGL ${ctx.agl.toFixed(0)} m · keep the nose up`
        if (ctx.agl >= 90) advance()
        return
      }
      if (s.id === 'bank') {
        if (Math.abs(ctx.bankDeg) >= 40) bankOk = true
        hintEl.textContent = `Bank ${ctx.bankDeg.toFixed(0)}° · need ±40°`
        if (bankOk) advance()
        return
      }
      if (s.id === 'guns') {
        if (ctx.firing) gunTime += ctx.dt
        hintEl.textContent = ctx.firing
          ? `Firing… ${Math.min(1.5, gunTime).toFixed(1)} / 1.5 s`
          : 'Space = fire at the gold panzer (or just hose the air)'
        if (gunTime >= 1.5) advance()
        return
      }
      if (s.id === 'bombs') {
        if (bombsAtStep < 0) bombsAtStep = ctx.bombsLeft
        if (ctx.bombDropped || ctx.bombsLeft < bombsAtStep) {
          advance()
          return
        }
        hintEl.textContent = `Bombs left ${ctx.bombsLeft} · press B`
        return
      }
      if (s.id === 'eject') {
        if (ctx.ejectArmed) hintEl.textContent = 'Seat armed — hang on…'
        else if (ctx.ejected) hintEl.textContent = 'Ejected!'
        else hintEl.textContent = 'Y = eject'
      }
    },
    awaitingEject: () => !complete && current().id === 'eject',
    noteEject() {
      if (complete) return
      if (current().id !== 'eject') {
        // Early eject — jump to eject step then finish after cinematic.
        while (current().id !== 'eject' && stepIndex < STEPS.length - 1) {
          stepIndex += 1
        }
        render()
      }
      console.info('[Steel] Air tutorial eject noted')
      advance() // eject → done
    },
    isComplete: () => complete,
    dispose() {
      root.remove()
    },
  }
}
