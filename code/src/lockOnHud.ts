import './lockOnHud.css'
import type { LockFrame } from './lockOn'

export type LockOnHud = {
  apply: (frame: LockFrame) => void
  setVisible: (visible: boolean) => void
  dispose: () => void
}

/** Screen overlay: diamond on soft/hard target + LOCKED ON banner. */
export function createLockOnHud(): LockOnHud {
  const root = document.createElement('div')
  root.className = 'lock-hud'
  root.innerHTML = `
    <div class="lock-diamond" hidden>
      <i class="lock-diamond-ring"></i>
      <i class="lock-diamond-fill"></i>
    </div>
    <div class="lock-banner" hidden>YOU ARE ON THE ENEMY RADAR!</div>
  `
  document.body.appendChild(root)

  const diamond = root.querySelector('.lock-diamond') as HTMLElement
  const fill = root.querySelector('.lock-diamond-fill') as HTMLElement
  const banner = root.querySelector('.lock-banner') as HTMLElement

  let visible = true

  function apply(frame: LockFrame): void {
    if (!visible) {
      diamond.hidden = true
      banner.hidden = true
      return
    }

    banner.hidden = !frame.lockedBanner

    if (!frame.diamond) {
      diamond.hidden = true
      return
    }

    diamond.hidden = false
    diamond.dataset.mode = frame.diamond.mode
    diamond.style.transform = `translate(${frame.diamond.x}px, ${frame.diamond.y}px) translate(-50%, -50%) rotate(45deg)`
    fill.style.transform = `scale(${0.15 + frame.diamond.acquire01 * 0.85})`
  }

  return {
    apply,
    setVisible(v) {
      visible = v
      root.style.display = v ? '' : 'none'
      if (!v) {
        diamond.hidden = true
        banner.hidden = true
      }
    },
    dispose() {
      root.remove()
    },
  }
}
