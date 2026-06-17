import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
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

function formatScheduleNo(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '0.00';
  return x.toFixed(2);
}

function mapGridRow(r, idx) {
  return {
    _id: `${r.CODE ?? r.code}-${idx}`,
    SCHEDULE: Number(r.SCHEDULE ?? r.schedule ?? 0) || 0,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    CITY: String(r.CITY ?? r.city ?? '').trim(),
    TEL_NO: String(r.TEL_NO ?? r.tel_no ?? '').trim(),
    PAN: String(r.PAN ?? r.pan ?? '').trim(),
    GST_NO: String(r.GST_NO ?? r.gst_no ?? '').trim(),
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
  };
}

/** VFP DO FORM master_delete — list/delete MASTER accounts with no LEDGER rows. */
export default function Slide63UnusedAccountList({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [adminPw, setAdminPw] = useState('');
  const [adminOk, setAdminOk] = useState(false);
  const [schno, setSchno] = useState('0.00');
  const [schedules, setSchedules] = useState([]);
  const [gridRows, setGridRows] = useState([]);

  const scheduleOptions = useMemo(
    () =>
      schedules.map((s) => {
        const no = Number(s.NO ?? s.no ?? 0) || 0;
        return {
          value: String(no),
          label: String(s.NAME ?? s.name ?? '').trim(),
          NO: no,
          NAME: s.NAME ?? s.name,
        };
      }),
    [schedules]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [permRes, schRes] = await Promise.all([
          axios.get(apiUrl(apiBase, '/api/unused-accounts-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/schedule-master-list'), {
            params: { comp_code: compCode, comp_uid: compUid, view: 'all' },
            ...reqOpts,
          }),
        ]);
        if (!cancelled) {
          setPerms(permRes.data?.permissions ?? null);
          setSchedules(Array.isArray(schRes.data) ? schRes.data : []);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, userName]);

  const verifyAdmin = useCallback(
    async (pw) => {
      const password = String(pw ?? adminPw).trim();
      if (!password) {
        setAdminOk(false);
        return false;
      }
      try {
        await axios.post(
          apiUrl(apiBase, '/api/unused-accounts-verify-admin'),
          { comp_code: compCode, password },
          reqOpts
        );
        setAdminOk(true);
        setErr('');
        return true;
      } catch (e) {
        setAdminOk(false);
        const msg = e?.response?.data?.error || 'Invalid Passowrd';
        alert(msg);
        return false;
      }
    },
    [apiBase, compCode, adminPw]
  );

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    schno: Number(schno) || 0,
    admin_password: adminPw,
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!(await verifyAdmin())) return;
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/unused-accounts-proceed'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No unused accounts found for this schedule filter.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  const toggleRowSelect = (id, e) => {
    e?.stopPropagation();
    setGridRows((prev) => prev.map((r) => (r._id === id ? { ...r, SLCT: !r.SLCT } : r)));
  };

  const selectAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: true })));
  const clearAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: false })));

  const handleExcel = () => {
    if (!gridRows.length) {
      alert('No data to export. Click Proceed first.');
      return;
    }
    downloadExcelRows(
      gridRows.map((r) => ({
        Schedule: formatScheduleNo(r.SCHEDULE),
        Code: r.CODE,
        Name: r.NAME,
        City: r.CITY,
        Tel: r.TEL_NO,
        PAN: r.PAN,
        GST: r.GST_NO,
        Select: r.SLCT ? 'Y' : '',
      })),
      'UnusedAccounts',
      `${compName || 'Company'}_UnusedAccounts`
    );
  };

  const handleDelete = async () => {
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    if (!(await verifyAdmin())) return;
    const selected = gridRows.filter((r) => r.SLCT);
    if (!selected.length) {
      alert('Select at least one account to delete.');
      return;
    }
    if (
      !window.confirm(
        `Delete ${selected.length} unused MASTER account(s)?\n\nThis cannot be undone. Accounts with no LEDGER rows only.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/unused-accounts-delete'),
        {
          ...buildPayload(),
          codes: selected.map((r) => r.CODE),
        },
        reqOpts
      );
      alert(data?.message || 'Done');
      setGridRows((prev) => prev.filter((r) => !r.SLCT));
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-63-unused unused-ac-screen inttrf-screen">
        <p className="loading-msg">Loading Unused Account List…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen;

  return (
    <div className="slide slide-63-unused unused-ac-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Unused Account List</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="unused-account-list" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="inttrf-screen__header-panel unused-ac-screen__head">
        <Field label="Administrator Password *">
          <input
            type="password"
            className="inttrf-input"
            value={adminPw}
            disabled={blocked}
            onChange={(e) => {
              setAdminPw(e.target.value);
              setAdminOk(false);
            }}
            onBlur={() => {
              if (adminPw.trim()) void verifyAdmin();
            }}
          />
        </Field>
        <Field label="Schedule No. (0 = all)">
          <MasterPartyPickList
            options={[{ value: '0', label: '0.00 — All schedules', NO: 0, NAME: 'All schedules' }, ...scheduleOptions]}
            value={schno}
            onChange={(v) => setSchno(formatScheduleNo(Number(v) || v))}
            title="Schedule"
            placeholder="0.00"
            disabled={blocked || !adminOk}
            getValue={(o) => String(o.value ?? o.NO ?? '')}
            getLabel={(o) =>
              Number(o.NO ?? o.value ?? 0) === 0
                ? '0.00 — All schedules'
                : `${Number(o.NO ?? o.value ?? 0).toFixed(2)} — ${o.label ?? o.NAME ?? ''}`
            }
          />
        </Field>
        <p className="unused-ac-screen__hint">
          VFP master_delete: accounts in MASTER with no LEDGER rows. Admin password required (same as VFP APW).
        </p>
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid unused-ac-screen__grid">
            <thead>
              <tr>
                <th>Sch</th>
                <th>Code</th>
                <th>Name</th>
                <th>City</th>
                <th>Tel</th>
                <th>PAN</th>
                <th>GST</th>
                <th>SLCT</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="inttrf-screen__grid-empty">
                    Enter admin password, set schedule filter, then click Proceed.
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id} className={r.SLCT ? 'inttrf-screen__row--selected' : ''}>
                    <td>{formatScheduleNo(r.SCHEDULE)}</td>
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td>{r.CITY}</td>
                    <td>{r.TEL_NO}</td>
                    <td>{r.PAN}</td>
                    <td>{r.GST_NO}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.SLCT}
                        disabled={blocked || !adminOk}
                        onChange={(e) => toggleRowSelect(r._id, e)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel">
          <div className="inttrf-screen__footer-toolbar">
            <div className="inttrf-screen__footer-left">
              <button
                type="button"
                className="btn btn-primary inttrf-btn"
                onClick={handleDelete}
                disabled={deleting || blocked || !adminOk}
              >
                {deleting ? 'Deleting…' : 'Delete Master'}
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
                Quit
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={selectAllRows} disabled={!gridRows.length}>
                Select All
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={clearAllRows} disabled={!gridRows.length}>
                Clear All
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleExcel} disabled={!gridRows.length}>
                Excel
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary inttrf-btn unused-ac-screen__proceed"
              onClick={handleProceed}
              disabled={proceeding || blocked || !adminPw.trim()}
            >
              {proceeding ? 'Loading…' : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
