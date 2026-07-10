import { db } from '../db';
import type { CanonicalItem, Cents, Currency, IsoTimestamp } from '../contracts/types';

export type TransactionType = 'buy' | 'sell' | 'deposit' | 'withdraw' | 'manual_adjustment';
export type TransactionSource =
  | 'steam_market'
  | 'manual'
  | 'imported_csv'
  | 'csfloat'
  | 'other_marketplace'
  | 'unknown';

export interface LedgerInput {
  type: TransactionType;
  source: TransactionSource;
  item: CanonicalItem;
  quantity?: number;
  unitPriceCents: Cents;
  currency?: Currency;
  feeCents?: Cents;
  occurredAt?: IsoTimestamp;
  externalId?: string | null;
  notes?: string | null;
}

export function createLedgerEntry(userId: number, input: LedgerInput): number {
  const result = db
    .prepare(
      `INSERT INTO transactions (
         user_id, type, source, market_hash_name, steam_asset_id, item_key,
         quantity, unit_price_cents, currency, fee_cents, occurred_at,
         external_id, notes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.type,
      input.source,
      input.item.marketHashName,
      input.item.assetId,
      input.item.itemKey,
      input.quantity ?? 1,
      input.unitPriceCents,
      input.currency ?? 'USD',
      input.feeCents ?? 0,
      input.occurredAt ?? new Date().toISOString(),
      input.externalId ?? null,
      input.notes ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function realizedPnlForUser(_userId: number): Cents | null {
  // The ledger now has a home for sell events, but matching sells against buys
  // needs an explicit accounting policy. Return null until that policy exists.
  return null;
}
