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
 * - Modes: default ('auto') = real sources — Skinport needs no key, CSFloat/
 *   CSGOSKINS activate when their keys are set. PRICE_SOURCE_MODE=mock =
 *   deterministic mock only (offline demo/tests); real and mock sources are
 *   never active together, so fabricated prices can't win a best-price race.
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
import { skinportSource } from './skinport';
import { mockSource } from './mock';
import { getCachedQuotes, getHistory, upsertHistory, upsertQuotes } from './cache';

/** Registration order = tie-break order when two sources quote equal cents. */
const SOURCES: readonly PriceSource[] = [csfloatSource, csgoskinsSource, skinportSource, mockSource];

/** How many days of history to pull from a source when backfilling. */
const HISTORY_BACKFILL_DAYS = 120;

/**
 * Per-source quote freshness: a cached quote younger than this satisfies a
 * getBestPrices lookup without hitting the source again. Per-request sources
 * (CSFloat: one HTTP call per item) get a long window so a dashboard load
 * never fires N upstream requests; catalog/deterministic sources are free to
 * serve every time (their own layers already cache).
 */
const QUOTE_TTL_MS: Record<string, number> = {
  csfloat: 30 * 60_000,
  csgoskins: 30 * 60_000,
  skinport: 0,
  mock: 0,
};

/** Cap on per-name history backfills per source within one refresh call. */
const HISTORY_BACKFILL_CAP = 30;

function quoteAgeMs(q: PriceQuote): number {
  const t = Date.parse(q.fetchedAt);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

/**
 * Negative-result cache: names a source answered "no listings" for are not
 * re-asked within the TTL (untradable coins/medals would otherwise cost one
 * upstream request per source on EVERY dashboard load). In-memory; explicit
 * refresh() bypasses it. Keyed "sourceId name".
 */
declare global {
  var __cs2QuoteMisses: Map<string, number> | undefined;
}
const quoteMisses: Map<string, number> =
  globalThis.__cs2QuoteMisses ?? (globalThis.__cs2QuoteMisses = new Map());
const MISS_TTL_MS = 30 * 60_000;

function isRecentMiss(sourceId: string, name: string): boolean {
  const ts = quoteMisses.get(`${sourceId} ${name}`);
  return ts !== undefined && Date.now() - ts <= MISS_TTL_MS;
}

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

    // 1. Cache first: one row per (name, source). A row younger than its
    //    source's TTL satisfies the lookup — a dashboard load must never
    //    fire N per-item requests at a keyed source (CSFloat).
    const cachedBySourceName = new Map<string, PriceQuote>(); // "source name"
    try {
      for (const q of getCachedQuotes(names)) {
        cachedBySourceName.set(`${q.sourceId} ${q.marketHashName}`, q);
      }
    } catch (err) {
      console.warn('[prices] quote cache read failed:', err);
    }

    // 2. Ask each configured source only for names it has no fresh row for.
    const fresh: PriceQuote[] = [];
    for (const source of configuredSources()) {
      const ttl = QUOTE_TTL_MS[source.id] ?? 0;
      const needed = names.filter((n) => {
        if (isRecentMiss(source.id, n)) return false;
        const cached = cachedBySourceName.get(`${source.id} ${n}`);
        return !cached || quoteAgeMs(cached) > ttl;
      });
      if (needed.length === 0) continue;
      try {
        const quotes = await source.getQuotes(needed);
        for (const name of needed) {
          const q = quotes.get(name);
          if (q) {
            fresh.push(q);
            cachedBySourceName.set(`${q.sourceId} ${q.marketHashName}`, q);
            quoteMisses.delete(`${source.id} ${name}`);
          } else {
            quoteMisses.set(`${source.id} ${name}`, Date.now());
          }
        }
      } catch (err) {
        console.warn(`[prices] source ${source.id} getQuotes failed:`, err);
      }
    }

    // 3. Persist what was actually fetched.
    try {
      upsertQuotes(fresh);
    } catch (err) {
      console.warn('[prices] failed to upsert quote cache:', err);
    }

    // 4. Merge (fresh replaced their cached rows in the map already); stale
    //    cached rows still count — their older fetchedAt marks them
    //    'cached' downstream. Best = highest; unpriceable names omitted.
    const quotesByName = new Map<string, PriceQuote[]>();
    for (const q of cachedBySourceName.values()) {
      const list = quotesByName.get(q.marketHashName) ?? [];
      list.push(q);
      quotesByName.set(q.marketHashName, list);
    }
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
      // Explicit refresh bypasses (and resets) the negative-result cache.
      for (const name of names) quoteMisses.delete(`${source.id} ${name}`);
      try {
        const quotes = await source.getQuotes(names);
        const list = [...quotes.values()];
        upsertQuotes(list);
        counts[source.id] = list.length;
        // Best-effort history backfill, capped and only for names with no
        // persisted history yet — per-name sources (CSFloat) charge one
        // request per item, and refresh must stay a bounded action.
        let backfilled = 0;
        for (const name of quotes.keys()) {
          if (backfilled >= HISTORY_BACKFILL_CAP) break;
          try {
            if (getHistory(name, HISTORY_BACKFILL_DAYS).length > 0) continue;
            const points = await source.getPriceHistory(name, HISTORY_BACKFILL_DAYS);
            if (points.length > 0) {
              upsertHistory(name, source.id, points);
              backfilled++;
            }
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
