import './style.css'
import * as THREE from 'three'
import { spawnAiPz3Enemy, playerAsHostile, type AiEnemy } from './aiEnemy'
import { unlockAudio } from './audio'
import { addArenaWalls, clampToArena, type ArenaHalf } from './arena'
import { bindMouseAim, getAimDirection, resetAim, setAimHeightAt, setAimLocalYawPitch, setAimPrecision, setAimRates, updateTurretAim, type AimFrame } from './aim'
import { type CameraMode, adjustAimZoom, updatePlayerCamera } from './camera'
import { findClearSpawnNear, resolvePropCollisions, type PropCollider } from './collision'
import { createCombatant } from './combatant'
import type { DummyTarget } from './dummy'
import { createDriveController } from './drive'
import { createFireSystem } from './fire'
import { createHud } from './hud'
import {
  bindDriveInput,
  consumeAimToggle,
  consumeAmmoSelect,
  consumeArtilleryMapToggle,
  consumeWeaponSelect,
  consumeCameraToggle,
  consumeZoomDelta,
  getDriveInput,
} from './input'
import { createArtilleryController, type ArtilleryController } from './artillery'
import { loadPlayerTank } from './loadTank'
import { FOREST_TOWNS } from './maps/forestOverwatch'
import { loadMap, mapOptionById } from './maps/mapCatalog'
import { showMainMenu, type MenuSelection, type TeamId } from './menu'
import { nationByTeam } from './nations'
import {
  createHillRing,
  createKothState,
  inHill,
  KOTH_CENTER,
  KOTH_RADIUS,
  KOTH_RESPAWN_SEC,
  KOTH_WIN_SEC,
  setHillRingColor,
  tickKoth,
} from './koth'
import { PALETTE } from './paint'
import { lockPointer } from './pointerLock'
import { punchShotRecoil, resetShotRecoil, updateShotRecoil } from './recoil'
import { createSmokeSystem } from './smoke'
import { tankOptionById } from './tankCatalog'
import { collectWheels, updateWheels } from './wheels'
import { collectTracks, updateTracks } from './tracks'
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

let playable: ArenaHalf = {
  x: DEFAULT_ARENA / 2 - 0.3,
  z: DEFAULT_ARENA / 2 - 0.3,
}

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

/** Widen sun shadow frustum for large maps. */
function configureShadowsForMap(sizeX: number, sizeZ: number): void {
  const arenaSize = Math.max(sizeX, sizeZ)
  camera.far = Math.max(2000, arenaSize * 2.2)
  renderer.shadowMap.enabled = true
  sun.shadow.mapSize.set(2048, 2048)
  const halfX = Math.max(120, sizeX * 0.55)
  const halfZ = Math.max(120, sizeZ * 0.55)
  const half = Math.max(halfX, halfZ)
  sun.position.set(halfX * 0.55, half * 0.75, halfZ * 0.35)
  sun.shadow.camera.far = half * 2.4
  sun.shadow.camera.left = -halfX
  sun.shadow.camera.right = halfX
  sun.shadow.camera.top = halfZ
  sun.shadow.camera.bottom = -halfZ
  sun.shadow.camera.updateProjectionMatrix()
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.near = Math.min(80, arenaSize * 0.03)
    scene.fog.far = Math.max(900, arenaSize * 0.55)
  }
  camera.updateProjectionMatrix()
}

bindDriveInput()
bindMouseAim()

const clock = new THREE.Clock()
const fire = createFireSystem(scene, playable.x)
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
  const { mapId, tankId, team, spawnIndex, redAi, blueAi, timeOfDay, season, weather, gameMode } =
    sel
  const isKoth = gameMode === 'koth'
  unlockAudio()
  const mapOpt = mapOptionById(mapId)
  const option = tankOptionById(tankId)
  fire.setReloadSec(option.reloadSec)
  fire.setGunProfile(option.gun)
  fire.setPlayableBounds(playable)
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
  let mapPaths: Array<{ points: Array<{ x: number; z: number }> }> | undefined
  let mapSpawns = mapOpt.spawns
  try {
    const map = await loadMap(mapId, scene, ground)
    mapColliders = map.colliders
    mapGroundY = map.groundY
    heightAt = map.heightAt
    mapPaths = map.paths
    if (map.spawns) mapSpawns = map.spawns
  } catch (err) {
    console.warn('[Steel] Map load failed', err)
    mapColliders = []
  }

  configureShadowsForMap(mapOpt.sizeX, mapOpt.sizeZ)
  if (weather === 'fog') {
    camera.far = Math.min(camera.far, 260)
    camera.updateProjectionMatrix()
  } else if (weather === 'rain') {
    camera.far = Math.min(camera.far, 800)
    camera.updateProjectionMatrix()
  }

  if (mapOpt.useArenaWalls) {
    playable = addArenaWalls(scene, mapOpt.sizeX, mapOpt.sizeZ)
    fire.setPlayableBounds(playable)
  } else {
    playable = { x: mapOpt.sizeX / 2 - 1, z: mapOpt.sizeZ / 2 - 1 }
    fire.setPlayableBounds(playable)
  }

  // Maps with heightfields build their own terrain mesh (hide the flat plane).
  if (heightAt) {
    ground.visible = false
  } else {
    ground.visible = true
    ground.scale.set(mapOpt.sizeX / DEFAULT_ARENA, 1, mapOpt.sizeZ / DEFAULT_ARENA)
  }

  const sampleY = (x: number, z: number) =>
    heightAt ? heightAt(x, z) : mapGroundY

  function spawnAt(teamSide: TeamId, index: number): THREE.Vector3 {
    const list = mapSpawns[teamSide]
    const base = list[index] ?? list[0]!
    // Spiral out of any leftover collider overlap.
    const clear = findClearSpawnNear(base.x, base.z, mapColliders, {
      radius: TANK_RADIUS + 1.2,
      playableHalfX: playable.x,
      playableHalfZ: playable.z,
      maxRange: 280,
      y: sampleY(base.x, base.z) + 1.2,
    })
    const pos = new THREE.Vector3(clear.x, 0, clear.z)
    pos.y = sampleY(pos.x, pos.z)
    console.info(
      `[Steel] Spawn ${teamSide}[${index}] → (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) y=${pos.y.toFixed(2)}`,
    )
    return pos
  }

  setAimHeightAt(heightAt ?? null)
  fire.setHeightAt(heightAt ?? null)

  const smoke = await createSmokeSystem(scene)

  const playerSpawn = spawnAt(team, spawnIndex)
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
  const aiSlots: Array<{ unit: AiEnemy; teamSide: TeamId; slot: number; deadFor: number }> =
    []
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
          const pos = spawnAt(team, slot)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const unit = await spawnAiPz3Enemy(scene, {
            team: 'friendly',
            tankId: allyAiTanks[i],
            position: pos,
            yaw,
            smoke,
            heightAt,
            persistMesh: isKoth,
          })
          friendlies.push(unit)
          allAi.push(unit)
          aiSlots.push({ unit, teamSide: team, slot, deadFor: 0 })
        }
        const foeSlots = freeSpawnIndices(opposite, null)
        for (let i = 0; i < foeAiTanks.length && i < foeSlots.length; i++) {
          const slot = foeSlots[i]
          const pos = spawnAt(opposite, slot)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const unit = await spawnAiPz3Enemy(scene, {
            team: 'enemy',
            tankId: foeAiTanks[i],
            position: pos,
            yaw,
            smoke,
            heightAt,
            persistMesh: isKoth,
          })
          enemies.push(unit)
          allAi.push(unit)
          aiSlots.push({ unit, teamSide: opposite, slot, deadFor: 0 })
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
      armor: option.armor,
      label: 'Player',
      onDestroyed: (r) => {
        console.info('[Steel] Player destroyed')
        if (isKoth) {
          r.visible = false
          return
        }
        spawnDestroyedWreck(scene, r, smoke)
      },
    })
    const playerHostile = playerAsHostile(playerCombat)

    const drive = createDriveController(option.drive)
    drive.setGroundY(mapGroundY)
    drive.setHeightAt(heightAt ?? null)
    const wheels = collectWheels(tank)
    const trackBands = collectTracks(tank, {
      hullInference: option.nation === 'germany',
    })
    console.info(
      `[Steel] TP2 drivetrain (${option.nation ?? '—'}) — wheels L/R ${wheels.left.length}/${wheels.right.length} · track bands ${trackBands.length}`,
    )
    const hud = createHud({
      mapSizeX: mapOpt.sizeX,
      mapSizeZ: mapOpt.sizeZ,
      theme: 'forest',
      towns:
        FOREST_TOWNS.length > 0
          ? FOREST_TOWNS.map((t) => ({
              x: t.x,
              z: t.z,
              name: t.name,
              radius: t.radius,
            }))
          : undefined,
      paths: mapPaths,
      spawns: [
        ...mapOpt.spawns.red.map((p) => ({
          x: p.x,
          z: p.z,
          team: 'red' as const,
        })),
        ...mapOpt.spawns.blue.map((p) => ({
          x: p.x,
          z: p.z,
          team: 'blue' as const,
        })),
      ],
      hill: isKoth ? { x: KOTH_CENTER.x, z: KOTH_CENTER.z, radius: KOTH_RADIUS } : undefined,
    })
    hud.setVisible(true)

    const arty: ArtilleryController | null = option.artillery
      ? createArtilleryController({
          arenaSizeX: mapOpt.sizeX,
          arenaSizeZ: mapOpt.sizeZ,
          canvas: renderer.domElement,
        })
      : null

    let cameraMode: CameraMode = 'turret'
    let aiming = false
    let matchOver = false
    let playerDeadFor = 0
    let koth = createKothState()
    const hillRing = isKoth ? createHillRing(scene) : null
    if (hillRing) {
      hillRing.position.y = sampleY(KOTH_CENTER.x, KOTH_CENTER.z) + 0.12
    }
    const kothObjective = isKoth
      ? { x: KOTH_CENTER.x, z: KOTH_CENTER.z, radius: KOTH_RADIUS }
      : undefined
    const _exhaust = new THREE.Vector3()
    const _muzzleWorld = new THREE.Vector3()
    const _fwd = new THREE.Vector3()

    updatePlayerCamera(cameraMode, camera, tank, turretMount, 1, aiming, muzzle)
    loading.remove()
    lockPointer(renderer.domElement)
    if (isKoth) {
      hud.setKoth({
        vostokHold: 0,
        meridianHold: 0,
        owner: 'none',
        winSec: KOTH_WIN_SEC,
      })
      console.info(
        `[Steel] King of the Hill — hold Midwood ${KOTH_WIN_SEC}s · respawn ${KOTH_RESPAWN_SEC}s`,
      )
    }

    function countOnHill(side: TeamId): number {
      let n = 0
      if (playerCombat.alive && team === side && inHill(tank.position.x, tank.position.z)) n++
      const list = side === team ? friendlies : enemies
      for (const u of list) {
        if (u.alive && inHill(u.root.position.x, u.root.position.z)) n++
      }
      return n
    }

    function respawnPlayer(): void {
      const pos = spawnAt(team, spawnIndex)
      const yaw = Math.atan2(-pos.x, -pos.z)
      tank.position.copy(pos)
      tank.rotation.y = yaw
      drive.killSpeed()
      resetAim(yaw)
      playerCombat.revive()
      playerDeadFor = 0
      hud.setRespawn(null)
      console.info('[Steel] Player KOTH respawn')
    }

    function tickRespawns(dt: number): void {
      if (!isKoth || matchOver) return
      if (!playerCombat.alive) {
        playerDeadFor += dt
        hud.setRespawn(Math.max(0, KOTH_RESPAWN_SEC - playerDeadFor))
        if (playerDeadFor >= KOTH_RESPAWN_SEC) respawnPlayer()
      } else {
        playerDeadFor = 0
        hud.setRespawn(null)
      }
      for (const rec of aiSlots) {
        if (rec.unit.alive) {
          rec.deadFor = 0
          continue
        }
        rec.deadFor += dt
        if (rec.deadFor >= KOTH_RESPAWN_SEC) {
          const pos = spawnAt(rec.teamSide, rec.slot)
          rec.unit.reviveAt(pos, Math.atan2(-pos.x, -pos.z))
          rec.deadFor = 0
        }
      }
    }

    function checkMatchEnd(): void {
      if (matchOver) return
      if (isKoth) {
        if (!koth.winner) return
        matchOver = true
        document.exitPointerLock()
        const won = koth.winner === team
        const winner = nationByTeam(koth.winner)
        showMatchEnd({
          kind: won ? 'win' : 'lose',
          team: koth.winner,
          title: won ? 'Victory' : 'Defeat',
          sub: `${winner.name} held Midwood.`,
        })
        return
      }
      if (!playerCombat.alive) {
        matchOver = true
        document.exitPointerLock()
        showMatchEnd('lose')
        return
      }
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
      if (ammoPick) fire.selectAmmo(ammoPick)
      const weaponPick = consumeWeaponSelect()
      if (weaponPick) fire.setWeapon(weaponPick)
      if (arty && consumeArtilleryMapToggle()) arty.toggleMap()

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
              clampToArena(pos, playable, TANK_RADIUS)
            if (blocked) drive.killSpeed()
          },
        )
        if (wheels) {
          updateWheels(
            wheels,
            dt,
            immobilized ? 0 : drive.getSpeed(),
            immobilized ? 0 : turn,
          )
        }
        if (trackBands.length > 0) {
          updateTracks(
            trackBands,
            dt,
            immobilized ? 0 : drive.getSpeed(),
            immobilized ? 0 : turn,
          )
        }
        arty?.update(Math.abs(drive.getSpeed()))
      } else {
        playerCombat.tickMobility(dt)
        env.update(dt, camera, 0, option.vintageCrew)
        arty?.update(0)
      }

      if (arty?.isMapOpen()) {
        arty.syncMap(
          tank.position,
          enemies.map((e, i) => ({
            x: e.root.position.x,
            z: e.root.position.z,
            alive: e.alive,
            id: `e${i}`,
          })),
        )
      }

      // Location aim: simple look-at toward map mark (sane pitch, no ballistic loft).
      if (arty) {
        const mark = arty.getAimPoint()
        if (mark) {
          const ox = tank.position.x
          const oy = tank.position.y + 2.8
          const oz = tank.position.z
          const ty = sampleY(mark.x, mark.z) + 0.5
          const dx = mark.x - ox
          const dz = mark.z - oz
          const horiz = Math.max(Math.hypot(dx, dz), 0.5)
          const pitch = Math.atan2(ty - oy, horiz)
          const desiredYaw = Math.atan2(dx, dz)
          let rel = desiredYaw - tank.rotation.y
          while (rel > Math.PI) rel -= Math.PI * 2
          while (rel < -Math.PI) rel += Math.PI * 2
          setAimLocalYawPitch(rel, pitch)
        }
      }

      const aim = updateTurretAim(dt, camera, tank, turret, barrel, muzzle, dummies)

      const useMg = fire.getWeapon() === 'mg'
      const activeMuzzle = useMg ? mgMuzzle : muzzle
      const canFire = !arty || arty.isDeployed()
      const fired = fire.update(
        dt,
        alive && wantsFire && canFire,
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

      if (alive) {
        const speed = Math.abs(drive.getSpeed())
        tank.updateMatrixWorld(true)
        _exhaust.set(0, 1.35, -2.4)
        tank.localToWorld(_exhaust)
        smoke.engineExhaust(_exhaust, 0.35 + Math.min(1, speed / 14) * 0.35)
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
            playable,
            colliders: mapColliders,
            camera,
            objective: kothObjective,
          })
        }
      }

      updateWrecks(dt, smoke)
      smoke.update(dt, camera)
      tickRespawns(dt)
      if (isKoth && !matchOver) {
        koth = tickKoth(koth, dt, countOnHill('red'), countOnHill('blue'))
        if (hillRing) setHillRingColor(hillRing, koth.owner)
        hud.setKoth({
          vostokHold: koth.vostokHold,
          meridianHold: koth.meridianHold,
          owner: koth.owner,
          winSec: KOTH_WIN_SEC,
        })
      }
      checkMatchEnd()

      return aim
    }

    function animate(): void {
      requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const aim = updateTank(dt)
      updatePlayerCamera(cameraMode, camera, tank, turretMount, dt, aiming, muzzle)
      hud.updateCrosshairs(camera, aim.mouseHit, aim.barrelHit, aim.gunSynced)
      hud.updateCombat({
        hp: playerCombat.hp,
        maxHp: option.maxHp,
        fire: fire.getHudState(),
        tracksDisableLeft: playerCombat.getTracksDisableLeft(),
        envStatus: env.getDriveMods().status,
        artilleryStatus: arty?.getHud().status,
        headingRad: tank.rotation.y,
        speedU: drive.getSpeed(),
        rangeM: aim.rangeM,
        posX: tank.position.x,
        posZ: tank.position.z,
        foes: enemies
          .filter((e) => e.alive)
          .map((e) => ({ x: e.root.position.x, z: e.root.position.z })),
        allies: friendlies
          .filter((a) => a.alive)
          .map((a) => ({ x: a.root.position.x, z: a.root.position.z })),
      })
      renderer.render(scene, camera)
    }

    console.info(
      `[Steel] Deployed ${option.name} · ${isKoth ? 'KOTH' : 'Skirmish'} · ${nationByTeam(team).short} spawn ${spawnIndex + 1} — foes ${enemies.length}, allies ${friendlies.length} — ${timeOfDay}/${season}/${weather}`,
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
