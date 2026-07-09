'use client';

import type { PositionValuation } from '@/lib/contracts/valuation';
import type { CSSProperties } from 'react';
import { CATEGORY_COLORS, fmtSignedPct, fmtSignedUsd, fmtUsd, plClass } from './format';
import { FloatBadge } from './PositionsTable';

function wearMarker(floatValue: number | null) {
  if (floatValue == null) return 48;
  return Math.max(0, Math.min(100, floatValue * 100));
}

export default function PerformerCard({
  title,
  position,
  emptyText,
}: {
  title: string;
  position: PositionValuation | null;
  emptyText: string;
}) {
  if (!position) {
    return (
      <article className="skin-feature-card empty-performer">
        {title && <div className="performer-title">{title}</div>}
        <p>{emptyText}</p>
      </article>
    );
  }

  const item = position.item;
  const accent = CATEGORY_COLORS[item.category];
  const marker = wearMarker(item.floatValue);

  return (
    <article className="skin-feature-card" style={{ '--quality-accent': accent } as CSSProperties}>
      {title && <div className="performer-title">{title}</div>}
      <div className="feature-hero">
        <div className="feature-head">
          <div>
            <div className="feature-name">{item.baseName}</div>
            <div className="feature-sub">{item.wearName ?? 'Wearless item'}</div>
          </div>
          <FloatBadge p={position} />
        </div>
        <div className="feature-image-wrap">
          {item.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.iconUrl} alt="" loading="lazy" />
          ) : (
            <span className="feature-fallback" />
          )}
        </div>
      </div>
      <div className="condition-accent" />
      <div className="feature-body">
        <div className="wear-bar">
          <span className="marker" style={{ left: `${marker}%` }} />
        </div>
        <div className="wear-meta">
          <span>{item.floatValue != null ? item.floatValue.toFixed(6) : 'Float unavailable'}</span>
          <span>{item.paintSeed != null ? `Seed ${item.paintSeed}` : 'Seed unavailable'}</span>
        </div>
        <div className="price-main-row">
          <strong>{position.currentValueCents != null ? fmtUsd(position.currentValueCents) : 'No price'}</strong>
          <span className={plClass(position.unrealizedPlCents)}>
            {position.unrealizedPlCents != null ? fmtSignedUsd(position.unrealizedPlCents) : '-'}
            {position.unrealizedPlPct != null ? ` ${fmtSignedPct(position.unrealizedPlPct)}` : ''}
          </span>
        </div>
      </div>
    </article>
  );
}
