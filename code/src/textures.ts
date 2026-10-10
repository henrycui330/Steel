import * as THREE from 'three'

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0)
  const b = hash2(x0 + 1, y0)
  const c = hash2(x0, y0 + 1)
  const d = hash2(x0 + 1, y0 + 1)
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v)
}

function fbm(x: number, y: number, octaves: number): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

function canvasTexture(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[Steel] 2D canvas unavailable for textures')
  paint(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Warm grainy sand — tiled over large dune planes. */
export function createSandTexture(repeat = 36): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.08, y * 0.08, 4)
        const speck = hash2(x * 0.37, y * 0.91)
        const t = n * 0.85 + speck * 0.15
        const r = Math.floor(168 + t * 55)
        const g = Math.floor(138 + t * 42)
        const b = Math.floor(92 + t * 28)
        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, repeat)
}

/** Concrete / sandstone blotches for arena walls. */
export function createSandstoneTexture(repeatU = 8, repeatV = 1.5): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.045, y * 0.055, 5)
        const vein = fbm(x * 0.12 + 20, y * 0.03, 3)
        const t = n * 0.7 + vein * 0.3
        // Warm sandstone / weathered concrete
        const r = Math.floor(158 + t * 48)
        const g = Math.floor(142 + t * 40)
        const b = Math.floor(118 + t * 32)
        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    // Mortar-ish horizontal bands
    ctx.strokeStyle = 'rgba(110, 100, 88, 0.22)'
    ctx.lineWidth = 2
    for (let row = 0; row < 8; row++) {
      const yy = ((row + 0.5) / 8) * size
      ctx.beginPath()
      ctx.moveTo(0, yy)
      ctx.lineTo(size, yy)
      ctx.stroke()
    }
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
}

/** Soft grass / dirt mix (generic). */
export function createGrassTexture(repeat = 48): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.09, y * 0.09, 4)
        const patch = fbm(x * 0.025 + 9, y * 0.025 - 3, 3)
        const blade = hash2(x * 1.7, y * 0.9)
        const speck = hash2(x * 0.51, y * 0.77)
        const t = n * 0.45 + patch * 0.3 + blade * 0.15 + speck * 0.1
        const r = Math.floor(58 + t * 48 + patch * 22)
        const g = Math.floor(108 + t * 78)
        const b = Math.floor(42 + t * 28)
        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, repeat)
}

/**
 * Packed rural dirt path — warm earth, dual tire beds, pebbles, grass flecks.
 * Meant for forest lanes (not highway asphalt).
 */
export function createDirtPathTexture(repeatU = 1, repeatV = 1): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    const mid = (size - 1) * 0.5
    // Tire beds as fraction of width (U across road)
    const rutA = size * 0.32
    const rutB = size * 0.68
    const rutW = size * 0.07
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.1, y * 0.1, 4)
        const grit = hash2(x * 2.2, y * 1.6)
        const patch = fbm(x * 0.035 + 4, y * 0.032 - 2, 3)
        const t = n * 0.5 + grit * 0.3 + patch * 0.2

        // Base — dry packed clay / dirt
        let r = 98 + t * 52 + grit * 14
        let g = 72 + t * 38 + patch * 10
        let b = 42 + t * 22

        // Dual tire compressions (darker, cooler mud)
        const dRut = Math.min(Math.abs(x - rutA), Math.abs(x - rutB))
        if (dRut < rutW) {
          const k = 1 - dRut / rutW
          const mud = k * k * (0.55 + fbm(x * 0.2, y * 0.15, 2) * 0.35)
          r = r * (1 - 0.42 * mud) + 48 * mud
          g = g * (1 - 0.4 * mud) + 38 * mud
          b = b * (1 - 0.35 * mud) + 28 * mud
        }

        // Pebbles / aggregate
        if (hash2(x * 3.3, y * 2.9) > 0.93) {
          r += 35
          g += 28
          b += 18
        }

        // Sparse grass flecks near edges (path shoulder bleed)
        const edge = Math.abs(x - mid) / mid
        if (edge > 0.55 && hash2(x * 0.8, y * 1.4) > 0.72) {
          const gk = (edge - 0.55) / 0.45
          r = r * (1 - 0.45 * gk) + 58 * gk
          g = g * (1 - 0.15 * gk) + 102 * gk
          b = b * (1 - 0.5 * gk) + 36 * gk
        }

        // Soft longitudinal scrape / washboard
        const wash = Math.abs(fbm(x * 0.04, y * 0.35, 2) - 0.5)
        if (wash < 0.04) {
          const k = 1 - wash / 0.04
          r *= 1 - 0.12 * k
          g *= 1 - 0.1 * k
          b *= 1 - 0.08 * k
        }

        // Soft left/right fade so the ribbon dissolves into grass (U = across road)
        let a = 255
        const fade = 0.2 // outer 20% of width each side
        if (edge > 1 - fade) {
          const t = (edge - (1 - fade)) / fade
          const s = t * t * (3 - 2 * t)
          a = Math.floor(255 * (1 - s))
        }

        const i = (y * size + x) * 4
        d[i] = Math.floor(Math.min(255, Math.max(0, r)))
        d[i + 1] = Math.floor(Math.min(255, Math.max(0, g)))
        d[i + 2] = Math.floor(Math.min(255, Math.max(0, b)))
        d[i + 3] = a
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
}

/** Dark asphalt grit — cracks, tar patches, oil stains, aggregate (not a GLB atlas). */
export function createAsphaltTexture(repeatU = 1, repeatV = 1): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.11, y * 0.11, 4)
        const grit = hash2(x * 1.9, y * 1.3)
        const patch = fbm(x * 0.03 + 5, y * 0.028, 3)
        const t = n * 0.55 + grit * 0.3 + patch * 0.15
        // Charcoal base
        let r = 38 + t * 42 + grit * 8
        let g = 38 + t * 40
        let b = 40 + t * 38 + (1 - grit) * 6

        // Light aggregate flecks
        if (hash2(x * 3.1, y * 2.7) > 0.92) {
          r += 28
          g += 26
          b += 22
        }

        // Tar / seal patches (darker warm blobs)
        const tar = fbm(x * 0.055 + 2.1, y * 0.05 - 1.4, 3)
        if (tar > 0.62) {
          const k = (tar - 0.62) / 0.38
          r = r * (1 - 0.35 * k) + 22 * k
          g = g * (1 - 0.35 * k) + 20 * k
          b = b * (1 - 0.35 * k) + 18 * k
        }

        // Oil stains (cooler dark spots)
        const oil = fbm(x * 0.08 - 4, y * 0.07 + 3, 2)
        if (oil > 0.72 && grit > 0.4) {
          const k = (oil - 0.72) / 0.28
          r *= 1 - 0.45 * k
          g *= 1 - 0.4 * k
          b = Math.min(255, b * (1 - 0.25 * k) + 8 * k)
        }

        // Hairline cracks — darken along noise ridges
        const crack = Math.abs(fbm(x * 0.22, y * 0.22, 2) - 0.5)
        if (crack < 0.028) {
          const k = 1 - crack / 0.028
          r *= 1 - 0.55 * k
          g *= 1 - 0.55 * k
          b *= 1 - 0.5 * k
        }

        const i = (y * size + x) * 4
        d[i] = Math.floor(Math.min(255, Math.max(0, r)))
        d[i + 1] = Math.floor(Math.min(255, Math.max(0, g)))
        d[i + 2] = Math.floor(Math.min(255, Math.max(0, b)))
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
}

/**
 * Dashed paint for road centerline. UV: U across stripe, V along path (dist/16).
 * One texture cycle ≈ 16 m → ~7 m dash / ~9 m gap.
 */
export function createRoadDashTexture(repeatV = 1): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[Steel] 2D canvas unavailable for road dash')
  ctx.clearRect(0, 0, size, size)
  // Soft worn paint — not pure white
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, 'rgba(210, 195, 140, 0)')
  g.addColorStop(0.18, 'rgba(220, 205, 150, 0.92)')
  g.addColorStop(0.82, 'rgba(220, 205, 150, 0.92)')
  g.addColorStop(1, 'rgba(210, 195, 140, 0)')
  ctx.fillStyle = g
  // Dash occupies top ~44% of V; rest transparent gap
  ctx.fillRect(0, 0, size, Math.floor(size * 0.44))
  // Wear chips in the dash
  ctx.fillStyle = 'rgba(40, 36, 28, 0.35)'
  for (let i = 0; i < 8; i++) {
    const px = (hash2(i * 1.7, 3.2) * size) | 0
    const py = (hash2(i * 2.3, 1.1) * size * 0.4) | 0
    ctx.fillRect(px, py, 2 + (i % 3), 1 + (i % 2))
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, repeatV)
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Dirt/gravel shoulder for road skirts — wide soft fade into grass. */
export function createGravelShoulderTexture(
  repeatU = 1,
  repeatV = 1,
): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    const mid = (size - 1) * 0.5
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.09, y * 0.09, 4)
        const grit = hash2(x * 2.1, y * 1.7)
        const pebble = hash2(x * 0.4 + 3, y * 0.55)
        const t = n * 0.5 + grit * 0.35 + pebble * 0.15
        let r = Math.floor(78 + t * 48 + grit * 12)
        let g = Math.floor(68 + t * 40 + pebble * 10)
        let b = Math.floor(44 + t * 28)

        // Pull toward grass green as we approach the lip
        const edge = Math.abs(x - mid) / mid
        if (edge > 0.35) {
          const gk = (edge - 0.35) / 0.65
          r = Math.floor(r * (1 - 0.55 * gk) + 52 * gk)
          g = Math.floor(g * (1 - 0.25 * gk) + 110 * gk)
          b = Math.floor(b * (1 - 0.55 * gk) + 40 * gk)
        }

        // Outer ~35% fades to transparent so no hard skirt line
        let a = 255
        const fade = 0.38
        if (edge > 1 - fade) {
          const ft = (edge - (1 - fade)) / fade
          const s = ft * ft * (3 - 2 * ft)
          a = Math.floor(220 * (1 - s))
        } else if (edge > 0.5) {
          a = Math.floor(220 - (edge - 0.5) * 40)
        } else {
          a = 200
        }

        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = Math.max(0, Math.min(255, a))
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
}

export function createPineForestFloorTexture(
  repeatU = 56,
  repeatV: number = repeatU,
): THREE.CanvasTexture {
  return createPineForestFloorMaps(repeatU, repeatV).map
}

export type ForestFloorMaps = {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
}

/**
 * Pine duff pack for Forest Overwatch — albedo + normal + roughness
 * from one height field so lighting matches the litter pattern (Vision V1).
 * V1b: multi-scale litter + soft puddles baked in; pair with world-space
 * vertex tint (`sampleForestGroundTint`) to break UV stamp repetition.
 */
export function createPineForestFloorMaps(
  repeatU = 56,
  repeatV: number = repeatU,
): ForestFloorMaps {
  const size = 256
  const heights = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  const albedoCanvas = document.createElement('canvas')
  albedoCanvas.width = size
  albedoCanvas.height = size
  const aCtx = albedoCanvas.getContext('2d')
  if (!aCtx) throw new Error('[Steel] 2D canvas unavailable for forest floor')
  const aImg = aCtx.createImageData(size, size)
  const a = aImg.data

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const soil = fbm(x * 0.04, y * 0.04, 4)
      const moss = fbm(x * 0.07 + 4, y * 0.065 - 2, 3)
      const needles = fbm(x * 0.22 + 11, y * 0.18, 2)
      const grit = hash2(x * 1.3, y * 0.85)
      const streak = hash2(x * 0.15 + y * 2.1, y * 0.4)
      // Dual-scale undulation — large dunes + mid ripples (anti-tile in-map).
      const dune = fbm(x * 0.012 + 2, y * 0.011 - 1, 3)
      const ripple = fbm(x * 0.055 - 8, y * 0.048 + 3, 3)
      // Soft puddle basins (low-frequency troughs).
      const basin = fbm(x * 0.017 + 13, y * 0.015 - 6, 4)
      const wet = basin > 0.68 ? (basin - 0.68) / 0.32 : 0

      // Height for normals: soil mounds + needle litter + soft dunes.
      let h =
        soil * 0.4 +
        dune * 0.32 +
        ripple * 0.18 +
        needles * 0.2 +
        grit * 0.08
      if (moss > 0.58) h -= (moss - 0.58) * 0.25
      // Puddles flatten local micro-relief.
      if (wet > 0) h = THREE.MathUtils.lerp(h, 0.28 + basin * 0.08, wet * 0.85)

      // Base: umber / pine duff
      let r = 48 + soil * 38 + grit * 14 + dune * 10 + ripple * 8
      let g = 52 + soil * 28 + moss * 42 + dune * 6 + ripple * 5
      let b = 28 + soil * 18 + moss * 12

      if (moss > 0.58) {
        const m = (moss - 0.58) / 0.42
        r = r * (1 - m * 0.45) + (36 + m * 20) * m * 0.55
        g = g * (1 - m * 0.25) + (78 + m * 40) * m * 0.7
        b = b * (1 - m * 0.35) + (34 + m * 18) * m * 0.45
      }

      if (needles > 0.62 || streak > 0.88) {
        const n = Math.max(needles - 0.55, streak - 0.82)
        r += 28 * n
        g += 12 * n
        b += 4 * n
        h += n * 0.12 * (1 - wet)
      }

      if (grit > 0.93 && soil > 0.55) {
        r += 22
        g += 20
        b += 16
        h += 0.15 * (1 - wet)
      }

      // Puddle: cooler/darker wet soil, slight green-brown reflection tint.
      if (wet > 0) {
        r = THREE.MathUtils.lerp(r, 28 + soil * 12, wet * 0.75)
        g = THREE.MathUtils.lerp(g, 42 + moss * 18, wet * 0.7)
        b = THREE.MathUtils.lerp(b, 36 + soil * 14, wet * 0.8)
      }

      const idx = y * size + x
      heights[idx] = h
      // Moss smoother; grit / needles rougher; puddles much smoother.
      let rk =
        0.72 + grit * 0.2 + needles * 0.12 - moss * 0.18 + dune * 0.05 - wet * 0.45
      rough[idx] = THREE.MathUtils.clamp(rk, 0.22, 0.98)

      const i = idx * 4
      a[i] = Math.min(255, Math.floor(r))
      a[i + 1] = Math.min(255, Math.floor(g))
      a[i + 2] = Math.min(255, Math.floor(b))
      a[i + 3] = 255
    }
  }
  aCtx.putImageData(aImg, 0, 0)

  const map = new THREE.CanvasTexture(albedoCanvas)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  // Slightly non-square repeat fights axis-aligned stamp recognition.
  map.repeat.set(repeatU, repeatV * 1.07)
  map.anisotropy = 8
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true

  // Normal map from height (OpenGL-style, tangent space).
  const nCanvas = document.createElement('canvas')
  nCanvas.width = size
  nCanvas.height = size
  const nCtx = nCanvas.getContext('2d')
  if (!nCtx) throw new Error('[Steel] 2D canvas unavailable for forest normals')
  const nImg = nCtx.createImageData(size, size)
  const nd = nImg.data
  const strength = 2.9
  const sampleH = (x: number, y: number): number => {
    const xx = ((x % size) + size) % size
    const yy = ((y % size) + size) % size
    return heights[yy * size + xx]!
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (sampleH(x - 1, y) - sampleH(x + 1, y)) * strength
      const dy = (sampleH(x, y + 1) - sampleH(x, y - 1)) * strength
      let nx = dx
      let ny = dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const i = (y * size + x) * 4
      nd[i] = Math.floor((nx * 0.5 + 0.5) * 255)
      nd[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255)
      nd[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255)
      nd[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  const normalMap = new THREE.CanvasTexture(nCanvas)
  normalMap.wrapS = THREE.RepeatWrapping
  normalMap.wrapT = THREE.RepeatWrapping
  // Offset normal repeat vs albedo — classic cheap detile.
  normalMap.repeat.set(repeatU * 1.13, repeatV * 0.94)
  normalMap.offset.set(0.17, 0.31)
  normalMap.anisotropy = 8
  normalMap.colorSpace = THREE.NoColorSpace
  normalMap.needsUpdate = true

  // Roughness — Three MeshStandardMaterial reads the **green** channel.
  const rCanvas = document.createElement('canvas')
  rCanvas.width = size
  rCanvas.height = size
  const rCtx = rCanvas.getContext('2d')
  if (!rCtx) throw new Error('[Steel] 2D canvas unavailable for forest roughness')
  const rImg = rCtx.createImageData(size, size)
  const rd = rImg.data
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rough[i]! * 255)
    const o = i * 4
    rd[o] = v
    rd[o + 1] = v
    rd[o + 2] = v
    rd[o + 3] = 255
  }
  rCtx.putImageData(rImg, 0, 0)
  const roughnessMap = new THREE.CanvasTexture(rCanvas)
  roughnessMap.wrapS = THREE.RepeatWrapping
  roughnessMap.wrapT = THREE.RepeatWrapping
  roughnessMap.repeat.set(repeatU, repeatV * 1.07)
  roughnessMap.anisotropy = 4
  roughnessMap.colorSpace = THREE.NoColorSpace
  roughnessMap.needsUpdate = true

  console.info(
    `[Steel] Forest floor maps — albedo+normal+roughness · puddles+detile · ${size}² · repeat ${repeatU.toFixed(0)}×${repeatV.toFixed(0)}`,
  )
  return { map, normalMap, roughnessMap }
}

/**
 * Continuous meadow grass floor (albedo + normal + roughness) — reads as a
 * grass carpet, not discrete tufts. Soft blade streaks + patch colour.
 */
export function createMeadowGrassFloorMaps(
  repeatU = 72,
  repeatV: number = repeatU,
): ForestFloorMaps {
  const size = 256
  const heights = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  const albedoCanvas = document.createElement('canvas')
  albedoCanvas.width = size
  albedoCanvas.height = size
  const aCtx = albedoCanvas.getContext('2d')
  if (!aCtx) throw new Error('[Steel] 2D canvas unavailable for grass floor')
  const aImg = aCtx.createImageData(size, size)
  const a = aImg.data

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const macro = fbm(x * 0.035, y * 0.033, 4)
      const patch = fbm(x * 0.08 + 5, y * 0.075 - 2, 3)
      const fine = fbm(x * 0.28 + 11, y * 0.24, 2)
      // Vertical-ish blade streaks (carpet grain)
      const blade =
        hash2(x * 2.4, Math.floor(y * 0.55) * 1.7) * 0.55 +
        hash2(x * 0.9 + y * 0.15, y * 3.1) * 0.45
      const dry = fbm(x * 0.02 + 3, y * 0.018 - 1, 3)
      const grit = hash2(x * 1.1, y * 0.95)

      let h =
        macro * 0.35 + patch * 0.25 + fine * 0.2 + blade * 0.18 + grit * 0.05
      // Lush spring greens
      let r = 48 + macro * 28 + patch * 18 + blade * 12
      let g = 108 + macro * 55 + patch * 35 + fine * 22 + blade * 18
      let b = 36 + macro * 18 + patch * 12

      // Cooler/darker wet-looking dips
      if (patch > 0.62) {
        const m = (patch - 0.62) / 0.38
        r = r * (1 - m * 0.25) + 32 * m
        g = g * (1 - m * 0.1) + 92 * m
        b = b * (1 - m * 0.2) + 40 * m
        h -= m * 0.12
      }
      // Warmer dry / sun-scorch patches
      if (dry > 0.64) {
        const d = (dry - 0.64) / 0.36
        r = r * (1 - d * 0.15) + (95 + blade * 20) * d
        g = g * (1 - d * 0.2) + (118 + fine * 15) * d
        b = b * (1 - d * 0.35) + 42 * d
      }
      // Tiny soil flecks
      if (grit > 0.94) {
        r += 18
        g += 8
        b += 4
        h += 0.08
      }

      const idx = y * size + x
      heights[idx] = h
      rough[idx] = THREE.MathUtils.clamp(
        0.78 + blade * 0.12 + fine * 0.08 - patch * 0.1,
        0.55,
        0.98,
      )

      const i = idx * 4
      a[i] = Math.min(255, Math.floor(r))
      a[i + 1] = Math.min(255, Math.floor(g))
      a[i + 2] = Math.min(255, Math.floor(b))
      a[i + 3] = 255
    }
  }
  aCtx.putImageData(aImg, 0, 0)

  const map = new THREE.CanvasTexture(albedoCanvas)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(repeatU, repeatV * 1.05)
  map.anisotropy = 8
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true

  const nCanvas = document.createElement('canvas')
  nCanvas.width = size
  nCanvas.height = size
  const nCtx = nCanvas.getContext('2d')
  if (!nCtx) throw new Error('[Steel] 2D canvas unavailable for grass normals')
  const nImg = nCtx.createImageData(size, size)
  const nd = nImg.data
  const strength = 2.2
  const sampleH = (sx: number, sy: number): number => {
    const xx = ((sx % size) + size) % size
    const yy = ((sy % size) + size) % size
    return heights[yy * size + xx]!
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (sampleH(x - 1, y) - sampleH(x + 1, y)) * strength
      const dy = (sampleH(x, y + 1) - sampleH(x, y - 1)) * strength
      let nx = dx
      let ny = dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const i = (y * size + x) * 4
      nd[i] = Math.floor((nx * 0.5 + 0.5) * 255)
      nd[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255)
      nd[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255)
      nd[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  const normalMap = new THREE.CanvasTexture(nCanvas)
  normalMap.wrapS = THREE.RepeatWrapping
  normalMap.wrapT = THREE.RepeatWrapping
  normalMap.repeat.set(repeatU * 1.11, repeatV * 0.96)
  normalMap.offset.set(0.21, 0.37)
  normalMap.anisotropy = 8
  normalMap.colorSpace = THREE.NoColorSpace
  normalMap.needsUpdate = true

  const rCanvas = document.createElement('canvas')
  rCanvas.width = size
  rCanvas.height = size
  const rCtx = rCanvas.getContext('2d')
  if (!rCtx) throw new Error('[Steel] 2D canvas unavailable for grass roughness')
  const rImg = rCtx.createImageData(size, size)
  const rd = rImg.data
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rough[i]! * 255)
    const o = i * 4
    rd[o] = v
    rd[o + 1] = v
    rd[o + 2] = v
    rd[o + 3] = 255
  }
  rCtx.putImageData(rImg, 0, 0)
  const roughnessMap = new THREE.CanvasTexture(rCanvas)
  roughnessMap.wrapS = THREE.RepeatWrapping
  roughnessMap.wrapT = THREE.RepeatWrapping
  roughnessMap.repeat.set(repeatU, repeatV * 1.05)
  roughnessMap.anisotropy = 4
  roughnessMap.colorSpace = THREE.NoColorSpace
  roughnessMap.needsUpdate = true

  console.info(
    `[Steel] Meadow grass floor — albedo+normal+roughness · carpet · ${size}² · repeat ${repeatU.toFixed(0)}×${repeatV.toFixed(0)}`,
  )
  return { map, normalMap, roughnessMap }
}

/**
 * World-space tint (not UV) — multiplies the floor albedo so tiling doesn't
 * march across the map as an obvious stamp. Call per terrain vertex.
 */
export function sampleForestGroundTint(
  x: number,
  z: number,
  out: THREE.Color,
): THREE.Color {
  const macro = fbm(x * 0.0038 + 1.2, z * 0.0035 - 0.7, 4)
  const lush = fbm(x * 0.006 + 4, z * 0.0055, 3)
  const dry = fbm(x * 0.0075 - 2, z * 0.007 + 5, 3)
  // Green meadow multiply (keeps grass floor reading as grass)
  let r = 0.88 + macro * 0.1
  let g = 0.96 + macro * 0.08
  let b = 0.78 + macro * 0.08
  if (lush > 0.55) {
    const m = (lush - 0.55) / 0.45
    r *= 1 - m * 0.08
    g *= 1 + m * 0.06
    b *= 1 - m * 0.04
  }
  if (dry > 0.62) {
    const w = (dry - 0.62) / 0.38
    r *= 1 + w * 0.08
    g *= 1 - w * 0.06
    b *= 1 - w * 0.1
  }
  return out.setRGB(
    THREE.MathUtils.clamp(r, 0.55, 1.15),
    THREE.MathUtils.clamp(g, 0.55, 1.2),
    THREE.MathUtils.clamp(b, 0.5, 1.1),
  )
}

/**
 * High-contrast rubber tread for UV scroll: charcoal base + lighter cleat bars.
 * Reads black overall; motion stays visible. Scroll along V (repeat.y).
 */
let _trackTreadTex: THREE.CanvasTexture | null = null

export function createTrackTreadTexture(): THREE.CanvasTexture {
  if (_trackTreadTex) return _trackTreadTex

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[Steel] 2D canvas unavailable for track tread')

  const img = ctx.createImageData(size, size)
  const d = img.data
  const cleatPitch = 28
  const cleatH = 10
  const groove = 4

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inCleat = y % cleatPitch < cleatH
      const inGroove =
        y % cleatPitch >= cleatH && y % cleatPitch < cleatH + groove
      const edge = x < 18 || x > size - 18
      const midBolt = Math.abs(x - size / 2) < 3 && inCleat
      const grit = hash2(x * 0.4, y * 0.4) * 12

      let v: number
      if (inGroove) v = 22 + grit * 0.3
      else if (inCleat) v = edge ? 78 + grit : midBolt ? 95 : 62 + grit
      else v = 28 + grit * 0.5

      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1.2, 5.5)
  tex.anisotropy = 4
  tex.needsUpdate = true
  _trackTreadTex = tex
  console.info('[Steel] Track tread sheet ready (black + gray cleats)')
  return tex
}

export type GrassTuft = {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  unitHeight: number
}

/** One painted blade (alpha taper) for procedural tuft cards. */
function createGrassBladeMap(): THREE.CanvasTexture {
  const tex = canvasTexture(64, (ctx, size) => {
    ctx.clearRect(0, 0, size, size)
    const img = ctx.createImageData(size, size)
    const d = img.data
    const mid = (size - 1) * 0.5
    for (let y = 0; y < size; y++) {
      const t = y / (size - 1)
      // Wide opaque blade so alphaTest doesn't erase the tuft
      const half = (0.48 - t * 0.22) * size
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const dx = Math.abs(x - mid)
        let a = 0
        if (dx < half) {
          const edge = 1 - dx / Math.max(half, 1)
          a = Math.floor(255 * Math.min(1, 0.55 + edge * 0.45) * (0.75 + t * 0.25))
        }
        const n = hash2(x * 0.8, y * 1.1)
        d[i] = Math.floor(42 + t * 55 + n * 16)
        d[i + 1] = Math.floor(110 + t * 70 + n * 18)
        d[i + 2] = Math.floor(32 + t * 28)
        d[i + 3] = a
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.repeat.set(1, 1)
  return tex
}

/**
 * Crossed-card tuft (no GLB). Unit height 1m — instance scale is world metres.
 */
export function createGrassTuft(): GrassTuft {
  return buildCropTuft({
    cards: 5,
    width: 0.55,
    tipNarrow: 0.28,
    map: createGrassBladeMap(),
    color: 0xc8e878,
    alphaTest: 0.15,
  })
}

export type CropKind = 'barley' | 'flower'

type CropTuftOpts = {
  cards: number
  width: number
  tipNarrow: number
  map: THREE.CanvasTexture
  color: number
  alphaTest: number
}

function buildCropTuft(opts: CropTuftOpts): GrassTuft {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const h = 1
  for (let i = 0; i < opts.cards; i++) {
    const yaw = (i / opts.cards) * Math.PI
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const w = opts.width
    const ox = Math.cos(yaw * 2.1) * 0.05
    const oz = Math.sin(yaw * 2.1) * 0.05
    const b = positions.length / 3
    positions.push(ox - c * w, 0, oz - s * w)
    positions.push(ox + c * w, 0, oz + s * w)
    positions.push(ox + c * w * opts.tipNarrow, h, oz + s * w * opts.tipNarrow)
    positions.push(ox - c * w * opts.tipNarrow, h, oz - s * w * opts.tipNarrow)
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshStandardMaterial({
    map: opts.map,
    color: opts.color,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: opts.alphaTest,
    depthWrite: true,
    envMapIntensity: 0.2,
  })
  return { geometry, material, unitHeight: 1 }
}

/** Tall golden barley stalks — dense enough to break a tank silhouette. */
function createBarleyBladeMap(): THREE.CanvasTexture {
  const tex = canvasTexture(64, (ctx, size) => {
    ctx.clearRect(0, 0, size, size)
    const img = ctx.createImageData(size, size)
    const d = img.data
    const mid = (size - 1) * 0.5
    for (let y = 0; y < size; y++) {
      const t = y / (size - 1)
      // Thin stalk, slight head bulge near tip
      const head = t > 0.72 ? 1 + (t - 0.72) * 2.4 : 1
      const half = (0.28 - t * 0.18) * size * head
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const dx = Math.abs(x - mid)
        let a = 0
        if (dx < half) {
          const edge = 1 - dx / Math.max(half, 1)
          a = Math.floor(255 * Math.min(1, edge * 1.45) * (0.4 + t * 0.6))
        }
        const n = hash2(x * 0.9, y * 1.3)
        // Straw / ripe barley
        d[i] = Math.floor(150 + t * 55 + n * 22)
        d[i + 1] = Math.floor(125 + t * 40 + n * 18)
        d[i + 2] = Math.floor(48 + t * 20 + n * 10)
        d[i + 3] = a
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/** Tall wildflower stems with a coloured bloom band at the tip. */
function createFlowerBladeMap(seed = 0): THREE.CanvasTexture {
  const blooms: Array<[number, number, number]> = [
    [210, 70, 90],
    [230, 180, 50],
    [90, 110, 200],
    [230, 120, 40],
    [180, 80, 180],
    [250, 250, 245],
  ]
  const bloom = blooms[Math.floor(hash2(3.1 + seed, 7.7) * blooms.length) % blooms.length]!
  const tex = canvasTexture(64, (ctx, size) => {
    ctx.clearRect(0, 0, size, size)
    const img = ctx.createImageData(size, size)
    const d = img.data
    const mid = (size - 1) * 0.5
    for (let y = 0; y < size; y++) {
      const t = y / (size - 1)
      const isBloom = t > 0.78
      const half = isBloom
        ? (0.36 - (t - 0.78) * 0.5) * size
        : (0.22 - t * 0.12) * size
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const dx = Math.abs(x - mid)
        let a = 0
        if (dx < half) {
          const edge = 1 - dx / Math.max(half, 1)
          a = Math.floor(255 * Math.min(1, edge * 1.4) * (isBloom ? 0.95 : 0.45 + t * 0.5))
        }
        const n = hash2(x * 1.1, y * 0.9)
        if (isBloom) {
          d[i] = Math.floor(bloom[0] * (0.85 + n * 0.2))
          d[i + 1] = Math.floor(bloom[1] * (0.85 + n * 0.2))
          d[i + 2] = Math.floor(bloom[2] * (0.85 + n * 0.2))
        } else {
          d[i] = Math.floor(40 + t * 30 + n * 12)
          d[i + 1] = Math.floor(95 + t * 50 + n * 16)
          d[i + 2] = Math.floor(35 + t * 20)
        }
        d[i + 3] = a
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/**
 * Hideable crop clump (barley ≈ straw; flower ≈ meadow).
 * Unit height 1m — scale instances to ~2m+ so tanks can sit in cover.
 */
export function createCropTuft(kind: CropKind, flowerSeed = 0): GrassTuft {
  if (kind === 'barley') {
    return buildCropTuft({
      cards: 5,
      width: 0.38,
      tipNarrow: 0.18,
      map: createBarleyBladeMap(),
      color: 0xf0e0a8,
      alphaTest: 0.34,
    })
  }
  return buildCropTuft({
    cards: 5,
    width: 0.42,
    tipNarrow: 0.35,
    map: createFlowerBladeMap(flowerSeed),
    color: 0xffffff,
    alphaTest: 0.32,
  })
}
