/**
 * Public-file URL that works locally (`/`) and on GitHub Pages (`/Steel/`).
 *
 * Prefer baking the correct `import.meta.env.BASE_URL` via Vite (`VITE_BASE` /
 * production default `/Steel/`). `fixPublicUrl` also rewrites root-absolute
 * public paths at fetch time so an older mis-baked bundle still works on Pages.
 */
export function assetUrl(path: string): string {
  const base = pagesBase()
  const raw = path.replace(/^\//, '')
  const q = raw.indexOf('?')
  const file = q >= 0 ? raw.slice(0, q) : raw
  const query = q >= 0 ? raw.slice(q) : ''
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${file}${query}`
}

/** Project base for GitHub Pages (`/Steel/`) or `/` locally. */
export function pagesBase(): string {
  let base = import.meta.env.BASE_URL || '/'
  if (typeof window !== 'undefined') {
    try {
      const p = window.location.pathname
      if (p === '/Steel' || p.startsWith('/Steel/')) {
        if (base === '/' || base === '' || !String(base).startsWith('/Steel')) {
          base = '/Steel/'
        }
      }
    } catch {
      /* ignore */
    }
  }
  return base.endsWith('/') ? base : `${base}/`
}

const PUBLIC_ROOTS = [
  '/models/',
  '/maps/',
  '/sfx/',
  '/wraps/',
  '/nations/',
  '/assets/',
]

/**
 * Rewrite mis-baked root-absolute asset URLs when the app is served under
 * `/Steel/` (GitHub Pages project site).
 */
export function fixPublicUrl(url: string): string {
  if (typeof window === 'undefined') return url
  const path = window.location.pathname
  if (!(path === '/Steel' || path.startsWith('/Steel/'))) return url

  try {
    // Absolute on this host but missing /Steel
    if (url.startsWith('http')) {
      const u = new URL(url)
      if (
        u.hostname === window.location.hostname &&
        !u.pathname.startsWith('/Steel/') &&
        PUBLIC_ROOTS.some((r) => u.pathname.startsWith(r))
      ) {
        u.pathname = `/Steel${u.pathname}`
        return u.toString()
      }
      return url
    }
  } catch {
    return url
  }

  if (PUBLIC_ROOTS.some((r) => url.startsWith(r))) {
    return `/Steel${url}`
  }
  return url
}
