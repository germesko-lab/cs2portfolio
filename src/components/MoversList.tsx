'use client';

import type { PositionValuation } from '@/lib/contracts/valuation';
import { fmtSignedPct, fmtSignedUsd, plClass } from './format';

function MoverRows({ items }: { items: PositionValuation[] }) {
  if (items.length === 0) return <div className="empty-note">None yet.</div>;
  return (
    <ul className="mover-list">
      {items.map((p) => (
        <li key={p.assetId}>
          <span className="mover-name" title={p.marketHashName}>
            {p.marketHashName}
          </span>
          <span className={`mover-pl ${plClass(p.unrealizedPlCents)}`}>
            {p.unrealizedPlCents != null ? fmtSignedUsd(p.unrealizedPlCents) : '-'}
          </span>
          <span className={`mover-pct ${plClass(p.unrealizedPlCents)}`}>
            {p.unrealizedPlPct != null ? fmtSignedPct(p.unrealizedPlPct) : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function MoversList({
  gainers,
  losers,
}: {
  gainers: PositionValuation[];
  losers: PositionValuation[];
}) {
  return (
    <div className="movers-grid">
      <div className="panel">
        <h2 className="panel-title">Top gainers</h2>
        <MoverRows items={gainers} />
      </div>
      <div className="panel">
        <h2 className="panel-title">Top losers</h2>
        <MoverRows items={losers} />
      </div>
    </div>
  );
}
