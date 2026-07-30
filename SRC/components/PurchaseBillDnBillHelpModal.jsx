import React, { useEffect, useMemo, useState } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';

function fmtQty(v) {
  const x = Number(v) || 0;
  return x.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function fmtAmt(v) {
  const x = Number(v) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * VFP purchase_gst TEMP help for Debit Note — pick PU bill line(s) for supplier.
 */
export default function PurchaseBillDnBillHelpModal({
  open,
  rows = [],
  loading = false,
  error = '',
  supplierCode = '',
  onApply,
  onClose,
}) {
  const [chosen, setChosen] = useState(() => new Set());
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) return;
    setChosen(new Set());
    setHighlight(0);
  }, [open, rows]);

  const selectedRows = useMemo(() => rows.filter((r) => chosen.has(r.id)), [rows, chosen]);

  if (!open) return null;

  const toggle = (id) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (chosen.size === rows.length) setChosen(new Set());
    else setChosen(new Set(rows.map((r) => r.id)));
  };

  const apply = () => {
    if (!selectedRows.length) {
      window.alert('Tick Choose on one or more purchase bill lines, then Apply.');
      return;
    }
    onApply?.(selectedRows);
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
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
    if (e.key === ' ' && rows[highlight]) {
      e.preventDefault();
      toggle(rows[highlight].id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (chosen.size) apply();
      else if (rows[highlight]) {
        toggle(rows[highlight].id);
      }
    }
  };

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="presentation" onClick={onClose}>
      <div
        className="voucher-help-modal__panel pb-dn-bill-help"
        role="dialog"
        aria-modal="true"
        aria-label="Purchase bill help for debit note"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        ref={(el) => el?.focus?.()}
      >
        <header className="voucher-help-modal__head">
          <h3>Temp — Purchase bills (PU){supplierCode ? ` · ${supplierCode}` : ''}</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="pb-dn-bill-help__hint">
          Tick <strong>Choose</strong> on lines to reverse, then <strong>Apply</strong> (Space toggles, Enter
          applies).
        </p>
        {error ? <p className="voucher-help-modal__error">{error}</p> : null}
        <div className="voucher-help-modal__body pb-dn-bill-help__body">
          {loading ? (
            <p className="voucher-help-modal__empty">Loading…</p>
          ) : !rows.length ? (
            <p className="voucher-help-modal__empty">No purchase bills for this supplier.</p>
          ) : (
            <table className="voucher-help-modal__table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && chosen.size === rows.length}
                      onChange={toggleAll}
                      title="Select all"
                    />
                  </th>
                  <th>R date</th>
                  <th>R no</th>
                  <th>Bill no</th>
                  <th>Bill date</th>
                  <th>Item</th>
                  <th>Item name</th>
                  <th>Status</th>
                  <th className="num">Qnty</th>
                  <th className="num">Weight</th>
                  <th className="num">Rate</th>
                  <th>Lot</th>
                  <th>B no</th>
                  <th>B code</th>
                  <th>God</th>
                  <th>Mlot no</th>
                  <th>So no</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={i === highlight ? 'is-highlight' : undefined}
                    onClick={() => setHighlight(i)}
                    onDoubleClick={() => {
                      setChosen(new Set([r.id]));
                      onApply?.([r]);
                      onClose?.();
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={chosen.has(r.id)}
                        onChange={() => toggle(r.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>{formatLedgerDateDisplay(r.r_date) || r.r_date}</td>
                    <td>{r.r_no}</td>
                    <td>{r.bill_no}</td>
                    <td>{formatLedgerDateDisplay(r.bill_date) || r.bill_date}</td>
                    <td>{r.item_code}</td>
                    <td>{r.item_name}</td>
                    <td>{r.status}</td>
                    <td className="num">{fmtQty(r.qnty)}</td>
                    <td className="num">{fmtQty(r.weight)}</td>
                    <td className="num">{fmtAmt(r.rate)}</td>
                    <td>{r.lot || ''}</td>
                    <td>{r.b_no || ''}</td>
                    <td>{r.b_code}</td>
                    <td>{r.god_code}</td>
                    <td>{r.mlot_no}</td>
                    <td>{r.so_no || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="voucher-help-modal__foot pb-dn-bill-help__foot">
          <span>{chosen.size} selected</span>
          <div className="pb-dn-bill-help__actions">
            <button type="button" className="btn btn-primary" disabled={!chosen.size} onClick={apply}>
              Apply
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
