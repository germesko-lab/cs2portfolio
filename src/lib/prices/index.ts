/**
 * Price aggregator — the PriceService the rest of the app talks to.
 *
 * Policy (DECISIONS.md):
 * - "Best price" = the HIGHEST quote across configured sources (what the
 *   holder could sell for).
 * - Graceful degradation everywhere: source failures fall back to the
 *   SQLite quote cache (older fetchedAt signals staleness downstream);
 *   items nothing can price are simply omitted. Nothing here throws to
 *   callers.
 * - With no API keys (default PRICE_SOURCE_MODE=mock) the deterministic
 *   mock source is the only configured one, so the app always works.
 */
import type {
  BestPrice,
  PricePoint,
  PriceQuote,
  PriceService,
  PriceSource,
} from '../contracts/pricing';
import { csfloatSource } from './csfloat';
import { csgoskinsSource } from './csgoskins';
import { mockSource } from './mock';
import { getCachedQuotes, getHistory, upsertHistory, upsertQuotes } from './cache';

/** Registration order = tie-break order when two sources quote equal cents. */
const SOURCES: readonly PriceSource[] = [csfloatSource, csgoskinsSource, mockSource];

/** How many days of history to pull from a source when backfilling. */
const HISTORY_BACKFILL_DAYS = 120;

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}

function highest(quotes: PriceQuote[]): PriceQuote {
  let best = quotes[0];
  for (const q of quotes) if (q.priceCents > best.priceCents) best = q;
  return best;
}

function configuredSources(): PriceSource[] {
  return SOURCES.filter((s) => {
    try {
      return s.isConfigured();
    } catch {
      return false;
    }
  });
}

export const priceService: PriceService = {
  sources() {
    return SOURCES.map((s) => {
      let configured = false;
      try {
        configured = s.isConfigured();
      } catch {
        configured = false;
      }
      return {
        id: s.id,
        displayName: s.displayName,
        configured,
        requiresApiKey: s.requiresApiKey,
      };
    });
  },

  async getBestPrices(marketHashNames: string[]): Promise<Map<string, BestPrice>> {
    const names = dedupe(marketHashNames);
    if (names.length === 0) return new Map();

    // 1. Fresh quotes from every configured source (adapters never throw,
    //    but guard anyway — a broken source must not sink the rest).
    const quotesByName = new Map<string, PriceQuote[]>();
    const fresh: PriceQuote[] = [];
    for (const source of configuredSources()) {
      try {
        const quotes = await source.getQuotes(names);
        for (const q of quotes.values()) {
          fresh.push(q);
          const list = quotesByName.get(q.marketHashName) ?? [];
          list.push(q);
          quotesByName.set(q.marketHashName, list);
        }
      } catch (err) {
        console.warn(`[prices] source ${source.id} getQuotes failed:`, err);
      }
    }

    // 2. Persist fresh quotes into the cache.
    try {
      upsertQuotes(fresh);
    } catch (err) {
      console.warn('[prices] failed to upsert quote cache:', err);
    }

    // 3. Names with no fresh quote fall back to cached rows; their older
    //    fetchedAt marks them stale downstream (priceStatus: 'cached').
    const missing = names.filter((n) => !quotesByName.has(n));
    if (missing.length > 0) {
      try {
        for (const q of getCachedQuotes(missing)) {
          const list = quotesByName.get(q.marketHashName) ?? [];
          list.push(q);
          quotesByName.set(q.marketHashName, list);
        }
      } catch (err) {
        console.warn('[prices] quote cache read failed:', err);
      }
    }

    // 4. Best = highest quote across sources; unpriceable names omitted.
    const result = new Map<string, BestPrice>();
    for (const name of names) {
      const quotes = quotesByName.get(name);
      if (!quotes || quotes.length === 0) continue;
      result.set(name, { marketHashName: name, best: highest(quotes), quotes });
    }
    return result;
  },

  async refresh(marketHashNames: string[]): Promise<Record<string, number>> {
    const names = dedupe(marketHashNames);
    const counts: Record<string, number> = {};
    for (const source of configuredSources()) {
      counts[source.id] = 0;
      if (names.length === 0) continue;
      try {
        const quotes = await source.getQuotes(names);
        const list = [...quotes.values()];
        upsertQuotes(list);
        counts[source.id] = list.length;
        // Best-effort history backfill for the items this source priced.
        for (const name of quotes.keys()) {
          try {
            const points = await source.getPriceHistory(name, HISTORY_BACKFILL_DAYS);
            if (points.length > 0) upsertHistory(name, source.id, points);
          } catch (err) {
            console.warn(`[prices] history backfill failed (${source.id}/${name}):`, err);
          }
        }
      } catch (err) {
        console.warn(`[prices] refresh via ${source.id} failed:`, err);
      }
    }
    return counts;
  },

  async getPriceHistory(marketHashName: string, days: number): Promise<PricePoint[]> {
    // Prefer persisted history.
    try {
      const persisted = getHistory(marketHashName, days);
      if (persisted.length > 0) return persisted;
    } catch (err) {
      console.warn('[prices] history read failed:', err);
    }
    // Else ask configured sources (mock always has history); persist what we
    // fetch so subsequent reads are served from SQLite.
    for (const source of configuredSources()) {
      try {
        const points = await source.getPriceHistory(
          marketHashName,
          Math.max(days, HISTORY_BACKFILL_DAYS),
        );
        if (points.length === 0) continue;
        try {
          upsertHistory(marketHashName, source.id, points);
        } catch (err) {
          console.warn('[prices] history persist failed:', err);
        }
        return points.slice(-Math.max(1, Math.floor(days)));
      } catch (err) {
        console.warn(`[prices] source ${source.id} history failed:`, err);
      }
    }
    return [];
  },
};
