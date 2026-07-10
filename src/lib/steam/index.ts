/**
 * Stream A public surface — inventory acquisition.
 *
 * fetchInventory(input):
 *   - demo/fixture mode: input is null. Normalizes the bundled 30-item
 *     fixture and applies FIXTURE_EXTRAS (simulated float/paint-seed/
 *     acquiredAt — see ./fixture.ts). Nothing hits Valve. This keeps the app
 *     fully runnable with zero external calls.
 *   - live mode: input is anything a user pasted (SteamID64 / profile URL /
 *     vanity URL / trade offer URL). Resolved via ./resolve.ts, fetched from
 *     the real community endpoint (rate-limited; explicit user sync only —
 *     LEGAL.md) and run through the same normalization pipeline as the
 *     fixture. Served from a short-TTL in-memory cache when fresh; during a
 *     429 cooldown a stale cache is served if one exists.
 *
 * Live mode is deliberately independent of PRICE_SOURCE_MODE: pasting an
 * inventory link is an explicit user action, while PRICE_SOURCE_MODE keeps
 * governing the price adapters (DECISIONS.md).
 */
import type { CanonicalItem } from '../contracts/types';
import { fetchLiveInventory, SteamInventoryError } from './client';
import { FIXTURE_EXTRAS, FIXTURE_INVENTORY, FIXTURE_STEAM_ID } from './fixture';
import {
  cooldownRemainingSec,
  getAnyCached,
  getFreshCached,
  startCooldown,
  storeCached,
} from './inventory-cache';
import { normalizeInventory } from './normalize';
import { resolveSteamInput } from './resolve';
import type { RawInventoryResponse } from './raw-types';

export interface FetchInventoryResult {
  steamId: string;
  items: CanonicalItem[];
  source: 'fixture' | 'live';
}

function fixtureInventory(): FetchInventoryResult {
  const items = normalizeInventory(FIXTURE_INVENTORY).map((item): CanonicalItem => {
    const extra = FIXTURE_EXTRAS[item.assetId];
    if (!extra) return item;
    const patched = {
      ...item,
      floatValue: extra.floatValue ?? item.floatValue,
      paintSeed: extra.paintSeed ?? item.paintSeed,
      acquiredAt: extra.acquiredAt ?? item.acquiredAt,
    };
    return { ...patched, itemKey: itemKeyFor(patched), enrichmentStatus: 'success', enrichmentProvider: 'fixture' };
  });
  return { steamId: FIXTURE_STEAM_ID, items, source: 'fixture' };
}

function itemKeyFor(item: CanonicalItem): string {
  return [
    item.marketHashName,
    item.floatValue == null ? '' : item.floatValue.toFixed(8),
    item.paintSeed == null ? '' : String(item.paintSeed),
    item.statTrak ? '1' : '0',
    item.souvenir ? '1' : '0',
  ].join('|');
}

async function liveRaw(steamId64: string): Promise<RawInventoryResponse> {
  const fresh = getFreshCached(steamId64);
  if (fresh) return fresh;

  const cooldown = cooldownRemainingSec(steamId64);
  if (cooldown > 0) {
    const stale = getAnyCached(steamId64);
    if (stale) return stale;
    throw new SteamInventoryError(
      'RATE_LIMITED',
      `Steam rate-limited requests for this inventory. Try again in ~${cooldown}s.`,
      429,
    );
  }

  try {
    const raw = await fetchLiveInventory(steamId64);
    storeCached(steamId64, raw);
    return raw;
  } catch (err) {
    if (err instanceof SteamInventoryError && err.code === 'RATE_LIMITED') {
      startCooldown(steamId64);
      const stale = getAnyCached(steamId64);
      if (stale) return stale;
    }
    throw err;
  }
}

export async function fetchInventory(input: string | null): Promise<FetchInventoryResult> {
  if (input === null) return fixtureInventory();

  const steamId64 = await resolveSteamInput(input);
  const raw = await liveRaw(steamId64);
  return { steamId: steamId64, items: normalizeInventory(raw), source: 'live' };
}

export { normalizeInventory } from './normalize';
export { fetchLiveInventory, SteamInventoryError } from './client';
export type { SteamInventoryErrorCode } from './client';
export { parseSteamInput, resolveSteamInput, SteamResolveError } from './resolve';
export type { ParsedSteamInput, SteamResolveErrorCode } from './resolve';
export { FIXTURE_INVENTORY, FIXTURE_EXTRAS, FIXTURE_STEAM_ID } from './fixture';
export type { FixtureExtra } from './fixture';
export type * from './raw-types';
