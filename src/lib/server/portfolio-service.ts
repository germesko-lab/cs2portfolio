/**
 * Stream D — portfolio orchestration. Glues steam (A), prices (B) and
 * valuation (C) behind the API routes. All money is integer cents (USD).
 */
import { fetchInventory, SteamInventoryError, SteamResolveError } from '../steam';
import { priceService } from '../prices';
import {
  valuePosition,
  valuePortfolio,
  estimateAutoCostBasis,
  buildSnapshot,
  upsertCostBasis,
  deleteCostBasis,
  getAllCostBasis,
  upsertSnapshot,
  backfillSnapshots,
  clearSnapshots,
} from '../valuation';
import { getMeta, setMeta } from '../db';
import { getItem, getItems, getPositions, upsertItems } from './items-repo';
import type {
  CanonicalItem,
  Cents,
  IsoDay,
  Position,
  SnapshotPoint,
} from '../contracts/types';
import type { BestPrice, PricePoint, PriceStatus } from '../contracts/pricing';
import type { PositionValuation } from '../contracts/valuation';
import type {
  ApiResult,
  PortfolioResponse,
  RefreshResponse,
  SyncResponse,
} from '../contracts/api';

/** Quotes fetched within this window count as 'live'; older ones 'cached'. */
const FRESH_WINDOW_MS = 15 * 60 * 1000;
const BACKFILL_DAYS = 30;
const HISTORY_DAYS = 365;

/* ------------------------------------------------------------------ */
/* Error type + envelope helper shared by the API routes               */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Map any thrown value to an { status, body } pair for the ApiResult error
 * envelope. Non-ApiError failures use `fallbackStatus` (502 for routes that
 * talk to upstreams, 500 otherwise).
 */
export function errorEnvelope(
  err: unknown,
  fallbackStatus: 500 | 502,
): { status: number; body: ApiResult<never> } {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { ok: false, error: { code: err.code, message: err.message } },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const code = fallbackStatus === 502 ? 'UPSTREAM_ERROR' : 'INTERNAL_ERROR';
  return { status: fallbackStatus, body: { ok: false, error: { code, message } } };
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function todayUtc(): IsoDay {
  return new Date().toISOString().slice(0, 10);
}

function freshness(best: BestPrice): PriceStatus {
  const fetched = Date.parse(best.best.fetchedAt);
  if (Number.isFinite(fetched) && Date.now() - fetched <= FRESH_WINDOW_MS) {
    return 'live';
  }
  return 'cached';
}

/** Nearest at-or-before price point for a UTC day; null when none exists. */
function priceAtOrBefore(history: PricePoint[], day: IsoDay): Cents | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const point = history[i]!;
    if (point.day <= day) return point.priceCents;
  }
  return null;
}

function distinctNames(items: CanonicalItem[]): string[] {
  return [...new Set(items.map((i) => i.marketHashName))];
}

/** Value one asset's position using a fresh best-price lookup for its name. */
async function valueSinglePosition(item: CanonicalItem): Promise<PositionValuation> {
  const best = await priceService.getBestPrices([item.marketHashName]);
  const bestPrice = best.get(item.marketHashName) ?? null;
  const status: PriceStatus = bestPrice ? freshness(bestPrice) : 'missing';
  const position: Position = {
    item,
    costBasis: getAllCostBasis().get(item.assetId) ?? null,
  };
  return valuePosition(position, bestPrice, status);
}

/* ------------------------------------------------------------------ */
/* Public service surface                                              */
/* ------------------------------------------------------------------ */

/** Map typed steam-layer failures onto user-facing ApiError responses. */
function toApiError(err: unknown): unknown {
  if (err instanceof SteamResolveError) {
    const status = err.code === 'NETWORK' || err.code === 'HTTP_ERROR' ? 502 : 400;
    return new ApiError(status, err.code, err.message);
  }
  if (err instanceof SteamInventoryError) {
    const status =
      err.code === 'RATE_LIMITED' ? 429
      : err.code === 'PRIVATE_INVENTORY' ? 403
      : err.code === 'NOT_FOUND' ? 404
      : 502;
    return new ApiError(status, err.code, err.message);
  }
  return err;
}

export async function syncInventory(input: string | null): Promise<SyncResponse> {
  let steamId: string, items: CanonicalItem[], source: 'fixture' | 'live';
  try {
    ({ steamId, items, source } = await fetchInventory(input));
  } catch (err) {
    throw toApiError(err);
  }

  // A different account is a different portfolio — its value series must not
  // continue the previous one (that reads as a fake cliff on the chart).
  const previousSteamId = getMeta('steam_id');
  if (previousSteamId !== null && previousSteamId !== steamId) {
    clearSnapshots();
  }

  upsertItems(items);

  const names = distinctNames(items);

  // One history fetch per distinct name — reused for auto cost basis and
  // the initial snapshot backfill.
  const historyByName = new Map<string, PricePoint[]>();
  for (const name of names) {
    historyByName.set(name, await priceService.getPriceHistory(name, HISTORY_DAYS));
  }

  // Auto-estimate a cost basis for every item that doesn't have one yet
  // (manual overrides and previous estimates are left untouched).
  const existingBasis = getAllCostBasis();
  const needsBasis = items.filter((i: CanonicalItem) => !existingBasis.has(i.assetId));
  let bestForFallback = new Map<string, BestPrice>();
  if (needsBasis.length > 0) {
    bestForFallback = await priceService.getBestPrices(distinctNames(needsBasis));
  }
  for (const item of needsBasis) {
    const history = historyByName.get(item.marketHashName) ?? [];
    const fallback = bestForFallback.get(item.marketHashName)?.best.priceCents ?? null;
    const amountCents = estimateAutoCostBasis(item.acquiredAt, history, fallback);
    if (amountCents !== null) {
      upsertCostBasis(item.assetId, {
        amountCents,
        currency: 'USD',
        source: 'auto',
        acquiredAt: item.acquiredAt,
      });
    }
  }

  // Backfill ~30 days of portfolio snapshots from item price history so the
  // chart renders immediately. backfillSnapshots never overwrites existing
  // days, so running on every sync is safe and fills gaps (e.g. when an
  // empty-portfolio load snapshotted today before the first sync ran).
  if (items.length > 0) {
    let investedCents = 0;
    for (const basis of getAllCostBasis().values()) investedCents += basis.amountCents;

    const points: SnapshotPoint[] = [];
    const now = new Date();
    for (let offset = BACKFILL_DAYS - 1; offset >= 0; offset--) {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
      );
      const day = date.toISOString().slice(0, 10);
      let totalValueCents = 0;
      for (const item of items) {
        const price = priceAtOrBefore(historyByName.get(item.marketHashName) ?? [], day);
        if (price !== null) totalValueCents += price;
      }
      // Days no source has history for stay unwritten: a $0 backfill reads
      // as a crash on the chart. With history-less sources (e.g. Skinport)
      // the series honestly starts today and builds forward.
      if (totalValueCents > 0) points.push({ day, totalValueCents, investedCents });
    }
    if (points.length > 0) backfillSnapshots(points);
  }

  const syncedAt = new Date().toISOString();
  setMeta('steam_id', steamId);
  setMeta('last_sync_at', syncedAt);

  return { steamId, itemCount: items.length, source, syncedAt };
}

export async function getPortfolio(): Promise<PortfolioResponse> {
  const positions = getPositions();
  const names = [...new Set(positions.map((p) => p.item.marketHashName))];
  const best =
    names.length > 0
      ? await priceService.getBestPrices(names)
      : new Map<string, BestPrice>();

  const statuses = new Map<string, PriceStatus>();
  for (const [name, bestPrice] of best) statuses.set(name, freshness(bestPrice));

  const valuation = valuePortfolio(positions, best, statuses, new Date().toISOString());
  upsertSnapshot(buildSnapshot(valuation, todayUtc()));

  return {
    valuation,
    steamId: getMeta('steam_id'),
    lastSyncAt: getMeta('last_sync_at'),
    priceSources: priceService.sources(),
  };
}

export async function refreshPrices(): Promise<RefreshResponse> {
  const names = distinctNames(getItems());
  const updatedBySource = await priceService.refresh(names);
  return { updatedBySource, refreshedAt: new Date().toISOString() };
}

export async function setManualCostBasis(
  assetId: string,
  amountCents: number,
): Promise<PositionValuation> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new ApiError(
      400,
      'INVALID_AMOUNT',
      'amountCents must be a non-negative integer number of cents',
    );
  }
  const item = getItem(assetId);
  if (!item) {
    throw new ApiError(404, 'UNKNOWN_ASSET', `No inventory item with assetId "${assetId}"`);
  }
  upsertCostBasis(assetId, {
    amountCents,
    currency: 'USD',
    source: 'manual',
    acquiredAt: item.acquiredAt,
  });
  return valueSinglePosition(item);
}

export async function resetCostBasis(assetId: string): Promise<PositionValuation> {
  const item = getItem(assetId);
  if (!item) {
    throw new ApiError(404, 'UNKNOWN_ASSET', `No inventory item with assetId "${assetId}"`);
  }

  // Recompute the auto estimate exactly like sync does.
  const history = await priceService.getPriceHistory(item.marketHashName, HISTORY_DAYS);
  const best = await priceService.getBestPrices([item.marketHashName]);
  const fallback = best.get(item.marketHashName)?.best.priceCents ?? null;
  const amountCents = estimateAutoCostBasis(item.acquiredAt, history, fallback);
  if (amountCents !== null) {
    upsertCostBasis(assetId, {
      amountCents,
      currency: 'USD',
      source: 'auto',
      acquiredAt: item.acquiredAt,
    });
  } else {
    deleteCostBasis(assetId);
  }

  const bestPrice = best.get(item.marketHashName) ?? null;
  const status: PriceStatus = bestPrice ? freshness(bestPrice) : 'missing';
  const position: Position = {
    item,
    costBasis: getAllCostBasis().get(assetId) ?? null,
  };
  return valuePosition(position, bestPrice, status);
}
