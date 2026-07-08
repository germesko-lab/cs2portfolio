# CS2 Portfolio Tracker (MVP)

A portfolio tracker for CS2 skins, modeled on stock/crypto portfolio apps,
not a marketplace. Connect a Steam inventory, pull prices from multiple
sources, and see current value, invested cost basis, unrealized P/L, top
gainers/losers, category allocation, best marketplace price per item, and a
daily portfolio-value history.

The MVP runs with zero API keys: Steam login creates a persistent 30-day
session, Skinport provides keyless real prices by default, and
`PRICE_SOURCE_MODE=mock` is available for deterministic offline/demo prices.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Sign in through Steam first. The app then auto-syncs your public inventory,
auto-estimates cost bases, records portfolio snapshots, and renders your
isolated dashboard.

## Connect Your Steam Account

1. **Sign in through Steam** - one click; a proper OpenID 2.0 flow verified
   server-side (`src/lib/server/steam-auth.ts`). The SteamID64 is saved as a
   user, an opaque 30-day session cookie is backed by the SQLite `sessions`
   table, and the app auto-syncs your inventory. Steam OpenID authenticates
   identity only: your inventory must still be Public.
2. **Manual sync input** - after signing in, paste a profile URL, raw
   SteamID64, trade offer URL, or vanity `/id/{name}` URL and hit **Sync from
   link**. Vanity names require `STEAM_API_KEY`; numeric/profile/trade links
   do not.

The inventory fetch uses the public Steam Community inventory endpoint with
pagination, a short-TTL cache per account, and cooldown handling for Steam
429s. **Load demo** loads the bundled fixture into the signed-in user's
isolated portfolio.

Prices work with zero keys via Skinport's official public API. A
`CSFLOAT_API_KEY` adds CSFloat quotes on top; best price is the highest quote
across configured sources. `PRICE_SOURCE_MODE=mock` switches to deterministic
offline prices.

## Deploy

The app is a single container with SQLite on a persistent volume.

```bash
docker compose up -d --build
```

Railway uses `railway.json` + `Dockerfile`. Attach a volume at `/app/data` so
`data/portfolio.db` survives deploys.

Fly.io:

```bash
flyctl launch --copy-config --no-deploy
flyctl volumes create cs2data --size 1
flyctl deploy
flyctl secrets set PRICE_SOURCE_MODE=auto CSFLOAT_API_KEY=...
```

Vercel/Netlify serverless is not supported as-is because SQLite needs a
persistent disk.

## Stack

Next.js 15 App Router + TypeScript strict, SQLite via `better-sqlite3`, raw
SQL migrations, Recharts, npm. See `DECISIONS.md` and `LEGAL.md`.

## Architecture

```text
src/lib/contracts/      Shared contracts: item model, PriceSource, API DTOs
src/lib/steam/          Inventory fetch, fixture, normalization
src/lib/prices/         CSFloat, CSGOSKINS, Skinport, mock, cache/aggregation
src/lib/valuation/      Pure valuation engine, cost basis, snapshots
src/lib/server/         Auth/session + portfolio orchestration
src/app/api/            REST endpoints
src/app/ + components/  Dashboard UI
```

API: `POST /api/inventory/sync`, `GET /api/portfolio`,
`POST /api/prices/refresh`, `GET /api/history?days=N`,
`PATCH|DELETE /api/positions/{assetId}/cost-basis`.

## Multi-user Data Isolation

Steam login is the primary auth method. Each SteamID maps to `users.id`, and
the browser cookie contains only an opaque random token. Its SHA-256 hash,
`user_id`, and 30-day expiry live in `sessions`; logout deletes the current
session row and clears the cookie.

Portfolio-owned data is keyed by `user_id`:

- `items` - inventory, acquisition dates and item properties
- `cost_basis` - automatic/manual entry prices
- `portfolio_snapshots` - daily value history
- `user_meta` - tracked Steam account and last sync timestamp
- `item_notes` - user-specific notes for future UI/API work

Market price caches (`price_quotes`, `price_history`) remain global because
they are public market data, not private portfolio state.

## Env Vars

| Env var | What it unlocks |
|---|---|
| `CSFLOAT_API_KEY` | Live CSFloat listing prices |
| `CSGOSKINS_API_KEY` | Cross-market aggregated prices |
| `STEAM_API_KEY` | Vanity `/id/{name}` resolution only |
| `APP_BASE_URL` | Public OpenID realm/return URL; Railway domain is auto-detected |
| `PRICE_SOURCE_MODE=mock` | Deterministic offline prices |

Unset/`auto` price mode uses real sources: Skinport keyless plus any keyed
sources whose keys are present.

## Cost-basis Model

Each position gets an auto cost basis from the market price on its acquisition
date when history exists, falling back to the current price. Users can set a
manual override per asset; "Auto" reverts it. P/L is `null`, never fake zero,
when either price or basis is missing.

## Out Of Scope

- Realized P/L / sales ledger
- Multiple portfolios per user
- Multi-currency
- Live float/paint-seed inspection
- Steam Community Market scraping
- Background price polling/schedulers

## Ordered Next Steps

1. Tune CSFloat rate limiting against real 429 behavior.
2. Harden live inventory sync around private profiles and Steam 429s.
3. Persist real daily quote history and backfill cost-basis estimates from it.
4. Add CSGOSKINS.GG partner API attribution if that source is enabled.
5. Add float inspection via CSFloat inspect APIs.
6. Add multiple portfolios per user and consider Postgres if usage grows
   beyond the small SQLite MVP.
