'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  HistoryResponse,
  PortfolioResponse,
  RefreshResponse,
  SyncResponse,
} from '@/lib/contracts/api';
import { api } from '@/components/api';
import StatRow from '@/components/StatRow';
import ValueChart from '@/components/ValueChart';
import AllocationDonut from '@/components/AllocationDonut';
import MoversList from '@/components/MoversList';
import PositionsTable from '@/components/PositionsTable';
import { fmtTimestamp } from '@/components/format';

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'sync' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [p, h] = await Promise.all([
      api<PortfolioResponse>('/api/portfolio'),
      api<HistoryResponse>('/api/history?days=30'),
    ]);
    setPortfolio(p);
    setHistory(h);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let p = await api<PortfolioResponse>('/api/portfolio');
        if (p.valuation.totalPositions === 0) {
          await api<SyncResponse>('/api/inventory/sync', { method: 'POST', body: '{}' });
          p = await api<PortfolioResponse>('/api/portfolio');
        }
        setPortfolio(p);
        setHistory(await api<HistoryResponse>('/api/history?days=30'));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load portfolio.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function doSync() {
    setBusy('sync');
    setError(null);
    try {
      await api<SyncResponse>('/api/inventory/sync', { method: 'POST', body: '{}' });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  }

  async function doRefresh() {
    setBusy('refresh');
    setError(null);
    try {
      await api<RefreshResponse>('/api/prices/refresh', { method: 'POST' });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Price refresh failed.');
    } finally {
      setBusy(null);
    }
  }

  const onTableChanged = useCallback(() => {
    void loadAll().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to reload portfolio.'),
    );
  }, [loadAll]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>CS2 Portfolio</h1>
          {portfolio?.lastSyncAt && (
            <span className="dim topbar-sub">
              Inventory synced {fmtTimestamp(portfolio.lastSyncAt)}
              {portfolio.steamId ? ` · Steam ID ${portfolio.steamId}` : ''}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button className="btn" disabled={busy !== null} onClick={() => void doSync()}>
            {busy === 'sync' ? 'Syncing…' : 'Sync inventory'}
          </button>
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => void doRefresh()}>
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button className="linklike" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {loading || !portfolio ? (
        <div className="skeleton-stack">
          <div className="skeleton" style={{ height: 96 }} />
          <div className="skeleton" style={{ height: 300 }} />
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      ) : (
        <>
          <StatRow valuation={portfolio.valuation} />
          <div className="charts-grid">
            <ValueChart points={history?.points ?? []} />
            <AllocationDonut allocation={portfolio.valuation.byCategory} />
          </div>
          <MoversList
            gainers={portfolio.valuation.topGainers}
            losers={portfolio.valuation.topLosers}
          />
          <PositionsTable
            positions={portfolio.valuation.positions}
            onChanged={onTableChanged}
            onError={setError}
          />
          <footer className="sources-footer">
            <span className="dim">Price sources:</span>
            {portfolio.priceSources.map((s) => (
              <span key={s.id} className={`source-pill ${s.configured ? 'on' : 'off'}`}>
                {s.displayName}
                <em>{s.configured ? (s.requiresApiKey ? 'live' : 'mock') : 'no key'}</em>
              </span>
            ))}
            <span className="dim">
              as of {fmtTimestamp(portfolio.valuation.asOf)}
            </span>
          </footer>
        </>
      )}
    </main>
  );
}
