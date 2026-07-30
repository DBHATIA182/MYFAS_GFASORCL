import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import ReportToolbarActions from '../components/ReportToolbarActions';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field loaner-list-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function fmtAmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mapRow(r, idx) {
  return {
    _id: `${r.CODE ?? r.code}-${idx}`,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    PAN: String(r.PAN ?? r.pan ?? '').trim(),
    OP: Number(r.OP ?? r.op ?? 0),
    CR_AMT: Number(r.CR_AMT ?? r.cr_amt ?? 0),
    CR_INT: Number(r.CR_INT ?? r.cr_int ?? 0),
    TOT_CR: Number(r.TOT_CR ?? r.tot_cr ?? 0),
    DR_AMT: Number(r.DR_AMT ?? r.dr_amt ?? 0),
    DR_TDS: Number(r.DR_TDS ?? r.dr_tds ?? 0),
    TOT_DR: Number(r.TOT_DR ?? r.tot_dr ?? 0),
    CL_BAL: Number(r.CL_BAL ?? r.cl_bal ?? 0),
    ADD1: String(r.ADD1 ?? r.add1 ?? '').trim(),
    ADD2: String(r.ADD2 ?? r.add2 ?? '').trim(),
    ADD3: String(r.ADD3 ?? r.add3 ?? '').trim(),
    CITY: String(r.CITY ?? r.city ?? '').trim(),
  };
}

/** VFP DO FORM LOANER WITH 'A' — loaner party list (prg/itaxrpt.prg LOANLST, reports/loanlst.frx). */
export default function Slide88LoanerList({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [scheduleNo, setScheduleNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (fyStart) setSdt(fyStart);
    if (fyEnd) setEdt(fyEnd);
  }, [fyStart, fyEnd]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.OP += r.OP;
        acc.CR_AMT += r.CR_AMT;
        acc.CR_INT += r.CR_INT;
        acc.TOT_CR += r.TOT_CR;
        acc.DR_AMT += r.DR_AMT;
        acc.DR_TDS += r.DR_TDS;
        acc.TOT_DR += r.TOT_DR;
        acc.CL_BAL += r.CL_BAL;
        return acc;
      },
      { OP: 0, CR_AMT: 0, CR_INT: 0, TOT_CR: 0, DR_AMT: 0, DR_TDS: 0, TOT_DR: 0, CL_BAL: 0 }
    );
  }, [rows]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      reportTitle: 'Loaner List',
      period: `${toDisplayDate(sdt)} – ${toDisplayDate(edt)}`,
      scheduleLabel: scheduleNo.trim() ? scheduleNo.trim() : 'All schedules',
    }),
    [compName, compYear, sdt, edt, scheduleNo]
  );

  const excelRows = useMemo(
    () =>
      rows.map((r) => ({
        Code: r.CODE,
        Name: r.NAME,
        PAN: r.PAN,
        'Opening': r.OP,
        'Credit Amt': r.CR_AMT,
        'Credit Int': r.CR_INT,
        'Total Credit': r.TOT_CR,
        'Debit Amt': r.DR_AMT,
        'Debit TDS': r.DR_TDS,
        'Total Debit': r.TOT_DR,
        'Closing Bal': r.CL_BAL,
        Address1: r.ADD1,
        Address2: r.ADD2,
        Address3: r.ADD3,
        City: r.CITY,
      })),
    [rows]
  );

  const runReport = async () => {
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/loaner-list'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sdt),
          e_date: toOracleDate(edt),
          schedule_no: scheduleNo.trim() || '0',
        },
        reqOpts
      );
      const list = (Array.isArray(data?.rows) ? data.rows : []).map(mapRow);
      setRows(list);
      setShowReport(true);
      if (!list.length) alert('No loaner accounts found for the selected criteria.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
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
      downloadExcelRows(excelRows, 'LoanerList', `${compName || 'Company'}_LoanerList`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handlePdf = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    generatePDF('loaner-list', rows, pdfMeta).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const shareText = [
      `Loaner List — ${compName}`,
      `${compYear} | ${pdfMeta.period}`,
      `Rows: ${rows.length}`,
    ].join('\n');
    sharePdfWithWhatsApp('loaner-list', rows, pdfMeta, shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  if (showReport) {
    return (
      <div className="slide slide-88-loaner-list slide-report loaner-list-screen loaner-list-screen--report">
        <div className="loaner-list-screen__scroll">
          <div className="report-toolbar">
            <h2>Loaner List</h2>
            <ReportToolbarActions
              reportId="loaner-list"
              onBack={() => setShowReport(false)}
              onPdf={handlePdf}
              onExcel={handleExcel}
              onWhatsApp={handleWhatsApp}
              onMenu={onPrev}
            />
          </div>

          <p className="loaner-list-screen__meta">
            {toDisplayDate(sdt)} – {toDisplayDate(edt)}
            {scheduleNo.trim() ? ` · Schedule ${scheduleNo.trim()}` : ''} · {rows.length} row(s)
          </p>

          <div className="loaner-list-screen__table-wrap">
            <table className="table-report loaner-list-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>PAN</th>
                  <th className="num">Opening</th>
                  <th className="num">Credit</th>
                  <th className="num">Cr. Int</th>
                  <th className="num">Tot. Credit</th>
                  <th className="num">Debit</th>
                  <th className="num">TDS</th>
                  <th className="num">Tot. Debit</th>
                  <th className="num">Closing</th>
                  <th>City</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td>{r.PAN}</td>
                    <td className="num">{fmtAmt(r.OP)}</td>
                    <td className="num">{fmtAmt(r.CR_AMT)}</td>
                    <td className="num">{fmtAmt(r.CR_INT)}</td>
                    <td className="num">{fmtAmt(r.TOT_CR)}</td>
                    <td className="num">{fmtAmt(r.DR_AMT)}</td>
                    <td className="num">{fmtAmt(r.DR_TDS)}</td>
                    <td className="num">{fmtAmt(r.TOT_DR)}</td>
                    <td className="num">{fmtAmt(r.CL_BAL)}</td>
                    <td>{r.CITY}</td>
                  </tr>
                ))}
                {rows.length > 0 ? (
                  <tr className="loaner-list-table__total">
                    <td colSpan={3}>
                      <strong>Total</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.OP)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.CR_AMT)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.CR_INT)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.TOT_CR)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.DR_AMT)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.DR_TDS)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.TOT_DR)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.CL_BAL)}</strong>
                    </td>
                    <td />
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={12}>No rows</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-88-loaner-list loaner-list-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Loaner List</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="loaner-list" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="loaner-list-screen__panel">
        <p className="loaner-list-screen__hint">
          VFP <code>DO FORM LOANER WITH &apos;A&apos;</code> — loaner accounts (code starts with L). Optional
          schedule filter matches <code>LOANLST</code> in <code>prg/itaxrpt.prg</code>.
        </p>
        <div className="loaner-list-screen__filters inttrf-screen__header-panel">
          <Field label="Starting Date">
            <input
              type="date"
              className="inttrf-input"
              value={sdt}
              disabled={loading}
              onChange={(e) => setSdt(e.target.value)}
            />
          </Field>
          <Field label="Ending Date">
            <input
              type="date"
              className="inttrf-input"
              value={edt}
              disabled={loading}
              onChange={(e) => setEdt(e.target.value)}
            />
          </Field>
          <Field label="Specific Schedule">
            <input
              type="text"
              className="inttrf-input"
              value={scheduleNo}
              disabled={loading}
              placeholder="0 = all"
              inputMode="decimal"
              onChange={(e) => setScheduleNo(e.target.value)}
            />
          </Field>
        </div>

        <div className="loaner-list-screen__actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={runReport}>
            {loading ? 'Loading…' : 'Proceed'}
          </button>
          <button type="button" className="btn btn-excel" disabled={loading} onClick={handleExcel}>
            Excel
          </button>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            Quit
          </button>
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
