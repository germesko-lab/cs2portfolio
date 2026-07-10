import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import path from 'node:path';

import type { CanonicalItem } from '../contracts/types';
import type { PriceQuote } from '../contracts/pricing';

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

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'cs2-foundation-')), 'test.db');
process.env.PRICE_SOURCE_MODE = 'mock';

const { db } = await import('../db');
const { upsertItems, getItems } = await import('./items-repo');
const { getDashboard, setManualCostBasis } = await import('./portfolio-service');
const { getSnapshots } = await import('../valuation');
const { getAllCostBasisForItems } = await import('../valuation/cost-basis');
const { upsertQuotes } = await import('../prices/cache');
const { priceService } = await import('../prices');

function makeItem(assetId: string, marketHashName = 'Test Rifle | Blue (Field-Tested)'): CanonicalItem {
  return {
    assetId,
    classId: 'class-test',
    instanceId: 'instance-test',
    itemKey: `${marketHashName}|||0|0`,
    inspectLink: null,
    marketHashName,
    baseName: 'Test Rifle | Blue',
    category: 'rifle',
    rarity: 'Classified',
    wearName: 'Field-Tested',
    floatValue: null,
    paintSeed: null,
    statTrak: false,
    souvenir: false,
    stickers: [],
    iconUrl: null,
    acquiredAt: null,
    enrichmentStatus: 'missing',
    enrichmentProvider: null,
    paintIndex: null,
    fadePercentage: null,
    fadeRank: null,
  };
}

function quote(sourceId: PriceQuote['sourceId'], priceCents: number): PriceQuote {
  return {
    marketHashName: 'Test Rifle | Blue (Field-Tested)',
    sourceId,
    sourceDisplayName:
      sourceId === 'csgoskins' ? 'CSGOSKINS.GG'
      : sourceId === 'skinport' ? 'Skinport'
      : sourceId === 'csfloat' ? 'CSFloat'
      : 'Mock Market Data',
    priceCents,
    currency: 'USD',
    listingsCount: null,
    url: null,
    fetchedAt: new Date().toISOString(),
  };
}

db.prepare(`INSERT INTO users (steam_id) VALUES ('76561198000001000')`).run();
const user = db
  .prepare(`SELECT id, steam_id AS steamId FROM users WHERE steam_id = '76561198000001000'`)
  .get() as { id: number; steamId: string };

const duplicateA = makeItem('asset-a');
const duplicateB = makeItem('asset-b');
upsertItems(user.id, [duplicateA, duplicateB]);
assert.equal(getItems(user.id).length, 2, 'duplicate identical skins must remain separate asset rows');

await setManualCostBasis(user, duplicateA.assetId, 12345);

const ledgerCount = (
  db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE user_id = ? AND type = 'manual_adjustment' AND steam_asset_id = ?`,
    )
    .get(user.id, duplicateA.assetId) as { count: number }
).count;
assert.equal(ledgerCount, 1, 'manual cost basis must create one ledger entry');

db.prepare(`DELETE FROM items WHERE user_id = ? AND asset_id = ?`).run(user.id, duplicateA.assetId);
const replacementBasis = getAllCostBasisForItems(user.id, [duplicateB]).get(duplicateB.assetId);
assert.equal(replacementBasis?.amountCents, 12345, 'item_key fallback must preserve cost basis after resync');

upsertQuotes([quote('csgoskins', 10_000), quote('skinport', 50_000), quote('csfloat', 60_000)]);
const best = await priceService.getBestPrices(['Test Rifle | Blue (Field-Tested)']);
assert.equal(best.get('Test Rifle | Blue (Field-Tested)')?.best.sourceId, 'csgoskins');

const beforeDashboardSnapshots = getSnapshots(user.id, 365).length;
const dashboard = await getDashboard(user, 30);
const afterDashboardSnapshots = getSnapshots(user.id, 365).length;
assert.equal(afterDashboardSnapshots, beforeDashboardSnapshots, 'GET dashboard must not create snapshots');
assert.ok(dashboard.dataCompleteness, 'dashboard response must include dataCompleteness');
assert.ok(dashboard.syncStatus, 'dashboard response must include syncStatus');
assert.equal(dashboard.valuation.realizedPnlCents, null, 'realized P/L stays unavailable until sell accounting exists');
assert.equal(dashboard.valuation.allTimePnlCents, null, 'all-time P/L stays unavailable until realized P/L exists');

console.log('ALL OK');
