import * as THREE from 'three'
import type { HeightSampler } from './ballistics'

const MAX_MARKS = 160
const MARK_LIFE = 28
const TRACK_HALF_WIDTH = 1.05
const MARK_LENGTH = 0.95
const MARK_GAP = 0.85
const SPAWN_SPEED = 1.2

type Mark = {
  mesh: THREE.Mesh
  life: number
}

export type TrackMarks = {
  update: (dt: number, tank: THREE.Object3D, speed: number) => void
  dispose: () => void
}

/**
 * Fading sand track stamps behind each track while driving.
 */
export function createTrackMarks(
  scene: THREE.Scene,
  heightAt: HeightSampler,
): TrackMarks {
  const root = new THREE.Group()
  root.name = 'trackMarks'
  scene.add(root)

  const geo = new THREE.PlaneGeometry(0.42, MARK_LENGTH)
  const marks: Mark[] = []
  const _fwd = new THREE.Vector3()
  const _right = new THREE.Vector3()
  const _pos = new THREE.Vector3()
  let distAcc = 0
  let lastX = Number.NaN
  let lastZ = Number.NaN

  function spawnPair(tank: THREE.Object3D): void {
    tank.updateMatrixWorld(true)
    const yaw = tank.rotation.y
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw))
    _right.set(_fwd.z, 0, -_fwd.x)

    for (const side of [-1, 1] as const) {
      _pos.copy(tank.position)
      _pos.addScaledVector(_fwd, -1.6)
      _pos.addScaledVector(_right, side * TRACK_HALF_WIDTH)
      _pos.y = heightAt(_pos.x, _pos.z) + 0.04

      const mat = new THREE.MeshBasicMaterial({
        color: 0x6b5a3e,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(_pos)
      mesh.rotation.x = -Math.PI / 2
      mesh.rotation.z = -yaw
      mesh.renderOrder = 5
      root.add(mesh)
      marks.push({ mesh, life: MARK_LIFE })

      if (marks.length > MAX_MARKS) {
        const old = marks.shift()!
        root.remove(old.mesh)
        ;(old.mesh.material as THREE.Material).dispose()
      }
    }
  }

  return {
    update(dt, tank, speed) {
      const absSpeed = Math.abs(speed)
      if (absSpeed < SPAWN_SPEED) {
        distAcc = 0
      } else {
        const dx = Number.isNaN(lastX) ? 0 : tank.position.x - lastX
        const dz = Number.isNaN(lastZ) ? 0 : tank.position.z - lastZ
        distAcc += Math.hypot(dx, dz)
        if (distAcc >= MARK_GAP) {
          distAcc = 0
          spawnPair(tank)
        }
      }
      lastX = tank.position.x
      lastZ = tank.position.z

      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i]
        m.life -= dt
        const u = Math.max(0, m.life / MARK_LIFE)
        const mat = m.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.55 * u * u
        if (m.life <= 0) {
          root.remove(m.mesh)
          mat.dispose()
          marks.splice(i, 1)
        }
      }
    },
    dispose() {
      for (const m of marks) {
        root.remove(m.mesh)
        ;(m.mesh.material as THREE.Material).dispose()
      }
      marks.length = 0
      geo.dispose()
      scene.remove(root)
    },
  }
}
