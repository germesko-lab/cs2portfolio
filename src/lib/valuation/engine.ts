/**
 * Stream C — pure valuation engine. No DB, no env, no I/O.
 * Implements the frozen function signatures in ../contracts/valuation.
 */
import type {
  CategoryAllocation,
  PortfolioValuation,
  PositionValuation,
  BuildSnapshotFn,
  EstimateAutoCostBasisFn,
  ValuePortfolioFn,
  ValuePositionFn,
} from '../contracts/valuation';
import type { Cents, ItemCategory } from '../contracts/types';

const TOP_N = 5;

/** Value one position against its best price (pure). */
export const valuePosition: ValuePositionFn = (position, bestPrice, priceStatus) => {
  const currentValueCents: Cents | null = bestPrice ? bestPrice.best.priceCents : null;
  const costBasisCents: Cents | null = position.costBasis?.amountCents ?? null;
  const costBasisSource = position.costBasis?.source ?? null;

  // P/L is null (never 0) unless BOTH value and basis exist.
  const unrealizedPlCents: Cents | null =
    currentValueCents !== null && costBasisCents !== null
      ? currentValueCents - costBasisCents
      : null;

  // Pct needs a computable P/L and a non-zero basis.
  const unrealizedPlPct: number | null =
    unrealizedPlCents !== null && costBasisCents !== null && costBasisCents !== 0
      ? (unrealizedPlCents / costBasisCents) * 100
      : null;

  return {
    assetId: position.item.assetId,
    marketHashName: position.item.marketHashName,
    item: position.item,
    currentValueCents,
    bestPrice,
    costBasisCents,
    costBasisSource,
    unrealizedPlCents,
    unrealizedPlPct,
    priceStatus,
  };
};

/** Value the whole portfolio; sorts gainers/losers, builds allocation (pure). */
export const valuePortfolio: ValuePortfolioFn = (positions, bestPrices, statuses, asOf) => {
  const valuations: PositionValuation[] = positions.map((position) => {
    const mhn = position.item.marketHashName;
    const bestPrice = bestPrices.get(mhn) ?? null;
    const priceStatus = statuses.get(mhn) ?? 'missing';
    return valuePosition(position, bestPrice, priceStatus);
  });

  let totalValueCents: Cents = 0;
  let investedCents: Cents = 0;
  let unrealizedPlCents: Cents = 0;
  let pricedPositions = 0;

  for (const v of valuations) {
    if (v.currentValueCents !== null) {
      totalValueCents += v.currentValueCents;
      pricedPositions += 1;
    }
    if (v.costBasisCents !== null) {
      investedCents += v.costBasisCents;
    }
    if (v.unrealizedPlCents !== null) {
      unrealizedPlCents += v.unrealizedPlCents;
    }
  }

  const unrealizedPlPct: number | null =
    investedCents === 0 ? null : (unrealizedPlCents / investedCents) * 100;

  // Allocation over priced value only; empty when nothing is priced.
  const byCategoryMap = new Map<ItemCategory, { valueCents: Cents; positionCount: number }>();
  for (const v of valuations) {
    if (v.currentValueCents === null) continue;
    const entry = byCategoryMap.get(v.item.category) ?? { valueCents: 0, positionCount: 0 };
    entry.valueCents += v.currentValueCents;
    entry.positionCount += 1;
    byCategoryMap.set(v.item.category, entry);
  }
  const byCategory: CategoryAllocation[] =
    totalValueCents > 0
      ? [...byCategoryMap.entries()]
          .map(([category, { valueCents, positionCount }]) => ({
            category,
            valueCents,
            weightPct: (valueCents / totalValueCents) * 100,
            positionCount,
          }))
          .sort((a, b) => b.valueCents - a.valueCents)
      : [];

  // Only computable positions; gainers strictly > 0, losers strictly < 0.
  const computable = valuations.filter(
    (v): v is PositionValuation & { unrealizedPlCents: Cents } => v.unrealizedPlCents !== null,
  );
  const topGainers = computable
    .filter((v) => v.unrealizedPlCents > 0)
    .sort((a, b) => b.unrealizedPlCents - a.unrealizedPlCents)
    .slice(0, TOP_N);
  const topLosers = computable
    .filter((v) => v.unrealizedPlCents < 0)
    .sort((a, b) => a.unrealizedPlCents - b.unrealizedPlCents)
    .slice(0, TOP_N);

  // Positions sorted by current value desc, unpriced (null) last.
  const sortedPositions = [...valuations].sort((a, b) => {
    if (a.currentValueCents === null && b.currentValueCents === null) return 0;
    if (a.currentValueCents === null) return 1;
    if (b.currentValueCents === null) return -1;
    return b.currentValueCents - a.currentValueCents;
  });

  const result: PortfolioValuation = {
    asOf,
    totalValueCents,
    investedCents,
    unrealizedPlCents,
    unrealizedPlPct,
    totalPositions: positions.length,
    pricedPositions,
    positions: sortedPositions,
    byCategory,
    topGainers,
    topLosers,
  };
  return result;
};

/**
 * Hybrid cost-basis auto-estimate: nearest history point at-or-before the
 * acquisition DAY; if acquiredAt is null or earlier than all history, the
 * earliest point; empty history ⇒ fallbackCurrentCents ⇒ null (pure).
 */
export const estimateAutoCostBasis: EstimateAutoCostBasisFn = (
  acquiredAt,
  history,
  fallbackCurrentCents,
) => {
  if (history.length === 0) return fallbackCurrentCents ?? null;

  // Days are YYYY-MM-DD, so lexicographic order == chronological order.
  const sorted = [...history].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const earliest = sorted[0]!;

  if (acquiredAt === null) return earliest.priceCents;

  const acquiredDay = acquiredAt.slice(0, 10); // ISO timestamp → YYYY-MM-DD
  let best: Cents | null = null;
  for (const point of sorted) {
    if (point.day <= acquiredDay) best = point.priceCents;
    else break;
  }
  // acquiredAt earlier than all history → earliest point.
  return best ?? earliest.priceCents;
};

/** Build a snapshot point for `day` from a valuation (pure). */
export const buildSnapshot: BuildSnapshotFn = (valuation, day) => ({
  day,
  totalValueCents: valuation.totalValueCents,
  investedCents: valuation.investedCents,
});
