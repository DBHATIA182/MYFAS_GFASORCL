import React, { useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 600000 };

const ENTRY_TYPES = [
  { id: '', label: 'All' },
  { id: 'N', label: 'N — New' },
  { id: 'E', label: 'E — Edit' },
  { id: 'D', label: 'D — Delete' },
  { id: 'O', label: 'O — Opening (N, vr date ≠ entry date)' },
];

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field audtrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function fmtAmt(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function mapGridRow(r, idx) {
  return {
    _id: `${idx}-${r.MOD_DEL_NO}-${r.VR_NO}-${r.VR_TYPE}-${r.TYPE}`,
    MOD_DEL_ENT_DATE: String(r.MOD_DEL_ENT_DATE ?? r.mod_del_ent_date ?? '').trim(),
    MOD_DEL_ENT_TIME: String(r.MOD_DEL_ENT_TIME ?? r.mod_del_ent_time ?? '').trim(),
    MOD_DEL_TYPE: String(r.MOD_DEL_TYPE ?? r.mod_del_type ?? '').trim(),
    MOD_DEL_USER_NAME: String(r.MOD_DEL_USER_NAME ?? r.mod_del_user_name ?? '').trim(),
    VR_DATE: String(r.VR_DATE ?? r.vr_date ?? '').trim(),
    VR_NO: r.VR_NO ?? r.vr_no ?? '',
    VR_TYPE: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
    TYPE: String(r.TYPE ?? r.type ?? '').trim(),
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    DR_AMT: fmtAmt(r.DR_AMT ?? r.dr_amt),
    CR_AMT: fmtAmt(r.CR_AMT ?? r.cr_amt),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
    ITEM_CODE: String(r.ITEM_CODE ?? r.item_code ?? '').trim(),
    ITEM_NAME: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    LOT: String(r.LOT ?? r.lot ?? '').trim(),
    QNTY: r.QNTY ?? r.qnty ?? '',
    WEIGHT: r.WEIGHT ?? r.weight ?? '',
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    ENT_DATE: String(r.ENT_DATE ?? r.ent_date ?? '').trim(),
    MOD_DEL_REASON: String(r.MOD_DEL_REASON ?? r.mod_del_reason ?? '').trim(),
  };
}

/** VFP DO FORM audit_report — AUDIT_LEDGER trail listing. */
export default function Slide76AuditTrailReport({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT ?? formData.s_date);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT ?? formData.e_date);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [vsdt, setVsdt] = useState(fyStart);
  const [vedt, setVedt] = useState(fyEnd);
  const [svno, setSvno] = useState('0');
  const [evno, setEvno] = useState('999999');
  const [mcode, setMcode] = useState('');
  const [mname, setMname] = useState('');
  const [vrType, setVrType] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userOptions, setUserOptions] = useState([]);
  const [entryType, setEntryType] = useState('');
  const [gridRows, setGridRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    let cancelled = false;
    const q = userSearch.trim();
    if (q.length < 1) {
      setUserOptions([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/user-report-users'), {
          params: { q },
          ...reqOpts,
        });
        if (!cancelled) setUserOptions(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setUserOptions([]);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [apiBase, userSearch]);

  const resolveAccount = async () => {
    const code = String(mcode || '').trim();
    if (!code) {
      setMname('');
      return true;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/audit-trail-account-lookup'), {
        params: { comp_code: compCode, comp_uid: compUid, code },
        ...reqOpts,
      });
      if (!data?.ok) {
        alert('!!! Invalid A/C Code !!!');
        setMcode('');
        setMname('');
        return false;
      }
      setMname(String(data?.NAME ?? data?.name ?? '').trim());
      return true;
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Account lookup failed');
      return false;
    }
  };

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    s_date: toOracleDate(sdt),
    e_date: toOracleDate(edt),
    v_s_date: toOracleDate(vsdt),
    v_e_date: toOracleDate(vedt),
    svno: Number(svno) || 0,
    evno: Number(evno) || 999999,
    mcode: String(mcode || '').trim(),
    vr_type: String(vrType || '').trim().toUpperCase(),
    user_name: String(targetUser || '').trim(),
    entry_type: String(entryType || '').trim().toUpperCase(),
  });

  const handleProceed = async () => {
    if (!sdt || !edt || !vsdt || !vedt) {
      alert('Entry dates and voucher dates are required.');
      return;
    }
    if (!(await resolveAccount())) return;
    setLoading(true);
    setErr('');
    setGridRows([]);
    setTotalRows(0);
    setSummary('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/audit-trail-report-data'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      setTotalRows(Number(data?.total ?? rows.length) || 0);
      setSummary(String(data?.message ?? '').trim());
      if (!rows.length) alert(data?.message || 'No audit trail rows found.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExcel = () => {
    if (!gridRows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    downloadExcelRows(
      gridRows.map((r) => ({
        'Mod/Del Date': formatLedgerDateDisplay(r.MOD_DEL_ENT_DATE) || r.MOD_DEL_ENT_DATE,
        'Mod/Del Time': r.MOD_DEL_ENT_TIME,
        Type: r.MOD_DEL_TYPE,
        'Mod/Del User': r.MOD_DEL_USER_NAME,
        'Vr Date': formatLedgerDateDisplay(r.VR_DATE) || r.VR_DATE,
        'Vr No': r.VR_NO,
        'Vr Type': r.VR_TYPE,
        Sub: r.TYPE,
        Code: r.CODE,
        Name: r.NAME,
        Dr: r.DR_AMT,
        Cr: r.CR_AMT,
        Detail: r.DETAIL,
        Item: r.ITEM_CODE,
        'Item Name': r.ITEM_NAME,
        Lot: r.LOT,
        Qty: r.QNTY,
        Weight: r.WEIGHT,
        User: r.USER_NAME,
        'Ent Date': formatLedgerDateDisplay(r.ENT_DATE) || r.ENT_DATE,
        Reason: r.MOD_DEL_REASON,
      })),
      'AuditTrailReport'
    );
  };

  const pickUser = (row) => {
    setTargetUser(String(row.USER_NAME ?? row.user_name ?? '').trim());
    setUserSearch('');
    setUserOptions([]);
  };

  return (
    <div className="slide slide-76-audtrf audtrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Audit Trail Reports</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="audit-trail-reports" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="audtrf-screen__panel">
        <p className="audtrf-screen__hint">
          Lists AUDIT_LEDGER changes (VFP <code>DO FORM audit_report</code>). Set entry and voucher filters, then Proceed.
        </p>
        <div className="audtrf-screen__filters inttrf-screen__header-panel">
          <Field label="Starting Entry Date *">
            <input type="date" className="inttrf-input" value={sdt} disabled={loading} onChange={(e) => setSdt(e.target.value)} />
          </Field>
          <Field label="Ending Entry Date *">
            <input type="date" className="inttrf-input" value={edt} disabled={loading} onChange={(e) => setEdt(e.target.value)} />
          </Field>
          <Field label="Starting Voucher Date *">
            <input type="date" className="inttrf-input" value={vsdt} disabled={loading} onChange={(e) => setVsdt(e.target.value)} />
          </Field>
          <Field label="Ending Voucher Date *">
            <input type="date" className="inttrf-input" value={vedt} disabled={loading} onChange={(e) => setVedt(e.target.value)} />
          </Field>
          <Field label="Starting Voucher No." className="audtrf-field--vno">
            <input type="number" className="inttrf-input" value={svno} disabled={loading} onChange={(e) => setSvno(e.target.value)} />
          </Field>
          <Field label="Ending Voucher No." className="audtrf-field--vno">
            <input type="number" className="inttrf-input" value={evno} disabled={loading} onChange={(e) => setEvno(e.target.value)} />
          </Field>
          <Field label="A/c Code">
            <input
              type="text"
              className="inttrf-input"
              value={mcode}
              disabled={loading}
              onChange={(e) => {
                setMcode(e.target.value.toUpperCase());
                setMname('');
              }}
              onBlur={() => {
                void resolveAccount();
              }}
            />
          </Field>
          <Field label="A/c Name">
            <input type="text" className="inttrf-input" value={mname} readOnly tabIndex={-1} />
          </Field>
          <Field label="Voucher Type">
            <input
              type="text"
              className="inttrf-input"
              value={vrType}
              disabled={loading}
              maxLength={6}
              onChange={(e) => setVrType(e.target.value.toUpperCase())}
              placeholder="Blank = all"
            />
          </Field>
          <Field label="Entry Type (N/E/D/O)">
            <select className="inttrf-input" value={entryType} disabled={loading} onChange={(e) => setEntryType(e.target.value)}>
              {ENTRY_TYPES.map((t) => (
                <option key={t.id || 'all'} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Specific User" className="audtrf-field--user">
            <input
              type="text"
              className="inttrf-input"
              value={targetUser}
              disabled={loading}
              placeholder="Blank = all"
              onChange={(e) => {
                setTargetUser(e.target.value);
                setUserSearch(e.target.value);
              }}
            />
            {userOptions.length > 0 && userSearch.trim() ? (
              <ul className="audtrf-screen__user-list" role="listbox">
                {userOptions.slice(0, 12).map((u) => (
                  <li key={`${u.USER_NO}-${u.USER_NAME}`}>
                    <button type="button" className="audtrf-screen__user-pick" onMouseDown={() => pickUser(u)}>
                      {u.USER_NAME}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>
        </div>
        {summary ? <p className="audtrf-screen__summary">{summary}</p> : null}
        {totalRows > 0 ? (
          <p className="audtrf-screen__count">
            <strong>{totalRows}</strong> audit row(s)
          </p>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid audtrf-screen__grid">
            <thead>
              <tr>
                <th>Mod/Del Date</th>
                <th>Time</th>
                <th>Tp</th>
                <th>Mod User</th>
                <th>Vr Date</th>
                <th>Vr No</th>
                <th>Vr Tp</th>
                <th>Sub</th>
                <th>Code</th>
                <th>Name</th>
                <th>Dr</th>
                <th>Cr</th>
                <th>Detail</th>
                <th>Item</th>
                <th>Lot</th>
                <th>User</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={17} className="inttrf-screen__grid-empty">
                    {loading ? 'Loading…' : 'Set filters and tap Proceed.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id}>
                    <td>{formatLedgerDateDisplay(r.MOD_DEL_ENT_DATE) || r.MOD_DEL_ENT_DATE}</td>
                    <td>{r.MOD_DEL_ENT_TIME || '—'}</td>
                    <td>{r.MOD_DEL_TYPE || '—'}</td>
                    <td>{r.MOD_DEL_USER_NAME || '—'}</td>
                    <td>{formatLedgerDateDisplay(r.VR_DATE) || r.VR_DATE}</td>
                    <td>{r.VR_NO}</td>
                    <td>{r.VR_TYPE}</td>
                    <td>{r.TYPE}</td>
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td className="audtrf-num">{r.DR_AMT}</td>
                    <td className="audtrf-num">{r.CR_AMT}</td>
                    <td>{r.DETAIL || '—'}</td>
                    <td title={r.ITEM_NAME}>{r.ITEM_CODE || '—'}</td>
                    <td>{r.LOT || '—'}</td>
                    <td>{r.USER_NAME || '—'}</td>
                    <td>{r.MOD_DEL_REASON || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel audtrf-screen__footer">
          <div className="inttrf-screen__footer-toolbar audtrf-screen__footer-toolbar">
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev} disabled={loading}>
              Quit
            </button>
            <div className="audtrf-screen__footer-actions">
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleExcel} disabled={loading || !gridRows.length}>
                Excel
              </button>
              <button
                type="button"
                className="btn btn-primary inttrf-btn"
                onClick={handleProceed}
                disabled={loading || !sdt || !edt || !vsdt || !vedt}
              >
                {loading ? 'Loading…' : 'Proceed'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
