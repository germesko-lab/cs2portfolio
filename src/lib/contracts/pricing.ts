/**
 * FROZEN CONTRACT — PriceSource adapter interface & quote shapes.
 * Stream B implements adapters (csfloat, csgoskins, mock) against this file.
 * The orchestrator owns this file; contracts win over implementation drift.
 */
import type { Cents, Currency, IsoDay, IsoTimestamp } from './types';

/** Stable identifiers for the sources shipped in MVP. */
export type PriceSourceId = 'csfloat' | 'csgoskins' | 'skinport' | 'mock';

/** A single price observation for one item on one marketplace/source. */
export interface PriceQuote {
  marketHashName: string;
  sourceId: PriceSourceId;
  sourceDisplayName: string; // e.g. "CSFloat"
  /**
   * Representative sell price in cents: the lowest current listing on that
   * source (what the item realistically fetches there right now).
   */
  priceCents: Cents;
  currency: Currency;
  /** Number of active listings backing the quote, when the source reports it. */
  listingsCount: number | null;
  /** Deep link to the item's page/listings on the source, or null. */
  url: string | null;
  fetchedAt: IsoTimestamp;
}

/** One point of an item's daily price history on a source. */
export interface PricePoint {
  day: IsoDay;
  priceCents: Cents;
}

/**
 * Adapter interface every price source implements.
 * Adapters must NEVER throw for missing keys or unpriceable items — return
 * empty results and let the aggregator degrade gracefully.
 */
export interface PriceSource {
  readonly id: PriceSourceId;
  readonly displayName: string;
  readonly requiresApiKey: boolean;
  /** False when a required key is absent — aggregator skips the source. */
  isConfigured(): boolean;
  /**
   * Batch quote lookup. Returns a map keyed by marketHashName; items the
   * source can't price are simply absent from the map.
   */
  getQuotes(marketHashNames: string[]): Promise<Map<string, PriceQuote>>;
  /**
   * Daily price history for one item, oldest→newest, up to `days` points.
   * Sources without history support return [].
   */
  getPriceHistory(marketHashName: string, days: number): Promise<PricePoint[]>;
}

/**
 * Cross-source result for one item. `best` is the selected display quote:
 * SkinSGG/csgoskins when available, otherwise the best available fallback.
 * `quotes` = every source's quote for the per-source breakdown UI.
 */
export interface BestPrice {
  marketHashName: string;
  best: PriceQuote;
  quotes: PriceQuote[];
}

/** Freshness of the price used for a valuation. */
export type PriceStatus = 'live' | 'cached' | 'missing';

/**
 * Aggregator surface (stream B, src/lib/prices/index.ts must export an
 * object satisfying this — name it `priceService`).
 */
export interface PriceService {
  /** All registered sources, configured or not (for status UI). */
  sources(): Array<{
    id: PriceSourceId;
    displayName: string;
    configured: boolean;
    requiresApiKey: boolean;
  }>;
  /**
   * Best price per item. Serves fresh quotes when possible, falls back to
   * SQLite-cached quotes (marking staleness via fetchedAt), omits items no
   * source can price.
   */
  getBestPrices(marketHashNames: string[]): Promise<Map<string, BestPrice>>;
  /**
   * Force-refresh quotes for the given items into the cache.
   * Returns count of quotes updated per source.
   */
  refresh(marketHashNames: string[]): Promise<Record<string, number>>;
  /** Daily history (best-source) for one item, oldest→newest. */
  getPriceHistory(marketHashName: string, days: number): Promise<PricePoint[]>;
}
