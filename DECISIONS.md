# DECISIONS.md - CS2 Portfolio Tracker MVP

Decision rule: pick what yields a working end-to-end MVP today, minimizes
external blockers, and remains understandable for a solo builder. Contracts in
`src/lib/contracts/` and the schema in `db/migrations/` are canonical.

## Stack

- **Next.js 15 App Router + TypeScript, single monolith** - API routes and
  dashboard in one process.
- **SQLite via `better-sqlite3`, raw SQL migrations** - persistent local disk
  is enough for the small MVP target. DB file: `data/portfolio.db`.
- **Recharts** for charts.
- **npm** as package manager.

## Money & Currency

All money is integer cents, USD only. Formatting happens at the UI edge.

## Auth And Users

- Steam OpenID 2.0 is the primary auth method.
- A SteamID64 maps to one `users.id`.
- Browser cookies contain only opaque random session tokens. The SHA-256 hash,
  `user_id`, timestamps and 30-day expiry are stored in `sessions`.
- Logout deletes the current session row and clears the cookie.
- The MVP target is small (roughly 10 users), so SQLite-backed sessions are
  acceptable.

## User Data Isolation

Portfolio-owned tables are keyed by `user_id`:

- `items` for inventory, acquisition dates and item properties
- `cost_basis` for automatic/manual entry prices
- `portfolio_snapshots` for daily value history
- `user_meta` for tracked account metadata
- `item_notes` for future user-specific notes

Market price caches (`price_quotes`, `price_history`) remain global because
they are public marketplace observations, not private user data.

## Price Sources

- `PriceSource` adapter interface is frozen in `src/lib/contracts/pricing.ts`.
- Default `auto` mode uses real sources only: Skinport is keyless, CSFloat and
  CSGOSKINS activate when keys are present.
- `PRICE_SOURCE_MODE=mock` uses deterministic mock prices only. Mock and real
  sources are never mixed.
- "Best price" is the highest quote across configured sources.
- Steam Community Market is not a price source; scraping is out of scope.

## Inventory

- Steam inventory fetch targets the public community inventory endpoint.
- Live inventory sync is independent of price mode. A signed-in user can sync
  their own account or manually sync another public account into their own
  isolated portfolio.
- Vanity `/id/{name}` resolution requires `STEAM_API_KEY`; numeric SteamIDs,
  `/profiles/` URLs and trade-offer URLs do not.
- Private inventories cannot be read legitimately; the UX should explain the
  Steam privacy setting instead.

## Cost Basis

Per-user, per-asset cost basis. Auto-estimate uses market price on the
acquisition date when history exists, falling back to current price. Manual
overrides are stored as `source: 'manual'`; reverting to Auto recomputes or
removes the basis.

Unrealized P/L is `null`, never fake zero, when either current price or basis
is missing.

## Time Series

Daily portfolio snapshots are stored per `(user_id, day)`. A same-day snapshot
overwrites that user's day only. Switching the tracked Steam account for one
user clears only that user's snapshot series.

## API Surface

All portfolio API routes require an authenticated session:

- `POST /api/inventory/sync`
- `GET /api/portfolio`
- `POST /api/prices/refresh`
- `GET /api/history?days=N`
- `PATCH|DELETE /api/positions/[assetId]/cost-basis`

Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`.
