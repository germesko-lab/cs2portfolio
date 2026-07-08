/**
 * Stream A public surface — inventory acquisition.
 *
 * fetchInventory(steamId):
 *   - fixture mode (default): steamId is null OR PRICE_SOURCE_MODE !== 'live'.
 *     Normalizes the bundled fixture and applies FIXTURE_EXTRAS (simulated
 *     float/paint-seed/acquiredAt — see ./fixture.ts). Nothing hits Valve.
 *   - live mode: fetches the real community inventory endpoint (rate-limited;
 *     explicit user sync only — LEGAL.md) and normalizes it. Float/paint-seed/
 *     acquiredAt stay null from live data.
 */
import type { CanonicalItem } from '../contracts/types';
import { fetchLiveInventory } from './client';
import { FIXTURE_EXTRAS, FIXTURE_INVENTORY, FIXTURE_STEAM_ID } from './fixture';
import { normalizeInventory } from './normalize';

export interface FetchInventoryResult {
  steamId: string;
  items: CanonicalItem[];
  source: 'fixture' | 'live';
}

export async function fetchInventory(steamId: string | null): Promise<FetchInventoryResult> {
  const liveMode = steamId !== null && process.env.PRICE_SOURCE_MODE === 'live';

  if (!liveMode) {
    const items = normalizeInventory(FIXTURE_INVENTORY).map((item): CanonicalItem => {
      const extra = FIXTURE_EXTRAS[item.assetId];
      if (!extra) return item;
      return {
        ...item,
        floatValue: extra.floatValue ?? item.floatValue,
        paintSeed: extra.paintSeed ?? item.paintSeed,
        acquiredAt: extra.acquiredAt ?? item.acquiredAt,
      };
    });
    return { steamId: FIXTURE_STEAM_ID, items, source: 'fixture' };
  }

  const raw = await fetchLiveInventory(steamId);
  return { steamId, items: normalizeInventory(raw), source: 'live' };
}

export { normalizeInventory } from './normalize';
export { fetchLiveInventory, SteamInventoryError } from './client';
export type { SteamInventoryErrorCode } from './client';
export { FIXTURE_INVENTORY, FIXTURE_EXTRAS, FIXTURE_STEAM_ID } from './fixture';
export type { FixtureExtra } from './fixture';
export type * from './raw-types';
