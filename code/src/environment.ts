import * as THREE from 'three'

export type TimeOfDay = 'day' | 'night'
export type Season = 'summer' | 'winter'
export type WeatherKind = 'clear' | 'rain' | 'fog'

export type EnvironmentConfig = {
  timeOfDay: TimeOfDay
  season: Season
  weather: WeatherKind
}

export type DriveWeatherMods = {
  /** Multiplies max speed / accel feel (heat + freeze). */
  mobilityMul: number
  /** 0–1 rain slip. */
  slip: number
  /** Short HUD status (empty if none). */
  status: string
}

export type EnvironmentSystem = {
  update: (dt: number, camera: THREE.Camera, speed: number, vintageCrew: boolean) => void
  getDriveMods: () => DriveWeatherMods
  dispose: () => void
}

const _rainPos = new THREE.Vector3()

/**
 * Day/night lighting, season tint, weather fog/rain, and crew/oil mobility effects
 * for vintage tanks.
 */
export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  lights: {
    ambient: THREE.AmbientLight
    hemi: THREE.HemisphereLight
    sun: THREE.DirectionalLight
  },
  config: EnvironmentConfig,
): EnvironmentSystem {
  const { timeOfDay, season, weather } = config

  let heat = 0
  let freezeLeft = 0
  let freezeCooldown = 8 + Math.random() * 10
  let status = ''

  // --- Lighting ---
  const night = timeOfDay === 'night'
  const winter = season === 'winter'
  const raining = weather === 'rain'
  const foggy = weather === 'fog'

  if (night) {
    renderer.setClearColor(0x0a0e18, 1)
    lights.ambient.color.setHex(0x3a4560)
    lights.ambient.intensity = 0.28
    lights.hemi.color.setHex(0x4a5a80)
    lights.hemi.groundColor.setHex(0x1a1814)
    lights.hemi.intensity = 0.22
    lights.sun.color.setHex(0x9eb0d8)
    lights.sun.intensity = 0.35
  } else if (winter) {
    renderer.setClearColor(raining || foggy ? 0x8a93a0 : 0xa8b4c0, 1)
    lights.ambient.color.setHex(0xc8d0dc)
    lights.ambient.intensity = raining ? 0.42 : 0.58
    lights.hemi.color.setHex(0xd0d8e4)
    lights.hemi.groundColor.setHex(0x6a7068)
    lights.hemi.intensity = 0.35
    lights.sun.color.setHex(0xe8eef6)
    lights.sun.intensity = raining || foggy ? 0.45 : 0.95
  } else {
    // summer day
    renderer.setClearColor(raining || foggy ? 0x7a8580 : 0x87a0c0, 1)
    lights.ambient.color.setHex(0xfff0d8)
    lights.ambient.intensity = raining ? 0.4 : 0.55
    lights.hemi.color.setHex(0xffe8c8)
    lights.hemi.groundColor.setHex(0x6a5a40)
    lights.hemi.intensity = 0.4
    lights.sun.color.setHex(0xffe2a8)
    lights.sun.intensity = raining || foggy ? 0.55 : 1.15
  }

  // --- Fog / visibility ---
  let fog: THREE.FogExp2 | null = null
  if (foggy) {
    fog = new THREE.FogExp2(night ? 0x1a2030 : winter ? 0x9aa4b0 : 0x9aa890, 0.012)
  } else if (raining) {
    fog = new THREE.FogExp2(night ? 0x121820 : winter ? 0x889098 : 0x6a7870, 0.0045)
  } else if (night) {
    fog = new THREE.FogExp2(0x0a0e18, 0.0022)
  } else if (winter) {
    fog = new THREE.FogExp2(0xa8b4c0, 0.0012)
  }
  scene.fog = fog

  // --- Rain particles ---
  let rain: THREE.Points | null = null
  let rainVel: Float32Array | null = null
  if (raining) {
    const COUNT = 1400
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(COUNT * 3)
    rainVel = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60
      pos[i * 3 + 1] = Math.random() * 28
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60
      rainVel[i] = 18 + Math.random() * 14
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: winter ? 0xb0c4d8 : 0x9eb0c0,
        size: 0.08,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    )
    rain.name = 'weatherRain'
    rain.frustumCulled = false
    scene.add(rain)
  }

  console.info(
    `[Steel] Environment — ${timeOfDay}, ${season}, ${weather}` +
      (foggy ? ' (low visibility)' : '') +
      (raining ? ' (wet tracks)' : ''),
  )

  return {
    update(dt, camera, speed, vintageCrew) {
      status = ''

      // Rain follow camera
      if (rain && rainVel) {
        camera.getWorldPosition(_rainPos)
        rain.position.set(_rainPos.x, _rainPos.y, _rainPos.z)
        const attr = rain.geometry.getAttribute('position') as THREE.BufferAttribute
        const arr = attr.array as Float32Array
        for (let i = 0; i < rainVel.length; i++) {
          arr[i * 3 + 1] -= rainVel[i] * dt
          if (arr[i * 3 + 1] < -2) {
            arr[i * 3] = (Math.random() - 0.5) * 60
            arr[i * 3 + 1] = 8 + Math.random() * 22
            arr[i * 3 + 2] = (Math.random() - 0.5) * 60
          }
        }
        attr.needsUpdate = true
      }

      if (!vintageCrew) {
        heat = Math.max(0, heat - dt * 0.15)
        freezeLeft = 0
        return
      }

      if (season === 'summer' && timeOfDay === 'day') {
        const moving = Math.abs(speed) > 1.5
        if (moving) heat = Math.min(1, heat + dt * 0.045)
        else heat = Math.max(0, heat - dt * 0.08)
        if (heat > 0.35) status = 'CREW OVERHEATING'
      } else {
        heat = Math.max(0, heat - dt * 0.2)
      }

      if (season === 'winter') {
        freezeCooldown -= dt
        if (freezeLeft > 0) {
          freezeLeft -= dt
          status = 'OIL THICK — SLOW'
        } else if (freezeCooldown <= 0) {
          if (Math.random() < 0.35) {
            freezeLeft = 2.8 + Math.random() * 2.5
            status = 'OIL THICK — SLOW'
          }
          freezeCooldown = 12 + Math.random() * 18
        }
      }

      if (raining && !status) status = 'WET TRACKS'
      if (foggy && !status) status = 'LOW VISIBILITY'
    },

    getDriveMods() {
      let mobilityMul = 1
      if (heat > 0.2) {
        mobilityMul *= THREE.MathUtils.lerp(1, 0.52, THREE.MathUtils.smoothstep(heat, 0.2, 1))
      }
      if (freezeLeft > 0) mobilityMul *= 0.42
      const slip = raining ? 0.85 : 0
      let s = status
      if (raining && slip > 0 && !s) s = 'WET TRACKS'
      return { mobilityMul, slip, status: s }
    },

    dispose() {
      if (rain) {
        scene.remove(rain)
        rain.geometry.dispose()
        ;(rain.material as THREE.Material).dispose()
        rain = null
      }
      scene.fog = null
    },
  }
}
