import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay, parseDmyDisplay, toOracleDate } from '../utils/dateFormat';

const LIST_COLUMNS = [
  { key: 'bill_date', label: 'Date' },
  { key: 'bill_no', label: 'Inward No.', align: 'right' },
  { key: 'code', label: 'Party' },
  { key: 'party_name', label: 'Party Name' },
  { key: 'line_count', label: 'Lines', align: 'right' },
  { key: 'tot_amt', label: 'Amount', align: 'right' },
];

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GoodsInwardListModal({
  open,
  apiBase,
  apiParams,
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
  const toDateRef = useRef(null);
  const partyRef = useRef(null);
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
        const { data } = await axios.get(`${apiRoot}/api/goods-inward/list`, {
          params: {
            ...apiParams,
            sdt: includeDates && nextSdt ? toOracleDate(nextSdt) : undefined,
            edt: includeDates && nextEdt ? toOracleDate(nextEdt) : undefined,
            party: String(nextParty ?? '').trim() || undefined,
          },
          ...reqOpts,
        });
        setRows(
          (data || []).map((r) => ({
            _id: `${r.bill_no}-${r.bill_date}`,
            bill_no: r.bill_no,
            bill_date: r.bill_date,
            code: r.code,
            party_name: r.party_name,
            line_count: r.line_count,
            tot_amt: fmtAmt(r.tot_amt),
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
    [apiParams, apiRoot, sdt, edt, party]
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
    void runSearch(false, { sdt: fyMinYmd, edt: fyMaxYmd, party: '' });
  }, [open, fyMinYmd, fyMaxYmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickRow = (row) => {
    if (!row || !onSelect) return;
    onSelect(row);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Goods inward list">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel voucher-help-modal__panel--account">
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">Goods Inward — List</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="purchase-order-list-modal__filters">
          <label>
            <span>From</span>
            <input
              ref={fromDateRef}
              className="voucher-help-modal__input"
              value={sdtText}
              onChange={(e) => setSdtText(e.target.value)}
              onBlur={() => {
                const parsed = parseDmyDisplay(sdtText);
                if (parsed) {
                  setSdt(parsed);
                  setSdtText(formatLedgerDateDisplay(parsed));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  toDateRef.current?.focus();
                }
              }}
              placeholder="dd/mm/yyyy"
            />
          </label>
          <label>
            <span>To</span>
            <input
              ref={toDateRef}
              className="voucher-help-modal__input"
              value={edtText}
              onChange={(e) => setEdtText(e.target.value)}
              onBlur={() => {
                const parsed = parseDmyDisplay(edtText);
                if (parsed) {
                  setEdt(parsed);
                  setEdtText(formatLedgerDateDisplay(parsed));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  partyRef.current?.focus();
                }
              }}
              placeholder="dd/mm/yyyy"
            />
          </label>
          <label>
            <span>Party</span>
            <input
              ref={partyRef}
              className="voucher-help-modal__input"
              value={party}
              onChange={(e) => setParty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-sm btn-primary" disabled={loading} onClick={() => void runSearch()}>
            Search
          </button>
        </div>
        {error ? <p className="purchase-order-checklist-modal__error">{error}</p> : null}
        <div className="voucher-help-modal__body voucher-help-modal__body--account">
          <table className="voucher-help-modal__table voucher-help-modal__table--account">
            <thead>
              <tr>
                {LIST_COLUMNS.map((c) => (
                  <th key={c.key} className={c.align === 'right' ? 'voucher-help-modal__num' : ''}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row._id}
                  className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}`}
                  tabIndex={0}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pickRow(row)}
                  onDoubleClick={() => pickRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      pickRow(row);
                    }
                  }}
                >
                  {LIST_COLUMNS.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'voucher-help-modal__num' : ''}>
                      {c.key === 'bill_date' ? formatLedgerDateDisplay(row[c.key]) || row[c.key] : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !rows.length ? <p className="voucher-help-modal__empty">No records.</p> : null}
        </div>
      </div>
    </div>
  );
}
