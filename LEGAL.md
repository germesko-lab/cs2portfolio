# LEGAL.md — Data-source terms & access constraints

Summary of the terms governing each external source this app touches, and the
compliance posture the MVP takes. Re-verify all of this against the live ToS
before shipping to production — terms change.

## Steam (Valve)

**What we use:** the public inventory JSON endpoint
`https://steamcommunity.com/inventory/{steamId64}/730/2?l=english&count=…`,
which returns a user's CS2 inventory when their Steam profile privacy is set
to public. This is not part of the documented Steam Web API, but it is the
same endpoint the Steam Community site itself uses, requires no key, and only
exposes data the user has already made public.

**Constraints & posture:**
- **Steam Web API Terms of Use** (for keyed `api.steampowered.com` calls):
  limit of **100,000 calls per day**, key must not be shared, and use of the
  Web API for commercial purposes requires Valve's separate permission. We
  don't need a Web API key for inventory in MVP, but if one is added later
  (e.g. `ISteamUser/GetPlayerSummaries` for profile names) these terms apply.
  Key injection point is labeled `// REAL_KEY_REQUIRED` in
  `src/lib/steam/client.ts`.
- The community inventory endpoint is **aggressively rate-limited**
  (unofficially a handful of requests per minute per IP; sustained polling
  gets HTTP 429). The client therefore fetches on explicit user sync only,
  never on a poller, and caches results in SQLite.
- **Steam Community Market has NO public price API.** The
  `market/priceoverview` endpoint is undocumented, unsupported, and heavily
  rate-limited; the Steam Subscriber Agreement prohibits using automated
  scripts to collect Steam site data (scraping). **Decision: Steam Market is
  not a price source in this app.** Steam prices, where users want them, come
  indirectly via aggregators (CSGOSKINS.GG) that license/aggregate them.
- MVP defaults to a bundled realistic **fixture** of the inventory response
  (`PRICE_SOURCE_MODE=mock` / no `STEAM_ID` set), so nothing hits Valve
  during development.

## CSFloat — primary price/listings source

- Official, documented API: `https://csfloat.com/api/v1/…` (docs.csfloat.com).
  Listings endpoint (`GET /api/v1/listings`) supports filtering by
  `market_hash_name`, sorting by price — this is the app's primary live price
  feed.
- Requires an API key created from the user's CSFloat profile (Developers
  tab), sent as the `Authorization` header. Keys are personal; don't share or
  commit them. Injection point: `// REAL_KEY_REQUIRED` in
  `src/lib/prices/csfloat.ts` (`CSFLOAT_API_KEY` env var).
- Rate limits are enforced per key (docs don't publish exact numbers; the
  adapter batches lookups, caches quotes in SQLite, and backs off on 429).
- Usage here (reading listing prices to value a user's own inventory) is a
  normal API use case. No scraping of csfloat.com pages.

## CSGOSKINS.GG — cross-market aggregation reference

- Terms explicitly **prohibit scraping** the website. **Decision: API only,
  never scraping.** The site offers an official/partner **Pricing API**
  (business/partner plans; JSON REST, aggregated prices across 40+ markets).
- Access requires a commercial API agreement/key. We do not have one, so the
  adapter (`src/lib/prices/csgoskins.ts`) implements the documented
  request/response shape, returns nothing unless `CSGOSKINS_API_KEY` is set
  (`// REAL_KEY_REQUIRED`), and the app degrades gracefully without it.
- Attribution: partner plans typically require crediting CSGOSKINS.GG as the
  data source; the UI shows the source name on every quote, which satisfies
  attribution-style requirements by construction.

## General posture

- No scraping of any website, anywhere in the codebase.
- All third-party calls go through `PriceSource` adapters with caching and
  graceful degradation, so the app never hammers a source and always runs
  (on mock data) with zero keys.
- Valve item names/images referenced via Steam CDN URLs in fixtures are
  Valve's property; fine for a personal tracker, revisit for commercial use.
