import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import ReportHelpButton from '../components/ReportHelpButton';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import { findIncomeTaxModuleItem } from '../data/incomeTaxModuleConfig';
import {
  getIncomeTaxReportDef,
  humanizeColumnKey,
  INCOME_TAX_FILTER_LABELS,
  resolveIncomeTaxDisplayColumns,
  formatPartyBlockParts,
  partyBlockExportText,
  compactTableColClass,
  buildGroupedDisplayRows,
} from '../data/incomeTaxReportDefs';

const reqOpts = { withCredentials: true, timeout: 600000 };

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field itax-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function fmtCell(value, type) {
  if (value == null || value === '') return '';
  if (type === 'num') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'date') return toDisplayDate(value) || String(value);
  return String(value);
}

function renderReportCell(row, col) {
  if (col.type === 'partyBlock') {
    const { name, subs } = formatPartyBlockParts(row, col);
    return (
      <div className="itax-party-block">
        {name ? <div className="itax-party-block__name">{name}</div> : null}
        {subs.map((line, i) => (
          <div key={`${line}-${i}`} className="itax-party-block__sub">
            {line}
          </div>
        ))}
      </div>
    );
  }
  return fmtCell(row[col.key] ?? row[col.key?.toLowerCase?.()], col.type);
}


function rowLedgerCode(row, displayColumns) {
  for (const k of ['CODE', 'code', 'SUP_CODE', 'sup_code']) {
    const v = String(row[k] ?? '').trim();
    if (v) return v;
  }
  const codeCol = displayColumns.find((c) => /^code$/i.test(String(c.key)));
  if (codeCol) {
    const v = String(row[codeCol.key] ?? row[codeCol.key?.toLowerCase?.()] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function ItaxMobilePartyList({ rows, displayColumns, ledgerDrillEnabled, onOpenLedger, onRowClick }) {
  const partyCol = displayColumns.find((c) => c.type === 'partyBlock');
  const attrCols = displayColumns.filter((c) => c.type !== 'partyBlock' && c.key !== 'CODE');

  return (
    <div className="itax-mobile-list">
      {rows.map((r) => {
        const code = rowLedgerCode(r, displayColumns);
        const clickable = ledgerDrillEnabled && onOpenLedger && Boolean(code);
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={r._id}
            type={clickable ? 'button' : undefined}
            className={`itax-mobile-card${clickable ? ' itax-mobile-card--ledger' : ''}`}
            onClick={clickable ? () => onRowClick(r) : undefined}
          >
            <div className="itax-mobile-card__head">
              <span className="itax-mobile-card__code">{fmtCell(r.CODE ?? r.code, 'text')}</span>
            </div>
            {partyCol ? <div className="itax-mobile-card__party">{renderReportCell(r, partyCol)}</div> : null}
            <div className="itax-mobile-card__grid">
              {attrCols.map((c) => (
                <div key={c.key} className="itax-mobile-card__attr">
                  <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
                  <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>
                    {renderReportCell(r, c)}
                  </span>
                </div>
              ))}
            </div>
          </Tag>
        );
      })}
      {!rows.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

/** Generic income tax report screen — all BW_MENU incometaxr items (VFP forms/prg/reports). */
export default function IncomeTaxReportScreen({ apiBase, formData, userName, onPrev, onOpenLedger, viewMode = 'desktop' }) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findIncomeTaxModuleItem(reportType);
  const def = getIncomeTaxReportDef(reportType);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [minAmt, setMinAmt] = useState('0');
  const [scheduleNo, setScheduleNo] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [scode, setScode] = useState('');
  const [icode, setIcode] = useState('');
  const [bkCode, setBkCode] = useState('');
  const [bkName, setBkName] = useState('');
  const [godCode, setGodCode] = useState('');
  const [mcode, setMcode] = useState('');
  const [mdc, setMdc] = useState('');
  const [mru, setMru] = useState('');
  const [bNo, setBNo] = useState('');
  const [panYn, setPanYn] = useState('');
  const [spNo, setSpNo] = useState('');

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [showReport, setShowReport] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  );

  const title = meta?.title || 'Income Tax Report';

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (fyStart) setSdt(fyStart);
    if (fyEnd) setEdt(fyEnd);
  }, [fyStart, fyEnd, reportType]);

  const filterValues = useMemo(
    () => ({
      sdt,
      edt,
      minAmt,
      scheduleNo,
      stateCode,
      scode,
      icode,
      bkCode,
      bkName,
      godCode,
      mcode,
      mdc,
      mru,
      bNo,
      panYn,
      spNo,
    }),
    [sdt, edt, minAmt, scheduleNo, stateCode, scode, icode, bkCode, bkName, godCode, mcode, mdc, mru, bNo, panYn, spNo]
  );

  const displayColumns = useMemo(
    () => resolveIncomeTaxDisplayColumns(reportType, columns, rows),
    [reportType, columns, rows]
  );

  const compactTable = Boolean(def?.compactTable);
  const monthPivot = Boolean(def?.monthPivot);
  const groupByKeys = Array.isArray(def?.groupBy) ? def.groupBy : null;
  const isMobileUi = viewMode === 'mobile' || narrowViewport;
  const useMobileCards = isMobileUi && compactTable && displayColumns.some((c) => c.type === 'partyBlock');
  const mobileTableScroll = isMobileUi && compactTable && !useMobileCards;

  const tableRows = useMemo(() => {
    if (!groupByKeys?.length || !rows.length) {
      return rows.map((r) => ({ _type: 'data', ...r }));
    }
    return buildGroupedDisplayRows(rows, groupByKeys);
  }, [rows, groupByKeys]);

  const ledgerDrillEnabled =
    Boolean(def?.ledgerDrilldown) || displayColumns.some((c) => /^code$/i.test(String(c.key)));

  const handleRowClick = (row) => {
    if (!onOpenLedger || !ledgerDrillEnabled) return;
    const code = rowLedgerCode(row, displayColumns);
    if (!code) return;
    onOpenLedger({ code, reportType, sdt, edt });
  };

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      reportTitle: title,
      reportId: reportType,
      period: `${toDisplayDate(sdt)} – ${toDisplayDate(edt)}`,
      columns: displayColumns,
      tableRows: groupByKeys?.length ? tableRows : undefined,
    }),
    [compName, compYear, title, reportType, sdt, edt, displayColumns, groupByKeys, tableRows]
  );

  const buildPayload = () => {
    const body = {
      report_id: reportType,
      comp_code: compCode,
      comp_uid: compUid,
      s_date: toOracleDate(sdt),
      e_date: toOracleDate(edt),
      min_amt: minAmt,
      schedule_no: scheduleNo.trim() || '0',
      state_code: stateCode.trim(),
      scode: scode.trim(),
      icode: icode.trim(),
      bk_code: bkCode.trim(),
      bk_name: bkName.trim(),
      god_code: godCode.trim(),
      mcode: mcode.trim(),
      mdc: mdc.trim(),
      mru: mru.trim(),
      b_no: bNo.trim() || '0',
      pan_yn: panYn.trim(),
      sp_no: spNo.trim() || '0',
    };
    return body;
  };

  const runReport = async () => {
    if (!reportType) {
      alert('Report type is missing.');
      return;
    }
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/income-tax-report'), buildPayload(), reqOpts);
      const list = Array.isArray(data?.rows) ? data.rows : [];
      const cols = Array.isArray(data?.columns) ? data.columns : [];
      setRows(list.map((r, idx) => ({ ...r, _id: `${idx}` })));
      setColumns(cols);
      setShowReport(true);
      if (!list.length) alert('No rows returned for the selected criteria.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const excelRows = useMemo(() => {
    const buildDataRow = (r) => {
      const o = {};
      displayColumns.forEach((c) => {
        if (c.type === 'partyBlock') {
          o[c.label || c.key] = partyBlockExportText(r, c);
        } else {
          o[c.label || c.key] = r[c.key] ?? r[c.key?.toLowerCase?.()] ?? '';
        }
      });
      return o;
    };

    if (!groupByKeys?.length) {
      return rows.map(buildDataRow);
    }

    const out = [];
    for (const item of tableRows) {
      if (item._type === 'group') {
        const o = {};
        displayColumns.forEach((c, idx) => {
          o[c.label || c.key] = idx === 0 ? item.label : '';
        });
        out.push(o);
      } else {
        out.push(buildDataRow(item));
      }
    }
    return out;
  }, [rows, displayColumns, groupByKeys, tableRows]);

  const handleExcel = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    downloadExcelRows(excelRows, title.replace(/\s+/g, ''), `${compName || 'Company'}_${reportType}`);
  };

  const handlePdf = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const pdfType = reportType === 'loaner-list' ? 'loaner-list' : 'income-tax-report';
    generatePDF(pdfType, rows, pdfMeta).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const pdfType = reportType === 'loaner-list' ? 'loaner-list' : 'income-tax-report';
    const shareText = [`${title} — ${compName}`, `${compYear} | ${pdfMeta.period}`, `Rows: ${rows.length}`].join('\n');
    sharePdfWithWhatsApp(pdfType, rows, pdfMeta, shareText).catch((e) => alert(String(e?.message || e)));
  };

  const renderFilter = (key) => {
    const label = INCOME_TAX_FILTER_LABELS[key] || humanizeColumnKey(key);
    switch (key) {
      case 'sdt':
        return (
          <Field key={key} label={`${label} *`}>
            <input type="date" className="inttrf-input" value={sdt} disabled={loading} onChange={(e) => setSdt(e.target.value)} />
          </Field>
        );
      case 'edt':
        return (
          <Field key={key} label={`${label} *`}>
            <input type="date" className="inttrf-input" value={edt} disabled={loading} onChange={(e) => setEdt(e.target.value)} />
          </Field>
        );
      case 'mdc':
        return (
          <Field key={key} label={label}>
            <select className="inttrf-input" value={mdc} disabled={loading} onChange={(e) => setMdc(e.target.value)}>
              <option value="">All</option>
              <option value="D">Debit (D)</option>
              <option value="C">Credit (C)</option>
            </select>
          </Field>
        );
      case 'mru':
        return (
          <Field key={key} label={label}>
            <select className="inttrf-input" value={mru} disabled={loading} onChange={(e) => setMru(e.target.value)}>
              <option value="">All</option>
              <option value="R">With GST (R)</option>
              <option value="U">Without GST (U)</option>
            </select>
          </Field>
        );
      default:
        return (
          <Field key={key} label={label}>
            <input
              type="text"
              className="inttrf-input"
              value={filterValues[key] ?? ''}
              disabled={loading}
              onChange={(e) => {
                const v = e.target.value;
                if (key === 'minAmt') setMinAmt(v);
                else if (key === 'scheduleNo') setScheduleNo(v);
                else if (key === 'stateCode') setStateCode(v);
                else if (key === 'scode') setScode(v);
                else if (key === 'icode') setIcode(v);
                else if (key === 'bkCode') setBkCode(v);
                else if (key === 'bkName') setBkName(v);
                else if (key === 'godCode') setGodCode(v);
                else if (key === 'mcode') setMcode(v);
                else if (key === 'bNo') setBNo(v);
                else if (key === 'panYn') setPanYn(v);
                else if (key === 'spNo') setSpNo(v);
              }}
            />
          </Field>
        );
    }
  };

  if (showReport) {
    return (
      <div
        className={`slide slide-89-itax slide-report itax-screen itax-screen--report${compactTable ? ' itax-screen--compact-table' : ''}${monthPivot ? ' itax-screen--month-pivot' : ''}${useMobileCards ? ' itax-screen--party-cards' : ''}${mobileTableScroll ? ' itax-screen--mobile-scroll' : ''}${isMobileUi ? ' slide-report--mobile-toolbar-row' : ''}`}
      >
        <div className="itax-screen__scroll">
          <div className="report-toolbar">
            <h2>{title}</h2>
            {useMobileCards ? (
              <div className="itax-party-toolbar">
                <ReportHelpButton reportId={reportType || 'income-tax-module'} />
                <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
                  ← Back
                </button>
                <button type="button" className="btn btn-export" onClick={handlePdf}>
                  Pdf
                </button>
                <button type="button" className="btn btn-whatsapp" onClick={handleWhatsApp}>
                  WhatsApp
                </button>
                <button type="button" className="btn btn-secondary" onClick={onPrev}>
                  Menu
                </button>
              </div>
            ) : (
            <div className="toolbar-actions">
              <ReportHelpButton reportId={reportType || 'income-tax-module'} />
              <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
                ← Back
              </button>
              <button type="button" className="btn btn-export" onClick={handlePdf}>
                Pdf
              </button>
              <button type="button" className="btn btn-excel" onClick={handleExcel}>
                Excel
              </button>
              <button type="button" className="btn btn-whatsapp" onClick={handleWhatsApp}>
                WhatsApp
              </button>
              <button type="button" className="btn btn-secondary" onClick={onPrev}>
                Menu
              </button>
            </div>
            )}
          </div>

          <p className="itax-screen__meta">
            {toDisplayDate(sdt)} – {toDisplayDate(edt)} · {rows.length} row(s)
            {ledgerDrillEnabled && onOpenLedger ? <> · Tap a row to open party ledger</> : null}
            {mobileTableScroll ? <> · Swipe sideways for all columns</> : null}
            {monthPivot && !isMobileUi ? <> · Scroll sideways if needed</> : null}
            {!isMobileUi && !compactTable && displayColumns.length > 6 ? <> · Scroll horizontally for more columns</> : null}
          </p>

          <div className="itax-screen__table-wrap" role="region" aria-label="Report table" tabIndex={0}>
            {useMobileCards ? (
              <ItaxMobilePartyList
                rows={rows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onOpenLedger={onOpenLedger}
                onRowClick={handleRowClick}
              />
            ) : (
            <table className="table-report itax-table">
              {compactTable ? (
                <colgroup>
                  {displayColumns.map((c) => (
                    <col key={c.key} className={compactTableColClass(c)} />
                  ))}
                </colgroup>
              ) : null}
              <thead>
                <tr>
                  {displayColumns.map((c) => (
                    <th key={c.key} className={c.type === 'num' ? 'num' : ''}>
                      {c.label || humanizeColumnKey(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((item) => {
                  if (item._type === 'group') {
                    return (
                      <tr key={item._id} className="itax-schedule-group">
                        <td colSpan={displayColumns.length}>{item.label}</td>
                      </tr>
                    );
                  }

                  const r = item;
                  const code = rowLedgerCode(r, displayColumns);
                  const clickable = ledgerDrillEnabled && onOpenLedger && Boolean(code);
                  return (
                    <tr
                      key={r._id}
                      className={clickable ? 'itax-row--ledger' : ''}
                      onClick={clickable ? () => handleRowClick(r) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRowClick(r);
                              }
                            }
                          : undefined
                      }
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      title={clickable ? `Open ledger for ${code}` : undefined}
                    >
                      {displayColumns.map((c) => {
                        const nameVal = c.key === 'NAME' ? String(r[c.key] ?? r[c.key?.toLowerCase?.()] ?? '').trim() : '';
                        const cellTitle =
                          clickable && c.key === 'CODE'
                            ? `Open ledger for ${code}`
                            : monthPivot && c.key === 'NAME' && nameVal
                              ? nameVal
                              : undefined;
                        return (
                        <td
                          key={c.key}
                          title={cellTitle}
                          className={[
                            c.type === 'num' ? 'num' : '',
                            c.type === 'partyBlock' ? 'itax-cell--party' : '',
                            monthPivot && c.key === 'NAME' ? 'itax-cell--name-short' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {renderReportCell(r, c)}
                        </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!tableRows.length ? (
                  <tr>
                    <td colSpan={displayColumns.length || 1}>No rows</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-89-itax itax-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">{title}</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId={reportType || 'income-tax-module'} />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="itax-screen__panel">
        {meta?.vfpCommand ? (
          <p className="itax-screen__hint">
            VFP <code>{meta.vfpCommand}</code>
            {meta.vfpNote ? <> — {meta.vfpNote}</> : null}
          </p>
        ) : null}

        <div className="itax-screen__filters inttrf-screen__header-panel">
          {def.filters.map((f) => renderFilter(f))}
        </div>

        <div className="itax-screen__actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={runReport}>
            {loading ? 'Loading…' : 'Proceed'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={onPrev}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
