import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { TankCosmetics } from './cosmetics'
import {
  attachAircraftHardpoints,
  hasHardpointPicker,
  type AircraftHardpoints,
  type HardpointStationId,
  type PlaneStationMap,
} from './aircraftHardpoints'
import { resolveAircraftStores } from './aircraftLoadouts'
import { loadPlayerAircraft, type AircraftHandle } from './loadAircraft'
import { loadTankChassis } from './loadTank'
import {
  attachTankAccessories,
  preloadBushAccessory,
  type TankAccessory,
  type TankAccessoryRig,
} from './tankAccessories'
import { tankOptionById, type TankId } from './tankCatalog'
import { applyTankWrap } from './wraps'

export type CustomizePreview = {
  show: (id: TankId, cos: TankCosmetics) => Promise<void>
  applyDraft: (cos: TankCosmetics, opts?: { reloadChassis?: boolean }) => Promise<void>
  /** Euler rotation in radians (X / Y / Z). */
  setRotation: (x: number, y: number, z: number) => void
  getRotation: () => { x: number; y: number; z: number }
  /** Hangar: sync pylons from station map. */
  setHardpointStations: (map: PlaneStationMap) => void
  setHardpointHighlight: (id: HardpointStationId | null) => void
  onHardpointPick: (fn: ((id: HardpointStationId) => void) | null) => void
  /** Sync hung tank accessories (bushes). */
  setAccessories: (list: readonly TankAccessory[]) => Promise<void>
  setAccessoryHighlight: (id: string | null) => void
  /** Next hull click places a bush (tanks only). */
  setAccessoryPlaceMode: (on: boolean) => void
  onAccessoryPick: (fn: ((id: string) => void) | null) => void
  onAccessoryPlace: (
    fn: ((local: [number, number, number]) => void) | null,
  ) => void
  dispose: () => void
}

const DEFAULT_YAW = Math.PI * 0.2

/**
 * Embedded Three.js showroom — orbit + manual X/Y/Z rotation sliders.
 * Aircraft use `loadPlayerAircraft` (never the tank turret pipeline).
 */
export function createCustomizePreview(host: HTMLElement): CustomizePreview {
  const canvas = document.createElement('canvas')
  canvas.className = 'customize-canvas'
  host.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x1a2228, 1)
  renderer.shadowMap.enabled = true

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x1a2228, 18, 80)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.2, 200)
  camera.position.set(6.5, 3.2, 7.5)

  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 3
  controls.maxDistance = 48
  controls.maxPolarAngle = Math.PI * 0.49
  controls.target.set(0, 1.1, 0)
  controls.update()

  const hemi = new THREE.HemisphereLight(0xc8d4dc, 0x3a4038, 0.85)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff0d4, 1.35)
  sun.position.set(6, 12, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0xb0b8c0, 0.35))

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(28, 48),
    new THREE.MeshStandardMaterial({
      color: 0x3a4238,
      roughness: 0.92,
      metalness: 0.04,
    }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  let tankRoot: THREE.Object3D | null = null
  let airHandle: AircraftHandle | null = null
  let hardpoints: AircraftHardpoints | null = null
  let accessoryRig: TankAccessoryRig | null = null
  let tankId: TankId | null = null
  let draft: TankCosmetics = { wrapId: 'stock', accessories: [] }
  /** Places that arrive while the chassis GLB is still loading. */
  let pendingAccessories: TankAccessory[] | null = null
  let rot = { x: 0, y: DEFAULT_YAW, z: 0 }
  let loadGen = 0
  let disposed = false
  let raf = 0
  let lastT = performance.now()
  let pickHandler: ((id: HardpointStationId) => void) | null = null
  let accessoryPickHandler: ((id: string) => void) | null = null
  let accessoryPlaceHandler: ((local: [number, number, number]) => void) | null =
    null
  let accessoryPlaceMode = false
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let ptrDown: { x: number; y: number } | null = null
  const _localHit = new THREE.Vector3()

  function cloneAccList(list: readonly TankAccessory[]): TankAccessory[] {
    return list.map((a) => ({
      ...a,
      pos: [...a.pos] as [number, number, number],
    }))
  }

  function resize(): void {
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const ro = new ResizeObserver(() => resize())
  ro.observe(host)
  resize()
  void preloadBushAccessory().catch(() => {
    /* logged in ensureBushTemplate */
  })

  function tick(): void {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now
    if (airHandle) airHandle.spinProp(dt, 0.35)
    controls.update()
    renderer.render(scene, camera)
  }
  tick()

  function clearTank(): void {
    hardpoints?.dispose()
    hardpoints = null
    accessoryRig?.dispose()
    accessoryRig = null
    if (!tankRoot) return
    scene.remove(tankRoot)
    tankRoot = null
    airHandle = null
  }

  function applyRot(): void {
    if (!tankRoot) return
    tankRoot.rotation.order = 'XYZ'
    tankRoot.rotation.set(rot.x, rot.y, rot.z)
    if (airHandle) {
      tankRoot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(tankRoot)
      tankRoot.position.y -= box.min.y
    }
  }

  function frameCamera(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    controls.target.set(center.x, Math.max(0.6, center.y), center.z)
    const span = Math.max(size.x, size.y, size.z, 1)
    const dist = span * 2.1
    camera.position.set(
      center.x + dist * 0.75,
      center.y + dist * 0.45,
      center.z + dist * 0.85,
    )
    controls.minDistance = Math.max(2, span * 0.55)
    controls.maxDistance = Math.max(24, span * 4.5)
    controls.update()
  }

  function setPointer(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return true
  }

  function isAccessoryObject(obj: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = obj
    while (p) {
      if (p.name === 'tankAccessories' || p.userData?.accessoryId) return true
      p = p.parent
    }
    return false
  }

  function tryPick(clientX: number, clientY: number): void {
    if (!setPointer(clientX, clientY)) return

    // Tank accessories — select existing bush, or place on hull.
    if (tankRoot && !airHandle) {
      if (accessoryRig) {
        const accHits = raycaster.intersectObjects(accessoryRig.pickRoots(), true)
        const accId = accHits[0]?.object?.userData?.accessoryId as
          | string
          | undefined
        if (accId) {
          accessoryRig.highlight(accId)
          accessoryPickHandler?.(accId)
          accessoryPlaceMode = false
          console.info(`[Steel] Accessory pick ${accId}`)
          return
        }
      }

      if (accessoryPlaceMode) {
        tankRoot.updateMatrixWorld(true)
        const hits = raycaster.intersectObject(tankRoot, true)
        const hit = hits.find((h) => !isAccessoryObject(h.object))
        if (hit) {
          _localHit.copy(hit.point)
          tankRoot.worldToLocal(_localHit)
          // Sit slightly above the skin so foliage isn't buried in armor.
          _localHit.y += 0.04
          if (accessoryPlaceHandler) {
            accessoryPlaceHandler([_localHit.x, _localHit.y, _localHit.z])
          } else {
            console.warn('[Steel] Accessory place · no handler wired')
          }
          console.info(
            `[Steel] Accessory place · local ${_localHit.x.toFixed(2)},${_localHit.y.toFixed(2)},${_localHit.z.toFixed(2)} · mesh=${hit.object.name || hit.object.type}`,
          )
        } else {
          console.warn(
            `[Steel] Accessory place · miss (mode on · hits=${hits.length}) — click the tank mesh`,
          )
        }
        return
      }
    }

    if (!hardpoints || !pickHandler) return
    const hits = raycaster.intersectObjects(hardpoints.markers, false)
    const hit = hits[0]?.object
    const id = hit?.userData?.hardpointId as HardpointStationId | undefined
    if (!id) return
    hardpoints.highlight(id)
    pickHandler(id)
    console.info(`[Steel] Hardpoint pick ${id}`)
  }

  canvas.addEventListener('pointerdown', (e) => {
    ptrDown = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!ptrDown) return
    const dx = e.clientX - ptrDown.x
    const dy = e.clientY - ptrDown.y
    ptrDown = null
    if (dx * dx + dy * dy > 36) return
    tryPick(e.clientX, e.clientY)
  })

  async function mount(id: TankId, cos: TankCosmetics, resetCam: boolean): Promise<void> {
    const gen = ++loadGen
    host.dataset.loading = '1'
    try {
      const opt = tankOptionById(id)
      clearTank()
      if (opt.aircraft) {
        const air = await loadPlayerAircraft(id)
        if (disposed || gen !== loadGen) return
        air.root.position.set(0, 0, 0)
        if (hasHardpointPicker(id)) {
          const stores = resolveAircraftStores(id)
          hardpoints = attachAircraftHardpoints(air.root, {
            plane: id,
            stations: stores.stations,
            markers: true,
          })
        }
        scene.add(air.root)
        air.root.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(air.root)
        air.root.position.y -= box.min.y
        tankRoot = air.root
        airHandle = air
        tankId = id
        draft = { wrapId: cos.wrapId, accessories: [] }
        applyRot()
        air.root.updateMatrixWorld(true)
        const box2 = new THREE.Box3().setFromObject(air.root)
        air.root.position.y -= box2.min.y
        if (resetCam) frameCamera(air.root)
        console.info(`[Steel] Customize preview aircraft ${id}`)
      } else {
        const handle = await loadTankChassis(id)
        if (disposed || gen !== loadGen) return
        await applyTankWrap(handle.root, cos.wrapId)
        handle.root.position.set(0, 0, 0)
        scene.add(handle.root)
        tankRoot = handle.root
        tankId = id
        const acc =
          pendingAccessories ??
          cloneAccList(cos.accessories)
        pendingAccessories = null
        draft = { wrapId: cos.wrapId, accessories: acc }
        accessoryRig = attachTankAccessories(handle.root)
        await accessoryRig.setAccessories(draft.accessories)
        if (disposed || gen !== loadGen) return
        applyRot()
        if (resetCam) frameCamera(handle.root)
        console.info(
          `[Steel] Customize preview ${id} wrap=${cos.wrapId} · acc=${draft.accessories.length}`,
        )
      }
    } catch (err) {
      console.warn('[Steel] Customize preview load failed', id, err)
    } finally {
      if (gen === loadGen) delete host.dataset.loading
    }
  }

  return {
    async show(id, cos) {
      rot = { x: 0, y: DEFAULT_YAW, z: 0 }
      await mount(id, cos, true)
    },
    async applyDraft(cos, opts) {
      const wrapChanged = cos.wrapId !== draft.wrapId
      draft = {
        wrapId: cos.wrapId,
        accessories: cloneAccList(cos.accessories),
      }
      pendingAccessories = draft.accessories
      if (!tankId) return
      if (tankOptionById(tankId).aircraft) {
        return
      }
      if (opts?.reloadChassis || !tankRoot) {
        await mount(tankId, cos, false)
        return
      }
      if (wrapChanged && tankRoot) {
        await applyTankWrap(tankRoot, cos.wrapId)
      }
      pendingAccessories = null
      if (accessoryRig) await accessoryRig.setAccessories(draft.accessories)
    },
    setRotation(x, y, z) {
      rot = { x, y, z }
      applyRot()
    },
    getRotation() {
      return { ...rot }
    },
    setHardpointStations(map) {
      hardpoints?.setStations(map)
    },
    setHardpointHighlight(id) {
      hardpoints?.highlight(id)
    },
    onHardpointPick(fn) {
      pickHandler = fn
    },
    async setAccessories(list) {
      draft = {
        ...draft,
        accessories: cloneAccList(list),
      }
      pendingAccessories = draft.accessories
      if (!accessoryRig) {
        console.info(
          `[Steel] Accessories queued (${draft.accessories.length}) — chassis still loading`,
        )
        return
      }
      await accessoryRig.setAccessories(draft.accessories)
      pendingAccessories = null
    },
    setAccessoryHighlight(id) {
      accessoryRig?.highlight(id)
    },
    setAccessoryPlaceMode(on) {
      accessoryPlaceMode = on
      if (on) host.dataset.placeAcc = '1'
      else delete host.dataset.placeAcc
    },
    onAccessoryPick(fn) {
      accessoryPickHandler = fn
    },
    onAccessoryPlace(fn) {
      accessoryPlaceHandler = fn
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      clearTank()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}

/** Re-export for hangar picker typing. */
export type {
  HardpointStationId,
  PlaneStationMap,
  HardpointArmament,
  CorsairStationId,
  CorsairStationMap,
} from './aircraftHardpoints'
