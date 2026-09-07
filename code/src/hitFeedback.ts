import * as THREE from 'three'

/** Short on-screen combat floaters for pen / ricochet / kill. */

export type HitBannerKind = 'ricochet' | 'stopped' | 'pen' | 'blast' | 'crit' | 'kill'

const COLORS: Record<HitBannerKind, string> = {
  ricochet: '#d4d4d4',
  stopped: '#c4a35a',
  pen: '#e8ece6',
  blast: '#e09a5a',
  crit: '#ff6b3d',
  kill: '#ff3344',
}

let root: HTMLDivElement | null = null

function ensureRoot(): HTMLDivElement {
  if (root) return root
  root = document.createElement('div')
  root.id = 'hit-feedback'
  root.setAttribute('aria-hidden', 'true')
  document.body.appendChild(root)
  return root
}

/** Spawn a fading combat label at a screen position (CSS px). */
export function showHitBanner(
  text: string,
  kind: HitBannerKind,
  screenX: number,
  screenY: number,
): void {
  const host = ensureRoot()
  const el = document.createElement('div')
  el.className = `hit-banner hit-banner-${kind}`
  el.textContent = text
  el.style.color = COLORS[kind]
  el.style.left = `${screenX}px`
  el.style.top = `${screenY}px`
  host.appendChild(el)
  requestAnimationFrame(() => el.classList.add('is-on'))
  window.setTimeout(() => {
    el.classList.add('is-off')
    window.setTimeout(() => el.remove(), 350)
  }, 900)
}

export function worldToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number; visible: boolean } {
  const v = world.clone().project(camera)
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    visible: v.z > -1 && v.z < 1,
  }
}
