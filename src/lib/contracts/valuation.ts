/**
 * FROZEN CONTRACT — valuation & P/L shapes and function signatures.
 * Stream C implements these in src/lib/valuation/engine.ts (pure functions,
 * exact exported names below). The orchestrator owns this file.
 */
import type {
  CanonicalItem,
  Cents,
  IsoDay,
  IsoTimestamp,
  ItemCategory,
  Position,
  SnapshotPoint,
} from './types';
import type { BestPrice, PricePoint, PriceStatus } from './pricing';

export interface PositionValuation {
  assetId: string;
  marketHashName: string;
  item: CanonicalItem;
  /** Value at best price; null when no source can price the item. */
  currentValueCents: Cents | null;
  bestPrice: BestPrice | null;
  costBasisCents: Cents | null;
  costBasisSource: 'auto' | 'manual' | null;
  /** currentValue − costBasis; null (never 0) if either side is missing. */
  unrealizedPlCents: Cents | null;
  /** unrealizedPl / costBasis * 100; null when not computable. */
  unrealizedPlPct: number | null;
  priceStatus: PriceStatus;
  priceSource: string | null;
  priceFetchedAt: IsoTimestamp | null;
  priceConfidence: number | null;
}

export interface CategoryAllocation {
  category: ItemCategory | 'unpriced';
  valueCents: Cents;
  /** Share of total priced portfolio value, 0..100. */
  weightPct: number;
  positionCount: number;
}

export interface PortfolioValuation {
  asOf: IsoTimestamp;
  /** Sum of currentValueCents over priced positions. */
  totalValueCents: Cents;
  /** Sum of cost basis over positions that HAVE a cost basis. */
  investedCents: Cents;
  /** Alias for the known cost basis sum; kept explicit for dashboard copy. */
  knownCostBasisCents: Cents;
  /** Sum of per-position unrealized P/L where computable. */
  unrealizedPlCents: Cents;
  /** unrealizedPl / invested * 100 over computable positions; null if invested=0. */
  unrealizedPlPct: number | null;
  realizedPnlCents: Cents | null;
  allTimePnlCents: Cents | null;
  allTimePnlPct: number | null;
  dailyChangeCents: Cents | null;
  dailyChangePct: number | null;
  totalPositions: number;
  /** Positions with a live/cached price (rest are 'missing'). */
  pricedPositions: number;
  priceKnownCount: number;
  priceMissingCount: number;
  costBasisKnownCount: number;
  costBasisMissingCount: number;
  noPriceItemCount: number;
  missingCostBasisItemCount: number;
  positions: PositionValuation[];
  byCategory: CategoryAllocation[];
  /** Top N by unrealizedPlCents desc/asc; only computable positions. N=5. */
  topGainers: PositionValuation[];
  topLosers: PositionValuation[];
  dataCompleteness: DataCompleteness;
}

export interface DataCompleteness {
  totalItems: number;
  priceKnownCount: number;
  priceMissingCount: number;
  costBasisKnownCount: number;
  costBasisMissingCount: number;
  enrichmentKnownCount: number;
  enrichmentMissingCount: number;
}

/* ------------------------------------------------------------------ */
/* Function signatures stream C must export from src/lib/valuation/engine.ts */
/* ------------------------------------------------------------------ */

/** Value one position against its best price (pure). */
export type ValuePositionFn = (
  position: Position,
  bestPrice: BestPrice | null,
  priceStatus: PriceStatus,
) => PositionValuation;

/** Value the whole portfolio; sorts gainers/losers, builds allocation (pure). */
export type ValuePortfolioFn = (
  positions: Position[],
  bestPrices: Map<string, BestPrice>,
  /** priceStatus per marketHashName; absent ⇒ 'missing'. */
  statuses: Map<string, PriceStatus>,
  asOf: IsoTimestamp,
) => PortfolioValuation;

/**
 * Hybrid cost-basis auto-estimate: price on the acquisition day from the
 * history series (nearest earlier point), else earliest point. Unknown
 * acquisition dates remain unknown; fallbackCurrentCents must not be a
 * current market price.
 */
export type EstimateAutoCostBasisFn = (
  acquiredAt: IsoTimestamp | null,
  history: PricePoint[],
  fallbackCurrentCents: Cents | null,
) => Cents | null;

/**
 * Build today's snapshot point from a valuation (pure); persistence of the
 * daily series is stream C's snapshots module (upsert by day).
 */
export type BuildSnapshotFn = (
  valuation: PortfolioValuation,
  day: IsoDay,
) => SnapshotPoint;
