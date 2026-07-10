/**
 * Stream C - daily portfolio value series over `portfolio_snapshots`.
 * One row per (user, UTC day); snapshots are idempotent per day.
 */
import { db } from '../db';
import type { SnapshotPoint } from '../contracts/types';

interface SnapshotRow {
  day: string;
  total_value_cents: number;
  invested_cents: number;
  captured_at: string | null;
  known_cost_basis_cents: number | null;
  unrealized_pnl_cents: number | null;
  realized_pnl_cents: number | null;
  item_count: number | null;
  no_price_item_count: number | null;
  missing_cost_basis_item_count: number | null;
  data_completeness_json: string | null;
}

export function clearSnapshots(userId: number): void {
  db.prepare('DELETE FROM portfolio_snapshots WHERE user_id = ?').run(userId);
}

export function upsertSnapshot(userId: number, point: SnapshotPoint): void {
  db.prepare(
    `INSERT INTO portfolio_snapshots (
       user_id, day, total_value_cents, invested_cents, captured_at,
       known_cost_basis_cents, unrealized_pnl_cents, realized_pnl_cents,
       item_count, no_price_item_count, missing_cost_basis_item_count,
       data_completeness_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       total_value_cents = excluded.total_value_cents,
       invested_cents    = excluded.invested_cents,
       captured_at       = excluded.captured_at,
       known_cost_basis_cents = excluded.known_cost_basis_cents,
       unrealized_pnl_cents = excluded.unrealized_pnl_cents,
       realized_pnl_cents = excluded.realized_pnl_cents,
       item_count = excluded.item_count,
       no_price_item_count = excluded.no_price_item_count,
       missing_cost_basis_item_count = excluded.missing_cost_basis_item_count,
       data_completeness_json = excluded.data_completeness_json`,
  ).run(
    userId,
    point.day,
    point.totalValueCents,
    point.investedCents,
    point.capturedAt ?? new Date().toISOString(),
    point.knownCostBasisCents ?? point.investedCents,
    point.unrealizedPnlCents ?? null,
    point.realizedPnlCents ?? null,
    point.itemCount ?? null,
    point.noPriceItemCount ?? null,
    point.missingCostBasisItemCount ?? null,
    JSON.stringify(point.dataCompleteness ?? {}),
  );
}

export function backfillSnapshots(userId: number, points: SnapshotPoint[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots (
       user_id, day, total_value_cents, invested_cents, captured_at,
       known_cost_basis_cents, unrealized_pnl_cents, realized_pnl_cents,
       item_count, no_price_item_count, missing_cost_basis_item_count,
       data_completeness_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((batch: SnapshotPoint[]) => {
    for (const point of batch)
      insert.run(
        userId,
        point.day,
        point.totalValueCents,
        point.investedCents,
        point.capturedAt ?? `${point.day}T00:00:00.000Z`,
        point.knownCostBasisCents ?? point.investedCents,
        point.unrealizedPnlCents ?? null,
        point.realizedPnlCents ?? null,
        point.itemCount ?? null,
        point.noPriceItemCount ?? null,
        point.missingCostBasisItemCount ?? null,
        JSON.stringify(point.dataCompleteness ?? {}),
      );
  });
  run(points);
}

export function getSnapshots(userId: number, days: number): SnapshotPoint[] {
  const rows = db
    .prepare(
      `SELECT day, total_value_cents, invested_cents, captured_at,
              known_cost_basis_cents, unrealized_pnl_cents, realized_pnl_cents,
              item_count, no_price_item_count, missing_cost_basis_item_count,
              data_completeness_json
       FROM portfolio_snapshots
       WHERE user_id = ?
       ORDER BY day DESC
       LIMIT ?`,
    )
    .all(userId, days) as SnapshotRow[];
  return rows
    .map((row) => ({
      day: row.day,
      totalValueCents: row.total_value_cents,
      investedCents: row.invested_cents,
      capturedAt: row.captured_at,
      knownCostBasisCents: row.known_cost_basis_cents,
      unrealizedPnlCents: row.unrealized_pnl_cents,
      realizedPnlCents: row.realized_pnl_cents,
      itemCount: row.item_count,
      noPriceItemCount: row.no_price_item_count,
      missingCostBasisItemCount: row.missing_cost_basis_item_count,
      dataCompleteness: parseCompleteness(row.data_completeness_json),
    }))
    .reverse();
}

function parseCompleteness(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
