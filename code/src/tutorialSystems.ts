/**
 * Interactive Advanced — Systems coach (Tutorial 3).
 * NVG · lock-on · ATGM.
 */

export type SystemsTutorialCtx = {
  dt: number
  nvgOn: boolean
  lockPhase: 'idle' | 'soft' | 'acquiring' | 'hard'
  weapon: 'main' | 'mg' | 'atgm'
  atgmAmmo: number
  /** True the frame an ATGM left the rail. */
  atgmFired: boolean
  dummyAlive: boolean
  dummyDistM: number | null
}

export type SystemsTutorialHandle = {
  update: (ctx: SystemsTutorialCtx) => void
  isComplete: () => boolean
  dispose: () => void
}

type StepId =
  | 'welcome'
  | 'nvg'
  | 'lock'
  | 'atgm'
  | 'fire'
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
    title: 'Advanced — Systems',
    body: 'Night range. Learn NVG, radar lock, then pickle an ATGM into the practice panzer.',
    hint: 'Click Start, then click the game to capture the mouse.',
  },
  {
    id: 'nvg',
    title: 'Night vision',
    body: 'It’s dark out here. Press N to flip the tubes on — green phosphor, brighter scene.',
    hint: 'N = NVG toggle',
  },
  {
    id: 'lock',
    title: 'Hard lock',
    body: 'Aim at the gold practice panzer ahead. Hold P until the diamond fills and you get a hard lock.',
    hint: 'P = hold lock · aim center mass',
  },
  {
    id: 'atgm',
    title: 'Select ATGM',
    body: 'Press 3 to arm the missile slot (TOW / Shillelagh / Konkurs — whatever this chassis carries).',
    hint: '3 = ATGM · 1 = main · 2 = MG',
  },
  {
    id: 'fire',
    title: 'Fire ATGM',
    body: 'With a lock (or a clean shot), press M or left-click to launch. Kill the practice panzer.',
    hint: 'M / LMB = fire missile',
  },
  {
    id: 'done',
    title: 'Lesson complete',
    body: 'You can run NVG, hold a lock, and fire ATGMs. Take these into Skirmish / KOTH.',
    hint: 'Return to hangar when ready.',
  },
]

export function createSystemsTutorial(opts: {
  onEnterLock?: () => void
  onComplete: () => void
}): SystemsTutorialHandle {
  const root = document.createElement('div')
  root.className = 'tutor-root'
  root.innerHTML = `
    <div class="tutor-card">
      <p class="tutor-kicker">Tutorial 3</p>
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
  let awaitingPrimary = true
  let sawLiveTarget = false

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
    console.info('[Steel] Tutorial 3 (Advanced — Systems) complete')
    opts.onComplete()
  }

  function advance(): void {
    if (stepIndex >= STEPS.length - 1) {
      finish()
      return
    }
    stepIndex += 1
    sawLiveTarget = false
    console.info(`[Steel] Systems tutorial step → ${current().id}`)
    render()
    if (current().id === 'lock') opts.onEnterLock?.()
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

      if (s.id === 'nvg') {
        hintEl.textContent = ctx.nvgOn
          ? 'Tubes on — green world'
          : 'N = NVG toggle'
        if (ctx.nvgOn) advance()
        return
      }
      if (s.id === 'lock') {
        const dist =
          ctx.dummyDistM != null ? ` · panzer ${ctx.dummyDistM.toFixed(0)} m` : ''
        hintEl.textContent =
          ctx.lockPhase === 'hard'
            ? 'LOCKED'
            : ctx.lockPhase === 'acquiring'
              ? `Acquiring… hold P${dist}`
              : ctx.lockPhase === 'soft'
                ? `Soft track — hold P${dist}`
                : `Aim at the gold panzer · hold P${dist}`
        if (ctx.lockPhase === 'hard') advance()
        return
      }
      if (s.id === 'atgm') {
        hintEl.textContent =
          ctx.weapon === 'atgm' ? 'ATGM armed' : 'Press 3 for ATGM'
        if (ctx.weapon === 'atgm') advance()
        return
      }
      if (s.id === 'fire') {
        if (ctx.dummyAlive) sawLiveTarget = true
        if (sawLiveTarget && !ctx.dummyAlive) {
          advance()
          return
        }
        if (ctx.weapon !== 'atgm') {
          hintEl.textContent = 'Press 3 to re-select ATGM'
          return
        }
        if (ctx.atgmFired) {
          hintEl.textContent = 'Missile away — wait for impact'
          return
        }
        hintEl.textContent =
          ctx.lockPhase === 'hard'
            ? 'M / LMB = fire · stay locked'
            : 'Re-lock (P) if needed · M / LMB = fire'
      }
    },
    isComplete: () => complete,
    dispose() {
      root.remove()
    },
  }
}
