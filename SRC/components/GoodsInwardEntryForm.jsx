import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import GoodsInwardListModal from './GoodsInwardListModal';
import GoodsInwardPrintModal from './GoodsInwardPrintModal';
import GoodsInwardChecklistModal from './GoodsInwardChecklistModal';
import MasterPartyCreateModal, { PartyAddButton } from './MasterPartyCreateModal';
import GodownFormModal from './GodownFormModal';
import { formatLedgerDateDisplay, toInputDateString, toOracleDateFromAny } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  finYearRangeLabel,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import '../styles/voucherEntryForm.css';
import '../styles/purchaseOrderForm.css';
import '../styles/goodsInwardForm.css';

const BKH_OPTIONS = ['B', 'K', 'H'];
const PARTY_SCHEDULE = 11.1;
const BROKER_SCHEDULE = 11.2;
const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];
const COST_HELP_COLUMNS = [
  { key: 'cost_code', label: 'Code' },
  { key: 'cost_name', label: 'Name' },
];

const GRID_FIELD_LIMITS = {
  poNo: { maxLen: 6, maxVal: 999999 },
  itemCode: { maxLen: 10 },
  bardItemCode: { maxLen: 10 },
  packing: { maxLen: 3, maxVal: 999 },
  qnty: { maxLen: 8, maxVal: 99999999 },
};

const reqOpts = { withCredentials: true, timeout: 120000 };

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function digitsOnly(value, { maxLen, maxVal } = {}) {
  let v = String(value ?? '').replace(/\D/g, '');
  if (maxLen != null) v = v.slice(0, maxLen);
  if (maxVal != null && v !== '' && Number(v) > maxVal) v = String(maxVal);
  return v;
}

function fmtAmt(v, dec = 2) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function calcNetWeight(gWeight, dWeight) {
  return Math.max(0, Math.round((num(gWeight) - num(dWeight)) * 1000) / 1000);
}

function calcLineAmount(weight, rate) {
  return Math.round(num(weight) * num(rate) * 100) / 100;
}

function emptyLine(key = 1) {
  return {
    key,
    po_no: '',
    item_code: '',
    item_name: '',
    bard_item_code: '',
    bard_item_name: '',
    status: 'B',
    packing: '',
    qnty: '',
    g_weight: '',
    d_weight: '',
    weight: '',
    rate: '',
    amount: '',
    cost_code: '',
  };
}

function recalcLine(line) {
  const weight = calcNetWeight(line.g_weight, line.d_weight);
  const amount = calcLineAmount(weight, line.rate);
  return {
    ...line,
    weight: weight ? String(weight) : '',
    amount: amount ? String(amount) : '',
  };
}

function emptyHeader(billDate = '') {
  return {
    bill_no: '',
    bill_date: billDate,
    code: '',
    party_name: '',
    party_city: '',
    bk_code: '',
    bk_name: '',
    god_code: '',
    god_name: '',
    truck_no: '',
    dk_weight: '',
    dk_weight_empty: '',
    dk_weight_net: '',
    bill_weight: '',
    gr_no: '',
    tpt: '',
    time_in: '',
    time_out: '',
    remarks: '',
  };
}

export default function GoodsInwardEntryForm({ apiBase, formData, userName, onBack }) {
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

  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultBillDate));
  const [lines, setLines] = useState(() => [emptyLine(1), emptyLine(2)]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [purAccounts, setPurAccounts] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [costCentres, setCostCentres] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [inwardPerms, setInwardPerms] = useState(null);
  const [partyPerms, setPartyPerms] = useState(null);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const [helpField, setHelpField] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [bardHelpLine, setBardHelpLine] = useState(null);
  const [costHelpLine, setCostHelpLine] = useState(null);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [partyAddOpen, setPartyAddOpen] = useState(false);
  const [brokerAddOpen, setBrokerAddOpen] = useState(false);
  const [godownAddOpen, setGodownAddOpen] = useState(false);
  const [inwardCtx, setInwardCtx] = useState({ sale_order_type: 'N', order_qw: 'W' });
  const [poHelpOpen, setPoHelpOpen] = useState(false);
  const [poHelpLine, setPoHelpLine] = useState(null);
  const [poHelpRows, setPoHelpRows] = useState([]);
  const [poHelpLoading, setPoHelpLoading] = useState(false);
  const [poHelpError, setPoHelpError] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  const lineKeyRef = useRef(3);
  const billNoInputRef = useRef(null);
  const newBtnRef = useRef(null);
  const didAutoNewRef = useRef(false);
  const godownHelpSuppressRef = useRef(0);
  const godownHelpOpenRef = useRef(false);

  const apiParams = useMemo(
    () => ({
      comp_code: compCode,
      comp_uid: compUid,
      user_name: userName,
    }),
    [compCode, compUid, userName]
  );

  const focusOrder = useMemo(() => {
    const keys = ['hdr-bill-no', 'hdr-date', 'hdr-code', 'hdr-bk', 'hdr-god'];
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-po`,
        `ln-${ln.key}-item`,
        `ln-${ln.key}-bard`,
        `ln-${ln.key}-status`,
        `ln-${ln.key}-pkg`,
        `ln-${ln.key}-qnty`,
        `ln-${ln.key}-gwgt`,
        `ln-${ln.key}-dwgt`,
        `ln-${ln.key}-rate`,
        `ln-${ln.key}-cost`
      );
    }
    keys.push('ft-truck', 'ft-dk', 'ft-dk-empty', 'ft-bill-wgt', 'ft-gr', 'ft-tpt', 'ft-time-in', 'ft-time-out', 'ft-remarks');
    return keys;
  }, [lines]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  useEffect(() => {
    if (!defaultBillDate) return;
    setHeader((h) => {
      if (h.bill_no) return h;
      if (h.bill_date) return h;
      return { ...h, bill_date: defaultBillDate };
    });
  }, [defaultBillDate]);

  useEffect(() => {
    if (!inwardPerms) return;
    if (mode === 'new' && !inwardPerms.canAdd) {
      setMode('view');
      setStatus('You Can Not Add');
    } else if (mode === 'edit' && !inwardPerms.canEdit) {
      setMode('view');
      setStatus('You Can Not Edit');
    }
  }, [mode, inwardPerms]);

  const editable =
    (mode === 'new' && Boolean(inwardPerms?.canAdd)) || (mode === 'edit' && Boolean(inwardPerms?.canEdit));
  const canSave =
    editable && !busy && ((mode === 'new' && inwardPerms?.canAdd) || (mode === 'edit' && inwardPerms?.canEdit));

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
    return { qnty, weight, amount };
  }, [lines]);

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

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      const permRes = await axios.get(`${apiBase}/api/goods-inward/user-permissions`, {
        params: { user_name: userName },
        ...reqOpts,
      });
      const perms = permRes.data || {};
      setInwardPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, costRes, purRes, brokerRes, godRes, partyPermRes] = await Promise.all([
        axios.get(`${apiBase}/api/goods-inward/context`, { params: { ...params, user_name: userName } }),
        axios.get(`${apiBase}/api/purchaselist-items`, { params }),
        axios.get(`${apiBase}/api/goods-inward/cost-help`, { params: { ...params, user_name: userName } }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        }),
      ]);
      const ctx = ctxRes.data || {};
      setInwardCtx({
        sale_order_type: String(ctx.sale_order_type ?? 'N').trim().toUpperCase(),
        order_qw: String(ctx.order_qw ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W',
      });
      setItems(itemsRes.data || []);
      setCostCentres(Array.isArray(costRes.data?.rows) ? costRes.data.rows : costRes.data || []);
      setPurAccounts(purRes.data || []);
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      setPartyPerms(partyPermRes.data || null);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Could not load goods inward.';
      setPermErr(msg);
      setInwardPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, compCode, compUid, userName]);

  const reloadPartyLookups = useCallback(async () => {
    if (!compCode) return;
    const params = { comp_code: compCode, comp_uid: compUid };
    const [purRes, brokerRes] = await Promise.all([
      axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
      axios.get(`${apiBase}/api/salelist-brokers`, { params }),
    ]);
    setPurAccounts(purRes.data || []);
    setBrokers(brokerRes.data || []);
  }, [apiBase, compCode, compUid]);

  const reloadGodowns = useCallback(async () => {
    if (!compCode) return;
    const { data } = await axios.get(`${apiBase}/api/purchaselist-godowns`, {
      params: { comp_code: compCode, comp_uid: compUid },
    });
    setGodowns(data || []);
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const applyLoaded = useCallback((data) => {
    const h = data?.header || {};
    const billNo = Number(h.bill_no ?? h.BILL_NO ?? 0) || 0;
    setHeader({
      bill_no: billNo ? String(billNo) : '',
      bill_date: toInputDateString(h.bill_date) || defaultBillDate,
      code: h.code || '',
      party_name: h.party_name || '',
      party_city: h.party_city || '',
      bk_code: h.bk_code || '',
      bk_name: h.bk_name || '',
      god_code: h.god_code || '',
      god_name: h.god_name || '',
      truck_no: h.truck_no || '',
      dk_weight: h.dk_weight != null && h.dk_weight !== '' ? String(h.dk_weight) : '',
      dk_weight_empty: h.dk_weight_empty != null && h.dk_weight_empty !== '' ? String(h.dk_weight_empty) : '',
      dk_weight_net: h.dk_weight_net != null && h.dk_weight_net !== '' ? String(h.dk_weight_net) : '',
      bill_weight: h.bill_weight != null && h.bill_weight !== '' ? String(h.bill_weight) : '',
      gr_no: h.gr_no || '',
      tpt: h.tpt || '',
      time_in: h.time_in || '',
      time_out: h.time_out || '',
      remarks: h.remarks || '',
    });
    const loaded = (data?.lines || []).map((ln, idx) =>
      recalcLine({
        key: idx + 1,
        po_no: ln.po_no != null && ln.po_no !== 0 ? String(ln.po_no) : '',
        item_code: ln.item_code ? String(ln.item_code) : '',
        item_name: ln.item_name || '',
        bard_item_code: ln.bard_item_code ? String(ln.bard_item_code) : '',
        bard_item_name: ln.bard_item_name || '',
        status: ln.status || 'B',
        packing: ln.packing != null && ln.packing !== '' ? String(ln.packing) : '',
        qnty: ln.qnty != null && ln.qnty !== '' ? String(ln.qnty) : '',
        g_weight: ln.g_weight != null && ln.g_weight !== '' ? String(ln.g_weight) : '',
        d_weight: ln.d_weight != null && ln.d_weight !== '' ? String(ln.d_weight) : '',
        weight: ln.weight != null && ln.weight !== '' ? String(ln.weight) : '',
        rate: ln.rate != null && ln.rate !== '' ? String(ln.rate) : '',
        amount: ln.amount != null && ln.amount !== '' ? String(ln.amount) : '',
        cost_code: ln.cost_code || '',
      })
    );
    lineKeyRef.current = Math.max(loaded.length + 1, 3);
    setLines(loaded.length ? loaded : [emptyLine(1), emptyLine(2)]);
    setMode('view');
  }, [defaultBillDate]);

  const loadInward = useCallback(
    async (billNo, billDate, opts = {}) => {
      const { successMessage = '', silent = false } = opts;
      if (!compCode || !billNo) return false;
      setBusy(true);
      if (!silent) setStatus('');
      try {
        const baseParams = { ...apiParams, bill_no: billNo };
        const withDate =
          billDate && toOracleDateFromAny(billDate)
            ? { ...baseParams, bill_date: toOracleDateFromAny(billDate) }
            : null;
        const paramAttempts = withDate ? [baseParams, withDate] : [baseParams];
        let data;
        let lastErr;
        for (const params of paramAttempts) {
          try {
            ({ data } = await axios.get(`${apiBase}/api/goods-inward`, {
              params,
              ...reqOpts,
            }));
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (err.response?.status !== 404) throw err;
          }
        }
        if (!data) throw lastErr || new Error('Goods inward note not found.');
        applyLoaded(data);
        if (successMessage) setStatus(successMessage);
        return true;
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, compCode]
  );

  const navigateInward = useCallback(
    async (dir) => {
      if (!compCode) return;
      setBusy(true);
      setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/goods-inward/nav`, {
          params: {
            ...apiParams,
            bill_no: header.bill_no || undefined,
            bill_date: header.bill_date ? toOracleDateFromAny(header.bill_date) : undefined,
            dir,
          },
          ...reqOpts,
        });
        applyLoaded(data);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Navigation failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, compCode, header.bill_date, header.bill_no]
  );

  const focusBillDate = useCallback(() => {
    window.setTimeout(() => focusChain.focusKey('hdr-date'), 80);
  }, [focusChain]);

  const startNew = useCallback(async () => {
    if (!compCode) return;
    if (!inwardPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/goods-inward/next-no`, {
        params: apiParams,
        ...reqOpts,
      });
      lineKeyRef.current = 3;
      setHeader({ ...emptyHeader(defaultBillDate), bill_no: String(data.bill_no ?? ''), bill_date: defaultBillDate });
      setLines([emptyLine(1), emptyLine(2)]);
      setMode('new');
      focusBillDate();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Could not get next number.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, compCode, defaultBillDate, focusBillDate, inwardPerms?.canAdd]);

  useEffect(() => {
    if (permLoading || !inwardPerms?.canOpen || !inwardPerms?.canAdd) return;
    if (didAutoNewRef.current || header.bill_no) return;
    didAutoNewRef.current = true;
    void startNew();
  }, [permLoading, inwardPerms, header.bill_no, startNew]);

  const startEdit = () => {
    if (!header.bill_no) {
      setStatus('Load or create a goods inward note first.');
      return;
    }
    if (!inwardPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    setMode('edit');
    setStatus('');
  };

  const handleSave = async () => {
    if (mode === 'new' && !inwardPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    if (mode === 'edit' && !inwardPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    const billDateYmd = toInputDateString(header.bill_date);
    if (!billDateYmd) {
      setStatus('Date is required.');
      return;
    }
    const fyErr = finYearDateErrorMessage(billDateYmd, fyMinYmd, fyMaxYmd, 'Date');
    if (fyErr) {
      setStatus(fyErr);
      return;
    }
    if (!header.code.trim()) {
      setStatus('Party code is required.');
      return;
    }
    if (!header.god_code.trim()) {
      setStatus('Godown code is required.');
      return;
    }
    const payloadLines = lines
      .filter((ln) => String(ln.item_code ?? '').trim())
      .map((ln, idx) => {
        const rec = recalcLine(ln);
        return {
          trn_no: idx + 1,
          po_no: Number(rec.po_no) || 0,
          item_code: Number(rec.item_code) || 0,
          bard_item_code: Number(rec.bard_item_code) || 0,
          status: rec.status,
          packing: num(rec.packing),
          qnty: num(rec.qnty),
          g_weight: num(rec.g_weight),
          d_weight: num(rec.d_weight),
          weight: num(rec.weight),
          rate: num(rec.rate),
          amount: num(rec.amount),
          cost_code: rec.cost_code,
        };
      });
    if (!payloadLines.length) {
      setStatus('Enter at least one item line.');
      return;
    }
    const dkNet =
      header.dk_weight || header.dk_weight_empty
        ? calcNetWeight(header.dk_weight, header.dk_weight_empty)
        : num(header.dk_weight_net);
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.post(
        `${apiBase}/api/goods-inward`,
        {
          ...apiParams,
          comp_year: compYear,
          mode,
          bill_no: Number(header.bill_no) || 0,
          bill_date: toOracleDateFromAny(header.bill_date),
          code: header.code.trim(),
          bk_code: header.bk_code.trim(),
          god_code: header.god_code.trim(),
          truck_no: header.truck_no.trim(),
          dk_weight: num(header.dk_weight),
          dk_weight_empty: num(header.dk_weight_empty),
          dk_weight_net: dkNet,
          bill_weight: num(header.bill_weight),
          gr_no: header.gr_no.trim(),
          tpt: header.tpt.trim(),
          time_in: header.time_in.trim(),
          time_out: header.time_out.trim(),
          remarks: header.remarks.trim(),
          lines: payloadLines,
        },
        reqOpts
      );
      const savedNo = Number(data.bill_no) || Number(header.bill_no) || 0;
      const savedMsg = data.message || `Inward No. ${savedNo} saved.`;
      didAutoNewRef.current = true;
      closeHelpModals();

      let refreshed = false;
      if (data.header && Array.isArray(data.lines)) {
        applyLoaded(data);
        setMode('view');
        refreshed = true;
      }
      if (!refreshed && savedNo) {
        refreshed = await loadInward(savedNo, data.bill_date || header.bill_date, { silent: true });
      }
      if (!refreshed && savedNo) {
        setHeader((h) => ({ ...h, bill_no: String(savedNo) }));
        setMode('view');
      }
      setStatus(savedMsg);
      window.alert(savedMsg);
      window.setTimeout(() => newBtnRef.current?.focus(), 0);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Save failed.';
      setStatus(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!header.bill_no) return;
    if (mode === 'new') {
      setStatus('Save the goods inward note before delete, or click New to discard.');
      return;
    }
    if (!inwardPerms?.canDelete) {
      setStatus('You Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete inward no. ${header.bill_no}?`)) return;
    const deletedNo = header.bill_no;
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.delete(`${apiBase}/api/goods-inward`, {
        params: { ...apiParams, bill_no: deletedNo },
        ...reqOpts,
      });
      lineKeyRef.current = 3;
      didAutoNewRef.current = false;
      setHeader(emptyHeader(defaultBillDate));
      setLines([emptyLine(1), emptyLine(2)]);
      setMode('view');
      const msg = data?.message || `Inward No. ${deletedNo} deleted.`;
      setStatus(msg);
      window.alert(msg);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Delete failed.';
      setStatus(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const closeHelpModals = useCallback(() => {
    godownHelpSuppressRef.current = Date.now() + 500;
    setGodownHelpOpen(false);
    setCostHelpLine(null);
    setPoHelpOpen(false);
    setPoHelpLine(null);
    setItemHelpLine(null);
    setBardHelpLine(null);
    setHelpField(null);
  }, []);

  const openPoHelp = useCallback(
    async (lineKey) => {
      closeHelpModals();
      setPoHelpLine(lineKey ?? null);
      setPoHelpOpen(true);
      setPoHelpLoading(true);
      setPoHelpError('');
      setPoHelpRows([]);
      try {
        const { data } = await axios.get(`${apiBase}/api/goods-inward/po-help`, {
          params: { ...apiParams, code: header.code, bk_code: header.bk_code },
          ...reqOpts,
        });
        setInwardCtx({
          sale_order_type: String(data.sale_order_type ?? 'N').trim().toUpperCase(),
          order_qw: String(data.order_qw ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W',
        });
        setPoHelpRows(
          (data.rows || []).map((r, i) => ({
            _id: `${r.so_no}-${r.item_code}-${r.rate}-${i}`,
            ...r,
            so_date: r.so_date,
            bqty: num(r.bqty),
            bwgt: num(r.bwgt),
            rate: num(r.rate),
          }))
        );
      } catch (err) {
        setPoHelpError(err.response?.data?.error || err.message || 'PO help failed.');
      } finally {
        setPoHelpLoading(false);
      }
    },
    [apiBase, apiParams, closeHelpModals, header.bk_code, header.code]
  );

  const fetchCostCentres = useCallback(async () => {
    if (!compCode) return [];
    try {
      const { data } = await axios.get(`${apiBase}/api/goods-inward/cost-help`, {
        params: { ...apiParams },
        ...reqOpts,
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setCostCentres(rows);
      return rows;
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Could not load cost centres.');
      return [];
    }
  }, [apiBase, apiParams, compCode]);

  const openCostHelp = useCallback(
    async (lineKey) => {
      closeHelpModals();
      if (!costCentres.length) await fetchCostCentres();
      setCostHelpLine(lineKey ?? null);
    },
    [closeHelpModals, costCentres.length, fetchCostCentres]
  );

  const openHelpForField = useCallback(
    (helpType, lineKey) => {
      switch (helpType) {
        case 'party':
          closeHelpModals();
          setHelpField('code');
          break;
        case 'broker':
          closeHelpModals();
          setHelpField('bk_code');
          break;
        case 'godown':
          closeHelpModals();
          setGodownHelpOpen(true);
          break;
        case 'item':
          closeHelpModals();
          setItemHelpLine(lineKey ?? null);
          break;
        case 'bard':
          closeHelpModals();
          setBardHelpLine(lineKey ?? null);
          break;
        case 'cost':
          void openCostHelp(lineKey);
          break;
        case 'po':
          void openPoHelp(lineKey);
          break;
        default:
          break;
      }
    },
    [closeHelpModals, openCostHelp, openPoHelp]
  );

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

  const pickAccount = useCallback(
    (field, sel, { focusNext = false, closeHelp = false } = {}) => {
      let c = '';
      let name = '';
      let city = '';
      if (sel != null && typeof sel === 'object') {
        c = String(sel.code ?? sel.CODE ?? '').trim().toUpperCase();
        name = String(sel.name ?? sel.NAME ?? '').trim();
        city = String(sel.city ?? sel.CITY ?? '').trim();
      } else {
        c = String(sel ?? '').trim().toUpperCase();
      }
      if (!name) {
        const pool = field === 'bk_code' ? brokers : purAccounts;
        const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
        name = String(row?.NAME ?? row?.name ?? '').trim();
        city = String(row?.CITY ?? row?.city ?? '').trim();
      }
      if (field === 'code') setHeader((h) => ({ ...h, code: c, party_name: name, party_city: city }));
      if (field === 'bk_code') setHeader((h) => ({ ...h, bk_code: c, bk_name: name }));
      if (closeHelp) setHelpField(null);
      if (focusNext) {
        const nextKey = field === 'code' ? 'hdr-bk' : field === 'bk_code' ? 'hdr-god' : null;
        if (nextKey) window.setTimeout(() => focusChain.focusKey(nextKey), 0);
      }
    },
    [brokers, purAccounts, focusChain]
  );

  const handlePartyCreated = useCallback(
    async (data, field) => {
      await reloadPartyLookups();
      const code = data?.code ?? data?.CODE;
      if (code) pickAccount(field, code, { focusNext: true });
    },
    [reloadPartyLookups, pickAccount]
  );

  useEffect(() => {
    godownHelpOpenRef.current = godownHelpOpen;
  }, [godownHelpOpen]);

  const pickGodown = useCallback(
    (sel, { focusNext = false, closeHelp = false } = {}) => {
      let c = '';
      let name = '';
      if (sel != null && typeof sel === 'object') {
        c = String(sel.god_code ?? sel.GOD_CODE ?? sel.code ?? '').trim().toUpperCase();
        name = String(sel.god_name ?? sel.GOD_NAME ?? sel.name ?? '').trim();
      } else {
        c = String(sel ?? '').trim().toUpperCase();
      }
      if (!name) {
        const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
        name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
      }
      setHeader((h) => ({ ...h, god_code: c, god_name: name }));
      if (closeHelp) {
        godownHelpSuppressRef.current = Date.now() + 500;
        setGodownHelpOpen(false);
      }
      if (focusNext) {
        window.setTimeout(() => {
          const nextKey = lines[0] ? `ln-${lines[0].key}-po` : 'ft-truck';
          focusChain.focusKey(nextKey);
        }, 40);
      }
    },
    [godowns, focusChain, lines]
  );

  const handleGodownHelpSelect = useCallback(
    (row) => {
      pickGodown(row?.god_code ?? row?.GOD_CODE ?? row, { focusNext: true, closeHelp: true });
    },
    [pickGodown]
  );

  const handleGodownHelpClose = useCallback(() => {
    godownHelpSuppressRef.current = Date.now() + 500;
    setGodownHelpOpen(false);
  }, []);

  const pickPoRow = useCallback(
    (row) => {
      if (!row || poHelpLine == null) return;
      const lineKey = poHelpLine;
      const qw = inwardCtx?.order_qw === 'Q' ? 'Q' : 'W';
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== lineKey) return ln;
          const patch = {
            po_no: String(row.so_no ?? ''),
            item_code: String(row.item_code ?? ''),
            item_name: String(row.item_name ?? ''),
            rate: row.rate != null && row.rate !== '' ? String(row.rate) : '',
          };
          if (qw === 'Q') {
            patch.qnty = row.bqty != null && row.bqty !== '' ? String(row.bqty) : '';
          } else {
            const w = row.bwgt != null && row.bwgt !== '' ? String(row.bwgt) : '';
            patch.g_weight = w;
            patch.d_weight = '';
          }
          return recalcLine({ ...ln, ...patch });
        })
      );
      const bk = String(row.bk_code ?? '').trim();
      if (bk) pickAccount('bk_code', bk);
      setPoHelpLine(null);
      window.setTimeout(() => focusChain.focusKey(`ln-${lineKey}-item`), 40);
    },
    [poHelpLine, inwardCtx?.order_qw, pickAccount, focusChain]
  );

  const pickItem = useCallback(
    (lineKey, row, { focusNext = false, isBard = false } = {}) => {
      const ic = Number(row?.ITEM_CODE ?? row?.item_code ?? 0) || 0;
      const name = String(row?.ITEM_NAME ?? row?.item_name ?? '').trim();
      const cost = String(row?.COST_CODE ?? row?.cost_code ?? '').trim();
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== lineKey) return ln;
          if (isBard) {
            return { ...ln, bard_item_code: ic ? String(ic) : '', bard_item_name: name };
          }
          return recalcLine({
            ...ln,
            item_code: ic ? String(ic) : '',
            item_name: name,
            cost_code: cost,
          });
        })
      );
      if (isBard) setBardHelpLine(null);
      else setItemHelpLine(null);
      if (focusNext) {
        const nextKey = isBard ? `ln-${lineKey}-status` : `ln-${lineKey}-bard`;
        window.setTimeout(() => focusChain.focusKey(nextKey), 0);
      }
    },
    [focusChain]
  );

  const pickCost = useCallback(
    (lineKey, row, { closeHelp = false, focusNext = false } = {}) => {
      const code = String(row?.cost_code ?? row?.COST_CODE ?? '').trim().toUpperCase();
      setLines((prev) =>
        prev.map((ln) => (ln.key === lineKey ? { ...ln, cost_code: code } : ln))
      );
      if (closeHelp) setCostHelpLine(null);
      if (focusNext) {
        window.setTimeout(() => focusChain.focusKey(`ln-${lineKey}-cost`), 0);
      }
    },
    [focusChain]
  );

  const handleCostHelpSelect = useCallback(
    (row) => {
      if (costHelpLine == null) return;
      pickCost(costHelpLine, row, { closeHelp: true, focusNext: true });
    },
    [costHelpLine, pickCost]
  );

  const handleCostHelpClose = useCallback(() => {
    setCostHelpLine(null);
  }, []);

  const updateLine = (key, patch) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        let next = { ...ln, ...patch };
        if (patch.item_code != null) {
          const ic = Number(patch.item_code) || 0;
          const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
          next.item_name = row ? String(row.ITEM_NAME ?? row.item_name ?? '').trim() : '';
          next.cost_code = row ? String(row.COST_CODE ?? row.cost_code ?? '').trim() : '';
        }
        if (patch.bard_item_code != null) {
          const ic = Number(patch.bard_item_code) || 0;
          const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
          next.bard_item_name = row ? String(row.ITEM_NAME ?? row.item_name ?? '').trim() : '';
        }
        if ('g_weight' in patch || 'd_weight' in patch || 'rate' in patch) {
          next = recalcLine(next);
        }
        if ('packing' in patch || 'qnty' in patch) {
          const packing = num(next.packing);
          const qnty = num(next.qnty);
          // VFP: when packing set, G_WEIGHT = ROUND(QNTY * PACKING, 3)
          if (packing > 0 && qnty > 0) {
            const wgt = Math.round(qnty * packing * 1000) / 1000;
            next.g_weight = String(wgt);
            if (next.d_weight === '' || next.d_weight == null) next.d_weight = '';
            next = recalcLine(next);
          }
        }
        return next;
      })
    );
  };

  const addLine = () => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key)]);
  };

  const handleBillNoKeyDown = (e) => {
    if (e.key === 'Enter' && mode === 'view' && String(header.bill_no ?? '').trim()) {
      e.preventDefault();
      void loadInward(header.bill_no, header.bill_date);
      return;
    }
    focusChain.onEnter('hdr-bill-no')(e);
  };

  const handleDkChange = (field, value) => {
    setHeader((h) => {
      const next = { ...h, [field]: value };
      if (field === 'dk_weight' || field === 'dk_weight_empty') {
        const net = calcNetWeight(next.dk_weight, next.dk_weight_empty);
        next.dk_weight_net = net ? String(net) : '';
      }
      return next;
    });
  };

  return (
    <div className="voucher-entry-form purchase-order-form goods-inward-form">
      {permLoading ? <p className="voucher-entry-form__status">Loading permissions…</p> : null}
      {!permLoading && !inwardPerms?.canOpen ? (
        <div className="purchase-order-form__denied">
          <p className="deploy-update-msg deploy-update-msg--err">{permErr || 'Access Denied (INWARD / F12).'}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Close
          </button>
        </div>
      ) : null}
      {!permLoading && inwardPerms?.canOpen ? (
        <>
          <div className="purchase-order-form__toolbar-row">
            <div className="voucher-entry-form__toolbar voucher-entry-form__toolbar--vfp purchase-order-form__toolbar">
              <button
                ref={newBtnRef}
                type="button"
                className="btn btn-sm"
                onClick={startNew}
                disabled={busy || !inwardPerms?.canAdd}
              >
                New
              </button>
              <button type="button" className="btn btn-sm" onClick={startEdit} disabled={busy || !header.bill_no || !inwardPerms?.canEdit}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleDelete}
                disabled={busy || !header.bill_no || mode === 'new' || !inwardPerms?.canDelete}
              >
                Delete
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={!canSave}>
                Save
              </button>
              <button type="button" className="btn btn-sm voucher-entry-form__list-btn" onClick={() => setListOpen(true)} disabled={busy}>
                List
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setListOpen(true)} disabled={busy} title="Search inward notes">
                Search
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void navigateInward('next')} disabled={busy}>
                Next
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void navigateInward('prev')} disabled={busy}>
                Previous
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void navigateInward('first')} disabled={busy}>
                Top
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void navigateInward('last')} disabled={busy}>
                Bottom
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (header.bill_no) void loadInward(header.bill_no, header.bill_date);
                }}
                disabled={busy || !header.bill_no}
              >
                Refresh
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPrintOpen(true)} disabled={busy}>
                Print
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setChecklistOpen(true)} disabled={busy}>
                CheckList
              </button>
              <button type="button" className="btn btn-sm" onClick={onBack} disabled={busy}>
                Close
              </button>
              {mode !== 'view' ? (
                <span className={`voucher-entry-form__mode voucher-entry-form__mode--${mode}`}>
                  {mode === 'new' ? 'New' : 'Edit'}
                </span>
              ) : null}
            </div>
            <ModuleRightsPanel
              className="purchase-order-form__perms"
              title="INWARD (F12)"
              fieldLabel="F12"
              raw={inwardPerms?.f12}
              perms={inwardPerms}
              userName={userName}
              source={inwardPerms?.source ? String(inwardPerms.source) : ''}
            />
          </div>
          {status ? (
            <p
              className={`voucher-entry-form__status${
                status.toLowerCase().includes('fail') ||
                status.includes('required') ||
                status.includes('Denied') ||
                status.includes('Can Not') ||
                status.includes('discard')
                  ? ' voucher-entry-form__status--err'
                  : ' voucher-entry-form__status--ok'
              }`}
            >
              {status}
            </p>
          ) : null}

          <div className="goods-inward-form__title-bar">GOODS INWARD CHALLAN</div>

          <div className="goods-inward-form__header">
            <div className="goods-inward-form__row goods-inward-form__row--doc">
              <label className="goods-inward-form__field">
                <span className="goods-inward-form__label">Inward No.</span>
                <input
                  ref={(el) => {
                    billNoInputRef.current = el;
                    focusChain.register('hdr-bill-no', el);
                  }}
                  className="voucher-entry-form__input goods-inward-form__input"
                  value={header.bill_no}
                  readOnly={mode !== 'view'}
                  onChange={(e) => setHeader((h) => ({ ...h, bill_no: e.target.value.replace(/\D/g, '') }))}
                  onKeyDown={handleBillNoKeyDown}
                />
              </label>
              <label className="goods-inward-form__field">
                <span className="goods-inward-form__label">Date</span>
                <VoucherDmyDateInput
                  className="voucher-entry-form__input voucher-entry-form__input--date goods-inward-form__input"
                  valueYmd={header.bill_date}
                  minYmd={fyMinYmd}
                  maxYmd={fyMaxYmd}
                  disabled={!editable}
                  title={fyMinYmd && fyMaxYmd ? `dd/mm/yyyy · FY ${fyRangeLabel}` : 'dd/mm/yyyy'}
                  inputRef={(el) => focusChain.register('hdr-date', el)}
                  onChangeYmd={(v) => setHeader((h) => ({ ...h, bill_date: v }))}
                  onKeyDown={focusChain.onEnter('hdr-date')}
                />
              </label>
            </div>

            <div className="goods-inward-form__party-row">
              <div className="goods-inward-form__party-label">
                <PartyAddButton
                  onClick={() => setPartyAddOpen(true)}
                  disabled={!editable || busy || !partyPerms?.canAdd}
                  title="Add new party (A/c Master schedule 11.10)"
                />
                <span>Party</span>
              </div>
              <div className="goods-inward-form__party-fields">
                <input
                  className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--code"
                  value={header.code}
                  disabled={!editable}
                  maxLength={6}
                  ref={(el) => focusChain.register('hdr-code', el)}
                  onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
                  onBlur={() => pickAccount('code', header.code)}
                  onKeyDown={(e) => handleFieldKeyDown('hdr-code', e, 'party')}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={!editable}
                  onClick={() => setHelpField('code')}
                  title="Party help (F1)"
                >
                  🔍
                </button>
                <input className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--name" readOnly value={header.party_name} tabIndex={-1} />
                <input
                  className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--place"
                  readOnly
                  value={header.party_city}
                  tabIndex={-1}
                  placeholder="Place"
                />
              </div>
            </div>

            <div className="goods-inward-form__party-row">
              <div className="goods-inward-form__party-label">
                <PartyAddButton
                  onClick={() => setBrokerAddOpen(true)}
                  disabled={!editable || busy || !partyPerms?.canAdd}
                  title="Add new broker (A/c Master schedule 11.20)"
                />
                <span>Broker</span>
              </div>
              <div className="goods-inward-form__party-fields goods-inward-form__party-fields--broker">
                <input
                  className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--code"
                  value={header.bk_code}
                  disabled={!editable}
                  maxLength={6}
                  ref={(el) => focusChain.register('hdr-bk', el)}
                  onChange={(e) => setHeader((h) => ({ ...h, bk_code: e.target.value.toUpperCase() }))}
                  onBlur={() => pickAccount('bk_code', header.bk_code)}
                  onKeyDown={(e) => handleFieldKeyDown('hdr-bk', e, 'broker')}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={!editable}
                  onClick={() => setHelpField('bk_code')}
                  title="Broker help (F1)"
                >
                  🔍
                </button>
                <input className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--name" readOnly value={header.bk_name} tabIndex={-1} />
              </div>
            </div>

            <div className="goods-inward-form__party-row">
              <div className="goods-inward-form__party-label">
                <PartyAddButton
                  onClick={() => setGodownAddOpen(true)}
                  disabled={!editable || busy}
                  title="Add new godown"
                />
                <span>Godown</span>
              </div>
              <div className="goods-inward-form__party-fields goods-inward-form__party-fields--godown">
                <input
                  className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--code"
                  value={header.god_code}
                  disabled={!editable}
                  maxLength={6}
                  autoComplete="off"
                  ref={(el) => focusChain.register('hdr-god', el)}
                  onChange={(e) => setHeader((h) => ({ ...h, god_code: e.target.value.toUpperCase() }))}
                  onBlur={() => {
                    if (godownHelpOpenRef.current) return;
                    if (Date.now() < godownHelpSuppressRef.current) return;
                    pickGodown(header.god_code);
                  }}
                  onKeyDown={(e) => handleFieldKeyDown('hdr-god', e, 'godown')}
                />
                <button
                  type="button"
                  className="voucher-entry-form__code-help-btn"
                  disabled={!editable}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (Date.now() < godownHelpSuppressRef.current) return;
                    closeHelpModals();
                    setGodownHelpOpen(true);
                  }}
                  title="Godown help (F1)"
                >
                  🔍
                </button>
                <input className="voucher-entry-form__input goods-inward-form__input goods-inward-form__input--name" readOnly value={header.god_name} tabIndex={-1} />
              </div>
            </div>
          </div>

          <div className="purchase-order-form__grid-wrap goods-inward-form__grid-wrap">
            <table className="purchase-order-form__grid goods-inward-form__grid">
              <colgroup>
                <col className="gi-col-sno" />
                <col className="gi-col-po" />
                <col className="gi-col-item" />
                <col className="gi-col-name" />
                <col className="gi-col-bard" />
                <col className="gi-col-bkh" />
                <col className="gi-col-pkg" />
                <col className="gi-col-qty" />
                <col className="gi-col-wgt" />
                <col className="gi-col-wgt" />
                <col className="gi-col-wgt" />
                <col className="gi-col-rate" />
                <col className="gi-col-amt" />
                <col className="gi-col-cost" />
              </colgroup>
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Po.No</th>
                  <th>Item</th>
                  <th>Name</th>
                  <th>Bard.Item</th>
                  <th>B/K/H</th>
                  <th>Pkg.</th>
                  <th className="num">Qty.</th>
                  <th className="num">G.Weight</th>
                  <th className="num">D.Weight</th>
                  <th className="num">N.Weight</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, idx) => (
                  <tr key={ln.key}>
                    <td>{idx + 1}</td>
                    <td>
                      <div className="goods-inward-form__cell-wrap">
                        <input
                          className="purchase-order-form__cell-input goods-inward-form__cell-input--po"
                          value={ln.po_no}
                          disabled={!editable}
                          maxLength={GRID_FIELD_LIMITS.poNo.maxLen}
                          ref={(el) => focusChain.register(`ln-${ln.key}-po`, el)}
                          onChange={(e) =>
                            updateLine(ln.key, { po_no: digitsOnly(e.target.value, GRID_FIELD_LIMITS.poNo) })
                          }
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-po`, e, 'po', { lineKey: ln.key })}
                        />
                        <button
                          type="button"
                          className="goods-inward-form__cell-help"
                          disabled={!editable}
                          tabIndex={-1}
                          title="PO help (F1) — open purchase orders with balance"
                          onClick={() => void openPoHelp(ln.key)}
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="goods-inward-form__cell-wrap">
                        <input
                          className="purchase-order-form__cell-input goods-inward-form__cell-input--code"
                          value={ln.item_code}
                          disabled={!editable}
                          maxLength={GRID_FIELD_LIMITS.itemCode.maxLen}
                          ref={(el) => focusChain.register(`ln-${ln.key}-item`, el)}
                          onChange={(e) =>
                            updateLine(ln.key, {
                              item_code: digitsOnly(e.target.value, GRID_FIELD_LIMITS.itemCode),
                            })
                          }
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-item`, e, 'item', { lineKey: ln.key })}
                        />
                        <button
                          type="button"
                          className="goods-inward-form__cell-help"
                          disabled={!editable}
                          tabIndex={-1}
                          title="Item help (F1)"
                          onClick={() => setItemHelpLine(ln.key)}
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td className="goods-inward-form__name-cell">{ln.item_name}</td>
                    <td>
                      <div className="goods-inward-form__cell-wrap">
                        <input
                          className="purchase-order-form__cell-input goods-inward-form__cell-input--code"
                          value={ln.bard_item_code}
                          disabled={!editable}
                          maxLength={GRID_FIELD_LIMITS.bardItemCode.maxLen}
                          ref={(el) => focusChain.register(`ln-${ln.key}-bard`, el)}
                          onChange={(e) =>
                            updateLine(ln.key, {
                              bard_item_code: digitsOnly(e.target.value, GRID_FIELD_LIMITS.bardItemCode),
                            })
                          }
                          onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-bard`, e, 'bard', { lineKey: ln.key })}
                        />
                        <button
                          type="button"
                          className="goods-inward-form__cell-help"
                          disabled={!editable}
                          tabIndex={-1}
                          title="Bardana item help (F1)"
                          onClick={() => setBardHelpLine(ln.key)}
                        >
                          🔍
                        </button>
                      </div>
                    </td>
                    <td>
                      <select
                        className="purchase-order-form__cell-input"
                        value={ln.status}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-status`, el)}
                        onChange={(e) => updateLine(ln.key, { status: e.target.value })}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-status`)}
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
                        type="text"
                        inputMode="numeric"
                        className="purchase-order-form__cell-input goods-inward-form__cell-input--pkg"
                        value={ln.packing}
                        disabled={!editable}
                        maxLength={GRID_FIELD_LIMITS.packing.maxLen}
                        autoComplete="off"
                        ref={(el) => focusChain.register(`ln-${ln.key}-pkg`, el)}
                        onChange={(e) =>
                          updateLine(ln.key, { packing: digitsOnly(e.target.value, GRID_FIELD_LIMITS.packing) })
                        }
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-pkg`)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="purchase-order-form__cell-input num"
                        value={ln.qnty}
                        disabled={!editable}
                        maxLength={GRID_FIELD_LIMITS.qnty.maxLen}
                        autoComplete="off"
                        ref={(el) => focusChain.register(`ln-${ln.key}-qnty`, el)}
                        onChange={(e) =>
                          updateLine(ln.key, { qnty: digitsOnly(e.target.value, GRID_FIELD_LIMITS.qnty) })
                        }
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-qnty`)}
                      />
                    </td>
                    <td>
                      <input
                        className="purchase-order-form__cell-input num"
                        value={ln.g_weight}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-gwgt`, el)}
                        onChange={(e) => updateLine(ln.key, { g_weight: e.target.value.replace(/[^\d.]/g, '') })}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-gwgt`)}
                      />
                    </td>
                    <td>
                      <input
                        className="purchase-order-form__cell-input num"
                        value={ln.d_weight}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-dwgt`, el)}
                        onChange={(e) => updateLine(ln.key, { d_weight: e.target.value.replace(/[^\d.]/g, '') })}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-dwgt`)}
                      />
                    </td>
                    <td className="num">{fmtWgt(ln.weight)}</td>
                    <td>
                      <input
                        className="purchase-order-form__cell-input num"
                        value={ln.rate}
                        disabled={!editable}
                        ref={(el) => focusChain.register(`ln-${ln.key}-rate`, el)}
                        onChange={(e) => updateLine(ln.key, { rate: e.target.value.replace(/[^\d.]/g, '') })}
                        onKeyDown={focusChain.onEnter(`ln-${ln.key}-rate`)}
                      />
                    </td>
                    <td className="num" title={fmtAmt(ln.amount)}>
                      <span className="goods-inward-form__amount-cell">{fmtAmt(ln.amount)}</span>
                    </td>
                    <td>
                      {editable ? (
                        <div className="goods-inward-form__cell-wrap">
                          <input
                            className="purchase-order-form__cell-input goods-inward-form__cell-input--cost"
                            value={ln.cost_code}
                            maxLength={6}
                            ref={(el) => focusChain.register(`ln-${ln.key}-cost`, el)}
                            onChange={(e) => updateLine(ln.key, { cost_code: e.target.value.toUpperCase() })}
                            onKeyDown={(e) => {
                              if (e.key === 'F1' || e.keyCode === 112) {
                                e.preventDefault();
                                void openCostHelp(ln.key);
                                return;
                              }
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                const isLastLine = idx === lines.length - 1;
                                if (isLastLine) {
                                  const newKey = lineKeyRef.current;
                                  addLine();
                                  window.setTimeout(() => focusChain.focusKey(`ln-${newKey}-po`), 50);
                                } else {
                                  focusChain.focusNext(`ln-${ln.key}-cost`);
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="goods-inward-form__cell-help"
                            tabIndex={-1}
                            title="Cost centre help (F1)"
                            onClick={() => void openCostHelp(ln.key)}
                          >
                            🔍
                          </button>
                        </div>
                      ) : (
                        <span className="goods-inward-form__cost-view" title={ln.cost_code || ''}>
                          {ln.cost_code || ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="goods-inward-form__totals">
                  <td colSpan={7} />
                  <td className="num">{fmtAmt(totals.qnty, 0)}</td>
                  <td colSpan={2} />
                  <td className="num">{fmtWgt(totals.weight)}</td>
                  <td />
                  <td className="num" title={fmtAmt(totals.amount)}>
                    <span className="goods-inward-form__amount-cell">{fmtAmt(totals.amount)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="goods-inward-form__vehicle-row">
            <label className="goods-inward-form__field goods-inward-form__field--vehicle">
              <span className="goods-inward-form__label">Vehicle No.</span>
              <input
                className="voucher-entry-form__input goods-inward-form__input"
                value={header.truck_no}
                disabled={!editable}
                maxLength={20}
                ref={(el) => focusChain.register('ft-truck', el)}
                onChange={(e) => setHeader((h) => ({ ...h, truck_no: e.target.value.toUpperCase() }))}
                onKeyDown={focusChain.onEnter('ft-truck')}
              />
            </label>
          </div>

          <div className="goods-inward-form__footer">
            <label>
              <span>Dharam Kanta Wgt.</span>
              <input
                value={header.dk_weight}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-dk', el)}
                onChange={(e) => handleDkChange('dk_weight', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={focusChain.onEnter('ft-dk')}
              />
            </label>
            <label>
              <span>Empty Truck Wgt.</span>
              <input
                value={header.dk_weight_empty}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-dk-empty', el)}
                onChange={(e) => handleDkChange('dk_weight_empty', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={focusChain.onEnter('ft-dk-empty')}
              />
            </label>
            <label>
              <span>Net Weight</span>
              <input className="ro" readOnly value={fmtWgt(header.dk_weight_net)} tabIndex={-1} />
            </label>
            <label>
              <span>Bill Weight</span>
              <input
                value={header.bill_weight}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-bill-wgt', el)}
                onChange={(e) => setHeader((h) => ({ ...h, bill_weight: e.target.value.replace(/[^\d.]/g, '') }))}
                onKeyDown={focusChain.onEnter('ft-bill-wgt')}
              />
            </label>
            <label>
              <span>G.R.No.</span>
              <input
                value={header.gr_no}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-gr', el)}
                onChange={(e) => setHeader((h) => ({ ...h, gr_no: e.target.value }))}
                onKeyDown={focusChain.onEnter('ft-gr')}
              />
            </label>
            <label>
              <span>Transport</span>
              <input
                value={header.tpt}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-tpt', el)}
                onChange={(e) => setHeader((h) => ({ ...h, tpt: e.target.value }))}
                onKeyDown={focusChain.onEnter('ft-tpt')}
              />
            </label>
            <label>
              <span>Time In</span>
              <input
                value={header.time_in}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-time-in', el)}
                onChange={(e) => setHeader((h) => ({ ...h, time_in: e.target.value }))}
                onKeyDown={focusChain.onEnter('ft-time-in')}
              />
            </label>
            <label>
              <span>Time Out</span>
              <input
                value={header.time_out}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-time-out', el)}
                onChange={(e) => setHeader((h) => ({ ...h, time_out: e.target.value }))}
                onKeyDown={focusChain.onEnter('ft-time-out')}
              />
            </label>
            <label className="goods-inward-form__remarks">
              <span>Remarks/Auth.Person</span>
              <input
                value={header.remarks}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-remarks', el)}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                onKeyDown={focusChain.onEnter('ft-remarks')}
              />
            </label>
          </div>

          <p className="goods-inward-form__hint">
            Enter — next field · F1 or 🔍 — help on Party, Broker, Godown, Item, Bard.Item, Cost · + — add party/broker/godown · PO help uses{' '}
            {inwardCtx.sale_order_type === 'C' ? 'Party' : 'Broker'} filter (defvalue SALE_ORDER_TYPE) · balance by{' '}
            {inwardCtx.order_qw === 'Q' ? 'Qty' : 'Weight'} (ORDER_QW)
          </p>

          <VoucherAccountHelpModal
            open={Boolean(helpField)}
            title={helpField === 'bk_code' ? 'Broker help' : 'Party help'}
            accounts={helpField === 'bk_code' ? brokers : purAccounts}
            onSelect={(sel) => pickAccount(helpField, sel, { focusNext: true, closeHelp: true })}
            onClose={() => setHelpField(null)}
          />

          <VoucherGridHelpModal
            open={godownHelpOpen}
            title="Godown help"
            columns={GODOWN_HELP_COLUMNS}
            rows={godownHelpRows}
            searchPlaceholder="Search godown code or name…"
            onSelect={handleGodownHelpSelect}
            onClose={handleGodownHelpClose}
          />

          <VoucherGridHelpModal
            open={poHelpOpen}
            title="Purchase Order help"
            hint={
              inwardCtx.sale_order_type === 'C'
                ? 'Open PO lines for selected party with balance qty/wgt'
                : 'Open PO lines for selected broker with balance qty/wgt'
            }
            columns={[
              { key: 'so_no', label: 'Po.No', align: 'right' },
              {
                key: 'so_date',
                label: 'Date',
                format: (v) => formatLedgerDateDisplay(v) || v,
              },
              { key: 'item_code', label: 'Item', align: 'right' },
              { key: 'item_name', label: 'Name' },
              {
                key: 'rate',
                label: 'Rate',
                align: 'right',
                format: (v) => fmtAmt(v),
              },
              {
                key: 'bqty',
                label: 'Bal.Qty',
                align: 'right',
                format: (v) => fmtAmt(v, 0),
              },
              {
                key: 'bwgt',
                label: 'Bal.Wgt',
                align: 'right',
                format: (v) => fmtWgt(v),
              },
            ]}
            rows={poHelpRows}
            loading={poHelpLoading}
            error={poHelpError}
            onSelect={(row) => pickPoRow(row)}
            onClose={() => {
              setPoHelpOpen(false);
              setPoHelpLine(null);
            }}
          />

          <VoucherItemHelpModal
            open={itemHelpLine != null}
            items={items}
            onSelect={(row) => pickItem(itemHelpLine, row, { focusNext: true })}
            onClose={() => setItemHelpLine(null)}
          />

          <VoucherItemHelpModal
            open={bardHelpLine != null}
            title="Bardana item help"
            items={items}
            onSelect={(row) => pickItem(bardHelpLine, row, { focusNext: true, isBard: true })}
            onClose={() => setBardHelpLine(null)}
          />

          <VoucherGridHelpModal
            open={costHelpLine != null}
            title="Cost centre help"
            columns={COST_HELP_COLUMNS}
            rows={costHelpRows}
            searchPlaceholder="Search cost code or name…"
            onSelect={handleCostHelpSelect}
            onClose={handleCostHelpClose}
          />

          <GoodsInwardListModal
            open={listOpen}
            apiBase={apiBase}
            apiParams={apiParams}
            fyMinYmd={fyMinYmd}
            fyMaxYmd={fyMaxYmd}
            onSelect={(row) => void loadInward(row.bill_no, row.bill_date)}
            onClose={() => setListOpen(false)}
          />

          <GoodsInwardPrintModal
            open={printOpen}
            apiBase={apiBase}
            apiParams={apiParams}
            formData={formData}
            userName={userName}
            defaultBillNo={header.bill_no}
            onClose={() => setPrintOpen(false)}
          />

          <GoodsInwardChecklistModal
            open={checklistOpen}
            apiBase={apiBase}
            apiParams={apiParams}
            fyMinYmd={fyMinYmd}
            fyMaxYmd={fyMaxYmd}
            formData={formData}
            userName={userName}
            purAccounts={purAccounts}
            brokers={brokers}
            items={items}
            godowns={godowns}
            onSelect={(row) => {
              setChecklistOpen(false);
              void loadInward(row.bill_no, row.bill_date);
            }}
            onClose={() => setChecklistOpen(false)}
          />

          <MasterPartyCreateModal
            open={partyAddOpen}
            onClose={() => setPartyAddOpen(false)}
            apiBase={apiBase}
            compCode={compCode}
            compUid={compUid}
            compYear={compYear}
            userName={userName}
            defaultSchedule={PARTY_SCHEDULE}
            lockSchedule
            onCreated={(data) => {
              setPartyAddOpen(false);
              void handlePartyCreated(data, 'code');
            }}
          />

          <MasterPartyCreateModal
            open={brokerAddOpen}
            onClose={() => setBrokerAddOpen(false)}
            apiBase={apiBase}
            compCode={compCode}
            compUid={compUid}
            compYear={compYear}
            userName={userName}
            defaultSchedule={BROKER_SCHEDULE}
            lockSchedule
            onCreated={(data) => {
              setBrokerAddOpen(false);
              void reloadPartyLookups().then(() => {
                const code = data?.code ?? data?.CODE;
                if (code) pickAccount('bk_code', code, { focusNext: true });
              });
            }}
          />

          <GodownFormModal
            open={godownAddOpen}
            onClose={() => setGodownAddOpen(false)}
            apiBase={apiBase}
            compCode={compCode}
            compUid={compUid}
            userName={userName}
            godownOptions={godowns}
            onCreated={(data) => {
              setGodownAddOpen(false);
              void reloadGodowns().then(() => {
                const code = data?.god_code ?? data?.GOD_CODE ?? data?.code ?? data?.CODE;
                if (code) pickGodown({ god_code: code, god_name: data?.god_name ?? data?.GOD_NAME ?? '' }, { focusNext: true });
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
