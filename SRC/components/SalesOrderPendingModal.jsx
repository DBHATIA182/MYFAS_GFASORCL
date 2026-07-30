import React, { useEffect, useMemo, useRef, useState } from 'react';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import {
  downloadSalesOrderPendingExcel,
  exportSalesOrderPendingPdf,
  fetchSalesOrderPending,
  printSalesOrderPending,
  shareSalesOrderPendingWhatsApp,
} from '../utils/salesOrderPendingReport';

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];

const TITLES = {
  summary: 'Pending Sales Order — Summary',
  detail: 'Pending Sales Order — Detail',
  'date-wise': 'Pending Sales Order — Date Wise',
  'so-do-sale': 'Pending Sales Order — SO/DO/Sale',
};

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function detailBillNo(row) {
  if (Number(row?.m_type) === 1) return '';
  return String(row?.bill_no || '').trim();
}

function fmtDate(v) {
  return formatLedgerDateDisplay(v) || String(v ?? '').trim();
}

const DETAIL_SUM_KEYS = ['so_qty', 'sl_qty', 'bqty', 'so_wgt', 'sl_wgt', 'bwgt'];
const SO_DO_SALE_SUM_KEYS = [
  'so_qty',
  'do_qty',
  'sl_qty',
  'bqty',
  'bqty_so_do',
  'so_wgt',
  'do_wgt',
  'sl_wgt',
  'bwgt',
  'bwgt_so_do',
];

function sumDetailRows(list, keys) {
  const t = {};
  for (const k of keys) t[k] = 0;
  for (const r of list) for (const k of keys) t[k] += num(r[k]);
  return t;
}

function buildDetailDisplayItems(rows, keys) {
  const items = [];
  let currentSo = null;
  let orderBuf = [];

  const pushOrderTotal = () => {
    if (!orderBuf.length) return;
    items.push({ kind: 'order-total', so_no: currentSo, totals: sumDetailRows(orderBuf, keys) });
    orderBuf = [];
  };

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    if (currentSo !== null && row.so_no !== currentSo) pushOrderTotal();
    currentSo = row.so_no;
    orderBuf.push(row);
    items.push({ kind: 'data', row, idx });
  }
  pushOrderTotal();
  return items;
}

function emptyFilters(fyMinYmd, fyMaxYmd) {
  return {
    sdt: fyMinYmd || '',
    edt: fyMaxYmd || '',
    code: '',
    party_name: '',
    item_code: '',
    item_name: '',
    bk_code: '',
    bk_name: '',
    so_no: '',
    qnty_ignore: '0',
    rake_truck: '',
    d_e: '',
    god_code: '',
    god_name: '',
    msc: 'S',
  };
}

export default function SalesOrderPendingModal({
  open,
  hidden = false,
  mode = 'summary',
  apiBase,
  apiParams,
  fyMinYmd = '',
  fyMaxYmd = '',
  formData,
  parties = [],
  brokers = [],
  items = [],
  godowns = [],
  onSelectRow,
  onClose,
}) {
  const isSummaryLike = mode === 'summary' || mode === 'date-wise';
  const isSoDoSale = mode === 'so-do-sale';
  const allowSpecificOrderNo = mode === 'detail' || mode === 'so-do-sale';
  const title = TITLES[mode] || TITLES.summary;

  const [step, setStep] = useState('entry');
  const [filters, setFilters] = useState(() => emptyFilters(fyMinYmd, fyMaxYmd));
  const [payload, setPayload] = useState(null);
  const [summaryPayload, setSummaryPayload] = useState(null);
  const [reportView, setReportView] = useState('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [helpField, setHelpField] = useState(null);
  const [itemHelpOpen, setItemHelpOpen] = useState(false);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);

  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);
  const codeRef = useRef(null);
  const itemRef = useRef(null);
  const bkRef = useRef(null);
  const sonoRef = useRef(null);
  const qIgnoreRef = useRef(null);
  const rakeTruckRef = useRef(null);
  const deRef = useRef(null);
  const godRef = useRef(null);
  const mscRef = useRef(null);

  const godownRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const helpAccounts = useMemo(() => {
    if (helpField === 'bk_code') return brokers;
    return parties;
  }, [brokers, helpField, parties]);

  const printCtx = useMemo(
    () => ({
      formData,
      compCode: apiParams?.comp_code,
      compUid: apiParams?.comp_uid,
    }),
    [apiParams, formData]
  );

  const canExport = Boolean(payload?.rows?.length);
  const isReport = step === 'report';
  const isSummaryView = isReport && isSummaryLike && reportView === 'summary';
  const isDetailView = isReport && (mode === 'detail' || isSoDoSale || reportView === 'detail');
  const activeReportMode = isSummaryLike && reportView === 'detail' ? 'detail' : mode;
  const detailSumKeys = isSoDoSale && activeReportMode !== 'detail' ? SO_DO_SALE_SUM_KEYS : DETAIL_SUM_KEYS;
  const detailDisplayItems = useMemo(
    () => (isDetailView && payload?.rows?.length ? buildDetailDisplayItems(payload.rows, detailSumKeys) : []),
    [isDetailView, payload?.rows, detailSumKeys]
  );
  const reportTitle =
    isReport && isSummaryLike && reportView === 'detail'
      ? 'Pending Sales Order — Detail'
      : isReport
        ? `${title} — Report`
        : title;

  const resetAndOpen = () => {
    setStep('entry');
    setFilters(emptyFilters(fyMinYmd, fyMaxYmd));
    setPayload(null);
    setSummaryPayload(null);
    setReportView('summary');
    setError('');
    setExportErr('');
    setHighlight(0);
  };

  useEffect(() => {
    if (!open) return;
    resetAndOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fyMinYmd, fyMaxYmd, mode]);

  const moveFocus = (ref) => window.setTimeout(() => ref?.current?.focus(), 0);

  const runProceed = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const data = await fetchSalesOrderPending(apiBase, apiParams, mode, filters);
      if (!data?.rows?.length) {
        setError('No pending sales orders found for selected criteria.');
        setPayload(null);
        return;
      }
      setPayload(data);
      if (isSummaryLike) {
        setSummaryPayload(data);
        setReportView('summary');
      }
      setHighlight(0);
      setStep('report');
    } catch (err) {
      setPayload(null);
      setError(err.response?.data?.error || err.message || 'Report failed.');
    } finally {
      setLoading(false);
    }
  };

  const runExport = async (fn) => {
    if (!canExport) return;
    setExportErr('');
    try {
      await fn(apiBase, printCtx, payload, activeReportMode);
    } catch (err) {
      setExportErr(err?.message || String(err));
    }
  };

  const openDetailForRow = async (row) => {
    if (!row?.so_no || !isSummaryLike) return;
    setLoading(true);
    setExportErr('');
    setError('');
    try {
      const detailFilters = {
        ...filters,
        so_no: String(row.so_no),
      };
      const data = await fetchSalesOrderPending(apiBase, apiParams, 'detail', detailFilters);
      if (!data?.rows?.length) {
        setExportErr('No detail rows found for this sales order.');
        return;
      }
      setPayload(data);
      setReportView('detail');
      setHighlight(0);
    } catch (err) {
      setExportErr(err.response?.data?.error || err.message || 'Could not load detail.');
    } finally {
      setLoading(false);
    }
  };

  const pickDetailRow = (row) => {
    if (!row || !onSelectRow) return;
    onSelectRow(row);
  };

  const handleReportBack = () => {
    if (isSummaryLike && reportView === 'detail' && summaryPayload) {
      setExportErr('');
      setError('');
      setPayload(summaryPayload);
      setReportView('summary');
      setHighlight(0);
      return;
    }
    setStep('entry');
  };

  const pickAccount = (field, code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const pool = field === 'bk_code' ? brokers : parties;
    const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
    const name = String(row?.NAME ?? row?.name ?? '').trim();
    if (field === 'code') setFilters((f) => ({ ...f, code: c, party_name: name }));
    if (field === 'bk_code') setFilters((f) => ({ ...f, bk_code: c, bk_name: name }));
    setHelpField(null);
  };

  const pickItem = (row) => {
    setFilters((f) => ({
      ...f,
      item_code: String(row?.item_code ?? '').trim(),
      item_name: String(row?.item_name ?? '').trim(),
    }));
    setItemHelpOpen(false);
  };

  const pickGodown = (code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
    const name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
    setFilters((f) => ({ ...f, god_code: c, god_name: name }));
    setGodownHelpOpen(false);
  };

  if (!open || hidden) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-pending-modal${
          isReport ? ' purchase-order-pending-modal--report' : ''
        }`}
      >
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{reportTitle}</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!isReport ? (
          <div className="purchase-order-pending-modal__entry">
            <div className="purchase-order-checklist-modal__filters purchase-order-pending-modal__filters">
              <label className="purchase-order-checklist-modal__field">
                <span>Starting Date</span>
                <VoucherDmyDateInput
                  valueYmd={filters.sdt}
                  onChangeYmd={(v) => setFilters((f) => ({ ...f, sdt: v }))}
                  minYmd={fyMinYmd}
                  maxYmd={fyMaxYmd}
                  inputRef={fromDateRef}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(toDateRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Ending Date</span>
                <VoucherDmyDateInput
                  valueYmd={filters.edt}
                  onChangeYmd={(v) => setFilters((f) => ({ ...f, edt: v }))}
                  minYmd={fyMinYmd}
                  maxYmd={fyMaxYmd}
                  inputRef={toDateRef}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(codeRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Code</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={codeRef}
                    type="text"
                    className="form-input"
                    value={filters.code}
                    onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value.toUpperCase(), party_name: '' }))}
                    onBlur={() => pickAccount('code', filters.code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('code');
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(itemRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setHelpField('code')}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.party_name} readOnly tabIndex={-1} />
                </div>
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Item</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={itemRef}
                    type="text"
                    className="form-input"
                    value={filters.item_code}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, item_code: e.target.value.replace(/\D/g, ''), item_name: '' }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setItemHelpOpen(true);
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(bkRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setItemHelpOpen(true)}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.item_name} readOnly tabIndex={-1} />
                </div>
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Broker</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={bkRef}
                    type="text"
                    className="form-input"
                    value={filters.bk_code}
                    onChange={(e) => setFilters((f) => ({ ...f, bk_code: e.target.value.toUpperCase(), bk_name: '' }))}
                    onBlur={() => pickAccount('bk_code', filters.bk_code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('bk_code');
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(allowSpecificOrderNo ? sonoRef : qIgnoreRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setHelpField('bk_code')}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.bk_name} readOnly tabIndex={-1} />
                </div>
              </label>
              {allowSpecificOrderNo ? (
                <label className="purchase-order-checklist-modal__field">
                  <span>Specific Order No.</span>
                  <input
                    ref={sonoRef}
                    type="text"
                    className="form-input"
                    value={filters.so_no}
                    onChange={(e) => setFilters((f) => ({ ...f, so_no: e.target.value.replace(/\D/g, '') }))}
                    onKeyDown={(e) => e.key === 'Enter' && moveFocus(qIgnoreRef)}
                  />
                </label>
              ) : null}
              <label className="purchase-order-checklist-modal__field">
                <span>Ignore Quantity</span>
                <input
                  ref={qIgnoreRef}
                  type="text"
                  className="form-input"
                  value={filters.qnty_ignore}
                  onChange={(e) => setFilters((f) => ({ ...f, qnty_ignore: e.target.value.replace(/[^\d.]/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(rakeTruckRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>RAKE/TRUCK (R/T)</span>
                <select
                  ref={rakeTruckRef}
                  className="form-input"
                  value={filters.rake_truck}
                  onChange={(e) => setFilters((f) => ({ ...f, rake_truck: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(deRef)}
                >
                  <option value="">All</option>
                  <option value="R">R — Rake</option>
                  <option value="T">T — Truck</option>
                </select>
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>(D)omestic/(E)xport</span>
                <select
                  ref={deRef}
                  className="form-input"
                  value={filters.d_e}
                  onChange={(e) => setFilters((f) => ({ ...f, d_e: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(godRef)}
                >
                  <option value="">All</option>
                  <option value="D">D — Domestic</option>
                  <option value="E">E — Export</option>
                </select>
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>Loading Location</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={godRef}
                    type="text"
                    className="form-input"
                    value={filters.god_code}
                    onChange={(e) => setFilters((f) => ({ ...f, god_code: e.target.value.toUpperCase(), god_name: '' }))}
                    onBlur={() => pickGodown(filters.god_code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setGodownHelpOpen(true);
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(mscRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setGodownHelpOpen(true)}>
                    ?
                  </button>
                </div>
              </label>
              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>(S)ale / (C)hallan</span>
                <select
                  ref={mscRef}
                  className="form-input"
                  value={filters.msc}
                  onChange={(e) => setFilters((f) => ({ ...f, msc: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runProceed();
                    }
                  }}
                >
                  <option value="S">S — Sale (SL/CN)</option>
                  <option value="C">C — Challan (DC/DR)</option>
                </select>
              </label>
            </div>
            <div className="purchase-order-checklist-modal__actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void runProceed()} disabled={loading}>
                {loading ? 'Loading…' : 'Proceed'}
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Quit
              </button>
            </div>
            {error ? <p className="purchase-order-checklist-modal__error">{error}</p> : null}
          </div>
        ) : (
          <>
            <div className="purchase-order-checklist-modal__report-bar">
              <span className="purchase-order-checklist-modal__report-period">
                {loading
                  ? 'Loading…'
                  : `${payload?.rows?.length || 0} row(s) · ${payload?.sorder_q_w === 'Q' ? 'Qty balance' : 'Weight balance'}`}
                {isSummaryView ? ' · Click row for detail' : ''}
                {isDetailView && onSelectRow ? ' · Click row to open document' : ''}
              </span>
              <div className="purchase-order-checklist-modal__report-actions">
                <button type="button" className="btn btn-sm" disabled={!canExport || loading} onClick={() => void runExport(exportSalesOrderPendingPdf)}>
                  PDF
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport || loading}
                  onClick={() => {
                    try {
                      downloadSalesOrderPendingExcel(payload, formData, activeReportMode);
                    } catch (err) {
                      setExportErr(err?.message || String(err));
                    }
                  }}
                >
                  Excel
                </button>
                <button type="button" className="btn btn-sm" disabled={!canExport || loading} onClick={() => void runExport(shareSalesOrderPendingWhatsApp)}>
                  WhatsApp
                </button>
                <button type="button" className="btn btn-sm" disabled={!canExport || loading} onClick={() => void runExport(printSalesOrderPending)}>
                  Print
                </button>
                <button type="button" className="btn btn-sm" disabled={loading} onClick={handleReportBack}>
                  Back
                </button>
                <button type="button" className="btn btn-sm" onClick={onClose}>
                  Quit
                </button>
              </div>
            </div>
            {exportErr ? <p className="purchase-order-checklist-modal__error">{exportErr}</p> : null}
            <div className="purchase-order-print-modal__preview-wrap purchase-order-pending-modal__preview-wrap">
              {isSummaryView && payload?.rows?.length ? (
                <div className="voucher-help-modal__body voucher-help-modal__body--account purchase-order-checklist-modal__body purchase-order-checklist-modal__body--report">
                  <table className="voucher-help-modal__table voucher-help-modal__table--account purchase-order-checklist-modal__table">
                    <thead>
                      <tr>
                        <th>Party</th>
                        <th>Item Name</th>
                        <th>God.</th>
                        <th>So.Date</th>
                        <th>No.</th>
                        <th className="voucher-help-modal__num">Oqty</th>
                        <th className="voucher-help-modal__num">SQty</th>
                        <th className="voucher-help-modal__num">BQty</th>
                        <th className="voucher-help-modal__num">OWgt</th>
                        <th className="voucher-help-modal__num">SWgt</th>
                        <th className="voucher-help-modal__num">BWgt</th>
                        <th className="voucher-help-modal__num">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.rows.map((row, idx) => (
                        <tr
                          key={`${row.so_no}-${row.item_code}-${row.status}-${idx}`}
                          className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}`}
                          tabIndex={0}
                          onMouseEnter={() => setHighlight(idx)}
                          onClick={() => void openDetailForRow(row)}
                          onDoubleClick={() => void openDetailForRow(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void openDetailForRow(row);
                            }
                          }}
                        >
                          <td>{row.name}</td>
                          <td>{row.item_name}</td>
                          <td>{row.god_code}</td>
                          <td>{fmtDate(row.so_date)}</td>
                          <td>{row.so_no}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.oqty, 0)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.rqty, 0)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.bqty, 0)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.owgt, 3)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.rwgt, 3)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.bwgt, 3)}</td>
                          <td className="voucher-help-modal__num">{fmtAmt(row.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="purchase-order-pending-modal__grand">
                        <th colSpan={5}>GRAND TOTAL</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.oqty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.rqty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bqty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.owgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.rwgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bwgt, 3)}</th>
                        <th />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : isDetailView && payload?.rows?.length && isSoDoSale && activeReportMode !== 'detail' ? (
                <div className="voucher-help-modal__body voucher-help-modal__body--account purchase-order-checklist-modal__body purchase-order-checklist-modal__body--report">
                  <table className="voucher-help-modal__table voucher-help-modal__table--account purchase-order-checklist-modal__table">
                    <thead>
                      <tr>
                        <th>Item Name</th>
                        <th>Date</th>
                        <th>No.</th>
                        <th>God.</th>
                        <th>B.No.</th>
                        <th>B/K/H</th>
                        <th className="voucher-help-modal__num">SO Qty</th>
                        <th className="voucher-help-modal__num">DO Qty</th>
                        <th className="voucher-help-modal__num">SL Qty</th>
                        <th className="voucher-help-modal__num">BQty So-Sl</th>
                        <th className="voucher-help-modal__num">BQty So-Do</th>
                        <th className="voucher-help-modal__num">SO Wgt</th>
                        <th className="voucher-help-modal__num">DO Wgt</th>
                        <th className="voucher-help-modal__num">SL Wgt</th>
                        <th className="voucher-help-modal__num">BWgt So-Sl</th>
                        <th className="voucher-help-modal__num">BWgt So-Do</th>
                        <th>Valid Date</th>
                        <th className="voucher-help-modal__num">Rate</th>
                        <th>Broker</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailDisplayItems.map((item, i) => {
                        if (item.kind === 'order-total') {
                          const t = item.totals || {};
                          return (
                            <tr key={`order-total-${item.so_no}-${i}`} className="purchase-order-pending-modal__order-total">
                              <td colSpan={6}>
                                <strong>ORDER TOTAL — {item.so_no}</strong>
                              </td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.so_qty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.do_qty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.sl_qty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bqty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bqty_so_do, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.so_wgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.do_wgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.sl_wgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bwgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bwgt_so_do, 3)}</td>
                              <td />
                              <td colSpan={2} />
                            </tr>
                          );
                        }
                        const row = item.row;
                        const idx = item.idx;
                        return (
                          <tr
                            key={`${row.so_no}-${row.m_type}-${row.bill_no}-${row.item_code}-${idx}`}
                            className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}${onSelectRow ? '' : ' purchase-order-pending-modal__row--static'}`}
                            tabIndex={onSelectRow ? 0 : -1}
                            onMouseEnter={() => setHighlight(idx)}
                            onClick={() => pickDetailRow(row)}
                            onDoubleClick={() => pickDetailRow(row)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && onSelectRow) {
                                e.preventDefault();
                                pickDetailRow(row);
                              }
                            }}
                          >
                            <td>{row.item_name}</td>
                            <td>{fmtDate(row.so_date)}</td>
                            <td>{row.so_no}</td>
                            <td>{row.god_code}</td>
                            <td>{detailBillNo(row)}</td>
                            <td>{row.status}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.so_qty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.do_qty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.sl_qty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bqty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bqty_so_do, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.so_wgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.do_wgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.sl_wgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bwgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bwgt_so_do, 3)}</td>
                            <td>{row.valid_date || ''}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.rate)}</td>
                            <td>{row.bk_name}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="purchase-order-pending-modal__grand">
                        <th colSpan={6}>GRAND TOTAL</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.so_qty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.do_qty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.sl_qty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bqty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bqty_so_do, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.so_wgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.do_wgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.sl_wgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bwgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bwgt_so_do, 3)}</th>
                        <th />
                        <th colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : isDetailView && payload?.rows?.length ? (
                <div className="voucher-help-modal__body voucher-help-modal__body--account purchase-order-checklist-modal__body purchase-order-checklist-modal__body--report">
                  <table className="voucher-help-modal__table voucher-help-modal__table--account purchase-order-checklist-modal__table">
                    <thead>
                      <tr>
                        <th>Item Name</th>
                        <th>Date</th>
                        <th>No.</th>
                        <th>God.</th>
                        <th>B.No.</th>
                        <th>B/K/H</th>
                        <th className="voucher-help-modal__num">OQTY</th>
                        <th className="voucher-help-modal__num">SQTY</th>
                        <th className="voucher-help-modal__num">BQTY</th>
                        <th className="voucher-help-modal__num">OWgt</th>
                        <th className="voucher-help-modal__num">SWgt</th>
                        <th className="voucher-help-modal__num">BWgt</th>
                        <th className="voucher-help-modal__num">Rate</th>
                        <th>Broker</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailDisplayItems.map((item, i) => {
                        if (item.kind === 'order-total') {
                          const t = item.totals || {};
                          return (
                            <tr key={`order-total-${item.so_no}-${i}`} className="purchase-order-pending-modal__order-total">
                              <td colSpan={6}>
                                <strong>ORDER TOTAL — {item.so_no}</strong>
                              </td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.so_qty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.sl_qty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bqty, 0)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.so_wgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.sl_wgt, 3)}</td>
                              <td className="voucher-help-modal__num">{fmtAmt(t.bwgt, 3)}</td>
                              <td colSpan={2} />
                            </tr>
                          );
                        }
                        const row = item.row;
                        const idx = item.idx;
                        return (
                          <tr
                            key={`${row.so_no}-${row.m_type}-${row.bill_no}-${row.item_code}-${idx}`}
                            className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}${onSelectRow ? '' : ' purchase-order-pending-modal__row--static'}`}
                            tabIndex={onSelectRow ? 0 : -1}
                            onMouseEnter={() => setHighlight(idx)}
                            onClick={() => pickDetailRow(row)}
                            onDoubleClick={() => pickDetailRow(row)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && onSelectRow) {
                                e.preventDefault();
                                pickDetailRow(row);
                              }
                            }}
                          >
                            <td>{row.item_name}</td>
                            <td>{fmtDate(row.so_date)}</td>
                            <td>{row.so_no}</td>
                            <td>{row.god_code}</td>
                            <td>{detailBillNo(row)}</td>
                            <td>{row.status}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.so_qty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.sl_qty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bqty, 0)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.so_wgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.sl_wgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.bwgt, 3)}</td>
                            <td className="voucher-help-modal__num">{fmtAmt(row.rate)}</td>
                            <td>{row.bk_name}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="purchase-order-pending-modal__grand">
                        <th colSpan={6}>GRAND TOTAL</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.so_qty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.sl_qty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bqty, 0)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.so_wgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.sl_wgt, 3)}</th>
                        <th className="voucher-help-modal__num">{fmtAmt(payload.grand?.bwgt, 3)}</th>
                        <th colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="voucher-help-modal__msg">No preview available.</p>
              )}
            </div>
            {isSummaryView ? (
              <footer className="voucher-help-modal__foot">
                <span>{payload?.rows?.length || 0} record(s)</span>
                <span>Click a row to open pending detail</span>
              </footer>
            ) : isDetailView && onSelectRow ? (
              <footer className="voucher-help-modal__foot">
                <span>{payload?.rows?.length || 0} record(s)</span>
                <span>Click SO row to open sales order</span>
              </footer>
            ) : null}
          </>
        )}
      </div>

      <VoucherAccountHelpModal
        open={Boolean(helpField)}
        title={helpField === 'bk_code' ? 'Broker help' : 'Party help'}
        accounts={helpAccounts}
        onSelect={(code) => pickAccount(helpField, code)}
        onClose={() => setHelpField(null)}
      />
      <VoucherItemHelpModal open={itemHelpOpen} title="Item help" items={items} onSelect={pickItem} onClose={() => setItemHelpOpen(false)} />
      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Loading location help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownRows}
        onSelect={(row) => pickGodown(row.god_code)}
        onClose={() => setGodownHelpOpen(false)}
      />
    </div>
  );
}
