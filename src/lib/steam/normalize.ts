import type { CanonicalItem, ItemCategory, StickerApplique, WearName } from '../contracts/types';
import type { RawAsset, RawDescription, RawInventoryResponse, RawTag } from './raw-types';

const STEAM_CDN_IMAGE_BASE = 'https://community.cloudflare.steamstatic.com/economy/image/';

const WEAR_SUFFIX_RE = /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/;

const STAR_PREFIX = '\u2605 ';
const STATTRAK_PREFIX = 'StatTrak\u2122 ';
const SOUVENIR_PREFIX = 'Souvenir ';

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

const WEAPON_NAME_TO_CATEGORY: Readonly<Record<string, ItemCategory>> = {
  'AK-47': 'rifle',
  M4A4: 'rifle',
  'M4A1-S': 'rifle',
  AWP: 'rifle',
  'SSG 08': 'rifle',
  'SG 553': 'rifle',
  AUG: 'rifle',
  FAMAS: 'rifle',
  'Galil AR': 'rifle',
  'SCAR-20': 'rifle',
  G3SG1: 'rifle',
  'Desert Eagle': 'pistol',
  'Glock-18': 'pistol',
  'USP-S': 'pistol',
  P2000: 'pistol',
  P250: 'pistol',
  'Five-SeveN': 'pistol',
  'Tec-9': 'pistol',
  'CZ75-Auto': 'pistol',
  'Dual Berettas': 'pistol',
  'R8 Revolver': 'pistol',
  'Zeus x27': 'pistol',
  MP9: 'smg',
  MP7: 'smg',
  'MP5-SD': 'smg',
  'MAC-10': 'smg',
  P90: 'smg',
  'PP-Bizon': 'smg',
  'UMP-45': 'smg',
  Nova: 'heavy',
  XM1014: 'heavy',
  'Sawed-Off': 'heavy',
  'MAG-7': 'heavy',
  M249: 'heavy',
  Negev: 'heavy',
};

function parseWearName(marketHashName: string): WearName | null {
  const match = marketHashName.match(WEAR_SUFFIX_RE);
  return match ? (match[1] as WearName) : null;
}

function parseBaseName(marketHashName: string): string {
  let base = marketHashName;
  if (base.startsWith(STAR_PREFIX)) base = base.slice(STAR_PREFIX.length);
  else if (base.startsWith('\u2605')) base = base.slice(1).trimStart();
  if (base.startsWith(STATTRAK_PREFIX)) base = base.slice(STATTRAK_PREFIX.length);
  if (base.startsWith(SOUVENIR_PREFIX)) base = base.slice(SOUVENIR_PREFIX.length);
  return base.replace(WEAR_SUFFIX_RE, '').trim();
}

function categoryFromTags(tags: RawTag[] | undefined): ItemCategory | null {
  const typeTag = tags?.find((t) => t.category === 'Type');
  if (!typeTag) return null;
  return TYPE_TAG_TO_CATEGORY[typeTag.internal_name] ?? 'other';
}

function rarityFromTags(tags: RawTag[] | undefined): string | null {
  const rarityTag = tags?.find((t) => t.category === 'Rarity');
  return rarityTag?.localized_tag_name ?? null;
}

function categoryFromName(marketHashName: string, baseName: string): ItemCategory {
  if (marketHashName.startsWith('\u2605')) {
    return /Gloves|Hand Wraps/i.test(baseName) ? 'gloves' : 'knife';
  }
  if (marketHashName.startsWith('Sticker |')) return 'sticker';
  if (/(^|\s)(Music Kit|Patch|Charm|Sealed Graffiti|Pin)\s*\|/.test(marketHashName)) return 'other';
  if (/\bCase\b/.test(marketHashName) && !marketHashName.includes(' | ')) return 'case';

  const weaponName = baseName.split(' | ')[0]?.trim() ?? '';
  const weaponCategory = WEAPON_NAME_TO_CATEGORY[weaponName];
  if (weaponCategory) return weaponCategory;

  if (parseWearName(marketHashName) === null && marketHashName.includes(' | ')) return 'agent';
  return 'other';
}

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

function inspectLink(asset: RawAsset, description: RawDescription): string | null {
  const action = description.actions?.find((a) => /inspect/i.test(a.name) || /inspect/i.test(a.link));
  if (!action?.link) return null;
  return action.link
    .replaceAll('%assetid%', asset.assetid)
    .replaceAll('%classid%', asset.classid)
    .replaceAll('%instanceid%', asset.instanceid);
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

function toCanonicalItem(asset: RawAsset, description: RawDescription): CanonicalItem {
  const marketHashName = description.market_hash_name;
  const baseName = parseBaseName(marketHashName);
  const statTrak = marketHashName.includes(STATTRAK_PREFIX);
  const souvenir = marketHashName.startsWith(SOUVENIR_PREFIX);
  const item = {
    assetId: asset.assetid,
    classId: asset.classid,
    instanceId: asset.instanceid,
    marketHashName,
    baseName,
    category: categoryFromTags(description.tags) ?? categoryFromName(marketHashName, baseName),
    rarity: rarityFromTags(description.tags),
    wearName: parseWearName(marketHashName),
    floatValue: null,
    paintSeed: null,
    statTrak,
    souvenir,
    stickers: parseStickers(description),
    iconUrl: description.icon_url ? `${STEAM_CDN_IMAGE_BASE}${description.icon_url}` : null,
    acquiredAt: null,
    inspectLink: inspectLink(asset, description),
    enrichmentStatus: description.actions?.length ? 'pending' : 'missing',
    enrichmentProvider: null,
    paintIndex: null,
    fadePercentage: null,
    fadeRank: null,
  } satisfies Omit<CanonicalItem, 'itemKey'>;
  return { ...item, itemKey: itemKeyFor(item) };
}

export function normalizeInventory(raw: RawInventoryResponse): CanonicalItem[] {
  const descriptionsByKey = new Map<string, RawDescription>();
  for (const d of raw.descriptions ?? []) {
    descriptionsByKey.set(`${d.classid}_${d.instanceid}`, d);
  }

  const items: CanonicalItem[] = [];
  for (const asset of raw.assets ?? []) {
    if (asset.appid !== 730) continue;
    const description = descriptionsByKey.get(`${asset.classid}_${asset.instanceid}`);
    if (!description) continue;
    if (description.currency) continue;
    if (!description.market_hash_name) continue;
    items.push(toCanonicalItem(asset, description));
  }
  return items;
}
