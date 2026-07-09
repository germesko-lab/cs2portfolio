'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SnapshotPoint } from '@/lib/contracts/types';
import { fmtDayLong, fmtDayShort, fmtUsd, fmtUsdCompact } from './format';

type ChartKind = 'holdings' | 'performance';

export type RangeKey = '24h' | '7d' | '30d' | '90d' | 'all';

const ranges: RangeKey[] = ['24h', '7d', '30d', '90d', 'all'];

function EmptyChart({ text }: { text: string }) {
  return <div className="chart-empty">{text}</div>;
}

export default function ValueChart({
  points,
  kind,
  range,
  onRangeChange,
}: {
  points: SnapshotPoint[];
  kind: ChartKind;
  range?: RangeKey;
  onRangeChange?: (range: RangeKey) => void;
}) {
  const data = points.map((p) => {
    const value = p.totalValueCents / 100;
    const invested = p.investedCents / 100;
    return {
      day: p.day,
      value,
      invested,
      profit: value - invested,
    };
  });

  const isPerformance = kind === 'performance';
  const title = isPerformance ? 'Performance' : 'Holdings';
  const subtitle = isPerformance
    ? 'Portfolio profit from available value and cost basis snapshots.'
    : 'Real portfolio value from saved backend snapshots.';
  const emptyText = isPerformance
    ? 'No profit history yet. Sync and price your inventory to build the series.'
    : 'No history yet. Sync your inventory to start the portfolio series.';

  return (
    <section className={`card chart-card ${isPerformance ? 'performance-card' : ''}`}>
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">{subtitle}</p>
        </div>
        {onRangeChange && range && (
          <div className="range" aria-label="Chart range">
            {ranges.map((r) => (
              <button
                key={r}
                className={range === r ? 'active' : ''}
                type="button"
                onClick={() => onRangeChange(r)}
              >
                {r === 'all' ? 'All' : r}
              </button>
            ))}
          </div>
        )}
      </div>
      {data.length === 0 ? (
        <EmptyChart text={emptyText} />
      ) : (
        <div className="chart-stage">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`${kind}Fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isPerformance ? '#ff4d4f' : '#3861fb'} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={isPerformance ? '#ff4d4f' : '#3861fb'} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={fmtDayShort}
                tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                minTickGap={34}
              />
              <YAxis
                tickFormatter={(v: number) => fmtUsdCompact(Math.round(v * 100))}
                tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                width={66}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '4 4' }}
                contentStyle={{
                  background: 'var(--tooltip-bg)',
                  border: '1px solid var(--line-strong)',
                  borderRadius: 10,
                  boxShadow: 'var(--shadow)',
                  color: 'var(--tooltip-text)',
                  fontSize: 12,
                  fontWeight: 800,
                }}
                labelFormatter={(day) => fmtDayLong(String(day))}
                formatter={(value, name) => [
                  fmtUsd(Math.round(Number(value) * 100)),
                  name === 'value' ? 'Value' : name === 'profit' ? 'Profit' : 'Cost basis',
                ]}
              />
              {isPerformance ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="profit"
                    name="Portfolio profit"
                    stroke="#ff4d4f"
                    strokeWidth={2.6}
                    fill={`url(#${kind}Fill)`}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="invested"
                    name="Cost basis"
                    stroke="#f7b678"
                    strokeWidth={2.2}
                    dot={false}
                    strokeDasharray="5 5"
                  />
                </>
              ) : (
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Portfolio value"
                  stroke="#3861fb"
                  strokeWidth={2.6}
                  fill={`url(#${kind}Fill)`}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
