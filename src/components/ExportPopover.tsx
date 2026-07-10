'use client';

import { useEffect, useRef, useState } from 'react';
import type { PortfolioResponse } from '@/lib/contracts/api';
import { fmtTimestamp } from './format';

function csvEscape(value: string | number | null | undefined) {
  const s = value == null ? '' : String(value);
  return `"${s.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ExportPopover({ portfolio }: { portfolio: PortfolioResponse | null }) {
  const [open, setOpen] = useState(false);
  const [includeOverview, setIncludeOverview] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function exportCsv() {
    if (!portfolio) return;
    const rows: Array<Array<string | number | null | undefined>> = [];
    if (includeOverview) {
      rows.push(['Portfolio overview']);
      rows.push(['Steam ID', portfolio.steamId]);
      rows.push(['Total value cents', portfolio.valuation.totalValueCents]);
      rows.push(['Cost basis cents', portfolio.valuation.investedCents]);
      rows.push(['Unrealized P/L cents', portfolio.valuation.unrealizedPlCents]);
      rows.push([]);
      rows.push([
        'Asset ID',
        'Market hash name',
        'Category',
        'Exterior',
        'Float',
        'Paint seed',
        'Current value cents',
        'Cost basis cents',
        'P/L cents',
        'Price status',
        'Best source',
      ]);
      portfolio.valuation.positions.forEach((p) => {
        rows.push([
          p.assetId,
          p.marketHashName,
          p.item.category,
          p.item.wearName,
          p.item.floatValue,
          p.item.paintSeed,
          p.currentValueCents,
          p.costBasisCents,
          p.unrealizedPlCents,
          p.priceStatus,
          p.bestPrice?.best.sourceDisplayName,
        ]);
      });
    }
    downloadCsv(`cs2-portfolio-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    setOpen(false);
  }

  return (
    <div className="export-wrap" ref={ref}>
      <button className="secondary" type="button" onClick={() => setOpen((o) => !o)}>
        Export
      </button>
      {open && (
        <div className="export-popover" role="dialog" aria-label="Export portfolio">
          <label className="export-option">
            <input
              className="export-choice"
              type="checkbox"
              checked={false}
              disabled
              readOnly
            />
            <span className="export-option-text">
              <strong>Transaction History</strong>
              <small>Available after ledger export is implemented</small>
            </span>
            <span className="export-check" aria-hidden="true" />
          </label>
          <label className="export-option">
            <input
              className="export-choice"
              type="checkbox"
              checked={includeOverview}
              onChange={(e) => setIncludeOverview(e.target.checked)}
            />
            <span className="export-option-text">
              <strong>Portfolio Overview</strong>
              <small>
                {portfolio?.valuation.asOf ? `Snapshot from ${fmtTimestamp(portfolio.valuation.asOf)}` : 'Current portfolio snapshot'}
              </small>
            </span>
            <span className="export-check" aria-hidden="true" />
          </label>
          <div className="export-footer">
            <button
              className="primary export-submit"
              type="button"
              disabled={!portfolio || !includeOverview}
              onClick={exportCsv}
            >
              Export to CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
