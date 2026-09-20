import * as THREE from 'three'
import { mapOptionById, type MapId } from './maps/mapCatalog'
import { TANK_OPTIONS, tankOptionById, type TankId } from './tankCatalog'
import { FOREST_PROP_URLS } from './maps/forestOverwatch'
import { preloadUrls, warmLoaders } from './loadGltf'
import type { Season, TimeOfDay, WeatherKind } from './environment'
import {
  WRAP_OPTIONS,
  getSelectedWrapId,
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
import {
  NATIONS,
  nationByTeam,
  nationFlagSrc,
  type TeamId,
} from './nations'

export type { TeamId }

export type GameModeId = 'skirmish' | 'koth'

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
  /** Present when launching from Multiplayer lobby. */
  mp?: {
    isHost: boolean
    remoteTankId: TankId
    remoteUserId: string
    myUserId: string
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
  root.classList.add('menu-screen-home')
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
        <button type="button" class="home-btn home-btn-play" data-go="play">Play</button>
        <button type="button" class="home-btn${onlineOk ? '' : ' is-disabled'}" data-go="mp" title="${onlineOk ? 'Create or join a room' : escapeHtml(mpBlockReason)}">Multiplayer</button>
        <button type="button" class="home-btn" data-go="customize">Customize</button>
        <button type="button" class="home-btn" data-go="settings">Settings</button>
        <button type="button" class="home-btn" data-go="credits">Credits</button>
        <button type="button" class="home-btn home-btn-logout" data-go="logout">Log out</button>
      </div>
      ${onlineOk ? '' : `<p class="auth-mode-note" data-mp-hint>${escapeHtml(mpBlockReason)}</p>`}
    </div>
  `
  root.querySelector('[data-go="play"]')!.addEventListener('click', () => {
    showMatchSetup(root, resolve)
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
    const other = match.players.find((p) => p.id !== me?.id)
    if (!me || !other) {
      console.error('[Steel] MP start missing players', match)
      return
    }
    const tankId = (me.tankId as TankId) || 'tiger'
    const remoteTankId = (other.tankId as TankId) || 'tiger'
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
      `[Steel] MP deploy ${me.host ? 'host' : 'guest'} ${tankId} vs ${remoteTankId} team=${me.team}`,
    )
    resolve({
      mapId: (match.mapId as MapId) || 'forest',
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
        remoteTankId,
        remoteUserId: other.id,
        myUserId: me.id,
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
      const wait =
        n < state.max
          ? 'Waiting for opponent…'
          : state.you?.host
            ? 'Both here — press Start when ready.'
            : 'Waiting for host to Start…'
      return `Room <strong>${escapeHtml(state.code)}</strong> · ${n}/${state.max} — ${wait}`
    }
    if (state.status === 'error') return escapeHtml(state.error || 'Error')
    if (state.status === 'closed') return state.error ? escapeHtml(state.error) : 'Disconnected.'
    return 'Create a room or enter a code to join.'
  }

  function paint(state: MpLobbyState): void {
    const inRoom = state.status === 'open' || state.status === 'connecting' || state.status === 'starting'
    const canStart =
      state.status === 'open' && !!state.you?.host && state.players.length >= state.max
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

function showCustomize(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-customize')

  let selected: WrapId = getSelectedWrapId()

  function render(): void {
    const opt = wrapOptionById(selected)
    const applied = getSelectedWrapId()
    const previewHtml = opt.url
      ? `<img class="wrap-preview-img" src="${opt.url}" alt="${opt.name}" />`
      : `<div class="wrap-preview-stock">Factory dunkelgrau</div>`

    const cards = WRAP_OPTIONS.map((w) => {
      const thumb = w.url
        ? `<img src="${w.url}" alt="" loading="lazy" />`
        : `<span class="wrap-thumb-stock">Stock</span>`
      const active = w.id === selected ? ' is-selected' : ''
      const isApplied = w.id === applied ? ' is-applied' : ''
      return `
        <button type="button" class="wrap-card${active}${isApplied}" data-wrap="${w.id}">
          <span class="wrap-thumb">${thumb}</span>
          <span class="wrap-card-name">${w.name}</span>
        </button>`
    }).join('')

    root.innerHTML = `
      <div class="menu-panel menu-panel-wide">
        <p class="menu-brand">Steel</p>
        <h1 class="menu-title">Customize</h1>
        <p class="menu-sub">Pick a wrap · preview · Apply saves to your account + Deploy.</p>
        <div class="wrap-preview">
          ${previewHtml}
          <div class="wrap-preview-meta">
            <p class="wrap-preview-name">${opt.name}</p>
            <p class="wrap-preview-blurb">${opt.blurb}</p>
          </div>
        </div>
        <div class="wrap-grid">${cards}</div>
        <div class="wrap-actions">
          <button type="button" class="deploy-btn wrap-apply" data-apply>Apply</button>
          <button type="button" class="deploy-btn menu-back">Back</button>
        </div>
        <p class="wrap-status" data-status></p>
      </div>
    `

    root.querySelectorAll('[data-wrap]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = (btn as HTMLButtonElement).dataset.wrap as WrapId
        render()
      })
    })
    root.querySelector('[data-apply]')!.addEventListener('click', () => {
      void (async () => {
        setSelectedWrapId(selected)
        const user = await updateProfile({ wrapId: selected })
        render()
        const status = root.querySelector('[data-status]') as HTMLParagraphElement
        if (user) {
          status.textContent = `Saved to account: ${wrapOptionById(selected).name} — used on Deploy.`
          console.info('[Steel] Wrap saved to profile:', selected)
        } else {
          status.textContent = `Applied locally: ${wrapOptionById(selected).name} (not signed in).`
        }
      })()
    })
    root.querySelector('.menu-back')!.addEventListener('click', () => goHome(root, resolve))
  }

  render()
}

function showMatchSetup(
  root: HTMLDivElement,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-match')

  let mapId: MapId = 'forest'
  const redAi: TankId[] = [DEFAULT_AI_TANK]
  const blueAi: TankId[] = [DEFAULT_AI_TANK]
  let timeOfDay: TimeOfDay = 'day'
  let season: Season = 'summer'
  let weather: WeatherKind = 'clear'
  let gameMode: GameModeId = 'koth'

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Match setup</h1>
      <p class="menu-sub">Pick a mode, conditions, and AI. You’ll choose your nation spawn next.</p>

      <p class="menu-section">Mode</p>
      <div class="env-row" data-env="mode">
        <button type="button" class="env-chip is-selected" data-val="koth">King of the Hill</button>
        <button type="button" class="env-chip" data-val="skirmish">Skirmish</button>
      </div>
      <p class="menu-hint" data-mode-hint>Hold Midwood for 90s. Infinite respawns until a nation wins.</p>

      <p class="menu-section">Map</p>
      <p class="menu-hint menu-map-fixed">Forest Overwatch — curved roads · North ruins · abandoned cars</p>

      <p class="menu-section">Time of day</p>
      <div class="env-row" data-env="time">
        <button type="button" class="env-chip is-selected" data-val="day">Day</button>
        <button type="button" class="env-chip" data-val="night">Night</button>
      </div>

      <p class="menu-section">Season</p>
      <div class="env-row" data-env="season">
        <button type="button" class="env-chip is-selected" data-val="summer">Summer</button>
        <button type="button" class="env-chip" data-val="winter">Winter</button>
      </div>

      <p class="menu-section">Weather</p>
      <div class="env-row" data-env="weather">
        <button type="button" class="env-chip is-selected" data-val="clear">Clear / sun</button>
        <button type="button" class="env-chip" data-val="rain">Rain</button>
        <button type="button" class="env-chip" data-val="fog">Fog</button>
      </div>
      <p class="menu-hint">Rain: wet slip · Fog: low visibility · Summer heat / winter oil: older tanks only</p>

      <p class="menu-section">Vostok Republic AI</p>
      <div class="match-panel" data-team-ai="red"></div>

      <p class="menu-section">United Meridian Democracy AI</p>
      <div class="match-panel" data-team-ai="blue"></div>

      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-continue>Continue</button>
      </div>
    </div>
  `

  function wireEnvRow(
    key: 'time' | 'season' | 'weather' | 'mode',
    apply: (v: string) => void,
  ): void {
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
  const modeHint = root.querySelector('[data-mode-hint]') as HTMLElement
  wireEnvRow('mode', (v) => {
    gameMode = v === 'skirmish' ? 'skirmish' : 'koth'
    modeHint.textContent =
      gameMode === 'koth'
        ? 'Hold Midwood for 90s. Infinite respawns until a nation wins.'
        : 'Wipe the enemy team. You lose if your tank is destroyed.'
  })

  function renderTeamAi(team: 'red' | 'blue'): void {
    const box = root.querySelector(`[data-team-ai="${team}"]`)!
    const list = team === 'red' ? redAi : blueAi
    box.innerHTML = `
      <div class="match-row">
        <span class="match-label">${nationByTeam(team).short} AI count</span>
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

  root.querySelector('.menu-back')!.addEventListener('click', () => goHome(root, resolve))
  root.querySelector('[data-continue]')!.addEventListener('click', () => {
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
    showSpawnSelect(root, draft, resolve)
  })
}

function showSpawnSelect(
  root: HTMLDivElement,
  draft: MatchDraft,
  resolve: (s: MenuSelection) => void,
): void {
  clearRoot(root)
  root.classList.add('menu-screen-spawn')
  warmupMatchAssets([...draft.redAi, ...draft.blueAi])

  const map = mapOptionById(draft.mapId)
  let team: TeamId | null = null
  let spawnIndex: number | null = null
  let tankId: TankId = TANK_OPTIONS[0]?.id ?? 'pz3'

  const markers = [
    ...map.spawns.red.map((p, i) => ({ team: 'red' as const, index: i, pos: p })),
    ...map.spawns.blue.map((p, i) => ({ team: 'blue' as const, index: i, pos: p })),
  ]

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

  const dots = markers
    .map((m) => {
      const { cx, cy } = toSvg(m.pos.x, m.pos.z)
      return `<button type="button" class="spawn-dot spawn-${m.team}" data-team="${m.team}" data-index="${m.index}" style="left:${(cx / svgW) * 100}%;top:${(cy / svgH) * 100}%" aria-label="${nationByTeam(m.team).short} spawn ${m.index + 1}"></button>`
    })
    .join('')

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Choose spawn</h1>
      <p class="menu-sub">${map.name} · ${draft.gameMode === 'koth' ? 'King of the Hill' : 'Skirmish'} · ${mapW}×${mapH}m — click a spawn, then pick your tank.</p>

      <div class="spawn-map-wrap">
        <div class="spawn-map" style="width:${svgW}px;height:${svgH}px">
          <div class="spawn-map-grid"></div>
          ${draft.gameMode === 'koth' ? `<div class="spawn-hill" style="left:50%;top:50%" title="King of the Hill"></div>` : ''}
          ${dots}
        </div>
        <div class="spawn-legend spawn-legend-nations">
          ${NATIONS.map(
            (n) =>
              `<span class="spawn-legend-nation"><img src="${nationFlagSrc(n)}" alt="" width="28" height="20" />${n.short}</span>`,
          ).join('')}
        </div>
      </div>

      <p class="spawn-picked" data-picked>No spawn selected</p>

      <p class="menu-section">Your tank</p>
      <div class="tank-grid" role="listbox" aria-label="Your tank"></div>

      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-deploy disabled>Deploy</button>
      </div>
    </div>
  `

  const picked = root.querySelector('[data-picked]') as HTMLElement
  const deploy = root.querySelector('[data-deploy]') as HTMLButtonElement
  const tankGrid = root.querySelector('.tank-grid')!

  function refreshDeploy(): void {
    deploy.disabled = !(team !== null && spawnIndex !== null && tankId)
  }

  root.querySelectorAll('.spawn-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.spawn-dot').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      team = (btn as HTMLElement).dataset.team as TeamId
      spawnIndex = Number((btn as HTMLElement).dataset.index)
      picked.textContent = `${nationByTeam(team).name} · spawn ${spawnIndex + 1}`
      picked.classList.toggle('is-red', team === 'red')
      picked.classList.toggle('is-blue', team === 'blue')
      refreshDeploy()
    })
  })

  for (const tank of TANK_OPTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tank-card'
    btn.dataset.id = tank.id
    const stats = tank.aircraft
      ? `Air · guns + bombs · KOTH support`
      : `Pen ${tank.gun.aphePen} · Armor ${tank.armor.hullFront.armor} · HP ${tank.maxHp}`
    btn.innerHTML = `<span class="tank-name">${tank.name}</span><span class="tank-role">${tank.role}</span><span class="tank-stats">${stats}</span><span class="tank-blurb">${tank.blurb}</span>`
    btn.addEventListener('click', () => {
      tankId = tank.id
      warmupMatchAssets([tankId, ...draft.redAi, ...draft.blueAi])
      tankGrid.querySelectorAll('.tank-card').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
      refreshDeploy()
    })
    tankGrid.appendChild(btn)
  }
  ;(tankGrid.querySelector('.tank-card') as HTMLButtonElement | null)?.click()

  root.querySelector('.menu-back')!.addEventListener('click', () => {
    showMatchSetup(root, resolve)
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
