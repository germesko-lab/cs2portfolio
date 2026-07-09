import type { Cents, IsoDay, IsoTimestamp, ItemCategory } from '@/lib/contracts/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function fmtUsd(cents: Cents): string {
  return usd.format(cents / 100);
}

function compactNumber(dollars: number): string {
  const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}K`;
  return usdWhole.format(dollars);
}

export function fmtUsdCompact(cents: Cents): string {
  return `${cents < 0 ? '-' : ''}${compactNumber(Math.abs(cents) / 100)}`;
}

export function fmtSignedUsd(cents: Cents): string {
  if (cents > 0) return `+${usd.format(cents / 100)}`;
  return usd.format(cents / 100);
}

export function fmtSignedPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export function fmtDayShort(day: IsoDay): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

export function fmtDayLong(day: IsoDay): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function fmtTimestamp(ts: IsoTimestamp): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function plClass(cents: Cents | null): string {
  if (cents == null || cents === 0) return '';
  return cents > 0 ? 'pl-gain' : 'pl-loss';
}

export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  knife: '#3861fb',
  gloves: '#16c784',
  rifle: '#f7b678',
  pistol: '#ff6b57',
  smg: '#06b6d4',
  heavy: '#7c3aed',
  sticker: '#ec4899',
  case: '#f59e0b',
  agent: '#94a3b8',
  other: '#64748b',
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
