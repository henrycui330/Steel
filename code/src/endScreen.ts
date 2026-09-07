export type MatchEndKind = 'win' | 'lose'

/** Full-screen match result. Reloads to return to menu. */
export function showMatchEnd(kind: MatchEndKind): void {
  if (document.getElementById('match-end')) return

  const root = document.createElement('div')
  root.id = 'match-end'
  root.className = kind === 'win' ? 'match-end is-win' : 'match-end is-lose'
  root.innerHTML = `
    <div class="match-end-panel">
      <p class="match-end-brand">Steel</p>
      <h1 class="match-end-title">${kind === 'win' ? 'Victory' : 'Destroyed'}</h1>
      <p class="match-end-sub">${
        kind === 'win'
          ? 'All enemy armor eliminated.'
          : 'Your tank is a wreck. The field is lost.'
      }</p>
      <button type="button" class="deploy-btn match-end-btn">Main menu</button>
    </div>
  `
  root.querySelector('.match-end-btn')!.addEventListener('click', () => {
    window.location.reload()
  })
  document.body.appendChild(root)
  console.info(`[Steel] Match end → ${kind}`)
}
