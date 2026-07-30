import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';
import ReportToolbarActions from '../components/ReportToolbarActions';
import ReportHelpButton from '../components/ReportHelpButton';
import FasReportHeader from '../components/FasReportHeader';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import {
  filterCodeNameCityRows,
  filterItemCodeNameRows,
  SEARCH_NO_MATCH,
} from '../utils/masterSearchFilter';
import '../styles/saleListScreen.css';

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = q.trim();
  if (!query) return s;
  const lower = s.toLowerCase();
  const qi = lower.indexOf(query.toLowerCase());
  if (qi === -1) return s;
  return (
    <>
      {s.slice(0, qi)}
      <mark className="search-highlight">{s.slice(qi, qi + query.length)}</mark>
      {s.slice(qi + query.length)}
    </>
  );
}

const PL_FIELD_FOCUS_ORDER = ['pl-start', 'pl-end', 'pl-sup-search', 'pl-pur-search', 'pl-item-search', 'pl-god'];
const PL_FIELD_FOCUS_ORDER_EV = [
  'pl-start',
  'pl-end',
  'pl-sup-search',
  'pl-pur-search',
  'pl-god',
  'pl-cost',
  'pl-lc',
  'pl-input',
  'pl-ru',
];

function focusNextPlField(currentId, order = PL_FIELD_FOCUS_ORDER) {
  const idx = order.indexOf(currentId);
  if (idx === -1 || idx >= order.length - 1) return;
  document.getElementById(order[idx + 1])?.focus();
}

function PurchaseListFormShell({ className = '', header, footer = null, children }) {
  return (
    <div className={`slide slide-11 sale-list-screen purchase-list-screen fas-tb-host${className ? ` ${className}` : ''}`}>
      <div className="fas-flow fas-tb-flow fas-tb-flow--form-app">
        <div className="fas-ledger-sticky-top">{header}</div>
        <div className="fas-flow-body fas-tb-body fas-tb-body--form-scroll">{children}</div>
        {footer ? <div className="fas-tb-form-footer-bar">{footer}</div> : null}
      </div>
    </div>
  );
}

function useDesktopView() {
  const [isDesktopView, setIsDesktopView] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 769px)').matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = () => setIsDesktopView(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktopView;
}

function n(row, upper, lower) {
  const v = row?.[upper] ?? row?.[lower];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function isDn(row) {
  return String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase() === 'DN';
}

function signedDnVal(row, upper, lower) {
  const v = n(row, upper, lower);
  return isDn(row) ? -Math.abs(v) : v;
}

function fmtQty(v) {
  const x = parseFloat(v);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtAmt(v) {
  const x = parseFloat(v) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function t(row, upper, lower) {
  return String(row?.[upper] ?? row?.[lower] ?? '').trim();
}

function cmpTxt(a, b) {
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
}

export default function Slide11({ apiBase, formData, onPrev, onReset, billType = '' }) {
  const listBillType = String(billType || formData?.purchaseListType || '')
    .trim()
    .toUpperCase();
  const isBardanaList = listBillType === 'PB';
  const isDebitNoteList = listBillType === 'DN';
  const isExpVoucherList = listBillType === 'EV';
  const isDcNoteList = listBillType === 'DX' || listBillType === 'CX';
  const listTitle = isBardanaList
    ? 'Bardana Purchase Checklist'
    : isDebitNoteList
      ? 'Debit Note Checklist'
      : isExpVoucherList
        ? 'Expenses Voucher List'
        : listBillType === 'DX'
          ? 'Debit Note List'
          : listBillType === 'CX'
            ? 'Credit Note List'
            : 'Purchase List';
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [godCode, setGodCode] = useState('');
  const [costCode, setCostCode] = useState('');
  const [lcFilter, setLcFilter] = useState('');
  const [inputYnFilter, setInputYnFilter] = useState(isExpVoucherList ? 'C' : '');
  const [ruFilter, setRuFilter] = useState('');

  const [supplierSearch, setSupplierSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [purSearch, setPurSearch] = useState('');
  const [supplierHi, setSupplierHi] = useState(0);
  const [itemHi, setItemHi] = useState(0);
  const [purHi, setPurHi] = useState(0);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedItem, setSelectedItem] = useState('');
  const [selectedPurCode, setSelectedPurCode] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [purCodes, setPurCodes] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [costCentres, setCostCentres] = useState([]);
  const [lookupError, setLookupError] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [purchaseSortMode, setPurchaseSortMode] = useState('date');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const isDesktopView = useDesktopView();

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    setLookupError('');
    (async () => {
      try {
        const reqs = [
          axios.get(`${apiBase}/api/purchaselist-suppliers`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-items`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-purcodes`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-godowns`, { params: { comp_code: compCode, comp_uid: compUid } }),
        ];
        if (isExpVoucherList) {
          reqs.push(
            axios.get(`${apiBase}/api/voucher-entry/cost-help`, {
              params: { comp_code: compCode, comp_uid: compUid },
            })
          );
        }
        const results = await Promise.all(reqs);
        setSuppliers(Array.isArray(results[0].data) ? results[0].data : []);
        setItems(Array.isArray(results[1].data) ? results[1].data : []);
        setPurCodes(Array.isArray(results[2].data) ? results[2].data : []);
        setGodowns(Array.isArray(results[3].data) ? results[3].data : []);
        if (isExpVoucherList) {
          const costData = results[4]?.data;
          setCostCentres(Array.isArray(costData?.rows) ? costData.rows : Array.isArray(costData) ? costData : []);
        } else {
          setCostCentres([]);
        }
      } catch (err) {
        setLookupError(
          err.response?.status === 404
            ? `No /api/purchaselist-* routes on ${formatApiOrigin(apiBase)}. Restart API with latest server.cjs.`
            : err.response?.data?.error || err.message || 'Failed to load search help'
        );
      }
    })();
  }, [apiBase, compCode, compUid, isExpVoucherList]);

  useEffect(() => {
    if (isExpVoucherList && !inputYnFilter) setInputYnFilter('C');
  }, [isExpVoucherList, inputYnFilter]);

  const filteredSuppliers = useMemo(
    () => filterCodeNameCityRows(suppliers, supplierSearch, 50),
    [suppliers, supplierSearch]
  );
  const filteredPurCodes = useMemo(
    () => filterCodeNameCityRows(purCodes, purSearch, 50),
    [purCodes, purSearch]
  );
  const filteredItems = useMemo(
    () => filterItemCodeNameRows(items, itemSearch, 50),
    [items, itemSearch]
  );

  useEffect(() => setSupplierHi(0), [supplierSearch]);
  useEffect(() => setPurHi(0), [purSearch]);
  useEffect(() => setItemHi(0), [itemSearch]);

  const safeSupplierHi = Math.min(supplierHi, Math.max(0, filteredSuppliers.length - 1));
  const safePurHi = Math.min(purHi, Math.max(0, filteredPurCodes.length - 1));
  const safeItemHi = Math.min(itemHi, Math.max(0, filteredItems.length - 1));

  const selectedSupplierRow = suppliers.find((s) => String(s.CODE ?? s.code) === String(selectedSupplier));
  const selectedPurRow = purCodes.find((p) => String(p.CODE ?? p.code) === String(selectedPurCode));
  const selectedItemRow = items.find((r) => String(r.ITEM_CODE ?? r.item_code) === String(selectedItem));

  const sortedRows = useMemo(() => {
    const out = [...rows];
    const compareDateTail = (a, b) => {
      const dCmp = cmpTxt(toInputDateString(a.R_DATE ?? a.r_date), toInputDateString(b.R_DATE ?? b.r_date));
      if (dCmp !== 0) return dCmp;
      const rCmp = cmpTxt(t(a, 'R_NO', 'r_no'), t(b, 'R_NO', 'r_no'));
      if (rCmp !== 0) return rCmp;
      return (parseFloat(a.TRN_NO ?? a.trn_no) || 0) - (parseFloat(b.TRN_NO ?? b.trn_no) || 0);
    };
    out.sort((a, b) => {
      if (purchaseSortMode === 'party') {
        const nCmp = cmpTxt(t(a, 'NAME', 'name'), t(b, 'NAME', 'name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'CODE', 'code'), t(b, 'CODE', 'code'));
        if (cCmp !== 0) return cCmp;
      } else if (purchaseSortMode === 'item') {
        const nCmp = cmpTxt(t(a, 'ITEM_NAME', 'item_name'), t(b, 'ITEM_NAME', 'item_name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'ITEM_CODE', 'item_code'), t(b, 'ITEM_CODE', 'item_code'));
        if (cCmp !== 0) return cCmp;
      } else if (purchaseSortMode === 'broker') {
        const nCmp = cmpTxt(t(a, 'PUR_NAME', 'pur_name'), t(b, 'PUR_NAME', 'pur_name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'PUR_CODE', 'pur_code'), t(b, 'PUR_CODE', 'pur_code'));
        if (cCmp !== 0) return cCmp;
      }
      return compareDateTail(a, b);
    });
    return out;
  }, [rows, purchaseSortMode]);

  const totals = useMemo(() => {
    let q = 0;
    let w = 0;
    let a = 0;
    let tx = 0;
    let c = 0;
    let s = 0;
    let i = 0;
    let b = 0;
    let f = 0;
    let oth = 0;
    let tcs = 0;
    let ntds = 0;
    for (const r of sortedRows) {
      q += signedDnVal(r, 'QNTY', 'qnty');
      w += signedDnVal(r, 'WEIGHT', 'weight');
      a += signedDnVal(r, 'AMOUNT', 'amount');
      tx += signedDnVal(r, 'TAXABLE', 'taxable');
      c += signedDnVal(r, 'CGST_AMT', 'cgst_amt');
      s += signedDnVal(r, 'SGST_AMT', 'sgst_amt');
      i += signedDnVal(r, 'IGST_AMT', 'igst_amt');
      b += signedDnVal(r, 'BILL_AMT', 'bill_amt');
      f += n(r, 'FREIGHT', 'freight');
      oth += n(r, 'OTH_EXP_1', 'oth_exp_1');
      tcs += n(r, 'TCS_AMT', 'tcs_amt');
      ntds += n(r, 'NTDS_AMT', 'ntds_amt');
    }
    return { q, w, a, tx, c, s, i, b, f, oth, tcs, ntds };
  }, [sortedRows]);

  const pdfData = useMemo(() => ({ rows: sortedRows }), [sortedRows]);
  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(startDate),
      endDate: toDisplayDate(endDate),
      supplierLabel: selectedSupplier || 'All',
      itemLabel: selectedItem || 'All',
      purLabel: selectedPurCode || 'All',
      godLabel: godCode || 'All',
      costLabel: costCode || 'All',
      listKind: isExpVoucherList ? 'EV' : listBillType || 'PU',
      listTitle,
    }),
    [
      compName,
      startDate,
      endDate,
      selectedSupplier,
      selectedItem,
      selectedPurCode,
      godCode,
      costCode,
      isExpVoucherList,
      listBillType,
      listTitle,
    ]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const sDate = toOracleDate(startDate);
    const eDate = toOracleDate(endDate);
    if (!sDate || !eDate) {
      alert('Please choose start and end date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = isExpVoucherList
        ? `${apiBase}/api/exp-voucher/checklist`
        : isDcNoteList
          ? `${apiBase}/api/dc-note/checklist`
          : `${apiBase}/api/purchase-list`;
      const params = isExpVoucherList
        ? {
            comp_code: compCode,
            comp_uid: compUid,
            s_date: sDate,
            e_date: eDate,
            code: selectedSupplier,
            pur_code: selectedPurCode,
            god_code: godCode,
            cost_code: costCode,
            l_c: lcFilter,
            input_yn: inputYnFilter === 'C' ? '' : inputYnFilter,
            ru: ruFilter,
          }
        : isDcNoteList
          ? {
              comp_code: compCode,
              comp_uid: compUid,
              type: listBillType,
              s_date: sDate,
              e_date: eDate,
              code: selectedSupplier,
              item_code: selectedItem,
            }
          : {
            comp_code: compCode,
            comp_uid: compUid,
            s_date: sDate,
            e_date: eDate,
            code: selectedSupplier,
            item_code: selectedItem,
            pur_code: selectedPurCode,
            god_code: godCode,
            ...(listBillType ? { type: listBillType } : {}),
          };
      const { data } = await axios.get(url, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setPurchaseSortMode('date');
      setShowReport(true);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          (isExpVoucherList
            ? 'Failed to load expenses voucher list'
            : isDcNoteList
              ? 'Failed to load debit/credit note list'
              : 'Failed to load purchase list')
      );
    } finally {
      setLoading(false);
    }
  };

  const plFocusOrder = isExpVoucherList ? PL_FIELD_FOCUS_ORDER_EV : PL_FIELD_FOCUS_ORDER;

  const handleFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (
      target.id === 'pl-sup-search' ||
      target.id === 'pl-pur-search' ||
      target.id === 'pl-item-search'
    ) {
      return;
    }
    e.preventDefault();
    const lastId = plFocusOrder[plFocusOrder.length - 1];
    if (target.id === lastId) {
      e.currentTarget.requestSubmit();
      return;
    }
    focusNextPlField(target.id, plFocusOrder);
  };

  const downloadPdf = () =>
    generatePDF('purchase-list', pdfData, pdfMeta).catch((err) => alert(String(err?.message || err)));
  const shareWa = () =>
    sharePdfWithWhatsApp(
      'purchase-list',
      pdfData,
      pdfMeta,
      [listTitle, compName, `${pdfMeta.startDate} - ${pdfMeta.endDate}`].join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const openPurchaseBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const rNo = row.R_NO ?? row.r_no;
    const rDt = row.R_DATE ?? row.r_date;
    const ymd = toInputDateString(rDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || rNo == null || rNo === '' || !oracleDt) {
      alert('Cannot open bill: missing type, R no, or R date.');
      return;
    }
    setBillPrintParams({
      type: String(typ).trim(),
      rNo: String(rNo).trim(),
      oracleDt,
      label: `Purchase — ${String(typ).trim()} / ${String(rNo).trim()} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  if (showReport) {
    const purchaseSortLabel =
      purchaseSortMode === 'party'
        ? 'Party-wise'
        : purchaseSortMode === 'item'
          ? 'Item-wise'
          : purchaseSortMode === 'broker'
            ? 'Broker/Purchase code-wise'
            : 'Date-wise';
    return (
      <div className="slide slide-report slide-11">
        <PurchaseBillPrintModal
          open={billPrintOpen}
          onClose={() => {
            setBillPrintOpen(false);
            setBillPrintParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={billPrintParams}
          companyName={compName}
        />
        <div className="report-toolbar">
          <h2>{listTitle}</h2>
          <ReportToolbarActions
            reportId="purchase-list"
            helpProps={{ includeSalesEntry: false, includeStockLot: true, appName: 'GFASORCL Accounting' }}
            onBack={() => setShowReport(false)}
            onPdf={downloadPdf}
            onExcel={() => {
              try {
                const sheet = isExpVoucherList ? 'ExpensesVoucherList' : 'PurchaseList';
                downloadExcelRows(sortedRows, sheet, `${compName}_${sheet}`);
              } catch (e) {
                alert(String(e?.message || e));
              }
            }}
            onWhatsApp={shareWa}
          />
        </div>

        <div className="report-sort-switch" role="group" aria-label="Purchase list sort">
          <span className="report-sort-switch__label">Sort:</span>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'date' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('date')}
          >
            Date
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'party' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('party')}
          >
            Party
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'item' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('item')}
          >
            Item
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'broker' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('broker')}
          >
            Broker/Pur
          </button>
        </div>

        <div className="report-info">
          <p>
            <strong>Dates</strong> {toDisplayDate(startDate)} - {toDisplayDate(endDate)} · <strong>Supplier</strong>{' '}
            {selectedSupplier || 'All'} ·{' '}
            {isExpVoucherList ? (
              <>
                <strong>Purchase code</strong> {selectedPurCode || 'All'} · <strong>Godown</strong> {godCode || 'All'} ·{' '}
                <strong>Cost</strong> {costCode || 'All'} · <strong>L/C</strong> {lcFilter || 'All'} ·{' '}
                <strong>Input</strong> {inputYnFilter || 'C'} · <strong>R/U</strong> {ruFilter || 'All'}
              </>
            ) : (
              <>
                <strong>Item</strong> {selectedItem || 'All'} · <strong>Purchase code</strong>{' '}
                {selectedPurCode || 'All'} · <strong>Godown</strong> {godCode || 'All'}
              </>
            )}
          </p>
          <p>
            {compName} | FY {compYear}
            {isExpVoucherList
              ? ' — Expenses voucher (TYPE EV). Click a row to open the voucher print.'
              : ' — TYPE DN rows show qty/weight/amount/tax columns in negative. Click any data row to open the purchase bill / debit note print.'}{' '}
            Current view: <strong>{purchaseSortLabel}</strong>.
          </p>
        </div>

        <div className="report-display table-responsive">
          {isExpVoucherList ? (
            <table className="report-table purchase-list-table exp-voucher-list-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>No.</th>
                  <th>Bill No</th>
                  <th>Name/GST No.</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Freight</th>
                  <th className="text-right">Cg%</th>
                  <th className="text-right">Sg%</th>
                  <th className="text-right">Ig%</th>
                  <th className="text-right">Cgst</th>
                  <th className="text-right">Sgst</th>
                  <th className="text-right">Igst</th>
                  <th className="text-right">Others</th>
                  <th className="text-right">Tcs/Tds</th>
                  <th className="text-right">Net Amt.</th>
                </tr>
                <tr>
                  <th colSpan={3}>Item Name/Hsn Code</th>
                  <th colSpan={14} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <React.Fragment key={`${r.r_no ?? r.R_NO}-${r.trn_no ?? r.TRN_NO}-${i}`}>
                    <tr
                      className="purchase-list-row-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => openPurchaseBill({ ...r, TYPE: 'EV', type: 'EV' })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openPurchaseBill({ ...r, TYPE: 'EV', type: 'EV' });
                        }
                      }}
                    >
                      <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.r_date ?? r.R_DATE)}</td>
                      <td>{r.r_no ?? r.R_NO ?? '—'}</td>
                      <td>{r.bill_no ?? r.BILL_NO ?? '—'}</td>
                      <td className="ledger-detail">{r.name ?? r.NAME ?? '—'}</td>
                      <td className="text-right">{fmtAmt(n(r, 'WEIGHT', 'weight'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'RATE', 'rate'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'AMOUNT', 'amount'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'FREIGHT', 'freight'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'CGST_PER', 'cgst_per'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'SGST_PER', 'sgst_per'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'IGST_PER', 'igst_per'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'CGST_AMT', 'cgst_amt'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'SGST_AMT', 'sgst_amt'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'IGST_AMT', 'igst_amt'))}</td>
                      <td className="text-right">{fmtAmt(n(r, 'OTH_EXP_1', 'oth_exp_1'))}</td>
                      <td className="text-right">
                        <div>{fmtAmt(n(r, 'TCS_AMT', 'tcs_amt'))}</div>
                        <div>{fmtAmt(n(r, 'NTDS_AMT', 'ntds_amt'))}</div>
                      </td>
                      <td className="text-right">{fmtAmt(n(r, 'BILL_AMT', 'bill_amt'))}</td>
                    </tr>
                    <tr className="exp-voucher-list-subrow">
                      <td colSpan={3} className="ledger-detail">
                        {t(r, 'ITEM_NAME', 'item_name') || '—'}
                        {t(r, 'HSN_CODE', 'hsn_code') ? ` / ${t(r, 'HSN_CODE', 'hsn_code')}` : ''}
                      </td>
                      <td className="ledger-detail" colSpan={14}>
                        {t(r, 'GST_NO', 'gst_no') || '—'}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                <tr className="stock-sum-grand">
                  <td colSpan={4}>
                    <strong>Grand total</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.w)}</strong>
                  </td>
                  <td className="text-right">—</td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.a)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.f)}</strong>
                  </td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.c)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.s)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.i)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.oth)}</strong>
                  </td>
                  <td className="text-right">
                    <div>
                      <strong>{fmtAmt(totals.tcs)}</strong>
                    </div>
                    <div>
                      <strong>{fmtAmt(totals.ntds)}</strong>
                    </div>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.b)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="report-table purchase-list-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>R date</th>
                  <th>R no</th>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>Supplier</th>
                  <th>Name</th>
                  <th>Trn</th>
                  <th>Pur code</th>
                  <th>Pur name</th>
                  <th>Item</th>
                  <th>Item name</th>
                  <th>God</th>
                  <th>Lot</th>
                  <th>B no</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                  <th className="text-right">Freight</th>
                  <th className="text-right">Labour</th>
                  <th className="text-right">Bill amt</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr
                    key={`${r.R_NO ?? r.r_no}-${r.TRN_NO ?? r.trn_no}-${i}`}
                    className="purchase-list-row-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openPurchaseBill(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openPurchaseBill(r);
                      }
                    }}
                  >
                    <td>{r.TYPE ?? r.type ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.R_DATE ?? r.r_date)}</td>
                    <td>{r.R_NO ?? r.r_no ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date)}</td>
                    <td>{r.BILL_NO ?? r.bill_no ?? '—'}</td>
                    <td>{r.CODE ?? r.code ?? '—'}</td>
                    <td className="ledger-detail">{r.NAME ?? r.name ?? '—'}</td>
                    <td>{r.TRN_NO ?? r.trn_no ?? '—'}</td>
                    <td>{r.PUR_CODE ?? r.pur_code ?? '—'}</td>
                    <td className="ledger-detail">{r.PUR_NAME ?? r.pur_name ?? '—'}</td>
                    <td>{r.ITEM_CODE ?? r.item_code ?? '—'}</td>
                    <td className="ledger-detail">{r.ITEM_NAME ?? r.item_name ?? '—'}</td>
                    <td>{r.GOD_CODE ?? r.god_code ?? '—'}</td>
                    <td>{r.LOT ?? r.lot ?? '—'}</td>
                    <td>{r.B_NO ?? r.b_no ?? '—'}</td>
                    <td className="text-right">{fmtQty(signedDnVal(r, 'QNTY', 'qnty'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'WEIGHT', 'weight'))}</td>
                    <td className="text-right">{fmtAmt(n(r, 'RATE', 'rate'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'AMOUNT', 'amount'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'TAXABLE', 'taxable'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'CGST_AMT', 'cgst_amt'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'SGST_AMT', 'sgst_amt'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'IGST_AMT', 'igst_amt'))}</td>
                    <td className="text-right">{fmtAmt(n(r, 'FREIGHT', 'freight'))}</td>
                    <td className="text-right">{fmtAmt(n(r, 'LABOUR', 'labour'))}</td>
                    <td className="text-right">{fmtAmt(signedDnVal(r, 'BILL_AMT', 'bill_amt'))}</td>
                  </tr>
                ))}
                <tr className="stock-sum-grand">
                  <td colSpan={15}>
                    <strong>Grand total</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(totals.q)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.w)}</strong>
                  </td>
                  <td className="text-right">—</td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.a)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.tx)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.c)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.s)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.i)}</strong>
                  </td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.b)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {sortedRows.length === 0 ? <p className="stock-sum-empty">No rows returned.</p> : null}
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <PurchaseListFormShell
      className="fas-tb-host--form"
      footer={
        isDesktopView ? (
          <button
            type="button"
            className="fas-btn fas-btn-primary fas-tb-run-bottom"
            disabled={loading}
            onClick={() => {
              const form = document.getElementById('pl-params-form');
              form?.requestSubmit?.();
            }}
          >
            {loading ? 'Loading…' : isExpVoucherList ? 'Proceed' : '▶ Run'}
          </button>
        ) : null
      }
      header={
        <FasReportHeader
          title={listTitle}
          onBack={onPrev}
          rightSlot={
            isDesktopView ? (
              <ReportHelpButton
                reportId="purchase-list"
                includeSalesEntry={false}
                includeStockLot={true}
                appName="GFASORCL Accounting"
              />
            ) : (
              <button
                type="button"
                className="fas-report-header__run"
                disabled={loading}
                onClick={() => {
                  const form = document.getElementById('pl-params-form');
                  form?.requestSubmit?.();
                }}
              >
                {loading ? 'Loading…' : isExpVoucherList ? 'Proceed' : '▶ Run'}
              </button>
            )
          }
        />
      }
    >
      <form id="pl-params-form" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="fas-tb-form-shell fas-slb-form-shell">
        <TrialBalanceSessionCard compact formData={formData} helpReportId="purchase-list" />

        {lookupError ? (
          <div className="form-api-error fas-slb-form__lookup-error" role="alert">
            <strong>Lookups:</strong> {lookupError}
          </div>
        ) : null}
        {error ? (
          <div className="form-api-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="fas-info-tip">
          {isExpVoucherList ? (
            <>
              VFP <strong>EXPENSES VOUCHER LIST</strong> (TYPE <strong>EV</strong>). Filters: party, purchase code, godown,
              cost, L/C, Input Y/N/C (C = all), Regd/Unregd.
            </>
          ) : isDcNoteList ? (
            <>
              VFP <strong>DCNOTE</strong> checklist (TYPE <strong>{listBillType}</strong>). Filters: party, item.
            </>
          ) : (
            <>
              PURCHASE lines for <strong>PU/DN</strong>. For <strong>DN</strong>, qty/weight/amount/tax columns are shown in
              negative.
            </>
          )}
        </div>

        <div className="fas-slb-form__grid">
          <div className="fas-field-group">
            <div className="fas-field-label">{isExpVoucherList ? 'Starting Date' : 'From date'}</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="pl-start"
                type="date"
                lang="en-GB"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">{isExpVoucherList ? 'Ending Date' : 'To date'}</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="pl-end"
                type="date"
                lang="en-GB"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="fas-field-group fas-slb-form__search">
            <div className="fas-field-label">{isExpVoucherList ? 'Specific Code' : 'Supplier (CODE)'}</div>
            <div className="fas-field-input">
              <input
                id="pl-sup-search"
                type="search"
                autoComplete="off"
                placeholder="Code, name, city…"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (selectedSupplier) return;
                  const max = Math.max(0, filteredSuppliers.length - 1);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredSuppliers.length === 0) return;
                    setSupplierHi((h) => Math.min(max, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSupplierHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const r = filteredSuppliers[safeSupplierHi];
                    if (r) {
                      setSelectedSupplier(String(r.CODE ?? r.code ?? '').trim());
                      setSupplierSearch('');
                    }
                    focusNextPlField('pl-sup-search', plFocusOrder);
                  }
                }}
              />
            </div>
            {selectedSupplier ? (
              <p className="account-selected-hint">
                <strong>{selectedSupplierRow?.NAME ?? selectedSupplierRow?.name ?? '—'}</strong> (
                <code>{selectedSupplier}</code>)
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setSelectedSupplier('');
                    setSupplierSearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : supplierSearch.trim() ? (
              <div className="account-search-results party-search-results" role="listbox">
                {filteredSuppliers.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredSuppliers.map((row, index) => {
                    const c = row.CODE ?? row.code;
                    const rowHi = safeSupplierHi === index;
                    return (
                      <button
                        key={String(c)}
                        type="button"
                        role="option"
                        className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setSupplierHi(index)}
                        onClick={() => {
                          setSelectedSupplier(String(c).trim());
                          setSupplierSearch('');
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(c, supplierSearch)}</span>
                        <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, supplierSearch)}</span>
                        <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div className="fas-field-group fas-slb-form__search">
            <div className="fas-field-label">
              {isExpVoucherList ? 'Specific Purchase Code' : 'Purchase code (PUR_CODE)'}
            </div>
            <div className="fas-field-input">
              <input
                id="pl-pur-search"
                type="search"
                autoComplete="off"
                placeholder="Code, name, city…"
                value={purSearch}
                onChange={(e) => setPurSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (selectedPurCode) return;
                  const max = Math.max(0, filteredPurCodes.length - 1);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredPurCodes.length === 0) return;
                    setPurHi((h) => Math.min(max, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPurHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const r = filteredPurCodes[safePurHi];
                    if (r) {
                      setSelectedPurCode(String(r.CODE ?? r.code ?? '').trim());
                      setPurSearch('');
                    }
                    focusNextPlField('pl-pur-search', plFocusOrder);
                  }
                }}
              />
            </div>
            {selectedPurCode ? (
              <p className="account-selected-hint">
                <strong>{selectedPurRow?.NAME ?? selectedPurRow?.name ?? '—'}</strong> (<code>{selectedPurCode}</code>)
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setSelectedPurCode('');
                    setPurSearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : purSearch.trim() ? (
              <div className="account-search-results party-search-results" role="listbox">
                {filteredPurCodes.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredPurCodes.map((row, index) => {
                    const c = row.CODE ?? row.code;
                    const rowHi = safePurHi === index;
                    return (
                      <button
                        key={String(c)}
                        type="button"
                        role="option"
                        className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setPurHi(index)}
                        onClick={() => {
                          setSelectedPurCode(String(c).trim());
                          setPurSearch('');
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(c, purSearch)}</span>
                        <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, purSearch)}</span>
                        <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          {!isExpVoucherList ? (
          <div className="fas-field-group fas-slb-form__span-full fas-slb-form__search">
            <div className="fas-field-label">Item (ITEM_CODE)</div>
            <div className="fas-field-input">
              <input
                id="pl-item-search"
                type="search"
                autoComplete="off"
                placeholder="Item code or name…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (selectedItem) return;
                  const max = Math.max(0, filteredItems.length - 1);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredItems.length === 0) return;
                    setItemHi((h) => Math.min(max, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setItemHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const r = filteredItems[safeItemHi];
                    if (r) {
                      setSelectedItem(String(r.ITEM_CODE ?? r.item_code ?? '').trim());
                      setItemSearch('');
                    }
                    focusNextPlField('pl-item-search', plFocusOrder);
                  }
                }}
              />
            </div>
            {selectedItem ? (
              <p className="account-selected-hint">
                <strong>{selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? '—'}</strong> (
                <code>{selectedItem}</code>)
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setSelectedItem('');
                    setItemSearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : itemSearch.trim() ? (
              <div className="account-search-results broker-search-results" role="listbox">
                {filteredItems.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredItems.map((row, index) => {
                    const c = row.ITEM_CODE ?? row.item_code;
                    const rowHi = safeItemHi === index;
                    return (
                      <button
                        key={String(c)}
                        type="button"
                        role="option"
                        className={`account-search-row broker-search-row${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setItemHi(index)}
                        onClick={() => {
                          setSelectedItem(String(c).trim());
                          setItemSearch('');
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(c, itemSearch)}</span>
                        <span className="account-search-name">
                          {highlightMatch(row.ITEM_NAME ?? row.item_name, itemSearch)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
          ) : null}

          <div className="fas-field-group fas-slb-form__span-full">
            <div className="fas-field-label">{isExpVoucherList ? 'Godown' : 'Godown (optional)'}</div>
            <div className="fas-field-input">
              <input
                id="pl-god"
                list="pl-god-list"
                autoComplete="off"
                placeholder="Blank = all godowns"
                value={godCode}
                onChange={(e) => setGodCode(e.target.value.toUpperCase())}
              />
              <datalist id="pl-god-list">
                {godowns.map((g) => (
                  <option key={String(g.GOD_CODE ?? g.god_code)} value={String(g.GOD_CODE ?? g.god_code)}>
                    {String(g.GOD_NAME ?? g.god_name ?? '')}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          {isExpVoucherList ? (
            <>
              <div className="fas-field-group">
                <div className="fas-field-label">Cost Code</div>
                <div className="fas-field-input">
                  <input
                    id="pl-cost"
                    list="pl-cost-list"
                    autoComplete="off"
                    placeholder="Blank = all"
                    value={costCode}
                    onChange={(e) => setCostCode(e.target.value.toUpperCase())}
                  />
                  <datalist id="pl-cost-list">
                    {costCentres.map((c, i) => {
                      const code = String(c.CODE ?? c.code ?? c.COST_CODE ?? c.cost_code ?? '').trim();
                      if (!code) return null;
                      return (
                        <option key={`${code}-${i}`} value={code}>
                          {String(c.NAME ?? c.name ?? c.COST_NAME ?? c.cost_name ?? '')}
                        </option>
                      );
                    })}
                  </datalist>
                </div>
              </div>
              <div className="fas-field-group">
                <div className="fas-field-label">(L)ocal / (C)entral</div>
                <div className="fas-field-input">
                  <input
                    id="pl-lc"
                    autoComplete="off"
                    maxLength={1}
                    placeholder="Blank = all"
                    value={lcFilter}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^LC]/g, '').slice(0, 1);
                      setLcFilter(v);
                    }}
                  />
                </div>
              </div>
              <div className="fas-field-group">
                <div className="fas-field-label">Input (Y/N/C)</div>
                <div className="fas-field-input">
                  <input
                    id="pl-input"
                    autoComplete="off"
                    maxLength={1}
                    placeholder="C = all"
                    value={inputYnFilter}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^YNC]/g, '').slice(0, 1);
                      setInputYnFilter(v || 'C');
                    }}
                  />
                </div>
              </div>
              <div className="fas-field-group">
                <div className="fas-field-label">(R)egd / (U)nRegd</div>
                <div className="fas-field-input">
                  <input
                    id="pl-ru"
                    autoComplete="off"
                    maxLength={1}
                    placeholder="Blank = all"
                    value={ruFilter}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^RU]/g, '').slice(0, 1);
                      setRuFilter(v);
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {!isDesktopView ? (
          <div className="fas-tb-form-footer">
            <button type="submit" className="fas-btn fas-btn-primary fas-tb-run-bottom" disabled={loading}>
              {loading ? 'Loading…' : isExpVoucherList ? 'Proceed' : '▶ Run'}
            </button>
          </div>
        ) : null}
      </form>
    </PurchaseListFormShell>
  );
}
