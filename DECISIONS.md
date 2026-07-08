# DECISIONS.md — CS2 Portfolio Tracker MVP

Every ambiguity resolved with the Decision Rule: pick what yields a working
end-to-end MVP today, minimizes external blockers, and is the standard solo
default. Contracts in `src/lib/contracts/` and the schema in `db/migrations/`
are FROZEN — all streams code against them; contracts win over any drift.

## Stack
- **Next.js 15 (App Router) + TypeScript, single monolith** — API routes and
  dashboard in one process, one `npm run dev` boots everything; best default
  for a solo builder integrating REST sources + charts.
- **SQLite via `better-sqlite3`, raw SQL migrations** — zero external DB
  server, synchronous API is ideal for a local tracker; no ORM codegen to
  break offline. DB file: `data/portfolio.db` (gitignored).
- **Recharts** for charts — the standard React charting default, works with
  React 19, no canvas/webgl complexity.
- **npm** as package manager — repo default, no lockfile existed.

## Money & currency
- All money is **integer cents, USD only** (`Cents = number`). Formatting
  happens only at the UI edge. Multi-currency is out of MVP scope.

## Price sources
- `PriceSource` adapter interface (frozen in `src/lib/contracts/pricing.ts`).
  Adapters: **CSFloat** (primary keyed source, real request/response shapes
  from docs.csfloat.com), **CSGOSKINS.GG** (official API shapes, cross-market
  reference), **Skinport** (official public API, NO key — this is what makes
  real prices work out of the box), **Mock** (deterministic data for the
  offline demo). Modes: default 'auto' = real sources only; 'mock' = mock
  only — fabricated prices never compete with real ones.
- No live API keys exist ⇒ real adapters detect a missing key via
  `isConfigured()` and are skipped by the aggregator; every injection point
  is labeled `// REAL_KEY_REQUIRED`. `PRICE_SOURCE_MODE=mock` (default) makes
  the mock source authoritative.
- **"Best price" = highest quote across configured sources** — a portfolio
  holder cares about what the item would fetch; positions are valued at the
  best price. Recorded per item with a deep link + per-source breakdown.
- **Steam Community Market is not a price source** — no public price API and
  scraping is off the table (see LEGAL.md).
- Quotes are cached in the `price_quotes` table; on refresh failure the last
  cached quote is served with `priceStatus: 'cached'`, and items with no
  quote at all are `'missing'` and excluded from totals (but counted and
  surfaced in the UI).

## Inventory
- Steam inventory fetch targets the public inventory JSON endpoint shape
  (`steamcommunity.com/inventory/{steamid}/730/2`) behind an adapter with a
  realistic fixture; live fetch is labeled and optional (see LEGAL.md for
  constraints). Normalization parses market_hash_name + asset properties
  into the canonical item model (wear, StatTrak™, Souvenir, stickers,
  category); float/paint seed are `null` unless available (full float
  inspection needs the game-coordinator/CSFloat inspect flow — out of MVP,
  fields exist in the model).
- Single-user, single portfolio. `STEAM_ID` comes from env or the sync call;
  no auth/multi-tenancy in MVP.
- **Live inventory sync is independent of `PRICE_SOURCE_MODE`**: pasting a
  profile link is an explicit user action, so it always fetches live (with
  per-account caching + 429 cooldown), while `PRICE_SOURCE_MODE` keeps
  governing only the price adapters. The "demo" input (or empty field)
  restores the bundled fixture. Vanity `/id/` resolution needs
  `STEAM_API_KEY`; every other input form works keyless.

## Cost basis (hybrid, per Product spec)
- Per-asset cost basis. **Auto-estimate** = market price on the acquisition
  date, looked up from the price-history series (mock history in MVP);
  falls back to current price when no history covers the date. **Manual
  override** via `PATCH /api/positions/:assetId/cost-basis`; `DELETE` reverts
  to auto. `source: 'auto' | 'manual'` is stored so the UI can show which.
- **Unrealized P/L** = current best value − cost basis; `null` (not 0) when
  either side is missing, so missing data never fakes a gain/loss.
  Realized P/L (sales) is out of MVP scope — this is a tracker, not a ledger.

## Time series
- Daily **portfolio snapshots** (`portfolio_snapshots`, one row per day:
  total value + invested). A snapshot is (re)computed on portfolio load and
  on price refresh (idempotent upsert per day). Mock seed backfills ~30 days
  of history from the mock price-history series so the chart renders today.

## API surface (frozen DTOs in `src/lib/contracts/api.ts`)
- `POST /api/inventory/sync`, `GET /api/portfolio`,
  `POST /api/prices/refresh`, `GET /api/history?days=N`,
  `PATCH|DELETE /api/positions/[assetId]/cost-basis`.
- Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`.

## Orchestration / file ownership (Phase 1)
- Stream A `src/lib/steam/**` · B `src/lib/prices/**` · C
  `src/lib/valuation/**` · D `src/app/api/**` + `src/lib/server/**` · E
  `src/app/(dashboard pages)` + `src/components/**`. No overlaps; contracts,
  `src/lib/db.ts`, and migrations are orchestrator-owned.
