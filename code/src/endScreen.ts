import { nationByTeam, nationFlagSrc, type TeamId } from './nations'
import { formatKd, type ScoreRow } from './scoreboard'

export type MatchEndKind = 'win' | 'lose'

export type MatchEndOpts = {
  kind: MatchEndKind
  title?: string
  sub?: string
  team?: TeamId
  /** Ranked rows (kills desc). Empty → classic title-only fallback. */
  leaderboard?: ScoreRow[]
  /** True when a 3D podium renders behind: skip HTML cards, stay see-through. */
  podium3d?: boolean
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function podiumHtml(rows: ScoreRow[]): string {
  const top = rows.slice(0, 3)
  if (top.length === 0) return ''

  const slots: Array<{ place: 1 | 2 | 3; row: ScoreRow | null }> = [
    { place: 2, row: top[1] ?? null },
    { place: 1, row: top[0] ?? null },
    { place: 3, row: top[2] ?? null },
  ]

  const cards = slots
    .map(({ place, row }, i) => {
      if (!row) {
        return `<div class="podium-slot podium-empty" data-place="${place}" style="--i:${i}"></div>`
      }
      const nation = nationByTeam(row.team)
      const you = row.isPlayer ? ' <span class="podium-you">(You)</span>' : ''
      return `
        <div class="podium-slot podium-p${place}" data-place="${place}" style="--i:${i}">
          <div class="podium-card">
            <img class="podium-flag" src="${nationFlagSrc(nation)}" alt="" />
            <p class="podium-place">#${place}</p>
            <p class="podium-name">${escapeHtml(row.name)}${you}</p>
            <p class="podium-tank">${escapeHtml(row.tankName)}</p>
            <p class="podium-kd"><strong>${row.kills}</strong> K · <strong>${row.deaths}</strong> D</p>
          </div>
          <div class="podium-block" aria-hidden="true"></div>
        </div>`
    })
    .join('')

  return `<div class="podium" aria-label="Top three">${cards}</div>`
}

function tableHtml(rows: ScoreRow[]): string {
  if (rows.length === 0) return ''
  const body = rows
    .map((row, i) => {
      const nation = nationByTeam(row.team)
      const youCls = row.isPlayer ? ' is-you' : ''
      const you = row.isPlayer ? ' <span class="lb-you">(You)</span>' : ''
      return `
        <tr class="lb-row${youCls}">
          <td class="lb-rank">${i + 1}</td>
          <td class="lb-name">
            <img class="lb-flag" src="${nationFlagSrc(nation)}" alt="" />
            <span>${escapeHtml(row.name)}${you}</span>
          </td>
          <td class="lb-tank">${escapeHtml(row.tankName)}</td>
          <td class="lb-k">${row.kills}</td>
          <td class="lb-d">${row.deaths}</td>
          <td class="lb-ratio">${formatKd(row.kills, row.deaths)}</td>
        </tr>`
    })
    .join('')

  return `
    <div class="lb-wrap">
      <table class="lb-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Commander</th>
            <th>Tank</th>
            <th>K</th>
            <th>D</th>
            <th>K/D</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`
}

/** Full-screen match result. Reloads to return to menu. */
export function showMatchEnd(kindOrOpts: MatchEndKind | MatchEndOpts): void {
  if (document.getElementById('match-end')) return

  const opts: MatchEndOpts =
    typeof kindOrOpts === 'string' ? { kind: kindOrOpts } : kindOrOpts
  const nation = opts.team ? nationByTeam(opts.team) : null
  const rows = opts.leaderboard ?? []
  const title =
    opts.title ?? (opts.kind === 'win' ? 'Victory' : 'Destroyed')
  const sub =
    opts.sub ??
    (opts.kind === 'win'
      ? 'All enemy armor eliminated.'
      : 'Your tank is a wreck. The field is lost.')

  const root = document.createElement('div')
  root.id = 'match-end'
  root.className = [
    'match-end',
    opts.kind === 'win' ? 'is-win' : 'is-lose',
    opts.podium3d ? 'has-stage' : '',
  ]
    .filter(Boolean)
    .join(' ')

  root.innerHTML = opts.podium3d
    ? `
    <div class="stage-top">
      <p class="match-end-brand">Steel</p>
      <h1 class="match-end-title">${escapeHtml(title)}</h1>
      <p class="match-end-sub">${escapeHtml(sub)}</p>
    </div>
    <div class="stage-bottom">
      ${tableHtml(rows)}
      <button type="button" class="deploy-btn match-end-btn">Main menu</button>
    </div>
  `
    : `
    <div class="match-end-panel${rows.length ? ' has-board' : ''}">
      ${nation ? `<img class="match-end-flag" src="${nationFlagSrc(nation)}" alt="${escapeHtml(nation.name)}" />` : ''}
      <p class="match-end-brand">Steel</p>
      <h1 class="match-end-title">${escapeHtml(title)}</h1>
      <p class="match-end-sub">${escapeHtml(sub)}</p>
      ${podiumHtml(rows)}
      ${tableHtml(rows)}
      <button type="button" class="deploy-btn match-end-btn">Main menu</button>
    </div>
  `
  root.querySelector('.match-end-btn')!.addEventListener('click', () => {
    window.location.reload()
  })
  document.body.appendChild(root)
  // Trigger CSS enter animations on next frame
  requestAnimationFrame(() => {
    root.classList.add('is-shown')
  })
  console.info(
    `[Steel] Match end → ${opts.kind}${nation ? ` · ${nation.short}` : ''} · board ${rows.length}`,
  )
}
