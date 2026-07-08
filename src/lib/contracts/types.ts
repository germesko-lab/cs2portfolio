/**
 * FROZEN CONTRACT — canonical item & portfolio model.
 * All streams code against these types. Do not modify; the orchestrator owns
 * this file. If an implementation drifts, the contract wins.
 */

/** All money is integer cents. USD only in MVP (see DECISIONS.md). */
export type Cents = number;
export type Currency = 'USD';

/** ISO-8601 timestamp string, e.g. "2026-07-08T12:00:00.000Z". */
export type IsoTimestamp = string;
/** Calendar day string, "YYYY-MM-DD" (UTC). */
export type IsoDay = string;

export type ItemCategory =
  | 'knife'
  | 'gloves'
  | 'rifle'
  | 'pistol'
  | 'smg'
  | 'heavy' // shotguns + machine guns
  | 'sticker'
  | 'case'
  | 'agent'
  | 'other'; // patches, charms, music kits, graffiti, keys, …

export type WearName =
  | 'Factory New'
  | 'Minimal Wear'
  | 'Field-Tested'
  | 'Well-Worn'
  | 'Battle-Scarred';

/** A sticker applied to a weapon (not a sticker item held in inventory). */
export interface StickerApplique {
  name: string; // e.g. "Sticker | Natus Vincere | Katowice 2015"
  slot: number; // 0..4
  wear: number | null; // 0..1 scratch level, null when unknown
  iconUrl: string | null;
}

/**
 * Canonical normalized inventory item. One row per unique Steam asset.
 * Produced by stream A (src/lib/steam), stored in the `items` table.
 */
export interface CanonicalItem {
  /** Steam asset id — unique per item instance, primary key. */
  assetId: string;
  /**
   * Exact Steam market_hash_name, e.g.
   * "AK-47 | Redline (Field-Tested)", "★ Karambit | Fade (Factory New)",
   * "StatTrak™ AWP | Asiimov (Battle-Scarred)". This is THE join key for
   * all price lookups across every PriceSource.
   */
  marketHashName: string;
  /** Display name without wear/StatTrak/Souvenir/★, e.g. "AK-47 | Redline". */
  baseName: string;
  category: ItemCategory;
  /** Parsed from marketHashName; null for wear-less items (stickers, cases…). */
  wearName: WearName | null;
  /** Exact float 0..1 when known (inspect-link flow); null in MVP for live data. */
  floatValue: number | null;
  paintSeed: number | null;
  statTrak: boolean;
  souvenir: boolean;
  /** Stickers applied to this weapon. Empty array when none/unknown. */
  stickers: StickerApplique[];
  /** Full https URL to the item icon (Steam CDN), or null. */
  iconUrl: string | null;
  /** Best-known acquisition time; null when Steam doesn't expose it. */
  acquiredAt: IsoTimestamp | null;
}

/** How a position's cost basis was determined (hybrid model, DECISIONS.md). */
export type CostBasisSource = 'auto' | 'manual';

export interface CostBasis {
  amountCents: Cents;
  currency: Currency;
  source: CostBasisSource;
  /** Acquisition date the auto-estimate was computed for, if any. */
  acquiredAt: IsoTimestamp | null;
}

/** An inventory item plus its cost basis (null = not yet estimable). */
export interface Position {
  item: CanonicalItem;
  costBasis: CostBasis | null;
}

/** One point of the daily portfolio value series (`portfolio_snapshots`). */
export interface SnapshotPoint {
  day: IsoDay;
  totalValueCents: Cents;
  investedCents: Cents;
}
