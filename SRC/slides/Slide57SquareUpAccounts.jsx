import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import {
  purExpAccountCodeAliases,
  purExpLegacyMasterCode,
} from '../utils/purExpAccountCode';

const reqOpts = { withCredentials: true, timeout: 300000 };
const SQUARE_SAVE_PROGRESS_MSG = 'Saving Records Creating Journal Voucher';
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;

function mapAccountPickOption(a) {
  return {
    value: String(a.CODE ?? a.code ?? '').trim(),
    label: String(a.NAME ?? a.name ?? '').trim(),
    CODE: a.CODE ?? a.code,
    NAME: a.NAME ?? a.name,
    CITY: String(a.CITY ?? a.city ?? '').trim(),
  };
}

function mapSchedulePickOption(s) {
  const no = Number(s.NO ?? s.no ?? 0) || 0;
  return {
    value: String(no),
    label: String(s.NAME ?? s.name ?? '').trim(),
    NO: no,
    NAME: s.NAME ?? s.name,
  };
}

function accountHelpPickProps(triggerCode) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: false,
    filterPlaceholder: 'Type name, city or code…',
    getValue: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
    getOptionCity: (o) => String(o.CITY ?? '').trim(),
  };
}

function formatAmt2(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function formatScheduleNo(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '');
  return x.toFixed(2);
}

function SquareField({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function mapGridRow(r, idx) {
  return {
    _id: `${r.CODE}-${idx}`,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    CURBAL: formatAmt2(r.CURBAL ?? r.curbal),
    DR_TRF: formatAmt2(r.DR_TRF ?? r.dr_trf),
    CR_TRF: formatAmt2(r.CR_TRF ?? r.cr_trf),
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
  };
}

/** VFP DO FORM SQUARE — square up small ledger balances into JV vouchers. */
export default function Slide57SquareUpAccounts({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const fyEndDate = formData.comp_e_dt ?? formData.COMP_E_DT;

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [edt, setEdt] = useState('');
  const [schno, setSchno] = useState('8.10');
  const [schName, setSchName] = useState('');
  const [mdc, setMdc] = useState('B');
  const [trfCodeDr, setTrfCodeDr] = useState('');
  const [trfNameDr, setTrfNameDr] = useState('');
  const [trfCodeCr, setTrfCodeCr] = useState('');
  const [trfNameCr, setTrfNameCr] = useState('');
  const [minAmt, setMinAmt] = useState('10');
  const [minCAmt, setMinCAmt] = useState('-10');
  const [scd, setScd] = useState('1');
  const [ecd, setEcd] = useState('Z99999');
  const [svno, setSvno] = useState('0');
  const [evno, setEvno] = useState('0');

  const [gridRows, setGridRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [schedules, setSchedules] = useState([]);

  const accountOptions = useMemo(() => accounts.map(mapAccountPickOption), [accounts]);
  const scheduleOptions = useMemo(() => schedules.map(mapSchedulePickOption), [schedules]);
  const accountSearchDebounceRef = useRef(null);

  const fetchAccounts = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      const trimmed = String(q ?? '').trim();
      if (!trimmed) {
        setAccounts([]);
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params: { comp_code: compCode, comp_uid: compUid, q: trimmed },
          ...reqOpts,
        });
        setAccounts(Array.isArray(data) ? data : []);
      } catch {
        setAccounts([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleAccountFilterChange = useCallback(
    (q) => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
      accountSearchDebounceRef.current = setTimeout(() => {
        void fetchAccounts(q);
      }, ACCOUNT_SEARCH_DEBOUNCE_MS);
    },
    [fetchAccounts]
  );

  useEffect(
    () => () => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
    },
    []
  );

  const applyInitContext = useCallback((ctx) => {
    if (!ctx) return;
    setEdt(toInputDateString(ctx.edt) || toInputDateString(new Date()));
    const sch = Number(ctx.schno ?? 8.1) || 8.1;
    setSchno(formatScheduleNo(sch));
    setSchName(String(ctx.sch_name ?? ctx.schName ?? '').trim());
    setMdc(String(ctx.mdc ?? 'B').trim().toUpperCase().slice(0, 1) || 'B');
    setTrfCodeDr(String(ctx.trf_code_dr ?? ctx.trfcode ?? '').trim());
    setTrfNameDr(String(ctx.trf_name_dr ?? ctx.trfname ?? '').trim());
    setTrfCodeCr(String(ctx.trf_code_cr ?? ctx.trfcodecr ?? '').trim());
    setTrfNameCr(String(ctx.trf_name_cr ?? ctx.trfname1 ?? '').trim());
    setMinAmt(String(ctx.minamt ?? 10));
    setMinCAmt(String(ctx.mincamt ?? -10));
    setScd(String(ctx.scd ?? '1').trim().toUpperCase());
    setEcd(String(ctx.ecd ?? 'Z99999').trim().toUpperCase());
    setGridRows([]);
    setSvno('0');
    setEvno('0');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [permRes, initRes, schRes] = await Promise.all([
          axios.get(apiUrl(apiBase, '/api/square-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/square-init'), {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              comp_year: compYear,
              user_name: userName || '',
              comp_e_dt: fyEndDate,
            },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/schedule-master-list'), {
            params: { comp_code: compCode, comp_uid: compUid, view: 'all' },
            ...reqOpts,
          }),
        ]);
        if (cancelled) return;
        setPerms(permRes.data?.permissions ?? null);
        applyInitContext(initRes.data?.context);
        setSchedules(Array.isArray(schRes.data) ? schRes.data : []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, compYear, userName, fyEndDate, applyInitContext]);

  const handleSchnoChange = (val) => {
    const n = Number(val);
    setSchno(formatScheduleNo(n || val));
    const opt = scheduleOptions.find((o) => Math.abs(Number(o.NO) - n) < 0.0001);
    setSchName(String(opt?.label ?? opt?.NAME ?? '').trim());
  };

  const buildProceedPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    edt,
    schno: Number(schno) || 0,
    minamt: Number(minAmt) || 0,
    mincamt: Number(minCAmt) || 0,
    mdc,
    scd,
    ecd,
    trf_code_dr: trfCodeDr,
    trf_code_cr: trfCodeCr,
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/square-proceed'), buildProceedPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No records found for the current filters.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  const toggleRowSelect = (id) => {
    setGridRows((prev) => prev.map((r) => (r._id === id ? { ...r, SLCT: !r.SLCT } : r)));
  };

  const selectAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: true })));
  const clearAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: false })));

  const handleSave = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    const selected = gridRows.filter((r) => r.SLCT);
    if (!selected.length) {
      alert('Select at least one row to save.');
      return;
    }
    setSaving(true);
    setSaveStatus(SQUARE_SAVE_PROGRESS_MSG);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/square-save'),
        {
          ...buildProceedPayload(),
          comp_year: compYear,
          rows: selected.map((r) => ({
            CODE: r.CODE,
            NAME: r.NAME,
            DR_TRF: Number(String(r.DR_TRF).replace(/,/g, '')) || 0,
            CR_TRF: Number(String(r.CR_TRF).replace(/,/g, '')) || 0,
            SLCT: 'Y',
          })),
        },
        reqOpts
      );
      setSaveStatus('');
      alert(data?.message || 'DONE');
      setGridRows([]);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setSaveStatus('');
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVouchers = async () => {
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const s = Number(svno) || 0;
    const e = Number(evno) || 0;
    if (!s || !e) {
      alert('Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete JV vouchers ${s}–${e} dated ${edt}?`)) return;
    setDeleting(true);
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/square-delete-vouchers'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          edt,
          svno: s,
          evno: e,
        },
        reqOpts
      );
      alert(data?.message || 'Deleted');
      onPrev();
    } catch (ex) {
      alert(ex?.response?.data?.error || ex.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleExcel = () => {
    if (!gridRows.length) {
      alert('No data to export. Click Proceed first.');
      return;
    }
    const rows = gridRows.map((r) => ({
      Code: r.CODE,
      Name: r.NAME,
      Curbal: r.CURBAL,
      'Dr Trf': r.DR_TRF,
      'Cr Trf': r.CR_TRF,
      Select: r.SLCT ? 'Y' : '',
    }));
    downloadExcelRows(rows, 'SquareUpAccounts', `${compName || 'Company'}_SquareUpAccounts`);
  };

  const accountCodesMatch = useCallback((left, right) => {
    const rightAliases = new Set(purExpAccountCodeAliases(right));
    return purExpAccountCodeAliases(left).some((alias) => rightAliases.has(alias));
  }, []);

  const validateTrfCodeOnBlur = useCallback(
    async (code, setCode, setName) => {
      const raw = String(code || '').trim().toUpperCase();
      if (!raw) {
        setName('');
        return;
      }
      const searchTerms = [...new Set([raw, purExpLegacyMasterCode(raw)].filter(Boolean))];
      try {
        for (const q of searchTerms) {
          const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
            params: { comp_code: compCode, comp_uid: compUid, q },
            ...reqOpts,
          });
          const rows = Array.isArray(data) ? data : [];
          const hit = rows.find((r) => accountCodesMatch(r.CODE ?? r.code, raw));
          if (hit) {
            const canonical = String(hit.CODE ?? hit.code ?? '').trim().toUpperCase();
            if (canonical) setCode(canonical);
            setName(String(hit.NAME ?? hit.name ?? '').trim());
            return;
          }
        }
        alert('!!! Invalid A/c Code !!!');
        setCode('');
        setName('');
      } catch {
        alert('!!! Invalid A/c Code !!!');
        setCode('');
        setName('');
      }
    },
    [accountCodesMatch, apiBase, compCode, compUid]
  );

  if (loading) {
    return (
      <div className="slide slide-57-square square-screen inttrf-screen">
        <p className="loading-msg">Loading SquareUp Accounts…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-57-square square-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">SquareUp Accounts</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="square-up-accounts" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="inttrf-screen__header-panel">
        <div className="inttrf-screen__header-top">
          <SquareField label="Schedule No." className="inttrf-field--schedule">
            <div className="inttrf-screen__inline-pair">
              <MasterPartyPickList
                options={scheduleOptions}
                value={schno}
                onChange={(v) => handleSchnoChange(v)}
                title="Schedule"
                placeholder="8.10"
                getValue={(o) => String(o.value ?? o.NO ?? '')}
                getLabel={(o) => `${Number(o.NO ?? o.value ?? 0).toFixed(2)} — ${o.label ?? o.NAME ?? ''}`}
              />
              <input type="text" className="inttrf-screen__schname" value={schName} readOnly tabIndex={-1} />
            </div>
          </SquareField>
          <div className="inttrf-screen__header-actions">
            <button type="button" className="btn btn-primary inttrf-btn" onClick={handleProceed} disabled={proceeding}>
              {proceeding ? '…' : 'Proceed'}
            </button>
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
              Quit
            </button>
          </div>
        </div>

        <div className="inttrf-screen__header-rows">
          <div className="inttrf-screen__header-row">
            <SquareField label="Ending Date">
              <input
                type="date"
                className="inttrf-input"
                value={edt}
                max={toInputDateString(fyEndDate) || undefined}
                onChange={(e) => setEdt(e.target.value)}
              />
            </SquareField>
            <SquareField label="Minimum Dr.Amt.">
              <input
                type="number"
                className="inttrf-input inttrf-input--num"
                step="0.01"
                value={minAmt}
                onChange={(e) => setMinAmt(e.target.value)}
              />
            </SquareField>
            <SquareField label="(D) / (C) / (B)">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={mdc}
                onChange={(e) => setMdc(e.target.value.toUpperCase().slice(0, 1))}
              />
            </SquareField>
            <SquareField label="Trf.Code Dr.">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={trfCodeDr}
                  onChange={setTrfCodeDr}
                  onFilterChange={handleAccountFilterChange}
                  title="Transfer Debit Code"
                  {...accountHelpPickProps(trfCodeDr)}
                  onAfterSelect={(val) => void validateTrfCodeOnBlur(val, setTrfCodeDr, setTrfNameDr)}
                />
                <input type="text" className="inttrf-screen__schname" value={trfNameDr} readOnly tabIndex={-1} />
              </div>
            </SquareField>
          </div>

          <div className="inttrf-screen__header-row">
            <SquareField label="Starting Code">
              <input
                type="text"
                className="inttrf-input inttrf-input--code"
                maxLength={6}
                value={scd}
                onChange={(e) => setScd(e.target.value.toUpperCase())}
              />
            </SquareField>
            <SquareField label="Ending Code">
              <input
                type="text"
                className="inttrf-input inttrf-input--code"
                maxLength={6}
                value={ecd}
                onChange={(e) => setEcd(e.target.value.toUpperCase())}
              />
            </SquareField>
            <SquareField label="Minimum Cr.Amt.">
              <input
                type="number"
                className="inttrf-input inttrf-input--num"
                step="0.01"
                value={minCAmt}
                onChange={(e) => setMinCAmt(e.target.value)}
              />
            </SquareField>
            <SquareField label="Trf.Code Cr.">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={trfCodeCr}
                  onChange={setTrfCodeCr}
                  onFilterChange={handleAccountFilterChange}
                  title="Transfer Credit Code"
                  {...accountHelpPickProps(trfCodeCr)}
                  onAfterSelect={(val) => void validateTrfCodeOnBlur(val, setTrfCodeCr, setTrfNameCr)}
                />
                <input type="text" className="inttrf-screen__schname" value={trfNameCr} readOnly tabIndex={-1} />
              </div>
            </SquareField>
          </div>
        </div>
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid">
            <thead>
              <tr>
                <th />
                <th>Code</th>
                <th>Name</th>
                <th className="amount">Curbal</th>
                <th className="amount">Dr_trf</th>
                <th className="amount">Cr_trf</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="inttrf-screen__grid-empty">
                    Click Proceed to load account balances.
                  </td>
                </tr>
              ) : (
                gridRows.map((r) => (
                  <tr key={r._id} className={r.SLCT ? 'inttrf-screen__row--selected' : ''}>
                    <td>
                      <input type="checkbox" checked={r.SLCT} onChange={() => toggleRowSelect(r._id)} />
                    </td>
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td className="amount">{r.CURBAL}</td>
                    <td className="amount">{r.DR_TRF}</td>
                    <td className="amount">{r.CR_TRF}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel">
          {saveStatus ? (
            <p className="inttrf-screen__save-status" role="status" aria-live="polite">
              {saveStatus}
            </p>
          ) : null}
          <div className="inttrf-screen__footer-toolbar">
            <div className="inttrf-screen__footer-left">
              <button type="button" className="btn btn-primary inttrf-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleExcel}>
                Excel
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
                Quit
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={selectAllRows}>
                Select All
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={clearAllRows}>
                Clear All
              </button>
            </div>

            <div className="inttrf-screen__footer-delete">
              <span className="inttrf-screen__footer-label">Delete Prev.Starting Vr.No.</span>
              <div className="inttrf-screen__footer-delete-row">
                <input type="number" className="inttrf-input inttrf-input--vno" value={svno} onChange={(e) => setSvno(e.target.value)} />
                <input type="number" className="inttrf-input inttrf-input--vno" value={evno} onChange={(e) => setEvno(e.target.value)} />
                <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleDeleteVouchers} disabled={deleting}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
