import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import PurchaseBillToolbar from './PurchaseBillToolbar';
import DcNoteListModal from './DcNoteListModal';
import DcNotePostingModal from './DcNotePostingModal';
import DcNoteBillHelpModal from './DcNoteBillHelpModal';
import DcNoteEinvDirectModal from './DcNoteEinvDirectModal';
import DcNoteEinvPrintModal from './DcNoteEinvPrintModal';
import PurchaseBillPrintModal from './PurchaseBillPrintModal';
import { toInputDateString, toOracleDate, toOracleDateFromAny } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import { fetchDirectEinvStatus } from '../utils/checkDirectEinv';
import {
  num,
  recalcLine,
  sumFooter,
  applyItemmastToLine,
  accountDisplayName,
  sanitizeGstPerInput,
} from '../utils/dcNoteCalc';
import '../styles/voucherEntryForm.css';
import '../styles/gfasToolbar.css';
import '../styles/purchaseBillForm.css';
import '../styles/dcNoteForm.css';

const reqOpts = { withCredentials: true, timeout: 120000 };
const DEFAULT_PERMS = { canOpen: true, canAdd: true, canEdit: true, canDelete: true };

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtQty(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function normalizeNoteType(t) {
  return String(t || 'DX').trim().toUpperCase() === 'CX' ? 'CX' : 'DX';
}

function noteTitle(noteType) {
  return normalizeNoteType(noteType) === 'CX' ? 'Credit Note' : 'Debit Note';
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
    qnty: '',
    weight: '',
    amt_cal: 'W',
    rate: '',
    amount: '',
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
    dc_bill_no: '',
    dc_b_type: '',
    bill_no: '',
    code: '',
    party_name: '',
    gst_no: '',
    l_c: 'L',
    input_yn: 'Y',
    s_p: 'P',
    tcs_others: 'O',
    remarks: '',
    irn_no: '',
    ack_no: '',
    signed_qr_code: '',
    mod_reason: '',
  };
}

function emptyFooter(ctx = {}) {
  return {
    cgst_code: ctx.cgst_code || '',
    sgst_code: ctx.sgst_code || '',
    igst_code: ctx.igst_code || '',
    tax_code: '',
    addexp: '',
  };
}

/** Shared Debit/Credit Note Others entry — VFP DCNOTE WITH 'DX'|'CX'. */
export default function DcNoteOthersEntryForm({
  apiBase,
  formData,
  userName,
  noteType: noteTypeProp = 'DX',
  onBack,
  onOpenChecklist,
}) {
  const noteType = normalizeNoteType(noteTypeProp);
  const title = noteTitle(noteType);

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
  const [perms, setPerms] = useState(DEFAULT_PERMS);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const [items, setItems] = useState([]);
  const [purAccounts, setPurAccounts] = useState([]);
  const [partyAccounts, setPartyAccounts] = useState([]);

  const [helpField, setHelpField] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [purHelpLine, setPurHelpLine] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [einvDirectOpen, setEinvDirectOpen] = useState(false);
  const [einvPrintOpen, setEinvPrintOpen] = useState(false);
  const [einvGstNo, setEinvGstNo] = useState('');
  const [billHelpOpen, setBillHelpOpen] = useState(false);
  const [billHelpRows, setBillHelpRows] = useState([]);
  const [billHelpLoading, setBillHelpLoading] = useState(false);
  const [billHelpError, setBillHelpError] = useState('');

  const lineKeyRef = useRef(3);
  const newBtnRef = useRef(null);
  const entryFocusDoneRef = useRef(false);
  const lastRnoLookupRef = useRef('');
  const helpReturnFocusRef = useRef(null);
  const rdateBlurTaskRef = useRef(null);

  const apiParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName }),
    [compCode, compUid, userName]
  );

  const editable = mode === 'new' || mode === 'edit';
  const docNoLocked = uiLocked || mode === 'edit' || (mode === 'new' && !!String(header.r_no ?? '').trim());
  const hasBill = !!String(header.r_no ?? '').trim() && uiLocked;
  const isLocalGst = String(header.l_c || 'L').toUpperCase() === 'L';
  const totals = useMemo(() => sumFooter(lines, footer), [lines, footer]);

  const einvVoucherHeader = useMemo(
    () => ({
      r_date: header.r_date,
      r_no: header.r_no,
      code: header.code,
      party_name: header.party_name,
      dc_b_type: header.dc_b_type,
      irn_no: header.irn_no,
    }),
    [header.r_date, header.r_no, header.code, header.party_name, header.dc_b_type, header.irn_no]
  );

  const accountListForHelp = useMemo(() => {
    if (helpField === 'party') return partyAccounts.length ? partyAccounts : purAccounts;
    return purAccounts.length ? purAccounts : partyAccounts;
  }, [helpField, partyAccounts, purAccounts]);

  const focusOrder = useMemo(() => {
    const keys = [
      'hdr-rdate',
      'hdr-rno',
      'hdr-code',
      'hdr-input',
      'hdr-sp',
      'hdr-tcs',
      'hdr-billdt',
      'hdr-dcbill',
      'hdr-dctype',
      'hdr-billno',
    ];
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-item`,
        `ln-${ln.key}-pur`,
        `ln-${ln.key}-qty`,
        `ln-${ln.key}-wgt`,
        `ln-${ln.key}-cal`,
        `ln-${ln.key}-rate`
      );
      if (isLocalGst) {
        keys.push(`ln-${ln.key}-cgst-p`, `ln-${ln.key}-sgst-p`);
      } else {
        keys.push(`ln-${ln.key}-igst-p`);
      }
    }
    keys.push(
      'ft-remarks',
      'ft-irn',
      'ft-ack',
      'ft-qr',
      'ft-mod',
      'ft-cgst_code',
      'ft-sgst_code',
      'ft-igst_code',
      'ft-tax_code',
      'ft-addexp'
    );
    return keys;
  }, [isLocalGst, lines]);

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
    if (permLoading || permErr || entryFocusDoneRef.current || !perms?.canOpen) return;
    entryFocusDoneRef.current = true;
    window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 80);
  }, [focusChain, permErr, permLoading, perms?.canOpen]);

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      let nextPerms = DEFAULT_PERMS;
      try {
        const permRes = await axios.get(`${apiBase}/api/purchase-bill/user-permissions`, {
          params: { user_name: userName },
          ...reqOpts,
        });
        nextPerms = { ...DEFAULT_PERMS, ...(permRes.data || {}) };
      } catch {
        nextPerms = DEFAULT_PERMS;
      }
      setPerms(nextPerms);
      if (!nextPerms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, purRes, partyRes] = await Promise.all([
        axios.get(`${apiBase}/api/dc-note/context`, { params }),
        axios.get(`${apiBase}/api/purchaselist-items`, { params }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
        axios.get(`${apiBase}/api/master-accounts`, { params }).catch(() => ({ data: [] })),
      ]);
      const c = ctxRes.data || {};
      setCtx(c);
      setFooter(emptyFooter(c));
      setItems(itemsRes.data || []);
      setPurAccounts(purRes.data || []);
      setPartyAccounts(Array.isArray(partyRes.data) ? partyRes.data : []);
    } catch (err) {
      setPermErr(err.response?.data?.error || err.message || `Could not load ${title.toLowerCase()}.`);
      setPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, compCode, compUid, title, userName]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const onFooter = useCallback((field, value) => {
    setFooter((f) => ({ ...f, [field]: value }));
  }, []);

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      const lc = String(h.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L';
      setHeader({
        r_date: toInputDateString(h.r_date) || defaultDocDate,
        r_no: h.r_no ? String(h.r_no) : '',
        bill_date: toInputDateString(h.bill_date) || defaultDocDate,
        dc_bill_no: h.dc_bill_no ? String(h.dc_bill_no) : '',
        dc_b_type: String(h.dc_b_type ?? '').trim().toUpperCase(),
        bill_no: h.bill_no || '',
        code: h.code || '',
        party_name: h.party_name || '',
        gst_no: h.gst_no || '',
        l_c: lc,
        input_yn: String(h.input_yn ?? 'Y').toUpperCase() === 'Y' ? 'Y' : 'N',
        s_p: String(h.s_p ?? 'P').toUpperCase() === 'S' ? 'S' : 'P',
        tcs_others: String(h.tcs_others ?? 'O').toUpperCase() === 'T' ? 'T' : 'O',
        remarks: h.remarks || '',
        irn_no: h.irn_no || '',
        ack_no: h.ack_no || '',
        signed_qr_code: h.signed_qr_code || '',
        mod_reason: h.mod_reason || '',
      });
      setFooter((f) => ({
        ...f,
        cgst_code: h.cgst_code || f.cgst_code,
        sgst_code: h.sgst_code || f.sgst_code,
        igst_code: h.igst_code || f.igst_code,
        tax_code: h.tax_code || '',
        addexp: h.addexp != null && Number(h.addexp) !== 0 ? String(h.addexp) : '',
      }));
      const loaded = (data?.lines || []).map((ln, idx) => {
        const base = {
          key: idx + 1,
          trn_no: ln.trn_no || idx + 1,
          item_code: ln.item_code ? String(ln.item_code) : '',
          item_name: ln.item_name || '',
          tax_per: '',
          pur_code: ln.pur_code || '',
          pur_name: ln.pur_name || '',
          qnty: ln.qnty != null ? String(ln.qnty) : '',
          weight: ln.weight != null ? String(ln.weight) : '',
          amt_cal: String(ln.amt_cal ?? 'W').toUpperCase().slice(0, 1) || 'W',
          rate: ln.rate != null ? String(ln.rate) : '',
          amount: ln.amount != null ? String(ln.amount) : '',
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
        if (!quiet) setStatus('Enter Vr.Date.');
        return false;
      }
      if (!no) {
        try {
          const { data } = await axios.get(`${apiBase}/api/dc-note/next-no`, {
            params: { ...apiParams, type: noteType, r_date: oracleDt },
            ...reqOpts,
          });
          no = String(data.next_no || '').trim();
          if (no) setHeader((h) => ({ ...h, r_no: no }));
        } catch {
          /* optional */
        }
      }
      if (!no) {
        if (!quiet) setStatus('Enter Vr.No.');
        return false;
      }
      const lookupKey = `${oracleDt}|${no}`;
      if (lookupKey === lastRnoLookupRef.current && uiLocked) return true;

      setBusy(true);
      if (!quiet) setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/dc-note`, {
          params: { ...apiParams, type: noteType, r_no: no, r_date: oracleDt },
          ...reqOpts,
        });
        lastRnoLookupRef.current = lookupKey;
        applyLoaded(data);
        setStatus(`${title} ${no} loaded — press Edit to modify or Delete to remove.`);
        return true;
      } catch (err) {
        lastRnoLookupRef.current = lookupKey;
        if (err.response?.status === 404) {
          let billNo = no;
          if (!billNo) {
            try {
              const { data } = await axios.get(`${apiBase}/api/dc-note/next-no`, {
                params: { ...apiParams, type: noteType, r_date: oracleDt },
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
          if (!quiet) setStatus(billNo ? `New ${title.toLowerCase()} ${billNo} — enter details.` : `New ${title.toLowerCase()} — enter details.`);
          if (advanceIfNew) {
            window.setTimeout(() => focusChain.focusKey('hdr-code'), 50);
          }
          return false;
        }
        if (!quiet) setStatus(err.response?.data?.error || err.message || 'Load failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      apiBase,
      apiParams,
      applyLoaded,
      ctx,
      defaultDocDate,
      focusChain,
      header.r_date,
      header.r_no,
      noteType,
      title,
      uiLocked,
    ]
  );

  const loadBill = useCallback(
    async (rNo, rDate) => {
      if (!rNo) return;
      setBusy(true);
      setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/dc-note`, {
          params: {
            ...apiParams,
            type: noteType,
            r_no: rNo,
            r_date: toOracleDateFromAny(rDate || header.r_date),
          },
          ...reqOpts,
        });
        applyLoaded(data);
        setStatus(`${title} ${rNo} loaded.`);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, header.r_date, noteType, title]
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
        const { data } = await axios.get(`${apiBase}/api/dc-note/next-no`, {
          params: { ...apiParams, type: noteType, r_date: oracleDt },
          ...reqOpts,
        });
        return String(data.next_no ?? '');
      } catch {
        return null;
      }
    },
    [apiBase, apiParams, noteType]
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
      setStatus(`Open a ${title.toLowerCase()} first.`);
      return;
    }
    if (!perms?.canEdit) {
      setStatus('Edit permission denied.');
      return;
    }
    setMode('edit');
    setStatus('');
  }, [header.r_no, perms?.canEdit, title]);

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
            next.pur_name = accountDisplayName(purAccounts, code) || accountDisplayName(partyAccounts, code);
          }
          return recalcLine(next, header.l_c);
        })
      );
    },
    [header.l_c, items, partyAccounts, purAccounts]
  );

  const recalcAllLines = useCallback((lc) => {
    setLines((prev) => prev.map((ln) => recalcLine(ln, lc)));
  }, []);

  const resolveParty = useCallback(
    (code) => {
      const c = String(code ?? '').trim().toUpperCase();
      const list = partyAccounts.length ? partyAccounts : purAccounts;
      const hit = (list || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
      const lc = hit
        ? String(hit.L_C ?? hit.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L'
        : 'L';
      setHeader((h) => ({
        ...h,
        code: c,
        party_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
        gst_no: hit ? String(hit.GST_NO ?? hit.gst_no ?? '').trim() : '',
        l_c: hit ? lc : h.l_c || 'L',
      }));
      if (hit) recalcAllLines(lc);
    },
    [partyAccounts, purAccounts, recalcAllLines]
  );

  const fyOracleStart = useMemo(
    () => toOracleDate(fyMinYmd) || toOracleDateFromAny(formData?.comp_s_dt ?? formData?.COMP_S_DT),
    [fyMinYmd, formData?.comp_s_dt, formData?.COMP_S_DT]
  );

  const openBillHelp = useCallback(async () => {
    if (!editable) {
      setStatus('Press New or Edit before bill help.');
      return;
    }
    const code = String(header.code || '').trim();
    if (!code) {
      setStatus('Enter party code first, then open Bill Date help.');
      window.alert('Enter party code first.');
      focusChain.focusKey('hdr-code');
      return;
    }
    helpReturnFocusRef.current = 'hdr-billdt';
    setBillHelpOpen(true);
    setBillHelpLoading(true);
    setBillHelpError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/dc-note/bill-help`, {
        params: {
          ...apiParams,
          code,
          s_p: header.s_p || 'P',
          fy_s_date: fyOracleStart,
        },
        ...reqOpts,
      });
      setBillHelpRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      setBillHelpError(err.response?.data?.error || err.message || 'Bill help failed.');
      setBillHelpRows([]);
    } finally {
      setBillHelpLoading(false);
    }
  }, [apiBase, apiParams, editable, focusChain, fyOracleStart, header.code, header.s_p]);

  const applyBillHelp = useCallback(
    (row) => {
      if (!row) return;
      const billYmd = toInputDateString(row.bill_date) || header.bill_date;
      if (String(header.s_p || 'P').toUpperCase() === 'S') {
        setHeader((h) => ({
          ...h,
          bill_date: billYmd,
          dc_bill_no: row.bill_no != null ? String(row.bill_no) : '',
          dc_b_type: String(row.b_type ?? '').trim().toUpperCase().slice(0, 5),
        }));
      } else {
        setHeader((h) => ({
          ...h,
          bill_date: billYmd,
          dc_bill_no: row.r_no != null ? String(row.r_no) : '',
          dc_b_type: '',
          bill_no: String(row.bill_no ?? '').trim(),
        }));
      }
      window.setTimeout(() => focusChain.focusKey('hdr-billdt'), 80);
    },
    [focusChain, header.bill_date, header.s_p]
  );

  const addLine = useCallback(() => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key)]);
  }, []);

  const removeLine = useCallback((key) => {
    setLines((prev) => {
      if (prev.length <= 1) return [emptyLine(1)];
      return prev.filter((ln) => ln.key !== key);
    });
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
        type: noteType,
        r_date: toOracleDateFromAny(header.r_date),
        r_no: Number(header.r_no) || 0,
        bill_date: toOracleDateFromAny(header.bill_date),
        dc_bill_no: Number(header.dc_bill_no) || 0,
        dc_b_type: String(header.dc_b_type ?? '').trim().toUpperCase().slice(0, 5),
        bill_no: header.bill_no,
        code: header.code,
        input_yn: header.input_yn,
        s_p: header.s_p,
        tcs_others: header.tcs_others,
        remarks: header.remarks,
        irn_no: header.irn_no,
        ack_no: header.ack_no,
        signed_qr_code: header.signed_qr_code,
        mod_reason: header.mod_reason,
        footer: {
          ...footer,
          bill_amt: totals.mbamt,
          mbamt: totals.mbamt,
          addexp: num(footer.addexp),
        },
        lines: validLines.map((ln, idx) => ({
          ...ln,
          trn_no: ln.trn_no || idx + 1,
          item_code: Number(ln.item_code) || 0,
          qnty: num(ln.qnty),
          weight: num(ln.weight),
          rate: num(ln.rate),
          amount: num(ln.amount),
          amt_cal: String(ln.amt_cal || 'W').toUpperCase().slice(0, 1) || 'W',
          cgst_per: num(ln.cgst_per),
          sgst_per: num(ln.sgst_per),
          igst_per: num(ln.igst_per),
          cgst_amt: num(ln.cgst_amt),
          sgst_amt: num(ln.sgst_amt),
          igst_amt: num(ln.igst_amt),
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/dc-note`, payload, reqOpts);
      const savedNo = data?.r_no || header.r_no;
      const savedDate = data?.r_date || header.r_date;
      await loadBill(savedNo, savedDate);
      window.alert(data.message || `${title} saved.`);
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
    compYear,
    footer,
    fyMaxYmd,
    fyMinYmd,
    header,
    lines,
    loadBill,
    mode,
    noteType,
    title,
    totals.mbamt,
  ]);

  const deleteVoucher = useCallback(async () => {
    if (!header.r_no) return;
    if (!perms?.canDelete) {
      setStatus('Delete permission denied.');
      return;
    }
    if (!window.confirm(`Delete ${title} No. ${header.r_no}?`)) return;
    let modReason = String(header.mod_reason || '').trim();
    if (!modReason) {
      const entered = window.prompt('Modification reason (required for delete):', '') || '';
      modReason = String(entered).trim();
      if (!modReason) {
        setStatus('Mod. Reason is required to delete.');
        return;
      }
      setHeader((h) => ({ ...h, mod_reason: modReason }));
    }
    setBusy(true);
    try {
      const { data } = await axios.delete(`${apiBase}/api/dc-note`, {
        params: {
          ...apiParams,
          type: noteType,
          r_no: header.r_no,
          r_date: toOracleDateFromAny(header.r_date),
          mod_reason: modReason,
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
  }, [
    apiBase,
    apiParams,
    ctx,
    defaultDocDate,
    focusChain,
    header.mod_reason,
    header.r_date,
    header.r_no,
    noteType,
    perms?.canDelete,
    title,
  ]);

  const handlePrint = useCallback(() => {
    if (!hasBill) {
      window.alert(`Load or save a ${title.toLowerCase()} before printing.`);
      return;
    }
    setPrintOpen(true);
  }, [hasBill, title]);

  const ensureDirectEinvActivated = useCallback(
    async (notActivatedMessage) => {
      if (!hasBill) {
        window.alert(`Load or save a ${title.toLowerCase()} first.`);
        return false;
      }
      try {
        const { activated, gstNo } = await fetchDirectEinvStatus(apiBase, compCode, reqOpts);
        if (!activated) {
          window.alert(notActivatedMessage);
          return false;
        }
        setEinvGstNo(gstNo);
        return true;
      } catch (err) {
        window.alert(err.response?.data?.error || err.message || 'GST profile check failed.');
        return false;
      }
    },
    [apiBase, compCode, hasBill, title]
  );

  const handleEinv = useCallback(async () => {
    const ok = await ensureDirectEinvActivated('!!! Direct E.Inv. Not Activated !!!');
    if (!ok) return;
    setEinvDirectOpen(true);
  }, [ensureDirectEinvActivated]);

  const handleEinvPrn = useCallback(async () => {
    const ok = await ensureDirectEinvActivated('!!! Direct E.WAY. Not Activated !!!');
    if (!ok) return;
    setEinvPrintOpen(true);
  }, [ensureDirectEinvActivated]);

  const onEinvVoucherUpdated = useCallback((data) => {
    const h = data?.header;
    if (!h) return;
    setHeader((prev) => ({
      ...prev,
      irn_no: h.irn_no ?? prev.irn_no,
      ack_no: h.ack_no ?? prev.ack_no,
      signed_qr_code: h.signed_qr_code ?? prev.signed_qr_code,
    }));
  }, []);

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
    return <p className="voucher-entry-form__status">Loading {title}…</p>;
  }
  if (permErr || !perms?.canOpen) {
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
    <div className="dc-note-form purchase-bill-form sale-entry-desktop__body voucher-entry-form">
      <div className="dc-note-form__toolbar-row purchase-bill-form__toolbar-row">
        <h3 className="dc-note-form__title">{title}</h3>
        <ModuleRightsPanel variant="iconsOnly" perms={perms} className="purchase-bill-form__perms" />
        <PurchaseBillToolbar
          busy={busy}
          mode={mode}
          pbPerms={perms}
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
          onEinv={handleEinv}
          onEinvPrn={handleEinvPrn}
          onPosting={() => setPostingOpen(true)}
          onChecklist={onOpenChecklist}
          onOpenBill={() => {}}
        />
      </div>

      {status ? <p className="voucher-entry-form__status">{status}</p> : null}

      <div className="dc-note-form__header">
        <div className="dc-note-form__header-row">
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
            Party
            <span className="dc-help-inline">
              <input
                className="form-input"
                style={{ width: '72px', flexShrink: 0 }}
                value={header.code}
                disabled={!editable && uiLocked}
                onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
                onBlur={() => resolveParty(header.code)}
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
                disabled={!editable && uiLocked}
                title="Party help (F1)"
                onClick={() => {
                  if (!editable && uiLocked) return;
                  helpReturnFocusRef.current = 'hdr-code';
                  setHelpField('party');
                }}
              >
                ⌕
              </button>
            </span>
          </label>
          <label className="dc-grow">
            Name
            <input className="form-input" value={header.party_name} readOnly tabIndex={-1} />
          </label>
          <label>
            GSTIN
            <input className="form-input" value={header.gst_no} readOnly tabIndex={-1} style={{ minWidth: '10rem' }} />
          </label>
        </div>
        <div className="dc-note-form__header-row dc-note-form__header-row--flags">
          <label>
            L/C
            <input className="form-input" value={header.l_c} readOnly tabIndex={-1} style={{ width: '2.5rem' }} />
          </label>
          <label>
            Include In Gstr Y/N
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
            Sale/Purchase S/P
            <select
              className="form-input"
              value={header.s_p}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, s_p: e.target.value }))}
              ref={(el) => focusChain.register('hdr-sp', el)}
              onKeyDown={focusChain.onEnter('hdr-sp')}
            >
              <option value="P">P</option>
              <option value="S">S</option>
            </select>
          </label>
          <label>
            (T)cs / (O)thers
            <select
              className="form-input"
              value={header.tcs_others}
              disabled={!editable}
              onChange={(e) => setHeader((h) => ({ ...h, tcs_others: e.target.value }))}
              ref={(el) => focusChain.register('hdr-tcs', el)}
              onKeyDown={focusChain.onEnter('hdr-tcs')}
            >
              <option value="O">O</option>
              <option value="T">T</option>
            </select>
          </label>
        </div>
        <div className="dc-note-form__header-row dc-note-form__header-row--bill">
          <label>
            Bill Date
            <span className="dc-help-inline">
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable || busy}
                title="Bill date help — pick sale or purchase bill"
                onClick={() => void openBillHelp()}
              >
                ⌕
              </button>
              <VoucherDmyDateInput
                valueYmd={header.bill_date}
                onChangeYmd={(v) => setHeader((h) => ({ ...h, bill_date: v }))}
                disabled={!editable}
                minYmd={fyMinYmd}
                maxYmd={fyMaxYmd}
                inputRef={(el) => focusChain.register('hdr-billdt', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    void openBillHelp();
                    return;
                  }
                  focusChain.onEnter('hdr-billdt')(e);
                }}
              />
            </span>
          </label>
          <label className="dc-billno-group">
            Bill No.
            <span className="dc-billno-fields">
              <input
                className="form-input"
                style={{ width: '72px' }}
                title="DC Bill No"
                value={header.dc_bill_no}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, dc_bill_no: e.target.value.replace(/\D/g, '') }))}
                ref={(el) => focusChain.register('hdr-dcbill', el)}
                onKeyDown={focusChain.onEnter('hdr-dcbill')}
              />
              <input
                className="form-input"
                style={{ width: '42px' }}
                title="DC Bill Type"
                maxLength={5}
                value={header.dc_b_type}
                disabled={!editable}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, dc_b_type: e.target.value.toUpperCase().slice(0, 5) }))
                }
                ref={(el) => focusChain.register('hdr-dctype', el)}
                onKeyDown={focusChain.onEnter('hdr-dctype')}
              />
              <input
                className="form-input dc-billno-ref"
                title="Bill No"
                value={header.bill_no}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, bill_no: e.target.value }))}
                ref={(el) => focusChain.register('hdr-billno', el)}
                onKeyDown={focusChain.onEnter('hdr-billno')}
              />
            </span>
          </label>
        </div>
      </div>

      <div className="dc-note-form__lines-wrap">
        <table className="dc-note-form__grid">
          <thead>
            <tr>
              <th>S.No</th>
              <th>ItemCd</th>
              <th>Item Name</th>
              <th>Cr.Code</th>
              <th>Name</th>
              <th className="dc-num">Qty</th>
              <th className="dc-num">Wgt</th>
              <th>Cal</th>
              <th className="dc-num">Rate</th>
              <th className="dc-num">Amount</th>
              <th className="dc-num">Cgst%</th>
              <th className="dc-num">Sgst%</th>
              <th className="dc-num">Igst%</th>
              <th className="dc-num">CgstAmt</th>
              <th className="dc-num">SgstAmt</th>
              <th className="dc-num">IgstAmt</th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, idx) => (
              <tr key={ln.key}>
                <td className="dc-num">{idx + 1}</td>
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
                <td className="dc-item-name">{ln.item_name}</td>
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
                    value={ln.qnty}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { qnty: e.target.value })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-qty`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-qty`)}
                  />
                </td>
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
                  <select
                    className="form-input"
                    value={ln.amt_cal || 'W'}
                    disabled={!editable}
                    onChange={(e) => updateLine(ln.key, { amt_cal: e.target.value })}
                    ref={(el) => focusChain.register(`ln-${ln.key}-cal`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-cal`)}
                  >
                    <option value="W">W</option>
                    <option value="Q">Q</option>
                  </select>
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
                <td className="dc-num">{ln.amount}</td>
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
                <td className="dc-num">{ln.cgst_amt}</td>
                <td className="dc-num">{ln.sgst_amt}</td>
                <td className="dc-num">{ln.igst_amt}</td>
                {editable ? (
                  <td>
                    <button type="button" className="btn btn-sm" title="Remove line" onClick={() => removeLine(ln.key)}>
                      −
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="dc-note-form__line-actions">
          <button type="button" className="btn btn-sm" onClick={addLine}>
            + Add line
          </button>
        </div>
      ) : null}

      <div className="dc-note-form__footer">
        <div className="dc-note-form__footer-col">
          <div className="dc-note-form__footer-row">
            <label className="dc-grow">
              Detail / Remarks
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
          <div className="dc-note-form__footer-row">
            <label className="dc-grow">
              IRN No
              <input
                className="form-input"
                value={header.irn_no}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, irn_no: e.target.value }))}
                ref={(el) => focusChain.register('ft-irn', el)}
                onKeyDown={focusChain.onEnter('ft-irn')}
              />
            </label>
          </div>
          <div className="dc-note-form__footer-row">
            <label className="dc-grow">
              ACK No
              <input
                className="form-input"
                value={header.ack_no}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, ack_no: e.target.value }))}
                ref={(el) => focusChain.register('ft-ack', el)}
                onKeyDown={focusChain.onEnter('ft-ack')}
              />
            </label>
          </div>
          <div className="dc-note-form__footer-row">
            <label className="dc-grow">
              Qr Code
              <input
                className="form-input"
                value={header.signed_qr_code}
                disabled={!editable}
                onChange={(e) => setHeader((h) => ({ ...h, signed_qr_code: e.target.value }))}
                ref={(el) => focusChain.register('ft-qr', el)}
                onKeyDown={focusChain.onEnter('ft-qr')}
              />
            </label>
          </div>
          <div className="dc-note-form__footer-row">
            <label className="dc-grow">
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
        </div>

        <div className="dc-summary-pane">
          <div className="dc-summary-row dc-summary-row--totals">
            <span className="dc-summary-row__lbl">Total</span>
            <span className="dc-summary-row__amt" title="Qty">
              {fmtQty(totals.tq)}
            </span>
            <span className="dc-summary-row__amt" title="Weight">
              {fmtWgt(totals.tw)}
            </span>
            <span className="dc-summary-row__amt">{fmtAmt(totals.mamt)}</span>
          </div>
          <div className="dc-summary-row dc-summary-row--tax">
            <span className="dc-summary-row__lbl">CGST</span>
            <span className="dc-help-inline">
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
            <span className="dc-summary-row__amt">{fmtAmt(totals.cgst_amt)}</span>
          </div>
          <div className="dc-summary-row dc-summary-row--tax">
            <span className="dc-summary-row__lbl">SGST</span>
            <span className="dc-help-inline">
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
            <span className="dc-summary-row__amt">{fmtAmt(totals.sgst_amt)}</span>
          </div>
          <div className="dc-summary-row dc-summary-row--tax">
            <span className="dc-summary-row__lbl">IGST</span>
            <span className="dc-help-inline">
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
            <span className="dc-summary-row__amt">{fmtAmt(totals.igst_amt)}</span>
          </div>
          <div className="dc-summary-row dc-summary-row--addexp">
            <span className="dc-summary-row__lbl">Add Oth.Exp</span>
            <span className="dc-help-inline">
              <input
                className="form-input"
                value={footer.tax_code}
                disabled={!editable}
                onChange={(e) => onFooter('tax_code', e.target.value.toUpperCase())}
                ref={(el) => focusChain.register('ft-tax_code', el)}
                onKeyDown={(e) => {
                  if (e.key === 'F1' || e.keyCode === 112) {
                    e.preventDefault();
                    helpReturnFocusRef.current = 'ft-tax_code';
                    setHelpField('tax');
                    return;
                  }
                  focusChain.onEnter('ft-tax_code')(e);
                }}
              />
              <button
                type="button"
                className="pb-help-btn"
                tabIndex={-1}
                disabled={!editable}
                title="Other exp A/c help (F1)"
                onClick={() => {
                  if (!editable) return;
                  helpReturnFocusRef.current = 'ft-tax_code';
                  setHelpField('tax');
                }}
              >
                ⌕
              </button>
            </span>
            <input
              className="form-input"
              style={{ textAlign: 'right' }}
              value={footer.addexp}
              disabled={!editable}
              onChange={(e) => onFooter('addexp', e.target.value)}
              ref={(el) => focusChain.register('ft-addexp', el)}
              onKeyDown={focusChain.onEnter('ft-addexp')}
            />
            <span className="dc-summary-row__amt">{fmtAmt(footer.addexp)}</span>
          </div>
          <div className="dc-summary-row dc-summary-row--net">
            <span className="dc-summary-row__lbl">Net Amount</span>
            <span />
            <span className="dc-summary-row__amt">{fmtAmt(totals.mbamt)}</span>
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
                type: noteType,
                oracleDt: toOracleDateFromAny(header.r_date),
                r_date: toOracleDateFromAny(header.r_date),
                rNo: header.r_no,
                r_no: header.r_no,
                label: `${title} — ${noteType} / ${header.r_no} / ${header.r_date || ''}`,
              }
            : null
        }
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        onClose={() => setPrintOpen(false)}
      />

      <DcNoteEinvDirectModal
        open={einvDirectOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        noteType={noteType}
        rDate={header.r_date}
        rNo={header.r_no}
        gstNo={einvGstNo}
        voucherHeader={einvVoucherHeader}
        netAmount={totals.mbamt}
        compYear={compYear}
        onVoucherUpdated={onEinvVoucherUpdated}
        onClose={() => setEinvDirectOpen(false)}
      />

      <DcNoteEinvPrintModal
        open={einvPrintOpen}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        noteType={noteType}
        rDate={toOracleDateFromAny(header.r_date)}
        rNo={header.r_no}
        title={title}
        onClose={() => setEinvPrintOpen(false)}
      />

      <VoucherAccountHelpModal
        open={!!helpField && itemHelpLine == null && purHelpLine == null}
        title="Account help (F1)"
        accounts={accountListForHelp}
        onSelect={(code) => {
          if (helpField === 'party') resolveParty(code);
          else if (helpField === 'cgst') onFooter('cgst_code', code);
          else if (helpField === 'sgst') onFooter('sgst_code', code);
          else if (helpField === 'igst') onFooter('igst_code', code);
          else if (helpField === 'tax') onFooter('tax_code', code);
          setHelpField(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setHelpField(null);
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
        title="Cr.Code help"
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
      <DcNoteBillHelpModal
        open={billHelpOpen}
        rows={billHelpRows}
        loading={billHelpLoading}
        error={billHelpError}
        saleMode={String(header.s_p || 'P').toUpperCase() === 'S'}
        partyCode={header.code}
        onSelect={applyBillHelp}
        onClose={() => {
          setBillHelpOpen(false);
          restoreHelpFocus();
        }}
      />
      <DcNoteListModal
        open={listOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        noteType={noteType}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        onSelect={({ r_no, r_date }) => void loadBill(r_no, r_date)}
        onClose={() => setListOpen(false)}
      />
      <DcNotePostingModal
        open={postingOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        noteType={noteType}
        rDate={header.r_date}
        rNo={header.r_no}
        onClose={() => setPostingOpen(false)}
      />
    </div>
  );
}
