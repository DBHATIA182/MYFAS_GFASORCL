import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;
/** VFP bnotrf — suppliers only: SUBSTR(CODE,1,1) IN ('S','T') */
const SUPPLIER_CODE_PREFIX = 'ST';

function isBikriSupplierCode(code) {
  const c = String(code ?? '')
    .trim()
    .toUpperCase();
  if (!c) return false;
  const ch = c.charAt(0);
  return ch === 'S' || ch === 'T';
}

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
    filterPlaceholder: 'Search supplier (S or T code)…',
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

function parseBikriNoInput(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** VFP DO FORM bnotrf — merge old bikri number (and optional supplier) into new. */
export default function Slide60BikriNoMerge({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [mcode, setMcode] = useState('');
  const [mname, setMname] = useState('');
  const [ncode, setNcode] = useState('');
  const [nname, setNname] = useState('');
  const [bno, setBno] = useState('');
  const [nbno, setNbno] = useState('');

  const [accounts, setAccounts] = useState([]);
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => isBikriSupplierCode(a.CODE ?? a.code))
        .map(mapAccountPickOption),
    [accounts]
  );
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
          params: { comp_code: compCode, comp_uid: compUid, q: trimmed, code_prefix: SUPPLIER_CODE_PREFIX },
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
    async (code, setCode, setName, invalidMsg) => {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) {
        setName('');
        return true;
      }
      if (!isBikriSupplierCode(c)) {
        const msg = 'Supplier code must start with S or T.';
        setName('');
        setErr(msg);
        alert(msg);
        return false;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-merge-lookup'), {
          params: { comp_code: compCode, comp_uid: compUid, code: c, user_name: userName || '' },
          ...reqOpts,
        });
        setCode(String(data.code ?? c).trim().toUpperCase());
        setName(String(data.name ?? '').trim());
        setErr('');
        return true;
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || invalidMsg;
        setName('');
        setErr(msg);
        if (e?.response?.status === 400) alert(msg);
        return false;
      }
    },
    [apiBase, compCode, compUid, userName]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-merge-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data?.permissions ?? null);
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
    const oldBno = parseBikriNoInput(bno);
    const newBno = parseBikriNoInput(nbno);

    if (oldCode) {
      const ok = await lookupAccount(oldCode, setMcode, setMname, '!!! Invalid A/c Code !!!');
      if (!ok) return;
    }
    if (!newCode) {
      alert('Enter New Supplier A/c');
      return;
    }
    const newOk = await lookupAccount(newCode, setNcode, setNname, 'Invalid New Ledger Code');
    if (!newOk) return;

    if (!oldBno) {
      alert('Enter Old Bikri No.');
      return;
    }
    if (!newBno) {
      alert('Enter New Bikri No.');
      return;
    }

    const ok = window.confirm(
      `Merge bikri ${oldBno} → ${newBno}` +
        (oldCode ? ` for supplier [${oldCode}]` : ' (all suppliers on this B.No.)') +
        ` to account [${newCode}]?\n\nUpdates SALE, LOTSTOCK, LEDGER, BIKRI, PURCHASE, etc. (VFP bnotrf).`
    );
    if (!ok) return;

    setMerging(true);
    setErr('');
    setStatus('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/bikri-merge'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          mcode: oldCode || undefined,
          ncode: newCode,
          bno: oldBno,
          nbno: newBno,
        },
        reqOpts
      );
      const msg = data?.message || 'Merge Completed';
      setStatus(msg);
      alert(msg);
      setMcode('');
      setMname('');
      setNcode('');
      setNname('');
      setBno('');
      setNbno('');
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
      <div className="slide slide-60-bnotrf bnotrf-screen inttrf-screen">
        <p className="loading-msg">Loading Bikri No. Merging…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen || !perms?.canEdit;

  return (
    <div className="slide slide-60-bnotrf bnotrf-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Bikri No. Merging</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="bikri-no-merging" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to merge bikri numbers.</p> : null}

      <div className="inttrf-screen__header-panel amerge-screen__panel">
        <div className="inttrf-screen__header-top">
          <p className="amerge-screen__lead">
            Replace old bikri number (and optional supplier) with new values across transactions (VFP DO FORM bnotrf).
          </p>
          <div className="inttrf-screen__header-actions">
            <button type="button" className="btn btn-primary inttrf-btn" onClick={handleProceed} disabled={merging || blocked}>
              {merging ? 'Merging…' : 'Proceed'}
            </button>
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
              Quit
            </button>
          </div>
        </div>

        <div className="amerge-screen__grid bnotrf-screen__grid">
          <div className="amerge-screen__accounts">
            <MergeField label="Old Supplier A/c">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={mcode}
                  onChange={setMcode}
                  onFilterChange={handleAccountFilterChange}
                  onAfterSelect={(val) => void lookupAccount(val, setMcode, setMname, '!!! Invalid Supplier Code !!!')}
                  title="Old Supplier A/c (S or T code, optional)"
                  disabled={blocked || merging}
                  {...accountHelpPickProps(mcode)}
                />
                <input type="text" className="inttrf-screen__schname" value={mname} readOnly tabIndex={-1} />
              </div>
            </MergeField>
            <MergeField label="New Supplier A/c *">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={ncode}
                  onChange={setNcode}
                  onFilterChange={handleAccountFilterChange}
                  onAfterSelect={(val) => void lookupAccount(val, setNcode, setNname, 'Invalid New Supplier Code')}
                  title="New Supplier A/c (S or T code)"
                  disabled={blocked || merging}
                  {...accountHelpPickProps(ncode)}
                />
                <input type="text" className="inttrf-screen__schname" value={nname} readOnly tabIndex={-1} />
              </div>
            </MergeField>
          </div>

          <div className="amerge-screen__dates bnotrf-screen__bno">
            <MergeField label="Old Bikri No. *">
              <input
                type="number"
                className="inttrf-input inttrf-input--vno"
                min={0}
                step={1}
                value={bno}
                disabled={blocked || merging}
                onChange={(e) => setBno(e.target.value)}
                placeholder="B.No."
              />
            </MergeField>
            <MergeField label="New Bikri No. *">
              <input
                type="number"
                className="inttrf-input inttrf-input--vno"
                min={0}
                step={1}
                value={nbno}
                disabled={blocked || merging}
                onChange={(e) => setNbno(e.target.value)}
                placeholder="New B.No."
              />
            </MergeField>
            <p className="bnotrf-screen__hint">
              Supplier pick list shows only MASTER codes starting with <strong>S</strong> or <strong>T</strong> (same as
              VFP). Old supplier is optional — leave blank to update all rows for this B.No.
            </p>
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
