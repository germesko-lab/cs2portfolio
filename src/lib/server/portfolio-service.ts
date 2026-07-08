/**
 * Stream D - portfolio orchestration. Glues auth, steam, prices and
 * valuation behind the API routes. All portfolio-owned state is scoped by
 * user_id; public market price caches stay shared.
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
import { getUserMeta, setUserMeta } from '../db';
import { getItem, getItems, getPositions, upsertItems } from './items-repo';
import { readSession, type AuthenticatedUser } from './steam-auth';
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

const FRESH_WINDOW_MS = 15 * 60 * 1000;
const BACKFILL_DAYS = 30;
const HISTORY_DAYS = 365;

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

export function requireUser(request: Request): AuthenticatedUser {
  const user = readSession(request.headers.get('cookie'));
  if (!user) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in through Steam to view this portfolio.');
  }
  return user;
}

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

function todayUtc(): IsoDay {
  return new Date().toISOString().slice(0, 10);
}

function freshness(best: BestPrice): PriceStatus {
  const fetched = Date.parse(best.best.fetchedAt);
  if (Number.isFinite(fetched) && Date.now() - fetched <= FRESH_WINDOW_MS) return 'live';
  return 'cached';
}

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

async function valueSinglePosition(
  user: AuthenticatedUser,
  item: CanonicalItem,
): Promise<PositionValuation> {
  const best = await priceService.getBestPrices([item.marketHashName]);
  const bestPrice = best.get(item.marketHashName) ?? null;
  const status: PriceStatus = bestPrice ? freshness(bestPrice) : 'missing';
  const position: Position = {
    item,
    costBasis: getAllCostBasis(user.id).get(item.assetId) ?? null,
  };
  return valuePosition(position, bestPrice, status);
}

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

export async function syncInventory(
  user: AuthenticatedUser,
  input: string | null,
  forceDemo = false,
): Promise<SyncResponse> {
  let steamId: string, items: CanonicalItem[], source: 'fixture' | 'live';
  try {
    ({ steamId, items, source } = await fetchInventory(forceDemo ? null : input ?? user.steamId));
  } catch (err) {
    throw toApiError(err);
  }

  const previousSteamId = getUserMeta(user.id, 'steam_id');
  if (previousSteamId !== null && previousSteamId !== steamId) {
    clearSnapshots(user.id);
  }

  upsertItems(user.id, items);

  const namesWithAcquisition = distinctNames(items.filter((i) => i.acquiredAt !== null));
  const historyByName = new Map<string, PricePoint[]>();
  for (const name of namesWithAcquisition) {
    historyByName.set(name, await priceService.getPriceHistory(name, HISTORY_DAYS));
  }

  const existingBasis = getAllCostBasis(user.id);
  const needsBasis = items.filter((i) => !existingBasis.has(i.assetId));
  let bestForFallback = new Map<string, BestPrice>();
  if (needsBasis.length > 0) {
    bestForFallback = await priceService.getBestPrices(distinctNames(needsBasis));
  }
  for (const item of needsBasis) {
    const history = historyByName.get(item.marketHashName) ?? [];
    const fallback = bestForFallback.get(item.marketHashName)?.best.priceCents ?? null;
    const amountCents = estimateAutoCostBasis(item.acquiredAt, history, fallback);
    if (amountCents !== null) {
      upsertCostBasis(user.id, item.assetId, {
        amountCents,
        currency: 'USD',
        source: 'auto',
        acquiredAt: item.acquiredAt,
      });
    }
  }

  if (items.length > 0) {
    let investedCents = 0;
    for (const basis of getAllCostBasis(user.id).values()) investedCents += basis.amountCents;

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
      if (totalValueCents > 0) points.push({ day, totalValueCents, investedCents });
    }
    if (points.length > 0) backfillSnapshots(user.id, points);
  }

  const syncedAt = new Date().toISOString();
  setUserMeta(user.id, 'steam_id', steamId);
  setUserMeta(user.id, 'last_sync_at', syncedAt);

  return { steamId, itemCount: items.length, source, syncedAt };
}

export async function getPortfolio(user: AuthenticatedUser): Promise<PortfolioResponse> {
  const positions = getPositions(user.id);
  const names = [...new Set(positions.map((p) => p.item.marketHashName))];
  const best =
    names.length > 0
      ? await priceService.getBestPrices(names)
      : new Map<string, BestPrice>();

  const statuses = new Map<string, PriceStatus>();
  for (const [name, bestPrice] of best) statuses.set(name, freshness(bestPrice));

  const valuation = valuePortfolio(positions, best, statuses, new Date().toISOString());
  upsertSnapshot(user.id, buildSnapshot(valuation, todayUtc()));

  return {
    valuation,
    steamId: getUserMeta(user.id, 'steam_id') ?? user.steamId,
    lastSyncAt: getUserMeta(user.id, 'last_sync_at'),
    priceSources: priceService.sources(),
  };
}

export async function refreshPrices(user: AuthenticatedUser): Promise<RefreshResponse> {
  const names = distinctNames(getItems(user.id));
  const updatedBySource = await priceService.refresh(names);
  return { updatedBySource, refreshedAt: new Date().toISOString() };
}

export async function setManualCostBasis(
  user: AuthenticatedUser,
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
  const item = getItem(user.id, assetId);
  if (!item) {
    throw new ApiError(404, 'UNKNOWN_ASSET', `No inventory item with assetId "${assetId}"`);
  }
  upsertCostBasis(user.id, assetId, {
    amountCents,
    currency: 'USD',
    source: 'manual',
    acquiredAt: item.acquiredAt,
  });
  return valueSinglePosition(user, item);
}

export async function resetCostBasis(
  user: AuthenticatedUser,
  assetId: string,
): Promise<PositionValuation> {
  const item = getItem(user.id, assetId);
  if (!item) {
    throw new ApiError(404, 'UNKNOWN_ASSET', `No inventory item with assetId "${assetId}"`);
  }

  const history = await priceService.getPriceHistory(item.marketHashName, HISTORY_DAYS);
  const best = await priceService.getBestPrices([item.marketHashName]);
  const fallback = best.get(item.marketHashName)?.best.priceCents ?? null;
  const amountCents = estimateAutoCostBasis(item.acquiredAt, history, fallback);
  if (amountCents !== null) {
    upsertCostBasis(user.id, assetId, {
      amountCents,
      currency: 'USD',
      source: 'auto',
      acquiredAt: item.acquiredAt,
    });
  } else {
    deleteCostBasis(user.id, assetId);
  }

  const bestPrice = best.get(item.marketHashName) ?? null;
  const status: PriceStatus = bestPrice ? freshness(bestPrice) : 'missing';
  const position: Position = {
    item,
    costBasis: getAllCostBasis(user.id).get(assetId) ?? null,
  };
  return valuePosition(position, bestPrice, status);
}
