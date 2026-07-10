/**
 * FROZEN CONTRACT — API DTOs. Stream D implements routes returning exactly
 * these shapes; stream E consumes them. The orchestrator owns this file.
 *
 * Routes (Next.js App Router, all JSON):
 *   POST   /api/inventory/sync                 → SyncResponse
 *          body: { input?: string }             SteamID64 / profile URL /
 *          vanity URL / trade offer URL; omitted/empty syncs the signed-in
 *          user's SteamID. "demo" loads the fixture into that user's
 *          portfolio. { steamId } is a legacy alias. Errors: 400
 *          unrecognized input or vanity without STEAM_API_KEY, 403 private
 *          inventory, 404 unknown account, 429 Steam rate limit.
 *   GET    /api/portfolio                      → PortfolioResponse
 *   POST   /api/prices/refresh                 → RefreshResponse
 *   GET    /api/history?days=N                 → HistoryResponse (default 30)
 *   PATCH  /api/positions/[assetId]/cost-basis → CostBasisResponse
 *          body: { amountCents: number }        (sets manual override)
 *   DELETE /api/positions/[assetId]/cost-basis → CostBasisResponse
 *          (reverts to auto estimate)
 *
 * Every route responds with the ApiResult envelope. Errors use proper HTTP
 * status codes (401 auth required, 400 bad input, 404 unknown asset,
 * 502 upstream failure, 500 otherwise) AND the error envelope.
 */
import type { IsoTimestamp, SnapshotPoint } from './types';
import type { PriceSourceId } from './pricing';
import type { DataCompleteness, PortfolioValuation, PositionValuation } from './valuation';

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
  lastPriceRefreshAt: IsoTimestamp | null;
  syncStatus: SyncStatus;
  dataCompleteness: DataCompleteness;
  sourceWarnings: string[];
  priceSources: Array<{
    id: PriceSourceId;
    displayName: string;
    configured: boolean;
    requiresApiKey: boolean;
  }>;
}

export interface DashboardResponse extends PortfolioResponse {
  history: HistoryResponse;
  user: {
    id: number;
    steamId: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface SyncStatus {
  lastInventorySyncAt: IsoTimestamp | null;
  lastPriceRefreshAt: IsoTimestamp | null;
  lastEnrichmentRefreshAt: IsoTimestamp | null;
  failedSources: Array<{ source: string; message: string }>;
  missingPricesCount: number;
  missingCostBasisCount: number;
  missingEnrichmentCount: number;
  isRefreshing: boolean;
  lastError: string | null;
  freshness: 'fresh' | 'stale' | 'partial' | 'failed' | 'empty';
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
