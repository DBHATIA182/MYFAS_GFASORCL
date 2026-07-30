import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import { num } from '../utils/purchaseBillCalc';

function calcExpAmount(row, line) {
  const rate = num(row.exp_rate);
  if (!rate) return 0;
  const cal = String(row.cal_type ?? 'W').trim().toUpperCase();
  let base = 0;
  if (cal === 'Q') base = num(line?.qnty);
  else if (cal === 'A') base = num(line?.amount);
  else base = num(line?.weight);
  return Math.round(base * rate * 100) / 100;
}

/** VFP GRID2 / PUREXP — per-line expenses (Esc from grid1 when G_PUR_EXP=Y). */
export default function PurchaseBillExpGridModal({
  open,
  line,
  lineNo,
  masterRows = [],
  value = [],
  accounts = [],
  editable,
  onChange,
  onClose,
  onAccountHelp,
  helpCodePatch,
  onHelpCodePatchApplied,
}) {
  const focusChain = useMemo(() => createEnterFocusChain(), []);
  const [rows, setRows] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const map = new Map((value || []).map((r) => [String(r.exp_name ?? '').trim().toUpperCase(), r]));
    const built = (masterRows || []).map((m, idx) => {
      const key = String(m.exp_name ?? '').trim().toUpperCase();
      const saved = map.get(key);
      const base = {
        key: idx + 1,
        exp_name: m.exp_name || '',
        exp_rate: saved?.exp_rate != null ? String(saved.exp_rate) : String(m.exp_rate ?? ''),
        cal_type: saved?.cal_type || m.cal_type || 'W',
        code: saved?.code || m.code || '',
        ac_name: saved?.ac_name || m.ac_name || '',
        amount: saved?.amount != null ? String(saved.amount) : '',
      };
      if (!base.amount && base.exp_rate) {
        const amt = calcExpAmount(base, line);
        if (amt) base.amount = String(amt);
      }
      return base;
    });
    setRows(built.length ? built : []);
    window.setTimeout(() => searchRef.current?.focus(), 40);
  }, [open, masterRows, value, line]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const focusKeys = useMemo(() => {
    const keys = [];
    for (const r of rows) {
      keys.push(`exp-${r.key}-rate`, `exp-${r.key}-amt`, `exp-${r.key}-code`);
    }
    return keys;
  }, [rows]);

  useEffect(() => {
    focusChain.setOrder(focusKeys);
  }, [focusChain, focusKeys]);

  useEffect(() => {
    if (!helpCodePatch?.rowKey) return;
    setRows((prev) =>
      prev.map((x) =>
        x.key === helpCodePatch.rowKey
          ? { ...x, code: helpCodePatch.code, ac_name: helpCodePatch.ac_name || x.ac_name }
          : x
      )
    );
    onHelpCodePatchApplied?.();
  }, [helpCodePatch, onHelpCodePatchApplied]);

  const commit = () => {
    const out = rows
      .filter((r) => num(r.amount) !== 0 || num(r.exp_rate) !== 0)
      .map((r) => ({
        trn_no: line?.trn_no,
        exp_name: r.exp_name,
        exp_rate: num(r.exp_rate),
        cal_type: r.cal_type,
        amount: num(r.amount),
        code: r.code,
      }));
    onChange?.(out);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="voucher-help-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="voucher-help-card purchase-bill-exp-grid"
        role="dialog"
        aria-modal="true"
        aria-label="Line expenses"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="voucher-help-card__head">
          <h3>Line {lineNo} — Purchase Expenses (F1 on Code)</h3>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Esc Close
          </button>
        </header>
        <div className="purchase-bill-exp-grid__table-wrap">
          <table className="purchase-bill-exp-grid__table">
            <thead>
              <tr>
                <th>Exp.Name</th>
                <th>Rate</th>
                <th>Cal</th>
                <th>Amount</th>
                <th>Code</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.exp_name}</td>
                  <td>
                    <input
                      className="form-input"
                      value={r.exp_rate}
                      disabled={!editable}
                      ref={(el) => focusChain.register(`exp-${r.key}-rate`, el)}
                      onChange={(e) => {
                        const exp_rate = e.target.value.replace(/[^\d.]/g, '');
                        setRows((prev) =>
                          prev.map((x) => {
                            if (x.key !== r.key) return x;
                            const next = { ...x, exp_rate };
                            const amt = calcExpAmount(next, line);
                            return { ...next, amount: amt ? String(amt) : '' };
                          })
                        );
                      }}
                      onKeyDown={focusChain.onEnter(`exp-${r.key}-rate`)}
                    />
                  </td>
                  <td>{r.cal_type}</td>
                  <td>
                    <input
                      className="form-input"
                      value={r.amount}
                      disabled={!editable}
                      ref={(el) => focusChain.register(`exp-${r.key}-amt`, el)}
                      onChange={(e) => {
                        const amount = e.target.value.replace(/[^\d.]/g, '');
                        setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, amount } : x)));
                      }}
                      onKeyDown={focusChain.onEnter(`exp-${r.key}-amt`)}
                    />
                  </td>
                  <td>
                    <input
                      className="form-input"
                      value={r.code}
                      disabled={!editable}
                      ref={(el) => focusChain.register(`exp-${r.key}-code`, el)}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) => (x.key === r.key ? { ...x, code: e.target.value.toUpperCase() } : x))
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'F1' || (e.key === 'Enter' && e.shiftKey)) {
                          e.preventDefault();
                          onAccountHelp?.(r.key);
                          return;
                        }
                        focusChain.onEnter(`exp-${r.key}-code`)(e);
                      }}
                    />
                  </td>
                  <td>{r.ac_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="voucher-help-card__foot">
          <button type="button" className="btn btn-primary btn-sm" onClick={commit} disabled={!editable}>
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}

export { calcExpAmount };
