import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;
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

function parseNumInput(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** VFP DO FORM bnotrf_lot — transfer bikri no. for item+lot across tables. */
export default function Slide61BikriLotMerge({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [itemCode, setItemCode] = useState('');
  const [lot, setLot] = useState('');
  const [obno, setObno] = useState('');
  const [ncode, setNcode] = useState('');
  const [nname, setNname] = useState('');
  const [nbno, setNbno] = useState('');
  const [mcode, setMcode] = useState('');

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

  const lookupSupplier = useCallback(
    async (code) => {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) {
        setNname('');
        return false;
      }
      if (!isBikriSupplierCode(c)) {
        const msg = 'Supplier code must start with S or T.';
        setNname('');
        setErr(msg);
        alert(msg);
        return false;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-merge-lookup'), {
          params: { comp_code: compCode, comp_uid: compUid, code: c, user_name: userName || '' },
          ...reqOpts,
        });
        setNcode(String(data.code ?? c).trim().toUpperCase());
        setNname(String(data.name ?? '').trim());
        setErr('');
        return true;
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Invalid New Ledger Code';
        setNname('');
        setErr(msg);
        if (e?.response?.status === 400) alert(msg);
        return false;
      }
    },
    [apiBase, compCode, compUid, userName]
  );

  const lookupLot = useCallback(async () => {
    const ic = parseNumInput(itemCode);
    const lotNo = parseNumInput(lot);
    if (ic == null) {
      alert('Enter Item Code.');
      return false;
    }
    if (lotNo == null) {
      alert('Enter Lot.');
      return false;
    }
    setLookingUp(true);
    setErr('');
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-lot-merge-lookup'), {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          item_code: ic,
          lot: lotNo,
          user_name: userName || '',
        },
        ...reqOpts,
      });
      const ctx = data?.context ?? data;
      const sup = String(ctx.sup_code ?? ctx.ncode ?? '').trim().toUpperCase();
      const bNo = String(ctx.obno ?? ctx.b_no ?? ctx.nbno ?? '');
      setObno(bNo);
      setMcode(sup);
      setNcode(sup);
      setNname(String(ctx.name ?? '').trim());
      setNbno(String(ctx.nbno ?? ctx.b_no ?? bNo));
      return true;
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Invalid Lot';
      setObno('');
      setMcode('');
      setNcode('');
      setNname('');
      setNbno('');
      setErr(msg);
      alert(msg);
      return false;
    } finally {
      setLookingUp(false);
    }
  }, [apiBase, compCode, compUid, itemCode, lot, userName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-lot-merge-user-permissions'), {
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

    const ic = parseNumInput(itemCode);
    const lotNo = parseNumInput(lot);
    const oldBno = parseNumInput(obno);
    const newBno = parseNumInput(nbno);
    const supplier = String(ncode).trim().toUpperCase();

    if (ic == null) {
      alert('Enter Item Code.');
      return;
    }
    if (lotNo == null) {
      alert('Enter Lot.');
      return;
    }
    if (!oldBno) {
      const ok = await lookupLot();
      if (!ok) return;
    }
    if (!supplier) {
      alert('Enter Supplier A/c');
      return;
    }
    const supOk = await lookupSupplier(supplier);
    if (!supOk) return;
    if (!newBno) {
      alert('Enter New Bikri No.');
      return;
    }

    const ok = window.confirm(
      `Merge item ${ic} lot ${lotNo}: bikri ${oldBno || obno} → ${newBno}, supplier [${supplier}]?\n\nUpdates SALE, LOTSTOCK, LEDGER, VOUCHER, PURCHASE, etc. (VFP bnotrf_lot).`
    );
    if (!ok) return;

    setMerging(true);
    setErr('');
    setStatus('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/bikri-lot-merge'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          item_code: ic,
          lot: lotNo,
          mcode: String(mcode || supplier).trim().toUpperCase(),
          ncode: supplier,
          obno: oldBno || parseNumInput(obno),
          nbno: newBno,
        },
        reqOpts
      );
      const msg = data?.message || 'Merge Completed';
      setStatus(msg);
      alert(msg);
      onPrev?.();
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
      <div className="slide slide-61-bnotrf-lot bnotrf-lot-screen inttrf-screen">
        <p className="loading-msg">Loading Bikri No Trf To Lot…</p>
      </div>
    );
  }

  const blocked = !perms?.canOpen || !perms?.canEdit;

  return (
    <div className="slide slide-61-bnotrf-lot bnotrf-lot-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Bikri No Trf To Lot</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="bikri-no-trf-to-lot" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="inttrf-screen__header-panel amerge-screen__panel">
        <div className="inttrf-screen__header-top">
          <p className="amerge-screen__lead">
            Enter item code and lot — supplier and bikri no. load from LOTSTOCK (VFP DO FORM bnotrf_lot).
          </p>
          <div className="inttrf-screen__header-actions">
            <button
              type="button"
              className="btn btn-secondary inttrf-btn"
              onClick={() => void lookupLot()}
              disabled={lookingUp || blocked || merging}
            >
              {lookingUp ? 'Loading…' : 'Load Lot'}
            </button>
            <button type="button" className="btn btn-primary inttrf-btn" onClick={handleProceed} disabled={merging || blocked}>
              {merging ? 'Merging…' : 'Proceed'}
            </button>
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
              Quit
            </button>
          </div>
        </div>

        <div className="amerge-screen__grid bnotrf-lot-screen__grid">
          <div className="amerge-screen__accounts">
            <MergeField label="Item Code *">
              <input
                type="number"
                className="inttrf-input inttrf-input--vno"
                min={0}
                step={1}
                value={itemCode}
                disabled={blocked || merging}
                onChange={(e) => setItemCode(e.target.value)}
                onBlur={() => {
                  if (parseNumInput(itemCode) != null && parseNumInput(lot) != null) void lookupLot();
                }}
              />
            </MergeField>
            <MergeField label="Lot *">
              <input
                type="number"
                className="inttrf-input inttrf-input--vno"
                min={0}
                step={1}
                value={lot}
                disabled={blocked || merging}
                onChange={(e) => setLot(e.target.value)}
                onBlur={() => {
                  if (parseNumInput(itemCode) != null && parseNumInput(lot) != null) void lookupLot();
                }}
              />
            </MergeField>
            <MergeField label="Bikri No.">
              <input type="text" className="inttrf-input inttrf-input--vno" value={obno} readOnly tabIndex={-1} />
            </MergeField>
          </div>

          <div className="amerge-screen__dates bnotrf-screen__bno">
            <MergeField label="Supplier *">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={accountOptions}
                  value={ncode}
                  onChange={setNcode}
                  onFilterChange={handleAccountFilterChange}
                  onAfterSelect={(val) => void lookupSupplier(val)}
                  title="Supplier (S or T code)"
                  disabled={blocked || merging}
                  {...accountHelpPickProps(ncode)}
                />
                <input type="text" className="inttrf-screen__schname" value={nname} readOnly tabIndex={-1} />
              </div>
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
              />
            </MergeField>
            <p className="bnotrf-screen__hint">
              Tab out of Item Code / Lot or click Load Lot to fill supplier and bikri no. from LOTSTOCK. Change New Bikri
              No. before Proceed. Suppliers: codes starting with S or T only.
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
