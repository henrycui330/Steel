import { defineConfig, loadEnv } from 'vite'

// GitHub Pages project site: https://henrycui330.github.io/Steel/

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Prefer explicit env; default production builds to /Steel/ so a missing
  // VITE_BASE cannot ship root-absolute `/models/...` URLs again.
  const base =
    env.VITE_BASE ||
    process.env.VITE_BASE ||
    (command === 'build' ? '/Steel/' : '/')

  // Proxy target for local same-origin auth (VITE_STEEL_API=/steel-api).
  const proxyTarget =
    env.VITE_STEEL_API_PROXY || 'https://steel-auth.henrycui330.workers.dev'

  return {
    base,
    publicDir: 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/steel-api': {
          target: proxyTarget.replace(/\/$/, ''),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/steel-api/, ''),
        },
      },
    },
    preview: {
      proxy: {
        '/steel-api': {
          target: proxyTarget.replace(/\/$/, ''),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/steel-api/, ''),
        },
      },
    },
  }
})
