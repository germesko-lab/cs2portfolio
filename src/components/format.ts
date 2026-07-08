/**
 * Formatting helpers + chart theme constants for the dashboard (stream E).
 * All money enters as integer cents and is formatted to USD at this edge.
 */
import type { Cents, IsoDay, IsoTimestamp, ItemCategory } from '@/lib/contracts/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** $1,234.56 */
export function fmtUsd(cents: Cents): string {
  return usd.format(cents / 100);
}

function compactNumber(dollars: number): string {
  const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  return `$${trim(dollars / 1_000)}K`;
}

/** Compact above $10K ($12.5K), else full dollars — for tight spots and axis ticks. */
export function fmtUsdCompact(cents: Cents): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 10_000) return `${dollars < 0 ? '-' : ''}${compactNumber(abs)}`;
  return usdWhole.format(dollars);
}

/** Signed: +$123.45 / -$123.45 / $0.00 */
export function fmtSignedUsd(cents: Cents): string {
  if (cents > 0) return `+${usd.format(cents / 100)}`;
  return usd.format(cents / 100);
}

/** Signed percent with one decimal: +4.2% */
export function fmtSignedPct(pct: number): string {
  const s = pct > 0 ? '+' : '';
  return `${s}${pct.toFixed(1)}%`;
}

/** "Jun 12" from an IsoDay (UTC). */
export function fmtDayShort(day: IsoDay): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "Jun 12, 2026" from an IsoDay (UTC). */
export function fmtDayLong(day: IsoDay): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** "Jul 8, 2026, 2:14 PM" from an ISO timestamp, in the viewer's zone. */
export function fmtTimestamp(ts: IsoTimestamp): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** CSS class for a P/L number ('' when null/zero). */
export function plClass(cents: Cents | null): string {
  if (cents == null || cents === 0) return '';
  return cents > 0 ? 'pl-gain' : 'pl-loss';
}

/* ------------------------------------------------------------------ */
/* Chart theme — validated with the dataviz palette validator against  */
/* the app's dark panel surface #161b22.                               */
/* ------------------------------------------------------------------ */

export const CHART = {
  surface: '#161b22',
  grid: '#21262d',
  axisLine: '#30363d',
  tick: '#8b949e',
  accent: '#4c8dff', // total value series
  muted: '#8b949e', // invested series (deliberately de-emphasized)
} as const;

/**
 * Fixed color per category (color follows the entity, never its rank).
 * First 8 slots are the validated dark categorical palette; the two
 * catch-all categories fold into grays by design.
 */
export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  rifle: '#3987e5',
  knife: '#199e70',
  gloves: '#c98500',
  pistol: '#008300',
  smg: '#9085e9',
  heavy: '#e66767',
  sticker: '#d55181',
  case: '#d95926',
  agent: '#8b949e',
  other: '#6e7681',
};

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  knife: 'Knives',
  gloves: 'Gloves',
  rifle: 'Rifles',
  pistol: 'Pistols',
  smg: 'SMGs',
  heavy: 'Heavy',
  sticker: 'Stickers',
  case: 'Cases',
  agent: 'Agents',
  other: 'Other',
};
