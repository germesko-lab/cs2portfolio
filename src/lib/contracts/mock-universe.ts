/**
 * FROZEN CONTRACT — shared mock item universe.
 * Stream A's inventory fixture and stream B's mock price source MUST both be
 * built from exactly these marketHashNames so every mock inventory item is
 * priceable. `anchorPriceCents` is the realistic "current" price the mock
 * source varies around (deterministically); it is NOT used by real adapters.
 * Orchestrator-owned; do not edit.
 */
import type { Cents } from './types';
import type { ItemCategory } from './types';

export interface MockUniverseEntry {
  marketHashName: string;
  category: ItemCategory;
  anchorPriceCents: Cents;
}

export const MOCK_UNIVERSE: readonly MockUniverseEntry[] = [
  // Knives / gloves — high value
  { marketHashName: '★ Karambit | Doppler (Factory New)', category: 'knife', anchorPriceCents: 145000 },
  { marketHashName: '★ M9 Bayonet | Marble Fade (Factory New)', category: 'knife', anchorPriceCents: 168000 },
  { marketHashName: '★ Butterfly Knife | Case Hardened (Field-Tested)', category: 'knife', anchorPriceCents: 132500 },
  { marketHashName: '★ Sport Gloves | Pandora’s Box (Field-Tested)', category: 'gloves', anchorPriceCents: 289000 },
  { marketHashName: '★ Driver Gloves | Crimson Weave (Minimal Wear)', category: 'gloves', anchorPriceCents: 87000 },
  // Rifles
  { marketHashName: 'AK-47 | Redline (Field-Tested)', category: 'rifle', anchorPriceCents: 4850 },
  { marketHashName: 'AK-47 | Asiimov (Minimal Wear)', category: 'rifle', anchorPriceCents: 15800 },
  { marketHashName: 'StatTrak™ AK-47 | Vulcan (Minimal Wear)', category: 'rifle', anchorPriceCents: 62000 },
  { marketHashName: 'M4A4 | Howl (Field-Tested)', category: 'rifle', anchorPriceCents: 465000 },
  { marketHashName: 'M4A1-S | Printstream (Factory New)', category: 'rifle', anchorPriceCents: 32500 },
  { marketHashName: 'AWP | Asiimov (Field-Tested)', category: 'rifle', anchorPriceCents: 14200 },
  { marketHashName: 'StatTrak™ AWP | Hyper Beast (Field-Tested)', category: 'rifle', anchorPriceCents: 9800 },
  { marketHashName: 'Souvenir AWP | Dragon Lore (Battle-Scarred)', category: 'rifle', anchorPriceCents: 1250000 },
  { marketHashName: 'FAMAS | Mecha Industries (Factory New)', category: 'rifle', anchorPriceCents: 1450 },
  // Pistols
  { marketHashName: 'Desert Eagle | Blaze (Factory New)', category: 'pistol', anchorPriceCents: 42000 },
  { marketHashName: 'Glock-18 | Fade (Factory New)', category: 'pistol', anchorPriceCents: 98000 },
  { marketHashName: 'USP-S | Kill Confirmed (Minimal Wear)', category: 'pistol', anchorPriceCents: 12400 },
  { marketHashName: 'P250 | See Ya Later (Well-Worn)', category: 'pistol', anchorPriceCents: 620 },
  // SMG / heavy
  { marketHashName: 'MP9 | Hot Rod (Factory New)', category: 'smg', anchorPriceCents: 2850 },
  { marketHashName: 'P90 | Death by Kitty (Minimal Wear)', category: 'smg', anchorPriceCents: 21500 },
  { marketHashName: 'Nova | Hyper Beast (Battle-Scarred)', category: 'heavy', anchorPriceCents: 380 },
  // Stickers / cases / agents
  { marketHashName: 'Sticker | Natus Vincere (Holo) | Katowice 2015', category: 'sticker', anchorPriceCents: 89500 },
  { marketHashName: 'Sticker | Crown (Foil)', category: 'sticker', anchorPriceCents: 52000 },
  { marketHashName: 'Operation Bravo Case', category: 'case', anchorPriceCents: 4200 },
  { marketHashName: 'Dreams & Nightmares Case', category: 'case', anchorPriceCents: 95 },
  { marketHashName: "Sir Bloody Miami Darryl | The Professionals", category: 'agent', anchorPriceCents: 1680 },
] as const;

/** Quick lookup by marketHashName. */
export const MOCK_UNIVERSE_BY_NAME: ReadonlyMap<string, MockUniverseEntry> = new Map(
  MOCK_UNIVERSE.map((e) => [e.marketHashName, e]),
);
