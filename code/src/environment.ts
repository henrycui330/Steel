import * as THREE from 'three'

export type TimeOfDay = 'day' | 'night'
export type Season = 'summer' | 'winter'
export type WeatherKind = 'clear' | 'rain' | 'fog'

export type EnvironmentConfig = {
  timeOfDay: TimeOfDay
  season: Season
  weather: WeatherKind
  /** When set (e.g. `forest`), apply map-tuned haze + sky gradient. */
  mapId?: string
}

type SkyPalette = {
  zenith: number
  horizon: number
  ground: number
  fogDensity: number
}

/**
 * Soft sky dome (inside-out sphere). Fog disabled so the gradient stays crisp;
 * FogExp2 horizon color matches the mid band so pines dissolve into it.
 */
function createSkyDome(pal: SkyPalette): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1600, 24, 16)
  const mat = new THREE.ShaderMaterial({
    name: 'ForestSkyGradient',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color(pal.zenith) },
      horizonColor: { value: new THREE.Color(pal.horizon) },
      groundColor: { value: new THREE.Color(pal.ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      varying vec3 vDir;
      void main() {
        float h = vDir.y; // -1 ground … 0 horizon … 1 zenith
        vec3 col;
        if (h > 0.0) {
          float t = smoothstep(0.0, 0.85, h);
          col = mix(horizonColor, zenithColor, t);
        } else {
          float t = smoothstep(0.0, -0.55, h);
          col = mix(horizonColor, groundColor, t);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'forestSkyDome'
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  return mesh
}

/** Forest Overwatch atmosphere — soft haze, KOTH hill (~0.9 km) still readable. */
function forestSkyPalette(
  night: boolean,
  winter: boolean,
  raining: boolean,
  foggy: boolean,
): SkyPalette {
  if (night) {
    return {
      zenith: 0x050810,
      horizon: 0x101820,
      ground: 0x0a0e14,
      fogDensity: foggy ? 0.011 : raining ? 0.0048 : 0.0026,
    }
  }
  if (winter) {
    return {
      zenith: raining || foggy ? 0x7a8898 : 0x8ea8c4,
      horizon: raining || foggy ? 0x9aa4b0 : 0xb0bcc8,
      ground: 0x7a848c,
      fogDensity: foggy ? 0.011 : raining ? 0.0042 : 0.0017,
    }
  }
  // Summer day — cool blue-grey air (no olive/green cast)
  return {
    zenith: raining || foggy ? 0x7a848c : 0x6a8eb8,
    horizon: raining || foggy ? 0x9aa4ac : 0xb0c0cc,
    ground: raining || foggy ? 0x6a7078 : 0x8a9098,
    fogDensity: foggy ? 0.011 : raining ? 0.0042 : 0.00155,
  }
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
  const { timeOfDay, season, weather, mapId } = config

  let heat = 0
  let freezeLeft = 0
  let freezeCooldown = 8 + Math.random() * 10
  let status = ''

  // --- Lighting ---
  const night = timeOfDay === 'night'
  const winter = season === 'winter'
  const raining = weather === 'rain'
  const foggy = weather === 'fog'
  const forestLook = mapId === 'forest'

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
    // summer day — near-neutral daylight (was peach/amber and made albedos look red)
    renderer.setClearColor(raining || foggy ? 0x7a8580 : 0x87a0c0, 1)
    lights.ambient.color.setHex(0xd8dde2)
    lights.ambient.intensity = raining ? 0.4 : 0.55
    lights.hemi.color.setHex(0xd0d8e0)
    lights.hemi.groundColor.setHex(0x5e6458)
    lights.hemi.intensity = 0.4
    lights.sun.color.setHex(0xf2f0e8)
    lights.sun.intensity = raining || foggy ? 0.55 : 1.1
  }

  // --- Fog + sky (V2) ---
  let fog: THREE.FogExp2 | null = null
  let skyDome: THREE.Mesh | null = null
  const prevBackground = scene.background

  if (forestLook) {
    const pal = forestSkyPalette(night, winter, raining, foggy)
    skyDome = createSkyDome(pal)
    scene.add(skyDome)
    scene.background = new THREE.Color(pal.horizon)
    renderer.setClearColor(pal.horizon, 1)
    // Hemi: sky fill from zenith; ground bounce stays neutral dirt (not fog green).
    lights.hemi.color.setHex(pal.zenith)
    lights.hemi.groundColor.setHex(night ? 0x1a1814 : winter ? 0x6a7068 : 0x5e6458)
    if (!night) lights.hemi.intensity = Math.max(lights.hemi.intensity, 0.42)
    fog = new THREE.FogExp2(pal.horizon, pal.fogDensity)
  } else if (foggy) {
    fog = new THREE.FogExp2(night ? 0x1a2030 : winter ? 0x9aa4b0 : 0x9aa8b0, 0.012)
  } else if (raining) {
    fog = new THREE.FogExp2(night ? 0x121820 : winter ? 0x889098 : 0x7a8490, 0.0045)
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
      (forestLook && fog
        ? ` · V2 forest haze dens=${fog.density.toFixed(4)}`
        : '') +
      (foggy ? ' (low visibility)' : '') +
      (raining ? ' (wet tracks)' : ''),
  )

  return {
    update(dt, camera, speed, vintageCrew) {
      status = ''

      if (skyDome) {
        camera.getWorldPosition(_rainPos)
        skyDome.position.copy(_rainPos)
      }

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
      if (skyDome) {
        scene.remove(skyDome)
        skyDome.geometry.dispose()
        ;(skyDome.material as THREE.Material).dispose()
        skyDome = null
      }
      scene.background = prevBackground
      scene.fog = null
    },
  }
}
