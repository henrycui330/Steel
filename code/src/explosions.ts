import * as THREE from 'three'

/**
 * Three-part blasts (no sphere / ring FX):
 * 1. Hot gas — irregular blobs, expand fast, non-uniform axes
 * 2. Heat wave — jagged shell that blooms around the gas
 * 3. Shrapnel — tiny flakes flung every direction
 */

const MAX_LIVE = 64
const GAS_TEMPLATES = 5
const WAVE_TEMPLATES = 4

type PieceKind = 'gas' | 'heat' | 'shrapnel'

type Piece = {
  kind: PieceKind
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  age: number
  life: number
  s0: THREE.Vector3
  s1: THREE.Vector3
  op0: number
  vel?: THREE.Vector3
  spin?: THREE.Vector3
  gravity?: number
  /** Own geo (shrapnel reuse shared; gas/heat use templates). */
  disposeGeo?: boolean
}

const live: Piece[] = []
const _scale = new THREE.Vector3()

/** Prebuilt jagged volumes — never a clean ball. */
const gasGeos: THREE.BufferGeometry[] = []
const heatGeos: THREE.BufferGeometry[] = []
const shardGeo = new THREE.BoxGeometry(0.1, 0.03, 0.055)

function scrambleBlob(
  geo: THREE.BufferGeometry,
  jagged: number,
  flattenY: number,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // Radial noise so the silhouette isn't round.
    const push = 0.45 + Math.random() * jagged
    v.normalize().multiplyScalar(push)
    v.x *= 0.55 + Math.random() * 0.95
    v.y *= flattenY * (0.4 + Math.random() * 0.9)
    v.z *= 0.55 + Math.random() * 0.95
    // Occasional spikes / dents.
    if (Math.random() < 0.18) v.multiplyScalar(1.35 + Math.random() * 0.55)
    if (Math.random() < 0.12) v.multiplyScalar(0.55 + Math.random() * 0.25)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
}

function ensureTemplates(): void {
  if (gasGeos.length > 0) return
  for (let i = 0; i < GAS_TEMPLATES; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1)
    scrambleBlob(g, 1.35, 0.75)
    gasGeos.push(g)
  }
  for (let i = 0; i < WAVE_TEMPLATES; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1)
    scrambleBlob(g, 1.7, 0.55)
    heatGeos.push(g)
  }
}

export type ExplosionKind = 'shell' | 'he' | 'rocket' | 'bomb' | 'kill'

export type ExplosionBurstOpts = {
  scene: THREE.Scene
  at: THREE.Vector3
  radius: number
  kind?: ExplosionKind
}

function kindScale(kind: ExplosionKind): number {
  switch (kind) {
    case 'bomb':
      return 1.2
    case 'rocket':
      return 1
    case 'kill':
      return 0.9
    case 'he':
      return 0.72
    default:
      return 0.48
  }
}

function pruneOldest(): void {
  while (live.length >= MAX_LIVE) {
    const p = live.shift()
    if (!p) break
    killPiece(p)
  }
}

function killPiece(p: Piece): void {
  p.mesh.parent?.remove(p.mesh)
  p.mat.dispose()
  if (p.disposeGeo) p.mesh.geometry.dispose()
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0]!
}

function addPiece(
  scene: THREE.Scene,
  geo: THREE.BufferGeometry,
  at: THREE.Vector3,
  color: number,
  opts: {
    kind: PieceKind
    life: number
    s0: THREE.Vector3
    s1: THREE.Vector3
    op0: number
    vel?: THREE.Vector3
    spin?: THREE.Vector3
    gravity?: number
    additive?: boolean
    wire?: boolean
  },
): void {
  pruneOldest()
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opts.op0,
    depthWrite: opts.kind === 'shrapnel',
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    wireframe: !!opts.wire,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(at)
  mesh.scale.copy(opts.s0)
  mesh.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  )
  mesh.frustumCulled = true
  scene.add(mesh)
  live.push({
    kind: opts.kind,
    mesh,
    mat,
    age: 0,
    life: opts.life,
    s0: opts.s0.clone(),
    s1: opts.s1.clone(),
    op0: opts.op0,
    vel: opts.vel,
    spin: opts.spin,
    gravity: opts.gravity,
  })
}

/** Non-uniform start/end scales so growth never looks spherical. */
function irregularScale(base: number, spread: number): THREE.Vector3 {
  return new THREE.Vector3(
    base * (0.55 + Math.random() * spread),
    base * (0.35 + Math.random() * spread * 0.85),
    base * (0.55 + Math.random() * spread),
  )
}

export function spawnExplosion(opts: ExplosionBurstOpts): void {
  ensureTemplates()
  const { scene, at } = opts
  const kind = opts.kind ?? 'he'
  const r = Math.max(2.2, opts.radius) * kindScale(kind)
  const origin = at.clone()
  origin.y += 0.4

  // ——— 1. Hot gas (NOT circular) — several jagged lobes, expand very fast ———
  const gasCount = kind === 'bomb' ? 5 : kind === 'rocket' ? 4 : 3
  for (let i = 0; i < gasCount; i++) {
    const geo = pick(gasGeos)
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * r * 0.22,
      (Math.random() - 0.5) * r * 0.12,
      (Math.random() - 0.5) * r * 0.22,
    )
    const hot = i === 0
    addPiece(scene, geo, origin.clone().add(offset), hot ? 0xfff2c4 : 0xff7a28, {
      kind: 'gas',
      life: 0.18 + Math.random() * 0.14 + r * 0.004,
      s0: irregularScale(r * 0.08, 0.9),
      s1: irregularScale(r * (0.7 + Math.random() * 0.55), 1.1),
      op0: hot ? 1 : 0.85,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 4,
      ),
    })
  }

  // ——— 2. Heat wave (NOT circular) — jagged shell blooming around the gas ———
  const waveCount = kind === 'bomb' ? 3 : 2
  for (let i = 0; i < waveCount; i++) {
    const geo = pick(heatGeos)
    const delayBias = 0.04 + i * 0.05
    addPiece(scene, geo, origin, i === 0 ? 0xffd090 : 0xffa050, {
      kind: 'heat',
      life: 0.42 + delayBias + r * 0.01,
      s0: irregularScale(r * 0.2, 0.7),
      s1: irregularScale(r * (1.35 + i * 0.35), 1.25),
      op0: 0.55 - i * 0.12,
      wire: i > 0,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 1.5,
      ),
    })
  }

  // ——— 3. Shrapnel — tiny bits every direction ———
  const nShards = Math.min(
    36,
    Math.round(14 + r * 0.9 + (kind === 'bomb' ? 10 : kind === 'kill' ? 6 : 0)),
  )
  for (let i = 0; i < nShards; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    )
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0)
    dir.normalize()
    // Bias a little upward so debris arcs instead of burying.
    dir.y += 0.15
    dir.normalize()
    const speed = 14 + Math.random() * (18 + r * 0.8)
    const hot = Math.random() < 0.35
    const len = 0.55 + Math.random() * 1.1
    addPiece(scene, shardGeo, origin, hot ? 0xffb060 : 0x4a453e, {
      kind: 'shrapnel',
      life: 0.55 + Math.random() * 0.7,
      s0: new THREE.Vector3(len, 0.7 + Math.random() * 0.6, 0.5 + Math.random() * 0.5),
      s1: new THREE.Vector3(len * 0.4, 0.25, 0.2),
      op0: hot ? 1 : 0.95,
      additive: hot,
      vel: dir.multiplyScalar(speed),
      gravity: 22 + Math.random() * 14,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 28,
        (Math.random() - 0.5) * 28,
        (Math.random() - 0.5) * 28,
      ),
    })
  }

  console.info(
    `[Steel] Explosion ${kind} gas+heat+shrapnel r=${opts.radius.toFixed(1)} pieces=${live.length}`,
  )
}

export function updateExplosions(dt: number): void {
  const step = Math.min(dt, 0.05)
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i]!
    p.age += step
    const u = Math.min(1, p.age / p.life)

    // Gas: ease-out rocket expand. Heat: slightly delayed bloom. Shrapnel: shrink.
    let t = u
    if (p.kind === 'gas') t = 1 - (1 - u) * (1 - u) * (1 - u)
    else if (p.kind === 'heat') {
      const delayed = Math.max(0, (u - 0.08) / 0.92)
      t = 1 - (1 - delayed) * (1 - delayed)
    } else {
      t = u
    }

    _scale.lerpVectors(p.s0, p.s1, t)
    p.mesh.scale.copy(_scale)

    if (p.kind === 'gas') {
      p.mat.opacity = p.op0 * (1 - u * u)
    } else if (p.kind === 'heat') {
      p.mat.opacity = p.op0 * (1 - u) * (0.4 + 0.6 * Math.sin(Math.min(1, u * 3) * Math.PI))
    } else {
      p.mat.opacity = p.op0 * (1 - u * 0.85)
    }

    if (p.spin) {
      p.mesh.rotation.x += p.spin.x * step
      p.mesh.rotation.y += p.spin.y * step
      p.mesh.rotation.z += p.spin.z * step
    }

    if (p.vel) {
      p.vel.y -= (p.gravity ?? 16) * step
      p.mesh.position.addScaledVector(p.vel, step)
      p.vel.multiplyScalar(Math.exp(-0.85 * step))
      // Align long axis loosely with flight for flakes.
      if (p.kind === 'shrapnel' && p.vel.lengthSq() > 4) {
        p.mesh.lookAt(
          p.mesh.position.x + p.vel.x,
          p.mesh.position.y + p.vel.y,
          p.mesh.position.z + p.vel.z,
        )
      }
    }

    if (p.age >= p.life) {
      killPiece(p)
      live.splice(i, 1)
    }
  }
}

export function disposeExplosions(): void {
  for (const p of live) killPiece(p)
  live.length = 0
}
