import React, { useEffect, useState } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';

function fmtQty(v) {
  const x = Number(v) || 0;
  return x.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function fmtAmt(v) {
  const x = Number(v) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** VFP DCNOTE bill-date browse — single row pick. */
export default function DcNoteBillHelpModal({
  open,
  rows = [],
  loading = false,
  error = '',
  saleMode = false,
  partyCode = '',
  onSelect,
  onClose,
}) {
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
  }, [open, rows]);

  if (!open) return null;

  const pick = (row) => {
    if (!row) return;
    onSelect?.(row);
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(rows.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[highlight]);
    }
  };

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="presentation" onClick={onClose}>
      <div
        className="voucher-help-modal__panel pb-dn-bill-help dc-bill-help"
        role="dialog"
        aria-modal="true"
        aria-label="Bill date help"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        ref={(el) => el?.focus?.()}
      >
        <header className="voucher-help-modal__head">
          <h3>
            {saleMode ? 'Sale bills (SL)' : 'Purchase bills (PU / EV)'}
            {partyCode ? ` · ${partyCode}` : ''}
          </h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="pb-dn-bill-help__hint">
          Pick a row — fills <strong>Bill Date</strong>, <strong>DC Bill No</strong>, <strong>Type</strong>, and{' '}
          <strong>Bill No</strong> (Enter).
        </p>
        {error ? <p className="voucher-help-modal__error">{error}</p> : null}
        <div className="voucher-help-modal__body pb-dn-bill-help__body">
          {loading ? (
            <p className="voucher-help-modal__empty">Loading…</p>
          ) : !rows.length ? (
            <p className="voucher-help-modal__empty">No bills for this party.</p>
          ) : saleMode ? (
            <table className="voucher-help-modal__table">
              <thead>
                <tr>
                  <th>Bill No</th>
                  <th>Bill Date</th>
                  <th>Type</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Wt</th>
                  <th className="num">Rate</th>
                  <th className="num">Amt</th>
                  <th>Src</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={i === highlight ? 'is-highlight' : ''}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(r);
                      }
                    }}
                  >
                    <td>{r.bill_no ?? '—'}</td>
                    <td>{formatLedgerDateDisplay(r.bill_date)}</td>
                    <td>{r.b_type || '—'}</td>
                    <td>{r.item_code || '—'}</td>
                    <td className="num">{fmtQty(r.qnty)}</td>
                    <td className="num">{fmtQty(r.weight)}</td>
                    <td className="num">{fmtAmt(r.rate)}</td>
                    <td className="num">{fmtAmt(r.amount)}</td>
                    <td>{r.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="voucher-help-modal__table">
              <thead>
                <tr>
                  <th>R Date</th>
                  <th>R No</th>
                  <th>Bill Date</th>
                  <th>Bill No</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Wt</th>
                  <th className="num">Rate</th>
                  <th className="num">Amt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={i === highlight ? 'is-highlight' : ''}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(r);
                      }
                    }}
                  >
                    <td>{formatLedgerDateDisplay(r.r_date)}</td>
                    <td>{r.r_no ?? '—'}</td>
                    <td>{formatLedgerDateDisplay(r.bill_date)}</td>
                    <td>{r.bill_no || '—'}</td>
                    <td>
                      {r.item_code || '—'}
                      {r.item_name ? ` ${r.item_name}` : ''}
                    </td>
                    <td className="num">{fmtQty(r.qnty)}</td>
                    <td className="num">{fmtQty(r.weight)}</td>
                    <td className="num">{fmtAmt(r.rate)}</td>
                    <td className="num">{fmtAmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="voucher-help-modal__foot pb-dn-bill-help__foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
