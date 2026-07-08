/**
 * normalizeInventory — turn a raw Steam community inventory response into
 * CanonicalItem[] (the frozen contract in ../contracts/types).
 *
 * Assets are joined to descriptions on classid+instanceid. Parsing is driven
 * by market_hash_name + tags; a name-based heuristic covers the (rare) case
 * of a description with no tags. Float value, paint seed and acquisition
 * time are NOT exposed by this endpoint, so they normalize to null (the
 * inspect-link flow is out of MVP scope; fixture mode simulates them via
 * FIXTURE_EXTRAS — see ./fixture.ts).
 */
import type { CanonicalItem, ItemCategory, StickerApplique, WearName } from '../contracts/types';
import type { RawDescription, RawInventoryResponse, RawTag } from './raw-types';

const STEAM_CDN_IMAGE_BASE = 'https://community.cloudflare.steamstatic.com/economy/image/';

const WEAR_SUFFIX_RE = /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/;

const STAR_PREFIX = '★ ';
const STATTRAK_PREFIX = 'StatTrak™ ';
const SOUVENIR_PREFIX = 'Souvenir ';

/** Map of Steam "Type" tag internal_name → canonical category. */
const TYPE_TAG_TO_CATEGORY: Readonly<Record<string, ItemCategory>> = {
  CSGO_Type_Knife: 'knife',
  Type_Hands: 'gloves',
  CSGO_Type_Rifle: 'rifle',
  CSGO_Type_SniperRifle: 'rifle',
  CSGO_Type_Pistol: 'pistol',
  CSGO_Type_SMG: 'smg',
  CSGO_Type_Shotgun: 'heavy',
  CSGO_Type_Machinegun: 'heavy',
  CSGO_Tool_Sticker: 'sticker',
  CSGO_Type_WeaponCase: 'case',
  Type_CustomPlayer: 'agent',
};

/** Base weapon name → category, for the tag-less fallback heuristic. */
const WEAPON_NAME_TO_CATEGORY: Readonly<Record<string, ItemCategory>> = {
  // Rifles + sniper rifles
  'AK-47': 'rifle',
  'M4A4': 'rifle',
  'M4A1-S': 'rifle',
  'AWP': 'rifle',
  'SSG 08': 'rifle',
  'SG 553': 'rifle',
  'AUG': 'rifle',
  'FAMAS': 'rifle',
  'Galil AR': 'rifle',
  'SCAR-20': 'rifle',
  'G3SG1': 'rifle',
  // Pistols
  'Desert Eagle': 'pistol',
  'Glock-18': 'pistol',
  'USP-S': 'pistol',
  'P2000': 'pistol',
  'P250': 'pistol',
  'Five-SeveN': 'pistol',
  'Tec-9': 'pistol',
  'CZ75-Auto': 'pistol',
  'Dual Berettas': 'pistol',
  'R8 Revolver': 'pistol',
  'Zeus x27': 'pistol',
  // SMGs
  'MP9': 'smg',
  'MP7': 'smg',
  'MP5-SD': 'smg',
  'MAC-10': 'smg',
  'P90': 'smg',
  'PP-Bizon': 'smg',
  'UMP-45': 'smg',
  // Heavy (shotguns + machine guns)
  'Nova': 'heavy',
  'XM1014': 'heavy',
  'Sawed-Off': 'heavy',
  'MAG-7': 'heavy',
  'M249': 'heavy',
  'Negev': 'heavy',
};

function parseWearName(marketHashName: string): WearName | null {
  const match = marketHashName.match(WEAR_SUFFIX_RE);
  return match ? (match[1] as WearName) : null;
}

/** "★ StatTrak™ Karambit | Fade (Factory New)" → "Karambit | Fade". */
function parseBaseName(marketHashName: string): string {
  let base = marketHashName;
  if (base.startsWith(STAR_PREFIX)) base = base.slice(STAR_PREFIX.length);
  else if (base.startsWith('★')) base = base.slice(1).trimStart();
  if (base.startsWith(STATTRAK_PREFIX)) base = base.slice(STATTRAK_PREFIX.length);
  if (base.startsWith(SOUVENIR_PREFIX)) base = base.slice(SOUVENIR_PREFIX.length);
  return base.replace(WEAR_SUFFIX_RE, '').trim();
}

function categoryFromTags(tags: RawTag[] | undefined): ItemCategory | null {
  const typeTag = tags?.find((t) => t.category === 'Type');
  if (!typeTag) return null;
  return TYPE_TAG_TO_CATEGORY[typeTag.internal_name] ?? 'other';
}

/**
 * Name-based fallback heuristic, used only when a description carries no
 * usable Type tag. Works from the market_hash_name shape conventions.
 */
function categoryFromName(marketHashName: string, baseName: string): ItemCategory {
  if (marketHashName.startsWith('★')) {
    return /Gloves|Hand Wraps/i.test(baseName) ? 'gloves' : 'knife';
  }
  if (marketHashName.startsWith('Sticker |')) return 'sticker';
  if (/(^|\s)(Music Kit|Patch|Charm|Sealed Graffiti|Pin)\s*\|/.test(marketHashName)) return 'other';
  if (/\bCase\b/.test(marketHashName) && !marketHashName.includes(' | ')) return 'case';

  const weaponName = baseName.split(' | ')[0]?.trim() ?? '';
  const weaponCategory = WEAPON_NAME_TO_CATEGORY[weaponName];
  if (weaponCategory) return weaponCategory;

  // Wear-less "Name | Faction" pattern that isn't a weapon/sticker → agent.
  if (parseWearName(marketHashName) === null && marketHashName.includes(' | ')) return 'agent';
  return 'other';
}

/**
 * Parse applied stickers from the hover-text description lines. Steam encodes
 * them as an HTML line: `<div id="sticker_info" …>…Sticker: A, B, C…</div>`.
 * Wear (scratch) and per-sticker icons are not exposed here → null.
 */
function parseStickers(description: RawDescription): StickerApplique[] {
  for (const line of description.descriptions ?? []) {
    if (typeof line.value !== 'string' || !line.value.includes('Sticker:')) continue;
    const text = line.value.replace(/<[^>]*>/g, ' ');
    const match = text.match(/Sticker:\s*(.+)/);
    const names = match?.[1];
    if (!names) continue;
    return names
      .split(/,\s*/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name, slot) => ({ name, slot, wear: null, iconUrl: null }));
  }
  return [];
}

/** Normalize a single joined asset+description pair. */
function toCanonicalItem(assetId: string, description: RawDescription): CanonicalItem {
  const marketHashName = description.market_hash_name;
  const baseName = parseBaseName(marketHashName);
  return {
    assetId,
    marketHashName,
    baseName,
    category: categoryFromTags(description.tags) ?? categoryFromName(marketHashName, baseName),
    wearName: parseWearName(marketHashName),
    floatValue: null, // inspect flow out of MVP — not in the community endpoint
    paintSeed: null, // ditto
    statTrak: marketHashName.includes('StatTrak™'),
    souvenir: marketHashName.startsWith(SOUVENIR_PREFIX),
    stickers: parseStickers(description),
    iconUrl: description.icon_url ? `${STEAM_CDN_IMAGE_BASE}${description.icon_url}` : null,
    acquiredAt: null, // Steam does not expose acquisition time on this endpoint
  };
}

/**
 * Join assets ↔ descriptions on classid+instanceid and normalize every
 * describable CS2 asset. Assets with no matching description or no
 * market_hash_name (currency/junk edge cases) are skipped gracefully.
 */
export function normalizeInventory(raw: RawInventoryResponse): CanonicalItem[] {
  const descriptionsByKey = new Map<string, RawDescription>();
  for (const d of raw.descriptions ?? []) {
    descriptionsByKey.set(`${d.classid}_${d.instanceid}`, d);
  }

  const items: CanonicalItem[] = [];
  for (const asset of raw.assets ?? []) {
    if (asset.appid !== 730) continue; // not a CS2 item
    const description = descriptionsByKey.get(`${asset.classid}_${asset.instanceid}`);
    if (!description) continue; // undescribed asset — nothing to normalize
    if (description.currency) continue; // currency entries are not items
    if (!description.market_hash_name) continue; // junk without a market identity
    items.push(toCanonicalItem(asset.assetid, description));
  }
  return items;
}
