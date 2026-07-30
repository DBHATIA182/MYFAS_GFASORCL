import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { GfasToolbar, GfasToolbarBtn } from './GfasToolbar';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import ConsignmentStockListModal from './ConsignmentStockListModal';
import ConsignmentStockPostingModal from './ConsignmentStockPostingModal';
import ConsignmentStockChecklistModal from './ConsignmentStockChecklistModal';
import { toInputDateString, toOracleDateFromAny } from '../utils/dateFormat';
import { createEnterFocusChain } from '../utils/enterFocusChain';
import { apiUrl } from '../utils/resolveApiBase';
import {
  defaultDocDateInFinYear,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import '../styles/voucherEntryForm.css';
import '../styles/consignmentStockForm.css';

const reqOpts = { withCredentials: true, timeout: 120000 };

function supplierCodePrefix(code) {
  return String(code ?? '').trim().toUpperCase().charAt(0);
}

function isSupplierCode(code) {
  const p = supplierCodePrefix(code);
  return p === 'S' || p === 'T';
}

function parseItemRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function parseSupplierRows(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.accounts) ? data.accounts : [];
  return rows.filter((r) => isSupplierCode(r.CODE ?? r.code));
}
const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];
const COST_HELP_COLUMNS = [
  { key: 'cost_code', label: 'Code' },
  { key: 'cost_name', label: 'Name' },
];

function digitsMax10(v) {
  return String(v ?? '').replace(/\D/g, '').slice(0, 10);
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function emptyHeader(defaultDate) {
  return {
    r_no: '',
    r_date: defaultDate || '',
    b_no: '',
    item_code: '',
    item_name: '',
    lot: '',
    god_code: '',
    god_name: '',
    sup_code: '',
    party_name: '',
    bags: '',
    katta: '',
    hkatta: '',
    gr_no: '',
    truck_no: '',
    tpt: '',
    exp_cat: 'A',
    ch_no: '',
    ch_date: '',
    weight: '',
    rate: '',
    amount: '',
    f_form: 'N',
    labour: 'Y',
    remarks: '',
    msup_code: '',
    msup_name: '',
    cost_code: '',
    cost_name: '',
    l_c: '',
    cgst_per: '',
    cgst_amt: '',
    sgst_per: '',
    sgst_amt: '',
    igst_per: '',
    igst_amt: '',
    cgst_code: '',
    sgst_code: '',
    igst_code: '',
    mod_reason: '',
  };
}

function applyHeader(h, defaultDate) {
  return {
    ...emptyHeader(defaultDate),
    r_no: h.r_no != null ? String(h.r_no) : '',
    r_date: toInputDateString(h.r_date) || defaultDate || '',
    b_no: h.b_no != null && Number(h.b_no) !== 0 ? String(h.b_no) : '',
    item_code: h.item_code ? String(h.item_code) : '',
    item_name: h.item_name || '',
    lot: h.lot != null && Number(h.lot) !== 0 ? String(h.lot) : '',
    god_code: h.god_code || '',
    god_name: h.god_name || '',
    sup_code: h.sup_code || '',
    party_name: h.party_name || '',
    bags: h.bags != null && Number(h.bags) !== 0 ? String(h.bags) : '',
    katta: h.katta != null && Number(h.katta) !== 0 ? String(h.katta) : '',
    hkatta: h.hkatta != null && Number(h.hkatta) !== 0 ? String(h.hkatta) : '',
    gr_no: h.gr_no || '',
    truck_no: h.truck_no || '',
    tpt: h.tpt || '',
    exp_cat: h.exp_cat || 'A',
    ch_no: h.ch_no || '',
    ch_date: toInputDateString(h.ch_date) || '',
    weight: h.weight != null && Number(h.weight) !== 0 ? String(h.weight) : '',
    rate: h.rate != null && Number(h.rate) !== 0 ? String(h.rate) : '',
    amount: h.amount != null && Number(h.amount) !== 0 ? String(h.amount) : '',
    f_form: h.f_form || 'N',
    labour: h.labour || 'Y',
    remarks: h.remarks || '',
    msup_code: h.msup_code || '',
    msup_name: h.msup_name || '',
    cost_code: h.cost_code || '',
    cost_name: h.cost_name || '',
    l_c: h.l_c || '',
    cgst_per: h.cgst_per != null && Number(h.cgst_per) !== 0 ? String(h.cgst_per) : '',
    cgst_amt: h.cgst_amt != null && Number(h.cgst_amt) !== 0 ? String(h.cgst_amt) : '',
    sgst_per: h.sgst_per != null && Number(h.sgst_per) !== 0 ? String(h.sgst_per) : '',
    sgst_amt: h.sgst_amt != null && Number(h.sgst_amt) !== 0 ? String(h.sgst_amt) : '',
    igst_per: h.igst_per != null && Number(h.igst_per) !== 0 ? String(h.igst_per) : '',
    igst_amt: h.igst_amt != null && Number(h.igst_amt) !== 0 ? String(h.igst_amt) : '',
    cgst_code: h.cgst_code || '',
    sgst_code: h.sgst_code || '',
    igst_code: h.igst_code || '',
    mod_reason: h.mod_reason || '',
  };
}

/** VFP DO FORM cstock WITH 'PC',G_BLNKDT,0,'' — Consignment Stock Entry */
export default function ConsignmentStockEntryForm({ apiBase, formData, userName, onBack }) {
  const fy = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);
  const defaultDocDate = useMemo(() => defaultDocDateInFinYear(fy.fyMinYmd, fy.fyMaxYmd), [fy]);
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compYear = formData?.comp_year ?? formData?.COMP_YEAR ?? 0;

  const apiParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName }),
    [compCode, compUid, userName]
  );

  const [mode, setMode] = useState('view');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [header, setHeader] = useState(() => emptyHeader(defaultDocDate));
  const [continueNext, setContinueNext] = useState('N');
  const [listOpen, setListOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [helpField, setHelpField] = useState(null);
  const [itemHelp, setItemHelp] = useState(false);
  const [godHelp, setGodHelp] = useState(false);
  const [costHelp, setCostHelp] = useState(false);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [costs, setCosts] = useState([]);
  const [lookupErr, setLookupErr] = useState('');
  const [itemHelpLoading, setItemHelpLoading] = useState(false);
  const [itemHelpError, setItemHelpError] = useState('');
  const [itemHelpSeed, setItemHelpSeed] = useState('');
  const newBtnRef = useRef(null);
  const helpReturnFocusRef = useRef(null);
  const focusChain = useMemo(() => createEnterFocusChain(), []);

  const editable = mode === 'new' || mode === 'edit';
  const hasRec = !!String(header.r_no ?? '').trim() && mode === 'view';

  /** VFP cstock tab order — left/right pairs, then GST / footer. */
  const focusOrder = useMemo(
    () => [
      'r_no',
      'b_no',
      'item_code',
      'lot',
      'god_code',
      'r_date',
      'sup_code',
      'bags',
      'katta',
      'hkatta',
      'gr_no',
      'truck_no',
      'tpt',
      'ch_date',
      'exp_cat',
      'weight',
      'ch_no',
      'f_form',
      'rate',
      'remarks',
      'amount',
      'labour',
      'msup_code',
      'cost_code',
      'l_c',
      'cgst_per',
      'cgst_code',
      'cgst_amt',
      'sgst_per',
      'sgst_code',
      'sgst_amt',
      'igst_per',
      'igst_code',
      'igst_amt',
      'mod_reason',
      'continue',
    ],
    []
  );

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
    }, 40);
  }, [focusChain]);

  const openFieldHelp = useCallback((focusKey, openFn) => {
    if (focusKey) helpReturnFocusRef.current = focusKey;
    openFn?.();
  }, []);

  const onFieldEnter = useCallback(
    (key, { f1 } = {}) =>
      (e) => {
        if (e.key === 'F1' && typeof f1 === 'function') {
          e.preventDefault();
          f1();
          return;
        }
        focusChain.onEnter(key)(e);
      },
    [focusChain]
  );

  const setField = useCallback((field, value) => {
    setHeader((h) => {
      const next = { ...h, [field]: value };
      if (field === 'weight' || field === 'rate') {
        const w = num(field === 'weight' ? value : next.weight);
        const r = num(field === 'rate' ? value : next.rate);
        if (w && r) next.amount = String(Math.round(w * r * 100) / 100);
      }
      if ((field === 'cgst_per' || field === 'weight' || field === 'amount') && num(next.cgst_per)) {
        const base = num(next.amount) || num(next.weight) * num(next.rate);
        next.cgst_amt = String(Math.round((base * num(next.cgst_per)) / 100 * 100) / 100);
      }
      if ((field === 'sgst_per' || field === 'weight' || field === 'amount') && num(next.sgst_per)) {
        const base = num(next.amount) || num(next.weight) * num(next.rate);
        next.sgst_amt = String(Math.round((base * num(next.sgst_per)) / 100 * 100) / 100);
      }
      if ((field === 'igst_per' || field === 'weight' || field === 'amount') && num(next.igst_per)) {
        const base = num(next.amount) || num(next.weight) * num(next.rate);
        next.igst_amt = String(Math.round((base * num(next.igst_per)) / 100 * 100) / 100);
      }
      return next;
    });
  }, []);

  const fetchItems = useCallback(async () => {
    if (compCode == null || compCode === '') return [];
    const params = { comp_code: compCode, comp_uid: compUid };
    let lastErr = null;
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/purchaselist-items'), { params, ...reqOpts });
      const rows = parseItemRows(data);
      if (rows.length) return rows;
    } catch (e) {
      lastErr = e;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/items'), { params, ...reqOpts });
      const rows = parseItemRows(data);
      if (rows.length) return rows;
      if (!rows.length && lastErr) throw lastErr;
      return rows;
    } catch (e) {
      throw e.response ? e : lastErr || e;
    }
  }, [apiBase, compCode, compUid]);

  const fetchSuppliers = useCallback(async () => {
    if (compCode == null || compCode === '') return [];
    const params = { comp_code: compCode, comp_uid: compUid };
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/suppliers'), { params, ...reqOpts });
      const rows = parseSupplierRows(data);
      if (rows.length) return rows;
    } catch {
      /* fallback */
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/purchaselist-purcodes'), { params, ...reqOpts });
      return parseSupplierRows(data);
    } catch {
      return [];
    }
  }, [apiBase, compCode, compUid]);

  const loadLookups = useCallback(async () => {
    if (compCode == null || compCode === '') return { items: [], suppliers: [] };
    setLookupErr('');
    try {
      const [itemRows, supRows, godRes, costRes] = await Promise.all([
        fetchItems().catch(() => []),
        fetchSuppliers(),
        axios.get(apiUrl(apiBase, '/api/purchaselist-godowns'), { params: { comp_code: compCode, comp_uid: compUid }, ...reqOpts }).catch(() => ({ data: [] })),
        axios.get(apiUrl(apiBase, '/api/cost-mast-list'), { params: { comp_code: compCode, comp_uid: compUid }, ...reqOpts }).catch(() => ({ data: [] })),
      ]);
      setItems(itemRows);
      setSuppliers(supRows);
      const godRows = Array.isArray(godRes.data) ? godRes.data : godRes.data?.rows || godRes.data?.godowns || [];
      setGodowns(godRows);
      const costRows = Array.isArray(costRes.data) ? costRes.data : costRes.data?.rows || costRes.data?.costs || [];
      setCosts(costRows);
      if (!itemRows.length) setLookupErr('No items loaded from ITEMMAST.');
      return { items: itemRows, suppliers: supRows };
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Lookup load failed.';
      setLookupErr(msg);
      return { items: [], suppliers: [] };
    }
  }, [apiBase, compCode, compUid, fetchItems, fetchSuppliers]);

  const openItemHelp = useCallback(
    async (seed = '', focusKey = 'item_code') => {
      helpReturnFocusRef.current = focusKey;
      setItemHelpSeed(String(seed ?? '').trim());
      setItemHelpError('');
      setItemHelp(true);
      setItemHelpLoading(true);
      try {
        const itemRows = await fetchItems();
        if (!itemRows.length) {
          const msg = 'ITEMMAST returned no items for this company.';
          setItemHelpError(msg);
          setLookupErr(msg);
          setItems([]);
          return;
        }
        setItems(itemRows);
        setLookupErr('');
      } catch (e) {
        const msg = e.response?.data?.error || e.message || 'Item list failed.';
        setItemHelpError(msg);
        setLookupErr(msg);
        setItems([]);
      } finally {
        setItemHelpLoading(false);
      }
    },
    [fetchItems]
  );
  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    if (formData?.openCstockChecklist) setChecklistOpen(true);
  }, [formData?.openCstockChecklist]);

  useEffect(() => {
    const code = String(header.god_code ?? '').trim();
    if (!code || !godowns.length) return;
    if (String(header.god_name ?? '').trim()) return;
    const found = godowns.find((g) => String(g.god_code ?? g.GOD_CODE ?? '').trim().toUpperCase() === code.toUpperCase());
    if (found) setField('god_name', String(found.god_name ?? found.GOD_NAME ?? '').trim());
  }, [godowns, header.god_code, header.god_name, setField]);

  const loadRecord = useCallback(
    async (rNo, rDate) => {
      if (!rNo) return;
      setBusy(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock'), {
          params: { ...apiParams, r_no: rNo, r_date: toOracleDateFromAny(rDate) || undefined },
          ...reqOpts,
        });
        setHeader(applyHeader(data?.header || {}, defaultDocDate));
        setMode('view');
        setStatus(`Sr.No. ${data?.header?.r_no || rNo} loaded.`);
      } catch (e) {
        setErr(e.response?.data?.error || e.message || 'Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiParams, defaultDocDate]
  );

  const handleNew = useCallback(async () => {
    setErr('');
    setBusy(true);
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/next-no'), {
        params: apiParams,
        ...reqOpts,
      });
      const next = emptyHeader(defaultDocDate);
      next.r_no = String(data?.next_no || 1);
      next.b_no = String(data?.next_bno || 1);
      setHeader(next);
      setMode('new');
      setStatus('New consignment stock entry.');
      setContinueNext('N');
      window.setTimeout(() => focusChain.focusKey('b_no'), 80);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Next no failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, defaultDocDate, focusChain]);

  const handleEdit = useCallback(() => {
    if (!header.r_no) return;
    setMode('edit');
    setStatus(`Editing Sr.No. ${header.r_no}`);
    window.setTimeout(() => focusChain.focusKey('item_code'), 80);
  }, [header.r_no, focusChain]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/consignment-stock'),
        {
          ...apiParams,
          comp_year: compYear,
          header: {
            ...header,
            r_date: toOracleDateFromAny(header.r_date),
            ch_date: toOracleDateFromAny(header.ch_date) || null,
          },
        },
        reqOpts
      );
      const saved = applyHeader(data?.header || {}, defaultDocDate);
      setHeader(saved);
      setMode('view');
      setStatus(`Saved Sr.No. ${saved.r_no}.`);
      if (String(continueNext).toUpperCase() === 'Y') {
        const next = emptyHeader(defaultDocDate);
        next.b_no = saved.b_no;
        next.sup_code = saved.sup_code;
        next.party_name = saved.party_name;
        next.god_code = saved.god_code;
        next.god_name = saved.god_name;
        next.item_code = saved.item_code;
        next.item_name = saved.item_name;
        next.msup_code = saved.msup_code;
        next.msup_name = saved.msup_name;
        next.r_date = saved.r_date;
        try {
          const noRes = await axios.get(apiUrl(apiBase, '/api/consignment-stock/next-no'), { params: apiParams, ...reqOpts });
          next.r_no = String(noRes.data?.next_no || '');
          const lotRes = await axios.get(apiUrl(apiBase, '/api/consignment-stock/next-lot'), {
            params: { ...apiParams, item_code: next.item_code },
            ...reqOpts,
          });
          next.lot = String(lotRes.data?.next_lot || '');
        } catch {
          /* keep blanks */
        }
        setHeader(next);
        setMode('new');
        setStatus(`Continue next lot — Bikri ${next.b_no}.`);
        window.setTimeout(() => focusChain.focusKey('lot'), 80);
      }
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, compYear, continueNext, defaultDocDate, focusChain, header]);

  const handleDelete = useCallback(async () => {
    if (!header.r_no) return;
    if (!window.confirm(`Delete Sr.No. ${header.r_no}?`)) return;
    const reason = window.prompt('Mod. Reason (optional):', header.mod_reason || '') ?? '';
    setBusy(true);
    setErr('');
    try {
      await axios.delete(apiUrl(apiBase, '/api/consignment-stock'), {
        params: {
          ...apiParams,
          r_no: header.r_no,
          r_date: toOracleDateFromAny(header.r_date),
          mod_reason: reason,
        },
        ...reqOpts,
      });
      setHeader(emptyHeader(defaultDocDate));
      setMode('view');
      setStatus(`Deleted Sr.No. ${header.r_no}.`);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, apiParams, defaultDocDate, header]);

  const resolveItem = useCallback(
    async (code) => {
      const c = String(code ?? '').trim();
      if (!c) {
        setField('item_name', '');
        return;
      }
      const codeNum = Number(c) || 0;
      const found = items.find((it) => {
        const ic = Number(it.item_code ?? it.ITEM_CODE ?? 0) || 0;
        return ic === codeNum || String(it.item_code ?? it.ITEM_CODE ?? '').trim() === c;
      });
      if (found) {
        setField('item_code', String(found.item_code ?? found.ITEM_CODE ?? c));
        setField('item_name', String(found.item_name || found.ITEM_NAME || found.NAME || found.name || '').trim());
      } else {
        setField('item_code', c);
        setField('item_name', '');
      }
      if (mode === 'new' && !header.lot) {
        try {
          const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/next-lot'), {
            params: { ...apiParams, item_code: c },
            ...reqOpts,
          });
          setField('lot', String(data?.next_lot || ''));
        } catch {
          /* optional */
        }
      }
    },
    [apiBase, apiParams, header.lot, items, mode, setField]
  );

  const resolveParty = useCallback(
    (code, nameField = 'party_name', codeField = 'sup_code') => {
      const c = String(code ?? '').trim().toUpperCase();
      const found = suppliers.find((a) => String(a.code ?? a.CODE ?? '').toUpperCase() === c);
      setField(codeField, c);
      setField(nameField, found?.name || found?.NAME || '');
    },
    [suppliers, setField]
  );

  const resolveGodown = useCallback(
    (code) => {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) {
        setField('god_code', '');
        setField('god_name', '');
        return;
      }
      const found = godowns.find((g) => String(g.god_code ?? g.GOD_CODE ?? '').trim().toUpperCase() === c);
      setField('god_code', c);
      setField('god_name', found ? String(found.god_name ?? found.GOD_NAME ?? '').trim() : '');
    },
    [godowns, setField]
  );

  const supplierHelpList = useMemo(() => suppliers, [suppliers]);

  return (
    <div className="cstock-form">
      <GfasToolbar className="cstock-form__toolbar">
        <GfasToolbarBtn ref={newBtnRef} icon="add" label="New" onClick={() => void handleNew()} disabled={busy} />
        <GfasToolbarBtn
          icon="edit"
          label="Edit"
          variant={mode === 'edit' ? 'primary' : 'secondary'}
          onClick={handleEdit}
          disabled={busy || !hasRec}
        />
        <GfasToolbarBtn icon="delete" label="Delete" variant="danger" onClick={() => void handleDelete()} disabled={busy || !hasRec} />
        <GfasToolbarBtn icon="save" label="Save" variant="primary" onClick={() => void handleSave()} disabled={busy || !editable} />
        <GfasToolbarBtn
          icon="voucher"
          label="Posting"
          onClick={() => setPostingOpen(true)}
          disabled={busy || !String(header.r_no ?? '').trim() || mode === 'new'}
          title="Post saved entry to LOTSTOCK"
        />
        <GfasToolbarBtn icon="checklist" label="Checklist" onClick={() => setChecklistOpen(true)} disabled={busy} title="Consignment Stock List (CSCHK)" />
        <GfasToolbarBtn icon="close" label="Close" onClick={onBack} disabled={busy} />
        <GfasToolbarBtn icon="list" label="List" onClick={() => setListOpen(true)} disabled={busy} />
      </GfasToolbar>

      {status ? <p className="cstock-form__status">{status}</p> : null}
      {lookupErr ? (
        <p className="form-api-error" role="alert">
          {lookupErr}
        </p>
      ) : null}
      {err ? (
        <p className="form-api-error" role="alert">
          {err}
        </p>
      ) : null}

      <div className="cstock-form__grid">
        <div className="cstock-form__col">
          <label>
            <span>Sr.No.</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.r_no}
                disabled={!editable || mode === 'edit'}
                ref={(el) => focusChain.register('r_no', el)}
                onChange={(e) => setField('r_no', e.target.value.replace(/\D/g, ''))}
                onKeyDown={onFieldEnter('r_no')}
                onBlur={(e) => {
                  if (!editable && e.target.value) void loadRecord(e.target.value, header.r_date);
                }}
              />
            </div>
          </label>
          <label>
            <span>Item Code</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.item_code}
                disabled={!editable}
                ref={(el) => focusChain.register('item_code', el)}
                onChange={(e) => setField('item_code', e.target.value.replace(/\D/g, ''))}
                onBlur={(e) => void resolveItem(e.target.value)}
                onKeyDown={onFieldEnter('item_code', {
                  f1: () => void openItemHelp(header.item_name || header.item_code, 'item_code'),
                })}
              />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable || itemHelpLoading}
                onClick={() => void openItemHelp(header.item_name || header.item_code, 'item_code')}
                title="Item help (F1)"
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>Lot</span>
            <input
              className="form-input"
              value={header.lot}
              disabled={!editable}
              ref={(el) => focusChain.register('lot', el)}
              onChange={(e) => setField('lot', e.target.value.replace(/\D/g, ''))}
              onKeyDown={onFieldEnter('lot')}
            />
          </label>
          <label>
            <span>Date</span>
            <VoucherDmyDateInput
              className="form-input"
              valueYmd={header.r_date}
              minYmd={fy.fyMinYmd}
              maxYmd={fy.fyMaxYmd}
              disabled={!editable}
              inputRef={(el) => focusChain.register('r_date', el)}
              onChangeYmd={(v) => setField('r_date', v)}
              onKeyDown={onFieldEnter('r_date')}
            />
          </label>
          <label>
            <span>Party</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input cstock-form__code-sm"
                value={header.sup_code}
                disabled={!editable}
                ref={(el) => focusChain.register('sup_code', el)}
                onChange={(e) => setField('sup_code', e.target.value.toUpperCase())}
                onBlur={(e) => resolveParty(e.target.value)}
                onKeyDown={onFieldEnter('sup_code', {
                  f1: () => openFieldHelp('sup_code', () => setHelpField('party')),
                })}
              />
              <input className="form-input" value={header.party_name} disabled readOnly title="Party name" />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable}
                onClick={() => openFieldHelp('sup_code', () => setHelpField('party'))}
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>G.R.No.</span>
            <input
              className="form-input"
              value={header.gr_no}
              disabled={!editable}
              ref={(el) => focusChain.register('gr_no', el)}
              onChange={(e) => setField('gr_no', e.target.value)}
              onKeyDown={onFieldEnter('gr_no')}
            />
          </label>
          <label>
            <span>Truck No.</span>
            <input
              className="form-input"
              value={header.truck_no}
              disabled={!editable}
              ref={(el) => focusChain.register('truck_no', el)}
              onChange={(e) => setField('truck_no', e.target.value.toUpperCase())}
              onKeyDown={onFieldEnter('truck_no')}
            />
          </label>
          <label>
            <span>Ch.Date</span>
            <VoucherDmyDateInput
              className="form-input"
              valueYmd={header.ch_date}
              minYmd={fy.fyMinYmd}
              maxYmd={fy.fyMaxYmd}
              disabled={!editable}
              inputRef={(el) => focusChain.register('ch_date', el)}
              onChangeYmd={(v) => setField('ch_date', v)}
              onKeyDown={onFieldEnter('ch_date')}
            />
          </label>
          <label>
            <span>Weight</span>
            <input
              className="form-input"
              value={header.weight}
              disabled={!editable}
              ref={(el) => focusChain.register('weight', el)}
              onChange={(e) => setField('weight', e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={onFieldEnter('weight')}
            />
          </label>
          <label>
            <span>F.Form Y/N/I</span>
            <select
              className="form-input"
              value={header.f_form}
              disabled={!editable}
              ref={(el) => focusChain.register('f_form', el)}
              onChange={(e) => setField('f_form', e.target.value)}
              onKeyDown={onFieldEnter('f_form')}
            >
              <option value="N">N</option>
              <option value="Y">Y</option>
              <option value="I">I</option>
            </select>
          </label>
          <label>
            <span>Remarks</span>
            <input
              className="form-input"
              value={header.remarks}
              disabled={!editable}
              ref={(el) => focusChain.register('remarks', el)}
              onChange={(e) => setField('remarks', e.target.value)}
              onKeyDown={onFieldEnter('remarks')}
            />
          </label>
          <label>
            <span>Sup.Code</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.msup_code}
                disabled={!editable}
                ref={(el) => focusChain.register('msup_code', el)}
                onChange={(e) => setField('msup_code', e.target.value.toUpperCase())}
                onBlur={(e) => resolveParty(e.target.value, 'msup_name', 'msup_code')}
                onKeyDown={onFieldEnter('msup_code', {
                  f1: () => openFieldHelp('msup_code', () => setHelpField('msup')),
                })}
              />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable}
                onClick={() => openFieldHelp('msup_code', () => setHelpField('msup'))}
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>Cost Code</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.cost_code}
                disabled={!editable}
                ref={(el) => focusChain.register('cost_code', el)}
                onChange={(e) => setField('cost_code', e.target.value.toUpperCase())}
                onKeyDown={onFieldEnter('cost_code', {
                  f1: () => openFieldHelp('cost_code', () => setCostHelp(true)),
                })}
              />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable}
                onClick={() => openFieldHelp('cost_code', () => setCostHelp(true))}
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>L/C</span>
            <input
              className="form-input"
              value={header.l_c}
              maxLength={1}
              disabled={!editable}
              ref={(el) => focusChain.register('l_c', el)}
              onChange={(e) => setField('l_c', e.target.value.toUpperCase())}
              onKeyDown={onFieldEnter('l_c')}
            />
          </label>
          <label>
            <span>CGST</span>
            <div className="cstock-form__gst">
              <input
                className="form-input"
                placeholder="%"
                value={header.cgst_per}
                disabled={!editable}
                ref={(el) => focusChain.register('cgst_per', el)}
                onChange={(e) => setField('cgst_per', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('cgst_per')}
              />
              <input
                className="form-input"
                placeholder="Code"
                value={header.cgst_code}
                disabled={!editable}
                ref={(el) => focusChain.register('cgst_code', el)}
                onChange={(e) => setField('cgst_code', e.target.value.toUpperCase())}
                onKeyDown={onFieldEnter('cgst_code')}
              />
              <input
                className="form-input"
                placeholder="Amt"
                value={header.cgst_amt}
                disabled={!editable}
                ref={(el) => focusChain.register('cgst_amt', el)}
                onChange={(e) => setField('cgst_amt', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('cgst_amt')}
              />
            </div>
          </label>
          <label>
            <span>SGST</span>
            <div className="cstock-form__gst">
              <input
                className="form-input"
                placeholder="%"
                value={header.sgst_per}
                disabled={!editable}
                ref={(el) => focusChain.register('sgst_per', el)}
                onChange={(e) => setField('sgst_per', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('sgst_per')}
              />
              <input
                className="form-input"
                placeholder="Code"
                value={header.sgst_code}
                disabled={!editable}
                ref={(el) => focusChain.register('sgst_code', el)}
                onChange={(e) => setField('sgst_code', e.target.value.toUpperCase())}
                onKeyDown={onFieldEnter('sgst_code')}
              />
              <input
                className="form-input"
                placeholder="Amt"
                value={header.sgst_amt}
                disabled={!editable}
                ref={(el) => focusChain.register('sgst_amt', el)}
                onChange={(e) => setField('sgst_amt', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('sgst_amt')}
              />
            </div>
          </label>
          <label>
            <span>IGST</span>
            <div className="cstock-form__gst">
              <input
                className="form-input"
                placeholder="%"
                value={header.igst_per}
                disabled={!editable}
                ref={(el) => focusChain.register('igst_per', el)}
                onChange={(e) => setField('igst_per', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('igst_per')}
              />
              <input
                className="form-input"
                placeholder="Code"
                value={header.igst_code}
                disabled={!editable}
                ref={(el) => focusChain.register('igst_code', el)}
                onChange={(e) => setField('igst_code', e.target.value.toUpperCase())}
                onKeyDown={onFieldEnter('igst_code')}
              />
              <input
                className="form-input"
                placeholder="Amt"
                value={header.igst_amt}
                disabled={!editable}
                ref={(el) => focusChain.register('igst_amt', el)}
                onChange={(e) => setField('igst_amt', e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={onFieldEnter('igst_amt')}
              />
            </div>
          </label>
        </div>

        <div className="cstock-form__col">
          <label>
            <span>Bikri No.</span>
            <input
              className="form-input"
              value={header.b_no}
              disabled={!editable}
              ref={(el) => focusChain.register('b_no', el)}
              onChange={(e) => setField('b_no', e.target.value.replace(/\D/g, ''))}
              onKeyDown={onFieldEnter('b_no')}
            />
          </label>
          <label>
            <span>Name</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.item_name}
                disabled={!editable}
                readOnly
                onKeyDown={onFieldEnter('item_code', {
                  f1: () => void openItemHelp(header.item_name || header.item_code, 'item_code'),
                })}
                title="F1 — item help (code or name)"
              />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable || itemHelpLoading}
                onClick={() => void openItemHelp(header.item_name || header.item_code, 'item_code')}
                title="Item help (F1)"
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>God.Code</span>
            <div className="cstock-form__with-help">
              <input
                className="form-input"
                value={header.god_code}
                disabled={!editable}
                ref={(el) => focusChain.register('god_code', el)}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setField('god_code', v);
                }}
                onBlur={(e) => resolveGodown(e.target.value)}
                onKeyDown={onFieldEnter('god_code', {
                  f1: () => openFieldHelp('god_code', () => setGodHelp(true)),
                })}
              />
              <button
                type="button"
                className="cstock-form__help"
                disabled={!editable}
                onClick={() => openFieldHelp('god_code', () => setGodHelp(true))}
              >
                🔍
              </button>
            </div>
          </label>
          <label>
            <span>Name</span>
            <input className="form-input" value={header.god_name} disabled readOnly title="Godown name" />
          </label>
          <div className="cstock-form__qty-row">
            <span className="cstock-form__qty-lead">Bags</span>
            <div className="cstock-form__qty-fields">
              <input
                className="form-input"
                value={header.bags}
                disabled={!editable}
                maxLength={10}
                inputMode="numeric"
                aria-label="Bags"
                ref={(el) => focusChain.register('bags', el)}
                onChange={(e) => setField('bags', digitsMax10(e.target.value))}
                onKeyDown={onFieldEnter('bags')}
              />
              <label className="cstock-form__qty-pair">
                <span>Katta</span>
                <input
                  className="form-input"
                  value={header.katta}
                  disabled={!editable}
                  maxLength={10}
                  inputMode="numeric"
                  ref={(el) => focusChain.register('katta', el)}
                  onChange={(e) => setField('katta', digitsMax10(e.target.value))}
                  onKeyDown={onFieldEnter('katta')}
                />
              </label>
              <label className="cstock-form__qty-pair">
                <span>Hkatta</span>
                <input
                  className="form-input"
                  value={header.hkatta}
                  disabled={!editable}
                  maxLength={10}
                  inputMode="numeric"
                  ref={(el) => focusChain.register('hkatta', el)}
                  onChange={(e) => setField('hkatta', digitsMax10(e.target.value))}
                  onKeyDown={onFieldEnter('hkatta')}
                />
              </label>
            </div>
          </div>
          <label>
            <span>Transport</span>
            <input
              className="form-input"
              value={header.tpt}
              disabled={!editable}
              ref={(el) => focusChain.register('tpt', el)}
              onChange={(e) => setField('tpt', e.target.value)}
              onKeyDown={onFieldEnter('tpt')}
            />
          </label>
          <label>
            <span>Exp.Cat</span>
            <input
              className="form-input"
              value={header.exp_cat}
              maxLength={2}
              disabled={!editable}
              ref={(el) => focusChain.register('exp_cat', el)}
              onChange={(e) => setField('exp_cat', e.target.value.toUpperCase())}
              onKeyDown={onFieldEnter('exp_cat')}
            />
          </label>
          <label>
            <span>Ch.No.</span>
            <input
              className="form-input"
              value={header.ch_no}
              disabled={!editable}
              ref={(el) => focusChain.register('ch_no', el)}
              onChange={(e) => setField('ch_no', e.target.value)}
              onKeyDown={onFieldEnter('ch_no')}
            />
          </label>
          <label>
            <span>Rate</span>
            <input
              className="form-input"
              value={header.rate}
              disabled={!editable}
              ref={(el) => focusChain.register('rate', el)}
              onChange={(e) => setField('rate', e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={onFieldEnter('rate')}
            />
          </label>
          <label>
            <span>E.Amount</span>
            <input
              className="form-input"
              value={header.amount}
              disabled={!editable}
              ref={(el) => focusChain.register('amount', el)}
              onChange={(e) => setField('amount', e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={onFieldEnter('amount')}
            />
          </label>
          <label>
            <span>Labour Y/N</span>
            <select
              className="form-input"
              value={header.labour}
              disabled={!editable}
              ref={(el) => focusChain.register('labour', el)}
              onChange={(e) => setField('labour', e.target.value)}
              onKeyDown={onFieldEnter('labour')}
            >
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
          <label>
            <span>Name</span>
            <input className="form-input" value={header.msup_name} disabled readOnly />
          </label>
          <label>
            <span>Name</span>
            <input className="form-input" value={header.cost_name} disabled readOnly />
          </label>
        </div>
      </div>

      <label className="cstock-form__mod">
        <span>Mod. Reason</span>
        <input
          className="form-input"
          value={header.mod_reason}
          disabled={!editable}
          ref={(el) => focusChain.register('mod_reason', el)}
          onChange={(e) => setField('mod_reason', e.target.value)}
          onKeyDown={onFieldEnter('mod_reason')}
        />
      </label>

      <div className="cstock-form__continue">
        <span>Continue Next Lot In Same Bikri No (Y/N)</span>
        <input
          className="form-input cstock-form__continue-input"
          maxLength={1}
          value={continueNext}
          disabled={!editable}
          ref={(el) => focusChain.register('continue', el)}
          onChange={(e) => setContinueNext(e.target.value.toUpperCase().slice(0, 1) || 'N')}
          onKeyDown={onFieldEnter('continue')}
        />
      </div>

      <ConsignmentStockListModal
        open={listOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        onClose={() => setListOpen(false)}
        onSelect={(row) => void loadRecord(row.r_no, row.r_date)}
      />

      <ConsignmentStockPostingModal
        open={postingOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        compYear={compYear}
        rNo={header.r_no}
        rDate={header.r_date}
        onClose={() => setPostingOpen(false)}
        onPosted={() => setStatus(`Posted Sr.No. ${header.r_no} to LOTSTOCK.`)}
      />

      <ConsignmentStockChecklistModal
        open={checklistOpen}
        apiBase={apiBase}
        apiParams={apiParams}
        fyMinYmd={fy.fyMinYmd}
        fyMaxYmd={fy.fyMaxYmd}
        formData={formData}
        userName={userName}
        suppliers={suppliers}
        items={items}
        godowns={godowns}
        onSelect={(row) => {
          setChecklistOpen(false);
          void loadRecord(row.r_no, row.r_date);
        }}
        onClose={() => setChecklistOpen(false)}
      />

      <VoucherAccountHelpModal
        open={!!helpField}
        title={helpField === 'msup' ? 'Supplier help (F1)' : 'Party help (F1) — S/T codes'}
        accounts={supplierHelpList}
        onSelect={(code) => {
          if (helpField === 'msup') resolveParty(code, 'msup_name', 'msup_code');
          else resolveParty(code);
          setHelpField(null);
          restoreHelpFocus();
        }}
        onClose={() => {
          setHelpField(null);
          restoreHelpFocus();
        }}
      />
      <VoucherItemHelpModal
        open={itemHelp}
        title="Item help (F1)"
        items={items}
        unifiedSearch
        loading={itemHelpLoading}
        loadError={itemHelpError}
        initialFilter={itemHelpSeed}
        onSelect={(item) => {
          const code = item?.item_code ?? item?.ITEM_CODE;
          setField('item_code', String(code ?? ''));
          setField('item_name', String(item?.item_name || item?.ITEM_NAME || '').trim());
          setItemHelp(false);
          setItemHelpError('');
          void resolveItem(code);
          restoreHelpFocus();
        }}
        onClose={() => {
          setItemHelp(false);
          setItemHelpError('');
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={godHelp}
        title="Godown help (F1)"
        columns={GODOWN_HELP_COLUMNS}
        rows={godowns.map((g) => ({
          god_code: g.god_code ?? g.GOD_CODE,
          god_name: g.god_name ?? g.GOD_NAME,
        }))}
        onSelect={(row) => {
          setField('god_code', String(row.god_code || '').toUpperCase());
          setField('god_name', row.god_name || '');
          setGodHelp(false);
          restoreHelpFocus();
        }}
        onClose={() => {
          setGodHelp(false);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={costHelp}
        title="Cost help (F1)"
        columns={COST_HELP_COLUMNS}
        rows={costs.map((c) => ({
          cost_code: c.cost_code ?? c.COST_CODE,
          cost_name: c.cost_name ?? c.COST_NAME,
        }))}
        onSelect={(row) => {
          setField('cost_code', String(row.cost_code || '').toUpperCase());
          setField('cost_name', row.cost_name || '');
          setCostHelp(false);
          restoreHelpFocus();
        }}
        onClose={() => {
          setCostHelp(false);
          restoreHelpFocus();
        }}
      />
    </div>
  );
}
