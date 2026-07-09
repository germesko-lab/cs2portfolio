'use client';

import { useState } from 'react';
import type { PositionValuation } from '@/lib/contracts/valuation';
import type { CostBasisResponse } from '@/lib/contracts/api';
import { api } from './api';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  fmtSignedPct,
  fmtSignedUsd,
  fmtTimestamp,
  fmtUsd,
  plClass,
} from './format';

export function FloatBadge({ p }: { p: PositionValuation }) {
  const item = p.item;
  if (item.floatValue == null && item.paintSeed == null) return <span className="muted-mini">Unavailable</span>;
  const shortValue = item.floatValue != null ? item.floatValue.toFixed(4) : String(item.paintSeed);
  const lines = [
    item.floatValue != null ? `Float: ${item.floatValue.toFixed(8)}` : null,
    item.paintSeed != null ? `Paint seed: ${item.paintSeed}` : null,
    'Fade percentage/rank is not in the backend contract yet.',
  ].filter(Boolean);
  return (
    <span className="float-badge" tabIndex={0} data-tip={lines.join('\n')}>
      {shortValue}
    </span>
  );
}

function NameCell({ p }: { p: PositionValuation }) {
  const it = p.item;
  const floatText = it.floatValue != null ? ` - ${it.floatValue.toFixed(4)}` : '';
  return (
    <div className="asset">
      <div className="skin-thumb">
        {it.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.iconUrl} alt="" loading="lazy" />
        ) : (
          <span className="skin-thumb-fallback" />
        )}
      </div>
      <div className="asset-copy">
        <div className="asset-title" title={it.marketHashName}>
          {it.marketHashName.startsWith('\u2605') && <span className="table-badge">*</span>}
          {it.statTrak && <span className="table-badge table-badge-orange">ST</span>}
          {it.souvenir && <span className="table-badge table-badge-gold">SV</span>}
          {it.baseName}
        </div>
        <div className="asset-meta">
          <span className="rarity-dot" style={{ background: CATEGORY_COLORS[it.category] }} />
          {CATEGORY_LABELS[it.category]}
          {it.wearName ? ` - ${it.wearName}` : ''}
          {floatText}
          {it.stickers.length > 0 ? ` - ${it.stickers.length} sticker${it.stickers.length > 1 ? 's' : ''}` : ''}
        </div>
        <div className="asset-float-line">
          <FloatBadge p={p} />
          {it.paintSeed != null && <span className="seed-chip">Seed {it.paintSeed}</span>}
        </div>
      </div>
    </div>
  );
}

function BestPriceCell({ p }: { p: PositionValuation }) {
  const [open, setOpen] = useState(false);
  const bp = p.bestPrice;
  if (!bp) return <span className="missing-price">No market price</span>;
  return (
    <div className="source-cell">
      <button className="linklike price-link" type="button" onClick={() => setOpen((o) => !o)}>
        {fmtUsd(bp.best.priceCents)}
      </button>
      <span className="source-sub">
        {bp.best.url ? (
          <a href={bp.best.url} target="_blank" rel="noreferrer">
            {bp.best.sourceDisplayName}
          </a>
        ) : (
          bp.best.sourceDisplayName
        )}
      </span>
      {open && (
        <ul className="quote-pop">
          {bp.quotes.map((q) => (
            <li key={q.sourceId}>
              <span>{q.sourceDisplayName}</span>
              <span>{fmtUsd(q.priceCents)}</span>
              {q.listingsCount != null && <span className="dim">{q.listingsCount} listings</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CostBasisCell({
  p,
  onSaved,
  onError,
}: {
  p: PositionValuation;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const dollars = Number(text);
    if (!Number.isFinite(dollars) || dollars < 0) {
      onError('Cost basis must be a non-negative dollar amount.');
      return;
    }
    setBusy(true);
    try {
      await api<CostBasisResponse>(`/api/positions/${p.assetId}/cost-basis`, {
        method: 'PATCH',
        body: JSON.stringify({ amountCents: Math.round(dollars * 100) }),
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save cost basis.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api<CostBasisResponse>(`/api/positions/${p.assetId}/cost-basis`, {
        method: 'DELETE',
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to reset cost basis.');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="basis-edit">
        <input
          autoFocus
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button className="mini-btn" disabled={busy} type="button" onClick={() => void save()}>
          Save
        </button>
        {p.costBasisSource === 'manual' && (
          <button className="mini-btn" disabled={busy} type="button" onClick={() => void reset()}>
            Auto
          </button>
        )}
        <button className="mini-btn" disabled={busy} type="button" onClick={() => setEditing(false)}>
          x
        </button>
      </div>
    );
  }

  return (
    <button
      className="linklike basis-view"
      type="button"
      title="Click to edit cost basis"
      onClick={() => {
        setText(p.costBasisCents != null ? (p.costBasisCents / 100).toFixed(2) : '');
        setEditing(true);
      }}
    >
      {p.costBasisCents != null ? fmtUsd(p.costBasisCents) : 'Add cost'}
      {p.costBasisSource && <span className={`source-tag tag-${p.costBasisSource}`}>{p.costBasisSource}</span>}
    </button>
  );
}

function LiquidityCell({ p }: { p: PositionValuation }) {
  const listings = p.bestPrice?.best.listingsCount;
  if (listings == null) return <span className="dim">Unknown</span>;
  if (listings >= 30) return <span className="liquidity high">High</span>;
  if (listings >= 8) return <span className="liquidity medium">Medium</span>;
  return <span className="liquidity low">Low</span>;
}

function ActionsCell({ p }: { p: PositionValuation }) {
  return (
    <div className="action-icons">
      <button type="button" title="Watchlist state is not exposed by the backend yet.">
        *
      </button>
      <button type="button" title={p.bestPrice ? `Fetched ${fmtTimestamp(p.bestPrice.best.fetchedAt)}` : 'No price source yet'}>
        ...
      </button>
    </div>
  );
}

export default function PositionsTable({
  positions,
  onChanged,
  onError,
}: {
  positions: PositionValuation[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <section className="table-section">
      <div className="section-top">
        <div className="tabs">
          <button className="tab active" type="button">
            Assets
          </button>
          <button className="tab" type="button" disabled title="Transaction history is not exposed by the backend yet.">
            Transactions
          </button>
        </div>
        <div className="filters">
          <button className="filter" type="button" title="Frontend filter UI only; filtering is not wired yet.">
            All Types
            <span>v</span>
          </button>
          <button className="filter" type="button" title="Frontend filter UI only; filtering is not wired yet.">
            All Sources
            <span>v</span>
          </button>
        </div>
      </div>
      <div className="table-card">
        <table className="holdings-table" aria-label="CS2 skin portfolio assets">
          <thead>
            <tr>
              <th>Asset <span className="sortable">sort</span></th>
              <th>Est. Price <span className="sortable">sort</span></th>
              <th>24h <span className="sortable">sort</span></th>
              <th>7d <span className="sortable">sort</span></th>
              <th>Buy Price <span className="sortable">sort</span></th>
              <th>Profit/Loss <span className="sortable">sort</span></th>
              <th>Source</th>
              <th>Liquidity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.assetId} className={p.priceStatus === 'missing' ? 'no-price' : ''}>
                <td>
                  <NameCell p={p} />
                </td>
                <td>
                  <BestPriceCell p={p} />
                </td>
                <td className="num">
                  <span className="dim">N/A</span>
                </td>
                <td className="num">
                  <span className="dim">N/A</span>
                </td>
                <td>
                  <CostBasisCell p={p} onSaved={onChanged} onError={onError} />
                </td>
                <td className={`num ${plClass(p.unrealizedPlCents)}`}>
                  {p.unrealizedPlCents != null ? (
                    <>
                      {fmtSignedUsd(p.unrealizedPlCents)}
                      {p.unrealizedPlPct != null && <span className="sub-value"> {fmtSignedPct(p.unrealizedPlPct)}</span>}
                    </>
                  ) : (
                    <span className="dim">-</span>
                  )}
                </td>
                <td>
                  <span className="source-pill compact">{p.bestPrice?.best.sourceDisplayName ?? 'Pending'}</span>
                </td>
                <td>
                  <LiquidityCell p={p} />
                </td>
                <td>
                  <ActionsCell p={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
