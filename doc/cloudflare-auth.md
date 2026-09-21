# Steel auth — Cloudflare Worker (Q4)

Online accounts use a small Cloudflare Worker + D1 database. Offline mode does not need any of this.

## Prerequisites

1. Cloudflare account: https://dash.cloudflare.com  
2. Node.js installed  
3. Log in with Wrangler:

```bash
cd code/workers/steel-auth
npm install
npx wrangler login
```

## Create D1 + set database id

```bash
cd code/workers/steel-auth
npx wrangler d1 create steel-auth
```

Copy the printed `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "steel-auth"
database_id = "paste-id-here"
```

Apply the schema (remote = production DB):

```bash
npm run db:remote
```

For local Worker testing only:

```bash
npm run db:local
```

## Deploy

```bash
npm run deploy
```

Wrangler prints a URL like:

`https://steel-auth.<your-subdomain>.workers.dev`

## Point the game at the API

In `code/.env` (create from `.env.example`):

Local (same-origin proxy — avoids CORS):

```
VITE_STEEL_API=/steel-api
# Prefer local Worker when *.workers.dev is blocked on your network:
VITE_STEEL_API_PROXY=http://127.0.0.1:8787
# Or remote (needs working access to workers.dev):
# VITE_STEEL_API_PROXY=https://steel-auth.YOUR_SUBDOMAIN.workers.dev
```

In another terminal:

```bash
cd code/workers/steel-auth
npm run db:local   # once
npm run dev        # http://127.0.0.1:8787
```

Then restart Vite (`npm run dev` in `code/`).

GitHub Pages (CI secret `VITE_STEEL_API`):

```
VITE_STEEL_API=https://steel-auth.YOUR_SUBDOMAIN.workers.dev
```

If Pages signup times out, your ISP may block `*.workers.dev` — use a VPN or attach a custom domain to the Worker.

## Use Online in the game

1. Hard-refresh the menu  
2. Choose **Online**  
3. Create account / Log in  

Offline accounts and Online accounts are **separate**.

## Signup performance note

Online register/login hashes passwords with PBKDF2 on the Worker. Iteration count is kept **moderate (40k)** so Cloudflare CPU limits do not abort the request (symptoms: long wait, then “Server error”). Redeploy after changing `workers/steel-auth/src/crypto.ts`.

## CORS / other origins

Worker CORS allows `https://henrycui330.github.io` plus any `http(s)://localhost` / `127.0.0.1` port. After changing origins, redeploy the Worker. Local Vite can also use `/steel-api` proxy (no CORS).

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | — |
| POST | `/auth/register` | body `{ username, password }` |
| POST | `/auth/login` | body `{ username, password }` |
| POST | `/auth/logout` | Bearer token |
| GET | `/auth/me` | Bearer token |
| PATCH | `/auth/profile` | Bearer + `{ wrapId }` |
| POST | `/mp/rooms` | Bearer → `{ code }` (5-char room) |
| GET | `/mp/ws?room=&token=` | WebSocket upgrade (session token) |
| GET | `/mp/rooms/:code` | lobby peek (optional) |

## Multiplayer lobby (MP1)

After deploy (Durable Object migration `v1-mp-rooms` runs on first deploy):

1. Sign in **Online**
2. Home → **Multiplayer**
3. **Create room** (share the code) or **Join** with a code
4. Lobby lists everyone (max **6**). Host can **Start** once **2+** players are in.

Local: run Worker (`npm run dev` in `workers/steel-auth`) + Vite with `VITE_STEEL_API=/steel-api` and `ws` proxy (already in `vite.config.ts`).
