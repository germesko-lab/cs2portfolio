/**
 * Steam community inventory client (live mode).
 *
 * RATE-LIMIT WARNING (see LEGAL.md — "Steam (Valve)"): the public community
 * inventory endpoint is aggressively rate-limited (unofficially a handful of
 * requests per minute per IP; sustained polling gets HTTP 429). This client
 * must only ever be called on an explicit user "sync" action — never from a
 * poller — and results are cached in SQLite by the persistence layer.
 *
 * // REAL_KEY_REQUIRED: NO key is needed for this endpoint — it serves public
 * // inventories anonymously. A STEAM_WEB_API_KEY env var WOULD be required
 * // for future keyed api.steampowered.com calls (e.g. ISteamUser/
 * // GetPlayerSummaries for profile names), which are governed by the Steam
 * // Web API Terms of Use (100k calls/day, no key sharing; see LEGAL.md).
 */
import type { RawAsset, RawDescription, RawInventoryResponse } from './raw-types';

export type SteamInventoryErrorCode =
  | 'RATE_LIMITED' // HTTP 429 — back off; do not retry immediately
  | 'PRIVATE_INVENTORY' // HTTP 403 or null body — profile/inventory not public
  | 'NOT_FOUND' // HTTP 404 — no such SteamID64 / no CS2 inventory
  | 'BAD_RESPONSE' // 2xx but unparseable or success !== 1
  | 'HTTP_ERROR' // any other non-2xx status
  | 'NETWORK'; // fetch itself failed (DNS, TLS, timeout, …)

/** Typed error thrown by fetchLiveInventory. `status` is null for NETWORK/BAD_RESPONSE without one. */
export class SteamInventoryError extends Error {
  readonly code: SteamInventoryErrorCode;
  readonly status: number | null;

  constructor(code: SteamInventoryErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'SteamInventoryError';
    this.code = code;
    this.status = status;
  }
}

/** Overridable for tests/proxies; defaults to the real Steam Community host. */
const COMMUNITY_BASE = process.env.STEAM_COMMUNITY_BASE_URL ?? 'https://steamcommunity.com';
const BASE_URL = `${COMMUNITY_BASE}/inventory`;
const REQUEST_TIMEOUT_MS = 20_000;
const APP_ID = 730; // CS2
const CONTEXT_ID = 2;
const PAGE_SIZE = 2000; // Steam's maximum per request
/** Hard cap on pages (2000 items each) so a bad cursor can never loop forever. */
const MAX_PAGES = 20;
/** Courtesy pause between pages — the endpoint 429s fast (LEGAL.md). */
const INTER_PAGE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageUrl(steamId64: string, startAssetId: string | null): string {
  const base = `${BASE_URL}/${encodeURIComponent(steamId64)}/${APP_ID}/${CONTEXT_ID}?l=english&count=${PAGE_SIZE}`;
  return startAssetId === null ? base : `${base}&start_assetid=${encodeURIComponent(startAssetId)}`;
}

async function fetchPage(url: string): Promise<RawInventoryResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new SteamInventoryError(
      'NETWORK',
      `Could not reach Steam (network error or timeout): ${detail}. Check connectivity and try again.`,
    );
  }

  if (res.status === 429) {
    throw new SteamInventoryError(
      'RATE_LIMITED',
      'Steam rate-limited the inventory request (HTTP 429). Wait a few minutes before syncing again.',
      429,
    );
  }
  if (res.status === 403) {
    throw new SteamInventoryError(
      'PRIVATE_INVENTORY',
      'Steam returned HTTP 403 — the profile or its inventory is private. Set inventory privacy to Public and retry.',
      403,
    );
  }
  if (res.status === 404) {
    throw new SteamInventoryError(
      'NOT_FOUND',
      'Steam returned HTTP 404 — no such SteamID64 or no CS2 inventory for this account.',
      404,
    );
  }
  if (!res.ok) {
    throw new SteamInventoryError('HTTP_ERROR', `Steam inventory request failed with HTTP ${res.status}.`, res.status);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SteamInventoryError('BAD_RESPONSE', 'Steam returned a non-JSON inventory response.', res.status);
  }

  // Steam serves a literal `null` body (HTTP 200) for some private/empty cases.
  if (body === null) {
    throw new SteamInventoryError(
      'PRIVATE_INVENTORY',
      'Steam returned an empty (null) inventory body — the inventory is most likely private.',
      res.status,
    );
  }
  const page = body as Partial<RawInventoryResponse>;
  if (page.success !== 1 || !Array.isArray(page.assets) || !Array.isArray(page.descriptions)) {
    throw new SteamInventoryError('BAD_RESPONSE', 'Steam inventory response was malformed (success !== 1).', res.status);
  }
  return page as RawInventoryResponse;
}

/**
 * fetchLiveInventory — fetch a user's full public CS2 inventory from
 * steamcommunity.com, following `more_items`/`last_assetid` paging and
 * merging all pages into a single RawInventoryResponse.
 *
 * LIVE USE IS RATE-LIMITED per LEGAL.md: call only on explicit user sync.
 * Throws SteamInventoryError with a typed `code` on 429 / private / 404 /
 * malformed responses so callers can degrade gracefully.
 */
export async function fetchLiveInventory(steamId64: string): Promise<RawInventoryResponse> {
  if (!/^\d{17}$/.test(steamId64)) {
    throw new SteamInventoryError('BAD_RESPONSE', `"${steamId64}" is not a 17-digit SteamID64.`);
  }

  const assets: RawAsset[] = [];
  const descriptionsByKey = new Map<string, RawDescription>();
  let totalInventoryCount = 0;
  let startAssetId: string | null = null;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    if (pageIndex > 0) await sleep(INTER_PAGE_DELAY_MS);

    const page = await fetchPage(pageUrl(steamId64, startAssetId));
    assets.push(...page.assets);
    for (const d of page.descriptions) {
      descriptionsByKey.set(`${d.classid}_${d.instanceid}`, d);
    }
    totalInventoryCount = page.total_inventory_count;

    if (page.more_items !== 1 || !page.last_assetid || page.last_assetid === startAssetId) {
      return {
        assets,
        descriptions: [...descriptionsByKey.values()],
        total_inventory_count: totalInventoryCount,
        success: 1,
      };
    }
    startAssetId = page.last_assetid;
  }

  throw new SteamInventoryError(
    'BAD_RESPONSE',
    `Steam inventory paging did not terminate within ${MAX_PAGES} pages; aborting to respect rate limits.`,
  );
}
