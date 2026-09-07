import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ammoById, type AmmoId, type WeaponId, AMMO_TYPES, type AmmoDef } from './ammo'
import {
  integrateShell,
  SHELL_RADIUS,
  SHELL_SPEED,
  type HeightSampler,
} from './ballistics'
import { getAimDirection, getAimLookPoint } from './aim'
import { playFireSound } from './audio'
import type { DummyTarget } from './dummy'
import { hitsPropCollider, type PropCollider } from './collision'
import { showHitBanner, worldToScreen } from './hitFeedback'
import type { GunProfile } from './tankCatalog'

const SHELL_LIFETIME = 4
const MG_LIFETIME = 1.6
/** Short delay so muzzle flash can play — direction is locked at trigger. */
const SHELL_RELEASE_DELAY = 0.08
const MG_RELEASE_DELAY = 0.02
/** Coax MG cyclic rate (~650 rpm → ~0.09s). */
const MG_COOLDOWN = 0.09
const MG_RADIUS = 0.045
const MG_SPEED = SHELL_SPEED * 1.05
/** Reticle converge range — shells fly muzzle → this point on the aim ray. */
const AIM_CONVERGE_DIST = 72
/** Visible shell length in meters (model is huge Sketchfab units). */
const SHELL_MODEL_LENGTH = 0.55
const SHELL_MODEL_URL = '/models/88mm_shell.glb'

export type FireHudState = {
  weapon: WeaponId
  chambered: AmmoId | null
  loading: AmmoId
  reloadLeft: number
  reloadTotal: number
  ready: boolean
}

type Shell = {
  mesh: THREE.Object3D
  velocity: THREE.Vector3
  age: number
  ammoId: AmmoId
  lifetime: number
  hitRadius: number
}

type PendingShot = {
  remaining: number
  ammoId: AmmoId
  dir: THREE.Vector3
}

export type FireSystem = {
  update: (
    dt: number,
    wantsFire: boolean,
    muzzle: THREE.Object3D,
    dummies?: readonly DummyTarget[],
    camera?: THREE.Camera,
    propColliders?: readonly PropCollider[],
  ) => boolean
  setReloadSec: (sec: number) => void
  setGunProfile: (profile: GunProfile) => void
  setPlayableHalf: (half: number) => void
  setHeightAt: (fn: HeightSampler | null) => void
  selectAmmo: (id: AmmoId) => void
  setWeapon: (id: WeaponId) => void
  toggleWeapon: () => void
  getWeapon: () => WeaponId
  getHudState: () => FireHudState
  dispose: () => void
}

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _look = new THREE.Vector3()
const _sparkPos = new THREE.Vector3()
const _aimPoint = new THREE.Vector3()

/** Align long axis to −Z (Three.js lookAt forward) and scale to game size. */
function prepareShellModel(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'shell88Template'
  const model = scene.clone(true)
  // Authored long on +X → map to −Z for lookAt.
  model.rotation.y = Math.PI / 2
  wrap.add(model)
  wrap.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(wrap)
  const size = box.getSize(new THREE.Vector3())
  const len = Math.max(size.x, size.y, size.z, 0.001)
  wrap.scale.setScalar(SHELL_MODEL_LENGTH / len)
  wrap.updateMatrixWorld(true)

  const box2 = new THREE.Box3().setFromObject(wrap)
  const center = box2.getCenter(new THREE.Vector3())
  wrap.worldToLocal(center)
  model.position.sub(center)
  wrap.updateMatrixWorld(true)
  return wrap
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.geometry?.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) m?.dispose()
  })
}

function aimDirFromMuzzle(
  muzzle: THREE.Object3D,
  camera: THREE.Camera | undefined,
  out: THREE.Vector3,
): THREE.Vector3 {
  muzzle.updateMatrixWorld(true)
  muzzle.getWorldPosition(_origin)
  if (camera) {
    getAimLookPoint(camera.position, AIM_CONVERGE_DIST, _aimPoint)
    out.copy(_aimPoint).sub(_origin)
    if (out.lengthSq() > 1e-6) return out.normalize()
  }
  return getAimDirection(out)
}

function flashSpark(scene: THREE.Scene, pos: THREE.Vector3, color: number, scale = 1): void {
  const geo = new THREE.SphereGeometry(0.18 * scale, 6, 6)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(pos)
  scene.add(mesh)
  const t0 = performance.now()
  const tick = (now: number): void => {
    const u = (now - t0) / 220
    if (u >= 1) {
      scene.remove(mesh)
      geo.dispose()
      mat.dispose()
      return
    }
    mesh.scale.setScalar(1 + u * 2.2)
    mat.opacity = 1 - u
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function createFireSystem(
  scene: THREE.Scene,
  initialPlayableHalf: number,
  reloadSec = 4,
): FireSystem {
  const shells: Shell[] = []
  const mgGeometry = new THREE.SphereGeometry(MG_RADIUS, 6, 6)
  let shellTemplate: THREE.Group | null = null
  let shellTemplateFailed = false
  void new GLTFLoader()
    .loadAsync(SHELL_MODEL_URL)
    .then((gltf) => {
      shellTemplate = prepareShellModel(gltf.scene)
      console.info('[Steel] 88mm shell model ready')
    })
    .catch((err) => {
      shellTemplateFailed = true
      console.warn('[Steel] 88mm shell GLB failed — sphere fallback', err)
    })

  let playableHalf = initialPlayableHalf
  let heightAt: HeightSampler | null = null
  let cooldown = 0
  let cooldownMax = reloadSec
  let pending: PendingShot | null = null
  let loading: AmmoId = 'aphe'
  let chambered: AmmoId | null = 'aphe'
  let weapon: WeaponId = 'main'
  let mgCooldown = 0
  let gun: GunProfile = {
    aphePenMult: 1,
    apheDmgMult: 1,
    hePenMult: 1,
    heBlastMult: 1,
    traverseRadPerSec: 6.5,
    elevateRadPerSec: 4.5,
  }

  function effectiveAmmo(def: AmmoDef): {
    penetration: number
    penDamage: number
    blastDamage: number
  } {
    if (def.id === 'mg') {
      return {
        penetration: def.penetration,
        penDamage: def.penDamage,
        blastDamage: 0,
      }
    }
    if (def.id === 'aphe') {
      return {
        penetration: def.penetration * gun.aphePenMult,
        penDamage: def.penDamage * gun.apheDmgMult,
        blastDamage: 0,
      }
    }
    return {
      penetration: def.penetration * gun.hePenMult,
      penDamage: def.penDamage,
      blastDamage: def.blastDamage * gun.heBlastMult,
    }
  }

  function beginLoad(id: AmmoId): void {
    if (id === 'mg') return
    loading = id
    chambered = null
    cooldown = cooldownMax
    console.info(`[Steel] Loading ${AMMO_TYPES[id].name} (${cooldownMax.toFixed(1)}s)`)
  }

  function makeMainShellMesh(ammoId: AmmoId): THREE.Object3D {
    if (shellTemplate) {
      const clone = shellTemplate.clone(true)
      clone.name = 'shell'
      clone.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true
          obj.frustumCulled = false
        }
      })
      return clone
    }
    const def = ammoById(ammoId)
    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.6,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SHELL_RADIUS, 10, 10), material)
    mesh.name = 'shell'
    mesh.castShadow = true
    return mesh
  }

  function spawnShell(muzzle: THREE.Object3D, ammoId: AmmoId, dir: THREE.Vector3): void {
    const isMg = ammoId === 'mg'
    let mesh: THREE.Object3D
    if (isMg) {
      const def = ammoById(ammoId)
      const material = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        metalness: 0.6,
      })
      mesh = new THREE.Mesh(mgGeometry, material)
      mesh.name = 'mgTracer'
      mesh.castShadow = false
    } else {
      mesh = makeMainShellMesh(ammoId)
      if (!shellTemplate && !shellTemplateFailed) {
        // Model still loading — sphere is fine for this shot
      }
    }

    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_origin)
    _dir.copy(dir).normalize()

    mesh.position.copy(_origin).addScaledVector(_dir, isMg ? 0.5 : 0.35)
    const speed = isMg ? MG_SPEED : SHELL_SPEED
    const velocity = _dir.clone().multiplyScalar(speed)
    scene.add(mesh)
    shells.push({
      mesh,
      velocity,
      age: 0,
      ammoId,
      lifetime: isMg ? MG_LIFETIME : SHELL_LIFETIME,
      hitRadius: isMg ? MG_RADIUS : SHELL_RADIUS,
    })
  }

  function removeAt(index: number): void {
    const shell = shells[index]
    scene.remove(shell.mesh)
    // MG / sphere fallback own their materials; GLB clones share template geo — don't dispose.
    if (shell.mesh instanceof THREE.Mesh) {
      const shared = shellTemplate !== null && shell.ammoId !== 'mg'
      if (!shared) {
        if (shell.mesh.geometry && shell.mesh.geometry !== mgGeometry) {
          shell.mesh.geometry.dispose()
        }
        if (shell.mesh.material instanceof THREE.Material) shell.mesh.material.dispose()
      }
    }
    shells.splice(index, 1)
  }

  function outOfBounds(pos: THREE.Vector3): boolean {
    const limit = playableHalf - SHELL_RADIUS
    return Math.abs(pos.x) > limit || Math.abs(pos.z) > limit || pos.y > 80
  }

  function hitGround(pos: THREE.Vector3, radius: number): boolean {
    const gy = (heightAt ? heightAt(pos.x, pos.z) : 0) + radius
    if (pos.y <= gy) {
      pos.y = gy
      return true
    }
    return false
  }

  function bannerFor(
    camera: THREE.Camera | undefined,
    pos: THREE.Vector3,
    text: string,
    kind: Parameters<typeof showHitBanner>[1],
  ): void {
    if (!camera) return
    const s = worldToScreen(pos, camera)
    if (s.visible) showHitBanner(text, kind, s.x, s.y - 28)
  }

  function processDummyHits(
    shell: Shell,
    shellIndex: number,
    dummies: readonly DummyTarget[] | undefined,
    camera: THREE.Camera | undefined,
  ): boolean {
    if (!dummies) return false
    const def = ammoById(shell.ammoId)
    const eff = effectiveAmmo(def)
    const stats = {
      basePenetration: eff.penetration,
      baseDamage: eff.penDamage,
      blastDamage: eff.blastDamage,
    }

    for (const d of dummies) {
      if (!d.containsPoint(shell.mesh.position)) continue
      const result = d.resolveShellHit(shell.mesh.position, shell.velocity, stats, {
        ammoId: shell.ammoId,
      })
      if (!result) continue

      const { resolution, destroyed, tracksDisabled } = result
      _sparkPos.copy(shell.mesh.position)
      const isMg = shell.ammoId === 'mg'
      if (resolution.kind === 'ricochet') {
        flashSpark(scene, _sparkPos, 0xe8e8e8, isMg ? 0.45 : 1)
        if (!isMg) {
          bannerFor(camera, _sparkPos, `RICOCHET · ${resolution.part.label}`, 'ricochet')
        }
        shell.velocity.reflect(resolution.normal)
        shell.velocity.multiplyScalar(0.55)
        shell.mesh.position.addScaledVector(resolution.normal, 0.35)
        return false
      }

      if (resolution.kind === 'stopped') {
        flashSpark(scene, _sparkPos, 0xc4a35a, isMg ? 0.4 : 1)
        if (!isMg) {
          bannerFor(camera, _sparkPos, `NO PEN · ${resolution.part.label}`, 'stopped')
        }
        removeAt(shellIndex)
        return true
      }

      if (resolution.kind === 'blast') {
        flashSpark(scene, _sparkPos, 0xe09a5a)
        if (destroyed) {
          bannerFor(camera, _sparkPos, 'KILL · HE', 'kill')
        } else {
          bannerFor(
            camera,
            _sparkPos,
            `HE BLAST −${resolution.damage} · ${resolution.part.label}`,
            'blast',
          )
        }
        removeAt(shellIndex)
        return true
      }

      flashSpark(scene, _sparkPos, destroyed ? 0xff4422 : 0xffcc66, isMg ? 0.5 : 1)
      if (destroyed) {
        bannerFor(
          camera,
          _sparkPos,
          resolution.crit
            ? `AMMO RACK · ${resolution.part.label}`
            : isMg
              ? 'KILL · MG'
              : 'KILL',
          resolution.crit ? 'crit' : 'kill',
        )
      } else if (tracksDisabled) {
        bannerFor(camera, _sparkPos, 'TRACKS OUT · 30s', 'pen')
      } else if (!isMg) {
        bannerFor(
          camera,
          _sparkPos,
          `PEN −${resolution.damage} · ${resolution.part.label}`,
          'pen',
        )
      }
      removeAt(shellIndex)
      return true
    }
    return false
  }

  return {
    setReloadSec(sec) {
      cooldownMax = sec
    },
    setGunProfile(profile) {
      gun = profile
    },
    setPlayableHalf(half) {
      playableHalf = half
    },
    setHeightAt(fn) {
      heightAt = fn
    },
    setWeapon(id) {
      if (weapon === id) return
      weapon = id
      pending = null
      console.info(`[Steel] Weapon → ${id === 'mg' ? 'MACHINE GUN' : 'MAIN GUN'}`)
    },
    toggleWeapon() {
      this.setWeapon(weapon === 'main' ? 'mg' : 'main')
    },
    getWeapon() {
      return weapon
    },
    selectAmmo(id) {
      if (id === 'mg') {
        this.setWeapon('mg')
        return
      }
      this.setWeapon('main')
      if (loading === id && (chambered === id || chambered === null)) {
        loading = id
        return
      }
      if (chambered === id && cooldown <= 0) {
        loading = id
        return
      }
      beginLoad(id)
    },
    getHudState() {
      if (weapon === 'mg') {
        return {
          weapon,
          chambered: 'mg',
          loading: loading === 'mg' ? 'aphe' : loading,
          reloadLeft: mgCooldown,
          reloadTotal: MG_COOLDOWN,
          ready: mgCooldown <= 0 && pending === null,
        }
      }
      return {
        weapon,
        chambered,
        loading,
        reloadLeft: Math.max(0, cooldown),
        reloadTotal: cooldownMax,
        ready: chambered !== null && cooldown <= 0 && pending === null,
      }
    },
    update(dt, wantsFire, muzzle, dummies, camera, propColliders) {
      if (cooldown > 0) {
        cooldown = Math.max(0, cooldown - dt)
        if (cooldown <= 0 && chambered === null) {
          chambered = loading
          console.info(`[Steel] ${AMMO_TYPES[chambered].name} READY`)
        }
      }
      if (mgCooldown > 0) mgCooldown = Math.max(0, mgCooldown - dt)
      let triggered = false

      if (weapon === 'mg') {
        if (wantsFire && mgCooldown <= 0 && pending === null) {
          playFireSound()
          pending = {
            remaining: MG_RELEASE_DELAY,
            ammoId: 'mg',
            dir: aimDirFromMuzzle(muzzle, camera, new THREE.Vector3()),
          }
          mgCooldown = MG_COOLDOWN
          triggered = true
        }
      } else if (wantsFire && chambered !== null && cooldown <= 0 && pending === null) {
        const fired = chambered
        playFireSound()
        pending = {
          remaining: SHELL_RELEASE_DELAY,
          ammoId: fired,
          dir: aimDirFromMuzzle(muzzle, camera, new THREE.Vector3()),
        }
        chambered = null
        beginLoad(loading)
        triggered = true
      }

      if (pending) {
        pending.remaining -= dt
        if (pending.remaining <= 0) {
          spawnShell(muzzle, pending.ammoId, pending.dir)
          pending = null
        }
      }

      for (let i = shells.length - 1; i >= 0; i--) {
        const shell = shells[i]
        shell.age += dt
        integrateShell(shell.mesh.position, shell.velocity, dt)

        if (shell.velocity.lengthSq() > 1e-4) {
          _look.copy(shell.mesh.position).add(shell.velocity)
          shell.mesh.lookAt(_look)
        }

        if (hitGround(shell.mesh.position, shell.hitRadius)) {
          removeAt(i)
          continue
        }

        if (processDummyHits(shell, i, dummies, camera)) continue

        if (
          propColliders &&
          propColliders.length > 0 &&
          hitsPropCollider(shell.mesh.position, propColliders, shell.hitRadius)
        ) {
          flashSpark(scene, shell.mesh.position, 0xb0a080, shell.ammoId === 'mg' ? 0.4 : 1)
          removeAt(i)
          continue
        }

        if (shell.age >= shell.lifetime || outOfBounds(shell.mesh.position)) {
          removeAt(i)
        }
      }

      return triggered
    },
    dispose() {
      pending = null
      for (let i = shells.length - 1; i >= 0; i--) removeAt(i)
      mgGeometry.dispose()
      if (shellTemplate) {
        disposeObject(shellTemplate)
        shellTemplate = null
      }
    },
  }
}