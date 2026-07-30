import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay, toInputDateString, toOracleDateFromAny } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 60000 };

const COLUMNS = [
  { key: 'r_no', label: 'Sr.No', align: 'right', width: 70 },
  { key: 'r_date', label: 'Date', width: 100 },
  { key: 'b_no', label: 'Bikri', align: 'right', width: 70 },
  { key: 'item_code', label: 'Item', align: 'right', width: 70 },
  { key: 'item_name', label: 'Item Name', width: 180 },
  { key: 'lot', label: 'Lot', align: 'right', width: 60 },
  { key: 'sup_code', label: 'Party', width: 80 },
  { key: 'party_name', label: 'Party Name', width: 160 },
  { key: 'weight', label: 'Weight', align: 'right', width: 100 },
  { key: 'amount', label: 'Amount', align: 'right', width: 110 },
];

function fmt(v, dec = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function ConsignmentStockListModal({
  open,
  onClose,
  apiBase,
  apiParams,
  onSelect,
}) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sdt, setSdt] = useState('');
  const [edt, setEdt] = useState('');
  const [party, setParty] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/list'), {
        params: {
          ...apiParams,
          sdt: toOracleDateFromAny(sdt) || undefined,
          edt: toOracleDateFromAny(edt) || undefined,
          party: party || undefined,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'List failed.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, sdt, edt, party]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.r_no, r.b_no, r.item_code, r.item_name, r.sup_code, r.party_name, r.lot]
        .map((x) => String(x ?? '').toLowerCase())
        .some((x) => x.includes(needle))
    );
  }, [rows, q]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="presentation" onClick={onClose}>
      <div
        className="voucher-help-modal__panel cstock-list-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Consignment stock list"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voucher-help-modal__head">
          <h3>Consignment Stock List</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="cstock-list-modal__filters">
          <label>
            From
            <input className="form-input" type="date" value={sdt} onChange={(e) => setSdt(e.target.value)} />
          </label>
          <label>
            To
            <input className="form-input" type="date" value={edt} onChange={(e) => setEdt(e.target.value)} />
          </label>
          <label>
            Party
            <input className="form-input" value={party} onChange={(e) => setParty(e.target.value.toUpperCase())} />
          </label>
          <label>
            Search
            <input className="form-input" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
        {err ? (
          <p className="form-api-error" role="alert">
            {err}
          </p>
        ) : null}
        <div className="voucher-help-modal__body cstock-list-modal__body">
          <table className="cstock-list-modal__table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align || 'left' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={`${r.r_no}-${r.r_date}`}
                  onDoubleClick={() => {
                    onSelect?.(r);
                    onClose?.();
                  }}
                  onClick={() => onSelect?.(r)}
                >
                  <td style={{ textAlign: 'right' }}>{r.r_no}</td>
                  <td>{formatLedgerDateDisplay(r.r_date)}</td>
                  <td style={{ textAlign: 'right' }}>{r.b_no}</td>
                  <td style={{ textAlign: 'right' }}>{r.item_code}</td>
                  <td>{r.item_name}</td>
                  <td style={{ textAlign: 'right' }}>{r.lot}</td>
                  <td>{r.sup_code}</td>
                  <td>{r.party_name}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.weight, 3)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td>
                </tr>
              ))}
              {!filtered.length && !busy ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="cstock-list-modal__empty">
                    No records
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <footer className="voucher-help-modal__foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
