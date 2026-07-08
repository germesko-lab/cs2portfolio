-- FROZEN SCHEMA — canonical item model + pricing cache + snapshots.
-- Orchestrator-owned. Mirrors src/lib/contracts/types.ts.

CREATE TABLE IF NOT EXISTS items (
  asset_id         TEXT PRIMARY KEY,
  market_hash_name TEXT NOT NULL,
  base_name        TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN
    ('knife','gloves','rifle','pistol','smg','heavy','sticker','case','agent','other')),
  wear_name        TEXT CHECK (wear_name IN
    ('Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred')),
  float_value      REAL,
  paint_seed       INTEGER,
  stattrak         INTEGER NOT NULL DEFAULT 0, -- boolean 0/1
  souvenir         INTEGER NOT NULL DEFAULT 0, -- boolean 0/1
  stickers_json    TEXT NOT NULL DEFAULT '[]', -- StickerApplique[]
  icon_url         TEXT,
  acquired_at      TEXT,                        -- ISO timestamp
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_mhn ON items(market_hash_name);

-- Hybrid cost basis: one row per asset, auto-estimated or manual override.
CREATE TABLE IF NOT EXISTS cost_basis (
  asset_id    TEXT PRIMARY KEY REFERENCES items(asset_id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  source      TEXT NOT NULL CHECK (source IN ('auto','manual')),
  acquired_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Latest quote per (item, source) — the price cache.
CREATE TABLE IF NOT EXISTS price_quotes (
  market_hash_name TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  price_cents      INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  listings_count   INTEGER,
  url              TEXT,
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (market_hash_name, source_id)
);

-- Daily per-item price history (mock-seeded in MVP; live backfill later).
CREATE TABLE IF NOT EXISTS price_history (
  market_hash_name TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  day              TEXT NOT NULL, -- YYYY-MM-DD
  price_cents      INTEGER NOT NULL,
  PRIMARY KEY (market_hash_name, source_id, day)
);

-- Daily portfolio value series.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  day               TEXT PRIMARY KEY, -- YYYY-MM-DD
  total_value_cents INTEGER NOT NULL,
  invested_cents    INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Small key/value store (steam_id, last_sync_at, …).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
