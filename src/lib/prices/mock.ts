/**
 * Mock price source — deterministic, offline, always configured.
 *
 * Prices exactly the marketHashNames in the frozen MOCK_UNIVERSE contract;
 * any other name gets no quote (exercising the missing-data path downstream).
 *
 * Determinism: every price is a pure function of (marketHashName, UTC day).
 * The per-name seed is a hash of the name, so two processes (or two runs on
 * the same day) always produce identical prices and histories. No
 * Math.random anywhere.
 *
 * Shape of the series: a 120-day daily "walk" around anchorPriceCents built
 * from a per-name long-period "trend" wave plus three shorter seeded sine
 * waves, clamped to a ±20% band — mild enough to look like market drift,
 * varied enough that some items are up and some down vs 30/90 days ago.
 */
import type { PricePoint, PriceQuote, PriceSource } from '../contracts/pricing';
import { MOCK_UNIVERSE_BY_NAME } from '../contracts/mock-universe';

const HISTORY_DAYS = 120;
const MS_PER_DAY = 86_400_000;

/** FNV-1a 32-bit hash — stable across processes. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG, returns values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WaveParam {
  amplitude: number; // fraction of anchor
  periodDays: number;
  phase: number; // radians
}

interface NameParams {
  waves: WaveParam[];
  /** Deterministic 3–60 listings. */
  listingsCount: number;
}

const paramsCache = new Map<string, NameParams>();

function paramsFor(marketHashName: string): NameParams {
  const cached = paramsCache.get(marketHashName);
  if (cached) return cached;
  const rand = mulberry32(fnv1a(marketHashName));
  const params: NameParams = {
    waves: [
      // Long-period "trend" wave: locally (over 30/90/120 days) it reads as
      // a mild up- or down-trend whose direction varies per item, yet it is
      // bounded, so prices stay inside the ±20% band without hard clamping.
      { amplitude: 0.06 + rand() * 0.06, periodDays: 240 + rand() * 240, phase: rand() * Math.PI * 2 },
      // Shorter chop.
      { amplitude: 0.02 + rand() * 0.02, periodDays: 6 + rand() * 8, phase: rand() * Math.PI * 2 },
      { amplitude: 0.02 + rand() * 0.03, periodDays: 16 + rand() * 16, phase: rand() * Math.PI * 2 },
      { amplitude: 0.03 + rand() * 0.03, periodDays: 40 + rand() * 32, phase: rand() * Math.PI * 2 },
    ],
    listingsCount: 3 + (fnv1a(`${marketHashName}::listings`) % 58),
  };
  paramsCache.set(marketHashName, params);
  return params;
}

/** Days since Unix epoch for "today" (UTC). */
function todayIndex(): number {
  return Math.floor(Date.now() / MS_PER_DAY);
}

function isoDay(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Pure deterministic price for one name on one absolute UTC day. */
function priceOn(marketHashName: string, anchorPriceCents: number, dayIndex: number): number {
  const p = paramsFor(marketHashName);
  let factor = 1;
  for (const w of p.waves) {
    factor += w.amplitude * Math.sin((2 * Math.PI * dayIndex) / w.periodDays + w.phase);
  }
  // Safety clamp to the ±20% band (only hit when all waves peak together).
  factor = Math.min(1.2, Math.max(0.8, factor));
  return Math.max(1, Math.round(anchorPriceCents * factor));
}

function deepLinkUrl(marketHashName: string): string {
  // Mock quotes deep-link to CSFloat search (labelled as mock data via
  // sourceDisplayName — the URL is just a convenient real destination).
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(marketHashName)}`;
}

export const mockSource: PriceSource = {
  id: 'mock',
  displayName: 'Mock Market Data',
  requiresApiKey: false,

  isConfigured(): boolean {
    // Only in explicit mock mode: real sources (Skinport keyless, CSFloat/
    // CSGOSKINS with keys) must never compete with fabricated prices.
    return process.env.PRICE_SOURCE_MODE === 'mock';
  },

  async getQuotes(marketHashNames: string[]): Promise<Map<string, PriceQuote>> {
    const today = todayIndex();
    const fetchedAt = new Date().toISOString();
    const result = new Map<string, PriceQuote>();
    for (const name of marketHashNames) {
      const entry = MOCK_UNIVERSE_BY_NAME.get(name);
      if (!entry) continue; // Not in the universe → no quote (missing-data path).
      const p = paramsFor(name);
      result.set(name, {
        marketHashName: name,
        sourceId: 'mock',
        sourceDisplayName: 'Mock Market Data',
        // Today's quote == last point of the deterministic history series.
        priceCents: priceOn(name, entry.anchorPriceCents, today),
        currency: 'USD',
        listingsCount: p.listingsCount,
        url: deepLinkUrl(name),
        fetchedAt,
      });
    }
    return result;
  },

  async getPriceHistory(marketHashName: string, days: number): Promise<PricePoint[]> {
    const entry = MOCK_UNIVERSE_BY_NAME.get(marketHashName);
    if (!entry || days <= 0) return [];
    const today = todayIndex();
    const span = Math.min(Math.max(1, Math.floor(days)), HISTORY_DAYS);
    const points: PricePoint[] = [];
    for (let d = today - (span - 1); d <= today; d++) {
      points.push({ day: isoDay(d), priceCents: priceOn(marketHashName, entry.anchorPriceCents, d) });
    }
    return points; // oldest → newest
  },
};
