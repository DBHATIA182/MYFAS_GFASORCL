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
  if (!Number.isFinite(x) || x === 0) return '';
  return x.toFixed(2);
}

function mapGridRow(r, idx) {
  const code = String(r.CODE ?? r.code ?? '').trim();
  return {
    _id: `${code}-${idx}`,
    CODE: code,
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
  };
}

/** VFP DO FORM master_missing_numbers — find and create missing MASTER codes in a range. */
export default function Slide66MissingCodes({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [schno, setSchno] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [scode, setScode] = useState('');
  const [ecode, setEcode] = useState('');
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
          axios.get(apiUrl(apiBase, '/api/missing-codes-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/master-party-schedules'), {
            params: { comp_code: compCode, comp_uid: compUid },
            ...reqOpts,
          }),
        ]);
        if (!cancelled) {
          setPerms(permRes.data?.permissions ?? permRes.data ?? null);
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

  const loadCodeRange = useCallback(
    async (schedule) => {
      const sch = formatScheduleNo(schedule);
      if (!sch) {
        setScode('');
        setEcode('');
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/missing-codes-code-range'), {
          params: { comp_code: compCode, comp_uid: compUid, schedule: sch },
          ...reqOpts,
        });
        setScode(String(data?.scode ?? data?.SCODE ?? '').trim());
        setEcode(String(data?.ecode ?? data?.ECODE ?? '').trim());
        setErr('');
      } catch (e) {
        setScode('');
        setEcode('');
        setErr(e?.response?.data?.error || e.message || 'Could not load code range');
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleScheduleChange = (v) => {
    const sch = formatScheduleNo(Number(v) || v);
    setSchno(sch);
    setGridRows([]);
    if (sch) void loadCodeRange(sch);
    else {
      setScode('');
      setEcode('');
    }
  };

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    comp_year: compYear,
    user_name: userName,
    schedule: Number(schno) || schno,
    scode: scode.trim().toUpperCase(),
    ecode: ecode.trim().toUpperCase(),
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!schno) {
      alert('Select a schedule.');
      return;
    }
    if (!scode.trim() || !ecode.trim()) {
      alert('Starting Code and Ending Code are required.');
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/missing-codes-proceed'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No missing numbers found in this range.');
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
      gridRows.map((r) => ({ Code: r.CODE, Select: r.SLCT ? 'Y' : '' })),
      'MissingCodes',
      `${compName || 'Company'}_MissingCodes`
    );
  };

  const handleCreate = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    const selected = gridRows.filter((r) => r.SLCT);
    if (!selected.length) {
      alert('Select at least one missing code to create.');
      return;
    }
    if (
      !window.confirm(
        `Create ${selected.length} missing MASTER account code(s)?\n\nPlaceholder rows will be added for the selected codes.`
      )
    ) {
      return;
    }
    setCreating(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/missing-codes-create'),
        {
          ...buildPayload(),
          codes: selected.map((r) => r.CODE),
        },
        reqOpts
      );
      alert(data?.message || 'Done');
      setGridRows((prev) => prev.filter((r) => !r.SLCT));
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Create failed';
      setErr(msg);
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-66-missing missing-codes-screen inttrf-screen">
        <p className="loading-msg">Loading Missing Codes…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen;

  return (
    <div className="slide slide-66-missing missing-codes-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Missing Codes</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="missing-codes" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="inttrf-screen__header-panel missing-codes-screen__head">
        <Field label="Schedule No. *">
          <MasterPartyPickList
            options={scheduleOptions}
            value={schno}
            onChange={handleScheduleChange}
            title="Schedule"
            placeholder="e.g. 8.10"
            disabled={blocked}
            getValue={(o) => String(o.value ?? o.NO ?? '')}
            getLabel={(o) => `${Number(o.NO ?? o.value ?? 0).toFixed(2)} — ${o.label ?? o.NAME ?? ''}`}
          />
        </Field>
        <Field label="Starting Code *">
          <input
            type="text"
            className="inttrf-input"
            value={scode}
            maxLength={6}
            disabled={blocked}
            onChange={(e) => {
              setScode(e.target.value.toUpperCase());
              setGridRows([]);
            }}
          />
        </Field>
        <Field label="Ending Code *">
          <input
            type="text"
            className="inttrf-input"
            value={ecode}
            maxLength={6}
            disabled={blocked}
            onChange={(e) => {
              setEcode(e.target.value.toUpperCase());
              setGridRows([]);
            }}
          />
        </Field>
        <p className="missing-codes-screen__hint">
          VFP master_missing_numbers: pick schedule (loads MIN/MAX code), set range, Proceed lists gaps, Create Missing
          adds MASTER rows (same as SHELL_EXECUTE MISSING_CODE).
        </p>
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid missing-codes-screen__grid">
            <thead>
              <tr>
                <th>Missing Code</th>
                <th>SLCT</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="inttrf-screen__grid-empty">
                    Select schedule and code range, then click Proceed.
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id} className={r.SLCT ? 'inttrf-screen__row--selected' : ''}>
                    <td>{r.CODE}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.SLCT}
                        disabled={blocked}
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
                onClick={handleCreate}
                disabled={creating || blocked || !gridRows.length}
              >
                {creating ? 'Creating…' : 'Create Missing'}
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
              className="btn btn-primary inttrf-btn missing-codes-screen__proceed"
              onClick={handleProceed}
              disabled={proceeding || blocked || !schno || !scode.trim() || !ecode.trim()}
            >
              {proceeding ? 'Loading…' : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
