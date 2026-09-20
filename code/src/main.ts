import './style.css'
import * as THREE from 'three'
import { spawnAiPz3Enemy, playerAsHostile, type AiEnemy } from './aiEnemy'
import { spawnAiCorsair, isAircraftTankId } from './aiAircraft'
import {
  unlockAudio,
  createDieselEngine,
  createPropEngine,
  createEjectSiren,
  createLowAltAlarm,
  createStallAlarm,
  type EngineLoop,
} from './audio'
import { addArenaWalls, clampToArena, type ArenaHalf } from './arena'
import { bindMouseAim, getAimDirection, resetAim, resetAimPitchLimits, setAimHeightAt, setAimLocalYawPitch, setAimPitchLimits, setAimPrecision, setAimRates, updateTurretAim, type AimFrame } from './aim'
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
  consumeNvgToggle,
  getDriveInput,
  bindFlightInput,
  getFlightInput,
  resetFlightInput,
  isLockHold,
  isSamFire,
} from './input'
import { createLockOn, type LockPhase } from './lockOn'
import { createLockOnHud } from './lockOnHud'
import { aimAaAtLockedTarget, clearAaAimTracking } from './aaAutoAim'
import { createMissileLockStub, noteMissileLockChange } from './missileStub'
import { createSamMissiles } from './samMissiles'
import { createCountermeasures, readPublishedDecoys } from './countermeasures'
import { createArtilleryController, type ArtilleryController } from './artillery'
import { loadPlayerTank } from './loadTank'
import { loadPlayerAircraft, type AircraftHandle } from './loadAircraft'
import { createAircraftFlight } from './aircraftFlight'
import { createAircraftChaseCamera } from './aircraftCamera'
import { createFlightHud, type MissileHudState } from './flightHud'
import { createAircraftGuns } from './aircraftGuns'
import { createAircraftBombs } from './aircraftBombs'
import { createImpactCinematic, KILL_SHOT } from './impactCinematic'
import { createEjectCinematic } from './ejectCinematic'
import { createEjectAlert } from './ejectAlert'
import { FOREST_TOWNS, FOREST_PROP_URLS } from './maps/forestOverwatch'
import { loadMap, mapOptionById } from './maps/mapCatalog'
import { onGltfProgress, preloadUrls } from './loadGltf'
import { showMainMenu, type MenuSelection, type TeamId } from './menu'
import { nationByTeam } from './nations'
import { getMpSession } from './net/mpSession'
import type { MpTankPose } from './net/mpProtocol'
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
import { createNvg } from './nvg'
import { createMatchOpening } from './openingCinematic'
import { showMatchEnd } from './endScreen'
import { grantMatchWin } from './wallet'
import { createPodium3d, type Podium3d, type PodiumPlace } from './podium3d'
import { createMatchScoreboard, type ScoreRow } from './scoreboard'
import { createKillIndicator } from './killIndicator'
import { getSession } from './auth'

/** Expose for threejs-devtools-mcp bridge helpers / run_js. */
;(window as unknown as { THREE: typeof THREE }).THREE = THREE

const DEFAULT_ARENA = 150
const TANK_RADIUS = 1.8
/** Spawn altitude above the ground spawn point for aircraft. */
const AIR_SPAWN_ALT = 140
/** Aircraft ceiling above map ground level. */
const AIR_CEILING = 460
/** Aircraft turn back this far inside the tank arena walls. */
const AIR_WALL_INSET = 12
/** Low-alt buzzer while AGL is at or below this (metres). */
const LOW_ALT_WARN_M = 25
/** Ceiling on a single simulated step, so the bomb cam's fast-forward can't
 *  hand the flight model or AI a step big enough to go unstable. */
const MAX_SIM_DT = 0.07

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
renderer.shadowMap.type = THREE.PCFShadowMap
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

const timer = new THREE.Timer()
const fire = createFireSystem(scene, playable.x)
let mapColliders: readonly PropCollider[] = []
/** When set, the render loop shows the victory stage instead of the battle. */
let podiumStage: Podium3d | null = null

function onResize(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
  podiumStage?.resize(width, height)
}

/** Build the 3D podium: 1st centre, runner-up left, 3rd right. */
async function startVictoryStage(
  rows: readonly ScoreRow[],
  win: boolean,
  team?: TeamId,
): Promise<void> {
  const top = rows.slice(0, 3)
  if (top.length === 0) return
  try {
    const stage = await createPodium3d(
      top.map((row, i) => ({
        place: (i + 1) as PodiumPlace,
        name: row.name,
        tankId: row.tankId,
        tankName: row.tankName,
        team: row.team,
        kills: row.kills,
        deaths: row.deaths,
        isPlayer: row.isPlayer,
      })),
      { win, team },
    )
    stage.resize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 1)
    podiumStage = stage
    console.info(`[Steel] Victory stage — ${top.length} on the podium`)
  } catch (err) {
    console.warn('[Steel] Victory stage failed — HTML board only', err)
  }
}

window.addEventListener('resize', onResize)

async function startMission(sel: MenuSelection): Promise<void> {
  const { mapId, tankId, team, spawnIndex, redAi, blueAi, timeOfDay, season, weather, gameMode, mp } =
    sel
  const isKoth = gameMode === 'koth'
  const mpSess = mp ? getMpSession() : null
  if (mp && !mpSess) {
    console.warn('[Steel] MP selection without session — continuing as solo')
  }
  unlockAudio()
  const mapOpt = mapOptionById(mapId)
  const option = tankOptionById(tankId)
  fire.setReloadSec(option.reloadSec)
  fire.setGunProfile(option.gun)
  fire.setPlayableBounds(playable)
  setAimRates(option.gun.traverseRadPerSec, option.gun.elevateRadPerSec)
  if (option.antiAir || option.aimPitchMinDeg != null || option.aimPitchMaxDeg != null) {
    setAimPitchLimits(option.aimPitchMinDeg ?? -5, option.aimPitchMaxDeg ?? 85)
  } else {
    resetAimPitchLimits()
  }
  resetShotRecoil()

  const env = createEnvironment(
    scene,
    renderer,
    { ambient, hemi, sun },
    { timeOfDay, season, weather },
  )
  const nvg = createNvg({
    night: timeOfDay === 'night',
    scene,
    renderer,
    lights: { ambient, hemi, sun },
  })
  if (timeOfDay === 'night') {
    console.info('[Steel] Night mission — press N for NVG')
  }

  const loading = document.createElement('div')
  loading.id = 'loading-overlay'
  loading.innerHTML = `<p class="loading-brand">Steel</p><p class="loading-msg">Loading ${mapOpt.name}…</p>`
  document.body.appendChild(loading)
  const loadingMsg = loading.querySelector('.loading-msg') as HTMLElement
  const stopProgress = onGltfProgress((p) => {
    const mb = p.bytes > 0 ? ` · ${(p.bytes / 1_048_576).toFixed(0)} MB` : ''
    loadingMsg.textContent =
      p.active + p.done === 0
        ? `Loading ${mapOpt.name}…`
        : `Loading models… ${p.done} ready${p.active ? ` · ${p.active} downloading` : ''}${mb}`
  })
  void preloadUrls([
    ...FOREST_PROP_URLS,
    option.url,
    ...(mp ? [tankOptionById(mp.remoteTankId).url] : []),
    ...redAi.map((id) => tankOptionById(id).url),
    ...blueAi.map((id) => tankOptionById(id).url),
  ])

  let mapGroundY = 0
  let heightAt: ((x: number, z: number) => number) | undefined
  let mapPaths: Array<{ points: Array<{ x: number; z: number }> }> | undefined
  let mapSpawns = mapOpt.spawns
  let playerHandleEarly: Awaited<ReturnType<typeof loadPlayerTank>> | null = null
  let remoteHandleEarly: Awaited<ReturnType<typeof loadPlayerTank>> | null = null
  let airHandleEarly: AircraftHandle | null = null
  let smokeEarly: Awaited<ReturnType<typeof createSmokeSystem>> | null = null
  const isAir = option.aircraft === true
  try {
    const loads: Promise<unknown>[] = [
      loadMap(mapId, scene, ground),
      createSmokeSystem(scene),
      isAir ? loadPlayerAircraft(tankId) : loadPlayerTank(tankId),
    ]
    if (mp && !isAir) loads.push(loadPlayerTank(mp.remoteTankId))
    const settled = await Promise.allSettled(loads)
    const mapRes = settled[0]!
    const smokeRes = settled[1]!
    const playerRes = settled[2]!
    const remoteRes = mp && !isAir ? settled[3] : undefined
    if (mapRes.status === 'fulfilled') {
      const v = mapRes.value as Awaited<ReturnType<typeof loadMap>>
      mapColliders = v.colliders
      mapGroundY = v.groundY
      heightAt = v.heightAt
      mapPaths = v.paths
      if (v.spawns) mapSpawns = v.spawns
    } else {
      console.warn('[Steel] Map load failed', mapRes.reason)
      mapColliders = []
    }
    if (smokeRes.status === 'fulfilled') smokeEarly = smokeRes.value as Awaited<ReturnType<typeof createSmokeSystem>>
    else console.warn('[Steel] Smoke load failed', smokeRes.reason)
    if (playerRes.status === 'fulfilled') {
      if (isAir) airHandleEarly = playerRes.value as AircraftHandle
      else playerHandleEarly = playerRes.value as Awaited<ReturnType<typeof loadPlayerTank>>
    } else {
      console.warn('[Steel] Player vehicle load failed', playerRes.reason)
    }
    if (remoteRes?.status === 'fulfilled') {
      remoteHandleEarly = remoteRes.value as Awaited<ReturnType<typeof loadPlayerTank>>
    } else if (remoteRes?.status === 'rejected') {
      console.warn('[Steel] Remote tank load failed', remoteRes.reason)
    }
  } catch (err) {
    console.warn('[Steel] Map / tank / smoke load failed', err)
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

  // ——— Air branch (Phase F4U) ———
  // F2: the Corsair flies. Chase camera and instruments here are provisional —
  // F3 replaces them with the real chase cam + flight HUD. This deliberately
  // returns before any tank drive/aim/fire setup is built, so tanks can't
  // regress from air work.
  if (isAir) {
    if (!airHandleEarly) {
      throw new Error(`[Steel] Failed to load aircraft ${tankId} — check network / Pages assets`)
    }
    const air = airHandleEarly
    const base = mapSpawns[team][spawnIndex] ?? mapSpawns[team][0]!
    air.root.position.set(base.x, sampleY(base.x, base.z) + AIR_SPAWN_ALT, base.z)
    air.root.rotation.y = Math.atan2(-base.x, -base.z)
    air.root.userData.air = true
    scene.add(air.root)

    // Plane never captures the hill — only ground units do. In KOTH a crash
    // or eject respawns; in Skirmish either one ends the match.
    let airCrashed = false
    let airDeadFor = 0
    // Jets: no prop SFX (static airframe — no spin / gear motion either).
    const silentProp: EngineLoop = {
      start() {},
      stop() {},
      setIntensity() {},
    }
    const propEngine = option.jet ? silentProp : createPropEngine()
    const ejectSiren = createEjectSiren()
    const lowAltAlarm = createLowAltAlarm()
    const stallAlarm = createStallAlarm()
    const flight = createAircraftFlight({
      root: air.root,
      heightAt: sampleY,
      throttle: 0.55,
      // Share the tanks' playable box so air and ground agree on the arena,
      // pulled in a little so the aircraft turns before clipping a wall.
      bounds: { x: playable.x - AIR_WALL_INSET, z: playable.z - AIR_WALL_INSET },
      ceiling: mapGroundY + AIR_CEILING,
      onCrash: ({ speed }) => {
        bailOut('crash', speed)
      },
    })

    function bailOut(reason: 'crash' | 'eject', speed: number): void {
      if (airCrashed || airEnded) return
      airCrashed = true
      airDeadFor = 0
      ejectCam.cancel()
      ejectAlert.cancel()
      ejectSiren.setActive(false)
      lowAltAlarm.setActive(false)
      stallAlarm.setActive(false)
      propEngine.setIntensity(0)
      airBoard.noteDeath(air.root)
      if (reason === 'eject') {
        console.info(`[Steel] Corsair ejected at ${speed.toFixed(0)} m/s`)
      } else {
        console.info(`[Steel] Corsair crashed at ${speed.toFixed(0)} m/s`)
      }
      if (!isKoth) {
        finishAirMatch(
          'lose',
          reason === 'eject' ? 'Ejected' : 'Shot Down',
          reason === 'eject'
            ? `You punched out of ${option.name}.`
            : `You flew ${option.name} into the deck at ${Math.round(speed)} m/s.`,
        )
      } else {
        flightHud.setRespawn(KOTH_RESPAWN_SEC)
        console.info(`[Steel] Air KOTH respawn in ${KOTH_RESPAWN_SEC}s`)
      }
    }

    let ejectSpeed = 0
    const ejectExitVel = new THREE.Vector3()
    const ejectAlert = createEjectAlert()
    /** Assigned after scoreboard register — eject cam toggles it. */
    let killInd: ReturnType<typeof createKillIndicator> | null = null
    const ejectCam = createEjectCinematic({
      scene,
      heightAt: sampleY,
      onShow: (showing) => {
        flightHud.setVisible(!showing)
        killInd?.setVisible(!showing)
      },
      onDone: () => {
        ejectSiren.setActive(false)
        bailOut('eject', ejectSpeed)
      },
      onAirframeFx: (origin, grounded) => {
        if (!smokeEarly) return
        smokeEarly.wreckBurn(origin)
        if (!grounded && Math.random() < 0.1) smokeEarly.wreckFire(origin)
        if (grounded && Math.random() < 0.2) smokeEarly.wreckFire(origin)
      },
    })

    /** Y pressed — banner + siren, seat fires after the arm delay. */
    function armEject(): void {
      if (
        airCrashed ||
        airEnded ||
        flight.isFlameout() ||
        ejectCam.active() ||
        ejectAlert.active()
      ) {
        return
      }
      if (!ejectAlert.arm()) return
      lowAltAlarm.setActive(false)
      stallAlarm.setActive(false)
      ejectSiren.setActive(true)
    }

    /** Seat fires after arm countdown. */
    function commitEject(): void {
      if (airCrashed || airEnded || flight.isFlameout() || ejectCam.active()) {
        ejectAlert.cancel()
        ejectSiren.setActive(false)
        return
      }
      const tm = flight.telemetry()
      ejectSpeed = tm.speed
      // Capture velocity BEFORE forceCrash zeros it (old bug → hover-drop).
      ejectExitVel.copy(flight.velocity)
      if (ejectExitVel.lengthSq() < 4) {
        const nose = flight.noseDir()
        ejectExitVel.copy(nose).multiplyScalar(Math.max(40, tm.speed))
        ejectExitVel.y -= 6
      }
      flight.forceCrash()
      propEngine.setIntensity(0)
      lowAltAlarm.setActive(false)
      stallAlarm.setActive(false)
      ejectSiren.setActive(true)
      ejectCam.begin({
        aircraft: air.root,
        velocity: ejectExitVel,
      })
      console.info(`[Steel] Eject seat — ${ejectSpeed.toFixed(0)} m/s`)
    }
    bindFlightInput()
    resetFlightInput()
    // Pointer lock waits until match opening finishes (click = skip).

    stopProgress()
    loading.remove()
    console.info(
      `[Steel] ${option.name} · ${isKoth ? 'KOTH' : 'Skirmish'} — wingspan ${air.wingspan.toFixed(2)}m · spawn alt ${air.root.position.y.toFixed(0)}m`,
    )

    const chase = createAircraftChaseCamera({
      camera,
      target: air.root,
      velocity: flight.velocity,
      heightAt: sampleY,
    })
    chase.reset()

    const flightHud = createFlightHud({
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
        ...mapOpt.spawns.red.map((p) => ({ x: p.x, z: p.z, team: 'red' as const })),
        ...mapOpt.spawns.blue.map((p) => ({ x: p.x, z: p.z, team: 'blue' as const })),
      ],
      hill: isKoth ? { x: KOTH_CENTER.x, z: KOTH_CENTER.z, radius: KOTH_RADIUS } : undefined,
    })
    // L1/L3 lock-on: F-16 radar + real AAMs.
    const airLock = option.jet ? createLockOn() : null
    const airLockHud = option.jet ? createLockOnHud() : null
    airLockHud?.setVisible(false)
    let airMissilePhase: LockPhase = 'idle'
    const _lockOrigin = new THREE.Vector3()
    const _lockLook = new THREE.Vector3()

    const countermeasures = createCountermeasures({
      scene,
      getPosition: (out) => {
        air.root.getWorldPosition(out)
      },
      getVelocity: (out) => {
        out.copy(flight.velocity)
      },
    })

    const airAam =
      airLock != null
        ? createSamMissiles({
            scene,
            getLaunchOrigin: (out) => {
              // Rail off the wing root — slightly below so it clears the belly.
              air.root.getWorldPosition(out)
              _lockLook.set(-1.8, -0.35, 0.8).applyQuaternion(air.root.quaternion)
              out.add(_lockLook)
            },
            getLaunchDir: (out) => {
              out.set(0, 0, 1).applyQuaternion(air.root.quaternion).normalize()
            },
            // Soft diamond or hard lock — both feed the seeker.
            getLockedTarget: () => airLock.getTrackTarget(),
            getHostiles: () => airEnemies,
            getDecoys: () => countermeasures.getDecoys(),
            heightAt: sampleY,
            onKill: (victim) => {
              airBoard.noteKill(air.root)
              console.info(`[Steel] F-16 AAM destroyed ${victim.name || 'target'}`)
            },
            maxAmmo: 6,
            reloadSec: 1.4,
            speed: 175,
            damage: 520,
            color: 0xffe8a0,
            logTag: 'AAM',
            airLaunch: true,
            meshScale: 1.35,
          })
        : null
    // Keep stub API for lock-phase logging only.
    const airMissile = airLock ? createMissileLockStub(airLock) : null

    let airKoth = createKothState()
    const airHillRing = isKoth ? createHillRing(scene) : null
    if (airHillRing) {
      airHillRing.position.y = sampleY(KOTH_CENTER.x, KOTH_CENTER.z) + 0.12
    }
    const airObjective = isKoth
      ? { x: KOTH_CENTER.x, z: KOTH_CENTER.z, radius: KOTH_RADIUS }
      : undefined
    if (isKoth) {
      flightHud.setKoth({
        vostokHold: 0,
        meridianHold: 0,
        owner: 'none',
        winSec: KOTH_WIN_SEC,
      })
      console.info(
        `[Steel] Air KOTH — ground units hold Midwood ${KOTH_WIN_SEC}s · you strafe · respawn ${KOTH_RESPAWN_SEC}s`,
      )
    }

    // ——— Armour to strafe (F5) ———
    // Ground AI is spawned here rather than reusing the tank path's block so
    // the tank flow stays untouched. Kill credit uses the same scoreboard.
    const airBoard = createMatchScoreboard()
    const airEnemies: AiEnemy[] = []
    const airFriendlies: AiEnemy[] = []
    type AirAiSlot = { unit: AiEnemy; teamSide: TeamId; slot: number; deadFor: number }
    const airAiSlots: AirAiSlot[] = []
    const airOpposite: TeamId = team === 'red' ? 'blue' : 'red'
    let airSeq = 0

    airBoard.register({
      id: 'player',
      name: getSession()?.username ?? 'You',
      tankId,
      tankName: option.name,
      team,
      isPlayer: true,
      root: air.root,
    })
    killInd = createKillIndicator()
    const unsubAirKill = airBoard.onPlayerKill((n) => killInd!.noteKill(n))
    killInd.setKills(0)
    killInd.setVisible(false)

    const airPlayerCombat = createCombatant(air.root, {
      maxHp: option.maxHp,
      armor: option.armor,
      broadRadius: 9,
      altitudeSpan: 7,
      label: 'Player',
      onDestroyed: () => {
        if (airCrashed || airEnded || flight.isFlameout()) return
        // Don't freeze mid-air — flame-out dive until the deck (onCrash → bailOut).
        flight.beginFlameout()
        propEngine.setIntensity(0)
        console.info('[Steel] Player aircraft shot down — engine flame-out')
      },
    })
    const airPlayerHostile = playerAsHostile(airPlayerCombat)
    const _flameEng = new THREE.Vector3()
    const _flameNose = new THREE.Vector3()
    const _mapNose = new THREE.Vector3()

    const airJobs: Array<Promise<void>> = []
    const airFlightBounds = { x: playable.x - AIR_WALL_INSET, z: playable.z - AIR_WALL_INSET }
    const airCeiling = mapGroundY + AIR_CEILING
    for (const [list, side, teamSide] of [
      [team === 'red' ? blueAi : redAi, 'enemy', airOpposite],
      [team === 'red' ? redAi : blueAi, 'friendly', team],
    ] as const) {
      for (let i = 0; i < list.length && i < 3; i++) {
        const chassisId = list[i]!
        const chassis = tankOptionById(chassisId)
        const pos = spawnAt(teamSide, i)
        const id = `ai-${++airSeq}`
        const display = `${nationByTeam(teamSide).short} ${chassis.name}`
        const slot = i
        const yaw = Math.atan2(-pos.x, -pos.z)
        const common = {
          team: side,
          tankId: chassisId,
          position: pos,
          yaw,
          smoke: smokeEarly ?? undefined,
          heightAt: sampleY,
          persistMesh: isKoth,
          onKill: () => airBoard.noteKillById(id),
          onDeath: () => airBoard.noteDeathById(id),
        } as const
        airJobs.push(
          (isAircraftTankId(chassisId)
            ? spawnAiCorsair(scene, {
                ...common,
                bounds: airFlightBounds,
                ceiling: airCeiling,
                spawnAlt: AIR_SPAWN_ALT,
              })
            : spawnAiPz3Enemy(scene, common)
          ).then((unit) => {
            airBoard.register({
              id,
              name: display,
              tankId: chassisId,
              tankName: chassis.name,
              team: teamSide,
              root: unit.root,
            })
            ;(side === 'enemy' ? airEnemies : airFriendlies).push(unit)
            airAiSlots.push({ unit, teamSide, slot, deadFor: 0 })
          }),
        )
      }
    }
    await Promise.allSettled(airJobs)
    console.info(
      `[Steel] Air mission — ${airEnemies.length} hostile / ${airFriendlies.length} friendly AI`,
    )

    flightHud.setVisible(false)
    const airMatchOpening = createMatchOpening({
      units: [
        { root: air.root, team, aircraft: true },
        ...airFriendlies.map((u) => ({
          root: u.root,
          team,
          aircraft: !!u.aircraft,
        })),
        ...airEnemies.map((u) => ({
          root: u.root,
          team: airOpposite,
          aircraft: !!u.aircraft,
        })),
      ],
      spawns: { red: mapSpawns.red, blue: mapSpawns.blue },
      heightAt: sampleY,
      mapHalfZ: mapOpt.sizeZ / 2,
      playerRoot: air.root,
      onDone: () => {
        flightHud.setVisible(true)
        killInd?.setVisible(true)
        airLockHud?.setVisible(true)
        lockPointer(renderer.domElement)
        chase.reset()
        propEngine.start()
        propEngine.setIntensity(0.35)
        ejectSiren.start()
        lowAltAlarm.start()
        stallAlarm.start()
      },
    })

    const guns = createAircraftGuns({
      scene,
      root: air.root,
      gun: option.gun,
      heightAt: sampleY,
      bounds: playable,
      velocity: flight.velocity,
      ...(option.jet
        ? {
            stations: [[0, -0.15, air.nose.position.z]] as const,
            noMirrorStations: true,
          }
        : {}),
    })
    guns.setOnKill((victim) => {
      airBoard.noteKill(air.root)
      console.info(`[Steel] Corsair guns destroyed ${victim.name || 'target'}`)
    })

    const bombs = createAircraftBombs({
      scene,
      root: air.root,
      heightAt: sampleY,
      bounds: playable,
      velocity: flight.velocity,
    })
    bombs.setOnKill((victim) => {
      airBoard.noteKill(air.root)
      console.info(`[Steel] Corsair bomb destroyed ${victim.name || 'target'}`)
    })

    // Bombsight scope renders the target area as a second, narrow-FOV pass.
    // Off by default so the extra draw call is opt-in.
    let scopeOn = false
    const scopeCam = new THREE.PerspectiveCamera(20, 1, 1, camera.far)
    const scopeLook = new THREE.Vector3()

    let airEnded = false

    function presentAirMatchEnd(
      kind: 'win' | 'lose',
      title: string,
      sub: string,
      endTeam: TeamId = team,
    ): void {
      airMatchOpening.dispose()
      nvg.dispose()
      propEngine.stop()
      ejectSiren.stop()
      lowAltAlarm.stop()
      stallAlarm.stop()
      ejectCam.cancel()
      ejectAlert.dispose()
      document.exitPointerLock?.()
      flightHud.setVisible(false)
      flightHud.setRespawn(null)
      killInd?.setVisible(false)
      unsubAirKill()
      killInd?.dispose()
      killInd = null
      airLock?.reset()
      airMissile?.reset()
      airAam?.dispose()
      countermeasures.dispose()
      airLockHud?.setVisible(false)
      airLockHud?.dispose()
      // Death is recorded in onCrash / eject (and KOTH can crash more than once).
      const rows = airBoard.ranked()
      const reward = kind === 'win' ? grantMatchWin('air-victory') : null
      showMatchEnd({
        kind,
        team: endTeam,
        title,
        sub,
        leaderboard: rows,
        podium3d: true,
        reward,
      })
      void startVictoryStage(rows, kind === 'win', endTeam)
    }

    /** Same end path as tanks: HTML board + 3D podium. */
    function finishAirMatch(
      kind: 'win' | 'lose',
      title: string,
      sub: string,
      endTeam: TeamId = team,
    ): void {
      if (airEnded) return
      airEnded = true
      presentAirMatchEnd(kind, title, sub, endTeam)
    }

    function countAirOnHill(side: TeamId): number {
      let n = 0
      const list = side === team ? airFriendlies : airEnemies
      for (const u of list) {
        if (u.aircraft) continue
        if (u.alive && inHill(u.root.position.x, u.root.position.z)) n++
      }
      return n
    }

    function respawnAirPlayer(): void {
      const pos = spawnAt(team, spawnIndex)
      const yaw = Math.atan2(-pos.x, -pos.z)
      pos.y = sampleY(pos.x, pos.z) + AIR_SPAWN_ALT
      flight.reset(pos, yaw, 0.55)
      guns.refill()
      bombs.refill()
      airPlayerCombat.revive()
      chase.reset()
      airCrashed = false
      airDeadFor = 0
      flightHud.setRespawn(null)
      propEngine.setIntensity(0.35)
      lockPointer(renderer.domElement)
      console.info('[Steel] Corsair KOTH respawn')
    }

    function tickAirRespawns(dt: number): void {
      if (!isKoth || airEnded) return
      if (airCrashed) {
        airDeadFor += dt
        flightHud.setRespawn(Math.max(0, KOTH_RESPAWN_SEC - airDeadFor))
        if (airDeadFor >= KOTH_RESPAWN_SEC) respawnAirPlayer()
      }
      for (const rec of airAiSlots) {
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

    function flyLoop(now = performance.now()): void {
      requestAnimationFrame(flyLoop)
      timer.update(now)
      const realDt = Math.min(timer.getDelta(), 0.05)
      if (podiumStage) {
        podiumStage.update(realDt)
        renderer.render(podiumStage.scene, podiumStage.camera)
        return
      }
      if (airMatchOpening.active()) {
        airMatchOpening.update(realDt, camera)
        renderer.render(scene, camera)
        return
      }
      // Sim step — no bomb cinematic time dilation.
      const dt = realDt

      const raw = getFlightInput(dt)
      if (consumeNvgToggle()) nvg.toggle()
      if (
        raw.eject &&
        !airCrashed &&
        !airEnded &&
        !flight.isFlameout() &&
        !ejectCam.active() &&
        !ejectAlert.active()
      ) {
        armEject()
      }
      if (
        raw.toggleGear &&
        air.landingGear &&
        !airCrashed &&
        !airEnded &&
        !ejectCam.active()
      ) {
        air.landingGear.toggle()
      }
      countermeasures.update(
        dt,
        !airCrashed && !airEnded && !ejectCam.active() && raw.dropChaff,
      )
      air.landingGear?.update(realDt)
      if (ejectAlert.active()) {
        if (airCrashed || airEnded || flight.isFlameout()) {
          ejectAlert.cancel()
          ejectSiren.setActive(false)
        } else if (ejectAlert.update(realDt)) {
          commitEject()
        }
      }
      // Flame-out ignores stick entirely (handled inside the flight model).
      const input =
        ejectCam.active() || flight.isFlameout()
          ? { ...raw, pitch: 0, roll: 0, rudder: 0, handsOff: true, fire: false, dropBomb: false }
          : raw
      const tm = flight.update(dt, input)
      if (!tm.crashed && !tm.flameout) air.spinProp(dt, tm.throttle)
      else if (tm.flameout) air.spinProp(dt, 0)
      // Prop idle: throttle + airspeed; silent while crashed / flame-out / match over.
      if (airEnded || airCrashed || tm.flameout || ejectCam.active()) {
        propEngine.setIntensity(0)
      } else {
        const thr = tm.throttle
        const spd = Math.min(1, tm.speed / 100)
        propEngine.setIntensity(0.25 + thr * 0.45 + spd * 0.3)
      }
      // Low-alt buzzer while close to the deck (stops as soon as you climb out).
      lowAltAlarm.setActive(
        !airEnded &&
          !airCrashed &&
          !tm.flameout &&
          !ejectCam.active() &&
          !ejectAlert.active() &&
          tm.agl <= LOW_ALT_WARN_M,
      )
      // Stall warning — high-pitch buzz while below stall speed.
      stallAlarm.setActive(
        !airEnded &&
          !airCrashed &&
          !tm.flameout &&
          !ejectCam.active() &&
          !ejectAlert.active() &&
          tm.stalled,
      )
      // Engine fire while flaming out — trail from just aft of the spinner.
      if (tm.flameout && smokeEarly) {
        _flameNose.set(0, 0, 1).applyQuaternion(air.root.quaternion)
        _flameEng.copy(air.root.position).addScaledVector(_flameNose, -2.2)
        _flameEng.y += 0.4
        smokeEarly.wreckBurn(_flameEng)
        if (Math.random() < 0.08) smokeEarly.wreckFire(_flameEng)
      }
      // Chase cam keeps real dt so it isn't sluggish, and yields to the bomb
      // cam — it re-acquires by lerping back from wherever the shot ended.
      // Stay on the airframe during flame-out so you watch the dive in.
      if (!ejectCam.active() && !airCrashed) {
        chase.update(realDt, tm)
      }
      ejectCam.update(realDt, camera)

      if (!airEnded) {
        const neighbors = airEnemies.concat(airFriendlies).map((a) => a.root)
        const playerLive = airPlayerCombat.alive && !airCrashed && !tm.flameout
        for (const unit of airEnemies) {
          unit.update(dt, {
            hostiles: playerLive ? [airPlayerHostile, ...airFriendlies] : airFriendlies,
            neighbors,
            playable,
            colliders: mapColliders,
            camera,
            objective: airObjective,
          })
        }
        for (const unit of airFriendlies) {
          unit.update(dt, {
            hostiles: airEnemies,
            neighbors,
            playable,
            colliders: mapColliders,
            camera,
            objective: airObjective,
          })
        }

        if (!airCrashed && !tm.flameout && !ejectCam.active()) {
          guns.update(dt, input.fire, airEnemies, camera)
          if (input.toggleSight) {
            scopeOn = !scopeOn
            console.info(`[Steel] Bombsight ${scopeOn ? 'ON' : 'OFF'}`)
          }
          bombs.update(dt, input.dropBomb, airEnemies, camera)
        }

        if (isKoth) {
          airKoth = tickKoth(
            airKoth,
            dt,
            countAirOnHill('red'),
            countAirOnHill('blue'),
          )
          if (airHillRing) setHillRingColor(airHillRing, airKoth.owner)
          flightHud.setKoth({
            vostokHold: airKoth.vostokHold,
            meridianHold: airKoth.meridianHold,
            owner: airKoth.owner,
            winSec: KOTH_WIN_SEC,
          })
          if (airKoth.winner) {
            const won = airKoth.winner === team
            const winner = nationByTeam(airKoth.winner)
            finishAirMatch(
              won ? 'win' : 'lose',
              won ? 'Victory' : 'Defeat',
              `${winner.name} held Midwood.`,
              airKoth.winner,
            )
          }
        } else if (
          !airCrashed &&
          airEnemies.length > 0 &&
          airEnemies.every((e) => !e.alive)
        ) {
          finishAirMatch('win', 'Air Superiority', 'Every hostile vehicle destroyed.')
        }

        tickAirRespawns(dt)
      }

      updateWrecks(dt, smokeEarly ?? undefined)
      smokeEarly?.update(dt, camera)

      const pred = bombs.prediction()
      _mapNose.set(0, 0, 1).applyQuaternion(air.root.quaternion)
      let mapHeading = THREE.MathUtils.radToDeg(Math.atan2(_mapNose.x, _mapNose.z))
      if (mapHeading < 0) mapHeading += 360

      let mslHud: MissileHudState | null = null
      if (airLock && airLockHud) {
        const lockUi =
          !airEnded &&
          !airCrashed &&
          !ejectCam.active() &&
          !airMatchOpening.active()
        airLockHud.setVisible(lockUi)
        if (lockUi) {
          air.root.getWorldPosition(_lockOrigin)
          // Nose-forward cone (chase cam sits behind — camera look was flaky).
          _lockLook.set(0, 0, 1).applyQuaternion(air.root.quaternion).normalize()
          const lockFrame = airLock.update({
            dt,
            origin: _lockOrigin,
            lookDir: _lockLook,
            camera,
            foes: airEnemies.map((u) => ({
              root: u.root,
              alive: u.alive,
              aircraft: !!u.aircraft,
            })),
            holdLock: isLockHold(),
          })
          airLockHud.apply(lockFrame)
          mslHud = {
            phase: lockFrame.phase,
            ammo: airAam?.ammo(),
          }
          if (airMissile) {
            airMissilePhase = noteMissileLockChange(airMissile, airMissilePhase)
          }
        } else {
          airLock.reset()
          airLockHud.apply({ phase: 'idle', diamond: null, lockedBanner: false })
          mslHud = airAam ? { phase: 'idle', ammo: airAam.ammo() } : { phase: 'idle' }
        }
      }

      // After lock update so soft/hard track is current; hold M like Pantsir.
      if (airAam) {
        airAam.update(
          dt,
          !airCrashed && !airEnded && !ejectCam.active() && (raw.fireMissile || isSamFire()),
        )
      }

      flightHud.update(
        tm,
        { ammo: guns.ammo(), heat: guns.heat(), firing: guns.firing() },
        {
          remaining: bombs.remaining(),
          fallTime: pred.valid ? pred.time : null,
          onTarget: pred.valid && pred.lethal,
          scopeOn,
        },
        {
          hp: airPlayerCombat.hp,
          maxHp: option.maxHp,
          posX: air.root.position.x,
          posZ: air.root.position.z,
          headingDeg: mapHeading,
          foes: airEnemies
            .filter((u) => u.alive)
            .map((u) => ({ x: u.root.position.x, z: u.root.position.z })),
          allies: airFriendlies
            .filter((u) => u.alive)
            .map((u) => ({ x: u.root.position.x, z: u.root.position.z })),
        },
        mslHud,
        { releasing: countermeasures.bannerActive() },
      )

      renderer.render(scene, camera)

      // ——— Bombsight pass ———
      const showScope =
        scopeOn && pred.valid && !tm.crashed && !airCrashed
      if (showScope) {
        // Look from the aircraft down the release solution, so the scope frames
        // exactly where a bomb dropped now would land.
        scopeCam.position.copy(air.root.position)
        scopeLook.copy(pred.point)
        scopeCam.up.set(0, 1, 0)
        scopeCam.lookAt(scopeLook)
        scopeCam.updateProjectionMatrix()

        const r = flightHud.scopeRect()
        // Viewport/scissor take CSS pixels: Three.js multiplies by the pixel
        // ratio itself, so scaling by DPR here would square it on a retina
        // display. The GL origin is bottom-left, the HUD rect is top-left.
        const glY = window.innerHeight - r.y - r.h
        renderer.setScissorTest(true)
        renderer.setViewport(r.x, glY, r.w, r.h)
        renderer.setScissor(r.x, glY, r.w, r.h)
        renderer.render(scene, scopeCam)
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
      }
    }
    flyLoop()
    return
  }

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

  const smoke = smokeEarly ?? (await createSmokeSystem(scene))

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
  const board = createMatchScoreboard()
  let aiSeq = 0
  try {
    if (!playerHandleEarly) {
      throw new Error(`[Steel] Failed to load tank ${tankId} — check network / Pages assets`)
    }
    const playerHandle = playerHandleEarly

    if (allyAiTanks.length > 0 || foeAiTanks.length > 0) {
      try {
        const allySlots = freeSpawnIndices(team, spawnIndex)
        const foeSlots = freeSpawnIndices(opposite, null)
        const jobs: Array<
          Promise<{ unit: AiEnemy; teamSide: TeamId; slot: number; side: 'friendly' | 'enemy' }>
        > = []
        for (let i = 0; i < allyAiTanks.length && i < allySlots.length; i++) {
          const slot = allySlots[i]!
          const pos = spawnAt(team, slot)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const tankForAi = allyAiTanks[i]!
          const chassis = tankOptionById(tankForAi)
          const id = `ai-${++aiSeq}`
          const display = `${nationByTeam(team).short} ${chassis.name}`
          const common = {
            team: 'friendly' as const,
            tankId: tankForAi,
            position: pos,
            yaw,
            smoke,
            heightAt: sampleY,
            persistMesh: isKoth,
            onKill: () => board.noteKillById(id),
            onDeath: () => board.noteDeathById(id),
          }
          jobs.push(
            (isAircraftTankId(tankForAi)
              ? spawnAiCorsair(scene, {
                  ...common,
                  bounds: { x: playable.x - AIR_WALL_INSET, z: playable.z - AIR_WALL_INSET },
                  ceiling: mapGroundY + AIR_CEILING,
                  spawnAlt: AIR_SPAWN_ALT,
                })
              : spawnAiPz3Enemy(scene, common)
            ).then((unit) => {
              board.register({
                id,
                name: display,
                tankId: tankForAi,
                tankName: chassis.name,
                team,
                root: unit.root,
              })
              return { unit, teamSide: team, slot, side: 'friendly' as const }
            }),
          )
        }
        for (let i = 0; i < foeAiTanks.length && i < foeSlots.length; i++) {
          const slot = foeSlots[i]!
          const pos = spawnAt(opposite, slot)
          const yaw = Math.atan2(-pos.x, -pos.z)
          const tankForAi = foeAiTanks[i]!
          const chassis = tankOptionById(tankForAi)
          const id = `ai-${++aiSeq}`
          const display = `${nationByTeam(opposite).short} ${chassis.name}`
          const common = {
            team: 'enemy' as const,
            tankId: tankForAi,
            position: pos,
            yaw,
            smoke,
            heightAt: sampleY,
            persistMesh: isKoth,
            onKill: () => board.noteKillById(id),
            onDeath: () => board.noteDeathById(id),
          }
          jobs.push(
            (isAircraftTankId(tankForAi)
              ? spawnAiCorsair(scene, {
                  ...common,
                  bounds: { x: playable.x - AIR_WALL_INSET, z: playable.z - AIR_WALL_INSET },
                  ceiling: mapGroundY + AIR_CEILING,
                  spawnAlt: AIR_SPAWN_ALT,
                })
              : spawnAiPz3Enemy(scene, common)
            ).then((unit) => {
              board.register({
                id,
                name: display,
                tankId: tankForAi,
                tankName: chassis.name,
                team: opposite,
                root: unit.root,
              })
              return { unit, teamSide: opposite, slot, side: 'enemy' as const }
            }),
          )
        }
        const spawned = await Promise.allSettled(jobs)
        for (const result of spawned) {
          if (result.status !== 'fulfilled') {
            console.warn('[Steel] AI spawn failed', result.reason)
            continue
          }
          const { unit, teamSide, slot, side } = result.value
          if (side === 'friendly') friendlies.push(unit)
          else enemies.push(unit)
          allAi.push(unit)
          aiSlots.push({ unit, teamSide, slot, deadFor: 0 })
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

    /** Remote human tank (MP2 ghosts). */
    let remoteTank: Awaited<ReturnType<typeof loadPlayerTank>> | null = null
    if (mp && remoteHandleEarly) {
      remoteTank = remoteHandleEarly
      const remoteSpawn = spawnAt(opposite, 1)
      const remoteYaw = Math.atan2(-remoteSpawn.x, -remoteSpawn.z)
      remoteTank.root.name = 'mpRemote'
      remoteTank.root.position.copy(remoteSpawn)
      remoteTank.root.rotation.order = 'YXZ'
      remoteTank.root.rotation.y = remoteYaw
      scene.add(remoteTank.root)
      console.info(
        `[Steel] MP remote tank ${mp.remoteTankId} at (${remoteSpawn.x.toFixed(0)}, ${remoteSpawn.z.toFixed(0)})`,
      )
    }

    function poseFromTank(
      id: string,
      root: THREE.Object3D,
      tur: THREE.Object3D,
      bar: THREE.Object3D,
    ): MpTankPose {
      const barrelAng = bar.userData.gunForward === 'x' ? bar.rotation.z : bar.rotation.x
      return {
        id,
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
        yaw: root.rotation.y,
        turret: tur.rotation.y,
        barrel: barrelAng,
      }
    }

    function applyTankPose(
      root: THREE.Object3D,
      tur: THREE.Object3D,
      bar: THREE.Object3D,
      pose: MpTankPose,
    ): void {
      root.position.set(pose.x, pose.y, pose.z)
      root.rotation.order = 'YXZ'
      root.rotation.y = pose.yaw
      tur.rotation.y = pose.turret
      if (bar.userData.gunForward === 'x') bar.rotation.z = pose.barrel
      else bar.rotation.x = pose.barrel
    }

    let mpSnapAcc = 0
    if (mpSess && !mpSess.isHost) {
      mpSess.client.onSnap((tanks) => {
        mpSess.lastSnap = tanks
      })
    }

    const playerCombat = createCombatant(tank, {
      maxHp: option.maxHp,
      armor: option.armor,
      label: 'Player',
      onDestroyed: (r) => {
        board.noteDeath(r)
        console.info('[Steel] Player destroyed')
        spawnDestroyedWreck(scene, r, smoke, isKoth)
      },
    })
    const playerName = getSession()?.username?.trim() || 'Commander'
    board.register({
      id: 'player',
      name: playerName,
      tankId,
      tankName: option.name,
      team,
      isPlayer: true,
      root: tank,
    })
    fire.setOnKill(() => board.noteKill(tank))
    const killInd = createKillIndicator()
    const unsubKill = board.onPlayerKill((n) => killInd.noteKill(n))
    killInd.setKills(0)
    killInd.setVisible(false)
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

    // L1 lock-on: Duster / Shilka (auto-aim in L2).
    const groundLock = option.antiAir ? createLockOn() : null
    const groundLockHud = option.antiAir ? createLockOnHud() : null
    groundLockHud?.setVisible(false)
    const _gLockOrigin = new THREE.Vector3()
    const _gLockLook = new THREE.Vector3()
    const sam =
      option.samMissiles && groundLock
        ? createSamMissiles({
            scene,
            getLaunchOrigin: (out) => {
              muzzle.getWorldPosition(out)
              out.y += 0.6
            },
            getLaunchDir: (out) => {
              getAimDirection(out)
            },
            getLockedTarget: () => groundLock.getLockedTarget(),
            getHostiles: () => enemies,
            getDecoys: () => readPublishedDecoys(),
            heightAt: sampleY,
            onKill: (victim) => {
              board.noteKill(tank)
              console.info(`[Steel] Pantsir SAM destroyed ${victim.name || 'target'}`)
            },
          })
        : null

    const arty: ArtilleryController | null = option.artillery
      ? createArtilleryController({
          arenaSizeX: mapOpt.sizeX,
          arenaSizeZ: mapOpt.sizeZ,
          canvas: renderer.domElement,
        })
      : null

    // ——— Kill cam ———
    // Cued by `fire.ts` for a shell already in flight that its own armour
    // preview says is fatal, so ordinary hits, bounces and misses never
    // interrupt play. Ammo-rack kills are the one gap: `crit` is rolled with
    // Math.random() at resolution time, so it can't be known in advance.
    const killCam = createImpactCinematic({
      heightAt: sampleY,
      profile: KILL_SHOT,
      onShow: (showing) => {
        hud.setVisible(!showing)
        killInd.setVisible(!showing)
        groundLockHud?.setVisible(!showing)
      },
    })
    fire.setOnLethalShot((shot) => {
      if (matchOver || killCam.active()) return
      killCam.begin(shot)
      console.info(`[Steel] Kill cam — impact in ${shot.flightTime.toFixed(2)}s`)
    })

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

    const dieselEngine = createDieselEngine()

    stopProgress()
    loading.remove()

    hud.setVisible(false)
    const matchOpening = createMatchOpening({
      units: [
        { root: tank, team, aircraft: false },
        ...friendlies.map((u) => ({
          root: u.root,
          team,
          aircraft: !!u.aircraft,
        })),
        ...enemies.map((u) => ({
          root: u.root,
          team: opposite,
          aircraft: !!u.aircraft,
        })),
      ],
      spawns: { red: mapSpawns.red, blue: mapSpawns.blue },
      heightAt: sampleY,
      mapHalfZ: mapOpt.sizeZ / 2,
      playerRoot: tank,
      onDone: () => {
        hud.setVisible(true)
        killInd.setVisible(true)
        groundLockHud?.setVisible(true)
        lockPointer(renderer.domElement)
        dieselEngine.start()
        dieselEngine.setIntensity(0.2)
        updatePlayerCamera(cameraMode, camera, tank, turretMount, 1, aiming, muzzle)
      },
    })

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
        if (u.aircraft) continue
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
      dieselEngine.setIntensity(0.2)
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

    type MatchEndSpec = {
      kind: 'win' | 'lose'
      team?: TeamId
      title?: string
      sub?: string
    }

    function finishMatch(end: MatchEndSpec): void {
      matchOver = true
      matchOpening.dispose()
      nvg.dispose()
      dieselEngine.stop()
      document.exitPointerLock()
      hud.setVisible(false)
      killInd.setVisible(false)
      unsubKill()
      killInd.dispose()
      groundLock?.reset()
      groundLockHud?.setVisible(false)
      groundLockHud?.dispose()
      sam?.dispose()
      const rows = board.ranked()
      const reward = end.kind === 'win' ? grantMatchWin('tank-victory') : null
      showMatchEnd({ ...end, leaderboard: rows, podium3d: true, reward })
      void startVictoryStage(rows, end.kind === 'win', end.team)
    }

    /**
     * The shot that ends the match is exactly the shot the kill cam is playing,
     * so hold the end screen until the cinematic lets go — otherwise the podium
     * lands on top of the kill it was built to celebrate.
     */
    let deferredEnd: MatchEndSpec | null = null
    function requestMatchEnd(end: MatchEndSpec): void {
      if (matchOver) return
      matchOver = true
      if (killCam.active()) {
        deferredEnd = end
        return
      }
      finishMatch(end)
    }

    function checkMatchEnd(): void {
      if (matchOver) return
      if (isKoth) {
        if (!koth.winner) return
        const won = koth.winner === team
        const winner = nationByTeam(koth.winner)
        requestMatchEnd({
          kind: won ? 'win' : 'lose',
          team: koth.winner,
          title: won ? 'Victory' : 'Defeat',
          sub: `${winner.name} held Midwood.`,
        })
        return
      }
      if (!playerCombat.alive) {
        requestMatchEnd({ kind: 'lose', team })
        return
      }
      if (enemies.length > 0 && enemies.every((e) => !e.alive)) {
        requestMatchEnd({ kind: 'win', team })
      }
    }

    function updateTank(dt: number): AimFrame {
      const alive = playerCombat.alive && !matchOver
      const { forward, turn, brake, fire: wantsFire } = getDriveInput()
      if (consumeNvgToggle()) nvg.toggle()

      const mpGuest = !!(mp && mpSess && !mpSess.isHost)
      if (mpGuest && mpSess.lastSnap) {
        for (const pose of mpSess.lastSnap) {
          if (mp && pose.id === mp.myUserId) {
            applyTankPose(tank, turret, barrel, pose)
          } else if (remoteTank && mp && pose.id === mp.remoteUserId) {
            applyTankPose(remoteTank.root, remoteTank.turret, remoteTank.barrel, pose)
          }
        }
      }

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

      if (alive && !mpGuest) {
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

      // L2: SPAAG hard-lock drives aim (before turret catch-up).
      if (groundLock && groundLockHud && alive && !matchOver && !killCam.active()) {
        muzzle.getWorldPosition(_gLockOrigin)
        getAimDirection(_gLockLook)
        const lockFrame = groundLock.update({
          dt,
          origin: _gLockOrigin,
          lookDir: _gLockLook,
          camera,
          foes: enemies.map((u) => ({
            root: u.root,
            alive: u.alive,
            aircraft: !!u.aircraft,
          })),
          holdLock: isLockHold(),
        })
        groundLockHud.setVisible(true)
        groundLockHud.apply(lockFrame)
        const lockedRoot = groundLock.getLockedTarget()
        if (lockFrame.phase === 'hard' && lockedRoot) {
          const foe = enemies.find((e) => e.root === lockedRoot)
          aimAaAtLockedTarget({
            hull: tank,
            muzzle,
            target: lockedRoot,
            dt,
            aircraft: !!foe?.aircraft,
          })
        } else {
          clearAaAimTracking(lockedRoot)
        }
      } else if (groundLock && groundLockHud) {
        groundLock.reset()
        clearAaAimTracking()
        groundLockHud.setVisible(false)
        groundLockHud.apply({ phase: 'idle', diamond: null, lockedBanner: false })
      }

      const aim: AimFrame = mpGuest
        ? {
            fireYaw: tank.rotation.y + turret.rotation.y,
            firePitch: barrel.userData.gunForward === 'x' ? barrel.rotation.z : barrel.rotation.x,
            mouseHit: tank.position.clone(),
            barrelHit: tank.position.clone(),
            gunSynced: true,
            rangeM: null,
          }
        : updateTurretAim(dt, camera, tank, turret, barrel, muzzle, dummies)

      const useMg = fire.getWeapon() === 'mg'
      const activeMuzzle = useMg ? mgMuzzle : muzzle
      const canFire = (!arty || arty.isDeployed()) && !mpGuest
      const fired = fire.update(
        dt,
        alive && wantsFire && canFire,
        activeMuzzle,
        dummies,
        camera,
        mapColliders,
      )
      if (sam) {
        sam.update(dt, alive && !matchOver && isSamFire())
      }
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
        const maxSp = Math.max(1, option.drive.maxSpeed)
        dieselEngine.setIntensity(0.18 + Math.min(1, speed / maxSp) * 0.82)
      } else {
        dieselEngine.setIntensity(0)
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

      if (mp && mpSess?.isHost && remoteTank) {
        mpSnapAcc += dt
        if (mpSnapAcc >= 0.05) {
          mpSnapAcc = 0
          mpSess.client.send({
            t: 'snap',
            tanks: [
              poseFromTank(mp.myUserId, tank, turret, barrel),
              poseFromTank(mp.remoteUserId, remoteTank.root, remoteTank.turret, remoteTank.barrel),
            ],
          })
        }
      }

      return aim
    }

    function animate(now = performance.now()): void {
      requestAnimationFrame(animate)
      timer.update(now)
      const realDt = Math.min(timer.getDelta(), 0.05)
      if (podiumStage) {
        podiumStage.update(realDt)
        renderer.render(podiumStage.scene, podiumStage.camera)
        return
      }
      if (matchOpening.active()) {
        matchOpening.update(realDt, camera)
        renderer.render(scene, camera)
        return
      }
      // C skips the kill cam rather than toggling camera mode — consuming the
      // key here keeps it away from updateTank for this frame.
      if (killCam.active() && consumeCameraToggle()) killCam.cancel()
      const dt = killCam.active()
        ? Math.min(realDt * killCam.timeScale(), MAX_SIM_DT)
        : realDt

      const aim = updateTank(dt)
      // Camera smoothing stays on real time so it never feels sluggish, and
      // yields to the kill cam, which it then lerps back from.
      if (!killCam.active()) {
        updatePlayerCamera(cameraMode, camera, tank, turretMount, realDt, aiming, muzzle)
      }
      killCam.update(realDt, camera)
      if (deferredEnd && !killCam.active()) {
        const end = deferredEnd
        deferredEnd = null
        finishMatch(end)
      }
      hud.updateCrosshairs(camera, aim.mouseHit, aim.barrelHit, aim.gunSynced)
      hud.updateCombat({
        hp: playerCombat.hp,
        maxHp: option.maxHp,
        fire: fire.getHudState(),
        tracksDisableLeft: playerCombat.getTracksDisableLeft(),
        envStatus: env.getDriveMods().status,
        artilleryStatus: sam
          ? `SAM ${sam.ammo()} · P lock · M fire`
          : arty?.getHud().status,
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
    stopProgress()
    console.error('[Steel] Mission failed to start', err)
    loadingMsg.textContent = 'Could not load models. Check the network, then retry.'
    if (!loading.querySelector('.loading-retry')) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'loading-retry'
      btn.textContent = 'Reload'
      btn.addEventListener('click', () => window.location.reload())
      loading.appendChild(btn)
    }
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
