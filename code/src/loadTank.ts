import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { tankOptionById, type TankId } from './tankCatalog'
import { paintTankDunkelgrau } from './paint'
import { applyTankWrap } from './wraps'
import { createShermanTank, type TankHandle } from './tank'

export type PlayerTankHandle = TankHandle & {
  /** Local mount on turret roof for the camera. */
  turretMount: THREE.Object3D
  /** Pitch-only pivot for the barrel (elevation). */
  barrel: THREE.Object3D
  /** Coax MG flash/spawn point (turret roof / beside barrel — not main muzzle). */
  mgMuzzle: THREE.Object3D
}

async function glbAvailable(url: string): Promise<boolean> {
  try {
    const clean = url.split('?')[0]
    const res = await fetch(clean, { method: 'HEAD' })
    if (!res.ok) return false
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('text/html')) return false
    return true
  } catch {
    return false
  }
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      // Cast onto ground only — receiving causes shadow-acne blotches on flat armor
      obj.castShadow = true
      obj.receiveShadow = false
    }
  })
}

/**
 * After yaw/pitch reparenting, stale bounds make meshes pop in/out while rotating.
 * Also harden depth state to reduce z-fight flicker on armor plates.
 */
function hardenMeshRendering(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.frustumCulled = false
    if (obj.geometry) {
      obj.geometry.computeBoundingSphere()
      obj.geometry.computeBoundingBox()
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      m.side = THREE.FrontSide
      m.depthTest = true
      m.depthWrite = true
      m.needsUpdate = true
    }
  })
}

function findNamed(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const name of names) {
    const hit = root.getObjectByName(name)
    if (hit) return hit
  }
  const lower = names.map((n) => n.toLowerCase())
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (found || !obj.name) return
    if (lower.includes(obj.name.toLowerCase())) found = obj
  })
  return found
}

function findTurretMesh(root: THREE.Object3D): THREE.Object3D {
  return findNamed(root, ['Turret', 'turret']) ?? root
}

function findBarrelMesh(root: THREE.Object3D, turretMesh: THREE.Object3D): THREE.Object3D | null {
  return (
    findNamed(turretMesh, ['Barrel', 'Gun', 'barrel', 'gun', 'Cannon', 'cannon']) ??
    findNamed(root, ['Barrel', 'Gun', 'barrel', 'gun', 'Cannon', 'cannon'])
  )
}

/**
 * Toshueyi Sketchfab Pz-IV uses DrawCall_* names (no Turret/Barrel).
 * Map: DrawCall_1 = turret, DrawCall_6 = barrel, DrawCall_7 = mantlet.
 */
function prepareToshueyiPz4(root: THREE.Object3D): boolean {
  const turret = root.getObjectByName('DrawCall_1')
  const barrel = root.getObjectByName('DrawCall_6')
  const mantlet = root.getObjectByName('DrawCall_7')
  if (!turret || !barrel) return false

  turret.name = 'Turret'
  barrel.name = 'Barrel'
  if (mantlet) {
    mantlet.name = 'GunMantlet'
    barrel.attach(mantlet)
  }
  console.info('[Steel] Toshueyi Pz-IV: labeled Turret/Barrel (+mantlet)')
  return true
}

/**
 * M24 Chaffee Sketchfab pack — Object_* only.
 * Object_20/21 ≈ turret (high), Object_7 ≈ barrel (forward stick).
 */
function prepareChaffee(root: THREE.Object3D): boolean {
  // Pershing / Firefly / Abrams also use Object_* — require real mesh parts.
  if (root.getObjectByName('Object_22') instanceof THREE.Mesh) return false
  if (root.getObjectByName('Object_141') && root.getObjectByName('Object_143')) return false
  const turretMain = root.getObjectByName('Object_20')
  const turretExtra = root.getObjectByName('Object_21')
  const barrel = root.getObjectByName('Object_7')
  if (!(turretMain instanceof THREE.Mesh) || !(barrel instanceof THREE.Mesh)) return false

  turretMain.name = 'Turret'
  if (turretExtra) {
    turretMain.attach(turretExtra)
  }
  barrel.name = 'Barrel'
  console.info('[Steel] Chaffee: labeled Turret/Barrel (Object_20/21 + Object_7)')
  return true
}

/**
 * Peel triangles matching `keep` into a sibling mesh (same local xform).
 */
function extractMeshRegion(
  mesh: THREE.Mesh,
  keep: (world: THREE.Vector3) => boolean,
  extractName: string,
): THREE.Mesh | null {
  mesh.updateMatrixWorld(true)
  const geom = mesh.geometry
  const pos = geom.attributes.position
  if (!pos) return null

  const world = new THREE.Vector3()
  const mark = new Uint8Array(pos.count)
  let marked = 0
  for (let i = 0; i < pos.count; i++) {
    world.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    if (keep(world)) {
      mark[i] = 1
      marked++
    }
  }
  if (marked < 8) return null

  const index = geom.index
  const triCount = index ? index.count / 3 : pos.count / 3
  const extractTris: number[] = []
  const remainTris: number[] = []
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    const score = mark[i0]! + mark[i1]! + mark[i2]!
    ;(score >= 2 ? extractTris : remainTris).push(i0, i1, i2)
  }
  if (extractTris.length < 9 || remainTris.length < 9) return null

  const build = (tris: number[]): THREE.BufferGeometry => {
    const remap = new Map<number, number>()
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const outIndex: number[] = []
    const nrm = geom.attributes.normal
    const uv = geom.attributes.uv
    for (const old of tris) {
      let ni = remap.get(old)
      if (ni === undefined) {
        ni = positions.length / 3
        remap.set(old, ni)
        positions.push(pos.getX(old), pos.getY(old), pos.getZ(old))
        if (nrm) normals.push(nrm.getX(old), nrm.getY(old), nrm.getZ(old))
        if (uv) uvs.push(uv.getX(old), uv.getY(old))
      }
      outIndex.push(ni)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (normals.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    if (uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(outIndex)
    g.computeBoundingSphere()
    return g
  }

  const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
  const extracted = new THREE.Mesh(build(extractTris), mat)
  extracted.name = extractName
  extracted.position.copy(mesh.position)
  extracted.quaternion.copy(mesh.quaternion)
  extracted.scale.copy(mesh.scale)
  mesh.parent?.add(extracted)

  const old = mesh.geometry
  mesh.geometry = build(remainTris)
  old.dispose()

  console.info(`[Steel] Split ${mesh.name} → ${extractName} (${marked} verts)`)
  return extracted
}

/**
 * Peel the forward gun tube out of a turret mesh that has the gun baked in
 * (Pz-III, T-34). Elongated +Z turret → cut near where the cross-section thins.
 */
function peelForwardGunStick(turretMesh: THREE.Mesh, zFrac = 0.58): THREE.Mesh | null {
  turretMesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(turretMesh)
  const size = box.getSize(new THREE.Vector3())
  if (size.z < size.x * 1.35) return null
  const zCut = box.min.z + size.z * zFrac
  const peeled = extractMeshRegion(turretMesh, (p) => p.z >= zCut, 'Barrel')
  if (peeled) {
    console.info(`[Steel] Peeled Barrel from ${turretMesh.name} at z≥${zCut.toFixed(2)}`)
  }
  return peeled
}

/**
 * Newc42 Pz-III — Hull/Turret named, gun baked into Turret. Peel forward stick → Barrel.
 */
function preparePz3(root: THREE.Object3D): boolean {
  if (!root.getObjectByName('PanzerIII')) return false
  const turret = root.getObjectByName('Turret')
  const hull = root.getObjectByName('Hull')
  if (!(turret instanceof THREE.Mesh)) return false
  if (hull) hull.name = 'Hull'
  turret.name = 'Turret'
  if (!root.getObjectByName('Barrel')) {
    if (!peelForwardGunStick(turret, 0.58)) {
      console.warn('[Steel] Pz-III: barrel peel failed — elevation will tip whole turret')
    }
  }
  console.info('[Steel] Pz-III: Hull/Turret + peeled Barrel')
  return true
}

/**
 * Leopard 1 — named Hull/Turret/Barrel already. Do **not** peel the mantlet off
 * the Barrel: a Z-cut severs the tube and leaves a floating ghost segment.
 * Mantlet elevating with the gun is acceptable for this pack.
 */
function prepareLeopard1(root: THREE.Object3D): boolean {
  if (!root.getObjectByName('Leopard1')) return false
  const barrel = root.getObjectByName('Barrel')
  const turret = root.getObjectByName('Turret')
  const hull = root.getObjectByName('Hull')
  if (!barrel || !turret) return false
  if (hull) hull.name = 'Hull'
  turret.name = 'Turret'
  barrel.name = 'Barrel'
  console.info('[Steel] Leopard 1: named Hull/Turret/Barrel (mantlet stays on barrel)')
  return true
}

/**
 * T-90 (`t90_tank.glb`) — Blender multi-mesh: Cube016 turret (gun under Cube038).
 * Already +Z forward. Older Donovian single-mesh kept as fallback.
 */
function prepareT90(root: THREE.Object3D): boolean {
  // New multi-mesh pack (Three.js strips dots: Cube.016 → Cube016).
  const turretGrp =
    root.getObjectByName('Cube016') ?? root.getObjectByName('Cube.016')
  const barrelGrp =
    root.getObjectByName('Cube038') ??
    root.getObjectByName('Cube.038') ??
    root.getObjectByName('Cube017') ??
    root.getObjectByName('Cube.017')
  if (turretGrp && barrelGrp) {
    turretGrp.name = 'Turret'
    barrelGrp.name = 'Barrel'
    console.info('[Steel] T-90 tank: Cube016 turret + Cube038 barrel (+Z)')
    return true
  }

  const bakedTurret = root.getObjectByName('Turret')
  const bakedHull = root.getObjectByName('Hull')
  if (bakedTurret instanceof THREE.Mesh && bakedHull instanceof THREE.Mesh) {
    console.info('[Steel] T-90 Donovian: baked Hull + Turret')
    return true
  }

  let isDonovian = false
  root.traverse((o) => {
    if (/t-90a|Elements_of_war|donovian/i.test(o.name)) isDonovian = true
  })
  const body = root.getObjectByName('Object_4')
  if (!isDonovian || !(body instanceof THREE.Mesh)) return false

  root.rotation.y = Math.PI
  root.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(body)
  const yCut = box.min.y + (box.max.y - box.min.y) * 0.36
  const peeled = extractMeshRegion(body, (p) => p.y >= yCut, 'Turret')
  if (!peeled) {
    console.warn('[Steel] T-90: height split failed')
    return false
  }
  body.name = 'Hull'
  peeled.name = 'Turret'
  console.info(`[Steel] T-90 Donovian: runtime peel at y≥${yCut.toFixed(2)}`)
  return true
}

/**
 * T-72 Ural — hull/turret/weapon hierarchy (same layout as Abrams pack).
 * Authored +X forward; rotate −90° Y so gun aligns with game +Z.
 */
function prepareT72(root: THREE.Object3D): boolean {
  let isT72 = false
  root.traverse((o) => {
    if (/t-?72|ural/i.test(o.name)) isT72 = true
  })
  if (!isT72) return false

  const turret = root.getObjectByName('turret')
  const weapon = root.getObjectByName('weapon')
  if (!turret || !weapon) return false

  root.rotation.y = -Math.PI / 2
  root.updateMatrixWorld(true)

  const hull = root.getObjectByName('hull')
  if (hull) hull.name = 'Hull'
  turret.name = 'Turret'
  weapon.name = 'Barrel'
  console.info('[Steel] T-72 Ural: turret + weapon (−90° Y)')
  return true
}

/**
 * T-55 (`t_55_sp01.glb`) — hull_0 / turret_0 / gun_0.
 * Authored gun toward −Z; rotate 180° Y to face game +Z.
 */
function prepareT55(root: THREE.Object3D): boolean {
  const turret = root.getObjectByName('turret_0')
  const gun = root.getObjectByName('gun_0')
  if (!turret || !gun) return false

  root.rotation.y = Math.PI
  root.updateMatrixWorld(true)

  const hull = root.getObjectByName('hull_0')
  if (hull) hull.name = 'Hull'
  turret.name = 'Turret'
  gun.name = 'Barrel'
  // Keep gun under turret so yaw carries it; elevation hinge uses Barrel origin (breech).
  turret.attach(gun)
  console.info('[Steel] T-55: turret_0 + gun_0 (180° Y, breech hinge)')
  return true
}

/**
 * T-44-100 (World of Tanks pack) — Turret_01 + gun_01Shape5.
 * Authored gun toward −Z; rotate 180° Y to face game +Z.
 */
function prepareT44(root: THREE.Object3D): boolean {
  const turret = root.getObjectByName('Turret_01')
  const gun = root.getObjectByName('gun_01Shape5')
  if (!turret || !gun) return false

  root.rotation.y = Math.PI
  root.updateMatrixWorld(true)

  turret.name = 'Turret'
  gun.name = 'Barrel'
  for (const n of ['Lamp', 'Camera', 'Object_22', 'Object_23', 'Object_25']) {
    const junk = root.getObjectByName(n)
    if (junk?.parent) junk.parent.remove(junk)
  }
  console.info('[Steel] T-44-100 WoT: Turret_01 + gun (180° Y)')
  return true
}

/**
 * PzH 2000 (`panzerhaubitze_2000_artillery_pzh-2000.glb`) — named parts.
 * hull / g_turret_pzh2000 / g_cannon_l52mk2. Already +Z forward.
 */
function preparePzh2000(root: THREE.Object3D): boolean {
  const turret = root.getObjectByName('g_turret_pzh2000')
  const barrel =
    root.getObjectByName('g_cannon_l52mk2') ?? root.getObjectByName('cannon_l52mk2_skinned')
  const hull = root.getObjectByName('hull')
  if (!turret || !barrel) return false

  if (hull) hull.name = 'Hull'
  turret.name = 'Turret'
  barrel.name = 'Barrel'

  const base = root.getObjectByName('g_cannonbase_pzh2000_l52mk2')
  if (base) barrel.attach(base)
  const skinned = root.getObjectByName('cannon_l52mk2_skinned')
  if (skinned && skinned !== barrel) barrel.attach(skinned)

  for (const n of ['antenna_long', 'antenna_long1']) {
    const extra = root.getObjectByName(n)
    if (extra) turret.attach(extra)
  }
  // Object001 / Object002 = left/right side skirts — stay on hull.
  if (hull) {
    for (const n of ['Object001', 'Object002']) {
      const skirt = root.getObjectByName(n)
      if (skirt) hull.attach(skirt)
    }
  }

  console.info('[Steel] PzH 2000: named hull + turret + L52 cannon (+Z)')
  return true
}

/**
 * T-34 (`tank_t34.glb`) — simple 4-mesh Sketchfab pack.
 * Object_2 = turret+gun (baked), Object_4 = hull. Peel forward stick → Barrel.
 */
function prepareT34(root: THREE.Object3D): boolean {
  // Unique vs Pershing / Chaffee / Firefly / T-90 Object_* packs.
  if (root.getObjectByName('Object_9') instanceof THREE.Mesh) return false
  if (root.getObjectByName('Object_20') instanceof THREE.Mesh) return false
  if (root.getObjectByName('Object_141')) return false
  if (root.getObjectByName('Object_22') instanceof THREE.Mesh) return false
  if (root.getObjectByName('Object_7') instanceof THREE.Mesh) return false
  if (root.getObjectByName('Object_8') instanceof THREE.Mesh) return false

  const turret = root.getObjectByName('Object_2')
  const hull = root.getObjectByName('Object_4')
  if (!(turret instanceof THREE.Mesh) || !(hull instanceof THREE.Mesh)) return false

  hull.name = 'Hull'
  turret.name = 'Turret'
  if (!root.getObjectByName('Barrel')) {
    if (!peelForwardGunStick(turret, 0.60)) {
      console.warn('[Steel] T-34: barrel peel failed — elevation will tip whole turret')
    }
  }
  console.info('[Steel] T-34: Hull/Turret + peeled Barrel')
  return true
}

/**
 * M1A1 Abrams (`m1a1_abrams.glb`) — named hull/turret/weapon hierarchy.
 * Authored +X forward; rotate −90° Y so gun aligns with game +Z.
 */
function prepareAbrams(root: THREE.Object3D): boolean {
  const turret = root.getObjectByName('turret')
  const weapon = root.getObjectByName('weapon')
  if (!turret || !weapon) return false
  // T-72 Ural uses the same node names — leave that path alone.
  let isT72 = false
  root.traverse((o) => {
    if (/t-?72|ural/i.test(o.name)) isT72 = true
  })
  if (isT72) return false
  // Old free Sketchfab pack used Object_* only — leave that path alone.
  if (root.getObjectByName('Object_5') instanceof THREE.Mesh) return false

  root.rotation.y = -Math.PI / 2
  root.updateMatrixWorld(true)

  turret.name = 'Turret'
  weapon.name = 'Barrel'
  console.info('[Steel] Abrams: Turret/Barrel from named turret + weapon (−90° Y)')
  return true
}

/**
 * M26 Pershing (War Thunder bake) — Object_9 turret, Object_22 long 90mm barrel.
 * Object_23 ≈ mantlet (elevates with barrel). Cupola / roof bits ride turret.
 */
function preparePershing(root: THREE.Object3D): boolean {
  if (root.getObjectByName('turret_017')) return false
  if (root.getObjectByName('Turret_01') && root.getObjectByName('gun_01Shape5')) return false
  let isPzh = false
  root.traverse((o) => {
    if (/pzh|PzH_?2000/i.test(o.name)) isPzh = true
  })
  if (isPzh) return false
  const turretMain = root.getObjectByName('Object_9')
  const barrel = root.getObjectByName('Object_22')
  const mantlet = root.getObjectByName('Object_23')
  const hull = root.getObjectByName('Object_15')
  if (!(turretMain instanceof THREE.Mesh) || !(barrel instanceof THREE.Mesh)) return false

  if (hull) hull.name = 'Hull'
  turretMain.name = 'Turret'
  for (const n of ['Object_10', 'Object_19', 'Object_2', 'Object_21', 'Object_3', 'Object_7']) {
    const extra = root.getObjectByName(n)
    if (extra) turretMain.attach(extra)
  }
  barrel.name = 'Barrel'
  if (mantlet) {
    mantlet.name = 'GunMantlet'
    barrel.attach(mantlet)
  }
  console.info('[Steel] Pershing: labeled Hull/Turret/Barrel (Object_9 + Object_22)')
  return true
}

/**
 * M4 Sherman Firefly Sketchfab pack — Object_* only.
 * Object_141 ≈ turret cupola block; Object_143 ≈ long 17-pdr barrel.
 * Nearby high extras ride with the turret.
 */
function prepareShermanFirefly(root: THREE.Object3D): boolean {
  const turretMain = root.getObjectByName('Object_141')
  const barrel = root.getObjectByName('Object_143')
  if (!turretMain || !barrel) return false

  turretMain.name = 'Turret'
  for (const n of [
    'Object_299',
    'Object_297',
    'Object_305',
    'Object_281',
    'Object_279',
    'Object_273',
    'Object_301',
    'Object_303',
    'Object_163',
  ]) {
    const extra = root.getObjectByName(n)
    if (extra) turretMain.attach(extra)
  }
  barrel.name = 'Barrel'
  console.info('[Steel] Firefly: labeled Turret/Barrel (Object_141 + Object_143)')
  return true
}

/**
 * World AABB of a mesh's own geometry (ignores children — racks/cupolas skew the ring).
 */
function meshGeometryWorldBox(obj: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  if (obj instanceof THREE.Mesh && obj.geometry) {
    obj.geometry.computeBoundingBox()
    const gb = obj.geometry.boundingBox
    if (gb && !gb.isEmpty()) {
      return box.copy(gb).applyMatrix4(obj.matrixWorld)
    }
  }
  return box.setFromObject(obj)
}

/**
 * Prefer the turret **shell mesh** for ring placement. Group AABBs include the
 * gun and shove the pivot forward (orbit / hollow hull).
 */
function turretRingSource(turretMesh: THREE.Object3D): THREE.Object3D {
  if (turretMesh instanceof THREE.Mesh) return turretMesh
  let best: THREE.Mesh | null = null
  let bestScore = 0
  for (const child of turretMesh.children) {
    const mesh =
      child instanceof THREE.Mesh
        ? child
        : (child.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined)
    if (!mesh?.geometry) continue
    const n = `${child.name} ${mesh.name}`.toLowerCase()
    if (n.includes('barrel') || n.includes('gun') || n.includes('interior')) continue
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    const r = mesh.geometry.boundingSphere?.radius ?? 0
    const bonus = n.includes('turret') || n.includes('plate') ? 1.5 : 1
    const score = r * bonus
    if (score > bestScore) {
      bestScore = score
      best = mesh
    }
  }
  return best ?? turretMesh
}

/**
 * Wrap the imported turret in a yaw pivot whose local Y matches the hull up-axis.
 * Ring = turret **body** geometry center (not hull AABB — long hulls put the ring
 * forward of hull center and the turret orbits, flashing the hollow interior).
 * Elongated turrets (bustle) bias the ring toward the gun / forward end.
 */
function createYawPivot(
  tankRoot: THREE.Object3D,
  turretMesh: THREE.Object3D,
  hasSeparateBarrel = false,
): THREE.Group {
  tankRoot.updateMatrixWorld(true)
  turretMesh.updateMatrixWorld(true)

  const pivot = new THREE.Group()
  pivot.name = 'turretYawPivot'

  const ringSrc = turretRingSource(turretMesh)
  ringSrc.updateMatrixWorld(true)
  const bodyBox = meshGeometryWorldBox(ringSrc)
  const size = bodyBox.getSize(new THREE.Vector3())
  let ringX = (bodyBox.min.x + bodyBox.max.x) * 0.5
  let ringZ = (bodyBox.min.z + bodyBox.max.z) * 0.5
  // +Z = gun forward.
  // Bustle-only turret mesh (barrel separate): elongated → bias forward toward ring.
  // Gun baked into turret (very long Z, no Barrel): bias aft toward the basket / ring.
  const aspectZ = size.z / Math.max(size.x, 0.001)
  if (aspectZ > 2.0 && !hasSeparateBarrel) {
    ringZ = bodyBox.min.z + size.z * 0.30
  } else if (aspectZ > 1.15) {
    // Bustle / long turret with separate barrel — slight forward bias (not 0.68;
    // that sat the ring too far forward on Leo2).
    ringZ = bodyBox.min.z + size.z * 0.55
  }
  const worldPos = new THREE.Vector3(ringX, bodyBox.min.y, ringZ)
  tankRoot.worldToLocal(worldPos)
  pivot.position.copy(worldPos)
  tankRoot.add(pivot)

  // Keep visual pose; only the pivot will yaw from now on
  pivot.attach(turretMesh)
  console.info(
    '[Steel] Turret yaw pivot at local',
    worldPos.x.toFixed(2),
    worldPos.y.toFixed(2),
    worldPos.z.toFixed(2),
    hasSeparateBarrel ? '(forward / separate barrel)' : '(turret body)',
  )
  return pivot
}

/**
 * World AABB of the barrel tube (prefer own mesh geometry; skip short mantlet kids).
 */
function barrelGeometryWorldBox(barrelMesh: THREE.Object3D): THREE.Box3 {
  if (barrelMesh instanceof THREE.Mesh) {
    return meshGeometryWorldBox(barrelMesh)
  }
  let best: THREE.Mesh | null = null
  let bestLen = 0
  barrelMesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry) return
    o.geometry.computeBoundingBox()
    const gb = o.geometry.boundingBox
    if (!gb || gb.isEmpty()) return
    const s = gb.getSize(new THREE.Vector3())
    const len = Math.max(s.x, s.y, s.z)
    if (len > bestLen) {
      bestLen = len
      best = o
    }
  })
  return best ? meshGeometryWorldBox(best) : new THREE.Box3().setFromObject(barrelMesh)
}

/**
 * For barrels that continue into the turret (Leo2): find the fat circular collar
 * near the gun port. Hinging on the thin tube forward of that collar swings the
 * ring into the hole when elevating.
 */
function barrelCollarHingeZ(
  barrelMesh: THREE.Object3D,
  barrelBox: THREE.Box3,
  turretFrontZ: number,
): number | null {
  const size = barrelBox.getSize(new THREE.Vector3())
  if (size.z < 0.5) return null
  const cx = (barrelBox.min.x + barrelBox.max.x) * 0.5
  const cy = (barrelBox.min.y + barrelBox.max.y) * 0.5
  const bins = 48
  const maxR = new Float64Array(bins)
  const counts = new Uint32Array(bins)
  const v = new THREE.Vector3()
  const z0 = barrelBox.min.z
  const zSpan = Math.max(size.z, 0.001)

  barrelMesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry?.attributes.position) return
    o.updateMatrixWorld(true)
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      const t = Math.min(bins - 1, Math.max(0, Math.floor(((v.z - z0) / zSpan) * bins)))
      const r = Math.hypot(v.x - cx, v.y - cy)
      if (r > maxR[t]!) maxR[t] = r
      counts[t]!++
    }
  })

  const lo = turretFrontZ - Math.min(1.2, size.z * 0.35)
  const hi = turretFrontZ + Math.min(0.25, size.z * 0.06)
  let bestT = -1
  let best = 0
  for (let t = 0; t < bins; t++) {
    if (!counts[t]) continue
    const z = z0 + ((t + 0.5) / bins) * zSpan
    if (z < lo || z > hi) continue
    if (maxR[t]! > best) {
      best = maxR[t]!
      bestT = t
    }
  }
  if (bestT < 0 || best < 0.12) return null
  return z0 + ((bestT + 0.5) / bins) * zSpan
}

/** World-space elevation hinge near the mantlet / breech. */
function barrelHingeWorld(barrelMesh: THREE.Object3D, turretMesh: THREE.Object3D): THREE.Vector3 {
  barrelMesh.updateMatrixWorld(true)
  turretMesh.updateMatrixWorld(true)

  const barrelBox = barrelGeometryWorldBox(barrelMesh)
  const size = barrelBox.getSize(new THREE.Vector3())
  const origin = new THREE.Vector3().setFromMatrixPosition(barrelMesh.matrixWorld)
  const cx = (barrelBox.min.x + barrelBox.max.x) * 0.5
  const cy = (barrelBox.min.y + barrelBox.max.y) * 0.5

  // T-55 / T-90-style: mesh origin really sits at the breech (inside the AABB).
  // Abrams / Pershing / Chaffee put weapon nodes at scene 0,0,0 — do NOT use those.
  const pad = 0.2
  const inAabb =
    origin.x >= barrelBox.min.x - pad &&
    origin.x <= barrelBox.max.x + pad &&
    origin.y >= barrelBox.min.y - pad &&
    origin.y <= barrelBox.max.y + pad &&
    origin.z >= barrelBox.min.z - pad &&
    origin.z <= barrelBox.max.z + pad
  const tAft = (origin.z - barrelBox.min.z) / Math.max(size.z, 0.001)
  if (inAabb && tAft <= 0.28) {
    return origin
  }

  // Turret body only — setFromObject(turret) includes the gun and shoves the hinge forward (T-72).
  const turretBox = meshGeometryWorldBox(turretRingSource(turretMesh))
  const turretFrontZ = turretBox.max.z
  const longAlongZ = size.z > size.x * 1.5 && size.z > size.y * 1.5 && size.z > 0.45

  if (longAlongZ) {
    // Default: aft end of the tube (breech / mantlet root).
    let hingeZ = barrelBox.min.z + size.z * 0.05
    // Recessed barrel (Leo2): mesh continues into the turret — hinge on the fat
    // collar near the port, not the thin tube at the turret face (that swings
    // the circular base into the hole).
    const penetrate = (turretFrontZ - barrelBox.min.z) / size.z
    if (penetrate > 0.32) {
      const collarZ = barrelCollarHingeZ(barrelMesh, barrelBox, turretFrontZ)
      hingeZ = collarZ ?? turretFrontZ - Math.min(0.12, size.z * 0.02)
    }
    return new THREE.Vector3(cx, cy, hingeZ)
  }

  // Short / stubby gun: lerp turret body center → barrel center.
  const barrelCenter = barrelBox.getCenter(new THREE.Vector3())
  const turretCenter = turretBox.getCenter(new THREE.Vector3())
  return turretCenter.clone().lerp(barrelCenter, 0.35)
}

/**
 * Pitch-only pivot under the yaw pivot. Elevates Barrel/Gun without tilting the turret body.
 * Local +Z = gun forward (same frame as yaw pivot).
 */
function createPitchPivot(
  yawPivot: THREE.Object3D,
  turretMesh: THREE.Object3D,
  barrelMesh: THREE.Object3D,
): THREE.Group {
  yawPivot.updateMatrixWorld(true)
  const pivot = new THREE.Group()
  pivot.name = 'barrelPitchPivot'

  const hingeWorld = barrelHingeWorld(barrelMesh, turretMesh)
  yawPivot.worldToLocal(hingeWorld)
  pivot.position.copy(hingeWorld)
  yawPivot.add(pivot)

  pivot.attach(barrelMesh)
  console.info('[Steel] Barrel elevation pivot on', barrelMesh.name)
  return pivot
}

/** Coax MG origin: beside + above the gun axis, short of the main muzzle. */
function createMgMuzzle(
  yawPivot: THREE.Object3D,
  sizeHint?: THREE.Vector3,
): THREE.Object3D {
  const mg = new THREE.Object3D()
  mg.name = 'mgMuzzle'
  const sx = sizeHint?.x ?? 2.2
  const sy = sizeHint?.y ?? 1.2
  const sz = sizeHint?.z ?? 2.8
  // Right of mantlet, on turret roof / cupola height, ahead of turret center
  mg.position.set(
    Math.max(0.4, sx * 0.22),
    Math.max(0.45, sy * 0.42),
    Math.max(0.85, sz * 0.22),
  )
  yawPivot.add(mg)
  return mg
}

/** Muzzle on pitch-pivot +Z at ~barrel length (matches gun-forward used for aim/fire). */
function placeMuzzle(pitchPivot: THREE.Object3D, barrelMesh: THREE.Object3D): THREE.Object3D {
  pitchPivot.updateMatrixWorld(true)
  barrelMesh.updateMatrixWorld(true)
  const size = new THREE.Box3().setFromObject(barrelMesh).getSize(new THREE.Vector3())
  const length = Math.max(size.x, size.y, size.z, 1) * 0.55

  const muzzle = new THREE.Object3D()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, 0, length)
  pitchPivot.add(muzzle)
  return muzzle
}

function createFallbackMuzzle(pitchOrTurret: THREE.Object3D): THREE.Object3D {
  const muzzle = new THREE.Object3D()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, 0.1, 2.2)
  pitchOrTurret.add(muzzle)
  return muzzle
}

function createTurretMount(yawPivot: THREE.Object3D, turretMesh: THREE.Object3D): THREE.Object3D {
  yawPivot.updateMatrixWorld(true)
  turretMesh.updateMatrixWorld(true)
  // Mesh geometry only — Calliope rack children would park the camera inside the tubes.
  const box = new THREE.Box3()
  if (turretMesh instanceof THREE.Mesh && turretMesh.geometry) {
    turretMesh.geometry.computeBoundingBox()
    const gb = turretMesh.geometry.boundingBox
    if (gb) {
      box.copy(gb).applyMatrix4(turretMesh.matrixWorld)
    } else {
      box.setFromObject(turretMesh)
    }
  } else {
    box.setFromObject(turretMesh)
  }
  const worldPos = new THREE.Vector3(
    (box.min.x + box.max.x) * 0.5,
    box.max.y + 0.12,
    (box.min.z + box.max.z) * 0.5,
  )
  yawPivot.worldToLocal(worldPos)

  const mount = new THREE.Object3D()
  mount.name = 'turretCamMount'
  mount.position.copy(worldPos)
  yawPivot.add(mount)
  return mount
}

function boxFromVisibleMeshes(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  const tmp = new THREE.Box3()
  let any = false
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible) return
    const geom = obj.geometry
    if (!geom) return
    if (!geom.boundingBox) geom.computeBoundingBox()
    if (!geom.boundingBox) return
    tmp.copy(geom.boundingBox).applyMatrix4(obj.matrixWorld)
    if (!any) {
      box.copy(tmp)
      any = true
    } else {
      box.union(tmp)
    }
  })
  if (!any) box.setFromObject(root)
  return box
}

/**
 * Scale so track/hull **width** matches catalog target (not longest axis —
 * long barrels / Sketchfab junk AABBs were making some tanks tiny).
 */
function normalizeTankModel(root: THREE.Object3D, targetWidth: number): void {
  root.scale.setScalar(1)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  let box = boxFromVisibleMeshes(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  // Y = up; width = smaller horizontal span
  const width = Math.max(0.001, Math.min(size.x, size.z))
  const s = targetWidth / width
  root.scale.setScalar(s)

  box = boxFromVisibleMeshes(root)
  box.getSize(size)
  const center = box.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box.min.y

  console.info(
    `[Steel] Tank scale → width ${size.x < size.z ? size.x.toFixed(2) : size.z.toFixed(2)}m ` +
      `(target ${targetWidth}) L=${Math.max(size.x, size.z).toFixed(2)} H=${size.y.toFixed(2)}`,
  )
}

function finishRigidRig(root: THREE.Group): PlayerTankHandle {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())

  // Empty pivots only — do not reparent Sketchfab/3DS meshes (they explode).
  const yawPivot = new THREE.Group()
  yawPivot.name = 'turretYawPivot'
  yawPivot.position.set(0, size.y * 0.55, 0)
  root.add(yawPivot)

  const pitchPivot = new THREE.Group()
  pitchPivot.name = 'barrelPitchPivot'
  yawPivot.add(pitchPivot)

  const muzzle = new THREE.Object3D()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, 0, Math.max(1.6, size.z * 0.48))
  pitchPivot.add(muzzle)

  const turretMount = new THREE.Object3D()
  turretMount.name = 'turretCamMount'
  turretMount.position.set(0, size.y * 0.28, -size.z * 0.05)
  yawPivot.add(turretMount)

  const mgMuzzle = createMgMuzzle(yawPivot, size)

  hardenMeshRendering(root)
  console.info('[Steel] Rigid tank rig (no turret/barrel mesh split)')
  return { root, turret: yawPivot, barrel: pitchPivot, muzzle, turretMount, mgMuzzle }
}

function finishRig(root: THREE.Group, turretMesh: THREE.Object3D): PlayerTankHandle {
  root.updateMatrixWorld(true)
  const barrelMesh = findBarrelMesh(root, turretMesh)
  const yawPivot = createYawPivot(root, turretMesh, !!barrelMesh)

  let pitchPivot: THREE.Group
  let muzzle: THREE.Object3D
  if (barrelMesh) {
    pitchPivot = createPitchPivot(yawPivot, turretMesh, barrelMesh)
    muzzle = placeMuzzle(pitchPivot, barrelMesh)
  } else {
    // Baked gun (T-34 / Pz-III): elevate the whole turret mesh around the yaw ring.
    console.info('[Steel] No Barrel/Gun mesh — elevating turret body')
    pitchPivot = new THREE.Group()
    pitchPivot.name = 'barrelPitchPivot'
    pitchPivot.position.set(0, 0.25, 0)
    yawPivot.add(pitchPivot)
    pitchPivot.attach(turretMesh)
    muzzle = createFallbackMuzzle(pitchPivot)
  }

  const turretMount = createTurretMount(yawPivot, turretMesh)
  const tSize = new THREE.Box3().setFromObject(turretMesh).getSize(new THREE.Vector3())
  const mgMuzzle = createMgMuzzle(yawPivot, tSize)
  hardenMeshRendering(root)
  return { root, turret: yawPivot, barrel: pitchPivot, muzzle, turretMount, mgMuzzle }
}

async function loadGltf(url: string, targetWidth: number, rigid = false): Promise<PlayerTankHandle> {
  const model = await loadGltfSceneClone(url)
  model.name = 'tankGltf'
  normalizeTankModel(model, targetWidth)
  if (!rigid) {
    preparePzh2000(model) ||
      prepareLeopard1(model) ||
      preparePz3(model) ||
      prepareT90(model) ||
      prepareT72(model) ||
      prepareT55(model) ||
      prepareT44(model) ||
      prepareT34(model) ||
      prepareAbrams(model) ||
      preparePershing(model) ||
      prepareShermanFirefly(model) ||
      prepareChaffee(model) ||
      prepareToshueyiPz4(model)
  }
  // Re-plant after any prep that may shift meshes
  {
    const box = boxFromVisibleMeshes(model)
    const center = box.getCenter(new THREE.Vector3())
    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= box.min.y
  }
  paintTankDunkelgrau(model)
  await applyTankWrap(model)
  enableShadows(model)

  const root = new THREE.Group()
  root.name = 'playerTank'
  root.add(model)
  root.updateMatrixWorld(true)

  if (rigid) {
    console.info('[Steel] Loaded rigid tank GLB from', url)
    return finishRigidRig(root)
  }

  const turretMesh = findTurretMesh(root)
  console.info('[Steel] Loaded tank GLB from', url, 'turretMesh=', turretMesh.name)
  return finishRig(root, turretMesh)
}

/** Shared GLB fetch — AI + player both use Pz-III without downloading twice. */
const gltfSceneCache = new Map<string, Promise<THREE.Object3D>>()

function loadGltfSceneClone(url: string): Promise<THREE.Object3D> {
  let pending = gltfSceneCache.get(url)
  if (!pending) {
    pending = (async () => {
      const loader = new GLTFLoader()
      const draco = new DRACOLoader()
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
      loader.setDRACOLoader(draco)
      console.info('[Steel] Fetching GLB', url)
      const gltf = await loader.loadAsync(url)
      console.info('[Steel] GLB ready', url)
      return gltf.scene
    })()
    gltfSceneCache.set(url, pending)
  }
  return pending.then((scene) => scene.clone(true))
}

/** Load the tank chosen on the main menu. */
export async function loadPlayerTank(id: TankId): Promise<PlayerTankHandle> {
  const option = tankOptionById(id)
  if (await glbAvailable(option.url)) {
    try {
      // Multi-mesh Pz-IV bake exports named Hull/Turret/Barrel — use normal pivots.
      // Sketchfab packs without part names (e.g. Chaffee) use rigidRig.
      return await loadGltf(option.url, option.targetWidth, !!option.rigidRig)
    } catch (err) {
      console.warn('[Steel] Failed to parse', option.url, err)
    }
  }

  console.info('[Steel] Missing', option.url, '— procedural fallback')
  const handle = createShermanTank()
  paintTankDunkelgrau(handle.root)
  await applyTankWrap(handle.root)
  return finishRig(handle.root, handle.turret)
}
