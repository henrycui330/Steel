import * as THREE from 'three'
import { MAP_OPTIONS, mapOptionById, type MapId } from './maps/mapCatalog'
import { TANK_OPTIONS, type TankId } from './tankCatalog'
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

export type TeamId = 'red' | 'blue'

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
}

type MatchDraft = {
  mapId: MapId
  redAi: TankId[]
  blueAi: TankId[]
  timeOfDay: TimeOfDay
  season: Season
  weather: WeatherKind
}

const AI_SLOT_MAX = 3
const DEFAULT_AI_TANK: TankId = 'pz3'
const SVG_SIZE = 320

function tankOptionsHtml(selected: TankId): string {
  return TANK_OPTIONS.map(
    (t) =>
      `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${t.name}</option>`,
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

  function render(error = '', busy = false): void {
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
            <input class="auth-input" name="username" type="text" maxlength="24" required autocomplete="username" ${busy ? 'disabled' : ''} />
          </label>
          <label class="auth-label">Password
            <input class="auth-input" name="password" type="password" minlength="6" required autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" ${busy ? 'disabled' : ''} />
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
        render('', true)
        const result = tab === 'login' ? await login(username, password) : await register(username, password)
        if (!result.ok) {
          render(result.error, false)
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
  clearRoot(root)
  root.classList.add('menu-screen-home')
  const mode = getSession()?.mode ?? 'offline'
  root.innerHTML = `
    <div class="menu-panel menu-panel-home">
      <p class="menu-brand">Steel</p>
      <p class="menu-tagline">Armor · grit · dust</p>
      <p class="auth-userline">Signed in as <strong>${escapeHtml(user.username)}</strong> · ${mode}</p>
      <div class="home-actions">
        <button type="button" class="home-btn home-btn-play" data-go="play">Play</button>
        <button type="button" class="home-btn" data-go="customize">Customize</button>
        <button type="button" class="home-btn" data-go="settings">Settings</button>
        <button type="button" class="home-btn" data-go="credits">Credits</button>
        <button type="button" class="home-btn home-btn-logout" data-go="logout">Log out</button>
      </div>
    </div>
  `
  root.querySelector('[data-go="play"]')!.addEventListener('click', () => {
    showMatchSetup(root, resolve)
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

  let mapId: MapId = MAP_OPTIONS[0]?.id ?? 'forest'
  const redAi: TankId[] = [DEFAULT_AI_TANK]
  const blueAi: TankId[] = [DEFAULT_AI_TANK]
  let timeOfDay: TimeOfDay = 'day'
  let season: Season = 'summer'
  let weather: WeatherKind = 'clear'

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Match setup</h1>
      <p class="menu-sub">Pick the map, conditions, and AI loadouts. You’ll choose your spawn next.</p>

      <p class="menu-section">Map</p>
      <div class="map-grid" role="listbox" aria-label="Map selection"></div>

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

      <p class="menu-section">Red team AI</p>
      <div class="match-panel" data-team-ai="red"></div>

      <p class="menu-section">Blue team AI</p>
      <div class="match-panel" data-team-ai="blue"></div>

      <div class="menu-nav-row">
        <button type="button" class="home-btn menu-back">Back</button>
        <button type="button" class="deploy-btn" data-continue>Continue</button>
      </div>
    </div>
  `

  const mapGrid = root.querySelector('.map-grid')!

  function wireEnvRow(
    key: 'time' | 'season' | 'weather',
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

  function renderTeamAi(team: 'red' | 'blue'): void {
    const box = root.querySelector(`[data-team-ai="${team}"]`)!
    const list = team === 'red' ? redAi : blueAi
    box.innerHTML = `
      <div class="match-row">
        <span class="match-label">${team === 'red' ? 'Red' : 'Blue'} AI count</span>
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
          ${tankOptionsHtml(tid)}
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

  for (const map of MAP_OPTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tank-card map-card'
    btn.dataset.id = map.id
    btn.innerHTML = `<span class="tank-name">${map.name}</span><span class="tank-blurb">${map.blurb}</span>`
    btn.addEventListener('click', () => {
      mapId = map.id
      mapGrid.querySelectorAll('.tank-card').forEach((el) => el.classList.remove('is-selected'))
      btn.classList.add('is-selected')
    })
    mapGrid.appendChild(btn)
  }
  ;(mapGrid.querySelector('.tank-card') as HTMLButtonElement | null)?.click()

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
    }
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

  const map = mapOptionById(draft.mapId)
  let team: TeamId | null = null
  let spawnIndex: number | null = null
  let tankId: TankId = TANK_OPTIONS[0]?.id ?? 'pz3'

  const markers = [
    ...map.spawns.red.map((p, i) => ({ team: 'red' as const, index: i, pos: p })),
    ...map.spawns.blue.map((p, i) => ({ team: 'blue' as const, index: i, pos: p })),
  ]

  function toSvg(x: number, z: number): { cx: number; cy: number } {
    const half = map.size / 2
    return {
      cx: ((x + half) / map.size) * SVG_SIZE,
      cy: ((half - z) / map.size) * SVG_SIZE,
    }
  }

  const dots = markers
    .map((m) => {
      const { cx, cy } = toSvg(m.pos.x, m.pos.z)
      return `<button type="button" class="spawn-dot spawn-${m.team}" data-team="${m.team}" data-index="${m.index}" style="left:${(cx / SVG_SIZE) * 100}%;top:${(cy / SVG_SIZE) * 100}%" aria-label="${m.team} spawn ${m.index + 1}"></button>`
    })
    .join('')

  root.innerHTML = `
    <div class="menu-panel menu-panel-wide">
      <p class="menu-brand">Steel</p>
      <h1 class="menu-title">Choose spawn</h1>
      <p class="menu-sub">${map.name} · ${draft.timeOfDay} · ${draft.season} · ${draft.weather} — click a spawn, then pick your tank.</p>

      <div class="spawn-map-wrap">
        <div class="spawn-map" style="width:${SVG_SIZE}px;height:${SVG_SIZE}px">
          <div class="spawn-map-grid"></div>
          ${dots}
        </div>
        <div class="spawn-legend">
          <span class="spawn-legend-red">Red</span>
          <span class="spawn-legend-blue">Blue</span>
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
      picked.textContent = `${team === 'red' ? 'Red' : 'Blue'} spawn ${spawnIndex + 1}`
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
    btn.innerHTML = `<span class="tank-name">${tank.name}</span><span class="tank-role">${tank.role}</span><span class="tank-blurb">${tank.blurb}</span>`
    btn.addEventListener('click', () => {
      tankId = tank.id
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
