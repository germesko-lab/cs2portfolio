'use client';

import { useMemo, useState } from 'react';
import type { CategoryAllocation } from '@/lib/contracts/valuation';
import { CATEGORY_COLORS, CATEGORY_LABELS, fmtPct, fmtUsd, fmtUsdCompact, type CategoryKey } from './format';

const size = 232;
const radius = 86;
const strokeWidth = 34;
const circumference = 2 * Math.PI * radius;

export default function AllocationDonut({ allocation, embedded = false }: { allocation: CategoryAllocation[]; embedded?: boolean }) {
  const [hovered, setHovered] = useState<CategoryKey | null>(null);
  const data = useMemo(
    () =>
      allocation
        .filter((a) => a.valueCents > 0)
        .map((a) => ({
          ...a,
          label: CATEGORY_LABELS[a.category],
          color: CATEGORY_COLORS[a.category],
        })),
    [allocation],
  );

  const total = data.reduce((sum, item) => sum + item.valueCents, 0);
  let offset = 0;
  const active = hovered ? data.find((item) => item.category === hovered) : null;

  const body =
    data.length === 0 ? (
      <div className="chart-empty">Nothing priced yet. Missing-price items stay out of allocation.</div>
    ) : (
      <div className="allocation-wrap" onMouseLeave={() => setHovered(null)}>
        <div className="donut-shell">
          <svg className="donut-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
            <title>Portfolio allocation by category</title>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--line)"
              strokeWidth={strokeWidth}
            />
            {data.map((item) => {
              const length = (item.valueCents / total) * circumference;
              const dash = `${Math.max(length - 3, 0)} ${circumference}`;
              const segmentOffset = offset;
              offset += length;
              const dim = hovered !== null && hovered !== item.category;
              return (
                <circle
                  key={item.category}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  strokeDashoffset={-segmentOffset}
                  strokeLinecap="round"
                  className={dim ? 'donut-segment dimmed' : 'donut-segment'}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  onMouseEnter={() => setHovered(item.category)}
                  onFocus={() => setHovered(item.category)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                />
              );
            })}
          </svg>
          <div className="donut-center">
            <strong>{active ? fmtUsdCompact(active.valueCents) : fmtUsdCompact(total)}</strong>
            <span>{active ? active.label : 'Total value'}</span>
          </div>
        </div>
        <div className="allocation-list">
          {data.map((item) => {
            const dim = hovered !== null && hovered !== item.category;
            return (
              <button
                key={item.category}
                type="button"
                className={dim ? 'alloc-row dimmed' : 'alloc-row'}
                onMouseEnter={() => setHovered(item.category)}
                onFocus={() => setHovered(item.category)}
                onBlur={() => setHovered(null)}
              >
                <span className="alloc-dot" style={{ background: item.color }} />
                <span className="alloc-name">{item.label}</span>
                <strong>{fmtUsd(item.valueCents)}</strong>
                <span>{fmtPct(item.weightPct)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );

  if (embedded) {
    return <div className="allocation-embedded">{body}</div>;
  }

  return (
    <section className="card allocation-card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Allocation</h2>
          <p className="card-subtitle">By item type from priced real holdings.</p>
        </div>
      </div>
      {body}
    </section>
  );
}
