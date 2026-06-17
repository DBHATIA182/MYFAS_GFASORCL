import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 600000 };

const MODES = [
  { id: 'add', label: 'Add', vfp: 'DO FORM userrpt WITH 2' },
  { id: 'edit', label: 'Edit', vfp: 'DO FORM userrpt WITH 1' },
  { id: 'delete', label: 'Delete', vfp: 'DO FORM userrpt WITH 3' },
];

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field usrrpt-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function mapGridRow(r, idx) {
  return {
    _id: `${idx}-${r.MODULE}-${r.REF}`,
    MODULE: String(r.MODULE ?? r.module ?? '').trim(),
    ENT_DATE: String(r.ENT_DATE ?? r.ent_date ?? '').trim(),
    ENT_TIME: String(r.ENT_TIME ?? r.ent_time ?? '').trim(),
    REF: String(r.REF ?? r.ref ?? '').trim(),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    COMPUTER_NAME: String(r.COMPUTER_NAME ?? r.computer_name ?? '').trim(),
  };
}

/** VFP DO FORM userrpt — user activity report (add / edit / delete). */
export default function Slide75UserReport({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT ?? formData.s_date);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT ?? formData.e_date);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('add');
  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [targetUser, setTargetUser] = useState(String(userName || '').trim());
  const [userNo, setUserNo] = useState('');
  const [userOptions, setUserOptions] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [gridRows, setGridRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [summary, setSummary] = useState('');

  const modeMeta = useMemo(() => MODES.find((m) => m.id === mode) || MODES[0], [mode]);

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

  const resolveUser = async () => {
    const name = String(targetUser || '').trim();
    if (!name) {
      setUserNo('');
      return null;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/user-report-user-lookup'), {
        params: { user_name: name },
        ...reqOpts,
      });
      const no = String(data?.USER_NO ?? data?.user_no ?? '').trim();
      setUserNo(no);
      if (!data?.ok) {
        alert('Invalid User');
        setTargetUser('');
        setUserNo('');
        return null;
      }
      return data;
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'User lookup failed';
      alert(msg);
      return null;
    }
  };

  const handleProceed = async () => {
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    const name = String(targetUser || '').trim();
    if (!name) {
      alert('User Name is required.');
      return;
    }
    setLoading(true);
    setErr('');
    setGridRows([]);
    setTotalRows(0);
    setSummary('');
    try {
      const lookup = await resolveUser();
      if (!lookup?.ok) return;
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/user-report-data'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sdt),
          e_date: toOracleDate(edt),
          user_name: name,
          mode,
        },
        reqOpts
      );
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      setTotalRows(Number(data?.total ?? rows.length) || 0);
      setSummary(String(data?.message ?? '').trim());
      if (!rows.length) {
        alert(data?.message || 'No records found for the selected criteria.');
      }
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
        Module: r.MODULE,
        'Entry Date': formatLedgerDateDisplay(r.ENT_DATE) || r.ENT_DATE,
        Time: r.ENT_TIME,
        Reference: r.REF,
        Detail: r.DETAIL,
        User: r.USER_NAME,
        Computer: r.COMPUTER_NAME,
      })),
      `UserReport_${mode}_${targetUser || 'user'}`
    );
  };

  const pickUser = (row) => {
    const name = String(row.USER_NAME ?? row.user_name ?? '').trim();
    const no = String(row.USER_NO ?? row.user_no ?? '').trim();
    setTargetUser(name);
    setUserNo(no);
    setUserSearch('');
    setUserOptions([]);
  };

  return (
    <div className="slide slide-75-usrrpt usrrpt-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">User Report</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="user-report" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="usrrpt-screen__panel">
        <p className="usrrpt-screen__hint">
          Choose Add, Edit, or Delete (same as VFP <code>DO FORM userrpt</code>), set dates and user, then Proceed.
        </p>
        <div className="usrrpt-screen__filters inttrf-screen__header-panel">
          <Field label="Report Type *">
            <select
              className="inttrf-input"
              value={mode}
              disabled={loading}
              onChange={(e) => {
                setMode(e.target.value);
                setGridRows([]);
                setTotalRows(0);
                setSummary('');
              }}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starting Date *">
            <input
              type="date"
              className="inttrf-input"
              value={sdt}
              disabled={loading}
              onChange={(e) => setSdt(e.target.value)}
            />
          </Field>
          <Field label="Ending Date *">
            <input
              type="date"
              className="inttrf-input"
              value={edt}
              disabled={loading}
              onChange={(e) => setEdt(e.target.value)}
            />
          </Field>
          <Field label="User Name *" className="usrrpt-field--user">
            <input
              type="text"
              className="inttrf-input"
              value={targetUser}
              disabled={loading}
              onChange={(e) => {
                setTargetUser(e.target.value);
                setUserSearch(e.target.value);
              }}
              onBlur={() => {
                void resolveUser();
              }}
            />
            {userNo ? <span className="usrrpt-screen__user-no">No. {userNo}</span> : null}
            {userOptions.length > 0 && userSearch.trim() ? (
              <ul className="usrrpt-screen__user-list" role="listbox">
                {userOptions.slice(0, 12).map((u) => (
                  <li key={`${u.USER_NO}-${u.USER_NAME}`}>
                    <button type="button" className="usrrpt-screen__user-pick" onMouseDown={() => pickUser(u)}>
                      {u.USER_NAME} {u.USER_NO != null ? `(${u.USER_NO})` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>
        </div>
        {summary ? <p className="usrrpt-screen__summary">{summary}</p> : null}
        {totalRows > 0 ? (
          <p className="usrrpt-screen__count">
            <strong>{totalRows}</strong> record(s) — {modeMeta.label} report
          </p>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid usrrpt-screen__grid">
            <thead>
              <tr>
                <th>Module</th>
                <th>Entry Date</th>
                <th>Time</th>
                <th>Reference</th>
                <th>Detail</th>
                <th>User</th>
                <th>Computer</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="inttrf-screen__grid-empty">
                    {loading ? 'Loading…' : 'Set filters and tap Proceed.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id}>
                    <td>{r.MODULE}</td>
                    <td>{formatLedgerDateDisplay(r.ENT_DATE) || r.ENT_DATE}</td>
                    <td>{r.ENT_TIME || '—'}</td>
                    <td>{r.REF || '—'}</td>
                    <td>{r.DETAIL || '—'}</td>
                    <td>{r.USER_NAME}</td>
                    <td>{r.COMPUTER_NAME || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel usrrpt-screen__footer">
          <div className="inttrf-screen__footer-toolbar usrrpt-screen__footer-toolbar">
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev} disabled={loading}>
              Quit
            </button>
            <div className="usrrpt-screen__footer-actions">
              <button
                type="button"
                className="btn btn-secondary inttrf-btn"
                onClick={handleExcel}
                disabled={loading || !gridRows.length}
              >
                Excel
              </button>
              <button
                type="button"
                className="btn btn-primary inttrf-btn"
                onClick={handleProceed}
                disabled={loading || !sdt || !edt || !targetUser.trim()}
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
