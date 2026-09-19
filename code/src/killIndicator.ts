import './killIndicator.css'

/**
 * In-match kill feedback: running count + brief “KILL” flash.
 * Fed by scoreboard player-kill events (destruction callbacks), not polling.
 */

export type KillIndicator = {
  /** Sync count without flash (respawn / mid-match restore). */
  setKills: (n: number) => void
  /** Player scored a kill — bump count + flash. */
  noteKill: (totalKills: number) => void
  setVisible: (visible: boolean) => void
  dispose: () => void
}

const FLASH_MS = 1400

export function createKillIndicator(): KillIndicator {
  const root = document.createElement('div')
  root.className = 'kill-ind'
  root.innerHTML = `
    <div class="kill-ind-count" aria-live="polite">
      <span class="kill-ind-label">KILLS</span>
      <span class="kill-ind-num">0</span>
    </div>
    <div class="kill-ind-flash" hidden>KILL</div>
  `
  document.body.appendChild(root)

  const numEl = root.querySelector('.kill-ind-num') as HTMLElement
  const flashEl = root.querySelector('.kill-ind-flash') as HTMLElement
  let kills = 0
  let flashTimer = 0

  function paintCount(): void {
    numEl.textContent = String(kills)
  }

  function showFlash(): void {
    flashEl.hidden = false
    flashEl.classList.remove('is-pop')
    // Retrigger CSS animation.
    void flashEl.offsetWidth
    flashEl.classList.add('is-pop')
    window.clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => {
      flashEl.hidden = true
      flashEl.classList.remove('is-pop')
    }, FLASH_MS)
  }

  paintCount()

  return {
    setKills(n) {
      kills = Math.max(0, Math.floor(n))
      paintCount()
    },
    noteKill(totalKills) {
      kills = Math.max(0, Math.floor(totalKills))
      paintCount()
      root.classList.add('is-scored')
      window.setTimeout(() => root.classList.remove('is-scored'), 400)
      showFlash()
      console.info(`[Steel] Kill indicator — ${kills}`)
    },
    setVisible(visible) {
      root.style.display = visible ? '' : 'none'
    },
    dispose() {
      window.clearTimeout(flashTimer)
      root.remove()
    },
  }
}
