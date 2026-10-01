import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { TankCosmetics } from './cosmetics'
import { loadTankChassis } from './loadTank'
import type { TankId } from './tankCatalog'
import { applyTankWrap } from './wraps'

export type CustomizePreview = {
  show: (id: TankId, cos: TankCosmetics) => Promise<void>
  applyDraft: (cos: TankCosmetics, opts?: { reloadChassis?: boolean }) => Promise<void>
  /** Euler rotation in radians (X / Y / Z). */
  setRotation: (x: number, y: number, z: number) => void
  getRotation: () => { x: number; y: number; z: number }
  dispose: () => void
}

const DEFAULT_YAW = Math.PI * 0.2

/**
 * Embedded Three.js showroom — orbit + manual X/Y/Z rotation sliders.
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
  scene.fog = new THREE.Fog(0x1a2228, 18, 42)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.2, 80)
  camera.position.set(6.5, 3.2, 7.5)

  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 4
  controls.maxDistance = 16
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
    new THREE.CircleGeometry(10, 48),
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
  let tankId: TankId | null = null
  let draft: TankCosmetics = { wrapId: 'stock' }
  let rot = { x: 0, y: DEFAULT_YAW, z: 0 }
  let loadGen = 0
  let disposed = false
  let raf = 0

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

  function tick(): void {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    controls.update()
    renderer.render(scene, camera)
  }
  tick()

  function clearTank(): void {
    if (!tankRoot) return
    scene.remove(tankRoot)
    tankRoot = null
  }

  function applyRot(): void {
    if (!tankRoot) return
    tankRoot.rotation.order = 'XYZ'
    tankRoot.rotation.set(rot.x, rot.y, rot.z)
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
    controls.update()
  }

  async function mount(id: TankId, cos: TankCosmetics, resetCam: boolean): Promise<void> {
    const gen = ++loadGen
    host.dataset.loading = '1'
    try {
      const handle = await loadTankChassis(id)
      if (disposed || gen !== loadGen) return
      clearTank()
      await applyTankWrap(handle.root, cos.wrapId)
      handle.root.position.set(0, 0, 0)
      scene.add(handle.root)
      tankRoot = handle.root
      tankId = id
      draft = { wrapId: cos.wrapId }
      applyRot()
      if (resetCam) frameCamera(handle.root)
      console.info(`[Steel] Customize preview ${id} wrap=${cos.wrapId}`)
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
      draft = { wrapId: cos.wrapId }
      if (!tankRoot || tankId === null || wrapChanged || opts?.reloadChassis) {
        if (tankId) await mount(tankId, draft, false)
        return
      }
    },
    setRotation(x, y, z) {
      rot = { x, y, z }
      applyRot()
    },
    getRotation() {
      return { ...rot }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      clearTank()
      controls.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
