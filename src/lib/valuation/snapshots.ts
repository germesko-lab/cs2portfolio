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
}

export function clearSnapshots(userId: number): void {
  db.prepare('DELETE FROM portfolio_snapshots WHERE user_id = ?').run(userId);
}

export function upsertSnapshot(userId: number, point: SnapshotPoint): void {
  db.prepare(
    `INSERT INTO portfolio_snapshots (user_id, day, total_value_cents, invested_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       total_value_cents = excluded.total_value_cents,
       invested_cents    = excluded.invested_cents`,
  ).run(userId, point.day, point.totalValueCents, point.investedCents);
}

export function backfillSnapshots(userId: number, points: SnapshotPoint[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots (user_id, day, total_value_cents, invested_cents)
     VALUES (?, ?, ?, ?)`,
  );
  const run = db.transaction((batch: SnapshotPoint[]) => {
    for (const point of batch) {
      insert.run(userId, point.day, point.totalValueCents, point.investedCents);
    }
  });
  run(points);
}

export function getSnapshots(userId: number, days: number): SnapshotPoint[] {
  const rows = db
    .prepare(
      `SELECT day, total_value_cents, invested_cents
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
    }))
    .reverse();
}
