import * as THREE from 'three'

export type NvgSystem = {
  /** True while the green tube is on. */
  enabled: () => boolean
  setEnabled: (on: boolean) => void
  toggle: () => boolean
  dispose: () => void
}

type LightSnap = {
  ambientColor: THREE.Color
  ambientIntensity: number
  hemiColor: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  sunColor: THREE.Color
  sunIntensity: number
  clear: number
  fogColor: THREE.Color | null
  fogDensity: number | null
  exposure: number
}

/**
 * Night-vision goggles — green phosphor overlay + boosted moonlit scene.
 * Only armed on night missions (day toggle is a no-op).
 */
export function createNvg(opts: {
  night: boolean
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  lights: {
    ambient: THREE.AmbientLight
    hemi: THREE.HemisphereLight
    sun: THREE.DirectionalLight
  }
}): NvgSystem {
  const { night, scene, renderer, lights } = opts
  let on = false
  let snap: LightSnap | null = null

  const overlay = document.createElement('div')
  overlay.id = 'nvg-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.innerHTML =
    '<div class="nvg-phosphor"></div><div class="nvg-scan"></div><div class="nvg-vignette"></div><div class="nvg-badge">NVG</div>'
  document.body.appendChild(overlay)

  function capture(): LightSnap {
    const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : null
    return {
      ambientColor: lights.ambient.color.clone(),
      ambientIntensity: lights.ambient.intensity,
      hemiColor: lights.hemi.color.clone(),
      hemiGround: lights.hemi.groundColor.clone(),
      hemiIntensity: lights.hemi.intensity,
      sunColor: lights.sun.color.clone(),
      sunIntensity: lights.sun.intensity,
      clear: renderer.getClearColor(new THREE.Color()).getHex(),
      fogColor: fog ? fog.color.clone() : null,
      fogDensity: fog ? fog.density : null,
      exposure: renderer.toneMappingExposure,
    }
  }

  function applyOn(): void {
    if (!snap) snap = capture()
    // Bright green-biased moonlight — readable without nuking contrast.
    lights.ambient.color.setHex(0x6aff8a)
    lights.ambient.intensity = Math.max(snap.ambientIntensity, 0.55)
    lights.hemi.color.setHex(0x88ffaa)
    lights.hemi.groundColor.setHex(0x142818)
    lights.hemi.intensity = Math.max(snap.hemiIntensity, 0.5)
    lights.sun.color.setHex(0xb8ffd0)
    lights.sun.intensity = Math.max(snap.sunIntensity, 0.75)
    renderer.setClearColor(0x041208, 1)
    renderer.toneMappingExposure = Math.max(snap.exposure, 1.35)
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.setHex(0x06180c)
      // See farther through the night fog with intensifier tubes.
      scene.fog.density = Math.min(scene.fog.density, 0.0009)
    }
    overlay.classList.add('is-on')
    document.body.classList.add('nvg-on')
  }

  function applyOff(): void {
    if (!snap) return
    lights.ambient.color.copy(snap.ambientColor)
    lights.ambient.intensity = snap.ambientIntensity
    lights.hemi.color.copy(snap.hemiColor)
    lights.hemi.groundColor.copy(snap.hemiGround)
    lights.hemi.intensity = snap.hemiIntensity
    lights.sun.color.copy(snap.sunColor)
    lights.sun.intensity = snap.sunIntensity
    renderer.setClearColor(snap.clear, 1)
    renderer.toneMappingExposure = snap.exposure
    if (scene.fog instanceof THREE.FogExp2 && snap.fogColor && snap.fogDensity != null) {
      scene.fog.color.copy(snap.fogColor)
      scene.fog.density = snap.fogDensity
    }
    overlay.classList.remove('is-on')
    document.body.classList.remove('nvg-on')
  }

  return {
    enabled: () => on,
    setEnabled(next) {
      if (!night) {
        if (on) {
          on = false
          applyOff()
        }
        return
      }
      if (next === on) return
      on = next
      if (on) applyOn()
      else applyOff()
      console.info(`[Steel] NVG ${on ? 'ON' : 'OFF'}`)
    },
    toggle() {
      if (!night) {
        console.info('[Steel] NVG — night missions only')
        return false
      }
      this.setEnabled(!on)
      return on
    },
    dispose() {
      if (on) applyOff()
      on = false
      overlay.remove()
      document.body.classList.remove('nvg-on')
    },
  }
}
