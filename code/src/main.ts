import './style.css'
import * as THREE from 'three'
import { spawnAiPz3Enemy, playerAsHostile, type AiEnemy } from './aiEnemy'
import { unlockAudio } from './audio'
import { addArenaWalls, clampToArena } from './arena'
import { bindMouseAim, getAimDirection, resetAim, setAimHeightAt, setAimPrecision, setAimRates, updateTurretAim, type AimFrame } from './aim'
import { type CameraMode, adjustAimZoom, updatePlayerCamera } from './camera'
import { resolvePropCollisions, type PropCollider } from './collision'
import { createCombatant } from './combatant'
import type { DummyTarget } from './dummy'
import { createDriveController } from './drive'
import { createFireSystem } from './fire'
import { createHud } from './hud'
import {
  bindDriveInput,
  consumeAimToggle,
  consumeAmmoSelect,
  consumeWeaponSelect,
  consumeCameraToggle,
  consumeZoomDelta,
  getDriveInput,
} from './input'
import { loadPlayerTank } from './loadTank'
import { loadMap, mapOptionById } from './maps/mapCatalog'
import { showMainMenu, getTeamSpawn, type MenuSelection, type TeamId } from './menu'
import { PALETTE } from './paint'
import { lockPointer } from './pointerLock'
import { punchShotRecoil, resetShotRecoil, updateShotRecoil } from './recoil'
import { createSmokeSystem } from './smoke'
import { createSandDust } from './sandDust'
import { tankOptionById } from './tankCatalog'
import { collectWheels, updateWheels } from './wheels'
import { createTrackMarks } from './trackMarks'
import { spawnDestroyedWreck, updateWrecks } from './wreck'
import { createEnvironment } from './environment'
import { showMatchEnd } from './endScreen'

/** Expose for threejs-devtools-mcp bridge helpers / run_js. */
;(window as unknown as { THREE: typeof THREE }).THREE = THREE

const DEFAULT_ARENA = 150
const TANK_RADIUS = 1.8

const scene = new THREE.Scene()
scene.fog = null

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.2,
  2000,
)
camera.position.set(0, 3, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(PALETTE.sky, 1)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Official Three.js DevTools observe hook (MCP bridge)
const devtools = (window as unknown as { __THREE_DEVTOOLS__?: EventTarget }).__THREE_DEVTOOLS__
if (devtools) {
  devtools.dispatchEvent(new CustomEvent('observe', { detail: renderer }))
  devtools.dispatchEvent(new CustomEvent('observe', { detail: scene }))
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(DEFAULT_ARENA, DEFAULT_ARENA),
  new THREE.MeshStandardMaterial({
    color: PALETTE.ground,
    roughness: PALETTE.groundRough,
    metalness: 0.04,
  }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

let playableHalf = DEFAULT_ARENA / 2 - 0.3

const ambient = new THREE.AmbientLight(PALETTE.ambient, 0.55)
scene.add(ambient)

const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.4)
scene.add(hemi)

const sun = new THREE.DirectionalLight(PALETTE.sun, 1.1)
sun.position.set(70, 90, 40)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0002
sun.shadow.normalBias = 0.05
sun.shadow.camera.near = 1
sun.shadow.camera.far = 280
sun.shadow.camera.left = -100
sun.shadow.camera.right = 100
sun.shadow.camera.top = 100
sun.shadow.camera.bottom = -100
scene.add(sun)

/** Widen sun shadow frustum for large maps (e.g. 1000m arenas). */
function configureShadowsForMap(arenaSize: number): void {
  const half = Math.max(120, arenaSize * 0.55)
  sun.position.set(half * 0.55, half * 0.75, half * 0.35)
  sun.shadow.camera.far = half * 2.4
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.updateProjectionMatrix()
  camera.far = Math.max(2000, arenaSize * 4)
  camera.updateProjectionMatrix()
}

bindDriveInput()
bindMouseAim()

const clock = new THREE.Clock()
const fire = createFireSystem(scene, playableHalf)
let mapColliders: readonly PropCollider[] = []

function onResize(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

window.addEventListener('resize', onResize)

async function startMission(sel: MenuSelection): Promise<void> {
  const { mapId, tankId, team, spawnIndex, redAi, blueAi, timeOfDay, season, weather } =
    sel
  unlockAudio()
  const mapOpt = mapOptionById(mapId)
  const option = tankOptionById(tankId)
  fire.setReloadSec(option.reloadSec)
  fire.setGunProfile(option.gun)
  fire.setPlayableHalf(playableHalf)
  setAimRates(option.gun.traverseRadPerSec, option.gun.elevateRadPerSec)
  resetShotRecoil()

  const env = createEnvironment(
    scene,
    renderer,
    { ambient, hemi, sun },
    { timeOfDay, season, weather },
  )

  const loading = document.createElement('div')
  loading.id = 'loading-overlay'
  loading.innerHTML = `<p class="loading-brand">Steel</p><p class="loading-msg">Loading ${mapOpt.name}…</p>`
  document.body.appendChild(loading)

  let mapGroundY = 0
  let heightAt: ((x: number, z: number) => number) | undefined
  try {
    const map = await loadMap(mapId, scene, ground)
    mapColliders = map.colliders
    mapGroundY = map.groundY
    heightAt = map.heightAt
  } catch (err) {
    console.warn('[Steel] Map load failed', err)
    mapColliders = []
  }

  configureShadowsForMap(mapOpt.size)
  if (weather === 'fog') {
    camera.far = Math.min(camera.far, 260)
    camera.updateProjectionMatrix()
  } else if (weather === 'rain') {
    camera.far = Math.min(camera.far, 800)
    camera.updateProjectionMatrix()
  }

  if (mapOpt.useArenaWalls) {
    playableHalf = addArenaWalls(scene, mapOpt.size)
    fire.setPlayableHalf(playableHalf)
  } else {
    playableHalf = mapOpt.size / 2 - 1
    fire.setPlayableHalf(playableHalf)
  }

  if (mapId === 'forest') {
    ground.visible = true
    ground.scale.setScalar(mapOpt.size / DEFAULT_ARENA)
    mapGroundY = 0
    heightAt = undefined
  }

  const sampleY = (x: number, z: number) =>
    heightAt ? heightAt(x, z) : mapGroundY

  setAimHeightAt(heightAt ?? null)
  fire.setHeightAt(heightAt ?? null)

  const smoke = await createSmokeSystem(scene)
  const sand = heightAt ? createSandDust(scene, heightAt) : null
  const tracks = heightAt ? createTrackMarks(scene, heightAt) : null

  const playerSpawn = getTeamSpawn(mapId, team, spawnIndex)
  playerSpawn.y = sampleY(playerSpawn.x, playerSpawn.z)
  // Face toward map center
  const playerYaw = Math.atan2(-playerSpawn.x, -playerSpawn.z)

  const opposite: TeamId = team === 'red' ? 'blue' : 'red'
  const allyAiTanks = team === 'red' ? redAi : blueAi
  const foeAiTanks = team === 'red' ? blueAi : redAi

  function freeSpawnIndices(teamSide: TeamId, playerTook: number | null): number[] {
    const idxs = [0, 1, 2]
    if (playerTook === null) return idxs
    if (teamSide !== team) return idxs
    return idxs.filter((i) => i !== playerTook)
  }

  const enemies: AiEnemy[] = []
  const friendlies: AiEnemy[] = []
  const allAi: AiEnemy[] = []
  try {
    const loadingMsg = loading.querySelector('.loading-msg')
    if (loadingMsg) loadingMsg.textContent = `Loading ${option.name}…`

    const playerHandle = await loadPlayerTank(tankId)

    if (allyAiTanks.length > 0 || foeAiTanks.length > 0) {
      if (loadingMsg) loadingMsg.textContent = 'Loading AI…'
      try {
        const allySlots = freeSpawnIndices(team, spawnIndex)
        for (let i = 0; i < allyAiTanks.length && i < allySlots.length; i++) {
          const slot = allySlots[i]
          const pos = getTeamSpawn(mapId, team, slot)
          pos.y = sampleY(pos.x, pos.z)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const unit = await spawnAiPz3Enemy(scene, {
            team: 'friendly',
            tankId: allyAiTanks[i],
            position: pos,
            yaw,
            smoke,
            heightAt,
          })
          friendlies.push(unit)
          allAi.push(unit)
        }
        const foeSlots = freeSpawnIndices(opposite, null)
        for (let i = 0; i < foeAiTanks.length && i < foeSlots.length; i++) {
          const slot = foeSlots[i]
          const pos = getTeamSpawn(mapId, opposite, slot)
          pos.y = sampleY(pos.x, pos.z)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const unit = await spawnAiPz3Enemy(scene, {
            team: 'enemy',
            tankId: foeAiTanks[i],
            position: pos,
            yaw,
            smoke,
            heightAt,
          })
          enemies.push(unit)
          allAi.push(unit)
        }
      } catch (err) {
        console.warn('[Steel] Failed to spawn AI', err)
      }
    }

    // Player can only damage enemies (no friendly fire)
    const dummies: DummyTarget[] = enemies

    const { root: tank, turret, barrel, muzzle, mgMuzzle, turretMount } = playerHandle
    tank.name = 'playerTank'
    tank.position.copy(playerSpawn)
    tank.rotation.order = 'YXZ'
    tank.rotation.y = playerYaw
    scene.add(tank)
    resetAim(tank.rotation.y)

    const playerCombat = createCombatant(tank, {
      maxHp: option.maxHp,
      label: 'Player',
      onDestroyed: (r) => {
        console.info('[Steel] Player destroyed')
        spawnDestroyedWreck(scene, r, smoke)
      },
    })
    const playerHostile = playerAsHostile(playerCombat)

    const drive = createDriveController(option.drive)
    drive.setGroundY(mapGroundY)
    drive.setHeightAt(heightAt ?? null)
    const wheels = collectWheels(tank)
    const hud = createHud()
    hud.setVisible(true)

    let cameraMode: CameraMode = 'turret'
    let aiming = false
    let matchOver = false
    const _exhaust = new THREE.Vector3()
    const _muzzleWorld = new THREE.Vector3()
    const _fwd = new THREE.Vector3()

    updatePlayerCamera(cameraMode, camera, tank, turretMount, 1, aiming)
    loading.remove()
    lockPointer(renderer.domElement)

    function checkMatchEnd(): void {
      if (matchOver) return
      if (!playerCombat.alive) {
        matchOver = true
        document.exitPointerLock()
        showMatchEnd('lose')
        return
      }
      // Win when every enemy is dead (0 enemies = already won after spawn? skip if none)
      if (enemies.length > 0 && enemies.every((e) => !e.alive)) {
        matchOver = true
        document.exitPointerLock()
        showMatchEnd('win')
      }
    }

    function updateTank(dt: number): AimFrame {
      const alive = playerCombat.alive && !matchOver
      const { forward, turn, brake, fire: wantsFire } = getDriveInput()

      if (consumeCameraToggle()) {
        cameraMode = cameraMode === 'turret' ? 'chase' : 'turret'
        console.info(`[Steel] Camera → ${cameraMode}`)
      }

      if (consumeAimToggle()) {
        aiming = !aiming
        setAimPrecision(aiming)
        hud.setAiming(aiming)
        console.info(`[Steel] Aim → ${aiming ? 'ON' : 'OFF'}`)
      }

      const zoomDelta = consumeZoomDelta()
      if (aiming && zoomDelta !== 0) {
        adjustAimZoom(zoomDelta)
      }

      const ammoPick = consumeAmmoSelect()
      if (ammoPick) {
        fire.selectAmmo(ammoPick)
      }
      const weaponPick = consumeWeaponSelect()
      if (weaponPick) {
        fire.setWeapon(weaponPick)
      }

      if (alive) {
        playerCombat.tickMobility(dt)
        const immobilized = playerCombat.isImmobilized()
        env.update(dt, camera, drive.getSpeed(), option.vintageCrew)
        const mods = env.getDriveMods()
        drive.setMobilityMul(mods.mobilityMul)
        drive.setSlip(mods.slip)
        drive.update(
          dt,
          immobilized
            ? { forward: 0, turn: 0, brake: true }
            : { forward, turn, brake },
          tank,
          (pos) => {
            const blocked =
              resolvePropCollisions(pos, TANK_RADIUS, mapColliders) ||
              clampToArena(pos, playableHalf, TANK_RADIUS)
            if (blocked) drive.killSpeed()
          },
        )
        updateWheels(
          wheels,
          dt,
          immobilized ? 0 : drive.getSpeed(),
          immobilized ? 0 : turn,
        )
      } else {
        playerCombat.tickMobility(dt)
        env.update(dt, camera, 0, option.vintageCrew)
      }

      const aim = updateTurretAim(dt, camera, tank, turret, barrel, muzzle, dummies)

      const useMg = fire.getWeapon() === 'mg'
      const activeMuzzle = useMg ? mgMuzzle : muzzle
      const fired = fire.update(
        dt,
        alive && wantsFire,
        activeMuzzle,
        dummies,
        camera,
        mapColliders,
      )
      if (fired) {
        if (!useMg) punchShotRecoil()
        activeMuzzle.updateMatrixWorld(true)
        activeMuzzle.getWorldPosition(_muzzleWorld)
        if (useMg) {
          // Burst from coax mount, aimed along current aim (not main barrel tip)
          getAimDirection(_fwd)
          smoke.muzzleBurst(_muzzleWorld, _fwd)
        } else {
          barrel.updateMatrixWorld(true)
          const q = new THREE.Quaternion()
          barrel.getWorldQuaternion(q)
          if (barrel.userData.gunForward === 'x') {
            _fwd.set(1, 0, 0).applyQuaternion(q).normalize()
          } else {
            _fwd.set(0, 0, 1).applyQuaternion(q).normalize()
          }
          smoke.gunBlastCloud(_muzzleWorld, _fwd)
          smoke.muzzleBurst(_muzzleWorld, _fwd)
        }
      }

      updateShotRecoil(dt, tank, barrel)

      // Engine exhaust from rear deck
      if (alive) {
        const speed = Math.abs(drive.getSpeed())
        tank.updateMatrixWorld(true)
        _exhaust.set(0, 1.35, -2.4)
        tank.localToWorld(_exhaust)
        smoke.engineExhaust(_exhaust, 0.35 + Math.min(1, speed / 14) * 0.35)
        sand?.update(dt, tank, drive.getSpeed(), camera)
        tracks?.update(dt, tank, drive.getSpeed())
      }

      if (allAi.length > 0) {
        const neighbors = [tank, ...allAi.map((a) => a.root)]
        for (const unit of allAi) {
          const hostiles =
            unit.team === 'enemy'
              ? [playerHostile, ...friendlies]
              : [...enemies]
          unit.update(dt, {
            hostiles,
            neighbors,
            playableHalf,
            colliders: mapColliders,
            camera,
          })
        }
      }

      updateWrecks(dt, smoke)
      smoke.update(dt, camera)
      checkMatchEnd()

      return aim
    }

    function animate(): void {
      requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const aim = updateTank(dt)
      updatePlayerCamera(cameraMode, camera, tank, turretMount, dt, aiming)
      hud.updateCrosshairs(camera, aim.mouseHit, aim.barrelHit, aim.gunSynced)
      hud.updateCombat({
        hp: playerCombat.hp,
        maxHp: option.maxHp,
        fire: fire.getHudState(),
        tracksDisableLeft: playerCombat.getTracksDisableLeft(),
        envStatus: env.getDriveMods().status,
      })
      renderer.render(scene, camera)
    }

    console.info(
      `[Steel] Deployed ${option.name} on ${team} spawn ${spawnIndex + 1} — foes ${enemies.length}, allies ${friendlies.length} — ${timeOfDay}/${season}/${weather}`,
    )
    animate()
  } catch (err) {
    loading.remove()
    throw err
  }
}

async function main(): Promise<void> {
  function idle(): void {
    renderer.render(scene, camera)
  }
  const idleId = window.setInterval(idle, 100)

  const selection = await showMainMenu()
  window.clearInterval(idleId)
  await startMission(selection)
}

main().catch((err) => {
  console.error('[Steel] Failed to start', err)
})
