/**
 * Bundled inventory fixture in the EXACT raw Steam response shape
 * (RawInventoryResponse). Signed-in users can load it via "Load demo";
 * pair it with PRICE_SOURCE_MODE=mock for fully offline development.
 *
 * Every marketHashName comes strictly from the frozen MOCK_UNIVERSE so the
 * mock price source can price it — with ONE deliberate exception:
 * "SG 553 | Integrale (Minimal Wear)" is NOT in MOCK_UNIVERSE and exists to
 * exercise the missing-price path downstream (priceStatus: 'missing').
 *
 * FIXTURE_EXTRAS simulates data the live community endpoint does NOT expose:
 * float values / paint seeds (would need the game-coordinator / CSFloat
 * inspect flow, out of MVP) and acquisition timestamps (Steam never exposes
 * them here). Extras are applied ONLY in fixture mode by ./index.ts, so live
 * normalization stays honest (nulls).
 */
import { MOCK_UNIVERSE, MOCK_UNIVERSE_BY_NAME } from '../contracts/mock-universe';
import type { ItemCategory, WearName } from '../contracts/types';
import type { RawAsset, RawDescription, RawInventoryResponse, RawTag } from './raw-types';

export const FIXTURE_STEAM_ID = '76561198000000000';

/** Simulated per-asset inspect/acquisition data. Keyed by assetid. */
export interface FixtureExtra {
  floatValue?: number;
  paintSeed?: number;
  acquiredAt?: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Roster — which items the fixture inventory contains.
// ---------------------------------------------------------------------------

interface RosterEntry {
  name: string;
  /** Applied stickers → rendered as a sticker_info HTML description line. */
  stickers?: readonly string[];
}

/** Stickers applied to specific universe items (distinct instanceids). */
const APPLIED_STICKERS: Readonly<Record<string, readonly string[]>> = {
  'M4A4 | Howl (Field-Tested)': ['iBUYPOWER (Holo) | Katowice 2014', 'Vox Eminor | Katowice 2015'],
};

/** The one deliberately unpriceable item (not in MOCK_UNIVERSE). */
const MISSING_PRICE_ITEM = 'SG 553 | Integrale (Minimal Wear)';

/** Categories for names outside MOCK_UNIVERSE. */
const EXTRA_CATEGORIES: Readonly<Record<string, ItemCategory>> = {
  [MISSING_PRICE_ITEM]: 'rifle',
};

/**
 * 30 assets: all 26 MOCK_UNIVERSE names, three duplicates (2× Redline —
 * second copy stickered, 2× AK-47 Asiimov, 2× Dreams & Nightmares Case),
 * plus the missing-price SG 553.
 */
const ROSTER: readonly RosterEntry[] = [
  ...MOCK_UNIVERSE.map((entry): RosterEntry => {
    const stickers = APPLIED_STICKERS[entry.marketHashName];
    return stickers ? { name: entry.marketHashName, stickers } : { name: entry.marketHashName };
  }),
  {
    name: 'AK-47 | Redline (Field-Tested)', // duplicate #2, this one stickered
    stickers: ['Titan (Holo) | Katowice 2015', 'Team Dignitas (Holo) | Katowice 2015', 'Crown (Foil)'],
  },
  { name: 'AK-47 | Asiimov (Minimal Wear)' }, // duplicate — shares classid+instanceid
  { name: 'Dreams & Nightmares Case' }, // duplicate — shares classid+instanceid
  { name: MISSING_PRICE_ITEM },
];

// ---------------------------------------------------------------------------
// Deterministic pseudo-data helpers (stable across runs, no RNG).
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const ICON_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Plausible Steam economy icon hash, deterministic per item name. */
function pseudoIconHash(name: string): string {
  let h = fnv1a(name);
  let out = '-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpo';
  for (let i = 0; i < 72; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out += ICON_CHARS[h % ICON_CHARS.length];
  }
  return out;
}

const WEAR_RE = /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/;

function wearOf(name: string): WearName | null {
  const m = name.match(WEAR_RE);
  return m ? (m[1] as WearName) : null;
}

/** Plausible float bracket per wear tier (min, max). */
const FLOAT_BRACKETS: Readonly<Record<WearName, readonly [number, number]>> = {
  'Factory New': [0.008, 0.06],
  'Minimal Wear': [0.08, 0.14],
  'Field-Tested': [0.16, 0.36],
  'Well-Worn': [0.39, 0.44],
  'Battle-Scarred': [0.46, 0.92],
};

// ---------------------------------------------------------------------------
// Tag construction — consistent with what Steam attaches per category.
// ---------------------------------------------------------------------------

const SNIPER_RIFLES = ['AWP', 'SSG 08', 'SCAR-20', 'G3SG1'];

function typeTagFor(name: string, category: ItemCategory): RawTag {
  const tag = (internal: string, localized: string): RawTag => ({
    category: 'Type',
    internal_name: internal,
    localized_category_name: 'Type',
    localized_tag_name: localized,
  });
  switch (category) {
    case 'knife':
      return tag('CSGO_Type_Knife', 'Knife');
    case 'gloves':
      return tag('Type_Hands', 'Gloves');
    case 'rifle':
      return SNIPER_RIFLES.some((w) => name.includes(w))
        ? tag('CSGO_Type_SniperRifle', 'Sniper Rifle')
        : tag('CSGO_Type_Rifle', 'Rifle');
    case 'pistol':
      return tag('CSGO_Type_Pistol', 'Pistol');
    case 'smg':
      return tag('CSGO_Type_SMG', 'SMG');
    case 'heavy':
      return tag('CSGO_Type_Shotgun', 'Shotgun');
    case 'sticker':
      return tag('CSGO_Tool_Sticker', 'Sticker');
    case 'case':
      return tag('CSGO_Type_WeaponCase', 'Container');
    case 'agent':
      return tag('Type_CustomPlayer', 'Agent');
    case 'other':
      return tag('CSGO_Type_Collectible', 'Collectible');
  }
}

const EXTERIOR_INTERNAL: Readonly<Record<WearName, string>> = {
  'Factory New': 'WearCategory0',
  'Minimal Wear': 'WearCategory1',
  'Field-Tested': 'WearCategory2',
  'Well-Worn': 'WearCategory3',
  'Battle-Scarred': 'WearCategory4',
};

function tagsFor(name: string, category: ItemCategory): RawTag[] {
  const tags: RawTag[] = [typeTagFor(name, category)];

  const wear = wearOf(name);
  if (wear) {
    tags.push({
      category: 'Exterior',
      internal_name: EXTERIOR_INTERNAL[wear],
      localized_category_name: 'Exterior',
      localized_tag_name: wear,
    });
  }

  if (name.startsWith('★')) {
    tags.push({ category: 'Quality', internal_name: 'unusual', localized_category_name: 'Category', localized_tag_name: '★' });
  } else if (name.includes('StatTrak™')) {
    tags.push({ category: 'Quality', internal_name: 'strange', localized_category_name: 'Category', localized_tag_name: 'StatTrak™' });
  } else if (name.startsWith('Souvenir ')) {
    tags.push({ category: 'Quality', internal_name: 'tournament', localized_category_name: 'Category', localized_tag_name: 'Souvenir' });
  } else if (['knife', 'gloves', 'rifle', 'pistol', 'smg', 'heavy'].includes(category)) {
    tags.push({ category: 'Quality', internal_name: 'normal', localized_category_name: 'Category', localized_tag_name: 'Normal' });
  }
  return tags;
}

function stickerInfoLine(stickers: readonly string[]): { name: string; type: string; value: string } {
  const imgs = stickers
    .map(() => '<img width=64 height=48 src="https://community.cloudflare.steamstatic.com/economy/sticker/placeholder.png">')
    .join('');
  return {
    name: 'sticker_info',
    type: 'html',
    value:
      '<br><div id="sticker_info" name="sticker_info" title="Sticker" ' +
      'style="border: 2px solid rgb(102, 102, 102); border-radius: 3px; width=100; margin:4px; padding:8px;">' +
      `<center>${imgs}<br>Sticker: ${stickers.join(', ')}</center></div>`,
  };
}

// ---------------------------------------------------------------------------
// Build the fixture response + extras.
// ---------------------------------------------------------------------------

/** Past 12 months relative to mid-2026 (fixture is frozen in time on purpose). */
const ACQUISITION_MONTHS = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
] as const;

interface BuiltFixture {
  response: RawInventoryResponse;
  extras: Record<string, FixtureExtra>;
}

function buildFixture(): BuiltFixture {
  const assets: RawAsset[] = [];
  const descriptions: RawDescription[] = [];
  const extras: Record<string, FixtureExtra> = {};
  /** Description reuse for exact duplicates: roster key → {classid, instanceid}. */
  const descriptionIds = new Map<string, { classid: string; instanceid: string }>();
  let nextClassSeq = 0;

  ROSTER.forEach((entry, index) => {
    const { name } = entry;
    const stickers = entry.stickers ?? [];
    const category: ItemCategory = MOCK_UNIVERSE_BY_NAME.get(name)?.category ?? EXTRA_CATEGORIES[name] ?? 'other';
    const wear = wearOf(name);
    const hash = fnv1a(`${name}#${stickers.join(',')}`);
    const assetid = String(36021450000 + index * 137 + (hash % 97));

    const dedupeKey = `${name}||${stickers.join(',')}`;
    let ids = descriptionIds.get(dedupeKey);
    if (!ids) {
      // Same skin shares a classid; a stickered copy gets its own instanceid.
      const baseIds = descriptionIds.get(`${name}||`);
      const classid = baseIds ? baseIds.classid : String(5254212000 + ++nextClassSeq * 31);
      const isCommodity = category === 'case' || category === 'sticker';
      const instanceid = stickers.length > 0 ? String(188530000 + (hash % 9999)) : isCommodity ? '0' : '302028390';
      ids = { classid, instanceid };
      descriptionIds.set(dedupeKey, ids);
      if (!baseIds && stickers.length === 0) descriptionIds.set(`${name}||`, ids);

      descriptions.push({
        appid: 730,
        classid,
        instanceid,
        background_color: '',
        icon_url: pseudoIconHash(name),
        descriptions: stickers.length > 0 ? [stickerInfoLine(stickers)] : [{ type: 'html', value: ' ' }],
        tradable: 1,
        name: name.replace(WEAR_RE, '').trim(),
        name_color: 'D2D2D2',
        type: wear ? 'Classified Rifle' : category === 'case' ? 'Base Grade Container' : 'High Grade Collectible',
        market_name: name,
        market_hash_name: name,
        commodity: isCommodity ? 1 : 0,
        market_tradable_restriction: 7,
        marketable: 1,
        tags: tagsFor(name, category),
      });
    }

    assets.push({
      appid: 730,
      contextid: '2',
      assetid,
      classid: ids.classid,
      instanceid: ids.instanceid,
      amount: '1',
    });

    // Simulated inspect + acquisition data (live data exposes none of this).
    const extra: FixtureExtra = {};
    if (wear) {
      const [min, max] = FLOAT_BRACKETS[wear];
      extra.floatValue = Number((min + ((hash % 1000) / 1000) * (max - min)).toFixed(6));
      extra.paintSeed = hash % 1000;
    }
    const month = ACQUISITION_MONTHS[index % ACQUISITION_MONTHS.length];
    const day = String(1 + (hash % 27)).padStart(2, '0');
    const hour = String(hash % 24).padStart(2, '0');
    const minute = String((hash >>> 8) % 60).padStart(2, '0');
    extra.acquiredAt = `${month}-${day}T${hour}:${minute}:00.000Z`;
    extras[assetid] = extra;
  });

  return {
    response: {
      assets,
      descriptions,
      total_inventory_count: assets.length,
      success: 1,
    },
    extras,
  };
}

const BUILT = buildFixture();

/** ~30-asset fixture inventory in the exact live-response shape. */
export const FIXTURE_INVENTORY: RawInventoryResponse = BUILT.response;

/**
 * Simulated inspect-flow (floatValue/paintSeed) + acquisition dates, keyed by
 * assetid. Applied ONLY in fixture mode (./index.ts) — the live community
 * inventory endpoint exposes neither, so live items keep nulls.
 */
export const FIXTURE_EXTRAS: Record<string, FixtureExtra> = BUILT.extras;
