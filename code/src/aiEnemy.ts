import * as THREE from 'three'
import { playFireSound } from './audio'
import { ammoById } from './ammo'
import {
  elevationToHit,
  integrateShell,
  shellVelocityFromDir,
  SHELL_RADIUS,
  SHELL_SPEED,
} from './ballistics'
import { clampToArena } from './arena'
import {
  hitsPropCollider,
  resolvePropCollisions,
  type PropCollider,
} from './collision'
import {
  createCombatant,
  type Combatant,
} from './combatant'
import type { DummyTarget } from './dummy'
import { showHitBanner, worldToScreen } from './hitFeedback'
import { loadPlayerTank } from './loadTank'
import { tankOptionById, type TankId } from './tankCatalog'
import { collectWheels, updateWheels } from './wheels'
import { spawnDestroyedWreck } from './wreck'

const AI_RELOAD = 6.0
const AI_MAX_SPEED = 9
const AI_TURN = 1.35
const AI_ENGAGE = 44
const AI_TOO_CLOSE = 24
const AI_FIRE_RANGE = 90
const AI_FIRE_COS = Math.cos((18 * Math.PI) / 180)
const AI_TRAVERSE = 4.2
const AI_ELEVATE = 2.2
const TANK_R = 1.8
const SHELL_LIFE = 5
const PITCH_MIN = (-12 * Math.PI) / 180
const PITCH_MAX = (22 * Math.PI) / 180

type EnemyShell = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  age: number
}

export type AiSmoke = {
  muzzleBurst: (origin: THREE.Vector3, forward: THREE.Vector3) => void
  damageLeak: (origin: THREE.Vector3, intensity?: number) => void
  wreckPlume: (origin: THREE.Vector3) => void
  wreckFire: (origin: THREE.Vector3) => void
  wreckBurn: (origin: THREE.Vector3) => void
}

export type AiTeam = 'enemy' | 'friendly'

/** Anything an AI can shoot (player combatant or another AI). */
export type AiHostile = {
  root: THREE.Object3D
  alive: boolean
  containsPoint: DummyTarget['containsPoint']
  resolveShellHit: DummyTarget['resolveShellHit']
}

export type AiUpdateContext = {
  hostiles: readonly AiHostile[]
  /** Other tanks to push apart (player + all AI). */
  neighbors: readonly THREE.Object3D[]
  playableHalf: number
  colliders: readonly PropCollider[]
  camera?: THREE.Camera
}

export type AiEnemy = DummyTarget & {
  team: AiTeam
  update: (dt: number, ctx: AiUpdateContext) => void
}

export type AiSpawnOptions = {
  team: AiTeam
  /** Chassis to load (defaults to Pz-III). */
  tankId?: TankId
  position: THREE.Vector3
  yaw?: number
  smoke?: AiSmoke
  heightAt?: (x: number, z: number) => number
}

const _muzzlePos = new THREE.Vector3()
const _muzzleQuat = new THREE.Quaternion()
const _dir = new THREE.Vector3()
const _look = new THREE.Vector3()
const _spark = new THREE.Vector3()
const _gunFwd = new THREE.Vector3()
const _aimPoint = new THREE.Vector3()
const _prevPos = new Map<THREE.Object3D, { x: number; z: number }>()

function darkenEnemy(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m && 'color' in m && m.color instanceof THREE.Color) {
        m.color.multiplyScalar(0.72)
      }
    }
  })
}

function tintFriendly(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m && 'color' in m && m.color instanceof THREE.Color) {
        m.color.offsetHSL(0.12, 0.12, 0.04)
        m.color.multiplyScalar(0.92)
      }
    }
  })
}

function yawToward(current: number, target: number, maxStep: number): number {
  let d = target - current
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  if (Math.abs(d) <= maxStep) return target
  return current + Math.sign(d) * maxStep
}

function pushApart(a: THREE.Vector3, b: THREE.Vector3, minDist: number): void {
  const dx = a.x - b.x
  const dz = a.z - b.z
  const distSq = dx * dx + dz * dz
  if (distSq >= minDist * minDist) return
  if (distSq < 1e-10) {
    a.x += minDist * 0.5
    b.x -= minDist * 0.5
    return
  }
  const dist = Math.sqrt(distSq)
  const push = (minDist - dist) * 0.5
  const nx = dx / dist
  const nz = dz / dist
  a.x += nx * push
  a.z += nz * push
  b.x -= nx * push
  b.z -= nz * push
}

function pickHostile(
  from: THREE.Vector3,
  hostiles: readonly AiHostile[],
): AiHostile | null {
  let best: AiHostile | null = null
  let bestD = Infinity
  for (const h of hostiles) {
    if (!h.alive) continue
    const d = Math.hypot(h.root.position.x - from.x, h.root.position.z - from.z)
    if (d < bestD) {
      bestD = d
      best = h
    }
  }
  return best
}

/** Spawn a Pz-III AI (enemy or friendly team). */
export async function spawnAiPz3Enemy(
  scene: THREE.Scene,
  opts: AiSpawnOptions,
): Promise<AiEnemy> {
  const { team, position, yaw = Math.PI, smoke, heightAt } = opts
  const tankId = opts.tankId ?? 'pz3'
  const chassis = tankOptionById(tankId)
  const handle = await loadPlayerTank(tankId)
  const { root, turret, barrel, muzzle } = handle
  root.name = team === 'friendly' ? 'aiFriendly' : 'aiEnemy'
  root.position.copy(position)
  root.rotation.order = 'YXZ'
  root.rotation.y = yaw
  if (team === 'friendly') tintFriendly(root)
  else darkenEnemy(root)
  scene.add(root)

  const flatY = position.y
  const label =
    team === 'friendly' ? `Friendly ${chassis.name}` : `Enemy ${chassis.name}`
  const combat = createCombatant(root, {
    maxHp: Math.round(chassis.maxHp * 0.85),
    label,
    onDestroyed: (r) => {
      spawnDestroyedWreck(scene, r, smoke)
    },
  })

  const wheels = collectWheels(root)
  const option = chassis
  const shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 8, 8)
  const shells: EnemyShell[] = []

  let speed = 0
  let reloadLeft = 2.0 + Math.random() * 2
  let leakAcc = 0

  function spawnShell(): void {
    const def = ammoById('aphe')
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.6,
    })
    const mesh = new THREE.Mesh(shellGeo, mat)
    mesh.name = team === 'friendly' ? 'friendlyShell' : 'aiShell'
    mesh.castShadow = true

    muzzle.updateMatrixWorld(true)
    muzzle.getWorldPosition(_muzzlePos)
    if (muzzle.parent) {
      muzzle.parent.getWorldQuaternion(_muzzleQuat)
      _dir.set(0, 0, 1).applyQuaternion(_muzzleQuat).normalize()
    } else {
      _dir.set(0, 0, 1)
    }

    mesh.position.copy(_muzzlePos)
    scene.add(mesh)
    shells.push({ mesh, velocity: shellVelocityFromDir(_dir), age: 0 })
    smoke?.muzzleBurst(_muzzlePos, _dir)
    playFireSound()
  }

  function removeShell(i: number): void {
    const shell = shells[i]
    scene.remove(shell.mesh)
    if (shell.mesh.material instanceof THREE.Material) shell.mesh.material.dispose()
    shells.splice(i, 1)
  }

  function processHostileHit(
    shell: EnemyShell,
    target: AiHostile,
    camera: THREE.Camera | undefined,
  ): boolean {
    if (!target.containsPoint(shell.mesh.position)) return false
    const def = ammoById('aphe')
    const stats = {
      basePenetration: def.penetration * option.gun.aphePenMult * 0.85,
      baseDamage: def.penDamage * option.gun.apheDmgMult * 0.85,
      blastDamage: 0,
    }
    const result = target.resolveShellHit(shell.mesh.position, shell.velocity, stats, {
      ammoId: 'aphe',
    })
    if (!result) return false

    _spark.copy(shell.mesh.position)
    const { resolution, destroyed, tracksDisabled } = result
    const isPlayer = target.root.name === 'playerTank'
    const youTag = isPlayer ? ' · YOU' : ''

    if (resolution.kind === 'ricochet') {
      shell.velocity.reflect(resolution.normal)
      shell.velocity.multiplyScalar(0.55)
      shell.mesh.position.addScaledVector(resolution.normal, 0.35)
      if (camera) {
        const s = worldToScreen(_spark, camera)
        if (s.visible) showHitBanner(`RICOCHET${youTag}`, 'ricochet', s.x, s.y - 28)
      }
      return false
    }

    if (camera) {
      const s = worldToScreen(_spark, camera)
      if (s.visible) {
        if (destroyed) showHitBanner(isPlayer ? 'YOU DESTROYED' : 'KILL', 'kill', s.x, s.y - 28)
        else if (tracksDisabled)
          showHitBanner(isPlayer ? 'YOUR TRACKS · 30s' : 'TRACKS OUT', 'pen', s.x, s.y - 28)
        else if (resolution.kind === 'stopped')
          showHitBanner(`NO PEN${youTag}`, 'stopped', s.x, s.y - 28)
        else showHitBanner(`HIT −${resolution.damage}${youTag}`, 'pen', s.x, s.y - 28)
      }
    }
    return true
  }

  function tickShells(
    dt: number,
    hostiles: readonly AiHostile[],
    playableHalf: number,
    colliders: readonly PropCollider[],
    camera: THREE.Camera | undefined,
  ): void {
    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i]
      shell.age += dt
      integrateShell(shell.mesh.position, shell.velocity, dt)
      if (shell.velocity.lengthSq() > 1e-4) {
        _look.copy(shell.mesh.position).add(shell.velocity)
        shell.mesh.lookAt(_look)
      }

      const gy = (heightAt ? heightAt(shell.mesh.position.x, shell.mesh.position.z) : 0) + SHELL_RADIUS
      if (shell.mesh.position.y <= gy) {
        removeShell(i)
        continue
      }
      if (
        Math.abs(shell.mesh.position.x) > playableHalf - SHELL_RADIUS ||
        Math.abs(shell.mesh.position.z) > playableHalf - SHELL_RADIUS ||
        shell.age >= SHELL_LIFE
      ) {
        removeShell(i)
        continue
      }
      if (hitsPropCollider(shell.mesh.position, colliders, SHELL_RADIUS)) {
        removeShell(i)
        continue
      }

      let hit = false
      for (const h of hostiles) {
        if (!h.alive) continue
        if (processHostileHit(shell, h, camera)) {
          hit = true
          break
        }
      }
      if (hit) removeShell(i)
    }
  }

  const unit: AiEnemy = {
    team,
    get root() {
      return combat.root
    },
    get alive() {
      return combat.alive
    },
    get hp() {
      return combat.hp
    },
    maxHp: combat.maxHp,
    containsPoint: (p) => combat.containsPoint(p),
    resolveShellHit: (p, v, s, ctx) => combat.resolveShellHit(p, v, s, ctx),

    update(dt, ctx) {
      const { hostiles, neighbors, playableHalf, colliders, camera } = ctx
      combat.tickMobility(dt)

      if (!combat.alive) {
        tickShells(dt, hostiles, playableHalf, colliders, camera)
        return
      }

      const immobilized = combat.isImmobilized()
      const target = pickHostile(root.position, hostiles)

      if (!target) {
        speed = Math.max(0, speed - 10 * dt)
        updateWheels(wheels, dt, speed, 0)
        tickShells(dt, hostiles, playableHalf, colliders, camera)
        return
      }

      const tpos = target.root.position
      const dtSafe = Math.max(dt, 1e-4)
      const prev = _prevPos.get(target.root) ?? { x: tpos.x, z: tpos.z }
      const tVelX = (tpos.x - prev.x) / dtSafe
      const tVelZ = (tpos.z - prev.z) / dtSafe
      _prevPos.set(target.root, { x: tpos.x, z: tpos.z })

      const distNow = Math.hypot(tpos.x - root.position.x, tpos.z - root.position.z)
      const tFlight = THREE.MathUtils.clamp(distNow / SHELL_SPEED, 0.2, 2.8) * 1.12
      _aimPoint.set(tpos.x + tVelX * tFlight, tpos.y + 1.15, tpos.z + tVelZ * tFlight)

      const dx = _aimPoint.x - root.position.x
      const dz = _aimPoint.z - root.position.z
      const dist = Math.hypot(dx, dz)
      const desiredYaw = Math.atan2(dx, dz)

      let rel = desiredYaw - root.rotation.y
      while (rel > Math.PI) rel -= Math.PI * 2
      while (rel < -Math.PI) rel += Math.PI * 2
      turret.rotation.y = yawToward(turret.rotation.y, rel, AI_TRAVERSE * dt)

      muzzle.updateMatrixWorld(true)
      muzzle.getWorldPosition(_muzzlePos)
      const horiz = Math.max(
        Math.hypot(_aimPoint.x - _muzzlePos.x, _aimPoint.z - _muzzlePos.z),
        0.5,
      )
      const deltaY = _aimPoint.y - _muzzlePos.y
      const worldPitch =
        elevationToHit(horiz, deltaY) ??
        THREE.MathUtils.clamp(Math.atan2(deltaY, horiz), PITCH_MIN, PITCH_MAX)
      const clampedWorld = THREE.MathUtils.clamp(worldPitch, PITCH_MIN, PITCH_MAX)
      const hullPitch = root.rotation.x
      const targetPivotPitch = -clampedWorld - hullPitch
      const pitchStep = AI_ELEVATE * dt
      const pd = targetPivotPitch - barrel.rotation.x
      barrel.rotation.x += Math.abs(pd) <= pitchStep ? pd : Math.sign(pd) * pitchStep

      let yawWrapHull = desiredYaw - root.rotation.y
      while (yawWrapHull > Math.PI) yawWrapHull -= Math.PI * 2
      while (yawWrapHull < -Math.PI) yawWrapHull += Math.PI * 2

      if (!immobilized) {
        const facingOk = Math.cos(yawWrapHull) > 0.35
        let throttle = 0
        if (dist > AI_ENGAGE && facingOk) throttle = 1
        else if (dist < AI_TOO_CLOSE) throttle = -0.55

        if (throttle !== 0) {
          root.rotation.y = yawToward(root.rotation.y, desiredYaw, AI_TURN * dt)
        }

        if (throttle > 0) speed = Math.min(AI_MAX_SPEED, speed + 8 * dt)
        else if (throttle < 0) speed = Math.max(-4, speed - 6 * dt)
        else if (speed > 0) speed = Math.max(0, speed - 10 * dt)
        else if (speed < 0) speed = Math.min(0, speed + 10 * dt)

        const yaw = root.rotation.y
        root.position.x += Math.sin(yaw) * speed * dt
        root.position.z += Math.cos(yaw) * speed * dt
        root.position.y = heightAt
          ? heightAt(root.position.x, root.position.z)
          : flatY

        let blocked =
          resolvePropCollisions(root.position, TANK_R, colliders) ||
          clampToArena(root.position, playableHalf, TANK_R)

        for (const other of neighbors) {
          if (other === root) continue
          pushApart(root.position, other.position, TANK_R * 2.15)
        }
        blocked =
          resolvePropCollisions(root.position, TANK_R, colliders) ||
          clampToArena(root.position, playableHalf, TANK_R) ||
          blocked
        if (blocked) speed = 0

        updateWheels(
          wheels,
          dt,
          speed,
          Math.abs(yawWrapHull) > 0.05 && throttle !== 0 ? -Math.sign(yawWrapHull) : 0,
        )
      } else {
        speed = 0
        updateWheels(wheels, dt, 0, 0)
      }

      reloadLeft = Math.max(0, reloadLeft - dt)
      barrel.updateMatrixWorld(true)
      barrel.getWorldQuaternion(_muzzleQuat)
      _gunFwd.set(0, 0, 1).applyQuaternion(_muzzleQuat).normalize()
      const toAimX = _aimPoint.x - _muzzlePos.x
      const toAimZ = _aimPoint.z - _muzzlePos.z
      const toAimLen = Math.hypot(toAimX, toAimZ) || 1
      const gunDot = (_gunFwd.x * toAimX + _gunFwd.z * toAimZ) / toAimLen

      if (
        reloadLeft <= 0 &&
        dist < AI_FIRE_RANGE &&
        dist > 10 &&
        gunDot >= AI_FIRE_COS &&
        target.alive
      ) {
        spawnShell()
        reloadLeft = AI_RELOAD
      }

      leakAcc += dt
      if (leakAcc > 0.35 && combat.hp < combat.maxHp * 0.55) {
        leakAcc = 0
        smoke?.damageLeak(
          root.position.clone().setY(1.4),
          1.2 - combat.hp / combat.maxHp,
        )
      }

      tickShells(dt, hostiles, playableHalf, colliders, camera)
    },
  }

  console.info(
    `[Steel] ${label} at (${position.x.toFixed(0)}, ${position.z.toFixed(0)}) HP ${combat.maxHp}`,
  )
  return unit
}

/** Spread spawn points around a base so tanks don’t stack. */
export function aiSpawnRing(
  base: THREE.Vector3,
  count: number,
  radius: number,
  sampleY: (x: number, z: number) => number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    const ang = (i / Math.max(count, 1)) * Math.PI * 2 + 0.4
    const r = radius * (0.55 + (i % 3) * 0.2)
    const x = base.x + Math.cos(ang) * r
    const z = base.z + Math.sin(ang) * r
    out.push(new THREE.Vector3(x, sampleY(x, z), z))
  }
  return out
}

/** Wrap player combatant as an AI hostile. */
export function playerAsHostile(player: Combatant): AiHostile {
  return {
    root: player.root,
    get alive() {
      return player.alive
    },
    containsPoint: (p) => player.containsPoint(p),
    resolveShellHit: (p, v, s, ctx) => player.resolveShellHit(p, v, s, ctx),
  }
}
