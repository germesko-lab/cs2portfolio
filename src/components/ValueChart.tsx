'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SnapshotPoint } from '@/lib/contracts/types';
import { CHART, fmtDayLong, fmtDayShort, fmtUsd, fmtUsdCompact } from './format';

/** Daily portfolio value (area) vs invested (muted dashed line). One y-axis. */
export default function ValueChart({ points }: { points: SnapshotPoint[] }) {
  const data = points.map((p) => ({
    day: p.day,
    value: p.totalValueCents / 100,
    invested: p.investedCents / 100,
  }));

  return (
    <div className="panel chart-panel">
      <h2 className="panel-title">Portfolio value · last {points.length} days</h2>
      {data.length === 0 ? (
        <div className="empty-note">No history yet — sync your inventory to start the series.</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={fmtDayShort}
              tick={{ fill: CHART.tick, fontSize: 11 }}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(v: number) => fmtUsdCompact(Math.round(v * 100))}
              tick={{ fill: CHART.tick, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                background: CHART.surface,
                border: `1px solid ${CHART.axisLine}`,
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e6edf3' }}
              labelFormatter={(day) => fmtDayLong(String(day))}
              formatter={(value, name) => [fmtUsd(Math.round(Number(value) * 100)), name]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: CHART.tick }}
              iconType="plainline"
              iconSize={14}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="Total value"
              stroke={CHART.accent}
              strokeWidth={2}
              fill="url(#valueFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="invested"
              name="Invested"
              stroke={CHART.muted}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
