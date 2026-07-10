import { db } from '../db';
import type { SyncStatus } from '../contracts/api';
import type { DataCompleteness } from '../contracts/valuation';
import { getFailedPriceSources } from '../prices/cache';

interface SyncStatusRow {
  last_inventory_sync_at: string | null;
  last_price_refresh_at: string | null;
  last_enrichment_refresh_at: string | null;
  failed_sources_json: string;
  missing_prices_count: number;
  missing_cost_basis_count: number;
  missing_enrichment_count: number;
  is_refreshing: number;
  last_error: string | null;
}

export function markRefreshing(userId: number, isRefreshing: boolean): void {
  db.prepare(
    `INSERT INTO portfolio_sync_status (user_id, is_refreshing, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id) DO UPDATE SET
       is_refreshing = excluded.is_refreshing,
       updated_at = excluded.updated_at`,
  ).run(userId, isRefreshing ? 1 : 0);
}

export function recordInventorySync(
  userId: number,
  syncedAt: string,
  completeness: DataCompleteness,
): void {
  upsertStatus(userId, {
    last_inventory_sync_at: syncedAt,
    missing_prices_count: completeness.priceMissingCount,
    missing_cost_basis_count: completeness.costBasisMissingCount,
    missing_enrichment_count: completeness.enrichmentMissingCount,
    is_refreshing: 0,
    last_error: null,
  });
}

export function recordPriceRefresh(userId: number, refreshedAt: string, completeness: DataCompleteness): void {
  upsertStatus(userId, {
    last_price_refresh_at: refreshedAt,
    missing_prices_count: completeness.priceMissingCount,
    missing_cost_basis_count: completeness.costBasisMissingCount,
    missing_enrichment_count: completeness.enrichmentMissingCount,
    is_refreshing: 0,
    last_error: null,
  });
}

export function recordPortfolioError(userId: number, message: string): void {
  upsertStatus(userId, {
    is_refreshing: 0,
    last_error: message,
  });
}

export function recordCompleteness(userId: number, completeness: DataCompleteness): void {
  upsertStatus(userId, {
    missing_prices_count: completeness.priceMissingCount,
    missing_cost_basis_count: completeness.costBasisMissingCount,
    missing_enrichment_count: completeness.enrichmentMissingCount,
  });
}

export function getSyncStatus(userId: number): SyncStatus {
  const row = db
    .prepare(
      `SELECT last_inventory_sync_at, last_price_refresh_at, last_enrichment_refresh_at,
              failed_sources_json, missing_prices_count, missing_cost_basis_count,
              missing_enrichment_count, is_refreshing, last_error
       FROM portfolio_sync_status
       WHERE user_id = ?`,
    )
    .get(userId) as SyncStatusRow | undefined;
  const failedSources = [...parseFailedSources(row?.failed_sources_json), ...getFailedPriceSources()];
  const missingPricesCount = row?.missing_prices_count ?? 0;
  const lastError = row?.last_error ?? null;
  return {
    lastInventorySyncAt: row?.last_inventory_sync_at ?? null,
    lastPriceRefreshAt: row?.last_price_refresh_at ?? null,
    lastEnrichmentRefreshAt: row?.last_enrichment_refresh_at ?? null,
    failedSources,
    missingPricesCount,
    missingCostBasisCount: row?.missing_cost_basis_count ?? 0,
    missingEnrichmentCount: row?.missing_enrichment_count ?? 0,
    isRefreshing: row?.is_refreshing === 1,
    lastError,
    freshness:
      lastError || failedSources.length > 0 ? 'failed'
      : !row?.last_inventory_sync_at ? 'empty'
      : missingPricesCount > 0 ? 'partial'
      : isStale(row.last_inventory_sync_at) ? 'stale'
      : 'fresh',
  };
}

function upsertStatus(userId: number, patch: Partial<SyncStatusRow>): void {
  const current = db
    .prepare('SELECT * FROM portfolio_sync_status WHERE user_id = ?')
    .get(userId) as SyncStatusRow | undefined;
  const next = {
    last_inventory_sync_at: patch.last_inventory_sync_at ?? current?.last_inventory_sync_at ?? null,
    last_price_refresh_at: patch.last_price_refresh_at ?? current?.last_price_refresh_at ?? null,
    last_enrichment_refresh_at: patch.last_enrichment_refresh_at ?? current?.last_enrichment_refresh_at ?? null,
    failed_sources_json: patch.failed_sources_json ?? current?.failed_sources_json ?? '[]',
    missing_prices_count: patch.missing_prices_count ?? current?.missing_prices_count ?? 0,
    missing_cost_basis_count: patch.missing_cost_basis_count ?? current?.missing_cost_basis_count ?? 0,
    missing_enrichment_count: patch.missing_enrichment_count ?? current?.missing_enrichment_count ?? 0,
    is_refreshing: patch.is_refreshing ?? current?.is_refreshing ?? 0,
    last_error: patch.last_error === undefined ? current?.last_error ?? null : patch.last_error,
  };
  db.prepare(
    `INSERT INTO portfolio_sync_status (
       user_id, last_inventory_sync_at, last_price_refresh_at,
       last_enrichment_refresh_at, failed_sources_json, missing_prices_count,
       missing_cost_basis_count, missing_enrichment_count, is_refreshing,
       last_error, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id) DO UPDATE SET
       last_inventory_sync_at = excluded.last_inventory_sync_at,
       last_price_refresh_at = excluded.last_price_refresh_at,
       last_enrichment_refresh_at = excluded.last_enrichment_refresh_at,
       failed_sources_json = excluded.failed_sources_json,
       missing_prices_count = excluded.missing_prices_count,
       missing_cost_basis_count = excluded.missing_cost_basis_count,
       missing_enrichment_count = excluded.missing_enrichment_count,
       is_refreshing = excluded.is_refreshing,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    next.last_inventory_sync_at,
    next.last_price_refresh_at,
    next.last_enrichment_refresh_at,
    next.failed_sources_json,
    next.missing_prices_count,
    next.missing_cost_basis_count,
    next.missing_enrichment_count,
    next.is_refreshing,
    next.last_error,
  );
}

function parseFailedSources(raw: string | undefined): Array<{ source: string; message: string }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<{ source: string; message: string }>) : [];
  } catch {
    return [];
  }
}

function isStale(ts: string): boolean {
  const time = Date.parse(ts);
  return Number.isFinite(time) && Date.now() - time > 24 * 60 * 60_000;
}
