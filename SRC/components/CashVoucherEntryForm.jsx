import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherBillAdjustPrompt from './VoucherBillAdjustPrompt';
import VoucherPendingBillsModal from './VoucherPendingBillsModal';
import ReportExportMenu from './ReportExportMenu';
import { exportVoucherPdf, shareVoucherWhatsApp, printVoucherBrowser } from '../utils/voucherPrint';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  finYearRangeLabel,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import {
  pickBillBType,
  normalizePickedBillRow,
  gridBTypeFromBill,
  pickBillField,
} from '../utils/voucherBillRowFields';
import { getVoucherEntryConfig } from '../data/voucherEntryTypeConfig';

const LOT_HELP_COLUMNS = [
  { key: 'b_no', label: 'B.No', align: 'right' },
  { key: 'item_code', label: 'Item', align: 'right' },
  { key: 'item_name', label: 'INAME' },
  { key: 'lot', label: 'Lot', align: 'right' },
  { key: 'qnty', label: 'Qnty', align: 'right' },
  { key: 'r_date', label: 'Arv.Date' },
  { key: 'remarks', label: 'Remarks' },
];

const LOT_HELP_COLUMNS_TRADER = [
  { key: 'sup_name', label: 'Supplier' },
  { key: 'sup_code', label: 'Sup.Code' },
  { key: 'tdg_name', label: 'Trader' },
  { key: 'tdg_code', label: 'Tdg.Code' },
  { key: 'b_no', label: 'B.No', align: 'right' },
  { key: 'lot_label', label: 'Lot' },
];

const VR_NO_HELP_COLUMNS = [
  { key: 'vr_no', label: 'Vr.No', align: 'right' },
  { key: 'type', label: 'Type' },
  { key: 'dr_amt', label: 'Dr.Amt', align: 'right' },
  { key: 'cr_amt', label: 'Cr.Amt', align: 'right' },
  { key: 'party_codes', label: 'Party' },
  { key: 'detail', label: 'Detail' },
];

function groupCashVouchersForHelp(rawRows) {
  const map = new Map();
  for (const r of rawRows || []) {
    const no = Number(r.VR_NO ?? r.vr_no ?? 0);
    if (!no) continue;
    const key = String(no);
    if (!map.has(key)) {
      map.set(key, {
        _id: key,
        vr_no: no,
        type: String(r.TYPE ?? r.type ?? 'N').trim() || 'N',
        dr_amt: 0,
        cr_amt: 0,
        parties: new Set(),
        detail: '',
      });
    }
    const g = map.get(key);
    g.dr_amt += Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    g.cr_amt += Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    const code = String(r.CODE ?? r.code ?? '').trim();
    if (code) g.parties.add(code);
    if (!g.detail) {
      const d = String(r.DETAIL ?? r.detail ?? '').trim();
      if (d) g.detail = d.slice(0, 50);
    }
  }
  return [...map.values()]
    .map((g) => ({
      _id: g._id,
      vr_no: g.vr_no,
      type: g.type,
      dr_amt: g.dr_amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      cr_amt: g.cr_amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      party_codes: [...g.parties].join(', ').slice(0, 80),
      detail: g.detail,
    }))
    .sort((a, b) => a.vr_no - b.vr_no);
}

function emptyLine(key = 1, defaultVDate = '') {
  return {
    key,
    code: '',
    name: '',
    pan: '',
    schedule: '',
    b_no: '',
    v_date: defaultVDate,
    lot: '',
    chq_no: '',
    detail: '',
    ind_yn: '',
    bill_date: '',
    bill_no: '',
    b_type: '',
    dr_amt: '',
    cr_amt: '',
    int_amt: '',
    cd_amt: '',
    dc_code: '',
    dc_name: '',
    cost_code: '',
    bk_code: '',
  };
}

function parseAmt(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Allow digits and a single decimal while typing. */
function sanitizeAmtTyping(raw) {
  let s = String(raw ?? '').replace(/,/g, '').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) {
    s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, '')}`;
  }
  return s;
}

function formatAmtBlur(raw) {
  const n = parseAmt(raw);
  if (n === 0) return '';
  return n.toFixed(2);
}

function formatAmt(n) {
  return formatAmtBlur(n);
}

function normBType(raw) {
  return pickBillBType({ b_type: raw });
}

/** JV grid: after row idx has code + dc_code, pre-fill next row with swapped codes. */
function applyJvSwapToNextRow(lines, idx, lookupAccount) {
  if (idx < 0 || idx + 1 >= lines.length) return lines;
  const cur = lines[idx];
  const code = String(cur.code ?? '').trim().toUpperCase();
  const dc = String(cur.dc_code ?? '').trim().toUpperCase();
  if (!code || !dc) return lines;
  const dcAcct = lookupAccount(dc);
  const codeAcct = lookupAccount(code);
  return lines.map((ln, i) => {
    if (i !== idx + 1) return ln;
    return {
      ...ln,
      code: dc,
      name: dcAcct.name,
      pan: dcAcct.pan,
      schedule: dcAcct.schedule,
      dc_code: code,
      dc_name: codeAcct.name,
    };
  });
}

function lineFromApi(ln, idx, vrYmd) {
  const defV = vrYmd || '';
  return {
    key: idx + 1,
    code: String(ln.code ?? '').trim(),
    name: String(ln.name ?? '').trim(),
    pan: String(ln.pan ?? '').trim(),
    schedule: String(ln.schedule ?? '').trim(),
    v_date: ln.v_date ? toInputDateString(ln.v_date) || defV : defV,
    lot: String(ln.lot ?? '').trim(),
    chq_no: String(ln.chq_no ?? '').trim(),
    detail: String(ln.detail ?? '').trim(),
    ind_yn: String(ln.ind_yn ?? ln.IND_YN ?? '').trim().toUpperCase().slice(0, 1),
    bill_date: ln.bill_date ? toInputDateString(ln.bill_date) : '',
    bill_no: ln.bill_no ? String(ln.bill_no) : '',
    b_type: normBType(ln.b_type),
    dr_amt: formatAmt(ln.dr_amt),
    cr_amt: formatAmt(ln.cr_amt),
    int_amt: formatAmt(ln.int_amt),
    cd_amt: formatAmt(ln.cd_amt),
    cost_code: String(ln.cost_code ?? ln.COST_CODE ?? '').trim(),
    b_no: ln.b_no ? String(ln.b_no) : '',
    bk_code: String(ln.bk_code ?? '').trim(),
    dc_code: String(ln.dc_code ?? ln.DC_CODE ?? '').trim(),
    dc_name: String(ln.dc_name ?? '').trim(),
  };
}

export default function CashVoucherEntryForm({ apiBase, formData, userName, onBack, onOpenChecklist, vrType = 'CV' }) {
  const cfg = useMemo(() => getVoucherEntryConfig(vrType), [vrType]);
  const VR_TYPE = cfg.vrType;
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;

  const [vrDate, setVrDate] = useState(() => toInputDateString(new Date()));
  const [vrNo, setVrNo] = useState('');
  const [receiptType, setReceiptType] = useState('N');
  const [counterNo, setCounterNo] = useState('');
  const [pan, setPan] = useState('');
  const [cbCode, setCbCode] = useState('');
  const [cbName, setCbName] = useState('');
  const [acBal, setAcBal] = useState(0);
  const [totCash, setTotCash] = useState(0);
  const [jvVrNo, setJvVrNo] = useState('');
  const [jvVrNoInt, setJvVrNoInt] = useState('');
  const [billHelpSettings, setBillHelpSettings] = useState({
    pnd_bills: 0,
    vou_int_show: 'Y',
    pending_zero_yn: 'N',
    cd_less: 'N',
    cd_in_vou: 'N',
    b_code_in_vou: 'N',
    indent_yn: 'N',
    auto_int_trf: 'N',
    int_trf_code: '',
    cd_code: '',
  });
  const showBrokerCol = String(billHelpSettings.b_code_in_vou ?? 'N').toUpperCase() === 'Y';
  const showIndYnCol = String(billHelpSettings.indent_yn ?? 'N').toUpperCase() === 'Y';
  const showDcCodeCol = Boolean(cfg.showDcCodeCol);
  const [saveMode, setSaveMode] = useState('new');
  const [uiLocked, setUiLocked] = useState(false);
  /** False while a loaded voucher is open (view/edit); true again after Save or New. */
  const [newEnabled, setNewEnabled] = useState(true);
  const [lines, setLines] = useState(() => [emptyLine(1), emptyLine(2)]);
  const [accounts, setAccounts] = useState([]);
  const [costCentres, setCostCentres] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [gridHelp, setGridHelp] = useState(null);
  const [activeLine, setActiveLine] = useState(0);
  const [billAdjustOpen, setBillAdjustOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingInitialMode, setPendingInitialMode] = useState('manual');
  const [billTargetLineKey, setBillTargetLineKey] = useState(null);
  const [accountHelp, setAccountHelp] = useState(null);
  const lineKeyRef = useRef(3);
  const vrDateRef = useRef(null);
  const entryFocusDoneRef = useRef(false);
  const vrNoUserSetRef = useRef(false);
  const fetchNoGenRef = useRef(0);
  const lastVrLookupRef = useRef('');
  const voucherAutoLoadAtRef = useRef(null);
  const voucherInflightRef = useRef(null);
  const billApplyLineKeyRef = useRef(null);
  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const { fyMinYmd, fyMaxYmd } = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const fyRangeLabel = useMemo(() => finYearRangeLabel(fyMinYmd, fyMaxYmd), [fyMinYmd, fyMaxYmd]);

  const readOnly = uiLocked || busy;

  const cbAccountOptions = useMemo(() => {
    if (!cfg.scheduleFilter) return accounts;
    const filtered = (accounts || []).filter((a) => {
      const sch = Number(a.SCHEDULE ?? a.schedule) || 0;
      return Math.round(sch * 100) === cfg.scheduleFilter;
    });
    return filtered.length ? filtered : accounts;
  }, [accounts, cfg.scheduleFilter]);

  const costHelpOptions = useMemo(
    () =>
      (costCentres || []).map((c) => ({
        CODE: String(c.COST_CODE ?? c.cost_code ?? '').trim(),
        NAME: String(c.COST_NAME ?? c.cost_name ?? '').trim(),
      })),
    [costCentres]
  );

  const activeParty = useMemo(() => {
    const ln = lines[activeLine];
    if (!ln) return null;
    return {
      code: ln.code,
      name: ln.name,
      schedule: ln.schedule,
      ind_yn: ln.ind_yn,
      v_date: ln.v_date || vrDate,
    };
  }, [activeLine, lines, vrDate]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const ln of lines) {
      dr += parseAmt(ln.dr_amt);
      cr += parseAmt(ln.cr_amt);
    }
    const hasAmount = dr > 0 || cr > 0;
    let balanced;
    if (cfg.balanceMode === 'balanced') {
      balanced = hasAmount && Math.abs(dr - cr) < 0.01;
    } else {
      balanced =
        hasAmount && (Math.abs(dr - cr) < 0.01 || (dr > 0 && cr === 0) || (cr > 0 && dr === 0));
    }
    return { dr, cr, hasAmount, balanced };
  }, [lines, cfg.balanceMode]);

  const focusOrder = useMemo(() => {
    const keys = ['hdr-date', 'hdr-receipt'];
    // VFP: N → Vr.No; R (receipt) → Counter No. first
    if (String(receiptType).trim().toUpperCase() === 'R') {
      keys.push('hdr-counter', 'hdr-vrno');
    } else {
      keys.push('hdr-vrno', 'hdr-counter');
    }
    if (!cfg.hideCbHeader) keys.push('hdr-cash');
    lines.forEach((ln) => {
      const p = `ln-${ln.key}`;
      keys.push(
        `${p}-code`,
        ...(showDcCodeCol ? [`${p}-dccode`] : []),
        `${p}-vdate`,
        `${p}-lot`,
        `${p}-chq`,
        `${p}-detail`,
        ...(showIndYnCol ? [`${p}-indyn`] : []),
        `${p}-billdt`,
        `${p}-billno`,
        `${p}-btype`,
        `${p}-dr`,
        `${p}-cr`,
        `${p}-int`,
        `${p}-cd`,
        `${p}-cost`,
        ...(showBrokerCol ? [`${p}-broker`] : [])
      );
    });
    return keys;
  }, [lines, receiptType, showBrokerCol, showIndYnCol, showDcCodeCol, cfg.hideCbHeader]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  const bindFocus = (key) => ({
    ref: (el) => focusChain.register(key, el),
    onKeyDown: (e) => handleFieldKeyDown(key, e),
  });

  const focusField = useCallback(
    (key, attempt = 0) => {
      const tryFocus = () => {
        if (focusChain.focusKey(key)) return;
        if (attempt < 10) {
          window.setTimeout(() => focusField(key, attempt + 1), 35);
        }
      };
      window.requestAnimationFrame(() => {
        window.setTimeout(tryFocus, 0);
      });
    },
    [focusChain]
  );

  const focusVrDate = useCallback(() => {
    window.setTimeout(() => {
      focusField('hdr-date');
    }, 80);
  }, [focusField]);

  const firstLineCodeKey = useMemo(
    () => (lines.length ? `ln-${lines[0].key}-code` : 'ln-1-code'),
    [lines]
  );

  const fetchDefaultCb = useCallback(async () => {
    if (!compCode || !cfg.defaultEndpoint) return null;
    try {
      const res = await axios.get(`${apiBase}/api/voucher-entry/${cfg.defaultEndpoint}`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
        timeout: 15000,
      });
      const code = String(res.data?.code ?? '').trim();
      const name = String(res.data?.name ?? '').trim();
      if (code) {
        setCbCode(code);
        setCbName(name);
      }
      return res.data;
    } catch {
      return null;
    }
  }, [apiBase, compCode, compUid, cfg.defaultEndpoint]);

  const fetchCostCentres = useCallback(async () => {
    if (!compCode) return [];
    try {
      const res = await axios.get(`${apiBase}/api/voucher-entry/cost-help`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
        timeout: 30000,
      });
      const rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
      setCostCentres(rows);
      return rows;
    } catch (err) {
      setStatus(`Could not load cost centres: ${err.response?.data?.error || err.message}`);
      return [];
    }
  }, [apiBase, compCode, compUid]);

  const openCostHelp = useCallback(
    async (lineKey) => {
      if (!costCentres.length) {
        await fetchCostCentres();
      }
      setAccountHelp({ kind: 'cost', lineKey });
    },
    [costCentres.length, fetchCostCentres]
  );

  const handleFieldKeyDown = (fieldKey, e, helpCtx) => {
    if (e.key === 'F1' || e.keyCode === 112) {
      e.preventDefault();
      if (helpCtx?.type === 'vrno') {
        void openVrNoHelp();
        return;
      }
      if (helpCtx?.type === 'lot') {
        void openLotHelp(helpCtx.lineKey);
        return;
      }
      if (helpCtx?.type === 'bill') {
        openBillHelpForLine(helpCtx.lineKey);
        return;
      }
      if (helpCtx?.type === 'cost') {
        void openCostHelp(helpCtx.lineKey);
        return;
      }
    }
    focusChain.onEnter(fieldKey)(e);
  };

  const openVrNoHelp = async () => {
    const active = document.activeElement;
    if (active && vrDateRef.current && active === vrDateRef.current) {
      active.blur();
      await new Promise((r) => window.setTimeout(r, 0));
    }
    const oracleDt = toOracleDate(vrDate);
    if (!oracleDt) {
      setStatus('Enter full voucher date (dd/mm/yyyy) before browsing vouchers.');
      return;
    }
    const dateLabel = toDisplayDate(vrDate) || oracleDt;
    setGridHelp({
      type: 'vrno',
      title: `${cfg.voucherKindLabel.replace(/^./, (c) => c.toUpperCase())}s — ${dateLabel}`,
      hint: `Vr.Date ${dateLabel} · Enter or double-click to load · Esc close`,
      columns: VR_NO_HELP_COLUMNS,
      rows: [],
      loading: true,
      error: '',
    });
    try {
      const res = await axios.get(`${apiBase}/api/voucher-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: VR_TYPE,
          s_date: oracleDt,
          e_date: oracleDt,
        },
        withCredentials: true,
        timeout: 30000,
      });
      const rows = groupCashVouchersForHelp(Array.isArray(res.data) ? res.data : []);
      setGridHelp((prev) =>
        prev?.type === 'vrno'
          ? {
              ...prev,
              loading: false,
              rows,
            }
          : prev
      );
    } catch (err) {
      setGridHelp((prev) =>
        prev?.type === 'vrno'
          ? {
              ...prev,
              loading: false,
              error: err.response?.data?.error || err.message,
            }
          : prev
      );
    }
  };

  const openLotHelp = async (lineKey) => {
    const ln = lines.find((l) => l.key === lineKey);
    if (!ln?.code?.trim()) {
      setStatus('Enter party code before lot help (F1).');
      return;
    }
    setGridHelp({
      type: 'lot',
      lineKey,
      lotStyle: null,
      title: 'Lot help — LOTSTOCK',
      hint: `Party ${ln.code} · pick row — B.No → grid · Esc close`,
      columns: LOT_HELP_COLUMNS,
      rows: [],
      loading: true,
      error: '',
    });
    try {
      const res = await axios.get(`${apiBase}/api/voucher-entry/lot-help`, {
        params: { comp_code: compCode, comp_uid: compUid, party_code: ln.code.trim() },
        withCredentials: true,
        timeout: 30000,
      });
      const style = res.data?.style === 'trader' ? 'trader' : 'supplier';
      const cols = style === 'trader' ? LOT_HELP_COLUMNS_TRADER : LOT_HELP_COLUMNS;
      setGridHelp((prev) =>
        prev
          ? {
              ...prev,
              lotStyle: style,
              columns: cols,
              loading: false,
              rows: Array.isArray(res.data?.rows) ? res.data.rows : [],
            }
          : prev
      );
    } catch (err) {
      setGridHelp((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err.response?.data?.error || err.message,
            }
          : prev
      );
    }
  };

  const applyLotPick = (lineKey, row, lotStyle = 'supplier') => {
    const bNo = String(row.b_no ?? row.B_NO ?? '').trim();
    if (lotStyle === 'supplier') {
      setLine(lineKey, {
        b_no: bNo,
        lot: String(row.lot ?? row.LOT ?? '').trim(),
      });
    } else {
      setLine(lineKey, { b_no: bNo });
    }
    setGridHelp(null);
    focusField(`ln-${lineKey}-lot`);
  };

  const onBillAdjustChoice = (mode) => {
    setBillAdjustOpen(false);
    setPendingInitialMode(mode);
    setPendingOpen(true);
  };

  const resolveSchedule = (line) => {
    const code = String(line?.code ?? '').trim();
    const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
    return Number(hit?.SCHEDULE ?? hit?.schedule ?? line?.schedule) || 0;
  };

  const scheduleForLine = (line) => {
    const code = String(line?.code ?? '').trim();
    const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
    return hit ? String(hit.SCHEDULE ?? hit.schedule ?? '') : String(line?.schedule ?? '');
  };

  const openBillHelpForLine = useCallback(
    (lineKey) => {
      const idx = lines.findIndex((l) => l.key === lineKey);
      const ln = idx >= 0 ? lines[idx] : null;
      if (!ln?.code?.trim()) {
        setStatus('Enter party code before bill help (F1).');
        return;
      }
      if (!toOracleDate(vrDate)) {
        setStatus('Voucher date is required for bill help.');
        return;
      }
      setActiveLine(idx);
      billApplyLineKeyRef.current = ln.key;
      setBillTargetLineKey(ln.key);
      setBillAdjustOpen(true);
    },
    [lines, vrDate]
  );

  const resolveIndYn = (line) => String(line?.ind_yn ?? '').trim().toUpperCase();

  useEffect(() => {
    if (!pendingOpen) return;
    const ln = lines[activeLine];
    if (ln?.key != null) {
      billApplyLineKeyRef.current = ln.key;
      setBillTargetLineKey(ln.key);
    }
  }, [pendingOpen, activeLine, lines]);

  const applyPendingBills = (picked, lineKey) => {
    if (!picked.length) return;
    const targetKey = lineKey ?? billTargetLineKey ?? billApplyLineKeyRef.current;

    const billLine = (b, line) => {
      const bill = normalizePickedBillRow(b);
      const schInt = Math.floor(resolveSchedule(line));
      const indYn = resolveIndYn(line);
      const isCust8 = schInt === 8 && indYn !== 'F';
      const adj = parseAmt(bill.ADJ_AMT ?? bill.adj_amt);
      const billDate = toInputDateString(bill.BILL_DATE ?? bill.bill_date) || line.bill_date;
      const billNo = String(bill.BILL_NO ?? bill.bill_no ?? '');
      const bType = gridBTypeFromBill(bill);
      const bkCode = pickBillField(bill, 'BK_CODE');

      let dr_amt = '';
      let cr_amt = '';
      if (isCust8) {
        if (adj < 0) dr_amt = formatAmt(Math.abs(adj));
        else cr_amt = formatAmt(adj);
      } else if (adj < 0 && indYn !== 'F') {
        cr_amt = formatAmt(Math.abs(adj));
      } else {
        dr_amt = formatAmt(adj);
      }

      return {
        code: line.code,
        name: line.name,
        schedule: scheduleForLine(line),
        v_date: line.v_date || vrDate,
        chq_no: line.chq_no,
        dr_amt,
        cr_amt,
        int_amt: formatAmt(bill.INT_AMT ?? bill.int_amt),
        bill_date: billDate,
        bill_no: billNo,
        b_type: isCust8 || indYn === 'F' ? bType : '',
        detail: line.detail || `Bill ${billNo}`.slice(0, 150),
        cd_amt: formatAmt(bill.CD_AMT ?? bill.cd_amt),
        bk_code: bkCode.toUpperCase(),
      };
    };

    setLines((prev) => {
      let idx = targetKey != null ? prev.findIndex((l) => l.key === targetKey) : -1;
      if (idx < 0 && activeLine >= 0 && activeLine < prev.length) idx = activeLine;
      const line = idx >= 0 ? prev[idx] : null;
      if (!line) return prev;
      const patch = billLine(normalizePickedBillRow(picked[0]), line);
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      if (picked.length > 1) {
        const extras = picked.slice(1).map((b) => {
          lineKeyRef.current += 1;
          const blank = emptyLine(lineKeyRef.current, vrDate);
          return {
            ...blank,
            code: line.code,
            name: line.name,
            schedule: scheduleForLine(line),
            ...billLine(normalizePickedBillRow(b), line),
          };
        });
        next.splice(idx + 1, 0, ...extras);
      }
      billApplyLineKeyRef.current = next[idx + picked.length - 1]?.key ?? line.key;
      const newActiveIdx = idx + picked.length - 1;
      const appliedKey = next[newActiveIdx]?.key ?? line.key;
      const appliedLine = next[newActiveIdx] ?? line;
      const hasInt = parseAmt(appliedLine.int_amt) > 0;
      window.setTimeout(() => {
        setActiveLine(newActiveIdx);
        if (hasInt) focusField(`ln-${appliedKey}-int`);
        else focusField(`ln-${appliedKey}-cd`);
      }, 60);
      return next;
    });
  };

  const fetchAccounts = useCallback(async () => {
    if (!compCode) return;
    try {
      const res = await axios.get(`${apiBase}/api/master-accounts`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
        timeout: 20000,
      });
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (!formData?.voucherEdit?.autoLoad) {
        setStatus(`Could not load accounts: ${err.response?.data?.error || err.message}`);
      }
    }
  }, [apiBase, compCode, compUid, formData?.voucherEdit?.autoLoad]);

  const fetchCashContext = useCallback(async () => {
    const oracleDt = toOracleDate(vrDate);
    if (!compCode || !oracleDt) return;
    try {
      const res = await axios.get(`${apiBase}/api/voucher-entry/cash-context`, {
        params: { comp_code: compCode, comp_uid: compUid, vr_date: oracleDt, cb_code: cbCode, vr_type: VR_TYPE },
        withCredentials: true,
        timeout: 15000,
      });
      setAcBal(Number(res.data?.ac_bal ?? 0) || 0);
      setTotCash(Number(res.data?.tot_cash ?? 0) || 0);
      setBillHelpSettings({
        pnd_bills: Number(res.data?.pnd_bills ?? 0) || 0,
        vou_int_show: String(res.data?.vou_int_show ?? 'Y').trim().toUpperCase() || 'Y',
        pending_zero_yn: String(res.data?.pending_zero_yn ?? 'N').trim().toUpperCase() || 'N',
        cd_less: String(res.data?.cd_less ?? 'N').trim().toUpperCase() || 'N',
        cd_in_vou: String(res.data?.cd_in_vou ?? 'N').trim().toUpperCase() || 'N',
        b_code_in_vou: String(res.data?.b_code_in_vou ?? 'N').trim().toUpperCase() || 'N',
        indent_yn: String(res.data?.indent_yn ?? 'N').trim().toUpperCase() || 'N',
        auto_int_trf: String(res.data?.auto_int_trf ?? 'N').trim().toUpperCase() || 'N',
        int_trf_code: String(res.data?.int_trf_code ?? '').trim(),
        cd_code: String(res.data?.cd_code ?? '').trim(),
      });
    } catch {
      /* optional */
    }
  }, [apiBase, cbCode, compCode, compUid, vrDate, VR_TYPE]);

  const fetchNextNo = useCallback(
    async (dateYmd = vrDate) => {
      const oracleDt = toOracleDate(dateYmd);
      if (!oracleDt || !compCode) return null;
      const gen = ++fetchNoGenRef.current;
      try {
        const res = await axios.get(`${apiBase}/api/voucher-entry/next-no`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            vr_type: VR_TYPE,
            vr_date: oracleDt,
          },
          withCredentials: true,
          timeout: 8000,
        });
        if (gen !== fetchNoGenRef.current) return null;
        if (saveMode === 'new' && !vrNoUserSetRef.current) {
          setVrNo(String(res.data?.vr_no ?? ''));
        }
        return res.data;
      } catch (err) {
        if (gen === fetchNoGenRef.current) {
          setStatus(err.response?.data?.error || err.message);
        }
        return null;
      }
    },
    [apiBase, compCode, compUid, saveMode, vrDate]
  );

  const handleVrDateCommitted = useCallback(
    (ymd) => {
      const next = ymd || '';
      const prev = vrDate;
      setVrDate(next);
      if (saveMode !== 'new' || !next) return;
      if (next !== prev) {
        vrNoUserSetRef.current = false;
        lastVrLookupRef.current = '';
      }
      setLines((prevLines) =>
        prevLines.map((ln) => {
          const empty =
            !String(ln.code ?? '').trim() &&
            !parseAmt(ln.dr_amt) &&
            !parseAmt(ln.cr_amt) &&
            !String(ln.detail ?? '').trim();
          return empty ? { ...ln, v_date: next } : ln;
        })
      );
    },
    [saveMode, vrDate]
  );

  /** VFP voucher.scx: max(vr_no) after Receipt type; N → Vr.No, R → Counter No. */
  const advanceFromReceiptType = useCallback(
    async (typeRaw) => {
      const typeCh =
        String(typeRaw ?? receiptType ?? 'N')
          .trim()
          .toUpperCase()
          .slice(0, 1) || 'N';
      const target = typeCh === 'R' ? 'hdr-counter' : 'hdr-vrno';
      focusField(target);
      if (saveMode === 'new' && !vrNoUserSetRef.current && toOracleDate(vrDate)) {
        await fetchNextNo(vrDate);
      }
      focusField(target);
    },
    [fetchNextNo, focusField, receiptType, saveMode, vrDate]
  );

  const handleReceiptTypeEnter = useCallback(
    (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      void advanceFromReceiptType(e.target?.value);
    },
    [advanceFromReceiptType]
  );

  const resetNew = useCallback(async () => {
    setSaveMode('new');
    setUiLocked(false);
    setNewEnabled(true);
    setStatus('');
    setReceiptType('N');
    setCounterNo('');
    setPan('');
    lineKeyRef.current = 3;
    setLines([emptyLine(1, vrDate), emptyLine(2, vrDate)]);
    setActiveLine(0);
    entryFocusDoneRef.current = false;
    vrNoUserSetRef.current = false;
    fetchNoGenRef.current += 1;
    lastVrLookupRef.current = '';
    setVrNo('');
    setJvVrNo('');
    setJvVrNoInt('');
    await fetchDefaultCb();
    focusVrDate();
  }, [fetchDefaultCb, focusVrDate, vrDate]);

  /** VFP Refresh — clear loaded voucher, enable New, ready for next entry. */
  const handleRefresh = useCallback(async () => {
    await resetNew();
    setStatus('Ready for new voucher.');
  }, [resetNew]);

  const applyLoaded = useCallback((data) => {
    const h = data?.header || {};
    const ymd = toInputDateString(h.vr_date);
    if (ymd) setVrDate(ymd);
    setVrNo(String(h.vr_no ?? ''));
    vrNoUserSetRef.current = true;
    fetchNoGenRef.current += 1;
    const od = toOracleDate(ymd || vrDate);
    if (od && h.vr_no != null) {
      lastVrLookupRef.current = `${od}|${String(h.vr_no).trim()}`;
    }
    setReceiptType(String(h.type ?? 'N').trim() || 'N');
    setCounterNo(h.r_c_no ? String(h.r_c_no) : '');
    setCbCode(String(h.cb_code ?? '').trim());
    setCbName(String(h.cb_name ?? '').trim());
    setAcBal(Number(h.ac_bal ?? 0) || 0);
    setTotCash(Number(h.tot_cash ?? 0) || 0);
    const jvCd = Number(h.jv_vr_no ?? 0) || 0;
    const jvInt = Number(h.jv_vr_no_int ?? 0) || 0;
    setJvVrNo(jvCd > 0 ? String(jvCd) : '');
    setJvVrNoInt(jvInt > 0 ? String(jvInt) : '');
    setSaveMode('edit');
    setUiLocked(true);
    setNewEnabled(false);
    const cb = String(h.cb_code ?? '').trim();
    const loaded = (data?.lines || [])
      .filter((ln) => (cfg.hideCbHeader ? true : String(ln.code ?? '').trim() !== cb))
      .map((ln, idx) => lineFromApi(ln, idx, ymd));
    lineKeyRef.current = loaded.length + 1;
    setLines(loaded.length ? loaded : [emptyLine(1, ymd)]);
    setPan(loaded[0]?.pan || '');
    setStatus(`Loaded voucher ${h.vr_no} — click Edit to modify or Delete to remove.`);
  }, [cfg.hideCbHeader]);

  const tryLoadExistingVoucher = useCallback(
    async (noRaw, { quiet = false, focusCashIfNew = false } = {}) => {
      const no = String(noRaw ?? '').trim();
      const oracleDt = toOracleDate(vrDate);
      if (!no || !oracleDt) {
        if (!quiet) setStatus('Enter voucher date and Vr. No.');
        return false;
      }
      const lookupKey = `${oracleDt}|${no}`;
      if (lookupKey === lastVrLookupRef.current) {
        if (focusCashIfNew && saveMode !== 'edit' && !cfg.hideCbHeader) focusField('hdr-cash');
        return saveMode === 'edit';
      }

      setBusy(true);
      setStatus('');
      try {
        const res = await axios.get(`${apiBase}/api/voucher-entry`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            vr_type: VR_TYPE,
            vr_date: oracleDt,
            vr_no: no,
            quick: '1',
          },
          withCredentials: true,
          timeout: 20000,
        });
        lastVrLookupRef.current = lookupKey;
        applyLoaded(res.data);
        return true;
      } catch (err) {
        lastVrLookupRef.current = lookupKey;
        if (err.response?.status === 404) {
          if (!quiet) {
            setStatus(`No saved voucher ${no} on ${toDisplayDate(vrDate) || oracleDt}.`);
          }
          if (focusCashIfNew && !cfg.hideCbHeader) focusField('hdr-cash');
          else if (focusCashIfNew) focusField(firstLineCodeKey);
          return false;
        }
        setStatus(err.response?.data?.error || err.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiBase, applyLoaded, compCode, compUid, focusField, saveMode, vrDate]
  );

  const loadVoucherByNo = useCallback(
    async (noRaw) => {
      await tryLoadExistingVoucher(noRaw, { quiet: false });
    },
    [tryLoadExistingVoucher]
  );

  const loadVoucher = useCallback(async () => {
    await loadVoucherByNo(vrNo);
  }, [loadVoucherByNo, vrNo]);

  const handleVrNoChange = useCallback((e) => {
    vrNoUserSetRef.current = true;
    lastVrLookupRef.current = '';
    setVrNo(e.target.value.replace(/\D/g, ''));
  }, []);

  const handleVrNoBlur = useCallback(() => {
    const no = String(vrNo ?? '').trim();
    if (!no) return;
    void tryLoadExistingVoucher(no, { quiet: true });
  }, [tryLoadExistingVoucher, vrNo]);

  const handleVrNoKeyDown = useCallback(
    (e) => {
      if (e.key === 'F1' || e.keyCode === 112) {
        e.preventDefault();
        void openVrNoHelp();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        void tryLoadExistingVoucher(vrNo, { quiet: true, focusCashIfNew: true });
        return;
      }
      focusChain.onEnter('hdr-vrno')(e);
    },
    [focusChain, openVrNoHelp, tryLoadExistingVoucher, vrNo]
  );

  /** When Vr.Date changes, re-check Vr.No for an existing voucher on that date. */
  useEffect(() => {
    if (formData?.voucherEdit?.autoLoad) return undefined;
    const no = String(vrNo ?? '').trim();
    if (!no || !toOracleDate(vrDate)) return undefined;
    const t = window.setTimeout(() => {
      void tryLoadExistingVoucher(no, { quiet: true });
    }, 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on date change
  }, [vrDate, formData?.voucherEdit?.autoLoad]);

  useEffect(() => {
    void fetchAccounts();
    if (!formData?.voucherEdit?.autoLoad) {
      void fetchDefaultCb();
    }
  }, [fetchAccounts, fetchDefaultCb, formData?.voucherEdit?.autoLoad]);

  useEffect(() => {
    if (formData?.voucherEdit?.autoLoad) return;
    const { fyMinYmd, fyMaxYmd } = resolveSaleEntryFinYear(formData);
    if (!fyMinYmd && !fyMaxYmd) return;
    const def = defaultDocDateInFinYear(fyMinYmd, fyMaxYmd);
    if (!def) return;
    setVrDate((prev) => prev || def);
    setLines((prev) => {
      if (prev.some((ln) => String(ln.code ?? '').trim() || parseAmt(ln.dr_amt) || parseAmt(ln.cr_amt))) {
        return prev;
      }
      return [emptyLine(1, def), emptyLine(2, def)];
    });
  }, [formData]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchCashContext();
    }, 350);
    return () => window.clearTimeout(t);
  }, [fetchCashContext]);

  /** Cursor on Vr. Date once when opening cash voucher entry (do not steal focus later). */
  useEffect(() => {
    if (formData?.voucherEdit?.autoLoad) return undefined;
    if (entryFocusDoneRef.current) return undefined;
    const t = window.setTimeout(() => {
      focusVrDate();
      entryFocusDoneRef.current = true;
    }, 150);
    return () => window.clearTimeout(t);
  }, [focusVrDate, formData?.voucherEdit?.autoLoad]);

  useEffect(() => {
    const edit = formData?.voucherEdit;
    if (!edit?.autoLoad || edit.vr_type !== VR_TYPE) return undefined;

    const token = edit.at ?? `${edit.vr_type}|${edit.vr_date}|${edit.vr_no}`;
    if (voucherAutoLoadAtRef.current === token) return undefined;

    const ymd = edit.vr_date ? toInputDateString(edit.vr_date) : '';
    const no = edit.vr_no != null ? String(edit.vr_no) : '';
    const oracleDt = toOracleDate(ymd);
    if (!no || !oracleDt || !compCode) return undefined;

    if (voucherInflightRef.current === token) return undefined;
    voucherInflightRef.current = token;

    if (ymd) setVrDate(ymd);
    setVrNo(no);
    const cbPrefill = String(edit.cb_code ?? '').trim();
    if (cbPrefill) {
      setCbCode(cbPrefill);
    }

    let cancelled = false;
    (async () => {
      setBusy(true);
      setStatus('Loading voucher…');
      try {
        const res = await axios.get(`${apiBase}/api/voucher-entry`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            vr_type: VR_TYPE,
            vr_date: oracleDt,
            vr_no: no,
            quick: '1',
          },
          withCredentials: true,
          timeout: 20000,
        });
        if (cancelled) return;
        voucherAutoLoadAtRef.current = token;
        applyLoaded(res.data);
      } catch (err) {
        if (!cancelled) setStatus(err.response?.data?.error || err.message || 'Could not load voucher.');
      } finally {
        if (voucherInflightRef.current === token) voucherInflightRef.current = null;
        setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      if (voucherInflightRef.current === token) voucherInflightRef.current = null;
    };
  }, [
    formData?.voucherEdit?.at,
    formData?.voucherEdit?.autoLoad,
    formData?.voucherEdit?.vr_type,
    formData?.voucherEdit?.vr_date,
    formData?.voucherEdit?.vr_no,
    formData?.voucherEdit?.cb_code,
    apiBase,
    compCode,
    compUid,
    applyLoaded,
    VR_TYPE,
  ]);

  const setLine = (key, patch) => {
    setLines((prev) => prev.map((ln) => (ln.key === key ? { ...ln, ...patch } : ln)));
  };

  const lookupAccount = useCallback(
    (code) => {
      const c = String(code ?? '').trim().toUpperCase();
      const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
      return {
        code: c,
        name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
        pan: hit ? String(hit.PAN ?? hit.pan ?? '').trim() : '',
        schedule: hit ? String(hit.SCHEDULE ?? hit.schedule ?? '') : '',
      };
    },
    [accounts]
  );

  const pickParty = (lineKey, code) => {
    const acct = lookupAccount(code);
    setLines((prev) => {
      const idx = prev.findIndex((ln) => ln.key === lineKey);
      if (idx < 0) return prev;
      let next = prev.map((ln, i) =>
        i === idx
          ? { ...ln, code: acct.code, name: acct.name, pan: acct.pan, schedule: acct.schedule }
          : ln
      );
      if (showDcCodeCol) next = applyJvSwapToNextRow(next, idx, lookupAccount);
      return next;
    });
    if (acct.pan) setPan(acct.pan);
  };

  const pickDcCode = (lineKey, code) => {
    const acct = lookupAccount(code);
    setLines((prev) => {
      const idx = prev.findIndex((ln) => ln.key === lineKey);
      if (idx < 0) return prev;
      let next = prev.map((ln, i) =>
        i === idx ? { ...ln, dc_code: acct.code, dc_name: acct.name } : ln
      );
      if (showDcCodeCol) next = applyJvSwapToNextRow(next, idx, lookupAccount);
      return next;
    });
  };

  const onCashPick = (code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const hit = cbAccountOptions.find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
    setCbCode(c);
    setCbName(hit ? String(hit.NAME ?? hit.name ?? '').trim() : '');
  };

  const onCashBlur = (raw) => {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code) {
      setCbCode('');
      setCbName('');
      return;
    }
    onCashPick(code);
  };

  const onPartyBlur = (lineKey, raw) => {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code) {
      setLine(lineKey, { code: '', name: '', pan: '', schedule: '' });
      return;
    }
    pickParty(lineKey, code);
  };

  const onDcBlur = (lineKey, raw) => {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code) {
      setLine(lineKey, { dc_code: '', dc_name: '' });
      return;
    }
    pickDcCode(lineKey, code);
  };

  const applyAccountHelp = (code) => {
    if (!accountHelp) return;
    if (accountHelp.kind === 'cash') {
      onCashPick(code);
      setAccountHelp(null);
      focusField(firstLineCodeKey);
      return;
    }
    if (accountHelp.kind === 'party') {
      const lineKey = accountHelp.lineKey;
      pickParty(lineKey, code);
      setAccountHelp(null);
      focusField(showDcCodeCol ? `ln-${lineKey}-dccode` : `ln-${lineKey}-vdate`);
      return;
    }
    if (accountHelp.kind === 'dc') {
      const lineKey = accountHelp.lineKey;
      pickDcCode(lineKey, code);
      setAccountHelp(null);
      focusField(`ln-${lineKey}-vdate`);
      return;
    }
    if (accountHelp.kind === 'cost') {
      setLine(accountHelp.lineKey, { cost_code: String(code ?? '').trim().toUpperCase() });
      setAccountHelp(null);
      focusField(`ln-${accountHelp.lineKey}-broker`);
    }
  };

  const acctLabel = (a) => `${a.CODE ?? a.code ?? ''} — ${a.NAME ?? a.name ?? ''}`.trim();

  const addLine = () => {
    const k = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(k, vrDate)]);
  };

  const onDrChange = (key, raw) => {
    const val = sanitizeAmtTyping(raw);
    const dr = parseAmt(val);
    setLines((prev) =>
      prev.map((ln) =>
        ln.key === key ? { ...ln, dr_amt: val, cr_amt: dr > 0 ? '' : ln.cr_amt } : ln
      )
    );
  };

  const onCrChange = (key, raw) => {
    const val = sanitizeAmtTyping(raw);
    const cr = parseAmt(val);
    setLines((prev) =>
      prev.map((ln) =>
        ln.key === key ? { ...ln, cr_amt: val, dr_amt: cr > 0 ? '' : ln.dr_amt } : ln
      )
    );
  };

  const onAmtBlur = (key, field, raw, mirrorField) => {
    const formatted = formatAmtBlur(raw);
    const n = parseAmt(formatted);
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        const patch = { [field]: formatted };
        if (mirrorField && n > 0) patch[mirrorField] = '';
        return { ...ln, ...patch };
      })
    );
  };

  const amtInputProps = (focusKey, ln, field, onChange, mirrorField = null) => ({
    type: 'text',
    inputMode: 'decimal',
    className: 'form-input voucher-entry-form__cell voucher-entry-form__amt',
    value: ln[field],
    disabled: readOnly,
    autoComplete: 'off',
    ...bindFocus(focusKey),
    onFocus: (e) => {
      window.requestAnimationFrame(() => {
        try {
          e.target.select();
        } catch (_) {}
      });
    },
    onMouseDown: (e) => {
      if (document.activeElement !== e.currentTarget) {
        e.preventDefault();
        e.currentTarget.focus();
        window.requestAnimationFrame(() => {
          try {
            e.currentTarget.select();
          } catch (_) {}
        });
      }
    },
    onChange: (e) => onChange(ln.key, e.target.value),
    onBlur: (e) => onAmtBlur(ln.key, field, e.target.value, mirrorField),
  });

  const validateFinYearDates = () => {
    const hdrErr = finYearDateErrorMessage(vrDate, fyMinYmd, fyMaxYmd, 'Voucher date');
    if (hdrErr) return hdrErr;
    for (let i = 0; i < lines.length; i += 1) {
      const ln = lines[i];
      const vdt = ln.v_date || vrDate;
      if (!vdt) continue;
      const hasAmt = parseAmt(ln.dr_amt) !== 0 || parseAmt(ln.cr_amt) !== 0;
      if (!ln.code?.trim() && !hasAmt) continue;
      const lineErr = finYearDateErrorMessage(vdt, fyMinYmd, fyMaxYmd, `Line ${i + 1} value date`);
      if (lineErr) return lineErr;
    }
    return '';
  };

  const buildPayloadLines = () =>
    lines
      .map((ln) => ({
        code: String(ln.code ?? '').trim(),
        detail: String(ln.detail ?? '').trim(),
        ind_yn: resolveIndYn(ln) || ' ',
        v_date: ln.v_date ? toOracleDate(ln.v_date) : toOracleDate(vrDate),
        lot: String(ln.lot ?? '').trim(),
        b_no: Number(ln.b_no) || 0,
        chq_no: String(ln.chq_no ?? '').trim(),
        bill_date: ln.bill_date ? toOracleDate(toInputDateString(ln.bill_date)) : '',
        bill_no: Number(ln.bill_no) || 0,
        b_type: String(ln.b_type ?? '').trim() || ' ',
        dr_amt: parseAmt(ln.dr_amt),
        cr_amt: parseAmt(ln.cr_amt),
        int_amt: parseAmt(ln.int_amt),
        cd_amt: parseAmt(ln.cd_amt),
        cost_code: String(ln.cost_code ?? '').trim(),
        bk_code: String(ln.bk_code ?? '').trim(),
        dc_code: String(ln.dc_code ?? '').trim(),
      }))
      .filter((ln) => ln.code && (ln.dr_amt !== 0 || ln.cr_amt !== 0));

  const handleSave = async () => {
    if (readOnly) {
      setStatus('Click Edit before saving changes.');
      return;
    }
    const oracleDt = toOracleDate(vrDate);
    if (!oracleDt) {
      setStatus('Voucher date is required.');
      return;
    }
    const fyErr = validateFinYearDates();
    if (fyErr) {
      setStatus(fyErr);
      window.alert(fyErr);
      return;
    }
    if (cfg.requiresCbAccount && !cbCode.trim()) {
      const msg = `Select ${cfg.cbLabel || 'account'}.`;
      setStatus(msg);
      window.alert(msg);
      return;
    }
    if (!totals.hasAmount) {
      setStatus('Enter at least one line with Dr or Cr amount.');
      return;
    }
    for (let i = 0; i < lines.length; i += 1) {
      const ln = lines[i];
      const lineDr = parseAmt(ln.dr_amt);
      const lineCr = parseAmt(ln.cr_amt);
      if (lineDr > 0 && lineCr > 0) {
        const msg = `Line ${i + 1}: enter either Dr or Cr amount, not both.`;
        setStatus(msg);
        window.alert(msg);
        return;
      }
      if (showDcCodeCol && String(ln.code ?? '').trim() && !String(ln.dc_code ?? '').trim()) {
        const msg = `Line ${i + 1}: enter DCCode (contra account).`;
        setStatus(msg);
        window.alert(msg);
        return;
      }
    }
    if (cfg.balanceMode === 'balanced') {
      if (Math.abs(totals.dr - totals.cr) > 0.009) {
        const msg = `Debit (${totals.dr.toFixed(2)}) and credit (${totals.cr.toFixed(2)}) must balance before save.`;
        setStatus(msg);
        window.alert(msg);
        return;
      }
    } else if (totals.dr > 0 && totals.cr > 0) {
      const msg = `${cfg.vrType === 'BV' ? 'Bank' : 'Cash'} voucher lines must be all debit or all credit on the party side.`;
      setStatus(msg);
      window.alert(msg);
      return;
    }
    const payloadLines = buildPayloadLines();
    if (!payloadLines.length) {
      setStatus('Enter at least one line.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      const res = await axios.post(
        `${apiBase}/api/voucher-entry`,
        {
          comp_code: compCode,
          comp_year: compYear,
          comp_uid: compUid,
          vr_type: VR_TYPE,
          vr_date: oracleDt,
          vr_no: Number(vrNo) || 0,
          type: receiptType.trim() || 'N',
          r_c_no: Number(counterNo) || 0,
          cb_code: cfg.requiresCbAccount ? cbCode.trim() : '',
          mode: saveMode,
          user_name: userName,
          fy_s_date: fyMinYmd ? toOracleDate(fyMinYmd) : '',
          fy_e_date: fyMaxYmd ? toOracleDate(fyMaxYmd) : '',
          comp_s_dt: fyMinYmd ? toOracleDate(fyMinYmd) : '',
          comp_e_dt: fyMaxYmd ? toOracleDate(fyMaxYmd) : '',
          lines: payloadLines,
        },
        { withCredentials: true, timeout: 45000 }
      );
      setVrNo(String(res.data?.vr_no ?? vrNo));
      setReceiptType(String(res.data?.type ?? receiptType).trim() || 'N');
      setSaveMode('edit');
      setUiLocked(true);
      setNewEnabled(true);
      const msg = res.data?.message || `Voucher ${res.data?.vr_no ?? vrNo} saved.`;
      const jvCd = Number(res.data?.jv_vr_no_cd ?? 0) || 0;
      const jvInt = Number(res.data?.jv_vr_no_int ?? 0) || 0;
      setJvVrNo(jvCd > 0 ? String(jvCd) : '');
      setJvVrNoInt(jvInt > 0 ? String(jvInt) : '');
      const extra =
        jvCd || jvInt
          ? `\n${jvCd ? `CD JV: ${jvCd}` : ''}${jvCd && jvInt ? ' · ' : ''}${jvInt ? `Int JV: ${jvInt}` : ''}`
          : '';
      setStatus(msg);
      window.alert(msg + extra);
      void fetchCashContext();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Save failed';
      setStatus(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = () => {
    if (saveMode !== 'edit' || !vrNo) {
      setStatus('Load a voucher first (F1 on Vr. No. for that date).');
      return;
    }
    if (!uiLocked) {
      setStatus('Already editing — modify and Save.');
      return;
    }
    setNewEnabled(false);
    setUiLocked(false);
    setStatus('Edit mode — modify and Save.');
  };

  const handleDelete = async () => {
    if (saveMode !== 'edit' || !uiLocked) {
      setStatus('Load a voucher first. Finish or cancel edit before Delete.');
      return;
    }
    const oracleDt = toOracleDate(vrDate);
    const no = Number(vrNo);
    if (!oracleDt || !no) {
      setStatus('Nothing to delete.');
      return;
    }
    if (!window.confirm(`Delete ${cfg.voucherKindLabel} ${no} dated ${oracleDt}?`)) return;

    setBusy(true);
    setStatus('');
    try {
      const res = await axios.delete(`${apiBase}/api/voucher-entry`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: VR_TYPE,
          vr_date: oracleDt,
          vr_no: no,
          type: receiptType.trim() || 'N',
        },
        withCredentials: true,
        timeout: 30000,
      });
      const msg = res.data?.message || 'Voucher deleted.';
      setStatus(msg);
      window.alert(msg);
      resetNew();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setStatus(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy;
  const isReceiptVoucher = String(receiptType).trim().toUpperCase() === 'R';
  const canEditLoaded = saveMode === 'edit' && uiLocked && Boolean(vrNo);
  const canDeleteLoaded = canEditLoaded;
  const canPrint = Boolean(toOracleDate(vrDate) && Number(vrNo) > 0);

  const runVoucherPrint = useCallback(
    async (fn) => {
      try {
        setBusy(true);
        await fn(apiBase, {
          compCode,
          compUid,
          vrType: VR_TYPE,
          vrDate,
          vrNo,
          formData,
          userName,
        });
      } catch (err) {
        const msg = err.response?.data?.error || err.message || 'Print failed';
        setStatus(msg);
        window.alert(msg);
      } finally {
        setBusy(false);
      }
    },
    [apiBase, compCode, compUid, VR_TYPE, vrDate, vrNo, formData, userName]
  );

  return (
    <div className="voucher-entry-form">
      <div className="voucher-entry-form__toolbar voucher-entry-form__toolbar--vfp">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || !newEnabled}
          onClick={resetNew}
          title={`Start a new ${cfg.voucherKindLabel}`}
        >
          New
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || !canEditLoaded}
          onClick={handleEdit}
          title="Unlock loaded voucher for changes"
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={disabled || !canDeleteLoaded}
          onClick={handleDelete}
          title="Delete loaded voucher"
        >
          Delete
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm voucher-entry-form__list-btn"
          disabled={disabled}
          onClick={() => void openVrNoHelp()}
          title={`Browse ${cfg.voucherKindLabel}s on Vr. Date (mobile / no F1)`}
        >
          List
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || readOnly || !totals.hasAmount || (cfg.balanceMode === 'balanced' && !totals.balanced)}
          onClick={handleSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() => loadVoucher()}
          title="Fetch saved voucher for current Vr. Date + Vr. No. (same as picking from List)"
        >
          Load
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() => void handleRefresh()}
          title="Clear form — enable New for next voucher"
        >
          Refresh
        </button>
        {typeof onOpenChecklist === 'function' ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm voucher-entry-form__checklist-btn"
            disabled={disabled}
            onClick={onOpenChecklist}
            title={`Open ${cfg.voucherKindLabel} checklist report`}
          >
            Checklist
          </button>
        ) : null}
        <ReportExportMenu
          className="voucher-entry-form__export-menu"
          variant="light"
          showExcel={false}
          showPrint
          printDisabled={disabled || !canPrint}
          pdfDisabled={disabled || !canPrint}
          whatsAppDisabled={disabled || !canPrint}
          onPrint={() => void runVoucherPrint(printVoucherBrowser)}
          onPdf={() => void runVoucherPrint(exportVoucherPdf)}
          onWhatsApp={() => void runVoucherPrint(shareVoucherWhatsApp)}
        />
        <span className={`voucher-entry-form__mode voucher-entry-form__mode--${saveMode}`}>
          {uiLocked ? (saveMode === 'edit' ? 'View' : 'New') : saveMode === 'edit' ? 'Edit' : 'New'}
        </span>
        {typeof onBack === 'function' ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm voucher-entry-form__back-btn"
            disabled={disabled}
            onClick={onBack}
            title="Return to voucher menu"
          >
            Back
          </button>
        ) : null}
      </div>

      <div className="voucher-entry-form__header voucher-entry-form__header--vfp">
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Vr. Date</span>
          <VoucherDmyDateInput
            className="form-input voucher-entry-form__input voucher-entry-form__input--date"
            valueYmd={vrDate}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={disabled || (uiLocked && saveMode === 'edit')}
            title={fyMinYmd && fyMaxYmd ? `dd/mm/yyyy · FY ${fyRangeLabel}` : 'dd/mm/yyyy'}
            inputRef={(el) => {
              vrDateRef.current = el;
              focusChain.register('hdr-date', el);
            }}
            onChangeYmd={handleVrDateCommitted}
            onKeyDown={(e) => focusChain.onEnter('hdr-date')(e)}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--receipt">
          <span className="voucher-entry-form__label">(R)eceipt</span>
          <input
            type="text"
            className="form-input voucher-entry-form__input voucher-entry-form__input--receipt"
            value={receiptType}
            maxLength={1}
            disabled={readOnly}
            title="N = normal, R = receipt voucher"
            ref={(el) => focusChain.register('hdr-receipt', el)}
            onChange={(e) => setReceiptType(e.target.value.toUpperCase().slice(0, 1))}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                void advanceFromReceiptType(e.target?.value);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                handleReceiptTypeEnter(e);
                return;
              }
              handleFieldKeyDown('hdr-receipt', e);
            }}
          />
        </label>
        {isReceiptVoucher ? (
          <>
            <label className="voucher-entry-form__field voucher-entry-form__field--counter">
              <span className="voucher-entry-form__label">Counter No.</span>
              <input
                type="number"
                className="form-input voucher-entry-form__input"
                value={counterNo}
                min={0}
                disabled={readOnly}
                {...bindFocus('hdr-counter')}
                onChange={(e) => setCounterNo(e.target.value)}
              />
            </label>
            <label className="voucher-entry-form__field voucher-entry-form__field--no">
              <span className="voucher-entry-form__label">Vr. No.</span>
              <div className="voucher-entry-form__code-help voucher-entry-form__vrno-help">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="form-input voucher-entry-form__input"
                  value={vrNo}
                  disabled={uiLocked || busy}
                  ref={(el) => focusChain.register('hdr-vrno', el)}
                  title="F1 / ? — list for this date · Enter — load if exists, else new · blur also checks"
                  onKeyDown={handleVrNoKeyDown}
                  onBlur={handleVrNoBlur}
                  onChange={handleVrNoChange}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={readOnly}
                  title="Browse vouchers on this date (tap on mobile)"
                  tabIndex={-1}
                  onClick={() => void openVrNoHelp()}
                >
                  ?
                </button>
              </div>
            </label>
          </>
        ) : (
          <>
            <label className="voucher-entry-form__field voucher-entry-form__field--no">
              <span className="voucher-entry-form__label">Vr. No.</span>
              <div className="voucher-entry-form__code-help voucher-entry-form__vrno-help">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="form-input voucher-entry-form__input"
                  value={vrNo}
                  disabled={uiLocked || busy}
                  ref={(el) => focusChain.register('hdr-vrno', el)}
                  title="F1 / ? — list for this date · Enter — load if exists, else new · blur also checks"
                  onKeyDown={handleVrNoKeyDown}
                  onBlur={handleVrNoBlur}
                  onChange={handleVrNoChange}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={readOnly}
                  title="Browse vouchers on this date (tap on mobile)"
                  tabIndex={-1}
                  onClick={() => void openVrNoHelp()}
                >
                  ?
                </button>
              </div>
            </label>
            <label className="voucher-entry-form__field voucher-entry-form__field--counter">
              <span className="voucher-entry-form__label">Counter No.</span>
              <input
                type="number"
                className="form-input voucher-entry-form__input"
                value={counterNo}
                min={0}
                disabled={readOnly}
                {...bindFocus('hdr-counter')}
                onChange={(e) => setCounterNo(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="voucher-entry-form__field voucher-entry-form__field--pan">
          <span className="voucher-entry-form__label">Pan</span>
          <input
            type="text"
            className="form-input voucher-entry-form__input"
            value={pan}
            readOnly
            tabIndex={-1}
          />
        </label>
        {!cfg.hideCbHeader ? (
        <>
        <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
          <span className="voucher-entry-form__label">{cfg.cbLabel}</span>
          <div className="voucher-entry-form__code-help">
            <input
              type="text"
              className="form-input voucher-entry-form__input voucher-entry-form__code"
              value={cbCode}
              disabled={readOnly}
              maxLength={12}
              title="Type code or F1 / ? for help"
              {...bindFocus('hdr-cash')}
              onChange={(e) => {
                setCbCode(e.target.value.toUpperCase());
                setCbName('');
              }}
              onBlur={(e) => onCashBlur(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'F1' || e.keyCode === 112) {
                  e.preventDefault();
                  setAccountHelp({ kind: 'cash' });
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusField(firstLineCodeKey);
                  return;
                }
                focusChain.onEnter('hdr-cash')(e);
              }}
            />
            <button
              type="button"
              className="voucher-entry-form__code-help-btn"
              disabled={readOnly}
              title={`${cfg.cbLabel} help (F1)`}
              tabIndex={-1}
              onClick={() => setAccountHelp({ kind: 'cash' })}
            >
              ?
            </button>
          </div>
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--cash-name">
          <span className="voucher-entry-form__label">{cfg.cbNameLabel}</span>
          <input
            type="text"
            className="form-input voucher-entry-form__input voucher-entry-form__input--ro"
            value={cbName}
            readOnly
            tabIndex={-1}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--bal">
          <span className="voucher-entry-form__label">A/c Bal.</span>
          <input
            type="text"
            className="form-input voucher-entry-form__input voucher-entry-form__input--ro"
            value={acBal.toFixed(2)}
            readOnly
            tabIndex={-1}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--bal">
          <span className="voucher-entry-form__label">{cfg.totLabel}</span>
          <input
            type="text"
            className="form-input voucher-entry-form__input voucher-entry-form__input--ro"
            value={totCash.toFixed(2)}
            readOnly
            tabIndex={-1}
          />
        </label>
        {cfg.showJvLinks ? (
          <>
            <label className="voucher-entry-form__field voucher-entry-form__field--jv">
              <span className="voucher-entry-form__label">JV Vr.No</span>
              <input
                type="text"
                className="form-input voucher-entry-form__input voucher-entry-form__input--ro"
                value={jvVrNo}
                readOnly
                tabIndex={-1}
                title="Linked journal voucher for cash discount (CD transfer)"
              />
            </label>
            <label className="voucher-entry-form__field voucher-entry-form__field--jv">
              <span className="voucher-entry-form__label">Int JV Vr.No</span>
              <input
                type="text"
                className="form-input voucher-entry-form__input voucher-entry-form__input--ro"
                value={jvVrNoInt}
                readOnly
                tabIndex={-1}
                title="Linked journal voucher for interest transfer"
              />
            </label>
          </>
        ) : null}
        </>
        ) : null}
      </div>

      <div className="voucher-entry-form__grid-wrap">
        <table className="voucher-entry-form__grid voucher-entry-form__grid--vfp">
          <thead>
            <tr>
              <th>Sno</th>
              <th>Code</th>
              <th>Name</th>
              {showDcCodeCol ? <th>DCCode</th> : null}
              <th>Val.Date</th>
              <th>Lot No</th>
              <th>Chq.No.</th>
              <th>Particulars</th>
              {showIndYnCol ? <th className="voucher-entry-form__col-indyn">Ind.</th> : null}
              <th>Bill Date</th>
              <th>No.</th>
              <th>T</th>
              <th className="voucher-entry-form__num">Dr.Amount</th>
              <th className="voucher-entry-form__num">Cr.Amount</th>
              <th className="voucher-entry-form__num">Int.</th>
              <th className="voucher-entry-form__num">C.D.</th>
              <th>Cost</th>
              {showBrokerCol ? <th>Broker</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, rowIdx) => {
              const p = `ln-${ln.key}`;
              return (
                <tr
                  key={ln.key}
                  className={activeLine === rowIdx ? 'voucher-entry-form__row--active' : undefined}
                  onClick={() => setActiveLine(rowIdx)}
                >
                  <td className="voucher-entry-form__sno">{rowIdx + 1}</td>
                  <td className="voucher-entry-form__party">
                    <div className="voucher-entry-form__code-help">
                      <input
                        type="text"
                        className="form-input voucher-entry-form__cell voucher-entry-form__code"
                        value={ln.code}
                        disabled={readOnly}
                        maxLength={12}
                        title="Type code or F1 / ? for help"
                        {...bindFocus(`${p}-code`)}
                        onChange={(e) =>
                          setLine(ln.key, {
                            code: e.target.value.toUpperCase(),
                            name: '',
                            pan: '',
                            schedule: '',
                          })
                        }
                        onBlur={(e) => onPartyBlur(ln.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'F1' || e.keyCode === 112) {
                            e.preventDefault();
                            setActiveLine(rowIdx);
                            setAccountHelp({ kind: 'party', lineKey: ln.key });
                            return;
                          }
                          focusChain.onEnter(`${p}-code`)(e);
                        }}
                      />
                      <button
                        type="button"
                        className="voucher-entry-form__code-help-btn"
                        disabled={readOnly}
                        title="Party account help (F1)"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveLine(rowIdx);
                          setAccountHelp({ kind: 'party', lineKey: ln.key });
                        }}
                      >
                        ?
                      </button>
                    </div>
                  </td>
                  <td className="voucher-entry-form__name" title={ln.name}>
                    {ln.name}
                  </td>
                  {showDcCodeCol ? (
                    <td className="voucher-entry-form__party">
                      <div className="voucher-entry-form__code-help">
                        <input
                          type="text"
                          className="form-input voucher-entry-form__cell voucher-entry-form__code"
                          value={ln.dc_code ?? ''}
                          disabled={readOnly}
                          maxLength={12}
                          title={ln.dc_name ? `${ln.dc_code} — ${ln.dc_name}` : 'DC account · F1 / ? for help'}
                          {...bindFocus(`${p}-dccode`)}
                          onChange={(e) =>
                            setLine(ln.key, {
                              dc_code: e.target.value.toUpperCase(),
                              dc_name: '',
                            })
                          }
                          onBlur={(e) => onDcBlur(ln.key, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'F1' || e.keyCode === 112) {
                              e.preventDefault();
                              setActiveLine(rowIdx);
                              setAccountHelp({ kind: 'dc', lineKey: ln.key });
                              return;
                            }
                            focusChain.onEnter(`${p}-dccode`)(e);
                          }}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={readOnly}
                          title="DC account help (F1)"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLine(rowIdx);
                            setAccountHelp({ kind: 'dc', lineKey: ln.key });
                          }}
                        >
                          ?
                        </button>
                      </div>
                    </td>
                  ) : null}
                  <td className="voucher-entry-form__col-date">
                    <VoucherDmyDateInput
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--date"
                      valueYmd={ln.v_date || vrDate}
                      minYmd={fyMinYmd}
                      maxYmd={fyMaxYmd}
                      disabled={readOnly}
                      inputRef={(el) => focusChain.register(`${p}-vdate`, el)}
                      onChangeYmd={(ymd) => setLine(ln.key, { v_date: ymd || vrDate })}
                      onKeyDown={(e) => focusChain.onEnter(`${p}-vdate`)(e)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--sm"
                      value={ln.b_no}
                      disabled={readOnly}
                      maxLength={20}
                      title="F1 — VFP LOTHLP · B.No (God.Lot)"
                      ref={(el) => focusChain.register(`${p}-lot`, el)}
                      onChange={(e) =>
                        setLine(ln.key, { b_no: e.target.value.replace(/\D/g, '') })
                      }
                      onKeyDown={(e) =>
                        handleFieldKeyDown(`${p}-lot`, e, { type: 'lot', lineKey: ln.key })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--sm"
                      value={ln.chq_no}
                      disabled={readOnly}
                      maxLength={6}
                      {...bindFocus(`${p}-chq`)}
                      onChange={(e) => setLine(ln.key, { chq_no: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--detail"
                      value={ln.detail}
                      disabled={readOnly}
                      maxLength={150}
                      {...bindFocus(`${p}-detail`)}
                      onChange={(e) => setLine(ln.key, { detail: e.target.value })}
                    />
                  </td>
                  {showIndYnCol ? (
                    <td>
                      <input
                        type="text"
                        className="form-input voucher-entry-form__cell voucher-entry-form__cell--type"
                        value={ln.ind_yn ?? ''}
                        disabled={readOnly}
                        maxLength={1}
                        title="Y / I / F — bill help · I=indent, F=freight · Enter Y opens Billhlp"
                        ref={(el) => focusChain.register(`${p}-indyn`, el)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            const ch = String(e.target?.value ?? '')
                              .trim()
                              .toUpperCase();
                            if (ch === 'Y' || ch === 'I' || ch === 'F') {
                              e.preventDefault();
                              openBillHelpForLine(ln.key);
                              return;
                            }
                          }
                          if (e.key === 'F1' || e.keyCode === 112) {
                            e.preventDefault();
                            openBillHelpForLine(ln.key);
                            return;
                          }
                          focusChain.onEnter(`${p}-indyn`)(e);
                        }}
                        onChange={(e) =>
                          setLine(ln.key, { ind_yn: e.target.value.toUpperCase().slice(0, 1) })
                        }
                      />
                    </td>
                  ) : null}
                  <td className="voucher-entry-form__col-date">
                    <VoucherDmyDateInput
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--date"
                      valueYmd={ln.bill_date ? toInputDateString(ln.bill_date) : ''}
                      disabled={readOnly}
                      title="F1 — bill help · dd/mm/yyyy"
                      inputRef={(el) => focusChain.register(`${p}-billdt`, el)}
                      onChangeYmd={(ymd) => setLine(ln.key, { bill_date: ymd })}
                      onKeyDown={(e) =>
                        handleFieldKeyDown(`${p}-billdt`, e, { type: 'bill', lineKey: ln.key })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--billno"
                      value={ln.bill_no}
                      disabled={readOnly}
                      min={0}
                      {...bindFocus(`${p}-billno`)}
                      onChange={(e) => setLine(ln.key, { bill_no: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input voucher-entry-form__cell voucher-entry-form__cell--type"
                      value={ln.b_type ?? ''}
                      disabled={readOnly}
                      maxLength={1}
                      autoComplete="off"
                      ref={(el) => focusChain.register(`${p}-btype`, el)}
                      onKeyDown={(e) => focusChain.onEnter(`${p}-btype`)(e)}
                      onChange={(e) =>
                        setLine(ln.key, { b_type: e.target.value.toUpperCase().slice(0, 1) })
                      }
                    />
                  </td>
                  <td className="voucher-entry-form__col-amt">
                    <input
                      {...amtInputProps(`${p}-dr`, ln, 'dr_amt', onDrChange, 'cr_amt')}
                    />
                  </td>
                  <td className="voucher-entry-form__col-amt">
                    <input
                      {...amtInputProps(`${p}-cr`, ln, 'cr_amt', onCrChange, 'dr_amt')}
                    />
                  </td>
                  <td>
                    <input
                      {...amtInputProps(`${p}-int`, ln, 'int_amt', (_key, raw) =>
                        setLine(_key, { int_amt: sanitizeAmtTyping(raw) })
                      )}
                      onBlur={(e) => {
                        onAmtBlur(ln.key, 'int_amt', e.target.value);
                        window.setTimeout(() => focusField(`${p}-cd`), 0);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      {...amtInputProps(`${p}-cd`, ln, 'cd_amt', (_key, raw) =>
                        setLine(_key, { cd_amt: sanitizeAmtTyping(raw) })
                      )}
                    />
                  </td>
                  <td>
                    <div className="voucher-entry-form__code-help">
                      <input
                        type="text"
                        className="form-input voucher-entry-form__cell voucher-entry-form__cell--cost"
                        value={ln.cost_code}
                        disabled={readOnly}
                        maxLength={12}
                        title="Cost centre — type code or F1 / ? for help"
                        ref={(el) => focusChain.register(`${p}-cost`, el)}
                        onChange={(e) =>
                          setLine(ln.key, { cost_code: e.target.value.toUpperCase() })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'F1' || e.keyCode === 112) {
                            e.preventDefault();
                            setActiveLine(rowIdx);
                            void openCostHelp(ln.key);
                            return;
                          }
                          focusChain.onEnter(`${p}-cost`)(e);
                        }}
                      />
                      <button
                        type="button"
                        className="voucher-entry-form__code-help-btn"
                        disabled={readOnly}
                        title="Cost centre help (F1)"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveLine(rowIdx);
                          void openCostHelp(ln.key);
                        }}
                      >
                        ?
                      </button>
                    </div>
                  </td>
                  {showBrokerCol ? (
                    <td>
                      <input
                        type="text"
                        className="form-input voucher-entry-form__cell voucher-entry-form__cell--broker"
                        value={ln.bk_code}
                        disabled={readOnly}
                        maxLength={8}
                        {...bindFocus(`${p}-broker`)}
                        onChange={(e) => setLine(ln.key, { bk_code: e.target.value.toUpperCase() })}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10 + (showDcCodeCol ? 1 : 0) + (showIndYnCol ? 1 : 0)} className="voucher-entry-form__tot-label">
                TOTAL
                {!totals.balanced && totals.hasAmount && (
                  <span className="voucher-entry-form__unbalanced">
                    {cfg.balanceMode === 'balanced'
                      ? ' — Dr and Cr must balance'
                      : ' — check amounts'}
                  </span>
                )}
              </td>
              <td className="voucher-entry-form__num voucher-entry-form__tot voucher-entry-form__col-amt">{totals.dr.toFixed(2)}</td>
              <td className="voucher-entry-form__num voucher-entry-form__tot voucher-entry-form__col-amt">{totals.cr.toFixed(2)}</td>
              <td colSpan={3 + (showBrokerCol ? 1 : 0)} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="voucher-entry-form__foot">
        <button type="button" className="btn btn-secondary btn-sm" disabled={readOnly} onClick={addLine}>
          + Add line
        </button>
        {status && <p className="voucher-entry-form__status">{status}</p>}
        {fyMinYmd && fyMaxYmd && (
          <p className="voucher-entry-form__fy-hint">FY: {fyRangeLabel}</p>
        )}
      </div>

      <VoucherGridHelpModal
        open={Boolean(gridHelp)}
        title={gridHelp?.title || ''}
        hint={gridHelp?.hint}
        columns={gridHelp?.columns || []}
        rows={gridHelp?.rows || []}
        loading={gridHelp?.loading}
        error={gridHelp?.error}
        onClose={() => setGridHelp(null)}
        onSelect={(row) => {
          if (gridHelp?.type === 'vrno') {
            fetchNoGenRef.current += 1;
            vrNoUserSetRef.current = true;
            const no = String(row.vr_no ?? '').trim();
            const t = String(row.type ?? 'N').trim().slice(0, 1).toUpperCase() || 'N';
            setReceiptType(t);
            setVrNo(no);
            setGridHelp(null);
            void loadVoucherByNo(no);
            return;
          }
          if (!gridHelp?.lineKey) return;
          if (gridHelp.type === 'lot') applyLotPick(gridHelp.lineKey, row, gridHelp.lotStyle);
        }}
      />

      <VoucherBillAdjustPrompt
        open={billAdjustOpen}
        onClose={() => setBillAdjustOpen(false)}
        onChoice={onBillAdjustChoice}
      />

      <VoucherPendingBillsModal
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        partyCode={activeParty?.code}
        partyName={activeParty?.name}
        schedule={activeParty?.schedule}
        indYn={activeParty?.ind_yn}
        vDate={toOracleDate(activeParty?.v_date || vrDate)}
        pndBills={billHelpSettings.pnd_bills}
        vouIntShow={billHelpSettings.vou_int_show}
        pendingZeroYn={billHelpSettings.pending_zero_yn}
        gCdCal={billHelpSettings.cd_less}
        initialMode={pendingInitialMode}
        autoLoadManual={pendingInitialMode === 'manual'}
        lineKey={billTargetLineKey}
        onApply={(picked, lineKey) => applyPendingBills(picked, lineKey)}
      />

      {accountHelp != null && (
        <VoucherAccountHelpModal
          open
          title={
            accountHelp.kind === 'cash'
              ? `${cfg.cbLabel} help (F1)`
              : accountHelp.kind === 'cost'
                ? 'Cost centre help (F1)'
                : accountHelp.kind === 'dc'
                  ? 'DC account help (F1)'
                  : 'Party account help (F1)'
          }
          accounts={
            accountHelp.kind === 'cash'
              ? cbAccountOptions
              : accountHelp.kind === 'cost'
                ? costHelpOptions
                : accounts
          }
          onSelect={applyAccountHelp}
          onClose={() => setAccountHelp(null)}
        />
      )}
    </div>
  );
}
