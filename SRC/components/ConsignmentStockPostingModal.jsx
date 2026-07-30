import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay, toOracleDateFromAny } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmt(v, dec = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Post CPUR consignment entry into LOTSTOCK (VFP cstock posting). */
export default function ConsignmentStockPostingModal({
  open,
  apiBase,
  apiParams,
  compYear,
  rNo,
  rDate,
  onClose,
  onPosted,
}) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    if (!open || !rNo) return;
    setBusy(true);
    setErr('');
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/posting'), {
        params: {
          ...apiParams,
          r_no: rNo,
          r_date: toOracleDateFromAny(rDate) || rDate || undefined,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setStatus(data?.rows?.length ? `${data.rows.length} LOTSTOCK row(s) found.` : 'Not posted to LOTSTOCK yet.');
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Failed to load LOTSTOCK.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, open, rDate, rNo]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handlePost = useCallback(async () => {
    if (!rNo) return;
    if (!window.confirm(`Post Sr.No. ${rNo} to LOTSTOCK?`)) return;
    setPosting(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/consignment-stock/post'),
        {
          ...apiParams,
          comp_year: compYear,
          r_no: rNo,
          r_date: toOracleDateFromAny(rDate) || rDate,
        },
        reqOpts
      );
      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setRows(nextRows);
      setStatus(`Posted ${data?.posted ?? nextRows.length} LOTSTOCK row(s).`);
      onPosted?.(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Posting failed.');
    } finally {
      setPosting(false);
    }
  }, [apiBase, apiParams, compYear, onPosted, rDate, rNo]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="dialog" aria-modal="true" aria-label="Consignment posting">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel pb-posting-modal">
        <header className="voucher-help-modal__head">
          <h3>
            Posting — PC {rNo} · {toOracleDateFromAny(rDate) || rDate || ''}
          </h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pb-posting-modal__summary">
          <span>{status}</span>
          <button type="button" className="pb-posting-modal__refresh" onClick={() => void load()} disabled={busy || posting}>
            Refresh
          </button>
        </div>
        {err ? (
          <p className="form-api-error" role="alert">
            {err}
          </p>
        ) : null}
        {busy ? <p className="voucher-entry-form__status">Loading LOTSTOCK…</p> : null}
        <div className="voucher-help-modal__body pb-posting-modal__body">
          {!rows.length && !busy ? (
            <p className="pb-posting-modal__empty">No LOTSTOCK rows. Click Post to LOTSTOCK.</p>
          ) : (
            <table className="pb-posting-modal__table">
              <thead>
                <tr>
                  <th>St</th>
                  <th className="pb-num">Item</th>
                  <th>Name</th>
                  <th className="pb-num">Lot</th>
                  <th className="pb-num">Bikri</th>
                  <th>Party</th>
                  <th className="pb-num">Qty</th>
                  <th className="pb-num">Weight</th>
                  <th className="pb-num">Amount</th>
                  <th>God</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.status}-${r.lot}-${i}`}>
                    <td>{r.status}</td>
                    <td className="pb-num">{r.item_code}</td>
                    <td className="pb-posting-modal__name">{r.item_name}</td>
                    <td className="pb-num">{r.lot}</td>
                    <td className="pb-num">{r.b_no}</td>
                    <td>{r.sup_code}</td>
                    <td className="pb-num">{fmt(r.qnty, 3)}</td>
                    <td className="pb-num">{fmt(r.weight, 3)}</td>
                    <td className="pb-num">{fmt(r.amount)}</td>
                    <td>{r.god_code}</td>
                    <td>{formatLedgerDateDisplay(r.vr_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pb-posting-modal__foot">
          <button type="button" className="btn btn-primary" onClick={() => void handlePost()} disabled={posting || !rNo}>
            {posting ? 'Posting…' : 'Post to LOTSTOCK'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={posting}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
