/**
 * Stream D - user-scoped items repository. Owns reading/writing the `items`
 * table. Cost basis rows live in stream C and are joined in memory.
 */
import { db } from '../db';
import { getAllCostBasisForItems } from '../valuation';
import type {
  CanonicalItem,
  ItemCategory,
  Position,
  StickerApplique,
  WearName,
} from '../contracts/types';

interface ItemRow {
  asset_id: string;
  class_id: string | null;
  instance_id: string | null;
  item_key: string | null;
  inspect_link: string | null;
  market_hash_name: string;
  base_name: string;
  category: string;
  rarity: string | null;
  wear_name: string | null;
  float_value: number | null;
  paint_seed: number | null;
  paint_index: number | null;
  fade_percentage: number | null;
  fade_rank: number | null;
  enrichment_status: 'missing' | 'pending' | 'success' | 'failed' | null;
  enrichment_provider: string | null;
  stattrak: number;
  souvenir: number;
  stickers_json: string;
  icon_url: string | null;
  acquired_at: string | null;
}

function itemKeyFor(input: {
  marketHashName: string;
  floatValue: number | null;
  paintSeed: number | null;
  statTrak: boolean;
  souvenir: boolean;
}): string {
  return [
    input.marketHashName,
    input.floatValue == null ? '' : input.floatValue.toFixed(8),
    input.paintSeed == null ? '' : String(input.paintSeed),
    input.statTrak ? '1' : '0',
    input.souvenir ? '1' : '0',
  ].join('|');
}

function catalogParams(item: CanonicalItem) {
  const [weaponType, skinName] = item.baseName.includes(' | ')
    ? item.baseName.split(' | ', 2)
    : [item.category, item.baseName];
  return {
    marketHashName: item.marketHashName,
    displayName: item.marketHashName,
    weaponType: weaponType || item.category,
    skinName: skinName || item.baseName,
    exterior: item.wearName,
    category: item.category,
    rarity: item.rarity,
    imageUrl: item.iconUrl,
  };
}

function rowToItem(row: ItemRow): CanonicalItem {
  let stickers: StickerApplique[] = [];
  try {
    const parsed: unknown = JSON.parse(row.stickers_json);
    if (Array.isArray(parsed)) stickers = parsed as StickerApplique[];
  } catch {
    // Corrupted JSON means only the sticker display is lost.
  }
  return {
    assetId: row.asset_id,
    classId: row.class_id,
    instanceId: row.instance_id,
    marketHashName: row.market_hash_name,
    baseName: row.base_name,
    category: row.category as ItemCategory,
    rarity: row.rarity,
    wearName: row.wear_name as WearName | null,
    floatValue: row.float_value,
    paintSeed: row.paint_seed,
    statTrak: row.stattrak === 1,
    souvenir: row.souvenir === 1,
    stickers,
    iconUrl: row.icon_url,
    acquiredAt: row.acquired_at,
    itemKey:
      row.item_key ??
      itemKeyFor({
        marketHashName: row.market_hash_name,
        floatValue: row.float_value,
        paintSeed: row.paint_seed,
        statTrak: row.stattrak === 1,
        souvenir: row.souvenir === 1,
      }),
    inspectLink: row.inspect_link,
    enrichmentStatus: row.enrichment_status ?? (row.float_value != null || row.paint_seed != null ? 'success' : 'missing'),
    enrichmentProvider: row.enrichment_provider,
    paintIndex: row.paint_index,
    fadePercentage: row.fade_percentage,
    fadeRank: row.fade_rank,
  };
}

const SELECT_COLUMNS = `i.asset_id, i.class_id, i.instance_id, i.item_key, i.inspect_link,
  i.market_hash_name, i.base_name, i.category, i.rarity, i.wear_name,
  COALESCE(e.float_value, i.float_value) AS float_value,
  COALESCE(e.paint_seed, i.paint_seed) AS paint_seed,
  e.paint_index, e.fade_percentage, e.fade_rank, e.status AS enrichment_status,
  e.provider AS enrichment_provider,
  i.stattrak, i.souvenir, i.stickers_json, i.icon_url, i.acquired_at`;

export function upsertItems(userId: number, items: CanonicalItem[]): void {
  const upsert = db.prepare(
    `INSERT INTO items (
       user_id, asset_id, class_id, instance_id, item_key, inspect_link,
       market_hash_name, base_name, category, rarity, wear_name,
       float_value, paint_seed, stattrak, souvenir, stickers_json,
       icon_url, acquired_at
     ) VALUES (
       @userId, @assetId, @classId, @instanceId, @itemKey, @inspectLink,
       @marketHashName, @baseName, @category, @rarity, @wearName,
       @floatValue, @paintSeed, @statTrak, @souvenir, @stickersJson,
       @iconUrl, @acquiredAt
     )
     ON CONFLICT(user_id, asset_id) DO UPDATE SET
       class_id         = excluded.class_id,
       instance_id      = excluded.instance_id,
       item_key         = excluded.item_key,
       inspect_link     = excluded.inspect_link,
       market_hash_name = excluded.market_hash_name,
       base_name        = excluded.base_name,
       category         = excluded.category,
       rarity           = excluded.rarity,
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
  const upsertCatalog = db.prepare(
    `INSERT INTO skin_catalog (
       market_hash_name, display_name, weapon_type, skin_name, exterior,
       category, rarity, image_url, updated_at
     ) VALUES (
       @marketHashName, @displayName, @weaponType, @skinName, @exterior,
       @category, @rarity, @imageUrl, strftime('%Y-%m-%dT%H:%M:%fZ','now')
     )
     ON CONFLICT(market_hash_name) DO UPDATE SET
       display_name = excluded.display_name,
       weapon_type  = excluded.weapon_type,
       skin_name    = excluded.skin_name,
       exterior     = excluded.exterior,
       category     = excluded.category,
       rarity       = excluded.rarity,
       image_url    = COALESCE(excluded.image_url, skin_catalog.image_url),
       updated_at   = excluded.updated_at`,
  );
  const upsertEnrichment = db.prepare(
    `INSERT INTO asset_enrichments (
       user_id, user_inventory_item_id, steam_asset_id, inspect_link,
       market_hash_name, float_value, paint_seed, stickers_json, provider,
       fetched_at, status, updated_at
     ) VALUES (
       @userId, @assetId, @assetId, @inspectLink,
       @marketHashName, @floatValue, @paintSeed, @stickersJson, @provider,
       @fetchedAt, @status, strftime('%Y-%m-%dT%H:%M:%fZ','now')
     )
     ON CONFLICT(user_id, steam_asset_id) DO UPDATE SET
       user_inventory_item_id = excluded.user_inventory_item_id,
       inspect_link           = excluded.inspect_link,
       market_hash_name       = excluded.market_hash_name,
       float_value            = COALESCE(excluded.float_value, asset_enrichments.float_value),
       paint_seed             = COALESCE(excluded.paint_seed, asset_enrichments.paint_seed),
       stickers_json          = excluded.stickers_json,
       provider               = excluded.provider,
       fetched_at             = COALESCE(excluded.fetched_at, asset_enrichments.fetched_at),
       status                 = CASE
                                  WHEN asset_enrichments.status = 'success' THEN 'success'
                                  ELSE excluded.status
                                END,
       updated_at             = excluded.updated_at`,
  );
  const deleteStmt = db.prepare('DELETE FROM items WHERE user_id = ? AND asset_id = ?');
  const selectIds = db.prepare('SELECT asset_id FROM items WHERE user_id = ?');

  const run = db.transaction((next: CanonicalItem[]) => {
    const keep = new Set(next.map((i) => i.assetId));
    const existing = selectIds.all(userId) as Array<{ asset_id: string }>;
    for (const row of existing) {
      if (!keep.has(row.asset_id)) deleteStmt.run(userId, row.asset_id);
    }
    for (const item of next) {
      upsert.run({
        userId,
        assetId: item.assetId,
        classId: item.classId,
        instanceId: item.instanceId,
        itemKey: item.itemKey,
        inspectLink: item.inspectLink,
        marketHashName: item.marketHashName,
        baseName: item.baseName,
        category: item.category,
        rarity: item.rarity,
        wearName: item.wearName,
        floatValue: item.floatValue,
        paintSeed: item.paintSeed,
        statTrak: item.statTrak ? 1 : 0,
        souvenir: item.souvenir ? 1 : 0,
        stickersJson: JSON.stringify(item.stickers ?? []),
        iconUrl: item.iconUrl,
        acquiredAt: item.acquiredAt,
      });
      upsertCatalog.run(catalogParams(item));
      upsertEnrichment.run({
        userId,
        assetId: item.assetId,
        inspectLink: item.inspectLink,
        marketHashName: item.marketHashName,
        floatValue: item.floatValue,
        paintSeed: item.paintSeed,
        stickersJson: JSON.stringify(item.stickers ?? []),
        provider: item.enrichmentProvider ?? (item.floatValue != null || item.paintSeed != null ? 'steam_fixture' : 'unknown'),
        fetchedAt: item.floatValue != null || item.paintSeed != null ? new Date().toISOString() : null,
        status:
          item.floatValue != null || item.paintSeed != null
            ? 'success'
            : item.inspectLink
              ? 'pending'
              : 'missing',
      });
    }
  });
  run(items);
}

export function getItems(userId: number): CanonicalItem[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM items i
       LEFT JOIN asset_enrichments e
         ON e.user_id = i.user_id
        AND e.steam_asset_id = i.asset_id
       WHERE i.user_id = ?
       ORDER BY i.market_hash_name, i.asset_id`,
    )
    .all(userId) as ItemRow[];
  return rows.map(rowToItem);
}

export function getItem(userId: number, assetId: string): CanonicalItem | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM items i
       LEFT JOIN asset_enrichments e
         ON e.user_id = i.user_id
        AND e.steam_asset_id = i.asset_id
       WHERE i.user_id = ? AND i.asset_id = ?`,
    )
    .get(userId, assetId) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function getPositions(userId: number): Position[] {
  const items = getItems(userId);
  const basisByAsset = getAllCostBasisForItems(userId, items);
  return items.map((item) => ({
    item,
    costBasis: basisByAsset.get(item.assetId) ?? null,
  }));
}
