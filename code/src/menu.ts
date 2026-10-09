import * as THREE from 'three'
import { mapOptionById, type MapId } from './maps/mapCatalog'
import { TANK_OPTIONS, tankOptionById, type TankId } from './tankCatalog'
import { FOREST_PROP_URLS, FOREST_TOWNS } from './maps/forestOverwatch'
import { createFrontlineState, FRONTLINE_ATTACKER, frontlineSpawnAnchor } from './frontline'
import { preloadUrls, warmLoaders } from './loadGltf'
import type { Season, TimeOfDay, WeatherKind } from './environment'
import {
  getTankCosmetics,
  setTankCosmetics,
  type TankCosmetics,
} from './cosmetics'
import { createCustomizePreview } from './customizePreview'
import {
  LOADOUT_OPTIONS,
  getAircraftLoadout,
  loadoutOptionById,
  resolveAircraftStores,
  resolveStores,
  setAircraftLoadout,
  type LoadoutId,
} from './aircraftLoadouts'
import {
  WRAP_OPTIONS,
  setSelectedWrapId,
  syncWrapFromProfile,
  wrapOptionById,
  type WrapId,
} from './wraps'
import {
  getCurrentUser,
  getPreferredAuthMode,
  getSession,
  getSteelApiBase,
  initAuth,
  login,
  logout,
  register,
  setPreferredAuthMode,
  updateProfile,
  type AuthMode,
  type AuthUser,
} from './auth'
import { getWallet } from './wallet'
import { createMpClient, createMpRoom, normalizeRoomCode, type MpLobbyState } from './net/mpClient'
import { setMpSession } from './net/mpSession'
import { MIN_MP_START } from './net/mpProtocol'
import {
  NATIONS,
  nationByTeam,
  nationFlagSrc,
  type TeamId,
} from './nations'

export type { TeamId }

export type GameModeId = 'skirmish' | 'koth' | 'frontline'

export function gameModeLabel(mode: GameModeId): string {
  if (mode === 'koth') return 'King of the Hill'
  if (mode === 'frontline') return 'Push the Frontline'
  return 'Skirmish'
}

export type MenuSelection = {
  mapId: MapId
  tankId: TankId
  team: TeamId
  /** Index 0–2 on the chosen team’s spawn list. */
  spawnIndex: number
  /** AI tank ids for red team slots (length = count, max 3). */
  redAi: TankId[]
  /** AI tank ids for blue team slots (length = count, max 3). */
  blueAi: TankId[]
  timeOfDay: TimeOfDay
  season: Season
  weather: WeatherKind
  gameMode: GameModeId
  /**
   * Mid-match KOTH chassis remount — skip parade and restore hill clocks.
   */
  remount?: boolean
  kothHold?: { vostokHold: number; meridianHold: number }
  frontlineHold?: { taken: number; captureT: number; recaptureT: number; matchT: number }
  /** Interactive training range (empty AI, coach overlay). */
  tutorial?: 'land-basics' | 'air-basics' | 'systems-basics'
  /** Present when launching from Multiplayer lobby. */
  mp?: {
    isHost: boolean
    myUserId: string
    /** Everyone else in the match (host + other guests from each client's view). */
    peers: Array<{
      userId: string
      tankId: TankId
      team: TeamId
      spawnIndex: number
    }>
  }
}

type MatchDraft = {
  mapId: MapId
  redAi: TankId[]
  blueAi: TankId[]
  timeOfDay: TimeOfDay
  season: Season
  weather: WeatherKind
  gameMode: GameModeId
}

const AI_SLOT_MAX = 3
const DEFAULT_AI_TANK: TankId = 'tiger'
const SVG_SIZE = 320

function spawnTownPins(
  toSvg: (x: number, z: number) => { cx: number; cy: number },
  svgW: number,
  svgH: number,
): string {
  return FOREST_TOWNS.map((t) => {
    const { cx, cy } = toSvg(t.x, t.z)
    return `<div class="spawn-town" style="left:${(cx / svgW) * 100}%;top:${(cy / svgH) * 100}%" title="${t.name}">${t.name}</div>`
  }).join('')
}

function spawnModeOverlay(
  gameMode: GameModeId,
  toSvg: (x: number, z: number) => { cx: number; cy: number },
  svgW: number,
  svgH: number,
): string {
  if (gameMode === 'koth') {
    return `<div class="spawn-hill" style="left:50%;top:50%" title="King of the Hill"></div>`
  }
  if (gameMode === 'frontline') return spawnTownPins(toSvg, svgW, svgH)
  return ''
}

function warmupMatchAssets(tankIds: readonly TankId[] = []): void {
  warmLoaders()
  const tankUrls = [...new Set([DEFAULT_AI_TANK, ...tankIds])]
    .map((id) => tankOptionById(id).url)
  void preloadUrls([...FOREST_PROP_URLS, ...tankUrls])
}

function aiTankOptionsHtml(selected: TankId): string {
  return TANK_OPTIONS.map(
    (t) =>
      `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${t.name}${t.aircraft ? ' (air)' : ''}</option>`,
  ).join('')
}

function ensureRoot(): HTMLDivElement {
  let root = document.getElementById('main-menu') as HTMLDivElement | null
  if (!root) {
    root = document.createElement('div')
    root.id = 'main-menu'
    document.body.appendChild(root)
  }
  return root
}

function clearRoot(root: HTMLElement): void {
  root.innerHTML = ''
  root.className = ''
}

/** Full menu flow → mission selection. Requires a signed-in session. */
export function showMainMenu(): Promise<MenuSelection> {
  return new Promise((resolve) => {
    initAuth()
    const root = ensureRoot()
    void (async () => {
      warmupMatchAssets()
      const user = await getCurrentUser()
      if (user) showHome(root, resolve, user)
      else showAuth(root, resolve)
    })()
  })
}

function showAuth(root: HTMLDivElement, resolve: (s: MenuSelection) => void): void {
  clearRoot(root)
  root.classList.add('menu-screen-auth')

  let mode: AuthMode = getPreferredAuthMode()
  let tab: 'login' | 'register' = 'login'

  function render(error = '', busy = false, keepUser = '', keepPass = ''): void {
    const api = getSteelApiBase()
    const modeNote =
      mode === 'online'
        ? api
          ? `Online — ${api}`
          : 'Online needs VITE_STEEL_API (see doc/cloudflare-auth.md). Deploy Worker, then restart Vite.'
        : 'Offline — account stays on this device.'

    root.innerHTML = `
      <div class="menu-panel menu-panel-auth">
        <p class="menu-brand">Steel</p>
        <p class="menu-tagline">Sign in to command</p>
        <div class="auth-mode" role="group" aria-label="Auth mode">
          <button type="button" class="auth-mode-btn${mode === 'offline' ? ' is-on' : ''}" data-mode="offline">Offline</button>
          <button type="button" class="auth-mode-btn${mode === 'online' ? ' is-on' : ''}" data-mode="online">Online</button>
        </div>
        <p class="auth-mode-note">${modeNote}</p>
        <div class="auth-tabs">
          <button type="button" class="auth-tab${tab === 'login' ? ' is-on' : ''}" data-tab="login">Log in</button>
          <button type="button" class="auth-tab${tab === 'register' ? ' is-on' : ''}" data-tab="register">Create account</button>
        </div>
        <form class="auth-form" autocomplete="on">
          <label class="auth-label">Username
            <input class="auth-input" name="username" type="text" maxlength="24" required autocomplete="username" value="${keepUser.replace(/"/g, '&quot;')}" ${busy ? 'disabled' : ''} />
          </label>
          <label class="auth-label">Password
            <input class="auth-input" name="password" type="password" minlength="6" required autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" value="${keepPass.replace(/"/g, '&quot;')}" ${busy ? 'disabled' : ''} />
          </label>
          <p class="auth-error" data-error>${error}</p>
          <button type="submit" class="home-btn home-btn-play auth-submit" ${busy ? 'disabled' : ''}>
            ${busy ? 'Please wait…' : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    `

    root.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = (btn as HTMLButtonElement).dataset.mode as AuthMode
        setPreferredAuthMode(mode)
        render()
      })
    })
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = (btn as HTMLButtonElement).dataset.tab as 'login' | 'register'
        render()
      })
    })

    const form = root.querySelector('.auth-form') as HTMLFormElement
    form.addEventListener('submit', (ev) => {
      ev.preventDefault()
      if (busy) return
      const fd = new FormData(form)
      const username = String(fd.get('username') ?? '')
      const password = String(fd.get('password') ?? '')
      void (async () => {
        render('', true, username, password)
        const result = tab === 'login' ? await login(username, password) : await register(username, password)
        if (!result.ok) {
          // Keep username; clear password on hard auth failure messages
          render(result.error, false, username, '')
          return
        }
        showHome(root, resolve, result.user)
      })()
    })
  }

  render()
}

function showHome(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
  user: AuthUser,
): void {
  syncWrapFromProfile(user.profile.wrapId)
  warmupMatchAssets()
  clearRoot(root)
  root.classList.add('menu-screen-home', 'menu-wt')
  const mode = getSession()?.mode ?? 'offline'
  const wallet = getWallet()
  const apiBase = getSteelApiBase()
  const onlineOk = mode === 'online' && !!apiBase
  const mpBlockReason = !apiBase
    ? 'Multiplayer needs the Online API (VITE_STEEL_API).'
    : mode !== 'online'
      ? 'Log out, choose Online, then sign in to use Multiplayer.'
      : ''
  root.innerHTML = `
    <div class="menu-panel menu-panel-home">
      <p class="menu-brand">Steel</p>
      <p class="menu-tagline">Armor · grit · dust</p>
      <p class="auth-userline">Signed in as <strong>${escapeHtml(user.username)}</strong> · ${mode}</p>
      <p class="home-wallet" aria-label="Currency">
        <span class="wallet-chip wallet-silver"><i></i><b>${wallet.silver}</b> Silver</span>
        <span class="wallet-chip wallet-gold"><i></i><b>${wallet.gold}</b> Gold</span>
      </p>
      <div class="home-actions">
        <button type="button" class="home-btn home-btn-play" data-go="play">Start Match</button>
        <button type="button" class="home-btn" data-go="tutorial">Tutorials</button>
        <button type="button" class="home-btn${onlineOk ? '' : ' is-disabled'}" data-go="mp" title="${onlineOk ? 'Create or join a room' : escapeHtml(mpBlockReason)}">Multiplayer</button>
        <button type="button" class="home-btn" data-go="customize">Customize</button>
        <button type="button" class="home-btn" data-go="hangar">Hangar</button>
        <button type="button" class="home-btn" data-go="settings">Settings</button>
        <button type="button" class="home-btn" data-go="credits">Credits</button>
        <button type="button" class="home-btn home-btn-logout" data-go="logout">Log out</button>
      </div>
      ${onlineOk ? '' : `<p class="auth-mode-note" data-mp-hint>${escapeHtml(mpBlockReason)}</p>`}
    </div>
  `
  root.querySelector('[data-go="play"]')!.addEventListener('click', () => {
    showVoteMap(root, resolve)
  })
  root.querySelector('[data-go="tutorial"]')!.addEventListener('click', () => {
    showTutorials(root, resolve)
  })
  const mpBtn = root.querySelector('[data-go="mp"]') as HTMLButtonElement | null
  mpBtn?.addEventListener('click', () => {
    if (!onlineOk) {
      const hint = root.querySelector('[data-mp-hint]') as HTMLElement | null
      if (hint) {
        hint.textContent = mpBlockReason
        hint.style.color = '#c4a35a'
      }
      console.warn('[Steel] Multiplayer blocked:', mpBlockReason, { mode, apiBase })
      return
    }
    showMpLobby(root, resolve, user)
  })
  root.querySelector('[data-go="customize"]')!.addEventListener('click', () => {
    showCustomize(root, resolve)
  })
  root.querySelector('[data-go="hangar"]')!.addEventListener('click', () => {
    showPlaneHangar(root, resolve)
  })
  root.querySelector('[data-go="settings"]')!.addEventListener('click', () => {
    showPlaceholder(root, resolve, 'Settings', 'Audio, graphics, and controls — coming soon.')
  })
  root.querySelector('[data-go="credits"]')!.addEventListener('click', () => {
    showPlaceholder(
      root,
      resolve,
      'Credits',
      'Steel — a small tank skirmish. Models from community / Sketchfab packs. Built with Three.js.',
    )
  })
  root.querySelector('[data-go="logout"]')!.addEventListener('click', () => {
    void (async () => {
      await logout()
      showAuth(root, resolve)
    })()
  })
}

/** Ground tanks only for MP v1. */
function mpTankOptionsHtml(selected: TankId): string {
  return TANK_OPTIONS.filter((t) => !t.aircraft)
    .map(
      (t) =>
        `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${t.name}</option>`,
    )
    .join('')
}

/** MP1/MP2 — create/join room, pick tank, host Start → mission. */
function showMpLobby(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
  user: AuthUser,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-mp')

  const client = createMpClient()
  let joinCode = ''
  let busy = false
  let myTank: TankId = 'tiger'
  let started = false

  const unsubStart = client.onStart((match) => {
    if (started) return
    started = true
    const me = match.players.find((p) => p.id === (getSession()?.userId ?? user.id))
    if (!me || match.players.length < MIN_MP_START) {
      console.error('[Steel] MP start missing players', match)
      return
    }
    const tankId = (me.tankId as TankId) || 'tiger'
    const peers = match.players
      .filter((p) => p.id !== me.id)
      .map((p) => ({
        userId: p.id,
        tankId: (p.tankId as TankId) || 'tiger',
        team: p.team as TeamId,
        spawnIndex: p.spawnIndex,
      }))
    setMpSession({
      client,
      isHost: !!me.host,
      myUserId: me.id,
      matchPlayers: match.players,
      lastSnap: null,
    })
    unsub()
    unsubStart()
    document.getElementById('main-menu')?.remove()
    console.info(
      `[Steel] MP deploy ${me.host ? 'host' : 'guest'} ${tankId} team=${me.team} peers=${peers.length}`,
    )
    resolve({
      mapId: 'forest',
      tankId,
      team: me.team,
      spawnIndex: me.spawnIndex,
      redAi: [],
      blueAi: [],
      timeOfDay: (match.timeOfDay as TimeOfDay) || 'day',
      season: (match.season as Season) || 'summer',
      weather: (match.weather as WeatherKind) || 'clear',
      gameMode: 'skirmish',
      mp: {
        isHost: !!me.host,
        myUserId: me.id,
        peers,
      },
    })
  })

  function playersHtml(state: MpLobbyState): string {
    if (state.players.length === 0) {
      return '<li class="mp-empty">No one in the room yet.</li>'
    }
    return state.players
      .map((p) => {
        const you = state.you?.id === p.id ? ' (you)' : ''
        const host = p.host ? ' · host' : ''
        let tankLabel = ''
        if (p.tankId) {
          try {
            tankLabel = ` · ${escapeHtml(tankOptionById(p.tankId as TankId).name)}`
          } catch {
            tankLabel = ` · ${escapeHtml(p.tankId)}`
          }
        }
        return `<li><strong>${escapeHtml(p.username)}</strong>${you}${host}${tankLabel}</li>`
      })
      .join('')
  }

  function statusLine(state: MpLobbyState): string {
    if (state.status === 'connecting') return 'Connecting…'
    if (state.status === 'starting') return 'Starting match…'
    if (state.status === 'open') {
      const n = state.players.length
      let wait: string
      if (n < MIN_MP_START) {
        wait = 'Waiting for players…'
      } else if (state.you?.host) {
        wait =
          n < state.max
            ? `Ready — Start anytime (or wait, up to ${state.max}).`
            : 'Room full — press Start when ready.'
      } else {
        wait = 'Waiting for host to Start…'
      }
      return `Room <strong>${escapeHtml(state.code)}</strong> · ${n}/${state.max} — ${wait}`
    }
    if (state.status === 'error') return escapeHtml(state.error || 'Error')
    if (state.status === 'closed') return state.error ? escapeHtml(state.error) : 'Disconnected.'
    return 'Create a room or enter a code to join.'
  }

  function paint(state: MpLobbyState): void {
    const inRoom = state.status === 'open' || state.status === 'connecting' || state.status === 'starting'
    const canStart =
      state.status === 'open' && !!state.you?.host && state.players.length >= MIN_MP_START
    root.innerHTML = `
      <div class="menu-panel menu-panel-mp">
        <p class="menu-brand">Steel</p>
        <p class="menu-tagline">Multiplayer lobby</p>
        <p class="auth-userline">Signed in as <strong>${escapeHtml(user.username)}</strong></p>
        <p class="mp-status" data-status>${statusLine(state)}</p>
        <p class="auth-error" data-err>${state.error && state.status !== 'closed' ? escapeHtml(state.error) : ''}</p>
        <ul class="mp-players" data-players>${playersHtml(state)}</ul>
        <div class="mp-actions" ${inRoom ? 'hidden' : ''}>
          <button type="button" class="home-btn home-btn-play" data-act="create" ${busy ? 'disabled' : ''}>Create room</button>
          <div class="mp-join-row">
            <input class="auth-input mp-code-input" data-code type="text" maxlength="6" placeholder="Room code" value="${escapeHtml(joinCode)}" ${busy ? 'disabled' : ''} autocomplete="off" spellcheck="false" />
            <button type="button" class="home-btn" data-act="join" ${busy ? 'disabled' : ''}>Join</button>
          </div>
        </div>
        <div class="mp-actions" ${inRoom && state.status !== 'starting' ? '' : 'hidden'}>
          <label class="auth-label">Your tank
            <select class="auth-input mp-tank-select" data-tank>${mpTankOptionsHtml(myTank)}</select>
          </label>
          ${canStart ? '<button type="button" class="home-btn home-btn-play" data-act="start">Start match</button>' : ''}
          <button type="button" class="home-btn" data-act="leave">Leave room</button>
        </div>
        <button type="button" class="home-btn home-btn-back" data-act="back">Back</button>
      </div>
    `

    root.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      client.disconnect()
      unsub()
      unsubStart()
      showHome(root, resolve, user)
    })
    root.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      client.disconnect()
    })
    root.querySelector('[data-act="create"]')?.addEventListener('click', () => {
      void (async () => {
        if (busy) return
        busy = true
        paint(client.getState())
        const res = await createMpRoom()
        busy = false
        if (!res.ok) {
          paint({ ...client.getState(), status: 'error', error: res.error })
          return
        }
        joinCode = res.code
        client.connect(res.code)
      })()
    })
    root.querySelector('[data-act="join"]')?.addEventListener('click', () => {
      const input = root.querySelector('[data-code]') as HTMLInputElement | null
      joinCode = normalizeRoomCode(input?.value ?? '')
      client.connect(joinCode)
    })
    root.querySelector('[data-code]')?.addEventListener('input', (ev) => {
      joinCode = (ev.target as HTMLInputElement).value
    })
    root.querySelector('[data-tank]')?.addEventListener('change', (ev) => {
      myTank = (ev.target as HTMLSelectElement).value as TankId
      client.send({ t: 'tank', tankId: myTank })
    })
    root.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      client.send({ t: 'tank', tankId: myTank })
      client.send({ t: 'start' })
    })
  }

  let tankAnnounced = false
  const unsub = client.subscribe((state) => {
    if (state.status === 'open' && !tankAnnounced) {
      tankAnnounced = true
      client.send({ t: 'tank', tankId: myTank })
    }
    if (state.status === 'idle' || state.status === 'closed') tankAnnounced = false
    paint(state)
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function goHome(root: HTMLDivElement, resolve: (s: MenuSelection) => void): void {
  void (async () => {
    const user = await getCurrentUser()
    if (user) showHome(root, resolve, user)
    else showAuth(root, resolve)
  })()
}

function showPlaceholder(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
  title: string,
  body: string,
): void {
  clearRoot(root)
  root.innerHTML = `
    <div class="menu-panel">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">${title}</h1>
      <p class="menu-sub">${body}</p>
      <button type="button" class="deploy-btn menu-back">Back</button>
    </div>
  `
  root.querySelector('.menu-back')!.addEventListener('click', () => goHome(root, resolve))
}

function showTutorials(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-tutorial', 'menu-wt')
  const ground = TANK_OPTIONS.filter((t) => !t.aircraft)
  const air = TANK_OPTIONS.filter((t) => !!t.aircraft && !t.jet)
  const systems = TANK_OPTIONS.filter((t) => !!t.samMissiles && !t.aircraft)
  let mode: 'land-basics' | 'air-basics' | 'systems-basics' = 'land-basics'
  let tankId: TankId = ground.find((t) => t.id === 'sherman')?.id ?? ground[0]?.id ?? 'pz3'

  function chassisList(): typeof ground {
    if (mode === 'air-basics') return air
    if (mode === 'systems-basics') return systems
    return ground
  }

  function chassisOptions(): string {
    const list = chassisList()
    if (!list.some((t) => t.id === tankId)) {
      tankId =
        mode === 'air-basics'
          ? (list.find((t) => t.id === 'corsair')?.id ?? list[0]?.id ?? 'corsair')
          : mode === 'systems-basics'
            ? (list.find((t) => t.id === 'bradley')?.id ?? list[0]?.id ?? 'bradley')
            : (list.find((t) => t.id === 'sherman')?.id ?? list[0]?.id ?? 'pz3')
    }
    return list
      .map((t) => `<option value="${t.id}" ${t.id === tankId ? 'selected' : ''}>${t.name}</option>`)
      .join('')
  }

  function paint(): void {
    root.innerHTML = `
      <div class="menu-panel menu-panel-wide">
        <p class="menu-kicker">Training</p>
        <h1 class="menu-title">Tutorials</h1>
        <p class="menu-sub">Interactive lessons — not a wall of text. Complete tasks in the range.</p>
        <div class="tutor-menu-list">
          <button type="button" class="tutor-menu-card is-available${mode === 'land-basics' ? ' is-selected' : ''}" data-tut="land">
            <span class="tutor-menu-num">01</span>
            <span class="tutor-menu-name">Basics — Land</span>
            <span class="tutor-menu-blurb">Drive · cameras · test fire · paint</span>
          </button>
          <button type="button" class="tutor-menu-card is-available${mode === 'air-basics' ? ' is-selected' : ''}" data-tut="air">
            <span class="tutor-menu-num">02</span>
            <span class="tutor-menu-name">Basics — Air</span>
            <span class="tutor-menu-blurb">Fly · guns · bombs · eject</span>
          </button>
          <button type="button" class="tutor-menu-card is-available${mode === 'systems-basics' ? ' is-selected' : ''}" data-tut="systems">
            <span class="tutor-menu-num">03</span>
            <span class="tutor-menu-name">Advanced — Systems</span>
            <span class="tutor-menu-blurb">NVG · lock-on · ATGM</span>
          </button>
        </div>
        <label class="auth-label tutor-tank-label">Training chassis
          <select class="auth-input" data-tank>${chassisOptions()}</select>
        </label>
        <div class="menu-nav-row">
          <button type="button" class="home-btn home-btn-back" data-back>Back</button>
          <button type="button" class="deploy-btn" data-start>Enter range</button>
        </div>
      </div>
    `
    const tankSelect = root.querySelector('[data-tank]') as HTMLSelectElement
    tankSelect.addEventListener('change', () => {
      tankId = tankSelect.value as TankId
    })
    root.querySelector('[data-tut="land"]')!.addEventListener('click', () => {
      mode = 'land-basics'
      paint()
    })
    root.querySelector('[data-tut="air"]')!.addEventListener('click', () => {
      mode = 'air-basics'
      paint()
    })
    root.querySelector('[data-tut="systems"]')!.addEventListener('click', () => {
      mode = 'systems-basics'
      paint()
    })
    root.querySelector('[data-back]')!.addEventListener('click', () => goHome(root, resolve))
    root.querySelector('[data-start]')!.addEventListener('click', () => {
      console.info(`[Steel] Tutorial launch · ${mode} · ${tankId}`)
      root.remove()
      resolve({
        mapId: 'forest',
        tankId,
        team: 'blue',
        spawnIndex: 0,
        redAi: [],
        blueAi: [],
        // Systems lesson needs night for NVG.
        timeOfDay: mode === 'systems-basics' ? 'night' : 'day',
        season: 'summer',
        weather: 'clear',
        gameMode: 'skirmish',
        tutorial: mode,
      })
    })
  }

  paint()
}

function showCustomize(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-customize')

  const groundTanks = TANK_OPTIONS.filter((t) => !t.aircraft)
  let tankId: TankId = groundTanks[0]?.id ?? 'pz3'
  let draft: TankCosmetics = getTankCosmetics(tankId)
  /** Preview rotation in degrees (−180…180). */
  let rotDeg = { x: 0, y: 36, z: 0 }
  let preview: ReturnType<typeof createCustomizePreview> | null = null
  let previewReady: Promise<void> = Promise.resolve()

  function degToRad(d: number): number {
    return (d * Math.PI) / 180
  }

  function syncRotation(): void {
    preview?.setRotation(degToRad(rotDeg.x), degToRad(rotDeg.y), degToRad(rotDeg.z))
  }

  function queueShow(): void {
    const id = tankId
    const cos = { wrapId: draft.wrapId }
    previewReady = previewReady.then(async () => {
      await preview?.show(id, cos)
      syncRotation()
    })
  }

  function queueApplyDraft(): void {
    const cos = { wrapId: draft.wrapId }
    previewReady = previewReady.then(
      () => preview?.applyDraft(cos, { reloadChassis: true }) ?? Promise.resolve(),
    )
  }

  function tankChipsHtml(): string {
    return groundTanks
      .map((t) => {
        const active = t.id === tankId ? ' is-selected' : ''
        return `<button type="button" class="customize-tank-chip${active}" data-tank="${t.id}">${t.name}</button>`
      })
      .join('')
  }

  function wrapCardsHtml(): string {
    return WRAP_OPTIONS.map((w) => {
      const thumb = w.url
        ? `<img src="${w.url}" alt="" loading="lazy" />`
        : `<span class="wrap-thumb-stock">Stock</span>`
      const active = w.id === draft.wrapId ? ' is-selected' : ''
      return `
        <button type="button" class="wrap-card${active}" data-wrap="${w.id}">
          <span class="wrap-thumb">${thumb}</span>
          <span class="wrap-card-name">${w.name}</span>
        </button>`
    }).join('')
  }

  function axisSlidersHtml(): string {
    return `
      <label class="customize-slider">
        <span>X</span>
        <input type="range" min="-180" max="180" value="${rotDeg.x}" data-axis="x" />
        <span class="customize-axis-val" data-axis-val="x">${rotDeg.x}°</span>
      </label>
      <label class="customize-slider">
        <span>Y</span>
        <input type="range" min="-180" max="180" value="${rotDeg.y}" data-axis="y" />
        <span class="customize-axis-val" data-axis-val="y">${rotDeg.y}°</span>
      </label>
      <label class="customize-slider">
        <span>Z</span>
        <input type="range" min="-180" max="180" value="${rotDeg.z}" data-axis="z" />
        <span class="customize-axis-val" data-axis-val="z">${rotDeg.z}°</span>
      </label>`
  }

  function metaHtml(): string {
    const t = tankOptionById(tankId)
    return `<p class="wrap-preview-name">${t.name}</p>
      <p class="wrap-preview-blurb">${wrapOptionById(draft.wrapId).name} · drag to orbit · XYZ to rotate</p>`
  }

  function refreshChrome(): void {
    const tankRow = root.querySelector('[data-tank-row]')
    const wrapGrid = root.querySelector('[data-wrap-grid]')
    const axisRow = root.querySelector('[data-axis-sliders]')
    const meta = root.querySelector('[data-preview-meta]')
    if (tankRow) tankRow.innerHTML = tankChipsHtml()
    if (wrapGrid) wrapGrid.innerHTML = wrapCardsHtml()
    if (axisRow) axisRow.innerHTML = axisSlidersHtml()
    if (meta) meta.innerHTML = metaHtml()
    bindSelectors()
    bindAxisSliders()
  }

  function bindAxisSliders(): void {
    root.querySelectorAll('[data-axis]').forEach((el) => {
      el.addEventListener('input', () => {
        const axis = (el as HTMLInputElement).dataset.axis as 'x' | 'y' | 'z'
        const v = Number((el as HTMLInputElement).value)
        rotDeg = { ...rotDeg, [axis]: v }
        const label = root.querySelector(`[data-axis-val="${axis}"]`)
        if (label) label.textContent = `${v}°`
        syncRotation()
      })
    })
  }

  function bindSelectors(): void {
    root.querySelectorAll('[data-tank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLButtonElement).dataset.tank as TankId
        if (id === tankId) return
        tankId = id
        draft = getTankCosmetics(tankId)
        rotDeg = { x: 0, y: 36, z: 0 }
        refreshChrome()
        queueShow()
      })
    })
    root.querySelectorAll('[data-wrap]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrapId = (btn as HTMLButtonElement).dataset.wrap as WrapId
        if (wrapId === draft.wrapId) return
        draft = { wrapId }
        refreshChrome()
        queueApplyDraft()
      })
    })
  }

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide customize-panel">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Customize</h1>
      <p class="menu-sub">Pick a tank · orbit · rotate with XYZ · wrap · Apply (this tank only).</p>

      <p class="menu-section">Tank</p>
      <div class="customize-tank-row" data-tank-row>${tankChipsHtml()}</div>

      <div class="customize-stage">
        <div class="customize-viewport" data-viewport>
          <p class="customize-loading" data-loading-label>Loading model…</p>
        </div>
        <div class="customize-stage-meta" data-preview-meta>${metaHtml()}</div>
      </div>

      <p class="menu-section">Rotation</p>
      <div class="customize-axis-sliders" data-axis-sliders>${axisSlidersHtml()}</div>

      <p class="menu-section">Wrap</p>
      <div class="wrap-grid" data-wrap-grid>${wrapCardsHtml()}</div>

      <div class="wrap-actions">
        <button type="button" class="deploy-btn wrap-apply" data-apply>Apply</button>
        <button type="button" class="deploy-btn menu-back">Back</button>
      </div>
      <p class="wrap-status" data-status></p>
    </div>
  `

  bindSelectors()
  bindAxisSliders()
  root.querySelector('[data-apply]')!.addEventListener('click', () => {
    void (async () => {
      setTankCosmetics(tankId, draft)
      setSelectedWrapId(draft.wrapId)
      const user = await updateProfile({ wrapId: draft.wrapId })
      const status = root.querySelector('[data-status]') as HTMLParagraphElement
      const tankName = tankOptionById(tankId).name
      const wrapName = wrapOptionById(draft.wrapId).name
      status.textContent = user
        ? `Saved ${tankName}: ${wrapName} (account + Deploy).`
        : `Saved ${tankName}: ${wrapName} (local).`
      console.info('[Steel] Customize applied', tankId, draft)
    })()
  })
  root.querySelector('.menu-back')!.addEventListener('click', () => {
    preview?.dispose()
    preview = null
    goHome(root, resolve)
  })

  const viewport = root.querySelector('[data-viewport]') as HTMLElement
  preview = createCustomizePreview(viewport)
  queueShow()
}

/**
 * Aircraft hangar — pick a plane, orbit it, assign a weapons loadout.
 * Mirrors Customize (tanks / wraps) so later mission briefs can read saved stores.
 */
function showPlaneHangar(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-customize', 'menu-screen-plane-hangar')

  const planes = TANK_OPTIONS.filter((t) => t.aircraft)
  let planeId: TankId = planes[0]?.id ?? 'corsair'
  let draft = getAircraftLoadout(planeId)
  let rotDeg = { x: 0, y: 36, z: 0 }
  let preview: ReturnType<typeof createCustomizePreview> | null = null
  let previewReady: Promise<void> = Promise.resolve()

  function degToRad(d: number): number {
    return (d * Math.PI) / 180
  }

  function syncRotation(): void {
    preview?.setRotation(degToRad(rotDeg.x), degToRad(rotDeg.y), degToRad(rotDeg.z))
  }

  function queueShow(): void {
    const id = planeId
    previewReady = previewReady.then(async () => {
      await preview?.show(id, { wrapId: 'stock' })
      syncRotation()
    })
  }

  function planeChipsHtml(): string {
    return planes
      .map((t) => {
        const active = t.id === planeId ? ' is-selected' : ''
        return `<button type="button" class="customize-tank-chip${active}" data-plane="${t.id}">${t.name}</button>`
      })
      .join('')
  }

  function loadoutCardsHtml(): string {
    return LOADOUT_OPTIONS.map((w) => {
      const active = w.id === draft.loadoutId ? ' is-selected' : ''
      return `
        <button type="button" class="wrap-card loadout-card${active}" data-loadout="${w.id}">
          <span class="wrap-thumb"><span class="wrap-thumb-stock">${w.name}</span></span>
          <span class="wrap-card-name">${w.blurb}</span>
        </button>`
    }).join('')
  }

  function axisSlidersHtml(): string {
    return `
      <label class="customize-slider">
        <span>X</span>
        <input type="range" min="-180" max="180" value="${rotDeg.x}" data-axis="x" />
        <span class="customize-axis-val" data-axis-val="x">${rotDeg.x}°</span>
      </label>
      <label class="customize-slider">
        <span>Y</span>
        <input type="range" min="-180" max="180" value="${rotDeg.y}" data-axis="y" />
        <span class="customize-axis-val" data-axis-val="y">${rotDeg.y}°</span>
      </label>
      <label class="customize-slider">
        <span>Z</span>
        <input type="range" min="-180" max="180" value="${rotDeg.z}" data-axis="z" />
        <span class="customize-axis-val" data-axis-val="z">${rotDeg.z}°</span>
      </label>`
  }

  function storesLine(loadoutId: LoadoutId): string {
    const stores = resolveStores(planeId, loadoutId)
    const bits: string[] = ['guns']
    if (stores.bombCount > 0) bits.push(`bombs ×${stores.bombCount}`)
    if (stores.rockets) bits.push('rockets')
    return bits.join(' · ')
  }

  function metaHtml(): string {
    const t = tankOptionById(planeId)
    return `<p class="wrap-preview-name">${t.name}</p>
      <p class="wrap-preview-blurb">${loadoutOptionById(draft.loadoutId).name} · ${storesLine(draft.loadoutId)} · drag to orbit</p>`
  }

  function refreshChrome(): void {
    const planeRow = root.querySelector('[data-plane-row]')
    const loadoutGrid = root.querySelector('[data-loadout-grid]')
    const axisRow = root.querySelector('[data-axis-sliders]')
    const meta = root.querySelector('[data-preview-meta]')
    if (planeRow) planeRow.innerHTML = planeChipsHtml()
    if (loadoutGrid) loadoutGrid.innerHTML = loadoutCardsHtml()
    if (axisRow) axisRow.innerHTML = axisSlidersHtml()
    if (meta) meta.innerHTML = metaHtml()
    bindSelectors()
    bindAxisSliders()
  }

  function bindAxisSliders(): void {
    root.querySelectorAll('[data-axis]').forEach((el) => {
      el.addEventListener('input', () => {
        const axis = (el as HTMLInputElement).dataset.axis as 'x' | 'y' | 'z'
        const v = Number((el as HTMLInputElement).value)
        rotDeg = { ...rotDeg, [axis]: v }
        const label = root.querySelector(`[data-axis-val="${axis}"]`)
        if (label) label.textContent = `${v}°`
        syncRotation()
      })
    })
  }

  function bindSelectors(): void {
    root.querySelectorAll('[data-plane]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLButtonElement).dataset.plane as TankId
        if (id === planeId) return
        planeId = id
        draft = getAircraftLoadout(planeId)
        rotDeg = { x: 0, y: 36, z: 0 }
        refreshChrome()
        queueShow()
      })
    })
    root.querySelectorAll('[data-loadout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const loadoutId = (btn as HTMLButtonElement).dataset.loadout as LoadoutId
        if (loadoutId === draft.loadoutId) return
        draft = { loadoutId }
        refreshChrome()
      })
    })
  }

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide customize-panel">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Hangar</h1>
      <p class="menu-sub">Pick a plane · orbit · assign a loadout · Apply (this airframe only).</p>

      <p class="menu-section">Aircraft</p>
      <div class="customize-tank-row" data-plane-row>${planeChipsHtml()}</div>

      <div class="customize-stage">
        <div class="customize-viewport" data-viewport>
          <p class="customize-loading" data-loading-label>Loading airframe…</p>
        </div>
        <div class="customize-stage-meta" data-preview-meta>${metaHtml()}</div>
      </div>

      <p class="menu-section">Rotation</p>
      <div class="customize-axis-sliders" data-axis-sliders>${axisSlidersHtml()}</div>

      <p class="menu-section">Loadout</p>
      <div class="wrap-grid" data-loadout-grid>${loadoutCardsHtml()}</div>

      <div class="wrap-actions">
        <button type="button" class="deploy-btn wrap-apply" data-apply>Apply</button>
        <button type="button" class="deploy-btn menu-back">Back</button>
      </div>
      <p class="wrap-status" data-status></p>
    </div>
  `

  bindSelectors()
  bindAxisSliders()
  root.querySelector('[data-apply]')!.addEventListener('click', () => {
    setAircraftLoadout(planeId, draft)
    const status = root.querySelector('[data-status]') as HTMLParagraphElement
    const planeName = tankOptionById(planeId).name
    const loadName = loadoutOptionById(draft.loadoutId).name
    const stores = resolveAircraftStores(planeId)
    status.textContent = `Saved ${planeName}: ${loadName} (${storesLine(draft.loadoutId)}).`
    refreshChrome()
    console.info('[Steel] Hangar applied', planeId, stores)
  })
  root.querySelector('.menu-back')!.addEventListener('click', () => {
    preview?.dispose()
    preview = null
    goHome(root, resolve)
  })

  const viewport = root.querySelector('[data-viewport]') as HTMLElement
  preview = createCustomizePreview(viewport)
  queueShow()
}

const LOADING_TIPS = [
  "Don't forget to take cover — you'll need it :3",
  'An angled plate beats a flat one. Side shots hurt.',
  'Range first, then fire. Panic shells miss.',
  'Hull-down on a ridge: expose the turret, hide the ammo.',
  'MG suppresses. Cannon finishes.',
  'Smoke is free armor — use it when reloading.',
  'In KOTH, the hill wins wars. Parks tanks on it.',
  'Aircraft: speed is life. Low and slow is a gift to SPAAG.',
  'Tracks broken? Sit still and pray the next shell is soft.',
  'Friendly fire is still fire. Check your markers.',
] as const

export function pickLoadingTip(): string {
  return LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]!
}

function showVoteMap(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-vote', 'menu-wt')

  let mapId: MapId = 'forest'

  root.innerHTML = `
    <div class="menu-panel menu-panel-vote">
      <p class="menu-kicker">Briefing · 1 / 4</p>
      <h1 class="menu-title">Vote — Map</h1>
      <p class="menu-sub">Select the theatre of operations.</p>
      <div class="vote-grid" data-vote="map">
        <button type="button" class="vote-card is-selected" data-val="forest">
          <span class="vote-card-art" aria-hidden="true"></span>
          <span class="vote-card-name">Forest Overwatch</span>
          <span class="vote-card-blurb">${mapOptionById('forest').blurb}</span>
        </button>
      </div>
      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-next>Confirm map</button>
      </div>
    </div>
  `

  const grid = root.querySelector('[data-vote="map"]')!
  grid.querySelectorAll('.vote-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.vote-card').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      mapId = ((btn as HTMLElement).dataset.val as MapId) || 'forest'
    })
  })
  root.querySelector('.menu-back')!.addEventListener('click', () => goHome(root, resolve))
  root.querySelector('[data-next]')!.addEventListener('click', () => {
    showVoteMode(root, resolve, mapId)
  })
}

function showVoteMode(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
  mapId: MapId,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-vote', 'menu-wt')

  const redAi: TankId[] = [DEFAULT_AI_TANK]
  const blueAi: TankId[] = [DEFAULT_AI_TANK]
  let timeOfDay: TimeOfDay = 'day'
  let season: Season = 'summer'
  let weather: WeatherKind = 'clear'
  let gameMode: GameModeId = 'koth'

  root.innerHTML = `
    <div class="menu-panel menu-panel-vote">
      <p class="menu-kicker">Briefing · 2 / 4</p>
      <h1 class="menu-title">Vote — Mission</h1>
      <p class="menu-sub">${mapOptionById(mapId).name} · choose rules of engagement.</p>

      <div class="vote-grid" data-vote="mode">
        <button type="button" class="vote-card is-selected" data-val="koth">
          <span class="vote-card-name">King of the Hill</span>
          <span class="vote-card-blurb">Hold Midwood 90s. Respawn. Change vehicles after death.</span>
        </button>
        <button type="button" class="vote-card" data-val="frontline">
          <span class="vote-card-name">Push the Frontline</span>
          <span class="vote-card-blurb">Attackers take towns in order. Defenders spawn on the road ahead. Recapture steals the attacker spawn.</span>
        </button>
        <button type="button" class="vote-card" data-val="skirmish">
          <span class="vote-card-name">Skirmish</span>
          <span class="vote-card-blurb">Wipe the enemy force. One life.</span>
        </button>
      </div>

      <p class="menu-section">Conditions</p>
      <div class="env-row" data-env="time">
        <button type="button" class="env-chip is-selected" data-val="day">Day</button>
        <button type="button" class="env-chip" data-val="night">Night</button>
      </div>
      <div class="env-row" data-env="season">
        <button type="button" class="env-chip is-selected" data-val="summer">Summer</button>
        <button type="button" class="env-chip" data-val="winter">Winter</button>
      </div>
      <div class="env-row" data-env="weather">
        <button type="button" class="env-chip is-selected" data-val="clear">Clear</button>
        <button type="button" class="env-chip" data-val="rain">Rain</button>
        <button type="button" class="env-chip" data-val="fog">Fog</button>
      </div>

      <p class="menu-section">Opposing forces (AI)</p>
      <div class="match-panel" data-team-ai="red"></div>
      <div class="match-panel" data-team-ai="blue"></div>

      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-next>Confirm mission</button>
      </div>
    </div>
  `

  const modeGrid = root.querySelector('[data-vote="mode"]')!
  modeGrid.querySelectorAll('.vote-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      modeGrid.querySelectorAll('.vote-card').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      const v = (btn as HTMLElement).dataset.val
      gameMode = v === 'skirmish' || v === 'frontline' || v === 'koth' ? v : 'koth'
    })
  })

  function wireEnvRow(key: 'time' | 'season' | 'weather', apply: (v: string) => void): void {
    const row = root.querySelector(`[data-env="${key}"]`)!
    row.querySelectorAll('.env-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.env-chip').forEach((el) => el.classList.remove('is-selected'))
        btn.classList.add('is-selected')
        apply((btn as HTMLElement).dataset.val ?? '')
      })
    })
  }
  wireEnvRow('time', (v) => {
    timeOfDay = v as TimeOfDay
  })
  wireEnvRow('season', (v) => {
    season = v as Season
  })
  wireEnvRow('weather', (v) => {
    weather = v as WeatherKind
  })

  function renderTeamAi(team: 'red' | 'blue'): void {
    const box = root.querySelector(`[data-team-ai="${team}"]`)!
    const list = team === 'red' ? redAi : blueAi
    box.innerHTML = `
      <div class="match-row">
        <span class="match-label">${nationByTeam(team).short} AI</span>
        <div class="match-stepper">
          <button type="button" class="match-step" data-team="${team}" data-dir="-1">−</button>
          <span class="match-value" data-count="${team}">${list.length}</span>
          <button type="button" class="match-step" data-team="${team}" data-dir="1">+</button>
        </div>
      </div>
      <div class="ai-slot-list" data-slots="${team}"></div>
    `
    const slots = box.querySelector(`[data-slots="${team}"]`)!
    list.forEach((tid, i) => {
      const row = document.createElement('div')
      row.className = 'ai-slot-row'
      row.innerHTML = `
        <span class="ai-slot-label">Slot ${i + 1}</span>
        <select class="ai-tank-select" data-team="${team}" data-slot="${i}">
          ${aiTankOptionsHtml(tid)}
        </select>
      `
      slots.appendChild(row)
    })
    box.querySelectorAll('.match-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = Number((btn as HTMLElement).dataset.dir)
        const arr = team === 'red' ? redAi : blueAi
        if (dir > 0 && arr.length < AI_SLOT_MAX) arr.push(DEFAULT_AI_TANK)
        if (dir < 0 && arr.length > 0) arr.pop()
        renderTeamAi(team)
      })
    })
    box.querySelectorAll('.ai-tank-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const el = sel as HTMLSelectElement
        const slot = Number(el.dataset.slot)
        const tid = el.value as TankId
        const arr = team === 'red' ? redAi : blueAi
        if (slot >= 0 && slot < arr.length) arr[slot] = tid
      })
    })
  }
  renderTeamAi('red')
  renderTeamAi('blue')

  root.querySelector('.menu-back')!.addEventListener('click', () => showVoteMap(root, resolve))
  root.querySelector('[data-next]')!.addEventListener('click', () => {
    const draft: MatchDraft = {
      mapId,
      redAi: [...redAi],
      blueAi: [...blueAi],
      timeOfDay,
      season,
      weather,
      gameMode,
    }
    warmupMatchAssets([...draft.redAi, ...draft.blueAi])
    showHangar(root, draft, resolve)
  })
}

function tankStatsLine(tank: (typeof TANK_OPTIONS)[number]): string {
  if (tank.aircraft) {
    const stores = resolveAircraftStores(tank.id)
    const bits: string[] = ['guns']
    if (stores.bombCount > 0) bits.push(`bombs ×${stores.bombCount}`)
    if (stores.rockets) bits.push('rockets')
    return `Air · ${bits.join(' + ')}`
  }
  return `Pen ${tank.gun.aphePen} · Armor ${tank.armor.hullFront.armor} · HP ${tank.maxHp}`
}

/**
 * Vehicle hangar — preview left, selection right, Deploy bottom.
 */
function showHangar(
  root: HTMLDivElement,
  draft: MatchDraft,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-hangar', 'menu-wt')
  warmupMatchAssets([...draft.redAi, ...draft.blueAi])

  const map = mapOptionById(draft.mapId)
  const pool = TANK_OPTIONS
  let tankId: TankId = pool[0]?.id ?? 'pz3'
  let preview: ReturnType<typeof createCustomizePreview> | null = null

  root.innerHTML = `
    <div class="hangar-shell">
      <header class="hangar-header">
        <p class="menu-kicker">Briefing · 3 / 4</p>
        <h1 class="menu-title">Select vehicle</h1>
        <p class="menu-sub">${map.name} · ${gameModeLabel(draft.gameMode)} — preview left, roster right.</p>
      </header>
      <div class="hangar-body">
        <div class="hangar-preview" data-viewport>
          <p class="customize-loading">Loading chassis…</p>
        </div>
        <aside class="hangar-roster" aria-label="Vehicles">
          <div class="hangar-list" role="listbox"></div>
        </aside>
      </div>
      <footer class="hangar-footer">
        <button type="button" class="home-btn menu-back">Back</button>
        <div class="hangar-selected" data-selected></div>
        <button type="button" class="deploy-btn" data-deploy>Deploy</button>
      </footer>
    </div>
  `

  const list = root.querySelector('.hangar-list')!
  const selectedEl = root.querySelector('[data-selected]') as HTMLElement
  const viewport = root.querySelector('[data-viewport]') as HTMLElement

  function refreshSelected(): void {
    const t = tankOptionById(tankId)
    selectedEl.innerHTML = `<strong>${t.name}</strong><span>${t.role}</span>`
  }

  async function showPreview(id: TankId): Promise<void> {
    viewport.dataset.loading = '1'
    try {
      if (!preview) preview = createCustomizePreview(viewport)
      await preview.show(id, getTankCosmetics(id))
    } finally {
      viewport.dataset.loading = '0'
    }
  }

  for (const tank of pool) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hangar-card'
    btn.dataset.id = tank.id
    btn.setAttribute('role', 'option')
    btn.innerHTML = `
      <span class="hangar-card-name">${tank.name}</span>
      <span class="hangar-card-role">${tank.role}</span>
      <span class="hangar-card-stats">${tankStatsLine(tank)}</span>
    `
    btn.addEventListener('click', () => {
      tankId = tank.id
      list.querySelectorAll('.hangar-card').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      refreshSelected()
      warmupMatchAssets([tankId, ...draft.redAi, ...draft.blueAi])
      void showPreview(tankId)
    })
    list.appendChild(btn)
  }
  ;(list.querySelector('.hangar-card') as HTMLButtonElement | null)?.click()

  root.querySelector('.menu-back')!.addEventListener('click', () => {
    preview?.dispose()
    preview = null
    showVoteMode(root, resolve, draft.mapId)
  })

  root.querySelector('[data-deploy]')!.addEventListener('click', () => {
    preview?.dispose()
    preview = null
    showSpawnSelect(root, draft, resolve, { tankId })
  })
}

function showSpawnSelect(
  root: HTMLDivElement,
  draft: MatchDraft,
  resolve: (s: MenuSelection) => void,
  pre?: { tankId: TankId; lockedTeam?: TeamId },
): void {
  clearRoot(root)
  root.classList.add('menu-screen-spawn', 'menu-wt')
  warmupMatchAssets([...(pre ? [pre.tankId] : []), ...draft.redAi, ...draft.blueAi])

  const map = mapOptionById(draft.mapId)
  let team: TeamId | null = pre?.lockedTeam ?? null
  let spawnIndex: number | null = null
  const tankId: TankId = pre?.tankId ?? TANK_OPTIONS[0]?.id ?? 'pz3'
  const tank = tankOptionById(tankId)

  const markers = [
    ...map.spawns.red.map((p, i) => ({ team: 'red' as const, index: i, pos: p })),
    ...map.spawns.blue.map((p, i) => ({ team: 'blue' as const, index: i, pos: p })),
  ].filter((m) => (pre?.lockedTeam ? m.team === pre.lockedTeam : true))

  const mapW = map.sizeX
  const mapH = map.sizeZ
  const aspect = mapW / mapH
  const svgH = SVG_SIZE
  const svgW = Math.max(120, Math.round(svgH * aspect))

  function toSvg(x: number, z: number): { cx: number; cy: number } {
    return {
      cx: ((x + mapW / 2) / mapW) * svgW,
      cy: ((mapH / 2 - z) / mapH) * svgH,
    }
  }

  const flPreview = draft.gameMode === 'frontline' ? createFrontlineState() : null
  const dots = markers
    .map((m) => {
      const pos = flPreview
        ? frontlineSpawnAnchor(flPreview, m.team, m.index, map.spawns)
        : { x: m.pos.x, z: m.pos.z }
      const { cx, cy } = toSvg(pos.x, pos.z)
      const role =
        draft.gameMode === 'frontline'
          ? m.team === FRONTLINE_ATTACKER
            ? 'Attackers'
            : 'Defenders'
          : nationByTeam(m.team).short
      return `<button type="button" class="spawn-dot spawn-${m.team}" data-team="${m.team}" data-index="${m.index}" style="left:${(cx / svgW) * 100}%;top:${(cy / svgH) * 100}%" aria-label="${role} spawn ${m.index + 1}"></button>`
    })
    .join('')

  const roleLegend =
    draft.gameMode === 'frontline'
      ? `<div class="spawn-legend spawn-legend-nations">
          <span class="spawn-legend-nation spawn-picked is-red">Attackers · Vostok</span>
          <span class="spawn-legend-nation spawn-picked is-blue">Defenders · Meridian</span>
        </div>`
      : `<div class="spawn-legend spawn-legend-nations">
          ${NATIONS.map(
            (n) =>
              `<span class="spawn-legend-nation"><img src="${nationFlagSrc(n)}" alt="" width="28" height="20" />${n.short}</span>`,
          ).join('')}
        </div>`

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide menu-panel-spawn">
      <p class="menu-kicker">Briefing · 4 / 4</p>
      <h1 class="menu-title">Choose deploy point</h1>
      <p class="menu-sub">${map.name} · ${tank.name} · ${gameModeLabel(draft.gameMode)} — click a spawn, then enter the field.</p>

      <div class="spawn-map-wrap">
        <div class="spawn-map" style="width:${svgW}px;height:${svgH}px">
          <div class="spawn-map-grid"></div>
          ${spawnModeOverlay(draft.gameMode, toSvg, svgW, svgH)}
          ${dots}
        </div>
        ${roleLegend}
      </div>

      <p class="spawn-picked" data-picked>No spawn selected</p>

      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-deploy disabled>Enter battle</button>
      </div>
    </div>
  `

  const picked = root.querySelector('[data-picked]') as HTMLElement
  const deploy = root.querySelector('[data-deploy]') as HTMLButtonElement

  function refreshDeploy(): void {
    deploy.disabled = !(team !== null && spawnIndex !== null)
  }

  root.querySelectorAll('.spawn-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.spawn-dot').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      team = (btn as HTMLElement).dataset.team as TeamId
      spawnIndex = Number((btn as HTMLElement).dataset.index)
      picked.textContent =
        draft.gameMode === 'frontline'
          ? `${team === FRONTLINE_ATTACKER ? 'Attackers' : 'Defenders'} · ${nationByTeam(team).name} · slot ${spawnIndex + 1}`
          : `${nationByTeam(team).name} · spawn ${spawnIndex + 1}`
      picked.classList.toggle('is-red', team === 'red')
      picked.classList.toggle('is-blue', team === 'blue')
      refreshDeploy()
    })
  })

  root.querySelector('.menu-back')!.addEventListener('click', () => {
    showHangar(root, draft, resolve)
  })

  deploy.addEventListener('click', () => {
    if (team === null || spawnIndex === null) return
    root.remove()
    resolve({
      mapId: draft.mapId,
      tankId,
      team,
      spawnIndex,
      redAi: draft.redAi,
      blueAi: draft.blueAi,
      timeOfDay: draft.timeOfDay,
      season: draft.season,
      weather: draft.weather,
      gameMode: draft.gameMode,
    })
  })
}

export type RespawnPick = {
  tankId: TankId
  spawnIndex: number
}

/**
 * Mid-match KOTH hangar — pick a new chassis (or the same), then a spawn on your team.
 */
export function showRespawnHangar(opts: {
  mapId: MapId
  gameMode: GameModeId
  team: TeamId
  /** Preselect this chassis (defaults to first in list if missing). */
  currentTankId?: TankId
  groundOnly?: boolean
  redAi?: TankId[]
  blueAi?: TankId[]
  timeOfDay?: TimeOfDay
  season?: Season
  weather?: WeatherKind
  frontlineHold?: { taken: number; captureT: number; recaptureT: number; matchT: number }
}): Promise<RespawnPick> {
  return new Promise((resolve) => {
    const root = ensureRoot()
    const draft: MatchDraft = {
      mapId: opts.mapId,
      redAi: opts.redAi ?? [DEFAULT_AI_TANK],
      blueAi: opts.blueAi ?? [DEFAULT_AI_TANK],
      timeOfDay: opts.timeOfDay ?? 'day',
      season: opts.season ?? 'summer',
      weather: opts.weather ?? 'clear',
      gameMode: opts.gameMode,
    }

    // Overlay hangar that resolves only tank+spawn (team locked).
    clearRoot(root)
    root.classList.add('menu-screen-hangar', 'menu-wt', 'menu-respawn')
    const map = mapOptionById(draft.mapId)
    const vehicles =
      opts.groundOnly === true
        ? TANK_OPTIONS.filter((t) => !t.aircraft)
        : opts.groundOnly === false
          ? TANK_OPTIONS.filter((t) => !!t.aircraft)
          : [...TANK_OPTIONS]
    const preferred =
      opts.currentTankId && vehicles.some((t) => t.id === opts.currentTankId)
        ? opts.currentTankId
        : (vehicles[0]?.id ?? 'pz3')
    let tankId: TankId = preferred
    let preview: ReturnType<typeof createCustomizePreview> | null = null

    root.innerHTML = `
      <div class="hangar-shell hangar-shell-respawn">
        <header class="hangar-header">
          <p class="menu-kicker">Respawn</p>
          <h1 class="menu-title">Change vehicle</h1>
          <p class="menu-sub">${map.name} · ${nationByTeam(opts.team).short}${opts.gameMode === 'frontline' ? ` · ${opts.team === FRONTLINE_ATTACKER ? 'Attackers' : 'Defenders'}` : ''} — pick a chassis, then a spawn.</p>
        </header>
        <div class="hangar-body">
          <div class="hangar-preview" data-viewport>
            <p class="customize-loading">Loading chassis…</p>
          </div>
          <aside class="hangar-roster">
            <div class="hangar-list" role="listbox"></div>
          </aside>
        </div>
        <footer class="hangar-footer">
          <div class="hangar-selected" data-selected></div>
          <button type="button" class="deploy-btn" data-to-spawn>Choose spawn</button>
        </footer>
      </div>
    `

    const list = root.querySelector('.hangar-list')!
    const selectedEl = root.querySelector('[data-selected]') as HTMLElement
    const viewport = root.querySelector('[data-viewport]') as HTMLElement

    function refreshSelected(): void {
      const t = tankOptionById(tankId)
      selectedEl.innerHTML = `<strong>${t.name}</strong><span>${t.role}</span>`
    }

    async function showPreview(id: TankId): Promise<void> {
      viewport.dataset.loading = '1'
      try {
        if (!preview) preview = createCustomizePreview(viewport)
        await preview.show(id, getTankCosmetics(id))
      } finally {
        viewport.dataset.loading = '0'
      }
    }

    let preferredBtn: HTMLButtonElement | null = null
    for (const t of vehicles) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'hangar-card'
      btn.dataset.tankId = t.id
      btn.innerHTML = `
        <span class="hangar-card-name">${t.name}</span>
        <span class="hangar-card-role">${t.role}</span>
        <span class="hangar-card-stats">${tankStatsLine(t)}</span>
      `
      btn.addEventListener('click', () => {
        tankId = t.id
        list.querySelectorAll('.hangar-card').forEach((el) => el.classList.remove('is-selected'))
        btn.classList.add('is-selected')
        refreshSelected()
        void showPreview(tankId)
      })
      list.appendChild(btn)
      if (t.id === preferred) preferredBtn = btn
    }
    ;(preferredBtn ?? (list.querySelector('.hangar-card') as HTMLButtonElement | null))?.click()

    root.querySelector('[data-to-spawn]')!.addEventListener('click', () => {
      preview?.dispose()
      preview = null
      showRespawnSpawn(root, draft, opts.team, tankId, (pick) => {
        root.remove()
        resolve(pick)
      }, opts.frontlineHold)
    })
  })
}

function showRespawnSpawn(
  root: HTMLDivElement,
  draft: MatchDraft,
  team: TeamId,
  tankId: TankId,
  done: (p: RespawnPick) => void,
  frontlineHold?: { taken: number; captureT: number; recaptureT: number; matchT: number },
): void {
  clearRoot(root)
  root.classList.add('menu-screen-spawn', 'menu-wt', 'menu-respawn')
  const map = mapOptionById(draft.mapId)
  let spawnIndex: number | null = null
  const tank = tankOptionById(tankId)
  const mapW = map.sizeX
  const mapH = map.sizeZ
  const aspect = mapW / mapH
  const svgH = SVG_SIZE
  const svgW = Math.max(120, Math.round(svgH * aspect))
  function toSvg(x: number, z: number): { cx: number; cy: number } {
    return {
      cx: ((x + mapW / 2) / mapW) * svgW,
      cy: ((mapH / 2 - z) / mapH) * svgH,
    }
  }
  const flPreview =
    draft.gameMode === 'frontline'
      ? { ...createFrontlineState(), ...(frontlineHold ?? {}) }
      : null
  const dots = map.spawns[team]
    .map((p, i) => {
      const pos = flPreview
        ? frontlineSpawnAnchor(flPreview, team, i, map.spawns)
        : { x: p.x, z: p.z }
      const { cx, cy } = toSvg(pos.x, pos.z)
      return `<button type="button" class="spawn-dot spawn-${team}" data-index="${i}" style="left:${(cx / svgW) * 100}%;top:${(cy / svgH) * 100}%" aria-label="Spawn ${i + 1}"></button>`
    })
    .join('')

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide menu-panel-spawn">
      <p class="menu-kicker">Respawn</p>
      <h1 class="menu-title">Deploy ${tank.name}</h1>
      <p class="menu-sub">Select a ${nationByTeam(team).short}${draft.gameMode === 'frontline' ? (team === FRONTLINE_ATTACKER ? ' attacker' : ' defender') : ''} spawn point.</p>
      <div class="spawn-map-wrap">
        <div class="spawn-map" style="width:${svgW}px;height:${svgH}px">
          <div class="spawn-map-grid"></div>
          ${spawnModeOverlay(draft.gameMode, toSvg, svgW, svgH)}
          ${dots}
        </div>
      </div>
      <p class="spawn-picked" data-picked>No spawn selected</p>
      <div class="menu-nav-row">
        <button type="button" class="deploy-btn" data-deploy disabled>Enter battle</button>
      </div>
    </div>
  `
  const picked = root.querySelector('[data-picked]') as HTMLElement
  const deploy = root.querySelector('[data-deploy]') as HTMLButtonElement
  root.querySelectorAll('.spawn-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.spawn-dot').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      spawnIndex = Number((btn as HTMLElement).dataset.index)
      picked.textContent = `Spawn ${spawnIndex + 1}`
      deploy.disabled = false
    })
  })
  deploy.addEventListener('click', () => {
    if (spawnIndex === null) return
    done({ tankId, spawnIndex })
  })
}

/** World position for a team spawn on a map. */
export function getTeamSpawn(
  mapId: MapId,
  team: TeamId,
  index: number,
): THREE.Vector3 {
  const map = mapOptionById(mapId)
  const list = map.spawns[team]
  const p = list[Math.max(0, Math.min(index, list.length - 1))]
  return p.clone()
}
