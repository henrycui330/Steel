import { nationByTeam, type TeamId } from './nations'

export type MatchEndKind = 'win' | 'lose'

export type MatchEndOpts = {
  kind: MatchEndKind
  title?: string
  sub?: string
  team?: TeamId
}

/** Full-screen match result. Reloads to return to menu. */
export function showMatchEnd(kindOrOpts: MatchEndKind | MatchEndOpts): void {
  if (document.getElementById('match-end')) return

  const opts: MatchEndOpts =
    typeof kindOrOpts === 'string' ? { kind: kindOrOpts } : kindOrOpts
  const nation = opts.team ? nationByTeam(opts.team) : null
  const title =
    opts.title ?? (opts.kind === 'win' ? 'Victory' : 'Destroyed')
  const sub =
    opts.sub ??
    (opts.kind === 'win'
      ? 'All enemy armor eliminated.'
      : 'Your tank is a wreck. The field is lost.')

  const root = document.createElement('div')
  root.id = 'match-end'
  root.className = opts.kind === 'win' ? 'match-end is-win' : 'match-end is-lose'
  root.innerHTML = `
    <div class="match-end-panel">
      ${nation ? `<img class="match-end-flag" src="${nation.flagUrl}" alt="${nation.name}" />` : ''}
      <p class="match-end-brand">Steel</p>
      <h1 class="match-end-title">${title}</h1>
      <p class="match-end-sub">${sub}</p>
      <button type="button" class="deploy-btn match-end-btn">Main menu</button>
    </div>
  `
  root.querySelector('.match-end-btn')!.addEventListener('click', () => {
    window.location.reload()
  })
  document.body.appendChild(root)
  console.info(`[Steel] Match end → ${opts.kind}${nation ? ` · ${nation.short}` : ''}`)
}
