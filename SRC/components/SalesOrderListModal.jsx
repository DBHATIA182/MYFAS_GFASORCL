import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { formatDmyTyping, formatLedgerDateDisplay, parseDmyDisplay, toOracleDate } from '../utils/dateFormat';

const LIST_COLUMNS = [
  { key: 'so_date', label: 'Date' },
  { key: 'so_no', label: 'Sr.No', align: 'right' },
  { key: 'code', label: 'Party' },
  { key: 'party_name', label: 'Party Name' },
  { key: 'po_no', label: 'P.O.No.' },
  { key: 'line_count', label: 'Lines', align: 'right' },
  { key: 'tot_amt', label: 'Amount', align: 'right' },
];

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SalesOrderListModal({
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
  const [poNo, setPoNo] = useState('');
  const [party, setParty] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState(0);
  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);
  const poNoRef = useRef(null);
  const partyRef = useRef(null);
  const apiRoot = apiBase == null ? '' : String(apiBase);

  const runSearch = useCallback(async (includeDates = true, overrides = null) => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    const next = overrides && typeof overrides === 'object' ? overrides : {};
    const nextSdt = next.sdt ?? sdt;
    const nextEdt = next.edt ?? edt;
    const nextPoNo = next.poNo ?? poNo;
    const nextParty = next.party ?? party;
    try {
      const { data } = await axios.get(`${apiRoot}/api/sales-order/list`, {
        params: {
          ...apiParams,
          sdt: includeDates && nextSdt ? toOracleDate(nextSdt) : undefined,
          edt: includeDates && nextEdt ? toOracleDate(nextEdt) : undefined,
          po_no: String(nextPoNo ?? '').trim() || undefined,
          party: String(nextParty ?? '').trim() || undefined,
        },
        ...reqOpts,
      });
      setRows(
        (data || []).map((r) => ({
          _id: `${r.so_no}-${r.so_date}`,
          so_no: r.so_no,
          so_date: r.so_date,
          code: r.code,
          party_name: r.party_name,
          po_no: r.po_no,
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
  }, [apiParams, apiRoot, sdt, edt, poNo, party]);

  useEffect(() => {
    if (!open) return;
    setSdt(fyMinYmd);
    setEdt(fyMaxYmd);
    setSdtText(formatLedgerDateDisplay(fyMinYmd));
    setEdtText(formatLedgerDateDisplay(fyMaxYmd));
    setPoNo('');
    setParty('');
    setHighlight(0);
    setRows([]);
    setError('');
    window.setTimeout(() => fromDateRef.current?.focus(), 40);
    void runSearch(false, { sdt: fyMinYmd, edt: fyMaxYmd, poNo: '', party: '' });
  }, [open, fyMinYmd, fyMaxYmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveFocus = useCallback((ref) => {
    window.setTimeout(() => ref?.current?.focus(), 0);
  }, []);

  const commitDateText = useCallback((kind) => {
    if (kind === 'sdt') {
      const parsed = parseDmyDisplay(sdtText);
      if (parsed) {
        setSdt(parsed);
        setSdtText(formatLedgerDateDisplay(parsed));
      } else if (!String(sdtText ?? '').trim()) {
        setSdt('');
        setSdtText('');
      } else {
        setSdtText(formatLedgerDateDisplay(sdt) || '');
      }
      return;
    }
    const parsed = parseDmyDisplay(edtText);
    if (parsed) {
      setEdt(parsed);
      setEdtText(formatLedgerDateDisplay(parsed));
    } else if (!String(edtText ?? '').trim()) {
      setEdt('');
      setEdtText('');
    } else {
      setEdtText(formatLedgerDateDisplay(edt) || '');
    }
  }, [edt, edtText, sdt, sdtText]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const tag = String(e.target?.tagName || '').toUpperCase();
      const typingIntoField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((i) => Math.min(rows.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((i) => Math.max(0, i - 1));
        return;
      }
      if (!typingIntoField && e.key === 'Enter' && rows.length) {
        e.preventDefault();
        onSelect?.(rows[highlight]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, highlight, onSelect, onClose]);

  const title = useMemo(() => {
    const from = formatLedgerDateDisplay(sdt) || '…';
    const to = formatLedgerDateDisplay(edt) || '…';
    return `Sales orders — ${from} to ${to}`;
  }, [sdt, edt]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Sales order list">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-list-modal">
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{title}</h3>
          <p className="voucher-help-modal__hint">Search by date, P.O.No., or party · ↑↓ move · Enter pick · Esc close</p>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="purchase-order-list-modal__filters">
          <label className="purchase-order-list-modal__filter">
            <span>From date</span>
            <input
              ref={fromDateRef}
              type="text"
              className="form-input"
              value={sdtText}
              placeholder="dd/mm/yyyy"
              inputMode="numeric"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setSdtText(formatDmyTyping(e.target.value))}
              onBlur={() => commitDateText('sdt')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  commitDateText('sdt');
                  moveFocus(toDateRef);
                }
              }}
            />
          </label>
          <label className="purchase-order-list-modal__filter">
            <span>To date</span>
            <input
              ref={toDateRef}
              type="text"
              className="form-input"
              value={edtText}
              placeholder="dd/mm/yyyy"
              inputMode="numeric"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEdtText(formatDmyTyping(e.target.value))}
              onBlur={() => commitDateText('edt')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  commitDateText('edt');
                  moveFocus(poNoRef);
                }
              }}
            />
          </label>
          <label className="purchase-order-list-modal__filter">
            <span>P.O.No.</span>
            <input
              ref={poNoRef}
              type="text"
              className="form-input"
              value={poNo}
              placeholder="P.O. number…"
              onChange={(e) => setPoNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  moveFocus(partyRef);
                }
              }}
            />
          </label>
          <label className="purchase-order-list-modal__filter purchase-order-list-modal__filter--wide">
            <span>Party / name</span>
            <input
              ref={partyRef}
              type="text"
              className="form-input"
              value={party}
              placeholder="Party code or name…"
              onChange={(e) => setParty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  commitDateText('sdt');
                  commitDateText('edt');
                  void runSearch();
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void runSearch()} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="voucher-help-modal__body voucher-help-modal__body--account">
          {loading ? <p className="voucher-help-modal__msg">Loading…</p> : null}
          {!loading && error ? <p className="voucher-help-modal__msg voucher-help-modal__msg--err">{error}</p> : null}
          {!loading && !error && !rows.length ? (
            <p className="voucher-help-modal__msg">No sales orders found.</p>
          ) : null}
          {!loading && rows.length > 0 ? (
            <table className="voucher-help-modal__table voucher-help-modal__table--account">
              <thead>
                <tr>
                  {LIST_COLUMNS.map((col) => (
                    <th key={col.key} className={col.align === 'right' ? 'voucher-help-modal__num' : ''}>
                      {col.label}
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
                    onClick={() => onSelect?.(row)}
                    onDoubleClick={() => onSelect?.(row)}
                  >
                    {LIST_COLUMNS.map((col) => (
                      <td key={col.key} className={col.align === 'right' ? 'voucher-help-modal__num' : ''}>
                        {col.key === 'so_date' ? formatLedgerDateDisplay(row.so_date) || row.so_date : (row[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <footer className="voucher-help-modal__foot">
          <span>{rows.length} record(s)</span>
        </footer>
      </div>
    </div>
  );
}
