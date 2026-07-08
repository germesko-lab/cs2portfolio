/**
 * FROZEN CONTRACT — API DTOs. Stream D implements routes returning exactly
 * these shapes; stream E consumes them. The orchestrator owns this file.
 *
 * Routes (Next.js App Router, all JSON):
 *   POST   /api/inventory/sync                 → SyncResponse
 *   GET    /api/portfolio                      → PortfolioResponse
 *   POST   /api/prices/refresh                 → RefreshResponse
 *   GET    /api/history?days=N                 → HistoryResponse (default 30)
 *   PATCH  /api/positions/[assetId]/cost-basis → CostBasisResponse
 *          body: { amountCents: number }        (sets manual override)
 *   DELETE /api/positions/[assetId]/cost-basis → CostBasisResponse
 *          (reverts to auto estimate)
 *
 * Every route responds with the ApiResult envelope. Errors use proper HTTP
 * status codes (400 bad input, 404 unknown asset, 502 upstream failure,
 * 500 otherwise) AND the error envelope.
 */
import type { IsoTimestamp, SnapshotPoint } from './types';
import type { PriceSourceId } from './pricing';
import type { PortfolioValuation, PositionValuation } from './valuation';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface SyncResponse {
  steamId: string;
  /** Items now in the portfolio after sync. */
  itemCount: number;
  /** 'fixture' when mock/fixture data was used, 'live' for a real fetch. */
  source: 'fixture' | 'live';
  syncedAt: IsoTimestamp;
}

export interface PortfolioResponse {
  valuation: PortfolioValuation;
  steamId: string | null;
  lastSyncAt: IsoTimestamp | null;
  priceSources: Array<{
    id: PriceSourceId;
    displayName: string;
    configured: boolean;
    requiresApiKey: boolean;
  }>;
}

export interface RefreshResponse {
  /** Quotes updated per sourceId, e.g. { mock: 24 }. */
  updatedBySource: Record<string, number>;
  refreshedAt: IsoTimestamp;
}

export interface HistoryResponse {
  days: number;
  points: SnapshotPoint[]; // oldest → newest
}

export interface CostBasisResponse {
  position: PositionValuation;
}
