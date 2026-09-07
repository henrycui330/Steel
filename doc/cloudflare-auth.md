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

```
VITE_STEEL_API=https://steel-auth.YOUR_SUBDOMAIN.workers.dev
```

Restart Vite (`npm run dev` in `code/`).

## Use Online in the game

1. Hard-refresh the menu  
2. Choose **Online**  
3. Create account / Log in  

Offline accounts and Online accounts are **separate**.

## CORS / other origins

`wrangler.toml` `[vars] ALLOWED_ORIGINS` includes Vite local hosts and `https://henrycui330.github.io`. After changing origins, redeploy the Worker.

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | — |
| POST | `/auth/register` | body `{ username, password }` |
| POST | `/auth/login` | body `{ username, password }` |
| POST | `/auth/logout` | Bearer token |
| GET | `/auth/me` | Bearer token |
| PATCH | `/auth/profile` | Bearer + `{ wrapId }` |
