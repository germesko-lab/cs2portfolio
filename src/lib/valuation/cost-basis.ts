/**
 * Stream C — thin CRUD over the `cost_basis` table (hybrid cost basis,
 * see DECISIONS.md). One row per asset; source is 'auto' or 'manual'.
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

export function upsertCostBasis(assetId: string, basis: CostBasis): void {
  db.prepare(
    `INSERT INTO cost_basis (asset_id, amount_cents, currency, source, acquired_at, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(asset_id) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       currency     = excluded.currency,
       source       = excluded.source,
       acquired_at  = excluded.acquired_at,
       updated_at   = excluded.updated_at`,
  ).run(assetId, basis.amountCents, basis.currency, basis.source, basis.acquiredAt);
}

export function deleteCostBasis(assetId: string): void {
  db.prepare('DELETE FROM cost_basis WHERE asset_id = ?').run(assetId);
}

export function getCostBasis(assetId: string): CostBasis | null {
  const row = db
    .prepare(
      'SELECT asset_id, amount_cents, currency, source, acquired_at FROM cost_basis WHERE asset_id = ?',
    )
    .get(assetId) as CostBasisRow | undefined;
  return row ? rowToCostBasis(row) : null;
}

export function getAllCostBasis(): Map<string, CostBasis> {
  const rows = db
    .prepare('SELECT asset_id, amount_cents, currency, source, acquired_at FROM cost_basis')
    .all() as CostBasisRow[];
  const map = new Map<string, CostBasis>();
  for (const row of rows) map.set(row.asset_id, rowToCostBasis(row));
  return map;
}
