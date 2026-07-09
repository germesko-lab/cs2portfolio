/**
 * Stream C - thin CRUD over the user-scoped `cost_basis` table.
 * One row per (user, asset); source is 'auto' or 'manual'.
 */
import { db } from '../db';
import type { CanonicalItem, CostBasis, CostBasisSource, Currency, IsoTimestamp } from '../contracts/types';

interface CostBasisRow {
  asset_id: string;
  item_key: string | null;
  amount_cents: number;
  currency: Currency;
  source: CostBasisSource;
  acquired_at: IsoTimestamp | null;
  updated_at?: IsoTimestamp;
}

function rowToCostBasis(row: CostBasisRow): CostBasis {
  return {
    amountCents: row.amount_cents,
    currency: row.currency,
    source: row.source,
    acquiredAt: row.acquired_at,
  };
}

export function costBasisItemKey(item: CanonicalItem): string {
  return [
    item.marketHashName,
    item.floatValue == null ? '' : item.floatValue.toFixed(8),
    item.paintSeed == null ? '' : String(item.paintSeed),
    item.statTrak ? '1' : '0',
    item.souvenir ? '1' : '0',
  ].join('|');
}

export function upsertCostBasis(
  userId: number,
  assetId: string,
  basis: CostBasis,
  itemKey: string | null = null,
): void {
  db.prepare(
    `INSERT INTO cost_basis (user_id, asset_id, item_key, amount_cents, currency, source, acquired_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id, asset_id) DO UPDATE SET
       item_key     = excluded.item_key,
       amount_cents = excluded.amount_cents,
       currency     = excluded.currency,
       source       = excluded.source,
       acquired_at  = excluded.acquired_at,
       updated_at   = excluded.updated_at`,
  ).run(userId, assetId, itemKey, basis.amountCents, basis.currency, basis.source, basis.acquiredAt);
}

export function deleteCostBasis(userId: number, assetId: string): void {
  db.prepare('DELETE FROM cost_basis WHERE user_id = ? AND asset_id = ?').run(userId, assetId);
}

export function getCostBasis(userId: number, assetId: string): CostBasis | null {
  const row = db
    .prepare(
      `SELECT asset_id, item_key, amount_cents, currency, source, acquired_at
       FROM cost_basis
       WHERE user_id = ? AND asset_id = ?`,
    )
    .get(userId, assetId) as CostBasisRow | undefined;
  return row ? rowToCostBasis(row) : null;
}

export function getAllCostBasis(userId: number): Map<string, CostBasis> {
  const rows = db
    .prepare(
      `SELECT asset_id, item_key, amount_cents, currency, source, acquired_at
       FROM cost_basis
       WHERE user_id = ?`,
    )
    .all(userId) as CostBasisRow[];
  const map = new Map<string, CostBasis>();
  for (const row of rows) map.set(row.asset_id, rowToCostBasis(row));
  return map;
}

export function getAllCostBasisForItems(userId: number, items: CanonicalItem[]): Map<string, CostBasis> {
  const rows = db
    .prepare(
      `SELECT asset_id, item_key, amount_cents, currency, source, acquired_at, updated_at
       FROM cost_basis
       WHERE user_id = ?
       ORDER BY CASE WHEN source = 'manual' THEN 1 ELSE 0 END DESC, updated_at DESC`,
    )
    .all(userId) as CostBasisRow[];

  const byAsset = new Map<string, CostBasisRow>();
  const byKey = new Map<string, CostBasisRow[]>();
  for (const row of rows) {
    byAsset.set(row.asset_id, row);
    if (row.item_key) {
      const bucket = byKey.get(row.item_key) ?? [];
      bucket.push(row);
      byKey.set(row.item_key, bucket);
    }
  }

  const usedAssets = new Set<string>();
  const resolved = new Map<string, CostBasis>();
  for (const item of items) {
    const direct = byAsset.get(item.assetId);
    if (direct) {
      usedAssets.add(direct.asset_id);
      resolved.set(item.assetId, rowToCostBasis(direct));
      continue;
    }

    const candidates = byKey.get(costBasisItemKey(item)) ?? [];
    const fallback = candidates.find((row) => !usedAssets.has(row.asset_id));
    if (fallback) {
      usedAssets.add(fallback.asset_id);
      resolved.set(item.assetId, rowToCostBasis(fallback));
    }
  }

  return resolved;
}
