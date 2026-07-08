/**
 * In-memory per-SteamID64 cache + 429 cooldown for the community inventory
 * endpoint (LEGAL.md: it rate-limits aggressively, so repeated syncs within
 * the TTL are served from memory and never hit Valve). Survives Next.js
 * dev-mode reloads via globalThis, same pattern as src/lib/db.ts.
 */
import type { RawInventoryResponse } from './raw-types';

const CACHE_TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 2 * 60_000;

interface CacheEntry {
  raw: RawInventoryResponse;
  fetchedAt: number;
}

declare global {
  var __cs2InvCache: Map<string, CacheEntry> | undefined;
  var __cs2InvCooldown: Map<string, number> | undefined;
}

const cache: Map<string, CacheEntry> = globalThis.__cs2InvCache ?? (globalThis.__cs2InvCache = new Map());
const cooldownUntil: Map<string, number> =
  globalThis.__cs2InvCooldown ?? (globalThis.__cs2InvCooldown = new Map());

/** Raw inventory fetched within the TTL, else null. */
export function getFreshCached(steamId64: string): RawInventoryResponse | null {
  const entry = cache.get(steamId64);
  return entry && Date.now() - entry.fetchedAt <= CACHE_TTL_MS ? entry.raw : null;
}

/** Any cached inventory regardless of age (stale fallback during a 429). */
export function getAnyCached(steamId64: string): RawInventoryResponse | null {
  return cache.get(steamId64)?.raw ?? null;
}

export function storeCached(steamId64: string, raw: RawInventoryResponse): void {
  cache.set(steamId64, { raw, fetchedAt: Date.now() });
}

/** Seconds until the 429 cooldown expires, or 0 when not cooling down. */
export function cooldownRemainingSec(steamId64: string): number {
  const until = cooldownUntil.get(steamId64) ?? 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export function startCooldown(steamId64: string): void {
  cooldownUntil.set(steamId64, Date.now() + COOLDOWN_MS);
}
