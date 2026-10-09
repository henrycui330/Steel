import * as THREE from 'three'
import { detachInstanceMaterials } from './loadGltf'
import type { ModuleKit } from './modules'

export type DamagePreviewDamage = {
  modules?: Readonly<ModuleKit>
  hp: number
  maxHp: number
  trackLeftOut?: boolean
  trackRightOut?: boolean
  fuelLeaking?: boolean
  fuelEmpty?: boolean
}

export type DamagePreviewSource = {
  root: THREE.Object3D
  /** Live aim yaw pivot (`turretYawPivot`). */
  turret?: THREE.Object3D | null
  /** Live barrel pitch pivot (`barrelPitchPivot`). */
  barrel?: THREE.Object3D | null
}

export type DamagePreview = {
  setSource: (src: DamagePreviewSource) => void
  update: (
    headingRad: number,
    turretRelRad: number,
    damage: DamagePreviewDamage,
  ) => void
  dispose: () => void
}

const VIEW = 168
const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()
const _tmp = new THREE.Color()

/** Flat WT schematic palette (matches old dial legend). */
const COL = {
  armor: 0x8caa6e,
  track: 0x6a727a,
  turret: 0x8a9aaa,
  gun: 0xe8eef4,
  fuel: 0xc8aa5a,
  ammo: 0xdcdce4,
  other: 0x7a8880,
  edge: 0xc8d8c0,
} as const

type PartKind = 'armor' | 'turret' | 'gun' | 'trackL' | 'trackR' | 'fuel' | 'ammo' | 'other'

type Painted = {
  mesh: THREE.Mesh
  part: PartKind
  mat: THREE.MeshBasicMaterial
  base: number
}

function classifyPart(obj: THREE.Object3D): PartKind {
  let p: THREE.Object3D | null = obj
  while (p) {
    const n = (p.name || '').toLowerCase()
    if (/barrelpitchpivot|barrel|gun|weapon|muzzle/.test(n) && !/mg|coax|machine/.test(n)) {
      return 'gun'
    }
    if (/turretyawpivot|turret|cupola|mantlet/.test(n)) return 'turret'
    if (/track|tread|kette|chain|wheel|sprocket|idler/.test(n)) {
      if (n.includes('left') || n.includes('_l') || /\.001\b/.test(n) || /wheels?l/.test(n)) {
        return 'trackL'
      }
      if (n.includes('right') || n.includes('_r') || /\.002\b/.test(n) || /wheels?r/.test(n)) {
        return 'trackR'
      }
      // Geometry side later
      return obj.position.x < 0 ? 'trackL' : obj.position.x > 0 ? 'trackR' : 'other'
    }
    if (/hull|chassis|body|hull001/.test(n)) return 'armor'
    p = p.parent
  }
  return 'other'
}

function partColor(part: PartKind): number {
  if (part === 'armor') return COL.armor
  if (part === 'turret') return COL.turret
  if (part === 'gun') return COL.gun
  if (part === 'trackL' || part === 'trackR') return COL.track
  if (part === 'fuel') return COL.fuel
  if (part === 'ammo') return COL.ammo
  return COL.other
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    // Geometries for marker boxes only — shared tank geos stay shared.
    if (o.userData.dmgOwnedGeo && o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) m?.dispose()
  })
}

function pct(
  mods: Readonly<ModuleKit> | undefined,
  id: keyof ModuleKit,
  fallbackHp: number,
  fallbackMax: number,
): number {
  const m = mods?.[id]
  const hp = m?.hp ?? fallbackHp
  const max = m?.maxHp ?? fallbackMax
  return max > 0 ? THREE.MathUtils.clamp(hp / max, 0, 1) : 0
}

function healthColor(baseHex: number, health: number, out: THREE.Color): void {
  out.setHex(baseHex)
  if (health <= 0) {
    out.setRGB(0.14, 0.14, 0.16)
    return
  }
  if (health <= 0.25) {
    out.lerp(_tmp.setHex(0xc85a28), 0.75)
    return
  }
  if (health <= 0.55) {
    out.lerp(_tmp.setHex(0xd2a032), 0.5)
  }
}

function schemMat(hex: number, opacity = 0.92): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: true,
    side: THREE.DoubleSide,
  })
}

/**
 * WT-style damage dial: real tank mesh, flat module colors, live turret/barrel.
 */
export function createDamagePreview(host: HTMLElement): DamagePreview {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-view'
  canvas.width = VIEW
  canvas.height = VIEW
  canvas.setAttribute('aria-hidden', 'true')
  host.insertBefore(canvas, host.firstChild)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(VIEW, VIEW, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.05, 60)
  camera.up.set(0, 0, 1)
  camera.position.set(0, 14, 0)
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.AmbientLight(0xffffff, 1))

  let wrap: THREE.Group | null = null
  let cloneYaw: THREE.Object3D | null = null
  let clonePitch: THREE.Object3D | null = null
  let liveTurret: THREE.Object3D | null = null
  let liveBarrel: THREE.Object3D | null = null
  const painted: Painted[] = []

  function clearClone(): void {
    if (!wrap) return
    scene.remove(wrap)
    disposeObject(wrap)
    wrap = null
    cloneYaw = null
    clonePitch = null
    painted.length = 0
  }

  function fitCamera(root: THREE.Object3D): void {
    root.updateMatrixWorld(true)
    _box.setFromObject(root)
    _box.getSize(_size)
    _box.getCenter(_center)
    root.position.x -= _center.x
    root.position.z -= _center.z
    root.position.y = 0
    const span = Math.max(_size.x, _size.z, 1.4) * 0.58
    camera.left = -span
    camera.right = span
    camera.top = span
    camera.bottom = -span
    camera.near = 0.05
    camera.far = 60
    camera.updateProjectionMatrix()
  }

  function paintMesh(mesh: THREE.Mesh, part: PartKind): void {
    const base = partColor(part)
    const mat = schemMat(base, part === 'armor' ? 0.88 : 0.94)
    mesh.material = mat
    painted.push({ mesh, part, mat, base })
  }

  function addModuleMarkers(clone: THREE.Object3D): void {
    clone.updateMatrixWorld(true)
    _box.setFromObject(clone)
    _box.getSize(_size)
    _box.getCenter(_center)
    const hx = Math.max(0.35, _size.x * 0.5)
    const hz = Math.max(0.55, _size.z * 0.5)

    const markerParent =
      clone.getObjectByName('Hull') ??
      clone.getObjectByName('hull') ??
      clone

    // Fuel tanks — rear of hull (local −Z), yellow.
    for (const side of [-1, 1] as const) {
      const fuel = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(0.22, hx * 0.18), 10, 8),
        schemMat(COL.fuel, 0.95),
      )
      fuel.userData.dmgOwnedGeo = true
      fuel.name = 'DmgFuel'
      fuel.scale.set(1, 0.55, 1.35)
      fuel.position.set(side * hx * 0.38, _size.y * 0.35, -hz * 0.42)
      markerParent.add(fuel)
      painted.push({ mesh: fuel, part: 'fuel', mat: fuel.material as THREE.MeshBasicMaterial, base: COL.fuel })
    }

    // Ammo rack — forward/center of turret ring, white.
    const ammoParent =
      clone.getObjectByName('turretYawPivot') ??
      clone.getObjectByName('Turret') ??
      markerParent
    const ammo = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.min(0.45, hx * 0.35),
        Math.min(0.18, _size.y * 0.2),
        Math.min(0.55, hz * 0.28),
      ),
      schemMat(COL.ammo, 0.96),
    )
    ammo.userData.dmgOwnedGeo = true
    ammo.name = 'DmgAmmo'
    ammo.position.set(hx * 0.12, _size.y * 0.42, hz * 0.08)
    ammoParent.add(ammo)
    painted.push({ mesh: ammo, part: 'ammo', mat: ammo.material as THREE.MeshBasicMaterial, base: COL.ammo })
  }

  function buildClone(tank: THREE.Object3D): THREE.Group {
    tank.updateMatrixWorld(true)
    const clone = tank.clone(true)
    detachInstanceMaterials(clone)
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    clone.quaternion.identity()
    clone.scale.set(1, 1, 1)

    // Reset aim pivots so sync owns them; keep mesh rest poses under pivots.
    const yaw = clone.getObjectByName('turretYawPivot')
    const pitch = clone.getObjectByName('barrelPitchPivot')
    if (yaw) yaw.rotation.set(0, 0, 0)
    if (pitch) pitch.rotation.set(0, 0, 0)

    // Collect first — never add children during traverse (infinite edge recursion).
    const meshes: THREE.Mesh[] = []
    clone.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.geometry || !o.visible) return
      if (o.name === 'DmgEdge' || o.name === 'DmgFuel' || o.name === 'DmgAmmo') return
      meshes.push(o)
    })
    for (const o of meshes) {
      let part = classifyPart(o)
      if (part !== 'trackL' && part !== 'trackR' && /wheel|track|tread/.test(o.name.toLowerCase())) {
        const lx = o.position.x
        part = lx < -0.05 ? 'trackL' : lx > 0.05 ? 'trackR' : part
      }
      paintMesh(o, part)

      const edge = new THREE.Mesh(
        o.geometry,
        new THREE.MeshBasicMaterial({
          color: COL.edge,
          wireframe: true,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      )
      edge.name = 'DmgEdge'
      edge.renderOrder = 1
      o.add(edge)
    }

    addModuleMarkers(clone)

    const g = new THREE.Group()
    g.name = 'DmgPreview'
    g.add(clone)
    fitCamera(g)

    cloneYaw = yaw ?? null
    clonePitch = pitch ?? null
    return g
  }

  function syncPose(headingRad: number, turretRelRad: number): void {
    if (!wrap) return
    wrap.rotation.y = headingRad

    if (cloneYaw) {
      cloneYaw.rotation.y = liveTurret ? liveTurret.rotation.y : turretRelRad
    }
    if (clonePitch && liveBarrel) {
      clonePitch.rotation.copy(liveBarrel.rotation)
    } else if (clonePitch) {
      // Casemate / no live barrel — leave pitch at rest.
      clonePitch.rotation.set(0, 0, 0)
    }
  }

  function paintDamage(d: DamagePreviewDamage): void {
    const hullPct = pct(d.modules, 'hull', d.hp, d.maxHp)
    const turretPct = pct(d.modules, 'turret', d.maxHp * 0.55, d.maxHp * 0.55)
    const trackLPct = d.trackLeftOut
      ? 0
      : pct(d.modules, 'trackL', d.maxHp * 0.28, d.maxHp * 0.28)
    const trackRPct = d.trackRightOut
      ? 0
      : pct(d.modules, 'trackR', d.maxHp * 0.28, d.maxHp * 0.28)
    let fuelPct = pct(d.modules, 'fuel', d.maxHp * 0.35, d.maxHp * 0.35)
    if (d.fuelEmpty) fuelPct = 0
    else if (d.fuelLeaking) fuelPct = Math.min(fuelPct, 0.35)
    const ammoPct = turretPct

    for (const entry of painted) {
      let health = 1
      if (entry.part === 'armor' || entry.part === 'other') health = hullPct
      else if (entry.part === 'turret' || entry.part === 'gun') health = turretPct
      else if (entry.part === 'trackL') health = trackLPct
      else if (entry.part === 'trackR') health = trackRPct
      else if (entry.part === 'fuel') health = fuelPct
      else if (entry.part === 'ammo') health = ammoPct

      healthColor(entry.base, health, entry.mat.color)
      entry.mat.opacity =
        health <= 0 ? 0.55 : entry.part === 'armor' ? 0.88 : 0.94
    }
  }

  return {
    setSource(src) {
      clearClone()
      liveTurret = src.turret ?? null
      liveBarrel = src.barrel ?? null
      wrap = buildClone(src.root)
      scene.add(wrap)
      console.info(
        `[Steel] Damage dial · schematic top-down` +
          ` · yaw=${cloneYaw ? 'ok' : 'none'} · pitch=${clonePitch ? 'ok' : 'none'}`,
      )
      renderer.render(scene, camera)
    },
    update(headingRad, turretRelRad, damage) {
      if (!wrap) return
      syncPose(headingRad, turretRelRad)
      paintDamage(damage)
      renderer.render(scene, camera)
    },
    dispose() {
      clearClone()
      liveTurret = null
      liveBarrel = null
      renderer.dispose()
      canvas.remove()
    },
  }
}
