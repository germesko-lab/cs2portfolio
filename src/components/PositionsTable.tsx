'use client';

import { useState } from 'react';
import type { PositionValuation } from '@/lib/contracts/valuation';
import type { CostBasisResponse } from '@/lib/contracts/api';
import { api } from './api';
import {
  CATEGORY_LABELS,
  fmtSignedPct,
  fmtSignedUsd,
  fmtTimestamp,
  fmtUsd,
  plClass,
} from './format';

function NameCell({ p }: { p: PositionValuation }) {
  const it = p.item;
  return (
    <div className="pos-name">
      {it.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.iconUrl} alt="" className="pos-icon" loading="lazy" />
      ) : (
        <span className="pos-icon pos-icon-fallback" />
      )}
      <div>
        <div className="pos-title">
          {it.marketHashName.startsWith('★') && <span className="badge badge-star">★</span>}
          {it.statTrak && <span className="badge badge-st">ST™</span>}
          {it.souvenir && <span className="badge badge-souvenir">SV</span>}
          {it.baseName}
        </div>
        <div className="pos-sub">
          {CATEGORY_LABELS[it.category]}
          {it.wearName ? ` · ${it.wearName}` : ''}
          {it.floatValue != null ? ` · float ${it.floatValue.toFixed(4)}` : ''}
          {it.stickers.length > 0 ? ` · ${it.stickers.length} sticker${it.stickers.length > 1 ? 's' : ''}` : ''}
        </div>
      </div>
    </div>
  );
}

function BestPriceCell({ p }: { p: PositionValuation }) {
  const [open, setOpen] = useState(false);
  const bp = p.bestPrice;
  if (!bp) return <span className="dim">—</span>;
  return (
    <div className="bestprice">
      <button className="linklike" onClick={() => setOpen((o) => !o)} title="Show all sources">
        {fmtUsd(bp.best.priceCents)}
      </button>
      <span className="pos-sub">
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
        <button className="btn btn-xs" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        {p.costBasisSource === 'manual' && (
          <button className="btn btn-xs" disabled={busy} onClick={() => void reset()}>
            Auto
          </button>
        )}
        <button className="btn btn-xs" disabled={busy} onClick={() => setEditing(false)}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      className="linklike basis-view"
      title="Click to edit cost basis"
      onClick={() => {
        setText(p.costBasisCents != null ? (p.costBasisCents / 100).toFixed(2) : '');
        setEditing(true);
      }}
    >
      {p.costBasisCents != null ? fmtUsd(p.costBasisCents) : '—'}
      {p.costBasisSource && (
        <span className={`tag tag-${p.costBasisSource}`}>{p.costBasisSource}</span>
      )}
    </button>
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
    <div className="panel">
      <h2 className="panel-title">Positions ({positions.length})</h2>
      <div className="table-scroll">
        <table className="pos-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Best price</th>
              <th>Value</th>
              <th>Cost basis</th>
              <th>Unrealized P/L</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.assetId}>
                <td>
                  <NameCell p={p} />
                </td>
                <td>
                  <BestPriceCell p={p} />
                </td>
                <td className="num">
                  {p.currentValueCents != null ? fmtUsd(p.currentValueCents) : <span className="dim">—</span>}
                </td>
                <td>
                  <CostBasisCell p={p} onSaved={onChanged} onError={onError} />
                </td>
                <td className={`num ${plClass(p.unrealizedPlCents)}`}>
                  {p.unrealizedPlCents != null ? (
                    <>
                      {fmtSignedUsd(p.unrealizedPlCents)}
                      {p.unrealizedPlPct != null && (
                        <span className="pos-sub"> {fmtSignedPct(p.unrealizedPlPct)}</span>
                      )}
                    </>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td>
                  <span
                    className={`status status-${p.priceStatus}`}
                    title={
                      p.bestPrice ? `Fetched ${fmtTimestamp(p.bestPrice.best.fetchedAt)}` : 'No source can price this item'
                    }
                  >
                    {p.priceStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
