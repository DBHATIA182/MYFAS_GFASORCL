import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ModuleRightsPanel from './ModuleRightsPanel';
import SalesOrderListModal from './SalesOrderListModal';
import SalesOrderChecklistModal from './SalesOrderChecklistModal';
import SalesOrderPendingModal from './SalesOrderPendingModal';
import SalesOrderPrintModal from './SalesOrderPrintModal';
import MasterPartyCreateModal, { PartyAddButton } from './MasterPartyCreateModal';
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
const AMT_CAL_OPTIONS = ['Q', 'W'];

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];

/** VFP A/c Master schedules — party 11.1, broker 11.2 */
const PARTY_SCHEDULE = 11.1;
const BROKER_SCHEDULE = 11.2;

const reqOpts = { withCredentials: true, timeout: 120000 };

/** VFP SORDER party help: only accounts with SUBSTR(CODE,1,1)='C'. */
function filterSalesParties(rows) {
  return (rows || []).filter((p) =>
    String(p.CODE ?? p.code ?? '').trim().toUpperCase().startsWith('C')
  );
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
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
    usd_rate: '',
    conv_rate: '',
    rate: '',
    amount: '',
  };
}

/** VFP SORDER: rate = usd×conv when both set; amount uses AMT_CAL + G_WGTKQ. */
function recalcLine(line, defaultQw, wgtKq = 'K') {
  const next = { ...line };
  const usd = num(next.usd_rate);
  const conv = num(next.conv_rate);
  if (usd > 0 && conv > 0) {
    next.rate = String(round2(usd * conv));
  }
  const rate = num(next.rate);
  const mode = String(next.amt_cal || defaultQw).trim().toUpperCase() || defaultQw;
  let amount = 0;
  if (mode === 'Q') {
    amount = round2(num(next.qnty) * rate);
  } else if (String(wgtKq || 'K').trim().toUpperCase() === 'Q') {
    amount = round2(num(next.weight) * rate);
  } else {
    amount = round2((num(next.weight) * rate) / 100);
  }
  next.amount = amount ? String(amount) : '';
  return next;
}

function emptyHeader(soDate = '') {
  return {
    so_no: '',
    so_date: soDate,
    delv_date: '',
    pmt_due_days: '',
    code: '',
    party_name: '',
    party_city: '',
    bk_code: '',
    bk_name: '',
    d_e: 'D',
    po_no: '',
    clear_yn: 'N',
    p_condition: '',
    delv_mth: '',
    fgt_rate: '',
    remarks: '',
    remarks2: '',
    remarks3: '',
    vr_date: '',
    vr_no: '',
    vr_type: '',
    vr_type_type: '',
    dr_amt: '',
    rake_truck: 'T',
    delv_city: '',
    god_code: '',
    god_name: '',
    cgst_per: '',
    cgst_amt: '',
    sgst_per: '',
    sgst_amt: '',
    igst_per: '',
    igst_amt: '',
  };
}

export default function SalesOrderEntryForm({ apiBase, formData, userName, onBack }) {
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

  const [sorderQw, setSorderQw] = useState('W');
  const [wgtKq, setWgtKq] = useState('K');
  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultSoDate));
  const [lines, setLines] = useState(() => [emptyLine(1, 'W')]);
  /** Which GST amounts the user typed manually (kept as-is instead of untaxed × pct ÷ 100). */
  const [gstManual, setGstManual] = useState({ cgst: false, sgst: false, igst: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [godowns, setGodowns] = useState([]);

  const [helpField, setHelpField] = useState(null);
  const [soListOpen, setSoListOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const [pendingHidden, setPendingHidden] = useState(false);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);
  const [partyPerms, setPartyPerms] = useState(null);

  useEffect(() => {
    if (formData?.openSoChecklist) setChecklistOpen(true);
  }, [formData?.openSoChecklist]);

  useEffect(() => {
    if (formData?.openSoPrint) setPrintOpen(true);
  }, [formData?.openSoPrint]);

  useEffect(() => {
    const requested = formData?.openSoPending;
    if (requested && ['summary', 'detail', 'date-wise', 'so-do-sale'].includes(requested)) {
      setPendingMode(requested);
      setPendingHidden(false);
    }
  }, [formData?.openSoPending]);
  const [partyAddOpen, setPartyAddOpen] = useState(false);
  const [brokerAddOpen, setBrokerAddOpen] = useState(false);
  const [soPerms, setSoPerms] = useState(null);
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
    const isExport = String(header.d_e || 'D').toUpperCase() === 'E';
    const keys = ['hdr-so-date', 'hdr-delv-date', 'hdr-pmt-days', 'hdr-code', 'hdr-bk', 'hdr-de'];
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-item`,
        `ln-${ln.key}-status`,
        `ln-${ln.key}-qnty`,
        `ln-${ln.key}-weight`,
        `ln-${ln.key}-amtcal`
      );
      if (isExport) {
        keys.push(`ln-${ln.key}-usd`, `ln-${ln.key}-conv`);
      }
      keys.push(`ln-${ln.key}-rate`);
    }
    keys.push(
      'ft-po',
      'ft-pcond',
      'ft-delvmth',
      'ft-fgt',
      'ft-rem1',
      'ft-rem2',
      'ft-rem3',
      'ft-advdate',
      'ft-advno',
      'ft-advtype',
      'ft-advamt',
      'ft-clear',
      'ft-raketruck',
      'ft-delvcity',
      'ft-god',
      'ft-cgstper',
      'ft-cgstamt',
      'ft-sgstper',
      'ft-sgstamt',
      'ft-igstper',
      'ft-igstamt'
    );
    return keys;
  }, [lines, header.d_e]);

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
    if (!soPerms) return;
    if (mode === 'new' && !soPerms.canAdd) {
      setMode('view');
      setStatus('You Can Not Add');
    } else if (mode === 'edit' && !soPerms.canEdit) {
      setMode('view');
      setStatus('You Can Not Edit');
    }
  }, [mode, soPerms]);

  const reloadPermissions = useCallback(async () => {
    const permRes = await axios.get(`${apiBase}/api/sales-order/user-permissions`, {
      params: { comp_uid: compUid, user_name: userName },
      ...reqOpts,
    });
    const perms = permRes.data || {};
    setSoPerms(perms);
    return perms;
  }, [apiBase, compUid, userName]);

  const editable =
    (mode === 'new' && Boolean(soPerms?.canAdd)) || (mode === 'edit' && Boolean(soPerms?.canEdit));
  const canSave =
    editable &&
    !busy &&
    ((mode === 'new' && soPerms?.canAdd) || (mode === 'edit' && soPerms?.canEdit));

  const totals = useMemo(() => {
    let qnty = 0;
    let weight = 0;
    let untaxed = 0;
    for (const ln of lines) {
      if (!ln.item_code) continue;
      qnty += num(ln.qnty);
      weight += num(ln.weight);
      untaxed += num(ln.amount);
    }
    return { qnty, weight, untaxed: round2(untaxed) };
  }, [lines]);

  const gst = useMemo(() => {
    const calc = (perStr, amtStr, manual) => {
      const per = num(perStr);
      if (manual) return round2(amtStr);
      return round2((totals.untaxed * per) / 100);
    };
    const cgstAmt = calc(header.cgst_per, header.cgst_amt, gstManual.cgst);
    const sgstAmt = calc(header.sgst_per, header.sgst_amt, gstManual.sgst);
    const igstAmt = calc(header.igst_per, header.igst_amt, gstManual.igst);
    return {
      cgstAmt,
      sgstAmt,
      igstAmt,
      billAmt: round2(totals.untaxed + cgstAmt + sgstAmt + igstAmt),
    };
  }, [header.cgst_per, header.cgst_amt, header.sgst_per, header.sgst_amt, header.igst_per, header.igst_amt, gstManual, totals.untaxed]);

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
      const permRes = await axios.get(`${apiBase}/api/sales-order/user-permissions`, {
        params: { comp_uid: compUid, user_name: userName },
        ...reqOpts,
      });
      const perms = permRes.data || {};
      setSoPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = apiParams;
      const lookupParams = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, partyRes, brokerRes, godRes, partyPermRes] = await Promise.all([
        axios.get(`${apiBase}/api/sales-order/context`, { params, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-items`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-parties`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params: lookupParams, ...reqOpts }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        }),
      ]);
      const qw = String(ctxRes.data?.sorder_q_w ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W';
      const wk = String(ctxRes.data?.wgt_kq ?? 'K').trim().toUpperCase() === 'Q' ? 'Q' : 'K';
      setSorderQw(qw);
      setWgtKq(wk);
      setItems(itemsRes.data || []);
      setParties(filterSalesParties(partyRes.data));
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      setPartyPerms(partyPermRes.data || null);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Could not load sales order.';
      setPermErr(msg);
      setSoPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, apiParams, compCode, compUid, userName]);

  const reloadPartyLookups = useCallback(async () => {
    if (!compCode) return;
    const params = { comp_code: compCode, comp_uid: compUid };
    const [partyRes, brokerRes] = await Promise.all([
      axios.get(`${apiBase}/api/salelist-parties`, { params, ...reqOpts }),
      axios.get(`${apiBase}/api/salelist-brokers`, { params, ...reqOpts }),
    ]);
    setParties(filterSalesParties(partyRes.data));
    setBrokers(brokerRes.data || []);
  }, [apiBase, compCode, compUid]);

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      const loadedLines = (data?.lines || []).map((ln, idx) => ({
        key: idx + 1,
        item_code: ln.item_code ? String(ln.item_code) : '',
        item_name: String(ln.item_name ?? '').trim(),
        status: String(ln.status ?? 'B').trim().toUpperCase() || 'B',
        qnty: ln.qnty != null ? String(ln.qnty) : '',
        weight: ln.weight != null ? String(ln.weight) : '',
        amt_cal: String(ln.amt_cal ?? sorderQw).trim().toUpperCase() || sorderQw,
        usd_rate: ln.usd_rate != null && num(ln.usd_rate) ? String(ln.usd_rate) : '',
        conv_rate: ln.conv_rate != null && num(ln.conv_rate) ? String(ln.conv_rate) : '',
        rate: ln.rate != null ? String(ln.rate) : '',
        amount: ln.amount != null ? String(ln.amount) : '',
      }));
      const untaxed = round2(loadedLines.reduce((s, ln) => (ln.item_code ? s + num(ln.amount) : s), 0));
      const isManual = (perV, amtV) => {
        const amt = round2(amtV);
        if (!amt) return false;
        return Math.abs(amt - round2((untaxed * num(perV)) / 100)) > 0.005;
      };
      setHeader({
        so_no: String(h.so_no ?? ''),
        so_date: toInputDateString(h.so_date) || defaultSoDate,
        delv_date: toInputDateString(h.delv_date),
        pmt_due_days: h.pmt_due_days != null ? String(h.pmt_due_days) : '',
        code: String(h.code ?? '').trim(),
        party_name: String(h.party_name ?? '').trim(),
        party_city: String(h.party_city ?? '').trim(),
        bk_code: String(h.bk_code ?? '').trim(),
        bk_name: String(h.bk_name ?? '').trim(),
        d_e: String(h.d_e ?? 'D').trim().toUpperCase() === 'E' ? 'E' : 'D',
        po_no: String(h.po_no ?? '').trim(),
        clear_yn: String(h.clear_yn ?? 'N').trim().toUpperCase() || 'N',
        p_condition: String(h.p_condition ?? '').trim(),
        delv_mth: String(h.delv_mth ?? '').trim(),
        fgt_rate: h.fgt_rate != null && num(h.fgt_rate) ? String(h.fgt_rate) : '',
        remarks: String(h.remarks ?? '').trim(),
        remarks2: String(h.remarks2 ?? '').trim(),
        remarks3: String(h.remarks3 ?? '').trim(),
        vr_date: toInputDateString(h.vr_date),
        vr_no: h.vr_no != null && num(h.vr_no) ? String(h.vr_no) : '',
        vr_type: String(h.vr_type ?? '').trim(),
        vr_type_type: String(h.vr_type_type ?? '').trim(),
        dr_amt: h.dr_amt != null && num(h.dr_amt) ? String(h.dr_amt) : '',
        rake_truck: String(h.rake_truck ?? 'T').trim().toUpperCase() === 'R' ? 'R' : 'T',
        delv_city: String(h.delv_city ?? '').trim(),
        god_code: String(h.god_code ?? '').trim(),
        god_name: String(h.god_name ?? '').trim(),
        cgst_per: h.cgst_per != null && num(h.cgst_per) ? String(h.cgst_per) : '',
        cgst_amt: h.cgst_amt != null && num(h.cgst_amt) ? String(h.cgst_amt) : '',
        sgst_per: h.sgst_per != null && num(h.sgst_per) ? String(h.sgst_per) : '',
        sgst_amt: h.sgst_amt != null && num(h.sgst_amt) ? String(h.sgst_amt) : '',
        igst_per: h.igst_per != null && num(h.igst_per) ? String(h.igst_per) : '',
        igst_amt: h.igst_amt != null && num(h.igst_amt) ? String(h.igst_amt) : '',
      });
      setGstManual({
        cgst: isManual(h.cgst_per, h.cgst_amt),
        sgst: isManual(h.sgst_per, h.sgst_amt),
        igst: isManual(h.igst_per, h.igst_amt),
      });
      lineKeyRef.current = loadedLines.length + 1;
      setLines(loadedLines.length ? loadedLines : [emptyLine(1, sorderQw)]);
      setMode('view');
      setStatus('');
    },
    [defaultSoDate, sorderQw]
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
        const { data } = await axios.get(`${apiBase}/api/sales-order`, { params, ...reqOpts });
        applyLoaded(data);
        setStatus('');
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, applyLoaded, apiParams, compCode, header.so_date]
  );

  const handlePendingRow = useCallback(
    (row) => {
      const mType = Number(row?.m_type) || 1;
      const saleType = String(row?.sale_type || '').trim().toUpperCase();
      if (mType === 1 || saleType === 'SO') {
        setPendingHidden(true);
        loadOrder(row.so_no, row.so_date);
        return;
      }
      setStatus(`Cannot open document type "${saleType || '?'}" from pending report.`);
    },
    [loadOrder]
  );

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const focusSoDate = useCallback(() => {
    window.setTimeout(() => focusChain.focusKey('hdr-so-date'), 80);
  }, [focusChain]);

  const startNew = useCallback(async () => {
    if (!compCode) return;
    if (!soPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/sales-order/next-no`, {
        params: apiParams,
        ...reqOpts,
      });
      lineKeyRef.current = 2;
      setHeader({
        ...emptyHeader(defaultSoDate),
        so_no: String(data.so_no ?? ''),
        so_date: defaultSoDate,
        delv_date: defaultSoDate,
      });
      setLines([emptyLine(1, sorderQw), emptyLine(2, sorderQw)]);
      setGstManual({ cgst: false, sgst: false, igst: false });
      setMode('new');
      focusSoDate();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Could not get next number.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, compCode, defaultSoDate, focusSoDate, soPerms?.canAdd, sorderQw]);

  const startEdit = () => {
    if (!header.so_no) {
      setStatus('Load or create a sales order first.');
      return;
    }
    if (!soPerms?.canEdit) {
      setStatus('You Can Not Edit');
      return;
    }
    setMode('edit');
    setStatus('');
  };

  const handleSave = async () => {
    if (mode === 'new' && !soPerms?.canAdd) {
      setStatus('You Can Not Add');
      return;
    }
    if (mode === 'edit' && !soPerms?.canEdit) {
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
        amt_cal: ln.amt_cal || sorderQw,
        usd_rate: num(ln.usd_rate),
        conv_rate: num(ln.conv_rate),
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
      const { data } = await axios.post(
        `${apiBase}/api/sales-order`,
        {
          comp_code: compCode,
          comp_year: compYear,
          comp_uid: compUid,
          mode,
          user_name: userName,
          so_no: Number(header.so_no) || 0,
          so_date: toOracleDate(header.so_date),
          delv_date: toOracleDate(header.delv_date),
          pmt_due_days: Number(header.pmt_due_days) || 0,
          code: header.code.trim(),
          bk_code: header.bk_code.trim(),
          d_e: header.d_e === 'E' ? 'E' : 'D',
          po_no: header.po_no.trim(),
          clear_yn: header.clear_yn,
          p_condition: header.p_condition.trim(),
          delv_mth: header.delv_mth.trim(),
          fgt_rate: num(header.fgt_rate),
          remarks: header.remarks.trim(),
          remarks2: header.remarks2.trim(),
          remarks3: header.remarks3.trim(),
          vr_date: toOracleDate(header.vr_date),
          vr_no: Number(header.vr_no) || 0,
          vr_type: String(header.vr_type || '').trim(),
          vr_type_type: String(header.vr_type_type || '').trim(),
          dr_amt: num(header.dr_amt),
          rake_truck: header.rake_truck === 'R' ? 'R' : 'T',
          delv_city: header.delv_city.trim(),
          god_code: header.god_code.trim(),
          cgst_per: num(header.cgst_per),
          cgst_amt: gst.cgstAmt,
          sgst_per: num(header.sgst_per),
          sgst_amt: gst.sgstAmt,
          igst_per: num(header.igst_per),
          igst_amt: gst.igstAmt,
          bill_amt: gst.billAmt,
          lines: payloadLines,
        },
        reqOpts
      );
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
    if (!soPerms?.canDelete) {
      setStatus('You Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete sales order ${header.so_no}?`)) return;
    setBusy(true);
    setStatus('');
    try {
      await axios.delete(`${apiBase}/api/sales-order`, {
        params: {
          ...apiParams,
          so_no: header.so_no,
          so_date: toOracleDate(header.so_date),
        },
        ...reqOpts,
      });
      lineKeyRef.current = 2;
      setHeader(emptyHeader(defaultSoDate));
      setLines([emptyLine(1, sorderQw)]);
      setGstManual({ cgst: false, sgst: false, igst: false });
      setMode('view');
      setStatus('Deleted.');
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const lookupByPoNo = useCallback(async () => {
    const pono = header.po_no.trim();
    if (!pono || !compCode) return;
    if (mode !== 'view') return;
    setBusy(true);
    setStatus('');
    try {
      const { data } = await axios.get(`${apiBase}/api/sales-order/by-po-no`, {
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
      const pool = field === 'bk_code' ? brokers : parties;
      const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
      const name = String(row?.NAME ?? row?.name ?? '').trim();
      if (field === 'code') {
        const city = String(row?.CITY ?? row?.city ?? '').trim();
        setHeader((h) => ({ ...h, code: c, party_name: name, party_city: city }));
      }
      if (field === 'bk_code') setHeader((h) => ({ ...h, bk_code: c, bk_name: name }));
      if (closeHelp) setHelpField(null);
      if (focusNext) {
        // VFP: after party help selection, cursor returns to the party code field;
        // the user presses Enter there to move to the next column.
        const nextKey = field === 'code' ? 'hdr-code' : field === 'bk_code' ? 'hdr-de' : null;
        if (nextKey) window.setTimeout(() => focusChain.focusKey(nextKey), 0);
      }
    },
    [brokers, parties, focusChain]
  );

  const helpAccounts = useMemo(() => {
    if (helpField === 'bk_code') return brokers;
    return parties;
  }, [helpField, brokers, parties]);

  const pickGodown = useCallback(
    (code, { focusNext = false, closeHelp = false } = {}) => {
      const c = String(code ?? '').trim().toUpperCase();
      const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
      const name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
      setHeader((h) => ({ ...h, god_code: c, god_name: name }));
      if (closeHelp) setGodownHelpOpen(false);
      if (focusNext) window.setTimeout(() => focusChain.focusKey('ft-cgstper'), 0);
    },
    [godowns, focusChain]
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
        case 'godown':
          setGodownHelpOpen(true);
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
        next = recalcLine(next, sorderQw, wgtKq);
        return next;
      })
    );
  };

  const addLine = () => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key, sorderQw)]);
  };

  const setGstPer = (kind, value) => {
    setHeader((h) => ({ ...h, [`${kind}_per`]: value }));
    setGstManual((m) => ({ ...m, [kind]: false }));
  };

  const setGstAmt = (kind, value) => {
    setHeader((h) => ({ ...h, [`${kind}_amt`]: value }));
    setGstManual((m) => ({ ...m, [kind]: true }));
  };

  const gstAmtValue = (kind) => {
    if (gstManual[kind]) return header[`${kind}_amt`];
    const amt = kind === 'cgst' ? gst.cgstAmt : kind === 'sgst' ? gst.sgstAmt : gst.igstAmt;
    return amt ? String(amt) : '';
  };

  const helpTitle = helpField === 'bk_code' ? 'Broker help' : 'Party help';

  return (
    <div className="voucher-entry-form purchase-order-form sales-order-form">
      {permLoading ? <p className="voucher-entry-form__status">Loading permissions…</p> : null}
      {!permLoading && (!soPerms?.canOpen) ? (
        <div className="purchase-order-form__denied">
          <p className="deploy-update-msg deploy-update-msg--err">{permErr || 'Access Denied (SORDER / F10).'}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Close
          </button>
        </div>
      ) : null}
      {!permLoading && soPerms?.canOpen ? (
        <>
      <div className="purchase-order-form__toolbar-row">
      <div className="voucher-entry-form__toolbar voucher-entry-form__toolbar--vfp purchase-order-form__toolbar">
        <button type="button" className="btn btn-sm" onClick={startNew} disabled={busy || !soPerms?.canAdd}>
          New
        </button>
        <button type="button" className="btn btn-sm" onClick={startEdit} disabled={busy || !header.so_no || !soPerms?.canEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-sm" onClick={handleDelete} disabled={busy || !header.so_no || !soPerms?.canDelete}>
          Delete
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={!canSave}>
          Save
        </button>
        <button
          type="button"
          className="btn btn-sm voucher-entry-form__list-btn"
          onClick={() => setSoListOpen(true)}
          disabled={busy}
          title="Browse all sales orders in financial year"
        >
          List
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setChecklistOpen(true)} disabled={busy}>
          CheckList
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingMode('summary')} disabled={busy}>
          PndSum
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingMode('detail')} disabled={busy}>
          PndDet
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingMode('date-wise')} disabled={busy}>
          PndDate
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPendingMode('so-do-sale')} disabled={busy}>
          SO/DO
        </button>
        {pendingHidden ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setPendingHidden(false)}>
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
      <ModuleRightsPanel variant="iconsOnly" perms={soPerms} className="purchase-bill-form__perms" />
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

        <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row sales-order-form__party-row--party">
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
            <input
              className="voucher-entry-form__input voucher-entry-form__input--ro sales-order-form__party-city"
              readOnly
              value={header.party_city}
              title="Party city"
              placeholder="City"
            />
          </div>
        </div>

        <div className="voucher-entry-form__field voucher-entry-form__field--cash-name purchase-order-form__party-row purchase-order-form__party-row--broker">
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

        <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
          <span className="voucher-entry-form__label">(D)omestic / (E)xp</span>
          <select
            className="voucher-entry-form__input"
            value={header.d_e}
            disabled={!editable}
            ref={(el) => focusChain.register('hdr-de', el)}
            onKeyDown={focusChain.onEnter('hdr-de')}
            onChange={(e) => setHeader((h) => ({ ...h, d_e: e.target.value }))}
          >
            <option value="D">D — Domestic</option>
            <option value="E">E — Export</option>
          </select>
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
              <th>Qnty</th>
              <th>Weight</th>
              <th>Amt.Cal</th>
              <th>Usd Rate</th>
              <th>Conv.Rate</th>
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
                    value={ln.amt_cal || sorderQw}
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
                    value={ln.usd_rate}
                    disabled={!editable || header.d_e !== 'E'}
                    ref={(el) => focusChain.register(`ln-${ln.key}-usd`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-usd`)}
                    onChange={(e) => updateLine(ln.key, { usd_rate: e.target.value })}
                    title={header.d_e === 'E' ? 'USD rate (rate = USD × conversion)' : 'Enabled only for Export (E)'}
                  />
                </td>
                <td>
                  <input
                    className="voucher-entry-form__cell voucher-entry-form__amt"
                    value={ln.conv_rate}
                    disabled={!editable || header.d_e !== 'E'}
                    ref={(el) => focusChain.register(`ln-${ln.key}-conv`, el)}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-conv`)}
                    onChange={(e) => updateLine(ln.key, { conv_rate: e.target.value })}
                    title={header.d_e === 'E' ? 'Conversion rate' : 'Enabled only for Export (E)'}
                  />
                </td>
                <td>
                  <input
                    className="voucher-entry-form__cell voucher-entry-form__amt"
                    value={ln.rate}
                    disabled={!editable || (num(ln.usd_rate) > 0 && num(ln.conv_rate) > 0)}
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
        </table>
      </div>

      <div className="voucher-entry-form__foot purchase-order-form__foot sales-order-form__foot">
        <div className="sales-order-form__foot-left">
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
          <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
            <span className="voucher-entry-form__label">Fgt.Rate</span>
            <input
              className="voucher-entry-form__input voucher-entry-form__num"
              value={header.fgt_rate}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-fgt', el)}
              onKeyDown={focusChain.onEnter('ft-fgt')}
              onChange={(e) => setHeader((h) => ({ ...h, fgt_rate: e.target.value }))}
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
          <label className="voucher-entry-form__field purchase-order-form__wide">
            <span className="voucher-entry-form__label">Remarks 3</span>
            <input
              className="voucher-entry-form__input"
              value={header.remarks3}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-rem3', el)}
              onKeyDown={focusChain.onEnter('ft-rem3')}
              onChange={(e) => setHeader((h) => ({ ...h, remarks3: e.target.value }))}
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
            <span className="voucher-entry-form__label">Adv. Vr.No.</span>
            <input
              className="voucher-entry-form__input voucher-entry-form__num"
              value={header.vr_no}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-advno', el)}
              onKeyDown={focusChain.onEnter('ft-advno')}
              onChange={(e) => setHeader((h) => ({ ...h, vr_no: e.target.value }))}
            />
          </label>
          <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
            <span className="voucher-entry-form__label">Adv. Type</span>
            <input
              className="voucher-entry-form__input"
              value={header.vr_type}
              disabled={!editable}
              maxLength={2}
              ref={(el) => focusChain.register('ft-advtype', el)}
              onKeyDown={focusChain.onEnter('ft-advtype')}
              onChange={(e) =>
                setHeader((h) => ({
                  ...h,
                  vr_type: e.target.value.toUpperCase(),
                  vr_type_type: h.vr_type_type || (e.target.value ? 'B' : ''),
                }))
              }
              title="VR_TYPE (e.g. BV)"
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
          <label className="voucher-entry-form__field voucher-entry-form__field--cash-code">
            <span className="voucher-entry-form__label">Rake/Truck Wise (R/T)</span>
            <select
              className="voucher-entry-form__input"
              value={header.rake_truck}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-raketruck', el)}
              onKeyDown={focusChain.onEnter('ft-raketruck')}
              onChange={(e) => setHeader((h) => ({ ...h, rake_truck: e.target.value }))}
            >
              <option value="R">R</option>
              <option value="T">T</option>
            </select>
          </label>
          <label className="voucher-entry-form__field">
            <span className="voucher-entry-form__label">Delivery Station</span>
            <input
              className="voucher-entry-form__input"
              value={header.delv_city}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-delvcity', el)}
              onKeyDown={focusChain.onEnter('ft-delvcity')}
              onChange={(e) => setHeader((h) => ({ ...h, delv_city: e.target.value }))}
            />
          </label>
          <label className="voucher-entry-form__field">
            <span className="voucher-entry-form__label">Loading Location</span>
            <div className="voucher-entry-form__code-help">
              <input
                className="voucher-entry-form__input voucher-entry-form__code"
                list="so-godown-list"
                value={header.god_code}
                disabled={!editable}
                ref={(el) => focusChain.register('ft-god', el)}
                onKeyDown={(e) => handleFieldKeyDown('ft-god', e, 'godown')}
                onChange={(e) => setHeader((h) => ({ ...h, god_code: e.target.value.toUpperCase() }))}
                onBlur={() => pickGodown(header.god_code)}
              />
              <button
                type="button"
                className="voucher-entry-form__code-help-btn"
                disabled={!editable}
                onClick={() => setGodownHelpOpen(true)}
                title="Godown help (F1)"
              >
                🔍
              </button>
              <input className="voucher-entry-form__input voucher-entry-form__name" readOnly value={header.god_name} />
            </div>
            <datalist id="so-godown-list">
              {godowns.map((g) => (
                <option key={g.GOD_CODE ?? g.god_code} value={g.GOD_CODE ?? g.god_code}>
                  {g.GOD_NAME ?? g.god_name}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className="sales-order-form__totals">
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Total (Qnty)</span>
            <span className="voucher-entry-form__tot">{totals.qnty || '0'}</span>
          </div>
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Total (Weight)</span>
            <span className="voucher-entry-form__tot">{fmtWgt(totals.weight)}</span>
          </div>
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Untaxed Subtotal</span>
            <span className="voucher-entry-form__tot">{fmtAmt(totals.untaxed)}</span>
          </div>
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Cgst%</span>
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-per"
              value={header.cgst_per}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-cgstper', el)}
              onKeyDown={focusChain.onEnter('ft-cgstper')}
              onChange={(e) => setGstPer('cgst', e.target.value)}
            />
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-amt"
              value={gstAmtValue('cgst')}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-cgstamt', el)}
              onKeyDown={focusChain.onEnter('ft-cgstamt')}
              onChange={(e) => setGstAmt('cgst', e.target.value)}
              title="CGST amount (auto = untaxed × % ÷ 100, editable)"
            />
          </div>
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Sgst%</span>
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-per"
              value={header.sgst_per}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-sgstper', el)}
              onKeyDown={focusChain.onEnter('ft-sgstper')}
              onChange={(e) => setGstPer('sgst', e.target.value)}
            />
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-amt"
              value={gstAmtValue('sgst')}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-sgstamt', el)}
              onKeyDown={focusChain.onEnter('ft-sgstamt')}
              onChange={(e) => setGstAmt('sgst', e.target.value)}
              title="SGST amount (auto = untaxed × % ÷ 100, editable)"
            />
          </div>
          <div className="sales-order-form__total-row">
            <span className="voucher-entry-form__label">Igst%</span>
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-per"
              value={header.igst_per}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-igstper', el)}
              onKeyDown={focusChain.onEnter('ft-igstper')}
              onChange={(e) => setGstPer('igst', e.target.value)}
            />
            <input
              className="voucher-entry-form__input voucher-entry-form__num sales-order-form__gst-amt"
              value={gstAmtValue('igst')}
              disabled={!editable}
              ref={(el) => focusChain.register('ft-igstamt', el)}
              onKeyDown={focusChain.onEnter('ft-igstamt')}
              onChange={(e) => setGstAmt('igst', e.target.value)}
              title="IGST amount (auto = untaxed × % ÷ 100, editable)"
            />
          </div>
          <div className="sales-order-form__total-row sales-order-form__total-row--bill">
            <span className="voucher-entry-form__label">Bill Amount</span>
            <span className="voucher-entry-form__tot">{fmtAmt(gst.billAmt)}</span>
          </div>
        </div>
      </div>

      {status && <p className="voucher-entry-form__status">{status}</p>}

      <VoucherAccountHelpModal
        open={Boolean(helpField)}
        title={helpTitle}
        accounts={helpAccounts}
        onSelect={(code) =>
          pickAccount(helpField, code, {
            focusNext: helpField === 'code' || helpField === 'bk_code',
            closeHelp: true,
          })
        }
        onClose={() => setHelpField(null)}
      />

      <SalesOrderListModal
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

      <SalesOrderChecklistModal
        open={checklistOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        formData={formData}
        userName={userName}
        parties={parties}
        brokers={brokers}
        items={items}
        godowns={godowns}
        onSelect={(row) => {
          setChecklistOpen(false);
          loadOrder(row.so_no, row.so_date);
        }}
        onClose={() => setChecklistOpen(false)}
      />

      <SalesOrderPendingModal
        open={Boolean(pendingMode)}
        hidden={pendingHidden}
        mode={pendingMode || 'summary'}
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        formData={formData}
        parties={parties}
        brokers={brokers}
        items={items}
        godowns={godowns}
        onSelectRow={handlePendingRow}
        onClose={() => {
          setPendingHidden(false);
          setPendingMode(null);
        }}
      />

      <SalesOrderPrintModal
        open={printOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        formData={formData}
        userName={userName}
        defaultSoNo={header.so_no}
        defaultDe={header.d_e}
        onClose={() => setPrintOpen(false)}
      />

      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownHelpRows}
        onSelect={(row) => pickGodown(row.god_code, { focusNext: true, closeHelp: true })}
        onClose={() => setGodownHelpOpen(false)}
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
          void handlePartyCreated(data, 'bk_code');
        }}
      />
        </>
      ) : null}
    </div>
  );
}
