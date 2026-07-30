import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay, parseDmyDisplay, toOracleDate } from '../utils/dateFormat';

const LIST_COLUMNS = [
  { key: 'r_date', label: 'R.Date' },
  { key: 'r_no', label: 'R.No.', align: 'right' },
  { key: 'bill_no', label: 'Bill No.' },
  { key: 'code', label: 'Party' },
  { key: 'party_name', label: 'Party Name' },
  { key: 'line_count', label: 'Lines', align: 'right' },
  { key: 'tot_amt', label: 'Amount', align: 'right' },
];

const reqOpts = { withCredentials: true, timeout: 120000 };

export default function PurchaseBillListModal({
  open,
  apiBase,
  apiParams,
  billType = 'PU',
  fyMinYmd = '',
  fyMaxYmd = '',
  onSelect,
  onClose,
}) {
  const [sdt, setSdt] = useState(fyMinYmd);
  const [edt, setEdt] = useState(fyMaxYmd);
  const [sdtText, setSdtText] = useState(formatLedgerDateDisplay(fyMinYmd));
  const [edtText, setEdtText] = useState(formatLedgerDateDisplay(fyMaxYmd));
  const [party, setParty] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState(0);
  const fromDateRef = useRef(null);
  const apiRoot = apiBase == null ? '' : String(apiBase);

  const runSearch = useCallback(
    async (includeDates = true, overrides = null) => {
      if (!apiParams?.comp_code) return;
      setLoading(true);
      setError('');
      const next = overrides && typeof overrides === 'object' ? overrides : {};
      const nextSdt = next.sdt ?? sdt;
      const nextEdt = next.edt ?? edt;
      const nextParty = next.party ?? party;
      try {
        const { data } = await axios.get(`${apiRoot}/api/purchase-bill/list`, {
          params: {
            ...apiParams,
            type: billType,
            sdt: includeDates && nextSdt ? toOracleDate(nextSdt) : undefined,
            edt: includeDates && nextEdt ? toOracleDate(nextEdt) : undefined,
            party: String(nextParty ?? '').trim() || undefined,
          },
          ...reqOpts,
        });
        setRows(
          (data || []).map((r) => ({
            _id: `${r.r_no}-${r.r_date}`,
            r_date: r.r_date,
            r_no: r.r_no,
            bill_no: r.bill_no,
            code: r.code,
            party_name: r.party_name,
            line_count: r.line_count,
            tot_amt: r.tot_amt,
          }))
        );
        setHighlight(0);
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'List failed.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [apiParams, apiRoot, billType, sdt, edt, party]
  );

  useEffect(() => {
    if (!open) return;
    setSdt(fyMinYmd);
    setEdt(fyMaxYmd);
    setSdtText(formatLedgerDateDisplay(fyMinYmd));
    setEdtText(formatLedgerDateDisplay(fyMaxYmd));
    setParty('');
    setHighlight(0);
    setRows([]);
    setError('');
    window.setTimeout(() => fromDateRef.current?.focus(), 40);
    void runSearch(true, { sdt: fyMinYmd, edt: fyMaxYmd, party: '' });
  }, [open, fyMinYmd, fyMaxYmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickRow = (row) => {
    if (!row) return;
    onSelect?.({ r_no: row.r_no, r_date: row.r_date });
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="dialog" aria-modal="true" aria-label="Purchase bill list">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel pb-list-modal">
        <div className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">Purchase Bill List</h3>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pb-list-modal__filters">
          <label>
            From
            <input
              ref={fromDateRef}
              className="form-input"
              value={sdtText}
              onChange={(e) => setSdtText(e.target.value)}
              onBlur={() => {
                const p = parseDmyDisplay(sdtText);
                if (p) setSdt(p);
              }}
            />
          </label>
          <label>
            To
            <input
              className="form-input"
              value={edtText}
              onChange={(e) => setEdtText(e.target.value)}
              onBlur={() => {
                const p = parseDmyDisplay(edtText);
                if (p) setEdt(p);
              }}
            />
          </label>
          <label>
            Party
            <input className="form-input" value={party} onChange={(e) => setParty(e.target.value.toUpperCase())} />
          </label>
          <button type="button" className="btn btn-sm btn-primary" disabled={loading} onClick={() => void runSearch()}>
            {loading ? '…' : 'Search'}
          </button>
        </div>
        {error ? <p className="voucher-entry-form__status voucher-entry-form__status--err">{error}</p> : null}
        <div className="voucher-help-modal__body pb-list-modal__body">
          <table className="voucher-help-modal__table">
            <thead>
              <tr>
                {LIST_COLUMNS.map((c) => (
                  <th key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row._id}
                  className={idx === highlight ? 'voucher-help-modal__row--active' : ''}
                  onClick={() => pickRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') pickRow(row);
                  }}
                  tabIndex={0}
                >
                  {LIST_COLUMNS.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                      {row[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={LIST_COLUMNS.length}>No purchase bills found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
