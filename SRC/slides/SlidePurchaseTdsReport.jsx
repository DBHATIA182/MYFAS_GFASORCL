import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import ReportToolbarActions from '../components/ReportToolbarActions';
import MasterPartyPickList from '../components/MasterPartyPickList';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import { focusNextOnEnter } from '../utils/enterKeyNextField';

const reqOpts = { withCredentials: true, timeout: 300000 };
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;

function mapAccountPickOption(a) {
  return {
    value: String(a.CODE ?? a.code ?? '').trim(),
    label: String(a.NAME ?? a.name ?? '').trim(),
    CODE: a.CODE ?? a.code,
    NAME: a.NAME ?? a.name,
    CITY: String(a.CITY ?? a.city ?? '').trim(),
  };
}

function accountHelpPickProps(triggerCode) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: false,
    filterPlaceholder: 'Type name, city or code…',
    getValue: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
    getOptionCity: (o) => String(o.CITY ?? '').trim(),
  };
}

const REPORT_CFG = {
  purchaseDetail: {
    apiPath: 'purchase-tds-detail',
    helpId: 'purchase-tds-detail',
    pdfType: 'purchase-tds-detail',
    title: 'Party Wise Purchase Detail (TDS)',
    excelName: 'PurchaseTdsDetail',
    hint: 'Click a bill row to open the purchase bill print.',
  },
  purchaseSummary: {
    apiPath: 'purchase-tds-summary',
    helpId: 'purchase-tds-summary',
    pdfType: 'purchase-tds-summary',
    title: 'Party Wise Purchase Summary (TDS)',
    excelName: 'PurchaseTdsSummary',
    hint: 'Party-wise totals of purchase amount and TDS (NTDS) for the period.',
  },
  saleDetail: {
    apiPath: 'sale-tds-detail',
    helpId: 'sale-tds-detail',
    pdfType: 'sale-tds-detail',
    title: 'Party Wise Sale Detail (TDS)',
    excelName: 'SaleTdsDetail',
    hint: 'Click a bill row to open the sale bill print.',
  },
  saleSummary: {
    apiPath: 'sale-tds-summary',
    helpId: 'sale-tds-summary',
    pdfType: 'sale-tds-summary',
    title: 'Party Wise Sale Summary (TDS)',
    excelName: 'SaleTdsSummary',
    hint: 'Party-wise totals of sale amount and TDS for the period.',
  },
};

const PURCHASE_DETAIL_COLUMNS = [
  'CODE',
  'NAME',
  'PAN',
  'DOC_DATE',
  'DOC_NO',
  'TYPE',
  'AMOUNT',
  'TDS_ON_AMT',
  'TDS_PER',
  'TDS_AMT',
  'CITY',
  'STATE',
];

const SALE_DETAIL_COLUMNS = [
  'CODE',
  'NAME',
  'PAN',
  'DOC_DATE',
  'DOC_NO',
  'TYPE',
  'B_TYPE',
  'AMOUNT',
  'TDS_ON_AMT',
  'TDS_PER',
  'TDS_AMT',
  'CITY',
  'STATE',
];

const SUMMARY_COLUMNS = [
  'CODE',
  'NAME',
  'PAN',
  'ADD1',
  'CITY',
  'STATE',
  'AMOUNT',
  'TDS_ON_AMT',
  'TDS_PER',
  'TDS_AMT',
];

const TOTAL_COLUMNS = ['AMOUNT', 'TDS_ON_AMT', 'TDS_AMT'];

const COLUMN_LABELS = {
  CODE: 'Code',
  NAME: 'Name',
  PAN: 'PAN',
  ADD1: 'Address',
  CITY: 'City',
  STATE: 'State',
  DOC_DATE: 'Date',
  DOC_NO: 'No',
  TYPE: 'Type',
  B_TYPE: 'B Type',
  AMOUNT: 'Amount',
  TDS_ON_AMT: 'TDS On Amt',
  TDS_PER: 'TDS %',
  TDS_AMT: 'TDS Amt',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCell(col, val) {
  if (TOTAL_COLUMNS.includes(col) || col === 'TDS_PER') return fmtAmt(val);
  if (col === 'DOC_DATE') return toDisplayDate(String(val || ''));
  return val == null ? '' : String(val);
}

function exportRow(row, columns) {
  const out = {};
  columns.forEach((c) => {
    out[COLUMN_LABELS[c] || c] = row[c];
  });
  return out;
}

function groupDetailRowsWithTotals(rows) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return [];
  const out = [];
  let partyKey = null;
  let partyLabel = '';
  let subtotal = { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 };
  const pushSubtotal = () => {
    if (!partyKey) return;
    out.push({
      _rowType: 'partyTotal',
      _partyLabel: partyLabel,
      AMOUNT: subtotal.AMOUNT,
      TDS_ON_AMT: subtotal.TDS_ON_AMT,
      TDS_AMT: subtotal.TDS_AMT,
    });
  };
  source.forEach((row) => {
    const code = String(row?.CODE ?? '').trim();
    const name = String(row?.NAME ?? '').trim();
    const key = `${code}||${name}`;
    if (partyKey !== null && key !== partyKey) {
      pushSubtotal();
      subtotal = { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 };
    }
    partyKey = key;
    partyLabel = `${code}${name ? ` - ${name}` : ''}`.trim();
    subtotal.AMOUNT += num(row?.AMOUNT);
    subtotal.TDS_ON_AMT += num(row?.TDS_ON_AMT);
    subtotal.TDS_AMT += num(row?.TDS_AMT);
    out.push({ ...row, _rowType: 'detail' });
  });
  pushSubtotal();
  return out;
}

const SALE_LIST_NUMTYPE_TO_PRINT = {
  1: 'SL',
  2: 'CH',
  3: 'SL',
  6: 'SE',
  8: 'CN',
  9: 'RC',
};

/** VFP DO FORM tcs_rpt WITH 3/4/5/6 — purchase NTDS and sale TDS fields. */
export default function SlidePurchaseTdsReport({
  apiBase,
  formData,
  userName,
  onPrev,
  onReset,
  reportMode = 'purchaseDetail',
  slideClass = 'slide-23-purchase-tds-detail',
}) {
  const [summaryDrill, setSummaryDrill] = useState(null);
  const effectiveMode = useMemo(() => {
    if (!summaryDrill) return reportMode;
    if (reportMode === 'purchaseSummary') return 'purchaseDetail';
    if (reportMode === 'saleSummary') return 'saleDetail';
    return reportMode;
  }, [reportMode, summaryDrill]);
  const cfg = REPORT_CFG[effectiveMode] || REPORT_CFG.purchaseDetail;
  const isDetail = effectiveMode === 'purchaseDetail' || effectiveMode === 'saleDetail';
  const isSale = effectiveMode === 'saleDetail' || effectiveMode === 'saleSummary';
  const displayColumns = isDetail ? (isSale ? SALE_DETAIL_COLUMNS : PURCHASE_DETAIL_COLUMNS) : SUMMARY_COLUMNS;

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [partyCode, setPartyCode] = useState('');
  const [accounts, setAccounts] = useState([]);
  const accountOptions = useMemo(() => accounts.map(mapAccountPickOption), [accounts]);
  const accountSearchDebounceRef = useRef(null);
  const entryFormRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);
  const [purchaseBillPrintOpen, setPurchaseBillPrintOpen] = useState(false);
  const [purchaseBillPrintParams, setPurchaseBillPrintParams] = useState(null);
  const [saleBillPrintOpen, setSaleBillPrintOpen] = useState(false);
  const [saleBillPrintParams, setSaleBillPrintParams] = useState(null);

  useEffect(() => {
    if (fyStart) setSdt(fyStart);
    if (fyEnd) setEdt(fyEnd);
  }, [fyStart, fyEnd]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        TOTAL_COLUMNS.forEach((c) => {
          acc[c] += num(r[c]);
        });
        return acc;
      },
      { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 }
    );
  }, [rows]);

  const partyName = useMemo(
    () => accountOptions.find((o) => o.value === partyCode.trim())?.label || '',
    [accountOptions, partyCode]
  );

  const partyLabel = partyCode.trim()
    ? `${partyCode.trim()}${partyName ? ` — ${partyName}` : ''}`
    : 'All parties';

  const fetchAccounts = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      const trimmed = String(q ?? '').trim();
      if (!trimmed) {
        setAccounts([]);
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params: { comp_code: compCode, comp_uid: compUid, q: trimmed },
          ...reqOpts,
        });
        setAccounts(Array.isArray(data) ? data : []);
      } catch {
        setAccounts([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleAccountFilterChange = useCallback(
    (q) => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
      accountSearchDebounceRef.current = setTimeout(() => {
        void fetchAccounts(q);
      }, ACCOUNT_SEARCH_DEBOUNCE_MS);
    },
    [fetchAccounts]
  );

  const handleEntryFormKeyDown = useCallback((e) => {
    if (focusNextOnEnter(e, entryFormRef, { submitOnLast: true })) return;
  }, []);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      reportTitle: summaryDrill?.title || cfg.title,
      period: `${toDisplayDate(sdt)} – ${toDisplayDate(edt)}`,
      partyFilter: summaryDrill?.partyLabel || partyLabel,
      reportMode: effectiveMode,
    }),
    [compName, compYear, cfg.title, sdt, edt, partyLabel, effectiveMode, summaryDrill]
  );

  const excelRows = useMemo(() => {
    if (!rows.length) return [];
    const dataRows = rows.map((r) => exportRow(r, displayColumns));
    const totalRow = {};
    displayColumns.forEach((c, idx) => {
      if (idx === 0) totalRow[COLUMN_LABELS[c] || c] = 'TOTAL';
      else if (TOTAL_COLUMNS.includes(c)) totalRow[COLUMN_LABELS[c] || c] = totals[c];
      else totalRow[COLUMN_LABELS[c] || c] = '';
    });
    return [...dataRows, totalRow];
  }, [rows, displayColumns, totals]);

  const normalizedRows = useMemo(() => {
    if (!isDetail) return rows;
    return rows.map((row) => ({
      ...row,
      DOC_DATE: row.DOC_DATE ?? row.R_DATE ?? row.BILL_DATE ?? '',
      DOC_NO: row.DOC_NO ?? row.R_NO ?? row.BILL_NO ?? '',
    }));
  }, [isDetail, rows]);

  const detailRowsWithPartyTotals = useMemo(
    () => (isDetail ? groupDetailRowsWithTotals(normalizedRows) : normalizedRows),
    [isDetail, normalizedRows]
  );

  const runReport = async () => {
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      setSummaryDrill(null);
      const { data } = await axios.get(apiUrl(apiBase, `/api/${cfg.apiPath}`), {
        ...reqOpts,
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sdt),
          e_date: toOracleDate(edt),
          party_code: partyCode.trim() || undefined,
        },
      });
      const list = Array.isArray(data?.rows)
        ? data.rows.map((row) =>
            isDetail
              ? {
                  ...row,
                  DOC_DATE: row.DOC_DATE ?? row.R_DATE ?? row.BILL_DATE ?? '',
                  DOC_NO: row.DOC_NO ?? row.R_NO ?? row.BILL_NO ?? '',
                }
              : row
          )
        : [];
      setRows(list);
      setShowReport(true);
      if (!list.length) alert(`No ${isSale ? 'sale' : 'purchase'} TDS rows found for the selected criteria.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const openSummaryDetail = async (row) => {
    const selectedPartyCode = String(row?.CODE ?? '').trim();
    if (!selectedPartyCode) return;
    setLoading(true);
    setErr('');
    try {
      const detailApiPath = reportMode === 'saleSummary' ? 'sale-tds-detail' : 'purchase-tds-detail';
      const { data } = await axios.get(apiUrl(apiBase, `/api/${detailApiPath}`), {
        ...reqOpts,
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sdt),
          e_date: toOracleDate(edt),
          party_code: selectedPartyCode,
        },
      });
      const list = Array.isArray(data?.rows)
        ? data.rows.map((detailRow) => ({
            ...detailRow,
            DOC_DATE: detailRow.DOC_DATE ?? detailRow.R_DATE ?? detailRow.BILL_DATE ?? '',
            DOC_NO: detailRow.DOC_NO ?? detailRow.R_NO ?? detailRow.BILL_NO ?? '',
          }))
        : [];
      setSummaryDrill({
        sourceRows: rows,
        title: `${cfg.title.replace('Summary', 'Detail')} — ${selectedPartyCode}${row?.NAME ? ` — ${row.NAME}` : ''}`,
        partyLabel: `${selectedPartyCode}${row?.NAME ? ` — ${row.NAME}` : ''}`,
      });
      setRows(list);
      if (!list.length) alert('No detail rows found for the selected party.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Failed to load detail';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExcel = async () => {
    if (!rows.length) {
      await runReport();
      return;
    }
    try {
      downloadExcelRows(excelRows, cfg.excelName, `${compName || 'Company'}_${cfg.excelName}`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handlePdf = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    generatePDF(cfg.pdfType, rows, pdfMeta).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const shareText = [
      `${cfg.title} — ${compName}`,
      `${compYear} | ${pdfMeta.period}`,
      `Party: ${partyLabel}`,
      `Rows: ${rows.length}`,
    ].join('\n');
    sharePdfWithWhatsApp(cfg.pdfType, rows, pdfMeta, shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  const openPurchaseBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const rNo = row.DOC_NO ?? row.doc_no;
    const rDt = row.DOC_DATE ?? row.doc_date;
    const ymd = toInputDateString(rDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || rNo == null || rNo === '' || !oracleDt) {
      alert('Cannot open bill: missing type, R no, or R date.');
      return;
    }
    setPurchaseBillPrintParams({
      type: String(typ).trim(),
      rNo: String(rNo).trim(),
      oracleDt,
      label: `Purchase — ${typ} / ${rNo} / ${toDisplayDate(ymd)}`,
    });
    setPurchaseBillPrintOpen(true);
  };

  const openSaleBill = (row) => {
    const typRaw = row.TYPE ?? row.type;
    const typU = String(typRaw ?? '').trim().toUpperCase();
    const numType = typeof typRaw === 'number' ? typRaw : parseInt(String(typRaw ?? '').trim(), 10);
    let printType = typU;
    if (Number.isFinite(numType) && numType >= 1 && numType <= 9) {
      const mapped = SALE_LIST_NUMTYPE_TO_PRINT[numType];
      if (mapped) printType = mapped;
      else if (numType === 4 || numType === 7) printType = String(numType);
      else {
        alert('Print preview is not mapped for this document type number.');
        return;
      }
    } else if (typU === 'GN') {
      printType = 'CN';
    } else if (!['SL', 'SE', 'CN', 'CH', 'RC', 'CX'].includes(typU)) {
      alert('Print preview supports SL, SE, CN, GN, CH, RC, CX, or numeric TYPE 1–9.');
      return;
    }
    const billNo = row.DOC_NO ?? row.doc_no;
    const billDt = row.DOC_DATE ?? row.doc_date;
    const bType = row.B_TYPE ?? row.b_type ?? ' ';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (typRaw == null || typRaw === '' || billNo == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    const oracleExact =
      typeof typRaw === 'number'
        ? typRaw
        : Number.isFinite(numType) && numType >= 1 && numType <= 9
          ? numType
          : null;
    setSaleBillPrintParams({
      type: printType,
      oracleTypeNum: oracleExact ?? undefined,
      billNo: String(billNo).trim(),
      bType: String(bType).trim() || ' ',
      oracleDt,
      label: `Sale — ${typU || typRaw} / ${billNo} / ${toDisplayDate(ymd)}`,
    });
    setSaleBillPrintOpen(true);
  };

  if (showReport) {
    return (
      <div className={`slide slide-report purchase-tds-screen ${slideClass}`}>
        <div className="purchase-tds-screen__scroll">
          <div className="report-toolbar">
            <h2>{cfg.title}</h2>
            <ReportToolbarActions
              reportId={cfg.helpId}
              onBack={() => {
                if (summaryDrill?.sourceRows) {
                  setRows(summaryDrill.sourceRows);
                  setSummaryDrill(null);
                  return;
                }
                setShowReport(false);
              }}
              onPdf={handlePdf}
              onExcel={handleExcel}
              onWhatsApp={handleWhatsApp}
              onMenu={onPrev}
            />
          </div>

          <p className="purchase-tds-screen__meta">
            {toDisplayDate(sdt)} – {toDisplayDate(edt)} · {partyLabel} · {rows.length} row(s)
          </p>
          <p className="report-info purchase-tds-screen__hint">
            {isDetail ? cfg.hint : 'Click a party row to open bill-wise detail for that party.'}
          </p>

          <div className="purchase-tds-screen__table-wrap table-responsive">
            <table className="table-report purchase-tds-table">
              <thead>
                <tr>
                  {displayColumns.map((c) => (
                    <th key={c} className={TOTAL_COLUMNS.includes(c) || c === 'TDS_PER' ? 'num' : ''}>
                      {COLUMN_LABELS[c] || c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailRowsWithPartyTotals.map((r, idx) =>
                  r?._rowType === 'partyTotal' ? (
                    <tr key={`pt-${r._partyLabel}-${idx}`} className="purchase-tds-party-total-row">
                      {displayColumns.map((c, colIdx) => (
                        <td key={c} className={TOTAL_COLUMNS.includes(c) || c === 'TDS_PER' ? 'num' : ''}>
                          <strong>
                            {colIdx === 0
                              ? `${r._partyLabel} TOTAL`
                              : TOTAL_COLUMNS.includes(c)
                                ? fmtAmt(r[c])
                                : ''}
                          </strong>
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr
                      key={`${r.CODE}-${r.DOC_NO ?? ''}-${r.DOC_DATE ?? ''}-${idx}`}
                      className="purchase-tds-row-clickable"
                      onClick={() => {
                        if (isDetail) {
                          if (isSale) openSaleBill(r);
                          else openPurchaseBill(r);
                        } else {
                          void openSummaryDetail(r);
                        }
                      }}
                      onKeyDown={
                        (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (isDetail) {
                              if (isSale) openSaleBill(r);
                              else openPurchaseBill(r);
                            } else {
                              void openSummaryDetail(r);
                            }
                          }
                        }
                      }
                      tabIndex={0}
                      role="button"
                    >
                      {displayColumns.map((c) => (
                        <td key={c} className={TOTAL_COLUMNS.includes(c) || c === 'TDS_PER' ? 'num' : ''}>
                          {fmtCell(c, r[c])}
                        </td>
                      ))}
                    </tr>
                  )
                )}
                {normalizedRows.length > 0 ? (
                  <tr className="purchase-tds-total-row">
                    {displayColumns.map((c, idx) => (
                      <td key={c} className={TOTAL_COLUMNS.includes(c) || c === 'TDS_PER' ? 'num' : ''}>
                        <strong>
                          {idx === 0
                            ? 'TOTAL'
                            : TOTAL_COLUMNS.includes(c)
                              ? fmtAmt(totals[c])
                              : ''}
                        </strong>
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <PurchaseBillPrintModal
          open={purchaseBillPrintOpen}
          onClose={() => {
            setPurchaseBillPrintOpen(false);
            setPurchaseBillPrintParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={purchaseBillPrintParams}
          companyName={compName}
        />
        <SaleBillPrintModal
          open={saleBillPrintOpen}
          onClose={() => {
            setSaleBillPrintOpen(false);
            setSaleBillPrintParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={saleBillPrintParams}
          companyName={compName}
        />
      </div>
    );
  }

  return (
    <div className={`slide slide-report purchase-tds-screen ${slideClass}`}>
      <SessionInfoLine formData={formData} userName={userName} />
      <div className="report-toolbar">
        <h2>{cfg.title}</h2>
        <ReportToolbarActions reportId={cfg.helpId} onMenu={onPrev} onReset={onReset} />
      </div>

      <form
        ref={entryFormRef}
        className="report-form purchase-tds-form"
        onSubmit={(e) => {
          e.preventDefault();
          runReport();
        }}
        onKeyDownCapture={handleEntryFormKeyDown}
      >
        <div className="form-row-broker form-row-broker--dates">
          <label className="form-group">
            <span>Starting Date</span>
            <input
              type="date"
              className="form-input"
              value={sdt}
              onChange={(e) => setSdt(e.target.value)}
              required
            />
          </label>
          <label className="form-group">
            <span>Ending Date</span>
            <input
              type="date"
              className="form-input"
              value={edt}
              onChange={(e) => setEdt(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="form-row-broker">
          <label className="form-group purchase-tds-form__party">
            <span>Party (optional)</span>
            <MasterPartyPickList
              options={accountOptions}
              value={partyCode}
              onChange={(v) => setPartyCode(String(v ?? '').trim().toUpperCase())}
              onFilterChange={handleAccountFilterChange}
              title="Party"
              placeholder="All parties"
              {...accountHelpPickProps(partyCode)}
            />
          </label>
        </div>

        {err ? <p className="form-api-error">{err}</p> : null}
        {loading ? <p className="loading-msg">Loading…</p> : null}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Proceed
          </button>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
