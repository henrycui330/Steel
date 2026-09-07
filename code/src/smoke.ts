import * as THREE from 'three'

const SMOKE_URL = '/assets/warfare/smoke_soft.png'

type Puff = {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  maxLife: number
  grow: number
  baseOpacity: number
  /** Additive “fire” look */
  hot: boolean
}

export type SmokeSystem = {
  update: (dt: number, camera: THREE.Camera) => void
  muzzleBurst: (origin: THREE.Vector3, forward: THREE.Vector3) => void
  /** Dense cloud at breech / around the tank when firing. */
  gunBlastCloud: (origin: THREE.Vector3, forward: THREE.Vector3) => void
  /** Continuous diesel/exhaust from rear deck. */
  engineExhaust: (origin: THREE.Vector3, intensity?: number) => void
  damageLeak: (origin: THREE.Vector3, intensity?: number) => void
  wreckPlume: (origin: THREE.Vector3) => void
  /** Orange fire tongues + black smoke for burning wrecks (burst). */
  wreckFire: (origin: THREE.Vector3) => void
  /** Cheap ongoing burn — 1–2 puffs, for per-frame wreck updates. */
  wreckBurn: (origin: THREE.Vector3) => void
  dispose: () => void
}

/**
 * Soft billboard smoke / fire for muzzle, engine, damage, wrecks.
 */
export async function createSmokeSystem(scene: THREE.Scene): Promise<SmokeSystem> {
  const tex = await new THREE.TextureLoader().loadAsync(SMOKE_URL)
  tex.colorSpace = THREE.SRGBColorSpace

  const geo = new THREE.PlaneGeometry(1, 1)
  const puffs: Puff[] = []
  const root = new THREE.Group()
  root.name = 'smokeSystem'
  scene.add(root)

  const _camQuat = new THREE.Quaternion()

  function spawn(
    origin: THREE.Vector3,
    vel: THREE.Vector3,
    opts: {
      size: number
      life: number
      grow: number
      opacity: number
      color: number
      hot?: boolean
    },
  ): void {
    if (puffs.length >= 90) return
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      blending: opts.hot ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(origin)
    mesh.scale.setScalar(opts.size)
    mesh.renderOrder = opts.hot ? 22 : 20
    root.add(mesh)
    puffs.push({
      mesh,
      vel: vel.clone(),
      life: opts.life,
      maxLife: opts.life,
      grow: opts.grow,
      baseOpacity: opts.opacity,
      hot: !!opts.hot,
    })
  }

  return {
    muzzleBurst(origin, forward) {
      const base = forward.clone().normalize()
      for (let i = 0; i < 14; i++) {
        const v = base
          .clone()
          .multiplyScalar(2 + Math.random() * 4)
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 1.8,
              0.6 + Math.random() * 2,
              (Math.random() - 0.5) * 1.8,
            ),
          )
        spawn(origin.clone().addScaledVector(base, 0.5), v, {
          size: 0.85 + Math.random() * 1.1,
          life: 0.85 + Math.random() * 0.9,
          grow: 3.2 + Math.random() * 2.5,
          opacity: 0.62,
          color: i < 3 ? 0xd8d0c0 : 0xa8a094,
        })
      }
      // Hot flash at muzzle
      for (let i = 0; i < 4; i++) {
        spawn(
          origin.clone().addScaledVector(base, 0.2 + Math.random() * 0.4),
          base.clone().multiplyScalar(3 + Math.random() * 4).add(
            new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2),
          ),
          {
            size: 0.5 + Math.random() * 0.6,
            life: 0.18 + Math.random() * 0.15,
            grow: 8,
            opacity: 0.9,
            color: 0xffaa44,
            hot: true,
          },
        )
      }
    },

    gunBlastCloud(origin, forward) {
      const base = forward.clone().normalize()
      // Ring around hull / breech
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2
        const side = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))
        const pos = origin
          .clone()
          .addScaledVector(base, -1.2)
          .add(new THREE.Vector3(0, 0.6 + Math.random() * 0.5, 0))
          .addScaledVector(side, 1.2 + Math.random() * 0.8)
        spawn(
          pos,
          new THREE.Vector3(
            side.x * (0.8 + Math.random()),
            1.2 + Math.random() * 2,
            side.z * (0.8 + Math.random()),
          ),
          {
            size: 1.2 + Math.random() * 1.4,
            life: 1.4 + Math.random() * 1.2,
            grow: 2.4,
            opacity: 0.5,
            color: 0x9a948c,
          },
        )
      }
      // Dust kick under belly
      for (let i = 0; i < 8; i++) {
        spawn(
          origin.clone().add(
            new THREE.Vector3((Math.random() - 0.5) * 3, 0.15, (Math.random() - 0.5) * 3),
          ),
          new THREE.Vector3((Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 2),
          {
            size: 1.5 + Math.random(),
            life: 1 + Math.random(),
            grow: 2.8,
            opacity: 0.4,
            color: 0x8a7d5c,
          },
        )
      }
    },

    engineExhaust(origin, intensity = 1) {
      // Sparse — avoid fogging the battlefield
      if (Math.random() > 0.12 * intensity) return
      spawn(
        origin.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.08, (Math.random() - 0.5) * 0.15),
        ),
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.15,
          0.5 + Math.random() * 0.7,
          (Math.random() - 0.5) * 0.15 - 0.25,
        ),
        {
          size: 0.28 + Math.random() * 0.22,
          life: 0.55 + Math.random() * 0.4,
          grow: 1.1,
          opacity: 0.12 * Math.min(1, intensity),
          color: 0x6a6864,
        },
      )
    },

    damageLeak(origin, intensity = 1) {
      const n = Math.max(1, Math.round(2 * intensity))
      for (let i = 0; i < n; i++) {
        spawn(
          origin
            .clone()
            .add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2, (Math.random() - 0.5) * 0.6)),
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.4,
            1.2 + Math.random() * 1.4,
            (Math.random() - 0.5) * 0.4,
          ),
          {
            size: 0.9 + Math.random() * 0.7,
            life: 1.4 + Math.random(),
            grow: 1.6,
            opacity: 0.35 * intensity,
            color: 0x6a6864,
          },
        )
      }
    },

    wreckPlume(origin) {
      for (let i = 0; i < 10; i++) {
        spawn(
          origin.clone().add(new THREE.Vector3(0, 0.8, 0)),
          new THREE.Vector3(
            (Math.random() - 0.5) * 2.5,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 2.5,
          ),
          {
            size: 1.4 + Math.random() * 1.6,
            life: 2 + Math.random() * 1.5,
            grow: 2.8,
            opacity: 0.55,
            color: i % 3 === 0 ? 0x2a2520 : 0x7a7068,
          },
        )
      }
    },

    wreckFire(origin) {
      for (let i = 0; i < 4; i++) {
        spawn(
          origin.clone().add(
            new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.4 + Math.random(), (Math.random() - 0.5) * 1.2),
          ),
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.8,
            2 + Math.random() * 3,
            (Math.random() - 0.5) * 0.8,
          ),
          {
            size: 0.7 + Math.random() * 0.8,
            life: 0.4 + Math.random() * 0.4,
            grow: 3.2,
            opacity: 0.8,
            color: i % 2 === 0 ? 0xff6622 : 0xffcc33,
            hot: true,
          },
        )
      }
      for (let i = 0; i < 3; i++) {
        spawn(
          origin.clone().add(new THREE.Vector3(0, 1.2, 0)),
          new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            1.8 + Math.random() * 2.2,
            (Math.random() - 0.5) * 1.2,
          ),
          {
            size: 1.1 + Math.random() * 0.7,
            life: 1.4 + Math.random(),
            grow: 2,
            opacity: 0.4,
            color: 0x2a2824,
          },
        )
      }
    },

    wreckBurn(origin) {
      spawn(
        origin.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8),
        ),
        new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random() * 1.8, (Math.random() - 0.5) * 0.4),
        {
          size: 0.55 + Math.random() * 0.45,
          life: 0.5 + Math.random() * 0.35,
          grow: 2.4,
          opacity: 0.7,
          color: Math.random() > 0.5 ? 0xff6622 : 0xffaa33,
          hot: true,
        },
      )
      if (Math.random() < 0.45) {
        spawn(
          origin.clone().add(new THREE.Vector3(0, 1, 0)),
          new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6),
          {
            size: 1 + Math.random() * 0.6,
            life: 1.2 + Math.random() * 0.6,
            grow: 1.6,
            opacity: 0.32,
            color: 0x3a3834,
          },
        )
      }
    },

    update(dt, camera) {
      camera.getWorldQuaternion(_camQuat)
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]
        p.life -= dt
        if (p.life <= 0) {
          root.remove(p.mesh)
          const mat = p.mesh.material
          if (mat instanceof THREE.Material) mat.dispose()
          puffs.splice(i, 1)
          continue
        }
        const u = 1 - p.life / p.maxLife
        p.vel.y += (p.hot ? 2.2 : 0.6) * dt
        p.vel.multiplyScalar(1 - (p.hot ? 0.35 : 0.55) * dt)
        p.mesh.position.addScaledVector(p.vel, dt)
        p.mesh.quaternion.copy(_camQuat)
        const scale = p.mesh.scale.x + p.grow * dt
        p.mesh.scale.setScalar(scale)
        const mat = p.mesh.material
        if (mat instanceof THREE.MeshBasicMaterial) {
          const fade = (1 - u) * (1 - u)
          mat.opacity = fade * p.baseOpacity
        }
      }
    },

    dispose() {
      for (const p of puffs) {
        root.remove(p.mesh)
        if (p.mesh.material instanceof THREE.Material) p.mesh.material.dispose()
      }
      puffs.length = 0
      scene.remove(root)
      geo.dispose()
      tex.dispose()
    },
  }
}
