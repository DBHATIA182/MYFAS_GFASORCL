import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toInputDateString } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import {
  buildPurExpAccountNameMap,
  purExpAccountCodeAliases,
  purExpLegacyMasterCode,
  resolvePurExpAccountName,
} from '../utils/purExpAccountCode';

const reqOpts = { withCredentials: true, timeout: 300000 };
const INTTRF_SAVE_PROGRESS_MSG = 'Saving Records Creating Journal Voucher';
const BROKER_CODE_PREFIX = 'B';
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

function codeRangeForSchedule(schno) {
  const n = Number(schno);
  if (Math.abs(n - 11.1) < 0.0001) return { scd: 'S00001', ecd: 'S99999' };
  return { scd: 'C00001', ecd: 'E00001' };
}

function minAmtForMdc(mdc) {
  return String(mdc || '').trim().toUpperCase() === 'D' ? 100 : -99999;
}

function formatScheduleNo(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '');
  return x.toFixed(2);
}

function InttrfField({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function mapGridRow(r, idx) {
  return {
    _id: `${r.CODE}-${r.BILL_DATE}-${r.BILL_NO}-${idx}`,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    CITY: String(r.CITY ?? r.city ?? '').trim(),
    BILL_DATE: toInputDateString(r.BILL_DATE ?? r.bill_date),
    BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '').trim(),
    DR_AMT: formatAmt2(r.DR_AMT ?? r.dr_amt),
    CR_AMT: formatAmt2(r.CR_AMT ?? r.cr_amt),
    CLBAL: formatAmt2(r.CLBAL ?? r.clbal),
    TOT_TRF: formatAmt2(r.TOT_TRF ?? r.tot_trf),
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
  };
}

/** VFP DO FORM INTTRF — interest transfer into JV vouchers. */
export default function Slide55InterestTransfer({ apiBase, formData, userName, onPrev }) {
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
  const [schno, setSchno] = useState('8.1');
  const [schName, setSchName] = useState('');
  const [vrNo, setVrNo] = useState('');
  const [mdc, setMdc] = useState('C');
  const [trfCodeDr, setTrfCodeDr] = useState('');
  const [trfCodeCr, setTrfCodeCr] = useState('');
  const [minAmt, setMinAmt] = useState('-99999');
  const [scd, setScd] = useState('C00001');
  const [ecd, setEcd] = useState('E00001');
  const [bkCode, setBkCode] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [oby, setOby] = useState('C');
  const [lC, setLC] = useState('');
  const [bType, setBType] = useState('');
  const [mDetail, setMDetail] = useState('TRANS');
  const [amt1, setAmt1] = useState('0');
  const [amt2, setAmt2] = useState('0');
  const [svno, setSvno] = useState('0');
  const [evno, setEvno] = useState('0');

  const [gridAll, setGridAll] = useState([]);
  const [gridRows, setGridRows] = useState([]);

  const [accounts, setAccounts] = useState([]);
  const [brokerAccounts, setBrokerAccounts] = useState([]);
  const [schedules, setSchedules] = useState([]);

  const accountOptions = useMemo(() => accounts.map(mapAccountPickOption), [accounts]);
  const brokerOptions = useMemo(() => brokerAccounts.map(mapAccountPickOption), [brokerAccounts]);
  const scheduleOptions = useMemo(() => schedules.map(mapSchedulePickOption), [schedules]);
  const brokerNameByCode = useMemo(() => buildPurExpAccountNameMap(brokerAccounts), [brokerAccounts]);
  const accountSearchDebounceRef = useRef(null);
  const brokerSearchDebounceRef = useRef(null);

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

  const fetchBrokers = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      const trimmed = String(q ?? '').trim();
      if (!trimmed) {
        setBrokerAccounts([]);
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code_prefix: BROKER_CODE_PREFIX,
            q: trimmed,
          },
          ...reqOpts,
        });
        setBrokerAccounts(Array.isArray(data) ? data : []);
      } catch {
        setBrokerAccounts([]);
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

  const handleBrokerFilterChange = useCallback(
    (q) => {
      if (brokerSearchDebounceRef.current) clearTimeout(brokerSearchDebounceRef.current);
      brokerSearchDebounceRef.current = setTimeout(() => {
        void fetchBrokers(q);
      }, ACCOUNT_SEARCH_DEBOUNCE_MS);
    },
    [fetchBrokers]
  );

  useEffect(
    () => () => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
      if (brokerSearchDebounceRef.current) clearTimeout(brokerSearchDebounceRef.current);
    },
    []
  );

  useEffect(() => {
    if (!perms?.canOpen || loading) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-accounts'), {
        params: { comp_code: compCode, comp_uid: compUid, code_prefix: BROKER_CODE_PREFIX },
        ...reqOpts,
      })
      .then(({ data }) => {
        if (!cancelled) setBrokerAccounts(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, perms?.canOpen, loading]);

  const applyInitContext = useCallback((ctx) => {
    if (!ctx) return;
    setEdt(toInputDateString(ctx.edt) || toInputDateString(new Date()));
    const sch = Number(ctx.schno ?? 8.1) || 8.1;
    setSchno(formatScheduleNo(sch));
    setSchName(String(ctx.sch_name ?? ctx.schName ?? '').trim());
    setVrNo(String(ctx.vr_no ?? ctx.vr_no ?? ''));
    setMdc(String(ctx.mdc ?? 'C').trim().toUpperCase().slice(0, 1) || 'C');
    setTrfCodeDr(String(ctx.trf_code_dr ?? ctx.trfcode ?? '').trim());
    setTrfCodeCr(String(ctx.trf_code_cr ?? ctx.trfcodecr ?? '').trim());
    setMinAmt(String(ctx.minamt ?? minAmtForMdc(ctx.mdc)));
    setScd(String(ctx.scd ?? codeRangeForSchedule(sch).scd));
    setEcd(String(ctx.ecd ?? codeRangeForSchedule(sch).ecd));
    setOby(String(ctx.oby ?? 'C').trim().toUpperCase().slice(0, 1) || 'C');
    setMDetail(String(ctx.m_detail ?? 'TRANS').trim());
    setGridAll([]);
    setGridRows([]);
    setAmt1('0');
    setAmt2('0');
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
          axios.get(apiUrl(apiBase, '/api/inttrf-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/inttrf-init'), {
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
    const range = codeRangeForSchedule(n || val);
    setScd(range.scd);
    setEcd(range.ecd);
    const opt = scheduleOptions.find((o) => Math.abs(Number(o.NO) - n) < 0.0001);
    setSchName(String(opt?.label ?? opt?.NAME ?? '').trim());
  };

  const handleMdcChange = (val) => {
    const v = String(val || '').trim().toUpperCase().slice(0, 1) || 'C';
    setMdc(v);
    setMinAmt(String(minAmtForMdc(v)));
  };

  const buildProceedPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    edt,
    schno: Number(schno) || 8.1,
    minamt: Number(minAmt) || 0,
    mdc,
    scd,
    ecd,
    l_c: lC,
    b_type: bType,
    bk_code: bkCode,
    oby,
    trf_code_dr: trfCodeDr,
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/inttrf-proceed'), buildProceedPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridAll(rows);
      setGridRows(rows);
      setAmt1('0');
      setAmt2('0');
      if (!rows.length) alert('No records found for the current filters.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  const applyAmountFilter = () => {
    const a1 = Math.abs(Number(amt1) || 0);
    const a2 = Math.abs(Number(amt2) || 0);
    const lo = Math.min(a1, a2);
    const hi = Math.max(a1, a2);
    if (hi === 0 && lo === 0) {
      setGridRows(gridAll);
      return;
    }
    setGridRows(
      gridAll.filter((r) => {
        const abs = Math.abs(Number(String(r.CLBAL).replace(/,/g, '')) || 0);
        return abs >= lo && abs <= hi;
      })
    );
  };

  const toggleRowSelect = (id) => {
    setGridRows((prev) =>
      prev.map((r) => (r._id === id ? { ...r, SLCT: !r.SLCT } : r))
    );
    setGridAll((prev) =>
      prev.map((r) => (r._id === id ? { ...r, SLCT: !r.SLCT } : r))
    );
  };

  const selectAllRows = () => {
    const mark = (rows) => rows.map((r) => ({ ...r, SLCT: true }));
    setGridRows(mark);
    setGridAll(mark);
  };

  const clearAllRows = () => {
    const mark = (rows) => rows.map((r) => ({ ...r, SLCT: false }));
    setGridRows(mark);
    setGridAll(mark);
  };

  const handleSave = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    const selected = gridAll.filter((r) => r.SLCT);
    if (!selected.length) {
      alert('Select at least one row to save.');
      return;
    }
    setSaving(true);
    setSaveStatus(INTTRF_SAVE_PROGRESS_MSG);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/inttrf-save'),
        {
          ...buildProceedPayload(),
          comp_year: compYear,
          vr_no: Number(vrNo) || 0,
          trf_code_cr: trfCodeCr,
          m_detail: mDetail,
          rows: selected.map((r) => ({
            CODE: r.CODE,
            BILL_DATE: r.BILL_DATE,
            BILL_NO: r.BILL_NO,
            B_TYPE: r.B_TYPE,
            CLBAL: Number(String(r.CLBAL).replace(/,/g, '')) || 0,
            SLCT: 'Y',
          })),
        },
        reqOpts
      );
      setSaveStatus('');
      alert(data?.message || 'DONE');
      if (data?.next_vr_no != null) setVrNo(String(data.next_vr_no));
      setGridAll([]);
      setGridRows([]);
      const initRes = await axios.get(apiUrl(apiBase, '/api/inttrf-init'), {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          comp_year: compYear,
          user_name: userName || '',
          comp_e_dt: fyEndDate,
          edt,
          schno,
          mdc,
        },
        ...reqOpts,
      });
      applyInitContext({ ...initRes.data?.context, vr_no: data?.next_vr_no ?? initRes.data?.context?.vr_no });
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
    if (!window.confirm(`Delete JV vouchers ${s}–${e} dated ${formatLedgerDateDisplay(edt)}?`)) return;
    setDeleting(true);
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/inttrf-delete-vouchers'),
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
      City: r.CITY,
      'Bill Date': formatLedgerDateDisplay(r.BILL_DATE),
      'Bill No': r.BILL_NO,
      'B Type': r.B_TYPE,
      'Dr Amt': r.DR_AMT,
      'Cr Amt': r.CR_AMT,
      Clbal: r.CLBAL,
      'Tot Trf': r.TOT_TRF,
      Select: r.SLCT ? 'Y' : '',
    }));
    downloadExcelRows(rows, 'InterestTransfer', `${compName || 'Company'}_InterestTransfer`);
  };

  const accountCodesMatch = useCallback((left, right) => {
    const rightAliases = new Set(purExpAccountCodeAliases(right));
    return purExpAccountCodeAliases(left).some((alias) => rightAliases.has(alias));
  }, []);

  const validateTrfCodeOnBlur = useCallback(
    async (code, setter) => {
      const raw = String(code || '').trim().toUpperCase();
      if (!raw) return;
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
            if (canonical) setter(canonical);
            return;
          }
        }
        alert('!!! Invalid A/c Code !!!');
        setter('');
      } catch {
        alert('!!! Invalid A/c Code !!!');
        setter('');
      }
    },
    [accountCodesMatch, apiBase, compCode, compUid]
  );

  if (loading) {
    return (
      <div className="slide slide-55-inttrf inttrf-screen">
        <p className="loading-msg">Loading Interest Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-55-inttrf inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Interest Transfer</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="interest-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="inttrf-screen__header-panel">
        <div className="inttrf-screen__header-top">
          <InttrfField label="Schedule No." className="inttrf-field--schedule">
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
          </InttrfField>
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
            <InttrfField label="Ending Date">
              <input
                type="date"
                className="inttrf-input"
                value={edt}
                max={toInputDateString(fyEndDate) || undefined}
                onChange={(e) => setEdt(e.target.value)}
              />
            </InttrfField>
            <InttrfField label="Voucher No.">
              <input
                type="number"
                className="inttrf-input inttrf-input--num"
                min="10000"
                value={vrNo}
                onChange={(e) => setVrNo(e.target.value)}
              />
            </InttrfField>
            <InttrfField label="(D)/(C)">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={mdc}
                onChange={(e) => handleMdcChange(e.target.value)}
              />
            </InttrfField>
            <InttrfField label="Trf.Code Dr.">
              <MasterPartyPickList
                options={accountOptions}
                value={trfCodeDr}
                onChange={setTrfCodeDr}
                onFilterChange={handleAccountFilterChange}
                title="Transfer Debit Code"
                {...accountHelpPickProps(trfCodeDr)}
                onAfterSelect={(val) => void validateTrfCodeOnBlur(val, setTrfCodeDr)}
              />
            </InttrfField>
          </div>

          <div className="inttrf-screen__header-row">
            <InttrfField label="Min Dr.Amt.">
              <input
                type="number"
                className="inttrf-input inttrf-input--num"
                value={minAmt}
                onChange={(e) => setMinAmt(e.target.value)}
              />
            </InttrfField>
            <InttrfField label="Starting Code">
              <input
                type="text"
                className="inttrf-input inttrf-input--code"
                maxLength={6}
                value={scd}
                onChange={(e) => setScd(e.target.value.toUpperCase())}
              />
            </InttrfField>
            <InttrfField label="Ending Code">
              <input
                type="text"
                className="inttrf-input inttrf-input--code"
                maxLength={6}
                value={ecd}
                onChange={(e) => setEcd(e.target.value.toUpperCase())}
              />
            </InttrfField>
            <InttrfField label="Trf.Code Cr.">
              <MasterPartyPickList
                options={accountOptions}
                value={trfCodeCr}
                onChange={setTrfCodeCr}
                onFilterChange={handleAccountFilterChange}
                title="Transfer Credit Code"
                {...accountHelpPickProps(trfCodeCr)}
                onAfterSelect={(val) => void validateTrfCodeOnBlur(val, setTrfCodeCr)}
              />
            </InttrfField>
          </div>

          <div className="inttrf-screen__header-row">
            <InttrfField label="Starting Broker" className="inttrf-field--wide">
              <div className="inttrf-screen__inline-pair">
                <MasterPartyPickList
                  options={brokerOptions}
                  value={bkCode}
                  onChange={(v) => {
                    setBkCode(v);
                    setBrokerName(resolvePurExpAccountName(v, brokerNameByCode) || '');
                  }}
                  onFilterChange={handleBrokerFilterChange}
                  title="Broker"
                  {...accountHelpPickProps(bkCode)}
                />
                <input type="text" className="inttrf-screen__schname" value={brokerName} readOnly tabIndex={-1} />
              </div>
            </InttrfField>
            <InttrfField label="Order By">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={oby}
                onChange={(e) => setOby(e.target.value.toUpperCase().slice(0, 1))}
              />
            </InttrfField>
            <InttrfField label="(L)/(C)">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={lC}
                onChange={(e) => setLC(e.target.value.toUpperCase().slice(0, 1))}
              />
            </InttrfField>
            <InttrfField label="BType">
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={bType}
                onChange={(e) => setBType(e.target.value.toUpperCase().slice(0, 1))}
              />
            </InttrfField>
          </div>

          <div className="inttrf-screen__header-row inttrf-screen__header-row--detail">
            <InttrfField label="Detail" className="inttrf-field--detail">
              <input type="text" className="inttrf-input" value={mDetail} onChange={(e) => setMDetail(e.target.value)} />
            </InttrfField>
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
              <th>City</th>
              <th>Bill_date</th>
              <th>Bill_no</th>
              <th>B_t</th>
              <th className="amount">Dr_amt</th>
              <th className="amount">Cr_amt</th>
              <th className="amount">Clbal</th>
              <th className="amount">Tot_trf</th>
            </tr>
          </thead>
          <tbody>
            {gridRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="inttrf-screen__grid-empty">
                  Click Proceed to load bill balances.
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
                  <td>{r.CITY}</td>
                  <td>{formatLedgerDateDisplay(r.BILL_DATE)}</td>
                  <td>{r.BILL_NO}</td>
                  <td>{r.B_TYPE}</td>
                  <td className="amount">{r.DR_AMT}</td>
                  <td className="amount">{r.CR_AMT}</td>
                  <td className="amount">{r.CLBAL}</td>
                  <td className="amount">{r.TOT_TRF}</td>
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
            <span className="inttrf-screen__footer-label">Delete Prev.Vouchers</span>
            <div className="inttrf-screen__footer-delete-row">
              <input type="number" className="inttrf-input inttrf-input--vno" value={svno} onChange={(e) => setSvno(e.target.value)} />
              <input type="number" className="inttrf-input inttrf-input--vno" value={evno} onChange={(e) => setEvno(e.target.value)} />
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleDeleteVouchers} disabled={deleting}>
                Delete
              </button>
            </div>
          </div>

          <div className="inttrf-screen__footer-filter">
            <span className="inttrf-screen__footer-label inttrf-screen__footer-label--filter">← Filter Amount</span>
            <div className="inttrf-screen__footer-filter-row">
              <input type="number" className="inttrf-input inttrf-input--vno" value={amt1} onChange={(e) => setAmt1(e.target.value)} />
              <input type="number" className="inttrf-input inttrf-input--vno" value={amt2} onChange={(e) => setAmt2(e.target.value)} />
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={applyAmountFilter}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
