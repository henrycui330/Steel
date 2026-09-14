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

export function createPineForestFloorTexture(
  repeatU = 56,
  repeatV: number = repeatU,
): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const soil = fbm(x * 0.04, y * 0.04, 4)
        const moss = fbm(x * 0.07 + 4, y * 0.065 - 2, 3)
        const needles = fbm(x * 0.22 + 11, y * 0.18, 2)
        const grit = hash2(x * 1.3, y * 0.85)
        const streak = hash2(x * 0.15 + y * 2.1, y * 0.4) // needle-ish streaks

        // Base: umber / pine duff
        let r = 48 + soil * 38 + grit * 14
        let g = 52 + soil * 28 + moss * 42
        let b = 28 + soil * 18 + moss * 12

        // Moss patches (cooler green)
        if (moss > 0.58) {
          const m = (moss - 0.58) / 0.42
          r = r * (1 - m * 0.45) + (36 + m * 20) * m * 0.55
          g = g * (1 - m * 0.25) + (78 + m * 40) * m * 0.7
          b = b * (1 - m * 0.35) + (34 + m * 18) * m * 0.45
        }

        // Needle litter — warm brown flecks / streaks
        if (needles > 0.62 || streak > 0.88) {
          const n = Math.max(needles - 0.55, streak - 0.82)
          r += 28 * n
          g += 12 * n
          b += 4 * n
        }

        // Occasional pale root / stone
        if (grit > 0.93 && soil > 0.55) {
          r += 22
          g += 20
          b += 16
        }

        const i = (y * size + x) * 4
        d[i] = Math.min(255, Math.floor(r))
        d[i + 1] = Math.min(255, Math.floor(g))
        d[i + 2] = Math.min(255, Math.floor(b))
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, 1)
  tex.repeat.set(repeatU, repeatV)
  return tex
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
