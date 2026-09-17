import * as THREE from 'three'
import { cloneGltfScene, loadTextureCached } from './loadGltf'
import { nationByTeam, nationFlagSrc, type TeamId } from './nations'
import { tankOptionById, type TankId } from './tankCatalog'

export type PodiumPlace = 1 | 2 | 3

export type PodiumEntry = {
  place: PodiumPlace
  name: string
  tankId: TankId
  tankName: string
  team: TeamId
  kills: number
  deaths: number
  isPlayer: boolean
}

export type Podium3d = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  update: (dt: number) => void
  resize: (width: number, height: number) => void
  dispose: () => void
}

/** 1st centre (tallest), runner-up left, third right. */
const LAYOUT: Record<
  PodiumPlace,
  { x: number; height: number; size: number; tankLen: number; delay: number; color: number }
> = {
  1: { x: 0, height: 2.5, size: 6.0, tankLen: 5.0, delay: 1.05, color: 0xd8b25a },
  2: { x: -7.1, height: 1.6, size: 5.2, tankLen: 4.3, delay: 0.5, color: 0xc2cad1 },
  3: { x: 7.1, height: 1.0, size: 5.2, tankLen: 4.3, delay: 0.0, color: 0xb0743a },
}

const RISE_SEC = 0.85
const INTRO_SEC = 2.6
const CAM_TARGET = new THREE.Vector3(0, 2.6, 0)

function easeOutBack(t: number): number {
  const c = 1.7
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function makePlateTexture(entry: PodiumEntry): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 192
  const ctx = canvas.getContext('2d')!
  const accent = `#${LAYOUT[entry.place].color.toString(16).padStart(6, '0')}`

  ctx.fillStyle = 'rgba(10, 13, 15, 0.94)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = accent
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)

  ctx.textAlign = 'center'
  ctx.fillStyle = accent
  ctx.font = 'bold 54px "Barlow Condensed", "Segoe UI", sans-serif'
  ctx.fillText(`#${entry.place}`, canvas.width / 2, 62)

  ctx.fillStyle = '#eef1ea'
  ctx.font = 'bold 46px "Barlow Condensed", "Segoe UI", sans-serif'
  const label = entry.isPlayer ? `${entry.name} (You)` : entry.name
  ctx.fillText(label.slice(0, 22), canvas.width / 2, 116)

  ctx.fillStyle = 'rgba(238, 241, 234, 0.72)'
  ctx.font = '32px "Share Tech Mono", monospace'
  ctx.fillText(
    `${entry.tankName.slice(0, 16)}  ·  ${entry.kills}K / ${entry.deaths}D`,
    canvas.width / 2,
    162,
  )

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Scale + centre a vehicle GLB so it sits on top of a podium block. */
function fitVehicle(
  model: THREE.Object3D,
  targetLength: number,
  opts?: { aircraft?: boolean },
): THREE.Group {
  const wrap = new THREE.Group()
  wrap.add(model)

  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  // Tanks: longest of XZ. Aircraft: larger horizontal span (wingspan) — Corsair
  // is X-wide; Yak-9 export is Z-wide until noseYaw is applied.
  const measure = opts?.aircraft
    ? Math.max(size.x, size.z, 0.001)
    : Math.max(size.x, size.z, 0.001)
  model.scale.multiplyScalar(targetLength / measure)

  model.updateMatrixWorld(true)
  const fitted = new THREE.Box3().setFromObject(model)
  const centre = fitted.getCenter(new THREE.Vector3())
  model.position.x -= centre.x
  model.position.z -= centre.z
  model.position.y -= fitted.min.y

  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = false
      obj.frustumCulled = false
    }
  })
  return wrap
}

/** Boxy stand-in when a tank GLB is missing. */
function placeholderTank(
  length: number,
  color: number,
  track: <T extends { dispose: () => void }>(x: T) => T,
): THREE.Group {
  const group = new THREE.Group()
  const mat = track(
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 }),
  )
  const hull = new THREE.Mesh(
    track(new THREE.BoxGeometry(length * 0.55, length * 0.22, length)),
    mat,
  )
  hull.position.y = length * 0.18
  const turret = new THREE.Mesh(
    track(new THREE.BoxGeometry(length * 0.34, length * 0.18, length * 0.42)),
    mat,
  )
  turret.position.y = length * 0.38
  const gun = new THREE.Mesh(
    track(new THREE.CylinderGeometry(length * 0.03, length * 0.03, length * 0.5, 8)),
    mat,
  )
  gun.rotation.x = Math.PI / 2
  gun.position.set(0, length * 0.38, length * 0.42)
  group.add(hull, turret, gun)
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  return group
}

/**
 * Standalone victory stage — dark plaza, three lit blocks, the top three
 * tanks on them, slow orbiting camera. Rendered with the game's renderer.
 */
export async function createPodium3d(
  entries: readonly PodiumEntry[],
  opts: { win: boolean; team?: TeamId },
): Promise<Podium3d> {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(opts.win ? 0x0b1014 : 0x120b0b)
  scene.fog = new THREE.Fog(scene.background.getHex(), 26, 78)

  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  )

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x)
    return x
  }

  // ——— Plaza floor ———
  const floorGeo = track(new THREE.CircleGeometry(34, 64))
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x14191d,
      roughness: 0.42,
      metalness: 0.35,
    }),
  )
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const ringGeo = track(new THREE.RingGeometry(13.5, 14.1, 96))
  const ringMat = track(
    new THREE.MeshBasicMaterial({
      color: opts.win ? 0xd8b25a : 0x8a4a3a,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  )
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  scene.add(ring)

  // ——— Lights ———
  scene.add(new THREE.HemisphereLight(0x5a6a78, 0x0a0d10, 0.55))
  scene.add(new THREE.AmbientLight(0xffffff, 0.22))

  const key = new THREE.DirectionalLight(0xfff0d4, 1.5)
  key.position.set(6, 18, 12)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 60
  key.shadow.camera.left = -18
  key.shadow.camera.right = 18
  key.shadow.camera.top = 18
  key.shadow.camera.bottom = -10
  key.shadow.normalBias = 0.04
  scene.add(key)

  const winnerSpot = new THREE.SpotLight(0xffd98a, 90, 26, Math.PI / 9, 0.45, 1.4)
  winnerSpot.position.set(0, 15, 3)
  winnerSpot.target.position.set(0, 2.5, 0)
  scene.add(winnerSpot, winnerSpot.target)

  const rimLeft = new THREE.PointLight(0x74b6ff, 28, 26)
  rimLeft.position.set(-11, 5, -8)
  scene.add(rimLeft)

  const rimRight = new THREE.PointLight(0xff8b6a, 24, 26)
  rimRight.position.set(11, 5, -8)
  scene.add(rimRight)

  // ——— Light shaft over the winner ———
  const shaftGeo = track(new THREE.ConeGeometry(4.2, 14, 32, 1, true))
  const shaftMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xffd98a,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const shaft = new THREE.Mesh(shaftGeo, shaftMat)
  shaft.position.set(0, 9.4, 0)
  scene.add(shaft)

  // ——— Podium blocks + tanks ———
  type Slot = {
    group: THREE.Group
    tank: THREE.Object3D | null
    targetY: number
    delay: number
    risen: number
  }
  const slots: Slot[] = []

  const blockTop = track(
    new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.5, metalness: 0.3 }),
  )

  for (const entry of entries) {
    const cfg = LAYOUT[entry.place]
    const group = new THREE.Group()
    group.position.set(cfg.x, 0, 0)
    scene.add(group)

    const blockGeo = track(new THREE.BoxGeometry(cfg.size, cfg.height, cfg.size))
    const sideMat = track(
      new THREE.MeshStandardMaterial({
        color: cfg.color,
        roughness: 0.45,
        metalness: 0.55,
        emissive: new THREE.Color(cfg.color).multiplyScalar(0.12),
      }),
    )
    const block = new THREE.Mesh(blockGeo, [
      sideMat,
      sideMat,
      blockTop,
      sideMat,
      sideMat,
      sideMat,
    ])
    block.position.y = cfg.height / 2
    block.castShadow = true
    block.receiveShadow = true
    group.add(block)

    // Name / stats plate on the front face
    const plateTex = track(makePlateTexture(entry))
    const plateGeo = track(new THREE.PlaneGeometry(cfg.size * 0.82, cfg.size * 0.31))
    const plateMat = track(
      new THREE.MeshBasicMaterial({ map: plateTex, transparent: true }),
    )
    const plate = new THREE.Mesh(plateGeo, plateMat)
    plate.position.set(0, Math.max(cfg.height * 0.55, 0.62), cfg.size / 2 + 0.03)
    group.add(plate)

    // Nation banner behind the tank
    const nation = nationByTeam(entry.team)
    const bannerGeo = track(new THREE.PlaneGeometry(3.4, 2.15))
    const bannerMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x8d949a,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
      }),
    )
    const banner = new THREE.Mesh(bannerGeo, bannerMat)
    banner.position.set(0, cfg.height + 3.5, -cfg.size / 2 - 0.2)
    banner.rotation.y = Math.PI
    group.add(banner)
    void loadTextureCached(nationFlagSrc(nation))
      .then((tex) => {
        bannerMat.map = tex
        bannerMat.color.setHex(0xffffff)
        bannerMat.needsUpdate = true
      })
      .catch(() => {
        bannerMat.color.setStyle(nation.color)
      })

    // Tank on top — real model, box stand-in if the GLB is missing
    const holder = new THREE.Group()
    holder.position.y = cfg.height
    group.add(holder)

    let tank: THREE.Object3D
    const opt = tankOptionById(entry.tankId)
    const isAir = opt.aircraft === true
    // Wingspan-fitted planes need a touch more room than a hull-length tank.
    const fitLen = isAir ? cfg.tankLen * 1.35 : cfg.tankLen
    try {
      const model = await cloneGltfScene(opt.url)
      if (opt.aircraftNoseYaw) model.rotation.y = opt.aircraftNoseYaw
      tank = fitVehicle(model, fitLen, { aircraft: isAir })
    } catch (err) {
      console.warn('[Steel] Podium tank GLB failed — placeholder', entry.tankId, err)
      tank = placeholderTank(fitLen, cfg.color, track)
    }
    // Face the camera side, slight showroom angle
    tank.rotation.y = Math.PI + (entry.place === 1 ? 0.35 : entry.place === 2 ? -0.5 : 0.5)
    holder.add(tank)

    group.position.y = -cfg.height - 5
    slots.push({
      group,
      tank,
      targetY: 0,
      delay: cfg.delay,
      risen: 0,
    })
  }

  // ——— Gold confetti over the winner ———
  const CONFETTI = 220
  const confettiPos = new Float32Array(CONFETTI * 3)
  const confettiVel = new Float32Array(CONFETTI)
  for (let i = 0; i < CONFETTI; i++) {
    confettiPos[i * 3] = (Math.random() - 0.5) * 16
    confettiPos[i * 3 + 1] = 5 + Math.random() * 14
    confettiPos[i * 3 + 2] = (Math.random() - 0.5) * 12
    confettiVel[i] = 1.1 + Math.random() * 2.2
  }
  const confettiGeo = track(new THREE.BufferGeometry())
  confettiGeo.setAttribute('position', new THREE.BufferAttribute(confettiPos, 3))
  const confettiMat = track(
    new THREE.PointsMaterial({
      color: opts.win ? 0xf0cf83 : 0x8d6a5a,
      size: 0.13,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  )
  const confetti = new THREE.Points(confettiGeo, confettiMat)
  scene.add(confetti)

  let t = 0

  return {
    scene,
    camera,
    update(dt) {
      t += dt

      // Camera: sweeping dolly-in, then a slow drifting orbit
      const intro = Math.min(1, t / INTRO_SEC)
      const e = easeInOut(intro)
      const radius = THREE.MathUtils.lerp(32, 19.5, e)
      const height = THREE.MathUtils.lerp(15, 7.4, e)
      const angle =
        THREE.MathUtils.lerp(-0.85, -0.12, e) + Math.sin(t * 0.16) * 0.26 * intro
      camera.position.set(
        Math.sin(angle) * radius,
        height,
        Math.cos(angle) * radius,
      )
      camera.lookAt(CAM_TARGET)

      // Blocks rise into place, bottom place first
      for (const slot of slots) {
        const local = Math.max(0, t - slot.delay)
        slot.risen = Math.min(1, local / RISE_SEC)
        const startY = -LAYOUT[1].height - 5
        slot.group.position.y = THREE.MathUtils.lerp(
          startY,
          slot.targetY,
          easeOutBack(slot.risen),
        )
        // Gentle showroom spin once seated
        if (slot.tank && slot.risen >= 1) {
          slot.tank.rotation.y += dt * 0.22
        }
      }

      // Confetti fall + wrap
      const arr = confettiGeo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < CONFETTI; i++) {
        let y = arr.getY(i) - confettiVel[i]! * dt
        let x = arr.getX(i) + Math.sin(t * 1.3 + i) * dt * 0.35
        if (y < 0.1) {
          y = 12 + Math.random() * 8
          x = (Math.random() - 0.5) * 16
        }
        arr.setX(i, x)
        arr.setY(i, y)
      }
      arr.needsUpdate = true

      shaft.rotation.y += dt * 0.12
      ringMat.opacity = 0.28 + Math.sin(t * 1.5) * 0.08
    },
    resize(width, height) {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    dispose() {
      // Only stage-owned resources — tank clones share the cached GLB buffers.
      for (const d of disposables) d.dispose()
      scene.clear()
    },
  }
}
