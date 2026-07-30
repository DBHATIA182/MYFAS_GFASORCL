import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import DispatchChallanPrintModal from './DispatchChallanPrintModal';
import DispatchChallanChecklistModal from './DispatchChallanChecklistModal';
import { toInputDateString, toOracleDate } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  finYearRangeLabel,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import '../styles/purchaseOrderForm.css';

const BKH_OPTIONS = ['B', 'K', 'H'];

const LOT_STOCK_HELP_COLUMNS = [
  { key: 'b_no', label: 'B.No.', align: 'right' },
  { key: 'sup_code', label: 'SupCode' },
  { key: 'sup_name', label: 'Supplier' },
  { key: 'item_code', label: 'Item', align: 'right' },
  { key: 'item_name', label: 'Item Name' },
  { key: 'lot', label: 'Lot' },
  { key: 'status', label: 'B/K/H' },
  { key: 'god_code', label: 'God.' },
  { key: 'vr_date', label: 'Arr. Date' },
  { key: 'receipt_qnty', label: 'Rec.Qty', align: 'right' },
  { key: 'issue_qnty', label: 'Iss.Qty', align: 'right' },
  { key: 'balance_qnty', label: 'Bal.Qty', align: 'right' },
  { key: 'balance_weight', label: 'Bal.Weight', align: 'right' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'remarks', label: 'Remarks' },
];

const SALES_ORDER_HELP_COLUMNS = [
  { key: 'so_no', label: 'SO.No.', align: 'right' },
  { key: 'so_date', label: 'SO Date' },
  { key: 'item_code', label: 'Item', align: 'right' },
  { key: 'status', label: 'B/K/H' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'order_qnty', label: 'SO Qty', align: 'right' },
  { key: 'used_qnty', label: 'DC Qty', align: 'right' },
  { key: 'balance_qnty', label: 'Bal.Qty', align: 'right' },
  { key: 'order_weight', label: 'SO Weight', align: 'right' },
  { key: 'used_weight', label: 'DC Weight', align: 'right' },
  { key: 'balance_weight', label: 'Bal.Weight', align: 'right' },
];

const MARKA_HELP_COLUMNS = [{ key: 'marka', label: 'Marka' }];

const reqOpts = { withCredentials: true, timeout: 120000 };

/** VFP dcadd party help: customers — SUBSTR(CODE,1,1)='C'. */
function filterSalesParties(rows) {
  return (rows || []).filter((p) =>
    String(p.CODE ?? p.code ?? '').trim().toUpperCase().startsWith('C')
  );
}

/** VFP DISPSTK / lot help supplier filter — SUBSTR(CODE,1,1)='S'. */
function filterSupplierCodes(rows) {
  return (rows || []).filter((p) =>
    String(p.CODE ?? p.code ?? '').trim().toUpperCase().startsWith('S')
  );
}

function filterLotHelpRows(allRows, { remarks = '', sup_code = '' } = {}) {
  const list = Array.isArray(allRows) ? allRows : [];
  const remarkQ = String(remarks ?? '').trim().toUpperCase();
  const supQ = String(sup_code ?? '').trim().toUpperCase();
  return list.filter((r) => {
    if (remarkQ && !String(r.remarks ?? '').toUpperCase().includes(remarkQ)) return false;
    if (supQ && String(r.sup_code ?? '').trim().toUpperCase() !== supQ) return false;
    return true;
  });
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function round3(v) {
  return Math.round(num(v) * 1000) / 1000;
}

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function emptyLine(key = 1) {
  return {
    key,
    item_code: '',
    item_name: '',
    so_no: '',
    lot: '',
    status: 'B',
    b_no: '',
    god_code: '',
    sup_code: '',
    sup_name: '',
    cost_code: '',
    marka: '',
    qnty: '',
    packing: '',
    weight: '',
    weight_manual: false,
    rate: '',
    amount: '',
    sup_date: '',
  };
}

/**
 * VFP dcadd weight + amountcal:
 *  weight (unless typed manually): G_WGTKQ='Q' → QNTY×PACKING/100, else QNTY×PACKING
 *  amount: weight ≠ 0 → (G_WGTKQ='Q' ? WEIGHT×RATE : WEIGHT×RATE/100), else QNTY×RATE
 */
function recalcLine(line, wgtKq = 'K') {
  const next = { ...line };
  const qnty = num(next.qnty);
  const packing = num(next.packing);
  if (!next.weight_manual && qnty > 0 && packing > 0) {
    const w = String(wgtKq).toUpperCase() === 'Q' ? (qnty * packing) / 100 : qnty * packing;
    next.weight = String(round3(w));
  }
  const weight = num(next.weight);
  const rate = num(next.rate);
  let amount = 0;
  if (weight !== 0) {
    amount = String(wgtKq).toUpperCase() === 'Q' ? round2(weight * rate) : round2((weight * rate) / 100);
  } else {
    amount = round2(qnty * rate);
  }
  next.amount = amount ? String(amount) : '';
  return next;
}

function emptyHeader(billDate = '') {
  return {
    bill_no: '',
    b_type: 'N',
    bill_date: billDate,
    v_date: billDate,
    code: '',
    party_name: '',
    party_city: '',
    bk_code: '',
    bk_name: '',
    ch_no: '',
    gr_no: '',
    truck_no: '',
    tpt: '',
    form: '',
    remarks: '',
    mod_reason: '',
  };
}

/**
 * Dispatch Challan / DC Return entry — VFP DO FORM dcadd WITH 'DC' | 'DR'.
 * dcType: 'DC' (challan) or 'DR' (return). Writes SALE via /api/dispatch-challan.
 */
export default function DispatchChallanEntryForm({ apiBase, formData, userName, dcType = 'DC', onBack }) {
  const isReturn = String(dcType).toUpperCase() === 'DR';
  const docType = isReturn ? 'DR' : 'DC';
  const docLabel = isReturn ? 'DC Return' : 'Dispatch Challan';

  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;

  const fy = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const fyMinYmd = fy.fyMinYmd;
  const fyMaxYmd = fy.fyMaxYmd;
  const fyRangeLabel = finYearRangeLabel(fyMinYmd, fyMaxYmd);
  const defaultBillDate = useMemo(
    () => toInputDateString(defaultDocDateInFinYear(fyMinYmd, fyMaxYmd)),
    [fyMinYmd, fyMaxYmd]
  );

  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const [wgtKq, setWgtKq] = useState('K');
  const [saleOrderType, setSaleOrderType] = useState('B');
  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultBillDate));
  const [lines, setLines] = useState(() => [emptyLine(1)]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [costs, setCosts] = useState([]);
  const [markas, setMarkas] = useState([]);

  const [helpField, setHelpField] = useState(null);
  const [supHelpLine, setSupHelpLine] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [markaHelpLine, setMarkaHelpLine] = useState(null);
  const [lotHelp, setLotHelp] = useState(null);
  const [lotSupHelpOpen, setLotSupHelpOpen] = useState(false);
  const [salesOrderHelp, setSalesOrderHelp] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [listRows, setListRows] = useState([]);
  const [listBusy, setListBusy] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState([]);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  const [dcPerms, setDcPerms] = useState(null);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const lineKeyRef = useRef(2);

  const apiParams = useMemo(
    () => ({
      comp_code: compCode,
      comp_uid: compUid,
      user_name: userName,
    }),
    [compCode, compUid, userName]
  );

  const focusOrder = useMemo(() => {
    const keys = ['hdr-btype', 'hdr-bill-date', 'hdr-v-date'];
    if (isReturn) keys.push('hdr-chno');
    keys.push('hdr-bk', 'hdr-code');
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-item`,
        `ln-${ln.key}-sono`,
        `ln-${ln.key}-lot`,
        `ln-${ln.key}-status`,
        `ln-${ln.key}-bno`,
        `ln-${ln.key}-god`,
        `ln-${ln.key}-sup`,
        `ln-${ln.key}-marka`,
        `ln-${ln.key}-qnty`,
        `ln-${ln.key}-pkg`,
        `ln-${ln.key}-weight`,
        `ln-${ln.key}-rate`,
        `ln-${ln.key}-valdate`,
        `ln-${ln.key}-cost`
      );
    }
    keys.push('ft-grno', 'ft-truck', 'ft-tpt', 'ft-form', 'ft-remarks');
    return keys;
  }, [lines, isReturn]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  useEffect(() => {
    if (!defaultBillDate) return;
    setHeader((h) => {
      if (h.bill_no) return h;
      if (h.bill_date) return h;
      return { ...h, bill_date: defaultBillDate, v_date: defaultBillDate };
    });
  }, [defaultBillDate]);

  const editable =
    (mode === 'new' && Boolean(dcPerms?.canAdd)) || (mode === 'edit' && Boolean(dcPerms?.canEdit));
  const canSave = editable && !busy;

  const totals = useMemo(() => {
    let qnty = 0;
    let weight = 0;
    let amount = 0;
    for (const ln of lines) {
      if (!ln.item_code) continue;
      qnty += num(ln.qnty);
      weight += num(ln.weight);
      amount += num(ln.amount);
    }
    return { qnty, weight: round3(weight), amount: round2(amount) };
  }, [lines]);

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      const permRes = await axios.get(`${apiBase}/api/dispatch-challan/user-permissions`, {
        params: { comp_uid: compUid, user_name: userName },
        ...reqOpts,
      });
      const perms = permRes.data || {};
      setDcPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const lookupParams = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, partyRes, brokerRes, godRes, supRes, markaRes] = await Promise.all([
        axios.get(`${apiBase}/api/dispatch-challan/context`, { params: apiParams, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-items`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-parties`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/purchaselist-suppliers`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/dispatch-challan/marka-help`, { params: apiParams, ...reqOpts }).catch(() => ({ data: [] })),
      ]);
      const wk = String(ctxRes.data?.wgt_kq ?? 'K').trim().toUpperCase() === 'Q' ? 'Q' : 'K';
      setWgtKq(wk);
      setSaleOrderType(String(ctxRes.data?.sale_order_type ?? 'B').trim().toUpperCase() === 'C' ? 'C' : 'B');
      setCosts(Array.isArray(ctxRes.data?.costs) ? ctxRes.data.costs : []);
      setItems(itemsRes.data || []);
      setParties(filterSalesParties(partyRes.data));
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      setSuppliers(filterSupplierCodes(supRes.data));
      const markaRows = Array.isArray(markaRes.data?.rows)
        ? markaRes.data.rows
        : Array.isArray(markaRes.data)
          ? markaRes.data
          : [];
      setMarkas(
        markaRows
          .map((r) => ({ marka: String(r.MARKA ?? r.marka ?? '').trim() }))
          .filter((r) => r.marka)
      );
    } catch (err) {
      const msg = err.response?.data?.error || err.message || `Could not load ${docLabel}.`;
      setPermErr(msg);
      setDcPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, apiParams, compCode, compUid, userName, docLabel]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const applyLoaded = useCallback((data) => {
    const h = data?.header || {};
    const loadedLines = (data?.lines || []).map((ln, idx) => ({
      key: idx + 1,
      item_code: ln.item_code ? String(ln.item_code) : '',
      item_name: String(ln.item_name ?? '').trim(),
      so_no: String(ln.so_no ?? '').trim(),
      lot: String(ln.lot ?? '').trim(),
      status: String(ln.status ?? 'B').trim().toUpperCase() || 'B',
      b_no: String(ln.b_no ?? '').trim(),
      god_code: String(ln.god_code ?? '').trim(),
      sup_code: String(ln.sup_code ?? '').trim(),
      sup_name: String(ln.sup_name ?? '').trim(),
      cost_code: String(ln.cost_code ?? '').trim(),
      marka: String(ln.marka ?? '').trim(),
      qnty: ln.qnty != null && num(ln.qnty) ? String(ln.qnty) : '',
      packing: ln.packing != null && num(ln.packing) ? String(ln.packing) : '',
      weight: ln.weight != null && num(ln.weight) ? String(ln.weight) : '',
      weight_manual: true,
      rate: ln.rate != null && num(ln.rate) ? String(ln.rate) : '',
      amount: ln.amount != null && num(ln.amount) ? String(ln.amount) : '',
      sup_date: toInputDateString(ln.sup_date),
    }));
    setHeader({
      bill_no: String(h.bill_no ?? ''),
      b_type: String(h.b_type ?? 'N').trim() || 'N',
      bill_date: toInputDateString(h.bill_date),
      v_date: toInputDateString(h.v_date) || toInputDateString(h.bill_date),
      code: String(h.code ?? '').trim(),
      party_name: String(h.party_name ?? '').trim(),
      party_city: String(h.party_city ?? '').trim(),
      bk_code: String(h.bk_code ?? '').trim(),
      bk_name: String(h.bk_name ?? '').trim(),
      ch_no: String(h.ch_no ?? '').trim(),
      gr_no: String(h.gr_no ?? '').trim(),
      truck_no: String(h.truck_no ?? '').trim(),
      tpt: String(h.tpt ?? '').trim(),
      form: String(h.form ?? '').trim(),
      remarks: String(h.remarks ?? '').trim(),
      mod_reason: String(h.mod_reason ?? '').trim(),
    });
    lineKeyRef.current = loadedLines.length + 1;
    setLines(loadedLines.length ? loadedLines : [emptyLine(1)]);
    setMode('view');
    setStatus('');
  }, []);

  const loadChallan = useCallback(
    async (billNo) => {
      if (!compCode || !billNo) return;
      setBusy(true);
      setStatus('Loading…');
      try {
        const params = { ...apiParams, dc_type: docType, bill_no: billNo };
        const { data } = await axios.get(`${apiBase}/api/dispatch-challan`, { params, ...reqOpts });
        applyLoaded(data);
        setStatus('');
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, compCode, docType]
  );

  const startNew = useCallback(async () => {
    if (!compCode) return;
    if (!dcPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan/next-no`, {
        params: { ...apiParams, dc_type: docType },
        ...reqOpts,
      });
      lineKeyRef.current = 2;
      setHeader({
        ...emptyHeader(defaultBillDate),
        bill_no: String(data.bill_no ?? ''),
      });
      setLines([emptyLine(1)]);
      setMode('new');
      window.setTimeout(() => focusChain.focusKey('hdr-bill-date'), 80);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Could not get next number.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, compCode, dcPerms?.canAdd, defaultBillDate, docType, focusChain]);

  const startEdit = () => {
    if (!header.bill_no) {
      setStatus(`Load or create a ${docLabel.toLowerCase()} first.`);
      return;
    }
    if (!dcPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    setMode('edit');
    setStatus('');
  };

  const handleSave = async () => {
    if (mode === 'new' && !dcPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    if (mode === 'edit' && !dcPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    const fyErr = finYearDateErrorMessage(header.bill_date, fyMinYmd, fyMaxYmd, 'Challan date');
    if (fyErr) {
      setStatus(fyErr);
      return;
    }
    if (!header.code.trim()) {
      setStatus('Party code is required.');
      return;
    }
    if (isReturn && !header.ch_no.trim()) {
      setStatus('Ref. Challan No. is required for DC Return.');
      return;
    }
    const payloadLines = lines
      .filter((ln) => ln.item_code)
      .map((ln, idx) => ({
        trn_no: idx + 1,
        item_code: Number(ln.item_code) || 0,
        so_no: ln.so_no.trim(),
        lot: ln.lot.trim(),
        status: ln.status || 'B',
        b_no: ln.b_no.trim(),
        god_code: ln.god_code.trim(),
        sup_code: ln.sup_code.trim(),
        cost_code: ln.cost_code.trim(),
        marka: ln.marka.trim(),
        qnty: num(ln.qnty),
        packing: num(ln.packing),
        weight: num(ln.weight),
        rate: num(ln.rate),
        amount: num(ln.amount),
        sup_date: ln.sup_date ? toOracleDate(ln.sup_date) : null,
      }));
    if (!payloadLines.length) {
      setStatus('Enter at least one item line.');
      return;
    }
    setBusy(true);
    setStatus('Saving…');
    try {
      const { data } = await axios.post(
        `${apiBase}/api/dispatch-challan`,
        {
          comp_code: compCode,
          comp_year: compYear,
          comp_uid: compUid,
          mode,
          user_name: userName,
          dc_type: docType,
          bill_no: Number(header.bill_no) || 0,
          b_type: header.b_type || 'N',
          bill_date: toOracleDate(header.bill_date),
          v_date: toOracleDate(header.v_date || header.bill_date),
          code: header.code.trim(),
          bk_code: header.bk_code.trim(),
          ch_no: header.ch_no.trim(),
          gr_no: header.gr_no.trim(),
          truck_no: header.truck_no.trim(),
          tpt: header.tpt.trim(),
          form: header.form.trim(),
          remarks: header.remarks.trim(),
          mod_reason: header.mod_reason.trim(),
          lines: payloadLines,
        },
        reqOpts
      );
      setStatus(data.message || 'Saved.');
      await loadChallan(data.bill_no);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!header.bill_no) return;
    if (!dcPerms?.canDelete) {
      setStatus('You Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete ${docLabel.toLowerCase()} ${header.bill_no}?`)) return;
    setBusy(true);
    setStatus('');
    try {
      await axios.delete(`${apiBase}/api/dispatch-challan`, {
        params: {
          ...apiParams,
          dc_type: docType,
          bill_no: header.bill_no,
          b_type: header.b_type || 'N',
        },
        ...reqOpts,
      });
      lineKeyRef.current = 2;
      setHeader(emptyHeader(defaultBillDate));
      setLines([emptyLine(1)]);
      setMode('view');
      setStatus('Deleted.');
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const openList = useCallback(async () => {
    setListOpen(true);
    setListBusy(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan/list`, {
        params: { ...apiParams, dc_type: docType },
        ...reqOpts,
      });
      setListRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'List failed.');
    } finally {
      setListBusy(false);
    }
  }, [apiBase, apiParams, docType]);

  const openPending = useCallback(async () => {
    setPendingOpen(true);
    setPendingBusy(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan/pending`, {
        params: apiParams,
        ...reqOpts,
      });
      setPendingRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Pending report failed.');
    } finally {
      setPendingBusy(false);
    }
  }, [apiBase, apiParams]);

  // VFP G_SORDER_TYPE: 'C' → Cust/Brok field keyed on customers (SUBSTR(CODE,1,1)='C'); else brokers ('B').
  const custBrokPool = useMemo(
    () => (saleOrderType === 'C' ? parties : brokers),
    [saleOrderType, parties, brokers]
  );

  const scheduleFocusAfterHelp = useCallback(
    (fieldKey) => {
      window.setTimeout(() => {
        if (!fieldKey) return;
        if (typeof focusChain.focusAfterHelp === 'function') {
          focusChain.focusAfterHelp(fieldKey);
        } else if (!focusChain.focusNext(fieldKey)) {
          focusChain.focusKey(fieldKey);
        }
      }, 80);
    },
    [focusChain]
  );

  const pickAccount = useCallback(
    (field, code, { closeHelp = false, focusAfter = null, focusFrom = null } = {}) => {
      const c = String(code ?? '').trim().toUpperCase();
      const pool = field === 'bk_code' ? custBrokPool : parties;
      const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
      const name = String(row?.NAME ?? row?.name ?? '').trim();
      if (field === 'code') {
        const city = String(row?.CITY ?? row?.city ?? '').trim();
        setHeader((h) => ({ ...h, code: c, party_name: name, party_city: city }));
      }
      if (field === 'bk_code') setHeader((h) => ({ ...h, bk_code: c, bk_name: name }));
      if (closeHelp) setHelpField(null);
      if (focusAfter) {
        window.setTimeout(() => focusChain.focusKey(focusAfter), 80);
      } else if (focusFrom) {
        scheduleFocusAfterHelp(focusFrom);
      }
    },
    [custBrokPool, parties, focusChain, scheduleFocusAfterHelp]
  );

  const helpAccounts = useMemo(
    () => (helpField === 'bk_code' ? custBrokPool : parties),
    [helpField, custBrokPool, parties]
  );

  const updateLine = useCallback(
    (key, patch) => {
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== key) return ln;
          let next = { ...ln, ...patch };
          if (patch.item_code !== undefined) {
            const raw = String(patch.item_code ?? '').trim();
            const ic = Number(raw) || 0;
            next.item_code = ic ? String(ic) : raw;
            const item = (items || []).find((it) => (Number(it.ITEM_CODE ?? it.item_code) || 0) === ic);
            next.item_name = item
              ? String(item.ITEM_NAME ?? item.item_name ?? '').trim()
              : ic
                ? ''
                : next.item_name;
          }
          if (patch.sup_code !== undefined) {
            const sc = String(patch.sup_code ?? '').trim().toUpperCase();
            const sup = (suppliers || []).find(
              (s) => String(s.CODE ?? s.code ?? '').trim().toUpperCase() === sc
            );
            next.sup_name = sup ? String(sup.NAME ?? sup.name ?? '').trim() : '';
          }
          if (patch.weight !== undefined) next.weight_manual = true;
          if (
            patch.qnty !== undefined ||
            patch.packing !== undefined ||
            patch.weight !== undefined ||
            patch.rate !== undefined ||
            patch.status !== undefined
          ) {
            next = recalcLine(next, wgtKq);
          }
          return next;
        })
      );
    },
    [items, suppliers, wgtKq]
  );

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine(lineKeyRef.current++)]);
  };

  const removeLine = (key) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((ln) => ln.key !== key) : prev));
  };

  const openSalesOrderHelp = useCallback(
    async (lineKey) => {
      const line = lines.find((ln) => ln.key === lineKey);
      const masterCode = header.bk_code.trim();
      if (!masterCode) {
        setStatus(`Select ${saleOrderType === 'C' ? 'customer' : 'broker'} in Cust/Brok before SO.No. help.`);
        return;
      }
      if (!Number(line?.item_code)) {
        setStatus('Select an item before SO.No. help.');
        return;
      }
      setStatus('');
      setSalesOrderHelp({ lineKey, rows: [], loading: true, error: '' });
      try {
        const { data } = await axios.get(`${apiBase}/api/dispatch-challan/sales-order-help`, {
          params: {
            ...apiParams,
            master_code: masterCode,
            item_code: Number(line.item_code),
          },
          ...reqOpts,
        });
        setSalesOrderHelp((prev) =>
          prev?.lineKey === lineKey
            ? { ...prev, rows: Array.isArray(data?.rows) ? data.rows : [], loading: false }
            : prev
        );
      } catch (err) {
        setSalesOrderHelp((prev) =>
          prev?.lineKey === lineKey
            ? {
                ...prev,
                loading: false,
                error: err.response?.data?.error || err.message || 'Sales order help failed.',
              }
            : prev
        );
      }
    },
    [apiBase, apiParams, header.bk_code, lines, saleOrderType]
  );

  const applySalesOrderPick = useCallback(
    (lineKey, row) => {
      updateLine(lineKey, {
        so_no: String(row.so_no ?? '').trim(),
        status: String(row.status ?? 'K').trim() || 'K',
        qnty: num(row.balance_qnty) ? String(row.balance_qnty) : '',
        weight: num(row.balance_weight) ? String(row.balance_weight) : '',
        rate: num(row.rate) ? String(row.rate) : '',
      });
      setSalesOrderHelp(null);
      scheduleFocusAfterHelp(`ln-${lineKey}-sono`);
    },
    [scheduleFocusAfterHelp, updateLine]
  );

  const lotSuppliers = useMemo(() => filterSupplierCodes(suppliers), [suppliers]);

  const lotHelpFiltersRef = useRef({ lineKey: null, sup_code: '', remarks: '' });
  useEffect(() => {
    if (!lotHelp) {
      lotHelpFiltersRef.current = { lineKey: null, sup_code: '', remarks: '' };
      return;
    }
    lotHelpFiltersRef.current = {
      lineKey: lotHelp.lineKey,
      sup_code: String(lotHelp.sup_code ?? '').trim().toUpperCase(),
      remarks: String(lotHelp.remarks ?? '').trim(),
    };
  }, [lotHelp]);

  const openLotHelp = useCallback(
    async (lineKey, filterOverrides = null) => {
      const line = lines.find((ln) => ln.key === lineKey);
      const prev = lotHelpFiltersRef.current.lineKey === lineKey ? lotHelpFiltersRef.current : null;
      const initialSup =
        filterOverrides?.sup_code !== undefined
          ? String(filterOverrides.sup_code ?? '').trim().toUpperCase()
          : prev
            ? String(prev.sup_code ?? '').trim().toUpperCase()
            : String(line?.sup_code ?? '').trim().toUpperCase();
      const initialRemarks =
        filterOverrides?.remarks !== undefined
          ? String(filterOverrides.remarks ?? '').trim()
          : prev
            ? String(prev.remarks ?? '').trim()
            : '';
      lotHelpFiltersRef.current = {
        lineKey,
        sup_code: initialSup,
        remarks: initialRemarks,
      };
      setLotSupHelpOpen(false);
      setLotHelp({
        lineKey,
        remarks: initialRemarks,
        sup_code: initialSup,
        allRows: [],
        rows: [],
        loading: true,
        error: '',
      });
      try {
        const { data } = await axios.get(`${apiBase}/api/dispatch-challan/lot-stock-help`, {
          params: {
            ...apiParams,
            bill_date: toOracleDate(header.bill_date),
            item_code: Number(line?.item_code) || undefined,
            // Pass filters to Oracle so SUP_CODE is applied before GROUP BY (VFP DISPSTK).
            sup_code: initialSup || undefined,
            remarks: initialRemarks || undefined,
          },
          ...reqOpts,
        });
        const allRows = Array.isArray(data?.rows) ? data.rows : [];
        // Server already filtered by exact sup_code / remarks; keep client filter as safety net.
        const rows = filterLotHelpRows(allRows, { remarks: initialRemarks, sup_code: initialSup });
        setLotHelp((prevState) =>
          prevState?.lineKey === lineKey
            ? {
                ...prevState,
                allRows,
                rows,
                remarks: initialRemarks,
                sup_code: initialSup,
                loading: false,
              }
            : prevState
        );
      } catch (err) {
        setLotHelp((prevState) =>
          prevState?.lineKey === lineKey
            ? {
                ...prevState,
                loading: false,
                error: err.response?.data?.error || err.message || 'Lot help failed.',
              }
            : prevState
        );
      }
    },
    [apiBase, apiParams, header.bill_date, lines]
  );

  const applyLotHelpFilters = useCallback((patch) => {
    setLotHelp((prev) => {
      if (!prev) return prev;
      const remarks = patch.remarks !== undefined ? String(patch.remarks ?? '').trim() : prev.remarks;
      const sup_code =
        patch.sup_code !== undefined ? String(patch.sup_code ?? '').trim().toUpperCase() : prev.sup_code;
      const allRows = Array.isArray(prev.allRows) ? prev.allRows : [];
      lotHelpFiltersRef.current = { lineKey: prev.lineKey, remarks, sup_code };
      return {
        ...prev,
        remarks,
        sup_code,
        rows: filterLotHelpRows(allRows, { remarks, sup_code }),
      };
    });
  }, []);

  const refreshLotHelp = useCallback(() => {
    const cur = lotHelpFiltersRef.current;
    if (!cur?.lineKey) return;
    void openLotHelp(cur.lineKey, {
      sup_code: cur.sup_code,
      remarks: cur.remarks,
    });
  }, [openLotHelp]);

  const applyLotPick = useCallback(
    (lineKey, row) => {
      updateLine(lineKey, {
        item_code: String(row.item_code ?? ''),
        item_name: String(row.item_name ?? '').trim(),
        lot: String(row.lot ?? '').trim(),
        status: String(row.status ?? 'B').trim() || 'B',
        b_no: String(row.b_no ?? '').trim(),
        god_code: String(row.god_code ?? '').trim(),
        sup_code: String(row.sup_code ?? '').trim(),
        sup_name: String(row.sup_name ?? '').trim(),
        cost_code: String(row.cost_code ?? '').trim(),
        rate: num(row.rate) ? String(row.rate) : '',
        sup_date: toInputDateString(row.vr_date),
      });
      setLotHelp(null);
      // After lot help, jump to Marka (VFP dcadd flow).
      window.setTimeout(() => focusChain.focusKey(`ln-${lineKey}-marka`), 80);
    },
    [focusChain, updateLine]
  );

  const openHelpForField = useCallback((helpType, lineKey) => {
    switch (helpType) {
      case 'party':
        setHelpField('code');
        break;
      case 'broker':
        setHelpField('bk_code');
        break;
      case 'item':
        setItemHelpLine(lineKey ?? null);
        break;
      case 'supplier':
        setSupHelpLine(lineKey ?? null);
        break;
      case 'marka':
        setMarkaHelpLine(lineKey ?? null);
        break;
      case 'lot':
        if (lineKey != null) void openLotHelp(lineKey);
        break;
      case 'sales-order':
        if (lineKey != null) void openSalesOrderHelp(lineKey);
        break;
      default:
        break;
    }
  }, [openLotHelp, openSalesOrderHelp]);

  const handleFieldKeyDown = useCallback(
    (fieldKey, e, helpType, helpCtx) => {
      if (e.key === 'F1' || e.keyCode === 112) {
        e.preventDefault();
        e.stopPropagation();
        if (helpType) openHelpForField(helpType, helpCtx?.lineKey);
        return;
      }
      focusChain.onEnter(fieldKey)(e);
    },
    [focusChain, openHelpForField]
  );

  const helpTitle =
    helpField === 'bk_code'
      ? saleOrderType === 'C'
        ? 'Customer help'
        : 'Broker help'
      : 'Party help';

  return (
    <div className="voucher-entry-form purchase-order-form sales-order-form dispatch-challan-form">
      {permLoading ? <p className="voucher-entry-form__status">Loading permissions…</p> : null}
      {!permLoading && !dcPerms?.canOpen ? (
        <div className="purchase-order-form__denied">
          <p className="deploy-update-msg deploy-update-msg--err">{permErr || 'Access Denied (DCHALAN / F11).'}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Close
          </button>
        </div>
      ) : null}
      {!permLoading && dcPerms?.canOpen ? (
        <>
          <div className="purchase-order-form__toolbar-row">
            <div className="voucher-entry-form__toolbar voucher-entry-form__toolbar--vfp purchase-order-form__toolbar">
              <button type="button" className="btn btn-sm" onClick={startNew} disabled={busy || !dcPerms?.canAdd}>
                New
              </button>
              <button type="button" className="btn btn-sm" onClick={startEdit} disabled={busy || !header.bill_no || !dcPerms?.canEdit}>
                Edit
              </button>
              <button type="button" className="btn btn-sm" onClick={handleDelete} disabled={busy || !header.bill_no || !dcPerms?.canDelete}>
                Delete
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={!canSave}>
                Save
              </button>
              <button type="button" className="btn btn-sm voucher-entry-form__list-btn" onClick={openList} disabled={busy}>
                List
              </button>
              <button type="button" className="btn btn-sm" onClick={openPending} disabled={busy}>
                Pending
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPrintOpen(true)} disabled={busy || !header.bill_no}>
                Print
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setChecklistOpen(true)} disabled={busy}>
                ChkList
              </button>
              <button type="button" className="btn btn-sm" onClick={onBack} disabled={busy}>
                Close
              </button>
              {mode !== 'view' && (
                <span className={`voucher-entry-form__mode voucher-entry-form__mode--${mode}`}>
                  {mode === 'new' ? 'New' : 'Edit'}
                </span>
              )}
            </div>
            <ModuleRightsPanel variant="iconsOnly" perms={dcPerms} className="purchase-bill-form__perms" />
          </div>

          <div className="voucher-entry-form__header voucher-entry-form__header--vfp purchase-order-form__header">
            <label className="voucher-entry-form__field voucher-entry-form__field--no">
              <span className="voucher-entry-form__label">Challan No.</span>
              <input className="voucher-entry-form__input voucher-entry-form__input--ro" readOnly value={header.bill_no} />
            </label>
            <label className="voucher-entry-form__field dispatch-challan-form__btype">
              <span className="voucher-entry-form__label">B.Type</span>
              <input
                className="voucher-entry-form__input"
                value={header.b_type}
                disabled={!editable}
                maxLength={1}
                ref={(el) => focusChain.register('hdr-btype', el)}
                onKeyDown={focusChain.onEnter('hdr-btype')}
                onChange={(e) =>
                  setHeader((h) => ({
                    ...h,
                    b_type: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 1) || 'N',
                  }))
                }
              />
            </label>
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">Date</span>
              <VoucherDmyDateInput
                className="voucher-entry-form__input voucher-entry-form__input--date"
                valueYmd={header.bill_date}
                minYmd={fyMinYmd}
                maxYmd={fyMaxYmd}
                disabled={!editable}
                title={fyMinYmd && fyMaxYmd ? `dd/mm/yyyy · FY ${fyRangeLabel}` : 'dd/mm/yyyy'}
                inputRef={(el) => focusChain.register('hdr-bill-date', el)}
                onChangeYmd={(v) => setHeader((h) => ({ ...h, bill_date: v, v_date: v }))}
                onKeyDown={focusChain.onEnter('hdr-bill-date')}
              />
            </label>
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">Value Date</span>
              <VoucherDmyDateInput
                className="voucher-entry-form__input voucher-entry-form__input--date"
                valueYmd={header.v_date}
                minYmd={fyMinYmd}
                maxYmd={fyMaxYmd}
                disabled={!editable}
                title="dd/mm/yyyy"
                inputRef={(el) => focusChain.register('hdr-v-date', el)}
                onChangeYmd={(v) => setHeader((h) => ({ ...h, v_date: v }))}
                onKeyDown={focusChain.onEnter('hdr-v-date')}
              />
            </label>
            <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
              <span className="voucher-entry-form__label">{isReturn ? 'Ref. Challan No.' : 'Ch. No. (auto)'}</span>
              <input
                className="voucher-entry-form__input voucher-entry-form__num"
                value={isReturn ? header.ch_no : header.ch_no || header.bill_no}
                disabled={!isReturn || !editable}
                ref={(el) => focusChain.register('hdr-chno', el)}
                onKeyDown={focusChain.onEnter('hdr-chno')}
                onChange={(e) => setHeader((h) => ({ ...h, ch_no: e.target.value.replace(/\D/g, '') }))}
                title={isReturn ? 'Dispatch challan number being returned against' : 'VFP: CH_NO = challan number (disabled for DC)'}
              />
            </label>

            <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row purchase-order-form__party-row--broker">
              <div className="purchase-order-form__label-row">
                <span className="voucher-entry-form__label">Cust/Brok</span>
              </div>
              <div className="voucher-entry-form__code-help">
                <input
                  className="voucher-entry-form__input voucher-entry-form__code"
                  value={header.bk_code}
                  disabled={!editable}
                  ref={(el) => focusChain.register('hdr-bk', el)}
                  onKeyDown={(e) => handleFieldKeyDown('hdr-bk', e, 'broker')}
                  onChange={(e) => setHeader((h) => ({ ...h, bk_code: e.target.value.toUpperCase() }))}
                  onBlur={() => pickAccount('bk_code', header.bk_code)}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={!editable}
                  onClick={() => setHelpField('bk_code')}
                  title="Cust/Brok help (F1)"
                >
                  🔍
                </button>
                <input className="voucher-entry-form__input voucher-entry-form__name" readOnly tabIndex={-1} value={header.bk_name} />
              </div>
            </div>

            <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row sales-order-form__party-row--party">
              <div className="purchase-order-form__label-row">
                <span className="voucher-entry-form__label">Customer</span>
              </div>
              <div className="voucher-entry-form__code-help">
                <input
                  className="voucher-entry-form__input voucher-entry-form__code"
                  value={header.code}
                  disabled={!editable}
                  ref={(el) => focusChain.register('hdr-code', el)}
                  onKeyDown={(e) => handleFieldKeyDown('hdr-code', e, 'party')}
                  onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
                  onBlur={() => pickAccount('code', header.code)}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={!editable}
                  onClick={() => setHelpField('code')}
                  title="Customer help (F1)"
                >
                  🔍
                </button>
                <input
                  className="voucher-entry-form__input voucher-entry-form__name dispatch-challan-form__customer-name"
                  readOnly
                  tabIndex={-1}
                  value={header.party_name}
                />
              </div>
            </div>

            <label className="voucher-entry-form__field dispatch-challan-form__place">
              <span className="voucher-entry-form__label">Place</span>
              <input
                className="voucher-entry-form__input voucher-entry-form__input--ro"
                readOnly
                tabIndex={-1}
                value={header.party_city}
                title="Place (party city)"
                placeholder="Place"
              />
            </label>
          </div>

          <div className="voucher-entry-form__grid-wrap">
            <table className="voucher-entry-form__grid voucher-entry-form__grid--vfp purchase-order-form__grid">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item</th>
                  <th>Item Name</th>
                  <th>So.No.</th>
                  <th>Lot</th>
                  <th>B/K/H</th>
                  <th>B.No.</th>
                  <th>God.</th>
                  <th>SupCode</th>
                  <th>SupplierName</th>
                  <th>Marka</th>
                  <th>Qty</th>
                  <th>Pkg.</th>
                  <th>Weight</th>
                  <th>Rate</th>
                  <th>Amount</th>
                  <th>Val.Date</th>
                  <th>Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, idx) => (
                  <tr key={ln.key}>
                    <td className="voucher-entry-form__sno">{idx + 1}</td>
                    <td>
                      <div className="voucher-entry-form__code-help">
                        <input
                          className="voucher-entry-form__cell voucher-entry-form__code"
                          value={ln.item_code}
                          disabled={!editable}
                          inputMode="numeric"
                          title="Item code (numeric)"
                          ref={(el) => focusChain.register(`ln-${ln.key}-item`, el)}
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-item`, e, 'item', { lineKey: ln.key })}
                          onChange={(e) =>
                            updateLine(ln.key, { item_code: e.target.value.replace(/[^\d]/g, '') })
                          }
                          onBlur={() => {
                            if (ln.item_code) updateLine(ln.key, { item_code: ln.item_code });
                          }}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={!editable}
                          onClick={() => setItemHelpLine(ln.key)}
                          title="Item help (F1)"
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td className="voucher-entry-form__name dispatch-challan-form__item-name">{ln.item_name}</td>
                    <td>
                      <div className="voucher-entry-form__code-help dispatch-challan-form__so-help">
                        <input
                          className="voucher-entry-form__cell"
                          style={{ width: 64 }}
                          value={ln.so_no}
                          disabled={!editable}
                          ref={(el) => focusChain.register(`ln-${ln.key}-sono`, el)}
                          onKeyDown={(e) =>
                            handleFieldKeyDown(`ln-${ln.key}-sono`, e, 'sales-order', {
                              lineKey: ln.key,
                            })
                          }
                          onChange={(e) => updateLine(ln.key, { so_no: e.target.value })}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={!editable}
                          onClick={() => openSalesOrderHelp(ln.key)}
                          title="Pending sales order help (F1)"
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="voucher-entry-form__code-help dispatch-challan-form__lot-help">
                        <input
                          className="voucher-entry-form__cell"
                          style={{ width: 72 }}
                          value={ln.lot}
                          disabled={!editable}
                          ref={(el) => focusChain.register(`ln-${ln.key}-lot`, el)}
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-lot`, e, 'lot', { lineKey: ln.key })}
                          onChange={(e) => updateLine(ln.key, { lot: e.target.value.toUpperCase() })}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={!editable}
                          onClick={() => openLotHelp(ln.key)}
                          title="Display stock / lot help (F1)"
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <select
                        className="voucher-entry-form__cell voucher-entry-form__cell--type"
                        value={ln.status}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-status`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-status`)}
                        onChange={(e) => updateLine(ln.key, { status: e.target.value })}
                      >
                        {BKH_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="voucher-entry-form__cell"
                        style={{ width: 56 }}
                        value={ln.b_no}
                        disabled={!editable}
                        title="Bikri No."
                        ref={(el) => focusChain.register(`ln-${ln.key}-bno`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-bno`)}
                        onChange={(e) => updateLine(ln.key, { b_no: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td>
                      <select
                        className="voucher-entry-form__cell"
                        style={{ width: 72 }}
                        value={ln.god_code}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-god`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-god`)}
                        onChange={(e) => updateLine(ln.key, { god_code: e.target.value })}
                      >
                        <option value="" />
                        {(godowns || []).map((g) => {
                          const gc = String(g.GOD_CODE ?? g.god_code ?? '').trim();
                          return (
                            <option key={gc} value={gc}>
                              {gc}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td>
                      <div className="voucher-entry-form__code-help">
                        <input
                          className="voucher-entry-form__cell voucher-entry-form__code"
                          style={{ width: 76 }}
                          value={ln.sup_code}
                          disabled={!editable}
                          title="Supplier code"
                          ref={(el) => focusChain.register(`ln-${ln.key}-sup`, el)}
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-sup`, e, 'supplier', { lineKey: ln.key })}
                          onChange={(e) => updateLine(ln.key, { sup_code: e.target.value.toUpperCase() })}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={!editable}
                          onClick={() => setSupHelpLine(ln.key)}
                          title="Supplier help (F1)"
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td className="voucher-entry-form__name dispatch-challan-form__supplier-name">{ln.sup_name}</td>
                    <td>
                      <div className="voucher-entry-form__code-help">
                        <input
                          className="voucher-entry-form__cell"
                          style={{ width: 130 }}
                          value={ln.marka}
                          disabled={!editable}
                          title="Marka"
                          ref={(el) => focusChain.register(`ln-${ln.key}-marka`, el)}
                          onKeyDown={(e) =>
                            handleFieldKeyDown(`ln-${ln.key}-marka`, e, 'marka', { lineKey: ln.key })
                          }
                          onChange={(e) => updateLine(ln.key, { marka: e.target.value.toUpperCase() })}
                        />
                        <button
                          type="button"
                          className="voucher-entry-form__code-help-btn"
                          disabled={!editable}
                          onClick={() => setMarkaHelpLine(ln.key)}
                          title="Marka help (F1)"
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <input
                        className="voucher-entry-form__cell voucher-entry-form__num"
                        value={ln.qnty}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-qnty`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-qnty`)}
                        onChange={(e) => updateLine(ln.key, { qnty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="voucher-entry-form__cell voucher-entry-form__num"
                        style={{ width: 56 }}
                        value={ln.packing}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-pkg`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-pkg`)}
                        onChange={(e) => updateLine(ln.key, { packing: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="voucher-entry-form__cell voucher-entry-form__num"
                        style={{ width: 100 }}
                        value={ln.weight}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-weight`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-weight`)}
                        onChange={(e) => updateLine(ln.key, { weight: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="voucher-entry-form__cell voucher-entry-form__num"
                        style={{ width: 100 }}
                        value={ln.rate}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-rate`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-rate`)}
                        onChange={(e) => updateLine(ln.key, { rate: e.target.value })}
                      />
                    </td>
                    <td
                      className="voucher-entry-form__num voucher-entry-form__name"
                      style={{ minWidth: 120 }}
                    >
                      {num(ln.amount) ? fmtAmt(ln.amount) : ''}
                    </td>
                    <td>
                      <VoucherDmyDateInput
                        className="voucher-entry-form__cell voucher-entry-form__input--date"
                        valueYmd={ln.sup_date}
                        disabled={!editable}
                        title="Val.Date (defaults to challan date)"
                        inputRef={(el) => focusChain.register(`ln-${ln.key}-valdate`, el)}
                        onChangeYmd={(v) => updateLine(ln.key, { sup_date: v })}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-valdate`)}
                      />
                    </td>
                    <td>
                      <select
                        className="voucher-entry-form__cell"
                        style={{ width: 72 }}
                        value={ln.cost_code}
                        disabled={!editable}
                        title="Cost centre"
                        ref={(el) => focusChain.register(`ln-${ln.key}-cost`, el)}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-cost`)}
                        onChange={(e) => updateLine(ln.key, { cost_code: e.target.value })}
                      >
                        <option value="" />
                        {(costs || []).map((c) => (
                          <option key={c.cost_code} value={c.cost_code}>
                            {c.cost_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {editable ? (
                        <button
                          type="button"
                          className="voucher-entry-form__row-del"
                          onClick={() => removeLine(ln.key)}
                          title="Remove line"
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={11} style={{ textAlign: 'right', fontWeight: 700 }}>
                    Total
                  </td>
                  <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                    {totals.qnty || ''}
                  </td>
                  <td />
                  <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                    {fmtWgt(totals.weight)}
                  </td>
                  <td />
                  <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                    {fmtAmt(totals.amount)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
          {editable ? (
            <button type="button" className="btn btn-sm" onClick={addLine} style={{ margin: '4px 0' }}>
              + Add Line
            </button>
          ) : null}

          <div className="voucher-entry-form__header voucher-entry-form__header--vfp purchase-order-form__header">
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">G.R. No.</span>
              <input
                className="voucher-entry-form__input"
                value={header.gr_no}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-grno', el)}
                onKeyDown={focusChain.onEnter('ft-grno')}
                onChange={(e) => setHeader((h) => ({ ...h, gr_no: e.target.value }))}
              />
            </label>
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">Truck No.</span>
              <input
                className="voucher-entry-form__input"
                value={header.truck_no}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-truck', el)}
                onKeyDown={focusChain.onEnter('ft-truck')}
                onChange={(e) => setHeader((h) => ({ ...h, truck_no: e.target.value.toUpperCase() }))}
              />
            </label>
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">Transport</span>
              <input
                className="voucher-entry-form__input"
                value={header.tpt}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-tpt', el)}
                onKeyDown={focusChain.onEnter('ft-tpt')}
                onChange={(e) => setHeader((h) => ({ ...h, tpt: e.target.value }))}
              />
            </label>
            <label className="voucher-entry-form__field">
              <span className="voucher-entry-form__label">Form</span>
              <input
                className="voucher-entry-form__input"
                value={header.form}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-form', el)}
                onKeyDown={focusChain.onEnter('ft-form')}
                onChange={(e) => setHeader((h) => ({ ...h, form: e.target.value }))}
              />
            </label>
            <label className="voucher-entry-form__field voucher-entry-form__field--cash-name">
              <span className="voucher-entry-form__label">Remarks</span>
              <input
                className="voucher-entry-form__input"
                value={header.remarks}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-remarks', el)}
                onKeyDown={focusChain.onEnter('ft-remarks')}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
              />
            </label>
            {mode === 'edit' ? (
              <label className="voucher-entry-form__field voucher-entry-form__field--cash-name">
                <span className="voucher-entry-form__label">Mod. Reason</span>
                <input
                  className="voucher-entry-form__input"
                  value={header.mod_reason}
                  disabled={!editable}
                  onChange={(e) => setHeader((h) => ({ ...h, mod_reason: e.target.value }))}
                />
              </label>
            ) : null}
          </div>

          {status ? <p className="voucher-entry-form__status">{status}</p> : null}

          <VoucherAccountHelpModal
            open={Boolean(helpField)}
            title={helpTitle}
            accounts={helpAccounts}
            onSelect={(code) => {
              const firstLineKey = lines[0]?.key;
              if (helpField === 'bk_code') {
                pickAccount(helpField, code, { closeHelp: true, focusAfter: 'hdr-code' });
              } else {
                pickAccount(helpField, code, {
                  closeHelp: true,
                  focusAfter: firstLineKey != null ? `ln-${firstLineKey}-item` : null,
                  focusFrom: 'hdr-code',
                });
              }
            }}
            onClose={() => setHelpField(null)}
          />
          <VoucherAccountHelpModal
            open={supHelpLine != null}
            title="Supplier help"
            accounts={suppliers}
            onSelect={(code) => {
              const lineKey = supHelpLine;
              if (lineKey != null) {
                updateLine(lineKey, { sup_code: String(code ?? '').trim().toUpperCase() });
              }
              setSupHelpLine(null);
              if (lineKey != null) scheduleFocusAfterHelp(`ln-${lineKey}-sup`);
            }}
            onClose={() => setSupHelpLine(null)}
          />
          <VoucherItemHelpModal
            open={itemHelpLine != null}
            title="Item help"
            items={items}
            onSelect={(row) => {
              const lineKey = itemHelpLine;
              if (lineKey != null) {
                const code = Number(row?.item_code ?? row?.ITEM_CODE ?? row) || 0;
                updateLine(lineKey, {
                  item_code: code ? String(code) : '',
                  item_name: String(row?.item_name ?? row?.ITEM_NAME ?? '').trim(),
                });
              }
              setItemHelpLine(null);
              if (lineKey != null) scheduleFocusAfterHelp(`ln-${lineKey}-item`);
            }}
            onClose={() => setItemHelpLine(null)}
          />
          <VoucherGridHelpModal
            open={markaHelpLine != null}
            title="Marka help"
            hint="SELECT MARKA FROM MARKA · type to search · Enter picks"
            columns={MARKA_HELP_COLUMNS}
            rows={markas}
            searchPlaceholder="Search marka…"
            onSelect={(row) => {
              const lineKey = markaHelpLine;
              const value = String(row?.marka ?? row?.MARKA ?? '').trim().toUpperCase();
              if (lineKey != null) updateLine(lineKey, { marka: value });
              setMarkaHelpLine(null);
              if (lineKey != null) scheduleFocusAfterHelp(`ln-${lineKey}-marka`);
            }}
            onClose={() => setMarkaHelpLine(null)}
          />
          <VoucherGridHelpModal
            open={Boolean(lotHelp)}
            title="Disp.Stock — LOTSTOCK"
            hint="Filter by SupCode (S…) or God.Lot Remark · Refresh reloads stock · Enter picks"
            columns={LOT_STOCK_HELP_COLUMNS}
            rows={lotHelp?.rows || []}
            loading={lotHelp?.loading}
            error={lotHelp?.error}
            searchPlaceholder="Search B.No., supplier, item, lot or godown…"
            toolbar={
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '0.45rem 0.75rem',
                  padding: '0.35rem 0.75rem 0.55rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#475569',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>SupCode</span>
                  <input
                    type="text"
                    className="form-input"
                    style={{ minHeight: '1.75rem', width: '6.5rem', fontSize: '0.8rem' }}
                    maxLength={10}
                    value={lotHelp?.sup_code ?? ''}
                    placeholder="S…"
                    onChange={(e) => applyLotHelpFilters({ sup_code: e.target.value.toUpperCase() })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        refreshLotHelp();
                      }
                    }}
                    title="Supplier code — SUBSTR(CODE,1,1)='S' · Enter refreshes"
                  />
                  <button
                    type="button"
                    className="voucher-entry-form__code-help-btn"
                    onClick={() => setLotSupHelpOpen(true)}
                    title="Supplier help (S codes only)"
                  >
                    🔍
                  </button>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>God.Lot Remark</span>
                  <input
                    type="text"
                    className="form-input"
                    style={{ minHeight: '1.75rem', maxWidth: '12rem', fontSize: '0.8rem' }}
                    maxLength={10}
                    value={lotHelp?.remarks ?? ''}
                    placeholder="Filter by lot remarks…"
                    onChange={(e) => applyLotHelpFilters({ remarks: e.target.value.toUpperCase() })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        refreshLotHelp();
                      }
                    }}
                    title="VFP GREM — show only lots whose remarks contain this text · Enter refreshes"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={refreshLotHelp}
                  disabled={Boolean(lotHelp?.loading)}
                  title="Reload Disp.Stock for current SupCode / God.Lot Remark"
                  style={{ minHeight: '1.75rem', fontSize: '0.75rem', padding: '0.2rem 0.65rem' }}
                >
                  {lotHelp?.loading ? 'Refreshing…' : 'Refresh'}
                </button>
                {(lotHelp?.remarks || lotHelp?.sup_code) && !lotHelp?.loading ? (
                  <span style={{ fontWeight: 500, color: '#64748b' }}>
                    Showing {(lotHelp?.rows || []).length}
                    {(lotHelp?.allRows || []).length !== (lotHelp?.rows || []).length
                      ? ` of ${(lotHelp?.allRows || []).length}`
                      : ''}{' '}
                    (filtered)
                  </span>
                ) : null}
              </div>
            }
            onSelect={(row) => {
              if (lotHelp?.lineKey != null) applyLotPick(lotHelp.lineKey, row);
            }}
            onClose={() => {
              setLotSupHelpOpen(false);
              setLotHelp(null);
            }}
          />
          <VoucherAccountHelpModal
            open={Boolean(lotHelp) && lotSupHelpOpen}
            title="Supplier help (S codes)"
            accounts={lotSuppliers}
            onSelect={(code) => {
              const sup = String(code ?? '').trim().toUpperCase();
              setLotSupHelpOpen(false);
              // Reload Disp.Stock from server for the chosen supplier (VFP DISPSTK + SCODE).
              if (lotHelp?.lineKey != null) {
                void openLotHelp(lotHelp.lineKey, {
                  sup_code: sup,
                  remarks: lotHelp.remarks ?? '',
                });
              } else {
                applyLotHelpFilters({ sup_code: sup });
              }
            }}
            onClose={() => setLotSupHelpOpen(false)}
          />
          <VoucherGridHelpModal
            open={Boolean(salesOrderHelp)}
            title="Pending Sales Order — SO.No. Help"
            hint={`${saleOrderType === 'C' ? 'Customer' : 'Broker'} ${
              header.bk_code
            } · pending balance after DC/DR · Enter picks`}
            columns={SALES_ORDER_HELP_COLUMNS}
            rows={salesOrderHelp?.rows || []}
            loading={salesOrderHelp?.loading}
            error={salesOrderHelp?.error}
            searchPlaceholder="Search SO.No., date, status or rate…"
            onSelect={(row) => {
              if (salesOrderHelp?.lineKey != null) {
                applySalesOrderPick(salesOrderHelp.lineKey, row);
              }
            }}
            onClose={() => setSalesOrderHelp(null)}
          />

          {/* List modal */}
          {listOpen ? (
            <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={`${docLabel} list`}>
              <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={() => setListOpen(false)} />
              <div className="voucher-help-modal__panel voucher-help-modal__panel--account">
                <header className="voucher-help-modal__head">
                  <h3 className="voucher-help-modal__title">{docLabel} — List</h3>
                  <button type="button" className="voucher-help-modal__close" onClick={() => setListOpen(false)} aria-label="Close">
                    ✕
                  </button>
                </header>
                <div style={{ maxHeight: '60vh', overflow: 'auto', padding: '0 10px 10px' }}>
                  {listBusy ? <p>Loading…</p> : null}
                  <table className="voucher-entry-form__grid" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Date</th>
                        <th>Party</th>
                        <th>Ch.No.</th>
                        <th>Truck</th>
                        <th>Qnty</th>
                        <th>Weight</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listRows.map((r) => (
                        <tr
                          key={`${r.bill_no}-${r.bill_date}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            setListOpen(false);
                            loadChallan(r.bill_no);
                          }}
                        >
                          <td className="voucher-entry-form__num">{r.bill_no}</td>
                          <td>{r.bill_date}</td>
                          <td>{r.party_name}</td>
                          <td className="voucher-entry-form__num">{r.ch_no}</td>
                          <td>{r.truck_no}</td>
                          <td className="voucher-entry-form__num">{r.tot_qnty || ''}</td>
                          <td className="voucher-entry-form__num">{fmtWgt(r.tot_weight)}</td>
                          <td className="voucher-entry-form__num">{fmtAmt(r.tot_amt)}</td>
                        </tr>
                      ))}
                      {!listBusy && !listRows.length ? (
                        <tr>
                          <td colSpan={8}>No records.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {/* Pending modal */}
          {pendingOpen ? (
            <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Pending dispatch challan">
              <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={() => setPendingOpen(false)} />
              <div className="voucher-help-modal__panel voucher-help-modal__panel--account">
                <header className="voucher-help-modal__head">
                  <h3 className="voucher-help-modal__title">Pending Dispatch Challan</h3>
                  <button type="button" className="voucher-help-modal__close" onClick={() => setPendingOpen(false)} aria-label="Close">
                    ✕
                  </button>
                </header>
                <div style={{ maxHeight: '60vh', overflow: 'auto', padding: '0 10px 10px' }}>
                  {pendingBusy ? <p>Loading…</p> : null}
                  <table className="voucher-entry-form__grid" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Ch.No.</th>
                        <th>Party</th>
                        <th>Item</th>
                        <th>Lot</th>
                        <th>BKH</th>
                        <th>DC Qty</th>
                        <th>Adj Qty</th>
                        <th>Bal Qty</th>
                        <th>Bal Wgt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRows.map((r, i) => (
                        <tr key={i}>
                          <td className="voucher-entry-form__num">{r.ch_no}</td>
                          <td>{r.party_name}</td>
                          <td>{r.item_name}</td>
                          <td>{r.lot}</td>
                          <td>{r.status}</td>
                          <td className="voucher-entry-form__num">{r.dc_qnty || ''}</td>
                          <td className="voucher-entry-form__num">{r.oth_qnty || ''}</td>
                          <td className="voucher-entry-form__num">{r.bal_qnty || ''}</td>
                          <td className="voucher-entry-form__num">{fmtWgt(r.bal_weight)}</td>
                        </tr>
                      ))}
                      {!pendingBusy && !pendingRows.length ? (
                        <tr>
                          <td colSpan={9}>No pending challans.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          <DispatchChallanPrintModal
            open={printOpen}
            onClose={() => setPrintOpen(false)}
            apiBase={apiBase}
            apiParams={apiParams}
            formData={formData}
            userName={userName}
            dcType={docType}
            header={header}
            lines={lines}
            totals={totals}
          />
          <DispatchChallanChecklistModal
            open={checklistOpen}
            onClose={() => setChecklistOpen(false)}
            apiBase={apiBase}
            apiParams={apiParams}
            fyMinYmd={fyMinYmd}
            fyMaxYmd={fyMaxYmd}
            formData={formData}
            userName={userName}
            dcType={docType}
            parties={parties}
            brokers={brokers}
            suppliers={suppliers}
            items={items}
            onSelect={({ bill_no }) => {
              setChecklistOpen(false);
              if (bill_no) void loadChallan(bill_no);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
