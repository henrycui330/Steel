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

/** Dark asphalt grit — for road ribbons (not a GLB atlas). */
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
        // Charcoal asphalt with slight warm/cool flecks
        const r = Math.floor(38 + t * 42 + grit * 8)
        const g = Math.floor(38 + t * 40)
        const b = Math.floor(40 + t * 38 + (1 - grit) * 6)
        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
}

/** Dirt/gravel shoulder for road skirts (Vision V5). */
export function createGravelShoulderTexture(
  repeatU = 1,
  repeatV = 1,
): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.09, y * 0.09, 4)
        const grit = hash2(x * 2.1, y * 1.7)
        const pebble = hash2(x * 0.4 + 3, y * 0.55)
        const t = n * 0.5 + grit * 0.35 + pebble * 0.15
        const r = Math.floor(72 + t * 48 + grit * 12)
        const g = Math.floor(62 + t * 36 + pebble * 8)
        const b = Math.floor(42 + t * 28)
        const i = (y * size + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
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
 * World-space tint (not UV) — multiplies the floor albedo so tiling doesn't
 * march across the map as an obvious stamp. Call per terrain vertex.
 */
export function sampleForestGroundTint(
  x: number,
  z: number,
  out: THREE.Color,
): THREE.Color {
  const macro = fbm(x * 0.0038 + 1.2, z * 0.0035 - 0.7, 4)
  const mossBand = fbm(x * 0.006 + 4, z * 0.0055, 3)
  const wet = fbm(x * 0.0075 - 2, z * 0.007 + 5, 3)
  // Warm duff base
  let r = 0.92 + macro * 0.12
  let g = 0.88 + macro * 0.1
  let b = 0.78 + macro * 0.08
  // Cooler moss flats
  if (mossBand > 0.55) {
    const m = (mossBand - 0.55) / 0.45
    r *= 1 - m * 0.12
    g *= 1 + m * 0.08
    b *= 1 - m * 0.05
  }
  // Large wet basins (align-ish with texture puddles, but world-locked)
  if (wet > 0.62) {
    const w = (wet - 0.62) / 0.38
    r *= 1 - w * 0.22
    g *= 1 - w * 0.12
    b *= 1 - w * 0.08
  }
  return out.setRGB(
    THREE.MathUtils.clamp(r, 0.55, 1.15),
    THREE.MathUtils.clamp(g, 0.55, 1.15),
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
