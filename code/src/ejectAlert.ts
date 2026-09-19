import './ejectAlert.css'

/** Arming delay before the seat fires — procedural, not instant arcade. */
const ARM_SEC = 2.2

export type EjectAlert = {
  /** Start the arming banner + countdown. No-op if already arming. */
  arm: () => boolean
  /** True while waiting for the seat to fire. */
  active: () => boolean
  /** Tick countdown; returns true the frame the seat should fire. */
  update: (dt: number) => boolean
  /** Hide + reset (crash / cancel). */
  cancel: () => void
  dispose: () => void
}

/**
 * Cockpit-style eject arming caution between Y and the seat cinematic.
 */
export function createEjectAlert(): EjectAlert {
  const root = document.createElement('div')
  root.id = 'eject-alert'
  root.setAttribute('aria-live', 'assertive')
  root.innerHTML = `
    <div class="ej-veil" aria-hidden="true"></div>
    <div class="ej-panel">
      <div class="ej-rail">
        <span class="ej-lamp" aria-hidden="true"></span>
        <p class="ej-rail-label">Master caution</p>
      </div>
      <p class="ej-title">Eject seat armed</p>
      <p class="ej-sub">Manual sequence · do not restrain</p>
      <div class="ej-seq" aria-hidden="true">
        <span class="ej-step" data-i="0">1 Canopy unlock</span><span class="ej-stat" data-i="0">—</span>
        <span class="ej-step" data-i="1">2 Seat rails</span><span class="ej-stat" data-i="1">—</span>
        <span class="ej-step" data-i="2">3 Rocket motor</span><span class="ej-stat" data-i="2">—</span>
      </div>
      <div class="ej-count-row">
        <p class="ej-count-label">Time to fire</p>
        <p class="ej-count">T−2.2</p>
      </div>
    </div>
  `
  document.body.appendChild(root)
  const countEl = root.querySelector('.ej-count') as HTMLElement
  const steps = [...root.querySelectorAll<HTMLElement>('.ej-step')]
  const stats = [...root.querySelectorAll<HTMLElement>('.ej-stat')]

  let arming = false
  let left = 0

  function syncSequence(u: number): void {
    const phase = u < 0.33 ? 0 : u < 0.66 ? 1 : 2
    for (let i = 0; i < 3; i++) {
      steps[i]?.classList.toggle('is-live', i === phase)
      const st = stats[i]
      if (!st) continue
      if (i < phase) {
        st.textContent = 'OK'
        st.classList.add('is-live')
      } else if (i === phase) {
        st.textContent = '…'
        st.classList.add('is-live')
      } else {
        st.textContent = '—'
        st.classList.remove('is-live')
      }
    }
  }

  function hide(): void {
    root.classList.remove('is-on')
    arming = false
    left = 0
  }

  return {
    arm() {
      if (arming) return false
      arming = true
      left = ARM_SEC
      countEl.textContent = `T−${left.toFixed(1)}`
      syncSequence(0)
      root.classList.add('is-on')
      console.info(`[Steel] Ejection armed — ${ARM_SEC.toFixed(1)}s`)
      return true
    },
    active: () => arming,
    update(dt) {
      if (!arming) return false
      left = Math.max(0, left - dt)
      const u = 1 - left / ARM_SEC
      countEl.textContent = `T−${left.toFixed(1)}`
      syncSequence(u)
      if (left > 0) return false
      hide()
      return true
    },
    cancel() {
      if (!arming) return
      hide()
      console.info('[Steel] Ejection arm cancelled')
    },
    dispose() {
      hide()
      root.remove()
    },
  }
}
