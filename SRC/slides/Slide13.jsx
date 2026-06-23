import React, { useEffect, useMemo, useState, useRef } from 'react';
import axios from 'axios';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import SessionInfoLine, { SessionLineText } from '../components/SessionInfoLine';
import FasReportHeader from '../components/FasReportHeader';
import ReportHelpButton from '../components/ReportHelpButton';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import { filterCodeNameCityRows, SEARCH_NO_MATCH } from '../utils/masterSearchFilter';
import {
  fetchSaleBillBulkPayloads,
  bulkPrintSelectedSaleBills,
  bulkPdfSelectedSaleBills,
  bulkWhatsAppSelectedSaleBills,
} from '../utils/saleBillBulkActions';

/** Sale bill printing — customers only (VFP: SUBSTR(CODE,1,1) = 'C'). */
function isCustomerPartyCode(row) {
  const code = String(row?.CODE ?? row?.code ?? '').trim();
  return code.length > 0 && code.charAt(0).toUpperCase() === 'C';
}

function saleBillRowKey(row, idx) {
  const typ = row.TYPE ?? row.type ?? '';
  const billNo = row.BILL_NO ?? row.bill_no ?? '';
  const bType = row.B_TYPE ?? row.b_type ?? '';
  const dt = toInputDateString(row.BILL_DATE ?? row.bill_date) ?? '';
  const key = `${typ}|${billNo}|${bType}|${dt}`;
  return key || `row-${idx}`;
}

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

const SBP_FIELD_FOCUS_ORDER = [
  'sbp-type',
  'sbp-b-type',
  'sbp-bill-no-start',
  'sbp-bill-no-end',
  'sbp-bill-date-start',
  'sbp-bill-date-end',
  'sbp-print-gross-dane',
  'sbp-print-packing',
  'sbp-party-search',
];

function focusNextSbpField(currentId) {
  const idx = SBP_FIELD_FOCUS_ORDER.indexOf(currentId);
  if (idx === -1 || idx >= SBP_FIELD_FOCUS_ORDER.length - 1) return;
  document.getElementById(SBP_FIELD_FOCUS_ORDER[idx + 1])?.focus();
}

function SaleBillPrintFormShell({ className = '', header, footer = null, children }) {
  return (
    <div className={`slide slide-13 fas-tb-host${className ? ` ${className}` : ''}`}>
      <div className="fas-flow fas-tb-flow fas-tb-flow--form-app">
        <div className="fas-ledger-sticky-top">{header}</div>
        <div className="fas-flow-body fas-tb-body fas-tb-body--form-scroll">{children}</div>
        {footer ? <div className="fas-tb-form-footer-bar">{footer}</div> : null}
      </div>
    </div>
  );
}

export default function Slide13({ apiBase, formData, onPrev, onReset, viewMode = 'desktop' }) {
  const [type, setType] = useState('SL');
  const [billNoStart, setBillNoStart] = useState('');
  const [billNoEnd, setBillNoEnd] = useState('');
  const [bType, setBType] = useState('');
  const [billDateStart, setBillDateStart] = useState('');
  const [billDateEnd, setBillDateEnd] = useState('');
  const [printGrossDane, setPrintGrossDane] = useState('N');
  const [printPacking, setPrintPacking] = useState('N');

  const [parties, setParties] = useState([]);
  const [lookupError, setLookupError] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [selectedMcode, setSelectedMcode] = useState('');

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [selectedBillKeys, setSelectedBillKeys] = useState(() => new Set());
  const [printQueue, setPrintQueue] = useState([]);
  const [bulkPrinting, setBulkPrinting] = useState(false);
  const [bulkPrintTotal, setBulkPrintTotal] = useState(0);
  const [bulkPrintDone, setBulkPrintDone] = useState(0);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [bulkActionLabel, setBulkActionLabel] = useState('');
  const selectAllRef = useRef(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const sRaw = formData.comp_s_dt ?? formData.COMP_S_DT;
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const s = toInputDateString(sRaw);
    const e = toInputDateString(eRaw);
    if (s) setBillDateStart(s);
    if (e) setBillDateEnd(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const { data } = await axios.get(`${apiBase}/api/salelist-parties`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
          timeout: 120000,
        });
        const list = Array.isArray(data) ? data : [];
        setParties(list.filter(isCustomerPartyCode));
      } catch (err) {
        console.error('Sale bill printing parties lookup:', err);
        const st = err.response?.status;
        setLookupError(
          st === 404
            ? `No /api/salelist-parties route on ${formatApiOrigin(apiBase)}. Run \`npm run server\` with latest server.cjs and refresh.`
            : err.response?.data?.error || err.message || 'Request failed'
        );
      }
    };
    load();
  }, [apiBase, compCode, compUid]);

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );

  const printingListSorted = useMemo(() => {
    if (!rows.length) return rows;
    return [...rows].sort((a, b) => {
      const da = toInputDateString(a.BILL_DATE ?? a.bill_date);
      const db = toInputDateString(b.BILL_DATE ?? b.bill_date);
      const cmpDate = da.localeCompare(db);
      if (cmpDate !== 0) return cmpDate;
      const na = Number(a.BILL_NO ?? a.bill_no);
      const nb = Number(b.BILL_NO ?? b.bill_no);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      const sa = String(a.BILL_NO ?? a.bill_no ?? '');
      const sb = String(b.BILL_NO ?? b.bill_no ?? '');
      if (sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true });
      const ba = String(a.B_TYPE ?? a.b_type ?? '');
      const bb = String(b.B_TYPE ?? b.b_type ?? '');
      if (ba !== bb) return ba.localeCompare(bb);
      return String(a.CODE ?? a.code ?? '').localeCompare(String(b.CODE ?? b.code ?? ''));
    });
  }, [rows]);

  useEffect(() => {
    setPartyHi(0);
  }, [partySearch]);

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code ?? '') === String(selectedMcode));

  const buildBillPrintParams = (row) => {
    const typ = row.TYPE ?? row.type;
    const billNoFromRow = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bTypeFromRow = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || billNoFromRow == null || !oracleDt) {
      if (!bulkPrinting) alert('Cannot open bill: missing type, bill no, or date.');
      return null;
    }

    return {
      type: String(typ).trim(),
      billNo: String(billNoFromRow).trim(),
      bType: String(bTypeFromRow).trim(),
      oracleDt,
      printGrossDane,
      printPacking,
      label: `Sale bill — ${typ} / ${billNoFromRow} / ${toDisplayDate(ymd)}`,
    };
  };

  const openSaleBill = (row, { previewOnly = true } = {}) => {
    const params = buildBillPrintParams(row);
    if (!params) return;
    if (previewOnly) {
      setBulkPrinting(false);
      setPrintQueue([]);
    }
    setBillPrintParams(params);
    setBillPrintOpen(true);
  };

  const toggleBillSelection = (key) => {
    setSelectedBillKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllBills = () => {
    setSelectedBillKeys((prev) => {
      if (prev.size === printingListSorted.length) return new Set();
      return new Set(printingListSorted.map((row, idx) => saleBillRowKey(row, idx)));
    });
  };

  const startBulkPrint = (rowsToPrint) => {
    if (!rowsToPrint.length) {
      alert('Select at least one bill to print.');
      return;
    }
    if (!window.confirm(`Open ${rowsToPrint.length} bill(s) on screen for Print / Pdf / WhatsApp?`)) return;
    const [first, ...rest] = rowsToPrint;
    const params = buildBillPrintParams(first);
    if (!params) return;
    setBulkPrinting(true);
    setBulkPrintTotal(rowsToPrint.length);
    setBulkPrintDone(1);
    setPrintQueue(rest);
    setBillPrintParams(params);
    setBillPrintOpen(true);
  };

  const printSelectedBills = () => {
    const picked = printingListSorted.filter((row, idx) => selectedBillKeys.has(saleBillRowKey(row, idx)));
    startBulkPrint(picked);
  };

  const printAllBills = () => startBulkPrint(printingListSorted);

  const getSelectedBillRows = () =>
    printingListSorted.filter((row, idx) => selectedBillKeys.has(saleBillRowKey(row, idx)));

  const runBulkSelectedAction = async (action, pdfMode = 'single') => {
    const picked = getSelectedBillRows();
    if (!picked.length) {
      alert('Select at least one bill.');
      return;
    }
    const paramsList = picked.map((row) => buildBillPrintParams(row)).filter(Boolean);
    if (!paramsList.length) return;

    const actionLabel =
      action === 'print'
        ? 'Print'
        : action === 'pdf'
          ? pdfMode === 'separate'
            ? 'PDF (separate files)'
            : 'PDF (one file)'
          : pdfMode === 'separate'
            ? 'WhatsApp (separate)'
            : 'WhatsApp (one PDF)';

    if (!window.confirm(`${actionLabel} for ${paramsList.length} selected bill(s)?`)) return;

    setBulkActionBusy(true);
    setBulkActionLabel(`Loading 0/${paramsList.length}…`);
    try {
      const payloads = await fetchSaleBillBulkPayloads({
        apiBase,
        compCode,
        compUid,
        companyName: compName,
        billParamsList: paramsList,
        onProgress: (current, total) => setBulkActionLabel(`Loading ${current}/${total}…`),
      });
      setBulkActionLabel(actionLabel);
      const pdfProgress = (current, total) => setBulkActionLabel(`Building PDF ${current}/${total}…`);
      if (action === 'print') {
        await bulkPrintSelectedSaleBills(payloads, { companyName: compName });
      } else if (action === 'pdf') {
        await bulkPdfSelectedSaleBills(payloads, {
          mode: pdfMode,
          companyName: compName,
          onProgress: pdfProgress,
        });
      } else if (action === 'whatsapp') {
        await bulkWhatsAppSelectedSaleBills(payloads, {
          mode: pdfMode,
          companyName: compName,
          onProgress: pdfMode === 'single' ? pdfProgress : undefined,
        });
      }
    } catch (err) {
      alert(String(err?.response?.data?.error || err?.message || err || 'Bulk action failed'));
    } finally {
      setBulkActionBusy(false);
      setBulkActionLabel('');
    }
  };

  const handleBulkPrintAdvance = () => {
    setPrintQueue((prev) => {
      if (prev.length === 0) {
        setBulkPrinting(false);
        setBulkPrintTotal(0);
        setBulkPrintDone(0);
        setBillPrintOpen(false);
        setBillPrintParams(null);
        return [];
      }
      const [next, ...rest] = prev;
      const params = buildBillPrintParams(next);
      if (!params) {
        setBulkPrinting(false);
        setBulkPrintTotal(0);
        setBulkPrintDone(0);
        setBillPrintOpen(false);
        setBillPrintParams(null);
        return [];
      }
      setBulkPrintDone((n) => n + 1);
      setBillPrintParams(params);
      return rest;
    });
  };

  const allBillsSelected = printingListSorted.length > 0 && selectedBillKeys.size === printingListSorted.length;
  const someBillsSelected = selectedBillKeys.size > 0 && !allBillsSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someBillsSelected;
    }
  }, [someBillsSelected]);

  useEffect(() => {
    if (showReport && rows.length) {
      setSelectedBillKeys(new Set());
      setPrintQueue([]);
      setBulkPrinting(false);
      setBulkPrintTotal(0);
      setBulkPrintDone(0);
    }
  }, [showReport, rows]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!type) {
      alert('Please select type.');
      return;
    }

    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        type: String(type).trim().toUpperCase(),
      };
      if (bType.trim()) params.b_type = bType.trim();
      let bnS = billNoStart.trim();
      let bnE = billNoEnd.trim();
      if (bnS && !bnE) bnE = bnS;
      if (bnE && !bnS) bnS = bnE;
      if (bnS && bnE) {
        params.bill_no_from = bnS;
        params.bill_no_to = bnE;
      }
      let dS = billDateStart.trim();
      let dE = billDateEnd.trim();
      if (dS && !dE) dE = dS;
      if (dE && !dS) dS = dE;
      if (dS && dE) {
        params.bill_date_from = toOracleDate(dS);
        params.bill_date_to = toOracleDate(dE);
      }
      if (selectedMcode.trim()) params.mcode = selectedMcode.trim();

      const { data } = await axios.get(`${apiBase}/api/sale-bill-printing-list`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) {
        alert('No matching sale bills found. Change filters and try again.');
        return;
      }
      setRows(list);
      setShowReport(true);
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Request failed';
      alert('Error: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const handleFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.id === 'sbp-party-search') return;

    e.preventDefault();
    focusNextSbpField(target.id);
  };

  const billNoRangeLabel = (() => {
    let bnS = billNoStart.trim();
    let bnE = billNoEnd.trim();
    if (bnS && !bnE) bnE = bnS;
    if (bnE && !bnS) bnS = bnE;
    if (!bnS || !bnE) return null;
    return bnS === bnE ? bnS : `${bnS}–${bnE}`;
  })();

  const billDateRangeLabel = (() => {
    let dS = billDateStart.trim();
    let dE = billDateEnd.trim();
    if (dS && !dE) dE = dS;
    if (dE && !dS) dS = dE;
    if (!dS || !dE) return null;
    const ds = toDisplayDate(dS);
    const de = toDisplayDate(dE);
    return ds === de ? ds : `${ds}–${de}`;
  })();

  const isDesktopView = viewMode === 'desktop';

  if (showReport && rows.length > 0) {
    return (
      <div className="slide slide-report slide-13-report">
        <SaleBillPrintModal
          open={billPrintOpen}
          onClose={() => {
            setBillPrintOpen(false);
            setBillPrintParams(null);
            setBulkPrinting(false);
            setPrintQueue([]);
            setBulkPrintTotal(0);
            setBulkPrintDone(0);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={billPrintParams}
          companyName={compName}
          bulkQueue={
            bulkPrinting && bulkPrintTotal > 0
              ? {
                  current: bulkPrintDone,
                  total: bulkPrintTotal,
                  hasNext: printQueue.length > 0,
                  onNext: handleBulkPrintAdvance,
                }
              : null
          }
        />
        <SessionInfoLine formData={formData} helpReportId="sale-bill-printing" />
        <div className="report-toolbar">
          <h2>Sale Bill Printing</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Type</strong> {type}
            {billNoRangeLabel ? (
              <>
                {' · '}
                <strong>Bill no</strong> {billNoRangeLabel}
              </>
            ) : null}
            {bType.trim() ? (
              <>
                {' · '}
                <strong>B type</strong> {bType.trim()}
              </>
            ) : null}
            {billDateRangeLabel ? (
              <>
                {' · '}
                <strong>Bill date</strong> {billDateRangeLabel}
              </>
            ) : null}
            {' · '}
            <strong>Gross/Dane</strong> {printGrossDane} · <strong>Packing</strong> {printPacking}
          </p>
          <p>
            <SessionLineText formData={formData} />
            <br />
            Tick bills below. Use <strong>Print / Pdf / WhatsApp selected</strong> for one-go output, or <strong>Open selected</strong> to preview each bill on screen.
            {bulkPrinting ? (
              <>
                {' '}
                <strong>
                  Viewing {bulkPrintDone} of {bulkPrintTotal}
                </strong>
              </>
            ) : null}
          </p>
        </div>

        <div className="sbp-list-toolbar">
          <label className="sbp-list-toolbar__select">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allBillsSelected}
              onChange={toggleSelectAllBills}
              aria-label="Select all bills"
              disabled={bulkActionBusy}
            />
            <span>
              Select all ({selectedBillKeys.size}/{printingListSorted.length})
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={printSelectedBills}
          >
            👁 Open selected ({selectedBillKeys.size})
          </button>
          <button type="button" className="btn btn-secondary" disabled={bulkPrinting || bulkActionBusy} onClick={printAllBills}>
            👁 Open all ({printingListSorted.length})
          </button>
        </div>

        <div className="sbp-list-toolbar sbp-list-toolbar--bulk-actions">
          <span className="sbp-list-toolbar__heading">Selected bills — one go</span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={() => void runBulkSelectedAction('print')}
          >
            🖨 Print selected
          </button>
          <button
            type="button"
            className="btn btn-export"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={() => void runBulkSelectedAction('pdf', 'single')}
          >
            📄 Pdf — one file
          </button>
          <button
            type="button"
            className="btn btn-export"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={() => void runBulkSelectedAction('pdf', 'separate')}
          >
            📄 Pdf — separate
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={() => void runBulkSelectedAction('whatsapp', 'single')}
          >
            💬 WhatsApp — one PDF
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={selectedBillKeys.size === 0 || bulkPrinting || bulkActionBusy}
            onClick={() => void runBulkSelectedAction('whatsapp', 'separate')}
          >
            💬 WhatsApp — each bill
          </button>
          {bulkActionBusy ? <span className="sbp-bulk-action-status">{bulkActionLabel || 'Working…'}</span> : null}
        </div>

        <div className="report-display">
          <div className="table-responsive table-responsive--bill-ledger">
            <table className="report-table report-table--bill-ledger report-table--sale-bill-printing-list">
              <thead>
                <tr>
                  <th className="sbp-list-col-check" aria-label="Print">
                    <span className="sbp-list-col-check__label">Print</span>
                  </th>
                  <th>Type</th>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>B type</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City</th>
                  <th className="text-right">Total tax</th>
                  <th className="text-right">Bill amt</th>
                </tr>
              </thead>
              <tbody>
                {printingListSorted.map((row, idx) => {
                  const rowKey = saleBillRowKey(row, idx);
                  const checked = selectedBillKeys.has(rowKey);
                  return (
                    <tr
                      key={rowKey}
                      className={`clickable-row${checked ? ' sbp-list-row--checked' : ''}`}
                      onClick={() => openSaleBill(row)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          openSaleBill(row);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <td className="sbp-list-col-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`Print bill ${row.BILL_NO ?? row.bill_no ?? idx + 1}`}
                          onChange={() => toggleBillSelection(rowKey)}
                        />
                      </td>
                      <td>{row.TYPE ?? row.type ?? '—'}</td>
                      <td>{toDisplayDate(toInputDateString(row.BILL_DATE ?? row.bill_date))}</td>
                      <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                      <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                      <td>{row.CODE ?? row.code ?? '—'}</td>
                      <td>{row.NAME ?? row.name ?? '—'}</td>
                      <td>{row.CITY ?? row.city ?? '—'}</td>
                      <td className="text-right">
                        {(parseFloat(row.TOTAL_TAX ?? row.total_tax ?? 0) || 0).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="text-right">
                        {(parseFloat(row.BILL_AMT ?? row.bill_amt ?? 0) || 0).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
    <SaleBillPrintFormShell
      className="fas-tb-host--form fas-sbp-host--form"
      footer={
        isDesktopView ? (
          <button
            type="button"
            className="fas-btn fas-btn-primary fas-tb-run-bottom"
            disabled={loading}
            onClick={() => void handleSubmit()}
          >
            {loading ? 'Loading…' : '▶ Show Bills'}
          </button>
        ) : null
      }
      header={
        <FasReportHeader
          title="Sale Bill Printing"
          onBack={onPrev}
          rightSlot={
            isDesktopView ? (
              <ReportHelpButton reportId="sale-bill-printing" includeSalesEntry={false} includeStockLot={true} appName="GFASORCL Accounting" />
            ) : (
              <button
                type="button"
                className="fas-report-header__run"
                disabled={loading}
                onClick={() => void handleSubmit()}
              >
                {loading ? 'Loading…' : '▶ Run'}
              </button>
            )
          }
        />
      }
    >
      <form
        id="sbp-params-form"
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        className="fas-tb-form-shell fas-sbp-form-shell"
      >
        <TrialBalanceSessionCard compact formData={formData} helpReportId="sale-bill-printing" />

        {lookupError ? (
          <div className="form-api-error fas-sbp-form__lookup-error" role="alert">
            <strong>Lookups:</strong> {lookupError}
          </div>
        ) : null}

        <div className="fas-sbp-form__grid">
          <div className="fas-field-group">
            <div className="fas-field-label">TYPE</div>
            <div className="fas-field-input fas-select-wrap">
              <select id="sbp-type" value={type} onChange={(e) => setType(e.target.value)} required>
                <option value="SL">SL</option>
                <option value="SE">SE</option>
                <option value="CN">CN</option>
              </select>
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">B type</div>
            <div className="fas-field-input">
              <input
                id="sbp-b-type"
                type="text"
                value={bType}
                onChange={(e) => setBType(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Start bill no</div>
            <div className="fas-field-input">
              <input
                id="sbp-bill-no-start"
                type="text"
                inputMode="numeric"
                value={billNoStart}
                onChange={(e) => {
                  const v = e.target.value;
                  setBillNoStart(v);
                  setBillNoEnd((end) => (String(end).trim() ? end : v));
                }}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">End bill no</div>
            <div className="fas-field-input">
              <input
                id="sbp-bill-no-end"
                type="text"
                inputMode="numeric"
                value={billNoEnd}
                onChange={(e) => setBillNoEnd(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Starting date</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="sbp-bill-date-start"
                type="date"
                lang="en-GB"
                value={billDateStart}
                onChange={(e) => {
                  const v = e.target.value;
                  setBillDateStart(v);
                  setBillDateEnd((end) => (String(end).trim() ? end : v));
                }}
              />
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">Ending date</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="sbp-bill-date-end"
                type="date"
                lang="en-GB"
                value={billDateEnd}
                onChange={(e) => setBillDateEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Gross / Dane weight</div>
            <div className="fas-field-input fas-select-wrap">
              <select id="sbp-print-gross-dane" value={printGrossDane} onChange={(e) => setPrintGrossDane(e.target.value)}>
                <option value="N">No</option>
                <option value="Y">Yes</option>
              </select>
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">Print packing</div>
            <div className="fas-field-input fas-select-wrap">
              <select id="sbp-print-packing" value={printPacking} onChange={(e) => setPrintPacking(e.target.value)}>
                <option value="N">No</option>
                <option value="Y">Yes</option>
              </select>
            </div>
          </div>

          <div className="fas-field-group fas-sbp-form__party">
            <div className="fas-field-label">Party code</div>
            <div className="fas-field-input">
              <input
                id="sbp-party-search"
                type="search"
                autoComplete="off"
                placeholder="Code, name, city…"
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                onKeyDown={(e) => {
                  if (selectedMcode) return;
                  const max = Math.max(0, filteredParties.length - 1);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredParties.length === 0) return;
                    setPartyHi((h) => Math.min(max, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPartyHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const r = filteredParties[safePartyHi];
                    if (r) {
                      setSelectedMcode(String(r.CODE ?? r.code ?? '').trim());
                      setPartySearch('');
                    }
                  }
                }}
              />
            </div>
            {selectedMcode ? (
              <p className="account-selected-hint">
                <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedMcode}</code>)
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setSelectedMcode('');
                    setPartySearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : partySearch.trim() ? (
              <div className="account-search-results party-search-results" role="listbox">
                {filteredParties.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredParties.map((row, index) => {
                    const code = row.CODE ?? row.code;
                    const rowHi = safePartyHi === index;
                    return (
                      <button
                        key={String(code)}
                        type="button"
                        role="option"
                        className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setPartyHi(index)}
                        onClick={() => {
                          setSelectedMcode(String(code).trim());
                          setPartySearch('');
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                        <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, partySearch)}</span>
                        <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </SaleBillPrintFormShell>
  );
}
