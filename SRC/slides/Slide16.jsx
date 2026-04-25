import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { downloadExcelWorkbook } from '../utils/excelExport';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  if (typeof v === 'number') {
    return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return v == null ? '' : String(v);
}

function isDateColumn(name) {
  const k = String(name || '').toUpperCase();
  return k.includes('DATE');
}

function fmtCell(col, val) {
  if (typeof val === 'number') return fmt(val);
  if (isDateColumn(col)) return toDisplayDate(String(val || ''));
  return val == null ? '' : String(val);
}

const TAB_LABELS = {
  dateWise: 'Date Wise',
  monthlyHsnWise: 'Monthly Hsn Wise',
  hsnWiseMonthly: 'Hsn Wise Monthly',
};

export default function Slide16({ apiBase, formData, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [sDate, setSDate] = useState('');
  const [eDate, setEDate] = useState('');
  const [mRUC, setMRUC] = useState('C');
  const [schedule, setSchedule] = useState('');
  const [code, setCode] = useState('');
  const [partyList, setPartyList] = useState([]);
  const [report, setReport] = useState(null);
  const [activeTab, setActiveTab] = useState('dateWise');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [error, setError] = useState('');
  const [detailRows, setDetailRows] = useState([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [screen, setScreen] = useState('main');
  const mainTopScrollRef = useRef(null);
  const mainTopInnerRef = useRef(null);
  const mainGridScrollRef = useRef(null);
  const detailTopScrollRef = useRef(null);
  const detailTopInnerRef = useRef(null);
  const detailGridScrollRef = useRef(null);

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setSDate(s);
    if (e) setEDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    setLookupError('');
    axios
      .get(`${apiBase}/api/hsn-sales-parties`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
      })
      .then((r) => setPartyList(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setLookupError(e.response?.data?.error || e.message || 'Failed to load parties'));
  }, [apiBase, compCode, compUid]);

  const tabRows = report?.sheets?.[activeTab] || [];
  const columns = tabRows.length > 0 ? Object.keys(tabRows[0]).filter((k) => !k.startsWith('_')) : [];
  const totalCols = useMemo(
    () => ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'].filter((c) => columns.includes(c)),
    [columns]
  );
  const totals = useMemo(() => {
    const out = {};
    totalCols.forEach((c) => {
      out[c] = tabRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [totalCols, tabRows]);

  const detailColumns = detailRows.length > 0 ? Object.keys(detailRows[0]).filter((k) => !k.startsWith('_')) : [];
  const detailTotalCols = ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'].filter((c) =>
    detailColumns.includes(c)
  );
  const detailTotals = useMemo(() => {
    const out = {};
    detailTotalCols.forEach((c) => {
      out[c] = detailRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [detailRows, detailTotalCols]);

  const periodLabel = `${toDisplayDate(sDate)} - ${toDisplayDate(eDate)}`;
  const pdfMetaBase = {
    companyName: compName,
    year: compYear,
    period: periodLabel,
  };

  useEffect(() => {
    if (screen !== 'main') return;
    const top = mainTopScrollRef.current;
    const topInner = mainTopInnerRef.current;
    const grid = mainGridScrollRef.current;
    if (!top || !topInner || !grid) return;

    let syncingFromTop = false;
    let syncingFromGrid = false;
    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };
    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };
    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };
    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncWidths);
      ro.observe(grid);
      const tableEl = grid.querySelector('table');
      if (tableEl) ro.observe(tableEl);
    }
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
      if (ro) ro.disconnect();
    };
  }, [screen, activeTab, tabRows.length, columns.length]);

  useEffect(() => {
    if (screen !== 'detail') return;
    const top = detailTopScrollRef.current;
    const topInner = detailTopInnerRef.current;
    const grid = detailGridScrollRef.current;
    if (!top || !topInner || !grid) return;
    let syncingFromTop = false;
    let syncingFromGrid = false;
    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };
    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };
    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };
    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
    };
  }, [screen, detailRows.length, detailColumns.length]);

  const runReport = async (e) => {
    e.preventDefault();
    const s = toOracleDate(sDate);
    const ed = toOracleDate(eDate);
    if (!s || !ed) {
      alert('Please select starting and ending date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/hsn-sales`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          m_r_u_c: mRUC,
          schedule: schedule === '' ? 0 : Number(schedule),
          code,
        },
        withCredentials: true,
        timeout: 180000,
      });
      setReport(data || { sheets: {} });
      setActiveTab('dateWise');
      setDetailRows([]);
      setDetailTitle('');
      setScreen('main');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  };

  const openSummaryDetail = async (row) => {
    if (!report?.sheets) return;
    if (activeTab === 'dateWise') {
      const keyType = String(row?.TYPE || '').trim();
      const keyDate = String(row?.BILL_DATE || '').trim();
      const keyNo = String(row?.BILL_NO || '').trim();
      const keyBType = String(row?.B_TYPE || '').trim();
      const sameVoucher = (report.sheets?.dateWise || []).filter((r) => {
        return (
          String(r?.TYPE || '').trim() === keyType &&
          String(r?.BILL_DATE || '').trim() === keyDate &&
          String(r?.BILL_NO || '').trim() === keyNo &&
          String(r?.B_TYPE || '').trim() === keyBType
        );
      });
      setDetailTitle(`Detail — ${keyType} / ${keyNo}${keyBType ? ` / ${keyBType}` : ''} / ${toDisplayDate(keyDate)}`);
      setDetailRows(sameVoucher);
      setScreen('detail');
      return;
    }
    try {
      setDetailLoading(true);
      setDetailTitle(`${TAB_LABELS[activeTab]} detail — ${row?.HSN_CODE || ''} ${row?.MONTH || ''}`.trim());
      const s = toOracleDate(sDate);
      const ed = toOracleDate(eDate);
      const { data } = await axios.get(`${apiBase}/api/hsn-sales-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          m_r_u_c: mRUC,
          schedule: schedule === '' ? 0 : Number(schedule),
          code,
          tab: activeTab,
          month: row?._MONTH_KEY || row?.MONTH_KEY || '',
          hsn_code: row?.HSN_CODE || '',
          tax_rate: row?.TAX_RATE ?? 0,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setScreen('detail');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load detail');
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const exportMainExcel = () => {
    if (!report?.sheets) return;
    const sheets = Object.entries(report.sheets).map(([name, data]) => ({ name: TAB_LABELS[name] || name, data }));
    downloadExcelWorkbook(sheets, `${compName}_HsnSales`);
  };

  const exportMainPdf = () => {
    const rows = tabRows || [];
    generatePDF(
      'hsn-sales',
      { rows },
      {
        ...pdfMetaBase,
        reportTitle: 'HSN Sales',
        activeView: TAB_LABELS[activeTab] || activeTab,
      }
    ).catch((e) => alert(String(e?.message || e)));
  };

  const shareMainWa = () => {
    const rows = tabRows || [];
    sharePdfWithWhatsApp(
      'hsn-sales',
      { rows },
      {
        ...pdfMetaBase,
        reportTitle: 'HSN Sales',
        activeView: TAB_LABELS[activeTab] || activeTab,
      },
      [`HSN Sales`, compName, periodLabel, `View: ${TAB_LABELS[activeTab] || activeTab}`].join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  const exportDetailExcel = () => {
    if (!detailRows.length) return;
    downloadExcelWorkbook([{ name: 'Detail', data: detailRows }], `${compName}_HsnSales_Detail`);
  };

  const exportDetailPdf = () => {
    if (!detailRows.length) return;
    generatePDF(
      'hsn-sales',
      { rows: detailRows },
      {
        ...pdfMetaBase,
        reportTitle: 'HSN Sales Detail',
        activeView: detailTitle || 'Detail',
      }
    ).catch((e) => alert(String(e?.message || e)));
  };

  const shareDetailWa = () => {
    if (!detailRows.length) return;
    sharePdfWithWhatsApp(
      'hsn-sales',
      { rows: detailRows },
      {
        ...pdfMetaBase,
        reportTitle: 'HSN Sales Detail',
        activeView: detailTitle || 'Detail',
      },
      [`HSN Sales Detail`, compName, periodLabel, detailTitle || 'Detail'].join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  if (report?.sheets) {
    if (screen === 'detail') {
      return (
        <div className="slide slide-report slide-16">
          <div className="report-toolbar">
            <h2>HSN Sales Detail</h2>
            <div className="toolbar-actions">
              <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('main')}>
                ← Back
              </button>
              <button type="button" className="btn btn-excel" onClick={exportDetailExcel} disabled={!detailRows.length}>
                📊 Excel
              </button>
              <button type="button" className="btn btn-export" onClick={exportDetailPdf} disabled={!detailRows.length}>
                📥 PDF
              </button>
              <button type="button" className="btn btn-whatsapp" onClick={shareDetailWa} disabled={!detailRows.length}>
                💬 WhatsApp
              </button>
            </div>
          </div>
          <div className="report-info">
            <p>
              <strong>Dates</strong> {periodLabel}
            </p>
            <p>{detailTitle || 'Detail'}</p>
          </div>
          <div className="report-display table-responsive table-responsive--hsn-sales table-responsive--sale-list">
            <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={detailTopScrollRef}>
              <div className="sale-list-scroll-sync-inner" ref={detailTopInnerRef} />
            </div>
            <div ref={detailGridScrollRef}>
            <table className="report-table">
              <thead>
                <tr>{detailColumns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {detailRows.map((row, i) => (
                  <tr key={i}>
                    {detailColumns.map((c) => (
                      <td
                        key={c}
                        className={typeof row[c] === 'number' ? 'text-right' : ''}
                        style={isDateColumn(c) ? { whiteSpace: 'nowrap' } : undefined}
                      >
                        {fmtCell(c, row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="stock-sum-grand">
                  {detailColumns.map((c, i) => {
                    if (i === 0) return <td key={c}><strong>Grand total</strong></td>;
                    if (!detailTotalCols.includes(c)) return <td key={c}>—</td>;
                    return (
                      <td key={c} className="text-right">
                        <strong>{fmt(detailTotals[c])}</strong>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            </div>
            <hr className="sale-bill-print-footer-rule" />
            <div className="report-info">
              <p>
                <strong>Grand Total:</strong> {detailTotalCols.map((c) => `${c}: ${fmt(detailTotals[c] || 0)}`).join(' | ')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="slide slide-report slide-16">
        <div className="report-toolbar">
          <h2>HSN Sales</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setReport(null)}>
              ← Back
            </button>
            <button type="button" className="btn btn-excel" onClick={exportMainExcel}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-export" onClick={exportMainPdf}>
              📥 PDF
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareMainWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>
        <div className="report-sort-switch report-sort-switch--hsn-sales" role="group" aria-label="HSN Sales tabs">
          {Object.keys(TAB_LABELS).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`btn btn-secondary btn-sort-switch btn-sort-switch--hsn${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                setDetailRows([]);
                setDetailTitle('');
              }}
            >
              {TAB_LABELS[tab]} ({(report.sheets?.[tab] || []).length})
            </button>
          ))}
        </div>

        <div className="report-info">
          <p>
            <strong>Dates</strong> {periodLabel} · <strong>M_R_U_C</strong> {mRUC} ·{' '}
            <strong>Schedule</strong> {schedule || 'All'} · <strong>Party</strong> {code || 'All'}
          </p>
          <p>
            {compName} | FY {compYear}
          </p>
        </div>

        <div className="report-display table-responsive table-responsive--hsn-sales table-responsive--sale-list">
          <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={mainTopScrollRef}>
            <div className="sale-list-scroll-sync-inner" ref={mainTopInnerRef} />
          </div>
          <div ref={mainGridScrollRef}>
          <table className="report-table">
            <thead>
              <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {tabRows.map((row, i) => (
                <tr
                  key={i}
                  className="sale-list-row-clickable"
                  onClick={() => openSummaryDetail(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openSummaryDetail(row);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {columns.map((c) => (
                    <td
                      key={c}
                      className={typeof row[c] === 'number' ? 'text-right' : ''}
                      style={isDateColumn(c) ? { whiteSpace: 'nowrap' } : undefined}
                    >
                      {fmtCell(c, row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {tabRows.length > 0 ? (
                <tr className="stock-sum-grand">
                  {columns.map((c, i) => {
                    if (i === 0) return <td key={c}><strong>Grand total</strong></td>;
                    if (!totalCols.includes(c)) return <td key={c}>—</td>;
                    return (
                      <td key={c} className="text-right">
                        <strong>{fmt(totals[c])}</strong>
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
          <hr className="sale-bill-print-footer-rule" />
          <div className="report-info">
            <p>
              <strong>Grand Total:</strong> {totalCols.map((c) => `${c}: ${fmt(totals[c] || 0)}`).join(' | ')}
            </p>
          </div>
          {tabRows.length === 0 ? <p className="stock-sum-empty">No rows in this tab.</p> : null}
        </div>

        <div className="report-info">
          <p>
            Click any row to open detail screen.
          </p>
        </div>

        {detailLoading ? <p className="stock-sum-empty">Loading detail...</p> : null}
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setReport(null)}>
            ← Modify
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Start Over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-16">
      <h2>HSN Sales</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      {lookupError ? <div className="form-api-error">{lookupError}</div> : null}
      {error ? <div className="form-api-error">{error}</div> : null}

      <form onSubmit={runReport} className="report-form">
        <div className="form-group">
          <label>Starting Date</label>
          <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Ending Date</label>
          <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>(R)egd / (U)nregd / (C)omplete</label>
          <input
            className="form-input"
            maxLength={1}
            value={mRUC}
            onChange={(e) => setMRUC(String(e.target.value || 'C').toUpperCase().slice(0, 1))}
          />
        </div>
        <div className="form-group">
          <label>Specific Schedule</label>
          <input
            type="number"
            className="form-input"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 for all"
          />
        </div>
        <div className="form-group">
          <label>Specific Party</label>
          <input className="form-input" list="hsn-sales-parties" value={code} onChange={(e) => setCode(e.target.value)} />
          <datalist id="hsn-sales-parties">
            {partyList.map((p) => (
              <option key={String(p.CODE ?? p.code)} value={String(p.CODE ?? p.code)}>
                {`${String(p.NAME ?? p.name ?? '')} ${String(p.CITY ?? p.city ?? '')}`.trim()}
              </option>
            ))}
          </datalist>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run HsnSales'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Start Over
          </button>
        </div>
      </form>
    </div>
  );
}
