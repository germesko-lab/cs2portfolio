/**
 * Stream D — items repository. Owns reading/writing the `items` table.
 * Cost basis rows live in stream C's module; we join via getAllCostBasis().
 */
import { db } from '../db';
import { getAllCostBasis } from '../valuation';
import type {
  CanonicalItem,
  ItemCategory,
  Position,
  StickerApplique,
  WearName,
} from '../contracts/types';

interface ItemRow {
  asset_id: string;
  market_hash_name: string;
  base_name: string;
  category: string;
  wear_name: string | null;
  float_value: number | null;
  paint_seed: number | null;
  stattrak: number;
  souvenir: number;
  stickers_json: string;
  icon_url: string | null;
  acquired_at: string | null;
}

function rowToItem(row: ItemRow): CanonicalItem {
  let stickers: StickerApplique[] = [];
  try {
    const parsed: unknown = JSON.parse(row.stickers_json);
    if (Array.isArray(parsed)) stickers = parsed as StickerApplique[];
  } catch {
    // Corrupted JSON — treat as no stickers rather than failing the read.
  }
  return {
    assetId: row.asset_id,
    marketHashName: row.market_hash_name,
    baseName: row.base_name,
    category: row.category as ItemCategory,
    wearName: row.wear_name as WearName | null,
    floatValue: row.float_value,
    paintSeed: row.paint_seed,
    statTrak: row.stattrak === 1,
    souvenir: row.souvenir === 1,
    stickers,
    iconUrl: row.icon_url,
    acquiredAt: row.acquired_at,
  };
}

const SELECT_COLUMNS = `asset_id, market_hash_name, base_name, category, wear_name,
  float_value, paint_seed, stattrak, souvenir, stickers_json, icon_url, acquired_at`;

/**
 * Replace-all semantics per sync: upsert every item in the new inventory and
 * delete rows for assets no longer present. Single transaction.
 */
export function upsertItems(items: CanonicalItem[]): void {
  const upsert = db.prepare(
    `INSERT INTO items (
       asset_id, market_hash_name, base_name, category, wear_name,
       float_value, paint_seed, stattrak, souvenir, stickers_json,
       icon_url, acquired_at
     ) VALUES (
       @assetId, @marketHashName, @baseName, @category, @wearName,
       @floatValue, @paintSeed, @statTrak, @souvenir, @stickersJson,
       @iconUrl, @acquiredAt
     )
     ON CONFLICT(asset_id) DO UPDATE SET
       market_hash_name = excluded.market_hash_name,
       base_name        = excluded.base_name,
       category         = excluded.category,
       wear_name        = excluded.wear_name,
       float_value      = excluded.float_value,
       paint_seed       = excluded.paint_seed,
       stattrak         = excluded.stattrak,
       souvenir         = excluded.souvenir,
       stickers_json    = excluded.stickers_json,
       icon_url         = excluded.icon_url,
       acquired_at      = excluded.acquired_at,
       updated_at       = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const deleteStmt = db.prepare('DELETE FROM items WHERE asset_id = ?');
  const selectIds = db.prepare('SELECT asset_id FROM items');

  const run = db.transaction((next: CanonicalItem[]) => {
    const keep = new Set(next.map((i) => i.assetId));
    const existing = selectIds.all() as Array<{ asset_id: string }>;
    for (const row of existing) {
      if (!keep.has(row.asset_id)) deleteStmt.run(row.asset_id);
    }
    for (const item of next) {
      upsert.run({
        assetId: item.assetId,
        marketHashName: item.marketHashName,
        baseName: item.baseName,
        category: item.category,
        wearName: item.wearName,
        floatValue: item.floatValue,
        paintSeed: item.paintSeed,
        statTrak: item.statTrak ? 1 : 0,
        souvenir: item.souvenir ? 1 : 0,
        stickersJson: JSON.stringify(item.stickers ?? []),
        iconUrl: item.iconUrl,
        acquiredAt: item.acquiredAt,
      });
    }
  });
  run(items);
}

export function getItems(): CanonicalItem[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM items ORDER BY market_hash_name, asset_id`)
    .all() as ItemRow[];
  return rows.map(rowToItem);
}

export function getItem(assetId: string): CanonicalItem | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM items WHERE asset_id = ?`)
    .get(assetId) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

/** All items joined with their cost basis (null when not yet estimable). */
export function getPositions(): Position[] {
  const basisByAsset = getAllCostBasis();
  return getItems().map((item) => ({
    item,
    costBasis: basisByAsset.get(item.assetId) ?? null,
  }));
}
