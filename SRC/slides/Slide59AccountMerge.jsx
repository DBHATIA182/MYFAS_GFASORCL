import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };
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

function MergeField({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

/** VFP DO FORM amerge — merge duplicate account codes across ledger, sale, purchase, etc. */
export default function Slide59AccountMerge({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const fyStartDate = formData.comp_s_dt ?? formData.COMP_S_DT;
  const fyEndDate = formData.comp_e_dt ?? formData.COMP_E_DT;

  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [mcode, setMcode] = useState('');
  const [mname, setMname] = useState('');
  const [ncode, setNcode] = useState('');
  const [nname, setNname] = useState('');
  const [sdt, setSdt] = useState('');
  const [edt, setEdt] = useState('');
  const [scdt, setScdt] = useState('');
  const [ecdt, setEcdt] = useState('');
  const [vtp, setVtp] = useState('');

  const [accounts, setAccounts] = useState([]);
  const accountOptions = useMemo(() => accounts.map(mapAccountPickOption), [accounts]);
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

  const lookupAccount = useCallback(
    async (code, setCode, setName) => {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) {
        setName('');
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/account-merge-lookup'), {
          params: { comp_code: compCode, comp_uid: compUid, code: c, user_name: userName || '' },
          ...reqOpts,
        });
        setCode(String(data.code ?? c).trim().toUpperCase());
        setName(String(data.name ?? '').trim());
        setErr('');
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Invalid account code';
        setName('');
        setErr(msg);
        if (e?.response?.status === 400) alert(msg);
      }
    },
    [apiBase, compCode, compUid, userName]
  );

  const applyInitContext = useCallback((ctx) => {
    if (!ctx) return;
    const s =
      toInputDateString(fyStartDate) ||
      toInputDateString(ctx.sdt_iso) ||
      toInputDateString(ctx.sdt);
    const e =
      toInputDateString(fyEndDate) ||
      toInputDateString(ctx.edt_iso) ||
      toInputDateString(ctx.edt);
    const sc = toInputDateString(ctx.scdt_iso) || toInputDateString(ctx.scdt) || s;
    const ec = toInputDateString(ctx.ecdt_iso) || toInputDateString(ctx.ecdt) || e;
    if (s) setSdt(s);
    if (e) setEdt(e);
    if (sc) setScdt(sc);
    if (ec) setEcdt(ec);
    setMcode('');
    setMname('');
    setNcode('');
    setNname('');
    setVtp('');
    setStatus('');
  }, [fyStartDate, fyEndDate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [permRes, initRes] = await Promise.all([
          axios.get(apiUrl(apiBase, '/api/account-merge-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/account-merge-init'), {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              comp_year: compYear,
              user_name: userName || '',
              comp_s_dt: fyStartDate,
              comp_e_dt: fyEndDate,
            },
            ...reqOpts,
          }),
        ]);
        if (cancelled) return;
        setPerms(permRes.data?.permissions ?? null);
        applyInitContext(initRes.data?.context);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, compYear, userName, fyStartDate, fyEndDate, applyInitContext]);

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    const oldCode = String(mcode).trim().toUpperCase();
    const newCode = String(ncode).trim().toUpperCase();
    if (!oldCode) {
      alert('Enter Old Ledger A/c');
      return;
    }
    if (!newCode) {
      alert('Enter New Ledger A/c');
      return;
    }
    if (oldCode === newCode) {
      alert('Old and new account codes must be different.');
      return;
    }
    const sOracle = toOracleDate(sdt);
    const eOracle = toOracleDate(edt);
    const scOracle = toOracleDate(scdt);
    const ecOracle = toOracleDate(ecdt);
    if (!sOracle || !eOracle || !scOracle || !ecOracle) {
      alert('Enter all date ranges.');
      return;
    }
    const ok = window.confirm(
      `Merge all references from [${oldCode}] to [${newCode}] for the selected date ranges?\n\nThis updates SALE, LEDGER, VOUCHER, PURCHASE, BIKRI, and related tables (same as VFP amerge).`
    );
    if (!ok) return;

    setMerging(true);
    setErr('');
    setStatus('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/account-merge'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          mcode: oldCode,
          ncode: newCode,
          sdt: sOracle,
          edt: eOracle,
          scdt: scOracle,
          ecdt: ecOracle,
          vtp: String(vtp).trim(),
        },
        reqOpts
      );
      setStatus(data?.message || 'Merge Completed');
      alert(data?.message || 'Merge Completed');
      setMcode('');
      setMname('');
      setNcode('');
      setNname('');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Merge failed';
      setErr(msg);
      alert(msg);
    } finally {
      setMerging(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-59-amerge amerge-screen inttrf-screen">
        <p className="loading-msg">Loading Merging Of Accounts…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen || !perms?.canEdit;

  return (
    <div className="slide slide-59-amerge amerge-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Merging Of Accounts</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="merging-of-accounts" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to merge accounts.</p> : null}

      <div className="inttrf-screen__header-panel amerge-screen__panel">
        <div className="inttrf-screen__header-top">
          <p className="amerge-screen__lead">A/c Merging — replace old account code with new across transactions (VFP DO FORM amerge).</p>
          <div className="inttrf-screen__header-actions">
            <button type="button" className="btn btn-primary inttrf-btn" onClick={handleProceed} disabled={merging || blocked}>
              {merging ? 'Merging…' : 'Proceed'}
            </button>
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
              Quit
            </button>
          </div>
        </div>

        <div className="amerge-screen__grid">
          <div className="amerge-screen__accounts">
            <MergeField label="Old Ledger A/c">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={mcode}
                  onChange={setMcode}
                  onFilterChange={handleAccountFilterChange}
                  onAfterSelect={(val) => void lookupAccount(val, setMcode, setMname)}
                  title="Old Ledger A/c"
                  disabled={blocked || merging}
                  {...accountHelpPickProps(mcode)}
                />
                <input type="text" className="inttrf-screen__schname" value={mname} readOnly tabIndex={-1} />
              </div>
            </MergeField>
            <MergeField label="New Ledger A/c">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={ncode}
                  onChange={setNcode}
                  onFilterChange={handleAccountFilterChange}
                  onAfterSelect={(val) => void lookupAccount(val, setNcode, setNname)}
                  title="New Ledger A/c"
                  disabled={blocked || merging}
                  {...accountHelpPickProps(ncode)}
                />
                <input type="text" className="inttrf-screen__schname" value={nname} readOnly tabIndex={-1} />
              </div>
            </MergeField>
            <MergeField label="Specific Vr.Type" className="inttrf-field--wide">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={4}
                value={vtp}
                disabled={blocked || merging}
                onChange={(e) => setVtp(e.target.value.toUpperCase())}
                placeholder="Optional — blank = all"
              />
            </MergeField>
          </div>

          <div className="amerge-screen__dates">
            <p className="amerge-screen__dates-title">Credit lines (Cr.)</p>
            <MergeField label="Starting Date Credit">
              <input
                type="date"
                className="inttrf-input"
                value={scdt}
                disabled={blocked || merging}
                onChange={(e) => setScdt(e.target.value)}
              />
            </MergeField>
            <MergeField label="Ending Date Credit">
              <input
                type="date"
                className="inttrf-input"
                value={ecdt}
                disabled={blocked || merging}
                onChange={(e) => setEcdt(e.target.value)}
              />
            </MergeField>

            <p className="amerge-screen__dates-title">Debit / bills (Dr.)</p>
            <MergeField label="Starting Date Debit">
              <input
                type="date"
                className="inttrf-input"
                value={sdt}
                disabled={blocked || merging}
                onChange={(e) => setSdt(e.target.value)}
              />
            </MergeField>
            <MergeField label="Ending Date Debit">
              <input
                type="date"
                className="inttrf-input"
                value={edt}
                disabled={blocked || merging}
                onChange={(e) => setEdt(e.target.value)}
              />
            </MergeField>
          </div>
        </div>

        {status ? (
          <p className="inttrf-screen__save-status amerge-screen__status" role="status">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
