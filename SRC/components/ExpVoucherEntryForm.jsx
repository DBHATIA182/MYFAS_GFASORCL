import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import PurchaseBillToolbar from './PurchaseBillToolbar';
import ExpVoucherListModal from './ExpVoucherListModal';
import ExpVoucherPostingModal from './ExpVoucherPostingModal';
import PurchaseBillPrintModal from './PurchaseBillPrintModal';
import { toInputDateString, toOracleDateFromAny } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import {
  num,
  recalcLine,
  sumFooter,
  applyItemmastToLine,
  accountDisplayName,
  sanitizeGstPerInput,
} from '../utils/expVoucherCalc';
import '../styles/voucherEntryForm.css';
import '../styles/gfasToolbar.css';
import '../styles/purchaseBillForm.css';
import '../styles/expVoucherForm.css';

const EV_TYPE = 'EV';
const reqOpts = { withCredentials: true, timeout: 120000 };

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];
const COST_HELP_COLUMNS = [
  { key: 'cost_code', label: 'Code' },
  { key: 'cost_name', label: 'Name' },
];
const NATURE_HELP_COLUMNS = [
  { key: 'nature', label: 'Nature' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'tds_rate', label: 'Tds_rate', align: 'right' },
  { key: 'sur_per', label: 'Sur_per', align: 'right' },
  { key: 'edu_per', label: 'Edu_per', align: 'right' },
];

const DEFAULT_PERMS = { canOpen: true, canAdd: true, canEdit: true, canDelete: true };

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function emptyLine(key = 1) {
  return {
    key,
    trn_no: key,
    item_code: '',
    item_name: '',
    tax_per: '',
    pur_code: '',
    pur_name: '',
    weight: '',
    rate: '',
    amount: '',
    freight: '',
    cgst_per: '',
    cgst_amt: '',
    sgst_per: '',
    sgst_amt: '',
    igst_per: '',
    igst_amt: '',
  };
}

function emptyHeader(rDate = '', billDate = '') {
  return {
    r_date: rDate,
    r_no: '',
    bill_date: billDate,
    bill_no: '',
    code: '',
    party_name: '',
    gst_no: '',
    l_c: 'L',
    input_yn: 'Y',
    show_in_gstr: 'Y',
    tot_pur: '',
    god_code: '',
    god_name: '',
    gst_trf: 'Y',
    remarks: '',
    cost_code: '',
    cost_name: '',
    mod_reason: '',
  };
}

function emptyFooter(ctx = {}) {
  return {
    cgst_code: ctx.cgst_code || '',
    sgst_code: ctx.sgst_code || '',
    igst_code: ctx.igst_code || '',
    oth_cd_1: '',
    oth_exp_1: '',
    tcs_per: '',
    tcs_amt: '',
    tcs_code: ctx.tcs_code || '',
    ntds_per: ctx.ntds_per != null ? String(ctx.ntds_per) : '',
    ntds_amt: '',
    ntds_on_amt: '',
    ntds_on_manual: false,
    ntds_code: ctx.ntds_code || '',
    nature: ctx.ntds_nature || '',
    p_bill_no_file_path: '',
  };
}

export default function ExpVoucherEntryForm({ apiBase, formData, userName, onBack, onOpenChecklist }) {
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;

  const fy = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const fyMinYmd = fy.fyMinYmd;
  const fyMaxYmd = fy.fyMaxYmd;
  const defaultDocDate = useMemo(
    () => toInputDateString(defaultDocDateInFinYear(fyMinYmd, fyMaxYmd)),
    [fyMinYmd, fyMaxYmd]
  );

  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultDocDate, defaultDocDate));
  const [footer, setFooter] = useState(() => emptyFooter());
  const [lines, setLines] = useState(() => [emptyLine(1), emptyLine(2)]);
  const [ctx, setCtx] = useState({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [uiLocked, setUiLocked] = useState(false);
  const [evPerms, setEvPerms] = useState(DEFAULT_PERMS);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const [items, setItems] = useState([]);
  const [purAccounts, setPurAccounts] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [costCentres, setCostCentres] = useState([]);

  const [helpField, setHelpField] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [purHelpLine, setPurHelpLine] = useState(null);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);
  const [costHelpOpen, setCostHelpOpen] = useState(false);
  const [natureHelpOpen, setNatureHelpOpen] = useState(false);
  const [natureRows, setNatureRows] = useState([]);
  const [natureHelpBusy, setNatureHelpBusy] = useState(false);
  const [natureHelpError, setNatureHelpError] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  const lineKeyRef = useRef(3);
  const newBtnRef = useRef(null);
  const entryFocusDoneRef = useRef(false);
  const lastRnoLookupRef = useRef('');
  const helpReturnFocusRef = useRef(null);
  const rdateBlurTaskRef = useRef(null);
  const scanInputRef = useRef(null);

  const apiParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName }),
    [compCode, compUid, userName]
  );

  const editable = mode === 'new' || mode === 'edit';
  const docNoLocked = uiLocked || mode === 'edit' || (mode === 'new' && !!String(header.r_no ?? '').trim());
  const hasBill = !!String(header.r_no ?? '').trim() && uiLocked;

  const totals = useMemo(() => sumFooter(lines, footer), [lines, footer]);

  const godownHelpRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const costHelpRows = useMemo(
    () =>
      (costCentres || []).map((c, idx) => ({
        _id: String(c.COST_CODE ?? c.cost_code ?? idx),
        cost_code: String(c.COST_CODE ?? c.cost_code ?? '').trim(),
        cost_name: String(c.COST_NAME ?? c.cost_name ?? '').trim(),
      })),
    [costCentres]
  );

  const natureHelpRows = useMemo(
    () =>
      (natureRows || []).map((r, idx) => ({
        _id: String(r.id ?? `${r.nature}-${idx}`),
        nature: String(r.nature ?? '').trim(),
        amount: num(r.amount),
        tds_rate: num(r.tds_rate),
        sur_per: num(r.sur_per),
        edu_per: num(r.edu_per),
        leg_code: String(r.leg_code ?? '').trim(),
      })),
    [natureRows]
  );

  const focusOrder = useMemo(() => {
    const isLocal = String(header.l_c || 'L').toUpperCase() === 'L';
    const keys = [
      'hdr-rdate',
      'hdr-rno',
      'hdr-billdt',
      'hdr-billno',
      'hdr-code',
      'hdr-lc',
      'hdr-input',
      'hdr-gsttrf',
      'hdr-gstr',
      'hdr-god',
    ];
    for (const ln of lines) {
      keys.push(`ln-${ln.key}-item`, `ln-${ln.key}-pur`, `ln-${ln.key}-wgt`, `ln-${ln.key}-rate`, `ln-${ln.key}-fgt`);
      if (isLocal) {
        keys.push(`ln-${ln.key}-cgst-p`, `ln-${ln.key}-sgst-p`);
      } else {
        keys.push(`ln-${ln.key}-igst-p`);
      }
    }
    keys.push(
      'ft-remarks',
      'ft-cost',
      'ft-mod',
      'ft-scan',
      'ft-cgst_code',
      'ft-sgst_code',
      'ft-igst_code',
      'ft-oth_cd_1',
      'ft-oth_exp_1',
      'ft-tcs_per',
      'ft-tcs_code',
      'ft-tcs_amt',
      'ft-ntds_per',
      'ft-ntds_code',
      'ft-ntds_amt',
      'ft-nature'
    );
    return keys;
  }, [header.l_c, lines]);

  const isLocalGst = String(header.l_c || 'L').toUpperCase() === 'L';

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  const restoreHelpFocus = useCallback(() => {
    const key = helpReturnFocusRef.current;
    helpReturnFocusRef.current = null;
    if (!key) return;
    window.setTimeout(() => {
      if (!focusChain.focusKey(key)) {
        window.setTimeout(() => focusChain.focusKey(key), 80);
      }
    }, 80);
  }, [focusChain]);

  useEffect(() => {
    if (permLoading || permErr || entryFocusDoneRef.current || !evPerms?.canOpen) return;
    entryFocusDoneRef.current = true;
    window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 80);
  }, [focusChain, permErr, permLoading, evPerms?.canOpen]);

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      let perms = DEFAULT_PERMS;
      try {
        const permRes = await axios.get(`${apiBase}/api/purchase-bill/user-permissions`, {
          params: { user_name: userName },
          ...reqOpts,
        });
        perms = { ...DEFAULT_PERMS, ...(permRes.data || {}) };
      } catch {
        perms = DEFAULT_PERMS;
      }
      setEvPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, purRes, godRes, costRes] = await Promise.all([
        axios.get(`${apiBase}/api/exp-voucher/context`, { params }),
        axios.get(`${apiBase}/api/purchaselist-items`, { params }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params }),
        axios.get(`${apiBase}/api/voucher-entry/cost-help`, { params }),
      ]);
      const c = ctxRes.data || {};
      setCtx(c);
      setFooter(emptyFooter(c));
      setItems(itemsRes.data || []);
      setPurAccounts(purRes.data || []);
      setGodowns(godRes.data || []);
      setCostCentres(Array.isArray(costRes.data?.rows) ? costRes.data.rows : costRes.data || []);
    } catch (err) {
      setPermErr(err.response?.data?.error || err.message || 'Could not load expenses voucher.');
      setEvPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const recalcFooterNtds = useCallback(
    (baseFooter, mamt) => {
      const next = { ...baseFooter };
      if (!next.ntds_on_manual) {
        next.ntds_on_amt = mamt ? String(round2Local(mamt)) : '';
      }
      const ntdsBase = num(next.ntds_on_amt);
      const ntdsPer = num(next.ntds_per);
      if (!ntdsPer) {
        next.ntds_amt = '';
      } else {
        next.ntds_amt = String(Math.round(((ntdsBase * ntdsPer) / 100) * 100) / 100);
      }
      const tcsPer = num(next.tcs_per);
      if (!tcsPer) {
        next.tcs_amt = '';
      } else {
        next.tcs_amt = String(Math.round(((mamt * tcsPer) / 100) * 100) / 100);
      }
      return next;
    },
    []
  );

  function round2Local(v) {
    return Math.round(num(v) * 100) / 100;
  }

  useEffect(() => {
    setFooter((f) => {
      const next = recalcFooterNtds(f, totals.mamt);
      if (
        String(next.ntds_on_amt ?? '') === String(f.ntds_on_amt ?? '') &&
        String(next.ntds_amt ?? '') === String(f.ntds_amt ?? '') &&
        String(next.tcs_amt ?? '') === String(f.tcs_amt ?? '')
      ) {
        return f;
      }
      return next;
    });
  }, [recalcFooterNtds, totals.mamt]);

  const onFooter = useCallback(
    (field, value) => {
      setFooter((f) => {
        let patched = { ...f, [field]: value };
        if (field === 'ntds_on_amt') {
          patched.ntds_on_manual = String(value ?? '').trim() !== '';
        }
        if (
          field === 'ntds_per' ||
          field === 'ntds_on_amt' ||
          field === 'tcs_per'
        ) {
          patched = recalcFooterNtds(patched, totals.mamt);
        }
        return patched;
      });
    },
    [recalcFooterNtds, totals.mamt]
  );

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      setHeader({
        r_date: toInputDateString(h.r_date) || defaultDocDate,
        r_no: h.r_no ? String(h.r_no) : '',
        bill_date: toInputDateString(h.bill_date) || defaultDocDate,
        bill_no: h.bill_no || '',
        code: h.code || '',
        party_name: h.party_name || '',
        gst_no: h.gst_no || '',
        l_c: String(h.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L',
        input_yn: String(h.input_yn ?? 'Y').toUpperCase() === 'Y' ? 'Y' : 'N',
        show_in_gstr: String(h.show_in_gstr ?? 'Y').toUpperCase() === 'Y' ? 'Y' : 'N',
        tot_pur: h.tot_pur != null ? fmtAmt(h.tot_pur) : '',
        god_code: h.god_code || '',
        god_name: h.god_name || '',
        gst_trf: String(h.gst_trf ?? 'Y').toUpperCase() === 'Y' ? 'Y' : 'N',
        remarks: h.remarks || '',
        cost_code: h.cost_code || '',
        cost_name: h.cost_name || '',
        mod_reason: h.mod_reason || '',
      });
      setFooter((f) => ({
        ...f,
        cgst_code: h.cgst_code || f.cgst_code,
        sgst_code: h.sgst_code || f.sgst_code,
        igst_code: h.igst_code || f.igst_code,
        oth_cd_1: h.oth_cd_1 || '',
        oth_exp_1: h.oth_exp_1 != null ? String(h.oth_exp_1) : '',
        tcs_per: h.tcs_per != null ? String(h.tcs_per) : '',
        tcs_amt: h.tcs_amt != null ? String(h.tcs_amt) : '',
        tcs_code: h.tcs_code || f.tcs_code,
        ntds_per: h.ntds_per != null ? String(h.ntds_per) : '',
        ntds_amt: h.ntds_amt != null ? String(h.ntds_amt) : '',
        ntds_on_amt: h.ntds_on_amt != null ? String(h.ntds_on_amt) : '',
        ntds_on_manual: h.ntds_on_amt != null && Number(h.ntds_on_amt) !== 0,
        ntds_code: h.ntds_code || f.ntds_code,
        nature: h.nature || f.nature,
        p_bill_no_file_path: h.p_bill_no_file_path || '',
      }));
      const lc = String(h.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L';
      const loaded = (data?.lines || []).map((ln, idx) => {
        const base = {
          key: idx + 1,
          trn_no: ln.trn_no || idx + 1,
          item_code: ln.item_code ? String(ln.item_code) : '',
          item_name: ln.item_name || '',
          tax_per: '',
          pur_code: ln.pur_code || '',
          pur_name: ln.pur_name || '',
          weight: ln.weight != null ? String(ln.weight) : '',
          rate: ln.rate != null ? String(ln.rate) : '',
          amount: ln.amount != null ? String(ln.amount) : '',
          freight: ln.freight != null ? String(ln.freight) : '',
          cgst_per: ln.cgst_per != null ? String(ln.cgst_per) : '',
          cgst_amt: ln.cgst_amt != null ? String(ln.cgst_amt) : '',
          sgst_per: ln.sgst_per != null ? String(ln.sgst_per) : '',
          sgst_amt: ln.sgst_amt != null ? String(ln.sgst_amt) : '',
          igst_per: ln.igst_per != null ? String(ln.igst_per) : '',
          igst_amt: ln.igst_amt != null ? String(ln.igst_amt) : '',
        };
        return recalcLine(base, lc);
      });
      lineKeyRef.current = Math.max(3, loaded.length + 1);
      setLines(loaded.length ? loaded : [emptyLine(1), emptyLine(2)]);
      setMode('view');
      setUiLocked(true);
      const od = toOracleDateFromAny(h.r_date);
      if (od && h.r_no != null) {
        lastRnoLookupRef.current = `${od}|${String(h.r_no).trim()}`;
      }
    },
    [defaultDocDate]
  );

  const tryLoadExisting = useCallback(
    async (noRaw, { quiet = false, advanceIfNew = false } = {}) => {
      let no = String(noRaw ?? header.r_no ?? '').trim();
      const rDate = header.r_date;
      const oracleDt = toOracleDateFromAny(rDate);
      if (!oracleDt) {
        if (!quiet) setStatus('Enter R.Date.');
        return false;
      }
      if (!no) {
        try {
          const { data } = await axios.get(`${apiBase}/api/exp-voucher/next-no`, {
            params: { ...apiParams, r_date: oracleDt },
            ...reqOpts,
          });
          no = String(data.next_no || '').trim();
          if (no) setHeader((h) => ({ ...h, r_no: no }));
        } catch {
          /* optional */
        }
      }
      if (!no) {
        if (!quiet) setStatus('Enter R.No.');
        return false;
      }
      const lookupKey = `${oracleDt}|${no}`;
      if (lookupKey === lastRnoLookupRef.current && uiLocked) return true;

      setBusy(true);
      if (!quiet) setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/exp-voucher`, {
          params: { ...apiParams, r_no: no, r_date: oracleDt },
          ...reqOpts,
        });
        lastRnoLookupRef.current = lookupKey;
        applyLoaded(data);
        setStatus(`Expenses voucher ${no} loaded — press Edit to modify or Delete to remove.`);
        return true;
      } catch (err) {
        lastRnoLookupRef.current = lookupKey;
        if (err.response?.status === 404) {
          let billNo = no;
          if (!billNo) {
            try {
              const { data } = await axios.get(`${apiBase}/api/exp-voucher/next-no`, {
                params: { ...apiParams, r_date: oracleDt },
                ...reqOpts,
              });
              billNo = String(data.next_no || '');
            } catch {
              /* optional */
            }
          }
          setMode('new');
          setUiLocked(false);
          setHeader((h) => ({
            ...emptyHeader(h.r_date || defaultDocDate, h.r_date || defaultDocDate),
            r_date: h.r_date,
            r_no: billNo,
          }));
          setFooter(emptyFooter(ctx));
          setLines([emptyLine(1), emptyLine(2)]);
          lineKeyRef.current = 3;
          if (!quiet) setStatus(billNo ? `New voucher ${billNo} — enter details.` : 'New voucher — enter details.');
          if (advanceIfNew) {
            window.setTimeout(() => focusChain.focusKey('hdr-billdt'), 50);
          }
          return false;
        }
        if (!quiet) setStatus(err.response?.data?.error || err.message || 'Load failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, ctx, defaultDocDate, focusChain, header.r_date, header.r_no, uiLocked]
  );

  const loadBill = useCallback(
    async (rNo, rDate) => {
      if (!rNo) return;
      setBusy(true);
      setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/exp-voucher`, {
          params: {
            ...apiParams,
            r_no: rNo,
            r_date: toOracleDateFromAny(rDate || header.r_date),
          },
          ...reqOpts,
        });
        applyLoaded(data);
        setStatus(`Expenses voucher ${rNo} loaded.`);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, header.r_date]
  );

  const startNew = useCallback(() => {
    setHelpField(null);
    setItemHelpLine(null);
    setPurHelpLine(null);
    setMode('view');
    setUiLocked(false);
    setStatus('');
    lastRnoLookupRef.current = '';
    const rDate = defaultDocDate;
    setHeader(emptyHeader(rDate, rDate));
    setFooter(emptyFooter(ctx));
    setLines([emptyLine(1), emptyLine(2)]);
    lineKeyRef.current = 3;
    window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 50);
  }, [ctx, defaultDocDate, focusChain]);

  const handleRdateChange = useCallback((v) => {
    lastRnoLookupRef.current = '';
    setUiLocked(false);
    setHeader((h) => ({
      ...h,
      r_date: v,
      r_no: h.r_date && v && h.r_date !== v ? '' : h.r_no,
    }));
  }, []);

  const fetchNextRnoForDate = useCallback(
    async (rDateYmd) => {
      const oracleDt = toOracleDateFromAny(rDateYmd);
      if (!oracleDt) return null;
      try {
        const { data } = await axios.get(`${apiBase}/api/exp-voucher/next-no`, {
          params: { ...apiParams, r_date: oracleDt },
          ...reqOpts,
        });
        return String(data.next_no ?? '');
      } catch {
        return null;
      }
    },
    [apiBase, apiParams]
  );

  const handleRdateBlur = useCallback(
    async (ymd) => {
      const rDate = ymd || header.r_date;
      if (!rDate || uiLocked || mode === 'edit' || busy) return;
      const task = (async () => {
        const nextNo = await fetchNextRnoForDate(rDate);
        if (!nextNo) return;
        setHeader((h) => ({ ...h, r_no: nextNo }));
        return nextNo;
      })();
      rdateBlurTaskRef.current = task;
      return task;
    },
    [busy, fetchNextRnoForDate, header.r_date, mode, uiLocked]
  );

  const handleRnoChange = useCallback((e) => {
    lastRnoLookupRef.current = '';
    setUiLocked(false);
    setHeader((h) => ({ ...h, r_no: e.target.value.replace(/\D/g, '') }));
  }, []);

  const handleRnoBlur = useCallback(() => {
    const no = String(header.r_no ?? '').trim();
    if (!no || uiLocked) return;
    void tryLoadExisting(no, { quiet: true });
  }, [header.r_no, tryLoadExisting, uiLocked]);

  const startEdit = useCallback(() => {
    if (!header.r_no) {
      setStatus('Open a voucher first.');
      return;
    }
    if (!evPerms?.canEdit) {
      setStatus('Edit permission denied.');
      return;
    }
    setMode('edit');
    setStatus('');
  }, [evPerms?.canEdit, header.r_no]);

  const updateLine = useCallback(
    (key, patch) => {
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== key) return ln;
          let next = { ...ln, ...patch };
          if (patch.item_code != null) {
            const ic = Number(patch.item_code) || 0;
            if (!ic) {
              next.item_name = '';
              next.tax_per = '';
            } else {
              const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
              next = applyItemmastToLine(next, row, { purAccounts });
            }
          }
          if (patch.pur_code != null) {
            const code = String(patch.pur_code ?? '').trim().toUpperCase();
            next.pur_name = accountDisplayName(purAccounts, code);
          }
          return recalcLine(next, header.l_c);
        })
      );
    },
    [header.l_c, items, purAccounts]
  );

  const recalcAllLines = useCallback(
    (lc) => {
      setLines((prev) => prev.map((ln) => recalcLine(ln, lc)));
    },
    []
  );

  const openNatureHelp = useCallback(async () => {
    if (!editable) {
      setStatus('Press New or Edit before using Nature help.');
      return;
    }
    helpReturnFocusRef.current = 'ft-nature';
    setNatureHelpError('');
    setNatureHelpOpen(true);
    setNatureHelpBusy(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/exp-voucher/nature-help`, {
        params: { ...apiParams, comp_year: compYear },
        ...reqOpts,
      });
      const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
      setNatureRows(rows);
      if (!rows.length) {
        setNatureHelpError('No nature records found for this company.');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Could not load TDS nature help.';
      setNatureHelpError(msg);
      setStatus(msg);
      setNatureRows([]);
    } finally {
      setNatureHelpBusy(false);
    }
  }, [apiBase, apiParams, compYear, editable]);

  const applyNature = useCallback(
    (row) => {
      const nature = String(row?.nature ?? '').trim();
      const tdsRate = num(row?.tds_rate);
      const legCode = String(row?.leg_code ?? '').trim().toUpperCase();
      setFooter((f) =>
        recalcFooterNtds(
          {
            ...f,
            nature,
            ntds_per: String(tdsRate),
            ntds_code: legCode || f.ntds_code,
          },
          totals.mamt
        )
      );
      setStatus(nature ? `Nature: ${nature}` : '');
    },
    [recalcFooterNtds, totals.mamt]
  );

  const validateNature = useCallback(async () => {
    const n = String(footer.nature ?? '').trim();
    if (!n) return;
    let rows = natureRows;
    if (!rows.length) {
      try {
        const { data } = await axios.get(`${apiBase}/api/exp-voucher/nature-help`, {
          params: { ...apiParams, comp_year: compYear },
          ...reqOpts,
        });
        rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
        setNatureRows(rows);
      } catch {
        return;
      }
    }
    const hit = rows.find((r) => String(r.nature ?? '').trim().toUpperCase() === n.toUpperCase());
    if (!hit) {
      setStatus('!!! Invalid TDS Nature !!!');
      setFooter((f) => ({ ...f, nature: '' }));
      return;
    }
    setStatus('');
  }, [apiBase, apiParams, compYear, footer.nature, natureRows]);

  const resolveParty = useCallback(
    async (code) => {
      const c = String(code ?? '').trim().toUpperCase();
      const hit = (purAccounts || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
      setHeader((h) => ({
        ...h,
        code: c,
        party_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
        gst_no: hit ? String(hit.GST_NO ?? hit.gst_no ?? '').trim() : '',
      }));
      if (!c) {
        setHeader((h) => ({ ...h, tot_pur: '' }));
        return;
      }
      try {
        const { data } = await axios.get(`${apiBase}/api/exp-voucher/party-tot-pur`, {
          params: { ...apiParams, code: c },
          ...reqOpts,
        });
        setHeader((h) => ({ ...h, tot_pur: fmtAmt(data?.tot_pur) }));
      } catch {
        /* optional */
      }
    },
    [apiBase, apiParams, purAccounts]
  );

  const pickScanFile = useCallback(
    async (file) => {
      if (!file || !compCode) return;
      setScanBusy(true);
      setStatus('');
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Could not read file.'));
          reader.readAsDataURL(file);
        });
        const { data } = await axios.post(
          `${apiBase}/api/purchase-bill/scan-upload`,
          {
            comp_code: compCode,
            file_name: file.name,
            data_base64: dataUrl,
          },
          { ...reqOpts, timeout: 180000 }
        );
        const saved = String(data?.path || '').trim().replace(/^[A-Za-z]:/, '');
        const norm =
          saved && !saved.startsWith('\\') && !saved.startsWith('/')
            ? `\\${saved.replace(/\//g, '\\')}`
            : saved.replace(/\//g, '\\');
        if (!norm) throw new Error('Upload did not return a path.');
        onFooter('p_bill_no_file_path', norm);
        setStatus(`Scan saved: ${file.name}`);
      } catch (err) {
        const msg = err.response?.data?.error || err.message || 'Scan upload failed.';
        setStatus(msg);
        window.alert(msg);
      } finally {
        setScanBusy(false);
      }
    },
    [apiBase, compCode, onFooter]
  );

  const openScanBill = useCallback(async () => {
    const scanPath = String(footer.p_bill_no_file_path || '').trim();
    if (!scanPath) {
      setStatus('No scan bill path — browse to attach a file first.');
      window.alert('No scan bill path.\n\nBrowse Scan Bill Path to attach a file.');
      return;
    }
    try {
      await axios.post(
        `${apiBase}/api/purchase-bill/open-scan`,
        { path: scanPath },
        { ...reqOpts, timeout: 60000 }
      );
    } catch {
      const url = `${apiBase}/api/purchase-bill/scan-file?path=${encodeURIComponent(scanPath)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [apiBase, footer.p_bill_no_file_path]);

  const addLine = useCallback(() => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key)]);
  }, []);

  const saveVoucher = useCallback(async () => {
    const rDateErr = finYearDateErrorMessage(header.r_date, fyMinYmd, fyMaxYmd);
    if (rDateErr) {
      setStatus(rDateErr);
      return;
    }
    if (!header.code) {
      setStatus('Party code is required.');
      return;
    }
    const validLines = lines.filter((ln) => Number(ln.item_code) > 0);
    if (!validLines.length) {
      setStatus('Enter at least one item line.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const payload = {
        ...apiParams,
        comp_year: compYear,
        mode,
        type: EV_TYPE,
        r_date: toOracleDateFromAny(header.r_date),
        r_no: Number(header.r_no) || 0,
        bill_date: toOracleDateFromAny(header.bill_date),
        bill_no: header.bill_no,
        code: header.code,
        l_c: header.l_c,
        input_yn: header.input_yn,
        show_in_gstr: header.show_in_gstr,
        gst_trf: header.gst_trf,
        god_code: header.god_code,
        cost_code: header.cost_code,
        remarks: header.remarks,
        mod_reason: header.mod_reason,
        footer: {
          ...footer,
          bill_amt: totals.mbamt,
        },
        lines: validLines.map((ln) => ({
          ...ln,
          trn_no: ln.trn_no || ln.key,
          item_code: Number(ln.item_code) || 0,
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/exp-voucher`, payload, reqOpts);
      applyLoaded(data);
      window.alert(data.message || 'Saved.');
      setMode('view');
      window.setTimeout(() => newBtnRef.current?.focus(), 80);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Save failed.';
      setStatus(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  }, [
    apiBase,
    apiParams,
    applyLoaded,
    compYear,
    footer,
    fyMaxYmd,
    fyMinYmd,
    header,
    lines,
    mode,
    totals.mbamt,
  ]);

  const deleteVoucher = useCallback(async () => {
    if (!header.r_no) return;
    if (!evPerms?.canDelete) {
      setStatus('Delete permission denied.');
      return;
    }
    if (!window.confirm(`Delete Expenses Voucher No. ${header.r_no}?`)) return;
    setBusy(true);
    try {
      const { data } = await axios.delete(`${apiBase}/api/exp-voucher`, {
        params: {
          ...apiParams,
          r_no: header.r_no,
          r_date: toOracleDateFromAny(header.r_date),
        },
        ...reqOpts,
      });
      window.alert(data.message || 'Deleted.');
      setUiLocked(false);
      lastRnoLookupRef.current = '';
      setHeader(emptyHeader(defaultDocDate, defaultDocDate));
      setLines([emptyLine(1), emptyLine(2)]);
      setFooter(emptyFooter(ctx));
      setMode('view');
      window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 80);
    } catch (err) {
      window.alert(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, ctx, defaultDocDate, evPerms?.canDelete, focusChain, header.r_date, header.r_no]);

  const handlePrint = useCallback(() => {
    if (!hasBill) {
      window.alert('Load or save a voucher before printing.');
      return;
    }
    setPrintOpen(true);
  }, [hasBill]);

  const handleGridF1 = useCallback((e, kind, lineKey) => {
    if (e.key !== 'F1' && e.keyCode !== 112) return;
    e.preventDefault();
    if (kind === 'item') {
      helpReturnFocusRef.current = `ln-${lineKey}-item`;
      setItemHelpLine(lineKey);
    } else if (kind === 'pur') {
      helpReturnFocusRef.current = `ln-${lineKey}-pur`;
      setPurHelpLine(lineKey);
    }
  }, []);

  if (permLoading) {
    return <p className="voucher-entry-form__status">Loading Purchase Other Items…</p>;
  }
  if (permErr || !evPerms?.canOpen) {
    return (
      <div className="voucher-entry-form">
        <p className="voucher-entry-form__status voucher-entry-form__status--err">{permErr || 'Access Denied'}</p>
        {onBack ? (
          <button type="button" className="btn btn-sm" onClick={onBack}>
            Back
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="exp-voucher-form purchase-bill-form sale-entry-desktop__body voucher-entry-form">
      <div className="exp-voucher-form__toolbar-row purchase-bill-form__toolbar-row">
        <ModuleRightsPanel variant="iconsOnly" perms={evPerms} className="purchase-bill-form__perms" />
        <PurchaseBillToolbar
          busy={busy}
          mode={mode}
          pbPerms={evPerms}
          hasBill={hasBill}
          editable={editable}
          newBtnRef={newBtnRef}
          onNew={startNew}
          onEdit={startEdit}
          onDelete={deleteVoucher}
          onSave={saveVoucher}
          onClose={onBack}
          onList={() => setListOpen(true)}
          onPrint={handlePrint}
          onPosting={() => setPostingOpen(true)}
          onChecklist={onOpenChecklist}
          onOpenBill={openScanBill}
        />
      </div>

      {status ? <p className="voucher-entry-form__status">{status}</p> : null}

      <div className="exp-voucher-form__header">
        <div className="exp-voucher-form__header-row">
          <label>
            Vr.Date
            <VoucherDmyDateInput
              valueYmd={header.r_date}
              onChangeYmd={handleRdateChange}
              onBlurYmd={handleRdateBlur}
              disabled={!editable && uiLocked}
              minYmd={fyMinYmd}
              maxYmd={fyMaxYmd}
              inputRef={(el) => focusChain.register('hdr-rdate', el)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void (async () => {
                    const pending = rdateBlurTaskRef.current;
                    if (pending) await pending;
                    else await handleRdateBlur(header.r_date);
                    focusChain.focusKey('hdr-rno');
                  })();
                  return;
                }
                focusChain.onEnter('hdr-rdate')(e);
              }}
            />
          </label>
          <label>
            Vr.No.
            <input
              className="form-input"
              value={header.r_no}
              disabled={docNoLocked}
              onChange={handleRnoChange}
              onBlur={handleRnoBlur}
              ref={(el) => focusChain.register('hdr-rno', el)}
              onKeyDown={(e) => {
                if (e.key === 'F1' || e.keyCode === 112) {
                  e.preventDefault();
                  setListOpen(true);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void tryLoadExisting(header.r_no, { quiet: true, advanceIfNew: true });
                  return;
                }
                focusChain.onEnter('hdr-rno')(e);
              }}
            />
          </label>
          <label>
            Bill Date
            <VoucherDmyDateInput
              valueYmd={header.bill_date}
              onChangeYmd={(v) => setHeader((h) => ({ ...h, bill_date: v }))}
              disabled={!editable}
              minYmd={fyMinYmd}
              maxYmd={fyMaxYmd}
              inputRef={(el) => focusChain.register('hdr-billdt', el)}
              onKeyDown={focusChain.onEnter('hdr-billdt')}
            />
          </label>
          <label>
            Bill No.
            <input
              className="form-input"
              value={header.bill_no}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, bill_no: e.target.value }))}
              ref={(el) => focusChain.register('hdr-billno', el)}
              onKeyDown={focusChain.onEnter('hdr-billno')}
            />
          </label>
          <label>
            Party
            <span className="ev-help-inline">
              <input
                className="form-input"
                style={{ width: '72px', flexShrink: 0 }}
                value={header.code}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
                onBlur={() => void resolveParty(header.code)}
                ref={(el) => focusChain.register('hdr-code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'hdr-code';
                    setHelpField('party');
                    return;
                  }
                  focusChain.onEnter('hdr-code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="Party help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'hdr-code';
                  setHelpField('party');
                }}
              >
                ⌕
              </button>
            </span>
          </label>
          <label className="ev-grow">
            Name
            <input className="form-input" value={header.party_name} readOnly tabIndex={-1} />
          </label>
        </div>
        <div className="exp-voucher-form__header-row exp-voucher-form__header-row--flags">
          <label>
            L/C
            <select
              className="form-input"
              value={header.l_c}
              disabled={!editable}
              onChange={(e) => {
                const lc = e.target.value;
                setHeader((h) => ({ ...h, l_c: lc }));
                recalcAllLines(lc);
              }}
              ref={(el) => focusChain.register('hdr-lc', el)}
              onKeyDown={focusChain.onEnter('hdr-lc')}
            >
              <option value="L">L</option>
              <option value="C">C</option>
            </select>
          </label>
          <label>
            Input Receivable Y/N
            <select
              className="form-input"
              value={header.input_yn}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, input_yn: e.target.value }))}
              ref={(el) => focusChain.register('hdr-input', el)}
              onKeyDown={focusChain.onEnter('hdr-input')}
            >
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
          <label>
            Gst Trf. Goods A/c (Y/N)
            <select
              className="form-input"
              value={header.gst_trf}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, gst_trf: e.target.value }))}
              ref={(el) => focusChain.register('hdr-gsttrf', el)}
              onKeyDown={focusChain.onEnter('hdr-gsttrf')}
            >
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
          <label>
            Show In Gstr 1 (Y/N)
            <select
              className="form-input"
              value={header.show_in_gstr}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, show_in_gstr: e.target.value }))}
              ref={(el) => focusChain.register('hdr-gstr', el)}
              onKeyDown={focusChain.onEnter('hdr-gstr')}
            >
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
          <label>
            Tot.Pur.
            <input className="form-input" value={header.tot_pur} readOnly tabIndex={-1} />
          </label>
          <label className="ev-grow">
            Godown
            <span className="ev-help-inline">
              <input
                className="form-input"
                style={{ width: '56px', flexShrink: 0 }}
                value={header.god_code}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, god_code: e.target.value.toUpperCase() }))}
                onBlur={() => {
                  const code = String(header.god_code ?? '').trim();
                  const hit = godownHelpRows.find((g) => g.god_code === code);
                  if (hit) setHeader((h) => ({ ...h, god_name: hit.god_name }));
                }}
                ref={(el) => focusChain.register('hdr-god', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'hdr-god';
                    setGodownHelpOpen(true);
                    return;
                  }
                  focusChain.onEnter('hdr-god')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="Godown help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'hdr-god';
                  setGodownHelpOpen(true);
                }}
              >
                ⌕
              </button>
              <input className="form-input" value={header.god_name} readOnly tabIndex={-1} />
            </span>
          </label>
        </div>
      </div>

      <div className="exp-voucher-form__lines-wrap">
        <table className="exp-voucher-form__grid">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Code</th>
              <th>Item Name</th>
              <th>PurCd</th>
              <th>Name</th>
              <th className="ev-num">Qty.</th>
              <th className="ev-num">Rate</th>
              <th className="ev-num">Amount</th>
              <th className="ev-num">Freight</th>
              <th className="ev-num">Cgst</th>
              <th className="ev-num">Sgst</th>
              <th className="ev-num">CgstAmt</th>
              <th className="ev-num">SgstAmt</th>
              <th className="ev-num">Igst</th>
              <th className="ev-num">IgstAmt</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, idx) => (
              <tr key={ln.key}>
                <td className="ev-num">{idx + 1}</td>
                <td>
                  <input
                    className="form-input"
                    value={ln.item_code}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { item_code: e.target.value.replace(/\D/g, '') })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-item`, el)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1' || e.keyCode === 112) {
                        handleGridF1(e, 'item', ln.key);
                        return;
                      }
                      focusChain.onEnter(`ln-${ln.key}-item`)(e);
                    }}
                  />
                </td>
                <td className="ev-item-name">{ln.item_name}</td>
                <td>
                  <input
                    className="form-input"
                    value={ln.pur_code}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { pur_code: e.target.value.toUpperCase() })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-pur`, el)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1' || e.keyCode === 112) {
                        handleGridF1(e, 'pur', ln.key);
                        return;
                      }
                      focusChain.onEnter(`ln-${ln.key}-pur`)(e);
                    }}
                  />
                </td>
                <td>{ln.pur_name}</td>
                <td>
                  <input
                    className="form-input"
                    value={ln.weight}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { weight: e.target.value })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-wgt`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-wgt`)}
                  />
                </td>
                <td>
                  <input
                    className="form-input"
                    value={ln.rate}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { rate: e.target.value })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-rate`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-rate`)}
                  />
                </td>
                <td className="ev-num">{ln.amount}</td>
                <td>
                  <input
                    className="form-input"
                    value={ln.freight}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { freight: e.target.value })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-fgt`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-fgt`)}
                  />
                </td>
                <td>
                  <input
                    className="form-input"
                    inputMode="decimal"
                    value={ln.cgst_per}
                    disabled={!editable || !isLocalGst}
                    title={isLocalGst ? 'CGST %' : 'Disabled when L/C = C'}
                    onChange={(e) =>
                      updateLine(ln.key, { cgst_per: sanitizeGstPerInput(e.target.value), tax_per: '' })
                    }
                    ref={(el) => focusChain.register(`ln-${ln.key}-cgst-p`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-cgst-p`)}
                  />
                </td>
                <td>
                  <input
                    className="form-input"
                    inputMode="decimal"
                    value={ln.sgst_per}
                    disabled={!editable || !isLocalGst}
                    title={isLocalGst ? 'SGST %' : 'Disabled when L/C = C'}
                    onChange={(e) =>
                      updateLine(ln.key, { sgst_per: sanitizeGstPerInput(e.target.value), tax_per: '' })
                    }
                    ref={(el) => focusChain.register(`ln-${ln.key}-sgst-p`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-sgst-p`)}
                  />
                </td>
                <td className="ev-num">{ln.cgst_amt}</td>
                <td className="ev-num">{ln.sgst_amt}</td>
                <td>
                  <input
                    className="form-input"
                    inputMode="decimal"
                    value={ln.igst_per}
                    disabled={!editable || isLocalGst}
                    title={!isLocalGst ? 'IGST %' : 'Disabled when L/C = L'}
                    onChange={(e) =>
                      updateLine(ln.key, { igst_per: sanitizeGstPerInput(e.target.value), tax_per: '' })
                    }
                    ref={(el) => focusChain.register(`ln-${ln.key}-igst-p`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-igst-p`)}
                  />
                </td>
                <td className="ev-num">{ln.igst_amt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <button type="button" className="btn btn-sm" onClick={addLine}>
          + Add line
        </button>
      ) : null}

      {editable ? (
        <button type="button" className="btn btn-sm" onClick={addLine}>
          + Add line
        </button>
      ) : null}

      <div className="exp-voucher-form__footer">
        <div className="exp-voucher-form__footer-col">
          <div className="exp-voucher-form__footer-row">
            <label className="ev-grow">
              Remarks
              <input
                className="form-input"
                value={header.remarks}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                ref={(el) => focusChain.register('ft-remarks', el)}
                onKeyDown={focusChain.onEnter('ft-remarks')}
              />
            </label>
          </div>
          <div className="exp-voucher-form__footer-row">
            <label>
              Cost Code
              <span className="ev-help-inline">
                <input
                  className="form-input"
                  value={header.cost_code}
                  disabled={!editable}
                  onChange={(e) =>
                    setHeader((h) => ({
                      ...h,
                      cost_code: e.target.value.toUpperCase(),
                      cost_name: '',
                    }))
                  }
                  onBlur={() => {
                    const code = String(header.cost_code || '').trim();
                    if (!code) {
                      setHeader((h) => ({ ...h, cost_name: '' }));
                      return;
                    }
                    const hit = costHelpRows.find((c) => c.cost_code === code);
                    setHeader((h) => ({
                      ...h,
                      cost_code: code,
                      cost_name: hit?.cost_name || h.cost_name || '',
                    }));
                    if (!hit) setStatus(`Cost code ${code} not found in COST master.`);
                  }}
                  ref={(el) => focusChain.register('ft-cost', el)}
                  onKeyDown={(e) => {
                    if (e.key === 'F1' || e.keyCode === 112) {
                      e.preventDefault();
                      helpReturnFocusRef.current = 'ft-cost';
                      setCostHelpOpen(true);
                      return;
                    }
                    focusChain.onEnter('ft-cost')(e);
                  }}
                />
                <button
                  type="button"
                  className="pb-help-btn"
                  tabIndex={-1}
                  disabled={!editable}
                  title="Cost centre help (F1) — COST master"
                  onClick={() => {
                    if (!editable) return;
                    helpReturnFocusRef.current = 'ft-cost';
                    setCostHelpOpen(true);
                  }}
                >
                  ⌕
                </button>
              </span>
            </label>
            <span className="ev-cost-name" title={header.cost_name}>
              {header.cost_name || '—'}
            </span>
          </div>
          <div className="exp-voucher-form__footer-row">
            <label className="ev-grow">
              Mod. Reason
              <input
                className="form-input"
                value={header.mod_reason}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, mod_reason: e.target.value }))}
                ref={(el) => focusChain.register('ft-mod', el)}
                onKeyDown={focusChain.onEnter('ft-mod')}
              />
            </label>
          </div>
          <div className="exp-voucher-form__footer-row">
            <label className="ev-grow">
              Scan Bill Path
              <span style={{ display: 'flex', gap: '0.25rem' }}>
                <input
                  className="form-input"
                  value={footer.p_bill_no_file_path}
                  disabled={!editable}
                  onChange={(e) => onFooter('p_bill_no_file_path', e.target.value)}
                  ref={(el) => focusChain.register('ft-scan', el)}
                  onKeyDown={focusChain.onEnter('ft-scan')}
                />
                <input
                  ref={scanInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void pickScanFile(f);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!editable || scanBusy}
                  onClick={() => scanInputRef.current?.click()}
                >
                  {scanBusy ? '…' : 'Browse'}
                </button>
              </span>
            </label>
          </div>
        </div>

        <div className="ev-summary-pane">
          <div className="ev-summary-row">
            <span className="ev-summary-row__lbl">Total</span>
            <span className="ev-summary-row__amt">{fmtWgt(totals.tw)}</span>
            <span className="ev-summary-row__amt">{fmtAmt(totals.mamt)}</span>
          </div>
          <div className="ev-summary-row">
            <span className="ev-summary-row__lbl">Freight</span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.freight)}</span>
          </div>
          <div className="ev-summary-row ev-summary-row--tax">
            <span className="ev-summary-row__lbl">CGST</span>
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.cgst_code}
                disabled={!editable}
                onChange={(e) => onFooter('cgst_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-cgst_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-cgst_code';
                    setHelpField('cgst');
                    return;
                  }
                  focusChain.onEnter('ft-cgst_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="CGST A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-cgst_code';
                  setHelpField('cgst');
                }}
              >
                ⌕
              </button>
            </span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.cgst_amt)}</span>
          </div>
          <div className="ev-summary-row ev-summary-row--tax">
            <span className="ev-summary-row__lbl">SGST</span>
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.sgst_code}
                disabled={!editable}
                onChange={(e) => onFooter('sgst_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-sgst_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-sgst_code';
                    setHelpField('sgst');
                    return;
                  }
                  focusChain.onEnter('ft-sgst_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="SGST A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-sgst_code';
                  setHelpField('sgst');
                }}
              >
                ⌕
              </button>
            </span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.sgst_amt)}</span>
          </div>
          <div className="ev-summary-row ev-summary-row--tax">
            <span className="ev-summary-row__lbl">IGST</span>
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.igst_code}
                disabled={!editable}
                onChange={(e) => onFooter('igst_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-igst_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-igst_code';
                    setHelpField('igst');
                    return;
                  }
                  focusChain.onEnter('ft-igst_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="IGST A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-igst_code';
                  setHelpField('igst');
                }}
              >
                ⌕
              </button>
            </span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.igst_amt)}</span>
          </div>
          <div className="ev-summary-row ev-summary-row--tax">
            <span className="ev-summary-row__lbl">Add/Less Exp.</span>
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.oth_cd_1}
                disabled={!editable}
                onChange={(e) => onFooter('oth_cd_1', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-oth_cd_1', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-oth_cd_1';
                    setHelpField('oth');
                    return;
                  }
                  focusChain.onEnter('ft-oth_cd_1')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="Add/Less A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-oth_cd_1';
                  setHelpField('oth');
                }}
              >
                ⌕
              </button>
            </span>
            <span />
            <input
              className="form-input ev-summary-row__amt-input"
              value={footer.oth_exp_1}
              disabled={!editable}
              onChange={(e) => onFooter('oth_exp_1', e.target.value)}
              ref={(el) => focusChain.register('ft-oth_exp_1', el)}
              onKeyDown={focusChain.onEnter('ft-oth_exp_1')}
            />
          </div>
          <div className="ev-summary-row ev-summary-row--tcs">
            <span className="ev-summary-row__lbl">Tcs %</span>
            <input
              className="form-input"
              value={footer.tcs_per}
              disabled={!editable}
              title="TCS %"
              onChange={(e) => onFooter('tcs_per', sanitizeGstPerInput(e.target.value))}
              ref={(el) => focusChain.register('ft-tcs_per', el)}
              onKeyDown={focusChain.onEnter('ft-tcs_per')}
            />
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.tcs_code}
                disabled={!editable}
                onChange={(e) => onFooter('tcs_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-tcs_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-tcs_code';
                    setHelpField('tcs');
                    return;
                  }
                  focusChain.onEnter('ft-tcs_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="TCS A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-tcs_code';
                  setHelpField('tcs');
                }}
              >
                ⌕
              </button>
            </span>
            <input
              className="form-input ev-summary-row__amt-input"
              value={footer.tcs_amt}
              disabled={!editable}
              onChange={(e) => onFooter('tcs_amt', e.target.value)}
              ref={(el) => focusChain.register('ft-tcs_amt', el)}
              onKeyDown={focusChain.onEnter('ft-tcs_amt')}
            />
          </div>
          <div className="ev-summary-row ev-summary-row--net">
            <span className="ev-summary-row__lbl">Net Amount</span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.mbamt)}</span>
          </div>
          <div className="ev-summary-row ev-summary-row--tds">
            <span className="ev-summary-row__lbl">− TDS</span>
            <input
              className="form-input"
              value={footer.ntds_per}
              disabled={!editable}
              title="TDS %"
              onChange={(e) => onFooter('ntds_per', sanitizeGstPerInput(e.target.value))}
              ref={(el) => focusChain.register('ft-ntds_per', el)}
              onKeyDown={focusChain.onEnter('ft-ntds_per')}
            />
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.ntds_code}
                disabled={!editable}
                onChange={(e) => onFooter('ntds_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-ntds_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-ntds_code';
                    setHelpField('ntds');
                    return;
                  }
                  focusChain.onEnter('ft-ntds_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="TDS A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-ntds_code';
                  setHelpField('ntds');
                }}
              >
                ⌕
              </button>
            </span>
            <input
              className="form-input ev-summary-row__amt-input"
              value={footer.ntds_amt}
              disabled={!editable}
              onChange={(e) => onFooter('ntds_amt', e.target.value)}
              ref={(el) => focusChain.register('ft-ntds_amt', el)}
              onKeyDown={focusChain.onEnter('ft-ntds_amt')}
            />
          </div>
          <div className="ev-summary-row ev-summary-row--nature">
            <span className="ev-summary-row__lbl">Nature</span>
            <span className="ev-help-inline">
              <input
                className="form-input"
                value={footer.nature}
                disabled={!editable}
                onChange={(e) => onFooter('nature', e.target.value)}
                onBlur={() => void validateNature()}
                ref={(el) => focusChain.register('ft-nature', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    void openNatureHelp();
                    return;
                  }
                  focusChain.onEnter('ft-nature')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable || natureHelpBusy}
                title="TDS Nature help (F1) — NATURE master"
                onClick={() => void openNatureHelp()}
              >
                ⌕
              </button>
            </span>
          </div>
          <div className="ev-summary-row ev-summary-row--net">
            <span className="ev-summary-row__lbl">Net Payable Amount</span>
            <span />
            <span className="ev-summary-row__amt">{fmtAmt(totals.net_payable)}</span>
          </div>
        </div>
      </div>

      <PurchaseBillPrintModal
        open={printOpen}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={
          header.r_no
            ? {
                type: EV_TYPE,
                oracleDt: toOracleDateFromAny(header.r_date),
                r_date: toOracleDateFromAny(header.r_date),
                rNo: header.r_no,
                r_no: header.r_no,
                label: `Expenses Voucher — EV / ${header.r_no} / ${header.r_date || ''}`,
              }
            : null
        }
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        onClose={() => setPrintOpen(false)}
      />

      <VoucherAccountHelpModal
        open={!!helpField && !godownHelpOpen && !costHelpOpen && !natureHelpOpen}
        title="Account help (F1)"
        accounts={purAccounts}
        onSelect={(code) => {
          if (helpField === 'party') void resolveParty(code);
          else if (helpField === 'cgst') onFooter('cgst_code', code);
          else if (helpField === 'sgst') onFooter('sgst_code', code);
          else if (helpField === 'igst') onFooter('igst_code', code);
          else if (helpField === 'oth') onFooter('oth_cd_1', code);
          else if (helpField === 'tcs') onFooter('tcs_code', code);
          else if (helpField === 'ntds') onFooter('ntds_code', code);
          setHelpField(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setHelpField(null);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownHelpRows}
        onSelect={(row) => {
          const code = String(row?.god_code ?? '').trim();
          const hit = godownHelpRows.find((g) => g.god_code === code);
          setHeader((h) => ({ ...h, god_code: code, god_name: hit?.god_name || '' }));
          setGodownHelpOpen(false);
          restoreHelpFocus();
        }}
        onClose={() => {
          setGodownHelpOpen(false);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={costHelpOpen}
        title="Cost centre help"
        columns={COST_HELP_COLUMNS}
        rows={costHelpRows}
        onSelect={(row) => {
          const code = String(row?.cost_code ?? row?.COST_CODE ?? '').trim();
          const name = String(row?.cost_name ?? row?.COST_NAME ?? '').trim();
          setHeader((h) => ({ ...h, cost_code: code, cost_name: name }));
          setCostHelpOpen(false);
          restoreHelpFocus();
        }}
        onClose={() => {
          setCostHelpOpen(false);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={natureHelpOpen}
        title="X1 — TDS Nature help"
        hint={natureHelpBusy ? 'Loading NATURE master…' : 'Select Nature · fills TDS % and Leg Code'}
        loading={natureHelpBusy}
        error={natureHelpError}
        columns={NATURE_HELP_COLUMNS}
        rows={natureHelpRows}
        onSelect={(row) => {
          applyNature(row);
          setNatureHelpOpen(false);
          restoreHelpFocus();
        }}
        onClose={() => {
          setNatureHelpOpen(false);
          setNatureHelpError('');
          restoreHelpFocus();
        }}
      />
      <VoucherItemHelpModal
        open={itemHelpLine != null}
        items={items}
        onSelect={(item) => {
          if (itemHelpLine == null) return;
          updateLine(itemHelpLine, {
            item_code: String(item.ITEM_CODE ?? item.item_code ?? ''),
          });
          setItemHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          if (itemHelpLine != null && !helpReturnFocusRef.current) {
            helpReturnFocusRef.current = `ln-${itemHelpLine}-item`;
          }
          setItemHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherAccountHelpModal
        open={purHelpLine != null}
        title="Purchase code help"
        accounts={purAccounts}
        onSelect={(code) => {
          if (purHelpLine == null) return;
          updateLine(purHelpLine, { pur_code: code });
          setPurHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setPurHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <ExpVoucherListModal
        open={listOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        onSelect={({ r_no, r_date }) => void loadBill(r_no, r_date)}
        onClose={() => setListOpen(false)}
      />
      <ExpVoucherPostingModal
        open={postingOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        rDate={header.r_date}
        rNo={header.r_no}
        onClose={() => setPostingOpen(false)}
      />
    </div>
  );
}
