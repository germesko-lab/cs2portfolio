# STEAM_INTEGRATION.md — how CS2 sites connect Steam accounts, and what we implement

Research based ONLY on publicly observable site behavior and official Steam
documentation (July 2026). No private/internal implementations were examined.

## What the ecosystem does (publicly observable)

- **CSFloat** (marketplace): "Sign in through Steam" is the primary flow — one
  click on the Steam sign-in button while logged into steamcommunity.com.
  Requirements they publish: public profile/inventory (and, for *trading*,
  Steam Mobile Authenticator age — irrelevant for read-only tracking).
  Source: csfloat.com support wizard.
- **Portfolio/value calculators** (Pricempire portfolio, Steamfolio,
  SteamInventory.gg, Tradeit/Clash/Skinpock calculators, CSGOSKINS.GG
  portfolio): near-universally offer BOTH (a) "Sign in through Steam" for a
  one-click connect, and (b) manual entry of a SteamID64 / profile URL /
  custom URL, since reading a *public* inventory needs no authentication at
  all. All of them publish the same requirement: **the inventory must be set
  to Public during the scan** (Steam → profile → Edit Profile → Privacy
  Settings → "Inventory" → Public); several note you may flip it back to
  private afterwards.
- Behavior on private inventories is consistent everywhere: a user-facing
  message telling you to make the inventory public — because there is no
  legitimate alternative (see below).

## Official Steam mechanisms (documented)

| Mechanism | Doc | What it gives |
|---|---|---|
| **Steam OpenID 2.0 login** | partner.steamgames.com/doc/features/auth | Redirect the user to `https://steamcommunity.com/openid/login`; after they authenticate, Steam redirects back with a signed assertion whose Claimed ID is `https://steamcommunity.com/openid/id/{steamid64}`. Verify server-side (OpenID 2.0 §11.4.2 "direct verification": POST the assertion back with `openid.mode=check_authentication`, Steam answers `is_valid:true`). **Authenticates identity ONLY.** |
| **Public inventory endpoint** | undocumented-but-canonical community endpoint (used by the Steam Community site itself): `GET https://steamcommunity.com/inventory/{steamid64}/730/2?l=english&count=…`, paged via `more_items`/`last_assetid` | The user's CS2 inventory **iff their inventory privacy is Public**. Anonymous; no key. Aggressively rate-limited (HTTP 429) — cache and back off; official rate numbers are not published. |
| **ResolveVanityURL** | Steam Web API `ISteamUser/ResolveVanityURL/v1` (steamcommunity.com/dev, api key required, 100k calls/day per the API Terms of Use) | Converts a custom `/id/{name}` to a SteamID64. |

## The hard boundary (be explicit)

- **A private inventory cannot be read by any legitimate method — period.**
  Not with OpenID, not with a Web API key. **Steam OpenID authenticates
  identity only; it does NOT grant the site any access to a private
  inventory.** (There is no OAuth-style consent flow that shares inventory
  data with third parties.) That is exactly why every tracker in the
  ecosystem, marketplaces included, tells users to set Inventory → Public.
- Consequence for UX: after "Sign in through Steam", if the inventory is
  private, the only correct behavior is a clear message naming the exact
  setting (Steam → Edit Profile → Privacy Settings → **Inventory** →
  **Public**) — which is what this app does.

## What we implement (mirrors the ecosystem)

1. **"Sign in through Steam"** — proper OpenID 2.0 `checkid_setup` redirect +
   server-side `check_authentication` verification (plus claimed-id shape,
   return-URL, signed-fields and one-time-nonce checks), yielding the
   SteamID64, a persisted user row and an opaque 30-day session cookie backed
   by the SQLite `sessions` table. Implemented by hand in
   `src/lib/server/steam-auth.ts`: the flow is two HTTP round-trips, and the
   popular npm OpenID libraries are unmaintained and pull in far more surface
   than this needs.
2. **Public inventory read** — unchanged existing pipeline
   (resolve → paginated fetch → normalize → persist → valuation), used both
   by the signed-in flow and by **manual entry** (profile URL / SteamID64 /
   trade link) inside the signed-in user's isolated portfolio.
3. **Rate-limit respect** — per-SteamID64 cache (5 min TTL) + cooldown after
   a 429 (existing `inventory-cache.ts`); sync only on explicit user action.
4. **No Steam Market price scraping** — prices remain on the `PriceSource`
   adapters (CSFloat / CSGOSKINS.GG / mock). Unchanged.

Sources: [Steamworks: User Authentication (OpenID)](https://partner.steamgames.com/doc/features/auth) ·
[Steam Web API / key & terms](https://steamcommunity.com/dev/) ·
[CSFloat support wizard](https://csfloat.com/support/wizard/1/23/31) ·
[Pricempire portfolio](https://pricempire.com/portfolio) · [Steamfolio](https://steamfolio.com/) ·
[Tradeit: Steam privacy settings](https://tradeit.gg/blog/steam-privacy-setting-private-public-inventory/) ·
[SteamInventory.gg](https://steaminventory.gg/) · [community notes on inventory endpoint rate limits](https://github.com/danocmx/node-steamcommunity-inventory)
