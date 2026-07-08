/**
 * CSFloat price adapter — the app's primary LIVE price source.
 *
 * Request/response shapes follow the official documented API
 * (https://docs.csfloat.com):
 *   GET https://csfloat.com/api/v1/listings
 *       ?market_hash_name=<name>&sort_by=lowest_price&limit=1
 *       Authorization: <CSFLOAT_API_KEY>            // plain key, no "Bearer"
 *   → paginated object whose `data` array holds listings with `price`
 *     (integer cents) and `item.market_hash_name`.
 *
 *   GET https://csfloat.com/api/v1/history/{market_hash_name}/sales
 *       → array of recent sales with `price` (cents) and `sold_at`.
 *
 * Legal/rate posture (LEGAL.md): official API only, never scrape
 * csfloat.com pages. Per-key rate limits are unpublished, so quote lookups
 * are sequential with a small delay and exponential backoff on HTTP 429.
 * The adapter never throws — failures are logged and partial results
 * returned so the aggregator degrades gracefully.
 */
import type { PricePoint, PriceQuote, PriceSource } from '../contracts/pricing';

const BASE_URL = 'https://csfloat.com/api/v1';
const DISPLAY_NAME = 'CSFloat';
/** Small pause between sequential per-name requests. */
const REQUEST_DELAY_MS = 350;
/** Backoff schedule for HTTP 429 responses. */
const BACKOFF_MS = [1_000, 3_000, 8_000];

/** Item payload embedded in a listing (subset of documented fields). */
interface CsfloatListingItem {
  asset_id?: string;
  market_hash_name: string;
  wear_name?: string;
  float_value?: number;
  is_stattrak?: boolean;
  is_souvenir?: boolean;
  icon_url?: string;
}

/** One listing from GET /api/v1/listings. */
interface CsfloatListing {
  id: string;
  created_at: string;
  type: 'buy_now' | 'auction';
  /** Integer USD cents. */
  price: number;
  state?: 'listed' | 'delisted' | 'sold' | 'refunded';
  item: CsfloatListingItem;
  watchers?: number;
}

/** Paginated envelope returned by GET /api/v1/listings. */
interface CsfloatListingsResponse {
  data: CsfloatListing[];
  cursor?: string;
}

/** One sale from GET /api/v1/history/{market_hash_name}/sales. */
interface CsfloatSale {
  id?: string;
  /** Integer USD cents. */
  price: number;
  /** ISO timestamp of the sale. */
  sold_at: string;
  item?: CsfloatListingItem;
}

function apiKey(): string | undefined {
  // REAL_KEY_REQUIRED — personal key from the CSFloat profile "Developers"
  // tab, supplied via the CSFLOAT_API_KEY env var. Never commit keys.
  return process.env.CSFLOAT_API_KEY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function searchUrl(marketHashName: string): string {
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(marketHashName)}`;
}

/**
 * GET with Authorization header and exponential backoff on 429.
 * Returns parsed JSON or null on any failure (never throws).
 */
async function getJson<T>(url: string): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: key, Accept: 'application/json' },
      });
      if (res.status === 429) {
        if (attempt >= BACKOFF_MS.length) {
          console.warn(`[csfloat] 429 rate limited, giving up: ${url}`);
          return null;
        }
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      if (!res.ok) {
        console.warn(`[csfloat] HTTP ${res.status} for ${url}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      console.warn(`[csfloat] request failed for ${url}:`, err);
      return null;
    }
  }
}

export const csfloatSource: PriceSource = {
  id: 'csfloat',
  displayName: DISPLAY_NAME,
  requiresApiKey: true,

  isConfigured(): boolean {
    return !!process.env.CSFLOAT_API_KEY && process.env.PRICE_SOURCE_MODE === 'live';
  },

  async getQuotes(marketHashNames: string[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();
    if (!this.isConfigured()) return result;
    // Sequential lookups with a small delay — CSFloat rate limits per key.
    for (let i = 0; i < marketHashNames.length; i++) {
      const name = marketHashNames[i];
      if (i > 0) await sleep(REQUEST_DELAY_MS);
      const url =
        `${BASE_URL}/listings?market_hash_name=${encodeURIComponent(name)}` +
        `&sort_by=lowest_price&limit=1`;
      const json = await getJson<CsfloatListingsResponse>(url);
      const listing = json && Array.isArray(json.data) ? json.data[0] : undefined;
      if (!listing || typeof listing.price !== 'number') continue; // unpriceable → absent
      result.set(name, {
        marketHashName: name,
        sourceId: 'csfloat',
        sourceDisplayName: DISPLAY_NAME,
        priceCents: Math.round(listing.price),
        currency: 'USD',
        // limit=1 gives no total count of active listings.
        listingsCount: null,
        url: searchUrl(name),
        fetchedAt: new Date().toISOString(),
      });
    }
    return result;
  },

  async getPriceHistory(marketHashName: string, days: number): Promise<PricePoint[]> {
    if (!this.isConfigured()) {
      // TODO(post-MVP): CSFloat exposes GET /api/v1/history/{name}/sales;
      // once a key is configured we map sales → daily points below. Without
      // a key there is nothing to fetch — the mock source covers history.
      return [];
    }
    const url = `${BASE_URL}/history/${encodeURIComponent(marketHashName)}/sales`;
    const sales = await getJson<CsfloatSale[]>(url);
    if (!sales || !Array.isArray(sales)) return [];
    // Best-effort daily aggregation: average sale price per UTC day.
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const sale of sales) {
      if (typeof sale.price !== 'number' || typeof sale.sold_at !== 'string') continue;
      const day = sale.sold_at.slice(0, 10);
      const agg = byDay.get(day) ?? { sum: 0, n: 0 };
      agg.sum += sale.price;
      agg.n += 1;
      byDay.set(day, agg);
    }
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return [...byDay.entries()]
      .filter(([day]) => day >= cutoff)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, agg]) => ({ day, priceCents: Math.max(1, Math.round(agg.sum / agg.n)) }));
  },
};
