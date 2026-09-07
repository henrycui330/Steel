# Steel

Browser 3D tank skirmish (Vite + Three.js).

## Play

- **Local:** `cd code && npm install && npm run dev` → http://127.0.0.1:5173  
- **GitHub Pages:** https://henrycui330.github.io/Steel/  
  (after the Deploy GitHub Pages Action succeeds)

## Auth

- Offline accounts work with no setup.
- Online: see [doc/cloudflare-auth.md](doc/cloudflare-auth.md).

## Deploy Pages (one-time)

1. Repo → **Settings → Pages**
2. **Build and deployment → Source:** GitHub Actions  
3. Push to `main` (or run the **Deploy GitHub Pages** workflow manually)

Do **not** use “Deploy from a branch” on the repo root — there is no root `index.html`; the app builds from `code/`.
