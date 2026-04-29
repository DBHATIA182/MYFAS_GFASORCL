import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { downloadExcelWorkbook } from '../utils/excelExport';
import ReportTable from '../components/ReportTable';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSch(v) {
  const n = num(v);
  if (!n) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmtAbs(v) {
  const n = Math.abs(num(v));
  return n ? fmt(n) : '';
}

export default function Slide19BalanceSheet({ apiBase, formData = {}, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [edt, setEdt] = useState('');
  const [schedule, setSchedule] = useState('12.10');
  const [code, setCode] = useState('');
  const [mcb, setMcb] = useState('C');
  const [mwyn, setMwyn] = useState('N');
  const [catCodeYn, setCatCodeYn] = useState('N');
  const [mShortPick, setMShortPick] = useState('N');
  const [mfyn, setMfyn] = useState('A');
  const [accountOptions, setAccountOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bsData, setBsData] = useState(null);
  const [screen, setScreen] = useState('bs');
  const [scheduleAccounts, setScheduleAccounts] = useState([]);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerTitle, setLedgerTitle] = useState('');

  const normalizeSchedule = (raw) => {
    const txt = String(raw ?? '').replace(/[^\d.]/g, '');
    if (!txt) return '';
    const parts = txt.split('.');
    const intPart = (parts[0] || '').slice(0, 2);
    const decPartRaw = parts.length > 1 ? parts.slice(1).join('') : '';
    if (decPartRaw.length === 0) return intPart;
    return `${intPart}.${decPartRaw.slice(0, 2)}`;
  };

  useEffect(() => {
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (e) setEdt(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    const scheduleNorm = normalizeSchedule(schedule);
    if (!compCode || !compUid || !/^\d{1,2}\.\d{2}$/.test(scheduleNorm)) {
      setAccountOptions([]);
      return;
    }
    let ignore = false;
    axios
      .get(`${apiBase}/api/trading-ac-accounts`, {
        params: { comp_code: compCode, comp_uid: compUid, schedule: scheduleNorm },
        withCredentials: true,
        timeout: 60000,
      })
      .then(({ data }) => {
        if (ignore) return;
        setAccountOptions(Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch(() => {
        if (!ignore) setAccountOptions([]);
      });
    return () => {
      ignore = true;
    };
  }, [apiBase, compCode, compUid, schedule]);

  const runReport = async (e) => {
    e.preventDefault();
    const scheduleNorm = normalizeSchedule(schedule);
    if (!/^\d{1,2}\.\d{2}$/.test(scheduleNorm)) {
      alert('Trading schedule must be in 99.99 format (e.g. 12.10).');
      return;
    }
    const edtOracle = toOracleDate(edt);
    if (!edtOracle) {
      alert('Please select as-on date.');
      return;
    }
    setLoading(true);
    setError('');
    setBsData(null);
    try {
      const { data: tData } = await axios.get(`${apiBase}/api/trading-ac`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          schedule: scheduleNorm,
          code,
          edt: edtOracle,
          mcb,
          mwyn,
          cat_code_yn: catCodeYn,
          m_short_pick: mShortPick,
          mfyn,
          manual_confirmed: 'Y',
        },
        withCredentials: true,
        timeout: 180000,
      });
      if (tData?.requiresManualEntry) {
        alert('Closing stock must be entered in Trading A/C (manual mode) before running Balance Sheet.');
        return;
      }
      const tRows = Array.isArray(tData?.rows) ? tData.rows : [];
      const stockRows = tRows.filter((r) => String(r?.CODE ?? '').trim() !== '000000');
      const sumGprofit = stockRows.reduce((s, r) => s + num(r?.GPROFIT), 0);
      const sumGloss = stockRows.reduce((s, r) => s + num(r?.GLOSS), 0);

      const { data: bData } = await axios.get(`${apiBase}/api/balance-sheet`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          edt: edtOracle,
          sum_gprofit: String(sumGprofit),
          sum_gloss: String(sumGloss),
        },
        withCredentials: true,
        timeout: 120000,
      });
      setBsData(bData);
      setScreen('bs');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run Balance Sheet');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    if (!bsData?.rows) return;
    downloadExcelWorkbook([{ name: 'BalanceSheet', data: bsData.rows }], `${compName}_BalanceSheet_${compYear}`, { autoOpen: true });
  };

  const downloadPdf = () => {
    if (!bsData?.rows) return Promise.resolve();
    return generatePDF('balance-sheet', bsData.rows, {
      companyName: compName,
      year: compYear,
      period: `As on ${toDisplayDate(edt)}`,
      reportTitle: `Balance Sheet As At ${toDisplayDate(edt)}`,
      totals: bsData.totals || {},
    });
  };

  const shareOnWhatsApp = () => {
    if (!bsData?.rows) return Promise.resolve();
    return sharePdfWithWhatsApp(
      'balance-sheet',
      bsData.rows,
      {
        companyName: compName,
        year: compYear,
        period: `As on ${toDisplayDate(edt)}`,
        reportTitle: `Balance Sheet As At ${toDisplayDate(edt)}`,
        totals: bsData.totals || {},
      },
      [compName, 'Balance Sheet', `As on ${toDisplayDate(edt)}`, `FY ${compYear}`].filter(Boolean).join('\n')
    );
  };

  const openScheduleAccounts = async (schNo, side) => {
    const sch = num(schNo);
    if (!sch || sch % 1 === 0) return;
    const edtOracle = toOracleDate(edt);
    if (!edtOracle) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/balance-sheet-schedule-accounts`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          edt: edtOracle,
          sch_no: sch,
        },
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (!rows.length) {
        alert('No accounts found under this schedule.');
        return;
      }
      setScheduleAccounts(rows);
      setScheduleTitle(`${sch.toFixed(2)} (${side})`);
      setScreen('accounts');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load schedule accounts');
    } finally {
      setLoading(false);
    }
  };

  const openLedgerForAccount = async (account) => {
    const code = String(account?.CODE || '').trim();
    if (!code) return;
    const sYmd = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const eYmd = toInputDateString(edt);
    if (!sYmd || !eYmd) {
      alert('Financial year dates are missing.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/ledger`, {
        params: {
          comp_code: compCode,
          code,
          s_date: toOracleDate(sYmd),
          e_date: toOracleDate(eYmd),
          comp_uid: compUid,
          voucher_wise_total: 'N',
        },
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        alert('No ledger transactions found.');
        return;
      }
      setLedgerRows(rows);
      setLedgerTitle(`${String(account?.NAME || '').trim()} (${code})`);
      setScreen('ledger');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  const sortBsSide = (arr, schKey, lvlKey) =>
    (arr || []).sort((a, b) => {
      const sa = num(a?.[schKey]);
      const sb = num(b?.[schKey]);
      const ma = Math.trunc(sa);
      const mb = Math.trunc(sb);
      if (ma !== mb) return ma - mb;
      const la = num(a?.[lvlKey]) === 1 ? 0 : 1;
      const lb = num(b?.[lvlKey]) === 1 ? 0 : 1;
      if (la !== lb) return la - lb;
      return sa - sb;
    });

  if (screen === 'ledger') {
    return (
      <div className="slide slide-report slide-19">
        <div className="report-toolbar">
          <h2>Ledger Report</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('accounts')}>
              ← Back to Accounts
            </button>
          </div>
        </div>
        <div className="report-info">
          <p><strong>{ledgerTitle}</strong></p>
          <p>{compName} | FY {compYear} | {toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT))} - {toDisplayDate(edt)}</p>
        </div>
        <div className="report-display">
          <ReportTable data={ledgerRows} type="ledger" />
        </div>
      </div>
    );
  }

  if (screen === 'accounts') {
    const totalDr = scheduleAccounts.reduce((s, r) => s + num(r.DR_AMT), 0);
    const totalCr = scheduleAccounts.reduce((s, r) => s + num(r.CR_AMT), 0);
    return (
      <div className="slide slide-report slide-19">
        <div className="report-toolbar">
          <h2>Schedule Accounts</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('bs')}>
              ← Back to Balance Sheet
            </button>
          </div>
        </div>
        <div className="report-info">
          <p><strong>Schedule:</strong> {scheduleTitle}</p>
          <p>{compName} | FY {compYear} | As on {toDisplayDate(edt)}</p>
        </div>
        <div className="report-display table-responsive">
          <table className="report-table bs-accounts-table">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '50%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '19%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-left">Code</th>
                <th className="text-left">Account</th>
                <th className="text-right">Dr.Amount</th>
                <th className="text-right">Cr.Amount</th>
              </tr>
            </thead>
            <tbody>
              {scheduleAccounts.map((r, i) => (
                <tr key={`${r.CODE}_${i}`} className="sale-list-row-clickable" onClick={() => openLedgerForAccount(r)}>
                  <td className="text-left">{r.CODE}</td>
                  <td className="text-left">{r.NAME}</td>
                  <td className="text-right">{num(r.DR_AMT) ? fmt(r.DR_AMT) : ''}</td>
                  <td className="text-right">{num(r.CR_AMT) ? fmt(r.CR_AMT) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="stock-sum-grand">
                <td colSpan={2} className="text-left"><strong>Grand Total</strong></td>
                <td className="text-right"><strong>{fmt(totalDr)}</strong></td>
                <td className="text-right"><strong>{fmt(totalCr)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  if (bsData?.ok) {
    const rawRows = Array.isArray(bsData.rows) ? bsData.rows : [];
    const left = rawRows
      .map((r) => ({
        L_SCH_NO: r.L_SCH_NO,
        L_DETAIL: r.L_DETAIL,
        L_AMOUNT: r.L_AMOUNT,
        CR_AMT: r.CR_AMT,
        L_LEVEL: r.L_LEVEL,
      }))
      .filter((r) => String(r.L_DETAIL || '').trim() !== '' || num(r.L_SCH_NO) !== 0 || num(r.L_AMOUNT) !== 0 || num(r.CR_AMT) !== 0);
    const right = rawRows
      .map((r) => ({
        A_SCH_NO: r.A_SCH_NO,
        A_DETAIL: r.A_DETAIL,
        A_AMOUNT: r.A_AMOUNT,
        DR_AMT: r.DR_AMT,
        A_LEVEL: r.A_LEVEL,
      }))
      .filter((r) => String(r.A_DETAIL || '').trim() !== '' || num(r.A_SCH_NO) !== 0 || num(r.A_AMOUNT) !== 0 || num(r.DR_AMT) !== 0);

    sortBsSide(left, 'L_SCH_NO', 'L_LEVEL');
    sortBsSide(right, 'A_SCH_NO', 'A_LEVEL');

    const rows = [];
    const rowCount = Math.max(left.length, right.length);
    for (let i = 0; i < rowCount; i += 1) {
      rows.push({
        ...(left[i] || {}),
        ...(right[i] || {}),
      });
    }
    const totals = bsData.totals || {};
    return (
      <div className="slide slide-report slide-19">
        <div className="report-toolbar">
          <h2>Balance Sheet</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setBsData(null)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={() => downloadPdf().catch((e) => alert(e?.message || String(e)))}>
              Pdf
            </button>
            <button type="button" className="btn btn-excel" onClick={exportExcel}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={() => shareOnWhatsApp().catch((e) => alert(e?.message || String(e)))}>
              WhatsApp
            </button>
          </div>
        </div>

        <div className="report-display table-responsive">
          <table className="pl-pl-table bs-table bs-table--plain">
            <thead>
              <tr>
                <th colSpan={4} className="bs-title-cell">
                  <div className="bs-head-company">{compName}</div>
                  <div className="bs-head-title">BALANCE SHEET AS AT : {toDisplayDate(edt)}</div>
                  <div className="bs-head-fy">Financial year {compYear}</div>
                </th>
              </tr>
              <tr className="pl-pl-thead-row">
                <th className="pl-pl-part">LIABILITIES</th>
                <th className="pl-pl-amt">AMOUNT</th>
                <th className="pl-pl-part">ASSETS</th>
                <th className="pl-pl-amt">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`${num(r.L_LEVEL) === 1 || num(r.A_LEVEL) === 1 ? 'pl-pl-sch-header' : 'pl-pl-line'}`}>
                  <td
                    className={`pl-pl-particular ${num(r.L_LEVEL) === 1 && num(r.L_SCH_NO) >= 1 && num(r.L_SCH_NO) <= 11 ? 'bs-main-total' : ''} ${num(r.L_LEVEL) === 2 ? 'sale-list-row-clickable bs-drillable' : ''}`}
                    onClick={() => {
                      if (num(r.L_LEVEL) === 2) openScheduleAccounts(r.L_SCH_NO, 'Liabilities');
                    }}
                    title={num(r.L_LEVEL) === 2 ? 'Open accounts under this schedule' : ''}
                  >
                    {`${fmtSch(r.L_SCH_NO)} ${String(r.L_DETAIL || '').trim()}`.trim()}
                  </td>
                  <td className={`pl-pl-amt pl-amt text-right ${num(r.L_LEVEL) === 1 && num(r.L_SCH_NO) >= 1 && num(r.L_SCH_NO) <= 11 ? 'bs-main-total' : ''}`}>
                    {num(r.L_LEVEL) === 1 ? fmtAmtAbs(r.CR_AMT) : fmtAmtAbs(r.L_AMOUNT)}
                  </td>
                  <td
                    className={`pl-pl-particular ${num(r.A_LEVEL) === 1 && num(r.A_SCH_NO) >= 1 && num(r.A_SCH_NO) <= 11 ? 'bs-main-total' : ''} ${num(r.A_LEVEL) === 2 ? 'sale-list-row-clickable bs-drillable' : ''}`}
                    onClick={() => {
                      if (num(r.A_LEVEL) === 2) openScheduleAccounts(r.A_SCH_NO, 'Assets');
                    }}
                    title={num(r.A_LEVEL) === 2 ? 'Open accounts under this schedule' : ''}
                  >
                    {`${fmtSch(r.A_SCH_NO)} ${String(r.A_DETAIL || '').trim()}`.trim()}
                  </td>
                  <td className={`pl-pl-amt pl-amt text-right ${num(r.A_LEVEL) === 1 && num(r.A_SCH_NO) >= 1 && num(r.A_SCH_NO) <= 11 ? 'bs-main-total' : ''}`}>
                    {num(r.A_LEVEL) === 1 ? fmtAmtAbs(r.DR_AMT) : fmtAmtAbs(r.A_AMOUNT)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="pl-pl-foot-grand">
                <td className="pl-pl-particular">TOTAL</td>
                <td className="pl-pl-amt pl-amt text-right">
                  <strong>{fmt(totals.liabilitiesTotal)}</strong>
                </td>
                <td className="pl-pl-particular">TOTAL</td>
                <td className="pl-pl-amt pl-amt text-right">
                  <strong>{fmt(totals.assetsTotal)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-report slide-19">
      <h2>Balance Sheet</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      {error ? <div className="form-api-error">{error}</div> : null}

      <form onSubmit={runReport} className="report-form report-form--trading">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group trading-form-row">
          <label>Trading schedule</label>
          <span className="trading-form-colon">:</span>
          <input
            className="form-input"
            value={schedule}
            onChange={(e) => setSchedule(normalizeSchedule(e.target.value))}
            onBlur={() => {
              const n = normalizeSchedule(schedule);
              if (/^\d{1,2}$/.test(n)) setSchedule(`${n}.00`);
            }}
            placeholder="12.10"
            maxLength={5}
          />
        </div>
        <div className="form-group trading-form-row">
          <label>Specific Trading A/c</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={code} onChange={(e) => setCode(String(e.target.value || '').trim())}>
            <option value="">All</option>
            {accountOptions.map((r) => (
              <option key={String(r.CODE || '').trim()} value={String(r.CODE || '').trim()}>
                {String(r.NAME || '').trim()} [{String(r.CODE || '').trim()}]
              </option>
            ))}
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>As on (ending date)</label>
          <span className="trading-form-colon">:</span>
          <input type="date" className="form-input" value={edt} onChange={(e) => setEdt(e.target.value)} required />
        </div>
        <div className="form-group trading-form-row">
          <label>(C)halan/(B)ikri Wgt</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mcb} onChange={(e) => setMcb(String(e.target.value || 'C').toUpperCase())}>
            <option value="C">C</option>
            <option value="B">B</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Milling Wgt (Y/N)</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mwyn} onChange={(e) => setMwyn(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Cat.Wise (Y/N)</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={catCodeYn} onChange={(e) => setCatCodeYn(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Pick Shortage Y/N</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mShortPick} onChange={(e) => setMShortPick(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Cl.Stock Manual/Auto</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mfyn} onChange={(e) => setMfyn(String(e.target.value || 'A').toUpperCase())}>
            <option value="A">A</option>
            <option value="M">M</option>
          </select>
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}
