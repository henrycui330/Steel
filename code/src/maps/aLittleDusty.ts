import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { PropCollider } from '../collision'
import { createSandTexture } from '../textures'

/** Playable span — large desert bowl. */
export const DUSTY_SIZE = 1000
export const DUSTY_PLAYER = new THREE.Vector3(0, 0, -12)
export const DUSTY_ENEMY = new THREE.Vector3(48, 0, 72)

/** Flat camp pads (world XZ). */
export const DUSTY_CLEARINGS: ReadonlyArray<{ x: number; z: number; radius: number }> = [
  { x: -70, z: -40, radius: 16 },
  { x: 80, z: 35, radius: 14 },
  { x: -25, z: 110, radius: 15 },
  { x: 55, z: -120, radius: 13 },
  { x: -220, z: 80, radius: 18 },
  { x: 240, z: -60, radius: 16 },
  { x: -160, z: -240, radius: 14 },
  { x: 190, z: 220, radius: 15 },
  { x: 0, z: -280, radius: 17 },
  { x: -300, z: -40, radius: 14 },
]

export type DustyMapLoadResult = {
  root: THREE.Group
  colliders: PropCollider[]
  groundY: number
  heightAt: (x: number, z: number) => number
}

const SEG = 160
const TENT_URL = '/maps/props/military_tent_desert.glb'
const CRATES_URL = '/maps/props/crates_and_barrels.glb'
const HOUSE_URLS = [
  '/maps/props/desert_house_01.glb',
  '/maps/props/desert_house_02.glb',
] as const

/** Standalone house sites. `kind`: small = desert_house_01 (tent-scale), large = couple-style (huge). */
const DUSTY_HOUSES: ReadonlyArray<{
  x: number
  z: number
  yaw: number
  size: number
  kind: 'small' | 'large'
}> = [
  // Couple-of-desert-style houses — large landmark buildings
  { x: -240, z: 95, yaw: 0.55, size: 58, kind: 'large' },
  { x: 260, z: -75, yaw: -1.1, size: 68, kind: 'large' },
  { x: -145, z: -260, yaw: 2.2, size: 62, kind: 'large' },
  // desert_house_01 — tent-comparable
  { x: 205, z: 235, yaw: -0.35, size: 10, kind: 'small' },
  { x: 16, z: 140, yaw: 1.4, size: 9.5, kind: 'small' },
  { x: -48, z: -95, yaw: -2.0, size: 10.5, kind: 'small' },
  { x: 110, z: 50, yaw: 0.9, size: 9.8, kind: 'small' },
]

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()

/** Flat disk: hard core, soft rim. 0 = fully flat, 1 = full dunes. */
function padBlend(dist: number, radius: number, coreFrac = 0.72): number {
  if (dist >= radius) return 1
  const core = radius * coreFrac
  if (dist <= core) return 0
  const u = (dist - core) / (radius - core)
  return u * u * (3 - 2 * u)
}

/** World-space pad radius so the full footprint sits on flat ground. */
function housePadRadius(h: (typeof DUSTY_HOUSES)[number]): number {
  return h.kind === 'large' ? h.size * 0.92 : h.size * 1.25
}

function clearingFactor(x: number, z: number): number {
  let f = 1
  for (const c of DUSTY_CLEARINGS) {
    f = Math.min(f, padBlend(Math.hypot(x - c.x, z - c.z), c.radius, 0.7))
  }
  for (const h of DUSTY_HOUSES) {
    f = Math.min(f, padBlend(Math.hypot(x - h.x, z - h.z), housePadRadius(h), 0.78))
  }
  return f
}

/** Climbable dunes (~3–5 m peaks) with flat pads at camps/houses. */
export function dustyHeightAt(x: number, z: number): number {
  // Frequencies stretched for 1000 m arena.
  const d1 = Math.sin(x * 0.007) * Math.cos(z * 0.006) * 4.2
  const d2 = Math.sin(x * 0.014 + 1.7) * Math.sin(z * 0.011 - 0.4) * 2.4
  const d3 = Math.sin((x + z) * 0.0045) * 1.6
  const d4 = Math.cos(x * 0.019) * Math.sin(z * 0.017) * 0.9
  const raw = d1 + d2 + d3 + d4
  // Soft bowl so edges rise a bit (keeps you in the playfield)
  const edge = Math.max(Math.abs(x), Math.abs(z)) / (DUSTY_SIZE * 0.48)
  const rim = edge > 0.75 ? (edge - 0.75) * (edge - 0.75) * 18 : 0
  return (raw + rim) * clearingFactor(x, z)
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
      obj.frustumCulled = false
    }
  })
}

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => m.clone())
    } else if (obj.material) {
      obj.material = obj.material.clone()
    }
  })
}

/** Warm adobe / sand tint for desert_house_01 (often ships grey / washed out). */
function tintDesertHouse01(root: THREE.Object3D): void {
  const adobe = new THREE.Color(0xd2b48c)
  const terracotta = new THREE.Color(0xc47a4a)
  const plaster = new THREE.Color(0xe8d4b0)
  let i = 0
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || !('color' in m) || !(m.color instanceof THREE.Color)) continue
      const pick = i % 3 === 0 ? adobe : i % 3 === 1 ? plaster : terracotta
      m.color.lerp(pick, 0.72)
      if ('roughness' in m && typeof m.roughness === 'number') {
        m.roughness = Math.min(1, Math.max(0.75, m.roughness))
      }
      if ('metalness' in m && typeof m.metalness === 'number') {
        m.metalness = Math.min(0.08, m.metalness)
      }
      m.needsUpdate = true
      i++
    }
  })
}

/** Scale so longest AABB axis ≈ target, then plant on terrain. */
function plantScaled(
  src: THREE.Object3D,
  parent: THREE.Object3D,
  x: number,
  z: number,
  yaw: number,
  targetLongest: number,
  heightAt: (x: number, z: number) => number,
): THREE.Object3D {
  const obj = src.clone(true)
  cloneMaterials(obj)
  obj.rotation.set(0, 0, 0)
  obj.position.set(0, 0, 0)
  obj.scale.setScalar(1)
  obj.updateMatrixWorld(true)
  _box.setFromObject(obj)
  _box.getSize(_size)
  const longest = Math.max(_size.x, _size.y, _size.z, 0.001)
  obj.scale.setScalar(targetLongest / longest)
  obj.rotation.y = yaw
  obj.position.set(x, 0, z)
  obj.updateMatrixWorld(true)
  _box.setFromObject(obj)
  obj.position.y = heightAt(x, z) - _box.min.y
  enableShadows(obj)
  parent.add(obj)
  return obj
}

/** Tight cylinder from object AABB (tents / crates / barrels). */
function circleColliderFromObject(
  obj: THREE.Object3D,
  radiusScale = 0.42,
): PropCollider {
  obj.updateMatrixWorld(true)
  _box.setFromObject(obj)
  _box.getCenter(_center)
  _box.getSize(_size)
  const footprint = Math.max(_size.x, _size.z)
  return {
    x: _center.x,
    z: _center.z,
    radius: Math.max(0.35, footprint * radiusScale),
    maxY: _box.min.y + Math.max(1.2, _size.y * 0.92),
  }
}

/**
 * Oriented box from solid footprint. Measures with yaw=0 so hx/hz match the mesh,
 * then restores yaw and rotates the center offset.
 */
function boxColliderFromObject(obj: THREE.Object3D, inset = 0.88): PropCollider {
  const yaw = obj.rotation.y
  obj.rotation.y = 0
  obj.updateMatrixWorld(true)
  _box.setFromObject(obj)
  _box.getCenter(_center)
  _box.getSize(_size)
  const ox = _center.x - obj.position.x
  const oz = _center.z - obj.position.z
  const maxY = _box.max.y + 0.15
  obj.rotation.y = yaw
  obj.updateMatrixWorld(true)

  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const wx = obj.position.x + ox * c + oz * s
  const wz = obj.position.z - ox * s + oz * c
  const hx = Math.max(0.6, (_size.x * 0.5) * inset)
  const hz = Math.max(0.6, (_size.z * 0.5) * inset)
  return {
    x: wx,
    z: wz,
    hx,
    hz,
    yaw,
    radius: Math.hypot(hx, hz),
    maxY,
  }
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (!found && obj.name === name) found = obj
  })
  return found
}

function buildDuneMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(DUSTY_SIZE, DUSTY_SIZE, SEG, SEG)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, dustyHeightAt(x, z))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()

  const sandMap = createSandTexture(Math.max(28, DUSTY_SIZE / 14))
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8d4b0,
    map: sandMap,
    roughness: 0.97,
    metalness: 0.02,
    flatShading: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'dustyDunes'
  mesh.receiveShadow = true
  mesh.castShadow = false
  return mesh
}

function markClearings(root: THREE.Group): void {
  const padMap = createSandTexture(8)
  for (const c of DUSTY_CLEARINGS) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(c.radius * 0.92, c.radius, 48),
      new THREE.MeshStandardMaterial({
        color: 0xc9b088,
        map: padMap,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(c.x, dustyHeightAt(c.x, c.z) + 0.04, c.z)
    ring.receiveShadow = true
    ring.name = 'dustyClearing'
    root.add(ring)

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(c.radius * 0.9, 32),
      new THREE.MeshStandardMaterial({
        color: 0xd4bc94,
        map: padMap,
        roughness: 0.98,
        metalness: 0,
      }),
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(c.x, dustyHeightAt(c.x, c.z) + 0.02, c.z)
    pad.receiveShadow = true
    pad.name = 'dustyPad'
    root.add(pad)
  }
}

/** Visible packed-sand slabs under every house (matches heightAt flats). */
function markHousePads(root: THREE.Group): void {
  const padMap = createSandTexture(10)
  for (let i = 0; i < DUSTY_HOUSES.length; i++) {
    const h = DUSTY_HOUSES[i]
    const rad = housePadRadius(h) * 0.88
    const y = dustyHeightAt(h.x, h.z) + 0.025
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(rad, 40),
      new THREE.MeshStandardMaterial({
        color: h.kind === 'large' ? 0xcbb892 : 0xd2bc96,
        map: padMap,
        roughness: 0.98,
        metalness: 0,
      }),
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(h.x, y, h.z)
    pad.receiveShadow = true
    pad.name = `dustyHousePad_${i}`
    root.add(pad)
  }
}

async function placeDesertProps(
  root: THREE.Group,
  colliders: PropCollider[],
): Promise<void> {
  const loader = new GLTFLoader()
  const [tentGltf, crateGltf, house0, house1] = await Promise.all([
    loader.loadAsync(TENT_URL),
    loader.loadAsync(CRATES_URL),
    loader.loadAsync(HOUSE_URLS[0]),
    loader.loadAsync(HOUSE_URLS[1]),
  ])

  const tentSrc = tentGltf.scene
  tentSrc.updateMatrixWorld(true)
  const houseSmallSrc = house0.scene // desert_house_01
  const houseLargeSrc = house1.scene // couple-style Cover house 2
  houseSmallSrc.updateMatrixWorld(true)
  houseLargeSrc.updateMatrixWorld(true)

  const crateNames = ['Crate', 'Crate.001', 'Crate.002']
  const barrelNames = ['Barrel', 'Barrel.001', 'Barrel.002']
  const crateSrcs: THREE.Object3D[] = crateNames
    .map((n) => findByName(crateGltf.scene, n))
    .filter((o): o is THREE.Object3D => !!o)
  const barrelSrcs: THREE.Object3D[] = barrelNames
    .map((n) => findByName(crateGltf.scene, n))
    .filter((o): o is THREE.Object3D => !!o)

  if (crateSrcs.length === 0) {
    console.warn('[Steel] No crate nodes found — using whole crates GLB')
    crateSrcs.push(crateGltf.scene)
  }
  if (barrelSrcs.length === 0) {
    barrelSrcs.push(crateGltf.scene)
  }

  const rand = mulberry32(0xd057)
  let tentCount = 0
  let clutterCount = 0
  let houseCount = 0

  for (let i = 0; i < DUSTY_HOUSES.length; i++) {
    const site = DUSTY_HOUSES[i]
    const src = site.kind === 'large' ? houseLargeSrc : houseSmallSrc
    const house = plantScaled(
      src,
      root,
      site.x,
      site.z,
      site.yaw,
      site.size,
      dustyHeightAt,
    )
    if (site.kind === 'small') tintDesertHouse01(house)
    house.name = site.kind === 'large' ? `dustyHouseLarge_${i}` : `dustyHouse01_${i}`
    colliders.push(boxColliderFromObject(house, site.kind === 'large' ? 0.86 : 0.9))
    houseCount++
  }

  for (let i = 0; i < DUSTY_CLEARINGS.length; i++) {
    const c = DUSTY_CLEARINGS[i]
    // 1–2 tents per clearing
    const tentsHere = 1 + (rand() > 0.55 ? 1 : 0)
    for (let t = 0; t < tentsHere; t++) {
      const ang = rand() * Math.PI * 2
      const rad = c.radius * (0.15 + rand() * 0.35)
      const x = c.x + Math.cos(ang) * rad
      const z = c.z + Math.sin(ang) * rad
      const yaw = rand() * Math.PI * 2
      const tent = plantScaled(tentSrc, root, x, z, yaw, 9.5 + rand() * 1.5, dustyHeightAt)
      tent.name = `dustyTent_${i}_${t}`
      colliders.push(circleColliderFromObject(tent, 0.38))
      tentCount++
    }

    // Crates / barrels ring around pad edge
    const clutter = 4 + Math.floor(rand() * 4)
    for (let k = 0; k < clutter; k++) {
      const ang = rand() * Math.PI * 2
      const rad = c.radius * (0.55 + rand() * 0.4)
      const x = c.x + Math.cos(ang) * rad
      const z = c.z + Math.sin(ang) * rad
      const yaw = rand() * Math.PI * 2
      const useBarrel = rand() > 0.45 && barrelSrcs.length > 0
      const src = useBarrel
        ? barrelSrcs[Math.floor(rand() * barrelSrcs.length)]
        : crateSrcs[Math.floor(rand() * crateSrcs.length)]
      const size = useBarrel ? 1.05 + rand() * 0.25 : 1.35 + rand() * 0.45
      const prop = plantScaled(src, root, x, z, yaw, size, dustyHeightAt)
      prop.name = useBarrel ? `dustyBarrel_${i}_${k}` : `dustyCrate_${i}_${k}`
      colliders.push(circleColliderFromObject(prop, useBarrel ? 0.4 : 0.36))
      clutterCount++
    }
  }

  // A few lone supply piles between camps
  for (let i = 0; i < 10; i++) {
    const x = (rand() - 0.5) * DUSTY_SIZE * 0.7
    const z = (rand() - 0.5) * DUSTY_SIZE * 0.7
    let nearCamp = false
    for (const c of DUSTY_CLEARINGS) {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + 18) {
        nearCamp = true
        break
      }
    }
    if (nearCamp) continue
    const yaw = rand() * Math.PI * 2
    const useBarrel = rand() > 0.5
    const src = useBarrel
      ? barrelSrcs[Math.floor(rand() * barrelSrcs.length)]
      : crateSrcs[Math.floor(rand() * crateSrcs.length)]
    const size = useBarrel ? 1.1 : 1.5
    const prop = plantScaled(src, root, x, z, yaw, size, dustyHeightAt)
    prop.name = `dustyLone_${i}`
    colliders.push(circleColliderFromObject(prop, 0.36))
    clutterCount++
  }

  console.info(
    `[Steel] Desert props — ${houseCount} houses, ${tentCount} tents, ${clutterCount} crates/barrels, ${colliders.length} colliders`,
  )
}

/**
 * “A little dusty” — dune bowl, houses, camp clearings, tents + supply clutter.
 */
export async function loadALittleDusty(
  scene: THREE.Scene,
  ground: THREE.Mesh,
): Promise<DustyMapLoadResult> {
  ground.visible = false

  const root = new THREE.Group()
  root.name = 'ALittleDusty'
  root.add(buildDuneMesh())
  markClearings(root)
  markHousePads(root)

  const colliders: PropCollider[] = []
  try {
    await placeDesertProps(root, colliders)
  } catch (err) {
    console.warn('[Steel] Desert props failed to load', err)
  }

  scene.add(root)

  console.info(
    `[Steel] A little dusty — ${DUSTY_SIZE}m arena, ${DUSTY_CLEARINGS.length} clearings`,
  )
  return {
    root,
    colliders,
    groundY: 0,
    heightAt: dustyHeightAt,
  }
}
