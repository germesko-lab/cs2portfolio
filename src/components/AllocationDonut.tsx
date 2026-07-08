'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategoryAllocation } from '@/lib/contracts/valuation';
import { CATEGORY_COLORS, CATEGORY_LABELS, CHART, fmtUsd, fmtUsdCompact } from './format';

/**
 * Category allocation donut + labeled legend list (the legend carries the
 * identity — the palette validator flagged CVD floor band, so every slice is
 * always named with its value alongside).
 */
export default function AllocationDonut({ allocation }: { allocation: CategoryAllocation[] }) {
  const data = allocation.map((a) => ({
    key: a.category,
    name: CATEGORY_LABELS[a.category],
    value: a.valueCents / 100,
    weightPct: a.weightPct,
    positionCount: a.positionCount,
    color: CATEGORY_COLORS[a.category],
  }));

  return (
    <div className="panel chart-panel">
      <h2 className="panel-title">Allocation by category</h2>
      {data.length === 0 ? (
        <div className="empty-note">Nothing priced yet.</div>
      ) : (
        <div className="donut-wrap">
          <ResponsiveContainer width="45%" height={220}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="95%"
                paddingAngle={2}
                stroke={CHART.surface}
                strokeWidth={2}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: CHART.surface,
                  border: `1px solid ${CHART.axisLine}`,
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value, name) => [fmtUsd(Math.round(Number(value) * 100)), name]}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="donut-legend">
            {data.map((d) => (
              <li key={d.key}>
                <span className="chip" style={{ background: d.color }} />
                <span className="donut-cat">{d.name}</span>
                <span className="donut-val">{fmtUsdCompact(Math.round(d.value * 100))}</span>
                <span className="donut-meta">
                  {d.weightPct.toFixed(1)}% · {d.positionCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
