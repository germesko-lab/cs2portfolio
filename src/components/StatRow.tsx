'use client';

import type { PortfolioValuation } from '@/lib/contracts/valuation';
import { fmtSignedPct, fmtSignedUsd, fmtUsd, plClass } from './format';

/** Summary stat tiles: total value, invested, unrealized P/L, priced coverage. */
export default function StatRow({ valuation }: { valuation: PortfolioValuation }) {
  const v = valuation;
  const allPriced = v.pricedPositions >= v.totalPositions;
  return (
    <div className="stat-row">
      <div className="stat-tile stat-hero">
        <div className="stat-label">Total value</div>
        <div className="stat-value stat-value-lg">{fmtUsd(v.totalValueCents)}</div>
        <div className="stat-sub">across {v.totalPositions} positions</div>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Invested</div>
        <div className="stat-value">{fmtUsd(v.investedCents)}</div>
        <div className="stat-sub">cost basis, auto + manual</div>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Unrealized P/L</div>
        <div className={`stat-value ${plClass(v.unrealizedPlCents)}`}>
          {fmtSignedUsd(v.unrealizedPlCents)}
        </div>
        <div className={`stat-sub ${plClass(v.unrealizedPlCents)}`}>
          {v.unrealizedPlPct != null ? `${fmtSignedPct(v.unrealizedPlPct)} vs invested` : 'vs invested'}
        </div>
      </div>
      <div className={`stat-tile ${allPriced ? '' : 'stat-warn'}`}>
        <div className="stat-label">Priced</div>
        <div className="stat-value">
          {v.pricedPositions} <span className="stat-of">of {v.totalPositions}</span>
        </div>
        <div className="stat-sub">
          {allPriced ? 'all positions priced' : `${v.totalPositions - v.pricedPositions} missing a price`}
        </div>
      </div>
    </div>
  );
}
