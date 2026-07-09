/**
 * Stream C self-test - pure-node script, no test framework.
 * Run from the repo root:
 *   node --experimental-strip-types src/lib/valuation/engine.selftest.ts
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

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'cs2-selftest-')), 'test.db');

const engine = await import('./engine');
const snapshots = await import('./snapshots');
const costBasisDb = await import('./cost-basis');
const { db } = await import('../db');

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
  item: makeItem('a2', 'Karambit | Fade (Factory New)', 'knife'),
  costBasis: { amountCents: 2000, currency: 'USD', source: 'auto', acquiredAt: null },
};
const unpriced: Position = {
  item: makeItem('a3', 'Sticker | Natus Vincere | Katowice 2015', 'sticker'),
  costBasis: null,
};
const manual: Position = {
  item: makeItem('a4', 'Glock-18 | Fade (Minimal Wear)', 'pistol'),
  costBasis: { amountCents: 3000, currency: 'USD', source: 'manual', acquiredAt: null },
};

const bestPrices = new Map<string, BestPrice>([
  [gainer.item.marketHashName, makeBestPrice(gainer.item.marketHashName, 1500)],
  [loser.item.marketHashName, makeBestPrice(loser.item.marketHashName, 1200)],
  [manual.item.marketHashName, makeBestPrice(manual.item.marketHashName, 3300)],
]);
const statuses = new Map<string, PriceStatus>([
  [gainer.item.marketHashName, 'live'],
  [loser.item.marketHashName, 'cached'],
  [manual.item.marketHashName, 'live'],
]);

const asOf = '2026-07-08T12:00:00.000Z';
const pv = engine.valuePortfolio([gainer, loser, unpriced, manual], bestPrices, statuses, asOf);

assert.equal(pv.asOf, asOf);
assert.equal(pv.totalPositions, 4);
assert.equal(pv.pricedPositions, 3);
assert.equal(pv.totalValueCents, 1500 + 1200 + 3300);
assert.equal(pv.investedCents, 1000 + 2000 + 3000);
assert.equal(pv.unrealizedPlCents, 500 - 800 + 300);
assert.equal(pv.unrealizedPlPct, 0);

const v1 = pv.positions.find((p) => p.assetId === 'a1')!;
assert.equal(v1.currentValueCents, 1500);
assert.equal(v1.costBasisSource, 'auto');
assert.equal(v1.unrealizedPlPct, 50);
assert.equal(v1.priceStatus, 'live');

const v3 = pv.positions.find((p) => p.assetId === 'a3')!;
assert.equal(v3.priceStatus, 'missing');
assert.equal(v3.currentValueCents, null);
assert.equal(v3.unrealizedPlCents, null);

assert.deepEqual(pv.positions.map((p) => p.assetId), ['a4', 'a1', 'a2', 'a3']);
assert.deepEqual(
  pv.byCategory.map((c) => [c.category, c.valueCents, c.positionCount]),
  [['pistol', 3300, 1], ['rifle', 1500, 1], ['knife', 1200, 1]],
);
assert.deepEqual(pv.topGainers.map((p) => p.assetId), ['a1', 'a4']);
assert.deepEqual(pv.topLosers.map((p) => p.assetId), ['a2']);

const emptyPv = engine.valuePortfolio([unpriced], new Map(), new Map(), asOf);
assert.equal(emptyPv.unrealizedPlPct, null);
assert.deepEqual(emptyPv.byCategory, []);

const zeroBasis = engine.valuePosition(
  { item: gainer.item, costBasis: { amountCents: 0, currency: 'USD', source: 'manual', acquiredAt: null } },
  makeBestPrice(gainer.item.marketHashName, 1500),
  'live',
);
assert.equal(zeroBasis.unrealizedPlCents, 1500);
assert.equal(zeroBasis.unrealizedPlPct, null);

const history: PricePoint[] = [
  { day: '2026-01-05', priceCents: 100 },
  { day: '2026-01-10', priceCents: 150 },
  { day: '2026-01-20', priceCents: 200 },
];
assert.equal(engine.estimateAutoCostBasis('2026-01-10T18:30:00.000Z', history, 777), 150);
assert.equal(engine.estimateAutoCostBasis('2026-01-12T00:00:00.000Z', history, 777), 150);
assert.equal(engine.estimateAutoCostBasis('2026-01-01T00:00:00.000Z', history, 777), 100);
assert.equal(engine.estimateAutoCostBasis(null, history, 777), 100);
assert.equal(engine.estimateAutoCostBasis('2026-01-10T00:00:00.000Z', [], 777), 777);
assert.equal(engine.estimateAutoCostBasis('2026-01-10T00:00:00.000Z', [], null), null);

assert.deepEqual(engine.buildSnapshot(pv, '2026-07-08'), {
  day: '2026-07-08',
  totalValueCents: 6000,
  investedCents: 6000,
});

db.prepare(`INSERT INTO users (steam_id) VALUES ('76561198000000001')`).run();
db.prepare(`INSERT INTO users (steam_id) VALUES ('76561198000000002')`).run();
const userId = (db.prepare(`SELECT id FROM users WHERE steam_id = '76561198000000001'`).get() as { id: number }).id;
const otherUserId = (db.prepare(`SELECT id FROM users WHERE steam_id = '76561198000000002'`).get() as { id: number }).id;

snapshots.upsertSnapshot(userId, { day: '2026-07-01', totalValueCents: 100, investedCents: 50 });
snapshots.upsertSnapshot(userId, { day: '2026-07-02', totalValueCents: 200, investedCents: 80 });
snapshots.upsertSnapshot(otherUserId, { day: '2026-07-02', totalValueCents: 999, investedCents: 999 });

let series: SnapshotPoint[] = snapshots.getSnapshots(userId, 30);
assert.deepEqual(series, [
  { day: '2026-07-01', totalValueCents: 100, investedCents: 50 },
  { day: '2026-07-02', totalValueCents: 200, investedCents: 80 },
]);
assert.deepEqual(snapshots.getSnapshots(otherUserId, 30), [
  { day: '2026-07-02', totalValueCents: 999, investedCents: 999 },
]);

snapshots.upsertSnapshot(userId, { day: '2026-07-02', totalValueCents: 250, investedCents: 90 });
series = snapshots.getSnapshots(userId, 30);
assert.equal(series.length, 2);
assert.deepEqual(series[1], { day: '2026-07-02', totalValueCents: 250, investedCents: 90 });

snapshots.backfillSnapshots(userId, [
  { day: '2026-06-30', totalValueCents: 10, investedCents: 5 },
  { day: '2026-07-01', totalValueCents: 999999, investedCents: 999999 },
]);
assert.deepEqual(snapshots.getSnapshots(userId, 2).map((s) => s.day), ['2026-07-01', '2026-07-02']);

db.prepare(
  `INSERT INTO items (user_id, asset_id, market_hash_name, base_name, category)
   VALUES (?, 'a1', 'AK-47 | Redline (Field-Tested)', 'AK-47 | Redline', 'rifle')`,
).run(userId);
db.prepare(
  `INSERT INTO items (user_id, asset_id, market_hash_name, base_name, category)
   VALUES (?, 'a1', 'AK-47 | Redline (Field-Tested)', 'AK-47 | Redline', 'rifle')`,
).run(otherUserId);

costBasisDb.upsertCostBasis(
  userId,
  'a1',
  {
    amountCents: 1000,
    currency: 'USD',
    source: 'auto',
    acquiredAt: '2026-06-01T00:00:00.000Z',
  },
  costBasisDb.costBasisItemKey(makeItem('a1', 'AK-47 | Redline (Field-Tested)', 'rifle')),
);
costBasisDb.upsertCostBasis(
  otherUserId,
  'a1',
  {
    amountCents: 7777,
    currency: 'USD',
    source: 'manual',
    acquiredAt: null,
  },
  costBasisDb.costBasisItemKey(makeItem('a1', 'AK-47 | Redline (Field-Tested)', 'rifle')),
);
assert.equal(costBasisDb.getCostBasis(userId, 'a1')?.amountCents, 1000);
assert.equal(costBasisDb.getCostBasis(otherUserId, 'a1')?.amountCents, 7777);
costBasisDb.upsertCostBasis(
  userId,
  'a1',
  {
    amountCents: 2500,
    currency: 'USD',
    source: 'manual',
    acquiredAt: null,
  },
  costBasisDb.costBasisItemKey(makeItem('a1', 'AK-47 | Redline (Field-Tested)', 'rifle')),
);
assert.equal(costBasisDb.getCostBasis(userId, 'a1')?.amountCents, 2500);
assert.equal(costBasisDb.getAllCostBasis(userId).size, 1);
db.prepare(`DELETE FROM items WHERE user_id = ? AND asset_id = 'a1'`).run(userId);
assert.equal(costBasisDb.getCostBasis(userId, 'a1')?.amountCents, 2500);
const replacement = makeItem('a2', 'AK-47 | Redline (Field-Tested)', 'rifle');
db.prepare(
  `INSERT INTO items (user_id, asset_id, market_hash_name, base_name, category)
   VALUES (?, 'a2', 'AK-47 | Redline (Field-Tested)', 'AK-47 | Redline', 'rifle')`,
).run(userId);
assert.equal(costBasisDb.getAllCostBasisForItems(userId, [replacement]).get('a2')?.amountCents, 2500);
costBasisDb.deleteCostBasis(userId, 'a1');
assert.equal(costBasisDb.getCostBasis(userId, 'a1'), null);
assert.equal(costBasisDb.getCostBasis(otherUserId, 'a1')?.amountCents, 7777);

console.log('ALL OK');
