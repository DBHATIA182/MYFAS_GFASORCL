import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import ModuleRightsPanel from './ModuleRightsPanel';
import PurchaseBillPrintModal from './PurchaseBillPrintModal';
import PurchaseBillExpGridModal from './PurchaseBillExpGridModal';
import PurchaseBillToolbar from './PurchaseBillToolbar';
import PurchaseBillPostingModal from './PurchaseBillPostingModal';
import PurchaseBillListModal from './PurchaseBillListModal';
import PurchaseBillDnBillHelpModal from './PurchaseBillDnBillHelpModal';
import PurchaseBillTabContent, { PurchaseBillTabBar, PB_TAB, getPbTabList } from './PurchaseBillTabContent';
import { toInputDateString, toOracleDate, toOracleDateFromAny, addDaysToYmd } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import {
  defaultDocDateInFinYear,
  finYearDateErrorMessage,
  finYearRangeLabel,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import {
  num,
  recalcLine,
  sumPurchaseGrid,
  applyItemmastToLine,
  recalcExpenseSummary,
  getExpenseSummaryFocusKeys,
  getBillExpensesFocusKeys,
  validatePurchaseLedgerExpenseCodes,
} from '../utils/purchaseBillCalc';
import '../styles/voucherEntryForm.css';
import '../styles/gfasToolbar.css';
import '../styles/purchaseBillForm.css';

const BKH_OPTIONS = ['B', 'K', 'H'];
const DEFAULT_PU_TYPE = 'PU';
const BARDANA_TYPE = 'PB';
const DEBIT_NOTE_TYPE = 'DN';

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];
const COST_HELP_COLUMNS = [
  { key: 'cost_code', label: 'Code' },
  { key: 'cost_name', label: 'Name' },
];

const PO_HELP_COLUMNS = [
  { key: 'so_no', label: 'Po.No' },
  { key: 'so_date', label: 'Date' },
  { key: 'item_code', label: 'Item' },
  { key: 'item_name', label: 'Name' },
  { key: 'b_qty', label: 'Bal.Qty' },
  { key: 'b_wgt', label: 'Bal.Wgt' },
  { key: 'rate', label: 'Rate' },
];

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function emptyLine(key = 1, defaultQw = 'W') {
  return {
    key,
    trn_no: key,
    so_no: '',
    item_code: '',
    item_name: '',
    pur_code: '',
    pur_name: '',
    s_code: '',
    s_name: '',
    bard_item_code: '',
    bard_item_name: '',
    status: 'B',
    qnty: '',
    g_weight: '',
    d_weight: '',
    weight: '',
    stk_weight: '',
    usd_rate: '',
    usd_amount: '',
    rate: '',
    amount: '',
    amt_cal: defaultQw,
    dis_per: '',
    dis_amt: '',
    bard_per: '',
    bard_amt: '',
    lab_per: '',
    lab_amt: '',
    fgt_amt: '',
    ins_amt: '',
    oth_amt: '',
    cgst_per: '',
    cgst_amt: '',
    sgst_per: '',
    sgst_amt: '',
    igst_per: '',
    igst_amt: '',
    dane_rate: '',
    dane_amt: '',
    pmt_rate: '',
    remarks: '',
    lot: '',
    b_no: '',
    mlot_no: '',
    cost_code: '',
  };
}

function emptyFooter(ctx = {}) {
  return {
    comm_per: '',
    comm_cal: '',
    comm_amt: '',
    comm_code: ctx.comm_code || '',
    brok_rate: '',
    brok_amt: '',
    brok_cal: '',
    brok_d_cd: '',
    mud_per: '',
    mud_amt: '',
    mud_code: '',
    tcs_per: '',
    tcs_amt: '',
    tcs_code: ctx.tcs_code || '',
    ntds_per: '',
    ntds_amt: '',
    ntds_code: ctx.ntds_code || '',
    ntds_on_amt: '',
    ntds_on_manual: false,
    tds_per: '',
    tds_amt: '',
    tds_code: ctx.tds_code || '',
    tds_comm: '',
    tds_no: '',
    sur_per: '',
    sur_amt: '',
    edu_per: '',
    edu_amt: '',
    tot_tds: '',
    freight_hdr: '',
    f_dr_code: '',
    f_cr_code: '',
    bl_no: '',
    file_no: '',
    bref_no: '',
    job_no: '',
    p_bill_no_file_path: '',
    cform_amt: '',
    lab_rate_hdr: '',
    exp_cat: ctx.exp_cat || '',
    cgst_per_hdr: '',
    cgst_amt_hdr: '',
    cgst_code: ctx.cgst_code || '',
    sgst_per_hdr: '',
    sgst_amt_hdr: '',
    sgst_code: ctx.sgst_code || '',
    igst_per_hdr: '',
    igst_amt_hdr: '',
    igst_code: ctx.igst_code || '',
    dis_per_hdr: '',
    dis_amt_hdr: '',
    dis_code: '',
    oth_exp_1: '',
    oth_exp_2: '',
    oth_exp_3: '',
    oth_exp_4: '',
    oth_exp_5: '',
    oth_exp_6: '',
    oth_exp_7: '',
    oth_exp_8: '',
    oth_cd_1: '',
    oth_cd_2: '',
    oth_cd_3: '',
    oth_cd_4: '',
    oth_cd_5: '',
    oth_cd_6: '',
    oth_cd_7: '',
    oth_cd_8: '',
    brok_paid_per: '',
    brok_paid: '',
    brok_paid_code: ctx.brok_paid_code || '',
    mandi_exp: '',
    mandi_exp_code: ctx.mandi_exp_code || '',
    labour_exp: '',
    labour_exp_code: ctx.labour_exp_code || '',
    bardana_exp: '',
    bardana_exp_code: ctx.bardana_exp_code || '',
    freight_paid: '',
    freight_paid_code: ctx.freight_paid_code || '',
    cd_per: '',
    cd_amount: '',
    cd_amount_code: ctx.cd_amount_code || '',
    dharam_kanta: '',
    dharam_kanta_code: ctx.dharam_kanta_code || '',
    tulwai_exp: '',
    tulwai_code: ctx.tulwai_code || '',
    round_off: '',
    round_off_code: ctx.round_off_code || '',
    labour: '',
    l_d_code: '',
    l_c_code: '',
    pu_r_no: '',
  };
}

function defaultStkFromCtx(ctx = {}) {
  return String(ctx.pur_stk_trf ?? ctx.PUR_STK_TRF ?? '').trim().toUpperCase() === 'A' ? 'Y' : 'N';
}

function emptyHeader(rDate = '', billDate = '', ctx = {}) {
  return {
    r_date: rDate,
    r_no: '',
    bill_date: billDate,
    bill_no: '',
    due: '',
    v_date: billDate,
    code: '',
    party_name: '',
    party_city: '',
    gst_no: '',
    pan: '',
    msme_no: '',
    cur_bal: '',
    b_code: '',
    bk_name: '',
    gr_no: '',
    tpt: '',
    form: '',
    truck: '',
    god_code: '',
    god_name: '',
    cost_code: '',
    cost_name: '',
    conv_rate: '',
    bombay_dhara: String(ctx.bombay_dhara ?? 'N').trim().toUpperCase().slice(0, 1) === 'Y' ? 'Y' : 'N',
    remarks: '',
    stk: defaultStkFromCtx(ctx),
  };
}

export default function PurchaseBillEntryForm({
  apiBase,
  formData,
  userName,
  onBack,
  onOpenChecklist,
  billType = DEFAULT_PU_TYPE,
  variant = 'standard',
}) {
  const BILL_TYPE = String(billType || DEFAULT_PU_TYPE).trim().toUpperCase() || DEFAULT_PU_TYPE;
  const isBardana = variant === 'bardana' || BILL_TYPE === BARDANA_TYPE;
  const isDebitNote = variant === 'debit' || BILL_TYPE === DEBIT_NOTE_TYPE;
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;

  const fy = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const fyMinYmd = fy.fyMinYmd;
  const fyMaxYmd = fy.fyMaxYmd;
  const fyRangeLabel = finYearRangeLabel(fyMinYmd, fyMaxYmd);
  const defaultDocDate = useMemo(
    () => toInputDateString(defaultDocDateInFinYear(fyMinYmd, fyMaxYmd)),
    [fyMinYmd, fyMaxYmd]
  );

  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const [mode, setMode] = useState('view');
  const [header, setHeader] = useState(() => emptyHeader(defaultDocDate, defaultDocDate));
  const [footer, setFooter] = useState(() => emptyFooter());
  const [lines, setLines] = useState(() => [emptyLine(1), emptyLine(2)]);
  const [lineExpenses, setLineExpenses] = useState([]);
  const [ctx, setCtx] = useState({
    pur_exp: 'N',
    pur_cal: 'W',
    pur_order_type: 'N',
    gw_in_pur: 'Y',
    pdollar_rate: 'N',
    pur_exp_master: [],
  });
  const showGwCols = !isBardana && String(ctx.gw_in_pur ?? 'Y').trim().toUpperCase() === 'Y';
  const showUsdCols = !isBardana && String(ctx.pdollar_rate ?? 'N').trim().toUpperCase() === 'Y';
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [purAccounts, setPurAccounts] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [costCentres, setCostCentres] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [pbPerms, setPbPerms] = useState(null);
  const [partyPerms, setPartyPerms] = useState(null);
  const [permLoading, setPermLoading] = useState(true);
  const [permErr, setPermErr] = useState('');

  const [helpField, setHelpField] = useState(null);
  const [itemHelpLine, setItemHelpLine] = useState(null);
  const [bardHelpLine, setBardHelpLine] = useState(null);
  const [purHelpLine, setPurHelpLine] = useState(null);
  const [saleHelpLine, setSaleHelpLine] = useState(null);
  const [poHelpOpen, setPoHelpOpen] = useState(false);
  const [poHelpLine, setPoHelpLine] = useState(null);
  const [poHelpRows, setPoHelpRows] = useState([]);
  const [poHelpLoading, setPoHelpLoading] = useState(false);
  const [poHelpError, setPoHelpError] = useState('');
  const [dnBillHelpOpen, setDnBillHelpOpen] = useState(false);
  const [dnBillHelpRows, setDnBillHelpRows] = useState([]);
  const [dnBillHelpLoading, setDnBillHelpLoading] = useState(false);
  const [dnBillHelpError, setDnBillHelpError] = useState('');
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);
  const [costHelpOpen, setCostHelpOpen] = useState(false);
  const [expGridOpen, setExpGridOpen] = useState(false);
  const [expGridLine, setExpGridLine] = useState(null);
  const [expAccountHelpKey, setExpAccountHelpKey] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [activeTab, setActiveTab] = useState(PB_TAB.HEADER);
  const [purexpLineKey, setPurexpLineKey] = useState(null);
  const [expGridCodePatch, setExpGridCodePatch] = useState(null);

  const lineKeyRef = useRef(3);
  const newBtnRef = useRef(null);
  const entryFocusDoneRef = useRef(false);
  const lastRnoLookupRef = useRef('');
  const helpReturnFocusRef = useRef(null);
  const rdateBlurTaskRef = useRef(null);

  const [uiLocked, setUiLocked] = useState(false);

  const apiParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName }),
    [compCode, compUid, userName]
  );

  const editable = mode === 'new' || mode === 'edit';
  const docNoLocked =
    uiLocked || mode === 'edit' || (mode === 'new' && !!String(header.r_no ?? '').trim());
  const purCal = ctx.pur_cal || 'W';
  const showLineExp = !isBardana && ctx.pur_exp === 'Y';
  const pbTabs = useMemo(() => getPbTabList({ hideGrid2: isBardana }), [isBardana]);

  useEffect(() => {
    if (isBardana && activeTab === PB_TAB.GRID2) setActiveTab(PB_TAB.GRID1);
  }, [isBardana, activeTab]);

  useEffect(() => {
    if (!showLineExp) return;
    if (!lines.length) {
      setPurexpLineKey(null);
      return;
    }
    if (!lines.some((l) => l.key === purexpLineKey)) {
      setPurexpLineKey(lines[0].key);
    }
  }, [lines, purexpLineKey, showLineExp]);

  const totals = useMemo(
    () => sumPurchaseGrid(lines, lineExpenses, footer, ctx),
    [lines, lineExpenses, footer, ctx]
  );

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

  const focusOrder = useMemo(() => {
    const keys = [
      'hdr-rdate',
      'hdr-rno',
      'hdr-billdt',
      'hdr-billno',
      'hdr-due',
      'hdr-vdate',
    ];
    if (!isBardana) keys.push('hdr-bombay');
    keys.push('hdr-code', 'hdr-bk', 'hdr-god');
    if (showUsdCols) keys.push('hdr-conv');
    for (const ln of lines) {
      keys.push(
        `ln-${ln.key}-po`,
        `ln-${ln.key}-item`,
        `ln-${ln.key}-pur`,
        `ln-${ln.key}-sale`,
        `ln-${ln.key}-status`,
        `ln-${ln.key}-qty`
      );
      if (showGwCols) {
        keys.push(`ln-${ln.key}-gw`, `ln-${ln.key}-dw`);
      }
      keys.push(`ln-${ln.key}-wgt`);
      if (!isBardana) keys.push(`ln-${ln.key}-stk`);
      if (showUsdCols) {
        keys.push(`ln-${ln.key}-usd_rate`, `ln-${ln.key}-usd_amt`);
      }
      keys.push(`ln-${ln.key}-rate`, `ln-${ln.key}-amt_cal`, `ln-${ln.key}-amt`, `ln-${ln.key}-dis-p`, `ln-${ln.key}-dis-a`);
      if (!isBardana) {
        keys.push(
          `ln-${ln.key}-bard-p`,
          `ln-${ln.key}-bard-a`,
          `ln-${ln.key}-lab-p`,
          `ln-${ln.key}-lab-a`,
          `ln-${ln.key}-fgt`,
          `ln-${ln.key}-ins`,
          `ln-${ln.key}-oth`
        );
      }
      keys.push(
        `ln-${ln.key}-cgst-p`,
        `ln-${ln.key}-cgst-a`,
        `ln-${ln.key}-sgst-p`,
        `ln-${ln.key}-sgst-a`,
        `ln-${ln.key}-igst-p`,
        `ln-${ln.key}-igst-a`
      );
      if (!isBardana) {
        keys.push(
          `ln-${ln.key}-mlot`,
          `ln-${ln.key}-dane`,
          `ln-${ln.key}-lot`,
          `ln-${ln.key}-bno`,
          `ln-${ln.key}-pmt`
        );
      }
    }
    keys.push(...getExpenseSummaryFocusKeys(isBardana ? { bardana: true } : {}));
    keys.push(...getBillExpensesFocusKeys({ bardana: isBardana }));
    return keys;
  }, [lines, showGwCols, showUsdCols, isBardana]);

  useEffect(() => {
    focusChain.setOrder(focusOrder);
  }, [focusChain, focusOrder]);

  const restoreHelpFocus = useCallback(() => {
    const key = helpReturnFocusRef.current;
    helpReturnFocusRef.current = null;
    if (!key) return;
    if (key.startsWith('hdr-')) setActiveTab(PB_TAB.HEADER);
    else if (key.startsWith('ln-')) setActiveTab(PB_TAB.GRID1);
    else if (key.startsWith('ft-')) setActiveTab(PB_TAB.EXPENSES);
    else if (key.startsWith('be-')) setActiveTab(PB_TAB.BILL_EXP);
    window.setTimeout(() => {
      if (!focusChain.focusKey(key)) {
        window.setTimeout(() => focusChain.focusKey(key), 80);
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

  const openGodownHelp = useCallback(() => {
    helpReturnFocusRef.current = 'hdr-god';
    setGodownHelpOpen(true);
  }, []);

  const closeGodownHelp = useCallback(() => {
    setGodownHelpOpen(false);
    restoreHelpFocus();
  }, [restoreHelpFocus]);

  useEffect(() => {
    if (permLoading || permErr || entryFocusDoneRef.current || !pbPerms?.canOpen) return;
    entryFocusDoneRef.current = true;
    window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 80);
  }, [focusChain, permErr, permLoading, pbPerms?.canOpen]);

  const closeHelpModals = useCallback(() => {
    helpReturnFocusRef.current = null;
    setHelpField(null);
    setItemHelpLine(null);
    setBardHelpLine(null);
    setPurHelpLine(null);
    setSaleHelpLine(null);
    setPoHelpOpen(false);
    setPoHelpLine(null);
    setDnBillHelpOpen(false);
    setGodownHelpOpen(false);
    setCostHelpOpen(false);
    setExpGridOpen(false);
    setExpGridLine(null);
    setExpAccountHelpKey(null);
  }, []);

  const loadLookups = useCallback(async () => {
    if (!compCode) return;
    setPermLoading(true);
    setPermErr('');
    try {
      const permRes = await axios.get(`${apiBase}/api/purchase-bill/user-permissions`, {
        params: { user_name: userName },
        ...reqOpts,
      });
      const perms = permRes.data || {};
      setPbPerms(perms);
      if (!perms.canOpen) {
        setPermErr('Access Denied');
        return;
      }
      const params = { comp_code: compCode, comp_uid: compUid };
      const [ctxRes, itemsRes, costRes, purRes, brokerRes, godRes, acRes, partyPermRes] = await Promise.all([
        axios.get(`${apiBase}/api/purchase-bill/context`, { params }),
        axios.get(`${apiBase}/api/purchaselist-items`, { params }),
        axios.get(`${apiBase}/api/goods-inward/cost-help`, { params: { ...params, user_name: userName } }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
        axios.get(`${apiBase}/api/salelist-brokers`, { params }),
        axios.get(`${apiBase}/api/purchaselist-godowns`, { params }),
        axios.get(`${apiBase}/api/purchaselist-purcodes`, { params }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        }),
      ]);
      const c = ctxRes.data || {};
      setCtx({
        pur_exp: String(c.pur_exp ?? 'N').trim().toUpperCase(),
        pur_cal: String(c.pur_cal ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W',
        pur_order_type: String(c.pur_order_type ?? 'N').trim().toUpperCase(),
        pur_exp_type: Number(c.pur_exp_type ?? 0) || 0,
        pur_debit_note_exp_type: Number(c.pur_debit_note_exp_type ?? 0) || 0,
        pur_exp_master: Array.isArray(c.pur_exp_master) ? c.pur_exp_master : [],
        ...c,
        gw_in_pur: String(c.gw_in_pur ?? 'Y').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
        pdollar_rate: String(c.pdollar_rate ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
        group_cd:
          Number(
            c.group_cd ??
              formData?.group_cd ??
              formData?.GROUP_CD ??
              formData?.g_group_cd ??
              formData?.G_GROUP_CD ??
              0
          ) || 0,
        wgt_kq: String(c.wgt_kq ?? 'W').trim().toUpperCase().slice(0, 1) || 'W',
        tds_round_off_value: Number(c.tds_round_off_value ?? 0) || 0,
        pur_stk_trf: String(c.pur_stk_trf ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
      });
      setFooter(emptyFooter(c));
      setHeader((h) => {
        if (String(h.r_no ?? '').trim()) return h;
        return { ...h, stk: defaultStkFromCtx(c) };
      });
      setItems(itemsRes.data || []);
      setCostCentres(Array.isArray(costRes.data?.rows) ? costRes.data.rows : costRes.data || []);
      setPurAccounts(purRes.data || []);
      setBrokers(brokerRes.data || []);
      setGodowns(godRes.data || []);
      setAccounts(acRes.data || []);
      setPartyPerms(partyPermRes.data || null);
    } catch (err) {
      setPermErr(err.response?.data?.error || err.message || 'Could not load purchase bill.');
      setPbPerms(null);
    } finally {
      setPermLoading(false);
    }
  }, [apiBase, compCode, compUid, formData, userName]);

  useEffect(() => {
    loadLookups().catch(() => {});
  }, [loadLookups]);

  const applyLoaded = useCallback(
    (data) => {
      const h = data?.header || {};
      const curBal = Number(h.cur_bal);
      setHeader({
        r_date: toInputDateString(h.r_date) || defaultDocDate,
        r_no: h.r_no ? String(h.r_no) : '',
        bill_date: toInputDateString(h.bill_date) || defaultDocDate,
        bill_no: h.bill_no || '',
        due: h.due != null && h.due !== '' ? String(h.due) : '',
        v_date: toInputDateString(h.v_date) || defaultDocDate,
        bombay_dhara: (() => {
          const raw =
            h.bombay_dhara != null && String(h.bombay_dhara).trim() !== ''
              ? String(h.bombay_dhara).trim()
              : ctx.bombay_dhara != null
                ? String(ctx.bombay_dhara)
                : 'N';
          return raw.toUpperCase().slice(0, 1) === 'Y' ? 'Y' : 'N';
        })(),
        code: h.code || '',
        party_name: h.party_name || '',
        party_city: h.party_city || '',
        gst_no: h.gst_no || '',
        pan: h.pan || '',
        msme_no: h.msme_no || '',
        cur_bal:
          h.cur_bal != null && h.cur_bal !== ''
            ? Number.isFinite(curBal)
              ? curBal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : String(h.cur_bal)
            : '',
        b_code: h.b_code || '',
        bk_name: h.bk_name || '',
        gr_no: h.gr_no || '',
        tpt: h.tpt || '',
        form: h.form || '',
        truck: h.truck || '',
        god_code: h.god_code || '',
        god_name: h.god_name || '',
        cost_code: h.cost_code || '',
        cost_name: '',
        conv_rate: h.conv_rate != null && h.conv_rate !== '' ? String(h.conv_rate) : '',
        remarks: h.remarks || '',
        stk: h.stk === 'Y' ? 'Y' : 'N',
      });
      setFooter((f) => ({
        ...f,
        comm_per: h.comm_per != null ? String(h.comm_per) : '',
        comm_cal: h.comm_cal != null ? String(h.comm_cal) : '',
        comm_amt: h.comm_amt != null ? String(h.comm_amt) : '',
        comm_code: h.comm_code || f.comm_code,
        brok_rate: h.brok_rate != null ? String(h.brok_rate) : '',
        brok_amt: h.brok_amt != null ? String(h.brok_amt) : '',
        brok_cal: h.brok_cal != null ? String(h.brok_cal) : '',
        brok_paid_per: h.brok_paid_per != null ? String(h.brok_paid_per) : '',
        cd_per: h.cd_per != null ? String(h.cd_per) : '',
        brok_d_cd: h.brok_d_cd != null && h.brok_d_cd !== '' ? String(h.brok_d_cd) : '',
        tds_comm: h.tds_comm != null ? String(h.tds_comm) : '',
        tds_no: h.tds_no || '',
        sur_per: h.sur_per != null ? String(h.sur_per) : '',
        sur_amt: h.sur_amt != null ? String(h.sur_amt) : '',
        edu_per: h.edu_per != null ? String(h.edu_per) : '',
        edu_amt: h.edu_amt != null ? String(h.edu_amt) : '',
        tot_tds: h.tot_tds != null ? String(h.tot_tds) : '',
        freight_hdr: h.freight_hdr != null ? String(h.freight_hdr) : h.freight_paid != null ? String(h.freight_paid) : '',
        f_dr_code: h.f_dr_code || '',
        f_cr_code: h.f_cr_code || '',
        bl_no: h.bl_no || '',
        file_no: h.file_no || '',
        bref_no: h.bref_no || '',
        job_no: h.job_no || '',
        p_bill_no_file_path: h.p_bill_no_file_path || '',
        cform_amt: h.cform_amt != null ? String(h.cform_amt) : '',
        lab_rate_hdr: h.lab_rate_hdr != null ? String(h.lab_rate_hdr) : h.labour != null ? String(h.labour) : '',
        exp_cat: h.exp_cat || f.exp_cat,
        dis_per_hdr: h.dis_per_hdr != null ? String(h.dis_per_hdr) : '',
        dis_amt_hdr: h.dis_amt_hdr != null ? String(h.dis_amt_hdr) : '',
        dis_code: h.dis_code || '',
        cgst_code: h.cgst_code || f.cgst_code,
        sgst_code: h.sgst_code || f.sgst_code,
        igst_code: h.igst_code || f.igst_code,
        ntds_on_amt: h.ntds_on_amt != null ? String(h.ntds_on_amt) : '',
        ntds_on_manual: h.ntds_on_amt != null && Number(h.ntds_on_amt) !== 0,
        ntds_per: h.ntds_per != null ? String(h.ntds_per) : '',
        ntds_amt: h.ntds_amt != null ? String(h.ntds_amt) : '',
        ntds_code: h.ntds_code || f.ntds_code,
        mud_per: h.mud_per != null ? String(h.mud_per) : '',
        mud_amt: h.mud_amt != null ? String(h.mud_amt) : '',
        mud_code: h.mud_code || '',
        tcs_per: h.tcs_per != null ? String(h.tcs_per) : '',
        tcs_amt: h.tcs_amt != null ? String(h.tcs_amt) : '',
        tcs_code: h.tcs_code || f.tcs_code,
        tds_per: h.tds_per != null ? String(h.tds_per) : '',
        tds_amt: h.tds_amt != null ? String(h.tds_amt) : '',
        tds_code: h.tds_code || f.tds_code,
        oth_exp_1: h.oth_exp_1 != null ? String(h.oth_exp_1) : '',
        oth_exp_2: h.oth_exp_2 != null ? String(h.oth_exp_2) : '',
        oth_exp_3: h.oth_exp_3 != null ? String(h.oth_exp_3) : '',
        oth_exp_4: h.oth_exp_4 != null ? String(h.oth_exp_4) : '',
        oth_exp_5: h.oth_exp_5 != null ? String(h.oth_exp_5) : '',
        oth_exp_6: h.oth_exp_6 != null ? String(h.oth_exp_6) : '',
        oth_exp_7: h.oth_exp_7 != null ? String(h.oth_exp_7) : '',
        oth_exp_8: h.oth_exp_8 != null ? String(h.oth_exp_8) : '',
        oth_cd_1: h.oth_cd_1 || '',
        oth_cd_2: h.oth_cd_2 || '',
        oth_cd_3: h.oth_cd_3 || '',
        oth_cd_4: h.oth_cd_4 || '',
        oth_cd_5: h.oth_cd_5 || '',
        oth_cd_6: h.oth_cd_6 || '',
        oth_cd_7: h.oth_cd_7 || '',
        oth_cd_8: h.oth_cd_8 || '',
        brok_paid: h.brok_paid != null ? String(h.brok_paid) : '',
        brok_paid_code: h.brok_paid_code || f.brok_paid_code,
        mandi_exp: h.mandi_exp != null ? String(h.mandi_exp) : '',
        mandi_exp_code: h.mandi_exp_code || f.mandi_exp_code,
        labour_exp: h.labour_exp != null ? String(h.labour_exp) : '',
        labour_exp_code: h.labour_exp_code || f.labour_exp_code,
        bardana_exp: h.bardana_exp != null ? String(h.bardana_exp) : '',
        bardana_exp_code: h.bardana_exp_code || f.bardana_exp_code,
        freight_paid: h.freight_paid != null ? String(h.freight_paid) : '',
        freight_paid_code: h.freight_paid_code || f.freight_paid_code,
        cd_amount: h.cd_amount != null ? String(h.cd_amount) : '',
        cd_amount_code: h.cd_amount_code || f.cd_amount_code,
        dharam_kanta: h.dharam_kanta != null ? String(h.dharam_kanta) : '',
        dharam_kanta_code: h.dharam_kanta_code || f.dharam_kanta_code,
        tulwai_exp: h.tulwai_exp != null ? String(h.tulwai_exp) : '',
        tulwai_code: h.tulwai_code || f.tulwai_code,
        round_off: h.round_off != null ? String(h.round_off) : '',
        round_off_code: h.round_off_code || f.round_off_code,
        labour: h.labour != null ? String(h.labour) : '',
        l_d_code: h.l_d_code || '',
        l_c_code: h.l_c_code || '',
        pu_r_no: h.pu_r_no ? String(h.pu_r_no) : '',
      }));
      const loaded = (data?.lines || []).map((ln, idx) => ({
        key: idx + 1,
        trn_no: ln.trn_no || idx + 1,
        so_no: ln.so_no ? String(ln.so_no) : '',
        item_code: ln.item_code ? String(ln.item_code) : '',
        item_name: ln.item_name || '',
        pur_code: ln.pur_code || '',
        pur_name: ln.pur_name || '',
        s_code: ln.s_code || '',
        s_name: ln.s_name || '',
        bard_item_code: ln.bard_item_code ? String(ln.bard_item_code) : '',
        bard_item_name: ln.bard_item_name || '',
        status: ln.status || 'B',
        qnty: ln.qnty != null && ln.qnty !== '' ? String(ln.qnty) : '',
        g_weight: ln.g_weight != null && ln.g_weight !== '' ? String(ln.g_weight) : '',
        d_weight: ln.d_weight != null && ln.d_weight !== '' ? String(ln.d_weight) : '',
        weight: ln.weight != null && ln.weight !== '' ? String(ln.weight) : '',
        stk_weight: ln.stk_weight != null && ln.stk_weight !== '' ? String(ln.stk_weight) : '',
        usd_rate: ln.usd_rate != null && ln.usd_rate !== '' ? String(ln.usd_rate) : '',
        usd_amount: ln.usd_amount != null && ln.usd_amount !== '' ? String(ln.usd_amount) : '',
        rate: ln.rate != null && ln.rate !== '' ? String(ln.rate) : '',
        amount: ln.amount != null && ln.amount !== '' ? String(ln.amount) : '',
        amt_cal: ln.amt_cal || purCal,
        dis_per: ln.dis_per != null && ln.dis_per !== '' ? String(ln.dis_per) : '',
        dis_amt: ln.dis_amt != null && ln.dis_amt !== '' ? String(ln.dis_amt) : '',
        cgst_per: ln.cgst_per != null && ln.cgst_per !== '' ? String(ln.cgst_per) : '',
        cgst_amt: ln.cgst_amt != null && ln.cgst_amt !== '' ? String(ln.cgst_amt) : '',
        sgst_per: ln.sgst_per != null && ln.sgst_per !== '' ? String(ln.sgst_per) : '',
        sgst_amt: ln.sgst_amt != null && ln.sgst_amt !== '' ? String(ln.sgst_amt) : '',
        igst_per: ln.igst_per != null && ln.igst_per !== '' ? String(ln.igst_per) : '',
        igst_amt: ln.igst_amt != null && ln.igst_amt !== '' ? String(ln.igst_amt) : '',
        bard_per: ln.bard_per != null && ln.bard_per !== '' ? String(ln.bard_per) : '',
        bard_amt: ln.bard_amt != null && ln.bard_amt !== '' ? String(ln.bard_amt) : '',
        lab_per: ln.lab_per != null && ln.lab_per !== '' ? String(ln.lab_per) : '',
        lab_amt: ln.lab_amt != null && ln.lab_amt !== '' ? String(ln.lab_amt) : '',
        fgt_amt: ln.fgt_amt != null && ln.fgt_amt !== '' ? String(ln.fgt_amt) : '',
        ins_amt: ln.ins_amt != null && ln.ins_amt !== '' ? String(ln.ins_amt) : '',
        oth_amt: ln.oth_amt != null && ln.oth_amt !== '' ? String(ln.oth_amt) : '',
        dane_rate: ln.dane_rate != null && ln.dane_rate !== '' ? String(ln.dane_rate) : '',
        dane_amt: ln.dane_amt != null && ln.dane_amt !== '' ? String(ln.dane_amt) : '',
        pmt_rate: ln.pmt_rate != null && ln.pmt_rate !== '' ? String(ln.pmt_rate) : '',
        remarks: ln.remarks || '',
        lot: ln.lot ? String(ln.lot) : '',
        b_no: ln.b_no ? String(ln.b_no) : '',
        mlot_no: ln.mlot_no || '',
        cost_code: ln.cost_code || '',
      }));
      lineKeyRef.current = Math.max(3, loaded.length + 1);
      setLines(loaded.length ? loaded : [emptyLine(1, purCal), emptyLine(2, purCal)]);
      setLineExpenses(data?.line_expenses || []);
      setMode('view');
      setUiLocked(true);
      const od = toOracleDateFromAny(h.r_date);
      if (od && h.r_no != null) {
        lastRnoLookupRef.current = `${od}|${String(h.r_no).trim()}`;
      }
    },
    [defaultDocDate, purCal, ctx]
  );

  const tryLoadExistingBill = useCallback(
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
          const { data } = await axios.get(`${apiBase}/api/purchase-bill/next-no`, {
            params: { ...apiParams, r_date: oracleDt, type: BILL_TYPE },
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
        const { data } = await axios.get(`${apiBase}/api/purchase-bill`, {
          params: {
            ...apiParams,
            type: BILL_TYPE,
            r_no: no,
            r_date: oracleDt,
          },
          ...reqOpts,
        });
        lastRnoLookupRef.current = lookupKey;
        applyLoaded(data);
        setStatus(`Purchase bill ${no} loaded — press Edit to modify or Delete to remove.`);
        return true;
      } catch (err) {
        lastRnoLookupRef.current = lookupKey;
        if (err.response?.status === 404) {
          let billNo = no;
          if (!billNo) {
            try {
              const { data } = await axios.get(`${apiBase}/api/purchase-bill/next-no`, {
                params: { ...apiParams, r_date: oracleDt, type: BILL_TYPE },
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
            ...emptyHeader(h.r_date || defaultDocDate, h.r_date || defaultDocDate, ctx),
            r_date: h.r_date,
            r_no: billNo,
          }));
          setFooter(emptyFooter(ctx));
          setLines([emptyLine(1, purCal), emptyLine(2, purCal)]);
          setLineExpenses([]);
          lineKeyRef.current = 3;
          if (!quiet) setStatus(billNo ? `New bill ${billNo} — enter bill details.` : 'New bill — enter bill details.');
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
    [apiBase, apiParams, applyLoaded, ctx, defaultDocDate, focusChain, header.r_date, header.r_no, purCal, uiLocked]
  );

  const loadBill = useCallback(
    async (rNo, rDate) => {
      if (!rNo) return;
      setBusy(true);
      setStatus('');
      try {
        const { data } = await axios.get(`${apiBase}/api/purchase-bill`, {
          params: {
            ...apiParams,
            type: BILL_TYPE,
            r_no: rNo,
            r_date: toOracleDateFromAny(rDate || header.r_date),
          },
          ...reqOpts,
        });
        applyLoaded(data);
        setStatus(`Purchase bill ${rNo} loaded — press Edit to modify or Delete to remove.`);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, header.r_date]
  );

  const navigateBill = useCallback(
    async (direction) => {
      setBusy(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/purchase-bill/nav`, {
          params: {
            ...apiParams,
            type: BILL_TYPE,
            r_no: header.r_no,
            r_date: toOracleDateFromAny(header.r_date),
            direction,
          },
          ...reqOpts,
        });
        applyLoaded(data);
      } catch (err) {
        setStatus(err.response?.data?.error || err.message);
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, applyLoaded, header.r_date, header.r_no]
  );

  const startNew = useCallback(() => {
    closeHelpModals();
    setMode('view');
    setUiLocked(false);
    setStatus('');
    lastRnoLookupRef.current = '';
    const rDate = defaultDocDate;
    setHeader(emptyHeader(rDate, rDate, ctx));
    setFooter(emptyFooter(ctx));
    setLines([emptyLine(1, purCal), emptyLine(2, purCal)]);
    setLineExpenses([]);
    lineKeyRef.current = 3;
    setActiveTab(PB_TAB.HEADER);
    window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 50);
  }, [closeHelpModals, ctx, defaultDocDate, focusChain, purCal]);

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
        const { data } = await axios.get(`${apiBase}/api/purchase-bill/next-no`, {
          params: { ...apiParams, r_date: oracleDt, type: BILL_TYPE },
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

  const handleRdateKeyDown = useCallback(
    (e) => {
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
    },
    [focusChain, handleRdateBlur, header.r_date]
  );

  const handleRnoFocus = useCallback(() => {
    if (uiLocked || mode === 'edit' || busy) return;
    if (String(header.r_no ?? '').trim()) return;
    if (!header.r_date) return;
    const pending = rdateBlurTaskRef.current;
    if (pending) {
      void pending;
      return;
    }
    void handleRdateBlur(header.r_date);
  }, [busy, handleRdateBlur, header.r_date, header.r_no, mode, uiLocked]);

  const handleRnoChange = useCallback((e) => {
    lastRnoLookupRef.current = '';
    setUiLocked(false);
    setHeader((h) => ({ ...h, r_no: e.target.value.replace(/\D/g, '') }));
  }, []);

  const handleRnoBlur = useCallback(() => {
    const no = String(header.r_no ?? '').trim();
    if (!no || uiLocked) return;
    void tryLoadExistingBill(no, { quiet: true });
  }, [header.r_no, tryLoadExistingBill, uiLocked]);

  const handleRnoKeyDown = useCallback(
    (e) => {
      if (e.key === 'F1' || e.keyCode === 112) {
        e.preventDefault();
        setListOpen(true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void tryLoadExistingBill(header.r_no, { quiet: true, advanceIfNew: true });
        return;
      }
      focusChain.onEnter('hdr-rno')(e);
    },
    [focusChain, header.r_no, tryLoadExistingBill]
  );

  const advanceToGrid1 = useCallback(() => {
    setActiveTab(PB_TAB.GRID1);
    const firstKey = lines[0]?.key;
    if (firstKey) window.setTimeout(() => focusChain.focusKey(`ln-${firstKey}-po`), 60);
  }, [focusChain, lines]);

  const startEdit = useCallback(() => {
    if (!header.r_no) {
      setStatus('Open a purchase bill first.');
      return;
    }
    if (!pbPerms?.canEdit) {
      setStatus('Edit permission denied.');
      return;
    }
    setMode('edit');
    setStatus('');
  }, [header.r_no, pbPerms?.canEdit]);

  const cancelEdit = useCallback(() => {
    closeHelpModals();
    if (header.r_no) void loadBill(header.r_no, header.r_date);
    else {
      setMode('view');
      setHeader(emptyHeader(defaultDocDate, defaultDocDate, ctx));
      setLines([emptyLine(1, purCal), emptyLine(2, purCal)]);
      setFooter(emptyFooter(ctx));
      setLineExpenses([]);
    }
    setStatus('Changes discarded.');
  }, [closeHelpModals, ctx, defaultDocDate, header.r_date, header.r_no, loadBill, purCal]);

  const updateLine = useCallback(
    (key, patch) => {
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== key) return ln;
          const oldGWeight = ln.g_weight;
          let next = { ...ln, ...patch };
          if (patch.item_code != null) {
            const ic = Number(patch.item_code) || 0;
            if (!ic) {
              next.item_name = '';
            } else {
              const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
              next = applyItemmastToLine(next, row, { purAccounts, accounts });
            }
          }
          return recalcLine(next, ctx, {
            oldGWeight,
            gWeightPatched: Object.prototype.hasOwnProperty.call(patch, 'g_weight'),
            stkTouched: Object.prototype.hasOwnProperty.call(patch, 'stk_weight'),
          });
        })
      );
    },
    [accounts, ctx, items, purAccounts]
  );

  const applyExpenseRecalc = useCallback(
    (baseFooter, opts = {}) => {
      const { footer: next, alert } = recalcExpenseSummary(baseFooter, totals, ctx, lines);
      if (alert && !opts.silent && opts.showCommAlert) {
        window.setTimeout(() => {
          window.alert(alert.message);
          setActiveTab(PB_TAB.EXPENSES);
          focusChain.focusKey(alert.focusKey);
        }, 0);
      }
      return next;
    },
    [ctx, focusChain, lines, totals]
  );

  const onFooter = useCallback(
    (field, value) => {
      setFooter((f) => {
        const patched = { ...f, [field]: value };
        if (field === 'ntds_on_amt') {
          patched.ntds_on_manual = String(value ?? '').trim() !== '';
        }
        const showCommAlert =
          field === 'comm_cal' ||
          (field === 'comm_per' && String(patched.comm_cal ?? '').trim() !== '');
        return applyExpenseRecalc(patched, { showCommAlert });
      });
    },
    [applyExpenseRecalc]
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
        const status = err.response?.status;
        const msg =
          status === 413
            ? 'File is too large to upload (max about 30 MB). Choose a smaller scan/PDF, or type the path starting with \\ without the drive letter.'
            : err.response?.data?.error || err.message || 'Scan upload failed.';
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
      setStatus('No scan bill path — browse/select a file in Bill Expenses first.');
      window.alert('No scan bill path.\n\nOpen Bill Expenses → Scan Bill Path → Browse to attach a file.');
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

  useEffect(() => {
    setFooter((f) => {
      const next = applyExpenseRecalc(f, { silent: true });
      const watch = [
        'comm_amt',
        'mud_amt',
        'mud_code',
        'brok_paid',
        'cd_amount',
        'ntds_on_amt',
        'ntds_amt',
      ];
      if (watch.every((k) => String(next[k] ?? '') === String(f[k] ?? ''))) return f;
      return next;
    });
  }, [
    applyExpenseRecalc,
    totals.amount,
    totals.qnty,
    totals.weight,
    totals.stk_weight,
    totals.m_g_amount,
  ]);

  const resolveParty = useCallback(
    (code) => {
      const hit = (purAccounts || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
      if (!hit) return;
      const bal = Number(hit.CUR_BAL ?? hit.cur_bal ?? 0);
      setHeader((h) => ({
        ...h,
        code,
        party_name: String(hit.NAME ?? hit.name ?? '').trim(),
        party_city: String(hit.CITY ?? hit.city ?? '').trim(),
        gst_no: String(hit.GST_NO ?? hit.gst_no ?? '').trim(),
        pan: String(hit.PAN ?? hit.pan ?? '').trim(),
        msme_no: String(hit.MSME_NO ?? hit.msme_no ?? '').trim(),
        cur_bal: Number.isFinite(bal) ? bal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
      }));
    },
    [purAccounts]
  );

  const resolveBroker = useCallback(
    (code) => {
      const hit = (brokers || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
      setHeader((h) => ({
        ...h,
        b_code: code,
        bk_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
      }));
    },
    [brokers]
  );

  const openPoHelp = useCallback(
    async (lineKey) => {
      helpReturnFocusRef.current = `ln-${lineKey}-po`;
      const filterCode = ctx.pur_order_type === 'C' ? header.code : header.b_code;
      if (!filterCode) {
        setStatus(ctx.pur_order_type === 'C' ? 'Enter supplier first.' : 'Enter broker first.');
        return;
      }
      setPoHelpLine(lineKey);
      setPoHelpOpen(true);
      setPoHelpLoading(true);
      setPoHelpError('');
      try {
        const { data } = await axios.get(`${apiBase}/api/purchase-bill/po-help`, {
          params: { ...apiParams, code: header.code, bk_code: header.b_code },
          ...reqOpts,
        });
        setPoHelpRows(data || []);
      } catch (err) {
        setPoHelpError(err.response?.data?.error || err.message);
        setPoHelpRows([]);
      } finally {
        setPoHelpLoading(false);
      }
    },
    [apiBase, apiParams, ctx.pur_order_type, header.b_code, header.code]
  );

  const openGridHelp = useCallback(
    (kind, lineKey) => {
      const suffix = { po: 'po', item: 'item', pur: 'pur', sale: 'sale' }[kind];
      if (suffix) helpReturnFocusRef.current = `ln-${lineKey}-${suffix}`;
      if (kind === 'po') void openPoHelp(lineKey);
      else if (kind === 'item') setItemHelpLine(lineKey);
      else if (kind === 'pur') setPurHelpLine(lineKey);
      else if (kind === 'sale') setSaleHelpLine(lineKey);
    },
    [openPoHelp]
  );

  const handlePoHelpSelect = useCallback(
    (row) => {
      if (!poHelpLine || !row) return;
      updateLine(poHelpLine, {
        so_no: String(row.so_no ?? ''),
        item_code: String(row.item_code ?? ''),
        rate: row.rate != null ? String(row.rate) : '',
      });
    },
    [poHelpLine, updateLine]
  );

  const openDnBillHelp = useCallback(async () => {
    if (!isDebitNote) return;
    if (mode === 'view') {
      setStatus('Press New or Edit before choosing a purchase bill.');
      return;
    }
    const code = String(header.code || '').trim();
    if (!code) {
      setStatus('Enter supplier first, then open Bill Date / Bill No help.');
      window.alert('Enter supplier code first.');
      focusChain.focusKey('hdr-code');
      return;
    }
    helpReturnFocusRef.current = 'hdr-billdt';
    setDnBillHelpOpen(true);
    setDnBillHelpLoading(true);
    setDnBillHelpError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/purchase-bill/dn-source-lines`, {
        params: { ...apiParams, code },
        ...reqOpts,
      });
      setDnBillHelpRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setDnBillHelpError(err.response?.data?.error || err.message || 'Bill help failed.');
      setDnBillHelpRows([]);
    } finally {
      setDnBillHelpLoading(false);
    }
  }, [apiBase, apiParams, focusChain, header.code, isDebitNote, mode]);

  const applyDnBillHelp = useCallback(
    (selected) => {
      if (!Array.isArray(selected) || !selected.length) return;
      const first = selected[0];
      const billYmd = toInputDateString(first.bill_date) || header.bill_date;
      const godCode = String(first.god_code || '').trim();
      const godHit = (godowns || []).find(
        (g) => String(g.GOD_CODE ?? g.god_code ?? '').trim() === godCode
      );
      const bCode = String(first.b_code || '').trim();
      setHeader((h) => ({
        ...h,
        bill_date: billYmd,
        bill_no: String(first.bill_no || '').trim(),
        v_date: h.due ? addDaysToYmd(billYmd, h.due) || billYmd : billYmd,
        b_code: bCode,
        bk_name: '',
        god_code: godCode,
        god_name: godHit ? String(godHit.GOD_NAME ?? godHit.god_name ?? '').trim() : '',
      }));
      if (bCode) resolveBroker(bCode);
      onFooter('pu_r_no', String(first.r_no ?? ''));

      lineKeyRef.current = selected.length + 2;
      const nextLines = selected.map((r, idx) => {
        let ln = {
          ...emptyLine(idx + 1, String(r.amt_cal || purCal).trim().slice(0, 1) || purCal),
          so_no: r.so_no ? String(r.so_no) : '',
          item_code: r.item_code ? String(r.item_code) : '',
          item_name: String(r.item_name || '').trim(),
          pur_code: String(r.pur_code || '').trim(),
          s_code: String(r.s_code || '').trim(),
          status: String(r.status || 'B').trim() || 'B',
          qnty: r.qnty != null ? String(r.qnty) : '',
          weight: r.weight != null ? String(r.weight) : '',
          g_weight: r.g_weight != null ? String(r.g_weight) : '',
          d_weight: r.d_weight != null ? String(r.d_weight) : '',
          rate: r.rate != null ? String(r.rate) : '',
          lot: r.lot ? String(r.lot) : '',
          b_no: r.b_no ? String(r.b_no) : '',
          mlot_no: String(r.mlot_no || '').trim(),
          amt_cal: String(r.amt_cal || purCal).trim().slice(0, 1) || purCal,
        };
        const ic = Number(r.item_code) || 0;
        if (ic) {
          const itemRow = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === ic);
          ln = applyItemmastToLine(ln, itemRow, { purAccounts, accounts });
        }
        return recalcLine(ln, ctx, { oldGWeight: '', gWeightPatched: true, stkTouched: false });
      });
      setLines(nextLines.length ? nextLines : [emptyLine(1, purCal), emptyLine(2, purCal)]);
      setActiveTab(PB_TAB.GRID1);
      setStatus(`Loaded ${selected.length} line(s) from PU R.No ${first.r_no}.`);
    },
    [
      accounts,
      ctx,
      godowns,
      header.bill_date,
      items,
      onFooter,
      purAccounts,
      purCal,
      resolveBroker,
    ]
  );

  const addLine = useCallback(() => {
    const key = lineKeyRef.current;
    lineKeyRef.current += 1;
    setLines((prev) => [...prev, emptyLine(key, purCal)]);
  }, [purCal]);

  const saveBill = useCallback(async () => {
    const rDateErr = finYearDateErrorMessage(header.r_date, fyMinYmd, fyMaxYmd);
    if (rDateErr) {
      setStatus(rDateErr);
      return;
    }
    if (!header.code) {
      setStatus('Supplier code is required.');
      return;
    }
    const expCodeErr = validatePurchaseLedgerExpenseCodes({
      footer,
      lines,
      lineExpenses,
      totals,
    });
    if (expCodeErr) {
      setStatus(expCodeErr);
      window.alert(expCodeErr);
      setActiveTab(PB_TAB.EXPENSES);
      return;
    }
    closeHelpModals();
    setBusy(true);
    setStatus('');
    try {
      const saveFooter = isBardana
        ? {
            ...footer,
            tcs_per: '',
            tcs_amt: '',
            tcs_code: '',
            // brokerage TDS block not on bardana bill-expenses panel
            tds_comm: '',
            tds_per: '',
            tds_amt: '',
            tds_code: '',
            sur_per: '',
            sur_amt: '',
            edu_per: '',
            edu_amt: '',
            tot_tds: '',
          }
        : footer;
      const payload = {
        ...apiParams,
        comp_year: compYear,
        mode,
        type: BILL_TYPE,
        r_date: toOracleDateFromAny(header.r_date),
        r_no: Number(header.r_no) || 0,
        bill_date: toOracleDateFromAny(header.bill_date),
        bill_no: header.bill_no,
        due: num(header.due),
        v_date: toOracleDateFromAny(header.v_date),
        bombay_dhara: isBardana ? 'N' : header.bombay_dhara,
        code: header.code,
        b_code: header.b_code,
        gr_no: header.gr_no,
        tpt: header.tpt,
        form: header.form,
        truck: header.truck,
        god_code: header.god_code,
        cost_code: header.cost_code,
        remarks: header.remarks,
        stk: header.stk,
        bill_amt: totals.mbamt,
        fy_s_date: toOracleDate(fyMinYmd),
        fy_e_date: toOracleDate(fyMaxYmd),
        footer: saveFooter,
        lines: lines.map((ln) => ({ ...ln, trn_no: ln.trn_no || ln.key })),
        line_expenses: lineExpenses,
      };
      const { data } = await axios.post(`${apiBase}/api/purchase-bill`, payload, reqOpts);
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
    BILL_TYPE,
    closeHelpModals,
    compYear,
    footer,
    fyMaxYmd,
    fyMinYmd,
    header,
    isBardana,
    lineExpenses,
    lines,
    mode,
    totals,
    totals.mbamt,
  ]);

  const deleteBill = useCallback(async () => {
    if (!header.r_no) return;
    if (!pbPerms?.canDelete) {
      setStatus('Delete permission denied.');
      return;
    }
    if (!window.confirm(`Delete Purchase Bill No. ${header.r_no}?`)) return;
    setBusy(true);
    try {
      const { data } = await axios.delete(`${apiBase}/api/purchase-bill`, {
        data: {
          ...apiParams,
          type: BILL_TYPE,
          r_no: header.r_no,
          r_date: toOracleDateFromAny(header.r_date),
        },
        ...reqOpts,
      });
      window.alert(data.message || 'Deleted.');
      setUiLocked(false);
      lastRnoLookupRef.current = '';
      setHeader(emptyHeader(defaultDocDate, defaultDocDate, ctx));
      setLines([emptyLine(1, purCal), emptyLine(2, purCal)]);
      setFooter(emptyFooter(ctx));
      setLineExpenses([]);
      setMode('view');
      setActiveTab(PB_TAB.HEADER);
      window.setTimeout(() => focusChain.focusKey('hdr-rdate'), 80);
    } catch (err) {
      window.alert(err.response?.data?.error || err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, ctx, defaultDocDate, focusChain, header.r_date, header.r_no, pbPerms?.canDelete, purCal]);

  const handleGridF1 = useCallback(
    (e, kind, lineKey) => {
      if (e.key !== 'F1') return;
      e.preventDefault();
      if (kind === 'po' || kind === 'item' || kind === 'pur' || kind === 'sale') {
        openGridHelp(kind, lineKey);
        return;
      }
      if (kind === 'bard') {
        helpReturnFocusRef.current = `ln-${lineKey}-bard`;
        setBardHelpLine(lineKey);
        return;
      }
      if (kind === 'amt') {
        updateLine(lineKey, {});
      }
    },
    [openGridHelp, updateLine]
  );

  const handleGridEsc = useCallback(
    (e, line) => {
      if (e.key !== 'Escape' || !showLineExp) return;
      e.preventDefault();
      setExpGridLine(line);
      setExpGridOpen(true);
    },
    [showLineExp]
  );

  const helpAccounts = useMemo(() => {
    if (helpField === 'party') return purAccounts;
    if (helpField === 'broker') return brokers;
    return accounts;
  }, [accounts, brokers, helpField, purAccounts]);

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
      if (helpField?.startsWith('exp-grid-code-')) {
        const rowKey = Number(helpField.replace('exp-grid-code-', '')) || 0;
        const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
        setExpGridCodePatch({
          rowKey,
          code,
          ac_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
        });
        return;
      }
      if (helpField?.startsWith('purexp-code-')) {
        const rowKey = Number(helpField.replace('purexp-code-', '')) || 0;
        const activeLine = lines.find((l) => l.key === (purexpLineKey ?? lines[0]?.key));
        const trnNo = activeLine?.trn_no || activeLine?.key;
        const masterRow = (ctx.pur_exp_master || [])[rowKey - 1];
        const expName = String(masterRow?.exp_name ?? '').trim();
        const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
        if (trnNo && expName) {
          setLineExpenses((prev) => {
            const rest = prev.filter((e) => !(e.trn_no === trnNo && String(e.exp_name ?? '').trim() === expName));
            const saved = prev.find((e) => e.trn_no === trnNo && String(e.exp_name ?? '').trim() === expName);
            return [
              ...rest,
              {
                ...saved,
                trn_no: trnNo,
                exp_name: expName,
                exp_rate: saved?.exp_rate ?? masterRow?.exp_rate ?? 0,
                cal_type: saved?.cal_type || masterRow?.cal_type || 'W',
                amount: saved?.amount ?? 0,
                code,
                ac_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
              },
            ];
          });
        }
        return;
      }
      if (helpField?.startsWith('exp-')) {
        const field = helpField.replace(/^exp-/, '');
        if (field === 'form') {
          setHeader((h) => ({ ...h, form: code }));
        } else {
          onFooter(field, code);
        }
      }
    },
    [accounts, ctx.pur_exp_master, helpField, lines, onFooter, purexpLineKey, resolveBroker, resolveParty]
  );

  if (permLoading) {
    return <p className="voucher-entry-form__status">Loading purchase bill…</p>;
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
    <div className="slide slide-25-purchase-bill sale-bill-page sale-entry-desktop pb-layout--desktop">
      <div className="sale-entry-desktop__body voucher-entry-form purchase-bill-form">
        <div className="purchase-bill-form__toolbar-row">
          <PurchaseBillToolbar
            busy={busy}
            mode={mode}
            pbPerms={pbPerms}
            hasBill={!!header.r_no}
            editable={editable}
            newBtnRef={newBtnRef}
            onNew={startNew}
            onEdit={startEdit}
            onDelete={() => void deleteBill()}
            onSave={() => void saveBill()}
            onClose={onBack}
            onList={() => setListOpen(true)}
            onPrint={() => setPrintOpen(true)}
            onPosting={() => {
              if (!header.r_no) {
                setStatus('Open or save a purchase bill first.');
                return;
              }
              setPostingOpen(true);
            }}
            onChecklist={() => {
              if (typeof onOpenChecklist === 'function') onOpenChecklist();
              else setStatus('Purchase bill checklist is not linked from this screen.');
            }}
            onOpenBill={() => void openScanBill()}
          />
          <ModuleRightsPanel variant="iconsOnly" perms={pbPerms} className="purchase-bill-form__perms" />
        </div>

        {status ? <p className="voucher-entry-form__status">{status}</p> : null}

        <p className="pb-expenses-footer__summary pb-summary-strip">
          Qty {fmtWgt(totals.qnty)} · Wgt {fmtWgt(totals.weight)} · Amount {fmtAmt(totals.amount)} · Bill{' '}
          {fmtAmt(totals.mbamt)} · Net {fmtAmt(totals.net_payable)}
        </p>

        <div className="purchase-bill-form__tabs-body">
          <PurchaseBillTabBar activeTab={activeTab} onChange={setActiveTab} tabs={pbTabs} />

          <PurchaseBillTabContent
          activeTab={activeTab}
          header={header}
          footer={footer}
          lines={lines}
          lineExpenses={lineExpenses}
          setLineExpenses={setLineExpenses}
          purExpMaster={ctx.pur_exp_master}
          purexpLineKey={purexpLineKey}
          setPurexpLineKey={setPurexpLineKey}
          editable={editable}
          docNoLocked={docNoLocked}
          busy={busy}
          fyMinYmd={fyMinYmd}
          fyMaxYmd={fyMaxYmd}
          focusChain={focusChain}
          setHeader={setHeader}
          resolveParty={resolveParty}
          resolveBroker={resolveBroker}
          setHelpField={setHelpField}
          openHelp={openHelp}
          openGodownHelp={openGodownHelp}
          setCostHelpOpen={setCostHelpOpen}
          onRnoChange={handleRnoChange}
          onRnoKeyDown={handleRnoKeyDown}
          onRnoBlur={handleRnoBlur}
          onRdateChange={handleRdateChange}
          onRdateBlur={handleRdateBlur}
          onRdateKeyDown={handleRdateKeyDown}
          onRnoFocus={handleRnoFocus}
          onAdvanceToGrid1={advanceToGrid1}
          openGridHelp={openGridHelp}
          partyPerms={partyPerms}
          updateLine={updateLine}
          handleGridF1={handleGridF1}
          handleGridEsc={handleGridEsc}
          onAddLine={addLine}
          showGwCols={showGwCols}
          showUsdCols={showUsdCols}
          isBardana={isBardana}
          isDebitNote={isDebitNote}
          onOpenDnBillHelp={isDebitNote ? () => void openDnBillHelp() : undefined}
          showLineExp={showLineExp}
          onPickScanFile={pickScanFile}
          scanBusy={scanBusy}
          onOpenLineExp={(ln) => {
            setExpGridLine(ln);
            setExpGridOpen(true);
          }}
          onFooter={onFooter}
          openHelp={openHelp}
          totals={totals}
          fmtAmt={fmtAmt}
          fmtWgt={fmtWgt}
        />
        </div>
      </div>

      <VoucherAccountHelpModal
        open={!!helpField && !godownHelpOpen && !costHelpOpen}
        title="Account help (F1)"
        accounts={helpAccounts}
        onSelect={handleAccountHelpSelect}
        onClose={closeAccountHelp}
      />
      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownHelpRows}
        onSelect={(row) => {
          const code = String(row?.god_code ?? row?.GOD_CODE ?? '').trim();
          const hit = godownHelpRows.find((g) => g.god_code === code);
          setHeader((h) => ({ ...h, god_code: code, god_name: hit?.god_name || '' }));
        }}
        onClose={closeGodownHelp}
      />
      <VoucherGridHelpModal
        open={costHelpOpen}
        title="Cost centre help"
        columns={COST_HELP_COLUMNS}
        rows={costHelpRows}
        onSelect={(row) => {
          const code = String(row?.cost_code ?? row?.COST_CODE ?? '').trim();
          setHeader((h) => ({ ...h, cost_code: code }));
          setCostHelpOpen(false);
        }}
        onClose={() => setCostHelpOpen(false)}
      />
      <VoucherGridHelpModal
        open={poHelpOpen}
        title="PO help (F1)"
        columns={PO_HELP_COLUMNS}
        rows={poHelpRows}
        loading={poHelpLoading}
        error={poHelpError}
        onSelect={handlePoHelpSelect}
        onClose={() => {
          setPoHelpOpen(false);
          setPoHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <PurchaseBillDnBillHelpModal
        open={dnBillHelpOpen}
        rows={dnBillHelpRows}
        loading={dnBillHelpLoading}
        error={dnBillHelpError}
        supplierCode={header.code}
        onApply={applyDnBillHelp}
        onClose={() => {
          setDnBillHelpOpen(false);
          restoreHelpFocus();
        }}
      />
      <VoucherItemHelpModal
        open={itemHelpLine != null}
        items={items}
        onSelect={(item) => {
          if (itemHelpLine == null) return;
          const lineKey = itemHelpLine;
          helpReturnFocusRef.current = `ln-${lineKey}-item`;
          updateLine(lineKey, {
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
      <VoucherItemHelpModal
        open={bardHelpLine != null}
        items={items}
        onSelect={(item) => {
          if (bardHelpLine == null) return;
          updateLine(bardHelpLine, {
            bard_item_code: String(item.ITEM_CODE ?? item.item_code ?? ''),
            bard_item_name: String(item.ITEM_NAME ?? item.item_name ?? ''),
          });
          setBardHelpLine(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setBardHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherAccountHelpModal
        open={purHelpLine != null}
        title="Purchase code help"
        accounts={purAccounts}
        onSelect={(code) => {
          if (purHelpLine == null) return;
          const hit = purAccounts.find((a) => String(a.CODE ?? a.code).trim() === code);
          updateLine(purHelpLine, {
            pur_code: code,
            pur_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
          });
        }}
        onClose={() => {
          setPurHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <VoucherAccountHelpModal
        open={saleHelpLine != null}
        title="Sale code help"
        accounts={accounts}
        onSelect={(code) => {
          if (saleHelpLine == null) return;
          const hit = accounts.find((a) => String(a.CODE ?? a.code ?? '').trim() === code);
          updateLine(saleHelpLine, {
            s_code: code,
            s_name: hit ? String(hit.NAME ?? hit.name ?? '').trim() : '',
          });
        }}
        onClose={() => {
          setSaleHelpLine(null);
          restoreHelpFocus();
        }}
      />
      <PurchaseBillExpGridModal
        open={expGridOpen}
        line={expGridLine}
        lineNo={expGridLine?.trn_no || expGridLine?.key}
        masterRows={ctx.pur_exp_master}
        value={lineExpenses.filter((e) => e.trn_no === (expGridLine?.trn_no || expGridLine?.key))}
        accounts={accounts}
        editable={editable}
        onAccountHelp={(rowKey) => setHelpField(`exp-grid-code-${rowKey}`)}
        helpCodePatch={expGridCodePatch}
        onHelpCodePatchApplied={() => setExpGridCodePatch(null)}
        onChange={(rows) => {
          const trn = expGridLine?.trn_no || expGridLine?.key;
          setLineExpenses((prev) => [
            ...prev.filter((e) => e.trn_no !== trn),
            ...rows.map((r) => ({ ...r, trn_no: trn })),
          ]);
        }}
        onClose={() => {
          setExpGridOpen(false);
          setExpGridLine(null);
        }}
      />
      <PurchaseBillListModal
        open={listOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        billType={BILL_TYPE}
        fyMinYmd={fyMinYmd}
        fyMaxYmd={fyMaxYmd}
        onSelect={({ r_no, r_date }) => {
          void loadBill(r_no, r_date);
          setListOpen(false);
        }}
        onClose={() => setListOpen(false)}
      />
      <PurchaseBillPrintModal
        open={printOpen}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={
          header.r_no
            ? {
                type: BILL_TYPE,
                oracleDt: toOracleDateFromAny(header.r_date),
                r_date: toOracleDateFromAny(header.r_date),
                rNo: header.r_no,
                r_no: header.r_no,
                label: isBardana
                  ? `Bardana Purchase Bill ${header.r_no}`
                  : isDebitNote
                    ? `Debit Note ${header.r_no}`
                    : `Purchase Bill ${header.r_no}`,
              }
            : null
        }
        companyName={formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        onClose={() => setPrintOpen(false)}
      />
      <PurchaseBillPostingModal
        open={postingOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        billType={BILL_TYPE}
        rDate={header.r_date}
        rNo={header.r_no}
        onClose={() => setPostingOpen(false)}
      />
    </div>
  );
}
