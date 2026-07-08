-- Multi-user ownership model.
-- Portfolio-owned data is scoped by user_id. Market price caches remain global
-- because they are shared public market data, not a user's private portfolio.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Preserve any existing single-user rows by assigning them to the current
-- recorded SteamID. If this was only the bundled demo, use its fixture ID.
INSERT OR IGNORE INTO users (steam_id)
SELECT COALESCE((SELECT value FROM meta WHERE key = 'steam_id'), '76561198000000000')
WHERE EXISTS (SELECT 1 FROM items LIMIT 1)
   OR EXISTS (SELECT 1 FROM portfolio_snapshots LIMIT 1)
   OR EXISTS (SELECT 1 FROM meta WHERE key IN ('steam_id', 'last_sync_at'));

CREATE TABLE items_new (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id         TEXT NOT NULL,
  market_hash_name TEXT NOT NULL,
  base_name        TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN
    ('knife','gloves','rifle','pistol','smg','heavy','sticker','case','agent','other')),
  wear_name        TEXT CHECK (wear_name IN
    ('Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred')),
  float_value      REAL,
  paint_seed       INTEGER,
  stattrak         INTEGER NOT NULL DEFAULT 0,
  souvenir         INTEGER NOT NULL DEFAULT 0,
  stickers_json    TEXT NOT NULL DEFAULT '[]',
  icon_url         TEXT,
  acquired_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, asset_id)
);

INSERT INTO items_new (
  user_id, asset_id, market_hash_name, base_name, category, wear_name,
  float_value, paint_seed, stattrak, souvenir, stickers_json, icon_url,
  acquired_at, created_at, updated_at
)
SELECT u.id, i.asset_id, i.market_hash_name, i.base_name, i.category, i.wear_name,
       i.float_value, i.paint_seed, i.stattrak, i.souvenir, i.stickers_json,
       i.icon_url, i.acquired_at, i.created_at, i.updated_at
FROM items i
JOIN users u ON u.steam_id = COALESCE((SELECT value FROM meta WHERE key = 'steam_id'), '76561198000000000');

CREATE TEMP TABLE cost_basis_copy (
  user_id      INTEGER NOT NULL,
  asset_id     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  source       TEXT NOT NULL,
  acquired_at  TEXT,
  updated_at   TEXT NOT NULL
);

INSERT INTO cost_basis_copy
SELECT u.id, c.asset_id, c.amount_cents, c.currency, c.source, c.acquired_at, c.updated_at
FROM cost_basis c
JOIN users u ON u.steam_id = COALESCE((SELECT value FROM meta WHERE key = 'steam_id'), '76561198000000000');

DROP TABLE cost_basis;
DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX IF NOT EXISTS idx_items_user_mhn ON items(user_id, market_hash_name);
CREATE INDEX IF NOT EXISTS idx_items_mhn ON items(market_hash_name);

CREATE TABLE cost_basis (
  user_id      INTEGER NOT NULL,
  asset_id     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  source       TEXT NOT NULL CHECK (source IN ('auto','manual')),
  acquired_at  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, asset_id),
  FOREIGN KEY (user_id, asset_id) REFERENCES items(user_id, asset_id) ON DELETE CASCADE
);

INSERT INTO cost_basis (
  user_id, asset_id, amount_cents, currency, source, acquired_at, updated_at
)
SELECT user_id, asset_id, amount_cents, currency, source, acquired_at, updated_at
FROM cost_basis_copy
WHERE EXISTS (
  SELECT 1 FROM items i
  WHERE i.user_id = cost_basis_copy.user_id
    AND i.asset_id = cost_basis_copy.asset_id
);
DROP TABLE cost_basis_copy;

CREATE TABLE portfolio_snapshots_new (
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day               TEXT NOT NULL,
  total_value_cents INTEGER NOT NULL,
  invested_cents    INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, day)
);

INSERT INTO portfolio_snapshots_new (
  user_id, day, total_value_cents, invested_cents, created_at
)
SELECT u.id, p.day, p.total_value_cents, p.invested_cents, p.created_at
FROM portfolio_snapshots p
JOIN users u ON u.steam_id = COALESCE((SELECT value FROM meta WHERE key = 'steam_id'), '76561198000000000');

DROP TABLE portfolio_snapshots;
ALTER TABLE portfolio_snapshots_new RENAME TO portfolio_snapshots;

CREATE TABLE IF NOT EXISTS user_meta (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

INSERT OR IGNORE INTO user_meta (user_id, key, value)
SELECT u.id, m.key, m.value
FROM meta m
JOIN users u ON u.steam_id = COALESCE((SELECT value FROM meta WHERE key = 'steam_id'), '76561198000000000')
WHERE m.key IN ('steam_id', 'last_sync_at');

CREATE TABLE IF NOT EXISTS item_notes (
  user_id    INTEGER NOT NULL,
  asset_id   TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, asset_id),
  FOREIGN KEY (user_id, asset_id) REFERENCES items(user_id, asset_id) ON DELETE CASCADE
);
