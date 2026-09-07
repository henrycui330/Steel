import * as THREE from 'three'
import type { HeightSampler } from './ballistics'

const MAX_PARTICLES = 220
const BURST_RATE = 38

type Grain = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
}

export type SandDust = {
  update: (dt: number, tank: THREE.Object3D, speed: number, camera: THREE.Camera) => void
  dispose: () => void
}

/**
 * Light sand kick-up under tracks while moving on dunes.
 */
export function createSandDust(
  scene: THREE.Scene,
  heightAt: HeightSampler,
): SandDust {
  const positions = new Float32Array(MAX_PARTICLES * 3)
  const colors = new Float32Array(MAX_PARTICLES * 3)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.PointsMaterial({
    size: 0.32,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geo, mat)
  points.name = 'sandDust'
  points.frustumCulled = false
  points.renderOrder = 18
  scene.add(points)

  const grains: Grain[] = []
  const _fwd = new THREE.Vector3()
  const _right = new THREE.Vector3()
  const _origin = new THREE.Vector3()
  let emitAcc = 0

  function spawn(tank: THREE.Object3D, speed: number): void {
    if (grains.length >= MAX_PARTICLES) return
    const yaw = tank.rotation.y
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw))
    _right.set(_fwd.z, 0, -_fwd.x)
    const side = Math.random() < 0.5 ? -1 : 1
    _origin.copy(tank.position)
    _origin.addScaledVector(_fwd, -1.1 + Math.random() * 0.4)
    _origin.addScaledVector(_right, side * (0.7 + Math.random() * 0.55))
    _origin.y = heightAt(_origin.x, _origin.z) + 0.08 + Math.random() * 0.12

    const spray = 0.6 + Math.min(1.4, Math.abs(speed) * 0.08)
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 1.4 + _right.x * side * 0.35,
      1.2 + Math.random() * 2.2 * spray,
      (Math.random() - 0.5) * 1.4 - _fwd.z * 0.4,
    )
    const life = 0.45 + Math.random() * 0.55
    grains.push({
      pos: _origin.clone(),
      vel,
      life,
      maxLife: life,
    })
  }

  return {
    update(dt, tank, speed, _camera) {
      const absSpeed = Math.abs(speed)
      if (absSpeed > 1.5) {
        emitAcc += dt * BURST_RATE * Math.min(1.8, absSpeed / 10)
        while (emitAcc >= 1 && grains.length < MAX_PARTICLES) {
          emitAcc -= 1
          spawn(tank, absSpeed)
        }
      } else {
        emitAcc = 0
      }

      for (let i = grains.length - 1; i >= 0; i--) {
        const g = grains[i]
        g.life -= dt
        g.vel.y -= 9 * dt
        g.pos.addScaledVector(g.vel, dt)
        const gy = heightAt(g.pos.x, g.pos.z) + 0.05
        if (g.pos.y < gy) {
          g.pos.y = gy
          g.vel.y *= -0.15
          g.vel.x *= 0.7
          g.vel.z *= 0.7
        }
        if (g.life <= 0) grains.splice(i, 1)
      }

      for (let i = 0; i < MAX_PARTICLES; i++) {
        const o = i * 3
        if (i < grains.length) {
          const g = grains[i]
          const fade = Math.max(0, g.life / g.maxLife)
          positions[o] = g.pos.x
          positions[o + 1] = g.pos.y
          positions[o + 2] = g.pos.z
          colors[o] = 0.78 + fade * 0.1
          colors[o + 1] = 0.62 + fade * 0.08
          colors[o + 2] = 0.38
        } else {
          positions[o] = 0
          positions[o + 1] = -999
          positions[o + 2] = 0
          colors[o] = 0
          colors[o + 1] = 0
          colors[o + 2] = 0
        }
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
      mat.opacity = grains.length ? 0.7 : 0
    },
    dispose() {
      scene.remove(points)
      geo.dispose()
      mat.dispose()
      grains.length = 0
    },
  }
}
