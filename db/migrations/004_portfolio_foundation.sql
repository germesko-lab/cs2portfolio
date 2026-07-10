-- Portfolio foundation: ledger, asset identity, catalog, enrichment,
-- source status and richer snapshots.

ALTER TABLE items ADD COLUMN class_id TEXT;
ALTER TABLE items ADD COLUMN instance_id TEXT;
ALTER TABLE items ADD COLUMN item_key TEXT;
ALTER TABLE items ADD COLUMN inspect_link TEXT;
ALTER TABLE items ADD COLUMN rarity TEXT;

UPDATE items
SET item_key =
  market_hash_name || '|' ||
  CASE WHEN float_value IS NULL THEN '' ELSE printf('%.8f', float_value) END || '|' ||
  COALESCE(CAST(paint_seed AS TEXT), '') || '|' ||
  CAST(stattrak AS TEXT) || '|' ||
  CAST(souvenir AS TEXT)
WHERE item_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_user_item_key ON items(user_id, item_key);
CREATE INDEX IF NOT EXISTS idx_items_user_class_instance ON items(user_id, class_id, instance_id);

CREATE TABLE IF NOT EXISTS skin_catalog (
  market_hash_name TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  weapon_type      TEXT,
  skin_name        TEXT,
  exterior         TEXT,
  category         TEXT NOT NULL CHECK (category IN
    ('knife','gloves','rifle','pistol','smg','heavy','sticker','case','agent','other')),
  rarity           TEXT,
  image_url        TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('buy','sell','deposit','withdraw','manual_adjustment')),
  source           TEXT NOT NULL CHECK (source IN ('steam_market','manual','imported_csv','csfloat','other_marketplace','unknown')),
  market_hash_name TEXT NOT NULL,
  steam_asset_id   TEXT,
  item_key         TEXT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'USD',
  fee_cents        INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  occurred_at      TEXT NOT NULL,
  external_id      TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_occurred ON transactions(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user_asset ON transactions(user_id, steam_asset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_item_key ON transactions(user_id, item_key);
CREATE INDEX IF NOT EXISTS idx_transactions_user_mhn ON transactions(user_id, market_hash_name);

INSERT INTO transactions (
  user_id, type, source, market_hash_name, steam_asset_id, item_key,
  quantity, unit_price_cents, currency, fee_cents, occurred_at, notes
)
SELECT
  c.user_id,
  'manual_adjustment',
  'manual',
  COALESCE(i.market_hash_name, substr(c.item_key, 1, instr(c.item_key || '|', '|') - 1), 'Unknown item'),
  c.asset_id,
  c.item_key,
  1,
  c.amount_cents,
  c.currency,
  0,
  COALESCE(c.acquired_at, c.updated_at),
  'Backfilled from existing manual cost basis'
FROM cost_basis c
LEFT JOIN items i
  ON i.user_id = c.user_id
 AND i.asset_id = c.asset_id
WHERE c.source = 'manual'
  AND NOT EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.user_id = c.user_id
      AND t.type = 'manual_adjustment'
      AND t.steam_asset_id = c.asset_id
      AND t.unit_price_cents = c.amount_cents
  );

ALTER TABLE price_quotes ADD COLUMN expires_at TEXT;
ALTER TABLE price_quotes ADD COLUMN status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE price_quotes ADD COLUMN error_message TEXT;
ALTER TABLE price_quotes ADD COLUMN raw_payload_json TEXT;

CREATE TABLE IF NOT EXISTS price_source_status (
  source_id     TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('success','failed','skipped')),
  checked_at    TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS asset_enrichments (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_inventory_item_id TEXT,
  steam_asset_id         TEXT,
  inspect_link           TEXT,
  market_hash_name       TEXT NOT NULL,
  float_value            REAL,
  paint_seed             INTEGER,
  paint_index            INTEGER,
  fade_percentage        REAL,
  fade_rank              INTEGER,
  stickers_json          TEXT,
  provider               TEXT NOT NULL DEFAULT 'unknown',
  fetched_at             TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('missing','pending','success','failed')),
  error_message          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_enrichments_user_asset
  ON asset_enrichments(user_id, steam_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_enrichments_inspect
  ON asset_enrichments(inspect_link);
CREATE INDEX IF NOT EXISTS idx_asset_enrichments_mhn
  ON asset_enrichments(market_hash_name);

CREATE TABLE IF NOT EXISTS portfolio_sync_status (
  user_id                    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_inventory_sync_at      TEXT,
  last_price_refresh_at       TEXT,
  last_enrichment_refresh_at  TEXT,
  failed_sources_json         TEXT NOT NULL DEFAULT '[]',
  missing_prices_count        INTEGER NOT NULL DEFAULT 0,
  missing_cost_basis_count    INTEGER NOT NULL DEFAULT 0,
  missing_enrichment_count    INTEGER NOT NULL DEFAULT 0,
  is_refreshing               INTEGER NOT NULL DEFAULT 0,
  last_error                  TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE portfolio_snapshots ADD COLUMN captured_at TEXT;
ALTER TABLE portfolio_snapshots ADD COLUMN known_cost_basis_cents INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN unrealized_pnl_cents INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN realized_pnl_cents INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN item_count INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN no_price_item_count INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN missing_cost_basis_item_count INTEGER;
ALTER TABLE portfolio_snapshots ADD COLUMN data_completeness_json TEXT;

UPDATE portfolio_snapshots
SET
  captured_at = COALESCE(captured_at, created_at),
  known_cost_basis_cents = COALESCE(known_cost_basis_cents, invested_cents),
  unrealized_pnl_cents = COALESCE(unrealized_pnl_cents, total_value_cents - invested_cents),
  item_count = COALESCE(item_count, 0),
  no_price_item_count = COALESCE(no_price_item_count, 0),
  missing_cost_basis_item_count = COALESCE(missing_cost_basis_item_count, 0),
  data_completeness_json = COALESCE(data_completeness_json, '{}');
