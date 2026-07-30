import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import ModuleRightsPanel from './ModuleRightsPanel';
import SaleBillToolbar from './SaleBillToolbar';
import SaleBillPrintModal from './SaleBillPrintModal';
import SaleBillTabContent, { SaleBillTabBar, SB_TAB, getSbTabList } from './SaleBillTabContent';
import { toInputDateString, toOracleDate, toOracleDateFromAny } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import {
  num,
  recalcLine,
  sumSaleGrid,
  applyItemmastToLine,
  applyDaneAmtCal,
  applyPaplooCal,
  recalcExpenseSummary,
  getExpenseSummaryFocusKeys,
  getOthExpensesFocusKeys,
  getBillExpensesFocusKeys,
  validateSaleLedgerExpenseCodes,
} from '../utils/saleBillCalc';
import { getVisibleSaleGridColumns } from './SaleBillGridPanel';
import '../styles/voucherEntryForm.css';
import '../styles/gfasToolbar.css';
import '../styles/saleBillForm.css';

const SALE_TYPE = 'SL';

const GOD_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];
const SO_HELP_COLUMNS = [
  { key: 'so_no', label: 'So.No' },
  { key: 'so_date', label: 'Date' },
  { key: 'item_code', label: 'Item' },
  { key: 'item_name', label: 'Name' },
  { key: 'b_qty', label: 'Bal.Qty' },
  { key: 'rate', label: 'Rate' },
];
const CH_HELP_COLUMNS = [
  { key: 'ch_no', label: 'Ch.No' },
  { key: 'ch_date', label: 'Date' },
  { key: 'item_code', label: 'Item' },
  { key: 'item_name', label: 'Name' },
  { key: 'b_qty', label: 'Bal.Qty' },
];
/** VFP Lothlp browse columns (sale_gst). */
const LOT_HELP_COLUMNS = [
  { key: 'b_no', label: 'B_no', align: 'right' },
  { key: 'sup_code', label: 'SCODE' },
  { key: 'sup_name', label: 'Sup_name' },
  { key: 'item_code', label: 'ITEM', align: 'right' },
  { key: 'item_name', label: 'INAME' },
  { key: 'lot', label: 'Lot' },
  { key: 'status', label: 'U' },
  { key: 'god_code', label: 'GD' },
  { key: 'vr_date', label: 'ARV.DATE' },
  { key: 'rqty', label: 'Rqty', align: 'right' },
  { key: 'sqty', label: 'Sqty', align: 'right' },
  { key: 'b_qty', label: 'Bqty', align: 'right' },
  {
    key: 'b_wgt',
    label: 'Bwgt',
    align: 'right',
    format: (v) => (v == null || v === '' ? '' : Number(v).toFixed(3)),
  },
  { key: 'remarks', label: 'Remarks' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'msup_name', label: 'Msup_name' },
];
const DANE_HELP_COLUMNS = [
  { key: 'dane', label: 'Dane' },
  { key: 'bags', label: 'Bags', align: 'right' },
  { key: 'katta', label: 'Katta', align: 'right' },
  { key: 'hkatta', label: 'HKatta', align: 'right' },
];
const BILL_LIST_COLUMNS = [
  { key: 'bill_no', label: 'Bill.No' },
  { key: 'bill_date', label: 'Date' },
  { key: 'code', label: 'Code' },
  { key: 'party_name', label: 'Party' },
  { key: 'bill_amt', label: 'Amount' },
];

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** Try each API path in order — lets the frontend land ahead of a still-in-progress backend. */
async function getWithFallback(paths, params) {
  let lastErr;
  for (const url of paths) {
    try {
      return await axios.get(url, { params, ...reqOpts });
    } catch (err) {
      lastErr = err;
      if (err.response && err.response.status !== 404) throw err;
    }
  }
  throw lastErr;
}

function emptyLine(key = 1, billDate = '') {
  return {
    key,
    trn_no: key,
    so_no: '',
    ch_no: '',
    item_code: '',
    item_name: '',
    lot: '',
    status: 'B',
    b_no: '',
    god_code: '',
    god_name: '',
    sup_code: '',
    sname: '',
    marka: '',
    qnty: '',
    packing: '',
    g_weight: '',
    d_weight: '',
    weight: '',
    weight_manual: false,
    b_qty: '',
    b_wgt: '',
    unit_type: '',
    s_rate: '',
    rate: '',
    amount: '',
    comm_per: '',
    brok_per: '',
    dane: '',
    dane_wgt: '',
    dane_amt: '',
    item_cat: '',
    paploo1: '',
    paploo2: '',
    paploo3: '',
    paploo4: '',
    paploo5: '',
    p_amt1: '',
    p_amt2: '',
    p_amt3: '',
    p_amt4: '',
    p_amt5: '',
    cal: 1,
    e_d: '',
    e_damt: '',
    s_exp1: '',
    s_exp2: '',
    s_exp3: '',
    dis_per: '',
    dis_amt: '',
    cgst_per: '',
    cgst_amt: '',
    sgst_per: '',
    sgst_amt: '',
    igst_per: '',
    igst_amt: '',
    cost_code: '',
    // VFP default: SUP_DATE = bill_date
    sup_date: billDate || '',
    bard_item_code: '',
    bard_item_name: '',
  };
}

function emptyOthExpFields() {
  const o = {};
  for (let i = 1; i <= 10; i += 1) {
    o[`oth_exp${i}`] = '';
    o[`oth_cd${i}`] = '';
  }
  return o;
}

function emptyFooter(ctx = {}) {
  return {
    labour: '',
    labour_code: ctx.G_LABCD || ctx.labour_code || '',
    freight: '',
    freight_code: ctx.G_FGTCD || ctx.freight_code || '',
    ins: '',
    ins_code: ctx.G_INS_CODE || ctx.ins_code || '',
    comm_per: '',
    comm_amt: '',
    comm_code: ctx.comm_code || '',
    brok_per: '',
    brok_amt: '',
    brok_code: ctx.G_DALALI_CODE || ctx.brok_code || '',
    arh_per: '',
    arh_amt: '',
    arh_code: '',
    ...emptyOthExpFields(),
    oth_exp: '',
    oth_code: ctx.oth_code || '',
    round_off: '',
    dis_code: ctx.dis_code || '',
    cgst_code: ctx.G_CGST_CODE || ctx.cgst_code || '',
    sgst_code: ctx.G_SGST_CODE || ctx.sgst_code || '',
    igst_code: ctx.G_IGST_CODE || ctx.igst_code || '',
    tds_on_amt: '',
    tds_on_manual: false,
    tds_per: '',
    tds_amt: '',
    tds_code: ctx.G_TDS_CODE || ctx.tds_code || '',
    rl_type: '',
    dane_code: '',
    p_code1: '',
    p_code2: '',
    p_code3: '',
    p_code5: '',
    p_amt1: '',
    p_amt2: '',
    p_amt3: '',
    p_amt5: '',
    tot_wgt: '',
    tot_fgt: '',
    adv_fgt: '',
    to_pay: '',
    e_lab_rate: '',
    e_lab_cal: '',
    e_lab_amt: '',
    l_d_code: '',
    l_c_code: '',
    l_dane: '',
    l_dane_code: '',
    l_dane_amt: '',
    l_dane_wgt: '',
    l_cd_per: '',
    l_cd_code: '',
    l_cd_amt: '',
    l_ch_per: '',
    l_ch_code: '',
    l_ch_amt: '',
    l_qc_per: '',
    l_qc_code: '',
    l_qc_amt: '',
    ld_per: '',
    ld_code: '',
    ld_amt: '',
    saleman: '',
    disp_from: '',
    irn_no: '',
    ack_no: '',
    eway_bill_no: '',
    eway_date: '',
    eway_valid: '',
    qr_code: '',
    eway_reason: '',
    eway_close: '',
  };
}

function emptyHeader(billDate = '') {
  return {
    bill_date: billDate,
    bill_no: '',
    b_type: 'N',
    v_date: billDate,
    due: '',
    int_type: '',
    code: '',
    party_name: '',
    party_city: '',
    gst_no: '',
    pan: '',
    cur_bal: '',
    l_c: 'L',
    b_code: '',
    bk_name: '',
    delv_code: '',
    delv_name: '',
    gr_no: '',
    tpt: '',
    truck: '',
    form: '',
    remarks: '',
  };
}

/**
 * OTH_EXP n visibility from SALEFORM_GST S_NO=0 rows.
 * HIDE_COL='Y' → hide; missing row → show (entry always available).
 */
function visibleOthExpFromCtx(ctx) {
  const rows = Array.isArray(ctx?.header_fields) ? ctx.header_fields : [];
  if (!rows.length) return null; // show all 1–10
  const hide = new Set();
  for (const r of rows) {
    const f = String(r.F_NAME ?? r.f_name ?? '').trim().toUpperCase();
    const m = /^OTH_EXP(\d{1,2})$/.exec(f);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 10) continue;
    if (String(r.HIDE_COL ?? r.hide_col ?? 'N').trim().toUpperCase() === 'Y') hide.add(n);
  }
  if (!hide.size) return null;
  return Array.from({ length: 10 }, (_, i) => i + 1).filter((n) => !hide.has(n));
}

export default function SaleBillEntryForm({ apiBase, formData, userName, onBack, onOpenChecklist }) {
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
  const [header, setHeader] = useState(() => emptyHeader(defaultDocDate));
  const [footer, setFooter] = useState(() => emptyFooter());
  const [lines, setLines] = useState(() => [emptyLine(1, defaultDocDate), emptyLine(2, defaultDocDate)]);
  const [ctx, setCtx] = useState({ wgt_kq: 'W', sale_cal: 'W', grid_columns: [] });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [markas, setMarkas] = useState([]);
  const [daneTypes, setDaneTypes] = useState([]);
  const [sbPerms, setSbPerms] = useState(null);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const [helpField, setHelpField] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [supHelpLine, setSupHelpLine] = useState(null);
  const [godHelpLine, setGodHelpLine] = useState(null);
  const [markaHelpLine, setMarkaHelpLine] = useState(null);
  const [daneHelp, setDaneHelp] = useState({ open: false, line: null, rows: [], loading: false, error: '' });
  const [soHelp, setSoHelp] = useState({ open: false, line: null, rows: [], loading: false, error: '' });
  const [chHelp, setChHelp] = useState({ open: false, line: null, rows: [], loading: false, error: '' });
  const [lotHelp, setLotHelp] = useState({ open: false, line: null, rows: [], loading: false, error: '' });
  const [billListOpen, setBillListOpen] = useState(false);
  const [billListRows, setBillListRows] = useState([]);
  const [billListLoading, setBillListLoading] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(SB_TAB.HEADER);
  const [uiLocked, setUiLocked] = useState(false);

  const lineKeyRef = useRef(3);
  const newBtnRef = useRef(null);
  const entryFocusDoneRef = useRef(false);
  const lastBillLookupRef = useRef('');
  const helpReturnFocusRef = useRef(null);
  const billDateBlurTaskRef = useRef(null);

  const apiParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName }),
    [compCode, compUid, userName]
  );

  const editable = mode === 'new' || mode === 'edit';
  /** Lock only B.Type / Bill No after number is assigned — Bill Date must stay editable (VFP order). */
  const docNoLocked = uiLocked || mode === 'edit' || (mode === 'new' && !!String(header.bill_no ?? '').trim());
  const dateEditable = !busy && !uiLocked && mode !== 'edit';
  const sbTabs = useMemo(() => getSbTabList(), []);

  const visibleColumns = useMemo(
    () => getVisibleSaleGridColumns(ctx?.grid_columns || []),
    [ctx?.grid_columns]
  );
  const visibleOthExp = useMemo(() => visibleOthExpFromCtx(ctx), [ctx]);

  const totals = useMemo(() => sumSaleGrid(lines, footer, ctx), [lines, footer, ctx]);

  const godownHelpRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const focusOrder = useMemo(() => {
    const keys = ['hdr-btype', 'hdr-billno', 'hdr-billdt', 'hdr-vdate', 'hdr-due', 'hdr-int_type', 'hdr-code', 'hdr-bk', 'hdr-delv'];
    for (const ln of lines) {
      for (const col of visibleColumns) {
        if (col.key === 'item_name' || col.key === 'sname') continue;
        keys.push(`ln-${ln.key}-${col.key}`);
      }
    }
    keys.push(...getOthExpensesFocusKeys(visibleOthExp));
    keys.push(...getExpenseSummaryFocusKeys());
    keys.push(...getBillExpensesFocusKeys());
    return keys;
  }, [lines, visibleColumns, visibleOthExp]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  const restoreHelpFocus = useCallback(() => {
    const key = helpReturnFocusRef.current;
    helpReturnFocusRef.current = null;
    if (!key) return;
    if (key.startsWith('hdr-')) setActiveTab(SB_TAB.HEADER);
    else if (key.startsWith('ln-')) setActiveTab(SB_TAB.GRID1);
    else if (key.startsWith('oe-')) setActiveTab(SB_TAB.OTH_EXP);
    else if (key.startsWith('ft-')) setActiveTab(SB_TAB.EXPENSES);
    else if (key.startsWith('be-')) setActiveTab(SB_TAB.BILL_EXP);
    // After a help pick, cursor goes to the NEXT column — never back to the same field.
    window.setTimeout(() => {
      if (!focusChain.focusAfterHelp(key)) {
        window.setTimeout(() => focusChain.focusAfterHelp(key), 80);
      }
    }, 80);
  }, [focusChain]);

  const openHelp = useCallback((helpKey, focusKey = null) => {
    if (focusKey) helpReturnFocusRef.current = focusKey;
    setHelpField(helpKey);
  }, []);

  const closeAccountHelp = useCallback(() => {
    setHelpField(null);
    restoreHelpFocus();
  }, [restoreHelpFocus]);

  useEffect(() => {
    if (permLoading || permErr || entryFocusDoneRef.current || !sbPerms?.canOpen) return;
    entryFocusDoneRef.current = true;
    window.setTimeout(() => focusChain.focusKey('hdr-btype'), 80);
  }, [focusChain, permErr, permLoading, sbPerms?.canOpen]);

  const closeHelpModals = useCallback(() => {
    helpReturnFocusRef.current = null;
    setHelpField(null);
    setItemHelpLine(null);
    setSupHelpLine(null);
    setGodHelpLine(null);
    setMarkaHelpLine(null);
    setDaneHelp((s) => ({ ...s, open: false }));
    setSoHelp((s) => ({ ...s, open: false }));
    setChHelp((s) => ({ ...s, open: false }));
    setLotHelp((s) => ({ ...s, open: false }));
  }, []);

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    if (compUid == null || String(compUid).trim() === '' || !String(userName || '').trim()) {
      setPermLoading(false);
      setPermErr('comp_uid and user_name are required');
      setSbPerms(null);
      return;
    }
    setPermLoading(true);
    setPermErr('');
    try {
      const permRes = await getWithFallback(
        [
          `${apiBase}/api/sale-bill-entry/user-permissions`,
          `${apiBase}/api/sale-bill-user-permissions`,
        ],
        {
          comp_uid: compUid,
          user_name: userName,
        }
      );
      const perms = permRes.data || {};
      setSbPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, partyRes, brokerRes, godRes, lookupRes, daneRes] = await Promise.all([
        getWithFallback([`${apiBase}/api/sale-bill-entry/context`], params),
        axios.get(`${apiBase}/api/salelist-items`, { params }),
        axios.get(`${apiBase}/api/salelist-parties`, { params }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params }),
        axios.get(`${apiBase}/api/sale-bill-lookups`, { params }).catch(() => ({ data: null })),
        axios.get(`${apiBase}/api/sale-bill-entry/dane-help`, { params }).catch(() => ({ data: [] })),
      ]);
      const c = ctxRes.data || {};
      const wgtRaw = String(c.wgt_kq ?? c.G_WGTKQ ?? 'K').trim().toUpperCase().slice(0, 1) || 'K';
      setCtx({
        wgt_kq: ['K', 'Q', 'X', 'W'].includes(wgtRaw) ? wgtRaw : 'K',
        sale_cal: String(c.sale_cal ?? c.G_SALE_CAL ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W',
        neg_stock: String(c.neg_stock ?? c.G_NEG_STOCK ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
        neg_stock_qw: String(c.neg_stock_qw ?? c.G_NEG_STOCK_QW ?? 'Q').trim().toUpperCase() === 'W' ? 'W' : 'Q',
        dane_less_paploo:
          String(c.dane_less_paploo ?? c.G_DANE_LESS_PAPLOO ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
        grid_columns: Array.isArray(c.grid_columns) ? c.grid_columns : [],
        header_fields: Array.isArray(c.header_fields) ? c.header_fields : [],
        ...c,
      });
      setFooter(emptyFooter(c));
      const lookupItems = Array.isArray(lookupRes.data?.items) ? lookupRes.data.items : [];
      setItems(lookupItems.length ? lookupItems : itemsRes.data || []);
      setParties(
        (partyRes.data || []).filter((p) =>
          String(p.CODE ?? p.code ?? '')
            .trim()
            .toUpperCase()
            .startsWith('C')
        )
      );
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      const markaRows = Array.isArray(lookupRes.data?.markas) ? lookupRes.data.markas : [];
      setMarkas(
        markaRows
          .map((r) => ({ marka: String(r.MARKA ?? r.marka ?? '').trim() }))
          .filter((r) => r.marka)
      );
      const daneRows = Array.isArray(daneRes.data) ? daneRes.data : daneRes.data?.rows || [];
      setDaneTypes(daneRows);
    } catch (err) {
      setPermErr(err.response?.data?.error || err.message || 'Could not load sale bill.');
      setSbPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      const curBal = Number(h.cur_bal);
      const partyCode = h.code || '';
      const partyHit = (parties || []).find(
        (a) => String(a.CODE ?? a.code ?? '').trim() === String(partyCode).trim()
      );
      const lcRaw = String(h.l_c ?? h.L_C ?? partyHit?.L_C ?? partyHit?.l_c ?? 'L')
        .trim()
        .toUpperCase()
        .slice(0, 1) || 'L';
      setHeader({
        bill_date: toInputDateString(h.bill_date) || defaultDocDate,
        bill_no: h.bill_no ? String(h.bill_no) : '',
        b_type: String(h.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
        v_date: toInputDateString(h.v_date) || defaultDocDate,
        due: h.due != null && h.due !== '' ? String(h.due) : '',
        code: partyCode,
        party_name: h.party_name || '',
        party_city: h.party_city || '',
        gst_no: h.gst_no || '',
        pan: h.pan || '',
        l_c: lcRaw === 'C' || lcRaw === 'I' ? lcRaw : 'L',
        cur_bal: h.cur_bal != null && h.cur_bal !== ''
          ? (Number.isFinite(curBal) ? curBal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(h.cur_bal))
          : '',
        b_code: h.b_code || '',
        bk_name: h.bk_name || '',
        delv_code: h.delv_code || '',
        delv_name: h.delv_name || '',
        gr_no: h.gr_no || '',
        tpt: h.tpt || '',
        truck: h.truck || '',
        form: h.form || '',
        remarks: h.remarks || '',
        int_type: h.int_type != null ? String(h.int_type).trim().toUpperCase().slice(0, 1) : '',
      });
      setFooter((f) => {
        const next = {
          ...f,
          labour: h.labour != null ? String(h.labour) : '',
          labour_code: h.labour_code || h.labcd || f.labour_code,
          freight: h.freight != null ? String(h.freight) : '',
          freight_code: h.freight_code || h.fgtcd || f.freight_code,
          ins: h.ins != null ? String(h.ins) : '',
          ins_code: h.ins_code || f.ins_code,
          comm_per: h.comm_per != null ? String(h.comm_per) : '',
          comm_amt: h.comm_amt != null ? String(h.comm_amt) : '',
          comm_code: h.comm_code || f.comm_code,
          brok_per: h.brok_per != null ? String(h.brok_per) : '',
          brok_amt: h.brok_amt != null ? String(h.brok_amt) : '',
          brok_code: h.brok_code || f.brok_code,
          arh_per: h.arh_per != null ? String(h.arh_per) : '',
          arh_amt: h.arh_amt != null ? String(h.arh_amt) : '',
          arh_code: h.arh_code || f.arh_code,
          oth_exp: h.oth_exp != null ? String(h.oth_exp) : '',
          oth_code: h.oth_code || h.add_code || f.oth_code,
          round_off: h.round_off != null ? String(h.round_off) : '',
          dis_code: h.dis_code || f.dis_code,
          cgst_code: h.cgst_code || f.cgst_code,
          sgst_code: h.sgst_code || f.sgst_code,
          igst_code: h.igst_code || f.igst_code,
          tds_on_amt: h.tds_on_amt != null ? String(h.tds_on_amt) : '',
          tds_on_manual: h.tds_on_amt != null && Number(h.tds_on_amt) !== 0,
          tds_per: h.tds_per != null ? String(h.tds_per) : '',
          tds_amt: h.tds_amt != null ? String(h.tds_amt) : '',
          tds_code: h.tds_code || f.tds_code,
        };
        for (let i = 1; i <= 10; i += 1) {
          const ev = h[`oth_exp${i}`] ?? h[`OTH_EXP${i}`];
          const cv = h[`oth_cd${i}`] ?? h[`OTH_CD${i}`];
          next[`oth_exp${i}`] = ev != null && ev !== '' ? String(ev) : '';
          next[`oth_cd${i}`] = cv != null && cv !== '' ? String(cv) : '';
        }
        const copyStr = (key, ...alts) => {
          for (const k of [key, ...alts]) {
            const v = h[k];
            if (v != null && v !== '') {
              next[key] = String(v);
              return;
            }
          }
        };
        copyStr('dane_code', 'DANE_CODE');
        copyStr('p_code1', 'P_CODE1');
        copyStr('p_code2', 'P_CODE2');
        copyStr('p_code3', 'P_CODE3');
        copyStr('p_code5', 'P_CODE5');
        copyStr('p_amt1', 'P_AMT1', 'T_PAMT1');
        copyStr('p_amt2', 'P_AMT2', 'T_PAMT2');
        copyStr('p_amt3', 'P_AMT3', 'T_PAMT3');
        copyStr('p_amt5', 'P_AMT5', 'T_PAMT5');
        copyStr('tot_wgt', 'TOT_WGT');
        copyStr('tot_fgt', 'TOT_FGT');
        copyStr('adv_fgt', 'ADV_FGT');
        copyStr('to_pay', 'TO_PAY');
        copyStr('e_lab_rate', 'E_LAB_RATE');
        copyStr('e_lab_cal', 'E_LAB_CAL');
        copyStr('e_lab_amt', 'E_LAB_AMT');
        copyStr('l_d_code', 'L_D_CODE');
        copyStr('l_c_code', 'L_C_CODE');
        copyStr('l_dane', 'L_DANE');
        copyStr('l_dane_code', 'L_DANE_CODE');
        copyStr('l_dane_amt', 'L_DANE_AMT');
        copyStr('l_dane_wgt', 'L_DANE_WGT');
        copyStr('l_cd_per', 'L_CD_PER');
        copyStr('l_cd_code', 'L_CD_CODE');
        copyStr('l_cd_amt', 'L_CD_AMT');
        copyStr('l_ch_per', 'L_CH_PER');
        copyStr('l_ch_code', 'L_CH_CODE');
        copyStr('l_ch_amt', 'L_CH_AMT');
        copyStr('l_qc_per', 'L_QC_PER');
        copyStr('l_qc_code', 'L_QC_CODE');
        copyStr('l_qc_amt', 'L_QC_AMT');
        copyStr('ld_per', 'LD_PER');
        copyStr('ld_code', 'LD_CODE');
        copyStr('ld_amt', 'LD_AMT');
        copyStr('saleman', 'SALEMAN');
        copyStr('disp_from', 'DISP_FROM');
        copyStr('irn_no', 'IRN_NO');
        copyStr('ack_no', 'ACK_NO');
        copyStr('eway_bill_no', 'EWAY_BILL_NO');
        copyStr('eway_date', 'EWAY_DATE');
        copyStr('eway_valid', 'EWAY_VALID');
        copyStr('qr_code', 'QR_CODE');
        copyStr('eway_reason', 'EWAY_REASON', 'REASON');
        copyStr('eway_close', 'EWAY_CLOSE');
        copyStr('rl_type', 'RL_TYPE');
        return next;
      });
      const loaded = (data?.lines || []).map((ln, idx) => ({
        key: idx + 1,
        trn_no: ln.trn_no || idx + 1,
        so_no: ln.so_no ? String(ln.so_no) : '',
        ch_no: ln.ch_no ? String(ln.ch_no) : '',
        item_code: ln.item_code ? String(ln.item_code) : '',
        item_name: ln.item_name || '',
        lot: ln.lot ? String(ln.lot) : '',
        status: ln.status || 'B',
        b_no: ln.b_no ? String(ln.b_no) : '',
        god_code: ln.god_code || '',
        god_name: ln.god_name || '',
        sup_code: ln.sup_code || '',
        sname: ln.sname || '',
        marka: ln.marka || '',
        qnty: ln.qnty != null && ln.qnty !== '' ? String(ln.qnty) : '',
        packing: ln.packing != null && ln.packing !== '' ? String(ln.packing) : '',
        g_weight: ln.g_weight != null && ln.g_weight !== '' ? String(ln.g_weight) : '',
        d_weight: ln.d_weight != null && ln.d_weight !== '' ? String(ln.d_weight) : '',
        weight: ln.weight != null && ln.weight !== '' ? String(ln.weight) : '',
        weight_manual: true,
        s_rate: ln.s_rate != null && ln.s_rate !== '' ? String(ln.s_rate) : '',
        rate: ln.rate != null && ln.rate !== '' ? String(ln.rate) : '',
        amount: ln.amount != null && ln.amount !== '' ? String(ln.amount) : '',
        comm_per: ln.comm_per != null && ln.comm_per !== '' ? String(ln.comm_per) : '',
        brok_per: ln.brok_per != null && ln.brok_per !== '' ? String(ln.brok_per) : '',
        dane: ln.dane != null && ln.dane !== '' ? String(ln.dane) : '',
        dane_wgt: ln.dane_wgt != null && ln.dane_wgt !== '' ? String(ln.dane_wgt) : '',
        dane_amt: ln.dane_amt != null && ln.dane_amt !== '' ? String(ln.dane_amt) : '',
        paploo1: ln.paploo1 != null && ln.paploo1 !== '' ? String(ln.paploo1) : '',
        paploo2: ln.paploo2 != null && ln.paploo2 !== '' ? String(ln.paploo2) : '',
        paploo3: ln.paploo3 != null && ln.paploo3 !== '' ? String(ln.paploo3) : '',
        paploo4: ln.paploo4 != null && ln.paploo4 !== '' ? String(ln.paploo4) : '',
        paploo5: ln.paploo5 != null && ln.paploo5 !== '' ? String(ln.paploo5) : '',
        p_amt1: ln.p_amt1 != null && ln.p_amt1 !== '' ? String(ln.p_amt1) : '',
        p_amt2: ln.p_amt2 != null && ln.p_amt2 !== '' ? String(ln.p_amt2) : '',
        p_amt3: ln.p_amt3 != null && ln.p_amt3 !== '' ? String(ln.p_amt3) : '',
        p_amt4: ln.p_amt4 != null && ln.p_amt4 !== '' ? String(ln.p_amt4) : '',
        p_amt5: ln.p_amt5 != null && ln.p_amt5 !== '' ? String(ln.p_amt5) : '',
        cal: Number(ln.cal ?? 1) || 1,
        e_d: ln.e_d != null && ln.e_d !== '' ? String(ln.e_d) : '',
        e_damt: ln.e_damt != null && ln.e_damt !== '' ? String(ln.e_damt) : '',
        dis_per: ln.dis_per != null && ln.dis_per !== '' ? String(ln.dis_per) : '',
        dis_amt: ln.dis_amt != null && ln.dis_amt !== '' ? String(ln.dis_amt) : '',
        cgst_per: ln.cgst_per != null && ln.cgst_per !== '' ? String(ln.cgst_per) : '',
        cgst_amt: ln.cgst_amt != null && ln.cgst_amt !== '' ? String(ln.cgst_amt) : '',
        sgst_per: ln.sgst_per != null && ln.sgst_per !== '' ? String(ln.sgst_per) : '',
        sgst_amt: ln.sgst_amt != null && ln.sgst_amt !== '' ? String(ln.sgst_amt) : '',
        igst_per: ln.igst_per != null && ln.igst_per !== '' ? String(ln.igst_per) : '',
        igst_amt: ln.igst_amt != null && ln.igst_amt !== '' ? String(ln.igst_amt) : '',
        cost_code: ln.cost_code || '',
        // Prefer saved SUP_DATE; else default to bill_date
        sup_date: toInputDateString(ln.sup_date) || toInputDateString(h.bill_date) || '',
        bard_item_code: ln.bard_item_code ? String(ln.bard_item_code) : '',
        bard_item_name: ln.bard_item_name || '',
      }));
      lineKeyRef.current = Math.max(3, loaded.length + 1);
      setLines(loaded.length ? loaded : [emptyLine(1, toInputDateString(h.bill_date) || defaultDocDate), emptyLine(2, toInputDateString(h.bill_date) || defaultDocDate)]);
      setMode('view');
      setUiLocked(true);
      const od = toOracleDateFromAny(h.bill_date);
      if (od && h.bill_no != null) {
        lastBillLookupRef.current = `${od}|${String(h.bill_no).trim()}`;
      }
    },
    [defaultDocDate, parties]
  );

  const tryLoadExistingBill = useCallback(
    async (noRaw, { quiet = false, advanceIfNew = false } = {}) => {
      let no = String(noRaw ?? header.bill_no ?? '').trim();
      const bType = String(header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
      const oracleDt = toOracleDateFromAny(header.bill_date);
      if (!no) {
        try {
          const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/next-no`], {
            ...apiParams,
            type: SALE_TYPE,
            b_type: bType,
          });
          no = String(data.next_no || '').trim();
          if (no) setHeader((h) => ({ ...h, bill_no: no, b_type: bType }));
        } catch {
          /* optional */
        }
      }
      if (!no) {
        if (!quiet) setStatus('Enter Bill No.');
        return false;
      }
      const lookupKey = `${bType}|${no}|${oracleDt || ''}`;
      if (lookupKey === lastBillLookupRef.current && uiLocked) return true;

      setBusy(true);
      if (!quiet) setStatus('');
      try {
        const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry`], {
          ...apiParams,
          type: SALE_TYPE,
          bill_no: no,
          b_type: bType,
          ...(oracleDt ? { bill_date: oracleDt } : {}),
        });
        lastBillLookupRef.current = lookupKey;
        applyLoaded(data);
        setStatus(`Sale bill ${no} (${bType}) loaded — press Edit to modify or Delete to remove.`);
        return true;
      } catch (err) {
        lastBillLookupRef.current = lookupKey;
        if (err.response?.status === 404) {
          let billNo = no;
          if (!billNo) {
            try {
              const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/next-no`], {
                ...apiParams,
                type: SALE_TYPE,
                b_type: bType,
              });
              billNo = String(data.next_no || '');
            } catch {
              /* optional */
            }
          }
          setMode('new');
          setUiLocked(false);
          setHeader((h) => {
            const bd = h.bill_date || defaultDocDate;
            setLines([emptyLine(1, bd), emptyLine(2, bd)]);
            return {
              ...emptyHeader(bd),
              bill_date: bd,
              v_date: h.v_date || bd,
              bill_no: billNo,
              b_type: bType,
            };
          });
          setFooter(emptyFooter(ctx));
          lineKeyRef.current = 3;
          if (!quiet) {
            setStatus(
              billNo
                ? `New bill ${billNo} (B.Type ${bType}) — enter bill date / details.`
                : 'New bill — enter bill details.'
            );
          }
          if (advanceIfNew) {
            window.setTimeout(() => {
              if (!focusChain.focusKey('hdr-billdt')) focusChain.focusNext('hdr-billno');
            }, 50);
          }
          return false;
        }
        if (!quiet) setStatus(err.response?.data?.error || err.message || 'Load failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, ctx, defaultDocDate, focusChain, header.b_type, header.bill_date, header.bill_no, uiLocked]
  );

  const loadBill = useCallback(
    async (billNo, billDate, bType) => {
      if (!billNo) return;
      setBusy(true);
      setStatus('');
      try {
        const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry`], {
          ...apiParams,
          type: SALE_TYPE,
          bill_no: billNo,
          b_type: String(bType ?? header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
          bill_date: toOracleDateFromAny(billDate || header.bill_date),
        });
        applyLoaded(data);
        setStatus(`Sale bill ${billNo} loaded — press Edit to modify or Delete to remove.`);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, header.b_type, header.bill_date]
  );

  const startNew = useCallback(() => {
    closeHelpModals();
    setMode('view');
    setUiLocked(false);
    setStatus('Enter B.Type — Bill No will show last+1 for that type.');
    lastBillLookupRef.current = '';
    setHeader(emptyHeader(defaultDocDate));
    setFooter(emptyFooter(ctx));
    setLines([emptyLine(1, defaultDocDate), emptyLine(2, defaultDocDate)]);
    lineKeyRef.current = 3;
    setActiveTab(SB_TAB.HEADER);
    window.setTimeout(() => focusChain.focusKey('hdr-btype'), 50);
  }, [closeHelpModals, ctx, defaultDocDate, focusChain]);

  const fetchNextNoForBType = useCallback(
    async (bType) => {
      const bt = String(bType ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
      try {
        const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/next-no`], {
          ...apiParams,
          type: SALE_TYPE,
          b_type: bt,
        });
        return String(data.next_no ?? '');
      } catch {
        return null;
      }
    },
    [apiBase, apiParams]
  );

  const applyNextNoForBType = useCallback(
    async (bType) => {
      if (uiLocked || mode === 'edit' || busy) return null;
      const nextNo = await fetchNextNoForBType(bType);
      if (!nextNo) return null;
      setHeader((h) => ({
        ...h,
        b_type: String(bType ?? h.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
        bill_no: nextNo,
      }));
      return nextNo;
    },
    [busy, fetchNextNoForBType, mode, uiLocked]
  );

  const handleBTypeChange = useCallback((b_type) => {
    lastBillLookupRef.current = '';
    setUiLocked(false);
    setHeader((h) => ({ ...h, b_type, bill_no: '' }));
  }, []);

  const handleBTypeBlur = useCallback(async () => {
    if (uiLocked || mode === 'edit' || busy) return;
    const bt = String(header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
    const task = applyNextNoForBType(bt);
    billDateBlurTaskRef.current = task;
    return task;
  }, [applyNextNoForBType, busy, header.b_type, mode, uiLocked]);

  const handleBTypeKeyDown = useCallback(
    (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const bt = String(header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
        if (!String(header.b_type ?? '').trim()) {
          setHeader((h) => ({ ...h, b_type: 'N' }));
        }
        await applyNextNoForBType(bt);
        window.setTimeout(() => {
          if (!focusChain.focusKey('hdr-billno')) {
            focusChain.focusNext('hdr-btype');
          }
        }, 30);
      })();
    },
    [applyNextNoForBType, focusChain, header.b_type]
  );

  const handleBillDateChange = useCallback((v) => {
    lastBillLookupRef.current = '';
    setHeader((h) => {
      const next = {
        ...h,
        bill_date: v,
        v_date: h.v_date && h.bill_date && h.v_date === h.bill_date ? v : h.v_date || v,
      };
      return next;
    });
    setLines((prev) => {
      // Sync SUP_DATE when blank or still equal to previous bill_date (captured via header closure)
      const prevBillDate = String(header.bill_date ?? '').trim();
      return prev.map((ln) => {
        const sd = String(ln.sup_date ?? '').trim();
        if (!sd || sd === prevBillDate) return { ...ln, sup_date: v };
        return ln;
      });
    });
  }, [header.bill_date]);

  const handleBillDateBlur = useCallback(() => {
    /* date no longer drives next-no — b_type does */
  }, []);

  const handleBillDateKeyDown = useCallback(
    (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      window.setTimeout(() => {
        if (editable) {
          if (!focusChain.focusKey('hdr-vdate')) focusChain.focusNext('hdr-billdt');
        } else {
          // Still in pre-load view: jump to party only after bill is opened as new/edit
          focusChain.focusNext('hdr-billdt');
        }
      }, 0);
    },
    [editable, focusChain]
  );

  const handleBillNoFocus = useCallback(() => {
    if (uiLocked || mode === 'edit' || busy) return;
    if (String(header.bill_no ?? '').trim()) return;
    const bt = String(header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
    const pending = billDateBlurTaskRef.current;
    if (pending) {
      void pending.then(() => {
        if (!String(header.bill_no ?? '').trim()) void applyNextNoForBType(bt);
      });
      return;
    }
    void applyNextNoForBType(bt);
  }, [applyNextNoForBType, busy, header.b_type, header.bill_no, mode, uiLocked]);

  const handleBillNoChange = useCallback((e) => {
    lastBillLookupRef.current = '';
    setUiLocked(false);
    setHeader((h) => ({ ...h, bill_no: e.target.value.replace(/\D/g, '') }));
  }, []);

  const handleBillNoBlur = useCallback(() => {
    const no = String(header.bill_no ?? '').trim();
    if (!no || uiLocked || busy) return;
    void tryLoadExistingBill(no, { quiet: true });
  }, [busy, header.bill_no, tryLoadExistingBill, uiLocked]);

  const handleBillNoKeyDown = useCallback(
    (e) => {
      if (e.key === 'F1' || e.keyCode === 112) {
        e.preventDefault();
        e.stopPropagation();
        void openBillList();
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const loaded = await tryLoadExistingBill(header.bill_no, { quiet: true, advanceIfNew: true });
        if (loaded) {
          // Existing bill — stay; user presses Edit
          return;
        }
        // New bill: advanceIfNew focuses bill date
      })();
    },
    [header.bill_no, tryLoadExistingBill]
  );

  const advanceToGrid1 = useCallback(() => {
    setActiveTab(SB_TAB.GRID1);
    const firstKey = lines[0]?.key;
    const firstCol = visibleColumns[0]?.key;
    if (firstKey && firstCol) window.setTimeout(() => focusChain.focusKey(`ln-${firstKey}-${firstCol}`), 60);
  }, [focusChain, lines, visibleColumns]);

  const startEdit = useCallback(() => {
    if (!header.bill_no) {
      setStatus('Open a sale bill first.');
      return;
    }
    if (!sbPerms?.canEdit) {
      setStatus('Edit permission denied.');
      return;
    }
    setMode('edit');
    setStatus('');
  }, [header.bill_no, sbPerms?.canEdit]);

  const cancelEdit = useCallback(() => {
    closeHelpModals();
    if (header.bill_no) void loadBill(header.bill_no, header.bill_date);
    else {
      setMode('view');
      setHeader(emptyHeader(defaultDocDate));
      setLines([emptyLine(1, defaultDocDate), emptyLine(2, defaultDocDate)]);
      setFooter(emptyFooter(ctx));
    }
    setStatus('Changes discarded.');
  }, [closeHelpModals, ctx, defaultDocDate, header.bill_date, header.bill_no, loadBill]);

  const updateLine = useCallback(
    (key, patch) => {
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== key) return ln;
          const prevLine = ln;
          let next = { ...ln, ...patch };
          if (patch.item_code != null) {
            const ic = Number(patch.item_code) || 0;
            if (!ic) {
              next.item_name = '';
              next.unit_type = '';
            } else {
              const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
              next = applyItemmastToLine(next, row, {
                accounts: parties,
                partyLc: header.l_c,
                mode,
              });
            }
            // New item/lot → balance unknown until Lothlp pick
            if (!Object.prototype.hasOwnProperty.call(patch, 'b_qty')) {
              next.b_qty = '';
              next.b_wgt = '';
            }
          }
          if (patch.lot != null && !Object.prototype.hasOwnProperty.call(patch, 'b_qty')) {
            next.b_qty = '';
            next.b_wgt = '';
          }
          if (Object.prototype.hasOwnProperty.call(patch, 'weight')) {
            next.weight_manual = String(patch.weight ?? '').trim() !== '';
          }
          const qntyTouched = Object.prototype.hasOwnProperty.call(patch, 'qnty');
          const packingTouched = Object.prototype.hasOwnProperty.call(patch, 'packing');
          const gWeightTouched = Object.prototype.hasOwnProperty.call(patch, 'g_weight');
          const weightTouched = Object.prototype.hasOwnProperty.call(patch, 'weight');
          const eDamtTouched = Object.prototype.hasOwnProperty.call(patch, 'e_damt');
          // Also re-apply packing when leaving g_weight/d_weight/weight after qty+pack set (VFP ncol 13–15)
          const applyPacking =
            qntyTouched ||
            packingTouched ||
            ((gWeightTouched || weightTouched || Object.prototype.hasOwnProperty.call(patch, 'd_weight')) &&
              num(next.packing) !== 0 &&
              num(next.qnty) !== 0);

          let packingWarned = false;
          let nextLine = recalcLine(next, { ...ctx, mode }, {
            prevLine,
            mode,
            qntyTouched,
            packingTouched,
            gWeightTouched,
            weightTouched,
            eDamtTouched,
            applyPacking,
            onPackingApplied: (m) => {
              if (m === 'edit' && !packingWarned) {
                packingWarned = true;
                window.setTimeout(() => window.alert('CHECK THE WEIGHT PROPERLY'), 0);
              }
            },
            onStockExceed: () => {
              window.setTimeout(() => window.alert('Qty.Exceeding Current Stock'), 0);
            },
          });

          // VFP DANEAMTCAL — on dane pick/change, or when qty/weight/status changes with dane set
          const daneTouched = Object.prototype.hasOwnProperty.call(patch, 'dane');
          const daneCode = String(nextLine.dane ?? '')
            .trim()
            .toUpperCase()
            .slice(0, 1);
          if (daneTouched) {
            nextLine.dane = daneCode;
            if (!daneCode) {
              nextLine.dane_wgt = '';
              nextLine.dane_amt = '';
            } else {
              const dRow = daneTypes.find(
                (d) => String(d.dane ?? d.DANE ?? '').trim().toUpperCase() === daneCode
              );
              if (!dRow) {
                window.setTimeout(() => window.alert('!!!! INVALID DANE CATEGORY !!!'), 0);
                nextLine.dane = '';
                nextLine.dane_wgt = '';
                nextLine.dane_amt = '';
              } else {
                nextLine = applyDaneAmtCal(nextLine, dRow, { ...ctx, mode }, { mode, force: true });
                nextLine = recalcLine(nextLine, { ...ctx, mode }, { skipStockCheck: true });
              }
            }
          } else if (
            daneCode &&
            (qntyTouched || weightTouched || Object.prototype.hasOwnProperty.call(patch, 'status'))
          ) {
            const dRow = daneTypes.find(
              (d) => String(d.dane ?? d.DANE ?? '').trim().toUpperCase() === daneCode
            );
            if (dRow) {
              nextLine = applyDaneAmtCal(nextLine, dRow, { ...ctx, mode }, { mode, force: mode === 'new' });
              nextLine = applyPaplooCal(nextLine, ctx);
            }
          }
          return nextLine;
        })
      );
    },
    [ctx, daneTypes, header.l_c, items, mode, parties]
  );

  const applyExpenseRecalc = useCallback(
    (baseFooter) => recalcExpenseSummary(baseFooter, totals, ctx).footer,
    [ctx, totals]
  );

  const onFooter = useCallback(
    (field, value) => {
      setFooter((f) => {
        const patched = { ...f, [field]: value };
        if (field === 'tds_on_amt') patched.tds_on_manual = String(value ?? '').trim() !== '';
        return applyExpenseRecalc(patched);
      });
    },
    [applyExpenseRecalc]
  );

  useEffect(() => {
    setFooter((f) => {
      const next = applyExpenseRecalc(f);
      const watch = ['comm_amt', 'brok_amt', 'tds_on_amt', 'tds_amt'];
      if (watch.every((k) => String(next[k] ?? '') === String(f[k] ?? ''))) return f;
      return next;
    });
  }, [applyExpenseRecalc, totals.amount, totals.bill_amt]);

  const resolveParty = useCallback(
    (code) => {
      const hit = (parties || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
      if (!hit) return;
      const bal = Number(hit.CUR_BAL ?? hit.cur_bal ?? 0);
      const name = String(hit.NAME ?? hit.name ?? '').trim();
      const lc = String(hit.L_C ?? hit.l_c ?? 'L')
        .trim()
        .toUpperCase()
        .slice(0, 1) || 'L';
      setHeader((h) => ({
        ...h,
        code,
        party_name: name,
        party_city: String(hit.CITY ?? hit.city ?? '').trim(),
        gst_no: String(hit.GST_NO ?? hit.gst_no ?? '').trim(),
        pan: String(hit.PAN ?? hit.pan ?? '').trim(),
        // VFP THISFORM.L_C.VALUE = MASTER.L_C (Local / Central)
        l_c: lc === 'C' || lc === 'I' ? lc : 'L',
        cur_bal: Number.isFinite(bal) ? bal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
        // VFP default: Delv.Party = Party code
        delv_code: code,
        delv_name: name,
      }));
    },
    [parties]
  );

  const resolveBroker = useCallback(
    (code) => {
      const hit = (brokers || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
      setHeader((h) => ({ ...h, b_code: code, bk_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '' }));
    },
    [brokers]
  );

  const resolveDelv = useCallback(
    (code) => {
      const hit = (parties || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
      setHeader((h) => ({ ...h, delv_code: code, delv_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '' }));
    },
    [parties]
  );

  const openSoHelp = useCallback(
    async (lineKey) => {
      helpReturnFocusRef.current = `ln-${lineKey}-so_no`;
      if (!header.code) {
        setStatus('Enter party first.');
        return;
      }
      setSoHelp({ open: true, line: lineKey, rows: [], loading: true, error: '' });
      try {
        const { data } = await getWithFallback(
          [`${apiBase}/api/sale-bill-entry/so-help`, `${apiBase}/api/sale-bill-pending-orders`],
          { ...apiParams, code: header.code, bk_code: header.b_code }
        );
        setSoHelp({ open: true, line: lineKey, rows: data || [], loading: false, error: '' });
      } catch (err) {
        setSoHelp({ open: true, line: lineKey, rows: [], loading: false, error: err.response?.data?.error || err.message || 'So help failed.' });
      }
    },
    [apiBase, apiParams, header.b_code, header.code]
  );

  const openChHelp = useCallback(
    async (lineKey) => {
      helpReturnFocusRef.current = `ln-${lineKey}-ch_no`;
      if (!header.code) {
        setStatus('Enter party first.');
        return;
      }
      setChHelp({ open: true, line: lineKey, rows: [], loading: true, error: '' });
      try {
        const { data } = await getWithFallback(
          [`${apiBase}/api/sale-bill-entry/ch-help`, `${apiBase}/api/sale-bill-pending-challans`],
          { ...apiParams, code: header.code, bk_code: header.b_code }
        );
        setChHelp({ open: true, line: lineKey, rows: data || [], loading: false, error: '' });
      } catch (err) {
        setChHelp({ open: true, line: lineKey, rows: [], loading: false, error: err.response?.data?.error || err.message || 'Ch help failed.' });
      }
    },
    [apiBase, apiParams, header.b_code, header.code]
  );

  const openLotHelp = useCallback(
    async (lineKey) => {
      helpReturnFocusRef.current = `ln-${lineKey}-lot`;
      const line = lines.find((l) => l.key === lineKey);
      const itemCode = line?.item_code;
      if (!itemCode) {
        setStatus('Enter item code first.');
        return;
      }
      setLotHelp({ open: true, line: lineKey, rows: [], loading: true, error: '' });
      try {
        const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/lot-help`], {
          ...apiParams,
          item_code: itemCode,
          bill_date: toOracleDateFromAny(header.bill_date) || undefined,
          // VFP filters by line SUP_CODE when present
          ...(String(line?.sup_code || '').trim()
            ? { sup_code: String(line.sup_code).trim() }
            : {}),
        });
        setLotHelp({ open: true, line: lineKey, rows: data || [], loading: false, error: '' });
      } catch (err) {
        setLotHelp({
          open: true,
          line: lineKey,
          rows: [],
          loading: false,
          error: err.response?.data?.error || err.message || 'Lot help not available.',
        });
      }
    },
    [apiBase, apiParams, header.bill_date, lines]
  );

  const openDaneHelp = useCallback(
    async (lineKey) => {
      helpReturnFocusRef.current = `ln-${lineKey}-dane`;
      setDaneHelp({ open: true, line: lineKey, rows: daneTypes, loading: !daneTypes.length, error: '' });
      if (daneTypes.length) return;
      try {
        const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/dane-help`], apiParams);
        const rows = Array.isArray(data) ? data : data?.rows || [];
        setDaneTypes(rows);
        setDaneHelp({ open: true, line: lineKey, rows, loading: false, error: '' });
      } catch (err) {
        setDaneHelp({
          open: true,
          line: lineKey,
          rows: [],
          loading: false,
          error: err.response?.data?.error || err.message || 'Dane help not available.',
        });
      }
    },
    [apiBase, apiParams, daneTypes]
  );

  const openGridHelp = useCallback(
    (kind, lineKey) => {
      if (kind === 'so') {
        void openSoHelp(lineKey);
        return;
      }
      if (kind === 'ch') {
        void openChHelp(lineKey);
        return;
      }
      if (kind === 'lot') {
        void openLotHelp(lineKey);
        return;
      }
      if (kind === 'item') {
        helpReturnFocusRef.current = `ln-${lineKey}-item_code`;
        setItemHelpLine(lineKey);
        return;
      }
      if (kind === 'sup') {
        helpReturnFocusRef.current = `ln-${lineKey}-sup_code`;
        setSupHelpLine(lineKey);
        return;
      }
      if (kind === 'god') {
        helpReturnFocusRef.current = `ln-${lineKey}-god_code`;
        setGodHelpLine(lineKey);
        return;
      }
      if (kind === 'marka') {
        helpReturnFocusRef.current = `ln-${lineKey}-marka`;
        setMarkaHelpLine(lineKey);
        return;
      }
      if (kind === 'dane') {
        void openDaneHelp(lineKey);
      }
    },
    [openChHelp, openDaneHelp, openLotHelp, openSoHelp]
  );

  const handleGridF1 = useCallback(
    (e, kind, lineKey) => {
      if (e.key !== 'F1') return;
      e.preventDefault();
      if (kind === 'amt') {
        updateLine(lineKey, {});
        return;
      }
      openGridHelp(kind, lineKey);
    },
    [openGridHelp, updateLine]
  );

  const openBillList = useCallback(async () => {
    setBillListOpen(true);
    setBillListLoading(true);
    try {
      const { data } = await getWithFallback([`${apiBase}/api/sale-bill-entry/list`], {
        ...apiParams,
        type: SALE_TYPE,
        b_type: String(header.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
      });
      setBillListRows(Array.isArray(data) ? data : data?.rows || []);
    } catch (err) {
      setBillListRows([]);
      setStatus(err.response?.data?.error || err.message || 'Bill list unavailable.');
    } finally {
      setBillListLoading(false);
    }
  }, [apiBase, apiParams, header.b_type]);

  const addLine = useCallback(() => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    const bd = header.bill_date || defaultDocDate;
    setLines((prev) => [...prev, emptyLine(key, bd)]);
  }, [defaultDocDate, header.bill_date]);

  const saveBill = useCallback(async () => {
    const dateErr = finYearDateErrorMessage(header.bill_date, fyMinYmd, fyMaxYmd);
    if (dateErr) {
      setStatus(dateErr);
      return;
    }
    if (!header.code) {
      setStatus('Party code is required.');
      return;
    }
    const expCodeErr = validateSaleLedgerExpenseCodes({ footer, totals });
    if (expCodeErr) {
      setStatus(expCodeErr);
      window.alert(expCodeErr);
      setActiveTab(SB_TAB.EXPENSES);
      return;
    }
    closeHelpModals();
    setBusy(true);
    setStatus('');
    try {
      const payload = {
        ...apiParams,
        comp_year: compYear,
        mode,
        type: SALE_TYPE,
        bill_date: toOracleDateFromAny(header.bill_date),
        bill_no: Number(header.bill_no) || 0,
        b_type: header.b_type,
        v_date: toOracleDateFromAny(header.v_date),
        due: num(header.due),
        code: header.code,
        b_code: header.b_code,
        bk_code: header.b_code,
        delv_code: header.delv_code,
        gr_no: header.gr_no,
        tpt: header.tpt,
        truck: header.truck,
        truck_no: header.truck,
        form: header.form,
        remarks: header.remarks,
        bill_amt: totals.bill_amt,
        fy_s_date: toOracleDate(fyMinYmd),
        fy_e_date: toOracleDate(fyMaxYmd),
        footer,
        header: {
          ...header,
          ...footer,
          labour: footer.labour,
          freight: footer.freight,
          ins: footer.ins,
          bill_amt: totals.bill_amt,
          tds_on_amt: footer.tds_on_amt,
          tds_per: footer.tds_per,
          tds_amt: footer.tds_amt,
          days: header.due,
          truck_no: header.truck,
          add_code: footer.oth_cd1 || footer.oth_code,
          oth_exp: totals.oth_exp_total,
        },
        lines: lines.map((ln) => ({ ...ln, trn_no: ln.trn_no || ln.key })),
      };
      const { data } = await axios.post(`${apiBase}/api/sale-bill-entry`, payload, reqOpts);
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
  }, [apiBase, apiParams, applyLoaded, closeHelpModals, compYear, footer, fyMaxYmd, fyMinYmd, header, lines, mode, totals]);

  const deleteBill = useCallback(async () => {
    if (!header.bill_no) return;
    if (!sbPerms?.canDelete) {
      setStatus('Delete permission denied.');
      return;
    }
    if (!window.confirm(`Delete Sale Bill No. ${header.bill_no}?`)) return;
    setBusy(true);
    try {
      const { data } = await axios.delete(`${apiBase}/api/sale-bill-entry`, {
        data: {
          ...apiParams,
          type: SALE_TYPE,
          bill_no: header.bill_no,
          b_type: header.b_type,
          bill_date: toOracleDateFromAny(header.bill_date),
        },
        ...reqOpts,
      });
      window.alert(data.message || 'Deleted.');
      setUiLocked(false);
      lastBillLookupRef.current = '';
      setHeader(emptyHeader(defaultDocDate));
      setLines([emptyLine(1, defaultDocDate), emptyLine(2, defaultDocDate)]);
      setFooter(emptyFooter(ctx));
      setMode('view');
      setActiveTab(SB_TAB.HEADER);
      window.setTimeout(() => focusChain.focusKey('hdr-btype'), 80);
    } catch (err) {
      window.alert(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, ctx, defaultDocDate, focusChain, header.bill_date, header.bill_no, sbPerms?.canDelete]);

  const helpAccounts = useMemo(() => {
    if (helpField === 'party' || helpField === 'delv') return parties;
    if (helpField === 'broker') return brokers;
    return parties;
  }, [brokers, helpField, parties]);

  const handleAccountHelpSelect = useCallback(
    (code) => {
      if (helpField === 'party') {
        resolveParty(code);
        return;
      }
      if (helpField === 'broker') {
        resolveBroker(code);
        return;
      }
      if (helpField === 'delv') {
        resolveDelv(code);
        return;
      }
      if (helpField?.startsWith('exp-')) {
        const field = helpField.replace(/^exp-/, '');
        if (field === 'form') setHeader((h) => ({ ...h, form: code }));
        else onFooter(field, code);
      }
    },
    [helpField, onFooter, resolveBroker, resolveDelv, resolveParty]
  );

  if (permLoading) {
    return <p className="voucher-entry-form__status">Loading sale bill…</p>;
  }
  if (permErr) {
    return (
      <div className="voucher-entry-form">
        <p className="voucher-entry-form__status voucher-entry-form__status--err">{permErr}</p>
        <button type="button" className="btn btn-sm" onClick={onBack}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-113-sale-bill sale-bill-page sale-entry-desktop pb-layout--desktop">
      <div className="sale-entry-desktop__body voucher-entry-form purchase-bill-form sb-entry-form">
        <div className="purchase-bill-form__toolbar-row">
          <SaleBillToolbar
            busy={busy}
            mode={mode}
            sbPerms={sbPerms}
            hasBill={!!header.bill_no}
            editable={editable}
            newBtnRef={newBtnRef}
            onNew={startNew}
            onEdit={startEdit}
            onDelete={() => void deleteBill()}
            onSave={() => void saveBill()}
            onClose={mode === 'edit' ? cancelEdit : onBack}
            onList={() => void openBillList()}
            onPrint={() => setPrintOpen(true)}
            onChecklist={() => {
              if (typeof onOpenChecklist === 'function') onOpenChecklist();
              else setStatus('Sale bill checklist is not linked from this screen.');
            }}
          />
          <ModuleRightsPanel variant="iconsOnly" perms={sbPerms} className="purchase-bill-form__perms" />
        </div>

        {status ? <p className="voucher-entry-form__status">{status}</p> : null}

        <p className="pb-expenses-footer__summary pb-summary-strip">
          Qty {fmtWgt(totals.qnty)} · Wgt {fmtWgt(totals.weight)} · Amount {fmtAmt(totals.amount)} · Bill{' '}
          {fmtAmt(totals.bill_amt)} · Net {fmtAmt(totals.net_payable)}
        </p>

        <div className="purchase-bill-form__tabs-body">
          <SaleBillTabBar activeTab={activeTab} onChange={setActiveTab} tabs={sbTabs} />

          <SaleBillTabContent
            activeTab={activeTab}
            header={header}
            footer={footer}
            lines={lines}
            totals={totals}
            editable={editable}
            docNoLocked={docNoLocked}
            busy={busy}
            fyMinYmd={fyMinYmd}
            fyMaxYmd={fyMaxYmd}
            focusChain={focusChain}
            setHeader={setHeader}
            resolveParty={resolveParty}
            resolveBroker={resolveBroker}
            resolveDelv={resolveDelv}
            openHelp={openHelp}
            onFooter={onFooter}
            onBillNoChange={handleBillNoChange}
            onBillNoKeyDown={handleBillNoKeyDown}
            onBillNoBlur={handleBillNoBlur}
            onBillDateChange={handleBillDateChange}
            onBillDateBlur={handleBillDateBlur}
            onBillDateKeyDown={handleBillDateKeyDown}
            onBillNoFocus={handleBillNoFocus}
            onBTypeChange={handleBTypeChange}
            onBTypeBlur={handleBTypeBlur}
            onBTypeKeyDown={handleBTypeKeyDown}
            onAdvanceToGrid1={advanceToGrid1}
            dateEditable={dateEditable}
            updateLine={updateLine}
            handleGridF1={handleGridF1}
            openGridHelp={openGridHelp}
            onAddLine={addLine}
            visibleColumns={visibleColumns}
            visibleOthExp={visibleOthExp}
            fmtAmt={fmtAmt}
            fmtWgt={fmtWgt}
          />
        </div>
      </div>

      <VoucherAccountHelpModal
        open={!!helpField}
        title={helpField === 'delv' ? 'Delivery party help (F1)' : 'Account help (F1)'}
        accounts={helpAccounts}
        onSelect={handleAccountHelpSelect}
        onClose={closeAccountHelp}
      />
      <VoucherGridHelpModal
        open={godHelpLine != null}
        title="Godown help"
        columns={GOD_HELP_COLUMNS}
        rows={godownHelpRows}
        onSelect={(row) => {
          if (godHelpLine == null) return;
          const code = String(row?.god_code ?? '').trim();
          const hit = godownHelpRows.find((g) => g.god_code === code);
          updateLine(godHelpLine, { god_code: code, god_name: hit?.god_name || '' });
          setGodHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setGodHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={soHelp.open}
        title="So help (F1)"
        columns={SO_HELP_COLUMNS}
        rows={soHelp.rows}
        loading={soHelp.loading}
        error={soHelp.error}
        onSelect={(row) => {
          if (soHelp.line == null) return;
          updateLine(soHelp.line, {
            so_no: String(row.so_no ?? ''),
            item_code: String(row.item_code ?? ''),
            rate: row.rate != null ? String(row.rate) : '',
          });
          setSoHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
        onClose={() => {
          setSoHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={chHelp.open}
        title="Ch help (F1)"
        columns={CH_HELP_COLUMNS}
        rows={chHelp.rows}
        loading={chHelp.loading}
        error={chHelp.error}
        onSelect={(row) => {
          if (chHelp.line == null) return;
          updateLine(chHelp.line, {
            ch_no: String(row.ch_no ?? ''),
            item_code: String(row.item_code ?? ''),
          });
          setChHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
        onClose={() => {
          setChHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={lotHelp.open}
        title="Lothlp — Lot help (F1)"
        hint="Type to search · ↑↓ move · Enter pick · Esc close"
        panelClassName="voucher-help-modal__panel--lothlp"
        searchPlaceholder="Search B_no, SCODE, item, lot, remarks…"
        columns={LOT_HELP_COLUMNS}
        rows={lotHelp.rows}
        loading={lotHelp.loading}
        error={lotHelp.error}
        onSelect={(row) => {
          if (lotHelp.line == null) return;
          // VFP REPLACE on pick: item, lot, status, b_no, sup, sname, god, msup, remarks, exp, s_rate/MRP
          updateLine(lotHelp.line, {
            item_code: String(row.item_code ?? ''),
            item_name: String(row.item_name ?? '').trim(),
            lot: String(row.lot ?? '').trim(),
            status: String(row.status ?? 'B').trim() || 'B',
            b_no: String(row.b_no ?? '').trim(),
            god_code: String(row.god_code ?? '').trim(),
            sup_code: String(row.sup_code ?? '').trim(),
            sname: String(row.sup_name ?? '').trim(),
            // Lot balance for VFP neg-stock check (B_QTY / B_WGT)
            b_qty: row.b_qty != null && row.b_qty !== '' ? String(row.b_qty) : '',
            b_wgt: row.b_wgt != null && row.b_wgt !== '' ? String(row.b_wgt) : '',
            ...(num(row.mrp) ? { s_rate: String(row.mrp) } : {}),
            ...(String(row.cost_code || '').trim()
              ? { cost_code: String(row.cost_code).trim() }
              : {}),
            ...(toInputDateString(row.vr_date)
              ? { sup_date: toInputDateString(row.vr_date) }
              : header.bill_date
                ? { sup_date: header.bill_date }
                : {}),
          });
          setLotHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
        onClose={() => {
          setLotHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
      />
      <VoucherItemHelpModal
        open={itemHelpLine != null}
        items={items}
        onSelect={(item) => {
          if (itemHelpLine == null) return;
          updateLine(itemHelpLine, { item_code: String(item.ITEM_CODE ?? item.item_code ?? '') });
          setItemHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setItemHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={markaHelpLine != null}
        title="Marka help (F1)"
        columns={[{ key: 'marka', label: 'Marka' }]}
        rows={markas}
        searchPlaceholder="Search marka…"
        onSelect={(row) => {
          if (markaHelpLine == null) return;
          updateLine(markaHelpLine, {
            marka: String(row?.marka ?? row?.MARKA ?? '').trim(),
          });
          setMarkaHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setMarkaHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={daneHelp.open}
        title="Dane Type"
        hint="Type to search · ↑↓ move · Enter pick · Esc close"
        columns={DANE_HELP_COLUMNS}
        rows={daneHelp.rows}
        loading={daneHelp.loading}
        error={daneHelp.error}
        searchPlaceholder="Search Dane / Bags / Katta…"
        onSelect={(row) => {
          if (daneHelp.line == null) return;
          // VFP danecal: REPLACE DANE WITH mtype → DANEAMTCAL
          updateLine(daneHelp.line, {
            dane: String(row?.dane ?? row?.DANE ?? '')
              .trim()
              .toUpperCase()
              .slice(0, 1),
          });
          setDaneHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
        onClose={() => {
          setDaneHelp((s) => ({ ...s, open: false }));
          restoreHelpFocus();
        }}
      />
      <VoucherAccountHelpModal
        open={supHelpLine != null}
        title="Sup code help (F1)"
        accounts={parties}
        onSelect={(code) => {
          if (supHelpLine == null) return;
          const hit = parties.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
          updateLine(supHelpLine, { sup_code: code, sname: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '' });
          setSupHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setSupHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={billListOpen}
        title="Sale bill list"
        columns={BILL_LIST_COLUMNS}
        rows={billListRows}
        loading={billListLoading}
        onSelect={(row) => {
          void loadBill(row.bill_no, row.bill_date, row.b_type);
          setBillListOpen(false);
        }}
        onClose={() => setBillListOpen(false)}
      />
      <SaleBillPrintModal
        open={printOpen}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        billParams={
          header.bill_no
            ? {
                type: SALE_TYPE,
                bType: header.b_type,
                billNo: header.bill_no,
                oracleDt: toOracleDateFromAny(header.bill_date),
                label: `Sale Bill ${header.bill_no}`,
              }
            : null
        }
        onClose={() => setPrintOpen(false)}
      />
    </div>
  );
}
