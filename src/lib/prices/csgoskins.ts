/**
 * CSGOSKINS.GG aggregation adapter — cross-market price reference.
 *
 * Request/response shape below follows their official partner/business
 * Pricing API docs (JSON REST, aggregated prices across 40+ markets):
 *   POST https://api.csgoskins.gg/v1/prices
 *        Authorization: Bearer <CSGOSKINS_API_KEY>
 *        Body: { "market_hash_names": string[] }
 *   → entries with the item name, per-market prices and an aggregated
 *     min/max across markets.
 *
 * IMPORTANT (LEGAL.md): access to this API requires a commercial API
 * agreement with CSGOSKINS.GG — there is no free tier, and their terms
 * explicitly PROHIBIT scraping the website. This adapter therefore only
 * ever talks to the documented API, returns nothing unless a key is
 * configured, and the app degrades gracefully without it. Never scrape.
 *
 * Attribution: quotes carry sourceDisplayName 'CSGOSKINS.GG', shown on
 * every quote in the UI, satisfying attribution-style partner requirements.
 */
import type { PricePoint, PriceQuote, PriceSource } from '../contracts/pricing';

const PRICES_URL = 'https://api.csgoskins.gg/v1/prices';
const DISPLAY_NAME = 'CSGOSKINS.GG';
/** Backoff schedule for HTTP 429 responses. */
const BACKOFF_MS = [1_000, 3_000, 8_000];

/** One marketplace's price for an item (integer USD cents). */
interface CsgoSkinsMarketPrice {
  /** Marketplace identifier, e.g. "steam", "csfloat", "skinport". */
  market: string;
  /** Integer USD cents. */
  price: number;
  /** Deep link to the item on that marketplace, when provided. */
  url?: string | null;
  updated_at?: string;
}

/** Aggregation across all markets for one item (integer USD cents). */
interface CsgoSkinsAggregated {
  min: number;
  max: number;
  average?: number;
  /** Number of markets contributing to the aggregate. */
  markets?: number;
}

interface CsgoSkinsPriceEntry {
  market_hash_name: string;
  prices: CsgoSkinsMarketPrice[];
  aggregated: CsgoSkinsAggregated;
  updated_at?: string;
}

interface CsgoSkinsPricesResponse {
  data: CsgoSkinsPriceEntry[];
}

function apiKey(): string | undefined {
  // REAL_KEY_REQUIRED — commercial partner API key (CSGOSKINS_API_KEY env
  // var), obtainable only via a business agreement with CSGOSKINS.GG.
  return process.env.CSGOSKINS_API_KEY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single batched POST with Bearer auth and backoff on 429.
 * Returns parsed JSON or null on any failure (never throws).
 */
async function postPrices(names: string[]): Promise<CsgoSkinsPricesResponse | null> {
  const key = apiKey();
  if (!key) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(PRICES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ market_hash_names: names }),
      });
      if (res.status === 429) {
        if (attempt >= BACKOFF_MS.length) {
          console.warn('[csgoskins] 429 rate limited, giving up');
          return null;
        }
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      if (!res.ok) {
        console.warn(`[csgoskins] HTTP ${res.status} from prices endpoint`);
        return null;
      }
      return (await res.json()) as CsgoSkinsPricesResponse;
    } catch (err) {
      console.warn('[csgoskins] request failed:', err);
      return null;
    }
  }
}

export const csgoskinsSource: PriceSource = {
  id: 'csgoskins',
  displayName: DISPLAY_NAME,
  requiresApiKey: true,

  isConfigured(): boolean {
    // Key presence is the gate; only explicit mock mode disables it.
    return !!process.env.CSGOSKINS_API_KEY && process.env.PRICE_SOURCE_MODE !== 'mock';
  },

  async getQuotes(marketHashNames: string[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();
    if (!this.isConfigured() || marketHashNames.length === 0) return result;
    const json = await postPrices(marketHashNames);
    if (!json || !Array.isArray(json.data)) return result;
    const fetchedAt = new Date().toISOString();
    for (const entry of json.data) {
      if (!entry || typeof entry.market_hash_name !== 'string') continue;
      const min = entry.aggregated?.min;
      if (typeof min !== 'number' || min <= 0) continue; // unpriceable → absent
      result.set(entry.market_hash_name, {
        marketHashName: entry.market_hash_name,
        sourceId: 'csgoskins',
        sourceDisplayName: DISPLAY_NAME,
        // Per the PriceQuote contract, the representative sell price is the
        // lowest current listing on the source — for an aggregator that is
        // the aggregated minimum across markets.
        priceCents: Math.round(min),
        currency: 'USD',
        listingsCount: null, // aggregate API reports markets, not listings
        url: entry.prices?.find((p) => typeof p.url === 'string')?.url ?? null,
        fetchedAt,
      });
    }
    return result;
  },

  async getPriceHistory(_marketHashName: string, _days: number): Promise<PricePoint[]> {
    if (!this.isConfigured()) return [];
    // TODO(post-MVP): the partner Pricing API's historical endpoint is part
    // of the commercial agreement we don't have; until then history comes
    // from other sources (mock in MVP). Never scrape the site for it.
    return [];
  },
};
