import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toInputDateString } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import {
  buildPurExpAccountNameMap,
  purExpLegacyMasterCode,
  resolvePurExpAccountName,
} from '../utils/purExpAccountCode';

const reqOpts = { withCredentials: true, timeout: 120000 };
const BROKER_SCHEDULE = '11.20';
const PARTY_CODE_PREFIX = 'CS';
const PARTY_SEARCH_DEBOUNCE_MS = 280;

function mapAccountPickOption(a) {
  return {
    value: String(a.CODE ?? a.code ?? '').trim(),
    label: String(a.NAME ?? a.name ?? '').trim(),
    CODE: a.CODE ?? a.code,
    NAME: a.NAME ?? a.name,
    CITY: String(a.CITY ?? a.city ?? '').trim(),
    GST_NO: String(a.GST_NO ?? a.gst_no ?? '').trim(),
    PAN: String(a.PAN ?? a.pan ?? '').trim(),
    TEL_NO_O: String(a.TEL_NO_O ?? a.tel_no_o ?? '').trim(),
  };
}

function formatOpdetBillsSaveMessage(data) {
  const lines = Array.isArray(data?.bills_lines ?? data?.BILLS_LINES) ? data.bills_lines ?? data.BILLS_LINES : [];
  if (!lines.length) return data?.message || 'Saved successfully.';
  const parts = lines.map((r, i) => {
    const dr = Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    const cr = Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    const label = i === 0 && String(r.DETAIL ?? r.detail ?? '').trim() ? 'Bill' : `Pmt ${i || 1}`;
    return `${label}: DR ${dr.toFixed(2)} / CR ${cr.toFixed(2)}`;
  });
  return `${data?.message || 'Saved successfully.'}\nBILLS (VR_TYPE=OP): ${parts.join(' · ')}`;
}

function accountHelpPickProps(triggerCode, { onFilterChange, showAllWhenEmpty = false } = {}) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty,
    onFilterChange,
    filterPlaceholder: 'Type name, city, GST, PAN, tel or code…',
    getValue: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
    getOptionCity: (o) => String(o.CITY ?? '').trim(),
    getOptionGst: (o) => String(o.GST_NO ?? '').trim(),
    getOptionPan: (o) => String(o.PAN ?? '').trim(),
    getOptionTel: (o) => String(o.TEL_NO_O ?? '').trim(),
  };
}

function maxDateBeforeFyStart(fyStartRaw) {
  const s = toInputDateString(fyStartRaw);
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return '';
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isDateBeforeFyStart(dateVal, fyStartRaw) {
  const d = toInputDateString(dateVal);
  const fy = toInputDateString(fyStartRaw);
  if (!d || !fy) return false;
  return d < fy;
}

function validateOpdetOpeningDates({ billDate, lines, fyStart }) {
  const fy = toInputDateString(fyStart);
  if (!fy) return 'Financial year start date is missing. Re-select the year.';
  if (!isDateBeforeFyStart(billDate, fy)) {
    return 'Bill Date must be before financial year start.';
  }
  for (const line of lines || []) {
    const pmt = toInputDateString(line.PMT_DATE ?? line.pmt_date);
    const trn = line.TRN_NO ?? line.trn_no ?? '';
    if (pmt && !isDateBeforeFyStart(pmt, fy)) {
      return `Payment date on line ${trn || '?'} must be before financial year start.`;
    }
  }
  return '';
}

function formatAmt2(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function amtInputVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function parseAmtInput(raw) {
  let s = String(raw ?? '').replace(/,/g, '').trim();
  if (s === '' || s === '-') return s;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const dotIdx = s.indexOf('.');
  if (dotIdx >= 0) {
    s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, '');
  }
  if (neg) s = `-${s}`;
  if (!/^-?[\d.]*$/.test(s)) return null;
  const body = neg ? s.slice(1) : s;
  const parts = body.split('.');
  if (parts.length > 2) return null;
  if (parts[1] != null && parts[1].length > 2) return null;
  return neg ? `-${body}` : body;
}

function calcDaysBetween(billDate, vDate) {
  const b = toInputDateString(billDate);
  const v = toInputDateString(vDate);
  if (!b || !v) return '';
  const bd = new Date(`${b}T00:00:00`);
  const vd = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(bd.getTime()) || !Number.isFinite(vd.getTime())) return '';
  const d = Math.round((vd - bd) / 86400000);
  return d >= 0 ? String(d) : '0';
}

function mapListRow(r) {
  return {
    OP_NO: Number(r.OP_NO ?? r.op_no ?? 0) || 0,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
    B_CODE: String(r.B_CODE ?? r.b_code ?? '').trim(),
    BROKER_NAME: String(r.BROKER_NAME ?? r.broker_name ?? '').trim(),
    BILL_DATE: toInputDateString(r.BILL_DATE ?? r.bill_date),
    BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
    BILL_AMT: formatAmt2(r.BILL_AMT ?? r.bill_amt),
    LINE_CNT: Number(r.LINE_CNT ?? r.line_cnt ?? 0) || 0,
    PMT_PREVIEW: String(r.PMT_PREVIEW ?? r.pmt_preview ?? '').trim(),
  };
}

function emptyLine(trnNo = 1) {
  return {
    TRN_NO: trnNo,
    PMT_DATE: '',
    PMT_AMT: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function mapLinesFromApi(lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return [emptyLine(1)];
  return list.map((l, i) => ({
    _id: `${l.TRN_NO ?? l.trn_no ?? i}-${Math.random()}`,
    TRN_NO: Number(l.TRN_NO ?? l.trn_no ?? i + 1) || i + 1,
    PMT_DATE: toInputDateString(l.PMT_DATE ?? l.pmt_date),
    PMT_AMT: amtInputVal(formatAmt2(l.PMT_AMT ?? l.pmt_amt)),
  }));
}

function lineCellId(idx, field) {
  return `opdet-${idx}-${field}`;
}

const OPDET_FOCUS_FIELDS = [
  'opdet-party-code',
  'opdet-broker-code',
  'opdet-bill-date',
  'opdet-bill-no',
  'opdet-v-date',
  'opdet-days',
  'opdet-bill-amt',
];

function focusOpdetField(fieldId) {
  const el =
    document.getElementById(fieldId) ||
    document.querySelector(`[data-mp-field="${fieldId}"]`);
  if (!(el instanceof HTMLElement) || el.disabled) return false;
  el.focus();
  if (el instanceof HTMLInputElement && !el.readOnly) {
    try {
      el.select();
    } catch {
      /* ignore */
    }
  }
  return true;
}

function focusNextOpdetField(fieldId) {
  const idx = OPDET_FOCUS_FIELDS.indexOf(fieldId);
  if (idx < 0) return false;
  const nextId = OPDET_FOCUS_FIELDS[idx + 1];
  if (!nextId) {
    focusLineCell(0, 'PMT_DATE');
    return true;
  }
  return focusOpdetField(nextId);
}

function resolveOpdetFieldId(target) {
  if (!(target instanceof HTMLElement)) return '';
  if (target.id && OPDET_FOCUS_FIELDS.includes(target.id)) return target.id;
  const mp = target.getAttribute('data-mp-field');
  if (mp && OPDET_FOCUS_FIELDS.includes(mp)) return mp;
  const trigger = target.closest('.master-party-pick')?.querySelector('.master-party-pick__trigger');
  const fromTrigger = trigger?.getAttribute('data-mp-field');
  if (fromTrigger && OPDET_FOCUS_FIELDS.includes(fromTrigger)) return fromTrigger;
  return '';
}

function focusLineCell(idx, field) {
  const el = document.getElementById(lineCellId(idx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

function opdetReportPartyTotals(partyLines) {
  let bill = 0;
  let pmt = 0;
  for (const r of partyLines || []) {
    const trn = Number(r?.TRN_NO ?? r?.trn_no ?? 0) || 0;
    if (trn === 1) bill += Number(r?.BILL_AMT ?? r?.bill_amt ?? 0) || 0;
    pmt += Number(r?.PMT_AMT ?? r?.pmt_amt ?? 0) || 0;
  }
  return { bill, pmt, balance: bill - pmt };
}

function groupOpdetReportLines(lines) {
  const groups = [];
  const map = new Map();
  for (const r of lines || []) {
    const code = String(r?.CODE ?? r?.code ?? '').trim();
    if (!map.has(code)) {
      const g = { code, name: String(r?.AC_NAME ?? r?.ac_name ?? '').trim(), lines: [] };
      map.set(code, g);
      groups.push(g);
    }
    map.get(code).lines.push(r);
  }
  return groups;
}

function buildOpdetReportExcelRows(lines) {
  const groups = groupOpdetReportLines(lines);
  const out = [];
  let grandBill = 0;
  let grandPmt = 0;
  for (const g of groups) {
    for (const r of g.lines) {
      out.push({
        'Party Code': g.code,
        'Party Name': g.name,
        'B.Date': formatLedgerDateDisplay(r?.BILL_DATE ?? r?.bill_date),
        'B.No.': r?.BILL_NO ?? r?.bill_no ?? '',
        'V.Date': formatLedgerDateDisplay(r?.V_DATE ?? r?.v_date),
        Dys: r?.DAYS ?? r?.days ?? '',
        'Bill.Amt.': Number(r?.BILL_AMT ?? r?.bill_amt ?? 0) || 0,
        'Pmt.Date': formatLedgerDateDisplay(r?.PMT_DATE ?? r?.pmt_date),
        'Pmt.Amt.': Number(r?.PMT_AMT ?? r?.pmt_amt ?? 0) || 0,
        'Broker Code': r?.B_CODE ?? r?.b_code ?? '',
        'Broker Name': r?.BROKER_NAME ?? r?.broker_name ?? '',
        'Sr.No.': r?.OP_NO ?? r?.op_no ?? '',
      });
    }
    const t = opdetReportPartyTotals(g.lines);
    grandBill += t.bill;
    grandPmt += t.pmt;
    out.push({
      'Party Code': g.code,
      'Party Name': `${g.name} — TOTAL`,
      'Bill.Amt.': t.bill,
      'Pmt.Amt.': t.pmt,
      Balance: t.balance,
    });
  }
  out.push({
    'Party Name': 'G.TOTAL',
    'Bill.Amt.': grandBill,
    'Pmt.Amt.': grandPmt,
    Balance: grandBill - grandPmt,
  });
  return out;
}

/** VFP DO FORM OPDET — opening bills header + payment lines. */
export default function Slide54OpeningBillsDetail({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const fyStartDate = formData.comp_s_dt ?? formData.COMP_S_DT;
  const opdetMaxDate = useMemo(() => maxDateBeforeFyStart(fyStartDate), [fyStartDate]);

  const formRef = useRef(null);
  const newBtnRef = useRef(null);
  const focusPartyAfterNewRef = useRef(false);
  const partySearchDebounceRef = useRef(null);
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [selectedOpNo, setSelectedOpNo] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [brokerAccounts, setBrokerAccounts] = useState([]);

  const [mode, setMode] = useState('');
  const [opNo, setOpNo] = useState('');
  const [code, setCode] = useState('');
  const [acName, setAcName] = useState('');
  const [bCode, setBCode] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [billDate, setBillDate] = useState('');
  const [billNo, setBillNo] = useState('');
  const [vDate, setVDate] = useState('');
  const [days, setDays] = useState('');
  const [billAmt, setBillAmt] = useState('');
  const [bType, setBType] = useState('N');
  const [lines, setLines] = useState([emptyLine(1)]);
  const [selectedLineIdx, setSelectedLineIdx] = useState(0);
  const [billsLines, setBillsLines] = useState([]);

  const accountOptions = useMemo(() => accounts.map(mapAccountPickOption), [accounts]);

  const brokerOptions = useMemo(() => brokerAccounts.map(mapAccountPickOption), [brokerAccounts]);

  const accountNameByCode = useMemo(() => buildPurExpAccountNameMap(accounts), [accounts]);
  const brokerNameByCode = useMemo(() => buildPurExpAccountNameMap(brokerAccounts), [brokerAccounts]);

  const selectedRow = useMemo(
    () => rows.find((r) => Number(r.OP_NO) === Number(selectedOpNo)) || null,
    [rows, selectedOpNo]
  );

  const formDisabled = mode === '' || mode === 'del';
  const partyCodeDisabled = formDisabled || mode === 'edit';
  const headerDisabled = formDisabled;
  const linesDisabled = formDisabled || mode === 'del';

  const clearForm = useCallback(() => {
    setOpNo('');
    setCode('');
    setAcName('');
    setBCode('');
    setBrokerName('');
    setBillDate('');
    setBillNo('');
    setVDate('');
    setDays('');
    setBillAmt('');
    setBType('N');
    setLines([emptyLine(1)]);
    setSelectedLineIdx(0);
    setBillsLines([]);
  }, []);

  const loadRecordToForm = useCallback(
    async (ono) => {
      const n = Number(ono) || 0;
      if (!n) {
        clearForm();
        return;
      }
      const { data } = await axios.get(apiUrl(apiBase, '/api/opdet'), {
        params: { comp_code: compCode, comp_uid: compUid, op_no: n },
        ...reqOpts,
      });
      setOpNo(String(data.OP_NO ?? data.op_no ?? n));
      const c = String(data.CODE ?? data.code ?? '').trim();
      setCode(c);
      setAcName(
        resolvePurExpAccountName(c, accountNameByCode) || String(data.AC_NAME ?? data.ac_name ?? '').trim()
      );
      const bc = String(data.B_CODE ?? data.b_code ?? '').trim();
      setBCode(bc);
      setBrokerName(
        resolvePurExpAccountName(bc, brokerNameByCode) ||
          resolvePurExpAccountName(bc, accountNameByCode) ||
          String(data.BROKER_NAME ?? data.broker_name ?? '').trim()
      );
      setBillDate(toInputDateString(data.BILL_DATE ?? data.bill_date));
      setBillNo(String(data.BILL_NO ?? data.bill_no ?? '') || '');
      setVDate(toInputDateString(data.V_DATE ?? data.v_date));
      setDays(String(data.DAYS ?? data.days ?? '') || '');
      setBillAmt(amtInputVal(formatAmt2(data.BILL_AMT ?? data.bill_amt)));
      setBType(String(data.B_TYPE ?? data.b_type ?? 'N').trim() || 'N');
      setLines(mapLinesFromApi(data.lines));
      setSelectedLineIdx(0);
      const bl = Array.isArray(data.bills_lines ?? data.BILLS_LINES) ? data.bills_lines ?? data.BILLS_LINES : [];
      setBillsLines(bl);
    },
    [apiBase, compCode, compUid, accountNameByCode, brokerNameByCode, clearForm]
  );

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/opdet-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapListRow) : []);
      } catch (e) {
        if (isStale()) return;
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase, compCode, compUid]
  );

  const { executeSearch, refreshList } = useDebouncedMasterSearch({
    enabled: !loading && !!perms?.canOpen,
    onSearch,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/opdet-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data);
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

  const fetchPartyAccounts = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      const trimmed = String(q ?? '').trim();
      if (!trimmed) {
        setAccounts([]);
        return;
      }
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code_prefix: PARTY_CODE_PREFIX,
            q: trimmed,
          },
          ...reqOpts,
        });
        setAccounts(Array.isArray(data) ? data : []);
      } catch {
        setAccounts([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handlePartyFilterChange = useCallback(
    (q) => {
      if (partySearchDebounceRef.current) clearTimeout(partySearchDebounceRef.current);
      partySearchDebounceRef.current = setTimeout(() => {
        void fetchPartyAccounts(q);
      }, PARTY_SEARCH_DEBOUNCE_MS);
    },
    [fetchPartyAccounts]
  );

  useEffect(
    () => () => {
      if (partySearchDebounceRef.current) clearTimeout(partySearchDebounceRef.current);
    },
    []
  );

  useEffect(() => {
    if (!perms?.canOpen || loading) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-accounts'), {
        params: { comp_code: compCode, comp_uid: compUid, schedule: BROKER_SCHEDULE, code_prefix: 'B' },
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

  useEffect(() => {
    if (!code || !perms?.canOpen) return;
    void fetchPartyAccounts(code);
  }, [code, perms?.canOpen, fetchPartyAccounts]);

  useEffect(() => {
    if (!accountNameByCode.size) return;
    if (code) {
      const name = resolvePurExpAccountName(code, accountNameByCode);
      if (name) setAcName(name);
    }
  }, [accountNameByCode, code]);

  useEffect(() => {
    if (!brokerNameByCode.size && !accountNameByCode.size) return;
    if (bCode) {
      const name =
        resolvePurExpAccountName(bCode, brokerNameByCode) ||
        resolvePurExpAccountName(bCode, accountNameByCode);
      if (name) setBrokerName(name);
    }
  }, [brokerNameByCode, accountNameByCode, bCode]);

  useEffect(() => {
    if (formDisabled) return;
    const d = calcDaysBetween(billDate, vDate);
    if (d !== '') setDays(d);
  }, [billDate, vDate, formDisabled]);

  const setCodeCell = (raw) => {
    const c = purExpLegacyMasterCode(raw) || String(raw ?? '').trim().toUpperCase().slice(0, 6);
    setCode(c);
    setAcName(c ? resolvePurExpAccountName(c, accountNameByCode) : '');
  };

  const setBCodeCell = (raw) => {
    const c = purExpLegacyMasterCode(raw) || String(raw ?? '').trim().toUpperCase().slice(0, 6);
    setBCode(c);
    setBrokerName(
      c
        ? resolvePurExpAccountName(c, brokerNameByCode) || resolvePurExpAccountName(c, accountNameByCode)
        : ''
    );
  };

  const setLineCell = (idx, key, value) => {
    setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleAddLine = () => {
    setLines((prev) => {
      const maxTrn = prev.reduce((m, r) => Math.max(m, Number(r.TRN_NO) || 0), 0);
      const next = [...prev, emptyLine(maxTrn + 1)];
      setSelectedLineIdx(next.length - 1);
      return next;
    });
  };

  const handleRemoveLine = (idx) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const kept = next.length ? next : [emptyLine(1)];
      setSelectedLineIdx((sel) => {
        if (sel === idx) return Math.max(0, Math.min(idx, kept.length - 1));
        if (sel > idx) return sel - 1;
        return sel;
      });
      return kept;
    });
  };

  const handleDeleteSelectedLine = () => {
    if (linesDisabled || saving) return;
    if (lines.length <= 1) {
      alert('At least one payment line is required.');
      return;
    }
    handleRemoveLine(selectedLineIdx);
  };

  const handleSelectRow = async (row) => {
    if (mode === 'new' || mode === 'edit') return;
    const n = Number(row.OP_NO) || 0;
    setSelectedOpNo(n);
    setMode('');
    try {
      await loadRecordToForm(n);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const focusPartyCodeField = useCallback(() => {
    window.setTimeout(() => focusOpdetField('opdet-party-code'), 50);
  }, []);

  const handleNew = async ({ focusParty = false } = {}) => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/opdet-next-opno'), {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      });
      const next = Number(data?.next_opno ?? data?.NEXT_OPNO ?? 0) || 0;
      setMode('new');
      setSelectedOpNo(0);
      setOpNo(String(next));
      setCode('');
      setAcName('');
      setBCode('');
      setBrokerName('');
      setBillDate('');
      setBillNo('');
      setVDate('');
      setDays('');
      setBillAmt('');
      setBType('N');
      setLines([emptyLine(1)]);
      setSelectedLineIdx(0);
      if (focusParty) focusPartyAfterNewRef.current = true;
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Could not get next Sr.No');
    }
  };

  const handleNewKeyDown = (e) => {
    if (e.key !== 'Enter' || saving || mode !== '') return;
    e.preventDefault();
    void handleNew({ focusParty: true });
  };

  const handleEdit = async () => {
    if (!selectedRow) {
      alert('Select a record from the list first.');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setMode('edit');
    try {
      await loadRecordToForm(selectedRow.OP_NO);
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const handleDeleteMode = async () => {
    if (!selectedRow) {
      alert('Select a record from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    setMode('del');
    try {
      await loadRecordToForm(selectedRow.OP_NO);
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const handleCancelMode = () => {
    setMode('');
    if (selectedRow) loadRecordToForm(selectedRow.OP_NO).catch(() => clearForm());
    else clearForm();
  };

  const handleSave = async () => {
    const on = Number(opNo) || 0;
    const c = String(code ?? '').trim();
    if (!on) {
      alert('Sr.No is required.');
      return;
    }
    if (!c) {
      alert('Party Code is required.');
      return;
    }
    if (!toInputDateString(billDate)) {
      alert('Bill Date is required.');
      return;
    }
    const dateErr = validateOpdetOpeningDates({ billDate, lines, fyStart: fyStartDate });
    if (dateErr) {
      alert(dateErr);
      return;
    }
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      comp_s_dt: toInputDateString(fyStartDate),
      user_name: userName,
      op_no: on,
      code: c,
      ac_name: String(acName ?? '').trim(),
      b_type: String(bType ?? 'N').trim() || 'N',
      b_code: String(bCode ?? '').trim(),
      bill_date: toInputDateString(billDate),
      bill_no: Number(billNo) || 0,
      v_date: toInputDateString(vDate) || null,
      days: Number(days) || 0,
      bill_amt: Number(parseAmtInput(billAmt) || 0) || 0,
      lines: lines.map(({ _id, ...l }) => ({
        TRN_NO: l.TRN_NO,
        PMT_DATE: toInputDateString(l.PMT_DATE),
        PMT_AMT: Number(parseAmtInput(l.PMT_AMT) || 0) || 0,
      })),
    };

    setSaving(true);
    setErr('');
    try {
      if (mode === 'del') {
        if (!window.confirm(`Delete opening bills record Sr.No ${on}?`)) {
          setSaving(false);
          return;
        }
        await axios.delete(apiUrl(apiBase, '/api/opdet'), { data: payload, ...reqOpts });
        alert('Entry deleted.');
        setMode('');
        setSelectedOpNo(0);
        clearForm();
        refreshList();
        return;
      }

      if (mode === 'new') {
        if (!perms?.canAdd) {
          alert('You Can Not Add');
          return;
        }
        const { data } = await axios.post(apiUrl(apiBase, '/api/opdet'), payload, reqOpts);
        alert(formatOpdetBillsSaveMessage(data));
        setBillsLines(Array.isArray(data.bills_lines ?? data.BILLS_LINES) ? data.bills_lines ?? data.BILLS_LINES : []);
        setSelectedOpNo(Number(data.OP_NO ?? data.op_no ?? on));
      } else if (mode === 'edit') {
        if (!perms?.canEdit) {
          alert('You Can Not Edit');
          return;
        }
        const { data } = await axios.put(apiUrl(apiBase, '/api/opdet'), payload, reqOpts);
        alert(formatOpdetBillsSaveMessage(data));
        setBillsLines(Array.isArray(data.bills_lines ?? data.BILLS_LINES) ? data.bills_lines ?? data.BILLS_LINES : []);
        setSelectedOpNo(on);
      } else {
        alert('Click New, Edit, or Delete first.');
        return;
      }

      setMode('');
      refreshList();
      await loadRecordToForm(on);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleList = () => {
    setSearchQ('');
    setSelectedOpNo(0);
    setMode('');
    clearForm();
    executeSearch('', { immediate: true });
  };

  const fetchReportLines = useCallback(async () => {
    const params = { comp_code: compCode, comp_uid: compUid };
    const trimmed = String(searchQ ?? '').trim();
    if (trimmed) params.q = trimmed;
    const { data } = await axios.get(apiUrl(apiBase, '/api/opdet-report'), { params, ...reqOpts });
    return Array.isArray(data?.lines) ? data.lines : [];
  }, [apiBase, compCode, compUid, searchQ]);

  const buildReportMeta = useCallback(
    () => ({
      companyName: compName || 'Company',
      year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
      reportTitle: 'OP.BILLS DETAIL',
      period: searchQ.trim() ? `Search: ${searchQ.trim()}` : 'All opening bills',
      fyStart: formData?.comp_s_dt ?? formData?.COMP_S_DT,
      fyEnd: formData?.comp_e_dt ?? formData?.COMP_E_DT,
    }),
    [compName, formData, searchQ]
  );

  const handleExcel = async () => {
    try {
      const lines = await fetchReportLines();
      if (!lines.length) {
        alert('No rows to export.');
        return;
      }
      downloadExcelRows(
        buildOpdetReportExcelRows(lines),
        'OP_Bills_Detail',
        `${compName || 'Company'}_OP_Bills_Detail`
      );
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Excel export failed');
    }
  };

  const handlePdf = async () => {
    try {
      const lines = await fetchReportLines();
      if (!lines.length) {
        alert('No rows to export.');
        return;
      }
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('opdet-report', { lines }, buildReportMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleFormEnter = (e) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === 'TEXTAREA') return;

    const fieldId = resolveOpdetFieldId(target);
    if (!fieldId) return;

    e.preventDefault();
    e.stopPropagation();
    focusNextOpdetField(fieldId);
  };

  const handleLineKeyDown = (e, idx, field) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (field === 'PMT_AMT' && idx < lines.length - 1) {
      setTimeout(() => focusLineCell(idx + 1, 'PMT_DATE'), 0);
    } else if (field === 'PMT_AMT') {
      handleAddLine();
      setTimeout(() => focusLineCell(idx + 1, 'PMT_DATE'), 50);
    } else if (field === 'PMT_DATE') {
      setTimeout(() => focusLineCell(idx, 'PMT_AMT'), 0);
    }
  };

  useEffect(() => {
    if (loading || !perms?.canOpen || mode !== '') return undefined;
    const id = window.setTimeout(() => newBtnRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [loading, perms?.canOpen, mode]);

  useEffect(() => {
    if (mode !== 'new' || !focusPartyAfterNewRef.current) return;
    focusPartyAfterNewRef.current = false;
    focusPartyCodeField();
  }, [mode, focusPartyCodeField]);

  if (loading) {
    return (
      <div className="slide slide-54-opdet opdet-screen detail-mast-screen detail-mast-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Opening Bills Detail</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-54-opdet opdet-screen detail-mast-screen">
        <h2 className="sale-bill-page__title">Opening Bills Detail</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F4).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-54-opdet opdet-screen detail-mast-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome detail-mast-screen__chrome">
        <div className="account-master-screen__head detail-mast-screen__head">
          <div className="detail-mast-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Opening Bills Detail</h2>
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={refreshList}
              onList={handleList}
              onExcel={handleExcel}
              onPdf={handlePdf}
              perms={perms}
              listLoading={listLoading || saving}
              hasRows={rows.length > 0}
            >
              <GfasToolbarBtn
                ref={newBtnRef}
                icon="add"
                label="New"
                variant="secondary"
                onClick={() => void handleNew({ focusParty: true })}
                onKeyDown={handleNewKeyDown}
                disabled={saving || mode !== ''}
              />
              <GfasToolbarBtn
                icon="edit"
                label="Edit"
                variant="secondary"
                onClick={handleEdit}
                disabled={saving || !selectedRow || mode !== ''}
              />
              <GfasToolbarBtn
                icon="delete"
                label="Delete"
                variant="danger"
                onClick={handleDeleteMode}
                disabled={saving || !selectedRow || mode !== ''}
              />
              <GfasToolbarBtn
                label={saving ? 'Saving…' : 'Save'}
                variant="primary"
                onClick={handleSave}
                disabled={saving || (mode !== 'new' && mode !== 'edit' && mode !== 'del')}
              />
              {mode ? (
                <GfasToolbarBtn label="Cancel" variant="secondary" onClick={handleCancelMode} disabled={saving} />
              ) : null}
            </MasterScreenToolbar>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="opening-bills-detail"
            helpLabel="Help"
            helpCompanyName={compName}
            className="detail-mast-screen__session-line"
          />
        </div>
      </div>

      <div className="detail-mast-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err detail-mast-screen__err">{err}</p> : null}
        {mode === 'del' ? (
          <p className="detail-mast-screen__mode-hint">Delete mode — press Save to confirm deletion.</p>
        ) : null}

        <form
          ref={formRef}
          className="opdet-screen__form detail-mast-screen__form"
          onKeyDownCapture={handleFormEnter}
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--sno">
            <span className="sale-bill-field__label">Sr.No</span>
            <input className="form-input" type="text" value={opNo} readOnly disabled />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--code">
            <span className="sale-bill-field__label">Party Code</span>
            <div className="detail-mast-screen__code-wrap">
              <MasterPartyPickList
                options={accountOptions}
                value={code}
                onChange={setCodeCell}
                disabled={partyCodeDisabled || saving}
                title="Party code (C or S)"
                placeholder="Code"
                showSearchIcon
                searchBtnTabIndex={-1}
                dataMpField="opdet-party-code"
                onAfterSelect={() => focusOpdetField('opdet-broker-code')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.defaultPrevented) {
                    e.preventDefault();
                    focusNextOpdetField('opdet-party-code');
                  }
                }}
                {...accountHelpPickProps(code, { onFilterChange: handlePartyFilterChange })}
              />
            </div>
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--name">
            <span className="sale-bill-field__label">Name</span>
            <input className="form-input" type="text" value={acName || '—'} readOnly disabled />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--bcode">
            <span className="sale-bill-field__label">Broker Code</span>
            <div className="detail-mast-screen__code-wrap">
              <MasterPartyPickList
                options={brokerOptions}
                value={bCode}
                onChange={setBCodeCell}
                disabled={headerDisabled || saving}
                title="Broker code (schedule 11.20)"
                placeholder="Code"
                showSearchIcon
                searchBtnTabIndex={-1}
                dataMpField="opdet-broker-code"
                onAfterSelect={() => focusOpdetField('opdet-bill-date')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.defaultPrevented) {
                    e.preventDefault();
                    focusNextOpdetField('opdet-broker-code');
                  }
                }}
                {...accountHelpPickProps(bCode)}
              />
            </div>
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--bname">
            <span className="sale-bill-field__label">Broker Name</span>
            <input className="form-input" type="text" value={brokerName || '—'} readOnly disabled />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--billdate">
            <span className="sale-bill-field__label">Bill Date</span>
            <input
              id="opdet-bill-date"
              className="form-input opdet-screen__date-input"
              type="date"
              value={toInputDateString(billDate)}
              max={opdetMaxDate || undefined}
              disabled={headerDisabled || saving}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--billno">
            <span className="sale-bill-field__label">Bill No</span>
            <input
              id="opdet-bill-no"
              className="form-input"
              type="text"
              inputMode="numeric"
              value={billNo}
              disabled={headerDisabled || saving}
              onChange={(e) => setBillNo(String(e.target.value).replace(/\D/g, ''))}
            />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--vdate">
            <span className="sale-bill-field__label">Value Date</span>
            <input
              id="opdet-v-date"
              className="form-input opdet-screen__date-input"
              type="date"
              value={toInputDateString(vDate)}
              disabled={headerDisabled || saving}
              onChange={(e) => setVDate(e.target.value)}
            />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--days">
            <span className="sale-bill-field__label">Days</span>
            <input
              id="opdet-days"
              className="form-input"
              type="text"
              inputMode="numeric"
              value={days}
              disabled={headerDisabled || saving}
              onChange={(e) => setDays(String(e.target.value).replace(/\D/g, ''))}
            />
          </label>
          <label className="sale-bill-field opdet-screen__field opdet-screen__field--billamt">
            <span className="sale-bill-field__label">Bill Amount</span>
            <input
              id="opdet-bill-amt"
              className="form-input"
              type="text"
              inputMode="decimal"
              value={amtInputVal(billAmt)}
              disabled={headerDisabled || saving}
              onChange={(e) => {
                const p = parseAmtInput(e.target.value);
                if (p != null) setBillAmt(p);
              }}
              onBlur={() => {
                const p = parseAmtInput(billAmt);
                if (p !== '' && p != null) setBillAmt(formatAmt2(p));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusLineCell(0, 'PMT_DATE');
                }
              }}
            />
          </label>
        </form>

        <div className="detail-mast-screen__grid-head">
          <span className="detail-mast-screen__grid-title">Payment lines</span>
          {mode === 'new' || mode === 'edit' ? (
            <div className="detail-mast-screen__grid-actions">
              <GfasToolbarBtn icon="add" label="Add row" variant="secondary" onClick={handleAddLine} disabled={saving} />
              <GfasToolbarBtn
                icon="delete"
                label="Delete row"
                variant="danger"
                onClick={handleDeleteSelectedLine}
                disabled={saving || lines.length <= 1}
              />
            </div>
          ) : null}
        </div>

        <div className="detail-mast-screen__grid-wrap">
          <table className="detail-mast-grid dane-grid opdet-grid">
            <thead>
              <tr>
                <th className="detail-mast-grid__trn-col">S.No</th>
                <th className="opdet-grid__date-col">Payment Date</th>
                <th className="opdet-grid__amt-col">Amount</th>
                {mode === 'new' || mode === 'edit' ? <th className="dane-grid__act-col">Del</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr
                  key={line._id}
                  className={
                    mode === 'new' || mode === 'edit'
                      ? selectedLineIdx === idx
                        ? 'detail-mast-grid__row is-selected'
                        : 'detail-mast-grid__row'
                      : undefined
                  }
                  onClick={() => {
                    if (mode === 'new' || mode === 'edit') setSelectedLineIdx(idx);
                  }}
                >
                  <td className="detail-mast-grid__trn-cell">
                    <input
                      id={lineCellId(idx, 'TRN_NO')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={line.TRN_NO}
                      disabled={linesDisabled || saving}
                      onFocus={() => setSelectedLineIdx(idx)}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(/\D/g, ''));
                        if (!Number.isFinite(n) || n < 0) return;
                        setLineCell(idx, 'TRN_NO', n || '');
                      }}
                    />
                  </td>
                  <td>
                    <input
                      id={lineCellId(idx, 'PMT_DATE')}
                      className="form-input dane-grid__input opdet-screen__date-input"
                      type="date"
                      value={toInputDateString(line.PMT_DATE)}
                      max={opdetMaxDate || undefined}
                      disabled={linesDisabled || saving}
                      onFocus={() => setSelectedLineIdx(idx)}
                      onChange={(e) => setLineCell(idx, 'PMT_DATE', e.target.value)}
                      onKeyDown={(e) => handleLineKeyDown(e, idx, 'PMT_DATE')}
                    />
                  </td>
                  <td>
                    <input
                      id={lineCellId(idx, 'PMT_AMT')}
                      className="form-input dane-grid__input opdet-grid__amt-input"
                      type="text"
                      inputMode="decimal"
                      value={amtInputVal(line.PMT_AMT)}
                      disabled={linesDisabled || saving}
                      onFocus={() => setSelectedLineIdx(idx)}
                      onChange={(e) => {
                        const p = parseAmtInput(e.target.value);
                        if (p != null) setLineCell(idx, 'PMT_AMT', p);
                      }}
                      onBlur={() => {
                        const p = parseAmtInput(line.PMT_AMT);
                        if (p !== '' && p != null) setLineCell(idx, 'PMT_AMT', formatAmt2(p));
                      }}
                      onKeyDown={(e) => handleLineKeyDown(e, idx, 'PMT_AMT')}
                    />
                  </td>
                  {mode === 'new' || mode === 'edit' ? (
                    <td className="dane-grid__act-cell">
                      <button
                        type="button"
                        className="btn btn-secondary dane-grid__del"
                        disabled={linesDisabled || saving || lines.length <= 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveLine(idx);
                        }}
                        title="Delete row"
                      >
                        ×
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {billsLines.length > 0 ? (
          <div className="opdet-bills-summary">
            <div className="opdet-bills-summary__head">
              <span className="opdet-bills-summary__title">BILLS table (VR_TYPE = OP, VR_NO = {opNo || '—'})</span>
              <span className="opdet-bills-summary__hint">
                VFP: bill row → DR_AMT = Bill Amount; each payment row → CR_AMT = Payment Amount (2 rows for 1 payment)
              </span>
            </div>
            <table className="opdet-bills-summary__grid">
              <thead>
                <tr>
                  <th>Row</th>
                  <th className="num">DR_AMT</th>
                  <th className="num">CR_AMT</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {billsLines.map((r, i) => {
                  const dr = Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
                  const cr = Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
                  const isBill = dr > 0 || String(r.DETAIL ?? r.detail ?? '').trim();
                  return (
                    <tr key={`bills-${i}`}>
                      <td>{isBill ? 'Bill' : `Payment ${i}`}</td>
                      <td className="num">{dr.toFixed(2)}</td>
                      <td className="num">{cr.toFixed(2)}</td>
                      <td>{String(r.DETAIL ?? r.detail ?? '').trim() || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="detail-mast-screen__filters account-master-screen__filters">
          <label className="sale-bill-field account-master-filter account-master-filter--search">
            <span className="sale-bill-field__label">Search</span>
            <input
              className="form-input account-master-search-input"
              type="search"
              value={searchQ}
              placeholder="Sr.No, party, broker, bill no…"
              onChange={(e) => {
                const v = e.target.value;
                setSearchQ(v);
                executeSearch(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  executeSearch(searchQ, { immediate: true });
                }
              }}
            />
          </label>
        </div>

        <div className="detail-mast-screen__list-wrap account-master-screen__list-wrap">
          <table className="account-master-table opdet-list-grid">
            <thead>
              <tr>
                <th className="num">Sr.No</th>
                <th>Party</th>
                <th>Name</th>
                <th>Broker</th>
                <th>Bill Date</th>
                <th className="num">Bill No</th>
                <th className="num">Amount</th>
                <th className="num">Lines</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="account-master-table__empty">
                    {listLoading ? 'Loading…' : 'No opening bills records found.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isSel = Number(selectedOpNo) === Number(r.OP_NO);
                  return (
                    <tr
                      key={r.OP_NO}
                      className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                      onClick={() => handleSelectRow(r)}
                      onDoubleClick={async () => {
                        if (!perms?.canEdit) return;
                        setSelectedOpNo(r.OP_NO);
                        setMode('edit');
                        try {
                          await loadRecordToForm(r.OP_NO);
                        } catch (e) {
                          alert(e?.response?.data?.error || e.message || 'Load failed');
                        }
                      }}
                    >
                      <td className="num">{r.OP_NO}</td>
                      <td>{r.CODE || '—'}</td>
                      <td>{r.AC_NAME || '—'}</td>
                      <td>{r.B_CODE || '—'}</td>
                      <td>{r.BILL_DATE || '—'}</td>
                      <td className="num">{r.BILL_NO || '—'}</td>
                      <td className="num">{r.BILL_AMT || '—'}</td>
                      <td className="num">{r.LINE_CNT || 0}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="detail-mast-screen__hint account-master-screen__hint">
          {rows.length} record{rows.length === 1 ? '' : 's'}
          {listLoading ? ' · loading…' : ''}
          {selectedRow ? ` · selected Sr.No ${selectedRow.OP_NO}` : ''}
          {mode ? ` · ${mode}` : ''}
        </p>
      </div>
    </div>
  );
}
