import * as THREE from 'three'
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { fixPublicUrl } from './assetUrl'

const gltfCache = new Map<string, Promise<GLTF>>()
const textureCache = new Map<string, Promise<THREE.Texture>>()
const ASSET_CACHE = 'steel-assets-v2'
const FETCH_TIMEOUT_MS = 45_000
const PARSE_TIMEOUT_MS = 45_000
const MAX_INFLIGHT = 4
const GLB_MAGIC = 'glTF'
/** Fewer retries — Pages 404/HTML fail fast instead of looking “stuck”. */
const DEFAULT_RETRIES = 2

let sharedLoader: GLTFLoader | null = null
let inflight = 0
const waiters: Array<() => void> = []

export type GltfProgress = {
  active: number
  done: number
  failed: number
  bytes: number
  label: string
}

type ProgressFn = (p: GltfProgress) => void
const listeners = new Set<ProgressFn>()
let active = 0
let done = 0
let failed = 0
let bytes = 0

export function onGltfProgress(fn: ProgressFn): () => void {
  listeners.add(fn)
  fn(snapshot(''))
  return () => {
    listeners.delete(fn)
  }
}

function snapshot(label: string): GltfProgress {
  return { active, done, failed, bytes, label }
}

function emit(label: string): void {
  const p = snapshot(label)
  for (const fn of listeners) fn(p)
}

function getLoader(): GLTFLoader {
  if (sharedLoader) return sharedLoader
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  // Bundled decoder (hashed Vite URLs) — never Google CDN.
  draco.setDecoderPath(DRACO_GLTF_CONFIG)
  draco.preload()
  loader.setDRACOLoader(draco)
  sharedLoader = loader
  return loader
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function acquireSlot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight++
    return
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve)
  })
  inflight++
}

function releaseSlot(): void {
  inflight--
  const next = waiters.shift()
  if (next) next()
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      reject(new Error(`[Steel] Timed out ${ms}ms ${label}`))
    }, ms)
    p.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      (err) => {
        window.clearTimeout(t)
        reject(err)
      },
    )
  })
}

function assertGlbMagic(data: ArrayBuffer, url: string): void {
  if (data.byteLength < 4) {
    throw new Error(`[Steel] Empty file ${url}`)
  }
  const u8 = new Uint8Array(data, 0, 4)
  const magic = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!, u8[3]!)
  if (magic !== GLB_MAGIC) {
    throw new Error(`[Steel] Not a GLB (${magic}) ${url}`)
  }
}

async function cacheMatch(url: string): Promise<ArrayBuffer | null> {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(ASSET_CACHE)
    const hit = await cache.match(url)
    if (!hit || !hit.ok) return null
    return await hit.arrayBuffer()
  } catch {
    return null
  }
}

async function cachePut(url: string, data: ArrayBuffer): Promise<void> {
  if (!('caches' in window)) return
  try {
    const cache = await caches.open(ASSET_CACHE)
    await cache.put(
      url,
      new Response(data, {
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }),
    )
  } catch {
    /* private mode / quota */
  }
}

async function cacheDelete(url: string): Promise<void> {
  if (!('caches' in window)) return
  try {
    const cache = await caches.open(ASSET_CACHE)
    await cache.delete(url)
  } catch {
    /* ignore */
  }
}

async function fetchBuffer(url: string, reload: boolean): Promise<ArrayBuffer> {
  if (!reload) {
    const cached = await cacheMatch(url)
    if (cached && cached.byteLength > 0) {
      try {
        assertGlbMagic(cached, url)
        bytes += cached.byteLength
        emit(url.split('/').pop() ?? url)
        return cached
      } catch {
        // Drop SPA/HTML accidentally cached as a “model”.
        await cacheDelete(url)
      }
    }
  }

  await acquireSlot()
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(fixPublicUrl(url), {
        signal: ctrl.signal,
        // Avoid sticky force-cache of GitHub Pages HTML error bodies.
        cache: reload ? 'reload' : 'default',
        credentials: 'same-origin',
      })
    } finally {
      window.clearTimeout(t)
    }
    if (!res.ok) {
      throw new Error(`[Steel] HTTP ${res.status} ${url}`)
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase()
    if (ctype.includes('text/html')) {
      throw new Error(`[Steel] HTTP 404 (HTML) ${url}`)
    }
    const data = await res.arrayBuffer()
    assertGlbMagic(data, url)
    bytes += data.byteLength
    emit(url.split('/').pop() ?? url)
    await cachePut(url, data)
    return data
  } finally {
    releaseSlot()
  }
}

function parseGltf(data: ArrayBuffer, url: string): Promise<GLTF> {
  const slash = url.lastIndexOf('/')
  const path = slash >= 0 ? url.slice(0, slash + 1) : './'
  return new Promise((resolve, reject) => {
    try {
      getLoader().parse(data, path, resolve, (err) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function fetchGltfOnce(url: string, attempt: number): Promise<GLTF> {
  const label = url.split('/').pop() ?? url
  const data = await fetchBuffer(url, attempt > 0)
  return withTimeout(parseGltf(data, url), PARSE_TIMEOUT_MS, `parse ${label}`)
}

async function loadGltfUncached(url: string, retries: number): Promise<GLTF> {
  const label = url.split('/').pop() ?? url
  active++
  emit(label)
  try {
    let last: unknown
    for (let i = 0; i < retries; i++) {
      try {
        const gltf = await fetchGltfOnce(url, i)
        done++
        emit(label)
        console.info('[Steel] GLB ready', url)
        return gltf
      } catch (err) {
        last = err
        console.warn(`[Steel] GLB attempt ${i + 1}/${retries} failed`, url, err)
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Not a GLB') || msg.includes('HTTP') || msg.includes('Empty file')) {
          await cacheDelete(url)
        }
        if (/\bHTTP (4\d\d|404|403)\b/.test(msg)) break
        if (i + 1 < retries) await sleep(400 * (i + 1))
      }
    }
    failed++
    emit(label)
    throw last
  } finally {
    active--
    emit(label)
  }
}

/** Shared GLB fetch with retries. Same URL is only downloaded once. */
export function loadGltfCached(url: string, retries = DEFAULT_RETRIES): Promise<GLTF> {
  let pending = gltfCache.get(url)
  if (!pending) {
    pending = loadGltfUncached(url, retries)
    gltfCache.set(url, pending)
    pending.catch(() => {
      gltfCache.delete(url)
    })
  }
  return pending
}

export async function cloneGltfScene(url: string): Promise<THREE.Object3D> {
  const gltf = await loadGltfCached(url)
  return gltf.scene.clone(true)
}

export function warmLoaders(): void {
  getLoader()
}

export function preloadUrls(urls: readonly string[]): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))]
  return Promise.all(
    unique.map((url) =>
      loadGltfCached(url).catch((err) => {
        console.warn('[Steel] Preload skipped', url, err)
        return null
      }),
    ),
  ).then(() => undefined)
}

export function loadTextureCached(url: string): Promise<THREE.Texture> {
  let pending = textureCache.get(url)
  if (!pending) {
    pending = (async () => {
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 20_000)
      try {
        const res = await fetch(fixPublicUrl(url), {
          signal: ctrl.signal,
          cache: 'force-cache',
          credentials: 'same-origin',
        })
        if (!res.ok) throw new Error(`[Steel] HTTP ${res.status} ${url}`)
        const blob = await res.blob()
        const objUrl = URL.createObjectURL(blob)
        try {
          const tex = await new Promise<THREE.Texture>((resolve, reject) => {
            const loader = new THREE.TextureLoader()
            loader.load(objUrl, resolve, undefined, reject)
          })
          tex.colorSpace = THREE.SRGBColorSpace
          return tex
        } finally {
          URL.revokeObjectURL(objUrl)
        }
      } finally {
        window.clearTimeout(t)
      }
    })()
    textureCache.set(url, pending)
    pending.catch(() => {
      textureCache.delete(url)
    })
  }
  return pending
}
