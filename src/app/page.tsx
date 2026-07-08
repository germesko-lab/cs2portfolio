'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  HistoryResponse,
  PortfolioResponse,
  RefreshResponse,
  SyncResponse,
} from '@/lib/contracts/api';
import { api } from '@/components/api';
import type { SessionResponse } from '@/app/api/auth/session/route';
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
  const [notice, setNotice] = useState<string | null>(null);
  const [syncInput, setSyncInput] = useState('');
  const [authSteamId, setAuthSteamId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [p, h] = await Promise.all([
      api<PortfolioResponse>('/api/portfolio'),
      api<HistoryResponse>('/api/history?days=30'),
    ]);
    setPortfolio(p);
    setHistory(h);
  }, []);

  useEffect(() => {
    // Surface OpenID redirect outcomes (?login=ok&synced=N / syncError / authError).
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    const syncError = params.get('syncError');
    const synced = params.get('synced');
    if (authError) setError(authError);
    else if (syncError) setError(syncError);
    else if (params.get('login') === 'ok') {
      setNotice(synced ? `Signed in through Steam — synced ${synced} items.` : 'Signed in through Steam.');
    }
    if ([...params.keys()].length > 0) window.history.replaceState(null, '', '/');

    (async () => {
      try {
        const session = await api<SessionResponse>('/api/auth/session');
        setAuthSteamId(session.steamId);
        let p = await api<PortfolioResponse>('/api/portfolio');
        if (p.valuation.totalPositions === 0 && session.steamId === null) {
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

  async function doLogout() {
    try {
      await api<{ signedOut: true }>('/api/auth/logout', { method: 'POST' });
      setAuthSteamId(null);
      setNotice('Signed out. The dashboard still shows the last synced inventory.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-out failed.');
    }
  }

  async function doSync(inputOverride?: string) {
    const input = (inputOverride ?? syncInput).trim();
    setBusy('sync');
    setError(null);
    setNotice(null);
    try {
      const res = await api<SyncResponse>('/api/inventory/sync', {
        method: 'POST',
        body: JSON.stringify(input === '' ? {} : { input }),
      });
      if (res.itemCount === 0) {
        setNotice(
          `Steam account ${res.steamId} has an empty CS2 inventory — nothing to track yet.`,
        );
      } else if (res.source === 'fixture') {
        setNotice(`Loaded the bundled demo inventory (${res.itemCount} items).`);
      } else {
        setNotice(`Synced ${res.itemCount} items from Steam account ${res.steamId}.`);
      }
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
          {authSteamId === null ? (
            <a className="btn btn-steam" href="/api/auth/steam/login">
              Sign in through Steam
            </a>
          ) : (
            <>
              <span className="auth-chip" title={`Signed in as SteamID64 ${authSteamId}`}>
                Steam: {authSteamId}
              </span>
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void doSync(authSteamId)}
              >
                {busy === 'sync' ? 'Syncing…' : 'Sync my inventory'}
              </button>
              <button className="btn" disabled={busy !== null} onClick={() => void doLogout()}>
                Sign out
              </button>
            </>
          )}
          <input
            className="sync-input"
            type="text"
            placeholder="Steam profile URL, SteamID64 or trade offer link"
            value={syncInput}
            disabled={busy !== null}
            onChange={(e) => setSyncInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && syncInput.trim() !== '') void doSync();
            }}
          />
          <button
            className={`btn ${authSteamId === null ? 'btn-primary' : ''}`}
            disabled={busy !== null || syncInput.trim() === ''}
            onClick={() => void doSync()}
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync from link'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => void doSync('')}>
            Load demo
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => void doRefresh()}>
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
      {notice && (
        <div className="banner banner-info">
          <span>{notice}</span>
          <button className="linklike" onClick={() => setNotice(null)}>
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
