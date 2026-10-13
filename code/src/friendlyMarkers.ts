import * as THREE from 'three'

export type FriendlyMarkerUnit = {
  root: THREE.Object3D
  alive: boolean
}

export type FriendlyMarkers = {
  update: (camera: THREE.Camera, units: readonly FriendlyMarkerUnit[]) => void
  dispose: () => void
}

const MAX = 32
const MARK_H = 4.2
/** Hide beyond this — not a permanent always-on beacon. */
const MAX_DIST = 420
const FADE_START = 280

function makeChevronTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  const g = ctx.createRadialGradient(32, 36, 2, 32, 36, 28)
  g.addColorStop(0, 'rgba(80, 200, 255, 0.45)')
  g.addColorStop(0.5, 'rgba(40, 140, 220, 0.28)')
  g.addColorStop(1, 'rgba(20, 80, 160, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.beginPath()
  ctx.moveTo(32, 10)
  ctx.lineTo(50, 42)
  ctx.lineTo(32, 34)
  ctx.lineTo(14, 42)
  ctx.closePath()
  ctx.fillStyle = 'rgba(120, 220, 255, 0.92)'
  ctx.strokeStyle = 'rgba(10, 30, 50, 0.9)'
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/**
 * Ally markers — occluded by terrain, fade with range (not always-on HUD beacons).
 */
export function createFriendlyMarkers(scene: THREE.Scene): FriendlyMarkers {
  const tex = makeChevronTexture()
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
    opacity: 0.88,
  })
  const group = new THREE.Group()
  group.name = 'FriendlyMarkers'
  scene.add(group)

  const pool: THREE.Sprite[] = []
  for (let i = 0; i < MAX; i++) {
    const s = new THREE.Sprite(mat.clone())
    s.scale.set(2.2, 2.2, 1)
    s.visible = false
    s.renderOrder = 0
    group.add(s)
    pool.push(s)
  }

  const _fwd = new THREE.Vector3()
  const _to = new THREE.Vector3()

  console.info('[Steel] Friendly markers — occluded · fade >280m · hide >420m')

  return {
    update(camera, units) {
      camera.getWorldDirection(_fwd)
      let i = 0
      for (const u of units) {
        if (i >= MAX) break
        if (!u.alive || !u.root.visible) continue
        u.root.getWorldPosition(_to)
        _to.y += MARK_H
        const dist = camera.position.distanceTo(_to)
        if (dist > MAX_DIST) continue
        // Behind the camera frustum plane
        _to.sub(camera.position)
        if (_to.dot(_fwd) < 4) continue
        _to.add(camera.position)

        const spr = pool[i]!
        const fade =
          dist > FADE_START
            ? 1 - (dist - FADE_START) / (MAX_DIST - FADE_START)
            : 1
        ;(spr.material as THREE.SpriteMaterial).opacity = 0.88 * fade
        spr.visible = true
        spr.position.copy(_to)
        const sc = THREE.MathUtils.clamp(1.8 + dist * 0.004, 1.8, 2.8)
        spr.scale.set(sc, sc, 1)
        i++
      }
      for (; i < MAX; i++) pool[i]!.visible = false
    },
    dispose() {
      group.parent?.remove(group)
      for (const s of pool) (s.material as THREE.SpriteMaterial).dispose()
      mat.dispose()
      tex.dispose()
    },
  }
}
