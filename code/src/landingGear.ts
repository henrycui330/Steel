import * as THREE from 'three'

const GEAR_DURATION = 1.45
/** Faces below this fraction of model height (from the belly) count as gear. */
const BOTTOM_FRAC = 0.32
/** Min gear faces on a mesh before we carve / claim it. */
const MIN_GEAR_FACES = 24

type GearLeg = {
  pivot: THREE.Object3D
  axis: THREE.Vector3
  retractRad: number
  restQuat: THREE.Quaternion
}

export type LandingGear = {
  readonly down: boolean
  readonly busy: boolean
  toggle: () => void
  setDown: (down: boolean) => void
  update: (dt: number) => void
}

const _q = new THREE.Quaternion()
const _axis = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _ctr = new THREE.Vector3()

type MeshCarve = {
  mesh: THREE.Mesh
  gearIndex: number[]
  keepIndex: number[]
  gearFaceCount: number
  gearOnly: boolean
}

function worldPosAttr(mesh: THREE.Mesh): THREE.BufferAttribute | null {
  const pos = mesh.geometry.getAttribute('position')
  if (!(pos instanceof THREE.BufferAttribute)) return null
  mesh.updateWorldMatrix(true, false)
  const out = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    out[i * 3] = v.x
    out[i * 3 + 1] = v.y
    out[i * 3 + 2] = v.z
  }
  return new THREE.BufferAttribute(out, 3)
}

function partitionFaces(mesh: THREE.Mesh, yCut: number): MeshCarve | null {
  const geom = mesh.geometry
  const pos = geom.getAttribute('position')
  if (!(pos instanceof THREE.BufferAttribute)) return null
  const world = worldPosAttr(mesh)
  if (!world) return null

  const index = geom.getIndex()
  const gearIndex: number[] = []
  const keepIndex: number[] = []
  let gearFaceCount = 0

  const faceCount = index ? index.count / 3 : Math.floor(pos.count / 3)
  for (let f = 0; f < faceCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2
    _a.fromBufferAttribute(world, i0)
    _b.fromBufferAttribute(world, i1)
    _c.fromBufferAttribute(world, i2)
    const cy = (_a.y + _b.y + _c.y) / 3
    if (cy <= yCut) {
      gearIndex.push(i0, i1, i2)
      gearFaceCount++
    } else {
      keepIndex.push(i0, i1, i2)
    }
  }
  if (gearFaceCount < MIN_GEAR_FACES) return null
  const totalFaces = faceCount || 1
  const gearOnly =
    keepIndex.length < 9 || gearFaceCount / totalFaces > 0.72
  return { mesh, gearIndex, keepIndex, gearFaceCount, gearOnly }
}

function buildGeometryFromFaces(
  source: THREE.BufferGeometry,
  faceIndices: number[],
): THREE.BufferGeometry | null {
  if (faceIndices.length < 9) return null
  const pos = source.getAttribute('position') as THREE.BufferAttribute
  const norm = source.getAttribute('normal') as THREE.BufferAttribute | null
  const uv = source.getAttribute('uv') as THREE.BufferAttribute | null

  const used = new Map<number, number>()
  const newPos: number[] = []
  const newNorm: number[] = []
  const newUv: number[] = []
  const newIndex: number[] = []

  const mapVert = (i: number): number => {
    const hit = used.get(i)
    if (hit !== undefined) return hit
    const ni = used.size
    used.set(i, ni)
    newPos.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    if (norm) newNorm.push(norm.getX(i), norm.getY(i), norm.getZ(i))
    if (uv) newUv.push(uv.getX(i), uv.getY(i))
    return ni
  }

  for (let i = 0; i < faceIndices.length; i += 3) {
    newIndex.push(
      mapVert(faceIndices[i]!),
      mapVert(faceIndices[i + 1]!),
      mapVert(faceIndices[i + 2]!),
    )
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3))
  if (newNorm.length) {
    g.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3))
  } else {
    g.computeVertexNormals()
  }
  if (newUv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2))
  g.setIndex(newIndex)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function sideOfCentroid(x: number, spanX: number): 'left' | 'right' | 'tail' {
  const sideGate = spanX * 0.12
  if (x < -sideGate) return 'left'
  if (x > sideGate) return 'right'
  return 'tail'
}

type LegBuild = {
  side: 'left' | 'right' | 'tail'
  mesh: THREE.Mesh
  faces: number[]
}

function carveGearLegs(model: THREE.Object3D): GearLeg[] {
  model.updateMatrixWorld(true)
  _box.setFromObject(model)
  _box.getSize(_size)
  const yCut = _box.min.y + _size.y * BOTTOM_FRAC
  const spanX = Math.max(_size.x, 0.001)

  const meshes: THREE.Mesh[] = []
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry) meshes.push(o)
  })

  const carves: MeshCarve[] = []
  for (const mesh of meshes) {
    const part = partitionFaces(mesh, yCut)
    if (part) carves.push(part)
  }
  if (carves.length === 0) return []

  const perSide: Record<'left' | 'right' | 'tail', LegBuild | null> = {
    left: null,
    right: null,
    tail: null,
  }

  for (const carve of carves) {
    const world = worldPosAttr(carve.mesh)!
    const faceCount = carve.gearIndex.length / 3
    const sideFaces: Record<'left' | 'right' | 'tail', number[]> = {
      left: [],
      right: [],
      tail: [],
    }
    for (let f = 0; f < faceCount; f++) {
      const i0 = carve.gearIndex[f * 3]!
      const i1 = carve.gearIndex[f * 3 + 1]!
      const i2 = carve.gearIndex[f * 3 + 2]!
      _a.fromBufferAttribute(world, i0)
      _b.fromBufferAttribute(world, i1)
      _c.fromBufferAttribute(world, i2)
      const cx = (_a.x + _b.x + _c.x) / 3
      const side = sideOfCentroid(cx, spanX)
      sideFaces[side].push(i0, i1, i2)
    }
    for (const side of ['left', 'right', 'tail'] as const) {
      if (sideFaces[side].length < 9) continue
      const prev = perSide[side]
      if (!prev) {
        perSide[side] = {
          side,
          mesh: carve.mesh,
          faces: sideFaces[side],
        }
      } else if (prev.mesh === carve.mesh) {
        prev.faces.push(...sideFaces[side])
      }
    }
  }

  // Build legs from original geometries first.
  const legs: GearLeg[] = []
  for (const side of ['left', 'right', 'tail'] as const) {
    const build = perSide[side]
    if (!build) continue
    const geom = buildGeometryFromFaces(build.mesh.geometry, build.faces)
    if (!geom?.boundingBox) continue

    const wrap = new THREE.Group()
    wrap.name = `gear-${side}`
    wrap.position.copy(build.mesh.position)
    wrap.quaternion.copy(build.mesh.quaternion)
    wrap.scale.copy(build.mesh.scale)

    const pivot = new THREE.Group()
    pivot.name = `gear-pivot-${side}`
    const bb = geom.boundingBox
    const top = new THREE.Vector3(
      (bb.min.x + bb.max.x) * 0.5,
      bb.max.y,
      (bb.min.z + bb.max.z) * 0.5,
    )
    pivot.position.copy(top)

    const mesh = new THREE.Mesh(geom, build.mesh.material)
    mesh.name = `gear-mesh-${side}`
    mesh.castShadow = true
    mesh.frustumCulled = false
    mesh.position.copy(top).multiplyScalar(-1)
    // Keep verts in source-local space: offset so hinge is at pivot origin.
    mesh.position.set(-top.x, -top.y, -top.z)
    pivot.add(mesh)
    wrap.add(pivot)
    model.add(wrap)

    legs.push({
      pivot,
      axis:
        side === 'tail'
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 0, 1),
      retractRad: side === 'left' ? -1.55 : side === 'right' ? 1.55 : 1.4,
      restQuat: pivot.quaternion.clone(),
    })
  }

  // Then strip gear faces from (or hide) the source meshes.
  for (const carve of carves) {
    if (carve.gearOnly) {
      carve.mesh.visible = false
      continue
    }
    const kept = buildGeometryFromFaces(carve.mesh.geometry, carve.keepIndex)
    if (kept) {
      carve.mesh.geometry.dispose()
      carve.mesh.geometry = kept
    }
  }

  return legs
}

/** Yak-1 pack: `stv_gl1/2` one side, `stv_gl03/04` the other. */
function legsFromYak1Groups(model: THREE.Object3D): GearLeg[] {
  model.updateMatrixWorld(true)
  const groups: Array<{ names: string[] }> = [
    { names: ['stv_gl1', 'stv_gl2'] },
    { names: ['stv_gl03', 'stv_gl04', 'stv_gl3', 'stv_gl4'] },
  ]
  const found: Array<{ nodes: THREE.Object3D[]; x: number }> = []
  for (const g of groups) {
    const nodes: THREE.Object3D[] = []
    for (const name of g.names) {
      const n = model.getObjectByName(name)
      if (n) nodes.push(n)
    }
    if (nodes.length === 0) continue
    _box.makeEmpty()
    for (const n of nodes) _box.expandByObject(n)
    if (_box.isEmpty()) continue
    found.push({ nodes, x: _box.getCenter(_ctr).x })
  }
  if (found.length === 0) return []
  found.sort((a, b) => a.x - b.x)

  const legs: GearLeg[] = []
  found.forEach((side, i) => {
    const retractRad = i === 0 ? -1.55 : 1.55
    for (const node of side.nodes) {
      legs.push({
        pivot: node,
        axis: new THREE.Vector3(0, 0, 1),
        retractRad,
        restQuat: node.quaternion.clone(),
      })
    }
  })
  return legs
}

/**
 * Procedural retract for fighters that ship gear-down but no clips.
 * Order: named Yak-9 → Yak-1 `stv_gl*` groups → belly-face carve.
 */
export function createLandingGear(model: THREE.Object3D): LandingGear | null {
  let legs: GearLeg[] = []

  const namedL = model.getObjectByName('Yak-9_Gear_L')
  const namedR = model.getObjectByName('Yak-9_Gear_R')
  const namedB = model.getObjectByName('Yak-9_Gear_B')
  if (namedL || namedR || namedB) {
    for (const [node, axis, rad] of [
      [namedL, new THREE.Vector3(0, 0, 1), -1.55],
      [namedR, new THREE.Vector3(0, 0, 1), 1.55],
      [namedB, new THREE.Vector3(1, 0, 0), 1.35],
    ] as const) {
      if (!node) continue
      legs.push({
        pivot: node,
        axis: axis.clone(),
        retractRad: rad,
        restQuat: node.quaternion.clone(),
      })
    }
  } else {
    const tail = model.getObjectByName('back_wheels')
    if (tail) {
      legs.push({
        pivot: tail,
        axis: new THREE.Vector3(1, 0, 0),
        retractRad: 1.2,
        restQuat: tail.quaternion.clone(),
      })
    }
    if (legs.length === 0) legs = legsFromYak1Groups(model)
    if (legs.length === 0) legs = carveGearLegs(model)
  }

  if (legs.length === 0) {
    console.warn('[Steel] No landing gear found on this airframe')
    return null
  }

  let t = 1
  let target = 1

  function apply(amount: number): void {
    const up = 1 - amount
    for (const leg of legs) {
      _axis.copy(leg.axis).normalize()
      _q.setFromAxisAngle(_axis, leg.retractRad * up)
      leg.pivot.quaternion.copy(leg.restQuat).multiply(_q)
    }
  }

  apply(1)
  console.info(
    `[Steel] Landing gear ready — ${legs.length} leg(s), G toggles. Start DOWN.`,
  )

  return {
    get down() {
      return target >= 0.5
    },
    get busy() {
      return Math.abs(t - target) > 0.001
    },
    toggle() {
      target = target >= 0.5 ? 0 : 1
      console.info(`[Steel] Gear ${target >= 0.5 ? 'DOWN' : 'UP'}`)
    },
    setDown(want) {
      target = want ? 1 : 0
    },
    update(dt) {
      if (Math.abs(t - target) < 0.0005) {
        t = target
        apply(t)
        return
      }
      const step = dt / GEAR_DURATION
      if (t < target) t = Math.min(target, t + step)
      else t = Math.max(target, t - step)
      const s = t * t * (3 - 2 * t)
      apply(s)
    },
  }
}
