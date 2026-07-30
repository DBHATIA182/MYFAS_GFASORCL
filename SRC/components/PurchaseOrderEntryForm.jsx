import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import PurchaseOrderChecklistModal from './PurchaseOrderChecklistModal';
import PurchaseOrderListModal from './PurchaseOrderListModal';
import PurchaseOrderPrintModal from './PurchaseOrderPrintModal';
import PurchaseOrderPendingModal from './PurchaseOrderPendingModal';
import PurchaseBillPrintModal from './PurchaseBillPrintModal';
import MasterPartyCreateModal, { PartyAddButton } from './MasterPartyCreateModal';
import { formatLedgerDateDisplay, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  finYearRangeLabel,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';

const BKH_OPTIONS = ['B', 'K', 'H'];
const AMT_CAL_OPTIONS = ['Q', 'W'];

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];

/** VFP A/c Master schedules — party/supp 11.10, broker 11.20 */
const PARTY_SCHEDULE = 11.1;
const SUPPLIER_SCHEDULE = 11.1;
const BROKER_SCHEDULE = 11.2;

const reqOpts = { withCredentials: true, timeout: 120000 };

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function emptyLine(key = 1, defaultQw = 'W') {
  return {
    key,
    item_code: '',
    item_name: '',
    status: 'B',
    qnty: '',
    weight: '',
    amt_cal: defaultQw,
    rate: '',
    amount: '',
  };
}

function calcLineAmount(line, defaultQw = 'W') {
  const rate = num(line.rate);
  const mode = String(line.amt_cal || defaultQw).trim().toUpperCase() || defaultQw;
  const base = mode === 'Q' ? num(line.qnty) : num(line.weight);
  return Math.round(base * rate * 100) / 100;
}

function recalcLine(line, defaultQw) {
  const amount = calcLineAmount(line, defaultQw);
  return { ...line, amount: amount ? String(amount) : '' };
}

function emptyHeader(soDate = '', defaultQw = 'W') {
  return {
    so_no: '',
    so_date: soDate,
    delv_date: '',
    code: '',
    party_name: '',
    bk_code: '',
    bk_name: '',
    sup_code: '',
    sup_name: '',
    loc_code: '',
    god_code: '',
    god_name: '',
    po_no: '',
    clear_yn: 'N',
    pmt_due_days: '',
    p_condition: '',
    delv_mth: '',
    remarks: '',
    remarks2: '',
    remarks3: '',
    vr_date: '',
    vr_no: '',
    dr_amt: '',
  };
}

export default function PurchaseOrderEntryForm({ apiBase, formData, userName, onBack }) {
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;

  const fy = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const fyMinYmd = fy.fyMinYmd;
  const fyMaxYmd = fy.fyMaxYmd;
  const fyRangeLabel = finYearRangeLabel(fyMinYmd, fyMaxYmd);
  const defaultSoDate = useMemo(
    () => toInputDateString(defaultDocDateInFinYear(fyMinYmd, fyMaxYmd)),
    [fyMinYmd, fyMaxYmd]
  );

  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const [porderQw, setPorderQw] = useState('W');
  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultSoDate));
  const [lines, setLines] = useState(() => [emptyLine(1, 'W')]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [purAccounts, setPurAccounts] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [godowns, setGodowns] = useState([]);

  const [helpField, setHelpField] = useState(null);
  const [soListOpen, setSoListOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [pendingSumOpen, setPendingSumOpen] = useState(false);
  const [pendingDetOpen, setPendingDetOpen] = useState(false);
  const [pendingSumHidden, setPendingSumHidden] = useState(false);
  const [pendingDetHidden, setPendingDetHidden] = useState(false);
  const [purchaseBillPrintOpen, setPurchaseBillPrintOpen] = useState(false);
  const [purchaseBillPrintParams, setPurchaseBillPrintParams] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [godownHelpField, setGodownHelpField] = useState(null);
  const [partyPerms, setPartyPerms] = useState(null);
  const [partyAddOpen, setPartyAddOpen] = useState(false);
  const [brokerAddOpen, setBrokerAddOpen] = useState(false);
  const [suppAddOpen, setSuppAddOpen] = useState(false);
  const [poPerms, setPoPerms] = useState(null);
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
    const keys = [
      'hdr-so-date',
      'hdr-delv-date',
      'hdr-pmt-days',
      'hdr-code',
      'hdr-bk',
      'hdr-sup',
      'hdr-loc',
      'hdr-god',
    ];
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-item`,
        `ln-${ln.key}-status`,
        `ln-${ln.key}-qnty`,
        `ln-${ln.key}-weight`,
        `ln-${ln.key}-amtcal`,
        `ln-${ln.key}-rate`
      );
    }
    keys.push('ft-po', 'ft-clear', 'ft-pcond', 'ft-delvmth', 'ft-rem1', 'ft-rem2', 'ft-advdate', 'ft-advamt');
    return keys;
  }, [lines]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  useEffect(() => {
    if (!defaultSoDate) return;
    setHeader((h) => {
      if (h.so_no) return h;
      if (h.so_date) return h;
      return { ...h, so_date: defaultSoDate, delv_date: defaultSoDate };
    });
  }, [defaultSoDate]);

  useEffect(() => {
    if (!poPerms) return;
    if (mode === 'new' && !poPerms.canAdd) {
      setMode('view');
      setStatus('You Can Not Add');
    } else if (mode === 'edit' && !poPerms.canEdit) {
      setMode('view');
      setStatus('You Can Not Edit');
    }
  }, [mode, poPerms]);

  const reloadPermissions = useCallback(async () => {
    const permRes = await axios.get(`${apiBase}/api/purchase-order/user-permissions`, {
      params: { comp_uid: compUid, user_name: userName },
      ...reqOpts,
    });
    const perms = permRes.data || {};
    setPoPerms(perms);
    return perms;
  }, [apiBase, compUid, userName]);

  const editable =
    (mode === 'new' && Boolean(poPerms?.canAdd)) || (mode === 'edit' && Boolean(poPerms?.canEdit));
  const canSave =
    editable &&
    !busy &&
    ((mode === 'new' && poPerms?.canAdd) || (mode === 'edit' && poPerms?.canEdit));

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

  const itemHelpRows = useMemo(() => items || [], [items]);

  const godownHelpRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      const permRes = await axios.get(`${apiBase}/api/purchase-order/user-permissions`, {
        params: { comp_uid: compUid, user_name: userName },
        ...reqOpts,
      });
      const perms = permRes.data || {};
      setPoPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = apiParams;
      const [ctxRes, itemsRes, purRes, brokerRes, godRes, partyPermRes] = await Promise.all([
        axios.get(`${apiBase}/api/purchase-order/context`, { params }),
        axios.get(`${apiBase}/api/purchaselist-items`, { params: { comp_code: compCode, comp_uid: compUid } }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params: { comp_code: compCode, comp_uid: compUid } }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params: { comp_code: compCode, comp_uid: compUid } }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params: { comp_code: compCode, comp_uid: compUid } }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        }),
      ]);
      const qw = String(ctxRes.data?.porder_q_w ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W';
      setPorderQw(qw);
      setItems(itemsRes.data || []);
      setPurAccounts(purRes.data || []);
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      setPartyPerms(partyPermRes.data || null);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Could not load purchase order.';
      setPermErr(msg);
      setPoPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, apiParams, compCode, compUid, userName]);

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

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      setHeader({
        so_no: String(h.so_no ?? ''),
        so_date: toInputDateString(h.so_date) || defaultSoDate,
        delv_date: toInputDateString(h.delv_date),
        code: String(h.code ?? '').trim(),
        party_name: String(h.party_name ?? '').trim(),
        bk_code: String(h.bk_code ?? '').trim(),
        bk_name: String(h.bk_name ?? '').trim(),
        sup_code: String(h.sup_code ?? '').trim(),
        sup_name: String(h.sup_name ?? '').trim(),
        loc_code: String(h.loc_code ?? '').trim(),
        god_code: String(h.god_code ?? '').trim(),
        god_name: String(h.god_name ?? '').trim(),
        po_no: String(h.po_no ?? '').trim(),
        clear_yn: String(h.clear_yn ?? 'N').trim().toUpperCase() || 'N',
        pmt_due_days: h.pmt_due_days != null ? String(h.pmt_due_days) : '',
        p_condition: String(h.p_condition ?? '').trim(),
        delv_mth: String(h.delv_mth ?? '').trim(),
        remarks: String(h.remarks ?? '').trim(),
        remarks2: String(h.remarks2 ?? '').trim(),
        remarks3: String(h.remarks3 ?? '').trim(),
        vr_date: toInputDateString(h.vr_date),
        vr_no: h.vr_no != null ? String(h.vr_no) : '',
        dr_amt: h.dr_amt != null ? String(h.dr_amt) : '',
      });
      const loaded = (data?.lines || []).map((ln, idx) => ({
        key: idx + 1,
        item_code: ln.item_code ? String(ln.item_code) : '',
        item_name: String(ln.item_name ?? '').trim(),
        status: String(ln.status ?? 'B').trim().toUpperCase() || 'B',
        qnty: ln.qnty != null ? String(ln.qnty) : '',
        weight: ln.weight != null ? String(ln.weight) : '',
        amt_cal: String(ln.amt_cal ?? porderQw).trim().toUpperCase() || porderQw,
        rate: ln.rate != null ? String(ln.rate) : '',
        amount: ln.amount != null ? String(ln.amount) : '',
      }));
      lineKeyRef.current = loaded.length + 1;
      setLines(loaded.length ? loaded : [emptyLine(1, porderQw)]);
      setMode('view');
      setStatus('');
    },
    [defaultSoDate, porderQw]
  );

  const loadOrder = useCallback(
    async (soNo, soDate) => {
      if (!compCode || !soNo) return;
      setBusy(true);
      setStatus('Loading…');
      try {
        const params = {
          ...apiParams,
          so_no: soNo,
          so_date: toOracleDate(soDate || header.so_date),
        };
        const { data } = await axios.get(`${apiBase}/api/purchase-order`, { params });
        applyLoaded(data);
        setStatus('');
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, applyLoaded, apiParams, header.so_date]
  );

  const handlePendingDetailRow = useCallback(
    (row) => {
      const mType = Number(row?.m_type) || 1;
      if (mType === 1) {
        if (pendingDetOpen) setPendingDetHidden(true);
        if (pendingSumOpen) setPendingSumHidden(true);
        loadOrder(row.so_no, row.so_date);
        return;
      }
      const typ = String(row?.pu_type || '').trim().toUpperCase();
      if (typ !== 'PU' && typ !== 'DN') {
        setStatus(`Cannot open document type "${typ || '?'}" from pending detail.`);
        return;
      }
      if (pendingDetOpen) setPendingDetHidden(true);
      if (pendingSumOpen) setPendingSumHidden(true);
      const oracleDt = toOracleDate(toInputDateString(row.so_date));
      const rNo = row?.r_no;
      if (rNo == null || rNo === '' || !oracleDt) {
        setStatus('Cannot open bill: missing R no. or date.');
        return;
      }
      setPurchaseBillPrintParams({
        type: typ,
        rNo: String(rNo).trim(),
        oracleDt,
        label: `${typ === 'PU' ? 'Purchase Bill' : 'Debit Note'} — ${typ} / ${rNo} / ${formatLedgerDateDisplay(row.so_date)}`,
      });
      setPurchaseBillPrintOpen(true);
    },
    [loadOrder, pendingDetOpen, pendingSumOpen]
  );

  const restorePendingReport = useCallback(() => {
    setPendingSumHidden(false);
    setPendingDetHidden(false);
  }, []);

  const pendingReportSuspended = pendingSumHidden || pendingDetHidden;

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const focusSoDate = useCallback(() => {
    window.setTimeout(() => focusChain.focusKey('hdr-so-date'), 80);
  }, [focusChain]);

  const startNew = useCallback(async () => {
    if (!compCode) return;
    if (!poPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/purchase-order/next-no`, {
        params: apiParams,
      });
      lineKeyRef.current = 2;
      setHeader({ ...emptyHeader(defaultSoDate, porderQw), so_no: String(data.so_no ?? ''), so_date: defaultSoDate, delv_date: defaultSoDate });
      setLines([emptyLine(1, porderQw), emptyLine(2, porderQw)]);
      setMode('new');
      focusSoDate();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Could not get next number.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, compCode, defaultSoDate, focusSoDate, poPerms?.canAdd, porderQw]);

  const startEdit = () => {
    if (!header.so_no) {
      setStatus('Load or create a purchase order first.');
      return;
    }
    if (!poPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    setMode('edit');
    setStatus('');
  };

  const handleSave = async () => {
    if (mode === 'new' && !poPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    if (mode === 'edit' && !poPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    const fyErr = finYearDateErrorMessage(header.so_date, fyMinYmd, fyMaxYmd, 'SO date');
    if (fyErr) {
      setStatus(fyErr);
      return;
    }
    if (!header.code.trim()) {
      setStatus('Party code is required.');
      return;
    }
    const payloadLines = lines
      .filter((ln) => ln.item_code)
      .map((ln, idx) => ({
        trn_no: idx + 1,
        item_code: Number(ln.item_code) || 0,
        status: ln.status || 'B',
        qnty: num(ln.qnty),
        weight: num(ln.weight),
        amt_cal: ln.amt_cal || porderQw,
        rate: num(ln.rate),
        amount: num(ln.amount),
      }));
    if (!payloadLines.length) {
      setStatus('Enter at least one item line.');
      return;
    }
    setBusy(true);
    setStatus('Saving…');
    try {
      const { data } = await axios.post(`${apiBase}/api/purchase-order`, {
        comp_code: compCode,
        comp_year: compYear,
        comp_uid: compUid,
        mode,
        user_name: userName,
        so_no: Number(header.so_no) || 0,
        so_date: toOracleDate(header.so_date),
        delv_date: toOracleDate(header.delv_date),
        code: header.code.trim(),
        bk_code: header.bk_code.trim(),
        sup_code: header.sup_code.trim(),
        loc_code: header.loc_code.trim(),
        god_code: header.god_code.trim(),
        po_no: header.po_no.trim(),
        clear_yn: header.clear_yn,
        pmt_due_days: Number(header.pmt_due_days) || 0,
        p_condition: header.p_condition.trim(),
        delv_mth: header.delv_mth.trim(),
        remarks: header.remarks.trim(),
        remarks2: header.remarks2.trim(),
        remarks3: header.remarks3.trim(),
        vr_date: toOracleDate(header.vr_date),
        vr_no: Number(header.vr_no) || 0,
        dr_amt: num(header.dr_amt),
        lines: payloadLines,
      });
      setStatus(data.message || 'Saved.');
      await loadOrder(data.so_no, data.so_date);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!header.so_no) return;
    if (!poPerms?.canDelete) {
      setStatus('You Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete purchase order ${header.so_no}?`)) return;
    setBusy(true);
    setStatus('');
    try {
      await axios.delete(`${apiBase}/api/purchase-order`, {
        params: {
          ...apiParams,
          so_no: header.so_no,
          so_date: toOracleDate(header.so_date),
        },
      });
      lineKeyRef.current = 2;
      setHeader(emptyHeader(defaultSoDate, porderQw));
      setLines([emptyLine(1, porderQw)]);
      setMode('view');
      setStatus('Deleted.');
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const openSoList = () => {
    setSoListOpen(true);
  };

  const lookupByPoNo = useCallback(async () => {
    const pono = header.po_no.trim();
    if (!pono || !compCode) return;
    if (mode !== 'view') return;
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/purchase-order/by-po-no`, {
        params: { ...apiParams, po_no: pono },
        ...reqOpts,
      });
      applyLoaded(data);
      setStatus(`Loaded P.O.No. ${pono}.`);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'P.O.No. not found.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, applyLoaded, compCode, header.po_no, mode]);

  const handlePoNoKeyDown = (e) => {
    if (e.key === 'Enter' && mode === 'view' && header.po_no.trim()) {
      e.preventDefault();
      void lookupByPoNo();
      return;
    }
    focusChain.onEnter('ft-po')(e);
  };

  const pickAccount = useCallback(
    (field, code, { focusNext = false, closeHelp = false } = {}) => {
      const c = String(code ?? '').trim().toUpperCase();
      const pool = field === 'bk_code' ? brokers : purAccounts;
      const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
      const name = String(row?.NAME ?? row?.name ?? '').trim();
      if (field === 'code') setHeader((h) => ({ ...h, code: c, party_name: name }));
      if (field === 'bk_code') setHeader((h) => ({ ...h, bk_code: c, bk_name: name }));
      if (field === 'sup_code') setHeader((h) => ({ ...h, sup_code: c, sup_name: name }));
      if (closeHelp) setHelpField(null);
      if (focusNext) {
        const nextKey =
          field === 'code' ? 'hdr-bk' : field === 'bk_code' ? 'hdr-sup' : field === 'sup_code' ? 'hdr-loc' : null;
        if (nextKey) window.setTimeout(() => focusChain.focusKey(nextKey), 0);
      }
    },
    [brokers, purAccounts, focusChain]
  );

  const helpAccounts = useMemo(() => {
    if (helpField === 'bk_code') return brokers;
    return purAccounts;
  }, [helpField, brokers, purAccounts]);

  const pickGodown = useCallback(
    (field, code, { focusNext = false, closeHelp = false } = {}) => {
      const c = String(code ?? '').trim().toUpperCase();
      const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
      const name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
      if (field === 'loc_code') {
        setHeader((h) => ({ ...h, loc_code: c }));
      } else {
        setHeader((h) => ({ ...h, god_code: c, god_name: name }));
      }
      if (closeHelp) setGodownHelpField(null);
      if (focusNext) {
        const nextKey =
          field === 'loc_code'
            ? 'hdr-god'
            : lines[0]
              ? `ln-${lines[0].key}-item`
              : null;
        if (nextKey) window.setTimeout(() => focusChain.focusKey(nextKey), 0);
      }
    },
    [godowns, focusChain, lines]
  );

  const handleSoDateChange = useCallback((v) => {
    setHeader((h) => ({ ...h, so_date: v, delv_date: v }));
  }, []);

  const openHelpForField = useCallback(
    (helpType, lineKey) => {
      switch (helpType) {
        case 'party':
          setHelpField('code');
          break;
        case 'broker':
          setHelpField('bk_code');
          break;
        case 'supp':
          setHelpField('sup_code');
          break;
        case 'loc':
          setGodownHelpField('loc_code');
          break;
        case 'godown':
          setGodownHelpField('god_code');
          break;
        case 'item':
          setItemHelpLine(lineKey ?? lines[0]?.key ?? null);
          break;
        default:
          break;
      }
    },
    [lines]
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

  const handlePartyCreated = useCallback(
    async (data, field) => {
      await reloadPartyLookups();
      const code = data?.code ?? data?.CODE;
      if (code) pickAccount(field, code, { focusNext: true });
    },
    [reloadPartyLookups, pickAccount]
  );

  const updateLine = (key, patch) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        let next = { ...ln, ...patch };
        if (patch.item_code != null) {
          const ic = Number(patch.item_code) || 0;
          const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
          next.item_name = row ? String(row.ITEM_NAME ?? row.item_name ?? '').trim() : '';
        }
        next = recalcLine(next, porderQw);
        return next;
      })
    );
  };

  const addLine = () => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key, porderQw)]);
  };

  const helpTitle =
    helpField === 'code'
      ? 'Party help'
      : helpField === 'bk_code'
        ? 'Broker help'
        : helpField === 'sup_code'
          ? 'Supplier help'
          : 'Account help';

  return (
    <div className="voucher-entry-form purchase-order-form">
      {permLoading ? <p className="voucher-entry-form__status">Loading permissions…</p> : null}
      {!permLoading && (!poPerms?.canOpen) ? (
        <div className="purchase-order-form__denied">
          <p className="deploy-update-msg deploy-update-msg--err">{permErr || 'Access Denied (PORDER / F9).'}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Close
          </button>
        </div>
      ) : null}
      {!permLoading && poPerms?.canOpen ? (
        <>
      <div className="purchase-order-form__toolbar-row">
      <div className="voucher-entry-form__toolbar voucher-entry-form__toolbar--vfp purchase-order-form__toolbar">
        <button type="button" className="btn btn-sm" onClick={startNew} disabled={busy || !poPerms?.canAdd}>
          New
        </button>
        <button type="button" className="btn btn-sm" onClick={startEdit} disabled={busy || !header.so_no || !poPerms?.canEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-sm" onClick={handleDelete} disabled={busy || !header.so_no || !poPerms?.canDelete}>
          Delete
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={!canSave}>
          Save
        </button>
        <button
          type="button"
          className="btn btn-sm voucher-entry-form__list-btn"
          onClick={openSoList}
          disabled={busy}
          title="Browse all purchase orders in financial year"
        >
          List
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setChecklistOpen(true)} disabled={busy}>
          CheckList
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingSumOpen(true)} disabled={busy}>
          PndSum
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingDetOpen(true)} disabled={busy}>
          PndDet
        </button>
        {pendingReportSuspended ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={restorePendingReport}>
            Back to Report
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void reloadPermissions().then(() => {
              if (header.so_no) loadOrder(header.so_no, header.so_date);
            });
          }}
          disabled={busy || !header.so_no}
          title="Reload permissions and refresh record"
        >
          Refresh
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPrintOpen(true)} disabled={busy}>
          Print
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
      <ModuleRightsPanel
        className="purchase-order-form__perms"
        title="PORDER (F9)"
        fieldLabel="F9"
        raw={poPerms?.f9}
        perms={poPerms}
        userName={userName}
        source={poPerms?.source ? String(poPerms.source) : ''}
      />
      </div>

      <div className="voucher-entry-form__header voucher-entry-form__header--vfp purchase-order-form__header">
        <label className="voucher-entry-form__field voucher-entry-form__field--no">
          <span className="voucher-entry-form__label">Sr.No.</span>
          <input className="voucher-entry-form__input voucher-entry-form__input--ro" readOnly value={header.so_no} />
        </label>
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Date</span>
          <VoucherDmyDateInput
            className="voucher-entry-form__input voucher-entry-form__input--date"
            valueYmd={header.so_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!editable}
            title={fyMinYmd && fyMaxYmd ? `dd/mm/yyyy · FY ${fyRangeLabel}` : 'dd/mm/yyyy'}
            inputRef={(el) => focusChain.register('hdr-so-date', el)}
            onChangeYmd={handleSoDateChange}
            onKeyDown={focusChain.onEnter('hdr-so-date')}
          />
        </label>
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Delv Due Date</span>
          <VoucherDmyDateInput
            className="voucher-entry-form__input voucher-entry-form__input--date"
            valueYmd={header.delv_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!editable}
            title="dd/mm/yyyy"
            inputRef={(el) => focusChain.register('hdr-delv-date', el)}
            onChangeYmd={(v) => setHeader((h) => ({ ...h, delv_date: v }))}
            onKeyDown={focusChain.onEnter('hdr-delv-date')}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
          <span className="voucher-entry-form__label">Payment Due Days</span>
          <input
            className="voucher-entry-form__input voucher-entry-form__num"
            value={header.pmt_due_days}
            disabled={!editable}
            ref={(el) => focusChain.register('hdr-pmt-days', el)}
            onKeyDown={focusChain.onEnter('hdr-pmt-days')}
            onChange={(e) => setHeader((h) => ({ ...h, pmt_due_days: e.target.value }))}
          />
        </label>

        <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row">
          <div className="purchase-order-form__label-row">
            <PartyAddButton
              onClick={() => setPartyAddOpen(true)}
              disabled={!editable || busy || !partyPerms?.canAdd}
              title="Add new party (A/c Master schedule 11.10)"
            />
            <span className="voucher-entry-form__label">Party</span>
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
              title="Party help (F1)"
            >
              🔍
            </button>
            <input className="voucher-entry-form__input voucher-entry-form__name" readOnly value={header.party_name} />
          </div>
        </div>

        <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row">
          <div className="purchase-order-form__label-row">
            <PartyAddButton
              onClick={() => setBrokerAddOpen(true)}
              disabled={!editable || busy || !partyPerms?.canAdd}
              title="Add new broker (A/c Master schedule 11.20)"
            />
            <span className="voucher-entry-form__label">Broker</span>
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
              title="Broker help (F1)"
            >
              🔍
            </button>
            <input className="voucher-entry-form__input voucher-entry-form__name" readOnly value={header.bk_name} />
          </div>
        </div>

        <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row">
          <div className="purchase-order-form__label-row">
            <PartyAddButton
              onClick={() => setSuppAddOpen(true)}
              disabled={!editable || busy || !partyPerms?.canAdd}
              title="Add new supplier (A/c Master schedule 11.10)"
            />
            <span className="voucher-entry-form__label">Supp.</span>
          </div>
          <div className="voucher-entry-form__code-help">
            <input
              className="voucher-entry-form__input voucher-entry-form__code"
              value={header.sup_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-sup', el)}
              onKeyDown={(e) => handleFieldKeyDown('hdr-sup', e, 'supp')}
              onChange={(e) => setHeader((h) => ({ ...h, sup_code: e.target.value.toUpperCase() }))}
              onBlur={() => pickAccount('sup_code', header.sup_code)}
            />
            <button
              type="button"
              className="voucher-entry-form__code-help-btn"
              disabled={!editable}
              onClick={() => setHelpField('sup_code')}
              title="Supplier help (F1)"
            >
              🔍
            </button>
            <input className="voucher-entry-form__input voucher-entry-form__name" readOnly value={header.sup_name} />
          </div>
        </div>

        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Location</span>
          <div className="voucher-entry-form__code-help">
            <input
              className="voucher-entry-form__input voucher-entry-form__code"
              list="po-godown-list"
              value={header.loc_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-loc', el)}
              onKeyDown={(e) => handleFieldKeyDown('hdr-loc', e, 'loc')}
              onChange={(e) => setHeader((h) => ({ ...h, loc_code: e.target.value.toUpperCase() }))}
              onBlur={() => pickGodown('loc_code', header.loc_code)}
            />
            <button
              type="button"
              className="voucher-entry-form__code-help-btn"
              disabled={!editable}
              onClick={() => setGodownHelpField('loc_code')}
              title="Godown help (F1)"
            >
              🔍
            </button>
          </div>
        </label>
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Godown</span>
          <div className="voucher-entry-form__code-help">
            <input
              className="voucher-entry-form__input voucher-entry-form__code"
              list="po-godown-list"
              value={header.god_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-god', el)}
              onKeyDown={(e) => handleFieldKeyDown('hdr-god', e, 'godown')}
              onChange={(e) => setHeader((h) => ({ ...h, god_code: e.target.value.toUpperCase() }))}
              onBlur={() => pickGodown('god_code', header.god_code)}
            />
            <button
              type="button"
              className="voucher-entry-form__code-help-btn"
              disabled={!editable}
              onClick={() => setGodownHelpField('god_code')}
              title="Godown help (F1)"
            >
              🔍
            </button>
          </div>
          <datalist id="po-godown-list">
            {godowns.map((g) => (
              <option key={g.GOD_CODE ?? g.god_code} value={g.GOD_CODE ?? g.god_code}>
                {g.GOD_NAME ?? g.god_name}
              </option>
            ))}
          </datalist>
        </label>
      </div>

      <div className="voucher-entry-form__grid-wrap">
        <table className="voucher-entry-form__grid voucher-entry-form__grid--vfp purchase-order-form__grid">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Item</th>
              <th>Item Name</th>
              <th>BKH</th>
              <th>Qnty.</th>
              <th>Weight</th>
              <th>Amt.Cal.</th>
              <th>Rate</th>
              <th>Amount</th>
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
                      ref={(el) => focusChain.register(`ln-${ln.key}-item`, el)}
                      onKeyDown={(e) => handleFieldKeyDown(`ln-${ln.key}-item`, e, 'item', { lineKey: ln.key })}
                      onChange={(e) => updateLine(ln.key, { item_code: e.target.value })}
                      onBlur={() => updateLine(ln.key, { item_code: ln.item_code })}
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
                <td className="voucher-entry-form__name">{ln.item_name}</td>
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
                    className="voucher-entry-form__cell voucher-entry-form__amt"
                    value={ln.qnty}
                    disabled={!editable}
                    ref={(el) => focusChain.register(`ln-${ln.key}-qnty`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-qnty`)}
                    onChange={(e) => updateLine(ln.key, { qnty: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="voucher-entry-form__cell voucher-entry-form__amt"
                    value={ln.weight}
                    disabled={!editable}
                    ref={(el) => focusChain.register(`ln-${ln.key}-weight`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-weight`)}
                    onChange={(e) => updateLine(ln.key, { weight: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="voucher-entry-form__cell voucher-entry-form__cell--type"
                    value={ln.amt_cal || porderQw}
                    disabled={!editable}
                    ref={(el) => focusChain.register(`ln-${ln.key}-amtcal`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-amtcal`)}
                    onChange={(e) => updateLine(ln.key, { amt_cal: e.target.value })}
                  >
                    {AMT_CAL_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o === 'Q' ? 'Qty' : 'Wgt'}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="voucher-entry-form__cell voucher-entry-form__amt"
                    value={ln.rate}
                    disabled={!editable}
                    ref={(el) => focusChain.register(`ln-${ln.key}-rate`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-rate`)}
                    onChange={(e) => updateLine(ln.key, { rate: e.target.value })}
                  />
                </td>
                <td className="voucher-entry-form__amt">{ln.amount ? fmtAmt(ln.amount) : ''}</td>
                <td>
                  {editable && idx === lines.length - 1 && (
                    <button type="button" className="btn btn-xs" onClick={addLine}>
                      +
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="voucher-entry-form__tot-label">
                Totals
              </td>
              <td className="voucher-entry-form__tot">{totals.qnty || '0'}</td>
              <td className="voucher-entry-form__tot">{fmtWgt(totals.weight)}</td>
              <td colSpan={2} />
              <td className="voucher-entry-form__tot">{fmtAmt(totals.amount)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="voucher-entry-form__foot purchase-order-form__foot">
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">P.O.No.</span>
          <input
            className="voucher-entry-form__input"
            value={header.po_no}
            disabled={busy || (mode !== 'view' && !editable)}
            ref={(el) => focusChain.register('ft-po', el)}
            onKeyDown={handlePoNoKeyDown}
            onChange={(e) => setHeader((h) => ({ ...h, po_no: e.target.value }))}
            title={mode === 'view' ? 'Enter P.O.No. and press Enter to load' : 'P.O.No.'}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
          <span className="voucher-entry-form__label">Clear (Y/N)</span>
          <select
            className="voucher-entry-form__input"
            value={header.clear_yn}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-clear', el)}
            onKeyDown={focusChain.onEnter('ft-clear')}
            onChange={(e) => setHeader((h) => ({ ...h, clear_yn: e.target.value }))}
          >
            <option value="N">N</option>
            <option value="Y">Y</option>
          </select>
        </label>
        <label className="voucher-entry-form__field purchase-order-form__wide">
          <span className="voucher-entry-form__label">Payment Conditions</span>
          <input
            className="voucher-entry-form__input"
            value={header.p_condition}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-pcond', el)}
            onKeyDown={focusChain.onEnter('ft-pcond')}
            onChange={(e) => setHeader((h) => ({ ...h, p_condition: e.target.value }))}
          />
        </label>
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Delivery Month</span>
          <input
            className="voucher-entry-form__input"
            value={header.delv_mth}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-delvmth', el)}
            onKeyDown={focusChain.onEnter('ft-delvmth')}
            onChange={(e) => setHeader((h) => ({ ...h, delv_mth: e.target.value }))}
          />
        </label>
        <label className="voucher-entry-form__field purchase-order-form__wide">
          <span className="voucher-entry-form__label">Remarks</span>
          <input
            className="voucher-entry-form__input"
            value={header.remarks}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-rem1', el)}
            onKeyDown={focusChain.onEnter('ft-rem1')}
            onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
          />
        </label>
        <label className="voucher-entry-form__field purchase-order-form__wide">
          <span className="voucher-entry-form__label">Remarks 2</span>
          <input
            className="voucher-entry-form__input"
            value={header.remarks2}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-rem2', el)}
            onKeyDown={focusChain.onEnter('ft-rem2')}
            onChange={(e) => setHeader((h) => ({ ...h, remarks2: e.target.value }))}
          />
        </label>
        <label className="voucher-entry-form__field">
          <span className="voucher-entry-form__label">Adv. Payment Date</span>
          <VoucherDmyDateInput
            className="voucher-entry-form__input voucher-entry-form__input--date"
            valueYmd={header.vr_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!editable}
            title="dd/mm/yyyy"
            inputRef={(el) => focusChain.register('ft-advdate', el)}
            onChangeYmd={(v) => setHeader((h) => ({ ...h, vr_date: v }))}
            onKeyDown={focusChain.onEnter('ft-advdate')}
          />
        </label>
        <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
          <span className="voucher-entry-form__label">Adv. Amt</span>
          <input
            className="voucher-entry-form__input voucher-entry-form__num"
            value={header.dr_amt}
            disabled={!editable}
            ref={(el) => focusChain.register('ft-advamt', el)}
            onKeyDown={focusChain.onEnter('ft-advamt')}
            onChange={(e) => setHeader((h) => ({ ...h, dr_amt: e.target.value }))}
          />
        </label>
      </div>

      {status && <p className="voucher-entry-form__status">{status}</p>}

      <VoucherAccountHelpModal
        open={Boolean(helpField)}
        title={helpTitle}
        accounts={helpAccounts}
        onSelect={(code) =>
          pickAccount(helpField, code, {
            focusNext: helpField === 'code' || helpField === 'bk_code' || helpField === 'sup_code',
            closeHelp: true,
          })
        }
        onClose={() => setHelpField(null)}
      />

      <PurchaseOrderListModal
        open={soListOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        onSelect={(row) => {
          setSoListOpen(false);
          loadOrder(row.so_no, row.so_date);
        }}
        onClose={() => setSoListOpen(false)}
      />

      <PurchaseOrderPrintModal
        open={printOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        formData={formData}
        userName={userName}
        defaultSoNo={header.so_no}
        onClose={() => setPrintOpen(false)}
      />

      <PurchaseOrderPendingModal
        open={pendingSumOpen}
        hidden={pendingSumHidden}
        mode="summary"
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        formData={formData}
        purAccounts={purAccounts}
        brokers={brokers}
        items={items}
        godowns={godowns}
        onSelectRow={handlePendingDetailRow}
        onClose={() => {
          setPendingSumHidden(false);
          setPendingSumOpen(false);
        }}
      />

      <PurchaseOrderPendingModal
        open={pendingDetOpen}
        hidden={pendingDetHidden}
        mode="detail"
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        formData={formData}
        purAccounts={purAccounts}
        brokers={brokers}
        items={items}
        godowns={godowns}
        onSelectRow={handlePendingDetailRow}
        onClose={() => {
          setPendingDetHidden(false);
          setPendingDetOpen(false);
        }}
      />

      <PurchaseBillPrintModal
        open={purchaseBillPrintOpen}
        onClose={() => {
          setPurchaseBillPrintOpen(false);
          setPurchaseBillPrintParams(null);
          setPendingSumHidden(false);
          setPendingDetHidden(false);
        }}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={purchaseBillPrintParams}
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
      />

      <PurchaseOrderChecklistModal
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
          loadOrder(row.so_no, row.so_date);
        }}
        onClose={() => setChecklistOpen(false)}
      />

      <VoucherGridHelpModal
        open={godownHelpField != null}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownHelpRows}
        onSelect={(row) =>
          pickGodown(godownHelpField, row.god_code, {
            focusNext: godownHelpField === 'loc_code' || godownHelpField === 'god_code',
            closeHelp: true,
          })
        }
        onClose={() => setGodownHelpField(null)}
      />

      <VoucherItemHelpModal
        open={itemHelpLine != null}
        title="Item help"
        items={itemHelpRows}
        onSelect={(row) => {
          if (itemHelpLine != null) {
            updateLine(itemHelpLine, {
              item_code: String(row.item_code),
              item_name: row.item_name,
            });
          }
          setItemHelpLine(null);
        }}
        onClose={() => setItemHelpLine(null)}
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

      <MasterPartyCreateModal
        open={suppAddOpen}
        onClose={() => setSuppAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={SUPPLIER_SCHEDULE}
        lockSchedule
        onCreated={(data) => {
          setSuppAddOpen(false);
          void handlePartyCreated(data, 'sup_code');
        }}
      />
        </>
      ) : null}
    </div>
  );
}
