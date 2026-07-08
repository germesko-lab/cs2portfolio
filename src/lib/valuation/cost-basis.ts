/**
 * Stream C - thin CRUD over the user-scoped `cost_basis` table.
 * One row per (user, asset); source is 'auto' or 'manual'.
 */
import { db } from '../db';
import type { CostBasis, CostBasisSource, Currency, IsoTimestamp } from '../contracts/types';

interface CostBasisRow {
  asset_id: string;
  amount_cents: number;
  currency: Currency;
  source: CostBasisSource;
  acquired_at: IsoTimestamp | null;
}

function rowToCostBasis(row: CostBasisRow): CostBasis {
  return {
    amountCents: row.amount_cents,
    currency: row.currency,
    source: row.source,
    acquiredAt: row.acquired_at,
  };
}

export function upsertCostBasis(userId: number, assetId: string, basis: CostBasis): void {
  db.prepare(
    `INSERT INTO cost_basis (user_id, asset_id, amount_cents, currency, source, acquired_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id, asset_id) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       currency     = excluded.currency,
       source       = excluded.source,
       acquired_at  = excluded.acquired_at,
       updated_at   = excluded.updated_at`,
  ).run(userId, assetId, basis.amountCents, basis.currency, basis.source, basis.acquiredAt);
}

export function deleteCostBasis(userId: number, assetId: string): void {
  db.prepare('DELETE FROM cost_basis WHERE user_id = ? AND asset_id = ?').run(userId, assetId);
}

export function getCostBasis(userId: number, assetId: string): CostBasis | null {
  const row = db
    .prepare(
      `SELECT asset_id, amount_cents, currency, source, acquired_at
       FROM cost_basis
       WHERE user_id = ? AND asset_id = ?`,
    )
    .get(userId, assetId) as CostBasisRow | undefined;
  return row ? rowToCostBasis(row) : null;
}

export function getAllCostBasis(userId: number): Map<string, CostBasis> {
  const rows = db
    .prepare(
      `SELECT asset_id, amount_cents, currency, source, acquired_at
       FROM cost_basis
       WHERE user_id = ?`,
    )
    .all(userId) as CostBasisRow[];
  const map = new Map<string, CostBasis>();
  for (const row of rows) map.set(row.asset_id, rowToCostBasis(row));
  return map;
}
