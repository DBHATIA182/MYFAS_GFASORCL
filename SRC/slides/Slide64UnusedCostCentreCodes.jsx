import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
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

function mapGridRow(r, idx) {
  return {
    _id: `${r.COST_CODE ?? r.cost_code}-${idx}`,
    COST_CODE: String(r.COST_CODE ?? r.cost_code ?? '').trim(),
    COST_NAME: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
  };
}

/** VFP DO FORM cost_delete — list/delete COST codes unused in LEDGER, LOTSTOCK, and BILLS. */
export default function Slide64UnusedCostCentreCodes({ apiBase, formData, userName, onPrev }) {
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
  const [gridRows, setGridRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/unused-cost-centres-user-permissions'), {
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

  const verifyAdmin = useCallback(
    async (pw) => {
      const password = String(pw ?? adminPw).trim();
      if (!password) {
        setAdminOk(false);
        return false;
      }
      try {
        await axios.post(
          apiUrl(apiBase, '/api/unused-cost-centres-verify-admin'),
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
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/unused-cost-centres-proceed'),
        buildPayload(),
        reqOpts
      );
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No unused cost centre codes found.');
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
        'Cost Code': r.COST_CODE,
        'Cost Name': r.COST_NAME,
        'A/c Code': r.CODE,
        'A/c Name': r.AC_NAME,
        Select: r.SLCT ? 'Y' : '',
      })),
      'UnusedCostCentres',
      `${compName || 'Company'}_UnusedCostCentres`
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
      alert('Select at least one cost centre code to delete.');
      return;
    }
    if (
      !window.confirm(
        `Delete ${selected.length} unused cost centre code(s)?\n\nCodes must not appear in LEDGER, LOTSTOCK, or BILLS.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/unused-cost-centres-delete'),
        {
          ...buildPayload(),
          cost_codes: selected.map((r) => r.COST_CODE),
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
      <div className="slide slide-64-unused-cc unused-cc-screen inttrf-screen">
        <p className="loading-msg">Loading Unused Cost Centre Codes…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen;

  return (
    <div className="slide slide-64-unused-cc unused-cc-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Unused Cost Centre Codes</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="unused-cost-centre-codes" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="inttrf-screen__header-panel unused-cc-screen__head">
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
        <p className="unused-cc-screen__hint">
          VFP cost_delete: cost centres in COST with no use in LEDGER, LOTSTOCK, or BILLS. Admin password required (APW
          = GRAINFAS).
        </p>
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid unused-cc-screen__grid">
            <thead>
              <tr>
                <th>Cost Code</th>
                <th>Cost Name</th>
                <th>A/c Code</th>
                <th>A/c Name</th>
                <th>SLCT</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="inttrf-screen__grid-empty">
                    Enter admin password, then click Proceed to list unused cost centre codes.
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id} className={r.SLCT ? 'inttrf-screen__row--selected' : ''}>
                    <td>{r.COST_CODE}</td>
                    <td>{r.COST_NAME}</td>
                    <td>{r.CODE}</td>
                    <td>{r.AC_NAME}</td>
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
                {deleting ? 'Deleting…' : 'Delete Cost'}
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
              className="btn btn-primary inttrf-btn unused-cc-screen__proceed"
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
