/**
 * Stream C — daily portfolio value series over `portfolio_snapshots`.
 * One row per UTC day; snapshots are idempotent per day (DECISIONS.md).
 */
import { db } from '../db';
import type { SnapshotPoint } from '../contracts/types';

interface SnapshotRow {
  day: string;
  total_value_cents: number;
  invested_cents: number;
}

/** Wipe the whole series — used when the tracked account changes. */
export function clearSnapshots(): void {
  db.prepare('DELETE FROM portfolio_snapshots').run();
}

/**
 * Idempotent per-day upsert: re-snapshotting the same day overwrites that
 * day's values, never creates a second row.
 */
export function upsertSnapshot(point: SnapshotPoint): void {
  db.prepare(
    `INSERT INTO portfolio_snapshots (day, total_value_cents, invested_cents)
     VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       total_value_cents = excluded.total_value_cents,
       invested_cents    = excluded.invested_cents`,
  ).run(point.day, point.totalValueCents, point.investedCents);
}

/**
 * Bulk backfill in a single transaction. Existing days are left untouched —
 * backfill never overwrites real recorded history.
 */
export function backfillSnapshots(points: SnapshotPoint[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots (day, total_value_cents, invested_cents)
     VALUES (?, ?, ?)`,
  );
  const run = db.transaction((batch: SnapshotPoint[]) => {
    for (const point of batch) {
      insert.run(point.day, point.totalValueCents, point.investedCents);
    }
  });
  run(points);
}

/** Last `days` snapshot points, ascending by day. */
export function getSnapshots(days: number): SnapshotPoint[] {
  const rows = db
    .prepare(
      `SELECT day, total_value_cents, invested_cents
       FROM portfolio_snapshots
       ORDER BY day DESC
       LIMIT ?`,
    )
    .all(days) as SnapshotRow[];
  return rows
    .map((row) => ({
      day: row.day,
      totalValueCents: row.total_value_cents,
      investedCents: row.invested_cents,
    }))
    .reverse();
}
