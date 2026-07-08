/**
 * Orchestrator-owned SQLite access. Streams import { db } (better-sqlite3
 * Database, synchronous) — the connection opens lazily on first USE (not on
 * import: `next build` evaluates route modules in parallel workers while
 * collecting page data, and an eager open made those workers race each other
 * through the migration runner). Migrations additionally run inside an
 * IMMEDIATE transaction so concurrent processes serialize instead of
 * colliding on schema_migrations.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

declare global {
  // Survive Next.js dev-mode module reloads with a single connection.
  var __cs2db: Database.Database | undefined;
}

function open(): Database.Database {
  const dbPath = process.env.DB_PATH ?? path.join(DATA_DIR, 'portfolio.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  // busy_timeout FIRST: switching journal modes needs a lock too, and
  // concurrent first-opens must wait for each other rather than throw.
  conn.pragma('busy_timeout = 10000');
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  migrate(conn);
  return conn;
}

function migrate(conn: Database.Database) {
  conn.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // IMMEDIATE takes the write lock up front: a second process blocks here
  // (up to busy_timeout), then re-reads the applied set and skips everything
  // the winner already ran. INSERT OR IGNORE is belt-and-suspenders.
  const applyAll = conn.transaction(() => {
    const applied = new Set(
      (conn.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      conn.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      conn
        .prepare('INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
    }
  });
  applyAll.immediate();
}

function instance(): Database.Database {
  return globalThis.__cs2db ?? (globalThis.__cs2db = open());
}

/**
 * Lazy proxy: behaves exactly like a better-sqlite3 Database, but the file
 * is only opened/migrated on first property access.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop: string | symbol) {
    const real = instance();
    const value = Reflect.get(real, prop) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/* Convenience helpers for the meta key/value table. */
export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getUserMeta(userId: number, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_meta WHERE user_id = ? AND key = ?').get(
    userId,
    key,
  ) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserMeta(userId: number, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_meta (user_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, value);
}
