import * as THREE from 'three'

/** |speed| below this ⇒ artillery can deploy / open map. */
export const ARTILLERY_DEPLOY_SPEED = 0.7

export type ArtilleryHudState = {
  active: boolean
  deployed: boolean
  mapOpen: boolean
  /** True when a map click aim point is set. */
  hasAim: boolean
  status: string
}

export type ArtilleryMapBlip = {
  x: number
  z: number
  alive: boolean
  id: string
}

export type ArtilleryAimPoint = {
  x: number
  z: number
}

export type ArtilleryController = {
  isDeployed: () => boolean
  isMapOpen: () => boolean
  /** World XZ aim point from map click, or null. */
  getAimPoint: () => ArtilleryAimPoint | null
  clearAimPoint: () => void
  /** Sync deploy from speed; clears map + aim if moving. */
  update: (speedAbs: number) => void
  toggleMap: () => void
  setMapOpen: (open: boolean) => void
  getHud: () => ArtilleryHudState
  syncMap: (player: THREE.Vector3, enemies: ArtilleryMapBlip[]) => void
  dispose: () => void
}

type CreateOpts = {
  arenaSize?: number
  arenaSizeX?: number
  arenaSizeZ?: number
  canvas: HTMLElement
}

/**
 * PzH helper: stop-to-deploy + location map (U).
 * Click the map to set a ground aim point — no enemy lock / ballistic loft.
 */
export function createArtilleryController(opts: CreateOpts): ArtilleryController {
  const { canvas } = opts
  const sizeX = opts.arenaSizeX ?? opts.arenaSize ?? 150
  const sizeZ = opts.arenaSizeZ ?? opts.arenaSize ?? sizeX
  const halfX = sizeX / 2
  const halfZ = sizeZ / 2
  const aspect = sizeX / sizeZ
  const svgH = 320
  const svgW = Math.max(100, Math.round(svgH * aspect))

  let deployed = false
  let mapOpen = false
  let aimPoint: ArtilleryAimPoint | null = null

  const overlay = document.createElement('div')
  overlay.id = 'arty-map'
  overlay.hidden = true
  overlay.innerHTML = `
    <div class="arty-map-panel">
      <p class="arty-map-title">Location map · <kbd>U</kbd> close · click to aim · stop to deploy</p>
      <svg class="arty-map-svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" aria-label="Location map">
        <rect class="arty-map-arena" x="0" y="0" width="${svgW}" height="${svgH}" />
        <g class="arty-map-enemies"></g>
        <circle class="arty-map-player" r="7" />
        <circle class="arty-map-aim" r="8" hidden />
        <circle class="arty-map-cursor" r="5" hidden />
      </svg>
      <p class="arty-map-hint" data-hint>Click anywhere to set aim location</p>
    </div>
  `
  document.body.appendChild(overlay)

  const svg = overlay.querySelector('.arty-map-svg') as SVGSVGElement
  const enemiesG = overlay.querySelector('.arty-map-enemies') as SVGGElement
  const playerEl = overlay.querySelector('.arty-map-player') as SVGCircleElement
  const aimEl = overlay.querySelector('.arty-map-aim') as SVGCircleElement
  const cursorEl = overlay.querySelector('.arty-map-cursor') as SVGCircleElement
  const hintEl = overlay.querySelector('[data-hint]') as HTMLParagraphElement

  function worldToSvg(x: number, z: number): { cx: number; cy: number } {
    return {
      cx: ((x + halfX) / sizeX) * svgW,
      cy: ((halfZ - z) / sizeZ) * svgH,
    }
  }

  function svgToWorld(cx: number, cy: number): ArtilleryAimPoint {
    return {
      x: (cx / svgW) * sizeX - halfX,
      z: halfZ - (cy / svgH) * sizeZ,
    }
  }

  function clearAimPoint(): void {
    if (!aimPoint) return
    aimPoint = null
    aimEl.setAttribute('hidden', '')
    hintEl.textContent = 'Click anywhere to set aim location'
    console.info('[Steel] Artillery aim point CLEARED')
  }

  function setAimFromSvg(cx: number, cy: number): void {
    const clamped = {
      cx: THREE.MathUtils.clamp(cx, 0, svgW),
      cy: THREE.MathUtils.clamp(cy, 0, svgH),
    }
    aimPoint = svgToWorld(clamped.cx, clamped.cy)
    aimEl.removeAttribute('hidden')
    aimEl.setAttribute('cx', String(clamped.cx))
    aimEl.setAttribute('cy', String(clamped.cy))
    hintEl.textContent = `Aim set · close map (U) · gun turns toward mark`
    console.info(
      `[Steel] Artillery aim @ (${aimPoint.x.toFixed(1)}, ${aimPoint.z.toFixed(1)})`,
    )
  }

  function refreshAimMarker(): void {
    if (!aimPoint) {
      aimEl.setAttribute('hidden', '')
      return
    }
    const c = worldToSvg(aimPoint.x, aimPoint.z)
    aimEl.removeAttribute('hidden')
    aimEl.setAttribute('cx', String(c.cx))
    aimEl.setAttribute('cy', String(c.cy))
  }

  function setMapOpen(open: boolean): void {
    if (open && !deployed) {
      console.info('[Steel] Artillery map: need to stop first')
      return
    }
    if (mapOpen === open) return
    mapOpen = open
    overlay.hidden = !open
    document.body.classList.toggle('arty-map-open', open)
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock()
      refreshAimMarker()
      hintEl.textContent = aimPoint
        ? `Aim set · click to move mark · U close`
        : `Click anywhere to set aim location`
      console.info('[Steel] Artillery map OPEN')
    } else {
      cursorEl.setAttribute('hidden', '')
      void canvas.requestPointerLock()
      console.info('[Steel] Artillery map CLOSED')
    }
  }

  svg.addEventListener('mousemove', (ev) => {
    if (!mapOpen) return
    const rect = svg.getBoundingClientRect()
    const mx = ((ev.clientX - rect.left) / rect.width) * svgW
    const my = ((ev.clientY - rect.top) / rect.height) * svgH
    cursorEl.removeAttribute('hidden')
    cursorEl.setAttribute('cx', String(mx))
    cursorEl.setAttribute('cy', String(my))
  })

  svg.addEventListener('mouseleave', () => {
    cursorEl.setAttribute('hidden', '')
  })

  svg.addEventListener('click', (ev) => {
    if (!mapOpen || !deployed) return
    const rect = svg.getBoundingClientRect()
    const mx = ((ev.clientX - rect.left) / rect.width) * svgW
    const my = ((ev.clientY - rect.top) / rect.height) * svgH
    setAimFromSvg(mx, my)
  })

  return {
    isDeployed: () => deployed,
    isMapOpen: () => mapOpen,
    getAimPoint: () => aimPoint,
    clearAimPoint,
    update(speedAbs) {
      const next = speedAbs < ARTILLERY_DEPLOY_SPEED
      if (deployed === next) return
      if (!next) {
        deployed = false
        clearAimPoint()
        setMapOpen(false)
        console.info('[Steel] Artillery undeployed (moving)')
        return
      }
      deployed = true
      console.info('[Steel] Artillery DEPLOYED')
    },
    toggleMap() {
      if (mapOpen) setMapOpen(false)
      else setMapOpen(true)
    },
    setMapOpen,
    getHud() {
      let status = '—'
      if (!deployed) status = 'STOP TO DEPLOY'
      else if (mapOpen) status = 'MAP · click aim'
      else if (aimPoint) status = 'AIM SET'
      else status = 'DEPLOYED · U map'
      return {
        active: true,
        deployed,
        mapOpen,
        hasAim: !!aimPoint,
        status,
      }
    },
    syncMap(player, enemies) {
      if (!mapOpen) return
      const p = worldToSvg(player.x, player.z)
      playerEl.setAttribute('cx', String(p.cx))
      playerEl.setAttribute('cy', String(p.cy))
      refreshAimMarker()

      const living = enemies.filter((e) => e.alive)
      while (enemiesG.childNodes.length > living.length) {
        enemiesG.removeChild(enemiesG.lastChild!)
      }
      living.forEach((e, i) => {
        let el = enemiesG.children[i] as SVGCircleElement | undefined
        if (!el) {
          el = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          el.setAttribute('r', '6')
          el.classList.add('arty-map-enemy')
          enemiesG.appendChild(el)
        }
        const c = worldToSvg(e.x, e.z)
        el.setAttribute('cx', String(c.cx))
        el.setAttribute('cy', String(c.cy))
        el.dataset.id = e.id
        el.classList.remove('is-hover', 'is-locked')
      })
    },
    dispose() {
      clearAimPoint()
      setMapOpen(false)
      overlay.remove()
      document.body.classList.remove('arty-map-open')
    },
  }
}
