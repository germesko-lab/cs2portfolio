/**
 * Raw response types for the Steam community inventory endpoint:
 *
 *   GET https://steamcommunity.com/inventory/{steamId64}/730/2?l=english&count=2000
 *
 * These mirror the REAL JSON shape returned by steamcommunity.com (the same
 * payload the Steam Community site itself consumes). They are the input to
 * `normalizeInventory` (./normalize.ts) and the shape of the bundled fixture
 * (./fixture.ts). Do not "clean up" field names — they match Steam's wire
 * format exactly (snake_case, stringly-typed ids, 0/1 booleans).
 */

/** One owned item instance. Joined to a RawDescription on classid+instanceid. */
export interface RawAsset {
  appid: number; // 730 for CS2
  contextid: string; // "2" for the CS2 item context
  assetid: string; // unique per item instance — becomes CanonicalItem.assetId
  classid: string;
  instanceid: string; // "0" for commodity-like items (cases, most stickers)
  amount: string; // "1" for CS2 items (not a commodity stack)
}

/**
 * A tag attached to a description, e.g.
 * { category: "Type", internal_name: "CSGO_Type_Rifle", localized_tag_name: "Rifle" }.
 * Known categories include: Type, Weapon, ItemSet, Quality, Rarity, Exterior.
 */
export interface RawTag {
  category: string;
  internal_name: string;
  localized_category_name?: string;
  localized_tag_name?: string;
  color?: string;
}

/**
 * One line of the item detail text shown on hover. Sticker info arrives as an
 * HTML line whose value contains `Sticker: Name1, Name2, …` inside a
 * `<div id="sticker_info">` block.
 */
export interface RawDescriptionLine {
  type?: string; // "html" for the sticker_info line
  value: string;
  name?: string; // e.g. "sticker_info"
  color?: string;
}

/** Shared visual/market metadata for one classid+instanceid combination. */
export interface RawDescription {
  appid: number;
  classid: string;
  instanceid: string;
  currency?: number;
  background_color?: string;
  /** CDN path fragment; full URL is https://community.cloudflare.steamstatic.com/economy/image/{icon_url} */
  icon_url?: string;
  icon_url_large?: string;
  descriptions?: RawDescriptionLine[];
  tradable: 0 | 1;
  name?: string;
  name_color?: string;
  /** Localized type line, e.g. "Classified Rifle", "Base Grade Container". */
  type?: string;
  market_name?: string;
  /** THE join key for all price lookups, e.g. "AK-47 | Redline (Field-Tested)". */
  market_hash_name: string;
  commodity?: 0 | 1;
  market_tradable_restriction?: number;
  market_marketable_restriction?: number;
  marketable: 0 | 1;
  tags?: RawTag[];
}

/** Top-level response body. Steam returns literal `null` for some error cases. */
export interface RawInventoryResponse {
  assets: RawAsset[];
  descriptions: RawDescription[];
  /** Present (as 1) when another page exists; page with &start_assetid=last_assetid. */
  more_items?: 1;
  /** Cursor for the next page when more_items is set. */
  last_assetid?: string;
  total_inventory_count: number;
  success: 1;
  /** Undocumented diagnostic field Steam sometimes includes. */
  rwgrsn?: number;
}
