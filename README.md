# CS2 Portfolio Tracker (MVP)

A portfolio tracker for CS2 skins, modeled on stock/crypto portfolio apps —
not a marketplace. Connect a Steam inventory, pull prices from multiple
sources, and see current value, invested (cost basis), per-position and total
unrealized P/L, top gainers/losers, category allocation, best marketplace
price per item, and a daily portfolio-value history.

**Runs fully end-to-end on realistic mock data with zero API keys** — that is
the default mode. Real integrations are implemented against the real API
shapes and activate when keys are provided (see below).

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

First load auto-syncs the bundled 30-item inventory fixture, auto-estimates
cost bases, backfills 30 days of portfolio history, and renders the dashboard.
`npm run build && npm start` for production mode; `npm run typecheck` for TS.
The SQLite database lives in `data/portfolio.db` (auto-created/migrated on
boot; delete it to reset).

## Deploy (personal use)

The app is a single container with SQLite on a volume — any Docker host works.

**Any machine with Docker** (laptop, home server, VPS):

```bash
docker compose up -d --build   # http://localhost:3000, data persists in the cs2data volume
```

**Fly.io** (hosted, HTTPS URL, free-tier friendly — machine sleeps when idle):

```bash
flyctl launch --copy-config --no-deploy   # pick app name + region
flyctl volumes create cs2data --size 1
flyctl deploy
# later, with real keys:
flyctl secrets set PRICE_SOURCE_MODE=live CSFLOAT_API_KEY=... STEAM_ID=...
```

Notes: `next.config.mjs` uses `output: 'standalone'`; the image copies
`db/migrations` (run at boot) and mounts `/app/data` for the SQLite file.
Vercel/Netlify serverless is NOT supported as-is — the SQLite file needs a
persistent disk (migrating to Turso/Postgres is on the production path).

## Stack

Next.js 15 (App Router) + TypeScript strict · SQLite via better-sqlite3 (raw
SQL migrations in `db/migrations/`) · Recharts. Rationale for every decision:
[`DECISIONS.md`](DECISIONS.md). Data-source terms: [`LEGAL.md`](LEGAL.md).

## Architecture

```
src/lib/contracts/   FROZEN shared contracts: item model, PriceSource,
                     valuation shapes, API DTOs, mock item universe
src/lib/steam/       inventory fetch (real endpoint shape + fixture) + normalization
src/lib/prices/      PriceSource adapters: csfloat, csgoskins, mock + cache/aggregation
src/lib/valuation/   pure valuation/P&L engine, cost-basis CRUD, daily snapshots
src/lib/server/      orchestration: sync, portfolio assembly, cost-basis ops
src/app/api/         REST endpoints (see src/lib/contracts/api.ts for DTOs)
src/app/ + components/  dashboard UI
```

API: `POST /api/inventory/sync` · `GET /api/portfolio` ·
`POST /api/prices/refresh` · `GET /api/history?days=N` ·
`PATCH|DELETE /api/positions/{assetId}/cost-basis`.

## Where every REAL_KEY_REQUIRED lives

Search the repo for `REAL_KEY_REQUIRED`. Injection points (all read from env,
see `.env.example`):

| Env var | File | What it unlocks |
|---|---|---|
| `CSFLOAT_API_KEY` | `src/lib/prices/csfloat.ts` | Live CSFloat listings prices (primary source) |
| `CSGOSKINS_API_KEY` | `src/lib/prices/csgoskins.ts` | Cross-market aggregated prices (partner API) |
| `STEAM_ID` (+ `PRICE_SOURCE_MODE=live`) | `src/lib/steam/client.ts` | Live public-inventory fetch instead of the fixture |
| `STEAM_WEB_API_KEY` | `src/lib/steam/client.ts` | (post-MVP) profile lookups via Steam Web API |

Set `PRICE_SOURCE_MODE=live` to activate any source whose key is present;
sources without keys are skipped gracefully and the app keeps working.

## Cost-basis model (hybrid)

Each position gets an **auto** cost basis = market price on its acquisition
date (from the price-history series; falls back to current price). Click any
cost-basis cell in the UI to set a **manual** override; "Auto" reverts it.
Unrealized P/L is `null` — never a fake 0 — when either the price or the basis
is missing.

## Intentionally out of MVP scope

- Realized P/L / sales ledger (it's a tracker, not a trade journal)
- Multi-user auth, multiple portfolios, multi-currency (USD cents only)
- Float/paint-seed inspection for live inventories (fields exist; fixture
  simulates them; live values need the inspect-link / CSFloat checker flow)
- Steam Community Market prices (no public API; scraping prohibited — see
  LEGAL.md)
- Background price polling/schedulers (refresh is user-triggered)

## Ordered next steps to production

1. **CSFloat key**: create one (csfloat.com → profile → Developers), set
   `CSFLOAT_API_KEY` + `PRICE_SOURCE_MODE=live`, verify quotes and tune the
   adapter's rate limiting against real 429 behavior.
2. **Live inventory**: set `STEAM_ID`, harden `src/lib/steam/client.ts`
   against private profiles/429s, add retry-with-backoff and a sync cooldown.
3. **Real price history**: persist daily quotes per item (table exists:
   `price_history`) via a daily cron; switch auto cost-basis estimates and
   backfill to real series.
4. **CSGOSKINS.GG partner API** agreement → set `CSGOSKINS_API_KEY` for
   cross-market best-price comparison; add per-source attribution per their
   terms.
5. **Float inspection**: enrich items via the CSFloat inspect API to fill
   `floatValue`/`paintSeed` and price wear-sensitive items more precisely.
6. Auth + multi-portfolio, snapshot cron, Docker/hosted deploy (SQLite file →
   volume, or migrate to Postgres if multi-user), monitoring on adapter
   failures.
