/**
 * SQLite persistence for price quotes and daily price history.
 *
 * - `price_quotes`: latest quote per (market_hash_name, source_id) — the
 *   cache the aggregator falls back to when a source can't be reached
 *   (staleness is signalled downstream via fetchedAt).
 * - `price_history`: daily points per (market_hash_name, source_id, day).
 *
 * Schema: db/migrations/001_init.sql (frozen). better-sqlite3 is
 * synchronous; statements are prepared lazily so importing this module
 * never throws even if the db module is mid-migration.
 */
import { db } from '../db';
import type { PricePoint, PriceQuote, PriceSourceId } from '../contracts/pricing';
import type { Currency } from '../contracts/types';

interface QuoteRow {
  market_hash_name: string;
  source_id: string;
  price_cents: number;
  currency: string;
  listings_count: number | null;
  url: string | null;
  fetched_at: string;
}

interface HistoryRow {
  day: string;
  price_cents: number;
}

const MS_PER_DAY = 86_400_000;

function rowToQuote(row: QuoteRow): PriceQuote {
  return {
    marketHashName: row.market_hash_name,
    sourceId: row.source_id as PriceSourceId,
    sourceDisplayName: sourceDisplayName(row.source_id as PriceSourceId),
    priceCents: row.price_cents,
    currency: row.currency as Currency,
    listingsCount: row.listings_count,
    url: row.url,
    fetchedAt: row.fetched_at,
  };
}

function sourceDisplayName(id: PriceSourceId): string {
  switch (id) {
    case 'csfloat':
      return 'CSFloat';
    case 'csgoskins':
      return 'CSGOSKINS.GG';
    case 'skinport':
      return 'Skinport';
    case 'mock':
      return 'Mock Market Data';
  }
}

/** Upsert the latest quote per (name, source). No-op on empty input. */
export function upsertQuotes(quotes: PriceQuote[]): void {
  if (quotes.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO price_quotes
       (market_hash_name, source_id, price_cents, currency, listings_count, url, fetched_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success')
     ON CONFLICT(market_hash_name, source_id) DO UPDATE SET
       price_cents    = excluded.price_cents,
       currency       = excluded.currency,
       listings_count = excluded.listings_count,
       url            = excluded.url,
       fetched_at     = excluded.fetched_at,
       expires_at     = excluded.expires_at,
       status         = 'success',
       error_message  = NULL`,
  );
  const run = db.transaction((qs: PriceQuote[]) => {
    for (const q of qs) {
      stmt.run(
        q.marketHashName,
        q.sourceId,
        q.priceCents,
        q.currency,
        q.listingsCount,
        q.url,
        q.fetchedAt,
        quoteExpiresAt(q),
      );
    }
  });
  run(quotes);
}

function quoteExpiresAt(q: PriceQuote): string {
  const ttl =
    q.sourceId === 'csgoskins' || q.sourceId === 'csfloat' ? 30 * 60_000
    : q.sourceId === 'skinport' ? 10 * 60_000
    : 0;
  return new Date(Date.parse(q.fetchedAt) + ttl).toISOString();
}

/**
 * Latest cached quote per (name, source) for the given names — one row per
 * pair since the table's PK holds only the latest. Order is unspecified.
 */
export function getCachedQuotes(names: string[]): PriceQuote[] {
  if (names.length === 0) return [];
  const placeholders = names.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT market_hash_name, source_id, price_cents, currency, listings_count, url, fetched_at
       FROM price_quotes
       WHERE market_hash_name IN (${placeholders})`,
    )
    .all(...names) as QuoteRow[];
  return rows.map(rowToQuote);
}

/** Upsert daily history points for one (name, source). */
export function upsertHistory(
  marketHashName: string,
  sourceId: PriceSourceId,
  points: PricePoint[],
): void {
  if (points.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO price_history (market_hash_name, source_id, day, price_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(market_hash_name, source_id, day) DO UPDATE SET
       price_cents = excluded.price_cents`,
  );
  const run = db.transaction((pts: PricePoint[]) => {
    for (const p of pts) stmt.run(marketHashName, sourceId, p.day, p.priceCents);
  });
  run(points);
}

/**
 * Persisted daily history for one item over the last `days` days, oldest →
 * newest. Where multiple sources cover the same day, the HIGHEST price wins
 * (consistent with the best-price policy in DECISIONS.md).
 */
export function getHistory(marketHashName: string, days: number): PricePoint[] {
  if (days <= 0) return [];
  const cutoff = new Date(Date.now() - (Math.floor(days) - 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const rows = db
    .prepare(
      `SELECT day, MAX(price_cents) AS price_cents
       FROM price_history
       WHERE market_hash_name = ? AND day >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(marketHashName, cutoff) as HistoryRow[];
  return rows.map((r) => ({ day: r.day, priceCents: r.price_cents }));
}

export function recordPriceSourceStatus(
  sourceId: string,
  status: 'success' | 'failed' | 'skipped',
  errorMessage: string | null = null,
): void {
  db.prepare(
    `INSERT INTO price_source_status (source_id, status, checked_at, error_message)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       status = excluded.status,
       checked_at = excluded.checked_at,
       error_message = excluded.error_message`,
  ).run(sourceId, status, new Date().toISOString(), errorMessage);
}

export function getFailedPriceSources(): Array<{ source: string; message: string }> {
  const rows = db
    .prepare(
      `SELECT source_id, error_message
       FROM price_source_status
       WHERE status = 'failed'
       ORDER BY checked_at DESC`,
    )
    .all() as Array<{ source_id: string; error_message: string | null }>;
  return rows.map((row) => ({
    source: row.source_id,
    message: row.error_message ?? 'Price source failed.',
  }));
}
