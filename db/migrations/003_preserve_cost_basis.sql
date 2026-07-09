-- Preserve manual cost basis across inventory resyncs.
--
-- Steam asset_id is good for the current inventory row, but replacing/deleting
-- item rows during sync must not cascade-delete the user's manually-entered
-- buy prices. Keep cost_basis user-scoped, add a stable item_key for fallback
-- matching, and remove the item foreign key.

CREATE TABLE cost_basis_new (
  user_id      INTEGER NOT NULL,
  asset_id     TEXT NOT NULL,
  item_key     TEXT,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  source       TEXT NOT NULL CHECK (source IN ('auto','manual')),
  acquired_at  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, asset_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO cost_basis_new (
  user_id, asset_id, item_key, amount_cents, currency, source, acquired_at, updated_at
)
SELECT
  c.user_id,
  c.asset_id,
  CASE
    WHEN i.asset_id IS NULL THEN NULL
    ELSE
      i.market_hash_name || '|' ||
      CASE WHEN i.float_value IS NULL THEN '' ELSE printf('%.8f', i.float_value) END || '|' ||
      COALESCE(CAST(i.paint_seed AS TEXT), '') || '|' ||
      CAST(i.stattrak AS TEXT) || '|' ||
      CAST(i.souvenir AS TEXT)
  END,
  c.amount_cents,
  c.currency,
  c.source,
  c.acquired_at,
  c.updated_at
FROM cost_basis c
LEFT JOIN items i
  ON i.user_id = c.user_id
 AND i.asset_id = c.asset_id;

DROP TABLE cost_basis;
ALTER TABLE cost_basis_new RENAME TO cost_basis;
CREATE INDEX IF NOT EXISTS idx_cost_basis_user_item_key ON cost_basis(user_id, item_key);
