'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HistoryResponse,
  PortfolioResponse,
  RefreshResponse,
  SyncResponse,
} from '@/lib/contracts/api';
import type { PositionValuation } from '@/lib/contracts/valuation';
import type { SessionResponse } from '@/app/api/auth/session/route';
import { api } from '@/components/api';
import AllocationDonut from '@/components/AllocationDonut';
import ExportPopover from '@/components/ExportPopover';
import PerformerCard from '@/components/PerformerCard';
import PositionsTable from '@/components/PositionsTable';
import ValueChart, { type RangeKey } from '@/components/ValueChart';
import { fmtSignedPct, fmtSignedUsd, fmtTimestamp, fmtUsd, plClass } from '@/components/format';

type BusyState = 'sync' | 'refresh' | null;
type Theme = 'light' | 'dark';
type Currency = 'USD' | 'EUR' | 'UAH';

const historyDays: Record<RangeKey, number> = {
  '24h': 2,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 365,
};

function calcDailyChange(history: HistoryResponse | null) {
  const points = history?.points ?? [];
  if (points.length < 2) return null;
  const prev = points[points.length - 2].totalValueCents;
  const last = points[points.length - 1].totalValueCents;
  const delta = last - prev;
  return { delta, pct: prev === 0 ? null : (delta / prev) * 100 };
}

function choosePerformer(items: PositionValuation[]) {
  const computable = items.filter((p) => p.unrealizedPlCents != null);
  if (computable.length === 0) return null;
  return computable[0] ?? null;
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncInput, setSyncInput] = useState('');
  const [authSteamId, setAuthSteamId] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [theme, setTheme] = useState<Theme>('light');
  const [currency, setCurrency] = useState<Currency>('USD');

  const loadAll = useCallback(async (selectedRange: RangeKey) => {
    const p = await api<PortfolioResponse>('/api/portfolio');
    setPortfolio(p);
    setHistory(await api<HistoryResponse>(`/api/history?days=${historyDays[selectedRange]}`));
  }, []);

  useEffect(() => {
    if (theme === 'dark') document.body.dataset.theme = 'dark';
    else document.body.removeAttribute('data-theme');
    return () => {
      document.body.removeAttribute('data-theme');
    };
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    const syncError = params.get('syncError');
    const synced = params.get('synced');
    const syncPending = params.get('sync') === 'pending';
    if (authError) setError(authError);
    else if (syncError) setError(syncError);
    else if (params.get('login') === 'ok') {
      setNotice(
        syncPending
          ? 'Signed in through Steam. Syncing your inventory now...'
          : synced
            ? `Signed in through Steam and synced ${synced} items.`
            : 'Signed in through Steam.',
      );
    }
    if ([...params.keys()].length > 0) window.history.replaceState(null, '', '/');

    void api<{ commit: string | null; branch: string | null }>('/api/version')
      .then((v) => setVersion(v.commit ? v.commit.slice(0, 7) : null))
      .catch(() => {});

    (async () => {
      try {
        const session = await api<SessionResponse>('/api/auth/session');
        setAuthSteamId(session.steamId);
        if (session.steamId === null) {
          setPortfolio(null);
          setHistory(null);
          return;
        }
        await loadAll('30d');
        if (syncPending) {
          window.setTimeout(() => void doSync(''), 0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load portfolio.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll]);

  async function doLogout() {
    try {
      await api<{ signedOut: true }>('/api/auth/logout', { method: 'POST' });
      setAuthSteamId(null);
      setPortfolio(null);
      setHistory(null);
      setNotice('Signed out.');
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
        body: input === '' ? '{}' : JSON.stringify({ input }),
      });
      if (res.itemCount === 0) {
        setNotice(`Steam account ${res.steamId} has an empty CS2 inventory.`);
      } else if (res.source === 'fixture') {
        setNotice(`Loaded the bundled demo inventory (${res.itemCount} items).`);
      } else {
        setNotice(`Synced ${res.itemCount} items from Steam account ${res.steamId}.`);
      }
      await loadAll(range);
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
      await loadAll(range);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Price refresh failed.');
    } finally {
      setBusy(null);
    }
  }

  const onTableChanged = useCallback(() => {
    void loadAll(range).catch((e) => setError(e instanceof Error ? e.message : 'Failed to reload portfolio.'));
  }, [loadAll, range]);

  const dailyChange = useMemo(() => calcDailyChange(history), [history]);
  const valuation = portfolio?.valuation ?? null;
  const best = choosePerformer(valuation?.topGainers ?? []);
  const worst = choosePerformer(valuation?.topLosers ?? []);
  const missingCount = valuation ? valuation.totalPositions - valuation.pricedPositions : 0;

  function changeRange(next: RangeKey) {
    setRange(next);
    if (authSteamId !== null) {
      void loadAll(next).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history.'));
    }
  }

  function changeCurrency(next: Currency) {
    setCurrency(next);
    if (next !== 'USD') {
      setNotice('Currency conversion is not implemented in the backend yet; values remain USD.');
    }
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">CS</span>
          <span>CS2 Portfolio</span>
        </a>
        <div className="top-actions">
          <label className="currency-picker">
            <span className="currency-label">Currency</span>
            <select className="currency-select" value={currency} onChange={(e) => changeCurrency(e.target.value as Currency)}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="UAH">UAH</option>
            </select>
          </label>
          <button className="theme-toggle" type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            <span className="theme-icon">{theme === 'dark' ? 'Moon' : 'Sun'}</span>
            <span className="theme-text">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
          {authSteamId === null ? (
            <a className="primary nav-login" href="/api/auth/steam/login">
              Steam login
            </a>
          ) : (
            <div className="user-chip" title={`SteamID64 ${authSteamId}`}>
              <span className="avatar">{authSteamId.slice(-2)}</span>
              <span>Steam</span>
            </div>
          )}
        </div>
      </header>

      <div className="app">
        <aside className="sidebar">
          <div className="side-head">
            <span>Portfolio</span>
            <button className="edit" type="button" title="Portfolio editing is not implemented yet.">
              ...
            </button>
          </div>
          <div className="portfolio-card">
            <span className="dot" />
            <div>
              <div className="portfolio-title">Main inventory</div>
              <div className="portfolio-value">{valuation ? fmtUsd(valuation.totalValueCents) : 'No value yet'}</div>
            </div>
          </div>

          {authSteamId !== null && (
            <div className="side-section">
              <div className="side-label">Inventory actions</div>
              <button className="primary side-button" disabled={busy !== null} type="button" onClick={() => void doSync('')}>
                {busy === 'sync' ? 'Syncing...' : 'Sync my inventory'}
              </button>
              <input
                className="sync-input"
                type="text"
                placeholder="Steam URL, SteamID64, or trade link"
                value={syncInput}
                disabled={busy !== null}
                onChange={(e) => setSyncInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && syncInput.trim() !== '') void doSync();
                }}
              />
              <div className="side-actions">
                <button className="secondary" disabled={busy !== null || syncInput.trim() === ''} type="button" onClick={() => void doSync()}>
                  Sync link
                </button>
                <button className="secondary" disabled={busy !== null} type="button" onClick={() => void doSync('demo')}>
                  Demo
                </button>
              </div>
              <button className="secondary side-button" disabled={busy !== null} type="button" onClick={() => void doRefresh()}>
                {busy === 'refresh' ? 'Refreshing...' : 'Refresh prices'}
              </button>
              <button className="secondary side-button" disabled={busy !== null} type="button" onClick={() => void doLogout()}>
                Sign out
              </button>
            </div>
          )}

          <div className="side-section">
            <div className="side-label">Coverage</div>
            <div className="side-metric">
              <span>Priced</span>
              <strong>{valuation ? `${valuation.pricedPositions}/${valuation.totalPositions}` : '-'}</strong>
            </div>
            <div className="side-metric">
              <span>Missing prices</span>
              <strong>{valuation ? missingCount : '-'}</strong>
            </div>
            <div className="side-metric">
              <span>Last sync</span>
              <strong>{portfolio?.lastSyncAt ? fmtTimestamp(portfolio.lastSyncAt) : '-'}</strong>
            </div>
          </div>
        </aside>

        <main className="content">
          {error && (
            <div className="banner banner-error">
              <span>{error}</span>
              <button className="linklike" type="button" onClick={() => setError(null)}>
                dismiss
              </button>
            </div>
          )}
          {notice && (
            <div className="banner banner-info">
              <span>{notice}</span>
              <button className="linklike" type="button" onClick={() => setNotice(null)}>
                dismiss
              </button>
            </div>
          )}

          {loading ? (
            <div className="skeleton-stack">
              <div className="skeleton" style={{ height: 118 }} />
              <div className="skeleton" style={{ height: 438 }} />
              <div className="skeleton" style={{ height: 360 }} />
            </div>
          ) : authSteamId === null ? (
            <section className="card signed-out-panel">
              <h1>Sign in required</h1>
              <p>Sign in through Steam to load your real isolated portfolio and keep the working backend session flow.</p>
              <a className="primary" href="/api/auth/steam/login">
                Sign in through Steam
              </a>
            </section>
          ) : !portfolio || !valuation ? (
            <section className="card signed-out-panel">
              <h1>No portfolio loaded yet</h1>
              <p>Sync your Steam inventory to start tracking live prices, cost basis, and portfolio history.</p>
            </section>
          ) : (
            <>
              <section className="portfolio-header">
                <span className="placeholder-logo" />
                <div className="portfolio-hero-copy">
                  <div className="title-row">
                    Main inventory <span className="tag">Live</span>
                  </div>
                  <div className="value-row">
                    <h1 className="portfolio-value-main">{fmtUsd(valuation.totalValueCents)}</h1>
                  </div>
                  <div className={`daily-change ${dailyChange ? plClass(dailyChange.delta) : ''}`}>
                    {dailyChange ? (
                      <>
                        {fmtSignedUsd(dailyChange.delta)}
                        {dailyChange.pct != null ? ` (${fmtSignedPct(dailyChange.pct)})` : ''} 24h
                      </>
                    ) : (
                      '24h change unavailable until another snapshot exists'
                    )}
                  </div>
                  <div className="portfolio-summary-grid">
                    <div className="header-metric">
                      <span className="metric-label">Cost basis</span>
                      <strong className="metric-value">{fmtUsd(valuation.investedCents)}</strong>
                    </div>
                    <div className={`header-metric ${plClass(valuation.unrealizedPlCents)}`}>
                      <span className="metric-label">All-time profit</span>
                      <strong className="metric-value">{fmtSignedUsd(valuation.unrealizedPlCents)}</strong>
                      <span className="metric-sub">{valuation.unrealizedPlPct != null ? fmtSignedPct(valuation.unrealizedPlPct) : 'N/A'}</span>
                    </div>
                    <div className="header-metric">
                      <span className="metric-label">Positions</span>
                      <strong className="metric-value">{valuation.totalPositions}</strong>
                      <span className="metric-sub">{missingCount > 0 ? `${missingCount} missing prices` : 'all priced'}</span>
                    </div>
                  </div>
                </div>
                <div className="header-actions">
                  <button className="primary" disabled={busy !== null} type="button" onClick={() => void doSync('')}>
                    Import
                  </button>
                  <ExportPopover portfolio={portfolio} />
                </div>
              </section>

              <div className="performers-row">
                <PerformerCard title="Best performer" position={best} emptyText="Add cost basis to calculate top performers." />
                <PerformerCard title="Worst performer" position={worst} emptyText="No losing position is computable yet." />
              </div>

              <div className="dashboard">
                <div className="stack">
                  <ValueChart points={history?.points ?? []} kind="holdings" range={range} onRangeChange={changeRange} />
                  <ValueChart points={history?.points ?? []} kind="performance" />
                </div>
                <div className="right-stack">
                  <AllocationDonut allocation={valuation.byCategory} />
                  <section className="card source-card">
                    <h2 className="card-title">Sources</h2>
                    <div className="source-list">
                      {portfolio.priceSources.map((s) => (
                        <span key={s.id} className={`source-pill ${s.configured ? 'on' : 'off'}`}>
                          {s.displayName}
                          <em>{s.configured ? (s.id === 'mock' ? 'mock' : 'live') : 'no key'}</em>
                        </span>
                      ))}
                    </div>
                    <p className="card-subtitle">
                      As of {fmtTimestamp(valuation.asOf)}
                      {version ? ` - build ${version}` : ''}
                    </p>
                  </section>
                </div>
              </div>

              <PositionsTable positions={valuation.positions} onChanged={onTableChanged} onError={setError} />
            </>
          )}
        </main>
      </div>
    </>
  );
}
