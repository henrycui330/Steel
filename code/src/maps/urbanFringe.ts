import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  estimatePropCollider,
  type PropCollider,
} from '../collision'

const CAR = '/assets/kenney/car-kit/glb'
const ROAD = '/assets/kenney/city-roads/glb'
const RETRO = '/assets/kenney/retro-urban/glb'
const SUB = '/assets/kenney/city-suburban/glb'
const COM = '/assets/kenney/city-commercial/glb'

type SolidKind = 'rock' | 'cliff' | 'tree' | 'stump' | 'log' | 'building' | 'vehicle' | 'prop'

type PlaceSpec = {
  url: string
  x: number
  z: number
  yaw?: number
  /** Uniform scale (Kenney city tiles ≈ 1 unit). */
  scale: number
  solid: SolidKind | null
  /** For solid radius estimate (world height after scale). */
  heightHint: number
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })
}

/** Mild wartime grit without crushing shared materials. */
function gritClone(root: THREE.Object3D, kind: SolidKind | 'road'): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const src = Array.isArray(obj.material) ? obj.material : [obj.material]
    const next = src.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshBasicMaterial)) {
        return m
      }
      const mat = m.clone()
      if ('color' in mat && mat.color instanceof THREE.Color) {
        if (kind === 'building') mat.color.lerp(new THREE.Color(0x6a655c), 0.25)
        else if (kind === 'vehicle') mat.color.lerp(new THREE.Color(0x4a4840), 0.2)
        else if (kind === 'prop') mat.color.lerp(new THREE.Color(0x555048), 0.15)
        else if (kind === 'road') mat.color.lerp(new THREE.Color(0x3a3a38), 0.35)
      }
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.roughness = Math.min(1, (mat.roughness ?? 0.7) + 0.1)
        mat.metalness = Math.min(0.4, mat.metalness ?? 0)
      }
      mat.needsUpdate = true
      return mat
    })
    obj.material = next.length === 1 ? next[0]! : next
  })
}

function sitOnGround(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root)
  root.position.y -= box.min.y
}

async function loadTemplate(
  loader: GLTFLoader,
  cache: Map<string, THREE.Object3D>,
  url: string,
): Promise<THREE.Object3D> {
  const hit = cache.get(url)
  if (hit) return hit
  const gltf = await loader.loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  cache.set(url, gltf.scene)
  return gltf.scene
}

function place(
  parent: THREE.Group,
  template: THREE.Object3D,
  spec: PlaceSpec,
  colliders: PropCollider[],
): void {
  const clone = template.clone(true)
  clone.scale.setScalar(spec.scale)
  clone.position.set(spec.x, 0, spec.z)
  clone.rotation.y = spec.yaw ?? 0
  clone.updateMatrixWorld(true)
  sitOnGround(clone)
  enableShadows(clone)
  gritClone(clone, spec.solid === null ? 'road' : spec.solid)
  parent.add(clone)

  if (spec.solid === 'building') {
    const shape = estimatePropCollider('cliff', spec.heightHint)
    colliders.push({
      x: spec.x,
      z: spec.z,
      radius: Math.max(shape.radius * 0.55, 3.5),
      maxY: shape.maxY,
    })
  } else if (spec.solid === 'vehicle') {
    colliders.push({
      x: spec.x,
      z: spec.z,
      radius: 2.4,
      maxY: 2.8,
    })
  } else if (spec.solid === 'prop') {
    colliders.push({
      x: spec.x,
      z: spec.z,
      radius: 1.2,
      maxY: 2.2,
    })
  }
}

function buildRoad(): PlaceSpec[] {
  const out: PlaceSpec[] = []
  const scale = 8
  // North-south approach road through clearing
  for (let z = -8; z <= 54; z += 8) {
    out.push({
      url: `${ROAD}/road-straight.glb`,
      x: 0,
      z,
      yaw: 0,
      scale,
      solid: null,
      heightHint: 0.2,
    })
  }
  // Side spur toward commercial east
  for (let x = 8; x <= 32; x += 8) {
    out.push({
      url: `${ROAD}/road-straight.glb`,
      x,
      z: 16,
      yaw: Math.PI / 2,
      scale,
      solid: null,
      heightHint: 0.2,
    })
  }
  out.push({
    url: `${ROAD}/road-crossing.glb`,
    x: 0,
    z: 16,
    yaw: 0,
    scale,
    solid: null,
    heightHint: 0.2,
  })
  // Barriers at edges of spur
  for (const z of [8, 24, 40]) {
    out.push({
      url: `${ROAD}/construction-barrier.glb`,
      x: -5.5,
      z,
      yaw: Math.PI / 2,
      scale: 3.5,
      solid: 'prop',
      heightHint: 1.5,
    })
    out.push({
      url: `${ROAD}/construction-barrier.glb`,
      x: 5.5,
      z,
      yaw: Math.PI / 2,
      scale: 3.5,
      solid: 'prop',
      heightHint: 1.5,
    })
  }
  return out
}

function buildVehicles(rng: () => number): PlaceSpec[] {
  const files = [
    'sedan.glb',
    'sedan-sports.glb',
    'suv.glb',
    'van.glb',
    'truck.glb',
    'truck-flat.glb',
    'taxi.glb',
    'hatchback-sports.glb',
    'garbage-truck.glb',
  ]
  const spots: Array<{ x: number; z: number; yaw: number }> = [
    { x: -7, z: 10, yaw: 0.4 },
    { x: 8, z: 22, yaw: -1.1 },
    { x: -9, z: 34, yaw: 2.6 },
    { x: 7, z: 44, yaw: 0.2 },
    { x: 14, z: 14, yaw: 1.7 },
    { x: 22, z: 18, yaw: -0.3 },
    { x: -28, z: 8, yaw: 1.2 },
    { x: 36, z: 28, yaw: -2.1 },
    { x: -6, z: -6, yaw: 0.15 },
  ]
  return spots.map((s, i) => ({
    url: `${CAR}/${files[i % files.length]!}`,
    x: s.x + (rng() - 0.5) * 1.5,
    z: s.z + (rng() - 0.5) * 1.5,
    yaw: s.yaw,
    scale: 2.8 + rng() * 0.4,
    solid: 'vehicle' as const,
    heightHint: 2.2,
  }))
}

function buildClutter(rng: () => number): PlaceSpec[] {
  const out: PlaceSpec[] = []
  const dumpSpots = [
    [-12, 12],
    [11, 20],
    [-14, 38],
    [18, 12],
    [40, 22],
    [-40, 14],
  ] as const
  for (const [x, z] of dumpSpots) {
    out.push({
      url: `${RETRO}/detail-dumpster-${rng() > 0.5 ? 'open' : 'closed'}.glb`,
      x: x + (rng() - 0.5) * 2,
      z: z + (rng() - 0.5) * 2,
      yaw: rng() * Math.PI * 2,
      scale: 3.2,
      solid: 'prop',
      heightHint: 2,
    })
  }
  for (const z of [6, 18, 30, 42]) {
    out.push({
      url: `${RETRO}/detail-light-single.glb`,
      x: -6.5,
      z,
      yaw: 0,
      scale: 3.5,
      solid: 'prop',
      heightHint: 6,
    })
    out.push({
      url: `${RETRO}/detail-light-single.glb`,
      x: 6.5,
      z,
      yaw: Math.PI,
      scale: 3.5,
      solid: 'prop',
      heightHint: 6,
    })
  }
  for (let i = 0; i < 6; i++) {
    out.push({
      url: `${RETRO}/detail-bench.glb`,
      x: (rng() > 0.5 ? 1 : -1) * (10 + rng() * 8),
      z: 5 + rng() * 40,
      yaw: rng() * Math.PI,
      scale: 3,
      solid: 'prop',
      heightHint: 1.2,
    })
  }
  // Debris near wrecks
  for (let i = 0; i < 8; i++) {
    out.push({
      url: `${CAR}/debris-tire.glb`,
      x: (rng() * 2 - 1) * 20,
      z: rng() * 45,
      yaw: rng() * Math.PI,
      scale: 2.5,
      solid: 'prop',
      heightHint: 0.8,
    })
  }
  return out
}

function buildSuburban(): PlaceSpec[] {
  const houses = [
    'building-type-a.glb',
    'building-type-b.glb',
    'building-type-c.glb',
    'building-type-e.glb',
    'building-type-f.glb',
    'building-type-h.glb',
  ]
  const spots = [
    { x: -42, z: 6, yaw: 0.2 },
    { x: -38, z: 18, yaw: -0.1 },
    { x: -46, z: 28, yaw: 0.4 },
    { x: -34, z: -8, yaw: 0.15 },
    { x: -48, z: -4, yaw: -0.3 },
  ]
  const out: PlaceSpec[] = spots.map((s, i) => ({
    url: `${SUB}/${houses[i % houses.length]!}`,
    ...s,
    scale: 11,
    solid: 'building' as const,
    heightHint: 9,
  }))
  // Fences
  for (let i = 0; i < 4; i++) {
    out.push({
      url: `${SUB}/fence-1x4.glb`,
      x: -30,
      z: -4 + i * 8,
      yaw: Math.PI / 2,
      scale: 6,
      solid: 'prop',
      heightHint: 2,
    })
  }
  return out
}

function buildCommercial(): PlaceSpec[] {
  const shops = [
    'building-a.glb',
    'building-b.glb',
    'building-c.glb',
    'building-d.glb',
    'building-e.glb',
    'low-detail-building-a.glb',
    'low-detail-building-wide-b.glb',
  ]
  const spots = [
    { x: 40, z: 8, yaw: -0.2 },
    { x: 46, z: 20, yaw: 0.1 },
    { x: 38, z: 32, yaw: -0.35 },
    { x: 50, z: -6, yaw: 0.25 },
    { x: 44, z: 42, yaw: 0 },
  ]
  return spots.map((s, i) => ({
    url: `${COM}/${shops[i % shops.length]!}`,
    ...s,
    scale: 10,
    solid: 'building' as const,
    heightHint: 10,
  }))
}

/**
 * F+G urban fringe: road, wrecks, trash, suburban + commercial buildings.
 * Call after nature props; appends to the same map root / collider list.
 */
export async function loadUrbanFringe(
  parent: THREE.Group,
  colliders: PropCollider[],
): Promise<number> {
  const loader = new GLTFLoader()
  const cache = new Map<string, THREE.Object3D>()
  const rng = mulberry32(0xf00d)

  const specs: PlaceSpec[] = [
    ...buildRoad(),
    ...buildVehicles(rng),
    ...buildClutter(rng),
    ...buildSuburban(),
    ...buildCommercial(),
  ]

  const urls = [...new Set(specs.map((s) => s.url))]
  await Promise.all(urls.map((u) => loadTemplate(loader, cache, u)))

  const urban = new THREE.Group()
  urban.name = 'UrbanFringe'
  parent.add(urban)

  for (const spec of specs) {
    const template = cache.get(spec.url)
    if (!template) {
      console.warn('[Steel] Missing urban prop', spec.url)
      continue
    }
    place(urban, template, spec, colliders)
  }

  console.info(`[Steel] Urban fringe F+G — ${specs.length} props`)
  return specs.length
}
