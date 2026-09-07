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

/** Soft grass / dirt mix for Forest Overwatch floor. */
export function createGrassTexture(repeat = 48): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.07, y * 0.07, 4)
        const patch = fbm(x * 0.02 + 9, y * 0.02 - 3, 3)
        const speck = hash2(x * 0.51, y * 0.77)
        const t = n * 0.55 + patch * 0.3 + speck * 0.15
        // Muted olive grass with dirt mottling
        const r = Math.floor(72 + t * 55 + patch * 25)
        const g = Math.floor(95 + t * 70)
        const b = Math.floor(48 + t * 35)
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
