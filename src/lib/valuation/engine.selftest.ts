/**
 * Stream C self-test — pure-node script, no test framework.
 * Run from the repo root:
 *   node --experimental-strip-types src/lib/valuation/engine.selftest.ts
 *
 * Node's type-stripping ESM loader does not do extension searching, while the
 * project's tsconfig (bundler resolution, no allowImportingTsExtensions)
 * forbids '.ts' in import specifiers. So this script registers a resolve hook
 * that retries failed relative resolutions with a '.ts' suffix, then loads
 * the modules under test via dynamic import. Production files stay clean.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CanonicalItem, Position, SnapshotPoint } from '../contracts/types';
import type { BestPrice, PricePoint, PriceQuote, PriceStatus } from '../contracts/pricing';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

// Isolated throwaway DB for the snapshots/cost-basis round-trip — must be set
// before '../db' is first imported (it reads DB_PATH at module load).
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'cs2-selftest-')), 'test.db');

const engine = await import('./engine');
const snapshots = await import('./snapshots');
const costBasisDb = await import('./cost-basis');
const { db } = await import('../db');

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeItem(assetId: string, marketHashName: string, category: CanonicalItem['category']): CanonicalItem {
  return {
    assetId,
    marketHashName,
    baseName: marketHashName.replace(/ \(.*\)$/, ''),
    category,
    wearName: null,
    floatValue: null,
    paintSeed: null,
    statTrak: false,
    souvenir: false,
    stickers: [],
    iconUrl: null,
    acquiredAt: null,
  };
}

function makeBestPrice(marketHashName: string, priceCents: number): BestPrice {
  const quote: PriceQuote = {
    marketHashName,
    sourceId: 'mock',
    sourceDisplayName: 'Mock',
    priceCents,
    currency: 'USD',
    listingsCount: 10,
    url: null,
    fetchedAt: '2026-07-08T12:00:00.000Z',
  };
  return { marketHashName, best: quote, quotes: [quote] };
}

const gainer: Position = {
  item: makeItem('a1', 'AK-47 | Redline (Field-Tested)', 'rifle'),
  costBasis: { amountCents: 1000, currency: 'USD', source: 'auto', acquiredAt: '2026-06-01T00:00:00.000Z' },
};
const loser: Position = {
  item: makeItem('a2', '★ Karambit | Fade (Factory New)', 'knife'),
  costBasis: { amountCents: 2000, currency: 'USD', source: 'auto', acquiredAt: null },
};
const unpriced: Position = {
  item: makeItem('a3', 'Sticker | Natus Vincere | Katowice 2015', 'sticker'),
  costBasis: null, // no quote AND no basis — excluded from every total
};
const manual: Position = {
  item: makeItem('a4', 'Glock-18 | Fade (Minimal Wear)', 'pistol'),
  costBasis: { amountCents: 3000, currency: 'USD', source: 'manual', acquiredAt: null },
};

const bestPrices = new Map<string, BestPrice>([
  [gainer.item.marketHashName, makeBestPrice(gainer.item.marketHashName, 1500)],
  [loser.item.marketHashName, makeBestPrice(loser.item.marketHashName, 1200)],
  [manual.item.marketHashName, makeBestPrice(manual.item.marketHashName, 3300)],
  // a3 deliberately absent — no source can price it.
]);
const statuses = new Map<string, PriceStatus>([
  [gainer.item.marketHashName, 'live'],
  [loser.item.marketHashName, 'cached'],
  [manual.item.marketHashName, 'live'],
  // a3 absent from statuses ⇒ 'missing'.
]);

/* ------------------------------------------------------------------ */
/* valuePortfolio                                                      */
/* ------------------------------------------------------------------ */

const asOf = '2026-07-08T12:00:00.000Z';
const pv = engine.valuePortfolio([gainer, loser, unpriced, manual], bestPrices, statuses, asOf);

assert.equal(pv.asOf, asOf);
assert.equal(pv.totalPositions, 4, 'unpriced position still counted in totalPositions');
assert.equal(pv.pricedPositions, 3);
assert.equal(pv.totalValueCents, 1500 + 1200 + 3300, 'total over priced only');
assert.equal(pv.investedCents, 1000 + 2000 + 3000, 'invested over positions with a basis');
assert.equal(pv.unrealizedPlCents, 500 - 800 + 300);
assert.equal(pv.unrealizedPlPct, (0 / 6000) * 100); // 0 is valid here — invested > 0

// Per-position: gainer.
const v1 = pv.positions.find((p) => p.assetId === 'a1')!;
assert.equal(v1.currentValueCents, 1500);
assert.equal(v1.costBasisCents, 1000);
assert.equal(v1.costBasisSource, 'auto');
assert.equal(v1.unrealizedPlCents, 500);
assert.equal(v1.unrealizedPlPct, 50);
assert.equal(v1.priceStatus, 'live');

// Per-position: loser.
const v2 = pv.positions.find((p) => p.assetId === 'a2')!;
assert.equal(v2.unrealizedPlCents, -800);
assert.equal(v2.unrealizedPlPct, -40);
assert.equal(v2.priceStatus, 'cached');

// Per-position: no quote ⇒ missing, all nulls (never 0).
const v3 = pv.positions.find((p) => p.assetId === 'a3')!;
assert.equal(v3.priceStatus, 'missing');
assert.equal(v3.currentValueCents, null);
assert.equal(v3.bestPrice, null);
assert.equal(v3.unrealizedPlCents, null);
assert.equal(v3.unrealizedPlPct, null);

// Per-position: manual basis carried through.
const v4 = pv.positions.find((p) => p.assetId === 'a4')!;
assert.equal(v4.costBasisSource, 'manual');
assert.equal(v4.unrealizedPlCents, 300);
assert.equal(v4.unrealizedPlPct, 10);

// Positions sorted by value desc, nulls last.
assert.deepEqual(pv.positions.map((p) => p.assetId), ['a4', 'a1', 'a2', 'a3']);

// byCategory: priced value only, sorted desc, weights sum to ~100.
assert.deepEqual(
  pv.byCategory.map((c) => [c.category, c.valueCents, c.positionCount]),
  [['pistol', 3300, 1], ['rifle', 1500, 1], ['knife', 1200, 1]],
);
const weightSum = pv.byCategory.reduce((s, c) => s + c.weightPct, 0);
assert.ok(Math.abs(weightSum - 100) < 1e-9, `weights sum to ~100, got ${weightSum}`);
assert.ok(Math.abs(pv.byCategory[0]!.weightPct - 55) < 1e-9);

// topGainers / topLosers: computable only, gainers pl>0 desc, losers pl<0 asc.
assert.deepEqual(pv.topGainers.map((p) => p.assetId), ['a1', 'a4']);
assert.deepEqual(pv.topLosers.map((p) => p.assetId), ['a2']);

// Nothing priced ⇒ empty allocation, null pct when invested is 0 too.
const emptyPv = engine.valuePortfolio([unpriced], new Map(), new Map(), asOf);
assert.equal(emptyPv.totalValueCents, 0);
assert.equal(emptyPv.investedCents, 0);
assert.equal(emptyPv.unrealizedPlPct, null, 'pct null when invested == 0');
assert.deepEqual(emptyPv.byCategory, []);

// valuePosition guard: basis of 0 ⇒ pct null even though pl computable.
const zeroBasis = engine.valuePosition(
  { item: gainer.item, costBasis: { amountCents: 0, currency: 'USD', source: 'manual', acquiredAt: null } },
  makeBestPrice(gainer.item.marketHashName, 1500),
  'live',
);
assert.equal(zeroBasis.unrealizedPlCents, 1500);
assert.equal(zeroBasis.unrealizedPlPct, null, 'pct null when basis is 0');

/* ------------------------------------------------------------------ */
/* estimateAutoCostBasis                                               */
/* ------------------------------------------------------------------ */

const history: PricePoint[] = [
  { day: '2026-01-05', priceCents: 100 },
  { day: '2026-01-10', priceCents: 150 },
  { day: '2026-01-20', priceCents: 200 },
];

// Empty history ⇒ fallback ⇒ null.
assert.equal(engine.estimateAutoCostBasis('2026-01-10T00:00:00.000Z', [], 777), 777);
assert.equal(engine.estimateAutoCostBasis('2026-01-10T00:00:00.000Z', [], null), null);
// Exact-day hit.
assert.equal(engine.estimateAutoCostBasis('2026-01-10T18:30:00.000Z', history, 777), 150);
// Between points ⇒ nearest earlier.
assert.equal(engine.estimateAutoCostBasis('2026-01-12T00:00:00.000Z', history, 777), 150);
// Before all history ⇒ earliest point.
assert.equal(engine.estimateAutoCostBasis('2026-01-01T00:00:00.000Z', history, 777), 100);
// Null acquiredAt ⇒ earliest point.
assert.equal(engine.estimateAutoCostBasis(null, history, 777), 100);
// After all history ⇒ latest at-or-before point.
assert.equal(engine.estimateAutoCostBasis('2026-02-01T00:00:00.000Z', history, 777), 200);

/* ------------------------------------------------------------------ */
/* buildSnapshot                                                       */
/* ------------------------------------------------------------------ */

const snap = engine.buildSnapshot(pv, '2026-07-08');
assert.deepEqual(snap, { day: '2026-07-08', totalValueCents: 6000, investedCents: 6000 });

/* ------------------------------------------------------------------ */
/* snapshots round-trip via db                                         */
/* ------------------------------------------------------------------ */

snapshots.upsertSnapshot({ day: '2026-07-01', totalValueCents: 100, investedCents: 50 });
snapshots.upsertSnapshot({ day: '2026-07-02', totalValueCents: 200, investedCents: 80 });

let series: SnapshotPoint[] = snapshots.getSnapshots(30);
assert.deepEqual(series, [
  { day: '2026-07-01', totalValueCents: 100, investedCents: 50 },
  { day: '2026-07-02', totalValueCents: 200, investedCents: 80 },
], 'getSnapshots returns last N days ascending');

// Same day upserted twice ⇒ still one row, values updated (idempotent per day).
snapshots.upsertSnapshot({ day: '2026-07-02', totalValueCents: 250, investedCents: 90 });
series = snapshots.getSnapshots(30);
assert.equal(series.length, 2, 'same-day upsert does not add a row');
assert.deepEqual(series[1], { day: '2026-07-02', totalValueCents: 250, investedCents: 90 });

// Backfill: never overwrites existing days, adds missing ones, one transaction.
snapshots.backfillSnapshots([
  { day: '2026-06-30', totalValueCents: 10, investedCents: 5 },
  { day: '2026-07-01', totalValueCents: 999999, investedCents: 999999 }, // must NOT overwrite
]);
series = snapshots.getSnapshots(30);
assert.deepEqual(series.map((s) => [s.day, s.totalValueCents]), [
  ['2026-06-30', 10],
  ['2026-07-01', 100],
  ['2026-07-02', 250],
]);

// getSnapshots(days) limits to the LAST N days, still ascending.
assert.deepEqual(snapshots.getSnapshots(2).map((s) => s.day), ['2026-07-01', '2026-07-02']);

/* ------------------------------------------------------------------ */
/* cost_basis CRUD round-trip (bonus)                                  */
/* ------------------------------------------------------------------ */

// cost_basis has a FK to items — insert a minimal item row first.
db.prepare(
  `INSERT INTO items (asset_id, market_hash_name, base_name, category)
   VALUES ('a1', 'AK-47 | Redline (Field-Tested)', 'AK-47 | Redline', 'rifle')`,
).run();

costBasisDb.upsertCostBasis('a1', { amountCents: 1000, currency: 'USD', source: 'auto', acquiredAt: '2026-06-01T00:00:00.000Z' });
assert.deepEqual(costBasisDb.getCostBasis('a1'), {
  amountCents: 1000,
  currency: 'USD',
  source: 'auto',
  acquiredAt: '2026-06-01T00:00:00.000Z',
});
costBasisDb.upsertCostBasis('a1', { amountCents: 2500, currency: 'USD', source: 'manual', acquiredAt: null });
assert.equal(costBasisDb.getCostBasis('a1')?.amountCents, 2500, 'upsert overwrites');
assert.equal(costBasisDb.getCostBasis('a1')?.source, 'manual');
assert.equal(costBasisDb.getAllCostBasis().size, 1);
costBasisDb.deleteCostBasis('a1');
assert.equal(costBasisDb.getCostBasis('a1'), null);

console.log('ALL OK');
