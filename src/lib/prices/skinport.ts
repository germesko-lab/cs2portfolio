/**
 * Skinport adapter — real marketplace prices with NO API key.
 *
 * Official public API (docs.skinport.com): GET /v1/items?app_id=730&
 * currency=USD returns the full CS2 item catalog with current min/median/
 * suggested prices. It is rate-limited (documented at 8 requests per
 * 5 minutes), so the adapter fetches the WHOLE catalog at most once per
 * CATALOG_TTL_MS, keeps it in memory (globalThis survives dev reloads),
 * serves every quote lookup from that snapshot, and on HTTP 429 backs off
 * and serves the stale catalog instead of hammering the API. No scraping —
 * this is their documented public endpoint. See LEGAL.md.
 *
 * No key required ⇒ no REAL_KEY_REQUIRED marker: this source is what makes
 * real prices work out of the box.
 */
import type { PricePoint, PriceQuote, PriceSource } from '../contracts/pricing';

const DISPLAY_NAME = 'Skinport';
/** Overridable for tests/proxies; defaults to the real Skinport API host. */
const BASE_URL = process.env.SKINPORT_BASE_URL ?? 'https://api.skinport.com';
const APP_ID = 730;
const CATALOG_TTL_MS = 10 * 60_000; // well inside 8 req / 5 min
const COOLDOWN_MS = 5 * 60_000; // after a 429
const REQUEST_TIMEOUT_MS = 30_000; // the catalog payload is several MB

/** Documented /v1/items entry shape (prices are decimal in the requested currency, or null). */
interface SkinportItem {
  market_hash_name: string;
  currency: string;
  suggested_price: number | null;
  item_page: string;
  market_page: string;
  min_price: number | null;
  max_price: number | null;
  mean_price: number | null;
  median_price: number | null;
  quantity: number;
  created_at: number;
  updated_at: number;
}

interface CatalogState {
  byName: Map<string, SkinportItem>;
  fetchedAt: number;
}

declare global {
  var __cs2Skinport: { catalog: CatalogState | null; cooldownUntil: number } | undefined;
}
const state = globalThis.__cs2Skinport ?? (globalThis.__cs2Skinport = { catalog: null, cooldownUntil: 0 });

async function loadCatalog(): Promise<CatalogState | null> {
  const now = Date.now();
  if (state.catalog && now - state.catalog.fetchedAt <= CATALOG_TTL_MS) return state.catalog;
  if (now < state.cooldownUntil) return state.catalog; // stale-or-null during backoff

  try {
    const res = await fetch(`${BASE_URL}/v1/items?app_id=${APP_ID}&currency=USD`, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'br, gzip' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      state.cooldownUntil = now + COOLDOWN_MS;
      console.warn('[skinport] rate-limited (429); serving stale catalog for 5 min');
      return state.catalog;
    }
    if (!res.ok) {
      console.warn(`[skinport] catalog request failed: HTTP ${res.status}`);
      return state.catalog;
    }
    const items = (await res.json()) as SkinportItem[];
    if (!Array.isArray(items)) {
      console.warn('[skinport] unexpected catalog payload shape');
      return state.catalog;
    }
    const byName = new Map<string, SkinportItem>();
    for (const item of items) {
      if (item && typeof item.market_hash_name === 'string') byName.set(item.market_hash_name, item);
    }
    state.catalog = { byName, fetchedAt: now };
    return state.catalog;
  } catch (err) {
    console.warn('[skinport] catalog fetch failed:', err instanceof Error ? err.message : err);
    return state.catalog; // graceful: stale catalog or null
  }
}

/** Lowest current listing, falling back to median/suggested; null ⇒ unpriceable. */
function priceCentsOf(item: SkinportItem): number | null {
  const dollars = item.min_price ?? item.median_price ?? item.suggested_price;
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

export const skinportSource: PriceSource = {
  id: 'skinport',
  displayName: DISPLAY_NAME,
  requiresApiKey: false,

  isConfigured(): boolean {
    // Active in every mode except explicit mock (offline/demo determinism).
    return (process.env.PRICE_SOURCE_MODE ?? 'auto') !== 'mock';
  },

  async getQuotes(marketHashNames: string[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();
    if (!this.isConfigured() || marketHashNames.length === 0) return result;
    const catalog = await loadCatalog();
    if (!catalog) return result;

    const fetchedAt = new Date(catalog.fetchedAt).toISOString();
    for (const name of marketHashNames) {
      const item = catalog.byName.get(name);
      if (!item) continue; // not sold on Skinport (untradable coins/medals etc.)
      const priceCents = priceCentsOf(item);
      if (priceCents === null) continue;
      result.set(name, {
        marketHashName: name,
        sourceId: 'skinport',
        sourceDisplayName: DISPLAY_NAME,
        priceCents,
        currency: 'USD',
        listingsCount: typeof item.quantity === 'number' ? item.quantity : null,
        url: item.market_page || item.item_page || null,
        fetchedAt,
      });
    }
    return result;
  },

  async getPriceHistory(): Promise<PricePoint[]> {
    // The public API exposes aggregated sales windows, not a daily series —
    // portfolio history builds forward from daily snapshots instead.
    return [];
  },
};
