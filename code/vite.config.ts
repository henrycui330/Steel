import { defineConfig } from 'vite'

// GitHub Pages project site: https://henrycui330.github.io/Steel/
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
