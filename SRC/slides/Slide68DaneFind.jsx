import React, { useEffect, useState } from 'react';
import axios from 'axios';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function formatNum(v, dec = 2) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(dec);
}

function mapGridRow(r, idx) {
  const billDate = toInputDateString(r.BILL_DATE ?? r.bill_date);
  return {
    _id: `${r.BILL_NO}-${r.B_TYPE}-${billDate}-${idx}`,
    BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
    BILL_DATE: billDate,
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '').trim(),
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    QNTY: formatNum(r.QNTY ?? r.qnty, 3),
    WEIGHT: formatNum(r.WEIGHT ?? r.weight, 3),
    RATE: formatNum(r.RATE ?? r.rate, 2),
    AMOUNT: formatNum(r.AMOUNT ?? r.amount, 2),
    DANE: String(r.DANE ?? r.dane ?? '').trim(),
    DANE_WGT: formatNum(r.DANE_WGT ?? r.dane_wgt, 3),
    DANE_AMT: formatNum(r.DANE_AMT ?? r.dane_amt, 2),
    BROK_PER: formatNum(r.BROK_PER ?? r.brok_per, 4),
    BROKERAGE: formatNum(r.BROKERAGE ?? r.brokerage, 2),
    TYPE: 'SL',
  };
}

/** VFP DO FORM brokchk WITH 2 — sale bills with DANE = D and non-zero dane amount. */
export default function Slide68DaneFind({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT ?? formData.s_date);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT ?? formData.e_date);

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [gridRows, setGridRows] = useState([]);

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/dane-find-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data?.permissions ?? data ?? null);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName]);

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    s_date: toOracleDate(sdt),
    e_date: toOracleDate(edt),
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/dane-find-proceed'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No sale bills found with DANE = D and non-zero dane amount.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  const handleExcel = () => {
    if (!gridRows.length) {
      alert('No data to export. Click Proceed first.');
      return;
    }
    downloadExcelRows(
      gridRows.map((r) => ({
        'Bill No': r.BILL_NO,
        'Bill Date': formatLedgerDateDisplay(r.BILL_DATE),
        'B.Type': r.B_TYPE,
        Code: r.CODE,
        Name: r.NAME,
        Qty: r.QNTY,
        Weight: r.WEIGHT,
        Rate: r.RATE,
        Amount: r.AMOUNT,
        Dane: r.DANE,
        'Dane Wgt': r.DANE_WGT,
        'Dane Amt': r.DANE_AMT,
        'Brok %': r.BROK_PER,
        Brokerage: r.BROKERAGE,
      })),
      'DaneFind',
      `${compName || 'Company'}_DaneFind`
    );
  };

  const openBill = (row) => {
    if (!row?.BILL_NO || !row.BILL_DATE) return;
    const oracleDt = toOracleDate(row.BILL_DATE);
    if (!oracleDt) return;
    setBillPrintParams({
      type: 'SL',
      billNo: String(row.BILL_NO),
      bType: String(row.B_TYPE ?? '').trim(),
      oracleDt,
      printGrossDane: 'Y',
      printPacking: 'N',
      label: `Sale bill — SL / ${row.BILL_NO} / ${toDisplayDate(row.BILL_DATE)}`,
    });
    setBillPrintOpen(true);
  };

  if (loading) {
    return (
      <div className="slide slide-68-dane-find dane-find-screen inttrf-screen">
        <p className="loading-msg">Loading Dane Find…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen;

  return (
    <div className="slide slide-68-dane-find dane-find-screen inttrf-screen detail-mast-screen account-master-screen">
      <SaleBillPrintModal
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

      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Dane Find</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="dane-find" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="inttrf-screen__header-panel dane-find-screen__head">
        <Field label="Starting Date *">
          <input
            type="date"
            className="inttrf-input"
            value={sdt}
            disabled={blocked}
            onChange={(e) => {
              setSdt(e.target.value);
              setGridRows([]);
            }}
          />
        </Field>
        <Field label="Ending Date *">
          <input
            type="date"
            className="inttrf-input"
            value={edt}
            disabled={blocked}
            onChange={(e) => {
              setEdt(e.target.value);
              setGridRows([]);
            }}
          />
        </Field>
        <p className="dane-find-screen__hint">
          VFP brokchk WITH 2: sale bills (TYPE SL) with DANE = D and DANE_AMT ≠ 0. Click a row to open the sale bill
          print view.
        </p>
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid dane-find-screen__grid">
            <thead>
              <tr>
                <th>Bill No</th>
                <th>Bill Date</th>
                <th>B.Type</th>
                <th>Code</th>
                <th>Name</th>
                <th>Qty</th>
                <th>Wt</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Dane</th>
                <th>D.Wgt</th>
                <th>D.Amt</th>
                <th>Brok%</th>
                <th>Brok.Amt</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="inttrf-screen__grid-empty">
                    Set date range and click Proceed.
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr
                    key={r._id}
                    className="dane-find-row-clickable"
                    onClick={() => openBill(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openBill(r);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td>{r.BILL_NO}</td>
                    <td>{formatLedgerDateDisplay(r.BILL_DATE)}</td>
                    <td>{r.B_TYPE}</td>
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td className="num">{r.QNTY}</td>
                    <td className="num">{r.WEIGHT}</td>
                    <td className="num">{r.RATE}</td>
                    <td className="num">{r.AMOUNT}</td>
                    <td>{r.DANE}</td>
                    <td className="num">{r.DANE_WGT}</td>
                    <td className="num">{r.DANE_AMT}</td>
                    <td className="num">{r.BROK_PER}</td>
                    <td className="num">{r.BROKERAGE}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel">
          <div className="inttrf-screen__footer-toolbar">
            <div className="inttrf-screen__footer-left">
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
                Quit
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleExcel} disabled={!gridRows.length}>
                Excel
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary inttrf-btn dane-find-screen__proceed"
              onClick={handleProceed}
              disabled={proceeding || blocked || !sdt || !edt}
            >
              {proceeding ? 'Loading…' : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
